// ARC §6.8 / §8.2 T3, T5: the babel scenario — towns, distances, tongues, pride; tower begun, first tower.choice, one speech.
// node _harness/arc-work/probe-babel.ts [seed] [n] [years]
import { Sim } from '../../src/sim/sim.ts';
import { distM } from '../../src/sim/people/world.ts';
import { langDistance } from '../../src/sim/people/culture.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';
const seed = Number(process.argv[2] ?? 1), n = Number(process.argv[3] ?? 20), years = Number(process.argv[4] ?? 2.2);
const t0 = Date.now();
const sim = new Sim({ seed, scenario: 'babel', overrides: { n } });
const p = sim.u.planets[0];
const x = makeCtx(sim.u, p);
const towns = p.people.settlements.filter((s) => !s.band && s.fallen < 0);
const R = sim.u.god.rel!;
console.log('build ms', Date.now() - t0, 'towns', towns.map((s) => `${s.name}#${s.id} pop ${p.people.members.get(s.id)?.length} era ${s.era} pride ${R.st[`${p.id}:${s.id}`]?.pride}`).join('; '));
let maxD = 0, maxL = 0;
for (const a of towns) for (const b of towns) if (a.id < b.id) { maxD = Math.max(maxD, distM(p, a.pos, b.pos)); maxL = Math.max(maxL, langDistance(a, b)); }
console.log('max pair km', (maxD / 1000).toFixed(2), 'max langDistance', maxL);
let begun = -1, choice = -1;
const day = x.day, end = Math.round(years * x.year);
while (sim.u.tick < end) {
  sim.step(day / 4);
  for (const e of sim.drainEvents()) if ((e as unknown as { t: string }).t === 'tower.choice' && choice < 0) choice = sim.u.tick;
  const tw = R.towers?.[0];
  if (tw && begun < 0) { begun = sim.u.tick; console.log('begun day', (begun / day).toFixed(2), 'league', tw.league.length, 'name', tw.name); }
}
const tw = R.towers?.[0];
const lg = (tw?.league ?? []).map((id) => p.people.settlement(id)!).filter(Boolean);
let ls = 0; for (const a of lg) for (const b of lg) if (a.id < b.id) ls = Math.max(ls, langDistance(a, b));
console.log('tower', tw ? `${tw.status} h ${tw.height?.toFixed?.(1)} goal ${tw.goal} frac ${(tw.height / tw.goal).toFixed(2)}` : 'none',
  'first choice year', choice >= 0 ? (choice / x.year).toFixed(2) : 'none', 'league max langDistance after', years, 'y', ls,
  'events', (R.arcEvents ?? []).map((e) => e.kind).join(','), 'ms', Date.now() - t0);
