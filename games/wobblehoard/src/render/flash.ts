// FlashGovernor (DESIGN.md 6.6). Every screen-level luminance event of the ceremonies asks it for permission first.
//   * at most 2 luminance flashes in any rolling second, never stacked (a flash = ONE ramp: attack 80 ms, decay 400 ms);
//   * the screen-wide additive alpha is capped at 0.25;
//   * shock rings are at least 500 ms apart;
//   * ember-coral and lagoon-cyan tints never alternate faster than 2 Hz (the opposite family is refused for 500 ms);
//   * calm effects: no flash at all, no rings (they become fades), no pulses.
// Pure TypeScript, no GL: the browser probe drives it directly with adversarial sequences.

export type TintFamily = 'coral' | 'cyan' | 'other';

export const FLASH_ALPHA_CAP = 0.25;
export const FLASH_ATTACK_S = 0.08;
export const FLASH_DECAY_S = 0.4;
export const RING_MIN_GAP_S = 0.5;
export const TINT_MIN_GAP_S = 0.5;

export class FlashGovernor {
  calm = false;
  private flashStarts: number[] = [];
  private lastRing = -1e9;
  private lastTintFamily: TintFamily = 'other';
  private lastTintAt = -1e9;
  /** Counters for the probe. */
  granted = 0;
  refused = 0;

  reset(): void {
    this.flashStarts.length = 0;
    this.lastRing = -1e9; this.lastTintFamily = 'other'; this.lastTintAt = -1e9;
    this.granted = this.refused = 0;
  }

  /** Ask to start a luminance flash of screen alpha `amp` at time `now` (seconds). Returns the allowed alpha, 0 = refused. */
  flash(now: number, amp: number): number {
    const fs = this.flashStarts;
    while (fs.length && now - fs[0] >= 1) fs.shift();
    const last = fs.length ? fs[fs.length - 1] : -1e9;
    if (this.calm || fs.length >= 2 || now - last < FLASH_ATTACK_S + FLASH_DECAY_S || !(amp > 0)) { this.refused++; return 0; }
    fs.push(now);
    this.granted++;
    return Math.min(FLASH_ALPHA_CAP, amp);
  }

  /** May a shock ring start now? (>= 500 ms after the previous one; never in calm mode.) */
  ring(now: number): boolean {
    if (this.calm || now - this.lastRing < RING_MIN_GAP_S) return false;
    this.lastRing = now;
    return true;
  }

  /** Ask to tint the scene with a colour family; returns the family actually allowed (the previous one while the opposite is refused). */
  tint(now: number, family: TintFamily): TintFamily {
    const opposite = (family === 'coral' && this.lastTintFamily === 'cyan') || (family === 'cyan' && this.lastTintFamily === 'coral');
    if (opposite && now - this.lastTintAt < TINT_MIN_GAP_S) return this.lastTintFamily;
    if (family !== 'other') { this.lastTintFamily = family; this.lastTintAt = now; }
    return family;
  }
}

/** The single light ramp of a burst: attack 80 ms, decay 400 ms, no oscillation. `age` seconds since the ramp started. */
export function rampEnvelope(age: number): number {
  if (age <= 0) return 0;
  if (age < FLASH_ATTACK_S) { const x = age / FLASH_ATTACK_S; return x * x * (3 - 2 * x); }
  const d = (age - FLASH_ATTACK_S) / FLASH_DECAY_S;
  if (d >= 1) return 0;
  const e = 1 - d;
  return e * e;
}
