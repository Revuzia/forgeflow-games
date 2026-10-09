// The Cut tool's options bar (UI.md 4.2, 4.4; CUT.md 1, 2.6). While the blade is in hand the toolbar (toolbar.ts) holds this bar above the dock (inline
// beside the tools in strip and tiny): Split in two, Undo cut (only once the Cutter offers it), Reconnect all, the cut style control (Clean cut | Minis,
// CUT_A.md SR1) and Done, which puts the Hand back. The swipe itself is drawn as a thin blade line over the canvas (an SVG line, no pointer events).
// The hint line is NOT written here: the shell passes it in (cutBinding.ts, which takes every cut string from cutText.ts). Labels have three wordings
// (long, short, aria); the shell's cutText.ts is their home (UI.md 4.4) and `labels` in the options is how it will hand them over: until it does the
// defaults below stand, and _harness/probe_optbar.ts pins the two that cutText.ts already has (the style words and the locked reason).
//
// DOM contract (the harness and the shell find things by these): .cutbar[role=group] > .cutbar-row (.cutbar-text, .cutbar-count) + .cutbar-acts >
// button[data-key=split|undo|join|done] and the style radiogroup. While a cut or a reconnect plays, Split / Undo / Reconnect are aria-disabled (not
// `disabled`): a disabled button drops the keyboard focus to the page and the keyboard path would start again from the top; a press then does nothing.
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { CUT_BAR_LABELS, CUT_STYLE_CONTROL, CUT_STYLE_IDS } from './cutContract.ts';
import type { CutBarLabels, CutStyleId } from './cutContract.ts';
import { attachTooltip } from './tooltip.ts';
import { createOptionsFit, optButton, optId, watchBody } from './optionsBar.ts';

/** the cut style, as the shell's Cutter names it (cutContract.ts; the old name stays for the shell's imports) */
export type CutBarStyle = CutStyleId;
export type { CutBarLabels };
export { CUT_BAR_LABELS };

export interface CutBar {
  readonly el: HTMLElement;
  /** Show or hide the bar. The toolbar holds the node in its attachment slot and the node must not carry `hidden` then: `show(true)` (idempotent, also measures the
   *  room) BEFORE `toolbar.attach(bar.el, 'cut')`, `toolbar.attach(null)` when the tool goes. */
  show(on: boolean): void;
  /** pieces of the squishy now (1 = whole), the most it can make, whether a cut or a reconnect plays, whether any piece is still big enough to split in two,
   *  the hint line to show (the shell's words), the cut style (undefined = the Cutter does not offer the style: no control), whether the style can be changed
   *  now (false while the squishy is cut or busy: the control shows locked, with the plain reason), and Undo cut: undefined = the Cutter does not offer it
   *  (no button in the bar), false = offered but nothing to undo, true = ready */
  setPieces(n: number, max: number, busy: boolean, canSplit: boolean, text: string, style?: CutBarStyle, canChangeStyle?: boolean, canUndo?: boolean): void;
  /** the swipe in progress in page px, or null */
  setBlade(b: { x0: number; y0: number; x1: number; y1: number } | null): void;
  /** measure the room again now (the toolbar moved the bar, fonts arrived) */
  fit(): void;
  /** the label mode now (long | short | icon) and whether the row wrapped: the probes read them */
  readonly mode: string;
  readonly wrapped: boolean;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const REASON_MS = 2600;
let seq = 0;

export function createCutBar(root: HTMLElement, o: {
  onSplit(): void; onReconnect(): void; onDone(): void; onUndo?(): void;
  /** the Cut options control asks for a style; the Cutter answers (it refuses with its own line while the squishy is cut) and the bar is repainted by setPieces */
  onStyle?(style: CutBarStyle): void;
  labels?: Partial<CutBarLabels>;
}): CutBar {
  const L: CutBarLabels = { ...CUT_BAR_LABELS, ...(o.labels ?? {}) };
  const whyId = optId('why');
  const text = h('p', { class: 'cutbar-text opts-text', attrs: { id: whyId } });
  const count = h('span', { class: 'cutbar-count opts-count' });

  const split = optButton({ icon: 'split', label: L.split, key: 'split', reason: () => text.textContent || undefined });
  const join = optButton({ icon: 'join', label: L.join, key: 'join', reason: () => text.textContent || undefined });
  const undo = optButton({ icon: 'reset', label: L.undo, key: 'undo', reason: () => text.textContent || undefined });
  const done = optButton({ label: L.done, key: 'done', gel: true });
  // clicks: a press while the button is aria-disabled (a cut plays) does nothing
  const guarded = (b: HTMLButtonElement, fn?: () => void): void => b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') fn?.(); });
  guarded(split.el, o.onSplit); guarded(join.el, o.onReconnect); guarded(undo.el, o.onUndo);
  done.el.addEventListener('click', () => o.onDone());

  // the style control: native radios in the kit's segmented control. Locked = aria-disabled + the dashed look, NOT `disabled`: a press must still reach the
  // Cutter, which answers with its own live line, and the bar then shows the plain reason too (a tooltip held for a moment, also on touch)
  const lockId = optId('lock');
  const lockWhy = h('span', { class: 'sr-only', text: L.styleLocked, attrs: { id: lockId } });
  const lockMark = h('i', { class: 'opts-lock', attrs: { 'aria-hidden': 'true' } }, icon('lock'));
  const group = `cutstyle-${++seq}`;
  const seg = h('div', { class: 'k-seg opts-seg cutbar-style', attrs: { role: 'radiogroup', 'aria-label': L.styleGroup, 'aria-describedby': lockId, hidden: '' } });
  const radios = new Map<CutBarStyle, HTMLInputElement>();
  let locked = false;
  let curStyle: CutBarStyle = 'clean';
  let reasonTimer = 0;
  const tips = [] as Array<ReturnType<typeof attachTooltip>>;
  for (const id of CUT_STYLE_IDS) {
    const input = h('input', { class: 'k-seg-input', attrs: { type: 'radio', name: group, value: id, 'data-style': id } });
    const face = h('span', { class: 'k-seg-face' }, icon(id === 'minis' ? 'minis' : 'clean'), h('span', { text: L.style[id].long }));
    seg.append(h('label', { class: 'k-seg-opt' }, input, face));
    radios.set(id, input);
    tips.push(attachTooltip(input, () => (locked ? L.styleLocked : L.style[id].long), { place: () => (document.body.dataset.layout === 'strip' ? 'below' : 'above'), when: () => locked || el.dataset.labels === 'tight' }));
    input.addEventListener('change', () => {
      if (!input.checked) return;
      if (locked) {
        // refused: put the selection back, ask the Cutter anyway (it says the reason in the live region), and show the reason here
        radios.get(curStyle)!.checked = true;
        o.onStyle?.(id);
        const t = tips[CUT_STYLE_IDS.indexOf(id)];
        t.show();
        clearTimeout(reasonTimer);
        reasonTimer = window.setTimeout(() => t.hide(), REASON_MS);
        return;
      }
      o.onStyle?.(id);
    });
  }
  seg.append(lockMark, lockWhy);

  const acts = h('div', { class: 'cutbar-acts opts-row' }, split.el, join.el, seg, done.el);
  const status = h('div', { class: 'cutbar-row opts-status' }, text, count);
  const el = h('div', { class: 'cutbar opts opts--cut', attrs: { role: 'group', 'aria-label': L.group, hidden: '' } }, status, acts);
  root.append(el);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'blade'); svg.setAttribute('aria-hidden', 'true');
  const glow = document.createElementNS(SVG_NS, 'line'); glow.setAttribute('class', 'blade-glow');
  const line = document.createElementNS(SVG_NS, 'line'); line.setAttribute('class', 'blade-line');
  svg.append(glow, line);
  root.append(svg);
  svg.style.display = 'none';

  const fitter = createOptionsFit(el, () => [split, join, ...(undo.el.isConnected ? [undo] : []), done], undefined, () => done.el);
  // tiny: Done comes FIRST (the tray steps aside and Done is the way back; UI.md 4.2): DOM order = Tab order = what is drawn
  const offLayout = watchBody((layout) => { if (layout === 'tiny') acts.prepend(done.el); else acts.append(done.el); });

  let sig = '';
  const paintStyle = (style: CutBarStyle | undefined, canChange: boolean, busy: boolean): void => {
    const offered = CUT_STYLE_CONTROL && style !== undefined && o.onStyle !== undefined;
    seg.hidden = !offered;
    if (!offered) { el.removeAttribute('data-style'); el.removeAttribute('data-style-locked'); return; }
    curStyle = style;
    for (const [id, input] of radios) input.checked = id === style;
    locked = !canChange || busy;
    seg.setAttribute('aria-disabled', String(locked));
    seg.dataset.locked = String(locked);
    el.dataset.style = style;
    el.dataset.styleLocked = String(locked);
  };

  return {
    el,
    get mode() { return fitter.mode; },
    get wrapped() { return fitter.wrapped; },
    fit: () => fitter.fit(),
    show(on) {
      el.hidden = !on;
      if (!on) svg.style.display = 'none'; else fitter.fit();
    },
    setPieces(n, max, busy, canSplit, hint, style, canChangeStyle = true, canUndo) {
      count.textContent = n > 1 ? L.pieces(n) : '';
      if (text.textContent !== hint) text.textContent = hint;
      const hadSplit = document.activeElement === split.el, hadJoin = document.activeElement === join.el, hadUndo = document.activeElement === undo.el;
      if (canUndo !== undefined && !undo.el.isConnected) acts.insertBefore(undo.el, join.el);
      else if (canUndo === undefined && undo.el.isConnected) undo.el.remove();
      const noSplit = n >= max || !canSplit, noJoin = n <= 1, noUndo = canUndo !== true;
      split.el.disabled = noSplit; join.el.disabled = noJoin;   // really off: nothing more to cut, nothing to join
      split.el.setAttribute('aria-disabled', String(busy || noSplit)); join.el.setAttribute('aria-disabled', String(busy || noJoin));
      undo.el.disabled = noUndo; undo.el.setAttribute('aria-disabled', String(busy || noUndo));
      // a disabled control names its reason: the bar's line (the shell's words), which is drawn when there is room and always read
      for (const [b, off] of [[split, busy || noSplit], [join, busy || noJoin], [undo, busy || noUndo]] as const) {
        if (off && hint) b.el.setAttribute('aria-describedby', whyId); else b.el.removeAttribute('aria-describedby');
      }
      paintStyle(style, canChangeStyle, busy);
      // a button that goes off under the keyboard focus hands the focus on (Reconnect all when there is something to join, else Done)
      if ((hadSplit && noSplit) || (hadJoin && noJoin) || (hadUndo && noUndo)) (join.el.disabled ? done.el : join.el).focus({ preventScroll: true });
      // the controls' width changes with the Undo button and the style control: measure again then (a count or a hint line never moves them)
      const s = `${undo.el.isConnected},${seg.hidden}`;
      if (s !== sig) { sig = s; if (!el.hidden) fitter.fit(); }
    },
    setBlade(b) {
      if (!b) { svg.style.display = 'none'; return; }
      svg.style.display = '';
      for (const l of [glow, line]) { l.setAttribute('x1', b.x0.toFixed(1)); l.setAttribute('y1', b.y0.toFixed(1)); l.setAttribute('x2', b.x1.toFixed(1)); l.setAttribute('y2', b.y1.toFixed(1)); }
    },
    destroy() {
      clearTimeout(reasonTimer);
      offLayout(); fitter.destroy();
      for (const t of tips) t.destroy();
      split.destroy(); join.destroy(); undo.destroy(); done.destroy();
      el.remove(); svg.remove();
    },
  };
}
