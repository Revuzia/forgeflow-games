// HIT PARADE - boot cards (CONTRACT §3 ui/boot.ts; dyefield ui/boot.ts adapted). The loading card (wordmark HIT
// PARADE, the show strap, progress) -> the PRESS START card (deep links without autostart; the gesture that
// unlocks audio) -> hidden. The error card shows the message and never leaves a blank canvas. index.html paints
// the same loading card statically before the module graph runs; this class ADOPTS it (#hp-boot) so there is no
// flash between the two (the boot guard's handoff() puts back any loading node one of its cards had hidden).
//
// A fighter needs no pointer lock (keyboard + pad), so dyefield's CLICK TO PLAY / MOUSE CAPTURE BLOCKED cards
// become one PRESS START card: a click / tap anywhere on it, Enter / Space, or A / START on any gamepad starts.
//
// Copy: the boot cards must render BEFORE data/strings.json loads (and when it failed to load), so the English
// defaults live here; `useStrings(strings)` swaps in any `boot.*` keys from strings.json once the data is in
// (the one sanctioned exception to "no literals in UI code", CONTRACT §2 Strings).
//
// CONTRACT_MOBILE carried over from dyefield: RotateOverlay (M4: portrait on a touch device covers everything; a
// live bout pauses under it), Fullscreen (M4 toggles), homeScreenTip (M9 iPhone Add-to-Home-Screen tip, once per
// device, key hitparade.homeTip.v1), installPageHygiene (M5: iOS gesture events, touch context menu, :active),
// watchTouchMode (html.hp-touch flips). Styles live in index.html's critical <style> block (#hp-boot, .hp-*,
// #hp-rotate) so the cards never depend on the UI lane's stylesheet having loaded.

/** index.html's boot guard (the classic script) and the flag main.ts sets the moment its module body runs */
export interface BootGuard {
  handoff(): void;
  fail(title: string, detail: string): void;
  info(): Record<string, unknown>;
}
declare global {
  interface Window {
    __HP_MAIN__?: boolean;
    __HP_BOOT__?: BootGuard;
  }
}

export const DEFAULT_BOOT_STRINGS: Readonly<Record<string, string>> = {
  'boot.strap': 'LIVE ON KNOCKOUT 13',
  'boot.loading': 'Loading...',
  'boot.ready': 'Ready',
  'boot.press': 'PRESS START',
  'boot.press.kbm': 'Click, or press ENTER / pad START',
  'boot.press.touch': 'Tap to fight',
  'boot.reload': 'RELOAD',
  'boot.rotate': 'Turn your device sideways to fight',
  'boot.hometip': 'Tip: Share > Add to Home Screen plays HIT PARADE full screen.',
  'boot.mode.versus': 'VERSUS',
  'boot.mode.arcade': 'THE SEASON',
  'boot.mode.training': 'TRAINING',
  'boot.mode.online': 'ONLINE',
  'boot.mode.brawl': 'BRAWL BREAK',
  'boot.mode.heckler': 'HECKLER TOSS',
};

/**
 * After __HP_BOOT__.handoff(): true when the guard KEPT its "could not load" card because the stylesheet failed (an
 * unstyled game is not a working game; the guard's one automatic retry or its RELOAD button is the way on). The boot
 * must stop there and never hide or replace that card.
 */
export function guardKeptCard(): boolean {
  try { return window.__HP_BOOT__?.info().card === 'load'; } catch { return false; }
}

let S: Record<string, string> = { ...DEFAULT_BOOT_STRINGS };
const t = (k: string): string => S[k] ?? DEFAULT_BOOT_STRINGS[k] ?? k;

const HOME_TIP_KEY = 'hitparade.homeTip.v1';

export function touchModeOn(): boolean {
  try { return document.documentElement.classList.contains('hp-touch'); } catch { return false; }
}

/** fn(on) whenever html.hp-touch flips -> unsubscribe */
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

/** M4 fullscreen for the FULLSCREEN toggles; every call is wrapped (a refusal is silent) */
export const Fullscreen = {
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
        try { await (screen.orientation as OrientationLock).lock?.('landscape'); } catch { /* the rotate overlay covers it */ }
      }
    } catch { /* refused: silent */ }
  },
  onChange(fn: () => void): () => void {
    document.addEventListener('fullscreenchange', fn);
    return () => document.removeEventListener('fullscreenchange', fn);
  },
};

/**
 * M4: inside a touch gesture (PRESS START / START on the menus), full screen without browser UI, then a landscape
 * lock (Android Chrome only locks in full screen). Synchronous inside the gesture; every failure is silent.
 */
export function enterFullscreenLandscape(): void {
  const lock = (): void => {
    try {
      const p = (screen.orientation as OrientationLock | undefined)?.lock?.('landscape');
      if (p && typeof p.catch === 'function') p.catch(() => undefined);
    } catch { /* unsupported */ }
  };
  try {
    const de = document.documentElement;
    if (document.fullscreenEnabled && !document.fullscreenElement && typeof de.requestFullscreen === 'function') {
      const p = de.requestFullscreen({ navigationUI: 'hide' });
      if (p && typeof p.then === 'function') p.then(lock, () => undefined); else lock();
    } else lock();
  } catch { /* unsupported */ }
}

let homeTip: boolean | null = null;
/** M9: iPhone / iPod, not installed, no element fullscreen, top-level (never inside the portal's iframe) */
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
export function homeTipText(): string { return t('boot.hometip'); }
let homeTipMarked = false;
export function markHomeTipShown(): void {
  if (!homeTip || homeTipMarked) return;
  homeTipMarked = true;
  try { localStorage.setItem(HOME_TIP_KEY, '1'); } catch { /* shown again next time */ }
}

let hygiene = false;
/** M5 page hygiene (once): iOS pinch gestures prevented; no long-press menu in touch mode; :active on iOS */
export function installPageHygiene(): void {
  if (hygiene) return;
  hygiene = true;
  const stop = (e: Event): void => { e.preventDefault(); };
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
  window.addEventListener('contextmenu', (e) => {
    if (!touchModeOn()) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
    e.preventDefault();
  }, { capture: true });
  document.addEventListener('touchstart', () => undefined, { passive: true });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** M4: the portrait overlay; onChange(shown) on every change (the first a microtask after construction) */
export class RotateOverlay {
  readonly root: HTMLElement;
  private on = false;
  private readonly onChange: (shown: boolean) => void;
  private readonly offs: Array<() => void> = [];

  constructor(onChange: (shown: boolean) => void) {
    this.onChange = onChange;
    const existing = document.getElementById('hp-rotate');
    this.root = existing ?? el('div');
    this.root.id = 'hp-rotate';
    this.root.setAttribute('role', 'alert');
    this.root.hidden = true;
    if (!existing) {
      const card = el('div', 'hp-rotate-card');
      const icon = el('div', 'hp-rotate-icon');
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = ROTATE_SVG;
      card.append(icon, el('p', 'hp-rotate-text', t('boot.rotate')));
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
    try { this.onChange(on); } catch (e) { console.error('[hit-parade] rotate overlay', e); }
  }

  dispose(): void {
    for (const f of this.offs) f();
    this.offs.length = 0;
    this.root.remove();
  }
}

/** a TV turning from portrait to landscape */
const ROTATE_SVG = '<svg viewBox="0 0 120 120"><g class="ph">'
  + '<rect x="38" y="14" width="44" height="80" rx="9" fill="#fff4e0" stroke="#140d1f" stroke-width="5"/>'
  + '<rect x="45" y="24" width="30" height="56" rx="3" fill="#ff2e4d"/>'
  + '<path d="M60 38l4 9 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#ffd23a"/>'
  + '<circle cx="60" cy="87" r="3" fill="#140d1f"/></g>'
  + '<path d="M22 86a42 42 0 0 0 30 22" fill="none" stroke="#fff4e0" stroke-width="5" stroke-linecap="round"/>'
  + '<path d="M44 100l10 8-12 5" fill="none" stroke="#fff4e0" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function wordmark(): HTMLElement {
  const h = el('h1', 'hp-wordmark');
  h.setAttribute('aria-label', 'HIT PARADE');
  h.append(el('span', 'hit', 'HIT'), el('span', 'parade', 'PARADE'));
  return h;
}

let strapText = '';
function strap(): HTMLElement {
  const p = el('p', 'hp-strap');
  const dot = el('i', '', '');
  dot.setAttribute('aria-hidden', 'true');
  p.append(dot, el('span', '', strapText || t('boot.strap')));
  return p;
}

export type BootCard = 'loading' | 'play' | 'error' | 'none';

export class BootUI {
  readonly root: HTMLElement;
  card: BootCard = 'loading';
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly box: HTMLElement;
  private shown = 0;
  private touch = touchModeOn();
  private playOff: (() => void) | null = null;

  constructor() {
    installPageHygiene();
    const existing = document.getElementById('hp-boot');
    if (existing) {
      this.root = existing;
      this.box = (existing.querySelector('.hp-card') as HTMLElement | null) ?? existing;
      this.bar = (existing.querySelector('.hp-progress b') as HTMLElement | null) ?? el('b');
      this.status = (existing.querySelector('.hp-status') as HTMLElement | null) ?? el('div', 'hp-status');
      // (a boot-guard card over the loading nodes is undone by __HP_BOOT__.handoff(), which main.ts calls next)
    } else {
      this.root = el('div', 'hp-boot');
      this.root.id = 'hp-boot';
      this.box = el('div', 'hp-card');
      const prog = el('div', 'hp-progress');
      this.bar = el('b');
      prog.append(this.bar);
      this.status = el('div', 'hp-status', t('boot.loading'));
      this.box.append(wordmark(), strap(), prog, this.status);
      this.root.append(this.box);
      document.body.append(this.root);
    }
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.classList.toggle('touch', this.touch);
    watchTouchMode((on) => this.setTouch(on));
  }

  /** swap in strings.json `boot.*` copy (after the data loaded) */
  useStrings(strings: Record<string, string> | null | undefined): void {
    if (!strings) return;
    const next: Record<string, string> = { ...DEFAULT_BOOT_STRINGS };
    for (const k of Object.keys(DEFAULT_BOOT_STRINGS)) if (typeof strings[k] === 'string' && strings[k]) next[k] = strings[k];
    S = next;
  }

  /** the strap line under the wordmark: a mode ('versus' ...) names it, null = the show strap */
  setMode(mode: string | null): void {
    strapText = mode ? `${t('boot.mode.' + mode) || mode.toUpperCase()} · ${t('boot.strap')}` : '';
    const span = this.root.querySelector<HTMLElement>('.hp-strap > span');
    if (span) span.textContent = strapText || t('boot.strap');
  }

  setTouch(on: boolean): void {
    this.touch = on;
    this.root.classList.toggle('touch', on);
    const sub = this.box.querySelector<HTMLElement>('.hp-press-sub');
    if (sub) sub.textContent = on ? t('boot.press.touch') : t('boot.press.kbm');
  }

  /** f in 0..1 (monotonic: never moves backwards) */
  progress(f: number, status?: string): void {
    if (this.card !== 'loading') return;
    const v = Math.max(this.shown, Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0)));
    this.shown = v;
    this.bar.style.width = `${Math.max(4, v * 100).toFixed(1)}%`;
    if (status !== undefined) this.status.textContent = status;
  }

  /** the loading card again (menus -> a bout): wordmark, strap, a fresh bar */
  showLoading(status: string): void {
    this.stopPlay();
    this.card = 'loading';
    this.shown = 0;
    this.root.classList.remove('gone');
    this.root.setAttribute('role', 'status');
    this.box.className = 'hp-card';
    const prog = el('div', 'hp-progress');
    prog.append(this.bar);
    this.bar.style.width = '4%';
    this.status.textContent = status;
    this.box.replaceChildren(wordmark(), strap(), prog, this.status);
    this.root.onclick = null;
  }

  /**
   * PRESS START: resolves `go` ONCE on a click / tap anywhere on the card, Enter / Space / NumpadEnter, or a new
   * A / START press on any gamepad. The press is a user gesture (audio unlock, fullscreen on touch).
   */
  showPlay(go: (via: 'click' | 'key' | 'pad') => void): void {
    this.stopPlay();
    this.card = 'play';
    this.root.classList.remove('gone');
    this.box.className = 'hp-card';
    const btn = el('button', 'hp-btn hp-play', t('boot.press'));
    btn.type = 'button';
    btn.id = 'hp-play';
    const sub = el('p', 'hp-press-sub', this.touch ? t('boot.press.touch') : t('boot.press.kbm'));
    this.box.replaceChildren(wordmark(), strap(), btn, sub);
    let done = false;
    const fire = (via: 'click' | 'key' | 'pad'): void => {
      if (done || this.card !== 'play') return;
      done = true;
      this.stopPlay();
      go(via);
    };
    this.root.onclick = (e) => { e.preventDefault(); fire('click'); };
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') { e.preventDefault(); fire('key'); }
    };
    window.addEventListener('keydown', onKey, true);
    // pad A (0) / START (9): new presses only (a button already down when the card appeared must be released first)
    const armed = new Set<string>();
    const primed = new Set<string>();
    let raf = 0;
    const pollPad = (): void => {
      raf = requestAnimationFrame(pollPad);
      let pads: ReadonlyArray<Gamepad | null> = [];
      try { pads = navigator.getGamepads ? navigator.getGamepads() || [] : []; } catch { pads = []; }
      for (const g of pads) {
        if (!g || !g.connected) continue;
        for (const i of [0, 9]) {
          const b = g.buttons[i];
          const key = g.index + ':' + i;
          const down = !!b && (b.pressed || b.value > 0.5);
          if (!primed.has(key)) { primed.add(key); if (!down) armed.add(key); continue; }
          if (!down) armed.add(key);
          else if (armed.has(key)) { fire('pad'); return; }
        }
      }
    };
    raf = requestAnimationFrame(pollPad);
    this.playOff = () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
    };
    try { btn.focus({ preventScroll: true }); } catch { /* focus is best effort */ }
  }

  private stopPlay(): void {
    if (this.playOff) { const f = this.playOff; this.playOff = null; f(); }
  }

  hide(): void {
    this.stopPlay();
    this.card = 'none';
    this.root.onclick = null;
    this.root.classList.add('gone');
  }

  error(title: string, message: string): void {
    this.stopPlay();
    this.card = 'error';
    this.root.classList.remove('gone');
    this.root.setAttribute('role', 'alertdialog');
    this.box.className = 'hp-card hp-err';
    const h = el('h2', '', title);
    const pre = el('pre', '', message);
    const b = el('button', 'hp-btn', t('boot.reload'));
    b.type = 'button';
    b.onclick = () => location.reload();
    this.box.replaceChildren(wordmark(), h, pre, b);
    this.root.onclick = null;
  }
}
