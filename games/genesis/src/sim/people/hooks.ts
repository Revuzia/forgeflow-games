// GENESIS — the god layer's hooks into the peoples' decisions (CONTRACT.md §11.1): a POSSESSED person does what the
// player orders (god/possess.ts), a DISCIPLE carries its god's will before its own wants (god/disciples.ts), and a
// person held by the hand or flying through the air makes no decisions until set down (god/hand.ts). The god layer
// fills these in at load; the peoples code never imports the god layer (no import cycle).

import type { PCtx } from './ctx.ts';
import type { TaskSpec } from './tasks.ts';
import type { Settlement } from './state.ts';

export const godHooks: {
  /** the next order of a possessed agent (null: stand and wait) */
  possessed: ((x: PCtx, s: number) => TaskSpec | null) | null;
  /** a disciple's task by its standing order (null: live as usual this turn) */
  disciple: ((x: PCtx, s: number, st: Settlement | undefined, night: boolean) => TaskSpec | null) | null;
  /** is this agent in the god's hand or in flight (no decisions) */
  held: ((x: PCtx, s: number) => boolean) | null;
} = { possessed: null, disciple: null, held: null };
