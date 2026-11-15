// ARC §0.4 / C3 acceptance: after a broken covenant the covenant town's trust stays at or below max(0.5, 0.9 - 0.2 w) for
// 25 years however kind the god is afterwards (w = memory.betrayed, which fades with the years). Sandbox n=20, one town of
// 40 plains folk (bronze), natural disasters off. Arms: `broken` (offer, make 'gentle' (a flood vow only breaks by a flood cast; same ceiling), then a lightning cast sent with
// covenant:'break'), `control` (no covenant, same kindness). The god is kind every day: food, heal and a prayer answer.
//   node _harness/probes/arc-c3-ceiling.ts <seed> [years=25] [broken|control]
// One RESULT line: max single-person trust and mean trust each year against the ceiling, and the overshoot count (samples
// taken just after each game day where any person's trust was > ceiling + 0.005).
import { Sim } from '../../src/sim/sim.ts';
import { peekRel } from '../../src/sim/god/regard.ts';
import { GODS } from '../../src/sim/people/defs.ts';

const seed = Number(process.argv[2] ?? 1), years = Number(process.argv[3] ?? 25), arm = process.argv[4] ?? 'broken';
const t0 = Date.now();
const sim = new Sim({ seed, scenario: 'sandbox', overrides: { n: 20, vegetation: 1 } });
sim.applyNow({ k: 'set', path: 'disasters.natural', value: 0 } as never);
const r0 = sim.applyNow({ k: 'life.spawn-people', species: 'plains-folk', count: 40, era: 'bronze', settled: true, wildGame: false } as never);
if (!r0.ok) throw new Error(r0.msg);
const sid = r0.created!.find((e) => e.kind === 'settlement')!.id;
sim.step(60);
const p = sim.u.planets[0], ps = p.people!, A = ps.agents;
const day = Math.max(60, Math.round(p.st.dayHours * 60)), year = Math.max(day, Math.round(p.st.orbit.period));
const town = () => ps.settlement(sid)!;
const trust = (): { max: number; mean: number; n: number } => {
  const m = ps.members.get(sid) ?? []; let mx = 0, t = 0;
  for (const s of m) { const v = A.love[s * GODS]; if (v > mx) mx = v; t += v; }
  return { max: mx, mean: m.length ? t / m.length : 0, n: m.length };
};
const ceil = () => { const b = peekRel(sim.u, p.id, sid)?.memory?.betrayed ?? 0; return { b, hi: b >= 0.01 ? Math.max(0.5, 0.9 - 0.2 * b) : 1 }; };
let breakTick = -1, brokeOk = false;
if (arm === 'broken') {
  sim.applyNow({ k: 'covenant.offer', settlement: sid } as never);
  sim.step(3 * day);
  const m = sim.applyNow({ k: 'covenant.make', vow: 'gentle' } as never);
  if (!m.ok) throw new Error('make: ' + m.msg);
  sim.step(2 * day);
  const t = town();
  const b = sim.applyNow({ k: 'miracle.lightning', pos: [...t.pos], wrath: 0.7, covenant: 'break' } as never);
  brokeOk = (sim.u.god.rel?.covenants ?? []).some((c) => c.status === 'broken');
  if (!b.ok) throw new Error('break: ' + b.msg);
  breakTick = sim.u.tick;
}
const start = sim.u.tick, end = start + Math.round(years * year);
const perYear: { y: number; max: number; mean: number; w: number; hi: number }[] = [];
const overAt: number[] = [];
let over = 0, samples = 0, worst = 0, peakMax = 0, nextY = year;
while (sim.u.tick < end) {
  const t = town();
  if (t.fallen < 0) {
    sim.applyNow({ k: 'miracle.food', pos: [...t.pos], radius: 300 } as never);
    sim.applyNow({ k: 'miracle.heal', pos: [...t.pos], radius: 300 } as never);
    sim.applyNow({ k: 'prayer.answer', settlement: sid } as never);
  }
  sim.step(day);
  if (town().fallen >= 0) break;
  const tr = trust(), c = ceil();
  samples++;
  peakMax = Math.max(peakMax, tr.max);
  if (arm === 'broken' && tr.max > c.hi + 0.005) { over++; overAt.push(Math.round((sim.u.tick - breakTick) / day)); worst = Math.max(worst, tr.max - c.hi); }
  if (sim.u.tick - start >= nextY) { nextY += year; perYear.push({ y: Math.round((sim.u.tick - start) / year), max: r3(tr.max), mean: r3(tr.mean), w: c.b, hi: r3(c.hi) }); }
  sim.drainEvents();
}
function r3(x: number): number { return Math.round(x * 1000) / 1000; }
const last = ceil();
console.log('RESULT ' + JSON.stringify({ arm, seed, years, secs: Math.round((Date.now() - t0) / 1000), brokeOk, fell: town().fallen >= 0, samples, peakMax: r3(peakMax), overCeilingDays: over, worstOvershoot: r3(worst), overAtDaysAfterBreak: overAt,
  wEnd: last.b, ceilEnd: r3(last.hi), perYear: perYear.filter((_, i) => i % 4 === 0 || i === perYear.length - 1) }));
