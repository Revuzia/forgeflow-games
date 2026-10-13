// HIT PARADE - core/net/testinputs.ts (lane NET). Deterministic human-like input streams for the net
// probes and the net lab page (never used in play). Words follow CONTRACT §4.4 and are SOCD-clean.

export const IN = {
  U: 1, D: 2, L: 4, R: 8, BL: 16, BM: 32, BH: 64, BS: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048,
  // CHANGED(integrator) 3D (CONTRACT §35.2 / §35.13 item 3): the STEP bits (bit 13 STEP_IN, bit 14 STEP_OUT)
  STEP_IN: 8192, STEP_OUT: 16384,
  // CHANGED(input) (CONTRACT §36.5): bit 15 BLOCK, 16-19 SPECIAL 1-4, 20 SUPER1, 21 SUPER3
  BLOCK: 32768, SP1: 65536, SP2: 131072, SP3: 262144, SP4: 524288, SUPER1: 1048576, SUPER3: 2097152,
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
 * CHANGED(input) (CONTRACT §36.5): `easy` = true also mixes in the EASY keys (BLOCK holds - standing / crouching / against
 * a walk -, SPECIAL 1-4 taps, SUPER1 / SUPER3 taps, J mashing); false (the default) = the exact stream before (every
 * existing caller keeps its words).
 */
export function inputStream(seed: number, fwd: number, frames: number, step = false, easy = false): Int32Array {
  const { U, D, L, R, BL, BM, BH, BS, ASSIST, THROW, PARRY, IMPACT, STEP_IN, STEP_OUT, BLOCK, SP1, SP2, SP3, SP4, SUPER1, SUPER3 } = IN;
  const r = rng32(seed);
  const out = new Int32Array(frames);
  const back = fwd === R ? L : R;
  let f = 0;
  while (f < frames) {
    let roll = r() % 100;
    let seq: number[];
    if (easy && roll < 25) {
      // 25 % of the segments: an EASY key (the roll is re-drawn for the rest, so the plain mix keeps its shape)
      const kind = r() % 6;
      if (kind === 0) seq = new Array(4 + (r() % 40)).fill(BLOCK | [0, D, fwd, back, U][r() % 5]);   // BLOCK held (+ a direction)
      else if (kind === 1) seq = [[SP1, SP2, SP3, SP4][r() % 4]];                                     // SPECIAL 1-4 tap
      else if (kind === 2) seq = [[SUPER1, SUPER3][r() % 2]];                                          // SUPER tap
      else if (kind === 3) seq = [BL, 0, BL, 0, 0, BL, 0, BL, 0, 0, 0, BL];                            // J mashing (auto-combo)
      else if (kind === 4) seq = [BLOCK, BLOCK | [BL, BM, BH, SP1, SUPER1][r() % 5], BLOCK];          // a press while blocking
      else seq = [[SP1, SP2, SP3, SP4][r() % 4] | (r() % 2 ? ASSIST : 0) | (r() % 3 === 0 ? D : 0)];  // SPECIAL + ASSIST (EX) / air-ish
      for (const w of seq) if (f < frames) out[f++] = w;
      continue;
    }
    if (easy) roll = r() % 100;
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
  /** CHANGED(input): EASY keys in the stream (inputStream `easy`) */
  private easy: boolean;
  constructor(seed: number, fwd: number, step = false, easy = false) {
    this.seed = seed;
    this.fwd = fwd;
    this.step = step;
    this.easy = easy;
    this.buf = inputStream(seed, fwd, 3600, step, easy);
  }
  next(): number {
    if (this.i >= this.buf.length) { this.seed = (this.seed * 31 + 7) | 0; this.buf = inputStream(this.seed, this.fwd, 3600, this.step, this.easy); this.i = 0; }
    return this.buf[this.i++];
  }
}
