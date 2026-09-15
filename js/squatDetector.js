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
    this._lastFeedback = { text: "⚪ Stand in frame", level: "neutral" };
    this._pendingText = null;
    this._pendingHold = 0;
  }

  _clearHolds() {
    this._standingHold = 0;
    this._descendingHold = 0;
    this._bottomHold = 0;
    this._ascendingHold = 0;
    this._invisibleHold = 0;
  }

  _clearRepTracking() {
    this._repStartTime = null;
    this._bottomTime = null;
    this._minKnee = Infinity;
    this._minHip = Infinity;
    this._reachedBottom = false;
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
        this._handleBottom(kneeAngle);
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
      this._descendingHold++;
      if (this._descendingHold >= cfg.stateHoldFrames) {
        this.phase = "DESCENDING";
        this._descendingHold = 0;
        this._repStartTime = timeSec;
        this._minKnee = kneeAngle;
        this._minHip = Infinity;
        this._reachedBottom = false;
        this._suggest("⬇️ Descending", "info");
      }
    } else {
      this._descendingHold = 0;
      this._suggest("🟢 Ready — start your squat", "good");
    }
  }

  _handleDescending(kneeAngle, timeSec) {
    const cfg = this.cfg;

    if (kneeAngle <= cfg.bottomAngle) {
      this._bottomHold++;
      if (this._bottomHold >= cfg.stateHoldFrames) {
        this.phase = "BOTTOM";
        this._bottomHold = 0;
        this._reachedBottom = true;
        this._bottomTime = timeSec;
        this._suggest("🟢 Good depth", "good");
        return;
      }
    } else {
      this._bottomHold = 0;
    }

    // Gave up partway down and stood back up without reaching depth.
    if (kneeAngle >= cfg.standingAngle) {
      this._standingHold++;
      if (this._standingHold >= cfg.stateHoldFrames) {
        this.phase = "STANDING";
        this._clearHolds();
        this._clearRepTracking();
        this._suggest("🟡 Complete the movement", "warn");
        return;
      }
    } else {
      this._standingHold = 0;
    }

    this._suggest("🟡 Go a little lower", "warn");
  }

  _handleBottom(kneeAngle) {
    const cfg = this.cfg;
    if (kneeAngle >= this._minKnee + cfg.ascendingHysteresis) {
      this._ascendingHold++;
      if (this._ascendingHold >= cfg.stateHoldFrames) {
        this.phase = "ASCENDING";
        this._ascendingHold = 0;
        this._suggest("⬆️ Stand back up", "info");
      }
    } else {
      this._ascendingHold = 0;
    }
  }

  _handleAscending(kneeAngle, timeSec) {
    const cfg = this.cfg;
    if (kneeAngle >= cfg.standingAngle) {
      this._standingHold++;
      if (this._standingHold >= cfg.stateHoldFrames) {
        this._completeRep(timeSec);
      }
    } else {
      this._standingHold = 0;
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
    totalReps: n,
    avgRepTime,
    deepest,
    avgDepth,
    consistencyPct,
    trendNotes,
    trendNote: trendNotes[0] || null, // back-compat for older callers
    reps,
  };
}
