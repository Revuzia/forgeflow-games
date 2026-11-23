// The one-line gesture hint: visible until the first interaction, hidden while the player is playing, and back after 20 s
// of idleness. Pure (the caller passes the clock) so the probe can test the timing without a browser.

export const HINT_IDLE_MS = 20000;

export interface HintController {
  /** Any gesture, tap, key or drag. */
  interact(nowMs: number): void;
  visible(nowMs: number): boolean;
  /** A tool was changed (the Cut or Snap picked, from anywhere): the first-run tool line has done its job. Memory only, never stored (UI.md 4.1). */
  toolTried(): void;
  /** The line to show now: the gesture help until the first interaction; when the pill comes BACK after the idle gap and no tool was tried yet this
   *  session, the first-run tool line ("Tap a tool to try it."); the gesture help again once a tool was tried. LOCK: for a mouse or a keyboard (never a touch screen) every
   *  second return of the pill after an idle gap shows the lock line instead (HINT_LOCK): the gesture line is already as long as a line may be. */
  line(mode: HintMode): string;
}

export type HintMode = 'touch' | 'pointer' | 'keyboard';

export function createHintController(idleMs: number = HINT_IDLE_MS): HintController {
  let last = -Infinity;
  let touched = false;
  let tried = false;
  let returns = 0;   // interactions that came after the pill had been shown again (an idle gap): the odd-numbered ones are followed by the lock line
  return {
    interact(now) { if (touched && now - last >= idleMs) returns++; last = now; touched = true; },
    visible(now) { return !touched || now - last >= idleMs; },
    toolTried() { tried = true; },
    line(mode) { return touched && mode !== 'touch' && returns % 2 === 1 ? HINT_LOCK[mode] : touched && !tried ? HINT_TOOLS[mode] : room !== null && mode !== 'keyboard' ? room[mode] : HINT_TEXT[mode]; },
  };
}

/** (round 14, R14_CARRY, D-105) where squishies are moved around (a place; Home with two or more out) a drag that starts on a squishy carries it and a stretch
 *  starts from a hold: the gesture line says so there. The life host sets the lines (shell/later-carry.ts HINT_ROOM: they ride in the lazy chunk); null = the
 *  published HINT_TEXT (Home with one squishy out) */
let room: { readonly touch: string; readonly pointer: string } | null = null;
export function setHintRoom(lines: { readonly touch: string; readonly pointer: string } | null): void { room = lines; }

/** Wording per input style. One line, plain words, ONE wording for the pull everywhere ("drag out to stretch": press on the squishy,
 *  then drag away from it). The keyboard line appears once a key has been used (audit finding 17). The pointer line (a mouse or pen, never
 *  a touch screen) adds the Shift pull (src/input/gestures.ts SHIFT: Shift + drag pulls both sides at once, the way two fingers do on a
 *  phone). Pressing Shift alone does not count as a key used (keyboard.ts ignores it), so the line stays while someone holds Shift to drag.
 *  Taps pay nothing now (owner decision 2026-10-06): the lines name what to DO, never what it earns. */
export const HINT_TEXT = {
  touch: 'Tap to poke · hold to squish · drag out to stretch',
  pointer: 'Click to poke · hold to squish · drag out to stretch · Shift + drag pulls both sides',
  keyboard: 'Space to poke · hold Space to squish · arrows look around',
} as const;

/** The lock line (LOCK.md): said on every second return of the pill, for a mouse or a keyboard (a phone has no Shift and no lock). It does not fit the gesture line on a narrow screen
 *  (that line must stay on one or two lines, browser_shell shift-hint-reflow), so it takes the pill's turn instead. The same words as the Settings keys line (screenCopy.ts KEYS_LINE). */
export const HINT_LOCK = {
  pointer: 'Shift while stretched fully locks a pull; Esc lets go',
  keyboard: 'Shift while stretched fully locks a pull; Esc lets go',
} as const;

/** The first-run line (UI.md 4.1, R10): the dock shows the tools, this says they are there. One wording per input style; no storage, so it is a
 *  per-visit nudge, and `toolTried()` retires it. */
export const HINT_TOOLS = {
  touch: 'Tap a tool to try it.',
  pointer: 'Click a tool to try it.',
  keyboard: 'Press 2 for Cut, 3 for Snap.',
} as const;

/** How a tool was changed. The tool caption chip (toolbar.ts showCaption, 1.4 s, aria-hidden) is for touch and keys (UI.md 4.1, R10): a mouse already has the
 *  tooltip, and a change the game makes itself (a ceremony starts, Done, Esc) is spoken by the live region only. */
export type ToolSource = 'touch' | 'key' | 'mouse' | 'game';
export const showsToolCaption = (source: ToolSource): boolean => source === 'touch' || source === 'key';
/** PointerEvent.pointerType -> a ToolSource ('' and unknown count as mouse) */
export const toolSourceOfPointer = (pointerType: string): ToolSource => (pointerType === 'touch' || pointerType === 'pen' ? 'touch' : 'mouse');
