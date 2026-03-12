// ================================================================
//  DEPRESSION OVERLAYS MODULE
//  Visual overlay effects for depression state
// ================================================================

export function drawDepressionOverlays(ctx, W, H, depressionIntensity, pulse) {
  const intensity = depressionIntensity;
  if (intensity <= 0) return;

  // ── 1. Global dimming ────────────────────────────────────────
  let dimAlpha = 0.16 + intensity * 0.24;
  ctx.fillStyle = `rgba(10, 14, 24, ${dimAlpha})`;
  ctx.fillRect(0, 0, W, H);

  // ── 2. Blue-gray wash ────────────────────────────────────────
  let washAlpha = 0.08 + intensity * 0.14;
  ctx.fillStyle = `rgba(34, 48, 78, ${washAlpha})`;
  ctx.fillRect(0, 0, W, H);

  // ── 3. Heavy vignette ────────────────────────────────────────
  let pulseVignette = 1 + Math.sin(pulse * 0.35) * 0.05;
  let vignetteAlpha = Math.min(0.88, (0.32 + intensity * 0.36) * pulseVignette);
  let vg = ctx.createRadialGradient(
    W / 2,
    H / 2,
    H * 0.22,
    W / 2,
    H / 2,
    H * 0.86,
  );
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(0.56, "rgba(0,0,0,0)");
  vg.addColorStop(1, `rgba(4, 6, 12, ${vignetteAlpha})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}
