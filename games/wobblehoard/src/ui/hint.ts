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

/** Wording per input style. One line, plain words. */
export const HINT_TEXT = {
  touch: 'Tap to poke · hold to squish · pull from the edge',
  pointer: 'Click to poke · hold to squish · drag off the edge to pull',
} as const;
