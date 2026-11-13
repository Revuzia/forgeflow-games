# Last Circle — live-measure lane (empirical baseline)

Status: COMPLETE 2026-09-30 02:10 local. READ-ONLY: no repo file was modified. Everything below was measured this
session in real headless Chrome against http://127.0.0.1:8790/games/last-circle/index.html (the working copy,
INCLUDING the other session's uncommitted `index.html` ?v= bump and `ffg_kernel_3d.js` PORTRAIT CAMERA FIT edit).
Maps (verified): `runtime/3d/royale/hud.js:124  export const BATTLE_MAPS = ["isla_viva", "ashgrid", "deepwood"];`

## Summary (plain English)
1. **Zero page errors.** 9 full matches (3 maps x 3 interleaved repeats) played from boot to the post-match panel
   with 49 eliminations each (all 9 reached `W.match.over`), the local player dying and spectating (death seen
   in 7 of 9 traces), then PLAY AGAIN into a second match, plus a
   3-match back-to-back leak run: 0 `pageerror`, 0 window `error`, 0 unhandled rejections. Console errors were only
   the static server's `favicon.ico` 404 and 6 `ERR_CONNECTION_REFUSED` from the shared static server under load.
2. **A real GPU texture leak across matches.** Same map, same seed, three back-to-back matches through
   `startMatch` (the PLAY AGAIN path): `renderer.info.memory.textures` at the lobby went **44 -> 86 -> 177**, and at
   match end **97 -> 152 -> 219**. Mixers (51) and kernel updaters (8) stayed flat, so actor/updater disposal works;
   textures do not.
3. **The drop is the heaviest view, and the shadow pass is why.** During the glide the whole frame is 4.5-11.0 M
   triangles (median per map) and the shadow depth pass is **60-80 %** of them (ashgrid 8.74 M of 10.96 M).
4. **Match start is not warmed.** Programs keep compiling after the loading screen (72-80 at lobby -> 78-87 by
   endgame) and textures keep uploading in the first drop frames; the lobby does not answer an Enter press for a
   median **4.3-9.2 s** after it appears. Load itself took 14-151 s on this saturated box; roughly as much time goes to the 50 characters
   (cloned one `await` at a time) as to building the map.
5. **Frame pacing numbers are box-contaminated and must be read against the control.** The box was at 100 % CPU with
   9-15 other automated Chromes; the vsync'd Intel path could not render at all (a blank WebGL page got 4-6 frames in
   5 s), so every number is on the NVIDIA dGPU, uncapped. Ground-level play: frame p50 21-45 ms, CPU frame p50
   20-37 ms, draw calls 232-268 median (max 481 in one endgame), p99 dominated by 0.5-11 s render stalls that a
   discriminating test showed are NOT caused by the harness's fastForward (they occur at the same size in free-running
   frames) and that a blank page on this box also shows at up to ~1.4 s.

## Re-run verbatim after fixes
```
cd C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/audit/scratch
python -u lc_liveprobe.py --reps 3 --label after                 # 3 maps x 3 interleaved; 3-13 min per run on this box
python lc_liveprobe_table.py "_reports/lc_liveprobe_after_*.json"
python lc_liveprobe_table.py "_reports/lc_liveprobe_base_*.json"  # THIS baseline (lc_liveprobe_base_20260930_003158.json)
python -u leaktest.py 3 ashgrid                                  # match-over-match textures/geometries/programs/heap
python -u stalltest.py 5 ashgrid                                 # FREE vs BUSY vs FF stall discriminator + scene census
python rafcontrol.py --extra=--force_high_performance_gpu --extra=--disable-gpu-vsync --extra=--disable-frame-rate-limit   # box control alone
```
Files (all in `.../scratchpad/lc_improve/audit/scratch/`): `lc_liveprobe.py` (the probe), `lc_liveprobe_table.py`
(tables), `leaktest.py`, `stalltest.py`, `rafcontrol.py`; raw JSON + failure screenshots in `_reports/`.
The static server on 8790 must be running (the probe never starts one). If promoted into the repo, the natural home
is `games/last-circle/_harness/perfcheck.py` (+ `leaktest.py`), mirroring `games/dyefield/_harness/perfcheck.py`.

## Method
Per run (fresh browser context = cold HTTP cache; map order rotated per repeat so box noise spreads over all maps):
box control (blank WebGL2 clear page, 4 s) -> cold boot -> warm boot (new page, same context) -> menu window 5 s ->
`__LC__.startMatch({mode:'standard', mapId, seed})` with a 25 ms page-side load timeline -> REAL Enter keypress (the
hud.js `finishLobby` skip) -> drop window 10 s (real rAF) -> `fastForward` until the local player has landed ->
ground window 20 s (real rAF) -> endgame: `fastForward(10 s)` alternated with 1 s of real frames until `W.match.over`
(the rAF delta spanning each fastForward is dropped) -> post-match panel -> REAL click on PLAY AGAIN (falls back to a
DOM click, flagged, if Playwright's click times out) -> again_drop window 5 s on the second match.
Instrumentation is instance-level wrapping only:
- `renderer.info.autoReset=false`, reset at the top of each kernel loop (wrap of `kernel._stepTweens`). Needed because
  the kernel renders through EffectComposer — `ffg_kernel_3d.js:491  if (this.composer) this.composer.render(dt); else this.renderer.render(this.scene, this.camera);`
  — so the default autoReset only ever reports the OutputPass quad. "draw calls" = WHOLE frame; "(shadow / scene)" =
  `renderer.shadowMap.render` alone / the RenderPass (which INCLUDES the shadow pass); the remaining ~14 are bloom +
  output.
- CPU frame = update (tweens + mixers + every `onUpdate`, i.e. the whole game step) + render submission
  (`composer.render`). Per-frame programs/textures/geometries so each >50 ms frame is attributed to "something new was
  created" or "nothing new" (= driver / GPU backpressure).
- Long tasks, paint timing, resource timing, JS heap (`--enable-precise-memory-info`), console errors/warnings,
  pageerror, window error + unhandledrejection, failed requests — all tagged by stage.
- Launch profile `dgpu-uncapped`: DYEFIELD's flag set (`dyefield/_harness/common.py` FLAGS: `--use-angle=d3d11`,
  `--disable-background-timer-throttling`, ...) + `--force_high_performance_gpu --disable-gpu-vsync
  --disable-frame-rate-limit`; 1600x900 (DYEFIELD perfcheck's size), DPR 1, stored tier "medium"
  (`ffg_royale3d.js:650 ... graphics: "medium" ...`), shadows on, bloom on. GL string every run:
  `ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11)`.

### Why the NVIDIA uncapped profile (verified with a control, not assumed)
`rafcontrol.py` (blank page, one WebGL2 clear per rAF, 5 s), same moment, same flags otherwise:
| config | frames in 5 s | rAF p50 / max ms | adapter |
|---|---|---|---|
| Intel d3d11, vsync (DYEFIELD perfcheck flags) | 4 | 20 / 2740 | Intel UHD |
| NVIDIA `--force_high_performance_gpu`, vsync | 6 | 20 / 4280 | RTX A2000 |
| Intel d3d11, uncapped | CRASH x2, verbatim: `Exception: Page.evaluate: Connection closed while reading from the driver` | - | - |
| SwiftShader (CPU), vsync | 253 | 20 / 20 | SwiftShader |
| NVIDIA, uncapped | 1257 and 2206 (two runs) | 0.3-0.5 / 877-1273 | RTX A2000 |
GPU 3D-engine share at the time (`Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage'`): dwm 52.5 %,
WUDFHost (DisplayLink host) 42.8 %, each chrome <= 1.2 %. `Win32_Processor.LoadPercentage` = 100.
With DYEFIELD's own flag set, a first Last Circle smoke run recorded **0 rAF frames** in every window and
`startMatch()` took 347 394 ms — a BOX fact (the blank page is starved the same way), not a game fact.
Consequence: these are raw per-frame costs on a discrete RTX A2000 with no vsync. They are the right yardstick for
before/after on this box; they are NOT what a player on an Intel iGPU laptop sees, and must not be compared to a
16.7 ms vsync budget as if they were. Not measured: DPR > 1 (viewport DPR was 1, so the tier's DPR cap never engaged),
the "low"/"high" tiers, and any Intel-iGPU vsync number (impossible on this box today).

## Headline numbers (median [min-max] over 3 repeats; full tables further down)
| view | map | frame p50 ms | frame p99 ms | CPU frame p50 (update / render-submit) ms | draw calls median (shadow) | triangles (shadow share) | programs | textures | heap MB |
|---|---|---|---|---|---|---|---|---|---|
| menu | all | 8.7-16.1 | 444-1763 | 5.6-8.7 (0.2 / 5.3-7.8) | 283-296 (61) | 92-93 k (47 %) | 19 | 16 | 18-34 |
| drop | isla_viva | 18.8 [14.1-24.0] | 808 [39-6375] | 16.7 (3.3 / 12.7) | 183 (39) | 4.50 M (60 %) | 83 | 55 | 150 |
| drop | ashgrid | 29.1 [10.7-29.9] | 715 [319-3283] | 23.9 (4.4 / 18.6) | 257 (86) | 10.96 M (80 %) | 76 | 76 | 166 |
| drop | deepwood | 25.1 [17.3-27.6] | 39 [32-220] | 20.6 (4.0 / 14.7) | 118 (60) | 7.96 M (74 %) | 77 | 64 | 150 |
| ground | isla_viva | 27.4 [21.5-39.1] | 2730 [1068-7156] | 26.1 (9.5 / 15.9) | 248 (64) | 8.06 M (30 %) | 86 | 96 | 154 |
| ground | ashgrid | 21.2 [9.7-27.0] | 1095 [57-2834] | 19.9 (5.8 / 13.8) | 268 (77) | 8.16 M (11 %) | 78 | 96 | 163 |
| ground | deepwood | 45.2 [40.1-45.6] | 1374 [271-4656] | 36.8 (13.3 / 22.2) | 232 (51) | 6.15 M (14 %) | 82 | 104 | 150 |
| endgame (real frames) | all | 16.6-23.9 | 469-602 | 14.4-19.6 | 197-254, per-run max 337-481 | 3.8-5.3 M | 78-87 | 118-138 | 147-168 |
| box control | all | 0.3-0.5 | 1.7-3.5 | - | - | - | - | - | - |
Design targets from the owner-approved template: p99 <= 22 ms, <= 450 draw calls (BLOCKTOOTH
`src/core/config.ts:989-995  export const BUDGET = { fpsMin: 55, drawCallsMax: 450, simTickMsMax: 4, dprMax: 1.5, shadowMap: 1024, ...`).
Draw calls are inside budget at the median everywhere; 2 of 9 endgames peaked above 450 (per-run max 480 and 481; a third reached 446).

Boot / load (ms or s, median [min-max], 9 runs; the local static server — not the CDN — was the slow leg:
last local byte 24.5 s vs last jsdelivr byte 3.0 s cold):
| | cold | warm |
|---|---|---|
| first paint | 12 656 ms [2 100-39 804] | 2 216 ms [408-12 292] |
| menu built (`window.__LC__` assigned) | 19 177 ms [8 454-40 265] | 4 726 ms [573-36 678] |
| splash removed | 30 644 ms [11 855-42 500] | 10 043 ms [998-53 277] |
| longest single long task | 7 805 ms [2 447-19 840] | 2 303 ms [606-43 469] |
| console errors / warnings | 1 / 0 per boot (favicon 404) | 0-1 / 0 |

| map | startMatch -> lobby shown | of which: map built at | 50 rigs at | Enter -> drop | PLAY AGAIN -> lobby |
|---|---|---|---|---|---|
| isla_viva | 61.6 s [36.4-125.0] | 39.8 s | 61.5 s | 9.2 s [5.6-12.9] | 67.6 s [10.9-81.7] |
| ashgrid | 97.4 s [13.8-150.7] | 55.9 s [4.1-90.9] | 97.3 s | 5.1 s [4.1-25.3] | 37.1 s [4.8-49.7] |
| deepwood | 83.4 s [41.6-112.4] | 27.9 s | 83.2 s | 4.3 s [4.1-15.2] | 53.3 s [45.3-61.3] |
(The code's own comments measured the warm map build at ~1.9 s — `maps.js:356  The match build blocks the main thread for ~1,934 ms warm` —
so this box is 5-40x slower than a quiet one; compare only against a re-run under similar load, which the probe records.)

## Discriminating tests
### 1. Are the multi-second render stalls a harness artefact? (`stalltest.py 5 ashgrid`) — NO
Arms interleaved 5x after landing: FREE (python sleeps, frames flow), BUSY (JS busy-wait as long as the last
fastForward), FF (`fastForward(10 s)`). composer.render ms of the first 3 frames after, and the 2 s window max:
- FREE: first frame 11-58 ms; window max 23.7 / 1626.6 / 2843.1 / 1115.1 / 3338.3 ms
- BUSY: first frame 10-21 ms; window max 1106.6 / 818 / 2535.6 / 827.4 / 1758.5 ms
- FF: first frame 8-32 ms (one 4147 ms third frame); window max 534.6 / 1286.1 / 4147 / 2836.2 / 1356.6 ms
Stalls of 1-4 s occur with no preceding block at all, at the same size. So the endgame's 9-28 s stall frames and the
ground windows' p99 are real-time rendering stalls, not the probe. Whether the game's GPU load or the saturated box
causes them cannot be separated here (the blank control page also stalls, up to 1 387 ms). Of the 189 listed >50 ms
frames in drop/ground/endgame/again_drop (up to 8 worst per window per run), only 10 had a new program, texture or
geometry that frame, so shader/texture creation is not the main stall source; GPU backpressure is.

### 2. Match-over-match resources (`leaktest.py 3 ashgrid`, seed 4242, same map, startMatch = the PLAY AGAIN path)
| point | programs | geometries | textures | JS heap MB | mixers | kernel updaters | load s |
|---|---|---|---|---|---|---|---|
| m1 lobby | 71 | 316 | 44 | 137.7 | 51 | 8 | 45.1 |
| m1 end | 78 | 448 | 97 | 151.4 | 51 | 8 | |
| m2 lobby | 78 | 323 | **86** | 194.4 | 51 | 8 | 16.8 |
| m2 end | 80 | 493 | 152 | 156.1 | 51 | 8 | |
| m3 lobby | 81 | 409 | **177** | 197.0 | 51 | 8 | 32.1 |
| m3 end | 81 | 503 | **219** | 146.2 | 51 | 8 | |
Textures grow every match at the same point (not a one-time cache step). 0 page errors across the 3 matches.
The 9-run battery agrees: second-match drop textures vs the same map's first-match drop: deepwood 61 -> 172 and
64 -> 168, ashgrid 69 -> 144 and 77 -> 132.
Scene census (`stalltest.py`) over one ashgrid match, landing -> 2 alive: loot group visible meshes 110 -> 197,
sprites 66 -> 93, distinct textures referenced by loot 12 -> 34; renderer textures 92 -> 131 while textures referenced
by ANY visible object went only 46 -> 59 (~72 resident textures are referenced by nothing visible at match end).

### 3. PLAY AGAIN clickability
Playwright's real click timed out in 6 of 9 runs, verbatim:
`REAL CLICK FAILED: Locator.click: Timeout 15000ms exceeded. ... - waiting for element to be visible, enabled and stable`.
In 9 of 9 runs `document.elementFromPoint` at the button centre returned the button itself
(`'top': 'BUTTON.lc-btn-play "PLAY AGAIN"', 'isButtonOrChild': True`), and the screenshot
(`_reports/again_click_fail_isla_viva_r1_003815.png`) shows a correct MATCH OVER panel. Playwright's "stable" check
needs consecutive animation frames, which the render stalls starve — a harness artefact, not a hit-test defect.

## Gaps, ranked by what a player would notice
(Each fix names its files so lanes can be made file-disjoint. "Verify" names the observable check.)

### G1 — GPU textures leak on every PLAY AGAIN (player impact: HIGH for multi-match sessions)
Evidence: leaktest table above (textures 44 -> 86 -> 177 at the lobby). The teardown disposes mixers, nametags, map
and loot resources — `ffg_royale3d.js:345-356` (`for (const a of W.actors) { if (a.rig && a.rig.mixer && kernel.disposeMixer) kernel.disposeMixer(a.rig.mixer); ...`,
`W._lastMapDispose = disposeMapResources(W);`, `W._lastLootDispose = lootMod.disposeLootResources ? lootMod.disposeLootResources(W) : null;`)
— yet renderer textures still climb ~40-90 per match. Byte size per texture was not measured, so GPU MB/match is
unknown. Candidates to check first (texture producers during a match): loot drops (`loot.js:314  const m = proto.clone();`,
`loot.js:416 ... o.material = o.material.clone(); ...`, loot textures 12 -> 34 in the census), weapon equips
(`weapons.js:247  a.weaponMesh = proto.clone();`), nametags (`player.js:554  const tex = new THREE.CanvasTexture(cv);`),
fx (`fx.js:129`, `fx.js:155`).
Reference: BLOCKTOOTH tracks exactly this per frame — `src/render/frameprof.ts:5-6 ... renderer.info deltas (programs / geometries / textures)`.
Fix: find the producer with a per-group texture census at each lobby, dispose it in `_startMatch`.
Files: `runtime/3d/ffg_royale3d.js` (_startMatch teardown) plus whichever of `runtime/3d/royale/loot.js`,
`weapons.js`, `player.js`, `fx.js` owns the leaked textures. Effort M.
Verify (real browser): `python -u leaktest.py 3 ashgrid` -> textures at m2_lobby and m3_lobby within +-5 of m1_lobby.

### G2 — The drop renders 4.5-11 M triangles, 60-80 % of them in the shadow pass (impact: HIGH on iGPU laptops)
Evidence: drop shadow share isla 2.72 M / 4.50 M, deepwood 5.90 M / 7.96 M, ashgrid 8.74 M / 10.96 M (vs 11-30 % on the
ground). Cause in code: `ffg_royale3d.js:282  const wantExt = Math.min(620, ext + (agl > 40 ? (agl - 40) * 2.4 : 0));`
widens the sun's ortho box up to +-620 m at altitude, and every map caster sits inside it
(`maps.js:1859  mesh.castShadow = true; mesh.receiveShadow = true;`, `maps.js:1993  im.castShadow = true; ...`);
the tier map is 2048/4096 (`ffg_royale3d.js:154  const SHADOW = { low: 0, medium: 2048, high: 4096 };`).
Reference: BLOCKTOOTH `src/core/config.ts:994  shadowMap: 1024,  // doctrine §3: 1024, fit the frustum tightly instead`.
Fix: cap the altitude widening (or drop foliage/instanced casters from the shadow pass above N m AGL, or refresh the
shadow map every Nth frame while gliding). Files: `runtime/3d/ffg_royale3d.js` (followShadow), `runtime/3d/royale/maps.js`
(caster flags). Effort S-M.
Verify (real browser): `lc_liveprobe.py` drop window: shadow triangles < 30 % of the frame and drop frame p50 down vs
this baseline; plus a drop screenshot to confirm the world below still reads as shadowed.

### G3 — Match start is not warmed: programs compile and textures upload after the lobby (impact: HIGH, first 30 s)
Evidence: programs at lobby shown 72-80 -> drop 75-84 -> ground 77-86 -> endgame 78-87 (4-9 programs link during
play); drop windows contained frames with new programs/textures (worst: 3 089.5 ms with dProg 1 / dTex 2 / dGeo 1);
after the lobby appears the page ignores Enter for a median 4.3-9.2 s (max 25.3 s) — the lobby countdown is
setInterval-driven and freezes with it. Warmup today is compile-only:
`ffg_royale3d.js:444  if (kernel.renderer.compileAsync) await kernel.renderer.compileAsync(W.scene, W.camera);`
plus `fx.js:445  W.kernel.renderer.compile(W.scene, W.kernel.camera);`.
Reference: BLOCKTOOTH `src/render/warmup.ts:4-14` — force everything visible (empty InstancedMesh count >= 1,
frustumCulled off), compileAsync with an RT bound then RENDER one frame into it ("links the shadow-depth variants of
every caster and uploads every texture/geometry/instance buffer"), compileAsync again for the canvas and draw one
canvas frame ("ANGLE finishes a program's link on its first real draw, not at compile"), then restore.
Fix: port that warmup into `_startMatch` before `showLobby`, including loot/weapon protos and death FX.
Files: new `runtime/3d/royale/warmup.js`, `runtime/3d/ffg_royale3d.js`. Effort M.
Verify (real browser): `lc_liveprobe.py` -> programs at "resolved" == programs at endgame, framesWithNewPrograms = 0
in drop/ground/endgame, "Enter -> drop" < 0.5 s.

### G4 — Loading freezes: sequential character clones, and both loading bars animate main-thread properties (impact: MEDIUM)
Evidence: load timeline — main thread first free after 1.4-24.5 s; map built at 27.9-55.9 s, 50 rigs at 61.5-97.3 s
(medians per map), i.e. the character phase alone is ~22-55 s of it, the same order as the map build. `player.js:296-299  for (let i = 0; i < W.actors.length; i++) { ... const rig = await W.kernel.loadCharacter(url);`
(one await per actor, 50 in series). The boot splash bar animates `width`
(`index.html:11  @keyframes lcBootBar{0%{width:8%}35%{width:52%}75%{width:78%}100%{width:92%}}`) and the match
loading bar animates width + background-position (`hud.js:1104  transition: "width .4s", animation: "lcShimmer 1.6s linear infinite"`);
neither runs on the compositor, so both freeze through the measured long tasks (cold boot longest task median 7.8 s).
Fix: batch/parallelise the clones with a yield per batch; animate the bars with `transform: scaleX()` /
`translateX()` only. Files: `runtime/3d/royale/player.js` (loadActorModels), `runtime/3d/royale/hud.js` (showLoading),
`index.html` (splash CSS — note another session has uncommitted edits in this file; build on them). Effort S-M.
Verify (real browser): `lc_liveprobe.py` load timeline (50-rigs minus map-built drops) and a screenshot sequence during a
boot long task showing the bar still moving.

### G5 — No perf instrumentation or perf harness in the repo (impact: none directly; blocks proving every other fix)
Evidence: `ls games/last-circle/_harness` -> `botcheck.py botdiag.py bridge_host.html stuckdiag.py`;
`grep -rn "performance.mark\|frameprof\|ResizeObserver\|DynRes\|info.autoReset" runtime index.html game_controls.js`
-> no hits (only `compileAsync` lines matched the wider pattern). The only in-game readout is an FPS number
(`hud.js:2001  if (R.perf && W.settings && W.settings.showPerf) {`).
Reference: DYEFIELD `_harness/perfcheck.py:1-28` (stand/walk/fire windows, draw calls, GPU-share contamination check),
`_harness/bootguard.py`; BLOCKTOOTH `src/render/frameprof.ts:1-10` (per-section ms, renderer.info deltas, worst-50).
Fix: promote `lc_liveprobe.py` + `leaktest.py` into `games/last-circle/_harness/` and add `?prof=1` section marks in
the frame pipeline (`ffg_royale3d.js:557-609`: bots / player / weapons / loot / storm / fx / hud / audio / net).
Files: `games/last-circle/_harness/perfcheck.py` (new), `_harness/leaktest.py` (new), `runtime/3d/ffg_royale3d.js`.
Effort S. Verify: the harness prints the tables above; `?prof=1` absent = zero added cost.

### G6 — Endgame draw calls climb with dropped loot (impact: MEDIUM late-match on iGPU)
Evidence: endgame per-run max draw calls 337-481 (480 and 481 in two runs, 446 in a third; budget 450) vs ground medians
232-268; census: loot meshes 110 -> 197 and sprites 66 -> 93 over one match, each an individual Mesh/Sprite, culled
only by distance (`loot.js:663  const cull = W.lootCull || 150, cull2 = cull * cull;`).
Reference: BLOCKTOOTH `config.ts:991  drawCallsMax: 450`.
Fix: instance dropped loot per kind (InstancedMesh + per-instance colour) or merge by cell. Files: `runtime/3d/royale/loot.js`.
Effort M. Verify: `lc_liveprobe.py` endgame calls max <= 450 in all 9 runs.

### G7 — ~235 console warnings per match load (impact: LOW for players; HIGH for harness signal)
Evidence (verbatim, every load): `[rig] soldier FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, ...], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig.`
(`rig_pipeline.js:88`), `[rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR]`
(`rig_pipeline.js:177`), and `THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion.`
Totals: 2 119 warnings in 9 loads, 2 070 in 9 PLAY AGAIN loads, 354 in endgames. The contract lists bare names
(`rig_pipeline.js:36-37  required: [ "Hips", "Spine02", "Spine01", "Spine", "Head",`) while the loaded rigs are
`mixamorig`-prefixed, so the validator fails them all; whether pose.js really misbehaves is for the rig lane.
Fix: normalise the `mixamorig` prefix in `inspectRig`/attach checks; drop clip tracks for bones the rig lacks at load.
Files: `runtime/3d/royale/rig_pipeline.js`, clip binding in `runtime/3d/royale/player.js`. Effort S.
Verify: `lc_liveprobe.py` load-stage warnings ~0.

### G8 — Frame pacing on the ground is above target even on the dGPU (impact: UNKNOWN until a quiet-box run)
Evidence: ground frame p50 21.2-45.2 ms, CPU frame p50 19.9-36.8 ms (update 5.8-13.3 + render submission 13.8-22.2),
> 33 ms frames 18-78 %; deepwood is the slowest map. All under 100 % box CPU (recorded per window). BLOCKTOOTH's
budget for the sim tick alone is `simTickMsMax: 4` (config.ts:992); LC's update number includes all view updates, so it
is not a like-for-like comparison. No fix proposed from this lane: G2/G3/G6 and the frameprof in G5 come first, then
re-measure on a quiet box before attributing the rest.

## Failures and skips (verbatim)
- Warm-boot via `page.reload` (smoke run 1): `PROBE EXCEPTION at stage boot_warm: Page.reload: Timeout 120000ms exceeded.` — replaced by a new page in the same context.
- Intel uncapped control: `Exception: Page.evaluate: Connection closed while reading from the driver` (2 of 2).
- Intel vsync (DYEFIELD flags) LC run: 0 rAF frames in every window; `startMatch()` 347 394 ms.
- First battery attempt, run 1: `PROBE EXCEPTION at stage again_load: Locator.click: Timeout 5000ms exceeded.` — probe stopped, fixed (diagnostics + DOM-click fallback), battery restarted; that run is kept separately as `_reports/lc_liveprobe_partial1_20260930_002217.json` and is not in the tables.
- `ERR_CONNECTION_REFUSED` from the shared 8790 static server (6 requests in 9 runs, e.g. `FAILED http://127.0.0.1:8790/games/last-circle/assets/chars/meshy/athlete_cheer.glb net::ERR_CONNECTION_REFUSED`); the files exist and `curl` returns 200 afterwards.
- Menu window: some runs recorded 0 or very few rAF frames in 5 s (same starvation symptom); medians use the runs that rendered.
- Skipped / not measured: DPR > 1, graphics tiers other than "medium", Intel-iGPU vsync frame times, headed Chrome (would steal focus from other sessions), GPU MB per leaked texture.

## Out-of-scope observation
The idle local player (no input) was eliminated 15-25 s after landing in 7 of 9 runs (died by t = 45-56 s; landed at
t = 27-31 s), finishing #50 of 50. Harmless for this lane (the ground window still sampled a live player), but a bot /
difficulty lane may want it.


## Full tables — FINAL baseline, 9 runs (3 maps x 3 interleaved repeats), 2026-09-30 00:32-01:54 local
Source: scratch/_reports/lc_liveprobe_base_20260930_003158.json via scratch/lc_liveprobe_table.py. Cells: median [min-max] over the 3 repeats of that map. again_drop rows are keyed by the FIRST match's map (PLAY AGAIN picks a random map).

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

## Appendix — how this lane got here (smoke history, kept for fidelity)

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

