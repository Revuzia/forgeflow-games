// DYEFIELD — focus navigation for the online screens and overlays (LOBBY-UI, CONTRACT_ONLINE §O12.3 "must keep the
// menus' focus / gamepad / keyboard navigation model").
//
// The same model as ui/menus.ts, for a scope the Menus class does not own:
//   * every control carries [data-nav] (or is a .df-btn); arrow keys / d-pad / left stick move focus SPATIALLY inside
//     the active scope (the same scoring as Menus.move: distance along + across × 0.5 when the boxes overlap on the
//     cross axis, × 2.5 when not; a [data-group] column wraps up / down);
//   * Enter / Space / pad A activate; Esc / pad B go back; Tab / Shift+Tab cycle inside the scope;
//   * a MOUSE hover moves focus (CONTRACT_MOBILE M5: a tap never leaves a focus ring behind);
//   * the pad repeats a held direction after 0.38 s, then every 0.12 s (Menus.update's timings).
// Keys are taken in the window's CAPTURE phase while a scope is active and consumed (preventDefault +
// stopPropagation) only when handled, so the Menus' own bubble-phase listener never acts on the same press. (The game's
// Input listens in the window's capture phase too and was registered first: while the MATCH MENU card is up the
// integrator suspends it or feeds neutral intents, CONTRACT_ONLINE §O10.) Text fields keep their own keys: ←/→/Backspace/characters edit, Enter submits (onSubmit), Esc leaves
// the field first. The gamepad is polled by this controller's own rAF loop, only while a scope is active.

export type NavDir = 'up' | 'down' | 'left' | 'right';

export interface NavScopeOpts {
  /** Esc / pad B / BACK: return true when handled */
  back?: () => boolean;
  /** the element to focus when the scope opens (else [data-default], else the first control) */
  initial?: () => HTMLElement | null;
  /** UI sounds (hover on focus moves) */
  sound?: (s: 'hover' | 'click' | 'back') => void;
}

interface Scope { el: HTMLElement; o: NavScopeOpts; at: number }

/**
 * Bring a focused control into view inside its scroll panel (the phone layouts scroll inside a panel). Only panels
 * inside `scope` are scrolled, by hand: scrollIntoView / a default focus() may also scroll the page's own
 * overflow:hidden boxes (html / body / #ui), and the page must never scroll (CONTRACT_MOBILE M6).
 */
export function revealInPanel(e: HTMLElement, scope: HTMLElement | null): void {
  if (!scope) return;
  for (let n = e.parentElement; n && n !== scope.parentElement; n = n.parentElement) {
    const s = getComputedStyle(n);
    if (!/(auto|scroll)/.test(s.overflowY) || n.scrollHeight <= n.clientHeight + 1) continue;
    const pr = n.getBoundingClientRect(), r = e.getBoundingClientRect();
    const pad = 8;
    if (r.top < pr.top + pad) n.scrollTop -= pr.top + pad - r.top;
    else if (r.bottom > pr.bottom - pad) n.scrollTop += r.bottom - (pr.bottom - pad);
    return;
  }
}

const PAD_DELAY = 0.38, PAD_REPEAT = 0.12;

export class NavController {
  private scopes: Scope[] = [];
  private offs: Array<() => void> = [];
  private raf = 0;
  private lastT = 0;
  private pad = { buttons: [] as boolean[], dir: '', repeatT: 0 };
  /** read-back: a pad was seen this session */
  padSeen = false;
  /** read-back: presses handled (key / pad), for the harness */
  readonly counts = { keys: 0, pad: 0 };

  constructor() {
    const onKey = (e: KeyboardEvent): void => this.onKey(e);
    window.addEventListener('keydown', onKey, true);
    this.offs.push(() => window.removeEventListener('keydown', onKey, true));
    const onOver = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      const s = this.top();
      if (!s) return;
      const t = (e.target as HTMLElement | null)?.closest?.('[data-nav], .df-btn') as HTMLElement | null;
      if (!t || t === document.activeElement || !s.el.contains(t) || !this.usable(t)) return;
      if (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') return;
      this.focus(t, true);
    };
    document.addEventListener('pointerover', onOver, true);
    this.offs.push(() => document.removeEventListener('pointerover', onOver, true));
  }

  /** push a scope (an overlay or a screen); returns its pop */
  push(el: HTMLElement, o: NavScopeOpts = {}): () => void {
    const s: Scope = { el, o, at: performance.now() };
    this.scopes.push(s);
    this.startPad();
    this.home();
    return () => this.pop(s);
  }

  /** replace the top scope's element (a screen change inside the same overlay) and focus its default */
  swap(el: HTMLElement, o: NavScopeOpts = {}): void {
    const s = this.top();
    if (s) { s.el = el; s.o = o; } else this.scopes.push({ el, o, at: performance.now() });
    this.startPad();
    this.home();
  }

  private pop(s: Scope): void {
    const i = this.scopes.indexOf(s);
    if (i < 0) return;
    this.scopes.splice(i, 1);
    if (!this.scopes.length) this.stopPad();
  }

  get active(): boolean { return !!this.top(); }
  top(): Scope | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const s = this.scopes[i];
      if (s.el.isConnected && !s.el.closest('[hidden]')) return s;
    }
    return null;
  }

  /** focus the scope's default (or keep focus when it is already inside) */
  home(force = false): void {
    const s = this.top();
    if (!s) return;
    const cur = document.activeElement as HTMLElement | null;
    if (!force && cur && s.el.contains(cur) && this.usable(cur)) return;
    const t = s.o.initial?.() ?? s.el.querySelector<HTMLElement>('[data-default]:not([disabled])') ?? this.items()[0] ?? null;
    if (t && this.usable(t)) this.focus(t, false);
    else if (t) { const first = this.items()[0]; if (first) this.focus(first, false); }
  }

  private usable(e: HTMLElement): boolean {
    if ((e as HTMLButtonElement).disabled) return false;
    if (e.closest('[hidden]')) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  items(): HTMLElement[] {
    const s = this.top();
    if (!s) return [];
    return [...s.el.querySelectorAll<HTMLElement>('[data-nav], .df-btn')].filter((e) => this.usable(e));
  }

  focus(e: HTMLElement, sound: boolean): void {
    if (document.activeElement === e) return;
    e.focus({ preventScroll: true });
    revealInPanel(e, this.top()?.el ?? null);
    if (sound) this.top()?.o.sound?.('hover');
  }

  /** the Menus' spatial move, on this scope */
  move(dir: NavDir): boolean {
    const items = this.items();
    if (!items.length) return false;
    const cur = document.activeElement as HTMLElement | null;
    if (!cur || !items.includes(cur)) { this.focus(items.find((e) => e.hasAttribute('data-default')) ?? items[0], true); return true; }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    let best: HTMLElement | null = null, bestS = Infinity;
    for (const it of items) {
      if (it === cur) continue;
      const r = it.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      let along: number, across: number, overlap: boolean;
      if (dir === 'up' || dir === 'down') {
        along = dir === 'down' ? r.top - r0.top : r0.bottom - r.bottom;
        across = Math.abs(x - cx);
        overlap = r.left < r0.right && r.right > r0.left;
      } else {
        along = dir === 'right' ? r.left - r0.left : r0.right - r.right;
        across = Math.abs(y - cy);
        overlap = r.top < r0.bottom && r.bottom > r0.top;
      }
      if (along <= 2) continue;
      const sc = along + across * (overlap ? 0.5 : 2.5);
      if (sc < bestS) { bestS = sc; best = it; }
    }
    if (!best && (dir === 'up' || dir === 'down') && cur.dataset.group) {
      const g = items.filter((e) => e.dataset.group === cur.dataset.group);
      best = dir === 'down' ? g[0] : g[g.length - 1];
      if (best === cur) best = null;
    }
    if (!best) return false;
    this.focus(best, true);
    return true;
  }

  private activate(): void {
    const s = this.top();
    const cur = document.activeElement as HTMLElement | null;
    if (!s || !cur || !s.el.contains(cur)) { this.move('down'); return; }
    if (cur.tagName === 'INPUT') {
      const i = cur as HTMLInputElement;
      i.dispatchEvent(new CustomEvent('dfo-submit', { bubbles: true }));
      return;
    }
    cur.click();
  }

  back(): boolean {
    const s = this.top();
    if (!s) return false;
    return s.o.back?.() ?? false;
  }

  private onKey(e: KeyboardEvent): void {
    const s = this.top();
    // NOT gated on defaultPrevented: in a live match the game's Input (window capture, first) prevents the default of
    // every bound key (arrows, Esc, Space). The key that OPENED this scope (an Esc → the MATCH MENU card, in the same
    // dispatch) is older than the scope: skipped, as the menus skip their handledEvent.
    if (!s || e.timeStamp < s.at) return;
    const t = e.target as HTMLElement | null;
    // a text field outside this scope (another overlay's) keeps its keys
    if (t && t.closest?.('input, textarea, [contenteditable]') && !s.el.contains(t)) return;
    const typing = !!t && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text' && s.el.contains(t);
    const take = (): void => { e.preventDefault(); e.stopPropagation(); this.counts.keys++; };
    switch (e.code) {
      case 'ArrowUp': case 'ArrowDown':
        take();
        this.move(e.code === 'ArrowUp' ? 'up' : 'down');
        break;
      case 'ArrowLeft': case 'ArrowRight':
        if (typing) return;
        take();
        this.move(e.code === 'ArrowLeft' ? 'left' : 'right');
        break;
      case 'Enter': case 'NumpadEnter':
        if (typing) { take(); (t as HTMLInputElement).dispatchEvent(new CustomEvent('dfo-submit', { bubbles: true })); return; }
        // a focused button clicks natively on Enter: let it (stop the Menus / Input from seeing the key)
        if (t && t.tagName === 'BUTTON' && s.el.contains(t)) { e.stopPropagation(); this.counts.keys++; return; }
        take();
        this.activate();
        break;
      case 'Space':
        if (typing) return;
        if (t && t.tagName === 'BUTTON' && s.el.contains(t)) { e.stopPropagation(); this.counts.keys++; return; }
        take();
        this.activate();
        break;
      case 'Escape':
        take();
        // Esc in a text field leaves the field (onto the next control), like the menus' name field; a second Esc goes back
        if (typing) { (t as HTMLInputElement).blur(); const n = this.items().find((x) => x !== t); if (n) this.focus(n, false); return; }
        this.back();
        break;
      case 'Tab': {
        const items = this.items();
        if (!items.length) return;
        take();
        const i = items.indexOf(document.activeElement as HTMLElement);
        this.focus(items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length], true);
        break;
      }
      default:
        break;
    }
  }

  // ───────────────────────────── gamepad (own rAF while a scope is active) ─────────────────────────────
  private startPad(): void {
    if (this.raf) return;
    this.lastT = performance.now();
    // the first poll only records which buttons are already down (the A that opened this scope is not a press here)
    this.pad.buttons = this.readPad()?.buttons.map((b) => b.pressed || b.value > 0.5) ?? [];
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, Math.max(0, (now - this.lastT) / 1000));
      this.lastT = now;
      this.update(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopPad(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private readPad(): Gamepad | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /** one pad poll (public for a host frame loop; the controller's own rAF calls it while a scope is active) */
  update(dt: number): void {
    const s = this.top();
    const gp = this.readPad();
    if (!gp) { this.pad.buttons = []; return; }
    this.padSeen = true;
    const prev = this.pad.buttons;
    const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    const pressed = (i: number): boolean => !!now[i] && !prev[i];
    this.pad.buttons = now;
    if (!s) return;
    if (pressed(0)) { this.counts.pad++; this.activate(); }
    if (pressed(1)) { this.counts.pad++; this.back(); }
    const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
    let dir = '';
    if (now[12] || ay < -0.55) dir = 'up';
    else if (now[13] || ay > 0.55) dir = 'down';
    else if (now[14] || ax < -0.55) dir = 'left';
    else if (now[15] || ax > 0.55) dir = 'right';
    if (!dir) { this.pad.dir = ''; this.pad.repeatT = 0; return; }
    const fire = dir !== this.pad.dir || this.pad.repeatT <= 0;
    this.pad.repeatT = dir !== this.pad.dir ? PAD_DELAY : (this.pad.repeatT <= 0 ? PAD_REPEAT : this.pad.repeatT - dt);
    this.pad.dir = dir;
    if (!fire) return;
    this.counts.pad++;
    this.move(dir as NavDir);
  }

  dispose(): void {
    this.stopPad();
    for (const f of this.offs) f();
    this.offs = [];
    this.scopes = [];
  }
}
