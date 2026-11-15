// Lane B task 1: which finished, non-dock buildings stand in water? (own point + footprint ring, grid.sample of f.water)
// node _harness/arc-work/probe-dryland.ts [seed] [years] [scenario]
import { Sim } from '../../src/sim/sim.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';
import { offsetPoint } from '../../src/sim/people/world.ts';
import { BuildingFlag } from '../../src/sim/types.ts';
const seed = Number(process.argv[2] ?? 307987276), years = Number(process.argv[3] ?? 0), scenario = process.argv[4] ?? 'babel';
const t0 = Date.now();
const sim = new Sim({ seed, scenario });
const report = (label: string) => {
  for (const p of sim.u.planets) {
    if (!p.people) continue;
    const x = makeCtx(sim.u, p);
    const g = p.grid, w = p.f.water, R = p.st.radius, out = [0, 0, 0];
    let n = 0, wet = 0, deep = 0, worst = 0; const rows: string[] = [];
    for (const b of p.people.buildings) {
      if (b.progress < 1 || b.flags & BuildingFlag.ruined) continue;
      const def = x.c.buildings.list[b.type];
      if (def.function === 'dock' || def.function === 'shipyard' || def.provides.includes('dock')) continue;
      n++;
      let d = g.sample(w, b.pos[0], b.pos[1], b.pos[2]);
      for (let k = 0; k < 4; k++) { offsetPoint(b.pos, def.footprint, k * Math.PI / 2, R, out); d = Math.max(d, g.sample(w, out[0], out[1], out[2])); }
      if (d > 0.15) wet++;
      if (d > 0.3) { deep++; rows.push(`${def.id}#${b.id} st${b.settlement} cell ${w[b.cell].toFixed(2)} foot ${d.toFixed(2)}`); }
      worst = Math.max(worst, d);
    }
    console.log(label, 'planet', p.id, 'edgeM', p.edgeM.toFixed(0), 'finished non-dock', n, '>0.15', wet, '>0.3', deep, 'worst', worst.toFixed(2), 'ms', Date.now() - t0);
    for (const r of rows.slice(0, 25)) console.log('  ', r);
  }
};
report('y0');
const x0 = makeCtx(sim.u, sim.u.planets[0]);
for (let y = 1; y <= years; y++) { sim.step(Math.round(y * x0.year) - sim.u.tick); report('y' + y); }
