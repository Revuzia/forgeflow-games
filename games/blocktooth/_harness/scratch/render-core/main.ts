// render-core lane SCRATCH PREVIEW (not shipped). Builds a REAL city with createWorld, then a
// stand-in faceted diorama of it using ONLY render-core materials (the real CityView / titan
// models belong to other lanes), and drives CameraRig + Lighting + EnvView + warmup exactly as
// the app will. URL: ?biome=grideast|whitestacks|lockwater&rank=0..4&seed=N&frames=N
import * as THREE from 'three';
import { createRenderCore, defaultQuality } from '../../../src/render/renderer.ts';
import { CameraRig } from '../../../src/render/camera.ts';
import { Lighting } from '../../../src/render/lighting.ts';
import { EnvView, FLOOD_Y } from '../../../src/render/env.ts';
import { warmup } from '../../../src/render/warmup.ts';
import { addOutline, bakeOutlineNormals, facet, makeToon, OUTLINE_PX } from '../../../src/render/materials.ts';
import { createWorld } from '../../../src/core/world.ts';
import { RANKS, cameraDistance } from '../../../src/core/config.ts';
import type { BiomeId, RankIndex, BiomePalette, World } from '../../../src/core/types.ts';
import type { FrameInfo } from '../../../src/render/viewtypes.ts';

// §6.2 palettes are read from the live world (data/biomes.ts carries exactly the §6.2 values).
const qs = new URLSearchParams(location.search);
const biome = (qs.get('biome') ?? 'grideast') as BiomeId;
const rank = Math.max(0, Math.min(4, Number(qs.get('rank') ?? 0))) as RankIndex;
const seed = Number(qs.get('seed') ?? 7);
const frames = Number(qs.get('frames') ?? 40);
const lbl = document.getElementById('lbl')!;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const quality = defaultQuality();
if (qs.get('shadows') === '0') quality.shadows = false;
const core = createRenderCore(canvas, quality);
(window as unknown as { __Q__: unknown }).__Q__ = quality;   // live quality poke for --eval tests
const { scene, camera, renderer } = core;

const w: World = createWorld({ titan: 'molo', biome, seed });
w.titan.rank = rank;
w.titan.height = RANKS[rank].height;
w.titan.radius = w.titan.height * 0.42;
{
  // ?at=fx,fz — place the titan at a fraction of the playable bounds (0..1), e.g. at=0.05,0.05 = far corner
  const at = qs.get('at');
  if (at) {
    const [fx, fz] = at.split(',').map(Number);
    const bb = w.city.bounds;
    w.titan.x = w.titan.px = bb.minX + (bb.maxX - bb.minX) * fx;
    w.titan.z = w.titan.pz = bb.minZ + (bb.maxZ - bb.minZ) * fz;
  }
}
// §6.2 palettes HARDCODED here (the lane brief): the stand-in diorama paints with exactly these,
// and the page reports every key where data/biomes.ts (city-sim, which env/lighting read) drifts.
const SPEC62: Record<BiomeId, Partial<BiomePalette>> = {
  grideast: {
    sky: '#9fd8f0', skyHorizon: '#fbe9d2', road: '#2f7f86', roadLine: '#f4ecd8', sidewalk: '#d9d2c3', curb: '#b9b2a3',
    crosswalk: '#f6f0e0', bodyA: '#f1e4c8', bodyB: '#e8d5b0', bodyC: '#cfe3df', trimA: '#a8876a', trimB: '#6f8f8c',
    roofA: '#c9b79a', roofB: '#8fa7a3', glass: '#5f9fb3', sign: '#ff6f5e', signB: '#ffd166', foliage: '#f7a8c4',
    foliageB: '#e98bb0', sun: '#fff1dc', ambient: '#9ec9d9', rim: '#ffd6e6', telegraph: '#ff4fa0',
  },
  whitestacks: {
    sky: '#c9d3dc', skyHorizon: '#eef2f5', ground: '#eef2f6', road: '#5d6670', roadLine: '#e8d36a', bodyA: '#8e4a3a',
    bodyB: '#a65a44', bodyC: '#9aa4ad', roofA: '#f4f6f8', roofB: '#dfe6ec', trimA: '#3f454c', glass: '#7d93a6',
    sign: '#ffb347', signB: '#e84a3c', foliage: '#5c7a6b', water: '#6f8797', sun: '#e9f1ff', ambient: '#b8c6d4',
  },
  lockwater: {
    sky: '#0b1022', skyHorizon: '#1c2140', water: '#0d1a26', road: '#0d1a26', waterGlow: '#1f4a66', roadLine: '#3ff0ff',
    sidewalk: '#2a2f3a', bodyA: '#9c4a2c', bodyB: '#3b6e8f', bodyC: '#c7a13a', trimA: '#1e242e', roofA: '#39404d',
    glass: '#1b2a3a', glassLit: '#ffcf7a', sign: '#ff3fa4', signB: '#3ff0ff', sun: '#8fa8ff', ambient: '#2a3558', rim: '#ff3fa4',
  },
};
const bdef = (await import('../../../src/data/biomes.ts')).BIOMES[biome];
const pal: BiomePalette = { ...bdef.palette, ...SPEC62[biome] };
const paletteDrift: string[] = [];
for (const [k, v] of Object.entries(SPEC62[biome])) {
  const live = (bdef.palette as unknown as Record<string, string>)[k];
  if ((live ?? '').toLowerCase() !== (v as string).toLowerCase()) paletteDrift.push(`${k}: biomes.ts ${live} vs §6.2 ${v}`);
}

// ─────────────────────────────── stand-in diorama ───────────────────────────────
const city = w.city;
const P = city.pitch, RH = city.roadW / 2;
const W = city.blocksX * P, D = city.blocksZ * P;
const col = new THREE.Color();

function pushBox(pos: number[], cols: number[], x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  cTop: THREE.Color, cSide: THREE.Color): void {
  const q = (a: number[], b: number[], c: number[], d: number[], cc: THREE.Color) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) cols.push(cc.r, cc.g, cc.b);
  };
  q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], cTop);
  q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], cSide);
  q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], cSide);
  q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], cSide);
  q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], cSide);
}
function meshFrom(pos: number[], cols: number[], outlinePx: number | null, castShadow = true): THREE.Mesh {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g = facet(g);
  bakeOutlineNormals(g);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, makeToon({ vertexColors: true }));
  m.castShadow = castShadow; m.receiveShadow = true;
  if (outlinePx) addOutline(m, outlinePx);
  scene.add(m);
  return m;
}

// road plane + raised sidewalks/lots per block
{
  const pos: number[] = [], cols: number[] = [];
  const road = new THREE.Color(pal.road);
  pushBox(pos, cols, city.originX - RH, -0.2, city.originZ - RH, city.originX + W + RH, 0, city.originZ + D + RH, road, road);
  meshFrom(pos, cols, null, false);
}
{
  const pos: number[] = [], cols: number[] = [];
  const side = new THREE.Color(pal.sidewalk), curb = new THREE.Color(pal.curb), lot = new THREE.Color(pal.ground);
  const hS = city.flooded ? 0.28 : 0.16;
  for (let bz = 0; bz < city.blocksZ; bz++) for (let bx = 0; bx < city.blocksX; bx++) {
    const cx = city.originX + (bx + 0.5) * P, cz = city.originZ + (bz + 0.5) * P;
    pushBox(pos, cols, cx - 29, 0, cz - 29, cx + 29, hS, cz + 29, side, curb);
    col.copy(lot).lerp(side, 0.35);
    pushBox(pos, cols, cx - 26, hS, cz - 26, cx + 26, hS + 0.02, cz + 26, col, curb);
  }
  meshFrom(pos, cols, null, false);
}
// zebra stripes on every crosswalk
{
  const pos: number[] = [], cols: number[] = [];
  const cw = new THREE.Color(pal.crosswalk);
  for (const c of city.crosswalks) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = -c.len / 2 + (i + 0.5) * (c.len / n);
      const hw = c.width / 2, sw = c.len / n * 0.28;
      if (c.axis === 'z') pushBox(pos, cols, c.x - hw, 0, c.z + t - sw, c.x + hw, 0.02, c.z + t + sw, cw, cw);
      else pushBox(pos, cols, c.x + t - sw, 0, c.z - hw, c.x + t + sw, 0.02, c.z + hw, cw, cw);
    }
  }
  const m = meshFrom(pos, cols, null, false);
  (m.material as THREE.Material).polygonOffset = true;
  (m.material as THREE.Material).polygonOffsetFactor = -1;
}
// buildings: faceted stacked boxes, painted body/roof + window bands on the camera faces
{
  const pos: number[] = [], cols: number[] = [];
  const archById = new Map(bdef.archetypes.map((a) => [a.id, a]));
  const glass = new THREE.Color(pal.glass), lit = new THREE.Color(pal.glassLit);
  const cT = new THREE.Color(), cS = new THREE.Color();
  for (const b of city.buildings) {
    const a = archById.get(b.arch);
    const body = new THREE.Color(pal[(a?.body ?? 'bodyA')]);
    const roof = new THREE.Color(pal[(a?.roof ?? 'roofA')]);
    const trim = new THREE.Color(pal[(a?.trim ?? 'trimA')]);
    body.multiplyScalar(0.94 + b.variant * 0.12);
    const h = b.floors * b.floorH;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    cT.copy(roof); cS.copy(body);
    pushBox(pos, cols, x0, 0, z0, x1, h, z1, cT, cS);
    // parapet trim
    pushBox(pos, cols, x0 - 0.15, h, z0 - 0.15, x1 + 0.15, h + 0.45, z1 + 0.15, roof, trim);
    // window bands on +X and +Z faces
    for (let f = 0; f < b.floors; f++) {
      const y0 = f * b.floorH + b.floorH * 0.35, y1 = f * b.floorH + b.floorH * 0.75;
      const wc = bdef.time === 'night' && ((f * 7 + b.id) % 3 === 0) ? lit : glass;
      const e = 0.06;
      pushBox(pos, cols, x1, y0, z0 + 0.8, x1 + e, y1, z1 - 0.8, wc, wc);
      pushBox(pos, cols, x0 + 0.8, y0, z1, x1 - 0.8, y1, z1 + e, wc, wc);
    }
  }
  meshFrom(pos, cols, OUTLINE_PX.building);
}
// props: vehicles as ONE InstancedMesh (+ instanced ink hull), trees merged
{
  const carGeoPos: number[] = [], carCols: number[] = [];
  const white = new THREE.Color('#ffffff'), glassC = new THREE.Color('#2b3a4a');
  pushBox(carGeoPos, carCols, -0.9, 0.25, -2.1, 0.9, 1.0, 2.1, white, white);
  pushBox(carGeoPos, carCols, -0.78, 1.0, -1.1, 0.78, 1.55, 0.9, glassC, glassC);
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(carGeoPos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(carCols, 3));
  g = facet(g); bakeOutlineNormals(g);
  const cars = city.props.filter((p) => p.kind === 'car' || p.kind === 'taxi' || p.kind === 'van' || p.kind === 'boat');
  const im = new THREE.InstancedMesh(g, makeToon({ vertexColors: true }), Math.max(1, cars.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
  const carCol = [pal.sign, pal.signB, pal.bodyC, '#e8e4dc', pal.trimB];
  cars.forEach((c, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.heading);
    p3.set(c.x, c.kind === 'boat' ? FLOOD_Y : 0, c.z);
    m4.compose(p3, q, s);
    im.setMatrixAt(i, m4);
    im.setColorAt(i, col.set(c.kind === 'taxi' ? pal.signB : carCol[i % carCol.length]));
  });
  im.count = cars.length;
  im.castShadow = true; im.receiveShadow = true;
  im.computeBoundingSphere();
  addOutline(im, OUTLINE_PX.vehicle);
  scene.add(im);

  const tp: number[] = [], tc: number[] = [];
  const trunk = new THREE.Color(pal.trimA), fol = new THREE.Color(pal.foliage), folB = new THREE.Color(pal.foliageB);
  const ico = new THREE.IcosahedronGeometry(1.5, 0);
  const ip = ico.getAttribute('position') as THREE.BufferAttribute;
  for (const t of city.props) {
    if (t.kind !== 'tree') continue;
    pushBox(tp, tc, t.x - 0.18, 0, t.z - 0.18, t.x + 0.18, 2.2, t.z + 0.18, trunk, trunk);
    const fc = (t.id & 1) ? fol : folB;
    for (let i = 0; i < ip.count; i++) {
      tp.push(t.x + ip.getX(i), 3.3 + ip.getY(i) * 1.1, t.z + ip.getZ(i));
      tc.push(fc.r, fc.g, fc.b);
    }
  }
  meshFrom(tp, tc, OUTLINE_PX.prop);
}
// titan STAND-IN (scratch only: tests the 3 px hull + toon ramp on a rounded faceted body)
{
  const H = w.titan.height;
  const grp = new THREE.Group();
  const jade = new THREE.Color('#3fae7f'), belly = new THREE.Color('#cfe8b8'), dark = new THREE.Color('#1f6f55');
  const parts: [THREE.BufferGeometry, THREE.Color, number, number, number, number, number, number][] = [
    [new THREE.IcosahedronGeometry(0.5, 1), jade, 0, 0.42, 0, 1.25, 0.62, 1.7],
    [new THREE.IcosahedronGeometry(0.3, 1), jade, 0, 0.62, 0.95, 1.1, 0.8, 1.2],
    [new THREE.IcosahedronGeometry(0.2, 0), belly, 0, 0.5, 1.15, 1.1, 0.6, 1.1],
    [new THREE.ConeGeometry(0.18, 0.4, 4), dark, 0, 0.95, 0.2, 1, 1, 1],
    [new THREE.ConeGeometry(0.15, 0.34, 4), dark, 0, 0.9, -0.25, 1, 1, 1],
    [new THREE.IcosahedronGeometry(0.16, 0), dark, 0.42, 0.14, 0.5, 1, 1.4, 1],
    [new THREE.IcosahedronGeometry(0.16, 0), dark, -0.42, 0.14, 0.5, 1, 1.4, 1],
    [new THREE.IcosahedronGeometry(0.16, 0), dark, 0.42, 0.14, -0.45, 1, 1.4, 1],
    [new THREE.IcosahedronGeometry(0.16, 0), dark, -0.42, 0.14, -0.45, 1, 1.4, 1],
  ];
  for (const [geo, c, x, y, z, sx, sy, sz] of parts) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.scale(sx, sy, sz); g.translate(x, y, z);
    g = facet(g); bakeOutlineNormals(g);
    const m = new THREE.Mesh(g, makeToon({ color: c }));
    m.castShadow = true; m.receiveShadow = true;
    addOutline(m, OUTLINE_PX.titan);
    grp.add(m);
  }
  grp.scale.setScalar(H);
  grp.position.set(w.titan.x, 0, w.titan.z);
  grp.rotation.y = w.titan.heading;
  scene.add(grp);
}

// RAMP TEST diorama beside the titan: faceted icosahedra (detail 1), a stepped box stack and a
// hex prism — judges the 3-band ramp + ink hull on round and flat forms at every rank.
{
  const H = w.titan.height;
  const tx = w.titan.x, tz = w.titan.z;
  const rX = 0.7071, rZ = -0.7071;               // screen-right in world (camera yaw 45°)
  const cols = [pal.sign, pal.signB, pal.foliage, pal.bodyC, pal.glass];
  const place = (g0: THREE.BufferGeometry, c: string, side: number, along: number, y: number, s: number, px: number) => {
    let g = g0.index ? g0.toNonIndexed() : g0;
    g.scale(s, s, s);
    g = facet(g); bakeOutlineNormals(g);
    const m = new THREE.Mesh(g, makeToon({ color: c }));
    m.castShadow = true; m.receiveShadow = true;
    addOutline(m, px);
    // `along` runs away from the camera (−X−Z), `side` across the screen
    m.position.set(tx + rX * side * H - 0.7071 * along * H, y * H, tz + rZ * side * H - 0.7071 * along * H);
    scene.add(m);
  };
  for (let i = 0; i < 3; i++) place(new THREE.IcosahedronGeometry(0.5, 1), cols[i], 1.7 + i * 0.95, -0.4 + i * 0.35, 0.5 * (0.7 + i * 0.15), 0.7 + i * 0.15, OUTLINE_PX.enemy);
  place(new THREE.BoxGeometry(0.9, 0.5, 0.9), cols[3], -1.9, 0.2, 0.25, 1, OUTLINE_PX.building);
  place(new THREE.BoxGeometry(0.6, 0.4, 0.6), cols[4], -1.9, 0.2, 0.7, 1, OUTLINE_PX.building);
  place(new THREE.CylinderGeometry(0.35, 0.42, 0.9, 6), cols[0], -2.9, 0.9, 0.45, 1, OUTLINE_PX.prop);
}

// ─────────────────────────────── render-core wiring ───────────────────────────────
const lighting = new Lighting(scene);
lighting.applyBiome(bdef);
const env = new EnvView({ renderer, scene, camera, quality });
env.mount(w);
const rig = new CameraRig(camera, quality);
rig.reset(w);

const f: FrameInfo = { alpha: 1, dt: 1 / 60, time: 0, events: [], camDist: rig.distance, frozen: true };
rig.update(w, f); lighting.update(w, rig); f.camDist = rig.distance; env.update(w, f);
const t0 = performance.now();
await warmup(renderer, scene, camera);
const warmMs = performance.now() - t0;
const programsAfterWarm = renderer.info.programs ? renderer.info.programs.length : -1;

let n = 0;
function frame(): void {
  f.time = 8 + n / 60;
  rig.update(w, f);
  lighting.update(w, rig);
  f.camDist = rig.distance;
  env.update(w, f);
  core.render();
  n++;
  const st = core.stats();
  lbl.textContent = `${biome} rank ${RANKS[rank].name}  D=${rig.distance.toFixed(1)} (D*=${cameraDistance(w.titan.height, rank).toFixed(1)})  draws=${st.draws} tris=${st.tris} programs=${st.programs} warmup=${warmMs.toFixed(0)}ms`;
  if (n === frames) {
    (window as unknown as { __SNAP_READY__: boolean }).__SNAP_READY__ = true;
    (window as unknown as { __STATS__: unknown }).__STATS__ = { ...st, paletteDrift, warmMs, programsAfterWarm, D: rig.distance, sunPos: lighting.sun.position.toArray().map((v) => +v.toFixed(1)), sunTgt: lighting.sun.target.position.toArray().map((v) => +v.toFixed(1)), sunI: lighting.sun.intensity, sunCol: lighting.sun.color.getHexString(), cam: [lighting.sun.shadow.camera.left, lighting.sun.shadow.camera.far, lighting.sun.shadow.bias, lighting.sun.shadow.normalBias], titan: [w.titan.x, w.titan.z] };
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
