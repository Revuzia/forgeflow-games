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

  // quick mode is much shorter; standard is real-BR length (10-12 min of storm)
  const q = new R.Storm({ seed: 42, mode: "quick", half: 800 });
  ok(q.totalS < s1.totalS && q.totalS <= 260, "storm: quick mode timeline ≤ ~4 min of storm");
  ok(s1.totalS >= 540 && s1.totalS <= 780, "storm: standard timeline 9-13 min (" + s1.totalS + "s)");

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

// ── Weapon roster (BR shooter, no melee/building) ────────────────────────────
{
  ok(R.WEAPON_IDS.length === 6, "weapons: exactly 6 lootable guns");
  ok(["pistol", "smg", "ar", "shotgun", "sniper", "glauncher"].every((w) => R.WEAPON_IDS.includes(w)), "weapons: pistol/SMG/AR/shotgun/sniper/grenade-launcher");
  ok(!R.WEAPONS.pickaxe && !R.WEAPONS.rocket && !R.WEAPONS.grenade, "weapons: pickaxe/rocket/hand-grenade removed");
  ok(R.WEAPONS.glauncher.arc && R.WEAPONS.glauncher.splashR > 0 && R.WEAPONS.glauncher.fuseS > 0, "weapons: grenade launcher lobs fused splash rounds");
  ok(!R.BuildGrid && !R.BUILD && !R.MATERIALS, "building: fully removed from the sim");
  ok(R.START_LOADOUT.weapon === "pistol" && R.START_LOADOUT.ammo.light > 0, "loadout: everyone starts with a pistol + ammo");
  ok(R.MOVE.swim > 0 && R.MOVE.swim < R.MOVE.walk, "movement: swim speed exists, slower than walking");
}

// ── Loot rolls ───────────────────────────────────────────────────────────────
{
  const rng = R.mulberry32(777);
  let weapons = 0, mats = 0, N = 2000;
  const rarCount = [0, 0, 0, 0, 0];
  for (let i = 0; i < N; i++) {
    const it = R.rollFloorItem(rng);
    if (it.kind === "weapon") { weapons++; rarCount[it.rarity]++; }
    if (it.kind === "mats") mats++;
  }
  ok(weapons > N * 0.35 && weapons < N * 0.55, "loot: ~45% of floor spawns are guns (" + weapons + "/" + N + ")");
  ok(mats === 0, "loot: no building materials in loot tables");
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
  ok(R.BOT_TIER_MIX.quick.reduce((a, b) => a + b, 0) === 49, "bots: quick tier mix sums to 49");
  ok(R.BOT_NAMES.length >= 60, "bots: name pool ≥ 60 (" + R.BOT_NAMES.length + ")");
  ok(R.BOT_TIERS.length === 5 && R.BOT_TIERS[4].aimErrDeg < R.BOT_TIERS[0].aimErrDeg, "bots: higher tier = better aim");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
