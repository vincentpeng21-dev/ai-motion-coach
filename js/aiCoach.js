// ============================================================
// aiCoach.js — OPTIONAL "AI judgment" layer on top of the deterministic
// Session Report.
//
// This is the ONLY place in the whole app that calls anything resembling
// an LLM, and it runs 100% locally in the browser via WebGPU
// (@mlc-ai/web-llm) — no server, no API key, no data leaves the device.
// It is strictly a downstream consumer of numbers the rule-based engine
// (squatDetector.js / report.js) already computed: it never sees raw
// video or landmarks, and cannot change rep counts, angles, or any other
// hard number in the report. Its only job is turning those numbers into
// a short natural-language note — think "narrator", not "judge".
//
// The model+runtime is only downloaded when the user explicitly clicks
// "Generate AI Commentary" (opt-in), since it's a few hundred MB.
// ============================================================

import { CONFIG } from "./config.js";
import { computeQualityScore } from "./report.js";

let enginePromise = null;

/** WebLLM's compute backend is WebGPU-only — check before even trying. */
export function supported() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

/**
 * WebLLM's prebuilt config points each model's `model_lib` (the compiled
 * WASM shader binary) at raw.githubusercontent.com. Some networks block
 * that specific host (even when github.com/huggingface.co/jsdelivr work
 * fine) — mirror it through jsdelivr's GitHub proxy instead, which serves
 * the exact same bytes from a host this app already depends on elsewhere.
 */
function githubRawToJsdelivr(url) {
  const m = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.*)$/.exec(url);
  if (!m) return url;
  const [, user, repo, branch, path] = m;
  return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`;
}

/**
 * A cached engine that failed to init, or whose WebGPU device got torn
 * down later (tab backgrounded, GPU context lost/reclaimed, etc.), must
 * NOT stay cached — every retry would just replay the same "disposed"
 * error forever. `resetEngine()` is called from runChat()'s catch block
 * whenever that happens, so the next click builds a genuinely fresh one.
 */
function resetEngine() {
  enginePromise = null;
}

async function getEngine(onProgress) {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        const webllm = await import(/* @vite-ignore */ CONFIG.aiCoachCdnUrl);

        const base = webllm.prebuiltAppConfig?.model_list?.find((m) => m.model_id === CONFIG.aiCoachModelId);
        const appConfig = base
          ? {
              ...webllm.prebuiltAppConfig,
              model_list: [{ ...base, model_lib: githubRawToJsdelivr(base.model_lib) }],
            }
          : undefined;

        return await webllm.CreateMLCEngine(CONFIG.aiCoachModelId, {
          appConfig,
          initProgressCallback: (report) => onProgress && onProgress(report),
        });
      } catch (err) {
        resetEngine(); // don't poison future attempts with a failed init
        throw err;
      }
    })();
  }
  return enginePromise;
}

/**
 * The exact structured data handed to the model — exported so the UI can
 * display it alongside the generated text as a verifiable "source"
 * (Section requested: 講評附上來源). Nothing the model says can reference
 * a number that isn't in here, so showing this list IS showing the source.
 */
export function buildSourceData(summary, cfg) {
  return {
    totalReps: summary.totalReps,
    avgRepTime: summary.avgRepTime,
    avgDepth: summary.avgDepth,
    deepest: summary.deepest,
    consistencyPct: summary.consistencyPct,
    trendNotes: summary.trendNotes || [],
    bottomAngle: cfg.bottomAngle,
    goodDepthAngle: cfg.goodDepthAngle,
    reps: summary.reps.map((r) => ({ index: r.index, minKnee: r.minKnee, duration: r.duration })),
    qualityScore: computeQualityScore(summary, cfg),
  };
}

function buildMessages(src) {
  const repsLine = src.reps
    .map((r) => `第${r.index}下：最低膝角 ${Math.round(r.minKnee)}°，耗時 ${r.duration.toFixed(1)} 秒`)
    .join("；");
  const trends = src.trendNotes.length ? src.trendNotes.join("；") : "無明顯趨勢";

  const qs = src.qualityScore;
  const scoreLine = qs
    ? `動作品質評分：${qs.total}/100（深度 ${qs.breakdown.depth}/25、一致性 ${qs.breakdown.consistency}/25、節奏 ${qs.breakdown.tempo}/25、穩定性 ${qs.breakdown.stability}/25）`
    : "";

  return [
    {
      role: "system",
      content:
        "你是一個健身動作教練助理。你只能根據使用者提供的數據講評，絕對不能捏造任何未提供的數字或事實，不能做醫療診斷或傷病風險判斷，只能描述觀察到的動作數據趨勢。請用繁體中文回答，語氣正向具體，控制在120字以內，不要條列，寫成一小段話。",
    },
    {
      role: "user",
      content: `這是一組側面深蹲訓練的數據，判定深度門檻是膝角 ${src.bottomAngle}°（達標才算一下），理想深度是 ${src.goodDepthAngle}° 以下：

總下數：${src.totalReps}
平均每下時間：${src.avgRepTime.toFixed(1)} 秒
平均最低膝角：${Math.round(src.avgDepth)}°
最深一下：${Math.round(src.deepest)}°
一致性：${Math.round(src.consistencyPct)}%
${scoreLine}
規則系統偵測到的趨勢：${trends}
每一下明細：${repsLine}

請給我簡短講評，針對最弱的分項給出一個具體建議。不要重複列出任何數字，只說明觀察到的問題和改善方向。`,
    },
  ];
}

/**
 * Diagnostics available even when 0 valid reps were counted — still real
 * numbers computed by the rule-based engine (report.js's
 * computeZeroRepDiagnostics + the tracking-quality ratio), never invented.
 */
export function buildNoRepSourceData(diagnostics, trackingQuality, cfg) {
  return {
    trackingQuality,
    minKneeObserved: diagnostics.minKneeObserved,
    durationCovered: diagnostics.durationCovered,
    bottomAngle: cfg.bottomAngle,
    goodDepthAngle: cfg.goodDepthAngle,
  };
}

function buildNoRepMessages(src) {
  const qualityPct = Math.round(src.trackingQuality * 100);
  const minKneeText = src.minKneeObserved !== null ? `${Math.round(src.minKneeObserved)}°` : "無法判讀（幾乎沒偵測到人）";

  return [
    {
      role: "system",
      content:
        "你是一個健身動作教練助理。你只能根據使用者提供的數據講評，絕對不能捏造任何未提供的數字或事實，不能做醫療診斷或傷病風險判斷，只能描述觀察到的追蹤數據。請用繁體中文回答，語氣正向具體，控制在120字以內，不要條列，寫成一小段話。",
    },
    {
      role: "user",
      content: `這段影片沒有偵測到任何一次「完整達標」的深蹲（判定門檻是膝角 ${src.bottomAngle}°，理想深度是 ${src.goodDepthAngle}° 以下）。以下是僅有的觀察數據：

影片涵蓋時長：${src.durationCovered.toFixed(1)} 秒
追蹤品質（成功偵測到人物的畫面比例）：${qualityPct}%
過程中觀察到的最低膝角（不論是否達標）：${minKneeText}

請根據以上數據，簡短說明可能原因並給建議（例如追蹤品質不足、或動作深度不夠），不要超出這些數據做推測。`,
    },
  ];
}

async function runChat(messages, sourceData, { onProgress, onToken } = {}) {
  if (!supported()) {
    const err = new Error("此瀏覽器不支援 WebGPU，無法執行本機 AI 講評模型。建議使用最新版 Chrome 或 Edge（桌面版）。");
    err.code = "UNSUPPORTED";
    throw err;
  }

  const engine = await getEngine(onProgress);

  try {
    const stream = await engine.chat.completions.create({
      messages,
      temperature: 0.6,
      stream: true,
    });

    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        full += delta;
        onToken && onToken(full);
      }
    }
    return { text: full.trim(), sourceData };
  } catch (err) {
    // "Object has already been disposed" / lost WebGPU device — the
    // cached engine is dead. Drop it so the NEXT click rebuilds a fresh
    // one instead of hitting the same dead object forever.
    if (/dispos|lost|device/i.test(err.message || "")) {
      resetEngine();
      err.message = `${err.message}（本機 AI 執行環境中斷，請再點一次「產生 AI 講評」重試，會重新初始化模型）`;
    }
    throw err;
  }
}

/**
 * @param {object} summary  computeSummary() result (must be non-null — caller checks)
 * @param {object} cfg      CONFIG
 * @param {object} hooks
 * @param {(report:{progress:number,text:string})=>void} hooks.onProgress  model download/load progress
 * @param {(partialText:string)=>void} hooks.onToken  streamed partial output
 * @returns {Promise<{text: string, sourceData: object}>} final commentary text + the exact data it was based on
 */
export async function generateCommentary(summary, cfg, hooks = {}) {
  const sourceData = buildSourceData(summary, cfg);
  return runChat(buildMessages(sourceData), sourceData, hooks);
}

/**
 * Same idea as generateCommentary, but for the "0 reps counted" case —
 * still grounded in real (if sparse) tracking data, never invented.
 * @param {object} diagnostics      report.js's computeZeroRepDiagnostics() result
 * @param {number} trackingQuality  report.js's computeTrackingQuality() result
 * @param {object} cfg              CONFIG
 */
export async function generateNoRepCommentary(diagnostics, trackingQuality, cfg, hooks = {}) {
  const sourceData = buildNoRepSourceData(diagnostics, trackingQuality, cfg);
  return runChat(buildNoRepMessages(sourceData), sourceData, hooks);
}
