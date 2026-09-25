// DYEFIELD — map geometry extraction (CONTRACT §3.1, §4.4). THREE-free, DOM-free, Node-safe.
//
// Turns a parsed map GLB into the three things the sim needs:
//   * `paint`     — every `paint_*` triangle merged into one soup with world positions, normals,
//                   the paint-atlas UV (TEXCOORD_1) and a per-triangle material index;
//   * `collision` — `paint_*` ∪ `solid_*` ∪ `col_*` triangles (world space);
//   * spawns + the `mapinfo` extras (atlas size, achieved texel density, authored paint area).
//
// Node-name prefix rules (§3.1): the prefix of the node's own name decides behaviour. If a mesh
// node's own name carries no known prefix, the nearest ancestor with one is used (an exporter
// that wraps objects in collection nodes still classifies correctly). `deco_*` and `water_*`
// are visual only and ignored here; unknown names are ignored too.
//
// CHANGED(MAPSIM) (CONTRACT_P6_11 §19, CONTRACT_ART_P6_8 §14.2), additive: `geo.features` carries the
// phase 7–8 map features —
//   * `grate_*`    runner-only collision (its own soup; paint, projectiles and sight rays pass through);
//   * `conveyor_*` collision (in `collision`) + the node extra `df_conveyor` [vx, vy, vz] m/s and the
//                  belt's up-facing triangles (a grounded runner standing on one is carried);
//   * `spring_*`   collision (in `collision`) + a stand-on launch pad: `df_launch` [vx, vy, vz] m/s,
//                  optional `df_land` / `df_flight`; the pad disc = the mesh AABB (centre, top, radius);
//   * `oob_*`      no collision: volumes (mesh AABB) — feet inside = WASHED (cause 'sea');
//   * `light_*`    empties with `df_light` {color, intensity, range};
//   * `mapinfo.df_ao` → `features.ao` (the AO map file name, or null).
// `collision` = paint_* ∪ solid_* ∪ col_* ∪ conveyor_* ∪ spring_* (every MAP_SOLID triangle); a map
// without the new prefixes (Pier 18) yields exactly the soup it did before.
//
// Spawn yaw: MAP authors each spawn empty with its Blender "forward" along the empty's local −Y.
// The glTF exporter maps Blender (x, y, z) → glTF (x, z, −y) for the axes of every node, so that
// forward arrives as the empty's glTF LOCAL +Z axis, which MAP orients to point into the arena.
// Its world direction is column 2 of the node's world matrix (world[8], world[10] on the XZ
// plane), and yaw = atan2(dir.x, dir.z) under the CONTRACT convention (0 faces +Z, +π/2 faces +X).
// The spawn position is the matrix translation (world[12..14]) = the pad's top centre.
// If a spawn empty is missing, the map falls back to maps.json `spawns` (yaw there is degrees).

import type { Side } from './types.ts';
import { DEG } from './types.ts';
import type { MapDef } from './data.ts';
import type { GlbDoc, GlbMeshPart } from './glb.ts';
import { artUrl, loadGlb } from './glb.ts';

export interface TriSoup {
  positions: Float32Array; normals: Float32Array; uv1: Float32Array; indices: Uint32Array;
  triMaterial: Uint16Array; materials: string[];
}

export interface MapGeometry {
  id: string;
  paint: TriSoup;                                              // all paint_* merged
  collision: { positions: Float32Array; indices: Uint32Array }; // paint_* ∪ solid_* ∪ col_* ∪ conveyor_* ∪ spring_*
  spawns: Record<Side, { x: number; y: number; z: number; yaw: number }>;
  atlasSize: number; texelsPerMeter: number; paintArea: number;
  info: Record<string, unknown>;                               // mapinfo extras
  /** CHANGED(MAPSIM): phase 7–8 map features (grates, conveyors, springs, oob volumes, lights, AO). Always set by extractMapGeometry. */
  features?: MapFeatures;
}

export type Vec3Tuple = [number, number, number];

/** A moving belt (`conveyor_*`): grounded runners standing on its up-facing triangles are carried at `vel`. */
export interface MapConveyor {
  name: string;
  /** df_conveyor: world m/s */
  vel: Vec3Tuple;
  min: Vec3Tuple; max: Vec3Tuple;
  /** up-facing triangles (ny ≥ 0.5), 9 floats each (world xyz × 3) */
  top: Float32Array;
}

/** A tide-spring pad (`spring_*`): stepping onto the disc launches the runner at `launch`. */
export interface MapSpring {
  name: string;
  /** disc centre (x, z), pad top y, disc radius (from the mesh AABB) */
  x: number; y: number; z: number; r: number;
  /** df_launch: m/s */
  launch: Vec3Tuple;
  /** df_land (the authored landing point) or null */
  land: Vec3Tuple | null;
  /** df_flight (s) or null */
  flight: number | null;
  min: Vec3Tuple; max: Vec3Tuple;
}

/** An `oob_*` volume (mesh AABB): feet inside = WASHED (cause 'sea'). */
export interface MapOob { name: string; min: Vec3Tuple; max: Vec3Tuple }

/** A `light_*` empty (df_light). */
export interface MapLight { name: string; x: number; y: number; z: number; color: string; intensity: number; range: number }

export interface MapFeatures {
  /** grate_* triangles: runner collision only */
  grates: { positions: Float32Array; indices: Uint32Array };
  /** col_* triangles (collision proxies, e.g. the stair wedges): walkable floor for the nav (also inside `collision`) */
  col: { positions: Float32Array; indices: Uint32Array };
  conveyors: MapConveyor[];
  springs: MapSpring[];
  oob: MapOob[];
  lights: MapLight[];
  /** mapinfo.df_ao (file name next to the GLB) or null */
  ao: string | null;
}

/** The features of a map without any (a geometry built before phase 7, or a synthetic one). */
export const NO_FEATURES: MapFeatures = Object.freeze({
  grates: { positions: new Float32Array(0), indices: new Uint32Array(0) },
  col: { positions: new Float32Array(0), indices: new Uint32Array(0) },
  conveyors: [], springs: [], oob: [], lights: [], ao: null,
}) as MapFeatures;

/** geo.features, or NO_FEATURES */
export function featuresOf(geo: { features?: MapFeatures }): MapFeatures {
  return geo.features ?? NO_FEATURES;
}

const EPS_XZ = 1e-6;

/**
 * CHANGED(MAPSIM): the conveyor whose belt top lies under (x, z) within ±tol of the feet height y,
 * or −1. Pure geometry on the belt's up-facing triangles (no physics query; deterministic).
 */
export function conveyorAt(f: MapFeatures, x: number, y: number, z: number, tol = 0.2): number {
  const C = f.conveyors;
  for (let i = 0; i < C.length; i++) {
    const c = C[i];
    if (x < c.min[0] || x > c.max[0] || z < c.min[2] || z > c.max[2] || y < c.min[1] - tol || y > c.max[1] + tol) continue;
    const T = c.top;
    for (let o = 0; o + 8 < T.length; o += 9) {
      const x0 = T[o], y0 = T[o + 1], z0 = T[o + 2], x1 = T[o + 3], y1 = T[o + 4], z1 = T[o + 5], x2 = T[o + 6], y2 = T[o + 7], z2 = T[o + 8];
      const d0 = (x1 - x0) * (z - z0) - (z1 - z0) * (x - x0);
      const d1 = (x2 - x1) * (z - z1) - (z2 - z1) * (x - x1);
      const d2 = (x0 - x2) * (z - z2) - (z0 - z2) * (x - x2);
      if ((d0 < -EPS_XZ || d1 < -EPS_XZ || d2 < -EPS_XZ) && (d0 > EPS_XZ || d1 > EPS_XZ || d2 > EPS_XZ)) continue;
      // barycentric height of the plane at (x, z)
      const den = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(den) < 1e-12) continue;
      const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / den;
      const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / den;
      const h = a * y0 + b * y1 + (1 - a - b) * y2;
      if (Math.abs(y - h) <= tol) return i;
    }
  }
  return -1;
}

/** CHANGED(MAPSIM): the spring pad whose disc holds (x, z) with feet y in [top − below, top + above], or −1. */
export function springAt(f: MapFeatures, x: number, y: number, z: number, below = 0.4, above = 0.3): number {
  const S = f.springs;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    const dx = x - s.x, dz = z - s.z;
    if (dx * dx + dz * dz <= s.r * s.r && y >= s.y - below && y <= s.y + above) return i;
  }
  return -1;
}

/** CHANGED(MAPSIM): the oob_ volume holding the point (inclusive AABB), or −1. */
export function oobAt(f: MapFeatures, x: number, y: number, z: number): number {
  const O = f.oob;
  for (let i = 0; i < O.length; i++) {
    const o = O[i];
    if (x >= o.min[0] && x <= o.max[0] && y >= o.min[1] && y <= o.max[1] && z >= o.min[2] && z <= o.max[2]) return i;
  }
  return -1;
}

export type NodeKind = 'paint' | 'solid' | 'deco' | 'col' | 'water' | 'grate' | 'conveyor' | 'spring' | 'oob' | 'light' | null;

const PREFIXES: ReadonlyArray<readonly [string, Exclude<NodeKind, null>]> = [
  ['paint_', 'paint'], ['solid_', 'solid'], ['deco_', 'deco'], ['col_', 'col'], ['water_', 'water'],
  ['grate_', 'grate'], ['conveyor_', 'conveyor'], ['spring_', 'spring'], ['oob_', 'oob'], ['light_', 'light'],
];

/** Prefix classification of a single name (CONTRACT §3.1). */
export function kindOfName(name: string): NodeKind {
  for (const [p, k] of PREFIXES) if (name.startsWith(p)) return k;
  return null;
}

function kindOfNode(doc: GlbDoc, name: string, cache: Map<string, NodeKind>): NodeKind {
  const hit = cache.get(name);
  if (hit !== undefined) return hit;
  let k = kindOfName(name);
  if (k === null) {
    let idx = doc.nodes.findIndex((n) => n.name === name);
    let guard = 0;
    while (k === null && idx >= 0 && guard++ < 256) {
      idx = doc.nodes[idx].parent;
      if (idx >= 0) k = kindOfName(doc.nodes[idx].name);
    }
  }
  cache.set(name, k);
  return k;
}

/** Area-weighted vertex normals for a part that was exported without NORMAL. */
function computeNormals(pos: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(pos.length);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    for (const v of [a, b, c]) { n[v] += cx; n[v + 1] += cy; n[v + 2] += cz; }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]);
    if (l > 0) { n[v] /= l; n[v + 1] /= l; n[v + 2] /= l; } else { n[v + 1] = 1; }
  }
  return n;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Sum of triangle world areas of a soup (m²). */
export function soupArea(positions: Float32Array, indices: Uint32Array): number {
  let s = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    s += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  }
  return s;
}

/** Merge mesh parts into one world-space soup. */
function mergeParts(parts: GlbMeshPart[]): { positions: Float32Array; indices: Uint32Array } {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.positions.length / 3; ni += p.indices.length; }
  const positions = new Float32Array(nv * 3);
  const indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo * 3);
    for (let k = 0; k < p.indices.length; k++) indices[io + k] = p.indices[k] + vo;
    vo += p.positions.length / 3;
    io += p.indices.length;
  }
  return { positions, indices };
}

function aabbOf(parts: GlbMeshPart[]): { min: Vec3Tuple; max: Vec3Tuple } {
  const min: Vec3Tuple = [Infinity, Infinity, Infinity], max: Vec3Tuple = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const P = p.positions;
    for (let i = 0; i < P.length; i += 3) {
      for (let k = 0; k < 3; k++) { if (P[i + k] < min[k]) min[k] = P[i + k]; if (P[i + k] > max[k]) max[k] = P[i + k]; }
    }
  }
  return { min, max };
}

function vec3Extra(v: unknown): Vec3Tuple | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const a = num(v[0]), b = num(v[1]), c = num(v[2]);
  return a === null || b === null || c === null ? null : [a, b, c];
}

/** a node extra by key, looked up on the node itself, then its ancestors */
function extraOf(doc: GlbDoc, name: string, key: string): unknown {
  let idx = doc.nodes.findIndex((n) => n.name === name);
  let guard = 0;
  while (idx >= 0 && guard++ < 256) {
    const ex = doc.nodes[idx].extras;
    if (ex && key in ex) return ex[key];
    idx = doc.nodes[idx].parent;
  }
  return undefined;
}

/** Group parts by node name, in first-seen (document) order. */
function byNode(parts: GlbMeshPart[]): Array<[string, GlbMeshPart[]]> {
  const m = new Map<string, GlbMeshPart[]>();
  for (const p of parts) { const l = m.get(p.node); if (l) l.push(p); else m.set(p.node, [p]); }
  return [...m.entries()];
}

function extractFeatures(doc: GlbDoc, def: MapDef, info: Record<string, unknown>,
  grateParts: GlbMeshPart[], conveyorParts: GlbMeshPart[], springParts: GlbMeshPart[], oobParts: GlbMeshPart[],
  colOnlyParts: GlbMeshPart[], cache: Map<string, NodeKind>): MapFeatures {
  const conveyors: MapConveyor[] = [];
  for (const [name, parts] of byNode(conveyorParts)) {
    const vel = vec3Extra(extraOf(doc, name, 'df_conveyor'));
    if (!vel) throw new Error(`[mapgeo] ${def.id}: conveyor node '${name}' has no df_conveyor [vx, vy, vz] extra`);
    const top: number[] = [];
    for (const p of parts) {
      const P = p.positions, I = p.indices;
      for (let t = 0; t + 2 < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
        const l = Math.hypot(gx, gy, gz);
        if (l < 1e-9 || gy / l < 0.5) continue;
        for (const o of [a, b, c]) top.push(P[o], P[o + 1], P[o + 2]);
      }
    }
    const bb = aabbOf(parts);
    conveyors.push({ name, vel, min: bb.min, max: bb.max, top: new Float32Array(top) });
  }
  const springs: MapSpring[] = [];
  for (const [name, parts] of byNode(springParts)) {
    const launch = vec3Extra(extraOf(doc, name, 'df_launch'));
    if (!launch) throw new Error(`[mapgeo] ${def.id}: spring node '${name}' has no df_launch [vx, vy, vz] extra`);
    const bb = aabbOf(parts);
    springs.push({
      name, launch, land: vec3Extra(extraOf(doc, name, 'df_land')), flight: num(extraOf(doc, name, 'df_flight')),
      x: (bb.min[0] + bb.max[0]) / 2, y: bb.max[1], z: (bb.min[2] + bb.max[2]) / 2,
      r: Math.min(bb.max[0] - bb.min[0], bb.max[2] - bb.min[2]) / 2,
      min: bb.min, max: bb.max,
    });
  }
  const oob: MapOob[] = [];
  for (const [name, parts] of byNode(oobParts)) { const bb = aabbOf(parts); oob.push({ name, min: bb.min, max: bb.max }); }
  const lights: MapLight[] = [];
  for (const n of doc.nodes) {
    if (kindOfNode(doc, n.name, cache) !== 'light') continue;
    const L = extraOf(doc, n.name, 'df_light') as Record<string, unknown> | undefined;
    if (!L || typeof L !== 'object') continue;
    lights.push({
      name: n.name, x: n.world[12], y: n.world[13], z: n.world[14],
      color: typeof L.color === 'string' ? L.color : '#FFFFFF', intensity: num(L.intensity) ?? 1, range: num(L.range) ?? 10,
    });
  }
  return {
    grates: mergeParts(grateParts), col: mergeParts(colOnlyParts), conveyors, springs, oob, lights,
    ao: typeof info.df_ao === 'string' ? info.df_ao : null,
  };
}

export function extractMapGeometry(doc: GlbDoc, def: MapDef): MapGeometry {
  const cache = new Map<string, NodeKind>();
  const paintParts: GlbMeshPart[] = [];
  const colParts: GlbMeshPart[] = [];
  const grateParts: GlbMeshPart[] = [], conveyorParts: GlbMeshPart[] = [], springParts: GlbMeshPart[] = [], oobParts: GlbMeshPart[] = [];
  const colOnlyParts: GlbMeshPart[] = [];
  for (const part of doc.parts) {
    const k = kindOfNode(doc, part.node, cache);
    if (k === 'paint') {
      if (!part.uv1) throw new Error(`[mapgeo] ${def.id}: paint node '${part.node}' has no TEXCOORD_1 (Atlas UV map)`);
      paintParts.push(part);
      colParts.push(part);
    } else if (k === 'solid' || k === 'col') {
      colParts.push(part);
      if (k === 'col') colOnlyParts.push(part);
    } else if (k === 'conveyor') {
      colParts.push(part); conveyorParts.push(part);
    } else if (k === 'spring') {
      colParts.push(part); springParts.push(part);
    } else if (k === 'grate') {
      grateParts.push(part);
    } else if (k === 'oob') {
      oobParts.push(part);
    }
  }
  if (paintParts.length === 0) throw new Error(`[mapgeo] ${def.id}: the GLB has no paint_* mesh nodes`);

  // ── paint soup ──
  let pv = 0, pi = 0;
  for (const p of paintParts) { pv += p.positions.length / 3; pi += p.indices.length; }
  const positions = new Float32Array(pv * 3);
  const normals = new Float32Array(pv * 3);
  const uv1 = new Float32Array(pv * 2);
  const indices = new Uint32Array(pi);
  const triMaterial = new Uint16Array(pi / 3);
  const materials: string[] = [];
  const matIndex = new Map<string, number>();
  let vo = 0, io = 0;
  for (const p of paintParts) {
    const nv = p.positions.length / 3;
    positions.set(p.positions, vo * 3);
    normals.set(p.normals ?? computeNormals(p.positions, p.indices), vo * 3);
    uv1.set(p.uv1 as Float32Array, vo * 2);
    let mi = matIndex.get(p.material);
    if (mi === undefined) {
      mi = materials.length;
      if (mi > 0xffff) throw new Error(`[mapgeo] ${def.id}: more than 65535 paint materials`);
      materials.push(p.material);
      matIndex.set(p.material, mi);
    }
    for (let k = 0; k < p.indices.length; k++) indices[io + k] = p.indices[k] + vo;
    triMaterial.fill(mi, io / 3, (io + p.indices.length) / 3);
    vo += nv;
    io += p.indices.length;
  }
  const paint: TriSoup = { positions, normals, uv1, indices, triMaterial, materials };

  // ── collision soup ──
  const { positions: cpos, indices: cidx } = mergeParts(colParts);

  // ── spawns ──
  const spawns = {} as Record<Side, { x: number; y: number; z: number; yaw: number }>;
  for (const side of ['A', 'B'] as const) {
    const node = doc.nodes.find((n) => n.name === `spawn_${side}`);
    if (node) {
      const w = node.world;
      const fx = w[8], fz = w[10];
      const yaw = Math.hypot(fx, fz) > 1e-9 ? Math.atan2(fx, fz) : 0;
      spawns[side] = { x: w[12], y: w[13], z: w[14], yaw };
    } else {
      const s = def.spawns?.[side];
      if (!s) throw new Error(`[mapgeo] ${def.id}: no spawn_${side} empty in the GLB and no maps.json spawns.${side}`);
      spawns[side] = { x: s.pos[0], y: s.pos[1], z: s.pos[2], yaw: s.yaw * DEG };
    }
  }

  // ── mapinfo extras ──
  const infoNode = doc.nodes.find((n) => n.name === 'mapinfo');
  const info: Record<string, unknown> = infoNode?.extras ? { ...infoNode.extras } : {};
  const extrasId = info.df_map_id;
  if (typeof extrasId === 'string' && extrasId !== def.id) {
    throw new Error(`[mapgeo] GLB mapinfo.df_map_id='${extrasId}' but the map definition is '${def.id}' (wrong file?)`);
  }
  const area = num(info.df_paint_area) ?? soupArea(positions, indices);
  const tpm = num(info.df_texels_per_meter) ?? def.paint?.texelsPerMeter ?? 10;
  let atlasSize = num(info.df_atlas_size);
  if (atlasSize === null) {
    // fallback: smallest power of two holding the area at the wanted density with ~70 % packing
    const want = def.paint?.texelsPerMeter ?? 10;
    const cap = def.paint?.atlasMax ?? 2048;
    atlasSize = 512;
    while (atlasSize < cap && atlasSize * atlasSize * 0.7 < area * want * want) atlasSize *= 2;
  }
  if (!Number.isInteger(atlasSize) || atlasSize < 16 || atlasSize > 8192) {
    throw new Error(`[mapgeo] ${def.id}: bad df_atlas_size ${atlasSize}`);
  }

  return {
    id: def.id,
    paint,
    collision: { positions: cpos, indices: cidx },
    spawns,
    atlasSize,
    texelsPerMeter: tpm,
    paintArea: area,
    info,
    features: extractFeatures(doc, def, info, grateParts, conveyorParts, springParts, oobParts, colOnlyParts, cache),
  };
}

export async function loadMapGeometry(def: MapDef): Promise<MapGeometry> {
  const doc = await loadGlb(artUrl(`map_${def.id}.glb`));
  return extractMapGeometry(doc, def);
}
