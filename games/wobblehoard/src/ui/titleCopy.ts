// The title card's copy and timing constants: pure data (no DOM, no CSS import), so the node probes can read them.
export const WORD = 'SQUISH KEEPER';
export const CTA_LABEL = 'Wake it up';
export const TAGLINE = 'A squishy toy that squishes back.';
export const STATUS_WARMING = 'Warming up…';
export const STATUS_READY = 'Ready. Press Wake it up to start.';
/** The intro runs about 1.2 s (jelly.css: 42 ms between letters, 600 ms each; title.css: the plate, the button and the chips follow). */
export const INTRO_MS = 1250;
/** The lockup's bounce pose (a fixed tilt and lift per letter, jelly.ts). */
export const BOUNCE_POSE = 1.25;
/** The owner's decision (2026-10-08): the bounce pose is off in Calm and reduced motion (a straight lockup). */
export const BOUNCE_IN_CALM = false;
