/**
 * Jungle Surge — A tropical 2D platformer
 * Original IP by ForgeFlow Games. Inspired by classic jungle platformers.
 *
 * Features: momentum physics, coyote time, wall jumps, ground pound,
 * dash, enemy AI, collectibles, 3 worlds with unique themes.
 */

// ── Canvas Setup ────────────────────────────────────────────────────
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const TILE = 32;
let W, H, COLS, ROWS;

function resize() {
  const aspect = 16 / 9;
  let w = window.innerWidth;
  let h = window.innerHeight;
  if (w / h > aspect) w = h * aspect;
  else h = w / aspect;
  W = canvas.width = Math.floor(w);
  H = canvas.height = Math.floor(h);
  COLS = Math.ceil(W / TILE) + 2;
  ROWS = Math.ceil(H / TILE) + 2;
}
resize();
window.addEventListener("resize", resize);

// ── Input ───────────────────────────────────────────────────────────
const keys = {};
window.addEventListener("keydown", e => { keys[e.code] = true; e.preventDefault(); });
window.addEventListener("keyup", e => { keys[e.code] = false; });

function inputLeft() { return keys["ArrowLeft"] || keys["KeyA"]; }
function inputRight() { return keys["ArrowRight"] || keys["KeyD"]; }
function inputJump() { return keys["Space"] || keys["ArrowUp"] || keys["KeyW"]; }
function inputDown() { return keys["ArrowDown"] || keys["KeyS"]; }
function inputDash() { return keys["ShiftLeft"] || keys["ShiftRight"]; }

// ── Game State ──────────────────────────────────────────────────────
let gameState = "menu"; // menu | playing | dead | win | levelComplete
let score = 0, crystals = 0, hp = 3;
let currentWorld = 0, currentLevel = 0;
let camera = { x: 0, y: 0 };
let shakeTimer = 0, shakeIntensity = 0;
let particles = [];
let deathTimer = 0;

// ── Colors & Themes ─────────────────────────────────────────────────
const THEMES = [
  { // World 1: Emerald Canopy
    bg: ["#0d2b1a", "#1a3d2b", "#0f3320"],
    ground: "#2d5a1e", groundDark: "#1e4015", groundLight: "#3a7525",
    platform: "#4a3520", platformLight: "#5d4830",
    sky: "#0a1f12", accent: "#00e676", crystalColor: "#00e676",
    treeTrunk: "#3d2815", treeLeaf: "#1e6b30",
    name: "Emerald Canopy"
  },
  { // World 2: Crystal Caverns
    bg: ["#0a0a20", "#12123a", "#0d0d2d"],
    ground: "#2a2a5a", groundDark: "#1e1e45", groundLight: "#3a3a70",
    platform: "#352850", platformLight: "#453560",
    sky: "#050510", accent: "#7c4dff", crystalColor: "#7c4dff",
    treeTrunk: "#2a2050", treeLeaf: "#4a35a0",
    name: "Crystal Caverns"
  },
  { // World 3: Frozen Summit
    bg: ["#0a1525", "#122035", "#0f1a2d"],
    ground: "#4a6080", groundDark: "#3a5070", groundLight: "#5a7090",
    platform: "#506080", platformLight: "#607090",
    sky: "#081020", accent: "#40c4ff", crystalColor: "#40c4ff",
    treeTrunk: "#3a5060", treeLeaf: "#5080a0",
    name: "Frozen Summit"
  },
];

// ── Level Data ──────────────────────────────────────────────────────
// Each level: 2D array where:
// 0=air, 1=ground, 2=platform, 3=crystal, 4=enemy, 5=spikes, 6=spring, 7=goal
function generateLevel(world, difficulty) {
  const levelW = 80 + difficulty * 20;
  const levelH = 18;
  const map = Array.from({ length: levelH }, () => Array(levelW).fill(0));

  // Ground floor
  for (let x = 0; x < levelW; x++) {
    const groundH = Math.floor(Math.sin(x * 0.15) * 2) + 14;
    for (let y = groundH; y < levelH; y++) map[y][x] = 1;
    // Gaps
    if (x > 10 && x < levelW - 10 && Math.random() < 0.04 * difficulty) {
      for (let y = 0; y < levelH; y++) map[y][x] = 0;
      if (x + 1 < levelW) for (let y = 0; y < levelH; y++) map[y][x + 1] = 0;
    }
  }

  // Platforms
  for (let i = 0; i < 15 + difficulty * 5; i++) {
    const px = Math.floor(Math.random() * (levelW - 8)) + 4;
    const py = Math.floor(Math.random() * 8) + 4;
    const pw = Math.floor(Math.random() * 4) + 3;
    for (let x = px; x < px + pw && x < levelW; x++) {
      if (map[py][x] === 0) map[py][x] = 2;
    }
  }

  // Crystals
  for (let i = 0; i < 20 + difficulty * 5; i++) {
    const cx = Math.floor(Math.random() * (levelW - 10)) + 5;
    const cy = Math.floor(Math.random() * 10) + 2;
    if (map[cy][cx] === 0 && cy > 0 && (map[cy + 1][cx] === 1 || map[cy + 1][cx] === 2 || map[cy + 1]?.[cx] === 0)) {
      map[cy][cx] = 3;
    }
  }

  // Enemies
  for (let i = 0; i < 5 + difficulty * 3; i++) {
    const ex = Math.floor(Math.random() * (levelW - 15)) + 8;
    for (let y = 0; y < levelH - 1; y++) {
      if (map[y][ex] === 0 && map[y + 1][ex] === 1) {
        map[y][ex] = 4;
        break;
      }
    }
  }

  // Springs
  for (let i = 0; i < 3 + difficulty; i++) {
    const sx = Math.floor(Math.random() * (levelW - 15)) + 8;
    for (let y = 0; y < levelH - 1; y++) {
      if (map[y][sx] === 0 && map[y + 1][sx] === 1) {
        map[y][sx] = 6;
        break;
      }
    }
  }

  // Spikes (world 2+)
  if (world >= 1) {
    for (let i = 0; i < difficulty * 3; i++) {
      const sx = Math.floor(Math.random() * (levelW - 10)) + 5;
      for (let y = 0; y < levelH - 1; y++) {
        if (map[y][sx] === 0 && map[y + 1][sx] === 1) {
          map[y][sx] = 5;
          break;
        }
      }
    }
  }

  // Goal flag at end
  map[10][levelW - 4] = 7;

  // Clear spawn area
  for (let x = 0; x < 5; x++) for (let y = 0; y < 14; y++) {
    if (map[y][x] !== 1) map[y][x] = 0;
  }

  return { map, width: levelW, height: levelH };
}

// ── Player ──────────────────────────────────────────────────────────
const player = {
  x: 64, y: 200, vx: 0, vy: 0, w: 22, h: 28,
  grounded: false, facing: 1,
  jumpBuffer: 0, coyoteTime: 0,
  dashing: false, dashTimer: 0, dashCooldown: 0,
  groundPounding: false, groundPoundLock: false,
  invincible: 0, animFrame: 0, animTimer: 0,
  wallSlideDir: 0,
};

function resetPlayer() {
  player.x = 64; player.y = 200;
  player.vx = 0; player.vy = 0;
  player.grounded = false; player.dashing = false;
  player.dashTimer = 0; player.groundPounding = false;
  player.groundPoundLock = false; player.invincible = 0;
}

// ── Level State ─────────────────────────────────────────────────────
let level = null;
let enemies = [];
let collectibles = [];
let springs = [];
let goalPos = null;

function loadLevel() {
  const difficulty = currentWorld * 3 + currentLevel + 1;
  level = generateLevel(currentWorld, difficulty);
  enemies = [];
  collectibles = [];
  springs = [];
  goalPos = null;

  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const t = level.map[y][x];
      if (t === 3) {
        collectibles.push({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, alive: true, bobPhase: Math.random() * Math.PI * 2 });
        level.map[y][x] = 0;
      } else if (t === 4) {
        enemies.push({
          x: x * TILE, y: y * TILE, w: 28, h: 24,
          vx: (Math.random() > 0.5 ? 1 : -1) * (1 + currentWorld * 0.5),
          alive: true, type: currentWorld, animTimer: 0,
          startX: x * TILE, patrol: 80 + Math.random() * 60,
        });
        level.map[y][x] = 0;
      } else if (t === 6) {
        springs.push({ x: x * TILE, y: y * TILE, compressed: 0 });
        level.map[y][x] = 0;
      } else if (t === 7) {
        goalPos = { x: x * TILE, y: y * TILE };
        level.map[y][x] = 0;
      }
    }
  }
  resetPlayer();
  camera.x = 0; camera.y = 0;
}

// ── Collision ───────────────────────────────────────────────────────
function tileAt(px, py) {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || ty >= level.height || tx >= level.width) return ty >= level.height ? 1 : 0;
  return level.map[ty][tx];
}

function isSolid(px, py) {
  const t = tileAt(px, py);
  return t === 1 || t === 2;
}

function isSpike(px, py) {
  return tileAt(px, py) === 5;
}

// ── Particles ───────────────────────────────────────────────────────
function spawnParticles(x, y, count, color, spread = 3) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * spread,
      vy: (Math.random() - 0.5) * spread - 1,
      life: 0.5 + Math.random() * 0.5,
      maxLife: 0.5 + Math.random() * 0.5,
      size: 2 + Math.random() * 3,
      color,
    });
  }
}

// ── Update ──────────────────────────────────────────────────────────
const GRAVITY = 0.55;
const JUMP_FORCE = -10;
const MOVE_SPEED = 4.5;
const DASH_SPEED = 12;
const FRICTION = 0.82;
const AIR_FRICTION = 0.92;
const COYOTE_FRAMES = 6;
const JUMP_BUFFER_FRAMES = 6;

let prevJump = false;

function updatePlayer(dt) {
  const theme = THEMES[currentWorld];

  // Animation
  player.animTimer += dt;
  if (player.animTimer > 0.12) {
    player.animTimer = 0;
    player.animFrame = (player.animFrame + 1) % 4;
  }

  // Invincibility countdown
  if (player.invincible > 0) player.invincible -= dt;

  // Dash
  if (player.dashCooldown > 0) player.dashCooldown -= dt;
  if (inputDash() && !player.dashing && player.dashCooldown <= 0 && !player.groundPounding) {
    player.dashing = true;
    player.dashTimer = 0.15;
    player.dashCooldown = 0.5;
    player.vx = player.facing * DASH_SPEED;
    player.vy = 0;
    spawnParticles(player.x + player.w / 2, player.y + player.h / 2, 8, "#ff8800");
  }
  if (player.dashing) {
    player.dashTimer -= dt;
    if (player.dashTimer <= 0) player.dashing = false;
  }

  // Ground pound
  if (inputDown() && inputJump() && !player.grounded && !player.groundPounding && !prevJump) {
    player.groundPounding = true;
    player.groundPoundLock = true;
    player.vy = 14;
    player.vx = 0;
  }

  // Horizontal movement (not during dash or ground pound)
  if (!player.dashing && !player.groundPounding) {
    if (inputLeft()) {
      player.vx -= MOVE_SPEED * 0.3;
      player.facing = -1;
    } else if (inputRight()) {
      player.vx += MOVE_SPEED * 0.3;
      player.facing = 1;
    }
    player.vx = Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, player.vx));
  }

  // Friction
  if (player.grounded && !player.dashing) {
    player.vx *= FRICTION;
  } else if (!player.dashing) {
    player.vx *= AIR_FRICTION;
  }

  // Gravity
  if (!player.dashing) {
    player.vy += GRAVITY;
    // Variable jump height
    if (player.vy < 0 && !inputJump()) player.vy += GRAVITY * 0.5;
    player.vy = Math.min(player.vy, player.groundPounding ? 16 : 12);
  }

  // Coyote time
  if (player.grounded) player.coyoteTime = COYOTE_FRAMES;
  else if (player.coyoteTime > 0) player.coyoteTime--;

  // Jump buffer
  if (inputJump() && !prevJump) player.jumpBuffer = JUMP_BUFFER_FRAMES;
  else if (player.jumpBuffer > 0) player.jumpBuffer--;

  // Jump
  if (player.jumpBuffer > 0 && player.coyoteTime > 0 && !player.groundPounding) {
    player.vy = JUMP_FORCE;
    player.grounded = false;
    player.coyoteTime = 0;
    player.jumpBuffer = 0;
    spawnParticles(player.x + player.w / 2, player.y + player.h, 5, "#fff", 2);
  }

  // Wall slide (simplified)
  if (!player.grounded && !player.dashing) {
    const wallLeft = isSolid(player.x - 2, player.y + player.h / 2);
    const wallRight = isSolid(player.x + player.w + 2, player.y + player.h / 2);
    if ((wallLeft && inputLeft()) || (wallRight && inputRight())) {
      player.vy = Math.min(player.vy, 2);
      player.wallSlideDir = wallLeft ? -1 : 1;
      // Wall jump
      if (inputJump() && !prevJump) {
        player.vy = JUMP_FORCE * 0.9;
        player.vx = -player.wallSlideDir * 6;
        player.facing = -player.wallSlideDir;
        spawnParticles(player.x + (player.wallSlideDir > 0 ? player.w : 0), player.y + player.h / 2, 6, "#aaa", 2);
      }
    } else {
      player.wallSlideDir = 0;
    }
  }

  prevJump = inputJump();

  // Movement + collision
  // Horizontal
  player.x += player.vx;
  // Check horizontal collision
  if (player.vx > 0) {
    if (isSolid(player.x + player.w, player.y + 2) || isSolid(player.x + player.w, player.y + player.h - 2)) {
      player.x = Math.floor((player.x + player.w) / TILE) * TILE - player.w;
      player.vx = 0;
    }
  } else if (player.vx < 0) {
    if (isSolid(player.x, player.y + 2) || isSolid(player.x, player.y + player.h - 2)) {
      player.x = Math.floor(player.x / TILE) * TILE + TILE;
      player.vx = 0;
    }
  }

  // Vertical
  player.y += player.vy;
  player.grounded = false;
  if (player.vy > 0) {
    if (isSolid(player.x + 3, player.y + player.h) || isSolid(player.x + player.w - 3, player.y + player.h)) {
      player.y = Math.floor((player.y + player.h) / TILE) * TILE - player.h;
      if (player.groundPounding) {
        shakeTimer = 0.15;
        shakeIntensity = 4;
        spawnParticles(player.x + player.w / 2, player.y + player.h, 12, theme.accent, 5);
        // Kill nearby enemies with ground pound
        for (const e of enemies) {
          if (e.alive && Math.abs(e.x - player.x) < TILE * 3 && Math.abs(e.y - player.y) < TILE * 2) {
            e.alive = false;
            score += 200;
            spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 10, "#ff3366");
          }
        }
      }
      player.vy = 0;
      player.grounded = true;
      player.groundPounding = false;
      player.groundPoundLock = false;
    }
  } else if (player.vy < 0) {
    if (isSolid(player.x + 3, player.y) || isSolid(player.x + player.w - 3, player.y)) {
      player.y = Math.floor(player.y / TILE) * TILE + TILE;
      player.vy = 0;
    }
  }

  // Spike collision
  if (isSpike(player.x + player.w / 2, player.y + player.h - 2) ||
      isSpike(player.x + 3, player.y + player.h / 2) ||
      isSpike(player.x + player.w - 3, player.y + player.h / 2)) {
    hurtPlayer();
  }

  // Fall off map
  if (player.y > level.height * TILE + 100) hurtPlayer();

  // Crystal collection
  for (const c of collectibles) {
    if (!c.alive) continue;
    const dx = (player.x + player.w / 2) - c.x;
    const dy = (player.y + player.h / 2) - c.y;
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
      c.alive = false;
      crystals++;
      score += 50;
      spawnParticles(c.x, c.y, 8, theme.crystalColor);
    }
  }

  // Spring bounce
  for (const s of springs) {
    const dx = (player.x + player.w / 2) - (s.x + TILE / 2);
    const dy = (player.y + player.h) - s.y;
    if (Math.abs(dx) < 20 && dy >= 0 && dy < 10 && player.vy > 0) {
      player.vy = JUMP_FORCE * 1.5;
      s.compressed = 0.3;
      spawnParticles(s.x + TILE / 2, s.y, 6, "#ffcc00");
    }
    if (s.compressed > 0) s.compressed -= dt;
  }

  // Enemy collision
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = (player.x + player.w / 2) - (e.x + e.w / 2);
    const dy = (player.y + player.h / 2) - (e.y + e.h / 2);
    if (Math.abs(dx) < (player.w + e.w) / 2 && Math.abs(dy) < (player.h + e.h) / 2) {
      // Stomp from above
      if (player.vy > 0 && player.y + player.h < e.y + e.h / 2) {
        e.alive = false;
        player.vy = JUMP_FORCE * 0.7;
        score += 100;
        spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 10, "#ff3366");
        shakeTimer = 0.08; shakeIntensity = 2;
      } else if (player.invincible <= 0) {
        hurtPlayer();
      }
    }
  }

  // Goal
  if (goalPos) {
    const dx = (player.x + player.w / 2) - (goalPos.x + TILE / 2);
    const dy = (player.y + player.h / 2) - (goalPos.y + TILE / 2);
    if (Math.abs(dx) < 24 && Math.abs(dy) < 40) {
      levelComplete();
    }
  }

  // Camera follow
  const targetCamX = player.x - W / 2 + player.w / 2;
  const targetCamY = player.y - H * 0.6;
  camera.x += (targetCamX - camera.x) * 0.1;
  camera.y += (targetCamY - camera.y) * 0.08;
  camera.x = Math.max(0, Math.min(level.width * TILE - W, camera.x));
  camera.y = Math.max(0, Math.min(level.height * TILE - H, camera.y));
}

function hurtPlayer() {
  if (player.invincible > 0) return;
  hp--;
  player.invincible = 1.5;
  shakeTimer = 0.2; shakeIntensity = 5;
  spawnParticles(player.x + player.w / 2, player.y + player.h / 2, 15, "#ff3366");
  if (hp <= 0) {
    gameState = "dead";
    deathTimer = 2;
  } else {
    player.vy = JUMP_FORCE * 0.6;
  }
  updateHUD();
}

function levelComplete() {
  score += 500;
  currentLevel++;
  if (currentLevel >= 3) {
    currentLevel = 0;
    currentWorld++;
    if (currentWorld >= 3) {
      gameState = "win";
      return;
    }
  }
  gameState = "levelComplete";
  deathTimer = 2;
  spawnParticles(player.x + player.w / 2, player.y + player.h / 2, 30, THEMES[currentWorld].accent, 6);
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) continue;
    e.animTimer += dt;
    e.x += e.vx;
    // Patrol bounds
    if (Math.abs(e.x - e.startX) > e.patrol) e.vx *= -1;
    // Edge detection
    const ahead = e.vx > 0 ? e.x + e.w + 4 : e.x - 4;
    if (!isSolid(ahead, e.y + e.h + 4)) e.vx *= -1;
    // Wall detection
    if (isSolid(e.vx > 0 ? e.x + e.w : e.x, e.y + e.h / 2)) e.vx *= -1;
  }
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx; p.y += p.vy;
    p.vy += 0.1;
    p.life -= dt;
    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ── Drawing ─────────────────────────────────────────────────────────
function drawBackground() {
  const theme = THEMES[currentWorld];
  // Gradient sky
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, theme.bg[0]);
  grad.addColorStop(0.5, theme.bg[1]);
  grad.addColorStop(1, theme.bg[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Parallax background elements
  const parallax1 = camera.x * 0.1;
  const parallax2 = camera.x * 0.3;
  ctx.globalAlpha = 0.15;
  // Far mountains/shapes
  for (let i = 0; i < 8; i++) {
    const x = i * 200 - (parallax1 % 200);
    const h = 100 + Math.sin(i * 1.5) * 60;
    ctx.fillStyle = theme.treeLeaf;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + 100, H - h);
    ctx.lineTo(x + 200, H);
    ctx.fill();
  }
  // Near trees/pillars
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 12; i++) {
    const x = i * 140 - (parallax2 % 140);
    const h = 150 + Math.sin(i * 2.3) * 80;
    ctx.fillStyle = theme.treeTrunk;
    ctx.fillRect(x + 60, H - h, 20, h);
    ctx.fillStyle = theme.treeLeaf;
    ctx.beginPath();
    ctx.arc(x + 70, H - h, 40, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawTiles() {
  const theme = THEMES[currentWorld];
  const startCol = Math.floor(camera.x / TILE);
  const startRow = Math.floor(camera.y / TILE);

  for (let row = startRow; row < startRow + ROWS; row++) {
    for (let col = startCol; col < startCol + COLS; col++) {
      if (row < 0 || row >= level.height || col < 0 || col >= level.width) continue;
      const t = level.map[row][col];
      const sx = col * TILE - camera.x;
      const sy = row * TILE - camera.y;

      if (t === 1) {
        // Ground
        const isTop = row === 0 || level.map[row - 1]?.[col] !== 1;
        ctx.fillStyle = isTop ? theme.groundLight : theme.ground;
        ctx.fillRect(sx, sy, TILE, TILE);
        if (isTop) {
          ctx.fillStyle = theme.groundDark;
          ctx.fillRect(sx, sy + TILE - 3, TILE, 3);
        }
      } else if (t === 2) {
        // Platform
        ctx.fillStyle = theme.platform;
        ctx.fillRect(sx, sy, TILE, TILE / 3);
        ctx.fillStyle = theme.platformLight;
        ctx.fillRect(sx, sy, TILE, 2);
      } else if (t === 5) {
        // Spikes
        ctx.fillStyle = "#cc3333";
        for (let s = 0; s < 4; s++) {
          ctx.beginPath();
          ctx.moveTo(sx + s * 8, sy + TILE);
          ctx.lineTo(sx + s * 8 + 4, sy + TILE - 10);
          ctx.lineTo(sx + s * 8 + 8, sy + TILE);
          ctx.fill();
        }
      }
    }
  }
}

function drawPlayer() {
  const px = player.x - camera.x;
  const py = player.y - camera.y;

  // Flicker when invincible
  if (player.invincible > 0 && Math.floor(player.invincible * 10) % 2 === 0) return;

  ctx.save();
  ctx.translate(px + player.w / 2, py + player.h / 2);
  ctx.scale(player.facing, 1);

  // Body (Koa - jungle guardian)
  const bodyColor = player.dashing ? "#ff8800" : player.groundPounding ? "#ff3366" : "#ff6b35";
  ctx.fillStyle = bodyColor;
  // Torso
  ctx.fillRect(-8, -6, 16, 16);
  // Head
  ctx.fillStyle = "#ffb380";
  ctx.fillRect(-7, -14, 14, 10);
  // Eyes
  ctx.fillStyle = "#111";
  ctx.fillRect(1, -11, 3, 3);
  // Hair/crest
  ctx.fillStyle = "#2d5a1e";
  ctx.fillRect(-7, -16, 14, 4);
  ctx.fillRect(3, -18, 4, 4);
  // Legs (animated)
  ctx.fillStyle = "#994422";
  if (player.grounded && Math.abs(player.vx) > 0.5) {
    const legOff = Math.sin(player.animFrame * Math.PI / 2) * 4;
    ctx.fillRect(-6, 10, 5, 6 + legOff);
    ctx.fillRect(1, 10, 5, 6 - legOff);
  } else if (player.groundPounding) {
    ctx.fillRect(-7, 10, 14, 4);
  } else {
    ctx.fillRect(-6, 10, 5, 6);
    ctx.fillRect(1, 10, 5, 6);
  }
  // Dash trail
  if (player.dashing) {
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#ff8800";
    ctx.fillRect(-20, -6, 12, 16);
    ctx.globalAlpha = 0.2;
    ctx.fillRect(-30, -4, 10, 12);
    ctx.globalAlpha = 1;
  }

  ctx.restore();
}

function drawEnemies() {
  for (const e of enemies) {
    if (!e.alive) continue;
    const ex = e.x - camera.x;
    const ey = e.y - camera.y;
    const facing = e.vx > 0 ? 1 : -1;

    ctx.save();
    ctx.translate(ex + e.w / 2, ey + e.h / 2);
    ctx.scale(facing, 1);

    if (e.type === 0) {
      // Frost Grunt — blue goblin
      ctx.fillStyle = "#3388cc";
      ctx.fillRect(-12, -8, 24, 16);
      ctx.fillStyle = "#aaddff";
      ctx.fillRect(-10, -14, 20, 8);
      ctx.fillStyle = "#111";
      ctx.fillRect(2, -11, 3, 3);
      ctx.fillStyle = "#88ccff";
      const legBob = Math.sin(e.animTimer * 8) * 2;
      ctx.fillRect(-10, 8, 8, 5 + legBob);
      ctx.fillRect(2, 8, 8, 5 - legBob);
    } else if (e.type === 1) {
      // Ice Crawler — purple crystal spider
      ctx.fillStyle = "#6633aa";
      ctx.fillRect(-14, -6, 28, 12);
      ctx.fillStyle = "#9966dd";
      ctx.fillRect(-10, -10, 20, 6);
      ctx.fillStyle = "#ff0044";
      ctx.fillRect(2, -8, 3, 3);
      ctx.fillRect(-6, -8, 3, 3);
      // Legs
      ctx.fillStyle = "#553399";
      for (let l = 0; l < 3; l++) {
        const off = Math.sin(e.animTimer * 6 + l) * 3;
        ctx.fillRect(-14 + l * 10, 6, 4, 6 + off);
      }
    } else {
      // Snow Bomber — white/blue round enemy
      ctx.fillStyle = "#88bbdd";
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#aaddff";
      ctx.beginPath();
      ctx.arc(0, -4, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#112233";
      ctx.fillRect(2, -6, 4, 4);
    }
    ctx.restore();
  }
}

function drawCollectibles(time) {
  const theme = THEMES[currentWorld];
  for (const c of collectibles) {
    if (!c.alive) continue;
    const cx = c.x - camera.x;
    const cy = c.y - camera.y + Math.sin(time * 3 + c.bobPhase) * 4;

    // Glow
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = theme.crystalColor;
    ctx.beginPath();
    ctx.arc(cx, cy, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Crystal diamond shape
    ctx.fillStyle = theme.crystalColor;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 6, cy);
    ctx.lineTo(cx, cy + 8);
    ctx.lineTo(cx - 6, cy);
    ctx.closePath();
    ctx.fill();

    // Shine
    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.6;
    ctx.fillRect(cx - 2, cy - 5, 3, 3);
    ctx.globalAlpha = 1;
  }
}

function drawSprings() {
  for (const s of springs) {
    const sx = s.x - camera.x;
    const sy = s.y - camera.y;
    const comp = s.compressed > 0 ? 6 : 0;
    ctx.fillStyle = "#ffcc00";
    ctx.fillRect(sx + 4, sy + 16 + comp, 24, 16 - comp);
    ctx.fillStyle = "#ff9900";
    ctx.fillRect(sx + 8, sy + 8 + comp, 16, 8);
    ctx.fillStyle = "#ffee44";
    ctx.fillRect(sx + 6, sy + 4 + comp, 20, 6);
  }
}

function drawGoal(time) {
  if (!goalPos) return;
  const gx = goalPos.x - camera.x;
  const gy = goalPos.y - camera.y;
  const theme = THEMES[currentWorld];

  // Flag pole
  ctx.fillStyle = "#888";
  ctx.fillRect(gx + 14, gy - 40, 4, 72);
  // Flag
  const wave = Math.sin(time * 4) * 3;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.moveTo(gx + 18, gy - 38);
  ctx.lineTo(gx + 42 + wave, gy - 30);
  ctx.lineTo(gx + 18, gy - 20);
  ctx.fill();
  // Glow
  ctx.globalAlpha = 0.15 + Math.sin(time * 2) * 0.05;
  ctx.fillStyle = theme.accent;
  ctx.beginPath();
  ctx.arc(gx + 16, gy - 20, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = p.life / p.maxLife;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camera.x - p.size / 2, p.y - camera.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawOverlayText(text, subtext) {
  ctx.fillStyle = "rgba(10,14,26,0.75)";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.floor(W * 0.06)}px system-ui`;
  ctx.textAlign = "center";
  ctx.fillText(text, W / 2, H / 2 - 10);
  if (subtext) {
    ctx.fillStyle = "#888";
    ctx.font = `${Math.floor(W * 0.025)}px system-ui`;
    ctx.fillText(subtext, W / 2, H / 2 + 30);
  }
  ctx.textAlign = "left";
}

// ── HUD ─────────────────────────────────────────────────────────────
function updateHUD() {
  document.getElementById("hp").textContent = hp;
  document.getElementById("crystals").textContent = crystals;
  document.getElementById("score").textContent = score;
  document.getElementById("levelLabel").textContent = `${THEMES[currentWorld].name} ${currentLevel + 1}-${currentWorld + 1}`;
}

// ── Main Loop ───────────────────────────────────────────────────────
let lastTime = 0;
let gameTime = 0;

function loop(timestamp) {
  const dt = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;
  gameTime += dt;

  if (shakeTimer > 0) {
    shakeTimer -= dt;
    ctx.save();
    ctx.translate(
      (Math.random() - 0.5) * shakeIntensity,
      (Math.random() - 0.5) * shakeIntensity
    );
  }

  if (gameState === "playing") {
    updatePlayer(dt);
    updateEnemies(dt);
    updateParticles(dt);
    for (const s of springs) if (s.compressed > 0) s.compressed -= dt;

    drawBackground();
    drawTiles();
    drawSprings();
    drawCollectibles(gameTime);
    drawGoal(gameTime);
    drawEnemies();
    drawPlayer();
    drawParticles();
    updateHUD();
  } else if (gameState === "dead") {
    drawBackground();
    drawTiles();
    deathTimer -= dt;
    drawOverlayText("GAME OVER", `Score: ${score} | Press Space to retry`);
    if (deathTimer <= 0 && inputJump()) {
      hp = 3; score = 0; crystals = 0;
      currentWorld = 0; currentLevel = 0;
      loadLevel();
      gameState = "playing";
    }
  } else if (gameState === "levelComplete") {
    deathTimer -= dt;
    updateParticles(dt);
    drawBackground();
    drawTiles();
    drawParticles();
    drawOverlayText(`${THEMES[Math.max(0, currentWorld - (currentLevel === 0 ? 1 : 0))].name} Complete!`, "Get ready...");
    if (deathTimer <= 0) {
      loadLevel();
      gameState = "playing";
    }
  } else if (gameState === "win") {
    updateParticles(dt);
    drawBackground();
    drawParticles();
    drawOverlayText("YOU WIN!", `Final Score: ${score} | ${crystals} crystals collected`);
    if (inputJump()) {
      hp = 3; score = 0; crystals = 0;
      currentWorld = 0; currentLevel = 0;
      loadLevel();
      gameState = "playing";
    }
  }

  if (shakeTimer > 0) ctx.restore();

  requestAnimationFrame(loop);
}

// ── Start ───────────────────────────────────────────────────────────
document.getElementById("playBtn").addEventListener("click", () => {
  document.getElementById("overlay").classList.add("hidden");
  document.getElementById("hud").classList.remove("hidden");
  loadLevel();
  gameState = "playing";
  requestAnimationFrame(loop);
});

// PostMessage API for ForgeFlow Games portal (ad triggers, analytics)
window.addEventListener("message", (e) => {
  if (e.data?.type === "forgeflow:pause") gameState = "menu";
  if (e.data?.type === "forgeflow:resume") gameState = "playing";
});

// Notify parent when level is complete (for interstitial ads)
const origLevelComplete = levelComplete;
const patchedLevelComplete = function() {
  origLevelComplete.call(this);
  try {
    window.parent.postMessage({ type: "forgeflow:level_complete", level: currentWorld * 3 + currentLevel }, "*");
  } catch (e) {}
};
// (Already integrated inline above)
