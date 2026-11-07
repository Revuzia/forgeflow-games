// T2 diagnostic: unattended sandbox (same setup as _harness/probes/arc.ts unattended); once a year prints each town's
// first failing tower-leader condition (tower.ts towerWhyNot). Usage: node _harness/arc-work/probe-towerdiag.ts <seed> [years]
import { Sim } from '../../src/sim/sim.ts';
import { towerWhyNot } from '../../src/sim/god/tower.ts';
const seed = Number(process.argv[2] ?? 1), years = Number(process.argv[3] ?? 40);
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
const r = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'bronze', settled: true } as never);
if (!r.ok) throw new Error(r.msg);
const p = sim.u.planets[0];
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
for (let y = 1; y <= years; y++) {
  sim.step(year); sim.drainEvents();
  const w = towerWhyNot(sim.u, p);
  const tw = sim.u.god.rel?.towers?.length ?? 0;
  console.log(`seed${seed} y${y} towers${tw} ` + w.map((t) => `${t.id}:${t.pride}:${t.why}:L${t.league}`).join(' '));
}
