// B-sim probe: the harsh run's defiance trajectory (node _harness/arc-work/B-sim-harsh.ts <seed>)
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
import { defianceTarget } from '../../src/sim/god/defiance.ts';
import { NT, TRAIT } from '../../src/sim/people/defs.ts';
const seed = Number(process.argv[2] ?? 1);
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 60, era: 'bronze', settled: true } as never);
const p = sim.u.planets[0], ps = p.people!;
const day = Math.max(60, Math.round(p.st.dayHours * 60)), year = Math.max(day, Math.round(p.st.orbit.period));
const st = ps.settlements.find((s) => !s.band)!;
const t0 = sim.u.tick; let next = t0; const out: string[] = [];
while (sim.u.tick < t0 + 3 * year) {
  if (sim.u.tick >= next) { next += Math.round(year / 3); sim.applyNow({ k: 'miracle.storm', pos: [...st.pos], radius: 350, wrath: 0.3 } as never); sim.applyNow({ k: 'miracle.lightning', pos: [...st.pos], wrath: 0.3 } as never); }
  sim.step(day);
  const r = peekRel(sim.u, p.id, st.id)!;
  const d = Math.round((sim.u.tick - t0) / day);
  const A = ps.agents; const bold = (ps.members.get(st.id) ?? []).filter((s) => A.traits[s * NT + TRAIT.boldness] >= 0.6).map((s) => A.fear[s * 4].toFixed(2) + '/' + A.love[s * 4].toFixed(2));
  if (d % 3 === 0) out.push(`bold ${bold.join(' ')} | ` + `d${d} def ${r.defiance} tgt ${defianceTarget(r, r.means[1], r.means[2]).toFixed(2)} load ${r.harmLoad} pride ${r.pride} f ${r.means[1]} t ${r.means[2]} lap ${r.lapses} h ${r.hearts?.kind}`);
}
console.log(out.join('\n'));
