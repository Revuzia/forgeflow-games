// Attended pacing diagnosis (stint 7): sandbox + 60 bronze plains folk, a gentle god answering every open prayer daily
// (as _harness/probes/arc.ts attended). Prints each town's pride, pride parts (P T U L F), pop and the tower candidates'
// gates at chosen years. Usage: node _harness/arc-work/probe-attwhy.ts <seed> [years=14] [unattended]
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
import { towerCandidates } from '../../src/sim/god/tower.ts';
const seed = Number(process.argv[2] ?? 1), years = Number(process.argv[3] ?? 14), att = process.argv[4] !== 'unattended';
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
const r0 = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'bronze', settled: true } as never);
if (!r0.ok) throw new Error(r0.msg);
const p = sim.u.planets[0], ps = p.people!;
const day = Math.max(60, Math.round(p.st.dayHours * 60));
const year = Math.max(day, Math.round(p.st.orbit.period));
const start = sim.u.tick;
let answered = 0, nextY = 2;
while (sim.u.tick < start + years * year) {
  sim.step(Math.round(day / 4)); sim.drainEvents();
  if (att && Math.floor((sim.u.tick - start) / day) !== Math.floor((sim.u.tick - start - Math.round(day / 4)) / day)) {
    for (const st of ps.settlements) {
      if (st.fallen >= 0 || !peekRel(sim.u, p.id, st.id)?.prayers.length) continue;
      if (sim.applyNow({ k: 'prayer.answer', settlement: st.id } as never).ok) answered++;
    }
  }
  const y = (sim.u.tick - start) / year;
  if (y >= nextY) {
    nextY += 2;
    const c = towerCandidates(sim.u, p);
    const rows = c.map((t) => { const r = peekRel(sim.u, p.id, t.id); const h = r?.hearts; return { ...t, why: r?.prideWhy, faith: h ? undefined : undefined, means0: (r as unknown as { means?: number[] })?.means?.[0] }; });
    console.log('Y ' + JSON.stringify({ seed, att, y: Math.round(y * 10) / 10, answered, rows }));
  }
}
