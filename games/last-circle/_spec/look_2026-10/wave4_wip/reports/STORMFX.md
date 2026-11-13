# STORMFX lane report (Wave 4)

## STATUS (top, updated as I go)
- Attempt 1 (this run). Files I own and have written: runtime/3d/lc_output_pass.js (new), runtime/3d/ffg_kernel_3d.js (draco wasm + lazy meshopt + LCOutputPass),
  runtime/3d/royale/storm.js (rewritten), runtime/3d/royale/fx.js (rewritten pool). ffg_warmup.js: unchanged so far (see warm notes).
- New gates (not registered in gate.py): _harness/new/stormfx_storm.py, stormfx_fx.py, stormfx_lib.py.
- DONE+VERIFIED in a real browser: kernel boots with LCOutputPass + wasm Draco; storm contracts (1 mesh/192 tris/premult normal/ro 5), tint exact restore, W.stormU,
  lightning glare 2.8x, alpha cap.  IN PROGRESS: palette tuning for band delta >= 20/255; fx gate first run.

## Log
- [read phase done] Read plan P1.2/P1.4/P2.0, storm.js, fx.js, kernel, warmup, orchestrator frame order. Design notes:
  * storm.update runs inside simTick (fixed 60 Hz); visual tint/lightning needs view dt -> register ONE session kernel.onUpdate in storm.init(W).
  * player.js underwaterFx also writes scene.fog/background: tint layer uses "foreign-write detection" (base re-captured when current != last applied).
  * maps.js sky dome uniforms are {top,bot} (today); W.skyUniforms (C-SKY) not landed -> fall back to scene mesh named "sky".
  * assets/fx/*.png, hud/wpn_*.png, meshopt_decoder.module.js NOT present yet (ART-B). draco wasm files ARE already vendored (285,747 + 58,763 B).
  * ffg_royale3d.js warmMatch only calls player+fx warmObjects today (ORCH adds storm); the storm wall is in the scene group so warmup force() covers it anyway.
- [11:50] lc_output_pass.js written; kernel: wasm Draco w/ JS fallback (LCDracoLoader), lazy meshopt shim, LCOutputPass (verified in browser: passes = Render/UnrealBloom/LCOutputPass, draco mode 'wasm').
- [11:55] storm.js rewritten (ShaderMaterial wall, ground LUT, tint, lightning, stormU). First gate run (_harness/new/stormfx_storm.py, 208 s): contracts/tint-exact/alpha-cap/lightning PASS; band delta 7-10/255 (need 20), streak peaks metric broken (column profile smears in perspective), streak/curtain emission 2.0-2.2 (need <=2.0) -> palette tuning in progress.
- [12:05] fx.js rewritten to instanced soft quads (spliced, NOT yet browser-tested).

## Verified so far (real browser, --disk, working copy)
- P2.0 kernel (stormfx_fx.py run 2): Draco decoderMode = 'wasm'; athlete.glb position hash through wasm == through a JS-forced loader (3101886270, 29,838 floats);
  meshopt: a real EXT_meshopt_compression GLB (built with meshoptimizer 1.1.1 MIT, vertex codec v0) decodes to the source quad through kernel.loader; the decoder module
  (assets/vendor/.../meshopt_decoder.module.js, ART-B) is requested ONLY at that moment (0 meshopt requests at boot). NOTE: the vendored decoder is meshoptimizer 0.18 -> kit
  files must use vertex codec v0 (a v1-encoded buffer gives "Malformed buffer data: -1"; found that the hard way with my first test file).
- Draco fallback (wasm 404 -> JS; no WebAssembly -> JS) checks added to stormfx_fx.py (run 3).
- Storm contracts, exact tint restore, W.stormU, alpha cap 0.40, lightning 2.8x of sky: PASS in stormfx_storm.py run 1.
- Storm look/gates still FAILING in run 1 (band delta 7-10/255 vs >= 20; streak emission 2.03-2.22x vs <= 2.0): palette was too pale -> new magenta-violet palette being tuned live (p3_tune.py).
