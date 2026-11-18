# PERF ledger (performance engineer, 2026-11-10) — owner: "keep the high quality but ensure the game isnt so choppy"

## FOR THE OWNER (short)
- WHAT WAS SLOW: the GPU shaded every hidden pixel (no early depth test: the costliest terrain shader ran under every
  tree and house), every tree was drawn into all three shadow maps, and the main thread kept rebuilding things that had
  not changed (all 1 600 buildings re-placed when any ground value was republished, whole city-light cube textures
  re-uploaded, tree caches dropped, terrain built 16 patches a frame on the main thread, roads rebuilt whole).
- WHAT IS FIXED: early depth test restored without changing the picture (conservative depth); shadows skip casters
  that cannot reach the shadowed area; only changed buildings / light tiles / plant cells / road chains are rebuilt;
  terrain is built on helper threads (main-thread planet work at rest 9.6 -> 2.0 ms a frame here, uploads 2.5 MB ->
  80 kB a frame); grass, plants and terrain detail are prepared before they come into view; flying fast through the
  cloud deck no longer whites out the screen; exposure can no longer get stuck white or black.
- NEW (session 6, in the source, not yet on the CDN, not yet seen in a browser): FAR TREES — every tree of a forest
  is now drawn at every altitude (the same trees: same places, species, sizes, colours), as a cheap shape past
  ~270 m that takes over from the full tree without a pop, fading into the ground's forest colour only where a tree
  is a few pixels tall. No more disc of trees growing around the camera. Trees also no longer re-scatter a whole
  area whenever the forest map updates, and nearby trees are re-placed by copying instead of recomputing.
- STILL TO DO: browser screenshots of the far trees (descent 2 km -> 50 m), the cloud / white-flash check, grass
  preparation off the main thread. Please still send the Shift+F12 "Record 20 s" -> "Copy report" text.
- SESSION 7 (your M5 report, thank you — it is the first real data we have): 3 fps near a town on Ultra; the main
  thread was blocked ~300 ms a frame, 206 ms of it inside the shadow pass. Found and fixed so far: (1) a real BUG —
  the simulation rebuilt and sent the whole world to the screen 30 times a second although at 1x it changes once a
  second (now only when something changed: ~25x less work on both threads); (2) the ground's draw tables were
  re-uploaded to the GPU in the middle of every shadow / scene pass, dozens of times a frame — the kind of thing a
  Mac's tile GPU pays dearly for and our software test GPU does not show at all (now once). (3) The report now also
  times every GL call by pass, so your next "Record 20 s" will say exactly where the remaining time goes. Not yet
  seen on a real Mac: please record again on the next build (Ultra, and once with ?zcons=0 and once on High).
- WHAT TO EXPECT ON A MAC: fewer and shorter hitches when moving the camera and while towns grow; the same image.

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
- d13 (dist9, ?perf=1, descent over a forest; LOOKED at f1200, f600-early, f350-early, f350): the overlay shows its
  "Record 20 s" / "Copy report" bar; the in-game report printed per scene (GPU renderer string, timer yes, GPU ms per
  pass group, hitch lines with slots / GPU / patches / long tasks) — P1 VERIFIED end to end (SwiftShader numbers are
  meaningless as speed, the plumbing is what was checked). Report line 'worst per s' now capped at 30 buckets.
  f350-early (2 frames into the 1.5 s flight, camera still ~450 m up): forest = green carpet, NO trees; f350 settled
  (camera arrived): trees within ~380 m. THIS IS THE OWNER'S "trees populate": the tree layer is off above
  1.2 x range (456 m) and drawn only within range (380 m) of the camera, so coming down, a disc of trees switches on
  and grows outward. Not a streaming delay (cells are now prefetched). FIX = P2 NEXT #1 below.
- GATE (check6, through slot.sh, tree with everything above): npm run check = detban + typecheck + 898/898 tests;
  npm run build OK. (check5 had one failure, render.test 'ground cover ... no cell dropped': the prefetch ring adds
  cells, so the cache may grow; the assertion is now >=.)

## NEXT (session 6), in order
1. P2 FAR TREES (the owner's pop-in): a far-tree layer from ~0.7 x range out to the terrain's visible distance
   (cheap instanced crowns / octahedral impostors per species, placed from the same cellPlants records — so the trees
   that come near are the same trees), crossfaded (dither) with the near layer's 0.72-1.0 fade band, shown at every
   altitude where the forest covers more than a few pixels; no density or range lowered. Check the GPU cost with the
   report's gpu ms. Then remove the alt > 1.2 x range switch-off (the far layer covers it).
2. Ask the owner for a report: Shift+F12 -> "Record 20 s" while zooming orbit -> town and panning a town, then
   "Copy report" (also ?perf=1). Its gpu ms per pass group says GPU- or CPU-bound and which pass.
3. Browser-verify P3 (cloud tunnel) with a fast scripted zoom through the deck (shots inside the deck at speed), and
   F11 at low sun: l11 / l11r0 (regionlow, ridgelow; reach on/off) and r11 (uploads/heap) / r12 (CPU profile) from
   run-r11.sh were killed by the restart: re-run on a fresh dist. Compare shadowTris vs v11 (2.41 M) after the floor
   tightening.
4. Vegetation instance refresh (every 15 m moved: the whole instance list) -> incremental; groundcover cellItems
   (~20 ms a cell on this box) off the main thread.

## SESSION 6 (2026-11-11 ~12:00Z) — far trees first (owner: "trees populate as i looked in the area")
- d13 (dist9) was still running at start (f200/f120, 1.5 h in a slot; could not be stopped from here): left to finish.
- F13 FAR-TREE LAYER (landed, tsc clean, tests/render-fartrees.test.ts 3/3 + render-vegcache green; browser check next):
  * src/render/life/farcrown.ts: per tree kind / variant a HULL fitted to the tree's own LOD-2 mesh (lathe through
    the crown silhouette at 82nd-percentile radius; lod 0 = 5 sides, 3 rings + top + 3-sided trunk, <= 24 verts;
    lod 1 = 4 sides, 2 rings + top, <= 10 verts; INDEXED). Same vegetation attributes: aCard 0.5 = solid foliage,
    colour = the LOD-2 leaf vertices' mean x the leaf-atlas tile mean (canvas pixels, opaque texels) x 1.7 / 0.92,
    so the shader's own lighting / tint / snow / char / cloud + sun shadows apply unchanged.
  * vegetation.ts: plantInstance() = THE per-plant matrix / tint / extra (refactored out of the near loop; near uses
    it too), so a far tree is the near tree (same position, lean, yaw, height, girth, species tint, autumn, snow,
    char). Per cell a far BLOCK (trees only, grouped by kind/variant) is made once; blocks are PLACED into far
    buckets' slot ranges (free list, high-water mark, zeroed = degenerate when freed, range uploads, compaction
    under 25 % live, grow x2) as cells enter / leave; changed inputs re-make only the cells around them.
  * Shader: vLod is now an INTERVAL [x, y) of the object-space chunk hash (was value + sign; same results for the
    near LOD bands). Near trees with the far layer on give their chunks away across the 0.72..1.0 x range band
    (no more shrinking into the ground); the far hull takes exactly the complementary chunks ([1-s, 1)), hull lod
    0/1 split the far share across 12..18 px of tree height, and the far tree gives way to the terrain's canopy
    shading at 3..6 px of height (FAR_PX; px = height x pxPerRad / distance, pxPerRad from the real render height
    and FOV). Shadow pass uses the same vertex code: shadows cross-fade with their trees. Off-screen far trees cost
    one degenerate vertex (no cloud lookup).
  * Near trees no longer switch off above 1.2 x range altitude (the far layer covers every altitude).
  * Field changes: tree / shrub / burnt / treeSpecies republishes no longer clear the whole plant cache (every cell
    in range re-scattered in one frame): the arrays are diffed, cells within 2 rings of a change re-scatter (near)
    and their far blocks are re-made; snow / fire diffs re-make far blocks within 1 ring (tints).
  * Main-thread budget: listing (re-scan of the forest cells above the horizon, every 6 % of altitude moved) spread
    at 1.5 ms a frame; placement changes + block making 3 ms a frame, nearest first, with 15 % admission slack.
  * `?fartrees=0` = the old path (A/B shots).
- BENCH (node, _harness/arc-work/perf-fartrees.ts, 40 962-cell world, synthetic dense forest ~60 % cover, 888x500
  High pxPerRad 536, this box at load 5): far instances 140 k at 2 km altitude (2.2 M tris incl. off-screen ones,
  which are degenerate), 70 k at 50 m (1.6 M); cold fill of the whole visible forest from 2 km: ~400 frames in the
  background at 3 ms. Smooth fast descent 2000 -> 50 m in 240 frames: far part max 6.1 ms/frame (p50 0.09); pan at
  50 m: far max 1.9 ms; climb: max 15.5 (a bucket growth). The remaining ~10 ms frame max is the NEAR rebuild
  (every 15 m: whole instance list) = item 5.
- F14 NEAR TREES INCREMENTAL (landed, tsc clean; render, render-warm, -plantregistry, -wildplants, -clocks, -vegcache,
  -fartrees green): a near rebuild (every 15 m moved) no longer re-makes every plant's matrix / tint / extra and
  samples four fields per plant: each cell's instance data is made once with its plants (nearInst, keyed by the
  cell's plant record) and copied; re-made with the cell's plants, a season step, a hemisphere change, or a snow /
  fire change around it (the field diff). Same numbers (plantInstance is the one function).
- s6a queued (run-s6a.sh: dist10 = unminified build of F13 (built before F14), then perf-descent.mjs descent + zoom, fresh world,
  ?farbudget=400 so SwiftShader's slow frames still fill the far blocks; shots shots/s6a-d*.png, s6a-z*.png).
- s6a FINDING: the fresh sandbox world at speed 0 has NO forests (s6a-d2000-early.png LOOKED: bare brown/grey land,
  lakes, clouds) — the descent must run on the busy save (world25.gnss: --save=$P/world25.gnss, + seed=1234), which
  costs ~10-30 min a frame under SwiftShader. s6a (dist10, fresh) is still running its zoom phase after the descent
  (useful only for the white-frame luminance check, phase zoom); run-s6b.sh queued behind it: v13f0 / v13 (busy
  town shadow tris far off / on — compare v13f0 with v11's 2.41 M and v6's 2.04 M), l13 / l13r0 (low sun, FRESH
  world: shadows of mountains only), s6pre (useless: fresh world), r13 / r14 (speed-1 AFTER table + CPU profile,
  NOTE farbudget=400 in them: read far-block costs out of the profile separately).
- Grass cellItems (~20 ms/cell): a lattice of ~(1.6 spacing / STEP)^2 points per cell, each a grid locate + ~12 field
  samples; a worker port needs grid + 14 fields + ground + tower sites + the wild-plant registry (not started).

## NEXT (session 7), in order
1. Descent shots on the BUSY save with far trees: perf-descent.mjs --save=_harness/scratch/arc/perf/world25.gnss
   --extra="seed=1234&farbudget=400" --phase=descent --steps=2000,1400,800,500,350,200,50 --settle=3 (then the same
   with fartrees=0 for BEFORE). LOOK for: forests at 2 km, no disc at ~380 m, hull colour vs near trees in the
   270-380 m band (tune farcrown.ts aCrown 0.8 / percentile 0.82 / colour if the far band reads lighter or darker).
2. Zoom phase luminance: python PIL mean luminance of shots/s6a-z*.png (white frame = mean > ~0.85 or a jump).
3. v13f0 shadowTris vs 2.41 M / 2.04 M; l13 vs l13r0 shots (mountain shadows kept).
4. r13 / r14 tables vs r4; the owner's Mac report overrides everything.
5. Grass cellItems in a worker (see above); far-block making could move there too (same inputs).

## SESSION 7 (2026-11-11 ~15:30Z, container restarted at 15:32Z; scratch survived)
- Started: gate check7 (slot), dist11 = unminified build of the session-6 tree, run-s7.sh queued (s7f1 descent+zoom busy
  save far trees on; s7f0 far trees off; s7l1 / s7l0 low sun reach on / off; all busy save, farbudget=400).
- OWNER LEAD (coordinator, top priority): "VALE runs VERY smoothly ... maybe something in the code or some kind of
  bug" (MacBook Air: fanless, integrated Apple GPU, thermal throttling). Hunt a BUG, not scene load.
  (Valebound's source is NOT in this repo: games/valebound holds only game_meta.json — no code diff possible.)
- BUG B1 FOUND + FIXED: THE SIM WORKER REBUILT AND SENT THE WHOLE WORLD 30x A SECOND FOR NOTHING. simclient.pump asks
  for a snapshot every 33 ms (one in flight); the worker answered EVERY request with a full renderer view: people,
  animals, buildings, settlements (perf-snap.ts on world25: build 8.5 ms in the worker, 233 kB structured-cloned to the
  main thread, then WorldView.apply + every consumer's diff of new block objects: buildings syncStates over 1 671
  buildings, crowds / animals 'fresh' passes). At 1x the world changes ONCE A SECOND (1 tick/s): 29 of 30 snapshots were
  byte-identical (JSON-equal, checked). Cost: ~255 ms/s of a worker core (a fanless laptop heats on it -> throttles the
  GPU too) + ~30 deserialisations/applies a second on the main thread (r-era measure: apply p95 2.7 ms, clone p95 1.8).
  FIX: worker.ts counts 'mutations' (a completed tick; any message but snapshot / parse); a non-full request with no
  mutation since the last full snapshot and no field due (changed and past its 100 / 500 ms send interval) is answered
  { type: 'same', tick, speed, achievedSpeed, msPerTick }; simclient (onSame -> receiveSame) updates the clock values
  via WorldView.applySame (snapAt, speed, achieved, msPerTick; no block replaced, so nothing downstream re-reads).
  Full requests, loads, rewinds (resetSent) always build. MEASURED (perf-snaprate.ts, real worker host in-process,
  busy save, 1x, 10 s, 30 Hz asks): 11 full snapshots (10.4 ms each = 11 ms/s) + 258 'same' — was ~300 full = ~3 s of
  worker CPU per 10 s. Test tests/ui-snapsame.test.ts (same / step / query / speed / full / parse cases).
  NOTE (lanes): worker.ts is sim-lane; the change is host-side only (no sim logic, determinism untouched), additive.
- Checked, NOT bugs: one rAF chain (start() once, loop re-arms itself; stop() cancels); hidden tab renders nothing;
  readPixels only in photo-mode depth (app.depthAt <- ui/photo.ts), readMeter (probes/dev HUD only), the GPU probe at
  boot (detectQuality); no per-frame getError / checkFramebufferStatus / finish; sim worker paces by timers (1x = one
  tick a second, 50 ms idle checks when paused, setImmediate/MessageChannel only while behind); renderer options:
  antialias off, msaa 0 on High, alpha off, stencil off, high-performance, DPR min(dpr, 1.5); post targets at render
  size (half-float), bloom / god rays at 1/2 .. 1/4. focus cmd at most every 2.5 s.

## OWNER'S MAC REPORT (2026-11-11, build 1e0d2af4 on the CDN; verbatim as relayed by the coordinator)
```
GENESIS perf report v1 · 20.3 s · 65 frames
gpu: ANGLE (Apple, ANGLE Metal Renderer: Apple M5) | preset ultra | canvas 1686x872 (css 1349x698, render 1686x873) | dpr 1.25 | zcons on | timer yes | Chrome 157 | cores 10
frame ms: p50 320.4 p95 693.5 p99 760.2 | fps 3.2 | >50ms 58 of 65
main ms: mean 302.5 p95 506.4 max 763.1
main by slot (mean/p95): planets 15/63.6 godfx 0.1/0.2 actors 0.1/0.2 shadows 206.1/489.9 scene 5.8/0.7 post 74.6/341.9 audio 0.1 ui.post 0.5 other 0.1
gpu ms (mean/p95): planets 0/0 actors 0/0 shadows 36/257.1 scene 448/556.1 post 490.1/882.8 | total 974.2/1439.6
render: draws 227 (max 295) tris 13.4M shadow 8.9M | patches built 7462 | new programs 0
camera: alt 80-197 m, travelled 11158 m (fast panning near a town) | sim speed 1
hitches (sample): main 476 [shadows 331 planets 87 post 57] gpu 1143; main 351 [shadows 314 ...] gpu 722; main 225 [post 214] gpu 1240; one frame main 6 ms but gpu 816 (pure GPU).
From orbit it was fine. Vale in the same Chrome tab on the same M5 holds 75 fps (13.3 ms frames).
```
Coordinator's reading: (1) post 490 ms GPU = a pathological pass on ULTRA; (2) shadows 206 ms main = CPU (culling?) or
a stall; (3) scene 448 ms GPU, 13.4 M tris / 8.9 M shadow tris: does zcons help or hurt on Metal; (4) 7462 patches.
- GATE check7 (tree = session 6 + B1 mid-run): 900/901; the one failure was B1's protocol change (tests/worker.test.ts
  'worker protocol round trip' waited for a 'snapshot' where the worker now answers 'same'): the test's client maps
  'same' to an empty snapshot and asserts it (worker.test green). Full gate to re-run at the end of the session.
- READING OF THE M5 REPORT (analysis; not yet verifiable here):
  * The GPU timers cannot be itemised further: their sum (974 ms) exceeds the frame interval (p50 320 ms), so on
    ANGLE-Metal the TIME_ELAPSED spans overlap (command-buffer granularity). The report now says so when it happens.
  * Main thread 302 ms of a 312 ms frame, 206 in 'shadows': the shadow pass is the FIRST pass of the frame that draws
    the terrain batches, trees, buildings, so every lazily uploaded buffer / texture of the frame (three uploads at
    first draw) is uploaded INSIDE it, between draws into the shadow atlas. On a tile GPU an upload into a resource
    the current or an in-flight command buffer uses makes ANGLE either end the render pass (store + reload every
    attachment: the 4096^2 atlas on Ultra) or copy / wait; on SwiftShader none of this costs anything. Suspects by
    volume while panning fast (11 km in 20 s, 7 462 patches): terrain PatchBatch slots (140 kB each, sub-range
    uploads into pools of tens of MB), BatchedMesh visibility textures re-uploaded per cascade (setVisibleAt per
    cascade), vegetation / far-tree instance ranges, field textures.
  * P1b (landed): the perf report TRACES GL CALLS while recording (perfreport.ts GlTrace; `?gltrace=0` = off): main-
    thread ms inside each call, per slot, with bytes, framebuffer switches per frame and UPLOADS ISSUED INSIDE A PASS
    (after a draw into the bound framebuffer). The owner's next report itemises where the 206 ms go. Test
    tests/render-gltrace.test.ts. perf-play.mjs `--panreport=MS` records the report DURING the panned frames.
- F15 (landed, tsc clean, tests/render-batchtable.test.ts + chunkrest / patchworker / chunkpool green): TERRAIN BATCH
  TABLE UPLOADED ONCE. three's BatchedMesh.onBeforeRender sets `indirectTexture.needsUpdate` at every draw whose
  visibility changed — for the terrain + water batches (one per LOD level) that is every shadow cascade (F11 changes
  slot visibility per cascade) and the scene pass: up to ~(levels x 2) x 5 texture uploads a frame, each issued in the
  middle of a render pass. A patch slot's instance matrix is the identity and the batch has no per-instance colour,
  so the table's content (draw -> instance) cannot change a pixel; PatchBatch now restores the texture's version after
  onBeforeRender once it has been uploaded (a grow re-creates it: uploaded again). The multi-draw start / count lists
  (CPU arrays passed with the call) still follow every pass. Same image by construction.
  NOT done: the buildings' 4 batches (perObjectFrustumCulled + sortObjects + per-cascade cull) upload their table at
  every pass too (4 x 5 a frame); their per-instance state is indexed through it, so it needs per-pass rows (next).
- SOAK (perf-soak.mjs, dist12, twoworlds, 1x, 10 min wall, camera moved every 45 s between town / region / globe /
  forest; soak1.log): programs 179 -> 179 (no shader compiled after load), geometries 14 -> ~34 and textures 65 -> ~80
  (the views' content streaming in, flat after the first tour), heap 26 -> 28-35 MB (sawtooth, no climb), DOM nodes
  ~1 050-1 130, JS listeners 251-256, documents 1, 0 console errors. NOTHING GROWS. (SwiftShader: only ~50 frames in
  10 min, so this covers wall-time / tick-driven growth, not per-frame growth over thousands of frames.)

## OWNER A/B (M5 MacBook, Chrome, same seed, 'Rubolhin by the Lake', 20 s panning / zooming at 90-197 m; relayed)
| run | fps | frame p50/p95 | GPU ms mean | main shadows/post (mean ms) | tris |
| ultra baseline | 2.7 | 387/760 | 1218 | 244/105 | 13.4M |
| ultra ?zcons=0 | 1.9 | 534/1054 | 1902 | 230/260 | 15.3M |
| ultra ?reach=0 | 2.2 | 454/974 | 1663 | 292/147 | 11.4M |
| HIGH | 5.4 | 187/361 | 416 | 62/105 | 5.0M |
Coordinator: zcons HELPS on Metal (keep); reach helps a little; even HIGH spends ~416 ms "GPU" and 105 ms MAIN in
post: bugs, not budget. Camera often inside fog / cloud at 90-200 m. Target >= 60 fps on this M5 at Ultra.
My reading: every GPU mean exceeds the frame interval (1218 vs 387 ms): the timer spans overlap on ANGLE-Metal, so
they rank runs but cannot itemise passes; per-pass GPU timers inside post would overlap the same way. The GL call
trace (P1b, main-thread ms inside each GL call per slot + uploads inside a pass) is the itemisation that works there.
- Report header now lists every URL switch (`switches reach=0&zcons=0...`), so A/B runs are self-describing.
- g1u (dist13 = B1 + GL trace, BEFORE F15; busy town, ULTRA, 888x500, speed 1, panned; only 2 frames under
  SwiftShader, so its ms are meaningless — the COUNTS are hardware-independent): 591 draws, 9.3 M tris (7 M shadow),
  53 framebuffer switches / frame, 52 UPLOADS INSIDE A PASS / frame. By slot: shadows bufferData 17 calls / 19 MB a
  frame (NEW buffers created inside the shadow pass: geometry replaced while panning — owner unknown yet), shadows
  bufferSubData 142 calls / 1.1 MB (10 inside the pass), shadows texSubImage2D 4.7 (all inside), scene texSubImage2D
  14.3 (all inside the pass: BatchedMesh tables / DataTextures uploaded at draw), post bufferSubData 35 (9 inside),
  post bufferData 6 / 2.8 MB. On a tile GPU each inside-pass upload can end the render pass (store + reload the
  attachments: the 4096^2 shadow atlas on Ultra) or force a copy / wait -> the main-thread stalls in 'shadows' / 'post'.
- GATE check8 (whole tree incl. B1, P1b, F15, worker.test fix): 903/904; the one failure (ui-thumblate 'an encode
  slower than the wait') is timing-sensitive and passed 2/2 when re-run alone (load ~9 then: a probe + the gate on 4
  CPUs); not touched by this session. npm run build OK (build-prod7.log).

## NEXT (session 8), in order — the owner's M5 is the target (>= 60 fps at Ultra, no quality lowered)
1. Ship the current tree to the CDN and ask for a new "Record 20 s" on Ultra (header now lists URL switches; the
   'gl calls' line itemises main-thread ms per slot per GL call and the uploads inside passes). Decide from it.
2. Find the owners of shadows|bufferData (17 new buffers / 19 MB a frame while panning): perf-play --stacks=1 --attrs=1
   on dist14 with --panreport (stacks names the call site; attrs names the scene object). Candidates: far-tree
   bucket growth (growBucket makes a new InstancedMesh), vegetation / groundcover pools replaced, roads ribbons,
   terrain PatchBatch grow (setGeometrySize re-creates every attribute). Make them sub-range updates of kept buffers.
3. Move every remaining per-frame upload BEFORE the first pass of the frame (no upload after a draw into the same
   framebuffer): buildings' BatchedMesh tables (4 batches x 5 passes; per-instance state is indexed through the table,
   so F15's trick does not apply: per-pass rows in one table texture + a uPassBase offset patched into three's
   getIndirectIndex in buildingmat, filled for all passes before shadows), DataTextures (renderer.initTexture at frame
   start), instance attributes.
4. Then re-measure g1u on dist14 (counts must drop: inside-pass uploads, bufferData in shadows), queue g1h (High).
5. Still queued in run-s7c.sh (dist13): g1h, s7f1 (descent + zoom, far trees on), s7f0 (off). Far trees / white
   frames / low-sun shadows / speed-1 AFTER table: NOT yet verified in a browser (session-6 items 2-5).

## SESSION 8 (2026-11-11 ~16:30Z) — the M5's main-thread stalls: ANGLE-Metal BUFFER RE-ALLOCATION + GC WAIT (by source)
- Read ANGLE main (google/angle src/libANGLE/renderer/metal: BufferMtl.mm, mtl_buffer_manager.{h,mm}, TextureMtl.mm,
  mtl_resources.mm, mtl_utils.mm, DisplayMtl.mm features; copies in the session scratchpad). What Chrome-on-Mac does
  with our calls:
  * gl.bufferData -> a NEW MTLBuffer from BufferManager.getBuffer (reused only at the EXACT same size, once the GPU is
    done with the old one).
  * gl.bufferSubData into a buffer the GPU still reads (Apple GPUs: no shadow copies, useShadowBuffersWhenAppropriate
    is Intel-only) -> putDataInNewBufferAndStartUsingNewBuffer: a new buffer of the buffer's WHOLE size + a blit of
    everything around the range. A 140 kB terrain patch landing in a 10 MB pool attribute = a 10 MB allocation + copy,
    per attribute, per update range.
  * BufferManager: once > 64 MB were freshly allocated since its last GC while buffers are in flight ->
    flushCommandBuffer(WaitUntilFinished): THE GPU PROCESS WAITS FOR THE WHOLE GPU QUEUE, the page's main thread waits
    for the GPU process inside whatever GL call is next to need it (the 300-500 ms 'shadows' / 'post' slots of the
    report: those passes issue the frame's uploads). The GC then drops every cached free buffer, so the next
    allocations are fresh again -> the next wait comes sooner. Steady churn = a full GPU drain every few frames, and
    CPU and GPU no longer overlap (frame = CPU + GPU, not max).
  * texSubImage2D: staged (alwaysPreferStagedTextureUploads) through a blit encoder; ends the current render pass if
    the texture has render work pending in the open command buffer (in-pass uploads = pass breaks, not waits).
  This matches every M5 symptom: main 415 [post 399] / [shadows 497] with trivial JS, worse while panning (terrain
  patches landing: 7 462 in 20 s), worse on Ultra (bigger pools / more instances), fine from orbit (nothing streams).
- P1c (landed, tsc clean, tests/render-gltrace.test.ts 2/2): the report's GL trace also estimates the Metal buffer
  allocations per slot ('metal buffer allocs (est.)': bufferData size + WHOLE bound-buffer size per bufferSubData,
  bindBuffer tracked) and the fresh sizes over the recording. Hardware-independent: our SwiftShader probes show it.
- F16 (landed, tests/render-spanupload.test.ts): on ANGLE-Metal (renderer string 'Metal'/'Apple'; `?span=0/1` forces)
  BufferAttribute.addUpdateRange keeps ONE covering span per attribute: three issued one bufferSubData per disjoint
  range = one whole-buffer re-allocation + blit EACH on Metal. Gap bytes re-sent from the CPU copy (same bytes).
- F17 (landed, tests/render-chunkpool.test.ts 5/5 incl. 'one page layout', render-batchtable / -patchworker /
  -chunkrest green): TERRAIN PATCH POOLS IN FIXED PAGES of 16 slots (PATCH_PAGE; ~2.2 MB a page in all attributes)
  instead of one BatchedMesh per level that grew x1.5 and was rebuilt smaller after evictions. A landing patch now
  re-allocates (Metal) only its page's buffers, all pages of all levels have the SAME buffer sizes (ANGLE's free lists
  recycle them), nothing ever grows or is rebuilt at a new size. Eviction: empty pages dropped (one reserve kept per
  pool), with >= 2 pages' worth of free slots the emptiest page's patches move into the others (visibility kept).
  Draws: one multi-draw per page (Metal emulates multi-draw as a loop of draws anyway: same Metal draw count).
- F18 (landed): putGrowable (upload.ts): ROADS ribbons (7 new buffers of new sizes per ribbon at every rebuild, every
  ~120 m of camera travel) and PARTICLES' instance buffers (4 new buffers at every emitter refresh, every ~150 m or road
  / lamp change: the likely owner of 'post|bufferData') are KEPT at a power-of-two capacity and refilled; draw range /
  instanceCount bound the draw. tests/render-roadkeep (now compares the drawn part) green.
- F19 (landed, tests/render-bldtable.test.ts: drawn set == three's own compaction for a view, a narrow view, a shadow
  cull + ortho light box; table version unchanged across passes): BUILDINGS' BatchedMesh tables: draw i = instance i
  (identity table uploaded once / after a grow), hidden or frustum-culled instances get count-0 draws. Was: 4 batches x
  every pass re-compacting + re-uploading the table inside the pass (pass breaks). Lost: three's front-to-back order
  of buildings (opaque, depth-tested: same image).
- F20 (landed, tests/render-preupload.test.ts): every texture flagged needsUpdate (wrapped Texture.needsUpdate setter)
  is uploaded by renderer.initTexture at the start of the frame in a new perfmon slot 'uploads', before the shadow pass
  (was: at its first draw, inside the shadow / scene pass = a pass break each on Metal). Disposed / loading textures
  skipped. `?preupload=0` = old behaviour.
- Render suite (35 files + ui-snapsame, through slot.sh): 112/112 pass. tsc clean.
- Queued: run-s8a.sh g2u (dist14 = the CDN tree 7cd6ae53, ULTRA, panned, --stacks --attrs --panreport: the per-frame
  bufferData owners + draws by object), run-s8b.sh (dist15 = session-8 tree with ?span=1, v15n town shot speed 0, and
  v14o the same shot on dist14 for the A/B picture).
- CONTAINER RESTART ~20:30Z killed check9 / v15n / v14o mid-run; scratch and src survived; all re-run.
- g2u (dist14 = CDN tree, ULTRA, busy town, panned; SwiftShader: counts only) BEFORE session 8: scene|bufferData 6.5/frame
  18.5 MB = buildings-far BatchedMesh grown (setGeometrySize: new 4-8 MB attributes); buildings-near 38 geometry adds in
  4 frames (6 attributes x 2-4 MB each, ranges); terrain-L4 / water-L4 pools re-created (new attrs 0.5-0.7 MB x 15);
  vegetation-near instanceMatrix 57 buckets re-uploaded whole per near rebuild; particles' 12 field DataTextures
  (256x161) re-uploaded per emitter refresh (now pre-uploaded, F20). DRAWS (GPU load, track B): shadow pass 7.1 M tris =
  vegetation-near 6.17 M in 228 draws (4.0x its 1.54 M scene tris: every near tree in all 4 cascades at full LOD),
  terrain L1-L4 2.2 M, buildings-shadow 0.7 M, far trees 0.47 M. (perf-play --stacks crashed at its print: guarded.)
- GATE check9 (whole tree, slot.sh): 909/909 pass. npm run build OK (build-prod8.log).
- v15n (dist15 = session-8 tree, ?span=1, High, town, speed 0): 0 console errors; shots/v15n-town.png LOOKED vs
  v14o-town.png (dist14, same run args): same huts, trees, tree shadows, cloud shadow, label; both runs show coarse ground
  through the west road after 11 frames (terrain not yet converged under SwiftShader: gpuPatches 185 new / 167 old, v11
  had 379 at settle 10) — the same in both trees, not a session-8 change.

## NEXT (session 8 continued / session 9)
1. Owner's new report on the session-8 build: look at 'metal buffer allocs (est.)' and the slot ms ('uploads' slot new).
   If main still stalls in scene/shadows: buildings BatchedMesh (BldBatch) growth + per-frame geometry adds are the
   largest remaining buffer churn (g2u): pre-size vCap per batch from the town size, page it like F17, or add
   per-building geometries in a staging list landed once per frame.
2. Track B (GPU): near trees in the shadow pass = 6.2 M of 7.1 M shadow tris. Candidates that keep the image: tighter
   F6 reach per cascade (it draws every tree in every cascade here), shadow LOD proxy only where the cascade texel is
   larger than the LOD error (needs a sub-texel proof), per-cascade instance prefix lists instead of 57 buckets x 4.
3. Vegetation near rebuild uploads all 57 buckets whole each rebuild: upload only buckets whose content changed.

## SESSION 9 (2026-11-11 ~21:05Z, after a container restart at ~20:32Z) — build 31cb64e7 (F16-F20) on the CDN
Owner: finish BOTH (1) building / batch buffer churn -> ~0 new buffers per frame while panning and (2) cheap tree shadow
casting with visually equal shadows; a ?switch per fix (default on); the report header lists them.
- SWITCHES: src/render/perfswitch.ts registry; the perf report prints a line `perf fixes (A/B switches, effective):
  bldpage=1 fartrees=1 patchworker=1 preupload=1 reach=1 shnear=1 span=0|1 zcons=1` (every fix's effective value, so a
  run with no URL switch still labels itself). zcons / reach / preupload / fartrees / patchworker / span now register.
- F21 (landed, tests/render-bldpage.test.ts 2/2, render-bldtable / render-warm green; `?bldpage=0` = the old growing
  batch): BUILDING BATCHES IN FIXED PAGES. bldbatch.ts BldPage = one BatchedMesh with FIXED vertex / index capacity
  (2^15 verts, 2^16 indices; 2^14 for the cut batches) + its own instances, state texture and materials (same program
  key: no new programs). BldBatch: geometry ids / slots = page * 2^20 + local id. A new geometry goes into the page last
  written (a frame's adds share one page: F16 merges them into one span), else any page with room, else the page whose
  dropped geometries would free enough is compacted in place (three's optimize: same buffers), else a new page of the
  same size (ANGLE recycles equal sizes). Dropping a page's last geometry keeps it as a hidden 'zombie' until the page
  takes another (three deletes the instances of a deleted geometry). No buffer is ever re-created at a new size; space
  of dropped per-building geometries is reused (three never reused it: the batch grew forever while panning).
  buildings.ts: group.add(b.root), setLayers(), useDepth(). Test: 60 rounds of 30 adds / 30 drops: <= 4 pages, the
  page arrays are never replaced, every page the same sizes, every live geometry's vertices / indices exact.
- g3u (dist16 = CDN tree + F21, ULTRA, busy town, panned; SwiftShader: counts only): NO 'new attr' left in the attribute
  churn (g2u: buildings-far 4-8 MB attributes re-created, terrain/water L4 pools re-created); buildings-far-p5 'upd'
  only (12 range updates of one 2 MB page). Metal estimate 8.4 MB/frame (whole-buffer copies of in-use buffers, mostly
  recycled sizes), FRESH sizes 2.8 MB over the whole recording. NOTE the probe's pan is wall-clock driven: under
  SwiftShader (30-100 s a frame) the camera jumps ~15-27 km a frame (travelled 101 km in 7 frames) = every frame a cut;
  a Mac panning 550 m/s moves ~9 m a frame. Still 16 post|bufferData + 50 shadows|bufferData per frame (new GL buffers
  = attributes three has not seen: new objects / disposed geometry re-made); owners: g4u (--gl=1 --stacks=1, queued).
  Shadow draws g3u: vegetation-near 15.3 M tris / 570 calls in the shadow pass vs 3.8 M in the scene (ultra range 532 m).
- F22 (landed, tests/render-treeshadowcut.test.ts: brute-force crown-point shadows on a 3 km sphere, 4000 trials;
  mutation (reach without the cot term) fails it; `?shnear=0` = off): TREES LEFT OUT OF CASCADES THEIR SHADOWS CANNOT
  REACH BY VIEW DEPTH. A pixel reads cascade k only at view depth >= split(k-1), so at distance >= that from the camera;
  a tree's shadow lies within F6's reach e(1 + cot) + 4 of it; a bucket whose farthest tree (dMax from the rebuild
  camera + the camera's move since) plus reach plus margin (2 m + 3 texels: PCF taps + normal offset) is nearer than
  split(k-1) is skipped in cascade k. Exact (the same bound F6 relies on). Ultra at ~100 m: splits ~176/402/850 m, LOD-0
  bucket (<= ~100 m) only in cascade 0, LOD-1 (<= ~250 m) in 0-1, LOD-2 in 0-2 by day; low sun -> reach grows -> more.
- Queued: run-s9b.sh (dist17 = F21 + F22: v17a shnear=1 / v17b shnear=0, ULTRA, town / townlow / f200 at speed 0:
  shots + shadowTris), run-s9c.sh (g4u: dist17, ULTRA, panned, --gl=1 --stacks=1 --attrs=1 --panreport).

## OWNER'S MAC PROTOCOL RESULTS (build 31cb64e7 = F16-F20, M5, Chrome 157, Retina css 1360x597 DPR 2.5 -> Ultra
## 2720x1194, High 2040x895; babel scenario seed 307987276, town Rubolhin by the Lake; WASD pan, alt 50-137 m, ~11 km)
| run | fps | p50/p95 ms | main mean | GPU total | tris (shadow) |
| ultra | 1.3 | 767/1700 | 590 | 2464 | 28.7M (19.8M) |
| ultra control rerun | 1.2 | 867/1700 | 748 | 2685 | 29.3M (20.4M) |
| high | 3.7 | 267/567 | 129 | 715 | 11.5M (7.6M) |
| ultra span=0 | 1.7 | 567/1250 | 347 | 1870 | 29.1M |
| ultra preupload=0 | 1.9 | 533/1284 | 330 | 1778 | 29.1M |
| ultra fartrees=0 | 1.1 | 800/1800 | 701 | 2393 | 18.2M (11.6M) |
| ultra zcons=0 | 0.9 | 1067/2050 | 885 | 2953 | 27.8M |
Ultra gl trace (main ms/frame in the call): total 543; shadows|bufferData 241 ms x42.9 6.1 MB (inpass 13.4, max 840);
shadows|bufferSubData 135 ms x113.9 7.0 MB (inpass 26.1); post|bufferData 109 ms x35.9 5.1 MB; post|bufferSubData 29 ms
x47 4.1 MB; post|multiDrawElementsWEBGL 27 ms x178; fb switches 46/frame; uploads inside a pass 62/frame; metal allocs
est 15.4 MB/frame (shadows 8.2 MB x58, post 7.2 MB x50). Draws 1402 (~227 before far trees). Frames alternate: main
~700-1200 ms stuck in shadows|bufferData/bufferSubData or post|bufferData, and frames main ~25 ms but GPU 2-4 s.
High: post|bufferSubData 58 ms x59 3.6 MB; shadows|bufferSubData 31 ms x104; metal allocs 13.1 MB/frame.
Vale on the same canvas (2720x1194): 59.9 fps, p95 17.6 ms.
Coordinator's order: (1) owners of ~36 post|bufferData + ~43 shadows|bufferData per frame -> ~0; (2) span=1 /
preupload=1 look HARMFUL on Metal (1.2-1.3 vs 1.7-1.9 fps): rethink (ring buffers) or default off; (3) far trees
~1100 draws + 11 M tris: batch + cut their shadows; (4) per-pass target sizes at DPR 2.5; (5) VISUAL BUG water sheet over
the hills east of the town (trunks as ghosts); (6) white frames through the cloud deck still; (7) '1' key after 1000x;
long press frame-rate independent. Report after 1-2 verified.

## SESSION 9b — acting on the owner's protocol (items 1-2 first)
- v18a (dist18 = F21 + F22 with per-bucket reach, ULTRA 888x500, busy town at speed 0, shnear=1): shadowTris 5.82 M
  (v17a, F22's first version: 8.89 M); vegetation-near shadow 3.86 M vs its scene 2.31 M (1.7x; g3u: 4x). v18b
  (shnear=0, same view) for the picture A/B is queued in run-s9e.sh (shots/v18a-*.png vs v18b-*.png; town, townlow,
  f200). NOT yet compared — next session: LOOK at the pairs (tree shadows near and far, low and high sun).
- F22b: the near cut computes each bucket's own reach with the curvature out to ITS trees (treeShadowReach(e, el0,
  dMax + dCam, R)); the first version used the cascade sphere's far-edge elevation (on a 3 km world ~20 deg lower:
  infinite reach = no cut in cascades 2-3). Test: crown points ray-cast onto the curved world AND onto slopes falling
  away from the sun by up to 0.2 rad, sun behind the camera for half the trials, split at the cut's threshold for half:
  passes; halving the reach in the cut fails it.
- OWNER ITEM 1 (post|bufferData x36, shadows|bufferData x43 a frame, ~140 kB each): 140 kB = ONE PATCH PAGE ATTRIBUTE
  (16 slots x ~9 kB). F17's pools dropped emptied pages (gl.deleteBuffer) at every eviction (64 patches dropped at
  once) and made new pages as patches landed over the next frames: new GL buffers every frame while panning — terrain
  pages created at their first draw (the shadow pass), water pages in the water pass ('post'). F17's moving
  compaction also re-uploaded whole patches.
  F23 (landed, tests/render-chunkpool.test.ts 6/6 incl. new 'steady panning lands patches in kept pages: no new page
  after warm-up' = 0 new pages in 360 panned frames (old path: 102 of 144); chunkrest / patchworker / batchtable /
  shadowreach green; `?pagepool=0` = F17): chunks.ts PagePool per planet: a page a pool gives up keeps its GL buffers
  and is reused by any level, terrain or water (one page layout); a pool keeps its own pages through the eviction
  saw-tooth and gives pages back only when half empty (the view left that level) or after 600 frames of slack; idle
  pages beyond max(6, in-use/8) or idle > 900 frames are deleted. Memory: the tour tests' bounds still hold (peak 1504
  -> <= 1800 slots on the default-budget tour).
- OWNER ITEM 2: span and preupload DEFAULT OFF now (`?span=1`, `?preupload=1` turn them on; the header prints
  span=0 preupload=0). Reasoning (upload.ts / renderer.ts comments): ANGLE's whole-buffer re-allocation that F16 avoided
  costs the GPU process a memcpy + blit, but every byte of a bufferSubData — merged-span GAP bytes included — crosses
  Chrome's command-buffer transfer memory from the main thread, which blocks when that ring is full (two patches in
  slots 0 and 15 of a page: 2.2 MB instead of 280 kB per attribute set); the owner's trace shows the main thread
  waiting inside bufferSubData. Pre-upload uploaded every flagged texture, also ones nothing draws this frame (other
  planets' particle fields, hidden batches): bytes for nothing on the same path. With F23 the fresh allocations F16 was
  meant to save are gone at the source. Ring buffers (N=3) for dynamic instance data were considered: they double the
  bytes resident and still send the same bytes; not needed once nothing re-allocates.
- REPORT HEADER: `· build <commit8>[+dirty] built <UTC>` (vite.config.ts define __GENESIS_BUILD__, perfreport.ts
  BUILD_STAMP; 'dev' from source) and the `perf fixes (A/B switches, effective): ...` line (bldpage pagepool shnear
  fartrees patchworker preupload reach span zcons).
- Queued (run-s9e.sh): v18b (dist18, shnear=0 shots), then g5u (dist19 = everything above, ULTRA, panned, --gl=1
  --stacks=1 --attrs=1 --panreport): expect shadows|bufferData and post|bufferData ~0 per frame (read the
  'gl calls' line and 'uploads by site').

## NEXT (session 10), in order — owner items 3-7
1. Read g5u: bufferData per slot ~0? remaining bufferSubData owners by site; v18a vs v18b shots LOOKED (F22 equal).
2. ITEM 3 FAR TREES (~1100 draws, 11 M tris): one InstancedMesh per hull LOD for ALL kinds/variants (vertex pulling:
   pad every hull to one topology, per-vertex position/normal/colour from a small table texture indexed by
   (kind*VARIANTS+variant, gl_VertexID), per-instance hull id in a new instanced attribute) = 2 draws per pass instead
   of ~66; slot allocator per LOD bucket unchanged. Shadow: far hulls currently cast into every cascade whose sphere
   their reach meets (farShadow is all-or-nothing): add F22's near cut (far trees start at 0.72 x range) and a far cut
   per cascade by distance band (sort far blocks by cell distance at placement).
3. ITEM 4: list each post pass's target size at DPR 2.5 Ultra (2720x1194): post.ts / pipeline.ts targets (hdr MSAA 4x,
   GTAO half, clouds quarter + resolve full, atmosphere composite full, bloom chain, god rays) — print in the report
   header; move low-frequency passes to their intended fraction with bilateral upsample where they run full-res.
4. ITEM 5 VISUAL BUG: water sheet over the hills east of the town (trunks ghosted): suspects water patches built for
   land cells (wSlot from a patch that turns wet: extract), ZEDGE water depth path, flood-warning silt/rise zones.
   Repro on the babel scenario seed 307987276 near 'Rubolhin by the Lake'.
5. ITEM 6 white frames through the cloud deck (two near-white steps per zoom): luminance per frame of a scripted zoom
   (perf-descent.mjs phase zoom); check clouds.ts tunnel speed threshold vs WASD/zoom speeds, exposure post.cutExposure.
6. ITEM 7: '1' key after 1000x (ui lane), long-press time-based and drag-cancelled (ui lane: hand/input).
- GATE check11 (whole tree: F21, F22b, F23, span/preupload default off, build stamp; slot.sh): npm run check 913/913
  pass; npm run build OK (build-prod10.log; the bundle carries its build stamp).

## SESSION 10 (2026-11-11 ~23:00Z) — owner items 3-7 on build c1342092
- Item 0: run-s9e still in its queue at start (v18a f200 in slot 1 since 21:59Z; v18b shnear=0 and g5u after it):
  NOT yet read — see NEXT.
- ITEM 7 (ui, landed, tests/ui-longpress.test.ts 4/4 + ui-arc-decision green):
  * LONG PRESS (handinput.ts heldFor): the hold is wall time from when the press was HANDLED on the main thread, not
    from its event time. At 1-3 fps a press waits behind a long frame with an event time hundreds of ms old; the next
    frame saw now - downT > 620 ms before the drag's moves (queued behind the same frame) were delivered, and opened
    the radial under a drag. Now min(now - eventTime, now - handledTime) > 620 ms AND path < 8 px: every move made
    before a frame starts is delivered before it, so a drag is always known by then. Same for the 400 ms hold-to-grab.
    Test: 16/100/400/1000 ms frames fire at 620 ms +- one frame; a press handled 900 ms late + a drag never opens;
    mutation (event time only) fails it.
  * '1' AFTER 1000x: the decision card (tower / covenant) eases 1000x to 10x and RESTORES the speed from before it when
    answered / put off / expired (DecisionState.prevSpeed): a '1' pressed meanwhile was overridden back to 1000x. Now
    every speed the player sets (keys, HUD, faster/slower, pause: Shell.playerSpeed) clears prevSpeed. The worker side
    was checked in-process (_harness/arc-work/perf-speed1.ts: 1000x -> setSpeed(1) -> speed 1, lapse level 0, 1.0
    ticks/s at once). Worker pacing (sim lane, pacing only): the slice time is checked after EVERY tick (was every 4th:
    four time-lapse ticks of a big world kept a speed key / snapshot request waiting).
- ITEM 3 (render, landed, tsc clean, tests/render-fartrees 4/4 incl. a new adversarial exactness test with a mutation
  check, render-vegcache / -treeshadowcut green; browser check pending): FAR TREES AS ONE MESH PER (DISTANCE BAND,
  HULL LOD). farcrown.ts: the hull is emitted in a CANONICAL layout (lod 0: 23 vertices / 36 triangles incl. a trunk
  folded to a point when absent; lod 1: 10 / 16), identical for every kind and variant; verified one-off that every
  non-degenerate triangle with all its attributes equals the old deduplicated hull (90 hulls, 0 differ).
  farHullTable(): all hulls in one RGBA32F table texture (row = (kind x 3 + variant) x 2 + lod, 3 texels a vertex).
  vegetation.ts: the far shader (VEG_FAR, main + depth) fetches its vertex from the table by (gl_VertexID, iHull) first
  thing in main() and macros stand it in for position / normal / color / aWind / aCard / aCrown / aLeafUv, so lighting,
  tint, sway, fades and shadows are the same code. Buckets: 4 distance bands from the camera (x the far inner edge
  0.72 range: 1.6 / 2.6 / 5.2) x 2 lods = at most 8 far draws a pass (was ~66 = one per kind, variant, lod; owner
  measured ~1100 far draws a frame over 5 passes). A cell's block goes into its band as ONE slot range (all kinds);
  it keeps its band within 10 % of the edges (no churn), moves when it leaves. SHADOWS PER CASCADE: each band keeps
  its trees' distance bounds from an anchor (farBounds); cascade k draws a band only if a tree's shadow (treeShadowReach,
  F22's bound) can reach the cascade sphere AND fall past the previous split (F22 near cut) — was all-or-nothing.
  NOTE the template geometry must carry a 'normal' attribute (three flat-shades a Standard material without one: the
  first browser run failed to compile 'vNormal' — caught in the east-water shot log, fixed). Shared index / position /
  normal are detached before a bucket geometry's dispose (dispose frees every buffer of a geometry).
- ITEM 4 (report part, landed, tests/render-gltrace 3/3): the perf report's GL trace now wraps three's setRenderTarget
  while recording and prints `render targets (slot name WxH format [msaa] binds/frame draws/frame)` for EVERY target
  drawn into (named: hdr, sceneCopy, linDepth, atmoA/B, prevColor, god*, bloom0-6, ldr, lum*, adapt*, gtao, gtaoBlur,
  cloudsRaw, cloudsHistA/B, shadowAtlas, lens; canvas). The owner's next Ultra report lists them at DPR 2.5. From the
  code at 2720x1194 Ultra: hdr rgba16f msaa4 + depth f32; sceneCopy, atmoA, atmoB, prevColor, ldr(rgba8) FULL res;
  linDepth r32f full; cloudsRaw 2x rgba16f at 1/2 x 1/2 (cloudScale 0.5 -> k 2) + cloudsHist 2x rgba16f FULL; gtao /
  gtaoBlur (setSize from renderer: check the report); god rays 1/4; bloom from 1/2 down 7 mips; shadow atlas 4096^2.
  Candidates for reduced res (NOT done, needs side-by-side shots): the atmosphere composite (full res, 24 steps at
  Ultra, ping-pong atmoA/B) — aerial perspective is low frequency except at silhouettes: march at 1/2 res + depth-aware
  (bilateral, nearest-depth) upsample; the cloud history at full res x 2 MRT (resolve could run at 1/2 with the
  composite reading it bilinearly).
- ITEM 5 (in progress): probes in arc-work: probe-eastwater.ts (wet cells near Rubolhin: many lake-margin cells with
  0.2-3 m of water AND tree cover 0.6-0.9 — a flooded forest the sim keeps), probe-drape.ts / probe-drape2.ts (the
  water sheet as the shader builds it — fieldpack levels, ocean.ts drape — against the ground tG on a 6 m lattice,
  2.2 km round the town): the drape covers NO ground more than 1 m above the water's level (detail relief is <= ~2 m
  and the drape needs vSimD >= 0.1), the level's chord shows water over 86 points only. So the sheet geometry alone
  does not explain "hills covered by water"; the shots (perf-eastwater.json, medium 640x360) decide. Lake level ~0.2.
- ITEM 6 (in progress): perf-descent.mjs --phase=zoomfixed: the orbit -> town zoom on a FIXED 60 fps clock (an init
  script makes performance.now / rAF time advance 1/60 s per frame whatever SwiftShader takes), a shot every frame;
  _harness/arc-work/perf-lum.py <prefix> prints mean luminance / near-white share per frame. Run cz1 (dist20, babel
  seed 307987276, high 640x360, 1.2 s flight + 16 frames).
- SHOTS (live src, medium 640x360, babel 307987276 at speed 0): pe-east120 (LOOKED): dusk, the town on its lake, palms,
  no visible water over land in that frame; pe-east250 = inside the rain cloud (a brown wall); pe-top400 (700 m,
  LOOKED) = the deck from above. Far trees rendered with no shader error after the 'normal' fix (the first run's
  compile error was the flat-shading one). Item 5 NOT reproduced yet.
- cz1 (fixed 60 fps clock zoom, dist20): the capture loop sees every ~20th 60-fps frame (each screenshot runs extra rAFs,
  each advancing the clock 1/60 s): f000-f003 mean luminance 0.14 / 0.23 / 0.31 / 0.52 (f003 at 460 m LOOKED: the deck
  from above, sunlit, correct), no near-white frame so far; the deck crossing comes next (log cz1.log).

## NEXT (session 11), in order
1. run-s9e: v18a's f200 and ALL of v18b died on page.screenshot timeouts (900 s) at ~23:49Z — the box ran three
   SwiftShader jobs at load 11. v18a town / townlow exist; RE-RUN v18b (shnear=0: town, townlow only) ALONE in a quiet
   slot, then diff against v18a (tree shadows near and far must match). g5u (dist19, panned, gl/stacks/attrs) was
   running in slot 2 at 23:54Z: read its 'gl calls' line (bufferData per slot ~0?). Read check12.log + build-prod11.log (run-s10g.sh: full gate then npm run build, queued
   through slot.sh). Fix anything red.
2. Item 3 browser check: a shot on dist20+ near a forest (town, f200, descent 2000 -> 200) — far trees present at
   every altitude, same look as before (compare v18a-town / s7f1-d*), draws count: 'fartrees' meshes <= 8.
   perf-play `--attrs=1` names them 'fartrees'. Then g-run for shadowTris vs v18a 5.82 M.
3. Item 6: finish cz1 (python3 _harness/arc-work/perf-lum.py _harness/scratch/arc/perf/shots/cz1-f); LOOK at the frames
   inside the deck (alt between the shell radii). If white: candidates in order — the tunnel's near radius vs the deck
   seen sideways (horizontal rays inside the deck beyond uNearR = white wall), uCamFog fading only by `near`, exposure
   rate 2.2/s down / 1.1/s up (pipeline ADAPT_FRAG), cloud history reprojection at large camera steps. To see EVERY
   frame, make the capture not tick rAF (stop the fixed clock while screenshotting: __FIXCLOCK__.off()/on() around it).
4. Item 5: re-shoot by DAY under the deck: hour 11, orbit target settlement 1, dist 300 / 150, tilt 45-60, yaw 60 / 90
   / 120 (east), quality high, and the same with ?fartrees=0 (rule out the far hulls) — LOOK for the water look on the
   hills east (x 300-2000 m, y -1300..1300 in probe-eastwater's frame: many 0.2-3 m wet cells with tree cover 0.6-0.9,
   a flooded lake-margin forest the sim keeps). Probes say the sheet geometry does not cover land > 1 m over the
   water; suspects left: the WATER PASS drawing over terrain where the terrain is not in the depth buffer it tests
   against (MSAA resolve / linDepth copy vs patches that land late, F10 worker patches: a water slot visible while its
   terrain slot is hidden or not yet built), ZEDGE water depth bound, the flood-warning rise (precursors riverRise) on
   a lake-margin forest, the rain ripple decal. Check chunks.ts showPatch(p, on, water): a patch whose terrain slot
   shows its PARENT (worker path: subtree not yet covered) while its own water slot draws.
5. Item 4: read the owner's 'render targets' line; then the atmosphere composite at 1/2 res with a nearest-depth
   bilateral upsample (shots side by side: town at noon, dusk, orbit limb), cloud history at 1/2 res.

## SESSION 11 (2026-11-12 ~23:55Z) — items 0, 3, 6, 5, 4 on build c1342092
- GATE check12 (run-s10g: session-10 tree): npm run check 919/919 pass; npm run build OK (build-prod11.log).
- g5u (dist19 = session-9 tree incl. F21/F22b/F23, ULTRA 888x500, busy town, panned; SwiftShader pans by wall time =
  every frame a 15-27 km cut, so these are upper bounds): gl calls total 74 ms/frame; shadows|bufferData 7.5/frame
  1.07 MB (owner's M5 trace on 31cb64e7: 42.9/frame), post|bufferData 9.3/frame 1.17 MB (35.9), metal buffer allocs
  est. 4.2 MB/frame (15.4), fresh sizes 3.6 MB over the whole recording; attribute churn: NO 'new attr' in the measured
  frames (only range updates: vegetation-near instanceMatrix x57 buckets, building pages aKit/position ranges, roads).
  Remaining bufferData = new objects' first upload (createBuffer under projectObject) on those cuts. uploads inside a
  pass 97/frame are mostly scene|texSubImage2D (61.8/frame: particles' field DataTextures re-uploaded per emitter
  refresh at 256x161 x 9 fields + city-light tiles); preupload (F20) is default off since session 9.
- cz1 (session 10, fixed-clock flyTo zoom) stopped: each capture ran ~20 hidden 60 fps frames (screenshot rAFs); f004 at
  209 m LOOKED: clear town under the deck, no white. perf-descent.mjs: __FIXCLOCK__.hold() freezes time during a
  screenshot / stats (every 60 fps frame is seen), --zhi/--zlo shoot only inside an altitude window, --zevery N, and a
  new phase 'wheelfixed' = the PLAYER's zoom: WheelEvents on the canvas (--wdy px per event every --wevery frames:
  -100/4 a mouse wheel, -5/1 a trackpad), prints the cloud shell heights; stats now count far-tree meshes drawn.
- Queue (ONE browser job at a time; run-s11a/b/c.sh in scratch/arc/perf): v18b (shnear=0 town/townlow, dist18) ->
  cw1 (mouse-wheel zoom through the deck, dist21 = fresh unminified build of the session-10 tree) -> eastwater4 (spec
  arc-work/specs/perf-eastwater2.json: day views east of Rubolhin, + fartrees=0) -> ft1 / ft0 (far trees on/off
  descent 2000/500/150/50 on babel, forest poi) -> cw2 (trackpad zoom).
- ITEM 0 VERIFIED (F22 near cut, shnear): v18b (dist18, shnear=0) re-run ALONE vs v18a (shnear=1), ULTRA 888x500 busy
  town at speed 0. town: mean |d| 3.2/255, townlow (17:35 low sun): 1.6/255; diff images shots/diff-v18-town.png,
  diff-v18-townlow.png LOOKED: the only differences are tree-crown edges (wind sway runs at speed 0) and the HUD's
  blurred backdrop / counters; ground, tree shadows near and far (also the long evening shadows), houses: identical.
  shadowTris town 5.82 M (on) vs 9.39 M (off) = -38 %; townlow 11.80 M vs 11.66 M (a low sun's reach covers every
  split: nothing to cut, as designed). 0 console errors.
- CONTAINER RESTART ~03:21Z killed ft1 mid-run (scratch, src, node_modules survived). Queue re-made as run-s11d.sh
  (ONE browser job at a time): ft1b (150/50) -> ft0 -> cw1 -> eastwater5 (spec perf-eastwater3.json) -> cw2 ->
  ftcolour (spec perf-ftcolour.json). check13 (full gate) + build-prod12 started ~04:5xZ alongside.
- ITEM 3 FAR TREES, BROWSER CHECK (dist21 = session-10 tree, babel 307987276, forest poi, High 640x360, descent;
  ft1 = fartrees=1, ft0 = fartrees=0; shots ft1-d2000/-d0500, ft1b-d0150/-d0050, ft0-d*; LOOKED):
  | alt | far meshes drawn (of made) | far inst | tris on / off | shadow tris on / off |
  | 1614 m | 1 / 3 | 91 583 | 7.55 M / 1.68 M | 5.00 M / 0.60 M |
  |  409 m | 7 / 8 | 102 540 | 9.36 M / 1.89 M | 6.65 M / 1.04 M |
  |  165 m | 7 / 8 | 65 356 | 8.67 M / 3.55 M | 5.93 M / 2.11 M |
  |   99 m | 7 / 8 | 49 750 | 9.43 M / 4.78 M | 6.50 M / 3.01 M |
  DRAWS: <= 8 far meshes per pass at every altitude (target met; was ~66 per pass). PRESENCE: forests at every
  altitude; with fartrees=0 the babel forest at 409 m is bare grass (no near trees above 1.2 x range and NO canopy
  colour in the terrain there), so the far layer is what makes the forest exist from the air. No pop seen between steps.
  CONCERNS (not fixed): (a) LOOK: the hulls read as bright lime low-poly blobs — at 2 km a sprinkle of bright dots over
  a darker canopy (shots/cmp-ft-d2000.png), at 409 m pentagonal crowns (cmp-ft-d500.png), palms at ~250 m as flat
  umbrella discs (crop-ft1b-150.png). The hull colour = the leaf-atlas tile mean x 1.7/0.92 lit as a SOLID surface: no
  self-shadow / gaps a real crown shows from afar, so it is brighter than the near tree. Measure with ftcolour (same
  forest at 500 m as hulls vs as near trees: new probe-only switch `?vegrange=<m>` in planetview.ts) and darken the
  hull by the measured ratio (farcrown.ts colour) — a colour match, not a quality cut. (b) COST: the far layer adds
  ~4.4-5.6 M (instance-counted) shadow tris and ~4.6-5.9 M tris: vertex work of 50-100 k hull instances per pass.
- ITEM 6 (in progress): shell heights on the babel world (3 km): deck 180-420 m above datum. Normal orbit distances
  (300-700 m) put the camera INSIDE the deck: pe2-e300-y60 (alt 316 m, camera still) is a fully white frame by design
  ('hovering in a cloud still fogs'). The tunnel (clouds.ts) only opens for vertical speed > 0.15 x 240 m = 36 m/s,
  full at 156 m/s. Mouse notches (14 % jumps) exceed that; a trackpad scroll (~1-2 m a frame at 300 m = 60-120 m/s) only
  half-opens it (uCamFog ~0.5 over 50-90 m of dense deck = OD ~4: white). cw1 (mouse wheel, -100 every 4 frames, fixed
  clock, shots cw1-w*.png alt 750 -> 110) was at frame 14 (alt 686, lum 0.52) at 05:00Z; cw2 (trackpad) queued.

## NEXT (session 12), in order
1. Read cw1 / cw2: `python3 _harness/arc-work/perf-lum.py _harness/scratch/arc/perf/shots/cw1-w` (and cw2-w), LOOK at
   the frames between alt 420 and 180. If the white comes from the in-cloud fog during a slow (trackpad) zoom: open the
   tunnel for ANY sustained vertical travel (want from ~5 m/s, full by ~30 m/s; keep the ~1 s close so a camera that
   stops in the deck still fogs). If it comes on entering / leaving the deck with the tunnel open: exposure (ADAPT_FRAG
   rate 2.2/s down) or cloud history; A/B with the fixed clock. Then the question for the owner: a camera RESTING in the
   deck (orbit 300-700 m on a 3 km world) is a white screen by design — ask whether that is wanted.
2. Item 5: eastwater5 shots (pe3-e120-y60/90/120 + ft0, by day under the deck) LOOKED for water on the hills east of
   Rubolhin; suspects in PERF session-10 NEXT #4 (coarse parent water slot in the worker path, ZEDGE, the flood-warning
   rise, real lake-margin flooded forest with 0.2-3 m water + tree cover: trunks seen refracted = 'ghosts').
3. Far-tree colour: ftcolour (ftc-far vs ftc-near) -> mean crown colour ratio -> farcrown.ts colour factor; re-shoot.
4. Item 4 (atmosphere composite at 1/2 res): by the shader's cost (24 steps x 2 LUT fetches + 2 exp per pixel) it is
   ~0.5 ms at 3.25 MP on an M5-class GPU: low expected gain vs the shadow / geometry passes; do it only after 1-3.
5. GATE check13 (session-10 tree + probe switch vegrange): 919/919 pass; npm run build OK (build-prod12.log). run-s11d.sh
   keeps running (cw1 at frame 17, alt 611 m, ~6 min a frame; then eastwater5, cw2, ftcolour): read their logs / shots.

## SESSION 12 (2026-11-12 ~05:00Z) — owner: "fix the found issues. and i follow your recommendation on the clouds."
- owner ruling 2026-11-12: clouds thinned around the camera (default on). `?deckmist=0` = the old white-out (A/B).
- ITEM 6 FIX (landed, tsc clean, tests/render-decktunnel.test.ts 3/3; mutation: `?deckzoom=0` (the session-5 rule)
  fails the trackpad case with in-cloud fog 0.87 = white): clouds.ts deckTunnel() (pure, tested) replaces the inline
  tunnel. (a) `deckzoom` (default on): vertical speed smoothed over 0.15 s opens the tunnel from 4 m/s, fully at 30 m/s
  (was 36 / 156 m/s on the 240 m deck: a trackpad zoom at 60-120 m/s half-opened it = white), near zone the full 485 m
  when open; closes over ~1 s. (b) `deckmist` (default on, owner ruling): resting inside the shell keeps 70 % of the
  tunnel open (350 m clear zone) and the in-cloud fog's transmittance floor uCamMist = 0.45 (shader: stepT =
  max(exp(-dens fl), uCamMist)): the ground reads through mist. Only while the camera is inside the shell: from
  outside / above the deck nothing changes (test). Both switches print in the perf report header.
- ITEM 2 FAR TREES LOOK (landed, tsc clean, render-fartrees 4/4; browser A/B in progress): measured with the probe
  switch `?vegrange=1600` (same forest at 500 m as near trees, ftc-near) vs hulls (ftc-far): hulls green-pixel share
  0.90 vs 0.35, lit hull pixels ~1.5x brighter and bluer, and the terrain painted its canopy stand-in (green carpet)
  under the hulls where the near trees stand on brown floor. Fixes, no extra draws:
  (a) terrainmat uCanopyFade (planetview): with the far layer drawing, the canopy stand-in takes over only where a
      14 m tree is 6 -> 3 px tall (FAR_PX.out), not at the near hand-over band: the floor under far trees is the floor.
  (b) far fragment shader (VEG_FAR): crown clumps (voronoi in the tree's unit frame) lit through the crown-depth term
      the near leaves use (new vegCrownV feeds VEG_LIGHT / VEG_AMBIENT), dark gaps, ragged open gaps on the outline;
      whole clumps open by the crown's FILL where resolved.
  (c) farcrown.ts FILL per hull = foliage coverage of the hull from above / the side (leaf triangles rasterised on a
      24x24 grid, x0.75 for spray holes; palm 0.56, broadleaf 0.74, conifer 0.72), stored in aCrown (2 + fill);
      unresolved crowns (< ~14-40 px tall) are drawn narrower by sqrt(fill) in farFetch (shadows too).
  (d) hue: foliage hull colour x (0.76, 0.88, 0.6) (was paler / bluer than the near crowns at the same light).
  ftc2 (a+b+d first values): green share 0.53, green mean (77,117,30) vs near (67,104,29); ftc3 (+fill gaps, hue):
  (69,109,24), share 0.52 (crowns still too wide at 400-700 m: clumps unresolved there) -> (c) narrowing; ftc4 queued.
- OWNER MAC ROUND 2 (b54f2105, MAC-ROUND2-b54f2105.txt): Ultra 1.5 fps, High 3.1; metal allocs 6.5 MB/frame (pagepool=0:
  17.8: F23 is real). GPU-BOUND (main ~25 ms vs 700-2000 ms frames; fartrees=0 cuts tris 28 -> 11.8 M, no fps gain;
  cost ~linear in pixels): something costs ~100x per pixel on Apple TBDR.
- BISECTION BUILD (landed, tsc clean; tests/render-perfreport 3/3 incl. new pass-split test):
  * perfreport.ts gpuMark / perfmon.mark(name): inside the 'scene' and 'post' groups the GPU timer query is split at
    each mark (queries cannot nest; group ms = sum of its passes). Report line `gpu ms by pass (mean/p95 ...)`:
    scene, scene:opaque, post, post:gtao, post:copies (scene colour + linear depth copies for the water), post:decals,
    post:water (the water sheet into the MSAA hdr), post:clouds (march + resolve), post:atmo (each composite),
    post:fx (particles, god FX, ships, worlds), post:keep (keepPrevious copy), post:photo, post:god, post:bloom,
    post:tonemap (incl. luminance + adaptation), post:fxaa.
  * DIAGNOSTIC switches (default ON = the game's look; `=0` skips): msaa (hdr samples 0), clouds (no march / bake /
    composite cloud), water (no water pass), gtao, atmo (no atmosphere composites), bloom, godrays (+ flare). With
    zcons, fartrees, deckzoom, deckmist etc. all print in the report header's effective-switch line.
  * Smoke runs queued (run-s12f.sh: smoke1 default / smoke0 all off, ULTRA, --report): must show 0 errors and the
    pass line.
- BISECTION, part 2 (GPU-HUNT-PLAN §2; landed, tsc clean, render-perfreport 3/3 incl. passsync line): perfswitch.ts
  perfNum / perfList (numeric / list params print their value, or def / none). New switches, all default = unchanged:
  passsync=1 (perfmon: gl.finish at every slot begin/end and pass mark while recording -> report line `pass ms
  (passsync ...)`), scene:shadows mark, flat=1 (overrideMaterial MeshBasic on the opaque render), scene=0 (clear
  instead), hide=veg,cover,life,terrain (primary planet, restored after the opaque render), shadows=0, rscale=<f>
  (x renderScale), atmosteps=N, cloudsteps=N, decals=0 (godfx.renderDecals), fx=0 (particles / god FX / ships /
  worlds), lum=0 (luminance chain + adaptation skipped: exposure frozen; new mark post:lum), recms=<ms> (report
  length, whoever asks). NOTE for probes: a report needs >= ~5 recorded frames for timer results (smoke1/0 with 3
  frames: 'no results'; smoke2 at 40 s: by-pass line present).
- FIX (GPU-HUNT-PLAN §1a, `invalidate`, default ON): after the water pass, when atmosphere composites follow (every
  later reader uses the resolved hdr.texture / depthTexture), gl.invalidateFramebuffer on the MSAA hdr's multisampled
  framebuffer (colour + depth): a tile GPU need not store the 4x buffers. Picture A/B inv1 / inv0 queued.
- SMOKES (dist24/25, ULTRA 640x360, region): smoke2 (all diagnostics off, 40 s report): by-pass GPU line present;
  smk-a (passsync=1, recms=40000): 'pass ms (passsync ...)' line, header prints every switch; smk-b (flat, hide=veg+
  cover+life, shadows=0, rscale=0.5, atmosteps=4, cloudsteps=8, decals=0, fx=0, lum=0, msaa=0, invalidate=0) and
  smk-c (scene=0, hide=terrain): 0 console errors in all.
- INVALIDATE A/B (inv1 vs inv0, dist25, ULTRA, speed 0): region mean |d| 1.1/255, orbit 0.4/255; diff-inv-region.png
  LOOKED: grain, drifting cloud edges and water ripples only (animated); no structural change. Kept default on.
- GATE check15 (all of the above + cloud fix + far-tree look): 923/923 pass; npm run build OK (build-prod14.log).
- FAR TREES ftc4 (fill narrowing; _shots/ftc4-d500.png, cmp-ftc4.png LOOKED: before / after / near reference):
  green-pixel share 0.90 -> 0.37 (near 0.35), region mean (81,109,51) -> (88,92,44) (near 89,91,50), brown floor
  between crowns as under the near trees; individual crowns still a little greener / brighter (G 117 vs 104).
- CONTAINER RESTARTS at ~06:5xZ? and ~08:21Z: run-s12h queue died after inv0; not yet re-run: ftc4 d2000/d150,
  deckmist2 (resting-in-deck before/after), eastwater5 (+pe3-stream / pe3-pond), tq0 / tq1 (trackpad zoom before/after).

- DECKMIST VERIFIED (deckmist2, live src, babel, orbit dist 300 tilt 50, camera RESTING at alt 316 m inside the
  180-420 m deck; _shots/dm-rest-off.png vs dm-rest-on.png, cmp-deckmist.png LOOKED): off = a fully white screen; on =
  the town, its fields and trees read through a soft mist below, the deck still a cloud around and above. 0 errors.
- FAR TREES at 2 km / 150 m (ftc4-d2000, ftc4-d150 vs ft1-d2000, ft1b-d0150; cmp-ftc4-alt.png LOOKED): the lime
  speckle at 2 km is gone (the forest reads as a darker textured canopy), 150 m unchanged near, floor brown under far.

## NEXT (session 13), in order
1. tq0 / tq1 (wheelfixed trackpad -3 px/frame from dist 540: deckzoom=0&deckmist=0
   vs default) -> perf-lum.py: no white frames with the fix; one shot from above the deck to confirm clouds unchanged
   from outside.
2. Far trees: ftc4-d2000 / -d150 shots; crowns' G a bit high -> farcrown.ts cg factor 0.88 -> ~0.8, re-shoot d500.
3. Item 5: eastwater5 (perf-eastwater3.json: pe3-stream, pe3-pond = the wet hillside cells 1.4-1.7 km east: 0.4 m films
   at h 0.5-12.7 m and a 5 m pond at 9.5-11.4 m; pe3-e120-*). Also the sim facts: the land east of Rubolhin has many
   cells 0.2-2.8 m BELOW the lake level with tree cover 0.5-0.9 (flooded forest the sim keeps) -> trunks seen through
   water = 'ghosts'. Decide render-side (shore film over slope cells) vs sim-side (sim lane: trees in deep water).
4. Item 4 reduced-res post: only with A/B-identical shots; the owner's bisection report decides which pass matters.

## SESSION 13 (2026-11-12 ~09:00Z) — after the ship of 92d06936
- ITEM 5 EAST WATER, findings (shots LOOKED, babel 307987276 by day, live src):
  * pe3-stream / pe3-pond (the wet hillside cells 1.4-1.7 km east: 0.4 m films, a 5 m hill pond; cmp-pe3.png): the
    pond draws as a clean pond, the films draw nothing visible; NO water sheet on the hills there.
  * pe3-e120-y60/90/120 (cmp-pe3b.png; yaw seems to change little): the town on its lake, no water on hills; several
    houses on the lake's edge stand in the water (sim building placement vs the lake level: worth a sim-lane look).
  * SIM FACTS (probe scratchpad flood.ts / sp22.ts): the cells 0.3-2 m under water with tree 0.8-0.9 east / south-east
    of the town are OCEAN cells (sea shallows) of species 22 = MANGROVE (habitat shore, water [0, 2] m, salinity 1):
    sim-correct by the content table.
  * pe4-mangrove60 (alt ~45 m over that shore, LOOKED): the sea shallows show DARK GREEN BLOBS just under the water
    surface along the shore and no mangrove standing out of the water = the likely 'trunks / trees as ghosts'. Either
    the near vegetation scatter places the mangroves sunk (base on the sea bed, crown under the sheet) or skips
    them while something green (ground cover / canopy) is drawn on the sea bed and refracted. NEXT: find which
    (queued: perf-mangrove2.json = hide=veg / hide=cover / water=0 at the same pose, run-s13b.sh last), then make a mangrove stand read as
    trees standing in the water (trunks and prop roots out of the water, crowns above it), never green shapes under it.
- FAR TREES colour: ftc5 (green factor 0.8): green-pixel mean (76,114,28) vs near (67,104,29), region (88,91,45) vs
  (89,91,50): close. Further to (0.7, 0.72, 0.6) now in src; ftc6 queued (run-s13b.sh, after tq0 / tq1).
- tq0 / tq1 (trackpad zoom through the deck, before / after, dist26) running in run-s13b.sh.
- GATE check16 (session-13 tree: far-tree colour (0.7, 0.72, 0.6)): 923/923 pass; npm run build OK (build-prod15.log).
- ITEM 5 CAUSE + FIX (landed, tsc clean, tests/render-mangrove.test.ts + vegcache / wildplants / fartrees green):
  * A/B at the mangrove shore (pe4-m60-hideveg / -hidecover / -nowater, cmp-mangrove2.png LOOKED): the dark green
    shapes in the water go with ?hide=veg and with ?water=0 nothing lies on the sea bed: they are the water's
    reflections of the shore palms (screen-space), not objects under the sheet.
  * The sim's mangrove stand (sea shallows 0.3-2 m, tree 0.8-0.9, sand 0.6 on the bed) was NEVER drawn: the scatter
    refused every point in water (> 0.05 m) and on sand (> 0.5). vegetation.ts: SpeciesLook.wetMax (plants.json water[1]
    of shore / water trees) — a tree of such a species stands in water up to wetMax + 0.3 m and on its sandy bed; land
    trees and every shrub still never stand in water; the cell gate (water > 1 m) admits a wet species' cell.
  * pe6-mangrove60 / 150 vs pe4 (cmp-mangrove4.png LOOKED): a mangrove stand now stands along the shore and into the
    water's edge (trunks and crowns above the surface), reflected in the water.
- FAR TREES ftc6 (0.7, 0.72, 0.6; cmp-ftc6.png LOOKED): crowns' green mean (74,111,28) vs ftc5 (76,114,28) vs near
  (67,104,29); region and coverage unchanged (88,91,45 / 0.37): closer: KEPT.
- STATE.md: sim-lane note on the lake-edge houses standing in the water.
- ITEM 6 TRACKPAD PROOF (tr0 / tr1: dist26, babel, high 320x180, fixed 60 fps clock, wheel -3 px every frame =
  a slow trackpad zoom from inside the deck top, alt 423 -> ~330 m, shots every 20 frames; cmp-tr.png LOOKED):
  OLD rule (deckzoom=0&deckmist=0): mean luminance 0.77 -> 0.84, near-white share 0.38 -> 0.58 = a white-out growing
  as the camera sinks; NEW (default): 0.77 -> 0.53, white share 0.32 -> 0.06: the tunnel opens within the first frames
  and the town, its pond and the forest come through the mist below.
- GATE check17 (session-13 tree: mangrove scatter, far-tree colour (0.7, 0.72, 0.6)): 924/924 pass; npm run build OK
  (build-prod16.log). Reduced-res post: waiting for the owner's bisection data (coordinator).

## SESSION 14 (2026-11-12 ~18:00Z) — owner round 3 (903b85e9): GPU-bound, swap 8.6 -> 11.8 GB: memory first
- GPU MEMORY AUDIT (landed, tsc clean, tests/render-gpumem.test.ts): src/render/gpumem.ts wraps the GL allocators
  (bufferData, texImage2D/3D, texStorage2D/3D, generateMipmap (+1/3), renderbufferStorage(Multisample), deletes) from
  the Renderer's construction on; the perf report prints `gpu mem (est., live GL allocations): total / peak / MB per
  min / by kind`, `gpu mem largest: ...` (12 biggest objects with size + format), `gpu mem buffer sizes` (count x
  size classes: patch pages, pools), `cpu retained (typed arrays ... by owner)` (scene walk: first two named
  ancestors) and `js heap`. Probe global window.__GENESIS_GPUMEM__ (total, peak, live, cpuProbe()).
- SOAK soak2 (dist27, babel 307987276, ULTRA, 6 views round Rubolhin + orbit, 15 min wall, SwiftShader: only 96
  frames): GPU 237 -> 398 MB as the views stream in, 390 after; CPU retained 224 -> 465 -> 439 MB; heap 30-46 MB;
  no climb while the view holds (samples 438-679 s flat). Too few frames to see frame-driven growth: NEXT run it at
  a tiny viewport / High for thousands of frames, or replay the pan in node (chunk pools are node-testable).
- CUTS landed (tsc clean; picture A/B cut0 (dist27) vs cut1 (dist28) queued, run-s14b.sh, busy save, ULTRA, region +
  town at speed 0):
  #1 clouds history aux RGBA16F -> RG16F (only .xy written / read): -11 MB at 2720x1194 (-4.5 at 1686x873).
  #2 shadow atlas: the never-written R8 colour attachment detached after the framebuffer exists (completeness checked,
     else restored) and its storage respecified 1x1: -16 MB at 4096². `?shcolour=1` keeps it.
  #4 ground cover iExtra: one (0,0,0,1) with divisor = capacity instead of cap copies (~3.4 MB CPU + GPU).
- CLOUDS round 3 (owner: fully white resting in the deck's UPPER part): the resting clear zone now reaches through the
  deck below the camera: nearR >= inShell x min(1200, 120 + 2.5 x (height above the deck base)). dm-top-off / -on
  (alt 372 m, cmp-dmtop.png LOOKED): off white, on = town and forest readable through mist. Test extended.
- WATER OVER THE HILLS (Mac only): reading — hills at mid distance showing the trees behind them and the lake beyond
  "through" them is what terrain fragments REJECTED EARLY on a broken conservative-depth bound look like (SwiftShader
  never rejects early, so it cannot show it). The edge bound used the smooth shading normal, not the coarse facet's
  slope. Now 2x the edge bound and a 0.15 floor on n·up (4x the chord slack, still rejecting under trees), and
  `?zedge=0` = terrain + water on the plain tangent bound. ASK THE OWNER at that spot: default vs ?zedge=0 vs ?zcons=0.
- Note (round 3): hide=veg leaves tree shadows (debug switch; the shadow casters are other objects): fine.
- CUTS A/B (cut0 = dist27 before, cut1 = dist28 with #1 #2 #4; busy save, ULTRA 640x360, speed 0; diff-cut-region.png,
  diff-cut-town.png, cmp-cut-town.png LOOKED): region mean |d| 0.95/255 (tree sway specks, coastline water motion),
  clouds and shadows identical; town 2.4/255: sway + one road stretch that the BEFORE run had not converged yet
  (coarse ground through the road, the known SwiftShader streaming lag), intact after: not a cut. 0 errors.
- GATE check18 (all of session 14): 925/925 pass; npm run build OK (build-prod17.log).
- NEXT: cuts #3 (patch page normal alias), #5 (prevColor), #6/#7 (GTAO aliasing), #8 (lazy pools); a long-frame soak
  (tiny viewport) for growth; owner A/B at the water-over-hills spot: default / ?zedge=0 / ?zcons=0.

## NEXT (session 15) — coordinator's order after the session-14 ship (this session's context is exhausted)
1. Cuts from GPU-MEMORY-PLAN.md §2, each with an identical-image A/B (perf-play busy save, ULTRA 640x360, region +
   town, speed 0, dist before vs after, diff LOOKED; expect only sway / water motion / streaming lag):
   #3 patch page normal alias (chunks.ts:76-77; set geometry.attributes.normal = position after a page's first
   addGeometry; single update range per landing; three r186), #5 drop prevColor (water samples the last atmo target;
   lazily allocated copy only for airless frames), #6 GTAO raw -> sceneCopy alias (scale 1), #7 GTAO blur -> atmoB
   alias when a composite follows, #8 lazy near-veg / ground-cover pools (start 256, double to today's caps; per-bucket
   geometry with its own iExtra).
2. gpu mem line: GPU ownership — in Renderer.cpuRetained's scene walk also look up each texture's
   renderer.properties.get(tex).__webglTexture in gpuMem.live (bytes by owner); for buffers, wrap three's
   WebGLAttributes via renderer.attributes is not public: instead tag bufferData with the owner of the object being
   drawn (wrap Object3D.onBeforeRender? or perfmon slot + three's renderBufferDirect object name, as glTrace's
   --attrs does). ANGLE transients: per frame, bufferSubData count / bytes and the whole-buffer copy estimate already
   computed by GlTrace (metal allocs est.) — keep a light always-on counter (not only while recording) and print
   'angle transients est. MB/frame' in the gpu mem line.
3. Growth soak with many frames: perf-soak.mjs --views=babel at a small viewport (add --size=320x180 to its context)
   and --quality=high, 20+ min; sample __GENESIS_GPUMEM__ total / live.size / cpuProbe; look for a monotonic climb
   (pages never freed, lazy targets, orphaned buffers). In node, the chunk-pool tour tests can run thousands of frames.

## SESSION 15 (2026-11-12 ~20:05Z) — the session-15 plan: cuts #3 #5 #6 #7 #8, gpu mem by owner + ANGLE transients, growth soak
- CUTS landed (tsc clean; each behind a perfSwitch, default on):
  #3 `?pagenormal=0` (chunks.ts NORMAL_ALIAS): a patch page's 'normal' IS its 'position' attribute (one array, one GL
     buffer) — set right after the page's first addGeometry, before any draw; extract() keeps the alias. -1/16 of every
     terrain + water page (3 of 48 floats a vertex), CPU and GPU. tests/render-pagenormal.test.ts.
  #5 `?prevalias=0` (pipeline.ts PREV_ALIAS): no prevColor copy when an atmosphere composite ran: the water's tPrevColor
     = last frame's final atmo target (input of keepPrevious; nothing writes atmoA/B before the next water pass); the
     NaN guard moved into the ocean taps (prevTap). Airless frames copy into a prevColor made on first need. -11 MB at
     1686x873 and one full-res pass fewer a frame.
  #6 `?aoalias=0` (gtao.ts): full-res raw AO rendered into post.sceneCopy (idle until copyForWater, which runs after the
     blur); the blur reads it by texelFetch (clamped; AO_FETCH define) since sceneCopy is linear-filtered. -11 MB.
  #7 `?aoblur=0`: the blurred AO into post.atmoB when a composite follows, unless atmoB holds last frame's image (prevTex,
     after an even number of composites); later composites unbind tAO (no feedback loop). Own targets made lazily. -11 MB.
     (atmoVis is now built before the GTAO block.)
  #8 `?lazypools=0` (vegetation.ts LAZY_POOLS / groundcover.ts gcRoom): near-tree buckets and ground-cover pools start at
     256 and double up to the old caps (1200/3000/6000; gc 200-6000) during a fill — the same instances drawn; a grow
     frees the old instance buffers (mesh.dispose) and, for trees, the old per-bucket geometry's own iExtra (shared
     attributes stripped first). Each tree bucket has its OWN geometry (cached attributes + its iExtra): fixes the
     shared-iExtra bug (2+ worlds). tests/render-lazypools.test.ts.
- GPU MEM LINE (gpumem.ts): `gpu mem by owner` — buffers by their source array (WeakRef at bufferData, owner from the
  scene walk sceneOwners(): first two named ancestors), textures / render targets by the three object three's
  properties.get looked up right before the allocation (attach(renderer)); unmatched: 'tex:<name>', 'buffers (not in
  the scene)' (= idle page pools, orphans). `angle transients (est.)`: ALWAYS ON — VAO -> buffers links (vertexAttribPointer,
  index binds), VAO draw stamps (draw calls + WEBGL_multi_draw), a bufferSubData into a buffer drawn in the last 3 frames
  = one whole-buffer copy (once per buffer per frame); bufferData bytes; texSubImage bytes; MB/frame over 120 frames,
  max frame, in flight (last 3 frames), full GPU waits = fresh bytes / 64 MB, copied bytes by owner since load.
  gpuMem.tick() per frame (renderer). tests/render-gpumem.test.ts (+2).
- NODE SOAK tests/render-chunksoak.test.ts: 3000 frames, the same dive/climb loop round the planet 6 times: pool slots,
  pages, idle pages, scene children, live patches peak at exactly the same level every lap (2336 / 146 / 15 / 146 / 800):
  no climb. NOTE (not a leak): while flying, slot capacity is ~2.9x live (pages per level part-filled; compaction waits
  SLACK_FRAMES=600 of lasting slack) — at rest it compacts.
- A/B run-s15a.sh: cut2 (dist29 default) and cut2off (dist29, all five switches off) at the cut1 settings.
- CUT #9 landed `?watershare=0` (chunks.ts WATER_SHARE): each terrain PatchPage gets a companion water BatchedMesh
  (made on the first wet slot shown) whose geometry / _geometryInfo ARE the page's (no extract() copy, no water pages);
  water slot k = terrain slot k, shown per patch (PatchBatch.showWater), carried through compaction, hidden on release
  / pool reset; disposal swaps the companion's geometry out first. Node soak: pages 146 -> 73, slots 2336 -> 1168 for
  the same 800 live patches (the water half gone). tests: pagenormal (+#9), chunkpool bounds now count the page pool's
  idle reserve apart (no water pool's allowance to hide it), patchworker counts wet by hasWater.
- A/B cut2 (all on) vs cut2off (dist29, #3 #5 #6 #7 #8 off), LOOKED: region mean |d| 0.90/255 (sway specks, coast
  sparkle; session-14 noise floor 0.95) = identical. Town 4.97/255: ground, cloud shadows, houses identical; a road
  stretch (known streaming lag) and the near forest on the right: lower-left foliage DARKER with the cuts on. Suspect
  #8's shared-iExtra fix (perf-play boots 'sandbox' then loads the save: 2+ PlanetVisuals, so before the fix the
  primary's near trees drew another world's iExtra = snow/char/leaf-loss/LOD role). Bisect queued: lp0 (town,
  lazypools=0 only) — run-s15c.sh, then soak3 (22 min, 320x180 High, babel) and ws1/ws0 (#9 A/B).
- CONTAINER RESTART at ~23:22Z killed run-s15b (soak never ran); scratch survived; re-queued as run-s15c.sh.
- BUG CAUGHT (dist30, the browser only): #9's companion sheet had _geometryCount 0, so three's object sort
  (computeBoundingSphere -> getBoundingSphereAt) returned null and every frame threw ("frame failed ... applyMatrix4";
  the soak's frameNo stuck at 9, lp0's save never ticked). Fix: the companion's _geometryCount is a getter of the
  page's; node test calls computeBoundingSphere on a sheet. dist31: renders, 0 errors, also with all six switches off.
  run-s15c.sh re-queued on dist31.
- BISECT lp0 (dist31 town, only lazypools=0) = the all-off image (bright near foliage); all-on = darker lower crowns.
  So #8, and it is the shared-iExtra FIX, not a regression: iExtra.w's fraction is the canopy closure (VEG_AMBIENT:
  trunks / inner crowns under a closed canopy get 0.34-0.42 of the sky). With 2+ PlanetVisuals (perf-play boots
  'sandbox' first) the primary's near trees drew ANOTHER world's iExtra (zeros: no canopy shade, LOD role 0 = no
  cross-fade roles, no snow / char / leaf loss); with per-bucket geometry they draw their own. Single-world sessions:
  unchanged. Owner A/B: default vs ?lazypools=0 (only differs where 2+ worlds were built).
- GATE check19 (after two container restarts; dist31 source = HEAD 4f47e96d + nothing since): npm run check 932/932
  pass, exit 0; npm run build exit 0 (build-prod18.log).
- SOAK soak3 (dist31, babel 307987276, HIGH 320x180, 6 views round Rubolhin + orbit, 22 min, alongside other jobs):
  only 319 frames (SwiftShader ~0.25 fps even at 320x180) — NOT the thousands asked for; the node chunk soak (3000
  frames) stands in for the terrain pools. Over 22 min: gpu 97 -> 173 -> 188-225 MB plateau, cpu retained 168-204
  plateau, JS heap 30-43 flat, programs 180 flat, textures ~200 flat, page slots 960-1152 for 736-795 live, idle pages
  0-8, near-tree capacity 56.8k of 673k (lazy pools work: was 673k up front). Mild climbs to watch: GL objects
  1342 -> 1910, three geometries 105 -> 151, gpumem VAO links 1165 -> 1687, far-tree blocks 353 -> 988 (cache filling as
  views add ground; bounded by the planet). No error.
  BIG FINDING — ANGLE transients: 'copyMB' (whole-buffer copies for bufferSubData into buffers drawn in the last 3
  frames) is 3.7-5.1 MB PER FRAME at steady state, fresh 1757 MB in 319 frames (~5.5 MB/frame incl. bufferData). At the
  Mac's frame rates that is a 64 MB ANGLE GC wait every ~12 frames. The by-owner copy list is in the perf report's
  'angle transients' line (not sampled by the soak: NEXT add it) — get it from the owner's next report or a perf-play
  run with the report printed.
  Owner names: pages count per page ('planet-0/terrain-L1-p0') — NEXT normalise /-p\d+$/ in sceneOwners. Largest owner
  'planet-0/life (textures)' 60 MB (building / life data textures): a lead for the tab-memory gap (round 4 item 4).

## ROUND 4 (MAC-ROUND4-6b46e1b4.txt) — started in session 15
- ITEM 3 INPUT (done, src/ui/handinput.ts at the lead's request): the long press now fires only when the press looks
  held still in TWO frames in a row past 620 ms (longPressArmed): at ~2 fps the threshold was crossed in the one frame
  whose moves were still < 8 px, so a slow-starting drag opened the radial. +1 frame of delay (16 ms at 60 fps).
  tests/ui-longpress.test.ts: the 2 fps drag case added (fails on the old guard), the timing test allows 2 frames.
- ITEM 1 WATER AT AMONSHIS (open): _harness/arc-work/probe-amonshis.mjs. The point under the babel start view's centre
  (--km=0: the 'standard zoom landing') IS "5.1 km west of Amonshis by the Lake" (nearest living settlement, 5064 m):
  lat 17.88, lon -35.0. It is a palm beach on a coast: land cells at +0.6 / +5.4 m, sea cells -19..-74 m (water = depth,
  level 0). At orbit dist 90 / tilt 62 over it, 609 of 639 selected patches carry a water sheet (almost every patch is
  wet near this coast). SwiftShader shots (amon/b-d90-t*.png; 'turn' does not turn an orbit at a lat/lon) show the beach,
  shallows with palm shadows on the floor, an island — no sheet over a hill seen YET. NEXT: reproduce the owner's own
  path (start view -> wheel deltaY -800 notches at the canvas centre down to 60 m, the start heading), shoot, then the
  same with ?water=0 and with the debug hide list; for any wet patch over land, dump per-vertex tH (water level) vs tG
  (ground) for the dry cells (the 'held just under their ground' rule and the drape lift in ocean.ts VERT ~l.100) — the
  likely culprit is the shore level of dry cells in a mostly-wet patch, or the 18 cm drape on cells the sim calls
  flooded, at the hill's height.
- ITEM 2 CLOUDS (open): deckTunnel (sky/clouds.ts ~1410) bases the clear zone on the global shell (cloudInner/Outer =
  radius + 0.3 / 0.7 x air thickness) with a 20 m edge ramp (inShell); near both shell edges inShell < 1 shrinks the
  near zone and the mist floor; and the in-cloud fog (shader ~l.937) integrates the LOCAL density over min(nearR*0.6, tEnd).
  Owner: white at 456 m (top band) and 220 m (bottom band). NEXT: a probe stepping the owner's stops at the landing spot
  (shots + uNearR / uCamFog / inShell / local hf + cloudDetailed density at the camera), then make the clear zone use the
  deck's local top / base at that spot (wx-dependent) and keep it full over the whole thickness (no taper inside).
- ITEM 4 TAB MEMORY (open): gpumem's by-owner line now exists; soak3's biggest owner is 'planet-0/life (textures)'
  60 MB. Unaccounted in the audit: worker heaps (sim worker, 1-2 patch workers, fieldpack worker: each its own V8 heap
  + transferred arrays), the canvas swap chain, Chrome's own per-tab overhead. NEXT: measureUserAgentSpecificMemory is
  unavailable (not cross-origin isolated); ask the owner for chrome://memory-internals or Task Manager's per-worker rows,
  and add worker heap sizes to the report (each worker posts performance.memory on request).
- #9 A/B ws1 (dist31 default) vs ws0 (?watershare=0), LOOKED: region 1.65/255 — lake, coast, sea identical; the
  difference is far-tree clusters further along their streaming in ws1 (two forest patches) + a label; town 2.09/255 —
  foliage sway only, the sea in the corner identical. 0 errors both.
- GATE check20 (after the handinput change): npm run check 933/933 pass, exit 0; npm run build exit 0 (build-prod19).
- STILL OPEN: #10 compact far-tree format (not started); round-4 items 1, 2, 4 (see ROUND 4 above); soak with
  thousands of frames in a browser (SwiftShader gives ~300 frames in 22 min — needs a GPU machine or the owner's Mac);
  sample the 'copied by owner' list in perf-soak; normalise page owner names.

## SESSION 15b (after the ship of HEAD) — lead's order: (1) ANGLE copies, (2) clouds, (3) Amonshis water, (4) workers
- (1) OWNERS of the ANGLE whole-buffer copies (probe-copies.mjs, dist31, babel 307987276, HIGH 320x180, 3 views x 25
  frames, copies1.log): 6 MB/frame of whole-buffer copies (81 buffers/frame) for 139 bufferSubData/frame of 3.3 MB
  data; + bufferData 1.8 MB/frame, texSubImage 1.8 MB/frame; ~58 MB in flight. Copied since load (88 frames):
  planet-0/vegetation 97.8 MB (524 kB / 131 kB / 98 kB buffers = far-tree bucket matrix / extra / colour arrays,
  flushRanges every frame as cells enter + near rebuilds), planet-0/life 65.5 MB (393 / 524 / 262 kB vertex buffers
  and a 131 kB index: per-frame instance data of people / animals / crowds, re-sent every frame into buffers drawn every
  frame), terrain pages (each landing copies a page's 13 attribute buffers of 168 kB = 2.2 MB: L3-p15 26.8 MB, L4-p5
  19.2, L3-p16 19.2, L3-p18 17.2, L4-p4 17.2 ... the biggest group in total), 'buffers (not in the scene)' 30.7 MB.
  CAVEAT: the 'fresh' / GC-wait count is an UPPER bound — if ANGLE's BufferManager recycles same-size buffers once the
  GPU is done with them (F16/F17 relied on that), steady-state copies of the same buffers allocate nothing new; what
  is certain is the copy bandwidth (6 MB/frame) and the stalls on buffers still in flight.
  NEXT (not started, fresh session): (a) life per-frame instance buffers -> a ring of 3 InstancedBufferAttributes per
  mesh rotated each frame (write the one drawn 3 frames ago; ~2x their 13 MB extra) or uniform/texture path; (b) far
  trees: stage cell landings and flush each bucket at most once every 3 frames into a buffer not drawn since (ring of
  2-3), or append-only into a fresh tail page; (c) terrain landings: prefer a page not drawn in the last 3 frames
  (pool / idle / hidden pages) and batch a frame's landings into it; (d) count 'fresh' only for sizes ANGLE cannot
  recycle (GlTrace's sizesSeen rule) so the GC estimate is not an upper bound.
- (2) CLOUDS landed `?deckfull=0` (sky/clouds.ts deckTunnel): on Gaia (R 3000, air 600 m) the shell is 180-420 m, so
  the owner's 456 m white stop is 36 m ABOVE the shell (inShell 0: near zone 35 m, the deck's top right under the lens)
  and 220 m is 40 m over its base (2.5x rule: 220 m of clear air; every ray but the steepest ran into full cloud). The
  resting clear zone now holds from 20 m under the base to 60 m over the top (fading over 40 m more), at least
  DECK_FLOOR = 450 m (round 3's fine stops had 335-627), and outside the shell a 1e-4 camFog switches the shader's near
  zone on (no fog itself). 540 m: unchanged (the tops visible on the way down). tests/render-decktunnel.test.ts (+1).
  The LOCAL bounds (cloudField's base 0.05-0.1, top 0.2-0.62 / 0.9-1.0 storms of the shell) all lie inside the shell,
  so covering shell-20 .. shell+60 covers them; a per-spot bound would need the weather cube on the CPU. NOT yet shot.
- GATE check21 (cloud fix): 934/934 pass, exit 0; npm run build exit 0 (build-prod20.log). Handed back: context exhausted; (1) elimination, (3), (4) for a fresh session (NEXT above).

## SESSION 16 (2026-11-13 ~02:45Z) — (1) deck shots, (2) ANGLE copies [lead: round 5 = 15-19 MB/frame copies on the M5, priority]
- PROBE probe-deck.mjs (arc-work): babel 307987276, the standard landing (start view centre, lat 17.876 lon -35.0 =
  Amonshis spot; shell 180-420 m), camera RESTING at --stops (orbit dist searched for stats.altitude, autoTilt), shots
  deck/<tag>-aNNN.png + white fraction. dist32 = HEAD build (deckfull on). run-s16a.sh (new), run-s16b.sh (old after
  the copies probes).
- (2) CHANGES (tsc clean; each a perfSwitch, default on):
  `?bufring=0` src/render/bufring.ts: ringify(mesh, names) = 3 BufferAttributes over ONE shared array per attribute;
    uploadPrefix / ringMark rotate the installed member at most once a frame (geometry.setAttribute or
    mesh.instanceMatrix/instanceColor swap; three re-points the VAO) and send it every range written since ITS last
    upload (sorted range list, <= 24 ranges; onUploadCallback clears; the first upload captures the GL buffer, the
    mesh's dispose deletes the non-installed members). Ringed: life/bodies.ts (people, animals, crowds: instanceMatrix
    + iAnim iColA iColB iColC iStyle iFade), boats.ts, camps.ts (instanceMatrix iState iInfo), vegetation near buckets
    (instanceMatrix instanceColor iExtra; also after a lazy-pool grow) and far buckets (+ iHull; flushRanges -> ringMark
    per range). renderer.ts: setRingGL + ringTick() after gpuMem.tick().
  `?freshland=0` chunks.ts FRESH_LAND: PatchPage.drawnAt (keepIndirectTable's onBeforeRender stamps mesh.userData.drawn
    = ringFrame(); water sheet included), .cold = not drawn in the last RING_N=3 frames. alloc(): fullest COLD page with
    room; else a new page (pool.take prefers a cold idle page) while pages < need + max(6, 0.75 need); else the fullest
    (as before). Compaction (packed) prefers cold pages, never opens one.
  gpumem.ts: in-use now follows each VAO's CURRENT buffer per slot (vaoSlots); a re-pointed buffer keeps the frame it was
    last drawn through it (bufFrame) — without this a ring's members all looked in use through the shared VAO.
- NODE tests/render-bufring.test.ts (4): addRange; ring rotation (3 distinct buffers on 3 frames, member 1 on frame 4
  gets frames 2-3's ranges, same array, instanceMatrix swapped); gpumem re-pointed slot; flight (grid 48, 900 frames,
  draws stamped): page writes into pages drawn in the last 3 frames 185 / 3947 = 4.7% (freshland=0: 4190 / 5848 = 72%),
  pages peak 168 vs 146 (+15%). chunkpool / chunksoak / chunkrest / pagenormal / lazypools / gpumem: 20/20 pass.
- dist33 = HEAD + the above. Browser A/B queued (run-s16b.sh): copies-s16on.log / copies-s16off.log.
- BROWSER copies-s16on.log (dist33, HIGH 320x180, 3 views x 25 flight + 12 rest frames): vegetation GONE from the copy
  list; per frame flight 9.6 / 14.8 / 5.8 copies (1.4 / 1.5 / 0.8 MB), rest 4.3 / 25 / 18 (0.6 / 4.0 / 2.4 MB). The rest
  is 'planet-0/life' 524 / 393 / 262 kB vertex + 131 kB index = road RIBBONS (roads.ts putGrowable, 7 attributes x 2
  ribbons, rebuilt every ~120 m and as heights stream) + terrain pages (a few) + godfx 288 kB.
- (2b) putGrowable rings too (upload.ts: ringGeo(geo, name) incl. 'index' via geo.setIndex; ringDrop frees all members
  when a bigger attribute replaces a ring). Rings: roads ribbons, fx/particles. test (+1, 5/5). dist34.
  probe-copies.mjs prints 'rest copies by owner' (copied during the rest frames only). run-s16d.sh: copies-s16on2
  (dist34), then deck new / old (dist32; deck-new's first run was killed after the 540 m stop to free the slot).
- copies-s16on2 (dist34): vegetation + roads gone; the remaining life copies were BUILDING pages (bldbatch.ts BldPage,
  2^15-vertex BatchedMesh pages: position 393 kB, 524 kB 4-comp, index 131 kB) taking new buildings while drawn.
  -> ringIntercept(geo) (bufring.ts): every attribute + index of a BatchedMesh page ringed, the members' addUpdateRange
  overridden to feed the ring (three's setGeometryAt / optimize call it), made after the page's first addGeometry
  (BldPage.addGeom; again after a non-paged grow). Decals (fx/decals.ts) ringed too. test (+1, 6/6).
- copies-s16on3 (dist35): whole-buffer copies 0.57 MB/frame x4.4 (off run: 8.26 x100), GPU waits 4 vs 18; flight
  0.2 / 6.4 / 0.6 copies a frame; life GONE; the rest = terrain pages at REST (~7 copies a frame): compaction moving
  patches into drawn pages (packHot 101 of 6528 landings; capHot 13; FRESH_STATS / window.__GENESIS_FRESH__).
  -> compaction moves a page's patches only when cold pages have room for them all, else the slack waits (bounded by
  alloc's allowance). node flight: hot page writes 16 / 3828 = 0.4%. dist36. run-s16g.sh: ab16-off shots, copies-s16on4
  (dist36), deck new / old.
- IMAGE A/B ab16/on-*.png (dist35) vs ab16/off-*.png (bufring=0 freshland=0), perf-descent lowsun phase babel 640x360;
  diff: python3 _harness/arc-work/imgdiff.py A B [OUT].
- A/B LOOKED (dist35 on vs bufring=0 freshland=0, babel 640x360, 0 errors both): town 2.66/255 (0.22% px > 16): lake
  ripples / sparkle and foliage-sway specks only; houses, ground, roads identical. regionlow 1.63, ridgelow 1.42 (city-
  light sparkle, cloud edges, the pulsing selection ring), townlow 6.31 mean but 0.16% > 16 (uniform in-cloud haze
  noise at 209 m; the ring). No missing / stale geometry. Diffs ab16/d-*.png.
- GATE check23 (all of the above incl. compaction rule): npm run check 940/940 pass, exit 0; npm run build exit 0
  (build-prod21.log).
- copies-s16on4 (dist36): mean 0.43 MB/frame x4.4 (from 8.26 x100 off), flight 0.4 / 7.6 / 0.2 copies a frame, rest
  2.4 / 0 / 11.7; packHot 0; the rest copies in view 3 = capHot 52 (level L3 at its page allowance while compaction
  waits). -> at the allowance a COLD idle pool page is still taken (PagePool.hasCold: no new memory). node flight hot
  10 / 3823. dist37; run-s16h.sh = copies-s16on5 after the deck runs (run-s16g: deck new, old at 400x225).
- GATE check24 (final code incl. hasCold): npm run check 940/940 pass, exit 0; npm run build exit 0 (build-prod22.log).
- (1) DECK SHOTS new (dist32 = HEAD deckfull on, 400x225, babel standard landing, resting), LOOKED, 0 errors:
  540 m (alt 527) cloud tops + coast/forest/sea around them (white 0.27 = the tops); 456 m (465) ground, coast and
  translucent near cloud, NOT white (0.03); 383 (392) mist over the coast, ground visible (0.03); 320 (329) coast and
  sea through mist (0.07); 266 / 220 / 181 m clear, coast + trees sharp, the deck's underside beyond (white 0). Owner's
  round-4 white stops (456, 220) are clear. deck/new-aNNN.png.
- QUEUED at hand-back (run-s16g.sh -> run-s16h.sh): deck-old (?deckfull=0, deck/old-aNNN.png, deck-old.log) for the
  side-by-side, then copies-s16on5.log (dist37 = final code). NEXT for a successor: look at old vs new, check on5 (view 3
  rest copies should drop from 11.7 to ~0; capHot ~0); then round-4 item 3 (Amonshis water: probe-amonshis.mjs, plan
  under ROUND 4) and item 4 (worker heaps in the report).

## SESSION 17 (2026-11-13 ~06:00Z) — ROADMAP-60FPS steps 1-2 (gputimer, report headline, gpuprobe, freeze)
- Binding plan: _harness/arc-work/ROADMAP-60FPS.md. Order: steps 1-2 shippable first (decide the branch on the Mac), then
  4 (upsched), 6 (hdrmerge), 7 (orthodepth), 3 (rtalias), 5 (ringfence/lifesplit). Every step a perfSwitch, default on.
- STEP 1 (code): perfreport.ts `?gputimer=0` (no TIME_ELAPSED queries; 'gpu ms: off'); report v2: line 2 = HEADLINE
  (fps | interval p50/p95 | main ms/frame and % of wall | long tasks, ms NOT inside the frames' main work, per s); a NOTE
  line (ANGLE-Metal gpu ms = summed command-buffer spans); a 'machine (fill in ...)' line for pressure colour / swap /
  GPU process / tab MB / separate instance + js heap and deviceMemory.
- STEP 2 (code): src/render/gpuprobe.ts `?gpuprobe=1` (default off): probeGpu(r, fsq, w, h, existing, tag): fresh rgba16f
  A,B at render size + a,b 64x64, made+cleared+programs linked untimed; empty-finish floor; timed sets, each in one
  gl.finish: fresh-full 32 copies A<->B, fresh-64 32 copies, hdr->fresh 8 (samples post.hdr.texture), atlas->fresh 8
  (sampler2DShadow on the shadow atlas). First batch 4 passes; the rest only if < 30 ms a pass (the line says passes).
  Runs at renderer frame 3 ('boot') and while the report records (start + every 5 s, 'rec'); probe frames and the next
  (its interval) are left out of all report stats. Lines 'gpuprobe <tag> ...' in the report; console.info; window
  .__GENESIS_PROBES__.
  src/render/freeze.ts `?freeze=1` (default off): FREEZE.active once chunks.select saw no ready/pending/built for 90
  frames in a row (freezeLandTick); then: chunks landReady stops; ringMark drops marks (returns true) and uploadPrefix
  returns (bodies/boats/camps/roads instances/cover/veg rings); vegetation.update returns after the wind; groundcover
  .update, roads.update, particles.setEmitters, fieldtex.update, dirtex.update, overlaytex.fill return; app.ts frame():
  sim.setSpeed(0) while active (ONE line in app.ts, ui lane file: noted). Report line 'freeze: ACTIVE for N s' / waiting.
- PROBE _harness/arc-work/probe-freeze.mjs (babel town view at rest, waits for the freeze, shots <tag>-1/-2, report).
  dist38 = unminified build of the above. run-s17a.sh (queued behind run-s16g/h): freeze-s17a-on.log (freeze=1
  gpuprobe=1), freeze-s17a-off.log (freeze=0 speed=0 gpuprobe=1); shots freeze/fz1-*.png, fz0-*.png.
- s16 QUEUE RESULTS: copies-s16on5 (dist37): rest copies 0.00 MB/frame in ALL 3 views (view 3 was 11.7 copies/frame);
  flight 0.02 / 0.46 / 0.10 MB. deck old (deckfull=0) vs new (dist32), LOOKED side by side: old 456 m = opaque white
  slab over the coast (white 0.292), old 220 m = all white-grey fog (lum 0.743); new 456 = translucent deck, coast seen
  (0.03), new 220 = clear coast + forest (0.454). The owner's round-4 white stops are fixed by deckfull=1.
- FIRST local freeze run (dist38, high 400x225) was useless: SwiftShader ~35 s a frame at high, and landing NEVER went
  quiet at rest. FINDING (open, check later): at rest, camera still, sim speed 0, low preset, babel town view, the
  terrain keeps BUILDING ~60-100 patches a frame (report 'built' per frame, patches built 1223-2067 in a 20-frame
  recording) while draws / tris stay constant -> LOD churn (build -> evict -> rebuild?) in chunks.ts (evict budget
  max(maxCached, 1.5 x selected); lastUsed). Costs worker + main 'planets' ms (13-24 ms here). Not yet traced.
- freeze REWORK (because of that): FREEZE takes hold when every patch manager is quiet FREEZE_QUIET (90, ?freezequiet=)
  frames OR the camera (each manager's camBody) rested FREEZE_STILL_S (15 s, ?freezestill=) — the report says which
  ('by landing converged' / 'by camera at rest ... while landing was still busy'). freeze=1 sets sim speed 0 FROM THE
  START (so every body frame is at rest). Report: new line 'uploads per frame (all slots): ...' (every upload kind,
  not just the top 16). gpuprobe: each sync = gl.finish + a 1-texel gl.readPixels (a read must wait); 'queue drain'
  ms (the first sync: frames in flight + set-up) printed separately.
- LOCAL PROOF (dist40, low 256x144, babel town view, still camera; freeze-s17c-on/off.log, gpuprobe-s17c.log):
  freeze=1: active 'by camera at rest 15 s while landing was still busy'; recorded 45 s: gl trace has NO bufferData /
  bufferSubData / texSubImage at all (uploads inside a pass 0/frame), patches built 0, draws 149 constant, main 11.5
  ms/frame. freeze=0 speed=0: uploads inside a pass 0.4/frame, patches built 1223, main 30.8 ms. Shots fz0-2 vs fz1-2
  (LOOKED): same town, lake, trees; diff 2.10/255, 2.8% px > 16 = foliage sway + water sparkle specks only (d-fz.png);
  fz1-1 vs fz1-2 (same frozen run) 3.24/255: the animation floor.
  gpuprobe=1 (192x108): boot fresh-full 0.54 · fresh-64 0.15 · hdr 0.44 · atlas 0.88 ms/pass; rec 0.38/0.13/0.59/0.31;
  rec at 49 s 0.30/0.10/0.29/0.21 (that probe's queue drain held a whole 43 s SwiftShader frame: hence drain split out).
  Probe frames left out of the stats (+2). 0 page errors in all runs.
- GATE check26 (final steps 1-2 code): npm run check 939/939 pass, exit 0; npm run build exit 0 (build-prod24.log).
  MAC-TEST-PROTOCOL.md: new section 'ROADMAP steps 1-2' (separate Chrome instance, machine line, ABAB, rows base /
  gpuprobe=1 / freeze=1&gpuprobe=1 still camera / gputimer=0).
- HANDED BACK for the ship. NEXT (session 17 resumed or successor): read the owner's gpuprobe / freeze reports and pick
  the branch (ROADMAP §2 step 2); then step 4 upsched, 6 hdrmerge, 7 orthodepth, 3 rtalias, 5 ringfence/lifesplit;
  and trace the at-rest patch churn above (node: chunk soak with a still camera, count builtTotal per frame).

### SESSION 17b (after the ship of steps 1-2) — lead: (1) the patch churn at rest, (2) step 4 upsched
- CHURN TRACED (probe-churn.mjs: wraps every ChunkLOD's store / evict in the page; dist40 babel town, low, speed 0,
  still): lod 0 live 857-921 = budget 921 (1.5 x 614 selected), ~40 builds a frame, as many evicted, pending stuck at
  96-99 = MAX_INFLIGHT/2 = the PREFETCH cap, no Patch object rebuilt within 8 frames (an LRU cycle of ~23 frames).
  CAUSE (chunks.ts select, worker path): PREFETCH built the 4 children of every leaf within 1.35x its split distance
  but never stamped them in use (only visited patches get lastUsed = frame); the wanted set (selected + split ancestors
  + prefetched children) exceeded the cache budget, so evict() dropped the prefetched children (LRU, + 64 slack every
  time) and the next frames' prefetch asked for them again — forever, camera still.
  NODE REPRO tests/render-chunkchurn.test.ts (fake worker port from render-patchworker; still camera; budget 1.5 x
  selection): before 64 patches a frame forever (12800 over 200 frames at 230 m and at 60 m); cap 800 none.
  FIX `?prefetchkeep=0` off (default on): a prefetched child already built is stamped in use (kept), a new one is asked
  for only while live + pending < cacheBudget() (the eviction's budget, now one method). Drawn selection unaffected
  (prefetched children are never drawn until the split). After: 0 builds at rest, selection identical (test asserts
  the drawn selection is constant), live 261/371/375. Render tests 135/135 (patchworker equality with the main-thread
  path included).
  BROWSER (dist41, churn-s17d.log): 8 still frames: builds 0, evicted 0, pending 0, ready 0, live 921, selected 614
  (was ~40 builds/frame, pending 99). Image pair prefetchkeep 1 vs 0: churn-s17d-pk1/pk0.log, freeze/pk*.png.
- STEP 4 upsched (`?upsched=0` off, default on) — src/render/uploadsched.ts (new):
  earlyAttr(attr): after three's first upload (GL buffer captured in onUploadCallback), needsUpdate = true between the
  end of a frame's passes and the next frame's 'uploads' slot takes three's updateRanges, does NOT bump the version,
  and flushUploads() sends them by gl.bufferSubData on COPY_WRITE_BUFFER (no VAO / element binding touched; index
  buffers too, checked once with getError, else back to three) and then runs the attribute's onUploadCallback (the
  rings clear their dirty lists there). Registered: every ring member (bufring.ts Ring: bodies, boats, camps,
  vegetation, roads, decals, particles, building pages) and every terrain page's attributes + index (chunks.ts, after
  the page's first addGeometry; earlyGeo). texUpload(tex) (owners: vfx emit/block, bldbatch texU state / visibility,
  fieldtex landings, dirtex, overlaytex) and scheduleUpload(fn) (citylights' texSubImage boxes + generateMipmap) go up
  in the same slot (renderer.initTexture / the owner's own GL). renderer.ts: setUploadGL; flushUploads(r) in the
  'uploads' slot (after the PRE_UPLOAD flush); uploadFrameBegin() at the END of render() (so the next frame's updates
  and a worker's between-frame landings wait for the slot). Until the first flush (node, no renderer) all immediate.
  Not done from the roadmap's step-4 list: owner DOUBLE-BUFFERED data textures, chunks landReady byte cap + camera-
  velocity prefetch, farcrown:280 / ships:521 (creation-time / label canvases: left).
  test tests/render-upsched.test.ts (fake GL): ranges sent on COPY_WRITE_BUFFER with the right offsets and bytes,
  version untouched, callback ran, texture + task in the slot, the old path after the flush.
  Browser A/B queued: run-s17e.sh (dist42, medium 256x144 = 2 cascades): up-s17e-{1,0}-s{0,1}.log, shots
  freeze/up{1,0}-s0-*.png (speed 0 image pair), speed-1 runs for 'uploads inside a pass' by slot.
- (container restart ~09:15Z killed run-s17e mid-way; relaunched; all source edits had survived/autosynced.)
- STEP 6 hdrmerge (`?hdrmerge=0` off, default on): three resolves an MSAA target (blitFramebuffer) after EVERY
  r.render into it, so decals then water = 2 resolves + 1 reopen of the 4x hdr (setRenderTarget itself does not rebind:
  three's state.bindFramebuffer skips the same framebuffer). fx/decals.ts: draw() split into prepare() (instances +
  uniforms; false = nothing to draw) + the render; with hdrmerge the decal materials are transparent:false (same
  CustomBlending; same program) at renderOrder -1000/-999/-998 so they sort FIRST in the opaque list, before the water
  sheets (renderOrder 50, opaque ocean material) — exactly the old pass order. godfx.prepareDecals(); renderer.ts: one
  r.render with cam.layers.mask = (water ? 1<<2) | (decals ? 1<<5). Layer 2 holds only chunk water sheets, layer 5
  only the decal meshes (grep).
- STEP 7 orthodepth (`?orthodepth=0` off, default on): zcons.ts orthoDepth(mat) defines GENESIS_ORTHO_DEPTH;
  enableOrthoDepth() (renderer, right after enableConservativeDepth, before any compile) wraps ShaderChunk
  logdepthbuf_pars_fragment / logdepthbuf_fragment in #ifndef GENESIS_ORTHO_DEPTH. Twins marked: terrain
  (makeTerrainDepthMaterial), vegetation near + far depth, bodies (makeBodyDepthMaterial), buildings / boats / camps
  (makeBuildingDepthMaterial), ships (makeShipDepth). All only installed by swapDepth between SunShadows swap(true)
  and swap(false) (renderer.ts shadows.render / shadows.warm): never a perspective camera. No polygonOffset anywhere
  (grep), depth clamp off in the shadow pass: gl_FragCoord.z == the rasterised depth, so the atlas is the same.
  NOTE: the terrain casts with its depth twin (planetview.swapDepth), not the 1900-line terrain shader.
- UPSCHED BUG FOUND + FIXED (A/B dist42 medium 256x144 speed 1, up-s17e-*.log): upsched=1 had main 1789 ms/frame
  (uploads slot 801, scene 907; bufferSubData 3.27 MB/frame, one call 6.4 s) vs upsched=0 30.6 ms (0.29 MB). Cause:
  BatchedMesh.setGeometryAt holds the attribute object it fetched BEFORE its addUpdateRange, which ringIntercept turns
  into ring.mark (rotating the installed member); three then sets needsUpdate on the OLD member with no ranges, and
  earlyAttr sent that whole array (a building page, ~0.4-0.5 MB) into a buffer the GPU was still reading (stall).
  Fix: a ring member drops a bare (range-less) needsUpdate once its buffer exists (the ring's dirty list holds those
  bytes for its next install); test 'upsched: a ring member drops a bare needsUpdate'. After (dist44, s17f-b1s1.log):
  main 41 ms (uploads slot 2.0 ms), bufferSubData x52 0.42 MB/frame ALL in the uploads slot, texSubImage2D 4.3 of 6.6
  in the slot; 'uploads inside a pass' 2.1/frame (scene texSubImage2D 1.9 left: textures not yet owner-scheduled).
- perfreport GlTrace (s17): an upload counts 'inside a pass' only if the NEXT draw goes into the same framebuffer (no
  bindFramebuffer between): one between the last draw into a target and the first into another splits nothing (that is
  where the uploads slot sits). tests/render-gltrace.test.ts updated.
- GATE check28 (churn fix + steps 4, 6, 7 + detector): npm run check 944/944 pass, exit 0; npm run build exit 0
  (build-prod26.log).
- IMAGE A/B (dist44, medium 256x144 = 2 shadow cascades, babel town view, speed 0, LOOKED; s17f-*.log, freeze/*.png):
  noise floor b1 vs b2 (two base runs) 3.22/255, b1-1 vs b1-2 (same run) 3.02. vs base: orthodepth=0 2.73,
  hdrmerge=0 3.12, upsched=0 2.94 — all at/below the floor; diff images = foliage-sway / water specks, shadows (palm,
  houses) identical. 0 page errors. (No decals in that view: hdrmerge re-checked with injected decals, below.)
- UPSCHED A/B speed 1 (dist44): upsched=0: shadows bufferSubData x17 + scene x29 per frame, texSubImage in shadows /
  scene / post, 'uploads inside a pass' 4.6/frame. upsched=1: ALL bufferSubData (x52, 0.42 MB) in the uploads slot,
  texSubImage 4.3 of 6.6 there, inside a pass 2.1/frame (scene texSubImage2D x1.9 left = textures no owner schedules
  yet: three's own BatchedMesh tables / others; next). SwiftShader main ms not comparable (41 vs 31, planets-slot noise).
- probe-freeze.mjs --decals=1: patches the page's DecalPass.prepare to add 4 decals (scorch / ring / FX light / tint,
  all 3 groups) at the ground point at the screen centre every frame. run-s17g.sh: dc1 / dc0 (hdrmerge=0) / dc2.

## SESSION 18 (2026-11-15 ~08:50Z) — round 7 (MAC-ROUND7-9a6b6521): freeze=1 still ~2 fps -> GPU-EXECUTION branch: step 8 revz, the reload leak, the pale triangles
- Round 7 decision (ROADMAP §2 step 2 rule): base 1.3-1.9 fps, freeze=1 1.8 / 2.2 fps in a clean separate Chrome with
  pressure green at the start: uploads / frame structure / other apps are NOT the floor. Steps 7-9 carry the weight.
- STEP 8 `?revz=0` off (default ON where EXT_clip_control exists) — src/render/shaders/revz.ts (new):
  * chooseDepthMode(gl): the Renderer now gets the canvas's webgl2 context ITSELF (same attributes three would ask
    for) before `new WebGLRenderer({ context })`, asks getSupportedExtensions for EXT_clip_control, and builds three
    with EITHER reversedDepthBuffer: true OR logarithmicDepthBuffer: true (three compiles the log chunks or none: it
    cannot be both). No extension / ?revz=0 -> exactly the old path (log depth + zcons + orthodepth). confirmDepthMode
    re-checks three's own state after construction.
  * report: two new header lines after 'perf fixes': `depth: REVERSED-Z float ... | EXT_clip_control YES/NO | why`
    and `depth extensions: +EXT_clip_control +EXT_conservative_depth ...` (+ present, - missing); the switch line
    prints revz=1 / 0 / 0(no-ext) and zcons=0(revz).
  * decoders: ONE chunk DEPTH_DECODE (= atmosphere.glsl.ts LOGDEPTH_DECODE, same name kept) keyed on three's own
    `USE_REVERSED_DEPTH_BUFFER` prefix define (every non-raw ShaderMaterial gets it while reversed depth is on):
    viewZFromLogDepth(d, far) = n·far / (d·(far − n) + n) (n = CAM_NEAR 0.05) | exp2(d·log2(far+1)) − 1;
    depthIsSky(d) = d <= 0 | d >= 0.999999; GENESIS_NDC_NEAR = 1.0 | −1.0.
    Edit sites: post/pipeline.ts (linDepth copy, god-ray mask), post/gtao.ts (viewZAt, viewPosAt), sky/atmosphere.ts
    (viewDir, sceneDistance), sky/clouds.ts (march x3 sky tests + zAt, 2 view rays), fx/decals.ts, fx/rainbow.ts,
    fx/vfx.ts (3 rays, vertex shader), fx/screenfx.ts (viewRay) — every `uInvProj * vec4(ndc, -1.0, 1.0)` (a ray
    through the NEAR plane; with a reversed projection z = −1 un-projects BEHIND the eye) now uses GENESIS_NDC_NEAR;
    fx/launch.ts x2 (`gl_Position.z = -w * 0.999` would be clipped at z < 0 with clip z in 0..1: +w * 0.999 there).
    Everything else (ocean, decals, particles, vfx soft depth, FX_DEPTH_GLSL, screenfx, app linearDepthAt) reads the
    R32F LINEAR depth copy and needed nothing. Starfield / orbit lines / ship points set clip z by hand with
    depthTest off (0.99999·w, 0): inside 0..w in both conventions. three's LineMaterial handles reversed itself.
  * shadows: standardDepth(r, true/false) (state.buffers.depth.setReversed) around SunShadows.init / warm / render:
    the cascades keep standard depth, their ortho cameras are never reversed (three reverses a camera at its first
    draw in reversed mode only), their twins link without USE_REVERSED_DEPTH_BUFFER, LessEqual compare and uShadowMat
    unchanged -> the atlas is what it was. (No gl_FragDepth in the twins either way now: no log chunks at all.)
  * CPU: the camera is reversed at construction (three would only do it at its first draw; the frustum and uInvProj
    are read before); frustumFromProjection(out, m, camera) passes camera.reversedDepth (renderer.ts view frustum,
    bldbatch per-instance culling). projectToScreen / sun uv / eclipse / water uProj / cloud reprojection use x, y, w
    only. zcons is skipped (ZCONS.why 'not needed'), DEPTH_CLAMP stays off.
  * precision: hdr depth is already DepthTexture FloatType (D32F, also the MSAA renderbuffer); d ~ n/w has float's
    own relative precision: tests/render-revz.test.ts decodes three's own reversed projection at 0.05 m .. 1.9e7 m to
    < 4e-7 relative, and 2 cm at 1 km / 1 m at 1000 km / 5 cm at 7.6 km stay distinct float32 depths.
  * tests/render-revz.test.ts (5): the choice with / without the extension and switched off, the report lines, the
    decode round trip against three's matrix, distinct depths, the chunk's two branches, reversed frustum == standard
    frustum on 4000 random spheres.
- LOCAL: headless Chromium (ANGLE SwiftShader) EXPOSES EXT_clip_control: reversed=true, camera reversed, boots, renders
  (s18/dbg1.png). Whether Chrome 157 ANGLE-Metal exposes it is what the Mac's next report prints.
- RELOAD LEAK `?pagerelease=0` off (default on) — src/render/pagerelease.ts (new): nothing released anything when a
  page went (grep: no pagehide / unload / loseContext in the render or app code; ui/embed.ts pagehide only autosaves).
  The old document's WebGL context (~0.7 GB GPU) and workers lived until GC — or as long as Chrome kept the whole
  page in its back/forward cache (the owner's rounds are NAVIGATIONS to another ?query in the same tab: those pages
  are bfcache candidates, frozen with all their memory). Now on `pagehide`: render workers (patch x1-2, fieldpack)
  terminated; WEBGL_lose_context.loseContext() (the GPU process frees everything of the page at once); canvas 1x1;
  Renderer.dispose(). `pageshow` with persisted (a bfcache restore of a page without its context) -> location.reload
  (the autosave ran on the way out; saves.ts uses lastThumb when the page is hidden, never the canvas). Installed at
  the FIRST FRAME so its listener runs after the UI's. The sim worker is not touched (client lane; it writes that
  save). tests/render-pagerelease.test.ts (4).
- IMAGE A/B revz=1 (r1) vs revz=0 (l1), distA, medium 320x180, speed 0, babel 307987276, LOOKED at every pair + x4
  diff (s18/shots/r1-*.png, l1-*.png, d-*.png, sheet-*.png; probe _harness/arc-work/probe-revz.mjs):
  town 3.09/255 (2.85% px > 16) | region 1.94 (1.49%) | ridge 2.20 (1.44%) | orbit 1.07 | night 1.00 | towndecal
  (in the cloud deck at that distance: useless for decals) 1.49 | shore 6.56 (15%: cloud-reflection drift + the
  artefact below, in the LOG image). The s17 floor for this scene was 3.0-3.2. Houses, tree and house shadows, the
  lake, the shoreline line, clouds against terrain, the aurora, the starfield and the planet limb are the same; no
  z-fighting seen anywhere in the reversed images. NOTE the run-to-run floor is LARGER than in s17 when runs take
  different wall time (r1 vs r2 town 8.5/255: the lake's coarse water sheet and the clouds were in another state).
  The only differences that were not noise: (1) the god's pointer ring, present only when the SIM's hand was active
  inside its 30 s window (timing; forced on with hand.force in the later runs), (2) the triangles below.
  0 page errors, no shader / GL errors in either path. Report header prints the two depth lines in both modes.
- RELOAD LEAK, LOCAL PROOF (probe _harness/arc-work/probe-reload.mjs, ps RSS of the browser's GPU process / renderer):
  * 4 navigations in one tab, headless Chromium: NO growth with or without the fix (GPU MB 649 -> 447 -> 463 -> 476
    off; 634 -> 910 -> 466 -> 493 on; with the back/forward cache flag left on, off: 647 -> 454 -> 460 -> 482). Headless
    frees the old document at once and does not keep it in the bfcache, so the Mac's doubling is NOT reproduced here.
  * what IS proven (--inpage=1: the page stays alive, as a bfcache-kept page does, and gets a pagehide): pagerelease=1:
    GPU process 657 -> 243 MB (414 MB freed within 4 s), renderer 869 -> 760 MB, 2 workers ended, context lost;
    pageshow(persisted) -> the page reloads. pagerelease=0: 623 -> 703 MB, nothing freed, no reload.
  So the release works when a page is kept; whether the Mac's growth was kept pages is for the next round (same 3
  loads in one tab, watch GPU process / tab MB; A/B `?pagerelease=0`). Tab JS heap of a kept page is NOT freed by
  this (the app still holds the world); only its GPU memory and render workers.
- THE OWNER'S 'LARGE FLAT TRIANGLES' — REPRODUCED AND FIXED (a regression of step 4 upsched, new in 9a6b6521):
  * repro: distA revz=0, views town -> towndecal -> shore: large flat triangles over the sea (l1-shore: white + dark
    blue; el-shore: two dark-blue ones; el-town-2: a white one by the houses); not in the shot 2 frames after the cut,
    there 10 frames later, gone on the next visit; still there with the life layer hidden (not boats / buildings).
  * cause (uploadsched.ts earlyAttr, terrain pages via earlyGeo): three r186 BatchedMesh.setGeometryAt does
    `dstAttribute.needsUpdate = true` and only THEN `dstAttribute.addUpdateRange(...)` (three.core.js:27044-27045).
    The scheduler's needsUpdate setter took the attribute's ranges at that moment: none on the first landing (so the
    whole array went up), and the range three added a line later stayed on the attribute. From then on every
    landing sent the PREVIOUS landing's range and left its own behind: a patch's vertices (all 13 attributes and the
    index) reached the GPU only when the next patch landed in the same page. Until then that slot drew the
    vertices of the patch that had the slot before, as terrain and as its water sheet: flat triangles of some other
    place, floating. s17's note had the order the wrong way round (it only mattered for the rings, which were right).
  * fix: earlyAttr(..., lateRanges) for earlyGeo attributes: the setter only notes the attribute; flushUploads reads
    its updateRanges THEN (after three added them), the whole array if none came. tests/render-upsched.test.ts (3rd
    test, a real BatchedMesh): each landing's own vertices go up at the next flush, nothing left behind — FAILS on
    the old code, passes now.
  * the Mac's bisect switches for it, in order: `?upsched=0` (must cure 9a6b6521), then if anything is left:
    `?bufring=0`, `?freshland=0`, `?watershare=0`, `?pagenormal=0`, `?hdrmerge=0`, `?prefetchkeep=0`,
    `?orthodepth=0`, `?pagepool=0`, `?patchworker=0`; `?hide=life` / `?hide=terrain` / `?water=0` / `?decals=0` to
    name the layer.
- AFTER THE FIX (distB = fix + revz + pagerelease; g-gl.log revz=0, g-gr*.log revz=1; shots gl-*, gr-*, sheet-g*.png):
  the same cut sequence town -> towndecal -> shore -> town on the log path: NO triangle in any shot (it was in 2 of 2
  such sequences on distA with revz=0 and in 1 of 1 with revz=1 (er-shore, er-shore-2): not a depth matter).
  revz=1 vs revz=0 town on distB: 3.78/255 (3.58% px > 16; foliage sway + the lake sheet's edge), hand ring drawn in both.
- NOT image-proven: decals under revz. The injected decals (probe --views=towndecal) drew in NEITHER mode (the probe's
  injection, not the renderer: nothing to compare). What stands for them: the only thing revz changes for decals /
  vfx / rainbow / screenfx is the near-plane ray, tests/render-revz.test.ts (6th test: same ray in both conventions;
  the old constant un-projects behind the eye when reversed), and their depth input is the linear copy the water,
  clouds and AO pairs already agree on. Roads: none close enough in these views to judge z-fighting.
- Seen in BOTH modes and not from this session: the lake by Rubolhin first draws as a rectangular translucent sheet
  over the grass (a coarse water patch) before the fine patches land (sheet-g.png) — the owner's round-7 item D.
- GATE: check2.log (after the upsched fix): npm run check 1004 pass, 0 fail, EXIT 0; npm run build exit 0. (check1,
  before the fix: 1001 pass, 1 fail = tests/arc-determinism, the arc lane's.) The 6th revz test was added after
  check2: node --test tests/render-revz.test.ts 6/6, tsc clean.
- NEXT: Mac round 8 on this build: read the two `depth:` header lines; ABAB `?revz=0` vs default, `?pagerelease=0`
  vs default over 3 loads in one tab (GPU process / tab MB); the triangles should be gone (`?upsched=0` if not).
  Then step 9 (shcache). Open: a decal image pair under revz (fix the probe's injection or fire a real miracle);
  roads close-up pair; the tab's JS heap of a bfcache-kept page (app lane: drop the world on pagehide).
- FINAL DEFAULT: `revz` is OFF by default, `?revz=1` turns it on (lead's rule: default off unless every view is proven
  equal). Reason: the last pairs on distB (gr-shore vs gl-shore 10.2/255, gr-town vs gl-town-2 8.4/255) differ beyond
  the floor — by cloud drift and by the lake's coarse-sheet state, both of which also differ between two runs of the
  SAME mode (r1 vs r2 town 8.5; l3-town vs l3-towndecal), so they prove nothing either way; decals and roads are not
  image-proven. Nothing that looked like z-fighting or a depth error was seen in any reversed image. The report's
  `depth:` lines print EXT_clip_control YES/NO in both modes. Mac round 8: ABAB default vs `?revz=1`.
- GATE check3.log (final tree, revz default off): npm run check 1005 pass, 0 fail, exit 0; npm run build exit 0 (build-prod3.log).

## SESSION 19 (2026-11-16 ~16:00Z) — round 9 (MAC-ROUND9): pure GPU shading cost -> PART A bisection build, PART B the terrain material cache
- READ FIRST (changes the picture of round 9): rounds 2-5 printed 22-40 M triangles a frame on the Mac (scene ~8-10 M +
  shadow ~19 M) for a 1.6 MP canvas: the opaque scene pass has ~5 triangles per PIXEL. A fragment shader runs once
  per triangle per covered 2x2 pixel quad (4 invocations at least, for the derivatives), and with MSAA once per
  triangle touching ANY of a pixel's 4 samples. With sub-pixel triangles the terrain / tree shaders therefore run
  10-20x per pixel, not once. This explains what the per-pixel arithmetic cannot: ~100 noise calls = ~10^4 ALU ops per
  invocation is ~5 ms for 1.6 MP on an M5 if run once per pixel, yet the frame is 600 ms; MSAA off halves it (a
  sub-pixel triangle that misses the pixel centre makes no fragment without MSAA); the small window is 5.6x faster
  for 13 % of the pixels; flat material (no shading at all) is still ~147 ms (the triangles themselves).
  So the frame is (invocations = triangles x quads) x (cost per invocation). PART B cuts the second factor (store
  once, sample); the first factor (triangle density per pixel: terrainPixelError 4 on Ultra, tree LODs) is the next
  item if the cache alone is not enough — the flat-material floor says it will matter.
- PART A switches (all default off / none; every one is printed in the report header's switch line):
  * `?tshade=<list>` terrain fragment cuts, compile-time (src/render/shaders/shadecut.ts + terrainmat.ts TS_ defines):
    nonoise (every snoise / snoiseGrad / fbm3 / fbmAA / vnoise / voronoi3 call returns a constant), novor (voronoi3
    only), fbm1 (fbm3 = 1 octave), noshadow (5 PCF taps), nocloudsh (cloud shadow cube lookups), nojoints (rk_joints
    rock blocks), noveg (grass / shrub / canopy / crop layers), nolayers (snow sand ash lava wet ice burnt road fire),
    nofloor (forest floor, groundfloor.ts), nobump (bump + micro normal), nolight (sun / moon / sky block), nosurf
    (constant surface: lighting cost only), albedo (unlit albedo: surface cost only), all (every cut except
    nolight / nosurf / albedo).
  * `?vshade=` `?wshade=` `?bshade=` (vegetation, water, buildings): nonoise novor fbm1 noshadow all (the same macros).
  * `?overdraw=1` (src/render/overdraw.ts): every layer-0 material writes one constant, additive, depth test off;
    brightness = fragments rasterised per pixel. Use with `&atmo=0&clouds=0&water=0&gtao=0&bloom=0&godrays=0&lum=0&fx=0`.
  * `?zpre=1`: terrain depth prepass (its own twin: the terrain's vertex shader, empty fragment, colorWrite off, on
    layer 8) before the colour pass; `invariant gl_Position` + `invariant vFragDepth` on both programs; the colour pass
    is unchanged (LEQUAL, depth write on), so the picture cannot change unless the two depths differ. Only the
    terrain: it already draws last among the opaques (renderOrder 50), so everything else's depth is there before
    it. NOTE: with log depth a fragment shader writes gl_FragDepth, so the prepass only pays through zcons
    (conservative depth) — or with `?revz=1` (true early-Z). Test `zpre=1` and `zpre=1&revz=1`.
  * msaashade: NOTHING forces per-sample shading: no gl_SampleID / gl_SamplePosition / `sample` / `centroid`
    qualifier, no alphaToCoverage, no sampleCoverage anywhere in src/render or in the three chunks we include. No
    switch added. MSAA's cost is per-TRIANGLE shading of every pixel a triangle's samples touch (see above).
- STATIC COST of one terrain fragment (reading terrainmat.ts + groundfloor.ts; s = one 3D simplex noise, V = one
  voronoi3 = 27 hashed cells):
  program total: 179 snoise + 6 snoiseGrad + 10 fbm3 (3 s each) call sites, 5 rk_joints calls (3 s each) = ~230 s,
  10 V, crater loops (4 tiers x 8 cells, airless only). Branches on the cell fields decide what runs:
  always: macro m1 m2 (4 s) + warpV, big, rkLayered (7 s) + macro tint (6 s) + far breakup (4 s) = ~21 s
  rock (fine, where rock shows): 13 s + 3 snoiseGrad + 3-4 rk_joints (9-12 s) = ~27 s
  soil: 5 s + soilDetail 4 s | sand: sandDetail 5 s | ore 9 s + 2 V | road 3 s | snow 4 s | ice 2 s + 1 V
  vegetation: 23 s + 3 fbm3 (9 s) + up to 3 V; swardDetail 22 s; meadowTint 11 s; forest floor ~26 s
  lava 20 s + 4 V | fire 19 s + 2 fbm3 | micro normal (veryFine) 2 snoiseGrad | caustics 6 s (shallow water, near)
  -> a near meadow fragment ~95-100 s + 1-2 V; near forest floor ~125 s + 2-3 V; near bare rock ~60 s; far land ~40 s.
  texture taps (lighting, the same for every fragment): 5 shadow PCF + 1 cloud-shadow cube (2 with the moon) + 1
  transmittance LUT + 4 irradiance SH + 2 sky LUT + 1 city-light cube = 14-15; +1 overlay when the map overlay is on.
- PART B DESIGN — the terrain material cache `?tcache=1` (store once, sample; default off until proven). NOT BUILT YET.
  WHY IT PAYS: the surface function evalTerrain (~40-125 noise calls) runs per triangle-quad invocation, 6-20x per
  pixel with 1-2 px terrain triangles (PATCH_RES 32 -> ~1000 triangles a patch; rounds 2-5: the patches on screen
  hold 1-2 M terrain triangles). Baked into a texture it runs once per TEXEL, and only when something it depends on
  changes; the per-invocation cost left is 3 texture fetches + the lighting block (14-15 taps).
  WHAT evalTerrain DEPENDS ON (read from the code; this decides what can be stored):
   a. P, Nb and the cell fields (varyings vF0-5, vOre, vCurv, vFireWind): fixed per patch until the sim's field
      textures change (snow, wetness, ash, burn, crops, paint / raise / crater edits) -> re-bake the patches whose
      cells changed (fieldtex.ts already knows the dirty cells per sync) or, simpler first, every tile whose field
      version is older than the snapshot's, budgeted.
   b. fw (the pixel footprint: every aaF() fade, the `fine` / `veryFine` switches): in the bake fwidth(vBodyPos) is the
      TEXEL footprint, so the tile's texel density must track the screen's (size classes below), and a tile is
      re-baked when its class changes. Grazing angles (screen footprint >> texel footprint along the view) need the
      tile's mip chain + anisotropic filtering: prefiltered instead of faded analytically. THIS is the part where
      'identical' has to be shown by imgdiff, not assumed.
   c. camDist (9 fades: 14-45 m crop under-storey, 120-500 m mid breakup, 150-550 m, 220-520 m gullies, 400-1300 m,
      uVegFade / uCanopyFade instanced-tree hand-over) and the eye direction (sward sheen, terrainmat.ts ~674):
      camera-dependent. Re-bake a tile when the camera's distance to the patch changed by more than ~2 % or its
      direction by ~2 degrees since the bake (budgeted, nearest first). At rest: no bakes. A tile that is stale by
      under 2 % is not visible; a tile further behind (fast flight) shows slightly old fades until its turn.
   d. uSunDirBody (canopy shade ff_canopy, sunny-side tint, day/night fire), uYearFrac (season): slow -> re-bake on a
      threshold of change, round robin.
   e. uTime (lava skin, fire, embers) and fwidth(fire) / dFdx(P): LIVE. A fragment with lava > 0.01 or |fire| > 0.01
      keeps the full evalTerrain path (a dynamic branch on the varyings; such patches are rare).
  NOT stored: lighting (sun, shadow, cloud shadow, sky, moon, caustics), city lights, brush ring, map overlay: they
  stay per fragment in the main shader exactly as now.
  STORE (TSurf, 15 channels) in 3 RGBA8 targets per tile + mips: T0 = albedo (sqrt-encoded) + rough; T1 = bump
  gradient in the patch's tangent frame (2 ch, replaces the screen-space derivative of ts.bump) + ao + sky; T2 =
  microG (2 ch tangent) + sward + glint. emis only exists on the live path. If 8 bits band the albedo in the dark,
  T0 becomes RGB10_A2 / RGBA16F (+33 % / +100 % of that target).
  ADDRESSING: no new vertex data. A page is PATCH_PAGE = 16 slots of NVERT vertices in lattice order: slot =
  gl_VertexID / NVERT, lattice (i, j) from gl_VertexID % NVERT (skirt vertices clamp to the edge) -> tile uv. Each
  page owns 16 tiles in an atlas layer (two triangular patches share one square tile along the diagonal, with a 2 texel
  gutter). A small per-page uniform array gives each slot's tile rect (size classes differ).
  BAKE: the terrain program compiled with TC_BAKE: the same vertex shader and varyings, gl_Position = tile uv, three
  MRT outputs = TSurf; drawn with the page's geometry and the slot's draw range into the tile's viewport, modelView
  from the real camera (camDist, eye direction as on screen). Then the tile's mips. One bake costs one evalTerrain per
  texel: a 64^2 tile ~ 2 k texels, i.e. a frame budget of 64 tiles is ~0.13 MP of heavy shading (today: ~10 MP+).
  SIZE CLASSES (texels along the patch edge >= pixels along it): 32 / 64 / 128 / 256 / 512 by the patch's projected
  edge, with hysteresis; the finest LOD close to the camera is the only user of 256-512.
  MEMORY (Ultra, 1686x963, 16 GB Mac, GPU process ~1.75 GB today): ~1500 patches on screen: 1400 x 64^2 x 0.5 (two
  per tile) x 3 targets x 4 B x 1.33 (mips) = ~46 MB; ~80 near patches at 256^2 = ~42 MB; ~10 at 512^2 = ~21 MB;
  pool slack and off-screen kept tiles x2 -> ~220 MB. Hard cap 256 MB (LRU of tiles; over the cap the lowest class
  wins). At dpr 2 full screen (5 MP) the classes rise one step: cap 512 MB. Both are small against 16 GB.
  PROOF PLAN (imgdiff vs `tcache=0` at the animation floor ~3/255, speed 0): town 90 m, forest 200 m, low grazing
  view, ridge 1800 m, orbit; LOD seams (pan sequence p1-p6); edits (paint / raise / crater via __GENESIS__); snow /
  wet / ash over sim time; lava + fire live path. Plus the in-page toggle (as zpreOn) for frame-adjacent pairs.
  BUILD ORDER: (1) TC_BAKE program + one fixed 128 class + display path, in-page toggle, town imgdiff; (2) mips +
  aniso + gutters, grazing view; (3) invalidation a-d + budgets; (4) size classes + LRU cap; (5) live path e.
  EXPECTED GAIN AND ITS LIMIT: an earlier round's `hide=terrain` took 600 -> 270 ms: the cache can remove most of those ~330 ms,
  NOT the other 270 (trees and far trees: 4-5 M sub-pixel triangles with alpha-test shaders, 19 M shadow triangles).
  30 fps needs the triangle-density work on vegetation / shadows as well; `vshade=all`, `hide=veg`, `shadows=0`
  and `msaa=0` runs of round 10 will size that.
- PART A PROOF (local, SwiftShader, babel 307987276, medium 320x180, speed 0; probe _harness/arc-work/probe-s19.mjs;
  logs + shots in _harness/scratch/arc/perf/s19/, sheets sheet-zab-town.png, sheet-a1.png, sheet-a2.png LOOKED AT):
  every run 0 page errors, 0 shader / GL errors:
  * zpre=1, in-page A/B one frame apart (Renderer.zpreOn): town on vs off 3.52/255, on vs on2 3.97, off vs off2 3.19;
    low view on vs off 3.14, on vs on2 3.05, off vs off2 3.67 -> on/off is inside the same-mode frame-to-frame floor;
    the x4 diff shows foliage sway and the hand ring only, no terrain holes or edges. (Log depth + zcons path. The
    `zpre=1&revz=1` pair was NOT run locally: the Mac's look check must cover it.)
  * tshade=all (bare lit ground, as expected), tshade=fbm1,novor,nojoints,nofloor,nocloudsh,albedo (unlit albedo),
    tshade=nosurf,nolight + vshade=all + wshade=all + bshade=all (black ground, trees / houses / water drawn):
    all compile and draw. The single cuts not run on their own: nonoise, noveg, nolayers, nobump, noshadow (all inside
    `all`), nolight / nosurf (run together).
  * overdraw=1: draws; shows the houses, tree cards and a net of bright lines = the terrain patches' SKIRTS (every
    patch edge adds 2 layers) over an even ground layer. The per-fragment constant was lowered x3 after that shot
    (0.03 0.01 0.003): one layer was already mid-orange.
  * local triangle count at 320x180 (57.6 k pixels): scene 1.5-1.6 M, shadow 2.4-2.7 M triangles = ~27 scene
    triangles per pixel here; the Mac's ~5 per pixel at 1686x963.
  GATE: npm run check 1047 pass, 0 fail (check1.log); npm run build exit 0 (build-prod.log).
- ROUND 10 ASK (Ultra, landing spot, same window): base; tshade=all; tshade=nonoise; tshade=albedo; tshade=nosurf;
  tshade=noveg; tshade=nofloor; tshade=novor; vshade=all; bshade=all; wshade=all; tshade=all&vshade=all&bshade=all&
  wshade=all; zpre=1; zpre=1&revz=1 (look: holes in the ground?); hide=veg; one overdraw screenshot.
### SESSION 19b — lead: (1) triangle density, (2) tcache
- BUILT: `src/render/tristats.ts` — triangles per frame BY LAYER and PASS. WebGLRenderer.renderBufferDirect is wrapped
  once; each draw's triangles (three's own counter) go to the layer of the drawn object (nearest named ancestor:
  terrain, water, trees = vegetation-near, fartrees = vegetation-far, cover, buildings, roads, life, other) under the
  pass (scene = the opaque pass, shadow). The perf report prints two lines after `render:`:
  `tris by layer, scene (xM = y per px): trees ... · fartrees ... · terrain ...` and the same for shadow per shadow
  texel (cascades x (atlas/2)^2). Always on (one Map update per draw call). Probe: `globalThis.__GENESIS_TRI__.last`.
- MEASURED LOCALLY (probe-s19 --quality=ultra --size=1686x963, babel 307987276, flat=1 + post off to make SwiftShader
  fast; counts do not depend on the material; settle 15 frames, so the terrain may not be fully landed; tri.log):
  view land (town from 150 m, tilt 22):  scene 2.83 M = 1.7 / px: trees 1.56 · fartrees 1.11 · terrain 0.08 · buildings 0.04
                                        shadow 6.89 M: fartrees 4.45 · trees 2.24 · terrain 0.21
  view coast (surface, 40 m, pitch -3): scene 2.92 M = 1.8 / px: fartrees 0.98 · trees 0.95 · terrain 0.88 · cover 0.08
                                        shadow 9.25 M: fartrees 3.93 · trees 2.71 · terrain 2.60
  -> TREES are 65-95 % of the scene triangles and ~70 % of the shadow triangles; terrain is at most a third.
  (The Mac's landing spot drew ~3x these totals; round 10's report now prints its own split.)
- WHERE THE LOD ALREADY IS SCREEN-DRIVEN (read from the code):
  * terrain: split distance K x patch size, K = hPx / (2 tan(fov/2) x pixelError x PATCH_RES): a patch edge spans
    64-128 px on Ultra (pixelError 4), a lattice edge 2-4 px FACE ON; sub-pixel only by foreshortening at grazing
    angles (and the silhouette factor silK refines grazing patches further).
  * far trees: by projected height (FAR_PX: 5-sided 2-ring hull above 12-18 px, 4-sided 1-ring below, gone under
    3-6 px): ~15-35 triangles for a tree 3-18 px tall. Already near 1 triangle per few pixels; the count is the
    number of TREES (tens of thousands).
  * near trees: by DISTANCE only (vegetation.ts: lod0 < 0.16 x range, lod1 < 0.42 x range, LOD_BAND). The one layer not
    screen-driven. At 1686x963 a 15 m tree is ~115 px at the lod0 edge and ~45 px at the lod1 edge.
- NO `?tridens` SWITCH BUILT, and why (so nobody builds the wrong thing):
  * a pixel-driven near-tree LOD that never goes below today's detail only pays in SMALL windows (bands scale with
    pxPerRad / the 1080p reference): at the Mac's 963 px it would move the bands by ~10 %. Pulling the bands in
    further than that is a lower-detail tree at the same size on screen: a quality change that needs the owner's eye,
    not an 'identical' change.
  * ROUND 9's own data argues AGAINST triangles as the main term: the 600x363 window (13 % of the pixels) was 5.2x
    faster, but near-tree triangles do not fall with the window (distance LOD) and they are half the scene. A
    triangle-bound frame would not have sped up that much. Cost follows PIXELS: large-triangle overdraw with heavy
    shaders — stacked alpha-tested leaf cards and grass (each layer runs the vegetation shader and its shadow taps,
    then maybe discards; no early-Z with log depth unless zcons works on Metal), and the terrain under all of it.
    This corrects the weight I put on micro-triangles at the top of SESSION 19: they multiply the far-tree and
    grazing-terrain shading, but round 10 must show the split (tshade / vshade / hide=veg / the overdraw shot / the
    new tris lines) before LOD work is chosen.
  * candidates once round 10 is in, in the order I would try them: (a) vegetation depth prepass with the existing
    alpha-tested depth twins (VEG_DEPTH_FRAG discards as the colour shader does) + depthFunc EQUAL colour pass under
    revz / zcons: the leaf shader then runs once per visible pixel instead of once per card layer; (b) shadow pass:
    far-tree casters as the 4-sided hull in cascades 2-3 (4 M -> ~2 M shadow triangles; shadow of a tree a few
    texels wide); (c) the terrain cache (design above).
- (2) `?tcache=1`: NOT STARTED beyond the design above.
### SESSION 19c — lead: build vzpre + shhull now (default off)
- BUILT `?vzpre=1` and `?zpre=2` (= terrain zpre + vzpre; `?zpre=1` stays terrain only): overdraw.ts VZPRE / ZPRE;
  vegetation.ts makeVegZpreMaterial + Vegetation.swapZpre. The twin of the near-tree and the far-tree material is
  the SAME material source (its onBeforeCompile is called), with `gl_FragColor = vec4(0); return;` put right after
  the colour chunk (every alpha-test discard of the vegetation shader sits in that chunk: LEAF_ALPHA, LOD chunk
  hash, leaf loss, crown gaps, near dither), colorWrite off; `invariant gl_Position / vFragDepth` on both programs
  (ZPRE_INVARIANT, only when the switch is on: the default programs are untouched). Not the shadow twins
  (VEG_DEPTH_*): another vertex shader, their position would not match to the bit. Prepass = one extra scene
  render on layer 8 (terrain twins if ZPRE, tree twins if VZPRE), then the colour pass unchanged: LEQUAL + depth write
  kept (the safe form; EQUAL not used). It pays only where the GPU can test depth early: zcons on the log path, or
  `revz=1`. NOT in the prepass: ground cover (its own two materials, 0.08 M triangles locally), buildings, people.
  Cost of the prepass itself: the tree triangles are drawn twice (scene triangles +trees +fartrees) with a leaf
  texture fetch per fragment.
- PROOF zpre=2 (medium 320x180, in-page A/B one frame apart, vz.log, sheet-vz.png LOOKED AT: no holes, no halos at
  leaf edges, x4 diff = foliage sway + the hand ring): town on/off 3.63 (on/on2 3.85, off/off2 3.39); forest on/off
  1.40 (1.34, 1.34); land on/off 2.95. 0 page errors, 0 shader / GL errors. `revz=1` with it: NOT run locally.
- `?shhull=1` NOT BUILT. Exact next steps (vegetation.ts): far buckets are per (distance band, hull lod); a lod-0
  bucket draws the 5-sided hull's canonical index list (farcrown.ts FAR_HULL_VERTS[0] vertices; the vertex data comes
  from the table row iHull = (kind x variants + variant) x 2 + lod by gl_VertexID, FAR_FETCH). The 4-sided hull has
  its OWN shorter index list, so the swap needs (1) per lod-0 far bucket a second BufferGeometry with the lod-1
  index list sharing the bucket's instanced attributes — mind bufring.ts: the instance attributes are rings of 3
  swapped per frame, the second geometry must be re-pointed with them (ringify / ringOf); (2) a depth-material
  uniform uShHull that makes farFetch read row `iHull + 1.0` when iHull is even; (3) in Renderer.perCascade(k):
  for k >= 2 set mesh.geometry = alt and uShHull = 1, back at k < 2 and at k = -1; (4) proof: shots of the far
  forest's ground shadow at a low sun, ridge 17.6 h, shhull on/off in-page.
- `?tcache=1`: not started (design above, build order (1)-(5)).
- ROUND 10+ ASK additions: `zpre=2`, `zpre=2&revz=1` (look for holes / leaf halos), `vzpre=1`; read the two new
  `tris by layer` lines.

## LEAD NOTE after MAC ROUND 11 (2026-11-16) — the ~150 ms floor
- With every shader simplified (S), nothing single removes the floor: scene=0 151 ms, shadows=0 150, everything-off (post) 167,
  rscale=0.5 149, msaa=0 117. No run had scene=0 AND shadows=0 together.
- Hypothesis: the floor is GEOMETRY throughput (vertex + raster of ~8-10 M scene + ~19 M shadow triangles a frame, mostly trees;
  hide=veg leaves the trees' shadows). It does not scale with pixels (rscale 0.5 no gain; tiny window 116 ms in round 9), msaa
  helps (per-sample raster of small triangles). Round 12 tests scene=0&shadows=0, shadows=0&hide=veg,cover,life, fartrees=0 etc.
  on build dbadbde1 (prints tris by layer).
- If confirmed: cached far shadow cascades (roadmap step 9), far-tree hull casters (shhull, steps in SESSION 19c), then the
  scene-side tree triangle budget.
- Caveat: round 11 ran with another process holding the GPU 47-58 % busy.

## SESSION 20 (2026-11-16 ~18:20Z) — round 10 (MAC-ROUND10-cfe751b9): the terrain SURFACE is the cost -> stage (a) `?tnoise=tex`
- READ OF ROUND 10 THAT DECIDES THE ORDER: base 550-570 ms; nosurf 251 (the whole surface = ~300 ms); nonoise 399 (every
  noise call a constant = ~150 ms); all 217. So the arithmetic noise is HALF of the surface cost at most; the other
  ~150 ms is evalTerrain's non-noise arithmetic (281 smoothsteps, ~120 branches, rk_joints' lattice, hashes, mixes),
  which `nonoise` could even constant-fold in part. Stage (a) can therefore reach ~400 ms + its taps at best, NOT
  nosurf's 251: only the store-once cache (c) removes the rest. (a) is built first because it is small, safe, and
  it also makes every later BAKE of the cache cheaper.
  ASK FOR ROUND 11 (no new code, the s19 switches combine): `tshade=nonoise,noveg`, `tshade=nonoise,nolayers`,
  `tshade=nonoise,nofloor`, `tshade=nonoise,nojoints`, `tshade=nonoise,nobump` — which block holds the ~150 ms that
  is not noise — next to `tnoise=tex` and base.
- BUILT `?tnoise=tex` (default OFF; header prints `tnoise=tex` / `tnoise=none`): src/render/planet/noisetex.ts (new),
  3 lines in terrainmat.ts (GLSL after the cut macros, uniforms, program key), 1 line in renderer.ts (ensureTNoise at
  the top of render()).
  * a 128^3 RGBA16F volume, REPEAT, LINEAR, no mips, rendered once at the first frame by a full-screen shader that
    includes noise.glsl.ts: r = snoise ITSELF at 8 texels per lattice unit, made periodic (period 16 units) by a
    cross-fade with its own shifted copies over the last 3 units of each axis, weights renormalised (variance kept);
    gba = 4 x the second differences of r along x y z.
  * `#define snoise(p) snoiseT(p, __LINE__)` and `fbm3(p) -> fbm3T` AFTER the noise library and the tshade macros, so
    every later call in terrainmat.ts + groundfloor.ts becomes a tap; the cloud-shadow code (before the macro) and
    every other material are untouched. snoiseT = ONE textureLod(.., 0) tap + `r - 0.125 * dot(t(1-t), gba)`: the
    quadratic term makes the interpolant's GRADIENT continuous (slope = central difference at each texel centre).
    Why: ts.bump goes through screen derivatives (bumpNormal); plain trilinear has a constant slope per texel that
    jumps ~40 % of the slope's range at each texel face = faceted bump close up. (First cut was R16F plain trilinear.)
  * each call site looks up through one of 4 fixed rotations (site = __LINE__ & 3): a periodic volume on a sphere
    repeats as rows of look-alike blobs only in thin bands (~+-2 deg) round the 3 great circles normal to the
    volume's axes; with 4 rotations the terms of one fragment never have their bands in the same place.
  * textureLod level 0: no implicit derivatives (taps sit inside dynamic branches), no mips (each term is already
    faded by its footprint through aaF, as before).
  * NOT replaced (still arithmetic): snoiseGrad x6 (micro normal, fw < 0.6 m only), voronoi3 x10 (`novor` = no gain
    on the M5), gn_hash*, craterField.
  * no float render target (EXT_color_buffer_float / half_float missing): RGBA8 volume + a console warning (not the
    Mac, not SwiftShader).
- STATIC COUNT per terrain fragment (s = arithmetic simplex ~150 ALU ops, T = one RGBA16F 3D trilinear tap + ~12 ops):
  program: 173 snoise sites (111 terrainmat + 62 groundfloor) + 10 fbm3 (3 each) -> 203 T; 6 snoiseGrad + 10 V stay.
  path          before                      after
  near meadow   ~95-100 s + 1-2 V           ~95-100 T + 0-2 snoiseGrad + 1-2 V
  forest floor  ~125 s + 2-3 V              ~125 T + 2-3 V
  bare rock     ~60 s                       ~57 T + 3 snoiseGrad
  far land      ~40 s                       ~40 T
  lighting taps unchanged (14-15). MEMORY: +16.8 MB GPU (128^3 x 8 B), one allocation, never re-uploaded.

## LEAD NOTE after MAC ROUND 12 + quiet-Mac check (2026-11-16) — the frame budget on a quiet M5 (Ultra, 1686x963)
- Round 12 (build dbadbde1, quiet Mac, S = all four shade cuts): S 83-100 ms; scene=0&shadows=0 50 ms; + every post/cloud/
  atmo/gtao/msaa/water off 17 ms (60 fps, the display cap) -> NO fixed floor; my geometry-floor hypothesis is REFUTED
  (fartrees=0: -8 M shadow / -2 M scene tris, no gain; zpre=2 slower). Frame times step in 16.7 ms (vsync).
- Budget: terrain surface ~450-500 ms (base Ultra 520-620 vs S ~90); post chain ~33 ms (scene=0&shadows=0 50 -> all off 17);
  simplified scene + shadows ~35-50 ms; 600x363 window with S: 33 ms.
- So: (1) terrain surface cost first (SESSION 20, in progress) -> ~10 fps; (2) then the post chain (33 ms -> ~10) and the
  remaining scene + shadow cost to reach 33 ms total.
- Unexplained: the quiet-Mac check's S run on build cfe751b9 was 251 ms (Finder at 97 % CPU, iCloud syncing, WindowServer
  ~66 % GPU while the game ran) vs ~90 ms for S on dbadbde1 an hour later. Round 13 re-measures base/Low/High on dbadbde1.

## LEAD NOTE after MAC ROUND 13 (2026-11-16, build dbadbde1, Ultra 1686x963; CPU busy with other jobs, GPU idle before)
- N (normal) Ultra 500-517 ms, High 267, Low 133; N + all four shade cuts 133 ms.
- P = scene=0&shadows=0: 117-133 ms. P + water=0: 17 ms (53 fps). P + msaa=0: 83. P + rscale=0.5: 49.
  clouds / atmo / gtao / bloom+godrays+lum+fx+decals off: all within noise of P.
- So the WATER pass costs ~100 ms a frame at full shading (round 12: ~30 ms with wshade=all) and scales with pixels; MSAA
  multiplies it. The post chain, clouds, atmosphere and GTAO are NOT a cost worth work now.
- Budget: terrain surface ~370 ms, water ~100 ms, everything else ~30 ms (incl. vsync step).
- Connect with the owner's long-standing visual bug "a rippled water sheet lies over the hills at the landing spot, trunks
  showing through" (rounds 2-8): water sheets are being shaded over land. Fixing where water is drawn is both the visual
  fix and a large part of the water cost; the water fragment shader's noise needs the same treatment as the terrain's.

### SESSION 20 — `?tnoise=tex` PROOF, GATE, OPEN ITEMS, NEXT (written 22:25Z; continues the SESSION 20 block above)
- PROOF (SwiftShader, babel 307987276, high 640x360, speed 0; probe `_harness/arc-work/probe-s20.mjs` = trees / cover /
  clouds / shadows / post / water OFF in both A and B so the ground itself is compared; sheets A | B | x4 diff by
  `_harness/arc-work/sheet-s20.py`; all in _harness/scratch/arc/perf/s20/: sheet-a (town, meadow), sheet-b (rake, floor),
  sheet-c (top-down meadow, peak, desert), sheet-d (far, orbit), sheet-e (rock, sand2), sheet-edits. LOOKED AT: a b c e edits).
  Every run: 0 page errors, 0 shader / GL messages (only three's KHR_parallel_shader_compile notice).
  The two noises are different REALISATIONS of the same function, so the pixel diff is NOT at the animation floor and
  cannot be; what must match is the statistics. detail = std of (image - 9x9 box blur):
  view     mean|d|  mean RGB base / tex                      detail base / tex
  town      6.14   102.2 116.7 78.3 / 102.2 116.6 79.1       5.53 / 5.56
  meadow    9.78   101.7 117.4 68.9 / 102.1 117.2 69.0       4.91 / 4.93    (14 m orbit: near ground)
  rake      6.31    98.3 116.4 72.3 /  98.3 116.4 72.3       3.69 / 3.79    (sun at 17.9 h: bump)
  floor     8.01    29.6  22.7 13.8 /  29.5  22.5 13.4       4.60 / 4.54    (forest floor, trees hidden)
  rock      3.75   216.0 214.0 213.0 / 215.9 214.0 213.0     6.40 / 6.39    (snowy summit, 40 m; settle 24)
  graze     6.09   102.2 116.0 68.7 / 102.1 116.1 68.9       4.96 / 5.01
  peak      4.68   103.9 123.8 143.8 / 103.7 123.7 143.8     8.54 / 8.50    (rock + snow, 500 m)
  desert    6.13   197.2 172.6 142.6 / 197.3 172.7 142.7     3.61 / 3.59    (sand ripples)
  far       2.70    66.5  85.6 99.3 /  66.5  85.6 99.3       6.71 / 6.69    (2600 m)
  orbit     0.59     7.7   9.7 12.6 /   7.7   9.7 12.6       7.06 / 7.06
  sand2    14.11   120.3 111.3 94.0 / 120.0 111.4 94.5       9.80 / 7.54    <- OPEN, see below
  No texel facets, no grid, no visible repeat in any looked-at crop; ripples, grass strokes, snow grain, strata read
  the same. (The first `rock` pair differed by a straight-edged blue facet in BASE: an unsettled patch at settle 12;
  re-run at settle 24 = the row above.)
- OPEN (not resolved, say so to the owner's eye): the layered-rock coast (`sand2`, coast poi, 120 m; and the 30 m
  `sand` view of the same place, detail 4.54 / 3.92) has LOWER local contrast with tex: fewer dark ledge lines. Mean
  colour is equal. Either this spot's realisation of the low-frequency `layered` mask, or systematic for the strata.
  Not decided: one place, two views. NEXT: 3-4 other cliff / strata places (camera lat / lon along the coast), base vs
  tex; if systematic, look at rk_joints' warp (3 snoise at 0.55 / sp) and rkLayered first.
- NOT RUN: `tnoise=tex256` (builds, never booted); the full picture with trees / shadows / water on (only the fast set-up);
  motion (a pan: does any term swim or pop? it should not, the volume is static in the body frame).
- EDITS / LAYERS with tnoise=tex (sheet-edits.png, orbit 220 m over the town): paint snow 60 m -> the snow sheet shows
  at once; crater -> dust + new ground; paint sand, paint lava -> lava glow, fire, burnt rim; +600 ticks -> night, still
  drawn. 0 errors. (tnoise touches no field, only the noise function, so nothing here can go stale.) Wet ground was
  not tested on its own.
- LOCAL SPEED, for what SwiftShader is worth (CPU, not the M5): the same 11 views took 2660 s with base and ~900 s
  with tex.
- GATE: `bash _harness/slot.sh npm run check` 1047 pass 0 fail (s20/check1.log); `npm run build` exit 0 (s20/build-prod.log).
- ROUND ASK: base; `tnoise=tex`; `tnoise=tex256` (look only: compile + repeat); `tshade=nonoise` again as the bound;
  the five `tshade=nonoise,<block>` pairs listed above. LOOK: near meadow under a low sun (facets?), a cliff coast
  (strata contrast), far land from ~2 km (rows of repeated blobs?).
- NEXT, in order (lead's added scope after round 13: terrain surface ~370 ms, WATER ~100 ms (~30 with wshade=all)):
  1. `?wnoise=tex` — the same macro for the water fragment (ocean.ts): `import { TNOISE_GLSL-like }`; noisetex.ts
     must then build the volume when EITHER switch is on (make `TNOISE` the terrain flag and add `WNOISE`, both
     feeding ensureTNoise's `if (!(TNOISE || WNOISE))`), and export the GLSL unconditionally (today it is '' when
     tnoise is off). CAUTION: water noise is ANIMATED (uTime in the argument): a tiled volume is fine for that, but
     check where the water uses snoiseGrad / its own gradient for normals: the quadratic interpolant has a continuous
     gradient, yet a normal taken by finite differences of taps 1 texel apart is smoother than analytic: compare glints.
  2. WATER OVER LAND (owner since round 2: a rippled sheet over the hills at the landing spot, trunks through it):
     the terrain varyings already carry waterLevel / groundHeight (vF4.y, vF4.w); find in ocean.ts how a water patch
     is emitted and whether its fragment has the ground height (fieldtex) — discard where ground > water level +
     margin, or better do not emit patches whose every vertex is dry. Proof: landing view before / after (babel
     307987276, 59.7 m, 5.1 km west of Amonshis) with `overdraw=1` and normal.
  3. `?tcache=1` (design in SESSION 19 PART B) only if round 14 shows tnoise=tex + the non-noise block cuts leave the
     terrain far above nosurf.

## SESSION 21 (2026-11-16 ~23:30Z, WATER agent; a container restart early on, nothing lost) — water ~100 ms on the M5
- STATIC COUNT, GENESIS water FRAGMENT (ocean.ts OCEAN_FRAG; s = arithmetic simplex ~150 ALU ops), open sea, per fragment:
  * 20 s always: gwWarpAt 2 + gwGroupAt 2 (wave crests), ripples() 4 (warp 2 + group 2), SSR march jitter 1, foam 8
    (pulse, band, surf, surge excess 2, whitecap 2, gale streak 1), shore bite edgeN 3. + 5-8 more where foam shows
    (lace 4, falls 1, surge churn 3), +2 s + 1 voronoi3 on ice, +2 in silted water. RIVERS (flow > 0.05): ripples() runs
    TWICE (two-phase flow map) = +4 s and a second 14-wavelet loop.
  * loops: 4 Gerstner + 3 swell (trig, sqrt, normalize each); ripples = 14 wavelets, each 5 trig + pow + sqrt + normalize
    of values that only depend on the index, + windFeed + fwWave + cos; silt zones 4.
  * taps: sunShadow 5 PCF; cloud shadow = 1 cube + cloudDensityAt (1 cube tap); mirrored clouds = the same again + sky
    LUTs; sky/sun LUTs ~8; scene depth 2 + scene colour 1; SSR = up to 28 steps x (mat4 mul + 1 depth tap), + 8 refine
    + 3 previous-frame taps on a hit; moon: sky LUT + cloud shadow again; glitter 3 hashes.
  * Sum: ~3000 ALU ops of simplex + ~1500 of loops + up to ~45 dependent taps. wshade=all (noise = const, no PCF) took
    the pass from ~100 to ~27-30 ms on the M5: the 20 simplex + 5 PCF are ~70 % of it; SSR + clouds + loops the rest.
  * The pass also writes gl_FragDepth (log depth): without the conservative-depth early reject every rasterised water
    fragment runs all of this before its depth test, hidden or not.
- SIBLING GAMES (the owner's "smooth, beautiful water"):
  * pirates-cove (ffg_openseas3d.js) = three's addons Water.js (MIT) unchanged: 4 taps of ONE tiling normal map
    (waternormals.jpg) scrolling at 4 speeds / scales, 1 tap of a planar mirror (a second scene render at half
    cost, not per-pixel work), analytic sun specular + Schlick. ~5 taps + ~60 ALU ops per fragment. No noise, no loop.
  * driftwake water.glsl.js: analytic, 0 taps, 0 noise, 0 loops (sines in the vertex shader, a few in the fragment).
  * crestbound water.js: 4 Gerstner in the VERTEX shader, 2 tiny value-noise helpers (wh / wn) in the fragment, a
    procedural sky function, a per-vertex baked shore distance (CPU rings) for foam. 0 taps.
  * dyefield water.ts: 1 tap (a baked shore-depth texture) + one 6-iteration analytic noise loop.
  * So: 50-300 ALU ops and 0-5 taps a fragment, against GENESIS's ~4500 ops + ~45 taps: 15-50x cheaper. What they have
    in common: every high-frequency detail is a TEXTURE tap or a handful of sines; shore foam from BAKED distance/depth.
    What GENESIS has that they lack: SSR of the shore, Beer-Lambert depth colour off the real scene depth, wind/storm
    sea state per cell, whitecaps, surge foam, ice, mirrored cloud deck. Those stay; the noise becomes taps.
- WATER OVER LAND, what is emitted: every terrain patch with ONE wet (or shore-level) vertex cell draws its WHOLE
  geometry again as a water sheet (chunks.ts vertexWater; WATER_SHARE: the same vertices). At the landing spot (palm
  beach, land cells at +0.6 / +5.4 m beside sea cells at -19..-74 m, level 0) the sheet lies flat at level 0 UNDER the
  +0.6 m ground; only `vDepth < -0.6` was discarded, so the sheet 0-0.6 m under the low ground was left to the depth
  test. A fragment that gets past the depth test there shades with thickness 0, and the shore's noise bite
  (edgeN, up to +0.12 m of fake thickness) blends the full rippled water colour at up to ~70 % over the ground, with the
  scene copy (trees) refracted through it = the owner's "rippled translucent sheet, trunks through it". SwiftShader's
  depth test hides it; `?wdebug=nodepth` (water ignores depth) reproduces it. WHY the M5 lets them through is NOT
  established (not zcons, not zedge by the owner's tests).
- BUILT (ocean.ts; noisetex.ts: WNOISE + NOISETEX_FN_GLSL export, 6 lines):
  * `?waterland=0` old. Default ON: `if (vDepth < -0.08 - 1.5 * fwidth(vDepth)) discard` FIRST in main (vDepth = level
    - ground of the same patch geometry, so with a working depth test the picture is the same), and the shore blend's
    `edge` fades with vDepth over the next 6 cm: nothing of a sheet under ground can show whatever the depth test does.
  * `?wdebug=class` (red = ground > 8 cm above the sheet, yellow = 0-8 cm, green = draped film, blue = water),
    `?wdebug=nodepth` (water depthTest / depthWrite off).
  * `?wfast=1` (default OFF): (a) every fragment snoise = 1 tap of the s20 noise volume (built when tnoise OR wfast);
    gwWarpAt / gwGroupAt tap at FIXED sites in the vertex AND fragment shader (the same field: normals stay on the
    geometry's crests); (b) the 14 wavelets' index-only values are const arrays (RP_D / RP_K / RP_G, computed in TS);
    (c) the ripples' 3 shared noises are taken once, not once per flow phase. Formulas unchanged.
    COUNT after: 20 T (taps, ~12 ops each) instead of 20 s; ripples loop ~45 instead of ~110 ops a wavelet; rivers 20 T
    (was 24 s). Everything else as before.
- Probe: `_harness/arc-work/probe-s21.mjs` (probe-s20 + views land land2 sea seafar lake shore river night dusk, water on).

## LEAD NOTE after MAC ROUND 14 (2026-11-16, build e50830af, quiet Mac, Ultra 1686x963)
- N 333-383 ms (2.5-2.9 fps). tnoise=tex 483-532 ms: SLOWER (about 100-200 3D taps with second-difference correction per
  fragment cost more than the arithmetic noise on the M5). tnoise=tex is a DEAD END for speed; leave it off.
- tshade=nonoise 150 ms; + noveg 133; + nofloor 133; + nolayers / nobump / nojoints: nothing.
- Look of tnoise=tex on the Mac: matches (slightly stronger dune ripples close up) — irrelevant now.
- Decision: go to the texture-space material cache (`?tcache=1`, design in SESSION 19 PART B): evaluate the surface once per
  patch texel and amortise, so the per-pixel cost is a few 2D taps regardless of how the noise is computed.

## SESSION 22 (2026-11-17, TERRAIN agent) — `?tcache=1` (default OFF): the terrain material cache, texture-space shading
- STATE: code written and type-clean (`npx tsc --noEmit`), NOT YET BOOTED in a browser. Nothing proven. Next step is at the end.
- FILES: new `src/render/planet/tcache.ts` (the cache: GLSL pieces, allocator, validity, bake); `terrainmat.ts` (hooks +
  `makeTerrainBakeMaterial`); `chunks.ts` (`tcInitPage` in PatchPage, `ChunkLOD.tcMesh / tcRange / tcCorners`,
  `PatchBatch.pageMesh / slotRange`); `planetview.ts` (`tcache`, `bakeTerrainCache`); `renderer.ts` 1 line (bake after the
  shadow pass, before the scene pass). Switches: `tcache` (0), `tcmb` (256), `tcbudget` (200000 texels a frame), `tcbias` (0).
  Probe handle: `globalThis.__TCACHE__` (`.stats`, `.enabled` = in-page A/B). Header: `tcache=1(<MB>,<layers>L)`, `tcstat=...`.
- DESIGN DECISIONS (each one is a finding from reading evalTerrain, not a preference):
  1. STORE, 16 B a texel + 2 mips: T0 sRGB8_A8 albedo/1.5 + rough; T1 RGBA16F D + ao; T2 RGBA8 sky, sward, glint share.
     D is the whole normal offset in the body frame: display normal = normalize(N - D), D = G + |N - G| * microG, G = the
     bump height's surface gradient taken in the bake. This reproduces the live nesting exactly and needs no screen
     derivative of a stored height (8-bit height derivatives would terrace). three r186 has no RGB10_A2: 16F it is.
  2. ADDRESSING, no new vertex data: slot = gl_VertexID / NVERT, lattice (i, j) from gl_VertexID % NVERT in closed form
     (tcLattice). Per-slot data (layer, tile origin, tile size, knots, graze) sits in an 8x4 RGBA32F table per page that
     three binds as the BatchedMesh colour texture (`_colorsTexture`, sampled by slot, not by instance: keepIndirectTable
     makes the instance id unreliable). ASSUMES vertexStart = slot * NVERT; `slotRange` returns null otherwise (= live).
  3. TILES: 2D array textures made with raw GL (texStorage3D, 3 mips; three's array render targets allocate no mips for
     MRT) and handed to three by `properties.get(tex).__webglTexture`. Layer 1152^2 cut in 576 slabs, one class each:
     96 / 144 / 192 / 288 / 576 texels. A tile is a square: lower-left triangle = anchor A, the same lattice rotated 180
     degrees = anchor B. Bake goes to a three MRT scratch target of the class size, then blits (mip 0 nearest, mips 1-2
     2:1 linear). three's copyTextureToTexture is NOT usable: its blit ignores the destination offset for srcLevel != 0.
  4. CAMERA DISTANCE (9 fades in evalTerrain, all mid-pipeline, not separable without 6+ more channels): two anchors
     at the knots of a global ladder 14 * 2^(i/2) m bracketing the patch's distance range, blended per fragment by its
     live distance. Interpolation error of a smoothstep fade over one rung < 0.5 % of the fade. No re-bake inside the
     bracket; outside it the patch goes LIVE (correct, old cost) until re-baked. Cost: 2x memory.
  5. EYE DIRECTION: swardDetail's graze term (val x 0.94..1.07, tip, gap) is baked at one quantised value per tile and
     corrected per fragment to first order with ts.sward as the weight; re-bake when the centre's graze moves > 0.2.
  6. FOOTPRINT: the bake's fw is the texel's. Class = smallest with usable edge >= 1.1 x the patch's edge in pixels at
     its nearest point, so texels >= pixels; non-max levels need <= pixelError x 32 (Ultra 128 -> class 144). Max-level
     patches near the camera climb classes; nearer than class 576 resolves (~25 m at 963 px) they stay LIVE.
     KNOWN LOOK DIFFERENCE TO MEASURE: at grazing angles the live shader fades detail by the long footprint axis; the
     cache keeps it and filters with mips + 16x aniso (gradients clamped to mip 1.5: the 2-texel border). `tcbias` exists
     to compare.
  7. SEAMS: the patch's own skirt is pushed outward by 2 texels in tile space and vBodyPos is EXTRAPOLATED along the
     patch's lattice steps (uTcEi / uTcEj), so border texels hold the function just outside the patch with real
     derivatives; live/cached is chosen per PATCH (flat varying), so a pixel quad never straddles the two paths.
  8. forest floor mask reads this frame's shadow maps (ff_canopy): baked as is, hence the bake runs after the shadow
     pass; sun moved > 4 deg or year > 0.004 = re-bake at low priority, shown stale meanwhile (the only stale display).
  9. EDITS / SIM: field textures carry no per-cell dirt, so tcache diffs each changed texture against a reference copy
     with per-channel thresholds (WATCH) and invalidates the tiles whose vcells moved (live until re-baked).
  10. LIVE always: patches with lava or fire cells (uTime), emissive only exists there.
- MEMORY: 247 MB planned at the default cap = 9 layers = 36 slabs. A class-144 tile is 436 kB with both anchors, so the
  cap holds ~570 class-144 tiles (fewer with near classes). If ~1000 patches are on screen at Ultra the far ones stay
  live. Levers, not built: class 96 for patches beyond 1.44 x split distance (in the code already, by `need`), single
  anchor beyond the last fade, a low-res second anchor, `tcmb=512`.
- NOT HANDLED YET: stealing tiles from far patches for near ones when full; downgrading an over-dense tile; a planet
  that stops being primary keeps its GL memory; TS_NOSURF with tcache does not compile (debug combination).
- NEXT (exact): `npm run build`, then a 320x180 probe `?tcache=1` on the town view: 0 shader errors, `__TCACHE__.stats`
  shows bakes, screenshot pair with `__TCACHE__.enabled` false/true one frame apart -> imgdiff. Then views, edits, pan.
- STEP 1 DONE (booted, SwiftShader, babel 307987276, high 320x180, speed 0, trees/shadows/water off; probe
  `_harness/arc-work/probe-s22.mjs` = in-page A/B: shot with the cache, `__TCACHE__.enabled = false`, 2 frames, shot live):
  0 page errors, 0 shader / GL messages, the level-to-level mip blit raised no GL error. 247 MB, 9 layers, RGBA16F.
  town 90 m: mean |d| 2.17/255, mean RGB live 102.3 116.8 79.4 / cache 102.3 116.9 80.2, detail 6.87 / 7.51;
  meadow 14 m: mean |d| 1.85, RGB 101.4 117.8 69.1 / 101.1 117.4 68.7, detail 4.88 / 5.00 (floor ~3 on s19's pairs).
  Sheet LOOKED AT (s22/sheet-t5.png): same ground, same bump lighting; the x4 diff is fine grain plus small blue /
  violet dots in the town view (wildflowers: the cache keeps a few the live footprint fade removes). No patch lines.
  BUG FOUND AND FIXED on the way: with a batch colour texture three defines USE_COLOR in the fragment and multiplied
  the albedo by the slot table (ground white / black): `color_vertex` / `color_fragment` are removed from the terrain
  program when tcache is on. Also `__TCACHE__` now names the PRIMARY planet's cache.
- NEXT: views forest floor / rock / sand / snow / far / orbit / a true grazing camera; then edits + time; then the pan.
- STEP 2 (in progress): 8-view run `--tag=v` (graze floor rock sand2 desert peak far orbit) on the build BEFORE the two
  changes below; log s22/pv.log, shots s22/shots/v-*-{c,l}.png, sheet tool s22/sheet.py (also wanted in arc-work).
  FOUND in `graze` (which is a top-down 160 m view, not grazing: `tilt` is from the vertical): a shallow lake bed read
  sandy in the cache and blue-grey live, mean |d| 4.75. Cause: evalTerrain's `uwFar` (ground standing in for open water)
  follows the PIXEL footprint. FIXED in source (not yet re-run): the bake leaves uwFar 0, the display applies the
  uwFar block (albedo, rough, sward, bump) to the fetched surface from the live footprint. This is the class of
  difference to look for in every view: terms keyed to fw as a stand-in for distance.
  ADDED in source (not yet run): when the cap is full a near patch takes the tile of the farthest drawn one (>= 1.5x as
  far, at most 12 a try); a class that found no room is not retried in that frame.
- NEXT: rebuild into s22/dist2, re-run graze + the views that differ, then a REAL grazing camera (tilt ~85), then
  edits (`--edits=1`), the pan (`--pan=8`), then the Ultra 1686x963 tile count (`scene=0`), then check + build.
- STEP 2 RESULTS so far (build s22/dist2 = uwFar split + steal + credit budget + LOD distance for the class; run
  `--tag=w`, log s22/pw.log, high 320x180; in-page A/B; sheet tool `_harness/arc-work/sheet-s22.py out.png name..`):
  view                        mean |d|   mean RGB live / cache                 detail live / cache
  town 90 m (dist, step 1)      2.17     102.3 116.8 79.4 / 102.3 116.9 80.2     6.87 / 7.51
  meadow 14 m (step 1)          1.85     101.4 117.8 69.1 / 101.1 117.4 68.7     4.88 / 5.00
  forest floor 18 m (run v)     1.04     29.7 22.8 13.8 / 29.7 22.8 13.8         3.66 / 3.75
  top-down 160 m (`graze`)      3.42     100.6 113.9 67.2 / 101.9 116.2 67.8     5.74 / 6.19   lake bed now equal
  TRUE GRAZING (tilt 84, 120 m) 1.91     94.9 120.6 131.2 / 94.9 120.4 130.9     5.80 / 5.74   LOOKED AT: no lines
  0 page errors, 0 GL messages in every run. Sheets looked at: t5 (town, meadow), v2 (floor), w1 (top-down), w2 (grazing).
  The top-down view's +2 % green and higher detail: at 320x180 the LOD's K is clamped to 3, patches are 16-64 px, and a
  class-96 tile is up to 5x denser than its pixels: past the mip-1.5 clamp it is undersampled. Not the Mac's case
  (need 64-128 there), but fixed in source for both: classes 48 and 72 added, and a tile > 2.6x denser than its pixels
  re-bakes smaller at low priority. NOT YET BUILT / RUN.
  The white ring in some cache shots is the hand cursor (it is in s19's diffs too), not the cache.
- BAKE RATE seen: the first `rock` run starved (one class-576 tile a frame, 539 queued): fixed by the credit budget
  (a tile that does not fit waits, smaller ones behind it use half of what is left).
- NEXT: finish run w (far orbit peak rock) -> build s22/dist3 -> `--edits=1`, `--pan=8`, Ultra 1686x963 count, gate.
- STEP 2 more (build s22/dist3 = classes 48 / 72 + downgrade + tight distance range + `wide` -> full shader; run `--tag=x`):
  peak 500 m (rock + snow + far hills): run w showed the far vegetated hill LESS golden in the cache (mean |d| 2.87,
  5.4 % of pixels > 16). Cause: the patch's distance range came from its bounding sphere, brackets were 4+ rungs wide
  and the LINEAR blend put a 120-500 m fade at ~22 % where it is 90 %. With the LOD's shell-sector distance + the
  patch's extent, and patches spanning > 2 rungs sent to the full shader: peak 2.00, RGB 104.2 123.8 143.8 / 104.3
  123.9 144.0, detail 10.73 / 10.61. top-down 160 m: 2.62 (was 3.42). far 2600 m 1.51, orbit 0.56, coast 120 m 1.91
  (run w, sheet s22/sheet-w3.png LOOKED AT: all four read the same; no lines).
  BUT `wide` was 104 of 258 patches in the top-down view (K = 3 at 320x180): too many on the full shader. So, in source
  (NOT YET BUILT): the two anchors are blended along ONE monotone curve, tcFade(d) = the sum of evalTerrain's distance
  fades (14-45, 120-500, 0.5 x 400-1300, shrub and canopy hand-over), instead of linearly in distance: a fade alone in
  a bracket is then exact at any width. With it the bracket is taken one rung wider each way (camera moves of ~40 %
  re-bake nothing) and only > 5 rungs counts as wide.
  PAN pairs: 2 frames after a camera jump the SKY still converges (grey -> blue between the two shots), so a pan
  pair's whole-image number is the sky's: measure the ground rows only.
- NEXT: build s22/dist4, run `--views=graze,peak --pan=4` again (ground crop), edits result of run x, Ultra count, gate.
- STEP 3 EDITS / TIME (run x on dist3, orbit 220 m over the town, sheet s22/sheet-xe.png LOOKED AT; 0 errors):
  paint snow 60 m -> the snow sheet is in the cache shot (pair 3.65); crater -> new ground in the cache shot (1.75);
  paint lava -> 22 patches `hot` (full shader), the pair's 31 is the blast's dust and smoke moving between the two
  shots, not the ground; +600 ticks (night) 1.91, RGB 24.0 20.7 16.2 / 22.1 18.9 14.9, 95 hot (the fire spread).
  dirtyCells after the snow step: 9196 (the sim's own drift past the WATCH thresholds, not only the 7 painted cells):
  the thresholds may be tighter than needed; every dirty tile was re-baked within the settle (queued 0).
  e0 / e1 pairs (5.04 / 3.65): a red band on the far ridge = the linear-blend bracket error again -> dist4 (tcFade).
- PAN (run x, 5 steps of 9 degrees at 110 m, low view to the horizon, shots 2 frames after each jump, ground rows only):
  step 2 1.99, step 3 1.80 with 387-400 patches cached and 156-164 on the full shader in the same frame: no line
  between cached and live patches (sheet s22/sheet-xpan.png LOOKED AT). Steps 0-1 are not usable as pairs: the LOD was
  still landing between the two shots (the pond is a coarse polygon in the first). A true frame-by-frame switch test
  (fixed camera, tiles landing one by one) is NOT done.
- STEP 2 on dist4 (tcFade blend, bracket one rung wider, wide only > 5 rungs; run `--tag=y`, sheet s22/sheet-y.png LOOKED AT):
  `wide` is 0 in top-down and peak (was 104 and 33): every patch cached. town 1.76 (RGB 101.4 116.5 82.5 / 100.5 115.6
  81.6, detail 7.87 / 7.85); peak 2.40 (104.3 123.9 143.9 / 104.2 123.8 143.9; the far hill is equal, what is left is a
  fine yellow grain on the snow dome); the far ridge's red band of e0 is gone.
  top-down 160 m: 3.73, cache GREENER (G 118.7 vs 115.2) and SOFTER (detail 4.95 vs 5.58). Reading: at 320x180 these
  tiles are class 48, ~1.1 texels a pixel; bilinear resampling at ~1:1 softens the albedo and the normal offset (a
  flatter micro normal lights the sward brighter from above). Runs with denser tiles had detail equal or higher.
  -> `?tcdens=` (default 1.4, 1..2.5): texels per pixel a new tile gets; smaller tile only past 2.2x that. Build
  s22/dist5. RUNNING: town + top-down at tcdens 1.4 and 2 (`--tag=d1.4`, `d2`), and `npm run check` (s22/check1.log).
  (`custom` 220 m in run y is not a valid pair: first view after boot, the LOD still landing between the two shots.)
- STATIC COUNT per terrain fragment with the cache on, a patch with a valid tile (s = simplex, V = voronoi3):
  surface: 0 s, 0 V. 6 textureGrad taps on 2D arrays (3 targets x 2 anchors; trilinear, up to 16x anisotropic at
  grazing angles), 2 dFdx/dFdy pairs, 12 smoothsteps (tcFade x 3), ~60 ALU ops. Before: ~95-100 s + 1-2 V near
  meadow, ~125 s + 2-3 V forest floor, ~60 s rock, ~40 s far land.
  still per fragment as before: lighting taps 14-15 (5 shadow PCF, cloud-shadow cube, transmittance, 4 irradiance SH,
  2 sky LUT, city cube); caustics 6 s only in 0.15-3 m of water within 24 m; city `districts` 2 s only at night
  beyond 900 m. Vertex: + 2 texelFetch of the slot table and the closed-form lattice.
  A patch WITHOUT a valid tile runs the full old fragment (one flat-varying branch): lava / fire patches, patches
  nearer than class 576 resolves, patches spanning > 5 rungs, everything unbaked or past the memory cap.
- NEXT: read d1.4 / d2, pick the default; Ultra 1686x963 tile count (`scene=0&msaa=0`, quality ultra, `--nolive=1`,
  stats only) for the measured coverage at 247 MB; `npm run build`; hand back.
- DENSITY RUNS READ (dist5, sheet s22/sheet-d.png): top-down 160 m at tcdens 1.4: 3.84, G 116.8 vs 114.2, B 65.2 vs 67.5,
  detail 5.14 / 5.74; at tcdens 2: 3.90, G 117.0 vs 114.3, B 65.6 vs 67.5, detail 5.19 / 5.75. DENSITY IS NOT THE CAUSE
  (my reading above was wrong; dist3's better number was 40 % of the patches being live). The shift (+G, -B, softer) is
  the footprint: the bake evaluated at the TEXEL's footprint (0.3-0.6 m) what the full shader evaluates at the pixel's
  (~0.9 m), and evalTerrain's footprint fades are not mean-preserving (sward tips, flowers). tcdens stays (default 1.4).
  `npm run check` on the dist5 source: 1047 pass, 0 fail (s22/check1.log).
- FIX in source, build s22/dist6: each anchor is baked for the pixel footprint of ITS distance (face on):
  fw = max(texel footprint, anchor distance / pxPerRad); the distance blend then carries the footprint fades too. What
  stays different by design: at grazing angles the full shader uses the long footprint axis and fades more.
  pxPerRad is now part of the global key (a resize re-bakes).
- NEXT: run `--views=peak,graze,town` on dist6 (peak first = the landing view), then the Ultra count, check again, build.
- dist6 run `--tag=z` (machine load 8-11, the run was cut at 40 min; sheet s22/sheet-z.png LOOKED AT): peak 2.24 (RGB equal,
  detail 10.64 / 9.93: the snow dome's grain). top-down 160 m 4.09: detail now 5.73 / 6.06 but STILL GREENER, G 117.0 vs
  114.1, B 66.8 vs 68.1. town pair INVALID (7.78): the cache shot shows the pond as a coarse polygon = the LOD had not
  landed when it was taken (worker builds lag under load; the probe counts frames, not time). The same holds for the
  d1.4 / d2 town numbers. A valid town pair is run y's 1.76.
- dist7 (source now): anchor footprint = sqrt 2 x distance / pxPerRad (the shader's fw is length(fwidth(P)), both pixel
  axes), anchor A at min(knot, nearest point); tcFade's tiny tie-break term replaced by 0.05 * log2(d) so the blend also
  moves between the two footprints where no fade runs. `stats.wantN / wantMB` = what the frame's cacheable patches
  would take at their classes. RUNNING: Ultra 1686x963 count (`--tag=u`, s22/pu.log), top-down again (`--tag=g7`).
- OPEN, stated plainly: the top-down 160 m meadow reads ~2.5 % greener through the cache. Not explained yet (not the
  density; the footprint floor changed the detail, not the tone). Candidates not yet tested: the graze correction's
  weight (ts.sward is not the grass tone's true share), the sRGB mip blits, anchor B's share at t ~ 0.05.
- SESSION 21 RESULTS (2026-11-17; SwiftShader, babel 307987276, high 480x270, the s20 fast set-up with water ON; all in
  _harness/scratch/arc/perf/s21/; every run 0 page errors, 0 shader / GL messages):
  * waterland, as finally built: (1) `vDepth < max(-0.6, -0.08 - 1.5 fwidth(vDepth))` discard first; (2) then ONE tap
    of the linear scene depth: if the opaque scene is in front by 5 cm + 0.4 %, 4 more taps (the neighbours) and discard
    if all agree (a 1-px rim round occluders is left to the per-sample depth test); (3) shore `edge` fades over the
    6 cm above the cut. (An earlier cut without the -0.6 floor let steep far slopes through: fixed.)
  * COUNT at the landing view (`wdebug=class,nodepth` = every rasterised water fragment that survives the discards;
    k0 / k1, sheet-waterland.png LOOKED): of 129 600 px, water over ground standing > 8 cm above it: 903 -> 506
    (what stays is the 1-px rim / footprint margin), 0-8 cm: 1192 -> 1221, real water 87 194 -> 87 038. With the depth
    test on (z1): 93 018 water px = 72 % of the frame, 0 over land. SO AT THE LANDING SPOT THE WATER PASS IS AN OPEN
    SEA FILLING ~70 % OF THE SCREEN; the under-land band is ~1.6 % of the frame along the beach. The ~100 ms is the
    shader on legitimately visible sea, not hidden sheets: `wfast` is the cost lever, waterland is the visual guard.
  * NOT REPRODUCED: no water sheet over a hill in any SwiftShader shot (d0 / d1 normal, sheet-wl-land.png LOOKED: land
    pixels identical, sea differs by its animation only — uTime is wall clock, so no water A/B is pixel-exact).
    waterland=1 vs 0 at the pond by the town (sheet-wl-lake.png LOOKED): a faint difference on the pond's rim (486 px
    over 8/255, incl. animation). CAUTION for whoever reads the nodepth sheets: with depthTest off GL also stops the
    water's depth WRITES, so the atmosphere composite hazes those pixels by the opaque depth behind — the blue
    "hills" above the horizon and the sky in the valley in sheet-nodepth-*.png / sheet-waterland.png are THAT, not
    sheets on hills. The nodepth look is therefore not a faithful picture of a failing depth test.
  * THE DECISIVE MAC ASK (30 s): at the landing spot with the sheet in view, `?wdebug=class` and a screenshot. The
    sheet over the hills then shows its class: BLUE = the water level really is above the ground there (geometry /
    field levels: look at fieldpack levels for that patch), RED / YELLOW = sheet under ground that the M5's depth test
    lets through (then waterland=1 already removes red; and ask `?invalidate=0`, `?msaa=0`), NO COLOUR on the hills =
    it is not the water pass at all (terrain wetness / SSR). Then default vs `?waterland=0`.
  * wfast=1 LOOK (b-* base vs f-*; sheet-wfast-a.png, sheet-wfast-b.png LOOKED): compiles and draws, 0 errors. pond:
    mean|d| 2.1, mean RGB equal within 1; night sea: mean RGB 14.4 24.2 39.3 / 15.5 25.9 42.4, but local detail of the
    lower half 6.49 -> 3.40 and the beach tip's outline differs (the shore's noise bite is another realisation of the
    noise: the waterline moves by metres when toggling). NOT PROVEN EQUAL: the `river` pair landed on different places
    (poi('river') is not stable between runs), `shore` barely shows water, the day open-sea shot of f was taken after
    `night` (hour sticks) so there is no day sea pair, no storm, no orbit. wfast stays default OFF.
- GATE: `bash _harness/slot.sh npm run check` 1047 pass 0 fail (s21/check1.log); `npm run build` exit 0 (s21/build-prod.log).
- NEXT, in order:
  1. Mac: `?wdebug=class` at the landing spot (above), then default vs `?waterland=0`; `?wfast=1` frame time vs default
     (expect most of the gap to wshade=nonoise: ~100 -> ~45-55 ms) and its look.
  2. wfast proof properly: probe-s21 needs a pinned water clock (find where uTime is set in planetview / renderer and
     add a test-surface or URL pin — shared file, ask the lead), one camera per run or explicit `hour` per view, views
     by lat / lon instead of poi (sea 17.9 / -35.6, landing 17.876 / -35.0), --full (clouds + shadows on) for the
     mirrored deck. Check the night-sea detail drop first: compare ripple normals (the 14-wavelet const arrays vs
     the reference loop with the SAME noise: set WFAST arrays on, taps off) to tell arrays from taps.
  3. If the waterline shift matters: keep the 3 `edgeN` shore-bite noises arithmetic under wfast (they then cost 3 s).
  4. Further wfast stages, none started: cloud shadow + sky irradiance + sun transmittance per VERTEX (low frequency);
     SSR march 28 -> fewer steps with a hierarchical start, or skipped where F * confidence cannot show; three
     Water.js-style scrolling normal-map taps for the capillary octaves (0.17-1 m) instead of 5 of the 14 wavelets.
  5. Emission (chunks.ts vertexWater) untouched: a patch with one wet vertex cell still draws its whole sheet; with
     the early discards the dry part now costs raster + 1 varying test. Splitting it needs per-triangle water index
     lists (a second index range per slot): only worth it if the Mac shows raster-bound water.
- dist7 results: top-down 160 m `g7`: 3.64, G 116.7 vs 114.4, B 65.4 vs 67.7, detail 5.03 / 5.75: the sqrt 2 footprint and
  the log term did NOT remove the green / soft shift. OPEN (see above). 0 page errors, 0 GL messages on that boot.
  Ultra count `u` (1686x963, quality ultra, scene=0, 150 m, tilt 65): NOT a valid count, only 97 patches were selected
  after 40 frames (LOD not landed under load). What it does give: 93 cacheable patches want 45 MB at tcdens 1.4 =
  ~0.48 MB a patch at Ultra; at tcdens 1.1 ~0.3 MB. So the 247 MB cap holds ~500 (1.4) or ~800 (1.1) patches; the rest
  draw with the full shader, far ones first (nearest are baked first, and steal from the farthest when full).
- DEFAULT PICKED: tcdens 1.1 (the valid pairs town 1.76, grazing 1.91, floor 1.04, coast 1.91, far 1.51, orbit 0.56 were
  taken at 1.1; 1.4 and 2 did not improve the one view that differs and cost 1.6x / 3.3x the memory).
- GATE: `bash _harness/slot.sh npm run check` + `npm run build` on the final source: see the line below.
- MAC RUNS WANTED (Ultra 1686x963, landing spot, 20 s still then pan; the header prints `tcache=1(247MB,9L)` and
  `tcstat=tiles,cached,live,hot,near,wide,want=N/MB,full,bakes,glob`): base; `tcache=1`; `tcache=1&tcmb=512`;
  `tcache=1&tcdens=1.4&tcmb=512`; `tcache=1&tcbudget=600000` (faster landing, heavier bake frames);
  `tcache=1&water=0` (terrain alone). Read from tcstat: cached vs live (how much of the view the cap covers), `full`
  (patches refused for memory), `glob` (should stay ~2-4: if it climbs every frame a shared uniform moves and
  everything re-bakes), bakes while panning. LOOK: meadow from straight above at ~150 m (greener?), a low view to
  the horizon, snow close up (sparkle), forest edge with the sun moving, a painted edit appearing, straight lines on
  the ground at patch borders while panning.
- NEXT for a successor: (1) the green shift: bake one tile at the live fragment's exact camDist / fw / NdV and compare
  texel to pixel (uDebug 2 = albedo) to find the term; (2) a valid Ultra count once the machine is quiet;
  (3) frame-by-frame switch test at a fixed camera; (4) release GL memory when a planet stops being primary;
  (5) WATCH thresholds (9196 dirty cells after a 4-tick step); (6) shadows-on proof of the forest floor mask and the
  sun-moved re-bake; (7) full-picture runs (trees, shadows, water, MSAA on) were never made: every pair here has them off.
  GATE RESULT (final source, tcdens default 1.1): npm run check # pass 1047 # fail 0 (s22/check2.log); npm run build exit 0 (s22/build-prod.log). The final default change was not booted again: the last boot (dist7, tcdens 1.4) had 0 errors and tcdens only changes a number on the TS side.

### SESSION 21b (2026-11-17) — lead after the Mac: tnoise=tex made the terrain SLOWER (500 vs 350 ms), so volume taps are no win -> `?wfast=2` (the sibling games' method), `wshade` bisect cuts, `?wclock=`
- BUILT, all in ocean.ts (no shared file touched; wfast=1 kept as it was):
  * `?wshade=` new cuts (raw list, so `all` means what it meant in rounds 12-13): `nossr` (ssr() returns nothing),
    `nopcf` (sunShadow = 1), `noripple` (ripples() = 0: no 14-wavelet loop, none of its 4 simplex), `nofoam` (the 8
    foam simplex + lace off), `norefr` (no scene depth / colour taps: fixed 5 m of water over a dark floor);
    `nonoise` as before (all simplex = 0).
  * `?wclock=<s>` pins the WATER's uTime (the ocean material gets its own uniform), `?wwind=<x>` pins uWind (2.2 = gale).
    With wclock two runs' water is pixel-comparable.
  * `?wfast=2` (default off): ripples() = taps of ONE 256^2 RGBA8 tiling normal map (rippleMap(): RG = gradient of 16
    tiling wavelets, 4-24 waves a tile, each slope 0.03 — the reference's steepness law amp = 0.012 L; mips,
    anisotropy 8, made once on the CPU, 0.35 MB), 4 taps = 2 tile sizes (5.3 / 3.9 m, 37 / 29 m) x 2 scroll directions
    (the second turned 90 deg), textureGrad with the projected derivatives; projected along the body axes with weights
    |up|^6 (1 projection over most of the planet, 2-3 near the cube diagonals: 4-12 taps). Amplitude = uWind x sea
    state (capillaries by gSea^2) x the long waves' group noise (gwG, already there) = gusts / cat's paws for free;
    the slope variance the mips remove goes to gUnresolved (glint + mirror widen), the rest to gResolved (LEAN).
    Rivers: the same two-phase flow offsets. Kept: 4 Gerstner + 3 swell normals, depth colour, glint + glitter, foam,
    ice, silt, clouds' mirror. SSR: 8 steps x1.9 (reach ~340 m; was 28 x1.35), 8 refine, thickness 0.66 t, start
    jitter = 2 sines (was 1 simplex). The foam's 8 simplex and the shore bite's 3 stay ARITHMETIC (waterline does
    not move) but run only where their term can be non-zero (W_*_ON gates: near a shore / surge slope > 0 / wind
    over 3.5 m/s on deep salt water / gale): exact, not an approximation.
    COUNT, open calm sea fragment: simplex 20 -> 4 (the Gerstner warp / group); ripple loop 14 x ~110 ops -> 4 2D taps
    (+ ~60 ops); SSR depth taps <= 28 -> <= 8. Windy sea: +2-3 simplex (whitecaps). Shore pixels: +3 +3.
  * first look (A = default, B = wfast=2, both wclock=100; shots2/, sheet-wfast2-a.png LOOKED): day open sea at the
    landing spot: same colour (mean RGB 86.3 120.5 130.7 / 86.4 120.7 131.2), wave fronts and shoreline in the same
    place; B a little smoother near the camera with fewer glitter specks (detail 3.88 / 3.26) -> ripple amplitude was
    ~1.7x low (the group mean counted twice): K 0.7 -> 1.15, re-shot below. pond: identical look (detail 4.87 / 4.86).
    `shore` poi view shows almost no water (useless view).
- wfast=2 PROOF after K = 1.15 (A = default, B = wfast=2; both `wclock=100`, SwiftShader high 480x270, the fast set-up
  = clouds / shadows / trees OFF; shots2/; sheets sheet-wfast2-a / -b / -c.png, ALL LOOKED; every run 0 page errors,
  0 shader / GL messages):
  view (what)                      mean|d|  mean RGB A / B                         detail A / B
  land  (day open sea, landing)     2.42    86.3 120.5 130.7 / 86.1 120.4 130.5    3.88 / 4.15
  storm (land, wwind=2.2)           9.75    141.2 140.3 134.6 / 137.5 138.9 135.4  9.70 / 10.21
  night (land, 23.5 h)              2.31    14.7 25.0 41.2 / 14.9 25.7 42.1        6.38 / 7.71
  lake  (the pond by the town)      1.61    93.8 119.2 101.9 / 93.6 119.2 101.9    4.87 / 4.86   (K 0.7 build)
  river (poi: a narrow grey channel) 1.54   equal                                  6.19 / 6.16
  orbit                             0.58    equal                                  8.62 / 8.61
  shore (poi: almost no water in view) 1.45 equal                                  (K 0.7 build)
  Reading: colour, wave fronts, foam (the storm's lace and whitecaps), the waterline and the pond are the same. B
  shows MORE fine ripple texture toward the horizon by day and at night (a faint regular grain at mid distance by day,
  blotchier at night): for the owner's eye — if it reads as a pattern, lower K or widen the two tiles' ratio.
  NOT SHOWN: with clouds / shadows / trees on (the mirrored deck, SSR of a treeline with 8 steps: the likeliest place
  for a visible loss), a real river with flow (two-phase path compiled, not looked at), motion (scrolling), a
  cube-diagonal region (2-3 projections blended), Mac speed.
  cuts: `wshade=nossr,nopcf,noripple,nofoam,norefr,nonoise` together compiles and draws flat water (sheet-wfast2-b row 3).
- GATE 21b: `bash _harness/slot.sh npm run check` 1047 pass 0 fail (s21/check2.log; run on the committed wfast=2 code,
  before the one-constant K change, typecheck re-run after it); `npm run build` exit 0 (s21/build-prod2.log).
- MAC ROUND ASK (P = `scene=0&shadows=0`, Ultra, the landing spot, as round 13):
  1. P (base) | P&water=0 (floor)
  2. P&wshade=nonoise | P&wshade=noripple | P&wshade=nossr | P&wshade=nopcf | P&wshade=nofoam | P&wshade=norefr
     (each alone: frame time base - cut = that block's cost), and all six together.
  3. P&wfast=2 (time), then normal `?wfast=2` vs default for the LOOK (open sea by day, a lake with trees on its
     bank = reflections, night, a storm). Also P&wfast=1 once, to close the volume-tap question for water.
  4. `?wdebug=class` screenshot at the landing spot with the sheet over the hills in view (see SESSION 21).
- NEXT: by the round's numbers — if SSR is the rest, SSR at half rate / fewer refine; if PCF, 1-2 taps for water; if
  wfast=2 is still far from the floor, the Gerstner group's 4 simplex -> varyings near, cloud shadow + sky light per vertex.

## LEAD NOTE after MAC ROUND 16 (build 5ee51b2d on genesis-water, quiet Mac, Ultra 1686x963) — three open problems
P = scene=0&shadows=0. P repeats: 167 / 84 / 217 / 133 ms (very noisy on a quiet machine). P + water=0: 17 ms.
1. WATER COST IS NOT THE FRAGMENT MATH: P + all six wshade cuts (flat water) 117 ms; wfast=2 134; wfast=1 234; single cuts
   150-300 (inside the noise). So ~100 ms of the water pass survives a trivial fragment shader. Round 13: P + msaa=0 83 ms,
   P + rscale=0.5 49 ms -> it scales with pixels and samples. Suspects: what the water pass does around the draw (scene
   colour / depth copy, MSAA resolve and re-entry of the 4x hdr target, the depth-texture taps of the waterland guard + discard,
   gl_FragDepth + discard under MSAA on a sheet that covers 70 % of the screen), or the vertex stage of the water sheets.
2. REGRESSION: N (full game) 784-950 ms here vs 333-383 ms on build e50830af (round 14). Default-on changes between the two:
   the waterland guard (1 + 4 scene-depth taps and a discard before everything in the water fragment), the tcache hooks in
   the terrain material / chunks (tcache itself off), wfast plumbing. Must be found and removed.
3. tcache=1 GAVE NOTHING on the Mac (run 17: 800 ms with wfast=2&tcache=1 after a 30 s wait). The tcstat header line of that
   run is needed: are patches cached or live at the landing view on the real GPU?
Also: `wdebug=class` paints the sheet over the hills the SAME blue as the open sea, and waterland=0 does not remove it: it is
   ocean-class water whose level the shader believes is above the ground, yet it draws over visibly higher terrain while tree
   trunks draw over it. So either the terrain's depth is wrong for the water pass on Metal (water passes the depth test over
   terrain but not over trees), or the water surface there really is above the terrain mesh (level / height mismatch).

## SESSION 23 (2026-11-18, PERF lane) — the three open problems of round 16, by the code; switches for ONE Mac round
### 1. REGRESSION e50830af -> 5ee51b2d: the code cannot double the frame; only `waterland` is default-on
- `git diff e50830af 5ee51b2d -- src`: ONLY src/render changed (chunks, noisetex, ocean, planetview, tcache (new),
  terrainmat, renderer +2 lines). No sim / ui / app change.
- SHADER-TEXT PROOF (scratch/dump.mjs: imports each tree's ocean.ts + terrainmat.ts in node, prints the ocean vert/frag
  and the terrain program after onBeforeCompile, comments stripped): with tcache off the terrain program differs ONLY
  inside `#ifdef TC_BAKE` / `#elif defined(TC_ON)` blocks (dead: neither define is set), program key unchanged
  (`-tc` only with tcache). Ocean with `?waterland=0` = e50830af's text up to rewrites the compiler folds (`#define
  GW_N(p,s) snoise(p)`, `if (true) {...}` for the W_*_ON gates). So `?waterland=0` IS the old water and the old terrain.
- tcache with tcache off, CPU side: `if (TCACHE)` guards tcInitPage / TerrainCache / bake (null -> no-op); tcache.ts
  top level only reads switches. noisetex: WNOISE = `wfast=1` only (`wfast=2` does not build the volume). No work.
- `waterland` (default on) adds per water fragment: fwidth + 1 tap (+4 where the opaque scene is in front) of the R32F
  linear depth copy (a separate texture, NOT attached: no feedback) and an earlier discard (the old shader already had
  a discard and gl_FragDepth, so early-Z was already off). It REMOVES shading work (hidden water). Nothing here can
  add ~500 ms. The same-build spread is as large: P on dbadbde1 50 ms (round 12) vs 117-133 (round 13); P on 5ee51b2d
  84-217 in one session. CONCLUSION: by the code this is machine state (thermal, memory pressure / swap — round 3 saw
  swap 8.6->11.8 GB — WindowServer), not a code regression. Settle it with N vs N&waterland=0 interleaved AND, if the
  lead can host it, build e50830af itself interleaved in the same session (the only clean control).
### 2. WATER PASS ~100 ms with a trivial fragment: what happens around the draw (renderer.ts 597-705, pipeline.ts 595-660)
- passes (MSAA 4x at Ultra; 1686x963 = 1.62 MP; hdr = 4x RGBA16F renderbuffer + 4x DEPTH32F renderbuffer, resolve
  targets RGBA16F + DEPTH32F texture): (a) scene pass -> hdr MSAA, store 52 + 26 MB; three's blitFramebuffer resolve
  colour+depth (read 78, write 19.5 MB); (b) GTAO; (c) copyForWater: 2 fsq draws -> sceneCopy (RGBA16F 13 MB) + linDepth
  (R32F 6.5 MB); (d) WATER: setRenderTarget(hdr) again, autoClear off -> Metal pass with LOAD of 78 MB, draw, store
  78 MB, second resolve blit (78 read / 19.5 write); (e) invalidate (after the resolve, so it saves nothing for (d)'s
  store — that pass is already closed). No mips, no per-frame texture uploads in the water path.
- ~400 MB/frame of attachment traffic = ~3-4 ms at M5 bandwidth: NOT 100 ms, unless ANGLE-Metal does the re-entry or
  the depth resolve through a slow path (e.g. a shader 'unresolve' of the MSAA contents, or a per-sample depth resolve
  draw). Vertex stage: TERRAIN_VERT_CORE (12-36 texelFetch with morph) + 15 field fetches + 4 vertex simplex + 4
  Gerstner per vertex x ~1.1 k vertices x water patches; rscale also lowers the patch count (pixel-error LOD), so the
  rscale result does not separate vertex from fragment.
- What a flat (`wshade` all six) water fragment STILL runs: gl_FragDepth (log), the waterland taps, 4 Gerstner + 3 swell
  normal loops, sky LUTs, cloud shadow + mirrored deck (cloudDensityAt), glint, moon, overlay. So "trivial" was not.
- BUILT (all default = current picture and cost; defaults' shader text checked identical with dump.mjs):
  `?wfrag=0` constant colour right after the land discards (depth write + discards kept) = the real trivial fragment;
  `?wdepth=0` no gl_FragDepth (log-depth fragment chunks left out) and no discard (timing only: depth = the rasterised
  zcons bound); `?wvert=0` no Gerstner / vertex simplex; `?wcopy=0` no colour / depth copies (ocean NOSCENE: no
  refraction taps, no SSR, no waterland depth taps -> compare with `wshade=norefr,nossr`); `?wsingle=1` the water layer
  drawn INSIDE the opaque render (no second MSAA load / store / resolve; NOSCENE too; with scene=0 it is drawn right
  after the clear in the same pass).
### 3. THE SHEET OVER THE HILLS: blue in wdebug=class means vDepth >= 0 — the sheet IS above its own ground
- vDepth = tH - tG of the SAME vertex in the SAME program (terrainvert tGround), so a depth-test failure would paint the
  class of the sheet that leaks through: a sea patch behind a hill is blue too, so class alone cannot tell. But a
  geometric cause exists in the code: fieldpack.ts 146-156 gives a DRY cell next to water the level min(mean wet level,
  sc - 0.05) (5 cm under its own CELL height), and chunks.ts vertexWater draws a patch's sheet when ANY vertex cell has
  wl > s - 0.5 (true for every such dry cell). Over a triangle of dry cells the level is the chord of cell heights - 5 cm,
  while the ground is the CURVED surface (CURVE_ALPHA 0.75 x R x bend: sags metres below the chord on concave slopes,
  the fieldpack comment records 20-30 m) plus detail relief (+-2 m) plus dunes: wherever the ground dips under the chord
  the sheet stands above it — blue, waterland cannot touch it (vDepth > 0), trunks pierce it (the sheet is a real
  surface metres up, under the crowns), a "rippled translucent sea-coloured sheet" (thin water over ground refracts the
  ground). Same for wet cells with a few cm of sim water (rain film) on a hill. SwiftShader probes run speed 0 at the
  boot water state and their views may not hold such a slope; whether the Mac's view does is what wdebug=wet says.
- BUILT: `?wdebug=wet` magenta = no wet sim cell in this sheet's sim triangle (barycentric say of wet cells < 1 %: the
  level is the dry cells' construction = ghost water), orange = wet cells but the sim's water there < 10 cm, blue = real
  water; dimmed where vDepth < 0. `?wghost=1` the fix candidate: ghost fragments are discarded (a 1 % sliver along
  dry-dry sim edges, a whole all-dry sim triangle). Costs 3 texelFetch + 2 varyings only when one of them is on.
- If wdebug=wet shows the sheet BLUE (real sim water), the depth path is the suspect: then `wsingle=1` (same pass as the
  terrain: no re-entry, no reload of the MSAA depth), `msaa=0`, `invalidate=0`, `zcons=0` separate it.
### 4. NEW LEVER: `?deepbed=1` (default off) — the sea bed under the water is shaded in full and then hidden
- The water is drawn in a LATER pass, so the GPU's HSR cannot drop the terrain under it: at the landing view (~70 %
  sea, bed at -19..-74 m) most terrain fragments are sea bed, each running evalTerrain + lighting. The water shows the
  bed as refr * Tw with Tw = exp(-(sigmaA + sigmaS) * 1.25 * path); its smallest extinction (blue, warm open salt sea, no
  coast / river / silt) is 0.2 / m and path = uw / cos(angle to the vertical) EXACTLY (the straight ray from a point uw
  under the plane). terrainmat FRAG_SURFACE: if (uw - 4 m) > 48 m x cos -> Tw < 7e-5 -> output black and return (depth
  already written; off with water=0, camera under the level, any uDebug view, the tcache bake). Lossless by that bound.
  `?deepbed=2` paints the skipped fragments magenta (also with water=0) to count them.
### 5. tcache=1 at the landing view, by the code (tcache.ts update 418-486)
- near (live): need = size(level) x pxPerRad / dn > (576 - 6.8) / tcdens -> with the finest patches (spacing0 / 2^maxLevel
  ~0.4-0.8 m x 32 = 13-26 m) and pxPerRad ~1030 at 963 px, every finest patch nearer than ~45-50 m stays LIVE. The probes'
  landing camera (orbit 60 m, tilt 75 from vertical) stands ~15 m over the ground: the ground from ~24 m to ~50 m fills
  roughly the lower 40 % of the frame — the land part, the costly part. The sea bed, far away, is what gets cached.
  So the design cannot cover the near ground there; deepbed covers the sea bed for free. To cover the near ground:
  a 1152 class (a whole layer, 55 MB a patch with both anchors: no), or tiles per QUARTER patch for the finest level
  (the slot table + tcLattice addressing would take a sub-tile index), or texels < pixels near the camera (look loss).
- glob: gkey includes round(pxPerRad), uVegFade / uCanopyFade (metres) and uShadowOn: any change re-bakes everything.
### 6. AFTER THE LEAD'S ROUND-16 / ROUND-14 EVIDENCE (MAC-ROUND16-5ee51b2d-full.txt; mac-shots 3, 4, 7, r14-8..12)
- Facts from the reports: P run 1 = 254 draws / 2.4 M water triangles, post:water 290 ms GPU; P water=0: vertex buffers
  1 MB x24 (vs 485 MB x3508 with water: the water sheets are what uploads the terrain pages in P). tcache run 17:
  `tcstat=tiles=118,cached=117,live=2006,hot=0,near=0,wide=61,want=2062/900MB,full=955` (near=0: the camera is 60 m
  up, so my "near" worry above does not apply there; the cap is the limit). js heap 782 MB (run 1) -> 1262-1471 MB
  (later runs, also with water=0: NOT GL mirrors). Headers say `5ee51b2d+dirty` and `hdrmerge=0`; round 16 ran lid
  closed on an XZ320QU 2560x1440 (round 3/4: Dell 1920x1080) — the round-14 file is not in arc-work to compare.
- THE HILL SHEET REPRODUCES IN SWIFTSHADER (it was never looked at from the owner's camera): surface camera at
  17.87588 / -35.0, alt 60, yaw 0, pitch -12, 07:45 (probe-s21 --cams, view y0; shots s23/shots/y-y0.png, z*-y0.png).
  Discriminating runs at that camera (480x274, full scene, all 0 page errors / 0 GL errors):
  * `water=0`: the pale domes STAY (terrain under them shades as far open water, uwFar) -> not the water pass alone.
  * `wdebug=class`: blue; `wdebug=wet`: blue (real sim water >= 10 cm in those triangles); `wghost=1`: no change;
    `wspill=1` (built for a sloping lake->sea pane): no change.
  * NEW `wdebug=hb` (ground under the sheet in bands, full brightness where the sheet is at sea level): the whole
    "hill sheet" is RED at full brightness = sea-level water over ground MORE THAN 10 m DEEP. The domes are SEA:
    submarine rises seen through / under the sea surface on a 3 km-radius planet (lod.radius 3000 m, 40 962 cells
    of ~55 m; horizon 600 m from 60 m up), pale at grazing view under the haze.
  * `hide=veg`: the "trunks" vanish -> they are KELP (vegetation.ts kelp forests, cells with > 2.5 m of water).
    Cause in code: kelp height = 0.6-0.95 x the CELLS' linear water depth, planted on groundHeight (curved ground +
    detail), which over a submarine rise stands metres above the cells' chord -> fronds broke the surface as dark
    spires. FIXED (`kelpfit`, default ON, `kelpfit=0` = old): the share is of (surface + water, linear: the sheet's
    level) - groundHeight. Shot s23/shots/sheet-kelp.png LOOKED: no spires; the sea and domes otherwise unchanged.
  * cell dump at boot (tcache=1 handle, cells2.js): field texture A == lod.fields arrays (0 mismatches); 141 wet land
    cells planet-wide, lakes at 41.5 m and 57.3 m exist (cells 1832, 13081-13083) but are not in this view.
  * SO the earlier "70 % of the frame is real sea" count was right; the sheet is the sea. What reads as "hills" is
    the sea's own far surface + the kelp spires. What remains for the owner's eye is art: the far sea's paleness at
    grazing angles (Fresnel sky + haze) on a tiny planet. Not changed.
- `wspill` (terrainvert.glsl.ts, default OFF): the sloping-pane guard stays as a switch (it is correct for lake-beside-
  sea triangles, none in this view); `wdebug=hgt` / `hb` probes stay (debug only).
- MAC RUNS for problem 3: default (kelp fixed) vs `kelpfit=0` at the landing (trunks gone?); `wdebug=hb` screenshot
  (red at full brightness over the "hills" = sea over > 10 m: settles it); `hide=veg`.
### 7. tcache coverage (run 17) — the change that fits the view in ~256 MB (PROPOSAL, not built)
- want 2062 tiles / 900 MB = 0.44 MB a tile (two anchors x 3 targets x 16 B... at classes 96-144). Levers, multiplied:
  one anchor + per-fragment distance fades (x0.5), T1 RGBA16F -> RGBA8 (D as an octahedral 2x8 + ao; 16 -> 12 B a texel,
  x0.75), class by the patch's SCREEN AREA (projected area / texel density) instead of its nearest edge (far patches at
  60 m altitude are long slivers: class 48-72 instead of 96-144, ~x0.4), mips 1.31 kept. ~0.07 MB a tile -> 2062 tiles
  ~150 MB. Plus priority by screen area (biggest first) and `deepbed`'s sea bed never cached (no need: not shaded).
### 8. JS heap 0.8-1.4 GB (PROPOSAL): with water=0 the GPU holds 1 MB of vertex buffers yet the heap is 1.4 GB, so the
  heap is CPU arrays, not GL mirrors: candidates by the code — every page's BatchedMesh attribute arrays (filled by
  setGeometryAt whether drawn or not: 3508 buffers x ~0.14 MB = ~485 MB when drawn), the ChunkLOD patch cache's
  stand-alone copies (~140 kB a patch, chunks.ts:800 comment), worker results. Measure with a heap snapshot on
  SwiftShader at the landing view (`--full`), then: drop the patch cache's copies once a patch sits in a page (rebuild
  from the worker on a re-split), and give page arrays to GL with no CPU mirror (bufferSubData from the worker's
  transfer, three's onUpload pattern) — both are render-lane work for the next session.
- GATE (SESSION 23 final source): `bash _harness/slot.sh npm run check` 1047 pass 0 fail (s23/check.log); `npm run build`
  exit 0. Default shader text (ocean + terrain) checked identical to 5ee51b2d with `arc-work/shaderdump-s23.mjs`
  (node shaderdump-s23.mjs <genesis dir> '?switches'). Probe helpers: arc-work/s23-run.sh (land2 per switch set),
  s23-run-y0.sh (the owner's landing camera), s23-cells.js (field dump via --eval with tcache=1); probe-s21.mjs gained
  --cams, --step, --eval, view 'boot'.

## LEAD NOTE after MAC ROUND 17 (NEW bc923bf6 vs OLD e50830af, alternating; CPU busy with other jobs, GPU idle before)
- NO REGRESSION: N-old 701 / 901 / 834 ms, N-new 867 / 884 / 767 / 817 ms (means equal). The round-16 "regression" was noise.
- WATER: P 133-150 ms early in the round (drifting to 334 later). P + wfrag=0: 33 ms (28 fps). + wdepth=0: no further gain.
  So the water's cost IS its fragment shading after the discards: the six wshade cuts leave most of it (sky LUT taps, cloud
  shadow, mirrored cloud deck, glint / moon, the 4 + 3 normal loops, waterland taps). Target for the water: near wfrag=0.
- THE HILL SHEET IS NOT THE SEA'S SHAPE: with `wsingle=1` on the full game the owner sees a FLAT SEA TO THE HORIZON and the
  hill sheet is GONE (mac-shots/r17-13.jpg vs r17-14.jpg, same view, same minute). So water sheets exist there and are flat;
  in the normal two-pass path something removes or loses the water over the far sea and the submarine rise shows through with
  its pale under-water / far-water stand-in look. `wdebug=hb` paints sea and "hill" the same red (r17-15.jpg).
  wsingle=1 reads no scene copies, so it also lost reflections and depth colour (expected for the switch).
- kelpfit: confirmed on the Mac (spires gone; kelpfit=0 brings them back).
- deepbed=1: looks the same; one faint thin dark diagonal streak on the water at the lower right (check).

## SESSION 24 (verify hill sheet) — the "hills" are the SEA FLOOR's silhouette printed on a level sea by the weather fog
Camera: the brief's / s23 y0 (surface 17.87588 / -35.0, alt 60, yaw 0, pitch -12, 07:45), babel 307987276, SwiftShader
480x274, full scene. Helpers: arc-work/s24-run.sh (one boot at y0: tag, switches, [step], [eval]), s24-sheet.js (eval),
s24-simcells.ts (headless sim). Shots / logs: scratch/arc/perf/s24/.
### 1. Geometry, measured (s24-sheet.js: every drawn patch's vertices re-evaluated on the CPU with terrainvert's tGround
  formula from the live field textures, projected with the live camera, z-buffered into a 48x27 screen grid)
- WATER sheet in view: 470 of 519 drawn patches wet; every visible water bin at height 0.0 m above sea (min = max = 0.0),
  from the shore to the horizon (rows 13-26, distance 87-429 m). A level sea: (a) false.
- TERRAIN under it: rows 15-17 (the "humps") -141..-7 m, median -69; rows 18-26 median -115..-119 m; the islands at the
  horizon (rows 11-13) +40..+84 m. The mesh's own level there (A.z) 0.0 everywhere; no terrain bin above sea level is
  covered by water and no sea-flagged cell stands above sea level. (b) false.
- SIM cells under the humps (e.g. 3354 / 3385 / 3413 / 3441 / 3468 / 3494, 3321 / 3349 / 3376, 3099 / 3140 / 3142): ground
  -125..-50 m, water = -ground, level 0.00, ocean = 1, salinity 1. Headless (s24-simcells.ts) at day 0 / 2 / 10 / 30: the
  same, levels 0.00 to -0.03 m; of the 690 cells within 800 m of the camera, wet cells with level > 1 m above sea: 0 on
  every day. Nothing to drain. (c) false.
### 2. What draws the "hills": screenfx.ts height fog read the OPAQUE depth copy (post.linDepth, taken BEFORE the water)
- `wdebug=hb` (water fragments flat red): the red sheet is drawn to the horizon everywhere, but a pale veil lies over it in
  the shape of two humps and a V: unchanged with `nodepth`, `waterland=0`, `clouds=0`, `atmo=0`. So it is laid on AFTER.
- The weather's height fog (weatherfx -> screenfx OVER pass; fogDensity 0.00087-0.00091, scale 140 m at this view: the
  overcast haze) takes each pixel's distance from post.linDepth = the opaque scene WITHOUT the water: over the sea that is
  the distance to the SEA BED, and where no bed lies behind the water (the sight line passes over a submarine rise's crest)
  the "sky" 6000 m. Straight-ray integral exp(-h/140): bed 400-700 m away -> fog ~0.15-0.25; sky -> fog 1.0 (white). So
  the image shows the sea floor's silhouette: the rises under less fog ("hills", the kelp dark inside them), the white V
  where the line of sight clears the rise. Also its ground under the camera was the sea bed (fog thinned as if the 120 m
  of water were air). That is also why `wsingle=1` cured it on the Mac (r17-13): the water is then in the opaque pass, so
  linDepth holds the water's depth. And why `water=0` kept the domes (s23): the bed still makes the fog's silhouette.
- The colleague (s23 §6) was right that the sheet is the sea and the domes are submarine rises, wrong that they are seen
  through / under the water: the water is opaque there (path >= 400 m capped, Tw ~ 0); it is the fog's depth.
### 3. FIX `fogwater` (screenfx.ts + godfx.ts, default ON; `?fogwater=0` = old)
- The fog and the ground / sky tint read the RESOLVED scene depth (post.depthTexture, water included; decoded with
  DEPTH_DECODE like the atmosphere, log or revz) instead of linDepth; the fog's ground under the camera is
  max(ground, radius + seaLevel). Cost: none (same one tap).
- PROOF (s24/shots): before-after.png (top fw0 = fogwater=0: humps + V; bottom fw1 = default: a flat sea to the horizon,
  the islands on it), fw1hb-y0.png (wdebug=hb: red to the horizon, no V) vs hb-y0.png (old: V). ws0 / ws1 = wsingle=1 with
  fogwater 0 / 1 (flat both: the Mac's control reproduced; shots/wsingle.png). All 0 page errors. Built from HEAD
  39eb7eb0 in a clean export: the live tree's ocean.ts holds the water agent's half-done `WFAST3` / fastOceanShaders hook
  (tsc errors, ReferenceError at material build), not mine.
- GATE: on the HEAD export detban clean, typecheck clean, tests 389 ok / 0 not ok when the 40-min background limit killed
  the run (load ~14; s24/check-head.log): the suite did NOT finish. `npm run build` (live tree) exit 0. The live-tree
  `npm run check` fails at typecheck on the water agent's ocean.ts only (WFAST3, fastOceanShaders).
- Mac round: default vs `fogwater=0` at the landing (the hill must be gone, reflections and depth colour unchanged — the
  water shader is untouched), and `wsingle=1` should now look the same as default apart from the lost refraction / SSR.
- deepbed's thin dark diagonal streak (r17 lower right; thin dark diagonals show in r17-14 without deepbed too): not
  investigated this session. Suspect: a hairline crack in the water sheet at a patch LOD border (the water has no skirts),
  through which the bed shows (black under deepbed). Check with `wdebug=hb` on a dark background (`deepbed=2`) at that view.

## SESSION 26 (lean tcache) (2026-11-18, TERRAIN-CACHE agent) — `?tcache=1` to cover the landing view in ~256 MB
### 1. WHY s22's tiles came to ~2 MB each (run 17: 246.7 MB, 9 L, tiles=118, want=2062/900MB, full=955)
- Storage: 9 layers of 1152^2 x 16 B (sRGB8 4 + RGBA16F 8 + RGBA8 4) x 1.3125 (3 mips) = 26.6 MB a layer, cut in
  4 slabs of 576 = 36 slabs of 6.97 MB. A slab held ONE class: 576 -> 1 tile, 288 -> 4, 192 -> 9, 144 -> 16, 96 -> 36.
- A tile was a full square holding BOTH distance anchors (A = lower-left triangle, B = the same lattice rotated): 2x.
- Class by the patch's edge in pixels at its NEAREST point (no foreshortening): from 60 m up every patch is seen at
  5-20 deg, |n.v| ~0.1-0.35, so the class was ~2-3x the edge a by-area class needs (4-9x the texels). want = 0.44 MB a
  tile on average = class ~144 with both anchors.
- The queue was nearest first, so the NEAREST patches (largest classes: 288 / 576 = 1-4 tiles a 7 MB slab) were baked
  first and took the slabs; with 7 classes each needing its own slab, the 36 slabs filled with 118 tiles (36 x 6.97 /
  118 = 2.1 MB a tile). 955 refused (`full`), churn (bakes=1347 for 118 tiles: steal / LRU release and re-bake).
- So: 2x anchors x ~4-9x class (foreshortening) x slab rounding (one class a 7 MB slab) x nearest-first.
### 2. THE LEAN LAYOUT (built; tcache.ts + 3 hook lines in terrainmat.ts + the bake call moved in renderer.ts)
- ONE BAKE AT THE CAMERA OF THE BAKE, texel by texel: camDist = |P - cam|, the sward's eye term from (cam - P), and
  the footprint = the full shader's own length(fwidth(P)) rebuilt from the screen axes and the triangle's plane
  (`tcFwLive`: d/dx = depth/f (R - p (n.R)/(n.p)) in view space, back to the body frame, componentwise abs). So every
  distance fade, the graze term and every footprint fade are the live ones at that camera; neighbours meet without
  steps. No anchors, no tcFade ladder, no `wide`. Camera moved > 3 % of the patch's distance or turned > 15 deg:
  slow-stale (shown, re-baked behind the uncached); moved > 15 %: full shader until re-baked. The graze correction
  per fragment now uses the bake camera (stored per slot).
- FOOTPRINT FINDING (the s22 "meadow greener / softer from 160 m" candidate): s22 baked fw = sqrt2 x d / f (face on);
  the live length(fwidth(P)) of two orthogonal pixel steps of length a, componentwise abs, is on average 1.83 a for a
  random orientation (Monte Carlo), not 1.41 a, and larger off-axis. The bake was ~30 % SHARPER in fw -> more sward
  tips / flowers resolved (+G -B = the measured shift). tcFwLive removes this by construction. To be confirmed by the
  top-down pair below.
- HALF SQUARES: a patch takes HALF a square (lower-left, or rotated 180 deg), two patches a square. Borders 2 texels on
  the legs, 4.24 across on the hypotenuse (x + y <= S - 6), and the display's lod clamped to <= 1 (MIPS 2): proven by
  texel arithmetic that bilinear mip-0/1 taps never reach the partner half. The bake copies the square into the
  scratch first (partner kept), draws its half, copies the square back + mip 1.
- CLASS BY SCREEN AREA: edge = tcdens x (edge px at the nearest point) x sqrt(min(1, |n.v| + relief/size)); classes
  24 32 48 72 96 144 (288 slabs), 192 576 (576 blocks), 288. Usable leg S - 10. tcdens default 1.3 (Nyquist for
  aaF's 0.12-0.45 fw ramp with the footprint above). A tile > 1.9x denser than needed re-bakes smaller.
- PRIORITY: uncached first, then the most screen pixels (area = triangle m^2 x |n.v| x f^2 / (dn x dc)). When full:
  idle tiles (LRU), then a drawn tile of the same class with < half the pixels.
- BAKE COST: `tcbudget` default 64 000 texels a frame (~13 ms GPU on the M5 at ~0.2 us a full-shader texel). The bake
  now runs in the frame's UPLOADS slot (renderer.ts, before any pass); the forest-floor mask then reads the previous
  frame's shadow maps with their (also previous) matrices.
- SLOT TABLE writes compare float32 values (s22 compared doubles to float32 = a texture upload per page per frame).
- tcstat now: `pix=<% of the drawn patches' estimated screen pixels on a valid tile>,used=<MB of tiles>,tiles,cached,
  live,stale,hot,near,want=N/MB,full,bakes,bakeMs=<main-thread ms per tile>/<worst frame>,glob,cls=<edge:n/...>`.

## SESSION 27 (memory) — what the "js heap" is, by owner (MEMORY agent)
### 1. THE FINDING: `performance.memory.usedJSHeapSize` COUNTS ArrayBuffer backing stores; the JS objects are ~35 MB
- Heap snapshot (CDP, after collectGarbage) of the full scene on SwiftShader at the owner's landing camera
  (probe-s21 --views=y0 --full=1 --heapsnap=FILE; node s27-heap.mjs FILE; node s27-ab.mjs FILE): `Runtime.getHeapUsage`
  = usedSize 33.7 MB (objects) + backingStorageSize 329 MB (ArrayBuffers); performance.memory said 386 MB. By type:
  native JSArrayBufferData 311 MB, strings 4.7, code 10, objects/arrays ~10. So there is NO big JS-object holder
  (no WorldView / chronicle / event / history / strings problem: chronicle capped 4000, pendingEvents 512, no rewind or
  autosave copy on the client). The Mac's 0.8-1.4 GB is TYPED ARRAYS: heap = cpu retained (scene arrays) + other
  ArrayBuffers + dead ArrayBuffers not yet collected. Mac run 1: heap 782 vs cpu retained 579 = 200 MB of other live
  buffers (matches the 170 MB "other" measured here); runs 2-17 1260-1400 MB = the same + 500-700 MB of buffers that are dead
  but not yet freed (run 18 fell to 970 with nothing changed: GC reclaimed). water=0 does not change it: the pages' CPU
  arrays exist whether drawn or not.
- Owners, MB, this scene (47-70 pages; the Mac has ~270): terrain pages 134 (the BatchedMesh attribute arrays, one copy,
  `normal` already aliased) | city lights 68 -> 31.5 (acc 6 x 9 MB float + 6 x 2.4 MB bytes; NOT in cpu retained before) |
  vegetation 26 | patch worker recycle sets 22 (cap MAX_INFLIGHT 192 sets) | life 10.5 + 8.8 tex | field textures 8.6 |
  view fields 7.7 | grid 4.3 | groundcover 4.3 | rest. 8-frame sampling profile and an allocation trace
  (s27-abtrace.js, --abtrace=1) of the whole run: only 111 MB of >= 16 kB typed-array allocations on the main thread,
  none per frame: there is no per-frame typed-array churn at a static view.
- NEW PERF REPORT LINE `js heap by owner (MB; usedJSHeapSize counts ArrayBuffers): attributed A of used U | unattributed X |
  terrain pages .. · city lights (cpu) .. · patch recycle sets .. · view fields ..` (gpumem.ts heapProbe, renderer.ts
  heapByOwner; ChunkLOD.heldBytes, CityLights.heldBytes). unattributed = dead-not-yet-collected buffers + unlisted holders.
### 2. CUT (default ON): `?lazyacc=0` = old. citylights.ts: a face's Float32 accumulator (s*s*4 floats = 9 MB at 768) is
  allocated when the first light lands on that face and given back when a rebuild leaves the face unlit (it is all zeros
  then, its last box was cleared). Bit-identical (tests/render-citylights.test.ts incl. the GPU-copy-equals-CPU test; new
  test for the lazy hold / release). Saved 36 MB here (4 of 6 faces unlit at the landing); worlds with towns on all six faces save nothing.
### 3. WHAT REMAINS, and why (not cut)
- terrain page CPU arrays (the 485 MB on the Mac): three's BatchedMesh.setGeometryAt writes into attribute.array and
  WebGLAttributes uploads ranges from it, a 0-length array throws (GPU-MEMORY-PLAN). The lever that exists is the page
  COUNT: landings may open pages up to need + max(6, 75 % of need) (FRESH_LAND, chunks.ts) = up to 1.75x the pages the
  live patches need (Mac: ~270 pages for ~2000 selected patches = 125-155 needed). That allowance exists to avoid ANGLE
  whole-buffer copies (s16): lowering it (`FRESH_EXTRA` / 0.75) trades ~150 MB heap + GPU for copy stalls: a PERF call, not changed.
- dead buffers: V8 frees an ArrayBuffer's store only when its object is collected, and a scavenge-only heap that
  looks small never runs a major GC for external memory. Candidate (not built): release big buffers eagerly via
  transfer (`structuredClone(buf, {transfer})` / postMessage transfer to detach) when a page is disposed.
- city lights acc (9 MB x lit faces) could be a Float16 / sparse tile map; recycle sets could be capped lower (96).
### 4. BEFORE / AFTER (same scene: babel 307987276, landing camera y0, 480x274 SwiftShader, `?lazyacc=0` vs default)
- post-GC ArrayBuffer backing store (CDP getHeapUsage): 319.4 MB -> 286.8 MB (-32.6 MB); JS objects 32 MB both. by owner
  line: city lights 67.5 -> 31.5 MB. (performance.memory 347 both: it is read before the collector frees the buffers.)
- Gate: `npm run check` 1048 pass 0 fail (detban clean), `npm run build` exit 0 (s27/check.log, build3.log).
- NEXT: Mac round: read `js heap by owner` (unattributed = dead buffers + unlisted). If unattributed is 500+ MB, add the
  eager-release of disposed page buffers; if terrain pages dominate, decide the FRESH_EXTRA / 0.75 page allowance.
- Probes: arc-work/probe-s21.mjs --heapsnap=F --alloc=N --abtrace=1 --eval=s27-mem.js; s27-heap.mjs, s27-ab.mjs, s27-ab.sh.

## SESSION 25 (water wfast=3) (2026-11-18, WATER agent) — the water fragment in the cost class of three's Water.js
### 1. BUILT (default OFF): `?wfast=3`, new file src/render/planet/oceanfast.ts + a 4-line marked hook in ocean.ts
- ocean.ts: one import line + the `PERF s25 hook` block in makeOceanMaterial (f3 = fastOceanShaders(OCEAN_VERT, OCEAN_FRAG,
  rippleMap) when WFAST3; vertex/fragment shader picked from it). Nothing else in ocean.ts moved. The fast shaders are
  built from the DEFAULT shaders' TEXT: the fragment keeps ocean.ts's main up to `vec3 P = vBodyPos;` verbatim (all the
  hill-sheet agent's discards / debug views carry over), then its own body; the vertex gets one block appended before
  `#include <logdepthbuf_vertex>`. If an anchor goes missing: console.warn and the default water (no break).
- VERTEX (per wet vertex, vDepth > -40 m): Gerstner 4 + swell 3 GRADIENTS in three groups (short 5.3/8.5 m, long 13/21 m,
  swell 34-87 m) faded by the LATTICE spacing (uMorph.z / 1.5, x2 while morphing; kept while >= 2.5-5 vertices a
  wavelength), their slope variances passed; what the lattice drops goes into tile B's amplitude (same band) or, for
  the swell, the roughness. Sun colour (transmittance x cloud shadow), sky irradiance + night floor, the moon's cloud
  shadow, the mirrored deck's LIGHT at the flat-mirror hit, extinction (sigmaA + sigmaS incl. temperature, river, coast,
  4 silt zones) and in-scatter albedo, the ripple amplitudes kA / kB (sea state x fetch x group noise). 8 vec4 varyings
  (14 rows in all with the old ones; WebGL2 minimum 15).
- FRAGMENT after the discards: normal = 3 vertex groups faded by footprint (anisotropy capped 2:1) + wfast=2's ripple
  map (tiles 5.3/3.9 m, 37/29 m, textureGrad, triplanar |up|^6 with <2 % weights dropped: 1 projection on most of the
  planet), each tile's taps skipped once its mip has flattened it (variance -> roughness, LEAN as before); rivers: the
  two-phase flow map. Sky mirror skyRadiance (2 LUT taps); clouds mirrored = 1 cube tap of the cloud-shadow cube
  (cloudDensityAt is that one tap) along the long waves' normal, lit by the vertex. SSR = screen-space DDA
  (McGuire-Mara: 1/w, z/w linear on screen), 20 samples at u^1.8 (dense near the water pixel: banks / trees),
  INDEPENDENT taps (no matrix per step), 4 bisection, 3 reprojected taps on a hit, only where F > 0.03 and view < 3 km.
  Refraction 2 depth + 1 colour, extinction analytic (vertex coefficients). Glint GGX + glitter (3 hashes) + moon
  (2 LUT taps at night). Sun shadow: 5 PCF taps in cascade 0 only, 1 beyond. Foam / shore / whitecaps / gale streaks /
  lace / surge churn: taps of ONE 256^2 RGBA8 tiling gradient-noise map (channels = lattice tile/4../32, std 0.37 =
  snoise's, measured) at 64 m (shore pulse + bite, surge margin), 32 m (surf, drifting), 8 m (lace, flow-advected),
  24 m anisotropic (whitecaps), stretched frame (gale), 256 m (surge billows) — each only where its term can be non-zero.
  Ice and silt streaks: arithmetic noise kept (rare, gated as before).
- Sub-cuts `?wshade3=` nodetail (no ripple taps), noreflect (no deck, no SSR), nossr, norefract (no scene taps),
  nofoam, nosky (no sky LUT: irradiance stand-in), pcf5 (5 PCF taps in every cascade).
### 2. STATIC COUNT per water fragment (open calm sea by day, one projection; s = arithmetic simplex ~150 ops)
                         default (s21 count)                     wfast=3
  simplex                20 (+5-8 foam, +4 rivers)               0 (ice / silt only, gated)
  loops                  4 Gerstner + 3 swell + 14 wavelets      SSR 20 x ~12 ops (+4 refine), no wave loop
                         (x2 rivers) + SSR 28 x (mat4 + tap)
  taps                   ~45: PCF 5, cloud shadow 2 cube, deck   waterland 1(+4) [unchanged], ripple 4 near / 2 mid /
                         1 cube + 2 LUT-light (~6), sky/sun      0 far (x2 rivers, x2-3 at cube diagonals), sky 2,
                         LUTs ~8, depth 2 + colour 1, SSR <=28   deck 1 cube, shadow 1 (5 in cascade 0), depth 2 +
                         + 8 + 3, moon LUT 2 + cloud 2           colour 1, SSR <=20 + 4 + 3 (F > 0.03), shore 1-2 and
                                                                 foam 1-4 only there, moon 2 at night
  ALU (rough)            ~3000 noise + ~1500 loops + ~600 rest   ~350 + SSR ~250
  vertex (per wet vtx)   unchanged base                          + 7 wave terms (~200 ops) + ~12 taps (LUT / cube)
