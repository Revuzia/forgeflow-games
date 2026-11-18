# VERDICT_PG2: independent re-verification of PLAYGROUND after round 5 (2026-11-17)

Verifier: independent; wrote no file in `src` or `_harness`, ran no git write command. Running report: the Status line says how far it got.

- Tree under test: the working tree as it stood at 22:31 UTC: HEAD **a8fa3de13** plus three uncommitted files (`src/ui/wishes.ts` +2/-2,
  `_harness/browser_shell.mjs`, `_handoff/reports/FIX5_SHELL.md`). Copied (tar, without `node_modules`, `dist`, `_shots`) into scratch
  `pg_verify3/snap`; content hash of `src`, `_harness`, `index.html`, `vite.config.ts`, `public` = `884eb235...` (same on the tree and the copy).
  Built there: `vite build` 0.53 s, [G0] 2417 KB of 3072, [G0b] 462 KB gzip of 600; `tsc --noEmit` exit 0 (3.7 s).
- Published reference: `_live_snapshot/2026-11-16` (15 files OK against its `SHA256SUMS`), served statically.
- Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/pg_verify3/` (below `S/`): `scripts/`,
  `logs/`, `shots/`, `probes_new/`. Scripts reused from the first verdict (`pg_verify_r2/scripts`, paths changed only): `arun.mjs`, `savetest.mjs`,
  `crun.mjs`, `runprobes.sh`, `sizes.py`. New: `ghost5.mjs` (B1), `pg2.mjs` (the B findings and the new UI), `extra.mjs`, `goplay2.mjs`, `cut1.mjs`,
  `reqlog.mjs`, `fp.py`. Ports: 5374 new build (static), 5375 live build (static), 5376 vite dev of the snapshot (`?dev=1`), 5377 vite dev of the
  first verdict's tree cae532c34 (the control).
- Method: my re-checks were planned and run before I read `FIX5_SHELL.md` and `FIX5_DATA.md`; I read them while the node probes ran, at the end.

Status: IN PROGRESS (23:58 UTC): parts A, B re-tests, sizes done; node probes running; B6 second profile to do.
