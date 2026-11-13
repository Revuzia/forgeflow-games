#!/usr/bin/env node
/**
 * gen_lumen_level.cjs — build a long, dense, double-jump-spaced level for Lumen Run
 * and write it into a content.json's `level` (preserving title/tuning/hero/view).
 *
 * Why a generator (not hand-JSON): the owner wants the level ~10x longer with far more
 * obstacles — mobs, spike pits, RISING spikes, and FIREBALL LAUNCHERS — and "no platform
 * shift" (the old timid <=120px staircase existed only because there was no double jump;
 * there is now, so we use real platformer spacing). Hand-authoring ~21k px of that is
 * silly; this emits it deterministically and GUARANTEES a traversable ground spine.
 *
 * Reachability contract (tuning: jumpVel 820, doubleJump 760, gravity 2100, maxRun 320):
 *   single-jump apex ~160px, double adds ~138px -> safe vertical step <= ~200px;
 *   double-jump airtime gives a safe horizontal gap <= ~300px. The GROUND SPINE is the
 *   guaranteed path (run right, hop pits <= 240px); elevated platforms are optional
 *   double-jump coin routes, each placed within reach of the spine.
 *
 * Usage: node gen_lumen_level.cjs [--seed N] [--out games/lumen-run/content.json]
 */
const fs = require("fs");
const path = require("path");

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(seed) {
  const rng = mulberry32(seed >>> 0);
  const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const rf = (lo, hi) => lo + rng() * (hi - lo);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  const GY = 560;                 // ground top (world px, y down)
  const TARGET_W = 21600;         // ~10x the old 2304-wide level
  const GROUND_H = 220;           // visual thickness of ground/platform bodies

  const platforms = [];
  const coins = [];
  const hazards = [];
  const enemies = [];

  const plat = (x, y, w, h, kind) => platforms.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h || GROUND_H), kind: kind || "ground" });
  const coin = (x, y, v) => coins.push({ x: Math.round(x), y: Math.round(y), value: v || 5 });
  const spikePit = (x, y, w) => hazards.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: 22, kind: "spike" });
  const riser = (x, w) => hazards.push({ x: Math.round(x), y: GY - 34, w: Math.round(w), h: 34, kind: "riser", period: ri(1700, 2600), up: ri(650, 950), offset: ri(0, 1500) });
  const launcher = (x, dir) => hazards.push({ x: Math.round(x), y: GY - 46, w: 26, h: 30, kind: "launcher", dir: dir, interval: ri(1500, 2200), speed: ri(190, 250), ballR: 11 });
  const patrol = (x, y, range, spd) => enemies.push({ x: Math.round(x), y: Math.round(y), w: 30, h: 30, kind: "patrol", range: Math.round(range), speed: spd, dir: pick([1, -1]) });

  // an elevated double-jump coin arc above a ground segment (optional reward route)
  function coinArc(x0, x1, baseY) {
    // 2-3 floating platforms stepping up then easing down, each within double-jump reach
    let px = x0 + ri(40, 90);
    let py = baseY - ri(150, 200);          // first hop up (<= ~200)
    const steps = ri(2, 3);
    for (let s = 0; s < steps && px < x1 - 120; s++) {
      const pw = ri(90, 150);
      plat(px, py, pw, 26, "float");
      coin(px + pw / 2, py - 26, s === 1 ? 10 : 5);
      if (rng() < 0.4) patrol(px + pw / 2 - 15, py - 30, Math.min(pw / 2 - 10, 60), ri(60, 90));
      px += pw + ri(120, 240);              // horizontal gap within double-jump range
      py += (s === 0 ? -ri(40, 110) : ri(60, 150)); // up a touch, then back down
      py = Math.max(baseY - 290, Math.min(baseY - 120, py));
    }
  }

  // ── ground spine, broken by jumpable spike pits ─────────────────────────────
  let x = 0;
  const spawnX = 70;
  plat(0, GY, ri(560, 760), GROUND_H);          // opening run (no hazards near spawn)
  x = platforms[0].x + platforms[0].w;
  coin(spawnX + 150, GY - 70); coin(spawnX + 240, GY - 70);

  while (x < TARGET_W) {
    // a spike pit gap to clear. Cap < single-jump horizontal range (~250px at full
    // run) so it's comfortably clearable even WITHOUT the double jump; double jump is
    // margin. Falling in costs health (spikes), not an instant loss.
    const gap = ri(110, 200);
    spikePit(x, GY + 2, gap);
    coin(x + gap / 2, GY - 150, 10);            // reward arc over the pit
    x += gap;

    // next ground segment
    const segW = ri(520, 1080);
    plat(x, GY, segW, GROUND_H);
    const segL = x, segR = x + segW;

    // populate the segment with obstacles (kept off the landing lip + clear of each other)
    let cursor = segL + 120;
    const slots = [];
    while (cursor < segR - 140) { slots.push(cursor); cursor += ri(180, 320); }
    for (const sx of slots) {
      const r = rng();
      if (r < 0.30) riser(sx, ri(34, 60));
      else if (r < 0.52) launcher(sx, -1);       // fires left, toward the incoming player
      else if (r < 0.78) patrol(sx, GY - 30, ri(50, 130), ri(70, 110));
      else coin(sx, GY - 60);                    // a ground coin
    }
    // an elevated coin route above wider segments
    if (segW > 720 && rng() < 0.7) coinArc(segL, segR, GY);
    // a couple of ground-level coins for pace
    coin(segL + segW * 0.4, GY - 64); coin(segL + segW * 0.75, GY - 64);

    x = segR;
  }

  // final safe run + goal (no hazards in the last stretch)
  plat(x, GY, 520, GROUND_H);
  const goalX = x + 360;
  coin(x + 140, GY - 70); coin(x + 240, GY - 70, 15);

  const width = x + 520;
  return {
    tile: 36,
    width: width,
    height: GY + 360,                  // fall-death floor sits well below (height+500)
    groundY: GY,
    spawn: { x: spawnX, y: GY - 60 },
    goal: { x: goalX, y: GY - 108, w: 30, h: 108 },
    platforms: platforms,
    coins: coins,
    hazards: hazards,
    enemies: enemies,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let seed = 7;
let out = "games/lumen-run/content.json";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--seed") seed = parseInt(args[++i], 10);
  else if (args[i] === "--out") out = args[++i];
}
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const outPath = path.isAbsolute(out) ? out : path.join(repoRoot, out);
const content = JSON.parse(fs.readFileSync(outPath, "utf8"));
const level = build(seed);
content.level = level;
fs.writeFileSync(outPath, JSON.stringify(content, null, 2) + "\n");

const counts = {
  platforms: level.platforms.length,
  coins: level.coins.length,
  spikePits: level.hazards.filter((h) => h.kind === "spike").length,
  risers: level.hazards.filter((h) => h.kind === "riser").length,
  launchers: level.hazards.filter((h) => h.kind === "launcher").length,
  enemies: level.enemies.length,
};
console.log("Lumen level written:", outPath);
console.log("  width:", level.width, "(~" + (level.width / 2304).toFixed(1) + "x old) · seed:", seed);
console.log("  " + JSON.stringify(counts));
