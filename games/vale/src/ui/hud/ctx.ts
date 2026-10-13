// VALE HUD — the context every HUD widget reads: the match model, the input controller, the renderer
// seam (structural; render/ is not imported), the shop/scoreboard toggles and small helpers.

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Signal } from '@preact/signals';
import type { MatchClient } from '../../contracts/session.ts';
import type { EntityView } from '../../contracts/sim.ts';
import type { AbilityIndex, InputController, InputRenderer } from '../../input/index.ts';
import type { HudModel } from './model.ts';

export interface HudCtx {
  client: MatchClient;
  model: HudModel;
  input: InputController;
  index: AbilityIndex;
  r: InputRenderer;
  shopOpen: Signal<boolean>;
  board: Signal<boolean>;
  /** shape of the minimap (by the mode's structure: roads → wide, a span → strip, FFA → disc) */
  mapShape: 'rect' | 'strip' | 'disc';
  /** label for an action's key (from the player's binds) */
  key(action: string): string;
}

export const HudContext = createContext<HudCtx>(null as unknown as HudCtx);
export const useHud = (): HudCtx => useContext(HudContext);

/** CSS colour variable for a relationship */
export const REL_VAR = { self: 'var(--team-self)', ally: 'var(--team-ally)', enemy: 'var(--team-enemy)', neutral: 'var(--team-neutral)' } as const;

/** seconds → the cooldown readout: "12", "4", "0.6" */
export function cdText(s: number): string {
  if (s <= 0) return '';
  return s < 1 ? s.toFixed(1) : String(Math.ceil(s - 0.001));
}

export function alive(e: EntityView | undefined): e is EntityView { return !!e && e.alive; }
