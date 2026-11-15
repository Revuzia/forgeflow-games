# C-verify ledger (Lane C tasks 1-3, verification agent)

## Task 1: arc scenario in determinism — `tests/arc-determinism.test.ts`
Babel world (seed 1, n=20). Scripted arc: covenant.offer (debug flood) -> covenant.make `gentle` -> tower (babel begins it) ->
tower.confuse at the first choice -> defiance.set + pride.set -> miracle.storm on the defiant town -> miracle.lightning with
`covenant:'break'` -> defiance.answer mercy. One straight run; save at the save year (saving must not change the hash); load;
run the loaded copy to the end; hashes and the act log must match.
- Default (short, ~60-75 s on a loaded 4-CPU box): save year 5, end year 8, acts at y0.1 y0.3 y1.0 y2.0 y2.5 y3.0 (+mercy y4).
  PASS. Ages seen: making, tower, flood, covenant, scattering, brokenvow; covenant `broken`; tower `scattered`.
- `ARC_LONG=1`: save year 40, end year 80 (acts at y12/14/16/20). `ARC_TRACE=1` prints the first differing day. ~20+ min.
- Note: a covenant with vow `no-flood` does NOT break on a lightning cast with `covenant:'break'` (only a cast the vow would
  refuse breaks). My first version used no-flood, so no break happened; fixed to `gentle`.
- Long-form failure (first version, no-flood vow): hash differed at year 80; first differing day was 86 then 153 after year 40
  in two runs (it moved between runs, and the tree was being edited by others). Not reproduced in-process in: 4->8 years
  (no script), 10->22 years with the script (144 days compared), 40->52 years with the script and a real break (144 days
  compared, every day hashed). So no field-level save/load loss was found up to year 52. Root cause of the year 47-80
  divergence: FOUND (below).
- Scripts used: `_harness/probes/arc-diverge-diag.ts` (lockstep a/b per day, dumps header diff and array diffs at the first
  differing day).
- Stage-C sim pieces: all exist (covenant, story/ages/epithet, legends, tower, defiance); nothing stubbed on the sim side.
  Not covered by the scenario: legends gen 2 (needs > one retell interval), second covenant.

## Task 2: epithet cache
- `src/sim/god/story.ts`: `epithetOf` now memoises one value per (universe, planet, tick, signature). Signature = tick,
  arcEvents.length (append-only), ages.length, every godActs value, covenant status/made/signAt. A command inside a tick that
  changes any of these rebuilds it. `epithetUncached` is the old scan, exported for the test. No behaviour change.
- Test `tests/arc-epithet.test.ts` (44 s): cached == uncached at every step of a run with covenant, break, strikes, food,
  omens, also after each command in the same tick and after a load; the epithet takes >= 2 values during the run. PASS.
- Measured (`_harness/probes/arc-snapbench.ts`, 1505 agents, 300 arcEvents written into the god state, load average ~14):
  epithet scan 0.009-0.015 ms uncached, ~0 cached (3000 events: 0.081 ms). Snapshot p50 per tick 1.2-2.4 ms
  (same-tick repeat 0.8 ms). Target 8 ms: MET with a wide margin. The cache is correct insurance, not a measurable win:
  the scan was never what made a snapshot slow.
- `perf_worker.ts 1500 15 100,1000` (noisy, load 14): before (uncached) 100x: 100 ticks/s, 1000x: 330 ticks/s (sim 5.6 ms/tick
  noise); after (cached) 100x: 99 ticks/s, 1000x: 371 ticks/s (sim 2.3 ms/tick). Snapshot round trip p50 4.7-6.3 ms at 100x,
  17.4 ms at 1000x both before and after. No difference outside machine noise.

## Task 3: probes
### C3: 25-year trust ceiling (`_harness/probes/arc-c3-ceiling.ts <seed> 25 broken|control`)
One town of 40 bronze plains folk, natural disasters off, covenant `gentle`, broken by a lightning cast with `covenant:'break'`;
then every day food + heal + prayer.answer for 25 years (300 samples; a game year is 12 game days on this planet).
| arm | seed | town survived | peak trust of any person | days over ceiling (+0.005) | worst overshoot | w at end | ceiling at end |
| broken | 1 | yes | 0.80 | 7/300 | 0.048 | 0.4998 | 0.80 |
| broken | 2 | NO (fell by day 8) | 0.747 | 4/8 | 0.047 | - | - |
| broken | 3 | yes | 0.798 | 4/300 | 0.046 | 0.4998 | 0.80 |
| broken | 4 | yes | 0.798 | 5/300 | 0.048 | 0.4998 | 0.80 |
| control (no covenant) | 1 | yes | 0.984 | - | - | - | - |
Reading: the ceiling holds. After the break, trust never exceeds max(0.5, 0.9-0.2w) except for transient overshoots of
<= 0.048 on 4-7 days of 300 (days 2-4 after the break and isolated days later: gains between the daily clamp), always clamped
by the next day. w decays 1 -> 0.5 over 25 years (ceiling 0.705 -> 0.80). Control reaches 0.984. C3 acceptance is closed.
Caveats: seed 2's town died within a week of a 0.7-wrath bolt (no 25 years there). `trustGainScale` (gains x 1/(1+w)) still
has no caller; the ceiling alone binds. Seed 1 peaks differed 0.80 vs 0.82 between two runs (live tree edited by others).
### T2: 8-seed unattended tower probe (`_harness/probes/arc.ts unattended <seed> 60`, via probe-t2.sh pattern)
Sandbox n=20, 60 plains folk, bronze, natural disasters on, no god acts, 60 years.
| seed | towns | towers begun | pride per town (end) | secs |
| 1 | 5 | 0 | 0.31 0.03 0.03 0.03 0.03 | 254 |
| 2 | 5 | 0 | 0.03 0.13 0.18 0.03 0.10 | 279 |
| 3 | 6 | 0 | all <= 0.03 | 259 |
| 4 | 4 | 0 | 0.29 0.03 0.03 0.03 | 252 |
| 5 | 6 | 0 | 0.15 .. 0.12 | 280 |
| 6 | 3 | 0 | 0.20 0.03 0.16 | 207 |
| 7 | 6 | 0 | all 0.03 | 164 |
| 8 | 3 | 0 | 0.71 0.03 0.03 | 175 |
Result: NO tower begins unattended on 8/8 seeds in 60 years (0 begun, so 0 completed, no years to report). Highest end-pride
0.71 (seed 8, one town) is not enough alone: a tower needs a proud league (>= 2 proud towns of one speech). Only the `babel`
scenario produces a tower (begun within 30 days). This feeds owner question 4 (tower pacing): in a plain world the tower never
comes by itself; it needs pride seeded or a god act.

## Other findings
- detban clean (152 files). Frozen trace/diagnostics under `_harness/scratch/arc/C-verify/`.

## ROOT CAUSE of the save/load divergence (found and fixed)
- Long form (save y40, end y80) differed from day 200 after the reload (year ~56.7). Header diff at that day: two chronicle
  entries of the same tick swapped places ("The water fell back from Ashuk ..." / "The river at Rabavor ... went back"), refs ids 2 vs 18.
- Cause: `evacuationsHourly` (src/sim/god/precursors.ts) looped `Object.entries(R.st)`. A saved game stores R.st with sorted keys
  (state.ts relJson), a live world has insertion order, so when two towns' flood evacuations ended in the same hour the
  `flood.home` lines were told in different orders after a load. Not a missing field: no state was lost.
- Fix (mechanical, no balance change): iterate `Object.keys(R.st).sort()`, as `missionEvacuation` already does. Only one other
  unsorted R.st loop existed (none left). Focused test `tests/arc-evac-order.test.ts` (fails without the fix, passes with it).
- Verified: the 40 -> 58 year comparison (216 days, hash every day, with the full script and a real break) now shows no difference.
  The full 40 -> 80 form (ARC_LONG=1) was not re-run after the fix (about 50 min); the first-differing day was 200 in it, and
  that day is now clean.
- The default test is now the short form (~60-75 s on a loaded box; save y5, end y8).
