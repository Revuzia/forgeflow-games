// Headless probe: condition, wear, repair and reinforcement.
// The central assertion is THE RULE: no reinforcement may be strictly better.
// run: node games/colosseum/tools/probe_blacksmith.mjs

import { Smithy, REINFORCEMENTS, CONDITION, conditionOf } from "../runtime/sim/blacksmith.js";
import { Inventory } from "../runtime/sim/inventory.js";
import { WEAPONS, SHIELDS, ARMOUR } from "../runtime/data/weapons.js";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL:", m); } };

console.log("\n=== BLACKSMITH PROBE ===\n");

// --- 1. THE RULE ------------------------------------------------------------
console.log("-- no reinforcement is strictly better --");
for (const p of Object.values(REINFORCEMENTS)) {
  const e = p.effect;
  const gains = [], costs = [];
  const better = { damage: 1, pierce: 1, integrity: 1, protection: 1 };
  const worseIfUp = { weight: 1, windup: 1, wearRate: 1 };
  for (const [k, v] of Object.entries(e)) {
    if (better[k]) (v > 0 ? gains : costs).push(k);
    else if (worseIfUp[k]) (v > 0 ? costs : gains).push(k);
  }
  console.log(`  ${p.name.padEnd(18)} gains [${gains.join(",")}]  costs [${costs.join(",")}]`);
  ok(gains.length > 0, `${p.name} actually gives something`);
  ok(costs.length > 0, `${p.name} COSTS something — no strictly-better upgrade`);
}

// --- 2. condition bands ------------------------------------------------------
console.log("\n-- condition --");
const s = new Smithy();
ok(s.cond("gladius") === 1, "unused gear is pristine");
console.log(`  1.00 -> ${conditionOf(1).name}, 0.50 -> ${conditionOf(0.5).name}, 0.10 -> ${conditionOf(0.1).name}`);
ok(conditionOf(1).id === "pristine" && conditionOf(0.1).id === "ruined", "bands map correctly");
ok(conditionOf(0.1).mult < conditionOf(1).mult, "a ruined item performs worse");
ok(CONDITION.every((c, i, a) => i === 0 || a[i - 1].mult >= c.mult), "condition multipliers descend monotonically");

// --- 3. wear ----------------------------------------------------------------
console.log("\n-- wear from a bout --");
const s2 = new Smithy();
const loadout = { weapon: "gladius", shield: "scutum", armour: ["galea", "ocreae"] };
const worn = s2.wearFromMatch(loadout, { damageDealt: 420, damageTaken: 260, blocks: 14 });
console.log(`  after one hard bout:`, Object.entries(worn).map(([k, v]) => `${k} -${(v * 100).toFixed(1)}%`).join("  "));
ok(s2.cond("gladius") < 1, "the weapon wears");
ok(s2.cond("scutum") < 1, "the shield wears");
ok(s2.cond("galea") < 1, "armour wears");
ok(s2.cond("scutum") < s2.cond("gladius"), "a shield wears FASTER than a blade — it eats what it stops");
ok(Object.values(worn).every((v) => v < 0.5), "one bout does not destroy a piece");

// many bouts DO wear it out
const s3 = new Smithy();
for (let i = 0; i < 40; i++) s3.wearFromMatch(loadout, { damageDealt: 400, damageTaken: 250, blocks: 12 });
console.log(`  after 40 bouts: gladius ${conditionOf(s3.cond("gladius")).name}, scutum ${conditionOf(s3.cond("scutum")).name}`);
ok(s3.cond("scutum") < 0.5, "sustained use genuinely degrades a shield");

// --- 4. repair ---------------------------------------------------------------
console.log("\n-- repair --");
const rc = s3.repairCost("scutum");
console.log(`  repairing a ${conditionOf(s3.cond("scutum")).name} scutum costs ${rc} (it sells for ${SHIELDS.scutum.price})`);
ok(rc > 0, "a worn item costs something to repair");
ok(rc < SHIELDS.scutum.price, "repair is cheaper than replacement");
const poor = s3.repair("scutum", 5);
ok(!poor.ok, "cannot repair without the gold");
const fixed = s3.repair("scutum", 99999, () => {});
ok(fixed.ok && s3.cond("scutum") === 1, "repair restores to pristine");
ok(!s3.repair("scutum", 99999).ok, "repairing a pristine item is refused");

// repair cost scales with damage
const a = new Smithy(); a.condition.scutum = 0.9;
const b = new Smithy(); b.condition.scutum = 0.2;
console.log(`  cost at 90% condition ${a.repairCost("scutum")}, at 20% ${b.repairCost("scutum")}`);
ok(b.repairCost("scutum") > a.repairCost("scutum") * 3, "a badly damaged item costs far more to repair");

// --- 5. reinforcement --------------------------------------------------------
console.log("\n-- reinforcement --");
const s4 = new Smithy();
const opts = s4.optionsFor("gladius");
console.log(`  gladius paths: ${opts.map((o) => `${o.name}(${o.cost})`).join(", ")}`);
ok(opts.length >= 2, "a weapon has multiple reinforcement paths");
ok(opts.every((o) => o.tier === 0), "nothing starts reinforced");
ok(s4.optionsFor("gladius").every((o) => REINFORCEMENTS[o.id].kinds.includes("weapon")),
   "only weapon paths are offered for a weapon");
ok(!s4.applyReinforcement("gladius", "hardened", 99999).ok, "an armour path is refused on a weapon");

const r1 = s4.applyReinforcement("gladius", "weighted", 99999, () => {});
console.log(`  weighted I: cost ${r1.cost}, condition now ${s4.cond("gladius").toFixed(2)}`);
ok(r1.ok, "a reinforcement can be applied");
ok(s4.cond("gladius") < 1, "reworking metal costs condition");

const m = s4.modifiersFor("gladius");
console.log(`  after weighted I: damage x${m.damage.toFixed(3)}, weight +${m.weight}, windup x${m.windup.toFixed(2)}`);
ok(m.weight > 0, "weighting adds weight");
ok(m.windup > 1, "weighting slows the swing");

// cost grows per tier, and tiers cap
const c1 = s4.reinforceCost("gladius", "weighted");
s4.applyReinforcement("gladius", "weighted", 99999, () => {});
const c2 = s4.reinforceCost("gladius", "weighted");
console.log(`  tier cost grows: ${c1} -> ${c2}`);
ok(c2 > c1, "each tier costs more than the last");
let guard = 0;
while (s4.applyReinforcement("gladius", "weighted", 9e9, () => {}).ok && guard++ < 20) { /* cap it */ }
ok(s4.tiersOn("gladius", "weighted") === REINFORCEMENTS.weighted.tiers, "tiers cap at the path maximum");

// a ruined item cannot be reinforced
const s5 = new Smithy();
s5.condition.gladius = 0.2;
const refused = s5.applyReinforcement("gladius", "weighted", 99999);
console.log(`  reinforcing a ruined blade: ${refused.reason}`);
ok(!refused.ok, "a smith refuses to work ruined metal");

// --- 6. opposing paths really oppose -----------------------------------------
console.log("\n-- opposing paths --");
const heavy = new Smithy(); heavy.applyReinforcement("gladius", "weighted", 9e9, () => {});
const light = new Smithy(); light.applyReinforcement("gladius", "balanced", 9e9, () => {});
const mh = heavy.modifiersFor("gladius"), ml = light.modifiersFor("gladius");
console.log(`  weighted: dmg x${mh.damage.toFixed(2)} wt ${mh.weight >= 0 ? "+" : ""}${mh.weight.toFixed(2)} windup x${mh.windup.toFixed(2)}`);
console.log(`  balanced: dmg x${ml.damage.toFixed(2)} wt ${ml.weight.toFixed(2)} windup x${ml.windup.toFixed(2)}`);
ok(mh.damage > ml.damage, "weighted hits harder than balanced");
ok(ml.weight < mh.weight, "balanced is lighter than weighted");
ok(ml.windup < mh.windup, "balanced swings faster than weighted");

// --- 7. condition beats reinforcement ----------------------------------------
console.log("\n-- maintenance is never optional --");
const masterwork = new Smithy();
for (let i = 0; i < 3; i++) masterwork.applyReinforcement("gladius", "weighted", 9e9, () => {});
masterwork.condition.gladius = 0.05;                      // ruined
const plain = new Smithy();
const mwDmg = masterwork.modifiersFor("gladius").damage;
const plDmg = plain.modifiersFor("gladius").damage;
console.log(`  ruined masterwork x${mwDmg.toFixed(2)} vs pristine plain x${plDmg.toFixed(2)}`);
ok(mwDmg < plDmg, "a RUINED masterwork is worse than a pristine plain blade");

// --- 8. inventory integration + save -----------------------------------------
console.log("\n-- inventory integration --");
const inv = new Inventory();
inv.gold = 5000;
inv.buy("shield", "scutum"); inv.equip("shield", "scutum");
const w0 = inv.weight();
inv.smithy.applyReinforcement("scutum", "faced", inv.gold, (n) => { inv.gold -= n; });
const w1 = inv.weight();
console.log(`  loadout weight before facing ${w0} kg -> after ${w1} kg`);
ok(w1 > w0, "reinforcement weight reaches the inventory's loadout weight");

const mem = (() => { const st = {}; return { getItem: (k) => st[k] ?? null, setItem: (k, v) => { st[k] = v; } }; })();
inv.smithy.condition.scutum = 0.42;
inv.save(mem);
const back = Inventory.restore(mem);
console.log(`  restored: scutum condition ${back.smithy.cond("scutum").toFixed(2)}, faced tier ${back.smithy.tiersOn("scutum", "faced")}`);
ok(Math.abs(back.smithy.cond("scutum") - 0.42) < 0.001, "condition survives a save round-trip");
ok(back.smithy.tiersOn("scutum", "faced") === 1, "reinforcements survive a save round-trip");

const v2 = { v: 2, gold: 77, wins: 3, owned: { weapon: ["gladius"], shield: ["none"], armour: [] } };
const mig = new Inventory(v2);
console.log(`  v2 save migrated: gold ${mig.gold}, gladius condition ${mig.smithy.cond("gladius")}`);
ok(mig.gold === 77 && mig.smithy.cond("gladius") === 1, "a v2 career migrates with pristine gear");

const junk = new Inventory({ v: 3, smithy: { condition: { notAThing: 0.5, gladius: 0.7 }, reinforce: { ghost: { weighted: 9 } } } });
ok(junk.smithy.cond("gladius") === 0.7, "valid condition survives a hostile save");
ok(junk.smithy.condition.notAThing === undefined, "unknown items are dropped from a hostile save");

console.log(`\n-- verdict --\n  ${checks} checks, ${fails} failed`);
if (fails) { console.log("  BLACKSMITH PROBE: FAIL"); process.exit(1); }
console.log("  BLACKSMITH PROBE: PASS");
process.exit(0);
