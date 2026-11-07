// A-sim-r1 probe (finding 6): the M3 kind run as ARC §8.1 words it (answered prayers + gifts, 2 y), the town's means
// (faith, fear, trust, loyalty) every ~3 days, prayers opened, devoted day.   node _harness/arc-work/A-sim-r1-kind.ts <seed>
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
const seed = Number(process.argv[2] ?? 1);
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 } as never);
const r0 = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 45, era: 'bronze', settled: true, wildGame: false } as never) as { created: { kind: string; id: number }[] };
const sid = r0.created.find((e) => e.kind === 'settlement')!.id;
const p = sim.u.planets[0], ps = p.people!;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const t0 = sim.u.tick, end = t0 + 2 * year;
let answered = 0, gifts = 0, opened = 0, devoted = -1;
const traj: string[] = [];
for (let d = 0; sim.u.tick < end; d++) {
  const r = peekRel(sim.u, p.id, sid);
  if (r?.prayers.length) { if ((sim.applyNow({ k: 'prayer.answer', settlement: sid } as never) as { ok: boolean }).ok) answered++; }
  else if (d % 3 === 0) { sim.applyNow({ k: 'settlement.gift', settlement: sid, items: { bread: 40 } } as never); gifts++; }
  sim.step(day);
  for (const e of sim.drainEvents() as { t: string }[]) if (e.t === 'prayer.raised' || e.t === 'prayer') opened++;
  const q = peekRel(sim.u, p.id, sid);
  if (devoted < 0 && q?.hearts?.kind === 'devoted') devoted = d + 1;
  if (d % 3 === 2) traj.push(`${d + 1}:${(q?.means ?? []).map((v) => v.toFixed(2)).join('/')}:${q?.hearts?.kind}`);
}
console.log('RESULT ' + JSON.stringify({ seed, days: Math.round((end - t0) / day), answered, gifts, opened, devoted, traj }));
