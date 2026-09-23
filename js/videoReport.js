// ============================================================
// videoReport.js — "Video Report" box: everything specific to the
// Video-upload mode's UI (upload zone, playback controls, progress,
// clickable rep list, clickable timeline, session report + chart).
// Pairs with ui.js (shared elements) the way videoAnalysisController.js
// pairs with the shared PoseEngine/MotionAnalyzer/SquatDetector.
// ============================================================

import {
  formatTime,
  buildTimeline,
  repDepthLevel,
  drawRepChart,
  renderFilmingTipsHTML,
  computeTrackingQuality,
  computeZeroRepDiagnostics,
  computeQualityScore,
} from "./report.js";
import {
  supported as aiCoachSupported,
  generateCommentary as generateAiCommentary,
  generateNoRepCommentary,
} from "./aiCoach.js";
import { saveSession, getSessions, updateSessionCommentary, clearHistory } from "./sessionHistory.js";

const $ = (id) => document.getElementById(id);

export const els = {
  uploadZone: $("uploadZone"),
  btnPickFile: $("btnPickFile"),
  fileInput: $("fileInput"),
  filmingTips: $("filmingTips"),

  videoControls: $("videoControls"),
  btnPlay: $("btnPlay"),
  btnPause: $("btnPause"),
  btnSeekStart: $("btnSeekStart"),
  btnAnalyze: $("btnAnalyze"),

  analysisProgress: $("analysisProgress"),
  progressPct: $("progressPct"),
  progressFill: $("progressFill"),
  analysisFps: $("analysisFps"),
  analysisComplete: $("analysisComplete"),

  timelineWrap: $("timelineWrap"),
  timeline: $("timeline"),

  repAnalysisCard: $("repAnalysisCard"),
  repAnalysisList: $("repAnalysisList"),

  sessionReportCard: $("sessionReportCard"),
  sessionReportBody: $("sessionReportBody"),

  stage: $("stage"),
  stagePlaceholder: $("stagePlaceholder"),

  historyCard: $("historyCard"),
  historyList: $("historyList"),
  btnClearHistory: $("btnClearHistory"),
};

// Rendered once — the upload zone shows these BEFORE the user records/
// picks a video, so bad filming habits get caught before analysis rather
// than diagnosed afterwards.
if (els.filmingTips) {
  els.filmingTips.innerHTML = renderFilmingTipsHTML({ compact: false });
}

export function enterVideoMode() {
  els.uploadZone.hidden = false;
  els.videoControls.hidden = false;
  els.repAnalysisCard.hidden = false;
  els.stage.hidden = true;
}

export function leaveVideoMode() {
  els.uploadZone.hidden = true;
  els.videoControls.hidden = true;
  els.repAnalysisCard.hidden = true;
  els.sessionReportCard.hidden = true;
  els.timelineWrap.hidden = true;
  els.analysisProgress.hidden = true;
  els.analysisComplete.hidden = true;
  els.stage.hidden = false;
}

export function showVideoLoaded() {
  els.uploadZone.hidden = true;
  els.stage.hidden = false;
  els.stagePlaceholder.style.display = "none";
}

export function setVideoControlsEnabled({ play, pause, seekStart, analyze }) {
  els.btnPlay.disabled = !play;
  els.btnPause.disabled = !pause;
  els.btnSeekStart.disabled = !seekStart;
  els.btnAnalyze.disabled = !analyze;
}

export function setAnalyzeLabel(hasAnalyzed) {
  els.btnAnalyze.textContent = hasAnalyzed ? "🔄 Re-analyze" : "🔍 Start Analysis";
}

export function showProgress() {
  els.analysisProgress.hidden = false;
  els.analysisComplete.hidden = true;
}

export function updateProgress({ progress, fps }) {
  const pct = Math.round(progress);
  els.progressPct.textContent = `${pct}%`;
  els.progressFill.style.width = `${pct}%`;
  els.analysisFps.textContent = `${fps} FPS`;
}

export function hideProgress() {
  els.analysisProgress.hidden = true;
}

export function showAnalysisComplete() {
  els.analysisComplete.hidden = false;
}

// ---------------------------------------------------------
// Drag & drop / file picker wiring
// ---------------------------------------------------------
export function wireUpload({ onFile }) {
  els.btnPickFile.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", () => {
    const file = els.fileInput.files && els.fileInput.files[0];
    if (file) onFile(file);
    els.fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((evt) =>
    els.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.uploadZone.classList.add("dragover");
    })
  );
  ["dragleave", "drop"].forEach((evt) =>
    els.uploadZone.addEventListener(evt, (e) => {
      e.preventDefault();
      els.uploadZone.classList.remove("dragover");
    })
  );
  els.uploadZone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

// ---------------------------------------------------------
// Rep Analysis list (Section 七) — click to seek
// ---------------------------------------------------------
export function renderRepAnalysisList(reps, cfg, onSeek) {
  if (!reps.length) {
    els.repAnalysisList.innerHTML = `<li class="rep-empty">No reps detected yet.</li>`;
    return;
  }
  els.repAnalysisList.innerHTML = reps
    .map((r) => {
      const level = repDepthLevel(r, cfg);
      const dot = level === "good" ? "🟢" : "🟡";
      return `
      <li class="rep-clickable" data-start="${r.startTime}">
        <span class="rep-idx">${dot} #${r.index}</span>
        <span class="rep-detail">${formatTime(r.startTime)} – ${formatTime(r.endTime)}</span>
        <span class="rep-detail">Min Knee ${Math.round(r.minKnee)}°</span>
      </li>`;
    })
    .join("");

  els.repAnalysisList.querySelectorAll(".rep-clickable").forEach((li) => {
    li.addEventListener("click", () => onSeek(parseFloat(li.dataset.start)));
  });
}

// ---------------------------------------------------------
// Analysis Timeline (Section 八) — click to seek
// ---------------------------------------------------------
export function renderTimeline(analysisFrames, duration, cfg, onSeek) {
  const buckets = buildTimeline(analysisFrames, duration, cfg);
  if (!buckets.length) {
    els.timelineWrap.hidden = true;
    return;
  }
  els.timelineWrap.hidden = false;
  els.timeline.innerHTML = buckets
    .map(
      (b) =>
        `<div class="timeline-seg" data-status="${b.status}" data-start="${b.startTime}" data-end="${b.endTime}" style="flex-grow:${
          b.endTime - b.startTime
        }" title="${formatTime(b.startTime)} – ${formatTime(b.endTime)}"></div>`
    )
    .join("");

  els.timeline.querySelectorAll(".timeline-seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const rect = seg.getBoundingClientRect();
      const frac = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
      const start = parseFloat(seg.dataset.start);
      const end = parseFloat(seg.dataset.end);
      onSeek(start + frac * (end - start));
    });
  });
}

// ---------------------------------------------------------
// Quality Score Card
// ---------------------------------------------------------
function scoreGrade(total) {
  if (total >= 90) return { label: "S", text: "頂尖" };
  if (total >= 80) return { label: "A", text: "優秀" };
  if (total >= 70) return { label: "B", text: "良好" };
  if (total >= 60) return { label: "C", text: "尚可" };
  if (total >= 50) return { label: "D", text: "需改善" };
  return { label: "F", text: "需加強" };
}

function scoreColor(total) {
  if (total >= 90) return "#39ffb0";
  if (total >= 80) return "#3da9fc";
  if (total >= 70) return "#7ed0a3";
  if (total >= 60) return "#ffb020";
  return "#ff5470";
}

function renderQualityScoreHTML(score) {
  if (!score) return "";
  const { label, text } = scoreGrade(score.total);
  const color = scoreColor(score.total);
  const dims = [
    { label: "深度", key: "depth" },
    { label: "一致性", key: "consistency" },
    { label: "節奏", key: "tempo" },
    { label: "穩定性", key: "stability" },
  ];
  const barsHTML = dims
    .map((d) => {
      const val = score.breakdown[d.key];
      const pct = (val / 25) * 100;
      return `
        <div class="score-dim-row">
          <span class="score-dim-label">${d.label}</span>
          <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%;background:${color}"></div></div>
          <span class="score-dim-val">${val}/25</span>
        </div>`;
    })
    .join("");
  return `
    <div class="quality-score-card">
      <div class="score-header">
        <div>
          <span class="metric-label">QUALITY SCORE</span>
          <div class="score-big" style="color:${color}">${score.total}<span class="score-slash">/100</span></div>
        </div>
        <div class="score-grade" style="border-color:${color};color:${color}">
          ${label}<span class="score-grade-text">${text}</span>
        </div>
      </div>
      <div class="score-dims">${barsHTML}</div>
    </div>`;
}

// ---------------------------------------------------------
// Session History
// ---------------------------------------------------------
function formatTimestamp(iso) {
  const d = new Date(iso);
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${mo}/${da} ${hh}:${mm}`;
}

function renderHistoryCard() {
  const sessions = getSessions();
  if (!sessions.length) {
    els.historyCard.hidden = true;
    return;
  }
  els.historyCard.hidden = false;
  els.historyList.innerHTML = sessions
    .map((s, i) => {
      const qs = s.qualityScore;
      const score = qs ? qs.total : null;
      const color = score == null ? "var(--text-dim)" : scoreColor(score);
      const grade = score != null ? scoreGrade(score) : null;

      // trend vs next entry (which is older, since newest-first)
      let trendHTML = "";
      if (qs && i + 1 < sessions.length && sessions[i + 1].qualityScore) {
        const diff = qs.total - sessions[i + 1].qualityScore.total;
        if (diff > 0) trendHTML = `<span class="hist-trend up">↑ +${diff}</span>`;
        else if (diff < 0) trendHTML = `<span class="hist-trend down">↓ ${diff}</span>`;
        else trendHTML = `<span class="hist-trend flat">— 持平</span>`;
      }

      const commentary = s.aiCommentary
        ? `<p class="hist-commentary">"${s.aiCommentary.slice(0, 60)}${s.aiCommentary.length > 60 ? "…" : ""}"</p>`
        : "";

      return `
        <div class="hist-item">
          <div class="hist-row">
            ${score != null ? `<span class="hist-score" style="color:${color}">${score}<span class="hist-score-grade">${grade.label}</span></span>` : `<span class="hist-score" style="color:var(--text-dim)">—</span>`}
            <div class="hist-meta">
              <span class="hist-date">${formatTimestamp(s.timestamp)}</span>
              <span class="hist-stats">${s.totalReps} 下 · 平均膝角 ${Math.round(s.avgDepth)}° · 一致性 ${Math.round(s.consistencyPct)}%</span>
            </div>
            ${trendHTML}
          </div>
          ${commentary}
        </div>`;
    })
    .join("");
}

if (els.btnClearHistory) {
  els.btnClearHistory.addEventListener("click", () => {
    clearHistory();
    renderHistoryCard();
  });
}

// ---------------------------------------------------------
// Session Report (Section 九/十)
// ---------------------------------------------------------
const AI_COACH_BOX_HTML = `
  <span class="metric-label chart-label">🤖 AI COACH COMMENTARY (optional, on-device)</span>
  <div class="ai-coach-box">
    <button id="btnAiCoach" class="btn btn-ghost">🤖 產生 AI 講評</button>
    <div id="aiCoachOutput" class="ai-coach-output"></div>
  </div>
`;

/**
 * @param {object|null} summary        computeSummary() result, or null if 0 reps
 * @param {object} cfg                 CONFIG
 * @param {number} [trackingQuality]   0-1 fraction of sampled frames that were trustworthy;
 *                                     when below cfg.filmingTipsQualityThreshold, the filming
 *                                     tips are surfaced again so the user knows WHY results
 *                                     may be unreliable, not just that they are.
 * @param {Array} [analysisFrames]     the full per-frame trace, so even a 0-rep result has
 *                                     something concrete (min knee observed, duration covered)
 *                                     for the AI commentary to work with — never invented data.
 */
export function renderSessionReport(summary, cfg, trackingQuality = 1, analysisFrames = []) {
  const lowQuality = trackingQuality < cfg.filmingTipsQualityThreshold;
  const tipsBox = lowQuality
    ? `<p class="summary-trend">⚠️ 這段影片的追蹤品質偏低（約 ${Math.round(
        trackingQuality * 100
      )}% 的畫面成功偵測到人物），結果可能不準確。</p>${renderFilmingTipsHTML({ compact: true })}`
    : "";

  // Always show the card once analysis has run — an empty result is
  // itself a finding, not a reason to show nothing.
  els.sessionReportCard.hidden = false;

  if (!summary) {
    const reason = lowQuality
      ? "No reps were detected — likely because tracking quality was too low (see below)."
      : "No complete squat was detected. Check the timeline below for where the movement started, or the depth may not have reached the counted threshold.";
    const tips = lowQuality ? tipsBox : renderFilmingTipsHTML({ compact: true });
    els.sessionReportBody.innerHTML = `
      <p class="rep-empty">${reason}</p>
      ${tips}
      ${AI_COACH_BOX_HTML}
    `;
    const diagnostics = computeZeroRepDiagnostics(analysisFrames);
    renderHistoryCard();
    wireAiCoachButton({
      generate: (hooks) => generateNoRepCommentary(diagnostics, trackingQuality, cfg, hooks),
      renderSource: renderNoRepSourceHTML,
    });
    return;
  }

  const trends = (summary.trendNotes || []).map((t) => `<p class="summary-trend">⚠️ ${t}</p>`).join("");
  const qualityScore = computeQualityScore(summary, cfg);

  els.sessionReportBody.innerHTML = `
    ${tipsBox}
    ${renderQualityScoreHTML(qualityScore)}
    <div class="summary-grid">
      <div class="summary-tile">
        <span class="summary-label">Total Reps</span>
        <span class="summary-value">${summary.totalReps}</span>
      </div>
      <div class="summary-tile">
        <span class="summary-label">Avg Rep Time</span>
        <span class="summary-value">${summary.avgRepTime.toFixed(1)}s</span>
      </div>
      <div class="summary-tile">
        <span class="summary-label">Avg Min Knee</span>
        <span class="summary-value">${Math.round(summary.avgDepth)}°</span>
      </div>
      <div class="summary-tile">
        <span class="summary-label">Deepest Rep</span>
        <span class="summary-value">${Math.round(summary.deepest)}°</span>
      </div>
      <div class="summary-tile">
        <span class="summary-label">Consistency</span>
        <span class="summary-value">${Math.round(summary.consistencyPct)}%</span>
      </div>
    </div>
    ${trends}
    <span class="metric-label chart-label">REP-BY-REP CHART</span>
    <canvas id="repChart" class="rep-chart"></canvas>
    <p class="summary-disclaimer">Heuristic prototype metrics based on knee-angle tracking only — not a medical or injury assessment.</p>

    ${AI_COACH_BOX_HTML}
  `;

  const canvas = document.getElementById("repChart");
  if (canvas) drawRepChart(canvas, summary.reps, cfg);

  const savedSession = saveSession({
    totalReps: summary.totalReps,
    avgRepTime: summary.avgRepTime,
    avgDepth: summary.avgDepth,
    deepest: summary.deepest,
    consistencyPct: summary.consistencyPct,
    trendNotes: summary.trendNotes || [],
    qualityScore,
  });
  renderHistoryCard();

  wireAiCoachButton({
    generate: (hooks) => generateAiCommentary(summary, cfg, hooks),
    renderSource: renderSourceHTML,
    sessionId: savedSession.id,
  });
}

// ---------------------------------------------------------
// AI Coach Commentary (optional, opt-in — see aiCoach.js)
// ---------------------------------------------------------
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Renders the exact structured data the model was given — the "source" behind the commentary. */
function renderSourceHTML(src) {
  const trends = src.trendNotes.length ? src.trendNotes.join("；") : "（無）";
  const repsLine = src.reps
    .map((r) => `#${r.index} ${Math.round(r.minKnee)}°/${r.duration.toFixed(1)}s`)
    .join("、");
  return `
    <details class="ai-coach-source">
      <summary>📊 講評依據（本次分析的實際數據）</summary>
      <ul>
        <li>總下數：${src.totalReps}</li>
        <li>平均每下時間：${src.avgRepTime.toFixed(1)} 秒</li>
        <li>平均最低膝角：${Math.round(src.avgDepth)}°</li>
        <li>最深一下：${Math.round(src.deepest)}°</li>
        <li>一致性：${Math.round(src.consistencyPct)}%</li>
        <li>判定門檻：達標 ${src.bottomAngle}°／理想深度 ${src.goodDepthAngle}° 以下</li>
        <li>規則系統偵測到的趨勢：${escapeHtml(trends)}</li>
        <li>逐下明細（膝角/耗時）：${escapeHtml(repsLine)}</li>
        ${src.qualityScore ? `<li>動作品質評分：${src.qualityScore.total}/100（深度 ${src.qualityScore.breakdown.depth}／一致性 ${src.qualityScore.breakdown.consistency}／節奏 ${src.qualityScore.breakdown.tempo}／穩定性 ${src.qualityScore.breakdown.stability}）</li>` : ""}
      </ul>
    </details>
  `;
}

/** Renders the "source" for the 0-rep case — sparser, but still real data, never invented. */
function renderNoRepSourceHTML(src) {
  const qualityPct = Math.round(src.trackingQuality * 100);
  const minKneeText = src.minKneeObserved !== null ? `${Math.round(src.minKneeObserved)}°` : "無法判讀（幾乎沒偵測到人）";
  return `
    <details class="ai-coach-source">
      <summary>📊 講評依據（本次分析的實際數據）</summary>
      <ul>
        <li>影片涵蓋時長：${src.durationCovered.toFixed(1)} 秒</li>
        <li>追蹤品質（成功偵測到人物的畫面比例）：${qualityPct}%</li>
        <li>過程中觀察到的最低膝角（不論是否達標）：${minKneeText}</li>
        <li>判定門檻：達標 ${src.bottomAngle}°／理想深度 ${src.goodDepthAngle}° 以下</li>
      </ul>
    </details>
  `;
}

/**
 * @param {object} opts
 * @param {(hooks:object)=>Promise<{text:string, sourceData:object}>} opts.generate  bound to either
 *        generateAiCommentary(summary, cfg, hooks) or generateNoRepCommentary(diagnostics, quality, cfg, hooks)
 * @param {(sourceData:object)=>string} opts.renderSource  matching source-data renderer
 */
function wireAiCoachButton({ generate, renderSource, sessionId }) {
  const btn = document.getElementById("btnAiCoach");
  const output = document.getElementById("aiCoachOutput");
  if (!btn || !output) return;

  btn.addEventListener("click", async () => {
    if (!aiCoachSupported()) {
      output.innerHTML = `<p class="ai-coach-error">⚠️ 此瀏覽器不支援 WebGPU，無法使用本機 AI 講評（建議使用最新版桌面版 Chrome 或 Edge）。</p>`;
      return;
    }

    btn.disabled = true;
    output.innerHTML = `<p class="ai-coach-status">正在載入本機 AI 模型…（僅第一次需要下載，之後會快取；視網路/裝置可能需數十秒至數分鐘）</p>`;

    try {
      const { text, sourceData } = await generate({
        onProgress: (report) => {
          output.innerHTML = `<p class="ai-coach-status">${escapeHtml(report.text || "載入中…")}</p>`;
        },
        onToken: (partial) => {
          output.innerHTML = `<p class="ai-coach-text">${escapeHtml(partial)}</p>`;
        },
      });
      output.innerHTML = `
        <p class="ai-coach-text">${escapeHtml(text)}</p>
        ${renderSource(sourceData)}
        <p class="ai-coach-disclaimer">由本機端小型語言模型（非醫療/專業教練）根據上方數據生成，僅供參考。</p>
      `;
      btn.textContent = "🔄 重新產生講評";
      if (sessionId) {
        updateSessionCommentary(sessionId, text);
        renderHistoryCard();
      }
    } catch (err) {
      console.error("[aiCoach]", err);
      output.innerHTML = `<p class="ai-coach-error">⚠️ AI 講評產生失敗：${escapeHtml(err.message || String(err))}</p>`;
    } finally {
      btn.disabled = false;
    }
  });
}
