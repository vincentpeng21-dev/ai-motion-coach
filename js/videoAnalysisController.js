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
    this.engine = engine;
    this.motion = motion;
    this.squat = squat; // active detector (squat or deadlift)
    this.cfg = cfg;
    this.analysisFrames = [];
    this.running = false;
    this._sampleWallTimes = [];
  }

  stop() { this.running = false; }

  /** Swap the active exercise detector (call before runAnalysis). */
  setDetector(det) { this.squat = det; }

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
    let lastRawMediaTime = -Infinity; // tracks EVERY callback, not just sampled ones
    const originalMuted = video.muted;
    const supportsRVFC = typeof video.requestVideoFrameCallback === "function";

    video.muted = true;
    try {
      video.currentTime = 0;
    } catch {
      /* ignore */
    }
    // Modern phones default to recording at 4K+. Starting straight at the
    // configured acceleration on that much source data reliably causes the
    // decoder to drop presented frames to keep up, collapsing the actual
    // sample density to a small fraction of the target (observed: ~1
    // sample/sec on a 4K clip instead of the intended 12fps) — badly
    // increasing the odds of missing the exact instant a rep bottoms out.
    // The reactive backoff below still helps mid-analysis, but starting
    // conservative for large frames avoids losing density during the
    // several seconds it takes that backoff to fully kick in.
    const HIGH_RES_PIXEL_THRESHOLD = 1920 * 1080;
    const videoPixels = (video.videoWidth || 0) * (video.videoHeight || 0);
    const initialPlaybackRate =
      videoPixels > HIGH_RES_PIXEL_THRESHOLD ? 1 : this.cfg.videoAnalysisPlaybackRate;
    try {
      video.playbackRate = initialPlaybackRate;
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

      // Debug trace: open DevTools console to see exactly what the
      // detector saw per sampled frame (angle, visibility, phase) — the
      // fastest way to tell "genuinely fewer reps in the footage" apart
      // from "sampling missed a rep" or "state machine didn't reset"
      // without re-instrumenting anything.
      console.log(
        `[AI Motion Coach] Analysis trace — ${this.analysisFrames.length} sampled frames, ${this.squat.reps.length} reps counted:`
      );
      console.table(
        this.analysisFrames.map((f) => ({
          t: f.timestamp.toFixed(2),
          knee: f.kneeAngle !== null ? Math.round(f.kneeAngle) : null,
          hip: f.hipAngle !== null ? Math.round(f.hipAngle) : null,
          visible: f.visible,
          phase: f.phase,
        }))
      );

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

      // requestVideoFrameCallback fires once per PRESENTED frame. On a
      // large/high-res file (e.g. a 4K phone recording), the decoder can
      // fail to keep up with an aggressive playbackRate and starts
      // dropping presented frames to stay on schedule — so callbacks
      // still fire, but each one's mediaTime has jumped by far more than
      // one native frame's worth. Our own targetFps throttle can't fix
      // this: it only controls how often WE choose to act on a callback,
      // not how often the browser hands us one. If we detect that kind of
      // jump, ease playbackRate itself back down (floor at 1x — real-time
      // decode is what browsers are built to sustain reliably) so the
      // decoder can actually deliver frames densely enough to catch the
      // instant a rep bottoms out.
      if (lastRawMediaTime !== -Infinity) {
        const rawGap = mediaTime - lastRawMediaTime;
        if (rawGap > 0.4 && video.playbackRate > 1) {
          video.playbackRate = Math.max(1, video.playbackRate * 0.75);
        }
      }
      lastRawMediaTime = mediaTime;

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
