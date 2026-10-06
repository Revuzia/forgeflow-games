// The meter ring (COLLECTION 9.7) and the capsule DOM twin (9.4), bottom right of the HUD.
//   * Ring: role="meter" with aria-valuenow as a percentage and a text value; it eases to a new fill over 400 ms and never jumps
//     backwards by more than a reconcile (the collection decides; the ring only shows). States as text under it: resting, done for today,
//     table full, offline.
//   * At a new capsule: ONE pulse (400 ms, ease-out, single, never repeating); none under Calm effects or reduced motion.
//   * Capsule button: "Open a capsule (3 waiting)" for assistive tech, "Open" + the count on screen; the 3D capsule is never the only way.
//   * Visible XP (FUN.md 2): the fill eases (0.4 s) a moment AFTER the touch, when its sparks land (hold(ms)); aria-valuenow follows at
//     once. A lighter PENDING arc continues the fill while a squeeze or a stretch is held (setPending) and banks on release
//     (bankPending(true): the fill grows over it, then it fades) or fades away if nothing was paid. glow(): the Calm-effects cue instead of
//     sparks, a soft glow on the ring (a fade, never a pulse). A fill that wraps past a capsule runs to the top first, then starts again.
import { COPY } from '../collection/copy.ts';
import { h } from './dom.ts';

export interface MeterView {
  fill: number; credits: number; resting: boolean; doneToday: boolean; tableFull: boolean; offline: boolean;
}

export interface MeterRing {
  readonly el: HTMLElement;
  readonly openButton: HTMLButtonElement;
  /** the ring itself (where the sparks fly to) */
  readonly ring: HTMLElement;
  set(m: MeterView): void;
  /** keep the visible fill where it is for `ms` (sparks in flight); a set() meanwhile lands when they do */
  hold(ms: number): void;
  /** the pending gain of the touch being held, as a fraction of the ring (0 = none) */
  setPending(frac: number): void;
  /** the held touch ended: true = it paid (the arc banks), false = it fades away */
  bankPending(paid: boolean): void;
  /** the Calm-effects gain cue: a soft glow on the ring (no sparks); also the catch when sparks land */
  glow(soft: boolean): void;
  /** the fill as drawn now, 0..1 (the harness reads it) */
  readonly shownFill: number;
  /** the pending arc as drawn now, 0..1 of the ring */
  readonly shownPending: number;
  pulse(calm: boolean): void;
  /** disable the button while a ceremony runs (the ring stays) */
  setBusy(busy: boolean): void;
  /** the state line ("Squishies are resting...") or '' */
  readonly stateText: string;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 23, C = 2 * Math.PI * R;

/** The one line under the ring (the collection's copy, COLLECTION 9.7 / 9.9). */
export function stateLine(m: MeterView): string {
  if (m.offline) return COPY.waiting;
  if (m.tableFull) return COPY.tableFull;
  if (m.doneToday) return COPY.doneToday;
  if (m.resting) return COPY.resting;
  return '';
}

export function createMeterRing(parent: HTMLElement, o: { onOpen(): void }): MeterRing {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 56 56');
  svg.setAttribute('class', 'meter-svg');
  svg.setAttribute('aria-hidden', 'true');
  const mk = (cls: string): SVGCircleElement => {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '28'); c.setAttribute('cy', '28'); c.setAttribute('r', String(R)); c.setAttribute('class', cls);
    return c;
  };
  const track = mk('meter-track');
  const fill = mk('meter-fill');
  fill.setAttribute('stroke-dasharray', `${C.toFixed(2)} ${C.toFixed(2)}`);
  fill.setAttribute('stroke-dashoffset', C.toFixed(2));
  fill.setAttribute('transform', 'rotate(-90 28 28)');
  // the pending arc (visible XP): drawn under the fill, from where the fill is drawn to fill + pending
  const pend = mk('meter-pending');
  pend.setAttribute('stroke-dasharray', `0 ${C.toFixed(2)}`);
  pend.setAttribute('transform', 'rotate(-90 28 28)');
  // a neutral capsule glyph in the middle (two halves and a seam): the capsule never shows a tier
  const glyph = document.createElementNS(SVG_NS, 'path');
  glyph.setAttribute('d', 'M28 15c7 0 10.5 6 10.5 13S35 41 28 41s-10.5-6-10.5-13S21 15 28 15z');
  glyph.setAttribute('class', 'meter-glyph');
  const seam = document.createElementNS(SVG_NS, 'path');
  seam.setAttribute('d', 'M17.6 28h20.8');
  seam.setAttribute('class', 'meter-seam');
  svg.append(track, pend, fill, glyph, seam);

  const count = h('span', { class: 'meter-count', attrs: { 'aria-hidden': 'true' } });
  const meter = h('div', {
    class: 'meter', attrs: { role: 'meter', 'aria-label': 'Squish meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-valuetext': '0%, toward the next capsule' },
  }, svg, count);
  const btnCount = h('span', { class: 'capsule-btn-count' });
  // the capsule dock (SHELL-2b): one little capsule per waiting capsule, up to WH_QUEUE_MAX shown; the first is the one on the table
  const pips = h('span', { class: 'capsule-pips', attrs: { 'aria-hidden': 'true' } });
  const openButton = h('button', { class: 'capsule-btn', attrs: { type: 'button', hidden: '' }, on: { click: () => o.onOpen() } },
    pips, h('span', { class: 'capsule-btn-label', text: 'Open' }), btnCount);
  let pipCount = -1;
  const state = h('p', { class: 'meter-state', attrs: { 'aria-hidden': 'true' } });
  const el = h('div', { class: 'meter-cluster' }, state, openButton, meter);
  parent.append(el);

  let shown = -1;
  let busy = false;
  let credits = 0;
  let stateText = '';
  let pulseTimer = 0;

  // ---- the drawn fill (visible XP): eased by CSS, landed when the sparks do ----
  let drawn = 0;            // the fill as drawn (0..1)
  let target = 0;           // the collection's fill
  let targetCredits = 0;
  let drawnCredits = -1;
  let holdUntil = 0;
  let applyTimer = 0, wrapTimer = 0, glowTimer = 0, bankTimer = 0;
  let queued = false;
  let pending = 0;          // the pending arc as drawn (fraction of the ring)
  const nowMs = (): number => performance.now();
  const drawFill = (f: number, instant = false): void => {
    if (instant) fill.dataset.instant = 'true'; else delete fill.dataset.instant;
    fill.setAttribute('stroke-dashoffset', (C * (1 - f)).toFixed(2));
    if (instant) void fill.getBoundingClientRect();   // commit the jump before the transition comes back
    drawn = f;
    if (pending > 0) drawPending(pending);
  };
  const drawPending = (p: number): void => {
    const len = Math.max(0, Math.min(p, 1 - drawn));
    pend.setAttribute('stroke-dasharray', `${(len * C).toFixed(2)} ${C.toFixed(2)}`);
    pend.setAttribute('stroke-dashoffset', (-drawn * C).toFixed(2));
  };
  const apply = (): void => {
    applyTimer = 0;
    const wait = holdUntil - nowMs();
    if (wait > 1) { applyTimer = window.setTimeout(apply, wait); return; }
    const wrapped = drawnCredits >= 0 && targetCredits > drawnCredits && target < drawn;
    drawnCredits = targetCredits;
    if (wrapped && !document.body.matches('[data-calm="true"]')) {
      // a capsule was earned on the way: run to the top, then start again from empty
      clearTimeout(wrapTimer);
      drawFill(1);
      wrapTimer = window.setTimeout(() => { drawFill(0, true); drawFill(target); }, 380);
      return;
    }
    clearTimeout(wrapTimer);
    drawFill(target, wrapped);
  };
  const schedule = (): void => {
    if (queued) return;
    queued = true;
    // a microtask: the gain cue of the same touch (emitted right after the feed that changed the meter) can still ask for a hold
    queueMicrotask(() => { queued = false; if (!applyTimer) apply(); });
  };

  return {
    el, openButton, ring: meter,
    get shownFill() { return drawn; },
    get shownPending() { return pending > 0 ? Math.max(0, Math.min(pending, 1 - drawn)) : 0; },
    hold(ms) { holdUntil = Math.max(holdUntil, nowMs() + Math.max(0, ms)); },
    setPending(p) {
      const v = Math.max(0, Math.min(1, p));
      clearTimeout(bankTimer);
      meter.dataset.pending = v > 0 ? 'true' : 'false';
      delete meter.dataset.bank;
      pending = v;
      drawPending(v);
    },
    bankPending(paid) {
      if (pending <= 0) return;
      meter.dataset.bank = paid ? 'paid' : 'none';
      clearTimeout(bankTimer);
      // paid: the fill grows over the arc (it lands with the sparks), then what is left fades; unpaid: it fades now
      bankTimer = window.setTimeout(() => { pending = 0; pend.setAttribute('stroke-dasharray', `0 ${C.toFixed(2)}`); meter.dataset.pending = 'false'; delete meter.dataset.bank; }, paid ? 900 : 320);
    },
    glow(soft) {
      meter.dataset.glow = soft ? 'soft' : 'catch';
      clearTimeout(glowTimer);
      glowTimer = window.setTimeout(() => { delete meter.dataset.glow; }, soft ? 900 : 320);
    },
    set(m) {
      const pct = Math.round(Math.min(1, Math.max(0, m.fill)) * 100);
      target = Math.min(1, Math.max(0, m.fill));
      targetCredits = m.credits;
      if (pct !== shown) {
        shown = pct;
        meter.setAttribute('aria-valuenow', String(pct));
      }
      if (Math.abs(target - drawn) > 1e-4 || drawnCredits !== targetCredits) schedule();
      credits = m.credits;
      stateText = stateLine(m);
      meter.setAttribute('aria-valuetext', `${pct}%${credits > 0 ? `, ${credits} capsule${credits === 1 ? '' : 's'} waiting` : ', toward the next capsule'}${stateText ? `. ${stateText}` : ''}`);
      count.textContent = credits > 0 ? `x${credits}` : '';
      meter.dataset.full = String(credits > 0);
      state.textContent = stateText;
      state.hidden = !stateText;
      el.dataset.state = m.offline ? 'offline' : m.tableFull ? 'full' : m.doneToday ? 'done' : m.resting ? 'resting' : 'normal';
      btnCount.textContent = credits > 5 ? `+${credits - 5}` : '';
      if (pipCount !== credits) {
        pipCount = credits;
        pips.textContent = '';
        for (let i = 0; i < Math.min(5, credits); i++) pips.append(h('span', { class: i === 0 ? 'pip first' : 'pip' }));
      }
      openButton.dataset.full = String(m.tableFull);
      openButton.setAttribute('aria-label', `Open a capsule (${credits} waiting)`);
      openButton.hidden = credits <= 0;
      openButton.disabled = busy;
    },
    pulse(calm) {
      if (calm) return;
      meter.classList.remove('pulse');
      void meter.getBoundingClientRect();   // restart the single 400 ms animation
      meter.classList.add('pulse');
      clearTimeout(pulseTimer);
      pulseTimer = window.setTimeout(() => meter.classList.remove('pulse'), 450);
    },
    setBusy(b) { busy = b; openButton.disabled = b || credits <= 0; },
    get stateText() { return stateText; },
    destroy() { clearTimeout(pulseTimer); clearTimeout(applyTimer); clearTimeout(wrapTimer); clearTimeout(glowTimer); clearTimeout(bankTimer); el.remove(); },
  };
}
