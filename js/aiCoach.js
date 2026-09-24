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
// Human-readable labels for the four computeQualityScore() sub-dimensions.
const DIMENSION_LABELS = { depth: "深度", consistency: "一致性", tempo: "節奏", stability: "穩定性" };

/**
 * Picks the lowest-scoring sub-dimension deterministically in JS rather
 * than asking the (small, on-device) model to find the minimum of four
 * numbers itself — that arithmetic step is exactly the kind of thing a
 * 0.5B-3B local model unreliably gets wrong, defaulting to a generic
 * "improve your depth" template regardless of what the numbers actually
 * say. Pre-computing it here and stating it explicitly in the prompt
 * removes that failure mode entirely.
 */
function findWeakestDimension(qualityScore) {
  if (!qualityScore) return null;
  const entries = Object.entries(qualityScore.breakdown);
  const [key, value] = entries.reduce((min, e) => (e[1] < min[1] ? e : min));
  // All four sub-scores are strong (or tied) — there's no real weak point
  // to point at. Returning one anyway (picked only by object key order)
  // would force a fabricated "here's your flaw" narrative onto a
  // genuinely strong result, which is the same kind of number/text
  // mismatch this whole mechanism exists to prevent.
  const NO_WEAKNESS_THRESHOLD = 22; // out of 25 (88%)
  if (value >= NO_WEAKNESS_THRESHOLD) return null;
  return { key, label: DIMENSION_LABELS[key] || key, value };
}

export function buildSourceData(summary, cfg) {
  const isDL = summary.exercise === "deadlift";
  const bottomAngle = isDL ? cfg.deadlift.bottomHipAngle : cfg.bottomAngle;
  const goodDepthAngle = isDL ? cfg.deadlift.goodDepthHipAngle : cfg.goodDepthAngle;
  const depthField = isDL ? "minHip" : "minKnee";
  const qualityScore = computeQualityScore(summary, cfg);
  return {
    exercise: isDL ? "deadlift" : "squat",
    totalReps: summary.totalReps,
    avgRepTime: summary.avgRepTime,
    avgDepth: summary.avgDepth,
    deepest: summary.deepest,
    consistencyPct: summary.consistencyPct,
    trendNotes: summary.trendNotes || [],
    bottomAngle,
    goodDepthAngle,
    reps: summary.reps.map((r) => ({ index: r.index, depth: r[depthField], duration: r.duration })),
    qualityScore,
    weakestDimension: findWeakestDimension(qualityScore),
  };
}

function buildMessages(src) {
  const isDL = src.exercise === "deadlift";
  const angleLabel = isDL ? "髖角" : "膝角";
  const exerciseLabel = isDL ? "硬舉" : "深蹲";
  const repsLine = src.reps
    .map((r) => `第${r.index}下：最低${angleLabel} ${Math.round(r.depth)}°，耗時 ${r.duration.toFixed(1)} 秒`)
    .join("；");
  const trends = src.trendNotes.length ? src.trendNotes.join("；") : "無明顯趨勢";

  const qs = src.qualityScore;
  const scoreLine = qs
    ? `動作品質評分：${qs.total}/100（深度 ${qs.breakdown.depth}/25、一致性 ${qs.breakdown.consistency}/25、節奏 ${qs.breakdown.tempo}/25、穩定性 ${qs.breakdown.stability}/25）`
    : "";
  const weakLine = src.weakestDimension
    ? `本次四項分數中最弱的是「${src.weakestDimension.label}」（${src.weakestDimension.value}/25）。你的講評必須針對「${src.weakestDimension.label}」這一項給建議，不可以指稱其他分項是弱點（例如分數不是最低的深度或其他項目），也不可以自己另外判斷哪項最弱。`
    : qs
    ? `本次四項分數都很平衡且偏高，沒有明顯弱點。請直接給予正向肯定，最多附帶一個「維持水準」的小提醒，絕對不可以為了講評而捏造或誇大任何弱點。`
    : "";

  return [
    {
      role: "system",
      content:
        "你是一個健身動作教練助理。你只能根據使用者提供的數據講評，絕對不能捏造任何未提供的數字或事實，不能做醫療診斷或傷病風險判斷，只能描述觀察到的動作數據趨勢。使用者已經明確告訴你哪一個分項最弱，你必須完全依照指定的分項給建議，不能自己重新判斷或挑選別的分項。請用繁體中文回答，語氣正向具體，控制在120字以內，不要條列，寫成一小段話。",
    },
    {
      role: "user",
      content: `這是一組側面${exerciseLabel}訓練的數據，判定深度門檻是${angleLabel} ${src.bottomAngle}°（達標才算一下），理想深度是 ${src.goodDepthAngle}° 以下：

總下數：${src.totalReps}
平均每下時間：${src.avgRepTime.toFixed(1)} 秒
平均最低${angleLabel}：${Math.round(src.avgDepth)}°
最深一下：${Math.round(src.deepest)}°
一致性：${Math.round(src.consistencyPct)}%
${scoreLine}
${weakLine}
規則系統偵測到的趨勢：${trends}
每一下明細：${repsLine}

請給我簡短講評，針對上面指定的最弱分項給出一個具體建議。不要重複列出任何數字，只說明觀察到的問題和改善方向。`,
    },
  ];
}

/**
 * Diagnostics available even when 0 valid reps were counted — still real
 * numbers computed by the rule-based engine (report.js's
 * computeZeroRepDiagnostics + the tracking-quality ratio), never invented.
 */
export function buildNoRepSourceData(diagnostics, trackingQuality, cfg, exercise = "squat") {
  const isDL = exercise === "deadlift";
  const bottomAngle = isDL ? cfg.deadlift.bottomHipAngle : cfg.bottomAngle;
  const goodDepthAngle = isDL ? cfg.deadlift.goodDepthHipAngle : cfg.goodDepthAngle;
  const minObserved = diagnostics.minObserved;

  // Deterministically classify the likely cause instead of leaving it to
  // the model to guess from raw numbers — a small local LLM will happily
  // say "depth wasn't deep enough" even when minObserved already proves
  // the depth WAS reached, because "go deeper" is an extremely common
  // squat-coaching phrase in its training data and it pattern-matches to
  // that regardless of what the numbers actually show.
  let likelyReason;
  if (minObserved === null) {
    likelyReason = "no_person"; // never reliably tracked a person at all
  } else if (minObserved <= goodDepthAngle) {
    likelyReason = "depth_was_fine"; // depth is proven NOT the cause
  } else if (minObserved > bottomAngle) {
    likelyReason = "too_shallow"; // never even reached the counting threshold
  } else {
    likelyReason = "borderline"; // passed the counting threshold but not confirmed as a full rep
  }

  return {
    exercise: isDL ? "deadlift" : "squat",
    trackingQuality,
    minObserved,
    durationCovered: diagnostics.durationCovered,
    bottomAngle,
    goodDepthAngle,
    likelyReason,
  };
}

const NO_REP_REASON_INSTRUCTIONS = {
  no_person: "整段影片幾乎沒有穩定偵測到人物，請把原因歸咎於追蹤/拍攝問題（例如鏡頭角度、遮擋、距離），不要提到動作深度。",
  depth_was_fine:
    "過程中觀察到的最低角度已經達到甚至超越理想深度門檻，代表深度並不是沒偵測到完整動作的原因，絕對不可以說「深度不夠」或建議「蹲更深/hinge更深」。請改成推測是追蹤品質不穩定、動作沒有回到起始站姿、或動作被中斷等原因，並建議如何拍出更完整連續的畫面。",
  too_shallow: "過程中觀察到的最低角度離達標門檻還有一段距離，深度不足確實可能是原因之一，可以提到需要增加動作幅度。",
  borderline: "過程中觀察到的最低角度已經非常接近達標門檻，深度應該不是主要問題，比較可能是動作太快、追蹤不連續、或沒有在低點停留足夠時間，請優先從這些角度推測原因。",
};

function buildNoRepMessages(src) {
  const isDL = src.exercise === "deadlift";
  const angleLabel = isDL ? "髖角" : "膝角";
  const exerciseLabel = isDL ? "硬舉" : "深蹲";
  const qualityPct = Math.round(src.trackingQuality * 100);
  const minText = src.minObserved !== null ? `${Math.round(src.minObserved)}°` : "無法判讀（幾乎沒偵測到人）";
  const reasonHint = NO_REP_REASON_INSTRUCTIONS[src.likelyReason] || "";

  return [
    {
      role: "system",
      content:
        "你是一個健身動作教練助理。你只能根據使用者提供的數據講評，絕對不能捏造任何未提供的數字或事實，不能做醫療診斷或傷病風險判斷，只能描述觀察到的追蹤數據。使用者會明確告訴你這次最可能的原因方向，你必須照著那個方向講，不能自己另外判斷或跟指示矛盾。請用繁體中文回答，語氣正向具體，控制在120字以內，不要條列，寫成一小段話。",
    },
    {
      role: "user",
      content: `這段影片沒有偵測到任何一次「完整達標」的${exerciseLabel}（判定門檻是${angleLabel} ${src.bottomAngle}°，理想深度是 ${src.goodDepthAngle}° 以下）。以下是僅有的觀察數據：

影片涵蓋時長：${src.durationCovered.toFixed(1)} 秒
追蹤品質（成功偵測到人物的畫面比例）：${qualityPct}%
過程中觀察到的最低${angleLabel}（不論是否達標）：${minText}

${reasonHint}

請根據以上數據跟原因方向，簡短說明可能原因並給建議，不要超出這些數據做推測。`,
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
export async function generateNoRepCommentary(diagnostics, trackingQuality, cfg, hooks = {}, exercise = "squat") {
  const sourceData = buildNoRepSourceData(diagnostics, trackingQuality, cfg, exercise);
  return runChat(buildNoRepMessages(sourceData), sourceData, hooks);
}
