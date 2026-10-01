// HIT PARADE - CPU input pad (lane AI, CONTRACT §4.4, §11). THREE-free, DOM-free, clock-free.
//
// The CPU emits the same 16-bit words a keyboard / pad / touch player does (§4.4). Plans are written in
// FACING-RELATIVE numpad notation (6 = forward, 4 = back, 1..3 = down row) and converted to screen bits
// on the frame they are emitted, with the facing the sim will read on that step (recordInput uses the
// facing left by the previous step, which is exactly what the CPU reads before calling step).

export const B = {
  UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, S: 128, ASSIST: 256, THROW: 512, PARRY: 1024, IMPACT: 2048, TAUNT: 4096,
  // CHANGED(AI3D) (CONTRACT §35.2 / §35.13 item 3): bit 13 STEP_IN (circle away from the camera), bit 14 STEP_OUT (toward it)
  STEP_IN: 8192, STEP_OUT: 16384,
} as const;

/** Buttons that only act on a fresh press (the pad inserts a release frame between two presses). */
export const PRESS_BITS = B.L | B.M | B.H | B.S | B.THROW | B.IMPACT | B.TAUNT;
export const DIR_BITS = B.UP | B.DOWN | B.LEFT | B.RIGHT;
/** CHANGED(AI3D): the CPU word carries bits 0..14 (STEP_IN / STEP_OUT included; was 0x1fff) - core/sim/inputs.ts WORD_BITS */
export const WORD_MASK = 0x7fff;
/** CHANGED(AI3D): the two STEP bits (held = the sim decides tap / circle-walk by the hold time; never a press edge) */
export const STEP_BITS = B.STEP_IN | B.STEP_OUT;

/** Facing-relative numpad direction -> screen bits (facing +1 = forward is RIGHT). */
export function dirBits(d: number, facing: number): number {
  let v = 0;
  if (d >= 7) v |= B.UP;
  else if (d <= 3) v |= B.DOWN;
  const h = (d - 1) % 3; // 0 back, 1 neutral, 2 forward
  if (h === 0) v |= facing >= 0 ? B.LEFT : B.RIGHT;
  else if (h === 2) v |= facing >= 0 ? B.RIGHT : B.LEFT;
  return v;
}

/** Screen bit that points AWAY from world x `fromX` for a fighter standing at `x` (block direction). */
export function awayBits(x: number, fromX: number, facing: number): number {
  const dx = x - fromX;
  if (dx > 0) return B.RIGHT;
  if (dx < 0) return B.LEFT;
  return facing >= 0 ? B.LEFT : B.RIGHT;
}

/** One planned frame: a numpad direction (5 = neutral) plus buttons. `raw` = screen bits used as-is. */
export interface Step {
  d: number;
  b: number;
  raw?: number;
}

/** Motion codes (same values as core/sim/compile.ts MO). */
export const MOTION = { QCF: 1, QCB: 2, DP: 3, RDP: 4, HCF: 5, HCB: 6, SPD: 7, DQCF: 8, DQCB: 9, CHG_BF: 10, CHG_DU: 11, DD: 12 } as const;

/** Numpad sequence of each motion (the button goes on the last entry). Charge motions list only the release. */
export const MOTION_SEQ: Readonly<Record<number, readonly number[]>> = {
  [MOTION.QCF]: [2, 3, 6],
  [MOTION.QCB]: [2, 1, 4],
  [MOTION.DP]: [6, 2, 3],
  [MOTION.RDP]: [4, 2, 1],
  [MOTION.HCF]: [4, 1, 2, 3, 6],
  [MOTION.HCB]: [6, 3, 2, 1, 4],
  // 360: "any 3 of 4 cardinals" (core/sim/motion.ts) - forward, down, back stays on the ground
  [MOTION.SPD]: [6, 3, 2, 1, 4],
  [MOTION.DQCF]: [2, 3, 6, 2, 3, 6],
  [MOTION.DQCB]: [2, 1, 4, 2, 1, 4],
  [MOTION.CHG_BF]: [6],
  [MOTION.CHG_DU]: [8],
  [MOTION.DD]: [2, 5, 2],
};

/** Steps of a motion + button. */
export function motionSteps(code: number, btn: number): Step[] {
  const seq = MOTION_SEQ[code] ?? [];
  return seq.map((d, k) => ({ d, b: k === seq.length - 1 ? btn : 0 }));
}

/**
 * The output stage every brain shares: a FIFO of planned steps, the last word emitted (so a press is
 * always a fresh edge) and an optional delay line (the novice persona's 400 ms).
 */
export class Pad {
  private q: Step[] = [];
  last = 0;
  private delay: number[] = [];
  private delayN: number;

  constructor(delayFrames = 0) {
    this.delayN = Math.max(0, delayFrames | 0);
  }

  get busy(): boolean {
    return this.q.length > 0;
  }
  get pending(): number {
    return this.q.length;
  }
  clear(): void {
    this.q.length = 0;
  }
  push(steps: readonly Step[]): void {
    for (const s of steps) this.q.push(s);
  }
  /** Next planned step (or null). */
  shift(): Step | null {
    return this.q.length > 0 ? (this.q.shift() as Step) : null;
  }

  /**
   * Final word for this frame: converts a step with the facing, turns a repeated press into a release
   * frame (the step is retried next frame), then runs the delay line.
   */
  out(step: Step | null, facing: number): number {
    let w = 0;
    if (step) w = (step.raw !== undefined ? step.raw : dirBits(step.d, facing)) | step.b;
    w &= WORD_MASK;
    const rep = w & this.last & PRESS_BITS;
    if (rep !== 0 && step) {
      // the same button was down last frame: release it this frame and retry the step next frame
      this.q.unshift(step);
      w &= ~PRESS_BITS;
    }
    this.last = w;
    if (this.delayN === 0) return w;
    this.delay.push(w);
    if (this.delay.length <= this.delayN) return 0;
    return this.delay.shift() as number;
  }

  resetRound(): void {
    this.q.length = 0;
    this.last = 0;
    this.delay.length = 0;
  }
}
