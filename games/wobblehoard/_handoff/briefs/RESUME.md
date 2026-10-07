# RESUME (session 2, 2026-10-06): read this right after COMMON.md

**FIRST read `_handoff/STATUS.md`: the ledger of what is DONE (do not redo), IN PROGRESS and QUEUED.**

This file updates the lane briefs after the owner stopped work. **Where it differs from COMMON.md or a lane brief on paths, the
machine, or "where the previous engineer stopped", this file wins.** Rules about files, git, contract, assets, product, honesty and
player text in COMMON.md still apply unchanged.

## 1. The machine and the paths (the work moved from a Linux container to the owner's Windows PC)

| Was (COMMON.md) | Now |
|---|---|
| `/home/user/forgeflow-games` | `C:\Users\TestRun\Claude Claw\squish-keeper-build` (a git worktree of `Revuzia/forgeflow-games`, branch `claude/exciting-faraday-2dakqx`) |
| `/home/user/forgeflow-games/games/wobblehoard` ("G") | `C:\Users\TestRun\Claude Claw\squish-keeper-build\games\wobblehoard` |
| `/tmp/claude-0/.../scratchpad/<lane>/` | the scratchpad folder your task prompt names, plus `<lane>\` |
| 4 shared cores | 16 logical cores, 31 GB RAM, but the owner's rule is unchanged: **at most 2 heavy jobs at a time on the whole machine** |

- **Shell.** PowerShell and Git Bash are both available. The path has a space ("Claude Claw"): always quote it. Node v22.20 (runs `.ts`
  directly, type stripping on), npm 10.9, Python 3.13. There is **no ImageMagick** (`montage` does not exist): make contact sheets with
  a small Playwright page, a canvas in node, or `sharp`-free code of your own.
- **Heavy job** = a browser run (Playwright/Chromium), `vite build`, a full probe suite, a perf measurement, or any node job over 60 s.
  Each agent runs **at most one heavy job at a time**, and the orchestrator runs at most two agents at once. `npx tsc --noEmit -p
  tsconfig.json` (about 2 s) and a single short probe are light.
- **Playwright for Node 1.58 is already in `G\node_modules`** (a gitignored copy), with Chromium 145 from `%LOCALAPPDATA%\ms-playwright`.
  SwiftShader WebGL2 was confirmed working. No environment variable is needed. `node_modules` is gitignored: never commit it.
- **`_harness/pw.mjs` `startVite` now works on Windows** (it runs vite's own entry with `process.execPath`, and stops the tree with
  `taskkill`). `spawn('npx', ...)`, `spawnSync('npx', ...)` and `process.kill(-pid)` do NOT work on Windows: do not use them in new
  code. Known leftover: `_harness/browser_shell.mjs` (the `vite build` step near line 2513) still uses `spawnSync('npx', ...)`; the SHELL
  lane makes it portable (`process.execPath` + `node_modules/vite/bin/vite.js`).
- **`npx` is unreliable here.** In the PowerShell tool `npx` fails with "StandardOutputEncoding is only supported when standard output is
  redirected" and **leaves a stale exit code (0)**, so a failed check can look green. Call the tools directly:
  `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (about 4 s; prints nothing when clean, exit 1 on errors; verified to
  catch a deliberate error) and `node node_modules/vite/bin/vite.js build ...`. Always check the real output, not just `$LASTEXITCODE`.
- **Ports** are unchanged: render 5364, shell 5366, audio 5367, physics 5368, verifiers 5370 to 5373. Use only your own.
- **Kill everything you start.** `taskkill /PID <pid> /T /F` or `Stop-Process -Id <pid> -Force`. Before you finish, check for strays:
  `Get-CimInstance Win32_Process | ? { $_.CommandLine -match 'vite|_harness|headless_shell|ms-playwright' } | select ProcessId,Name`.
  Never kill a process you did not start (other agents and the owner's own programs share this machine).
- **Linux-isms in the saved verifier scripts** (`_handoff/verify_*`): hard-coded `/tmp/claude-0/...` and `/home/user/...` paths,
  `nice -n 5`, `python3`, `.sh` wrappers, `montage`. They are references: copy a script to your scratch and fix the paths there. Do not edit
  the saved originals unless your task says so.
- **Line endings.** `core.autocrlf=true` here, so working files are CRLF and git normalises to LF. Do not "fix" line endings.
- **Never run `claude -p`.** The owner's interactive session holds the OAuth lock and the call hangs for minutes.
- **No git write commands** (COMMON.md). `git diff`, `git log`, `git show`, `git blame` and `git archive` (read-only) are fine. A verifier
  that needs a clean copy of the committed tree uses `git archive <commit> games/wobblehoard | tar -x -C <scratch>\snap` and a directory
  junction for `node_modules` (`New-Item -ItemType Junction -Path <snap>\games\wobblehoard\node_modules -Target G\node_modules`). Remove the
  junction (`cmd /c rmdir`), not its contents, when you finish.

## 2. Where each lane stopped (the state at the handoff commit; verify, do not trust)

Branch tip at the start of session 2 is `b5869782` (the handoff commit). The last tested build is `db8f8ac` (checkpoint 45). Baseline
measured at session start on this PC: `tsc` clean; shell-core node checks 100/100; `probe_app` 160/160.

### RENDER
- Part A fixes, part B (RENDER-3) and part C (cut visuals) are **written, committed, and not reported by their engineer**: `src/render/cutfx.ts`
  (seam, bridge, parting pieces), `setCutSeam` / `setBridge` / `partPieces` / `AddBodyOpts.chunk` in `stage.ts`, chain flash checks and
  the gallery, glow, strands, mat and capspot sections in `_harness/browser_render.mjs`, capsule placement with safe insets, per-species
  material, strands.
- The previous independent verdict (`_handoff/verify_render/VERDICT.md`) found one MAJOR (chained-ceremony flash) and 12 minors. The
  harness already shows a chained-flash probe passing at session start; **that is the implementer's own probe, so it proves nothing until
  the verifier's own repro (`verify_render/adv.mjs`) passes too**.
- Still to do (owner's list): re-run every repro in the VERDICT; fix the phone capsule landing in front of the squishy (the shell now
  sends real safe insets); fix the camera jump when `setBody` is called with mat bodies out; prove by a bundle grep that the dev stage
  members (`createStageDev`) are out of production; run the full render harness once.

### SHELL (SHELL-4)
- Toy tray, Snap (photo), Cut tool, toss and bump wiring are **written and committed, never reported**: `src/ui/toyTray.ts`, `snapBar.ts`,
  `cutBar.ts`; `src/shell/cut.ts` (piece manager, about 490 lines); changes in `game.ts`, `hudBinding.ts`, `bodies.ts`, `mat.ts`,
  `feedback.ts`; about 370 new lines in `_harness/browser_shell.mjs`; more node checks. `feedback.ts` already routes `lift`, `toss` and
  `bump` to `audio.lift/toss/bump` (verify they fire with the real physics events); `cut.ts` already calls `audio.cut/rejoin`.
- Still to do: see the SHELL task prompt (it lists them), including `CALIBRATION.bendWithPress`, the meter status line peeking under the
  Hoard card, long species names on the phone name tag, and the screenshots.

### PHYSICS (checkpoint 47, commit `c3fa0cb`)
- Fix round 2 and the cut primitives were landed by the physics engineer, and the engineer's numbers are in
  `_handoff/verify_physics/impl_reports.md`. **No independent verdict exists for it.** The older verdict
  (`verify_physics/VERDICT.md`) is about commit `2e586e0`, before fix round 2: use it for the repro method and the failure list, not as the
  current state.
- Known open issues the owner already accepted as open (do not re-report as new, but do re-measure): perf 1.8 to 2.3 ms/frame against the
  2.0 ms bar at load 4 to 6; 5 whole bodies with collide cost about 10 ms/frame; rare 1 to 2 frame creases (2/612 full pulls, 4/449
  rubs); neck waist 0.3 not 0.15; plastic memory capturing bursts with fingers down; silhouettes of wrigglo, pastrel, thumbly, boingle
  and crimpo still weak.

### AUDIO / ECON
- Done and verified earlier (audio rounds 1 to 3, the cut and rejoin voices with pitch, CUT checks 65/65, the room-dip fix; ECON XP
  rules, `previewTouch`, economy 152/152, collection 71/71, merge 22/22). **Nobody has listened to any sound.** Audio is changed in session 2
  only if a lane reports a real need; any audio change gets an independent audio verification before it is accepted.

## 3. Reports
- Write your full report to `_handoff/reports/<NAME>.md` (the name is in your task prompt; create the folder if needed) and keep it
  factual: numbers before and after, commands you ran, what is not done. Screenshots go in `_shots/` (gitignored) or your scratch;
  never commit images, `.pyc`, secrets or `node_modules`.
- Your final answer to the orchestrator is a short structured summary of that report (the task prompt gives the shape). The orchestrator
  re-checks load-bearing claims itself: a claim without a command and its output is a lead, not a result.

## 4. Verification protocol (applies to every verifier)
- Independent means: you did not write or fix this code, you have not read the implementer's reasoning before forming your own
  checks, and you try to break it. Read the implementer's report only after your own first pass, to find what it did not test.
- Verify the **committed** commit the task names, in a snapshot, never the live working tree (engineers may be editing it).
- PASS needs: no MAJOR finding, no regression against a previously passing check, tsc clean, no console or page error in browser runs.
  Minors are listed with a repro each. Never loosen a threshold to pass; a threshold the owner deliberately changed may be re-specified
  only with a written reason.
- Report real numbers. Say what you did not check. A verdict of PASS says exactly what it covers.
