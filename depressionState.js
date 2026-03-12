// ================================================================
//  DEPRESSION STATE MODULE
//  All depression episode functionality separated from main game
// ================================================================

// ── Depression Configuration ───────────────────────────────────
export const DEPRESSION_CHECKPOINT_ZONE = { x: 46.5, y: 46.5, radius: 2.3 };
export const DEPRESSION_SPEED_MULTIPLIER = 0.38;
export const DEPRESSION_RAMP_DURATION = 22; // reaches full intensity in 22s

// ── Depression State ───────────────────────────────────────────
export class DepressionState {
  constructor() {
    this.reset();
  }

  // Initialize all depression variables
  reset() {
    this.depressionMode = false;
    this.hasPassedCheckpoint = false;
    this.checkpointWarningShown = false;
    this.depressionIntensity = 0;
    this.depressionStartTime = 0;

    this.nightAmount = 0;
    this.vignetteAmount = 0;
    this.desaturationAmount = 0;
    this.motionDrag = 0;
    this.fisheyeAmount = 0;
  }

  // Trigger the depression state
  trigger(pulse) {
    this.hasPassedCheckpoint = true;
    this.depressionMode = true;
    if (this.depressionStartTime === 0) {
      this.depressionStartTime = pulse;
    }
  }

  // Called every frame while in play
  update(dt, pulse, reducedEffectsMode) {
    if (!this.depressionMode) return;

    if (this.depressionStartTime === 0) {
      this.depressionStartTime = pulse;
    }

    let rawIntensity = Math.min(
      1,
      (pulse - this.depressionStartTime) / DEPRESSION_RAMP_DURATION,
    );
    this.depressionIntensity = reducedEffectsMode
      ? Math.min(0.55, rawIntensity)
      : rawIntensity;

    this.nightAmount = 0.45 + this.depressionIntensity * 0.55;
    this.vignetteAmount = 0.28 + this.depressionIntensity * 0.38;
    this.desaturationAmount = 0.2 + this.depressionIntensity * 0.45;
    this.motionDrag = 0.18 + this.depressionIntensity * 0.24;
    this.fisheyeAmount = 0.55 + this.depressionIntensity * 1.05;
  }

  // Apply visual effects: sky shifts to night and darker horizon
  applySkyEffects(r, g, b, t, pulse) {
    if (!this.depressionMode) return { r, g, b };

    const ni = this.nightAmount;
    const horizon = Math.max(0, 1 - t);
    const slowWave = Math.sin(pulse * 0.22 + t * 2.4) * 8;

    r = Math.max(8, r * (1 - ni * 0.82) + 6 + slowWave * 0.2) | 0;
    g = Math.max(14, g * (1 - ni * 0.72) + 14 + slowWave * 0.35) | 0;
    b = Math.max(24, b * (1 - ni * 0.35) + 36 + horizon * 28 + slowWave) | 0;

    return { r: Math.min(255, r), g: Math.min(255, g), b: Math.min(255, b) };
  }

  // Apply visual effects: map colors become muted/cooler
  applyWorldEffects(r, g, b) {
    if (!this.depressionMode) return { r, g, b };

    const d = this.desaturationAmount;
    const gray = (r + g + b) / 3;
    const nr = r + (gray - r) * d;
    const ng = g + (gray - g) * d;
    const nb = b + (gray - b) * d + 10;

    return {
      r: Math.max(0, Math.min(255, nr | 0)),
      g: Math.max(0, Math.min(255, ng | 0)),
      b: Math.max(0, Math.min(255, nb | 0)),
    };
  }

  // Apply visual effects: elongated objects with fisheye-like stretch
  applyProjectionStretch(screenX, screenW, baseHeight) {
    if (!this.depressionMode) return baseHeight;

    const nx = (screenX / Math.max(1, screenW)) * 2 - 1;
    const edgeSq = nx * nx;
    const edgePow = edgeSq * edgeSq;
    const edgeStretch = edgeSq * 0.6 + edgePow * 1.4;
    const stretch = 1 + edgeStretch * this.fisheyeAmount;
    return baseHeight * stretch;
  }
}
