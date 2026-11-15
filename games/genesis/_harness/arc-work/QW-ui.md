# QW-ui ledger (quick wins, UI lane)

| # | item | status | files | test |
|---|------|--------|-------|------|
| 2 | babel card, icon, premise | done | src/ui/newworld.ts (CARDS), src/ui/icons.ts (`tower`) | tests/ui-newworld-babel.test.ts (cards() of the picker; no DOM render, the repo has no DOM harness for NewWorld) |
| 5 | reduceMotion seeded from prefers-reduced-motion on first run | done | src/ui/prefs.ts (`seedFirstRun`, `systemPrefersReducedMotion`) | tests/ui-prefs-motion.test.ts |
| 6 | screenshot key Shift+F8, PNG at canvas size + header strip; 4 fixed shots in protocol | done | src/ui/shot.ts, keybinds.ts (`ui.screenshot`), shell.ts, CONTROLS.md (regenerated) , _harness/arc-work/MAC-TEST-PROTOCOL.md | tests/ui-shot.test.ts (header, file name, binding) |
| 7 | one line on power card where wrath scales harm | done | src/ui/powers.ts (`wrathScaleLine`), src/ui/tools.ts (renderNeed) | tests/ui-prefs-motion.test.ts |
| 8 | regard chip: popover on a focusable ?, F1 row | done | src/ui/living.ts, styles.css, controlstext.ts | tests/ui-regard-popover.test.ts |
| 9 | settings copy; Disasters toggle disabled until query answers; edgePan + slowGreat on Game tab | done | src/ui/settings.ts, styles.css | none (no DOM harness for Settings) |
| 11 | toasts: heading map, no "Custom", cap two | done | src/ui/toasts.ts, shell.ts | tests/ui-toasts-headings.test.ts |
| 16 | free text not understood: investigated only | done (report) | none | probe in scratchpad |

## #16 findings
Parser says "I don't know how to do that yet — did you mean "X"? Here is what I can do…". UI shows the lead line, a "Nearest:" chip row, a
"What can I do?" toggle; Go disabled; Enter shows "Those words do not reach a power yet". Problems: the parser's did-you-mean for
nonsense is junk ("asdf qwerty zzz" -> "ash", "blorptastic quantum banana" -> "manna", "hello" -> "hill") and becomes the first, highest-scored
chip. "be kind to Aru" resolves to wrath gentle 0.1 (sim lane; owner ruling: the god is neither kind nor unkind). "make it rain frogs of gold on the moon"
resolves to "Selene turns gold" (silent partial parse; the preview line shows it before sending).
