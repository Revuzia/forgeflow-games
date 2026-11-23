// ROUND 14 (R14_ROOMS, D-104; the owner 2026-11-23: bigger rooms): THE EDGE CHIPS. The room camera frames where the party is (render/roomcam.ts), so a squishy can
// be outside the picture (the party spread across the room, the player zoomed in or panned away). Each squishy out of view gets a small round chip at the frame's
// edge on its side, its own face in it and a pointer toward it; a tap (or Enter) brings the camera to it (StageLike.focusBody). Part of the later-play chunk
// (ui/later-play.ts attaches it), so the first-play download does not grow.
//   shown    only while the room camera drives (a place; Home with two or more out), with the Hand in hand and nothing covering the play view
//   where    on the line from the frame's middle to the squishy, clamped inside the frame between the HUD's top row and its bottom rows (measured from the DOM)
//   reads    the stage's camera and the shell's bodies about 15 times a second; a chip's DOM is only written when it moves, appears or leaves
import type { Game } from '../shell/game.ts';
import { projectToNdc } from '../input/camera.ts';
import { getSpecies } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import { h } from './dom.ts';
import { speciesIcon } from './speciesIcon.ts';
import './room.css';

export interface RoomHints { readonly shown: number; destroy(): void }
export interface RoomHintOpts {
  game: Game;
  root: HTMLElement;
  say(text: string): void;
  /** something covers the play view (later-play's own rule) */
  covered(): boolean;
}
const MAX = 5, EDGE = 30, HALF = 22;

export function attachRoomHints(o: RoomHintOpts): RoomHints {
  const g = o.game;
  const layer = h('div', { class: 'rm-hints', attrs: { role: 'group', 'aria-label': 'Squishies out of view' } });
  o.root.append(layer);
  interface Chip { el: HTMLButtonElement; face: HTMLElement; arrow: HTMLElement; species: string; view: number; name: string; x: number; y: number; a: number; on: boolean }
  const chips: Chip[] = [];
  for (let k = 0; k < MAX; k++) {
    const face = h('span', { class: 'rm-face', attrs: { 'aria-hidden': 'true' } }), arrow = h('span', { class: 'rm-arrow', attrs: { 'aria-hidden': 'true' } });
    const el = h('button', { class: 'rm-chip', attrs: { type: 'button', hidden: '', 'data-sound': 'tap' } }, arrow, face);
    const c: Chip = { el, face, arrow, species: '', view: -1, name: '', x: -1, y: -1, a: 0, on: false };
    el.addEventListener('click', () => {
      if (c.view < 0) return;
      try { g.stage.focusBody?.(c.view); } catch { /* an old stage */ }
      o.say(`Looking at ${c.name}.`);
    });
    layer.append(el);
    chips.push(c);
  }
  const rv = new Float32Array(6), pt = { x: 0, y: 0, z: 0 };
  let band = { top: 64, bottom: 0, at: -1e9 }, shown = 0, raf = 0, skip = 0, dead = false;
  // the HUD's pieces that stand INSIDE the play band at the frame's edges (the Journal / Places column, the tracker pill and stamp moments, the quick switch, the
  // party strip, "Put back"): a chip never sits on one (x0, y0, x1, y1 each, grown by the chip's half size)
  const AVOID = '.hud-life, .pl-slot > *, .qs-row, .pt-strip, .mat-chip';
  let keep: number[] = [];
  const measure = (now: number): void => {
    if (now - band.at < 800) return;
    const H = window.innerHeight;
    const rect = (q: string): DOMRect | null => { const e = document.querySelector<HTMLElement>(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; };
    const tb = rect('.hud-top');
    // the bottom rows, as the shell reports them to the camera (hudBinding.ts reportInsets): the info row, the toolbar, and the hint pill where it hangs low
    let bt = H;
    for (const q of ['.hud-bottom', '.dock', '.hud .hint']) { const r = rect(q); if (r && r.top > H * 0.5) bt = Math.min(bt, r.top); }
    band = { top: tb ? tb.bottom : 64, bottom: Math.max(0, H - bt), at: now };
    keep = [];
    for (const e of document.querySelectorAll<HTMLElement>(AVOID)) {
      if (e.hidden || e.closest('[hidden]')) continue;
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) keep.push(r.left - HALF - 4, r.top - HALF - 4, r.right + HALF + 4, r.bottom + HALF + 4);
    }
  };
  const hideAll = (): void => { for (const c of chips) if (c.on) { c.on = false; c.el.hidden = true; } shown = 0; };
  const tick = (now: number): void => {
    if (dead) return;
    raf = requestAnimationFrame(tick);
    if (++skip < 4) return;
    skip = 0;
    const st = g.stage;
    let on = false;
    try { on = !!st.roomView?.(rv); } catch { on = false; }
    if (!on || g.phase !== 'play' || (document.body.dataset.tool ?? 'hand') === 'snap' || o.covered()) { if (shown) hideAll(); return; }
    measure(now);
    const W = window.innerWidth, H = window.innerHeight, cam = st.camera;
    const x0 = EDGE, x1 = W - EDGE, y0 = band.top + EDGE, y1 = H - band.bottom - EDGE, mx = W / 2, my = (y0 + y1) / 2;
    let k = 0;
    const one = (body: Game['body'], off: { x: number; y: number; z: number }, species: string, name: string): void => {
      if (k >= MAX) return;
      const c0 = body.center;
      pt.x = c0.x + off.x; pt.y = c0.y + off.y; pt.z = c0.z + off.z;
      const n = projectToNdc(cam, pt);
      // (behind the camera: its direction is the mirror of the projected one; a room camera never looks away from the floor, so this is only a guard)
      const sx = n ? (n.x * 0.5 + 0.5) * W : mx, sy = n ? (0.5 - n.y * 0.5) * H : H * 2;
      const r = 18;   // (a body counts as out of view when its middle is this far past the band: half hidden or more)
      if (n && sx > -r + 8 && sx < W + r - 8 && sy > band.top - r && sy < H - band.bottom + r) return;
      const view = g.bodies.viewIdOf(body);
      if (view === null) return;
      // the chip: where the line from the band's middle to the squishy leaves the band's inner box
      const dx = sx - mx, dy = sy - my, tx = dx > 0 ? (x1 - mx) / dx : dx < 0 ? (x0 - mx) / dx : Infinity, ty = dy > 0 ? (y1 - my) / dy : dy < 0 ? (y0 - my) / dy : Infinity;
      const t = Math.min(tx, ty, 1), a = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      let px = Math.round(mx + dx * t), py = Math.round(my + dy * t);
      // off a piece of the HUD: along the side the chip sits on (a side edge: up or down; the top or bottom edge: left or right), to the nearer free end
      for (let pass = 0; pass < 2; pass++) for (let q = 0; q < keep.length; q += 4) {
        const rx0 = keep[q], ry0 = keep[q + 1], rx1 = keep[q + 2], ry1 = keep[q + 3];
        if (px <= rx0 || px >= rx1 || py <= ry0 || py >= ry1) continue;
        const side = tx <= ty;   // on the left or right edge
        if (side) { const up = ry0 >= y0 && (py - ry0 <= ry1 - py || ry1 > y1); py = Math.round(up ? ry0 : Math.min(y1, ry1)); }
        else { const lf = rx0 >= x0 && (px - rx0 <= rx1 - px || rx1 > x1); px = Math.round(lf ? rx0 : Math.min(x1, rx1)); }
      }
      const c = chips[k++];
      if (c.species !== species) { c.species = species; c.face.replaceChildren(speciesIcon(species, { cls: 'rm-icon' })); }
      if (c.name !== name) { c.name = name; c.el.setAttribute('aria-label', `Go to ${name}`); c.el.title = `Go to ${name}`; }
      c.view = view;
      if (c.x !== px || c.y !== py) { c.x = px; c.y = py; c.el.style.transform = `translate(${px - HALF}px, ${py - HALF}px)`; }
      if (c.a !== a) { c.a = a; c.arrow.style.transform = `rotate(${a}deg)`; }
      if (!c.on) { c.on = true; c.el.hidden = false; }
    };
    const nameOf = (species: string, nick?: string | null): string => { if (nick) return nick; try { return getSpecies(species as SpeciesId)?.name ?? 'your squishy'; } catch { return 'your squishy'; } };
    try {
      one(g.body, ORIGIN, g.genome.species, nameOf(g.genome.species, g.identity.nickname));
      for (const x of g.bodies.extras) { if (x.piece || !x.genome) continue; one(x.body, x.position, x.genome.species, nameOf(x.genome.species)); }
    } catch { /* a body mid-swap: next tick */ }
    for (let i = k; i < MAX; i++) { const c = chips[i]; if (c.on) { c.on = false; c.el.hidden = true; c.view = -1; } }
    shown = k;
  };
  raf = requestAnimationFrame(tick);
  return {
    get shown() { return shown; },
    destroy() { dead = true; cancelAnimationFrame(raf); layer.remove(); },
  };
}
const ORIGIN = { x: 0, y: 0, z: 0 };
