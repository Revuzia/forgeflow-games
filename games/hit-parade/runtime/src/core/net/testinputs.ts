// HIT PARADE - core/net/testinputs.ts (lane NET). Deterministic human-like input streams for the net
// probes and the net lab page (never used in play). Words follow CONTRACT §4.4 and are SOCD-clean.

export const IN = {
  U: 1, D: 2, L: 4, R: 8, BL: 16, BM: 32, BH: 64, BS: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048,
  // CHANGED(integrator) 3D (CONTRACT §35.2 / §35.13 item 3): the STEP bits (bit 13 STEP_IN, bit 14 STEP_OUT)
  STEP_IN: 8192, STEP_OUT: 16384,
} as const;

export function rng32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

/**
 * Held-word segments, forward-biased (`fwd` = IN.R for P1, IN.L for P2), with QCF / DP motions + a
 * button, and occasional system macros. Pure function of (seed, fwd, frames).
 * CHANGED(integrator) 3D: `step` = true also mixes in the §35.2 STEP inputs (sidestep taps, circle-walk holds, a
 * step + button = a step-attack try); false (the default) = the exact pre-3D stream (probe_synctest / probe_audio
 * keep their streams).
 */
export function inputStream(seed: number, fwd: number, frames: number, step = false): Int32Array {
  const { U, D, L, R, BL, BM, BH, BS, ASSIST, THROW, PARRY, IMPACT, STEP_IN, STEP_OUT } = IN;
  const r = rng32(seed);
  const out = new Int32Array(frames);
  const back = fwd === R ? L : R;
  let f = 0;
  while (f < frames) {
    let roll = r() % 100;
    let seq: number[];
    if (step && roll < 12) {
      // 12 % of the segments: a STEP (the roll of the plain stream is re-drawn for the rest, so its mix keeps its shape)
      const s = r() % 2 ? STEP_IN : STEP_OUT;
      const kind = r() % 3;
      if (kind === 0) seq = [s];                                           // tap = SIDESTEP
      else if (kind === 1) seq = new Array(20 + (r() % 50)).fill(s);       // hold = SIDEWALK (circle-walk)
      else seq = [s, s, s, s, s, s, s, s, s, s | [BL, BM, BH][r() % 3]];    // step + button = step-attack try
      for (const w of seq) if (f < frames) out[f++] = w;
      continue;
    }
    if (step) roll = r() % 100;
    if (roll < 10) {
      const btn = [BL, BM, BH, BS][r() % 4];
      seq = [D, D, D | fwd, D | fwd, fwd, fwd | btn, btn];                 // 236 + button
    } else if (roll < 15) {
      const btn = [BL, BM, BH][r() % 3];
      seq = [fwd, fwd, D, D, D | fwd, D | fwd | btn, btn];                 // 623 + button
    } else if (roll < 18) {
      seq = [[THROW, PARRY, IMPACT, ASSIST | BS][r() % 4]];
    } else {
      const dirs = [0, 0, fwd, fwd, fwd, back, D, D | back, D | fwd, U, U | fwd];
      let w = dirs[r() % dirs.length];
      if (r() % 100 < 35) w |= [BL, BM, BH, BS, BL | BM, BM | BH][r() % 6];
      seq = [w];
    }
    for (const w of seq) {
      const hold = seq.length > 1 ? 1 + (r() % 2) : 2 + (r() % 16);
      for (let k = 0; k < hold && f < frames; k++) out[f++] = w;
    }
  }
  return out;
}

/** Streaming variant for live sessions (lab page): next() returns the next word. */
export class InputGen {
  private buf: Int32Array;
  private i = 0;
  private seed: number;
  private fwd: number;
  /** CHANGED(integrator) 3D: STEP inputs in the stream (inputStream `step`) */
  private step: boolean;
  constructor(seed: number, fwd: number, step = false) {
    this.seed = seed;
    this.fwd = fwd;
    this.step = step;
    this.buf = inputStream(seed, fwd, 3600, step);
  }
  next(): number {
    if (this.i >= this.buf.length) { this.seed = (this.seed * 31 + 7) | 0; this.buf = inputStream(this.seed, this.fwd, 3600, this.step); this.i = 0; }
    return this.buf[this.i++];
  }
}
