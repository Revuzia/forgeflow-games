// GENESIS — the binary save container (CONTRACT.md §6.6).
//
// Layout (little endian):
//   0   'GNSS'                 magic
//   4   u16 version            (major << 8) | minor
//   6   u16 reserved (0)
//   8   u32 headerBytes        UTF-8 JSON header length
//   12  header JSON            { ...state, __blobs: [{ n: name, t: type, o: offset, l: length }] }
//   ..  zero padding to a multiple of 8
//   ..  blob section: each typed array's raw bytes at its `o` (relative to the section start), 8-byte aligned
//
// The header carries everything object-shaped (params, entity lists, RNG states, chronicle, command log); the blobs
// carry the bulk per-cell / per-edge typed arrays. Readers refuse unknown MAJOR versions with a readable message and
// run minor migrations (none yet: 1.0 is the first format).

import type { TypedArray } from './hash.ts';

export const SAVE_MAGIC = 'GNSS';
export const SAVE_MAJOR = 1;
export const SAVE_MINOR = 0;

export type BlobType = 'f32' | 'f64' | 'i8' | 'u8' | 'i16' | 'u16' | 'i32' | 'u32';

interface BlobDir {
  n: string;
  t: BlobType;
  o: number;
  l: number;
}

export function blobTypeOf(a: TypedArray): BlobType {
  if (a instanceof Float32Array) return 'f32';
  if (a instanceof Float64Array) return 'f64';
  if (a instanceof Int8Array) return 'i8';
  if (a instanceof Uint8Array || a instanceof Uint8ClampedArray) return 'u8';
  if (a instanceof Int16Array) return 'i16';
  if (a instanceof Uint16Array) return 'u16';
  if (a instanceof Int32Array) return 'i32';
  return 'u32';
}

const BYTES: Record<BlobType, number> = { f32: 4, f64: 8, i8: 1, u8: 1, i16: 2, u16: 2, i32: 4, u32: 4 };

function makeTyped(t: BlobType, buf: ArrayBuffer, off: number, len: number): TypedArray {
  switch (t) {
    case 'f32': return new Float32Array(buf, off, len);
    case 'f64': return new Float64Array(buf, off, len);
    case 'i8': return new Int8Array(buf, off, len);
    case 'u8': return new Uint8Array(buf, off, len);
    case 'i16': return new Int16Array(buf, off, len);
    case 'u16': return new Uint16Array(buf, off, len);
    case 'i32': return new Int32Array(buf, off, len);
    default: return new Uint32Array(buf, off, len);
  }
}

const align8 = (x: number) => (x + 7) & ~7;

/** Builds a save file from a JSON header and named typed arrays (written in the given order). */
export class SaveWriter {
  private blobs: { name: string; arr: TypedArray }[] = [];
  private names = new Set<string>();

  blob(name: string, arr: TypedArray): this {
    if (this.names.has(name)) throw new Error(`save: duplicate blob '${name}'`);
    this.names.add(name);
    this.blobs.push({ name, arr });
    return this;
  }

  finish(header: Record<string, unknown>): Uint8Array {
    const dir: BlobDir[] = [];
    let off = 0;
    for (const b of this.blobs) {
      off = align8(off);
      dir.push({ n: b.name, t: blobTypeOf(b.arr), o: off, l: b.arr.length });
      off += b.arr.byteLength;
    }
    const blobBytes = align8(off);
    const json = JSON.stringify({ ...header, __blobs: dir });
    const hdr = new TextEncoder().encode(json);
    const start = align8(12 + hdr.length);
    const out = new Uint8Array(start + blobBytes);
    out[0] = SAVE_MAGIC.charCodeAt(0);
    out[1] = SAVE_MAGIC.charCodeAt(1);
    out[2] = SAVE_MAGIC.charCodeAt(2);
    out[3] = SAVE_MAGIC.charCodeAt(3);
    const dv = new DataView(out.buffer);
    dv.setUint16(4, (SAVE_MAJOR << 8) | SAVE_MINOR, true);
    dv.setUint16(6, 0, true);
    dv.setUint32(8, hdr.length, true);
    out.set(hdr, 12);
    for (let i = 0; i < this.blobs.length; i++) {
      const a = this.blobs[i].arr;
      out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), start + dir[i].o);
    }
    return out;
  }
}

export interface SaveFile {
  major: number;
  minor: number;
  header: Record<string, unknown>;
  /** blob copies (own buffers, safe to adopt) */
  blobs: Map<string, TypedArray>;
}

/** Parse a save; throws an Error with a human-readable message on any problem. */
export function readSave(bytes: Uint8Array): SaveFile {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) throw new Error('This is not a GENESIS save (file too short).');
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== SAVE_MAGIC) throw new Error('This is not a GENESIS save (bad magic).');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ver = dv.getUint16(4, true);
  const major = ver >> 8;
  const minor = ver & 255;
  if (major !== SAVE_MAJOR) {
    throw new Error(`This save was written by an incompatible GENESIS version (format ${major}.${minor}; this build reads ${SAVE_MAJOR}.x).`);
  }
  const hlen = dv.getUint32(8, true);
  if (12 + hlen > bytes.length) throw new Error('The save is truncated (header).');
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + hlen))) as Record<string, unknown>;
  } catch {
    throw new Error('The save header is corrupt.');
  }
  const start = align8(12 + hlen);
  const dir = (header.__blobs ?? []) as BlobDir[];
  delete header.__blobs;
  const blobs = new Map<string, TypedArray>();
  for (const d of dir) {
    const nb = d.l * BYTES[d.t];
    const at = start + d.o;
    if (at + nb > bytes.length) throw new Error(`The save is truncated (blob '${d.n}').`);
    // copy into a fresh, aligned buffer: the caller adopts these arrays as live sim state
    const buf = new ArrayBuffer(nb);
    new Uint8Array(buf).set(bytes.subarray(at, at + nb));
    blobs.set(d.n, makeTyped(d.t, buf, 0, d.l));
  }
  migrate(major, minor, header);
  return { major, minor, header, blobs };
}

/** minor-version migrations run here (in order) — 1.0 is the first format, so nothing yet */
function migrate(_major: number, _minor: number, _header: Record<string, unknown>): void {}
