// ================================================================
//  CROSSY MIND — raw Canvas2D raycaster (sketch.js)
//  A -> B only, better road floor, standout buildings + labels
// ================================================================

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
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d", { alpha: false });

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

// ── Arrow pool — one shown at a time in manic mode ────────────
const ARROW_POOL = [
  // Early map — near start, mislead immediately
  { x: 6.5, y: 4.5, dir: -Math.PI / 2 }, // row3  near GA → north (back)
  { x: 4.5, y: 7.0, dir: Math.PI / 2 }, // col3  south   → south (away from hosp)
  { x: 7.0, y: 3.5, dir: Math.PI }, // row3  mid     → west (back)
  // Mid-map horizontal roads
  { x: 11.0, y: 10.5, dir: Math.PI }, // row10/col10   → west
  { x: 14.5, y: 11.5, dir: -Math.PI / 2 }, // row10 mid     → north
  { x: 6.5, y: 10.5, dir: Math.PI }, // row10 early   → west
  { x: 19.0, y: 10.5, dir: 0 }, // row10/col18   → east (back)
  { x: 22.0, y: 11.5, dir: Math.PI / 2 }, // row10 far mid → south (wrong)
  // Mid-map vertical roads
  { x: 10.5, y: 7.0, dir: -Math.PI / 2 }, // col10 north   → north
  { x: 10.5, y: 14.5, dir: 0 }, // col10 mid     → east (wrong)
  { x: 10.5, y: 22.0, dir: -Math.PI / 2 }, // col10 south   → north
  { x: 18.5, y: 7.0, dir: Math.PI }, // col18 north   → west
  { x: 18.5, y: 14.5, dir: Math.PI / 2 }, // col18 mid     → south (overshoots)
  // Row 18 horizontal
  { x: 7.0, y: 18.5, dir: Math.PI }, // row18 early   → west
  { x: 14.5, y: 18.5, dir: -Math.PI / 2 }, // row18 mid     → north
  { x: 17.0, y: 18.5, dir: Math.PI }, // row18/col18   → west
  { x: 22.0, y: 18.5, dir: Math.PI / 2 }, // row18 far     → south
  // Approaching hospital quadrant — most critical misleads
  { x: 18.5, y: 22.0, dir: Math.PI / 2 }, // col18 south   → south (overshoots)
  { x: 18.5, y: 25.0, dir: -Math.PI / 2 }, // row26/col18   → north
  { x: 22.0, y: 26.5, dir: -Math.PI / 2 }, // row26 mid     → north
  { x: 25.0, y: 26.5, dir: Math.PI }, // row26/col26   → west
  { x: 26.5, y: 22.0, dir: -Math.PI / 2 }, // col26 north   → north
  { x: 26.5, y: 29.0, dir: -Math.PI / 2 }, // col26 mid     → north
  { x: 29.0, y: 26.5, dir: 0 }, // row26 east    → east (past hosp)
  // Near hospital — most aggressive misleads
  { x: 27.0, y: 34.5, dir: 0 }, // row34/col26   → east (past hosp)
  { x: 30.5, y: 35.0, dir: Math.PI / 2 }, // row34 mid     → south
  { x: 34.5, y: 22.0, dir: Math.PI }, // col34 mid     → west
  { x: 34.5, y: 29.0, dir: Math.PI / 2 }, // col34 south   → south
  { x: 30.5, y: 27.0, dir: -Math.PI / 2 }, // col34 inner   → north
];

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

// ── Accessibility Settings ───────────────────────────────────
let reducedEffectsMode = false;
let skipManicEpisode = false;

// ── Manic Episode State ──────────────────────────────────────
let manicMode = false;
const MANIC_CHECKPOINT_ZONE = { x: 18.5, y: 18.5, radius: 2.5 };
const MANIC_SPEED_MULTIPLIER = 5.0;
let hasPassedCheckpoint = false;
let initialDistanceToGoal = 0;
let checkpointWarningShown = false;
let shakeOffsetX = 0;
let shakeOffsetY = 0;

// Enhanced manic episode variables
let manicIntensity = 0;
let manicStartTime = 0;
const MANIC_RAMP_DURATION = 30; // reaches full intensity in 30 seconds
let screenRotation = 0;
let colorShift = 0;
let tunnelVisionAmount = 0;
let controlInversion = 0;
let controlDrift = 0;
let hudGlitchAmount = 0;
let phantomSprites = [];

// ── NEW: Authentic mania effect state ────────────────────────
// Racing thoughts system
const RACING_THOUGHTS = [
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
let activeThoughts = []; // { text, x, y, alpha, life, maxLife, size, vx, vy }
let thoughtSpawnTimer = 0;
let activeArrowIdx = -1;
let arrowTimer = 0; // starts at 0 so first arrow appears immediately
let arrowFadeAlpha = 0;
let lastArrowIdx = -1;

// Grandiosity HUD messages
const GRANDIOSITY_MESSAGES = [
  "PERFECT DRIVING",
  "YOU SEE IT CLEARLY",
  "FLAWLESS INSTINCTS",
  "INCREDIBLE SPEED",
  "YOU CAN'T BE STOPPED",
  "EVERYTHING MAKES SENSE",
  "TRUST YOUR JUDGMENT",
  "BRILLIANT ROUTE CHOSEN",
];
let currentGrandiosityMsg = "";
let grandiosityTimer = 0;
let grandiosityAlpha = 0;

// World bloom / saturation state
let worldBloom = 0; // 0–1, makes world feel electric/beautiful
let skyBrightness = 0; // sky gets more vivid and golden

// Overconfidence compass drift — compass gradually points slightly wrong
let compassDrift = 0; // radians of drift, builds slowly

// Subtle euphoric shimmer on edges of screen (NOT horror vignette)
let shimmerAmount = 0;

function resetGame() {
  // Start in centre of right lane (lower tile of the eastbound road)
  // Roads are 2 tiles wide; row 3+4, col 3+4. Right lane east = y=4.5.
  P = { x: 5.5, y: 4.5, a: 0, spd: 0 };
  pulse = 0;
  manicMode = false;
  hasPassedCheckpoint = false;
  tripPhase = 0;
  checkpointWarningShown = false;
  initialDistanceToGoal = Math.hypot(GB.x - GA.x, GB.y - GA.y);

  // Reset enhanced manic variables
  manicIntensity = 0;
  manicStartTime = 0;
  screenRotation = 0;
  colorShift = 0;
  tunnelVisionAmount = 0;
  controlInversion = 0;
  controlDrift = 0;
  hudGlitchAmount = 0;
  phantomSprites = [];

  // Reset new authentic mania state
  activeThoughts = [];
  thoughtSpawnTimer = 0;
  activeArrowIdx = -1;
  arrowTimer = 0;
  arrowFadeAlpha = 0;
  lastArrowIdx = -1;
  currentGrandiosityMsg = "";
  grandiosityTimer = 0;
  grandiosityAlpha = 0;
  worldBloom = 0;
  skyBrightness = 0;
  compassDrift = 0;
  shimmerAmount = 0;

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

// ── Buttons ──────────────────────────────────────────────────
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

  // Update manic intensity
  if (manicMode && !skipManicEpisode) {
    if (manicStartTime === 0) manicStartTime = pulse;
    let elapsed = pulse - manicStartTime;
    // Linear ramp — steady, gradual build from the moment it triggers
    let rawIntensity = Math.min(1, elapsed / MANIC_RAMP_DURATION);
    manicIntensity = reducedEffectsMode
      ? Math.min(0.5, rawIntensity)
      : rawIntensity;

    // ── AUTHENTIC MANIA: beautiful/electric world ────────────
    // World feels MORE vivid, not scarier
    worldBloom = manicIntensity * 0.7;
    skyBrightness = manicIntensity * 0.5;
    shimmerAmount = manicIntensity;

    // Overconfidence: compass drifts subtly off — player won't notice til they're lost
    compassDrift = Math.sin(pulse * 0.08) * manicIntensity * 0.45;

    // Very subtle screen rotation — imperceptible at first, feels like energy
    screenRotation = Math.sin(pulse * 1.2) * manicIntensity * 0.025;

    // Only minimal shake at HIGH intensity (not horror, just restless energy)
    if (manicIntensity > 0.7) {
      let shakeIntensity = 4.0 * ((manicIntensity - 0.7) / 0.3);
      shakeOffsetX = (Math.random() - 0.5) * shakeIntensity;
      shakeOffsetY = (Math.random() - 0.5) * shakeIntensity;
    } else {
      shakeOffsetX = 0;
      shakeOffsetY = 0;
    }

    // Racing thoughts spawn faster as intensity grows
    thoughtSpawnTimer -= dt;
    let spawnInterval = Math.max(0.4, 3.0 - manicIntensity * 2.6);
    if (thoughtSpawnTimer <= 0) {
      thoughtSpawnTimer = spawnInterval;
      spawnRacingThought();
    }

    // ── One glowing arrow at a time ───────────────────────────
    // Arrows only start appearing once intensity is noticeable
    if (manicIntensity > 0.1) {
      arrowTimer -= dt;
      if (arrowTimer <= 0) {
        // Prefer arrows within 12 tiles of player so they're always visible & tempting
        let nearby = ARROW_POOL.map((a, i) => ({
          i,
          d: Math.hypot(a.x - P.x, a.y - P.y),
        }))
          .filter((a) => a.i !== lastArrowIdx && a.d < 16 && a.d > 1.5)
          .sort((a, b) => a.d - b.d);
        // Pick from the 5 closest so it's not always the nearest
        let pool2 = nearby.slice(0, 5);
        if (pool2.length === 0)
          pool2 = ARROW_POOL.map((_, i) => ({ i })).filter(
            (a) => a.i !== lastArrowIdx,
          );
        let pick = pool2[Math.floor(Math.random() * pool2.length)];
        lastArrowIdx = activeArrowIdx;
        activeArrowIdx = pick.i;
        // Appear for 3-6s, shorter at high intensity
        arrowTimer = Math.max(1.8, 5 - manicIntensity * 3.5);
        arrowFadeAlpha = 0;
      }
      // Fade in over 0.5s, fade out in last 0.5s
      let duration = Math.max(1.8, 5 - manicIntensity * 3.5);
      let elapsed = duration - arrowTimer;
      arrowFadeAlpha = Math.min(1, Math.min(elapsed / 0.5, arrowTimer / 0.5));
    } else {
      activeArrowIdx = -1;
      arrowFadeAlpha = 0;
    }

    // Grandiosity messages cycle
    grandiosityTimer -= dt;
    if (grandiosityTimer <= 0) {
      grandiosityTimer = Math.max(1.5, 4.0 - manicIntensity * 2.5);
      currentGrandiosityMsg =
        GRANDIOSITY_MESSAGES[
          Math.floor(Math.random() * GRANDIOSITY_MESSAGES.length)
        ];
      grandiosityAlpha = 0.0;
    }
    // Fade in then out
    grandiosityAlpha = Math.min(1, grandiosityAlpha + dt * 3);

    // Legacy vars (kept for compatibility, toned down)
    colorShift = manicIntensity * 0.15; // much gentler
    tunnelVisionAmount = 0; // removed — not authentic to mania
    controlInversion = 0; // removed — too punishing, not authentic
    controlDrift = manicIntensity * 0.08; // very subtle drift
    hudGlitchAmount = manicIntensity * 0.3;

    // Spawn phantom sprites at high intensity
    if (manicIntensity > 0.6 && Math.random() < 0.008) {
      spawnPhantomSprite();
    }
  } else if (manicMode && skipManicEpisode) {
    manicIntensity = 0;
    shakeOffsetX = 0;
    shakeOffsetY = 0;
  } else {
    shakeOffsetX = 0;
    shakeOffsetY = 0;
  }

  // Update racing thoughts
  activeThoughts.forEach((th) => {
    th.life -= dt;
    th.x += th.vx * dt;
    th.y += th.vy * dt;
    // Fade in then out
    let progress = 1 - th.life / th.maxLife;
    if (progress < 0.15) th.alpha = progress / 0.15;
    else if (progress > 0.7) th.alpha = 1 - (progress - 0.7) / 0.3;
    else th.alpha = 1.0;
  });
  activeThoughts = activeThoughts.filter((th) => th.life > 0);

  update(dt);
  render();
  updateHUD();
  updateCompass();
  updateMinimap();
}
requestAnimationFrame(loop);

// ── Spawn a racing thought ────────────────────────────────────
function spawnRacingThought() {
  let text =
    RACING_THOUGHTS[Math.floor(Math.random() * RACING_THOUGHTS.length)];
  // Thoughts appear in mid-screen area, drift upward
  let x = W * (0.15 + Math.random() * 0.7);
  let y = H * (0.3 + Math.random() * 0.45);
  let size = Math.floor(11 + manicIntensity * 14 + Math.random() * 8);
  let maxLife = 2.5 + Math.random() * 1.5;
  activeThoughts.push({
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

// ================================================================
//  UPDATE
// ================================================================
function update(dt) {
  // Check for manic episode checkpoint
  if (!hasPassedCheckpoint) {
    let currentDistToGoal = Math.hypot(P.x - GB.x, P.y - GB.y);
    let progressPercent = 1 - currentDistToGoal / initialDistanceToGoal;
    let distToCheckpoint = Math.hypot(
      P.x - MANIC_CHECKPOINT_ZONE.x,
      P.y - MANIC_CHECKPOINT_ZONE.y,
    );
    let shouldTrigger =
      distToCheckpoint < MANIC_CHECKPOINT_ZONE.radius || progressPercent >= 0.4;
    if (
      !checkpointWarningShown &&
      (distToCheckpoint < MANIC_CHECKPOINT_ZONE.radius + 5 ||
        progressPercent >= 0.1)
    ) {
      checkpointWarningShown = true;
    }
    if (shouldTrigger) {
      hasPassedCheckpoint = true;
      manicMode = true;
    }
  }

  let speedMult = manicMode ? MANIC_SPEED_MULTIPLIER : 1.0;
  let maxSpeed = MOVE_SPEED * speedMult;
  let accelRate = ACCEL * speedMult;

  if (manicMode && manicIntensity > 0.4) {
    speedMult *= 1 + Math.sin(pulse * 3) * 0.15 * manicIntensity;
    maxSpeed = MOVE_SPEED * speedMult;
  }

  let turnInput = 0;
  if (KEYS["ArrowLeft"] || KEYS["KeyA"]) turnInput -= 1;
  if (KEYS["ArrowRight"] || KEYS["KeyD"]) turnInput += 1;

  // Subtle control drift — feels like you're just going faster, not like controls are broken
  if (manicMode && !skipManicEpisode) {
    turnInput += (Math.random() - 0.5) * controlDrift;
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
    let speedMult2 = manicMode ? 1 + manicIntensity * 4.0 : 1;
    // In manic mode: occasional random direction flips (erratic driving)
    if (manicMode && manicIntensity > 0.4 && Math.random() < 0.002) {
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

  phantomSprites = phantomSprites.filter((ps) => {
    ps.life -= dt;
    return ps.life > 0;
  });
}

// ── Phantom Sprite Spawning ──────────────────────────────────
function spawnPhantomSprite() {
  let angle = Math.random() * Math.PI * 2;
  let dist = 5 + Math.random() * 10;
  let x = Math.max(1, Math.min(COLS - 1, P.x + Math.cos(angle) * dist));
  let y = Math.max(1, Math.min(ROWS - 1, P.y + Math.sin(angle) * dist));
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
  phantomSprites.push(phantom);
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

    if (manicMode && manicIntensity > 0) {
      let mi = manicIntensity;
      // Horizon warms first (t=1), warmth bleeds upward as intensity grows
      let horizonBias = 0.4 + t * 0.6;
      let warmth = mi * horizonBias;
      r = Math.min(255, r + warmth * 115) | 0;
      g = Math.min(255, g + warmth * 25) | 0;
      b = Math.max(50, b - warmth * 150) | 0;
      // Upper sky shifts to deep amber/violet at high intensity
      if (mi > 0.5) {
        let upper = (1 - t) * (mi - 0.5) * 2;
        r = Math.min(255, r + upper * 45) | 0;
        g = Math.max(70, g - upper * 35) | 0;
        b = Math.max(30, b - upper * 20) | 0;
      }
      // Living shimmer — the sky feels alive
      if (mi > 0.25) {
        let shimmer = Math.sin(pulse * 2.2 + y * 0.04) * mi * 12;
        r = Math.min(255, r + shimmer) | 0;
        g = Math.min(255, g + shimmer * 0.4) | 0;
      }
    }

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
  if (manicMode && manicIntensity > 0)
    sunR = Math.min(55, 22 + manicIntensity * 40) | 0;

  for (let dy = -sunR; dy <= sunR; dy++)
    for (let dx = -sunR; dx <= sunR; dx++) {
      let dist2 = dx * dx + dy * dy;
      if (dist2 < sunR * sunR) {
        let px2 = sunX + dx,
          py = sunY + dy;
        if (px2 >= 0 && px2 < W2 && py >= 0 && py < hor) {
          if (manicMode && manicIntensity > 0) {
            // Golden sun: ABGR — A=ff, B=low, G=mid, R=high
            // Halo fades from white core to golden edge
            let coreFrac = Math.sqrt(dist2) / sunR; // 0=centre, 1=edge
            let sr = 255;
            let sg = Math.max(160, 255 - coreFrac * 110) | 0;
            let sb =
              Math.max(20, 200 - coreFrac * 180 - manicIntensity * 80) | 0;
            buf[py * W2 + px2] = 0xff000000 | (sb << 16) | (sg << 8) | sr;
          } else {
            buf[py * W2 + px2] = 0xff80e8ff; // default cool sun
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
        // In manic mode: grass saturates — vivid emerald, almost luminous
        if (manicMode && manicIntensity > 0) {
          let mi = manicIntensity;
          g = Math.min(210, g + mi * 75) | 0; // much richer green
          r = Math.max(20, r - mi * 15) | 0; // cooler shadows
          b = Math.max(40, b + mi * 20) | 0; // slight cool underglow
        }
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
    if (manicMode && worldBloom > 0) {
      if (tt === 1) {
        wg = Math.min(200, wg + worldBloom * 35) | 0;
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
  phantomSprites.forEach((ps) => {
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
  if (manicMode && !skipManicEpisode && screenRotation !== 0) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(screenRotation);
    ctx.translate(-W / 2 + shakeOffsetX, -H / 2 + shakeOffsetY);
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
    } else if (sp.t === 9 && manicMode)
      drawMisleadingSign(sx, startY, spW, spH, sd, fog, sp.dir, sp.label);
    else if (sp.t === 10 && !hasPassedCheckpoint)
      drawCheckpointMarker(sx, startY, spW, spH, sd, fog);
    else if (sp.t === 5)
      drawCar3D(startX, startY, spW, spH, sd, fog, sp.r, sp.g, sp.b);
    ctx.restore();
  }

  if (manicMode && !skipManicEpisode && screenRotation !== 0) {
    ctx.restore();
  }

  // ── Draw active arrow in clean unshaken ctx ───────────────
  if (manicMode && activeArrowIdx >= 0 && arrowFadeAlpha > 0) {
    let ap = ARROW_POOL[activeArrowIdx];
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
        ctx.globalAlpha = arrowFadeAlpha;
        drawRoadArrow(screenX, startY2, spH2, spH2, transY, fog2, ap.dir);
        ctx.restore();
      }
    }
  }

  // ===== NEW: AUTHENTIC MANIA OVERLAYS =====
  if (manicMode && !skipManicEpisode && manicIntensity > 0) {
    drawManicOverlays();
  }
}

// ================================================================
//  AUTHENTIC MANIA OVERLAYS
// ================================================================
function drawManicOverlays() {
  const intensity = manicIntensity;

  // ── 1. EUPHORIC EDGE SHIMMER ─────────────────────────────────
  // Warm golden glow at screen edges — beautiful, inviting, electric
  // This is the OPPOSITE of tunnel vision horror — it feels good
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

  // ── 2. RACING THOUGHTS — removed (grandiosity banner handles messaging) ──

  // ── 3. GRANDIOSITY OVERLAY — removed ────────────────────────

  // ── 4. WORLD SATURATION BOOST (subtle chromatic richness) ────
  // At moderate intensity: screen gets a barely-perceptible warm overlay
  // Makes the world look more vivid, more MEANINGFUL — not distorted
  if (intensity > 0.3) {
    let warmAlpha = (intensity - 0.3) * 0.12;
    ctx.fillStyle = `rgba(255, 180, 20, ${warmAlpha})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ── 5. PERIPHERAL BURN ───────────────────────────────────────
  // Always-on once manic — warm golden burn closes in from all edges.
  // At full intensity it swallows 45% of the screen on each side.
  if (intensity > 0.05) {
    let spdFrac =
      Math.abs(P.spd) > 0.5
        ? Math.min(1, Math.abs(P.spd) / (MOVE_SPEED * MANIC_SPEED_MULTIPLIER))
        : 0.3; // always some burn even when still
    // Base alpha from intensity alone, boosted further by speed
    let baseAlpha = intensity * 0.12 + spdFrac * intensity * 0.08;
    // Slight pulse so it breathes
    let breathe = 1 + Math.sin(pulse * 1.8) * 0.12;
    let glowAlpha = Math.min(0.88, baseAlpha * breathe);

    // How far inward the burn reaches (25% at low intensity → 45% at full)
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

    // Top — narrower, horizon feels compressed
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
    let gBoost = manicMode ? 1 + worldBloom * 0.3 : 1;
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

function drawRoadArrow(cx, sy, sw, sh, sd, fog, direction) {
  if (!colOk(cx, sd)) return;
  if (sw < 8) return;
  const f = fog;

  // 3 glowing panels — warm gold/amber to match manic sky UI
  // Large, bright, enticing. No shake — they feel steady and confident.
  const numPanels = 3;
  const panW = sw * 0.42;
  const panH = sh * 0.7;
  const gap = sw * 0.07;

  // Slow, smooth float — serene not jittery
  const floatOff = Math.sin(pulse * 1.6) * sh * 0.06;
  const pulseCycle = pulse * 2.8;

  // Big warm halo behind the group
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
    // Wave cascades from leading (i=0) to trailing (i=2)
    const wave = (Math.sin(pulseCycle - i * 1.0) + 1) / 2;
    const bright = 0.65 + wave * 0.35;

    const px = (i - (numPanels - 1) / 2) * (panW + gap);
    const py = -panH / 2;

    // Panel fill — rich amber, semi-transparent
    ctx.fillStyle = `rgba(${(255 * f) | 0}, ${(170 * f * bright) | 0}, ${(10 * f) | 0}, ${(0.55 + wave * 0.2) * f})`;
    ctx.beginPath();
    ctx.roundRect(px - panW / 2, py, panW, panH, 4);
    ctx.fill();

    // Glowing amber border — thick and bright
    ctx.strokeStyle = `rgba(255, ${(220 * bright) | 0}, ${(80 * bright) | 0}, ${0.98 * f})`;
    ctx.lineWidth = Math.max(2, sw * 0.07);
    ctx.beginPath();
    ctx.roundRect(px - panW / 2, py, panW, panH, 4);
    ctx.stroke();

    // Chevron "<" inside — bright white-gold
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

    // Glass glint top-left
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
  let maxSpeed = manicMode ? MOVE_SPEED * MANIC_SPEED_MULTIPLIER : MOVE_SPEED;
  document.getElementById("spd-bar").style.width = (spd / maxSpeed) * 100 + "%";

  // In manic mode: speed label is boastful
  let spdLabel = spd.toFixed(1) + " t/s  " + (P.spd >= 0 ? "▲ FWD" : "▼ REV");
  if (manicMode && spd > MOVE_SPEED * 1.5) {
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
  if (manicMode && manicIntensity > 0.2) {
    // Distance feels closer AND fluctuates — time distortion
    let distortion = 1 - manicIntensity * 0.45;
    let flicker = Math.sin(pulse * 2.3) * manicIntensity * 0.2;
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

  // In manic mode: compass drifts subtly — player is overconfident, won't notice
  // The drift feels like noise, not malice. They trust themselves over the compass.
  let displayAngle = trueAngle + (manicMode ? compassDrift : 0);
  let rel = displayAngle - P.a;

  let ac = manicMode ? `rgb(255, 200, 50)` : "#ff8fab";
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

  if (manicMode && manicIntensity > 0) {
    const mi = manicIntensity;
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

    if (!hasPassedCheckpoint) {
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
buildMap();
resize();
