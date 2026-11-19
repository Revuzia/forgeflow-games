# VERDICT_R10: independent narrow re-check of Squish Keeper before a deploy (2026-11-19)

**VERDICT (FINAL, 08:00 UTC): NOT READY to deploy. BLOCKER: `vite build` exits 1 on round 10's own T1 gate (assets 2082.8 KB of 2000), so the deploy command cannot finish, and closing places by `shipped: false` does not shrink the build. At the forced LOW tier Ripple Shore (desktop 2 things; a 12.5 s stuck squishy on the phone) and Rainleaf Garden (phone 2; two squishies asleep and still about 3 minutes, R9's symptom unfixed; 4 at high) miss the bar; the other four places reach 3 to 5 on both frames (several at exactly 3, one run each). Regression (desktop 23/23, phone 21/21), cut / reconnect, the 23c684a60 save and all 15 browser runs: 0 errors. A1 fixed (+60.7 KB); A2, A3 open.**

Verifier: independent; wrote no file in `src` or `_harness`, ran no git write command.
Tree checked: a `cp` copy of the working tree at 06:02 UTC = HEAD ad75c5043 (git status clean for the game folder; `diff -rq` of src / _harness / vite.config.ts against G empty).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify_r10/` (`S/` below): `scripts/` (R9's, copied), `logs/`, `shots/`, `snap/` (the copy).
Ports: 5370 vite dev of the copy, 5371 prod of the copy (static), 5372 live snapshot (static), 5373 23c684a60 build (static).

## How to continue if cut off
Scripts from R9 (`S/scripts/`): `place.mjs <url> <desk|phone> <place> <seed> <secs>` (+ `Q=high`), `runB.sh` (regression), `fp.py` (first-play closure), `mkseed_r9.mjs`.

## Checks
### (1) build / tsc / sizes (DONE 06:03 UTC; `S/logs/tsc.log`, `S/logs/build.log`)
- `tsc --noEmit -p tsconfig.json`: exit 0 (2.3 s).
- `vite build`: **exit 1**: "Error: [T1] game assets 2082.8 KB of the 2000 KB whole-build cap (SZ-02, D9): OVER BUDGET". The files are still written to `dist/` (the gate throws after the write), so the runs below use that `dist`; but `npm run build` and `npm run deploy` (check && build && deploy_game.py) stop here.
- **A1 (first-play delta) FIXED**: `S/scripts/fp.py` (html + every non-`later-` file): new **1515.1 KB raw / 464.2 KB gzip** vs live snapshot 1454.4 / 443.0: **+60.7 KB raw** (hard cap 70, target 60), +21.2 KB gzip. `three.core` 207,179 B (= 23c684a60's size; R9 measured 222,068 at HEAD d2bd392ea). R9 had +75.5.
- **A2 (life set at Wake) OPEN**: `later-life` 69.82 KB + `later-brain` 112.86 KB = **182.7 KB** loaded together at Wake (cap 150). Unchanged by round 10 (R10_FIX: "not done").
- **A3 (whole build) OPEN, and now a gate failure**: `dist/assets` **2082.8 KB** (2,082,766 B) against 2000 KB (R9: 2095.0). 82.8 KB over.
- Places (render + data + sound): Hearthlog 19.9, Ripple 14.8, Frostbell 18.0, Rainleaf 14.0, Lanternroof 25.3, Cloudloft 19.6 KB (cap 45 each): pass.
- **Consequence for a reduced build**: `src/data/places.ts` 181-187 imports every place's data unconditionally (and the render / sound chunks the same way), so `shipped: false` hides a place from the sheet but does NOT drop its chunks: a build with places closed by the flag is still about 2082.8 KB and still fails T1. Even all five new places' chunks together are 91.7 KB, so only removing them from the build (not the flag) would get under 2000 (about 1991 KB).

- (render/place.ts 83-88 and audio/ambience.ts 36-41 hold the same unconditional `import()` tables for the look and sound chunks.)

### (1b) Node probes the fix touched (on the copy, one at a time; `S/logs/P_<probe>.out`)
| Probe | Result | vs R9 / R10_FIX |
|---|---|---|
| probe_app | 188/188 | same |
| shellview/node_checks | 185/185 (98 s) | same |
| probe_playground --quick | 74/74 | same |
| probe_pg_data | 44 ok / 1 FAIL: DT-18 (TALL keepsakeshelf 95 % hidden at n3) | same known row (D1) |
| probe_life | 127 ok / 1 FAIL: LF-02 lifeStep allocation (72 to 152 KB per 1000 ticks) | same known row |
| probe_life_selfuse --quick (99 s: 1 party Wisplet + Chunkle + 1, wide, high, 120 s) | SQ-01 x2 ok; SU-01 ok at 5 places, **FAIL ripple: 2 things in 120 s** (pebbleball, rockpool); SU-02, SU-03 ok | R10_FIX ran only the full set (SU-01 ok 5/5 parties at 300 s; SU-04 16/24). The full set (37 min) was NOT re-run here: the browser runs below measure SU-04's case directly |

(1b) verdict: no new probe failure except the quick self-use row at Ripple; LF-02 and DT-18 are the known open rows.
### (3) Six places x two frames (DONE 07:53 UTC except the high reruns noted; `S/scripts/placeW.mjs` = R9's `place.mjs` with WONLY=1: Wake, 3 out via the Hoard, the real Places sheet and "Go to" by real taps, the sim paused and stepped 180 s with no input, then stop; no actions, no 300 s extension. Also samples LIFE's phase and wait flag. Summary `S/scripts/sumW.py <tag>`; logs `S/logs/W_<place>_<frame>_<tier>.{out,json}`, shots `S/shots/W_*`)
Counting rule = R9's final: a thing counts if the host has a by-itself USE, REACT or SOCIAL record for it. Two "stuck" measures (`sumW.py` stuck3, 0.5 s samples):
**STUCK** = AWAKE (asleep in at most 20 % of the window), wanting to go (WANDER / USE / COMEBACK / WATCH, phase 0 or 1) in 80 %+ of it, and less than 0.3 m from where the window began; **HELD** = asleep in 80 %+ of the window and in a by-itself use's wait (LIFE's wait flag) in 30 %+ of it, less than 0.3 m: a squishy lying asleep that keeps choosing a thing and never gets its wake (R9's Rainleaf phone symptom, R10_FIX item 2). A HELD squishy looks asleep (eyes shut), not blocked.
**Tier note**: on this machine `quality: auto` resolved to the MED tier (unitCap 1.345, moverCap 1) on both frames, not low as R9 saw (auto depends on measured frame cost, so on machine load). The first run (cabin desk, auto = med) is kept below as extra; every other run forces `quality: low` (unitCap 1.06) as the brief asks.
- W_hearthlog_desk (auto = MED): **3** (rockerboard 19.5 s, snugbasket 79.5 s, kettle 138 s), longest stuck 9.0 s, 0 errors, C7 + C10 on their own. (R9 low: 5.)
- W_ripple_phone_low: **3** = USE pebbleball (88 s) + REACT rockpool + SOCIAL driftlog (USE + REACT only: 2); longest stuck 8.0 s (all three: "USE x" phase 0, asleep, waiting for the wake, 7.5 to 8 s); 0 errors; R4, R5 on their own. (R9: 2.) Below 4: high rerun not made (time).
- W_cloudloft_phone_low: **3** = USE cloudball (78 s), cloudnest (82 s), kiteswing (103.5 s; Dollop rides it 18.5 s); longest stuck 7.5 s; 0 errors; U4 on its own. (R9: 2.) Below 4: high rerun not made (time).
- W_ripple_desk_low: **2** = USE rockpool (79 s), pebbleball (113.5 s) (+ the ball SOCIAL); **FAILS the bar**. All three spend long in "USE shellchimes" with no strike recorded: Glimglop 65 s, Dollop 32 s, Crimpo 56.5 s (Glimglop ends sitting at the chimes' frame, `S/shots/W_ripple_desk_low_after_watch.png`); longest stuck 8.0 s (the stuck rule is not hit: they reach the chimes, then nothing); 0 errors; R4 on its own. (R9 low: 2; R9 high: 3.)
- W_cloudloft_desk_low: **3** = USE cloudnest (114.5 s), cloudball (143 s) + REACT updraft; Glimglop 35.5 s and Crimpo 27.5 s in "USE sunbowarch" and Dollop / Crimpo 9 s each in "USE puffpads" with no record; longest stuck 8.0 s; 0 errors; no quest on its own. (R9: 3.) Below 4: high rerun not made (time). 646 s wall.
- W_frostbell_phone_low: **3** = USE snowball (76.5 s), snowdriftnest (83.5 s), glideramp (106.5 s) (+ snowball REACT and SOCIAL); Dollop and Crimpo glide on the ice pond (ride 20 s each, no USE record); STUCK max 8 s, HELD max 31 s; 0 errors; I2 on its own. (R9 low: 2.) Below 4: high rerun not made (time).
- W_rainleaf_phone_low: **2** = USE leafteeter (66.5 s) + SOCIAL seedpod; **FAILS**. **R9's symptom is unchanged: Dollop HELD 179.5 s (asleep at (-0.43, -0.59), cycling "USE seedpod" wait 7.5 s / IDLE 5 s from 58 s to the end) and Crimpo HELD 174.5 s (asleep at (0.16, 0.30), cycling "USE steppingstones")**: they move 0.31 m and 0.13 m in 180 s; the turn rule never gave them their wake (Glimglop rides the teeter, then walks). STUCK max 3 s; 0 errors. (R9 low: 1 to 2.)

- W_lanternroof_desk_low: **3** = USE vanedisc (76.5 s) + REACT moondish + SOCIAL hammock (USE + REACT: 2); Dollop 48 s and Glimglop 14.5 s in "USE hammock" with no USE record, Crimpo 24.5 s "USE starscope"; STUCK max 6.5 s, HELD max 74.5 s (Crimpo) and 60.5 s (Dollop); 0 errors; L2, L4, L5, L9 on their own. (R9 low: 1.) Below 4: high rerun not reached (time; see "not checked").

- W_hearthlog_phone_low: **5** = USE rockerboard (27.5 s), yarnball (60 s), snugbasket (90.5 s), kettle (135.5 s) + REACT hearth; STUCK max 3.5 s, HELD max 69.5 s; 0 errors; C4, C7, C10 on their own. (R9: 3 to 4.) (Its runner was stopped and restarted to reorder the queue; the run itself finished normally.)

- W_frostbell_desk_low: **4** = USE snowball (14.5 s), glideramp (63 s), icepond (89.5 s), snowdriftnest (96 s); Glimglop 66.5 s and Dollop 56.5 s in "USE iciclebells" with no record; **STUCK 10.5 s** (Glimglop, awake, at the bells, 135 to 145.5 s), HELD max 118 s (Dollop, 62 s to the end); 0 errors; I2 on its own. (R9 low: 5.)

- W_rainleaf_desk_low: **3** = USE seedpod (19.5 s), leafteeter (88.5 s) + REACT dripleaf; Dollop 64.5 s "USE splashspots" and 18 s "USE mossbouncer", Crimpo 40 s "USE mossbouncer", with no record; STUCK max 3 s; **HELD 144.5 s (Glimglop, 35.5 s to the end) and 126 s (Dollop, 54 s to the end)**; 0 errors; G7 on its own. (R9 low: 4.)

- W_lanternroof_phone_low: **4** = USE vanedisc (61.5 s), hammock (73 s) + REACT moondish, starscope; STUCK max 4.5 s, HELD max 52.5 s; 0 errors; L2, L4, L5 on their own. (R9 low: 5.)

- W_rainleaf_phone_high (quality forced high, unitCap 2.494, moverCap 2): **4** = USE seedpod (39 s), leafteeter (53 s), splashspots (62 s) + REACT dripleaf; all three move (4.9 / 10.2 / 6.1 m); STUCK max 8.5 s, HELD max 22.5 s; 0 errors; G7, G10 on their own; 152 voice phrases in 180 s (E2's chirp stream at high). (R9 high: 3.)
- High reruns NOT made (time): Ripple phone, Cloudloft phone and desk, Frostbell phone, Lanternroof desk (all 3 at low), Ripple desk (2 at low; R9 measured 3 at high on d2bd392ea).

**Stuck re-count of the runs above (stuck3)**: STUCK (awake) max: cabin-med 7.5 s, Ripple phone **15 s** (Glimglop 152 to 167 s: awake on the drift log, LIFE flips COMEBACK / "USE rockpool" phase 0 every 0.5 s for 12.5 s, 155 to 167.5 s, without moving 1 cm, then rides; a behaviour thrash, `S/logs/W_ripple_phone_low.json`), Frostbell desk 10.5 s (Glimglop crawling onto a thing at 0.025 m/s: slow, not blocked; not counted as stuck), Cloudloft phone 7 s, Ripple desk 8 s, Cloudloft desk 10.0 s, Frostbell phone 8 s, Rainleaf phone 3 s, Rainleaf desk 3 s, Lanternroof 6.5 / 4.5 s, cabin phone 3.5 s. HELD max: cabin-med 97.5 s, Ripple phone 97.5 s, Cloudloft phone 25 s, **Ripple desk 155.5 s** (Crimpo; Dollop 111 s), Cloudloft desk 74.5 s, Frostbell phone 31 s, **Rainleaf phone 179.5 s**, **Rainleaf desk 144.5 s**, Frostbell desk 118 s, Lanternroof 74.5 / 52.5 s, cabin phone 69.5 s.

### (2) Regression smoke (prod build of the copy on :5371; R9's `arun.mjs` / `loadsave.mjs` / `crun.mjs`, same seeds; compared with R9's live-snapshot outputs `pg_verify_r9/logs/A_live_*.out` by `cmpA.py`, the snapshot being unchanged: `sha256sum` not re-run)
- **A_new_desk (1280x800): 23 of 23 steps ok, 0 console / page / request errors** (`S/logs/A_new_desk.out`; 21 min wall on a loaded machine). Differences from live: capsule / merge results are random (as R9); **after "Reconnect all" no "Whole again." line** (live and R9's new desk both had it), so the cut stayed and the later Float step also said "Here your squishies stand on the ground." (D-83's ground rule while a cut group is out, `later-life.ts` 457-465, unchanged since round 3); lock and Float themselves worked. R9 saw the same missing line once on the phone and showed by `crun.mjs` that it was a timing artefact of `arun`; re-tested below.
- **The 23c684a60 save** (`S/logs/LS_new.json`, `LS_new_cabin.json`): loads in the new prod build with its Journal ("5 of 80 stamps", A gentle squeeze / Watch it play / A big stretch / Open a capsule / Say hello: Done), 0 errors; the variant with the cabin bit lists Home "5 of 10 stamps" and Hearthlog Cabin open with "Go to", the five other places shut with "Opens at 12 / 20 / 28 / 36 / 45 stamps", and "Go to Hearthlog Cabin" travels ("You are at Hearthlog Cabin. New stamp: Come in from the snow"); 0 errors. Same as R9.
- **Cut / reconnect re-test** (`crun.mjs`, cut and reconnect twice; `S/logs/C_new_{desk,phone}.out`): on both frames "Cut into 2 pieces. Bronze trophy: Clean Cut.", **"Whole again."**, "Bronze trophy: Whole Again.", then again "Cut into 2 pieces.", "Whole again."; 0 errors. The same sequence as R9's live and new runs: the missing line in `arun` desk is the timing artefact R9 found.
- **A_new_phone (390x844): 21 of 21 steps ok (the same 21 steps as R9's phone run), 0 console / page / request errors** (`S/logs/A_new_phone.out`). Differences from live: random capsule / merge results; no "Whole again." after Reconnect all (as R9's phone run; the `crun` re-test above shows it on both frames).

**(2) verdict: PASS**: 23/23 published steps on the desktop and 21/21 on the phone with 0 errors, cut / reconnect unchanged on both frames, the 23c684a60 save keeps its Journal and its open cabin.

### (4) VERDICT_R9's BLOCKER / MAJOR findings (its final list; R9 had no BLOCKER)
| R9 id | R9 finding | R10 state (this tree, low tier unless said) |
|---|---|---|
| C1 MAJOR | Ripple Shore and Cloudloft: 2 things on the phone at both tiers; Ripple 2 on the desktop at low | **PARTLY FIXED**: Ripple phone 3 (USE 1 + REACT 1 + SOCIAL 1), Cloudloft phone 3, Cloudloft desk 3; **Ripple desktop still 2** (three squishies spend 32 to 65 s each "using" the Shell Chimes with no strike). Ripple phone also has a 12.5 s awake thrash (STUCK). One run each. |
| C2 MAJOR | Low tier: Frostbell phone 2, Rainleaf phone 1 to 2 (two squishies frozen 2.5 min), Lanternroof desk 1 | **PARTLY FIXED**: Frostbell phone 3, Lanternroof desk 3; **Rainleaf phone still 2, and its two squishies are still held asleep and still for 175 to 180 s** (the turn rule did not reach them; R10_FIX item 2 was "not browser-checked"); high tier 4. The same HELD pattern now also shows at Rainleaf desk (145 s), Ripple desk (156 s), Frostbell desk (118 s), although those still reach 3 to 4 things. |
| A1 MINOR | first play +75.5 KB | **FIXED**: +60.7 KB (cap 70) |
| A2 MINOR | life set at Wake 181 KB | **OPEN**: 182.7 KB |
| A3 MINOR | dist/assets 2095 KB vs 2000 | **OPEN and now a BLOCKER**: 2082.8 KB, and round 10's own T1 gate makes `vite build` exit 1 |
| D1 to D3, V1, V2, E1, E2, X1 (MINOR) | Home, look, sound notes | D1 still (DT-18 FAIL); V1's Drip Leaf through a squishy still seen (`S/shots/W_rainleaf_phone_low_after_watch.png`); E2 (152 voices / 180 s at Rainleaf high); others not re-checked |

## Per place: OPEN-READY (low tier forced; 3 out by the real Places sheet; 180 s stepped, no input; one run per case)
Count = things with a by-itself USE, REACT or SOCIAL record. STUCK = awake and not moving while wanting to go (bar: none over 10 s). HELD = asleep, not moving, waiting for its wake (reported, not part of the bar).
| Place | Desktop 1280x800 | Phone 390x844 | High rerun | STUCK max d / p | HELD max d / p | Errors | OPEN-READY |
|---|---|---|---|---|---|---|---|
| Hearthlog Cabin | 3 (at MED: auto; no low run) | 5 | - | 7.5 / 3.5 s | 97.5 / 69.5 s | 0 / 0 | **yes** (desktop measured at med only; R9 low 5) |
| Ripple Shore | **2** | 3 | not run (R9 desk high 3) | 8 / **12.5 s** | 155.5 / 97.5 s | 0 / 0 | **no** |
| Frostbell Ridge | 4 | 3 | not run | 10.5 (slow crawl) / 8 s | 118 / 31 s | 0 / 0 | **yes** (phone marginal: 3; R10 node SU-04 tall low gave 2) |
| Rainleaf Garden | 3 | **2** | phone **4** | 3 / 3 s | 144.5 / **179.5 s** | 0 / 0 | **no at low, yes at high** |
| Lanternroof | 3 | 4 | not run | 6.5 / 4.5 s | 74.5 / 52.5 s | 0 / 0 | **yes** (desktop marginal: 3 with 1 USE; SU-04 wide low gave 2) |
| Cloudloft | 3 | 3 | not run | 10.0 / 7 s | 74.5 / 25 s | 0 / 0 | **yes, marginal** (3 on both frames; SU-04 tall low gave 2) |

## Open findings
| Id | Severity | Finding | Repro / evidence |
|---|---|---|---|
| T1 | **BLOCKER (deploy)** | `vite build` exits 1: "[T1] game assets 2082.8 KB of the 2000 KB whole-build cap": `npm run build` / `npm run deploy` cannot finish. Closing places with `shipped: false` does not shrink the build (places.ts 181-187, render/place.ts 83-88, audio/ambience.ts 36-41 import every place unconditionally) | `cd snap && node node_modules/vite/bin/vite.js build`; `S/logs/build.log` line 67 |
| C1r | MAJOR | Ripple Shore desktop at low: 2 things in 180 s; the three squishies walk to the Shell Chimes and "use" them 32 to 65 s each with no strike recorded | `WONLY=1 Q=low node S/scripts/placeW.mjs "http://127.0.0.1:5370/?dev=1" desk ripple S/logs/seed_p3.json 180`; `S/logs/W_ripple_desk_low.json`; `S/shots/W_ripple_desk_low_after_watch.png` |
| C2r | MAJOR | Rainleaf Garden phone at low: 2 things; Dollop and Crimpo lie asleep 175 to 180 s, re-choosing the Seed Pod / Stepping Stones every 13 s, never woken (R9's symptom, not fixed); 4 at high | `... phone rainleaf ...`; `S/logs/W_rainleaf_phone_low.json`; `S/shots/W_rainleaf_phone_low_after_watch.png` |
| S1 | MAJOR (brief's bar) | Ripple Shore phone at low: Glimglop, awake on the drift log, flips COMEBACK / "USE rockpool" every 0.5 s for 12.5 s without moving | `S/logs/W_ripple_phone_low.json` samples 155 to 167.5 s; `S/shots/W_ripple_phone_low_watch_170s.png` |
| H1 | MINOR | HELD sleepers waiting 60 to 156 s for a wake at most places at the low tier (Ripple desk 156, Rainleaf desk 145, Frostbell desk 118 s): they look asleep, and their places still reach 3 to 4 | stuck3 in `S/scripts/sumW.py` |
| M3 | MINOR (fragility) | Six of the twelve low-tier cases sit at exactly 3, from one run each; R10's own node SU-04 gave 2 for Frostbell tall low, Cloudloft tall low and Lanternroof wide low | R10_FIX.md SU-04 table |
| A2 | MINOR | life set at Wake 182.7 KB (cap 150) | `S/logs/build.log` |
| Q1 | MINOR | `probe_life_selfuse --quick`: SU-01 Ripple 2 things in 120 s (1 party, wide, high) | `S/logs/P_probe_life_selfuse_quick.out` |
| D1, LF-02 | MINOR | known probe rows DT-18 and LF-02 still fail | `S/logs/P_probe_pg_data.out`, `P_probe_life.out` |

## Ready to deploy with all six places open: **NO**, because
(1) the build itself fails: round 10's T1 gate stops `vite build` at 2082.8 KB of 2000 KB, so the deploy command cannot finish; and (2) at the low tier Ripple Shore (desktop 2, plus a 12.5 s stuck squishy on the phone) and Rainleaf Garden (phone 2, two squishies asleep and still for about 3 minutes) miss the owner's bar. Regression, saves, cut / reconnect and the six place trips have 0 errors.

**To make a deployable build**: close **Ripple Shore and Rainleaf Garden** (they fail at low; Rainleaf passes at high, Ripple's desktop high was not re-measured). Closing them by `shipped: false` alone does NOT make the build deployable: their chunks stay in `dist` (2082.8 KB, T1 still fails). It also needs A3 done (82.8 KB trimmed, or their and other closed places' imports removed from the three import tables: Ripple + Rainleaf are only 28.8 KB, not enough), or the owner's decision on the 2000 KB cap. A Home + Hearthlog only build with the five new places taken OUT of the import tables would be about 1991 KB and pass T1. **Is that reduced build ready? NO / not verified**: no reduced build was made or run here; Frostbell, Lanternroof and Cloudloft pass only at exactly 3 in single runs.

## What was not checked
- High-tier reruns for Ripple (both frames), Cloudloft (both), Frostbell phone, Lanternroof desk (time); the cabin desktop at the low tier (its run was at med).
- A second run of any case (all counts are single samples of a chaotic sim); the full `probe_life_selfuse` (SU-04) on this tree.
- The place actions, quests by play, hard tosses and Home clicks (R9's (c) and (d) passes): not redone, as the brief asked.
- Audio by ear; photo frame and Journal gifts in the browser; 5 out; landscape, 320 px, Calm, keyboard / screen reader on the new UI; real GPUs (SwiftShader only).
- `sha256sum -c` of the live snapshot and fresh live-snapshot runs (R9's live outputs reused); the saves-both-ways chain (A0 to A4) and the first-play request log (static `fp.py` used instead).

Nothing of mine is left running (servers on 5370 / 5371 stopped; `ps` shows no headless_shell, vite, _harness or runner of mine).
