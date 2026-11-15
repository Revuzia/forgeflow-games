// HIT PARADE - UI game lab entry (lane UI; dev only: runtime/lab/ui_game.html, never linked from index.html).
//
// CHANGED(integrator) P2: the CONTRACT 27 SHELL requests this page used to patch onto Game.prototype (27.1 the training
// driver: begin / pending + tick / frame(projector) / end; 27.3 MatchResult.rounds) are now in game.ts itself, and 27.2
// (the Menus.onlineEvent forwards) has been there since NET P2 (29.6). A second wrapper would drive the driver twice per
// tick and frame, so this entry now boots the REAL game unpatched and keeps only its read-backs:
//   window.__UIGAME__ = { patched: false, trainer(), boxes() }   (the game's own read-back: __HP__.state().trainer)

import { readBoxes } from '../ui/trainer.ts';
import type { Match } from '../core/sim/match.ts';
import { Game } from '../game.ts';

interface GameLike { bout: { m: Match; trainer?: { readback(): unknown } | null } | null }
type AnyFn = (...a: unknown[]) => unknown;
const P = Game.prototype as unknown as Record<string, AnyFn>;

(window as unknown as Record<string, unknown>).__UIGAME__ = {
  patched: false,
  trainer: (): unknown => {
    const g = (window as unknown as { __HP_GAME__?: GameLike }).__HP_GAME__;
    return g?.bout?.trainer?.readback() ?? null;
  },
  /** the sim's boxes right now (world metres) - what the HITBOX overlay projects */
  boxes: (): unknown => {
    const g = (window as unknown as { __HP_GAME__?: GameLike }).__HP_GAME__;
    return g?.bout ? readBoxes(g.bout.m) : null;
  },
};

// capture the Game instance for the read-back (main.ts keeps it in a closure)
const origStart = P.start;
P.start = function (this: GameLike, ...args: unknown[]) {
  (window as unknown as { __HP_GAME__?: GameLike }).__HP_GAME__ = this;
  return origStart.apply(this, args);
};

await import('../main.ts');
