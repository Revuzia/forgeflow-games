// GENESIS — scheduling an agent's next turn on the planet's time wheel (CONTRACT.md §6.1: event-driven agents).
// The due tick is stored in the agent's `next` (saved), the wheel only indexes it (rebuilt on load); both always hold
// the same clamped value, so a loaded game wakes every agent at exactly the tick the live one would.

import type { PCtx } from './ctx.ts';

export function schedule(x: PCtx, s: number, tick: number): void {
  const w = x.ps.wheel;
  let t = Math.floor(tick);
  if (t < w.now) t = w.now;
  if (t <= x.tick) t = x.tick + 1;
  x.A.next[s] = t;
  w.schedule(x.A.id[s], t);
}
