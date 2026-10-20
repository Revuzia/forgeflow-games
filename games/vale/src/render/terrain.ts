// VALE render — procedural terrain from the map JSON (CONTRACT §0: terrain, scatter and trim are
// procedural-allowed). Used while `map.art.scene` is missing or empty (the art lane's Blender scene
// replaces it as soon as it loads). Everything is derived from MapDef, deterministically.
//
//   ground    one plane shaded per pixel from baked DISTANCE FIELDS (splat: lane, camp room, wall, brush;
//             splat2: Standing Shadow, Fallen Shaft, chasm; inlay: engraved / inlaid strokes) and three
//             painted tiling textures with height in alpha (terrain_litter / grain / moss, each
//             mapped so its MEAN lands on the designed band colour: the bible's value law holds).
//             `art.terrain.surface` picks the floor:
//               dial   RIFT: honed irregular dial-stone flags on the roads (L* 62–68) with a carved
//                      inscription band and hour-ticks, broken mossy verges (50–56) whose flags are lost
//                      to the wood flag by flag, a Dialwood floor of moss and fan-leaf litter with broad
//                      hue/value drifts (30–40) and the hour-line groove along every path, dusty pale
//                      camp rooms (45–50), moss banks and occlusion at every wall foot, the Seat, the
//                      Fallen Shaft's pale floor under its water.
//               span   BRIDGE: the fallen shaft's deck in long courses (60–66), a chalk band of carved
//                      hour-script on every edge of the drop (70), the Snap's crazing and lit fracture.
//               plate  FRAY: polished basalt slabs in rings (28–36), chalk hour-lines and numerals, the
//                      shop ring.
//             Base plazas (art.terrain.plazas): Aubade chalk flags with dawnglass rings round the
//             fountain, Serenade ochre sandstone with lampresin. Roughness ≥ 0.5 everywhere walkable.
//   walls     every wall polygon swept course by course (terrain_walls.ts): dark cut stone in battered
//             horizontal courses with chunky chiselled blocks (18–25), a protruding cap course whose
//             chamfer carries the painted edge light, a carved lip, then moss and canopy on top (55–62).
//             Heights from art.terrain.wallHeights (small / hourStones, large / rim, frame).
//             `wallStyle: "gorge"` (Needlespan): large walls are the gorge. The ground opens; the deck's
//             edges roll over into the shaft's curved needle-stone flank, then raw rock in strata falls
//             into the depth mist (height-based, darkening toward the abyss); the far walls fall in columnar
//             rock; rock spires stand in the gorge (parallax); the hour-band notches stand proud as carved rings.
//   brush     Needlegrass: instanced clumps of SOLID tapered blades (no alpha cards) on a carved curb.
//   clutter   (quality 0 none · 1 half · 2 full) moss cushions, fallen fan leaves, pebbles, wall-foot
//             tufts: solid, instanced, chunked, no shadows; Dialwood floor only (never on roads, rooms,
//             plazas, the Seat or the Noonline; the deck and the Noonplate stay clean stages).
//   scatter   (quality 0 sparse · 1 half · 2 full) Dialwood canopies on the cliff tops, boulders at the
//             cliff feet and stones on the jungle floor; never in lanes, clearings or brush (none on the
//             Noonplate: its corners are the noon glare).
//   marks     the Standing Shadow floor (violet-cool stone, hard engraved edge, keeps its colour under
//             fog) and the Fallen Shaft's shallow water.
// Instanced scatter is chunked (24 m cells) so off-screen chunks are culled from the main and shadow
// passes. Every material is patched with the world chunk (fog of war + edge haze).

import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Group, IcosahedronGeometry,
  InstancedMesh, LinearFilter, type Material, Matrix4, Mesh, MeshStandardMaterial, type Object3D, PlaneGeometry, Quaternion,
  RGBAFormat, Shape, ShapeGeometry, ShapeUtils, UnsignedByteType, type Texture, Vector2, Vector3, Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDefT } from '../contracts/catalog.ts';
import { NOISE_GLSL } from './glsl.ts';
import { FRAY_SEATS } from './palette.ts';
import { patchWorldMaterial, worldUniforms } from './world_material.ts';
import {
  GROUND_MAIN_GLSL, GROUND_PARS_GLSL, SHADOW_MAIN_GLSL, SHADOW_PARS_GLSL, TERRAIN_HELPERS_GLSL, WALL_MAIN_GLSL, WALL_MIST_GLSL,
  WALL_PARS_GLSL, WALL_VERT_MAIN, WALL_VERT_PARS,
} from './terrain_glsl.ts';
import { cliffProfile, flankProfile, rockFaceProfile, type Strip, sweep, WallMesh, WK } from './terrain_walls.ts';
import { bakeInlay, fracture, hourScript, INLAY, mulberry as mulberryI, numeral, roadTicks, StrokeSet } from './terrain_inlay.ts';
import { bladeTuft, fanLeaf, mossTuft, pebble, spire } from './terrain_clutter.ts';

type V2 = readonly [number, number];
type Poly = readonly V2[];

const LANE_HALF = 3.6;
const MARGIN = 60;
const CHUNK = 24;

// ── deterministic random / noise ─────────────────────────────────────────────────────────────────
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// ── geometry helpers ───────────────────────────────────────────────────────────────────────────
export function pointInPolygon(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
function polyEdgeDist(x: number, y: number, poly: Poly): number {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(x, y, poly[j][0], poly[j][1], poly[i][0], poly[i][1]));
  return d;
}
interface Box { minX: number; minY: number; maxX: number; maxY: number }
function bbox(poly: Poly): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of poly) { b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y); b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y); }
  return b;
}
function boxDist(x: number, y: number, b: Box): number {
  const dx = Math.max(b.minX - x, 0, x - b.maxX), dy = Math.max(b.minY - y, 0, y - b.maxY);
  return Math.sqrt(dx * dx + dy * dy);
}
function signedArea(poly: Poly): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1]);
  return a / 2;
}
/** signed distance to a set of polygons (negative inside), capped at ±cap */
function polysSD(x: number, y: number, polys: Poly[], boxes: Box[], cap: number): number {
  let d = cap;
  let inside = false;
  for (let k = 0; k < polys.length; k++) {
    if (boxDist(x, y, boxes[k]) >= d && !inside) continue;
    if (pointInPolygon(x, y, polys[k])) inside = true;
    d = Math.min(d, polyEdgeDist(x, y, polys[k]));
  }
  return inside ? -Math.min(d, cap) : Math.min(d, cap);
}

/** resample the outline at ~step m with a deterministic outward/inward wobble (map-border edges stay straight) */
function organicOutline(poly: Poly, step: number, amp: number, size: V2, seed: number): V2[] {
  const out: V2[] = [];
  const ccw = signedArea(poly) > 0;
  const onBorder = (p: V2): boolean => Math.abs(p[0]) < 0.01 || Math.abs(p[1]) < 0.01 || Math.abs(p[0] - size[0]) < 0.01 || Math.abs(p[1] - size[1]) < 0.01;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const border = onBorder(a) && onBorder(b) && (Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01);
    const n = border ? 1 : Math.max(1, Math.ceil(len / step));
    const nx = (ccw ? dy : -dy) / len, ny = (ccw ? -dx : dx) / len; // outward
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = a[0] + dx * t, y = a[1] + dy * t;
      let w = 0;
      if (!border && k > 0) w = ((vnoise(x * 0.55 + seed, y * 0.55) - 0.5) * 2 * 0.7 + (vnoise(x * 1.7, y * 1.7 + seed) - 0.5) * 2 * 0.3) * amp;
      out.push([x + nx * w, y + ny * w]);
    }
  }
  return out;
}
/** resample a polyline at ~step m (no wobble) */
function resample(path: readonly V2[], step: number): V2[] {
  const out: V2[] = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** shape in the extrusion plane: sim (x, y) → shape (x, −y) so rotateX(−π/2) lands it on (x, ·, y) */
function shapeOf(poly: Poly): Shape {
  let pts = poly.map(([x, y]) => new Vector2(x, -y));
  if (ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  return new Shape(pts);
}

/** instanced scatter split into CHUNK-sized cells so each cell frustum-culls on its own */
function chunked(geo: BufferGeometry, mat: Material, items: { m: Matrix4; c?: Color }[], name: string, shadows = true): Group {
  const g = new Group();
  g.name = name;
  const buckets = new Map<string, { m: Matrix4; c?: Color }[]>();
  for (const it of items) {
    const key = `${Math.floor(it.m.elements[12] / CHUNK)}:${Math.floor(it.m.elements[14] / CHUNK)}`;
    let b = buckets.get(key);
    if (!b) { b = []; buckets.set(key, b); }
    b.push(it);
  }
  for (const list of buckets.values()) {
    const im = new InstancedMesh(geo, mat, list.length);
    list.forEach((it, i) => { im.setMatrixAt(i, it.m); if (it.c) im.setColorAt(i, it.c); });
    im.castShadow = shadows; im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

// ── palette (tokens.json colors.terrain-ref + bible valueLstar), overridable by map.art.terrain.colors ─
interface TerrainColors {
  lane: string; laneGrout: string; verge: string; jungle: string; moss: string; earth: string; clearing: string; inscription: string;
  cliffTop: string; cliffFace: string; cliffLip: string; edgeLight: string; curb: string; grassRoot: string; grassTip: string; leaf: string;
  trunk: string; stone: string; chasm: string; mist: string; flank: string; rock: string; shaftFloor: string; seat: string;
  plazaAubade: string; plazaSerenade: string; inlayAubade: string; inlaySerenade: string; midInlay: string; lit: string;
  shadowLine: string; water: string; litter: string; pebble: string;
}
const DEFAULT_COLORS: TerrainColors = {
  lane: '#9A927F', laneGrout: '#6F685A', verge: '#7C7666', jungle: '#4E5547', moss: '#475A43', earth: '#5C5446', clearing: '#8A8576',
  inscription: '#B7B0A0', cliffTop: '#5E6450', cliffFace: '#45423C', cliffLip: '#8E8979', edgeLight: '#D8D0BC', curb: '#8A8476',
  grassRoot: '#2F3B30', grassTip: '#9AA478', leaf: '#3F5A45', trunk: '#4A3F36', stone: '#77726A', chasm: '#2A2D33', mist: '#5E6C93',
  flank: '#5D5A55', rock: '#4A4C52', shaftFloor: '#A4A69E', seat: '#B4AE9E', plazaAubade: '#B3B1A8', plazaSerenade: '#AF9A78',
  inlayAubade: '#BFD3E6', inlaySerenade: '#C99A5E', midInlay: '#5F5D58', lit: '#FFE2B8', shadowLine: '#7A7396', water: '#4F6B70',
  litter: '#6A5434', pebble: '#7A766D',
};
function colorsFrom(terrain: Record<string, unknown> | undefined): TerrainColors {
  const c: TerrainColors = { ...DEFAULT_COLORS };
  const src = (terrain?.colors && typeof terrain.colors === 'object' ? terrain.colors : undefined) as Record<string, unknown> | undefined;
  if (src) for (const k of Object.keys(c) as (keyof TerrainColors)[]) {
    const v = src[k];
    if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) c[k] = v;
  }
  return c;
}

/** polygons from a terrain block entry like { floor: [[[x,y],…]] } (defensive: content is data) */
function polysOf(v: unknown): Poly[] {
  const out: Poly[] = [];
  const isPt = (p: unknown): p is [number, number] => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number';
  const walk = (x: unknown): void => {
    if (!Array.isArray(x)) return;
    if (x.length >= 3 && x.every(isPt)) { out.push(x.map((p) => [p[0], p[1]] as V2)); return; }
    for (const y of x) walk(y);
  };
  walk(v);
  return out;
}
/** polylines (≥ 2 points) from a list (defensive) */
function linesOf(v: unknown): V2[][] {
  if (!Array.isArray(v)) return [];
  const out: V2[][] = [];
  for (const l of v) {
    if (!Array.isArray(l)) continue;
    const pts = l.filter((p): p is [number, number] => Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number').map((p) => [p[0], p[1]] as V2);
    if (pts.length >= 2) out.push(pts);
  }
  return out;
}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
const pt = (v: unknown): V2 | undefined => (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : undefined);

export interface TerrainBuild {
  group: Group;
  /** heights of every wall polygon (0 for chasm walls) */
  wallHeights: number[];
  setScatter(level: 0 | 1 | 2): void;
  /** painted tiling textures by role (map.art.terrain.textures): litter, grain, moss */
  setTextures(t: Partial<Record<TerrainTexRole, Texture>>): void;
  /** authored scatter props (map.art.terrain.props: tree / rock / stone → GLB variants), vertex-coloured,
   *  real size, origin at the ground contact; they replace the procedural shapes and re-scatter */
  setProps(p: Partial<Record<TerrainPropRole, BufferGeometry[]>>): void;
  /** standing height at a map point: a cliff block's top inside a wall polygon, else 0 */
  groundAt(x: number, y: number): number;
  update(time: number): void;
  dispose(): void;
}

export type TerrainTexRole = 'litter' | 'grain' | 'moss';
export type TerrainPropRole = 'tree' | 'rock' | 'stone';
export const TERRAIN_PROP_ROLES: readonly TerrainPropRole[] = ['tree', 'rock', 'stone'];
export const TERRAIN_TEX_ROLES: readonly TerrainTexRole[] = ['litter', 'grain', 'moss'];

/** load map.art.terrain.props (role → GLB refs) into vertex-coloured geometries (each GLB merged, its
 *  node transforms applied); null when the map names none */
export async function loadTerrainProps(map: MapDefT, load: (ref: string) => Promise<{ gltf: { scene: import('three').Object3D }; renderable: boolean } | null>):
  Promise<Partial<Record<TerrainPropRole, BufferGeometry[]>> | null> {
  const refs = ((map.art.terrain ?? {}) as { props?: Record<string, unknown> }).props ?? {};
  const out: Partial<Record<TerrainPropRole, BufferGeometry[]>> = {};
  let any = false;
  for (const role of TERRAIN_PROP_ROLES) {
    const list = Array.isArray(refs[role]) ? (refs[role] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const geos = (await Promise.all(list.map(load))).map((m) => {
      if (!m?.renderable) return null;
      const parts: BufferGeometry[] = [];
      m.gltf.scene.updateMatrixWorld(true);
      m.gltf.scene.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
        parts.push(g);
      });
      return parts.length ? (parts.length === 1 ? parts[0] : mergeGeometries(parts, false)) : null;
    }).filter((g): g is BufferGeometry => !!g);
    if (geos.length) { out[role] = geos; any = true; }
  }
  return any ? out : null;
}

/** load map.art.terrain.landmarks entries that name a `model` (real-size GLB, origin at its ground
 *  contact) and stand each at its `at` (map x, y) on the ground there (a cliff block's top inside a wall),
 *  turned `rot` degrees about the vertical; flush entries
 *  carry no model. The models are shared with the asset cache, so callers drop them without disposing. */
export async function loadTerrainLandmarks(map: MapDefT, load: (ref: string) => Promise<{ gltf: { scene: Object3D }; renderable: boolean } | null>,
  ground: (x: number, y: number) => number = () => 0): Promise<Object3D[]> {
  const list = ((map.art.terrain ?? {}) as { landmarks?: unknown }).landmarks;
  if (!Array.isArray(list)) return [];
  const out: Object3D[] = [];
  await Promise.all(list.map(async (raw: unknown) => {
    const l = raw as { model?: unknown; at?: unknown; rot?: unknown };
    if (typeof l.model !== 'string' || !Array.isArray(l.at)) return;
    const m = await load(l.model);
    if (!m?.renderable) return;
    const o = m.gltf.scene.clone();
    const x = Number(l.at[0]), y = Number(l.at[1]);
    o.position.set(x, ground(x, y), y);
    o.rotation.y = typeof l.rot === 'number' ? (l.rot * Math.PI) / 180 : 0;
    o.traverse((c) => {
      const mesh = c as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchWorldMaterial(mat);
    });
    out.push(o);
  }));
  return out;
}

/** a 1×1 stand-in so the samplers exist from the first compile (textures swap in without a recompile) */
function greyTex(): DataTexture {
  const t = new DataTexture(new Uint8Array([160, 160, 160, 153]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

interface Clearing { x: number; y: number; r: number; camp?: boolean; room?: boolean }
type Surface = 'dial' | 'span' | 'plate';

export function buildTerrain(map: MapDefT): TerrainBuild {
  const group = new Group();
  group.name = 'vale_terrain';
  const [SX, SY] = map.size;
  const tr = (map.art.terrain ?? {}) as Record<string, unknown>;
  const colors = colorsFrom(tr);
  const gorge = tr.wallStyle === 'gorge';
  const surface: Surface = tr.surface === 'span' || tr.surface === 'plate' || tr.surface === 'dial' ? tr.surface
    : gorge ? 'span' : map.lanes.length === 0 ? 'plate' : 'dial';
  const rand = mulberry(0x5eed ^ Math.round(SX * 131 + SY * 17));
  const walls: Poly[] = map.walls.map((w) => w.map((p) => [p[0], p[1]] as V2));
  const thickets: Poly[] = (map.thickets ?? []).map((w) => w.map((p) => [p[0], p[1]] as V2));
  const wallBoxes = walls.map(bbox);
  const chasm = walls.map((w) => gorge && Math.abs(signedArea(w)) > 60);
  const thicketBoxes = thickets.map(bbox);
  const lanes = map.lanes.map((l) => l.path.map((p) => [p[0], p[1]] as V2));
  const disposables: { dispose(): void }[] = [];
  const lin = (hex: string): Color => new Color().setStyle(hex);
  const onBorder = (x: number, y: number): boolean => Math.abs(x) < 0.01 || Math.abs(y) < 0.01 || Math.abs(x - SX) < 0.01 || Math.abs(y - SY) < 0.01;

  // clearings: bases, shops, structures, camps, pickups, spawns (scatter keeps out); rooms = camp floors
  const clearings: Clearing[] = [];
  for (const b of map.bases) {
    clearings.push({ x: b.fountain.at[0], y: b.fountain.at[1], r: b.fountain.radius + 3.5 });
    clearings.push({ x: b.shop.at[0], y: b.shop.at[1], r: b.shop.radius + 1.5 });
    clearings.push({ x: b.spawn[0], y: b.spawn[1], r: 3 });
  }
  for (const s of map.structures ?? []) clearings.push({ x: s.at[0], y: s.at[1], r: 4.5 });
  for (const c of map.camps ?? []) {
    let cx = 0, cy = 0;
    for (const u of c.units) { cx += u.at[0]; cy += u.at[1]; }
    cx /= Math.max(1, c.units.length); cy /= Math.max(1, c.units.length);
    let r = 0;
    for (const u of c.units) r = Math.max(r, Math.hypot(u.at[0] - cx, u.at[1] - cy));
    clearings.push({ x: cx, y: cy, r: r + (c.objective ? 6 : 4.5), camp: true, room: !c.objective });
  }
  for (const p of map.pickups ?? []) clearings.push({ x: p.at[0], y: p.at[1], r: 2.2 });
  for (const s of map.spawns ?? []) clearings.push({ x: s[0], y: s[1], r: 2.6 });
  for (const s of map.shops ?? []) clearings.push({ x: s.at[0], y: s.at[1], r: s.radius + 1.5 });
  const rooms = clearings.filter((c) => c.room);

  // ── map marks from art.terrain ─────────────────────────────────────────────────────────────────
  const noon = tr.noonline as Record<string, unknown> | undefined;
  const shadowDef = noon?.standingShadow as { floor?: unknown; tint?: unknown; tip?: unknown } | undefined;
  const shaftDef = noon?.fallenShaft as { floor?: unknown } | undefined;
  const shadowPolys = polysOf(shadowDef?.floor), shaftPolys = polysOf(shaftDef?.floor);
  const shadowBoxes = shadowPolys.map(bbox), shaftBoxes = shaftPolys.map(bbox);
  const chasmPolys = walls.filter((_, i) => chasm[i]);
  const chasmBoxes = chasmPolys.map(bbox);
  const solidWalls = walls.map((w, i) => ({ w, b: wallBoxes[i] })).filter((_, i) => !chasm[i]);
  // plazas: art.terrain.plazas [{ at, radius, side }], else one per base round its fountain
  const plazas: { x: number; y: number; r: number; side: number; fx: number; fy: number; fr: number }[] = [];
  {
    const raw = Array.isArray(tr.plazas) ? (tr.plazas as { at?: unknown; radius?: unknown; side?: unknown }[]) : [];
    const list = raw.length ? raw.map((p) => ({ at: pt(p.at), r: num(p.radius), side: typeof p.side === 'number' ? p.side : 0 }))
      : map.bases.map((b) => ({ at: [(b.fountain.at[0] + b.spawn[0]) / 2 + (b.team === 0 ? 3 : -3), b.fountain.at[1]] as V2, r: 13, side: b.team }));
    for (const p of list) {
      if (!p.at || !p.r) continue;
      let best = map.bases[0];
      for (const b of map.bases) if (Math.hypot(b.fountain.at[0] - p.at[0], b.fountain.at[1] - p.at[1]) < Math.hypot(best.fountain.at[0] - p.at[0], best.fountain.at[1] - p.at[1])) best = b;
      const f = best ? best.fountain : { at: p.at, radius: 4 };
      plazas.push({ x: p.at[0], y: p.at[1], r: p.r, side: p.side, fx: f.at[0], fy: f.at[1], fr: f.radius });
    }
  }
  const inPlaza = (x: number, y: number, pad: number): boolean => plazas.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + pad);
  const seat = tr.seat as { at?: unknown; radius?: unknown } | undefined;
  const seatAt = pt(seat?.at);
  const seatV = seatAt ? new Vector3(seatAt[0], seatAt[1], num(seat?.radius) ?? 0) : new Vector3(0, 0, 0);
  const plateDef = tr.plate as { at?: unknown; radius?: unknown } | undefined;
  const plateAt = pt(plateDef?.at) ?? (map.shops[0] ? (map.shops[0].at as unknown as V2) : [SX / 2, SY / 2] as V2);
  const plateR = num(plateDef?.radius) ?? Math.min(SX, SY) / 2 - 2;
  const gdef = (tr.gorge ?? {}) as Record<string, unknown>;
  const axisY = typeof gdef.axisY === 'number' ? gdef.axisY : lanes[0] ? lanes[0].reduce((s, p) => s + p[1], 0) / lanes[0].length : SY / 2;
  const deckHalf = num(gdef.deckHalf) ?? 7;
  const gorgeDepth = num(gdef.depth) ?? 36;
  const bandH = num(gdef.bandHeight) ?? 1.0;
  const snapDef = tr.snap as { at?: unknown; radius?: unknown } | undefined;
  const snapAt = pt(snapDef?.at);
  const snapR = num(snapDef?.radius) ?? 0;

  // ── splats (distance fields) ────────────────────────────────────────────────────────────────────
  const texel = Math.max(0.5, Math.max(SX, SY) / 384);
  const W = Math.ceil(SX / texel) + 1, H = Math.ceil(SY / texel) + 1;
  const splat = new Uint8Array(W * H * 4);
  const splat2 = new Uint8Array(W * H * 4);
  /** CPU copies for placement: lane, room, wall, thicket, shadow, shaft, chasm */
  const F = { ld: new Float32Array(W * H), cd: new Float32Array(W * H), wd: new Float32Array(W * H), td: new Float32Array(W * H),
    sh: new Float32Array(W * H), sf: new Float32Array(W * H), ch: new Float32Array(W * H) };
  for (let j = 0; j < H; j++) {
    const y = j * texel;
    for (let i = 0; i < W; i++) {
      const x = i * texel;
      let ld = 16;
      for (const l of lanes) for (let k = 1; k < l.length; k++) ld = Math.min(ld, segDist(x, y, l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]));
      let cd = 16;
      for (const c of rooms) cd = Math.min(cd, Math.hypot(x - c.x, y - c.y) - c.r);
      let wd = 8;
      for (const { w, b } of solidWalls) {
        if (boxDist(x, y, b) >= wd) continue;
        if (pointInPolygon(x, y, w)) { wd = 0; break; }
        wd = Math.min(wd, polyEdgeDist(x, y, w));
      }
      let td = 4;
      for (let k = 0; k < thickets.length; k++) {
        if (boxDist(x, y, thicketBoxes[k]) >= Math.abs(td)) continue;
        const e = polyEdgeDist(x, y, thickets[k]);
        td = Math.min(td, pointInPolygon(x, y, thickets[k]) ? -e : e);
      }
      const sh = shadowPolys.length ? polysSD(x, y, shadowPolys, shadowBoxes, 4) : 4;
      const sf = shaftPolys.length ? polysSD(x, y, shaftPolys, shaftBoxes, 4) : 4;
      const ch = chasmPolys.length ? -polysSD(x, y, chasmPolys, chasmBoxes, 4) : -4;
      const k = j * W + i, o = k * 4;
      F.ld[k] = ld; F.cd[k] = cd; F.wd[k] = wd; F.td[k] = td; F.sh[k] = sh; F.sf[k] = sf; F.ch[k] = ch;
      splat[o] = Math.round(Math.min(1, ld / 16) * 255);
      splat[o + 1] = Math.round(Math.min(1, Math.max(0, (cd + 8) / 24)) * 255);
      splat[o + 2] = Math.round(Math.min(1, wd / 8) * 255);
      splat[o + 3] = Math.round(Math.min(1, Math.max(0, (td + 4) / 8)) * 255);
      splat2[o] = Math.round(((sh + 4) / 8) * 255);
      splat2[o + 1] = Math.round(((sf + 4) / 8) * 255);
      splat2[o + 2] = 0;
      splat2[o + 3] = Math.round(((ch + 4) / 8) * 255);
    }
  }
  const field = (f: Float32Array, x: number, y: number): number => {
    const i = Math.min(W - 1, Math.max(0, Math.round(x / texel))), j = Math.min(H - 1, Math.max(0, Math.round(y / texel)));
    return f[j * W + i];
  };
  const mkTex = (data: Uint8Array): DataTexture => {
    const t = new DataTexture(data, W, H, RGBAFormat, UnsignedByteType);
    t.magFilter = LinearFilter; t.minFilter = LinearFilter; t.generateMipmaps = false;
    t.needsUpdate = true;
    disposables.push(t);
    return t;
  };
  const splatTex = mkTex(splat), splat2Tex = mkTex(splat2);

  // ── inlay strokes (engraved and inlaid marks) ──────────────────────────────────────────────────
  const strokes = new StrokeSet();
  const inWall = (x: number, y: number): boolean => field(F.wd, x, y) <= 0.01;
  if (surface === 'dial') {
    // hour-ticks across the roads' inscription bands, every 9 m
    for (const l of lanes) roadTicks(strokes, l, LANE_HALF, 0.3, 9, (x, y) => !inWall(x, y) && !inPlaza(x, y, 0.5) && !(seatV.z > 0 && Math.hypot(x - seatV.x, y - seatV.y) < seatV.z + 1));
    // the hour-line groove along every Dialwood path: the hour-ring and the hour-lines (art.terrain.hourLines)
    const hl = (tr.hourLines ?? {}) as { centre?: unknown; ring?: unknown; paths?: unknown };
    const hc = pt(hl.centre) ?? [SX / 2, SY / 2] as V2;
    const ring = num(hl.ring);
    if (ring) strokes.circle(hc, ring, 0.3, INLAY.groove, 0.5);
    for (const p of linesOf(hl.paths)) strokes.poly(p, 0.3, INLAY.groove);
    // the Standing Shadow's tip, engraved on the pit floor
    const tip = pt(shadowDef?.tip);
    if (tip) { strokes.seg([tip[0] - 0.8, tip[1] + 1.2], tip, 0.16, INLAY.lit); strokes.seg([tip[0] + 0.8, tip[1] + 1.2], tip, 0.16, INLAY.lit); strokes.seg(tip, [tip[0], tip[1] + 2.6], 0.13, INLAY.lit); }
  } else if (surface === 'span') {
    // carved hour-script along every edge of the drop, inside the 0.4 m chalk band
    chasmPolys.forEach((poly, k) => {
      const ccw = signedArea(poly) > 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        if (onBorder(a[0], a[1]) && onBorder(b[0], b[1])) continue;
        hourScript(strokes, [a, b], (_p, t) => (ccw ? [t[1], -t[0]] : [-t[1], t[0]]), 0.4, 300 + k * 31 + i, (x, y) => x > 0.3 && x < SX - 0.3 && field(F.ch, x, y) < 0.05);
      }
    });
    // the Snap: the lit fracture across the plaza and fine crazing radiating from it
    if (snapAt && snapR > 0) {
      const rnd = mulberryI(4242);
      const main = fracture([snapAt[0], snapAt[1] - snapR - 2], [snapAt[0], snapAt[1] + snapR + 2], 0.9, 6, rnd);
      strokes.poly(main, 0.09, INLAY.lit);
      for (let k = 0; k < 26; k++) {
        const s = main[Math.floor(rnd() * main.length)];
        const ang = (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 1.6;
        const len = 1.4 + rnd() * 4.5;
        const end: V2 = [s[0] + Math.cos(ang) * len, s[1] + Math.sin(ang) * len];
        const br = fracture(s, end, len * 0.18, 4, rnd);
        strokes.poly(br.filter((p) => Math.hypot(p[0] - snapAt[0], p[1] - snapAt[1]) < snapR - 0.3), 0.035, INLAY.groove);
        if (rnd() < 0.5) {
          const m = br[Math.floor(br.length / 2)];
          const a2 = ang + (rnd() - 0.5) * 1.8, l2 = len * 0.4;
          strokes.poly(fracture(m, [m[0] + Math.cos(a2) * l2, m[1] + Math.sin(a2) * l2], l2 * 0.2, 3, rnd).filter((p) => Math.hypot(p[0] - snapAt[0], p[1] - snapAt[1]) < snapR - 0.3), 0.03, INLAY.groove);
        }
      }
    }
    for (const p of map.pickups ?? []) { strokes.circle(p.at as unknown as V2, 0.85, 0.06, INLAY.groove, 0.2); strokes.circle(p.at as unknown as V2, 0.55, 0.04, INLAY.groove, 0.2); }
  } else {
    // the Noonplate: chalk hour-lines from the cart ring to every hour-mark, the marks' numerals
    (map.spawns ?? []).forEach((s, k) => {
      const dx = s[0] - plateAt[0], dy = s[1] - plateAt[1], l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      strokes.seg([plateAt[0] + ux * 4.35, plateAt[1] + uy * 4.35], [plateAt[0] + ux * (l - 1.9), plateAt[1] + uy * (l - 1.9)], 0.15, INLAY.chalk);
      numeral(strokes, [s[0] + ux * 0.6, s[1] + uy * 0.6], k + 1, 1.9, 0.16, INLAY.chalk);
      strokes.circle([s[0] + ux * 0.6, s[1] + uy * 0.6], 1.75, 0.14, INLAY.lit, 0.3);
    });
    strokes.circle(plateAt, 4.0, 0.22, INLAY.mid, 0.3);
    strokes.circle(plateAt, plateR - 0.45, 0.18, INLAY.chalk, 0.4);
    for (const p of map.pickups ?? []) { strokes.circle(p.at as unknown as V2, 0.85, 0.2, INLAY.mid, 0.15); strokes.circle(p.at as unknown as V2, 0.45, 0.14, INLAY.chalk, 0.12); }
  }
  const inlay = bakeInlay(strokes, [SX, SY], 0.125);
  disposables.push(inlay.tex);

  const grey: Texture = greyTex();
  disposables.push(grey);
  const tempField = (tr.temperatureField ?? {}) as { west?: unknown; east?: unknown; strength?: unknown };
  const tempOf = (hex: unknown, d: string): Color => {
    const c = lin(typeof hex === 'string' ? hex : d);
    const l = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
    return c.multiplyScalar(1 / Math.max(1e-3, l));
  };
  const tempK = typeof tempField.strength === 'number' ? Math.min(1, tempField.strength * 3) : 0;
  const tex = { litter: { value: grey as Texture }, grain: { value: grey as Texture }, moss: { value: grey as Texture } };
  const shared = {
    uTempW: { value: tempOf(tempField.west, '#B8C6D9') }, uTempE: { value: tempOf(tempField.east, '#D9C2A0') }, uTempK: { value: tempK },
    uMapSize: { value: new Vector2(SX, SY) },
  };

  // ── ground ───────────────────────────────────────────────────────────────────────────────────
  const gz0 = -MARGIN, gz1 = SY + MARGIN;
  const groundGeo = new PlaneGeometry(SX + MARGIN * 2, gz1 - gz0, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(SX / 2, 0, (gz0 + gz1) / 2);
  const groundMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const p0 = plazas[0], p1 = plazas[1];
  const gu = {
    ...shared,
    uSplat: { value: splatTex }, uSplat2: { value: splat2Tex }, uInlay: { value: inlay.tex },
    uSplatScale: { value: new Vector2(1 / (W * texel), 1 / (H * texel)) }, uInlayScale: { value: new Vector2(inlay.scale[0], inlay.scale[1]) },
    uLaneHalf: { value: LANE_HALF },
    uTexLitter: tex.litter, uTexGrain: tex.grain, uTexMoss: tex.moss,
    uLane: { value: lin(colors.lane) }, uGrout: { value: lin(colors.laneGrout) }, uVerge: { value: lin(colors.verge) }, uJungle: { value: lin(colors.jungle) },
    uMoss: { value: lin(colors.moss) }, uEarth: { value: lin(colors.earth) }, uClearing: { value: lin(colors.clearing) },
    uInscription: { value: lin(colors.inscription) }, uThicketFloor: { value: lin(colors.grassRoot) }, uShaftFloor: { value: lin(colors.shaftFloor) },
    uSeatC: { value: lin(colors.seat) }, uMidInlay: { value: lin(colors.midInlay) }, uLitC: { value: lin(colors.lit) },
    uPlazaA: { value: lin(colors.plazaAubade) }, uPlazaS: { value: lin(colors.plazaSerenade) }, uInlayA: { value: lin(colors.inlayAubade) }, uInlayS: { value: lin(colors.inlaySerenade) },
    uPlaza0: { value: p0 ? new Vector4(p0.x, p0.y, p0.r, p0.side) : new Vector4() }, uPlaza1: { value: p1 ? new Vector4(p1.x, p1.y, p1.r, p1.side) : new Vector4() },
    uFount0: { value: p0 ? new Vector4(p0.fx, p0.fy, p0.fr, 0) : new Vector4() }, uFount1: { value: p1 ? new Vector4(p1.fx, p1.fy, p1.fr, 0) : new Vector4() },
    uSeat: { value: seatV }, uPlate: { value: new Vector3(plateAt[0], plateAt[1], plateR) },
    uWaterT: worldUniforms.valeTime,
    uSeatCol: { value: Array.from({ length: 10 }, (_, k) => lin(FRAY_SEATS[k % FRAY_SEATS.length].color)) },
  };
  const styleDef = surface === 'span' ? 'VALE_STYLE_SPAN' : surface === 'plate' ? 'VALE_STYLE_PLATE' : 'VALE_STYLE_DIAL';
  groundMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, gu);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n#define ${styleDef}\n${gorge ? '#define VALE_GORGE\n' : ''}${GROUND_PARS_GLSL}\n${NOISE_GLSL}\n${TERRAIN_HELPERS_GLSL}`)
      .replace('#include <map_fragment>', GROUND_MAIN_GLSL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, gHeight, 1.0 );');
  };
  groundMat.customProgramCacheKey = () => `vale_ground_v6_${surface}${gorge ? '_g' : ''}`;
  patchWorldMaterial(groundMat);
  const ground = new Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'vale_ground';
  group.add(ground);
  disposables.push(groundGeo, groundMat);

  // ── walls ───────────────────────────────────────────────────────────────────────────────────────
  // authored landmarks (map.art.terrain.landmarks with a model): scatter keeps out of their footprint (and
  // well clear on the camera side, +y, so canopies never hide them); a landmark that covers a whole wall
  // polygon IS that wall (a fallen drum, a slab), so the polygon gets no cliff block of its own
  const marks = (Array.isArray(tr.landmarks) ? (tr.landmarks as { model?: unknown; at?: unknown; size?: unknown }[]) : [])
    .filter((l) => typeof l.model === 'string' && Array.isArray(l.at))
    .map((l) => { const at = l.at as number[], sz = Array.isArray(l.size) ? (l.size as number[]) : [2, 2]; return { x: at[0], y: at[1], sx: sz[0] / 2, sy: sz[1] / 2 }; });
  const onMark = (x: number, y: number): boolean => marks.some((m) => Math.abs(x - m.x) < m.sx + 1.6 && y > m.y - m.sy - 1.6 && y < m.y + m.sy + 5);
  const replaced = walls.map((_, i) => marks.some((m) => {
    const b = wallBoxes[i];
    return b.minX >= m.x - m.sx - 0.3 && b.maxX <= m.x + m.sx + 0.3 && b.minY >= m.y - m.sy - 0.3 && b.maxY <= m.y + m.sy + 0.3;
  }));
  const wh = (tr.wallHeights ?? {}) as Record<string, unknown>;
  const smallH = num(wh.small) ?? num(wh.hourStones);
  const largeH = num(wh.large) ?? num(wh.rim);
  const RH = num(wh.frame) ?? num(wh.rim) ?? 3.4;
  const wallHeights: number[] = [];
  const wm = new WallMesh();
  walls.forEach((poly, i) => {
    if (chasm[i] || replaced[i]) { wallHeights.push(0); return; }
    const area = Math.abs(signedArea(poly));
    const small = area < 25;
    const h = small ? (smallH ?? 1.6 + 0.6 * hash2(i, area)) : (largeH ?? 2.6 + 0.8 * hash2(i * 3.1, area));
    wallHeights.push(h);
    const seed = 1 + ((i * 0.618034) % 1) * 9;
    const outline = organicOutline(poly, 0.9, small ? 0.06 : 0.28, [SX, SY], i * 7.3);
    if (outline.length < 3) return;
    const prof = cliffProfile(h, i * 7.3 + 1, small);
    sweep(wm, outline, prof.strips, { closed: true, ccw: signedArea(outline) > 0, seed, chisel: small ? 0.05 : 0.16, pinned: onBorder }, h);
    wm.cap(outline, prof.topY, [0, 0, 0, WK.top], [1, seed, prof.topY, h]);
  });
  // outer rim: a carved wall all around the playable plate (gorge maps: only the terrace ends)
  const RIM = 14;
  const rimPolys: Poly[] = gorge ? [
    [[-RIM, 0], [0, 0], [0, SY], [-RIM, SY]],
    [[SX, 0], [SX + RIM, 0], [SX + RIM, SY], [SX, SY]],
  ] : [
    [[-RIM, -RIM], [SX + RIM, -RIM], [SX + RIM, 0], [-RIM, 0]],
    [[-RIM, SY], [SX + RIM, SY], [SX + RIM, SY + RIM], [-RIM, SY + RIM]],
    [[-RIM, 0], [0, 0], [0, SY], [-RIM, SY]],
    [[SX, 0], [SX + RIM, 0], [SX + RIM, SY], [SX, SY]],
  ];
  rimPolys.forEach((poly, i) => {
    const seed = 3 + i;
    const prof = cliffProfile(RH, 100 + i, false);
    sweep(wm, poly, prof.strips, { closed: true, ccw: signedArea(poly) > 0, seed, chisel: 0, pinned: onBorder }, RH);
    wm.cap(poly, prof.topY, [0, 0, 0, WK.top], [1, seed, prof.topY, RH]);
  });
  // Needlegrass curbs: a small carved kerb (the lip strips: cap stones, chamfered edge light)
  thickets.forEach((poly, k) => {
    const ccw = signedArea(poly) > 0;
    const strips: Strip[] = [
      { from: { off: 0.1, y: -0.03 }, to: { off: 0.1, y: 0.1 }, kind: WK.lipFace, course: 0 },
      { from: { off: 0.1, y: 0.1 }, to: { off: 0.05, y: 0.15 }, kind: WK.chamfer, course: 0 },
      { from: { off: 0.05, y: 0.15 }, to: { off: -0.1, y: 0.15 }, kind: WK.lipTop, course: 0 },
      { from: { off: -0.1, y: 0.15 }, to: { off: -0.14, y: 0.03 }, kind: WK.lipIn, course: 0 },
    ];
    sweep(wm, resample([...poly, poly[0]], 0.6).slice(0, -1), strips, { closed: true, ccw, seed: 50 + k, chisel: 0.012 }, 0.15);
  });

  // ── the gorge (wallStyle "gorge"): the deck's flank, raw rock, far walls, carved bands, spires ──────
  const spireItems: { m: Matrix4; c?: Color }[] = [];
  if (gorge) {
    const flankStrips = flankProfile(gorgeDepth, 7);
    const bandStrips = flankProfile(gorgeDepth, 9, 1.18).map((s) => ({ ...s, kind: s.kind === WK.flank ? WK.band : s.kind }));
    const rockExtra = (x: number, y: number, h: number): number => (h < -5.5 ? ((vnoise(x * 0.16, h * 0.09 + y * 0.1) - 0.5) * 3.2 + (vnoise(x * 0.5 + 3, h * 0.3) - 0.5) * 1.0) * Math.min(1, (-h - 5.5) / 6) : 0);
    chasmPolys.forEach((poly, k) => {
      const ccw = signedArea(poly) > 0;
      const n = poly.length;
      // classify edges: map-border edges are far walls (rock falls from the rim), the rest are deck edges
      const isBorderEdge = (i: number): boolean => {
        const a = poly[i], b = poly[(i + 1) % n];
        return onBorder(a[0], a[1]) && onBorder(b[0], b[1]) && (Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01);
      };
      // hour-band notches: vertex runs strictly inside the deck strip
      const inStrip = (p: V2): boolean => Math.abs(p[1] - axisY) < deckHalf - 0.05;
      // start the walk at a border edge so runs never wrap
      let s0 = 0;
      for (let i = 0; i < n; i++) if (isBorderEdge(i)) { s0 = (i + 1) % n; break; }
      let run: V2[] = [];
      let runBorder: boolean | null = null;
      const flush = (): void => {
        if (run.length >= 2) {
          if (runBorder) {
            const line = resample(run, 2.0);
            sweep(wm, line, rockFaceProfile(0, gorgeDepth, 11 + k, false), { closed: false, ccw, seed: 20 + k, chisel: 0.5, extra: rockExtra, taper: 1.5 }, 0);
          } else {
            const line = resample(run, 0.9);
            sweep(wm, line, flankStrips, { closed: false, ccw, seed: 30 + k, chisel: 0.05, extra: rockExtra }, 0);
          }
        }
        run = [];
      };
      for (let t = 0; t < n; t++) {
        const i = (s0 + t) % n;
        const b = isBorderEdge(i);
        if (runBorder !== b) { flush(); runBorder = b; run = [poly[i]]; }
        run.push(poly[(i + 1) % n]);
      }
      flush();
      // carved hour-bands: the notch block stands proud of the deck, its ring rolls on down the flank
      for (let i = 0; i < n; i++) {
        if (inStrip(poly[i]) || !inStrip(poly[(i + 1) % n])) continue;
        const notch: V2[] = [poly[i]];
        let j = (i + 1) % n;
        while (inStrip(poly[j]) && notch.length < n) { notch.push(poly[j]); j = (j + 1) % n; }
        notch.push(poly[j]);
        if (notch.length < 4) continue;
        const nccw = signedArea(notch) > 0;
        const bandProfile: Strip[] = [
          { from: { off: 0, y: -0.3 }, to: { off: 0, y: bandH - 0.08 }, kind: WK.band, course: 0 },
          { from: { off: 0, y: bandH - 0.08 }, to: { off: -0.08, y: bandH }, kind: WK.chamfer, course: 0 },
        ];
        sweep(wm, notch, bandProfile, { closed: true, ccw: nccw, seed: 60 + i, chisel: 0 }, bandH);
        wm.cap(notch.map((p) => p), bandH, [0, 0, 0, WK.band], [1, 60 + i, bandH, bandH]);
        sweep(wm, resample([notch[notch.length - 1], notch[0]], 0.6).reverse(), bandStrips, { closed: false, ccw, seed: 70 + i, chisel: 0.03, extra: rockExtra }, 0);
      }
    });
    // far walls' rims: the plateau's lip (a low carved kerb on the far side of the drop)
    // rock spires standing in the gorge (parallax: the drop reads deep as the camera moves)
    const sp = mulberry(777);
    for (let k = 0; k < Math.round(SX * SY * 0.012); k++) {
      const x = sp() * SX, y = sp() * SY;
      if (field(F.ch, x, y) < 2.6) continue;
      if (y < 2 || y > SY - 2) continue;
      const top = -3 - sp() * sp() * 12;
      const w = 1.2 + sp() * 2.4;
      const hgt = top + gorgeDepth + 6;
      spireItems.push({ m: new Matrix4().compose(new Vector3(x, -gorgeDepth - 6, y), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), sp() * 6.28), new Vector3(w, hgt, w * (0.8 + sp() * 0.4))) });
    }
  }
  const wallGeo = wm.geometry();
  const wallMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
  const wu = {
    ...shared,
    uFace: { value: lin(colors.cliffFace) }, uLip: { value: lin(colors.cliffLip) }, uEdgeLight: { value: lin(colors.edgeLight) },
    uTop: { value: lin(colors.cliffTop) }, uMossC: { value: lin(colors.moss) }, uFlank: { value: lin(colors.flank) }, uRock: { value: lin(colors.rock) },
    uMist: { value: lin(colors.mist).multiplyScalar(0.5) }, uEarthC: { value: lin(colors.earth) }, uMistK: { value: gorge ? 0.065 : 0 },
    uStoneTop: { value: surface === 'plate' ? 1 : 0 },
    uTexGrain: tex.grain, uTexMoss: tex.moss, uTexLitter: tex.litter,
  };
  wallMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, wu);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WALL_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WALL_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WALL_PARS_GLSL}\n${NOISE_GLSL}\n${TERRAIN_HELPERS_GLSL}`)
      .replace('#include <map_fragment>', WALL_MAIN_GLSL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = cRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, cH, 1.0 );')
      .replace('#include <opaque_fragment>', `${WALL_MIST_GLSL}\n#include <opaque_fragment>`);
  };
  wallMat.customProgramCacheKey = () => 'vale_walls_v6';
  patchWorldMaterial(wallMat);
  const wallMesh = new Mesh(wallGeo, wallMat);
  wallMesh.castShadow = true; wallMesh.receiveShadow = true; wallMesh.name = 'vale_cliffs';
  group.add(wallMesh);
  disposables.push(wallGeo, wallMat);

  // gorge extras: spires and drifting mist banks
  if (gorge) {
    const spGeo = spire(5);
    const spMat = new MeshStandardMaterial({ color: lin(colors.rock), roughness: 0.92, flatShading: true });
    const mistU = { uMist: wu.uMist, uMistK: wu.uMistK };
    spMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, mistU);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uMist; uniform float uMistK;')
        .replace('#include <opaque_fragment>', `{ float dm = max( 0.0, -vValeWorld.y - 2.0 ); float m = 1.0 - exp( -uMistK * dm * ( 1.0 + dm * 0.045 ) ); outgoingLight = mix( outgoingLight, uMist * mix( 1.0, 0.45, smoothstep( 8.0, 30.0, dm ) ), m ); }\n#include <opaque_fragment>`);
    };
    spMat.customProgramCacheKey = () => 'vale_spire_v1';
    patchWorldMaterial(spMat);
    if (spireItems.length) group.add(chunked(spGeo, spMat, spireItems, 'vale_spires', false));
    disposables.push(spGeo, spMat);
  }

  // ── Needlegrass (brush) ────────────────────────────────────────────────────────────────────────
  const clump = needlegrassClump(lin(colors.grassRoot), lin(colors.grassTip));
  const grassMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: DoubleSide });
  const grassU = { uWindT: worldUniforms.valeTime };
  grassMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, grassU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWindT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  #ifdef USE_INSTANCING
  vec2 base = vec2( instanceMatrix[3][0], instanceMatrix[3][2] );
  #else
  vec2 base = vec2( 0.0 );
  #endif
  float hf = clamp( position.y / 1.25, 0.0, 1.0 );
  float ph = base.x * 0.37 + base.y * 0.53;
  // T0 ambient: slow sway, at most 0.5 Hz
  float sway = sin( uWindT * 2.2 + ph ) * 0.05 + sin( uWindT * 1.3 + ph * 1.7 ) * 0.03;
  transformed.x += sway * hf * hf;
  transformed.z += sway * 0.6 * hf * hf;
}`);
  };
  grassMat.customProgramCacheKey = () => 'vale_grass_v2';
  patchWorldMaterial(grassMat);
  const grassItems: { m: Matrix4; c: Color }[] = [];
  {
    const q = new Quaternion(), s = new Vector3(), pos = new Vector3(), up = new Vector3(0, 1, 0);
    thickets.forEach((poly, k) => {
      const b = thicketBoxes[k];
      const step = 0.48;
      for (let y = b.minY + step / 2; y < b.maxY; y += step) {
        for (let x = b.minX + step / 2; x < b.maxX; x += step) {
          const jx = x + (rand() - 0.5) * step * 0.9, jy = y + (rand() - 0.5) * step * 0.9;
          if (!pointInPolygon(jx, jy, poly)) continue;
          const e = polyEdgeDist(jx, jy, poly);
          if (e < 0.22) continue;
          q.setFromAxisAngle(up, rand() * Math.PI * 2);
          const kk = 0.8 + rand() * 0.45;
          const hh = (0.85 + rand() * 0.35) * (e < 0.6 ? 0.8 : 1);
          s.set(kk, hh, kk);
          pos.set(jx, 0, jy);
          const t = 0.88 + 0.24 * vnoise(jx * 0.7, jy * 0.7) + (rand() - 0.5) * 0.08;
          grassItems.push({ m: new Matrix4().compose(pos, q, s), c: new Color(t * (1.0 + (rand() - 0.5) * 0.06), t, t * (0.96 + (rand() - 0.5) * 0.06)) });
        }
      }
    });
  }
  if (grassItems.length) group.add(chunked(clump, grassMat, grassItems, 'vale_needlegrass'));
  disposables.push(clump, grassMat);

  // ── Standing Shadow + Fallen Shaft (terrain marks from the map's terrain block) ────────────────
  const shU = {
    uSplat: { value: splatTex }, uSplat2: { value: splat2Tex }, uInlay: { value: inlay.tex },
    uSplatScale: gu.uSplatScale, uInlayScale: gu.uInlayScale, uTexGrain: tex.grain,
    // ×1.5: lands the lit, graded floor on the designed L* 30–36 (the tint is the designed screen colour)
    uShadowC: { value: lin(typeof shadowDef?.tint === 'string' ? shadowDef.tint : '#4A4560').multiplyScalar(1.5) }, uShadowLine: { value: lin(colors.shadowLine) },
  };
  for (const poly of shadowPolys) {
    const fill = new ShapeGeometry(shapeOf(poly), 1);
    fill.rotateX(-Math.PI / 2);
    fill.translate(0, 0.012, 0);
    const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, shU);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vShW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvShW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${SHADOW_PARS_GLSL}\n${NOISE_GLSL}\n${TERRAIN_HELPERS_GLSL}`)
        .replace('#include <map_fragment>', SHADOW_MAIN_GLSL)
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, sHeight, 1.0 );');
    };
    mat.customProgramCacheKey = () => 'vale_shadow_v2';
    patchWorldMaterial(mat, { keepColor: true });
    const mesh = new Mesh(fill, mat);
    mesh.receiveShadow = true; mesh.name = 'vale_standing_shadow';
    group.add(mesh);
    disposables.push(fill, mat);
  }
  for (const poly of shaftPolys) {
    const geo = new ShapeGeometry(shapeOf(poly), 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.03, 0);
    // shallow water over pale stone: a thin cool film the floor shows through, slow crossing ripples
    // catching the sky, a brighter wet rim where it laps the stone
    const mat = new MeshStandardMaterial({ color: lin(colors.water), roughness: 0.1, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false,
      envMapIntensity: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const wU = { uWaterT: worldUniforms.valeTime, uSplat2: { value: splat2Tex }, uSplatScale: gu.uSplatScale };
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, wU);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uWaterT; uniform sampler2D uSplat2; uniform vec2 uSplatScale;\n${NOISE_GLSL}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec2 wp = vValeWorld.xz;
    float h = valeNoise( wp * 1.7 + vec2( uWaterT * 0.35, uWaterT * 0.21 ) ) + 0.55 * valeNoise( wp * 3.9 - vec2( uWaterT * 0.47, -uWaterT * 0.29 ) );
    normal = valeBump( -vViewPosition, normal, h, 0.05 );
  }`)
        .replace('#include <opaque_fragment>', `{
  float sd = texture( uSplat2, vValeWorld.xz * uSplatScale ).g * 8.0 - 4.0;
  float lap = 1.0 - smoothstep( 0.0, 0.35, -sd );
  diffuseColor.a = mix( diffuseColor.a, 0.75, lap );
  outgoingLight = mix( outgoingLight, outgoingLight * 1.25 + vec3( 0.02 ), lap * ( 0.6 + 0.4 * sin( uWaterT * 0.9 + vValeWorld.x * 2.0 + vValeWorld.z ) ) );
}
#include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'vale_water_v2';
    patchWorldMaterial(mat);
    const mesh = new Mesh(geo, mat);
    mesh.receiveShadow = true; mesh.name = 'vale_fallen_shaft';
    group.add(mesh);
    disposables.push(geo, mat);
  }

  // ── scatter (quality dependent) ─────────────────────────────────────────────────────────────
  const scatterGroup = new Group();
  scatterGroup.name = 'vale_scatter';
  group.add(scatterGroup);
  const treeSpots: { x: number; y: number; h: number; s: number; r: number; tint: number }[] = [];
  walls.forEach((poly, i) => {
    if (chasm[i] || wallHeights[i] < 2.2 || surface === 'plate') return;          // the Noonplate is a clean stage
    const b = wallBoxes[i];
    const step = 2.7;
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      for (let x = b.minX + step / 2; x < b.maxX; x += step) {
        const jx = x + (rand() - 0.5) * step * 0.85, jy = y + (rand() - 0.5) * step * 0.85;
        if (!pointInPolygon(jx, jy, poly)) continue;
        const e = polyEdgeDist(jx, jy, poly);
        if (e < 1.3) continue;
        if (jx < -2 || jy < -2 || jx > SX + 2 || jy > SY + 2) continue;
        // thin out deep interiors (they are never seen up close)
        if (e > 9 && rand() < 0.6) continue;
        if (onMark(jx, jy)) continue;
        // keep camps in view: no canopy on the camera side (+y) of a camp, where a 4-5 m crown on a cliff hides it
        if (clearings.some((c) => c.camp && Math.abs(jx - c.x) < c.r + 1.5 && jy > c.y && jy < c.y + c.r + 6)) continue;
        treeSpots.push({ x: jx, y: jy, h: wallHeights[i], s: 0.75 + rand() * 0.55, r: rand() * Math.PI * 2, tint: rand() });
      }
    }
  });
  const boulderSpots: { x: number; y: number; s: number; r: number }[] = [];
  walls.forEach((poly, i) => {
    if (chasm[i] || replaced[i]) return;
    const out = organicOutline(poly, 2.4, 0, [SX, SY], i);
    const ccw = signedArea(poly) > 0;
    for (let k = 0; k < out.length; k++) {
      if (rand() > 0.45) continue;
      const a = out[k], b = out[(k + 1) % out.length];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const nx = (ccw ? dy : -dy) / l, ny = (ccw ? -dx : dx) / l;
      const off = 0.35 + rand() * 0.6;
      const t = rand();
      const x = a[0] + nx * off + dx * t, y = a[1] + ny * off + dy * t;
      if (x < 0.5 || y < 0.5 || x > SX - 0.5 || y > SY - 0.5) continue;
      if (surface !== 'dial') continue;
      let ok = field(F.ld, x, y) > LANE_HALF + 0.6;
      for (const c of clearings) if (ok && Math.hypot(x - c.x, y - c.y) < c.r) ok = false;
      if (ok && (onMark(x, y) || inPlaza(x, y, 1) || field(F.sh, x, y) < 0.5 || field(F.sf, x, y) < 0.5)) ok = false;
      if (ok) boulderSpots.push({ x, y, s: 0.35 + Math.pow(rand(), 1.6) * 0.75, r: rand() * Math.PI * 2 });
    }
  });
  const stoneSpots: { x: number; y: number; s: number; r: number }[] = [];
  const nStones = surface === 'dial' ? Math.round(SX * SY * 0.02) : 0;
  for (let k = 0; k < nStones; k++) {
    const x = rand() * SX, y = rand() * SY;
    let ok = field(F.ld, x, y) > LANE_HALF + 1.2 && field(F.wd, x, y) > 0.6 && field(F.td, x, y) > 0.2;
    for (const c of clearings) if (ok && Math.hypot(x - c.x, y - c.y) < c.r + 0.8) ok = false;
    if (ok && (onMark(x, y) || inPlaza(x, y, 1) || field(F.sh, x, y) < 0.5 || field(F.sf, x, y) < 0.5)) ok = false;
    if (ok) stoneSpots.push({ x, y, s: 0.1 + Math.pow(rand(), 2.2) * 0.32, r: rand() * Math.PI * 2 });
  }
  // ground clutter (Dialwood only: the deck and the plate stay clean stages)
  type CSpot = { x: number; y: number; s: number; r: number; c: Color };
  const clutter: { moss: CSpot[]; leaf: CSpot[]; pebble: CSpot[]; tuft: CSpot[] } = { moss: [], leaf: [], pebble: [], tuft: [] };
  if (surface === 'dial') {
    const cr = mulberry(9001);
    const leafCols = [colors.litter, '#7A5A2E', '#6E4A2A', '#5E5530', '#4E5A2E', '#806538', '#62402A'].map(lin);
    const step = 0.55;
    for (let y = step / 2; y < SY; y += step) {
      for (let x = step / 2; x < SX; x += step) {
        const jx = x + (cr() - 0.5) * step, jy = y + (cr() - 0.5) * step;
        const ld = field(F.ld, jx, jy), wd = field(F.wd, jx, jy), td = field(F.td, jx, jy), cd = field(F.cd, jx, jy);
        if (wd <= 0.05 || td < 0.35 || ld < LANE_HALF + 0.7 || cd < 0.3) { cr(); cr(); cr(); continue; }
        if (field(F.sh, jx, jy) < 0.5 || field(F.sf, jx, jy) < 0.7 || inPlaza(jx, jy, 0.5) || (seatV.z > 0 && Math.hypot(jx - seatV.x, jy - seatV.y) < seatV.z + 0.8)) { cr(); cr(); cr(); continue; }
        if (clearings.some((c) => !c.camp && Math.hypot(jx - c.x, jy - c.y) < c.r - 1)) { cr(); cr(); cr(); continue; }
        const mossy = vnoise(jx * 0.05 + 3.7, jy * 0.05) ;
        const foot = Math.max(0, 1 - wd / 1.3);
        const verge = ld < LANE_HALF + 2.2 ? 1 : 0;
        const a = cr(), b = cr(), c = cr();
        const v = 0.85 + 0.3 * vnoise(jx * 0.4, jy * 0.4);
        if (a < 0.45 * foot + 0.08 * verge) {
          clutter.tuft.push({ x: jx, y: jy, s: 0.22 + b * 0.2, r: c * 6.283, c: new Color(v, v * (0.98 + b * 0.06), v * 0.92) });
        } else if (a < 0.45 * foot + 0.08 * verge + 0.07 + 0.12 * mossy) {
          clutter.moss.push({ x: jx, y: jy, s: 0.16 + b * 0.24, r: c * 6.283, c: new Color(v * (0.95 + c * 0.12), v, v * (0.85 + b * 0.1)) });
        } else if (a < 0.45 * foot + 0.08 * verge + 0.07 + 0.12 * mossy + 0.36) {
          const lc = leafCols[Math.floor(b * leafCols.length) % leafCols.length].clone().multiplyScalar(0.8 + c * 0.35);
          clutter.leaf.push({ x: jx, y: jy, s: 0.09 + c * 0.07, r: b * 6.283 + a * 40, c: lc });
        } else if (a > 0.985 - 0.08 * foot) {
          clutter.pebble.push({ x: jx, y: jy, s: 0.07 + b * b * 0.16, r: c * 6.283, c: new Color(v * 0.95, v * 0.95, v * 0.92) });
        }
      }
    }
  }
  const trunkGeo = new CylinderGeometry(0.1, 0.2, 1, 5, 1);
  trunkGeo.translate(0, 0.5, 0);
  const canopyGeo = dialwoodCanopy(lin(colors.leaf));
  const rockGeo = rockGeometry(11);
  const leafMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, flatShading: true });
  const trunkMat = new MeshStandardMaterial({ color: lin(colors.trunk), roughness: 0.85 });
  const stoneMat = new MeshStandardMaterial({ color: lin(colors.stone), roughness: 0.88, flatShading: true });
  for (const mt of [leafMat, trunkMat, stoneMat]) patchWorldMaterial(mt);
  disposables.push(trunkGeo, canopyGeo, rockGeo, leafMat, trunkMat, stoneMat);
  const clutterGeo = {
    moss: mossTuft(new Color(0.05, 0.065, 0.028), new Color(0.15, 0.18, 0.065)),
    leaf: fanLeaf(new Color(1, 1, 1)),
    pebble: pebble(lin(colors.pebble)),
    tuft: bladeTuft(lin(colors.grassRoot), lin(colors.grassTip).multiplyScalar(0.92)),
  };
  const clutterMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: DoubleSide });
  patchWorldMaterial(clutterMat);
  disposables.push(clutterGeo.moss, clutterGeo.leaf, clutterGeo.pebble, clutterGeo.tuft, clutterMat);
  let scatterParts: Group[] = [];
  let props: Partial<Record<TerrainPropRole, BufferGeometry[]>> = {};
  let scatterLevel: 0 | 1 | 2 = 2;
  const propMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  patchWorldMaterial(propMat);
  disposables.push(propMat);
  /** instanced props by variant (a spot's variant is a hash of its position: stable across quality changes) */
  const propParts = (geos: BufferGeometry[], items: { x: number; y: number; m: Matrix4; c?: Color }[], name: string, shadows = true): Group[] => {
    const by: { m: Matrix4; c?: Color }[][] = geos.map(() => []);
    for (const it of items) by[Math.floor(hash2(it.x * 1.7, it.y * 2.3) * geos.length) % geos.length].push(it);
    return geos.map((g, i) => chunked(g, propMat, by[i], `${name}_${i}`, shadows)).filter((g) => g.children.length > 0);
  };
  const setScatter = (level: 0 | 1 | 2): void => {
    scatterLevel = level;
    for (const g of scatterParts) { scatterGroup.remove(g); g.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose(); }); }
    scatterParts = [];
    // level 0 keeps a sparse tree line so cliff tops never read as empty slabs
    const keepT = level === 0 ? 0.35 : level === 1 ? 0.7 : 1;
    const keepS = level === 0 ? 0 : level === 1 ? 0.5 : 1;
    const pick = <T,>(arr: T[], keep: number): T[] => arr.filter((_, i) => (i * 0.618034) % 1 < keep);
    const trees = pick(treeSpots, keepT), boulders = pick(boulderSpots, level === 0 ? 0.5 : 1), stones = pick(stoneSpots, keepS);
    const q = new Quaternion(), s = new Vector3(), pos = new Vector3(), up = new Vector3(0, 1, 0);
    if (trees.length && props.tree?.length) {
      scatterParts.push(...propParts(props.tree, trees.map((t) => {
        q.setFromAxisAngle(up, t.r); s.setScalar(0.56 + t.s * 0.24); pos.set(t.x, t.h - 0.12, t.y);
        return { x: t.x, y: t.y, m: new Matrix4().compose(pos, q, s), c: new Color(0.86 + t.tint * 0.22, 0.9 + t.tint * 0.14, 0.86 + t.tint * 0.12) };
      }), 'vale_trees'));
    } else if (trees.length) {
      const trunks: { m: Matrix4 }[] = [], canopies: { m: Matrix4; c: Color }[] = [];
      for (const t of trees) {
        const th = 1.0 + t.s * 0.8;
        q.setFromAxisAngle(up, t.r);
        s.set(t.s, th, t.s); pos.set(t.x, t.h - 0.1, t.y);
        trunks.push({ m: new Matrix4().compose(pos, q, s) });
        s.set(t.s * 1.25, t.s * 1.15, t.s * 1.25); pos.set(t.x, t.h + th * 0.82, t.y);
        canopies.push({ m: new Matrix4().compose(pos, q, s), c: new Color(0.82 + t.tint * 0.3, 0.86 + t.tint * 0.24, 0.84 + t.tint * 0.2) });
      }
      scatterParts.push(chunked(trunkGeo, trunkMat, trunks, 'vale_trunks'), chunked(canopyGeo, leafMat, canopies, 'vale_canopies'));
    }
    if (boulders.length && props.rock?.length) {
      scatterParts.push(...propParts(props.rock, boulders.map((b) => {
        q.setFromAxisAngle(up, b.r); s.set(b.s * 1.25, b.s * 1.1, b.s * 1.25); pos.set(b.x, -0.04, b.y);
        return { x: b.x, y: b.y, m: new Matrix4().compose(pos, q, s) };
      }), 'vale_boulders'));
    } else if (boulders.length) {
      scatterParts.push(chunked(rockGeo, stoneMat, boulders.map((b) => {
        q.setFromAxisAngle(up, b.r); s.set(b.s * 1.2, b.s * 0.8, b.s); pos.set(b.x, b.s * 0.15, b.y);
        return { m: new Matrix4().compose(pos, q, s) };
      }), 'vale_boulders'));
    }
    if (stones.length && (props.stone?.length || props.rock?.length)) {
      scatterParts.push(...propParts(props.stone?.length ? props.stone : props.rock!, stones.map((p) => {
        q.setFromAxisAngle(up, p.r); s.set(p.s * 1.1, p.s * 0.9, p.s); pos.set(p.x, -0.02, p.y);
        return { x: p.x, y: p.y, m: new Matrix4().compose(pos, q, s) };
      }), 'vale_stones', false));
    } else if (stones.length) {
      scatterParts.push(chunked(rockGeo, stoneMat, stones.map((p) => {
        q.setFromAxisAngle(up, p.r); s.set(p.s, p.s * 0.6, p.s * 0.85); pos.set(p.x, p.s * 0.1, p.y);
        return { m: new Matrix4().compose(pos, q, s) };
      }), 'vale_stones', false));
    }
    // ground clutter: none on Low, half on Medium, all on High/Ultra; never casts shadows
    const keepC = level === 0 ? 0 : level === 1 ? 0.5 : 1;
    const place = (list: CSpot[], geo: BufferGeometry, name: string, yS: number, y0: number): void => {
      const items = pick(list, keepC).map((p) => {
        q.setFromAxisAngle(up, p.r); s.set(p.s, p.s * yS, p.s); pos.set(p.x, y0, p.y);
        return { m: new Matrix4().compose(pos, q, s), c: p.c };
      });
      if (items.length) scatterParts.push(chunked(geo, clutterMat, items, name, false));
    };
    place(clutter.moss, clutterGeo.moss, 'vale_clutter_moss', 1, -0.01);
    place(clutter.leaf, clutterGeo.leaf, 'vale_clutter_leaf', 1, 0.004);
    place(clutter.pebble, clutterGeo.pebble, 'vale_clutter_pebble', 1, 0);
    place(clutter.tuft, clutterGeo.tuft, 'vale_clutter_tuft', 1.1, 0);
    for (const g of scatterParts) scatterGroup.add(g);
  };
  setScatter(2);

  return {
    group,
    wallHeights,
    setScatter,
    setTextures(t: Partial<Record<TerrainTexRole, Texture>>): void {
      for (const r of TERRAIN_TEX_ROLES) { const x = t[r]; if (x) tex[r].value = x; }
    },
    setProps(p: Partial<Record<TerrainPropRole, BufferGeometry[]>>): void {
      props = p;
      setScatter(scatterLevel);
    },
    groundAt(x: number, y: number): number {
      for (let i = 0; i < walls.length; i++) {
        if (chasm[i] || replaced[i]) continue;
        const b = wallBoxes[i];
        if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
        if (pointInPolygon(x, y, walls[i])) return wallHeights[i];
      }
      const out = gorge ? x < 0 || x > SX : x < 0 || x > SX || y < 0 || y > SY;
      return out ? RH : 0;                                                   // the carved rim round the plate
    },
    update(time: number): void { worldUniforms.valeTime.value = time; },
    dispose(): void {
      group.traverse((o) => { if ((o as InstancedMesh).isInstancedMesh) (o as InstancedMesh).dispose(); });
      for (const d of disposables) d.dispose();
    },
  };
}

/** a clump of 7 solid, V-folded, tapered blades (no alpha), root dark → tip light */
function needlegrassClump(root: Color, tip: Color): BufferGeometry {
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  const rand = mulberry(77);
  const SEG = 2;
  for (let b = 0; b < 7; b++) {
    const a = (b / 7) * Math.PI * 2 + rand() * 0.6;
    const r0 = b === 0 ? 0 : 0.05 + rand() * 0.12;
    const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0;
    const lean = 0.18 + rand() * 0.3;
    const h = 0.85 + rand() * 0.45;
    const w = 0.06 + rand() * 0.03;
    const dirx = Math.cos(a + 0.3), dirz = Math.sin(a + 0.3);
    const px = -dirz, pz = dirx;
    const ring: [number, number, number][][] = [];
    for (let k = 0; k <= SEG; k++) {
      const t = k / SEG;
      const cx = bx + dirx * lean * t * t * h, cz = bz + dirz * lean * t * t * h, cy = h * t;
      const ww = w * (1 - t * 0.92);
      ring.push([[cx - px * ww, cy, cz - pz * ww], [cx + dirx * ww * 0.35, cy, cz + dirz * ww * 0.35], [cx + px * ww, cy, cz + pz * ww]]);
    }
    for (let k = 0; k < SEG; k++) {
      const t0 = k / SEG, t1 = (k + 1) / SEG;
      for (let side = 0; side < 2; side++) {
        const a0 = ring[k][side], a1 = ring[k][side + 1], b0 = ring[k + 1][side], b1 = ring[k + 1][side + 1];
        const tris = [a0, a1, b1, a0, b1, b0];
        const ts = [t0, t0, t1, t0, t1, t1];
        for (let v = 0; v < 6; v++) {
          pos.push(...tris[v]);
          const c = root.clone().lerp(tip, Math.pow(ts[v], 0.8));
          col.push(c.r, c.g, c.b);
          nor.push(dirx * 0.35 * (side ? 1 : -1) + px * 0.2, 0.9, dirz * 0.35 + pz * 0.2);
        }
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  const n = new Float32Array(nor);
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]); n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  g.setAttribute('normal', new BufferAttribute(n, 3));
  return g;
}

/** Dialwood canopy: four chiselled, flat-faceted lobes; darker underneath, sun-warm on top */
function dialwoodCanopy(leaf: Color): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const lobes = [[0, 0.35, 0, 1.0], [0.55, 0.05, 0.25, 0.72], [-0.45, 0.1, -0.35, 0.78], [0.05, 0.75, -0.1, 0.62]];
  for (const [x, y, z, r] of lobes) {
    const g = new IcosahedronGeometry(r, 1);
    const p = g.getAttribute('position') as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (hash2(p.getX(i) * 3.1 + x, p.getZ(i) * 2.7 + p.getY(i)) - 0.5) * 0.28;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.82, p.getZ(i) * k);
    }
    g.translate(x, y, z);
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    n.deleteAttribute('uv');
    parts.push(n);
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  const pos = g.getAttribute('position') as BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  const c = new Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) + 0.6) / 2.0));
    c.copy(leaf).multiplyScalar(0.55 + 0.75 * t);
    c.r += 0.02 * t; // a touch warmer where the sun sits
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** a chiselled boulder (jittered icosahedron, flat facets) */
function rockGeometry(seed: number): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  const p = g.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.78 + hash2(x * 5.1 + seed, z * 4.3 + y * 3.7) * 0.4;
    p.setXYZ(i, x * k, Math.max(-0.3, y * k), z * k);
  }
  const n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  n.deleteAttribute('uv');
  n.computeVertexNormals();
  return n;
}
