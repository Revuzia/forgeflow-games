# PERF ledger (performance engineer, 2026-11-10) — owner: "keep the high quality but ensure the game isnt so choppy"

Rules: never lower a preset (resolution, DPR, shadows, range, density, effects). Fix causes. Bulky output: _harness/scratch/arc/perf/.
Probe: _harness/arc-work/perf-play.mjs (built game, static server, Playwright SwiftShader; GL call counters + perfmon + CPU profile).

## STATUS
- Session 1 (05:3xZ): probe written, nothing measured. Session 2: probe fixed + first numbers + the main GPU finding
  below. The container restarts often (3 times so far): every run must be restarted through slot.sh.
- Probe usage that WORKS (one cell takes 10-15 min under SwiftShader with load 5; never run two probes at once, the GPU
  process starves and GL calls block for seconds):
  `_harness/slot.sh node _harness/arc-work/perf-play.mjs --dist=_harness/scratch/arc/perf/dist0 --quality=high
   --size=888x500 --scenes=town,region --speeds=1 --frames=24 --settle=12 --gl=1 --profile=1 --passes=1 --extra=seed=1234
   --save=_harness/scratch/arc/perf/world25.gnss --shot=_harness/scratch/arc/perf/shots/NAME --out=...json`
  (`--extra=seed=1234` makes the save load in place; without it the page reloads. `--passes=1` = finish() at every
  framebuffer switch, SwiftShader ms per render target. The save is a 15-year world: 749 people, 33 settlements, 1671
  buildings; rebuild it with `node _harness/arc-work/perf-world25.ts 25 <out>` (~10 min, git-ignored, lost on restart
  only if scratch is wiped). `perf-ext.mjs` lists the WebGL extensions of the headless Chromium.)

## MEASUREMENTS
- Fresh world, High 888x500, orbit, 1x, panning (44 frames): 43 draw calls, 362 k triangles, 24 useProgram, 146 uniform
  calls, 400 state calls per frame; buffer uploads 1.5 MB/frame mean with ONE frame of 30 MB (terrain patches after a
  camera cut); texture uploads 1.1 MB/frame; snapshots: clone p95 1.0 ms, apply p95 5.5 ms, max 7.9 ms (88 messages) —
  the snapshot path is NOT a hitch source at 1x. JS self time per frame is small (updateMatrixWorld 0.6, terrain
  buildGeometry 0.5, GC 2.9 ms/frame mean). Wall time under SwiftShader is all bufferData / texSubImage2D blocking on the
  software GPU process, which says nothing about a real GPU.
- BUSY WORLD, TOWN CLOSE-UP (15 y, High 888x500, speed 0, no input, 30 frames settled then 10 measured, step-1 build
  with zcons on; `z1.log`): 270 draw calls, **3.85 M triangles per frame** — shadows 149 calls / **2.40 M tris**, scene
  75 calls / 1.24 M tris, water 9 calls; 380 terrain patches + 134 water patches; 63 useProgram, 497 uniform calls.
  SwiftShader ms per render target (finish() at each switch): scene+water+fx target 6606, shadow atlas 2240, canvas
  (final FXAA) 53, ALL other passes together (GTAO, clouds, atmosphere, bloom, exposure...) < 5. So the cost is the
  geometry passes, not the full-screen effects. (SwiftShader shades on 4 CPU threads: relative numbers only.)
  STILL STREAMING after 40 frames at rest: 263 bufferData calls / 9.1 MB and 29 texture uploads / 10.3 MB per frame,
  perfmon `planets` slot 172 ms/frame of main-thread JS (this box under load 5; maybe a fifth of that on a Mac): the
  terrain builds patchBudget = 16 patches per frame ON THE MAIN THREAD, a count budget, not a time budget. Snapshot
  path: clone p95 1.8 ms, apply p95 2.7, max 5.2 ms (51 messages): not a hitch source.

## FINDING 1 (largest GPU cause, by reading the code): NO EARLY DEPTH TEST ANYWHERE
`renderer.ts:179` creates the WebGLRenderer with `logarithmicDepthBuffer: true`. three then makes EVERY material's
fragment shader write `gl_FragDepth` (chunk logdepthbuf_fragment). A shader that writes depth cannot be depth-tested
before it runs: the GPU shades every fragment of every triangle, hidden or not (on Apple GPUs it also switches off the
tile renderer's hidden-surface removal). So the 1900-line terrain shader runs in full under every tree, house, grass
blade and person, and every tree crown behind another is shaded in full with 3-cascade shadow lookups. Cost grows with
how much is on screen — exactly the owner's report. Estimated overdraw in a town / forest view 3-6x.
Fix candidates (neither lowers anything; both keep the image):
 a. CONSERVATIVE DEPTH (chosen first; the image is identical by construction, every depth decoder stays as it is):
    keep gl_FragDepth = log depth, declare it `layout(depth_greater)` (EXT_conservative_depth) and make the rasterised
    depth a LOWER BOUND of the log depth: log depth is convex in 1/w, so its tangent at a reference distance w0 is a
    plain projective depth A + B/w that is <= the log depth everywhere and equal at w0. gl_Position.z = (2A-1)w - 2S with
    K = logDepthBufFC/2, L0 = K log2(1+w0), S = K w0^2 / (ln2 (w0+1)), A = L0 + S/w0 - margin. w0 must be constant per
    triangle: the object's (or instance's) origin depth. Needs EXT_depth_clamp (the tangent goes negative close to the
    camera) — both extensions exist in Chrome/ANGLE Metal and in SwiftShader; without them the old path stays.
    All materials include three's logdepthbuf chunks, so the change is central (override ShaderChunk.logdepthbuf_*).
    The bound is tight only near w0 (a fragment at 2 w0 is culled by occluders nearer than ~1.6 w0), so terrain needs a
    per-patch reference (BatchedMesh per LOD level) and terrain should draw LAST among the opaques.
 b. REVERSED-Z float depth (three `reversedDepthBuffer`, EXT_clip_control): full early-Z and Apple HSR, but ~40 edits
    (every depth decode, sky test `d >= 0.999999`, unprojection with clip z = -1, Frustum.setFromProjectionMatrix, the
    custom SunShadows compare, starfield z) with a dual path for browsers without the extension. Larger and riskier.

## OTHER GPU COSTS (analytic, High preset; pixels = canvas x min(dpr, 1.5)^2: 888x500 -> 1.0 MP, 1600x900 -> 3.2 MP)
- shadows: 3 cascades (1024^2 each in a 2048 atlas), every caster drawn again per cascade, every frame.
- scene: terrain (heaviest shader) + buildings + vegetation (alpha test) + crowds, all with shadow lookups; no early-Z.
- GTAO half-res (2 slices x 6 steps); 2 full-screen copies for the water; the water sheet (SSR reprojection).
- clouds: quarter of the pixels marched per frame (48 steps x 5 light steps) + a full-res resolve (25 taps).
- atmosphere composite: full-res, 16 steps; then keepPrevious copy, god rays, bloom chain, tonemap, FXAA (4 more
  full-res passes). About 8 full-screen RGBA16F passes per frame in all.

## FIXES
- F1 (IN PROGRESS, code landed, compiles, NOT yet verified in the browser): conservative log depth.
  `src/render/shaders/zcons.ts` (overrides three's logdepthbuf chunks; `enableConservativeDepth` called in the Renderer
  constructor; `depthClamp(r, false/true)` around the sun-shadow pass), switch `?zcons=0` = old path. Default reference
  distance = object / instance origin; a material may `#define GENESIS_ZREF <per-triangle-constant expr>`.
  Verification running: `_harness/scratch/arc/perf/run-z.sh` -> z1.log / z0.log (+ shots/z1-town.png, z0-town.png,
  -region): must show 0 console errors, equal pictures, and the hdr-target pass ms (SwiftShader) with and without.
  If a shader fails to compile with the #extension line, see zcons.ts shaderSource patch.
  Step 2 (code landed, compiles, NOT yet in a verified build): (a) terrain + water sheet use an EDGE bound instead of a
  tangent (`#define GENESIS_ZEDGE (3.0 * uMorph.z + 2.0)` in terrainvert.glsl.ts; zcons.ts: exact vertex log depth minus
  the chord error K (e/(w-e))^2 * 1.5/(8 ln2); slack ~8 cm at 100 m) — the terrain is one object, a single tangent would
  not reject it under trees; (b) buildings: `GENESIS_ZREF` = the building's own origin (buildingmat.ts); (c) terrain
  batches `renderOrder = 50` (chunks.ts PatchBatch) so the ground is drawn after trees / houses / people.
  Step-1 build = _harness/scratch/arc/perf/dist1 (runs z1 / z0); step-2 needs a new build (dist2) and the same run.
  Still loose (valid, just less rejection): merged meshes whose origin is the planet centre (paved roads, far
  groundcover), particles. Vegetation, crowds, animals, boats, camps use instanceMatrix: per-instance tangent by default.

## REVIEW OF F1 (session 3, 2026-11-11, independent; verdict: KEEP the approach, ONE REAL BUG fixed, two loose ends closed)
Checked line by line against three r186's logdepthbuf chunks (gl_FragDepth = log2(1+w)·FC/2, vFragDepth perspective-
interpolated, so the written depth is exactly L(w) = K·log2(1+w) of the fragment's true view depth w).
- Tangent path (every mesh without GENESIS_ZEDGE): CORRECT for all geometry. clip z = (2A-1)w - 2S is affine in w, so
  rasterised depth = A - S/w EXACTLY at every fragment (also after clipping, for vertices behind the eye, w<0), and the
  tangent of the convex L(1/w) lies under L everywhere. Any per-triangle constant w0 is valid, only less tight: so
  instancing (instance origin), skinned/billboard/sprite/points (object origin), BatchedMesh (batch origin), far origins
  (roads at the planet centre), buildings' ZREF (I_MATRIX[3], per-instance constant) are all SAFE. w0 clamp [1,1e7] ok.
- Orthographic passes (sun shadows, any ortho camera): vIsPerspective = 0, nothing changes, depth_greater holds (=).
- Audit of all 13 files with custom log-depth shaders + 12 onBeforeCompile: no gl_Position write after
  logdepthbuf_vertex, no custom gl_FragDepth, no gl_FragCoord.z decode, no polygonOffset, no depthFunc other than
  LEQUAL. (launch.ts SHADE_FRAG has the fragment chunk without the vertex one: depthTest/Write off, harmless as before.)
- terrain renderOrder 50: safe; no opaque-queue material with depthWrite off draws before it except the starfield
  (depthTest off, drawn first by design). Fallback path also gets it: changes nothing but tie-breaks.
- BUG (ZEDGE, terrain + water sheet): the 'too close' branch set clip z = -5w. For a vertex BEHIND the eye (w<0) that is
  POSITIVE; the visible part of a triangle reaching behind the camera (every big ground triangle under a low camera)
  then interpolates a rasterised depth up to 1.0 >> the written depth: the promise is broken by up to the whole range,
  and a GPU that rejects early (Apple, any desktop) culls ground near the camera wherever anything was drawn first —
  holes in the ground at the bottom of the screen. Also not rigorous for 0 < w <= 2e mixed triangles. SwiftShader
  would never show it (it does not reject early on a depth-writing shader), so the browser check could not catch it.
  FIX: bound in CLIP space instead: g(w) = w·(2L(w)-1) (= clip z that gives the log depth), extended by its tangent
  -w for w<0 (convex, C1); interpolation of g over a triangle exceeds g by at most G·Δw²/8 with
  G = 2K'(I + I²), I = 1/(1 + max(w_i - e, 0)), K' = K/ln2 (sup of g'' on the triangle), Δw <= e. Vertex z =
  g(w_i) - 1.5·G·e²/8 - 2·MARGIN·|w_i|. Valid for every w incl. behind the eye; same slack as before at w >> e.
- LOOSE: the edge bound e = 3·skirt + 2 m assumed slopes <= ~70°; a cliff or a lava front breaks it (excess slack
  ~ (H² - 1.5e²)/(8w) m: a 50 m cliff edge at 200 m could reject ground ~1 m in front of something). FIX: e is divided
  by max(n·up, 0.3) at the vertex (steep vertices widen their own bound) and grows by the lava depth there.
- Near/far: EXT_depth_clamp turns off near/far clipping in the perspective pass. Near is 0.05 m (camera never that
  close to a surface) and nothing renders past 2e7 m except the star, whose depth clamps to 1 = sky. Accepted; noted.
- Reversed-Z (candidate b) would also give Apple HSR, but needs ~40 edits to every depth decode with a dual path and
  cannot be verified on this box either; conservative depth is central, small and exactly the old path when off
  (no extension / ?zcons=0: chunks untouched, defines unused). Chrome/Mac (ANGLE Metal) exposes EXT_conservative_depth
  + EXT_depth_clamp (Metal [[depth(greater)]], MTLDepthClipModeClamp); Safari may not: then old path, no harm.
- WHAT THIS BOX CAN VERIFY: compile, 0 console errors, identical pictures. NOT the GPU gain (SwiftShader).

- F1b (session 3, landed, compiles, tsc clean): the review fix above. zcons.ts edge path rewritten in clip space
  (g(w) with tangent continuation), terrainvert.glsl.ts `GENESIS_ZEDGE tZEdge` = (3·skirt + 2)/max(n·up, 0.3)
  (+ lava depth, terrainmat VERT_MAIN). JS mirrors tangentClipZ / edgeClipZ in zcons.ts; tests/render-zcons.test.ts
  (random triangles near / far / behind the eye: rasterised <= written for both paths; the old -5w branch fails).
  Browser run: `_harness/scratch/arc/perf/run-r3.sh` (dist3 = UNMINIFIED build, `npx vite build --minify false
  --outDir ...`; town, region, orbit; zcons 1 then 0; shots shots/r3z1-*.png, r3z0-*.png; logs r3z1.log, r3z0.log).
  perf-play.mjs got `--stacks=1`: buffer / texture upload bytes per JS call site (readable with the unminified build),
  and `--heap=1`: CDP allocation sampling over the measured frames, kB/frame by allocating site (GC hunt). NOTE: code
  injected through INIT is a template literal: no backslash escapes in it (a '\n' there broke the whole init script
  and the first r3 run died after 15 min with `__PERFPLAY__` undefined).

- MEASURED (r3z1, dist3, busy town, speed 1, 4 frames): uploads by call site: 14.0 MB/frame = ONE CubeTexture's 6
  faces re-uploaded whole (city lights, 768² RGBA per face on the 3 km world; on SwiftShader every frame because a
  frame takes 30 s > the 6 s rebuild throttle; on a Mac: a 14 MB upload + full mip rebuild + CPU rebuild every <= 6 s
  while the lights change = a periodic hitch); 9.4 MB/frame bufferSubData of instanceMatrix (49.5 meshes/frame);
  7.0 MB/frame NEW buffers (16.5/frame, geometry attributes replaced); 4.9 MB/frame 2D DataTextures (36/frame);
  3.6 MB/frame geometry attribute updates (82/frame). Owners of the buffer churn: next run with `--attrs=1`
  (per scene object: attributes re-uploaded / replaced over the measured frames).
- F2 (landed, tsc clean): citylights.ts uploads only the re-encoded boxes (texSubImage2D per face, ROW_LENGTH = size,
  srcOffset) + one generateMipmap, instead of needsUpdate on the whole cube; falls back to needsUpdate before three's
  first upload. Same texels on the GPU. Renderer calls setCityLightsRenderer(three).

## SIM ASKS

## NEXT

## SESSION 4 (2026-11-11 ~01:30Z, after a container restart; scratch survived, dist4 = unminified build of F1b+F2)
- run-r5.sh: r4 (dist4, town, speed 1, --stacks --attrs --heap: owners of the upload churn), then v5z1 / v5z0 (dist4,
  town,region,orbit, SPEED 0 so the two pictures can be compared, frames 2 settle 6; shots/v5z1-*.png, v5z0-*.png).
- F3 (landed, tsc clean): `src/render/upload.ts uploadPrefix(attr, count)`: instanced pools upload only the written
  prefix [0, count) instead of the whole capacity (three re-uploads the whole array on needsUpdate without update
  ranges). Owners switched: bodies (all 7 per-instance attributes), vegetation, groundcover near + far (cap 6000 =
  384 kB instanceMatrix per mesh), roads lamp posts (both pools), boats, camps. Image identical (draws are bounded by
  mesh.count; the GPU tail is never read).
- r4 MEASURED (dist4 = F1b+F2, busy town, speed 1, 8 frames; r4.log): uploads/frame: 15.7 MB bufSub instanceMatrix
  (84/frame: VEGETATION, 40 buckets re-uploaded at full capacity, twice in 8 frames), 6.1 MB 2D textures (56/frame),
  5.1 MB geometry bufSub (126/frame), 4.6 MB CityLights.uploadDirty (2 calls = TWO WHOLE FACES: the union box of a
  face's lights spans the face once towns are everywhere), 2.9 MB instanceColor, 1.0 MB new buffers.
  Attribute churn by owner: buildings-far / -near BatchedMesh ALL attributes re-uploaded (position/normal/color/uv/
  aKit/index of 1556 + 38 geometries, ~45 MB of arrays) — a FULL RE-PLACEMENT of every building; heap: coverRuins
  15 MB/frame, bankRing 11.6 MB/frame (+ vert/quad/groundOffset under it) = the same re-placement. CAUSE: buildings
  sync() re-placed every building whenever the 'surface' field version moved, and WorldView bumps that version for
  every surface array the sim republishes (snow / soil / ash bumps), even when not one height changed.
- F2b (landed, tsc clean, tests/render-citylights.test.ts): city lights upload only the 32x32 tiles whose encoded
  bytes changed (runs of tiles per tile row); mock-GL test: GPU copy byte-identical to the faces after every
  rebuild, one house's change uploads <= a few tiles.
- F4 (landed): vfx emitter table (5x1024 RGBA32F = 80 kB) uploaded only in a frame that wrote a row (was every frame).
- F5 (landed, tsc clean, tests/ui-groundrev.test.ts + ui-groundgrad green): (a) groundgrad.ts keeps per-cell change
  revisions (cellRev / fullRev / rev, changedSince(rev, cells)): the cells whose height or gradient changed at each
  commit (the dirty list it already computed). (b) worldview.ts: a committed surface that changed no cell bumps NO
  version (nothing downstream rebuilds; the array content is identical); pv.groundRev = the GroundGradients.
  (c) buildings.ts sync: on a ground change only buildings whose cells (footprint + bank/yard reach + 2 cell
  spacings) changed height/gradient, standing water (> 0.25 m either side), or soil/sand/snow cover (roughness) are
  re-placed; the rest keep their records and conformed geometry (no dropOwn, no bank rebuild, no BatchedMesh
  re-add). References move only at a re-check. Vegetation still clears its cache on a real surface change (its
  plants also read crop/road/water/moisture that were only ever refreshed by that clear: kept as it was).
