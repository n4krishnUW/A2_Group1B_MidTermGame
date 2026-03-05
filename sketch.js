// ================================================================
//  CROSSY MIND — raw Canvas2D raycaster (sketch.js)
//  A -> B only, better road floor, standout buildings + labels
// ================================================================

// Import manic state modules
import {
  ManicState,
  MANIC_CHECKPOINT_ZONE,
  MANIC_SPEED_MULTIPLIER,
  ARROW_POOL,
} from "./manicState.js";
import { drawManicOverlays, drawRoadArrow } from "./manicOverlays.js";

// ── Constants ────────────────────────────────────────────────
const ROWS = 40,
  COLS = 40;
const MOVE_SPEED = 3.5; // tiles/sec top speed
const ACCEL = 22; // how fast you reach top speed
const DECEL = 16; // coasting friction
const TURN_SPEED = 2.5; // rad/sec
const GOAL_R = 1.4;
const FOV = Math.PI / 3;
const MAX_D = 24;

// ── Canvas setup ─────────────────────────────────────────────
let canvas, ctx;

let W = 0,
  H = 0;
let imgData, buf32, zBuf;

// roundRect polyfill (for older browsers)
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
    return this;
  };
}

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
  imgData = ctx.createImageData(W, H);
  buf32 = new Uint32Array(imgData.data.buffer);
  zBuf = new Float32Array(W);
}
window.addEventListener("resize", resize);

// ── Map ──────────────────────────────────────────────────────
// 0=road  1=grass wall  2=kerb  3=comm.centre  4=hospital
let MAP = [];

function buildMap() {
  MAP = [];
  for (let r = 0; r < ROWS; r++) MAP.push(new Uint8Array(COLS).fill(1));

  // Roads (fat lines)
  [3, 10, 18, 26, 34].forEach((r) => {
    for (let c = 0; c < COLS; c++) {
      MAP[r][c] = 0;
      if (r + 1 < ROWS) MAP[r + 1][c] = 0;
    }
  });
  [3, 10, 18, 26, 34].forEach((c) => {
    for (let r = 0; r < ROWS; r++) {
      MAP[r][c] = 0;
      if (c + 1 < COLS) MAP[r][c + 1] = 0;
    }
  });

  // Kerb around roads
  let sw = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === 0) {
        for (let [dr, dc] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          let nr = r + dr,
            nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && MAP[nr][nc] === 1)
            sw.add(nr * 100 + nc);
        }
      }
    }
  sw.forEach((k) => {
    MAP[(k / 100) | 0][k % 100] = 2;
  });

  // Goal buildings occupy 2x2 blocks
  for (let dr = 0; dr < 2; dr++)
    for (let dc = 0; dc < 2; dc++) {
      if (3 + dr < ROWS && 3 + dc < COLS) MAP[3 + dr][3 + dc] = 3;
      if (34 + dr < ROWS && 34 + dc < COLS) MAP[34 + dr][34 + dc] = 4;
    }
}

function solid(x, y) {
  let c = x | 0,
    r = y | 0;
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
  return MAP[r][c] !== 0;
}

// ── Goals ────────────────────────────────────────────────────
const GA = { x: 5.5, y: 3.5, label: "Community Centre" };
const GB = { x: 33.5, y: 34.5, label: "Hospital" };

// ── Player ───────────────────────────────────────────────────
let P = { x: 0, y: 0, a: 0, spd: 0 };

// ── NPCs ─────────────────────────────────────────────────────
let NPCS = [];
const NPC_INIT = [
  // Original cars
  { x: 6, y: 3.5, vx: 2.5, vy: 0, r: 220, g: 70, b: 80 },
  { x: 30, y: 10.5, vx: -2.2, vy: 0, r: 70, g: 130, b: 220 },
  { x: 18.5, y: 7, vx: 0, vy: 2.0, r: 240, g: 190, b: 50 },
  { x: 26.5, y: 19, vx: 0, vy: -2.0, r: 220, g: 70, b: 80 },
  { x: 9, y: 26.5, vx: 2.8, vy: 0, r: 70, g: 130, b: 220 },
  { x: 34.5, y: 27, vx: 0, vy: 1.6, r: 240, g: 190, b: 50 },
  { x: 12, y: 18.5, vx: 2.0, vy: 0, r: 180, g: 100, b: 220 },
  { x: 20, y: 26.5, vx: -2.4, vy: 0, r: 80, g: 200, b: 160 },
  // Extra cars — denser traffic across the whole map
  { x: 14, y: 3.5, vx: -2.8, vy: 0, r: 255, g: 140, b: 0 },
  { x: 22, y: 10.5, vx: 3.0, vy: 0, r: 160, g: 80, b: 200 },
  { x: 3.5, y: 15, vx: 0, vy: 2.2, r: 255, g: 80, b: 120 },
  { x: 10.5, y: 22, vx: 0, vy: -2.6, r: 50, g: 200, b: 180 },
  { x: 28, y: 18.5, vx: -3.2, vy: 0, r: 255, g: 220, b: 50 },
  { x: 18.5, y: 30, vx: 0, vy: 2.4, r: 200, g: 60, b: 60 },
  { x: 26.5, y: 34.5, vx: 3.5, vy: 0, r: 80, g: 160, b: 255 },
  { x: 34.5, y: 18.5, vx: 0, vy: -3.0, r: 255, g: 160, b: 80 },
];

// ── Static sprites ───────────────────────────────────────────
let SPRITES = [];

function buildScene() {
  NPCS = NPC_INIT.map((n) => ({ ...n }));
  SPRITES = [];

  // Trees
  [
    [1.5, 1.5],
    [7.5, 1.5],
    [13.5, 2.5],
    [21.5, 1.5],
    [29.5, 2.5],
    [1.5, 7.5],
    [7.5, 7.5],
    [13.5, 7.5],
    [21.5, 7.5],
    [29.5, 8.5],
    [1.5, 13.5],
    [6.5, 13.5],
    [14.5, 13.5],
    [22.5, 14.5],
    [30.5, 13.5],
    [1.5, 21.5],
    [8.5, 21.5],
    [15.5, 20.5],
    [23.5, 21.5],
    [31.5, 21.5],
    [2.5, 29.5],
    [9.5, 29.5],
    [16.5, 30.5],
    [24.5, 29.5],
    [32.5, 29.5],
    [1.5, 36.5],
    [8.5, 37.5],
    [15.5, 36.5],
    [23.5, 37.5],
    [30.5, 36.5],
    [6.5, 6.5],
    [12.5, 12.5],
    [20.5, 20.5],
    [28.5, 28.5],
  ].forEach(([x, y]) => SPRITES.push({ x, y, t: 0 }));

  // STOP signs
  [
    [2.5, 2.5],
    [9.5, 2.5],
    [9.5, 9.5],
    [17.5, 9.5],
    [17.5, 17.5],
    [25.5, 17.5],
    [25.5, 25.5],
    [33.5, 25.5],
    [2.5, 9.5],
    [2.5, 17.5],
    [9.5, 25.5],
  ].forEach(([x, y]) => SPRITES.push({ x, y, t: 1 }));

  // Goal building anchors (visual)
  SPRITES.push({ x: 5.2, y: 5.2, t: 3 });
  SPRITES.push({ x: 33.0, y: 33.0, t: 4 }); // real hospital

  // Extra decorative buildings
  SPRITES.push({ x: 12.5, y: 5.6, t: 6, name: "LIBRARY" });
  SPRITES.push({ x: 8.8, y: 31.2, t: 8, name: "SCHOOL" });

  // Checkpoint marker (type 10)
  SPRITES.push({
    x: MANIC_CHECKPOINT_ZONE.x,
    y: MANIC_CHECKPOINT_ZONE.y,
    t: 10,
  });

  // Glowing road arrows — stored in ARROW_POOL, only ONE shown at a time during manic mode
  // (populated after buildMap so ARROW_POOL is a const at module level)

  // ── Misleading HOSPITAL signs (type 9) — manic mode only ────
  // Placed on grass just beside roads between intersections,
  // like real wayfinding signs. Each has a `dir` (arrow direction in
  // world-space radians, 0 = East/right) and a `label` so the arrow
  // and text always agree — but the directions are wrong, sending the
  // player away from the actual hospital (bottom-right, ~33,34).
  //
  // Map roads at cols/rows: 3,10,18,26,34 (2 tiles wide each)
  // Signs sit 1 tile off the road edge on grass, mid-block.
  //
  // Section A: around the mid-map roads (col 18, row 18 area)
  // Player is heading SE toward hospital — signs point NW, W, N (wrong)

  // On col-road 18, between row-roads 10 and 18 — sign points LEFT (West = away)
  SPRITES.push({ x: 16.5, y: 14.5, t: 9, dir: Math.PI, label: "← HOSPITAL" });

  // On row-road 18, between col-roads 10 and 18 — sign points UP (North = away)
  SPRITES.push({
    x: 14.5,
    y: 16.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ HOSPITAL",
  });

  // On col-road 26, between row-roads 18 and 26 — sign points LEFT (West = away)
  SPRITES.push({ x: 24.5, y: 22.5, t: 9, dir: Math.PI, label: "← HOSPITAL" });

  // On row-road 26, between col-roads 18 and 26 — sign points UP (North = away)
  SPRITES.push({
    x: 22.5,
    y: 24.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ HOSPITAL",
  });

  // Section B: closer to the hospital quadrant
  SPRITES.push({ x: 24.5, y: 30.5, t: 9, dir: Math.PI, label: "← HOSPITAL" });
  SPRITES.push({
    x: 30.5,
    y: 36.5,
    t: 9,
    dir: Math.PI / 2,
    label: "↓ HOSPITAL",
  });
  SPRITES.push({ x: 36.5, y: 30.5, t: 9, dir: 0, label: "→ HOSPITAL" });
  SPRITES.push({
    x: 30.5,
    y: 24.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ HOSPITAL",
  });

  // Section C: early/mid map — mislead player from the very start of manic mode
  // On col-road 10, between row-roads 3 and 10 — points left (wrong, hospital is right)
  SPRITES.push({ x: 8.5, y: 7.0, t: 9, dir: Math.PI, label: "← HOSPITAL" });
  // On row-road 10, between col-roads 10 and 18 — points up
  SPRITES.push({
    x: 14.5,
    y: 8.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ HOSPITAL",
  });
  // On col-road 18, between row-roads 3 and 10 — points right (back toward start)
  SPRITES.push({ x: 20.5, y: 7.0, t: 9, dir: 0, label: "→ HOSPITAL" });
  // On row-road 18, between col-roads 3 and 10 — points left
  SPRITES.push({ x: 7.0, y: 16.5, t: 9, dir: Math.PI, label: "← HOSPITAL" });
  // On col-road 10, between row-roads 10 and 18 — points down (away)
  SPRITES.push({
    x: 8.5,
    y: 14.5,
    t: 9,
    dir: Math.PI / 2,
    label: "↓ HOSPITAL",
  });
  // On row-road 10, between col-roads 3 and 10 — points up
  SPRITES.push({
    x: 7.0,
    y: 8.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ HOSPITAL",
  });
  // On col-road 26, between row-roads 10 and 18 — points left
  SPRITES.push({ x: 24.5, y: 14.5, t: 9, dir: Math.PI, label: "← HOSPITAL" });
  // On row-road 18, between col-roads 18 and 26 — points down
  SPRITES.push({
    x: 22.5,
    y: 20.5,
    t: 9,
    dir: Math.PI / 2,
    label: "↓ HOSPITAL",
  });
  // On col-road 18, between row-roads 18 and 26 — points right (overshoots)
  SPRITES.push({ x: 20.5, y: 22.5, t: 9, dir: 0, label: "→ HOSPITAL" });
  // On row-road 26, between col-roads 10 and 18 — points left
  SPRITES.push({ x: 14.5, y: 24.5, t: 9, dir: Math.PI, label: "← HOSPITAL" });
}

// ── Game state ───────────────────────────────────────────────
let gameState = "warning";
let tripPhase = 0; // 0=going to hospital, 1=returning to start
let pulse = 0;
const KEYS = {};
let initialDistanceToGoal = 0;

// ── Accessibility Settings ───────────────────────────────────
let reducedEffectsMode = false;
let skipManicEpisode = false;

// ── Manic Episode State (using module) ──────────────────────
const manicState = new ManicState();

function resetGame() {
  // Start in centre of right lane (lower tile of the eastbound road)
  // Roads are 2 tiles wide; row 3+4, col 3+4. Right lane east = y=4.5.
  P = { x: 5.5, y: 4.5, a: 0, spd: 0 };
  pulse = 0;
  tripPhase = 0;
  initialDistanceToGoal = Math.hypot(GB.x - GA.x, GB.y - GA.y);

  // Reset manic state using module
  manicState.reset();

  buildScene();
}

// ── Input ────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  KEYS[e.code] = true;
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      e.code,
    )
  )
    e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  KEYS[e.code] = false;
});

function showGame() {
  document.getElementById("screen-intro").style.display = "none";
  document.getElementById("screen-win").style.display = "none";
  document.getElementById("hud").style.display = "block";
  document.getElementById("compass").style.display = "block";
  document.getElementById("minimap-wrap").style.display = "block";
  gameState = "playing";
}
function showWin() {
  document.getElementById("hud").style.display = "none";
  document.getElementById("compass").style.display = "none";
  document.getElementById("minimap-wrap").style.display = "none";
  document.getElementById("screen-win").style.display = "flex";
  gameState = "win";
}

// ── Road preview on intro ─────────────────────────────────────
function drawRoadPreview() {
  const pc = document.getElementById("road-preview");
  if (!pc) return;
  const px = pc.getContext("2d");
  const pw = pc.width,
    ph = pc.height;
  const hor = ph * 0.25;
  let sg = px.createLinearGradient(0, 0, 0, hor);
  sg.addColorStop(0, "#a0c8f0");
  sg.addColorStop(1, "#d4e8ff");
  px.fillStyle = sg;
  px.fillRect(0, 0, pw, hor);
  let rg = px.createLinearGradient(0, hor, 0, ph);
  rg.addColorStop(0, "#787888");
  rg.addColorStop(1, "#3a3a48");
  px.fillStyle = rg;
  px.fillRect(0, hor, pw, ph - hor);
  px.strokeStyle = "rgba(255,240,100,0.6)";
  px.lineWidth = 2;
  for (let i = -3; i <= 3; i++) {
    px.beginPath();
    px.moveTo(pw / 2, hor);
    px.lineTo(pw / 2 + i * 90, ph);
    px.stroke();
  }
  px.strokeStyle = "rgba(180,210,255,0.4)";
  px.lineWidth = 1;
  px.beginPath();
  px.moveTo(0, hor);
  px.lineTo(pw, hor);
  px.stroke();
}
drawRoadPreview();

// ================================================================
//  MAIN LOOP
// ================================================================
let lastT = 0;
function loop(t) {
  requestAnimationFrame(loop);
  let dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  if (gameState !== "playing") return;
  pulse += dt;

  // Update manic state using module
  manicState.update(
    dt,
    pulse,
    P,
    GB,
    initialDistanceToGoal,
    skipManicEpisode,
    reducedEffectsMode,
  );

  update(dt);
  render();
  updateHUD();
  updateCompass();
  updateMinimap();
}
requestAnimationFrame(loop);

// ================================================================
//  UPDATE
// ================================================================
function update(dt) {
  let speedMult = manicState.manicMode ? MANIC_SPEED_MULTIPLIER : 1.0;
  let maxSpeed = MOVE_SPEED * speedMult;
  let accelRate = ACCEL * speedMult;

  if (manicState.manicMode && manicState.manicIntensity > 0.4) {
    speedMult *= 1 + Math.sin(pulse * 3) * 0.15 * manicState.manicIntensity;
    maxSpeed = MOVE_SPEED * speedMult;
  }

  let turnInput = 0;
  if (KEYS["ArrowLeft"] || KEYS["KeyA"]) turnInput -= 1;
  if (KEYS["ArrowRight"] || KEYS["KeyD"]) turnInput += 1;

  // Subtle control drift
  if (manicState.manicMode && !skipManicEpisode) {
    turnInput += (Math.random() - 0.5) * manicState.controlDrift;
  }

  P.a += turnInput * TURN_SPEED * dt;

  let accelInput = 0;
  if (KEYS["ArrowUp"] || KEYS["KeyW"]) accelInput = 1;
  else if (KEYS["ArrowDown"] || KEYS["KeyS"]) accelInput = -0.6;

  if (accelInput > 0) {
    P.spd += accelRate * accelInput * dt;
    if (P.spd > maxSpeed) P.spd = maxSpeed;
  } else if (accelInput < 0) {
    P.spd += accelRate * accelInput * dt;
    if (P.spd < -maxSpeed * 0.45) P.spd = -maxSpeed * 0.45;
  } else {
    if (P.spd > 0) {
      P.spd -= DECEL * dt;
      if (P.spd < 0) P.spd = 0;
    }
    if (P.spd < 0) {
      P.spd += DECEL * dt;
      if (P.spd > 0) P.spd = 0;
    }
  }

  let dx = Math.cos(P.a) * P.spd * dt;
  let dy = Math.sin(P.a) * P.spd * dt;
  const M = 0.18;
  if (!solid(P.x + dx + (dx > 0 ? M : -M), P.y)) {
    P.x += dx;
  } else {
    P.spd *= Math.abs(Math.sin(P.a));
    dx = 0;
  }
  if (!solid(P.x, P.y + dy + (dy > 0 ? M : -M))) {
    P.y += dy;
  } else {
    P.spd *= Math.abs(Math.cos(P.a));
    dy = 0;
  }
  P.x = Math.max(0.5, Math.min(COLS - 0.5, P.x));
  P.y = Math.max(0.5, Math.min(ROWS - 0.5, P.y));

  NPCS.forEach((n) => {
    let speedMult2 = manicState.manicMode
      ? 1 + manicState.manicIntensity * 4.0
      : 1;
    // In manic mode: occasional random direction flips
    if (
      manicState.manicMode &&
      manicState.manicIntensity > 0.4 &&
      Math.random() < 0.002
    ) {
      if (n.vx !== 0) n.vx *= -1;
      if (n.vy !== 0) n.vy *= -1;
    }
    let nx = n.x + n.vx * speedMult2 * dt;
    let ny = n.y + n.vy * speedMult2 * dt;
    if (solid(nx, n.y)) n.vx *= -1;
    else n.x = nx;
    if (solid(n.x, ny)) n.vy *= -1;
    else n.y = ny;
  });

  if (tripPhase === 0) {
    let dd = Math.hypot(P.x - GB.x, P.y - GB.y);
    if (dd < GOAL_R) tripPhase = 1; // reached hospital, now go back
  } else {
    let dd = Math.hypot(P.x - GA.x, P.y - GA.y);
    if (dd < GOAL_R) showWin();
  }
}

// ================================================================
//  RENDER
// ================================================================
function render() {
  const W2 = W,
    H2 = H;
  const hor = H2 >> 1;
  const buf = buf32;
  const zb = zBuf;

  // ===== SKY =====
  for (let y = 0; y < hor; y++) {
    let t = y / hor; // 0=top, 1=horizon

    // Base: cool blue
    let r = (160 + t * 55) | 0;
    let g = (210 + t * 22) | 0;
    let b = (255 - t * 10) | 0;

    // Apply manic sky effects
    let skyColors = manicState.applySkyEffects(r, g, b, t, pulse);
    r = skyColors.r;
    g = skyColors.g;
    b = skyColors.b;

    let col = 0xff000000 | (b << 16) | (g << 8) | r;
    buf.fill(col, y * W2, y * W2 + W2);
  }

  // ===== FLOOR CASTING =====
  const dirX = Math.cos(P.a),
    dirY = Math.sin(P.a);
  const planeScale = Math.tan(FOV / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;
  const rayLx = dirX - planeX,
    rayLy = dirY - planeY;
  const rayRx = dirX + planeX,
    rayRy = dirY + planeY;

  let sunX = (W2 * 0.82) | 0,
    sunY = (hor * 0.26) | 0;
  let sunR = 22;
  if (manicState.manicMode && manicState.manicIntensity > 0)
    sunR = Math.min(55, 22 + manicState.manicIntensity * 40) | 0;

  for (let dy = -sunR; dy <= sunR; dy++)
    for (let dx = -sunR; dx <= sunR; dx++) {
      let dist2 = dx * dx + dy * dy;
      if (dist2 < sunR * sunR) {
        let px2 = sunX + dx,
          py = sunY + dy;
        if (px2 >= 0 && px2 < W2 && py >= 0 && py < hor) {
          if (manicState.manicMode && manicState.manicIntensity > 0) {
            let coreFrac = Math.sqrt(dist2) / sunR;
            let sr = 255;
            let sg = Math.max(160, 255 - coreFrac * 110) | 0;
            let sb =
              Math.max(
                20,
                200 - coreFrac * 180 - manicState.manicIntensity * 80,
              ) | 0;
            buf[py * W2 + px2] = 0xff000000 | (sb << 16) | (sg << 8) | sr;
          } else {
            buf[py * W2 + px2] = 0xff80e8ff;
          }
        }
      }
    }

  for (let y = hor; y < H2; y++) {
    const p = y - hor;
    const rowDist = (0.5 * H2) / Math.max(1, p);
    const fog = Math.max(0.06, 1 - rowDist / MAX_D);
    const stepX = (rowDist * (rayRx - rayLx)) / W2;
    const stepY = (rowDist * (rayRy - rayLy)) / W2;
    let fx = P.x + rowDist * rayLx;
    let fy = P.y + rowDist * rayLy;
    let rowBase = y * W2;

    for (let x = 0; x < W2; x++) {
      const cellX = fx | 0,
        cellY = fy | 0;
      let tile = 1;
      if (cellX >= 0 && cellX < COLS && cellY >= 0 && cellY < ROWS)
        tile = MAP[cellY][cellX];
      const lx = fx - cellX,
        ly = fy - cellY;
      let r, g, b;

      if (tile === 0) {
        const n =
          (((cellX * 37 + cellY * 17 + ((lx * 10) | 0) + ((ly * 10) | 0)) & 7) /
            7) *
          14;
        r = 70 + n;
        g = 70 + n;
        b = 86 + n;
        const nearCenter = Math.abs(lx - 0.5) < 0.03;
        const dash = ((fy * 2.2) | 0) % 4 < 2;
        if (nearCenter && dash) {
          r = 210;
          g = 190;
          b = 120;
        }
        const edge = lx < 0.05 || lx > 0.95 || ly < 0.05 || ly > 0.95;
        if (edge) {
          r = 120;
          g = 120;
          b = 140;
        }
      } else if (tile === 2) {
        const band = (((lx + ly) * 8) | 0) & 1;
        r = band ? 190 : 150;
        g = band ? 168 : 135;
        b = band ? 132 : 105;
      } else {
        const s = (((cellX * 13 + cellY * 29) & 7) / 7) * 18;
        r = 48 + s;
        g = 120 + s;
        b = 70 + s;
        // Apply manic grass effects
        let grassColors = manicState.applyGrassEffects(r, g, b);
        r = grassColors.r;
        g = grassColors.g;
        b = grassColors.b;
      }

      const vdim = 0.85 + 0.15 * (1 - p / (H2 - hor));
      const f = fog * vdim;
      r = (r * f) | 0;
      g = (g * f) | 0;
      b = (b * f) | 0;
      buf[rowBase + x] = 0xff000000 | (b << 16) | (g << 8) | r;
      fx += stepX;
      fy += stepY;
    }
  }

  // ===== WALLS =====
  for (let col = 0; col < W2; col++) {
    let ra = P.a - FOV / 2 + (col / W2) * FOV;
    let rdx = Math.cos(ra),
      rdy = Math.sin(ra);
    let mc = P.x | 0,
      mr = P.y | 0;
    let ddx = Math.abs(rdx) < 1e-10 ? 1e30 : Math.abs(1 / rdx);
    let ddy = Math.abs(rdy) < 1e-10 ? 1e30 : Math.abs(1 / rdy);
    let sc, sr, sdx, sdy;
    if (rdx < 0) {
      sc = -1;
      sdx = (P.x - mc) * ddx;
    } else {
      sc = 1;
      sdx = (mc + 1 - P.x) * ddx;
    }
    if (rdy < 0) {
      sr = -1;
      sdy = (P.y - mr) * ddy;
    } else {
      sr = 1;
      sdy = (mr + 1 - P.y) * ddy;
    }
    let hit = false,
      ns = false,
      tt = 1,
      safe = 0;
    while (!hit && safe++ < 140) {
      if (sdx < sdy) {
        sdx += ddx;
        mc += sc;
        ns = false;
      } else {
        sdy += ddy;
        mr += sr;
        ns = true;
      }
      if (mc < 0 || mc >= COLS || mr < 0 || mr >= ROWS) {
        hit = true;
        break;
      }
      if (MAP[mr][mc] !== 0) {
        hit = true;
        tt = MAP[mr][mc];
      }
    }
    let pd = ns
      ? (mr - P.y + (1 - sr) / 2) / rdy
      : (mc - P.x + (1 - sc) / 2) / rdx;
    pd = Math.max(pd, 0.01);
    zb[col] = pd;
    let wallH = (H2 / pd) | 0;
    let top = Math.max(0, (hor - wallH / 2) | 0);
    let bot = Math.min(H2 - 1, (hor + wallH / 2) | 0);
    let fog = Math.max(0.06, 1 - pd / MAX_D);
    let dim = ns ? 0.62 : 1.0;
    let f = fog * dim;
    let wr, wg, wb;
    if (tt === 1) {
      wr = 68;
      wg = 145;
      wb = 92;
    } else if (tt === 2) {
      wr = 200;
      wg = 180;
      wb = 140;
    } else if (tt === 3) {
      wr = 80;
      wg = 148;
      wb = 210;
    } else if (tt === 4) {
      wr = 210;
      wg = 85;
      wb = 88;
    } else {
      wr = 140;
      wg = 140;
      wb = 140;
    }

    // In manic mode: walls glow more warmly/vividly
    if (manicState.manicMode && manicState.worldBloom > 0) {
      if (tt === 1) {
        wg = Math.min(200, wg + manicState.worldBloom * 35) | 0;
      }
    }

    for (let y = top; y <= bot; y++) {
      let frac = (y - top) / Math.max(wallH, 1);
      let tr, tg, tb;
      if (tt === 3) {
        let band = (frac * 5) % 1;
        if (band > 0.12 && band < 0.68) {
          tr = 195;
          tg = 225;
          tb = 255;
        } else {
          tr = 70;
          tg = 128;
          tb = 190;
        }
      } else if (tt === 4) {
        let band = (frac * 8) % 1;
        if (band < 0.09) {
          tr = 120;
          tg = 50;
          tb = 52;
        } else {
          tr = 205;
          tg = 80;
          tb = 82;
        }
      } else if (tt === 2) {
        let band = (frac * 5) % 1;
        tr = band < 0.07 ? 130 : 200;
        tg = band < 0.07 ? 115 : 178;
        tb = band < 0.07 ? 88 : 138;
      } else {
        let band = (frac * 7) % 1;
        tr = band < 0.1 ? 45 : wr;
        tg = band < 0.1 ? 95 : wg;
        tb = band < 0.1 ? 58 : wb;
      }
      let r2 = (tr * f) | 0,
        g2 = (tg * f) | 0,
        b2 = (tb * f) | 0;
      buf[y * W2 + col] = 0xff000000 | (b2 << 16) | (g2 << 8) | r2;
    }
  }

  // ===== Sprites =====
  let all = [...SPRITES];
  NPCS.forEach((n) =>
    all.push({ x: n.x, y: n.y, t: 5, r: n.r, g: n.g, b: n.b }),
  );
  manicState.phantomSprites.forEach((ps) => {
    let alpha = Math.min(1, ps.life / 2);
    all.push({ ...ps, alpha });
  });

  // Arrow drawn separately after shake restore (see below)

  all.sort(
    (a, b) =>
      Math.hypot(b.x - P.x, b.y - P.y) - Math.hypot(a.x - P.x, a.y - P.y),
  );

  ctx.putImageData(imgData, 0, 0);

  // Apply very subtle screen rotation (feels like energy, not horror)
  if (
    manicState.manicMode &&
    !skipManicEpisode &&
    manicState.screenRotation !== 0
  ) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(manicState.screenRotation);
    ctx.translate(
      -W / 2 + manicState.shakeOffsetX,
      -H / 2 + manicState.shakeOffsetY,
    );
  }

  for (const sp of all) {
    let dx = sp.x - P.x,
      dy = sp.y - P.y;
    let sd = Math.sqrt(dx * dx + dy * dy);
    if (sd < 0.2 || sd > MAX_D) continue;
    let sa = Math.atan2(dy, dx) - P.a;
    while (sa > Math.PI) sa -= Math.PI * 2;
    while (sa < -Math.PI) sa += Math.PI * 2;
    if (Math.abs(sa) > FOV * 0.8) continue;
    let sx = (0.5 + sa / FOV) * W2;
    let fog = Math.max(0.06, 1 - sd / MAX_D);
    let spH = (H2 / sd) | 0;
    let spW = spH;
    let startX = (sx - spW / 2) | 0;
    let startY = (hor - spH / 2) | 0;

    ctx.save();
    ctx.globalAlpha = fog * (sp.alpha !== undefined ? sp.alpha : 1);

    if (sp.t === 0) drawTree(sx, startY, spW, spH, sd, fog);
    else if (sp.t === 1) drawStop(sx, startY, spW, spH, sd, fog);
    else if (sp.t === 3) {
      drawCommunity(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, GA.label);
    } else if (sp.t === 4) {
      drawHospital(sx, startY, spW, spH, sd, fog);
    } else if (sp.t === 6) {
      drawLibrary(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "LIBRARY");
    } else if (sp.t === 8) {
      drawSchool(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "SCHOOL");
    } else if (sp.t === 9 && manicState.manicMode)
      drawMisleadingSign(sx, startY, spW, spH, sd, fog, sp.dir, sp.label);
    else if (sp.t === 10 && !manicState.hasPassedCheckpoint)
      drawCheckpointMarker(sx, startY, spW, spH, sd, fog);
    else if (sp.t === 5)
      drawCar3D(startX, startY, spW, spH, sd, fog, sp.r, sp.g, sp.b);
    ctx.restore();
  }

  if (
    manicState.manicMode &&
    !skipManicEpisode &&
    manicState.screenRotation !== 0
  ) {
    ctx.restore();
  }

  // ── Draw active arrow in clean unshaken ctx ───────────────
  let activeArrow = manicState.getActiveArrow();
  if (activeArrow) {
    let ap = activeArrow.arrow;
    let adx = ap.x - P.x,
      ady = ap.y - P.y;
    let dirX2 = Math.cos(P.a),
      dirY2 = Math.sin(P.a);
    let planeScale2 = Math.tan(FOV / 2);
    let planeX2 = -dirY2 * planeScale2,
      planeY2 = dirX2 * planeScale2;
    let invDet = 1.0 / (planeX2 * dirY2 - dirX2 * planeY2);
    let transX = invDet * (dirY2 * adx - dirX2 * ady);
    let transY = invDet * (-planeY2 * adx + planeX2 * ady);
    if (transY > 0.15 && transY < MAX_D) {
      let screenX = ((W / 2) * (1 + transX / transY)) | 0;
      let spH2 = Math.abs(H / transY) | 0;
      let startY2 = H / 2 - spH2 / 2;
      let fog2 = Math.max(0.1, 1 - transY / MAX_D);
      // Only draw if roughly in front (not clipped too far off-screen)
      if (screenX > -spH2 && screenX < W + spH2) {
        ctx.save();
        ctx.globalAlpha = activeArrow.alpha;
        drawRoadArrow(
          ctx,
          screenX,
          startY2,
          spH2,
          spH2,
          transY,
          fog2,
          ap.dir,
          pulse,
          zBuf,
          W,
        );
        ctx.restore();
      }
    }
  }

  // ===== NEW: AUTHENTIC MANIA OVERLAYS =====
  if (
    manicState.manicMode &&
    !skipManicEpisode &&
    manicState.manicIntensity > 0
  ) {
    drawManicOverlays(
      ctx,
      W,
      H,
      manicState.manicIntensity,
      pulse,
      P,
      MOVE_SPEED,
      MANIC_SPEED_MULTIPLIER,
    );
  }
}

// ── Sprite utils ────────────────────────────────────────────
function colOk(x, sd) {
  let xi = Math.max(0, Math.min(W - 1, x | 0));
  return zBuf[xi] >= sd;
}

function drawLabelAbove(cx, sy, sw, sd, fog, txt) {
  if (!colOk(cx, sd)) return;
  const y = sy - Math.max(14, sw * 0.18);
  ctx.font = `800 ${Math.max(10, sw * 0.16) | 0}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = `rgba(200,160,255,${0.45 * fog})`;
  ctx.fillText(txt.toUpperCase(), cx, y);
  ctx.fillStyle = `rgba(255,255,255,${0.9 * fog})`;
  ctx.fillText(txt.toUpperCase(), cx, y);
  const w = Math.max(40, sw * 0.95);
  ctx.fillStyle = `rgba(200,132,252,${0.35 * fog})`;
  ctx.fillRect(cx - w / 2, y + 10, w, 2);
}

function drawTree(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  let tx = cx - sw / 2;
  ctx.fillStyle = `rgba(0,0,0,${0.22 * fog})`;
  ctx.fillRect(tx + sw * 0.2, sy + sh * 0.92, sw * 0.6, sh * 0.05);
  let tW = Math.max(3, sw * 0.16),
    tX = cx - tW / 2;
  ctx.fillStyle = `rgb(${(80 * fog) | 0},${(52 * fog) | 0},${(24 * fog) | 0})`;
  ctx.fillRect(tX, sy + sh * 0.68, tW, sh * 0.32);
  let cv = fog;
  [
    [0.0, 1.0, 0.95],
    [0.15, 0.82, 0.8],
    [0.3, 0.64, 0.65],
  ].forEach(([yOff, wFrac, bright]) => {
    // In manic mode trees are more vivid green
    let gBoost = manicState.manicMode ? 1 + manicState.worldBloom * 0.3 : 1;
    ctx.fillStyle = `rgb(${(34 * cv * bright) | 0},${Math.min(255, 132 * cv * bright * gBoost) | 0},${(50 * cv * bright) | 0})`;
    ctx.beginPath();
    ctx.moveTo(cx, sy + sh * yOff);
    ctx.lineTo(cx - (sw * wFrac) / 2, sy + sh * (yOff + 0.36));
    ctx.lineTo(cx + (sw * wFrac) / 2, sy + sh * (yOff + 0.36));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = `rgba(100,200,80,${0.18 * cv})`;
    ctx.beginPath();
    ctx.moveTo(cx, sy + sh * yOff);
    ctx.lineTo(cx + sw * wFrac * 0.12, sy + sh * (yOff + 0.36));
    ctx.lineTo(cx, sy + sh * (yOff + 0.34));
    ctx.closePath();
    ctx.fill();
  });
}

function drawStop(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  let f = fog;
  let pw = Math.max(2, sw * 0.1),
    ph = sh * 0.5;
  ctx.fillStyle = `rgb(${(155 * f) | 0},${(155 * f) | 0},${(155 * f) | 0})`;
  ctx.fillRect(cx - pw / 2, sy + sh * 0.5, pw, ph);
  let r = sw * 0.38,
    ocy = sy + sh * 0.25;
  ctx.fillStyle = `rgb(${(210 * f) | 0},${(32 * f) | 0},${(32 * f) | 0})`;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    let a = (i * Math.PI) / 4 - Math.PI / 8;
    if (i === 0) ctx.moveTo(cx + Math.cos(a) * r, ocy + Math.sin(a) * r);
    else ctx.lineTo(cx + Math.cos(a) * r, ocy + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgb(${(240 * f) | 0},${(240 * f) | 0},${(240 * f) | 0})`;
  ctx.lineWidth = Math.max(1, sw * 0.06);
  ctx.stroke();
  if (sw > 12) {
    ctx.fillStyle = `rgb(${(250 * f) | 0},${(250 * f) | 0},${(250 * f) | 0})`;
    ctx.font = `bold ${Math.max(6, sw * 0.26) | 0}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("STOP", cx, ocy);
  }
}

function drawMisleadingSign(cx, sy, sw, sh, sd, fog, direction, label) {
  if (!colOk(cx, sd)) return;
  let f = fog;

  // Gentle pulse — attention-grabbing but not alarming
  let flashIntensity = (Math.sin(pulse * 4) + 1) / 2;

  // ── Pole ─────────────────────────────────────────────────────
  let pw = Math.max(2, sw * 0.08);
  let poleTop = sy + sh * 0.45;
  let poleBot = sy + sh;
  ctx.fillStyle = `rgb(${(140 * f) | 0},${(140 * f) | 0},${(140 * f) | 0})`;
  ctx.fillRect(cx - pw / 2, poleTop, pw, poleBot - poleTop);

  // ── Sign board — taller to give text and arrow separate rows ──
  let signW = Math.max(sw * 1.1, 30);
  let signH = sh * 0.42;
  let signX = cx - signW / 2;
  let signY = sy + sh * 0.04;

  // Background: white like a real wayfinding sign
  let brightness = 0.88 + flashIntensity * 0.12;
  ctx.fillStyle = `rgb(${(255 * f * brightness) | 0},${(255 * f * brightness) | 0},${(245 * f * brightness) | 0})`;
  ctx.roundRect(signX, signY, signW, signH, Math.max(2, sw * 0.06));
  ctx.fill();

  // Blue border (hospital wayfinding colour)
  ctx.strokeStyle = `rgb(${(30 * f) | 0},${(80 * f) | 0},${(160 * f) | 0})`;
  ctx.lineWidth = Math.max(1.5, sw * 0.05);
  ctx.roundRect(signX, signY, signW, signH, Math.max(2, sw * 0.06));
  ctx.stroke();

  // ── Divider between text row and arrow row ────────────────────
  let divY = signY + signH * 0.52;
  ctx.strokeStyle = `rgba(${(30 * f) | 0},${(80 * f) | 0},${(160 * f) | 0},0.4)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(signX + 4, divY);
  ctx.lineTo(signX + signW - 4, divY);
  ctx.stroke();

  if (sw > 10) {
    // ── Top half: "HOSPITAL" text with red cross ──────────────
    let textY = signY + signH * 0.27;
    let fontSize = Math.max(5, sw * 0.15) | 0;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Red cross icon to the left of text
    if (sw > 20) {
      let crossSize = Math.max(3, fontSize * 0.55);
      let crossX = signX + signW * 0.18;
      ctx.fillStyle = `rgb(${(210 * f) | 0},${(30 * f) | 0},${(40 * f) | 0})`;
      ctx.fillRect(
        crossX - crossSize * 0.5,
        textY - crossSize * 1.0,
        crossSize,
        crossSize * 2,
      );
      ctx.fillRect(
        crossX - crossSize * 1.0,
        textY - crossSize * 0.5,
        crossSize * 2,
        crossSize,
      );
    }

    ctx.fillStyle = `rgb(${(20 * f) | 0},${(20 * f) | 0},${(20 * f) | 0})`;
    ctx.fillText("HOSPITAL", cx + (sw > 20 ? signW * 0.06 : 0), textY);

    // ── Bottom half: arrow pointing in `direction` ────────────
    // direction is world-space angle (0=East). The arrow is drawn
    // pointing right (East) then rotated, so it always matches the label.
    let arrowCY = signY + signH * 0.76;
    let arrowLen = signW * 0.32;
    let arrowHead = arrowLen * 0.38;

    ctx.save();
    ctx.translate(cx, arrowCY);
    ctx.rotate(direction); // rotate so arrow tip points in `direction`

    ctx.strokeStyle = `rgb(${(30 * f) | 0},${(80 * f) | 0},${(160 * f) | 0})`;
    ctx.lineWidth = Math.max(1.5, sw * 0.06);
    ctx.lineCap = "round";

    // Shaft
    ctx.beginPath();
    ctx.moveTo(-arrowLen * 0.5, 0);
    ctx.lineTo(arrowLen * 0.5, 0);
    ctx.stroke();

    // Head (filled triangle pointing right before rotation)
    ctx.fillStyle = `rgb(${(30 * f) | 0},${(80 * f) | 0},${(160 * f) | 0})`;
    ctx.beginPath();
    ctx.moveTo(arrowLen * 0.5 + arrowHead * 0.6, 0);
    ctx.lineTo(arrowLen * 0.5 - arrowHead * 0.2, -arrowHead * 0.45);
    ctx.lineTo(arrowLen * 0.5 - arrowHead * 0.2, arrowHead * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

function drawCheckpointMarker(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  let f = fog;
  let pulseIntensity = (Math.sin(pulse * 3) + 1) / 2;
  let glowSize = sw * (1.2 + pulseIntensity * 0.3);
  let gradient = ctx.createRadialGradient(
    cx,
    sy + sh * 0.5,
    0,
    cx,
    sy + sh * 0.5,
    glowSize / 2,
  );
  gradient.addColorStop(0, `rgba(200, 100, 255, ${0.5 * f * pulseIntensity})`);
  gradient.addColorStop(
    0.5,
    `rgba(200, 100, 255, ${0.2 * f * pulseIntensity})`,
  );
  gradient.addColorStop(1, `rgba(200, 100, 255, 0)`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, sy + sh * 0.5, glowSize / 2, 0, Math.PI * 2);
  ctx.fill();
  let triSize = sw * 0.5;
  ctx.fillStyle = `rgb(${(255 * f) | 0},${(180 * f) | 0},${(50 * f) | 0})`;
  ctx.beginPath();
  ctx.moveTo(cx, sy + sh * 0.2);
  ctx.lineTo(cx - triSize / 2, sy + sh * 0.65);
  ctx.lineTo(cx + triSize / 2, sy + sh * 0.65);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = `rgb(${(200 * f) | 0},${(120 * f) | 0},${(0 * f) | 0})`;
  ctx.lineWidth = Math.max(1, sw * 0.05);
  ctx.stroke();
  if (sw > 8) {
    ctx.fillStyle = `rgb(${(40 * f) | 0},${(40 * f) | 0},${(40 * f) | 0})`;
    ctx.fillRect(cx - sw * 0.04, sy + sh * 0.32, sw * 0.08, sh * 0.2);
    ctx.beginPath();
    ctx.arc(cx, sy + sh * 0.58, sw * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 2; i++) {
    let offset = ((pulse * 2 + i * 1.5) % 3) / 3;
    let ringAlpha = (1 - offset) * 0.4 * f;
    ctx.strokeStyle = `rgba(200, 100, 255, ${ringAlpha})`;
    ctx.lineWidth = Math.max(1, sw * 0.03);
    ctx.beginPath();
    ctx.arc(cx, sy + sh * 0.5, sw * (0.4 + offset * 0.6), 0, Math.PI * 2);
    ctx.stroke();
  }
  if (sd < 8) drawLabelAbove(cx, sy, sw, sd, fog, "⚠ CHECKPOINT");
}

// ── Buildings ─────────────────────────────────────────────────
function drawCommunity(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 1.9,
    bh = sh * 2.0;
  const bx = cx - bw / 2,
    by = sy - sh * 0.55;
  ctx.fillStyle = `rgba(120,180,255,${0.22 * f})`;
  ctx.roundRect(bx - 3, by - 3, bw + 6, bh + 6, 18);
  ctx.fill();
  ctx.fillStyle = `rgb(${(70 * f) | 0},${(140 * f) | 0},${(210 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 18);
  ctx.fill();
  ctx.fillStyle = `rgb(${(25 * f) | 0},${(35 * f) | 0},${(65 * f) | 0})`;
  ctx.fillRect(bx, by, bw, bh * 0.1);
  const cols2 = 5,
    rows2 = 4;
  const gx = bw * 0.06,
    gy = bh * 0.05;
  const ww = (bw - gx * (cols2 + 1)) / cols2;
  const wh = (bh * 0.62 - gy * (rows2 + 1)) / rows2;
  for (let r = 0; r < rows2; r++)
    for (let c = 0; c < cols2; c++) {
      const wx = bx + gx + (ww + gx) * c;
      const wy = by + bh * 0.12 + gy + (wh + gy) * r;
      ctx.fillStyle = `rgba(${(190 * f) | 0},${(235 * f) | 0},${(255 * f) | 0},0.92)`;
      ctx.fillRect(wx, wy, ww, wh);
    }
  ctx.fillStyle = `rgba(${(20 * f) | 0},${(70 * f) | 0},${(160 * f) | 0},0.95)`;
  ctx.fillRect(bx, by + bh * 0.7, bw, bh * 0.1);
  ctx.fillStyle = `rgb(${(45 * f) | 0},${(30 * f) | 0},${(20 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.1, by + bh * 0.8, bw * 0.2, bh * 0.18, 10);
  ctx.fill();
}

function drawHospital(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  // Taller building, visible from further away
  const bw = sw * 2.6,
    bh = sh * 3.2;
  const bx = cx - bw / 2,
    by = sy - sh * 1.6;

  // Soft red glow halo so it stands out even at distance
  if (sd < 18) {
    let glowAlpha = (1 - sd / 18) * 0.25 * f;
    let glow = ctx.createRadialGradient(
      cx,
      by + bh * 0.4,
      0,
      cx,
      by + bh * 0.4,
      bw * 1.2,
    );
    glow.addColorStop(0, `rgba(255, 60, 80, ${glowAlpha})`);
    glow.addColorStop(1, `rgba(255, 60, 80, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(bx - bw * 0.5, by - bh * 0.2, bw * 2, bh * 1.4);
  }

  // Main facade — clean white
  ctx.fillStyle = `rgb(${(240 * f) | 0},${(238 * f) | 0},${(245 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 14);
  ctx.fill();

  // Bold red top stripe
  ctx.fillStyle = `rgb(${(210 * f) | 0},${(35 * f) | 0},${(55 * f) | 0})`;
  ctx.fillRect(bx, by, bw, bh * 0.12);

  // Windows grid
  const cols2 = 4,
    rows2 = 5;
  const gx = bw * 0.06,
    gy = bh * 0.04;
  const ww = (bw - gx * (cols2 + 1)) / cols2;
  const wh = (bh * 0.55 - gy * (rows2 + 1)) / rows2;
  for (let r = 0; r < rows2; r++)
    for (let c = 0; c < cols2; c++) {
      const wx = bx + gx + (ww + gx) * c;
      const wy = by + bh * 0.16 + gy + (wh + gy) * r;
      ctx.fillStyle = `rgba(${(160 * f) | 0},${(215 * f) | 0},${(255 * f) | 0},0.92)`;
      ctx.fillRect(wx, wy, ww, wh);
    }

  // Large prominent red cross — the key visual identifier
  const cw = bw * 0.32,
    ch = bh * 0.22;
  const ex = cx - cw / 2,
    ey = by + bh * 0.7;
  ctx.fillStyle = `rgb(${(215 * f) | 0},${(30 * f) | 0},${(50 * f) | 0})`;
  ctx.fillRect(ex + cw * 0.36, ey, cw * 0.28, ch); // vertical bar
  ctx.fillRect(ex, ey + ch * 0.36, cw, ch * 0.28); // horizontal bar

  // Entrance
  ctx.fillStyle = `rgb(${(30 * f) | 0},${(30 * f) | 0},${(50 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.14, by + bh * 0.84, bw * 0.28, bh * 0.16, 8);
  ctx.fill();
}

function drawLibrary(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 1.9,
    bh = sh * 1.9;
  const bx = cx - bw / 2,
    by = sy - sh * 0.55;
  ctx.fillStyle = `rgb(${(120 * f) | 0},${(95 * f) | 0},${(70 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 14);
  ctx.fill();
  ctx.fillStyle = `rgba(${(240 * f) | 0},${(230 * f) | 0},${(210 * f) | 0},0.92)`;
  for (let i = 0; i < 5; i++) {
    const x = bx + bw * (0.1 + i * 0.18);
    ctx.fillRect(x, by + bh * 0.18, bw * 0.06, bh * 0.62);
  }
  ctx.fillStyle = `rgba(${(255 * f) | 0},${(245 * f) | 0},${(230 * f) | 0},0.95)`;
  ctx.beginPath();
  ctx.moveTo(bx + bw * 0.1, by + bh * 0.18);
  ctx.lineTo(cx, by + bh * 0.05);
  ctx.lineTo(bx + bw * 0.9, by + bh * 0.18);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = `rgb(${(55 * f) | 0},${(35 * f) | 0},${(25 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.11, by + bh * 0.7, bw * 0.22, bh * 0.22, 10);
  ctx.fill();
}

function drawCafe(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 1.7,
    bh = sh * 1.6;
  const bx = cx - bw / 2,
    by = sy - sh * 0.4;
  ctx.fillStyle = `rgb(${(210 * f) | 0},${(150 * f) | 0},${(95 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 16);
  ctx.fill();
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle =
      i % 2
        ? `rgba(${(255 * f) | 0},${(220 * f) | 0},${(230 * f) | 0},0.95)`
        : `rgba(${(180 * f) | 0},${(50 * f) | 0},${(90 * f) | 0},0.95)`;
    ctx.fillRect(bx + (bw * i) / 8, by, bw / 8, bh * 0.2);
  }
  ctx.fillStyle = `rgba(${(140 * f) | 0},${(210 * f) | 0},${(255 * f) | 0},0.92)`;
  ctx.roundRect(cx - bw * 0.3, by + bh * 0.28, bw * 0.6, bh * 0.42, 10);
  ctx.fill();
  ctx.fillStyle = `rgb(${(65 * f) | 0},${(40 * f) | 0},${(30 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.1, by + bh * 0.72, bw * 0.2, bh * 0.22, 10);
  ctx.fill();
}

function drawSchool(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 1.9,
    bh = sh * 1.9;
  const bx = cx - bw / 2,
    by = sy - sh * 0.55;
  ctx.fillStyle = `rgb(${(245 * f) | 0},${(235 * f) | 0},${(210 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 16);
  ctx.fill();
  ctx.fillStyle = `rgba(${(80 * f) | 0},${(120 * f) | 0},${(210 * f) | 0},0.95)`;
  ctx.fillRect(bx, by, bw, bh * 0.1);
  const cols2 = 5,
    rows2 = 3;
  const gx = bw * 0.06,
    gy = bh * 0.06;
  const ww = (bw - gx * (cols2 + 1)) / cols2;
  const wh = (bh * 0.5 - gy * (rows2 + 1)) / rows2;
  for (let r = 0; r < rows2; r++)
    for (let c = 0; c < cols2; c++) {
      const wx = bx + gx + (ww + gx) * c;
      const wy = by + bh * 0.18 + gy + (wh + gy) * r;
      ctx.fillStyle = `rgba(${(160 * f) | 0},${(220 * f) | 0},${(255 * f) | 0},0.92)`;
      ctx.fillRect(wx, wy, ww, wh);
    }
  ctx.strokeStyle = `rgba(60,60,90,${0.9 * f})`;
  ctx.lineWidth = Math.max(1, sw * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx + bw * 0.3, by + bh * 0.12);
  ctx.lineTo(cx + bw * 0.3, by - bh * 0.1);
  ctx.stroke();
  ctx.fillStyle = `rgba(255,120,170,${0.9 * f})`;
  ctx.beginPath();
  ctx.moveTo(cx + bw * 0.3, by - bh * 0.1);
  ctx.lineTo(cx + bw * 0.48, by - bh * 0.06);
  ctx.lineTo(cx + bw * 0.3, by - bh * 0.02);
  ctx.closePath();
  ctx.fill();
}

function drawCar3D(sx, sy, sw, sh, sd, fog, cr, cg, cb) {
  if (sw < 4 || sh < 4) return;
  let midCol = (sx + sw / 2) | 0;
  if (midCol >= 0 && midCol < W && zBuf[midCol] < sd) return;
  let f = fog;
  ctx.fillStyle = `rgba(0,0,0,${0.28 * f})`;
  ctx.fillRect(sx + sw * 0.1, sy + sh * 0.82, sw * 0.8, sh * 0.07);
  ctx.fillStyle = `rgb(${(cr * f) | 0},${(cg * f) | 0},${(cb * f) | 0})`;
  ctx.roundRect(sx, sy + sh * 0.38, sw, sh * 0.42, Math.max(2, sw * 0.08));
  ctx.fill();
  ctx.fillStyle = `rgba(255,255,255,${0.18 * f})`;
  ctx.fillRect(sx + sw * 0.05, sy + sh * 0.38, sw * 0.9, sh * 0.06);
  ctx.fillStyle = `rgba(0,0,0,${0.22 * f})`;
  ctx.fillRect(sx + sw * 0.05, sy + sh * 0.72, sw * 0.9, sh * 0.07);
  let roofL = sx + sw * 0.18,
    roofT = sy + sh * 0.18,
    roofW = sw * 0.64,
    roofH = sh * 0.22;
  ctx.fillStyle = `rgb(${(cr * f * 0.72) | 0},${(cg * f * 0.72) | 0},${(cb * f * 0.72) | 0})`;
  ctx.roundRect(roofL, roofT, roofW, roofH, Math.max(2, sw * 0.1));
  ctx.fill();
  ctx.fillStyle = `rgba(${(140 * f) | 0},${(200 * f) | 0},${(238 * f) | 0},0.88)`;
  ctx.roundRect(
    sx + sw * 0.22,
    sy + sh * 0.21,
    sw * 0.56,
    sh * 0.17,
    Math.max(1, sw * 0.05),
  );
  ctx.fill();
  ctx.fillStyle = `rgb(${(255 * f) | 0},${(252 * f) | 0},${(180 * f) | 0})`;
  ctx.roundRect(sx + sw * 0.04, sy + sh * 0.42, sw * 0.14, sh * 0.1, 2);
  ctx.fill();
  ctx.roundRect(sx + sw * 0.82, sy + sh * 0.42, sw * 0.14, sh * 0.1, 2);
  ctx.fill();
  ctx.fillStyle = `rgb(${(218 * f) | 0},${(42 * f) | 0},${(42 * f) | 0})`;
  ctx.roundRect(sx + sw * 0.04, sy + sh * 0.62, sw * 0.13, sh * 0.09, 2);
  ctx.fill();
  ctx.roundRect(sx + sw * 0.83, sy + sh * 0.62, sw * 0.13, sh * 0.09, 2);
  ctx.fill();
  let ww = Math.max(3, sw * 0.2),
    wh = Math.max(3, sh * 0.14);
  [
    [0.03, 0.7],
    [0.77, 0.7],
    [0.03, 0.58],
    [0.77, 0.58],
  ].forEach(([wx, wy]) => {
    ctx.fillStyle = `rgb(${(22 * f) | 0},${(22 * f) | 0},${(22 * f) | 0})`;
    ctx.roundRect(sx + sw * wx, sy + sh * wy, ww, wh, Math.max(1, ww * 0.3));
    ctx.fill();
  });
  ctx.strokeStyle = `rgba(0,0,0,${0.35 * f})`;
  ctx.lineWidth = Math.max(1, sw * 0.025);
  ctx.beginPath();
  ctx.moveTo(sx + sw * 0.5, sy + sh * 0.38);
  ctx.lineTo(sx + sw * 0.5, sy + sh * 0.8);
  ctx.stroke();
}

// ================================================================
//  HUD UPDATE
// ================================================================
function updateHUD() {
  let hudTag = document.getElementById("hud-tag");
  hudTag.textContent = "";
  hudTag.style.color = "";
  hudTag.style.animation = "";

  let spd = Math.abs(P.spd);
  let maxSpeed = manicState.manicMode
    ? MOVE_SPEED * MANIC_SPEED_MULTIPLIER
    : MOVE_SPEED;
  document.getElementById("spd-bar").style.width = (spd / maxSpeed) * 100 + "%";

  // In manic mode: speed label is boastful
  let spdLabel = spd.toFixed(1) + " t/s  " + (P.spd >= 0 ? "▲ FWD" : "▼ REV");
  if (manicState.manicMode && spd > MOVE_SPEED * 1.5) {
    spdLabel += "  🔥";
  }
  document.getElementById("spd-label").textContent = spdLabel;

  let d = Math.hypot(P.x - GB.x, P.y - GB.y);
  let target = tripPhase === 0 ? GB : GA;
  let d2 = Math.hypot(P.x - target.x, P.y - target.y);
  document.getElementById("step-label").style.color =
    tripPhase === 0 ? "#ff8fab" : "#69db7c";
  document.getElementById("step-label").textContent = "DESTINATION:";
  document.getElementById("dest-label").textContent = target.label;
  if (manicState.manicMode && manicState.manicIntensity > 0.2) {
    // Distance feels closer AND fluctuates — time distortion
    let distortion = 1 - manicState.manicIntensity * 0.45;
    let flicker = Math.sin(pulse * 2.3) * manicState.manicIntensity * 0.2;
    let perceivedDist = d2 * (distortion + flicker);
    document.getElementById("dist-label").textContent =
      Math.max(0, perceivedDist).toFixed(1) + " units away";
  } else {
    document.getElementById("dist-label").textContent =
      d2.toFixed(1) + " units away";
  }
}

// ================================================================
//  COMPASS — with overconfidence drift in manic mode
// ================================================================
function updateCompass() {
  let target = GB;
  let cc = document.getElementById("compass-canvas");
  let cx2 = cc.getContext("2d");
  let cw = cc.width,
    ch = cc.height,
    cx = cw / 2,
    cy = ch / 2;
  cx2.clearRect(0, 0, cw, ch);
  cx2.strokeStyle = "rgba(255,255,255,0.2)";
  cx2.lineWidth = 1;
  cx2.beginPath();
  cx2.arc(cx, cy, 18, 0, Math.PI * 2);
  cx2.stroke();
  cx2.fillStyle = "rgba(200,180,255,0.7)";
  cx2.font = "bold 7px sans-serif";
  cx2.textAlign = "center";
  cx2.textBaseline = "middle";
  ["N", "E", "S", "W"].forEach((l, i) => {
    let a = (i * Math.PI) / 2 - P.a;
    cx2.fillText(l, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14);
  });

  let dx = target.x - P.x,
    dy = target.y - P.y;
  let trueAngle = Math.atan2(dy, dx);

  // In manic mode: compass drifts subtly
  let displayAngle =
    trueAngle + (manicState.manicMode ? manicState.compassDrift : 0);
  let rel = displayAngle - P.a;

  let ac = manicState.manicMode ? `rgb(255, 200, 50)` : "#ff8fab";
  cx2.fillStyle = ac;
  cx2.save();
  cx2.translate(cx, cy);
  cx2.rotate(rel);
  cx2.beginPath();
  cx2.moveTo(0, -13);
  cx2.lineTo(-5, 7);
  cx2.lineTo(5, 7);
  cx2.closePath();
  cx2.fill();
  cx2.restore();

  document.getElementById("compass-label").textContent =
    target.label.toUpperCase();
  document.getElementById("compass-label").style.color = ac;
}

// ================================================================
//  MINIMAP
// ================================================================
const MM_S = 3;
let mmCanvas = document.getElementById("minimap");
mmCanvas.width = COLS * MM_S;
mmCanvas.height = ROWS * MM_S;
let mmCtx = mmCanvas.getContext("2d");
let mmBase = null;

function buildMinimapBase() {
  let offscreen = document.createElement("canvas");
  offscreen.width = COLS * MM_S;
  offscreen.height = ROWS * MM_S;
  let oc = offscreen.getContext("2d");
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      let t = MAP[r][c];
      oc.fillStyle =
        t === 0
          ? "#8a8a9e"
          : t === 2
            ? "#c4a882"
            : t === 3
              ? "#6aaddd"
              : t === 4
                ? "#dd7080"
                : "#4a7c59";
      oc.fillRect(c * MM_S, r * MM_S, MM_S, MM_S);
    }
  // Start (Community Centre) — bold green marker with white S
  oc.fillStyle = "#22c55e";
  oc.beginPath();
  oc.arc(GA.x * MM_S, GA.y * MM_S, 7, 0, Math.PI * 2);
  oc.fill();
  oc.strokeStyle = "#ffffff";
  oc.lineWidth = 1.5;
  oc.beginPath();
  oc.arc(GA.x * MM_S, GA.y * MM_S, 7, 0, Math.PI * 2);
  oc.stroke();
  oc.fillStyle = "#ffffff";
  oc.font = "bold 7px sans-serif";
  oc.textAlign = "center";
  oc.textBaseline = "middle";
  oc.fillText("S", GA.x * MM_S, GA.y * MM_S);
  // Hospital — large red cross marker on minimap
  oc.fillStyle = "#ff2244";
  oc.beginPath();
  oc.arc(GB.x * MM_S, GB.y * MM_S, 7, 0, Math.PI * 2);
  oc.fill();
  // White cross on top
  oc.fillStyle = "#ffffff";
  oc.fillRect(GB.x * MM_S - 1.5, GB.y * MM_S - 5, 3, 10);
  oc.fillRect(GB.x * MM_S - 5, GB.y * MM_S - 1.5, 10, 3);
  mmBase = offscreen;
}

function updateMinimap() {
  if (!mmBase) buildMinimapBase();
  const mw = mmCanvas.width,
    mh = mmCanvas.height;
  mmCtx.clearRect(0, 0, mw, mh);

  if (manicState.manicMode && manicState.manicIntensity > 0) {
    const mi = manicState.manicIntensity;
    const cx = mw / 2,
      cy = mh / 2;

    // Rotate the entire map slowly — player can't trust orientation
    let mapRotation = mi * Math.sin(pulse * 0.18) * 0.55;

    // Gradually fade out the map base so it becomes unreadable at high intensity
    let mapAlpha = Math.max(0.15, 1 - mi * 0.7);

    mmCtx.save();
    mmCtx.translate(cx, cy);
    mmCtx.rotate(mapRotation);
    mmCtx.globalAlpha = mapAlpha;
    mmCtx.drawImage(mmBase, -cx, -cy);
    mmCtx.globalAlpha = 1;
    mmCtx.restore();

    // Overlay static noise at high intensity — map becomes unreliable
    if (mi > 0.5) {
      let noiseAlpha = (mi - 0.5) * 0.35;
      for (let i = 0; i < 40; i++) {
        let nx = Math.random() * mw,
          ny = Math.random() * mh;
        let ns = 1 + Math.random() * 2;
        mmCtx.fillStyle = `rgba(${(Math.random() * 255) | 0},${(Math.random() * 100) | 0},${(Math.random() * 255) | 0},${noiseAlpha})`;
        mmCtx.fillRect(nx, ny, ns, ns);
      }
    }

    // Player dot — drifts slightly from true position (overconfidence)
    let drift = mi * 6;
    let fakePx = P.x * MM_S + Math.sin(pulse * 1.1) * drift;
    let fakePy = P.y * MM_S + Math.cos(pulse * 0.9) * drift;

    mmCtx.strokeStyle = "rgba(255,255,100,0.9)";
    mmCtx.lineWidth = 1.5;
    mmCtx.beginPath();
    mmCtx.moveTo(fakePx, fakePy);
    mmCtx.lineTo(fakePx + Math.cos(P.a) * 8, fakePy + Math.sin(P.a) * 8);
    mmCtx.stroke();
    mmCtx.fillStyle = "#fff";
    mmCtx.beginPath();
    mmCtx.arc(fakePx, fakePy, 3.5, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.fillStyle = "#e879f9";
    mmCtx.beginPath();
    mmCtx.arc(fakePx, fakePy, 2, 0, Math.PI * 2);
    mmCtx.fill();

    // Real hospital marker drifts slightly
    let goalDrift = mi * 8;
    let fakeGx = GB.x * MM_S + Math.cos(pulse * 0.7 + 1.2) * goalDrift;
    let fakeGy = GB.y * MM_S + Math.sin(pulse * 0.5 + 0.8) * goalDrift;
    mmCtx.fillStyle = "#ff2244";
    mmCtx.beginPath();
    mmCtx.arc(fakeGx, fakeGy, 7, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.fillStyle = "#ffffff";
    mmCtx.fillRect(fakeGx - 1.5, fakeGy - 5, 3, 10);
    mmCtx.fillRect(fakeGx - 5, fakeGy - 1.5, 10, 3);
  } else {
    // Normal minimap
    mmCtx.drawImage(mmBase, 0, 0);

    if (!manicState.hasPassedCheckpoint) {
      let cpx = MANIC_CHECKPOINT_ZONE.x * MM_S;
      let cpy = MANIC_CHECKPOINT_ZONE.y * MM_S;
      let cpr = MANIC_CHECKPOINT_ZONE.radius * MM_S;
      let pulseAlpha = Math.sin(pulse * 3) * 0.3 + 0.5;
      mmCtx.fillStyle = `rgba(200, 100, 255, ${pulseAlpha * 0.3})`;
      mmCtx.beginPath();
      mmCtx.arc(cpx, cpy, cpr, 0, Math.PI * 2);
      mmCtx.fill();
      mmCtx.strokeStyle = `rgba(200, 100, 255, ${pulseAlpha})`;
      mmCtx.lineWidth = 2;
      mmCtx.beginPath();
      mmCtx.arc(cpx, cpy, cpr, 0, Math.PI * 2);
      mmCtx.stroke();
    }

    NPCS.forEach((n) => {
      mmCtx.fillStyle = `rgb(${n.r},${n.g},${n.b})`;
      mmCtx.beginPath();
      mmCtx.arc(n.x * MM_S, n.y * MM_S, 2, 0, Math.PI * 2);
      mmCtx.fill();
    });

    // Pulse start marker when returning
    if (tripPhase === 1) {
      let pulseR = 7 + Math.sin(pulse * 4) * 3;
      let pulseA = 0.5 + Math.sin(pulse * 4) * 0.3;
      mmCtx.strokeStyle = `rgba(34, 197, 94, ${pulseA})`;
      mmCtx.lineWidth = 2;
      mmCtx.beginPath();
      mmCtx.arc(GA.x * MM_S, GA.y * MM_S, pulseR, 0, Math.PI * 2);
      mmCtx.stroke();
    }
    let px = P.x * MM_S,
      py = P.y * MM_S;
    mmCtx.strokeStyle = "rgba(255,255,100,0.9)";
    mmCtx.lineWidth = 1.5;
    mmCtx.beginPath();
    mmCtx.moveTo(px, py);
    mmCtx.lineTo(px + Math.cos(P.a) * 8, py + Math.sin(P.a) * 8);
    mmCtx.stroke();
    mmCtx.fillStyle = "#fff";
    mmCtx.beginPath();
    mmCtx.arc(px, py, 3.5, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.fillStyle = "#e879f9";
    mmCtx.beginPath();
    mmCtx.arc(px, py, 2, 0, Math.PI * 2);
    mmCtx.fill();
  }
}

// ── Init ─────────────────────────────────────────────────────
// Initialize canvas
canvas = document.getElementById("c");
ctx = canvas.getContext("2d", { alpha: false });

buildMap();
resize();

// Button Handlers
document.getElementById("btn-acknowledge").onclick = () => {
  document.getElementById("screen-warning").style.display = "none";
  document.getElementById("screen-intro").style.display = "flex";
  gameState = "intro";
};

document.getElementById("btn-settings").onclick = () => {
  document.getElementById("screen-warning").style.display = "none";
  document.getElementById("screen-settings").style.display = "flex";
};

document.getElementById("btn-back-to-warning").onclick = () => {
  reducedEffectsMode = document.getElementById(
    "setting-reduced-effects",
  ).checked;
  skipManicEpisode = document.getElementById("setting-skip-manic").checked;
  document.getElementById("screen-settings").style.display = "none";
  document.getElementById("screen-warning").style.display = "flex";
};

document.getElementById("btn-start").onclick = () => {
  resetGame();
  showGame();
};

document.getElementById("btn-again").onclick = () => {
  document.getElementById("screen-win").style.display = "none";
  document.getElementById("screen-intro").style.display = "flex";
};
