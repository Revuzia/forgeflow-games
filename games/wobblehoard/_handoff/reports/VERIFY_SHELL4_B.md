# VERIFY_SHELL4_B: independent verification, SHELL lens B (tray, Snap, UX, accessibility)

**VERDICT: FAIL** (one MAJOR: Snap's drag-to-turn and pinch do not work with real pointer input; 8 MINOR; notes). Everything else in the lens passed.
Date 2026-10-07. Verifier: lane SHELL lens B, task VERIFY-SHELL4-B. Port 5374. Nothing under `src/` was edited; no git write command was run; nothing was committed.

## Build verified
- Snapshot `C:\Users\TestRun\AppData\Local\Temp\vsb\games\wobblehoard`, made by `tools\snap.mjs` from the LIVE tree: HEAD `fa9206fd` plus the engineer's UNCOMMITTED edits (`src/ui/hud.ts`, `src/ui/hoard.css`, `src/ui/styles.css`, `_harness/browser_shell.mjs`, `SHELL_4.md`; `package-lock.json` is not theirs).
- **snapshotHash `7a7d5bef276c6ae2`** (252 files, `identical: true`). At the end of my run `diff -rq live\src snapshot\src` printed nothing: the verified `src/` is still exactly the live `src/`.
- `node_modules` in the snapshot is a directory junction to G's (read only). tsc in the snapshot: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` printed nothing, exit 0 (run at the start, and again at the end with my two config files present: still nothing, exit 0).
- Two files I ADDED to the snapshot root (not `src/`): `vite.verify.config.ts` (the game's config with a private optimizer cache dir, so my dev server never touches the shared `node_modules/.vite`) and `vite.patch.config.ts` (a SIDE EXPERIMENT, see F1: one in-memory source transform; the verified build is the unpatched one).
- My scripts: `C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967\3b1103ab-0174-4d88-adc9-dd448a718f0d\scratchpad\verify\shell4_b\scripts\` (`lib.mjs`, `t0_seed` to `t13_stack`, `runharness.mjs`), logs in `..\logs\`. Run them with `cd C:\Users\TestRun\AppData\Local\Temp\vsb_out` first (node fails with the long scratch path as cwd).
- Screenshots and the saved PNGs: `C:\Users\TestRun\AppData\Local\Temp\vsb_out\` (names below). All browser runs used real Chromium 145, SwiftShader WebGL, the real game at `?dev=1`, real mouse, real keyboard and CDP touch events. The page has a seeded practice collection (`seed.json`: 7 capsules opened with `?rseed=4242`, 5 squishies in the quick switcher).

## What passed (numbers)
| Check (VERIFY.md lens B) | Script | Result |
|---|---|---|
| 1. Tray, desktop, mouse + keyboard: Hand, Cut, Snap only (no Stamp, Roll), open / close, T, arrows, Home / End, Enter, Space, Escape, outside click, Tab and Shift+Tab leave it (no trap), focus to Hand on open and back to the Toys button on close or pick, shortcuts off, role=menu of menuitemradio | `t1_tray_desktop.mjs` | 33 ok / 1 FAIL (M1) |
| 1. Layout at 1280x800, 390x844, 844x390, 568x320, 320x568 in 6 states each (play, tray, Cut, Cut with 2 pieces, Snap, Hand again): no horizontal scroll, nothing off-screen, no control covered, no HUD overlap | `t2_layout.mjs` | 149 ok / 1 FAIL (568x320 tray over the wordmark: N3) |
| 1. Reduced motion: tray, bars have no transition or animation; Snap shutter `display:none`. Calm effects: shutter `display:none`, Save works | `t3_snap.mjs` | ok on desktop and phone |
| 2. Snap: HUD hidden (`visibility:hidden`), snap bar, focus on Save, waiting capsule put away and back, tints (Night, Lagoon, Dusk, Ember: soft-light overlay, no pointer events, radio keys), Save gives ONE real PNG (double click makes 1 download), Done restores the HUD, nothing paid | `t3_snap.mjs desktop` / `phone` | desktop 27 ok / 2 FAIL (F1, M2); phone 24 ok / 2 FAIL (F1 drag, F1 pinch) |
| 2. Saved PNG opened and judged | `vsb_out\t3_desktop_photo_lagoon.png`, `t3_desktop_photo_night.png`, `t3_phone_photo_lagoon.png` | real PNG (signature `89504e470d0a1a0a`), desktop 1280x800 1.33 MB equals the canvas, phone 390x844 445 KB (the `low` tier buffer under software GL); clean frame, eyes, sparkles, no HUD, no bars, no dev overlay; 319 to 335 distinct colours, black fraction 0.002 to 0.04; Lagoon is a soft edge vignette: corner delta 88 to 90, centre delta 0 |
| 3. Meter status line vs the Hoard shelf and card | `t5_meterline_names.mjs` | 10/10 hidden or clear at 5 sizes (the owner's item: fixed) |
| 3. Long species names (Rattlebead, Cindergoo, Constello) on the name tag at 5 sizes | `t5_meterline_names.mjs` | 15/15 fit, none clipped, smallest font 17 px, tag clear of its neighbours |
| 4. Keyboard only: Tab order Mute, Settings, Hoard, Toys, 5 switcher buttons, play target, back out (11 stops, every stop has a visible ring, none off-screen); Cut by keyboard (Tab 2 stops to Split in two), Split x3, limit hands the focus to Reconnect all; Snap by keyboard; Escape | `t4_a11y.mjs` | 18 ok / 2 FAIL (M3, M4) |
| 4. Contrast of every text in play, tray, Cut bar, Snap bar | `t10_contrast.mjs` | all enabled text >= 6.93:1 (AA 4.5); disabled "Reconnect all" 4.01 (exempt) |
| 5. Title checks: `.title-mark` = `SQUISHKEEPER`, h1 and `.wordmark` = `SQUISH KEEPER`, one h1 in play | `t6_title_qs.mjs` | ok at all 5 sizes |
| 5. 5-squishy quick switcher: labelled group, 5 buttons "Play with X, Tier", >= 44 px, one tap switches (name tag + live line follow), `]` switches, hidden under the Cut tool | `t6_title_qs.mjs` | 47 ok / 1 FAIL (my check counted the 5th button at 320 px, CSS hides it: N4) |
| Keyboard orbit and zoom in Snap | `t7c_snapkeys.mjs` | arrows turn (dyaw -0.721), `+` zooms (3.063 to 2.248): desktop has a keyboard way |

## Findings

### F1: MAJOR. Snap's drag-to-turn and pinch-to-zoom do not work with real pointer input
In Snap a real right-button drag, a real middle-button drag and a real one-finger touch drag turn the camera by 0.000 rad, and a real two-finger pinch does not zoom. The control (the same drag, same page, same start point, with the Hand tool) turns it by 2.9 rad (mouse) and 1.17 rad (finger). The same drag sent through the debug hook (`__WH__.pointerDown/Move/Up`, which calls the input port directly) turns it by 3.49 rad, so the engineer's hook-driven checks cannot see it. The wheel (desktop) and the arrow keys (desktop) still work; a phone has no way to turn or zoom in Snap, although the Snap bar says "Drag to turn (right-drag with a mouse), pinch or scroll to zoom" and the live line says "Snap: drag to turn the camera". FUN.md names "turn the camera" as one of Snap's four jobs.
- Repro: `cd C:\Users\TestRun\AppData\Local\Temp\vsb_out && node <scripts>\t7b_snapdrag.mjs` (log `logs\t7b.log`):
  `desktop CONTROL Hand tool, RIGHT-button drag: dyaw 2.908` / `desktop RIGHT-button drag #1: dyaw -0.000` / `FAIL desktop: right drag #1 turns the view  0.000` / `FAIL desktop: middle drag turns the view  0.000` /
  `phone CONTROL Hand tool, ONE finger: dyaw -1.169` / `phone ONE finger: dyaw -0.000` / `FAIL phone: a one-finger drag in Snap turns the view  0.000` / `desktop via the debug hook (input port): {"dyaw":-3.49...}`. `t3_snap.mjs` shows the same (`FAIL Snap (mouse): a RIGHT-button drag turns the view`, `FAIL Snap (touch): a one-finger drag turns the view`, `FAIL Snap: pinch zooms in  5.309 -> 5.302`).
- Cause (read from the code, then proved by experiment): `src/input/pointer.ts` line 36 forwards a `pointermove` to `app.input.pointerMove` only `if (app.input.isDown(e.pointerId))`; `src/shell/game.ts` line 669 defines `isDown: (id) => gestures.isActive(id)`; in Snap (line 615) and Cut (line 614) `input.pointerDown` returns BEFORE `gestures.pointerDown`, so the pointer is never "down" and every move goes to the hover branch.
- Proof that this is the whole cause: `vite.patch.config.ts` applies ONE line in memory (`isDown: (id) => gestures.isActive(id) || snapDrag.has(id) || (blade !== null && blade.id === id),`, no file under `src/` edited). With it (`logs\t7b_patched.log`): desktop right drag -3.707 and 2.451 rad, middle drag -3.840, phone one finger -1.170 and 5.113 (desktop 7 ok, phone 5 ok, 0 FAIL); the left drag still turns 0.000 (the owner's rule holds); the Cut blade follows (F2).
- Not tested by the engineer: the `snap-mat` section checks the HUD, tints, Save and Escape; no section drags in Snap with real events. Suggested new row: a real mouse right drag and a real CDP finger drag in Snap must change the camera yaw by > 0.1.
- (`hover alone does not turn the view  0.077` in `t7b` is camera easing from the control orbit before it, identical with and without the patch; ignore it.)

### F2: MINOR. The Cut blade line does not follow the pointer (same cause as F1)
A real swipe draws the blade as a zero-length dot at the START point for the whole drag: `svg.blade .blade-line` end at 60% of the drag is `668.5,85.5` (the start point is `668,86`; wanted about `688,453`); phone `205.3,230.3` (start `205,230`; wanted `225,454`). The cut itself works (it uses the pointer-up position: `a real swipe across the whole body cuts it into 2 pieces` ok on desktop and phone). With the F1 patch the line follows (`687.7,453.2`, `224.5,454.4`).
Repro `t7_realdrag.mjs` (log `logs\t7.log`): `FAIL desktop: the blade line FOLLOWS the pointer while dragging`. The engineer's `cut-real` row only asks that `.blade` is not `display:none`.

### U1: MINOR. On landscape phones the Cut bar and the Snap bar sit over the squishy
Share of each body's on-screen disc covered by the bar (`t8_cover.mjs`, log `logs\t8.log`): Cut bar, whole squishy: 1280x800 0%, 390x844 0%, 844x390 **39%**, 568x320 **62%**, 320x568 20%. Cut bar after a split (each piece): 0% / 0%, **54% and 62%**, **76% and 78%**, **54% and 64%**. Snap bar: 0%, 0%, **33%**, **54%**, **36%**. On 844x390 the Cut bar hides the faces and the lower halves of both pieces; at 568x320 the pieces are mostly behind the bar and the user cannot see what a swipe will cut. The saved PNG is always a clean frame. (The 25% bar in the script is my own, not an owner number.)
Screens: `t2_phoneL_3cut2.png`, `t2_tiny_3cut2.png`, `t2_phoneL_4snap.png`, `t2_tiny_4snap.png`, `t2_narrow_4snap.png`; clear at 390x844 and 1280x800: `t2_phone_3cut2.png`, `t2_desktop_4snap.png`.

### U2: MINOR. The meter's status line peeks out from behind the tray and the Cut bar on phones
The owner's item was the status line under the Hoard card (fixed, 10/10). The same defect remains for the new surfaces. With the everyday line "Squishies are resting, filling slowly" (shown after any capsule is earned; `t12_resting_line.mjs`, log `logs\t12.log`: 3 ok / 7 FAIL): tray open: PARTLY covered at 390x844 (rect `[262,705,374,764]`), 568x320, 320x568; Cut bar open: PARTLY covered at 390x844, 844x390, 568x320, 320x568; clear at 1280x800.
Screens: `t12_phone_cut_resting.png` (a dark tail of the line's pill under the bar's edge), `t12_tiny_tray_resting.png` ("sting, filling slowly" beside the tray), `t5_phone_1_offline_tray.png` ("for / ion" fragments at the tray's right edge), `t5_phoneL_2_offline_cut.png` ("Waiting for connection" cut in half by the bar's edge).
Fix idea: hide the line while the tray is open or a bar is up (`body[data-toys="open"] .meter-state, body[data-tool="cut"] .meter-state { visibility: hidden }`), as `hoard.css` line 445 already does for the card.

### U3: MINOR. The tray is usable during a capsule reveal
`T` (`keyboard.ts` guards the `C` key with `app.input.live === false`, not `T`; `boot.ts` line 146 `onToys` checks only the Hoard) and a click on the Toys button open the tray over a running ceremony; picking Cut puts the Cut bar over the reveal; a "Split in two" pressed during the reveal is applied to the NEW squishy when the reveal ends. Measured (`t11_edge.mjs`, log `logs\t11.log`): `T during the ceremony: trayOpen true, cer capsule`; `Toys clicked during the ceremony: trayOpen true`; after the reveal `tool cut, pieces 2`; live line `New! Dimpla, Common. Cut into 2 pieces.`. No console error and the state stays consistent (Reconnect all works). Fix: ignore the tray while `g.ceremonies.active`. Screens: `t13_desktop_ceremony_plus_cutbar.png` (the Cut bar over the reveal), `t13_desktop_ceremony_plus_tray.png`, `t13_phone_ceremony_plus_tray.png`, `t13_desktop_after_ceremony.png`.

### U4: MINOR. With Settings open, `T` stacks the tray on top of it
`{"settings":"true","tray":true}` (`t11_edge.mjs`, `t13_stack.mjs`). On a phone the tray lies over the Settings sheet and hides its controls ("Louder squish", "Feel"): `t13_phone_settings_plus_tray.png` (desktop: `t13_desktop_settings_plus_tray.png`). The Hoard case is guarded (`hoard open: tray false`). Needs a keyboard, so rare on a phone.

### M1: MINOR. The Settings "Keys:" line and the "Keyboard shortcuts" hint do not mention `T` or `C`
`Keys: Tab to the squishy · Space pokes · arrows look around · + / − zoom · G gravity · M sound · H Hoard · [ ] switch squishy · Shift + drag pulls both sides · right-drag turns the view · Esc closes`; row hint `G gravity, M sound, H Hoard, [ ] switch squishy.` (`src/ui/settingsPanel.ts` lines 84 and 104). Repro `t1_tray_desktop.mjs`: `FAIL Settings "Keys:" line mentions T (toys) and C (cut)`.

### M2: MINOR. `T` during Snap opens the tray INVISIBLY
With nothing focused in Snap, `T` opens the tray although `.toys` is `visibility:hidden` there: `{"open":true,"vis":"hidden","exp":"true"}`; the first Escape then closes that invisible tray instead of leaving Snap. Repro `t3_snap.mjs desktop`: `FAIL T during Snap does not leave an invisible open tray`. Same cause as U3 (`onToys` not gated).

### M3: MINOR. After Save photo by keyboard the focus falls to the page
`snapBar.ts` `setSaving` (line 110) sets `disabled` on the focused Save button, and a disabled button drops the focus: `document.activeElement` is `body` afterwards. The Cut bar's own comment names this problem and uses `aria-disabled`. Repro `t4_a11y.mjs`: `FAIL focus stays on Save photo after saving  body`.

### M4: MINOR. "Reconnect all" is silent for a screen reader when Skip animations is on
`cut.ts` `reconnectAll` (line 486) takes `finishAll(false)` when it is not animated, which calls `whole(false, ...)` (no line); only the animated path says "Whole again." (line 542). Same flow, measured (`t9_reconnect_live.mjs anim` / `skip`): animations on: `["Cut into 2 pieces.","Whole again."]`, `["Whole again."]`, `["Whole again."]` (5 ok / 0 FAIL); Skip animations on: `["Cut into 2 pieces."]`, `[]`, `[]` (2 ok / 3 FAIL). The engineer's X10 row ("Reconnect all (Enter: Whole again.)") runs with animations on.

### Notes (no action needed for the verdict)
- N1: on a phone the Toys button is icon-only, a star, accessible name "Toys, Hand in hand"; the star reads as "favourite" (the engineer lists it for the UI stage). `t2_phone_0play.png`.
- N2: the Snap hint says "(right-drag with a mouse), pinch or scroll" on a touch phone too (mouse wording on touch).
- N3: at 568x320 the open tray (300 x 223) covers the wordmark's right half and most of the screen (`t2_tiny_1tray.png`); it is a transient popover.
- N4: at 320x568 the quick switcher shows 4 of 5 buttons (CSS `max-width: 359px` hides the 5th) and the Hoard button drops its count and is 42 x 44 px.
- N5: the dev overlay (`?dev=1` only) stays visible over Snap; it is not in a production build.

## What the engineer's report did not test (read after my first pass)
- Snap's camera turn and pinch with real events (F1) and the Cut blade line's end point (F2): their rows use the debug hook or only `.blade` display. Their "473/473" cannot catch either.
- The status line against the tray and Cut bar (U2): the `hoard-meter-line` row measures only the Hoard card, and only with the offline text.
- Tray and Cut bar on the landscape phones (U1) and during a ceremony (U3), Settings + T (U4), T in Snap (M2).
- Keyboard focus after Save (M3) and the Reconnect-all line with Skip animations (M4); X10 is measured with animations on.
- Their re-specified rows ("keyboard-only Tab order" now Mute, Settings, Hoard, Toys, Squishy; "hoard-offline keeps previewing" now a held 1.2 s press) have honest written reasons and are not loosened thresholds: I measured the same order (Toys is a deliberate new stop), and a tap pays nothing by the owner's decision.

## Engineer's own harness sections re-run on the snapshot (regression cross-check)
`node _harness/browser_shell.mjs --port=5374 --quick --only=desktop-boot,toys-tray,snap-mat,toys-phone,hoard-meter-line,phone-names,hint-capsule,hoard-switch,hoard-phone,reflow,keyboard-only` against my vite (log `logs\harness_lensb.log`). **Result: `106/106 shell browser checks passed`, exit 0** (the harness's own `console-and-network` section was not in my list; my scripts t1, t2, t3, t4, t6, t7, t7b, t7c, t9, t11 and t13 each ended with a passing `0 console/page errors` check, t1 and t3 also `0 failed/bad requests`; t5, t8, t10 and t12 did not check) (11 sections: desktop-boot 61 s, hoard-switch 425 s, toys-tray 144 s, snap-mat 472 s, toys-phone 280 s, hint-capsule 455 s, phone-names 2460 s, hoard-meter-line 715 s, hoard-phone 312 s, reflow 428 s, keyboard-only 159 s; the machine ran at 99 to 100% CPU from other agents, so the times are long). No regression of any previously passing check in these sections: the findings above are gaps the harness does not test, not harness failures.

## Not checked (say so, do not round up)
- No real device, no real GPU (SwiftShader only), no real screen reader (the live-region TEXT was read from the DOM, not spoken), no iOS or Android browser, no pen input, no forced-colors or high-contrast mode, no 200% text zoom.
- Snap with 2 to 5 squishies on the mat (the engineer's `snap-mat` does it); the photo's resolution on a real phone GPU; sounds and haptics (nobody listened).
- The whole browser harness, the production bundle (the dev-only strings) and the Cut tool's X01 to X10 are lens A's job (`VERIFY_SHELL4_A.md`); I only re-ran the sections listed above.
- The prod-build section on port 5375 was not run (not in this lens).
- I did not fix anything: F1's one-line fix was proved in memory only.
