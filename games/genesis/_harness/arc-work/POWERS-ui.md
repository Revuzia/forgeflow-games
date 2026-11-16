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
