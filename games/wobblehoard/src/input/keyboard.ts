// Keyboard glue. Space = poke the centre (hold it to squish: it is a synthetic pointer at the body's centre, so it runs the SAME gesture
// code as a finger), G = gravity <-> float, M = mute, H = the Hoard, 1 2 3 = the tools (Hand, Cut, Snap), C = Cut, S = Snap, F = full screen, P = the Menu, ? = How to play,
// [ ] = switch, Escape = close what is open (hudBinding.ts escape(): the order of UI.md 4.5). Extras for people who cannot drag: arrow keys orbit, + / - zoom. During a ceremony Space, Enter and Escape skip it (after the 350 ms gate).
// LOCK (_spec/LOCK.md): a Shift keydown (not on key repeat, not in a form control; a focused button of the dock does not count as one) calls app.input.lock(): the pulls held right now
// that are fully stretched stay where they are. Shift alone is NOT "a key used" (the hint keeps its wording). Escape lets every lock go FIRST, but only when a lock exists and no panel
// is open (`panelOpen`: the More popover, a modal or photo card, the Menu, Settings, the Hoard); with a panel open Escape closes it as ever (UI.md 4.5), the locks stay.
//
// Focus rules (WCAG 2.1.1 / 2.1.4; audit findings 12 and 13):
//   * A focused control (button, input, select, a role=button/switch/slider/radio element, contentEditable) owns its keys: Space activates
//     the button, arrows move the slider, and the single-letter shortcuts G and M do NOTHING there (M is the Quality select's typeahead).
//   * The squishy's own focus target (src/ui/playTarget.ts, role=application) and the page itself (nothing focused) are play surfaces.
//   * G and M can be switched off in Settings ("Keyboard shortcuts"); Ctrl / Cmd / Alt combinations are always left alone.
import type { Game as App } from '../shell/game.ts';

export const KEY_POINTER_ID = -1000;
const ORBIT_PX = 26;

export interface KeyTarget {
  addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | EventListenerOptions): void;
}

export interface KeyboardOptions {
  /** Escape pressed: return true if something was closed (then the event is consumed). */
  onEscape(): boolean;
  /** LOCK: a panel that Escape would close first is open (UI.md 4.5 items 2 to 5 and the More popover): then Escape does not let the locks go. Default: none open. */
  panelOpen?(): boolean;
  /** G / M allowed (Settings.shortcuts). Default: always. */
  shortcutsEnabled?(): boolean;
  /** a key reached the toy (the hint switches to keyboard wording) */
  onKeyUsed?(): void;
  /** H: open or close the Hoard (COLLECTION 9.1); a single-letter shortcut like G and M (same rules) */
  onHoard?(): void;
  /** [ and ]: switch the play squishy (the HUD quick switcher); same rules as G and M */
  onSwitch?(dir: -1 | 1): void;
  /** 1 Hand, 2 or C Cut, 3 or S Snap (UI.md 4.5): the toolbar's keys; same rules as G and M. The caller decides what a tool key does now (the active Cut or Snap
   *  pressed again returns the Hand; a busy or unavailable tool says why). Not gated by `input.live`: a ceremony is a reason the caller says out loud. */
  onTool?(id: 'hand' | 'cut' | 'snap'): void;
  /** F: full screen on / off (UI.md 6.1); same rules as G and M */
  onFullscreen?(): void;
  /** P: the Menu (UI.md 4.5); same rules as G and M */
  onMenu?(): void;
  /** ?: How to play; same rules as G and M */
  onHelp?(): void;
}

interface KeyEventLike extends Event {
  key: string; code: string; repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
}

const INTERACTIVE = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY']);
/** true for a focused control that owns its keys; the squishy's play target is NOT one (role=application is ours). */
export function interactiveTarget(t: EventTarget | null): boolean {
  const el = t as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (INTERACTIVE.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.('role');
  return role === 'button' || role === 'switch' || role === 'slider' || role === 'radio' || role === 'menuitem' || role === 'tab' || role === 'textbox' || role === 'combobox' || role === 'option';
}

/** a <button> inside the dock (#wh-dock: the toolbar, the Hoard button, the options bar): it does not own the letter and digit shortcuts */
const onDockButton = (t: EventTarget | null): boolean => { const el = t as Element | null; return !!el && el.tagName === 'BUTTON' && !!el.closest?.('#wh-dock'); };

export function attachKeyboard(target: KeyTarget, app: Pick<App, 'input' | 'phase' | 'toggleGravity' | 'toggleMute'>, opts: KeyboardOptions): () => void {
  let spaceHeld = false;
  const shortcuts = opts.shortcutsEnabled ?? (() => true);

  const releaseSpace = (cancel: boolean): void => {
    if (!spaceHeld) return;
    spaceHeld = false;
    const c = app.input.screenCentre() ?? { x: 0, y: 0 };
    if (cancel) app.input.pointerCancel(KEY_POINTER_ID);
    else app.input.pointerUp({ id: KEY_POINTER_ID, x: c.x, y: c.y, type: 'touch' });
  };

  const onDown = (ev: Event): void => {
    const e = ev as KeyEventLike;
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    const space = key === ' ' || e.code === 'Space';
    // a ceremony: Space / Enter / Escape skip it (the 350 ms gate is the ceremony controller's), nothing else reaches the toy
    if (app.phase === 'play' && (space || key === 'Enter' || key === 'Escape') && !interactiveTarget(e.target) && app.input.skip()) { e.preventDefault(); return; }
    if (key === 'Escape') {
      // LOCK: with locks held and nothing open, the first Escape lets them go (and nothing else happens); the next one is the usual Escape (UI.md 4.5)
      if (app.phase === 'play' && app.input.locks > 0 && !(opts.panelOpen?.() ?? false) && app.input.releaseLocks()) { e.preventDefault(); return; }
      if (opts.onEscape()) e.preventDefault();
      return;
    }
    if (app.phase !== 'play') return;
    const inControl = interactiveTarget(e.target);
    // LOCK: a Shift tap locks the stretched pulls. Not a key used for the hint; a dock button keeps it (the mouse player just clicked a tool and pulls with the same hand), a real form control does not
    if (key === 'Shift') { if (!e.repeat && (!inControl || onDockButton(e.target))) app.input.lock(); return; }
    if (space) {
      if (inControl) return;
      e.preventDefault();
      if (e.repeat || spaceHeld) return;
      const c = app.input.screenCentre();
      if (!c) return;
      spaceHeld = true;
      opts.onKeyUsed?.();
      app.input.pointerDown({ id: KEY_POINTER_ID, x: c.x, y: c.y, type: 'touch' });
      return;
    }
    // letters, arrows and +/- belong to a focused control (a slider's arrows, a select's typeahead). A focused BUTTON of the dock (a tool, the Hoard button, a button of the options bar)
    // owns only Enter and Space: after a click on a tool, or after Snap focuses its Save button, the focus stays on a button and the shortcuts (1 2 3 C S H G M [ ]) must keep working then
    if (inControl && !onDockButton(e.target)) return;
    if ((key === '[' || key === ']') && opts.onSwitch) {
      if (e.repeat || !shortcuts()) return;
      opts.onKeyUsed?.();
      opts.onSwitch(key === ']' ? 1 : -1);
      return;
    }
    const toolKey: 'hand' | 'cut' | 'snap' | null = key === '1' ? 'hand' : key === '2' || key === 'c' || key === 'C' ? 'cut' : key === '3' || key === 's' || key === 'S' ? 'snap' : null;
    if (toolKey && opts.onTool) {
      if (e.repeat || !shortcuts()) return;
      e.preventDefault();   // a tool takes focus (the options bar): the key must not type into it
      opts.onKeyUsed?.();
      opts.onTool(toolKey);
      return;
    }
    if ((key === 'f' || key === 'F') && opts.onFullscreen) {
      if (e.repeat || !shortcuts()) return;
      opts.onFullscreen();
      return;
    }
    if ((key === 'p' || key === 'P') && opts.onMenu) {
      if (e.repeat || !shortcuts()) return;
      opts.onMenu();
      return;
    }
    if (key === '?' && opts.onHelp) {
      if (e.repeat || !shortcuts()) return;
      opts.onHelp();
      return;
    }
    if ((key === 'h' || key === 'H') && opts.onHoard) {
      if (e.repeat || !shortcuts()) return;
      opts.onHoard();
      return;
    }
    if (key === 'g' || key === 'G' || key === 'm' || key === 'M') {
      if (e.repeat || !shortcuts() || app.input.live === false) return;   // live: no ceremony, nothing suspended (context loss)
      opts.onKeyUsed?.();
      if (key === 'g' || key === 'G') app.toggleGravity(); else app.toggleMute();
      return;
    }
    switch (key) {
      case 'ArrowLeft': e.preventDefault(); app.input.orbitBy(-ORBIT_PX, 0); break;
      case 'ArrowRight': e.preventDefault(); app.input.orbitBy(ORBIT_PX, 0); break;
      case 'ArrowUp': e.preventDefault(); app.input.orbitBy(0, -ORBIT_PX); break;
      case 'ArrowDown': e.preventDefault(); app.input.orbitBy(0, ORBIT_PX); break;
      case '+': case '=': e.preventDefault(); app.input.zoomBy(-1); break;
      case '-': case '_': e.preventDefault(); app.input.zoomBy(1); break;
      default: return;
    }
    opts.onKeyUsed?.();
  };
  const onUp = (ev: Event): void => {
    const e = ev as KeyEventLike;
    if (e.key === ' ' || e.code === 'Space') releaseSpace(false);
  };
  const onBlur = (): void => releaseSpace(true);

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
    releaseSpace(true);
  };
}
