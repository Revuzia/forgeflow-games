// POWERS-GROWTH v3 pacing probe (spec §8): time to each standing in a BOUND world under help, severe and mixed play.
//   node _harness/probes/reach-pacing.ts <scenario> <help|severe|mixed|free|none> <seed> [days=120] [n=20]
// The scripted god acts twice a game day at the largest living town, taking the first act of its list that the gate
// allows (so it plays inside its standing and its pool, falling back to the free basics). `free` uses only free powers.
// One line: RESULT {json} with the day each standing was first reached, and the state every 12 days (a game year).
import { Sim } from '../../src/sim/sim.ts';

const [scen = 'shore', beh = 'help', seedS = '1', daysS = '120', nS = '20'] = process.argv.slice(2);
const sim = new Sim({ seed: Number(seedS), scenario: scen, overrides: { n: Number(nS) }, bound: true });
const p = sim.u.planets.find((q) => q.people && q.people.agents.count > 0) ?? sim.u.planets[0];
const ps = p.people;
type C = Record<string, unknown>;
const HELP: C[] = [{ k: 'miracle.food' }, { k: 'miracle.water' }, { k: 'settlement.gift', items: { bread: 6 } }, { k: 'water.rain' }];
const SEVERE: C[] = [{ k: 'miracle.storm', wrath: 0.3 }, { k: 'weather.paint', kind: 'hail', radius: 300, intensity: 0.8 }, { k: 'fire.ignite' }, { k: 'miracle.lightning', wrath: 0.3 }];
const FREE: C[] = [{ k: 'god.omen', kind: 'rainbow' }, { k: 'water.rain' }, { k: 'miracle.lightning', wrath: 0.3 }];
function town() {
  let best: (typeof ps.settlements)[number] | null = null, bn = -1;
  for (const s of ps.settlements) { if (s.fallen >= 0 || s.band) continue; const n = ps.members.get(s.id)?.length ?? 0; if (n > bn) { bn = n; best = s; } }
  return best;
}
let acts = 0, spent = 0, refused = 0;
function act(list: C[]): void {
  const t = town();
  if (!t) return;
  for (const c0 of list) {
    const c: C = { ...c0, pos: [...t.pos], settlement: t.id };
    if (c.k === 'settlement.gift' || c.k === 'god.omen') delete c.pos; else delete c.settlement;
    const before = (sim.query('reach') as { pool: number }).pool;
    const r = sim.applyNow(c as never);
    if (r.ok) { acts++; spent += before - (sim.query('reach') as { pool: number }).pool; return; }
    refused++;
  }
}
const first = [0, -1, -1, -1, -1];
const rows: unknown[] = [];
const days = Number(daysS);
const t0 = Date.now();
for (let d = 1; d <= days; d++) {
  for (let h = 0; h < 2; h++) {
    if (beh === 'help') act(HELP);
    else if (beh === 'severe') { if (h === 0) act(SEVERE); }
    else if (beh === 'mixed') act(h === 0 ? HELP : (d % 2 ? SEVERE : HELP));
    else if (beh === 'free') act(FREE.slice(h + (d % 2)).concat(FREE));
    sim.step(720);
  }
  const v = sim.query('reach') as { tier: number; following: number; believers: number; trust: number; fear: number; both: number; pool: number; cap: number; gathered: { total: number; trust: number; fear: number }; measure: number; trustShare: number; fearShare: number };
  for (let t = 1; t <= v.tier; t++) if (first[t] < 0) first[t] = d;
  if (d % 12 === 0 || d === days || d <= 3) rows.push([d, v.tier, ps.agents.count, v.following, v.believers, v.trust, v.fear, v.both, v.pool, v.cap, v.gathered.total, v.gathered.fear, v.measure]);
}
console.log('RESULT ' + JSON.stringify({ scen, beh, seed: Number(seedS), days, first, acts, spent: Math.round(spent), refused, secs: Math.round((Date.now() - t0) / 1000), cols: 'day tier pop F believers trust fear both pool cap gaveYesterday gaveInFear measureToday', rows }));
