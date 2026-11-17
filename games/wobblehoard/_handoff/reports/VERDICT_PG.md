# VERDICT_PG: independent verification of PLAYGROUND on the working tree (2026-11-17)

Running report (updated as each part finishes). Verifier: independent; wrote no file in `src` or `_harness`, ran no git write command.

- Tree under test: the working tree of `games/wobblehoard` as it stood at 13:00 UTC (HEAD ad49b7902 + 11 uncommitted files: `src/contracts.ts`,
  `src/life/social.ts`, `src/shell/hudBinding.ts`, `src/shell/later-life.ts`, `src/shell/lifeLink.ts`, 5 harness files, 2 reports), copied to
  scratch `pg_verify_final/tree` (so later edits by others do not move the target) and built there with `vite build`.
- Published reference: `_live_snapshot/2026-11-16` served statically (byte copy of the CDN), and `origin/squish-keeper-pc` (9211d66ba) for the
  node probes (`git archive` into scratch `pg_verify_final/pc`).
- Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify_final/` (scripts in `scripts/`,
  logs in `logs/`, screenshots in `shots/`). Ports 5374 (new build, static), 5375 (live build, static), 5376 (vite dev of the tree, dev hook).

Status: IN PROGRESS

## Running notes
- 13:10 Built the tree (`vite build`, 0.8 s): [G0] 2399 KB of 3072, [G0b] 461 KB gzip of 600. `tsc --noEmit` clean (exit 0).
- Rendering here is SwiftShader at about 1 fps at 1280x800 DPR 1, and the game clamps a frame to 1/20 s of sim, so real-input runs at DPR 1
  turn a 2.4 s hold into about 0.1 s of sim (my first live run earned no squeeze at all). The A-runs therefore use the exact CSS viewports
  (1280x800, 390x844) with deviceScaleFactor 0.5 on desktop and 1 on phone and hold 2.4x longer; the same script and timings on both builds.
- 13:40 A, desktop, both builds (`scripts/arun.mjs`, seed = a live-made save with a second Dollop for the merge): every step the same on both
  (wake, poke, first squeeze toast "Hello, Squishy", stretch, 9 holds earn a capsule on both, open it, Hoard Shelf/Gift/Today, merge with the
  last-copy modal, cut 2 pieces + "Clean Cut", Snap "Photo saved." with a real download, Float/Table, settings change saved, Trophies 8/20,
  keyboard 1/2/3/G/M/H/?/P/Esc and Space-hold squeeze, Tab walk). One difference: the lock sweep found no lock on the new build's merge result
  (Knubby; live's run had Puddlo). Controlled re-test with Dollop on both builds (`scripts/locktest.mjs`): live 2/2 locks, new 3/3 locks: not a
  regression. 0 console errors, 0 failed requests on both.
- 14:05 Save compatibility (`scripts/savetest.mjs`): the live run's save on live (A0) and on new (A1) shows the same play body, Hoard
  "2 of 50", shelf, Trophies 8/20, Music 42 and Calm on; new writes settings v3 (`autonomy:false`) and the journal key; that save on live (A3,
  the rollback) and back on new (A4) loses nothing (8 trophies, same ghosts, autonomy still false). 0 console errors.
