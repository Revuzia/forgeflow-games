// GENESIS — active-set helpers: turn a per-cell flag array into an ascending list of flagged cells, fast.
//
// Every field solver (water, fire, lava, talus) keeps a Uint8Array of "awake" flags; each step it needs the awake cells
// in ascending order (deterministic regardless of the order they were woken in). Scanning 40 962 bytes one at a time
// is ~75 µs; skipping all-zero 32-bit words makes an idle planet nearly free (~15 µs). Kept in its own small function
// so V8 optimises it independently of the big solver bodies.

/** little-endian host (every platform we ship on): a word's byte j is bits 8j..8j+7 */
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/** word views of flag arrays, made once per array (a fresh view per call was garbage on every solver step) */
const views = new WeakMap<Uint8Array, Uint32Array>();
function wordView(flags: Uint8Array, words: number): Uint32Array {
  let w = views.get(flags);
  if (!w || w.length !== words) {
    w = new Uint32Array(flags.buffer, flags.byteOffset, words);
    views.set(flags, w);
  }
  return w;
}

/** write the indices of non-zero flags (ascending) into `out`; returns how many */
export function collectFlags(flags: Uint8Array, out: Int32Array, n: number): number {
  let k = 0;
  const words = (flags.byteOffset & 3) === 0 ? n >> 2 : 0;
  if (words) {
    const w = wordView(flags, words);
    if (LE) {
      // decode the set bytes from the word itself (no second read of the byte array)
      for (let i = 0; i < words; i++) {
        const x = w[i];
        if (x === 0) continue;
        const b = i << 2;
        if ((x & 0xff) !== 0) out[k++] = b;
        if ((x & 0xff00) !== 0) out[k++] = b + 1;
        if ((x & 0xff0000) !== 0) out[k++] = b + 2;
        if ((x >>> 24) !== 0) out[k++] = b + 3;
      }
    } else {
      for (let i = 0; i < words; i++) {
        if (w[i] === 0) continue;
        const b = i << 2;
        if (flags[b]) out[k++] = b;
        if (flags[b + 1]) out[k++] = b + 1;
        if (flags[b + 2]) out[k++] = b + 2;
        if (flags[b + 3]) out[k++] = b + 3;
      }
    }
  }
  for (let c = words << 2; c < n; c++) if (flags[c]) out[k++] = c;
  return k;
}

/** true when any flag is set */
export function anyFlag(flags: Uint8Array, n: number): boolean {
  const words = (flags.byteOffset & 3) === 0 ? n >> 2 : 0;
  if (words) {
    const w = wordView(flags, words);
    for (let i = 0; i < words; i++) if (w[i] !== 0) return true;
  }
  for (let c = words << 2; c < n; c++) if (flags[c]) return true;
  return false;
}
