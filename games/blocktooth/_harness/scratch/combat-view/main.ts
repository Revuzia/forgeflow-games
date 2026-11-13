// combat-view lane scratch preview (port 5185). A REAL World (createWorld → real city layout for
// context) whose telegraphs / projectiles / hazards arrays are replaced by hand-built records laid
// out in a screen-space grid, drawn by this lane's three views. The sim is never stepped (frozen).
//   ?show=tg|proj|hz|all   what to lay out (default tg)
//   ?rank=0..4             camera distance/pitch + shape sizes for that Size rank (default 1)
//   ?biome=grideast|whitestacks|lockwater
//   ?grey=1                greyscale canvas (shape-coding check)
//   ?anim=1                cycle telegraph windups instead of fixed progress values
// window.__fire(i) fires telegraph i (flash test); window.__SNAP_READY__ after warm frames.
import * as THREE from 'three';
import type { BiomeId, Hazard, HazardKind, Projectile, ProjectileKind, RankIndex, Shape, SimEvent, Telegraph, TelegraphStyle, Owner } from '../../../src/core/types.ts';
import { createWorld } from '../../../src/core/world.ts';
import { RANKS, cameraDistance, CAMERA } from '../../../src/core/config.ts';
import { BIOMES } from '../../../src/data/biomes.ts';
import type { FrameInfo, Quality, ViewCtx } from '../../../src/render/viewtypes.ts';
import { TelegraphView } from '../../../src/render/telegraphview.ts';
import { ProjectileView } from '../../../src/render/projectileview.ts';
import { HazardView } from '../../../src/render/hazardview.ts';
import { addOutline, makeToon } from '../../../src/render/materials.ts';

const q = new URLSearchParams(location.search);
const show = q.get('show') ?? 'tg';
const rank = Math.max(0, Math.min(4, Number(q.get('rank') ?? 1))) as RankIndex;
const biome = (q.get('biome') ?? 'grideast') as BiomeId;
const anim = q.get('anim') === '1';
if (q.get('grey') === '1') document.getElementById('c')!.style.filter = 'grayscale(1)';

const W = innerWidth, Hh = innerHeight;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, Hh, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const B = BIOMES[biome];
const P = B.palette;
const scene = new THREE.Scene();
scene.background = new THREE.Color(P.sky);
const camera = new THREE.PerspectiveCamera(CAMERA.fovDeg, W / Hh, 0.1, 5000);

const night = B.time === 'night';
const sun = new THREE.DirectionalLight(P.sun, Math.PI * (night ? 0.18 : 0.34));
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(new THREE.Color('#ffffff').lerp(new THREE.Color(P.ambient), 0.3), new THREE.Color(P.ground).multiplyScalar(0.7), Math.PI * (night ? 0.3 : 0.5)));
scene.add(new THREE.AmbientLight(P.ambient, Math.PI * (night ? 0.3 : 0.2)));

// ─────────────── real world (city layout for context) ───────────────
const titan = (q.get('titan') ?? 'briarwick') as 'molo' | 'voltkite' | 'hearthback' | 'briarwick';
const w = createWorld({ titan, biome, seed: Number(q.get('seed') ?? 7) });
const H = RANKS[rank].height;
w.titan.rank = rank; w.titan.height = H;
const tx0 = w.city.spawn.x, tz0 = w.city.spawn.z;

const CAM_Y = RANKS[rank].height * CAMERA.targetYFrac + cameraDistance(RANKS[rank].height, rank) * Math.sin((RANKS[rank].pitchDeg * Math.PI) / 180);
// merged context city: road plane, block slabs, buildings (toon boxes), pink/green tree blobs
function buildCity(): THREE.Group {
  const g = new THREE.Group();
  const c = w.city;
  const bd = c.bounds;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(bd.maxX - bd.minX + 400, bd.maxZ - bd.minZ + 400), makeToon({ color: P.road }));
  road.rotation.x = -Math.PI / 2; road.position.set((bd.minX + bd.maxX) / 2, 0, (bd.minZ + bd.maxZ) / 2); road.receiveShadow = true;
  g.add(road);
  const pos: number[] = [], col: number[] = [];
  const cc = new THREE.Color();
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, hex: string) => {
    cc.set(hex);
    const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
    for (const [a, b2, c2, d] of f) for (const i of [a, b2, c2, a, c2, d]) {
      pos.push(x + v[i][0] * hx, y + v[i][1] * hy, z + v[i][2] * hz); col.push(cc.r, cc.g, cc.b);
    }
  };
  const half = (c.pitch - c.roadW) / 2;
  for (let bx = 0; bx < c.blocksX; bx++) for (let bz = 0; bz < c.blocksZ; bz++) {
    const x = c.originX + (bx + 0.5) * c.pitch, z = c.originZ + (bz + 0.5) * c.pitch;
    box(x, 0.08, z, half, 0.08, half, P.sidewalk);
  }
  const bodies = [P.bodyA, P.bodyB, P.bodyC];
  const clearR = q.get('tall') === '1' ? 0 : cameraDistance(RANKS[rank].height, rank) * 0.55;
  for (const b of c.buildings) {
    if (b.collapsed) continue;
    if (Math.hypot(b.x - c.spawn.x, b.z - c.spawn.z) < clearR) continue;   // open plaza around the test grid
    // context only: keep every box well under the camera (a camera inside a hull renders solid ink)
    const h = Math.min(Math.max(2, b.floors * b.floorH), Math.max(3, CAM_Y * (q.get('tall') === '1' ? 0.45 : 0.12)));
    box(b.x, h / 2, b.z, b.w / 2, h / 2, b.d / 2, bodies[Math.floor(b.variant * 3) % 3]);
    box(b.x, h + 0.3, b.z, b.w / 2 * 0.96, 0.3, b.d / 2 * 0.96, P.roofA);
  }
  for (const p of c.props) {
    if (p.kind === 'tree') { box(p.x, 3.2, p.z, 1.6, 1.6, 1.6, P.foliage); box(p.x, 1.1, p.z, 0.25, 1.1, 0.25, P.trimA); }
  }
  // zebra stripes on crosswalks
  for (const cw of c.crosswalks) {
    const n = Math.max(3, Math.floor(cw.len / 1.2));
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * 1.2;
      if (cw.axis === 'x') box(cw.x + o, 0.03, cw.z, 0.35, 0.03, cw.width / 2, P.crosswalk);
      else box(cw.x, 0.03, cw.z + o, cw.width / 2, 0.03, 0.35, P.crosswalk);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, makeToon({ vertexColors: true }));
  m.castShadow = true; m.receiveShadow = true;
  addOutline(m, 1.2);
  g.add(m);
  return g;
}
const cityGroup = buildCity();
scene.add(cityGroup);
// draw calls of THIS lane's views only (city context hidden for one measured render)
(window as unknown as Record<string, unknown>).__myDraws = () => {
  cityGroup.visible = false;
  renderer.info.autoReset = false;
  renderer.info.reset();
  renderer.render(scene, camera);
  const r = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, programs: renderer.info.programs?.length ?? -1 };
  renderer.info.autoReset = true;
  cityGroup.visible = true;
  return JSON.stringify(r);
};

// ─────────────── camera (game formula) ───────────────
const D = cameraDistance(H, rank);
const pitch = (RANKS[rank].pitchDeg * Math.PI) / 180, yaw = (CAMERA.yawDeg * Math.PI) / 180;
const look = new THREE.Vector3(tx0, H * CAMERA.targetYFrac, tz0);
camera.position.set(look.x + D * Math.cos(pitch) * Math.sin(yaw), look.y + D * Math.sin(pitch), look.z + D * Math.cos(pitch) * Math.cos(yaw));
camera.near = Math.max(0.1, D * 0.02); camera.far = D * 6 + 400;
camera.updateProjectionMatrix();
camera.lookAt(look);
const sunDir = new THREE.Vector3(...B.sunDir).normalize();
const extent = D * 2 * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
sun.position.copy(look).addScaledVector(sunDir, D * 2);
sun.target.position.copy(look);
{ const sc = extent * 1.2; const cam = sun.shadow.camera as THREE.OrthographicCamera; cam.left = -sc; cam.right = sc; cam.top = sc; cam.bottom = -sc; cam.near = 0.1; cam.far = D * 5; cam.updateProjectionMatrix(); }

// screen-space grid on the ground: right = (cos yaw, −sin yaw), up(screen) = (−sin yaw, −cos yaw)
const RX = Math.cos(yaw), RZ = -Math.sin(yaw), UX = -Math.sin(yaw), UZ = -Math.cos(yaw);
const aspect = W / Hh;
const cellW = (extent * aspect) / 4.3;
const cellH = extent / 2.9 / Math.sin(pitch);
function cell(col: number, row: number, cols = 4, rows = 2): { x: number; z: number } {
  const u = (col - (cols - 1) / 2) * cellW * (4 / cols);
  const v = ((rows - 1) / 2 - row) * cellH * (2 / rows);
  return { x: tx0 + RX * u + UX * v, z: tz0 + RZ * u + UZ * v };
}
const upHeading = Math.atan2(UX, UZ);    // heading that points "up" the screen
const rightHeading = Math.atan2(RX, RZ);

// ─────────────── telegraphs ───────────────
let nextId = 1000;
function tgRec(style: TelegraphStyle, shape: Shape, prog: number, owner: Owner = 'enemy', chain: number[] | null = null, active = 0): Telegraph {
  const windup = 1.5;
  return { id: nextId++, alive: true, owner, style, shape, windup, t: windup * prog, active, dmg: 1, kind: 'generic', fired: false,
    hitTitan: false, onFire: null, chain, tag: 'scratch' };
}
const tgs: Telegraph[] = [];
const progs: number[] = [];
if (show === 'tg' || show === 'all') {
  const s = Math.min(cellW, cellH * Math.sin(pitch) * 1.4);
  const c0 = cell(0, 0), c1 = cell(1, 0), c2 = cell(2, 0), c3 = cell(3, 0);
  const c4 = cell(0, 1), c5 = cell(1, 1), c6 = cell(2, 1), c7 = cell(3, 1);
  const back = (c: { x: number; z: number }, k: number) => ({ x: c.x - UX * k, z: c.z - UZ * k });
  const a = back(c0, cellH * 0.42);
  tgs.push(tgRec('cone', { k: 'cone', x: a.x, z: a.z, dir: upHeading, half: 0.5, r: cellH * 0.85 }, 0.3));
  tgs.push(tgRec('oval', { k: 'oval', x: c1.x, z: c1.z, rx: s * 0.42, rz: cellH * 0.36, rot: upHeading + 0.3 }, 0.55));
  const l = back(c2, cellH * 0.42);
  tgs.push(tgRec('lane', { k: 'lane', x: l.x, z: l.z, dir: upHeading, len: cellH * 0.85, w: s * 0.36 }, 0.45));
  tgs.push(tgRec('ring', { k: 'ring', x: c3.x, z: c3.z, r0: s * 0.2, r1: s * 0.44 }, 0.7));
  tgs.push(tgRec('circle', { k: 'circle', x: c4.x, z: c4.z, r: s * 0.4 }, 0.85));
  const ch: number[] = [];
  for (let i = 0; i < 5; i++) {
    const u = (i / 4 - 0.5) * s * 0.85, v = (i % 2 ? 0.25 : -0.25) * cellH * 0.8;
    ch.push(c5.x + RX * u + UX * v, c5.z + RZ * u + UZ * v);
  }
  tgs.push(tgRec('chain', { k: 'capsule', x0: ch[0], z0: ch[1], x1: ch[8], z1: ch[9], r: s * 0.09 }, 0.5, 'enemy', ch));
  tgs.push(tgRec('circle', { k: 'circle', x: c6.x, z: c6.z, r: s * 0.38 }, 0.6, 'titan'));
  tgs.push(tgRec('ring', { k: 'ring', x: c7.x, z: c7.z, r0: 0, r1: s * 0.42 }, 0.2, 'boss'));
  for (const t of tgs) progs.push(t.t / t.windup);
}

// ─────────────── projectiles ───────────────
const projs: Projectile[] = [];
interface PMove { vx: number; vy: number; vz: number; x0: number; y0: number; z0: number; lob: boolean; T: number; tx: number; tz: number; apex: number; }
const moves: PMove[] = [];
if (show === 'proj' || show === 'all') {
  const kinds: ProjectileKind[] = ['pellet', 'volley', 'rocket', 'shell', 'mortar', 'plate', 'hookDrop', 'seed', 'rubbleShot', 'spark'];
  kinds.forEach((k, i) => {
    const c = show === 'all' ? cell(i % 4, Math.floor(i / 4) % 2) : cell(i % 6, Math.floor(i / 6), 6, 2);
    const titanSide = k === 'seed' || k === 'rubbleShot' || k === 'spark';
    const lob = k === 'mortar' || k === 'plate' || k === 'hookDrop' || k === 'rocket' || k === 'rubbleShot';
    const sp = cellW * 0.8;
    const r = titanSide ? Math.max(0.3, 0.12 * H) : 0.5;
    const y = k === 'hookDrop' ? cellH * 0.25 : lob ? cellH * 0.18 : Math.max(1.2, H * 0.4);
    const p: Projectile = { id: nextId++, alive: true, owner: titanSide ? 'titan' : 'enemy', kind: k, x: c.x, z: c.z, y, px: c.x, pz: c.z, py: y,
      vx: RX * sp, vz: RZ * sp, vy: 0, r, dmg: 1, life: 2, pierce: 0, crit: false, lob, tx: c.x, tz: c.z, aoe: 3, tg: -1 };
    projs.push(p);
    moves.push({ vx: k === 'hookDrop' ? 0 : RX * sp, vy: 0, vz: k === 'hookDrop' ? 0 : RZ * sp, x0: c.x - RX * cellW * 0.35, y0: y, z0: c.z - RZ * cellW * 0.35, lob, T: 1.6, tx: 0, tz: 0, apex: y });
  });
}

// ─────────────── hazards ───────────────
const hzs: Hazard[] = [];
if (show === 'hz' || show === 'all') {
  const mk = (kind: HazardKind, shape: Shape, owner: Owner, t: number, life: number, data: Record<string, number> = {}): Hazard =>
    ({ id: nextId++, alive: true, owner, kind, shape, t, life, dps: 0, tickT: 0, data });
  const s = Math.min(cellW, cellH * Math.sin(pitch) * 1.4);
  const cs = show === 'all'
    ? [cell(0, 1), cell(1, 1), cell(2, 1), cell(3, 1), cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0)]
    : [cell(0, 0), cell(1, 0), cell(2, 0), cell(3, 0), cell(0, 1), cell(1, 1), cell(2, 1), cell(3, 1)];
  const [a, b, c, d, e, f, g, h] = cs;
  const wl = s * 0.42;
  hzs.push(mk('wire', { k: 'capsule', x0: a.x - RX * wl, z0: a.z - RZ * wl + 0, x1: a.x + RX * wl, z1: a.z + RZ * wl, r: s * 0.09 }, 'titan', 1, 4, { life0: 4, h: H }));
  hzs.push(mk('magma', { k: 'circle', x: b.x, z: b.z, r: s * 0.36 }, 'titan', 1, 6, { h: H }));
  // two blooms: one mid-life (fires every 1.2 s), one withering
  const bh = s * 1.1;
  hzs.push(mk('bloom', { k: 'circle', x: c.x - RX * s * 0.2, z: c.z - RZ * s * 0.2, r: bh * 0.3 }, 'titan', 5, 20, { cd: 0.9, spore: 3, h: bh }));
  hzs.push(mk('bloom', { k: 'circle', x: c.x + RX * s * 0.25, z: c.z + RZ * s * 0.25, r: bh * 0.3 }, 'titan', 18.2, 20, { cd: 0.9, spore: 3, h: bh }));
  hzs.push(mk('spore', { k: 'circle', x: d.x, z: d.z, r: s * 0.42 }, 'titan', 1, 3, {}));
  hzs.push(mk('frost', { k: 'circle', x: e.x, z: e.z, r: s * 0.4 }, 'boss', 2, 7, { slow: 0.4 }));
  hzs.push(mk('frost', { k: 'circle', x: f.x, z: f.z, r: s * 0.3 }, 'titan', 1, 5, { upg: 1 }));
  hzs.push(mk('fire', { k: 'circle', x: g.x, z: g.z, r: s * 0.32 }, 'enemy', 1, 5, {}));
  hzs.push(mk('oil', { k: 'circle', x: h.x, z: h.z, r: s * 0.38 }, 'enemy', 1, 8, {}));
}

w.telegraphs = tgs;
w.projectiles = projs;
w.hazards = hzs;

// ─────────────── views ───────────────
const quality: Quality = { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true };
const ctx: ViewCtx = { renderer, scene, camera, quality };
const views = [new HazardView(ctx), new TelegraphView(ctx), new ProjectileView(ctx)];
for (const v of views) v.mount(w);
(window as unknown as Record<string, unknown>).__views = views;

let pending: SimEvent[] = [];
(window as unknown as Record<string, unknown>).__fire = (i: number) => {
  const t = tgs[i];
  if (!t) return false;
  t.fired = true; t.alive = false; t.t = t.windup;
  pending.push({ type: 'telegraphFire', id: t.id, owner: t.owner, hit: false, x: 0, z: 0 });
  return true;
};

const label = document.getElementById('label')!;
label.textContent = `combat-view · show=${show} · rank ${RANKS[rank].name} (H ${H} m, D ${D.toFixed(1)} m) · ${B.name}`;
const t0 = performance.now();
let last = t0;
let frames = 0;
function frame(): void {
  const now = performance.now();
  const time = (now - t0) / 1000;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // telegraph windups
  for (let i = 0; i < tgs.length; i++) {
    const t = tgs[i];
    if (!t.alive) continue;
    t.t = anim ? ((time * 0.45 + i * 0.13) % 1) * t.windup : progs[i] * t.windup;
  }
  // projectiles loop across their cell
  for (let i = 0; i < projs.length; i++) {
    const p = projs[i], m = moves[i];
    const u = ((time * 0.35 + i * 0.07) % 1);
    p.px = p.x; p.pz = p.z; p.py = p.y;
    p.x = m.x0 + m.vx * u * 0.9 * (cellW / Math.max(1e-3, Math.hypot(m.vx, m.vz) || 1));
    p.z = m.z0 + m.vz * u * 0.9 * (cellW / Math.max(1e-3, Math.hypot(m.vx, m.vz) || 1));
    if (p.kind === 'hookDrop') { p.x = m.x0 + RX * cellW * 0.35; p.z = m.z0 + RZ * cellW * 0.35; p.y = m.y0 * (1 - u); }
    else if (m.lob) p.y = m.y0 * 4 * (0.2 + 0.8 * u) * (1 - (0.2 + 0.8 * u)) + 0.5;
  }
  // bloom turrets: fire every 1.2 s, spore every 4 s
  for (const h of hzs) {
    if (h.kind !== 'bloom') continue;
    h.data.cd = 1.2 - ((time + h.id * 0.1) % 1.2);
    h.data.spore = 4 - ((time + h.id * 0.3) % 4);
  }
  const f: FrameInfo = { alpha: 1, dt, time, events: pending, camDist: D, frozen: true };
  for (const v of views) v.update(w, f);
  pending = [];
  renderer.render(scene, camera);
  if (++frames === 30) (window as unknown as Record<string, unknown>).__SNAP_READY__ = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
