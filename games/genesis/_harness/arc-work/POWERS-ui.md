# POWERS-GROWTH UI ledger (stage 5) — 2026-11-16

New: `src/ui/reach.ts` (words, state, `ReachFeed`), `tests/ui-reach.test.ts`.
Edited: `ui/powers.ts` (Power fields, `applyReach`, `lockedBy/priceOf/affordable/reachShort`, `PowerBook.reach`), `ui/shell.ts` (`pollReach`, every 4 s: query `reach`, then `powers` while bound),
`ui/hud.ts` (god's card), `ui/radial.ts`, `ui/palette.ts` (three states), `ui/tools.ts` (cost line), `ui/toasts.ts` (rise/fall), `ui/settings.ts` (control),
`ui/inspector.ts` (town line, words only), `ui/controlstext.ts` (F1 row), `ui/styles.css`.

Data path: WorldView (src/client, not mine) does not carry `Snapshot.reach`, so the shell polls `query('reach')` and `query('powers')` itself.
Unbound: `reach.bound` false -> no card block, no gauge/bars, no cost lines, no costs in the palette; power fields are cleared.

Gaps / skipped:
- Strict: sim has none; the setting has two positions (Unbound / Belief bounds my power). The "Restraint" toggle is replaced; an old restraint save shows a read-only "Restraint (old save)".
- Town popover: the sim gives no per-town believers/gave, so only a words line ("They give to you in trust and in fear.") from the regard meters; `townReachLines` is ready for the counts and the extra lines (spent, trade, unseen, defiant).
- Free clay ("Free on empty ground.") and cooldown line: sim's `reachPowerView` does not know free clay; `readyAt` is carried but not shown.
- `The god` window (inspector) and the town card still show the older feared..trusted regard gauge/meters; not touched in this stage (the HUD card hides its band gauge when bound).
- Book line on rise/fall is the sim's chronicle; the card pulses (`gn-stood`), the toast is `reach.rose/fell`.

## Stint 3 (UI) — "fix all things not in build yet"
Built: (1) `living.ts` `reachBlock` (shared by HUD card and The god window; bound: standing, gauge, Trust/Fear bars, per-quality rows kept, band/regard slider gone; unbound unchanged; `GodDeps.reach`). (2) inspector town card: per-town bars + `townLines` from `SettlementView.reach` or the polled `reach.towns`, words only. (3) tools.ts asks the sim `reach.price` (120 ms debounce) for the sized price; UI formula `sizedPrice` deleted; "Free on empty ground.", "Free: the first deed in answer.", "Still gathering strength. Ready in …" from `cooldownText`; `PowerBook.markFree(freeBasics)`. (4) settings: Unbound / Belief bounds my power / Strict (`meta.reach {bound, strict}`), legacy label read-only. (5) first-run hint on the HUD card (localStorage `genesis.reach.hint`, "Got it" dismiss, no animation under reduce-motion). (6) F1 rows, `node _harness/gen-controls.ts` run.
Not done / lacking: palette/wheel use `priceNow` at default size (no per-cast size there, correct). Town card needs the mirror to carry `SettlementView.reach` else uses the 4 s poll of `reach.towns`.

## Review (rulings + UI lens), stint 3 — findings confirmed in code (probes: _harness/scratch/review3/)
- Strict -> "Belief bounds my power" does not leave Strict: settingCommand('bound') sends no `strict`, acts.ts keeps restraint when bound is unchanged (probe.ts).
- Wheel/palette/card price a power without the viewed world: shell polls `powers {}`; on an empty world they show prices/locks though the sim casts free (probe2.ts: flood 30 vs 0 on planet 1); tools.ts showCost never overrides `p.locked`.
- First deed never shows: tools.ts priceArgs passes planet only (no pos/settlement); TownReach.freeDeed unused in UI.
- Town with no counted believers (none, or never seen) falls back to townRoadWords: "They give to you in trust." while it gives nothing (probe2.ts).
- givesHalf (360 d) unused: the broken-word line shows only for the 12 days of brokenCovenant.
- Small: "1 minutes more" (reach.ts:542); reachWasBound set before the powers query succeeds; settings nulls feed.view without forcing a poll; fear bar uses --gn-feared red beside gold trust.

## Review 3 fixes (2026-11-16, fix agent) — UI
- `settingCommand('bound')` sends `strict: false` (leaves Strict). Test pin updated on purpose.
- `shell.pollReach`: `powers` asked with `reachPollArgs(primary)`; a change of viewed world polls at once. `tools.ts`: the card's line
  is `cardCostText(p, simPrice)`: the sim's `locked` / `reason` for this world, size and aim wins over the row's `p.locked`.
- First deed: `priceArgs` carries `pos`; tools `followAim` (per frame, at most every 400 ms) re-asks `reach.price` with the cursor's
  world and point, else the selected settlement. Town card: `FREE_DEED_TOWN` line from `TownReach.freeDeed`.
  WORDING NOT YET OWNER-APPROVED: "They wait for your answer; the first deed in answer costs nothing."
- Town absent from `reach.towns` (no believers, or never seen): `townAbsentLine` ("No one here gives to you yet." /
  "You have not been seen here; no one here gives to you yet."), `townRoadWords` only when the sim sent no town list. Also new wording.
- Tests: 4 new in `tests/ui-reach.test.ts`. Still open from the review list: givesHalf (360 d) line, reachWasBound ordering, fear bar colour.
