// B3b page: THE OPTIONS BARS, and the HUD parts that go with them (UI.md 4.2, 4.4, 6). Real components only: createCutBar / createSnapBar on a stub Cutter
// (bars.ts), each held by a real toolbar attachment (b3.ts specimen), so the caret, the glass body and the fit are the ones the game gets. Hosts have FIXED
// widths so the label mode each width earns is on one sheet whatever the viewport is (the bar measures its slot, not the viewport).
import { h } from '../../../src/ui/dom.ts';
import { realCut, realSnap } from '../bars.ts';
import type { CutState } from '../bars.ts';
import type { CutStub } from '../../../src/ui/cutContract.ts';
import { specimen } from './b3.ts';
import { createMeterRing } from '../../../src/ui/meterRing.ts';
import type { MeterRing, MeterView } from '../../../src/ui/meterRing.ts';
import { createQuickSwitch } from '../../../src/ui/quickSwitch.ts';
import { HINT_TEXT, HINT_TOOLS } from '../../../src/ui/hint.ts';
import { MOCK } from '../mock.ts';
import { cell, sub } from './types.ts';
import type { KitSection } from './types.ts';

declare global { interface Window { __kitBars?: Array<{ id: string; kind: 'cut' | 'snap'; bar: { mode: string; wrapped: boolean; el: HTMLElement; fit(): void }; stub?: CutStub }> } }

const unhide = <T extends HTMLElement>(e: T): T => { e.hidden = false; return e; };
const reg = (id: string, kind: 'cut' | 'snap', bar: { mode: string; wrapped: boolean; el: HTMLElement; fit(): void }, stub?: CutStub): void => { (window.__kitBars ??= []).push({ id, kind, bar, stub }); };

/** a real dock (full or compact form) of a fixed width holding the Cut bar */
function cutSpec(id: string, width: number, st: CutState, o: { form?: 'full' | 'compact' | 'bare'; force?: (bar: HTMLElement) => void; tool?: string } = {}): HTMLElement {
  const s = specimen(o.form ?? 'compact', { tool: o.tool ?? 'cut', width });
  const k = realCut(h('div'), { ...st, show: false });
  s.tb.attach(unhide(k.bar.el), 'cut');
  reg(id, 'cut', k.bar, k.stub);
  o.force?.(k.bar.el);
  return s.host;
}
function snapSpec(id: string, width: number, st: { saving?: boolean; tint?: string } = {}, o: { form?: 'full' | 'compact' | 'bare'; force?: (bar: HTMLElement) => void } = {}): HTMLElement {
  const s = specimen(o.form ?? 'compact', { tool: 'snap', width });
  const bar = realSnap(h('div'), { ...st, show: false });
  s.tb.attach(unhide(bar.el), 'snap');
  reg(id, 'snap', bar);
  o.force?.(bar.el);
  return s.host;
}
const force = (sel: string, f: string) => (bar: HTMLElement): void => { bar.querySelector(sel)?.setAttribute('data-force', f); };

const parts: KitSection = {
  id: 'opts-parts', title: 'Options bars: the Cut bar and the Snap bar',
  note: 'The REAL bars (cutBar.ts, snapBar.ts) on a stub Cutter, each in a real toolbar attachment. Hosts have fixed widths; the bar picks the richest label mode that fits its slot (long > short > icon, then it wraps). The instruction line is drawn only on a full desktop dock (1280x800); elsewhere it is read, not drawn.',
  build(host) {
    host.append(sub('Cut bar: label modes by room (700 / 560 / 440 / 340 / 270 px slots)'));
    host.append(
      cell('long: 700 px slot', cutSpec('cut-long', 700, {})),
      cell('short: 560 px slot (the buttons say Split, Reconnect; the style words stay)', cutSpec('cut-short', 560, {})),
      cell('icon: 440 px slot (the buttons are icons, Done keeps its word, the style words stay: their icons alone say nothing)', cutSpec('cut-icon', 440, {})),
      cell('tight: 340 px slot (the style faces are icons too: a strip or a 390 phone)', cutSpec('cut-tight', 340, {})),
      cell('wrap: 270 px slot (below any real slot; the row wraps instead of clipping)', cutSpec('cut-wrap', 270, {})));

    host.append(sub('Cut bar: states (long, 700 px)'));
    host.append(
      cell('whole: Split in two ready, Reconnect all off (dashed), style free', cutSpec('cut-whole', 700, { pieces: 1 })),
      cell('two pieces, limit reached: Split off with its reason, Reconnect ready, style LOCKED (lock mark)', cutSpec('cut-two', 700, { pieces: 2 })),
      cell('Undo cut offered and ready (the button joins between Split and Reconnect)', cutSpec('cut-undo', 700, { pieces: 2, undo: true, style: 'minis' })),
      cell('a cut plays: Split, Reconnect, Undo, style all off (aria-disabled), Done stays', cutSpec('cut-busy', 700, { pieces: 1, busy: true, undo: false })),
      cell('Minis selected, whole', cutSpec('cut-minis', 700, { pieces: 1, style: 'minis' })),
      cell('the Cutter offers no style seam: no control (the flag, or an older Cutter)', cutSpec('cut-noseam', 700, { seam: false })));

    host.append(sub('Cut bar: pointer and keyboard states (long)'));
    host.append(
      cell('hover: Split in two', cutSpec('cut-hover', 700, {}, { force: force('[data-key="split"]', 'hover') })),
      cell('focus-visible: Done', cutSpec('cut-focus', 700, {}, { force: force('[data-key="done"]', 'focus-visible') })),
      cell('pressed: Split in two', cutSpec('cut-press', 700, {}, { force: force('[data-key="split"]', 'hover active') })),
      cell('focus-visible: a style face', cutSpec('cut-focus-seg', 700, {}, { force: force('.opts-seg [data-style="minis"]', 'focus-visible') })));

    host.append(sub('Cut bar on the worst-case grounds'));
    host.append(
      cell('on white (long)', cutSpec('cut-white', 700, { pieces: 2, undo: true }), { tone: 'white' }),
      cell('on amber (tight, 340)', cutSpec('cut-amber', 340, {}), { tone: 'amber' }));

    host.append(sub('Snap bar: label modes by room (700 / 480 / 330 / 270 px slots)'));
    host.append(
      cell('long: swatch names drawn, Save photo', snapSpec('snap-long', 700)),
      cell('short: swatches only, Save', snapSpec('snap-short', 480)),
      cell('icon: swatches, Save as an icon, Done keeps its word', snapSpec('snap-icon', 330)),
      cell('wrap: a second line for Save and Done', snapSpec('snap-wrap', 270)));

    host.append(sub('Snap bar: states'));
    host.append(
      cell('Lagoon selected (amber ring + tint, the swatch grows)', snapSpec('snap-lagoon', 700, { tint: 'lagoon' })),
      cell('saving: aria-busy, three jelly dots over the label', snapSpec('snap-saving', 700, { saving: true })),
      cell('hover: Dusk', snapSpec('snap-hover', 700, {}, { force: force('[data-tint="dusk"]', 'hover') })),
      cell('focus-visible: Save photo', snapSpec('snap-focus', 700, {}, { force: force('[data-key="save"]', 'focus-visible') })),
      cell('on white (icon)', snapSpec('snap-white', 330, { tint: 'ember' }), { tone: 'white' }),
      cell('on amber (long)', snapSpec('snap-amber', 700), { tone: 'amber' }));

    host.append(sub('Full dock (the desktop form): the instruction line and the pieces count are drawn above the controls on a wide viewport'));
    host.append(
      cell('Cut, full dock, 760 px', cutSpec('cut-full', 760, { pieces: 2, undo: true }, { form: 'full' })),
      cell('Snap, full dock, 760 px', snapSpec('snap-full', 760, {}, { form: 'full' })));
  },
};

// ---------- the HUD parts: hint pill, meter ring + Open, quick switcher (real components; hud.css skin) ----------
const hintCell = (label: string, text: string, width?: number): HTMLElement => {
  const p = h('p', { class: 'hint', text, attrs: { 'data-show': 'true' } });
  const box = h('div', { class: 'kp-hintbox' }, p);
  if (width) box.style.width = `${width}px`;
  return cell(label, box);
};
const BASE: MeterView = { fill: 0.35, credits: 0, resting: false, doneToday: false, tableFull: false, offline: false };
function ringCell(label: string, v: Partial<MeterView>, setup?: (m: MeterRing) => void, o: { tone?: 'white' | 'amber' } = {}): HTMLElement {
  const box = h('div', { class: 'kp-ringdemo' });
  const m = createMeterRing(box, { onOpen: () => {} });
  m.set({ ...BASE, ...v });
  setup?.(m);
  return cell(label, box, o);
}
function qsCell(label: string, form: 'row' | 'fold', n = 5, o: { tone?: 'white' | 'amber' } = {}): HTMLElement {
  const box = h('div', { class: `kp-qs kp-qs--${form}` });
  const qs = createQuickSwitch(box, () => {});
  qs.set(MOCK.switch.slice(0, n));
  return cell(label, box, o);
}

const hudParts: KitSection = {
  id: 'hud-parts', title: 'HUD parts on the kit: hint pill, meter ring + Open, quick switcher',
  note: 'The REAL hint pill (hint.ts wording), meter ring + Open button (meterRing.ts) and quick switcher (quickSwitch.ts), skinned by hud.css from the kit roles. The sheet only places them. A capsule waiting: the ring glows, Open breathes twice then keeps a steady amber halo; under Calm (the Calm sheets) the halo is steady and the ring says Ready.',
  build(host) {
    host.append(sub('Hint pill: one wording per input style, then the first-run tool line (shown when the pill comes back and no tool was tried yet; memory only)'));
    host.append(
      hintCell('touch', HINT_TEXT.touch),
      hintCell('pointer', HINT_TEXT.pointer),
      hintCell('keyboard', HINT_TEXT.keyboard),
      hintCell('first run, touch', HINT_TOOLS.touch),
      hintCell('first run, pointer', HINT_TOOLS.pointer),
      hintCell('first run, keyboard', HINT_TOOLS.keyboard),
      hintCell('longest wording in a 280 px box (balanced, never clipped)', HINT_TEXT.pointer, 280));

    host.append(sub('Meter ring + Open'));
    host.append(
      ringCell('resting fill (35 %)', {}),
      ringCell('a held squeeze: the lighter pending arc continues the fill', {}, (m) => m.setPending(0.2)),
      ringCell('a capsule is ready: ring glows, Open (the gel) with its halo; Calm = "Ready" on the ring', { fill: 0.62, credits: 1 }),
      ringCell('three waiting: the x3 badge', { fill: 0.1, credits: 3 }),
      ringCell('a ceremony runs: Open is off (aria, dashed)', { fill: 0.62, credits: 1 }, (m) => m.setBusy(true)),
      ringCell('done for today (state line above the ring, fill dimmed)', { fill: 1, doneToday: true }),
      ringCell('table full: a cream rim on Open', { fill: 0.5, credits: 1, tableFull: true }),
      ringCell('gain cue under Calm effects: a soft glow', { fill: 0.5 }, (m) => m.glow(true)),
      ringCell('on white', { fill: 0.62, credits: 1 }, undefined, { tone: 'white' }),
      ringCell('on amber', { fill: 0.62, credits: 1 }, undefined, { tone: 'amber' }));

    host.append(sub('Quick switcher: the OTHER squishies. row = wide and tall stack; fold = stack under 700 high (top left, where a short stack has no brand); strip and tiny draw none'));
    host.append(
      qsCell('row, five (double rim: 3 px tier + 2 px ink; the name says the tier word)', 'row'),
      qsCell('row, two', 'row', 2),
      qsCell('fold: [<] 1/6 [>]', 'fold'),
      qsCell('fold, one other', 'fold', 1),
      qsCell('row on white', 'row', 5, { tone: 'white' }),
      qsCell('row on amber', 'row', 5, { tone: 'amber' }));
  },
};

export function b3bSections(): KitSection[] { return [parts, hudParts]; }
