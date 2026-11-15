# SHELL-4 report (lane SHELL; running report, updated after every finished item)

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
| X01 sizes | browser cut-x "X01 real: a swipe cuts ... 2 pieces" and "five REAL swipes make 6 pieces"; cut-real "a real mouse swipe ... two pieces", "Split in two twice: 4 pieces", "6 pieces at quality high"; node 7g "X01 real physics" x2 and **NEW** "Split in two alone reaches the 6-piece limit"; probe_cut X01 (the measured VOLUMES of the built pieces against their fractions, within 3 %: physics only, the browser cannot measure a volume better than the physics' own probe) |
| X02 refusals | browser cut-x "X02 real" x3 (edge "Too small", the 7th by the LIMIT with Split disabled, the smallest "as small as it gets"); cut-low (LOW: 4 pieces, the 5th by the LIMIT, bar + live region); node 5d "X02 shell" rows; probe_cut X02 (the piece built with measureCut's fraction holds it within 3 %) |
| X03 one face | browser cut-x "X03 real" x2 (stage views: 1 face + N chunks; the face piece is the play body nearest the anchor); cut-real (pieceViews 1, face on the side that held the eyes); render "CUT: a real body added with { chunk: true } is drawn without a face" |
| X04 whole again | browser cut-x "X04 real: Reconnect all from 6 pieces ends whole" and **NEW** "X04 real: whole again is the ORIGINAL" (rest-shape RMS against the snapshot taken before the first cut, genome, mesh, radius); cut-real "Reconnect all: whole again ... at the middle of the table"; node 7g "X04 real physics"; probe_cut X04 (the GROWN face piece's goal RMS < 0.002 R0: the shell does not rely on it, it swaps in a FRESH whole body) |
| X05 leave paths | browser cut-real "leaving:" rows: Hoard, quick switch, hidden 30 s keeps / 60+ s whole, capsule ceremony, **NEW** merge ceremony, reload (nothing about pieces stored); node 5d "X05 shell" x2 (switch, card preview, ceremony, hidden 61 s, Hoard never sees a piece); node 7g "X05 real physics" |
| X06 meter | browser cut-x "X06 real" x3 (six cuts + refusals pay 0, Reconnect all pays 0, a tap on a piece pays 0 and a held squeeze on a chunk pays like on the face piece: 0.0500 = 0.0500); node 7g "X06 real physics"; node 7f bendWithPress "never paid twice" |
| X07 no fold / hop / tunnel | probe_cut X07 (settle, presses, shoves at 3 m/s, determinism: physics only) + **NEW** browser cut-x "X07 real: six pieces on the real mat, settled" (finite, every lowest particle <= 1 mm, no centre inside another's skin) |
| X08 cost | probe_cut X08 (the gate: physics, interleaved) + **NEW** browser feel-routes "X08 real" (the shell's own bodies.step with contact: 6 pieces vs the 2 whole squishies on the mat in the same page, best of 5 x 30 frames, physics only); the render lane's frame-budget readout (KNOWN OPEN x1.32..x1.45 of its 1.5 bar) |
| X09 flash gate | render "CUT X09" (stub and real body in the shell's call order) + **NEW** browser section cut-flash: 10 rapid cuts and Reconnect all THROUGH src/shell/cut.ts, normal and Calm (luminance transitions in any 1 s, screen light) |
| X10 keyboard | browser cut-x "X10: keyboard only" (C, Tab, Enter, live-region lines, Done, no trap); toys-tray rows (T, arrows, Enter, Escape); keyboard-only section |

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
  body with a new face-piece body (cut.ts:313-321 `swapTo(..., silent: true)`), and whole-again swaps in a FRESH body (`swapWhole`, cut.ts:374-384).

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
  TEXT (cut.ts:334, 352, 360) and lift / toss / bump only inside feedback.ts (197, 186-189, 146-152); Snap's save only as "Photo saved." in the live
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
