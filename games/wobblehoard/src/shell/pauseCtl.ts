// The portal's pause contract (UI.md 6.1, PUBLISH_CHECKLIST_SHORT #9): `window.__PAUSE__ = { pause, resume, toggle }`. The Menu IS the pause screen: opening it suspends the game
// ('covered': the sim stops, the music fades, no finger reaches the toy; hudBinding.ts wires that to the Menu's onOpen / onClose), so `pause()` is "open the Menu" and `resume()` is
// "close it". Synchronous on purpose (a portal calls it when its own overlay opens and expects the game to be still at once), installed at boot, idempotent, a no-op on the
// title and on the error card, and never tied to a window blur (the tab-hidden pause is the lifecycle's own).
import type { Phase } from './game.ts';

export interface PauseTarget {
  phase(): Phase;
  /** the Menu: open() returns false when it was already open */
  menu: { readonly isOpen: boolean; open(): boolean; close(why?: string): boolean };
}
export interface PauseCtl { pause(): void; resume(): void; toggle(): void }

declare global { interface Window { __PAUSE__?: PauseCtl } }

export function createPauseCtl(t: PauseTarget): PauseCtl {
  const pause = (): void => { if (t.phase() !== 'play' || t.menu.isOpen) return; t.menu.open(); };
  const resume = (): void => { if (t.menu.isOpen) t.menu.close('resume'); };
  return { pause, resume, toggle() { if (t.menu.isOpen) resume(); else pause(); } };
}

/** Put the contract on `window` (replacing an older copy: a hot reload, a second boot). Returns the undo, which removes it only if it is still ours. */
export function installPauseCtl(t: PauseTarget, win: Window = window): () => void {
  const ctl = createPauseCtl(t);
  const mine: PauseCtl = { pause: ctl.pause, resume: ctl.resume, toggle: ctl.toggle };
  win.__PAUSE__ = mine;
  return () => { if (win.__PAUSE__ === mine) delete win.__PAUSE__; };
}
