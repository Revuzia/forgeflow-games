// SESSION 24: the sim cells under the owner's landing view (from s24-sheet.js columns) at day 0, 2, 10, 30:
// ground, water depth, level (ground + water), ocean flag, salinity. Plus: every wet cell within 800 m of the camera
// whose level stands > 1 m above sea level (water held on high ground).
// node _harness/arc-work/s24-simcells.ts
import { Sim } from '../../src/sim/sim.ts';
const sim = new Sim({ seed: 307987276, scenario: 'babel' });
const p = sim.u.planets[0];
const cells = [3354, 3385, 3413, 3441, 3468, 3494, 3520, 3493, 3519, 3321, 3349, 3376, 3375, 3058, 3099, 3140, 3142, 3220, 3256, 3257, 3016, 2972];
const P = (p as unknown as { grid: { pos: Float32Array } }).grid.pos;
const R = 3000; // (babel: lod.radius 3000 m)
const lat = 17.87588 * Math.PI / 180, lon = -35 * Math.PI / 180;
const ux = Math.cos(lat) * Math.sin(lon), uy = Math.sin(lat), uz = Math.cos(lat) * Math.cos(lon);
const day = 1440;
for (const d of [0, 2, 10, 30]) {
  while (sim.u.tick < d * day) sim.step(Math.min(360, d * day - sim.u.tick));
  const f = p.f, sea = p.st.seaLevel;
  console.log(`== day ${d} tick ${sim.u.tick} sea ${sea}`);
  console.log(cells.map((c) => `${c}: g ${(f.surface[c] - sea).toFixed(1)} w ${f.water[c].toFixed(2)} lvl ${(f.surface[c] + f.water[c] - sea).toFixed(2)} oc ${p.s.ocean[c]} sal ${f.salinity[c].toFixed(2)}`).join('\n'));
  let hi = 0, n = 0; const ex: string[] = [];
  for (let c = 0; c < f.surface.length; c++) {
    const dist = Math.acos(Math.min(1, P[c * 3] * ux + P[c * 3 + 1] * uy + P[c * 3 + 2] * uz)) * R;
    if (dist > 800) continue;
    n++;
    if (f.water[c] > 0.05 && f.surface[c] + f.water[c] - sea > 1) { hi++; if (ex.length < 8) ex.push(`${c} g ${(f.surface[c] - sea).toFixed(1)} w ${f.water[c].toFixed(2)}`); }
  }
  console.log(`cells within 800 m: ${n}; wet with level > 1 m above sea: ${hi} ${ex.join('; ')}`);
}
