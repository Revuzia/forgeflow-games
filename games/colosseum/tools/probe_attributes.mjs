// Headless probe: attributes, training, fatigue, and proof that every stat
// actually changes the FIGHT rather than a display value.
// run: node games/colosseum/tools/probe_attributes.mjs

import { Attributes, ATTRIBUTES, ATTR_IDS, ATTR_MIN, ATTR_MAX, REGIMENS,
         RANK_CAP, SLOTS_PER_MATCH, modifiers, neutralModifiers, xpForNext } from "../runtime/sim/attributes.js";
import { Inventory } from "../runtime/sim/inventory.js";
import { Combat, Fighter } from "../runtime/sim/combat.js";
import { mobility } from "../runtime/data/weapons.js";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL:", m); } };
const DT = 1 / 60;

console.log("\n=== ATTRIBUTES PROBE ===\n");

// --- 1. baseline is a no-op --------------------------------------------------
console.log("-- a fresh fighter is unchanged --");
const neutral = neutralModifiers();
const before = mobility({ weapon: "gladius", shield: "scutum", armour: ["galea"] });
const after = mobility({ weapon: "gladius", shield: "scutum", armour: ["galea"] }, neutral);
console.log(`  no mods: ${before.moveSpeed} m/s  |  baseline mods: ${after.moveSpeed} m/s`);
ok(before.moveSpeed === after.moveSpeed, "baseline attributes leave move speed identical");
ok(before.staminaMax === after.staminaMax, "baseline attributes leave stamina identical");
ok(Object.values(neutral).every((v) => Math.abs(v - 1) < 1e-9 || v === 0),
   "every baseline modifier is exactly 1 (or 0 for additive)");

// --- 2. every attribute is mechanical ---------------------------------------
console.log("\n-- no attribute is cosmetic --");
function modsWith(id, level) {
  const lv = {}; for (const a of ATTR_IDS) lv[a] = ATTR_MIN;
  lv[id] = level;
  return modifiers(lv);
}
const hi = 20;
const mStr = modsWith("strength", hi), mEnd = modsWith("endurance", hi);
const mAgi = modsWith("agility", hi), mSki = modsWith("skill", hi);
console.log(`  strength 20 -> damage x${mStr.damage.toFixed(2)}, weight relief x${mStr.weightRelief.toFixed(2)}`);
console.log(`  endurance 20 -> hp x${mEnd.maxHp.toFixed(2)}, stamina x${mEnd.staminaMax.toFixed(2)}, regen x${mEnd.staminaRegen.toFixed(2)}`);
console.log(`  agility 20 -> speed x${mAgi.moveSpeed.toFixed(2)}, dodge x${mAgi.dodgeDistance.toFixed(2)}`);
console.log(`  skill 20 -> windup x${mSki.windup.toFixed(2)}, parry x${mSki.parryWindow.toFixed(2)}`);
ok(mStr.damage > 1.3, "strength raises damage substantially");
ok(mStr.weightRelief < 0.7, "strength relieves carried weight");
ok(mEnd.maxHp > 1.3 && mEnd.staminaRegen > 1.3, "endurance raises HP and regen");
ok(mAgi.moveSpeed > 1.2 && mAgi.dodgeDistance > 1.3, "agility raises speed and dodge");
ok(mSki.windup < 0.8 && mSki.parryWindow > 1.3, "skill shortens windup and widens parry");

// --- 3. the modifiers reach the SIM -----------------------------------------
console.log("\n-- modifiers reach the simulation --");
const plain = new Fighter({ weapon: "gladius", hp: 100 });
const strong = new Fighter({ weapon: "gladius", hp: 100, mods: mStr });
const tough = new Fighter({ weapon: "gladius", hp: 100, mods: mEnd });
const quick = new Fighter({ weapon: "gladius", hp: 100, mods: mAgi });
console.log(`  hp    plain ${plain.maxHp}  |  endurance ${tough.maxHp}`);
console.log(`  speed plain ${plain.mob.moveSpeed}  |  agility ${quick.mob.moveSpeed}`);
ok(tough.maxHp > plain.maxHp, "endurance raises a Fighter's real max HP");
ok(quick.mob.moveSpeed > plain.mob.moveSpeed, "agility raises a Fighter's real move speed");
ok(strong.mob.moveSpeed > plain.mob.moveSpeed, "strength lightens the load, raising speed");

// damage actually lands harder
function totalDamage(mods) {
  const c = new Combat({ seed: 11 });
  const atk = c.add(new Fighter({ team: 0, weapon: "gladius", x: 0, z: 0, facing: 0, hp: 300, mods }));
  c.add(new Fighter({ team: 1, weapon: "gladius", shield: "none", x: 0, z: 1.0, facing: Math.PI, hp: 100000 }));
  let dealt = 0;
  c.onEvent = (e) => { if (e.type === "hit") dealt += e.damage; };
  for (let i = 0; i < 600; i++) {
    c.command(atk, { attack: atk.canAttack(), attackDir: "high", face: 0 });
    c.update(DT);
  }
  return Math.round(dealt);
}
const dPlain = totalDamage(null), dStrong = totalDamage(mStr);
console.log(`  damage over 10s: plain ${dPlain}  |  strength 20 ${dStrong}`);
ok(dStrong > dPlain * 1.2, `strength materially raises damage dealt (${dPlain} -> ${dStrong})`);

// skill lets a fighter swing more often in the same window
const dSkill = totalDamage(mSki);
console.log(`  damage over 10s: plain ${dPlain}  |  skill 20 ${dSkill}`);
ok(dSkill > dPlain, "skill's shorter windup yields more swings landed");

// --- 4. training ------------------------------------------------------------
console.log("\n-- training --");
const a = new Attributes();
ok(a.slots === SLOTS_PER_MATCH, `starts with ${SLOTS_PER_MATCH} training slots`);
ok(ATTR_IDS.every((id) => a.levels[id] === ATTR_MIN), "every attribute starts at the baseline");

let gold = 500;
const spend = (n) => { gold -= n; };
const r1 = a.train("sandbag", { gold, rankId: "veteranus", spend });
console.log(`  sandbag: +${JSON.stringify(r1.gained)} fatigue ${r1.fatigue} slots ${r1.slots} cost ${r1.cost}`);
ok(r1.ok, "a regimen can be trained");
ok(r1.gained.strength > 0, "the sandbag gives strength XP");
ok(a.fatigue > 0, "training costs fatigue");
ok(gold < 500, "training costs gold");

a.train("palus", { gold, rankId: "veteranus", spend });
a.train("forms", { gold, rankId: "veteranus", spend });
const denied = a.train("running", { gold, rankId: "veteranus", spend });
console.log(`  4th regimen in one gap: ${denied.reason}`);
ok(!denied.ok && /slot/.test(denied.reason), "training slots are limited between matches");

// --- 5. fatigue has teeth ----------------------------------------------------
console.log("\n-- fatigue --");
const f = new Attributes();
for (const id of ATTR_IDS) f.levels[id] = 20;
const fresh = f.effective("strength");
f.fatigue = 100;
const spent = f.effective("strength");
console.log(`  strength 20: fresh ${fresh.toFixed(1)}  |  fully fatigued ${spent.toFixed(1)}`);
ok(spent < fresh * 0.6, "maximum fatigue strips most of a trained advantage");
ok(spent >= ATTR_MIN - 0.01, "fatigue never drops a stat below the baseline floor");
f.fatigue = 0;
ok(Math.abs(f.effective("strength") - 20) < 0.001, "resting restores the full trained value");

const restA = new Attributes();
restA.fatigue = 60;
restA.train("rest", { gold: 999, rankId: "veteranus" });
console.log(`  rest: fatigue 60 -> ${restA.fatigue}`);
ok(restA.fatigue < 60, "rest lowers fatigue");

// --- 6. rank ceiling ---------------------------------------------------------
console.log("\n-- rank ceiling --");
const t = new Attributes();
let guard = 0;
while (guard++ < 400) {
  t.slots = 99;
  const r = t.train("sandbag", { gold: 99999, rankId: "tiro" });
  if (!r.ok) break;
}
console.log(`  a Tiro grinding forever reaches strength ${t.levels.strength} (cap ${RANK_CAP.tiro})`);
ok(t.levels.strength <= RANK_CAP.tiro, "the rank ceiling cannot be ground past");
ok(t.levels.strength === RANK_CAP.tiro, "but the ceiling IS reachable");

const l = new Attributes();
l.slots = 999;
for (let i = 0; i < 400; i++) l.train("sandbag", { gold: 999999, rankId: "legend" });
console.log(`  a Legend reaches strength ${l.levels.strength} (max ${ATTR_MAX})`);
ok(l.levels.strength <= ATTR_MAX, "the absolute maximum is respected");

// --- 7. diminishing returns --------------------------------------------------
console.log("\n-- diminishing returns --");
const early = xpForNext(ATTR_MIN), late = xpForNext(ATTR_MAX - 1);
console.log(`  xp for the first point ${early}, for the last ${late}`);
ok(late > early * 4, "late points cost several times what early points cost");

// --- 8. inventory integration + save round-trip ------------------------------
console.log("\n-- inventory integration --");
const inv = new Inventory();
inv.gold = 3000;
const speed0 = inv.mobility().moveSpeed;
inv.attrs.slots = 99;
for (let i = 0; i < 30; i++) inv.attrs.train("footwork", { gold: inv.gold, rankId: "legend", spend: (n) => { inv.gold -= n; } });
inv.attrs.fatigue = 0;
const speed1 = inv.mobility().moveSpeed;
console.log(`  move speed before training ${speed0} -> after agility training ${speed1}`);
ok(speed1 > speed0, "training agility raises the inventory's reported move speed");

const mem = (() => { const s = {}; return { getItem: (k) => s[k] ?? null, setItem: (k, v) => { s[k] = v; } }; })();
inv.save(mem);
const back = Inventory.restore(mem);
console.log(`  restored agility ${back.attrs.levels.agility} (was ${inv.attrs.levels.agility})`);
ok(back.attrs.levels.agility === inv.attrs.levels.agility, "attributes survive a save round-trip");
ok(Math.abs(back.mobility().moveSpeed - speed1) < 0.001, "restored speed matches");

// a v1 save (no attributes) must migrate cleanly
const v1 = { v: 1, name: "Old", gold: 90, wins: 5, owned: { weapon: ["gladius"], shield: ["none"], armour: [] } };
const mig = new Inventory(v1);
console.log(`  v1 save migrated: gold ${mig.gold}, strength ${mig.attrs.levels.strength}`);
ok(mig.gold === 90, "v1 scalars survive");
ok(mig.attrs.levels.strength === ATTR_MIN, "a v1 career starts at the attribute baseline");

// --- 9. a match refreshes slots ----------------------------------------------
console.log("\n-- match cycle --");
const inv2 = new Inventory();
inv2.attrs.slots = 0;
inv2.attrs.fatigue = 70;
inv2.settle({ won: true, kills: 1, crowdFavour: 0.6 });
console.log(`  after a bout: slots ${inv2.attrs.slots}, fatigue ${inv2.attrs.fatigue}`);
ok(inv2.attrs.slots === SLOTS_PER_MATCH, "a completed match refreshes the training slots");
ok(inv2.attrs.fatigue > 0, "a bout leaves you tired");

console.log(`\n-- verdict --\n  ${checks} checks, ${fails} failed`);
if (fails) { console.log("  ATTRIBUTES PROBE: FAIL"); process.exit(1); }
console.log("  ATTRIBUTES PROBE: PASS");
process.exit(0);
