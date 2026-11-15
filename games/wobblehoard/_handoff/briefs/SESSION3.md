# SESSION 3 (2026-11-15): read after STATUS.md and COMMON.md. Where this page differs from COMMON.md or RESUME.md, this page wins.

## The machine
- The work is back in a **Linux cloud container**: the repo is at `/home/user/forgeflow-games`, the game at
  `/home/user/forgeflow-games/games/wobblehoard` ("G"). RESUME.md section 1 (Windows paths, `taskkill`, the `npx` problem) does NOT apply
  here. Code you write must still stay portable to Windows: never `spawn('npx', ...)`, never `process.kill(-pid)` in harness code; use
  `process.execPath` with `node_modules/vite/bin/vite.js` as `_harness/pw.mjs` does.
- 4 cores, 15 GB RAM, shared. **At most one heavy job per agent** (a browser run, a `vite build`, a full probe suite, a perf
  measurement, any node job over 60 s), and never more than two heavy jobs on the machine. `npx tsc --noEmit -p tsconfig.json` and one
  short probe are light.
- Node 22.23, Playwright (global install) with Chromium in `/opt/pw-browsers`, software WebGL2 (SwiftShader): slow, so judge costs
  relatively and step the game deterministically through the dev hook instead of waiting on wall time.
- Scratch: `/tmp/claude-0/-home-user-forgeflow-games/2d4e12a5-0f4d-5239-bdda-16316c996a1a/scratchpad/<your lane>/`. It can be wiped by
  a restart: anything worth keeping (reports, maps, designs) goes under `G/_handoff/`.
- Ports: render 5364, shell 5366, audio 5367, physics 5368, life 5369, verifiers 5370 to 5377. Use only the ones your task names.
- Kill everything you start (`pkill -f` on your own command line only). Before you finish: `ps -eo pid,args | grep -E
  "headless_shell|vite|_harness" | grep -v grep` must show nothing of yours.

## Rules that did not change
- No git write commands, ever (the orchestrator commits). Read-only git is fine.
- Edit only the files your task says you own. Seams go through `src/contracts.ts`, additive and optional, documented.
- No new dependencies, no outside assets, everything procedural and original. No paywall, ads or currency.
- `npx tsc --noEmit -p tsconfig.json` stays clean after every step. Never loosen a check or threshold to pass.
- Keep a **running report** at `_handoff/reports/<NAME>.md` (your task names it), updated after every finished step, with commands
  and real numbers: agents can be cut off without warning, and the next engineer continues from your report.
- Baseline measured at the start of this session on this machine (HEAD 1e5a1159): tsc clean; `shellview/node_checks` 124/124;
  `probe_app` 183/183; `probe_gestures` 128/128; `probe_merge` 22/22; `probe_economy` all pass; `probe_catalog` all pass;
  `probe_collection` 73/74 (the one failure, C08 previewTouch allocation, is a known open item that predates this session).

## What this session is for
The owner asked for PLAYGROUND: places to take squishies to (beach, snowy mountain, forest log cabin), things in each place that
squishies use in their own way, several squishies at once that are social (emotes, little voices), pieces that join in without noise,
and a real purpose (a Journal of quests, wishes and discoveries). The direction is `_handoff/design/DIRECTION.md`; the final specs are
`_spec/PLACES.md`, `_spec/LIFE.md`, `_spec/QUESTS.md` and `_spec/PLAYGROUND_BUILD.md` once the design panel has written them.
