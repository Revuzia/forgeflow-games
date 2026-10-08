// GENESIS — the rewind keyframe codec (CONTRACT.md §6.2): lossless, deterministic compression of typed-array state.
//
// Keyframes snapshot every planet array every 2 game days. Almost every field changes a little in that time, so
// "share unchanged arrays" saved little: the ring reached 135 MB (sandbox) to 413 MB (system) inside the worker. This
// codec exploits what does hold:
//   * XOR against a reference array (the next newer keyframe — see Sim.keyframe) zeroes every byte that did not change:
//     bedrock, ores, species, pins, sleeping water and most of the solver flags.
//   * Byte planes: element bytes are regrouped by significance (all byte 0s, then all byte 1s, ...). A float that
//     changed slightly keeps its sign / exponent / top mantissa bits, so after the XOR its high planes are runs of zeros
//     even when its low planes are noise. Sparse fields (fire, lava, flow, roads, the flux of sleeping edges) are mostly
//     zero with or without a reference.
//   * Zero-run RLE over the plane stream: [varint zeros][varint literals][literal bytes] ... — cheap to write and read.
// Encoding and decoding are exact bit copies (floats are handled as raw bytes: NaN payloads and -0 survive).

import type { TypedArray } from './hash.ts';

/** one encoded array; `xor` = encoded against a reference array of the same type and length */
export interface PackedArray {
  xor: boolean;
  bytes: Uint8Array;
  byteLength: number;
}

function bytesOf(a: TypedArray): Uint8Array {
  return new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
}

class ByteSink {
  buf: Uint8Array;
  n = 0;
  constructor(cap: number) {
    this.buf = new Uint8Array(Math.max(64, cap));
  }
  private grow(need: number): void {
    let cap = this.buf.length * 2;
    while (cap < this.n + need) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.n));
    this.buf = nb;
  }
  varint(v: number): void {
    if (this.n + 5 > this.buf.length) this.grow(5);
    while (v >= 0x80) {
      this.buf[this.n++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buf[this.n++] = v;
  }
  literal(src: Uint8Array, from: number, len: number): void {
    if (this.n + len > this.buf.length) this.grow(len);
    this.buf.set(src.subarray(from, from + len), this.n);
    this.n += len;
  }
  finish(): Uint8Array {
    return this.buf.slice(0, this.n);
  }
}

// plane-shuffled (and XORed) bytes of the array being encoded / decoded; grown on demand, reused between calls
let planeBuf = new Uint8Array(0);
function planes(len: number): Uint8Array {
  if (planeBuf.length < len) planeBuf = new Uint8Array(len);
  return planeBuf;
}

/**
 * Regroup the bytes of `a` (XOR `r`) by significance into `pl`: plane k holds byte k of every element (little-endian
 * byte order of the words read; decode uses the same order, so the platform's endianness never matters).
 * Word-wise loops: about 3x faster than byte-strided ones on the 13 MB of a home world.
 */
function shuffle(a: TypedArray, r: TypedArray | null, pl: Uint8Array): void {
  const L = a.byteLength, b = a.BYTES_PER_ELEMENT, n = L / b;
  if (b === 1 || (a.byteOffset & 3) !== 0 || (r && (r.byteOffset & 3) !== 0)) {
    const sa = bytesOf(a), sr = r ? bytesOf(r) : null;
    for (let k = 0; k < b; k++) {
      const base = k * n;
      if (sr) for (let i = 0, j = k; i < n; i++, j += b) pl[base + i] = sa[j] ^ sr[j];
      else for (let i = 0, j = k; i < n; i++, j += b) pl[base + i] = sa[j];
    }
    return;
  }
  if (b === 2) {
    const sa = new Uint16Array(a.buffer, a.byteOffset, n), sr = r ? new Uint16Array(r.buffer, r.byteOffset, n) : null;
    for (let i = 0; i < n; i++) {
      const v = sr ? sa[i] ^ sr[i] : sa[i];
      pl[i] = v & 255; pl[n + i] = v >>> 8;
    }
    return;
  }
  // 4 and 8 bytes: 32-bit words; an 8-byte element is two words (low word first)
  const w = L >>> 2, per = b >>> 2;
  const sa = new Uint32Array(a.buffer, a.byteOffset, w), sr = r ? new Uint32Array(r.buffer, r.byteOffset, w) : null;
  for (let h = 0; h < per; h++) {
    const p0 = (h * 4) * n, p1 = p0 + n, p2 = p1 + n, p3 = p2 + n;
    for (let i = 0, j = h; i < n; i++, j += per) {
      const v = sr ? sa[j] ^ sr[j] : sa[j];
      pl[p0 + i] = v & 255; pl[p1 + i] = (v >>> 8) & 255; pl[p2 + i] = (v >>> 16) & 255; pl[p3 + i] = v >>> 24;
    }
  }
}

/** inverse of shuffle: planes `pl` (XOR `r`) back into the bytes of `out` */
function unshuffle(pl: Uint8Array, r: TypedArray | null, out: TypedArray): void {
  const L = out.byteLength, b = out.BYTES_PER_ELEMENT, n = L / b;
  if (b === 1 || (out.byteOffset & 3) !== 0 || (r && (r.byteOffset & 3) !== 0)) {
    const d = bytesOf(out), sr = r ? bytesOf(r) : null;
    for (let k = 0; k < b; k++) {
      const base = k * n;
      if (sr) for (let i = 0, j = k; i < n; i++, j += b) d[j] = pl[base + i] ^ sr[j];
      else for (let i = 0, j = k; i < n; i++, j += b) d[j] = pl[base + i];
    }
    return;
  }
  if (b === 2) {
    const d = new Uint16Array(out.buffer, out.byteOffset, n), sr = r ? new Uint16Array(r.buffer, r.byteOffset, n) : null;
    for (let i = 0; i < n; i++) {
      const v = pl[i] | (pl[n + i] << 8);
      d[i] = sr ? v ^ sr[i] : v;
    }
    return;
  }
  const w = L >>> 2, per = b >>> 2;
  const d = new Uint32Array(out.buffer, out.byteOffset, w), sr = r ? new Uint32Array(r.buffer, r.byteOffset, w) : null;
  for (let h = 0; h < per; h++) {
    const p0 = (h * 4) * n, p1 = p0 + n, p2 = p1 + n, p3 = p2 + n;
    for (let i = 0, j = h; i < n; i++, j += per) {
      const v = (pl[p0 + i] | (pl[p1 + i] << 8) | (pl[p2 + i] << 16) | (pl[p3 + i] << 24)) >>> 0;
      d[j] = sr ? (v ^ sr[j]) >>> 0 : v;
    }
  }
}

/** encode `cur` (optionally XORed with `ref`, which must have the same type and length) */
export function packArray(cur: TypedArray, ref: TypedArray | null): PackedArray {
  const L = cur.byteLength;
  const useRef = !!ref && ref.byteLength === L && ref.BYTES_PER_ELEMENT === cur.BYTES_PER_ELEMENT;
  const pl = planes(L);
  shuffle(cur, useRef ? ref : null, pl);
  const out = new ByteSink(L >>> 4);
  let i = 0;
  while (i < L) {
    let z = i;
    while (z < L && pl[z] === 0) z++;
    // a literal run ends at the first run of >= 3 zeros (shorter zero runs are cheaper inline)
    let e = z;
    while (e < L) {
      if (pl[e] === 0 && (e + 2 >= L || (pl[e + 1] === 0 && pl[e + 2] === 0))) break;
      e++;
    }
    out.varint(z - i);
    out.varint(e - z);
    if (e > z) out.literal(pl, z, e - z);
    i = e;
  }
  return { xor: useRef, bytes: out.finish(), byteLength: L };
}

/** decode into `out` (same type and length as the encoded array); `ref` must be the reference it was encoded with */
export function unpackArray(p: PackedArray, out: TypedArray, ref: TypedArray | null): void {
  const L = out.byteLength;
  if (L !== p.byteLength) throw new Error(`keyframe: array of ${L} bytes cannot hold ${p.byteLength} encoded bytes`);
  if (p.xor && (!ref || ref.byteLength !== L)) throw new Error('keyframe: missing the reference array of a delta');
  const pl = planes(L);
  const s = p.bytes;
  let r = 0, i = 0;
  const rd = (): number => {
    let v = 0, mul = 1, byte: number;
    do {
      byte = s[r++];
      v += (byte & 0x7f) * mul;
      mul *= 128;
    } while (byte & 0x80);
    return v;
  };
  while (i < L) {
    const z = rd();
    pl.fill(0, i, i + z);
    i += z;
    const lit = rd();
    if (lit) {
      pl.set(s.subarray(r, r + lit), i);
      r += lit;
      i += lit;
    }
  }
  unshuffle(pl, p.xor ? ref : null, out);
}
