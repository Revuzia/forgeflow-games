// Keyboard glue. Space = poke the centre (hold it to squish: it is a synthetic pointer at the body's centre, so it runs
// the SAME gesture code as a finger), G = gravity <-> float, M = mute, Escape = close the panel.
// Extras for people who cannot drag: arrow keys orbit, + / - zoom.
// Shortcuts stay out of the way of focused controls (a slider owns the arrows, a button owns Space).
import type { App } from '../app.ts';

export const KEY_POINTER_ID = -1000;
const ORBIT_PX = 26;

export interface KeyTarget {
  addEventListener(type: string, fn: (e: Event) => void, opts?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, fn: (e: Event) => void, opts?: boolean | EventListenerOptions): void;
}

export interface KeyboardOptions {
  /** Escape pressed: return true if something was closed (then the event is consumed). */
  onEscape(): boolean;
}

interface KeyEventLike extends Event {
  key: string; code: string; repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean;
}

const INTERACTIVE = new Set(['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'SUMMARY']);
function interactiveTarget(t: EventTarget | null): boolean {
  const el = t as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (INTERACTIVE.has(el.tagName)) return true;
  if (el.isContentEditable) return true;
  const role = el.getAttribute?.('role');
  return role === 'button' || role === 'switch' || role === 'slider' || role === 'radio';
}

export function attachKeyboard(target: KeyTarget, app: Pick<App, 'input' | 'phase' | 'toggleGravity' | 'toggleMute'>, opts: KeyboardOptions): () => void {
  let spaceHeld = false;

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
    if (e.key === 'Escape') { if (opts.onEscape()) e.preventDefault(); return; }
    if (app.phase !== 'play') return;
    const inControl = interactiveTarget(e.target);
    const key = e.key;
    if (key === ' ' || e.code === 'Space') {
      if (inControl) return;
      e.preventDefault();
      if (e.repeat || spaceHeld) return;
      const c = app.input.screenCentre();
      if (!c) return;
      spaceHeld = true;
      app.input.pointerDown({ id: KEY_POINTER_ID, x: c.x, y: c.y, type: 'touch' });
      return;
    }
    if (e.repeat && (key === 'g' || key === 'G' || key === 'm' || key === 'M')) return;
    if (key === 'g' || key === 'G') { app.toggleGravity(); return; }
    if (key === 'm' || key === 'M') { app.toggleMute(); return; }
    if (inControl) return; // arrows belong to a focused slider / select
    switch (key) {
      case 'ArrowLeft': e.preventDefault(); app.input.orbitBy(-ORBIT_PX, 0); break;
      case 'ArrowRight': e.preventDefault(); app.input.orbitBy(ORBIT_PX, 0); break;
      case 'ArrowUp': e.preventDefault(); app.input.orbitBy(0, -ORBIT_PX); break;
      case 'ArrowDown': e.preventDefault(); app.input.orbitBy(0, ORBIT_PX); break;
      case '+': case '=': e.preventDefault(); app.input.zoomBy(-1); break;
      case '-': case '_': e.preventDefault(); app.input.zoomBy(1); break;
    }
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
