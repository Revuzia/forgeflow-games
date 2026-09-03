# CRESTBOUND — measured harness facts (this machine)

Every line here was produced by a tool run in this repo, not recalled. Add to it only
what you measured.

## Headless Chrome has a real GPU here (2026-09-02)
`playwright.chromium.launch(channel="chrome", headless=True)` on this box reports:

| launch args | renderer | MAX_TEXTURE_SIZE |
|---|---|---|
| `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` | ANGLE (Google, Vulkan 1.3.0 SwiftShader Device (Subzero), SwiftShader driver) | 8192 |
| *(no gl flags)* | **ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)** | 16384 |

Both give a working WebGL2 context, so `--headless` is safe for every gate.

**Consequence for the perf gate:** headless WITHOUT the swiftshader flags runs on the real
Intel UHD GPU — the same "mid laptop integrated" reference the perf budget means — so its
frame timings are meaningful. SwiftShader is a CPU rasteriser and will under-report fps by
a large factor; never gate fps on a swiftshader run. Prefer plain `headless=True` with the
d3d11 flags (`--use-angle=d3d11 --ignore-gpu-blocklist --enable-gpu-rasterization
--disable-features=CalculateNativeWinOcclusion`) and keep swiftshader as the fallback only
when the GPU path fails to launch.

## Server
`python serve_nocache.py 8788` is already running and serves the repo root, cwd-independent.
Verified 200 on:
- `http://localhost:8788/games/crestbound/index.html`
- `http://localhost:8788/games/crestbound/runtime/core/tuning.js`
- `http://localhost:8788/games/crestbound/assets/vendor/three/build/three.module.js`

Three.js vendored at r172 (`node_modules/three` is 0.172.0 — the same build the import map
serves), postprocessing addons present: EffectComposer, RenderPass, ShaderPass,
UnrealBloomPass, SMAAPass, OutputPass, MaskPass, Pass + FXAA/SMAA/Copy/Output shaders.

## Syntax gate
`node --check` is worthless on ESM (it green-lights `const b = ;` in any file with an
`import` — verified on Node 22.20.0). Two real gates:
- `node_modules/.bin/esbuild <file> --log-level=error --format=esm > /dev/null` (exit 0 = parses)
- `node _harness/modulecheck.mjs` (really imports + links every module against real three)

## Chrome contention
Pointer-lock and fps checks false-fail when several headed Chromes run at once (learned on
Ascendant). Run browser gates ONE at a time; parallel lanes must use headless.

**Measured 2026-09-02, feel lane.** Even HEADLESS gates false-fail under contention if they
time anything off the wall clock. With five other lanes' browser gates running, one
`feelcheck.py --headless` run reported `runup_time 0.524 s` (band ≤ 0.250), `pound_hang`
"no hang phase observed (state crouch)", `poundjump_apex 1.910` (want 2.882) and
`longjump_dist 6.864 m`; the two runs on either side of it, same build, no code change,
reported `0.213 s / 0.198 s / 2.882 / 7.558 m` and 0 failing. Cause: `engine.js` accumulates
`elapsed` from a CAPPED per-frame dt, so under a slow renderer GAME time runs behind WALL
time and every `performance.now()` duration inflates. feelcheck.py now times every setup
wait and every measured duration off `CRESTBOUND.engine.elapsed` (`simNow()`), with
wall-clock runaway guards; only `measureFrameDt` still reads `performance.now()`.
Two consequences worth remembering: a wall-clock timeout in a browser harness is a bug, not
a safety net; and a gate that flips green/red on machine load is not evidence either way —
re-run before believing a regression.

**RESIDUAL, still open (2026-09-02, feel lane).** The clock fix removes the timing
DRIFT; it cannot fix the SIMULATION RESOLUTION. engine.js caps dt, so under a slow
renderer one rendered frame advances a large slice of game time, and feelcheck drives its
setup with `wait()` between key presses. When a press/release pair meant to span several
frames collapses into ONE, the move never fires: a loaded run reported `longjump_dist
3.704 m ... states jump1,fall,land` (the crouch never registered before the jump) and
`pound_hang no hang phase observed (state crouch)` (the hero was still grounded when
crouch went down) — moves whose code was not touched. Same build, quiet frames: 7.558 m
and 0.190 s, 0 failing (measured three times: stop_time 0.148 / 0.140 / 0.137,
wallkick_vy 12.000 every time).
The real fix is the one `feelshots.py` already uses: `engine.stop()` and hand-step
`game.update(1/60)` so the harness is independent of the renderer. That is a rewrite of
feelcheck's driver, not a tuning change — do it before trusting a single feelcheck run
taken while other browser gates are running.

**Also measured 2026-09-02:** `feelshots.py --headless` launches with
`--use-gl=angle --use-angle=swiftshader`, so its screenshots rasterise on the CPU. That is
fine for its trajectories (it hand-steps `game.update(1/60)` and never times off the wall
clock) but a full `feelshots.py` run WITH strips did not finish a single 8-frame move in 22
minutes under contention. Use `--no-shots` for the numbers, and `--headed` when you need the
strips.
