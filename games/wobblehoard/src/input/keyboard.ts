// Keyboard glue. Space = poke the centre (hold it to squish: it is a synthetic pointer at the body's centre, so it runs the SAME gesture
// code as a finger), G = gravity <-> float, M = mute, H = the Hoard, T = the toy tray, C = the Cut tool, [ ] = switch, Escape = close the panel. Extras for people who cannot drag: arrow keys orbit,
// + / - zoom. During a ceremony Space, Enter and Escape skip it (after the 350 ms gate).
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
  /** G / M allowed (Settings.shortcuts). Default: always. */
  shortcutsEnabled?(): boolean;
  /** a key reached the toy (the hint switches to keyboard wording) */
  onKeyUsed?(): void;
  /** H: open or close the Hoard (COLLECTION 9.1); a single-letter shortcut like G and M (same rules) */
  onHoard?(): void;
  /** [ and ]: switch the play squishy (the HUD quick switcher); same rules as G and M */
  onSwitch?(dir: -1 | 1): void;
  /** T: open the toy tray (FUN.md 1); same rules as G and M */
  onToys?(): void;
  /** C: the Cut tool on or off (CUT.md 1); same rules as G and M */
  onCut?(): void;
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
    if (key === 'Escape') { if (opts.onEscape()) e.preventDefault(); return; }
    if (app.phase !== 'play') return;
    const inControl = interactiveTarget(e.target);
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
    if (inControl) return; // letters, arrows and +/- belong to a focused control (a slider's arrows, a select's typeahead)
    if ((key === '[' || key === ']') && opts.onSwitch) {
      if (e.repeat || !shortcuts()) return;
      opts.onKeyUsed?.();
      opts.onSwitch(key === ']' ? 1 : -1);
      return;
    }
    if ((key === 't' || key === 'T') && opts.onToys) {
      if (e.repeat || !shortcuts()) return;
      e.preventDefault();   // the tray takes focus: the key must not type into it
      opts.onKeyUsed?.();
      opts.onToys();
      return;
    }
    if ((key === 'c' || key === 'C') && opts.onCut) {
      if (e.repeat || !shortcuts() || app.input.live === false) return;
      opts.onKeyUsed?.();
      opts.onCut();
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
