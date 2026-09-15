// ============================================================
// main.js — wires the architecture together:
//
//   Input Layer (WebcamInput | VideoInput)
//        -> PoseEngine -> MotionAnalyzer -> SquatDetector -> Results
//        -> Realtime UI (ui.js) / Video Report (videoReport.js)
//
// PoseEngine, MotionAnalyzer and SquatDetector are each a SINGLE shared
// instance used by both modes — there is exactly one analysis pipeline.
// ============================================================

import { CONFIG } from "./config.js";
import { PoseEngine, drawSkeleton } from "./poseEngine.js";
import { MotionAnalyzer } from "./motionAnalyzer.js";
import { SquatDetector, computeSummary } from "./squatDetector.js";
import { WebcamInput, mapCameraError } from "./webcamInput.js";
import { VideoInput } from "./videoInput.js";
import { VideoAnalysisController } from "./videoAnalysisController.js";
import { computeTrackingQuality } from "./report.js";
import * as ui from "./ui.js";
import * as videoReport from "./videoReport.js";

// ---------------------------------------------------------
// Shared pipeline (Section 十四 architecture)
// ---------------------------------------------------------
const engine = new PoseEngine();
const motion = new MotionAnalyzer(CONFIG);
const squat = new SquatDetector(CONFIG);
const videoAnalysis = new VideoAnalysisController({ engine, motion, squat, cfg: CONFIG });

const webcamInput = new WebcamInput(ui.els.video);
const videoInput = new VideoInput(ui.els.video);

const ctx = ui.els.overlay.getContext("2d");

// Kick off model loading immediately, in the background, regardless of
// which mode the user eventually picks.
let engineLoadError = null;
const enginePromise = engine.init().catch((err) => {
  engineLoadError = err;
  console.error("[main] PoseEngine failed to load:", err);
});

let currentMode = null; // "webcam" | "video"

// ===========================================================
// Mode switching
// ===========================================================
function teardownMode() {
  stopWebcamLoop();
  stopVideoPreviewLoop();
  videoAnalysis.stop();
  if (webcamInput.active) webcamInput.stop();
  videoInput.destroy();

  const video = ui.els.video;
  video.pause();
  video.removeAttribute("src");
  video.srcObject = null;
  video.load();

  motion.reset();
  squat.reset();

  ui.els.stagePlaceholder.style.display = "flex";
  ctx.clearRect(0, 0, ui.els.overlay.width, ui.els.overlay.height);
  ui.clearError();
  ui.setStatus("Idle");
  ui.setRepCount(0);
  ui.setPhase("STANDING");
  ui.setAngles(null, null, null);
  ui.setFeedback("⚪ Stand in frame", "neutral");
  ui.setSide(null, false);
  ui.hideSummary();
  ui.setButtonState({ camera: true, start: false, stop: false, restart: false });

  videoReport.leaveVideoMode();
  hasAnalyzed = false;
  lastAnalysisFrames = [];
  lastReps = [];
}

ui.els.modeWebcamBtn.addEventListener("click", () => {
  teardownMode();
  currentMode = "webcam";
  ui.enterMode("webcam");
});

ui.els.modeVideoBtn.addEventListener("click", () => {
  teardownMode();
  currentMode = "video";
  ui.enterMode("video");
  videoReport.enterVideoMode();
  videoReport.setVideoControlsEnabled({ play: false, pause: false, seekStart: false, analyze: false });
});

ui.els.btnChangeMode.addEventListener("click", () => {
  teardownMode();
  currentMode = null;
  ui.showModeSelect();
});

// ===========================================================
// WEBCAM MODE
// ===========================================================
let webcamLoopId = null;
let lastWebcamVideoTime = -1;
let lastWebcamRepCount = 0;

async function openCamera() {
  ui.clearError();
  ui.setStatus("Requesting camera permission…");
  ui.els.btnCamera.disabled = true;

  try {
    await webcamInput.start();
  } catch (err) {
    ui.els.btnCamera.disabled = false;
    ui.setStatus("Idle");
    ui.showError(mapCameraError(err));
    return;
  }

  ui.els.stagePlaceholder.style.display = "none";
  ui.resizeCanvasToVideo();
  ui.setStatus("Loading AI model (on-device)…");

  await enginePromise;
  if (!engine.ready) {
    ui.showError(
      "❌ Failed to load the local pose model. Check your internet connection (needed once, to fetch the model/WASM files) and reload the page."
    );
    ui.setStatus("Model failed to load");
    return;
  }

  ui.setStatus("Model ready — press Start Training");
  ui.setButtonState({ camera: false, start: true, stop: false, restart: true });

  motion.reset();
  squat.reset();
  lastWebcamVideoTime = -1;
  lastWebcamRepCount = 0;
  stopWebcamLoop();
  webcamLoop();
}

function webcamLoop() {
  webcamLoopId = requestAnimationFrame(webcamLoop);
  const video = ui.els.video;
  if (!engine.ready || video.readyState < 2) return;
  if (video.currentTime === lastWebcamVideoTime) return;
  lastWebcamVideoTime = video.currentTime;

  const raw = engine.detect(video);
  const frame = motion.analyze(raw, video.videoWidth, video.videoHeight);

  drawSkeleton(ctx, frame.landmarks, ui.els.overlay.width, ui.els.overlay.height, frame.side);
  ui.setSide(frame.side, frame.visible);
  ui.setAngles(frame.kneeAngle, frame.hipAngle, frame.trunkAngle);

  const out = squat.update({
    kneeAngle: frame.kneeAngle,
    hipAngle: frame.hipAngle,
    visible: frame.visible,
    timeSec: performance.now() / 1000,
  });
  ui.setPhase(out.phase);
  ui.setRepCount(out.repCount);
  ui.setFeedback(out.feedback.text, out.feedback.level);
  if (out.repCount !== lastWebcamRepCount) {
    lastWebcamRepCount = out.repCount;
    ui.renderRepLog(out.reps);
  }
}

function stopWebcamLoop() {
  if (webcamLoopId) cancelAnimationFrame(webcamLoopId);
  webcamLoopId = null;
}

function startTraining() {
  squat.setActive(true);
  lastWebcamRepCount = 0;
  ui.renderRepLog([]);
  ui.hideSummary();
  ui.setRepCount(0);
  ui.setStatus("Training in progress…");
  ui.setButtonState({ camera: false, start: false, stop: true, restart: true });
}

function stopTraining() {
  squat.setActive(false);
  ui.setStatus("Training stopped — session summary below");
  ui.setButtonState({ camera: false, start: true, stop: false, restart: true });
  ui.showSummary(computeSummary(squat.reps, CONFIG));
}

function restartWebcam() {
  squat.reset();
  lastWebcamRepCount = 0;
  ui.hideSummary();
  ui.renderRepLog([]);
  ui.setRepCount(0);
  ui.setPhase("STANDING");
  ui.setFeedback("⚪ Stand in frame", "neutral");
  ui.setStatus(engine.ready ? "Model ready — press Start Training" : "Idle");
  ui.setButtonState({ camera: false, start: engine.ready, stop: false, restart: true });
}

ui.els.btnCamera.addEventListener("click", openCamera);
ui.els.btnStart.addEventListener("click", startTraining);
ui.els.btnStop.addEventListener("click", stopTraining);
ui.els.btnRestart.addEventListener("click", restartWebcam);
ui.els.btnCloseSummary.addEventListener("click", ui.hideSummary);

// ===========================================================
// VIDEO UPLOAD MODE
// ===========================================================
let hasAnalyzed = false;
let lastAnalysisFrames = [];
let lastReps = [];
let videoLoopHandle = null;
let lastPreviewVideoTime = -1;

function nearestAnalysisFrame(frames, t, tolerance) {
  let best = null;
  let bestDiff = Infinity;
  for (const f of frames) {
    const d = Math.abs(f.timestamp - t);
    if (d < bestDiff) {
      bestDiff = d;
      best = f;
    }
  }
  return bestDiff <= tolerance ? best : null;
}

function videoPreviewFrame() {
  scheduleVideoPreview();
  if (videoAnalysis.running) return; // the analysis controller draws its own frames

  const video = ui.els.video;
  if (video.readyState < 2) return;

  if (hasAnalyzed) {
    const frame = nearestAnalysisFrame(lastAnalysisFrames, video.currentTime, 0.3);
    if (frame) {
      drawSkeleton(ctx, frame.landmarks, ui.els.overlay.width, ui.els.overlay.height, frame.side);
      ui.setSide(frame.side, frame.visible);
      ui.setAngles(frame.kneeAngle, frame.hipAngle, frame.trunkAngle);
      ui.setPhase(frame.phase);
    } else {
      ctx.clearRect(0, 0, ui.els.overlay.width, ui.els.overlay.height);
      ui.setSide(null, false);
    }
    return;
  }

  // Live preview before the official analysis pass has been run.
  if (!engine.ready) return;
  if (video.currentTime === lastPreviewVideoTime) return;
  lastPreviewVideoTime = video.currentTime;

  const raw = engine.detect(video);
  const frame = motion.analyze(raw, video.videoWidth, video.videoHeight);
  drawSkeleton(ctx, frame.landmarks, ui.els.overlay.width, ui.els.overlay.height, frame.side);
  ui.setSide(frame.side, frame.visible);
  ui.setAngles(frame.kneeAngle, frame.hipAngle, frame.trunkAngle);

  const out = squat.update({
    kneeAngle: frame.kneeAngle,
    hipAngle: frame.hipAngle,
    visible: frame.visible,
    timeSec: video.currentTime,
  });
  ui.setPhase(out.phase);
}

function scheduleVideoPreview() {
  if (currentMode !== "video") return;
  const video = ui.els.video;
  if (typeof video.requestVideoFrameCallback === "function") {
    videoLoopHandle = video.requestVideoFrameCallback(videoPreviewFrame);
  } else {
    videoLoopHandle = requestAnimationFrame(videoPreviewFrame);
  }
}

function startVideoPreviewLoop() {
  stopVideoPreviewLoop();
  scheduleVideoPreview();
}

function stopVideoPreviewLoop() {
  const video = ui.els.video;
  if (videoLoopHandle != null) {
    if (typeof video.cancelVideoFrameCallback === "function") {
      video.cancelVideoFrameCallback(videoLoopHandle);
    } else {
      cancelAnimationFrame(videoLoopHandle);
    }
  }
  videoLoopHandle = null;
}

async function handleVideoFile(file) {
  ui.clearError();
  try {
    await videoInput.loadFile(file);
  } catch (err) {
    ui.showError(err.message || String(err));
    return;
  }

  motion.reset();
  squat.reset();
  hasAnalyzed = false;
  lastAnalysisFrames = [];
  lastReps = [];
  lastPreviewVideoTime = -1;

  videoReport.setAnalyzeLabel(false);
  videoReport.showVideoLoaded();
  ui.resizeCanvasToVideo();
  ui.setRepCount(0);
  ui.setPhase("STANDING");
  ui.setAngles(null, null, null);
  ui.setFeedback("⚪ Stand in frame", "neutral");
  videoReport.renderRepAnalysisList([], CONFIG, seekTo);
  videoReport.els.sessionReportCard.hidden = true;
  videoReport.els.timelineWrap.hidden = true;
  ui.setStatus('Video loaded — press "Start Analysis"');
  videoReport.setVideoControlsEnabled({ play: true, pause: false, seekStart: true, analyze: true });

  startVideoPreviewLoop();
}

function seekTo(time) {
  if (videoAnalysis.running) return;
  const video = ui.els.video;
  video.pause();
  video.currentTime = Math.max(0, time);
}

function syncPlayPauseButtons() {
  if (currentMode !== "video" || videoAnalysis.running) return;
  const video = ui.els.video;
  const playing = !video.paused && !video.ended;
  videoReport.els.btnPlay.disabled = playing;
  videoReport.els.btnPause.disabled = !playing;
}

async function runAnalysis() {
  ui.clearError();
  ui.setStatus("Loading AI model (on-device)…");
  await enginePromise;
  if (!engine.ready) {
    ui.showError(
      "❌ Failed to load the local pose model. Check your internet connection (needed once, to fetch the model/WASM files) and reload the page."
    );
    ui.setStatus("Model failed to load");
    return;
  }

  stopVideoPreviewLoop();
  videoReport.setVideoControlsEnabled({ play: false, pause: false, seekStart: false, analyze: false });
  videoReport.showProgress();
  videoReport.els.sessionReportCard.hidden = true;
  videoReport.els.timelineWrap.hidden = true;
  ui.setStatus("Analyzing video…");
  ui.setRepCount(0);

  await videoAnalysis.run(ui.els.video, {
    onProgress: ({ progress, fps }) => videoReport.updateProgress({ progress, fps }),
    onFrame: (record, out) => {
      drawSkeleton(ctx, record.landmarks, ui.els.overlay.width, ui.els.overlay.height, record.side);
      ui.setSide(record.side, record.visible);
      ui.setAngles(record.kneeAngle, record.hipAngle, record.trunkAngle);
      ui.setPhase(out.phase);
      ui.setRepCount(out.repCount);
      ui.setFeedback(out.feedback.text, out.feedback.level);
    },
    onComplete: ({ analysisFrames, reps }) => {
      lastAnalysisFrames = analysisFrames;
      lastReps = reps;
      hasAnalyzed = true;
      videoReport.setAnalyzeLabel(true);
      videoReport.hideProgress();
      videoReport.showAnalysisComplete();
      ui.setStatus("Analysis complete");
      ui.setRepCount(reps.length);

      videoReport.renderRepAnalysisList(reps, CONFIG, seekTo);
      videoReport.renderTimeline(analysisFrames, ui.els.video.duration, CONFIG, seekTo);
      const quality = computeTrackingQuality(analysisFrames);
      videoReport.renderSessionReport(computeSummary(reps, CONFIG), CONFIG, quality, analysisFrames);

      videoReport.setVideoControlsEnabled({ play: true, pause: true, seekStart: true, analyze: true });
      startVideoPreviewLoop();
    },
    onError: (msg) => {
      ui.showError(msg);
      ui.setStatus("Analysis failed");
      videoReport.hideProgress();
      videoReport.setVideoControlsEnabled({ play: true, pause: true, seekStart: true, analyze: true });
      startVideoPreviewLoop();
    },
  });
}

videoReport.wireUpload({ onFile: handleVideoFile });
videoReport.els.btnPlay.addEventListener("click", () => ui.els.video.play());
videoReport.els.btnPause.addEventListener("click", () => ui.els.video.pause());
videoReport.els.btnSeekStart.addEventListener("click", () => {
  ui.els.video.pause();
  ui.els.video.currentTime = 0;
});
videoReport.els.btnAnalyze.addEventListener("click", runAnalysis);
ui.els.video.addEventListener("play", syncPlayPauseButtons);
ui.els.video.addEventListener("pause", syncPlayPauseButtons);
ui.els.video.addEventListener("ended", syncPlayPauseButtons);

// ===========================================================
// Boot
// ===========================================================
ui.showModeSelect();
