// The meter ring (COLLECTION 9.7) and the capsule DOM twin (9.4), bottom right of the HUD.
//   * Ring: role="meter" with aria-valuenow as a percentage and a text value; it eases to a new fill over 400 ms and never jumps
//     backwards by more than a reconcile (the collection decides; the ring only shows). States as text under it: resting, done for today,
//     table full, offline.
//   * At a new capsule: ONE pulse (400 ms, ease-out, single, never repeating); none under Calm effects or reduced motion.
//   * Capsule button: "Open a capsule (3 waiting)" for assistive tech, "Open" + the count on screen; the 3D capsule is never the only way.
import { h } from './dom.ts';

export interface MeterView {
  fill: number; credits: number; resting: boolean; doneToday: boolean; tableFull: boolean; offline: boolean;
}

export interface MeterRing {
  readonly el: HTMLElement;
  readonly openButton: HTMLButtonElement;
  set(m: MeterView): void;
  pulse(calm: boolean): void;
  /** disable the button while a ceremony runs (the ring stays) */
  setBusy(busy: boolean): void;
  /** the state line ("Squishies are resting...") or '' */
  readonly stateText: string;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const R = 23, C = 2 * Math.PI * R;

export function stateLine(m: MeterView): string {
  if (m.offline) return 'Waiting for connection';
  if (m.tableFull) return 'Table full: open one to keep going.';
  if (m.doneToday) return 'They’ll be ready tomorrow';
  if (m.resting) return 'Squishies are resting, filling slowly';
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
  // a neutral capsule glyph in the middle (two halves and a seam): the capsule never shows a tier
  const glyph = document.createElementNS(SVG_NS, 'path');
  glyph.setAttribute('d', 'M28 15c7 0 10.5 6 10.5 13S35 41 28 41s-10.5-6-10.5-13S21 15 28 15z');
  glyph.setAttribute('class', 'meter-glyph');
  const seam = document.createElementNS(SVG_NS, 'path');
  seam.setAttribute('d', 'M17.6 28h20.8');
  seam.setAttribute('class', 'meter-seam');
  svg.append(track, fill, glyph, seam);

  const count = h('span', { class: 'meter-count', attrs: { 'aria-hidden': 'true' } });
  const meter = h('div', {
    class: 'meter', attrs: { role: 'meter', 'aria-label': 'Squish meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-valuetext': '0%, toward the next capsule' },
  }, svg, count);
  const btnCount = h('span', { class: 'capsule-btn-count' });
  const openButton = h('button', { class: 'capsule-btn', attrs: { type: 'button', hidden: '' }, on: { click: () => o.onOpen() } },
    h('span', { class: 'capsule-btn-label', text: 'Open' }), btnCount);
  const state = h('p', { class: 'meter-state', attrs: { 'aria-hidden': 'true' } });
  const el = h('div', { class: 'meter-cluster' }, state, openButton, meter);
  parent.append(el);

  let shown = -1;
  let busy = false;
  let credits = 0;
  let stateText = '';
  let pulseTimer = 0;

  return {
    el, openButton,
    set(m) {
      const pct = Math.round(Math.min(1, Math.max(0, m.fill)) * 100);
      if (pct !== shown) {
        shown = pct;
        fill.setAttribute('stroke-dashoffset', (C * (1 - pct / 100)).toFixed(2));
        meter.setAttribute('aria-valuenow', String(pct));
      }
      credits = m.credits;
      stateText = stateLine(m);
      meter.setAttribute('aria-valuetext', `${pct}%${credits > 0 ? `, ${credits} capsule${credits === 1 ? '' : 's'} waiting` : ', toward the next capsule'}${stateText ? `. ${stateText}` : ''}`);
      count.textContent = credits > 0 ? `x${credits}` : '';
      meter.dataset.full = String(credits > 0);
      state.textContent = stateText;
      state.hidden = !stateText;
      el.dataset.state = m.offline ? 'offline' : m.tableFull ? 'full' : m.doneToday ? 'done' : m.resting ? 'resting' : 'normal';
      btnCount.textContent = credits > 1 ? String(credits) : '';
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
    destroy() { clearTimeout(pulseTimer); el.remove(); },
  };
}
