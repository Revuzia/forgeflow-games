// The seam between the Cut options bar and the shell's Cutter (UI.md 4.4, CUT_A.md SR1). The UI owns this file and nothing else of the cut:
// `CutLike` is the part of the Cutter the bar READS (pieces, limits, busy, the cut style, Undo cut), written structurally so `src/ui` never
// imports the shell (the shell's `Cutter` is assignable to it; _harness/probe_optbar.ts proves that at compile time), and `readCutStyle` is
// how a binding asks "does this Cutter offer the style control, and what does it say now". The Clean cut | Minis control is behind
// `CUT_STYLE_CONTROL`: flip it to false and the bar never draws the control (the stub below is what the kit page and the probe drive).

/** the three wordings of a control (optionsBar.ts OptLabel, written out so this file imports nothing): long when there is room, short when there is little, aria = what assistive tech hears (default: long) */
export interface OptLabel { long: string; short: string; aria?: string }

/** the two cut styles, as the Cutter names them (shell/cutText.ts CutStyle; written out here so the UI does not import the shell) */
export type CutStyleId = 'clean' | 'minis';
export const CUT_STYLE_IDS: readonly CutStyleId[] = ['clean', 'minis'];

/** The feature flag of the style control (the owner decision of 2026-10-08). The Cutter offers the seam since CUT-A task S0; true shows the control
 *  whenever the Cutter reports a style, false hides it whatever the Cutter says. */
export const CUT_STYLE_CONTROL = true;

export interface CutLike {
  /** pieces of the play squishy (1 = whole) */
  readonly pieces: number;
  readonly maxPieces: number;
  /** a neck or a reconnect is playing */
  readonly busy: boolean;
  /** Split in two can still do something */
  readonly canSplit: boolean;
  /** SR1: absent on a Cutter that does not offer the style (the control stays hidden) */
  readonly style?: CutStyleId;
  /** SR1: the squishy is whole and nothing plays */
  readonly canChangeStyle?: boolean;
  /** SR1: false and no change while the squishy is cut or busy (the Cutter says the plain reason in the live region itself) */
  setStyle?(style: CutStyleId): boolean;
  /** Undo cut: absent until the Cutter offers it (no button then) */
  readonly canUndo?: boolean;
  undoCut?(): boolean;
}

/** what the style control shows */
export interface CutStyleView {
  /** the control is drawn at all (flag on, and the Cutter reports a style and takes one) */
  offered: boolean;
  style: CutStyleId;
  /** the style can be changed now (false = shown locked, with the plain reason) */
  canChange: boolean;
}

/** Read the style seam of a game's Cutter. Missing parts mean "not offered": style 'clean', locked. */
export function readCutStyle(g: { cut: CutLike }): CutStyleView {
  const c = g.cut;
  const offered = CUT_STYLE_CONTROL && (c.style === 'clean' || c.style === 'minis') && typeof c.setStyle === 'function';
  return { offered, style: c.style === 'minis' ? 'minis' : 'clean', canChange: offered && c.canChangeStyle !== false };
}

/** A Cutter that cuts nothing but speaks the whole contract: the kit page and the probe drive the bar with it. It follows SR1's rules: the style
 *  can change only while the squishy is whole and idle; `setStyle` answers false (and changes nothing) otherwise. */
export interface CutStub extends CutLike {
  pieces: number;
  busy: boolean;
  style: CutStyleId;
  canUndo?: boolean;
  setStyle(style: CutStyleId): boolean;
  /** every setStyle call, in order (the probe reads it) */
  readonly asked: CutStyleId[];
}
export function stubCut(o: Partial<Pick<CutLike, 'pieces' | 'maxPieces' | 'busy' | 'canSplit' | 'canUndo'>> & { style?: CutStyleId } = {}): CutStub {
  const asked: CutStyleId[] = [];
  const s: CutStub = {
    pieces: o.pieces ?? 1,
    maxPieces: o.maxPieces ?? 2,
    busy: o.busy ?? false,
    canSplit: o.canSplit ?? true,
    style: o.style ?? 'clean',
    canUndo: o.canUndo,
    asked,
    get canChangeStyle() { return s.pieces <= 1 && !s.busy; },
    setStyle(next) {
      asked.push(next);
      if (next === s.style) return true;
      if (!s.canChangeStyle) return false;
      s.style = next;
      return true;
    },
  };
  return s;
}

/** Every word the bar draws or says on its own. Defaults mirror cutText.ts (styleLabel, styleLocked); the shell may pass its own through `labels`. */
export interface CutBarLabels {
  group: string;
  split: OptLabel;
  join: OptLabel;
  undo: OptLabel;
  done: OptLabel;
  styleGroup: string;
  style: Record<CutStyleId, OptLabel>;
  /** the plain reason the style cannot change now (cutText.styleLocked) */
  styleLocked: string;
  pieces(n: number): string;
}
export const CUT_BAR_LABELS: CutBarLabels = {
  group: 'Cut tool',
  split: { long: 'Split in two', short: 'Split' },
  join: { long: 'Reconnect all', short: 'Reconnect' },
  undo: { long: 'Undo cut', short: 'Undo' },
  done: { long: 'Done', short: 'Done' },
  styleGroup: 'Cut style',
  style: { clean: { long: 'Clean cut', short: 'Clean cut' }, minis: { long: 'Minis', short: 'Minis' } },
  styleLocked: 'Reconnect first to change the cut style',
  pieces: (n) => `${n} pieces`,
};
