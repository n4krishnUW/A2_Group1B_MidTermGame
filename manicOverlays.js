// ================================================================
//  MANIC OVERLAYS MODULE
//  Visual overlay effects for manic episode
// ================================================================

export function drawManicOverlays(
  ctx,
  W,
  H,
  manicIntensity,
  pulse,
  P,
  MOVE_SPEED,
  MANIC_SPEED_MULTIPLIER,
) {
  const intensity = manicIntensity;

  // ── 1. EUPHORIC EDGE SHIMMER ─────────────────────────────────
  if (intensity > 0.15) {
    let shimmerPulse = (Math.sin(pulse * 1.8) + 1) / 2;
    let shimmerAlpha = intensity * 0.18 * (0.7 + shimmerPulse * 0.3);
    let edgeGlow = ctx.createRadialGradient(
      W / 2,
      H / 2,
      H * 0.3,
      W / 2,
      H / 2,
      H * 0.85,
    );
    edgeGlow.addColorStop(0, "rgba(0,0,0,0)");
    edgeGlow.addColorStop(0.6, "rgba(0,0,0,0)");
    edgeGlow.addColorStop(0.85, `rgba(255, 200, 50, ${shimmerAlpha * 0.4})`);
    edgeGlow.addColorStop(1, `rgba(255, 160, 20, ${shimmerAlpha})`);
    ctx.fillStyle = edgeGlow;
    ctx.fillRect(0, 0, W, H);
  }

  // ── 2. WORLD SATURATION BOOST ────────────────────────────────
  if (intensity > 0.3) {
    let warmAlpha = (intensity - 0.3) * 0.12;
    ctx.fillStyle = `rgba(255, 180, 20, ${warmAlpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ── 3. PERIPHERAL BURN ───────────────────────────────────────
  if (intensity > 0.05) {
    let spdFrac =
      Math.abs(P.spd) > 0.5
        ? Math.min(1, Math.abs(P.spd) / (MOVE_SPEED * MANIC_SPEED_MULTIPLIER))
        : 0.3;
    let baseAlpha = intensity * 0.12 + spdFrac * intensity * 0.08;
    let breathe = 1 + Math.sin(pulse * 1.8) * 0.12;
    let glowAlpha = Math.min(0.88, baseAlpha * breathe);
    let reach = 0.25 + intensity * 0.2;

    ctx.save();

    // Left
    let lg = ctx.createLinearGradient(0, 0, W * reach, 0);
    lg.addColorStop(0, `rgba(255, 160, 20, ${glowAlpha})`);
    lg.addColorStop(0.6, `rgba(255, 140, 10, ${glowAlpha * 0.4})`);
    lg.addColorStop(1, `rgba(255, 120,  0, 0)`);
    ctx.fillStyle = lg;
    ctx.fillRect(0, 0, W * reach, H);

    // Right
    let rg = ctx.createLinearGradient(W, 0, W * (1 - reach), 0);
    rg.addColorStop(0, `rgba(255, 160, 20, ${glowAlpha})`);
    rg.addColorStop(0.6, `rgba(255, 140, 10, ${glowAlpha * 0.4})`);
    rg.addColorStop(1, `rgba(255, 120,  0, 0)`);
    ctx.fillStyle = rg;
    ctx.fillRect(W * (1 - reach), 0, W * reach, H);

    // Top
    let tg = ctx.createLinearGradient(0, 0, 0, H * reach * 0.5);
    tg.addColorStop(0, `rgba(255, 140, 10, ${glowAlpha * 0.7})`);
    tg.addColorStop(1, `rgba(255, 120,  0, 0)`);
    ctx.fillStyle = tg;
    ctx.fillRect(0, 0, W, H * reach * 0.5);

    // Bottom
    let bg2 = ctx.createLinearGradient(0, H, 0, H * (1 - reach * 0.5));
    bg2.addColorStop(0, `rgba(255, 140, 10, ${glowAlpha * 0.7})`);
    bg2.addColorStop(1, `rgba(255, 120,  0, 0)`);
    ctx.fillStyle = bg2;
    ctx.fillRect(0, H * (1 - reach * 0.5), W, H * reach * 0.5);

    ctx.restore();
  }
}

export function drawRoadArrow(
  ctx,
  cx,
  sy,
  sw,
  sh,
  sd,
  fog,
  direction,
  pulse,
  zBuf,
  W,
) {
  // Check z-buffer
  function colOk(x, sd) {
    let xi = Math.max(0, Math.min(W - 1, x | 0));
    return zBuf[xi] >= sd;
  }

  if (!colOk(cx, sd)) return;
  if (sw < 8) return;
  const f = fog;

  const numPanels = 3;
  const panW = sw * 0.42;
  const panH = sh * 0.7;
  const gap = sw * 0.07;

  const floatOff = Math.sin(pulse * 1.6) * sh * 0.06;
  const pulseCycle = pulse * 2.8;

  // Halo
  const haloR = sw * 1.4;
  const haloAlpha = (0.4 + (Math.sin(pulseCycle) + 1) * 0.2) * f;
  const haloGrad = ctx.createRadialGradient(
    cx,
    sy + floatOff,
    0,
    cx,
    sy + floatOff,
    haloR,
  );
  haloGrad.addColorStop(0, `rgba(255, 200, 60, ${haloAlpha * 0.7})`);
  haloGrad.addColorStop(0.5, `rgba(255, 150, 20, ${haloAlpha * 0.3})`);
  haloGrad.addColorStop(1, `rgba(255, 100,  0, 0)`);
  ctx.fillStyle = haloGrad;
  ctx.beginPath();
  ctx.arc(cx, sy + floatOff, haloR, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(cx, sy + sh * 0.5 + floatOff);
  ctx.rotate(direction);

  for (let i = 0; i < numPanels; i++) {
    const wave = (Math.sin(pulseCycle - i * 1.0) + 1) / 2;
    const bright = 0.65 + wave * 0.35;

    const px = (i - (numPanels - 1) / 2) * (panW + gap);
    const py = -panH / 2;

    ctx.fillStyle = `rgba(${(255 * f) | 0}, ${(170 * f * bright) | 0}, ${(10 * f) | 0}, ${(0.55 + wave * 0.2) * f})`;
    ctx.beginPath();
    ctx.roundRect(px - panW / 2, py, panW, panH, 4);
    ctx.fill();

    ctx.strokeStyle = `rgba(255, ${(220 * bright) | 0}, ${(80 * bright) | 0}, ${0.98 * f})`;
    ctx.lineWidth = Math.max(2, sw * 0.07);
    ctx.beginPath();
    ctx.roundRect(px - panW / 2, py, panW, panH, 4);
    ctx.stroke();

    const chW = panW * 0.28;
    const chH = panH * 0.38;
    ctx.strokeStyle = `rgba(255, 255, ${(180 * bright) | 0}, ${0.95 * f})`;
    ctx.lineWidth = Math.max(2, sw * 0.055);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px + chW, -chH);
    ctx.lineTo(px - chW, 0);
    ctx.lineTo(px + chW, chH);
    ctx.stroke();

    ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 * f * bright})`;
    ctx.lineWidth = Math.max(0.8, sw * 0.025);
    ctx.beginPath();
    ctx.moveTo(px - panW / 2 + 3, py + panH * 0.18);
    ctx.lineTo(px - panW / 2 + 3, py + 3);
    ctx.lineTo(px + panW * 0.15, py + 3);
    ctx.stroke();
  }

  ctx.restore();
}
