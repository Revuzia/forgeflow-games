// Headless probe for the economy, equipment slots and save migration.
// run: node games/colosseum/tools/probe_inventory.mjs

import { Inventory, RANKS, rankFor, SLOT_ORDER, SAVE_VERSION } from "../runtime/sim/inventory.js";
import { WEAPONS, SHIELDS, ARMOUR, ARMATURAE } from "../runtime/data/weapons.js";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL:", m); } };

console.log("\n=== INVENTORY PROBE ===\n");

// --- starting state ---------------------------------------------------------
const inv = new Inventory();
console.log("-- start --");
console.log(`  gold ${inv.gold}, rank ${inv.rank().name}, weapon ${inv.equipped.weapon}, ${inv.weight()} kg`);
ok(inv.gold === 150, "starts with 150 aurei");
ok(inv.equipped.weapon === "gladius", "starts with a gladius");
ok(inv.armourList().length === 0, "starts unarmoured");
ok(inv.rank().id === "tiro", "starts as a Tiro");

// --- affordability gate -----------------------------------------------------
console.log("\n-- economy refuses what you cannot afford --");
const tooDear = inv.buy("armour", "lorica");
console.log(`  lorica (${ARMOUR.lorica.price}) with ${inv.gold}: ${tooDear.reason}, short ${tooDear.short}`);
ok(!tooDear.ok && tooDear.short === ARMOUR.lorica.price - 150, "refuses and reports the shortfall");
ok(inv.gold === 150, "a refused purchase costs nothing");
ok(!inv.equip("helmet", "galea").ok, "cannot equip what you do not own");

// --- the trade-off is real --------------------------------------------------
console.log("\n-- mobility vs protection --");
const bare = inv.mobility();
inv.gold = 5000;
for (const id of ["galea", "manica", "ocreae", "lorica"]) ok(inv.buy("armour", id).ok, `buys ${id}`);
ok(inv.buy("shield", "scutum").ok, "buys a scutum");
inv.equip("helmet", "galea"); inv.equip("arm", "manica");
inv.equip("legs", "ocreae"); inv.equip("torso", "lorica"); inv.equip("shield", "scutum");
const kitted = inv.mobility();
console.log(`  bare   ${bare.weight} kg  ${bare.moveSpeed} m/s  stam ${bare.staminaMax} regen ${bare.staminaRegen}`);
console.log(`  kitted ${kitted.weight} kg  ${kitted.moveSpeed} m/s  stam ${kitted.staminaMax} regen ${kitted.staminaRegen}`);
ok(kitted.weight > bare.weight * 5, "a full kit is many times heavier");
ok(kitted.moveSpeed < bare.moveSpeed * 0.8, "and measurably slower");
ok(kitted.staminaRegen < bare.staminaRegen * 0.75, "and recovers worse");
ok(kitted.dodgeDistance < bare.dodgeDistance, "and dodges shorter");

// --- preview deltas ---------------------------------------------------------
console.log("\n-- equip preview reports a truthful delta --");
const inv2 = new Inventory();
inv2.gold = 5000;
inv2.buy("armour", "lorica");
const pv = inv2.previewEquip("torso", "lorica");
console.log(`  lorica: speed ${pv.delta.moveSpeed} m/s, load ${pv.delta.weight} kg, regen ${pv.delta.staminaRegen}/s`);
ok(pv.delta.weight > 0, "preview shows added weight");
ok(pv.delta.moveSpeed < 0, "preview shows lost speed");
ok(inv2.equipped.torso === null, "preview does NOT mutate the loadout");

// --- slot discipline --------------------------------------------------------
console.log("\n-- slot rules --");
ok(!inv2.equip("helmet", "ocreae").ok, "greaves cannot go on the head");
ok(!inv2.equip("weapon", null).ok, "cannot fight bare-handed");
ok(inv2.equip("shield", null).ok, "the shield slot CAN be emptied");
ok(SLOT_ORDER.length === 6, "six equipment slots");

// --- armatura recognition ---------------------------------------------------
console.log("\n-- armatura recognition --");
const m = new Inventory();
m.gold = 9999;
const A = ARMATURAE.murmillo;
m.buy("shield", A.shield);
for (const a of A.armour) m.buy("armour", a);
m.equip("shield", A.shield);
m.equip("helmet", "galea"); m.equip("arm", "manica"); m.equip("legs", "ocreae");
const matched = m.matchedArmatura();
console.log(`  gladius + scutum + galea/manica/ocreae -> ${matched ? matched.name : "none"}`);
ok(matched && matched.id === "murmillo", "a matching kit is recognised as a Murmillo");

// --- purses and rank --------------------------------------------------------
console.log("\n-- purses scale with rank --");
const c = new Inventory();
const seen = [];
for (let i = 0; i < 40; i++) {
  const r = c.settle({ won: true, kills: 1, crowdFavour: 0.6, matchId: `m${i}` });
  if (r.rankUp) seen.push(`${r.rankUp.name}@${c.wins}`);
}
console.log(`  after 40 wins: ${c.gold} gold, rank ${c.rank().name}`);
console.log(`  rank-ups: ${seen.join(", ")}`);
ok(seen.length === RANKS.length - 1, `every rank is reachable (${seen.length}/${RANKS.length - 1})`);
ok(c.rank().id === "legend", "40 wins reaches Legend");
ok(rankFor(0).id === "tiro" && rankFor(999).id === "legend", "rankFor clamps at both ends");

const lose = new Inventory();
const lossPurse = lose.settle({ won: false, kills: 0, crowdFavour: 0.5 });
console.log(`  a loss still pays ${lossPurse.purse}`);
ok(lossPurse.purse > 0 && lossPurse.purse < RANKS[0].purse, "losing pays something, but less than winning");
ok(lose.losses === 1 && lose.wins === 0, "a loss is recorded as a loss");

// --- persistence ------------------------------------------------------------
console.log("\n-- save / restore --");
const mem = (() => { const s = {}; return { getItem: (k) => s[k] ?? null, setItem: (k, v) => { s[k] = v; } }; })();
const src = new Inventory();
src.gold = 777; src.wins = 12; src.name = "Verus";
src.buy("armour", "galea"); src.equip("helmet", "galea");
// Buying deducts, so the expected balance is post-purchase — asserting the
// pre-purchase 777 here was a bug in this test, not in the save.
const expectedGold = 777 - ARMOUR.galea.price;
ok(src.gold === expectedGold, `purchase deducted (${src.gold} === ${expectedGold})`);
ok(src.save(mem), "saves to storage");
const back = Inventory.restore(mem);
console.log(`  restored: ${back.name}, ${back.gold} gold, ${back.wins} wins, helm ${back.equipped.helmet}`);
ok(back.gold === expectedGold && back.wins === 12 && back.name === "Verus", "round-trips scalar state");
ok(back.equipped.helmet === "galea", "round-trips equipment");
ok(back.rank().id === src.rank().id, "restores to the same rank");

// --- migration + resilience -------------------------------------------------
console.log("\n-- migration and hostile saves --");
const v0 = { name: "Old", gold: 42, wins: 4, armour: ["galea"], equipped: { weapon: "gladius", helmet: "galea" } };
const mig = new Inventory(v0);
console.log(`  v0 save -> v${SAVE_VERSION}: gold ${mig.gold}, owns ${JSON.stringify(mig.owned.armour)}`);
ok(mig.gold === 42, "v0 scalars survive migration");
ok(mig.owned.armour.includes("galea"), "v0 flat armour array is migrated into owned.armour");

const junk = new Inventory({ v: 1, gold: "lots", owned: { weapon: ["deathray"], armour: ["plotarmour"] }, equipped: { weapon: "deathray", helmet: "plotarmour" } });
console.log(`  junk save -> gold ${junk.gold}, weapon ${junk.equipped.weapon}, armour ${JSON.stringify(junk.owned.armour)}`);
ok(junk.gold === 150, "a non-numeric gold value falls back to the default");
ok(junk.equipped.weapon === "gladius", "an unknown weapon falls back to the gladius");
ok(junk.owned.armour.length === 0, "unknown armour ids are dropped, not kept");
ok(Inventory.restore({ getItem: () => "{{{not json" , setItem(){} }).gold === 150, "corrupt JSON does not throw");

// --- catalogue integrity ----------------------------------------------------
console.log("\n-- catalogue --");
const cat = new Inventory().catalogue();
const slots = new Set(cat.map((c2) => c2.slot));
console.log(`  ${cat.length} purchasable items across slots: ${[...slots].join(", ")}`);
ok(cat.length >= 12, "the shop has a meaningful number of items");
ok(cat.every((c2) => c2.name && c2.desc), "every item has a name and description");
ok(cat.every((c2) => c2.stats && Object.keys(c2.stats).length), "every item exposes stats for the UI");
ok(!cat.some((c2) => c2.id === "none"), "the empty shield is not sold");
ok(cat.every((c2, i, arr) => i === 0 || arr[i - 1].tier <= c2.tier), "catalogue is ordered by tier");

console.log(`\n-- verdict --\n  ${checks} checks, ${fails} failed`);
if (fails) { console.log("  INVENTORY PROBE: FAIL"); process.exit(1); }
console.log("  INVENTORY PROBE: PASS");
process.exit(0);
