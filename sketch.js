// ================================================================
//  CROSSY MIND — raw Canvas2D raycaster (sketch.js)
//  A -> B journey: Travel from Community Centre (Point A) to
//  Recreation Centre (Point B). Manic episode occurs midway,
//  then depression state returns on the way back.
// ================================================================

// Import manic state modules (handles visual distortions during manic episodes)
import {
  ManicState,
  MANIC_CHECKPOINT_ZONE,
  MANIC_SPEED_MULTIPLIER,
  ARROW_POOL,
} from "./manicState.js";
import { drawManicOverlays, drawRoadArrow } from "./manicOverlays.js";
// Import depression state modules (handles visual effects during low mood)
import {
  DepressionState,
  DEPRESSION_SPEED_MULTIPLIER,
} from "./depressionState.js";
import { drawDepressionOverlays } from "./depressionOverlays.js";

// ── Constants ────────────────────────────────────────────────
const ROWS = 56, // Map grid height: 56x56 tiles
  COLS = 56; // Map grid width
const MOVE_SPEED = 3.5; // Player max movement speed (tiles/sec)
const ACCEL = 22; // How quickly player accelerates to max speed
const DECEL = 16; // Friction/deceleration when not pressing move keys
const TURN_SPEED = 2.5; // How fast player rotates (radians/sec)
const GOAL_R = 1.4; // Proximity radius to reach goal location
const FOV = Math.PI / 3; // Field of view (60 degrees)
const MAX_D = 28; // Maximum rendering distance (far clip plane)

// ── Canvas setup ─────────────────────────────────────────────
let canvas, ctx; // Canvas element and 2D drawing context

let W = 0, // Canvas width (set on resize)
  H = 0; // Canvas height (set on resize)
let imgData, buf32, zBuf; // Image data for pixel-by-pixel raycasting, z-buffer for depth

// roundRect polyfill (for older browsers that don't support roundRect)
// Allows drawing rectangles with rounded corners
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
// 0=road  1=grass wall  2=kerb  3=comm.centre  4=grocery  5=library  6=park(goal B)
let MAP = [];

// Road layout: horizontal rows and vertical columns on 56x56 grid
// Roads are 2 tiles wide. Intersections every ~10 tiles.
const ROAD_ROWS = [3, 13, 23, 33, 43, 51];
const ROAD_COLS = [3, 13, 23, 33, 43, 51];

function buildMap() {
  // ───────────────────────────────────────────────────────────────
  // MAP GENERATION — Create 56×56 tile grid with roads & buildings
  // Tile types: 0=road, 1=grass, 2=kerb, 3-6=buildings, etc.
  // ───────────────────────────────────────────────────────────────
  MAP = [];
  // Initialize entire map as grass (value 1) = non-walkable
  for (let r = 0; r < ROWS; r++) MAP.push(new Uint8Array(COLS).fill(1));

  // Create horizontal roads (crossing left-right)
  // Each road is 2 tiles wide to give enough space for movement
  ROAD_ROWS.forEach((r) => {
    for (let c = 0; c < COLS; c++) {
      MAP[r][c] = 0; // Road tile 1
      if (r + 1 < ROWS) MAP[r + 1][c] = 0; // Road tile 2
    }
  });
  // Create vertical roads (crossing top-bottom)
  ROAD_COLS.forEach((c) => {
    for (let r = 0; r < ROWS; r++) {
      MAP[r][c] = 0; // Road tile 1
      if (c + 1 < COLS) MAP[r][c + 1] = 0; // Road tile 2
    }
  });

  // Add kerbs (sidewalk edges) around all roads
  // Kerb prevents player from driving on grass immediately next to roads
  let sw = new Set();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === 0) {
        // If this is a road tile
        // Check all 4 adjacent tiles (up/down/left/right)
        for (let [dr, dc] of [
          [-1, 0], // up
          [1, 0], // down
          [0, -1], // left
          [0, 1], // right
        ]) {
          let nr = r + dr,
            nc = c + dc;
          // If adjacent tile is grass (1), mark it as kerb location
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && MAP[nr][nc] === 1)
            sw.add(nr * 200 + nc);
        }
      }
    }
  // Apply kerb type (2) to all marked locations
  sw.forEach((k) => {
    MAP[(k / 200) | 0][k % 200] = 2;
  });

  // ───────────────────────────────────────────────────────────────
  // BUILDING PLACEMENT — 2×2 tile buildings in grass areas
  // ───────────────────────────────────────────────────────────────
  // Community Centre (start) — t:3 — top-left area [5,5]
  for (let dr = 0; dr < 2; dr++)
    for (let dc = 0; dc < 2; dc++) {
      MAP[5 + dr][5 + dc] = 3;
    }
  // Grocery Store (manic checkpoint) — t:4 — center [25,25]
  for (let dr = 0; dr < 2; dr++)
    for (let dc = 0; dc < 2; dc++) {
      MAP[25 + dr][25 + dc] = 4;
    }
  // Library (depression checkpoint) — t:5 — top-right [5,35]
  for (let dr = 0; dr < 2; dr++)
    for (let dc = 0; dc < 2; dc++) {
      MAP[5 + dr][35 + dc] = 5;
    }
  // Park/Recreation Centre (goal B) — t:6 — bottom-right [45,45]
  for (let dr = 0; dr < 2; dr++)
    for (let dc = 0; dc < 2; dc++) {
      MAP[45 + dr][45 + dc] = 6;
    }
}

function solid(x, y) {
  let c = x | 0,
    r = y | 0;
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return true;
  return MAP[r][c] !== 0;
}

// ── Goals ────────────────────────────────────────────────────
const GA = { x: 5.5, y: 4.5, label: "Community Centre" }; // start
const GB = { x: 44.5, y: 44.5, label: "Recreation Centre" }; // final goal — on road, not inside building
// Mid-map checkpoints (buildings to visit)
const GC = { x: 24.5, y: 24.5, label: "Grocery Store" }; // manic checkpoint building — on road
const GD = { x: 34.5, y: 5.5, label: "Library" }; // depression checkpoint building — on road

// ── Player ───────────────────────────────────────────────────
let P = { x: 0, y: 0, a: 0, spd: 0 };

// ── NPCs ─────────────────────────────────────────────────────
let NPCS = [];
const NPC_INIT = [
  // Horizontal road traffic
  { x: 8, y: 3.5, vx: 2.5, vy: 0, r: 220, g: 70, b: 80 },
  { x: 28, y: 13.5, vx: -2.2, vy: 0, r: 70, g: 130, b: 220 },
  { x: 40, y: 3.5, vx: 3.0, vy: 0, r: 240, g: 190, b: 50 },
  { x: 18, y: 23.5, vx: -2.8, vy: 0, r: 255, g: 140, b: 0 },
  { x: 8, y: 33.5, vx: 2.4, vy: 0, r: 80, g: 200, b: 160 },
  { x: 38, y: 43.5, vx: -3.0, vy: 0, r: 160, g: 80, b: 200 },
  { x: 50, y: 51.5, vx: 2.8, vy: 0, r: 255, g: 80, b: 120 },
  { x: 20, y: 43.5, vx: 3.2, vy: 0, r: 255, g: 220, b: 50 },
  // Vertical road traffic
  { x: 23.5, y: 8, vx: 0, vy: 2.0, r: 70, g: 130, b: 220 },
  { x: 13.5, y: 30, vx: 0, vy: -2.6, r: 50, g: 200, b: 180 },
  { x: 33.5, y: 18, vx: 0, vy: 2.4, r: 200, g: 60, b: 60 },
  { x: 43.5, y: 28, vx: 0, vy: -2.0, r: 80, g: 160, b: 255 },
  { x: 3.5, y: 18, vx: 0, vy: 2.2, r: 255, g: 160, b: 80 },
  { x: 53.5, y: 38, vx: 0, vy: -2.8, r: 220, g: 70, b: 80 },
  { x: 3.5, y: 40, vx: 0, vy: 3.0, r: 70, g: 130, b: 220 },
  { x: 43.5, y: 10, vx: 0, vy: -2.4, r: 240, g: 190, b: 50 },
  // Extra traffic mid-map
  { x: 30, y: 33.5, vx: -2.6, vy: 0, r: 100, g: 200, b: 140 },
  { x: 48, y: 23.5, vx: 2.0, vy: 0, r: 255, g: 100, b: 180 },
  { x: 23.5, y: 45, vx: 0, vy: 2.6, r: 180, g: 220, b: 80 },
  { x: 33.5, y: 48, vx: 0, vy: -2.2, r: 255, g: 180, b: 60 },
];

// ── Static sprites ───────────────────────────────────────────
let SPRITES = [];

function buildScene() {
  NPCS = NPC_INIT.map((n) => ({ ...n }));
  SPRITES = [];

  // Trees — scattered across grass blocks
  [
    // Row 0 band (above road row 3)
    [1.5, 1.5],
    [7.5, 1.5],
    [11.5, 1.5],
    [17.5, 1.5],
    [21.5, 1.5],
    [27.5, 1.5],
    [31.5, 1.5],
    [37.5, 1.5],
    [41.5, 1.5],
    [47.5, 1.5],
    [51.5, 1.5],
    // Between row-roads 3 and 13
    [1.5, 8.5],
    [7.5, 8.5],
    [11.5, 7.5],
    [17.5, 9.5],
    [21.5, 8.5],
    [27.5, 7.5],
    [31.5, 9.5],
    [37.5, 8.5],
    [41.5, 7.5],
    [47.5, 9.5],
    [51.5, 8.5],
    // Between row-roads 13 and 23
    [1.5, 18.5],
    [6.5, 19.5],
    [11.5, 18.5],
    [16.5, 17.5],
    [21.5, 19.5],
    [27.5, 18.5],
    [31.5, 17.5],
    [36.5, 19.5],
    [41.5, 18.5],
    [47.5, 17.5],
    [51.5, 19.5],
    // Between row-roads 23 and 33
    [1.5, 28.5],
    [7.5, 29.5],
    [11.5, 28.5],
    [16.5, 29.5],
    [21.5, 28.5],
    [31.5, 28.5],
    [36.5, 29.5],
    [41.5, 28.5],
    [47.5, 29.5],
    [51.5, 28.5],
    // Between row-roads 33 and 43
    [1.5, 38.5],
    [7.5, 39.5],
    [11.5, 38.5],
    [17.5, 39.5],
    [21.5, 38.5],
    [27.5, 38.5],
    [31.5, 39.5],
    [37.5, 38.5],
    [41.5, 39.5],
    [47.5, 38.5],
    [51.5, 39.5],
    // Between row-roads 43 and 51
    [1.5, 47.5],
    [7.5, 47.5],
    [11.5, 48.5],
    [17.5, 47.5],
    [21.5, 48.5],
    [27.5, 47.5],
    [31.5, 48.5],
    [37.5, 47.5],
    [41.5, 48.5],
    [51.5, 47.5],
    // Bottom edge
    [1.5, 53.5],
    [7.5, 54.5],
    [17.5, 53.5],
    [27.5, 54.5],
    [37.5, 53.5],
    [47.5, 54.5],
  ].forEach(([x, y]) => SPRITES.push({ x, y, t: 0 }));

  // STOP signs at intersections
  [
    [2.5, 2.5],
    [12.5, 2.5],
    [22.5, 2.5],
    [32.5, 2.5],
    [42.5, 2.5],
    [50.5, 2.5],
    [2.5, 12.5],
    [12.5, 12.5],
    [22.5, 12.5],
    [32.5, 12.5],
    [42.5, 12.5],
    [50.5, 12.5],
    [2.5, 22.5],
    [12.5, 22.5],
    [22.5, 22.5],
    [32.5, 22.5],
    [42.5, 22.5],
    [50.5, 22.5],
    [2.5, 32.5],
    [12.5, 32.5],
    [22.5, 32.5],
    [32.5, 32.5],
    [42.5, 32.5],
    [50.5, 32.5],
    [2.5, 42.5],
    [12.5, 42.5],
    [22.5, 42.5],
    [32.5, 42.5],
    [42.5, 42.5],
    [50.5, 42.5],
    [2.5, 50.5],
    [12.5, 50.5],
    [22.5, 50.5],
    [32.5, 50.5],
    [42.5, 50.5],
  ].forEach(([x, y]) => SPRITES.push({ x, y, t: 1 }));

  // ── Goal building anchors (visual sprites) ───────────────────
  // Community Centre (start) — t:3
  SPRITES.push({ x: 6.0, y: 6.0, t: 3 });
  // Recreation Centre / Park (final goal) — t:7
  SPRITES.push({ x: 46.0, y: 46.0, t: 7 });
  // Grocery Store (manic checkpoint building) — t:4
  SPRITES.push({ x: 26.0, y: 26.0, t: 4 });
  // Library (depression checkpoint building) — t:6 reused as library
  SPRITES.push({ x: 36.0, y: 6.0, t: 8, name: "LIBRARY" });

  // ── Extra decorative buildings along roads ───────────────────
  SPRITES.push({ x: 8.5, y: 16.5, t: 11, name: "CAFÉ" });
  SPRITES.push({ x: 38.5, y: 16.5, t: 11, name: "CAFÉ" });
  SPRITES.push({ x: 18.5, y: 26.5, t: 12, name: "SCHOOL" });
  SPRITES.push({ x: 38.5, y: 36.5, t: 12, name: "SCHOOL" });
  SPRITES.push({ x: 8.5, y: 36.5, t: 11, name: "BANK" });
  SPRITES.push({ x: 28.5, y: 46.5, t: 11, name: "PHARMACY" });
  SPRITES.push({ x: 48.5, y: 36.5, t: 12, name: "FIRE STATION" });
  SPRITES.push({ x: 48.5, y: 16.5, t: 11, name: "POST OFFICE" });

  // ── New building variety — skyscrapers, townhouses, shops ──
  // Skyscrapers (t: 13) — tall modern buildings
  SPRITES.push({ x: 3.5, y: 8.5, t: 13, name: "TOWER" });
  SPRITES.push({ x: 53.5, y: 8.5, t: 13, name: "OFFICE COMPLEX" });
  SPRITES.push({ x: 13.5, y: 46.5, t: 13, name: "TECH HUB" });

  // Townhouses (t: 14) — narrow multi-story residential
  SPRITES.push({ x: 5.5, y: 28.5, t: 14, name: "TOWNHOUSES" });
  SPRITES.push({ x: 51.5, y: 28.5, t: 14, name: "RESIDENCES" });
  SPRITES.push({ x: 28.5, y: 5.5, t: 14, name: "APARTMENTS" });
  SPRITES.push({ x: 15.5, y: 38.5, t: 14, name: "FLATS" });
  SPRITES.push({ x: 42.5, y: 5.5, t: 14, name: "LOFTS" });

  // Small Shops (t: 15) — ground floor commercial
  SPRITES.push({ x: 11.5, y: 11.5, t: 15, name: "BAKERY" });
  SPRITES.push({ x: 46.5, y: 11.5, t: 15, name: "BOOKSTORE" });
  SPRITES.push({ x: 20.5, y: 46.5, t: 15, name: "FLOWER SHOP" });
  SPRITES.push({ x: 40.5, y: 46.5, t: 15, name: "BUTCHER" });
  SPRITES.push({ x: 35.5, y: 18.5, t: 15, name: "DELI" });
  SPRITES.push({ x: 15.5, y: 50.5, t: 15, name: "VINTAGE SHOP" });

  // ── Manic checkpoint marker (shown before manic episode) ─────
  SPRITES.push({
    x: MANIC_CHECKPOINT_ZONE.x,
    y: MANIC_CHECKPOINT_ZONE.y,
    t: 10,
  });

  // ── Misleading GROCERY STORE signs (t:9) — manic mode only ──
  // Signs mislead player away from Grocery Store (26.5, 26.5 — center map)
  // Wrong direction signs scattered around mid-map roads
  SPRITES.push({ x: 21.5, y: 18.5, t: 9, dir: Math.PI, label: "← GROCERY" });
  SPRITES.push({
    x: 18.5,
    y: 21.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ GROCERY",
  });
  SPRITES.push({ x: 31.5, y: 22.5, t: 9, dir: 0, label: "→ GROCERY" });
  SPRITES.push({
    x: 22.5,
    y: 31.5,
    t: 9,
    dir: Math.PI / 2,
    label: "↓ GROCERY",
  });
  SPRITES.push({ x: 11.5, y: 14.5, t: 9, dir: Math.PI, label: "← GROCERY" });
  SPRITES.push({
    x: 14.5,
    y: 11.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ GROCERY",
  });
  SPRITES.push({ x: 21.5, y: 8.5, t: 9, dir: 0, label: "→ GROCERY" });
  SPRITES.push({
    x: 28.5,
    y: 11.5,
    t: 9,
    dir: Math.PI / 2,
    label: "↓ GROCERY",
  });
  SPRITES.push({ x: 38.5, y: 24.5, t: 9, dir: 0, label: "→ GROCERY" });
  SPRITES.push({
    x: 32.5,
    y: 18.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ GROCERY",
  });
  SPRITES.push({ x: 11.5, y: 28.5, t: 9, dir: Math.PI, label: "← GROCERY" });
  SPRITES.push({
    x: 28.5,
    y: 38.5,
    t: 9,
    dir: Math.PI / 2,
    label: "↓ GROCERY",
  });
  SPRITES.push({ x: 38.5, y: 28.5, t: 9, dir: 0, label: "→ GROCERY" });
  SPRITES.push({ x: 42.5, y: 14.5, t: 9, dir: Math.PI, label: "← GROCERY" });
  SPRITES.push({
    x: 8.5,
    y: 22.5,
    t: 9,
    dir: -Math.PI / 2,
    label: "↑ GROCERY",
  });
  SPRITES.push({ x: 22.5, y: 42.5, t: 9, dir: 0, label: "→ GROCERY" });
}

// ── Game state ───────────────────────────────────────────────
let gameState = "landing";
let tripPhase = 0; // 0=going to Recreation Centre, 1=returning to start
let pulse = 0;
const KEYS = {};
let initialDistanceToGoal = 0;
let isPaused = false;

// ── Audio ────────────────────────────────────────────────────
const backgroundAudio = document.getElementById("background-audio");
backgroundAudio.volume = 0.5;
const winAudio = document.getElementById("win-audio");
winAudio.volume = 0.6;

// ── Accessibility Settings ───────────────────────────────────
let reducedEffectsMode = false;
let skipManicEpisode = false;

// ── Manic Episode State (using module) ──────────────────────
const manicState = new ManicState();
const depressionState = new DepressionState();

// ── State Notifications ──────────────────────────────────────
let stateNotifications = [];

function pushStateNotification(
  text,
  color = "#f8d67a",
  duration = 2.4,
  icon = "",
  subtitle = "",
) {
  stateNotifications.push({
    text,
    color,
    life: duration,
    maxLife: duration,
    icon,
    subtitle,
  });
}

function updateStateNotifications(dt) {
  stateNotifications.forEach((n) => {
    n.life -= dt;
  });
  stateNotifications = stateNotifications.filter((n) => n.life > 0);
}

function drawStateNotifications() {
  if (!stateNotifications.length) return;
  const n = stateNotifications[0];

  // Slide in from top, hold, slide out
  const slideInT = 0.28;
  const slideOutT = 0.32;
  let slideY = 0;
  let alpha = 1;
  if (n.life > n.maxLife - slideInT) {
    const t = 1 - (n.life - (n.maxLife - slideInT)) / slideInT;
    slideY = (1 - t) * -80;
    alpha = t;
  } else if (n.life < slideOutT) {
    const t = n.life / slideOutT;
    slideY = (1 - t) * -80;
    alpha = t;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(0, slideY);

  const hasSubtitle = n.subtitle && n.subtitle.length > 0;
  const boxW = Math.min(W * 0.7, 480);
  const boxH = hasSubtitle ? 72 : 52;
  const boxX = W / 2 - boxW / 2;
  const boxY = 120; // Moved lower to avoid compass overlap

  // Drop shadow
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;

  // Background
  ctx.fillStyle = "rgba(6, 8, 18, 0.92)";
  ctx.roundRect(boxX, boxY, boxW, boxH, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // Coloured left accent bar
  ctx.fillStyle = n.color;
  ctx.roundRect(boxX, boxY, 5, boxH, [18, 0, 0, 18]);
  ctx.fill();

  // Outer glow border
  ctx.strokeStyle = n.color;
  ctx.lineWidth = 1.5;
  ctx.globalAlpha = alpha * 0.7;
  ctx.roundRect(boxX, boxY, boxW, boxH, 18);
  ctx.stroke();
  ctx.globalAlpha = alpha;

  // Icon
  if (n.icon) {
    ctx.font = `${hasSubtitle ? 28 : 24}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(n.icon, boxX + 20, boxY + boxH / 2);
  }

  const textX = boxX + (n.icon ? 60 : 22);

  // Main text
  ctx.font = `800 ${hasSubtitle ? 16 : 17}px "Segoe UI", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = hasSubtitle ? "alphabetic" : "middle";
  ctx.fillStyle = n.color;
  ctx.fillText(
    n.text,
    textX,
    hasSubtitle ? boxY + boxH * 0.44 : boxY + boxH / 2,
  );

  // Subtitle
  if (hasSubtitle) {
    ctx.font = '500 12px "Segoe UI", sans-serif';
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(n.subtitle, textX, boxY + boxH * 0.72);
  }

  ctx.restore();
}

// ── Checkpoint tracking ───────────────────────────────────────
let _checkpointFlags = {
  grocery: false,
  library: false,
  goal: false,
  home: false,
};

function resetGame() {
  // Start in centre of right lane near Community Centre
  P = { x: 5.5, y: 4.5, a: 0, spd: 0 };
  pulse = 0;
  tripPhase = 0;
  initialDistanceToGoal = Math.hypot(GB.x - GA.x, GB.y - GA.y);

  // Reset manic state using module
  manicState.reset();
  manicState._notifiedStart = false;
  depressionState.reset();
  stateNotifications = [];
  _checkpointFlags = {
    grocery: false,
    library: false,
    goal: false,
    home: false,
  };

  buildScene();
  resetFog();
}

// ── Input ────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  KEYS[e.code] = true;

  // Pause on Space key
  if (e.code === "Space" && gameState === "playing") {
    e.preventDefault();
    togglePause();
  } else if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)
  )
    e.preventDefault();
});
document.addEventListener("keyup", (e) => {
  KEYS[e.code] = false;
});

function showGame() {
  document.getElementById("screen-intro").style.display = "none";
  document.getElementById("screen-win").style.display = "none";
  document.getElementById("screen-pause").style.display = "none";
  document.getElementById("hud").style.display = "block";
  document.getElementById("compass").style.display = "block";
  document.getElementById("minimap-wrap").style.display = "block";
  document.getElementById("btn-pause").style.display = "block";
  isPaused = false;
  gameState = "playing";
  backgroundAudio.play();
}

function togglePause() {
  isPaused = !isPaused;
  if (isPaused) {
    document.getElementById("screen-pause").style.display = "flex";
    backgroundAudio.pause();
  } else {
    document.getElementById("screen-pause").style.display = "none";
    backgroundAudio.play();
  }
}

function resumeGame() {
  isPaused = false;
  document.getElementById("screen-pause").style.display = "none";
  backgroundAudio.play();
}
function showWin() {
  if (manicState.manicMode) {
    pushStateNotification("MANIC STATE ENDING", "#f5b347", 2.0, "⚡");
  }
  if (depressionState.depressionMode) {
    pushStateNotification("DEPRESSION STATE ENDING", "#9eb1ff", 2.0, "🌙");
  }
  manicState.manicMode = false;
  manicState.manicIntensity = 0;
  depressionState.depressionMode = false;
  depressionState.depressionIntensity = 0;
  document.getElementById("hud").style.display = "none";
  document.getElementById("compass").style.display = "none";
  document.getElementById("minimap-wrap").style.display = "none";
  document.getElementById("btn-pause").style.display = "none";
  document.getElementById("screen-pause").style.display = "none";
  document.getElementById("screen-win").style.display = "flex";
  backgroundAudio.pause();
  backgroundAudio.currentTime = 0;
  winAudio.currentTime = 0;
  winAudio.play();
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

  // Skip game updates when paused, but still render
  if (isPaused) {
    render();
    return;
  }

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

  if (!manicState._notifiedStart && manicState.manicMode && !skipManicEpisode) {
    manicState._notifiedStart = true;
    pushStateNotification(
      "MANIC STATE STARTING",
      "#f8c14f",
      2.8,
      "⚡",
      "Brace yourself — things are speeding up",
    );
  }

  depressionState.update(dt, pulse, reducedEffectsMode);
  updateStateNotifications(dt);

  // Update audio playback speed based on game state
  if (manicState.manicMode) {
    backgroundAudio.playbackRate = 2.0; // 2x speed during manic
  } else if (depressionState.depressionMode) {
    backgroundAudio.playbackRate = 0.5; // 0.5x speed during depression
  } else {
    backgroundAudio.playbackRate = 1.0; // Normal speed
  }

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
  let speedMult = 1.0;
  if (manicState.manicMode) speedMult = MANIC_SPEED_MULTIPLIER;
  if (depressionState.depressionMode) speedMult = DEPRESSION_SPEED_MULTIPLIER;

  let maxSpeed = MOVE_SPEED * speedMult;
  let accelRate = ACCEL * speedMult;

  if (depressionState.depressionMode) {
    accelRate *= 0.52;
  }

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

  // ═══════════════════════════════════════════════════════════════
  // CHECKPOINT LOGIC — Handle reaching Point B (Recreation Centre)
  // ═══════════════════════════════════════════════════════════════

  if (tripPhase === 0) {
    // tripPhase 0 = Going TO Point B (goal)
    let dd = Math.hypot(P.x - GB.x, P.y - GB.y); // Distance to goal

    // ── Track intermediate checkpoints (Grocery Store & Library) ─
    // These are tracked internally but no longer show notifications
    if (!_checkpointFlags.grocery) {
      let dGrocery = Math.hypot(P.x - GC.x, P.y - GC.y);
      if (dGrocery < GOAL_R * 2.5) {
        _checkpointFlags.grocery = true;
        // Flag set but notification removed — quiet checkpoint tracking
      }
    }
    if (!_checkpointFlags.library) {
      let dLib = Math.hypot(P.x - GD.x, P.y - GD.y);
      if (dLib < GOAL_R * 2.5) {
        _checkpointFlags.library = true;
        // Flag set but notification removed — quiet checkpoint tracking
      }
    }

    // ── MAIN GOAL: Reach Point B (Recreation Centre) ─────────────
    // When player gets within GOAL_R (1.4 tiles) of recreation centre
    if (dd < GOAL_R) {
      if (!_checkpointFlags.goal) {
        _checkpointFlags.goal = true;
        // Display goal reached notification with emoji and color
        pushStateNotification(
          "RECREATION CENTRE",
          "#22c55e", // Green color
          3.8, // Duration: 3.8 seconds
          "🌳", // Tree emoji
          "Destination reached — now head back!",
        );
      }

      // ── MOOD TRANSITION: Manic → Depression ──────────────────
      // Reaching Point B triggers the mood change in the narrative
      // If player was in manic state, switch to depression state
      if (manicState.manicMode && !depressionState.depressionMode) {
        // Reset all manic state visual effects
        manicState.manicMode = false; // Exit manic mode
        manicState.manicIntensity = 0; // Clear intensity level
        manicState.activeThoughts = []; // Clear intrusive thoughts
        manicState.activeArrowIdx = -1; // Clear misleading arrows
        manicState.arrowFadeAlpha = 0;
        manicState.phantomSprites = []; // Clear visual hallucinations
        manicState.screenRotation = 0; // Stop map rotation
        manicState.shakeOffsetX = 0; // Stop screen shake
        manicState.shakeOffsetY = 0;
        manicState.compassDrift = 0; // Stop compass distortion
        manicState.worldBloom = 0; // Clear bloom effect

        // Trigger depression state (darkened mood, visual dampening)
        depressionState.trigger(pulse);

        // Show mood transition notifications to player
        pushStateNotification("MANIC STATE ENDING", "#f5b347", 2.0, "⚡");
        pushStateNotification(
          "DEPRESSION STATE STARTING",
          "#9eb1ff", // Blue color
          2.4,
          "🌙", // Moon emoji
        );
      }
      tripPhase = 1; // Switch to return phase (heading back to Point A)
    }
  } else {
    // tripPhase 1 = Returning back to Point A (starting location)
    // Player has reached the destination and is now heading home
    let dd = Math.hypot(P.x - GA.x, P.y - GA.y); // Distance to home
    // Win condition: reach starting point (Community Centre) to complete journey
    if (dd < GOAL_R) showWin();
  }
}

// ================================================================
//  RENDER FUNCTION — Raycasting 3D Engine
//  Uses Canvas2D pixel manipulation to draw first-person view
// ================================================================
function render() {
  const W2 = W, // Canvas width
    H2 = H; // Canvas height
  const hor = (H2 >> 1) + 1; // +1 ensures wall bottom (hor) and floor start (hor+1) leave no gap
  const buf = buf32; // 32-bit pixel buffer for fast writing
  const zb = zBuf; // Z-buffer for depth sorting

  // ═══════════════════════════════════════════════════════════════
  // SKY RENDERING — Gradient from top to horizon
  // Mood states affect sky color (manic = warmer, depression = cooler)
  // ═══════════════════════════════════════════════════════════════
  for (let y = 0; y <= hor; y++) {
    let t = y / hor; // 0=top, 1=horizon (interpolation value)

    // Base gradient: cool blue transitioning to lighter at horizon
    let r = (160 + t * 55) | 0; // Red: 160-215
    let g = (210 + t * 22) | 0; // Green: 210-232
    let b = (255 - t * 10) | 0; // Blue: 255-245

    // Apply mood state color effects to the sky
    if (depressionState.depressionMode) {
      // Depression: desaturates and darkens sky for gloomy atmosphere
      let skyColors = depressionState.applySkyEffects(r, g, b, t, pulse);
      r = skyColors.r;
      g = skyColors.g;
      b = skyColors.b;
    } else {
      // Manic state: saturates and distorts sky colors
      let skyColors = manicState.applySkyEffects(r, g, b, t, pulse);
      r = skyColors.r;
      g = skyColors.g;
      b = skyColors.b;
    }

    // Pack RGB into 32-bit RGBA color (0xFFRGB format)
    let col = 0xff000000 | (b << 16) | (g << 8) | r; // Alpha=255 (fully opaque)
    // Fill entire scanline (y) with the sky color
    buf.fill(col, y * W2, y * W2 + W2);
  }

  // ═══════════════════════════════════════════════════════════════
  // RAYCASTING — Render 3D floor/walls using perspective projection
  // ═══════════════════════════════════════════════════════════════
  // Calculate camera direction and field of view plane
  const dirX = Math.cos(P.a), // Camera points forward in this X direction
    dirY = Math.sin(P.a); // Camera points forward in this Y direction
  const planeScale = Math.tan(FOV / 2); // FOV half-angle tangent
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

  for (let y = hor + 1; y < H2; y++) {
    const p = y - hor;
    const rowDist = (0.5 * H2) / p;
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

      if (depressionState.depressionMode) {
        const wd = depressionState.applyWorldEffects(r, g, b);
        r = wd.r;
        g = wd.g;
        b = wd.b;
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

    // ── BUILDING HEIGHT VARIATION ──────────────────────────────
    // Apply height multipliers for different building types
    // Use tile position to create deterministic per-building variation
    let seed = (mc * 73 + mr * 97) >>> 0; // Deterministic seed from position
    let heightVar = 0.85 + (seed % 30) / 100; // Varies 0.85 to 1.85

    let baseMultiplier = 1.5;
    if (tt === 3)
      baseMultiplier = 1.7; // Community centre - tall
    else if (tt === 4)
      baseMultiplier = 1.8; // Grocery store
    else if (tt === 5)
      baseMultiplier = 1.2; // Library
    else if (tt === 6) baseMultiplier = 1.3; // Park - tall

    let heightMultiplier = baseMultiplier * heightVar;

    wallH = (wallH * heightMultiplier) | 0;
    wallH = depressionState.applyProjectionStretch(col, W2, wallH) | 0;
    let bot = hor; // Wall bottom pinned to horizon (ground level)
    let top = Math.max(0, (hor - wallH) | 0); // Wall rises upward from the horizon
    let fog = Math.max(0.06, 1 - pd / MAX_D);
    let dim = ns ? 0.62 : 1.0;
    let f = fog * dim;

    // ── PASTEL COLOR PALETTE ──────────────────────────────────
    let wr, wg, wb;
    if (tt === 1) {
      wr = 170;
      wg = 215;
      wb = 180; // pastel grass
    } else if (tt === 2) {
      wr = 220;
      wg = 210;
      wb = 190; // pastel kerb
    } else if (tt === 3) {
      wr = 180;
      wg = 210;
      wb = 240; // pastel blue
    } else if (tt === 4) {
      wr = 180;
      wg = 220;
      wb = 190; // pastel green
    } else if (tt === 5) {
      wr = 220;
      wg = 200;
      wb = 180; // pastel warm
    } else if (tt === 6) {
      wr = 180;
      wg = 230;
      wb = 200; // pastel mint
    } else {
      wr = 200;
      wg = 200;
      wb = 200;
    }

    if (depressionState.depressionMode) {
      const wd = depressionState.applyWorldEffects(wr, wg, wb);
      wr = wd.r;
      wg = wd.g;
      wb = wd.b;
    }

    // In manic mode: walls glow more warmly/vividly
    if (manicState.manicMode && manicState.worldBloom > 0) {
      if (tt === 1) {
        wg = Math.min(240, wg + manicState.worldBloom * 25) | 0;
      }
    }

    // World-stable facade wrapping so all existing raycast buildings keep their shape
    // but get a stronger 3D-looking surface treatment.
    const faceU = ns ? P.x + pd * rdx : P.y + pd * rdy;
    const texU = faceU - Math.floor(faceU);
    const clusterX = (mc / 4) | 0;
    const clusterY = (mr / 4) | 0;
    const clusterSeed = (clusterX * 131 + clusterY * 197) >>> 0;
    const blockSeed = (mc * 73 + mr * 97 + tt * 31 + clusterSeed) >>> 0;
    const facadeType = blockSeed % 7;
    const colsN = 3 + (blockSeed % 4);
    const rowsN = 6 + ((blockSeed >> 2) % 6);
    const cornice = 0.07 + ((blockSeed >> 5) % 4) * 0.018;
    const plinth = 0.1 + ((blockSeed >> 7) % 3) * 0.035;

    // Give the ordinary city blocks more obvious variation too.
    if (tt === 1 || tt === 2) {
      if (facadeType === 0) {
        wr = 154;
        wg = 162;
        wb = 171; // cool concrete
      } else if (facadeType === 1) {
        wr = 126;
        wg = 146;
        wb = 170; // blue glass base
      } else if (facadeType === 2) {
        wr = 165;
        wg = 132;
        wb = 114; // brick
      } else if (facadeType === 3) {
        wr = 186;
        wg = 176;
        wb = 160; // warm concrete
      } else if (facadeType === 4) {
        wr = 108;
        wg = 114;
        wb = 126; // dark tower
      } else if (facadeType === 5) {
        wr = 145;
        wg = 138;
        wb = 120; // brownstone / mixed-use
      } else {
        wr = 168;
        wg = 172;
        wb = 150; // civic / retail
      }
      if (tt === 2) {
        wr = Math.min(255, wr + 16);
        wg = Math.min(255, wg + 16);
        wb = Math.min(255, wb + 12);
      }
    }

    for (let y = top; y <= bot; y++) {
      let frac = (y - top) / Math.max(wallH, 1);
      let tr = wr,
        tg = wg,
        tb = wb;

      // Shared chunky wrapping for all existing building masses.
      let u = texU;
      let roofBand = frac < cornice;
      let baseBand = frac > 1 - plinth;
      let vLocal = Math.max(
        0,
        Math.min(
          0.999,
          (frac - cornice) / Math.max(0.001, 1 - cornice - plinth),
        ),
      );
      let rowIdx = Math.floor(vLocal * rowsN);
      let colIdx = Math.floor(u * colsN);
      let cellU = u * colsN - colIdx;
      let cellV = vLocal * rowsN - rowIdx;
      let lit = ((blockSeed + rowIdx * 11 + colIdx * 7) & 3) !== 0;

      if (roofBand) {
        tr = Math.max(0, wr - 30);
        tg = Math.max(0, wg - 30);
        tb = Math.max(0, wb - 28);
      } else if (baseBand) {
        tr = Math.max(0, wr - 22);
        tg = Math.max(0, wg - 22);
        tb = Math.max(0, wb - 20);
      } else if (facadeType === 0) {
        // Office grid
        const frame =
          cellU < 0.16 || cellU > 0.84 || cellV < 0.18 || cellV > 0.82;
        if (frame) {
          tr = wr - 30;
          tg = wg - 30;
          tb = wb - 24;
        } else if (lit) {
          tr = 228;
          tg = 216;
          tb = 164;
        } else {
          tr = 52;
          tg = 66;
          tb = 88;
        }
      } else if (facadeType === 1) {
        // Glass tower strips
        const mullion = cellU < 0.12 || cellU > 0.88;
        const floorBand = cellV < 0.11;
        if (mullion || floorBand) {
          tr = 86;
          tg = 102;
          tb = 122;
        } else {
          tr = lit ? 178 : 104;
          tg = lit ? 202 : 134;
          tb = lit ? 220 : 166;
        }
      } else if (facadeType === 2) {
        // Brick / brownstone rows
        const mortar =
          cellV < 0.1 || (rowIdx & 1 ? cellU < 0.08 : cellU > 0.92);
        if (mortar) {
          tr = 122;
          tg = 96;
          tb = 84;
        } else if (
          cellU > 0.26 &&
          cellU < 0.74 &&
          cellV > 0.18 &&
          cellV < 0.76
        ) {
          tr = lit ? 224 : 56;
          tg = lit ? 206 : 60;
          tb = lit ? 154 : 72;
        } else {
          tr = 162;
          tg = 122;
          tb = 102;
        }
      } else if (facadeType === 3) {
        // Concrete mid-rise with ribbon windows
        const ribbon = cellV > 0.28 && cellV < 0.72;
        if (ribbon) {
          tr = lit ? 214 : 74;
          tg = lit ? 216 : 84;
          tb = lit ? 194 : 102;
        } else {
          tr = 178;
          tg = 170;
          tb = 156;
        }
        if (cellU < 0.08 || cellU > 0.92) {
          tr -= 22;
          tg -= 22;
          tb -= 16;
        }
      } else if (facadeType === 4) {
        // Dark tower / mixed use
        const stripe =
          cellU < 0.1 || cellU > 0.9 || ((colIdx + rowIdx) & 1 && cellV < 0.15);
        if (stripe) {
          tr = 72;
          tg = 76;
          tb = 90;
        } else if (lit) {
          tr = 208;
          tg = 196;
          tb = 148;
        } else {
          tr = 38;
          tg = 42;
          tb = 54;
        }
      } else if (facadeType === 5) {
        // Shop / civic with larger lower glazing
        if (vLocal > 0.66) {
          if (cellU < 0.08 || cellU > 0.92) {
            tr = wr - 36;
            tg = wg - 32;
            tb = wb - 26;
          } else {
            tr = lit ? 232 : 92;
            tg = lit ? 228 : 112;
            tb = lit ? 206 : 128;
          }
        } else {
          const frame =
            cellU < 0.14 || cellU > 0.86 || cellV < 0.16 || cellV > 0.84;
          if (frame) {
            tr = wr - 20;
            tg = wg - 20;
            tb = wb - 16;
          } else if (lit) {
            tr = 220;
            tg = 210;
            tb = 170;
          } else {
            tr = 64;
            tg = 70;
            tb = 80;
          }
        }
      } else {
        // Narrow-window tower
        const pier = cellU < 0.18 || cellU > 0.82;
        const slit =
          cellU > 0.34 && cellU < 0.66 && cellV > 0.18 && cellV < 0.82;
        if (pier) {
          tr = wr - 24;
          tg = wg - 24;
          tb = wb - 18;
        } else if (slit) {
          tr = lit ? 230 : 60;
          tg = lit ? 216 : 72;
          tb = lit ? 170 : 88;
        } else {
          tr = wr;
          tg = wg;
          tb = wb;
        }
      }

      // Landmark tinting still uses the same wrapping.
      if (tt === 3) {
        tr = Math.min(255, tr + 12);
        tg = Math.min(255, tg + 18);
        tb = Math.min(255, tb + 26);
      } else if (tt === 4) {
        tr = Math.min(255, tr + 6);
        tg = Math.min(255, tg + 18);
        tb = Math.min(255, tb + 8);
      } else if (tt === 5) {
        tr = Math.min(255, tr + 18);
        tg = Math.min(255, tg + 10);
        tb = Math.min(255, tb + 2);
      } else if (tt === 6) {
        tr = Math.min(255, tr + 10);
        tg = Math.min(255, tg + 20);
        tb = Math.min(255, tb + 14);
      }

      // Stronger side shading so more buildings visibly pick up dimension.
      if (ns) {
        tr = Math.max(0, tr - 24);
        tg = Math.max(0, tg - 24);
        tb = Math.max(0, tb - 20);
      }

      let r2 = (Math.max(0, tr) * f) | 0,
        g2 = (Math.max(0, tg) * f) | 0,
        b2 = (Math.max(0, tb) * f) | 0;
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
    spH = depressionState.applyProjectionStretch(sx, W2, spH) | 0;
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
      drawGrocery(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, "GROCERY STORE");
    } else if (sp.t === 6) {
      drawLibrary(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "LIBRARY");
    } else if (sp.t === 7) {
      drawPark(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, GB.label);
    } else if (sp.t === 8) {
      drawLibrary(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "LIBRARY");
    } else if (sp.t === 11) {
      drawCafe(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "CAFÉ");
    } else if (sp.t === 12) {
      drawSchool(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "SCHOOL");
    } else if (sp.t === 13) {
      drawSkyscraper(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "SKYSCRAPER");
    } else if (sp.t === 14) {
      drawTownhouse(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "TOWNHOUSE");
    } else if (sp.t === 15) {
      drawSmallShop(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "SHOP");
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

  if (
    depressionState.depressionMode &&
    depressionState.depressionIntensity > 0
  ) {
    drawDepressionOverlays(
      ctx,
      W,
      H,
      depressionState.depressionIntensity,
      pulse,
    );
  }

  drawStateNotifications();
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

  // Green border (grocery wayfinding colour)
  ctx.strokeStyle = `rgb(${(30 * f) | 0},${(140 * f) | 0},${(60 * f) | 0})`;
  ctx.lineWidth = Math.max(1.5, sw * 0.05);
  ctx.roundRect(signX, signY, signW, signH, Math.max(2, sw * 0.06));
  ctx.stroke();

  // ── Divider between text row and arrow row ────────────────────
  let divY = signY + signH * 0.52;
  ctx.strokeStyle = `rgba(${(30 * f) | 0},${(140 * f) | 0},${(60 * f) | 0},0.4)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(signX + 4, divY);
  ctx.lineTo(signX + signW - 4, divY);
  ctx.stroke();

  if (sw > 10) {
    // ── Top half: "GROCERY" text with green icon ──────────────
    let textY = signY + signH * 0.27;
    let fontSize = Math.max(5, sw * 0.15) | 0;
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // Green square icon to the left of text
    if (sw > 20) {
      let crossSize = Math.max(3, fontSize * 0.55);
      let crossX = signX + signW * 0.18;
      ctx.fillStyle = `rgb(${(40 * f) | 0},${(160 * f) | 0},${(70 * f) | 0})`;
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
    ctx.fillText("GROCERY", cx + (sw > 20 ? signW * 0.06 : 0), textY);

    // ── Bottom half: arrow pointing in `direction` ────────────
    // direction is world-space angle (0=East). The arrow is drawn
    // pointing right (East) then rotated, so it always matches the label.
    let arrowCY = signY + signH * 0.76;
    let arrowLen = signW * 0.32;
    let arrowHead = arrowLen * 0.38;

    ctx.save();
    ctx.translate(cx, arrowCY);
    ctx.rotate(direction); // rotate so arrow tip points in `direction`

    ctx.strokeStyle = `rgb(${(30 * f) | 0},${(140 * f) | 0},${(60 * f) | 0})`;
    ctx.lineWidth = Math.max(1.5, sw * 0.06);
    ctx.lineCap = "round";

    // Shaft
    ctx.beginPath();
    ctx.moveTo(-arrowLen * 0.5, 0);
    ctx.lineTo(arrowLen * 0.5, 0);
    ctx.stroke();

    // Head (filled triangle pointing right before rotation)
    ctx.fillStyle = `rgb(${(30 * f) | 0},${(140 * f) | 0},${(60 * f) | 0})`;
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
// Helper: draw a simple arched window
function _archWin(cx2, wy, wW, wH, f, lit) {
  if (lit) {
    ctx.fillStyle = `rgba(${(220 * f) | 0},${(240 * f) | 0},${(255 * f) | 0},0.9)`;
  } else {
    ctx.fillStyle = `rgba(${(28 * f) | 0},${(45 * f) | 0},${(75 * f) | 0},0.85)`;
  }
  ctx.fillRect(cx2, wy + wH * 0.3, wW, wH * 0.7);
  ctx.beginPath();
  ctx.arc(cx2 + wW / 2, wy + wH * 0.3, wW / 2, Math.PI, 0);
  ctx.fill();
  if (lit) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 * f})`;
    ctx.fillRect(cx2, wy + wH * 0.3, wW * 0.35, wH * 0.25);
  }
}

// ── Community Centre (Building Type 3) ────────────────────────
// Blue glass office building at starting location (Point A)
// Features: Curtain-wall facade, window grid, antenna, parapet
function drawCommunity(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return; // Skip if not visible
  const f = fog; // Apply distance-based fog (brightness decreases with distance)
  const bw = sw * 2.5, // Building width relative to screen size (wider)
    bh = sh * 3.2; // Building height (extra tall modern office)
  const bx = cx - bw / 2, // Left edge of building (centered on screen)
    by = sy - sh * 1.2; // Top edge of building

  // Glow effect when player is close to building (under 16 tiles away)
  // Creates cyan halo around the structure
  if (sd < 16) {
    let ga = (1 - sd / 16) * 0.25 * f; // Glow alpha based on distance
    let g2 = ctx.createRadialGradient(
      cx,
      by + bh * 0.5,
      0,
      cx,
      by + bh * 0.5,
      bw * 1.3,
    );
    g2.addColorStop(0, `rgba(100,255,255,${ga})`); // BRIGHT cyan center
    g2.addColorStop(1, "rgba(100,255,255,0)"); // Fades to transparent
    ctx.fillStyle = g2;
    ctx.fillRect(bx - bw, by - bh * 0.3, bw * 3, bh * 1.6);
  }

  // Main facade with gradient (top to bottom brightening)
  // Simulates light reflecting off glass curtain wall
  const fgrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(50 * f) | 0},${(230 * f) | 0},${(255 * f) | 0},1)`, // BRIGHT cyan
  );
  fgrad.addColorStop(
    0.5,
    `rgba(${(100 * f) | 0},${(240 * f) | 0},${(255 * f) | 0},1)`, // LIGHTER cyan
  );
  fgrad.addColorStop(
    1,
    `rgba(${(30 * f) | 0},${(200 * f) | 0},${(255 * f) | 0},1)`, // Still vibrant
  );
  ctx.fillStyle = fgrad;
  ctx.roundRect(bx, by, bw, bh, 8); // Draw with rounded corners
  ctx.fill();

  // Horizontal concrete floor divisions every ~12.5% of height
  // Creates visual separation between office floors
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(${(50 * f) | 0},${(80 * f) | 0},${(150 * f) | 0},0.85)`;
    ctx.fillRect(bx, by + bh * (0.1 + i * 0.125), bw, Math.max(1, bh * 0.02));
  }

  // Window grid: 6 columns × 6 rows of windows
  // Windows show lit/dark panes in a random-looking pattern
  const wCols = 6, // Number of windows across
    wRows = 6; // Number of windows down
  const wGx = bw * 0.045, // Horizontal gap between windows
    wGy = bh * 0.032; // Vertical gap between windows
  const wW = (bw - wGx * (wCols + 1)) / wCols; // Individual window width
  const wH = (bh * 0.74 - wGy * (wRows + 1)) / wRows; // Individual window height
  for (let r = 0; r < wRows; r++)
    for (let c = 0; c < wCols; c++) {
      const wx = bx + wGx + (wW + wGx) * c; // Window x position
      const wy = by + bh * 0.09 + wGy + (wH + wGy) * r; // Window y position
      const lit = (r * 5 + c * 3 + 2) % 7 > 2; // Determine if window is lit
      _archWin(wx, wy, wW, wH, f, lit); // Draw arched window
    }

  // Roof parapet + mechanical penthouse
  ctx.fillStyle = `rgb(${(60 * f) | 0},${(120 * f) | 0},${(200 * f) | 0})`;
  ctx.fillRect(bx, by, bw, bh * 0.08);
  ctx.fillStyle = `rgb(${(80 * f) | 0},${(150 * f) | 0},${(230 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.22, by - bh * 0.12, bw * 0.44, bh * 0.14, 4);
  ctx.fill();
  // Antenna
  ctx.strokeStyle = `rgba(${(200 * f) | 0},${(240 * f) | 0},${(255 * f) | 0},0.95)`;
  ctx.lineWidth = Math.max(1, sw * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx, by - bh * 0.12);
  ctx.lineTo(cx, by - bh * 0.25);
  ctx.stroke();
  ctx.fillStyle = `rgba(255,150,100,${(Math.sin(pulse * 2.8) > 0 ? 0.95 : 0.3) * f})`;
  ctx.beginPath();
  ctx.arc(cx, by - bh * 0.25, Math.max(1.5, sw * 0.04), 0, Math.PI * 2);
  ctx.fill();

  // Overhang canopy
  ctx.fillStyle = `rgba(${(50 * f) | 0},${(100 * f) | 0},${(200 * f) | 0},1)`;
  ctx.fillRect(cx - bw * 0.32, by + bh * 0.84, bw * 0.64, bh * 0.055);
  // Double glass doors
  for (let d = -1; d <= 0; d++) {
    ctx.fillStyle = `rgba(${(180 * f) | 0},${(220 * f) | 0},${(255 * f) | 0},0.9)`;
    ctx.roundRect(
      cx + d * bw * 0.115,
      by + bh * 0.875,
      bw * 0.1,
      bh * 0.125,
      3,
    );
    ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${0.25 * f})`;
    ctx.fillRect(cx + d * bw * 0.115, by + bh * 0.875, bw * 0.038, bh * 0.05);
  }
  // Steps
  for (let s = 0; s < 3; s++) {
    ctx.fillStyle = `rgba(${(220 * f) | 0},${(220 * f) | 0},${(240 * f) | 0},${0.65 - s * 0.1})`;
    ctx.fillRect(
      cx - bw * (0.16 + s * 0.045),
      by + bh * (0.895 + s * 0.035),
      bw * (0.32 + s * 0.09),
      bh * 0.022,
    );
  }
  // Side pilasters
  for (let side of [-1, 1]) {
    ctx.fillStyle = `rgba(${(60 * f) | 0},${(120 * f) | 0},${(200 * f) | 0},0.85)`;
    ctx.fillRect(
      bx + (side === -1 ? 0 : bw * 0.9),
      by + bh * 0.08,
      bw * 0.1,
      bh * 0.92,
    );
  }
  // Roof edge with subtle detail
  ctx.fillStyle = `rgba(${(40 * f) | 0},${(80 * f) | 0},${(150 * f) | 0},1)`;
  ctx.fillRect(bx - bw * 0.01, by - bh * 0.02, bw * 1.02, bh * 0.03);
  // Antenna on roof
  ctx.strokeStyle = `rgba(${(220 * f) | 0},${(230 * f) | 0},${(255 * f) | 0},1)`;
  ctx.lineWidth = Math.max(1.5, sw * 0.02);
  ctx.beginPath();
  ctx.moveTo(cx, by - bh * 0.02);
  ctx.lineTo(cx, by - bh * 0.16);
  ctx.stroke();
  // Antenna tip
  ctx.fillStyle = `rgba(255,150,100,${0.95 * f})`;
  ctx.beginPath();
  ctx.arc(cx, by - bh * 0.16, Math.max(2, sw * 0.03), 0, Math.PI * 2);
  ctx.fill();
}

// ── Grocery Store (Building Type 4) ───────────────────────────────────
// Bright lime green store with red fascia, yellow signage, striped awning
// Manic checkpoint building when player passes nearby
function drawGrocery(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return; // Skip if not in front of other objects
  const f = fog; // Apply distance fog (brightness decreases)
  const bw = sw * 2.8, // Building width on screen (WIDER)
    bh = sh * 2.0; // Building height on screen (shorter & wider)
  const bx = cx - bw / 2, // Left edge (centered)
    by = sy - sh * 0.8; // Top edge

  // ─ GLOW EFFECT (Close proximity only) ─────────────────────────────
  // When player is within 20 tiles, draw bright lime green radial glow
  // Creates sense of importance / beacon-like appearance
  if (sd < 20) {
    let ga = (1 - sd / 20) * 0.3 * f; // Glow alpha: stronger when close
    let g2 = ctx.createRadialGradient(
      cx,
      by + bh * 0.5,
      0, // Inner radius (bright center)
      cx,
      by + bh * 0.5,
      bw * 1.2, // Outer radius (fade distance)
    );
    g2.addColorStop(0, `rgba(100,255,150,${ga})`); // Center: BRIGHT lime
    g2.addColorStop(1, "rgba(100,255,150,0)"); // Edge: transparent
    ctx.fillStyle = g2;
    ctx.fillRect(bx - bw, by - bh * 0.3, bw * 3, bh * 1.6); // Large area behind building
  }

  // ─ MAIN FACADE ────────────────────────────────────────────────────
  // Vertical gradient: bright lime top to darker lime bottom
  // Simulates light reflecting off store exterior
  const fgrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(150 * f) | 0},${(255 * f) | 0},${(100 * f) | 0},1)`, // Top: BRIGHT green
  );
  fgrad.addColorStop(
    1,
    `rgba(${(100 * f) | 0},${(255 * f) | 0},${(80 * f) | 0},1)`, // Bottom: vibrant green
  );
  ctx.fillStyle = fgrad;
  ctx.roundRect(bx, by, bw, bh, 6); // Rounded corners for modern look
  ctx.fill();

  // ─ BRICK TEXTURE PATTERN ──────────────────────────────────────────
  // Draw overlaid brick pattern for visual detail
  // Alternating rows offset for realistic masonry appearance
  for (let row = 0; row < 10; row++) {
    const ry = by + bh * 0.22 + row * bh * 0.072;
    const offset = (row % 2) * bw * 0.08; // Every other row shifted
    for (let col = 0; col < 7; col++) {
      const rx = bx + offset + col * bw * 0.145;
      ctx.fillStyle = `rgba(${(200 * f) | 0},${(170 * f) | 0},${(140 * f) | 0},0.25)`;
      ctx.strokeStyle = `rgba(${(180 * f) | 0},${(150 * f) | 0},${(120 * f) | 0},0.35)`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(rx, ry, bw * 0.135, bh * 0.06); // Individual brick outline
    }
  }

  // ─ FASCIA & SIGNAGE ────────────────────────────────────────────────
  // Bold red band across top (corporate branding typical of grocery stores)
  ctx.fillStyle = `rgb(${(255 * f) | 0},${(80 * f) | 0},${(80 * f) | 0})`;
  ctx.fillRect(bx, by, bw, bh * 0.18);
  // BRIGHT yellow band below red (high contrast color combination)
  ctx.fillStyle = `rgb(${(255 * f) | 0},${(255 * f) | 0},${(50 * f) | 0})`;
  ctx.fillRect(bx, by + bh * 0.18, bw, bh * 0.07);
  // White highlight stripe on sign for 3D appearance
  ctx.fillStyle = `rgba(255,255,255,${0.2 * f})`;
  ctx.fillRect(bx, by + bh * 0.19, bw, bh * 0.025);

  // ─ DISPLAY WINDOWS (Storefront) ────────────────────────────────────
  // Large glass display windows showing interior merchandise
  // Typical grocery store layout with 4 wide windows
  const winCount = 4;
  const winW = bw * 0.2, // Individual window width
    winH = bh * 0.3; // Window height
  const winGap = (bw - winCount * winW) / (winCount + 1); // Spacing between windows
  for (let i = 0; i < winCount; i++) {
    const wx = bx + winGap + i * (winW + winGap); // Center windows on facade
    const wy = by + bh * 0.28;
    // Window frame (green to match building)
    ctx.fillStyle = `rgb(${(80 * f) | 0},${(180 * f) | 0},${(100 * f) | 0})`;
    ctx.fillRect(wx - 3, wy - 3, winW + 6, winH + 6);
    // Glass pane with light gradient (warm interior light)
    const wg = ctx.createLinearGradient(wx, wy, wx + winW, wy + winH);
    wg.addColorStop(
      0,
      `rgba(${(200 * f) | 0},${(240 * f) | 0},${(220 * f) | 0},0.95)`, // Top: lighter
    );
    wg.addColorStop(
      1,
      `rgba(${(150 * f) | 0},${(210 * f) | 0},${(190 * f) | 0},0.8)`, // Bottom: darker
    );
    ctx.fillStyle = wg;
    ctx.fillRect(wx, wy, winW, winH);
    // White reflection glint on glass (light source simulation)
    ctx.fillStyle = `rgba(255,255,255,${0.4 * f})`;
    ctx.fillRect(wx + 2, wy + 2, winW * 0.25, winH * 0.4);
    // Horizontal divider bar in center of window
    ctx.fillStyle = `rgb(${(80 * f) | 0},${(180 * f) | 0},${(100 * f) | 0})`;
    ctx.fillRect(wx, wy + winH * 0.5, winW, Math.max(1, winH * 0.04));
  }

  // ─ STRIPED AWNING ─────────────────────────────────────────────────
  // Classic storefront awning with alternating green and white stripes
  // Creates visual interest and authentic grocery store feel
  const awningStripes = 10;
  const stripeW = bw / awningStripes;
  for (let i = 0; i < awningStripes; i++) {
    ctx.fillStyle =
      i % 2
        ? `rgb(${(80 * f) | 0},${(200 * f) | 0},${(100 * f) | 0})` // Vibrant green
        : `rgba(255,255,255,${0.95 * f})`; // White
    ctx.fillRect(bx + i * stripeW, by + bh * 0.61, stripeW, bh * 0.065);
  }
  // Scalloped awning edge (curved bottom) for decorative effect
  for (let i = 0; i < awningStripes; i++) {
    ctx.fillStyle =
      i % 2
        ? `rgb(${(60 * f) | 0},${(160 * f) | 0},${(80 * f) | 0})` // Dark green
        : `rgba(255,255,255,${0.9 * f})`; // Off-white
    ctx.beginPath();
    ctx.arc(
      bx + i * stripeW + stripeW / 2,
      by + bh * 0.675,
      stripeW / 2, // Radius = half stripe width for curves
      0,
      Math.PI, // Half circle
    );
    ctx.fill();
  }

  // ─ AUTOMATIC SLIDING DOORS ────────────────────────────────────────
  // Large dark glass entrance doors (typical modern grocery store)
  ctx.fillStyle = `rgba(${(30 * f) | 0},${(40 * f) | 0},${(40 * f) | 0},0.95)`;
  ctx.fillRect(cx - bw * 0.18, by + bh * 0.72, bw * 0.36, bh * 0.28);
  // Door frame with green border
  ctx.strokeStyle = `rgb(${(80 * f) | 0},${(180 * f) | 0},${(100 * f) | 0})`;
  ctx.lineWidth = Math.max(1.5, sw * 0.04);
  ctx.strokeRect(cx - bw * 0.18, by + bh * 0.72, bw * 0.36, bh * 0.28);
  // Two door panels (side-by-side automatic doors)
  for (let d = -1; d <= 0; d++) {
    ctx.fillStyle = `rgba(${(120 * f) | 0},${(200 * f) | 0},${(170 * f) | 0},0.6)`;
    ctx.fillRect(
      cx + d * bw * 0.17 + bw * 0.01,
      by + bh * 0.73,
      bw * 0.155,
      bh * 0.26,
    );
  }

  // ─ SHOPPING CART EMOJI (Close-up only) ─────────────────────────────
  // Shopping cart icon on fascia when player is near (< 10 tiles away)
  // Only drawn when magnified (sw > 40 pixels on screen)
  if (sd < 10 && sw > 40) {
    ctx.fillStyle = `rgba(255,255,255,${0.95 * f})`;
    ctx.font = `bold ${Math.max(10, sw * 0.2) | 0}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🛒", cx, by + bh * 0.09); // Shopping cart emoji
  }

  // ─ ROOF LINE ───────────────────────────────────────────────────────
  // Metal trim along roof edge (realistic architectural detail)
  ctx.fillStyle = `rgb(${(80 * f) | 0},${(160 * f) | 0},${(100 * f) | 0})`;
  ctx.fillRect(bx - bw * 0.02, by - bh * 0.02, bw * 1.04, bh * 0.04);
  // Roof edge highlight (light reflection simulation)
  ctx.fillStyle = `rgba(${(150 * f) | 0},${(220 * f) | 0},${(160 * f) | 0},0.7)`;
  ctx.fillRect(bx - bw * 0.02, by - bh * 0.02, bw * 1.04, bh * 0.015);
}

// ── Recreation Centre / Park (Building Type 6) ─────────────────────
// Grand magenta classical building - final destination (Point B)
// Features: Columns, arched windows, pediment, classical architecture
function drawPark(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return; // Skip if occluded by closer objects
  const f = fog; // Apply distance-based fog
  const bw = sw * 3.0, // WIDER for grand appearance
    bh = sh * 3.6; // TALLER for majesty
  const bx = cx - bw / 2, // Left edge (centered)
    by = sy - sh * 1.65; // Top edge

  // ─ GLOW EFFECT (Destination beacon) ────────────────────────────────
  // Bright magenta aura when player is near (< 22 tiles away)
  // Signals importance as final destination
  if (sd < 22) {
    let ga = (1 - sd / 22) * 0.4 * f; // Glow alpha based on distance
    let g2 = ctx.createRadialGradient(
      cx,
      by + bh * 0.5,
      0, // Center: bright spot
      cx,
      by + bh * 0.5,
      bw * 1.5, // Large fade radius
    );
    g2.addColorStop(0, `rgba(255,150,255,${ga})`); // Center: BRIGHT magenta
    g2.addColorStop(1, "rgba(255,150,255,0)"); // Edge: transparent
    ctx.fillStyle = g2;
    ctx.fillRect(bx - bw, by - bh * 0.3, bw * 3, bh * 1.6);
  }

  // ─ FOUNDATION / PLINTH ─────────────────────────────────────────────
  // Stone base for classical appearance
  ctx.fillStyle = `rgb(${(255 * f) | 0},${(150 * f) | 0},${(255 * f) | 0})`;
  ctx.fillRect(bx - bw * 0.05, by + bh * 0.92, bw * 1.1, bh * 0.08);

  // ─ MAIN BODY (Gradient facade) ─────────────────────────────────────
  // Vertical gradient: bright magenta top to darker magenta bottom
  // Creates sense of classical stone/marble
  const fgrad = ctx.createLinearGradient(bx, by, bx, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(255 * f) | 0},${(120 * f) | 0},${(255 * f) | 0},1)`, // Top: BRIGHT
  );
  fgrad.addColorStop(
    1,
    `rgba(${(255 * f) | 0},${(100 * f) | 0},${(255 * f) | 0},1)`, // Bottom: vibrant
  );
  ctx.fillStyle = fgrad;
  ctx.roundRect(bx, by, bw, bh * 0.93, 10); // Rounded corners
  ctx.fill();

  // ─ STONE BLOCK LINES ───────────────────────────────────────────────
  // Horizontal lines showing stone coursing (masonry blocks)
  // 8 divisions across the facade for classical proportion
  for (let row = 0; row < 8; row++) {
    const ry = by + bh * 0.15 + row * bh * 0.095;
    ctx.strokeStyle = `rgba(${(200 * f) | 0},${(180 * f) | 0},${(160 * f) | 0},0.45)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, ry);
    ctx.lineTo(bx + bw, ry); // Horizontal line across width
    ctx.stroke();
  }

  // ─ GREEN ROOF & AWNING ─────────────────────────────────────────────
  // Bold green roof band typical of classical buildings
  ctx.fillStyle = `rgb(${(100 * f) | 0},${(220 * f) | 0},${(120 * f) | 0})`;
  ctx.fillRect(bx - bw * 0.03, by, bw * 1.06, bh * 0.13);
  // Scalloped awning valance (decorative curved edge)
  const scW = (bw * 1.06) / 10;
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle =
      i % 2
        ? `rgb(${(80 * f) | 0},${(200 * f) | 0},${(100 * f) | 0})` // Dark green
        : `rgb(${(120 * f) | 0},${(240 * f) | 0},${(140 * f) | 0})`; // Light green
    ctx.beginPath();
    ctx.arc(
      bx - bw * 0.03 + i * scW + scW / 2,
      by + bh * 0.13, // Scallop sits at bottom of awning
      scW / 2, // Radius creates curve
      0,
      Math.PI, // Half circle curves downward
    );
    ctx.fill();
  }

  // ─ CLASSICAL COLUMNS ───────────────────────────────────────────────
  // 5 evenly-spaced columns across facade (classical Greek/Roman style)
  const numCols = 5;
  const colW = Math.max(3, bw * 0.055);
  for (let i = 0; i <= numCols; i++) {
    const cx2 = bx + (bw / numCols) * i;
    // Column shaft with gradient (3D cylindrical effect)
    const cg = ctx.createLinearGradient(
      cx2,
      by + bh * 0.15,
      cx2 + colW,
      by + bh * 0.15,
    );
    cg.addColorStop(
      0,
      `rgba(${(255 * f) | 0},${(245 * f) | 0},${(240 * f) | 0},1)`, // Light side
    );
    cg.addColorStop(
      0.5,
      `rgba(${(255 * f) | 0},${(255 * f) | 0},${(250 * f) | 0},1)`, // Bright center
    );
    cg.addColorStop(
      1,
      `rgba(${(245 * f) | 0},${(230 * f) | 0},${(220 * f) | 0},1)`, // Dark side
    );
    ctx.fillStyle = cg;
    ctx.fillRect(cx2 - colW / 2, by + bh * 0.15, colW, bh * 0.75);
    // Capital (top of column - stone block)
    ctx.fillStyle = `rgb(${(255 * f) | 0},${(250 * f) | 0},${(240 * f) | 0})`;
    ctx.fillRect(cx2 - colW * 0.8, by + bh * 0.15, colW * 1.6, bh * 0.025);
    // Base (bottom of column - stone block)
    ctx.fillRect(cx2 - colW * 0.8, by + bh * 0.88, colW * 1.6, bh * 0.025);
  }

  // ─ ARCHED WINDOWS (Between columns) ────────────────────────────────
  // Classical arched windows with lit/dark panes showing occupancy
  const wRows2 = 3; // 3 rows of windows
  for (let r = 0; r < wRows2; r++) {
    for (let i = 0; i < numCols; i++) {
      const wx = bx + (bw / numCols) * i + bw * 0.04;
      const wy = by + bh * (0.2 + r * 0.22);
      const wW2 = bw / numCols - bw * 0.075;
      const wH2 = bh * 0.14;
      const lit = (r * 3 + i) % 4 > 0; // Pseudo-random lit/dark pattern
      _archWin(wx, wy, wW2, wH2, f, lit); // Draw arched window
    }
  }

  // ─ GRAND ARCHED ENTRANCE ──────────────────────────────────────────
  // Large arched doorway at ground level for main access
  ctx.fillStyle = `rgb(${(40 * f) | 0},${(40 * f) | 0},${(50 * f) | 0})`; // Dark opening
  ctx.beginPath();
  ctx.arc(cx, by + bh * 0.82, bw * 0.14, Math.PI, 0); // Arch (top half of circle)
  ctx.lineTo(cx + bw * 0.14, by + bh * 0.94); // Right side of opening
  ctx.lineTo(cx - bw * 0.14, by + bh * 0.94); // Left side of opening
  ctx.closePath();
  ctx.fill();
  // Arch keystone (center stone block at top of arch)
  ctx.fillStyle = `rgb(${(255 * f) | 0},${(245 * f) | 0},${(235 * f) | 0})`;
  ctx.fillRect(cx - bw * 0.025, by + bh * 0.68, bw * 0.05, bh * 0.04);
  // Double glass doors inside the arch
  ctx.fillStyle = `rgba(${(150 * f) | 0},${(220 * f) | 0},${(255 * f) | 0},0.65)`;
  ctx.roundRect(cx - bw * 0.085, by + bh * 0.82, bw * 0.075, bh * 0.12, 2);
  ctx.fill();
  ctx.roundRect(cx + bw * 0.01, by + bh * 0.82, bw * 0.075, bh * 0.12, 2);
  ctx.fill();

  // ─ ENTRANCE STEPS ──────────────────────────────────────────────────
  // Grand stone steps leading up to entrance (4 steps with fading opacity)
  for (let s = 0; s < 4; s++) {
    ctx.fillStyle = `rgba(${(240 * f) | 0},${(230 * f) | 0},${(220 * f) | 0},${0.8 - s * 0.12})`;
    ctx.fillRect(
      cx - bw * (0.18 + s * 0.05), // Step gets wider going down
      by + bh * (0.9 + s * 0.025), // Step offset vertically
      bw * (0.36 + s * 0.1),
      bh * 0.022,
    );
  }

  // ─ DECORATIVE ROOF FINIALS ─────────────────────────────────────────
  // Ornamental caps on roof corners (classical architectural detail)
  for (let corner of [-1, 1]) {
    ctx.fillStyle = `rgb(${(100 * f) | 0},${(220 * f) | 0},${(130 * f) | 0})`;
    ctx.beginPath();
    ctx.arc(
      bx + (corner === -1 ? bw * 0.05 : bw * 0.95), // Left or right corner
      by - bh * 0.01, // Just above roof line
      Math.max(3, sw * 0.05), // Point size
      0,
      Math.PI * 2,
    );
    ctx.fill();
    // Finial cap (highlight on top of ornament)
    ctx.fillStyle = `rgba(${(150 * f) | 0},${(255 * f) | 0},${(170 * f) | 0},0.95)`;
    ctx.beginPath();
    ctx.arc(
      bx + (corner === -1 ? bw * 0.05 : bw * 0.95),
      by - bh * 0.025,
      Math.max(2, sw * 0.035),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

function drawLibrary(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 2.4, // WIDER
    bh = sh * 2.5; // TALLER
  const bx = cx - bw / 2,
    by = sy - sh * 0.95;

  // Warm orange glow
  if (sd < 16) {
    let ga = (1 - sd / 16) * 0.25 * f;
    let g2 = ctx.createRadialGradient(
      cx,
      by + bh * 0.5,
      0,
      cx,
      by + bh * 0.5,
      bw * 1.1,
    );
    g2.addColorStop(0, `rgba(255,200,100,${ga})`); // BRIGHTER orange
    g2.addColorStop(1, "rgba(255,200,100,0)");
    ctx.fillStyle = g2;
    ctx.fillRect(bx - bw, by - bh * 0.2, bw * 3, bh * 1.4);
  }

  // Stone body — bright orange
  const fgrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(255 * f) | 0},${(180 * f) | 0},${(80 * f) | 0},1)`, // BRIGHTER
  );
  fgrad.addColorStop(
    0.6,
    `rgba(${(255 * f) | 0},${(160 * f) | 0},${(60 * f) | 0},1)`, // VIBRANT
  );
  fgrad.addColorStop(
    1,
    `rgba(${(255 * f) | 0},${(140 * f) | 0},${(40 * f) | 0},1)`, // Still vibrant
  );
  ctx.fillStyle = fgrad;
  ctx.roundRect(bx, by + bh * 0.1, bw, bh * 0.9, 6);
  ctx.fill();

  // Triangular pediment roof
  ctx.fillStyle = `rgb(${(220 * f) | 0},${(180 * f) | 0},${(140 * f) | 0})`;
  ctx.beginPath();
  ctx.moveTo(bx - bw * 0.04, by + bh * 0.12);
  ctx.lineTo(cx, by - bh * 0.04);
  ctx.lineTo(bx + bw * 1.04, by + bh * 0.12);
  ctx.closePath();
  ctx.fill();
  // Pediment outline
  ctx.strokeStyle = `rgba(${(180 * f) | 0},${(140 * f) | 0},${(100 * f) | 0},1)`;
  ctx.lineWidth = Math.max(1, sw * 0.04);
  ctx.stroke();
  // Frieze band
  ctx.fillStyle = `rgb(${(240 * f) | 0},${(200 * f) | 0},${(150 * f) | 0})`;
  ctx.fillRect(bx, by + bh * 0.12, bw, bh * 0.04);

  // Classical columns
  const nCols = 4;
  for (let i = 0; i < nCols; i++) {
    const colX = bx + bw * (0.1 + i * 0.26);
    const cW = Math.max(3, bw * 0.07);
    // Fluted shaft
    const cg = ctx.createLinearGradient(colX, 0, colX + cW, 0);
    cg.addColorStop(
      0,
      `rgba(${(215 * f) | 0},${(195 * f) | 0},${(165 * f) | 0},1)`,
    );
    cg.addColorStop(
      0.5,
      `rgba(${(240 * f) | 0},${(225 * f) | 0},${(200 * f) | 0},1)`,
    );
    cg.addColorStop(
      1,
      `rgba(${(205 * f) | 0},${(185 * f) | 0},${(155 * f) | 0},1)`,
    );
    ctx.fillStyle = cg;
    ctx.fillRect(colX, by + bh * 0.16, cW, bh * 0.72);
    // Capital & base
    ctx.fillStyle = `rgb(${(230 * f) | 0},${(215 * f) | 0},${(190 * f) | 0})`;
    ctx.fillRect(colX - cW * 0.4, by + bh * 0.16, cW * 1.8, bh * 0.025);
    ctx.fillRect(colX - cW * 0.4, by + bh * 0.86, cW * 1.8, bh * 0.025);
  }

  // Arched windows between columns
  for (let i = 0; i < 3; i++) {
    const wx = bx + bw * (0.18 + i * 0.26);
    for (let r = 0; r < 2; r++) {
      const wy = by + bh * (0.22 + r * 0.3);
      const wW2 = bw * 0.14,
        wH2 = bh * 0.18;
      const lit = (i + r * 2) % 3 > 0;
      _archWin(wx, wy, wW2, wH2, f, lit);
    }
  }

  // Entrance door with transom
  ctx.fillStyle = `rgb(${(65 * f) | 0},${(42 * f) | 0},${(25 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.12, by + bh * 0.72, bw * 0.24, bh * 0.28, 3);
  ctx.fill();
  ctx.fillStyle = `rgba(${(180 * f) | 0},${(145 * f) | 0},${(90 * f) | 0},0.7)`;
  ctx.roundRect(cx - bw * 0.115, by + bh * 0.725, bw * 0.1, bh * 0.22, 2);
  ctx.fill();
  ctx.roundRect(cx + bw * 0.015, by + bh * 0.725, bw * 0.1, bh * 0.22, 2);
  ctx.fill();
  // Transom window
  ctx.fillStyle = `rgba(${(230 * f) | 0},${(200 * f) | 0},${(140 * f) | 0},0.75)`;
  ctx.fillRect(cx - bw * 0.115, by + bh * 0.72, bw * 0.23, bh * 0.035);

  // Steps
  for (let s = 0; s < 3; s++) {
    ctx.fillStyle = `rgba(${(210 * f) | 0},${(195 * f) | 0},${(170 * f) | 0},${0.7 - s * 0.1})`;
    ctx.fillRect(
      cx - bw * (0.16 + s * 0.04),
      by + bh * (0.92 + s * 0.03),
      bw * (0.32 + s * 0.08),
      bh * 0.022,
    );
  }
}

function drawCafe(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 1.9,
    bh = sh * 1.8;
  const bx = cx - bw / 2,
    by = sy - sh * 0.5;

  // Main body — bright coral red
  const fgrad = ctx.createLinearGradient(bx, by, bx, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(255 * f) | 0},${(100 * f) | 0},${(100 * f) | 0},1)`,
  );
  fgrad.addColorStop(
    1,
    `rgba(${(255 * f) | 0},${(80 * f) | 0},${(80 * f) | 0},1)`,
  );
  ctx.fillStyle = fgrad;
  ctx.roundRect(bx, by, bw, bh, 8);
  ctx.fill();

  // Horizontal brick lines
  for (let r = 0; r < 8; r++) {
    ctx.fillStyle = `rgba(${(220 * f) | 0},${(60 * f) | 0},${(60 * f) | 0},0.3)`;
    ctx.fillRect(bx, by + bh * (0.22 + r * 0.095), bw, Math.max(1, bh * 0.018));
  }

  // Striped awning — bright yellow & white
  const awS = 9;
  const aW = bw / awS;
  for (let i = 0; i < awS; i++) {
    ctx.fillStyle =
      i % 2
        ? `rgb(${(255 * f) | 0},${(200 * f) | 0},${(0 * f) | 0})`
        : `rgba(255,252,245,${0.92 * f})`;
    ctx.fillRect(bx + i * aW, by, aW, bh * 0.16);
  }
  // Valance
  for (let i = 0; i < awS; i++) {
    ctx.fillStyle =
      i % 2
        ? `rgb(${(255 * f) | 0},${(180 * f) | 0},${(0 * f) | 0})`
        : `rgba(240,238,230,${0.9 * f})`;
    ctx.beginPath();
    ctx.arc(bx + i * aW + aW / 2, by + bh * 0.16, aW / 2, 0, Math.PI);
    ctx.fill();
  }

  // Large window — warm glow from inside
  const wg = ctx.createLinearGradient(cx - bw * 0.32, 0, cx + bw * 0.32, 0);
  wg.addColorStop(
    0,
    `rgba(${(255 * f) | 0},${(230 * f) | 0},${(180 * f) | 0},0.88)`,
  );
  wg.addColorStop(
    0.5,
    `rgba(${(255 * f) | 0},${(240 * f) | 0},${(200 * f) | 0},0.92)`,
  );
  wg.addColorStop(
    1,
    `rgba(${(245 * f) | 0},${(220 * f) | 0},${(170 * f) | 0},0.85)`,
  );
  ctx.fillStyle = wg;
  ctx.roundRect(cx - bw * 0.32, by + bh * 0.2, bw * 0.64, bh * 0.38, 6);
  ctx.fill();
  // Window pane dividers
  ctx.strokeStyle = `rgba(${(155 * f) | 0},${(110 * f) | 0},${(68 * f) | 0},0.7)`;
  ctx.lineWidth = Math.max(1, sw * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx, by + bh * 0.2);
  ctx.lineTo(cx, by + bh * 0.58);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - bw * 0.32, by + bh * 0.39);
  ctx.lineTo(cx + bw * 0.32, by + bh * 0.39);
  ctx.stroke();
  // Glint
  ctx.fillStyle = `rgba(255,255,255,${0.22 * f})`;
  ctx.fillRect(cx - bw * 0.31, by + bh * 0.21, bw * 0.22, bh * 0.07);

  // Door
  ctx.fillStyle = `rgb(${(65 * f) | 0},${(42 * f) | 0},${(25 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.1, by + bh * 0.62, bw * 0.2, bh * 0.38, 4);
  ctx.fill();
  ctx.fillStyle = `rgba(${(200 * f) | 0},${(170 * f) | 0},${(120 * f) | 0},0.6)`;
  ctx.roundRect(cx - bw * 0.09, by + bh * 0.63, bw * 0.085, bh * 0.32, 3);
  ctx.fill();
  ctx.roundRect(cx + bw * 0.005, by + bh * 0.63, bw * 0.085, bh * 0.32, 3);
  ctx.fill();

  // Chalk board sign
  if (sd < 10 && sw > 28) {
    ctx.fillStyle = `rgba(${(35 * f) | 0},${(52 * f) | 0},${(45 * f) | 0},0.88)`;
    ctx.roundRect(cx + bw * 0.34, by + bh * 0.52, bw * 0.22, bh * 0.3, 4);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,255,255,${0.4 * f})`;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(cx + bw * 0.35, by + bh * 0.53, bw * 0.2, bh * 0.28);
  }
}

function drawSchool(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 2.2,
    bh = sh * 2.3;
  const bx = cx - bw / 2,
    by = sy - sh * 0.9;

  // Main body — bright yellow brick
  const fgrad = ctx.createLinearGradient(bx, by, bx, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(255 * f) | 0},${(250 * f) | 0},${(100 * f) | 0},1)`,
  );
  fgrad.addColorStop(
    1,
    `rgba(${(255 * f) | 0},${(240 * f) | 0},${(80 * f) | 0},1)`,
  );
  ctx.fillStyle = fgrad;
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.fill();

  // Brick coursing lines
  for (let r = 0; r < 10; r++) {
    ctx.fillStyle = `rgba(${(220 * f) | 0},${(200 * f) | 0},${(0 * f) | 0},0.22)`;
    ctx.fillRect(bx, by + bh * (0.18 + r * 0.078), bw, Math.max(1, bh * 0.015));
  }

  // Purple accent band at top
  ctx.fillStyle = `rgb(${(200 * f) | 0},${(100 * f) | 0},${(200 * f) | 0})`;
  ctx.fillRect(bx, by, bw, bh * 0.09);

  // Clock tower in centre
  const tW = bw * 0.22,
    tH = bh * 0.35;
  const tx = cx - tW / 2;
  ctx.fillStyle = `rgb(${(240 * f) | 0},${(228 * f) | 0},${(200 * f) | 0})`;
  ctx.roundRect(tx, by - tH * 0.4, tW, tH * 0.4 + bh * 0.09, [6, 6, 0, 0]);
  ctx.fill();
  // Clock face
  ctx.fillStyle = `rgba(255,255,255,${0.9 * f})`;
  const cR = Math.max(4, tW * 0.3);
  ctx.beginPath();
  ctx.arc(cx, by - tH * 0.2, cR, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(${(30 * f) | 0},${(30 * f) | 0},${(60 * f) | 0},0.8)`;
  ctx.lineWidth = Math.max(1, sw * 0.03);
  ctx.beginPath();
  ctx.arc(cx, by - tH * 0.2, cR, 0, Math.PI * 2);
  ctx.stroke();
  // Clock hands
  if (sw > 20) {
    ctx.lineWidth = Math.max(1, sw * 0.025);
    ctx.strokeStyle = `rgba(${(30 * f) | 0},${(30 * f) | 0},${(60 * f) | 0},0.9)`;
    ctx.beginPath();
    ctx.moveTo(cx, by - tH * 0.2);
    ctx.lineTo(
      cx + Math.cos(-Math.PI / 2) * cR * 0.65,
      by - tH * 0.2 + Math.sin(-Math.PI / 2) * cR * 0.65,
    );
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, by - tH * 0.2);
    ctx.lineTo(
      cx + Math.cos(0.8) * cR * 0.5,
      by - tH * 0.2 + Math.sin(0.8) * cR * 0.5,
    );
    ctx.stroke();
  }
  // Bell tower top
  ctx.fillStyle = `rgb(${(55 * f) | 0},${(100 * f) | 0},${(185 * f) | 0})`;
  ctx.beginPath();
  ctx.moveTo(tx, by - tH * 0.4);
  ctx.lineTo(cx, by - tH * 0.7);
  ctx.lineTo(tx + tW, by - tH * 0.4);
  ctx.closePath();
  ctx.fill();
  // Flag pole
  ctx.strokeStyle = `rgba(${(150 * f) | 0},${(160 * f) | 0},${(180 * f) | 0},0.85)`;
  ctx.lineWidth = Math.max(1, sw * 0.025);
  ctx.beginPath();
  ctx.moveTo(cx + bw * 0.32, by + bh * 0.1);
  ctx.lineTo(cx + bw * 0.32, by - bh * 0.05);
  ctx.stroke();
  ctx.fillStyle = `rgba(255,80,80,${0.9 * f})`;
  ctx.beginPath();
  ctx.moveTo(cx + bw * 0.32, by - bh * 0.05);
  ctx.lineTo(cx + bw * 0.48, by - bh * 0.01);
  ctx.lineTo(cx + bw * 0.32, by + bh * 0.03);
  ctx.closePath();
  ctx.fill();

  // Window rows
  const wCols2 = 5,
    wRows2 = 3;
  const wGx2 = bw * 0.055,
    wGy2 = bh * 0.05;
  const wW2 = (bw - wGx2 * (wCols2 + 1)) / wCols2;
  const wH2 = (bh * 0.52 - wGy2 * (wRows2 + 1)) / wRows2;
  for (let r = 0; r < wRows2; r++)
    for (let c = 0; c < wCols2; c++) {
      const wx = bx + wGx2 + (wW2 + wGx2) * c;
      const wy = by + bh * 0.16 + wGy2 + (wH2 + wGy2) * r;
      const lit = (r * 4 + c * 2) % 5 > 1;
      ctx.fillStyle = lit
        ? `rgba(${(200 * f) | 0},${(230 * f) | 0},${(255 * f) | 0},0.88)`
        : `rgba(${(50 * f) | 0},${(75 * f) | 0},${(120 * f) | 0},0.7)`;
      ctx.fillRect(wx, wy, wW2, wH2);
      if (lit) {
        ctx.fillStyle = `rgba(255,255,255,${0.2 * f})`;
        ctx.fillRect(wx, wy, wW2 * 0.35, wH2 * 0.3);
      }
      // Window cross divider
      ctx.strokeStyle = `rgba(${(200 * f) | 0},${(180 * f) | 0},${(140 * f) | 0},0.5)`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(wx + wW2 / 2, wy);
      ctx.lineTo(wx + wW2 / 2, wy + wH2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wx, wy + wH2 / 2);
      ctx.lineTo(wx + wW2, wy + wH2 / 2);
      ctx.stroke();
    }

  // Main entrance — double doors under arch
  ctx.fillStyle = `rgb(${(60 * f) | 0},${(110 * f) | 0},${(200 * f) | 0})`;
  ctx.fillRect(cx - bw * 0.2, by + bh * 0.74, bw * 0.4, bh * 0.055);
  ctx.fillStyle = `rgb(${(45 * f) | 0},${(32 * f) | 0},${(22 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.15, by + bh * 0.78, bw * 0.3, bh * 0.22, 3);
  ctx.fill();
  for (let d = -1; d <= 0; d++) {
    ctx.fillStyle = `rgba(${(170 * f) | 0},${(220 * f) | 0},${(255 * f) | 0},0.55)`;
    ctx.roundRect(
      cx + d * bw * 0.14,
      by + bh * 0.785,
      bw * 0.125,
      bh * 0.205,
      2,
    );
    ctx.fill();
  }
}

// ── Skyscraper (t: 13) ─ Tall modern building with reflective glass ──
function drawSkyscraper(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 2.0,
    bh = sh * 3.5; // Much taller!
  const bx = cx - bw / 2,
    by = sy - sh * 1.4;

  // Main facade — bright purple glass
  const fgrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(200 * f) | 0},${(100 * f) | 0},${(255 * f) | 0},1)`,
  );
  fgrad.addColorStop(
    0.5,
    `rgba(${(220 * f) | 0},${(130 * f) | 0},${(255 * f) | 0},1)`,
  );
  fgrad.addColorStop(
    1,
    `rgba(${(180 * f) | 0},${(80 * f) | 0},${(220 * f) | 0},1)`,
  );
  ctx.fillStyle = fgrad;
  ctx.roundRect(bx, by, bw, bh, 2);
  ctx.fill();

  // Tall window grid (many rows of windows)
  const wCols = 3,
    wRows = 12; // Very tall!
  const wGx = bw * 0.08,
    wGy = bh * 0.02;
  const wW = (bw - wGx * (wCols + 1)) / wCols;
  const wH = (bh * 0.95 - wGy * (wRows + 1)) / wRows;

  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const wx = bx + wGx + (wW + wGx) * c;
      const wy = by + bh * 0.02 + wGy + (wH + wGy) * r;

      // 60% of windows are lit, 40% dark
      const isLit = Math.random() > 0.4;
      if (isLit) {
        ctx.fillStyle = `rgba(${(255 * f) | 0},${(240 * f) | 0},${(150 * f) | 0},0.80)`;
      } else {
        ctx.fillStyle = `rgba(${(30 * f) | 0},${(45 * f) | 0},${(70 * f) | 0},0.95)`;
      }
      ctx.fillRect(wx, wy, wW - 2, wH - 1);

      // Window frame
      ctx.strokeStyle = `rgba(${(20 * f) | 0},${(35 * f) | 0},${(60 * f) | 0},0.6)`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(wx, wy, wW - 2, wH - 1);
    }
  }

  // Spire/antenna on top
  const spireW = bw * 0.15;
  ctx.fillStyle = `rgba(${(150 * f) | 0},${(160 * f) | 0},${(180 * f) | 0},0.9)`;
  ctx.fillRect(cx - spireW / 2, by - sh * 0.3, spireW, sh * 0.3);

  // Antenna bulb
  ctx.fillStyle = `rgba(255,100,100,${0.85 * f})`;
  ctx.beginPath();
  ctx.arc(cx, by - sh * 0.35, Math.max(3, sw * 0.04), 0, Math.PI * 2);
  ctx.fill();

  // Glass reflection highlights
  ctx.fillStyle = `rgba(255,255,255,${0.06 * f})`;
  ctx.fillRect(bx + bw * 0.02, by, bw * 0.08, bh);
}

// ── Townhouse (t: 14) ─ Narrow multi-story residential building ──
function drawTownhouse(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 1.4,
    bh = sh * 2.8; // Tall but narrow
  const bx = cx - bw / 2,
    by = sy - sh * 1.1;

  // Brick facade — bright coral
  const fgrad = ctx.createLinearGradient(bx, by, bx, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(255 * f) | 0},${(120 * f) | 0},${(120 * f) | 0},1)`,
  );
  fgrad.addColorStop(
    1,
    `rgba(${(255 * f) | 0},${(100 * f) | 0},${(100 * f) | 0},1)`,
  );
  ctx.fillStyle = fgrad;
  ctx.fillRect(bx, by, bw, bh);

  // Brick pattern
  for (let row = 0; row < 14; row++) {
    const ry = by + (row * bh) / 14;
    const offset = (row % 2) * bw * 0.08;
    for (let col = 0; col < 3; col++) {
      const rx = bx + offset + (col * bw) / 3;
      ctx.fillStyle = `rgba(${(220 * f) | 0},${(80 * f) | 0},${(80 * f) | 0},0.2)`;
      ctx.strokeStyle = `rgba(${(200 * f) | 0},${(60 * f) | 0},${(60 * f) | 0},0.3)`;
      ctx.lineWidth = 0.5;
      ctx.strokeRect(rx, ry, bw / 3 - 1, bh / 14);
    }
  }

  // Bright teal door
  const doorW = bw * 0.4,
    doorH = bh * 0.35;
  ctx.fillStyle = `rgb(${(0 * f) | 0},${(200 * f) | 0},${(200 * f) | 0})`;
  ctx.fillRect(cx - doorW / 2, by + bh - doorH, doorW, doorH);

  // Door handle
  ctx.fillStyle = `rgb(${(200 * f) | 0},${(180 * f) | 0},${(140 * f) | 0})`;
  ctx.beginPath();
  ctx.arc(
    cx + doorW * 0.25,
    by + bh - doorH / 2,
    Math.max(2, sw * 0.02),
    0,
    Math.PI * 2,
  );
  ctx.fill();

  // Windows in 2 columns, 4 rows
  const wCols = 2,
    wRows = 4;
  const wW = bw * 0.25,
    wH = bh * 0.12;
  const hGap = (bw - wW * wCols) / 3;
  const vGap = (bh * 0.6 - wH * wRows) / (wRows + 1);

  for (let r = 0; r < wRows; r++) {
    for (let c = 0; c < wCols; c++) {
      const wx = bx + hGap + c * (wW + hGap);
      const wy = by + bh * 0.1 + vGap * (r + 1) + r * wH;

      // Lit windows with bright yellow light
      ctx.fillStyle = `rgba(${(255 * f) | 0},${(255 * f) | 0},${(150 * f) | 0},0.85)`;
      ctx.fillRect(wx, wy, wW, wH);

      // Window frame
      ctx.strokeStyle = `rgba(${(100 * f) | 0},${(50 * f) | 0},${(50 * f) | 0},0.9)`;
      ctx.lineWidth = 1;
      ctx.strokeRect(wx, wy, wW, wH);

      // Window panes
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(wx + wW / 2, wy);
      ctx.lineTo(wx + wW / 2, wy + wH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(wx, wy + wH / 2);
      ctx.lineTo(wx + wW, wy + wH / 2);
      ctx.stroke();
    }
  }

  // Pitched roof — dark brown
  ctx.fillStyle = `rgb(${(80 * f) | 0},${(40 * f) | 0},${(20 * f) | 0})`;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(cx, by - bh * 0.18);
  ctx.lineTo(bx + bw, by);
  ctx.closePath();
  ctx.fill();

  // Roof ridge
  ctx.strokeStyle = `rgba(${(60 * f) | 0},${(30 * f) | 0},${(10 * f) | 0},0.7)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, by - bh * 0.18);
  ctx.lineTo(bx + bw / 2, by - bh * 0.2);
  ctx.stroke();
}

// ── Small Shop (t: 15) ─ Ground floor commercial with large windows ──
function drawSmallShop(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 2.0,
    bh = sh * 1.6; // Short & wide
  const bx = cx - bw / 2,
    by = sy - sh * 0.7;

  // Storefront facade — bright teal
  const fgrad = ctx.createLinearGradient(bx, by, bx, by + bh);
  fgrad.addColorStop(
    0,
    `rgba(${(0 * f) | 0},${(220 * f) | 0},${(200 * f) | 0},1)`,
  );
  fgrad.addColorStop(
    1,
    `rgba(${(20 * f) | 0},${(200 * f) | 0},${(220 * f) | 0},1)`,
  );
  ctx.fillStyle = fgrad;
  ctx.fillRect(bx, by, bw, bh);

  // Dark metal/wood frame top
  ctx.fillStyle = `rgb(${(20 * f) | 0},${(100 * f) | 0},${(100 * f) | 0})`;
  ctx.fillRect(bx, by, bw, bh * 0.12);

  // Large display windows filling most of storefront
  const winY = by + bh * 0.15;
  const winH = bh * 0.65;
  const numWindows = 3;
  const winW = (bw * 0.85) / numWindows;
  const winStartX = bx + (bw - winW * numWindows) / 2;

  for (let i = 0; i < numWindows; i++) {
    const wx = winStartX + i * (winW + 3);

    // Glass with slight tint
    ctx.fillStyle = `rgba(${(180 * f) | 0},${(220 * f) | 0},${(240 * f) | 0},0.70)`;
    ctx.fillRect(wx, winY, winW, winH);

    // Reflections in glass
    ctx.fillStyle = `rgba(255,255,255,${0.15 * f})`;
    ctx.fillRect(wx, winY, winW * 0.3, winH * 0.4);

    // Window frame
    ctx.strokeStyle = `rgba(${(50 * f) | 0},${(50 * f) | 0},${(50 * f) | 0},0.9)`;
    ctx.lineWidth = 2;
    ctx.strokeRect(wx, winY, winW, winH);

    // Horizontal divider
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(wx, winY + winH * 0.5);
    ctx.lineTo(wx + winW, winY + winH * 0.5);
    ctx.stroke();
  }

  // Colored shop sign band — vibrant colors
  const signColor = [
    "rgb(255,100,100)",
    "rgb(100,200,255)",
    "rgb(100,255,150)",
  ][Math.floor(Math.random() * 3)];
  ctx.fillStyle = signColor;
  ctx.fillRect(bx, by + bh * 0.82, bw, bh * 0.18);

  // White text placeholder (sign)
  ctx.fillStyle = `rgba(255,255,255,${0.9 * f})`;
  const fontSize = Math.max(8, sw * 0.08) | 0;
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = "center";
  ctx.fillText("SHOP", cx, by + bh * 0.88 + fontSize / 3);

  // Door on side — bright lime green
  const doorW = bw * 0.12,
    doorH = bh * 0.5;
  ctx.fillStyle = `rgb(${(100 * f) | 0},${(255 * f) | 0},${(100 * f) | 0})`;
  ctx.fillRect(bx + bw * 0.08, by + bh - doorH, doorW, doorH);

  // Door handle
  ctx.fillStyle = `rgb(${(200 * f) | 0},${(180 * f) | 0},${(140 * f) | 0})`;
  ctx.beginPath();
  ctx.arc(
    bx + bw * 0.16,
    by + bh - doorH * 0.4,
    Math.max(2, sw * 0.02),
    0,
    Math.PI * 2,
  );
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
  if (depressionState.depressionMode) {
    hudTag.textContent = "🌙 DEPRESSION STATE";
    hudTag.style.color = "#9eb1ff";
  } else if (manicState.manicMode && !skipManicEpisode) {
    hudTag.textContent = "⚡ MANIC STATE";
    hudTag.style.color = "#f5b347";
  } else {
    hudTag.textContent = "🌿 EUTHYMIA · BASE LEVEL";
    hudTag.style.color = "#c084fc";
  }
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
const MM_S = 4;
let mmCanvas = document.getElementById("minimap");
mmCanvas.width = COLS * MM_S;
mmCanvas.height = ROWS * MM_S;
let mmCtx = mmCanvas.getContext("2d");
let mmBase = null;

// ── Fog of war ───────────────────────────────────────────────
// fogCanvas is drawn ON TOP of the minimap; explored pixels are cleared to transparent
let fogCanvas = document.createElement("canvas");
fogCanvas.width = COLS * MM_S;
fogCanvas.height = ROWS * MM_S;
let fogCtx = fogCanvas.getContext("2d");
// Start fully black
fogCtx.fillStyle = "#000";
fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);

function revealFogAt(wx, wy) {
  // Clear a circular area on the fog canvas at world position (wx, wy)
  const radius = 5 * MM_S; // reveal radius in minimap pixels
  const cx = wx * MM_S;
  const cy = wy * MM_S;
  fogCtx.save();
  fogCtx.globalCompositeOperation = "destination-out";
  fogCtx.beginPath();
  fogCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  fogCtx.fill();
  fogCtx.restore();
}

function resetFog() {
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  fogCtx.fillStyle = "#000";
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
}

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
              ? "#6aaddd" // community centre — blue
              : t === 4
                ? "#5dbb6a" // grocery — green
                : t === 5
                  ? "#b08850" // library — warm brown
                  : t === 6
                    ? "#3ecf6e" // park — vivid green
                    : "#4a7c59";
      oc.fillRect(c * MM_S, r * MM_S, MM_S, MM_S);
    }
  // Start (Community Centre) — red marker with white A
  oc.fillStyle = "#ef4444"; // red
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
  oc.fillText("A", GA.x * MM_S, GA.y * MM_S);
  // Recreation Centre (goal B) — green marker with white B
  oc.fillStyle = "#22c55e"; // green
  oc.beginPath();
  oc.arc(GB.x * MM_S, GB.y * MM_S, 7, 0, Math.PI * 2);
  oc.fill();
  oc.fillStyle = "#ffffff";
  oc.font = "bold 7px sans-serif";
  oc.textAlign = "center";
  oc.textBaseline = "middle";
  oc.fillText("B", GB.x * MM_S, GB.y * MM_S);
  // Only show points A and B on minimap — intermediate checkpoints hidden
  mmBase = offscreen;
}

function updateMinimap() {
  if (!mmBase) buildMinimapBase();
  const mw = mmCanvas.width,
    mh = mmCanvas.height;
  mmCtx.clearRect(0, 0, mw, mh);

  // Reveal fog around current player position every frame
  revealFogAt(P.x, P.y);

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
    mmCtx.drawImage(fogCanvas, -cx, -cy);
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

    // Removed yellow direction line for cleaner manic minimap
    mmCtx.fillStyle = "#fff";
    mmCtx.beginPath();
    mmCtx.arc(fakePx, fakePy, 3.5, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.fillStyle = "#e879f9";
    mmCtx.beginPath();
    mmCtx.arc(fakePx, fakePy, 2, 0, Math.PI * 2);
    mmCtx.fill();

    // Real goal marker drifts slightly
    let goalDrift = mi * 8;
    let fakeGx = GB.x * MM_S + Math.cos(pulse * 0.7 + 1.2) * goalDrift;
    let fakeGy = GB.y * MM_S + Math.sin(pulse * 0.5 + 0.8) * goalDrift;
    mmCtx.fillStyle = "#22c55e"; // green for goal B
    mmCtx.beginPath();
    mmCtx.arc(fakeGx, fakeGy, 7, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.fillStyle = "#ffffff";
    mmCtx.font = "bold 7px sans-serif";
    mmCtx.textAlign = "center";
    mmCtx.textBaseline = "middle";
    mmCtx.fillText("G", fakeGx, fakeGy);
  } else {
    // Normal minimap
    mmCtx.drawImage(mmBase, 0, 0);
    // Draw fog on top — black everywhere except explored areas
    mmCtx.drawImage(fogCanvas, 0, 0);

    // Manic checkpoint marker removed — only show points A and B on minimap

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
    // Player position indicator on minimap (removed yellow direction line for cleaner look)
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

// Landing page → Warning or Settings
document.getElementById("btn-start-driving").onclick = () => {
  document.getElementById("screen-landing").style.display = "none";
  document.getElementById("screen-warning").style.display = "flex";
  gameState = "warning";
};

document.getElementById("btn-landing-settings").onclick = () => {
  document.getElementById("screen-landing").style.display = "none";
  document.getElementById("screen-settings").style.display = "flex";
};

// Warning page → Game or Settings
document.getElementById("btn-acknowledge").onclick = () => {
  document.getElementById("screen-warning").style.display = "none";
  document.getElementById("screen-intro").style.display = "flex";
  gameState = "intro";
};

document.getElementById("btn-warning-settings").onclick = () => {
  document.getElementById("screen-warning").style.display = "none";
  document.getElementById("screen-settings").style.display = "flex";
};

// Settings → back to landing or warning
document.getElementById("btn-back-from-settings").onclick = () => {
  reducedEffectsMode = document.getElementById(
    "setting-reduced-effects",
  ).checked;
  skipManicEpisode = document.getElementById("setting-skip-manic").checked;
  document.getElementById("screen-settings").style.display = "none";

  // Determine if we came from landing or warning
  if (gameState === "warning") {
    document.getElementById("screen-warning").style.display = "flex";
  } else {
    document.getElementById("screen-landing").style.display = "flex";
  }
};

document.getElementById("btn-start").onclick = () => {
  resetGame();
  showGame();
};

document.getElementById("btn-again").onclick = () => {
  document.getElementById("screen-win").style.display = "none";
  document.getElementById("screen-landing").style.display = "flex";
  winAudio.pause();
  winAudio.currentTime = 0;
  gameState = "landing";
};

// Pause button handlers
document.getElementById("btn-pause").onclick = () => {
  togglePause();
};

document.getElementById("btn-pause-resume").onclick = () => {
  resumeGame();
};

document.getElementById("btn-pause-restart").onclick = () => {
  isPaused = false;
  document.getElementById("screen-pause").style.display = "none";
  resetGame();
  showGame();
};

document.getElementById("btn-pause-menu").onclick = () => {
  isPaused = false;
  document.getElementById("screen-pause").style.display = "none";
  document.getElementById("btn-pause").style.display = "none";
  document.getElementById("hud").style.display = "none";
  document.getElementById("compass").style.display = "none";
  document.getElementById("minimap-wrap").style.display = "none";
  document.getElementById("screen-landing").style.display = "flex";
  backgroundAudio.pause();
  backgroundAudio.currentTime = 0;
  gameState = "landing";
};
