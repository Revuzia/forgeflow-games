# LOCK_VERIFY_physr1: PHYSICS re-verification of the LOCK fix round (verifier did not write the code)

Scope: re-run findings A..F of `LOCK_VERIFY_phys.md` with their own repros against the fix report `LOCK_ALL.md`, plus the neighbouring rows. No game file edited, no git write command. Real SoftBody, un-clamped pull targets, my own fold meter (max dihedral of neighbouring triangles), signed volume, lowest particle, NaN. Live rows: real mouse, real Shift / Escape, real CDP touch (dev server ports 5470 to 5472). The longer running log and every raw log are kept in `C:/Users/TestRun/AppData/Local/Temp/vpr1/logs/` (`LOCK_VERIFY_physr1_running_full.md` is the running log); tools in `.../vpr1/mine/` (`lv.ts` = the old verifier's tool, `pr.ts` late-lock, `pr2.ts` float, `pr3.ts` touch, `pr4.ts` gflick, `pr6.ts` pressgrab, `pr_browser*.mjs`).

## What was verified (state mismatch you must know)
HEAD `713081e6` holds the FIRST lock-fix design that `LOCK_ALL.md` says it WITHDREW (LIFT_OVER 1.3 + LIFT_DWELL 0.3 s + `Grab.overT`). The final design the report describes (LIFT_OVER 1.15, put-back `putDownForLock`, Float lock) is UNCOMMITTED (`softbody.ts`, `contracts.ts`, `probe_lock.ts`). So I built snapshots in `.../Temp/vpr1/` (a short path; the long scratch path breaks tar and node cwd): `snap_head` = `git archive 713081e6`; `snap_wt` = snap_head + those 3 files (hash-checked, taken 00:43); `snap_old` = `ab395ac6` (before the lock fix and CUT-C) for comparison. tsc clean on snap_head and snap_wt. Results below are `snap_wt` unless marked. Since then another lane edited `softbody.ts` (01:56, piece-contact code, 0 lock/grab lines in the diff) and `broad.ts` (diff not read) in the live tree: not covered.

## Verdict: FAIL. A and Float FIXED. B and C unchanged and still MAJOR. D, E, F unchanged (MINOR). Two new MINOR.

| id | was | now |
|---|---|---|
| A Shift dead after a drag past the pick-up line | MAJOR | FIXED (physics and live) |
| Float: a lock could never happen (shell verifier) | MAJOR | FIXED (physics) |
| B creases > 120 deg with locks held | MAJOR | STILL FAILS, identical numbers |
| C perf "6 locks <= 2 whole bodies" | MAJOR (second-hand) | STILL FAILS, now first-hand |
| D ground residuals | MINOR | unchanged; cushlet live is a new observation |
| E multi-touch creases live | MINOR | still present live; not reproduced for granulo in node |
| F allocation per step | MINOR | still present (constello) |

## A, FIXED
- `lv.ts --only=over` (granulo, dollop, twangle x ramps 0.2 / 0.5 / 1.5 s): lock success at raw target 1.0 / 1.08 / 1.14 / 1.2 / 1.5 / 3.5 x maxPull = 9/9 each (old: 0/9 from 1.2). The 1.5 x rows are carried (pull 0.07 .. 0.14) at the Shift and lockGrab returns true. Second lobe with one lock at 3.5 x: 3/3, carried 0. HEAD (dwell design) also 54/54.
- Quality after the put-back (`pr.ts --only=late`, 180 scenarios: 6 species x hand paths stay / up 1.5 m / reverse / down / orbit x Shift at 0.05, 0.6, 2.5 s after the lift x ramp 8, 40 frames): lock true 175/180; then not carried, locked 1, hold 3 s fold max 110, volume 0.91 .. 1.10, no NaN, nothing under the table, tip held out >= 0.95 x maxPull, release = exactly 1 snap (intensity 1.00), post-release fold <= 110, volume 0.98 .. 1.04. The 5 refusals are crimpo with the hand swung to the opposite side (lockGrab false, body stays carried; by design "else nothing changes").
- LIVE (960x600, granulo, real mouse + real Shift): full stretch at 204 px, lift at 240 px (a 36 px window, unchanged). Slow approach, 220 px, fast 440 px (x2), 300, 250 and 360 px drags then Shift: 7/7 locked; the five long drags were carried at the Shift (pull 0.08 .. 0.32) and locked with carriedAfter false. A fast 440 px drag with no Shift still lifts (2/2). Second lobe after one lock: no lift, locked 2.
- Pick-up unchanged: `--only=pick` on `ab395ac6` vs `snap_wt`, 8 species: onset frame 13, peak, final x, final hash and the per-10-frame hash trace byte-identical.
- Float: `pr2.ts --only=float`, 96 runs (8 species x pull 0.3 .. 3.5 x 2 ramps): refused 48/48 at 0.3 / 0.5 / 0.8 x, locked 48/48 at 1.0 / 1.2 / 3.5 x; locked rows fold <= 68, volume 1.00 .. 1.05, 1 snap at intensity 0.95 (note: a half-stretched Float lobe pays as 0.95, intended per LOCK_ALL).
- Star live: 5 tips locked at pull 0.971 .. 1.0, a 6th locked, a 7th refused, fold 110.2, volume 0.977 .. 1.058; a click released one (6 -> 5), Esc released all; settled (stretch 0, volume 1.035, fold 94).

## B, MAJOR, STILL FAILS (LOCK_ALL admits it)
`lv.ts --only=locks`, all 50 species (750 s): 6 locks accepted, 7th refused, lockAt distinct, 1 snap per release-one, 5 per release-all with right heldFor, volume 0.92 .. 1.08, no NaN, on 50/50. Fold > 120: hold-6 crimpo 179, pastrel 180 (post-release 156), selenuff 169, wrigglo 162; cindergoo post-release 169. Next worst 114. Same five, same numbers as the old verdict, and the same on HEAD. Repro: `node lv.ts --root=<snap_wt G dir> --only=locks --species=crimpo --trace=1`: 19 frames over 120 between frames 536 and 730 after the 6th lock (6 at >= 170, max 179; four consecutive at 536..539: 178, 150, 163, 147; locked 6, kinetic 1.0, lowest 0 mm): a 67 ms crease, not one blip. ORDERS (10 species, seeded lock / release / second pull / finger): fold > 120 in 5 of 10 (twangle 180, fossilo 176, kneadle 169, crimpo 128, pastrel 180). FUZZ (200 sequences, 50 species): fold > 150 in 10 (old verdict 6). SLOTS (5 fingers + 5 grabs): wrigglo 149, glimglop 126. Passing: carried-while-latched 0, lock-count mismatch 0, NaN 0, below table 0, latch never stuck (a lone hand lifts again 50/50), hostile input 0 throws (12 species), determinism 0 diffs (DET 50 species; ORDERS 10 x 2 runs).

## C, MAJOR, STILL FAILS (first-hand now)
`lv.ts --only=perf` (CPU ms per step, interleaved, median). Quiet machine (CPU 8 %): 6 locks vs 2 whole bodies in contact: granulo 1.18 vs 0.78 (1.5x), constello 1.30 vs 0.78 (1.7x), burrbin 1.18 vs 0.78 (1.5x), twangle 1.69 vs 0.78 (2.2x). Loaded (93 %): 2.08 / 3.26 / 3.13 vs 1.18 / 1.96 / 1.95. The relative bar (LOCK.md 3d) fails 7 of 7; the absolute 2.0 ms bar is met on all four when quiet (<= 1.69) and exceeded only under load. Engineer's `probe_lock.ts --quick` perf row: FAIL, 1.17 ms vs 0.65 ms (1.8x).

## D, E, F (MINOR)
- D, `lv.ts --only=ground`, 10 cases x 50 species: unchanged. Over 120: down-top-flick taffelin 165, skeinara 151, fossilo 121; very-long kneadle 175; angled-front tadpolo 180, taffelin 180; side-low crimpo 157, wrigglo 125, thudge 134, pastrel 176. Safe parts in all 500 runs: 0 inverted (vol min 0.84, end 0.98 .. 1.00), 0 NaN, lowest 0 mm. LIVE (real mouse 560 px straight down, never carried): dollop, chunkle, fossilo, twangle, crimpo, wrigglo, kneadle 110; CUSHLET 168 / 110 / 178 / 118 over four runs (snap_head 134, 137, 117, 130; snap_old 110 x4). Node cannot separate the versions: solver output is byte-identical old vs wt for fast flicks and large steps, and a press-then-pull on cushlet creases to 134 on all three. So one more species of the same family, not proven a regression (n = 4 per version).
- E, live 390x844 CDP touch: 2 fingers fold 79 (ok), 3 fingers outward 133 (old 143), 5 fingers outward 180 (old 180), 3 / 5 UP 110; never carried; slots 0..4 seen. Node (`pr3.ts`, 300 runs, ramps 1 / 3 / 30 steps): never carried; 5 fingers outward creases cindergoo 174 .. 180, tadpolo 177, wrigglo 172; granulo clean in every row.
- F, `lv.ts --only=alloc`: constello 34,560 B per 120 steps in all 7 windows (288 B / step; old 34,512); granulo, twangle, dollop, cushlet, crimpo 0 after warm-up; 6,000 lockAt / refused lockGrab / bad releaseLock calls 0 B on 6 species; heap after gc -4 .. +4 KB over 3,000 steps (no leak).

## New (MINOR)
- M1, the put-back is a one-frame teleport: the lifted body's centre jumps back to the mat at the Shift: median 4.7 R, max 13.6 R (twangle, hand 1.5 m up, Shift at 2.5 s), min 1.5 R. LOCK_ALL says "it jumps back"; it was not measured before and there is no easing.
- M2, commit state: if HEAD ships, the pick-up onset for the same drag is frame 32 .. 33 instead of 13 (0.33 s later; `--only=pick`, 8 species), the dwell design LOCK_ALL measured as failing the snap-mat carry and probe_gestures rows. Commit the working tree, not HEAD.

## Regression pass (snap_wt)
`probe_lock.ts --quick --only=rules,lock,det,robust` 17/17 (8.7 s; the one re-specified row keeps every numeric threshold and its written reason is honest); rest of `probe_lock` 28/31: 2 OPEN (ground sideways-from-low, orders twangle), 1 FAIL (perf). `probe_cut.ts --quick` 17/17 in 65 s (B3 pick up and toss, B3b two fingers never pick up, X07, X08, allocation row). tsc clean.

## Not measured
`probe_softbody`, `probe_flush`, `probe_gestures` (shell lane), the 4-lock cap on `low` quality, Float in the browser, a person hearing anything, real GPU frame rate, the 10,000-sequence fuzz (200 done), the 11 other live ground species, whether the live cushlet crease is shell or physics.
