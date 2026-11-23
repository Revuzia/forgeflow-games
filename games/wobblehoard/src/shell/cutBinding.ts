// The Cut tool's DOM wiring (CUT2.md 6, 9.3; task S0 moved it here out of hudBinding.ts): the Cut bar and its buttons, the blade line, the hint the bar
// shows, the "Hand" hint when the tool goes back to the Hand with pieces, and the live-region lines of the buttons. Nothing here cuts or decides: it
// shows what game.cut reports (pieces, limits, busy, style, Undo) and forwards the buttons to it. Every string comes from cutText.ts, so the UI
// (src/ui/cutBar.ts) holds none of the copy.
import type { Announcer } from '../ui/announcer.ts';
import { createCutBar } from '../ui/cutBar.ts';
import type { CutBar } from '../ui/cutBar.ts';
import type { ToolId } from '../ui/toolbar.ts';
import * as T from './cutText.ts';
import type { Game } from './game.ts';

export interface CutBinding {
  readonly bar: CutBar;
  /** the live-region line for picking the Cut tool (it names Undo cut only once the Cutter offers it) */
  toolLine(): string;
  /** the tool changed: show or hide the bar, bring it up to date at once, and, on the way back to the Hand with two or more pieces, say how to join them
   *  (a toast and a polite line, once each time the squishy goes from whole to cut). Call it AFTER the tool's own line was said, so the hint follows it. */
  onTool(t: ToolId): void;
  destroy(): void;
}

export function bindCut(root: HTMLElement, canvas: HTMLCanvasElement, g: Game, ui: { announcer: Announcer; toast(text: string, ms?: number): void; show?(text: string): void }): CutBinding {
  const off: Array<() => void> = [];
  const say = (t: string): void => ui.announcer.say(t);
  const hasUndo = (): boolean => typeof g.cut.undoCut === 'function';

  let hinted = false;   // the Hand hint was said for the squishy as it is cut now
  let key = '';
  const refresh = (force: boolean): void => {
    const c = g.cut;
    const n = c.pieces, can = c.canSplit, undo = hasUndo(), canUndo = undo ? c.canUndo === true : undefined;
    if (n <= 1) hinted = false;                     // whole again (also while the Cut tool stays in hand): the next cut gets the hint again
    // D-103 (several squishies cut at once, a party out): the party's piece budget has its own hint line (the count stays the plain "N pieces" of everything that is cut;
    // the chips of ui/later-cutchips.ts say whose they are)
    const bud = c.budget ?? null;
    const k = `${n},${c.maxPieces},${c.busy},${can},${c.style},${c.canChangeStyle},${canUndo},${bud}`;
    if (!force && k === key) return;
    key = k;
    // (maxPieces is the safety ceiling: the bar disables Split in two only there. The counter is the plain number, labels.pieces; the hint is T.barText.)
    bar.setPieces(n, c.maxPieces, c.busy, can, bud !== null && n >= bud ? T.barPartyFull(bud) : T.barText(n, c.maxPieces), c.style, c.canChangeStyle, canUndo);
  };

  const bar = createCutBar(root, {
    labels: T.barLabels,                            // every word the bar draws or says on its own comes from cutText.ts
    onSplit: () => { const r = g.cut.splitInTwo(); if (r === 'miss') say(T.nothingToCut); },
    // (the animated path says "Whole again." itself when the last piece is in; with Skip animations everything is at once and silent, so the button says it: VERIFY B-M4)
    onReconnect: () => { const animated = !g.settings.skipAnimations; if (!g.cut.reconnectAll(animated)) say(T.inOnePiece); else if (!animated) say(T.whole); },
    onUndo: () => { if (!g.cut.undoCut?.()) say(T.inOnePiece); },
    onDone: () => g.setTool('hand'),
    // the Cut options control (UI lane) asks; the Cutter refuses with its own line while the squishy is cut, and the bar is repainted either way
    onStyle: (s) => { g.cut.setStyle(s); refresh(true); },
  });

  off.push(
    g.on('blade', (b) => {
      if (!b) { bar.setBlade(null); return; }
      const c = canvas.getBoundingClientRect();
      bar.setBlade({ x0: c.left + b.x0, y0: c.top + b.y0, x1: c.left + b.x1, y1: c.top + b.y1 });
    }),
    g.on('cut', (r) => { if (r === 'miss') say(T.swipeMiss); }),
    // (round 13, VERDICT_R12 4c) a refusal the player must SEE as well as hear: a line that only went to the visually hidden live region was invisible to a sighted
    // player. D-103: the party's piece budget (it replaces D-99's "One squishy at a time"). A toast at the top (the live region already has it from the notice:
    // the toast itself does not say it again)
    g.on('notice', (t) => { if (T.isShown(t)) { if (ui.show) ui.show(t); else ui.toast(t); } }),
    g.onStep(() => { if (g.tool === 'cut') refresh(false); }),
  );

  return {
    bar,
    toolLine: () => T.toolPicked(hasUndo()),
    onTool(t) {
      bar.show(t === 'cut');
      const n = g.cut.pieces;
      if (n <= 1) hinted = false;                   // whole again: the next cut gets the hint again
      if (t === 'cut') refresh(true);               // right now, not on the next sim step (a paused sim showed both buttons on)
      else if (t === 'hand' && n >= 2 && !g.cut.busy && !hinted) { hinted = true; ui.toast(T.handHint); say(T.handHint); }
    },
    destroy() { for (const f of off.splice(0)) f(); bar.destroy(); },
  };
}
