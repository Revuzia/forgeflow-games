# CUT-A: the first slice of the TRUE CUT (and the Minis style). Read this, then ONLY the CUT2.md line ranges your task names.

**Owner's words (2026-10-08).** "When I SPLIT it just takes out a little ball ... I wanted a REAL cut, like if I cut a squishy in half, one eye is on one side and one is on the other. Clean cuts, not a little ball/piece." And: "a toolbar where I can click to cut into slices, or pieces, which would leave the squishy in that exact type of slice, and then put it back together. I also want to cut where it makes miniature squishies of the same squish. Both modes."

**The two cut styles.** *Clean cut* (CUT2.md): every piece is the real part of the squishy on its side of the plane, flat cut face, features stay on the side they sit. *Minis* (`_spec/CUT_MINIS.md`): every piece is a COMPLETE smaller copy of the squishy (the species scaled by cbrt of its share, own face), built with the old scaled-whole path (`PieceOpts { frac, chunk: false }`, no `region`). Both: Reconnect all returns the exact original; the style is chosen in the Cut options bar (the UI lane builds the control; you provide the setter, see SR1).

**Scope of this slice (CUT2.md section 14 and 15 step 4, "Milestone A", a GATE):** tasks O1 (orchestrator), S0, S1, P0, P1a, P1b, P2, P3, R1 (trimmed), S2 first half, S5a, plus Minis and the style setter. `MAX_PIECES` for the clean style is a constant that this slice sets to 2; Minis may use the old limits. NOT in this slice (do not build): P4 to P9 beyond what a task below names, R2, R3, R3b, R4, nested cuts beyond what P1b's pure module already supports, joins of non-twins, Undo cut, the camera peek, the 12 family looks, S4, S5. When the slice is done the owner looks at it before more is built.

**Defaults the owner has not vetoed (CUT2.md 17.2):** the cut face stays flat forever; a cut that would leave loose crumbs is refused with a line; one swipe cuts one piece; thin side slices may tip over.

## Hard budget (the owner is watching token use; long runs are failures)
- One leg = at most 3 hours of work and about 250 tool calls. Then STOP and return, even if unfinished: say what is done and what is next in your running report. The orchestrator starts the next leg.
- Keep a RUNNING REPORT (`_handoff/reports/CUT_A_<LANE>.md`, at most 10 KB): after every finished task write what was measured (numbers), what is next, what blocks. A restart must lose little.
- Never read CUT2.md whole (241 KB). Read only your line ranges. Read files with offset and limit; grep before you read.
- Do not poll long runs. Start a run in the background with its output in a log under your scratch folder and look at the log once when you need it; a probe that takes minutes is run once, not repeated.
- Do not run the whole browser harness (68 minutes). Run only the rows your task changes (`--only=` sections, listed in the file header of `_harness/browser_shell.mjs`). The orchestrator runs the whole harness once at the end.
- No "exhaustive" extras: do what the task says, measure it with the named probe rows, report.

## Environment and rules (also `RESUME.md`)
Windows; Bash tool with POSIX syntax; call node entry points directly (`node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, not `npx`); relative imports end in `.ts`; ports 5360 to 5381 are taken by others: use 5400 to 5409 only; one browser at a time; kill what you start; the machine has 4 shared cores and is busy. `tsc` clean after every task. Never loosen a check; a check that encodes the old chunk behaviour may be re-specified only with the written reason "the owner changed the design on 2026-10-08" and only where your task says so (CUT2.md 14, "Existing checks"). Never run a git write command (the orchestrator commits). `src/contracts.ts` is frozen after task O1: ask the orchestrator for changes. No new dependencies, no outside assets. The strict CSP and the size gates G0 (3 MB) and G0b (600 KB gzip first-play) hold. Other engineers work in parallel on other files: edit only the files your lane owns (CUT2.md 14, "File ownership").

## SR1: the cut style seam (owner request; the UI lane builds against it)
The shell's `Cutter` (`src/shell/cut.ts`) exposes `style: 'clean' | 'minis'` (getter) and `setStyle(style): boolean` (false and no change while the squishy is cut or busy; the live region says "Reconnect first to change the cut style"). Default `'clean'`. Session setting, not saved. `cutBar.setPieces(...)` (task S0) also takes `style` and `canChangeStyle` so the UI can show the control.
