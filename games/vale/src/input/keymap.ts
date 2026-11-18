// VALE input — the keymap (CONTRACT §10 "Input"). Settings.controls.binds maps an ACTION to a
// KeyboardEvent.code (layout-independent) or a mouse button ('Mouse0'..'Mouse4'); defaults live in
// src/session/settings.ts. This module inverts that table for the controller and gives the HUD its key
// labels. Action vocabulary (code, not content): a1 a2 a3 ult spell1 spell2 item1..item6 recall shop
// scoreboard ping attackMove stop cameraLock centerCamera selfCastMod fightersOnly (held: clicks and
// attack-moves consider enemy fighters only) attackInPlace (held: a left-click attacks in place toward the cursor,
// never walking; default Shift, ruling 39) showRange (held: your attack-range ring) levelUpMod (held with an ability key:
// level it up; default Ctrl) viewAlly1..viewAlly4 (held: the camera watches that ally; ruling 54).

import type { SlotT } from '../contracts/catalog.ts';
import type { Settings } from '../contracts/session.ts';

export type Action =
  | 'a1' | 'a2' | 'a3' | 'ult' | 'spell1' | 'spell2'
  | 'item1' | 'item2' | 'item3' | 'item4' | 'item5' | 'item6'
  | 'recall' | 'shop' | 'scoreboard' | 'ping' | 'attackMove' | 'stop' | 'cameraLock' | 'centerCamera' | 'selfCastMod' | 'fightersOnly' | 'attackInPlace'
  | 'showRange' | 'levelUpMod' | 'viewAlly1' | 'viewAlly2' | 'viewAlly3' | 'viewAlly4';
/** the hold-to-watch-an-ally actions, in ally order */
export const VIEW_ALLY: readonly Action[] = ['viewAlly1', 'viewAlly2', 'viewAlly3', 'viewAlly4'];

export const CAST_ACTIONS: readonly Action[] = ['a1', 'a2', 'a3', 'ult', 'spell1', 'spell2', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6'];
export const LEVEL_SLOTS = ['a1', 'a2', 'a3', 'ult'] as const;
export type LevelSlot = (typeof LEVEL_SLOTS)[number];

/** the sim slot an action casts (the action names are the slot names) */
export const slotOfAction = (a: Action): SlotT | null => (CAST_ACTIONS.includes(a) ? (a as SlotT) : null);

const MOUSE = ['Mouse0', 'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4'];
export const mouseCode = (button: number): string => MOUSE[button] ?? `Mouse${button}`;

const MODIFIER_PAIR = /^(Shift|Control|Alt|Meta)(Left|Right)$/;
/** `code` held, or — for a modifier key — either side of its pair */
function heldPair(code: string, held: ReadonlySet<string>): boolean {
  if (held.has(code)) return true;
  const m = MODIFIER_PAIR.exec(code);
  return !!m && (held.has(`${m[1]}Left`) || held.has(`${m[1]}Right`));
}

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
  selfCastHeld(held: ReadonlySet<string>): boolean { return heldPair(this.selfCast, held); }
  /** is an action's key held (a modifier bind: either side of the pair counts) */
  isHeld(action: Action, held: ReadonlySet<string>): boolean { const c = this.binds[action]; return !!c && heldPair(c, held); }
}
