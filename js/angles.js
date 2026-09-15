// ============================================================
// angles.js — geometry + smoothing helpers.
// No DOM/model code lives here so it can be unit-tested in isolation.
// ============================================================

/**
 * Angle ABC: the interior angle at vertex B formed by rays B->A and B->C.
 * Points are {x, y} in any consistent 2D space (normalized or pixels).
 * Returns degrees in [0, 180], or null if either ray has zero length.
 */
export function calculateAngle(A, B, C) {
  const BA = { x: A.x - B.x, y: A.y - B.y };
  const BC = { x: C.x - B.x, y: C.y - B.y };
  const magBA = Math.hypot(BA.x, BA.y);
  const magBC = Math.hypot(BC.x, BC.y);
  if (magBA === 0 || magBC === 0) return null;

  const dot = BA.x * BC.x + BA.y * BC.y;
  let cos = dot / (magBA * magBC);
  cos = Math.min(1, Math.max(-1, cos)); // guard float drift outside [-1,1]
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Angle between the vector top->bottom and the downward vertical axis.
 * Used for TRUNK angle (shoulder -> hip vs. vertical): ~0° when upright,
 * growing as the torso leans forward/back.
 */
export function verticalAngle(top, bottom) {
  const v = { x: bottom.x - top.x, y: bottom.y - top.y };
  const mag = Math.hypot(v.x, v.y);
  if (mag === 0) return null;
  let cos = v.y / mag; // (0,1) is "straight down" in image space
  cos = Math.min(1, Math.max(-1, cos));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Simple exponential moving average — the smoothing primitive used for
 * both landmark coordinates and derived joint angles (Step 4).
 */
export class EMA {
  constructor(alpha) {
    this.alpha = alpha;
    this.value = null;
  }

  next(x) {
    if (x === null || x === undefined || Number.isNaN(x)) return this.value;
    this.value = this.value === null ? x : this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }

  reset() {
    this.value = null;
  }
}
