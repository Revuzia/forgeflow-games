// VALE render — procedural terrain from the map JSON (CONTRACT §0: terrain, scatter and trim are
// procedural-allowed). Used while `map.art.scene` is missing or empty (the art lane's Blender scene
// replaces it as soon as it loads). Everything is derived from MapDef, deterministically:
//
//   ground    one plane; a CPU-baked splat of DISTANCES (lane centre, clearing edge, wall edge, thicket
//             edge) shaded in the fragment shader: honed irregular pavers on the roads (lighter, quieter:
//             L* 62–68), a dark mossy Dialwood floor with leaf litter (L* 30–40), packed-dust clearings
//             around camps / bases / structures (L* 45–50), wall-foot occlusion and quiet carved hour-lines.
//             Roughness ≥ 0.5 everywhere walkable.
//   cliffs    every wall polygon, outline resampled at ~0.9 m with a deterministic wobble, extruded
//             1.6–3.4 m and chiselled (position-based displacement, flat facets): lit tops with moss
//             (L* 55–62) and a bright worn rim, dark stratified faces (L* 18–25). An outer rim closes the
//             world. `terrain.wallStyle: "gorge"` (Needlespan) turns large walls into a chasm instead:
//             the ground opens, sheer walls drop into the gorge mist.
//   brush     Needlegrass: instanced clumps of SOLID tapered blades (no alpha cards) on a carved curb.
//   scatter   (quality 0 sparse · 1 half · 2 full) rounded Dialwood canopies on the cliff tops, boulders at
//             the cliff feet and stones on the jungle floor; never in lanes, clearings or brush.
//   marks     the Standing Shadow floor (keeps its colour under fog, hard engraved edge) and the
//             Fallen Shaft's shallow water, when the map's terrain block describes them.
// Instanced scatter is chunked (24 m cells) so off-screen chunks are culled from the main and shadow
// passes. Every material is patched with the world chunk (fog of war + edge haze).

import {
  BackSide, BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, DataTexture, DoubleSide,
  ExtrudeGeometry, Group, IcosahedronGeometry, InstancedMesh, LinearFilter, type Material, Matrix4, Mesh,
  MeshStandardMaterial, type Object3D, PlaneGeometry, Quaternion, RedFormat, RGBAFormat, Shape, ShapeGeometry, ShapeUtils, UnsignedByteType,
  type Texture, Vector2, Vector3, Vector4, type WebGLProgramParametersWithUniforms,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDefT } from '../contracts/catalog.ts';
import { NOISE_GLSL } from './glsl.ts';
import { patchWorldMaterial, worldUniforms } from './world_material.ts';

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

/** naive polygon inset (for convex-ish shapes) */
function insetPolygon(pts: Vector2[], d: number): Vector2[] {
  const n = pts.length;
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const e0 = p1.clone().sub(p0).normalize(), e1 = p2.clone().sub(p1).normalize();
    const n0 = new Vector2(-e0.y, e0.x), n1 = new Vector2(-e1.y, e1.x);
    const bis = n0.add(n1).normalize();
    out.push(p1.clone().addScaledVector(bis, d));
  }
  return out;
}

/** shape in the extrusion plane: sim (x, y) → shape (x, −y) so rotateX(−π/2) lands it on (x, ·, y) */
function shapeOf(poly: Poly, inset = 0): Shape {
  let pts = poly.map(([x, y]) => new Vector2(x, -y));
  if (ShapeUtils.isClockWise(pts)) pts = pts.reverse();
  if (inset !== 0) pts = insetPolygon(pts, inset);
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
interface TerrainColors { lane: string; laneGrout: string; jungle: string; moss: string; earth: string; clearing: string; inscription: string;
  cliffTop: string; cliffFace: string; curb: string; grassRoot: string; grassTip: string; leaf: string; trunk: string; stone: string; chasm: string; mist: string }
const DEFAULT_COLORS: TerrainColors = {
  lane: '#9A927F', laneGrout: '#6F685A', jungle: '#4E5547', moss: '#475A43', earth: '#5C5446', clearing: '#7A766A', inscription: '#B7B0A0',
  cliffTop: '#8E8979', cliffFace: '#45423C', curb: '#8A8476', grassRoot: '#2F3B30', grassTip: '#8A9A7C', leaf: '#3F5A45',
  trunk: '#4A3F36', stone: '#77726A', chasm: '#2A2D33', mist: '#5E6C93',
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

export interface TerrainBuild {
  group: Group;
  /** heights of every wall polygon (0 for chasm walls) */
  wallHeights: number[];
  setScatter(level: 0 | 1 | 2): void;
  /** painted tiling textures by role (map.art.terrain.textures): road, floor, clearing, dust, cliff, cliffTop */
  setTextures(t: Partial<Record<TerrainTexRole, Texture>>): void;
  /** authored scatter props (map.art.terrain.props: tree / rock / stone → GLB variants), vertex-coloured,
   *  real size, origin at the ground contact; they replace the procedural shapes and re-scatter */
  setProps(p: Partial<Record<TerrainPropRole, BufferGeometry[]>>): void;
  /** standing height at a map point: a cliff block's top inside a wall polygon, else 0 */
  groundAt(x: number, y: number): number;
  update(time: number): void;
  dispose(): void;
}

export type TerrainTexRole = 'road' | 'floor' | 'clearing' | 'dust' | 'cliff' | 'cliffTop';
export type TerrainPropRole = 'tree' | 'rock' | 'stone';
export const TERRAIN_PROP_ROLES: readonly TerrainPropRole[] = ['tree', 'rock', 'stone'];
export const TERRAIN_TEX_ROLES: readonly TerrainTexRole[] = ['road', 'floor', 'clearing', 'dust', 'cliff', 'cliffTop'];
/** world metres per texture repeat, by role */
const TEX_SCALE: Record<TerrainTexRole, number> = { road: 3.6, floor: 5.0, clearing: 4.5, dust: 4.0, cliff: 3.4, cliffTop: 6.5 };

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
function whiteTex(): DataTexture {
  const t = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, RGBAFormat, UnsignedByteType);
  t.needsUpdate = true;
  return t;
}

/** GLSL: anti-tiled painted sample calibrated so its MEAN colour lands on the designed band colour (the
 *  bible's value law holds; the painting supplies the detail). The mean is the texture's smallest mip. */
const TEX_GLSL = /* glsl */`
// organic surfaces (grass, moss, dirt): two rotated samples blended by noise hide the repeat
vec3 valeTexBand( sampler2D t, vec2 p, float scale, vec3 band, float n ) {
  vec2 uv = p / scale;
  vec3 a = texture( t, uv ).rgb;
  vec2 r = vec2( 0.8 * uv.x - 0.6 * uv.y, 0.6 * uv.x + 0.8 * uv.y ) * 0.61 + vec2( 0.37, 0.71 );
  vec3 b = texture( t, r ).rgb;
  vec3 c = mix( a, b, smoothstep( 0.35, 0.65, n ) );
  vec3 m = max( textureLod( t, vec2( 0.5 ), 16.0 ).rgb, vec3( 0.02 ) );
  return c / m * band;
}
// structured surfaces (cobbles, strata): one aligned sample (a rotated copy would cross the grid);
// macro tone variation from the caller hides the repeat; contrast eased by k
vec3 valeTexGrid( sampler2D t, vec2 p, float scale, vec3 band, float k ) {
  vec3 c = texture( t, p / scale ).rgb;
  vec3 m = max( textureLod( t, vec2( 0.5 ), 16.0 ).rgb, vec3( 0.02 ) );
  return mix( vec3( 1.0 ), c / m, k ) * band;
}`;

interface Clearing { x: number; y: number; r: number }

export function buildTerrain(map: MapDefT): TerrainBuild {
  const group = new Group();
  group.name = 'vale_terrain';
  const [SX, SY] = map.size;
  const tr = (map.art.terrain ?? {}) as Record<string, unknown>;
  const colors = colorsFrom(tr);
  const gorge = tr.wallStyle === 'gorge';
  const rand = mulberry(0x5eed ^ Math.round(SX * 131 + SY * 17));
  const walls: Poly[] = map.walls.map((w) => w.map((p) => [p[0], p[1]] as V2));
  const thickets: Poly[] = (map.thickets ?? []).map((w) => w.map((p) => [p[0], p[1]] as V2));
  const wallBoxes = walls.map(bbox);
  const chasm = walls.map((w) => gorge && Math.abs(signedArea(w)) > 60);
  const thicketBoxes = thickets.map(bbox);
  const lanes = map.lanes.map((l) => l.path.map((p) => [p[0], p[1]] as V2));
  const disposables: { dispose(): void }[] = [];
  const lin = (hex: string): Color => new Color().setStyle(hex);

  // clearings: bases, shops, structures, camps, pickups, spawns
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
    clearings.push({ x: cx, y: cy, r: r + (c.objective ? 6 : 4.5) });
  }
  for (const p of map.pickups ?? []) clearings.push({ x: p.at[0], y: p.at[1], r: 2.2 });
  for (const s of map.spawns ?? []) clearings.push({ x: s[0], y: s[1], r: 2.6 });
  for (const s of map.shops ?? []) clearings.push({ x: s.at[0], y: s.at[1], r: s.radius + 1.5 });

  // ── splat (distance fields) ──────────────────────────────────────────────────────────────────
  const texel = Math.max(0.5, Math.max(SX, SY) / 384);
  const W = Math.ceil(SX / texel) + 1, H = Math.ceil(SY / texel) + 1;
  const splat = new Uint8Array(W * H * 4);
  const chasmMask = gorge ? new Uint8Array(W * H) : null;
  for (let j = 0; j < H; j++) {
    const y = j * texel;
    for (let i = 0; i < W; i++) {
      const x = i * texel;
      let ld = 16;
      for (const l of lanes) for (let k = 1; k < l.length; k++) ld = Math.min(ld, segDist(x, y, l[k - 1][0], l[k - 1][1], l[k][0], l[k][1]));
      let cd = 16;
      for (const c of clearings) cd = Math.min(cd, Math.hypot(x - c.x, y - c.y) - c.r);
      let wd = 8;
      for (let k = 0; k < walls.length; k++) {
        if (boxDist(x, y, wallBoxes[k]) >= wd) continue;
        const inside = pointInPolygon(x, y, walls[k]);
        if (inside && chasmMask && chasm[k]) chasmMask[j * W + i] = 255;
        if (inside) { wd = 0; break; }
        wd = Math.min(wd, polyEdgeDist(x, y, walls[k]));
      }
      let td = 4;
      for (let k = 0; k < thickets.length; k++) {
        if (boxDist(x, y, thicketBoxes[k]) >= td) continue;
        const e = polyEdgeDist(x, y, thickets[k]);
        td = Math.min(td, pointInPolygon(x, y, thickets[k]) ? -e : e);
      }
      const o = (j * W + i) * 4;
      splat[o] = Math.round(Math.min(1, ld / 16) * 255);
      splat[o + 1] = Math.round(Math.min(1, Math.max(0, (cd + 8) / 24)) * 255);
      splat[o + 2] = Math.round(Math.min(1, wd / 8) * 255);
      splat[o + 3] = Math.round(Math.min(1, Math.max(0, (td + 4) / 8)) * 255);
    }
  }
  const splatTex = new DataTexture(splat, W, H, RGBAFormat, UnsignedByteType);
  splatTex.magFilter = LinearFilter; splatTex.minFilter = LinearFilter; splatTex.generateMipmaps = false;
  splatTex.needsUpdate = true;
  disposables.push(splatTex);
  const maskTex = new DataTexture(chasmMask ?? new Uint8Array(4), chasmMask ? W : 2, chasmMask ? H : 2, RedFormat, UnsignedByteType);
  maskTex.magFilter = LinearFilter; maskTex.minFilter = LinearFilter; maskTex.generateMipmaps = false; maskTex.unpackAlignment = 1;
  maskTex.needsUpdate = true;
  disposables.push(maskTex);

  // hour-line centre (the dial): terrain.hourLines.centre, else the map centre
  const hl = tr.hourLines as { centre?: unknown; ring?: unknown } | undefined;
  const centre = Array.isArray(hl?.centre) && typeof hl!.centre[0] === 'number' ? new Vector2(hl!.centre[0] as number, hl!.centre[1] as number) : new Vector2(SX / 2, SY / 2);
  const ring = typeof hl?.ring === 'number' ? hl.ring : 0;
  const seat = tr.seat as { at?: unknown; radius?: unknown } | undefined;
  const seatV = Array.isArray(seat?.at) ? new Vector3(seat!.at[0] as number, seat!.at[1] as number, typeof seat?.radius === 'number' ? seat.radius : 0) : new Vector3(0, 0, 0);

  const white: Texture = whiteTex();
  disposables.push(white);
  // ── ground ───────────────────────────────────────────────────────────────────────────────────
  const gz0 = gorge ? 0 : -MARGIN, gz1 = gorge ? SY : SY + MARGIN;
  const groundGeo = new PlaneGeometry(SX + MARGIN * 2, gz1 - gz0, 1, 1);
  groundGeo.rotateX(-Math.PI / 2);
  groundGeo.translate(SX / 2, 0, (gz0 + gz1) / 2);
  const groundMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const gu = {
    uSplat: { value: splatTex }, uChasm: { value: maskTex }, uGorge: { value: gorge ? 1 : 0 },
    uSplatScale: { value: new Vector2(1 / (W * texel), 1 / (H * texel)) },
    uLaneHalf: { value: LANE_HALF },
    uLane: { value: lin(colors.lane) }, uGrout: { value: lin(colors.laneGrout) }, uJungle: { value: lin(colors.jungle) },
    uMoss: { value: lin(colors.moss) }, uEarth: { value: lin(colors.earth) }, uClearing: { value: lin(colors.clearing) },
    uInscription: { value: lin(colors.inscription) }, uThicketFloor: { value: lin(colors.grassRoot) },
    uCenter: { value: centre }, uRing: { value: ring }, uSeat: { value: seatV },
    uUseTex: { value: 0 }, uTexRoad: { value: white }, uTexFloor: { value: white }, uTexClear: { value: white }, uTexDust: { value: white },
    uTexScale: { value: new Vector4(TEX_SCALE.road, TEX_SCALE.floor, TEX_SCALE.clearing, TEX_SCALE.dust) },
  };
  groundMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, gu);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGroundW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vGroundW;
uniform sampler2D uSplat; uniform sampler2D uChasm; uniform float uGorge; uniform vec2 uSplatScale; uniform float uLaneHalf;
uniform vec3 uLane, uGrout, uJungle, uMoss, uEarth, uClearing, uInscription, uThicketFloor; uniform vec2 uCenter; uniform float uRing; uniform vec3 uSeat;
uniform float uUseTex; uniform sampler2D uTexRoad, uTexFloor, uTexClear, uTexDust; uniform vec4 uTexScale;
float gHeight; float gRough;
${NOISE_GLSL}
${TEX_GLSL}`)
      .replace('#include <map_fragment>', `
{
  vec2 p = vGroundW.xz;
  if ( uGorge > 0.5 && texture( uChasm, p * uSplatScale ).r > 0.5 ) discard;
  vec4 s = texture( uSplat, p * uSplatScale );
  float laneD = s.r * 16.0, clearD = s.g * 24.0 - 8.0, wallD = s.b * 8.0, thickD = s.a * 8.0 - 4.0;
  float nBig = valeFbm( p * 0.07 + 3.7 ), nMid = valeFbm( p * 0.29 ), n2 = valeNoise( p * 1.9 ), n3 = valeNoise( p * 7.3 );
  float wob = ( nMid - 0.5 ) * 1.2 + ( n2 - 0.5 ) * 0.35;
  float lane = 1.0 - smoothstep( uLaneHalf - 0.12, uLaneHalf + 0.12, laneD + wob * 0.6 );
  float laneDust = 1.0 - smoothstep( uLaneHalf, uLaneHalf + 1.3, laneD + wob * 0.9 );
  float clearing = 1.0 - smoothstep( -0.8, 1.0, clearD + wob * 1.6 );
  // Dialwood floor: dark, mossy, quiet, with leaf litter
  vec3 jungle = uJungle * ( 0.8 + 0.3 * nMid + 0.08 * ( n3 - 0.5 ) );
  jungle = mix( jungle, uMoss * ( 0.9 + 0.25 * n2 ), smoothstep( 0.5, 0.68, nBig ) * 0.75 );
  jungle = mix( jungle, uEarth * ( 0.85 + 0.2 * n2 ), smoothstep( 0.55, 0.72, valeFbm( p * 0.18 + 11.0 ) ) * 0.5 );
  float litter = step( 0.9, valeHash12( floor( p * 5.0 ) ) ) * smoothstep( 0.3, 0.7, valeNoise( p * 5.0 + 2.0 ) );
  jungle *= 1.0 - litter * 0.22;
  // clearings: packed dust with grit
  vec3 clearC = uClearing * ( 0.9 + 0.14 * ( nMid - 0.5 ) + 0.1 * ( n3 - 0.5 ) );
  // roads: honed irregular pavers, joints quiet, worn toward the centre line
  vec4 pv = valePavers( p, 1.15 );
  float joint = 1.0 - smoothstep( 0.02, 0.06, pv.y );
  float wear = 1.0 - smoothstep( 0.0, uLaneHalf, laneD );
  vec3 laneC = uLane * ( 0.9 + 0.12 * ( pv.x - 0.5 ) + 0.05 * ( n3 - 0.5 ) + 0.06 * wear + 0.06 * ( nMid - 0.5 ) );
  laneC = mix( laneC, uGrout, joint * 0.65 );
  // dusty margin between road and floor
  vec3 dust = mix( uClearing, uEarth, 0.35 ) * ( 0.88 + 0.16 * n2 );
  float texH = 0.0;
  if ( uUseTex > 0.5 ) {
    // painted surfaces: the procedural colour stays the band (value law), the painting adds the detail
    vec3 laneBand = uLane * ( 0.92 + 0.06 * wear + 0.08 * ( nMid - 0.5 ) + 0.05 * ( nBig - 0.5 ) );
    vec3 tRoad = valeTexGrid( uTexRoad, p, uTexScale.x, laneBand, 1.0 );
    vec3 tFloor = valeTexBand( uTexFloor, p, uTexScale.y, jungle, nBig );
    vec3 tClear = valeTexBand( uTexClear, p, uTexScale.z, clearC, nMid );
    vec3 tDust = valeTexBand( uTexDust, p, uTexScale.w, dust, n2 );
    laneC = mix( laneC, tRoad, 0.9 ); jungle = mix( jungle, tFloor, 0.85 ); clearC = mix( clearC, tClear, 0.85 ); dust = mix( dust, tDust, 0.8 );
    texH = ( dot( tRoad / max( laneC, vec3( 0.02 ) ), vec3( 0.333 ) ) - 1.0 ) * 0.025 * lane;
  }
  vec3 col = mix( jungle, clearC, clearing );
  col = mix( col, dust, laneDust * ( 1.0 - lane ) * 0.85 );
  col = mix( col, laneC, lane );
  // carved hour-lines radiating from the dial's centre, and the hour-ring (quiet inscription)
  vec2 rc = p - uCenter; float rr = length( rc );
  float ang = atan( rc.x, -rc.y );
  float seg = 6.2831853 / 12.0;
  float al = abs( mod( ang + seg * 0.5, seg ) - seg * 0.5 ) * rr;
  float hour = ( 1.0 - smoothstep( 0.05, 0.09, al ) ) * smoothstep( 8.0, 14.0, rr );
  if ( uRing > 0.0 ) hour = max( hour, 1.0 - smoothstep( 0.06, 0.1, abs( rr - uRing ) ) );
  if ( uSeat.z > 0.0 ) { float sr = length( p - uSeat.xy ); hour = max( hour, ( 1.0 - smoothstep( 0.08, 0.13, abs( sr - uSeat.z ) ) ) * 1.3 ); }
  col = mix( col, col * 0.78, hour * mix( 0.5, 0.8, lane ) );
  col = mix( col, uInscription * ( 0.9 + 0.1 * n2 ), hour * 0.12 * lane );
  // wall-foot occlusion and the brush floor
  col *= mix( 0.55, 1.0, smoothstep( 0.0, 2.2, wallD + ( n2 - 0.5 ) * 0.6 ) );
  float brush = 1.0 - smoothstep( -0.3, 0.25, thickD );
  col = mix( col, uThicketFloor * ( 0.85 + 0.3 * n2 ), brush * 0.85 );
  diffuseColor.rgb *= col;
  float paverH = smoothstep( 0.0, 0.07, pv.y ) * 0.03 + ( pv.x - 0.5 ) * 0.006;
  gHeight = mix( ( nMid - 0.5 ) * 0.05 + ( n3 - 0.5 ) * 0.02 - litter * 0.01, mix( paverH, texH, uUseTex ) + ( n3 - 0.5 ) * 0.004, lane ) - hour * 0.015;
  gRough = mix( mix( 0.95, 0.9, clearing ), 0.7 + 0.1 * pv.x, lane );
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, gHeight, 1.0 );');
  };
  groundMat.customProgramCacheKey = () => 'vale_ground_v5';
  patchWorldMaterial(groundMat);
  const ground = new Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  ground.name = 'vale_ground';
  group.add(ground);
  disposables.push(groundGeo, groundMat);

  // ── cliffs (raised walls) ──────────────────────────────────────────────────────────────────────
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
  const wallHeights: number[] = [];
  const cliffGeos: BufferGeometry[] = [];
  const addCliff = (poly: Poly, h: number, seed: number, amp: number): void => {
    const outline = organicOutline(poly, 0.9, amp, [SX, SY], seed);
    if (outline.length < 3) return;
    const geo = new ExtrudeGeometry(shapeOf(outline), { depth: h, steps: 3, bevelEnabled: false, curveSegments: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.deleteAttribute('uv');
    const g = geo.index ? geo.toNonIndexed() : geo;
    // chisel: position-based displacement (identical for coincident vertices → no cracks), flat facets
    const pos = g.getAttribute('position') as BufferAttribute;
    const hs = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const onB = Math.abs(x) < 0.02 || Math.abs(z) < 0.02 || Math.abs(x - SX) < 0.02 || Math.abs(z - SY) < 0.02;
      const k = onB ? 0 : amp * 0.9;
      const dx = (vnoise(x * 0.9 + y * 1.3, z * 0.9) - 0.5) * k + (vnoise(x * 2.3, z * 2.3 + y * 2.0) - 0.5) * k * 0.4;
      const dz = (vnoise(z * 0.9 - y * 1.1 + 17.0, x * 0.9) - 0.5) * k + (vnoise(z * 2.3 + 5.0, x * 2.3 - y * 1.7) - 0.5) * k * 0.4;
      const dy = y > h - 0.01 ? (vnoise(x * 0.7, z * 0.7) - 0.5) * 0.18 : 0;
      pos.setXYZ(i, x + dx, y + dy, z + dz);
      hs[i] = h;
    }
    g.setAttribute('aH', new BufferAttribute(hs, 1));
    g.computeVertexNormals();
    cliffGeos.push(g);
    if (g !== geo) geo.dispose();
  };
  walls.forEach((poly, i) => {
    if (chasm[i] || replaced[i]) { wallHeights.push(0); return; }
    const area = Math.abs(signedArea(poly));
    const small = area < 25;
    const h = small ? 1.6 + 0.6 * hash2(i, area) : 2.6 + 0.8 * hash2(i * 3.1, area);
    wallHeights.push(h);
    addCliff(poly, h, i * 7.3, small ? 0.12 : 0.32);
  });
  // outer rim: a carved wall all around the playable plate (gorge maps: only the terrace ends)
  const RIM = 14, RH = 3.4;
  const rimPolys: Poly[] = gorge ? [
    [[-RIM, 0], [0, 0], [0, SY], [-RIM, SY]],
    [[SX, 0], [SX + RIM, 0], [SX + RIM, SY], [SX, SY]],
  ] : [
    [[-RIM, -RIM], [SX + RIM, -RIM], [SX + RIM, 0], [-RIM, 0]],
    [[-RIM, SY], [SX + RIM, SY], [SX + RIM, SY + RIM], [-RIM, SY + RIM]],
    [[-RIM, 0], [0, 0], [0, SY], [-RIM, SY]],
    [[SX, 0], [SX + RIM, 0], [SX + RIM, SY], [SX, SY]],
  ];
  rimPolys.forEach((poly, i) => addCliff(poly, RH, 100 + i, 0));
  const cliffGeo = cliffGeos.length ? mergeGeometries(cliffGeos, false) : new BufferGeometry();
  for (const g of cliffGeos) g.dispose();
  const cliffMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.84, metalness: 0 });
  const cu = {
    uTop: { value: lin(colors.cliffTop) }, uFace: { value: lin(colors.cliffFace) }, uMossC: { value: lin(colors.moss) },
    uUseTex: { value: 0 }, uTexCliff: { value: white }, uTexTop: { value: white }, uTexScale2: { value: new Vector2(TEX_SCALE.cliff, TEX_SCALE.cliffTop) },
  };
  cliffMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, cu);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aH; varying vec3 vCliffW; varying vec3 vCliffN; varying float vH;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCliffW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz; vCliffN = normalize( mat3( modelMatrix ) * objectNormal ); vH = aH;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vCliffW; varying vec3 vCliffN; varying float vH; uniform vec3 uTop, uFace, uMossC; float cH;
uniform float uUseTex; uniform sampler2D uTexCliff, uTexTop; uniform vec2 uTexScale2;
${NOISE_GLSL}
${TEX_GLSL}`)
      .replace('#include <map_fragment>', `
{
  vec3 n = normalize( vCliffN );
  float top = smoothstep( 0.6, 0.9, n.y );
  vec2 hp = vCliffW.xz;
  float along = dot( vCliffW.xz, normalize( vec2( n.z, -n.x ) + 1e-4 ) );
  float n1 = valeFbm( hp * 0.35 ), n3 = valeNoise( hp * 6.0 + vCliffW.y );
  // strata: wavy horizontal beds, darker seams, a few vertical fractures
  float bed = vCliffW.y * 2.4 + ( valeNoise( vec2( along * 0.25, 1.7 ) ) - 0.5 ) * 1.6;
  float seam = 1.0 - smoothstep( 0.0, 0.12, abs( fract( bed ) - 0.5 ) - 0.38 );
  float frac = 1.0 - smoothstep( 0.0, 0.05, abs( valeNoise( vec2( along * 0.8, vCliffW.y * 0.3 ) ) - 0.5 ) );
  vec3 face = uFace * ( 0.82 + 0.3 * valeNoise( vec2( along * 0.6, vCliffW.y * 1.5 ) ) + 0.08 * ( n3 - 0.5 ) );
  face *= mix( 0.55, 1.0, smoothstep( 0.0, 1.8, vCliffW.y ) );
  face = mix( face, face * 0.6, max( seam * 0.7, frac * 0.5 ) );
  // lit, worn rim just under the top edge
  float rim = smoothstep( vH - 0.45, vH - 0.05, vCliffW.y ) * ( 1.0 - top );
  face = mix( face, uTop * 0.82, rim * 0.6 );
  vec3 topC = uTop * ( 0.84 + 0.22 * n1 + 0.08 * ( n3 - 0.5 ) );
  topC = mix( topC, uMossC * 1.1, smoothstep( 0.52, 0.7, valeFbm( vCliffW.xz * 0.16 + 9.0 ) ) * 0.6 );
  if ( uUseTex > 0.5 ) {
    // faces: the strata painting runs along the wall (u = along the face, v = height); tops: planar
    vec3 tFace = valeTexGrid( uTexCliff, vec2( along, vCliffW.y * 1.4 ), uTexScale2.x, face, 0.9 );
    vec3 tTop = valeTexBand( uTexTop, vCliffW.xz, uTexScale2.y, topC, n1 );
    face = mix( face, tFace, 0.85 ); topC = mix( topC, mix( topC, tTop, 0.55 ), 0.9 );
  }
  diffuseColor.rgb *= mix( face, topC, top );
  cH = ( 1.0 - top ) * ( -seam * 0.03 - frac * 0.02 + ( n3 - 0.5 ) * 0.02 ) + top * ( n3 - 0.5 ) * 0.012;
}`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = valeBump( -vViewPosition, normal, cH, 1.0 );');
  };
  cliffMat.customProgramCacheKey = () => 'vale_cliff_v5';
  patchWorldMaterial(cliffMat);
  const cliffs = new Mesh(cliffGeo, cliffMat);
  cliffs.castShadow = true; cliffs.receiveShadow = true; cliffs.name = 'vale_cliffs';
  group.add(cliffs);
  disposables.push(cliffGeo, cliffMat);

  // ── chasms (gorge style): the ground opens; sheer walls drop into the mist ─────────────────────
  if (gorge) {
    const DEPTH = 22;
    const chasmPolys: Poly[] = walls.filter((_, i) => chasm[i]);
    const nWalls = chasmPolys.length;
    chasmPolys.push([[-MARGIN, -MARGIN], [SX + MARGIN, -MARGIN], [SX + MARGIN, 0], [-MARGIN, 0]]);
    chasmPolys.push([[-MARGIN, SY], [SX + MARGIN, SY], [SX + MARGIN, SY + MARGIN], [-MARGIN, SY + MARGIN]]);
    const geos: BufferGeometry[] = [];
    chasmPolys.forEach((poly, i) => {
      const outline = i < nWalls ? organicOutline(poly, 1.0, 0.25, [SX, SY], 40 + i) : poly.slice();
      const geo = new ExtrudeGeometry(shapeOf(outline), { depth: DEPTH, steps: 4, bevelEnabled: false, curveSegments: 1 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -DEPTH, 0);
      geo.deleteAttribute('uv');
      const g = geo.index ? geo.toNonIndexed() : geo;
      const pos = g.getAttribute('position') as BufferAttribute;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        if (y > -0.05) continue;
        const a = Math.min(1, -y / 3) * 0.6;
        pos.setXYZ(k, x + (vnoise(x * 0.6 + y, z * 0.6) - 0.5) * a, y, z + (vnoise(z * 0.6 - y, x * 0.6 + 3.0) - 0.5) * a);
      }
      g.computeVertexNormals();
      geos.push(g);
      if (g !== geo) geo.dispose();
    });
    const chasmGeo = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    const chasmMat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: BackSide });
    const ch = { uFaceC: { value: lin(colors.cliffFace) }, uMist: { value: lin(colors.mist) } };
    chasmMat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, ch);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vChW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvChW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vChW; uniform vec3 uFaceC, uMist;\n${NOISE_GLSL}`)
        .replace('#include <map_fragment>', `
{
  float bed = 1.0 - smoothstep( 0.0, 0.1, abs( fract( vChW.y * 1.6 + valeNoise( vChW.xz * 0.3 ) ) - 0.5 ) - 0.4 );
  vec3 c = uFaceC * ( 0.75 + 0.3 * valeNoise( vChW.xz * 0.8 + vChW.y ) ) * ( 1.0 - bed * 0.35 );
  diffuseColor.rgb *= c;
}`)
        .replace('#include <opaque_fragment>', `
{
  // gorge mist: the deeper, the more the stone dissolves into the gorge colour (height fog, never camera distance)
  float m = 1.0 - exp( -max( 0.0, -vChW.y - 1.5 ) * 0.16 );
  outgoingLight = mix( outgoingLight, uMist * 0.55, m );
}
#include <opaque_fragment>`);
    };
    chasmMat.customProgramCacheKey = () => 'vale_chasm_v1';
    patchWorldMaterial(chasmMat);
    const chasmMesh = new Mesh(chasmGeo, chasmMat);
    chasmMesh.receiveShadow = true; chasmMesh.name = 'vale_chasm';
    group.add(chasmMesh);
    disposables.push(chasmGeo, chasmMat);
  }

  // ── Needlegrass (brush) + curb ───────────────────────────────────────────────────────────────
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
  const grassItems: { m: Matrix4 }[] = [];
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
          if (e < 0.15) continue;
          q.setFromAxisAngle(up, rand() * Math.PI * 2);
          const kk = 0.8 + rand() * 0.45;
          const hh = (0.85 + rand() * 0.35) * (e < 0.6 ? 0.8 : 1);
          s.set(kk, hh, kk);
          pos.set(jx, 0, jy);
          grassItems.push({ m: new Matrix4().compose(pos, q, s) });
        }
      }
    });
  }
  if (grassItems.length) group.add(chunked(clump, grassMat, grassItems, 'vale_needlegrass'));
  disposables.push(clump, grassMat);
  // curb: thin carved stone band along every brush outline
  const curbGeos: BufferGeometry[] = [];
  for (const poly of thickets) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0], ay = poly[j][1], bx = poly[i][0], by = poly[i][1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      const g = new BoxGeometry(len + 0.2, 0.12, 0.2);
      g.rotateY(-Math.atan2(by - ay, bx - ax));
      g.translate((ax + bx) / 2, 0.05, (ay + by) / 2);
      g.deleteAttribute('uv');
      curbGeos.push(g);
    }
  }
  if (curbGeos.length) {
    const curbGeo = mergeGeometries(curbGeos, false);
    for (const g of curbGeos) g.dispose();
    const curbMat = new MeshStandardMaterial({ color: lin(colors.curb), roughness: 0.8 });
    patchWorldMaterial(curbMat);
    const curb = new Mesh(curbGeo, curbMat);
    curb.receiveShadow = true; curb.castShadow = false; curb.name = 'vale_curb';
    group.add(curb);
    disposables.push(curbGeo, curbMat);
  }

  // ── Standing Shadow + Fallen Shaft (terrain marks from the map's terrain block) ────────────────
  const noon = tr.noonline as Record<string, unknown> | undefined;
  const shadowDef = noon?.standingShadow as { floor?: unknown; tint?: unknown } | undefined;
  /** the shadow floor takes the painted road stone under its tint once textures land (ShapeGeometry UVs are metres) */
  const shadowFills: { mat: MeshStandardMaterial; tint: Color }[] = [];
  for (const poly of polysOf(shadowDef?.floor)) {
    const tint = typeof shadowDef?.tint === 'string' ? shadowDef.tint : '#4A4560';
    const fill = new ShapeGeometry(shapeOf(poly), 1);
    fill.rotateX(-Math.PI / 2);
    fill.translate(0, 0.012, 0);
    const mat = new MeshStandardMaterial({ color: lin(tint), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    patchWorldMaterial(mat, { keepColor: true });
    shadowFills.push({ mat, tint: lin(tint) });
    const mesh = new Mesh(fill, mat);
    mesh.receiveShadow = true; mesh.name = 'vale_standing_shadow';
    group.add(mesh);
    // engraved edge: a darker band just inside the outline (hard edge)
    const outer = shapeOf(poly);
    const inner = insetPolygon(outer.getPoints(), 0.16);
    outer.holes.push(new Shape(inner.slice().reverse()));
    const band = new ShapeGeometry(outer, 1);
    band.rotateX(-Math.PI / 2);
    band.translate(0, 0.016, 0);
    const bmat = new MeshStandardMaterial({ color: lin(tint).multiplyScalar(0.45), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    patchWorldMaterial(bmat, { keepColor: true });
    const bm = new Mesh(band, bmat);
    bm.receiveShadow = true;
    group.add(bm);
    disposables.push(fill, mat, band, bmat);
  }
  const shaftDef = noon?.fallenShaft as { floor?: unknown } | undefined;
  for (const poly of polysOf(shaftDef?.floor)) {
    const geo = new ShapeGeometry(shapeOf(poly), 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.014, 0);
    // shallow water over pale stone: a thin tinted film the floor shows through, slow crossing ripples
    // catching the sky (an opaque gloss only mirrored the flat sky as a grey sheet)
    const mat = new MeshStandardMaterial({ color: lin('#4F6B70'), roughness: 0.16, metalness: 0, transparent: true, opacity: 0.5, depthWrite: false,
      envMapIntensity: 0.45, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uWaterT = worldUniforms.valeTime;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uWaterT;\n${NOISE_GLSL}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
  {
    vec2 wp = vValeWorld.xz;
    float h = valeNoise( wp * 1.7 + vec2( uWaterT * 0.35, uWaterT * 0.21 ) ) + 0.55 * valeNoise( wp * 3.9 - vec2( uWaterT * 0.47, -uWaterT * 0.29 ) );
    normal = valeBump( -vViewPosition, normal, h, 0.06 );
  }`);
    };
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
    if (chasm[i] || wallHeights[i] < 2.2) return;
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
      const off = 0.25 + rand() * 0.6;
      const t = rand();
      const x = a[0] + nx * off + dx * t, y = a[1] + ny * off + dy * t;
      if (x < 0.5 || y < 0.5 || x > SX - 0.5 || y > SY - 0.5) continue;
      let ok = true;
      for (const ln of lanes) for (let j = 1; j < ln.length && ok; j++) if (segDist(x, y, ln[j - 1][0], ln[j - 1][1], ln[j][0], ln[j][1]) < LANE_HALF + 0.6) ok = false;
      for (const c of clearings) if (ok && Math.hypot(x - c.x, y - c.y) < c.r) ok = false;
      if (ok && onMark(x, y)) ok = false;
      if (ok) boulderSpots.push({ x, y, s: 0.35 + Math.pow(rand(), 1.6) * 0.75, r: rand() * Math.PI * 2 });
    }
  });
  const stoneSpots: { x: number; y: number; s: number; r: number }[] = [];
  const nStones = Math.round(SX * SY * 0.02);
  for (let k = 0; k < nStones; k++) {
    const x = rand() * SX, y = rand() * SY;
    let ok = true;
    for (const l of lanes) for (let i = 1; i < l.length && ok; i++) if (segDist(x, y, l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]) < LANE_HALF + 1.2) ok = false;
    for (const c of clearings) if (ok && Math.hypot(x - c.x, y - c.y) < c.r + 0.8) ok = false;
    for (let w = 0; w < walls.length && ok; w++) if (boxDist(x, y, wallBoxes[w]) < 0.6 && (pointInPolygon(x, y, walls[w]) || polyEdgeDist(x, y, walls[w]) < 0.6)) ok = false;
    for (let t = 0; t < thickets.length && ok; t++) if (boxDist(x, y, thicketBoxes[t]) < 0.5 && pointInPolygon(x, y, thickets[t])) ok = false;
    if (ok && onMark(x, y)) ok = false;
    if (ok) stoneSpots.push({ x, y, s: 0.1 + Math.pow(rand(), 2.2) * 0.32, r: rand() * Math.PI * 2 });
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
    for (const g of scatterParts) scatterGroup.add(g);
  };
  setScatter(2);

  return {
    group,
    wallHeights,
    setScatter,
    setTextures(t: Partial<Record<TerrainTexRole, Texture>>): void {
      if (t.road) gu.uTexRoad.value = t.road;
      if (t.floor) gu.uTexFloor.value = t.floor;
      if (t.clearing) gu.uTexClear.value = t.clearing;
      if (t.dust) gu.uTexDust.value = t.dust;
      gu.uUseTex.value = t.road && t.floor && t.clearing && t.dust ? 1 : 0;
      if (t.cliff) cu.uTexCliff.value = t.cliff;
      if (t.cliffTop) cu.uTexTop.value = t.cliffTop;
      cu.uUseTex.value = t.cliff && t.cliffTop ? 1 : 0;
      if (t.road && shadowFills.length) {
        const tx = t.road.clone();                                       // the pit is paved: the dial's own stone
        tx.repeat.set(1 / TEX_SCALE.road, 1 / TEX_SCALE.road);
        tx.needsUpdate = true;
        disposables.push(tx);
        // lift the tint a little so the textured mean keeps the designed value (L* 30-36)
        for (const f of shadowFills) { f.mat.map = tx; f.mat.color.copy(f.tint).multiplyScalar(1.3); f.mat.needsUpdate = true; }
      }
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
