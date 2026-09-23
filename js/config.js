// ============================================================
// CONFIG — every tunable threshold for AI Motion Coach lives here.
//
// IMPORTANT: These numbers are a *prototype heuristic* for a demo/
// hackathon build. They are NOT a medical, clinical, or biomechanical
// standard, and should not be used to diagnose injury risk or give
// real training prescriptions. Tune them by watching the on-screen
// KNEE / HIP angle readouts while you squat and adjusting to taste.
// ============================================================

export const CONFIG = {
  // ---------------------------------------------------------
  // Pose model (runs 100% locally in the browser via WASM).
  // ---------------------------------------------------------
  visionWasmBase:
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm",
  modelAssetPath:
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",

  // ---------------------------------------------------------
  // Confidence
  // ---------------------------------------------------------
  // Minimum average landmark visibility (0-1) for a body side
  // (shoulder/hip/knee/ankle) to be trusted as "the analysis side".
  // Also used as the model's own min detection/presence/tracking confidence.
  confidenceThreshold: 0.5,

  // ---------------------------------------------------------
  // Smoothing (Step 4)
  // ---------------------------------------------------------
  // Exponential Moving Average factor applied to landmark coordinates
  // AND to the derived joint angles. Lower = smoother but laggier,
  // higher = snappier but more jittery.
  smoothingFactor: 0.35,

  // ---------------------------------------------------------
  // Squat state machine thresholds — knee angle in degrees.
  // hip→knee→ankle angle: ~180° standing tall, smaller = deeper bend.
  // ---------------------------------------------------------
  standingAngle: 165, // knee angle >= this counts as "locked out / standing"
  descendingAngle: 150, // must drop below this to confirm a real descent
  bottomAngle: 110, // knee angle <= this counts as "good depth"
  ascendingHysteresis: 5, // knee must rise this many degrees off its lowest point to confirm the ascent has started

  // A condition must hold for this many *consecutive* frames before the
  // state machine commits to it — this is what stops the phase flickering
  // when the smoothed angle sits right on a threshold.
  stateHoldFrames: 5,

  // A completed STANDING→DESCENDING→BOTTOM→ASCENDING→STANDING cycle only
  // counts as a rep if its total duration falls in this window.
  minimumRepDuration: 0.8, // seconds — guards against detector noise/spikes
  maximumRepDuration: 8.0, // seconds — guards against someone just standing around

  // Coach feedback text is only allowed to change after the newly
  // suggested message has "won" for this many consecutive frames.
  // Prevents the feedback line from flickering every frame.
  feedbackHoldFrames: 10,

  // If the active side's average visibility stays below
  // confidenceThreshold for this many consecutive frames, treat the
  // person as out-of-frame: pause the state machine and abort any
  // in-progress rep without counting it.
  outOfFrameHoldFrames: 8,

  // Session summary: if the 2nd half of a session's average "deepest
  // knee angle" is at least this many degrees LARGER (i.e. shallower)
  // than the 1st half, flag a movement-trend note (never a medical claim).
  depthTrendDegreesThreshold: 8,

  // If the 2nd half's average rep duration is at least this % shorter
  // than the 1st half's, flag a "getting faster" movement-trend note.
  durationTrendPercentThreshold: 20,

  // A counted rep (minKnee <= bottomAngle) is tiered for the Rep
  // Analysis list / timeline: minKnee <= goodDepthAngle => 🟢,
  // otherwise (still counted, but shallower) => 🟡. Purely cosmetic
  // tiering on top of the state machine's pass/fail depth gate.
  goodDepthAngle: 97,

  // ---------------------------------------------------------
  // Video upload analysis (Section 五 / 十三)
  // ---------------------------------------------------------
  acceptedVideoTypes: ["video/mp4", "video/quicktime", "video/webm"],
  acceptedVideoExtensions: [".mp4", ".mov", ".webm"],

  // Target sampling rate for the automated full-video analysis pass.
  // Doesn't need to match the video's native FPS — rep detection just
  // needs "enough" samples, not every single frame.
  videoAnalysisTargetFps: 12,
  videoAnalysisMinFps: 5, // floor the adaptive throttle will not go below

  // Attempted HTMLVideoElement.playbackRate during the automated pass,
  // so analyzing a video doesn't take as long as watching it in real
  // time. Falls back to 1x automatically if the browser rejects it.
  videoAnalysisPlaybackRate: 4,

  // Width (seconds) of each Analysis Timeline segment.
  timelineBucketSeconds: 2,

  // Minimum fraction of sampled frames in a timeline bucket that must
  // see a trustworthy pose before the bucket counts as "tracked" rather
  // than "🔴 lost tracking / no person visible".
  timelineVisibilityRatio: 0.5,

  // If less than this fraction of the WHOLE video's sampled frames saw a
  // trustworthy pose, surface the filming tips again after analysis —
  // the low rep count is probably a filming/tracking issue, not the user.
  filmingTipsQualityThreshold: 0.7,

  // ---------------------------------------------------------
  // Optional AI Coach Commentary (opt-in, Session Report only)
  // ---------------------------------------------------------
  // Runs a SMALL language model entirely in-browser via WebGPU
  // (@mlc-ai/web-llm) to turn the already-computed stats into a short
  // natural-language coaching note. Nothing is sent to any server —
  // the model weights are downloaded once from a public CDN and cached
  // by the browser, same as the pose model. The LLM only ever sees the
  // pre-computed summary numbers below, never raw video or landmarks,
  // so it cannot affect rep counting or any of the deterministic stats.
  aiCoachCdnUrl: "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm",
  // NOTE: using the q4f32_1 (fp32) build, not q4f16_1. The f16 build is a
  // smaller download but needs the GPU's "shader-f16" WebGPU feature,
  // which plenty of otherwise-fine GPUs don't expose — it fails with a
  // generic "Unable to find a compatible GPU" even though WebGPU itself
  // works. f32 is ~1GB (vs ~500MB) but runs on any WebGPU-capable GPU.
  aiCoachModelId: "Qwen2.5-3B-Instruct-q4f32_1-MLC",
};
