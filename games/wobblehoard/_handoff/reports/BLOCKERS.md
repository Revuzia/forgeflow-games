# BLOCKERS (final, 2026-10-10)

Scope: only what the whole-harness run (718/781) exposed. No polish, no features, no git writes. tsc clean after every edit.

## Verdict
- Real product bug in merge: none. The failure was a dev-hook x Proxy bug; a real player merges (proven with a real mouse). Fixed at the generator.
- One real honesty bug: the Cut hint promised a drag-join that fails for most first tries. Copy fixed, nothing built.
- Everything else was a stale test or a measuring artifact; re-specified with the reason in a code comment. No check loosened (44 px, cover, fit rules untouched).

## 1. hoard-loop merge row (13 -> 13, "Something went wrong", `.hmerge-scrim` stuck): FIXED
- Real pointer, no hook: Hoard -> Cushlet (2 copies) -> Merge -> "Merge anyway" -> real mouse down on `.hold-btn` 0.9 s -> ceremony -> items 11 -> 10, merges today
  0 -> 1, pad and Hoard closed, result announced; 0 console errors, 0 pageerrors. A player can merge.
- Cause: the row runs `failNextMerge('odds_changed')` first. That dev hook (debugHook.ts) does `orig = c.merge; c.merge = fake; fake: c.merge = orig` on the
  achievements observer Proxy (achievementsBinding.ts). Reading `c.merge` returns the HOOK, the write went to the raw collection (no `set` trap), so the "restore"
  put the hook on the raw collection and it called itself -> stack overflow -> caught in merge.ts -> COPY.somethingWrong. Reproduced exactly, then fixed.
- Fix: `set` trap in `observeCollection`: a hooked member (feed, openCapsule, completeTask, merge, tidy, claimRestock) is replaced in the hooks table, others go to
  the target as before (production never assigns to the wrapper). New row `probe_portal` T13.
- Proof: `--only=hoard-loop`: `13 -> 12, merges today 1`; the rows after it (24 h rest, Tidy-up, play mat x5), never reached before, now run green.

## 2. K11 / strip rows (brand "overlaps" fs / mute / tray / bar; 57 + 3 rows): MEASURING ARTIFACT, harness fixed
- Screenshots READ at 390x844, 320x568, 844x390, 568x320, 358x201, Hand and Cut: the wordmark is not drawn at any of them, nothing overlaps. `.wordmark` is
  `position:absolute; clip-path: inset(50%)` (one h1 stays in the accessibility tree, K14); `elementFromPoint` at its box returns the canvas / dock button.
- `gridProbe` and `barProbe` now skip a piece clipped to nothing (clip-path inset >= 50 %). The brand is still measured where drawn (wide; stack >= 600 px).
- Proof: toolbar-grid, toolbar-sweep, fix2-dock, fix2-tray: 91/91, and again in the final pass.

## 3. Cut pieces (carried row, 2 x A-F2 real): stale rows re-specified; hint copy fixed
- Real mouse, Split in two, 3 s, Hand: a half picks up and tosses (outer shoulder, pull outward and up); carried into the other half it bumps. Drag-join WORKS when
  the press is on the shoulder facing the other half (0.25 r): join 1.1 s in, finger still down, "Whole again."; drag and release joins at once.
- A press on the OUTER side, the MIDDLE, or 0.2 / 0.4 r outward, pulled toward the other half, joins NOTHING (4 tries): gestures.ts commits a press to a pull only
  when the first 14 px go OUTWARD from the grabbed body's centre; toward the twin from there it is a rub. Not changed (it would be a feature).
- Rows: A-F2 x2 press the seam-side shoulder that grabs THIS piece (first of 0.1..0.5 r, as cut_browser 'join'): the true-halves inner side is the cut face and the
  neighbour covers it. The bump row's first leg now leaves outward and up (it went inward = a rub, carried false). Assertions unchanged. fix1-join + feel-routes 9/9.
- Copy (cutText.ts): `barCut` = "Swipe to cut again. Reconnect all puts the pieces back together."; `handHint` (toast on returning to the Hand with 2+ pieces) =
  "Reconnect all, in the Cut tool, puts the pieces back together." You named barText only; handHint made the same promise, so both changed (no test asserts either).
- Remains: a first-time player who drags a half from its middle toward the other squishes it instead of joining it.

## 4. Stale-row triage (all stale tests; no regression)
- desktop hint: a played page shows the first-run tool line "Click a tool to try it." (hint.ts, UI.md 4.1 R10: intended). Row reads the Shift wording from
  `HINT_TEXT` and accepts the three pointer lines on one line, readable, not clipped. Fresh-page rows (HUD hint, 320x568 Shift mention) are green.
- HUD Hoard: the button is in the dock tray (owner moved it into the toolbar); row asserts `#wh-dock .dock-bar`; count text and name unchanged.
- Snap 'hidden,hidden,hidden,visible': the visible one is the BRAND (4th), not the hint (the hint IS hidden: intended). The brand is clipped now: row reports 'clipped'.
- X06: not a piece difference: the freshness rule (pay x clamp((s since last same-kind touch / 2.4)^2, 0.03, 1), wall clock). On fresh meters (`nextDay()` before
  each) both squeezes pay 0.0500, exactly equal.

## Final runs (all green)
tsc 0 errors | probe_app 183/183 | probe_uikit 62/62 | probe_boot 30/30 | probe_overlays 21/21 | probe_portal 82/82 | shellview/node_checks 130/130.
browser_shell --quick: hoard-loop, shift-pull (+desktop-boot, mouse-gestures), snap-mat, cut-x 104/104; hoard-offline, fix1-join, feel-routes, toolbar-grid,
toolbar-sweep, fix2-dock, fix2-tray, cut-real, toolbar-phone 120/120. hoard-offline U07 (offline, reconnected): both green.
Not rerun: the other ~550 whole-run rows (untouched code paths). `_harness/_reports/shell.json` and `toolbar_grid.json` now hold the last PARTIAL (--only) run.

## Files changed
src/shell/achievementsBinding.ts, src/shell/cutText.ts, _harness/probe_portal.ts, _harness/browser_shell.mjs (CRLF kept), _handoff/reports/BLOCKERS.md.
