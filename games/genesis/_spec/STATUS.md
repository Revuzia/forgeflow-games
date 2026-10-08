# GENESIS — status after phase 1 (integration)

Phase 1 = sim core + render foundation, integrated: the app runs the **real deterministic sim in its Web Worker** by
default and draws it live. No peoples, buildings, god hand, UI panels or audio yet (phases 2–5).

## How to run

```
npm install
npm run dev                      # http://localhost:5190/  (the real sim, scenario 'lookdev')
npm run check                    # detban + tsc + all node tests
npm run build                    # dist/ (app + the sim worker bundle; base './', hostable from any sub-path)
node _harness/shots.mjs _harness/specs/liveloop.json    # barren → air → rain/seas → life → mountain → sunset → night
node _harness/shots.mjs _harness/specs/scenarios.json   # sandbox / lookdev / twoworlds / system
node _harness/shots.mjs                                  # the render-dev reference set (?source=lookdev)
node _harness/perf.mjs --scenario=sandbox --speeds=1,10,100,1000
open /_harness/treeview.html     # every procedural tree kind × LOD (dev tool)
```

URL: `?scenario=barren|sandbox|lookdev|twoworlds|system` `&seed=` `&speed=` `&quality=low|medium|high|ultra|cinematic`
`&source=worker` (default) `|lookdev` (render-dev generator, no sim) `|auto` (worker, falls back to lookdev with a toast)
`&hour=` `&cam=orbit|system|coast|valley|peak|town|forest` `&ui=0` `&dev=1` (dev overlay + `window.__GENESIS_APP__`).
Test surface: `window.__GENESIS__` (CONTRACT §18). Hours are the planet's own (a 30 h world has noon at 15).

## What works

**Sim (worker / Node, deterministic):** every §7 field; hydrology (pipes with momentum, sea reservoir, rivers, springs,
erosion, floods, tsunamis), hourly climate (energy balance, greenhouse, lapse rate, humidity advection, rain/snow,
clouds, winds), weather systems, terrain brushes + lava/sand/ash/talus, fire, vegetation (30 species, succession),
biomes, chronicle firsts, save/load (GNSS, including commands queued for the next tick), rewind (compressed
reverse-delta keyframe ring + log), command registry with per-command schema validation and
readable refusals, parameter registry, phase-1 freeform (`set <path> <value>` + power words). Worker pacing with
achieved-speed reporting (3 s sliding window) and throttled transferable field snapshots; the worker sleeps between
tick slices instead of spinning (1.6–5 % of a core at 1x–100x on an idle world).

**Integration:** worker is the default source; snapshot fields/units match what the renderer packs (flow m/tick →
m/s, ice = ground + floating, species = plants.json indices, hour in planet hours); the render clock advances at the
*measured* sim rate (sliding 1.2 s window, capped at the requested speed) so spin, sun and calendar stay smooth when the
sim cannot hold the requested multiplier; the app sends a throttled `focus` command (the sim's default "here");
`shots.mjs` applies commands → steps → camera and logs every command result. Sun direction checked equal between
sim (`sunDirBody`) and client (`bodyQuat`) at hours 0/6/12/18.

**Ground (CONTRACT §4.3, one definition):** `src/sim/grid/surface.ts` now interpolates `surface` with a curved,
Phong-tessellation-style blend (α = 0.75) from per-cell tangent-plane gradients fitted by least squares (|g| capped at
1.2). The sim (`Planet.ground()`, lazily cached on the surface version), the client mirror (WorldView), the terrain and
water vertex shaders (gradients in field texture G) and CPU placement/picking all evaluate the same formula;
`tests/ground.test.ts` checks a float32 JS re-implementation of the GLSL against `groundOffset` on the real packed
textures (max difference 0.08 mm), sim vs client gradients (identical), continuity across 602 edges (≤ 0.4 mm), every
cell interpolated exactly, and accuracy on a smooth relief (RMS 0.24 m curved vs 0.51 m flat facets). The same
function now carries **dunes**: a meridian-aligned ridge pattern (26 m wavelength, gentle stoss / steep lee, sinuous
warp, cross-faded at the antimeridian) whose height follows each cell's sand depth (none on beaches, up to 1.8 m in a
sand sea), evaluated identically on CPU and GPU (`duneNoise`, `duneAmpOf`; field texture D carries the amplitude).

**Shots (all on the real sim unless noted; `_shots/`, regenerate with the specs above):** `loop-01…12` (barren →
air: blue limb and sky → planet-wide storm → crater seas → green where water and warmth allow → a raised range →
sunset → dusk terminator → night), `sc-*` (sandbox, lookdev coast/river/valley/forest/peak, twoworlds and system
views, Rust, Cinder), and the lookdev reference set (`orbit-day`, `valley`, `sunset`, …; the originals are in
`_shots/before/`).

**Render (WebGL2):** HDR pipeline (MSAA, bloom, god rays, auto-exposure, lens flare, AgX + grade + golden-hour
split-tone, FXAA, grain; NaN/Inf pixels are dropped before bloom), physical atmosphere with LUTs and aerial
perspective (black sky when airless), volumetric clouds from the sim's cloud/precip fields organised into weather
(storm spirals from the sim's weather systems, banded decks, cell-scale towers; two-segment shell march so the deck
has a base seen from below; temporal resolve with reprojection), chunked terrain LOD with geomorphing, skirts and a
silhouette-aware split (a round limb from orbit), smooth-shaded layered procedural terrain material (analytic-gradient
micro normals, rock on ridges / peaks / cliffs with scree, beaches, narrow noise-broken wet band, filament caustics),
near-camera instanced ground cover (grass tufts, stones; deterministic per cell, shrink-in at the range edge),
ocean/river water (Gerstner, flow-mapped ripples, refraction/absorption, SSR with reprojection and a ray-crossing
test, shore blend by depth, energy-gated foam, rapids only on fast water, sea ice that fades at the waterline),
cascaded sun shadows, starfield, star (limb darkening and granulation readable up close), orbit lines, orbit/system/fly
cameras, HUD with achieved speed. `?ui=0` / `__GENESIS__` clean captures also hide the portal control bar.

**Trees (no lollipops):** one branching skeleton per variant (trunk → limbs → branches → twigs), crowns of
alpha-tested leaf sprays at the twigs with sky between them; LOD1/LOD2 regroup the same twig tips so silhouettes do not
change; conifers are whorls of needle-spray cards around a dense core; birch, umbrella (acacia / rainforest), palm
(V-section fronds), dead and shrub forms; species, height and leaf colour from the sim's `treeSpecies`/`shrubSpecies`
(plants.json), autumn colour for deciduous species, per-tree lean/girth/brightness, trunk bases blended into the soil,
coverage-preserving alpha at coarse mips. Crowns carry a per-vertex crown depth (inner foliage darker, rim lit), a
single sky-ambient term, per-tree hue / value jitter, clumping, height variance and an understory; trees at the edge
of the vegetation range shrink into the ground per instance (no per-pixel dither confetti).

## Phase-1 review fixes (fix engineer)

All 41 review findings were triaged; every critical and major one is fixed except where noted under Known gaps.
Repro probes live in `_harness/scratch/simrev/` (sim) and `_harness/scratch/fix/` (render captures, `capture.mjs`);
regression tests in `tests/simreview.test.ts`, `tests/determinism.test.ts`, `tests/water.test.ts`,
`tests/worker.test.ts`, `tests/ground.test.ts` and `tests/render.test.ts`.

**Sim**
- *Rain cache vs ocean mask (critical):* `rainingCells()` no longer depends on the ocean mask (the climate pass skips
  sea cells itself), and `computeOcean()` marks it dirty. Save/load sweep: 0 hash mismatches; rewind 6/6.
- *Ocean seeding:* the sea floods from the previous sea (cells still under the level), else the recorded seed cell,
  else the deepest cell, so an inland pit deeper than the sea no longer steals the ocean. Barren → seas keeps its sea.
- *Sea-level ramp vs tsunamis:* the ramp shifts the existing sea by the step and floods only newly drowned cells
  (generation stamp) instead of re-filling the whole ocean, so a running tsunami survives the ramp.
- *Seepage accounting:* seepage is added to `hydro.sourced`; volume drift 0 in `seep_accounting.ts`.
- *Erosion publishing:* surface/sand/soil versions bump only after ≥ 2 cm of accumulated change (or every 30 steps):
  39 bumps vs 485 before over the probe, i.e. far fewer full-field snapshots.
- *Worker pacing:* sleeps with `setTimeout` (≥ 4 ms) between slices, `setImmediate` continuation in Node and a
  generation-tagged `MessageChannel` in browsers; idle 1x world 1.6 % of a core (was a spinning core at 10x/100x).
  Achieved speed: 3 s ring of samples ≥ 12 ms apart, snapping to the requested rate within one tick (1x reads 1.00).
  Node host at 1000x: command latency p50 10 ms.
- *Pinned season:* the sun keeps its true orbital geometry and only the declination is replaced; the frozen-sun spin
  follows the sun longitude, so pinning neither moves the hour nor heats from a fake position (angle error 0°).
  Snapshots publish the sim's own `sunDir`, which the renderer uses (sim and render agree by construction).
- *Keyframe memory:* keyframes form a reverse delta chain (XOR against the next-newer keyframe, byte-plane shuffle,
  zero-run RLE, `src/sim/core/kfcodec.ts`), encoded incrementally (2 MB of raw arrays per tick) under a 64 MB
  encoded budget. Full ring at the default spacing: sandbox 52 MB (was 135), twoworlds 83 MB (228), system 98 MB
  for 9 keyframes (413 MB for 16). Rewind to the oldest keyframe reproduces the lived hash.
- *Brush schemas:* each terrain brush has its own `strength` range (raise/lower 0–1000 m, flatten/smooth 0–1, noise
  0–500, crater 0.05–5), `height` only for flatten, `frequency` only for noise; mountain height and dig-sea depth
  capped at 1000 m; brushes clamp ground to the planet's limits. Dig-sea marks newly drowned cells as sea at once.
- *Talus sleep:* cells go back to sleep once their excess over the angle of repose stops changing (0 awake after a
  big brush settles).
- *`weather.clear` everywhere:* takes `everywhere: true` (freeform "clear weather everywhere" maps to it) and clears
  every system plus the global weather, with a readable message (also when no place can be resolved at all); a local
  clear that finds nothing says so and points at the planet-wide weather.
- *Timewheel overflow:* one overflow entry per id (`inOverflow` set), cancelled/fired entries dropped on migration.
- *Storm winds:* the hourly climate pass re-applies the weather overlay after resetting winds, so storms keep their
  winds through the hour boundary (70/70 ticks).
- *Altitude datum:* temperature lapse uses the planet's reference level, not the current (ramping) sea level.
- *Global weather:* `setGlobalWeather` re-bakes precipitation and cloud exactly (old floor removed) and re-composes sky.
- *Queued commands* are saved and restored with the sim (`queue` in save and keyframe headers).
- *types.ts:* `hourAtLon0` documented as the planet's own hours (0..dayHours).

**Render**
- *Flat shading (critical):* chunk geometry now has a `normal` attribute (shared with the unit-direction positions),
  so three r186 no longer compiles the terrain as FLAT_SHADED. Test in `tests/render.test.ts`.
- *SSR (critical):* rays are reprojected through the planet's body frame into the previous frame, accept a hit only
  on a real depth crossing (no streaks from thick-surface hits), are jittered per frame and fade by distance, screen
  edge and roughness.
- *Water geometry (critical):* ice is resolved before the shore blend and fades at the waterline (filtered cracks);
  rapids only on genuinely fast water; thin sheets lying on slopes fade out (smooth "paper" fade rather than a hard
  discard); where two still basins at different levels share a sim triangle, the lower keeps its flat level below
  its shoreline and the upper sheet thins to nothing at that shoreline (`h = max(lo, min(linear, g + 1.5 (g − lo)))`,
  every switch continuous across sim-triangle edges), so there is neither a tilted pane nor a wall. The literal
  "take the nearest cell's level" of the finding was tried and rejected: it stands a wall on every cell boundary and
  flat polygons of water on straight sim-triangle edges. The suggested clamp of every shore vertex to
  `min(level, ground − 0.05)` was *not* applied: it removes water from whole shore triangles (visible bands of dry
  sea bed at every coast); the shore blend by depth already hides those edges.
- *Clouds (critical + majors):* new density model organised by weather (storm spirals from the sim's systems,
  meandering storm tracks and broken cloud under a planet-wide weather, cell towers), two-segment march through the
  shell (the inner shell no longer cuts the deck), a terminator term using the air above the sample (no blood-red clouds on the night side), temporal resolve with reprojection
  and history reset on camera cuts. Atmosphere upsamples clouds with a depth-aware 3×3 Gaussian.
- *Tone:* AgX lift 0, saturation 1.18, power 1.3; single sky-ambient term (three's `RE_IndirectSpecular` was adding a
  second Lambert term from `iblIrradiance`), specular occlusion and horizon occlusion on rough ground (no blue sheen).
- *Ground material:* analytic-gradient simplex micro normals, rock on convex ridges and peaks (curvature from field
  N.w) and cliffs, scree, beaches, broad low-contrast meadow variation (no camouflage), two relax passes on
  vegetation and moisture, narrow noise-broken wet band skipped under vegetation (and faded where it would be
  thinner than a pixel, which drew dotted outlines round steep pools), filament caustics, worn paths only
  (no area-fill cobbles).
- *Ground cover:* `src/render/life/groundcover.ts` + `src/render/gen/groundgen.ts` (grass tufts, stones; ≤ 2 new
  cells per frame so a cut does not stall; each cell's scatter is cached under a quantised signature of the fields
  it reads, so live snapshots rebuild only cells whose inputs really changed and keep drawing the old scatter until
  then).
- *Trees and hand-over:* see the trees paragraph above.
- *Orbit framing:* orbit preset at hour 16.25 (side-lit, with relief); live-loop orbit shots likewise.
- *Star close-up:* when the disc fills the view the exposure comes from the disc's own radiance (centre ≈ 1.2 before
  AgX), its colour is saturated along its own hue (a G star reads gold with an orange limb, not a white flood or a
  grey moon), limb darkening uses the true line-of-sight angle (the view-space normal's z kept half of it up close),
  the corona is sized to the disc's silhouette (it no longer washes over the limb) and becomes a thin warm rim,
  sunspots are small umbrae in activity belts, granulation visible; orbit lines hide near the star.
- *Snow/ice:* partial snow follows the land, not noise (shaded and pole-facing slopes and hollows keep it, sunny
  convex ground melts out first) with a wide, gentle transition (no dalmatian spots); ice crack pattern filtered.
- *Silhouette LOD:* seen from altitude, patches near the limb split up to 3.5× sooner (cubic in grazing angle; the
  geomorph uses the same factor per vertex), so the limb is round without refining the disc centre; the boost fades
  out below ~a third of a radius of altitude, where nearly every distant patch is edge-on and it only cost draws.
- *Desert:* dune term (see Ground), the `desert` POI requires real sand, low vegetation and moisture and no snow
  (bare-and-dry alone matched the ice cap) and scores the neighbours' bare sand too (a sand sea, not a sandy
  clearing), falling back to the barest sand; shore foam gated by wave energy (still
  ponds have no foam ring).
- *Capture:* `?ui=0` and clean captures hide the ForgeFlow control bar (`.genesis-clean`).

## Measurements (headless Chromium, SwiftShader — CPU rendering; frame times are for regressions only)

Machine: 4-core Xeon @ 2.1 GHz; SwiftShader renders on the same cores the worker uses, so sim rates here are a floor.

| scenario (worker) | requested | achieved | ticks/s | notes |
|---|---|---|---|---|
| sandbox (terran n=64 + moon), orbit view, 1280×720 high | 1x | 1.0x | 10 | |
| | 10x | 10.0x | 109 | |
| | 100x | 95x | 855–1011 | |
| | 1000x | 108–115x | 1021–1164 | CPU-bound: the sim's idle cost is ~0.85 ms/tick; it never skips work |

Node, sim only (`node _harness/perf_sim.ts`, SIM lane): barren 7943 ticks/s idle; sandbox ~1135–1190 idle, ~260 in
planet-wide monsoon; twoworlds ~415, system ~280 over a game day. After the review fixes (same harness, same machine,
run-to-run noise ±25 % on barren): barren 5550–9240 idle / 257–292 in heavy rain (HEAD on the same run: 7150 / 290);
sandbox 1110 idle / 237 in monsoon.

Rewind ring (`_harness/scratch/simrev/keyframe_mem.ts`, default spacing 2880 ticks, ring full): sandbox 52 MB,
twoworlds 83 MB, system 98 MB for 9 keyframes (before: 135 MB, 228 MB, 413 MB for 16 raw copies); a rewind to the
oldest keyframe decodes the whole chain and reproduces the lived hash.

Worker (browser, `_harness/scratch/simrev/worker_cpu.mjs`): an idle sandbox at 1x–100x costs 1.6–5 % of a core (the
old pacing spun a core at 10x and 100x); achieved speed reads 1.00 at 1x. Node host at 1000x: command round trip
p50 10 ms.

Render clock (`tests/clock.test.ts`, 60 Hz frames, jittered 30 Hz integer-tick snapshots): per-frame rate jitter
4.4 % at 1x, 1.5 % at 10x, 3.2 % at 100x, 3.8 % at 1000x-held-at-300x; never backwards; ≤ 0.08 s behind the sim.

Main thread (Node timing of the same code): full snapshot apply incl. curvature gradients 19 ms, first texture
pack 54–68 ms; a typical update (water + flow) 5 ms; an hourly all-fast-fields update ~21 ms.

SwiftShader frame (regression reference only): orbit 1.1–2.4 s/frame (90–280k tris), surface with forest 4–11
s/frame (2.6–7.6M tris, 450–1800 draws); 480×270 low: ~0.3 s/frame. `render()` CPU 25–100 ms. After the review
fixes: the orbit view draws ~725k triangles in ~300 terrain patches (the silhouette-aware split rounds the limb; it
fades out below ~a third of a radius of altitude, which halved the patch count of low views that had paid for it);
surface views 4.7–10M triangles incl. trees and ground cover, 3–4k draws; `render()` CPU 30–140 ms.

## Known gaps

- **Not built yet (phases 2–5):** peoples, settlements, buildings, animals, the hand, creature, god powers UI
  (palette, radial, freeform field, inspector, chronicle panel), audio, the opening (`?intro` is ignored), saves and
  settings UI, photo/follow/dolly/walk cameras (they fall back to orbit/fly), gamepad/touch, city lights.
- **Sim speed:** ≥ 1000 ticks/s holds only for idle/normal weather on one world; planet-wide heavy rain ~260
  ticks/s; multi-planet scenarios 280–415 ticks/s. 1000x is best effort (the HUD shows the achieved speed).
- **Sim model (SIM lane notes):** sea is a level-held reservoir (no currents/tides); snow melt runs in the hourly
  climate pass; a barren world takes ~10 game days to warm after air (rain on it before then falls as snow);
  freeform is the phase-1 subset; mods apply to the next world; the rewind ring holds ≤ 64 MB encoded plus one raw
  copy of the newest keyframe (a 7-world system therefore keeps ~9 of its 16 keyframes); the
  planet `kind` (palette) stays `barren` after the player terraforms it.
- **Clouds:** organised by the sim's weather (storm spirals, bands, towers) and temporally resolved, but the
  organisation is a density model around the sim's systems, not a fluid simulation; fast camera moves can show a
  frame of history lag at cloud edges. Low-sun cloud reddening is art-directed (extra extinction toward a low sun),
  because the cloud shell sits above a 3 km world's dense air.
- **Air:** optical depth is 1.75× Earth's with a thinner scattering layer (for real sunsets); aerial perspective
  from orbit is reduced to compensate, but orbit views are a little hazier than before.
- **Ground/water:** colour fields are relaxed one step over the cell graph, which softens but does not remove faint
  creases along 50 m sim-triangle edges on flat ground; sim rivers follow cell paths, so channels run straight for a
  few cells (waterlines are noise-broken and fade by depth, the channel itself is the sim's). Steep water sheets are
  drawn as cascades. Patch skirts can show as thin dark dashes for a frame or two while LOD streams in (a camera cut
  now builds up to 320 patches per frame for 4 frames).
- **Per-cell shapes that remain:** a single wet cell on flat ground (a rain pond, an oasis) still reads as a
  polygon with a few straight edges, and from orbit the Rust world's valley vegetation / water patches keep
  sim-triangle outlines: fields are interpolated linearly over sim triangles, and only the ground (and the water
  level between basins) is curved. The lookdev world has no sand sea, so its `desert` POI frames the barest sand
  pocket there is (inside woodland).
- **Lookdev generator (`?source=lookdev`, render-dev only):** its polar coasts step 40–60 m between neighbouring cells,
  so the snowy polar hills still make a jagged rim from orbit. The real sim's rim is smooth.
- **Vegetation:** trees shrink into the canopy layer per instance at the range edge (no dither); cactus, kelp,
  mangrove and willow use the generic forms; no seasonal leaf loss (autumn colour only). Ground cover is grass tufts
  and stones only (no flowers, driftwood or shells yet) within 34 m; it is off at `quality=low`.
- **Main thread:** an hourly update that changes every fast field costs ~21 ms (repack + curvature) on the frame it
  lands; it could move to the worker or be spread over frames.
- **Perf on real GPUs is unmeasured** (all frame times are SwiftShader). FXAA only (no SMAA/TAA). SSR reprojects the
  previous frame (one frame of lag, by design) and fades at screen edges; there are no planar reflections, so what is
  off screen is not reflected. No SSAO (contact darkening comes from crown depth, concavity and horizon occlusion).
- **Roads:** the field draws worn earth only; paved roads as ribbon meshes along the most-worn edges arrive with the
  peoples (phase 2), so the review's ribbon request is deferred, and the old area-fill cobbles are gone.
