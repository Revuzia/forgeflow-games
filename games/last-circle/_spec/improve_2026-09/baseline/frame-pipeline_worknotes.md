# Last Circle — frame-pipeline audit lane (IN PROGRESS)

Read-only audit. Reference: BLOCKTOOTH src/render/{renderer,frameprof,warmup}.ts.
Paths below are relative to games/last-circle/ unless prefixed.

## Read so far
- runtime/3d/ffg_kernel_3d.js (526 lines) — full
- runtime/3d/ffg_royale3d.js (673 lines) — full
- runtime/3d/ffg_boot3d.js (113 lines) — full
- blocktooth src/render/renderer.ts, frameprof.ts, warmup.ts — full

## Early findings (verified by read)

1. Sim steps with RAW frame dt, no fixed tick, no interpolation.
   - ffg_kernel_3d.js:475 `const dt = Math.min(0.05, this.clock.getDelta());`
   - ffg_royale3d.js:573 `let step = Math.min(dt, 0.05);` then :587-601 bots/player/weapons/loot/storm/fx/hud/audio/net all called with `step`.
   - fastForward (ffg_royale3d.js:626-635) uses a fixed h (1/30 default) -> the harness path and the live path run DIFFERENT step sizes.
2. DPR: static cap only (tier table), no DynRes.
   - ffg_kernel_3d.js:80 `this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QDPR[_q] || 1.5));`
   - ffg_royale3d.js:171 `r.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR[tier] || 1.5));` (DPR = {low:1, medium:1.5, high:2})
   - no budget max, no dynamic controller.
3. Resize: window 'resize' event + visualViewport nudges; reads parent.clientWidth only on resize (NOT per frame) — ffg_kernel_3d.js:176, 191-192.
4. Renderer: `preserveDrawingBuffer: true` (ffg_kernel_3d.js:74) — kept on for vision QA.
5. Shader warmup: `kernel.renderer.compileAsync(W.scene, W.camera)` at ffg_royale3d.js:444 + fxMod.prewarm at :423. No RT variant, no forced visibility, no real draw.
6. No frame profiler; no renderer.info capture in loop (kernel loop ffg_kernel_3d.js:473-493).

## More verified findings (static read, checkpoint 2)

7. Weapon cadence is FRAME-RATE DEPENDENT (consequence of raw-dt stepping):
   - weapons.js:379 `wpn.cd -= dt;` and weapons.js:435 `wpn.cd = 60 / def.rpm;` (reset, overshoot discarded)
   - smg rpm 720 (sim/royale.js:61) -> interval 83.3 ms; at 30 Hz or 20 Hz fires every 3/2 frames = 100 ms = 600 rpm.
   - browser measurement queued (framepump.py cadence section).
8. Per-frame forced layout reads:
   - fx.js:563-564 `const cam = W.camera, rect = W.kernel.renderer.domElement; const w2 = rect.clientWidth, h2 = rect.clientHeight;` every fx.update.
   - hud.js:2367 `const wpx = W.kernel.renderer.domElement.clientWidth, hpx = ...clientHeight;` inside stepIndicators, called every hud.update (hud.js:2235), AFTER hud.js:2027 compass transform write -> forced sync layout each frame.
   - hud.js:2260 `const sw = window.innerWidth, sh = window.innerHeight;` per frame when loot nearby.
   - player.js:840 `const rect = dom.getBoundingClientRect();` on EVERY mousemove.
   - BLOCKTOOTH fix: renderer.ts:105-124 ResizeObserver-cached cssW()/cssH().
9. Allocation hot spots (static):
   - maps.js:2141-2150 queryColliders: `const out = [];` + `const seen = new Set();` + cKey string (maps.js:2131 `return cx + "," + cz;`) PER CALL; called by supportAt (player.js:914) and blockedHoriz (player.js:936) per actor per frame, and by A* cellBlocked->obstacleAt (bots.js:652) up to 43x43=1849 times per path.
   - fx.js:65 `const c = new THREE.Color(...)` per particle spawn; fx.js:75 spawn({...}) object literal per particle; fx.js:247 `dir: new THREE.Vector3(dx, dy, dz)` per tracer.
   - sim/royale.js:192-194 moveBasis returns a new object per call (player.js:1043, 1191 per actor per frame).
   - player.js:1436-1488 playAnim(a, ..., { timeScale: ... }) object literal per actor per frame; `fam + "_run"` string concat per actor per frame (player.js:1463-1464).
   - hud.js:2080-2081 Object.values(...).join + slots.map(...).join per frame (signature strings).
   - loot.js:741 `W.interactHint = target ? Object.assign({}, target, {...}) : null;` per frame.
   - bots.js:686,701,702 Uint8Array/Float32Array/Int32Array per findPath + open-list arrays (bots.js:700,720) + linear-scan splice (bots.js:707-708).
10. Chute: player.js:1329-1374 deployChute builds 2 SphereGeometry + 3 MeshStandardMaterial + LineBasicMaterial + BufferGeometry PER DEPLOY; removeChute (player.js:1375-1377) only unparents, never disposes -> GPU leak and 4 draw calls per gliding actor.

## Checkpoint 3 — warm-up variant mismatch (verified against three r172 source)

11. Last Circle's shader warm-up compiles the CANVAS program variants, but every scene draw
    goes through the composer's render target (RT variant). Evidence:
    - ffg_royale3d.js:444 `if (kernel.renderer.compileAsync) await kernel.renderer.compileAsync(W.scene, W.camera);`
      and fx.js:445 `W.kernel.renderer.compile(W.scene, W.kernel.camera);` — both with no setRenderTarget, i.e.
      whatever target is current (null after OutputPass draws to screen).
    - Composer is always on in play: live env probe -> composerPasses ['RenderPass','UnrealBloomPass','OutputPass'].
    - three r172 RenderPass.js:62 `renderer.setRenderTarget( this.renderToScreen ? null : readBuffer );`
    - three r172 three.module.js:6904-6908 toneMapping is only renderer.toneMapping when `currentRenderTarget === null`,
      else NoToneMapping; :6939 outputColorSpace is LinearSRGB for a non-XR RT; both are program-cache-key
      fields (:7157 `array.push( parameters.outputColorSpace )`, :7200 `array.push( parameters.toneMapping )`).
    - => the compileAsync at match start builds ACES+sRGB programs that play never uses; the RT programs still
      compile on first draw. BLOCKTOOTH warmup.ts:471-486 compiles AND renders into an RT first, then the canvas.
    - Also not covered by LC warm-up: shadow-depth programs (only link in a real shadow pass), and objects
      that do not exist yet at warm-up (chute: player.js:1344-1370 new MeshStandardMaterial DoubleSide +
      LineBasicMaterial per deploy), and objects hidden by LOD (weapons at player.js:991, loot at loot.js:669).
    - Live check (programs appearing during pumped drop/match frames): framepump3.py, pending.

## Checkpoint 4 — live browser measurements (framepump4.py, headed Chrome, Intel UHD, 1280x720, DPR 1, tier medium)
Box condition (measured): rAF throttled to 14.9/s on about:blank (rafcheck.py); 8 automated Chromes alive
(7 from other lanes) sharing the iGPU; gl.finish() blocked up to 188 s. => ALL wall-clock timings are
contaminated INFORMATION. Counts (draws, tris, programs) are exact.
- Menu: draws p50 289 / max 293, tris 92,578 per frame (6 sampled renders).
- startMatch: programs 19 -> 46 (the warm-up compiled 27).
- FIRST rendered drop frame: programs 46 -> 73 (+27 compiled ON THAT FRAME), draws 352, tris 9,908,480,
  updaters 44.7 ms + mixers 6.6 ms (contaminated). The +27 on frame one equals the 27 the warm-up compiled:
  consistent with finding 11 (warm-up built canvas variants; play needs RT variants).
- 9.9 M triangles in one frame is the headline draw-cost number (census pending to attribute it).
- AnimationMixer at timeScale 0 still does the full work: three r172 three.core.js:34229-34262
  `deltaTime *= this.timeScale;` then runs every action `_update` and every binding `apply` — so
  player.js:1416 `a.rig.mixer.timeScale = far ? 0 : 1;` freezes the pose but not the CPU cost.
- Jump apex vs frame rate (computed with the game's own integrator, player.js:1248 + :1284, jumpV 7.8,
  gravity -22 from sim/royale.js:117): 165 Hz 1.359 m, 144 Hz 1.356 m, 60 Hz 1.318 m, 30 Hz 1.256 m,
  20 Hz 1.190 m (analytic 1.383). NOT browser-measured.
