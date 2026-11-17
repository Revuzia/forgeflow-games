// PLAYGROUND D-95 (revised, the owner 2026-11-17): the AUTO control of a hinge ride (the Pillow Swing, the Rocker Board). In the LIFE CHUNK (shell/later-life.ts
// re-exports it; boot.ts attaches it with the bubble taps), never in the first-play download.
//   * By default a pushed swing or rocker dies down by itself after 2 or 3 swings (physics, unchanged). AUTO is the player's choice: a small kit toggle chip
//     ("Auto", 32 px to see, 44 px to hit: `.k-chip` with aria-pressed) at the foot of each ride in the place shown. On: the ride keeps a gentle steady arc by
//     itself, with or without a rider; off: it dies down. Off by default; LIFE and autonomy never touch it. A hand on the seat or the rider always wins (physics).
//   * Keyboard: each chip is a real button in the page's Tab order (Tab stays the browser's, D-77); Space or Enter toggles it; its name says which ride it
//     moves, and the polite live region says what changed. The chips stand still (anchored to the ride's foot on the floor, not to the moving seat), placed every
//     250 ms (never per frame), and hidden whenever LIFE is quiet (a sheet, a ceremony, travel, a tool other than the Hand) or the place has no hinge ride.
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { LifeHostApi } from '../shell/lifeLink.ts';

export interface ThingAutoUi { readonly el: HTMLElement; destroy(): void }

const MAX = 4;
const EDGE = 8;

/** the rides' names (the screens' words: journal_text's THING_TEXT, a lazy chunk of its own); the id until it answers */
let names: Readonly<Record<string, readonly [string, string]>> | null = null;
const nameOf = (id: string): string => names?.[id]?.[0] ?? id;

export function attachThingAuto(root: HTMLElement, canvas: HTMLCanvasElement, host: LifeHostApi, say: (t: string) => void): ThingAutoUi {
  if (!names) void import('../data/journal_text.ts').then((m) => { names = m.THING_TEXT as Readonly<Record<string, readonly [string, string]>>; }, () => { /* the ids stay */ });
  const layer = h('div', { class: 'thing-auto-layer' });
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';
  const btns: HTMLButtonElement[] = [];
  for (let i = 0; i < MAX; i++) {
    const b = h('button', { class: 'k-chip thing-auto', attrs: { type: 'button', 'aria-pressed': 'false', hidden: '' } }, icon('reset'), h('span', { class: 'thing-auto-label', text: 'Auto' }));
    b.style.cssText = 'position:absolute;left:0;top:0;pointer-events:auto;white-space:nowrap;';
    // (the press never reaches the canvas: the toy under the chip is not poked)
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = Number(b.dataset.k), id = b.dataset.thing ?? '';
      if (!Number.isFinite(k)) return;
      const on = b.getAttribute('aria-pressed') !== 'true';
      if (!host.setThingAuto(k, on)) return;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const n = nameOf(id);
      say(on ? `The ${n} moves by itself.` : `The ${n} slows down by itself.`);
    });
    btns.push(b);
    layer.append(b);
  }
  root.append(layer);
  /** the HUD's boxes a chip must not cover (measured each placement: 4 Hz) */
  const CHROME = '.hud-actions, .hud-life, .hint[data-show="true"], .hud-bottom > *, #wh-dock, .meter-cluster, .qswitch:not([hidden]), .mat-chip:not([hidden]), .toast, .opts:not([hidden])';
  const chrome = (): DOMRect[] => [...document.querySelectorAll(CHROME)].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0);
  const place = (): void => {
    const rows = host.autoThings();
    const c = canvas.getBoundingClientRect();
    const boxes = rows.length ? chrome() : [];
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    for (let i = 0; i < MAX; i++) {
      const b = btns[i], r = rows[i];
      if (!r) { if (!b.hidden) { if (document.activeElement === b) b.blur(); b.hidden = true; } continue; }
      b.dataset.k = String(r.k); b.dataset.thing = r.id;
      const label = `Auto: the ${nameOf(r.id)} moves by itself`;
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      const pressed = r.on ? 'true' : 'false';
      if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
      if (b.hidden) b.hidden = false;
      // centred just under its anchor, inside the window, and never over the HUD (the top buttons, the hint, the dock, the bottom row): moved up past
      // whatever it would cover, else hidden this round
      const w = b.offsetWidth || 72, hgt = b.offsetHeight || 32;
      const x = Math.max(EDGE, Math.min(vw - w - EDGE, c.left + r.x - w / 2));
      let y = Math.max(EDGE, Math.min(vh - hgt - EDGE, c.top + r.y + 6));
      for (let t = 0; t < 6; t++) {
        let hit: DOMRect | null = null;
        for (const q of boxes) if (!(x + w <= q.left || q.right <= x || y + hgt <= q.top || q.bottom <= y)) { hit = q; break; }
        if (!hit) break;
        y = hit.top - hgt - EDGE;
        if (y < EDGE) { y = -1; break; }
      }
      if (y < 0) { if (document.activeElement !== b) b.style.visibility = 'hidden'; continue; }
      b.style.visibility = '';
      b.style.left = `${x.toFixed(1)}px`; b.style.top = `${y.toFixed(1)}px`;
    }
  };
  const timer = window.setInterval(place, 250);
  return { el: layer, destroy() { window.clearInterval(timer); layer.remove(); } };
}
