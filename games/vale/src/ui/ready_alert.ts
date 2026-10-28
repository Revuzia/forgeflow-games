// VALE UI — the ready check reaches a player who tabbed away (final parity AUD-2, UI half). The pop itself rides
// the audio engine's alert path (src/audio); this adds what a page in the background can still show:
//   • a system Notification while the page is hidden or unfocused. Permission is asked once per device, on the
//     first matchmade queue (Find match is a user gesture). The 4 s reminder raises it once more.
//   • a favicon badge: the VALE dial with a lit lamp dot, shown beside the title flash for as long as the check
//     waits on you, and the plain dial otherwise (the page had no icon before).
// Every channel is best-effort: no Notification API, a denied permission or no canvas simply skips that channel.

import { TOKENS } from './tokens.ts';

const TAG = 'vale-ready';
const ASKED_KEY = 'vale.ui.notifyAsked';

type NotificationCtor = typeof Notification;
type NoteOptions = NotificationOptions & { renotify?: boolean; requireInteraction?: boolean };

function notifications(): NotificationCtor | null {
  const N = (globalThis as { Notification?: NotificationCtor }).Notification;
  return typeof N === 'function' ? N : null;
}

/** the player cannot see the page: another tab, a minimised window, or another app in front */
function away(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus());
}

/** the tab icon, drawn: an ink plate, the chalk dial ring and its gnomon; `lit` adds the lamp dot */
function drawIcon(lit: boolean): string {
  if (typeof document === 'undefined') return '';
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    if (!g) return '';
    const C = TOKENS.colors;
    const disc = (x: number, y: number, r: number, fill: string): void => { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
    g.fillStyle = C['ink-1'];
    g.beginPath();
    const r = 14;
    g.moveTo(2 + r, 2); g.arcTo(62, 2, 62, 62, r); g.arcTo(62, 62, 2, 62, r); g.arcTo(2, 62, 2, 2, r); g.arcTo(2, 2, 62, 2, r);
    g.closePath(); g.fill();
    g.strokeStyle = C.chalk; g.lineWidth = 4.5;
    g.beginPath(); g.arc(32, 33, 21, 0, Math.PI * 2); g.stroke();
    // the gnomon: narrow at the hub, wide at the rim (the menu backdrop's stopped dial), leaning to the tenth hour
    g.save(); g.translate(32, 33); g.rotate(-Math.PI / 3);
    g.fillStyle = C.chalk;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(-4.2, -19); g.lineTo(4.2, -19); g.closePath(); g.fill();
    g.restore();
    disc(32, 33, 4, C.chalk);
    if (lit) {
      // an ink keyline first, so the lamp reads on a light or a dark tab strip
      disc(47, 17, 16, C['ink-0']);
      disc(47, 17, 12, C.warn);
    }
    return c.toDataURL('image/png');
  } catch { return ''; }
}

export class ReadyAlert {
  private note: Notification | null = null;
  private link: HTMLLinkElement | null = null;
  private plain = '';
  private lit = '';
  private litOn = false;

  constructor() {
    if (typeof document === 'undefined') return;
    this.plain = drawIcon(false);
    this.lit = drawIcon(true);
    if (this.plain) {
      const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ?? document.createElement('link');
      link.rel = 'icon';
      link.type = 'image/png';
      link.href = this.plain;
      if (!link.parentNode) document.head.appendChild(link);
      this.link = link;
    }
    // back on the page: the ready-check modal takes over from the system notification
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.closeNote(); });
    addEventListener('focus', () => this.closeNote());
  }

  /** the favicon currently shown (the harness reads it) */
  get icon(): 'plain' | 'lit' | 'none' { return !this.link ? 'none' : this.litOn ? 'lit' : 'plain'; }

  /** the first matchmade queue (a user gesture): ask once per device whether VALE may notify */
  prime(): void {
    const N = notifications();
    if (!N || N.permission !== 'default') return;
    try { if (localStorage.getItem(ASKED_KEY)) return; localStorage.setItem(ASKED_KEY, '1'); } catch { /* ask anyway */ }
    try {
      const p = N.requestPermission() as Promise<NotificationPermission> | undefined;
      if (p && typeof p.then === 'function') p.catch(() => { /* the player said no */ });
    } catch { /* an old API shape: no notification */ }
  }

  /** the ready check is up and waiting on you */
  found(title: string, body: string): void {
    this.badge(true);
    if (away()) this.notify(title, body, false);
  }

  /** a few seconds left and you have not answered: raise it once more */
  remind(title: string, body: string): void {
    if (away()) this.notify(title, body, true);
  }

  /** you answered, or the check ended */
  clear(): void {
    this.badge(false);
    this.closeNote();
  }

  private badge(on: boolean): void {
    if (!this.link || on === this.litOn) return;
    const href = on ? this.lit : this.plain;
    if (!href) return;
    this.litOn = on;
    this.link.href = href;
  }

  private notify(title: string, body: string, again: boolean): void {
    const N = notifications();
    if (!N || N.permission !== 'granted') return;
    try {
      // silent: the pop and the reminder are VALE's own sounds (the alert path); the system adds no second one
      const o: NoteOptions = { body, tag: TAG, renotify: again, requireInteraction: true, silent: true, ...(this.lit ? { icon: this.lit } : {}) };
      const n = new N(title, o);
      n.onclick = () => { try { window.focus(); } catch { /* the browser decides */ } n.close(); };
      this.note = n;
    } catch { /* a page notification needs a service worker on some platforms: the title and favicon remain */ }
  }

  private closeNote(): void {
    try { this.note?.close(); } catch { /* already gone */ }
    this.note = null;
  }
}
