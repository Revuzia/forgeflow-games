// HIT PARADE - loop seams for sprite loops (the crowd beds). Adapted from dyefield audio/seam.ts. Pure: engine.ts and
// _harness/probe_audio.ts share it, so the probe measures exactly the samples the engine loops.
//
// build_audio.py writes every loop region as [tail guard][loop][head guard], where the guards are the loop's own
// wrap-around. Lossy coding leaves the decoded region's first and last samples with independent codec error, so
// looping the bare slice can tick. The fix: the decoded head guard (the samples right after the region end, i.e. the
// codec's version of "loop start, continuing from the loop end") is crossfaded into the slice's first `k` samples.
// slice[0] then continues the slice's own end exactly, and by sample k it is the region itself again.

/** a copy of data[a, a+n) whose first k samples fade in from the guard that follows the region */
export function loopSlice(data: Float32Array, a: number, n: number, guard: number, k: number): Float32Array<ArrayBuffer> {
  const out = data.slice(a, a + n);
  const g = Math.max(0, Math.min(k, guard, n, data.length - (a + n)));
  for (let i = 0; i < g; i++) {
    const w = (i + 0.5) / g;
    out[i] = data[a + n + i] * (1 - w) + out[i] * w;
  }
  return out;
}
