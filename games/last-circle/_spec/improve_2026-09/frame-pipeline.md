# Last Circle — frame-pipeline audit (lane: frame-pipeline)

READ-ONLY audit, 2026-09-29. No repo file was modified. Scratch probes live in
`scratchpad/lc_improve/audit/scratch/` (frameprobe.py, rafcheck.py, framepump*.py + *_log.txt / *_out.json;
earlier working notes in scratch/frame-pipeline_worknotes.md).
Paths are relative to `forgeflow-games/games/last-circle/` unless prefixed `blocktooth/`.
Reference: `blocktooth/src/render/{renderer,frameprof,warmup}.ts`, `blocktooth/src/core/loop.ts`,
`blocktooth/src/game.ts` (DynRes), `blocktooth/src/core/config.ts` (BUDGET).

## Bottom line

Last Circle's frame pipeline is the pre-template kind: one rAF loop that feeds RAW frame dt (clamped
at 50 ms) straight into the whole sim, renders through an always-on bloom composer, and has no frame
profiler, no ResizeObserver, no DynRes and no budget constants. What a player feels, in order:
(1) **triangles** — the character models are 245k-632k triangles each with no LOD, so a ground-level match
frame submitted **16.5 M triangles, 81% of them 34 on-screen characters**, and the drop frame submitted
**9.9 M, 86% of them character SHADOWS too small to see**; this, not pixels, is why the game was measured
"not fill bound"; (2) the shader warm-up compiles the WRONG program variants, so the first drop frame
still compiles **27 programs** (3 of 3 runs); (3) gameplay depends on frame rate — the SMG fires
**600 rpm at 60 Hz instead of its designed 720** (measured through the real weapons.js update), jump height
varies, and below 20 fps the whole match runs in slow motion. Smaller but real: a forced layout every
drop frame, per-frame allocation, mixer "LOD" that saves no CPU, no DynRes, no voice cap. BLOCKTOOTH's
pieces port almost verbatim because Last Circle has one clean choke point (kernel loop + one `onUpdate`
closure); the triangle fixes are Last-Circle-specific and are the biggest win.

## Measurement conditions (read this before any number)

- Real rAF timing was NOT measurable on this box during the audit: `rafcheck.py` measured
  about:blank at **14.9 rAF/s headed, 0.4 rAF/s headless**; **8 automated Chromes** were alive (7
  belonging to other lanes, PowerShell process scan), all on one Intel UHD (0x9A60, ANGLE D3D11).
  `gl.finish()` blocked for up to **188 s** on one menu frame; a later run lost the WebGL context
  (`getProgramInfoLog(...)` returned null inside three's `onFirstUse`).
- So the probes STOP the kernel rAF loop and pump frames by hand (the exact body of
  `Kernel3D.start()`, ffg_kernel_3d.js:475-491, fixed dt 1/60). Counts (draw calls, triangles,
  programs, forced layouts, allocations, shots fired) are exact. Every millisecond figure is
  contaminated information only — per the owner's rule, perf is information, never a blocker.

## Item-by-item vs the approved FPS approach

| # | Approved item | Last Circle today | Verdict |
|---|---|---|---|
| 1 | Fixed-tick sim, interpolated view | Raw dt: ffg_kernel_3d.js:475 `const dt = Math.min(0.05, this.clock.getDelta());` -> ffg_royale3d.js:573 `let step = Math.min(dt, 0.05);` -> :587-601 every module `update(W, step)`. grep `SIM_DT\|fixedStep\|accumulator\|FIXED_DT\|fixed tick` over runtime/ index.html game_controls.js: 2 hits, both unrelated (player.js:1306 footstep accumulator, weapons.js:544 recoil). No interpolation (the 12 `alpha` hits are canvas/material alpha). | MISSING |
| 2 | DPR = min(device, quality, budget max) + DynRes | ffg_kernel_3d.js:80 `setPixelRatio(Math.min(window.devicePixelRatio \|\| 1, QDPR[_q] \|\| 1.5))`; ffg_royale3d.js:153 `const DPR = { low: 1, medium: 1.5, high: 2 };` and :171 `r.setPixelRatio(Math.min(window.devicePixelRatio \|\| 1, DPR[tier] \|\| 1.5));`. No budget max (high = 2.0 vs BLOCKTOOTH `dprMax: 1.5`, blocktooth/src/core/config.ts:993). grep `DynRes\|dynres\|renderScale\|rscale`: 0 hits. | PARTIAL |
| 3 | Per-view frameprof marks + ms budgets | grep `performance\.mark\|frameprof\|FrameProf\|prof=1`: 0; `info\.autoReset`: 0; `EXT_disjoint_timer_query`: 0 (the extension IS available on this box). Only instrument: hud.js:2001-2013, a 0.5 s-averaged FPS text behind settings.showPerf. | MISSING |
| 4 | p99 <= 22 ms, <= 450 draws | Menu: 287-293 draws, 92.5k tris. First drop frame: 360-367 draws, **9,908,496 tris**. Match frame (42 alive, ground): **440-446 draws, 16,478,983 tris**. CPU-only pumped frames alone: match p99 32.3 ms (contaminated). Real rAF timing not measurable (above). | DRAWS at the limit / TRIS far over |
| 5 | No per-frame allocation | Measured **554.5 KB allocated per match frame**; queryColliders (array + Set + string keys per call) called **423x per frame**; top site the projectile sub-step collision (weapons.js:663). See G6. | FAILS |
| 6 | Instanced GPU-animated crowds | 50 individual SkinnedMesh + 50 AnimationMixers ticked every frame (ffg_kernel_3d.js:489). "Animation LOD" sets timeScale 0 (player.js:1416), which three r172 still fully evaluates (three.core.js:34229-34262). The 50 are players, so per-actor rigs are legitimate; the gap is the missing LOD, not the missing instancing. | PARTIAL |
| 7 | Canvas size cached by ResizeObserver, no per-frame layout read | grep `ResizeObserver`: 0. Per-frame reads: fx.js:564, hud.js:2367 (after hud's own style writes), hud.js:2260; per mousemove: player.js:840. | FAILS |
| 8 | Shader warm-up before play | ffg_royale3d.js:444 compileAsync + fx.js:445 compile — both compile the CANVAS variant; every scene draw goes to the composer RT. Measured: warm-up 19->46 programs, then **+27 more compiled on the first rendered drop frame**. | BROKEN (wrong variant) |
| 9 | fx/sfx budgets | fx: particle ring N=1024 (fx.js:12), decals 64 (fx.js:106), blasts pooled, hud indicators capped at 14 (hud.js:2339) — fine. sfx: no concurrent-voice cap; only an impact throttle (audio.js:701 `if (!ctx || ctx.currentTime - lastImpactT < 0.035) return;`). Every audible gunshot builds BufferSource + Gain (+ Biquad) (audio.js:161-179) + an HRTF PannerNode (audio.js:412-413 `const p = ctx.createPanner(); p.panningModel = "HRTF";`). | PARTIAL |

Gap list (G1-G13) with fixes, files and verification, then the port plan, then the full DATA section, follow
the notes below.

### Notes gathered during the audit (kept for their evidence; the DATA section supersedes any number here)
- Weapon cadence vs frame rate, COMPUTED with a Node mirror of weapons.js:379 `wpn.cd -= dt;`,
  :423 `if (wantFire && wpn.cd <= 0 ...)`, :435 `wpn.cd = 60 / def.rpm;` (held trigger, 10 s):
  SMG (design 720 rpm, sim/royale.js:61): 165 Hz 708 · 144 Hz 720 · 120 Hz 660 · 75 Hz 648 ·
  **60 Hz 600** · 50 Hz 606 · 30 Hz 606 · 20 Hz 600 · 60 Hz with +/-0.5 ms jitter 666.
  AR (design 330, sim/royale.js:62): 165 Hz 336 · 144 Hz 324 · 60 Hz 330 · 30 Hz 306 · 20 Hz 300.
  => on the most common monitor (60 Hz) the SMG fires 17% under its designed rate; bots are hit too.
  CONFIRMED in the page through the real weapons.js update (framepump6.py CADENCE): identical numbers.
- Jump apex vs frame rate, COMPUTED with the game's integrator (player.js:1248 `a.vel.y += K.MOVE.gravity * dt;`,
  :1284 `a.pos.y += a.vel.y * dt;`, jumpV 7.8 / gravity -22 from sim/royale.js:117):
  165 Hz 1.359 m · 144 Hz 1.356 m · 60 Hz 1.318 m · 30 Hz 1.256 m · 20 Hz 1.190 m.
  With STEP_UP 0.55 (player.js:908) the tallest box a JUMP clears is ~1.91 m at 144 Hz vs ~1.74 m at 20 Hz
  (humans also have the mantle, player.js:1266, so this bites bots hardest).
- CROSS-LANE (mobile): the in-flight, uncommitted PORTRAIT CAMERA FIT in ffg_kernel_3d.js (git diff: +91 lines;
  applyCameraFit at :211-234, called only from _resize :195, boot3d :514 and start :472) is overwritten EVERY
  FRAME by the game: menu hud.js:485-486 `W.camera.fov = 42; W.camera.updateProjectionMatrix();` inside
  updateMenuWorld (per frame), match player.js:1905-1906 `cam.fov = W._fovBase + ...; cam.updateProjectionMatrix();`
  inside updateCamera (per frame). So in Last Circle the widened portrait fov survives at most one frame after a
  resize. Code trace only (browser unusable at the time). Minimal fix: call `this.applyCameraFit()` in the kernel
  loop after the updaters and before render (ffg_kernel_3d.js:490-491) — its adopt-if-changed check (:214) then
  treats the game's per-frame fov as authored and widens it. Build on the other session's edit; do not revert it.
- CHARACTER TRIANGLE BUDGET (verified by parsing the glTF JSON chunk of the runtime-loaded files,
  player.js:215 `const url = W.assetBase + "assets/chars/meshy/" + key + ".glb";`):
  soldier 409,150 tris / 214,760 verts / 52 joints · athlete 245,730 / 34 joints · wraith 281,438 ·
  juggernaut 632,456 · viper 331,176 — ONE skinned mesh each, no LOD. 50 actors ~ 19 M skinned triangles per
  pass before culling, and the sun shadow pass draws them again (maps/characters cast shadows:
  ffg_kernel_3d.js:374/397 `o.castShadow = true`). Measured first drop frame: 9,908,480 triangles.
  This, not fill, is why ffg_royale3d.js:157-160 found the frame "not fill bound" (64x36 cost the same as 720p).
- DRAW ATTRIBUTION (framepump5.py; renderBufferDirect wrapper, pass = shadow if scene===null, main if
  scene===W.scene, post otherwise; group = top-level W group; draws NO-OP'd on the GPU, counts exact).
  Reproduced twice: first drop frame 360-367 draws / 9,908,496 tris / +27 programs.
  First drop frame:   shadow:actors[skinned] 22 draws **8,573,580 tris (86.5%)** · main:map[inst] 33 / 717,904 ·
                      main:actors[skinned] 1 / 409,150 · main:map 122 / 162,611 · shadow:map 62 / 37,580 ·
                      main:loot 105 / 1,190 · main:storm 2 · main:fx[inst] 2 · post 14.
  Drop +4 s:          shadow:actors[skinned] 21 / 8,491,270 · main:actors[skinned] 2 / 654,880 · total 373 / 10,139,419.
  => During the drop the camera sees 1-2 characters, but the sun's shadow camera (altitude-adaptive extent up to
  620 m, ffg_royale3d.js:282 `const wantExt = Math.min(620, ext + (agl > 40 ? (agl - 40) * 2.4 : 0));`) sweeps in
  ~21 full-detail skinned characters and draws them into a 2048 map where one texel is ~0.6 m — their shadows are
  1-3 texels, i.e. invisible, for 8.5 M triangles per frame.
  Census at drop +4 s: 495 visible drawables (227 mesh, 50 skinned, 35 instanced, 181 sprites, 2 lines),
  129 shadow casters, 268 materials, 74 programs, 394 geometries, 74 textures, 50 mixers.
- FORCED LAYOUT (CDP Performance.getMetrics across 240 pumped drop frames that never yield to the browser,
  so every layout/style inside the window was forced by a JS read): **1.00 forced layout + 1.15 forced style
  recalcs per frame**, 0.294 ms layout + 0.061 ms style per frame (contaminated timing). Readers: fx.js:564,
  hud.js:2367 (hud.js:2260 only when loot is near). JS heap 34.2 -> 28.5 MB across the window (a GC ran).

---------------------------------------------------------------------------------------------------
## GAPS — ranked by what a player would notice

### G1 (HIGH, S) Characters cast full-detail shadows nobody can see — 86.5% of the drop frame's triangles
- Evidence: first drop frame `shadow:actors[skinned]` 22 draws / 8,573,580 of 9,908,496 tris (reproduced;
  +4 s: 8,491,270 of 10,139,419). Shadow extent widens toward 620 m in the glide (ffg_royale3d.js:282; ~560-620 m at the 240-270 m drop altitude quoted
  at ffg_royale3d.js:268-270, computed) -> ~0.55-0.6 m per texel on the 2048 medium map (ffg_royale3d.js:154 `SHADOW = { low: 0, medium: 2048, high: 4096 }`), so a
  character's shadow is 1-3 texels. Every GLB mesh is flagged caster at load (ffg_kernel_3d.js:397
  `if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }`).
- Fix: per-frame shadow LOD in the loop that already owns per-actor visibility (player.js:973-1004): the skin mesh
  casts only when within ~40-60 m of the camera AND the shadow extent is at its ground tier (W._shadowExt), never
  while the camera focus is > 40 m AGL. Optional: cheap capsule caster for mid range.
- Files: runtime/3d/royale/player.js (loop at :973-1004; cache the skin SkinnedMesh on the actor in loadActorModels).
- Reference: BLOCKTOOTH budgets one shadow light and fits the frustum tightly (blocktooth/src/core/config.ts:994
  `shadowMap: 1024, // doctrine §3: 1024, fit the frustum tightly instead`).
- Verify: framepump-style draw attribution — `shadow:actors[skinned]` tris in the first drop frame from ~8.5 M to
  < 0.5 M; screenshot at ground level shows the player's and a nearby enemy's shadow unchanged (real browser).

### G2 (HIGH, M) 245k-632k-triangle characters with no LOD — 81% of a ground-level match frame
- Evidence: skin GLBs (glTF JSON parsed): soldier 409,150 tris / 214,760 verts, athlete 245,730, wraith 281,438,
  juggernaut 632,456, viper 331,176; one SkinnedMesh each (player.js:371-372 comment agrees: "meshes 1 | materials 1").
  Main pass drew 409,150 tris for ONE on-screen character (the player) in the first drop frame; 2 on screen = 654,880.
  MATCH frame (t 32.9 s, 42 alive, on the ground): `main:actors[skinned]` **34 draws / 13,380,760 of 16,478,983
  triangles (81%)** — 34 characters inside a 2,000 m far plane (ffg_kernel_3d.js:40 `new THREE.PerspectiveCamera(50, 1, 0.1, 2000)`),
  each at full ~394k-triangle detail (most must be far away on a 1,600 m map — inferred; per-actor distances were not recorded).
- Fix: offline decimated skins (e.g. LOD0 ~25k, LOD1 ~5k tris, same skeleton) loaded beside the full mesh, swapped
  by camera distance in the same per-actor loop as the weapon LOD (player.js:991). Asset-pipeline work + player.js.
- Files: assets/chars/meshy/*.glb (new *_lod0/_lod1 files), runtime/3d/royale/player.js (loadActorModels ~:215-465,
  per-frame loop :973-1004).
- Verify: attribution `main:actors[skinned]` tris per visible actor < 30k; side-by-side screenshots at 3 m / 30 m
  (real browser); frameprof GPU ms on the drop frame (information only).

### G3 (HIGH, S-M) Shader warm-up compiles the wrong program variants -> ~27 compiles on the first drop frame
- Evidence: ffg_royale3d.js:443-446 `await kernel.renderer.compileAsync(W.scene, W.camera)` and fx.js:445
  `W.kernel.renderer.compile(W.scene, W.kernel.camera)` compile with the canvas as target, but play renders through
  the composer (RenderPass -> RT, three r172 RenderPass.js:62) and r172 keys programs on the target
  (three.module.js:6904-6908 toneMapping only when `currentRenderTarget === null`; :6939 LinearSRGB output for an RT;
  :7157/:7200 both in the cache key). Measured 3x (runs 4/5/6): warm-up +27 programs (19 -> 46, 19 -> 46, 18 -> 45), then the first rendered drop
  frame +27 more (-> 73, 73, 72), and 2 more on the first sampled MATCH frame (72 -> 74, run 6). Also never warmed: shadow-depth variants (only link in a real shadow pass) and the chute
  (player.js:1344-1370 creates MeshStandardMaterial DoubleSide + LineBasicMaterial at deploy time).
- Fix: port blocktooth/src/render/warmup.ts as runtime/3d/ffg_warmup.js, adapted to the composer: force-visible +
  frustumCulled=false (warmup.ts:24-36), then run ONE real `kernel.composer.render()` under the loading screen
  (compiles RT variants, shadow-depth variants incl. skinned depth, bloom + output programs), then restore. Put one
  hidden warm chute in the actors group (or share module-level chute materials) so its programs are in the scene.
  Replace ffg_royale3d.js:421-446 and retire fx.prewarm (fx.js:417-449).
- Files: runtime/3d/ffg_warmup.js (new), runtime/3d/ffg_royale3d.js (:421-446), runtime/3d/royale/fx.js (:417-449),
  runtime/3d/royale/player.js (deployChute :1329-1374).
- Reference: blocktooth/src/render/warmup.ts:38-69 (RT compile + RT render, canvas compile + canvas draw, exact restore).
- Verify: the same pump probe shows newPrograms == 0 on the first rendered drop frame and on every sampled frame of
  drop + match (needs a real browser; Node never runs view code).

### G4 (HIGH, S for the symptom / L for the cure) Gameplay depends on frame rate (raw-dt sim, no fixed tick)
- Evidence: ffg_kernel_3d.js:475 `const dt = Math.min(0.05, this.clock.getDelta());` -> ffg_royale3d.js:573
  `let step = Math.min(dt, 0.05);` -> :587-601 all modules step with it. Consequences:
  * weapon cadence (weapons.js:379 `wpn.cd -= dt;` / :435 `wpn.cd = 60 / def.rpm;` drops the overshoot): SMG designed
    720 rpm fires 600 at 60 Hz, 660 at 120 Hz, 720 at 144 Hz (computed mirror; in-browser check in the data section);
  * jump apex 1.36 m at 144 Hz vs 1.26 m at 30 Hz vs 1.19 m at 20 Hz (game integrator, computed) — matters most for
    bots (the mantle at player.js:1266 is humans-only);
  * below 20 fps the whole match runs in slow motion (dt clamp 0.05) — storm, timers, bullets;
  * the test path is not the live path: fastForward steps a fixed 1/30 (ffg_royale3d.js:627) and skips fx/hud/audio/net,
    so every harness number describes a sim the player never runs.
- Fix, in two steps: (a) S, now: carry the overshoot — `wpn.cd += 60 / def.rpm` with a floor (clamp cd to >= -dt before
  the add) so cadence is exact at any frame rate. (b) L: port blocktooth/src/core/loop.ts (accumulator, SIM_DT,
  MAX_STEPS_PER_FRAME 5, drop-the-debt guard, frozen/resume priming, timeScale for hitstop) — tick = bots / stepActor /
  weapons / loot / storm / net at a fixed 1/60 (or the harness's 1/30), frame = syncObj with lerp(prevPos, pos, alpha) +
  camera (mouse yaw/pitch applied per FRAME, not per tick, so aim never quantises) + fx/hud/audio; fastForward calls
  the same tick function.
- Files: (a) runtime/3d/royale/weapons.js (:379, :435). (b) runtime/3d/ffg_royale3d.js (:557-609 pipeline, :626-635
  fastForward), runtime/3d/royale/player.js (split stepActor sim from syncObj/updateCamera view; prevPos per actor),
  runtime/3d/ffg_kernel_3d.js (loop hands raw dt to the genre).
- Reference: blocktooth/src/core/loop.ts:230-289; blocktooth/src/render/viewtypes.ts:55 `lerpPose`;
  blocktooth/src/render/projectileview.ts:752-754 alpha interpolation.
- Verify: (a) the CADENCE probe (real weapons.js update in the page) returns 720 +/- 6 rpm for the SMG at every frame
  rate 20-165 Hz; (b) a Node selftest that runs the same tick via the live loop and via fastForward and gets identical
  W.t / alive / positions for one seed; in-browser: no visible stutter at 144 Hz (real browser, real display).

### G5 (MEDIUM, S) Forced synchronous layout — every drop frame (1.00/frame), 0.15/frame in the match
- Evidence (measured): 1.00 forced layout + 1.15 forced style recalcs per frame across 240 no-yield pumped DROP frames; 0.15 + 0.77 per frame across 600 MATCH frames.
  Readers: fx.js:563-564 `rect = W.kernel.renderer.domElement; const w2 = rect.clientWidth, h2 = rect.clientHeight;`
  (every fx.update), hud.js:2367 `const wpx = W.kernel.renderer.domElement.clientWidth, hpx = ...clientHeight;`
  (stepIndicators, called every hud.update at hud.js:2235), hud.js:2260 `const sw = window.innerWidth, sh = window.innerHeight;`
  (per frame when loot is near), player.js:840 `const rect = dom.getBoundingClientRect();` (every mousemove).
  grep `ResizeObserver` over runtime/ index.html game_controls.js: 0 hits.
- Fix: port blocktooth/src/render/renderer.ts:105-124 into Kernel3D.mount: a ResizeObserver caches the container's CSS
  box, _resize runs from it (keep the in-flight applyCameraFit call and composer.setSize), kernel exposes viewW/viewH;
  fx/hud/player read those.
- Files: runtime/3d/ffg_kernel_3d.js (mount :164-188, _resize :190-198), runtime/3d/royale/fx.js (:563-564),
  runtime/3d/royale/hud.js (:2260, :2367), runtime/3d/royale/player.js (:840).
- Verify: the pump probe's CDP LayoutCount delta per frame drops from 1.00 to 0.00 (real browser).

### G6 (MEDIUM, M) Per-frame allocation in hot paths — 554.5 KB allocated per match frame (GC hitches)
- Measured (framepump7, total-allocation sampling, 600 match frames): **554.5 KB/frame (~33 MB/s at 60 fps)**;
  **W.map.queryColliders called 423 times per frame**; top allocator testSegment weapons.js:663 at 180.7 KB/frame (every
  projectile sub-step runs queryColliders + segmentColliders + a Math.hypot per actor, weapons.js:678-695), then three's
  animation Interpolant.evaluate 95.2 KB/frame (the 50 mixers, see G7), native Math.hypot 60.1, syncObj 20.3, Set 18.6.
- Static sites: maps.js:2141-2150 queryColliders allocates
  `const out = [];`, `const seen = new Set();` and string keys (maps.js:2131 `return cx + "," + cz;`) on EVERY call; it
  runs from supportAt (player.js:914) and blockedHoriz (player.js:936) ~3x per near actor per frame, and up to
  43x43 = 1,849 times per A* path (bots.js:675-679 cellBlocked -> obstacleAt bots.js:652). Others: fx.js:65
  `new THREE.Color` per particle spawn, fx.js:75 spawn({...}) per particle, fx.js:247 `dir: new THREE.Vector3(...)` per
  tracer; sim/royale.js:192-194 moveBasis returns a new object (player.js:1043, :1191 per actor per frame);
  player.js:1436-1488 playAnim(..., {timeScale}) literals + `fam + "_run"` strings per actor per frame;
  hud.js:2080-2081 Object.values(...).join / slots.map(...).join per frame; loot.js:741 Object.assign({}, ...) per frame;
  bots.js:686/701/702 typed arrays per findPath.
  Of the 59 `new THREE.Vector3`, only fx.js:247 (per tracer) and fx.js:403 (per damage number) run inside the match
  loop; the rest are module scratch, per-actor / per-particle construction, or load-time (classification in the appendix).
- Fix (in payoff order): (1) queryColliders -> reused result array + per-query stamp (no Set) + numeric cell key
  (e.g. (cx+32768)*65536+(cz+32768)); (2) testSegment -> broad-phase the actor loop with a squared-distance reject before
  any Math.hypot, one queryColliders per projectile per frame (whole swept segment) instead of per sub-step, and
  segmentBox/segmentRamp writing into a scratch hit record; (3) replace 2-3-arg Math.hypot in hot loops with
  Math.sqrt(dx*dx+dz*dz); (4) const playAnim option objects in syncObj; moveBasis -> out-param; fx spawn scratch Color +
  preallocated p.dir; findPath pooled typed arrays + binary-heap open list; hud dirty flags.
- Files: runtime/3d/royale/maps.js (:2131-2151), weapons.js (:619-700), player.js (:1380-1500), bots.js, fx.js, hud.js,
  loot.js; runtime/sim/royale.js (segmentColliders :260, moveBasis :192 — keep the sim Node-testable; run
  royale.selftest.cjs after).
- Reference: blocktooth/src/core/loop.ts:70-74 + :100 (Float64Array rings; "Allocation: the result object only").
- Verify: re-run the framepump7 allocation window — KB/frame from 554.5 to well under 100, queryColliders calls/frame
  down; Node selftest still green for sim/royale.js; bot hit-registration unchanged (botcheck.py numbers).

### G7 (MEDIUM, S) "Animation LOD" freezes far rigs but still pays for them
- Evidence: player.js:1416 `a.rig.mixer.timeScale = far ? 0 : 1;` while the kernel ticks every mixer
  (ffg_kernel_3d.js:489 `for (let i = 0; i < this._mixers.length; i++) this._mixers[i].update(dt);`); three r172
  AnimationMixer.update still runs every action `_update` and every binding `apply` at timeScale 0
  (three.core.js:34229-34262). 50 mixers alive in the drop census.
- Fix: a per-mixer skip flag (or remove from kernel._mixers) for far and off-screen actors, and a 1/2- or 1/4-rate tick
  with accumulated dt for mid range.
- Files: runtime/3d/ffg_kernel_3d.js (:489), runtime/3d/royale/player.js (:1414-1416).
- Verify: frameprof `mixers` section (G8) mean ms drops; far bots still animate on approach (real browser).

### G8 (NONE direct / the enabler, S) No frame profiler, no honest counters, no budgets
- Evidence: 0 hits for `performance\.mark\|frameprof\|FrameProf\|prof=1`, `info\.autoReset`, `EXT_disjoint_timer_query`.
  With the composer, three's default per-render() info reset means `renderer.info.render.calls` after a frame shows only
  the LAST pass. EXT_disjoint_timer_query_webgl2 IS exposed on the reference Intel UHD (frameprobe env, timerQuery True).
  None of G1-G7 was visible to the team without an ad-hoc probe.
- Fix: port blocktooth/src/render/frameprof.ts as runtime/3d/ffg_frameprof.js (`?prof=1` only, zero cost off); kernel
  loop: info.autoReset=false + one reset per frame (renderer.ts:14-15, :160), marks tweens / mixers / update / render,
  gpuBegin/gpuEnd around composer.render; ffg_royale3d.js marks per module (bots, player, weapons, loot, storm, fx, hud,
  audio, net); expose `__LC__.prof()`; BUDGET constants {drawCallsMax 450, p99 22 ms, dprMax 1.5}.
- Files: runtime/3d/ffg_frameprof.js (new), runtime/3d/ffg_kernel_3d.js (start :469-495), runtime/3d/ffg_royale3d.js
  (:557-609, controller :615-637).
- Verify: `?prof=1` in a real browser: `__LC__.prof()` returns per-section mean/max, draws that include shadow + bloom
  passes, and GPU ms; with prof off there are no extra calls.

### G9 (MEDIUM for phone players, S) Cross-lane: the kernel portrait camera fit is overwritten every frame
- Evidence: the in-flight kernel edit applies the fit only on resize/boot/start (ffg_kernel_3d.js:195, :472, :514), but
  hud.js:485-486 (menu, per frame) and player.js:1905-1906 (match, per frame) rewrite camera.fov. Code trace only.
- Fix: call `this.applyCameraFit()` in the kernel loop after the updaters, before render (ffg_kernel_3d.js:490-491).
- Files: runtime/3d/ffg_kernel_3d.js only (build on the other session's uncommitted edit).
- Verify: at 390x844 in a real browser, camera.fov during a match equals the widened value and the horizontal view
  matches a 16:9 desktop frame.

### G10 (LOW, M) DPR has no budget cap and no DynRes
- Evidence: ffg_royale3d.js:153 `const DPR = { low: 1, medium: 1.5, high: 2 };` -> :171 setPixelRatio(min(device, tier));
  BLOCKTOOTH caps at BUDGET.dprMax 1.5 (config.ts:993; renderer.ts:67-70 effectiveDpr) and runs DynRes
  (game.ts:271-353, applied via setQuality at game.ts:968-971, resize only inside render: renderer.ts:151-162, :177-180).
  preserveDrawingBuffer:true is always on (ffg_kernel_3d.js:74, kept for vision QA).
  LOW because this frame is vertex/skinning-bound, not fill-bound (ffg_royale3d.js:157-160 measured 64x36 ~= 720p; the
  G1/G2 attribution agrees) — DynRes pays off mainly on DPR-2 laptops at the high tier.
- Fix: effectiveDpr = max(0.5, min(device, tier, 1.5)) x dynres.scale inside the kernel; applyGraphics hands the tier DPR
  to the kernel instead of calling setPixelRatio; port DynRes with `?dynres=0` / `?rscale=` switches; consider gating
  preserveDrawingBuffer behind a QA flag.
- Files: runtime/3d/ffg_kernel_3d.js (:74-92, :190-198, loop), runtime/3d/ffg_royale3d.js (:150-171).
- Verify: `?rscale=0.7` gives a 0.7x drawing buffer with unchanged CSS size; on a DPR-2 display the high tier renders at
  1.5 (real browser).

### G11 (LOW, S) The parachute allocates and leaks GPU objects on every deploy
- Evidence: player.js:1344-1370 new SphereGeometry x2 + MeshStandardMaterial x2 (+clone) + LineBasicMaterial +
  BufferGeometry per deploy; removeChute player.js:1375-1377 only unparents (no dispose). Space toggles the canopy
  freely (player.js:1031-1035). 4 draw calls per canopy.
- Fix: module-level shared geometries/materials (per-colour material cache), one pooled canopy group per actor.
- Files: runtime/3d/royale/player.js (:1329-1377).
- Verify: renderer.info.memory.geometries identical before/after 20 chute toggles (real browser).

### G12 (LOW, S) No concurrent-voice cap for gunfire
- Evidence: audio.js:147-192 sample() and audio.js:380-425 spatial() build BufferSource + Gain (+ Biquad) + an HRTF
  PannerNode for every audible shot (on("shotFired") audio.js:579-595); the only throttle is impacts (audio.js:701).
  BLOCKTOOTH has a per-frame SFX budget (blocktooth/src/audio/sfx.ts:322 `const FRAME_BUDGET = 4;`).
- Fix: cap live remote-gunshot voices (e.g. 12, steal the farthest) plus a per-frame start budget.
- Files: runtime/3d/royale/audio.js.
- Verify: count live voices during a 49-bot endgame fight in a real browser (WebAudio node-count hook).

### G13 (NONE, S-M) The harness cannot see any of this
- Evidence: _harness/ holds botcheck.py, botdiag.py, stuckdiag.py, bridge_host.html only; fastForward skips view code.
- Fix: add _harness/framecheck.py built from scratch/framepump6.py (kernel loop stopped, frames pumped, draws no-op'd,
  exact counters: draws, tris by pass/group, programs compiled after warm-up, forced layouts per frame, KB allocated per
  frame) — deterministic gates that do not depend on the shared GPU; plus a DYEFIELD-style perfcheck.py for real-rAF timing
  that refuses to run while other automated Chromes are alive (dyefield/_harness/perfcheck.py:9-12).
- Files: _harness/framecheck.py (new), _harness/perfcheck.py (new).
- Verify: framecheck exits non-zero on the current build (27 new programs on drop frame 1) and zero after G3.

---------------------------------------------------------------------------------------------------
## Minimal port of BLOCKTOOTH's pieces (order, and file-disjoint lanes)

Order matters: measure first, then fix the two things players feel most, then the cure.

1. **frameprof** (G8, S) — `runtime/3d/ffg_frameprof.js` = blocktooth/src/render/frameprof.ts with the types stripped
   (it is already framework-free: ring of 1500 frames, worst-50, LoAF observer, GPU timer queries, `?prof=1` only).
   Wire: kernel loop marks + `info.autoReset=false` + one reset per frame; royale pipeline marks per module.
2. **shadow + character LOD** (G1 S, G2 M) — not a BLOCKTOOTH file, but BLOCKTOOTH's rule (one tight shadow, budgets
   in config) applied to Last Circle's measured hot spot. G1 alone removes ~86% of the drop frame's triangles.
3. **warmup** (G3) — `runtime/3d/ffg_warmup.js` = blocktooth/src/render/warmup.ts, with the canvas/RT pair replaced by
   one real `composer.render()` (Last Circle always draws through EffectComposer; its RT is HalfFloat, type 1016 measured).
4. **render core** (G5 S, G10 M) — from blocktooth/src/render/renderer.ts: ResizeObserver size cache (:105-124),
   effectiveDpr with a budget max (:66-70), resize only inside render (:151-162, :177-180), honest counters (:14-15, :160).
   DynRes from blocktooth/src/game.ts:271-353 after that (low priority: this frame is vertex-bound).
5. **cadence fix now, fixed tick later** (G4) — weapons.js overshoot carry is a two-line change; the GameLoop port
   (blocktooth/src/core/loop.ts) is the real cure and the biggest change in this list — do it after (1) so its sim cost
   per tick is known (at 30 fps display a 60 Hz tick doubles the per-frame sim cost).
6. **allocation sweep + mixer LOD** (G6 M, G7 S), then chute (G11), audio cap (G12), harness (G13).

Suggested file-disjoint lanes:
- Lane RENDER-CORE: runtime/3d/ffg_kernel_3d.js, runtime/3d/ffg_frameprof.js (new), runtime/3d/ffg_warmup.js (new).
  Owns G5's kernel half, G7's kernel half, G8, G9, G10. Must build on the uncommitted PORTRAIT CAMERA FIT edit.
- Lane ORCHESTRATOR: runtime/3d/ffg_royale3d.js (+ weapons.js :379/:435 for the cadence carry). Owns G3 call site, G4,
  G8 marks, G10 applyGraphics routing.
- Lane ACTORS: runtime/3d/royale/player.js (+ assets/chars/meshy LOD files). Owns G1, G2, G7's player half, G11, G5's
  mousemove read, the G3 warm chute.
- Lane HOT-PATHS: runtime/3d/royale/maps.js, fx.js, hud.js, loot.js, bots.js, runtime/sim/royale.js. Owns G6 and G5's
  fx/hud reads (depends on RENDER-CORE exposing kernel.viewW/viewH — agree the name first).
- Lane AUDIO: runtime/3d/royale/audio.js (G12).  Lane HARNESS: _harness/framecheck.py, _harness/perfcheck.py (G13).
Overlaps to schedule, not share: fx.js is touched by G3 (retire prewarm) and G6 — give both to HOT-PATHS, with the
warm-up call site change in ffg_royale3d.js done by ORCHESTRATOR.

---------------------------------------------------------------------------------------------------
## Appendix A — the 59 `new THREE.Vector3` lines, classified (grep -n "new THREE.Vector3" -r runtime/)

None of the 59 executes on every frame. By when they run:
- **Per gameplay event inside a match (7):** fx.js:247 (every tracer = every trigger pull by all 50 actors — the frequent
  one), fx.js:403 (every damage number), player.js:1367 + :1368 (12 per parachute deploy), player.js:1646 (per weapon
  swap per actor), weapons.js:790 (per grenade terrain bounce), loot.js:250 (per spawned item, incl. death drops).
- **Per actor, once (4):** player.js:57 (pos, vel), player.js:1275 / :1276 (lazy mantle endpoints), bots.js:160 (lastPos).
- **Pool init (1):** fx.js:31 (1024 particles x pos/vel at init).
- **Module-level scratch, reused — the right pattern (22):** ffg_royale3d.js:258; bots.js:536; fx.js:19, :109, :110, :407;
  player.js:199, :909, :1736, :1739, :1740, :1741, :1742, :1743, :1749; pose.js:81, :162, :163, :164; weapons.js:258, :441, :442.
- **Load / build time (25):** ffg_kernel_3d.js:312 (enableOrbit setup); hud.js:2403, :2404 (weapon icon build, cached);
  loot.js:45, :48; maps.js:468, :594, :1929, :1954, :1960, :2048, :2049, :2118; player.js:397 (onBeforeCompile uniform);
  rig_pipeline.js:85, :126, :147, :169; weapons.js:94, :97, :115, :131, :166, :176, :186.
The real per-frame allocation is elsewhere (G6): object literals, Sets, arrays, strings and `.clone()` —
e.g. weapons.js:511 `const dir = _d.clone()...` per pellet and weapons.js:567 `_d.clone()` per shot.

## Appendix B — warm-up / compile call sites (grep -n -i "warmup\|warm up\|prewarm\|pre-warm\|compileAsync\|\.compile(")
- ffg_royale3d.js:421-423 comment + `if (fxMod.prewarm) fxMod.prewarm(W);` -> fx.js:425-449: adopts blast sprites, toggles
  them visible at 1e-4 scale, `W.kernel.renderer.compile(W.scene, W.kernel.camera)` (fx.js:445), canvas variant.
- ffg_royale3d.js:436-446 comment + `await kernel.renderer.compileAsync(W.scene, W.camera)` (:444) / `compile` fallback
  (:445), canvas variant, no forced visibility, no real draw.
- fx.js:417-420 doc comment, fx.js:447 catch. The grep returns 10 lines (ffg_royale3d.js:421, 423, 441, 444, 445; fx.js:417, 420, 425, 445, 447) = two call sites and their comments. No shadow-depth warm, no RT warm, no warm frame.

## Appendix C — resize / pixel-ratio / loop facts (Last Circle)
- Loop: ffg_kernel_3d.js:469-495 — rAF, `dt = Math.min(0.05, clock.getDelta())`, tweens, cannon step (unused here),
  ALL mixers, updaters, `composer.render(dt)` or `renderer.render`. No frame stats.
- Resize: window "resize" (ffg_kernel_3d.js:176) + orientationchange / visualViewport nudges at 120/420 ms (:184-186);
  `_resize()` reads `parent.clientWidth/clientHeight` only then (:191-192) — not per frame; `setSize(w, h, true)` writes
  canvas CSS (:193); composer resized (:197).
- Renderer: `new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true })` (:74); ACES tone mapping,
  exposure 1.05 (:93-94); PCFSoftShadowMap (:82); sun 1024 map (:102) later resized per tier (ffg_royale3d.js:213-217).
- Graphics tiers: ffg_royale3d.js:150-239 (DPR, shadow size/extent, anisotropy, bloom on/off, loot cull, weapon LOD).
- Extra WebGL contexts: hud.js:963 (menu skin preview, disposed at :1035) and hud.js:2387 (weapon-icon renderer,
  created once, never disposed — lives through every match).

---------------------------------------------------------------------------------------------------
## DATA — live browser runs (framepump5.py / framepump6.py / framepump7.py; seed 1, isla_viva, standard, tier medium)

Exact counts (reproducible; seed-deterministic — the first drop frame gave the identical 9,908,496 triangles in all
three runs):

| moment | draws | triangles | biggest share | programs |
|---|---|---|---|---|
| menu (sampled) | 287-293 | 92.5 k | — | 18-19 |
| after startMatch warm-up | — | — | — | 19 -> 46 (run 5), 18 -> 45 (run 6): +27 |
| FIRST rendered drop frame | 360-367 | 9,908,496 | shadow:actors[skinned] 22 draws / 8,573,580 (86.5%) | **+27 on this frame** (3 of 3 runs) |
| drop +4 s | 373 | 10,139,419 | shadow:actors[skinned] 21 / 8,491,270 | +0 |
| match, t = 32.9 s, 42 alive, on the ground | **440-446** | **16,478,983** | **main:actors[skinned] 34 draws / 13,380,760 (81%)**; shadow:actors[skinned] 6 / 2,007,820 | **+2 on this frame** |

Match frame, full attribution: main:actors[skinned] 34 / 13,380,760 · shadow:actors[skinned] 6 / 2,007,820 ·
main:map[inst] 33 / 717,876 · main:map 133 / 197,597 · shadow:loot 67 / 88,905 · shadow:actors 4 / 24,008 ·
main:loot 113 / 22,079 · shadow:map 32 / 15,212 · main:fx[inst] 2 / 12,416 · main:actors 3 / 11,912 · main:storm 2 · post 14.
=> In the match the problem moves from the shadow pass (G1) to the main pass (G2): 34 full-detail characters in view,
most of them a few pixels tall, ~394k triangles each. The draw count (446) is already at the 450 budget with 113 loot
draws + 67 loot shadow draws for ~111k triangles — the loot is draw-call-heavy, triangle-light.

Scene census: drop +4 s — 495 visible drawables (227 mesh, 50 skinned, 35 instanced, 181 sprites, 2 lines), 129 shadow
casters, 268 materials, 72-74 programs, 50-51 mixers; match t = 32.8 s — 571 visible drawables, 195 shadow casters,
272 materials, 96 textures, 399 geometries.

Weapon cadence, measured IN THE PAGE through the real weapons.js `update(W, dt)` (held trigger, 10 s, infinite mag) —
identical to the Node mirror:
  SMG (design 720): 165 Hz 708 · 144 Hz 720 · 120 Hz 660 · 75 Hz 648 · **60 Hz 600** · 50 Hz 606 · 30 Hz 606 · 20 Hz 600 ·
  60 Hz with +/-0.5 ms jitter 666.
  AR (design 330): 165 Hz 336 · 144 Hz 324 · 120 Hz 330 · 75 Hz 324 · 60 Hz 330 · 50 Hz 306 · 30 Hz 306 · 20 Hz 300 ·
  60 Hz jitter 330.

Forced layout (CDP, no-yield pump): drop 1.00 layout + 1.15 style recalcs per frame (0.28-0.29 ms + 0.06 ms);
match 0.15 layout + 0.77 style recalcs per frame (0.12 ms + 0.21 ms). Contaminated timings, exact counts.

CPU per pumped frame (contaminated INFORMATION — 8 Chromes on one iGPU box, CPU-only frames):
  drop, 1,671 frames: sim+view p50 3.4 ms · p90 10.1 · p99 24.3 · max 179.6 (updaters mean 3.56, mixers mean 1.58);
  match, 1,200 frames: sim+view p50 9.8 ms · p90 16.3 · p99 32.3 · max 95.9 (updaters mean 8.4, mixers mean 2.69).
  Render submit on the sampled frames: 15.8 s - 186 s (GPU starved; meaningless except as proof the box was saturated).
  So on this box the CPU half of the frame alone overshoots the 22 ms p99 target in the match — before any rendering.

Heap: run 6's sampling used the default (retained-only) mode, so its 0.6 KB/frame is NOT an allocation rate and is not
used. Run 7 repeats it with includeObjectsCollectedByMinorGC/MajorGC (total allocated) — result appended below.

### Allocation rate — framepump7.py (HeapProfiler.startSampling, samplingInterval 4096,
### includeObjectsCollectedByMinorGC + MajorGC = TOTAL allocated, 600 pumped match frames, 49 bots live)
- **554.5 KB allocated per frame** (332,699 KB over 600 frames) = ~33 MB/s at 60 fps. Exact method, contaminated box
  does not change allocation counts.
- **W.map.queryColliders called 423.2 times per frame** (counting wrapper on W.map; external callers only —
  maps.js-internal calls at :2174 / :2241 are not counted). Each call allocates an array, a Set and 1-4 string keys.
- Top sites (KB per frame): testSegment weapons.js:663 **180.7** (projectile sub-step collision: queryColliders +
  segmentColliders + a Math.hypot per actor per sub-step; weapons.js:630 `const steps = Math.max(1, Math.min(8,
  Math.ceil((speed * dt) / 2.5)));`) · three Interpolant.evaluate three.core.js:25141 **95.2** (the 50 animation mixers,
  G7) · native Math.hypot **60.1** · syncObj player.js:1380 20.3 (playAnim option literals) · native Set 18.6 +
  the queryColliders call path 17.9 (my counting wrapper's frame; the Set/array/key allocations of queryColliders
  land here and under maps.js:2141 1.0) · segmentColliders sim/royale.js:260 14.4 · stepActor player.js:1007 14.1 ·
  actEngage bots.js:1151 12.0 · three slerpFlat 11.8 · stepProjectiles weapons.js:619 11.5 · losBlocked maps.js:2154 10.2 ·
  loot update loot.js:650 9.0 · moveToward bots.js:752 6.7 · perceive bots.js:361 4.0 · moveBasis sim/royale.js:192 3.1.
- By file (MB over 600 frames): weapons.js 117.3 · native 71.2 · three.core.js 68.8 · player.js 24.1 · bots.js 19.7 ·
  sim/royale.js 12.2 · maps.js 8.9 · loot.js 6.8 · pose.js 1.4 · fx.js 1.0 · hud.js 0.8 · audio.js 0.4.
- JS heap across the window 40.6 -> 30.9 MB (GC ran inside it); the retained-only sample of run 6 (0.6 KB/frame) is
  superseded by this.
- Correction to the static guess: the fx.js / hud.js / loot.js literals are small change (<= 9 KB/frame together);
  the real allocator is the projectile collision path in weapons.js + queryColliders + Math.hypot, then the mixers.
