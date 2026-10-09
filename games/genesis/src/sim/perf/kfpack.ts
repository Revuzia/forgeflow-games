// GENESIS — SIM perf push 2: keyframe arrays that did not change since the next newer keyframe are encoded without the
// codec's work (core/kfcodec.ts packArray). Between keyframes ~4/5 of a world's arrays and ~1/3 of its bytes do not
// change (bedrock, ores, species, the people's static columns...); for those the XOR against the reference is all zero
// and the codec's byte-plane shuffle and zero-run scan only rediscover that. A word-wise equality test (one read pass,
// early exit at the first difference) answers it for a fraction of the cost, and the packed form is the codec's own
// encoding of an all-zero stream — [varint length][varint 0] — so unpackArray decodes it unchanged.

import { packArray, type PackedArray } from '../core/kfcodec.ts';
import type { TypedArray } from '../core/hash.ts';

/** bit-for-bit equality of two typed arrays of the same type and length */
export function sameBits(a: TypedArray, b: TypedArray): boolean {
  if (a.byteLength !== b.byteLength || a.BYTES_PER_ELEMENT !== b.BYTES_PER_ELEMENT) return false;
  const L = a.byteLength;
  if ((a.byteOffset & 3) === 0 && (b.byteOffset & 3) === 0 && (L & 3) === 0) {
    const wa = new Uint32Array(a.buffer, a.byteOffset, L >>> 2), wb = new Uint32Array(b.buffer, b.byteOffset, L >>> 2);
    for (let i = 0; i < wa.length; i++) if (wa[i] !== wb[i]) return false;
    return true;
  }
  const ba = new Uint8Array(a.buffer, a.byteOffset, L), bb = new Uint8Array(b.buffer, b.byteOffset, L);
  for (let i = 0; i < L; i++) if (ba[i] !== bb[i]) return false;
  return true;
}

/** the codec's encoding of `n` zero bytes (one zero run, no literals) */
function zeroRun(n: number): Uint8Array {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
  out.push(v, 0);
  return Uint8Array.from(out);
}

/** packArray, with the unchanged-array shortcut */
export function packKeyframe(cur: TypedArray, ref: TypedArray | null): PackedArray {
  if (ref && sameBits(cur, ref)) return { xor: true, bytes: zeroRun(cur.byteLength), byteLength: cur.byteLength };
  return packArray(cur, ref);
}
