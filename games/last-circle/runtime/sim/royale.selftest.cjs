/**
 * Node self-test for sim/royale.js — asserts the defining BR mechanics.
 * Run: node games/last-circle/runtime/sim/royale.selftest.cjs
 * Exit 0 = all pass, exit 1 = a failure.
 *
 * .cjs so it's CommonJS even though the package is "type":"module".
 */
"use strict";
const _req = require("./royale.js");
const R = _req.Storm ? _req : (globalThis.FFG && globalThis.FFG.sim && globalThis.FFG.sim.Royale);
if (!R || typeof R.Storm !== "function") { console.error("FAIL: could not load Royale sim module"); process.exit(1); }

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  PASS  " + msg); }
  else { failed++; console.error("  FAIL  " + msg); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps == null ? 1e-6 : eps); }

// ── RNG determinism ──────────────────────────────────────────────────────────
{
  const a = R.mulberry32(1234), b = R.mulberry32(1234);
  ok(a() === b() && a() === b(), "mulberry32: same seed → same sequence");
}

// ── Storm ────────────────────────────────────────────────────────────────────
{
  const s1 = new R.Storm({ seed: 42, mode: "standard", half: 800 });
  const s2 = new R.Storm({ seed: 42, mode: "standard", half: 800 });
  ok(JSON.stringify(s1.circles) === JSON.stringify(s2.circles), "storm: same seed → identical circle plan");

  const s3 = new R.Storm({ seed: 43, mode: "standard", half: 800 });
  ok(JSON.stringify(s1.circles) !== JSON.stringify(s3.circles), "storm: different seed → different plan");

  const st0 = s1.stateAt(0);
  ok(st0.phaseState === "waiting" && st0.dps === 0, "storm: t=0 waiting, no damage");
  ok(approx(st0.radius, 800 * 1.35, 0.01), "storm: initial radius = startRadiusFrac × half");

  // mid-shrink of phase 1: radius strictly between start and target
  const p0 = R.STORM_PHASES.standard[0];
  const stMid = s1.stateAt(p0.wait + p0.shrink / 2);
  ok(stMid.phaseState === "closing" && stMid.dps === p0.dps, "storm: mid phase-1 shrink closing at phase dps");
  ok(stMid.radius < 800 * 1.35 && stMid.radius > 800 * p0.radiusFrac, "storm: radius interpolates during shrink");

  // circles are nested: every next circle inside previous
  let nested = true;
  for (let i = 1; i < s1.circles.length; i++) {
    const a = s1.circles[i - 1], b = s1.circles[i];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d + b.r > a.r + 1e-6) nested = false;
  }
  ok(nested, "storm: every circle fully inside its predecessor");

  // end state: done, dps = final phase, tiny NON-ZERO final circle (a fight
  // must be winnable — r=0 storm-killed all survivors at once)
  const stEnd = s1.stateAt(s1.totalS + 10);
  ok(stEnd.done && stEnd.dps === 12 && stEnd.radius > 0 && stEnd.radius < 25, "storm: final circle holds small but non-zero at dps 12");

  // damage outside vs inside
  const tShrunk = s1.timeline[2].end + 1; // after phase 3 fully closed
  const st3 = s1.stateAt(tShrunk);
  const outX = st3.center.x + st3.radius + 50;
  ok(s1.damageAt(tShrunk, outX, st3.center.z) > 0, "storm: damages outside the circle");
  ok(s1.damageAt(tShrunk, st3.center.x, st3.center.z) === 0, "storm: safe inside the circle");

  // quick mode is shorter
  const q = new R.Storm({ seed: 42, mode: "quick", half: 800 });
  ok(q.totalS < s1.totalS && q.totalS <= 210, "storm: quick mode timeline ≤ 3.5 min of storm");

  // practice = no storm
  const pr = new R.Storm({ seed: 42, mode: "practice", half: 800 });
  ok(pr.stateAt(9999).dps === 0 && pr.stateAt(9999).tToNext === Infinity, "storm: practice mode never damages");
}

// ── Damage model ─────────────────────────────────────────────────────────────
{
  ok(R.hitDamage("ar", 0, 10, false) === 30, "damage: AR body at close range = 30");
  ok(R.hitDamage("ar", 0, 10, true) === 45, "damage: AR headshot ×1.5");
  ok(R.hitDamage("ar", 4, 10, false) === Math.round(30 * 1.32), "damage: legendary AR +32%");
  const far = R.hitDamage("ar", 0, 120, false);
  ok(far === Math.round(30 * 0.4), "damage: AR at max falloff = 40% floor");
  const mid = R.hitDamage("ar", 0, 90, false);
  ok(mid < 30 && mid > far, "damage: falloff interpolates");
  ok(R.hitDamage("sniper", 0, 50, true) === Math.round(105 * 2.5), "damage: sniper headshot ×2.5");

  // shield-first
  let r1 = R.applyDamage(100, 100, 45);
  ok(r1.shield === 55 && r1.hp === 100 && !r1.broke && !r1.dead, "applyDamage: shield absorbs first");
  let r2 = R.applyDamage(30, 100, 45);
  ok(r2.shield === 0 && r2.hp === 85 && r2.broke, "applyDamage: overflow to hp + shield break flag");
  let r3 = R.applyDamage(0, 40, 45);
  ok(r3.dead && r3.hp === 0 && r3.dealt === 40, "applyDamage: lethal caps dealt at remaining hp");

  ok(R.splashScale(0, 4) === 1 && R.splashScale(4, 4) === 0 && approx(R.splashScale(2, 4), 0.625), "splash: linear scale to edge");
}

// ── Build grid ───────────────────────────────────────────────────────────────
{
  // grounded = any piece at iy===0
  const g = new R.BuildGrid({ groundedFn: (p) => p.iy === 0 });
  const w1 = g.place("wall", 0, 0, 0, 0, "wood", 0);
  ok(!!w1 && g.pieces.size === 1, "build: place wall");
  ok(g.place("wall", 0, 0, 0, 0, "wood", 0) === null, "build: same slot refuses double place");
  ok(g.place("wall", 0, 0, 0, 1, "wood", 0) !== null, "build: different face same cell ok");

  // hp ramp: at t=0 hp cap = hpStart; after buildS = hpFull
  ok(g.currentMaxHp(w1, 0) === 90, "build: wood starts at 90hp");
  ok(g.currentMaxHp(w1, 4) === 150, "build: wood ramps to 150hp after 4s");

  // ramp/stair share slot
  const g2 = new R.BuildGrid({ groundedFn: (p) => p.iy === 0 });
  ok(g2.place("ramp", 1, 0, 1, 2, "brick", 0) !== null, "build: place ramp");
  ok(g2.place("stair", 1, 0, 1, 0, "wood", 0) === null, "build: stair blocked by ramp in same cell");

  // support cascade: tower of walls; break the base → all above collapse
  const g3 = new R.BuildGrid({ groundedFn: (p) => p.iy === 0 });
  g3.place("wall", 0, 0, 0, 0, "wood", 0);
  g3.place("wall", 0, 1, 0, 0, "wood", 0);
  g3.place("wall", 0, 2, 0, 0, "wood", 0);
  const gone = g3.removePiece(g3.slotKey("wall", 0, 0, 0, 0));
  ok(gone.length === 3 && g3.pieces.size === 0, "build: destroying base cascades the tower (" + gone.length + " pieces)");

  // cascade spares grounded neighbors
  const g4 = new R.BuildGrid({ groundedFn: (p) => p.iy === 0 });
  g4.place("wall", 0, 0, 0, 0, "wood", 0);
  g4.place("wall", 1, 0, 0, 0, "wood", 0); // separate grounded wall
  g4.place("wall", 0, 1, 0, 0, "wood", 0);
  const gone2 = g4.removePiece(g4.slotKey("wall", 0, 0, 0, 0));
  ok(gone2.length === 2 && g4.pieces.size === 1, "build: cascade only kills unsupported chain");

  // damagePiece kills + cascades
  const g5 = new R.BuildGrid({ groundedFn: (p) => p.iy === 0 });
  g5.place("wall", 0, 0, 0, 0, "wood", 0);
  g5.place("wall", 0, 1, 0, 0, "wood", 0);
  const res = g5.damagePiece(g5.slotKey("wall", 0, 0, 0, 0), 999, 0);
  ok(res.destroyed.length === 2, "build: overkill damage destroys + cascades");
  const g6 = new R.BuildGrid({ groundedFn: (p) => p.iy === 0 });
  const p6 = g6.place("wall", 0, 0, 0, 0, "wood", 0);
  g6.damagePiece(p6.slotKey, 30, 0);
  ok(g6.get(p6.slotKey).hp === 60, "build: partial damage reduces hp (90-30=60)");
}

// ── Loot rolls ───────────────────────────────────────────────────────────────
{
  const rng = R.mulberry32(777);
  let weapons = 0, N = 2000;
  const rarCount = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const it = R.rollFloorItem(rng);
    ok2 = true;
    if (it.kind === "weapon" && it.id !== "grenade") { weapons++; rarCount[it.rarity]++; }
  }
  ok(weapons > N * 0.3 && weapons < N * 0.55, "loot: ~42% of floor spawns are guns (" + weapons + "/" + N + ")");
  ok(rarCount[0] > rarCount[4], "loot: commons more frequent than legendaries (" + rarCount.join(",") + ")");

  const rng2 = R.mulberry32(778);
  const chest = R.rollChest(rng2);
  ok(chest.length >= 3 && chest[0].kind === "weapon", "loot: chest = weapon + ammo + extra");
  const sup = R.rollSupplyDrop(R.mulberry32(779));
  ok(sup[0].rarity >= 2, "loot: supply drop weapon is rare+");

  // determinism
  const s1 = JSON.stringify(R.rollChest(R.mulberry32(555)));
  const s2 = JSON.stringify(R.rollChest(R.mulberry32(555)));
  ok(s1 === s2, "loot: seeded rolls deterministic");
}
var ok2;

// ── Match bookkeeping ────────────────────────────────────────────────────────
{
  const m = new R.Match({ players: 4 });
  ["a", "b", "c", "d"].forEach((id) => m.register(id));
  ok(m.aliveCount() === 4, "match: 4 registered");
  m.eliminate("d", "a", "ar", 10);
  m.eliminate("c", "a", "shotgun", 20);
  ok(m.aliveCount() === 2 && m.kills.a === 2, "match: kills tracked");
  ok(m.placementOf("d") === 4 && m.placementOf("c") === 3, "match: placements in elimination order");
  m.eliminate("b", "a", "ar", 30);
  ok(m.over && m.winner === "a" && m.placementOf("a") === 1, "match: last alive wins with placement 1");
  ok(m.feed.length === 3 && m.feed[0].victim === "d", "match: kill feed recorded");
}

// ── Tier mix sanity ──────────────────────────────────────────────────────────
{
  const mix = R.BOT_TIER_MIX.standard;
  ok(mix.reduce((a, b) => a + b, 0) === 49, "bots: standard tier mix sums to 49");
  ok(R.BOT_NAMES.length >= 60, "bots: name pool ≥ 60 (" + R.BOT_NAMES.length + ")");
  ok(R.BOT_TIERS.length === 5 && R.BOT_TIERS[4].aimErrDeg < R.BOT_TIERS[0].aimErrDeg, "bots: higher tier = better aim");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
