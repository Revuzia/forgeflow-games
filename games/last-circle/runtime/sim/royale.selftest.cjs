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

  // quick mode is much shorter; standard is real-BR length. Bounds allow the
  // outrunnable-edge shrink extension (worst seed: standard ~+25s, quick ~+51s).
  const q = new R.Storm({ seed: 42, mode: "quick", half: 800 });
  ok(q.totalS < s1.totalS && q.totalS <= 300, "storm: quick mode timeline ≤ ~5 min of storm");
  ok(s1.totalS >= 540 && s1.totalS <= 820, "storm: standard timeline 9-13.5 min (" + s1.totalS + "s)");

  // OUTRUNNABLE: for every phase of every mode across many seeds, the closing
  // edge's worst-case speed (radius delta + center shift over the effective
  // shrink) never exceeds sprint (8.0) — a caught player can always escape.
  let edgeOk = true, worstEdge = 0;
  for (let seed = 1; seed <= 40; seed++) {
    for (const mode of ["standard", "quick"]) {
      const s = new R.Storm({ seed, mode, half: 800 });
      for (let i = 0; i < s.phases.length; i++) {
        const a = s.circles[i], b = s.circles[i + 1];
        const travel = (a.r - b.r) + Math.hypot(b.x - a.x, b.z - a.z);
        const v = travel / (s.timeline[i].end - s.timeline[i].shrinkStart);
        worstEdge = Math.max(worstEdge, v);
        if (v > 8.0) edgeOk = false;
      }
    }
  }
  ok(edgeOk, "storm: closing edge always outrunnable at sprint (worst " + worstEdge.toFixed(2) + " m/s)");

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

// ── Movement basis ───────────────────────────────────────────────────────────
// The glide derived its strafe axis inline as (cos, +sin) against a ground basis
// of (cos, -sin): not perpendicular, so A/D under the parachute pulled the wrong
// way at every non-cardinal heading. The whole suite passed 46/46 with that bug
// live, so it is asserted here directly.
{
  let worstDot = 0, worstLen = 0;
  for (let i = 0; i < 32; i++) {
    const yaw = (i / 32) * Math.PI * 2;
    const b = R.moveBasis(yaw);
    worstDot = Math.max(worstDot, Math.abs(b.fx * b.rx + b.fz * b.rz));
    worstLen = Math.max(worstLen, Math.abs(Math.hypot(b.fx, b.fz) - 1), Math.abs(Math.hypot(b.rx, b.rz) - 1));
  }
  ok(worstDot < 1e-12, "move basis: forward ⟂ strafe at every yaw (worst dot " + worstDot.toExponential(1) + ")");
  ok(worstLen < 1e-12, "move basis: both axes unit length");
  const b0 = R.moveBasis(0);
  ok(Math.abs(b0.fx) < 1e-12 && Math.abs(b0.fz + 1) < 1e-12, "move basis: yaw 0 faces -Z");
  ok(Math.abs(b0.rx - 1) < 1e-12 && Math.abs(b0.rz) < 1e-12, "move basis: yaw 0 strafes +X");
  // right = forward rotated -90° about Y, at every heading
  const q = R.moveBasis(0.7);
  ok(Math.abs(q.rx - -q.fz) < 1e-12 && Math.abs(q.rz - q.fx) < 1e-12, "move basis: right is forward rotated -90°");
}

// ── Swept collision (cover has to stop bullets) ──────────────────────────────
// Bullets used to test only whether a sub-step's END POINT sat inside a box.
// Sub-steps run up to 2.5 m, so a 0.32 m wall was missed ~87% of the time and
// ramps were skipped outright. These assert the sweep, at the real dimensions.
{
  const wall = { kind: "box", minX: -0.16, maxX: 0.16, minY: 0, maxY: 3, minZ: -5, maxZ: 5 };
  const through = R.segmentBox(-1.25, 1.5, 0, 1.25, 1.5, 0, wall);   // a full 2.5 m sub-step
  ok(!!through, "sweep: a 2.5m step across a 0.32m wall is blocked (endpoint test missed this)");
  ok(through && through.nx === -1 && through.ny === 0 && through.nz === 0, "sweep: normal is the ENTRY face");
  ok(through && Math.abs(through.t - 0.436) < 0.01, "sweep: entry fraction lands on the near face");
  ok(R.segmentBox(-1.25, 4, 0, 1.25, 4, 0, wall) === null, "sweep: a shot over the wall misses");
  ok(R.segmentBox(-1.25, 1.5, 0, -0.5, 1.5, 0, wall) === null, "sweep: a shot stopping short misses");
  ok(R.segmentBox(-1.25, 1.5, 9, 1.25, 1.5, 9, wall) === null, "sweep: a shot past the wall's end misses");
  // inside-out: a projectile born inside a box reports t=0
  const inside = R.segmentBox(0, 1.5, 0, 2, 1.5, 0, wall);
  ok(inside && inside.t === 0, "sweep: a segment starting inside reports t=0");

  const ramp = { kind: "ramp", dir: 0, minX: 0, maxX: 4, minY: 0, maxY: 3, minZ: -2, maxZ: 2 };
  ok(Math.abs(R.rampTopAt(ramp, 2, 0) - 1.5) < 1e-9, "ramp: surface is half height at half length");
  ok(Math.abs(R.rampTopAt(ramp, -5, 0) - 0) < 1e-9, "ramp: clamps below the low end");
  ok(Math.abs(R.rampTopAt(ramp, 99, 0) - 3) < 1e-9, "ramp: clamps above the high end");
  ok(!!R.segmentRamp(-1, 0.5, 0, 5, 0.5, 0, ramp), "ramp: a shot into the slope is blocked (was skipped entirely)");
  ok(R.segmentRamp(-1, 3.5, 0, 5, 3.5, 0, ramp) === null, "ramp: a shot clearing the slope passes");

  // nearest-wins across a mixed collider list
  const far = { kind: "box", minX: 2, maxX: 3, minY: 0, maxY: 3, minZ: -5, maxZ: 5 };
  const best = R.segmentColliders(-1.25, 1.5, 0, 4, 1.5, 0, [far, wall]);
  ok(best && best.c === wall, "sweep: nearest collider wins regardless of list order");
  ok(R.segmentColliders(-1.25, 4, 0, 4, 4, 0, [far, wall]) === null, "sweep: clean miss returns null");
  ok(R.segmentColliders(-1.25, 1.5, 0, 4, 1.5, 0, [{ kind: "box", dead: true, minX: -1, maxX: 1, minY: 0, maxY: 3, minZ: -5, maxZ: 5 }]) === null,
     "sweep: destroyed colliders are ignored");
}

// ── Spread model ─────────────────────────────────────────────────────────────
// fire() computed spread inline and the crosshair guessed with a DIFFERENT
// formula, so the reticle never showed crouch, airborne, rarity, first-shot
// accuracy, or even the weapon's own base spread. Both read effectiveSpread now,
// so these assertions pin the exact behaviour fire() had before the extraction.
{
  const E = (id, rar, st) => R.effectiveSpread(id, rar, st);
  const still = { ads: false, moving: false, airborne: false, crouching: false, sinceLastShotS: 0 };
  const S = (o) => Object.assign({}, still, o);

  // base = spreadDeg x rarity multiplier
  ok(approx(E("ar", 0, S({})), 1.5), "spread: AR common base is 1.5deg");
  ok(approx(E("ar", 4, S({})), 1.5 * R.RARITY_SPREAD_MULT[4]), "spread: legendary tightens by the rarity table");
  ok(approx(E("shotgun", 0, S({})), 4.0), "spread: shotgun base is 4.0deg (a sniper is 0.15 - they must NOT draw alike)");
  ok(approx(E("sniper", 0, S({})), 0.15), "spread: sniper base is 0.15deg");

  // stance modifiers, each isolated
  ok(approx(E("ar", 0, S({ ads: true })), 1.5 * 0.5), "spread: ADS halves it");
  // movement penalty is GRADED BY SPEED now: sprinting must cost more than
  // walking, or sprint is free and walking is a strictly dominated state
  ok(approx(E("ar", 0, S({ speed: 0 })), 1.5), "spread: standing still has no movement penalty");
  ok(approx(E("ar", 0, S({ speed: 6 })), 1.5 * 1.45), "spread: walking (6 m/s) costs 1.45x");
  ok(approx(E("ar", 0, S({ speed: 9.6 })), 1.5 * 1.72), "spread: sprinting (9.6 m/s) costs 1.72x");
  ok(E("ar", 0, S({ speed: 9.6 })) > E("ar", 0, S({ speed: 6 })),
     "spread: sprinting is strictly worse than walking (walking is no longer dominated)");
  ok(E("ar", 0, S({ speed: 2.7 })) < E("ar", 0, S({ speed: 6 })),
     "spread: crouch-walk pace is tighter than a full walk");
  ok(approx(E("ar", 0, S({ speed: 40 })), 1.5 * 1.8), "spread: movement penalty caps at 1.8x");
  ok(approx(E("ar", 0, S({ moving: true })), 1.5 * 1.45), "spread: legacy moving:true maps to walk speed");
  ok(approx(E("ar", 0, S({ airborne: true })), 1.5 * 2), "spread: airborne costs 2x");
  ok(approx(E("ar", 0, S({ crouching: true })), 1.5 * R.CROUCH.spreadMult), "spread: crouch applies CROUCH.spreadMult");
  ok(E("ar", 0, S({ crouching: true })) < E("ar", 0, S({})), "spread: crouching is strictly tighter than standing");

  // first-shot accuracy: the biggest term, and shotguns are excluded
  ok(approx(E("ar", 0, S({ sinceLastShotS: 1 })), 1.5 * 0.15), "spread: first shot standing still is 0.15x");
  ok(approx(E("shotgun", 0, S({ sinceLastShotS: 1 })), 4.0), "spread: shotguns get NO first-shot bonus");
  ok(approx(E("ar", 0, S({ sinceLastShotS: 1, speed: 6 })), 1.5 * 1.45), "spread: moving forfeits the first-shot bonus");
  ok(approx(E("ar", 0, S({ sinceLastShotS: 1, speed: 0.3 })), 1.5 * (1 + 0.3 * 0.075) * 0.15),
     "spread: a slow creep still keeps the first-shot bonus (tolerance, not exact-equals)");
  ok(approx(E("ar", 0, S({ sinceLastShotS: 1, airborne: true })), 1.5 * 2), "spread: airborne forfeits the first-shot bonus");

  // combined, exactly as fire() chained them
  ok(approx(E("ar", 2, S({ ads: true, speed: 6, crouching: true })),
            1.5 * R.RARITY_SPREAD_MULT[2] * 0.5 * 1.45 * R.CROUCH.spreadMult),
     "spread: modifiers compose in the original order");
  ok(E("ar", 0, S({})) > 0 && E("glauncher", 0, S({})) > 0, "spread: every weapon returns a positive cone");
  ok(R.effectiveSpread("nonexistent", 0, S({})) === 1, "spread: unknown weapon falls back to 1deg, never NaN");
}

// -- heal tempo cost (owner direction 2026-07-21) ---------------------------
// Using a medkit/shield must SLOW you and must lock sprint out for the channel.
// Healing was previously free at full sprint: no cost, no tell, no counterplay.
{
  ok(R.HEAL && typeof R.HEAL.speedMult === "number", "heal: HEAL constant is exported from the sim");
  ok(R.HEAL.speedMult > 0 && R.HEAL.speedMult < 1, "heal: slows you but never freezes you in place");
  ok(R.HEAL.blocksSprint === true, "heal: sprint is locked out for the channel");
  ok(R.MOVE.walk * R.HEAL.speedMult < R.MOVE.walk, "heal: healing walk is slower than a normal walk");
  ok(R.MOVE.walk * R.HEAL.speedMult < R.MOVE.sprint, "heal: healing can never out-pace a sprint");
  ok(R.MOVE.walk * R.HEAL.speedMult > 1.0, "heal: you can still walk to cover, not rooted");
  ok(R.MOVE.walk * R.HEAL.speedMult * R.CROUCH.speedMult > 0, "heal: crouch-healing stays positive");
}

// -- sprint (owner direction 2026-07-28: INFINITE, meterless) ----------------
// The 07-22 stamina meter was deliberately reversed: sprint never runs out,
// nothing on screen says you are sprinting. Storm escape now depends only on
// MOVE.sprint vs the (capped) storm edge speed.
{
  ok(R.STAMINA === undefined, "sprint: STAMINA system fully removed from the sim");
  ok(R.MOVE.sprint > R.MOVE.walk * 1.2, "sprint: still meaningfully faster than walking");
  ok(R.MOVE.sprint <= 9.0, "sprint: speed reined in from the 9.6 that outran the camera");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
