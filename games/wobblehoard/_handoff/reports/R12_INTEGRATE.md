# R12_INTEGRATE: round 12, the INTEGRATION engineer (any file under src and _harness; ports 5364 to 5369). No git write command is run.

Brief: the orchestrator's round-12 task (run every node probe once, make every red row green by fixing the product; cross-lane interactions; Ripple tall chimes).
Started 2026-11-19 09:25 UTC at HEAD dc3ccc0ad, working tree clean (git status: 0 changes).
Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/r12/` (`S/` below). Probe logs: `S/logs/<probe>.log`, sweep summary
`S/logs/summary_a.txt`; a scratch copy of the game for experiments while the sweep runs on the real tree: `S/w/` (node_modules linked).
Inputs read: SESSION3.md, R11_FIX.md, R10_FIX.md, R10_PLAYUX.md, R10_LOCOMOTION.md, VERDICT_R10.md (their open lists).

## Status (10:17 UTC; the fixes were made in the scratch copy `S/w/` while the sweep ran on the real tree, then copied in at 10:10 to 10:14)
| item | what | state |
|---|---|---|
| 0 | sweep A: every node probe once (52 entries), sequential, on the unchanged tree | DONE 09:59 (table below) |
| 1 | probe_pg_data DT-01 Home x2 | FIXED: the camera model's pin (D-97 added `&& !floatMode` to stage.ts's rest-aim line) |
| 2 | node_checks pointer row | FIXED (product: gestures.ts outward test); the row ok, probe_gestures 160/160. It changes the run's later trajectory: see 4b |
| 3 | probe_float F4 Table at Hearthlog | FIXED (product: later-life.ts landing hold); probe_float 16/16 with new rows F7, F8 |
| 4 | node_checks "Go play with... on MED" | PARTLY: song hold fixed (LIFE); the shelf stand traced (the resting Felt Ball blocks the glide head-on at Home, where no unstick acts); row still red |
| 4b | node_checks B7 rows (5 out on high; the wake gate) | newly RED after item 2 (the run's trajectory changes once the pointer row lifts Dollop): traced, not fixed |
| 5 | probe_crawl CR-12 | RE-SPECIFIED (D-100 with D-101): bar 25 -> 60 us per body, measured 27.9 / 31.9 / 47.3 us; step 20 to 21.5 us (bar 30 kept) |
| 6 | Ripple tall Shell Chimes | FIXED (data + LIFE): DT-01 Ripple tall ok both rows; SU-04 Ripple 4 / 4 with shellchimes in all four (tall low, tall high too) |
| 7 | lane crossings | node rows: probe_float F7, F8; probe_partycut C6, C7, C8, C9 (10/10); D-101 x crawl frame cost measured (below) |

### 1. DT-01 Home x2 (probe_pg_data): the camera model's pin
Cause: both rows stop when the model's pinned source lines of `src/render/stage.ts` change ("stage.ts camera changed ... missing: if (autoFraming && !p.playerMoving)"). R10_PLAYUX
(D-97) made it `if (autoFraming && !p.playerMoving && !floatMode)` (a floating squishy is followed). The model places the bodies at their slots with Float OFF, where the line
does what it did, so the model is still exact: the NEW text is pinned (`_harness/probe_pg_data.ts`, with the reason at the pin). Not a loosened check: any further change of
the line still stops the model. After: DT-01 Home ok, DT-01 Home B5 ok ("covers 0.0 px of the body, 0% hidden, 0.48 m from it, 1.05 m of roll room"). DT-18: the silhouette
part stays red (known, owner told); **the tap-point part passes** ("the through-tap is in place").

### 2. node_checks "the host never takes a pointer it does not hold" (pointer -1 drag lifts the squishy)
Trace (`S/w/_harness/shellview/dbg_ptr.ts`, the section trimmed): at the press Dollop is WALKING (FIRST_PLAY's walk, crawl on: D-100's turn-then-crawl makes the walk
last longer than the glide did, so the row now presses a moving squishy). The press (40 px right of its centre) stops the walk (touch gate) and shoves it 10 cm back; its screen
centre moves; gestures.ts measured "outward" from the LIVE centre, so the up-and-out drag read as a rub (cos below 0.2): fingers 1, never grabbed. With the crawl off or
without its yaw the body is at rest at that moment and the row passes. **Fix (product, `src/input/gestures.ts`)**: a press remembers the body's screen centre at the press
(`pcx`, `pcy`); a drag is a pull if it is outward from the live centre OR from the press-time centre (for a still body both are one point: the published rule unchanged).
After: the row ok ("carried true"); probe_gestures 160/160 (the shift fuzz 258 mirrors, 0 violations; a first version that used the press-time centre ALONE dropped the fuzz's
mirrors to 185 < its 200 coverage floor, so the OR form was kept).

### 3. probe_float F4 "Table at hearthlog: everyone back on the ground within 3 s" (tRest -1)
Trace (`S/w/_harness/dbg_float.ts`): after Table the shoved Capnap touched down at 0.5 s and LIFE started a walk AT ONCE (autonomy came back with Float off), mid landing squash;
with D-100's crawl a walking body's centre rises and falls (the hump), so the party never came to rest (with the glide a walker's height stayed flat). **Fix (product,
`src/shell/later-life.ts`)**: after Table LIFE's motion (autonomy, SCOOT, HOP, SQUASH) stays parked until every squishy out is on the ground and still in the same frame (centre
vertical speed under LAND_V 0.05 m/s, not airborne), at most LAND_MAX_S 3 s; a use the player asks for is not held. (A first version that waited "1 s on the ground" was not
enough: a jelly's landing wobble runs 1.5 to 2 s at 0.1 to 0.4 m/s.) After: probe_float 16/16 (F4 Table hearthlog tRest 1.98 s, ripple 1.53 s, Home F3 1.75 s).

### 4. node_checks "Go play with... on MED" (song hold fixed; the shelf stand traced, still red)
Read from the code: a SING moment lasts the wait to the next bar line + 2 bars (BAR_S 3.64 s: 7.3 to 11 s); round 7 kept an asked squishy in a song until it ended
(keepsMoment), and social.ts canSing recruits a squishy whose use still waits in phase 0 (an asked use too) into a starting song. With D-101 three are awake and sing
together at the kettle more often. **Fix (product, LIFE)**: `social.ts` canSing: one the player asked (pW >= 0) is not called into a song; new `leaveMoment`: an asked
squishy already in a song leaves it on its own and the others sing on (the moment ends only when none is left); `brain.ts` uses it (a teeter or a push still waits: its
partner rides on it).
Trace of the shelf ask (`S/w/_harness/shellview/dbg_n1.ts`: node_checks' header + section 13 up to the row, the asked squishy every 3 frames; `S/logs/dbg_n1_*.log`;
physics' scoot end instrumented in a scratch copy only): the asked Crimpo's walk to the shelf's row spot (1.18, -0.48) starts at 0.8 s and ends 0.2 s later with
**scootBlock** (softbody.ts: a static prop pushes the glide back head-on) at (0.53, -0.57): the resting Felt Ball (home 0.7, -0.65) lies on its way. LIFE stays in
the walk until its timeout (11 s) and drops the ask. In places the host's unstick (round 9) lifts a body past what holds it, but only in places and only for spots
over 1 m away. Tried and REVERTED (no effect on the row in the full run, unverified otherwise): an asked use acting at the timeout within 0.6 m (Home's shelf goes
through runUse, not runSelf); the unstick for asked walks at Home. NOT FIXED: the next step is the host's unstick (or LIFE's re-plan) for an asked walk whose glide
physics blocked, at Home too, with node_checks run whole (the row is chaotic in the trimmed rig: its trajectory depends on every earlier row).
The yarn ball: in the sweep's full run its walk started at 9.3 s (R11 put it on a song at the kettle); in my trimmed and scratch runs it started at 7.2 s with the OLD LIFE
code and with the new one alike, so the song fix is from the code, NOT shown by a run (the 9.3 s case did not reproduce here).

### 4b. node_checks B7 rows newly red after the pointer fix
With item 2 the pointer row now lifts Dollop (as the row intends), so every later row of the section runs on a different trajectory. Bisect (`S/logs/nc_scratch_gestonly.log`:
the real tree + gestures.ts only): node_checks 183/186 with the two B7 rows red ("5 out on high: over the cap in 5 of 24 one-second samples, longest run 2 s", bar 2 of 24 and
never 3 s; "wake gate: over the cap in 23 of 144 samples, 16.0 %", bar 10 %) and N1. Trace (`S/w/_harness/shellview/dbg_b7.ts`, `S/logs/dbg_b7.log`): at every over-cap
sample 4 of the 5 are awake, none scooting; LIFE has up to 3 movers (D-101's 3 tokens) plus members of a running moment (beh 21): the over-budget rule never sleeps a
squishy LIFE counts busy (a walk, a moment), so with D-101's three movers one more awake (a moment partner, a bumped sleeper) is over the 3.81 cap until the rule finds
an idle one (up to 2 s). These rows were written for the pre-D-101 caps; D-101 names "the B7 wake-gate rows and similar" as rows to re-specify, but I did not re-specify
them in this round (no time to justify a new number with measurements across seeds): they stay RED with this cause written.

### 5. probe_crawl CR-12 (the crawl's cost): re-specified for D-100 with D-101
Measured on this tree (`node _harness/probe_crawl.ts --only=cost`, quiet machine, three runs): crawl - squash pose **27.9, 31.9, 47.3 us per body** (the difference of
two ~1.5 ms frames; the squash pose's own frame moves 1.511 to 1.536 ms between runs), the crawl's own step **20.3 to 21.5 us** (its 30 us bar holds every time);
R10_LOCOMOTION measured 38.5 us on a loaded machine. Trim looked for: the step is two passes over the particles (the wave, then its centring and the volume
correction, which need the first pass's sums), and the rest is the squash pose's own goal path; no cut that keeps the motion bit for bit was cheap. **New bar 60 us per
body** (the reason is written at the row): at the low tier D-101 lets three walk at once: 3 x 60 us = 0.18 ms a frame = 4.5 % of the low tier's 4 ms physics budget
(PF-00), about 7 % of one awake whole's own cost (C_WHOLE_MS 0.87 ms). The 25 us bar was set at LOCOMOTION step 2, before the facing turn of step 6.

### 6. Ripple's tall Shell Chimes (data + LIFE)
Data (`src/data/place_ripple.ts`, tall only): the chimes from (1.026, -3.103) behind the bounds' back edge to (1.02, -2.72) (along x, a squishy's back reaches the shells
from inside the bounds); the Pebble Ball 0.13 m forward (-0.12, -2.12) and the Sand Mound 0.27 m forward (1.33, -1.53) to keep 0.3 m from the row and the Bob Ring;
the five spawn spots re-laid from DT-01's own spawn map (`SPAWNMAP=ripple:tall`, best 5): (-0.55, -0.9), (0.35, -0.35), (-0.55, 0.1), (0.3, 0.65), (0.5, 1.65).
Tried first and dropped: the right strip along z (front right, 1.05, 2.05): DT-01 then allows only 4 spawn spots (SPAWNMAP best 4); the back row with the mound and
ball unmoved: 0.08 m from the mound, 0.27 m from the ball. probe_pg_data after: DT-01 Ripple tall 0 problems, in the shipped camera 0 problems (the finger reaches
them: inside the frame, above the hint pill). LIFE: the row's right end is 0.2 m past the bounds' side, so `brain.ts` selfPoint RING found NO walk line (both ends
must be in the shrunk bounds): a row that runs past the area's edge is now walked along its part inside the area, from the nearer end, when that part is at least
RING_MIN_M 0.7 m. **Only in the TALL layouts** (10:24): applied to both, it also changed the WIDE Lanternroof visit of probe_life_selfuse --quick (the
Lantern Line walked earlier) and SU-05 then caught a NOTICE / BASK flip there (wisplet at 33 s, 4 switches in 5 s, 0.07 m; `S/logsb/probe_life_selfuse.ts_--quick.log`);
the wide layouts' rows lie inside their bounds (DT-01), so the fallback is for the 2.8 m wide tall layouts only; --quick after it: SU-05 none, Lanternroof as before.
**SU-04 for Ripple** (`node _harness/probe_life_selfuse.ts --su4-only places=ripple`, real tree, `S/logs/su4_ripple.log`): tall low **4** [pebbleball driftlog **shellchimes**
sandmound] (3 by 80 s), wide low 5 [pebbleball rockpool shellchimes sandmound driftlog], tall high 4 (with shellchimes), wide high 5; SU-05 none. (R11: tall 4 without the chimes.)

### 7. Lane crossings (node rows; scratch)
| row | what | result |
|---|---|---|
| probe_float F7 | Float (D-97) x the crawl (D-100): a squishy crawling when Float comes on stops crawling, never crawls while floating, does not turn | ok: crawl off 0.117 s, turn 0.12 deg in 4 s |
| probe_float F8 | Float while one of a party of three is cut (D-99): 2 pieces + 2 wholes float, Table brings all down | ok: min rise 0.227 m, rest 2.32 s, fall 0.93 m/s |
| probe_partycut C6 | right-button drag orbit with the Cut tool, three out, one in pieces (D-98 x D-99) | ok: 8 orbits, same pieces, no refusal |
| probe_partycut C7 | the + Friends picker while one squishy is in pieces | ok: the friend whole, the pieces stay, Reconnect all whole, friend still out |
| probe_partycut C8 | the + Friends picker at a place (the cabin) | ok: 2 came, all inside the area (worst -0.9 m), 2.04 m apart, LIFE characters |
| probe_partycut C9 | cutting a squishy that is mid-crawl (D-100 x the cut) | ok: 2 pieces, max 0.001 m/s, finite, whole again |

**D-101 x the crawl, three walking at once at the LOW tier, frame cost** (`S/w/_harness/perf_d101.ts`: probe_float's rig, the real SoftBody + props + LIFE + host,
Ripple wide, 3 out (Dollop, Glimglop, Crimpo), stats tier low (unitCap 3.81), each body handed a 1.2 m walk every 5 s if LIFE has none; 6 interleaved 20 s blocks crawl /
glide (Calm); app.stepOnce timed per frame and bucketed by how many are awake / walking / crawling; `S/logs/perf_d101.log`):
| bucket (3 awake) | crawl: mean / median ms per frame | glide: mean / median |
|---|---|---|
| 3 walking (3 crawling) | 2.953 / 2.666 (n 269) | 3.238 / 2.650 (n 92) |
| 2 walking | 3.013 / 2.761 (2 crawling, n 2795) | 2.794 / 2.671 (n 4185) |
| 1 walking | 2.883 / 2.651 (n 676) | 2.753 / 2.699 (n 1307) |
Three crawling at once cost about +0.02 to +0.09 ms per frame over the glide (medians), inside the ~0.9 ms per awake whole that D-101 already pays (R11_FIX 1);
node, this container, no render.

## Sweep B: the probes the changes touch, re-run on the changed tree (10:16 to 10:23 UTC, `S/runallb.sh S/listb.txt b`, logs `S/logsb/`)
| probe | sweep A | sweep B |
|---|---|---|
| probe_float | 13/14 | **16/16** (F4 ok; new F7, F8) |
| probe_partycut | 6/6 | **10/10** (new C6 to C9) |
| probe_pg_data | 42 ok / 3 FAIL | **44 ok / 1 FAIL** (DT-18 silhouette, known; its tap-point part ok; DT-01 Ripple tall both ok) |
| probe_gestures | 160/160 | 160/160 |
| probe_crawl | 13/14 | **14/14** (CR-12 re-specified to 60 us; this run: crawl - squash pose 30.2 us, step 20.4 us) |
| probe_life | 127/128 | 127/128 (LF-02, known; re-run again after the tall-only change 10:26: the same) |
| probe_pg_lifequests | 16/16 | 16/16 (again 10:26: 16/16) |
| probe_quests | all run pass | all run pass (again 10:26) |
| probe_chatter / probe_app / probe_party / probe_playground / probe_journal / probe_r8_features / renderview pg_node_checks | pass | pass (42/42, 188/188, 10/10, 74/74, all, 9/9, 40/40) |
| shellview/node_checks | 184/186 | **183/186**: pointer row ok; N1 still red; the two B7 rows red (item 4b) |
| probe_life_selfuse --quick | SU-01 rainleaf red | SU-01 rainleaf red (same 2 things); SU-05 red with the RING fallback in every layout -> fallback limited to tall: SU-05 none (10:25) |
| probe_life_selfuse --su4-only places=ripple | (R11: tall 4 without chimes) | 4 / 5 / 4 / 5, shellchimes in all four, SU-05 none |

## Sweep A (HEAD dc3ccc0ad, unchanged tree; one at a time 09:27 to 09:59 UTC; `S/runall.sh S/list.txt a`, logs `S/logs/`)
All 52 node probes (44 `_harness/probe_*.ts` as run_probes runs them: truecut and many `--quick`; probe_life_selfuse `--quick` (its default run is 37 min);
shellview node_checks, cut_checks, cut_mock_checks, cutter_checks, lock_checks; renderview pg_node_checks, eye_checks --quick, piece_checks --quick).
| probe | pass / total | red rows |
|---|---|---|
| probe_app | 188/188 | |
| probe_boot | 30/30 | |
| probe_catalog | all pass | |
| probe_chatter | 42/42 | |
| probe_collection | 73/74 | C08 previewTouch allocation 160000 B / 20 000 calls (known since the session baseline) |
| probe_collection_imports | 10/10 | |
| probe_crawl | 13/14 | CR-12 crawl - squash pose 27.9 us per body (bar 25); crawl step 20.4 us (bar 30) |
| probe_cut | 17/17 | |
| probe_economy | all pass | |
| probe_families | 22/22 | |
| probe_float | 13/14 | F4 Table at hearthlog (tRest -1) |
| probe_flush | 11/11 | |
| probe_genome | 25/25 | |
| probe_gestures | 160/160 | |
| probe_journal | all pass | |
| probe_life | 127/128 | LF-02 (known, leave) |
| probe_life_imports | all pass | |
| probe_life_selfuse --quick | 10 ok / 1 FAIL | SU-01 rainleaf: 2 things in 120 s, one party (Wisplet + Chunkle + 1, wide, high; one run) |
| probe_lock | 82/87 (2 known open) | LOCK orders crimpo, LOCK slots cushlet, LOCK perf (the same 3 since VERDICT_PG) |
| probe_lock_shell | 96/96 | |
| probe_lockfx | 15/15 | |
| probe_many --quick | 43/43 | |
| probe_materials | all pass | |
| probe_merge | 22/22 | |
| probe_neck | 8/8 | |
| probe_optbar | 42/42 | |
| probe_overlays | 21/21 | |
| probe_parts | 11/11 | |
| probe_party | 10/10 | |
| probe_partycut | 6/6 | |
| probe_pg_data | 42 ok / 3 FAIL | DT-01 Home, DT-01 Home B5 ("stage.ts camera changed"), DT-18 silhouette (known); DT-18 tap-point part ok |
| probe_pg_economy | all run pass (2 NOT RUN) | |
| probe_pg_lifequests | 16/16 | |
| probe_playground (quick) | 74/74 | |
| probe_portal | 82/82 | |
| probe_quests | all run pass (3 NOT RUN) | |
| probe_r8_features | 9/9 | |
| probe_screens | 43/43 | |
| probe_softbody | 115/116 | G1p warmUp lone finger 2976 B / frame (the same row in R8_LIFE, VERDICT_R9) |
| probe_species | 25/31 | press gloopsy, FULL PULL putty, RUBS x4 (the same 6 since VERDICT_PG2) |
| probe_tips | 34 cuts, 33 within the bars, 1 refused by design: pass | |
| probe_trophies | 31/31 | |
| probe_truecut --quick | 104/113 | G2, G3 x2, G4 x4, G7 nested, L2 rest pose (the same 9 since VERDICT_PG2) |
| probe_uikit | 62/62 | |
| shellview/node_checks | 184/186 | pointer row ("carried false"); "Go play with... on MED" (shelf moved 0.02 m; yarn ball walk at 9.3 s) |
| shellview/cut_checks | 16/16 | |
| shellview/cut_mock_checks | 48/48 | |
| shellview/cutter_checks | 118/119 | X12 nested piece volume 14.9 % off its share (wisplet): the same open PHYS item since CUT-A (CUT_C_VERIFY_physr1 m-g) |
| shellview/lock_checks | 96/96 | |
| renderview/pg_node_checks | 40/40 | |
| renderview/eye_checks --quick | all pass | |
| renderview/piece_checks --quick | all pass | |
Pre-existing reds NOT in the brief's list (physics / cut-geometry / JIT rows red in every verdict since VERDICT_PG): probe_lock 3, probe_softbody G1p, probe_species 6,
probe_truecut 9, cutter_checks X12, probe_collection C08. They are long-standing physics / cut-geometry / allocation rows, red with the same values in earlier verdicts;
not attempted in this 90-minute round (named, not hidden).

## Red rows: before and after (the rows this round was asked about)
| row | before (sweep A) | after | how |
|---|---|---|---|
| node_checks pointer row | red | **green** | product: gestures.ts outward test from the live OR the press-time centre |
| node_checks "Go play with... on MED" | red | red | song hold fixed in LIFE (from the code); the shelf stand traced (Felt Ball blocks the glide at Home); not fixed |
| node_checks B7 x2 | green | **red** | exposed by the pointer fix's new trajectory (4 awake: 3 movers + a moment partner); traced, not fixed, not re-specified |
| probe_float F4 Table hearthlog | red | **green** | product: later-life.ts landing hold |
| probe_crawl CR-12 | red | **green** | re-specified (D-100 x D-101): 60 us, measured 27.9 to 47.3 us; trim not cheap |
| probe_pg_data DT-01 Home x2 | red | **green** | the camera model's pin updated for D-97's line |
| probe_pg_data DT-18 silhouette | red | red (known; owner told) | its tap-point part green |
| probe_life LF-02 | red | red (known, leave) | |
| probe_life_selfuse --quick SU-01 rainleaf | red | red | not looked at (one party, one run; SU-04 is the bar's row) |
| long-standing physics rows (lock 3, softbody G1p, species 6, truecut 9, cutter X12, collection C08) | red | red | not attempted (named above) |

## Files changed (real tree; scratch copies and debug scripts stay in `S/w/`)
src/input/gestures.ts (outward test, `pcx` / `pcy`); src/shell/later-life.ts (landing hold after Float: LAND_V, LAND_MAX_S, landT, landY); src/life/social.ts
(leaveMoment, canSing skips an asked squishy); src/life/brain.ts (an asked squishy leaves a song; RING row fallback in tall layouts); src/data/place_ripple.ts (tall:
Shell Chimes, Pebble Ball, Sand Mound, spawn spots); _harness/probe_pg_data.ts (the camera model's D-97 pin); _harness/probe_float.ts (F7, F8; header);
_harness/probe_partycut.ts (C6 to C9); _harness/probe_crawl.ts (CR-12 re-specified with its reason); this report.

## Not done / open (for the next engineer)
1. node_checks N1, the Keepsake Shelf ask at Home: an asked walk whose glide physics blocks (scootBlock: the resting Felt Ball head-on) waits out its 11 s timeout
   and drops the ask; Home has no unstick. Next: let the host lift or re-plan an ASKED walk blocked by a prop at Home (and keep the asked walker awake), then run
   node_checks WHOLE (the trimmed rig does not reproduce the full run's trajectory). The song fix (asked squishy leaves a song) is shown by no run yet.
2. node_checks B7 x2: with D-101's 3 movers the over-budget rule cannot sleep a squishy LIFE counts busy; a 4th awake (moment partner, bumped sleeper) stays over the
   3.81 cap up to 2 s. Either the rule may sleep a moment's idle partner, or the rows are re-specified under D-101 with measurements over several seeds.
3. probe_life_selfuse --quick SU-01 rainleaf (2 things, one party, wide high).
4. The long-standing physics rows listed above.
5. No browser run this round (node rows for every crossing instead); the Ripple tall re-lay is not looked at in a browser (DT-01's shipped-camera row passes).

## Final checks (10:36 to 10:38 UTC, the changed tree)
- **SU-04 at every place** (`node _harness/probe_life_selfuse.ts --su4-only`, `S/logsb/su4_all.log`, after the tall-only fallback): **24 of 24 ok, SU-05 none**. Tall low
  = tall high: Hearthlog 5, Ripple 3 [pebbleball **shellchimes** driftlog], Frostbell 3, Rainleaf 5, Lanternroof 5, Cloudloft 3; wide low = wide high: Hearthlog 5,
  Ripple 4 (with shellchimes), Frostbell 5, Rainleaf 3, Lanternroof 3, Cloudloft 3. (One seed; R11's seed-default table had Ripple tall 4 without the chimes.)
- `npx tsc --noEmit -p tsconfig.json`: **clean** (exit 0).
- `node node_modules/vite/bin/vite.js build --outDir S/dist` (the repo's dist untouched): **exit 0**, built; [G0] 2526 KB of 3072; [G0b] first play 463 KB gzip of 600;
  **[T1] 2104.2 KB of the 2250 KB cap** (R11: 2103.0 KB).
- No process of mine left running (`ps` shows no headless_shell, vite or _harness job); no git write command was run.
