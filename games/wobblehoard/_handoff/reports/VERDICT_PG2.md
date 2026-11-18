# VERDICT_PG2: independent re-verification of PLAYGROUND after round 5 (2026-11-18)

Verifier: independent; wrote no file in `src` or `_harness`, ran no git write command. Two verifiers in turn: the first ran parts A, B, the sizes and the
node probes (22:31 to 00:05 UTC) and was cut off by a container restart while writing; the second (this file) read every log and the key screenshots,
re-ran only what was missing or ambiguous (one "Go play with..." run, one frame-cost run), and wrote the verdict.

- Tree under test: HEAD **559efebe4**. The tested copy `pg_verify3/snap` was a8fa3de13 plus three then-uncommitted files that are now committed;
  `diff -rq snap/src G/src` is **empty**, `index.html`, `vite.config.ts` and `public` are identical, `_harness` differs only in the generated
  `_harness/_reports/probe_softbody.json`. So every result below holds for 559efebe4. Built in the copy: `vite build` 0.53 s, [G0] 2417 KB of 3072,
  [G0b] 462 KB gzip of 600; `tsc --noEmit` exit 0 (3.7 s).
- Published reference: `_live_snapshot/2026-11-16` (15 files OK against `SHA256SUMS`), served statically. Control for B1: the first verdict's tree cae532c34.
- Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify3/` (below `S/`): `scripts/`, `logs/`,
  `shots/`, `probes_new/` (`summary.txt` ends with ALLDONE). Ports 5374 (new, static), 5375 (live, static), 5376 (vite dev of the copy, `?dev=1`), 5377 (control).
- Note on screenshots taken with `?dev=1`: the small dark stats box at the top left is the dev overlay. It sometimes lies over the first line of a card
  or pill. That is a test artefact, not a finding.

Status: FINAL (00:50 UTC). Nothing of mine is left running (`ps` for headless_shell, vite, _harness, serve.mjs: empty).

## Verdict

| Part | Verdict | One line |
|---|---|---|
| A. No regression against the published game | **PASS** | every published step returned ok on both builds at 1280x800 and 390x844; saves cross both ways with nothing lost; a cut with one squishy out is identical; 0 console errors, 0 page errors, 0 failed requests |
| B. PLAYGROUND as the owner asked | **PASS (with MINOR findings)** | the BLOCKER (B1) and the MAJORs B2 and B4 are fixed; B3 and B5 are fixed in what mattered and their rest is MINOR; one new MINOR (N1 "Go play with..." at Home on the med tier) |
| C. Performance and download | **PASS** | first play +59.2 KB raw / +20.8 KB gzip against live (inside the 70 KB delta); `later-life` 145.4 KB raw, under its 150 KB cap (C1 fixed); frame cost see C |
| D. Node probes | **FAIL (no regression)** | 40 probes run; 7 have failing rows: 5 fail identically on the published PC tree; on this tree only, LF-02 (allocation) and two DT-01 layout-guard rows that measure B5 and B8 |

**Ready to ship as a first update (Home + Hearthlog Cabin): yes**, because no BLOCKER and no MAJOR is open: the split-squishy-after-travel BLOCKER is
gone in 12 of 12 trips (gap at most 0.018 m against 3.57 m on the control), a cut keeps the party, the Places sheet lists only shipped places, a wish
now shows a visible card and the tracker pill gives direction, and nothing published changed (part A). What is left is MINOR polish: the ball still
overlaps the squishy's edge on a phone, the cabin's tall layout puts the Rocker Board under the hint pill, "Go play with..." can lose to the awake
budget on the med tier, blank postcard art. The D failures are an allocation bar and two layout guard rows, not crashes or regressions. Audio has never
been listened to (see the end of this file).

## A. No regression (PASS)

- Same script, same seed (`S/scripts/arun.mjs`, seed `S/logs/seed_live_2dollops.json`), live and new at 1280x800 and 390x844 (`S/logs/A_{live,new}_{desk,phone}.out`,
  `runA.summary`: 4 of 4 rc=0). Every step ok on both builds: title, Wake, poke, first squeeze ("Bronze trophy: Hello, Squishy."), first stretch, 8 to 9
  holds earn a capsule, open it, the Hoard (Shelf, Gift with the same three daily choices, Today), merge, Cut ("Cut into 2 pieces. Bronze trophy: Clean
  Cut."), Reconnect all, Snap ("Photo saved."), lock on desktop ("Locked in place." / "Let go. Silver trophy: As Far As It Goes."), Float / Table,
  Settings, Trophies, the keyboard walk. Storage keys at the end: live `v2:play, v1:settings, v2:hoard, v1:ach, v1:profile`; new the same plus `v2:journal`.
- Differences, all expected or explained: the new build adds the Journal, "Your squishies" and tracker controls, three settings rows (Voices, Place
  sounds, "Squishies move on their own"). Capsule and merge results are random on both builds (new desktop got a Tier up, so 9/20 trophies against 8/20).
  "Five soft pops in a row" ended 3/5 and 4/5 on new against 5/5 on live, the frame-rate effect the first verdict explained (SwiftShader clamps a frame to
  1/20 s). One live phone run spoke "Whole again." and the new one did not. A targeted re-test (`S/scripts/crun.mjs`, `S/logs/C_{live,new}_phone.out`: cut and reconnect twice)
  gives the same line sequence on both builds, with "Whole again." and "Bronze trophy: Whole Again." on both.
- **A cut with ONE squishy out is unchanged** (`S/scripts/cut1.mjs`, 6 successive cuts, then Reconnect all; `S/logs/CUT1_{old,new}_desk.out`):
  pieces 2, 3, 4, 5, 6, 7 on both builds, particles 1284 / 966 / 648 / 810 / 972 / 1014 on both, fractions equal to 0.001, the same live lines, Reconnect gives 1 piece of 642
  particles and "Whole again." on both; screenshots `S/shots/CUT1_{old,new}_desk_pieces.png`. Part A's own cut step matches the live build on both sizes.
- **Saves cross both ways** (`S/scripts/savetest.mjs`, `S/logs/S_A0..A4.out`, stores `S/logs/store_A*.json`): A0 live save on live, A1 the same on new:
  same squishy (Dimpla), "Hoard, 2 of 50 species", the same shelf, Trophies 8/20, the same settings, ghosts `g-f8olq3:2, g-ufjr4m:13`. A2: the new build switches autonomy off
  (settings written `v: 3, autonomy: false`). A3: that save on live (the rollback) loads with 8 trophies, the same hoard and settings, and live keeps the unknown `autonomy` field.
  A4: back on new, autonomy is still off and nothing is lost. `wobblehoard:v1:profile`, `:settings` and `:ach` all survive both ways.
- Every A, S, CUT1, C and REQ run: 0 console errors, 0 page errors, 0 failed requests, 0 HTTP errors.

## B. PLAYGROUND (PASS with MINOR findings)

Runs: `S/scripts/pg2.mjs` (desktop and phone, dev hook, real taps; `S/logs/P2_r1_{desk,phone}.{out,json}`), `ghost5.mjs` (B1), `extra.mjs` (budget on low,
"Go play" with autonomy on and off, the empty swing; `S/logs/X_r1_desk.out`), `goplay2.mjs` (`S/logs/GP_r1_desk.out`), `b6.mjs` (two fresh profiles;
`S/logs/B6_p{1,2}_desk.out`), a toast and moment timeline on the phone (`S/logs/TM_r1_phone.json`), and my re-run `goplay3.mjs` (quality high; `S/logs/GP3_r1_desk.json`).

### Old findings

| Id | Was | Now | Evidence |
|---|---|---|---|
| B1 | BLOCKER: a squishy asleep at Home is drawn in two places after a trip | **FIXED** | `ghost5.mjs`, 3 on the mat with 2 asleep before every trip: the control tree cae532c34 split 3.57 m on trip 1 (jelly centre against eyes), and 0.54 / 0.85 m on trips 2 and 3. New build: 6 trips on desktop and 6 on the phone, alternating Home and the cabin, worst gap **0.018 m** (desktop) and **0.015 m** (phone). Also through the wish card's "Let's go" with 2 asleep: gaps 0 to 0.026 m. I looked at `S/shots/B1_old_desk_trip1_5s.png` (red jelly on the basket without eyes, a glowing orb with eyes on the right) against `B1_new_desk_trip1_5s.png` and `B1_new_phone_trip5_5s.png` (three whole squishies). |
| B2 | MAJOR: a cut sends the party to the shelf | **FIXED** | 5 out, cut: mat 5 before, **5 after the cut**, Reconnect all: 1 piece, 5 characters, 5 wholes, mat 5, on both sizes. No "went back on the shelf" line. At most 2 bubbles at a time (desktop), 1 (phone). `S/shots/P2_r1_desk_cut_party_after.png` (4 others still out beside the two halves), `P2_r1_phone_reconnect.png`. |
| B3 | MAJOR: no wish card, tracker pill, name-tag popover, party toolbar, "Who's coming?", Snap shutter | **PARTLY (rest MINOR)** | Built and working on both sizes: the **wish card** (tap "A wish: I want to go somewhere": "Dollop wishes for a warm place: Hearthlog Cabin.", then "Let's go" (44 px tall) and "Not now"; "Let's go" travelled in 19.2 s on desktop and 11.5 s on the phone), the **tracker pill** ("Next: A big stretch", "Next: Cozy by the fire · 0 of 2", the x button 44x44, a tap opens the Journal), the **name-tag popover** ("Your squishies" chips for each squishy out, "Go play with..." for every thing of the place; "Dollop goes to play with the Pillow Swing.", and Dollop is on the swing within 2 s). Screens: `P2_r1_{desk,phone}_wish_card.png`, `P2_r1_{desk,phone}_popover.png`, `A_new_phone_cut_done.png` (pill). NOT built (declared in FIX5_SHELL.md section 4): "Tap it yourself", the party toolbar of focus proxies, Enter on the focused squishy, "Who's coming?", the Snap shutter and preview. The owner's ask 5 (visible direction in play) is now met, so what is left is MINOR. |
| B4 | MAJOR: Places lists 8 unshipped places "coming later" | **FIXED** | Places shows "9 of 25 stamps", Home "7 of 10 stamps", Hearthlog Cabin "2 of 10 stamps" and nothing else (no "coming", no unshipped name). `S/shots/P2_r1_phone_places_sheet.png`, `P2_r1_desk_places_sheet.png`. |
| B5 | MAJOR: on a phone the Felt Ball parks dead centre in front of the squishy; first-play roll 0.10 m | **PARTLY (now MINOR)** | The ball now stands at front right, clear of the centre and of the squeeze point, but it still overlaps the lower right edge of the body: `S/shots/P2_r1_phone_home1.png`, `A_new_phone_toast_0400.png`. probe_pg_data DT-01 measures it: "covers 49.6 px of the body (17.2 % of it, 21.8 px into its squeeze area)", and "no spot can [avoid it] with the shipped camera; needs RENDER" (PLAYGROUND_BUILD 24.1 (a)). The first-play roll on the phone is now **0.44 m** (ask: 0.2 m); after it the ball sits large in the near right corner (`P2_r1_phone_home_firstplay.png`). |
| B6 | MINOR: no labelled bubble within 10 s of the first release on desktop (0 of 2 profiles) | **FIXED** | 2 of 2 fresh desktop profiles show "What's that?" at 6 s, and the ball rolls 0.25 m (0.718 to 0.966 / 0.942 m) at 8 to 9 s (`S/logs/B6_p{1,2}_desk.out`, `S/shots/B6_p1_desk_t6.png`). The phone showed "Hee hee!" at 1 s and "What's that?" at 7 s. The ball stays visible beside Dollop (`B6_p2_desk_t10.png`). |
| B7 | MINOR: 5 out exceeds the awake budget for 20 s | **FIXED on desktop, PARTLY on the phone** | Quality high, 5 out, 30 s, samples every 2 s: desktop 0 of 15 over `unitCap` 2.494 (units 1.12 to 2.34); phone 2 of 15 over (3.06 for one sample each, at 12 s and 26 s); low tier with 3 out, 60 s: 0 of 30 over 1.06 (`X_r1_desk.out`). |
| B8 | MINOR: toasts over sheets and the top-right column; AUTO chips jump; crowded layouts; the quick-switch row | **PARTLY** | Fixed: on the phone the toasts and stamp moments stay left of the top-right column and never lie over a sheet (`A_new_phone_trophies_screen.png`: the Trophies sheet is clear; `TM_r1_phone.json`: 0 overlaps over 9.2 s); the stamp moments have their own slot; the quick-switch row marks who is out (a dot; `qsOut` in the log); with 5 out on desktop nobody hides behind anyone (`P2_r1_desk_home5.png`). By code read (`src/ui/thingAuto.ts` 48-51), not re-measured: a toast no longer moves the AUTO chips. **Still open:** the cabin's tall layout puts the Rocker Board under the hint pill "Tap a tool to try it." (`P2_r1_phone_cabin_hud.png`; DT-01 fails: "rockerboard under the bottom HUD (its floor down to 669 px; the HUD from 618)"); the phone's party of 3 is small in the upper half (`P2_r1_phone_home_back.png`); with 5 out on desktop the Music Box stands behind the right-hand squishy. All three are declared NOT done in FIX5_SHELL.md. |
| B9 | MINOR: the empty natural swing takes 5 to 6 swings to settle | **FIXED** | 29 deg push, empty seat: peaks 21.0, 14.6, 10.2, 7.1, 5.0, 3.5 deg every 1.2 s, under 5 deg after **6 s, about 2.5 full swings** (it was 25.8, 22.2, 19.2 ... and about 12 s). `X_r1_desk.out` "swing". The swing with a rider was not measured. |
| B10 | MINOR: blank postcards without stamp lines; no J key | **PARTLY** | J opens the Journal and Escape returns focus to the Journal button (desktop). The postcards have their "N of 10 stamps" line but are still blank gradient tiles, and there is no "N of yours love it" line (`P2_r1_phone_places_sheet.png`). |
| C1 | MAJOR (known): `later-life` 203.45 KB against the 150 KB cap | **FIXED** | `later-life-BknC_GUu.js` **145.41 KB** raw, 51.0 KB gzip (`S/logs/build.log`). |
| D1 | MINOR: LF-02, FM allocations, DT-01 camera guard, DT-11 stale list | **PARTLY** | FM is fixed (probe_pg_lifequests 14/14) and so is DT-11. LF-02 still fails. DT-01 now fails on two new guard rows (B5, B8); see D. |

### New findings

**MINOR N1. "Go play with..." at Home can lose to the awake budget on the med tier: the squishy is told to go, then falls asleep where it stands.**
Repro (`S/scripts/goplay2.mjs`, dev hook, 1280x800, quality auto, which resolved to med; `S/logs/GP_r1_desk.{out,json}`): Wake, grant 3 capsules,
bring two out (3 on the mat), tap the name tag, pick a squishy that is not the play squishy (Dollop), then "Go play with..." the Music Box: the live
line says "Dollop goes to play with the Music Box.", but Dollop is asleep from the first second and stays 1.35 m away for 15 s. For the Warm Lamp it
moves 0.1 m and is asleep from 6 s on. The Felt Ball request moves it 0.03 m, and the Snooze Rug is reached for 2 s, then left. In the cabin the same
run works: Yarn Ball, Snug Basket, Fireplace and Rocker Board are reached, moving 0.84 to 3.43 m. My re-run with quality **high**
(`S/scripts/goplay3.mjs`, `S/logs/GP3_r1_desk.json`) works at Home too: it moves 0.63 to 1.24 m and gets within 0.68 to 1.47 m of each thing; the Music Box is used (onProp 1).
Screenshot: `S/shots/GP_r1_desk_home_musicbox.png` (dev overlay "med"). LIFE.md PLAY_WITH says it starts at once if the squishy has a mover token,
and D-79 makes it the way to finish the Journal with autonomy off, so the player's request should win over the budget. It is MINOR because it works at
high quality and in the cabin. With autonomy off (high, 5 out), "Go play with the Felt Ball" moved the asked squishy only 0.2 to 0.3 m
(`P2_r1_{desk,phone}_autonomy_off_goplay.png`). That run alone does not decide whether the ball's use spot was reached.

**MINOR N2. On a phone the tracker pill's text is cut off:** "Next: Cozy by the fire · 0 of 2" measured `clipped: true` in a 298 px pill at 390x844
(`S/logs/P2_r1_phone.out`, step tracker_tap). On desktop it fits (304 px, not clipped).

Checked and fine (new UI): the **wish card** and the tracker share one slot at the top left and never overlap the top-right column on either size. The
**popover**'s chips are 32 px tall and its thing buttons 44 px, and it covers the hint pill and the quick-switch row while open (expected for a popover).
With **autonomy off** (Settings "Squishies move on their own", saved as `autonomy: false`) there were 0 scoots and 0 hops in 20 s with 5 out on both
sizes; voices, gaze and render sways go on, as LF-24 allows; a player-asked use still moves only that squishy (scoot +2 / +1, hop +1 / +3). There
were 0 console or page errors in every B run.

## C. Performance and download (PASS)

- **First-play download** (the request log before Wake, `S/scripts/reqlog.mjs`, `S/logs/REQ_{new,live}.out`; gzip by `fp.py`-style sums): new **1513.6 KB
  raw / 463.8 KB gzip** in 11 requests, live **1454.4 KB / 443.0 KB** in 9: **+59.2 KB raw (+4.1 %), +20.8 KB gzip**, inside SZ-01's 70 KB PLAYGROUND delta (SZ-01's
  absolute 1300 KB is missed by both builds, as before). After Wake the new build fetches 13 lazy files, 318.7 KB raw (the life, quests, props, journal and lifelook
  chunks); live fetches nothing after Wake. 0 failed requests on both.
- **The life chunk:** `later-life` 145.41 KB raw against the 150 KB cap: **pass** (C1 fixed). All of `dist/assets` is 1993.2 KB raw against SZ-02's 2000 KB:
  pass, with 6.8 KB to spare.
- **Frame cost** (`S/scripts/perf.mjs`, prod builds, same seed, DPR 0.5, Home; `S/logs/C_liveP6875.json`, `S/logs/C_newP8959.json`;
  one run per build this round, so it is a spot check, not the first verdict's 2-run study): the mat's frame guard refused the second and third squishy on
  BOTH prod builds here, so all four windows are effectively Home with 1 out. Script time per frame: live 4.35, 4.25, 3.22, 3.74 ms; new 5.87, 4.86, 7.15, 4.09 ms.
  The two clean "1 out" windows are **+0.6 to +1.5 ms**, the same range as the first verdict's +0.5 to +1.2. One new window reads +3.9 ms and was not repeated.
  Median frame interval (GPU-bound on SwiftShader): live 101.7 to 105.6 ms, new 97.4 to 113.1 ms. The heap is 12.4 to 12.9 MB against 10.5 MB. The
  frame interval did not change in a way that matters; the throttled and 3-or-5-out measurements were not repeated (round-5 changes to the budget can only
  lower the 5-out cost).

## D. Node probes (FAIL, no regression)

Every `_harness/probe_*.ts` (38), `shellview/node_checks.ts` and `renderview/pg_node_checks.ts`, one at a time on the copy (`S/scripts/runprobes.sh`;
logs `S/probes_new/<name>.log`, exit codes and seconds in `S/probes_new/summary.txt`, ALLDONE).

Passing: probe_app 187/187, probe_boot 30/30, probe_catalog all, probe_chatter 42/42, probe_collection_imports 10/10, probe_cut 17/17, probe_economy all,
probe_families 22/22, probe_flush 11/11 (quick set), probe_genome ok, probe_gestures 160/160, probe_journal all, probe_life_imports all, probe_lock_shell 96/96,
probe_lockfx 15/15, probe_many 43/43, probe_materials all, probe_merge 22/22, probe_neck 8/8, probe_optbar 42/42, probe_overlays 21/21, probe_parts 11/11,
probe_pg_economy all run (2 NOT RUN, other lanes), **probe_pg_lifequests 14/14** (was 12/13), **probe_playground 56/56** (quick set), probe_portal 82/82,
probe_quests all run (3 NOT RUN), probe_screens 43/43, probe_tips ok, probe_trophies 31/31, probe_uikit 62/62, **shellview/node_checks 170/170**,
renderview/pg_node_checks 40 ok / 0 FAIL.

| Probe | Failing row(s) on this tree | On the published PC tree (first verdict, 9211d66ba) |
|---|---|---|
| probe_collection 73/74 | C08 previewTouch allocates 160 000 B / 20 000 calls | same row fails |
| probe_lock 81/87 | LOCK orders crimpo (fold 175 / 180 deg > 120); LOCK slots cushlet; LOCK perf (6 locks 1.21 ms > 2 bodies 0.79 ms) | same 3 rows fail |
| probe_softbody 115/116 | G1p warmUp covers a lone finger | same row fails |
| probe_species 25/31 | press matrix rest; FULL PULL putty; RUBS waterfill, putty, slimegoo, beadsqueeze | same 6 rows fail |
| probe_truecut 104/113 (--quick) | G2, G3 x2, G4 x4, G7 nested, L2 rest pose | same 9 rows fail |
| probe_life 117/118 | LF-02 lifeStep allocates (74 112 to 157 976 B per 1000-tick window, bar 0) | probe not on the PC tree; the first verdict saw it fail too |
| probe_pg_data | DT-01 Home on a phone with one out: the Felt Ball covers 17.2 % of the squishy (= B5); DT-01 the cabin's tall layout: the Rocker Board under the hint pill (= B8). DT-11 now passes | probe not on the PC tree; both rows are new in round 5 and fail on purpose until RENDER / DATA re-frame |

None of the five shared failures is a regression. The three new-tree-only failing rows are an allocation bar (garbage; nothing visible was measured) and
two honest layout guards for the open MINORs B5 and B8.

## Every open finding by severity

| Id | Severity | One line | Screens / logs |
|---|---|---|---|
| (none) | BLOCKER | none open | |
| (none) | MAJOR | none open | |
| B5 | MINOR | on a phone the Felt Ball still overlaps the lower right of the squishy (17.2 %, 21.8 px into the squeeze area); a RENDER framing change is needed | `P2_r1_phone_home1.png`, `A_new_phone_toast_0400.png`, probe_pg_data DT-01 |
| B8 | MINOR | the cabin's tall layout: the Rocker Board is under the hint pill; the phone's party of 3 is small; with 5 out the Music Box hides behind a squishy | `P2_r1_phone_cabin_hud.png`, `P2_r1_phone_home_back.png`, `P2_r1_desk_home5.png` |
| N1 | MINOR | "Go play with..." at Home on the med tier: the asked squishy falls asleep instead (2 of 4 things clearly, 1 partly) | `GP_r1_desk_home_musicbox.png`, `S/logs/GP_r1_desk.json`, `GP3_r1_desk.json` |
| B3 rest | MINOR | not built: "Tap it yourself", the party toolbar / Enter on the focused squishy, "Who's coming?", the Snap shutter and preview | (declared in FIX5_SHELL.md) |
| B7 rest | MINOR | phone, 5 out, quality high: 2 of 15 samples at 3.06 against the 2.494 cap | `P2_r1_phone.out` party5 |
| B10 rest | MINOR | postcards are blank gradient tiles; no "N of yours love it" line | `P2_r1_phone_places_sheet.png` |
| N2 | MINOR | the tracker pill's text is cut off on a phone ("Next: Cozy by the fire · 0 of 2") | `P2_r1_phone.out` tracker_tap |
| D1 rest | MINOR | LF-02 lifeStep allocation | `S/probes_new/probe_life.ts.log` |

## What was not checked

- **Audio of any kind has never been listened to** in either verdict (voices, the kettle, the cabin bed, place sounds, music): no listening is possible here and no offline render was made. AU rows are not verified.
- Keyboard parity of the new UI (Tab into the wish card, the tracker and the popover; SH-14), except that J opens the Journal and Escape returns focus; screen-reader names of the new controls.
- Landscape phones and 320x568; Calm and reduced-motion variants of the new motion.
- The swing or rocker with a rider; Float, lock or Snap with a party; FN-02, FN-03, FN-06; the 60-minute no-input economy run (EC-02).
- Frame cost with a 4x CPU throttle and in the cabin (only an unthrottled Home run was repeated this round, see C).
- Places other than Home and Hearthlog Cabin (not shipped).
- The implementer reports were read after the runs, and only to label what they declared as not done.
