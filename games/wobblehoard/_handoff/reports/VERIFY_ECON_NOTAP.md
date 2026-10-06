# VERIFY_ECON_NOTAP: independent verification of "short taps pay nothing" (RUNNING REPORT, first pass; ECON_NOTAP.md not yet read)

Verifier: independent (did not write the code; the engineer's report ECON_NOTAP.md is read only after the first pass).
Snapshot: tree hash `7ba0e0554ea84f88` (249 files; live tree and copy identical at copy time), made with scratchpad\tools\snap.mjs into
`...\scratchpad\verify\econ\games\wobblehoard`. It is the LIVE working tree (uncommitted ECON edits on top of HEAD 7302bca9), not a commit.

## Setup facts (deviations, stated plainly)
- The snapshot path is 279 characters. Node (ESM package-scope lookup) fails inside it: `node node_modules/typescript/bin/tsc` printed
  `ERR_PACKAGE_IMPORT_NOT_DEFINED ... "#getExePath"` there, while the same command on the live tree prints `Version 7.0.2`. So I made a
  byte-identical copy of the snapshot at a short path, `C:\Users\TestRun\AppData\Local\Temp\vq\wh`, and verified `treeHash(copy) == 7ba0e0554ea84f88`
  with the same treehash.mjs. All runs below are in that copy. Not one source file was edited.
- snap.mjs skips every folder named `dist`, which also drops `node_modules/*/dist` (vite and others): tsc in the copy said
  `Cannot find module 'vite'`. As RESUME.md section 1 prescribes, the copy's `node_modules` is a directory junction to the live
  `G\node_modules` (read only use; nothing is built, no vite cache is written). Removed at the end.
- A second short dir `...\Temp\vq\base` holds `git archive 7ac724b7^` (= b2ed8e1b, the tree before the ECON edits; its economy files are the 19f62137 state) for before/after numbers.
- No browser. No `claude -p`. No git write command. My scripts: `...\Temp\vq\scripts\tap_hunt.mjs`, `tasks_probe.mjs`.

## Status per item (first pass, updated as I go)
| item | status |
|---|---|
| tsc | CLEAN: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`: no output, exit 0, 1.1 s, covers 116 src files plus _harness .ts |
| 1 tap-pays hunt | meter core: NO tap pays (400k hostile taps, 0 violations). TWO tap-adjacent paths remain, see findings F1 and F2 |
| 2 sim re-run | DONE: output hash identical to the one DESIGN 5.4 quotes (see below) |
| 3 probes | not started (waiting for the baseline sim to finish: one heavy job at a time) |
| 4 docs and quotes | in progress |

## Item 2: simulation (my own clean run, the copy above, `node _harness/sim_economy.ts`, no flags, 241.2 s)
- SHA-256 of the output without the `(elapsed ...)` line = `4c5d0cf26dce22d81eb76e7e9d1b4b4f767480c285abc0d3f0ac0bc52e5813c0`: identical to the hash DESIGN 5.4 quotes for the engineer's run. The sim is deterministic (seeded), so my run reproduces every number of that table.
- Section A, micro-sim, 400 five-minute streams per style, min per 100 SP capsule (mean), before (tree b2ed8e1b, taps paying) -> after:

| style | SP/min before -> after | active min per capsule before -> after |
|---|---|---|
| poker (74% taps) | 28.0 -> 13.5 | 3.6 -> **7.4** |
| squeezer | 28.4 -> 30.8 | 3.5 -> 3.2 |
| puller | 27.4 -> 28.8 | 3.6 -> 3.5 |
| mixed | 31.8 -> 27.3 | 3.1 -> **3.7** |
| tapper (90% taps) | 30.1 -> 11.1 | 3.3 -> 9.0 |
| holder | 28.8 -> 31.0 | 3.5 -> 3.2 |
| a PURE tapper (only taps, 1/3 to 1/2 s apart, or 1 per s) | about 28 -> **exactly 0** (0 SP in 50 streams; 8 taps/s bot 0.0; tap every 250 ms bot 0.0) | never |

- The paying styles (squeezer 3.2, puller 3.5, mixed 3.7, holder 3.2) are inside 3.0 to 3.8 by mean and by median stream (median 3.2/3.5/3.7). The mixed style is 0.1 minute from the top of the band.
- Macro, regular players, whole run: active minutes per capsule median 3.5 (p10 2.7, p90 6.1), first capsule 77.1 s, all 50 in 247 (solo) / 153 (trade) days; poker needs 1.82 times as long as the fastest style to finish all 50.
- The population (assumed 38% pokers) is NOT in band: poker 7.4 min a capsule is beyond the 5.4 minutes DESIGN 5.6 calls "the edge of grindy". The pace claim holds for the paying styles and for the regular median, not for a tap-heavy player. MERGE_COST = 2 does not depend on the poker pace (it flips to 3 only below about 1.5 min a capsule), so it stands; but it is also true that a regular player now reaches a first pair in 12.5 min (was 10.4) and 48% have one by 12 min (was 57%).

## Findings so far (first pass)
- F1 (MINOR, owner decision): taps still earn a CAPSULE through the daily Tasks. `tasks_probe.mjs`: fed 25 pure pokes 0.9 s apart through the real collection: meter sp 0 -> 0, task "gentle-pokes-20" 20/20 done, claim ok, capsule credits 0 -> 1 (same for "pokes-sleepy-10", 15 taps). 46.0% of 400 (device, day) draws offer a tap task. Bounded by 2 a day and 5 a week. The meter itself pays nothing; DESIGN 5.4 and COLLECTION 7.10 disclose it as an owner decision.
- F2 (MINOR, lead): an UNSTRETCHED pull pays a flat 0.5 SP whatever the hold (`PAY.pullFail`): pull level 0.06, held 0.02 s pays 0.5; best cadence one per 3 s = 10 SP/min = 10 min per capsule. A short outward drag past the 14 px slop is the nearest thing to a tap that still pays. Not measured in a real camera (no browser): level 0.06 needs a drag of about 6% of the body's own maximum pull.
- F3 (see item 3 once run): the shell dev hook `src/shell/debugHook.ts` `fill()` feeds POKE events, so `__WH__.shell.grant()` / `fill()` can no longer earn a capsule (14 uses in browser_shell.mjs, 5 in node_checks.ts).
- F4 (MINOR, copy): task text `medley-1` still says "Poke, squeeze and pull within twelve seconds"; the medley now needs a squeeze and a pull (a poke does nothing). Disclosed in COLLECTION.md 7.10.
- Doc discrepancy: COLLECTION.md 7.5 says the best forged mix "reaches the daily 12 at 1.65 s per touch after about 41 minutes"; my script reaches 12 capsules after 30.6 minutes (1500 touches x 1.65 s = 41.25 min is the stream length). All other forged-stream numbers reproduce (6a 0 SP; 6b 4 capsules / 339.6 SP; 6c 4; 6d 10 capsules / 883.0 SP; 6f 47.2 min; 6g 59.7 min; 6h 62.1 min).
