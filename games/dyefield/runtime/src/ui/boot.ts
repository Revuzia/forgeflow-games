// DYEFIELD — boot cards (CONTRACT §5.1 ui/boot.ts): loading card (wordmark DYEFIELD, mode line —
// "Harbor Cup • 4 v 4 · Free-for-all" until a mode is committed, then that match's line —, progress) → CLICK TO PLAY (pointer lock) → play. The error card shows the
// message and never leaves a blank canvas. After 2+ pointerlockerrors with zero successful locks
// ever, the play card swaps to the "mouse capture blocked" message (doctrine §6).
// index.html paints the same loading card statically before the module graph runs; this class
// adopts it (#df-boot) so there is no flash between the two.
// CONTRACT_MOBILE (UI lane): the play card reads TAP TO PLAY in touch mode (setTouch; it also follows html.df-touch);
// RotateOverlay (M4) covers everything while a touch device is upright; Fullscreen / homeScreenTip back the menus'
// FULLSCREEN toggles and the iPhone Add-to-Home-Screen tip; installPageHygiene (M5: iOS gesture events, the touch
// context menu, :active on iOS) runs once from the BootUI constructor.

export const MODE_LINE = 'Harbor Cup • 4 v 4';
/** CONTRACT_FFA F3: the mode line in FREE-FOR-ALL (teams keeps MODE_LINE exactly). The loading / play cards show the
 *  line of the session being loaded: BootUI.setMode('ffa') / setMode('teams') before showLoading() of a match. */
export const MODE_LINE_FFA = 'Harbor Cup • Free-for-all';
/** Owner 2026-09-28 ("shows 4v4 but … we had an option of free for all — this is misleading"): wherever no mode is
 *  committed yet — the static card of a bare URL, the lobby's loading card, the title screen — the line names BOTH
 *  modes. index.html paints this same text statically. */
export const MODE_LINE_ALL = 'Harbor Cup • 4 v 4 · Free-for-all';

/** the card's current mode line (module state: one boot card per page) */
let modeText = MODE_LINE_ALL;

// ───────────────────────────── CONTRACT_MOBILE (UI lane) ─────────────────────────────
// M1: the input method lives on <html> as `df-touch` / `df-kbm` (input.ts sets it). The CSS keys off that class; the
// UI modules read the same class, so the boot cards, the menus, the HUD and the rotate overlay always agree with it.
// main.ts also calls BootUI.setTouch / menus.setTouchMode / hud.setTouchMode (M12); both paths land on the same state.

/** the play card's button in each input mode (M4) */
export const PLAY_CLICK = 'CLICK TO PLAY';
export const PLAY_TAP = 'TAP TO PLAY';
/** M4: the portrait overlay's line */
export const ROTATE_TEXT = 'Turn your device sideways to play';
/** M9: iPhone Safari (no element fullscreen, not installed): shown once per device */
export const HOME_TIP = 'Tip: Share → Add to Home Screen plays DYEFIELD full screen.';
const HOME_TIP_KEY = 'dyefield.homeTip.v1';

/** true while the page is in touch mode (M1: html.df-touch) */
export function touchModeOn(): boolean {
  return document.documentElement.classList.contains('df-touch');
}

/** fn(on) whenever html.df-touch flips (M1 mode switches) → unsubscribe */
export function watchTouchMode(fn: (on: boolean) => void): () => void {
  let last = touchModeOn();
  const mo = new MutationObserver(() => {
    const on = touchModeOn();
    if (on === last) return;
    last = on;
    fn(on);
  });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}

type OrientationLock = ScreenOrientation & { lock?: (o: string) => Promise<void> };

/**
 * M4 fullscreen, for the FULLSCREEN toggles (title corner, pause card). Every call is wrapped: a refusal is silent.
 * Entering it in touch mode also asks for the landscape lock (Android Chrome honours it in fullscreen only).
 */
export const Fullscreen = {
  /** false on iPhone Safari (no element fullscreen) and in an iframe without allow="fullscreen": the toggles hide */
  enabled(): boolean {
    try { return !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === 'function'; } catch { return false; }
  },
  active(): boolean {
    try { return !!document.fullscreenElement; } catch { return false; }
  },
  async toggle(): Promise<void> {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (touchModeOn()) {
        try { await (screen.orientation as OrientationLock).lock?.('landscape'); } catch { /* unsupported: the rotate overlay covers it */ }
      }
    } catch { /* refused (no gesture, permissions policy): silent */ }
  },
  /** fullscreenchange → unsubscribe */
  onChange(fn: () => void): () => void {
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  },
};

let homeTip: boolean | null = null;
const homeTipFns = new Set<(on: boolean) => void>();

/**
 * M9: the Add-to-Home-Screen tip. Eligible on an iPhone / iPod that is not running the installed web app, offers no
 * element fullscreen and runs the game top-level (review A-A13: inside a portal's iframe, Add to Home Screen would
 * install the PORTAL page — DYEFIELD's manifest and apple meta tags only apply top-level). Once per device: the
 * localStorage flag is written when a tip is actually SHOWN (markHomeTipShown, from the title screen / pause card —
 * review B-F5: writing it on the first evaluation used it up on a deep-link page that never shows either); it then
 * stays up for that page until tapped away. Side-effect free.
 */
export function homeScreenTip(): boolean {
  if (homeTip !== null) return homeTip;
  let eligible = false;
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    const installed = nav.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
    let framed = false;
    try { framed = window.top !== window.self; } catch { framed = true; }
    eligible = /iPhone|iPod/.test(nav.userAgent) && !installed && !Fullscreen.enabled() && !framed;
  } catch { eligible = false; }
  let seen = false;
  try { seen = localStorage.getItem(HOME_TIP_KEY) === '1'; } catch { seen = false; }
  homeTip = eligible && !seen;
  return homeTip;
}

let homeTipMarked = false;
/** the tip is on screen now (title / pause card): remember it for this device (once per device, M9) */
export function markHomeTipShown(): void {
  if (!homeTip || homeTipMarked) return;
  homeTipMarked = true;
  try { localStorage.setItem(HOME_TIP_KEY, '1'); } catch { /* not remembered: shown again next time */ }
}

/** the tip was tapped away: every place that shows it hides it */
export function dismissHomeTip(): void {
  if (!homeTip) return;
  homeTip = false;
  for (const fn of [...homeTipFns]) fn(false);
}

/** fn(false) when the tip is dismissed → unsubscribe */
export function onHomeTip(fn: (on: boolean) => void): () => void {
  homeTipFns.add(fn);
  return () => { homeTipFns.delete(fn); };
}

let hygiene = false;
/**
 * M5 page hygiene (once per page): iOS pinch gestures never reach the page (gesturestart / change / end prevented);
 * in touch mode a long-press opens no context menu (text inputs keep theirs); a passive touchstart listener lets
 * iOS Safari apply :active to a tapped control (the pressed feedback on touch).
 */
export function installPageHygiene(): void {
  if (hygiene) return;
  hygiene = true;
  const stop = (e: Event): void => { e.preventDefault(); };
  for (const t of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(t, stop, { passive: false });
  window.addEventListener('contextmenu', (e) => {
    if (!touchModeOn()) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
  }, { capture: true });
  document.addEventListener('touchstart', () => undefined, { passive: true });
}

/**
 * M4: the portrait overlay. Shown while the page is in touch mode and taller than wide ("Turn your device sideways to
 * play", a turning-phone icon) over everything, cards included. onChange(shown) runs on every change — the first one
 * a microtask after construction when the page starts in portrait — so main.ts can pause a live match; hiding it never
 * resumes anything.
 */
export class RotateOverlay {
  readonly root: HTMLElement;
  private on = false;
  private readonly onChange: (shown: boolean) => void;
  private readonly offs: Array<() => void> = [];

  constructor(onChange: (shown: boolean) => void) {
    this.onChange = onChange;
    const existing = document.getElementById('df-rotate');
    this.root = existing ?? el('div', 'df-rotate');
    this.root.id = 'df-rotate';
    this.root.setAttribute('role', 'alert');
    this.root.hidden = true;
    if (!existing) {
      const icon = el('div', 'df-rotate-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = ROTATE_SVG;
      const card = el('div', 'df-rotate-card');
      card.append(icon, el('p', 'df-rotate-text', ROTATE_TEXT));
      this.root.append(card);
      document.body.append(this.root);
    }
    const upd = (): void => this.update();
    window.addEventListener('resize', upd);
    window.addEventListener('orientationchange', upd);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', upd);
    this.offs.push(() => {
      window.removeEventListener('resize', upd);
      window.removeEventListener('orientationchange', upd);
      vv?.removeEventListener('resize', upd);
    });
    this.offs.push(watchTouchMode(upd));
    queueMicrotask(upd);
  }

  get shown(): boolean { return this.on; }

  private update(): void {
    const on = touchModeOn() && window.innerHeight > window.innerWidth;
    if (on === this.on) return;
    this.on = on;
    this.root.hidden = !on;
    try { this.onChange(on); } catch (e) { console.error('[dyefield] rotate overlay', e); }
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.offs.length = 0;
    this.root.remove();
  }
}

/** a phone turning from portrait to landscape (styles.css animates the .ph group; reduced motion shows it turned, static) */
const ROTATE_SVG = '<svg viewBox="0 0 120 120"><g class="ph">'
  + '<rect x="38" y="14" width="44" height="80" rx="9" fill="#fff8ec" stroke="#14203a" stroke-width="5"/>'
  + '<rect x="45" y="24" width="30" height="56" rx="3" fill="#8a7cff"/>'
  + '<path d="M45 64c6-5 12-5 17 0s12 5 13 1v15H45z" fill="#ff8a1f"/>'
  + '<circle cx="60" cy="87" r="3" fill="#14203a"/></g>'
  + '<path d="M22 86a42 42 0 0 0 30 22" fill="none" stroke="#fff8ec" stroke-width="5" stroke-linecap="round"/>'
  + '<path d="M44 100l10 8-12 5" fill="none" stroke="#fff8ec" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Fill a mode-line element with `text`, split after its ' • ' / ' · ' separators into no-wrap chunks (.df-nw), so a
 * narrow card wraps the pill BETWEEN phrases ("Harbor Cup •" / "4 v 4 ·" / "Free-for-all"), never inside "4 v 4" or
 * "Free-for-all". textContent stays exactly `text` (the chunks are joined by single spaces).
 */
export function fillModeLine(span: HTMLElement, text: string): void {
  if (span.textContent === text && span.firstElementChild) return;
  const parts = text.split(/(?<=[•·]) /);
  const nodes: Node[] = [];
  parts.forEach((p, i) => {
    if (i) nodes.push(document.createTextNode(' '));
    nodes.push(el('span', 'df-nw', p));
  });
  span.replaceChildren(...nodes);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function wordmark(): HTMLElement {
  const h = el('h1', 'df-wordmark');
  h.setAttribute('aria-label', 'DYEFIELD');
  const a = el('span', 'dye', 'DYE');
  const b = el('span', 'field', 'FIELD');
  h.append(a, b);
  return h;
}

function modeLine(): HTMLElement {
  const p = el('p', 'df-mode');
  const m1 = el('i', '', '◉'); m1.setAttribute('aria-hidden', 'true');
  const m2 = el('i', 'g', '▲'); m2.setAttribute('aria-hidden', 'true');
  const line = el('span');
  fillModeLine(line, modeText);
  p.append(m1, line, m2);
  return p;
}

export type BootCard = 'loading' | 'play' | 'blocked' | 'error' | 'none';

export class BootUI {
  readonly root: HTMLElement;
  card: BootCard = 'loading';
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly box: HTMLElement;
  private shown = 0;
  /** M4: the play card reads TAP TO PLAY in touch mode */
  private touch = touchModeOn();

  constructor() {
    installPageHygiene();
    const existing = document.getElementById('df-boot');
    if (existing) {
      this.root = existing;
      this.box = existing.querySelector('.df-card') as HTMLElement ?? existing;
      this.bar = existing.querySelector('.df-progress b') as HTMLElement ?? el('b');
      this.status = existing.querySelector('.df-status') as HTMLElement ?? el('div');
    } else {
      this.root = el('div', 'df-boot');
      this.root.id = 'df-boot';
      this.box = el('div', 'df-card');
      const prog = el('div', 'df-progress');
      this.bar = el('b');
      prog.append(this.bar);
      this.status = el('div', 'df-status', 'Loading…');
      this.box.append(wordmark(), modeLine(), prog, this.status);
      this.root.append(this.box);
      document.body.append(this.root);
    }
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.classList.toggle('touch', this.touch);
    watchTouchMode((on) => this.setTouch(on));
  }

  /** M4 / M12: touch mode → the play card reads TAP TO PLAY (a tap starts play); kbm → CLICK TO PLAY. Live on the card. */
  setTouch(on: boolean): void {
    this.touch = on;
    this.root.classList.toggle('touch', on);
    const b = this.box.querySelector<HTMLElement>('#df-play');
    if (b) b.textContent = on ? PLAY_TAP : PLAY_CLICK;
  }

  /**
   * CONTRACT_FFA F3: the mode line of the session about to load ('ffa' → 'Harbor Cup • Free-for-all', 'teams' →
   * exactly MODE_LINE, 'all' → MODE_LINE_ALL for the lobby, where no mode is picked yet). Updates the card on screen in
   * place and every card built after it.
   */
  setMode(mode: 'teams' | 'ffa' | 'all'): void {
    modeText = mode === 'ffa' ? MODE_LINE_FFA : mode === 'teams' ? MODE_LINE : MODE_LINE_ALL;
    const span = this.root.querySelector<HTMLElement>('.df-mode > span');
    if (span) fillModeLine(span, modeText);
  }

  /** f in 0..1 (monotonic: never moves backwards) */
  progress(f: number, status?: string): void {
    if (this.card !== 'loading') return;
    const v = Math.max(this.shown, Math.min(1, Math.max(0, f)));
    this.shown = v;
    this.bar.style.width = `${Math.max(4, v * 100).toFixed(1)}%`;
    if (status !== undefined) this.status.textContent = status;
  }

  /**
   * Phase 9: the loading card again (menus → a match, or back to the lobby): wordmark, mode line, the arena's
   * name + thumbnail when given, and a fresh progress bar.
   */
  showLoading(status: string, arena?: { name: string; thumb?: string | null }): void {
    this.card = 'loading';
    this.shown = 0;
    this.root.classList.remove('gone');
    this.root.setAttribute('role', 'status');
    this.box.className = 'df-card';
    const parts: HTMLElement[] = [wordmark(), modeLine()];
    if (arena) {
      const a = el('div', 'df-arena');
      if (arena.thumb) {
        const img = el('img');
        img.src = arena.thumb;
        img.alt = '';
        a.append(img);
      }
      a.append(el('b', '', arena.name));
      parts.push(a);
    }
    const prog = el('div', 'df-progress');
    prog.append(this.bar);
    this.bar.style.width = '4%';
    this.status.textContent = status;
    parts.push(prog, this.status);
    this.box.replaceChildren(...parts);
    this.root.onclick = null;
  }

  /** CLICK TO PLAY (TAP TO PLAY in touch mode): resolves the click handler on a real click / tap anywhere on the card. */
  showPlay(onClick: (e: MouseEvent) => void): void {
    this.card = 'play';
    this.root.classList.remove('gone');
    this.box.className = 'df-card';
    this.box.replaceChildren(wordmark(), modeLine());
    const btn = el('button', 'df-btn df-play', this.touch ? PLAY_TAP : PLAY_CLICK);
    btn.type = 'button';
    btn.id = 'df-play';
    this.box.append(btn);
    this.root.onclick = (e) => { e.preventDefault(); onClick(e); };
    btn.focus({ preventScroll: true });
  }

  /** doctrine §6: lock refused twice with zero successes → tell the player instead of an eternal prompt */
  showBlocked(onRetry?: (e: MouseEvent) => void): void {
    this.card = 'blocked';
    this.root.classList.remove('gone');
    this.box.className = 'df-card df-err';
    const h = el('h2', '', 'MOUSE CAPTURE BLOCKED');
    const p = el('p', 'df-note', 'This browser refused to capture the mouse. Reload the page, or click here to try again.');
    const b = el('button', 'df-btn', 'RELOAD');
    b.type = 'button';
    b.onclick = (e) => { e.stopPropagation(); location.reload(); };
    this.box.replaceChildren(wordmark(), h, p, b);
    // the refusal can be transient (an unfocused window): a click anywhere else on the card retries
    this.root.onclick = onRetry ? (e) => { e.preventDefault(); onRetry(e); } : null;
  }

  hide(): void {
    this.card = 'none';
    this.root.onclick = null;
    this.root.classList.add('gone');
  }

  error(title: string, message: string): void {
    this.card = 'error';
    this.root.classList.remove('gone');
    this.root.setAttribute('role', 'alertdialog');
    this.box.className = 'df-card df-err';
    const h = el('h2', '', title);
    const pre = el('pre', '', message);
    const b = el('button', 'df-btn', 'RELOAD');
    b.type = 'button';
    b.onclick = () => location.reload();
    this.box.replaceChildren(wordmark(), h, pre, b);
    this.root.onclick = null;
  }
}
