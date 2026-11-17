// PLAYGROUND: the bubbles' DOM hit areas (PLAYGROUND_BUILD.md 11.10, LIFE.md 7.2, QUESTS 15; D-25). In the LIFE CHUNK: shell/later-life.ts imports it, so it is never
// in the first-play download (D-92). One 44 x 44 button per stage bubble slot, placed from the stage's emoteScreen every 250 ms (never per frame), `tabindex="-1"`
// (they move and must never hold the keyboard focus: Enter on the focused squishy is the keyboard route, D-77). A tap reads the bubble into the polite live region
// ("Hello!"), counts as the Journal's EMOTE_TAP (H6) and, on a wish's thought bubble, as the wish card read (H7). Pointer events pass through everywhere else.
import { h } from './dom.ts';
import { BUBBLE_MEANINGS } from '../data/life.ts';
import type { LifeHostApi } from '../shell/lifeLink.ts';

export interface BubbleTaps { readonly el: HTMLElement; destroy(): void }

const HIT = 44;

/** `wishLine(species, kind, target)`: the wish card's words for a tapped wish (the screens chunk owns the card and its words: boot.ts passes a lazy import of
 *  ui/later-journal.ts wishLine, so the words never ship in the life chunk; until it answers the bubble's meaning is said). */
export function attachBubbleTaps(root: HTMLElement, canvas: HTMLCanvasElement, host: LifeHostApi, say: (t: string) => void, wishLine?: (species: number, kind: number, target: number) => string | Promise<string>): BubbleTaps {
  const layer = h('div', { class: 'bubble-taps', attrs: { 'aria-hidden': 'false' } });
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2;';
  const xyr = new Float32Array(4);
  const btns: HTMLButtonElement[] = [];
  for (let k = 0; k < 8; k++) {
    const b = h('button', { class: 'bubble-tap', attrs: { type: 'button', tabindex: '-1', 'data-slot': String(k), 'data-sound': 'none', hidden: '' } });
    b.style.cssText = `position:absolute;width:${HIT}px;height:${HIT}px;margin:${-HIT / 2}px 0 0 ${-HIT / 2}px;border:0;padding:0;background:transparent;pointer-events:auto;cursor:pointer;touch-action:manipulation;`;
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = host.tapBubble(k);
      if (!r) return;
      const meaning = BUBBLE_MEANINGS[r.icon] ?? '';
      if (!r.wish || !wishLine) { say(meaning); return; }
      // the wish's own line ("Dollop wishes for a warm place: Hearthlog Cabin."), else its meaning
      Promise.resolve().then(() => wishLine(r.species, r.kind, r.target)).then((t) => say(t || meaning), () => say(meaning));
    });
    btns.push(b);
    layer.append(b);
  }
  root.append(layer);
  /** (R4) the HUD's boxes: a bubble under the top buttons, the hint, the info row, the dock or a toast keeps no hit area there (it could not keep its 44 x 44
   *  px: the K02 rows found a 45 x 42 and a covered one at 358 x 201 and 632 x 355); the bubble itself still shows, and Enter on the squishy reads it */
  const CHROME = '.hud-actions, .hud-life, .hint[data-show="true"], .hud-bottom > *, #wh-dock, .meter-cluster, .qswitch:not([hidden]), .mat-chip:not([hidden]), .toast, .opts:not([hidden])';
  const place = (): void => {
    const c = canvas.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth, vh = window.innerHeight;
    let boxes: DOMRect[] | null = null;
    const handTool = (document.body.dataset.tool ?? 'hand') === 'hand';   // (a bubble is tapped with the Hand only: a Cut swipe or a Snap drag over it is theirs)
    for (let k = 0; k < 8; k++) {
      const b = btns[k];
      const info = handTool ? host.bubble(k, xyr) : null;
      if (!info) { if (!b.hidden) b.hidden = true; continue; }
      const x = c.left + xyr[0], y = c.top + xyr[1], x0 = x - HIT / 2, y0 = y - HIT / 2;
      boxes ??= [...document.querySelectorAll(CHROME)].map((e) => e.getBoundingClientRect()).filter((q) => q.width > 0 && q.height > 0);
      const clear = x0 >= 0 && y0 >= 0 && x0 + HIT <= vw && y0 + HIT <= vh && !boxes.some((q) => !(x0 + HIT <= q.left || q.right <= x0 || y0 + HIT <= q.top || q.bottom <= y0));
      if (!clear) { if (!b.hidden) b.hidden = true; continue; }
      const meaning = BUBBLE_MEANINGS[info.icon] ?? 'A bubble';
      if (b.getAttribute('aria-label') !== meaning) b.setAttribute('aria-label', info.wish ? `A wish: ${meaning}` : meaning);
      b.style.left = `${x.toFixed(1)}px`; b.style.top = `${y.toFixed(1)}px`;
      if (b.hidden) b.hidden = false;
    }
  };
  const timer = window.setInterval(place, 250);
  return { el: layer, destroy() { window.clearInterval(timer); layer.remove(); } };
}
