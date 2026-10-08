# CUT_A_SHELL: running report of the SHELL lane, CUT-A slice (keep under 10 KB)

Brief: `_handoff/briefs/CUT_A.md`. Tasks: S0, S1 (Leg 1: shell-1); S2 first half, S3 vocabulary, S5a in later legs. Nothing committed by this lane.

## Leg 1 (shell-1): S0 and S1 DONE

Baseline before any edit (this PC, shared and busy, 100 % CPU): `tsc` clean; `node_checks` 127/131, the four reds are the section-7h rows
`A-F3` x3 and `A-F7` x1 (red by design until the chunk build is deleted, CUT2.md 14 O0); `probe_app` 183/183.
After S0 + S1: `tsc` clean; `node_checks` 128/131 (the 3 reds are the same section-7h rows; the 4th, `A-F3 ... after Split in two nothing rises
above 1.0 m`, passed this time. It is a real-physics launch row and `src/physics/softbody.ts` is being edited by the PHYS lane in this worktree
(git status shows it modified before my first edit), so I do not attribute the change to S0; not investigated); `probe_app` 183/183.

### S0 prep refactor
- NEW `src/shell/cutText.ts`: every cut string, revised wording of 9.3 (+ Minis `Cut into N minis.`, the style lock line, style labels).
  `toolPicked(undo)` and `noneBigEnough(undo)` name Undo cut only when the Cutter offers it (it does not in this slice), so no text names a
  control the player cannot find. `CutStyle = 'clean' | 'minis'` lives here (re-exported by `cut.ts`).
- NEW `src/shell/cutBinding.ts` (`bindCut(root, canvas, g, { announcer, toast })`): Cut bar + buttons, blade, miss line, per-step bar refresh,
  the Hand hint (toast + polite line). `hudBinding.ts` lost ~30 cut lines and calls it (`cutB.toolLine()`; `cutB.onTool(t)` at the END of the
  tool handler so the hint follows the tool's line). The hint is said once per whole-to-cut (reset when the Cutter reports 1 piece).
- `src/ui/cutBar.ts`: `setPieces(n, max, busy, canSplit, text, style = 'clean', canChangeStyle = true, canUndo?)`. The hint text is passed in
  (no copy for it in `src/ui`; button labels stay). `canUndo` undefined = no Undo button in the DOM (the old row that lists the bar's buttons
  stays green); false/true = `data-key="undo"` button, disabled/enabled, placed between Split in two and Reconnect all. Options `onUndo?`, `onStyle?`.
  The style is data on the bar (`data-style`, `data-style-locked`) until the UI lane draws the Cut options control; that control calls
  `o.onStyle(style)` (the binding forwards it to `g.cut.setStyle` and repaints).
- `src/shell/cut.ts` (strings -> `T.*` and the seam only; NOT rewritten): `Cutter` gains `style`, `canChangeStyle`, `setStyle(style)` (false and
  the line "Reconnect first to change the cut style" while cut or busy), `prewarm()` (no-op), optional `canUndo` / `undoCut` (absent).
  The style is only RECORDED in this build (pieces are still built the old way); S2 acts on it.
- `game.ts setTool`: one line, `cut.prewarm()` after the emit (in try/catch -> report).
- Wording that changed vs the old code: bar hint "onto another" (was "into"), `Joined. Now N pieces.`, the no-split line. Only
  `browser_shell.mjs:2443` (`/as many pieces|too small to split/i` on the bar text) could meet the new "No piece is big enough to cut again" line, and
  only in the stalled state the fix round removed; S4 re-specs it (CUT2.md 14).
- Real-app check (scratch script, not in the harness; `s0_browser.mjs`, port 5401): 7/7. Cut picked: bar text, buttons exactly Split in two /
  Reconnect all / Done (no Undo), `data-style=clean`, tool line unchanged; after Split in two: "Cut into 2 pieces.", the "With the Hand ... onto
  another" bar text, `data-style-locked=true`; Done: tool line + "Drag a piece onto another and hold to join them." as live line AND toast;
  back to the Hand again: no second hint; Reconnect all then a new cut then Done: hint again; 0 console problems.
- Known edge: Done pressed DURING the first cut's neck (pieces still 1) gets no hint; the cut then finishes in the Hand tool.

### S1 cut tree
- NEW `src/shell/cutRegion.ts` (pure, 179 lines): `createCutTree, cutPiece(t, leaf, n, d) -> [A, B] | null, lca, group(t, p, q) -> { node, members,
  twins } | null, joinGroup(t, node), undoCut(t), rollbackCut(t, node), isWhole, cutStack, regionOf(t, node) -> one-cell PieceRegion | null,
  leaves, leavesUnder, isLive, isLeaf, planeById`. Named `undoCut` (not `undo`) to match `Cutter.undoCut`. The tree owns the plane table and the ids
  (ids from 1, not reused until whole again; `rollbackCut` gives them back for a cut the builder refused during the neck, CUT2.md 6.3).
  Nodes joined away or rolled back are DEAD (links cut): every function answers null for them. `regionOf` works for an internal node too (the
  target of an armed join, 7.2) and returns copies. Planes are stored as copies. No limit on leaves in the module: MAX_PIECES is the shell's.
- NEW `_harness/shellview/cut_checks.ts` (11 unit rows + 4 X18 rows, 15 in all). `node _harness/shellview/cut_checks.ts` runs the spec's
  100 000 sequences on 3 worker threads (`--workers=1` single thread, `--seqs=N` quick run). The model is independent of the tree code: live
  pieces as path strings ("AB"), join = longest common prefix, plus 12 fixed sample points routed by the real planes. Checked after EVERY op.
- MEASURED (run alone, single thread, busy machine): X18 100 000 sequences, 2 212 782 operations, 296.7 s, 0 failures: cuts 836 450, twin joins
  313 103, group joins 165 309 (388 761 of them to the root), undos 106 414, rollbacks 124 976, refused calls 132 691, whole again mid-sequence
  445 996, all 100 000 drained to the root; most leaves 6, most nodes 11 (never more; 4 pieces on every third sequence for "low"). Exhaustive
  row: all 65 tree shapes up to 6 pieces (1, 1, 2, 5, 14, 42) x all 807 pairs: ok. The 3-thread version was tested at 6 000 sequences only.
- Mutation check of the checker (scratch, 23 mutants of `cutRegion.ts`: stack/plane bookkeeping, lca, group members, literal signs, id reset,
  undo target, rollback ids, region aliasing, kill of descendants, internal cut, NaN plane, ...): 20 killed, 3 survived and all three are
  equivalent mutants (a dead node always has kids = null so the isLive guard in joinGroup is redundant; isLive's sibling check is redundant
  under the module's invariants; the plane-id guard of rollbackCut is redundant with its node-id guard because the two counters move together).

### Browser sections of the old harness that read the changed texts
`node _harness/browser_shell.mjs --quick --port=5402 --only=toys-tray,cut-real,cut-touch,cut-x,fix1-split,cut-low` (these hold every old row that
reads the Cut bar, the tool line or a cut live-region line): 44/44 ok, 0 FAIL (98 s, 787 s, 127 s, 746 s, 127 s, 126 s on the busy machine).
Not run (the orchestrator's full run covers them): `fix1-cover`, `fix2-dock`, `fix1-tray`, `toys-phone` (bar layout; the bar text is 1 character longer).
Strays checked at the end: no vite / chromium left from this leg. Line endings of the 4 edited existing files restored to CRLF; new files are LF.

## Next (Leg 2): S2 first half
Rewrite `cut.ts` on the cut tree (`Piece = { body, leaf, frac, built }`), consume `style` (Minis = old scaled-whole build, all pieces
`chunk: false`, no region), `canUndo/undoCut`, `MAX_PIECES` clean = 2 for milestone A (S5a). Must keep `canChangeStyle` and `prewarm`.
