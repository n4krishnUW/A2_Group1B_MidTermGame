// ============================================================
//  CROSSY MIND — Base Level (Euthymia)
//  p5.js sketch
// ============================================================

// ── Constants ───────────────────────────────────────────────
const ROWS = 40;
const COLS = 40;
const TILE = 48; // px per tile in world space
const MAX_SPEED = 5.5; // tiles per second
const ACCEL = 30;
const FRICTION = 0.9;
const GOAL_RADIUS = 1.5; // tiles

// ── Map tile values ──────────────────────────────────────────
// 0 = grass   1 = road   2 = sidewalk   3 = crosswalk
let MAP = [];

// ── Goals ───────────────────────────────────────────────────
const GOAL_A = { x: 4.5, y: 4.5, label: "Community Centre", emoji: "🏫" };
const GOAL_B = { x: 35.5, y: 35.5, label: "Hospital", emoji: "🏥" };

// ── Palette ─────────────────────────────────────────────────
const PAL = {
  grassA: "#7ec8a0",
  grassB: "#6db88e",
  road: "#8b8b9e",
  roadLine: "#fff176",
  sidewalk: "#f0d9b5",
  crosswalk: "#7a7a8e",
  wheel: "#333333",
};

// ── NPC cars (vx/vy in tiles/sec) ───────────────────────────
let npcs = [];
const NPC_TEMPLATE = [
  { x: 6, y: 3.5, vx: 2.2, vy: 0, col: "#ffb3ba" },
  { x: 30, y: 10.5, vx: -1.9, vy: 0, col: "#b5ead7" },
  { x: 18.5, y: 7, vx: 0, vy: 1.6, col: "#ffdac1" },
  { x: 26.5, y: 22, vx: 0, vy: -2.0, col: "#c7ceea" },
  { x: 9, y: 26.5, vx: 2.5, vy: 0, col: "#fffacd" },
  { x: 34.5, y: 31, vx: 0, vy: 1.4, col: "#b5d5ff" },
];

// ── Road signs ───────────────────────────────────────────────
const SIGNS = [
  { x: 2.3, y: 2.3, text: "STOP", shape: "oct", bg: "#ff6b6b" },
  { x: 9.3, y: 2.3, text: "YIELD", shape: "tri", bg: "#ffa94d" },
  { x: 17.3, y: 9.3, text: "STOP", shape: "oct", bg: "#ff6b6b" },
  { x: 25.3, y: 17.3, text: "->", shape: "rect", bg: "#69db7c" },
  { x: 33.3, y: 25.3, text: "STOP", shape: "oct", bg: "#ff6b6b" },
  { x: 2.3, y: 33.3, text: "YIELD", shape: "tri", bg: "#ffa94d" },
  { x: 9.3, y: 33.3, text: "^", shape: "rect", bg: "#69db7c" },
];

// ── Decorative flowers (pre-generated, fixed positions) ──────
let flowers = [];

// ── Player state ─────────────────────────────────────────────
let player = {};

// ── Game state ───────────────────────────────────────────────
// "intro" | "playing" | "win"
let screen = "intro";
let phase = "toB"; // "toB" or "toA"
let pulse = 0; // time accumulator for animations

// ── Mini-map graphics buffer ─────────────────────────────────
let mmGfx;
const MM_SCALE = 3; // px per tile in mini-map

// ── Button bounds (for click detection) ──────────────────────
let startBtn = {};
let playAgainBtn = {};

// ── CAMERA (NEW: global + smooth follow + clamp) ─────────────
let camX = 0;
let camY = 0;
const CAM_SMOOTH = 0.12; // set to 1 for instant snap, or 0.08 for softer

// ============================================================
//  p5 SETUP
// ============================================================
function setup() {
  createCanvas(windowWidth, windowHeight);
  textFont("sans-serif");
  buildMap();
  buildFlowers();
  resetGame();
  buildMinimap();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ============================================================
//  MAP BUILDER
// ============================================================
function buildMap() {
  MAP = [];
  for (let r = 0; r < ROWS; r++) MAP.push(new Array(COLS).fill(0));

  // Lay horizontal 2-lane roads
  [3, 10, 18, 26, 34].forEach((r) => {
    for (let c = 0; c < COLS; c++) {
      MAP[r][c] = 1;
      MAP[r + 1][c] = 1;
    }
  });
  // Lay vertical 2-lane roads
  [3, 10, 18, 26, 34].forEach((c) => {
    for (let r = 0; r < ROWS; r++) {
      MAP[r][c] = 1;
      MAP[r][c + 1] = 1;
    }
  });

  // Sidewalks: grass tiles adjacent to road
  let sw = new Set();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === 1) {
        [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ].forEach(([dr, dc]) => {
          let nr = r + dr,
            nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && MAP[nr][nc] === 0)
            sw.add(`${nr},${nc}`);
        });
      }
    }
  }
  sw.forEach((k) => {
    let [r, c] = k.split(",").map(Number);
    MAP[r][c] = 2;
  });

  // Crosswalks at intersections
  let inter = [3, 4, 10, 11, 18, 19, 26, 27, 34, 35];
  inter.forEach((r) =>
    inter.forEach((c) => {
      if (MAP[r][c] === 1) MAP[r][c] = 3;
    }),
  );
}

function buildFlowers() {
  flowers = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === 0) {
        let h = r * 7 + c * 13;
        if (h % 17 === 0) flowers.push({ r, c, ox: 4, oy: 14, e: "🌸" });
        else if (h % 19 === 0) flowers.push({ r, c, ox: 26, oy: 36, e: "🌼" });
        else if ((r * 3 + c * 17) % 23 === 0)
          flowers.push({ r, c, ox: 14, oy: 26, e: "🌿" });
      }
    }
  }
}

function buildMinimap() {
  mmGfx = createGraphics(COLS * MM_SCALE, ROWS * MM_SCALE);
  mmGfx.noStroke();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let t = MAP[r][c];
      mmGfx.fill(
        t === 1
          ? "#b0b0c0"
          : t === 2
            ? "#e8d5b0"
            : t === 3
              ? "#9090a0"
              : "#7ec8a0",
      );
      mmGfx.rect(c * MM_SCALE, r * MM_SCALE, MM_SCALE, MM_SCALE);
    }
  }
  // Goal A
  mmGfx.fill("#69db7c");
  mmGfx.circle(GOAL_A.x * MM_SCALE, GOAL_A.y * MM_SCALE, 10);
  // Goal B
  mmGfx.fill("#ff8fab");
  mmGfx.circle(GOAL_B.x * MM_SCALE, GOAL_B.y * MM_SCALE, 10);
}

function resetGame() {
  player = { x: GOAL_A.x, y: GOAL_A.y, vx: 0, vy: 0, angle: 0 };
  npcs = NPC_TEMPLATE.map((n) => ({ ...n }));
  phase = "toB";
  pulse = 0;

  // reset camera too (so it starts clean)
  camX = 0;
  camY = 0;
}

function isDriveable(tx, ty) {
  let r = floor(ty),
    c = floor(tx);
  if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return false;
  return MAP[r][c] === 1 || MAP[r][c] === 3;
}

// ============================================================
//  p5 DRAW  (main loop)
// ============================================================
function draw() {
  if (screen === "intro") {
    drawIntro();
    return;
  }
  if (screen === "win") {
    drawWin();
    return;
  }

  let dt = min(deltaTime / 1000, 0.05);
  pulse += dt;

  updatePlayer(dt);
  updateNPCs(dt);
  checkGoal();

  // ==========================================================
  // CAMERA FOLLOW (NEW)
  // - targets player center
  // - clamps to map edges (no empty space)
  // - smooth follow via lerp
  // ==========================================================
  const worldW = COLS * TILE;
  const worldH = ROWS * TILE;

  let targetCamX = player.x * TILE - width / 2;
  let targetCamY = player.y * TILE - height / 2;

  targetCamX = constrain(targetCamX, 0, max(0, worldW - width));
  targetCamY = constrain(targetCamY, 0, max(0, worldH - height));

  camX = lerp(camX, targetCamX, CAM_SMOOTH);
  camY = lerp(camY, targetCamY, CAM_SMOOTH);

  drawWorld(camX, camY);
  drawHUD();
  drawMinimap();
}

// ============================================================
//  UPDATE
// ============================================================
function updatePlayer(dt) {
  let ax = 0,
    ay = 0;
  if (keyIsDown(UP_ARROW)) ay = -ACCEL;
  if (keyIsDown(DOWN_ARROW)) ay = ACCEL;
  if (keyIsDown(LEFT_ARROW)) ax = -ACCEL;
  if (keyIsDown(RIGHT_ARROW)) ax = ACCEL;

  let fric = pow(FRICTION, dt * 60);
  player.vx = (player.vx + ax * dt) * fric;
  player.vy = (player.vy + ay * dt) * fric;

  // Clamp to max speed
  let spd = sqrt(player.vx * player.vx + player.vy * player.vy);
  if (spd > MAX_SPEED) {
    player.vx = (player.vx / spd) * MAX_SPEED;
    player.vy = (player.vy / spd) * MAX_SPEED;
  }
  if (abs(player.vx) < 0.02) player.vx = 0;
  if (abs(player.vy) < 0.02) player.vy = 0;

  // Visual angle follows velocity
  if (spd > 0.15) player.angle = atan2(player.vx, -player.vy);

  // Move with road collision
  let nx = player.x + player.vx * dt;
  let ny = player.y + player.vy * dt;
  if (isDriveable(nx, player.y)) player.x = nx;
  else player.vx *= -0.2;
  if (isDriveable(player.x, ny)) player.y = ny;
  else player.vy *= -0.2;
  player.x = constrain(player.x, 0.5, COLS - 1.5);
  player.y = constrain(player.y, 0.5, ROWS - 1.5);
}

function updateNPCs(dt) {
  npcs.forEach((n) => {
    let nx = n.x + n.vx * dt;
    let ny = n.y + n.vy * dt;
    if (isDriveable(nx, n.y)) n.x = nx;
    else n.vx *= -1;
    if (isDriveable(n.x, ny)) n.y = ny;
    else n.vy *= -1;
    n.x = constrain(n.x, 0.5, COLS - 1.5);
    n.y = constrain(n.y, 0.5, ROWS - 1.5);
  });
}

function checkGoal() {
  let target = phase === "toB" ? GOAL_B : GOAL_A;
  let d = dist(player.x, player.y, target.x, target.y);
  if (d < GOAL_RADIUS) {
    if (phase === "toB") phase = "toA";
    else screen = "win";
  }
}

// ============================================================
//  DRAW WORLD
// ============================================================
function drawWorld(camX, camY) {
  // IMPORTANT: grass background instead of mint so edges never look "empty"
  background(PAL.grassA);

  // robust viewport bounds (draw enough tiles to cover screen)
  let c0 = floor(camX / TILE) - 2;
  let c1 = floor((camX + width) / TILE) + 2;
  let r0 = floor(camY / TILE) - 2;
  let r1 = floor((camY + height) / TILE) + 2;

  c0 = constrain(c0, 0, COLS - 1);
  c1 = constrain(c1, 0, COLS - 1);
  r0 = constrain(r0, 0, ROWS - 1);
  r1 = constrain(r1, 0, ROWS - 1);

  noStroke();

  // ── Tiles ──
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      let wx = c * TILE - camX;
      let wy = r * TILE - camY;
      let t = MAP[r][c];

      if (t === 0) {
        fill((r + c) % 2 === 0 ? PAL.grassA : PAL.grassB);
        rect(wx, wy, TILE, TILE);
      } else if (t === 1) {
        fill(PAL.road);
        rect(wx, wy, TILE, TILE);

        let inter = [3, 4, 10, 11, 18, 19, 26, 27, 34, 35];
        let hr = inter.includes(r),
          vr = inter.includes(c);

        fill(PAL.roadLine);
        if (hr && !vr) rect(wx + 4, wy + TILE / 2 - 2, TILE - 8, 4);
        else if (vr && !hr) rect(wx + TILE / 2 - 2, wy + 4, 4, TILE - 8);
      } else if (t === 2) {
        fill(PAL.sidewalk);
        rect(wx, wy, TILE, TILE);
        fill(0, 0, 0, 13);
        for (let b = 0; b < 3; b++) {
          let oo = b % 2 === 0 ? 0 : TILE / 4;
          rect(wx + oo, wy + b * (TILE / 3), TILE / 2 - 1, TILE / 3 - 1);
          rect(
            wx + oo + TILE / 2,
            wy + b * (TILE / 3),
            TILE / 2 - 1,
            TILE / 3 - 1,
          );
        }
      } else if (t === 3) {
        fill(PAL.crosswalk);
        rect(wx, wy, TILE, TILE);
        fill(255, 255, 255, 110);
        for (let s = 0; s < 4; s++)
          rect(wx + s * (TILE / 4) + 2, wy, (TILE / 4) * 0.6, TILE);
      }
    }
  }

  // ── Flowers ──
  textSize(11);
  textAlign(LEFT, TOP);
  flowers.forEach((f) => {
    let wx = f.c * TILE - camX + f.ox;
    let wy = f.r * TILE - camY + f.oy;
    if (wx > -20 && wx < width + 20 && wy > -20 && wy < height + 20)
      text(f.e, wx, wy);
  });

  // ── Goal markers ──
  drawGoalMarker(
    GOAL_A.x,
    GOAL_A.y,
    GOAL_A.emoji,
    GOAL_A.label,
    color("#69db7c"),
    camX,
    camY,
    phase !== "toB",
  );
  drawGoalMarker(
    GOAL_B.x,
    GOAL_B.y,
    GOAL_B.emoji,
    GOAL_B.label,
    color("#ff8fab"),
    camX,
    camY,
    phase === "toB",
  );

  // ── Signs ──
  SIGNS.forEach((s) => drawSign(s, camX, camY));

  // ── NPC cars ──
  npcs.forEach((n) => {
    let ang = n.vx > 0 ? HALF_PI : n.vx < 0 ? -HALF_PI : n.vy > 0 ? PI : 0;
    drawCar(n.x, n.y, ang, color(n.col), camX, camY, false);
  });

  // ── Player ──
  drawCar(player.x, player.y, player.angle, color("#ffb3c6"), camX, camY, true);
}

// ============================================================
//  DRAW CAR
// ============================================================
function drawCar(wx, wy, angle, col, camX, camY, isPlayer) {
  let sx = wx * TILE - camX;
  let sy = wy * TILE - camY;
  if (sx < -80 || sx > width + 80 || sy < -80 || sy > height + 80) return;

  push();
  translate(sx, sy);
  rotate(angle);

  let bw = 20,
    bh = 32;

  // Shadow
  noStroke();
  fill(0, 0, 0, 46);
  ellipse(1, 3, bw * 1.0, bh * 0.7);

  // Body
  noStroke();
  fill(col);
  roundedRect(-bw / 2, -bh / 2, bw, bh, 6);

  // Shine
  fill(255, 255, 255, 90);
  roundedRect(-bw * 0.3, -bh * 0.45, bw * 0.55, bh * 0.18, 3);

  // Roof
  fill(isPlayer ? color("#ffeef8") : lerpColor(col, color(255), 0.5));
  roundedRect(-bw * 0.36, -bh * 0.26, bw * 0.72, bh * 0.36, 4);

  // Windshield
  fill(180, 240, 255, 204);
  roundedRect(-bw * 0.28, -bh * 0.24, bw * 0.56, bh * 0.15, 2);

  // Headlights
  fill("#fffde7");
  ellipse(-bw * 0.28, -bh / 2 + 3, 6, 5);
  ellipse(bw * 0.28, -bh / 2 + 3, 6, 5);

  // Tail lights
  fill("#ff6b9d");
  ellipse(-bw * 0.28, bh / 2 - 3, 6, 4);
  ellipse(bw * 0.28, bh / 2 - 3, 6, 4);

  // Wheels
  let wpos = [
    [-bw / 2 - 2, -bh * 0.25],
    [bw / 2 + 2, -bh * 0.25],
    [-bw / 2 - 2, bh * 0.25],
    [bw / 2 + 2, bh * 0.25],
  ];
  wpos.forEach(([wx2, wy2]) => {
    fill(PAL.wheel);
    ellipse(wx2, wy2, 7, 10);
    fill("#888");
    ellipse(wx2, wy2, 3.6, 3.6);
  });

  // Player star
  if (isPlayer) {
    textSize(9);
    textAlign(CENTER, BOTTOM);
    text("⭐", 0, -bh / 2 - 4);
  }

  pop();
}

// ============================================================
//  DRAW SIGN
// ============================================================
function drawSign(sign, camX, camY) {
  let sx = sign.x * TILE - camX;
  let sy = sign.y * TILE - camY;
  if (sx < -60 || sx > width + 60 || sy < -60 || sy > height + 60) return;

  // Post
  fill("#aaaaaa");
  noStroke();
  rect(sx + 9, sy + 18, 3, 20);

  push();
  translate(sx + 10, sy + 10);

  if (sign.shape === "oct") {
    fill(sign.bg);
    stroke("#fff");
    strokeWeight(2);
    beginShape();
    for (let i = 0; i < 8; i++) {
      let a = (i * TWO_PI) / 8 - PI / 8;
      vertex(9 * cos(a), 9 * sin(a));
    }
    endShape(CLOSE);
    noStroke();
    fill("#fff");
    textSize(6);
    textAlign(CENTER, CENTER);
    text(sign.text, 0, 0);
  } else if (sign.shape === "tri") {
    fill(sign.bg);
    stroke("#fff");
    strokeWeight(2);
    triangle(0, -9, 10, 8, -10, 8);
    noStroke();
    fill("#000");
    textSize(5);
    textAlign(CENTER, CENTER);
    text(sign.text, 0, 5);
  } else {
    fill(sign.bg);
    stroke("#fff");
    strokeWeight(1);
    roundedRect(-12, -7, 24, 14, 3);
    noStroke();
    fill("#fff");
    textSize(7);
    textAlign(CENTER, CENTER);
    text(sign.text, 0, 1);
  }

  pop();
}

// ============================================================
//  DRAW GOAL MARKER
// ============================================================
function drawGoalMarker(gx, gy, emoji, label, col, camX, camY, isCurrent) {
  let sx = gx * TILE - camX;
  let sy = gy * TILE - camY;
  if (sx < -100 || sx > width + 100 || sy < -100 || sy > height + 100) return;

  let sc = isCurrent ? 1 + 0.08 * sin(pulse * 5) : 1;
  let r = GOAL_RADIUS * TILE * sc;

  // Pulsing glow
  noStroke();
  fill(
    red(col),
    green(col),
    blue(col),
    isCurrent ? 46 + 26 * sin(pulse * 5) : 26,
  );
  circle(sx, sy, r * 2);

  // Dashed ring
  if (isCurrent) {
    noFill();
    stroke(col);
    strokeWeight(2.5);
    drawingContext.setLineDash([6, 5]);
    circle(sx, sy, r * 2);
    drawingContext.setLineDash([]);
  }

  // Flag pole
  noStroke();
  fill("#bbbbbb");
  rect(sx - 1.5, sy - 50, 3, 50);

  // Flag
  fill(col);
  triangle(sx + 1.5, sy - 50, sx + 20, sy - 42, sx + 1.5, sy - 34);

  // Emoji + label
  textSize(18);
  textAlign(CENTER, BOTTOM);
  text(emoji, sx, sy - 50);

  textSize(10);
  stroke(0, 0, 0, 100);
  strokeWeight(3);
  fill(255);
  text(label, sx, sy - 58);
  noStroke();
}

// ============================================================
//  HUD  (screen-space)
// ============================================================
function drawHUD() {
  let isToB = phase === "toB";
  let dest = isToB ? GOAL_B : GOAL_A;
  let spd = sqrt(player.vx ** 2 + player.vy ** 2);

  let x = 14,
    y = 14,
    w = 190,
    h = 110;

  drawPanel(x, y, w, h);

  fill("#c084fc");
  noStroke();
  textSize(10);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text("🌿 EUTHYMIA", x + 12, y + 12);

  let bx = x + 38,
    by = y + 32,
    bw2 = w - 54,
    bh2 = 7;
  fill("#f3e8ff");
  noStroke();
  rect(bx, by, bw2, bh2, 4);

  let pct = min(1, spd / MAX_SPEED);
  if (pct > 0) {
    fill("#c084fc");
    rect(bx, by, bw2 * pct, bh2, 4);
    fill(244, 114, 182, 180);
    rect(bx + bw2 * pct * 0.5, by, bw2 * pct * 0.5, bh2, 0, 4, 4, 0);
  }
  fill("#aaaaaa");
  textSize(9);
  textStyle(NORMAL);
  textAlign(LEFT, TOP);
  text(nf(spd, 1, 1) + " t/s", bx, by + 10);

  textSize(17);
  textAlign(LEFT, TOP);
  text("🚗", x + 12, y + 28);

  let gx = x + 8,
    gy = y + 58,
    gw = w - 16,
    gh = 44;
  fill(isToB ? color(255, 240, 246) : color(240, 255, 244));
  stroke(isToB ? color("#ffb3c6") : color("#b2f5c8"));
  strokeWeight(2);
  rect(gx, gy, gw, gh, 10);

  noStroke();
  fill("#cccccc");
  textSize(9);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text(isToB ? "STEP 1 OF 2" : "STEP 2 OF 2", gx + 8, gy + 7);

  textSize(18);
  text(dest.emoji, gx + 8, gy + 18);

  fill(isToB ? color("#e91e8c") : color("#16a34a"));
  textSize(11);
  textStyle(BOLD);
  text(dest.label, gx + 32, gy + 18);

  fill("#aaaaaa");
  textStyle(NORMAL);
  textSize(9);
  text(
    isToB ? "Drive to the hospital" : "Return to community centre",
    gx + 32,
    gy + 32,
  );
}

// ============================================================
//  MINI-MAP
// ============================================================
function drawMinimap() {
  let mmW = COLS * MM_SCALE;
  let mmH = ROWS * MM_SCALE;
  let mx = width - mmW - 16;
  let my = height - mmH - 16;

  drawPanel(mx - 10, my - 22, mmW + 20, mmH + 32);

  fill("#c084fc");
  textSize(9);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text("🗺️ MAP", mx + mmW / 2, my - 16);

  image(mmGfx, mx, my);

  noStroke();
  fill(255);
  circle(mx + player.x * MM_SCALE, my + player.y * MM_SCALE, 8);
  fill("#e879f9");
  circle(mx + player.x * MM_SCALE, my + player.y * MM_SCALE, 5);

  textSize(8);
  textStyle(NORMAL);
  textAlign(LEFT, TOP);
  fill("#69db7c");
  text("● A", mx, my + mmH + 4);
  fill("#ff8fab");
  text("● B", mx + 26, my + mmH + 4);
  fill("#e879f9");
  text("● You", mx + 52, my + mmH + 4);
}

// ============================================================
//  INTRO SCREEN
// ============================================================
function drawIntro() {
  background("#f5eeff");

  noStroke();
  fill(240, 214, 255, 80);
  circle(width * 0.2, height * 0.2, 300);
  fill(180, 230, 255, 60);
  circle(width * 0.8, height * 0.75, 250);
  fill(255, 200, 230, 60);
  circle(width * 0.55, height * 0.85, 200);

  let cx = width / 2,
    cy = height / 2;
  let pw = 360,
    ph = 430;

  fill(255, 255, 255, 247);
  stroke("#f0d6ff");
  strokeWeight(2.5);
  rect(cx - pw / 2, cy - ph / 2, pw, ph, 26);
  noStroke();

  textSize(58);
  textAlign(CENTER, TOP);
  text("🚗", cx, cy - ph / 2 + 22);

  fill("#e91e8c");
  textSize(26);
  textStyle(BOLD);
  text("Crossy Mind", cx, cy - ph / 2 + 90);

  fill("#a78bca");
  textSize(11);
  textStyle(NORMAL);
  text("☁  EUTHYMIA · BASE LEVEL  ☁", cx, cy - ph / 2 + 124);

  drawGoalChip(
    cx - 110,
    cy - ph / 2 + 155,
    "🏫",
    "Community Centre",
    "#69db7c",
    "START",
  );
  fill("#d8b4fe");
  textSize(20);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text("→", cx, cy - ph / 2 + 168);
  drawGoalChip(cx + 30, cy - ph / 2 + 155, "🏥", "Hospital", "#ff8fab", "GOAL");

  fill("#9333ea");
  textSize(12);
  textStyle(NORMAL);
  textAlign(CENTER, TOP);
  text("Drive there & back for the round trip!", cx, cy - ph / 2 + 230);
  text("Stay on the roads 🛣️", cx, cy - ph / 2 + 248);

  let cbx = cx - 90,
    cby = cy - ph / 2 + 272;
  fill(240, 214, 255, 100);
  stroke("#e9d5ff");
  strokeWeight(1.5);
  rect(cbx, cby, 180, 80, 14);
  noStroke();
  fill("#a78bca");
  textSize(10);
  textStyle(BOLD);
  textAlign(CENTER, TOP);
  text("CONTROLS", cx, cby + 8);

  drawDpadDiagram(cx, cby + 32);

  fill("#b8a0cc");
  textSize(9);
  textStyle(NORMAL);
  text("Arrow keys move in that direction", cx, cby + 64);

  let btnW = 180,
    btnH = 46;
  let btnX = cx - btnW / 2;
  let btnY = cy + ph / 2 - 70;
  startBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
  drawCuteButton(btnX, btnY, btnW, btnH, "Let's Drive! 🚗💨");
}

function drawDpadDiagram(cx, cy) {
  let ks = 28;
  [
    [1, 0, "↑"],
    [0, 1, "←"],
    [1, 1, "↓"],
    [2, 1, "→"],
  ].forEach(([col, row, lbl]) => {
    let kx = cx - ks * 1.5 + col * (ks + 3);
    let ky = cy + row * (ks + 3);
    fill("#fff");
    stroke("#e9d5ff");
    strokeWeight(1.5);
    rect(kx, ky, ks, ks, 7);
    noStroke();
    fill("#9333ea");
    textSize(14);
    textStyle(BOLD);
    textAlign(CENTER, CENTER);
    text(lbl, kx + ks / 2, ky + ks / 2);
  });
}

// ============================================================
//  WIN SCREEN
// ============================================================
function drawWin() {
  background("#f5eeff");

  noStroke();
  fill(240, 214, 255, 80);
  circle(width * 0.2, height * 0.2, 300);
  fill(255, 200, 230, 60);
  circle(width * 0.75, height * 0.7, 250);

  let cx = width / 2,
    cy = height / 2;
  let pw = 320,
    ph = 340;

  fill(255, 255, 255, 247);
  stroke("#f0d6ff");
  strokeWeight(2.5);
  rect(cx - pw / 2, cy - ph / 2, pw, ph, 26);
  noStroke();

  textSize(60);
  textAlign(CENTER, TOP);
  text("🎉", cx, cy - ph / 2 + 20);

  fill("#e91e8c");
  textSize(24);
  textStyle(BOLD);
  text("Route Complete!", cx, cy - ph / 2 + 90);

  textSize(28);
  textStyle(NORMAL);
  text("🏫 → 🏥 → 🏫", cx, cy - ph / 2 + 130);

  fill("#9333ea");
  textSize(12);
  text("Round trip finished!", cx, cy - ph / 2 + 172);

  textSize(24);
  text("🌟✨🌟", cx, cy - ph / 2 + 198);

  let btnW = 160,
    btnH = 46;
  let btnX = cx - btnW / 2;
  let btnY = cy + ph / 2 - 70;
  playAgainBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
  drawCuteButton(btnX, btnY, btnW, btnH, "Play Again 🔄");
}

// ============================================================
//  SHARED UI HELPERS
// ============================================================
function drawPanel(x, y, w, h) {
  fill(255, 255, 255, 235);
  stroke("#f0d6ff");
  strokeWeight(2);
  drawingContext.shadowColor = "rgba(200,130,240,0.18)";
  drawingContext.shadowBlur = 18;
  drawingContext.shadowOffsetY = 4;
  rect(x, y, w, h, 20);
  drawingContext.shadowBlur = 0;
  drawingContext.shadowOffsetY = 0;
  noStroke();
}

function drawCuteButton(x, y, w, h, label) {
  let hover = mouseX > x && mouseX < x + w && mouseY > y && mouseY < y + h;
  fill(hover ? "#e879f9" : "#d946ef");
  noStroke();
  drawingContext.shadowColor = "rgba(217,70,239,0.38)";
  drawingContext.shadowBlur = hover ? 22 : 14;
  drawingContext.shadowOffsetY = hover ? 6 : 4;
  rect(x, y + (hover ? -2 : 0), w, h, h / 2);
  drawingContext.shadowBlur = 0;
  drawingContext.shadowOffsetY = 0;
  fill(255);
  textSize(14);
  textStyle(BOLD);
  textAlign(CENTER, CENTER);
  text(label, x + w / 2, y + h / 2 + (hover ? -2 : 0));
}

function drawGoalChip(x, y, emoji, label, col, note) {
  let cw = 110,
    ch = 70;
  fill(red(color(col)), green(color(col)), blue(color(col)), 34);
  stroke(col);
  strokeWeight(2);
  rect(x, y, cw, ch, 14);
  noStroke();

  fill(col);
  textSize(8);
  textStyle(BOLD);
  textAlign(LEFT, TOP);
  text(note, x + 8, y + 8);

  textSize(20);
  text(emoji, x + 8, y + 18);

  fill("#555555");
  textSize(9);
  textStyle(BOLD);
  text(label, x + 8, y + 46);
}

function roundedRect(x, y, w, h, r) {
  rect(x, y, w, h, r);
}

// ============================================================
//  INPUT (single mousePressed, no duplicates)
// ============================================================
function mousePressed() {
  if (screen === "intro") {
    let b = startBtn;
    if (
      b.w &&
      mouseX > b.x &&
      mouseX < b.x + b.w &&
      mouseY > b.y &&
      mouseY < b.y + b.h
    ) {
      resetGame();
      screen = "playing";
    }
  } else if (screen === "win") {
    let b = playAgainBtn;
    if (
      b.w &&
      mouseX > b.x &&
      mouseX < b.x + b.w &&
      mouseY > b.y &&
      mouseY < b.y + b.h
    ) {
      resetGame();
      screen = "intro";
    }
  }
}

// Prevent arrow keys scrolling the page
function keyPressed() {
  if ([UP_ARROW, DOWN_ARROW, LEFT_ARROW, RIGHT_ARROW].includes(keyCode))
    return false;
}
