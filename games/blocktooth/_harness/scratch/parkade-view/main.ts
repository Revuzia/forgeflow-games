// L7 PARKADE-VIEW scratch preview (port 5256). Real World + real PARKADE-6 sim + the real BossView,
// TelegraphView and ProjectileView, stepped until the requested attack is `t` seconds in, then one frame.
//   ?attack=idle|walk|intro|rampLaunch|barrierSwing|towChain|deckDrop|levelCollapse|stagger|dead|till
//    &t=1.0 [&yaw=45&pitch=30&dist=260&look=boss|mid&rel=deg&seed=3&H=60&ly=28]
import * as THREE from 'three';
import { BossView } from '../../../src/ai/bossview.ts';
import { TelegraphView } from '../../../src/render/telegraphview.ts';
import { ProjectileView } from '../../../src/render/projectileview.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import { SIM_DT } from '../../../src/core/config.ts';
import type { World, SimEvent } from '../../../src/core/types.ts';
import type { FrameInfo, Quality, ViewCtx } from '../../../src/render/viewtypes.ts';
import { makeToon } from '../../../src/render/materials.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const W = innerWidth, H = innerHeight;
const label = document.getElementById('label')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const quality: Quality = { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true };

const B = BIOMES.grideast, pal = B.palette;
const scene = new THREE.Scene();
scene.background = new THREE.Color(pal.fog);
const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 6000);
const tint = (hex: string, sat: number) => { const c = new THREE.Color(hex); const m = Math.max(c.r, c.g, c.b, 1e-4); c.setRGB(c.r / m, c.g / m, c.b / m); return c.lerp(new THREE.Color(1, 1, 1), 1 - sat); };
const LOOK = [0.34, 0.5, 0.2, 0.12];
const sun = new THREE.DirectionalLight(tint(pal.sun, 1), Math.PI * LOOK[0]);
const sunDir = new THREE.Vector3(B.sunDir[0], B.sunDir[1], B.sunDir[2]).normalize();
{
  const el = Math.asin(sunDir.y), e = Math.min(40, Math.max(22, el * 180 / Math.PI)) * Math.PI / 180, hl = Math.hypot(sunDir.x, sunDir.z) || 1;
  sunDir.set(sunDir.x / hl * Math.cos(e), Math.sin(e), sunDir.z / hl * Math.cos(e));
}
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 1.6;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(tint(pal.ambient, LOOK[3]), new THREE.Color('#8a9a94'), Math.PI * LOOK[1]));
scene.add(new THREE.AmbientLight(tint(pal.ambient, LOOK[3] * 0.8), Math.PI * LOOK[2]));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), makeToon({ color: pal.road }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const ctx: ViewCtx = { renderer, scene, camera, quality };

const attack = q.get('attack') ?? 'idle';
const at = num('t', 1);
const PHASE_OF: Record<string, 1 | 2 | 3> = { rampLaunch: 1, barrierSwing: 1, towChain: 2, deckDrop: 2, levelCollapse: 3, till: 1 };

const w: World = createWorld({ titan: 'molo', biome: 'grideast', seed: num('seed', 3) });
w.cheats.god = true; w.cheats.noSpawns = true;
const T = w.titan;
T.rank = 4; T.height = num('H', 60); T.radius = T.height * 0.42;
spawnBoss(w, 'parkade6');
const b = w.boss!;
const boss = new BossView(ctx), tel = new TelegraphView(ctx), proj = new ProjectileView(ctx);
boss.mount(w); tel.mount(w); proj.mount(w);
let time = 0;
const D = num('dist', 260);
const frame = (dt: number, events: readonly SimEvent[], alpha = 1): FrameInfo => ({ alpha, dt, time, events, camDist: D, frozen: false });
const tick = (): void => {
  stepWorld(w, NO_INPUT); time += SIM_DT;
  const f = frame(SIM_DT, w.events);
  boss.update(w, f); tel.update(w, f); proj.update(w, f);
};

let ok = false;
const want = PHASE_OF[attack] ? (attack === 'till' ? 'rampLaunch' : attack) : null;
let staggered = false;
for (let i = 0; i < 30 * 300 && !ok; i++) {
  tick();
  if (b.introT <= 0 && want) b.phase = Math.max(b.phase, PHASE_OF[want] ?? 1) as 1 | 2 | 3;
  if (attack === 'intro' && b.introT > 0 && b.introT < 4 - at) ok = true;
  if (attack === 'walk' && b.introT <= 0 && w.t > 6 && (b.data.speed ?? 0) > 1 && !b.attack) ok = true;
  if (attack === 'idle' && b.introT <= 0 && w.t > 12 && !b.attack) ok = true;
  if (attack === 'stagger' && b.introT <= 0 && w.t > 8 && !staggered) { staggered = true; b.staggerT = 5; b.attack = null; }
  if (attack === 'stagger' && b.staggerT > 0 && b.staggerT < 5 - at) ok = true;
  if (attack === 'dead' && b.introT <= 0 && w.t > 8 && b.alive) { b.alive = false; b.hp = 0; }
  if (attack === 'dead' && !b.alive) {
    const n = Math.round(at * 30);
    for (let k = 0; k < n; k++) { time += SIM_DT; boss.update(w, frame(SIM_DT, [])); }
    ok = true;
  }
  if (want && b.attack === want && b.attackT >= at) ok = true;
}
const note = `${attack}@${at}s ${ok ? '' : '(NOT REACHED) '}phase ${b.phase} t=${w.t.toFixed(1)} attack=${b.attack} aT=${b.attackT.toFixed(2)} ` +
  `till=${(b.data.tillOpen ?? 0).toFixed(2)} tow=${b.data.tow ?? 0} leash=${w.titan.leash ? 1 : 0} tilt=${(b.data.deckTilt ?? 0).toFixed(2)} ` +
  `tells=${w.telegraphs.filter((t) => t.alive).length} shots=${w.projectiles.filter((p) => p.alive).length} d=${Math.hypot(b.x - T.x, b.z - T.z).toFixed(0)} ` +
  `wu=${w.telegraphs.filter((t) => t.alive && t.owner === 'boss').map((t) => `${t.tag}:${t.t.toFixed(2)}/${t.windup.toFixed(2)}${t.fired ? 'F' : ''}`).join(',')}`;

// camera
const lookMode = q.get('look') ?? 'boss';
const look = lookMode === 'boss' ? new THREE.Vector3(b.x, num('ly', 28), b.z) : new THREE.Vector3((b.x + T.x) / 2, num('ly', 20), (b.z + T.z) / 2);
const yawDeg = q.has('rel') ? (b.heading * 180) / Math.PI + num('rel', 90) : num('yaw', 45);
const yaw = yawDeg * Math.PI / 180, pitch = num('pitch', 30) * Math.PI / 180;
camera.position.set(look.x + D * Math.cos(pitch) * Math.sin(yaw), look.y + D * Math.sin(pitch), look.z + D * Math.cos(pitch) * Math.cos(yaw));
camera.aspect = W / H; camera.near = Math.max(0.1, D * 0.02); camera.far = D * 8 + 600; camera.updateProjectionMatrix(); camera.lookAt(look);
sun.position.copy(look).addScaledVector(sunDir, D * 1.5); sun.target.position.copy(look);
{
  const c = sun.shadow.camera as THREE.OrthographicCamera; const h = Math.max(120, D * 0.6);
  c.left = -h; c.right = h; c.top = h; c.bottom = -h; c.near = 0.1; c.far = D * 6; c.updateProjectionMatrix(); sun.target.updateMatrixWorld();
}
ground.position.set(look.x, 0, look.z);
// titan stand-in post so scale and the tow line read
const post = new THREE.Mesh(new THREE.BoxGeometry(T.height * 0.12, T.height, T.height * 0.12), makeToon({ color: '#3fae7f' }));
post.position.set(T.x, T.height / 2, T.z); post.castShadow = true; scene.add(post);
{ const f = frame(1 / 60, []); boss.update(w, f); tel.update(w, f); proj.update(w, f); }
if (q.get('noshadow') === '1') { renderer.shadowMap.enabled = false; sun.castShadow = false; }
renderer.info.reset();
renderer.render(scene, camera);
label.textContent = `${note}\ndraws ${renderer.info.render.calls} tris ${renderer.info.render.triangles} ${q.get('noshadow') === '1' ? '(main pass only)' : '(incl. shadow pass)'}`;
const g = window as unknown as { __SNAP_READY__: boolean; __NOTE__: string };
g.__NOTE__ = label.textContent;
g.__SNAP_READY__ = true;
