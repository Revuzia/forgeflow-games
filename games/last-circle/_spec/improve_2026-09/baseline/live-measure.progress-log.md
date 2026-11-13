# Last Circle — live-measure lane (empirical baseline)

Status: IN PROGRESS (file is appended as measurements land; a half-written file is intentional).

Target: http://127.0.0.1:8790/games/last-circle/index.html (already-running scoped static server; working copy
INCLUDING the other session's uncommitted index.html ?v= bump and ffg_kernel_3d.js PORTRAIT CAMERA FIT edit).

Maps (verified): runtime/3d/royale/hud.js:124 `export const BATTLE_MAPS = ["isla_viva", "ashgrid", "deepwood"];`
Modes (verified): runtime/sim/royale.js:321-323 standard (50p, glider drop) / quick (50p, ground, 1.8x loot) / practice (1p).

## Method notes (written before running)
- Kernel loop: runtime/3d/ffg_kernel_3d.js `const dt = Math.min(0.05, this.clock.getDelta());` ... `if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);`
  -> render is variable-dt, one sim step per rAF (no fixed tick). The composer path means `renderer.info` with the
  default autoReset only ever shows the LAST pass (OutputPass quad). The probe sets `info.autoReset=false` and resets
  once per frame itself so draw calls = the WHOLE frame (shadow depth + scene + bloom chain + output), and it
  separately wraps the RenderPass to report scene-only (incl. shadow) calls.

## Box contamination (observed at 2026-09-29 ~23:20 local, before the baseline runs)
- `Get-CimInstance Win32_Process` scan: 10 OTHER automated Chrome browser processes alive (8-9 headless, 1 headed) —
  other audit lanes. `Win32_Processor.LoadPercentage` = 100 (16 logical CPUs, i7-11850H). Summed GPU 3D-engine
  utilisation across adapters ~107-109 %. Every number below is measured on a saturated box: treat absolute
  values as upper bounds, compare medians only against re-runs made under similar load (the probe records CPU%
  and other-Chrome count per window so a re-run can be matched).

## Smoke run 1 (ashgrid, cold context) — boot only survived
- boot_cold marks (ms from navigation start): first-paint 12772, __LC__ 41016, __FFG3D__ 47464, splash removed 47811.
  DCL 200 ms. 45 resources, 4.19 MB transferred, 5 GLBs = 2.27 MB.
- Console: 1 error in boot, verbatim: `Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico` (static-server artefact; the page has no <link rel=icon>).
- PROBE failure verbatim: `PROBE EXCEPTION at stage boot_warm: Page.reload: Timeout 120000ms exceeded.` — the
  warm-boot step used page.reload(wait_until="commit"); fixed in the probe by opening a fresh page in the same
  context (shares HTTP cache) instead of reloading.

## Smoke run 3 (ashgrid, DYEFIELD flag set = Intel iGPU, vsync) — the box could not render
Stage wall times: boot_cold 23:43:59 -> boot_warm 23:46:53 -> menu 23:49:36 -> load 23:50:28 -> drop 23:56:16.
- `__LC__.startMatch()` took **347 394 ms** (menu -> lobby shown) and every sampling window recorded **0 rAF frames**
  (menu, drop, ground, endgame). Timers still ran (the 250 ms snapshots landed), so the main thread was not wedged:
  requestAnimationFrame itself was not being scheduled.
- Boot: cold first-paint 13 684 ms, __LC__ 30 023 ms, __FFG3D__ 32 007 ms, splash removed 169 484 ms; longest single
  long task 31 137 ms (cold) / 54 058 ms (warm).
- GL string (this config): `ANGLE (Intel, Intel(R) UHD Graphics (0x00009A60) Direct3D11 vs_5_0 ps_5_0, D3D11)`, DPR 1,
  buffer 1600x900, graphics tier "medium", shadows on, bloom on.

### Discriminating control (scratch/rafcontrol.py: a blank page doing one WebGL2 clear per rAF, 5 s)
| config | frames in 5 s | rAF p50 / max ms | GL adapter |
|---|---|---|---|
| Intel d3d11, vsync (the DYEFIELD perfcheck flag set) | 4 | 20 / 2740 | Intel UHD |
| NVIDIA (`--force_high_performance_gpu`), vsync | 6 | 20 / 4280 | NVIDIA RTX A2000 Laptop |
| Intel d3d11, uncapped (`--disable-gpu-vsync --disable-frame-rate-limit`) | CRASH x2: `Exception: Page.evaluate: Connection closed while reading from the driver` | - | - |
| SwiftShader (CPU), vsync | 253 | 20 / 20 | SwiftShader |
| NVIDIA, uncapped | 1257 / 2206 (two runs) | 0.3-0.5 / 1273-877 | NVIDIA RTX A2000 Laptop |

GPU 3D-engine share at the same time (Get-Counter `\GPU Engine(*engtype_3D)\Utilization Percentage`, 3 s):
dwm 52.5 %, WUDFHost (DisplayLink driver host) 42.8 %, claude 8.7 %, each chrome <= 1.2 %.
**Conclusion (verified by the control): a trivial page cannot get frames through the vsync'd Intel/dwm path on this
box right now, so the 0-frame smoke run is a BOX fact, not a Last Circle fact.** The only config that renders is
NVIDIA + uncapped; the baseline below uses it (probe `--profile dgpu-uncapped`, the default). Uncapped numbers are
raw per-frame cost on a discrete RTX A2000 — they are the right yardstick for before/after, but they are NOT what a
player on an Intel iGPU laptop sees; do not compare them to a 16.7 ms vsync budget as if they were.

### Real console findings from smoke 3 (valid regardless of the GPU problem)
- Match load logged **235 console warnings** (0 errors) for one startMatch, e.g. verbatim:
  - `[rig] soldier FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightForeArm, RightHand, LeftArm, LeftForeArm, LeftHand, RightUpLeg, RightLeg, RightFoot, LeftUpLeg, LeftLeg, LeftFoot, neck|Neck], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig. @runtime/3d/royale/rig_pipeline.js:88`
  - `[rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR] @rig_pipeline.js:177`
  - `THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion.` (three.core.js:32264)
- Failed requests during the drop (verbatim): `FAILED http://127.0.0.1:8790/games/last-circle/assets/audio/sfx/step_concrete_003.ogg net::ERR_CONNECTION_REFUSED` (+ step_wood_001/002).
  The files exist and `curl` returns 200 afterwards, so this is the shared single static server refusing under load
  from many lanes, not a missing asset. Not a game defect; noted so a re-run does not chase it.

## Re-runnable probe (use these VERBATIM after fixes)
Probe: `C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/audit/scratch/lc_liveprobe.py`
Tables: `.../scratch/lc_liveprobe_table.py`   Box control alone: `.../scratch/rafcontrol.py`
```
cd C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/audit/scratch
python -u lc_liveprobe.py --reps 3 --label after          # needs the 8790 static server; ~6-8 min per run on a loaded box
python lc_liveprobe_table.py "_reports/lc_liveprobe_after_*.json"
python lc_liveprobe_table.py "_reports/lc_liveprobe_baseline_*.json"   # the baseline below
```
Baseline JSON: `.../scratch/_reports/lc_liveprobe_baseline_<stamp>.json` (rewritten after every run, so a partial battery survives).
If the probe is promoted into the repo, the natural home is `games/last-circle/_harness/perfcheck.py` (mirrors
`games/dyefield/_harness/perfcheck.py`); it touches no game file.

What it does per run (fresh browser context = cold HTTP cache; map order rotated per repeat = interleaved):
box control (blank WebGL2 clear page, 4 s) -> cold boot -> warm boot (new page, same context) -> menu window 5 s ->
`__LC__.startMatch({mode:'standard', mapId, seed})` with a 25 ms page-side load timeline -> REAL Enter keypress
(hud.js finishLobby skip) -> drop window 10 s (real rAF) -> `fastForward` until the player lands -> ground window
20 s (real rAF) -> endgame: alternate `fastForward(10 s)` with 1 s of real frames until `W.match.over` (every death /
kill-feed / storm event gets real view frames; the rAF delta spanning each fastForward is dropped) -> post-match
panel -> REAL click on PLAY AGAIN (match-over-match teardown path) -> again_drop window 5 s.
Instrumentation (instance-level wraps only, nothing in the repo is touched):
- `renderer.info.autoReset=false`, reset at the top of each kernel loop (`kernel._stepTweens` wrap), so draw calls /
  triangles are the WHOLE frame. The kernel draws through EffectComposer (ffg_kernel_3d.js loop:
  `if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);`), so the default
  autoReset would only ever show the OutputPass quad. "scene" calls = the RenderPass (which INCLUDES the shadow depth
  pass, since shadowMap.render runs inside renderer.render); "shadow" = `renderer.shadowMap.render` alone; the rest
  (~14) is the bloom chain + OutputPass.
- CPU frame = update (tweens + mixers + every onUpdate, i.e. the whole game step) + render submission (composer.render).
- Per-frame programs/textures/geometries so every >50 ms frame can be attributed to "a new program/texture/geometry
  appeared this frame" vs "nothing new was created" (= GPU backpressure / driver).
- Long tasks (PerformanceObserver), paint timing, resource timing, JS heap (`--enable-precise-memory-info`).
- Console errors/warnings, pageerror, window error + unhandledrejection, failed requests — tagged by stage.
Launch profile `dgpu-uncapped` (default): DYEFIELD's flag set + `--force_high_performance_gpu --disable-gpu-vsync
--disable-frame-rate-limit`, 1600x900, DPR 1, graphics tier = stored default "medium" (ffg_royale3d.js:650
`graphics: "medium"`), headless.

## Interim: first full run (isla_viva, rep 1, dgpu-uncapped) — kept as `_reports/lc_liveprobe_partial1_*.json`
(Stopped after run 1 to fix the probe: its PLAY AGAIN click failed verbatim `PROBE EXCEPTION at stage again_load:
Locator.click: Timeout 5000ms exceeded.`; the probe now records what is under the button centre, a screenshot, the
full Playwright call log, and falls back to a DOM click flagged as such.)
- Box control right before it: 3052 frames / 4 s, p50 0.50 ms, p99 2.0 ms, **max 1779 ms** — the box injects
  ~1-2 s stalls into even a blank page.
- Boot cold: first paint 1988 ms, menu built (__LC__) 2205 ms, splash gone 3328 ms, longest long task 2204 ms.
- Load (menu -> lobby): **40 677 ms**; main thread first free after 569 ms, map built at 15 327 ms, 50 rigs at 40 629 ms.
- Drop: p50 14.9 ms, p99 35.5 ms, 81 calls (30 shadow), 1.15 M tris. Ground: p50 24.1 ms, p99 88.5, max 622 ms,
  CPU frame p50 22.4 ms (update 9.4 + render 12.4), 140 calls, 4.0 M tris.
- Endgame (player died at t~45 s, spectating to the end at t=401 s): 558 real frames, draw calls median **437**
  (max **533** — over the 450 design budget), textures 61 -> 133 and geometries 347 -> 464 across the match,
  and **35 frames over 100 ms, the worst 8 between 9.0 and 24.3 SECONDS inside `composer.render`** with no new
  program/texture/geometry that frame. 35 of 36 fastForward slices were followed by such a frame, so this is
  "first frame after a multi-second main-thread block" and needs a discriminating test before it is called a game
  defect (see the stall section below).
- Menu window: **0 rAF frames in 5 s** (the kernel loop did not run either) — same symptom as the starved Intel path,
  intermittently on the NVIDIA path too.

## INTERIM tables — 4 of 9 baseline runs (superseded by the FINAL section when it lands)

### Boot (ms from navigation start; median [min-max] over 4 runs)

| | first paint | __FFG3D__ (kernel up) | __LC__ (menu built) | splash removed | CDN last byte | local last byte | long tasks n / total ms / max | resources / MB |
|---|---|---|---|---|---|---|---|---|
| cold | 7836 [2100-39804] | 32897 [13985-42028] | 27064 [12250-40265] | 33308 [14298-42500] | 3544 [797-4262] | 29136 [12261-40295] | 3 [2-3] / 10937 [7540-20189] / 10466 [6263-19840] | 44 [44-45] / 3.50 [3.50-4.19] |
| warm | 5038 [944-12292] | 9244 [2720-52806] | 5303 [2128-25441] | 10238 [3074-53277] | 3836 [221-9199] | 5682 [2069-25377] | 4 [2-6] / 6463 [1386-44225] / 5924 [1012-43469] | 43 [43-44] / 0.00 [0.00-0.00] |

### Box control (blank WebGL2 clear page, same browser + flags, measured right before each run)

| map | frames | p50 ms | p95 ms | p99 ms | max ms | >33ms |
|---|---|---|---|---|---|---|
| isla_viva | 882 | 0.50 | 1.40 | 3.5 | 929 | 0.2% |
| ashgrid | 1988 [1161-2814] | 0.35 [0.30-0.40] | 0.85 [0.70-1.00] | 1.9 [1.4-2.4] | 424 [4-844] | 0.1 [0.0-0.1]% |
| deepwood | 769 | 0.40 | 1.10 | 2.9 | 15 | 0.0% |

### Match load timeline (ms after startMatch(); first poll sample where the condition held)

| map | main thread first free (first poll after start) | map built (W.map new) | 50 mixers (models loaded) | resolved (lobby shown) | programs at resolve | textures | geometries |
|---|---|---|---|---|---|---|---|
| isla_viva | 7188 | 21738 | 36307 | 36355 | 79 | 42 | 326 |
| ashgrid | 2772 [1370-4175] | 73438 [55947-90930] | 123998 [97349-150648] | 124058 [97393-150724] | 72 [72-72] | 46 [44-48] | 319 [319-319] |
| deepwood | 13833 | 86844 | 112342 | 112396 | 73 | 42 | 325 |

### Match load / lobby (per map)

| map | startMatch() ms (menu -> lobby shown) | Enter -> drop s | land fastForward wall s | endgame over? | endgame wall s | PLAY AGAIN -> lobby s |
|---|---|---|---|---|---|---|
| isla_viva | 36355 | 12.85 | 18.0 | True | 145 | 81.7 |
| ashgrid | 124058 [97393-150724] | 15.17 [5.08-25.25] | 5.6 [4.3-6.8] | True/True | 179 [167-191] | 43.4 [37.1-49.7] |
| deepwood | 112396 | 4.28 | 35.2 | True | 205 | n/a |

### Window: menu (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 28.4 | 35.2 | 47.1 | 48.1 | 48 | 50.0% | 12.7 / 13.5 (0.2 / 12.5) | 283 (61 / 269) | 92k | 19 | 206 | 16 | 24 | 1.00, [1600, 900] | 100 / 93 |
| ashgrid | 2 | 9.8 [6.4-13.1] | 10.6 [8.7-12.4] | 177.3 [29.1-325.5] | 2179.0 [1762.3-2595.7] | 3084 [2847-3320] | 5.6 [3.6-7.7]% | 7.3 [5.6-9.1] / 2176.4 [1759.0-2593.8] (0.2 [0.2-0.3] / 7.0 [5.3-8.8]) | 290 [283-297] (61 [61-61] / 276 [269-283]) | 92 [92-93]k | 19 [19-19] | 206 [205-208] | 16 [16-16] | 33 [32-34] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 101 [94-108] |
| deepwood | 1 | n/a | n/a | n/a | n/a | n/a | n/a% | n/a / n/a (n/a / n/a) | n/a (n/a / n/a) | n/ak | 19 | 208 | 16 | 32 | 1.00, [1600, 900] | 100 / 94 |

### Window: drop (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 25.4 | 14.1 | 33.3 | 807.9 | 3101 | 5.1% | 12.9 / 800.8 (2.9 / 9.4) | 87 (34 / 73) | 2208k | 83 | 348 | 55 | 139 | 1.00, [1600, 900] | 100 / 98 |
| ashgrid | 2 | 11.2 [5.8-16.7] | 29.5 [29.1-29.9] | 96.8 [82.5-111.2] | 1998.7 [714.8-3282.6] | 3102 [1251-4953] | 33.2 [29.5-36.8]% | 24.7 [23.9-25.5] / 1999.6 [716.4-3282.7] (4.5 [4.4-4.7] / 19.6 [18.6-20.7]) | 262 [257-266] (86 [86-87] / 248 [243-252]) | 10991 [10962-11020]k | 76 [76-76] | 374 [368-380] | 72 [69-76] | 161 [154-168] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 94 [92-97] |
| deepwood | 1 | 39.3 | 25.1 | 36.6 | 39.4 | 41 | 17.5% | 20.6 / 30.0 (4.4 / 15.8) | 118 (64 / 104) | 7955k | 76 | 353 | 61 | 152 | 1.00, [1600, 900] | 100 / 99 |

### Window: ground (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 5.6 | 27.4 | 648.5 | 2729.8 | 7324 | 26.6% | 26.1 / 2270.4 (9.5 / 15.9) | 307 (64 / 293) | 9452k | 86 | 435 | 96 | 142 | 1.00, [1600, 900] | 100 / 101 |
| ashgrid | 2 | 10.6 [8.2-12.9] | 24.1 [21.2-27.0] | 53.4 [51.8-55.0] | 1964.4 [1094.7-2834.1] | 4844 [4596-5092] | 18.5 [18.3-18.8]% | 22.8 [19.9-25.7] / 1966.6 [1098.1-2835.0] (6.3 [5.8-6.9] / 16.2 [13.8-18.6]) | 280 [268-292] (78 [77-79] / 266 [254-278]) | 8206 [8163-8249]k | 78 [78-78] | 428 [417-438] | 96 [96-97] | 152 [142-163] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 98 [95-100] |
| deepwood | 1 | 4.6 | 40.1 | 873.9 | 4656.4 | 4662 | 85.5% | 36.8 / 4652.9 (10.9 / 24.4) | 374 (40 / 360) | 14999k | 82 | 413 | 111 | 163 | 1.00, [1600, 900] | 100 / 97 |

### Window: endgame_realframes (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 30.5 | 16.6 | 82.1 | 498.2 | 1537 | 10.8% | 14.4 / 4088.3 (3.2 / 10.2) | 247 (63 / 233) | 3945k | 86 | 479 | 133 | 152 | 1.00, [1600, 900] | n/a / n/a |
| ashgrid | 2 | 26.6 [25.5-27.7] | 19.3 [17.5-21.1] | 65.4 [62.2-68.6] | 477.6 [468.6-486.5] | 1403 [1236-1570] | 13.8 [12.1-15.5]% | 17.5 [16.1-18.9] / 4491.2 [3564.4-5418.0] (4.3 [3.9-4.8] / 12.7 [11.5-13.8]) | 261 [254-268] (78 [76-79] / 247 [240-254]) | 5334 [5312-5357]k | 78 [78-78] | 500 [496-503] | 116 [114-118] | 146 [144-147] | 1.00 [1.00-1.00], [1600, 900] | n/a / n/a |
| deepwood | 1 | 21.2 | 25.4 | 106.3 | 517.2 | 1815 | 25.0% | 21.2 / 6770.4 (5.4 / 14.4) | 197 (45 / 183) | 3760k | 82 | 461 | 138 | 146 | 1.00, [1600, 900] | n/a / n/a |

### Window: again_drop (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 8.4 | 35.9 | 415.5 | 1117.6 | 1293 | 62.5% | 33.5 / 1119.7 (5.0 / 22.9) | 268 (31 / 254) | 2543k | 85 | 430 | 157 | 150 | 1.00, [1600, 900] | 100 / 92 |
| ashgrid | 2 | 8.2 [7.5-9.0] | 33.8 [28.9-38.7] | 242.2 [67.0-417.4] | 1610.9 [910.5-2311.3] | 2224 [1034-3414] | 46.2 [35.3-57.1]% | 31.6 [27.6-35.7] / 1609.1 [913.1-2305.2] (5.1 [4.8-5.5] / 21.8 [21.6-21.9]) | 352 [342-361] (76 [60-92] / 338 [328-347]) | 9512 [5847-13178]k | 84 [80-89] | 466 [465-467] | 140 [137-144] | 160 [152-167] | 1.00 [1.00-1.00], [1600, 900] | 100 [99-100] / 97 [96-97] |
| deepwood | 1 | 46.9 | 18.5 | 50.2 | 51.0 | 51 | 11.8% | 16.0 / 49.2 (3.2 / 11.8) | 139 (48 / 125) | 2869k | 86 | 375 | 172 | 144 | 1.00, [1600, 900] | 100 / 97 |

### Stall attribution (frames whose CPU frame > 50 ms; per window, summed over runs)

| window | map | frames >50 ms | >100 ms | of which a new program / texture / geometry appeared | pre-window frame cpu ms | worst 3 (cpu ms, render-submit ms, dProg/dTex/dGeo) |
|---|---|---|---|---|---|---|
| menu | isla_viva | 0 | 0 | 0 (of the <=8 worst listed per run) | 15131 |  |
| menu | ashgrid | 4 | 4 | 0 (of the <=8 worst listed per run) | 11 [10-12] | 3318.1/3317.9 (0/0/0); 2844.4/2843.5 (0/0/0); 871.0/870.6 (0/0/0) |
| menu | deepwood | 0 | 0 | 0 (of the <=8 worst listed per run) | 14126 |  |
| drop | isla_viva | 5 | 4 | 1 (of the <=8 worst listed per run) | 15 | 3089.5/3086.9 (1/2/1); 1385.1/1382.5 (0/0/0); 856.8/854 (0/0/0) |
| drop | ashgrid | 8 | 5 | 1 (of the <=8 worst listed per run) | 62 [43-81] | 4946.3/4941.8 (0/0/0); 1255.6/1248.2 (0/0/0); 450.2/446.2 (1/1/0) |
| drop | deepwood | 0 | 0 | 0 (of the <=8 worst listed per run) | 106 |  |
| ground | isla_viva | 7 | 6 | 2 (of the <=8 worst listed per run) | 8549 | 7319.2/7306.9 (0/0/0); 2375.1/2360.2 (0/13/18); 1502.5/1493.4 (0/1/1) |
| ground | ashgrid | 20 | 16 | 0 (of the <=8 worst listed per run) | 2029 [1453-2605] | 5102.3/5095.6 (0/0/0); 4593.7/4587.9 (0/0/0); 4513.3/4505.3 (0/0/0) |
| ground | deepwood | 9 | 4 | 0 (of the <=8 worst listed per run) | 1252 | 4673.8/4663.3 (0/0/0); 4643.1/4630.7 (0/0/0); 1639.4/1628.8 (0/0/0) |
| endgame_realframes | isla_viva | 38 | 35 | 1 (of the <=8 worst listed per run) | n/a | 10786.3/10778 (0/1/0); 8598.6/8594.5 (0/0/0); 6661.4/6659.6 (0/0/0) |
| endgame_realframes | ashgrid | 75 | 67 | 0 (of the <=8 worst listed per run) | n/a | 27784.7/27780.4 (0/0/0); 17810.5/17806.2 (0/0/0); 12368.9/12365.7 (0/0/0) |
| endgame_realframes | deepwood | 41 | 29 | 0 (of the <=8 worst listed per run) | n/a | 16995.2/16991.3 (0/0/0); 14807.4/14802.6 (0/0/0); 12237.2/12232.6 (0/0/0) |
| again_drop | isla_viva | 3 | 2 | 0 (of the <=8 worst listed per run) | 45 | 1296.9/1267.2 (0/0/0); 115.4/108.6 (0/0/0); 58.8/54.5 (0/0/0) |
| again_drop | ashgrid | 5 | 2 | 0 (of the <=8 worst listed per run) | 34 [34-34] | 3401.5/3391.5 (0/0/0); 1037.1/1033 (0/0/0); 83.1/78.2 (0/0/0) |
| again_drop | deepwood | 1 | 0 | 0 (of the <=8 worst listed per run) | 26 | 54.5/50.3 (0/0/0) |

### Errors by stage (all runs)

- boot_cold: 4 console errors, 0 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
- load: 4 console errors, 940 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
    - `[warning] [rig] soldier FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightForeArm, RightHand, LeftArm, LeftForeArm, LeftHand, RightUpLeg, RightLeg, RightFoot, LeftUpLeg, LeftLeg, LeftFoot, neck|Neck], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig. @http://127.0.0.1:8790/games/last-circle/ru`
    - `[warning] [rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR] @http://127.0.0.1:8790/games/last-circle/runtime/3d/royale/rig_pipeline.js?v=1789530264:177`
    - `[warning] [rig] athlete FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightForeArm, RightHand, LeftArm, LeftForeArm, LeftHand, RightUpLeg, RightLeg, RightFoot, LeftUpLeg, LeftLeg, LeftFoot, neck|Neck], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig. @http://127.0.0.1:8790/games/last-circle/ru`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle3.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- endgame: 0 console errors, 174 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- again_load: 0 console errors, 920 warnings
    - `[warning] [rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR] @http://127.0.0.1:8790/games/last-circle/runtime/3d/royale/rig_pipeline.js?v=1789530264:177`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle3.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- land_ff: 0 console errors, 6 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- menu: 1 console errors, 0 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
- ground: 0 console errors, 6 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- pageerrors: 0
- window error/unhandledrejection (init-script listener): 0
- failed requests: 1
    - ashgrid r1 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/audio/sfx/step_wood_001.ogg net::ERR_CONNECTION_REFUSED
- probe notes: 0

### Contamination

- isla_viva r1: other automated Chromes at start = 11; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 455.6 s
- ashgrid r1: other automated Chromes at start = 10; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 610.7 s
- deepwood r1: other automated Chromes at start = 12; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 722.3 s
- ashgrid r2: other automated Chromes at start = 12; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 444.2 s

## FINAL baseline tables — 9 runs (3 maps x 3 interleaved repeats), dgpu-uncapped, 2026-09-30 00:32-01:54 local
Source: scratch/_reports/lc_liveprobe_base_20260930_003158.json (generated by scratch/lc_liveprobe_table.py). Cells are median [min-max] over the 3 repeats of that map.

### Boot (ms from navigation start; median [min-max] over 9 runs)

| | first paint | __FFG3D__ (kernel up) | __LC__ (menu built) | splash removed | CDN last byte | local last byte | long tasks n / total ms / max | resources / MB |
|---|---|---|---|---|---|---|---|---|
| cold | 12656 [2100-39804] | 30285 [11536-42028] | 19177 [8454-40265] | 30644 [11855-42500] | 2976 [797-26479] | 24516 [8411-40295] | 3 [2-8] / 8285 [4163-20189] / 7805 [2447-19840] | 44 [44-45] / 3.50 [3.50-4.19] |
| warm | 2216 [408-12292] | 8517 [776-52806] | 4726 [573-36678] | 10043 [998-53277] | 591 [89-9199] | 4653 [537-36633] | 3 [2-8] / 3798 [805-44225] / 2303 [606-43469] | 43 [43-44] / 0.00 [0.00-0.00] |

### Box control (blank WebGL2 clear page, same browser + flags, measured right before each run)

| map | frames | p50 ms | p95 ms | p99 ms | max ms | >33ms |
|---|---|---|---|---|---|---|
| isla_viva | 1203 [882-1282] | 0.50 [0.40-0.50] | 1.40 [1.00-5.00] | 3.5 [1.7-25.9] | 929 [303-1120] | 0.2 [0.2-0.9]% |
| ashgrid | 2814 [1161-4777] | 0.30 [0.30-0.40] | 0.70 [0.70-1.00] | 1.7 [1.4-2.4] | 844 [4-1387] | 0.1 [0.0-0.1]% |
| deepwood | 844 [769-2844] | 0.40 [0.30-0.55] | 1.10 [0.80-1.30] | 2.9 [2.7-5.0] | 766 [15-1022] | 0.1 [0.0-0.4]% |

### Match load timeline (ms after startMatch(); first poll sample where the condition held)

| map | main thread first free (first poll after start) | map built (W.map new) | 50 mixers (models loaded) | resolved (lobby shown) | programs at resolve | textures | geometries |
|---|---|---|---|---|---|---|---|
| isla_viva | 12720 [7188-24502] | 39809 [21738-76575] | 61523 [36307-124980] | 61575 [36355-125023] | 79 [79-80] | 43 [42-44] | 324 [324-326] |
| ashgrid | 1589 [1370-4175] | 55947 [4129-90930] | 97349 [13736-150648] | 97393 [13764-150724] | 72 [72-72] | 44 [38-48] | 319 [313-319] |
| deepwood | 2863 [1552-13833] | 27877 [25679-86844] | 83177 [41619-112342] | 83376 [41628-112396] | 74 [73-77] | 42 [41-47] | 321 [321-325] |

### Match load / lobby (per map)

| map | startMatch() ms (menu -> lobby shown) | Enter -> drop s | land fastForward wall s | endgame over? | endgame wall s | PLAY AGAIN -> lobby s |
|---|---|---|---|---|---|---|
| isla_viva | 61575 [36355-125023] | 9.15 [5.57-12.85] | 18.0 [4.3-19.1] | True/True/True | 145 [92-177] | 67.6 [10.9-81.7] |
| ashgrid | 97393 [13764-150724] | 5.08 [4.07-25.25] | 4.3 [1.5-6.8] | True/True/True | 167 [66-191] | 37.1 [4.8-49.7] |
| deepwood | 83376 [41628-112396] | 4.28 [4.07-15.19] | 35.2 [23.7-40.4] | True/True/True | 205 [148-228] | 53.3 [45.3-61.3] |

### Window: menu (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 3 | 15.8 [11.8-28.4] | 16.1 [10.2-35.2] | 64.7 [47.1-88.7] | 1163.4 [48.1-1217.3] | 1572 [48-1772] | 16.0 [11.6-50.0]% | 8.7 [7.5-12.7] / 1048.9 [13.5-1212.0] (0.2 [0.2-0.2] / 7.7 [7.3-12.5]) | 283 [280-289] (61 [61-61] / 269 [266-275]) | 92 [92-92]k | 19 [19-19] | 206 [205-206] | 16 [16-16] | 18 [15-24] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 98 [93-103] |
| ashgrid | 3 | 13.1 [6.4-21.0] | 8.7 [6.4-12.4] | 67.4 [29.1-325.5] | 1762.3 [1399.8-2595.7] | 2847 [1755-3320] | 7.7 [3.6-8.6]% | 5.6 [4.5-9.1] / 1759.0 [403.5-2593.8] (0.2 [0.2-0.3] / 5.3 [4.2-8.8]) | 293 [283-297] (61 [61-61] / 279 [269-283]) | 93 [92-93]k | 19 [19-19] | 205 [202-208] | 16 [16-16] | 34 [32-38] | 1.00 [1.00-1.00], [1600, 900] | 100 [77-100] / 99 [94-108] |
| deepwood | 3 | 68.2 [14.6-121.7] | 12.1 [6.8-17.5] | 61.5 [12.9-110.1] | 444.0 [13.5-874.6] | 563 [14-1111] | 14.0 [0.0-28.0]% | 8.2 [5.1-11.2] / 436.4 [10.1-862.8] (0.2 [0.1-0.4] / 7.8 [5.0-10.7]) | 296 [293-300] (61 [61-61] / 282 [279-286]) | 93 [93-93]k | 19 [19-19] | 208 [202-208] | 16 [16-16] | 32 [29-34] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 97 [94-100] |

### Window: drop (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 3 | 25.4 [3.0-49.8] | 18.8 [14.1-24.0] | 38.0 [33.3-81.9] | 807.9 [39.3-6374.6] | 3101 [40-8813] | 15.8 [5.1-27.6]% | 16.7 [12.9-19.5] / 800.8 [34.0-6358.3] (3.3 [2.9-4.6] / 12.7 [9.4-14.4]) | 183 [87-186] (39 [34-87] / 169 [73-172]) | 4503 [2208-10239]k | 83 [82-84] | 374 [348-379] | 55 [53-75] | 150 [139-158] | 1.00 [1.00-1.00], [1600, 900] | 100 [89-100] / 98 [96-102] |
| ashgrid | 3 | 16.7 [5.8-40.4] | 29.1 [10.7-29.9] | 82.5 [18.4-111.2] | 714.8 [319.3-3282.6] | 1784 [1251-4953] | 29.5 [2.5-36.8]% | 23.9 [10.1-25.5] / 716.4 [321.0-3282.7] (4.4 [2.4-4.7] / 18.6 [7.5-20.7]) | 257 [128-266] (86 [52-87] / 243 [114-252]) | 10962 [7513-11020]k | 76 [75-76] | 368 [336-380] | 76 [69-77] | 166 [154-168] | 1.00 [1.00-1.00], [1600, 900] | 100 [66-100] / 97 [92-97] |
| deepwood | 3 | 39.3 [23.1-55.2] | 25.1 [17.3-27.6] | 36.6 [30.8-164.1] | 39.4 [32.2-219.6] | 41 [32-349] | 17.5 [0.0-40.0]% | 20.6 [14.9-20.9] / 30.0 [18.0-177.0] (4.0 [3.2-4.4] / 14.7 [11.6-15.8]) | 118 [99-213] (60 [47-64] / 104 [85-199]) | 7955 [5885-9237]k | 77 [76-81] | 344 [343-353] | 64 [61-70] | 150 [148-152] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 99 [99-99] |

### Window: ground (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 3 | 5.6 [3.0-19.0] | 27.4 [21.5-39.1] | 80.0 [35.5-648.5] | 2729.8 [1067.9-7155.6] | 7324 [2142-11304] | 26.6 [7.2-57.9]% | 26.1 [19.9-29.6] / 2270.4 [1066.5-7135.7] (9.5 [7.6-11.9] / 15.9 [11.9-16.8]) | 248 [199-307] (64 [63-65] / 234 [185-293]) | 8057 [3170-9452]k | 86 [86-86] | 422 [410-435] | 96 [89-97] | 154 [142-165] | 1.00 [1.00-1.00], [1600, 900] | 100 [90-100] / 96 [95-101] |
| ashgrid | 3 | 12.9 [8.2-48.7] | 21.2 [9.7-27.0] | 51.8 [15.5-55.0] | 1094.7 [57.0-2834.1] | 4596 [4366-5092] | 18.3 [1.3-18.8]% | 19.9 [9.2-25.7] / 1098.1 [51.0-2835.0] (5.8 [3.0-6.9] / 13.8 [6.1-18.6]) | 268 [118-292] (77 [46-79] / 254 [104-278]) | 8163 [5134-8249]k | 78 [77-78] | 417 [351-438] | 96 [79-97] | 163 [142-170] | 1.00 [1.00-1.00], [1600, 900] | 100 [60-100] / 97 [95-100] |
| deepwood | 3 | 7.6 [4.6-14.1] | 45.2 [40.1-45.6] | 275.5 [186.3-873.9] | 1373.6 [271.0-4656.4] | 4662 [294-5811] | 78.1 [67.3-85.5]% | 36.8 [36.8-42.1] / 1374.4 [238.4-4652.9] (13.3 [10.9-16.5] / 22.2 [22.1-24.4]) | 232 [112-374] (51 [40-53] / 218 [98-360]) | 6148 [2961-14999]k | 82 [82-84] | 413 [381-415] | 104 [93-111] | 150 [146-163] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 97 [97-99] |

### Window: endgame_realframes (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 3 | 30.5 [26.1-43.5] | 16.6 [10.9-17.0] | 82.1 [43.2-95.7] | 498.2 [343.8-579.6] | 1335 [1045-1537] | 10.8 [5.5-16.8]% | 14.4 [10.1-14.4] / 3169.4 [1348.0-4088.3] (3.2 [2.4-3.8] / 9.9 [7.4-10.2]) | 247 [161-265] (63 [40-68] / 233 [147-251]) | 3945 [2472-4067]k | 87 [86-87] | 479 [476-509] | 133 [119-136] | 168 [152-171] | 1.00 [1.00-1.00], [1600, 900] | n/a / n/a |
| ashgrid | 3 | 27.7 [25.5-48.7] | 17.5 [10.2-21.1] | 62.2 [32.6-68.6] | 468.6 [307.3-486.5] | 1236 [978-1570] | 12.1 [4.5-15.5]% | 16.1 [9.0-18.9] / 3564.4 [818.4-5418.0] (3.9 [2.3-4.8] / 11.5 [6.4-13.8]) | 254 [201-268] (76 [56-79] / 240 [187-254]) | 5312 [4317-5357]k | 78 [78-79] | 496 [478-503] | 118 [114-125] | 147 [144-152] | 1.00 [1.00-1.00], [1600, 900] | n/a / n/a |
| deepwood | 3 | 17.3 [17.1-21.2] | 23.9 [23.5-25.4] | 139.4 [106.3-187.9] | 602.0 [517.2-719.3] | 2587 [1815-3757] | 27.4 [25.0-28.6]% | 19.6 [19.5-21.2] / 6770.4 [2798.7-7962.2] (5.1 [4.9-5.4] / 13.7 [13.5-14.4]) | 197 [196-244] (45 [42-52] / 183 [182-230]) | 3781 [3760-4491]k | 83 [82-84] | 473 [461-482] | 138 [135-138] | 147 [146-148] | 1.00 [1.00-1.00], [1600, 900] | n/a / n/a |

### Window: again_drop (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 3 | 12.1 [8.4-34.0] | 23.6 [15.2-35.9] | 73.1 [65.7-415.5] | 1117.6 [89.3-1588.3] | 1293 [95-3390] | 22.7 [19.1-62.5]% | 23.0 [12.8-33.5] / 1119.7 [77.6-1584.8] (3.0 [2.8-5.0] / 14.8 [9.8-22.9]) | 268 [123-347] (56 [31-58] / 254 [109-333]) | 4580 [2543-6928]k | 80 [80-85] | 430 [357-486] | 149 [121-157] | 151 [150-178] | 1.00 [1.00-1.00], [1600, 900] | 100 [90-100] / 97 [92-97] |
| ashgrid | 3 | 9.0 [7.5-26.8] | 28.9 [11.1-38.7] | 67.0 [37.6-417.4] | 910.5 [806.8-2311.3] | 1997 [1034-3414] | 35.3 [6.7-57.1]% | 27.6 [10.4-35.7] / 913.1 [811.1-2305.2] (4.8 [2.6-5.5] / 21.6 [7.8-21.9]) | 342 [127-361] (60 [43-92] / 328 [113-347]) | 6250 [5847-13178]k | 81 [80-89] | 465 [362-467] | 137 [132-144] | 152 [142-167] | 1.00 [1.00-1.00], [1600, 900] | 99 [72-100] / 96 [96-97] |
| deepwood | 3 | 38.0 [4.9-46.9] | 21.0 [18.5-35.6] | 66.3 [50.2-127.5] | 85.6 [51.0-3179.1] | 90 [51-4142] | 16.7 [11.8-60.0]% | 18.9 [16.0-32.7] / 86.0 [49.2-3150.2] (4.2 [3.2-4.4] / 14.9 [11.8-26.4]) | 140 [139-352] (68 [48-79] / 126 [125-338]) | 6933 [2869-9827]k | 86 [79-87] | 384 [375-457] | 172 [168-173] | 144 [142-155] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 96 [94-97] |

### Stall attribution (frames whose CPU frame > 50 ms; per window, summed over runs)

| window | map | frames >50 ms | >100 ms | of which a new program / texture / geometry appeared | pre-window frame cpu ms | worst 3 (cpu ms, render-submit ms, dProg/dTex/dGeo) |
|---|---|---|---|---|---|---|
| menu | isla_viva | 4 | 2 | 0 (of the <=8 worst listed per run) | 7721 [23-15131] | 1759.1/1758.7 (0/0/0); 1572.7/1572.5 (0/0/0); 69.6/69.3 (0/0/0) |
| menu | ashgrid | 9 | 8 | 0 (of the <=8 worst listed per run) | 12 [10-580] | 3318.1/3317.9 (0/0/0); 2844.4/2843.5 (0/0/0); 1749.1/1748.8 (0/0/0) |
| menu | deepwood | 2 | 2 | 0 (of the <=8 worst listed per run) | 1454 [19-14126] | 1093.6/1092.5 (0/0/0); 131.8/130.1 (0/0/0) |
| drop | isla_viva | 7 | 5 | 1 (of the <=8 worst listed per run) | 21 [15-75] | 8794.5/8790.4 (0/0/0); 3089.5/3086.9 (1/2/1); 1385.1/1382.5 (0/0/0) |
| drop | ashgrid | 15 | 11 | 1 (of the <=8 worst listed per run) | 43 [35-81] | 4946.3/4941.8 (0/0/0); 1788.0/1786.1 (0/0/0); 1541.1/1538.9 (0/0/0) |
| drop | deepwood | 11 | 6 | 0 (of the <=8 worst listed per run) | 106 [27-132] | 207.0/14.6 (0/0/0); 175.1/90.6 (0/0/0); 164.0/95.1 (0/0/0) |
| ground | isla_viva | 24 | 17 | 2 (of the <=8 worst listed per run) | 4618 [2149-8549] | 11280.3/11257.6 (0/0/0); 7319.2/7306.9 (0/0/0); 2375.1/2360.2 (0/13/18) |
| ground | ashgrid | 30 | 25 | 0 (of the <=8 worst listed per run) | 1453 [13-2605] | 5102.3/5095.6 (0/0/0); 4593.7/4587.9 (0/0/0); 4513.3/4505.3 (0/0/0) |
| ground | deepwood | 71 | 34 | 0 (of the <=8 worst listed per run) | 1252 [118-52446] | 5795.3/5500 (0/0/0); 4673.8/4663.3 (0/0/0); 4643.1/4630.7 (0/0/0) |
| endgame_realframes | isla_viva | 150 | 115 | 3 (of the <=8 worst listed per run) | n/a | 10786.3/10778 (0/1/0); 10743.6/10736.9 (0/0/0); 10651.2/10649.2 (0/0/0) |
| endgame_realframes | ashgrid | 111 | 101 | 2 (of the <=8 worst listed per run) | n/a | 27784.7/27780.4 (0/0/0); 17810.5/17806.2 (0/0/0); 12368.9/12365.7 (0/0/0) |
| endgame_realframes | deepwood | 172 | 94 | 1 (of the <=8 worst listed per run) | n/a | 22660.2/22645.8 (0/0/0); 19137.0/19132.7 (0/0/0); 17168.4/17166.2 (0/0/0) |
| again_drop | isla_viva | 10 | 4 | 0 (of the <=8 worst listed per run) | 57 [45-72] | 3380.1/3377.6 (0/0/0); 1296.9/1267.2 (0/0/0); 484.5/481.4 (0/0/0) |
| again_drop | ashgrid | 9 | 6 | 0 (of the <=8 worst listed per run) | 34 [29-34] | 3401.5/3391.5 (0/0/0); 1989.2/1986.6 (0/0/0); 1142.3/1140.6 (0/0/0) |
| again_drop | deepwood | 5 | 1 | 0 (of the <=8 worst listed per run) | 26 [19-43] | 4122.8/4117.8 (0/0/0); 94.0/89.7 (0/0/0); 70.5/65.5 (None/None/None) |

### Errors by stage (all runs)

- boot_cold: 9 console errors, 0 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
- load: 13 console errors, 2119 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
    - `[warning] [rig] soldier FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightForeArm, RightHand, LeftArm, LeftForeArm, LeftHand, RightUpLeg, RightLeg, RightFoot, LeftUpLeg, LeftLeg, LeftFoot, neck|Neck], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig. @http://127.0.0.1:8790/games/last-circle/ru`
    - `[warning] [rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR] @http://127.0.0.1:8790/games/last-circle/runtime/3d/royale/rig_pipeline.js?v=1789530264:177`
    - `[warning] [rig] athlete FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightForeArm, RightHand, LeftArm, LeftForeArm, LeftHand, RightUpLeg, RightLeg, RightFoot, LeftUpLeg, LeftLeg, LeftFoot, neck|Neck], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig. @http://127.0.0.1:8790/games/last-circle/ru`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle3.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[error] Failed to load resource: net::ERR_CONNECTION_REFUSED @http://127.0.0.1:8790/games/last-circle/assets/chars/meshy/athlete_cheer.glb:0`
- endgame: 0 console errors, 354 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- again_load: 0 console errors, 2070 warnings
    - `[warning] [rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR] @http://127.0.0.1:8790/games/last-circle/runtime/3d/royale/rig_pipeline.js?v=1789530264:177`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle3.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- land_ff: 0 console errors, 12 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- menu: 2 console errors, 0 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
- ground: 0 console errors, 30 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- pageerrors: 0
- window error/unhandledrejection (init-script listener): 0
- failed requests: 6
    - ashgrid r1 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/audio/sfx/step_wood_001.ogg net::ERR_CONNECTION_REFUSED
    - isla_viva r2 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/chars/meshy/athlete_cheer.glb net::ERR_CONNECTION_REFUSED
    - isla_viva r2 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/chars/meshy/athlete_jump.glb net::ERR_CONNECTION_REFUSED
    - isla_viva r2 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/chars/meshy/wraith_crouch.glb net::ERR_CONNECTION_REFUSED
    - isla_viva r2 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/chars/meshy/wraith_rifle_idle.glb net::ERR_CONNECTION_REFUSED
    - isla_viva r2 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/audio/sfx/step_wood_002.ogg net::ERR_CONNECTION_REFUSED
- probe notes: 0

### Contamination

- isla_viva r1: other automated Chromes at start = 11; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 455.6 s
- ashgrid r1: other automated Chromes at start = 10; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 610.7 s
- deepwood r1: other automated Chromes at start = 12; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 722.3 s
- ashgrid r2: other automated Chromes at start = 12; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 444.2 s
- deepwood r2: other automated Chromes at start = 11; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 770.0 s
- isla_viva r2: other automated Chromes at start = 15; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 673.5 s
- deepwood r3: other automated Chromes at start = 13; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 434.0 s
- isla_viva r3: other automated Chromes at start = 10; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 306.0 s
- ashgrid r3: other automated Chromes at start = 9; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 176.9 s
