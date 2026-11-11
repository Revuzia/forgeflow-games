// PERF s10 owner item 5 (precise): the water sheet's height as the shader builds it (fieldpack.ts levels interpolated
// over the sim triangle, ocean.ts drape) against the ground tG, on a lattice around Rubolhin (babel 307987276).
// Counts lattice points where WATER SHOWS over ground that stands clearly above the water's own level, by cause:
//   drape  = the drape lift (vSimD 0.1..3 m) puts a film over relief, chord = the level's linear chord itself is over the
//   ground (a shore triangle up a slope). node _harness/arc-work/probe-drape2.ts [seed] [radius m] [step m]
import { Sim } from '../../src/sim/sim.ts';
import { curvedSurface, curveMargin, groundOffset, MAX_GRAD, surfaceGradients } from '../../src/sim/grid/surface.ts';
const seed = Number(process.argv[2] ?? 307987276), RAD = Number(process.argv[3] ?? 2200), STEP = Number(process.argv[4] ?? 6);
const sim = new Sim({ seed, scenario: 'babel' });
const p: any = sim.u.planets[0];
const t = p.people.settlements.find((s: any) => /Rubolhin/.test(s.name)) ?? p.people.settlements[0];
const g = p.grid, R = 3000, F = p.f, n = g.count, WET = 0.02;
const src: any = { grid: g, radius: R, noise: p.noise, surface: F.surface, soil: F.soil, sand: F.sand, snow: F.snow, grad: surfaceGradients(g, R, F.surface) };
// fieldpack.ts levels
const wl = new Float32Array(n), inland = 4 + 2 * curveMargin(g, R, MAX_GRAD);
for (let c = 0; c < n; c++) {
  const s = F.surface[c];
  if (F.water[c] > WET) { wl[c] = s + F.water[c]; continue; }
  let sum = 0, k = 0;
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (F.water[o] > WET) { sum += F.surface[o] + F.water[o]; k++; } }
  wl[c] = k > 0 ? Math.min(sum / k, s - 0.05) : s - inland;
}
const up = t.pos, east = [up[2], 0, -up[0]]; { const l = Math.hypot(...east); for (let i = 0; i < 3; i++) east[i] /= l; }
const north = [up[1] * east[2] - up[2] * east[1], up[2] * east[0] - up[0] * east[2], up[0] * east[1] - up[1] * east[0]];
const sm = (a: number, b: number, x: number) => { const u = Math.min(1, Math.max(0, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
const h = { a: 0, b: 0, c: 0, wa: 0, wb: 0, wc: 0 } as any;
const stat = { pts: 0, water: 0, drapeOver1: 0, chordOver1: 0, drapeOver3: 0 };
const grid2 = new Map<string, number>();
for (let x = -RAD; x <= RAD; x += STEP) for (let y = -RAD; y <= RAD; y += STEP) {
  if (x * x + y * y > RAD * RAD) continue;
  const q = [0, 1, 2].map((k) => up[k] + (east[k] * x + north[k] * y) / R); const l = Math.hypot(...q);
  const px = q[0] / l, py = q[1] / l, pz = q[2] / l;
  g.locate(px, py, pz, h);
  if (F.water[h.a] <= WET && F.water[h.b] <= WET && F.water[h.c] <= WET) continue; // no wet cell: no sheet
  stat.pts++;
  const tS = curvedSurface(src, h, px, py, pz), tG = groundOffset(src, px, py, pz);
  const tH = wl[h.a] * h.wa + wl[h.b] * h.wb + wl[h.c] * h.wc;
  const vSimD = tH - tS;
  const drape = sm(0.1, 0.25, vSimD) * (1 - sm(1.5, 3.0, vSimD));
  const lift = Math.max(0, tG + 0.18 - tH) * drape;
  const sheet = tH + lift;
  if (sheet <= tG) continue; // under the ground: the terrain hides it
  stat.water++;
  // the ground stands above the water's level: land that should be dry (the sheet is only there by the drape or chord)
  const over = tG - tH;
  if (lift > 0 && over > 1) { stat.drapeOver1++; if (over > 3) stat.drapeOver3++; const key = `${Math.round(x / 200) * 200},${Math.round(y / 200) * 200}`; grid2.set(key, (grid2.get(key) ?? 0) + 1); }
  // the chord over a slope: water shown where the level, without lift, stands over ground that the nearest wet cell's
  // own level is far below
  const minWet = Math.min(...[h.a, h.b, h.c].filter((c) => F.water[c] > WET).map((c) => wl[c]));
  if (lift <= 0 && tG - minWet > 1) stat.chordOver1++;
}
console.log(JSON.stringify(stat));
console.log('drape-over-1m points by 200 m square (x east, y north):', [...grid2.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}:${v}`).join(' '));
