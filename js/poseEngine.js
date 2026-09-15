// ============================================================
// poseEngine.js — the "PoseEngine" box in the architecture:
//
//   Input Layer (WebcamInput | VideoInput) -> PoseEngine -> MotionAnalyzer
//
// Wraps the MediaPipe Tasks Vision PoseLandmarker (CURRENT API —
// @mediapipe/tasks-vision — NOT the deprecated @mediapipe/pose package).
// Everything runs on-device via WASM/WebGL; no frame or landmark data
// is ever sent anywhere. A single PoseEngine instance is shared by both
// Webcam mode and Video-upload mode — there is only one inference path.
// https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
// ============================================================

import {
  FilesetResolver,
  PoseLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
import { EMA } from "./angles.js";
import { CONFIG } from "./config.js";

// BlazePose 33-landmark indices we care about (both sides kept).
export const LM = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

// Full-body connection pairs, used only for drawing the skeleton overlay.
export const POSE_CONNECTIONS = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [27, 29],
  [27, 31],
  [29, 31],
  [24, 26],
  [26, 28],
  [28, 30],
  [28, 32],
  [30, 32],
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
];

/**
 * PoseEngine — one shared instance for the whole app. Both WebcamInput
 * (live stream) and VideoInput (uploaded file) feed HTMLVideoElements
 * into the same `detect()` call; the engine itself doesn't know or care
 * which input source a frame came from.
 */
export class PoseEngine {
  constructor() {
    this.landmarker = null;
    this._tsCounter = 0;
  }

  get ready() {
    return !!this.landmarker;
  }

  /**
   * Loads the WASM runtime + model. Tries the GPU delegate first (fast);
   * falls back to CPU if the browser/driver combo can't create a
   * GPU-backed graph.
   */
  async init() {
    const vision = await FilesetResolver.forVisionTasks(CONFIG.visionWasmBase);

    const buildOptions = (delegate) => ({
      baseOptions: {
        modelAssetPath: CONFIG.modelAssetPath,
        delegate,
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: CONFIG.confidenceThreshold,
      minPosePresenceConfidence: CONFIG.confidenceThreshold,
      minTrackingConfidence: CONFIG.confidenceThreshold,
    });

    try {
      this.landmarker = await PoseLandmarker.createFromOptions(vision, buildOptions("GPU"));
    } catch (err) {
      console.warn("[PoseEngine] GPU delegate failed, falling back to CPU:", err);
      this.landmarker = await PoseLandmarker.createFromOptions(vision, buildOptions("CPU"));
    }
  }

  /**
   * Runs pose detection on the current frame of a <video> (webcam stream
   * OR uploaded file — both are just HTMLVideoElements). Returns the raw
   * 33-point landmark array for the first detected person, or null.
   *
   * NOTE: the timestamp passed to MediaPipe only needs to be strictly
   * increasing for a given engine instance (it drives internal
   * tracking/optical-flow, not our own clocks) — we use an internal
   * counter so the SAME engine can be reused across a webcam session and
   * multiple video-upload analyses without timestamp collisions.
   */
  detect(mediaElement) {
    if (!this.landmarker) return null;
    this._tsCounter += 1;
    const result = this.landmarker.detectForVideo(mediaElement, this._tsCounter);
    return (result.landmarks && result.landmarks[0]) || null;
  }
}

/**
 * Given the 33 raw landmarks, pick whichever side (left/right) has higher
 * average visibility across shoulder/hip/knee/ankle, and report whether
 * that side is trustworthy enough to analyze.
 */
export function selectSide(landmarks) {
  const vis = (i) => landmarks[i]?.visibility ?? 0;

  const leftVis =
    (vis(LM.LEFT_SHOULDER) + vis(LM.LEFT_HIP) + vis(LM.LEFT_KNEE) + vis(LM.LEFT_ANKLE)) / 4;
  const rightVis =
    (vis(LM.RIGHT_SHOULDER) + vis(LM.RIGHT_HIP) + vis(LM.RIGHT_KNEE) + vis(LM.RIGHT_ANKLE)) / 4;

  const side = leftVis >= rightVis ? "left" : "right";
  const confidence = side === "left" ? leftVis : rightVis;
  const visible = confidence >= CONFIG.confidenceThreshold;

  const idx =
    side === "left"
      ? {
          shoulder: LM.LEFT_SHOULDER,
          hip: LM.LEFT_HIP,
          knee: LM.LEFT_KNEE,
          ankle: LM.LEFT_ANKLE,
        }
      : {
          shoulder: LM.RIGHT_SHOULDER,
          hip: LM.RIGHT_HIP,
          knee: LM.RIGHT_KNEE,
          ankle: LM.RIGHT_ANKLE,
        };

  return {
    side,
    confidence,
    visible,
    shoulder: landmarks[idx.shoulder],
    hip: landmarks[idx.hip],
    knee: landmarks[idx.knee],
    ankle: landmarks[idx.ankle],
  };
}

/**
 * Per-landmark EMA smoother (Step 4) — keeps one EMA pair (x,y) for each
 * of the 33 points so the skeleton overlay doesn't jitter frame to frame.
 */
export class LandmarkSmoother {
  constructor(alpha = CONFIG.smoothingFactor) {
    this.alpha = alpha;
    this.x = [];
    this.y = [];
  }

  smooth(landmarks) {
    const out = new Array(landmarks.length);
    for (let i = 0; i < landmarks.length; i++) {
      if (!this.x[i]) this.x[i] = new EMA(this.alpha);
      if (!this.y[i]) this.y[i] = new EMA(this.alpha);
      const raw = landmarks[i];
      out[i] = {
        x: this.x[i].next(raw.x),
        y: this.y[i].next(raw.y),
        visibility: raw.visibility,
      };
    }
    return out;
  }

  reset() {
    this.x = [];
    this.y = [];
  }
}

/** Draws the skeleton overlay, highlighting the active analysis side. */
export function drawSkeleton(ctx, landmarks, width, height, activeSide) {
  const toPx = (lm) => ({ x: lm.x * width, y: lm.y * height });

  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  // Faint full-body skeleton in the background.
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(120, 200, 255, 0.35)";
  for (const [a, b] of POSE_CONNECTIONS) {
    const A = landmarks[a];
    const B = landmarks[b];
    if (!A || !B) continue;
    const pa = toPx(A);
    const pb = toPx(B);
    ctx.beginPath();
    ctx.moveTo(pa.x, pa.y);
    ctx.lineTo(pb.x, pb.y);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(180, 220, 255, 0.55)";
  for (const lm of landmarks) {
    if (!lm) continue;
    const p = toPx(lm);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Highlighted analysis chain (shoulder-hip-knee-ankle) on the active side.
  const idx =
    activeSide === "left"
      ? [LM.LEFT_SHOULDER, LM.LEFT_HIP, LM.LEFT_KNEE, LM.LEFT_ANKLE]
      : [LM.RIGHT_SHOULDER, LM.RIGHT_HIP, LM.RIGHT_KNEE, LM.RIGHT_ANKLE];
  const chain = idx.map((i) => landmarks[i]).filter(Boolean);
  if (chain.length === 4) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#39ffb0";
    ctx.beginPath();
    chain.forEach((lm, i) => {
      const p = toPx(lm);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    ctx.fillStyle = "#39ffb0";
    for (const lm of chain) {
      const p = toPx(lm);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0a2a20";
      ctx.stroke();
    }
  }
}
