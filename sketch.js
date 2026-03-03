// ================================================================
//  CROSSY MIND — raw Canvas2D raycaster (sketch.js)
//  A -> B only, better road floor, standout buildings + labels
// ================================================================

// ── Constants ────────────────────────────────────────────────
const ROWS = 40,
  COLS = 40;
const MOVE_SPEED = 7.0; // tiles/sec top speed
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
// IMPORTANT: goals must be on ROAD tiles (0), not inside buildings (3/4)
const GA = { x: 5.5, y: 3.5, label: "Community Centre" };
const GB = { x: 33.5, y: 34.5, label: "Hospital" };

// ── Player ───────────────────────────────────────────────────
let P = { x: 0, y: 0, a: 0, spd: 0 };

// ── NPCs ─────────────────────────────────────────────────────
let NPCS = [];
const NPC_INIT = [
  { x: 6, y: 3.5, vx: 2.5, vy: 0, r: 220, g: 70, b: 80 },
  { x: 30, y: 10.5, vx: -2.2, vy: 0, r: 70, g: 130, b: 220 },
  { x: 18.5, y: 7, vx: 0, vy: 2.0, r: 240, g: 190, b: 50 },
  { x: 26.5, y: 19, vx: 0, vy: -2.0, r: 220, g: 70, b: 80 },
  { x: 9, y: 26.5, vx: 2.8, vy: 0, r: 70, g: 130, b: 220 },
  { x: 34.5, y: 27, vx: 0, vy: 1.6, r: 240, g: 190, b: 50 },
  { x: 12, y: 18.5, vx: 2.0, vy: 0, r: 180, g: 100, b: 220 },
  { x: 20, y: 26.5, vx: -2.4, vy: 0, r: 80, g: 200, b: 160 },
];

// ── Static sprites ───────────────────────────────────────────
// type: 0=tree 1=stop 3=comm building 4=hospital 6/7/8 other buildings 5=car
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
  SPRITES.push({ x: 34.2, y: 34.2, t: 4 });

  // Extra decorative buildings (all different styles)
  // (Placed on grass near roads so they “pop” in the world)
  SPRITES.push({ x: 12.5, y: 5.6, t: 6, name: "LIBRARY" });
  SPRITES.push({ x: 26.6, y: 12.8, t: 7, name: "CAFE" });
  SPRITES.push({ x: 8.8, y: 31.2, t: 8, name: "SCHOOL" });
}

// ── Game state ───────────────────────────────────────────────
let gameState = "intro";
let pulse = 0;
const KEYS = {};

function resetGame() {
  P = { x: GA.x, y: GA.y, a: -0.5, spd: 0 };
  if (solid(P.x, P.y)) P.x += 1;
  pulse = 0;
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
  // Turn
  if (KEYS["ArrowLeft"] || KEYS["KeyA"]) P.a -= TURN_SPEED * dt;
  if (KEYS["ArrowRight"] || KEYS["KeyD"]) P.a += TURN_SPEED * dt;

  // Acceleration
  if (KEYS["ArrowUp"] || KEYS["KeyW"]) {
    P.spd += ACCEL * dt;
    if (P.spd > MOVE_SPEED) P.spd = MOVE_SPEED;
  } else if (KEYS["ArrowDown"] || KEYS["KeyS"]) {
    P.spd -= ACCEL * 0.6 * dt;
    if (P.spd < -MOVE_SPEED * 0.45) P.spd = -MOVE_SPEED * 0.45;
  } else {
    // Coast
    if (P.spd > 0) {
      P.spd -= DECEL * dt;
      if (P.spd < 0) P.spd = 0;
    }
    if (P.spd < 0) {
      P.spd += DECEL * dt;
      if (P.spd > 0) P.spd = 0;
    }
  }

  // Move with wall slide
  let dx = Math.cos(P.a) * P.spd * dt;
  let dy = Math.sin(P.a) * P.spd * dt;
  const M = 0.25;

  if (!solid(P.x + dx + (dx > 0 ? M : -M), P.y)) P.x += dx;
  else P.spd = 0;

  if (!solid(P.x, P.y + dy + (dy > 0 ? M : -M))) P.y += dy;
  else P.spd = 0;

  P.x = Math.max(0.5, Math.min(COLS - 0.5, P.x));
  P.y = Math.max(0.5, Math.min(ROWS - 0.5, P.y));

  // NPCs bounce
  NPCS.forEach((n) => {
    let nx = n.x + n.vx * dt,
      ny = n.y + n.vy * dt;
    if (solid(nx, n.y)) n.vx *= -1;
    else n.x = nx;
    if (solid(n.x, ny)) n.vy *= -1;
    else n.y = ny;
  });

  // Goal check: A -> B ONLY
  let dd = Math.hypot(P.x - GB.x, P.y - GB.y);
  if (dd < GOAL_R) showWin();
}

// ================================================================
//  RENDER — sky + floor casting + walls + sprites
// ================================================================
function render() {
  const W2 = W,
    H2 = H;
  const hor = H2 >> 1;
  const buf = buf32;
  const zb = zBuf;

  // ===== SKY (top half) =====
  for (let y = 0; y < hor; y++) {
    let t = y / hor;
    let r = (160 + t * 55) | 0;
    let g = (210 + t * 22) | 0;
    let b = (255 - t * 10) | 0;
    let col = 0xff000000 | (b << 16) | (g << 8) | r; // ABGR
    buf.fill(col, y * W2, y * W2 + W2);
  }

  // ===== FLOOR CASTING (bottom half) =====
  // Camera model: dir + plane
  const dirX = Math.cos(P.a),
    dirY = Math.sin(P.a);
  const planeScale = Math.tan(FOV / 2);
  const planeX = -dirY * planeScale;
  const planeY = dirX * planeScale;

  const rayLx = dirX - planeX;
  const rayLy = dirY - planeY;
  const rayRx = dirX + planeX;
  const rayRy = dirY + planeY;

  // small sun glow into sky buffer (simple)
  let sunX = (W2 * 0.82) | 0,
    sunY = (hor * 0.26) | 0,
    sunR = 22;
  for (let dy = -sunR; dy <= sunR; dy++)
    for (let dx = -sunR; dx <= sunR; dx++) {
      if (dx * dx + dy * dy < sunR * sunR) {
        let px2 = sunX + dx,
          py = sunY + dy;
        if (px2 >= 0 && px2 < W2 && py >= 0 && py < hor)
          buf[py * W2 + px2] = 0xff80e8ff;
      }
    }

  // floor rows
  // rowDist formula uses "camera height" = 0.5 (feels nice)
  for (let y = hor; y < H2; y++) {
    const p = y - hor;
    const rowDist = (0.5 * H2) / Math.max(1, p);

    // fog for floor
    const fog = Math.max(0.06, 1 - rowDist / MAX_D);

    // world step per screen pixel
    const stepX = (rowDist * (rayRx - rayLx)) / W2;
    const stepY = (rowDist * (rayRy - rayLy)) / W2;

    // starting world position (left ray)
    let fx = P.x + rowDist * rayLx;
    let fy = P.y + rowDist * rayLy;

    let rowBase = y * W2;

    for (let x = 0; x < W2; x++) {
      const cellX = fx | 0;
      const cellY = fy | 0;

      let tile = 1;
      if (cellX >= 0 && cellX < COLS && cellY >= 0 && cellY < ROWS) {
        tile = MAP[cellY][cellX];
      }

      // local fractional coords within tile
      const lx = fx - cellX;
      const ly = fy - cellY;

      let r, g, b;

      if (tile === 0) {
        // ROAD base (dark asphalt)
        // subtle noise via pattern
        const n =
          (((cellX * 37 + cellY * 17 + ((lx * 10) | 0) + ((ly * 10) | 0)) & 7) /
            7) *
          14;
        r = 70 + n;
        g = 70 + n;
        b = 86 + n;

        // dashed center line
        const nearCenter = Math.abs(lx - 0.5) < 0.03;
        const dash = ((fy * 2.2) | 0) % 4 < 2;
        if (nearCenter && dash) {
          r = 210;
          g = 190;
          b = 120;
        }

        // faint side edge lines (helps readability)
        const edge = lx < 0.05 || lx > 0.95 || ly < 0.05 || ly > 0.95;
        if (edge) {
          r = 120;
          g = 120;
          b = 140;
        }
      } else if (tile === 2) {
        // KERB
        const band = (((lx + ly) * 8) | 0) & 1;
        r = band ? 190 : 150;
        g = band ? 168 : 135;
        b = band ? 132 : 105;
      } else {
        // GRASS
        const s = (((cellX * 13 + cellY * 29) & 7) / 7) * 18;
        r = 48 + s;
        g = 120 + s;
        b = 70 + s;
      }

      // apply fog + slight vertical darken
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

  // ===== WALLS (raycast) =====
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
    } // grass wall
    else if (tt === 2) {
      wr = 200;
      wg = 180;
      wb = 140;
    } // kerb wall
    else if (tt === 3) {
      wr = 80;
      wg = 148;
      wb = 210;
    } // A
    else if (tt === 4) {
      wr = 210;
      wg = 85;
      wb = 88;
    } // B
    else {
      wr = 140;
      wg = 140;
      wb = 140;
    }

    for (let y = top; y <= bot; y++) {
      let frac = (y - top) / Math.max(wallH, 1);

      let tr, tg, tb;
      if (tt === 3) {
        // Community centre windows
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
        // Hospital brick
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
        // Kerb stone lines
        let band = (frac * 5) % 1;
        tr = band < 0.07 ? 130 : 200;
        tg = band < 0.07 ? 115 : 178;
        tb = band < 0.07 ? 88 : 138;
      } else {
        // Grass texture
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
  all.sort(
    (a, b) =>
      Math.hypot(b.x - P.x, b.y - P.y) - Math.hypot(a.x - P.x, a.y - P.y),
  );

  // Commit world
  ctx.putImageData(imgData, 0, 0);

  // Draw sprites
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
    ctx.globalAlpha = fog;

    if (sp.t === 0) drawTree(sx, startY, spW, spH, sd, fog);
    else if (sp.t === 1) drawStop(sx, startY, spW, spH, sd, fog);
    else if (sp.t === 3) {
      drawCommunity(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, GA.label);
    } else if (sp.t === 4) {
      drawHospital(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, GB.label);
    } else if (sp.t === 6) {
      drawLibrary(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "LIBRARY");
    } else if (sp.t === 7) {
      drawCafe(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "CAFE");
    } else if (sp.t === 8) {
      drawSchool(sx, startY, spW, spH, sd, fog);
      drawLabelAbove(sx, startY, spW, sd, fog, sp.name || "SCHOOL");
    } else if (sp.t === 5)
      drawCar3D(startX, startY, spW, spH, sd, fog, sp.r, sp.g, sp.b);

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

  // glow
  ctx.fillStyle = `rgba(200,160,255,${0.45 * fog})`;
  ctx.fillText(txt.toUpperCase(), cx, y);

  // crisp
  ctx.fillStyle = `rgba(255,255,255,${0.9 * fog})`;
  ctx.fillText(txt.toUpperCase(), cx, y);

  // underline bar
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
    ctx.fillStyle = `rgb(${(34 * cv * bright) | 0},${(132 * cv * bright) | 0},${(50 * cv * bright) | 0})`;
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

// ── Buildings: all different styles ───────────────────────────
function drawCommunity(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 1.9,
    bh = sh * 2.0;
  const bx = cx - bw / 2,
    by = sy - sh * 0.55;

  // soft glow outline
  ctx.fillStyle = `rgba(120,180,255,${0.22 * f})`;
  ctx.roundRect(bx - 3, by - 3, bw + 6, bh + 6, 18);
  ctx.fill();

  // facade
  ctx.fillStyle = `rgb(${(70 * f) | 0},${(140 * f) | 0},${(210 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 18);
  ctx.fill();

  // roof
  ctx.fillStyle = `rgb(${(25 * f) | 0},${(35 * f) | 0},${(65 * f) | 0})`;
  ctx.fillRect(bx, by, bw, bh * 0.1);

  // windows grid
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

  // banner sign
  ctx.fillStyle = `rgba(${(20 * f) | 0},${(70 * f) | 0},${(160 * f) | 0},0.95)`;
  ctx.fillRect(bx, by + bh * 0.7, bw, bh * 0.1);

  // door
  ctx.fillStyle = `rgb(${(45 * f) | 0},${(30 * f) | 0},${(20 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.1, by + bh * 0.8, bw * 0.2, bh * 0.18, 10);
  ctx.fill();
}

function drawHospital(cx, sy, sw, sh, sd, fog) {
  if (!colOk(cx, sd)) return;
  const f = fog;
  const bw = sw * 2.0,
    bh = sh * 2.1;
  const bx = cx - bw / 2,
    by = sy - sh * 0.6;

  // facade
  ctx.fillStyle = `rgb(${(235 * f) | 0},${(235 * f) | 0},${(245 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 16);
  ctx.fill();

  // red stripe
  ctx.fillStyle = `rgba(${(210 * f) | 0},${(60 * f) | 0},${(80 * f) | 0},0.95)`;
  ctx.fillRect(bx, by + bh * 0.12, bw, bh * 0.08);

  // windows
  const cols2 = 4,
    rows2 = 5;
  const gx = bw * 0.06,
    gy = bh * 0.045;
  const ww = (bw - gx * (cols2 + 1)) / cols2;
  const wh = (bh * 0.6 - gy * (rows2 + 1)) / rows2;
  for (let r = 0; r < rows2; r++)
    for (let c = 0; c < cols2; c++) {
      const wx = bx + gx + (ww + gx) * c;
      const wy = by + bh * 0.22 + gy + (wh + gy) * r;
      ctx.fillStyle = `rgba(${(160 * f) | 0},${(210 * f) | 0},${(255 * f) | 0},0.92)`;
      ctx.fillRect(wx, wy, ww, wh);
    }

  // big cross emblem
  const cw = bw * 0.22,
    ch = bh * 0.16;
  const ex = cx - cw / 2,
    ey = by + bh * 0.74;
  ctx.fillStyle = `rgb(${(205 * f) | 0},${(40 * f) | 0},${(55 * f) | 0})`;
  ctx.fillRect(ex + cw * 0.35, ey, cw * 0.3, ch);
  ctx.fillRect(ex, ey + ch * 0.35, cw, ch * 0.3);

  // entrance
  ctx.fillStyle = `rgb(${(35 * f) | 0},${(35 * f) | 0},${(55 * f) | 0})`;
  ctx.roundRect(cx - bw * 0.13, by + bh * 0.82, bw * 0.26, bh * 0.16, 10);
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

  // columns
  ctx.fillStyle = `rgba(${(240 * f) | 0},${(230 * f) | 0},${(210 * f) | 0},0.92)`;
  for (let i = 0; i < 5; i++) {
    const x = bx + bw * (0.1 + i * 0.18);
    ctx.fillRect(x, by + bh * 0.18, bw * 0.06, bh * 0.62);
  }

  // pediment
  ctx.fillStyle = `rgba(${(255 * f) | 0},${(245 * f) | 0},${(230 * f) | 0},0.95)`;
  ctx.beginPath();
  ctx.moveTo(bx + bw * 0.1, by + bh * 0.18);
  ctx.lineTo(cx, by + bh * 0.05);
  ctx.lineTo(bx + bw * 0.9, by + bh * 0.18);
  ctx.closePath();
  ctx.fill();

  // door
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

  // warm facade
  ctx.fillStyle = `rgb(${(210 * f) | 0},${(150 * f) | 0},${(95 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 16);
  ctx.fill();

  // awning stripes
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle =
      i % 2
        ? `rgba(${(255 * f) | 0},${(220 * f) | 0},${(230 * f) | 0},0.95)`
        : `rgba(${(180 * f) | 0},${(50 * f) | 0},${(90 * f) | 0},0.95)`;
    ctx.fillRect(bx + (bw * i) / 8, by, bw / 8, bh * 0.2);
  }

  // big window
  ctx.fillStyle = `rgba(${(140 * f) | 0},${(210 * f) | 0},${(255 * f) | 0},0.92)`;
  ctx.roundRect(cx - bw * 0.3, by + bh * 0.28, bw * 0.6, bh * 0.42, 10);
  ctx.fill();

  // door
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

  // bright, clean
  ctx.fillStyle = `rgb(${(245 * f) | 0},${(235 * f) | 0},${(210 * f) | 0})`;
  ctx.roundRect(bx, by, bw, bh, 16);
  ctx.fill();

  // roof accent
  ctx.fillStyle = `rgba(${(80 * f) | 0},${(120 * f) | 0},${(210 * f) | 0},0.95)`;
  ctx.fillRect(bx, by, bw, bh * 0.1);

  // windows
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

  // flag pole + flag (tiny detail)
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

// ── Car sprite ───────────────────────────────────────────────
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
//  HUD UPDATE (A -> B only)
// ================================================================
function updateHUD() {
  let spd = Math.abs(P.spd);
  document.getElementById("spd-bar").style.width =
    (spd / MOVE_SPEED) * 100 + "%";
  document.getElementById("spd-label").textContent =
    spd.toFixed(1) + " t/s  " + (P.spd >= 0 ? "▲ FWD" : "▼ REV");

  let d = Math.hypot(P.x - GB.x, P.y - GB.y);
  document.getElementById("step-label").style.color = "#ff8fab";
  document.getElementById("step-label").textContent = "DESTINATION:";
  document.getElementById("dest-label").textContent = GB.label;
  document.getElementById("dist-label").textContent =
    d.toFixed(1) + " units away";
}

// ================================================================
//  COMPASS (points to B only)
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
  let rel = Math.atan2(dy, dx) - P.a;
  let ac = "#ff8fab";
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

  // A + B
  oc.fillStyle = "#69db7c";
  oc.beginPath();
  oc.arc(GA.x * MM_S, GA.y * MM_S, 4, 0, Math.PI * 2);
  oc.fill();

  oc.fillStyle = "#ff8fab";
  oc.beginPath();
  oc.arc(GB.x * MM_S, GB.y * MM_S, 4, 0, Math.PI * 2);
  oc.fill();

  mmBase = offscreen;
}

function updateMinimap() {
  if (!mmBase) buildMinimapBase();
  mmCtx.clearRect(0, 0, mmCanvas.width, mmCanvas.height);
  mmCtx.drawImage(mmBase, 0, 0);

  NPCS.forEach((n) => {
    mmCtx.fillStyle = `rgb(${n.r},${n.g},${n.b})`;
    mmCtx.beginPath();
    mmCtx.arc(n.x * MM_S, n.y * MM_S, 2, 0, Math.PI * 2);
    mmCtx.fill();
  });

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

// ── Init ─────────────────────────────────────────────────────
buildMap();
resize();
// scene is built on Start button click via resetGame()
