// The Cut tool's bar (CUT.md 1, 2.6): while the blade is in hand, a small bar above the HUD's bottom row (a strip along the top edge on a short landscape
// screen, hoard.css) says what to do and offers the two
// buttons that make the tool work without a drag: Split in two (a vertical cut through the middle as the camera sees it) and Reconnect all;
// Done puts the Hand back. The swipe itself is drawn as a thin blade line over the canvas (an SVG line, no pointer events).
// The hint line is NOT written here: the shell passes it in (cutBinding.ts, which takes every cut string from cutText.ts). Undo cut (CUT2.md 6, 9.3)
// and the cut style (CUT_A.md SR1: 'clean' | 'minis') are fed through setPieces too; the Undo button is only put in the bar once the shell says the
// Cutter offers it, and the style is held as data attributes on the bar until the Cut options control (UI lane) shows it.
import { h } from './dom.ts';

/** the cut style, as the shell's Cutter names it (cutText.ts CutStyle; written out here so the UI does not import the shell) */
export type CutBarStyle = 'clean' | 'minis';

export interface CutBar {
  readonly el: HTMLElement;
  show(on: boolean): void;
  /** pieces of the squishy now (1 = whole), the most it can make, whether a cut or a reconnect plays, whether any piece is still big enough to split in two,
   *  the hint line to show (the shell's words), the cut style, whether the style can be changed now (false while the squishy is cut or busy), and Undo cut:
   *  undefined = the Cutter does not offer it (no button in the bar), false = offered but nothing to undo, true = ready */
  setPieces(n: number, max: number, busy: boolean, canSplit: boolean, text: string, style?: CutBarStyle, canChangeStyle?: boolean, canUndo?: boolean): void;
  /** the swipe in progress in page px, or null */
  setBlade(b: { x0: number; y0: number; x1: number; y1: number } | null): void;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createCutBar(root: HTMLElement, o: { onSplit(): void; onReconnect(): void; onDone(): void; onUndo?(): void; /** the Cut options control (UI lane) calls it; the style comes back through setPieces */ onStyle?(style: CutBarStyle): void }): CutBar {
  const text = h('p', { class: 'cutbar-text' });
  const count = h('span', { class: 'cutbar-count' });
  const split = h('button', { class: 'act-btn', text: 'Split in two', attrs: { type: 'button', 'data-key': 'split' } });
  const join = h('button', { class: 'act-btn', text: 'Reconnect all', attrs: { type: 'button', 'data-key': 'join' } });
  const done = h('button', { class: 'act-btn primary', text: 'Done', attrs: { type: 'button', 'data-key': 'done' } });
  // Undo cut: made now, put in the bar (between Split in two and Reconnect all) only once the Cutter offers it
  const undo = h('button', { class: 'act-btn', text: 'Undo cut', attrs: { type: 'button', 'data-key': 'undo' } });
  undo.addEventListener('click', () => { if (undo.getAttribute('aria-disabled') !== 'true') o.onUndo?.(); });
  // while a cut or a reconnect plays the buttons are aria-disabled (not `disabled`): a disabled button drops the keyboard focus to the page, and the
  // keyboard path (Tab, Enter, Tab, Enter) would start again from the top; a press during that moment does nothing
  split.addEventListener('click', () => { if (split.getAttribute('aria-disabled') !== 'true') o.onSplit(); });
  join.addEventListener('click', () => { if (join.getAttribute('aria-disabled') !== 'true') o.onReconnect(); });
  done.addEventListener('click', () => o.onDone());
  const acts = h('div', { class: 'cutbar-acts' }, split, join, done);
  const el = h('div', { class: 'cutbar', attrs: { role: 'group', 'aria-label': 'Cut tool', hidden: '' } },
    h('div', { class: 'cutbar-row' }, text, count), acts);
  root.append(el);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'blade'); svg.setAttribute('aria-hidden', 'true');
  const glow = document.createElementNS(SVG_NS, 'line'); glow.setAttribute('class', 'blade-glow');
  const line = document.createElementNS(SVG_NS, 'line'); line.setAttribute('class', 'blade-line');
  svg.append(glow, line);
  root.append(svg);
  svg.style.display = 'none';

  return {
    el,
    show(on) { el.hidden = !on; if (!on) svg.style.display = 'none'; },
    setPieces(n, max, busy, canSplit, hint, style = 'clean', canChangeStyle = true, canUndo) {
      count.textContent = n > 1 ? `${n} pieces` : '';
      if (text.textContent !== hint) text.textContent = hint;
      el.dataset.style = style;
      el.dataset.styleLocked = String(!canChangeStyle || busy);
      const hadSplit = document.activeElement === split, hadJoin = document.activeElement === join, hadUndo = document.activeElement === undo;
      if (canUndo !== undefined && !undo.isConnected) acts.insertBefore(undo, join);
      else if (canUndo === undefined && undo.isConnected) undo.remove();
      const noSplit = n >= max || !canSplit, noJoin = n <= 1, noUndo = canUndo !== true;
      split.disabled = noSplit; join.disabled = noJoin;   // really off: nothing more to cut, nothing to join
      split.setAttribute('aria-disabled', String(busy || noSplit)); join.setAttribute('aria-disabled', String(busy || noJoin));
      undo.disabled = noUndo; undo.setAttribute('aria-disabled', String(busy || noUndo));
      // a button that goes off under the keyboard focus hands the focus on (Reconnect all when there is something to join, else Done)
      if ((hadSplit && noSplit) || (hadJoin && noJoin) || (hadUndo && noUndo)) (join.disabled ? done : join).focus({ preventScroll: true });
    },
    setBlade(b) {
      if (!b) { svg.style.display = 'none'; return; }
      svg.style.display = '';
      for (const l of [glow, line]) { l.setAttribute('x1', b.x0.toFixed(1)); l.setAttribute('y1', b.y0.toFixed(1)); l.setAttribute('x2', b.x1.toFixed(1)); l.setAttribute('y2', b.y1.toFixed(1)); }
    },
    destroy() { el.remove(); svg.remove(); undo.remove(); },
  };
}
