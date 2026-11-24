// Focus navigation for the menus: arrow keys and a gamepad move the focus to the nearest control in
// that direction, wherever the layout put it (a column on a phone, a grid on a desktop), so no
// screen needs its own key handling. Tab and Shift+Tab still work as the browser does them.
//
// The geometry is a pure function (pickTarget) so it can be tested without a DOM.

/** CSS selector of everything that can take focus in a menu. */
export const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * From `cur` ({ x, y, w, h } in pixels), the index in `rects` of the best control in direction
 * dir ('up' | 'down' | 'left' | 'right'), or -1. "Best": it must lie beyond the current control's
 * centre in that direction; the nearest one wins, and one that overlaps it across the direction
 * of travel (the button straight below, not the one below and far to the side) is preferred.
 */
export function pickTarget(cur, rects, dir) {
  const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
  const horiz = dir === 'left' || dir === 'right', sign = dir === 'right' || dir === 'down' ? 1 : -1;
  let best = -1, bestScore = Infinity;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (!r || !(r.w > 0 && r.h > 0)) continue;
    const rx = r.x + r.w / 2, ry = r.y + r.h / 2;
    const along = (horiz ? rx - cx : ry - cy) * sign;
    if (along < 4) continue;                                   // not in that direction (or it is the same control)
    // distance between the two boxes along the direction of travel, and how far apart they are across it
    const gap = Math.max(0, horiz ? (sign > 0 ? r.x - (cur.x + cur.w) : cur.x - (r.x + r.w)) : (sign > 0 ? r.y - (cur.y + cur.h) : cur.y - (r.y + r.h)));
    const lo = horiz ? Math.max(cur.y, r.y) : Math.max(cur.x, r.x), hi = horiz ? Math.min(cur.y + cur.h, r.y + r.h) : Math.min(cur.x + cur.w, r.x + r.w);
    const across = hi > lo ? 0 : Math.abs(horiz ? ry - cy : rx - cx);
    const score = gap + along * 0.3 + across * 3;
    if (score < bestScore) { bestScore = score; best = i; }
  }
  return best;
}

export class FocusNav {
  /** @param root the menus' root element. onBack(): called for Escape / the pad's B. */
  constructor(root, { onBack } = {}) {
    this.root = root; this.onBack = onBack;
    root.addEventListener('keydown', (e) => {
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
      if (!dir) return;
      const a = document.activeElement;
      // a slider keeps left / right for itself; up / down leave it
      if (a && a.tagName === 'INPUT' && a.type === 'range' && (dir === 'left' || dir === 'right')) return;
      e.preventDefault(); e.stopPropagation();
      this.move(dir);
    });
    // The ring for arrow keys and a gamepad is a class of our own (`kf`) on the control that has the
    // focus: the browser's :focus-visible only knows about Tab, and :focus is not matched at all
    // while the page is not the active window. A pointer hides it again; Tab hands over to the browser.
    this.cur = null;
    root.addEventListener('pointerdown', () => { root.classList.remove('show-focus'); this._mark(null); }, true);
    root.addEventListener('focusin', (e) => { if (e.target !== this.cur) this._mark(null); });
    root.addEventListener('keydown', (e) => { if (e.key === 'Tab') this._mark(null); }, true);
  }

  list() {
    return [...this.root.querySelectorAll(FOCUSABLE)].filter((e) => e.offsetParent !== null || e.getClientRects().length);
  }

  /** Move the focus one step. Returns true when it moved. */
  move(dir) {
    const items = this.list();
    if (!items.length) return false;
    this.root.classList.add('show-focus');
    const a = document.activeElement;
    if (!a || !this.root.contains(a) || !items.includes(a)) { this._focus(this.root.querySelector('[data-autofocus]') || items[0]); return true; }
    const rect = (e) => { const b = (e.closest('.switch, .row') && e.type !== 'range' && e.tagName === 'INPUT' ? e.closest('.row') : e).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const i = pickTarget(rect(a), items.map((e) => (e === a ? null : rect(e))), dir);
    if (i < 0) return false;
    this._focus(items[i]);
    return true;
  }

  _mark(e) {
    if (this.cur && this.cur !== e) this.cur.classList.remove('kf');
    this.cur = e;
    if (e) e.classList.add('kf');
  }

  _focus(e) {
    this._mark(e);
    try { e.focus({ preventScroll: true }); e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (err) { /* ignore */ }
  }

  /** The pad's A: press what has the focus. */
  activate() {
    const a = document.activeElement;
    if (!a || !this.root.contains(a)) return this.move('down');
    this.root.classList.add('show-focus');
    a.click();
    // the screen may have been rebuilt: ring whatever holds the focus now
    const n = document.activeElement;
    if (n && this.root.contains(n)) this._mark(n);
    return true;
  }

  /** The pad's left / right on a slider: step it as the arrow keys would. Returns true when it was a slider. */
  nudge(dir) {
    const a = document.activeElement;
    if (!a || a.tagName !== 'INPUT' || a.type !== 'range' || !this.root.contains(a)) return false;
    if (dir === 'right') a.stepUp(); else a.stepDown();
    a.dispatchEvent(new Event('input', { bubbles: true })); a.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
}

/**
 * Menu input from a gamepad, polled once a frame: the d-pad or left stick moves the focus (with
 * key-repeat), A presses, B goes back. Returns nothing; calls nav.move / nav.activate / onBack.
 */
export class PadMenu {
  constructor() { this.prev = []; this.held = ''; this.t = 0; }
  poll(nav, dt, onBack) {
    let pad = null;
    try { const pads = navigator.getGamepads ? navigator.getGamepads() : []; for (const p of pads) if (p && p.connected) { pad = p; break; } } catch (e) { pad = null; }
    if (!pad) { this.held = ''; return; }
    const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed), edge = (i) => b(i) && !this.prev[i];
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const dir = b(12) || ay < -0.6 ? 'up' : b(13) || ay > 0.6 ? 'down' : b(14) || ax < -0.6 ? 'left' : b(15) || ax > 0.6 ? 'right' : '';
    if (dir !== this.held) { this.held = dir; this.t = 0.38; if (dir) this._go(nav, dir); }
    else if (dir) { this.t -= dt; if (this.t <= 0) { this.t = 0.13; this._go(nav, dir); } }
    if (edge(0)) nav.activate();
    if (edge(1) && onBack) onBack();
    this.prev = pad.buttons.map((x) => x.pressed);
  }
  _go(nav, dir) { if ((dir === 'left' || dir === 'right') && nav.nudge(dir)) return; nav.move(dir); }
}
