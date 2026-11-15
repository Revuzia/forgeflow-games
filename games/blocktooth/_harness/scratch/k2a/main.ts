// K2a GATE VIEW scratch preview. Real World + real gatekeeper sim + the real BossView, TelegraphView,
// ProjectileView and HazardView, stepped until the requested state, then one frame.
//   ?gate=stencil1|cordon2|switchboard5 &state=idle|walk|intro|<attack id>|refill|stagger|dead|relocate|overheated
//   &t=1.0 [&yaw=45&pitch=35&dist=12&H=3.125&seed=3&phase=1&rematch=0]
import * as THREE from 'three';
import { BossView } from '../../../src/ai/bossview.ts';
import { TelegraphView } from '../../../src/render/telegraphview.ts';
import { ProjectileView } from '../../../src/render/projectileview.ts';
import { HazardView } from '../../../src/render/hazardview.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnGate } from '../../../src/ai/bosses/index.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import { SIM_DT } from '../../../src/core/config.ts';
import type { GateId, World, SimEvent } from '../../../src/core/types.ts';
import type { FrameInfo, Quality, ViewCtx } from '../../../src/render/viewtypes.ts';
import { makeToon } from '../../../src/render/materials.ts';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const W = innerWidth, Hh = innerHeight;
const label = document.getElementById('label')!;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1); renderer.setSize(W, Hh);
renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const quality: Quality = { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true };

const biome = (q.get('biome') ?? 'grideast') as 'grideast';
const B = BIOMES[biome], pal = B.palette;
const scene = new THREE.Scene();
scene.background = new THREE.Color(pal.fog);
const camera = new THREE.PerspectiveCamera(30, W / Hh, 0.1, 6000);
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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), makeToon({ color: pal.road }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const ctx: ViewCtx = { renderer, scene, camera, quality };

const gate = (q.get('gate') ?? 'stencil1') as GateId;
const state = q.get('state') ?? 'idle';
const at = num('t', 1);
const HOME: Record<GateId, [number, number]> = { stencil1: [0, 3.125], cordon2: [1, 10.77], switchboard5: [2, 25.6] };
const w: World = createWorld({ titan: (q.get('titan') ?? 'molo') as 'molo', biome, seed: num('seed', 3) });
w.cheats.god = true; w.cheats.noSpawns = true;
const T = w.titan;
const [rank, Hhome] = HOME[gate];
T.rank = (q.has('H') ? 4 : rank) as 0; T.height = num('H', Hhome); T.radius = T.height * 0.42;
if (q.has('H')) w.gates.unlocked = 4 as 0;
spawnGate(w, gate, num('rematch', 0));
const b = w.boss!;
const boss = new BossView(ctx), tel = new TelegraphView(ctx), proj = new ProjectileView(ctx), haz = new HazardView(ctx);
boss.mount(w); tel.mount(w); proj.mount(w); haz.mount(w);
let time = 0;
const Hn = T.height;
const D = num('dist', Hn * (gate === 'switchboard5' ? 5.5 : 7));
const frame = (dt: number, events: readonly SimEvent[], alpha = 1): FrameInfo => ({ alpha, dt, time, events, camDist: D, frozen: false });
const tick = (): void => {
  stepWorld(w, NO_INPUT); time += SIM_DT;
  const f = frame(SIM_DT, w.events);
  boss.update(w, f); tel.update(w, f); proj.update(w, f); haz.update(w, f);
};
const wantPhase = num('phase', 1);
let ok = false;
let staggered = false;
const ATTACK_STATES = new Set(['stripeRun', 'paintBuckets', 'doubleLine', 'uTurn', 'refill', 'shieldShove', 'sawhorseToss', 'backfire', 'overheated', 'callIn', 'holdMusic', 'putThrough', 'relocate', 'packUp', 'squadBehind']);
let tIn = 0;
for (let i = 0; i < 30 * 400 && !ok; i++) {
  tick();
  if (b.introT <= 0 && b.alive) b.phase = Math.max(b.phase, wantPhase) as 1 | 2 | 3;
  // ?orbit=k: the titan circles the rig at k × H (slowly), so front-arc / rear-arc / camping behaviours come up
  if (q.has('orbit') && b.introT <= 0) { const R0 = num('orbit', 2.5) * Hn, a0 = w.t * num('om', 0.12); T.x = b.x + Math.sin(a0) * R0; T.z = b.z + Math.cos(a0) * R0; }
  // keep the titan inside the band and a little mobile so every behaviour comes up
  if (state === 'holdMusic' || state === 'relocate') { const dd = Math.hypot(T.x - b.x, T.z - b.z); if (dd > 2.0 * Hn && b.introT <= 0) { const k = (dd - 1.9 * Hn) / dd; T.x -= (T.x - b.x) * k; T.z -= (T.z - b.z) * k; } }
  if (state === 'intro' && b.introT > 0 && b.introT < 3 - at) ok = true;
  if (state === 'walk' && b.introT <= 0 && w.t > 5 && (b.data.speed ?? 0) > 0.5 && !b.attack) ok = true;
  if (state === 'idle' && b.introT <= 0 && w.t > 6 && !b.attack) ok = true;
  if (state === 'stagger' && b.introT <= 0 && w.t > 6 && !staggered) { staggered = true; b.meter = 1; b.staggerT = 4.5; b.attack = null; }
  if (state === 'stagger' && staggered && b.staggerT > 0 && b.staggerT < 4.5 - at) ok = true;
  if (state === 'dead' && b.introT <= 0 && w.t > 6 && b.alive) { b.alive = false; b.hp = 0; }
  if (state === 'dead' && !b.alive) {
    const n = Math.round(at * 30);
    for (let k = 0; k < n; k++) { time += SIM_DT; boss.update(w, frame(SIM_DT, [])); }
    ok = true;
  }
  if (ATTACK_STATES.has(state) && b.attack === state) { tIn += SIM_DT; if (b.attackT >= at || (state === 'relocate' && (b.data.mode ?? 0) === 5 && tIn >= at)) ok = true; }
  if (state === 'race' && (b.data.raceT ?? 0) > 0 && (b.data.raceT ?? 0) < 0.4 - at) ok = true;
  if (state === 'skid' && (b.data.raceT ?? 0) > 0) tIn = 0.001;
  if (state === 'skid' && tIn > 0 && (b.data.raceT ?? 0) <= 0) { tIn += SIM_DT; if (tIn > at) ok = true; }
  if (state === 'drive' && (b.data.mode ?? 0) === 5 && b.attackT >= at) ok = true;
}
const note = `${gate} ${state}@${at}s ${ok ? '' : '(NOT REACHED) '}phase ${b.phase} t=${w.t.toFixed(1)} attack=${b.attack} aT=${b.attackT.toFixed(2)} ` +
  `H=${(b.data.H ?? 0).toFixed(2)} stag=${b.staggerT.toFixed(2)} drum=${b.data.drumOpen ?? '-'} race=${(b.data.raceT ?? 0).toFixed(2)} mode=${b.data.mode ?? '-'} ` +
  `tells=${w.telegraphs.filter((t) => t.alive).length} shots=${w.projectiles.filter((p) => p.alive).length} hz=${w.hazards.filter((h) => h.alive).length} d=${(Math.hypot(b.x - T.x, b.z - T.z) / Hn).toFixed(1)}H`;

// camera
const look = q.get('look') === 'mid' ? new THREE.Vector3((b.x + T.x) / 2, Hn * 0.6, (b.z + T.z) / 2) : new THREE.Vector3(b.x, num('ly', Hn * (gate === 'switchboard5' ? 1.2 : 0.8)), b.z);
const yawDeg = q.has('rel') ? (b.heading * 180) / Math.PI + num('rel', 90) : num('yaw', 45);
const yaw = yawDeg * Math.PI / 180, pitch = num('pitch', 35) * Math.PI / 180;
camera.position.set(look.x + D * Math.cos(pitch) * Math.sin(yaw), look.y + D * Math.sin(pitch), look.z + D * Math.cos(pitch) * Math.cos(yaw));
camera.aspect = W / Hh; camera.near = Math.max(0.05, D * 0.02); camera.far = D * 8 + 600; camera.updateProjectionMatrix(); camera.lookAt(look);
sun.position.copy(look).addScaledVector(sunDir, D * 1.5); sun.target.position.copy(look);
{
  const c = sun.shadow.camera as THREE.OrthographicCamera; const h = Math.max(Hn * 6, D * 0.8);
  c.left = -h; c.right = h; c.top = h; c.bottom = -h; c.near = 0.1; c.far = D * 6; c.updateProjectionMatrix(); sun.target.updateMatrixWorld();
}
ground.position.set(look.x, 0, look.z);
// titan stand-in post (its height = the titan's)
const post = new THREE.Mesh(new THREE.BoxGeometry(Hn * 0.3, Hn, Hn * 0.3), makeToon({ color: '#3fae7f' }));
post.position.set(T.x, Hn / 2, T.z); post.castShadow = true; scene.add(post);
{ const f = frame(1 / 60, []); boss.update(w, f); tel.update(w, f); proj.update(w, f); haz.update(w, f); }
renderer.info.reset();
renderer.render(scene, camera);
label.textContent = `${note}\ndraws ${renderer.info.render.calls} tris ${renderer.info.render.triangles} (incl. shadow pass)`;
const g = window as unknown as { __SNAP_READY__: boolean; __NOTE__: string };
g.__NOTE__ = label.textContent;
g.__SNAP_READY__ = true;
