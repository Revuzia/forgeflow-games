// The REAL Cut bar and Snap bar for the kit page (UI.md 4.4), driven by a stub Cutter (src/ui/cutContract.ts stubCut) the way cutBinding.ts drives
// them in the game: the hint line comes from shell/cutText.ts (barText), the style goes through the stub's setStyle, and the bar is repainted by setPieces.
// A sheet button works: Split in two makes two pieces, Reconnect all joins, the style control asks the stub (which refuses while the squishy is cut).
import { createCutBar } from '../../src/ui/cutBar.ts';
import type { CutBar } from '../../src/ui/cutBar.ts';
import { createSnapBar } from '../../src/ui/snapBar.ts';
import type { SnapBar } from '../../src/ui/snapBar.ts';
import { stubCut } from '../../src/ui/cutContract.ts';
import type { CutStub } from '../../src/ui/cutContract.ts';
import { barText } from '../../src/shell/cutText.ts';

export interface KitCut { bar: CutBar; stub: CutStub; refresh(): void }
export interface CutState { pieces?: number; max?: number; busy?: boolean; canSplit?: boolean; undo?: boolean | 'none'; style?: 'clean' | 'minis'; seam?: boolean; show?: boolean }

/** A Cut bar on a stub Cutter. `undo`: true = ready, false = offered with nothing to undo, 'none' (default) = the Cutter does not offer Undo cut. `seam: false` = no style seam. */
export function realCut(root: HTMLElement, st: CutState = {}): KitCut {
  const stub = stubCut({ pieces: st.pieces ?? 1, maxPieces: st.max ?? 2, busy: st.busy ?? false, canSplit: st.canSplit ?? true, style: st.style ?? 'clean', canUndo: st.undo === 'none' || st.undo === undefined ? undefined : st.undo });
  const seam = st.seam !== false;
  let bar!: CutBar;
  const refresh = (): void => {
    const can = stub.canSplit && stub.pieces < stub.maxPieces;
    bar.setPieces(stub.pieces, stub.maxPieces, stub.busy, can, barText(stub.pieces, stub.maxPieces, can, stub.canUndo !== undefined),
      seam ? stub.style : undefined, stub.canChangeStyle, stub.canUndo);
  };
  bar = createCutBar(root, {
    onSplit: () => { stub.pieces = Math.min(stub.maxPieces, stub.pieces + 1); if (stub.canUndo !== undefined) stub.canUndo = true; refresh(); },
    onReconnect: () => { stub.pieces = 1; if (stub.canUndo !== undefined) stub.canUndo = false; refresh(); },
    onUndo: () => { stub.pieces = Math.max(1, stub.pieces - 1); stub.canUndo = stub.pieces > 1; refresh(); },
    onDone: () => {},
    onStyle: seam ? (s) => { stub.setStyle(s); refresh(); } : undefined,
  });
  refresh();
  if (st.show !== false) bar.show(true);
  return { bar, stub, refresh };
}

export function realSnap(root: HTMLElement, o: { saving?: boolean; tint?: string; show?: boolean } = {}): SnapBar {
  const bar = createSnapBar(root, { onSave: () => {}, onDone: () => {}, onTint: () => {} });
  if (o.show !== false) { bar.el.hidden = false; bar.fit(); }   // (not bar.show(): that focuses Save, and a sheet must not steal the focus)
  if (o.tint) bar.el.querySelector<HTMLElement>(`[data-tint="${o.tint}"]`)?.click();
  if (o.saving) bar.setSaving(true);
  return bar;
}
