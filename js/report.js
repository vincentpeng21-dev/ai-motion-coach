// ============================================================
// report.js — pure helpers for the Video Report UI (Section 八/九/十):
// timeline bucketing, the rep-by-rep chart, and time formatting.
// No DOM lookups by id live here (besides the canvas passed in) so
// these stay easy to reason about independent of page layout.
// ============================================================

// Filming guidance shown to the user so THEY can get a better result,
// rather than us silently tolerating bad input. Shown proactively in the
// upload zone, and again after analysis if tracking quality was poor.
export const FILMING_TIPS = [
  { icon: "📐", text: "鏡頭打正側面（90°），全身從頭到腳都要入鏡" },
  { icon: "🚧", text: "避免槓鈴、龍門架或其他器材擋住肩、髖、膝、腳踝這條側面輪廓線" },
  { icon: "💡", text: "光線盡量均勻，避免逆光、鏡子反光或強烈光源直射鏡頭" },
  { icon: "🎥", text: "鏡頭固定不晃動，避免快速甩動或動態模糊" },
];

export function renderFilmingTipsHTML({ compact = false } = {}) {
  const items = FILMING_TIPS.map((t) => `<li>${t.icon} ${t.text}</li>`).join("");
  const title = compact ? "📋 拍攝建議 Filming Tips" : "📋 FILMING TIPS";
  return `
    <div class="filming-tips-box${compact ? " compact" : ""}">
      <span class="filming-tips-title">${title}</span>
      <ul class="filming-tips-list">${items}</ul>
    </div>
  `;
}

/** Fraction of sampled frames (0-1) where the active side was trustworthy. */
export function computeTrackingQuality(analysisFrames) {
  if (!analysisFrames.length) return 0;
  const visible = analysisFrames.filter((f) => f.visible).length;
  return visible / analysisFrames.length;
}

/**
 * What we still know even when 0 reps were counted — used to give the
 * "No reps detected" AI commentary something concrete to talk about
 * instead of nothing.
 */
export function computeZeroRepDiagnostics(analysisFrames, exercise = "squat") {
  const field = exercise === "deadlift" ? "hipAngle" : "kneeAngle";
  const values = analysisFrames.filter((f) => f.visible && f[field] !== null).map((f) => f[field]);
  const minObserved = values.length ? Math.min(...values) : null;
  const durationCovered = analysisFrames.length ? analysisFrames[analysisFrames.length - 1].timestamp : 0;
  return { minObserved, durationCovered, sampledFrames: analysisFrames.length };
}

function stdDev(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length);
}

/**
 * Computes a 0-100 quality score from four dimensions (25 pts each):
 * depth, consistency, tempo, stability.
 * Returns null if there are no reps to score.
 */
export function computeQualityScore(summary, cfg) {
  const reps = summary.reps;
  if (!reps || reps.length === 0) return null;

  const isDL = summary.exercise === "deadlift";
  const bottomAngle = isDL ? cfg.deadlift.bottomHipAngle : cfg.bottomAngle;
  const goodDepthAngle = isDL ? cfg.deadlift.goodDepthHipAngle : cfg.goodDepthAngle;
  const depthField = isDL ? "minHip" : "minKnee";

  // Depth: smaller angle = deeper = better
  // goodDepthAngle = ideal, bottomAngle = just passing
  const depthScore = Math.max(0, Math.min(25,
    ((bottomAngle - summary.avgDepth) / (bottomAngle - goodDepthAngle)) * 25
  ));

  // Consistency: direct from existing metric
  const consistencyScore = (summary.consistencyPct / 100) * 25;

  // Tempo: ideal 2-4 seconds per rep (controlled movement)
  const t = summary.avgRepTime;
  let tempoScore;
  if (t >= 2.0 && t <= 4.0) tempoScore = 25;
  else if (t < 1.0 || t > 7.0) tempoScore = 0;
  else if (t < 2.0) tempoScore = ((t - 1.0) / 1.0) * 25;
  else tempoScore = Math.max(0, (1 - (t - 4.0) / 3.0) * 25);

  // Stability: variance in depth + variance in tempo across reps
  const depthStd = stdDev(reps.map((r) => r[depthField]));
  const timeStd = stdDev(reps.map((r) => r.duration));
  const stabilityScore =
    Math.max(0, 1 - depthStd / 15) * 12.5 +
    Math.max(0, 1 - timeStd / 1.5) * 12.5;

  const total = Math.min(100, Math.max(0, Math.round(depthScore + consistencyScore + tempoScore + stabilityScore)));
  return {
    total,
    breakdown: {
      depth: Math.round(depthScore),
      consistency: Math.round(consistencyScore),
      tempo: Math.round(tempoScore),
      stability: Math.round(stabilityScore),
    },
  };
}

/** "125.4" seconds -> "2:05.4" */
export function formatTime(totalSeconds) {
  if (totalSeconds === null || totalSeconds === undefined || Number.isNaN(totalSeconds)) return "--:--";
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/**
 * Buckets analysisFrames[] into fixed-width time windows and classifies
 * each as green (normal) / yellow (caution — shallow movement) / red
 * (abnormal — person not tracked). Heuristic only (Section 八).
 */
export function buildTimeline(analysisFrames, duration, cfg) {
  if (!duration || !isFinite(duration) || duration <= 0) return [];

  const bucketLen = cfg.timelineBucketSeconds;
  const bucketCount = Math.max(1, Math.ceil(duration / bucketLen));
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    startTime: i * bucketLen,
    endTime: Math.min(duration, (i + 1) * bucketLen),
    frames: [],
  }));

  for (const f of analysisFrames) {
    const idx = Math.min(bucketCount - 1, Math.max(0, Math.floor(f.timestamp / bucketLen)));
    buckets[idx].frames.push(f);
  }

  return buckets.map(({ frames, startTime, endTime }) => {
    if (!frames.length) return { startTime, endTime, status: "green" };

    const visibleFrames = frames.filter((f) => f.visible);
    const visibleRatio = visibleFrames.length / frames.length;
    if (visibleRatio < cfg.timelineVisibilityRatio) {
      return { startTime, endTime, status: "red" };
    }

    const knees = visibleFrames.map((f) => f.kneeAngle).filter((v) => v !== null && v !== undefined);
    if (!knees.length) return { startTime, endTime, status: "green" };

    const minKnee = Math.min(...knees);
    const status = minKnee <= cfg.descendingAngle && minKnee > cfg.bottomAngle ? "yellow" : "green";
    return { startTime, endTime, status };
  });
}

/** Classifies a completed rep's depth tier for the 🟢/🟡 indicator (Section 七). */
export function repDepthLevel(rep, cfg) {
  return rep.minKnee <= cfg.goodDepthAngle ? "good" : "warn";
}

export function deadliftDepthLevel(rep, cfg) {
  return rep.minHip <= cfg.deadlift.goodDepthHipAngle ? "good" : "warn";
}

/**
 * Draws the Rep-by-Rep Chart: X = rep number, Y = minimum knee angle
 * (Section 九). Plain canvas 2D, no charting library.
 */
export function drawRepChart(canvas, reps, cfg, exercise = "squat") {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = canvas.clientHeight || 160;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  if (!reps.length) return;

  const isDL = exercise === "deadlift";
  const depthField = isDL ? "minHip" : "minKnee";
  const bottomAngle = isDL ? cfg.deadlift.bottomHipAngle : cfg.bottomAngle;
  const goodDepthAngle = isDL ? cfg.deadlift.goodDepthHipAngle : cfg.goodDepthAngle;

  const padding = { top: 14, right: 14, bottom: 26, left: 34 };
  const plotW = cssW - padding.left - padding.right;
  const plotH = cssH - padding.top - padding.bottom;

  const depths = reps.map((r) => r[depthField]);
  const yMin = Math.max(0, Math.min(...depths) - 10);
  const yMax = Math.min(180, Math.max(...depths) + 10);
  const yRange = Math.max(1, yMax - yMin);

  const xForIndex = (i) => padding.left + (plotW * (i + 0.5)) / reps.length;
  const yForAngle = (angle) => padding.top + plotH - ((angle - yMin) / yRange) * plotH;

  // Axes
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding.left, padding.top);
  ctx.lineTo(padding.left, padding.top + plotH);
  ctx.lineTo(padding.left + plotW, padding.top + plotH);
  ctx.stroke();

  // Reference line at the "good depth" gate.
  const refY = yForAngle(bottomAngle);
  ctx.strokeStyle = "rgba(255,176,32,0.5)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(padding.left, refY);
  ctx.lineTo(padding.left + plotW, refY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Bars
  const barW = Math.max(6, (plotW / reps.length) * 0.55);
  reps.forEach((r, i) => {
    const x = xForIndex(i);
    const depth = r[depthField];
    const y = yForAngle(depth);
    const baseY = padding.top + plotH;
    ctx.fillStyle = depth <= goodDepthAngle ? "#39ffb0" : depth <= bottomAngle ? "#ffb020" : "#ff5470";
    ctx.fillRect(x - barW / 2, y, barW, baseY - y);

    ctx.fillStyle = "rgba(234,242,255,0.7)";
    ctx.font = "10px Rajdhani, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(r.index), x, baseY + 14);
  });

  // Y axis labels
  ctx.fillStyle = "rgba(234,242,255,0.5)";
  ctx.font = "10px Rajdhani, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.round(yMax)}°`, padding.left - 6, padding.top + 8);
  ctx.fillText(`${Math.round(yMin)}°`, padding.left - 6, padding.top + plotH);
}
