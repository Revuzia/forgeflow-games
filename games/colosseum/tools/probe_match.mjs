// Headless probe for the match director: ceremony beats, every match type,
// verdict, purse settlement. run: node games/colosseum/tools/probe_match.mjs

import { Match, STATE } from "../runtime/sim/match.js";
import { Inventory } from "../runtime/sim/inventory.js";
import { LADDER, MATCH_TYPES } from "../runtime/data/roster.js";
import { Brain } from "../runtime/sim/ai.js";

let checks = 0, fails = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log("  FAIL:", m); } };
const DT = 1 / 60;

/**
 * Run a whole bout with the player slot driven by an AI brain, so the probe
 * exercises the real command path rather than a scripted stub.
 */
function runMatch(def, { seed = 1, maxT = 240, playerSkill = "veteranus", gold = 5000 } = {}) {
  const inv = new Inventory();
  inv.gold = gold;
  for (const id of ["galea", "manica", "ocreae"]) inv.buy("armour", id);
  inv.buy("shield", "scutum");
  inv.equip("helmet", "galea"); inv.equip("arm", "manica");
  inv.equip("legs", "ocreae"); inv.equip("shield", "scutum");

  const cues = [];
  const states = [];
  const m = new Match({
    def, inventory: inv, seed,
    hooks: {
      onCue: (n, d) => cues.push({ n, ...d }),
      onState: (s) => states.push(s),
    },
  });
  m.start();

  // Drive the player with a brain once the fight actually begins.
  let pBrain = null;
  let t = 0;
  while (t < maxT && m.state !== STATE.DONE) {
    let cmd = {};
    if (m.state === STATE.FIGHT) {
      if (!pBrain) pBrain = new Brain(m.player, { skill: playerSkill, style: "pressure", seed: seed * 31, combat: m.combat });
      cmd = pBrain.update(DT);
    }
    m.update(DT, cmd);
    t += DT;
  }
  return { m, inv, cues, states, t: +t.toFixed(1) };
}

console.log("\n=== MATCH PROBE ===\n");

// --- 1. ceremony beats ------------------------------------------------------
console.log("-- ceremony --");
const first = LADDER.find((x) => x.type === "single");
const r1 = runMatch(first, { seed: 7 });
console.log(`  ${first.name}: states ${r1.states.join(" -> ")}`);
console.log(`  cues: ${r1.cues.map((c) => c.n).join(", ")}`);
ok(r1.states[0] === STATE.ENTRY, "opens on ENTRY (the gate)");
ok(r1.states.includes(STATE.SALUTE), "has a SALUTE beat before anyone can be hurt");
ok(r1.states.includes(STATE.FIGHT), "reaches FIGHT");
ok(r1.states.includes(STATE.VERDICT), "reaches VERDICT");
ok(r1.states[r1.states.length - 1] === STATE.DONE, "ends DONE");
ok(r1.cues.some((c) => c.n === "gate_open" && c.gate === "triumphalis"), "opens the Porta Triumphalis on entry");
ok(r1.cues.some((c) => c.n === "gate_open" && c.gate === "libitinaria"), "opens the Porta Libitinaria for the exit");
ok(r1.cues.filter((c) => c.n === "horn").length >= 2, "sounds the horns at least twice");

// Nothing may take damage during the ceremony.
const early = new Match({ def: first, inventory: new Inventory(), seed: 3 }).start();
let dmgEarly = false;
early.combat.onEvent = (e) => { if (e.type === "hit") dmgEarly = true; };
for (let i = 0; i < Math.floor(60 * 6.4); i++) early.update(DT, {});
ok(!dmgEarly, "no damage is dealt during ENTRY or SALUTE");

// --- 2. every match type resolves -------------------------------------------
console.log("\n-- every ladder entry resolves --");
const byType = {};
let stalls = 0;
for (const def of LADDER) {
  const r = runMatch(def, { seed: def.index * 13 + 1 });
  const done = r.m.state === STATE.DONE;
  if (!done) { stalls++; console.log(`  STALL: ${def.id} ${def.name} (${def.type}) after ${r.t}s`); }
  byType[def.type] = byType[def.type] || { n: 0, won: 0 };
  byType[def.type].n++;
  if (r.m.result && r.m.result.playerWon) byType[def.type].won++;
}
for (const [k, v] of Object.entries(byType)) console.log(`  ${k.padEnd(13)} ${v.n} run, player won ${v.won}`);
ok(stalls === 0, `every one of the ${LADDER.length} ladder matches resolves (stalls: ${stalls})`);
ok(Object.keys(byType).length >= 8, "the ladder exercises at least 8 distinct match types");

// --- 3. multi-combatant types actually spawn everyone -----------------------
console.log("\n-- rosters --");
const team = LADDER.find((x) => x.type === "team");
const rt = runMatch(team, { seed: 5 });
const roles = rt.m.spawned.reduce((a, s) => { a[s.role] = (a[s.role] || 0) + 1; return a; }, {});
console.log(`  ${team.name}: ${JSON.stringify(roles)}`);
ok(roles.player === 1, "team match spawns exactly one player");
ok((roles.opponent || 0) >= 3, "team match spawns the full opposing troupe");
ok((roles.ally || 0) >= 2, "team match spawns allies on the player's side");

const duo = LADDER.find((x) => x.type === "duo");
const rd = runMatch(duo, { seed: 11 });
const droles = rd.m.spawned.reduce((a, s) => { a[s.role] = (a[s.role] || 0) + 1; return a; }, {});
console.log(`  ${duo.name}: ${JSON.stringify(droles)}`);
ok((droles.ally || 0) === 1 && (droles.opponent || 0) === 2, "2v2 is one ally against two opponents");

// --- 4. tertiarius and survival waves ----------------------------------------
console.log("\n-- tertiarius + waves --");
let sawTert = false;
for (let s = 1; s <= 12 && !sawTert; s++) {
  const rr = runMatch(LADDER.find((x) => x.type === "tertiarius"), { seed: s * 7 });
  if (rr.m.spawned.some((x) => x.role === "tertiarius")) sawTert = true;
}
console.log(`  a fresh third fighter appeared after a win: ${sawTert}`);
ok(sawTert, "the tertiarius walks out when the player wins the first bout");

const surv = LADDER.find((x) => x.type === "survival");
let maxWave = 0;
for (let s = 1; s <= 8; s++) {
  const rr = runMatch(surv, { seed: s * 3 });
  maxWave = Math.max(maxWave, rr.m.wave);
}
console.log(`  survival reached wave ${maxWave + 1} of ${surv.waves}`);
ok(maxWave > 0, "survival advances past the first wave");

// --- 5. verdict + economy -----------------------------------------------------
console.log("\n-- verdict and purse --");
let wins = 0, spared = 0, deaths = 0, purses = [];
for (let s = 1; s <= 30; s++) {
  const rr = runMatch(first, { seed: s * 17 });
  const res = rr.m.result;
  if (!res) continue;
  if (res.playerWon) wins++;
  if (res.spared) spared++; else deaths++;
  purses.push(res.purse);
}
const avgPurse = Math.round(purses.reduce((a, b) => a + b, 0) / purses.length);
console.log(`  30 bouts: ${wins} won, missio granted ${spared}, refused ${deaths}, avg purse ${avgPurse}`);
ok(purses.length === 30, "every bout settles a purse");
ok(avgPurse > 0, "purses are positive");
ok(spared > deaths, "missio is the NORM, not the exception (matching the history)");

// --- 6. hud + snapshot ---------------------------------------------------------
console.log("\n-- readouts --");
const rh = runMatch(first, { seed: 2, maxT: 12 });
const hud = rh.m.hudState();
console.log(`  hud: ${hud.player.name} ${Math.round(hud.player.hp)}/${hud.player.maxHp} vs ${hud.foe ? hud.foe.name : "-"} (${hud.foe ? hud.foe.title : ""})`);
ok(hud.player && hud.player.maxHp > 0, "hud exposes player vitals");
ok(hud.foe && hud.foe.name, "hud names the current threat");
ok(typeof hud.crowdFavour === "number", "hud exposes crowd favour");
const snap = rh.m.snapshot();
ok(snap.combat && Array.isArray(snap.combat.fighters), "snapshot carries the full combat state");

// --- 7. determinism -------------------------------------------------------------
console.log("\n-- determinism --");
const a = runMatch(first, { seed: 99 });
const b = runMatch(first, { seed: 99 });
ok(JSON.stringify(a.m.result) === JSON.stringify(b.m.result), "the same seed produces the same bout result");
console.log(`  seed 99 -> won=${a.m.result.playerWon} purse=${a.m.result.purse} in ${a.m.result.duration}s`);

console.log(`\n-- verdict --\n  ${checks} checks, ${fails} failed`);
if (fails) { console.log("  MATCH PROBE: FAIL"); process.exit(1); }
console.log("  MATCH PROBE: PASS");
process.exit(0);
