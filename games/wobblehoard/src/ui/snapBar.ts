// Snap, the photo mode (FUN.md 1): the HUD hides, drags turn the camera and the wheel or a pinch zooms (game.ts), a backdrop tint from the
// palette tokens can be laid over the scene, and Save writes one clean frame as a PNG. Nothing flashes: the shutter cue is a soft dim of
// the frame (none under Calm effects). The tint is a soft-light vignette from the edges in: the same gradient in CSS over the live canvas
// (mix-blend-mode) and painted onto the saved frame (canvas 2D, globalCompositeOperation 'soft-light'), so what you see is what you save.
// The bar is the Snap tool's options bar (UI.md 4.2, 4.3): Backdrop swatches, Save photo (the gel) and Done, on the kit (optionsBar.ts). The toolbar
// holds it above the dock (inline in strip and tiny); the label mode follows the room it gets (words > icons > a second line).
//
// DOM contract (harness and shell): .snapbar[role=group] > .snapbar-text + .opts-row > (.snapbar-row > .snap-tints[role=radiogroup] >
// button.snap-tint-btn[role=radio][data-tint][aria-checked] > .snap-swatch + .snap-tint-word) + button.snap-save[data-key=save] + button[data-key=done].
import { PALETTE } from './theme.ts';
import { h } from './dom.ts';
import { createOptionsFit, optButton, optId, watchBody } from './optionsBar.ts';
import type { OptLabel } from './optionsBar.ts';

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

export interface SnapBarLabels {
  group: string;
  text: string;
  backdrop: string;
  save: OptLabel;
  saving: string;
  done: OptLabel;
}
export const SNAP_BAR_LABELS: SnapBarLabels = {
  group: 'Photo',
  text: 'Drag to turn (right-drag with a mouse), pinch or scroll to zoom.',
  backdrop: 'Backdrop',
  save: { long: 'Save photo', short: 'Save' },
  saving: 'Saving…',
  done: { long: 'Done', short: 'Done' },
};

export interface SnapBar {
  readonly el: HTMLElement;
  readonly tint: Tint;
  /** Show or hide the bar; showing it also puts the keyboard focus on Save (so attach it FIRST: `el.hidden = false`, `toolbar.attach(bar.el, 'snap')`, then `show(true)`). */
  show(on: boolean): void;
  /** where the squishies are (CSS px over the canvas, the canvas's own top-left) for the tint's clear middle */
  place(cx: number, cy: number, w: number, hgt: number): void;
  /** the soft shutter cue (no flash) */
  shutter(calm: boolean): void;
  setSaving(on: boolean): void;
  /** measure the room again now (the toolbar moved the bar, fonts arrived) */
  fit(): void;
  /** the label mode now (long | short | icon) and whether the row wrapped: the probes read them */
  readonly mode: string;
  readonly wrapped: boolean;
  destroy(): void;
}

export function createSnapBar(root: HTMLElement, o: { onSave(): void; onDone(): void; onTint(t: Tint): void; labels?: Partial<SnapBarLabels> }): SnapBar {
  const L: SnapBarLabels = { ...SNAP_BAR_LABELS, ...(o.labels ?? {}) };
  let tint: Tint = TINTS[0];
  let cx = 0, cy = 0, w = 1, hgt = 1;
  const overlay = h('div', { class: 'snap-tint', attrs: { 'aria-hidden': 'true', hidden: '' } });
  const shade = h('div', { class: 'snap-shade', attrs: { 'aria-hidden': 'true' } });
  const tints = h('div', { class: 'snap-tints', attrs: { role: 'radiogroup', 'aria-label': L.backdrop } });
  const save = optButton({ icon: 'save', label: L.save, key: 'save', gel: true, cls: 'snap-save', dots: true });
  const done = optButton({ label: L.done, key: 'done' });
  // while saving the button is aria-disabled (not `disabled`): a disabled button drops the keyboard focus to the page, and a keyboard player would have to Tab
  // back from the top (VERIFY B-M3; cutBar.ts does the same for its buttons); a press during that moment does nothing (the shell's `saving` guard)
  save.el.addEventListener('click', () => { if (save.el.getAttribute('aria-disabled') !== 'true') o.onSave(); });
  done.el.addEventListener('click', () => o.onDone());
  const swatches = h('div', { class: 'snapbar-row' }, tints);   // (the radiogroup names itself: 'Backdrop')
  const acts = h('div', { class: 'snapbar-acts opts-row' }, swatches, save.el, done.el);
  const el = h('div', { class: 'snapbar opts opts--snap', attrs: { role: 'group', 'aria-label': L.group, hidden: '' } },
    h('div', { class: 'snapbar-status opts-status' }, h('p', { class: 'snapbar-text opts-text', text: L.text })), acts);
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
      const sw = h('span', { class: 'snap-swatch', attrs: { 'aria-hidden': 'true' } });
      sw.style.setProperty('--sw', t.color ?? PALETTE.ink);
      const b = h('button', { class: 'k-btn snap-tint-btn', attrs: { type: 'button', role: 'radio', 'aria-checked': String(on), tabindex: on ? '0' : '-1', 'data-tint': t.id } },
        sw, h('span', { class: 'snap-tint-word', text: t.label }));
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

  const fitter = createOptionsFit(el, () => [save, done], undefined, () => done.el);
  // tiny: Done comes FIRST (UI.md 4.2: the tray steps aside and Done is the way back): DOM order = Tab order = what is drawn
  const offLayout = watchBody((layout) => { if (layout === 'tiny') acts.prepend(done.el); else acts.append(done.el); });

  let shadeTimer = 0;
  return {
    el,
    get tint() { return tint; },
    get mode() { return fitter.mode; },
    get wrapped() { return fitter.wrapped; },
    fit: () => fitter.fit(),
    show(on) {
      el.hidden = !on;
      if (on) { fitter.fit(); paintOverlay(); save.el.focus(); } else { overlay.hidden = true; }
    },
    place(x, y, ww, hh) { cx = x; cy = y; w = Math.max(1, ww); hgt = Math.max(1, hh); if (!el.hidden) paintOverlay(); },
    shutter(calm) {
      if (calm) return;
      shade.dataset.on = 'true';
      clearTimeout(shadeTimer);
      shadeTimer = window.setTimeout(() => { delete shade.dataset.on; }, 160);
    },
    setSaving(on) {
      save.el.setAttribute('aria-disabled', String(on));
      if (on) save.el.setAttribute('aria-busy', 'true'); else save.el.removeAttribute('aria-busy');
      save.el.setAttribute('aria-label', on ? L.saving : (L.save.aria ?? L.save.long));   // (the visible word keeps its width; the busy dots draw over it)
    },
    destroy() { clearTimeout(shadeTimer); offLayout(); fitter.destroy(); save.destroy(); done.destroy(); el.remove(); overlay.remove(); shade.remove(); },
  };
}
