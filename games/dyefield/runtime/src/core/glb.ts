// DYEFIELD — minimal glTF 2.0 binary (GLB) reader (CONTRACT §4.3). THREE-free, DOM-free.
//
// The sim needs raw geometry (collision soup, paint-atlas soup, spawn empties, mapinfo extras),
// not a scene graph: the view renders with three's GLTFLoader. So this reader does exactly:
//   * GLB container: 12-byte header, JSON chunk, optional BIN chunk (buffer 0). Extra buffers may
//     be base64 data: URIs. External .bin files are rejected (every DYEFIELD asset is a GLB).
//   * accessors: SCALAR / VEC2 / VEC3 / VEC4; component types float, u8, u16, u32, i8, i16, with
//     `normalized` (glTF §3.11 decode rules); bufferView.byteStride; accessors without a
//     bufferView read as zeros (spec). Sparse accessors throw a clear error. Matrix types throw.
//   * node hierarchy → world matrices (TRS or `matrix`), column-major Float64.
//   * mesh primitives: POSITION → world by the node's world matrix; NORMAL → world by the normal
//     matrix (inverse-transpose of the upper 3×3), renormalised; TEXCOORD_0/1 and COLOR_0 copied;
//     u8/u16/u32 indices or non-indexed; TRIANGLES, TRIANGLE_STRIP and TRIANGLE_FAN become a
//     triangle list (points/lines are skipped). A mirroring world matrix (det < 0) flips the
//     triangle winding so front faces stay front faces in world space.
//   * compressed geometry (KHR_draco_mesh_compression, EXT_meshopt_compression) is rejected with
//     a clear error; KHR_mesh_quantization data decodes through the normal accessor path.
// Skins and animations are ignored (a skinned mesh part is returned in its node's frame).

export interface GlbMeshPart {
  node: string;                     // node name
  material: string;                 // material name ('' if none)
  positions: Float32Array;          // WORLD space (node hierarchy applied), xyz
  normals: Float32Array | null;     // WORLD space, unit
  uv0: Float32Array | null;
  uv1: Float32Array | null;
  colors: Float32Array | null;      // rgba 0..1
  indices: Uint32Array;             // triangle list
}

export interface GlbNodeInfo {
  name: string; parent: number; mesh: number | null;
  world: Float64Array;              // 4x4 column-major world matrix
  extras: Record<string, unknown> | null;
}

export interface GlbDoc { json: any; nodes: GlbNodeInfo[]; parts: GlbMeshPart[] }

const GLB_MAGIC = 0x46546c67;   // 'glTF'
const CHUNK_JSON = 0x4e4f534a;  // 'JSON'
const CHUNK_BIN = 0x004e4942;   // 'BIN\0'

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const UNSUPPORTED_REQUIRED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_meshopt_compression'];

function fail(msg: string): never {
  throw new Error(`[glb] ${msg}`);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

interface Ctx { json: any; buffers: Uint8Array[] }

function bufferBytes(ctx: Ctx, index: number): Uint8Array {
  const b = ctx.buffers[index];
  if (!b) fail(`buffer ${index} is not available (external .bin URIs are not supported in a GLB reader)`);
  return b;
}

/**
 * Reads an accessor as floats. Integer components are decoded with the glTF normalisation rules
 * when `normalized` is set, and as their raw integer value otherwise.
 * Returns the flat array (count × components) and the component count.
 */
function readAccessorFloat(ctx: Ctx, index: number, what: string): { data: Float32Array; comps: number; count: number } {
  const acc = ctx.json.accessors?.[index];
  if (!acc) fail(`${what}: accessor ${index} does not exist`);
  if (acc.sparse) fail(`${what}: accessor ${index} is sparse — sparse accessors are not supported (export without sparse data)`);
  const comps = COMPONENTS[acc.type as string];
  if (!comps) fail(`${what}: accessor ${index} has type ${acc.type}; only SCALAR/VEC2/VEC3/VEC4 are supported`);
  const ctype = acc.componentType as number;
  const csize = COMPONENT_BYTES[ctype];
  if (!csize) fail(`${what}: accessor ${index} has unsupported componentType ${ctype}`);
  const count = acc.count as number;
  const out = new Float32Array(count * comps);
  if (acc.bufferView === undefined) return { data: out, comps, count }; // spec: zeros
  const bv = ctx.json.bufferViews?.[acc.bufferView];
  if (!bv) fail(`${what}: bufferView ${acc.bufferView} does not exist`);
  const bytes = bufferBytes(ctx, bv.buffer);
  const elemSize = comps * csize;
  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : elemSize;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const need = count > 0 ? base + stride * (count - 1) + elemSize : base;
  if (need > (bv.byteOffset ?? 0) + bv.byteLength || need > bytes.byteLength) {
    fail(`${what}: accessor ${index} reads past its bufferView (${need} > ${(bv.byteOffset ?? 0) + bv.byteLength})`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const norm = !!acc.normalized;
  let o = 0;
  for (let i = 0; i < count; i++) {
    let p = base + i * stride;
    for (let c = 0; c < comps; c++, p += csize) {
      let v: number;
      switch (ctype) {
        case 5126: v = dv.getFloat32(p, true); break;
        case 5121: v = dv.getUint8(p); if (norm) v = v / 255; break;
        case 5123: v = dv.getUint16(p, true); if (norm) v = v / 65535; break;
        case 5125: v = dv.getUint32(p, true); if (norm) v = v / 4294967295; break;
        case 5120: v = dv.getInt8(p); if (norm) v = Math.max(v / 127, -1); break;
        default: /* 5122 */ v = dv.getInt16(p, true); if (norm) v = Math.max(v / 32767, -1); break;
      }
      out[o++] = v;
    }
  }
  return { data: out, comps, count };
}

function readIndices(ctx: Ctx, index: number, what: string): Uint32Array {
  const acc = ctx.json.accessors?.[index];
  if (!acc) fail(`${what}: index accessor ${index} does not exist`);
  if (acc.sparse) fail(`${what}: index accessor ${index} is sparse — not supported`);
  if (acc.type !== 'SCALAR') fail(`${what}: index accessor ${index} must be SCALAR, got ${acc.type}`);
  const ctype = acc.componentType as number;
  if (ctype !== 5121 && ctype !== 5123 && ctype !== 5125) fail(`${what}: index componentType ${ctype} must be u8/u16/u32`);
  const count = acc.count as number;
  const out = new Uint32Array(count);
  if (acc.bufferView === undefined) return out;
  const bv = ctx.json.bufferViews?.[acc.bufferView];
  if (!bv) fail(`${what}: bufferView ${acc.bufferView} does not exist`);
  const bytes = bufferBytes(ctx, bv.buffer);
  const csize = COMPONENT_BYTES[ctype];
  const stride = bv.byteStride && bv.byteStride > 0 ? bv.byteStride : csize;
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const need = count > 0 ? base + stride * (count - 1) + csize : base;
  if (need > bytes.byteLength) fail(`${what}: index accessor ${index} reads past its buffer`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < count; i++) {
    const p = base + i * stride;
    out[i] = ctype === 5125 ? dv.getUint32(p, true) : ctype === 5123 ? dv.getUint16(p, true) : dv.getUint8(p);
  }
  return out;
}

// ── matrices (column-major 4×4, Float64) ─────────────────────────────────────────────────────────

function identity(): Float64Array {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function localMatrix(node: any): Float64Array {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) return Float64Array.from(node.matrix as number[]);
  const t = (node.translation as number[] | undefined) ?? [0, 0, 0];
  const r = (node.rotation as number[] | undefined) ?? [0, 0, 0, 1];
  const s = (node.scale as number[] | undefined) ?? [1, 1, 1];
  const [qx, qy, qz, qw] = r;
  const [sx, sy, sz] = s;
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (qy * qy + qz * qz)) * sx;
  m[1] = 2 * (qx * qy + qz * qw) * sx;
  m[2] = 2 * (qx * qz - qy * qw) * sx;
  m[4] = 2 * (qx * qy - qz * qw) * sy;
  m[5] = (1 - 2 * (qx * qx + qz * qz)) * sy;
  m[6] = 2 * (qy * qz + qx * qw) * sy;
  m[8] = 2 * (qx * qz + qy * qw) * sz;
  m[9] = 2 * (qy * qz - qx * qw) * sz;
  m[10] = (1 - 2 * (qx * qx + qy * qy)) * sz;
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
}

function multiply(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

/** Inverse-transpose of the upper 3×3 (row-major 9 for convenience) and the 3×3 determinant. */
function normalMatrix(m: Float64Array): { n: Float64Array; det: number } {
  const a = m[0], b = m[4], c = m[8];
  const d = m[1], e = m[5], f = m[9];
  const g = m[2], h = m[6], i = m[10];
  // cofactors of the row-major matrix [[a b c][d e f][g h i]]
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const D = -(b * i - c * h), E = a * i - c * g, F = -(a * h - b * g);
  const G = b * f - c * e, H = -(a * f - c * d), I = a * e - b * d;
  const det = a * A + b * B + c * C;
  const inv = det !== 0 ? 1 / det : 0;
  // inverse-transpose = cofactor matrix / det (row-major)
  const n = new Float64Array([A * inv, B * inv, C * inv, D * inv, E * inv, F * inv, G * inv, H * inv, I * inv]);
  return { n, det };
}

// ── parse ─────────────────────────────────────────────────────────────────────────────────────────

export function parseGlb(buf: ArrayBuffer | Uint8Array): GlbDoc {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.byteLength < 20) fail(`file too small (${u8.byteLength} bytes) to be a GLB`);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = dv.getUint32(0, true);
  if (magic !== GLB_MAGIC) fail(`bad magic 0x${magic.toString(16)} (not a binary glTF)`);
  const version = dv.getUint32(4, true);
  if (version !== 2) fail(`glTF container version ${version}; only 2 is supported`);
  const total = Math.min(dv.getUint32(8, true), u8.byteLength);

  let json: any = null;
  let bin: Uint8Array | null = null;
  let off = 12;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true);
    const type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (start + len > total) fail(`chunk at ${off} (len ${len}) runs past the end of the file`);
    if (type === CHUNK_JSON) {
      const text = new TextDecoder('utf-8').decode(u8.subarray(start, start + len));
      json = JSON.parse(text);
    } else if (type === CHUNK_BIN && bin === null) {
      bin = u8.subarray(start, start + len);
    }
    off = start + ((len + 3) & ~3);
  }
  if (!json) fail('no JSON chunk');
  if (!String(json.asset?.version ?? '').startsWith('2')) fail(`asset.version ${json.asset?.version}; only glTF 2.x is supported`);
  const required: string[] = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  for (const ext of required) {
    if (UNSUPPORTED_REQUIRED.includes(ext)) fail(`required extension ${ext} is not supported (export uncompressed geometry)`);
  }

  const buffers: Uint8Array[] = [];
  const jb: any[] = Array.isArray(json.buffers) ? json.buffers : [];
  for (let i = 0; i < jb.length; i++) {
    const b = jb[i];
    if (b.uri === undefined) {
      if (i !== 0 || !bin) fail(`buffer ${i} has no uri and there is no GLB BIN chunk for it`);
      buffers.push(bin);
    } else if (typeof b.uri === 'string' && b.uri.startsWith('data:')) {
      const comma = b.uri.indexOf(',');
      if (comma < 0 || !/;base64$/i.test(b.uri.slice(0, comma))) fail(`buffer ${i}: only base64 data: URIs are supported`);
      buffers.push(decodeBase64(b.uri.slice(comma + 1)));
    } else {
      fail(`buffer ${i} references external file '${String(b.uri)}' — not supported`);
    }
  }
  const ctx: Ctx = { json, buffers };

  // nodes + world matrices
  const jn: any[] = Array.isArray(json.nodes) ? json.nodes : [];
  const parent = new Int32Array(jn.length).fill(-1);
  for (let i = 0; i < jn.length; i++) {
    const ch: number[] = Array.isArray(jn[i].children) ? jn[i].children : [];
    for (const c of ch) {
      if (c < 0 || c >= jn.length) fail(`node ${i} has an out-of-range child ${c}`);
      if (parent[c] !== -1) fail(`node ${c} has two parents (${parent[c]} and ${i})`);
      parent[c] = i;
    }
  }
  const world: (Float64Array | null)[] = new Array(jn.length).fill(null);
  const visiting = new Uint8Array(jn.length);
  const worldOf = (i: number): Float64Array => {
    const done = world[i];
    if (done) return done;
    if (visiting[i]) fail(`node hierarchy has a cycle at node ${i}`);
    visiting[i] = 1;
    const local = localMatrix(jn[i]);
    const w = parent[i] >= 0 ? multiply(worldOf(parent[i]), local) : local;
    world[i] = w;
    visiting[i] = 0;
    return w;
  };
  const nodes: GlbNodeInfo[] = [];
  for (let i = 0; i < jn.length; i++) {
    const n = jn[i];
    const extras = n.extras && typeof n.extras === 'object' && !Array.isArray(n.extras) ? (n.extras as Record<string, unknown>) : null;
    nodes.push({
      name: typeof n.name === 'string' ? n.name : `node_${i}`,
      parent: parent[i],
      mesh: typeof n.mesh === 'number' ? n.mesh : null,
      world: worldOf(i),
      extras,
    });
  }

  // mesh parts (one per primitive per mesh-carrying node)
  const parts: GlbMeshPart[] = [];
  const meshes: any[] = Array.isArray(json.meshes) ? json.meshes : [];
  const materials: any[] = Array.isArray(json.materials) ? json.materials : [];
  for (let ni = 0; ni < nodes.length; ni++) {
    const info = nodes[ni];
    if (info.mesh === null) continue;
    const mesh = meshes[info.mesh];
    if (!mesh) fail(`node '${info.name}' references missing mesh ${info.mesh}`);
    const m = info.world;
    const { n: nm, det } = normalMatrix(m);
    const prims: any[] = Array.isArray(mesh.primitives) ? mesh.primitives : [];
    for (let pi = 0; pi < prims.length; pi++) {
      const prim = prims[pi];
      const mode = prim.mode ?? 4;
      if (mode !== 4 && mode !== 5 && mode !== 6) continue; // points / lines: no triangles
      const what = `node '${info.name}' primitive ${pi}`;
      if (prim.extensions && (prim.extensions.KHR_draco_mesh_compression || prim.extensions.EXT_meshopt_compression)) {
        fail(`${what} uses compressed geometry — not supported`);
      }
      const attrs = prim.attributes ?? {};
      if (attrs.POSITION === undefined) fail(`${what} has no POSITION`);
      const pos = readAccessorFloat(ctx, attrs.POSITION, `${what} POSITION`);
      if (pos.comps !== 3) fail(`${what} POSITION must be VEC3`);
      const vcount = pos.count;
      const positions = new Float32Array(vcount * 3);
      for (let v = 0; v < vcount; v++) {
        const x = pos.data[v * 3], y = pos.data[v * 3 + 1], z = pos.data[v * 3 + 2];
        positions[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        positions[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        positions[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
      let normals: Float32Array | null = null;
      if (attrs.NORMAL !== undefined) {
        const nr = readAccessorFloat(ctx, attrs.NORMAL, `${what} NORMAL`);
        if (nr.comps !== 3 || nr.count !== vcount) fail(`${what} NORMAL must be VEC3 with ${vcount} entries`);
        normals = new Float32Array(vcount * 3);
        for (let v = 0; v < vcount; v++) {
          const x = nr.data[v * 3], y = nr.data[v * 3 + 1], z = nr.data[v * 3 + 2];
          let wx = nm[0] * x + nm[1] * y + nm[2] * z;
          let wy = nm[3] * x + nm[4] * y + nm[5] * z;
          let wz = nm[6] * x + nm[7] * y + nm[8] * z;
          const len = Math.hypot(wx, wy, wz);
          if (len > 0) { wx /= len; wy /= len; wz /= len; }
          normals[v * 3] = wx; normals[v * 3 + 1] = wy; normals[v * 3 + 2] = wz;
        }
      }
      const readVec = (key: string, comps: number): Float32Array | null => {
        if (attrs[key] === undefined) return null;
        const r = readAccessorFloat(ctx, attrs[key], `${what} ${key}`);
        if (r.comps !== comps || r.count !== vcount) fail(`${what} ${key} must have ${comps} components × ${vcount}`);
        return r.data;
      };
      const uv0 = readVec('TEXCOORD_0', 2);
      const uv1 = readVec('TEXCOORD_1', 2);
      let colors: Float32Array | null = null;
      if (attrs.COLOR_0 !== undefined) {
        const c = readAccessorFloat(ctx, attrs.COLOR_0, `${what} COLOR_0`);
        if ((c.comps !== 3 && c.comps !== 4) || c.count !== vcount) fail(`${what} COLOR_0 must be VEC3/VEC4 × ${vcount}`);
        colors = new Float32Array(vcount * 4);
        for (let v = 0; v < vcount; v++) {
          colors[v * 4] = c.data[v * c.comps];
          colors[v * 4 + 1] = c.data[v * c.comps + 1];
          colors[v * 4 + 2] = c.data[v * c.comps + 2];
          colors[v * 4 + 3] = c.comps === 4 ? c.data[v * 4 + 3] : 1;
        }
      }
      let raw: Uint32Array;
      if (prim.indices !== undefined) {
        raw = readIndices(ctx, prim.indices, what);
      } else {
        raw = new Uint32Array(vcount);
        for (let v = 0; v < vcount; v++) raw[v] = v;
      }
      for (let k = 0; k < raw.length; k++) {
        if (raw[k] >= vcount) fail(`${what}: index ${raw[k]} ≥ vertex count ${vcount}`);
      }
      let indices: Uint32Array;
      if (mode === 4) {
        const n3 = raw.length - (raw.length % 3);
        indices = raw.length === n3 ? raw : raw.slice(0, n3);
      } else {
        const tris: number[] = [];
        for (let k = 2; k < raw.length; k++) {
          if (mode === 5) {
            if (k % 2 === 0) tris.push(raw[k - 2], raw[k - 1], raw[k]);
            else tris.push(raw[k - 1], raw[k - 2], raw[k]);
          } else {
            tris.push(raw[0], raw[k - 1], raw[k]);
          }
        }
        indices = Uint32Array.from(tris);
      }
      if (det < 0) {
        // a mirroring transform flips handedness: swap two corners so CCW stays the front face
        if (indices === raw) indices = raw.slice();
        for (let t = 0; t + 2 < indices.length; t += 3) {
          const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
        }
      }
      const matIdx = prim.material;
      const material = typeof matIdx === 'number' && materials[matIdx] && typeof materials[matIdx].name === 'string'
        ? materials[matIdx].name as string : '';
      parts.push({ node: info.name, material, positions, normals, uv0, uv1, colors, indices });
    }
  }
  return { json, nodes, parts };
}

// ── loading ───────────────────────────────────────────────────────────────────────────────────────

function isNodeRuntime(): boolean {
  const p = (globalThis as { process?: { versions?: { node?: string } } }).process;
  return !!(p && p.versions && typeof p.versions.node === 'string');
}

/** file path, file:// URL (Node) or http(s) URL (browser) */
export async function loadGlb(url: string): Promise<GlbDoc> {
  if (isNodeRuntime() && !/^(https?|blob|data):/i.test(url)) {
    // Specifiers live in variables + @vite-ignore so the browser bundle never resolves node builtins.
    const fsSpec = 'node:fs/promises';
    const urlSpec = 'node:url';
    const fs = (await import(/* @vite-ignore */ fsSpec)) as typeof import('node:fs/promises');
    let path = url;
    if (/^file:/i.test(url)) {
      const nu = (await import(/* @vite-ignore */ urlSpec)) as typeof import('node:url');
      path = nu.fileURLToPath(url);
    }
    const b = await fs.readFile(path);
    return parseGlb(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`[glb] fetch ${url} failed: HTTP ${res.status}`);
  return parseGlb(await res.arrayBuffer());
}

/**
 * URL of an exported asset: new URL(`../../../art/gltf/${file}`, import.meta.url).href
 * The template literal is what Vite statically analyses: a build turns it into a lookup over every
 * art/gltf/* file present AT BUILD TIME (each emitted as a hashed asset). A file missing from that
 * lookup would silently resolve to ".../undefined", so that case throws a clear error instead.
 * In Node it is plain URL resolution → a file:// URL next to the repo's art/gltf folder.
 */
export function artUrl(file: string): string {
  const href = new URL(`../../../art/gltf/${file}`, import.meta.url).href;
  if (href.endsWith('/undefined') && file !== 'undefined') {
    throw new Error(`[glb] art/gltf/${file} is not part of this build (only files present when Vite built/started are bundled)`);
  }
  return href;
}
