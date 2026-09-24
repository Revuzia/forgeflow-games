// city-kit lane scratch preview (port 5182). Imports only this lane's module + three +
// orchestrator files (+ render/materials.ts, which the kit itself uses for outline normals).
//   ?biome=grideast|whitestacks|lockwater
//   &cam=near|wide|props|tall|street|corner|mega|rubble|rank1|rank1b|rank2|vehicles|furniture|heavy|crown|podium
// Builds the kit from inline FIXTURE biome defs, lays out a 2×2-block street diorama with
// instanced base/floor×n/roof stacks (non-uniform scales, instanceColor tints), every prop kind
// in a lineup, parked cars, street furniture and rubble piles, under a local copy of the
// render-core light-pool numbers (toon ramp + inverted-hull outlines from render/materials.ts).
import * as THREE from 'three';
import { buildCityKit } from '../../../src/city/meshkit.ts';
import { addOutline, makeToon } from '../../../src/render/materials.ts';
import type { BiomeId, BuildingArchetype, PropKind, Tier } from '../../../src/core/types.ts';
import { FIXTURES } from './fixtures.ts';

const q = new URLSearchParams(location.search);
const biomeId = (q.get('biome') ?? 'grideast') as BiomeId;
const camName = q.get('cam') ?? 'near';
const B = FIXTURES[biomeId];
const P = B.palette;
const t0 = performance.now();
const kit = buildCityKit(B);
const buildMs = performance.now() - t0;

// ─────────────────────────────── renderer / scene ───────────────────────────────
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(1.5, Number(q.get('dpr') ?? 1)));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.5, 3000);

// ─────────────────────────────── lighting (mirror of render/lighting.ts LOOK) ───────────────────────────────
const LOOK = {
  day: { sun: 0.43, hemi: 0.47, ambient: 0.15, tintSat: 0.5, fogNear: 1.35, fogFar: 3.6, shadowRadius: 2.5 },
  overcast: { sun: 0.36, hemi: 0.5, ambient: 0.18, tintSat: 0.4, fogNear: 1.1, fogFar: 3.0, shadowRadius: 4 },
  night: { sun: 0.42, hemi: 0.44, ambient: 0.2, tintSat: 0.55, fogNear: 1.15, fogFar: 3.1, shadowRadius: 2.5 },
}[B.time];
const white = new THREE.Color(1, 1, 1);
function tint(hex: string, sat: number): THREE.Color {
  const c = new THREE.Color(hex);
  const m = Math.max(c.r, c.g, c.b, 1e-4);
  return c.setRGB(c.r / m, c.g / m, c.b / m).lerp(white, 1 - sat);
}
const sun = new THREE.DirectionalLight(tint(P.sun, 1), Math.PI * LOOK.sun);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = LOOK.shadowRadius;
sun.shadow.blurSamples = 8;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(tint(P.ambient, LOOK.tintSat), 0xffffff, Math.PI * LOOK.hemi);
{
  const bounce = new THREE.Color(P.ground).lerp(new THREE.Color(P.road), 0.5);
  const bl = Math.max(bounce.r, bounce.g, bounce.b, 1e-4);
  hemi.groundColor.setRGB(bounce.r / bl, bounce.g / bl, bounce.b / bl).lerp(white, 0.35).multiplyScalar(0.72);
}
scene.add(hemi);
scene.add(new THREE.AmbientLight(tint(P.ambient, LOOK.tintSat * 0.8), Math.PI * LOOK.ambient));
const sunDir = new THREE.Vector3(...B.sunDir).normalize();
scene.background = new THREE.Color(P.fog);
scene.fog = new THREE.Fog(P.fog, 100, 400);

// ─────────────────────────────── deterministic helpers ───────────────────────────────
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const SLAB = 0.15;              // sidewalk / parcel height above the carriageway
const PITCH = 72, ROAD_W = 14, CURB = 29;
const mats: THREE.Material[] = [];
const toon = (hex: string) => { const m = makeToon({ color: hex }); mats.push(m); return m; };

// ─────────────────────────────── ground ───────────────────────────────
function plane(w: number, d: number, x: number, y: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
plane(900, 900, 0, 0, 0, kit.ground.road);
const blockCentres: [number, number][] = [[36, 36], [-36, 36], [36, -36], [-36, -36]];
for (const [bx, bz] of blockCentres) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(CURB * 2, SLAB, CURB * 2).toNonIndexed(), kit.ground.sidewalk);
  slab.position.set(bx, SLAB / 2, bz);
  slab.receiveShadow = true;
  scene.add(slab);
}
// outer ring of blocks (context, sidewalk slabs only) so the diorama does not float in asphalt
for (let i = -2; i <= 1; i++) for (let j = -2; j <= 1; j++) {
  const cx = (i + 0.5) * PITCH, cz = (j + 0.5) * PITCH;
  if (Math.abs(cx) < 40 && Math.abs(cz) < 40) continue;
  if (cz > 70 && cx > -40 && cx < 110) continue;                     // lineup lot lives here
  const slab = new THREE.Mesh(new THREE.BoxGeometry(CURB * 2, SLAB, CURB * 2).toNonIndexed(), kit.ground.sidewalk);
  slab.position.set(cx, SLAB / 2, cz);
  slab.receiveShadow = true;
  scene.add(slab);
  plane(52, 52, cx, SLAB + 0.02, cz, kit.ground.lot);
}
// road markings: zebras at the central intersection + dashed centre lines
const lineMat = toon(P.roadLine);
const zebraMat = toon(P.crosswalk);
for (const m of [lineMat, zebraMat]) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
for (const s of [-1, 1]) {
  for (let k = -5; k <= 5; k++) {
    plane(4, 0.62, s * 10, 0.01, k * 1.25, zebraMat);                 // crossing the X road
    plane(0.62, 4, k * 1.25, 0.01, s * 10, zebraMat);                 // crossing the Z road
  }
  for (let k = 0; k < 10; k++) {
    const a = 16 + k * 8;
    plane(3.2, 0.16, s * a, 0.01, 0, lineMat);
    plane(0.16, 3.2, 0, 0.01, s * a, lineMat);
  }
}

// ─────────────────────────────── buildings ───────────────────────────────
interface Bld { arch: BuildingArchetype; x: number; z: number; w: number; d: number; floors: number; tint: number }
const blds: Bld[] = [];
interface Pile { x: number; z: number; w: number; d: number; h: number }
const piles: Pile[] = [];
// block-local parcels (interior ±26): x0, z0, x1, z1, tier bias
const PARCELS: [number, number, number, number, number][] = [
  [6, 9, 26, 26, 0], [-12, 10, 4, 26, 0], [-26, 10, -14, 26, 1],
  [8, -10, 26, 7, 1], [8, -26, 26, -12, 1], [-26, -26, 5, 7, 2],
];
const byTier: Record<number, BuildingArchetype[]> = {};
for (const a of B.archetypes) (byTier[a.tier] ??= []).push(a);
const pickCount: Record<number, number> = {};
function pickArch(tier: number): BuildingArchetype {
  let t = tier;
  while (!byTier[t] && t > 1) t--;
  const list = byTier[t] ?? B.archetypes;
  const i = (pickCount[t] = (pickCount[t] ?? -1) + 1);
  return list[i % list.length];
}
const blockTier = (bx: number, bz: number) => (bx > 0 && bz > 0 ? 1 : bx < 0 && bz < 0 ? 3 : 2);
const plazas: [number, number, number, number][] = [];
for (const [bx, bz] of blockCentres) {
  PARCELS.forEach(([x0, z0, x1, z1, bias], pi) => {
    const px = bx + (x0 + x1) / 2, pz = bz + (z0 + z1) / 2, pw = x1 - x0, pd = z1 - z0;
    if (bx > 0 && bz < 0 && pi === 1) { plazas.push([px, pz, pw, pd]); return; }
    const tier = Math.max(1, Math.min(4, blockTier(bx, bz) - 1 + bias));
    const a = pickArch(tier);
    let w = Math.max(a.footprint[0], Math.min(a.footprint[1], pw - 3));
    let d = Math.max(a.footprint[0], Math.min(a.footprint[1], pd - 3));
    if (a.shape === 'cylinder' || a.shape === 'dish' || a.shape === 'chimney') w = d = Math.min(w, d);
    if (bx < 0 && bz > 0 && pi === 4) {
      piles.push({ x: px, z: pz, w, d, h: Math.min(0.5 * Math.min(w, d), Math.max(2, a.floorH * a.floors[1] * 0.3)) });
      return;
    }
    const floors = Math.round(a.floors[0] + (a.floors[1] - a.floors[0]) * (0.35 + 0.5 * rnd()));
    blds.push({ arch: a, x: px, z: pz, w, d, floors, tint: 0.9 + rnd() * 0.16 });
    plane(pw, pd, px, SLAB + 0.02, pz, kit.ground.lot);
  });
}
for (const [px, pz, pw, pd] of plazas) plane(pw, pd, px, SLAB + 0.02, pz, kit.ground.plaza);

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _col = new THREE.Color();
const _e = new THREE.Euler();
let instances = 0;
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, items: { x: number; y: number; z: number; sx: number; sy: number; sz: number; h: number; t: number }[], outlinePx: number): void {
  if (!items.length) return;
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    _q.setFromEuler(_e.set(0, it.h, 0));
    _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, it.sy, it.sz));
    im.setMatrixAt(i, _m);
    im.setColorAt(i, _col.setRGB(it.t, it.t * (0.985 + 0.03 * rnd()), it.t * (0.97 + 0.04 * rnd())));
  });
  im.instanceMatrix.needsUpdate = true;
  if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.computeBoundingSphere();
  im.castShadow = true;
  im.receiveShadow = true;
  scene.add(im);
  addOutline(im, outlinePx);
  instances += items.length;
}
for (const a of B.archetypes) {
  const mine = blds.filter((b) => b.arch === a);
  if (!mine.length) continue;
  const base: Parameters<typeof inst>[2] = [], floor: typeof base = [], roof: typeof base = [];
  for (const b of mine) {
    const fh = a.floorH;
    const it = (i: number) => ({ x: b.x, y: SLAB + i * fh, z: b.z, sx: b.w, sy: fh, sz: b.d, h: 0, t: b.tint });
    base.push(it(0));
    for (let i = 1; i < b.floors - 1; i++) floor.push(it(i));
    if (b.floors >= 2) roof.push(it(b.floors - 1));
  }
  const m = kit.arch[a.id];
  inst(m.base, m.material, base, 1.6);
  inst(m.floor, m.material, floor, 1.6);
  inst(m.roof, m.material, roof, 1.6);
}
inst(kit.rubble, kit.facade, piles.map((p) => ({ x: p.x, y: SLAB, z: p.z, sx: p.w, sy: p.h, sz: p.d, h: 0, t: 0.95 + 0.1 * rnd() })), 1.6);

// ─────────────────────────────── props ───────────────────────────────
const props = new Map<PropKind, { x: number; y: number; z: number; h: number }[]>();
const put = (k: PropKind, x: number, z: number, h: number, y = SLAB) => {
  let l = props.get(k); if (!l) props.set(k, (l = []));
  l.push({ x, y, z, h });
};
const snow = B.weather === 'snow', night = B.time === 'night';
// parked cars along the curbs of the two central roads (+ a moving lane car or two)
const carKinds: PropKind[] = night ? ['car', 'van', 'car', 'truck'] : snow ? ['car', 'van', 'truck', 'car'] : ['car', 'taxi', 'car', 'van', 'car', 'bus'];
for (const s of [-1, 1]) {
  let a = 14;
  let k = 0;
  while (a < 66) {
    const kind = carKinds[k++ % carKinds.length];
    const len = kind === 'bus' ? 11 : kind === 'truck' ? 8 : kind === 'van' ? 5 : 4.4;
    put(kind, s * (a + len / 2), 5.6, s > 0 ? Math.PI / 2 : -Math.PI / 2, 0);        // X road, +z curb
    put(carKinds[(k + 1) % carKinds.length], 5.6, s * (a + len / 2), s > 0 ? 0 : Math.PI, 0);  // Z road, +x curb
    a += len + 1.8 + rnd() * 3;
  }
}
{
  // outer curbs of the near block (the rank-I camera looks at this corner)
  let k = 0;
  for (let a = 14; a < 60; a += 7 + rnd() * 3) {
    put(carKinds[k++ % carKinds.length === 5 ? 0 : k % carKinds.length], a, 66.4, Math.PI / 2, 0);
    put(carKinds[(k + 2) % carKinds.length === 5 ? 1 : (k + 2) % carKinds.length], 66.4, a, 0, 0);
  }
}
if (night) for (let i = 0; i < 4; i++) put('boat', -20 - i * 12, -3.2, Math.PI / 2 + (rnd() - 0.5) * 0.3, 0);
else { put('car', 30, -1.9, -Math.PI / 2, 0); put('taxi', -1.9, 26, Math.PI, 0); }
// street furniture along each block's sidewalk ring (inner edges facing the central roads)
const furn: PropKind[] = night ? ['lamp', 'bollard', 'drum', 'hydrant', 'barrier', 'vending', 'bollard', 'signpost']
  : snow ? ['lamp', 'snowbank', 'hydrant', 'bollard', 'pylon', 'drum', 'snowbank', 'signpost']
    : ['lamp', 'tree', 'hydrant', 'tree', 'bench', 'tree', 'vending', 'signpost', 'tree', 'bollard'];
for (const [bx, bz] of blockCentres) {
  for (const [edge, sx, sz] of [['x', 1, 1], ['x', -1, -1], ['z', 1, 1], ['z', -1, -1]] as const) {
    for (let i = 0; i < 9; i++) {
      const along = -24 + i * 6;
      const kind = furn[(i + (edge === 'x' ? 3 : 0)) % furn.length];
      const off = kind === 'lamp' || kind === 'bollard' || kind === 'hydrant' || kind === 'signpost' ? 28.2 : 27.4;
      if (edge === 'x') put(kind, bx + sx * off, bz + along, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
      else put(kind, bx + along, bz + sz * off, sz > 0 ? 0 : Math.PI);
    }
  }
}
// plaza dressing
for (const [px, pz, pw, pd] of plazas) {
  for (let i = 0; i < 6; i++) put(night ? 'container' : snow ? 'pylon' : 'tree', px - pw * 0.32 + (i % 3) * pw * 0.32, pz - pd * 0.25 + Math.floor(i / 3) * pd * 0.5, rnd() * 6.28);
  put('bench', px, pz, 0); put('kiosk', px + pw * 0.3, pz + pd * 0.05, Math.PI / 2); put('vending', px - 2, pz + 2, 0);
  if (night) { put('forklift', px + 3, pz - 3, 0.7); put('drum', px - 3, pz - 4, 0); put('drum', px - 3.8, pz - 3.4, 0); }
}
// lineup of every prop kind on a lot (z ≈ 90), vehicles front row facing +X, furniture behind
{
  const slab = new THREE.Mesh(new THREE.BoxGeometry(84, SLAB, 26).toNonIndexed(), kit.ground.sidewalk);
  slab.position.set(28, SLAB / 2, 94); slab.receiveShadow = true; scene.add(slab);
  plane(82, 24, 28, SLAB + 0.02, 94, kit.ground.lot);
  const veh: [PropKind, number][] = [['car', 4.2], ['taxi', 4.4], ['van', 5], ['bus', 11], ['truck', 8], ['forklift', 2.6], ['container', 6.1], ['boat', 6]];
  let x = -10;
  for (const [k, len] of veh) { put(k, x + len / 2, 88, Math.PI / 2); x += len + 2.2; }
  const small: [PropKind, number][] = [['kiosk', 2.4], ['hydrant', 1], ['lamp', 1.4], ['tree', 3.2], ['bench', 2.2], ['vending', 1.4], ['signpost', 1.4],
    ['barrier', 2.4], ['drum', 1], ['bollard', 0.8], ['pylon', 3.4], ['snowbank', 3.2]];
  x = -8;
  for (const [k, wd] of small) { put(k, x + wd / 2, 98, 0); x += wd + 1.4; }
}
for (const [k, list] of props) {
  const pm = kit.props[k];
  const vehicle = k === 'car' || k === 'taxi' || k === 'van' || k === 'bus' || k === 'truck' || k === 'boat' || k === 'forklift';
  inst(pm.geo, pm.material, list.map((p) => ({ x: p.x, y: p.y, z: p.z, sx: 1, sy: 1, sz: 1, h: p.h, t: 1 })), vehicle ? 2.0 : 1.6);
}

// ─────────────────────────────── camera ───────────────────────────────
const CAMS: Record<string, { t: [number, number, number]; D: number; pitch: number }> = {
  near: { t: [34, 4, 34], D: 95, pitch: 38 },
  wide: { t: [0, 6, 0], D: 230, pitch: 40 },
  props: { t: [26, 1, 93], D: 58, pitch: 36 },
  tall: { t: [-36, 22, -36], D: 175, pitch: 42 },
  street: { t: [52, 1.5, 50], D: 36, pitch: 36 },
  rank1: { t: [60, 0.6, 58], D: 19, pitch: 36 },
  rank1b: { t: [-8, 0.6, -6], D: 19, pitch: 36 },
  rank2: { t: [40, 2.5, 40], D: 62, pitch: 38 },
  corner: { t: [-30, 8, 30], D: 110, pitch: 38 },
  mega: { t: [-46, 42, -45], D: 250, pitch: 32 },
  vehicles: { t: [6, 1, 89], D: 24, pitch: 34 },
  crown: { t: [-46, 95, -45], D: 150, pitch: 40 },
  podium: { t: [-44, 6, -42], D: 70, pitch: 40 },
  furniture: { t: [4, 0.8, 97], D: 18, pitch: 34 },
  heavy: { t: [34, 1.5, 89], D: 26, pitch: 34 },
  rubble: { t: [-19, 2, 17], D: 42, pitch: 38 },
};
const C = CAMS[camName] ?? CAMS.near;
const yaw = Math.PI / 4, pitch = (C.pitch * Math.PI) / 180;
const T = new THREE.Vector3(...C.t);
camera.position.set(T.x + C.D * Math.cos(pitch) * Math.sin(yaw), T.y + C.D * Math.sin(pitch), T.z + C.D * Math.cos(pitch) * Math.cos(yaw));
camera.lookAt(T);
camera.near = Math.max(0.1, C.D * 0.02); camera.far = C.D * 6 + 400;
camera.updateProjectionMatrix();
(scene.fog as THREE.Fog).near = C.D * LOOK.fogNear;
(scene.fog as THREE.Fog).far = C.D * LOOK.fogFar;
{
  const k = 2 * Math.tan((15 * Math.PI) / 180);
  const half = Math.min(400, Math.max(12, 0.9 * C.D * k * (innerWidth / innerHeight)));
  const back = Math.max(1.5 * C.D, 190 / Math.max(0.2, sunDir.y), half * 1.2);
  sun.position.copy(T).setY(0).addScaledVector(sunDir, back);
  sun.target.position.copy(T).setY(0);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half; sc.near = 0.5; sc.far = back + Math.max(1.5 * C.D, half * 1.5);
  sc.updateProjectionMatrix();
}

// ─────────────────────────────── loop ───────────────────────────────
const lbl = document.getElementById('lbl')!;
let frames = 0;
function frame(): void {
  renderer.info.reset();
  renderer.render(scene, camera);
  frames++;
  if (frames === 3 || frames % 60 === 0) {
    const i = renderer.info;
    const s = `${B.id} · cam=${camName} · kit ${buildMs.toFixed(0)} ms · ${blds.length} bldgs / ${instances} inst · draws ${i.render.calls} · tris ${i.render.triangles} · programs ${i.programs?.length ?? 0}`;
    lbl.textContent = s;
    (window as unknown as Record<string, unknown>).__KIT_STATS__ = { biome: B.id, cam: camName, buildMs, draws: i.render.calls, tris: i.render.triangles, programs: i.programs?.length ?? 0, instances, buildings: blds.length };
  }
  if (frames === 8) (window as unknown as Record<string, unknown>).__SNAP_READY__ = true;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
(window as unknown as Record<string, unknown>).__disposeKit = () => { kit.dispose(); for (const m of mats) m.dispose(); };
