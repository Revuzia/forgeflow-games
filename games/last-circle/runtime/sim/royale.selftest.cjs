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

// ── Bot pacing (owner decision D8, 2026-10-05) ───────────────────────────────
// Every bot match used to end in circle 2 of 8 (264-380 s, 9-21 of 49 dead in the first minute). The fix is a data
// table (BOT_PACE) read by bots.js plus a deliberate x1.12 stretch of the standard storm plan. The browser gate
// _harness/new/sim_pacing.py proves the OUTCOME (median end >= 600 s, <= 12 dead in the first 60 s); these hold the
// table's shape and the storm rules the stretch must not break.
{
  const P = R.BOT_PACE;
  ok(P && typeof P === "object", "pace: the sim exports BOT_PACE");
  const five = (a) => Array.isArray(a) && a.length === 5 && a.every((v) => v > 0);
  const mono = (a) => a.every((v, i) => i === 0 || v >= a[i - 1]);
  ok(five(P.noticeM) && five(P.chaseM), "pace: one notice reach and one chase reach per tier (5 rows)");
  ok(mono(P.noticeM) && mono(P.chaseM), "pace: a sharper tier never notices or chases LESS far than a softer one");
  ok(P.noticeM.every((v, i) => v <= 200 && v >= P.chaseM[i]), "pace: notice reach <= the 200 m perception cap and >= the chase reach (nobody chases what it cannot see)");
  // Wave-5 re-tune (lane F3-pacing, 2026-10-13). The D8 table (notice 70-170 m, chase 45-100 m) had been tuned on the nine runs the
  // gate plays; on 63 matches both Wave 4 and Wave 5 reached circle 5 in only 48 %. Measured one lever at a time over 27 matches,
  // the two that move the end are how far a bot SEES (noticeM x1.3: +37 s) and how far it will CHARGE an unprovoked stranger
  // (chaseM x0.7: +35 s, x1.4: -30 s): a bot that sees him but may not charge trades low-hit fire at range instead of an ambush at
  // 30 m. The rows below are the ones validated on 108 matches (circle 5 in 103, median end 736 s, first-60-s deaths <= 8). The pin is
  // deliberate, like the BOT_TIERS one: changing either row means re-running _harness/new/sim_pacing.py AND a seed sweep wider than
  // its nine runs, then updating this line with the new evidence.
  ok(JSON.stringify(P.noticeM) === "[105,135,165,200,200]" && JSON.stringify(P.chaseM) === "[27,33,39,48,60]",
     "pace: noticeM / chaseM are the Wave-5 re-tuned rows (105-200 m notice, 27-60 m unprovoked chase)");
  ok(P.chaseM.every((v, i) => v <= P.noticeM[i] * 0.5), "pace: a bot sees at least twice as far as it will charge an unprovoked stranger (the stand-off that lengthens matches)");
  ok(P.pushM > 0 && P.pushM <= 250 && P.pushPct > 0 && P.pushPct <= 100, "pace: gunfire is answered inside the 250 m hearing range by a share of the aggressive bots");
  ok(P.dropSepM >= 60 && P.dropSepM <= 200, "pace: landing spots are kept 60-200 m apart");
  ok(P.rotateEdge > 0.5 && P.rotateEdge < 0.95, "pace: rotation aims just INSIDE the next ring, not at its centre or its edge");
  ok(P.endgamePhase >= 4 && P.endgamePhase <= R.STORM_PHASES.standard.length, "pace: the endgame hunt starts in a circle that exists, from circle 4 on");
  ok(P.earlyChutePct > 0 && P.earlyChutePct <= 60, "pace: some bots float down under an early canopy, never most of them (70 % measured worse: 4 of 9 matches reached circle 5)");
  // the owner's 5-tier difficulty curve is untouched by this change (measured: softer rows did not help in combination)
  const T = R.BOT_TIERS;
  ok(T[0].reactionMs === 700 && T[0].aimErrDeg === 7.5 && T[2].reactionMs === 380 && T[2].aimErrDeg === 2.8 && T[4].reactionMs === 210 && T[4].aimErrDeg === 0.9,
     "pace: BOT_TIERS rows are exactly the shipped difficulty curve");
  let tiersOrdered = true;
  for (let i = 1; i < 5; i++) if (!(T[i].aimErrDeg < T[i - 1].aimErrDeg && T[i].reactionMs < T[i - 1].reactionMs)) tiersOrdered = false;
  ok(tiersOrdered, "pace: every tier is faster AND more accurate than the one below it");

  // The stretched plan. The deliberate changes vs the 2026-08-20 plan: every wait and shrink x1.12, so the wall is only
  // ever slower and the hunt (endgamePhase 5) lands at ~673 s instead of 600 s.
  const OLD_SHRINK = [140, 85, 65, 55, 45, 38, 35, 40], OLD_FRAC = [0.78, 0.58, 0.42, 0.28, 0.17, 0.09, 0.04, 0.012], OLD_DPS = [1, 1, 2, 3, 5, 7, 9, 12];
  const ph = R.STORM_PHASES.standard;
  ok(ph.length === 8 && ph.every((p, i) => p.shrink >= OLD_SHRINK[i]), "storm: no standard phase closes FASTER than the pre-D8 plan");
  ok(ph.every((p, i) => p.radiusFrac === OLD_FRAC[i] && p.dps === OLD_DPS[i]), "storm: the stretch left every radius and every dps alone");
  const sp = new R.Storm({ seed: 42, mode: "standard", half: 800 });
  ok(sp.timeline[3].end >= 660 && sp.timeline[3].end <= 700, "storm: circle 5 begins ~673 s (" + sp.timeline[3].end + " s)");
  ok(sp.timeline[0].end > 240 && sp.totalS <= 960, "storm: the plan really is stretched (phase 1 ends " + sp.timeline[0].end + " s) and still inside 16 min (" + sp.totalS + " s)");
  const OLD_QUICK = [[30, 35], [24, 30], [18, 26], [14, 22], [12, 28]];
  const qk = R.STORM_PHASES.quick;
  ok(qk.length === 5 && qk.every((p, i) => p.wait === OLD_QUICK[i][0] && p.shrink === OLD_QUICK[i][1]), "storm: quick mode's plan is untouched by D8");
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

// ── C-RAMP (Wave 5, lane 5C): a ramp is a 0.3 m sloped slab ──────────────────
// Bullets and sight test the PLANK, not the wedge under it (nobody hides
// bullet-proof under a ramp), and the mover blocks the plank's sides and underside
// but still climbs it from the low edge. Dimensions are the real ones: the
// Savanna tower exterior ramp (2.2 m wide, 8.45 m climb), a 2.4 m wide 25 deg stair.
{
  const mk = (dir, minX, maxX, minY, maxY, minZ, maxZ) => ({ kind: "ramp", dir, minX, maxX, minY, maxY, minZ, maxZ, dead: false });
  const ramp = mk(0, 0, 4, 0, 3, -2, 2);                // up-end +X, 36.87 deg
  const hv = R.rampHalfV(ramp);
  ok(approx(R.RAMP_THICK, 0.3), "c-ramp: the plank is the drawn 0.3 m (maps.js addRamp)");
  ok(approx(hv, 0.15 * Math.sqrt(1 + 0.75 * 0.75), 1e-12), "c-ramp: half the vertical thickness is 0.15 / cos(slope) (" + hv.toFixed(4) + " m at 36.87 deg)");
  ok(approx(R.rampHalfV(mk(2, -1, 1, 0, 0, 0, 5)), 0.15, 1e-12), "c-ramp: a flat plank is 0.3 m thick");

  // bullets: the plank is hit, the open wedge under it is not
  const into = R.segmentRamp(-1, 0.5, 0, 5, 0.5, 0, ramp);
  ok(!!into && into.t > 0 && into.ny > 0, "c-ramp: a shot into the slope hits the plank, normal up (" + (into && into.ny.toFixed(3)) + ")");
  ok(into && approx(into.nx * into.nx + into.ny * into.ny + into.nz * into.nz, 1, 1e-12) && into.nx < 0, "c-ramp: the hit normal is the unit plank normal, tilted back against the climb");
  ok(R.segmentRamp(3.5, 1.0, -5, 3.5, 1.0, 0, ramp) === null, "c-ramp: a shot along the ground into the wedge under the plank passes (was blocked: bullet-proof pocket)");
  ok(R.segmentRamp(3.5, 1.0, -5, 3.5, 1.0, 5, ramp) === null, "c-ramp: ...and out the other side");
  ok(R.segmentRamp(3.5, 0.0, 0, 3.5, 4.0, 0, ramp) !== null, "c-ramp: a shot from the ground UP through the plank hits it");
  const up = R.segmentRamp(3.5, 0.0, 0, 3.5, 4.0, 0, ramp);
  ok(up && up.ny < 0 && approx(up.t * 4, 2.625 - hv, 1e-9), "c-ramp: from underneath the normal points down and the hit is the plank's underside (y " + (up && (up.t * 4).toFixed(3)) + ")");
  ok(R.segmentRamp(3.5, 5, 0, 3.5, 0, 0, ramp).ny > 0 && approx(R.segmentRamp(3.5, 5, 0, 3.5, 0, 0, ramp).t * -5 + 5, 2.625 + hv, 1e-9), "c-ramp: from above the hit is the plank's top face");
  ok(R.segmentRamp(-1, 3.5, 0, 5, 3.5, 0, ramp) === null, "c-ramp: a shot clearing the high end passes");
  ok(R.segmentRamp(-3, 0.3, 0, -1, 0.3, 0, ramp) === null, "c-ramp: a shot stopping short misses");
  ok(R.segmentRamp(1, 0.5, 9, 3, 0.5, 9, ramp) === null, "c-ramp: a shot past the side misses");
  const inside = R.segmentRamp(2, 1.5, 0, 2, 1.0, 0, ramp);
  ok(inside && inside.t === 0, "c-ramp: a segment that starts inside the plank reports t = 0");
  // every dir hits the right way round (up-end +X, -X, +Z, -Z), mirrored from the dir 0 ramp
  const dirs = [mk(0, 0, 4, 0, 3, -2, 2), mk(1, -4, 0, 0, 3, -2, 2), mk(2, -2, 2, 0, 3, 0, 4), mk(3, -2, 2, 0, 3, -4, 0)];
  const probes = [[[-1, 0.5, 0, 5, 0.5, 0], 1], [[1, 0.5, 0, -5, 0.5, 0], 1], [[0, 0.5, -1, 0, 0.5, 5], 1], [[0, 0.5, 1, 0, 0.5, -5], 1]];
  let dirOk = true;
  for (let i = 0; i < 4; i++) {
    const p = probes[i][0], h = R.segmentRamp(p[0], p[1], p[2], p[3], p[4], p[5], dirs[i]);
    // the climb is toward the up end, so the plank crosses y = 0.5 at u = 0.667 (4 m run, 3 m rise)
    const hx = h && (p[0] + (p[3] - p[0]) * h.t), hz = h && (p[2] + (p[5] - p[2]) * h.t);
    const u = h && (i === 0 ? hx : i === 1 ? -hx : i === 2 ? hz : -hz);
    if (!h || Math.abs(h.nx * (i < 2 ? (i === 0 ? 1 : -1) : 0) + h.nz * (i >= 2 ? (i === 2 ? 1 : -1) : 0)) < 0.5 || u < 0.4 || u > 0.95) dirOk = false;
  }
  ok(dirOk, "c-ramp: all four dirs rise toward their up-end and tilt the normal back against the climb");

  // property: the exact solve agrees with a brute-force march of the plank (1/4000 steps)
  {
    const rng = R.mulberry32(77);
    const refHit = (ax, ay, az, bx, by, bz, c) => {
      const N = 4000, h2 = R.rampHalfV(c);
      for (let i = 0; i <= N; i++) {
        const t = i / N, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
        if (Math.abs(y - R.rampTopAt(c, x, z)) <= h2) return t;
      }
      return -1;
    };
    let agree = 0, hits = 0, N = 6000, bad = 0, worstDt = 0;
    for (let i = 0; i < N; i++) {
      const c = dirs[i & 3], q = (s) => (rng() - 0.5) * s;
      const ax = q(12), ay = q(7) + 1.5, az = q(12), bx = q(12), by = q(7) + 1.5, bz = q(12);
      const e = R.segmentRamp(ax, ay, az, bx, by, bz, c), r = refHit(ax, ay, az, bx, by, bz, c);
      const len = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
      if (e) hits++;
      if (!e && r < 0) agree++;
      else if (e && r >= 0) { const dt = Math.abs(e.t - r); worstDt = Math.max(worstDt, dt); if (dt <= 1.5 / 4000 + 1e-9) agree++; else bad++; }
      else if (e && r < 0 && (e.tExit - e.t) * len < 0.02) agree++;      // a graze thinner than the brute force's step
      else bad++;
    }
    ok(bad === 0 && agree === N && hits > N * 0.1, "c-ramp: exact plank solve = brute-force march on " + N + " random segments (" + hits + " hits, worst entry error " + worstDt.toExponential(1) + ")");
  }

  // movement: climbed from the low edge, sides and underside block (capsule r 0.45, h 1.8, STEP_UP 0.55)
  const P = R.PLAYERK, SU = 0.55;
  const blocks = (c, x, z, yd) => R.rampBlocks(c, x, z, yd, P.height, P.radius, SU);
  const line = (c, u) => c.minY + (c.maxY - c.minY) * (u / (c.maxX - c.minX));
  ok(!blocks(ramp, -0.3, 0, 0), "c-ramp mover: walking onto the low edge from the ground is free");
  ok(!blocks(ramp, 0.2, 0, 0), "c-ramp mover: ...and the first step up the slope");
  let climbOk = true;
  for (let u = 0; u <= 4; u += 0.05) if (blocks(ramp, u, 0, line(ramp, u))) climbOk = false;        // feet on the walk line, centre line
  for (let u = 0; u <= 4; u += 0.05) if (blocks(ramp, u, 1.7, line(ramp, u))) climbOk = false;      // feet on the walk line, hugging the side
  ok(climbOk, "c-ramp mover: a capsule standing on the walk line is never blocked, anywhere on the ramp (80 + 80 steps)");
  let descendOk = true;
  for (let u = 4; u >= 0; u -= 0.05) if (blocks(ramp, u, 0, line(ramp, u) + 0.02)) descendOk = false;   // walking down: feet a hair above the line
  ok(descendOk, "c-ramp mover: ...and neither walking down it");
  ok(!blocks(ramp, 6, 0, 0) && !blocks(ramp, 1, 3, 0) && !blocks(ramp, 1, -2.46, 0), "c-ramp mover: a capsule clear of the footprint (r 0.45) is never blocked");
  // the side face: ground feet beside the plank where its line is above a step and its underside below the head
  ok(blocks(ramp, 2.0, 2.2, 0), "c-ramp mover: its SIDE blocks (line 1.5 m, underside 1.3 m, 0.25 m from the face)");
  ok(blocks(ramp, 2.0, -2.2, 0), "c-ramp mover: ...on both sides");
  ok(!blocks(ramp, 0.3, 2.2, 0), "c-ramp mover: ...but the low corner within a step (line 0.22 m) is stepped onto, not a wall");
  ok(!blocks(ramp, 2.0, 2.2, 1.0), "c-ramp mover: a capsule that has already jumped onto the line (feet 1.0, line 1.5) is not stopped by the side");
  ok(!blocks(ramp, 2.0, 0, 1.5), "c-ramp mover: ...nor one standing on it");
  // under the plank: walkable only where a standing capsule fits beneath it
  ok(!blocks(ramp, 3.4, 0, 0), "c-ramp mover: high under the plank (line 2.55 m, underside 2.36 m) a standing capsule walks through");
  ok(blocks(ramp, 1.5, 0, 0), "c-ramp mover: low under the plank (underside 0.94 m) it is a wall: the head would go into the slab");
  // the threshold is the underside at the LOWEST point the disc reaches, not at its centre
  {
    // find the centre u where the centre-only underside is just clear (>= 1.8) but the disc's lowest point is not
    const clearC = (u) => line(ramp, u) - hv >= P.height;
    let u = 0; while (!clearC(u)) u += 0.001;                         // first u whose centre underside clears the head
    ok(blocks(ramp, u + 0.01, 0, 0), "c-ramp mover: the disc's low edge (0.45 m down-slope) still hits the plank where the centre's underside is just clear");
    ok(!blocks(ramp, u + 0.45 + 0.01, 0, 0), "c-ramp mover: one radius further up the plank the whole disc clears (" + (u + 0.46).toFixed(2) + " m along)");
  }
  // a lip: stepping from the ground onto a low edge that sits above it
  const lip3 = mk(0, 0, 4, 0.5, 3.5, -2, 2), lip8 = mk(0, 0, 4, 0.8, 3.8, -2, 2);
  ok(!blocks(lip3, -0.3, 0, 0), "c-ramp mover: a 0.5 m lip is within the 0.55 step: walkable from the ground");
  ok(blocks(lip8, -0.3, 0, 0), "c-ramp mover: a 0.8 m lip is a wall to a walker...");
  ok(!blocks(lip8, -0.3, 0, 0.4), "c-ramp mover: ...and free to a jumper whose feet are 0.4 m up");
  // a ramp whose line never reaches a step is never a wall (a 0.3 m ground ramp)
  ok(!blocks(mk(2, -1, 1, 0, 0.3, 0, 3), 0, 1.5, 0), "c-ramp mover: a 0.3 m rise anywhere is stepped, never a wall");
  // every dir gives the same answer when the geometry is mirrored
  {
    let same = true;
    const probe = (u, v, yd) => [blocks(dirs[0], u, v, yd), blocks(dirs[1], -u, v, yd), blocks(dirs[2], v, u, yd), blocks(dirs[3], v, -u, yd)];
    for (let u = -0.6; u <= 4.6; u += 0.3) for (let v = -2.6; v <= 2.6; v += 0.3) for (const yd of [0, 0.7, 1.6]) {
      const a = probe(u, v, yd);
      if (a[0] !== a[1] || a[0] !== a[2] || a[0] !== a[3]) same = false;
    }
    ok(same, "c-ramp mover: all four dirs agree on a mirrored grid (rampBlocks has no dir bias)");
  }
}

// ── LANDING SWEEP (Wave 5, 5C): a fast faller cannot tunnel a slab ───────────
// player.js tested the feet as a POINT: the highest top <= feet + STEP_UP. Past ~33 m/s
// a tick moves the feet further than that, so a 0.3 m roof slab fell between two
// ticks (the research probe: first pass-through at a 26.7 m drop, about 1 drop in 4
// from 40 m up). The mirror below is player.js's vertical step, line for line; the sweep
// is the new term. The live game is checked in a real browser (the 5C probes).
{
  const g = R.MOVE.gravity, dt = 1 / 60, SU = 0.55;
  const slab = (top) => ({ kind: "box", minX: -3, maxX: 3, minY: top - 0.3, maxY: top, minZ: -3, maxZ: 3, dead: false });
  const point = (cols, x, z, y, ground) => {                          // player.js supportIn (box part)
    let s = ground;
    for (const c of cols) { if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue; if (c.maxY <= y + SU && c.maxY > s) s = c.maxY; }
    return s;
  };
  function fall(h0, cols, ground, sweep) {                             // returns the y the actor stops at
    let y = h0, vy = 0;
    for (let i = 0; i < 20000; i++) {
      vy += g * dt;
      const y0 = y; y += vy * dt;
      let sup = point(cols, 0, 0, y, ground);
      if (sweep && y0 - y > SU) { const s = R.sweepSupport(cols, 0, 0, y0, y, SU); if (s > sup) sup = s; }
      if (y <= sup + 0.02) return sup;
    }
    return NaN;
  }
  // a 0.3 m roof slab at y = 6 over ground at 0: drops of 5 .. 60 m onto it, in 1 cm steps
  const roof = [slab(6)];
  let oldThrough = 0, newThrough = 0, n = 0, firstOld = null, nHigh = 0, oldHigh = 0;
  for (let drop = 5; drop <= 60; drop += 0.01) {
    n++;
    const lost = fall(6 + drop, roof, 0, false) !== 6;
    if (lost) { oldThrough++; if (firstOld === null) firstOld = drop; }
    if (drop >= 30) { nHigh++; if (lost) oldHigh++; }
    if (fall(6 + drop, roof, 0, true) !== 6) newThrough++;
  }
  ok(oldHigh > nHigh * 0.15 && firstOld > 26 && firstOld < 27.5,
     "landing sweep: CONTROL: the point test lets " + oldThrough + " of " + n + " drops through the slab (" + oldHigh + " of the " + nHigh + " from 30 m up), the first at " + firstOld.toFixed(2) + " m");
  ok(newThrough === 0, "landing sweep: drops of 5-60 m onto a 0.3 m slab: 0 pass-through (" + n + " drops, 1 cm apart)");
  // thicker or thinner makes no difference to a top-only support test, but pin it
  let thin = 0;
  for (const th of [0.05, 0.3, 1]) for (let drop = 20; drop <= 60; drop += 0.37) {
    const c = [{ kind: "box", minX: -3, maxX: 3, minY: 6 - th, maxY: 6, minZ: -3, maxZ: 3, dead: false }];
    if (fall(6 + drop, c, 0, true) !== 6) thin++;
  }
  ok(thin === 0, "landing sweep: slab thickness (5 cm, 30 cm, 1 m) does not matter: 0 pass-through");
  // two slabs stacked 3 m apart: the HIGHEST one the feet crossed wins
  let stack = 0;
  for (let drop = 20; drop <= 70; drop += 0.31) if (fall(9 + drop, [slab(6), slab(9)], 0, true) !== 9) stack++;
  ok(stack === 0, "landing sweep: with two decks the faller lands on the upper one (0 of 161 wrong)");
  // the ground is still the floor, and the terrain case without any slab is unchanged
  ok(fall(80, [], 2.5, true) === 2.5 && fall(80, [], 2.5, false) === 2.5, "landing sweep: no slab: lands on the terrain, same with and without the sweep");
  // off the footprint (beyond the 0.3 m margin) there is nothing to land on
  ok(R.sweepSupport(roof, 3.4, 0, 7, 5.4, SU) === -Infinity, "landing sweep: past the footprint margin the slab is not there");
  ok(R.sweepSupport(roof, 3.2, 0, 7, 5.4, SU) === 6, "landing sweep: inside the 0.3 m margin it is (same as the support test)");
  // a top ABOVE the feet is not crossed, a top the feet never reached is not either
  ok(R.sweepSupport([slab(40)], 0, 0, 38, 36, SU) === -Infinity && R.sweepSupport([slab(30)], 0, 0, 38, 36, SU) === -Infinity, "landing sweep: tops above the start or below the end are not crossed");
  // a slow tick is the old test exactly: -Infinity, so nothing about ordinary walking changes
  ok(R.sweepSupport(roof, 0, 0, 6.5, 6.1, SU) === -Infinity && R.sweepSupport(roof, 0, 0, 6.5, 5.96, SU) === -Infinity, "landing sweep: a tick that moves <= STEP_UP never sweeps (walking, jumping, short falls are byte-identical)");
  // ramps: the walk line, not the box top
  const rp = { kind: "ramp", dir: 2, minX: -1, maxX: 1, minY: 4, maxY: 8, minZ: -2, maxZ: 2, dead: false };
  ok(approx(R.sweepSupport([rp], 0, 0, 7, 5.3, SU), 6, 1e-9), "landing sweep: a ramp's top is its walk line at (x, z) (6.0 m at mid-run), crossed by the feet segment 7 -> 5.3");
  ok(R.sweepSupport([{ kind: "box", dead: true, minX: -3, maxX: 3, minY: 5, maxY: 6, minZ: -3, maxZ: 3 }], 0, 0, 30, 20, SU) === -Infinity, "landing sweep: destroyed colliders are skipped");
  // landing on a ramp at speed: from 35 m up onto a 4 m climb ramp's mid-run
  {
    let y = 40, vy = 0, landed = NaN;
    for (let i = 0; i < 20000 && isNaN(landed); i++) {
      vy += g * dt; const y0 = y; y += vy * dt;
      let sup = Math.max(0, R.rampTopAt(rp, 0, 0) <= y + SU ? R.rampTopAt(rp, 0, 0) : 0);
      const s = R.sweepSupport([rp], 0, 0, y0, y, SU); if (s > sup) sup = s;
      if (y <= sup + 0.02) landed = sup;
    }
    ok(approx(landed, 6, 1e-9), "landing sweep: a 34 m drop onto a ramp lands on its surface (" + landed.toFixed(3) + " m), not the ground under it");
  }
}

// ── CROSSHAIR MARCH (Wave 5, 5C): swept like the bullets ──────────────────────
{
  const flat = () => 0;
  const world = (cols) => (x, z, r, out) => { out.length = 0; for (const c of cols) out.push(c); return out; };
  const scratch = [];
  const march = (o, d, d0, dMax, cols) => R.aimRayDist(o[0], o[1], o[2], d[0], d[1], d[2], d0, dMax, flat, world(cols), scratch);
  const house = { kind: "box", minX: 20, maxX: 20.32, minY: 0, maxY: 3, minZ: -6, maxZ: 6, dead: false };     // a 0.32 m house wall (re-placed per ray below)
  // the old march, verbatim, as the control (point test every 0.75 m from 3 m, boxes only)
  const oldMarch = (o, d, cols, dMax) => {
    for (let t = 3; t < dMax; t += 0.75) {
      const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
      if (flat(x, z) > y) return t;
      for (const c of cols) if (c.kind === "box" && x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) return t;
    }
    return dMax;
  };
  const rng = R.mulberry32(404);
  let oldMiss = 0, newMiss = 0, N = 0, worst = 0;
  for (let i = 0; i < 8000; i++) {
    const ang = (rng() - 0.5) * 2 * 70 * Math.PI / 180, o = [0, 1.6, (rng() - 0.5) * 8];
    const d = [Math.cos(ang), 0, Math.sin(ang)];
    const D = 5 + rng() * 35;                                          // the wall plane x = D, 5 .. 40 m out (the sampling phase differs per ray)
    const wall = Object.assign({}, house, { minX: D, maxX: D + 0.32 });
    const wallT = (D - o[0]) / d[0];                                   // the ray certainly crosses the plane inside z in -6..6
    if (Math.abs(o[2] + d[2] * wallT) > 5.5) continue;
    N++;
    if (oldMarch(o, d, [wall], 300) > wallT + 0.75) oldMiss++;
    const t = march(o, d, 0.12, 300, [wall]);
    if (t > wallT + 1e-6) newMiss++;
    worst = Math.max(worst, Math.abs(t - wallT));
  }
  ok(oldMiss > N * 0.3 && oldMiss < N * 0.7, "crosshair: CONTROL: the old 0.75 m point march steps over the 0.32 m wall on " + oldMiss + " of " + N + " rays (" + (100 * oldMiss / N).toFixed(0) + " %)");
  ok(newMiss === 0 && worst < 1e-6, "crosshair: the swept march reads the wall on every ray (" + N + " rays, 0-70 deg, worst error " + worst.toExponential(1) + " m)");
  // a wall 1.5 m ahead of the eye with the lens pulled in right behind it: the old 3 m start never saw it
  const near = { kind: "box", minX: 1.5, maxX: 1.82, minY: 0, maxY: 3, minZ: -6, maxZ: 6, dead: false };
  ok(oldMarch([0, 1.6, 0], [1, 0, 0], [near], 300) > 100, "crosshair: CONTROL: the old march started at 3 m and skipped a wall 1.5 m ahead");
  ok(approx(march([0, 1.6, 0], [1, 0, 0], 0.12, 300, [near]), 1.5, 1e-9), "crosshair: ...the new one starts at the eye's closest approach and reads it at 1.5 m");
  // a collider the ray starts INSIDE is skipped (a lens grazing a trunk), the next thing is still found
  const trunk = { kind: "box", minX: -0.5, maxX: 0.5, minY: 0, maxY: 7, minZ: -0.5, maxZ: 0.5, dead: false };
  ok(approx(march([0, 1.6, 0], [1, 0, 0], 0.12, 300, [trunk, near]), 1.5, 1e-9), "crosshair: a box the march starts inside is skipped, the wall beyond it is read");
  ok(march([0, 1.6, 0], [1, 0, 0], 0.12, 300, [trunk]) === 300, "crosshair: ...and with nothing beyond it the far point (never a point on the shooter)");
  // ramps count (the old march ignored every kind but "box"), and only the plank
  const rmp = { kind: "ramp", dir: 0, minX: 10, maxX: 14, minY: 0, maxY: 3, minZ: -2, maxZ: 2, dead: false };
  const tr = march([0, 1.0, 0], [1, 0, 0], 0.12, 300, [rmp]);
  ok(tr > 10 && tr < 14 && Math.abs(1.0 - R.rampTopAt(rmp, tr, 0)) <= R.rampHalfV(rmp) + 1e-9,
     "crosshair: a ramp slope is read, at the plank (" + tr.toFixed(3) + " m)");
  ok(march([12, 0.4, -6], [0, 0, 1], 0.12, 300, [rmp]) === 300, "crosshair: ...but a ray along the ground under the plank does not stop on the open wedge");
  // terrain still counts, and the nearer of terrain / collider wins
  const hill = (x) => (x > 30 ? (x - 30) * 0.5 : 0);
  const th = R.aimRayDist(0, 1.6, 0, 1, 0, 0, 0.12, 300, (x) => hill(x), world([near]), scratch);
  ok(approx(th, 1.5, 1e-9), "crosshair: the wall (1.5 m) beats the hill (30 m+)");
  const th2 = R.aimRayDist(0, 1.6, 0, 1, 0, 0, 0.12, 300, (x) => hill(x), world([]), scratch);
  ok(th2 > 30 && th2 < 36, "crosshair: with no collider the hill is read within one 0.75 m step (" + th2.toFixed(2) + " m)");
  ok(march([0, 1.6, 0], [1, 0, 0], 0.12, 300, [{ kind: "box", dead: true, minX: 5, maxX: 6, minY: 0, maxY: 3, minZ: -5, maxZ: 5 }]) === 300, "crosshair: a destroyed prop is not an aim point");
  // a target hit nearer than the start (an actor point): the march leaves it alone
  ok(march([0, 1.6, 0], [1, 0, 0], 2.0, 1.2, [near]) === 1.2, "crosshair: an actor hit nearer than the march start is returned untouched");
  // long rays cross the 24 m spans: a wall at 150 m
  const far = { kind: "box", minX: 150, maxX: 150.32, minY: 0, maxY: 3, minZ: -6, maxZ: 6, dead: false };
  ok(approx(march([0, 1.6, 0], [1, 0, 0], 4.2, 300, [far]), 150, 1e-9), "crosshair: a wall 150 m out is read across the 24 m query spans");
  // a wall exactly on a 24 m span boundary is neither skipped nor read twice (span k ends where span k+1 starts)
  {
    let missed = 0, tried = 0;
    for (const d0 of [0.05, 0.12, 4.2, 1.7, 3]) for (let k = 1; k <= 11; k++) for (const e of [0, 1e-12, -1e-12, 1e-9, -1e-9]) {
      const x = d0 + 24 * k + e, wl = { kind: "box", minX: x, maxX: x + 0.32, minY: 0, maxY: 3, minZ: -6, maxZ: 6, dead: false };
      tried++;
      if (Math.abs(march([0, 1.6, 0], [1, 0, 0], d0, 300, [wl]) - x) > 1e-6) missed++;
    }
    ok(missed === 0, "crosshair: a wall on a 24 m span boundary (and 1e-9 / 1e-12 either side) is read every time (" + tried + " cases)");
  }
  // deterministic: same inputs, same answer
  ok(march([0, 1.6, 1], [0.9, -0.01, 0.4358898943540674], 0.12, 300, [far, near, house]) === march([0, 1.6, 1], [0.9, -0.01, 0.4358898943540674], 0.12, 300, [far, near, house]), "crosshair: pure: the same ray gives the same distance");
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

// ── MOVER FLOOR PROBE (Wave 7 completion, lane D3): blockedIn and the support test agree ─────────────────
// player.js decided "this box is a step, not a wall" in TWO places: blockedIn with the feet BEFORE the tick (y0), the support test that lifts
// the capsule onto it with the feet AFTER gravity (y1 = y0 + (v + g*dt)*dt, 5.5 mm lower standing, more in a fall). A box whose rise over y0 was
// in (STEP_UP - (y0 - y1), STEP_UP] was neither a wall nor liftable: the capsule walked in and sank (5 of 13,432 swept rock sprints, 0.037 %).
// The mirror below is the two decisions for ONE box, line for line; the live mover is proven in a real browser (collisioncheck, the rock sweep).
{
  const g = R.MOVE.gravity, dt = 1 / 60, SU = 0.55;
  const y0 = 13.417;                                                    // the measured case (ashgrid seed 31337 rock 40): feet on a step box
  const verdict = (rise, v, probe) => {
    const top = y0 + rise;
    const y1 = y0 + (v + g * dt) * dt;                                  // player.js: vel.y += g*dt, then pos.y += vel.y*dt
    const wall = !(top <= y0 + SU);                                     // blockedIn: a lone box is a wall iff its top is over feet + STEP_UP (the floor it adds is itself)
    const lift = top <= probe(y0, y1) + SU;                             // supportIn at the probe height
    return { wall, lift, y1 };
  };
  const oldProbe = (a, b) => b, newProbe = R.supportProbeY;
  ok(typeof newProbe === "function" && newProbe(5, 4) === 5 && newProbe(4, 5) === 5 && newProbe(5, 5) === 5, "floor probe: the higher of the feet before and after gravity");
  ok(newProbe(NaN, 3) === 3 && Number.isNaN(newProbe(3, NaN)), "floor probe: a NaN start falls back to the end feet (same as the old test); a NaN end stays NaN");
  let oldBad = 0, newBad = 0, n = 0, oldFirst = null, oldLast = null, liftedMore = 0, wallBad = 0;
  for (let ri = 400; ri <= 700; ri++) {                                 // rises 0.400 .. 0.700 m in 1 mm steps
    const rise = ri / 1000;
    for (const v of [0, -2, -8, -16, -25, -40]) {                       // standing (vy 0 after the landing), a jump's descent, a fall
      n++;
      const o = verdict(rise, v, oldProbe), w = verdict(rise, v, newProbe);
      if (!o.wall && !o.lift) { oldBad++; if (v === 0) { if (oldFirst === null) oldFirst = rise; oldLast = rise; } }
      if (!w.wall && !w.lift) newBad++;                                 // neither a wall nor liftable: the defect
      if (w.lift && !o.lift && w.wall) liftedMore++;                    // a wall the new probe would lift onto (must never happen)
      if (w.wall !== o.wall) wallBad++;                                 // the wall rule itself must not move
    }
  }
  ok(oldBad > 0 && oldFirst !== null && oldFirst > 0.543 && oldLast <= 0.55, "floor probe: CONTROL: the old probe leaves " + oldBad + " of " + n + " (rise x fall speed) cases neither a wall nor liftable, standing: rise " + oldFirst + " .. " + oldLast + " m");
  ok(newBad === 0, "floor probe: the new probe leaves 0 of " + n + " cases neither a wall nor liftable (rises 0.400-0.700 m, fall speeds 0-40 m/s)");
  ok(liftedMore === 0 && wallBad === 0, "floor probe: a box over STEP_UP is still a wall and is never lifted onto; the wall rule is untouched");
  // a tick that does not fall is the old test exactly (jump up, the apex, a flat tick)
  let same = true;
  for (let v = 0; v <= 8; v += 0.5) { const y1 = y0 + (v + g * dt) * dt; if (y1 >= y0 && newProbe(y0, y1) !== y1) same = false; }
  ok(same && newProbe(y0, y0) === y0, "floor probe: a rising or flat tick probes from the end feet exactly as before (jumping and flat ground are byte-identical)");
  // the mover reads it where the support test runs, and blockedIn still uses the feet before the tick
  let pj = null;
  try { pj = require("fs").readFileSync(require("path").join(__dirname, "..", "3d", "royale", "player.js"), "utf8"); } catch (e) { /* outside the repo: skip the source pin */ }
  if (pj) {
    // Wave 7b (lane S1, the allocation round): the mover passes its numbers through the MV Float64Array (a call V8 does not inline boxes
    // every double argument), so the pins read the MV form: the support probe height is supportProbeY's own expression (y0 > y1 ? y0 : y1,
    // checked equal to K.supportProbeY above) written into MV[4] right before supportF, and blockedF's floor is max(feet before, support).
    ok(/MV\[2\] = a\.pos\.x; MV\[3\] = a\.pos\.z; MV\[4\] = feetY0 > a\.pos\.y \? feetY0 : a\.pos\.y;[^\n]*\n\s*supportF\(W, cols\);/.test(pj) &&
       [[5, 4], [4, 5], [5, 5], [NaN, 3], [3, NaN]].every(([p, q]) => Object.is(p > q ? p : q, newProbe(p, q))),
       "floor probe: player.js stepActor's support test probes from K.supportProbeY(feet before, feet after) (inlined into MV[4])");
    ok(/let yd = y;\s*if \(isMove\) \{ supportF\(W, cols\); yd = Math\.max\(y, MV\[6\]\); \}/.test(pj) && /const x0 = MV\[0\], z0 = MV\[1\], x = MV\[2\], z = MV\[3\], y = MV\[4\], h = MV\[5\];/.test(pj),
       "floor probe: player.js blockedIn (blockedF) still reads its floor from the feet before the tick");
  } else console.log("  INFO  player.js not found next to this file: source pins skipped");
}

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
