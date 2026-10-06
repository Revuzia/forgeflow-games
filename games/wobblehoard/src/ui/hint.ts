// The one-line gesture hint: visible until the first interaction, hidden while the player is playing, and back after 20 s
// of idleness. Pure (the caller passes the clock) so the probe can test the timing without a browser.

export const HINT_IDLE_MS = 20000;

export interface HintController {
  /** Any gesture, tap, key or drag. */
  interact(nowMs: number): void;
  visible(nowMs: number): boolean;
}

export function createHintController(idleMs: number = HINT_IDLE_MS): HintController {
  let last = -Infinity;
  let touched = false;
  return {
    interact(now) { last = now; touched = true; },
    visible(now) { return !touched || now - last >= idleMs; },
  };
}

/** Wording per input style. One line, plain words, ONE wording for the pull everywhere ("drag out to stretch": press on the squishy,
 *  then drag away from it). The keyboard line appears once a key has been used (audit finding 17). The pointer line (a mouse or pen, never
 *  a touch screen) adds the Shift pull (src/input/gestures.ts SHIFT: Shift + drag pulls both sides at once, the way two fingers do on a
 *  phone). Pressing Shift alone does not count as a key used (keyboard.ts ignores it), so the line stays while someone holds Shift to drag.
 *  Taps pay nothing now (owner decision 2026-10-06): the lines name what to DO, never what it earns. */
export const HINT_TEXT = {
  touch: 'Tap to poke · hold to squish · drag out to stretch',
  pointer: 'Click to poke · hold to squish · drag out to stretch · Shift + drag pulls both sides',
  keyboard: 'Space to poke · hold Space to squish · arrows look around',
} as const;
