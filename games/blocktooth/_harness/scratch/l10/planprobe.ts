// L10 scratch: run CineCam.plan() in node for every titan × biome × seed and print the chosen poses.
//   node _harness/scratch/l10/planprobe.ts [--seeds 1,1337] [--variant full]
// The face anchor is computed exactly like TitanView.faceAnchor (rest eye midpoint × H, rotated by the
// heading, at the titan's position). The rig is a stand-in whose reset() puts the camera at the real
// CameraRig formula's pose (we only need a plausible gameplay pose for the crane test).
import { createWorld } from '../../../src/core/world.ts';
import { TITAN_IDS } from '../../../src/core/types.ts';
import type { BiomeId, TitanId, World } from '../../../src/core/types.ts';
import { CineCam } from '../../../src/render/cinecam.ts';
import { buildTitanModel } from '../../../src/titans/models.ts';
import type { CineVariant, FaceAnchor } from '../../../src/v2types.ts';

const args = process.argv.slice(2);
const seeds = (args.includes('--seeds') ? args[args.indexOf('--seeds') + 1] : '1,1337').split(',').map(Number);
const variant = (args.includes('--variant') ? args[args.indexOf('--variant') + 1] : 'full') as CineVariant;
const BIOMES: BiomeId[] = ['grideast', 'whitestacks', 'lockwater'];

const rest: Record<string, { x: number; y: number; z: number }> = {};
for (const id of TITAN_IDS) {
  const m = buildTitanModel(id);
  const L = m.rest.eyeL, R = m.rest.eyeR;
  rest[id] = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2, z: (L.z + R.z) / 2 };
  m.dispose();
}

function faceOf(w: World, id: TitanId): FaceAnchor {
  const T = w.titan, H = T.height, h = T.heading, r = rest[id];
  const c = Math.cos(h), s = Math.sin(h);
  // Ry(h): x' = x cos + z sin, z' = -x sin + z cos
  return { x: T.x + (r.x * c + r.z * s) * H, y: r.y * H, z: T.z + (-r.x * s + r.z * c) * H, fx: s, fy: 0, fz: c, h: H };
}

let fails = 0;
for (const seed of seeds) for (const biome of BIOMES) for (const titan of TITAN_IDS) {
  const w = createWorld({ titan, biome, seed });
  const f = faceOf(w, titan);
  const cam = { position: { x: 0, y: 0, z: 0 }, fov: 30, near: 0.1, far: 1000 } as unknown as import('three').PerspectiveCamera;
  const rig = {
    target: { x: w.titan.x, y: w.titan.height * 0.45, z: w.titan.z },
    reset(_w: World) { (cam.position as { x: number; y: number; z: number }).x = w.titan.x + 7; cam.position.y = 14; cam.position.z = w.titan.z + 7; },
  } as unknown as import('../../../src/render/camera.ts').CameraRig;
  const cc = new CineCam(cam);
  const t0 = performance.now();
  const p = cc.plan(w, rig, f, variant);
  const ms = performance.now() - t0;
  if (!p) { fails++; console.log(`${seed} ${biome.padEnd(11)} ${titan.padEnd(10)} NO PLAN (legacy slate)`); continue; }
  const ang = (pose: { x: number; z: number }) => {
    const dx = pose.x - f.x, dz = pose.z - f.z;
    const a = Math.atan2(dx * f.fz - dz * f.fx, dx * f.fx + dz * f.fz);   // + = toward the titan's left? (sign check)
    return (a * 180 / Math.PI).toFixed(0);
  };
  const dist = (pose: { x: number; y: number; z: number }) => Math.hypot(pose.x - f.x, pose.y - f.y, pose.z - f.z) / f.h;
  const st = p.street;
  console.log(`${seed} ${biome.padEnd(11)} ${titan.padEnd(10)} H ${f.h.toFixed(2)} ` +
    `S2 az ${ang(p.close)}° d ${dist(p.close).toFixed(2)}H y ${(p.close.y / f.h).toFixed(2)}H · ` +
    (st ? `S1 az ${ang(st)}° d ${dist(st).toFixed(2)}H` : 'S1 none') +
    ` · shots ${p.shots.map((s) => s.id + ':' + s.dur).join(' ')} total ${p.total.toFixed(2)} · plan ${ms.toFixed(1)} ms`);
}
console.log(fails ? `FAIL: ${fails} pairs had no plan` : 'all pairs planned');
process.exit(fails ? 1 : 0);
