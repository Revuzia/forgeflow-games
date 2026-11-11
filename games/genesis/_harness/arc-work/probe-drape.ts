// PERF s10 owner item 5: where does the water shader's DRAPE (ocean.ts: shallows the sim floods 0.1-3 m deep get a film
// 18 cm over any ground relief standing above the level) cover land, and how tall is that land? Babel seed 307987276
// around Rubolhin. Ground = the CPU twin of the terrain shader's tG (surface.ts groundOffset).
//   node _harness/arc-work/probe-drape.ts [seed] [radius m]
import { Sim } from '../../src/sim/sim.ts';
import { groundOffset, surfaceGradients } from '../../src/sim/grid/surface.ts';
const seed = Number(process.argv[2] ?? 307987276), RAD = Number(process.argv[3] ?? 2500);
const sim = new Sim({ seed, scenario: 'babel' });
const p: any = sim.u.planets[0];
const t = p.people.settlements.find((s: any) => /Rubolhin/.test(s.name)) ?? p.people.settlements[0];
const g = p.grid, R = 3000, F = p.f;
const src = { grid: g, radius: R, noise: p.noise, surface: F.surface, soil: F.soil, sand: F.sand, snow: F.snow, grad: surfaceGradients(g, R, F.surface) };
const up = t.pos, east = [up[2], 0, -up[0]]; { const l = Math.hypot(...east); for (let i = 0; i < 3; i++) east[i] /= l; }
const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
let cells = 0, pts = 0, draped = 0, tall = 0, maxBump = 0;
const hist = new Map<string, number>();
const worst: any[] = [];
for (let c = 0; c < g.count; c++) {
  const P = [g.pos[c * 3], g.pos[c * 3 + 1], g.pos[c * 3 + 2]];
  if (Math.acos(Math.min(1, dot(P, up))) * R > RAD) continue;
  const w = F.water[c];
  if (w < 0.1 || w > 3) continue; // the drape's window (vSimD 0.1 .. 3 m)
  cells++;
  const L = F.surface[c] + w;
  // points within ~22 m of the cell centre (the cell's own share of its triangles)
  const e = [P[1] * 0.3 - P[2] * 0.2, P[2] * 0.5 - P[0] * 0.3, P[0] * 0.2 - P[1] * 0.5]; { const l = Math.hypot(...e); for (let i = 0; i < 3; i++) e[i] /= l; }
  const f = [P[1] * e[2] - P[2] * e[1], P[2] * e[0] - P[0] * e[2], P[0] * e[1] - P[1] * e[0]];
  let cellMax = 0;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
    const q = [0, 1, 2].map((k) => P[k] + (e[k] * i + f[k] * j) * 7 / R); const l = Math.hypot(...q);
    const h = groundOffset(src as any, q[0] / l, q[1] / l, q[2] / l);
    const bump = h - L;
    pts++;
    if (bump > -0.18) { draped++; const b = bump < 0.5 ? '<0.5' : bump < 1 ? '0.5-1' : bump < 2 ? '1-2' : bump < 5 ? '2-5' : '>5'; hist.set(b, (hist.get(b) ?? 0) + 1); }
    if (bump > 1) tall++;
    cellMax = Math.max(cellMax, bump); maxBump = Math.max(maxBump, bump);
  }
  if (cellMax > 1) worst.push({ c, x: Math.round(dot(P, east) * R), y: Math.round(dot(P, north) * R), s: +F.surface[c].toFixed(2), w: +w.toFixed(2), tree: +F.tree[c].toFixed(2), maxBump: +cellMax.toFixed(2) });
}
console.log(`town ${t.name}: cells in the drape window ${cells}, sample points ${pts}, draped (ground above level - 0.18) ${draped}, of which more than 1 m above the water ${tall}; max ${maxBump.toFixed(2)} m`);
console.log('draped points by ground height over the water:', JSON.stringify(Object.fromEntries(hist)));
worst.sort((a, b) => b.maxBump - a.maxBump);
for (const r of worst.slice(0, 15)) console.log(JSON.stringify(r));
