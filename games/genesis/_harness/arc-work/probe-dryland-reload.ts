// Lane B: save / load equals continue, on a babel world (flood sweep and dry-site rules running).
// node _harness/arc-work/probe-dryland-reload.ts [seed] [saveYear] [endYear] [n]
import { Sim } from '../../src/sim/sim.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';
const seed = Number(process.argv[2] ?? 1), y0 = Number(process.argv[3] ?? 4), y1 = Number(process.argv[4] ?? 10), n = Number(process.argv[5] ?? 20);
const a = new Sim({ seed, scenario: 'babel', overrides: { n } });
const x = makeCtx(a.u, a.u.planets[0]);
const run = (s: Sim, to: number) => { while (s.u.tick < to) { s.step(Math.min(x.day, to - s.u.tick)); s.drainEvents(); } };
run(a, Math.round(y0 * x.year));
const b = Sim.load(a.save());
console.log('at save', a.hash() === b.hash());
let bad = -1;
for (let y = y0 + 1; y <= y1; y++) { run(a, Math.round(y * x.year)); run(b, Math.round(y * x.year)); const eq = a.hash() === b.hash(); if (!eq && bad < 0) bad = y; console.log('year', y, eq ? 'equal' : 'DIFFERENT'); if (!eq) break; }
console.log(bad < 0 ? 'OK: load equals continue' : `FIRST DIFFERENCE in year ${bad}`);
