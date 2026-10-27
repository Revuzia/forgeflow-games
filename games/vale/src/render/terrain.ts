// VALE render — procedural terrain from the map JSON (CONTRACT §0: terrain, scatter and trim are
// procedural-allowed). Used while `map.art.scene` is missing or empty (the art lane's Blender scene
// replaces it as soon as it loads). Everything is derived from MapDef, deterministically.
//
//   ground    one plane shaded per pixel from baked DISTANCE FIELDS (splat: lane, camp room, wall, brush;
//             splat2: Standing Shadow, Fallen Shaft, chasm; inlay: engraved / inlaid strokes) and three
//             painted tiling textures with height in alpha (terrain_litter / grain / moss, each
//             mapped so its MEAN lands on the designed band colour: the bible's value law holds).
//             `art.terrain.surface` picks the floor. Values are on-screen L* after the grade (tokens
//             grade.maps.*.valueLstar, r12 B5): the environment sits low and warm so fighters, effects and UI
//             own the top of the value range; the roads are the brightest terrain:
//               dial   RIFT: honed irregular dial-stone flags on the roads (L* 36–41, warm honey stone) with a
//                      carved inscription band and hour-ticks (≤ 46), broken mossy verges whose flags are lost
//                      to the wood flag by flag, a Dialwood floor of moss and fan-leaf litter with broad
//                      hue/value drifts (12–20) and the hour-line groove along every path, dusty camp rooms
//                      (30–35), moss banks and occlusion at every wall foot, the Seat, the Fallen Shaft's floor
//                      under its water (24–30).
//               span   BRIDGE: the fallen shaft's deck in long courses, honed palest along the road (36–41)
//                      and weathering darker toward the drop, a chalk band of carved hour-script on every edge
//                      of the drop (≤ 46), the Snap's crazing and lit fracture.
//               plate  FRAY: honed dial-stone slabs in rings at the Shadowless Noon (L* 34–40 in vision), the
//                      ten hour-lines and numerals inlaid dark, a carved hour-ring with half-hour ticks round
//                      the marks, the shop ring, a satin sheen.
//             Base plazas (art.terrain.plazas): Aubade chalk flags with dawnglass rings round the
//             fountain, Serenade ochre sandstone with lampresin. Roughness ≥ 0.5 everywhere walkable.
//   walls     every wall polygon swept course by course (terrain_walls.ts): dark cut stone in battered
//             horizontal courses with chunky chiselled blocks (12–16), a protruding cap course whose
//             chamfer carries the painted edge light (capped at L* 48), a carved lip (20–28), then moss and
//             canopy on top.
//             Heights from art.terrain.wallHeights (small / hourStones, large / rim, frame).
//             `wallStyle: "gorge"` (Needlespan): large walls are the gorge. The ground opens; the deck's
//             edges roll over into the shaft's curved needle-stone flank, then raw rock in strata falls
//             into the gorge's own height mist (pale haze under the rim → deep cool blue, applied after the fog
//             of war so the drop never goes to a black void); the far walls fall in terraces from a sunlit
//             lip; rock columns stand in the drop (parallax); three drifting mist banks lie in it, the deepest
//             with the river's faint glint; the hour-band notches stand proud as carved rings.
//   brush     Needlegrass: instanced clumps of SOLID tapered blades (no alpha cards) on a carved curb.
//   clutter   (quality 0 none · 1 half · 2 full) moss cushions, fallen fan leaves, pebbles, wall-foot
//             tufts: solid, instanced, chunked, no shadows; Dialwood floor only (never on roads, rooms,
//             plazas, the Seat or the Noonline; the deck and the Noonplate stay clean stages).
//   scatter   (quality 0 sparse · 1 half · 2 full) a dense Dialwood canopy on the cliff tops (lip hedge
//             rows + a body of larger crowns, each sized so it hides nothing walkable — see treeScale),
//             boulders at the cliff feet and stones on the jungle floor, needle fragments on Needlespan's
//             far lips; never in lanes, clearings or brush. A role the map lists EMPTY scatters nothing
//             (the Noonplate is a clean stage). Props read a gloss mask from COLOR_0's alpha.
//   marks     the Standing Shadow floor (violet-cool stone, hard engraved edge, keeps its colour under
//             fog) and the Fallen Shaft's shallow water.
// Instanced scatter is chunked (24 m cells) so off-screen chunks are culled from the main and shadow
// passes. Every material is patched with the world chunk (fog of war + edge haze).

import {
  BufferAttribute, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide, Group, IcosahedronGeometry,
  InstancedMesh, LinearFilter, type Material, Matrix4, Mesh, Raycaster, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, type Object3D, PlaneGeometry, Quaternion,
  RGBAFormat, Shape, ShapeGeometry, ShapeUtils, UnsignedByteType, type Texture, Vector2, Vector3, Vector4,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDefT } from '../contracts/catalog.ts';
import { NOISE_GLSL } from './glsl.ts';
import { FRAY_SEATS } from './palette.ts';
import { patchWorldMaterial, worldUniforms } from './world_material.ts';
import {
  GROUND_MAIN_GLSL, GROUND_PARS_GLSL, GROUND_SHEEN_GLSL, SHADOW_MAIN_GLSL, SHADOW_PARS_GLSL, TERRAIN_HELPERS_GLSL, WALL_MAIN_GLSL,
  GORGE_MIST_PARS, gorgeFogLift, gorgeMistApply, MIST_SHEET_MAIN, MIST_SHEET_PARS, WALL_PARS_GLSL, WALL_VERT_MAIN, WALL_VERT_PARS,
} from './terrain_glsl.ts';
import { bandRing, cliffProfile, farWallProfile, flankProfile, type Strip, sweep, WallMesh, WK } from './terrain_walls.ts';
import { bakeInlay, fracture, hourScript, INLAY, INLAY_GLSL, mulberry as mulberryI, numeral, roadTicks, StrokeSet } from './terrain_inlay.ts';
import { bladeTuft, fanLeaf, mossTuft, pebble, rockStack } from './terrain_clutter.ts';
import { BrushField, GRASS_VERT_MAIN, GRASS_VERT_PARS, motionDepthMaterial, TREE_SWAY_MAIN, TREE_SWAY_PARS } from './terrain_brush.ts';

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

/** merge polygons that share a whole edge into one outline (all oriented alike first, so a shared edge runs
 *  P→Q in one and Q→P in the other); polygons that touch nowhere pass through unchanged */
function mergeShared(polys: Poly[]): Poly[] {
  const same = (a: V2, b: V2): boolean => Math.abs(a[0] - b[0]) < 1e-3 && Math.abs(a[1] - b[1]) < 1e-3;
  const out: V2[][] = polys.map((p) => (signedArea(p) < 0 ? [...p].reverse() : [...p]));
  for (let guard = 0; guard < 32; guard++) {
    let merged = false;
    search: for (let a = 0; a < out.length; a++) for (let b = a + 1; b < out.length; b++) {
      const A = out[a], B = out[b];
      for (let i = 0; i < A.length; i++) {
        const P = A[i], Q = A[(i + 1) % A.length];
        for (let j = 0; j < B.length; j++) {
          if (!same(B[j], Q) || !same(B[(j + 1) % B.length], P)) continue;
          const ring: V2[] = [];
          for (let k = 1; k <= A.length; k++) ring.push(A[(i + k) % A.length]);   // Q … P round A
          for (let k = 2; k < B.length; k++) ring.push(B[(j + k) % B.length]);    // on round B, back to Q
          out[a] = ring; out.splice(b, 1);
          merged = true;
          break search;
        }
      }
    }
    if (!merged) break;
  }
  return out;
}

/** where the plane y = ys cuts a triangle soup (xyz positions, optional index): segments appended to `out` as
 *  x0, z0, x1, z1 */
function sliceAt(pos: ArrayLike<number>, index: ArrayLike<number> | null, ys: number, out: number[]): void {
  const n = index ? index.length : pos.length / 3;
  const pts: number[] = [];
  for (let t = 0; t + 2 < n; t += 3) {
    const a = (index ? index[t] : t) * 3, b = (index ? index[t + 1] : t + 1) * 3, c = (index ? index[t + 2] : t + 2) * 3;
    const da = pos[a + 1] - ys, db = pos[b + 1] - ys, dc = pos[c + 1] - ys;
    if ((da >= 0 && db >= 0 && dc >= 0) || (da < 0 && db < 0 && dc < 0)) continue;
    pts.length = 0;
    for (const [p, q, dp, dq] of [[a, b, da, db], [b, c, db, dc], [c, a, dc, da]]) {
      if ((dp >= 0) === (dq >= 0)) continue;
      const s = dp / (dp - dq);
      pts.push(pos[p] + (pos[q] - pos[p]) * s, pos[p + 2] + (pos[q + 2] - pos[p + 2]) * s);
    }
    if (pts.length >= 4) out.push(pts[0], pts[1], pts[2], pts[3]);
  }
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
function chunked(geo: BufferGeometry, mat: Material, items: { m: Matrix4; c?: Color }[], name: string, shadows = true,
  depth?: Material, renderOrder = 0): Group {
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
    if (depth) im.customDepthMaterial = depth;
    im.renderOrder = renderOrder;
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
  shadowLine: string; water: string; litter: string; pebble: string; canopy: string; glare: string;
}
const DEFAULT_COLORS: TerrainColors = {
  lane: '#9A927F', laneGrout: '#6F685A', verge: '#7C7666', jungle: '#4E5547', moss: '#475A43', earth: '#5C5446', clearing: '#8A8576',
  inscription: '#B7B0A0', cliffTop: '#5E6450', cliffFace: '#45423C', cliffLip: '#8E8979', edgeLight: '#D8D0BC', curb: '#8A8476',
  grassRoot: '#2F3B30', grassTip: '#9AA478', leaf: '#3F5A45', trunk: '#4A3F36', stone: '#77726A', chasm: '#2A2D33', mist: '#5E6C93',
  flank: '#5D5A55', rock: '#4A4C52', shaftFloor: '#A4A69E', seat: '#B4AE9E', plazaAubade: '#B3B1A8', plazaSerenade: '#AF9A78',
  inlayAubade: '#BFD3E6', inlaySerenade: '#C99A5E', midInlay: '#5F5D58', lit: '#FFE2B8', shadowLine: '#7A7396', water: '#4F6B70',
  litter: '#6A5434', pebble: '#7A766D', canopy: '#8E9A60', glare: '#E9E6DF',
};
/** linear luminance (Rec.709) of a linear colour */
const lum = (c: Color): number => c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
/** the colour scaled down (hue kept) so its luminance is at most `max` */
function capLum(c: Color, max: number): Color {
  const l = lum(c);
  return l > max && l > 0 ? c.multiplyScalar(max / l) : c;
}
/** the painted edge light's ceiling over the road's albedo luminance (tokens grade.maps: lanes L* 36-41, edge light
 *  ≤ 48). Y(48) / Y(41) = 1.41 on a flat surface, but the chamfers that face the sun catch more light than the road
 *  and Low draws them without AO: 1.2 keeps their brightest pixels at or under L* 48 on every map and tier
 *  (_harness/value_probe.mjs, mask `edge`, 1080p High and 720p Low) */
const EDGE_OVER_ROAD = 1.2;
/** map.art.terrain.propValue: linear value multipliers that land authored and procedural props in the map's bands
 *  (tree, rock, stone, clutter, landmark; default 1). A landmark entry's own `value` multiplies its map's. */
interface PropValue { tree: number; rock: number; stone: number; clutter: number; landmark: number }
function propValueOf(terrain: Record<string, unknown> | undefined): PropValue {
  const src = (terrain?.propValue && typeof terrain.propValue === 'object' ? terrain.propValue : {}) as Record<string, unknown>;
  const v = (k: keyof PropValue): number => (typeof src[k] === 'number' && Number.isFinite(src[k]) && (src[k] as number) > 0 ? (src[k] as number) : 1);
  return { tree: v('tree'), rock: v('rock'), stone: v('stone'), clutter: v('clutter'), landmark: v('landmark') };
}
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
  /** the Needlegrass's unit field (r12 M11, terrain_brush.ts): the renderer feeds it the units the viewer sees
   *  every frame; null when the map has no thickets */
  brush: BrushField | null;
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
 *  node transforms applied); null when the map names none. An explicitly EMPTY list (e.g. "rock": []) means
 *  "scatter nothing" for that role (an empty entry in the result); a role the map leaves out, or whose GLBs
 *  all fail, keeps the procedural shapes.
 *  GLOSS (shared interface with the props lane): the alpha of COLOR_0 is a per-vertex gloss mask (1 =
 *  lacquered leaf, 0 = bark / stone), read by propMaterial(). A GLB whose alpha is 1 everywhere carries no
 *  mask (an exporter's opaque default), so it is dropped and the prop stays matte, as before. */
export async function loadTerrainProps(map: MapDefT, load: (ref: string) => Promise<{ gltf: { scene: import('three').Object3D }; renderable: boolean } | null>):
  Promise<Partial<Record<TerrainPropRole, BufferGeometry[]>> | null> {
  const refs = ((map.art.terrain ?? {}) as { props?: Record<string, unknown> }).props ?? {};
  const out: Partial<Record<TerrainPropRole, BufferGeometry[]>> = {};
  let any = false;
  for (const role of TERRAIN_PROP_ROLES) {
    if (Array.isArray(refs[role]) && (refs[role] as unknown[]).length === 0) { out[role] = []; any = true; continue; }
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
      if (!parts.length) return null;
      // one colour layout per prop: the gloss alpha survives only if some part really carries a mask
      const masked = parts.some((g) => {
        const c = g.getAttribute('color');
        if (!c || c.itemSize !== 4) return false;
        for (let k = 0; k < c.count; k++) if (c.getW(k) < 0.999) return true;
        return false;
      });
      for (const g of parts) {
        const c = g.getAttribute('color');
        if (!c) continue;
        if (c.itemSize === 4 && masked) continue;
        const a = new Float32Array(c.count * (masked ? 4 : 3));
        for (let k = 0; k < c.count; k++) {
          const o = k * (masked ? 4 : 3);
          a[o] = c.getX(k); a[o + 1] = c.getY(k); a[o + 2] = c.getZ(k);
          if (masked) a[o + 3] = 0;
        }
        g.setAttribute('color', new BufferAttribute(a, masked ? 4 : 3));
      }
      return parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
    }).filter((g): g is BufferGeometry => !!g);
    if (geos.length) { out[role] = geos; any = true; }
  }
  return any ? out : null;
}

/** the material every scatter prop draws with (instanced, vertex-coloured), MATTE (r12 M11): roughness 0.86 (bark,
 *  stone, fan plates alike). COLOR_0's alpha is still read as the gloss mask (the props lane's interface), but a
 *  masked vertex only goes down to roughness 0.75 and there is no clearcoat lobe any more: the old lacquer
 *  (0.42 + a clearcoat) made one wet hot spot per crown. The Dialwood props carry a mask of 0 since M11.
 *  `sway`: the Dialwood's crowns move (terrain_brush.ts TREE_SWAY_MAIN: tip ≤ 4 cm at 0.2–0.4 Hz, per-tree
 *  phase, weighted by height); rocks and stones never do. One program per kind, no extra draws. */
function propMaterial(sway = false): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
  const u = { uSwayT: worldUniforms.valeTime };
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
#ifdef USE_COLOR_ALPHA
  roughnessFactor = mix( roughnessFactor, 0.75, clamp( vColor.a, 0.0, 1.0 ) );
#endif`);
    if (sway) {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${TREE_SWAY_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${TREE_SWAY_MAIN}`);
    }
  };
  m.customProgramCacheKey = () => (sway ? 'vale_prop_matte_sway_v3' : 'vale_prop_matte_v3');
  return m;
}

/** load map.art.terrain.landmarks entries that name a `model` (real-size GLB, origin at its ground
 *  contact) and stand each at its `at` (map x, y) on the ground there (a cliff block's top inside a wall),
 *  turned `rot` degrees about the vertical; flush entries
 *  carry no model. The models are shared with the asset cache, so callers drop them without disposing. */
export async function loadTerrainLandmarks(map: MapDefT, load: (ref: string) => Promise<{ gltf: { scene: Object3D }; renderable: boolean } | null>,
  ground: (x: number, y: number) => number = () => 0): Promise<Object3D[]> {
  const list = ((map.art.terrain ?? {}) as { landmarks?: unknown }).landmarks;
  if (!Array.isArray(list)) return [];
  const pv = propValueOf(map.art.terrain as Record<string, unknown> | undefined);
  const out: Object3D[] = [];
  await Promise.all(list.map(async (raw: unknown) => {
    const l = raw as { model?: unknown; at?: unknown; rot?: unknown; value?: unknown };
    if (typeof l.model !== 'string' || !Array.isArray(l.at)) return;
    const m = await load(l.model);
    if (!m?.renderable) return;
    const o = m.gltf.scene.clone();
    const x = Number(l.at[0]), y = Number(l.at[1]);
    o.position.set(x, ground(x, y), y);
    o.rotation.y = typeof l.rot === 'number' ? (l.rot * Math.PI) / 180 : 0;
    // its value band (propValue.landmark × its own `value`): the albedo scales, an authored lamp's emissive never
    // does; the materials are the asset cache's, so a scaled landmark draws with its own copies
    const k = pv.landmark * (typeof l.value === 'number' && Number.isFinite(l.value) && l.value > 0 ? l.value : 1);
    const own = new Map<Material, Material>();
    const valued = (mat: Material): Material => {
      if (k === 1 || !(mat as MeshStandardMaterial).color) return mat;
      let c = own.get(mat);
      if (!c) { c = mat.clone(); (c as MeshStandardMaterial).color.multiplyScalar(k); own.set(mat, c); }
      return c;
    };
    o.traverse((c) => {
      const mesh = c as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(valued) : valued(mesh.material);
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
  const pv = propValueOf(tr);
  // r12 B5: the painted edge light (the cap course's chamfer, the hour-band ticks, the gorge's lit lip) never
  // lifts above L* 48 on screen, whatever the map paints: its albedo luminance is capped against the road's (the
  // plate's, the deck's), EDGE_OVER_ROAD
  const edgeLight = capLum(lin(colors.edgeLight), lum(lin(colors.lane)) * EDGE_OVER_ROAD);
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
  // chasm polygons that share an edge (Needlespan's gorge is split in two at the Snap's meridian) are ONE drop:
  // merged into one outline, so no flank is swept along the internal seam, no hour-script is carved on it, the
  // chasm field runs on through it, and the far wall and the flank stay continuous across it
  const chasmPolys = mergeShared(walls.filter((_, i) => chasm[i]));
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
      let wd = 8, wi = 0;
      for (const { w, b } of solidWalls) {
        if (boxDist(x, y, b) >= wd) continue;
        if (pointInPolygon(x, y, w)) { wd = 0; wi = Math.min(4, polyEdgeDist(x, y, w)); break; }
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
      splat2[o + 2] = Math.round((wi / 4) * 255);
      splat2[o + 3] = Math.round(((ch + 4) / 8) * 255);
    }
  }
  const field = (f: Float32Array, x: number, y: number): number => {
    const i = Math.min(W - 1, Math.max(0, Math.round(x / texel))), j = Math.min(H - 1, Math.max(0, Math.round(y / texel)));
    return f[j * W + i];
  };
  const mkTex = (data: Uint8Array, w = W, h = H): DataTexture => {
    const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
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
    // (the Standing Shadow's tip is the shadow's own point: SHADOW_MAIN_GLSL's core wedge, no glyph)
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
      // a jagged crack (not a dashed centre-line): wide in the middle, pinching out toward both ends
      const main = fracture([snapAt[0] - 0.6, snapAt[1] - snapR - 2], [snapAt[0] + 0.6, snapAt[1] + snapR + 2], 2.4, 7, rnd);
      const L = main.length - 1;
      for (let i = 1; i <= L; i++) {
        const t = (i - 0.5) / L;
        const w = 0.05 + 0.1 * Math.pow(Math.sin(Math.PI * t), 0.7) * (0.75 + 0.5 * rnd());
        strokes.seg(main[i - 1], main[i], w, INLAY.lit);
      }
      const inSnap = (p: V2): boolean => Math.hypot(p[0] - snapAt[0], p[1] - snapAt[1]) < snapR - 0.3;
      for (let k = 0; k < 30; k++) {
        const s = main[Math.floor(rnd() * main.length)];
        const ang = (rnd() < 0.5 ? 0 : Math.PI) + (rnd() - 0.5) * 1.7;
        const len = 1.4 + rnd() * 4.8;
        const end: V2 = [s[0] + Math.cos(ang) * len, s[1] + Math.sin(ang) * len];
        const br = fracture(s, end, len * 0.2, 5, rnd);
        // crazing tapers from the crack outward
        for (let i = 1; i < br.length; i++) if (inSnap(br[i]) && inSnap(br[i - 1])) strokes.seg(br[i - 1], br[i], 0.06 - 0.025 * (i / br.length), INLAY.groove);
        if (rnd() < 0.6) {
          const m = br[Math.floor(br.length / 2)];
          const a2 = ang + (rnd() - 0.5) * 1.8, l2 = len * 0.45;
          const b2 = fracture(m, [m[0] + Math.cos(a2) * l2, m[1] + Math.sin(a2) * l2], l2 * 0.22, 4, rnd);
          for (let i = 1; i < b2.length; i++) if (inSnap(b2[i]) && inSnap(b2[i - 1])) strokes.seg(b2[i - 1], b2[i], 0.04, INLAY.groove);
        }
      }
    }
    for (const p of map.pickups ?? []) { strokes.circle(p.at as unknown as V2, 0.85, 0.06, INLAY.groove, 0.2); strokes.circle(p.at as unknown as V2, 0.55, 0.04, INLAY.groove, 0.2); }
  } else {
    // the Noonplate: inlaid hour-lines from the cart ring to every hour-mark, the marks' numerals
    (map.spawns ?? []).forEach((s, k) => {
      const dx = s[0] - plateAt[0], dy = s[1] - plateAt[1], l = Math.hypot(dx, dy) || 1;
      const ux = dx / l, uy = dy / l;
      strokes.seg([plateAt[0] + ux * 4.35, plateAt[1] + uy * 4.35], [plateAt[0] + ux * (l - 2.75), plateAt[1] + uy * (l - 2.75)], 0.15, INLAY.chalk);
      // centred a little inward of the spawn, so the ring stays clear of the rim (the rim's 2.4 m lip
      // overhangs the plate by ~1.6 m in screen space on the camera's far side)
      numeral(strokes, [s[0] - ux * 0.35, s[1] - uy * 0.35], k + 1, 1.8, 0.16, INLAY.chalk);
      strokes.circle([s[0] - ux * 0.35, s[1] - uy * 0.35], 1.62, 0.14, INLAY.lit, 0.3);
    });
    strokes.circle(plateAt, 4.0, 0.22, INLAY.mid, 0.3);
    strokes.circle(plateAt, plateR - 0.75, 0.18, INLAY.chalk, 0.4);
    // the carved hour-ring: a chapter ring cut round the ten marks (a double groove inside them, one outside),
    // a half-hour tick cut across it between every two marks
    const sp0 = (map.spawns ?? [])[0];
    const rm = sp0 ? Math.hypot(sp0[0] - plateAt[0], sp0[1] - plateAt[1]) - 0.35 : plateR * 0.855;
    strokes.circle(plateAt, rm - 2.25, 0.07, INLAY.groove, 0.3);
    strokes.circle(plateAt, rm - 1.95, 0.07, INLAY.groove, 0.3);
    strokes.circle(plateAt, rm + 2.05, 0.08, INLAY.groove, 0.3);
    const nM = (map.spawns ?? []).length;
    for (let k = 0; k < nM; k++) {
      const s0 = map.spawns[k], s1 = map.spawns[(k + 1) % nM];
      const a0 = Math.atan2(s0[1] - plateAt[1], s0[0] - plateAt[0]), a1 = Math.atan2(s1[1] - plateAt[1], s1[0] - plateAt[0]);
      let da = a1 - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const am = a0 + da / 2, ux = Math.cos(am), uy = Math.sin(am);
      strokes.seg([plateAt[0] + ux * (rm - 1.95), plateAt[1] + uy * (rm - 1.95)], [plateAt[0] + ux * (rm + 2.05), plateAt[1] + uy * (rm + 2.05)], 0.07, INLAY.groove);
      for (const f of [0.25, 0.75]) {
        const aq = a0 + da * f, qx = Math.cos(aq), qy = Math.sin(aq);
        strokes.seg([plateAt[0] + qx * (rm + 1.35), plateAt[1] + qy * (rm + 1.35)], [plateAt[0] + qx * (rm + 2.05), plateAt[1] + qy * (rm + 2.05)], 0.06, INLAY.groove);
      }
    }
    for (const p of map.pickups ?? []) { strokes.circle(p.at as unknown as V2, 0.85, 0.2, INLAY.mid, 0.15); strokes.circle(p.at as unknown as V2, 0.45, 0.14, INLAY.chalk, 0.12); }
  }
  const inlay = bakeInlay(strokes, [SX, SY], 0.125);
  disposables.push(inlay.tex, inlay.fine, inlay.index);
  const inlayU = {
    uInlay: { value: inlay.tex }, uInlayFine: { value: inlay.fine }, uInlayIdx: { value: inlay.index },
    uInlayScale: { value: new Vector2(inlay.scale[0], inlay.scale[1]) }, uInlayFineP: { value: new Vector4(...inlay.fineP) },
    uInlayAtlas: { value: new Vector2(inlay.atlas[0], inlay.atlas[1]) },
  };

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
  // the Fallen Shaft's fragments lie along its fall: the floor polygon's principal axis
  const axisOf = (polys: Poly[]): Vector4 => {
    let n = 0, cx = 0, cy = 0;
    for (const q of polys) for (const [x, y] of q) { cx += x; cy += y; n++; }
    if (!n) return new Vector4(0, 0, 0, 1);
    cx /= n; cy /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of polys) for (const [x, y] of q) { sxx += (x - cx) ** 2; syy += (y - cy) ** 2; sxy += (x - cx) * (y - cy); }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return new Vector4(cx, cy, Math.cos(a), Math.sin(a));
  };
  const roomU = Array.from({ length: 16 }, (_, k) => (rooms[k] ? new Vector4(rooms[k].x, rooms[k].y, rooms[k].r, 0) : new Vector4()));
  const gu = {
    ...shared, ...inlayU,
    uSplat: { value: splatTex }, uSplat2: { value: splat2Tex },
    uSplatScale: { value: new Vector2(1 / (W * texel), 1 / (H * texel)) },
    uLaneHalf: { value: LANE_HALF },
    uRooms: { value: roomU }, uRoomN: { value: Math.min(16, rooms.length) }, uShaftAx: { value: axisOf(shaftPolys) },
    // the plate's satin sky sheen: a cool emissive at ~10 % of the plate's own albedo luminance (it rides on the
    // plate's value band, so rebasing the plate rebases its sheen)
    uSheenC: { value: ((s: Color) => s.multiplyScalar((0.1 * lum(lin(colors.lane))) / Math.max(1e-4, lum(s))))(lin('#9FB0C4')) },
    uRockC: { value: lin(colors.rock) },
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
      .replace('#include <common>', `#include <common>\n#define ${styleDef}\n${gorge ? '#define VALE_GORGE\n' : ''}${GROUND_PARS_GLSL}\n${NOISE_GLSL}\n${INLAY_GLSL}\n${TERRAIN_HELPERS_GLSL}`)
      .replace('#include <map_fragment>', GROUND_MAIN_GLSL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmit;\n${GROUND_SHEEN_GLSL}`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, gHeight, 1.0 );');
  };
  groundMat.customProgramCacheKey = () => `vale_ground_v8_${surface}${gorge ? '_g' : ''}`;
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
  const marks = (Array.isArray(tr.landmarks) ? (tr.landmarks as { model?: unknown; at?: unknown; size?: unknown; height?: unknown }[]) : [])
    .filter((l) => typeof l.model === 'string' && Array.isArray(l.at))
    .map((l) => {
      const at = l.at as number[], sz = Array.isArray(l.size) ? (l.size as number[]) : [2, 2];
      return { x: at[0], y: at[1], sx: sz[0] / 2, sy: sz[1] / 2, h: num(l.height) ?? 3 };
    });
  // loose stones keep off a landmark's footprint and the strip in front of it (camera side, +y)
  const onMark = (x: number, y: number): boolean => marks.some((m) => Math.abs(x - m.x) < m.sx + 1.0 && y > m.y - m.sy - 1.0 && y < m.y + m.sy + 2);
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
  // the Noonplate's corner walls ARE its rim: drawn as one true circle (r = the plate's radius, identical every
  // 36°) with the noon glare beyond, never as four jittered polygons seamed where they meet
  const plateFrame = walls.map((w, i) => surface === 'plate' && !chasm[i] && Math.abs(signedArea(w)) >= 25);
  walls.forEach((poly, i) => {
    if (chasm[i] || replaced[i]) { wallHeights.push(0); return; }
    const area = Math.abs(signedArea(poly));
    const small = area < 25;
    const h = plateFrame[i] ? RH : small ? (smallH ?? 1.6 + 0.6 * hash2(i, area)) : (largeH ?? 2.6 + 0.8 * hash2(i * 3.1, area));
    wallHeights.push(h);
    if (plateFrame[i]) return;
    const seed = 1 + ((i * 0.618034) % 1) * 9;
    const outline = organicOutline(poly, 0.9, small ? 0.06 : 0.28, [SX, SY], i * 7.3);
    if (outline.length < 3) return;
    const prof = cliffProfile(h, i * 7.3 + 1, small);
    sweep(wm, outline, prof.strips, { closed: true, ccw: signedArea(outline) > 0, seed, chisel: small ? 0.05 : 0.16, pinned: onBorder }, h);
    wm.cap(outline, prof.topY, [0, 0, 0, WK.top], [1, seed, prof.topY, h]);
  });
  const RIM = 14;
  if (surface === 'plate') {
    if (plateFrame.some(Boolean)) {
      const n = Math.max(96, Math.ceil((2 * Math.PI * plateR) / 0.6));
      const circ: V2[] = [];
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; circ.push([plateAt[0] + Math.cos(a) * plateR, plateAt[1] + Math.sin(a) * plateR]); }
      const prof = cliffProfile(RH, 101, false);
      // ccw false: the face looks inward, at the plate
      sweep(wm, circ, prof.strips, { closed: true, ccw: false, seed: 3, chisel: 0 }, RH);
      const hr = plateR + 0.3;
      const hole = circ.map(([x, y]): V2 => [plateAt[0] + ((x - plateAt[0]) * hr) / plateR, plateAt[1] + ((y - plateAt[1]) * hr) / plateR]);
      wm.cap([[-RIM, -RIM], [SX + RIM, -RIM], [SX + RIM, SY + RIM], [-RIM, SY + RIM]], prof.topY, [0, 0, 0, WK.top], [1, 3, prof.topY, RH], [hole]);
    }
  } else {
    // outer rim: a carved wall all around the playable plate (gorge maps: only the terrace ends)
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
  }
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
  const stackPos: number[] = [], stackIdx: number[] = [];
  /** the gorge's own triangles in the wall mesh (flank, far walls, bands): the mist banks fade where they cut them */
  const gorgeV0 = wm.pos.length;
  let gorgeV1 = gorgeV0;
  if (gorge) {
    const flankStrips = flankProfile(gorgeDepth, 7);
    const rockExtra = (x: number, y: number, h: number): number => (h < -5.5 ? ((vnoise(x * 0.16, h * 0.09 + y * 0.1) - 0.5) * 3.2 + (vnoise(x * 0.5 + 3, h * 0.3) - 0.5) * 1.0) * Math.min(1, (-h - 5.5) / 6) : 0);
    // far walls: buttresses and gullies stand out of the face below the rim, more with depth (a silhouette
    // and real light/shadow, not a flat painted wall); negative = toward the gorge
    const farExtra = (x: number, y: number, h: number, u: number, lk: number): number => {
      const t = Math.min(1, Math.max(0, (-h - 0.6) / 4.5));
      const b = (vnoise(u * 0.19 + 3.3, 1.7) - 0.5) * 4.2 + (vnoise(u * 0.55 + 9.1, h * 0.05 + 2) - 0.5) * 1.6 + (vnoise(u * 1.3, h * 0.2) - 0.5) * 0.5;
      // each terrace's ledge widens and narrows along the wall (−0.4…+0.9 m), so no bench is a constant band
      let lw = 0;
      for (let l = 0; l < lk; l++) lw += (vnoise(u * 0.085 + l * 7.31, l * 1.7 + 0.5) - 0.3) * 1.3 * Math.min(1, lk - l);
      return -(b * t) - lw + rockExtra(x, y, h) * 0.5;
    };
    // the terraces dip and rise along the wall (no bench runs level for 150 m: that reads as a contour line):
    // up to ±2.4 m, eased in below the lip so the rim stays at the plateau
    const farDip = (_x: number, _y: number, h: number, u: number): number => {
      const k = Math.min(1, Math.max(0, (-h - 1.0) / 4.0));
      return ((vnoise(u * 0.045 + 7.7, 3.1) - 0.5) * 3.6 + (vnoise(u * 0.13 + 1.9, 8.3) - 0.5) * 1.2) * k;
    };
    chasmPolys.forEach((poly0, k) => {
      const ccw = signedArea(poly0) > 0;
      // hour-band notches: vertex runs strictly inside the deck strip. The deck edge (and its flank) runs
      // straight across each notch; the band's ring stands on it
      const inStrip = (p: V2): boolean => Math.abs(p[1] - axisY) < deckHalf - 0.05;
      const notches: V2[][] = [];
      for (let i = 0, n0 = poly0.length; i < n0; i++) {
        if (inStrip(poly0[i]) || !inStrip(poly0[(i + 1) % n0])) continue;
        const notch: V2[] = [poly0[i]];
        let j = (i + 1) % n0;
        while (inStrip(poly0[j]) && notch.length < n0) { notch.push(poly0[j]); j = (j + 1) % n0; }
        notch.push(poly0[j]);
        if (notch.length >= 4) notches.push(notch);
      }
      const poly = poly0.filter((p) => !inStrip(p));
      const n = poly.length;
      // classify edges: map-border edges are far walls (rock falls from the rim), the rest are deck edges
      const isBorderEdge = (i: number): boolean => {
        const a = poly[i], b = poly[(i + 1) % n];
        return onBorder(a[0], a[1]) && onBorder(b[0], b[1]) && (Math.abs(a[0] - b[0]) < 0.01 || Math.abs(a[1] - b[1]) < 0.01);
      };
      // start the walk where the edge kind changes, so runs never wrap and a far wall stays one sweep
      let s0 = 0;
      for (let i = 0; i < n; i++) if (isBorderEdge(i) !== isBorderEdge((i - 1 + n) % n)) { s0 = i; break; }
      let run: V2[] = [];
      let runBorder: boolean | null = null;
      const flush = (): void => {
        if (run.length >= 2) {
          if (runBorder) {
            const line = resample(run, 1.0);
            sweep(wm, line, farWallProfile(gorgeDepth, 11 + k), { closed: false, ccw, seed: 20 + k, chisel: 0.5, extra: farExtra, yExtra: farDip, taper: 1.5 }, 0);
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
      // carved hour-bands: each a ring of the shaft, swept across the notch: a low inner face toward the deck,
      // a crown rising to bandH at the edge, rolling over it and down the flank, proud of it; both ends cut
      // square (planar caps, so the gorge never shows through), rounded shoulders in the normals
      notches.forEach((notch, m) => {
        const a = notch[0], b = notch[notch.length - 1];
        const dx = b[0] - a[0], dy = b[1] - a[1], cl = Math.hypot(dx, dy) || 1;
        const tx = dx / cl, ty = dy / cl;
        const nx = ccw ? dy / cl : -dy / cl, ny = ccw ? -dx / cl : dx / cl;   // into the deck
        let D = 0;
        for (const q of notch) D = Math.max(D, (q[0] - a[0]) * nx + (q[1] - a[1]) * ny);
        const ext = 0.08;
        const a2: V2 = [a[0] - tx * ext, a[1] - ty * ext], b2: V2 = [b[0] + tx * ext, b[1] + ty * ext];
        const Wd = cl + 2 * ext;
        const ring = bandRing(D + 0.06, bandH);
        sweep(wm, resample([a2, b2], 0.3), ring.strips, { closed: false, ccw, seed: 60 + k * 7 + m, chisel: 0, roundEnds: 0.45 }, Wd);
        for (const [e, sg, uu] of [[a2, -1, 0], [b2, 1, Wd]] as const) {
          wm.planar(ring.section, (q) => [e[0] + nx * q[0], q[1], e[1] + ny * q[0]], [tx * sg, 0, ty * sg],
            () => [uu, 0, 0, WK.band], (q) => [1, 60 + k * 7 + m, q[1], Wd]);
        }
      });
    });
    gorgeV1 = wm.pos.length;
    // rock stacks standing in the gorge (parallax: the drop reads deep as the camera moves): bedded, weathered
    // columns, their tops well under the rim, one merged mesh
    const sp = mulberry(777);
    for (let k = 0; k < Math.round(SX * SY * 0.008); k++) {
      const x = sp() * SX, y = sp() * SY;
      const a = sp(), b = sp(), c = sp();
      if (field(F.ch, x, y) < 2.8) continue;
      if (y < 2 || y > SY - 2) continue;
      const top = -3 - a * a * 8;
      const w = 2.0 + b * 2.8;
      rockStack(stackPos, stackIdx, x, y, top, -30, w, 900 + k * 13 + Math.floor(c * 7));
    }
  }
  const wallGeo = wm.geometry();
  const wallMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
  const wu = {
    ...shared,
    uFace: { value: lin(colors.cliffFace) }, uLip: { value: lin(colors.cliffLip) }, uEdgeLight: { value: edgeLight },
    uTop: { value: lin(colors.cliffTop) }, uMossC: { value: lin(colors.moss) }, uFlank: { value: lin(colors.flank) }, uRock: { value: lin(colors.rock) },
    // the gorge's height mist (brief: #5E6C93, 0.06/m below −2 m, near-solid by −25 m): a paler sunlit haze under
    // the rim, the deep cool blue below
    uMistHi: { value: lin(colors.mist).multiplyScalar(0.5) }, uMistLo: { value: lin(colors.mist).multiplyScalar(0.17) },
    uMistK: { value: gorge ? 0.06 : 0 }, uEarthC: { value: lin(colors.earth) },
    uStoneTop: { value: surface === 'plate' ? 1 : gorge ? 2 : 0 }, uCanopy: { value: lin(colors.canopy) },
    uSplat2: { value: splat2Tex }, uSplatScale: gu.uSplatScale,
    uTexGrain: tex.grain, uTexMoss: tex.moss, uTexLitter: tex.litter,
  };
  wallMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, wu);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WALL_VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${WALL_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${WALL_PARS_GLSL}\n${GORGE_MIST_PARS}\n${NOISE_GLSL}\n${TERRAIN_HELPERS_GLSL}`)
      .replace('#include <map_fragment>', WALL_MAIN_GLSL)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = cRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, cH, 1.0 );')
      .replace('#include <opaque_fragment>', `${gorgeFogLift('vCliffW')}\n#include <opaque_fragment>\n${gorgeMistApply('vCliffW')}`);
  };
  wallMat.customProgramCacheKey = () => 'vale_walls_v10';
  patchWorldMaterial(wallMat);
  const wallMesh = new Mesh(wallGeo, wallMat);
  wallMesh.castShadow = true; wallMesh.receiveShadow = true; wallMesh.name = 'vale_cliffs';
  group.add(wallMesh);
  disposables.push(wallGeo, wallMat);

  // gorge extras: rock columns standing in the drop (parallax as the camera moves) and drifting mist banks
  if (gorge) {
    const spGeo = new BufferGeometry();
    spGeo.setAttribute('position', new BufferAttribute(new Float32Array(stackPos), 3));
    spGeo.setIndex(stackIdx);
    spGeo.computeVertexNormals();
    spGeo.computeBoundingSphere();
    const spMat = new MeshStandardMaterial({ color: lin(colors.rock), roughness: 0.92 });
    const mistU = { uMistHi: wu.uMistHi, uMistLo: wu.uMistLo, uMistK: wu.uMistK, uMossC: wu.uMossC, uTexGrain: tex.grain };
    spMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, mistU);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform vec3 uMossC; uniform sampler2D uTexGrain;\n${GORGE_MIST_PARS}\n${NOISE_GLSL}\n${TERRAIN_HELPERS_GLSL}`)
        // weathered bedded rock: per-bed tone (the geometry carries the beds), fine laminations that fade out
        // before they alias, grain, damp streaks; up-facing caps and ledges pale and mossy
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 wq = vValeWorld;
  vec2 fq = vec2( wq.x + wq.z, wq.y );
  vec4 tq = texture( uTexGrain, fq / 4.0 );
  float lam = fract( wq.y / 0.55 + valeNoise( wq.xz * 0.5 ) * 0.6 );
  float fwl = fwidth( wq.y / 0.55 );
  float lamL = ( 1.0 - smoothstep( 0.0, 0.1 + fwl, min( lam, 1.0 - lam ) ) ) * ( 1.0 - smoothstep( 0.08, 0.25, fwl ) );
  diffuseColor.rgb *= ( 0.8 + 0.3 * valeNoise( vec2( wq.y * 0.45, wq.x * 0.3 + wq.z * 0.3 ) ) ) * mix( vec3( 1.0 ), tq.rgb / valeTexMean( uTexGrain ), 0.7 );
  diffuseColor.rgb *= 1.0 - 0.18 * lamL;
  diffuseColor.rgb *= 1.0 - 0.25 * smoothstep( 0.62, 0.9, valeNoise( vec2( fq.x * 1.3, wq.y * 0.12 ) ) );
  vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float cap = smoothstep( 0.55, 0.9, dot( normalize( vNormal ), upV ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, mix( diffuseColor.rgb * 1.5, uMossC * 0.75, 0.45 ), cap );
}`)
        .replace('#include <opaque_fragment>', `${gorgeFogLift('vValeWorld')}\n#include <opaque_fragment>\n${gorgeMistApply('vValeWorld')}`);
    };
    spMat.customProgramCacheKey = () => 'vale_stack_v1';
    patchWorldMaterial(spMat);
    if (stackIdx.length) {
      const stacks = new Mesh(spGeo, spMat);
      stacks.name = 'vale_rock_stacks'; stacks.receiveShadow = true;
      group.add(stacks);
    }
    disposables.push(spGeo, spMat);

    // mist banks: three translucent sheets lying in the drop (a sunlit one just under the rim, a cooler one,
    // the deep one with the river's glint far below); unlit, no shadows, drawn after the opaque world
    const mistC = lin(colors.mist);
    const sheets: { y: number; a: number; drift: number; river: number; scale: number; c: Color }[] = [
      { y: -5.5, a: 0.26, drift: 0.05, river: 0, scale: 0.16, c: mistC.clone().multiplyScalar(0.62).lerp(lin('#8A7F96').multiplyScalar(0.62), 0.35) },
      { y: -10, a: 0.42, drift: 0.035, river: 0, scale: 0.11, c: mistC.clone().multiplyScalar(0.38) },
      { y: -14.5, a: 0.62, drift: 0.025, river: 1, scale: 0.08, c: mistC.clone().multiplyScalar(0.22) },
    ];
    // the river runs nearer the far walls: that is the strip of the deep sheet the 52° camera sees past the deck
    const riverY = new Vector2((axisY - deckHalf) * 0.47, axisY + deckHalf + (SY - axisY - deckHalf) * 0.4);
    const sheetGeo = new PlaneGeometry(SX + 40, SY + 24, 1, 1);
    sheetGeo.rotateX(-Math.PI / 2);
    sheetGeo.translate(SX / 2, 0, SY / 2);
    disposables.push(sheetGeo);
    // where each sheet cuts the rock: the outline of every gorge surface (the flank, the terraced far walls and
    // their buttresses, the bands, the stacks) sliced at the sheet's height, baked into a distance field (one
    // channel per sheet). The sheet fades to nothing over the last ~3.5 m before any rock it meets, so it never
    // shows a seam line across a face (a translucent plane cutting stone reads as a contour line, not mist)
    const MB = { x0: -20, z0: -12, w: SX + 40, h: SY + 24, t: 0.5, cap: 4 };
    const MW = Math.ceil(MB.w / MB.t) + 1, MH = Math.ceil(MB.h / MB.t) + 1;
    const mistSD = new Uint8Array(MW * MH * 4).fill(255);
    const gorgeTris = wm.pos.slice(gorgeV0, gorgeV1);
    sheets.forEach((sh, k) => {
      const segs: number[] = [];
      sliceAt(gorgeTris, null, sh.y, segs);
      sliceAt(stackPos, stackIdx, sh.y, segs);
      const d = new Float32Array(MW * MH).fill(MB.cap);
      for (let s = 0; s < segs.length; s += 4) {
        const ax = segs[s], az = segs[s + 1], bx = segs[s + 2], bz = segs[s + 3];
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - MB.cap - MB.x0) / MB.t)), i1 = Math.min(MW - 1, Math.ceil((Math.max(ax, bx) + MB.cap - MB.x0) / MB.t));
        const j0 = Math.max(0, Math.floor((Math.min(az, bz) - MB.cap - MB.z0) / MB.t)), j1 = Math.min(MH - 1, Math.ceil((Math.max(az, bz) + MB.cap - MB.z0) / MB.t));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const q = segDist(MB.x0 + i * MB.t, MB.z0 + j * MB.t, ax, az, bx, bz);
          if (q < d[j * MW + i]) d[j * MW + i] = q;
        }
      }
      for (let t = 0; t < MW * MH; t++) mistSD[t * 4 + k] = Math.round((d[t] / MB.cap) * 255);
    });
    const mistTex = mkTex(mistSD, MW, MH);
    const mistBox = new Vector4(MB.x0, MB.z0, (MW - 1) * MB.t, (MH - 1) * MB.t);
    sheets.forEach((sh, k) => {
      const m = new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
      const su = {
        uMistSD: { value: mistTex }, uMistBox: { value: mistBox }, uSheetSel: { value: new Vector3(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0) },
        uWaterT: worldUniforms.valeTime,
        uSheet: { value: new Vector4(sh.a, sh.drift, sh.river, sh.scale) }, uSheetC: { value: sh.c }, uRiverY: { value: riverY },
      };
      m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
        Object.assign(shader.uniforms, su);
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\n${MIST_SHEET_PARS}\n${NOISE_GLSL}`)
          .replace('#include <map_fragment>', MIST_SHEET_MAIN)
          // the mist is atmosphere, not ground: the fog of war only dims it (as the walls' mist)
          .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb = diffuseColor.rgb * mix( 0.75, 1.0, valeVision( vValeWorld.xz ) );');
      };
      m.customProgramCacheKey = () => 'vale_mist_sheet_v2';
      patchWorldMaterial(m);
      const mesh = new Mesh(sheetGeo, m);
      mesh.position.y = sh.y;
      mesh.renderOrder = -1 - k;      // before every other transparent (VFX over the drop stay on top), deepest first
      mesh.name = `vale_mist_${k}`;
      group.add(mesh);
      disposables.push(m);
    });
  }

  // ── Needlegrass (brush) ────────────────────────────────────────────────────────────────────────
  // r12 M11: the blades lean away from every unit the viewer sees within 0.8 m and fade to 35 % round your own
  // and allied fighters (terrain_brush.ts; the renderer feeds the field). The material is TRANSPARENT so a faded
  // blade shows the fighter behind it: it still writes depth (blades occlude each other as before), draws in one
  // pass for both faces, and after the units' rest outlines (renderOrder 2), so a faded blade lets the outline
  // through too. One instanced draw per 24 m chunk, as before; the shadow depth material runs the same motion.
  const clump = needlegrassClump(lin(colors.grassRoot), lin(colors.grassTip));
  const brush = thickets.length ? new BrushField((x, y, reach) => {
    for (let k = 0; k < thickets.length; k++) {
      if (boxDist(x, y, thicketBoxes[k]) > reach) continue;
      if (pointInPolygon(x, y, thickets[k]) || polyEdgeDist(x, y, thickets[k]) <= reach) return true;
    }
    return false;
  }) : null;
  const grassMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: DoubleSide, transparent: true, depthWrite: true });
  grassMat.forceSinglePass = true;
  const grassU = { uWindT: worldUniforms.valeTime, ...(brush ? brush.uniforms : { uBrush: { value: [] }, uBrushFade: { value: [] }, uBrushN: { value: 0 } }) };
  grassMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, grassU);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${GRASS_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${GRASS_VERT_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBrushA;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vBrushA;');
  };
  grassMat.customProgramCacheKey = () => 'vale_grass_v3';
  patchWorldMaterial(grassMat);
  const grassDepth = motionDepthMaterial(GRASS_VERT_PARS, GRASS_VERT_MAIN, grassU, 'vale_grass_depth_v1');
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
  if (grassItems.length) group.add(chunked(clump, grassMat, grassItems, 'vale_needlegrass', true, grassDepth, 2));
  disposables.push(clump, grassMat, grassDepth);

  // ── Standing Shadow + Fallen Shaft (terrain marks from the map's terrain block) ────────────────
  // the shadow's frame: from its tip toward the needle that casts it (the Seat), the core wedge's length and
  // half-width at the needle
  const tipAt = pt(shadowDef?.tip);
  const shAx = new Vector4(0, 0, 0, 1), shWedge = new Vector2(0, 0);
  if (tipAt) {
    const bx = seatAt ? seatAt[0] : tipAt[0], by = seatAt ? seatAt[1] : tipAt[1] + 20;
    const l = Math.hypot(bx - tipAt[0], by - tipAt[1]) || 1;
    shAx.set(tipAt[0], tipAt[1], (bx - tipAt[0]) / l, (by - tipAt[1]) / l);
    shWedge.set(l, Math.min(4, l * 0.11));
  }
  const shU = {
    uSplat: { value: splatTex }, uSplat2: { value: splat2Tex },
    uSplatScale: gu.uSplatScale, uTexGrain: tex.grain, uShAx: { value: shAx }, uShWedge: { value: shWedge },
    // ×1.62: lands the lit, graded floor on the map's designed band (valueLstar; the tint is the designed screen colour)
    uShadowC: { value: lin(typeof shadowDef?.tint === 'string' ? shadowDef.tint : '#4A4560').multiplyScalar(1.62) }, uShadowLine: { value: lin(colors.shadowLine) },
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
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, sHeight, 1.0 );')
        // keeps its colour under fog of war, and enough value that the colour still reads: lifted where unseen
        // before the world fog darkens it (it lands near L* 14 instead of 6), so it never reads as fog itself
        .replace('#include <opaque_fragment>', 'outgoingLight *= 1.0 + 0.6 * ( 1.0 - valeVision( vValeWorld.xz ) );\n#include <opaque_fragment>');
    };
    mat.customProgramCacheKey = () => 'vale_shadow_v4';
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
    const mat = new MeshStandardMaterial({ color: lin(colors.water), roughness: 0.5, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false,
      envMapIntensity: 1.2, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    // the film's sky sheen and its wet rim ride on the shaft floor's own value band (r12 B5): constants scaled by
    // the floor's albedo luminance, so a rebased floor rebases its water
    const wl = lum(lin(colors.shaftFloor));
    const wU = { uWaterT: worldUniforms.valeTime, uSplat2: { value: splat2Tex }, uSplatScale: gu.uSplatScale,
      uWaterSheen: { value: new Vector3(0.55, 0.69, 0.83).multiplyScalar(wl) }, uWaterLap: { value: 0.07 * wl } };
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, wU);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uWaterT; uniform sampler2D uSplat2; uniform vec2 uSplatScale; uniform vec3 uWaterSheen; uniform float uWaterLap;\n${NOISE_GLSL}`)
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
  outgoingLight = mix( outgoingLight, outgoingLight * 1.25 + vec3( uWaterLap ), lap * ( 0.6 + 0.4 * sin( uWaterT * 0.9 + vValeWorld.x * 2.0 + vValeWorld.z ) ) );
  // the sky in the film (roughness stays ≥ 0.5 on walkable ground): a cool sheen off the ripples at grazing view
  float nv = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  outgoingLight += uWaterSheen * smoothstep( 0.98, 0.55, nv );
}
#include <opaque_fragment>`);
    };
    mat.customProgramCacheKey = () => 'vale_water_v4';
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
  // Dialwood on the block tops (brief §6): a dense, overlapping canopy so every wall block reads as forest.
  // Each spot carries the room its crown has, and setScatter sizes the tree that lands there (its variant's
  // real height H and crown reach R, known once the props load) to the largest that hides nothing:
  //   · edges: the crown leans over a south-facing lip ≤ 0.8 m, over an east / west one ≤ 0.5 m, measured square
  //     to each lip (see add / treeScale)
  //   · north edge (the camera looks north at 52°: height h hides 0.78·h of ground behind it): the crown adds
  //     no occlusion beyond what the cliff itself already hides — max(0.78·H, 0.51·H + R)·s ≤ dN + TOL
  //   · within 3 m of the south (camera) edge the canopy stays ≤ 4 m; deeper in, larger trees (≤ 9 m)
  //   · a landmark keeps its footprint and, on its camera side, the trees stay under its sight line
  //     (its base may sink ≤ min(1 m, 0.2·height) into the wood): only the strip the landmark needs
  type TreeSpot = { x: number; y: number; h: number; s: number; r: number; tint: number; e: number; dN: number; dS: number; cr: number; mk: { gap: number; inFoot: boolean; hide: number }[] };
  const treeSpots: TreeSpot[] = [];
  /** distance from (x, y) inside `poly` to its boundary along one axis: ax 1 = y (dir −1 north, +1 south),
   *  ax 0 = x (dir −1 west, +1 east) */
  const rayOut = (x: number, y: number, poly: Poly, dir: number, ax = 1): number => {
    const o = 1 - ax, c = ax === 1 ? x : y, v = ax === 1 ? y : x;
    let best = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      if ((a[o] - c) * (b[o] - c) > 0 || a[o] === b[o]) continue;
      const w = a[ax] + ((c - a[o]) / (b[o] - a[o])) * (b[ax] - a[ax]);
      const d = (w - v) * dir;
      if (d > 0 && d < best) best = d;
    }
    return best;
  };
  walls.forEach((poly, i) => {
    if (chasm[i] || replaced[i] || wallHeights[i] < 2.2 || surface === 'plate') return;          // the Noonplate is a clean stage
    const h = wallHeights[i];
    const pccw = signedArea(poly) > 0;
    /** a spot with the room its crown has; `want` = the scale the wood wants there */
    const add = (jx: number, jy: number, want: number, rot: number, tint: number, minE: number): void => {
      if (!pointInPolygon(jx, jy, poly)) return;
      const e = polyEdgeDist(jx, jy, poly);
      if (e < minE) return;
      if (jx < -3 || jy < -3 || jx > SX + 3 || jy > SY + 3) return;
      // the crown spans ±1.2 m across: the nearest lip straight north / south over that span (the camera looks
      // north: the north rule is about sight lines along y)
      // (a ray only counts from a point that is itself on the block: beside a diagonal lip the offset point lies
      // outside, and its ray would "find" the lip it starts beyond)
      let dN = Infinity, dS = Infinity;
      for (const o of [-1.2, 0, 1.2]) {
        if (o !== 0 && !pointInPolygon(jx + o, jy, poly)) continue;
        dN = Math.min(dN, rayOut(jx + o, jy, poly, -1)); dS = Math.min(dS, rayOut(jx + o, jy, poly, 1));
      }
      // crown room over every other lip, measured square to that lip (a diagonal lip is no closer than it is):
      // the crown may lean ≤ 0.8 m over a south-facing lip, ≤ 0.5 m over an east / west one
      let cr = Infinity;
      for (let k = 0, kp = poly.length - 1; k < poly.length; kp = k++) {
        const a = poly[kp], c = poly[k];
        const ex = c[0] - a[0], ey = c[1] - a[1], el = Math.hypot(ex, ey);
        if (el < 1e-6) continue;
        const ny = (pccw ? -ex : ex) / el;
        if (ny < -0.35) continue;
        cr = Math.min(cr, segDist(jx, jy, a[0], a[1], c[0], c[1]) + (ny > 0.35 ? 0.8 : 0.5));
      }
      const mk: { gap: number; inFoot: boolean; hide: number }[] = [];
      for (const m of marks) {
        if (Math.abs(jx - m.x) > m.sx + 4 || jy < m.y - m.sy - 4 || jy > m.y + m.sy + 9) continue;
        const inFoot = Math.abs(jx - m.x) < m.sx + 0.4 && Math.abs(jy - m.y) < m.sy + 0.4;
        const gap = jy - (m.y + m.sy);                       // > 0: in front of it (camera side)
        mk.push({ gap: Math.abs(jx - m.x) < m.sx + 1.5 ? gap : -99, inFoot, hide: Math.min(1.0, 0.2 * m.h) });
      }
      if (mk.some((q) => q.inFoot)) return;
      treeSpots.push({ x: jx, y: jy, h, s: want, r: rot, tint, e, dN, dS, cr, mk });
    };
    // the lip rows: a hedge of smaller crowns along every south (camera) and east / west lip, leaning a little
    // over it, so the wood meets the cliff edge (seen from 52° the floor under a raised crown shows in front
    // of it); none along the north lips (they would hide the ground behind the block)
    for (let k = 0, kp = poly.length - 1; k < poly.length; kp = k++) {
      const a = poly[kp], c = poly[k];
      const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy);
      if (l < 0.5) continue;
      const ccw = signedArea(poly) > 0;
      const nx = (ccw ? dy : -dy) / l, ny = (ccw ? -dx : dx) / l;      // outward
      if (ny < -0.35) continue;                                         // a north-facing lip
      const inset = ny > 0.35 ? 0.85 : 1.0;
      const n = Math.max(1, Math.round(l / 1.7));
      for (let t = 0; t < n; t++) {
        const f = (t + 0.25 + rand() * 0.5) / n;
        const ins = inset + (rand() - 0.5) * 0.35;
        add(a[0] + dx * f - nx * ins, a[1] + dy * f - ny * ins, 0.7 + rand() * 0.16, rand() * Math.PI * 2, rand(), 0.45);
      }
    }
    // the body of the wood: a jittered 2.0 m grid, small near the edges, larger inside; deep interiors take
    // fewer, larger trees (they cover more per triangle and stand over the edge rows)
    const b = wallBoxes[i];
    const step = 2.0;
    for (let y = b.minY + step / 2; y < b.maxY; y += step) {
      for (let x = b.minX + step / 2; x < b.maxX; x += step) {
        const jx = x + (rand() - 0.5) * step * 0.9, jy = y + (rand() - 0.5) * step * 0.9;
        const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand();
        const e = pointInPolygon(jx, jy, poly) ? polyEdgeDist(jx, jy, poly) : 0;
        if (e > 6 && r0 < 0.45) continue;
        add(jx, jy, e < 3 ? 0.82 + r1 * 0.14 : e < 6 ? 0.95 + r1 * 0.22 : 1.12 + r1 * 0.38, r2 * Math.PI * 2, r3, 1.5);
      }
    }
  });
  const TREE_TOL = 0.3;
  /** the scale a tree of real height H and crown reach R may take at a spot (0 = none fits). Overhangs: the
   *  camera sits south, so a crown leaning over a SOUTH-facing lip hides nothing walkable (a 2 m fighter at the
   *  cliff foot stays clear up to ~1.2 m of overhang): ≤ 0.8 m there; ≤ 0.5 m over the east / west lips */
  const treeScale = (t: TreeSpot, H: number, R: number): number => {
    let s = t.s;
    s = Math.min(s, t.cr / R, (t.dN + TREE_TOL) / Math.max(0.78 * H, 0.51 * H + R));
    if (t.dS < 3) s = Math.min(s, 4 / H);
    s = Math.min(s, 9 / H);
    // the landmark's base may sink up to q.hide m into the wood (a half-buried numeral), no more: the crown's
    // top (at the trunk) and its widest ring (0.65·H, R nearer) both stay under the sight line
    for (const q of t.mk) if (q.gap > -98 && q.gap > -0.5) s = Math.min(s, (1.28 * q.gap + q.hide) / H, (1.28 * q.gap + q.hide) / (0.65 * H + 1.28 * R));
    // saplings (down to half size) only fill the strip in front of a landmark; elsewhere a tree under 0.6 costs a
    // whole crown's triangles for a bush's cover
    return s >= (t.mk.some((q) => q.gap > -98) ? 0.5 : 0.6) ? s : 0;
  };
  // the Seat: "nothing rises from it" — no boulder or stone on the disc or its rim step
  const onSeat = (x: number, y: number): boolean => seatV.z > 0 && Math.hypot(x - seatV.x, y - seatV.y) < seatV.z + 1.2;
  /** loose stone: map (x, y), scale, turn; `h` = the height it rests at (a stub's broken top), else the ground */
  type LooseSpot = { x: number; y: number; s: number; r: number; h?: number };
  const boulderSpots: LooseSpot[] = [];
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
      if (ok && (onMark(x, y) || inPlaza(x, y, 1) || onSeat(x, y) || field(F.sh, x, y) < 0.5 || field(F.sf, x, y) < 0.5)) ok = false;
      if (ok) boulderSpots.push({ x, y, s: 0.35 + Math.pow(rand(), 1.6) * 0.75, r: rand() * Math.PI * 2 });
    }
  });
  const stoneSpots: LooseSpot[] = [];
  const nStones = surface === 'dial' ? Math.round(SX * SY * 0.02) : 0;
  for (let k = 0; k < nStones; k++) {
    const x = rand() * SX, y = rand() * SY;
    let ok = field(F.ld, x, y) > LANE_HALF + 1.2 && field(F.wd, x, y) > 0.6 && field(F.td, x, y) > 0.2;
    for (const c of clearings) if (ok && Math.hypot(x - c.x, y - c.y) < c.r + 0.8) ok = false;
    if (ok && (onMark(x, y) || inPlaza(x, y, 1) || onSeat(x, y) || field(F.sh, x, y) < 0.5 || field(F.sf, x, y) < 0.5)) ok = false;
    if (ok) stoneSpots.push({ x, y, s: 0.1 + Math.pow(rand(), 2.2) * 0.32, r: rand() * Math.PI * 2 });
  }
  // Needlespan: needle fragments (brief §5: on the stubs, the deck's broken edges and the gorge lip, ≤ 0.8 m,
  // never on the open deck). The far lips: broken drums and slabs strewn along the rim plateau across the drop.
  // The Snap's broken edges: small chips lying right on the lip of the drop where the shaft cracked (on the
  // chalk band, never out on the floor). The stubs: see the landmark hook below (their broken tops).
  if (gorge) {
    const lr = mulberry(4711);
    for (const side of [-1, 1]) {
      for (let x = 1.5; x < SX - 1.5; x += 2.0) {
        const a = lr(), b = lr(), c = lr(), d = lr(), e = lr();
        const y = side < 0 ? -(0.7 + b * 1.6) : SY + 0.7 + b * 1.6;
        const jx = x + (c - 0.5) * 1.6;
        if (a < 0.5) boulderSpots.push({ x: jx, y, s: 0.8 + Math.pow(d, 1.4) * 0.85, r: e * Math.PI * 2 });
        else if (a < 0.9) stoneSpots.push({ x: jx, y: y + side * 0.6 * d, s: 0.2 + d * 0.22, r: e * Math.PI * 2 });
      }
    }
    if (snapAt && snapR > 0) {
      const sr = mulberry(4713);
      chasmPolys.forEach((poly) => {
        const ccw = signedArea(poly) > 0;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          if (onBorder(a[0], a[1]) && onBorder(b[0], b[1])) continue;
          const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy);
          if (l < 0.3) continue;
          const nx = (ccw ? dy : -dy) / l, ny = (ccw ? -dx : dx) / l;      // out of the drop: onto the deck
          for (let t = 0.3; t < l; t += 0.55) {
            const u = sr(), v = sr(), w = sr(), z = sr();
            const px = a[0] + (dx / l) * t, py = a[1] + (dy / l) * t;
            if (Math.hypot(px - snapAt[0], py - snapAt[1]) > snapR + 0.5 || u > 0.42) continue;
            const inset = 0.12 + v * 0.26;
            stoneSpots.push({ x: px + nx * inset, y: py + ny * inset, s: 0.15 + w * w * 0.24, r: z * Math.PI * 2 });
          }
        }
      });
    }
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
  const propMat = propMaterial();
  patchWorldMaterial(propMat);
  // the Dialwood sway (r12 M11): its own program, and a shadow depth material running the same motion
  const treeMat = propMaterial(true);
  patchWorldMaterial(treeMat);
  const treeDepth = motionDepthMaterial(TREE_SWAY_PARS, TREE_SWAY_MAIN, { uSwayT: worldUniforms.valeTime }, 'vale_tree_sway_depth_v1');
  disposables.push(propMat, treeMat, treeDepth);
  /** a spot's variant is a hash of its position: stable across quality changes */
  const variantOf = (x: number, y: number, n: number): number => Math.floor(hash2(x * 1.7, y * 2.3) * n) % n;
  /** instanced props by variant */
  const propParts = (geos: BufferGeometry[], items: { x: number; y: number; m: Matrix4; c?: Color }[], name: string, shadows = true, sway = false): Group[] => {
    const by: { m: Matrix4; c?: Color }[][] = geos.map(() => []);
    for (const it of items) by[variantOf(it.x, it.y, geos.length)].push(it);
    return geos.map((g, i) => chunked(g, sway ? treeMat : propMat, by[i], `${name}_${i}`, shadows, sway ? treeDepth : undefined)).filter((g) => g.children.length > 0);
  };
  /** real height and horizontal crown reach of a prop (origin at its ground contact) */
  const dimsOf = (g: BufferGeometry): { H: number; R: number } => {
    const p = g.getAttribute('position') as BufferAttribute;
    let H = 0.5, R = 0.3;
    for (let k = 0; k < p.count; k++) { H = Math.max(H, p.getY(k)); R = Math.max(R, Math.hypot(p.getX(k), p.getZ(k))); }
    return { H, R };
  };
  /** a prop's instance value (propValue): none at 1, so an unscaled map keeps its programs */
  const pvC = (k: number): Color | undefined => (k === 1 ? undefined : new Color(k, k, k));
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
    if (props.tree && !props.tree.length) {
      // the map names no trees (an explicit empty list): none
    } else if (trees.length && props.tree?.length) {
      const geos = props.tree, dims = geos.map(dimsOf);
      const items: { x: number; y: number; m: Matrix4; c: Color }[] = [];
      for (const t of trees) {
        const d = dims[variantOf(t.x, t.y, geos.length)];
        const sc = treeScale(t, d.H, d.R);
        if (sc <= 0) continue;
        q.setFromAxisAngle(up, t.r); s.setScalar(sc); pos.set(t.x, t.h - 0.12, t.y);
        // the deep wood a shade darker and cooler than the edge rows (they catch the light at the lip)
        const deep = Math.min(1, Math.max(0, (t.e - 2) / 6));
        const k = 1 - 0.1 * deep;
        items.push({ x: t.x, y: t.y, m: new Matrix4().compose(pos, q, s), c: new Color((0.86 + t.tint * 0.22) * k, (0.9 + t.tint * 0.14) * k, (0.86 + t.tint * 0.12) * (k + 0.04 * deep)).multiplyScalar(pv.tree) });
      }
      scatterParts.push(...propParts(geos, items, 'vale_trees', true, true));
    } else if (trees.length) {
      const trunks: { m: Matrix4; c?: Color }[] = [], canopies: { m: Matrix4; c: Color }[] = [];
      for (const t of trees) {
        if (treeScale(t, 2.6, 1.3) <= 0) continue;
        const th = 1.0 + t.s * 0.8;
        q.setFromAxisAngle(up, t.r);
        s.set(t.s, th, t.s); pos.set(t.x, t.h - 0.1, t.y);
        trunks.push({ m: new Matrix4().compose(pos, q, s), c: pvC(pv.tree) });
        s.set(t.s * 1.25, t.s * 1.15, t.s * 1.25); pos.set(t.x, t.h + th * 0.82, t.y);
        canopies.push({ m: new Matrix4().compose(pos, q, s), c: new Color(0.82 + t.tint * 0.3, 0.86 + t.tint * 0.24, 0.84 + t.tint * 0.2).multiplyScalar(pv.tree) });
      }
      scatterParts.push(chunked(trunkGeo, trunkMat, trunks, 'vale_trunks'), chunked(canopyGeo, leafMat, canopies, 'vale_canopies'));
    }
    if (props.rock && !props.rock.length) {
      // an explicit empty list: no boulders
    } else if (boulders.length && props.rock?.length) {
      scatterParts.push(...propParts(props.rock, boulders.map((b) => {
        q.setFromAxisAngle(up, b.r); s.set(b.s * 1.25, b.s * 1.1, b.s * 1.25); pos.set(b.x, (b.h ?? 0) - 0.04, b.y);
        return { x: b.x, y: b.y, m: new Matrix4().compose(pos, q, s), c: pvC(pv.rock) };
      }), 'vale_boulders'));
    } else if (boulders.length) {
      scatterParts.push(chunked(rockGeo, stoneMat, boulders.map((b) => {
        q.setFromAxisAngle(up, b.r); s.set(b.s * 1.2, b.s * 0.8, b.s); pos.set(b.x, b.s * 0.15, b.y);
        return { m: new Matrix4().compose(pos, q, s), c: pvC(pv.rock) };
      }), 'vale_boulders'));
    }
    // stones fall back to the rock variants only when the map names no stone list at all
    const stoneGeos = props.stone ?? props.rock;
    if (stoneGeos && !stoneGeos.length) {
      // an explicit empty list: no loose stones
    } else if (stones.length && stoneGeos?.length) {
      scatterParts.push(...propParts(stoneGeos, stones.map((p) => {
        q.setFromAxisAngle(up, p.r); s.set(p.s * 1.1, p.s * 0.9, p.s); pos.set(p.x, (p.h ?? 0) - 0.02, p.y);
        return { x: p.x, y: p.y, m: new Matrix4().compose(pos, q, s), c: pvC(pv.stone) };
      }), 'vale_stones', false));
    } else if (stones.length) {
      scatterParts.push(chunked(rockGeo, stoneMat, stones.map((p) => {
        q.setFromAxisAngle(up, p.r); s.set(p.s, p.s * 0.6, p.s * 0.85); pos.set(p.x, p.s * 0.1, p.y);
        return { m: new Matrix4().compose(pos, q, s), c: pvC(pv.stone) };
      }), 'vale_stones', false));
    }
    // ground clutter: none on Low, half on Medium, all on High/Ultra; never casts shadows
    const keepC = level === 0 ? 0 : level === 1 ? 0.5 : 1;
    const place = (list: CSpot[], geo: BufferGeometry, name: string, yS: number, y0: number): void => {
      const items = pick(list, keepC).map((p) => {
        q.setFromAxisAngle(up, p.r); s.set(p.s, p.s * yS, p.s); pos.set(p.x, y0, p.y);
        return { m: new Matrix4().compose(pos, q, s), c: pv.clutter === 1 ? p.c : p.c.clone().multiplyScalar(pv.clutter) };
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

  // Needlespan's stubs: when a landmark that stands in for a wall polygon arrives (the renderer adds it to this
  // group), a few needle fragments are laid on its broken top — found by casting down onto the model, so they
  // rest on the stone (never float, never sink) — and the scatter is rebuilt once
  if (gorge) {
    const ray = new Raycaster();
    const down = new Vector3(0, -1, 0), nrm = new Vector3();
    group.addEventListener('childadded', (ev) => {
      const o = ev.child;
      const k = walls.findIndex((_, i) => replaced[i] && pointInPolygon(o.position.x, o.position.z, walls[i]));
      if (k < 0 || o.name === 'vale_scatter') return;
      o.updateMatrixWorld(true);
      const b = wallBoxes[k];
      const fr = mulberry(5150 + k * 31);
      const tops: { x: number; y: number; h: number }[] = [];
      for (let y = b.minY + 0.3; y < b.maxY - 0.2; y += 0.32) {
        for (let x = b.minX + 0.3; x < b.maxX - 0.2; x += 0.32) {
          ray.set(new Vector3(x, 12, y), down);
          const hit = ray.intersectObject(o, true)[0];
          if (!hit?.face || hit.point.y < 0.9) continue;
          nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
          if (nrm.y > 0.8) tops.push({ x, y, h: hit.point.y });
        }
      }
      // a handful of pieces on the top, spaced out (deterministic)
      const placed: { x: number; y: number }[] = [];
      for (let n = 0; n < 40 && placed.length < 5 && tops.length; n++) {
        const t = tops[Math.floor(fr() * tops.length)];
        const r = fr(), z = fr();
        if (placed.some((q) => Math.hypot(q.x - t.x, q.y - t.y) < 0.6)) continue;
        placed.push(t);
        if (placed.length <= 2) boulderSpots.push({ x: t.x, y: t.y, h: t.h, s: 0.55 + r * 0.4, r: z * Math.PI * 2 });
        else stoneSpots.push({ x: t.x, y: t.y, h: t.h, s: 0.2 + r * 0.16, r: z * Math.PI * 2 });
      }
      if (placed.length) setScatter(scatterLevel);
    });
  }

  return {
    group,
    wallHeights,
    setScatter,
    brush,
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

/** a clump of 7 solid, V-folded, tapered blades (no alpha), painted dark-to-light (r12 M11): a deep occluded foot
 *  (× 0.55 of the root colour), a dark body, a lit, slightly warm tip that stays under the canopy's top values; the
 *  clump's middle blade and the inner ones a shade deeper than the outer (baked occlusion, so Low without AO keeps
 *  the brush in the dark band) */
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
    const inner = b === 0 ? 0.82 : 0.9 + (r0 / 0.17) * 0.1 + (rand() - 0.5) * 0.08;
    const foot = root.clone().multiplyScalar(0.55 * inner), body = root.clone().lerp(tip, 0.3).multiplyScalar(inner);
    const lit = tip.clone().multiplyScalar(0.9 * (0.94 + 0.06 * inner));
    lit.r *= 1.05; lit.b *= 0.86;
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
          const c = ts[v] <= 0.5 ? foot.clone().lerp(body, ts[v] * 2) : body.clone().lerp(lit, (ts[v] - 0.5) * 2);
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
