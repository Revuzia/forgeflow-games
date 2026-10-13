// VALE input — the keymap (CONTRACT §10 "Input"). Settings.controls.binds maps an ACTION to a
// KeyboardEvent.code (layout-independent) or a mouse button ('Mouse0'..'Mouse4'); defaults live in
// src/session/settings.ts. This module inverts that table for the controller and gives the HUD its key
// labels. Action vocabulary (code, not content): a1 a2 a3 ult spell1 spell2 item1..item6 recall shop
// scoreboard ping attackMove stop cameraLock centerCamera selfCastMod.

import type { SlotT } from '../contracts/catalog.ts';
import type { Settings } from '../contracts/session.ts';

export type Action =
  | 'a1' | 'a2' | 'a3' | 'ult' | 'spell1' | 'spell2'
  | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'item6'
  | 'recall' | 'shop' | 'scoreboard' | 'ping' | 'attackMove' | 'stop' | 'cameraLock' | 'centerCamera' | 'selfCastMod';

export const CAST_ACTIONS: readonly Action[] = ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6'];
export const LEVEL_SLOTS = ['a1', 'a2', 'a3', 'ult'] as const;
export type LevelSlot = (typeof LEVEL_SLOTS)[number];

/** the sim slot an action casts (the action names are the slot names) */
export const slotOfAction = (a: Action): SlotT | null => (CAST_ACTIONS.includes(a) ? (a as SlotT) : null);

const MOUSE = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'];
export const mouseCode = (button: number): string => MOUSE[button] ?? `Mouse${button}`;

export class Keymap {
  private byCode = new Map<string, Action[]>();
  private binds: Record<string, string> = {};
  selfCast = 'AltLeft';

  constructor(controls?: Settings['controls']) { if (controls) this.set(controls); }

  set(controls: Settings['controls']): void {
    this.binds = { ...controls.binds };
    this.selfCast = controls.selfCastModifier || controls.binds.selfCastMod || 'AltLeft';
    this.byCode.clear();
    for (const [action, code] of Object.entries(this.binds)) {
      if (!code) continue;
      const list = this.byCode.get(code) ?? [];
      list.push(action as Action);
      this.byCode.set(code, list);
    }
  }

  /** actions bound to a key code (usually one) */
  actions(code: string): readonly Action[] { return this.byCode.get(code) ?? []; }
  code(action: Action): string | undefined { return this.binds[action]; }
  /** is the self-cast modifier held (either side of a modifier pair counts) */
  selfCastHeld(held: ReadonlySet<string>): boolean {
    const c = this.selfCast;
    if (held.has(c)) return true;
    const pair = c.replace(/(Left|Right)$/, '');
    return pair !== c && (held.has(`${pair}Left`) || held.has(`${pair}Right`));
  }
}
