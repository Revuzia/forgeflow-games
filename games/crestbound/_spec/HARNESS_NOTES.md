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

## The frame-cost probe lied, and how (2026-09-03, fill lane)

`frameprobe.py` reduces each configuration with the **MINIMUM** across repeats.
A GPU timer query that comes back tiny therefore WINS the reduction. Measured
on keep/cp3/quality medium: `aniso 1`, `no point lights`, `half res`,
`scene only` and `ALL CUTS` all reduced to **1.20-1.40 ms (700-830 fps)** in one
run whose `full chain` read 18.62 ms. Physically impossible, and enough to make
every delta in that table meaningless.

Two causes, both worth remembering:

1. **`game.js` pauses on window blur** (`window.addEventListener('blur', () =>
   this.pause('blur'))`). A headed Playwright window loses focus whenever
   anything else opens, the paused frame renders almost nothing, and the probe
   times it as a "configuration". Any browser harness that samples frame cost
   must assert `game.state` is `playing`/`keep` for the frames it counts.
2. **Recycled query objects plus dropping every disjoint result** returned ZERO
   samples for whole configurations while a throwaway inline probe on the same
   page and the same context read 23-29 ms.

`_harness/_fillab.py` is the replacement: per-repeat MEDIANS reduced with a
MEDIAN, a floor below which a sample is rejected as broken rather than
believed, fresh query objects, a 24-frame tail drain, the pause guard, and a
`calls > 20` sanity check. It prints how many samples it threw away.

## The four-tier ladder, measured (2026-09-03, after the fill lane)

Headed Chrome, quiet box, GPU timer query, 1920x1080 CSS, worst of three
stations per course. `python perfcheck.py --quality <tier>`.

| tier | scale | buffer | course | draws | tris | fps | p99 ms | warm ms |
|---|---|---|---|---|---|---|---|---|
| low | 0.60 | 1152x648 | keep | 179 | 398,185 | **65.0** | 20.89 | 1417 |
| low | 0.60 | 1152x648 | verdant-1 | 191 | 430,283 | **74.1** | 18.49 | 1292 |
| medium | 0.72 | 1382x777 | keep | 194 | 419,153 | 42.2 | 29.87 | 1708 |
| medium | 0.72 | 1382x777 | verdant-1 | 199 | 442,653 | 49.0 | 25.79 | 2271 |
| high | 0.85 | 1632x918 | keep | 205 | 441,457 | 28.7 | 40.08 | 2145 |
| high | 0.85 | 1632x918 | verdant-1 | 210 | 468,571 | 34.3 | 35.36 | 1931 |
| ultra | 1.00 | 1920x1080 | keep | 208 | 441,456 | 16.3 | 69.75 | 2874 |
| ultra | 1.00 | 1920x1080 | verdant-1 | 219 | 482,296 | 18.5 | 59.96 | 2630 |

**LOW is the tier that meets every clause of the perf gate on both courses** —
draws, triangles, >= 55 fps, p99 <= 28 ms and warm load <= 1500 ms. Medium and
high hold 42-49 and 29-34 fps; ultra is 16-19 and is the tier CONTRACT hard
rule 4 explicitly allows to run under target on integrated graphics.

Native-1080p INFO on the same run: keep 22.4 fps, verdant-1 26.1 fps (they were
19.9 and 23.2 before this lane). The contract's "native-1080p 55 fps is not
reachable on this GPU for this scene class" still holds and was not approached.

## Is a shader LOD visible? Diff the frame, do not argue about it

`_harness/_lodvisible.py` freezes the engine, renders ONE frame twice with only
`Mats.setLodDistance()` changed, reads both back off the GPU and reports the
per-channel difference. The first version of the material LOD failed it —
verdant-1 spawn, mean 1.179/255, 10.51 % of pixels off by more than 4/255,
worst pixel 125 — because it faded terms to ZERO instead of to their CHEAP
equivalent. After blending the specular IBL toward `iblIrradiance *
RECIPROCAL_PI` instead of toward black: mean 0.130, 0.58 % over 4/255, worst 78
at the spawn, and 0.000 at every Keep station (nothing in the hub is past the
40 m radius, so the LOD is an open-diorama lever and buys nothing indoors).

## The quality detector never looked at the GPU (2026-09-03, quality lane)

`runtime/core/settings.js detectQuality()` picked the starting tier from
`navigator.hardwareConcurrency` and `navigator.deviceMemory` ONLY. This box
reports **16 cores / 32 GB** and drives an **Intel UHD Graphics (0x00009A60)**,
so the old heuristic returned `high` — render scale 0.85, measured 28.7 fps
(keep) / 34.3 fps (verdant-1) — on hardware that runs the same scene at 65-74
fps on `low`. The frame is GPU FILL-bound (CONTRACT hard rule 4); a CPU core
count says nothing about how many pixels the part can shade, so it must not be
the only vote.

`detectQuality()` now reads `UNMASKED_RENDERER_WEBGL` off a throwaway WebGL
context (`detectGPU()`, memoised, released with `WEBGL_lose_context`, no-op
without a DOM so `modulecheck.mjs` still imports the file) and lets the GPU vote
DOWN only:

| GPU class | tier |
|---|---|
| software (SwiftShader, llvmpipe, WARP, no WebGL) | `low`, unconditionally |
| integrated (Intel UHD/HD/Iris/Xe, AMD APU graphics, base Apple M, Mali/Adreno/PowerVR) | `low` |
| unknown (masked renderer, e.g. `resistFingerprinting`) | at most `medium` |
| discrete (GeForce/RTX/GTX/Quadro, Radeon RX/Pro, Intel Arc, Apple M Pro/Max/Ultra) | the old CPU/memory heuristic, unchanged |

`classifyRenderer()` is exported and unit-testable; 29 real renderer strings
pass, including the two that need ORDER to be right: `AMD Radeon RX Vega 8
Graphics` is an APU (integrated) while `AMD Radeon RX Vega 56` is a card
(discrete), and ANGLE writes `Intel(R) Arc(TM) A770`, whose `(R)` contains a
WORD character — so `intel\W*arc` never matches a real ANGLE string and the
patterns use `intel[^,]{0,20}\barc\b`.

**Measured after the change, headed, quiet box, `python perfcheck.py` with NO
`--quality`:**

| course | tier | scale | draws | tris | fps | p99 ms | warm ms | verdict |
|---|---|---|---|---|---|---|---|---|
| keep | low (auto) | 0.60 | 179 | 398,191 | **66.5** | 19.84 | 1337 | ok |
| verdant-1 | low (auto) | 0.60 | 191 | 430,291 | **73.1** | 18.06 | 1475 | ok |

`PERF OK (0 of 2 courses over budget)`. Native-1080p INFO on the same run: keep
28.2 fps, verdant-1 25.6 fps. `perfcheck.py --quality high` still pins 0.85 and
still measures 29.0 / 34.7 fps — the tier is reachable by hand, it has just
never met the gate on this GPU.

`perfcheck.py --quality` now DEFAULTS TO EMPTY (= no `?quality=` override, i.e.
what a player gets). It used to default to `high`, so the gate measured a tier
the auto-detect never picks.

## The dynamic render-scale controller could not rescue a wrong tier

`engine.js _autoRenderScale()` clamped its low end to
`max(0.45, tierScale - 0.15)`. From `high` that is 0.70 — still ~40 fps here —
so a wrong STARTING TIER was unrecoverable in play: the controller sat at its
floor, 15 fps under target, out of moves. The floor is now `MIN_RENDER_SCALE`
(0.45) and the controller crosses tier boundaries DOWNWARD. The CEILING stays
at the tier value: above it every composer target has to be reallocated
(measured 141/151/179/179/646 ms stalls), which is what made this controller
unshippable in the first place; below it a step is a uniform write into an
already-allocated sub-rectangle.

Measured with `?quality=high` and the controller live (30 s, keep): 0.85 -> 0.45
in ~10 s, crossing the old 0.70 floor, never below 0.45. Measured with
`?quality=ultra`, timestamps taken off the engine's own `renderscale` event:
11 steps, 1.00 -> 0.45, **worst rate 0.0501 scale/s, zero violations** of the
contract's `<= 0.05 per second`. The controller also warns ONCE when it crosses
below `tier - 0.15` (`[Engine] render scale 0.65 is below the high tier band
(0.70-0.85) — this machine wants a lower quality tier.`) and emits
`renderscale-rescue`, so a bad guess is visible in a log and not only in the
frame rate.
