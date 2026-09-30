
---------------------------------------------------------------------------------------------------
## GAPS — ranked by what a player would notice

### G1 (HIGH, S) Characters cast full-detail shadows nobody can see — 86.5% of the drop frame's triangles
- Evidence: first drop frame `shadow:actors[skinned]` 22 draws / 8,573,580 of 9,908,496 tris (reproduced;
  +4 s: 8,491,270 of 10,139,419). Shadow extent widens to 620 m in the glide (ffg_royale3d.js:282) -> ~0.6 m per
  texel on the 2048 medium map (ffg_royale3d.js:154 `SHADOW = { low: 0, medium: 2048, high: 4096 }`), so a
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

### G2 (HIGH, M) 245k-632k-triangle characters with no LOD
- Evidence: skin GLBs (glTF JSON parsed): soldier 409,150 tris / 214,760 verts, athlete 245,730, wraith 281,438,
  juggernaut 632,456, viper 331,176; one SkinnedMesh each (player.js:371-372 comment agrees: "meshes 1 | materials 1").
  Main pass drew 409,150 tris for ONE on-screen character (the player) in the first drop frame; 2 on screen = 654,880.
  A firefight with 5 enemies on screen is ~2 M skinned triangles in the main pass alone.
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
  :7157/:7200 both in the cache key). Measured 3x: warm-up 19 -> 46 programs, then the first rendered drop frame
  46 -> 73 (+27). Also never warmed: shadow-depth variants (only link in a real shadow pass) and the chute
  (player.js:1344-1370 creates MeshStandardMaterial DoubleSide + LineBasicMaterial at deploy time).
- Fix: port blocktooth/src/render/warmup.ts as runtime/3d/ffg_warmup.js, adapted to the composer: force-visible +
  frustumCulled=false (warmup.ts:452-464), then run ONE real `kernel.composer.render()` under the loading screen
  (compiles RT variants, shadow-depth variants incl. skinned depth, bloom + output programs), then restore. Put one
  hidden warm chute in the actors group (or share module-level chute materials) so its programs are in the scene.
  Replace ffg_royale3d.js:421-446 and retire fx.prewarm (fx.js:417-449).
- Files: runtime/3d/ffg_warmup.js (new), runtime/3d/ffg_royale3d.js (:421-446), runtime/3d/royale/fx.js (:417-449),
  runtime/3d/royale/player.js (deployChute :1329-1374).
- Reference: blocktooth/src/render/warmup.ts:466-497 (RT compile + RT render, canvas compile + canvas draw, exact restore).
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

### G5 (MEDIUM, S) Forced synchronous layout every frame
- Evidence (measured): 1.00 forced layout + 1.15 forced style recalcs per frame across 240 no-yield pumped frames.
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

### G6 (MEDIUM, M) Per-frame allocation in hot paths (GC hitches)
- Evidence (static; heap-sampling numbers in the data section): maps.js:2141-2150 queryColliders allocates
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
- Fix: queryColliders -> reused result array + per-query stamp (no Set) + numeric cell key (e.g. (cx+32768)*65536+(cz+32768));
  fx spawn -> setHex into a scratch Color, preallocated p.dir; moveBasis -> out-param; const playAnim option objects;
  hud dirty flags instead of signature strings; findPath -> pooled typed arrays + binary-heap open list.
- Files: runtime/3d/royale/maps.js, fx.js, player.js, hud.js, loot.js, bots.js; runtime/sim/royale.js (moveBasis — keep
  the sim Node-testable; run royale.selftest.cjs after).
- Reference: blocktooth/src/core/loop.ts:70-74 + :100 (Float64Array rings; "Allocation: the result object only").
- Verify: CDP HeapProfiler sampling over 600 pumped match frames — KB/frame down by at least the queryColliders share;
  Node selftest still green for sim/royale.js.

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
