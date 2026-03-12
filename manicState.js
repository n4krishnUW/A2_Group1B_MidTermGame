// ================================================================
//  MANIC STATE MODULE
//  All manic episode functionality separated from main game
// ================================================================

// ── Manic Episode Configuration ─────────────────────────────
export const MANIC_CHECKPOINT_ZONE = { x: 26.5, y: 26.5, radius: 2.5 };
export const MANIC_SPEED_MULTIPLIER = 5.0;
export const MANIC_RAMP_DURATION = 30; // reaches full intensity in 30 seconds

// ── Racing Thoughts Data ─────────────────────────────────────
export const RACING_THOUGHTS = [
  "you're SO close",
  "you see EVERYTHING clearly",
  "faster — it makes sense now",
  "this is IMPORTANT",
  "you've never driven better",
  "why is everyone so slow",
  "you understand the pattern",
  "this feels RIGHT",
  "incredible — keep going",
  "you're UNSTOPPABLE",
  "everything is connected",
  "you've figured it out",
  "no one else gets it like you do",
  "this is the best you've ever felt",
  "almost there — you KNOW the way",
  "your instincts are perfect",
  "trust yourself",
  "the signs are obvious",
  "you don't need the map",
  "you can feel the destination",
];

// ── Grandiosity Messages ────────────────────────────────────
export const GRANDIOSITY_MESSAGES = [
  "PERFECT DRIVING",
  "YOU SEE IT CLEARLY",
  "FLAWLESS INSTINCTS",
  "INCREDIBLE SPEED",
  "YOU CAN'T BE STOPPED",
  "EVERYTHING MAKES SENSE",
  "TRUST YOUR JUDGMENT",
  "BRILLIANT ROUTE CHOSEN",
];

// ── Arrow Pool for Misdirection ─────────────────────────────
export const ARROW_POOL = [
  // Early map — near start, mislead immediately
  { x: 8.5, y: 4.5, dir: -Math.PI / 2 },
  { x: 4.5, y: 8.5, dir: Math.PI / 2 },
  { x: 10.5, y: 3.5, dir: Math.PI },
  // Mid-map horizontal roads (row 13, 23)
  { x: 18.5, y: 13.5, dir: Math.PI },
  { x: 28.5, y: 14.5, dir: -Math.PI / 2 },
  { x: 8.5, y: 13.5, dir: Math.PI },
  { x: 38.5, y: 13.5, dir: 0 },
  { x: 48.5, y: 14.5, dir: Math.PI / 2 },
  // Mid-map vertical roads (col 13, 23)
  { x: 13.5, y: 8.5, dir: -Math.PI / 2 },
  { x: 13.5, y: 18.5, dir: 0 },
  { x: 13.5, y: 28.5, dir: -Math.PI / 2 },
  { x: 23.5, y: 8.5, dir: Math.PI },
  { x: 23.5, y: 18.5, dir: Math.PI / 2 },
  // Row 23 horizontal
  { x: 8.5, y: 23.5, dir: Math.PI },
  { x: 18.5, y: 23.5, dir: -Math.PI / 2 },
  { x: 28.5, y: 23.5, dir: Math.PI },
  { x: 38.5, y: 23.5, dir: Math.PI / 2 },
  // Approaching goal quadrant
  { x: 33.5, y: 28.5, dir: Math.PI / 2 },
  { x: 33.5, y: 38.5, dir: -Math.PI / 2 },
  { x: 38.5, y: 33.5, dir: -Math.PI / 2 },
  { x: 43.5, y: 33.5, dir: Math.PI },
  { x: 33.5, y: 43.5, dir: -Math.PI / 2 },
  { x: 43.5, y: 43.5, dir: Math.PI / 2 },
  // Far end near Recreation Centre
  { x: 48.5, y: 38.5, dir: 0 },
  { x: 48.5, y: 43.5, dir: Math.PI },
  { x: 43.5, y: 48.5, dir: Math.PI / 2 },
  { x: 38.5, y: 43.5, dir: -Math.PI / 2 },
  { x: 48.5, y: 33.5, dir: Math.PI / 2 },
  { x: 38.5, y: 48.5, dir: 0 },
];

// ── Manic State ──────────────────────────────────────────────
export class ManicState {
  constructor() {
    this.reset();
  }

  reset() {
    // Core state
    this.manicMode = false;
    this.hasPassedCheckpoint = false;
    this.checkpointWarningShown = false;
    this.manicIntensity = 0;
    this.manicStartTime = 0;

    // Visual effects
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.screenRotation = 0;
    this.colorShift = 0;
    this.tunnelVisionAmount = 0;
    this.controlInversion = 0;
    this.controlDrift = 0;
    this.hudGlitchAmount = 0;

    // Authentic mania effects
    this.worldBloom = 0;
    this.skyBrightness = 0;
    this.compassDrift = 0;
    this.shimmerAmount = 0;

    // Racing thoughts
    this.activeThoughts = [];
    this.thoughtSpawnTimer = 0;

    // Arrow system
    this.activeArrowIdx = -1;
    this.arrowTimer = 0;
    this.arrowFadeAlpha = 0;
    this.lastArrowIdx = -1;

    // Grandiosity
    this.currentGrandiosityMsg = "";
    this.grandiosityTimer = 0;
    this.grandiosityAlpha = 0;

    // Phantom sprites
    this.phantomSprites = [];
  }

  update(
    dt,
    pulse,
    playerPos,
    goalPos,
    initialDistanceToGoal,
    skipManicEpisode,
    reducedEffectsMode,
  ) {
    // Check for checkpoint trigger
    if (!this.hasPassedCheckpoint) {
      let currentDistToGoal = Math.hypot(
        playerPos.x - goalPos.x,
        playerPos.y - goalPos.y,
      );
      let progressPercent = 1 - currentDistToGoal / initialDistanceToGoal;
      let distToCheckpoint = Math.hypot(
        playerPos.x - MANIC_CHECKPOINT_ZONE.x,
        playerPos.y - MANIC_CHECKPOINT_ZONE.y,
      );
      let shouldTrigger =
        distToCheckpoint < MANIC_CHECKPOINT_ZONE.radius ||
        progressPercent >= 0.4;

      if (
        !this.checkpointWarningShown &&
        (distToCheckpoint < MANIC_CHECKPOINT_ZONE.radius + 5 ||
          progressPercent >= 0.1)
      ) {
        this.checkpointWarningShown = true;
      }

      if (shouldTrigger) {
        this.hasPassedCheckpoint = true;
        this.manicMode = true;
      }
    }

    // Update manic intensity
    if (this.manicMode && !skipManicEpisode) {
      if (this.manicStartTime === 0) this.manicStartTime = pulse;
      let elapsed = pulse - this.manicStartTime;
      let rawIntensity = Math.min(1, elapsed / MANIC_RAMP_DURATION);
      this.manicIntensity = reducedEffectsMode
        ? Math.min(0.5, rawIntensity)
        : rawIntensity;

      // Update visual effects
      this.worldBloom = this.manicIntensity * 0.7;
      this.skyBrightness = this.manicIntensity * 0.5;
      this.shimmerAmount = this.manicIntensity;
      this.compassDrift = Math.sin(pulse * 0.08) * this.manicIntensity * 0.45;
      this.screenRotation = Math.sin(pulse * 1.2) * this.manicIntensity * 0.025;

      // Shake at high intensity
      if (this.manicIntensity > 0.7) {
        let shakeIntensity = 4.0 * ((this.manicIntensity - 0.7) / 0.3);
        this.shakeOffsetX = (Math.random() - 0.5) * shakeIntensity;
        this.shakeOffsetY = (Math.random() - 0.5) * shakeIntensity;
      } else {
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
      }

      // Racing thoughts
      this.thoughtSpawnTimer -= dt;
      let spawnInterval = Math.max(0.4, 3.0 - this.manicIntensity * 2.6);
      if (this.thoughtSpawnTimer <= 0) {
        this.thoughtSpawnTimer = spawnInterval;
        this.spawnRacingThought(playerPos);
      }

      // Update thoughts
      this.activeThoughts.forEach((th) => {
        th.life -= dt;
        th.x += th.vx * dt;
        th.y += th.vy * dt;
        let progress = 1 - th.life / th.maxLife;
        if (progress < 0.15) th.alpha = progress / 0.15;
        else if (progress > 0.7) th.alpha = 1 - (progress - 0.7) / 0.3;
        else th.alpha = 1.0;
      });
      this.activeThoughts = this.activeThoughts.filter((th) => th.life > 0);

      // Arrow system
      if (this.manicIntensity > 0.1) {
        this.arrowTimer -= dt;
        if (this.arrowTimer <= 0) {
          let nearby = ARROW_POOL.map((a, i) => ({
            i,
            d: Math.hypot(a.x - playerPos.x, a.y - playerPos.y),
          }))
            .filter((a) => a.i !== this.lastArrowIdx && a.d < 16 && a.d > 1.5)
            .sort((a, b) => a.d - b.d);
          let pool2 = nearby.slice(0, 5);
          if (pool2.length === 0)
            pool2 = ARROW_POOL.map((_, i) => ({ i })).filter(
              (a) => a.i !== this.lastArrowIdx,
            );
          let pick = pool2[Math.floor(Math.random() * pool2.length)];
          this.lastArrowIdx = this.activeArrowIdx;
          this.activeArrowIdx = pick.i;
          this.arrowTimer = Math.max(1.8, 5 - this.manicIntensity * 3.5);
          this.arrowFadeAlpha = 0;
        }
        let duration = Math.max(1.8, 5 - this.manicIntensity * 3.5);
        let elapsed = duration - this.arrowTimer;
        this.arrowFadeAlpha = Math.min(
          1,
          Math.min(elapsed / 0.5, this.arrowTimer / 0.5),
        );
      } else {
        this.activeArrowIdx = -1;
        this.arrowFadeAlpha = 0;
      }

      // Grandiosity messages
      this.grandiosityTimer -= dt;
      if (this.grandiosityTimer <= 0) {
        this.grandiosityTimer = Math.max(1.5, 4.0 - this.manicIntensity * 2.5);
        this.currentGrandiosityMsg =
          GRANDIOSITY_MESSAGES[
            Math.floor(Math.random() * GRANDIOSITY_MESSAGES.length)
          ];
        this.grandiosityAlpha = 0.0;
      }
      this.grandiosityAlpha = Math.min(1, this.grandiosityAlpha + dt * 3);

      // Legacy vars
      this.colorShift = this.manicIntensity * 0.15;
      this.tunnelVisionAmount = 0;
      this.controlInversion = 0;
      this.controlDrift = this.manicIntensity * 0.08;
      this.hudGlitchAmount = this.manicIntensity * 0.3;

      // Phantom sprites
      if (this.manicIntensity > 0.6 && Math.random() < 0.008) {
        this.spawnPhantomSprite(playerPos);
      }
    } else if (this.manicMode && skipManicEpisode) {
      this.manicIntensity = 0;
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    } else {
      this.shakeOffsetX = 0;
      this.shakeOffsetY = 0;
    }

    // Update phantom sprites
    this.phantomSprites = this.phantomSprites.filter((ps) => {
      ps.life -= dt;
      return ps.life > 0;
    });
  }

  spawnRacingThought(screenSize) {
    let text =
      RACING_THOUGHTS[Math.floor(Math.random() * RACING_THOUGHTS.length)];
    let x = screenSize.W * (0.15 + Math.random() * 0.7);
    let y = screenSize.H * (0.3 + Math.random() * 0.45);
    let size = Math.floor(11 + this.manicIntensity * 14 + Math.random() * 8);
    let maxLife = 2.5 + Math.random() * 1.5;
    this.activeThoughts.push({
      text,
      x,
      y,
      size,
      vx: (Math.random() - 0.5) * 18,
      vy: -12 - Math.random() * 20,
      alpha: 0,
      life: maxLife,
      maxLife,
    });
  }

  spawnPhantomSprite(playerPos) {
    const COLS = 56,
      ROWS = 56;
    let angle = Math.random() * Math.PI * 2;
    let dist = 5 + Math.random() * 10;
    let x = Math.max(
      1,
      Math.min(COLS - 1, playerPos.x + Math.cos(angle) * dist),
    );
    let y = Math.max(
      1,
      Math.min(ROWS - 1, playerPos.y + Math.sin(angle) * dist),
    );
    let types = [
      { t: 9, dir: Math.random() * Math.PI * 2 },
      { t: 4 },
      { t: 5, r: 255, g: 100, b: 100 },
    ];
    let phantom = types[Math.floor(Math.random() * types.length)];
    phantom.x = x;
    phantom.y = y;
    phantom.life = 2 + Math.random() * 3;
    phantom.isPhantom = true;
    this.phantomSprites.push(phantom);
  }

  getActiveArrow() {
    if (this.activeArrowIdx >= 0 && this.arrowFadeAlpha > 0) {
      return {
        arrow: ARROW_POOL[this.activeArrowIdx],
        alpha: this.arrowFadeAlpha,
      };
    }
    return null;
  }

  // Apply manic effects to sky color
  applySkyEffects(r, g, b, t, pulse) {
    if (this.manicMode && this.manicIntensity > 0) {
      let mi = this.manicIntensity;
      let horizonBias = 0.4 + t * 0.6;
      let warmth = mi * horizonBias;
      r = Math.min(255, r + warmth * 115) | 0;
      g = Math.min(255, g + warmth * 25) | 0;
      b = Math.max(50, b - warmth * 150) | 0;
      if (mi > 0.5) {
        let upper = (1 - t) * (mi - 0.5) * 2;
        r = Math.min(255, r + upper * 45) | 0;
        g = Math.max(70, g - upper * 35) | 0;
        b = Math.max(30, b - upper * 20) | 0;
      }
      if (mi > 0.25) {
        let shimmer = Math.sin(pulse * 2.2 + t * 0.04) * mi * 12;
        r = Math.min(255, r + shimmer) | 0;
        g = Math.min(255, g + shimmer * 0.4) | 0;
      }
    }
    return { r, g, b };
  }

  // Apply manic effects to grass color
  applyGrassEffects(r, g, b) {
    if (this.manicMode && this.manicIntensity > 0) {
      let mi = this.manicIntensity;
      g = Math.min(210, g + mi * 75) | 0;
      r = Math.max(20, r - mi * 15) | 0;
      b = Math.max(40, b + mi * 20) | 0;
    }
    return { r, g, b };
  }

  // Apply manic effects to wall color
  applyWallEffects(r, g, b, tileType) {
    if (this.manicMode && this.worldBloom > 0 && tileType === 1) {
      g = Math.min(200, g + this.worldBloom * 35) | 0;
    }
    return { r, g, b };
  }
}
