// ============================================================
// deadliftDetector.js — state machine for hip-hinge exercises
// (conventional deadlift, Romanian deadlift).
//
// Primary metric: shoulder→hip→knee angle (hipAngle).
// States: STANDING → HINGING → BOTTOM → ASCENDING → STANDING
//
// Prototype heuristic — not a medical or clinical assessment.
// ============================================================

export class DeadliftDetector {
  constructor(config) {
    this.cfg = config;
    this._hardReset();
  }

  _hardReset() {
    this.phase = "STANDING";
    this.active = false;
    this.reps = [];
    this.repIndex = 0;
    this._clearHolds();
    this._clearRepTracking();
    this._observedMaxHip = null; // session-level standing-angle calibration, see _effectiveStandingHipAngle()
    this._lastFeedback = { text: "⚪ Stand in frame", level: "neutral" };
    this._pendingText = null;
    this._pendingHold = 0;
  }

  _clearHolds() {
    // Timestamps (not counters) — see squatDetector.js's _clearHolds for
    // why: a fixed frame COUNT debounce means a wildly different real
    // duration depending on sampling rate, which made it structurally
    // impossible for a real rep's phases to complete under the automated
    // video-analysis pass's much sparser sampling than webcam mode.
    this._standingSince = null;
    this._hingingSince = null;
    this._bottomSince = null;
    this._ascendingSince = null;
    this._invisibleHold = 0;
  }

  _clearRepTracking() {
    this._repStartTime = null;
    this._bottomTime = null;
    this._minHip = Infinity;
    this._minKnee = Infinity;
    this._reachedBottom = false;
  }

  /** See squatDetector.js's _effectiveStandingAngle() for the rationale. */
  _effectiveStandingHipAngle() {
    const dl = this.cfg.deadlift;
    if (this._observedMaxHip === null) return dl.standingHipAngle;
    const calibrated = this._observedMaxHip - this.cfg.standingCalibrationMargin;
    // See squatDetector.js's _effectiveStandingAngle() — floor anchored to
    // bottomHipAngle, not descendingHipAngle, since descendingHipAngle can
    // itself be miscalibrated for a given camera angle.
    const floor = dl.bottomHipAngle + 15;
    return Math.max(floor, Math.min(dl.standingHipAngle, calibrated));
  }

  setActive(active) {
    this.active = active;
    if (active) {
      this.phase = "STANDING";
      this.reps = [];
      this.repIndex = 0;
      this._clearHolds();
      this._clearRepTracking();
      this._observedMaxHip = null;
    }
  }

  reset() { this._hardReset(); }

  /**
   * @param {object} frame
   * @param {number|null} frame.kneeAngle
   * @param {number|null} frame.hipAngle   PRIMARY metric for deadlift
   * @param {boolean}     frame.visible
   * @param {number}      frame.timeSec
   */
  update({ kneeAngle, hipAngle, visible, timeSec }) {
    const cfg = this.cfg;
    const dl = cfg.deadlift;

    if (!visible || hipAngle === null) {
      this._invisibleHold++;
      if (this._invisibleHold >= cfg.outOfFrameHoldFrames) {
        this.phase = "STANDING";
        this._clearHolds();
        this._clearRepTracking();
        this._suggest("⚪ Stand in frame", "neutral");
      }
      return this._output();
    }
    this._invisibleHold = 0;
    this._observedMaxHip = this._observedMaxHip === null ? hipAngle : Math.max(this._observedMaxHip, hipAngle);

    if (this.phase !== "STANDING") {
      this._minHip = Math.min(this._minHip, hipAngle);
      if (kneeAngle !== null) this._minKnee = Math.min(this._minKnee, kneeAngle);
    }

    switch (this.phase) {
      case "STANDING":   this._handleStanding(hipAngle, timeSec); break;
      case "HINGING":    this._handleHinging(hipAngle, timeSec);  break;
      case "BOTTOM":     this._handleBottom(hipAngle, timeSec);    break;
      case "ASCENDING":  this._handleAscending(hipAngle, timeSec);break;
    }

    return this._output();
  }

  _handleStanding(hipAngle, timeSec) {
    const dl = this.cfg.deadlift;
    if (hipAngle < dl.descendingHipAngle) {
      if (this._hingingSince === null) this._hingingSince = timeSec;
      if (timeSec - this._hingingSince >= this.cfg.stateHoldSeconds) {
        this.phase = "HINGING";
        this._hingingSince = null;
        this._repStartTime = timeSec;
        this._minHip = hipAngle;
        this._minKnee = Infinity;
        this._reachedBottom = false;
        this._suggest("⬇️ Hinging down", "info");
      }
    } else {
      this._hingingSince = null;
      this._suggest("🟢 Ready — start your pull", "good");
    }
  }

  _handleHinging(hipAngle, timeSec) {
    const dl = this.cfg.deadlift;

    if (hipAngle <= dl.bottomHipAngle) {
      if (this._bottomSince === null) this._bottomSince = timeSec;
      if (timeSec - this._bottomSince >= this.cfg.stateHoldSeconds) {
        this.phase = "BOTTOM";
        this._bottomSince = null;
        this._reachedBottom = true;
        this._bottomTime = timeSec;
        const isGood = hipAngle <= dl.goodDepthHipAngle;
        this._suggest(isGood ? "🟢 Good depth" : "🟡 Go a little lower", isGood ? "good" : "warn");
        return;
      }
    } else {
      this._bottomSince = null;
    }

    // Gave up and stood back up without reaching bottom depth.
    if (hipAngle >= this._effectiveStandingHipAngle()) {
      if (this._standingSince === null) this._standingSince = timeSec;
      if (timeSec - this._standingSince >= this.cfg.stateHoldSeconds) {
        this.phase = "STANDING";
        this._clearHolds();
        this._clearRepTracking();
        this._suggest("🟡 Complete the movement", "warn");
        return;
      }
    } else {
      this._standingSince = null;
    }

    this._suggest("🟡 Go a little lower", "warn");
  }

  _handleBottom(hipAngle, timeSec) {
    const dl = this.cfg.deadlift;
    if (hipAngle >= this._minHip + this.cfg.ascendingHysteresis) {
      if (this._ascendingSince === null) this._ascendingSince = timeSec;
      if (timeSec - this._ascendingSince >= this.cfg.stateHoldSeconds) {
        this.phase = "ASCENDING";
        this._ascendingSince = null;
        this._suggest("⬆️ Drive hips forward", "info");
      }
    } else {
      this._ascendingSince = null;
    }
  }

  _handleAscending(hipAngle, timeSec) {
    if (hipAngle >= this._effectiveStandingHipAngle()) {
      if (this._standingSince === null) this._standingSince = timeSec;
      if (timeSec - this._standingSince >= this.cfg.stateHoldSeconds) {
        this._completeRep(timeSec);
      }
    } else {
      this._standingSince = null;
    }
  }

  _completeRep(timeSec) {
    const cfg = this.cfg;
    const duration = this._repStartTime === null ? null : timeSec - this._repStartTime;
    const validDuration = duration !== null &&
      duration >= cfg.minimumRepDuration && duration <= cfg.maximumRepDuration;

    this.phase = "STANDING";
    this._clearHolds();

    if (this._reachedBottom && validDuration && this.active) {
      this.repIndex++;
      this.reps.push({
        index: this.repIndex,
        startTime: this._repStartTime,
        bottomTime: this._bottomTime,
        endTime: timeSec,
        duration,
        minHip: this._minHip,
        minKnee: this._minKnee,
      });
      this._suggest("🟢 Good lift", "good");
    } else if (!this._reachedBottom) {
      this._suggest("🟡 Complete the movement", "warn");
    } else {
      this._suggest("🟢 Ready — start your pull", "good");
    }

    this._clearRepTracking();
  }

  _suggest(text, level) {
    if (this._pendingText === text) {
      this._pendingHold++;
    } else {
      this._pendingText = text;
      this._pendingHold = 1;
    }
    if (this._pendingHold >= this.cfg.feedbackHoldFrames && this._lastFeedback.text !== text) {
      this._lastFeedback = { text, level };
    }
  }

  _output() {
    return {
      phase: this.phase,
      repCount: this.reps.length,
      reps: this.reps,
      feedback: this._lastFeedback,
    };
  }
}

export function computeDeadliftSummary(reps, cfg) {
  if (!reps.length) return null;
  const n = reps.length;
  const dl = cfg.deadlift;
  const minHips = reps.map((r) => r.minHip);
  const durations = reps.map((r) => r.duration);
  const avgRepTime = durations.reduce((a, b) => a + b, 0) / n;
  const deepest = Math.min(...minHips);
  const avgDepth = minHips.reduce((a, b) => a + b, 0) / n;
  const variance = minHips.reduce((s, v) => s + (v - avgDepth) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const consistencyPct = Math.max(0, Math.min(100, 100 - (stdev / avgDepth) * 100));

  const trendNotes = [];
  if (n >= 4) {
    const half = Math.floor(n / 2);
    const firstAvg = minHips.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondAvg = minHips.slice(n - half).reduce((a, b) => a + b, 0) / half;
    if (secondAvg - firstAvg >= cfg.depthTrendDegreesThreshold) {
      trendNotes.push("後半段髖部下降深度有減少趨勢。");
    }
    const firstDurAvg = durations.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const secondDurAvg = durations.slice(n - half).reduce((a, b) => a + b, 0) / half;
    if (firstDurAvg > 0 && (firstDurAvg - secondDurAvg) / firstDurAvg >= cfg.durationTrendPercentThreshold / 100) {
      trendNotes.push("後半段動作速度有增加趨勢。");
    }
  }

  return {
    exercise: "deadlift",
    totalReps: n,
    avgRepTime,
    deepest,
    avgDepth,
    consistencyPct,
    trendNotes,
    trendNote: trendNotes[0] || null,
    reps,
    goodDepthAngle: dl.goodDepthHipAngle,
  };
}
