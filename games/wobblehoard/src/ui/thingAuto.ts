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
/** round 5 (B8): the spots a chip tries around its anchor, in chip widths (x) and chip heights (y): the anchor, then down toward the ride, up, the sides */
const NEAR: ReadonlyArray<readonly [number, number]> = [[0, 0], [0, 1], [0, -1], [0, 2], [-1, 0], [1, 0], [-1, 1], [1, 1], [0, -2]];

/** the rides' names (the screens' words: journal_text's THING_TEXT, a lazy chunk of its own); the id until it answers */
let names: Readonly<Record<string, readonly [string, string]>> | null = null;
const nameOf = (id: string): string => names?.[id]?.[0] ?? id;

export function attachThingAuto(root: HTMLElement, canvas: HTMLCanvasElement, host: LifeHostApi, say: (t: string) => void): ThingAutoUi {
  if (!names) void import('../data/journal_text.ts').then((m) => { names = m.THING_TEXT as Readonly<Record<string, readonly [string, string]>>; }, () => { /* the ids stay */ });
  const layer = h('div', { class: 'thing-auto-layer' });
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';
  const btns: HTMLButtonElement[] = [];
  /** (round 7) each chip's spot last placement (its NEAR index, -1 none): kept while it stays free, so a squishy walking by moves a chip once, not to and fro */
  const spotOf = new Int8Array(MAX).fill(-1);
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
  /** the HUD's boxes a chip must not cover (measured each placement: 4 Hz). Round 5 (VERDICT_PG B8): a toast is NOT one of them any more (a passing toast made
   *  every chip jump to the top edge, y 90 -> 15, a moving target; the stamp moments no longer use the toast stack either); the play UI's slot (the tracker
   *  pill, a moment, a wish card) is */
  const CHROME = '.hud-actions, .hud-life, .hint[data-show="true"], .hud-bottom > *, #wh-dock, .meter-cluster, .qswitch:not([hidden]), .mat-chip:not([hidden]), .pl-slot > :not([hidden]), .opts:not([hidden])';
  const chrome = (): DOMRect[] => [...document.querySelectorAll(CHROME)].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0);
  const place = (): void => {
    const rows = host.autoThings();
    const c = canvas.getBoundingClientRect();
    const boxes: Array<{ left: number; right: number; top: number; bottom: number }> = rows.length ? chrome() : [];
    // (round 7) nor the place's other things: a chip over a lantern or the Vane Disc took the tap meant for it (the Lanternroof shots); and, softly, the squishies'
    // faces (after the hard boxes: given up when no spot is free of them, so a chip is never hidden for a squishy standing by)
    const av = rows.length ? host.autoAvoid?.() ?? [] : [];
    for (let j = 0; j + 4 < av.length; j += 5) if (av[j + 4] === 0) boxes.push({ left: c.left + av[j] - av[j + 2], right: c.left + av[j] + av[j + 2], top: c.top + av[j + 1] - av[j + 3], bottom: c.top + av[j + 1] + av[j + 3] });
    const hard = boxes.length;
    for (let j = 0; j + 4 < av.length; j += 5) if (av[j + 4] !== 0) boxes.push({ left: c.left + av[j] - av[j + 2], right: c.left + av[j] + av[j + 2], top: c.top + av[j + 1] - av[j + 3], bottom: c.top + av[j + 1] + av[j + 3] });
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    for (let i = 0; i < MAX; i++) {
      const b = btns[i], r = rows[i];
      if (!r) { spotOf[i] = -1; if (!b.hidden) { if (document.activeElement === b) b.blur(); b.hidden = true; } continue; }
      if (b.dataset.thing !== r.id) spotOf[i] = -1;
      b.dataset.k = String(r.k); b.dataset.thing = r.id;
      const label = `Auto: the ${nameOf(r.id)} moves by itself`;
      if (b.getAttribute('aria-label') !== label) b.setAttribute('aria-label', label);
      const pressed = r.on ? 'true' : 'false';
      if (b.getAttribute('aria-pressed') !== pressed) b.setAttribute('aria-pressed', pressed);
      if (b.hidden) b.hidden = false;
      // centred just under its anchor, inside the window, and never over the HUD (the top buttons, the hint, the dock, the bottom row). Round 5 (B8): when the
      // anchor's spot is covered the chip tries the nearest free spots AROUND its anchor (down toward the ride first, then up, then to either side, at most two
      // chip heights away), so it stays by its thing instead of climbing to the top edge; none free: hidden this round
      const w = b.offsetWidth || 72, hgt = b.offsetHeight || 32;
      const x0 = c.left + r.x - w / 2, y0 = c.top + r.y + 6, step = hgt + EDGE;
      let x = -1, y = -1;
      // (round 7: the spot it had, while it stays free; else the nearest free one from the anchor out; the squishies' faces given up last)
      for (let pass = 0; pass < 2 && y < 0; pass++) {
        const nb = pass === 0 ? boxes.length : hard;
        for (let j = spotOf[i] >= 0 ? -1 : 0; j < NEAR.length; j++) {
          const [dx, dy] = NEAR[j < 0 ? spotOf[i] : j];
          const cx = Math.max(EDGE, Math.min(vw - w - EDGE, x0 + dx * (w + EDGE))), cy = Math.max(EDGE, Math.min(vh - hgt - EDGE, y0 + dy * step));
          let hit = false;
          for (let m = 0; m < nb; m++) { const q = boxes[m]; if (!(cx + w <= q.left || q.right <= cx || cy + hgt <= q.top || q.bottom <= cy)) { hit = true; break; } }
          if (!hit) { x = cx; y = cy; if (j >= 0) spotOf[i] = j; break; }
        }
      }
      if (y < 0) { spotOf[i] = -1; if (document.activeElement !== b) b.style.visibility = 'hidden'; continue; }
      b.style.visibility = '';
      b.style.left = `${x.toFixed(1)}px`; b.style.top = `${y.toFixed(1)}px`;
    }
  };
  const timer = window.setInterval(place, 250);
  return { el: layer, destroy() { window.clearInterval(timer); layer.remove(); } };
}
