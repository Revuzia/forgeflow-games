// ARC §1.2 dusk series for the M3 harsh run (storm r350 + lightning at wrath 0.3 every 4 days, 3 years): day, today,
// ema, peak, armed, low, fear share. node _harness/arc-work/probe-dusk.ts <seed> [harsh|calm]
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
const seed = Number(process.argv[2] ?? 1), mode = process.argv[3] ?? 'harsh';
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 } as never);
const r0 = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 45, era: 'bronze', settled: true, wildGame: false } as never);
const sid = r0.created!.find((e) => e.kind === 'settlement')!.id;
const p = sim.u.planets[0];
const day = Math.max(60, Math.round(p.st.dayHours * 60)), year = Math.round(p.st.orbit.period);
const rows: string[] = [];
for (let d = 0; d < 3 * year / day; d++) {
  const st = p.people.settlement(sid);
  if (mode === 'harsh' && d % 4 === 1 && st) {
    sim.applyNow({ k: 'miracle.storm', pos: [...st.pos], radius: 350, wrath: 0.3 } as never);
    sim.applyNow({ k: 'miracle.lightning', pos: [...st.pos], wrath: 0.3 } as never);
  }
  sim.step(day);
  const r = peekRel(sim.u, p.id, sid);
  const k = r?.dusk;
  rows.push(`${d} ${k?.today} ${k?.ema} pk ${r?.since.duskPk} hi ${r?.since.duskHi ?? 0} aw ${r?.since.duskAw} low ${k?.low ? 1 : 0} ${r?.hearts?.kind} f ${r?.hearts?.fearful} faith ${r?.means?.[0]?.toFixed?.(2)}`);
}
console.log(rows.join('\n'));
console.log('told', JSON.stringify(peekRel(sim.u, p.id, sid)?.told));
