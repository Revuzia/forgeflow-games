// ARC verifier: why the §1.3 fear sign is rare in a fearful town (harsh run as in verify-A-r1-sim.ts harsh, seed argv[2]).
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
import { personHeart } from '../../src/sim/god/arc.ts';
import { AgentFlag } from '../../src/sim/types.ts';
import { sunElevation } from '../../src/sim/people/world.ts';
let lastDay = -1;
const seed = Number(process.argv[2] ?? 1);
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 } as never);
const r0 = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 45, era: 'bronze', settled: true, wildGame: false } as never) as { created: { kind: string; id: number }[] };
const sid = r0.created.find((e) => e.kind === 'settlement')!.id;
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
let next = sim.u.tick + day;
const rows: string[] = [];
for (let h = 0; h < 30 * 24; h++) {
  sim.step(60);
  const st = ps.settlement(sid)!;
  if (sim.u.tick >= next) { next += 4 * day; sim.applyNow({ k: 'miracle.storm', pos: [...st.pos], radius: 350, wrath: 0.3 } as never); sim.applyNow({ k: 'miracle.lightning', pos: [...st.pos], wrath: 0.3 } as never); }
  sim.drainEvents();
  if (h < 24 * 8 || Math.floor(h / 24) === lastDay || sunElevation(sim.u, p, sim.u.tick, ps.settlement(sid)!.pos) < 0.5) continue;
  lastDay = Math.floor(h / 24);
  const r = peekRel(sim.u, p.id, sid);
  const snap = sim.snapshot({}).planets[0].agents as unknown as { count: number; id: Int32Array; heart?: Uint8Array; group: Int32Array };
  let fearful = 0, indoors = 0, grown = 0, fearSign = 0, inSnap = 0;
  for (const s of ps.members.get(sid) ?? []) {
    if (A.flags[s] & AgentFlag.child) continue; grown++;
    if (personHeart(A, s, r?.defiance ?? 0, r?.pride ?? 0) === 'fearful') { fearful++; if (A.flags[s] & AgentFlag.sleepingIndoors) indoors++; }
  }
  const hs: number[] = [0, 0, 0, 0, 0, 0];
  for (let k = 0; k < (snap?.count ?? 0); k++) { if (snap.group[k] === sid) inSnap++; hs[snap.heart?.[k] ?? 0]++; }
  fearSign = hs[3];
  rows.push(`day ${Math.floor(h / 24)} sun ${sunElevation(sim.u, p, sim.u.tick, ps.settlement(sid)!.pos).toFixed(2)} kind ${r?.hearts?.kind} grown ${grown} fearful ${fearful} (indoorsFlag ${indoors}) snapAgents ${snap?.count} inTown ${inSnap} signs ${hs}`);
}
console.log(rows.join('\n'));
