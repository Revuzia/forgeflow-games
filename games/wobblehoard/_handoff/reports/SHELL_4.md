# SHELL-4 report (lane SHELL; running report, updated after every finished item)

## SESSION 3, THIRD ENGINEER (2026-11-15 07:23 UTC on, after the second engineer's usage-limit cutoff and a container restart; this part wins where it differs)
Start state: HEAD 8ad72fe1, tree clean, `npx tsc --noEmit -p tsconfig.json` clean (exit 0). Scratch `SC3` (same folder as below) survived the restart.
What the second engineer left: step 1 done but 3 re-runs pending (cut-flash Calm, feel-routes, cut-real "toss a piece"); step 2 batches s1 and b4 run, **b1 run
(83/86, 3 FAIL, never looked at)**, b2 killed at its first row (`Target page, context or browser has been closed`: the cutoff), b3 b5 b6 b7 b8 never run;
steps 4 and 5 open; the seams section written against older line numbers.

### Status table (third engineer)
| # | Step | Status | Key number |
|---|------|--------|-----------|
| 1 | the pending re-runs (cut-flash Calm, feel-routes, cut-real toss) + rows written but never run (cut-x parting gap, hint-capsule name tag) + a new Cut bar row | **done** | p1 37/41 as found (1 REAL shell fault: Split in two refused at 5 pieces, fixed in cut.ts HALF_TOL + node row; 1 REAL layout fault: 390 px tier word clipped with a capsule waiting, fixed in hoard.css; 1 TEST fault: the bump row's drag path; X08 noisy) -> **41/41**; p2 37/37 (parting gap 0.179 m, toss a piece passes, Cut bar row passes) |
| 2 | b1 failures, then b2 b3 b5 b6 b7 b8 | b1 b2 b3 b5 b6 done; b7 b8 running | b1 83/86 as found -> 3 TEST faults fixed -> 49/49; b2 34/34; b3 47/47; b5 12/12; b6 15/15 |
| 3 | X01..X10 map | done (second engineer); rows added this session: Split exact halves under a turned camera (X01/X02), Cut bar line (X10) | see the map below |
| 4 | screenshots | done (judged below); fixed: 390 px tag (hoard.css); reported to RENDER: four-eyed read through a clear jelly, the bridge's tube look; KNOWN for the UI stage: 320 px tag with a capsule waiting | |
| 5 | final run + bundle | running (batch F, then probe_cut, then a vite build by hand) | node_checks 126/126; probe_app 183/183; probe_gestures 128/128 |
| 6 | seams for PLAYGROUND | done; cut.ts line numbers corrected, section 7 (lazy place code, size gate) added | |

### Log (third engineer)
- **b1 as found** (`SC3/run1_b1.log`, the second engineer's run, never read): 83/86. The 3 failures, verbatim:
  `FAIL orbit: a LEFT-button drag on empty space does NOT turn the view ... camera {"yaw":-0.020380119774794883,"pitch":0.29304747735051634} -> {"yaw":0.0032445098382566017,"pitch":0.27602354670148516}`
  `FAIL release: TWO snap SoftEvents (fingers 0 and 1), each at a high pull level ...  snap intensities 0.73 / 0.78`
  `FAIL the same drag WITHOUT Shift is a lone hand: one grab (no finger 1), the body is picked up (metrics.carried), one snap  grab finger 1 false, snap finger 1 false, snap 0.86`
  All three are TEST faults (no app code changed for them; no threshold touched):
  1. orbit: the row measured the camera's angle around the body's CENTRE; the stage's camera target follows only 0.6 of the body's offset with a 1/6 s
     lag (stage.ts 527-536), so a body still drifting after the pull's snap one row earlier read as a 0.024 rad "turn". Fix: the hook's `tools()` now also
     returns `look` = the camera's view direction from its own matrix (debugHook.ts, a test seam), which is exactly the orbit yaw / pitch; the row uses it
     (threshold 0.02 rad unchanged) and still prints the old angle. Re-run: left drag yaw 0.0000228 -> 0 (pitch 0.2700 -> 0.27), the around-the-body
     angle still drifted; the right drag still reads as a turn (mean abs diff 25.33, camera moved).
  2 + 3. test ORDER: mouse-gestures ends with a blind `wheel(0,-700)` that left the camera zoomed in (rPx 299 for a start of 210); shift-pull sizes its drag
     from rPx and the viewport, so its drag was capped at 0.98 x maxPull, under the 1.15 lift limit (the lone hand could not lift; the Shift snaps could
     not reach full level). The INPUT_SHIFT run (1.50 x maxPull) never had mouse-gestures before it. Fix: mouse-gestures puts the zoom back to its start
     (rPx within 6 %, logged), and shift-pull gets a precondition row (the drag must ask >= 1.3 x maxPull) so a capped drag can never silently test less.
  Re-run `--only=desktop-boot,mouse-gestures,shift-pull,console-and-network` (`SC3/e3_b1fix.log`): **49/49**: zoom restored rPx 210 (start 210); drag
  569 px = 1.51 x maxPull; snaps 1.00 / 1.00; the lone hand carried, snap 1.00, no finger 1.
- Found unrun at HEAD (added by the second engineer AFTER their last run of the section, so never executed): cut-x "parting gap (real physics + stage)"
  (the 0.16 m SETTLE_GAP on the real stage), hint-capsule "a capsule waiting: the name tag keeps ... whole" (the hoard.css phone fix), and no row at all
  for the Cut bar's new "Cutting… / Joining the pieces…" line. Added: cut-x row "Cut bar during Reconnect all says what plays" (reads `.cutbar-text`
  before, 0.27 s into, and after Reconnect all from six pieces). All three run in batches p1 / p2 below.
- b2 `capsule-loop,merge-dev,skip-timing,ceremony-spacing,calm-mode` (`SC3/run2_b2.log`): **34/34** (capsule-loop 49.7 s, merge-dev 6.5 s, skip-timing
  13.9 s, ceremony-spacing 7.8 s, calm-mode 63.5 s; console and network clean).
- b3 `hoard-loop,hoard-switch` (`SC3/run2_b3.log`, 315 s): **47/47** (hoard-loop 234.8 s, hoard-switch 68.6 s; console and network clean).
- b6 `hoard-meter-line` (`SC3/run2_b6.log`): **15/15** (80.8 s).
- p1 `cut-flash,feel-routes,hint-capsule,xp` (`SC3/run3_p1.log`, ~11 min): **37/41**. xp 8/8 (54.4 s). The 4 failures, verbatim (shortened where marked):
  1. `FAIL X09 real shell: ... worst 1 s window 0 transitions (2 at 0.02), luma 0.055..0.092 over 112 frames, screen light 0, cuts 4 (refused 6), joins 1,
     pieces <= 5 ...; cut@1 cut@11 cut@21 cut@31 refused@41(5 pieces 0.125+0.125+0.250+0.250+0.250: "") refused@42(...) ... refused@46(...) join@46`
     (NORMAL effects this time; the second engineer's run passed normal and failed Calm). The flash gate held (0 transitions). From 5 pieces every
     Split in two press is refused. In node (the 7g rig, real SoftBody, this genome, the same press rhythm: `SC3/probe/split5.ts`) the 5th press cuts
     every time, so the browser difference is the real camera / stage. The row's own diagnostic read the live region at once, but the announcer flushes
     on a 250 ms WALL-clock batch (announcer.ts:36), so it is always "" there: the row now records the Split button's aria-disabled / disabled at the
     press and reads the live line 320 ms after a refusal.
     **Root cause found (a REAL shell fault, src/shell/cut.ts):** reproduced in node with the camera turned as the stage frames the pieces
     (`SC3/probe/split5.ts`, pose (-1.5, 1.4, 4.2)): `cut,cut,cut,cut,small,small,...` "That piece is as small as it gets.". The halving bisection lands a
     hair off 0.5 (about 1e-4), so the cutter BOOKED the quarters at 0.2499; a 0.2499 piece cannot be halved without a piece under 1/8, the SIZE_TOL
     snap rightly refuses it (it needs the piece to be >= 2/8), and once all three quarters are a hair under, every press is refused. Under other
     camera poses one quarter happens to come out >= 0.25 and is the one picked, which is why node's default camera and the second engineer's normal
     run passed and their Calm run (and today's normal run) did not. Fix: Split in two books EXACT halves once the bisection has found the half
     (`HALF_TOL` = 0.003 on the measured fraction: the physics builds both pieces at exactly half the volume; the measured lobes differ by at most 0.6 %,
     CUT.md X02 allows 3 %); a swipe keeps the measured sizes. New node row (7g) "Split in two alone under a turned camera (-1.5, 1.4, 4.2), the cut-flash
     squishy, reaches 6 pieces ... EXACT halves": on HEAD's cut.ts it FAILS verbatim `cut,cut,cut,cut,small,small,small; 0.1250 + 0.1250 + 0.2500 + ...`,
     with the fix it passes `cut,cut,cut,cut,cut; 0.1250 x 4 + 0.2500 x 2` (`SC3/node_checks_oldcut4.log`, `SC3/node_checks_e3c.log`: **126/126**). The
     existing 7g "Split in two alone" row now reads exact shares too (`0.1250 + 0.1250 + 0.1250 + 0.1250 + 0.2500 + 0.2500`; it was 0.1251 + 0.1250 + ...).
- p1 re-run after the fix (`SC3/run4_p1.log`, frozen, source hash `73f605367511`): xp 8/8 (55.8 s); **cut-flash 2/2** (311 s): normal `worst 1 s window
  1 transitions (2 at 0.02), luma 0.054..0.095 over 218 frames, screen light 0, cuts 10 (refused 0), joins 2, pieces <= 6, end 1 piece(s)`; Calm `worst 1 s
  window 0 transitions (1 at 0.02), luma 0.053..0.089 ..., cuts 10 (refused 0), joins 2`. **feel-routes all pass** (283 s): the bump row with the fixed
  path `{"carried":true,"audio":{"lift":1,"bump":2,"land":2},"haptics":{"poke":2,"squeeze":130,"pop":5,"release":1},"vibrate":["8","5","14","6","18"]}`;
  mat body flicked lift 1 / toss 1 (speed 1) / land 1; play body the same; a chunk flicked lift 1 / toss 1 (0.957); a chunk carried into the face piece
  bump 2, pop 5; X08 `0.887 vs 1.113 ms, x0.80` (PASS). **X08 is noisy as an in-page sequential comparison**: the same row read x0.99 (second engineer),
  x1.16 (p1, FAIL) and x0.80 (here) on this shared 4-core machine; the 2-whole and 6-piece figures are taken minutes apart in different scenes, so
  machine load moves the ratio by about 18 %. I did not change the row (best of 5, threshold 1.0): its result is a proxy; the gate is probe_cut X08
  (interleaved, physics), run in the final run. **hint-capsule all pass** (58.9 s): 390 x 844 with a capsule waiting, tag "Dollop" whole and tier whole
  (`"tierClipped":false`, tag 16..126.5, Open now 262..306 = 44 px, Hoard at 157: the tag column has about 24 px to spare for longer tier words);
  the pill clears the capsule by 197.6 px; 320 x 568 stays the KNOWN row (tag 68 px). Total **41/41**.
- b5 `cut-swell,cut-low` (`SC3/run4_b5.log`, frozen, hash `73f605367511`): **12/12** (cut-swell 73.5 s, cut-low 33.5 s). cut-low: LOW quality, three swipes
  make 4, Split in two disabled, the bar and the live region say "That's as many pieces as it can make.", a 5th swipe refused by the LIMIT. KNOWN PHYS
  rows (not gated) re-measured: neck swell dollop x1.13, thudge x1.84, boingle x1.80 of the rest height (was x1.14 / x1.84 / x1.94).
- b7 `hoard-keyboard,hoard-phone,hoard-calm,hoard-offline,settings-migration,hint-timing` (`SC3/run4_b7.log`): **38/39**. The failure, verbatim:
  `FAIL U07 offline: the banner says "Offline. Your Hoard is read-only until we reconnect.", the ring says "Waiting for connection" and keeps previewing touches,
  no error toast storm  {"banner":true,"text":"Offline. Your Hoard is read-only until we reconnect.","state":"Waiting for connection","live":"Offline. ...","fill":0,"fillAfter":0,"toasts":0}`.
  A check that encodes behaviour the OWNER deliberately changed: the row showed "keeps previewing touches" with 4 quick clicks, and since commit
  2f9cc8fc (owner decision 2026-10-06, independently verified, VERIFY_ECON_NOTAP.md) a tap pays nothing anywhere, so the ring cannot move for it; the row
  had not been run since that change. **Re-specified** (written reason in the row): the touch is a real mouse press held 1.2 s of sim time (a squeeze, which
  pays), exactly as the capsule-loop row was re-specified; every other condition is unchanged. Re-run in the final batch.
- b8 `touch-phone,reflow,keyboard-only,context-loss,hidden-tab,reduced-motion,no-vibrate,storage-blocked,error-cards,url-params,lab-panel,prod-mode`
  (`SC3/run4_b8.log`): **113/114**. The failure, verbatim: `FAIL Tab order in play: Mute, Settings, the Hoard, the squishy (and no other stop)  BODY > Mute sound >
  Settings > Hoard > Toys > Squishy > BODY`. A check that predates the owner's toy tray (FUN.md 1: "one Toys button next to the Hoard button"): the Toys
  button is a real, wanted stop, after the Hoard in DOM order. **Re-specified** (written reason in the row): Mute, Settings, Hoard, Toys, the squishy, and no
  other stop (one more Tab press so a whole cycle of five is seen). Re-run after the final batch.
- game.ts: the `cut` event's doc comment (ShellEvents) claimed Split in two and Reconnect all emit it; only the swipe does (game.ts:650). Comment corrected
  (one line, so no line number moved). Source hash `73f605367511` -> `d13df909fc69` (the final source state); the only difference is that comment line.
- probe_app **183/183** (0.6 s), probe_gestures **128/128** (10.9 s) on hash `73f605367511` (`SC3/final_probe_app.log`, `SC3/final_probe_gestures.log`).
- Process fault found and fixed: the batch script ran the harness WITHOUT `WH_FROZEN=1` (vite.config.ts: no HMR, no file watch), so a source edit during
  a run could reload a page mid-section. My cut.ts edit landed while p2's cut-x ran: that cut-x result is NOT counted as final. `batches.sh` now exports
  `WH_FROZEN=1`; every later run is frozen.
- p2 `cut-real,cut-x` (`SC3/run3_p2.log`): cut-real **all pass** (318.1 s), including the re-run "toss a piece" row (the flick is sampled) and the merge
  leave row; cut-x see the final run (an edit landed mid-section). On the way, cut-x's new rows passed: the Cut bar row
  (`{"before":"That's as many pieces as it can make.","during":"Joining the pieces…","after":"Swipe across a squishy to cut it."}`) and Reconnect all
  from 6 with the bridge clear 0.67 s (every chunk 0.50 s) of a 1.20 s join.
  2. `FAIL mat body, REAL physics: carried over its neighbour, ... {"carried":false,"audio":{},"haptics":{"poke":1,"squeeze":130,"release":1},"vibrate":["8","4","18"]}`:
     a TEST fault, the same verbatim result as in the second engineer's run (they blamed the X08 ordering; reordering changed nothing). The row
     pressed the mat body's OUTER shoulder and then rose while moving 60 px TOWARD the play body, i.e. inward from the pressed point: a press-and-move
     (130 squeeze ticks), never a pull, so nothing could lift. The row has never passed. Fix: the lift goes OUTWARD 30 degrees above the horizontal for
     3 radii (1.68 x maxPull), as the section's own `flick()` does (which passes), then carries over the neighbour, holds and lets go. Threshold untouched.
  3. `FAIL X08 real (the shell's own bodies.step, contact on, physics only): 6 pieces cost no more per frame than the 2 whole squishies ... (best of 5 x 30
     frames: 1.3 vs 1.123 ms, x1.16)  {"cost2":{...,"best":1.123,"all":[1.163,1.24,1.307,1.15,1.123]},"cost6":{...,"best":1.3,"all":[1.36,1.3,1.31,1.313,1.327]}}`.
     The second engineer's run of the same row: 1.207 vs 1.223 (x0.99). The shell calls `collide(others)` once per body per step with every other body,
     which is the physics' documented usage (softbody.ts:1321-1329); the cost is the physics' (CUT.md 4: PHYS owns "6 pieces no more than 2 whole";
     the gate is probe_cut X08, interleaved). Not loosened, not hidden: re-run below and reported to PHYS if it stays over.
  4. `FAIL 390 x 844, a capsule waiting: the name tag keeps "Dollop" whole and its tier word inside the tag ... {"name":"Dollop","nameClipped":false,
     "tierClipped":true,"tag":{"x":16,...,"r":125.17},...,"open":{"x":237.17,...,"r":306},"count":"none"}`: a REAL layout fault (this row was written by the
     second engineer and never run): the word "Open" leaves the tag 109 px and the tier word is cut to "COMMO…". Fix (src/ui/hoard.css, layout only):
     from 381 to 480 px, while a capsule waits, the Open button shows its capsule pips instead of the word, as it already does under 381 px (its
     aria-label "Open a capsule (n waiting)" names it), giving the tag about 25 px. 568 x 320 and 844 x 390 passed (tag 118 px, tier whole).
- Source state of these runs: `git diff HEAD -- src index.html | sha1sum` = `68993e86d37f` (only the debugHook `look` seam differs from HEAD).
- Step 4 screenshots judged so far (read as a product designer; `_shots/shell/`):
  - `toys_tray_desktop.png`, `toys_tray_390.png`: clear. Tray titled TOYS, three tools each with a one-line purpose, the current tool filled and
    outlined, the keyboard ring visible; at 390 x 844 it sits above the bottom row, nothing clipped. (Snap's amber edge on desktop is the mouse hover.)
    The phone Toys button is an icon only and the Hoard button shows "1 of 50" without the word: understandable next to the tray, but it is the UI stage's call.
  - `snap_mat_desktop.png` (HUD hidden, Snap bar: hint line, Night / Lagoon / Dusk / Ember, Save photo, Done) and `snap_saved_photo.png` (the saved
    PNG opened: 1280 x 800, no HUD, no dev overlay, the three squishies and the table, not blank): good.
  - `cut_neck_desktop.png`, `cut4_neck_desktop.png`, `cut4_parted_desktop.png`: the bar says "Cutting…" and dims Split / Reconnect all while a neck
    plays (Done stays live); the face piece keeps the face (closed happy eyes after the parting), chunks show flat cut faces, all 4 pieces in frame.
    The waist mid-neck is shallow (a warm seam band with notches top and bottom), which is the physics / render lanes' shape, not the shell's.
  - **REPORT to RENDER (not fixed, not my lane)**: `mat_stack_desktop.png` and the saved photo: the blue squishy standing behind the orange Dollop shows
    its eyes crisp through the clear orange gel, so the Dollop reads as ONE FOUR-EYED squishy. Repro: browser_shell section snap-mat (`?dev=1&rseed=4242`,
    three on the mat, one carried onto its neighbour, 1.5 s later). Likely the transmission pass shows the opaque eyes behind a low-roughness jelly
    un-blurred; consider dimming / tinting / depth-fading eyes seen through another body. (Bodies may also overlap a little after the drop; not measured.)
  - `drag_reconnect_bridge_desktop.png` (re-taken in p2 at the let-go join, 0.25 s in) and `reconnect6_16_desktop.png` (Reconnect all from six, 0.27 s
    in): the bridge is drawn and held between the pieces; the Cut bar now says "Joining the pieces…" (Split / Reconnect all dimmed, Done live) instead
    of the stale limit line; the face piece squints happily. **REPORT to RENDER (art, minor)**: the bridges read as pale, solid, flat-lit tubes (a
    bone or a sausage) rather than a glowing gooey neck in the jelly's own colour and translucency (stage setBridge look).
  - `hint_capsule_390x844.png` (re-taken after the hoard.css fix, the phone play view with a capsule waiting and the hint pill): clear. "Dollop" and
    "COMMON" whole in the tag, the one-line hint pill above the bottom row and 197 px clear of the capsule's tap circle, the row uncrowded (tag, Hoard,
    Toys, the amber Open pill with its capsule pip, the ring with its "x1"). Trade-off stated: the Open pill now shows a capsule pip instead of the word
    on 381..480 px phones (as it already did under 381 px); the amber colour, the ring's "x1" badge and the capsule on the table carry the meaning, and
    the button's aria-label names it. The squishy sits low in a tall empty frame: the stage's framing, not the shell's.
  - `hint_capsule_320x568.png` (the pre-fix shot): with a capsule waiting, the 320 px bottom row holds five items (tag, Hoard, Toys, Open, ring), the
    tag gets about 66 px and reads "Do…". The second engineer's hoard.css fix keeps the tier word INSIDE the tag (no more running under the Hoard
    button) and drops the Hoard count. I looked for a layout-only fix that gives the name back and found none that holds: stacking Open above the
    ring needs the hint pill and the ring's status line to move up (the status line would then sit on the raised pill); a 52 px ring and tighter
    gaps win about 14 px, enough for "Dollop" but not for the longer names. Left as the KNOWN (not gated) hint-capsule row for the UI stage, which
    is queued right after SHELL-4 and redoes this row. Without a capsule waiting, phone-names proves all 50 names whole at 320 px.

## SESSION 3 CONTINUATION (2026-11-15, Linux container; the second SHELL-4 engineer; this part wins where it differs from the session-2 part below)
Machine: `/home/user/forgeflow-games/games/wobblehoard` (G), 4 cores, Chromium headless shell 1243 + SwiftShader, port 5366 (vite) and 5367 (prod-build
static server). Scratch `SC3` = `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/shell4/` (logs `SC3/*.log`).
Baseline at HEAD 1e5a1159 (orchestrator, this machine): tsc clean; node_checks 124/124; probe_app 183/183; probe_gestures 128/128.

### Status table (session 3)
| # | Step | Status | Key number |
|---|------|--------|-----------|
| 1 | run every written-but-never-run check, fix at the root | done (2 re-runs pending in the final run) | node_checks 124/124 in 10 s (7f rows pass: bend compression 0.25 / press 1.00 with, 0.03 / 1.00 without; one feed 1.4800 SP); capsule-loop 15/15 (the held-press row: ring 0 -> 0.0473); xp 8/8 after 2 TEST faults fixed; cut-x 16/17 as found (1 TEST fault, fixed) then 19/19; prod-build (portable vite.js) 8/8: 1142 KB, 0 dev strings, strict CSP boot clean; hint-capsule 4/4; phone-names 2/2; two-touch 3/3; feel-routes 5/6 + X08 (1 TEST fault of my own X08 insertion, fixed); 1 REAL shell fault found and fixed (Split in two refused at 4 pieces) |
| 2 | whole browser shell harness in batches | running | batches `SC3/batches.sh` (s1 b4 b1 b2 b3 b5 b6 b7 b8), logs `SC3/run1_*.log` |
| 3 | X01..X10 mapped | done (rows added: X04 rest shape, X05 merge, X07 health, X08 cost, X09 through the shell, parting gap) | see the map below |
| 4 | screenshots judged | in progress | found and fixed: the Cut bar's stale line during Reconnect all; the phone name tag squeezed to "Dol..." with a capsule waiting (390 x 844) |
| 6 | Seams for PLAYGROUND | written (end of this file) | |

### Step 3: CUT.md X01..X10 -> the rows that prove each one on the real physics, render and audio
(browser = `_harness/browser_shell.mjs`, real SoftBody + real stage + real audio engine in Chromium; node 7g = `_harness/shellview/node_checks.ts` section 7g, the real SoftBody through the whole game with a mock stage; probe_cut = `_harness/probe_cut.ts`, physics only; render = `_harness/browser_render.mjs` section cut, the render lane's replica of the shell's call order. **NEW** = added in this session because nothing proved it at the app level.)
| Id | Proved by (row names abbreviated) |
|---|---|
| X01 sizes | browser cut-x "X01 real: a swipe cuts ... 2 pieces" and "five REAL swipes make 6 pieces"; cut-real "a real mouse swipe ... two pieces", "Split in two twice: 4 pieces", "6 pieces at quality high"; node 7g "X01 real physics" x2 and **NEW** "Split in two alone reaches the 6-piece limit" and **NEW (third engineer)** "Split in two alone under a turned camera ... EXACT halves" (fails on HEAD's cut.ts: `cut,cut,cut,cut,small,small,small`); probe_cut X01 (the measured VOLUMES of the built pieces against their fractions, within 3 %: physics only, the browser cannot measure a volume better than the physics' own probe) |
| X02 refusals | browser cut-x "X02 real" x3 (edge "Too small", the 7th by the LIMIT with Split disabled, the smallest "as small as it gets"); cut-low (LOW: 4 pieces, the 5th by the LIMIT, bar + live region); node 5d "X02 shell" rows; probe_cut X02 (the piece built with measureCut's fraction holds it within 3 %) |
| X03 one face | browser cut-x "X03 real" x2 (stage views: 1 face + N chunks; the face piece is the play body nearest the anchor); cut-real (pieceViews 1, face on the side that held the eyes); render "CUT: a real body added with { chunk: true } is drawn without a face" |
| X04 whole again | browser cut-x "X04 real: Reconnect all from 6 pieces ends whole" and **NEW** "X04 real: whole again is the ORIGINAL" (rest-shape RMS against the snapshot taken before the first cut, genome, mesh, radius); cut-real "Reconnect all: whole again ... at the middle of the table"; node 7g "X04 real physics"; probe_cut X04 (the GROWN face piece's goal RMS < 0.002 R0: the shell does not rely on it, it swaps in a FRESH whole body) |
| X05 leave paths | browser cut-real "leaving:" rows: Hoard, quick switch, hidden 30 s keeps / 60+ s whole, capsule ceremony, **NEW** merge ceremony, reload (nothing about pieces stored); node 5d "X05 shell" x2 (switch, card preview, ceremony, hidden 61 s, Hoard never sees a piece); node 7g "X05 real physics" |
| X06 meter | browser cut-x "X06 real" x3 (six cuts + refusals pay 0, Reconnect all pays 0, a tap on a piece pays 0 and a held squeeze on a chunk pays like on the face piece: 0.0500 = 0.0500); node 7g "X06 real physics"; node 7f bendWithPress "never paid twice" |
| X07 no fold / hop / tunnel | probe_cut X07 (settle, presses, shoves at 3 m/s, determinism: physics only) + **NEW** browser cut-x "X07 real: six pieces on the real mat, settled" (finite, every lowest particle <= 1 mm, no centre inside another's skin) |
| X08 cost | probe_cut X08 (the gate: physics, interleaved) + **NEW** browser feel-routes "X08 real" (a noisy sequential proxy: x0.99, x1.16 FAIL, x0.80 in three runs on this machine) (the shell's own bodies.step with contact: 6 pieces vs the 2 whole squishies on the mat in the same page, best of 5 x 30 frames, physics only); the render lane's frame-budget readout (KNOWN OPEN x1.32..x1.45 of its 1.5 bar) |
| X09 flash gate | render "CUT X09" (stub and real body in the shell's call order) + **NEW** browser section cut-flash: 10 rapid cuts and Reconnect all THROUGH src/shell/cut.ts, normal and Calm (luminance transitions in any 1 s, screen light); it also caught the Split-in-two refusal at 5 pieces (fixed: HALF_TOL), and now reads 10 cuts / 0 refused in both modes |
| X10 keyboard | browser cut-x "X10: keyboard only" (C, Tab, Enter, live-region lines, Done, no trap); toys-tray rows (T, arrows, Enter, Escape); keyboard-only section; **NEW (third engineer)** cut-x "Cut bar during Reconnect all says what plays" (the visible line, not the live region) |

### Session 3 log
- `node _harness/shellview/node_checks.ts` -> `124/124 shell-core node checks passed` (10.3 s; `SC3/node_checks_1.log`). The 7f rows (CALIBRATION.bendWithPress) and the 7g real-SoftBody cut rows all pass on this machine.
- `node _harness/browser_shell.mjs --port=5366 --only=capsule-loop,xp,console-and-network` (`SC3/s1a_capsule_xp.log`): 22/24. capsule-loop 15/15 in 51.8 s, the held-press row verbatim: `ok meter: a real held press (squeeze, 1.2 s) moves the ring ... 0 -> {"fill":0.0473...}`. xp: 2 failures, both TEST faults:
  - `FAIL XP: letting go banks it: ... bank null; fill 0.0000 -> 0.0983 (+9.8% of the ring)`. Cause: the ring's `data-bank` marker is transient (meterRing.ts bankPending sets 'paid' and a 900 ms WALL-clock timer clears it); 4 stepped slices of SwiftShader frames after the let-go take longer than 900 ms, so the read afterwards found nothing. Fix (test only): a MutationObserver logs every value the marker takes; the row reads that log (it would still fail on 'none' or on no bank at all). Threshold untouched.
  - `FAIL xp: section ran to the end  Too many arguments. If you need to pass more than 1 argument to the function wrap them in an object.` Cause: `squeezeHold` passed two arguments to page.evaluate (Playwright takes one). Fix: pass `[b, frames]`.
  - Re-run `--only=xp,console-and-network` (`SC3/s1a_xp_2.log`): **10/10** (xp 8/8 in 62.7 s): bank `paid`, arc 9.7 % vs banked 9.8 %, squeeze sparks +6, ring moved 11.7 %, Calm: no sparks, soft glow, fill 0.2150 -> 0.2650.
- `--only=cut-x,console-and-network` (`SC3/s1b_cutx.log`, 6 min 17 s): **16/17**. Passing on the real physics: X02 edge refusal; X01 2 pieces by swipe (0.871 + 0.129); X03 one face (stage views 1 face + 1 chunk, the face nearest the anchor); 6 pieces by 5 real swipes (0.34 + 0.132 + 0.138 + 0.129 + 0.131 + 0.129, 1 face + 5 chunks); the 7th refused by the LIMIT in words; the smallest refused ("That piece is as small as it gets."); X06 nothing paid; X04 whole from 6; **the held bridge: some chunk's skin clear of the face piece 0.63 s (every chunk 0.53 s) of the 1.20 s join** (was 0.02 s as found in session 2); the near-twin hold does not join (rest gap 0.10 m); let-go-while-touching joins; X06 piece squeeze 0.0500 = face 0.0500 of the ring, tap 0; X10 keyboard only. The failure verbatim:
  `FAIL reconnect by DRAGGING a piece into another and holding it there: ... {"cut":"cut","touch0":-1,"join0":0.63,"drag":1.2,"holdBeforeJoin":null,"pieces":1}`. Cause: a TEST fault: the row sampled the skin gap every SECOND frame; the cutter checks every sim step and keeps a running contact while the skins stay within TOUCH_KEEP_GAP (0.09 m), so the one frame under TOUCH_GAP (0.03 m) was missed and touch0 stayed -1 while the join had started by itself. Fix: the row samples every frame (the join itself happened, the squishy was whole again: pieces 1).
- Step 3 rows added (see the X01..X10 map below), then `--only=cut-x,cut-flash,console-and-network` (`SC3/s1b_cutx_2.log`, 12 min 28 s): **23/25**. cut-x **19/19** (drag-to-reconnect now `touch0 0.22, join0 0.63, holdBeforeJoin 0.41`; new X07 row: 6 pieces finite, lowest particle 0 mm on every piece, 0 centres inside another; new X04 row: rest shape RMS **0** R0 against the snapshot before the first cut, same genome, 642 = 642 vertices, radius ratio 1, frac 1, not a piece build). cut-flash (new, X09 through the real shell) 0/2, verbatim:
  `FAIL X09 real shell: ... worst 1 s window 2 transitions (2 at 0.02), luma 0.055..0.106 over 189 frames, screen light 0, cuts 7 (refused 3), joins 2, pieces <= 6, end 1 piece(s) {"total":1,"faces":1,"chunks":0}` and the Calm one `worst 1 s window 1 transitions ... cuts 7 (refused 3)`.
  The flash gate itself HELD (2 and 1 transitions, no screen light). The failing part was `cuts 7 (refused 3)`: a **real shell fault**, not the test: Split in two (the accessible, keyboard path) was refused at 4 pieces with "That piece is as small as it gets." while its button was on. Cause: the cut goes through the piece's CENTRE and measureCut is exact for the current, never-symmetric shape: a quarter measured 0.498 (and 0.26 / 0.24 when pressed rapidly while the pieces still wobble), so a half came to 0.1245 of the whole, under the 1/8 rule. Fix (src/shell/cut.ts): (1) Split in two means halves by volume: `halvingPoint` slides the plane along its normal until measureCut reads 0.5 (bisection, 12 measures per press); (2) a side within `SIZE_TOL` = 0.003 of the 1/8 limit is snapped exactly onto it (sizes stay within 2.4 % of the measure, CUT.md X02 allows 3 %; the shares still sum exactly; no piece is ever under 1/8; an edge cut that really is too small, e.g. 0.028, is still refused). New node row in 7g ("Split in two alone ... reaches the 6-piece limit", presses one frame after each parting): on the OLD code it FAILS verbatim `cut,cut,cut,small,small,small; 0.2529 + 0.2471 + 0.2600 + 0.2400`; with the fix it passes `cut,cut,cut,cut,cut; 0.1251 + 0.1250 + 0.1251 + 0.1251 + 0.2499 + 0.2498` (node_checks **125/125**, `SC3/node_checks_3.log`).
- Batch s1 `--only=cut-flash,feel-routes,hint-capsule,phone-names,two-touch,prod-build,console-and-network` (`SC3/run1_s1.log`, 913 s): **43/45**.
  - cut-flash: X09 normal PASS `worst 1 s window 0 transitions (2 at 0.02), luma 0.055..0.093 over 218 frames, screen light 0, cuts 10 (refused 0), joins 2`. X09 Calm FAIL `... worst 1 s window 0 transitions ... cuts 9 (refused 1) ... cut@132 refused@142`: the flash gate holds again; one rapid press at 5 pieces was refused (the reason was not logged). Fix: the halving bracket widens (0.3 / 0.6 / 1.0 of the radius) for a piece that has just parted and is still lopsided, a plane past the skin counts as 0 / 1 instead of giving up; the row now logs the live-region line of any refusal. Re-run pending.
  - feel-routes: 5/6 + the new X08 row. PASS, the real engine spied: mat body flicked `{"carried":true,"audio":{"lift":1,"toss":1,"land":1},"toss":{"speed":1},"haptics":{"poke":2,"release":1,"pop":3},"vibrate":["8",...,"18"]}`; play body the same; a chunk flicked `lift 1, toss 1 (speed 0.96)`; a chunk carried into the face piece `bump 2, pop 5`; **X08 6 pieces 1.207 ms vs 2 whole 1.223 ms per frame (x0.99)**. FAIL `mat body, REAL physics: carried over its neighbour ... {"carried":false,"audio":{},"haptics":{"poke":1,"squeeze":130,"release":1}}`: a TEST fault of my own X08 insertion: `matStepCost` advances the physics 2.5 s, and I had put it AFTER the bodies' screen spots were read, so the press landed on a stale spot (a squeeze, nothing carried). Fix: the cost is read first, then 1 s of steps, then the spots. Re-run pending.
  - hint-capsule 4/4: the pill clears the capsule's tap circle by 16.7 px at 568 x 320 (without the slide -22 px), 26.5 px at 844 x 390 (-12 px), 197.6 px at 390 x 844, 63.2 px at 320 x 568. phone-names 2/2 (all 50 names, none clipped, smallest 17 px at 390 and 320). two-touch 3/3 (two touches: stretch 0.33, carried false on 395 frames, both snap 1.00; one touch and a lone mouse lift). prod-build 8/8 (vite.js run by process.execPath: build OK, **1142 KB** (gate 1228.8 KB), 0 of 10 dev strings in 7 files, 0 inline, strict CSP boot: 0 violations, no hook, 0 console errors).
- Screenshot finding fixed (step 4, `_shots/shell/hint_capsule_390x844.png`, `..._320x568.png`): with a capsule waiting the Open button joins the phone's bottom row and the name tag was squeezed to "Dol..." with "COMM" running on UNDER the Hoard button. Fix (src/ui/hoard.css, layout only): on a phone (<= 480 px) the Hoard button drops its "1 of 50" count while a capsule waits (`.hud-bottom:has(.capsule-btn:not([hidden]))`), and the tier word is cut off inside the tag with an ellipsis. New hint-capsule row: name whole, tier inside the tag, tag clear of Hoard / Toys / Open (gated above 380 px; at 320 x 568 the five-item row leaves the tag about 66 px, which no layout-only change fixes: a KNOWN row that reports it for the UI stage).
- Batch b4 `--only=toys-tray,snap-mat,cut-real,toys-phone,console-and-network` (`SC3/run1_b4.log`, 607 s): **49/50**. toys-tray 9/9, snap-mat 11/11 (PNG `squish-keeper-kneadle-2026-11-15.png`, 1366006 bytes, 1280 x 800, sd 38.7, shutter peak 0.28), toys-phone 8/8, cut-real 13/14 including the NEW merge leave row (`{"k3m":{"r":"cut","pieces":2},"tm":{"p":1,"x":0,"tool":"hand"}}`). The failure verbatim:
  `FAIL toss a piece: ... {"carried":false,"grabbedBody":1,"lift":1,"toss":1,"land":1,"kinds":["land","poke","release","grab","snap"],"pieces":2}`. A TEST fault: `audio.lift` fired (it fires only on the rising edge of the physics' `metrics.carried`), the toss and the land followed, still two pieces; the row sampled `carried` during the pull but not during the 6-frame flick, where this carry began. Fix: the flick is sampled too. (The session-2 engineer had fixed this row's grab point but never re-ran it.)
  Checked against my Split-in-two change: cut-real's "Split in two twice" now reads `[0.353, 0.176, 0.176, 0.294]` = a swipe's 0.706 / 0.294, then the 0.706 halved to 0.353 + 0.353, then one 0.353 halved to 0.176 + 0.176.
- Screenshot finding fixed on the way (step 4, `_shots/shell/reconnect6_16_desktop.png`): during Reconnect all from six pieces the Cut bar still said "That's as many pieces as it can make." over the pieces flowing back. The bar now says what plays: "Cutting…" during a neck, "Joining the pieces…" during a join / Reconnect all (Cutter.activity, cutBar.setPieces 4th argument; the live region is unchanged).

Branch claude/exciting-faraday-2dakqx, local HEAD f01e476d at start. Nothing committed by this engineer (the orchestrator commits).
Scratch: `SC` = `C:\Users\TestRun\AppData\Local\Temp\claude\C--Users-TestRun-AppData-Roaming-Claude-scratch-workspaces-10f6a62c-5610-424a-ba29-8c51dbde9f88-b3ecf43b-de12-4070-80de-e1daecc887bf-scratch-2026-10-06-8a5967\3b1103ab-0174-4d88-adc9-dd448a718f0d\scratchpad\shell4\` (logs `SC\*.log`, filmstrips `SC\base_film`, `SC\new_film`).
As-found snapshot of HEAD (for before-numbers): `C:\Users\TestRun\AppData\Local\Temp\vs4\games\wobblehoard` (HEAD + my debugHook.ts; node_modules is a junction: remove with `cmd /c rmdir`).

## Status table (running)
| # | Step | Status | Key number |
|---|------|--------|-----------|
| 0 | baseline (as found) | measured | tsc clean; node_checks 114/114; probe_app 183/183; probe_gestures 128/128; probe_cut 17/17 in 621 s (logs `SC\base_*.log`) |
| 1 | portable harness, capsule-loop row, xp section | edits done, NOT yet run | prod-build runs vite.js with process.execPath; capsule-loop row is a real held press (ring must be 0 before) |
| 2 | whole browser shell harness in batches | not started | |
| 3 | Cut tool on the real physics, X01 to X10 | in progress | as-found: Reconnect all bridge visible ~0.05 s (surface gap 0.023 m at the start, -0.23 m after 0.07 s, -0.48 m after 0.12 s; wrigglo, 1280x800); parting gap 0.005 .. 0.03 m (slime strand = short thick band, see `SC\base_film\sheet_base_wrigglo.png`). Fix written: held bridge gap (cut.ts flowOf / flowD / follow), SETTLE_GAP trial 0.16 |
| 4 | lift / toss / bump routed + haptic, spied on the real engine | in progress | lift had NO haptic: now a tick (feedback.ts liftNow); dev hook spyStart / spyCalls (call-through spies on the real engine + haptics); harness section feel-routes written, not yet run |
| 5 | CALIBRATION.bendWithPress decision | rows written, not yet run | node_checks 7f (through the whole game on the real SoftBody) |
| 6 | UI faults (meter line, long names, hint pill) | in progress | hint pill: slides clear of the capsule's tap circle (hudBinding.ts avoidCapsule + CSS --hint-dx); sections hint-capsule, phone-names written, not yet run |
| 7 | two touches never lift (gesture-level) | section two-touch written, not yet run | |
| 8 | screenshots judged | not started | |
| 9 | final run + bundle | not started | |

## As found: the four never-run SHELL-4 browser sections on the committed tree (HEAD snapshot, `SC\asfound_shell4_sections.log`; port 5367)
`node _harness/browser_shell.mjs --port=5367 --only=toys-tray,snap-mat,cut-real,toys-phone`: **38/39 passed** (toys-tray 9/9 in 37 s; snap-mat 11/11 in 135 s; cut-real 12/13 in 354 s; toys-phone 8/8 in 51 s). The one failure, verbatim:
`FAIL toss a piece: a chunk pulled past 1.15 x maxPull is carried (lift), thrown on the let-go (toss) and lands; still two pieces  {"carried":false,"lift":0,"toss":0,"land":0,"kinds":["poke","release","grab","snap"],"pieces":1}`
Root cause (a TEST fault, fixed at the root in the harness, no threshold touched): the check pressed the chunk's shoulder that FACES the face piece; on that ray the nearer body is the face piece, so the finger pulled the face piece a little and let go while touching the chunk, which is a join (pieces 1, nothing carried). The check now grabs the chunk's OUTER shoulder (away from the face piece), pulls away from it, and also reports which body was grabbed.
Checks that already proved themselves with the real physics and stage as found: the real mouse swipe cutting a real SoftBody into two pieces (blade drawn, neck busy, shares 0.662 + 0.338, cut start + separate sounds), Split in two x2 -> 4 pieces, 6 pieces all in frame, Reconnect all whole at the middle of the table, drag-to-reconnect (the chunk dragged onto the face piece and held, a rejoin sound), the mat bump (`carried true, lift 1, toss 1, bump 1` from the physics' own events), a real PNG from Snap (1367919 bytes, 1280x800, sd 39: not blank), every leave path (Hoard, quick switch, hidden 30 s keeps / 60 s reconnects, capsule ceremony, reload). Weakness found in them: the "6 pieces ... a 7th cut is refused in words" row accepted `small` as the 7th result (`r7 small`), so it never proved the LIMIT line; the new cut-x section proves it with the biggest piece's middle (limit) and the edge (small) separately.

## Step 3 measurements so far (real shell, real physics, real stage; `SC\film_real.mjs`, 1280x800 high, wrigglo = slime; gaps are the SURFACE gap between the pieces' skins along the line of centres, from the dev hook pieceGaps)
| what | as found (HEAD, SETTLE_GAP 0.06) | now (held bridge + closed-loop parting gap 0.16) |
|---|---|---|
| parting: gap 0.12 / 0.24 / 0.42 / 0.72 / 1.12 s after the parting | 0.005 / 0.010 / 0.032 / 0.001 / 0.009 m (a short thick curl between touching pieces: `SC\base_film\sheet_base_wrigglo.png`) | 0.196 / 0.201 / 0.182 / 0.156 / 0.138 m (a long gooey thread, snaps at about 0.6 s: `SC\new_film\sheet_ctl_wrigglo.png`) |
| Reconnect all (2 pieces): time the skins are apart (bridge drawn) | 0.02 s (gap 0.023 m at the start, -0.23 m after 0.07 s, -0.48 m after 0.12 s) | 0.50 s (gap 0.039 at 0.02 s, peak 0.109 m at 0.28 s, closes at 0.52 s, whole at 1.22 s) |

## Known PHYS issue, reproduced once in the real shell (section cut-swell, `SC\live_b1_cutx.log`; high quality, 1280x800; highest particle of the squishy or its pieces during the cut, sampled every 0.05 s)
| species (family) | rest top | highest point | x rest | when |
|---|---|---|---|---|
| dollop (gel, control) | 1.01 m | 1.15 m | x1.14 | +0.317 s |
| thudge (putty) | 0.97 m | 1.79 m | **x1.84** | +0.417 s |
| boingle (firm silicone) | 0.76 m | 1.47 m | **x1.94** | +0.467 s |
Not papered over: the shell does not clamp, hide or reframe it (the render lane's headroom stopgap in stage.ts framingFor is the only mitigation). PHYS owns neckGoal (softbody.ts).

## Node rows run once on the live tree (`SC\nodechecks_run1.log`: 123/124 on the first run; the one failure was my own new haptics row, whose assumption was wrong, see below)
- 7f CALIBRATION.bendWithPress, through the whole game on the real SoftBody, dome-top press held 1.3 s: with the bend compression 0.25 / press 1.00, without it compression 0.03 / press 1.00; one release event each (intensity 1.00 / 1.00), one release sound, one release in the stats, one squelch voice; the meter holds 1.4800 SP, which is exactly one feed of that release into a fresh collection (1.4800 SP): never paid twice. **Decision: KEEP the bend** (a flat dome press still reads compression 0.03, about 0, so without it the toy only dents instead of squashing into the table); the row is a guard: it fails the day the flat press reads 0.1 or more.
- 7g the Cut tool on the REAL SoftBody through the whole game (mock stage): X01 0.501 + 0.499; the chunk steered to a 0.163 m surface gap 0.5 s after the cut and let go after SETTLE_S; X06 sp 0 -> 0; second cut 0.251 + 0.250 + 0.499; X04 Reconnect all ends in a FRESH whole SoftBody (frac 1), 148 setBridge calls, skins apart 0.78 s of the 1.2 s; X05 a switch of squishy while cut reconnects first.
- First-run failure verbatim: `FAIL SHELL-4 haptics: the lift plays a light tick (haptics.poke, once) ... plain: tick 2, thump 1; shift: tick 1`. Cause: the real body reports a `poke` SoftEvent when a pull starts (every pull has one tick), so the Shift pull that never lifts has 1 and the lone pull 1 + the lift's. The row was my own (new) and is re-specified to what is true: the lift adds exactly ONE tick (plain 2 minus Shift 1) and the throw's snap one thump.

## Log
- Read COMMON, RESUME, SHELL, NOTES_FOR_SHELL_CUT, CUT.md, FUN.md, LOCK.md s2, INPUT_SHIFT, VERIFY_INPUT_SHIFT, RENDER_R, VERIFY_RENDER_B_R1; read cut.ts, toyTray.ts, snapBar.ts, cutBar.ts, game.ts, bodies.ts, mat.ts, feedback.ts, feel.ts, hudBinding.ts, debugHook.ts.
- Step 1 edits in `_harness/browser_shell.mjs`: (a) prod-build: `spawnSync(process.execPath, [node_modules/vite/bin/vite.js, 'build', ...])`; (b) capsule-loop row "meter: a real poke moves the ring" is now a real mouse press held 1.2 s of sim time (the hook pauses and steps while the real button is down) and asserts the ring was 0 before.
- Source edits so far (all inside my lane): `src/shell/debugHook.ts` (spyStart / spyReset / spyCalls, pieceGaps(at), faceAnchor, stageViews, tools().body.top), `src/shell/cut.ts` (JOIN_S 0.5 -> 0.8, BRIDGE_HOLD_S 0.3, BRIDGE_GAP_K 0.3, flowOf / flowD / follow, SETTLE_GAP), `src/shell/feedback.ts` (liftNow: lift tick), `src/shell/hudBinding.ts` + `src/ui/styles.css` (hint pill avoids the capsule).
- Harness: browser_shell.mjs new sections cut-x, cut-low, feel-routes, hint-capsule, phone-names, two-touch; node_checks.ts: haptics row on the plain pull, 7f calibration rows.

## Seams for PLAYGROUND (step 6; file:line at the end of this session; verify before you build, lines move)
PLAYGROUND (`_handoff/design/DIRECTION.md`: places, a LIFE brain per character, social emotes and voices, pieces that join in quietly, a quest Journal)
is built on this shell. Where each part plugs in, what already exists, and what is fragile.

### 1. The frame: where a per-frame LIFE host goes (src/shell/game.ts)
- One sim step is `simStep` (game.ts:548-562), in this order: `gestures.update` -> `driver.flushPendingUps` -> **`bodies.step(dt)`** (551: every body
  in contact calls `collide(others)`, then every body steps) -> simTime / stepCount -> `driver.notePress` -> **`drain()`** (555: every body's SoftEvents
  to feedback and the collection) -> `timers.run` -> `feedback.update` -> **`cut.update`** (558) -> `capsules.update` -> `ceremonies.update` -> the
  `onStep` hooks (561). The rAF loop (`frame`, 572) and DebugHook.step (`stepOnce`, 774) both run it, so the harness steps LIFE deterministically
  for free when LIFE is inside it.
- Put the LIFE host in **as its own line in simStep**, built in `createGame` next to `mat` (403) and `cut` (413): `life.perceive()` after `drain()`
  (555, so it sees this step's touches and bumps), its intents applied (moveTo / nudge / hop through the physics, look / emote through the stage)
  before the NEXT `bodies.step`. Do NOT hang the brain on `game.onStep` (831): those hooks run after the capsules and ceremonies, are UI listeners
  (hudBinding.ts:199, 224, 329) and their order is registration order.
- The player always wins: a finger on a body = `driver.touch.contact()` (passed to the cutter as `touching`, game.ts:417) and `activeBody()`
  (338: the body the fingers act on; `pickBody` 445 changes it only between touches). LIFE must also stand still for that body while `cut.busy`
  (cut.ts owns moveTo then), while `ceremonies.active` (`inputLive`, 605) and while any pause reason holds (`reasons`, 315).
- Key a brain by the squishy's identity (item id; a piece by its index in `cut.fracs()`), never by the SoftBodyLike object: a cut REPLACES the play
  body with a new face-piece body (cut.ts:321 `swapTo(..., silent: true)`), and whole-again swaps in a FRESH body (`swapWhole`, cut.ts:376-385).

### 2. A place and party manager (mat.ts, bodies.ts, game.ts)
- The party IS the play mat: `mat.add` (mat.ts:107-126) builds each squishy at the stage's `matLayout(n)` spot (`offsets`, 77-84) in the play body's
  world space (`createBody(g, { at })`, boot.ts:111-112) when the physics has contact; `refusal` (100-106) counts cut pieces against `MAT_LIMIT`
  (22: 3 / 4 / 5 by quality) and refuses `busy` above `FRAME_BUSY_MS` (24: 30 ms frame EMA). Grow the party through `MatItem` (26) and `add`,
  not a second list: the cutter, the ceremonies and the Hoard all clear / count the mat through it (`outs` 86 excludes pieces).
- Travel to a place = a LEAVE path (CUT.md rule 2): call the same `leaving()` (game.ts:425-428: release every finger, `cut.reconnectAll(false)`)
  before anything is swapped, then `mat.clear()` (136), then the stage's place change, then the party back with `mat.add`. `switchNow` (679-686)
  is the model.
- New characters are `bodies.addExtra(b, g, { shared: true })` (bodies.ts:135-143); `removeExtra` (144); `setGhost` (166) takes one out of
  contact; contacts are rebuilt only on change (96-102) so `step` (171-175) allocates nothing. Sleep / lighter background bodies (D7) can be
  skipped in `step` once the physics exposes a flag.
- **`stage.setBody` clears every view** (bodies.ts:112) and `commit` re-adds only the extras (115): anything else drawn per body (emote bubbles,
  props tied to a body view id from `viewIdOf`, 160) must be re-attached in `afterSwap` (game.ts:362-371) or live in the stage by itself.

### 3. A quest host: the typed events that exist today
- `game.on(type, fn)` (game.ts:826-830), `ShellEvents` (139-160): `interaction`, `settings`, `identity` (a switch, never a cut), `mute`, `phase`,
  `meter` (MeterReading), `capsuleReady` (credits), `message`, `ceremony` (start capsule|merge / reveal / end with RevealInfo), `paused`,
  `notice` (polite text lines), `gain` ({ kind, sp, x, y }: a touch PAID), `tool` (hand|cut|snap), `blade`, `cut` (CutResult | 'joined').
- `game.onStep((dt, simTime) => ...)` (831), `game.onRelease` (832); `game.recentEvents()` (757: the last 32 SoftEvents of the ACTIVE play body);
  `hoard.onChange` / `collection.onEvent` (400, 459); `mat.onChange` (mat.ts:143).
- SoftEvent kinds per body come through `drainBody` (game.ts:516-540): poke, press, release, land, grab, snap, bump (contracts.ts:37-52; `finger`
  is 0 / 1, -1 for land).
- **Missing, add them (additive, typed) before a quest needs them**: `cut` is emitted only for a SWIPE (game.ts:650); Split in two and Reconnect
  all from the bar call the cutter directly (hudBinding.ts:242-243) and emit nothing; "cut into N", "joined", "whole again" exist only as notice
  TEXT (cut.ts:336, 354, 362, 573) and lift / toss / bump only inside feedback.ts (197, 186-189, 146-152); Snap's save only as "Photo saved." in the live
  region (hudBinding.ts:301). A quest must never parse notice text: add one typed `play` event (a kind union: cut / joined / whole / lift / toss /
  bump / photo / matAdd / travel ...) emitted at those lines.

### 4. New panels (hudBinding.ts, src/ui)
- Buttons: the bottom-centre row is `hud.slot` (hudBinding.ts:96: Hoard, Toys, the mat chip). At 320 and 390 px it is already full (sections
  toys-phone, phone-names measure it): a Journal / Travel entry belongs in the Toys tray (`createToyTray`, 95; `ToolId` toyTray.ts:7; `toolsNow`
  97; `TOOL_LINES` 306) or the top bar, not a 4th button in that row.
- A panel follows the Hoard's pattern: `createHoard(root, createHoardEnv(g, ...))` (88-92) with `holdInput` (game.ts:819: input held away from the
  stage while open) and `cover` (`suspend('covered')`, hoardEnv.ts:113-114) for a full sheet on a phone; add it to the Escape chain
  (hudBinding.ts:375-382: tray, settings, Hoard, tool, plate).
- Live region: `announcer.say` (62) for every quest line; game lines arrive as `notice` (189).
- New top / bottom HUD rows must be reported to the stage through `reportInsets` (124-142), or the capsule lands under them.
- Do not hang per-character DOM (emote bubbles) on the 250 ms timer (369: the play target, the hint pill's capsule avoidance 351, Snap's tint):
  bubbles belong to the stage (one draw), not to DOM nodes repositioned on a timer.

### 5. Feedback with many characters (feedback.ts): where the attention budget goes
- ONE feedback instance serves every body. `handle` (116-194) plays sound, haptics, shake and FX for EVERY drained event of EVERY body: a land on
  each of 5 squishies and 6 pieces hopping by themselves would each play `audio.land`, dust and a screen shake (153-158). The D4 budget belongs
  in front of `handle`'s outputs (or in `drainBody` before `feedback.handle`, game.ts:528), keyed by "a finger caused it" vs autonomous.
- Per-body state (lift edge, strand, velocity for the toss) exists only for the ACTIVE body (`d.body()`, 119 / 203; reset by `resetBody`, 273,
  on every pick). Bump is already rate-limited (one haptic per `BUMP_HAPTIC_GAP_S` 0.12 s, 70; the audio engine limits `bump` itself).
- Voices and emotes are not SoftEvents: give them their own channel that draws on the same budget; do not route them through `handle`.

### 6. Fragile: must not break
1. **No idle income.** `drainBody` feeds every event of every body to `collection.feed` (game.ts:533); poke / release / snap pay. LIFE must move
   squishies only with `moveTo`, `nudge`, `tremble` or a physics hop (they make land / bump, which never pay), never through the finger API
   (press / grab / pointer), and a quest reward must go through bounded one-time grants, not the feed. A row to add: one autonomous minute with
   5 squishies leaves the meter at exactly 0.
2. The Shift pull's second hand (game.ts:527-529 and feedback `twin`) is one touch: keep the twin skip.
3. Zero allocation per step: listener arrays are copy-on-write (279-287, `onStep` 831), `evBuf` is reused (319), the debug ring is preallocated (321-323).
4. Every body swap goes through `leaving()` first (switchNow 683, setGenome 694, focusInstance 788, ceremonies' beforeStart 381); the cutter's
   own swaps are `silent` (no identity event, no history note).
5. cut.ts owns `moveTo` on pieces while it necks, joins, holds the parting gap (SETTLE_S) and glides home: anything else steering a piece then fights it.
6. `inputLive` (605): input only in play, no ceremony, no holds; the Cut and Snap tools take the pointer first (614-615).
7. The dev hook stays out of production: `debugHook.ts` is imported only behind `import.meta.env.DEV` (boot.ts), and the prod-build row greps the
   bundle for its strings (browser_shell.mjs FORBIDDEN). New test seams go into debugHook.ts only.
8. Determinism: the harness steps the game with DebugHook.step; a LIFE brain that reads wall time or Math.random breaks every stepped check.

### 7. Lazy place code and the size gate (DIRECTION D5 / D9; added by the third engineer)
- The model for a module that must not weigh on the first load is already in boot.ts: the engine modules are dynamic imports (boot.ts:95-97) and
  the dev tools are imported only behind `import.meta.env.DEV` (boot.ts:187-189). A place's render / audio module should be a dynamic import made
  by the travel path (after `leaving()`, before the stage's place change), awaited behind a short "getting there" state with input held
  (`holdInput`, game.ts:819), never a static import from game.ts or hudBinding.ts.
- The prod-build row (browser_shell.mjs, section prod-build) measures the WHOLE dist against the old 1.2 MB gate (G0, browser_shell.mjs:3432) and greps
  every emitted file for dev strings. D9 splits that into a first-load budget (1300 KB) and a whole-build budget (2000 KB): that row has to learn
  which files the entry page pulls in before play (the entry chunk plus its static imports) before PLAYGROUND adds any lazy chunk.
