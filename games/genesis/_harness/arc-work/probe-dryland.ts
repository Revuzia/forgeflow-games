// Lane B task 1: which finished, non-dock buildings stand in water? (world.ts standingWater: own point + footprint ring,
// the drawn water sheet over the drawn ground).
// node _harness/arc-work/probe-dryland.ts [seed] [years] [scenario]
import { Sim } from '../../src/sim/sim.ts';
import { makeCtx } from '../../src/sim/people/ctx.ts';
import { standingWater } from '../../src/sim/people/world.ts';
import { BuildingFlag } from '../../src/sim/types.ts';
const seed = Number(process.argv[2] ?? 307987276), years = Number(process.argv[3] ?? 0), scenario = process.argv[4] ?? 'babel';
const t0 = Date.now();
const sim = new Sim({ seed, scenario });
const report = (label: string) => {
  for (const p of sim.u.planets) {
    if (!p.people) continue;
    const x = makeCtx(sim.u, p);
    const w = p.f.water;
    let n = 0, wet = 0, deep = 0, worst = 0; const rows: string[] = [];
    for (const b of p.people.buildings) {
      if (b.progress < 1 || b.flags & BuildingFlag.ruined) continue;
      const def = x.c.buildings.list[b.type];
      if (def.function === 'dock' || def.function === 'shipyard' || def.provides.includes('dock')) continue;
      n++;
      const d = standingWater(p, b.pos, def.footprint);
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
let floods = 0, other = 0;
for (let y = 1; y <= years; y++) {
  const end = Math.round(y * x0.year);
  while (sim.u.tick < end) {
    sim.step(Math.min(x0.day * 5, end - sim.u.tick));
    for (const e of sim.drainEvents() as unknown as { t: string; text?: string }[]) if (e.t === 'collapsed') { if (e.text === 'flood') floods++; else other++; }
  }
  report('y' + y);
  const ps = sim.u.planets[0].people!;
  console.log('   collapsed by flood', floods, 'otherwise', other, 'towns', ps.settlements.filter((s) => !s.band && s.fallen < 0).map((s) => `${s.name}:${ps.members.get(s.id)?.length ?? 0}/${ps.of(s.id).length}b`).join(', '));
}
