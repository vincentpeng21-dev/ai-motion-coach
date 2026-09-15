// ============================================================
// motionAnalyzer.js — the "MotionAnalyzer" box in the architecture:
//
//   PoseEngine -> MotionAnalyzer -> SquatDetector
//
// Turns raw landmarks for one frame into smoothed joint angles. This is
// the ONE place angle-calculation + smoothing happens — both Webcam mode
// and Video-upload mode call the same MotionAnalyzer instance/class so
// there is exactly one analysis pipeline, not two.
// ============================================================

import { calculateAngle, verticalAngle, EMA } from "./angles.js";
import { selectSide, LandmarkSmoother } from "./poseEngine.js";

export class MotionAnalyzer {
  constructor(cfg) {
    this.cfg = cfg;
    this.landmarkSmoother = new LandmarkSmoother(cfg.smoothingFactor);
    this.kneeEMA = new EMA(cfg.smoothingFactor);
    this.hipEMA = new EMA(cfg.smoothingFactor);
    this.trunkEMA = new EMA(cfg.smoothingFactor);
  }

  /** Call when switching subjects/sources (new video, camera restart, …). */
  reset() {
    this.landmarkSmoother.reset();
    this.kneeEMA.reset();
    this.hipEMA.reset();
    this.trunkEMA.reset();
  }

  /**
   * @param {Array|null} rawLandmarks  33-point array from PoseEngine.detect(), or null
   * @param {number} mediaWidth        intrinsic width of the source frame (px)
   * @param {number} mediaHeight       intrinsic height of the source frame (px)
   */
  analyze(rawLandmarks, mediaWidth, mediaHeight) {
    if (!rawLandmarks) {
      return { landmarks: null, side: null, visible: false, kneeAngle: null, hipAngle: null, trunkAngle: null };
    }

    const smoothed = this.landmarkSmoother.smooth(rawLandmarks);
    const sideInfo = selectSide(smoothed);

    let kneeAngle = null;
    let hipAngle = null;
    let trunkAngle = null;

    if (sideInfo.visible) {
      const toPx = (lm) => ({ x: lm.x * mediaWidth, y: lm.y * mediaHeight });
      const kneeRaw = calculateAngle(toPx(sideInfo.hip), toPx(sideInfo.knee), toPx(sideInfo.ankle));
      const hipRaw = calculateAngle(toPx(sideInfo.shoulder), toPx(sideInfo.hip), toPx(sideInfo.knee));
      const trunkRaw = verticalAngle(toPx(sideInfo.shoulder), toPx(sideInfo.hip));
      kneeAngle = this.kneeEMA.next(kneeRaw);
      hipAngle = this.hipEMA.next(hipRaw);
      trunkAngle = this.trunkEMA.next(trunkRaw);
    }

    return {
      landmarks: smoothed,
      side: sideInfo.side,
      visible: sideInfo.visible,
      kneeAngle,
      hipAngle,
      trunkAngle,
    };
  }
}
