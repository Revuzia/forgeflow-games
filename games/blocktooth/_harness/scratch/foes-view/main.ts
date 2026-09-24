// foes-view lane scratch preview (port 5184). Imports this lane's modules + three + orchestrator
// files + sim contract exports (real World, real spawnEnemy / spawnBoss, real boss AI).
//   ?mode=lineup[&biome=grideast][&move=1][&zoom=small]   all 8 HALVARD kinds + 1.2 m and 14 m posts
//   ?mode=bosses[&ca=legStomp&ct=0.9&ga=coneBreath&gt=1.4]  split screen: CAISSON-4 | IRON GULLY, real
//        boss sim stepped until each is `ct`/`gt` seconds into the requested attack (phase forced)
//   ?mode=boss&id=caisson4&attack=hookDrop&t=1.0[&yaw=..&pitch=..&dist=..]   one boss close-up
// Telegraph shapes + boss projectiles are drawn here as thin pink stand-ins (their real views
// belong to the combat-view lane) so the body wind-up can be judged against the paint.
import * as THREE from 'three';
import { EnemyView } from '../../../src/ai/enemyview.ts';
import { BossView } from '../../../src/ai/bossview.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnEnemy } from '../../../src/ai/enemies.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import { SIM_DT } from '../../../src/core/config.ts';
import type { BiomeId, BossId, EnemyKind, Shape, World, SimEvent } from '../../../src/core/types.ts';
import type { FrameInfo, Quality, ViewCtx } from '../../../src/render/viewtypes.ts';
import { makeToon } from '../../../src/render/materials.ts';

const q = new URLSearchParams(location.search);
const mode = q.get('mode') ?? 'lineup';
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const W = innerWidth, H = innerHeight;
const label = document.getElementById('label')!;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const quality: Quality = { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true };

interface Stage { scene: THREE.Scene; camera: THREE.PerspectiveCamera; sun: THREE.DirectionalLight; sunDir: THREE.Vector3; ctx: ViewCtx }
function stage(biome: BiomeId, groundSize: number): Stage {
  const B = BIOMES[biome], pal = B.palette;
  // mirrors render/lighting.ts applyBiome (LOOK table + lightTint) so colours read as in game
  const LOOK = { day: [0.34, 0.5, 0.2, 0.12], overcast: [0.33, 0.53, 0.19, 0.2], night: [0.42, 0.44, 0.2, 0.55] }[B.time];
  const tint = (hex: string, sat: number) => { const c = new THREE.Color(hex); const m = Math.max(c.r, c.g, c.b, 1e-4); c.setRGB(c.r / m, c.g / m, c.b / m); return c.lerp(new THREE.Color(1, 1, 1), 1 - sat); };
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(pal.fog);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 5000);
  const sun = new THREE.DirectionalLight(tint(pal.sun, 1), Math.PI * LOOK[0]);
  const sunDir = new THREE.Vector3(B.sunDir[0], B.sunDir[1], B.sunDir[2]).normalize();
  { const el = Math.asin(sunDir.y), e = Math.min(40, Math.max(22, el * 180 / Math.PI)) * Math.PI / 180, hl = Math.hypot(sunDir.x, sunDir.z) || 1;
    sunDir.set(sunDir.x / hl * Math.cos(e), Math.sin(e), sunDir.z / hl * Math.cos(e)); }
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = B.time === 'overcast' ? 3 : 1.6;
  scene.add(sun, sun.target);
  const bounce = new THREE.Color(pal.ground).lerp(new THREE.Color(pal.road), 0.5);
  const bl = Math.max(bounce.r, bounce.g, bounce.b, 1e-4);
  const gcol = new THREE.Color(bounce.r / bl, bounce.g / bl, bounce.b / bl).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(0.72);
  scene.add(new THREE.HemisphereLight(tint(pal.ambient, LOOK[3]), gcol, Math.PI * LOOK[1]));
  scene.add(new THREE.AmbientLight(tint(pal.ambient, LOOK[3] * 0.8), Math.PI * LOOK[2]));
  const groundCol = biome === 'grideast' ? pal.road : biome === 'whitestacks' ? pal.ground : pal.water;
  const g = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), makeToon({ color: groundCol }));
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  // lane stripes so scale + motion read
  const sm = makeToon({ color: pal.roadLine }); sm.polygonOffset = true; sm.polygonOffsetFactor = -1; sm.polygonOffsetUnits = -1;
  for (let i = -6; i <= 6; i++) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(groundSize * 0.012, groundSize * 0.05), sm);
    s.rotation.x = -Math.PI / 2; s.position.set(i * groundSize * 0.08, 0.02, groundSize * 0.12); s.receiveShadow = true; scene.add(s);
  }
  return { scene, camera, sun, sunDir, ctx: { renderer, scene, camera, quality } };
}
function fitSun(s: Stage, look: THREE.Vector3, half: number): void {
  s.sun.position.copy(look).addScaledVector(s.sunDir, half * 3);
  s.sun.target.position.copy(look);
  const c = s.sun.shadow.camera as THREE.OrthographicCamera;
  c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 0.1; c.far = half * 8;
  c.updateProjectionMatrix(); s.sun.target.updateMatrixWorld();
}
function placeCam(cam: THREE.PerspectiveCamera, look: THREE.Vector3, yawDeg: number, pitchDeg: number, D: number, aspect: number): void {
  const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
  cam.position.set(look.x + D * Math.cos(pitch) * Math.sin(yaw), look.y + D * Math.sin(pitch), look.z + D * Math.cos(pitch) * Math.cos(yaw));
  cam.aspect = aspect; cam.near = Math.max(0.1, D * 0.02); cam.far = D * 8 + 400;
  cam.updateProjectionMatrix(); cam.lookAt(look);
}
function post(scene: THREE.Scene, x: number, z: number, h: number, col: string): void {
  const m = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.12, h * 0.035), h, Math.max(0.12, h * 0.035)), makeToon({ color: col }));
  m.position.set(x, h / 2, z); m.castShadow = true; scene.add(m);
  for (let i = 1; i < h; i++) {       // 1 m ticks
    const t = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.2, h * 0.06), 0.06, Math.max(0.2, h * 0.06)), makeToon({ color: '#1b1426' }));
    t.position.set(x, i, z); scene.add(t);
  }
}
const frame = (w: World, dt: number, events: readonly SimEvent[], alpha = 1): FrameInfo =>
  ({ alpha, dt, time: performance.now() / 1000, events, camDist: 100, frozen: false });

// scratch-only stand-ins for telegraphs + projectiles (combat-view lane owns the real ones)
function shapeLine(s: Shape): THREE.Vector3[] {
  const P: THREE.Vector3[] = [];
  const y = 0.4;
  const circ = (x: number, z: number, r: number) => { for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; P.push(new THREE.Vector3(x + Math.sin(a) * r, y, z + Math.cos(a) * r)); } };
  switch (s.k) {
    case 'circle': circ(s.x, s.z, s.r); break;
    case 'ring': circ(s.x, s.z, s.r1); if (s.r0 > 0) circ(s.x, s.z, s.r0); break;
    case 'cone': {
      P.push(new THREE.Vector3(s.x, y, s.z));
      for (let i = 0; i <= 24; i++) { const a = s.dir - s.half + (2 * s.half * i) / 24; P.push(new THREE.Vector3(s.x + Math.sin(a) * s.r, y, s.z + Math.cos(a) * s.r)); }
      P.push(new THREE.Vector3(s.x, y, s.z)); break;
    }
    case 'lane': {
      const fx = Math.sin(s.dir), fz = Math.cos(s.dir), sx = fz * s.w / 2, sz = -fx * s.w / 2;
      const ex = s.x + fx * s.len, ez = s.z + fz * s.len;
      P.push(new THREE.Vector3(s.x + sx, y, s.z + sz), new THREE.Vector3(ex + sx, y, ez + sz), new THREE.Vector3(ex - sx, y, ez - sz), new THREE.Vector3(s.x - sx, y, s.z - sz), new THREE.Vector3(s.x + sx, y, s.z + sz));
      break;
    }
    case 'oval': {
      const fx = Math.sin(s.rot), fz = Math.cos(s.rot);
      for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2, lx = Math.sin(a) * s.rx, lz = Math.cos(a) * s.rz; P.push(new THREE.Vector3(s.x + lx * fz + lz * fx, y, s.z - lx * fx + lz * fz)); }
      break;
    }
    case 'capsule': P.push(new THREE.Vector3(s.x0, y, s.z0), new THREE.Vector3(s.x1, y, s.z1)); break;
  }
  return P;
}
function paint(scene: THREE.Scene, w: World): void {
  const lm = new THREE.LineBasicMaterial({ color: '#ff4fa0' });
  for (const t of w.telegraphs) {
    if (!t.alive) continue;
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(shapeLine(t.shape)), lm);
    scene.add(l);
  }
  for (const p of w.projectiles) {
    if (!p.alive || p.kind === 'hookDrop') continue;
    const m = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 6), new THREE.MeshBasicMaterial({ color: '#ff4fa0' }));
    m.position.set(p.x, p.y, p.z); scene.add(m);
  }
  // titan stand-in: a 60 m post at the titan
  const T = w.titan;
  post(scene, T.x, T.z, 60, '#3fae7f');
}

const ready = () => { (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true; };

// ─────────────────────────────── lineup ───────────────────────────────
function lineup(): void {
  const biome = (q.get('biome') ?? 'grideast') as BiomeId;
  const S = stage(biome, 260);
  const w = createWorld({ titan: 'molo', biome, seed: 7 });
  w.cheats.noSpawns = true;
  w.enemies.length = 0;
  const small = q.get('zoom') === 'small';
  const row: [EnemyKind, number, string, number][] = [
    ['android', 0, 'aim', 0], ['squad', 2.2, 'hold', 0], ['drone', 4.6, 'orbit', 2.6], ['buggy', 8.6, 'strafe', 0],
    ['apc', 15, 'deploy', 0], ['tank', 22.5, 'tell', 0], ['walker', 33, 'barrage', 0], ['elite', 46, 'tell', 0],
  ];
  const kinds = small ? row.slice(0, 5) : row;
  const cx = w.city.spawn.x, cz = w.city.spawn.z;
  const face = Math.PI / 4 + 0.55;          // 3/4 toward the +X+Z camera
  // lay the row out perpendicular to the camera's view direction (screen-horizontal)
  const ax = Math.SQRT1_2, az = -Math.SQRT1_2;
  const at = (u: number, v = 0) => [cx + ax * u - az * v, cz + az * u + ax * v] as const;
  const move = q.get('move') === '1';
  const ens = kinds.map(([k, x, st, y]) => {
    const [px, pz] = at(x);
    const e = spawnEnemy(w, k, px, pz, { elite: q.get('vet') === '1' && k === 'squad' });
    e.heading = e.pheading = face;
    e.x = e.px = px; e.z = e.pz = pz; e.y = e.py = y;
    e.state = st; e.spawnT = -10;
    e.aimX = e.x + Math.sin(face - 0.4) * 30; e.aimZ = e.z + Math.cos(face - 0.4) * 30;
    return e;
  });
  { const [a0, b0] = at(-2.2, -1); post(S.scene, a0, b0, 1.2, '#ffd166'); }
  { const [a1, b1] = at(small ? 19 : 55, -3); post(S.scene, a1, b1, 14, '#ff6f5e'); }
  const view = new EnemyView(S.ctx);
  view.mount(w);
  const dt = 1 / 60;
  const spd = (k: EnemyKind) => (k === 'walker' ? 2.4 : k === 'elite' ? 4 : k === 'drone' ? 5 : k === 'buggy' ? 6 : 3);
  if (move) for (const e of ens) {      // start behind the mark so the walk ends on it
    const back = spd(e.kind) * 150 * dt;
    e.x = e.px = e.x - Math.sin(e.heading) * back; e.z = e.pz = e.z - Math.cos(e.heading) * back;
  }
  for (let i = 0; i < 150; i++) {
    if (move) for (const e of ens) {
      const sp = spd(e.kind) * dt;
      e.px = e.x; e.pz = e.z;
      e.x += Math.sin(e.heading) * sp; e.z += Math.cos(e.heading) * sp;
      if (e.kind !== 'drone') e.state = e.kind === 'walker' ? 'walk' : e.kind === 'tank' || e.kind === 'elite' ? 'crawl' : e.kind === 'buggy' || e.kind === 'apc' ? 'drive' : 'advance';
    }
    if (i === 146 && q.get('flash') === '1') for (const e of ens) if (e.kind === 'tank' || e.kind === 'squad') e.flash = 0.12;
    view.update(w, frame(w, dt, []));
  }
  const [lx, lz] = at(small ? 7.5 : 25);
  const look = new THREE.Vector3(lx, small ? 1.4 : 4.5, lz);
  const D = num('dist', small ? 24 : 78);
  S.scene.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.type === 'PlaneGeometry')!.position.set(lx, 0, lz);
  for (const c of S.scene.children) if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.type === 'PlaneGeometry' && c.position.y > 0.01) c.position.set(c.position.x + lx, c.position.y, c.position.z + lz);
  placeCam(S.camera, look, num('yaw', 45), num('pitch', 28), D, W / H);
  fitSun(S, look, small ? 22 : 50);
  renderer.render(S.scene, S.camera);
  label.textContent = `lineup ${biome}${move ? ' (moving)' : ''} — posts 1.2 m (yellow) + 14 m (coral) · draws ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`;
  ready();
}

// ─────────────────────────────── bosses ───────────────────────────────
const PHASE_OF: Record<string, 1 | 2 | 3> = {
  hookLane: 1, hookDrop: 1, winchLeash: 2, boomSweep: 2, legStomp: 3,
  coneBreath: 1, pawSlam: 1, plateVolley: 2, ridgeCharge: 2, breathSlam: 3,
};
interface BossRun { w: World; view: BossView; ok: boolean; note: string }
function runBoss(id: BossId, biome: BiomeId, S: Stage, attack: string, at: number, seed: number): BossRun {
  const w = createWorld({ titan: 'molo', biome, seed });
  w.cheats.god = true; w.cheats.noSpawns = true;
  const T = w.titan;
  T.rank = 4; T.height = 60; T.radius = 60 * 0.42;
  spawnBoss(w, id);
  const b = w.boss!;
  const view = new BossView(S.ctx);
  view.mount(w);
  let ok = false, staggered = false;
  const want = attack === 'walk' || attack === 'idle' || attack === 'stagger' || attack === 'dead' ? null : attack;
  for (let i = 0; i < 30 * 150; i++) {
    stepWorld(w, NO_INPUT);
    if (b.introT <= 0 && want) b.phase = Math.max(b.phase, PHASE_OF[want] ?? 1) as 1 | 2 | 3;
    view.update(w, frame(w, SIM_DT, w.events));
    if (attack === 'walk' && b.introT > 0 && b.introT < 2.2) { ok = true; break; }
    if (attack === 'idle' && b.introT <= 0 && w.t > 12 && !b.attack) { ok = true; break; }
    if (attack === 'stagger' && b.introT <= 0 && w.t > 8 && !staggered) { staggered = true; b.staggerT = 5; b.attack = null; }
    if (attack === 'stagger' && b.staggerT > 0 && b.staggerT < 5 - at) { ok = true; break; }
    if (attack === 'dead' && b.introT <= 0 && w.t > 8 && b.alive) { b.alive = false; }
    if (attack === 'dead' && !b.alive) { for (let k = 0; k < Math.round(at * 60); k++) view.update(w, frame(w, 1 / 60, [])); ok = true; break; }
    if (want && b.attack === want && b.attackT >= at) { ok = true; break; }
  }
  return { w, view, ok, note: `${id} ${attack}@${at}s ${ok ? '' : '(NOT REACHED) '}phase ${b.phase} t=${w.t.toFixed(1)} tells=${w.telegraphs.filter((t) => t.alive).length}` };
}
function frameBoss(S: Stage, r: BossRun, yaw: number, pitch: number, D: number, aspect: number): void {
  const b = r.w.boss!, T = r.w.titan;
  const onBoss = q.get('look') === 'boss';
  const look = onBoss ? new THREE.Vector3(b.x, 30, b.z) : new THREE.Vector3((b.x * 2 + T.x) / 3, 26, (b.z * 2 + T.z) / 3);
  // ?rel=90 → camera yaw relative to the boss heading (90 = its left flank, 0 = head-on)
  const yawDeg = q.has('rel') ? (b.heading * 180) / Math.PI + num('rel', 90) : yaw;
  placeCam(S.camera, look, yawDeg, pitch, D, aspect);
  fitSun(S, look, D * 0.5);
  S.scene.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.type === 'PlaneGeometry')!.position.set(look.x, 0, look.z);
  paint(S.scene, r.w);
}

function bosses(): void {
  const SA = stage('lockwater', 3000), SB = stage('whitestacks', 3000);
  const ra = runBoss('caisson4', 'lockwater', SA, q.get('ca') ?? 'legStomp', num('ct', 0.9), 11);
  const rb = runBoss('irongully', 'whitestacks', SB, q.get('ga') ?? 'coneBreath', num('gt', 1.4), 5);
  const aspect = (W / 2) / H;
  frameBoss(SA, ra, num('yaw', 45), num('pitch', 34), num('dist', 330), aspect);
  frameBoss(SB, rb, num('yaw', 45), num('pitch', 34), num('dist', 330), aspect);
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, W / 2, H); renderer.setScissor(0, 0, W / 2, H); renderer.render(SA.scene, SA.camera);
  renderer.setViewport(W / 2, 0, W / 2, H); renderer.setScissor(W / 2, 0, W / 2, H); renderer.render(SB.scene, SB.camera);
  renderer.setScissorTest(false);
  label.textContent = `${ra.note}\n${rb.note}\ndraws ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`;
  ready();
}

function boss(): void {
  const id = (q.get('id') ?? 'caisson4') as BossId;
  const biome = (q.get('biome') ?? (id === 'caisson4' ? 'grideast' : 'whitestacks')) as BiomeId;
  const S = stage(biome, 3000);
  const r = runBoss(id, biome, S, q.get('attack') ?? 'idle', num('t', 1), num('seed', 3));
  frameBoss(S, r, num('yaw', 45), num('pitch', 30), num('dist', 260), W / H);
  renderer.render(S.scene, S.camera);
  label.textContent = `${r.note}\ndraws ${renderer.info.render.calls} tris ${renderer.info.render.triangles}`;
  ready();
}

try {
  renderer.info.reset();
  if (mode === 'bosses') bosses(); else if (mode === 'boss') boss(); else lineup();
} catch (err) {
  label.textContent = 'ERROR ' + String((err as Error).stack ?? err);
  console.error(err);
  ready();
}
