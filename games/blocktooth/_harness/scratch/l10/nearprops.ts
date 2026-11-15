// L10 scratch: which props / buildings stand near the S1 camera the planner picks (seed, biome, titan).
import { createWorld } from '../../../src/core/world.ts';
import { CineCam } from '../../../src/render/cinecam.ts';
import { buildTitanModel } from '../../../src/titans/models.ts';
import type { BiomeId, TitanId } from '../../../src/core/types.ts';
const [seed, biome, titan] = [Number(process.argv[2] ?? 711), (process.argv[3] ?? 'grideast') as BiomeId, (process.argv[4] ?? 'molo') as TitanId];
const w = createWorld({ titan, biome, seed });
const m = buildTitanModel(titan);
const r = { x: (m.rest.eyeL.x + m.rest.eyeR.x) / 2, y: (m.rest.eyeL.y + m.rest.eyeR.y) / 2, z: (m.rest.eyeL.z + m.rest.eyeR.z) / 2 };
const T = w.titan, H = T.height, h = T.heading, c = Math.cos(h), s = Math.sin(h);
const face = { x: T.x + (r.x * c + r.z * s) * H, y: r.y * H, z: T.z + (-r.x * s + r.z * c) * H, fx: s, fy: 0, fz: c, h: H };
const cam = { position: { x: 0, y: 0, z: 0 }, fov: 30, near: 0.1, far: 1000 } as never;
const rig = { target: { x: T.x, y: 0.5, z: T.z }, reset() { /* */ } } as never;
const p = new CineCam(cam).plan(w, rig, face, 'full')!;
const S = p.street!;
console.log('titan', T.x.toFixed(1), T.z.toFixed(1), 'heading', h.toFixed(2), 'S1 cam', S.x.toFixed(2), S.y.toFixed(2), S.z.toFixed(2));
for (const q of w.city.props) {
  const d = Math.hypot(q.x - S.x, q.z - S.z);
  if (d < 9) console.log('prop', q.kind.padEnd(9), 'd', d.toFixed(2), 'at', q.x.toFixed(1), q.z.toFixed(1), 'lane', q.lane, 'alive', q.alive);
}
{
  const fx = face.x, fz = face.z;
  const dist = Math.hypot(fx - S.x, fz - S.z);
  const vx = (fx - S.x) / dist, vz = (fz - S.z) / dist;
  for (const q of w.city.props) {
    const d = Math.hypot(q.x - S.x, q.z - S.z);
    if (d > 9) continue;
    const ox = q.x - S.x, oz = q.z - S.z, ol = Math.hypot(ox, oz);
    console.log('  angle', q.kind, (Math.acos((ox * vx + oz * vz) / ol) * 180 / Math.PI).toFixed(1), 'heading', q.heading.toFixed(2));
  }
  console.log('face', face.x.toFixed(2), face.z.toFixed(2), 'S1 dist', dist.toFixed(2));
}
