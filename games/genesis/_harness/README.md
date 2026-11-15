# GENESIS harness

Dev tooling for `games/genesis`. Run everything from `games/genesis`. Node 22 runs the `.ts` files directly; the
browser tools use the preinstalled Chromium through Playwright (SwiftShader WebGL, so frame times are for regressions
only). **The machine is shared (4 CPUs): run anything heavy through `slot.sh`.**

## The gates

| command | what it does |
| --- | --- |
| `npm run check` | `detban` + `typecheck` + the whole test suite. The CI workflow (`.github/workflows/genesis-check.yml`) runs `npm ci`, this, then `npm run build`. |
| `npm run build` | `vite build` into `dist/`; bakes the build stamp (commit, `+dirty` when the game's tree has uncommitted changes, time). |
| `npm run release-check` | build, then validate `public/game_meta.json`, print bundle sizes and fail past the budgets, and **refuse a `+dirty` or `unknown` stamp**. `--no-build` checks the existing `dist/`. Pure checks live in `release-check.ts` and are tested by `tests/release-check.test.ts`. |
| `bash _harness/slot.sh npm run check` | the same gate in one of the machine-wide job slots (`slot.sh --status` shows who holds them). |

## Tools

| file | purpose |
| --- | --- |
| `slot.sh` | run a heavy job (a long sim run, a shot run, the full suite) in one of `GENESIS_SLOTS` (default 3) first-come slots. |
| `detban.ts` | the determinism ban: no clocks, `Math.random`, locale or DOM in `src/sim/**` (`--selftest` proves the scanner). |
| `shots.mjs` | the screenshot harness. Starts vite (frozen, shots enabled), drives the game through `window.__GENESIS__`, saves PNGs and `report.json` to `_shots/`. Specs are JSON arrays in `specs/`. |
| `perf.mjs`, `perf_sim.ts`, `perf_people.ts`, `perf_worker.ts` | speed probes: the browser at 1x..3000x, the sim alone, the peoples, the real sim worker on a Node thread. |
| `cdn.mjs` | serve `dist/` through the real games CDN worker locally and smoke-test the load. |
| `gen-controls.ts` | regenerate `CONTROLS.md` and the controls rows in `public/game_meta.json` from `src/ui/controlstext.ts` (`tests/ui-meta.test.ts` fails while they are stale). |
| `treeview.ts` / `treeview.html` | a lookdev page for the procedural trees. |
| `probes/` | scripts that drive the sim to answer one question (arc probes). |
| `arc-work/` | the arc's plan, brief, ledgers and `STATE.md` (tracked). |
| `scratch/`, `_reports/` | bulky output (logs, saves, tree copies). **Git-ignored and erased by a container restart**: never leave work only there. |

## The `/__shot` endpoint

`window.__GENESIS__.shot(name)` posts the canvas to `POST /__shot/<name>`, which writes `_shots/<name>.png`. The
endpoint writes files, so it exists **only when `GENESIS_SHOTS=1`**. `shots.mjs` and `perf.mjs` set it for the vite they
start. If you run your own server for a shot (`GENESIS_SHOTS=1 npx vite --port 5190 --strictPort`) set it yourself;
a plain `npm run dev` or `npm run preview` has no such endpoint, and `shot()` then reports the failure instead of saving.

Related switches: `GENESIS_FROZEN=1` (no HMR, no file watching: a shot run never sees a half-written edit),
`GENESIS_NOHMR=1` (files watched, open pages never reload).

## Git-ignored

`dist/`, `_shots/`, `node_modules/`, `_harness/scratch/` and `_harness/_reports/` are ignored (repo `.gitignore`, the
2026-10-08 GENESIS block). Check with `git check-ignore -v dist _shots`.
