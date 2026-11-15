// BLOCKTOOTH VS — death, spectating and the end-of-match hand-off rules (vs_design.md §11). Lane B-VS.
// Pure helpers for the view / app layer (B-VIEW). They read the world and never change it; the camera, the keys (Q / E,
// pad LB / RB, touch arrows) and the LEAVE button are B-VIEW's.
//
//   EVICTED (4:00-7:00)  the camera holds on the killer for the 5 s respawn ("BACK IN 5", the KO line, the levels lost)
//   eliminated (7:00+)   2.5 s following the killer, then spectate the living titans; Q / E cycle them; the seat cards stay up
//   LEAVE                works any time; the placement is already locked and the match result still posts

import { VS } from '../core/config.ts';
import type { World } from '../core/types.ts';

/** Slots of the titans a spectator can watch: not eliminated, body up (a KO'd seat waiting to respawn is not watchable). */
export function spectateSlots(w: World): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.players.length; i++) {
    const P = w.players[i];
    if (!P.vs.eliminated && P.titan.alive) out.push(i);
  }
  return out;
}

/** Next / previous living titan after `from` in slot order, wrapping (dir +1 = E / RB, -1 = Q / LB). -1 when nobody is up. */
export function cycleSpectate(w: World, from: number, dir: 1 | -1): number {
  const n = w.players.length;
  for (let k = 1; k <= n; k++) {
    const i = ((from + dir * k) % n + n) % n;
    const P = w.players[i];
    if (!P.vs.eliminated && P.titan.alive) return i;
  }
  return -1;
}

/**
 * Whom seat `slot`'s camera shows right now:
 *   alive               itself
 *   evicted, respawning the killer (or itself when nobody killed it) until it is back
 *   eliminated          the killer for VS.ko.followKillerS after the elimination, then the first living titan after it (slot order)
 * Returns { slot, following: 'self'|'killer'|'spectate', backInS }. `backInS` = seconds to the respawn ("BACK IN 5"), else 0.
 */
export function cameraTarget(w: World, slot: number): { slot: number; following: 'self' | 'killer' | 'spectate'; backInS: number } {
  const P = w.players[slot];
  if (!P) return { slot: 0, following: 'self', backInS: 0 };
  if (!P.vs.eliminated) {
    if (P.titan.alive) return { slot, following: 'self', backInS: 0 };
    const k = P.vs.lastKillerSlot;
    const back = P.vs.respawnT >= 0 ? Math.max(0, P.vs.respawnT - w.t) : 0;
    return { slot: k >= 0 && k !== slot ? k : slot, following: k >= 0 && k !== slot ? 'killer' : 'self', backInS: back };
  }
  const k = P.vs.lastKillerSlot;
  if (k >= 0 && k !== slot && w.t - P.vs.elimT < VS.ko.followKillerS && !w.players[k].vs.eliminated) return { slot: k, following: 'killer', backInS: 0 };
  const next = cycleSpectate(w, slot, 1);
  return { slot: next >= 0 ? next : slot, following: 'spectate', backInS: 0 };
}
