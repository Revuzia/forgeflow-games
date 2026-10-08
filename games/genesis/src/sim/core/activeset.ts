// GENESIS — active-set helpers: turn a per-cell flag array into an ascending list of flagged cells, fast.
//
// Every field solver (water, fire, lava, talus) keeps a Uint8Array of "awake" flags; each step it needs the awake cells
// in ascending order (deterministic regardless of the order they were woken in). Scanning 40 962 bytes one at a time
// is ~75 µs; skipping all-zero 32-bit words makes an idle planet nearly free (~15 µs). Kept in its own small function
// so V8 optimises it independently of the big solver bodies.

/** write the indices of non-zero flags (ascending) into `out`; returns how many */
export function collectFlags(flags: Uint8Array, out: Int32Array, n: number): number {
  let k = 0;
  const words = (flags.byteOffset & 3) === 0 ? n >> 2 : 0;
  if (words) {
    const w = new Uint32Array(flags.buffer, flags.byteOffset, words);
    for (let i = 0; i < words; i++) {
      if (w[i] === 0) continue;
      const b = i << 2;
      if (flags[b]) out[k++] = b;
      if (flags[b + 1]) out[k++] = b + 1;
      if (flags[b + 2]) out[k++] = b + 2;
      if (flags[b + 3]) out[k++] = b + 3;
    }
  }
  for (let c = words << 2; c < n; c++) if (flags[c]) out[k++] = c;
  return k;
}

/** true when any flag is set */
export function anyFlag(flags: Uint8Array, n: number): boolean {
  const words = (flags.byteOffset & 3) === 0 ? n >> 2 : 0;
  if (words) {
    const w = new Uint32Array(flags.buffer, flags.byteOffset, words);
    for (let i = 0; i < words; i++) if (w[i] !== 0) return true;
  }
  for (let c = words << 2; c < n; c++) if (flags[c]) return true;
  return false;
}
