// Read-only: ladder gating arithmetic + the loss-purse question.
import { LADDER } from "../runtime/data/roster.js";
import { Inventory, RANKS, rankFor } from "../runtime/sim/inventory.js";

const ORDER = ["tiro", "gregarius", "veteranus", "primus", "champion", "legend"];
// Given as measured fact by the caller.
const UNWINNABLE = new Set(["v2", "p2", "p3", "c3", "l1", "l3"]);

console.log("=== RANK GATING ARITHMETIC ===");
console.log("rank        minWins  bouts at rank  winnable at rank");
for (const r of RANKS) {
  const at = LADDER.filter((m) => m.rank === r.id);
  const win = at.filter((m) => !UNWINNABLE.has(m.id));
  console.log(`${r.name.padEnd(12)} ${String(r.minWins).padStart(5)} ${String(at.length).padStart(13)} ${String(win.length).padStart(17)}`);
}
const belowLegend = LADDER.filter((m) => m.rank !== "legend");
const winnableBelow = belowLegend.filter((m) => !UNWINNABLE.has(m.id));
console.log(`\nLegend rank requires ${RANKS.find(r => r.id === "legend").minWins} wins.`);
console.log(`Distinct WINNABLE bouts below Legend: ${winnableBelow.length} (${winnableBelow.map(m => m.id).join(",")})`);
console.log(`=> minimum REPLAYS of already-completed bouts to unlock Legend: ${36 - winnableBelow.length}`);
console.log(`Total winnable bouts in the game: ${LADDER.filter(m => !UNWINNABLE.has(m.id)).length} of ${LADDER.length}`);

console.log("\n=== WHAT HAPPENS AT 100% COMPLETION (menu.js:180-183) ===");
const inv = new Inventory();
for (const m of LADDER) inv.completed[m.id] = true;
inv.wins = 40;
const rankOk = (m) => ORDER.indexOf(m.rank) <= ORDER.indexOf(rankFor(inv.wins).id);
const next = LADDER.find((m) => !inv.completed[m.id] && rankOk(m));
console.log("ladder.find(!completed && rankOk) =>", next === undefined ? "undefined" : next.id);
console.log('=> "Enter the Arena" button disabled:', !next, "  (menu.js line 183: { accent: true, disabled: !nextMatch })");
console.log("   Remaining hub buttons: Armoury, Blacksmith, Training, Settings, Abandon the Ludus.");

console.log("\n=== LOSS PURSE vs WIN PURSE (match.js:382 bonus is paid on a LOSS too) ===");
function settleSim({ won, rankWins, defPurse, favour = 0.32, kills = 0 }) {
  const i = new Inventory();
  i.wins = rankWins;
  const r = i.settle({ won, kills, flawless: false, crowdFavour: favour, matchId: "x", bonus: Math.round(defPurse * 0.35) });
  return r.purse;
}
console.log("player at 24 wins (Champion rank, base purse 520):");
const cases = [
  ["WIN  c1 Iron Gaul   (purse 600)", true, 600],
  ["LOSE c1 Iron Gaul   (purse 600)", false, 600],
  ["LOSE l1 Thirty-Four (purse 1000, UNWINNABLE)", false, 1000],
  ["LOSE l3 The Emperor (purse 1600, UNWINNABLE)", false, 1600],
  ["WIN  g1 Scutum/Sica (purse 110)", true, 110],
];
for (const [label, won, p] of cases) {
  console.log(`  ${label.padEnd(46)} -> ${String(settleSim({ won, rankWins: 24, defPurse: p })).padStart(5)} aurei`);
}
console.log("\nLosing costs: +28 fatigue (attributes.js:239) and +1 to losses. No gold lost, no item lost, matchId not consumed.");

console.log("\n=== TOTAL LADDER PURSE vs SHOP COST ===");
const shopTotal = 320 + 260 + 380 + 300 + 540 + 180 + 420 + 150 + 190 + 340 + 620;
console.log("cost to own every purchasable item (weapons.js prices):", shopTotal, "aurei");
console.log("sum of all 25 ladder purses (headline numbers):", LADDER.reduce((s, m) => s + m.purse, 0));
