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
