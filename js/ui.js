// ============================================================
// ui.js — "Realtime UI" box: DOM elements & render helpers shared by
// BOTH modes (mode selection, stage/video/canvas, shared metric tiles,
// webcam-specific controls + rep log + summary modal). Video-upload
// specific panels (upload zone, timeline, rep-analysis list, session
// report chart) live in videoReport.js.
// ============================================================

const $ = (id) => document.getElementById(id);

export const els = {
  modeSelect: $("modeSelect"),
  modeWebcamBtn: $("modeWebcamBtn"),
  modeVideoBtn: $("modeVideoBtn"),
  appMain: $("appMain"),
  btnChangeMode: $("btnChangeMode"),
  modeTag: $("modeTag"),

  video: $("video"),
  overlay: $("overlay"),
  stage: $("stage"),
  stagePlaceholder: $("stagePlaceholder"),

  webcamControls: $("webcamControls"),
  btnCamera: $("btnCamera"),
  btnStart: $("btnStart"),
  btnStop: $("btnStop"),
  btnRestart: $("btnRestart"),

  statusLine: $("statusLine"),
  errorBanner: $("errorBanner"),

  repCount: $("repCount"),
  phaseBadge: $("phaseBadge"),
  kneeAngle: $("kneeAngle"),
  hipAngle: $("hipAngle"),
  trunkAngle: $("trunkAngle"),
  sideTag: $("sideTag"),

  feedback: $("feedback"),

  repLogCard: $("repLogCard"),
  repLog: $("repLog"),

  summaryOverlay: $("summaryOverlay"),
  summaryBody: $("summaryBody"),
  btnCloseSummary: $("btnCloseSummary"),
};

export function showModeSelect() {
  els.modeSelect.hidden = false;
  els.appMain.hidden = true;
}

/** mode: "webcam" | "video", exerciseLabel: e.g. "🦵 SQUAT" | "💪 DEADLIFT" */
export function enterMode(mode, exerciseLabel = "") {
  els.modeSelect.hidden = true;
  els.appMain.hidden = false;
  const modeText = mode === "webcam" ? "📷 WEBCAM" : "🎬 VIDEO UPLOAD";
  els.modeTag.textContent = exerciseLabel ? `${exerciseLabel} · ${modeText}` : modeText;
  els.webcamControls.hidden = mode !== "webcam";
  els.repLogCard.hidden = mode !== "webcam";
}

export function showError(message) {
  els.errorBanner.textContent = message;
  els.errorBanner.hidden = false;
}

export function clearError() {
  els.errorBanner.hidden = true;
  els.errorBanner.textContent = "";
}

export function setStatus(text) {
  els.statusLine.textContent = text;
}

export function setButtonState({ camera, start, stop, restart }) {
  els.btnCamera.disabled = !camera;
  els.btnStart.disabled = !start;
  els.btnStop.disabled = !stop;
  els.btnRestart.disabled = !restart;
}

export function setAngles(knee, hip, trunk) {
  els.kneeAngle.textContent = knee === null ? "--" : `${Math.round(knee)}°`;
  els.hipAngle.textContent = hip === null ? "--" : `${Math.round(hip)}°`;
  els.trunkAngle.textContent = trunk === null ? "--" : `${Math.round(trunk)}°`;
}

export function setSide(side, visible) {
  if (!visible || !side) {
    els.sideTag.textContent = "NO SIGNAL";
    els.sideTag.dataset.state = "off";
  } else {
    els.sideTag.textContent = `${side.toUpperCase()} SIDE`;
    els.sideTag.dataset.state = "on";
  }
}

export function setRepCount(n) {
  els.repCount.textContent = String(n);
}

export function setPhase(phase) {
  els.phaseBadge.textContent = phase;
  els.phaseBadge.dataset.phase = phase;
}

export function setFeedback(text, level) {
  if (els.feedback.textContent === text) return; // avoid re-triggering CSS pulse
  els.feedback.textContent = text;
  els.feedback.dataset.level = level;
  els.feedback.classList.remove("pulse");
  void els.feedback.offsetWidth; // restart the CSS animation
  els.feedback.classList.add("pulse");
}

export function renderRepLog(reps, exercise = "squat") {
  if (!reps.length) {
    els.repLog.innerHTML = `<li class="rep-empty">No reps recorded yet.</li>`;
    return;
  }
  els.repLog.innerHTML = reps
    .map((r) => {
      const depthLabel = exercise === "deadlift"
        ? `Min Hip ${Math.round(r.minHip)}°`
        : `Min Knee ${Math.round(r.minKnee)}°`;
      return `<li>
        <span class="rep-idx">Rep ${r.index}</span>
        <span class="rep-detail">Duration ${r.duration.toFixed(1)} s</span>
        <span class="rep-detail">${depthLabel}</span>
      </li>`;
    })
    .join("");
  els.repLog.scrollTop = els.repLog.scrollHeight;
}

export function showSummary(summary) {
  if (!summary) {
    els.summaryBody.innerHTML = `<p class="rep-empty">No reps were recorded this session.</p>`;
  } else {
    const isDL = summary.exercise === "deadlift";
    const trends = (summary.trendNotes || [])
      .map((t) => `<p class="summary-trend">⚠️ ${t}</p>`)
      .join("");
    els.summaryBody.innerHTML = `
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
          <span class="summary-label">${isDL ? "Best Hip Depth" : "Deepest Squat"}</span>
          <span class="summary-value">${Math.round(summary.deepest)}°</span>
        </div>
        <div class="summary-tile">
          <span class="summary-label">${isDL ? "Avg Hip Depth" : "Average Depth"}</span>
          <span class="summary-value">${Math.round(summary.avgDepth)}°</span>
        </div>
        <div class="summary-tile">
          <span class="summary-label">Consistency</span>
          <span class="summary-value">${Math.round(summary.consistencyPct)}%</span>
        </div>
      </div>
      ${trends}
      <ol class="summary-reps">
        ${summary.reps
          .map((r) => {
            const val = isDL ? r.minHip : r.minKnee;
            return `<li><span>#${r.index}</span><span>${Math.round(val)}°</span></li>`;
          })
          .join("")}
      </ol>
      <p class="summary-disclaimer">Heuristic prototype — not a medical or injury assessment.</p>
    `;
  }
  els.summaryOverlay.hidden = false;
}

export function hideSummary() {
  els.summaryOverlay.hidden = true;
}

export function resizeCanvasToVideo() {
  const { video, overlay } = els;
  if (!video.videoWidth) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
}
