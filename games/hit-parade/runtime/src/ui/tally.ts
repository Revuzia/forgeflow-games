// HIT PARADE - the live bout's round log + bonus tallies, shared by the Hud (writer) and the results screen (reader)
// (lane UI; CONTRACT 27.3). The Hud logs every round from the sim's own events + snapshots; results.ts shows the
// per-round breakdown (and the bonus-round grade) for the SAME bout - matched by the cfg object game.ts hands both
// (Hud.mount(cfg) / MatchResult.cfg), or by mode + seed + fighters when a caller rebuilt the cfg.

import type { MatchCfg, RoundLog } from './types.ts';

export interface BonusTally { goonsDown: number; goonsSpawned: number; heckles: number; parried: number; perfect: number; hitsTaken: number }
export interface BoutLog { cfg: MatchCfg; rounds: RoundLog[]; bonus: BonusTally }

let live: BoutLog | null = null;

export function blankBonus(): BonusTally { return { goonsDown: 0, goonsSpawned: 0, heckles: 0, parried: 0, perfect: 0, hitsTaken: 0 }; }

export function setBoutLog(b: BoutLog | null): void { live = b; }

export function boutLogFor(cfg: MatchCfg): BoutLog | null {
  if (!live) return null;
  if (live.cfg === cfg) return live;
  const a = live.cfg;
  const same = a.mode === cfg.mode && a.seed === cfg.seed && a.p[0].fighter === cfg.p[0].fighter && a.p[1].fighter === cfg.p[1].fighter;
  return same ? live : null;
}
