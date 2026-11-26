# LOADTIME — the long start-up on Windows (Chrome, ANGLE-D3D11) — ledger

Started 2026-11-26. Report: a player on Windows (Chrome, RTX 5070) said the game "took forever" to load; the owner's Mac
(ANGLE-Metal) loads in seconds. No Windows here: headless Chromium + SwiftShader only. SwiftShader has NO
KHR_parallel_shader_compile (checked: `loadtime/ext-probe.mjs`, three ANGLE back-end flags, all `false`) and compiles
lazily at the first query / draw, so its times mean nothing for D3D; program COUNTS and SOURCE SIZES are valid.

## Files (mine)
- `src/render/boot.ts` (new): the boot trace (always on) + the non-blocking boot compile helpers.
- `src/app.ts`: boot marks, `bootCompile()`, the new boot order under `bootc`, `?boottrace=1`.
- `src/render/renderer.ts`: 3 hook lines (import, `bootTrace.install`, `bootTrace.setThree`). Nothing else.
- `src/render/perfreport.ts`: the `boot:` lines in the report (1 import + 2 lines).
- `src/render/life/farcrown.ts`: leafTileMeans uses a 256-entry table (exact same numbers) instead of 3 pow() per texel.
- Probes: `_harness/arc-work/loadtime/boot-probe.mjs` (boot one URL, dump the trace; `--parallel=K` EMULATES a slow
  parallel compiler: K us per source char on 4 threads, any non-completion query on an unfinished program busy-waits;
  `--profile=1` CPU profile of the main thread), `ext-probe.mjs`. Outputs: `_harness/scratch/loadtime/`.
- Dev server for probes: `npx vite --port 5311 --strictPort` (restart it after a container restart).

## What was wrong (by the code + the trace)
1. `app.start` ran 3 warm-up frames BEFORE the shader warm-up. three links a program at its first draw and at once asks
   `getProgramInfoLog` / `getProgramParameter(LINK_STATUS)` (WebGLProgram.js onFirstUse) = a synchronous wait for the
   compiler. So the ~30 programs of the first frames (terrain 244 k chars of fragment GLSL, water 60 k, clouds 59 k +
   27 k + 19 k, sky, post) compiled ONE AT A TIME on the main thread, the page frozen, the boot card not moving.
2. Then `Renderer.warmUp` asked for ~150 more programs (6 MB of fragment source: every MeshStandardMaterial carries the
   ~90 k shared lighting block; each exists twice, with and without the night-light pool) and waited at most 4 s. On a
   slow compiler the game started with most of them unfinished; whatever came on screen next (plants, houses, crowds)
   waited synchronously behind them.
3. r186 `compileAsync` (checked in node_modules/three/src/renderers/WebGLRenderer.js:1515): `compile()` = prepareMaterial
   for every object of the given scene, HIDDEN ONES TOO (scene.traverse), against the current render target and the
   scene's visible lights; it only REQUESTS programs (no getUniforms), then polls `program.isReady()` =
   COMPLETION_STATUS_KHR every 10 ms. Without the extension isReady() is true at once (the first draw waits).

## The new boot (`?bootc=0` = old path; also old path automatically where the extension is missing)
1. right after the Renderer exists (before the sim worker has made the world): `requestPasses` — every full-screen pass
   material (fsquad PASS_MATERIALS) is asked for; they compile in the browser's threads during world generation.
2. at "The first light": `syncPlanets` (the planets' visuals, so their passes exist), `requestPasses` again (+ the FXAA
   pass against the canvas), wait (non-blocking) with the card counting "Preparing graphics… n of m".
3. `guardedFrame` x up to 10: whole frames, but each draw of the MAIN scene first asks for the programs of its visible
   objects (three's compile, per object, with the scene's lights) and is left out if any is still compiling. Full-screen
   passes and one-off bakes (LUTs, noise, cloud weather: they latch "done") are drawn as usual — their programs were
   asked for in 1-2. No terrain tile is baked in these frames (a bake reads the last frame's shadow maps).
4. `Renderer.warmUp(1)` (hidden effects, night-light variants, depth twins, passes: asked for, not waited for inside),
   then wait for everything with the count on the card, at most `?bootwait=` s (default 30); what is left compiles behind
   the game.
5. `renderer.cut()` (exposure / history afresh), the 3 real warm-up frames as before, playable.
