// ============================================================
// videoAnalysisController.js — drives the automated "Start Analysis"
// full-video pass (Section 五 / 十三).
//
// Plays the uploaded video start-to-end (muted, sped up when the browser
// allows it) and samples frames at a target analysis FPS via
// requestVideoFrameCallback (falling back to rAF + currentTime dedup on
// browsers without it). Each sampled frame goes through the SAME
// PoseEngine -> MotionAnalyzer -> SquatDetector pipeline used by the
// live webcam mode — no separate analysis logic.
//
// This controller is UI-agnostic: it reports progress/frames/completion
// via callbacks so the DOM code (videoReport.js / main.js) stays
// separate from the analysis loop itself.
// ============================================================

export class VideoAnalysisController {
  constructor({ engine, motion, squat, cfg }) {
    this.engine = engine; // PoseEngine (shared, already init()'d)
    this.motion = motion; // MotionAnalyzer (shared)
    this.squat = squat; // SquatDetector (shared)
    this.cfg = cfg;
    this.analysisFrames = [];
    this.running = false;
    this._sampleWallTimes = [];
  }

  stop() {
    this.running = false;
  }

  /**
   * @param {HTMLVideoElement} video
   * @param {object} hooks
   * @param {(info:{progress:number, fps:number})=>void} hooks.onProgress
   * @param {(record:object, out:object)=>void} hooks.onFrame
   * @param {()=>void} hooks.onComplete
   * @param {(msg:string)=>void} hooks.onError
   */
  async run(video, { onProgress, onFrame, onComplete, onError } = {}) {
    if (this.running) return;
    this.running = true;

    this.analysisFrames = [];
    this.motion.reset();
    this.squat.reset();
    this.squat.setActive(true);
    this._sampleWallTimes = [];

    let targetFps = this.cfg.videoAnalysisTargetFps;
    let lastSampledTime = -Infinity;
    const originalMuted = video.muted;
    const supportsRVFC = typeof video.requestVideoFrameCallback === "function";

    video.muted = true;
    try {
      video.currentTime = 0;
    } catch {
      /* ignore */
    }
    try {
      video.playbackRate = this.cfg.videoAnalysisPlaybackRate;
    } catch {
      video.playbackRate = 1;
    }

    const finish = () => {
      if (!this.running) return;
      this.running = false;
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        /* ignore */
      }
      video.playbackRate = 1;
      video.muted = originalMuted;
      video.removeEventListener("ended", finish);
      this.squat.setActive(false);
      onComplete && onComplete({ analysisFrames: this.analysisFrames, reps: this.squat.reps });
    };
    video.addEventListener("ended", finish);

    const effectiveFps = () => {
      const now = performance.now();
      this._sampleWallTimes = this._sampleWallTimes.filter((t) => now - t <= 1000);
      return this._sampleWallTimes.length;
    };

    const processFrame = (mediaTime) => {
      if (!this.running) return;

      const minInterval = 1 / targetFps;
      if (mediaTime - lastSampledTime >= minInterval) {
        lastSampledTime = mediaTime;
        const workStart = performance.now();

        const raw = this.engine.detect(video);
        const frame = this.motion.analyze(raw, video.videoWidth, video.videoHeight);
        const out = this.squat.update({
          kneeAngle: frame.kneeAngle,
          hipAngle: frame.hipAngle,
          visible: frame.visible,
          timeSec: mediaTime,
        });

        const record = {
          timestamp: mediaTime,
          landmarks: frame.landmarks,
          side: frame.side,
          visible: frame.visible,
          kneeAngle: frame.kneeAngle,
          hipAngle: frame.hipAngle,
          trunkAngle: frame.trunkAngle,
          phase: out.phase,
        };
        this.analysisFrames.push(record);
        this._sampleWallTimes.push(performance.now());

        // Adaptive FPS: if a sample took noticeably longer than the
        // interval we're aiming for, ease the target down (never below
        // the configured floor) so playback + inference can keep up.
        const workMs = performance.now() - workStart;
        if (workMs > minInterval * 1000 * 1.3 && targetFps > this.cfg.videoAnalysisMinFps) {
          targetFps = Math.max(this.cfg.videoAnalysisMinFps, targetFps - 1);
        }

        onFrame && onFrame(record, out);
      }

      const duration = video.duration;
      const progress = isFinite(duration) && duration > 0 ? Math.min(100, (video.currentTime / duration) * 100) : 0;
      onProgress && onProgress({ progress, fps: effectiveFps(), targetFps });

      if (!this.running) return;
      const nearEnd = isFinite(duration) && video.currentTime >= duration - 0.05;
      if (video.ended || nearEnd) {
        finish();
        return;
      }

      if (supportsRVFC) {
        video.requestVideoFrameCallback((_, meta) => processFrame(meta.mediaTime));
      } else {
        requestAnimationFrame(() => processFrame(video.currentTime));
      }
    };

    try {
      await video.play();
    } catch (err) {
      this.running = false;
      video.removeEventListener("ended", finish);
      onError && onError(`❌ Could not play the video for analysis (${err.name || err.message}).`);
      return;
    }

    if (supportsRVFC) {
      video.requestVideoFrameCallback((_, meta) => processFrame(meta.mediaTime));
    } else {
      requestAnimationFrame(() => processFrame(video.currentTime));
    }
  }
}
