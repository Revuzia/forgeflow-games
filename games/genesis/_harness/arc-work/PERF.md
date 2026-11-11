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

- v6 (dist5 = F1b..F9, speed 0, town): 0 console errors so far; shots/v6-town.png vs v5z1-town: mean |d| 4.0/255,
  diff-v6-town.png (looked) = tree-crown edges only (wind sway), ground / tree shadows / houses identical. BUT
  shadowTris unchanged (142 calls / 2.04 M): F6 culled nothing in this view — the 3 km world's curvature term
  (dc + r + range)/R plus the 0.2 rad slope allowance pushed the morning sun's bound below 2 deg = draw all.
- F6b (landed after v6, tsc + focused tests + npm run build OK; NOT yet in a browser run): the curvature term now
  uses only the distance that matters: a tree's shadow points away from the sun, so the tree is sunward of the
  receiver; reach = least x with e(1 + cot(el - 0.2 - (dc + r + x)/R)) + 4 <= x (iterated x <- 1.02 f(x) + 0.5,
  verified f(x) <= x, else all). Numbers (e 15 m, R 3 km): 45 deg sun, cascade 150 m out r 100 -> D 300 m (of the
  380 m range: ~40 % of trees left out of that cascade); 25 deg -> D 440 (all); far cascades: all. A modest gain on
  this tiny world; larger worlds gain more. run-r8.sh (queued): gate -> check3.log, then v8 (dist6) town shot +
  shadowTris to compare with v6.

## SIM ASKS

## NEXT (session 4 state; update as runs land)
0. dist5 rebuilt with F9 (~02:5xZ) before v6/r6/r7 started; gate re-run for F9 -> check2.log.
1. Read v5z1/v5z0 logs + shots (F1/F1b zcons 1 vs 0 at speed 0, town/region/orbit, dist4): 0 console errors and
   equal pictures -> F1 verified. Then v6 (dist5, F1b..F8) shots vs v5z1: equal pictures (trees may differ only by
   sway phase); r6: uploads by site + attrs (top 90 now) + heap vs r4; r7: CPU profile self time at speed 1.
2. Full gate: `setsid nohup _harness/slot.sh npm run check > _harness/scratch/arc/perf/check.log 2>&1 &` then
   npm run build. New tests: render-citylights, render-chunkrest, ui-groundrev.
3. Remaining ideas, by expected gain on a Mac: (a) terrain patch building off the main thread (worker builds the
   attribute arrays; transfer; the main thread only copies into the batch) — buildGeometry is ~1 ms a patch here;
   (b) terrain + building shadow casters culled by shadow REACH per cascade like F6 (needs the local minimum ground
   height around each cascade so mountains keep their long evening shadows; the light-box test admits patches up
   to r/sin(el) toward the sun); (c) vegetation: incremental cache invalidation on a surface change (it also reads
   crop/road/water/moisture: diff those arrays per cell, F5-style) instead of clearing the whole cache;
   (d) roads rebuild on every surface / layout change (whole ribbons re-made: ~3 MB garbage a rebuild);
   (e) full-screen pass merging: not worth it by the SwiftShader split (all of them < 5 ms vs 6.6 s geometry).

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
- F6 (landed, tsc clean; browser check in run-r6): SHADOW CASTER CULLING PER CASCADE for vegetation (r4: 150 shadow
  draws / 1.58 M tris a frame = every tree bucket in all 3 cascades, vs 528 k tris in the scene pass). lights.ts
  stores each cascade's slice sphere (centers / radii). vegetation.ts: after a fill each bucket's instances are
  counting-sorted into 48 distance bands from the rebuild camera (binEnd prefix counts; also front-to-back for the
  main pass = better early-Z with F1); Vegetation.shadowCascade(k, centre, r, sinEl, R) draws the prefix of trees
  within dc + r + eMax(1 + cot el') + 4 m of the cascade centre, el' = the camera's sun elevation less the planet's
  curvature over the drawn range less 0.2 rad (slopes falling away from the sun); el' < 2° draws all. Renderer
  perCascade calls it (k < 0 restores counts). The cascade is picked by view depth inside its sphere (no blend), so
  a tree outside that reach cannot shade any pixel reading the cascade: same image. Expected: cascades 0 and 1 draw
  a fraction of the trees by day (~-0.8 M shadow tris on the town view); a low sun draws them all as before.
- TERRAIN AT REST (task 3), tests/render-chunkrest.test.ts: a still camera with fields arriving every 7 frames
  converges (401 patches built by frame ~30 at 16/frame) and then builds NOTHING over 370 frames. The 'still
  streaming at rest' of the busy-town measurement is the convergence itself under SwiftShader: there the 6 ms cap
  admits only BUILD_MIN = 4 patches a frame (a patch build takes > 1.5 ms on this loaded box), so ~380 patches take
  ~95 frames; on a Mac (~0.3-0.5 ms a patch) it converges in ~2-3 s of frames after a cut. RenderStats now carries
  patchesBuilt (all planets) so a probe can check the rest state directly. Off-thread patch building: NOT done (see NEXT).
- F7 (landed): buildings coverRuins (every full sync = every new building) was O(ruins x all standing) with a
  filtered copy; now a cube hash (cube >= the largest pair reach, 27 neighbours): same pairs, same result.
- F8 (landed, tests/render-chunkrest.test.ts 'reused scratch' = byte-identical attributes): terrain buildGeometry's
  21 working / attribute arrays (~0.4 MB a patch) are kept on the ChunkLOD and zeroed per build; attributes view
  them (BufferAttribute, no Float32BufferAttribute copy); PatchBatch.alloc copies into the batch as before. Node
  profile of 401 builds before: GC 105 ms of ~400 ms terrain time (the largest single item).
- dist5 = unminified build of F1b..F8 (rebuilt 02:1xZ); run-r6.sh (v6 shots at speed 0 + r6 owners at speed 1) and
  run-r7.sh (CPU profile, speed 1) queued behind run-r5.
- GATE (02:2x-02:5xZ, through slot.sh, tree with F1b..F8): npm run check = detban + typecheck + 889/889 tests pass.
- v5z1 (dist4, zcons=1, speed 0): town / region / orbit, 0 console errors; shots v5z1-town (looked: same as the
  pre-F1 b0-busy-town but the settlement label 'Saal by the Lake' is cut where the HUD panel overlaps it — a UI
  stacking difference vs the Nov-10 build, not render; check v5z0), v5z1-region (looked: fine).
- F1 VERIFIED (town): v5z0-town vs v5z1-town (zcons off / on, same save, speed 0): diff image shots/diff-v5-town.png
  (looked): mean |d| 3.7/255; the only structured differences are tree-crown edges (wind sway keeps running at
  speed 0), the HUD panel's blurred backdrop of those trees, and frame grain. Ground, roads, houses, shadows:
  identical; no holes. 0 console errors with zcons on (v5z1 all three scenes).
- F9 (landed, tests/render-vegcache.test.ts; mutation check: dropping 'water' from the diffed inputs makes it fail):
  vegetation no longer drops its whole plant cache at every surface version. groundChanged(): cells within two
  rings of a cell whose ground (pv.groundRev) or any other read field (water, temperature, moisture, snow, crop,
  road, sand, soil, shrubSpecies; diffed against the arrays of the last check) changed are dropped; cells first
  built since the last check from other input arrays (an epoch per array replacement) go too. Kept cells equal a
  fresh scatter exactly (test, 4 rounds of random height + water changes).
- F1 VERIFIED (all three scenes): v5z0 vs v5z1 region mean |d| 0.8/255, orbit 0.6/255 (48 px > 24 each: grain /
  cloud motion), town see above; 0 console errors with zcons on AND off. Shots looked at (town, region, orbit).
- GATE 2 (after F9, slot.sh): npm run check 890/890 pass; npm run build OK.

## SESSION 5 (2026-11-11 ~03:15Z)
- Queue at start: v6 (dist5) town done (see above), region/orbit still running; r6, r7, then run-r8 (check3 gate
  running in slot 2, then v8 on dist6) queued behind it.
- F10 (landed, tsc clean, tests/render-patchworker.test.ts + render-chunkrest + render-chunkpool green): TERRAIN
  PATCHES BUILT OFF THE MAIN THREAD. src/render/planet/patchbuild.ts = the patch vertex build as a pure function
  (PatchBuilder; no three.js), patchbuild.worker.ts = the worker (one or two shared workers: 2 when
  hardwareConcurrency >= 6, least-loaded dispatch; `?patchworker=0` = old path). ChunkLOD (opts {seed, port}):
  a patch past level 1 that the view needs is ASKED for (<= 32 in flight per planet; the four children of a split
  together) and its parent draws until it lands — the same rule as the old per-frame budget running out, so the
  converged image is identical; landing = the batch copy only, under the frame's time cap. Output buffers are
  transferred both ways (recycled: no per-patch garbage on the main thread). Levels 0-1 (the always-drawn base)
  still build on the main thread once. Same bytes: the builder's output hash equals the pre-move chunks.ts output
  (8181fda4, _harness/arc-work/perf-golden.ts run BEFORE the move), and an in-process structuredClone worker port
  converges to the same selection with byte-identical batch contents (terrain + water slots) while the main thread
  builds <= 100 (levels 0-1) patches. planetview passes { seed: pv.seed }.
- F10b: during a camera cut's frames (budget 320) the worker is asked for the whole new view at once (in-flight cap =
  max(32, budget)) instead of the main thread building up to 320 patches in the cut frame (a ~100+ ms stall on a Mac).
  The cut shows the coarser parents for the few frames the workers take, then the same converged mesh.
- F11 (landed, tsc clean, tests/render-shadowreach.test.ts: 20 000 random casters on circles of 1.5-30 km, exact 2-D
  shadow ray vs the bound; capGap vs sampling): TERRAIN + BUILDING SHADOW CASTERS CULLED BY SHADOW REACH per
  cascade. shadowreach.ts: reach = least x with e·cot(el0 − (d0 + x)/R) + margin <= x, e = caster top above the
  LOWEST GROUND near the cascade (ChunkLOD.groundFloorNear = min hMin of the selected patches meeting the cascade
  sphere), el0 = the sun's elevation at the camera, d0 = the caster's far distance from the camera; el <= 2° -> draw
  all (mountains keep long evening shadows). Terrain (ChunkLOD.shadowCascade) and the buildings' shadow batch
  (BldBatch.cullShadow: per-instance body-frame spheres kept at add(); slots hidden by dropGeom stay hidden) draw a
  caster only if its ground gap to the cascade sphere <= reach AND it is not wholly nearer than the previous split
  less (reach + e + margin). This REPLACES the terrain's old fixed margin (40 m relief / tan el, capped 450 m),
  which was too short for a taller ridge at a low sun (its far-cascade shadow could be cut off). `?reach=0` = the old
  rule (A/B shots). perf-play.mjs got low-sun scenes: regionlow, townlow, ridgelow (poi 'peak'), `--hour=`.
- F12 (landed, tsc clean, tests/render-roadkeep.test.ts): INCREMENTAL ROAD REBUILDS. roads.ts: each chain's ribbon is
  cached under a 64-bit hash of everything it reads (samples, wear, dense mask near the camera, dead ends, tier/era,
  the footprints near it, ground height/curvature/soil/sand/snow and water of its cells + 2 rings); a rebuild only
  re-makes chains whose key changed and concatenates typed arrays (was: every chain re-made in number[] arrays, ~3 MB
  garbage, + computeVertexNormals over the whole ribbon). Normals per chain = three's over the whole ribbon (chains
  share no vertex; test). Each chain also tests only the footprints near it (was rows x ALL footprints for inside /
  housed: O(rows x buildings) per rebuild); same answers (test: local vs all footprints byte-identical). Test runs a
  kept-chain Roads beside a rebuild-everything one through ground / house / camera / water+wear changes: byte-
  identical after every step, lamps too (27 of 80 chain builds kept on that tiny town; a real town keeps nearly all
  chains on a layout tick). Mutation checks: dropping water or the surface height from the key fails the test.
  NOTE (node assert): assert.deepEqual on two 20 k-element typed arrays that differ OOM-killed node (its diff);
  compare element-wise.
- F10c (after v9 showed it): the worker path first descended ONE level per frame (a split waited for its four
  children to land): v9 (dist7) had 180 patches drawn at rest vs 380 = coarse ground poking through the roads. Now the
  worker path walks the whole wanted tree from the bounds alone each frame and asks for every missing leaf at once; a
  subtree draws when fully covered by built patches, else its nearest built ancestor (never a parent with partial
  children). In-flight cap 192 (2x the budget on a cut). Landing keeps a time cap also in cut frames (8 ms).
  Test: same selection + bytes as the main-thread path; converges at frame 10 vs 53 (in-process port, 64 replies a
  frame). The sync path (no worker) is unchanged code.
- v11 (dist8 = F10..F12 + F10c, town, speed 0, 0 console errors): gpuPatches 379 (v6 380: converged), shot
  shots/v11-town.png LOOKED: same as v6-town (roads intact, trees, houses, shadows). Main-thread 'planets' slot 1.97 ms
  /frame (v6 9.6), buffer uploads 78 kB/frame (v6 2.5 MB), patches built 567 (v6 1061). BUT shadowTris 2.41 M (v6
  2.04 M): F11's near-split test is honest about relief (floor = lowest ground of the WHOLE cascade sphere, lake beds
  included) where the old 48 m margin was not. Tightened after v11 (not yet measured): the floor counts only patches
  reaching beyond the previous split (only they hold pixels that read the cascade).
- PARKED here for the owner's new priorities (perf report, pop-in, white flashes). Queued on dist8: l11 / l11r0 (low
  sun A/B: regionlow, ridgelow), r11 (uploads/attrs/heap speed 1), r12 (CPU profile speed 1).

## SESSION 5b — OWNER FEEDBACK on the CDN build (45fa77f6): "still quite choppy but a bit better ... glitches where
## everything turned white ... trees populate as i looked in the area". New order: (1) in-game perf report from his
## Mac, (2) no pop-in, (3) white flashes, (4) back to smoothness.
- P1 PERF REPORT (landed, tsc clean, tests/render-perfreport.test.ts): src/render/perfreport.ts PerfRecorder, wired
  into perfmon (begin/end/frameStart/frameEnd hooks, one branch when not recording). Overlay (Shift+F12 / ?perf=1)
  has "Record 20 s" and "Copy report" (clipboard, else a selected textarea for Cmd+C; presses on the bar do not reach
  the world). Report: frame p50/p95/p99/max, >20/>33/>50 ms counts, main-thread ms by slot (mean/p95), GPU ms per
  pass group (planets, actors, shadows, scene, post) via EXT_disjoint_timer_query_webgl2 (disjoint-safe; "no timer
  query in this browser" otherwise), draws/tris/shadow tris, patches built, new programs, camera altitude range and
  travel, sim speed, long tasks, the 12 worst hitches with their top slots / GPU ms / draws / patches built / new
  programs / altitude / camera travel / overlapping long task, and the worst interval per second; header: GPU renderer
  string (WEBGL_debug_renderer_info), preset, canvas + css + render size, DPR, zcons state, UA, cores.
  Test surface: __GENESIS__.perfReport(ms) -> text.
- P2 POP-IN — analysis so far (NOT fixed yet; NEXT session starts here):
  (a) TREES: vegetation.ts update() keeps real tree instances only within `range` = 380 m x vegetationRange of the
      camera (3-D distance), faded over 0.72..1.0 range, and hidden entirely above alt range*1.2. Zooming down from
      ~450 m the tree disc GROWS around the camera = "trees populate as I looked". Beyond range only the terrain's
      forest colour shows. Fix candidates (no quality loss): a far-tree layer (instanced billboard/impostor or low LOD
      crowns) out to the terrain's visible distance, faded in where the near trees fade out, and/or a range that
      grows with altitude so the near/far seam is never on screen; keep the colour of the far layer matched.
  (b) Bucket capacity: `if (bA.count >= capacity) continue` drops trees in cells order (not distance) when a LOD
      bucket is full: check capacities on the busy town (stats) — a full bucket loses trees silently.
  (c) Rebuild cadence: the whole instance list is rebuilt every 4 % of range moved (15 m) or 240 frames, all
      cells within range+60 synchronously (cellPlants for new cells) — a main-thread spike during camera moves.
      Candidate: incremental per-cell instance lists / time-sliced fill of new cells in a ring BEYOND range.
  (d) Terrain: the worker path lands patches a frame or few after they are wanted; NEXT: prefetch (ask for the
      children of leaves within ~1.3x their split distance, not drawn) so patches exist before the split.
  (e) Groundcover (groundcover.ts), buildings near/far (has a fade), crowds: same review.
  Repro: perf-play scene sequence descending over a forest (alt 900 -> 150 m, shots each step), ?perf=1.
- P3 WHITE FLASHES — candidates to test (NOT done): camera inside the cloud shell (cloudInner..cloudOuter =
  R + 0.3..0.7 thickness), exposure adaptation after a cut / bright event (post.cutExposure), NaN/Inf in an HDR
  target spread by bloom, zcons/depth clamp (A/B ?zcons=0). Repro: scripted zoom orbit -> town through cloud
  altitude; add a NaN-safe guard at the tonemap/bloom input.

## SESSION 5c (10:30Z, after another container restart: check5 / r11 / r12 / l11 all died; re-queued)
- run-r13.sh: dist9 (unminified, P1 + F10..F12) then d13: a descent over a forest f1200 -> f600 -> f350 -> f200 -> f120
  (each flown with blend 1.5 s from the last), shots EARLY (2 frames after the move: what streams in) and settled,
  ?perf=1 overlay visible, the in-game report printed per scene (perf-play --report=MS, --early=N, scenes f*).
- P2 fixes landed (tsc clean; browser check pending):
  (a) vegetation.ts prefetch(): the plants of every cell within 1.35 x range + 60 m are scattered ahead, nearest
      first, ~2 ms a frame, from 2.5 x range of altitude down — the frame that first draws a cell finds it cached (it
      scattered every cell in range in one frame on arrival: the descent's long frame).
  (b) groundcover.ts prefetchCover(): one cell a frame within range + 80 m from 1.5 x range + 150 m of altitude,
      BEFORE it is drawn (it built two a frame once already on screen: the grass and stones filled in cell by cell
      in front of the player — "populate as I looked").
  (c) chunks.ts worker path PREFETCH: a built leaf within 1.35x its split distance has its four children asked for
      ahead (not drawn) while fewer than 96 builds are in flight; the split then finds them ready.
  NOT yet: a far-tree layer beyond the 380 m tree range (the tree disc still grows around a camera coming down
  from ~450 m — designed LOD range with a 0.72-1.0 fade; see P2 analysis above), vegetation instance refresh cost.
- P3 fixes landed (tsc clean; browser check pending):
  (a) clouds.ts: a camera crossing the cloud deck fast (vertical speed > 0.15 deck thickness/s; zooming orbit ->
      town crosses it in a fraction of a second) opens a clear tunnel: near-zone radius 35 m -> up to 450 m with the
      speed, in-cloud fog faded; closes over ~1 s once the camera lingers (hovering in a cloud still fogs). Every frame
      inside the deck was a full white-out before (the in-cloud fog is designed "white-out when deep").
  (b) pipeline.ts: exposure adaptation and tonemap are NaN/Inf-safe (a bad target or history used to stick until a
      cut: whole-screen white or black); bloom / luminance inputs already had sane().
