// Headless combat probe. The sim touches no THREE/DOM/clock, so the whole
// fight system is provable in node in about a second — which is the point of
// keeping it pure.
//
// run: node games/colosseum/tools/probe_combat.mjs

import { Combat, Fighter, PHASE, FEEL } from "../runtime/sim/combat.js";
import { Brain, BEAST_PROFILES, SKILL } from "../runtime/sim/ai.js";
import { ARMATURAE, WEAPONS, SHIELDS, mobility, loadoutWeight } from "../runtime/data/weapons.js";

let checks = 0, fails = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) { fails++; console.log("  FAIL:", msg); }
};

const DT = 1 / 60;

/** Build a fighter from an armatura definition. */
function fromArmatura(id, opts = {}) {
  const a = ARMATURAE[id];
  return new Fighter({
    name: a.name, weapon: a.weapon, shield: a.shield, armour: a.armour,
    hp: a.hp, ...opts,
  });
}

/** Run a full AI-vs-AI bout, return the outcome. */
function bout({ aId = "murmillo", bId = "thraex", aSkill = "veteranus", bSkill = "veteranus", seed = 1, maxT = 90 }) {
  const c = new Combat({ seed });
  const A = c.add(fromArmatura(aId, { team: 0, x: -3, z: 0, facing: 0 }));
  const B = c.add(fromArmatura(bId, { team: 1, x: 3, z: 0, facing: Math.PI }));
  const ba = new Brain(A, { skill: aSkill, style: ARMATURAE[aId].style, seed: seed * 7 + 1, combat: c });
  const bb = new Brain(B, { skill: bSkill, style: ARMATURAE[bId].style, seed: seed * 13 + 2, combat: c });

  let t = 0, hits = 0, blocks = 0, parries = 0, deaths = 0;
  c.onEvent = (e) => {
    if (e.type === "hit") hits++;
    else if (e.type === "block") blocks++;
    else if (e.type === "parry") parries++;
    else if (e.type === "death") deaths++;
  };
  while (t < maxT && A.alive && B.alive) {
    c.command(A, ba.update(DT));
    c.command(B, bb.update(DT));
    c.update(DT);
    t += DT;
  }
  return {
    t: +t.toFixed(2), hits, blocks, parries, deaths,
    winner: A.alive && !B.alive ? A.name : B.alive && !A.alive ? B.name : "timeout",
    aHp: +Math.max(0, A.hp).toFixed(1), bHp: +Math.max(0, B.hp).toFixed(1),
  };
}

console.log("\n=== COMBAT PROBE ===\n");

// --- 1. loadout economics ---------------------------------------------------
console.log("-- mobility vs protection --");
for (const id of Object.keys(ARMATURAE)) {
  const a = ARMATURAE[id];
  const m = mobility({ weapon: a.weapon, shield: a.shield, armour: a.armour });
  console.log(
    `  ${a.name.padEnd(13)} ${String(m.weight).padStart(5)} kg  ` +
    `${String(m.moveSpeed).padStart(5)} m/s  stam ${String(m.staminaMax).padStart(5)}` +
    `  regen ${String(m.staminaRegen).padStart(5)}/s  turn ${m.turnRate}`
  );
}
const naked = mobility({ weapon: "gladius", shield: "none", armour: [] });
const heavy = mobility({ weapon: "gladius", shield: "scutum", armour: ["galea", "manica", "ocreae", "lorica"] });
ok(heavy.moveSpeed < naked.moveSpeed * 0.8, "heavy loadout is meaningfully slower than naked");
ok(heavy.staminaRegen < naked.staminaRegen * 0.75, "heavy loadout recovers meaningfully worse");
ok(loadoutWeight({ weapon: "gladius", shield: "scutum", armour: ["lorica"] }) > 14, "armour weight accumulates");

// --- 2. determinism ---------------------------------------------------------
console.log("\n-- determinism --");
const r1 = bout({ seed: 42 });
const r2 = bout({ seed: 42 });
ok(JSON.stringify(r1) === JSON.stringify(r2), "same seed produces an identical fight");
const r3 = bout({ seed: 43 });
ok(JSON.stringify(r1) !== JSON.stringify(r3), "a different seed produces a different fight");
console.log(`  seed42: ${r1.winner} in ${r1.t}s (${r1.hits} hits, ${r1.blocks} blocks, ${r1.parries} parries)`);
console.log(`  seed43: ${r3.winner} in ${r3.t}s (${r3.hits} hits, ${r3.blocks} blocks, ${r3.parries} parries)`);

// --- 3. fights actually resolve --------------------------------------------
console.log("\n-- 40 bouts resolve --");
let timeouts = 0, totalT = 0;
const winners = {};
for (let s = 1; s <= 40; s++) {
  const r = bout({ seed: s });
  if (r.winner === "timeout") timeouts++;
  totalT += r.t;
  winners[r.winner] = (winners[r.winner] || 0) + 1;
}
console.log(`  avg length ${(totalT / 40).toFixed(1)}s, timeouts ${timeouts}/40, winners:`, winners);
ok(timeouts <= 4, `at most 4/40 bouts stall (got ${timeouts})`);
ok(totalT / 40 > 3, "fights are not instantaneous");
ok(totalT / 40 < 60, "fights do not drag");

// --- 4. skill matters -------------------------------------------------------
console.log("\n-- skill gradient (legend vs tiro, 30 bouts each way) --");
let legendWins = 0;
for (let s = 1; s <= 30; s++) {
  const r = bout({ aSkill: "legend", bSkill: "tiro", seed: s * 3 });
  if (r.winner === ARMATURAE.murmillo.name) legendWins++;
}
console.log(`  legend murmillo beat tiro thraex ${legendWins}/30`);
ok(legendWins >= 20, `higher skill wins substantially more often (got ${legendWins}/30)`);

// --- 5. armour and weak points ---------------------------------------------
console.log("\n-- armour changes outcomes --");
/**
 * Damage dealt into a given armour set, broken down BY ZONE.
 *
 * The defender must FACE the attacker: an earlier version left both at
 * facing 0 with the defender in front, so every blow landed as a rear
 * backstab that no shield could cover — which looked like "armour and shields
 * do nothing" when in fact the test was stabbing them in the back.
 */
function damageInto(armour, dir) {
  const c = new Combat({ seed: 5 });
  const atk = c.add(new Fighter({ team: 0, weapon: "gladius", x: 0, z: 0, facing: 0, hp: 200 }));
  const def = c.add(new Fighter({ team: 1, weapon: "gladius", shield: "none", armour, x: 0, z: 1.0, facing: Math.PI, hp: 5000 }));
  let dealt = 0, hits = 0, behind = 0;
  const byZone = {};
  c.onEvent = (e) => {
    if (e.type !== "hit") return;
    dealt += e.damage; hits++;
    if (e.fromBehind) behind++;
    byZone[e.zone] = (byZone[e.zone] || 0) + e.damage;
  };
  for (let i = 0; i < 900; i++) {
    c.command(atk, { attack: atk.canAttack(), attackDir: dir, face: 0 });
    c.command(def, { face: Math.PI });
    c.update(DT);
  }
  return { total: +dealt.toFixed(0), hits, behind, byZone };
}
const bare = damageInto([], "high");
const helmed = damageInto(["galea"], "high");
console.log(`  high cuts, bare: ${bare.total} over ${bare.hits} hits   with galea: ${helmed.total}`);
ok(bare.behind === 0, "the test defender faces the attacker (no accidental backstabs)");
ok(helmed.total < bare.total * 0.85, `a helmet materially reduces high-cut damage (${helmed.total} vs ${bare.total})`);

// Pierce must be compared WITHIN one zone: a thrust concentrates on the torso
// while a cut scatters to the unarmoured head, so comparing totals measures
// zone distribution, not penetration.
const lorThrust = damageInto(["lorica"], "thrust");
const lorCut = damageInto(["lorica"], "high");
const perHitThrustTorso = lorThrust.byZone.torso / Math.max(1, lorThrust.hits);
const perHitCutTorso = lorCut.byZone.torso / Math.max(1, lorCut.hits);
console.log(`  lorica torso damage per swing — thrust ${perHitThrustTorso.toFixed(1)}, cut ${perHitCutTorso.toFixed(1)}`);
ok(perHitThrustTorso > perHitCutTorso, "thrusts pierce scale armour better than cuts, zone-for-zone");

// --- 6. shields, guard break, parry -----------------------------------------
console.log("\n-- shield mechanics --");
const c6 = new Combat({ seed: 9 });
const bruiser = c6.add(new Fighter({ team: 0, weapon: "spatha", x: 0, z: 0, facing: 0, hp: 300 }));
const holder = c6.add(new Fighter({ team: 1, weapon: "gladius", shield: "scutum", x: 0, z: 1.2, facing: Math.PI, hp: 300 }));
let broke = false, blocked6 = 0;
c6.onEvent = (e) => { if (e.type === "shield_break" || e.type === "guard_break") broke = true; if (e.type === "block") blocked6++; };
for (let i = 0; i < 1800 && !broke; i++) {
  c6.command(bruiser, { attack: bruiser.canAttack(), attackDir: "high", face: 0 });
  // hold block continuously -> plain blocks, never parries
  c6.command(holder, { block: true, blockDir: "high", face: Math.PI });
  c6.update(DT);
}
console.log(`  held guard: ${blocked6} blocks then broke=${broke}`);
ok(blocked6 > 0, "a held shield blocks");
ok(broke, "sustained pressure eventually breaks a held guard");
ok(SHIELDS.none.coverage.length === 0, "no-shield covers nothing");

// --- 7. beast bout ----------------------------------------------------------
console.log("\n-- beast bout (tiger vs murmillo) --");
function beastBout(seed) {
  const c = new Combat({ seed });
  const man = c.add(fromArmatura("murmillo", { team: 0, x: -4, z: 0, facing: 0 }));
  const p = BEAST_PROFILES.tiger;
  const cat = c.add(new Fighter({
    name: p.name, team: 1, weapon: "gladius", shield: "none", armour: [],
    hp: p.hp, x: 4, z: 0, facing: Math.PI, isBeast: true, beastProfile: p, height: 0.95,
  }));
  // The beast swings with its own profile rather than a sword's numbers.
  cat.weaponId = "gladius";
  Object.defineProperty(cat, "weapon", {
    value: { ...WEAPONS.gladius, reach: p.reach, damage: p.damage, windup: p.windup, active: p.active, recover: p.recover, dirs: ["high"], armourPierce: { high: 0.35 } },
  });
  const bm = new Brain(man, { skill: "veteranus", style: "pressure", seed: seed * 5, combat: c });
  const bc = new Brain(cat, { skill: "veteranus", style: "beast", seed: seed * 11, combat: c });
  let t = 0;
  while (t < 90 && man.alive && cat.alive) {
    c.command(man, bm.update(DT));
    c.command(cat, bc.update(DT));
    c.update(DT);
    t += DT;
  }
  return { t: +t.toFixed(1), winner: man.alive && !cat.alive ? "murmillo" : cat.alive && !man.alive ? "tiger" : "timeout" };
}
const beastResults = {};
let beastTimeouts = 0;
for (let s = 1; s <= 20; s++) {
  const r = beastBout(s);
  beastResults[r.winner] = (beastResults[r.winner] || 0) + 1;
  if (r.winner === "timeout") beastTimeouts++;
}
console.log("  outcomes:", beastResults);
ok(beastTimeouts <= 3, `beast bouts resolve (timeouts ${beastTimeouts}/20)`);
ok((beastResults.tiger || 0) > 0 && (beastResults.murmillo || 0) > 0, "beast fights are winnable BY BOTH sides");

// --- 8. invariants ----------------------------------------------------------
console.log("\n-- invariants --");
const c8 = new Combat({ seed: 3 });
const x1 = c8.add(fromArmatura("secutor", { team: 0, x: -2, z: 0 }));
const x2 = c8.add(fromArmatura("retiarius", { team: 1, x: 2, z: 0 }));
const b1 = new Brain(x1, { skill: "champion", style: "pressure", seed: 21, combat: c8 });
const b2 = new Brain(x2, { skill: "champion", style: "spacer", seed: 22, combat: c8 });
let minHp = Infinity, maxStam = -Infinity, escaped = false;
for (let i = 0; i < 4000; i++) {
  c8.command(x1, b1.update(DT));
  c8.command(x2, b2.update(DT));
  c8.update(DT);
  for (const f of c8.fighters) {
    minHp = Math.min(minHp, f.hp);
    maxStam = Math.max(maxStam, f.stamina);
    const n = Math.sqrt((f.x * f.x) / (43.5 * 43.5) + (f.z * f.z) / (27.5 * 27.5));
    if (n > 1.02) escaped = true;
  }
  if (!x1.alive || !x2.alive) break;
}
ok(!escaped, "no fighter leaves the arena ellipse");

// THE REACH INVARIANT. Two bodies can never be pushed further apart than the
// shorter weapon can reach, or that fighter is mathematically unable to land a
// blow. This is not hypothetical: a beast collision radius of 0.825 m put the
// human-vs-beast floor at 1.375 m against a gladius reaching 1.35 m, and the
// murmillo went a whole bout at 0.1% of ticks in range having dealt 0 damage.
{
  const human = new Fighter({ weapon: "gladius" });
  const beast = new Fighter({ weapon: "gladius", isBeast: true });
  const floor = human.radius + beast.radius;
  const shortest = Math.min(...Object.values(WEAPONS).map((w) => w.reach));
  console.log(`  separation floor ${floor.toFixed(2)} m vs shortest reach ${shortest.toFixed(2)} m`);
  ok(floor < shortest * 0.95, `separation floor (${floor.toFixed(2)}m) leaves room inside the shortest reach (${shortest}m)`);
  ok(human.radius + human.radius < WEAPONS.gladius.reach, "two humans can reach each other");
}
ok(maxStam <= x1.maxStamina + 0.001 || maxStam <= x2.maxStamina + 0.001, "stamina never exceeds its maximum");
// Six rank bands plus the t1-only TUTOR band (2026-07-28: the teaching
// opponent for Wooden Swords — see SKILL.tutor in ai.js).
ok(Object.keys(SKILL).length === 7 && !!SKILL.tutor, "seven skill bands: six ranks + the t1 tutor");

// --- the net (retiarius verb) ------------------------------------------------
console.log("\n-- the net --");
{
  const c = new Combat({ seed: 5 });
  const R = c.add(fromArmatura("retiarius", { team: 0, x: 0, z: 0, facing: 0 }));
  const M = c.add(fromArmatura("murmillo", { team: 1, x: 0, z: 2.4, facing: Math.PI }));
  const events = [];
  c.onEvent = (e) => events.push(e.type);
  c.command(R, { net: true });
  c.update(DT);
  ok(R.netWindupT > 0 && R.netCd > 0, "a cast winds up and starts the cooldown");
  ok(events.includes("net_throw"), "the throw telegraphs (net_throw fired)");
  for (let t = 0; t < FEEL.netWindup + 0.05; t += DT) c.update(DT);
  ok(events.includes("net_hit") && M.netT > 0, "a target inside the cone is entangled");
  ok(!M.canAct(), "an entangled fighter cannot act");
  const preAtk = M.phase;
  c.command(M, { attack: true, attackDir: "high" });
  c.update(DT);
  ok(M.phase === preAtk, "entangled attack presses are refused");
  for (let t = 0; t < FEEL.netDuration; t += DT) c.update(DT);
  ok(M.netT === 0 && events.includes("net_free"), "the mesh frees after its duration");

  // A dodge's i-frames evade the cast entirely.
  const c2 = new Combat({ seed: 6 });
  const R2 = c2.add(fromArmatura("retiarius", { team: 0, x: 0, z: 0, facing: 0 }));
  const M2 = c2.add(fromArmatura("murmillo", { team: 1, x: 0, z: 2.4, facing: Math.PI }));
  const ev2 = [];
  c2.onEvent = (e) => ev2.push(e.type);
  c2.command(R2, { net: true });
  c2.update(DT);
  M2.iframes = 5;                    // held through the whole windup
  for (let t = 0; t < FEEL.netWindup + 0.05; t += DT) c2.update(DT);
  ok(ev2.includes("net_miss") && M2.netT === 0, "dodge i-frames evade the net (whiff)");
  ok(R2.phase === PHASE.RECOVER, "a whiffed cast leaves the netman open");
}

// --- the disarm --------------------------------------------------------------
console.log("\n-- the disarm --");
{
  // Force guard-breaks across seeds until the 35% disarm roll lands, then
  // prove the whole loop: drop -> cannot attack -> scramble -> re-arm.
  let dropped = null, cD = null, victim = null;
  for (let seed = 1; seed <= 40 && !dropped; seed++) {
    const c = new Combat({ seed });
    const A = c.add(fromArmatura("murmillo", { team: 0, x: 0, z: 0, facing: 0 }));
    const B = c.add(fromArmatura("thraex", { team: 1, x: 0, z: 1.2, facing: Math.PI }));
    const ev = [];
    c.onEvent = (e) => ev.push(e.type);
    // The victim guards on empty stamina so the first blocked hit breaks it.
    B.stamina = 1;
    c.command(B, { block: true, blockDir: "high" });
    c.command(A, { attack: true, attackDir: "high" });
    for (let t = 0; t < 1.2; t += DT) {
      c.command(B, { block: true, blockDir: "high" });
      c.update(DT);
      if (ev.includes("weapon_drop")) { dropped = ev; cD = c; victim = B; break; }
    }
  }
  ok(!!dropped, "a guard-break can tear the blade loose (weapon_drop seen within 40 seeds)");
  if (dropped && victim) {
    ok(victim.disarmed && cD.groundItems.length === 1, "the blade lies on the sand; the fighter is disarmed");
    ok(!victim.canAttack(), "a disarmed fighter cannot strike");
    // Walk him onto the blade.
    const gi = cD.groundItems[0];
    for (let t = 0; t < 6 && victim.disarmed; t += DT) {
      const dx = gi.x - victim.x, dz = gi.z - victim.z, d = Math.hypot(dx, dz) || 1;
      cD.command(victim, { moveX: dx / d, moveZ: dz / d, face: Math.atan2(dx, dz) });
      cD.update(DT);
    }
    ok(!victim.disarmed && cD.groundItems.length === 0, "standing over the blade re-arms him");
  }
}

console.log(`\n-- verdict --`);
console.log(`  ${checks} checks, ${fails} failed`);
if (fails) { console.log("  COMBAT PROBE: FAIL"); process.exit(1); }
console.log("  COMBAT PROBE: PASS");
process.exit(0);
