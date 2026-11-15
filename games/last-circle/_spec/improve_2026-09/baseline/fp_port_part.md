
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
