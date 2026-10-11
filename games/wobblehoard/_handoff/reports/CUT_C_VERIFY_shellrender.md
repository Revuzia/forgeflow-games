# CUT_C_VERIFY_shellrender: independent SHELL + RENDER check of CUT3 (2026-10-09 / 10)

Verifier did not write the code. Real Chromium + SwiftShader, REAL mouse / keyboard / CDP touch for input, 960x600 and 390x844, toolbar in every picture. No game edit, no git write. The dev hook was used only to READ state, step the sim and (named below) as the Cutter's own swipe seam. Drivers and pictures: `C:\sksr\` (the scratch path is too long for a Win32 cwd): `*.mjs`, `out_*.txt`, `shots\*.png` (every picture named here was looked at). About 100 tool calls, 3 h.

## Snapshot
HEAD `ab395ac6` (14:01) holds NO CUT3 code (`src/physics/parts.ts` and `src/shell/cutProbe.ts` are untracked, 70 files modified), so I verified a point-in-time COPY of the live working tree taken 22:29 (robocopy + node_modules junction), src md5 `9EAF707A47C18ED062E39BC9181C874E`, 530 files. `tsc --noEmit` clean in it (exit 0, no output). Vite dev on 5523, preview on 5524.

## Verdict: FAIL (2 MAJOR). What the owner gets today
- Cut as much as you like: 20 Split presses make 21 pieces; Minis go 24 to 27 with no limit met; Reconnect all exact every time. DELIVERED.
- A star's SIDE tips come off, fall in 0.4 s and rest. The TOP tip slides down the face for 8 s (minor). The lower tips sit under the Cut bar at 960x600 (MAJOR M2). One swipe across several tips does NOT work (MAJOR M1).
- Table | Float is in the toolbar. DELIVERED. (Shift lock belongs to the LOCK team: not in my lens, not checked.)

## MAJOR
**M1 One swipe across several tips accepts the cut, then fails silently (U03, CUT3 2.3).** Repro `node multi1.mjs` (granulo, 960x600, `cutSwipe` seam on the probe's best 3-part line): result `cut`, then pieces stay 1, `lastParts 0`, the live region does not change ("Cut: swipe across a squishy..."), and the console shows `Error: SoftBody: the piece cannot be built (mass) at new SoftBody (softbody.ts:969) at createBody (boot.ts:152) at buildKid (cut.ts:1001)`. The same in the 42-line grid search (`multi.mjs`, 25 drawable lines: 21 `cut`: 19 made 2 pieces, 2 made 1 piece = the same failure; 4 `miss`; none made 3 or more). The gate saw the phone line refused as "too thin"; here the line is ACCEPTED and then dies with no player line. NOT done: a real-pointer repeat of that line (its drawable run is 417 px long at 960x600), the phone, other species.
**M2 The Cut bar is not in the framing's safe insets (960x600).** `hudBinding.reportInsets` counts the dock TRAY only ("not its options bar"), so the bar (top 427 to 445, 78 to 96 px tall) floats over the lowest ~15 % of the frame. Evidence: (a) granulo tips 4 and 5: the `tipSwipe` line is only 27 % drawable (cover C,C,bar,bar,bar...), a real swipe answers "Swipe across the squishy to cut it." and does not cut (`star_granulo_d960_t3_b.png`: the star's feet are behind the bar); (b) 21 and 24 pieces: the pile's base and the lower eye piece are cut off by the bar (`split_clean_dollop_d960_20_end.png`, `leave24_hoard_clean_d960_24.png`), one piece centre is below the bar top (y 438 against 427); (c) CUT3 sec 3 asks for "framing between the safe insets" and the task lens "nothing under the dock or the Cut bar". Minis at 27 clear the bar (lowest ~360 px). Phone not measured at 24.

## MINOR
- m1 Top tip of a star: the cap lands on the star and slides down its front face; it lands at 8.1 s sim (25 s run: rise 0.0002 m, speed 0, asleep); at 6 s it is still 0.49 to 0.61 m up creeping 0.17 m/s (both viewports). It is a 0.0078 crumb the same yellow as the body behind it: it reads as a sparkle patch only (`star_granulo_d960_t1_a/_b.png`, `star_granulo_phone_t3_b.png`). Side tips read well (crumb, glassy face, cyan pool).
- m2 Safety ceiling (lowered to 8 and 10 with the dev hook; a real 64 costs ~45 min: not run): Split is `aria-disabled` and the bar says "That's a lot of pieces! Reconnect some to keep cutting."; a REAL swipe is answered with that line in the live region and counted (hit 1); pressing the disabled Split (click or Enter) says nothing aloud (the reason is only the bar text / described-by). Reconnect all, then Split works again.
- m3 A pile of clean shards never sleeps: 21 pieces 1002/1002 particles awake 3 s after the last cut (24: 1008/1008). Under the 1,900 bar, but U06 "resting tiny pieces sleep" is not met by a pile; Minis at 24 are all asleep (0 awake of 1008). Frame cost is not measurable here (SwiftShader about 1 s per 24-piece frame; Reconnect all from 21 took 32 s wall).
- m4 At 390x844 the Cut bar shows icon-only buttons; no "N pieces" counter or hint is visible in the pictures (`star_granulo_phone_mid.png`); the counter text is in the DOM ("13 pieces"). Pictures only, DOM visibility not checked.

## NOTES
`loseContext` / `restoreContext` appear in the prod bundle: three.js `forceContextLoss` and the shell's `getContext('webgl2')` probe, not a render dev member. The dev `tipSwipe` ignores the lens shift on the phone (a right-arm line missed the body): harness, not product.

## Passed (measured)
| Item | Result |
|---|---|
| U01 960, real clicks | 20 presses: 21 pieces, +1 each, shares 1.000000000000 every press, bar "21 pieces" (no "of N"), eye share total 2.000 (after press 1 one eye on each half), 21 of 21 views with a face; Reconnect all 1.60 s sim, genome same, radius diff 0, frac 1, eyes [1,1] |
| U05 Minis 960 | 23 presses: 24 minis, 24 of 24 faces (48 eye shares), all asleep, smallest 0.031; 3 REAL swipes through minis of 0.031 / 0.016 / 0.015: 27 pieces, smallest 0.0068, all with faces; Reconnect all exact (1.70 s); picture: 27 dollops, two eyes each |
| X10 keyboard, 960 | Tab walk Full screen, Mute, Menu, Hoard, Hand (roving stop), ArrowRight to Cut, Enter, Tab to Split; Enter / Space x10: 10 of 10 pieces (2..11), live "Cut into N pieces." each, focus stays on Split (Reconnect all by keyboard: not finished) |
| X09 flash, normal | 516 frames (every stepped 1/60 s frame) through 10 REAL presses + REAL Reconnect all: luminance 0.0491..0.0639, 0 transitions at the 0.04 swing (bar 3 per s), max frame step 0.0063 (bar 0.012). WebGL canvas only |
| Meter | 5 cuts + Reconnect all: fill 0 to 0, credits 0 to 0, pending xp 0; a 1.2 s hold pays 0.0473 on the whole and 0.0473 on a piece |
| Table / Float | in the dock (real click: gravity false, "Floating"); 4 pieces cut in Float hover (lowest 0.24 to 0.27 m); Reconnect all in Float exact (1.30 s); Table back, body on the table |
| Leave at 24 pieces | Hoard (real click): 24 pieces to 1, Hoard open, identity same, owned 1 to 1, credits 0, extras 0, localStorage has no piece/chunk/region/cells/planes key |
| Drag join | REAL Hand drag of a far slice onto another (grab at 0.1R): "Joining 5 pieces. Whole again." 5 to 1, shares 1; Split works afterwards |
| Star arms | granulo arms: cut in 0.35 s, land at 0.4 s, rise 0.005 to 0.010 m (bar 0.06), speed 0, asleep; Split x3 after the tips: clean glassy faces, one eye each side |
| G0 / G0b | dist 1469 KB raw (bar 3072), first-play 434 KB gzip (bar 600); dev-member grep: none ship |
| Prod play, no hook | 6 REAL Split clicks: "7 pieces", "Cut into 7 pieces.", Reconnect all "Whole again."; 0 console problems, 0 CSP events (that run had no CSP header) |
| Console | 0 errors and 0 CSP events in every dev run except the M1 build error |

## Not done / not shown (do not read as passed)
Flash gate in Calm and next to a ceremony (my first Calm run died on a selector; re-queued, not finished); a real 64-piece run and the line at 64; leave paths other than the Hoard (hidden 60 s, reload, capsule, merge, quick switch) at 24; 24 clean pieces and framing on the phone; a CSP-header replay of the prod play (patched, not run); a small-group drag join (the twin piece could not be grabbed alone); the cut face on tiny crumbs (my tiny.mjs run was invalid: its swipe lines left the screen); the 12 family reps and other lobed species (constello, marigel, cushlet); frame cost at 24 pieces; keyboard Reconnect all; M1 with a real pointer. The machine was shared with other verifiers: every ms number is unusable, counts and pictures are not.

## Added at the end (390x844, CDP touch)
U05 Minis on the phone: 23 REAL taps of Split in two: 24 minis, 24 of 24 faces (48 eye shares), all asleep, smallest 0.031, no centre under the bar or off screen (x 28..361); 2 REAL touch swipes through minis (0.031, 0.016): 26 pieces, all with faces; Reconnect all exact (1.75 s sim, genome same, radius diff 0). 0 console errors, 0 CSP events.
