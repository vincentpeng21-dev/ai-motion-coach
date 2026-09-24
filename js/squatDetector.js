// ============================================================
// squatDetector.js — the real state machine (Step 5).
//
// STANDING -> DESCENDING -> BOTTOM -> ASCENDING -> STANDING
// A rep only counts when the FULL cycle completes (with adequate depth
// and a plausible duration) — never a bare "angle < X => rep++".
//
// This is a Prototype heuristic (knee-angle based), not a medical or
// clinical judgment of squat quality.
// ============================================================

export class SquatDetector {
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
    this._observedMaxKnee = null; // session-level standing-angle calibration, see _effectiveStandingAngle()
    this._lastFeedback = { text: "⚪ Stand in frame", level: "neutral" };
    this._pendingText = null;
    this._pendingHold = 0;
  }

  _clearHolds() {
    // Timestamps (not counters): each records WHEN its candidate
    // transition first became true, so the debounce is a fixed real
    // duration (cfg.stateHoldSeconds) regardless of how many discrete
    // samples happen to land within it. null = not currently candidate.
    this._standingSince = null;
    this._descendingSince = null;
    this._bottomSince = null;
    this._ascendingSince = null;
    this._invisibleHold = 0;
  }

  _clearRepTracking() {
    this._repStartTime = null;
    this._bottomTime = null;
    this._minKnee = Infinity;
    this._minHip = Infinity;
    this._reachedBottom = false;
  }

  /**
   * cfg.standingAngle (165°) assumes a camera angle/height where a fully
   * upright person reads close to that. Real gym footage varies a lot —
   * observed on real user video: knee angle while genuinely standing
   * measured only ~131° due to camera position, so the person could
   * NEVER satisfy ">= 165°" to confirm "returned to standing", which is
   * required both to reset between reps and to complete a counted rep.
   * That silently made every rep uncountable regardless of depth.
   * Self-calibrate instead: track the highest knee angle actually
   * observed this session and use that (minus a margin) as the
   * "standing" bar, capped at the configured value as an upper bound
   * (never demand MORE than the ideal, only relax it when the footage
   * genuinely can't reach it).
   */
  _effectiveStandingAngle() {
    const cfg = this.cfg;
    if (this._observedMaxKnee === null) return cfg.standingAngle;
    const calibrated = this._observedMaxKnee - cfg.standingCalibrationMargin;
    // Floor anchored to bottomAngle (not descendingAngle): descendingAngle
    // is itself one of the values that can be miscalibrated for a given
    // camera angle (in the same real footage that motivated this fix, the
    // observed standing baseline of 131° was already BELOW the configured
    // descendingAngle of 150° — using descendingAngle+10 as the floor
    // would have clamped the calibrated value right back to ~160,
    // silently undoing the calibration). bottomAngle is comparatively
    // reliable as an absolute depth marker across the real footage tested.
    const floor = cfg.bottomAngle + 15;
    return Math.max(floor, Math.min(cfg.standingAngle, calibrated));
  }

  /** Call once when the user presses "Start Training" / "Stop Training". */
  setActive(active) {
    this.active = active;
    if (active) {
      this.phase = "STANDING";
      this.reps = [];
      this.repIndex = 0;
      this._clearHolds();
      this._clearRepTracking();
      this._observedMaxKnee = null;
    }
  }

  /** Full reset for the "Restart" button. */
  reset() {
    this._hardReset();
  }

  /**
   * @param {object} frame
   * @param {number|null} frame.kneeAngle  smoothed hip->knee->ankle angle
   * @param {number|null} frame.hipAngle   smoothed shoulder->hip->knee angle
   * @param {boolean} frame.visible        is the active side trustworthy this frame
   * @param {number} frame.timeSec         monotonic seconds (video/session clock)
   */
  update({ kneeAngle, hipAngle, visible, timeSec }) {
    const cfg = this.cfg;

    if (!visible || kneeAngle === null || hipAngle === null) {
      this._invisibleHold++;
      if (this._invisibleHold >= cfg.outOfFrameHoldFrames) {
        // Person left the frame / lost tracking mid-movement: abort
        // whatever was in progress rather than let it silently count.
        this.phase = "STANDING";
        this._clearHolds();
        this._clearRepTracking();
        this._suggest("⚪ Stand in frame", "neutral");
      }
      return this._output();
    }
    this._invisibleHold = 0;
    this._observedMaxKnee = this._observedMaxKnee === null ? kneeAngle : Math.max(this._observedMaxKnee, kneeAngle);

    if (this.phase !== "STANDING") {
      this._minKnee = Math.min(this._minKnee, kneeAngle);
      this._minHip = Math.min(this._minHip, hipAngle);
    }

    switch (this.phase) {
      case "STANDING":
        this._handleStanding(kneeAngle, timeSec);
        break;
      case "DESCENDING":
        this._handleDescending(kneeAngle, timeSec);
        break;
      case "BOTTOM":
        this._handleBottom(kneeAngle, timeSec);
        break;
      case "ASCENDING":
        this._handleAscending(kneeAngle, timeSec);
        break;
    }

    return this._output();
  }

  _handleStanding(kneeAngle, timeSec) {
    const cfg = this.cfg;
    if (kneeAngle < cfg.descendingAngle) {
      if (this._descendingSince === null) this._descendingSince = timeSec;
      if (timeSec - this._descendingSince >= cfg.stateHoldSeconds) {
        this.phase = "DESCENDING";
        this._descendingSince = null;
        this._repStartTime = timeSec;
        this._minKnee = kneeAngle;
        this._minHip = Infinity;
        this._reachedBottom = false;
        this._suggest("⬇️ Descending", "info");
      }
    } else {
      this._descendingSince = null;
      this._suggest("🟢 Ready — start your squat", "good");
    }
  }

  _handleDescending(kneeAngle, timeSec) {
    const cfg = this.cfg;

    if (kneeAngle <= cfg.bottomAngle) {
      if (this._bottomSince === null) this._bottomSince = timeSec;
      if (timeSec - this._bottomSince >= cfg.stateHoldSeconds) {
        this.phase = "BOTTOM";
        this._bottomSince = null;
        this._reachedBottom = true;
        this._bottomTime = timeSec;
        this._suggest("🟢 Good depth", "good");
        return;
      }
    } else {
      this._bottomSince = null;
    }

    // Gave up partway down and stood back up without reaching depth.
    if (kneeAngle >= this._effectiveStandingAngle()) {
      if (this._standingSince === null) this._standingSince = timeSec;
      if (timeSec - this._standingSince >= cfg.stateHoldSeconds) {
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

  _handleBottom(kneeAngle, timeSec) {
    const cfg = this.cfg;
    if (kneeAngle >= this._minKnee + cfg.ascendingHysteresis) {
      if (this._ascendingSince === null) this._ascendingSince = timeSec;
      if (timeSec - this._ascendingSince >= cfg.stateHoldSeconds) {
        this.phase = "ASCENDING";
        this._ascendingSince = null;
        this._suggest("⬆️ Stand back up", "info");
      }
    } else {
      this._ascendingSince = null;
    }
  }

  _handleAscending(kneeAngle, timeSec) {
    const cfg = this.cfg;
    if (kneeAngle >= this._effectiveStandingAngle()) {
      if (this._standingSince === null) this._standingSince = timeSec;
      if (timeSec - this._standingSince >= cfg.stateHoldSeconds) {
        this._completeRep(timeSec);
      }
    } else {
      this._standingSince = null;
    }
  }

  _completeRep(timeSec) {
    const cfg = this.cfg;
    const duration = this._repStartTime === null ? null : timeSec - this._repStartTime;
    const validDuration =
      duration !== null && duration >= cfg.minimumRepDuration && duration <= cfg.maximumRepDuration;

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
        minKnee: this._minKnee,
        minHip: this._minHip,
      });
      this._suggest("🟢 Good depth", "good");
    } else if (!this._reachedBottom) {
      this._suggest("🟡 Complete the movement", "warn");
    } else {
      this._suggest("🟢 Ready — start your squat", "good");
    }

    this._clearRepTracking();
  }

  // Debounced feedback: only switch the displayed message once the newly
  // suggested one has "won" for feedbackHoldFrames consecutive frames.
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

/**
 * Builds the Session Summary (Step 10 / Section 九).
 * Only describes observed movement-trend data — never a medical or
 * fatigue/injury diagnosis.
 */
export function computeSummary(reps, cfg) {
  if (!reps.length) return null;

  const n = reps.length;
  const minKnees = reps.map((r) => r.minKnee);
  const durations = reps.map((r) => r.duration);
  const avgRepTime = durations.reduce((a, b) => a + b, 0) / n;
  const deepest = Math.min(...minKnees);
  const avgDepth = minKnees.reduce((a, b) => a + b, 0) / n;

  const variance = minKnees.reduce((s, v) => s + (v - avgDepth) ** 2, 0) / n;
  const stdev = Math.sqrt(variance);
  const consistencyPct = Math.max(0, Math.min(100, 100 - (stdev / avgDepth) * 100));

  const trendNotes = [];
  if (n >= 4) {
    const half = Math.floor(n / 2);
    const firstKnees = minKnees.slice(0, half);
    const secondKnees = minKnees.slice(n - half);
    const firstKneeAvg = firstKnees.reduce((a, b) => a + b, 0) / half;
    const secondKneeAvg = secondKnees.reduce((a, b) => a + b, 0) / half;
    if (secondKneeAvg - firstKneeAvg >= cfg.depthTrendDegreesThreshold) {
      trendNotes.push("後半段動作深度有下降趨勢。");
    }

    const firstDur = durations.slice(0, half);
    const secondDur = durations.slice(n - half);
    const firstDurAvg = firstDur.reduce((a, b) => a + b, 0) / half;
    const secondDurAvg = secondDur.reduce((a, b) => a + b, 0) / half;
    if (firstDurAvg > 0 && (firstDurAvg - secondDurAvg) / firstDurAvg >= cfg.durationTrendPercentThreshold / 100) {
      trendNotes.push("後半段動作速度有增加趨勢。");
    }
  }

  return {
    exercise: "squat",
    totalReps: n,
    avgRepTime,
    deepest,
    avgDepth,
    consistencyPct,
    trendNotes,
    trendNote: trendNotes[0] || null, // back-compat for older callers
    reps,
    goodDepthAngle: cfg.goodDepthAngle,
  };
}
