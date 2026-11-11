// PERF s10 owner item 5: babel seed 307987276, "Rubolhin by the Lake": which cells east of the town carry water, how deep,
// how high above the lake. node _harness/arc-work/probe-eastwater.ts [seed] [ticks]
import { Sim } from '../../src/sim/sim.ts';
const seed = Number(process.argv[2] ?? 307987276), ticks = Number(process.argv[3] ?? 0);
const sim = new Sim({ seed, scenario: 'babel' });
const p: any = sim.u.planets[0];
if (ticks) sim.step(ticks);
const towns = p.people.settlements.filter((s: any) => !s.band);
console.log('towns', towns.map((s: any) => s.name).join(', '));
const t = towns.find((s: any) => /Rubolhin/.test(s.name)) ?? towns[0];
const g = p.grid, R = p.cfg?.radius ?? p.radius ?? sim.u.planets[0].radius;
const F = p.f;
const s = F.surface, w = F.water;
const pos = t.pos; // unit vec
// local east / north at the town
const up = pos;
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// (the app's convention: y is the pole, up = (cos lat sin lon, sin lat, cos lat cos lon), east = (up.z, 0, -up.x))
let east = [up[2], 0, -up[0]];
const el = Math.hypot(...east); east = east.map((v) => v / el);
const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
console.log('town id', t.id, 'lat', (Math.asin(up[1]) * 180 / Math.PI).toFixed(3), 'lon', (Math.atan2(up[0], up[2]) * 180 / Math.PI).toFixed(3));
console.log('town', t.name, 'R', R, 'cells', g.count, 'tick', sim.u.tick, 'precip?', !!F.precip);
const rows: any[] = [];
for (let c = 0; c < g.count; c++) {
  const P = [g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]];
  const d = Math.acos(Math.min(1, dot(P, up))) * R;
  if (d > 2500) continue;
  const x = dot(P, east) * R, y = dot(P, north) * R;
  rows.push({ c, x: Math.round(x), y: Math.round(y), d: Math.round(d), h: +s[c].toFixed(1), w: +w[c].toFixed(3), tree: +(F.tree?.[c] ?? 0).toFixed(2), wet: +(F.wetness?.[c] ?? 0).toFixed(2), pr: +(F.precip?.[c] ?? 0).toFixed(2) });
}
const wetR = rows.filter((r) => r.w > 0.01);
const lake = wetR.filter((r) => r.w > 1).map((r) => r.h + r.w);
console.log('cells in 2.5 km', rows.length, 'wet', wetR.length, 'lake level ~', lake.length ? (lake.reduce((a, b) => a + b, 0) / lake.length).toFixed(1) : '-');
console.log('wet cells EAST (x > 150) sorted by height:');
for (const r of wetR.filter((r) => r.x > 150).sort((a, b) => b.h - a.h).slice(0, 40)) console.log(JSON.stringify(r));
