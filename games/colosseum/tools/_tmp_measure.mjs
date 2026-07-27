// Read-only measurement of Colosseum content variety + crowd-favour behaviour.
import { LADDER, MATCH_TYPES, ARMATURA_ROSTER, ORIGINS, CHAMPIONS, BEAST_ROSTER, makeOpponent } from "../runtime/data/roster.js";

console.log("=== LADDER COMPOSITION ===");
console.log("bouts:", LADDER.length);
const byType = {};
let oppSpecs = 0, multiOpp = 0, withAllies = 0;
const combos = new Set();
for (const m of LADDER) {
  byType[m.type] = (byType[m.type] || 0) + 1;
  const opps = (m.opponents || []).slice();
  if (m.champion) opps.unshift({ champion: m.champion });
  oppSpecs += opps.length;
  if (opps.length > 1) multiOpp++;
  if ((m.allies || m.ally)) withAllies++;
  for (const o of opps) combos.add(o.champion ? `champ:${o.champion}` : `${o.armatura}/${o.skill}`);
}
console.log("by type:", JSON.stringify(byType));
console.log("total opponent specs across whole ladder:", oppSpecs);
console.log("bouts with >1 opponent:", multiOpp, " bouts with allies:", withAllies);
console.log("DISTINCT (armatura/skill) or champion combos in the ENTIRE game:", combos.size);
console.log([...combos].sort().join("  "));

console.log("\n=== ARMATURAE USED vs DEFINED ===");
const defined = Object.keys(ARMATURA_ROSTER);
const used = new Set();
for (const m of LADDER) {
  for (const o of m.opponents || []) used.add(o.armatura);
  if (m.champion) used.add(CHAMPIONS.find(c => c.id === m.champion)?.armatura);
  for (const a of m.allies || (m.ally ? [m.ally] : [])) used.add(a.armatura);
  if (m.tertiarius) used.add(m.tertiarius.armatura);
}
console.log("defined:", defined.length, defined.join(","));
console.log("appear as an opponent/ally anywhere in the ladder:", used.size, [...used].join(","));
console.log("NEVER fielded:", defined.filter(d => !used.has(d)).join(",") || "(none)");

console.log("\n=== BEASTS ===");
console.log("roster:", BEAST_ROSTER.length, "with a real asset:", BEAST_ROSTER.filter(b => b.asset).length,
  "->", BEAST_ROSTER.filter(b => b.asset).map(b => b.id).join(","));
const beastBouts = LADDER.filter(m => m.beasts);
console.log("venatio bouts:", beastBouts.length, beastBouts.map(m => `${m.id}:${m.beasts.join("+")}`).join(" "));
console.log("beasts per venatio bout:", beastBouts.map(m => m.beasts.length).join(","));

console.log("\n=== NAME POOL ===");
const total = Object.values(ORIGINS).reduce((s, o) => s + o.names.length, 0);
console.log("origins:", Object.keys(ORIGINS).length, "total distinct names:", total);
console.log("per origin:", Object.values(ORIGINS).map(o => `${o.id}=${o.names.length}`).join(" "));
const crowdBias = Object.values(ORIGINS).map(o => o.crowd);
console.log("origin crowd bias values:", crowdBias.join(","), " -> distinct:", [...new Set(crowdBias)].join(","));

console.log("\n=== IS crowdBias WIRED TO ANYTHING? ===");
// makeOpponent returns crowdBias; who reads it?
const o = makeOpponent("thraex", { skill: "gregarius", rng: () => 0.5 });
console.log("makeOpponent output keys:", Object.keys(o).join(","));
