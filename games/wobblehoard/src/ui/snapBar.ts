// Snap, the photo mode (FUN.md 1): the HUD hides, drags turn the camera and the wheel or a pinch zooms (game.ts), a backdrop tint from the
// palette tokens can be laid over the scene, and Save writes one clean frame as a PNG. Nothing flashes: the shutter cue is a soft dim of
// the frame (none under Calm effects). The tint is a soft-light vignette from the edges in: the same gradient in CSS over the live canvas
// (mix-blend-mode) and painted onto the saved frame (canvas 2D, globalCompositeOperation 'soft-light'), so what you see is what you save.
import { PALETTE } from './theme.ts';
import { h } from './dom.ts';

export interface Tint { id: string; label: string; color: string | null }
/** Night is the scene as it is; the others are the palette's lagoon, dusk violet and ember coral. */
export const TINTS: readonly Tint[] = [
  { id: 'night', label: 'Night', color: null },
  { id: 'lagoon', label: 'Lagoon', color: PALETTE.lagoon },
  { id: 'dusk', label: 'Dusk', color: PALETTE.dusk },
  { id: 'ember', label: 'Ember', color: PALETTE.coral },
];

const rgba = (hex: string, a: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
/** The vignette: clear around the squishies (cx, cy), the tint growing toward the frame's edges. Stops as fractions of the radius. */
const STOPS: ReadonlyArray<[number, number]> = [[0.2, 0], [0.48, 0.32], [1, 0.9]];
const radiusOf = (w: number, hgt: number, cx: number, cy: number): number => Math.hypot(Math.max(cx, w - cx), Math.max(cy, hgt - cy));

/** Paint the tint onto a 2D context holding the frame (device px). */
export function paintTint(ctx: CanvasRenderingContext2D, w: number, hgt: number, cx: number, cy: number, color: string): void {
  const r = radiusOf(w, hgt, cx, cy);
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [t, a] of STOPS) g.addColorStop(t, rgba(color, a));
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, hgt);
  ctx.restore();
}

export interface SnapBar {
  readonly el: HTMLElement;
  readonly tint: Tint;
  show(on: boolean): void;
  /** where the squishies are (CSS px over the canvas, the canvas's own top-left) for the tint's clear middle */
  place(cx: number, cy: number, w: number, hgt: number): void;
  /** the soft shutter cue (no flash) */
  shutter(calm: boolean): void;
  setSaving(on: boolean): void;
  destroy(): void;
}

export function createSnapBar(root: HTMLElement, o: { onSave(): void; onDone(): void; onTint(t: Tint): void }): SnapBar {
  let tint: Tint = TINTS[0];
  let cx = 0, cy = 0, w = 1, hgt = 1;
  const overlay = h('div', { class: 'snap-tint', attrs: { 'aria-hidden': 'true', hidden: '' } });
  const shade = h('div', { class: 'snap-shade', attrs: { 'aria-hidden': 'true' } });
  const tints = h('div', { class: 'snap-tints', attrs: { role: 'radiogroup', 'aria-label': 'Backdrop' } });
  const save = h('button', { class: 'cta-btn snap-save', text: 'Save photo', attrs: { type: 'button', 'data-key': 'save' } });
  const done = h('button', { class: 'act-btn', text: 'Done', attrs: { type: 'button', 'data-key': 'done' } });
  save.addEventListener('click', () => o.onSave());
  done.addEventListener('click', () => o.onDone());
  const el = h('div', { class: 'snapbar', attrs: { role: 'group', 'aria-label': 'Photo', hidden: '' } },
    h('p', { class: 'snapbar-text', text: 'Drag to turn, pinch or scroll to zoom.' }),
    h('div', { class: 'snapbar-row' }, h('span', { class: 'snapbar-label', text: 'Backdrop' }), tints),
    h('div', { class: 'snapbar-acts' }, save, done));
  // the tint must blend with the CANVAS: #ui is a fixed layer (its own stacking context), so the overlay sits beside it, just before it
  if (root.parentElement) root.parentElement.insertBefore(overlay, root); else root.append(overlay);
  root.append(shade, el);

  const paintOverlay = (): void => {
    if (!tint.color) { overlay.hidden = true; return; }
    const r = radiusOf(w, hgt, cx, cy);
    const stops = STOPS.map(([t, a]) => `${rgba(tint.color!, a)} ${(t * r).toFixed(0)}px`).join(', ');
    overlay.style.setProperty('background', `radial-gradient(circle ${r.toFixed(0)}px at ${cx.toFixed(0)}px ${cy.toFixed(0)}px, ${stops})`);
    overlay.hidden = false;
  };
  const renderTints = (): void => {
    tints.textContent = '';
    TINTS.forEach((t, i) => {
      const on = t.id === tint.id;
      const b = h('button', { class: 'snap-tint-btn', attrs: { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', 'data-tint': t.id } },
        h('span', { class: 'snap-swatch', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'snap-tint-word', text: t.label }));
      (b.firstElementChild as HTMLElement).style.setProperty('--sw', t.color ?? PALETTE.ink);
      b.addEventListener('click', () => choose(t));
      b.addEventListener('keydown', (e) => {
        const k = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!k) return;
        e.preventDefault();
        const nx = TINTS[(i + k + TINTS.length) % TINTS.length];
        choose(nx);
        tints.querySelector<HTMLElement>(`[data-tint="${nx.id}"]`)?.focus();
      });
      tints.append(b);
    });
  };
  const choose = (t: Tint): void => { tint = t; renderTints(); paintOverlay(); o.onTint(t); };
  renderTints();
  let shadeTimer = 0;
  return {
    el,
    get tint() { return tint; },
    show(on) {
      el.hidden = !on;
      if (on) { paintOverlay(); save.focus(); } else { overlay.hidden = true; }
    },
    place(x, y, ww, hh) { cx = x; cy = y; w = Math.max(1, ww); hgt = Math.max(1, hh); if (!el.hidden) paintOverlay(); },
    shutter(calm) {
      if (calm) return;
      shade.dataset.on = 'true';
      clearTimeout(shadeTimer);
      shadeTimer = window.setTimeout(() => { delete shade.dataset.on; }, 160);
    },
    setSaving(on) { save.disabled = on; save.textContent = on ? 'Saving…' : 'Save photo'; },
    destroy() { clearTimeout(shadeTimer); el.remove(); overlay.remove(); shade.remove(); },
  };
}
