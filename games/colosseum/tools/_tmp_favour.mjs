// Read-only: measure what crowd favour actually does across real bouts.
import { Match, STATE } from "../runtime/sim/match.js";
import { Inventory } from "../runtime/sim/inventory.js";
import { LADDER } from "../runtime/data/roster.js";
import { Brain } from "../runtime/sim/ai.js";

const DT = 1 / 60;

function kit(gold = 5000) {
  const inv = new Inventory();
  inv.gold = gold;
  for (const id of ["galea", "manica", "ocreae"]) inv.buy("armour", id);
  inv.buy("shield", "scutum");
  inv.equip("helmet", "galea"); inv.equip("arm", "manica");
  inv.equip("legs", "ocreae"); inv.equip("shield", "scutum");
  return inv;
}

function run(def, seed, playerSkill = "veteranus") {
  const inv = kit();
  const m = new Match({ def, inventory: inv, seed });
  m.start();
  let pBrain = null, t = 0;
  const trace = [];
  let parries = 0, hits = 0;
  const origHook = m.hooks.onEvent;
  m.hooks.onEvent = (e) => {
    if (e.type === "parry" && e.target === "player") parries++;
    if (e.type === "hit" && e.attacker === "player") hits++;
    if (origHook) origHook(e);
  };
  while (t < 240 && m.state !== STATE.DONE) {
    let cmd = {};
    if (m.state === STATE.FIGHT) {
      if (!pBrain) pBrain = new Brain(m.player, { skill: playerSkill, style: "pressure", seed: seed * 31, combat: m.combat });
      cmd = pBrain.update(DT);
    }
    m.update(DT, cmd);
    if (m.state === STATE.FIGHT) {
      const hpFrac = m.player.alive ? m.player.hp / m.player.maxHp : 0;
      const model = Math.min(1, 0.25 + hpFrac * 0.4 + m.playerKills * 0.12);
      trace.push({ f: m.crowdFavour, model });
    }
    t += DT;
  }
  // Correlation between live favour and the pure hp+kills model.
  const n = trace.length || 1;
  const mf = trace.reduce((s, x) => s + x.f, 0) / n;
  const mm = trace.reduce((s, x) => s + x.model, 0) / n;
  let cov = 0, vf = 0, vm = 0;
  for (const x of trace) { cov += (x.f - mf) * (x.model - mm); vf += (x.f - mf) ** 2; vm += (x.model - mm) ** 2; }
  const r = vf > 0 && vm > 0 ? cov / Math.sqrt(vf * vm) : NaN;
  const maxDev = trace.reduce((s, x) => Math.max(s, Math.abs(x.f - x.model)), 0);
  return {
    id: def.id, seed, won: !!(m.result && m.result.playerWon),
    favour: +m.crowdFavour.toFixed(3), purse: m.result ? m.result.purse : 0,
    kills: m.playerKills, parries, hits,
    r: +r.toFixed(3), maxDev: +maxDev.toFixed(3),
    ticks: n,
  };
}

console.log("=== CROWD FAVOUR: is it doing work? ===");
console.log("Model = clamp(0.25 + hpFrac*0.4 + kills*0.12). r = correlation of LIVE favour vs that model.");
console.log("maxDev = largest instantaneous gap the event bonuses (hit/parry/kill spikes) ever open.\n");
const rows = [];
for (const id of ["t2", "g1", "g4", "v1", "c1"]) {
  const def = LADDER.find((m) => m.id === id);
  for (const s of [3, 11, 29]) rows.push(run(def, s));
}
console.log("bout seed won favour purse kills parries  r    maxDev ticks");
for (const x of rows) {
  console.log(` ${x.id.padEnd(4)} ${String(x.seed).padStart(4)} ${String(x.won).padEnd(5)} ${String(x.favour).padStart(5)} ${String(x.purse).padStart(5)} ${String(x.kills).padStart(5)} ${String(x.parries).padStart(7)} ${String(x.r).padStart(6)} ${String(x.maxDev).padStart(6)} ${x.ticks}`);
}
const favs = rows.map((x) => x.favour);
console.log(`\nfinal favour across ${rows.length} bouts: min ${Math.min(...favs).toFixed(3)} max ${Math.max(...favs).toFixed(3)} spread ${(Math.max(...favs) - Math.min(...favs)).toFixed(3)}`);
console.log("purse multiplier = 0.7 + favour*0.6  ->  observed range",
  (0.7 + Math.min(...favs) * 0.6).toFixed(3), "to", (0.7 + Math.max(...favs) * 0.6).toFixed(3),
  `= ${(((0.7 + Math.max(...favs) * 0.6) / (0.7 + Math.min(...favs) * 0.6) - 1) * 100).toFixed(1)}% swing`);
console.log("theoretical full range (favour 0..1):", (0.7).toFixed(2), "to", (1.3).toFixed(2), "= 85.7% swing");

console.log("\n=== decay time constant of an event bonus ===");
// crowdFavour += (target - favour) * min(1, 0.5*dt)  -> per-tick alpha
const alpha = Math.min(1, 0.5 * DT);
console.log("alpha per 1/60s tick:", alpha.toFixed(6), " => time constant", (1 / (alpha * 60)).toFixed(2), "s");
let v = 0.06; // a parry bonus
let s = 0;
while (v > 0.006) { v *= (1 - alpha); s += DT; }
console.log(`a +0.06 parry bonus decays to <0.006 (10%) in ${s.toFixed(2)} s`);
console.log(`purse value of one parry at the moment it lands: ${(0.06 * 0.6 * 100).toFixed(1)}% of purse — but only if the bout ends in the next instant.`);
