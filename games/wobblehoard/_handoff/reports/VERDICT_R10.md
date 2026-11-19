# VERDICT_R10: independent narrow re-check of Squish Keeper before a deploy (2026-11-19)

**PROVISIONAL VERDICT (07:28 UTC): NOT READY. BLOCKER: `vite build` exits 1 on R10's new T1 gate (assets 2082.8 KB of 2000), so the deploy command cannot finish. At the low tier Ripple Shore desktop (2) and Rainleaf Garden phone (2, two squishies asleep and still for 175 to 180 s) still miss the 3-thing bar; the other ten place/frame cases reach 3 to 5. Regression and two high reruns in progress.**

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
### (3) Six places x two frames (IN PROGRESS; `S/scripts/placeW.mjs` = R9's `place.mjs` with WONLY=1: Wake, 3 out via the Hoard, the real Places sheet and "Go to" by real taps, the sim paused and stepped 180 s with no input, then stop; no actions, no 300 s extension. Also samples LIFE's phase and wait flag. Summary `S/scripts/sumW.py <tag>`; logs `S/logs/W_<place>_<frame>_<tier>.{out,json}`, shots `S/shots/W_*`)
Counting rule = R9's final: a thing counts if the host has a by-itself USE, REACT or SOCIAL record for it. Two "stuck" measures (`sumW.py` stuck3, 0.5 s samples):
**STUCK** = AWAKE (asleep in at most 20 % of the window), wanting to go (WANDER / USE / COMEBACK / WATCH, phase 0 or 1) in 80 %+ of it, and less than 0.3 m from where the window began; **HELD** = asleep in 80 %+ of the window and in a by-itself use's wait (LIFE's wait flag) in 30 %+ of it, less than 0.3 m: a squishy lying asleep that keeps choosing a thing and never gets its wake (R9's Rainleaf phone symptom, R10_FIX item 2). A HELD squishy looks asleep (eyes shut), not blocked.
**Tier note**: on this machine `quality: auto` resolved to the MED tier (unitCap 1.345, moverCap 1) on both frames, not low as R9 saw (auto depends on measured frame cost, so on machine load). The first run (cabin desk, auto = med) is kept below as extra; every other run forces `quality: low` (unitCap 1.06) as the brief asks.
- W_hearthlog_desk (auto = MED): **3** (rockerboard 19.5 s, snugbasket 79.5 s, kettle 138 s), longest stuck 9.0 s, 0 errors, C7 + C10 on their own. (R9 low: 5.)
- W_ripple_phone_low: **3** = USE pebbleball (88 s) + REACT rockpool + SOCIAL driftlog (USE + REACT only: 2); longest stuck 8.0 s (all three: "USE x" phase 0, asleep, waiting for the wake, 7.5 to 8 s); 0 errors; R4, R5 on their own. (R9: 2.) Below 4: high rerun queued.
- W_cloudloft_phone_low: **3** = USE cloudball (78 s), cloudnest (82 s), kiteswing (103.5 s; Dollop rides it 18.5 s); longest stuck 7.5 s; 0 errors; U4 on its own. (R9: 2.) Below 4: high rerun queued.
- W_ripple_desk_low: **2** = USE rockpool (79 s), pebbleball (113.5 s) (+ the ball SOCIAL); **FAILS the bar**. All three spend long in "USE shellchimes" with no strike recorded: Glimglop 65 s, Dollop 32 s, Crimpo 56.5 s (Glimglop ends sitting at the chimes' frame, `S/shots/W_ripple_desk_low_after_watch.png`); longest stuck 8.0 s (the stuck rule is not hit: they reach the chimes, then nothing); 0 errors; R4 on its own. (R9 low: 2; R9 high: 3.)
- W_cloudloft_desk_low: **3** = USE cloudnest (114.5 s), cloudball (143 s) + REACT updraft; Glimglop 35.5 s and Crimpo 27.5 s in "USE sunbowarch" and Dollop / Crimpo 9 s each in "USE puffpads" with no record; longest stuck 8.0 s; 0 errors; no quest on its own. (R9: 3.) Below 4: high rerun queued. 646 s wall.
- W_frostbell_phone_low: **3** = USE snowball (76.5 s), snowdriftnest (83.5 s), glideramp (106.5 s) (+ snowball REACT and SOCIAL); Dollop and Crimpo glide on the ice pond (ride 20 s each, no USE record); STUCK max 8 s, HELD max 31 s; 0 errors; I2 on its own. (R9 low: 2.) Below 4: high rerun queued.
- W_rainleaf_phone_low: **2** = USE leafteeter (66.5 s) + SOCIAL seedpod; **FAILS**. **R9's symptom is unchanged: Dollop HELD 179.5 s (asleep at (-0.43, -0.59), cycling "USE seedpod" wait 7.5 s / IDLE 5 s from 58 s to the end) and Crimpo HELD 174.5 s (asleep at (0.16, 0.30), cycling "USE steppingstones")**: they move 0.31 m and 0.13 m in 180 s; the turn rule never gave them their wake (Glimglop rides the teeter, then walks). STUCK max 3 s; 0 errors. (R9 low: 1 to 2.)

- W_lanternroof_desk_low: **3** = USE vanedisc (76.5 s) + REACT moondish + SOCIAL hammock (USE + REACT: 2); Dollop 48 s and Glimglop 14.5 s in "USE hammock" with no USE record, Crimpo 24.5 s "USE starscope"; STUCK max 6.5 s, HELD max 74.5 s (Crimpo) and 60.5 s (Dollop); 0 errors; L2, L4, L5, L9 on their own. (R9 low: 1.) Below 4: high rerun not reached (time; see "not checked").

- W_hearthlog_phone_low: **5** = USE rockerboard (27.5 s), yarnball (60 s), snugbasket (90.5 s), kettle (135.5 s) + REACT hearth; STUCK max 3.5 s, HELD max 69.5 s; 0 errors; C4, C7, C10 on their own. (R9: 3 to 4.) (Its runner was stopped and restarted to reorder the queue; the run itself finished normally.)

- W_frostbell_desk_low: **4** = USE snowball (14.5 s), glideramp (63 s), icepond (89.5 s), snowdriftnest (96 s); Glimglop 66.5 s and Dollop 56.5 s in "USE iciclebells" with no record; **STUCK 10.5 s** (Glimglop, awake, at the bells, 135 to 145.5 s), HELD max 118 s (Dollop, 62 s to the end); 0 errors; I2 on its own. (R9 low: 5.)

- W_rainleaf_desk_low: **3** = USE seedpod (19.5 s), leafteeter (88.5 s) + REACT dripleaf; Dollop 64.5 s "USE splashspots" and 18 s "USE mossbouncer", Crimpo 40 s "USE mossbouncer", with no record; STUCK max 3 s; **HELD 144.5 s (Glimglop, 35.5 s to the end) and 126 s (Dollop, 54 s to the end)**; 0 errors; G7 on its own. (R9 low: 4.)

- W_lanternroof_phone_low: **4** = USE vanedisc (61.5 s), hammock (73 s) + REACT moondish, starscope; STUCK max 4.5 s, HELD max 52.5 s; 0 errors; L2, L4, L5 on their own. (R9 low: 5.)

**Stuck re-count of the runs above (stuck3)**: STUCK (awake) max: cabin-med 7.5 s, Ripple phone **15 s** (Glimglop 152 to 167 s), Cloudloft phone 7 s, Ripple desk 8 s, Cloudloft desk 10.0 s, Frostbell phone 8 s, Rainleaf phone 3 s. HELD max: cabin-med 97.5 s, Ripple phone 97.5 s, Cloudloft phone 25 s, **Ripple desk 155.5 s** (Crimpo; Dollop 111 s), Cloudloft desk 74.5 s, Frostbell phone 31 s, **Rainleaf phone 179.5 s**.

### (2) Regression smoke (prod build of the copy on :5371; R9's `arun.mjs` / `loadsave.mjs` / `crun.mjs`, same seeds; compared with R9's live-snapshot outputs `pg_verify_r9/logs/A_live_*.out` by `cmpA.py`, the snapshot being unchanged: `sha256sum` not re-run)
- **A_new_desk (1280x800): 23 of 23 steps ok, 0 console / page / request errors** (`S/logs/A_new_desk.out`; 21 min wall on a loaded machine). Differences from live: capsule / merge results are random (as R9); **after "Reconnect all" no "Whole again." line** (live and R9's new desk both had it), so the cut stayed and the later Float step also said "Here your squishies stand on the ground." (D-83's ground rule while a cut group is out, `later-life.ts` 457-465, unchanged since round 3); lock and Float themselves worked. R9 saw the same missing line once on the phone and showed by `crun.mjs` that it was a timing artefact of `arun`; re-tested below.
- **The 23c684a60 save** (`S/logs/LS_new.json`, `LS_new_cabin.json`): loads in the new prod build with its Journal ("5 of 80 stamps", A gentle squeeze / Watch it play / A big stretch / Open a capsule / Say hello: Done), 0 errors; the variant with the cabin bit lists Home "5 of 10 stamps" and Hearthlog Cabin open with "Go to", the five other places shut with "Opens at 12 / 20 / 28 / 36 / 45 stamps", and "Go to Hearthlog Cabin" travels ("You are at Hearthlog Cabin. New stamp: Come in from the snow"); 0 errors. Same as R9.
(4) R9 BLOCKER / MAJOR list: pending
