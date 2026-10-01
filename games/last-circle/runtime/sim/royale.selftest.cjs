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
  ok(approx(st0.radius, 800 * 1.0, 0.01), "storm: initial radius = startRadiusFrac × half");

  // mid-shrink of phase 1: radius strictly between start and target
  const p0 = R.STORM_PHASES.standard[0];
  const stMid = s1.stateAt(p0.wait + p0.shrink / 2);
  ok(stMid.phaseState === "closing" && stMid.dps === p0.dps, "storm: mid phase-1 shrink closing at phase dps");
  ok(stMid.radius < 800 * 1.0 && stMid.radius > 800 * p0.radiusFrac, "storm: radius interpolates during shrink");

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
  ok(q.totalS < s1.totalS && q.totalS <= 420, "storm: quick mode timeline ≤ ~7 min of storm");
  ok(s1.totalS >= 780 && s1.totalS <= 960, "storm: standard timeline 13-16 min (" + s1.totalS + "s)");

  // ── GENRE PACING (researched 2026-08-20 against Fortnite / PUBG / Apex) ────
  // The opening circle must be a stroll, not a chase: Apex ring 1 closes at
  // 54-55% of sprint and consumes ~28% of the match. Ours was 78% of sprint in
  // 18% of the match — the reported "shrinks too fast".
  {
    const SPRINT = R.MOVE.sprint;
    let worstFrac = 0, ph1Frac = 0, coversCorners = true;
    for (let seed = 1; seed <= 40; seed++) {
      const s = new R.Storm({ seed, mode: "standard", half: 800 });
      // Opening ring must contain every metre of LAND. isla_viva's islandMask
      // reaches zero at 0.893 * half, so 750 m is a real margin past the last
      // beach; the square's corners beyond that are open ocean by construction.
      if (s.circles[0].r < 750) coversCorners = false;
      for (let i = 0; i < s.phases.length; i++) {
        const a = s.circles[i], b = s.circles[i + 1], tl = s.timeline[i];
        const travel = (a.r - b.r) + Math.hypot(b.x - a.x, b.z - a.z);
        const f = (travel / (tl.end - tl.shrinkStart)) / SPRINT;
        if (f > worstFrac) worstFrac = f;
        if (i === 0 && f > ph1Frac) ph1Frac = f;
      }
    }
    ok(coversCorners, "storm: opening zone contains all land (island ends at 0.893*half)");
    ok(ph1Frac <= 0.55, "storm: opening circle closes at <=55% of sprint, Apex-style (" + (ph1Frac * 100).toFixed(0) + "%)");
    ok(worstFrac <= 0.80, "storm: no phase ever closes faster than 80% of sprint (" + (worstFrac * 100).toFixed(0) + "%)");
    const ph1Share = s1.timeline[0].end / s1.totalS;
    ok(ph1Share >= 0.22 && ph1Share <= 0.36, "storm: phase 1 is ~a quarter to a third of the match, like Apex ring 1 (" + (ph1Share * 100).toFixed(0) + "%)");
    // The opening ring must be ON the map, not off it: if it starts outside the
    // map bounds the player watches nothing move, then sees the whole visible
    // collapse compressed into the tail of the phase.
    ok(s1.circles[0].r <= 800 * 1.02, "storm: opening ring is on-map, so the whole first shrink is visible");
    ok(s1.stateAt(1).nextRadius > 0, "storm: next circle is shown from the start (Fortnite/PUBG convention)");
  }

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
  // SIDEARM LADDER (owner 2026-07-28 + CoD/FN research): the spawn pistol must
  // never rival the AR — ~80% of its DPS, tighter falloff, milder head bonus.
  {
    const dps = (id) => R.WEAPONS[id].damage * (R.WEAPONS[id].pellets || 1) * R.WEAPONS[id].rpm / 60;
    ok(dps("pistol") <= dps("ar") * 0.85, "ladder: pistol DPS ≤ 85% of AR (" + dps("pistol").toFixed(0) + " vs " + dps("ar").toFixed(0) + ")");
    ok(dps("smg") > dps("ar"), "ladder: SMG out-DPSes AR up close");
    ok(R.WEAPONS.pistol.falloff[1] < R.WEAPONS.ar.falloff[0], "ladder: pistol reach ends before AR falloff even begins");
    ok(R.WEAPONS.pistol.headMult <= 1.75, "ladder: pistol head bonus ≤ 1.75 (laser first-shot accuracy pays the FN 2.0 back)");
  }
  ok(R.hitDamage("ar", 4, 10, false) === Math.round(30 * 1.32), "damage: legendary AR +32%");
  // ── DAMAGE RANGE (owner 2026-09-15: "damage ... is within a RANGE of damage,
  // which makes sense for that specific weapon") ────────────────────────────
  {
    // omitting the roll must stay EXACTLY nominal — every legacy caller and the
    // assertions above depend on it
    ok(R.hitDamage("ar", 0, 10, false) === R.hitDamage("ar", 0, 10, false, 0.5),
       "dmg range: no roll == the midpoint roll (nominal is the centre)");
    const lo = R.hitDamage("ar", 0, 10, false, 0);
    const hi = R.hitDamage("ar", 0, 10, false, 1);
    ok(lo < 30 && hi > 30 && lo === Math.round(30 * 0.92) && hi === Math.round(30 * 1.08),
       "dmg range: AR swings +/-8% (" + lo + "-" + hi + ")");
    // the spread must READ as the weapon: a sniper is a precision instrument,
    // a shotgun is the loosest thing in the game
    ok(R.DMG_SPREAD.sniper < R.DMG_SPREAD.ar, "dmg range: sniper tighter than AR");
    ok(R.DMG_SPREAD.ar < R.DMG_SPREAD.smg, "dmg range: AR tighter than SMG");
    ok(R.DMG_SPREAD.smg < R.DMG_SPREAD.shotgun, "dmg range: SMG tighter than shotgun");
    // every weapon still ranges, and never collapses to zero on a graze
    let allRange = true, everZero = false;
    for (const id of R.WEAPON_IDS) {
      const a = R.hitDamage(id, 0, 0, false, 0), b = R.hitDamage(id, 0, 0, false, 1);
      if (!(b > a)) allRange = false;
      for (let r = 0; r <= 1.0001; r += 0.1) {
        if (R.hitDamage(id, 0, 9999, false, r) < 1) everZero = true;
      }
    }
    ok(allRange, "dmg range: every weapon has a real min<max band");
    ok(!everZero, "dmg range: a hit that connects never rounds down to 0 damage");
    // rolls stay inside the band no matter what is passed in
    const clampedLo = R.hitDamage("ar", 0, 10, false, -5);
    const clampedHi = R.hitDamage("ar", 0, 10, false, 99);
    ok(clampedLo === lo && clampedHi === hi, "dmg range: out-of-range rolls clamp to the band");
  }

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
  // 2026-09 loot economy: guns are 55% of floor rolls (was 45%) — see royale.js
  ok(weapons > N * 0.50 && weapons < N * 0.60, "loot: ~55% of floor spawns are guns (" + weapons + "/" + N + ")");
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
// ── Floor loot economy (audit 2026-09: 74.8% of bot lives ended on the pistol) ──
// A floor gun always lies with its own ammo (1-2 boxes, as rollChest already did);
// the companion rides as ONE item and is stripped off the gun by rollFloorSpawn.
{
  const rng = R.mulberry32(4242);
  let guns = 0, withComp = 0, compOk = true, boxesSeen = new Set(), pistols = 0;
  for (let i = 0; i < 4000; i++) {
    const it = R.rollFloorItem(rng);
    if (it.kind !== "weapon") { if (it.companions) compOk = false; continue; }
    guns++;
    if (it.id === "pistol") pistols++;
    const want = R.WEAPONS[it.id].ammo;
    if (!it.companions || it.companions.length !== 1) { compOk = false; continue; }
    withComp++;
    const c = it.companions[0];
    const box = R.AMMO[want].box;
    if (c.kind !== "ammo" || c.id !== want || !(c.count === box || c.count === box * 2)) compOk = false;
    boxesSeen.add(c.count / box);
  }
  ok(guns > 0 && withComp === guns, "floor loot: every floor gun has an ammo companion (" + withComp + "/" + guns + ")");
  ok(compOk, "floor loot: the companion is the gun's OWN ammo type, 1 or 2 boxes");
  ok(boxesSeen.has(1) && boxesSeen.has(2), "floor loot: both 1-box and 2-box companions occur");
  ok(pistols / guns < 0.12, "floor loot: floor pistols are rare (everyone spawns with one) (" + (100 * pistols / guns).toFixed(1) + "%)");

  // rollFloorSpawn: flat list, companion stripped off the gun, same rng draws
  const a = R.rollFloorSpawn(R.mulberry32(99)), b = R.rollFloorSpawn(R.mulberry32(99));
  ok(JSON.stringify(a) === JSON.stringify(b), "floor loot: rollFloorSpawn is seeded/deterministic");
  let flatOk = true, sawPair = false;
  const r2 = R.mulberry32(7);
  for (let i = 0; i < 500; i++) {
    const sp = R.rollFloorSpawn(r2);
    if (sp[0].companions) flatOk = false;
    if (sp[0].kind === "weapon") { if (sp.length !== 2 || sp[1].kind !== "ammo") flatOk = false; else sawPair = true; }
    else if (sp.length !== 1) flatOk = false;
  }
  ok(flatOk && sawPair, "floor loot: rollFloorSpawn = [gun, its ammo] or [item], never a companion left on the gun");

  // a floor point is a pile: expected rolls per point ~1.1 standard, more in quick
  const r3 = R.mulberry32(11);
  let n1 = 0, nq = 0;
  for (let i = 0; i < 4000; i++) { n1 += R.floorRollCount(r3, R.MODE.standard.lootMult); nq += R.floorRollCount(r3, R.MODE.quick.lootMult); }
  ok(n1 / 4000 > 1.0 && n1 / 4000 < 1.2, "floor loot: ~1.1 rolls per standard floor point (" + (n1 / 4000).toFixed(2) + ")");
  ok(nq > n1, "floor loot: quick mode (lootMult 1.8) is richer than standard");
  // guns per floor point, standard: the census target is >= 3 guns per player
  ok((n1 / 4000) * 0.55 > 0.55, "floor loot: > 0.55 guns per floor point (" + ((n1 / 4000) * 0.55).toFixed(2) + ")");
}

// ── Range-aware weapon value (bots' weapon choice) ───────────────────────────
// Time-to-kill from the weapon tables. The old raw-DPS choice (pistol 133 vs sniper
// 61) swapped every sniper back to the pistol; these pin the ranges the tables give.
{
  const V = (id, d, o) => R.gunValueAt(id, 0, d, o);
  ok(V("sniper", 60) > V("pistol", 60), "value: sniper beats the pistol at 60 m (" + V("sniper", 60).toFixed(1) + " vs " + V("pistol", 60).toFixed(1) + ")");
  ok(V("sniper", 120) > V("pistol", 120), "value: sniper beats the pistol at 120 m");
  ok(V("pistol", 10) > V("sniper", 10), "value: pistol beats the sniper at 10 m (full-EHP target)");
  ok(V("shotgun", 5) > V("pistol", 5) && V("shotgun", 5) > V("ar", 5), "value: shotgun is the point-blank gun");
  ok(V("ar", 50) > V("smg", 50) && V("ar", 50) > V("pistol", 50), "value: AR owns mid range");
  ok(V("glauncher", 60) === 0, "value: launcher is worthless past its ~40 m reach");
  ok(V("glauncher", 30) > V("pistol", 30), "value: launcher beats the pistol at 30 m (mid range)");
  ok(V("glauncher", 3) < V("glauncher", 15), "value: launcher is penalised point blank (self splash)");
  ok(V("sniper", 20, { ehp: 30 }) > V("pistol", 20, { ehp: 30 }), "value: a one-shot on a 30 EHP target at 20 m favours the sniper");
  ok(V("ar", 30, { mag: 0, reserve: 0 }) === 0, "value: a dry gun is worth nothing");
  ok(V("ar", 30, { mag: 0, reserve: 60 }) < V("ar", 30), "value: an empty mag costs its reload");
  // ammo that runs out before the kill still counts for the share of it it delivers
  // (it used to be a flat 0.01 cliff that handed every long fight to the pistol)
  const lim = R.gunValueAt("ar", 0, 60, { mag: 30, reserve: 0, aimDeg: 3 }), full = R.gunValueAt("ar", 0, 60, { aimDeg: 3 });
  ok(lim > 0.5 && lim < full, "value: a short magazine is worth its share of the kill, not nothing (" + lim.toFixed(2) + " < " + full.toFixed(2) + ")");
  ok(R.gunValueAt("ar", 0, 40, { mag: 30, reserve: 20, aimDeg: 3 }) > R.gunValueAt("pistol", 0, 40, { mag: 16, reserve: 200, aimDeg: 3 }),
     "value: 50 rifle rounds beat a pistol with 216 at 40 m for a 3 deg hand");
  let monoAmmo = true;
  for (const id of R.WEAPON_IDS) for (const d of [10, 40, 90]) {
    let prev = -1;
    for (const rsv of [0, 5, 20, 60, 200, 2000]) { const v = R.gunValueAt(id, 0, d, { mag: 1, reserve: rsv, aimDeg: 2.5 }); if (v < prev - 1e-9) monoAmmo = false; prev = v; }
  }
  ok(monoAmmo, "value: more ammo never makes a gun worth less");
  ok(R.gunValueAt("sniper", 4, 60) > V("sniper", 60), "value: rarity helps");
  let finite = true;
  for (const id of R.WEAPON_IDS) for (const d of [0, 1, 7, 33, 90, 250, 900]) { const v = V(id, d); if (!(v >= 0 && isFinite(v))) finite = false; }
  ok(finite, "value: always finite and >= 0");
  // aimDeg = the shooter's own aim error (bots pass their tier's). A shakier hand
  // never makes a gun BETTER, and once the wobble swamps the cones the fire rate
  // decides: the SMG at least matches the pistol from 10 to 40 m for a ~3 deg hand
  // (a tier-2 bot: aimErrDeg 4.5 x 0.7 RMS).
  let mono = true;
  for (const id of R.WEAPON_IDS) for (const d of [5, 15, 30, 60]) {
    if (R.gunValueAt(id, 0, d, { aimDeg: 3 }) > R.gunValueAt(id, 0, d, { aimDeg: 1 }) + 1e-9) mono = false;
  }
  ok(mono, "value: more aim error never raises a gun's value");
  let smgOk = true;
  for (const aim of [3, 4]) for (const d of [10, 15, 20, 25, 30, 40]) {
    if (R.gunValueAt("smg", 0, d, { aimDeg: aim }) < R.gunValueAt("pistol", 0, d, { aimDeg: aim })) smgOk = false;
  }
  ok(smgOk, "value: for a 3-4 deg hand the SMG >= the pistol from 10 to 40 m");
  ok(R.gunValueAt("ar", 0, 30) === R.gunValueAt("ar", 0, 30, { aimDeg: 1.0 }), "value: aimDeg omitted = the 1 deg default");
}

// ── moveBasis out-param (per-frame callers pass a scratch object) ────────────
{
  let parity = true, same = true;
  const out = { fx: 9, fz: 9, rx: 9, rz: 9 };
  for (let i = 0; i < 64; i++) {
    const yaw = -7 + i * 0.23;
    const a = R.moveBasis(yaw), b = R.moveBasis(yaw, out);
    if (b !== out) same = false;
    if (a.fx !== b.fx || a.fz !== b.fz || a.rx !== b.rx || a.rz !== b.rz) parity = false;
  }
  ok(parity, "move basis: out-param result is bit-identical to the returned object");
  ok(same, "move basis: out-param returns the SAME object (no allocation)");
}

// ── segmentBox rewrite parity (scalars instead of 5 arrays per call) ─────────
{
  function refSegmentBox(ax, ay, az, bx, by, bz, box) {   // the pre-2026-09 implementation, verbatim
    var o = [ax, ay, az], d = [bx - ax, by - ay, bz - az];
    var lo = [box.minX, box.minY, box.minZ], hi = [box.maxX, box.maxY, box.maxZ];
    var tmin = 0, tmax = 1, axis = -1;
    for (var i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) return null; continue; }
      var inv = 1 / d[i];
      var t1 = (lo[i] - o[i]) * inv, t2 = (hi[i] - o[i]) * inv;
      if (t1 > t2) { var sw = t1; t1 = t2; t2 = sw; }
      if (t1 > tmin) { tmin = t1; axis = i; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    var n = [0, 0, 0];
    if (axis >= 0) n[axis] = d[axis] > 0 ? -1 : 1;
    return { t: tmin, tExit: tmax, nx: n[0], ny: n[1], nz: n[2] };
  }
  const rng = R.mulberry32(2026);
  const box = { minX: -1, maxX: 1.5, minY: 0, maxY: 3, minZ: -0.2, maxZ: 0.2 };
  let same = 0, hits = 0, N = 20000;
  for (let i = 0; i < N; i++) {
    const q = () => (rng() - 0.5) * 8;
    const ax = q(), ay = q() + 1.5, az = q(), flat = rng() < 0.2;
    const bx = flat ? ax : q(), by = rng() < 0.2 ? ay : q() + 1.5, bz = q();
    const A = refSegmentBox(ax, ay, az, bx, by, bz, box), B = R.segmentBox(ax, ay, az, bx, by, bz, box);
    if (JSON.stringify(A) === JSON.stringify(B)) same++;
    if (B) hits++;
  }
  ok(same === N && hits > N * 0.1, "sweep: scalar segmentBox is identical to the old array version (" + same + "/" + N + ", " + hits + " hits)");
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

// ── Skill bands + fractional tiers ───────────────────────────────────────────
// The lobby's difficulty is picked from the account skill rating. Every band has
// to sum to 49 (the draw and the lobby size both depend on it), the bands have to
// be strictly ordered, and the ramp's fractional tiers have to interpolate rather
// than snap.
{
  const sum = (a) => a.reduce((x, c) => x + c, 0);
  let bandsOk = true, orderOk = true, softOk = true, last = -1;
  for (let i = 0; i < R.BOT_TIER_BANDS.length; i++) {
    const b = R.BOT_TIER_BANDS[i];
    if (sum(b) !== 49) bandsOk = false;
    const mean = R.mixRating(b);
    if (mean <= last) orderOk = false;
    last = mean;
    // the owner's call: most of every lobby sits in tiers 3-5
    if (sum(b.slice(2)) / 49 < 0.65) softOk = false;
  }
  ok(bandsOk, "bots: every skill band sums to 49");
  ok(orderOk, "bots: skill bands are strictly ordered easy -> hard");
  ok(softOk, "bots: even the softest band keeps >=65% of the lobby in tiers 3-5");

  let mixSumOk = true, mixOrderOk = true, prev = -1;
  for (let i = 0; i <= 10; i++) {
    const m = R.skillMix(i / 10);
    if (sum(m) !== 49) mixSumOk = false;
    const r = R.mixRating(m);
    if (r < prev - 1e-9) mixOrderOk = false;
    prev = r;
  }
  ok(mixSumOk, "bots: skillMix always sums to 49 across the whole 0-1 range");
  ok(mixOrderOk, "bots: skillMix difficulty rises monotonically with skill");

  const mid = R.interpTierK(3.5);
  ok(mid.aimErrDeg < R.BOT_TIERS[2].aimErrDeg && mid.aimErrDeg > R.BOT_TIERS[3].aimErrDeg,
     "bots: fractional tier interpolates aim error between table rows");
  ok(mid.reactionMs < R.BOT_TIERS[2].reactionMs && mid.reactionMs > R.BOT_TIERS[3].reactionMs,
     "bots: fractional tier interpolates reaction time between table rows");
  // the ramp rounds to an int tier, which indexes HEAD_CHANCE — it must never
  // reach a 6th row that does not exist
  ok(Math.round(R.interpTierK(5).aimErrDeg * 100) === Math.round(R.BOT_TIERS[4].aimErrDeg * 100),
     "bots: tier 5 is the ceiling — interpolation never runs past the table");
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

// -- L6F (2026-10-01): tracking miss in the value model + storm state memo ----
// trackM is the LINEAR miss a turn-lagging shooter has against a strafing target
// (bots.js: lateral speed / steer rate). It must default to 0 (every older caller
// unchanged), can only lower a value, and shrinks the pistol's tight-cone edge
// over the SMG (bots.js still overrides the model for the pistol: measured bot
// damage per engaged second puts every primary above it - see chooseGun).
{
  const o = (extra) => Object.assign({ aimDeg: 0.85, speed: 6, ehp: 150 }, extra || {});
  ok(R.gunValueAt("ar", 0, 30, o()) === R.gunValueAt("ar", 0, 30, o({ trackM: 0 })), "value: trackM omitted = 0 (callers without it unchanged)");
  let monoT = true;
  for (const id of R.WEAPON_IDS) for (const d of [5, 20, 45, 90]) {
    let prev = Infinity;
    for (const tm of [0, 0.3, 0.85, 1.5]) { const v = R.gunValueAt(id, 0, d, o({ trackM: tm })); if (v > prev + 1e-9) monoT = false; prev = v; }
  }
  ok(monoT, "value: a larger tracking miss never raises a gun's value");
  const ratio = (tm) => R.gunValueAt("smg", 0, 35, o({ trackM: tm })) / R.gunValueAt("pistol", 0, 35, o({ trackM: tm }));
  ok(ratio(0.85) > ratio(0), "value: a tracking miss narrows the pistol's cone advantage over the SMG");
  // stateAt memo: same t -> same object and same numbers; new t -> a fresh object
  const sm = new R.Storm({ seed: 5, mode: "standard", half: 784 });
  const a1 = sm.stateAt(150), a2 = sm.stateAt(150);
  const raw = sm._stateAt(150);
  ok(a1 === a2, "storm: a repeated t is answered from the memo (no new objects)");
  ok(a1.radius === raw.radius && a1.center.x === raw.center.x && a1.phase === raw.phase && a1.dps === raw.dps, "storm: the memo holds the exact state");
  const b1 = sm.stateAt(151);
  ok(b1 !== a1 && a1.radius === raw.radius, "storm: a new t builds a new object and never changes one handed out before");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
