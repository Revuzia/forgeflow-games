// GENESIS — stable state hashing for determinism checks (Sim.hash(), tests, keyframe dedupe).
//
// A 64-bit (two independent 32-bit lanes) streaming hash over typed-array BYTES and canonical JSON. Typed arrays are
// hashed by their raw bits, so two runs agree only if every float is bit-identical — exactly what determinism means.
// JSON objects are serialised with sorted keys (plain code-unit order, never locale order) so key insertion order never
// changes a hash. No crypto, no Date: this runs inside the deterministic sim core.

type Typed =
  | Float32Array | Float64Array | Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array
  | Uint32Array;

const C1 = 0xcc9e2d51;
const C2 = 0x1b873593;

function rotl(x: number, r: number): number {
  return (x << r) | (x >>> (32 - r));
}

function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const _f64 = new Float64Array(1);
const _f64u = new Uint32Array(_f64.buffer);

/** Streaming 64-bit hasher (two murmur3-style lanes with different seeds and mixing). */
export class Hasher {
  private h1 = 0x9747b28c | 0;
  private h2 = 0x2545f491 | 0;
  private n = 0;

  /** absorb one 32-bit word */
  u32(k: number): this {
    let k1 = Math.imul(k | 0, C1);
    k1 = rotl(k1, 15);
    k1 = Math.imul(k1, C2);
    let h1 = this.h1 ^ k1;
    h1 = rotl(h1, 13);
    this.h1 = (Math.imul(h1, 5) + 0xe6546b64) | 0;
    let k2 = Math.imul(k ^ 0x5bd1e995, 0x27d4eb2f);
    k2 = rotl(k2, 17);
    let h2 = this.h2 ^ k2;
    h2 = rotl(h2, 11);
    this.h2 = (Math.imul(h2, 9) + 0x7f4a7c15) | 0;
    this.n++;
    return this;
  }

  /** absorb a float64 by its exact bits */
  num(x: number): this {
    _f64[0] = x;
    return this.u32(_f64u[0]).u32(_f64u[1]);
  }

  /** absorb a string (UTF-16 code units, length-prefixed so concatenations never collide) */
  str(s: string): this {
    this.u32(s.length);
    let i = 0;
    for (; i + 1 < s.length; i += 2) this.u32(s.charCodeAt(i) | (s.charCodeAt(i + 1) << 16));
    if (i < s.length) this.u32(s.charCodeAt(i));
    return this;
  }

  /** absorb raw bytes of any typed array (length-prefixed). Aligned 4-byte views take the fast path. */
  typed(a: Typed): this {
    const bytes = a.byteLength;
    this.u32(bytes);
    if ((a.byteOffset & 3) === 0) {
      const words = bytes >>> 2;
      const u = new Uint32Array(a.buffer, a.byteOffset, words);
      for (let i = 0; i < words; i++) this.u32(u[i]);
      const rest = bytes & 3;
      if (rest) {
        const b = new Uint8Array(a.buffer, a.byteOffset + words * 4, rest);
        let w = 0;
        for (let i = 0; i < rest; i++) w |= b[i] << (8 * i);
        this.u32(w);
      }
    } else {
      const b = new Uint8Array(a.buffer, a.byteOffset, bytes);
      let i = 0;
      for (; i + 3 < bytes; i += 4) this.u32(b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24));
      let w = 0;
      for (let k = 0; i < bytes; i++, k++) w |= b[i] << (8 * k);
      if (bytes & 3) this.u32(w);
    }
    return this;
  }

  /** absorb any JSON-able value canonically */
  json(v: unknown): this {
    return this.str(stableStringify(v));
  }

  /** 16 hex digits */
  hex(): string {
    let h1 = this.h1 ^ this.n;
    let h2 = this.h2 ^ Math.imul(this.n, 0x9e3779b1);
    h1 = (h1 + h2) | 0;
    h2 = (h2 + h1) | 0;
    h1 = fmix(h1);
    h2 = fmix(h2);
    h1 = (h1 + h2) | 0;
    h2 = (h2 + h1) | 0;
    return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
  }
}

/**
 * JSON with object keys sorted by code unit (deterministic across engines and insertion orders). Non-finite numbers
 * become null (as JSON.stringify does); typed arrays are written as plain arrays; undefined object members are dropped.
 */
export function stableStringify(v: unknown): string {
  const parts: string[] = [];
  write(v, parts);
  return parts.join('');
}

function write(v: unknown, out: string[]): void {
  if (v === null || v === undefined) { out.push('null'); return; }
  const t = typeof v;
  if (t === 'number') { out.push(Number.isFinite(v as number) ? String(v) : 'null'); return; }
  if (t === 'boolean') { out.push(v ? 'true' : 'false'); return; }
  if (t === 'string') { out.push(JSON.stringify(v)); return; }
  if (t === 'bigint') { out.push(String(v)); return; }
  if (Array.isArray(v)) {
    out.push('[');
    for (let i = 0; i < v.length; i++) {
      if (i) out.push(',');
      write(v[i], out);
    }
    out.push(']');
    return;
  }
  if (ArrayBuffer.isView(v)) {
    const a = v as unknown as ArrayLike<number>;
    out.push('[');
    for (let i = 0; i < a.length; i++) {
      if (i) out.push(',');
      out.push(Number.isFinite(a[i]) ? String(a[i]) : 'null');
    }
    out.push(']');
    return;
  }
  if (t === 'object') {
    const o = v as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    out.push('{');
    let first = true;
    for (const k of keys) {
      const x = o[k];
      if (x === undefined || typeof x === 'function') continue;
      if (!first) out.push(',');
      first = false;
      out.push(JSON.stringify(k), ':');
      write(x, out);
    }
    out.push('}');
    return;
  }
  out.push('null');
}

/** One-shot helpers. */
export function hashTyped(a: Typed): string {
  return new Hasher().typed(a).hex();
}

export function hashJson(v: unknown): string {
  return new Hasher().json(v).hex();
}

/** true when two typed arrays have identical bytes (used to share unchanged blobs between keyframes) */
export function sameBytes(a: Typed, b: Typed): boolean {
  if (a.byteLength !== b.byteLength) return false;
  if ((a.byteOffset & 3) === 0 && (b.byteOffset & 3) === 0 && (a.byteLength & 3) === 0) {
    const ua = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >>> 2);
    const ub = new Uint32Array(b.buffer, b.byteOffset, b.byteLength >>> 2);
    for (let i = 0; i < ua.length; i++) if (ua[i] !== ub[i]) return false;
    return true;
  }
  const ba = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const bb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < ba.length; i++) if (ba[i] !== bb[i]) return false;
  return true;
}

export type { Typed as TypedArray };
