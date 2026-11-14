// render-core lane probe (node): CameraRig §4 maths + Lighting shadow fitting, headless.
//   node _harness/scratch/render-core/probe_camera.ts
// Exit 1 on any failed check.
import * as THREE from 'three';
import { CameraRig } from '../../../src/render/camera.ts';
import { Lighting } from '../../../src/render/lighting.ts';
import { createWorld } from '../../../src/core/world.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import { RANKS, cameraDistance, cameraClip, CAMERA } from '../../../src/core/config.ts';
import type { FrameInfo, Quality } from '../../../src/render/viewtypes.ts';
import type { RankIndex, SimEvent } from '../../../src/core/types.ts';

let fails = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) fails++;
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const w = createWorld({ titan: 'molo', biome: 'grideast', seed: 11 });
const cam = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 1000);
const q: Quality = { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true };
const rig = new CameraRig(cam, q);
const f: FrameInfo = { alpha: 1, dt: 1 / 60, time: 0, events: [], camDist: 0, frozen: false };
const step = (n: number, ev: SimEvent[] = []) => { for (let i = 0; i < n; i++) { f.events = i === 0 ? ev : []; f.time += f.dt; rig.update(w, f); } };

// 1) reset snaps to D*, pitch, target; camPos formula
rig.reset(w);
const T = w.titan;
const d0 = cameraDistance(T.height, T.rank);
check('reset: distance = D*(H, rank)', near(rig.distance, d0, 1e-6), `${rig.distance.toFixed(3)} vs ${d0.toFixed(3)}`);
check('rank I base D ≈ 17.2 m', near(cameraDistance(RANKS[0].height, 0), 17.2, 0.05), cameraDistance(RANKS[0].height, 0).toFixed(2));
const p = 36 * Math.PI / 180, y = 45 * Math.PI / 180;
const ex = T.x + d0 * Math.cos(p) * Math.sin(y), ey = T.height * 0.45 + d0 * Math.sin(p), ez = T.z + d0 * Math.cos(p) * Math.cos(y);
check('camPos = target + D·(cos p·sin yaw, sin p, cos p·cos yaw)', near(cam.position.x, ex, 1e-6) && near(cam.position.y, ey, 1e-6) && near(cam.position.z, ez, 1e-6),
  `${cam.position.toArray().map((v) => v.toFixed(3))} vs ${[ex, ey, ez].map((v) => v.toFixed(3))}`);
const clip = cameraClip(d0);
check('near/far = cameraClip(D)', near(cam.near, clip.near, 1e-9) && near(cam.far, clip.far, 1e-9), `${cam.near}/${cam.far}`);
const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
check('camera looks toward −X−Z (yaw 45°)', dir.x < 0 && dir.z < 0 && near(dir.x, dir.z, 1e-6), dir.toArray().map((v) => v.toFixed(3)).join(','));

// 2) critically damped spring: rank-up to II → converges, never overshoots D* (critical damping)
T.rank = 1 as RankIndex; T.height = RANKS[1].height;
const dStar = cameraDistance(T.height, 1);
let maxD = 0, dAt1s = 0;
const ev: SimEvent[] = [{ type: 'rankUp', rank: 1 }];
// track the spring WITHOUT the punch: sample after the 1.2 s punch window too
for (let i = 0; i < 60 * 4; i++) {
  f.events = i === 0 ? ev : []; rig.update(w, f);
  maxD = Math.max(maxD, rig.distance);
  if (i === 59) dAt1s = rig.distance;
}
check('spring converges to D* within 4 s (ω = 4)', near(rig.distance, dStar, dStar * 0.002), `${rig.distance.toFixed(2)} vs ${dStar.toFixed(2)}`);
check('no overshoot past D* (critically damped)', maxD <= dStar * 1.0005, `max ${maxD.toFixed(2)}`);
// analytic x(t) = (x0 + ω x0 t) e^{-ωt}: at t = 1 s the remaining gap is 5·e^-4 ≈ 9.2 % (punch still ~0.4 % active)
const x0 = d0 - dStar;
const expect1 = dStar + x0 * (1 + 4) * Math.exp(-4);
check('spring matches the closed form at t = 1 s (±1.5 % for the punch tail)', near(dAt1s, expect1, Math.abs(expect1) * 0.015), `${dAt1s.toFixed(2)} vs ${expect1.toFixed(2)}`);

// 3) punch: at a converged distance, a rankUp dips D by 8 % immediately, recovering by 1.2 s
T.rank = 1 as RankIndex; T.height = RANKS[1].height;
step(240);
const base = rig.distance;
f.events = [{ type: 'rankUp', rank: 1 }]; f.dt = 1e-4; rig.update(w, f); f.dt = 1 / 60; f.events = [];
check('punch: D × (1 − 0.08) at τ = 0', near(rig.distance / base, 1 - CAMERA.punchFrac, 0.002), (rig.distance / base).toFixed(4));
step(36);   // τ = 0.6 s
const mid = rig.distance / base;
const expMid = 1 - 0.08 * (1 - (1 - Math.pow(1 - 0.5, 3)));
check('punch follows easeOutCubic (τ = 0.6 s)', near(mid, expMid, 0.004), `${mid.toFixed(4)} vs ${expMid.toFixed(4)}`);
step(40);
check('punch over after 1.2 s', near(rig.distance / base, 1, 1e-4), (rig.distance / base).toFixed(5));

// 4) lead: moving titan pulls the target ahead by ~v·0.25 s (smoothed ω = 6)
T.vx = 8; T.vz = 0; T.px = T.x; T.pz = T.z;
step(120);
const tg = rig.target;
check('lead ≈ v·0.25 s along velocity', near(tg.x - T.x, 8 * CAMERA.leadS, 0.02) && near(tg.z - T.z, 0, 1e-6), `${(tg.x - T.x).toFixed(3)}`);
T.vx = 0;

// 5) pitch eases toward the rank pitch (ω = 3)
T.rank = 3 as RankIndex; T.height = RANKS[3].height;
step(1);
const dirA = new THREE.Vector3(); cam.getWorldDirection(dirA);
step(300);
const dirB = new THREE.Vector3(); cam.getWorldDirection(dirB);
const pitchB = Math.asin(-dirB.y) * 180 / Math.PI;
check('pitch → RANKS[IV].pitchDeg = 42°', near(pitchB, 42, 0.05), pitchB.toFixed(3));
check('pitch eased, not snapped', Math.asin(-dirA.y) * 180 / Math.PI < 41.5, (Math.asin(-dirA.y) * 180 / Math.PI).toFixed(2));

// 6) shake: footsteps at Size V move the camera; screenShake=false keeps it rock steady
T.rank = 4 as RankIndex; T.height = RANKS[4].height;
step(400);
const still = cam.position.clone();
const steps: SimEvent[] = [{ type: 'footstep', x: T.x, z: T.z, heavy: 1 }, { type: 'buildingCollapse', id: 1, x: T.x, z: T.z, tier: 4, w: 30, d: 30, h: 120 }];
step(1, steps); step(2);
const moved = cam.position.distanceTo(still);
check('shake: heavy footstep + collapse displaces the camera', moved > 0.05, `${moved.toFixed(3)} m`);
step(120);
check('shake decays to rest (trauma 1.6/s)', cam.position.distanceTo(still) < 1e-6, cam.position.distanceTo(still).toExponential(2));
q.screenShake = false;
step(1, steps); step(2);
check('shake disabled by quality.screenShake = false', cam.position.distanceTo(still) < 1e-6, cam.position.distanceTo(still).toExponential(2));
q.screenShake = true;

// 6b) contract ctor `new CameraRig(camera)` (no Quality arg) reads the live quality that
//     createRenderCore stashes on camera.userData.quality
{
  const cam2 = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 1000);
  const q2: Quality = { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: false };
  cam2.userData.quality = q2;
  const rig2 = new CameraRig(cam2);
  rig2.reset(w);
  const f2: FrameInfo = { alpha: 1, dt: 1 / 60, time: 0, events: [], camDist: 0, frozen: false };
  for (let i = 0; i < 60; i++) rig2.update(w, f2);
  const rest = cam2.position.clone();
  f2.events = steps; rig2.update(w, f2); f2.events = []; rig2.update(w, f2);
  check('ctor(camera) honours camera.userData.quality.screenShake = false', cam2.position.distanceTo(rest) < 1e-6, cam2.position.distanceTo(rest).toExponential(2));
  q2.screenShake = true;          // live object: toggling the setting takes effect immediately
  f2.events = steps; rig2.update(w, f2); f2.events = []; rig2.update(w, f2);
  check('ctor(camera) shakes once the live setting is re-enabled', cam2.position.distanceTo(rest) > 0.05, cam2.position.distanceTo(rest).toFixed(3) + ' m');
}

// 7) Lighting: shadow box fit + texel snapping
const scene = new THREE.Scene();
const L = new Lighting(scene);
L.applyBiome(BIOMES.grideast);
const lights = scene.children.filter((o) => (o as THREE.Light).isLight);
check('fixed pool: exactly 3 lights (1 dir + 1 hemi + 1 ambient)', lights.length === 3 && L.sun.castShadow, lights.map((o) => o.type).join(','));
L.update(w, rig);
const sc = L.sun.shadow.camera;
const Dn = rig.distance, k = 2 * Math.tan(15 * Math.PI / 180);
const halfWanted = 0.9 * Dn * k * (16 / 9);
check('shadow half-size ≥ 0.9·D·k·aspect (quantised up ≤ 6 %)', sc.right >= halfWanted && sc.right <= halfWanted * 1.061, `${sc.right.toFixed(1)} vs ${halfWanted.toFixed(1)}`);
check('shadow depth ≥ 3·D', sc.far - sc.near >= 3 * Dn - 1, `${(sc.far - sc.near).toFixed(0)} vs ${(3 * Dn).toFixed(0)}`);
check('sun elevation is low (28–35°)', (() => { const e = Math.asin(new THREE.Vector3().subVectors(L.sun.position, L.sun.target.position).normalize().y) * 180 / Math.PI; return e >= 27.5 && e <= 35.5; })());
// texel snap: a fixed world point must land on the same sub-texel phase as the target moves
const texel = (sc.right - sc.left) / L.sun.shadow.mapSize.x;
const probe = new THREE.Vector3(T.x + 3.3, 0, T.z - 2.1);
const phase = () => {
  L.sun.shadow.updateMatrices(L.sun);
  const v = probe.clone().applyMatrix4(sc.matrixWorldInverse);
  const fx = ((v.x / texel) % 1 + 1) % 1, fy = ((v.y / texel) % 1 + 1) % 1;
  return [fx, fy];
};
const ph0 = phase();
let worst = 0;
for (let i = 1; i <= 25; i++) {
  T.x += 0.37; T.px = T.x; T.z -= 0.11; T.pz = T.z;
  step(1); L.update(w, rig);
  const ph = phase();
  const dd = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 1 - d); };
  worst = Math.max(worst, dd(ph[0], ph0[0]), dd(ph[1], ph0[1]));
}
check('shadow camera texel-snapped (sub-texel phase constant while walking)', worst < 1e-3, `worst phase drift ${worst.toExponential(2)} texel`);
check('fog scales with D (near/far)', near(scene.fog instanceof THREE.Fog ? (scene.fog as THREE.Fog).near / rig.distance : 0, 1.35, 1e-6), scene.fog ? `${(scene.fog as THREE.Fog).near.toFixed(1)}` : 'none');
L.applyBiome(BIOMES.lockwater);
check('applyBiome never adds lights', scene.children.filter((o) => (o as THREE.Light).isLight).length === 3);

console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
process.exit(fails === 0 ? 0 : 1);
