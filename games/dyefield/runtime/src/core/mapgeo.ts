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
  collision: { positions: Float32Array; indices: Uint32Array }; // paint_* ∪ solid_* ∪ col_*
  spawns: Record<Side, { x: number; y: number; z: number; yaw: number }>;
  atlasSize: number; texelsPerMeter: number; paintArea: number;
  info: Record<string, unknown>;                               // mapinfo extras
}

export type NodeKind = 'paint' | 'solid' | 'deco' | 'col' | 'water' | null;

const PREFIXES: ReadonlyArray<readonly [string, Exclude<NodeKind, null>]> = [
  ['paint_', 'paint'], ['solid_', 'solid'], ['deco_', 'deco'], ['col_', 'col'], ['water_', 'water'],
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

export function extractMapGeometry(doc: GlbDoc, def: MapDef): MapGeometry {
  const cache = new Map<string, NodeKind>();
  const paintParts: GlbMeshPart[] = [];
  const colParts: GlbMeshPart[] = [];
  for (const part of doc.parts) {
    const k = kindOfNode(doc, part.node, cache);
    if (k === 'paint') {
      if (!part.uv1) throw new Error(`[mapgeo] ${def.id}: paint node '${part.node}' has no TEXCOORD_1 (Atlas UV map)`);
      paintParts.push(part);
      colParts.push(part);
    } else if (k === 'solid' || k === 'col') {
      colParts.push(part);
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
  let cv = 0, ci = 0;
  for (const p of colParts) { cv += p.positions.length / 3; ci += p.indices.length; }
  const cpos = new Float32Array(cv * 3);
  const cidx = new Uint32Array(ci);
  vo = 0; io = 0;
  for (const p of colParts) {
    cpos.set(p.positions, vo * 3);
    for (let k = 0; k < p.indices.length; k++) cidx[io + k] = p.indices[k] + vo;
    vo += p.positions.length / 3;
    io += p.indices.length;
  }

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
  };
}

export async function loadMapGeometry(def: MapDef): Promise<MapGeometry> {
  const doc = await loadGlb(artUrl(`map_${def.id}.glb`));
  return extractMapGeometry(doc, def);
}
