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

## Where the triangles go on a 144 m course (2026-09-04, group-1 validator)

Measured with `_harness/_g1_triattr2.py` (engine stopped, one composer render
per visibility toggle, `renderer.info.render.triangles` — the number the perf
gate reads) and `_harness/_g1_batchgeo.py` (the live BatchedMesh geometry
table), at the spawn station, auto tier. Three of six courses were over the
450k triangle budget at rest, at committed HEAD (verdant-2 525k; the in-flight
visual-lane edits did not cause it): verdant-2 513k, verdant-3 549k,
ember-2 576k. Draw calls were fine everywhere (163-181).

What a frame is made of (verdant-2 before any fix, 512.6k): static merge
147k (73.5k main + 73.4k shadow — ONE chunk, so the 36 m shadow frustum
renders the whole course's static art every frame), coins 69.9k (142 x 492,
every coin drawn at full detail out to HIDE_RANGE = 150 m; 40-60 % of them
beyond 60 m where a coin is five pixels wide), terrain 39.2k (fixed, every
station of every course), water 30.8k (a 112 m moat at 0.9 m quads), hazard
batches ~90k, Nim 24k (12k x 2 with shadow), grass 13.6k.

The hazard batches' cost driver was `chamferBox` (hazards/movers.js): an
ExtrudeGeometry of a rounded rect with 2-segment corner arcs plus a bevel
costs 156-196 triangles whatever the box's size, and the factory hazards
build their small trim out of it — ember-2's twelve crushers spent 3,260
triangles EACH on twenty 6 x 7.5 cm cooling-vent slots (39,120 in one
obsidian batch), plus collar bands, ribs, rims and safe-edge strips. On those
parts the corner radius is 3-17 mm — sub-pixel at the tier scale.

Fixes (all generator-level, nothing deleted, measured after each):
- `chamferBox`: a plain bevelled rectangle (28 tris) when the corner radius
  is under 2 cm; boxes with a visible radius are byte-identical.
- coins: a second InstancedMesh with the 100-triangle blank for the far band
  (ANIM_RANGE, > 46 m from the hero) and per-frame compaction so `count` is
  the number drawn (a scale-0 instance still costs its full index range).
- `def.chunks`: per-course ceiling for the static-merge chunk grid (default
  MAX_CHUNKS = 2 unchanged for the Keep and verdant-1), so the shadow frustum
  can cull quadrants. verdant-2 `4`, verdant-3 / ember-2 `9`.
- verdant-2 moat `res: 1.4` (30.8k -> 12.8k; normals are analytic).

Boot triangles: verdant-2 501k -> 433k (191 draws), ember-2 568k -> 429k
(185 draws), verdant-3 547k -> 495k (200 draws) — STILL OVER. What is left
on verdant-3 is authored art at the spawn: 4 mills x ~4 builder decks
(69k with shadow), 3 conveyors x ~55 treads x 240 tris (42.7k), terrain
39.2k, the spawn detail cell 28k, three static chunks 72k. The next generic
levers, in order of yield: a terrain quadrant split or far-ring LOD (39k at
every station, currently one mesh with no culling — terrain.js was under
another lane's edit and was not touched), a `plain`-style far LOD for
adopted hazard decks, fewer tread ribs (5 per tread now).

Two harness facts learned on the way: `drawprobe.py` reports a BatchedMesh's
ALLOCATED index capacity (131072/3 = 43,690, 262144/3 = 87,381 ...) as its
triangle count, not what it drew — `renderer.info` after a real render is
the number to trust; and a visibility-toggle probe on a RUNNING engine
drifts by ~10k triangles between renders (coin/grass/animation), so stop
the engine and render once per toggle.

## A perf run is only evidence if the GPU engine was idle (2026-09-05, regress pass)

Headed `perfcheck.py` (auto tier, 0.60) after the five visual lanes read keep
**38.7 fps** and verdant-1 **43.2 fps** — "14 of 14 courses over budget" — against the
66.5 / 73.1 recorded above. Before blaming the lanes, the pre-run checkpoint
8a6b9359 was served from a side directory and measured in the same session:
**keep 42.8 fps** (spawn 46.5 / cp2 48.4 / cp3 42.8). Same code that read 66.5 the
day before. `Get-Counter '\GPU Engine(*)\Utilization Percentage'` explained it: the
owner's own Chrome GPU process (pid 16912, child of the default-profile Chrome
9148) held **~31 % of the 3D engine** at rest, dwm another 10 %. That Chrome is not a
harness instance and was not killed.

Paired numbers on the same loaded box: base 42.8 -> HEAD 39.3 fps on keep, i.e. the
lanes cost ~2 ms of a ~24 ms frame. `_fillab.py` at 5 repeats (keep cp2, low):
PresentPass RCAS/5-tap vs a plain blit **-1.78 ms** (the O1 sharpness buy), FXAA
-1.02 ms, all post -1.73 ms. A 3-repeat run of the same table had shown FXAA at
-5.55 ms — timer noise on a contended GPU; do not act on a fillab delta from fewer
than 5 repeats while the GPU counter shows another process above ~5 %.

Two rules: (1) sample the GPU-engine counter BEFORE a perf run and record it with
the table; (2) attribute a regression with a same-session PAIRED run of the last
known-good commit (`git archive <sha> games/crestbound | tar -x -C games/_bisect/x`,
then `perfcheck.py --url .../games/_bisect/x/games/crestbound/index.html --courses
keep --no-native`) — never against a number measured on another day.

Also measured this pass: `perfcheck` reports "render scale 0.60 -> drawing buffer
1920x1080" since the image lane — the composer targets are 1152x648, only the
PresentPass writes native pixels; the line is correct, not a scale bug. perfcheck's
worst-of-three triangle count for verdant-3 is 451,360 (spawn) while bootcheck's
spawn read 448,086 — the animated coin detail band swings ~3k either side of the
budget line, so verdant-3 is ON the 450k line, not safely under it.

## Two data traps found by the loop gate (2026-09-05)

`kind:'pillar'` p.y is the pillar's FOOT (builders.buildPillar stacks base, shaft,
cap from y = 0 and the collider follows). ember-2 authored its crown column at its
centre, so a 3 m copper column stood 27.35 -> 41.45 THROUGH the crown deck on the
open crest's footprint; loopcheck's stand-under teleport was shoved 1.88 m
sideways and 'a crest collects on contact' failed (4 checks). Probe:
`_harness/_rg_colprobe.py <course> x,y,z` lists broadphase colliders in a box.

`placeProps` gave every prop without `rot` a RANDOM yaw and every prop a 0.18
scale / tilt jitter — including `kindOf:'sign'`, whose text plate is baked at a
fixed yaw at the same x/z. The post spun in front of the lettering on the ember-1
and azure-1 spawn boards. ALIGNED_PROPS (sign, holosign) now take the authored yaw
or +Z, unjittered. Text boards are also capped at TEXT_MAX_LINE_M = 3.7 m per line:
the 0.60 m 'BAILEY MEADOW' header measured 6.1 m and covered Nim from the spawn
camera.

## Water: a second scene pass does not fit, and what the audit found (2026-09-07, water lane)

**Official Water.js / Water2.js (a Reflector and/or a Refractor) re-render the
scene into a texture every frame.** `_harness/_wl_refractcost.py` measures that
pass on the shipping tier: the full frame, then the full frame plus ONE extra
`renderer.render(scene, camera)` into a small target from an `engine.onFrame`
hook, inside the same GPU timer query `_fillab.py` uses (5 repeats, medians,
headless d3d11 = the real Intel UHD, azure-1 cp2, auto tier 0.60):

| config | ms | delta | fps |
|---|---|---|---|
| full | 19.85 | — | 50.4 |
| + pass 512×288 | 25.06 | **+5.21** | 39.9 |
| + pass 384×216 | 24.00 | **+4.15** | 41.7 |
| + pass 256×144 | 23.69 | **+3.84** | 42.2 |

The delta barely moves with the target size, so the pass is paid in
re-submitted draws and vertices (~190 draws / 300k triangles), not fill: a
target too coarse to show a submerged structure still costs 19 % of the frame,
and a 55 fps gate has 18.2 ms to spend in total. A layer-restricted Refractor
would shed draws, not the terrain and static-merge vertex work that dominates.
Verdict: the vendored r172 water objects stay unvendored; the analytic shader
in `materials.js` (`WATER_FRAG`) carries the look. (The 19.85 ms "full" was
taken while other lanes' gates were running; the deltas are paired, the
absolute is not a perf-gate number.)

**`_harness/_wl_audit.py` — every water body, live.** For each course with
water it reads the body's `surfaceY`, the Gerstner crest height it can reach
(Σ steepness·uAmp/k over the three waves), the ground around the box perimeter
(broadphase raycast, boxes + heightfields), the interior bed, and the baked
`aShore` statistics. What it found before the lane's fixes:

- Keep parterre: built TWICE (two `water.pool` meshes, two volumes — `objects`
  listed `FOUNTAIN_WATER` and `TERRAIN` on top of `waters:`/`terrain:`);
  `uAmp` 1.00 (a `pool` never wrote its 0.18 because the amplitude uniform was
  shared by reference across every body) → 0.49 m crests over a 0.15 m
  freeboard, 72/72 rim samples under the crest line — the owner's "surface
  above the rim"; and the bed was the lawn heightfield at y 0.00 (K10: crouch
  sank 0.60 → 0.00 and stopped). After: one body, uAmp 0.18, crests 0.088 m,
  0/72 under the crest, bed −1.30 (the marble), crouch 0.06 → −1.28.
- rime-2 melt pool: lip 0.92–1.00 vs surface 0.90 + 0.21 m lake crests → 39/128
  rim samples under the crest line. After (surfaceY 0.84, amp 0.10): 0.
- Every other lake/moat/brook/channel: box edges buried (min perimeter ground
  0.23–3.5 m above the surface). verdant-3's east end (x = 70) is the terrain
  edge itself — by design.
- The verdant-3 "white sheet" mid-river was NOT foam-on-crests: the tester
  was resting on a 0.45 m-deep shelf between the logs (feet y 0.15, surface
  0.60), and the shore rule painted every knee-deep strip near dry ground
  white (0.8-strength wet line + a 1.2 m band). The cream blobs elsewhere are
  the PMREM cloud reflection at mip 0.30 — now mip 0.50, and the foam layer is
  0.7 × (an 8 cm half-strength line + a ≤ 0.8 m band that dies by 0.75 m depth).

**Two swim defects live outside the water files; evidence in
`_harness/_wl_hopprobe.py`:**

1. SPACE on a SURFACED swimmer never fires the contract's `surfaceJumpV` hop.
   Keep parterre, floating (`swimIdle`, `submerged false`), tap SPACE, sample
   every rendered frame: state → `swimDive`, `vel.y` 2.14 for one frame then
   0, rise **0.10 m** (9.0 m/s should give ~1.19 m), 30/30 frames still
   `inWater`. That is why 0/6 surface hops clear the 1.10 m rim and why V3-03
   "breaches and drops back into exactly the same spot" against log A.
   Owner: controller.js (jump routing while `inWater`, and `_swimMove`'s
   waterline clamp re-entering on the next frame).
2. The underwater grade never fires: `cam._resolvePost()` returns null —
   `player.fx` is the `ParticleSystem` (no `setUnderwater`, no `.post`) and
   nobody calls `cam.setPost(engine.post)`, although `engine.post.setUnderwater`
   exists. `post._underwaterTarget` reads 0 with `submerged true` at every
   station (Keep bed, verdant-3 bed, verdant-2 moat, verdant-1 brook). One
   line in game.js after the FollowCamera is built: `this.cam.setPost(this.engine.post)`.
   Until then "underwater" is the water plane's own underside (Snell's window,
   dark mirror outside it) and nothing else.

**Replayed after the fixes (`_harness/_wl_replay.py`, `_shots/play_wl_after*/`):**
Keep: hop in from the lawn ok; crouch 0.60 → −1.19 (submerged) — K10 sinks; 0/6
surface hops leave the pool (the hop defect above). verdant-3: the "milk" near
the logs is now clear water over a pale sand shelf; from the bed the surface is
a translucent ceiling with Snell's window; sigil 1 IS reached by crouch + hold
west against the 2.8 m/s current (sigils 0 → 1 in 4 s; crouch alone drifts
10 m east, which is what the tester did). azure-1: the tidewell chamber and its
lit doorway read through 6.4 m of lagoon from directly above (absorb 0.18).
verdant-2 at the water line: the "obvious repeating pattern" of cream bands is
the moat BED's sand-ripple bake seen through clear water — unchanged with the
water mesh hidden and with caustics zeroed (`_shots/play_wl_caustic/`); not the
water shader. Loop gate on the eight water courses: 611/612, 0 failed, respawn
median 421 ms. Draws/tris at spawn after: keep 197/420k, verdant-3 239/443k,
every other water course unchanged, all inside 260/450k.

## Water pass 2: the box is not the water, and a teleport into a hill is not a swim (2026-09-07, water lane)

**The geometry checkpoint 22523345 reverted the Keep basin's bed.** `keep.js`'s
`heights: lawnHeights({...})` (the rectangular pit under the parterre, so the
marble slab at -1.30 is the ground) went back to the bare recipe; `_wl_audit.py`
read the interior bed at -0.00 / mean 0.07 again (pass 1 after: -1.30 / -1.06)
and K10 "crouch never sinks" was back. Restored; the audit's `terrain-only`
line now prints the bed under every body (keep: 64/64 cells water, deepest -2.2)
so the next overwrite is caught by a number, not a playtest.

**The wade release (`water.js shapeVolumeToBed`).** A water def's box is an
authoring convenience: its top IS the swim surface, and verdant-1's brook box
holds 1312 bank cells out of 1512 (terrain-only grid). A hero whose feet the bed
had lifted to 1 cm under the surface still counted as swimming: measured with
real input (`_wl_replay.py v1_wade_out`, `v1_brook_exits`), holding W north at
the bank crept east along z 19.8 with feet ON the bed at 0.24-0.30 for 15 s, and
a hands-off floater was still `swimIdle` at x 40.8 after 15 s with 2 cm of water
under him — the course's "the channel shallows and you walk out" never happened.
The Volume's `overlapsCapsule` / `contains` are now wrapped so a point is water
only where the terrain under it is >= `WADE_DEPTH` (0.5 m) below the surface, or
is more than 1.2 m above it (collide.js `HF_LIFT_MAX`: an authored under-terrain
space, not a bed). After: the hands-off drift is released `idle` on the sand at
x 37.9 after 12 s (frame `_shots/play_wl_p3/28_v1_drift_end.png`, boots in the
shallows), W + SPACE from mid-channel is out and running at x 40.4 in 6 s, keep /
verdant-3 stations unchanged, every body keeps its swimmable core (terrain-only
water cells: keep 64, v1 brook 200 / pond 404, v2 2610, v3 2166, e2 899, r1 376,
r2 127, az1 3080), draws/tris identical.

**The verdant-1 "falls out of the world" BLOCKER is a teleport into the hill.**
The tester dropped at `[x, 0.4, 18]`; the terrain there is 1.91 / 2.71 / 2.96 /
2.08 / 2.95 / 7.04 (x -20..30), so the hero started 1.5-6.6 m INSIDE the bank —
past `HF_LIFT_MAX`, i.e. in what collide.js treats as authored under-terrain
space — swam through it at the float line and left the box's north face into the
void (reproduced: 5 deaths in 5 on the current tree, identical to the report).
No swim reaches that state: from mid-channel the bed lifts a swimmer onto the
bank every time. What IS real there is the bank's pitch: 0.14 at z 20 and 2.71 at
z 18 on x = 0 is 52 deg, over `slope.slideDeg` 38, so the release hands the hero
to the land model and the land model slides him back in (`v1_wade_out` W-only:
released `slopeSlide` at (7.02, -0.12, 19.98) at 1.5 s, swimming again at 1.8 s).
Data (verdant-1 terrain), not a water-volume fact; the downstream shallows are
the exit that works.

**Underwater grade, proven one-liner.** With `CRESTBOUND.game.cam.setPost(
CRESTBOUND.engine.post)` injected in the Keep station, `post._underwaterTarget`
read 0.9999 / uniform 0.9934 while submerged (frame `05_keep_crouch_held_grade_
wired.png`: blue tint, caustic light on the marble) and the verdant-2 moat frame
in the same page read 0.998. Nothing in game.js calls it yet (grep `cam.setPost`
= 0 hits) — camera/integration lane.

## The warden's arena ring was 54 m from the warden (2026-09-08, regress pass)

Every one of the eleven authored wardens writes its arena centre as the
GROUND-PLANE PAIR the rest of the data format uses (`coins:[{ring:{c,r,n,y}}]`):

    { kind: 'warden', p: [-2, 16.40, -54], arena: { c: [-2, -54], r: 7.0 }, ... }

`critters.js` read it with `readV3`, so `-54` landed in **Y**, and the very next
line (`this.arenaC.y = this.groundY`) threw it away. Measured live with
`_harness/_rg_cp2probe.py` on verdant-1 before the fix:

| | x | y | z |
|---|---|---|---|
| warden `home` | -2.00 | 16.40 | **-54.00** |
| `arenaC` (the wake ring) | -2.00 | 16.40 | **0.00** |

`Warden.update` wakes on `hypot(px-arenaC.x, pz-arenaC.z) < arenaR`, so a player
standing on the boss's toes was 54 m outside its own ring: state stayed
`dormant`, hp 3, and the `boss` crest could not be earned on ANY course. That is
the replay pass's cross-course "the warden is still a statue" (logged separately
against verdant-1, ember-1, ember-4, azure-1 and azure-3); 9 of the 11 wardens
were affected — azure-2 `c:[0,0]` and verdant-2 `c:[0,2.0]` only escaped because
their authored z is at or near 0.

After (a 2-value `c` is `[x, z]`; a 3-value `c` still means `[x, y, z]`): same
probe, `arenaC` (-2.00, 16.40, **-54.00**), and 5 s of standing in the ring runs
`dormant -> roar -> ... -> dizzy` — the charge-into-the-wall window the design
asks you to pound. **A wake radius that is never entered looks exactly like a
critter with no AI; print the terms of the predicate, not the outcome.**

## A respawn pad can be buried by a later lane's set dressing (2026-09-08)

loopcheck's only failing check was `keep cp2 (cp-undercroft) respawn: grounded
0.75 m from the pad` (`PAD_R` 0.6 m, a **3-D** distance). The pad was
`[-14.0, UNDER + 0.05, 3.2]` = y -7.95; the geometry lane's hay-mound north
shoulder, `box([-15.2,-11.8], [-7.8,-7.2], [2.7,3.5])`, covers that x/z with its
top face at y **-7.20**. -7.20 − (-7.95) = **0.75 m** — the failure was the pad's
own Y, not a horizontal slide. `_harness/_rg_cp2probe.py` prints the broadphase
colliders over a candidate column and then settles the hero on each:

| candidate | settles at | d | verdict |
|---|---|---|---|
| authored `[-14.0, -7.95, 3.2]` | (-14, **-7.20**, 3.2) | 0.750 | FAIL |
| south of the hay `[-14.0, -7.95, -3.4]` | (-14, -8.00, -3.4) | 0.050 | OK |
| east of the hay `[-10.6, -7.95, 2.0]` | (-10.6, -8.00, 2.0) | 0.050 | OK |
| west of the hay `[-16.4, -7.95, 3.2]` | (-16.4, -8.00, 3.2) | 0.050 | OK |

Moved to the south spot (on the walk from the hay to the four EMBER paintings,
1.1 m clear of the mound's south shoulder). `loopcheck --courses keep` after:
**52/52, 0 failed**, respawn median 435 ms.

## gatecheck's "what the gate said" kept only the LAST frame (2026-09-08)

`walk_in()` stored `seen = {prompt, toast}` and overwrote both on every 120 ms
sample. A SEALED walk-in holds W for the full `WALK_MS` budget, and a hero held
against a wall slides along it — so the line the harness finally reported could
belong to the NEXT painting. Measured: gatecheck failed `verdant-2: sealed
walk-in (offset -1.0 m) says what it needs` having seen only WINDMILL HEIGHTS
text, while `_harness/_rg_v2seal.py` re-drove that exact station and read
`GNASHER FORT IS SEALED / 1 MORE CREST · 0 / 1` from **0.27 s**, `_gateNear`
pinned to verdant-2 for the whole 5.5 s walk, and the card never opened.
`walk_in` now accumulates every distinct line and the check reads `seenOwn` —
only what the game said while THIS gate was the near gate, which is strictly
stronger than last-wins (a neighbour's numbers can no longer answer for it).
Full gatecheck after: **342 passed, 0 failed** (867 s, headed).

## Two things a headed play of the Keep showed that no gate looks at (2026-09-08)

Driven with real KeyboardEvents, `_harness/_rg_keepplay.py` /
`_rg_keepplay2.py`, frames in `_shots/play_rg_keep*/`:

- **The courtyard signs stand between the lens and the world.** From the lawn at
  (0, 0, 22.51) facing the Keep, the follow camera sits at dist 6.8 → z ≈ 29.3,
  and `keep.js` hangs `sign([0, 2.5, FZ-4.6], SOUTH, 'THE PARTERRE')` and
  `sign([0, 2.0, FZ-4.6], SOUTH, 'deep enough to swim — crouch to dive')` at
  z 27.4 facing +Z — 1.9 m in front of the lens, facing it. Frame
  `play_rg_keep/05_facing_the_keep.png`: the lower-left half of the frame is
  sign lettering. `sign()` emits `{kind:'text'}`, which carries no collider, so
  the camera's raycast pull-in never sees it. The ui-text lane's law is "signs
  never hide Nim"; this is a sign hiding the WORLD.
- **The painting exit spot is a 2.5 m aisle and the camera takes the shaft
  tier.** Returning from BAILEY MEADOW puts the hero at (-18.10, 0, -6.00),
  between the west wall (x -20) and the grand stair's west flank (x -15..-11).
  Frame `play_rg_keep2/08_back_in_the_keep.png` is a near-top-down of Nim's
  scalp. One step out of the aisle the pose recovers
  (`09_keep_after_return.png`), so it is a transient, but no camcheck station
  stands there — the Keep's interior stations are @nook, @hall and @undercroft.

Also worth knowing for route probes: **a straight line from the east half of the
lobby to the verdant paintings does not exist.** Holding W west along z = -6 from
(13, 0, -2.6) bonks at x = -10.62 on the grand stair's west flank
(`play_rg_keep/16_painting_standoff.png`). The west aisle (x -20..-15) is the
route, and `spawnwalk.py` takes it.

## dwm alone can hold a third of the 3D engine (2026-09-08, regress pass)

The regress sweep's `perfcheck` (headed, auto tier 0.60, all 14 courses, run
straight after 45 minutes of continuous headed browser gates) read **OVER BUDGET,
14 of 14** — keep 42.6 fps, verdant-1 47.0, every course also OVER on warm load
(2.0–2.9 s against 1.5 s). Against the 66.5 / 73.1 fps in the table above that
looks like a catastrophic regression. It is not this tree.

`Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage'` **with zero
chrome.exe processes alive**:

    pid 2152  dwm       16.51 %  +  14.94 %   (two adapters)
    pid 2080  WUDFHost   6.33 %
    pid 21300 claude     1.28 %

~38 % of the 3D engine is spoken for before the harness opens a window, and the
owner's own Chrome was not running at all. Re-run on a settled box: keep **48.8**
fps / p99 25.39 / warm 1322 ms, verdant-1 **54.4** / 25.58 / 1431 ms — the warm-load
failures were entirely contention, the fps shortfall is the box.

Attributed with the PAIRED run the rule above asks for (`git archive dd0d1b0d
games/crestbound | tar -x -C games/_bisect/rgbase`, then
`perfcheck --url .../games/_bisect/rgbase/games/crestbound/index.html`), same
session, minutes apart:

| course | dd0d1b0d (before this pass) | HEAD (after) | delta |
|---|---|---|---|
| keep | 47.3 fps, p99 29.05, 194 draws, 413,762 tris | **48.8**, 25.39, 194, 413,762 | +1.5 fps |
| verdant-1 | 55.0 fps, p99 24.12, 209 draws, 354,870 tris | **54.4**, 25.58, 209, 354,872 | −0.6 fps |

Draw calls and triangles are identical to the digit, so the pass cost nothing;
the gap to the recorded 66.5 / 73.1 belongs to the machine. **Sample the counter
and pair against a known-good commit BEFORE believing a perf regression — and
note that "no chrome.exe" is not the same as "a quiet box".**

## The long jump only existed inside a tap window (2026-09-08, moveset lane)

The owner reported the long jump "barely exists" and the replay confirmed it
(verdant-1#01). MEASURED on the pre-fix tree, `inputcheck.py --only crouch`,
real KeyboardEvents on the C a browser player uses, engine stopped and
`game.update(1/60)` hand-stepped:

| what a hand does | speed at the press | move that came out |
|---|---|---|
| hold C, run 120 frames, then Space | **4.50 m/s** | `jump1` |
| run to 9.00, press C, Space **2 frames** later | 9.00 | `longjump` |
| run to 9.00, press C, Space **12 frames** (0.2 s) later | **4.50 m/s** | `jump1` |

Two constants, and the interaction between them, not a bug in `_doLongJump`:
`controller.js` scaled the crouched ground target by `CROUCH_SPEED_MUL` 0.5, so
a full stick under a held crouch settled at `speedRun * 0.5` = **4.50 m/s**,
while `TUNE.longJump.minSpeed` is **5.50**. The move was therefore reachable
ONLY through `CROUCH_GRACE` (0.18 s of the pre-crouch speed standing in for the
gate) — a window a hand does not hit; 0.2 s, an ordinary human beat, already
misses it. The same fraction also had a cliff at its knee (`target > speedWalk *
mul * 2`): a target of 3.20 stayed 3.20 while 3.21 fell to 1.61.

The crouched speed is now a CAP in m/s, `CROUCH_RUN_CAP = min(speedRun,
longJump.minSpeed + 0.9)` = **6.40 m/s**, derived from the long jump's own gate
so the two cannot drift apart again, and taken as a `min` AFTER the situational
dips instead of as a factor before them (the `land` dip used to stack: 4.50 x
0.85 = 3.83 m/s, swallowing the move for the 0.05 s after every landing).
`longJump.minSpeed` itself is untouched, and so are `vy` 8.5 / `fwd` 17.0 — the
published distance is unchanged (`longjump_dist` 7.558 m; `reachcheck
--require-all` 14/14 PASS after).

New feelcheck rows drive the HUMAN order — hold C for 600 ms of running, then
Space — five attempts at three approach speeds plus the sprint-then-crouch
order: **20 of 20 fired a `longjump`** at 6.40 / 6.40 / 5.91 / 6.40 m/s,
shortest distance 7.287 m. `crouch_run_speed` 6.400 m/s is now banded against
`TUNE.longJump.minSpeed`, so a future crouch tweak that re-buries the move fails
the gate instead of shipping. A crouch-WALK (low stick) is unchanged at 3.20
m/s, so crouch+jump out of a creep is still a plain jump and at rest still a
backflip (`backflip_C_from_rest`, `backflip_C_after_stopping` both still PASS).

## verdant-2 ROUTE B: the kick chain is fine, the turret is ROOFED (2026-09-08, moveset lane)

`verdant-2#25` (BLOCKER) says the NW turret's wall-kick shaft — floor 18.60,
exit ledge 27.00, 8.40 m — cannot be climbed. Measured, and it is not the
controller:

**The chain, in a shaft of the authored width.** `feelcheck.py`'s new
`wallkick_ladder_m` row builds the contract's own 3.20 x 3.20 m chimney on the
test slab and climbs it with real KeyboardEvents (hold the stick into a wall,
press Space the frame the hero is ON it and past `wallKick.minFall`, alternate
walls): launch heights **+1.64, +3.71, +5.77, +7.84, +9.92, +11.98 m** — a flat
**2.07 m per kick**, against the contract's certified 2.12. One jump plus four
kicks is at +7.84 m at the fourth launch and 14.098 m at the top. The 8.40 m
ROUTE B asks for is covered with 6 m to spare.

**The same chain in verdant-2's own shaft, above the obstruction.**
`_harness/_mv_kickladder.py verdant-2 -8.2,21.40,-8.2 27.0 x` — started on the
rampart deck inside the turret: kicks at **22.355 -> 24.417 -> 26.492**
(+2.06 m each), maxY **28.609**, past the 27.00 exit, 3 kicks.

**The same chain from the AUTHORED floor.** `_mv_kickladder.py verdant-2
-7.4,18.60,-7.4 27.0 x`: maxY **19.557 m**, 0.957 m of the 8.40. Kick 1 fires
and is erased the same frame; kick 2 never gets a contact and the hero falls
back. The SE-corner pair (`... corner`, the only walls left unroofed) is the
same: maxY **19.547**. 19.55 + the 1.5 m body = **21.05** — the underside of a
ceiling at 21.06.

**What is over the shaft.** `_harness/_mv_shaftroof.py verdant-2
-7.4,18.60,-7.4 1.6` casts straight up from a 0.4 m grid on the shaft floor
(`18.75` = the ray starts INSIDE solid, i.e. no standable floor there):

       z \ x  -9.00  -8.60  -8.20  -7.80  -7.40  -7.00  -6.60  -6.20  -5.80
       -7.80  18.75  18.75  18.75  21.06  21.06  21.06  21.06  21.06  21.06
       -7.40  18.75  18.75  18.75  21.06      -      -      -      -      -
       -7.00  18.75  18.75  18.75  21.06      -      -      -      -  18.75
       -6.60  18.75  18.75  18.75  21.06      -      -      -  18.75  18.75
       -6.20  18.75  18.75  18.75  21.06      -      -  18.75  18.75  18.75
       -5.80  18.75  18.75  18.75  21.06      -  18.75  18.75  18.75  18.75

The turret is authored correctly — four 0.4 m slabs around `SHAFT_C`
(-7.4, -7.4) leaving x, z in [-9.0, -5.8], floor 18.60, top 27.40, doorway in
the south face. It is planted INSIDE the middle fort's own footprint
(`{kind:'building', style:'fort', p:[0,19.30,0], s:[20,4.2,20], wall:2.0,
rampart:true}`), and the fort builder fills it:

- the CURTAIN WALL (2.0 m thick, y 17.20-21.40) occupies x [-10, -8] and
  z [-10, -8] — one metre of the shaft's interior on the west and north sides,
  right down to the floor;
- the RAMPART WALKWAY slabs at y **21.06-21.40** — `[0, 21.23, -9] half
  [10.4, 0.17, 1.4]` and `[-9, 21.23, 0] half [1.4, 0.17, 7.6]` — ROOF
  everything with x <= -7.60 or z <= -7.60, i.e. the whole north-west L of the
  shaft, 2.46 m above its floor;
- something else (the keep tower's octagonal footing) cuts the south-east corner
  diagonally at floor level, from (-5.80, -7.00) to (-7.00, -5.80).

What is left of "3.20 x 3.20 m clear" is a ~1.6 x 1.6 m triangle of open sky
whose only kickable walls are the east (x = -5.80) and south (z = -5.80) faces
— 90 degrees apart, and a hero of radius 0.38 leaning on either one puts part of
his capsule under the 21.06 roof. There is no opposing wall pair in the unroofed
column, which is why both ladders top out at the same 19.55 m.

**DATA OWNER'S CALL** (this lane did not edit course data). Three fixes, any one
of which the measured chain already clears:
1. punch the turret out of the two walkway slabs — split `[0,21.23,-9]` and
   `[-9,21.23,0]` around x/z in [-9.4, -5.4];
2. move `SHAFT_C` outside the fort's wall ring (it currently sits 2.6 m inside
   the curtain's inner face);
3. raise the shaft floor to the rampart deck at 21.40 and publish ROUTE B as
   5.60 m / three kicks — the route `_mv_kickladder.py` already climbs.

Also worth a look from the reach lane: `reachcheck.mjs --require-all` passes
verdant-2, so its model of this shaft does not see the ceiling.

## More than half the defect corpus was unmeasured, and the reasons were six (2026-09-08, backlog lane)

The replay pass verdicted 315 logged playtest defects and could not test 162 of
them. Grouped by WHY (`_harness/_untest_groups.py` →
`_playreports/_untest_groups.json`), by PRIMARY blocker at the start of the lane:

| blocker | n | what the harness lacked |
|---|---|---|
| frame-claim | 31 | a deliberate camera and an eye |
| no-position (parseable) | 27 | a coordinate WAS in the prose; nothing parsed it |
| no-position | 25 | the report names a place, not a coordinate |
| battery-too-generic | 22 | settle / walk / jump does not test the claim |
| needs-phase | 19 | a hazard beat the driver could not wait for |
| unreachable | 11 | the driver could not stand at the station |
| behind-blocker | 9 | the station is past another defect's blocker |
| needs-savestate | 8 | a crest / power / trigger precondition |
| needs-2-inputs | 5 | a move that is two keys at once |

A defect usually carries several: 58 of the 162 carry a frame claim, 50 a
parseable position, 38 a hazard phase, 15 a save-state precondition.

**After the lane: 95 of the 162 are decided (30 FIXED, 65 STILL REPRODUCES) and
67 remain COULD NOT TEST**, every one of them now carrying a
`stillUntestedBecause` line naming exactly what is missing. Over all 315:
122 FIXED / 126 STILL REPRODUCES / 67 COULD NOT TEST.

The new harness is `_harness/_untestlib.py` (a `Probe` on top of `_playlib.Play`:
goto+verify with a bounded ring search, a save-state setter, a clock-advance
phase scan, a two-input helper, a wall-kick ladder, a camera sweep, screen /
material / frame reads and a prose station resolver), driven by
`_untest_probe.py` (per-claim batteries), `_untest_look.py` (aimed frames for
colour claims) and `_untest_verdict.py` (the rules).

### The replay pass's camera evidence was all null

`_replay_probe.py`'s `CAMV` reads `CRESTBOUND.game.cam.cam` and returns null when
it is missing. `FollowCamera` exposes the three.js camera as **`.camera`**
(`runtime/player/camera.js:1163  this.camera = camera`), so every camera
measurement that pass took came back null — no `cam dist / onScreen / occluded`
string appears in any of its 315 evidence lines.

### reset(t) makes a hazard phase free — there is nothing to wait for

CONTRACT §21's determinism law means a phase-dependent claim needs no wall clock.
`__CBX.phaseScan(x, y, z, tmax, n)` walks the course clock in n steps, calls
`reset(t)` on every hazard, refreshes the collider set, and asks whether a capsule
at the station is inside a kill volume or a moving box at that phase, then
restores the live clock. 49 phases over 24 s cost about 0.4 s of browser time and
decided most of the death and idle-crush claims in this pass.

### The scarf is not an Object3D, so a rig sampler reports it perfectly still

`hero.js` merges the scarf's geometry into `nim.body` and rewrites its vertices
each frame from a Float32Array of verlet particles (`_scarfP`, 7 links = 8
particles) hung off `nim.staticBone`. A sampler that walks `hero.root` reports
zero scarf motion whatever the scarf is doing — 30 named nodes, none a scarf link.
Read `hero._scarfP` directly: on rime-2 the 8 links moved 0.399 m in local space
over a 1.4 s run.

### Six ways a station probe lies, all measured this pass

1. **A downward ray started well above the station finds the deck ABOVE it.**
   `groundAt(x, z, y + 60)` on ember-3's mid deck (y 22.10) returned 34.90. Ground
   under the feet is `groundAt(x, z, y + 0.4)`.
2. **Re-resolving a height of 0.0 moves the station to the roof.** The Keep lobby
   floor IS y 0; treating `0.0` as "no height given" put the lobby spawn-pad
   station at y 15.15 and keep#08's tree station 4.71 m up the tree.
3. **A coordinate lifted out of the `did` narrative is where the tester STARTED.**
   Station rank: WHERE and HAPPENED decide; DID, and any height the harness had to
   resolve off the ground, report their numbers and decide nothing.
4. **SOURCE outranks FORM.** rime-2#16's WHERE line names both ends of the hop
   (`block 1 (6.40, top 35.35, -46.00) to block 2 (5.20, top 36.80, -49.72)`)
   while its HAPPENED line gives the MISS position as a clean bracketed triple.
   Ranking by form first drove the crossing test from the wrong place.
5. **A station outside the course bounds or under `killY` is not a station.** A
   prose parse produced (0, -30.42, 7.33) on verdant-1, 30 m under the world.
6. **A ceiling cast from head height misses a ceiling below the head.**
   azure-2#08 claims 1.00 m of headroom for a 1.5 m hero; a ray started at
   feet + 1.55 m begins ABOVE that ceiling and reports 9 m of clearance. Cast from
   feet + 0.12 m.

`probePoint`'s `insideFrac` had the same shape of bug: it counted every solid
collider whose AABB met the body box, which includes the FLOOR at every station,
so it read 1.00 everywhere. It now counts only a box that intrudes into the body
column (`aabb.max.y > feet + 0.25 && aabb.min.y < feet + 1.45`).

### A verdict rule may only fire on the claim it measures

Seven rules were written, shipped and then caught deciding the wrong claim:

* keep#13 was called FIXED because the HERO was unoccluded — the tester's words
  were that a hanging banner hid the LOFT.
* keep#05 (an interact prompt drawn 27 m from Old Fen) was called FIXED on "a
  collider covers the spot on 100% of the cycle", true almost everywhere.
* ember-2#07 — "Zero deaths in 9 of 9 runs, nothing in the hall can touch a player
  who walks a lane" — was called FIXED because the probe did not die there. The
  ABSENCE of a kill is that tester's complaint; `tooSafe` is now its own claim
  kind with the verdict inverted.
* ember-1#17's complaint is a lens COLLAPSE ("a metre from his skull"); deciding
  it on an occlusion count called it reproduced while the lens measured 2.35 m
  out. Collapse claims go to `cam.dist`, occlusion claims to the ray.
* rime-2#19's complaint is an un-posed slopeSlide, not the scarf.
* verdant-3#22 is filed under `stairs` but complains about the CAMERA.
* ember-2#10 (a wrapped sign) was decided by the POUND rule because its WHERE line
  contains the word "grate".

Every rule is now gated on a CLAIM KIND parsed from the tester's own `happened` +
`should` — never `where`, which is a description of a place and drags in words
("the crusher cave", "the wall-kick shaft") that would hand a rule a claim the
tester never made.

### Two guards that turn a non-measurement into an honest blank

* **A crossing that never got a run-up says nothing about the gap.** On rime-2#16
  the hero was in `slopeSlide` at the launch and all five moves left at 0.06 m/s.
  The rule now requires one attempt to reach 2 m/s — and separately decides a
  STEP-UP on apex alone, since a jump's height does not need horizontal speed
  (ember-4#06: 2.20 m across at +2.07 m, best apex 1.83 m).
* **A hero who drifts off the spot was not standing there to be killed.**
  azure-2#16's bell-rope station drops 26 m during the 6 s stand, so "no death" is
  a fact about wherever he landed. Drift > 3 m voids the stand.

### Two probe artefacts worth knowing before reading a frame

* **Repeated `__dev.tp` can latch the speed-line post effect on.** Every station
  frame this probe took on ember-2 carries radial white speed-lines and chromatic
  fringing with the hero idle at speed 0; the LOOK pass on the same course,
  minutes later, shows none. Do not file it as a rendering defect, and do not read
  colour off a station frame that shows it.
* **A station probe collects things.** A teleport onto a crest takes it and opens
  the clear card, and every battery after it then measures a celebrating game
  (verdant-2#26 did exactly this). `_untest_probe.py` now resumes the game before
  each defect and records `hadToResume` when it had to.

### What the look pass still cannot do

`_untest_look.py` stands 7 m off a station and aims at it, which is what a colour
claim needs, but its standing spot is chosen by a ground raycast and is not
verified: on ember-1 it repeatedly landed IN a flame vent (three of its frames are
the death screen), on keep#11 it landed on a roof above Old Fen, and on elevated
stations it often lands on the ground below the walkway. Giving `look()` the
`goto_verify` treatment is the obvious next fix.

## The turret was roofed by its own fort, and builders.js already had the lever (2026-09-08, blocker-verify pass)

The moveset lane left verdant-2 ROUTE B as a DATA OWNER'S CALL: the north-west
turret's wall-kick chimney (floor 18.60, exit ledge 27.00) is planted inside the
middle fort's own footprint, and the fort's rampart walkway slabs lid it at
**21.06** — 2.46 m over the shaft floor. Re-measured unchanged at the start of
this pass (`_mv_shaftroof.py verdant-2 -7.4,18.60,-7.4 1.6`: 21.06 over every
cell with x <= -7.60 or z <= -7.60) and the ladder confirmed it
(`_mv_kickladder.py`: maxY **19.557**, 0.957 m of the 8.40 m needed, kick 1 fires
and is erased, kick 2 never gets a contact).

The fix is data, and the generator already carried it. `builders.js roofOptsFor`
+ `roofFort` accept **`roofOpen: [{x, z, w, d}]`** — "apertures through the roof
in LOCAL footprint coords … for an authored tower or shaft that pierces the
walk" — and `rectSubtract` applies them to the deck rectangles, the colliders
built from those same rectangles, the merlons and the safeEdge stripes.
verdant-2's middle fort now declares the turret's own outer face:

    roofOpen: [{ x: SHAFT_C[0], z: SHAFT_C[1], w: 4.0, d: 4.0 }]   // x/z -9.4 .. -5.4

Measured after, same three tools, nothing else changed:

| | before | after |
|---|---|---|
| ceiling over the chimney | 21.06 | open sky |
| `_mv_kickladder.py` maxY | 19.557 | **27.872** (need 27.00, `reached: true`) |
| kicks | 1 fired, then erased | 19.544 → 21.618 → 23.681 → 25.755, **+2.07 m each** |
| `_bl_shaftexit.py` landing | — | **grounded on the exit ledge at (-11.44, 27.00, -7.62)**, alive |
| verdant-2 boot | not sampled this session | 212 draws / 411,000 tris, BOOTS CLEAN |
| reachcheck | PASS | PASS (14/14, RESULT OK) |

Nothing was deleted to get it: the hole is exactly the turret's own footprint, the
turret's four slabs (18.60 .. 27.40) fill it, and the walk still rings the fort on
the 1.0 m outer strip that survives outside the turret — which is what a wall-walk
does when it meets a corner turret. It also restores authored content that the lid
had swallowed: four of the chimney's five stacked coins (y 22.0, 23.6, 25.2, 26.8,
"one per kick") were above the deck.

**The lesson is the search order.** Three fixes were on the table and two of them
were course surgery (move the shaft, or raise its floor and republish ROUTE B as
5.60 m). The one that shipped was a five-token data line, because the builder had
already been given an aperture list by whoever authored `roofOptsFor` — grep the
generator for the knob before redesigning the content it generates.

## A boss that will not die may be a driver that cannot get back (2026-09-08, blocker-verify pass)

`_lc_fight.py` fights each Warden and, on a hero death, waits 2.4 s and re-walks
`walk_to(arena, max_ms=9000)`. ember-1's arena is ~78 m from its checkpoint, so
that walk can never arrive: the ember-1 run logged **16 hero deaths, cause lava,
all at [0, 4.6, 41]** (the respawn pad, not the arena), 2 hits, `killed false` —
which reads exactly like "the boss cannot be killed". `_bl_fight2.py` changes one
thing, the recovery: teleport to the arena APPROACH and walk the last stretch in
on foot. Same build, same beat loop, minutes later:

| course | states | hits | killed | hero deaths | crest |
|---|---|---|---|---|---|
| ember-1 | roar/stompTele/stomp/chargeTele/charge/dizzy/hit/death/dead | 3 | **true** | **0** | 1 |
| verdant-1 | same set | 3 | **true** | **0** | 1 |
| ember-4 | same set | 3 | true | 0 | 1 |
| azure-3 | same set | 7 | true | 2 (void) | 1 |

Before reporting a fight as unwinnable, check whether the harness ever stood in
the ring: a death loop 78 m away is evidence about the recovery path only.

## The gate sweep of 2026-09-08 (blocker-verify pass), and what the box did to it

Headed, one Chrome at a time, on the tree that carries the turret aperture.

| gate | result |
|---|---|
| modulecheck | 66 modules, **0 failing** |
| physcheck | 176 checks, **0 failing** |
| reachcheck --require-all | 14 authored, **0 failing**, RESULT OK (3 INFO orphans: ember-1 rock#90, azure-3 crusher#45/#46) |
| gatecheck | **342 passed, 0 failed** (911 s) |
| spawnwalk | **12 of 12** routable gates walked from the authored Keep spawn |
| inputcheck --headed | **0 of 37 failing** |
| bootcheck | **14 of 14 BOOT CLEAN**, every course inside 260 draws / 450k tris |
| loopcheck | **1117/1119, 0 failed**, 2 warnings; respawn medians 422-444 ms (budget 700) |
| feelcheck | **FEEL OK, 0 failing** |
| camcheck | **CAMERA OK, 0 failing** incl. all 13 interior stations |
| contrastcheck | **KNOWN RED** — 42 of 62 gated stations under 3.5:1 |
| perfcheck | **KNOWN RED, CONTAMINATED** — OVER BUDGET 14 of 14 |

**camcheck's one failure was a flake, and the paired run is what proved it.** The
first full sweep failed `verdant-2/@midwalk` on `heroOffscreenFrames 4`. Rather
than attribute that to the aperture two courses' width away, the pre-change tree
was extracted (`git archive HEAD games/crestbound | tar -x -C games/_bisect/blbase`)
and the same station driven on both:

| tree | in the 400-frame sweep | isolated |
|---|---|---|
| base (no aperture) | FAIL, `worstGameRun_s` **0.371**, offscreen 0 | PASS (offscreen 0, gameRun 0.24) |
| this tree | FAIL, offscreen **4**, `worstGameRun_s` 0.1 | PASS x2 (offscreen 0, gameRun 0.00) |

Two different metrics on two trees, both green in isolation: the station samples
four headings across course clock 12 - 24 s while a 7 s-period rotor bar sweeps
the walk, so which frame the arm is in front of is a function of how long the
page took to settle. **A failure whose METRIC changes between trees is a flake,
not a regression.** The full camcheck re-run read CAMERA OK, 0 failing.

**perfcheck: the box, measured, not assumed.** `Get-Counter '\GPU Engine(*engtype_3D)\
Utilization Percentage'` **before** the run, with **zero chrome.exe alive**: dwm
42.92 % (two adapters), WUDFHost 2.89 %, claude 1.60 % = **47.41 % of the 3D engine
already spoken for**. After: 65.66 %, and by then the owner's own Chrome (12
processes, opened by Claude.exe on a Google auth page) was alive — left strictly
alone. Every course is INSIDE the geometry budget (worst draws 249 of 260,
verdant-3; worst triangles 447,290 of 450,000, verdant-3); the whole shortfall is
fps / p99 / warm load. Attributed with the same-session paired run the rules above
demand:

| course | base (pre-aperture) | this tree | delta |
|---|---|---|---|
| keep | 194 draws / 413,764 tris / **41.0** fps / p99 30.66 / warm 1604 ms | 194 / 413,764 / **43.1** / 30.24 / 1566 | +2.1 fps on BYTE-IDENTICAL geometry |
| verdant-2 | 215 / 412,076 / **40.4** / 33.00 / 1752 | 215 / 412,428 / **38.4** / 33.67 / 1872 | -2.0 fps, +352 tris |

The Keep is the control: not one triangle differs between those two runs and it
still moved 2.1 fps, so +-2 fps IS the noise floor on this box — and verdant-2's
-2.0 sits inside it, at identical draw calls. The aperture costs nothing.

## The verify pass of 2026-09-09: seven residuals re-driven, and three things the sweep found

Headed, one Chrome at a time, on the tree that carries the shaft-residual (ce85f569)
and readability (e3d8e95f) lanes. Every residual was re-driven with real
KeyboardEvents through `input.__test`, never by re-reading the lane's own claim.

| defect | verdict | the measurement |
|---|---|---|
| azure-2 #12 winding shaft | FIXED | `_sr_a2shaft.py`: three walk-ins on foot from three bell-deck spots all ended INSIDE the shaft (x 6.42 / 6.26 / 7.85 at y 33.06) instead of bonking at x 3.77, and the ladder from where the WALK left him reached the clock face every time (maxY 40.28 / 40.23 / 40.27, 3 kicks, grounded at y 40.00) |
| azure-3 #22 rotor bands | FIXED | live kill capsules measure reach 2.250 m (len 1.3), unsafe body-inclusive band x 18.37..23.63; 30 s hands-off at the tester's own x 18.00 and x 24.00 → 0 deaths, 0.00 m drift |
| azure-3 #30 killY | FIXED | `_sr_warn.py azure-3` → "0 validator console line(s)" |
| ember-4 #04 dune rim | FIXED | `_sr_rimwalk.py ember-4`: 9 of 9 outward 9 s walks held inside the heightfield, 0 deaths; the tester's own west line ends idle at (-61.91, 3.18, 60.45) instead of dying 'void' at (-79.47, -14.26, 64.04) |
| ember-1 #29 flame catwalk | FIXED | phase table 29 of 56 sampled phases with every vent dark (was 0 of 56); 3 of 3 crossings on three different course clocks, 0 deaths |
| ember-2 #07 piston hall (`tooSafe`) | FIXED | 21 of 21 hands-off row stands now die (0.02–2.07 s), 0 of 6 breather stands die, and a played run crossed all three rows to the north door with 0 deaths |
| rime-2 #15 serac step | FIXED | `_vp_r2shot.py` (hops:1): 3 of 3 hops land ON the half-step (y 4.52/4.51/4.50) and 3 of 3 land ON serac 2 (y 5.70), all with a plain jump 1 of rise 1.90–1.91 |

Corpus after: **157 FIXED / 88 STILL REPRODUCES / 70 COULD NOT TEST** of 315.

**A probe that keeps holding W after the landing measures the NEXT platform.** The first
frame attempt for rime-2 held W for 1200 ms across the jump; the hero landed on the
half-step and then ran off it, ending 11 m away at (-36.36, 1.42, 16) — which reads
exactly like "the step cannot be landed". The frame-exact driver (hold to apex, one hop,
release) put him on the block every time. A hold that outlives the move is not a test of
the move.

**verdant-3 is 980 triangles OVER the 450k budget at its spawn, and it is not this pass.**
bootcheck read 252 draws / **450,980** tris three times, byte-identical. The paired run
the rules demand (`git archive 2ee15ad7 games/crestbound | tar -x -C games/_bisect/vrpbase`,
then `bootcheck --url .../games/_bisect/vrpbase/...`) reads **450,982** on the pre-lane
tree — two triangles MORE. The breach is inherited, deterministic (not the ±3k coin-band
swing recorded on 2026-09-05), and 0.2 % over. Every other course is inside both budgets;
worst draws are verdant-3's 252 of 260.

**The contrast gate's instability is big enough to change a verdict.** The readability
lane recorded ember-2 cp3 at 3.79 (a PASS). Three runs this pass — one full sweep and two
isolated `--courses ember-2,rime-2` runs — read **2.89 / 2.71 / 2.67**, all FAIL, spread
0.22. rime-2 cp2 likewise went from a measured 2.70 to NO EDGE (0 lines) in all three.
So the shipped count is **8 failing gated stations, not 7**, and CONTRACT §15 now says so.
A station within ~0.8 of the floor is not decided by one run; take three.

**perfcheck was skipped, and here is the counter that decided it.**
`Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage'` with no harness Chrome
alive: dwm **31.06 %** (16.56 + 14.50 across two adapters), WUDFHost **7.63 %**, claude
1.78 % — **~40 % of the 3D engine spoken for before the window opens**. Per the rule
above, an fps number taken there is not evidence either way; the geometry budgets in this
note come from bootcheck's deterministic `renderer.info` instead.
