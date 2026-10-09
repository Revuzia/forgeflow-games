# GENESIS — build contract

> *You poured water on a dead rock. Now they have a word for you.*

GENESIS is a multi-planet living-world god game. The player is a maker: they light a star, breathe air onto a dead
world, pour seas, seed life, drop a people, and then watch, help, terrify, teach, or wreck them, live, while a real
simulation runs underneath. Peoples invent their own way from stone toward the stars, or stall, or die, or leave.

This file is the single source of truth for module boundaries, data formats and gates. Every lane reads it first.
`src/sim/types.ts` is the code half of §6 and §14. Lists in this file are **floors, not ceilings**.

---

## 1. Pillars (what every change is judged against)

1. **Omnipotence by default.** The player can always act, anywhere, live, while the sim runs. No influence circle, no
   locked tools, no "out of scope". If a power is missing, the freeform "do this" field must still reach it (§11.6).
   An optional *Restraint* mode (off by default) adds worship costs and cooldowns.
2. **A real simulation.** Fields on a sphere (water, sand, lava, snow, ash are volumes that move), agents with needs
   and knowledge, data-driven recipes, ecology, weather, climate. Every disaster is a sim event with consequences.
   Peoples act when the player does nothing.
3. **Emergence, not unlocks.** The player introduces things (substances, ideas, life, disasters, laws, worlds).
   People notice, experiment, adopt, refuse, hoard, forget. Knowledge lives in heads and in writing and dies with them.
4. **Black & White's soul, fixed.** A visible hand that grabs, throws, slaps, strokes. A creature that learns. Belief
   from what you did (awe and fear both count). Miracles as gestures. Disciples. Optional rival gods.
5. **A studio-grade look.** Physical sky and atmosphere, volumetric clouds, god rays, layered terrain materials,
   real water, animated crowds, GPU particles, cinematic cameras. Never the reference's toy look (instanced spheres for
   trees, cubes for houses, flat toy shading, a control card glued to the right edge).
6. **Readable stories.** A chronicle worth reading, inspector biographies, toasts that say what happened and why.

---

## 2. Stack decision

**Runtime: three.js r186 (`WebGLRenderer`, WebGL 2) + TypeScript + Vite 8, sim core in a module Web Worker.**
**Assets: generated in code** (procedural meshes, procedural PBR textures in shaders, synthesized audio).

Why (scored against the alternatives on this build machine and the ship target):

| criterion | three.js + TS + Vite | Unity 6 HDRP | Unreal 5 |
|---|---|---|---|
| ship target (ForgeFlow portal: browser, R2/CDN) | native | WebGL export drops HDRP entirely (URP only) | no web target |
| deep, testable sim | the sim is plain TS: the same module runs in the browser worker and in Node tests (`node --test`), deterministic, seconds per test | C# + batchmode tests, minutes each | C++ + editor automation |
| visual bar reachable | yes: custom GLSL for atmosphere scattering, clouds, water, terrain; HDR post (bloom, god rays, AgX), CSM shadows, log depth for planet-to-surface range | HDRP is the strongest look but cannot ship to the browser | Lumen/Nanite, but no browser |
| verify loop in this container | headless Chromium + SwiftShader WebGL 2 screenshots; tsc + node tests | no editor in container | no editor in container |
| content as data (mods) | JSON packs loaded at runtime, same loader in Node and browser | ScriptableObjects (editor-bound) | DataAssets (editor-bound) |

WebGPU (three's `WebGPURenderer`) was considered: headless Chromium here exposes no `navigator.gpu`, so it cannot be
verified; WebGL 2 is the shipping path. Blender is not installed in the build container, so hero meshes (characters,
creatures, the hand, trees, buildings, ships) come from **procedural generators in `src/render/gen/`**. That is a
feature: a modded species or building gets a body from its data without an artist.

Dependencies stay minimal: `three` (+ its `examples/jsm` addons: CSM, EffectComposer passes, etc.), fonts via
`@fontsource/*` if wanted. No physics engine (the sim owns motion), no UI framework (plain DOM + CSS).

---

## 3. Layout and lanes

```
games/genesis/
  README.md  CONTROLS.md  _spec/CONTRACT.md
  index.html  vite.config.ts  tsconfig.json  package.json
  public/            game_meta.json, game_controls.js (ForgeFlow bar), thumbnail.png, data/ (served copies are NOT used; content is bundled)
  mods/              example mod packs (JSON)
  tests/             node --test suites (*.test.ts) — §19
  _harness/          detban.ts (determinism ban), shots.mjs (Playwright screenshots), perf.mjs
  src/
    main.ts          boot: WebGL2 check, App construction, fatal card
    app.ts           App: owns SimClient, Renderer, UI, Audio, input; the frame loop
    testsurface.ts   window.__GENESIS__ (§18)
    data/            content JSON (species, items, recipes, buildings, materials, plants, animals, disasters, weather,
                     powers, names, lexicon, scenarios, creatures, diseases, events) + index.ts (bundles them)
    sim/             RENDERER-FREE CORE (no three, no DOM, no Math.random/Date/performance) — §6
      types.ts       protocol types (this contract's code half)
      core/          rng.ts, vec3.ts, hash.ts (state hashing), timewheel.ts, serialize.ts, ids.ts
      grid/          icogrid.ts, noise.ts, pathfind.ts, spatial.ts
      content.ts     loads + validates content packs (base + mods) into indexed registries
      world/         universe.ts, planet.ts (create / generate), star.ts, orbits.ts, scenarios.ts
      fields/        hydrology.ts, climate.ts, weather.ts, terrain.ts (edits, erosion, sand, ash, snow, lava),
                     fire.ts, vegetation.ts, biomes.ts
      life/          ecology.ts (animals, herds, predation, speciation, extinction), plants.ts, disease.ts
      people/        agents.ts (SoA store), needs.ts, decide.ts, tasks.ts, knowledge.ts, social.ts, settlement.ts,
                     economy.ts, war.ts, buildings.ts, roads.ts, names.ts, culture.ts, cohorts.ts
      recipes/       recipes.ts (graph), discovery.ts, crafting.ts
      god/           commands.ts (dispatcher + registry), powers.ts, disasters.ts (effectors), hand.ts,
                     creature.ts, belief.ts, disciples.ts, rivals.ts, freeform.ts (parser), params.ts (param registry)
      space/         ships.ts, transit.ts, contact.ts
      chronicle.ts
      sim.ts         class Sim: step / apply / snapshot / save / load / hash / rewind
      worker.ts      Web Worker host (ToWorker/FromWorker protocol)
    client/          simclient.ts (worker bridge, snapshot mirror, interpolation), worldview.ts
    render/          ALL three.js code — §15
      renderer.ts  quality.ts  frame.ts (floating origin, planet frames)  shaders/ (GLSL chunks)
      post/        composer, bloom, godrays, tonemap/grade, fxaa/smaa, dof (photo)
      sky/         atmosphere.ts (scattering pass), clouds.ts, starfield.ts, star.ts, aurora.ts
      planet/      chunks.ts (LOD), fieldtex.ts (sim fields -> textures), terrainmat.ts, ocean.ts, lights.ts
      life/        vegetation.ts, crowds.ts (agents), animals.ts, buildings.ts, roads.ts, creature.ts
      gen/         meshkit.ts, treegen.ts, buildinggen.ts, bodygen.ts (species bodies), creaturegen.ts, handgen.ts,
                   shipgen.ts, proctex.ts
      fx/          particles.ts (GPU, stateless), lightning.ts, disasters.ts, weatherfx.ts, rockets.ts
      hand.ts      the god hand (visual + picking)
      camera/      rig.ts, orbit.ts, fly.ts, follow.ts, dolly.ts, walk.ts, photo.ts, system.ts
      picking.ts
    ui/              hud.ts, palette.ts, radial.ts, freeform.ts, inspector.ts, chronicle.ts, settings.ts, saves.ts,
                     keybinds.ts, gamepad.ts, toasts.ts, opening.ts, overlays.ts, gestures.ts, styles.css
    audio/           engine.ts, ambience.ts, music.ts, sfx.ts, spatial.ts
```

**Lanes** (who may edit what). A lane may READ anything. Shared files list one owner; others ask through the
integration step (or make a strictly additive edit and say so in their report).

| lane | owns |
|---|---|
| SIM | `src/sim/**`, `src/data/**`, `tests/**`, `_harness/detban.ts`, `mods/**` |
| RENDER | `src/render/**`, `src/client/**` |
| UI/APP | `index.html`, `src/main.ts`, `src/app.ts`, `src/testsurface.ts`, `src/ui/**`, `src/audio/**`, `public/**`, `_harness/shots.mjs`, `_harness/perf.mjs` |
| DOCS | `README.md`, `CONTROLS.md`, `_spec/**` (owner: orchestrator) |

`src/sim/types.ts` is owned by SIM; additive changes by others are allowed and must be reported.

---

## 4. Planet geometry

### 4.1 The grid
`IcoGrid(n)` (`src/sim/grid/icogrid.ts`, done, tested in `tests/grid.test.ts`): cells are the vertices of a frequency-n
icosphere (10n²+2 cells, 20n² triangles, 12 five-neighbour cells). CSR adjacency sorted CCW (`nbrStart`, `nbr`),
reverse edges (`rev`), dual areas (`area`, unit sphere), `lat`, `meanEdgeAngle`. `locate(p)` returns the containing sim
triangle and **planar** barycentric weights exactly; `nearestCell`, `sample(field, p)`, `cellsWithin(p, angle)`.
`getGrid(n)` caches. Both the worker and the main thread build the same grid from `gridN`.

Default frequencies: home world **n = 64** (40 962 cells), other worlds 40–48, moons 16. Default radius **3 000 m**
(cell spacing ≈ 50 m). Planets are deliberately small ("a world you can hold"), people are true scale (1.7 m), trees
10–25 m, mountains up to ~400 m, the atmosphere shell ~600 m thick, clouds 180–420 m. From a person's eye the horizon is
~110 m away; from a 60 m settlement dolly it is ~600 m. This is the GENESIS look: real materials and light on a world
small enough to orbit in seconds.

### 4.2 Render mapping
The render mesh is a finer flat grid on the same 20 faces: a render vertex at face `f`, flat coordinates `(fi, fj)` in
units of the sim grid (`0 ≤ fi, fj`, `fi + fj ≤ n`) belongs to sim triangle `grid.locateFaceCoords(f, fi, fj)` with those
weights. Render vertices store `(cellA, cellB, cellC, wB, wC)`; the vertex shader fetches the three cells' values from
the field textures (§15.4) and interpolates. Field changes are texture uploads; chunk geometry is static per LOD.

### 4.3 Detail
Sub-cell relief = `detailNoise(noise, p, radius)` (`src/sim/grid/noise.ts`) × a roughness from the cell's materials
(rock 1, soil 0.5, grass 0.4, sand 0.25, snow 0.3, water 0). The CPU (placing feet, trees, buildings) and the render
mesh bake (per render vertex) call the **same function** with the same `Noise3(planet.seed)`. Ground height at p:

```
ground(p) = radius + grid.sample(surface, p) + detailNoise(p) * rough(p)
```

`src/sim/grid/surface.ts` (SIM) exports `groundHeight(planet, p)` and `rough(planet, cell)`; the renderer imports them.

---

## 5. Time

* `1 tick = 1 game minute` (`TICKS_PER_HOUR = 60`). Fixed timestep, integer ticks.
* `1x = 10 ticks per real second`, so a 24 h day lasts 144 s at 1x. Presets: pause, 1x, 10x, 100x, 1000x, plus
  step (1 tick / 1 hour / 1 day). 1000x is best effort; the HUD shows the achieved multiplier
  (`Snapshot.achievedSpeed`). The sim never skips work to keep up (deterministic catch-up): it just runs slower.
* Each planet has its own day (`dayHours`, default 24) and year (`orbit.period` ticks; default 12 days = 17 280 ticks;
  4 seasons of 3 days). Chronicle dates use the planet's calendar: "Year 214, day 7".
* Agent life: lifespan ~60 years (default species); a generation ≈ 25 years ≈ 7 minutes at 100x.
* `sunFrozen` stops the planet's rotation (the sun stands still). `hourAtLon0` scrubbing is a command
  (`time.set`), not a renderer trick: sleep, light, fear, crops and photosynthesis read the same sun.
* *(Note, SIM perf push 2 — time-lapse LOD, `src/sim/perf/lapse.ts`.)* The speed preset is a **logged sim input**:
  the worker issues `time.scale` when the preset changes level (1x/10x → level 0, 100x → 1, 1000x → 2); it is in the
  command log, saved (`settings.lapse`) and replayed by rewind. Level 0 is the plain sim. Levels 1 / 2
  run slow systems on coarser fixed cadences with proportionally larger steps: climate 2 h / 6 h, vegetation 2 h / 8 h,
  weather + rain batches 20 / 30 ticks, overland sheet flow 4 / 12 ticks, hydrology 2 / 4 ticks (half per-step
  friction at 4: same steady discharge, waves at half speed in game time), sand 20 / 30, biomes 12 h / 24 h,
  settlement re-planning ×2 / ×3, keyframes 2 / 4 days. A step after a level change integrates exactly the elapsed
  time. Same seed + same command log (speed changes included) ⇒ same hash. A dead world (no air, water, life,
  weather, lava, fire; not the camera's `focus`) runs its climate and vegetation every 6 h at any level, and wakes at
  the next hour it is not.
  *(Round 2 additions.)* The 4-tick hydrology step applies only while the sea is calm (fewer than 1/256 of its cells
  awake — a pure function of state, decided per 4-tick block); with waves on the sea the pipes run at 2 ticks as at
  1x. A multi-hour climate pass steps the energy balance and the temperature-driven accumulators (means, year
  envelopes, light, melt degree-hours) hour by hour under each hour's sun on ground and shallow water (deep water
  takes one step); evaporation and infiltration of the land stay hourly at every level (`soilHour` runs on the hours
  a coarse or dormant schedule skips). Sediment carried into the sea displaces sea water (an accounted sink).
* *(Note, SIM perf push 3 — the peoples' time-lapse, `src/sim/perf/plapse.ts`; unwatched worlds, `perf/lapse.ts`
  `planetLevel`.)* At levels 1 / 2 people live in coarser chunks, deterministically (every rule is a function of the
  saved state and the logged level): a task of the day's work (gathering, fishing, hunting, crafting, fields, herding,
  teaching, study, preaching, courting, healing, watch; wandering) stands for up to 2 / 4 sessions back to back — as
  many as the agent's water, food, rest and the daylight leave it — and yields those sessions' effects at their own
  ticks (carried yields count the trips home in time); walks run in legs ×2 / ×4 longer (every cell passed is still
  worn); water at hand and food in the hand are taken in passing (store meals are not: the walk home to eat stays);
  the settlement step runs every 2 / 4 hours and integrates the hours (births, old age, accidents with the window's
  probability; sickness hour by hour at each hour's tick); decisions read their settlement's buildings through a
  per-settlement cache (each building's state read live). Level 0 (1x, 10x) is untouched: the same hashes as without
  this note. Measured over two game years
  at 1000x against 1x (6 seeds): population, food in store, ideas, discoveries, buildings and births deviate by
  −0.6 … +3.2 % on their means over the run, as a 1x twin perturbed once does (−1.2 … +2.5 %); deaths are dominated
  by wars and fires, which are chaotic. Keyframes are 8 days apart at 1000x.
  **Worlds the camera is not on** (the logged `focus` names another planet) run coarser still while time-lapse is on
  (level 3: climate 12 h, vegetation 24 h, weather + rain 60 ticks, hydrology 16 ticks while their sea is calm — the
  round-2 rule —, sheets 48, sand 60, lava / talus / ash 30, biomes 2 days, settlement step 6 h, tasks and walks as
  at 1000x). What happens on a world nobody watches at 100x / 1000x is therefore a **time-lapse approximation** —
  same totals, coarser in time — and still deterministic (the focus is logged); water stays conserved and seas settle.

---

## 6. Sim core

### 6.1 Rules
* **Renderer-free.** `src/sim/**` imports nothing from `three`, `src/render`, `src/ui`, DOM or Web APIs (except
  `worker.ts`, which uses `postMessage`). It runs identically in Node (`node --test`) and the worker.
* **Deterministic.** No `Math.random`, `Date`, `performance`, `crypto`, `localeCompare`, `Intl` in `src/sim/**`
  (`_harness/detban.ts` enforces it). Randomness from `Rng` streams owned by systems (`rng.fork('hydrology')`, …) or
  stateless `hash32`. Iteration order is always deterministic (arrays, insertion-ordered maps; never iterate a `Set`
  of objects whose insertion depends on timing). Same seed + same command log ⇒ same state hash on the same JS engine.
* **Fixed timestep.** `Sim.step(ticks)` advances whole ticks. Systems run on fixed cadences (§6.3). Commands are
  applied at tick boundaries in arrival order and appended to the command log with their tick.
* **Typed arrays for bulk state.** Per-cell fields are `Float32Array`/`Int16Array`/`Uint8Array`. Agents and animals
  are SoA stores with free lists. Settlements, buildings, disasters, weather systems, ships, creatures are arrays of
  plain objects or SoA (§6.4). Everything is serializable.
* **Budget.** Home world with ~1 500 agents must sustain 100x in real time on a 4-core laptop-class CPU (≤ 1 ms per
  tick average, i.e. 1 000 ticks/s). Strategies: active sets (only cells with moving water/fire/lava are stepped),
  event-driven agents (a time wheel schedules each agent's next decision; movement is analytic between waypoints),
  cadenced slow systems (climate hourly), cohorts beyond the individual cap.

### 6.2 `class Sim` (`src/sim/sim.ts`)
```ts
new Sim(opts: { seed: number; scenario: string; content?: ContentPack[] })
sim.tick: number
sim.step(ticks: number): void                 // run whole ticks
sim.apply(cmd: Command): CommandResult        // queue for the next tick boundary; immediate validation result
sim.applyNow(cmd: Command): CommandResult     // apply at the current boundary (tests, worker after step)
sim.parse(text: string): CommandResult        // freeform interpretation without applying (preview)
sim.snapshot(opts?: { full?: boolean; since?: number }): Snapshot
sim.drainEvents(): SimEvent[]
sim.save(): Uint8Array                        // versioned (§6.6)
Sim.load(bytes: Uint8Array, content?): Sim
sim.hash(): string                            // stable hash of the whole state (determinism tests)
sim.query(q: string, args): unknown           // inspector data: 'agent', 'settlement', 'cell', 'species', 'recipes', 'knowledge', ...
sim.rewind(tick: number): boolean             // restore nearest keyframe <= tick, replay the log
```
`Universe` holds the star, planets (each with grid, fields, stores), ships, creatures, gods, content registries,
chronicle, command log, keyframes (every 2 game days, ring of 16, for rewind), RNG streams.

### 6.3 Cadences (ticks; the SIM lane may tune, must document in code)
| system | cadence | notes |
|---|---|---|
| commands | every boundary | log + apply |
| agents / animals / creatures | event-driven (time wheel) | movement analytic along waypoints; decisions on arrival / task end |
| disasters, projectiles (thrown things, meteors), hand | 1 | active only |
| hydrology (water, waves, rivers, sea level) | 2 | active set + ocean relaxation |
| fire | 5 | active set |
| lava, sand, snow melt, ash settling | 10 | active set |
| weather systems (fronts, storms) | 10 | move, spawn, decay |
| climate (insolation, temperature, humidity, precipitation, wind) | 60 | full grid |
| vegetation, crops, blight, fertility | 60 | full grid (cheap) |
| settlements (economy, prices, politics, births, cohorts) | 60 | per settlement |
| biomes, erosion, aquifers, soil | 720 | full grid |
| ecology long-term (speciation, extinction), culture drift | 1440 | daily |
| keyframe for rewind | 2880 | |

### 6.4 Stores
* `planet.fields` — §7.
* `planet.agents` — SoA (`AgentStore`): id, alive, species, settlement, household, position (unit vec) + move segment
  (from, to, t0, t1), task, task target, inventory (4 slots item+qty), age (ticks), sex/caste, health, needs (§8.2),
  skills (per skill group), traits (curiosity, boldness, sociability, piety, aggression, diligence), knowledge bitset
  (`Uint32Array` words per agent), memories (ring of 8 compact events), faith (love, fear per god), mood, name id,
  parents, partner, role, flags. Cap per planet: `MAX_AGENTS = 4000` individuals; beyond → cohorts (§8.7).
* `planet.animals` — herds as entities (species, count, position, behaviour) + up to N individual members materialised
  for rendering near herds (positions derived deterministically from herd state).
* `planet.buildings` — SoA or objects: type, material, style, pos, rot, progress, hp, settlement, occupants,
  inventory (stores), flags, books (written knowledge ids, for libraries).
* `planet.settlements`, `planet.polities`, `planet.disasters`, `planet.weather`, `planet.items` (dropped / thrown
  items on the ground), `planet.projectiles`.
* `universe.ships`, `universe.creatures`, `universe.gods` (0 = player, 1.. = rivals), `universe.chronicle`.

### 6.5 Planet generation (`world/planet.ts`, `world/scenarios.ts`)
`generatePlanet({ seed, n, radius, kind, ... })` fills rock height from noise (warped continents, ridged ranges,
craters for barren/airless worlds, volcanic provinces), ore deposits (copper, tin, iron, coal, gold, sulfur,
saltpeter, clay, flint, sand, oil, uranium…) by geology, aquifers, initial temperature from the star. Kinds:
`barren` (airless cratered rock, no water — the creation start), `terran`, `ocean`, `desert`, `ice`, `jungle`,
`volcanic`, `methane` (cold, methane seas), `moon`.

Scenarios (`src/data/scenarios.json` + code): **`barren`** (one airless world; the opening), **`twoworlds`** (two
inhabited worlds in one system: plains folk at stone age on a terran world, a hive on a warm desert world; an
optional fast-forward start), **`system`** (a living system: 4–6 worlds, several inhabited at different eras,
including one people within reach of rockets), **`sandbox`** (terran world, nothing alive), **`lookdev`**
(terran world with forests, a river, a town and a city at different eras, for screenshots).

### 6.6 Save format
`save()` → `Uint8Array`: magic `GNSS`, version u16, then a JSON header (content pack ids, tick, rng states,
object stores) and raw typed-array blobs (fields, SoA stores) with offsets. `load()` refuses unknown major
versions with a readable message and migrates minor versions. Round-trip must preserve `hash()`.

---

## 7. Fields (per cell; SIM owns semantics, RENDER reads via snapshots)

| field | unit | notes |
|---|---|---|
| rock | m | bedrock height above datum; quakes, craters, uplift, lava cooling edit it |
| soil, sand, ash, snow, ice | m | volumes; `surface` = rock + soil + sand + ash + snow + ice + lavaCrust |
| lava | m | molten depth; flows (viscous), cools into rock, ignites, glows |
| water | m | surface water depth (seas, lakes, rivers, floods). Pipes model on the cell graph with momentum (`flowX/Y/Z`) |
| aquifer | m | groundwater; springs, wells, plant draw |
| temperature | °C | from insolation (star, distance, latitude, tilt, season, hour), altitude lapse, greenhouse, albedo, ocean inertia, aerosols |
| humidity | 0..1 | air moisture; advected by wind; evaporation in, precipitation out |
| moisture | 0..1 | soil moisture |
| wetness | 0..1 | surface wetness for shading (rain, floods, mud) |
| precip / precipType | mm/h, enum | current precipitation and kind (0 none, 1 rain, 2 snow, 3 hail, 4 ash, 5 acid, 6 blood, 7 sand) |
| cloud | 0..1 | cloud cover (from humidity + weather systems + global override) |
| windX/Y/Z | m/s | prevailing + weather systems |
| fertility | 0..1 | derived: soil depth, moisture, ash bonus (after it weathers), salinity penalty |
| salinity | 0..1 | sea water, salt flats |
| grass, shrub, tree, crop | 0..1 | vegetation cover by functional type; `*Species` = dominant content index |
| fire, burnt | 0..1 | fire intensity; burnt scar (decays) |
| road | 0..1 | wear from traffic → path → road (tech decides surface) |
| biome | enum | emergent (§7.1); `pinnedBiome` holds painted pins |
| ore, oreType | 0..1, enum | richest deposit |
| territory | settlement id | for overlays and borders |
| pollution, blight, radiation | 0..1 | industry, plant disease, flares/fallout |

### 7.1 Biomes
Emerge from temperature, moisture, soil, salinity, altitude, water depth: `ocean`, `reef`, `coast`, `ice`, `tundra`,
`taiga`, `grassland`, `forest`, `rainforest`, `wetland`, `desert`, `dune`, `scrub`, `mountain`, `volcanic`,
`barren`, `savanna`, `steppe`. The player can paint a biome: vegetation/soil are set to match; unless **pinned**, the
cell drifts back toward what its climate supports.

### 7.2 Water, sand, lava, snow, ash as volumes
* **Water**: virtual-pipes shallow-water on the cell graph (flux per directed edge, momentum, damping). Sea level is a
  live target: ocean cells (connected to the deepest basin, recomputed periodically) relax toward it, adding or
  removing volume. A flood or tsunami is a volume impulse with momentum. Evaporation, rain, snowmelt, infiltration to
  aquifer, springs. Rivers carve (erosion moves soil/sand downstream), deposit deltas. Freezing makes ice.
* **Sand**: wind saltation moves sand downwind in dry cells → dunes; buries roads and fields.
* **Lava**: slow viscous flow, cools to rock (builds land), ignites vegetation/buildings, boils water to steam.
* **Snow/ice**: accumulate from snow precipitation, melt into water by temperature; glaciers from persistent ice.
* **Ash**: settles from plumes/ashfall, smothers vegetation, then weathers into fertility.

### 7.3 Weather and climate
Weather systems are entities: `{ kind, pos, vel, radius, intensity, life, pinned }`, kinds from
`src/data/weather.json` (clear, rain, storm, thunderstorm, snow, blizzard, hail, fog, sandstorm, ashfall, acid-rain,
blood-rain, hurricane, heatwave, cold-snap, aurora-storm, no-atmosphere…). They spawn from conditions (humid + warm
→ storms; cold + humid → snow; dry + windy + sand → sandstorms), move with prevailing winds, and decay. The player
can paint one onto a region, set one planet-wide (`globalWeather`), pin a season, or remove all. Lightning strikes
from storms are events that can start fires (and teach fire).

---

## 8. Peoples

### 8.1 Species (`src/data/species/*.json`)
Body plan (`biped`, `quadruped`, `hexapod-hive`, `aquatic`, `flyer`, `serpent`, `blob`…), size, speed, lifespan,
fertility, diet, temperature tolerance, breathes (`o2`, `methane`, `none`), habitat (land, coast, water, cold),
nocturnal, hive (castes, queen reproduction, shared hive memory), needs weights (+ species-specific needs), traits
means, colours, name phonology, building style preferences, taboos seed, sensitivity to gods (awe/fear bias).
Ship at least: **plains folk** (biped generalists), **coastal folk** (amphibious bipeds, fish and boats), **the hive**
(hexapod insectoids, castes, queen, shared memory), **cold-world people** (furred, heat-intolerant, ice builders),
**methane drifters** (alien: breathe methane, cold-world, buoyant flyers). Authoring more is a data change.

### 8.2 Needs
`food, water, warmth, rest, safety, belonging, status, curiosity, faith` (0..1 satisfaction, decays at species rates)
+ species-specific (`methane`, `wetness` for coastal folk, `hive` for the hive). Needs drive utility-based decisions.

### 8.3 Tasks (event-driven)
A task is `{ kind, target, waypoints, t0, t1, then }`. Movement is a waypoint path (A* on the cell graph with
costs: slope, water, roads, danger, territory; flow-field caches per settlement for common destinations) traversed at
`speed × terrain × road × weather × age` metres per tick (base walk 0.25 m/tick ≈ 2.5 m/s at 1x). Position between
waypoints is analytic, so the sim does work only when a segment or task ends. Task kinds (floor): idle, wander,
sleep, eat, drink, gather (forage, wood, stone, clay, sand, ore, fish, hunt), haul, store, craft (a recipe), build,
repair, farm (till, sow, tend, harvest), herd, cook, tend-fire, teach, learn, experiment, explore, trade, raid,
fight, flee, guard, pray, worship, preach, mourn, bury, court, raise-child, migrate, found, sail, launch, board.

### 8.4 Knowledge (§9 recipes are knowledge)
* Each agent knows a set of knowledge ids (bitset). A settlement's **library** = union of living members' knowledge +
  **written** knowledge stored in buildings (tablets, scrolls, books) if writing is known. Fire in a library burns
  books.
* Learning: **teaching** (masters teach apprentices; masters are better: skill ≥ 0.7), **observation** (watching a
  recipe performed nearby), **experiment** (curious agents combine what they have at a place: success chance from
  recipe `discover.base`, curiosity, skill, context triggers), **accident** (context triggers fire for nearby agents:
  lightning in a dune → glass, fire on clay → pottery, rotting grain → beer, meteor iron → iron working),
  **reverse-engineering** an artifact the player dropped (needs the recipe's prerequisites), **god teaching**
  (`idea.teach`) which can be **refused** (taboo, low faith, fear, conservatism).
* **Loss**: when the last living knower dies and it was never written, the knowledge is gone (chronicle: "The secret
  of bronze died with Hesh of Aru."). Cohorts carry knowledge as fractions (§8.7).

### 8.5 Settlements
Founded when a band settles (water + food + shelter site), named from the species' phonology (and a feature: "Aru by
the Falls"), with households, roles (gatherer, farmer, hunter, fisher, crafter by recipe, builder, teacher, priest,
leader, trader, soldier, sailor, scholar), a store (per-item stockpile), territory, a polity, a language id, a culture
(alignment, taboos, stories, sacred things, music mode), factions. They **split** (overpopulation, faction schism,
religious split, exile) into a new named settlement with a drifted language; they **fall** (starvation, plague, war,
disaster, abandonment) leaving ruins (rubble buildings) that others can resettle. Roads emerge from traffic wear;
ports from boat use.

### 8.6 Economy, war and peace
Stores, carry, local prices from scarcity, gifting, theft. Trade between settlements along roads/sea when surpluses
differ (traders, caravans, boats). Raids (steal stores), sieges (walls hold), battles (strength = fighters × weapon
tech × health × morale), conquest (polity change, culture blend), treaties (peace, trade pact, alliance), tribute.
Relations matrix between polities, driven by trade, raids, religion, language distance, and resource monopolies
(iron in one tribe and not the other is a casus belli).

### 8.7 Cohorts
Beyond `MAX_AGENTS` individuals per planet, settlements keep **cohort** members as aggregate counts per
(age band × role) with knowledge fractions, simulated statistically each settlement tick (births, deaths, food,
production, disease). The renderer shows cohort members as ambient crowds around buildings. A logged `focus` command
(the camera dwelling on a settlement, sent by the client at most every few seconds) promotes up to N cohort members
to individuals there (named, with sampled traits and knowledge) and demotes far ones; because `focus` is a command,
determinism holds given the log.

### 8.8 Belief, culture, stories
Per agent: love and fear toward each god (0 = player). Witnessing an act (radius by act size) adds love (help: heal,
food, rain in drought, saving) or fear (destruction, throwing, killing, disasters), scaled by the species' bias and
the agent's piety. Faith decays with neglect. Settlement **alignment** = love vs fear balance → culture: benevolent
cultures build warm, open, colourful; fearful ones build walls, dark stone, spikes, sacrifice. Worship at temples
generates **worship** for the god they believe in. Settlements remember notable events as **stories** that create
**taboos** (they refuse fire for generations after fire burned the village) and sacred things.

---

## 9. Content data (`src/data/*.json`, mod packs share the schema)

All content is data. `src/sim/content.ts` loads the base pack + mods, validates references, and builds indexed
registries (string id → index). Adding content is never a code change.

* **items.json** — `{ id, name, tags[], weight, food?, fuel?, value, material?, decay? }` (stone, flint, wood, stick,
  bark, fiber, hide, meat, fish, berries, grain, flour, bread, clay, pot, brick, charcoal, copper ore, tin ore,
  copper, bronze, iron ore, iron, steel, coal, coke, sand, glass, lens, salt, sulfur, saltpeter, gunpowder, paper,
  book, cloth, rope, sail, wheel, cart, tools by material, weapons, medicine, oil, kerosene, cement, concrete, wire,
  magnet, battery, radio, engine parts, rocket fuel, … ≥ 70).
* **recipes.json** — `{ id, name, inputs: [{item, qty}], tools: [tag], place: { needs?: 'fire'|'kiln'|'furnace'|
  'forge'|'workshop'|'field'|'water'|'shipyard'|'launchpad'|..., biome?, near? }, knowledge: [ids], outputs:
  [{ item?|building?|knowledge?, qty }], time (ticks), skill, discover: { base, triggers: [context ids], curiosity },
  teach: difficulty, era }`. **≥ 40 recipes (target 80+)** spanning stone → fire → cooking → clay → pottery → kiln →
  charcoal → copper → bronze → farming → bread → weaving → wheel → sail → arch → aqueduct → iron → steel → glass →
  lens → writing → paper → printing → mathematics → astronomy → medicine → gunpowder → steam → electricity → radio
  → rocketry → orbital rocket → generation ship. Ideas (writing, law, money, mathematics, medicine, religion,
  astronomy, navigation…) are recipes whose output is knowledge. Paths are not forced; a people can stall.
* **buildings.json** — `{ id, name, function: 'shelter'|'store'|'hearth'|'kiln'|'furnace'|'forge'|'workshop'|
  'temple'|'library'|'farm'|'pen'|'dock'|'shipyard'|'wall'|'tower'|'market'|'mill'|'aqueduct'|'observatory'|
  'factory'|'radio'|'launchpad'|..., footprint, capacity, materials: [material ids in preference order], recipe }`.
  Visuals pick the best material the builders actually had (§15.7).
* **materials.json** — thatch, hide, wood, wattle, mudbrick, stone, brick, timber, concrete, steel, glass, ice, chitin,
  resin… with colours/roughness hints for the generator.
* **plants.json**, **animals.json**, **diseases.json** — tolerances, growth, diets, behaviours, domesticable,
  transmission/mortality.
* **disasters.json** — compositions of effectors (§11.3) with defaults; **weather.json**; **powers.json** — every god
  power: `{ id, name, category, icon, gesture?, command, params schema, synonyms }` (the palette, radial and freeform
  parser are all generated from it); **lexicon.json** — synonyms and phrase patterns for the freeform parser;
  **names.json** — phonologies; **scenarios.json**; **creatures.json** (creature body templates); **events.json**
  (chronicle templates).

---

## 10. Ecology
Plants: growth/decline per cell from water, temperature, light (day length, aerosols, eclipse), soil, salinity;
spread to neighbours; species dominance by tolerance fit; fire burns, ash fertilises. Animals: herds/packs with
species data (herbivore, predator, scavenger, fish, bird, insect swarm), graze vegetation, hunt, flee, migrate with
seasons, reproduce with food, starve, get hunted by people, domesticated by recipes (pens, pasture). Over long time,
isolated herds drift traits and **speciate** (new species id + generated name, chronicle); species with no herds are
**extinct**. Invasive species arrive by ship or player. **Blight** spreads in crops/forests (moisture + monoculture);
plagues spread among animals and people (§9 diseases; medicine reduces mortality).

---

## 11. The god layer

### 11.1 Commands and powers
Everything the player does is a `Command` (`types.ts`). `src/sim/god/commands.ts` is a registry
`register(kind, handler, schema)`; `powers.json` maps each user-facing power to a command + default params + UI
metadata (category, icon, radial ring, gesture, synonyms). The palette, radial menu, gesture casting, and freeform
parser are generated from `powers.json` + the registry, so a new power is data + (if needed) one handler.

Floor of command kinds: terrain (`raise`, `lower`, `flatten`, `smooth`, `noise`, `crater`, `mountain-range`,
`dig-sea`, `river`, `paint-material`, `paint-biome`, `pin-biome`), water (`add`, `remove`, `rain`, `flood`, `drain`,
`sea-level`, `spring`, `tsunami`), weather (`paint`, `global`, `clear`, `pin-season`), time (`set-hour`,
`day-length`, `freeze-sun`, `year-length`, `axial-tilt`, `step`), climate/planet (`gravity`, `atmosphere` incl.
`add-air`/`remove-air`/composition, `star` type/brightness, `orbit` distance, `spin`, `magnetism`, `sea-level`,
`temperature-offset`), life (`plant` species, `forest`, `spawn-animal`, `spawn-people` species N, `cull`, `kill`,
`heal`, `bless`, `curse`, `breed`, `extinct`), agents (`move`, `possess`, `teach`, `silence` (make forget / mute),
`make-disciple`, `inspire`, `age`, `rename`), settlements (`found`, `raze`, `gift` items, `introduce` substance/
idea/artifact/law/animal/crop/disease, `withdraw`, `rename`, `split`, `merge`, `make-peace`, `start-war`), disasters
(`spawn` any kind with params, `cancel`, `scale`, `move`, `freeze`), fire (`ignite`, `extinguish`, `firestorm`),
hand (`grab`, `move`, `release`/throw, `place`, `slap`, `stroke`, `drop`), miracles (`water`, `food`, `heal`, `forest`,
`storm`, `fire`, `shield`, `lightning`, `wood`, `fertility`, `calm`, `teach`, `meteor`), creature (`adopt`, `leash`,
`unleash`, `reward`, `punish`, `teach-by-example`, `set-mode`), worlds (`birth`, `move`, `crack`, `erase`, `moon-add`,
`moon-fall`, `seed-species`), time control (`speed`, `rewind`, `edit-past`), meta (`restraint`, `rival-god-add`,
`rival-god-remove`, `focus`), and `set` (any registered parameter by path, §11.7), `freeform` (§11.6).

### 11.2 Introduction channels
Substance, phenomenon, artifact, idea, life, world, weather, disaster, law, edit-the-past. An introduced thing enters
the world as items/knowledge/entities/rules **and agents decide**: notice (proximity, curiosity), experiment, adopt,
teach, hoard (secret knowledge: "They hid it."), or **refuse** (taboo, fear, conservatism, faith). Gifts can be
refused (left to rot, thrown away, smashed). A miracle is also an introduction: a fireball can teach fire, a heal can
start medicine (herbalism discovery boost), a forest can start forestry.

### 11.3 Disasters (effectors)
A disaster is a live entity composed of effectors (data in `disasters.json`): `impact` (crater, ejecta, shockwave,
fire ring, dust → aerosols), `area` (field modifiers over time: drought, heat, cold, acid, radiation), `front`
(moving region: tornado track, sandstorm, locusts, ash cloud), `spread` (contagion over cells/agents: wildfire,
plague, blight, infestation), `quake` (ground shaking: building collapse by material, landslides, tsunami if
coastal), `water` (tsunami/flood volume impulse with momentum), `global` (planet parameter change over time: impact
winter, eclipse, gravity slip, magnetic storm, solar flare), `spawn` (entities: swarm, monsters, a falling moon).
Floor list: meteor, meteor shower, comet, swarm, volcano, supervolcano, quake, flood, drought, wildfire, firestorm,
plague, blight, tornado, hurricane, tsunami, solar flare, impact winter, gravity slip, magnetic storm, infestation,
year-long eclipse, second moon falling, sinkhole, rift, acid rain, ice age, heat wave, rogue planet flyby, dust bowl.
Each kills/injures/displaces people and animals, destroys buildings/crops, edits fields, and creates
consequences (refugees, famine, fear, rebuilding, new knowledge: meteor iron). Every live disaster can be
**cancelled, scaled, moved, or frozen** mid-flight.

### 11.4 The hand
A sim entity per player: position (follows the cursor ray hit), held entity, pose. Grab anything (agent, animal,
tree, rock, item, small building, creature with consent) → held; release with velocity → ballistic projectile on the
sphere under the planet's gravity → impact (damage, fear, awe at a distance, splash, crater for rocks). Place gently.
Slap (punish: hurts agents, punishes the creature), stroke (comfort: heals a little, rewards the creature). Dropping
food/wood into a settlement's store is a gift (can be refused). Gestures (§16.5) cast miracles from the hand.

### 11.5 Creature
`creatures.json` templates (ape, ox, great cat, tortoise, wolf… with procedural bodies). A creature has hunger,
energy, size (grows), alignment (-1..1) that **morphs its body** (good: rounder, brighter, glowing; cruel: gaunt,
spiky, dark, red-eyed), strength, intelligence, known miracles with skill. Brain: behaviour desires (eat X, help
village, attack, play, throw, cast miracle, sleep, impress, terrify, poop on fields) as weights updated by **reward
(stroke) / punishment (slap)** of the most recent behaviour, and by **observation** of the hand (casting near it
teaches it). **Leash** to a village or point with a mode (tend, defend, impress, terrify, explore). Optional, and
more than one may exist; peoples can raise their own (a settlement with animal husbandry + a sacred animal may
"raise" a creature).

### 11.6 Freeform "do this"
`god/freeform.ts`: deterministic rule-based parser (no network). Tokenise → match verb phrases and nouns against
`lexicon.json` + `powers.json` synonyms + live names (settlements, agents, species, planets, disasters) → build one or
more Commands with parameters (location: "on the north coast", "near Aru", "here" (= cursor), "everywhere"; size;
duration; intensity; quantity). Unknown nouns become **new content at runtime**: "introduce chocolate" creates an item
(tags guessed from word lists: food/drink/material/tool/weapon/drug…) and the idea to make it; "invent telepathy"
creates a knowledge id with an effect from the effect vocabulary (faster teaching, belief boost, trade boost…);
"rain frogs" creates a weather kind that spawns frogs (animals). Fallback: `set <param path> to <value>` for any
registered parameter. The parse result (resolved commands + explanation) is previewed before execution. **The
parser must always produce something actionable or a clear "here is what I can do with that" with nearest matches.**

### 11.7 Parameter registry
`god/params.ts` exposes every tunable sim number by path with range and unit: `planet.gravity`, `planet.dayHours`,
`planet.axialTilt`, `planet.yearDays`, `planet.seaLevel`, `planet.magnetism`, `planet.atmosphere.pressure`,
`planet.atmosphere.co2`, `star.luminosity`, `star.kind`, `orbit.distance`, `climate.offset`, `weather.global`,
`species.<id>.fertility`, `sim.maxAgents`, … `set` and the freeform parser use it; the settings/inspector UI can list
it ("Laws of this world").

### 11.8 Rival gods (optional)
`rival-god-add` creates an AI god (alignment, temperament, home settlement). It acts on a cadence with the same
command API (miracles for its believers, smites rivals, sends disciples). Belief competition, conversions, holy wars.
Never a win condition; sandbox only.

---

## 12. Worlds and space
Star (kind, luminosity, temperature, colour, activity) at the system origin. Planets on Kepler orbits (analytic
positions at any tick: no stepping), moons around planets. Birth (new planet of a kind at an orbit), move (change
orbit), crack (split: quake storms, rifts, a debris ring and new moonlets; inhabitants suffer), erase (gone; anyone
on it dies; chronicle). **Ships**: boats/sailships (sea travel on one planet: colonise islands, trade, plague),
airships, rockets (need the recipe chain: e.g. metallurgy + chemistry/fuel + precision machining + navigation math
+ launchpad building + materials in store), orbiters, generation ships, gates (if invented). A launch is built,
fuelled and crewed by agents; transit is a Lambert-free simple transfer (Bezier between departure and the target's
predicted position, a few game days); arrival founds a colony (with the knowledge the crew carries) or makes
**contact** with whoever lives there: trade, plague (diseases cross), war, merger, worship (a people may worship the
visitors), or silence. Cross-planet trade, disease and belief are required. Aliens differ in needs/body/breath, so
contact is asymmetric (a methane people cannot live on the terran world without suits).

---

## 13. Chronicle
`chronicle.ts` appends `ChronicleEntry` from sim events through templates (`events.json`): "Year 214. The kiln-clan of
Aru learned glass after lightning was set in the dune. They hid it." Kinds: discovery, loss, founding, split, fall,
war, treaty, disaster, extinction, speciation, plague, golden age, dark age, diaspora, first contact, first orbit,
first abandoned world, god acts and the people's reading of them. Golden/dark ages are detected from rolling
knowledge, population and prosperity. Export: Markdown/HTML/text (UI), plus photo mode stills.

---

## 14. Worker protocol and snapshots
`src/sim/worker.ts` hosts one `Sim`. The main thread (`src/client/simclient.ts`) sends `ToWorker` messages and
receives `FromWorker` (types in `types.ts`). The worker runs the sim loop itself (setTimeout/MessageChannel pacing,
target ticks per real second = 10 × speed, with a per-slice time budget so messages stay responsive), and posts a
snapshot when the client asks (`{type:'snapshot'}` after each rendered frame, at most 30 Hz). Field arrays are sent
only when their version changed and at most every ~100 ms (fast fields: water, fire, lava, cloud, precip, snow) /
~500 ms (slow fields); arrays are copies posted as transferables. Mover blocks (agents, animals) are SoA typed
arrays sent every snapshot. The client keeps a `WorldView` mirror and **interpolates**: render tick =
snapshot tick + elapsed real time × ticks/s (clamped), movers extrapolated by `vel`, planet spin and orbits computed
from params at the render tick.

---

## 15. Rendering

### 15.1 Frames and precision
System frame in metres (double precision in JS), star at the origin. **Floating origin**: every frame, every
object's three.js position = its system position − camera system position (so the GPU sees small numbers). A planet is
a `Group` at (center − camera) with quaternion = orbit-plane tilt × axial tilt × spin; terrain chunks, water, trees,
buildings, crowds are children in the **body frame** (unit vectors × (radius + height)). `logarithmicDepthBuffer` on;
custom shaders include the logdepth chunks. Near 0.05 m, far 2·10⁷ m.

### 15.2 Passes
Scene (opaque PBR: terrain, buildings, vegetation, crowds, creature, hand, ships) → **HDR** half-float target (MSAA by
quality) with depth → transparent/water (refraction from a copy of the opaque colour, depth-based absorption, foam,
caustics on terrain under water) → **atmosphere + clouds** full-screen pass (ray-marched single scattering, Rayleigh
+ Mie + ozone tint, per planet; aerial perspective on scene geometry using reconstructed linear depth from the log
depth buffer; volumetric cloud shell with 3D noise and coverage from the sim `cloud` field; lit by the star, with
powder/Beer; half/quarter resolution + upsample by quality) → god rays (radial blur of sky/sun occlusion) → bloom
(mip-chain) → tone map (AgX) + grade + vignette + subtle grain → FXAA/SMAA → UI. Photo mode adds DOF and filters.

### 15.3 Space
Star: emissive limb-darkened sphere with animated granulation + corona shader + bloom + lens flare ghosts; colour from
temperature; activity drives flares. Starfield: procedural (thousands of stars with colour/magnitude + a Milky Way band
+ faint nebulae) on a far sphere. Orbits: thin anti-aliased lines in system view. Moons and other planets visible
from the surface, with phases. Auroras near magnetic poles when `magnetism` > 0 and star activity/storms.

### 15.4 Planet terrain
Chunked LOD over the 20 faces (each face split into triangular patches; each patch has LOD levels; selection by
screen-space error with hysteresis; **geomorphing** between levels so nothing pops; skirts against cracks). Static
geometry per LOD: attributes `(cellA, cellB, cellC)`, `(wB, wC)`, `dir` (unit vector), `detail` (baked
`detailNoise`). Field textures (`render/planet/fieldtex.ts`): RGBA32F data textures, 256 cells per row, packing
sim fields (surface, water, snow, sand; soil, ash, lava, wetness; grass, shrub, tree, crop; temperature, moisture,
road, fire; burnt, biome, light, normal…), updated from snapshots. Per-cell normals computed on the CPU from neighbour
heights when `surface` changes. Material: `MeshStandardMaterial` + `onBeforeCompile` (keeps three's lights,
shadows/CSM, fog) with **layered procedural materials** (triplanar; rock strata, soil, grass by moisture/temperature/
season, sand ripples, snow with sparkle, ash, mud, lava crust with emissive glowing cracks, burnt ground), slope/height
blending, wetness darkening + gloss, roads and paths, farm field patterns where `crop` > 0, forest canopy tint and
bumps where trees are too far to instance, night-side city lights from the `light` channel, caustics under water.

### 15.5 Water
Same chunk system for the water surface (water depth > ε): Gerstner waves scaled by depth and wind, detailed normal
maps (procedural, flow-mapped along `flow` for rivers), Fresnel sky reflection (from the atmosphere model / env),
sun glints, refraction with depth-based absorption and scattering colour, shore foam from depth, wave-crest foam,
waterfalls/rapids foam where flow is fast, ice where frozen. Tsunamis/floods are the field moving: no sprites.

### 15.6 Life
* **Vegetation**: client-side deterministic scatter from fields (`tree`, `shrub`, `grass`, `crop` + species) within
  view range; procedural species meshes from `gen/treegen.ts` (broadleaf, conifer, birch, palm, cactus, baobab,
  mangrove, dead/burnt, crops by type, shrubs, reeds, kelp) with 3 LODs + far impostors (or canopy tint), wind sway,
  leaf translucency (SSS approximation), seasonal colour, snow on branches, burnt variants, fade in/out (no popping).
  Near-camera grass blades (GPU instanced) by quality.
* **Crowds**: species bodies from `gen/bodygen.ts` (biped/quadruped/hexapod/aquatic/flyer…) with clothing/fur/caste
  colours and held tools; **GPU vertex animation** (bone-like segments driven per instance by `anim` + `phase`, with
  blends between states), 3 LODs; thousands at 60 fps via `InstancedMesh`. Near the camera: faces, hair, clothing
  detail; far: simplified silhouettes. Cohort crowds as ambient instances.
* **Animals, creature, hand**: same approach (`gen/creaturegen.ts`, `gen/handgen.ts`); the creature's morph params
  drive the mesh (alignment); the hand has articulated fingers (poses: open, grab, point, slap, stroke, cast) and a
  skin shader with SSS, tinted warm/cold by alignment.
* **Buildings**: `gen/buildinggen.ts` builds meshes per (type, material, style, era) from a kit (walls with real
  thickness and openings, pitched/thatched/tiled/flat roofs, chimneys, porches, temple forms: henge, ziggurat,
  pagoda, cathedral, dome; kilns/furnaces/forges with emissive mouths and smoke, docks, walls, towers, lighthouses,
  observatories, factories with stacks, radio masts, launchpads with gantries). Construction shows scaffolding and
  rising courses; damage shows rubble; fire shows flames + smoke + light. Windows glow at night by light tech
  (hearth flicker → oil lamps → electric). Instanced per variant.
* **Roads**: from the `road` field: terrain material blend (trail → dirt → cobble → paved by tech) and ribbon meshes
  along the most-worn edges near the camera.

### 15.7 VFX
GPU particles (`fx/particles.ts`): stateless (positions from spawn time + seed in the vertex shader), soft particles
(depth fade), lit by the sun, emissive where hot. Fire, smoke, embers, sparks, steam, rain streaks, snow, hail, sand,
ash, acid, blood rain, dust, debris (instanced rock meshes, ballistic), meteor (entry plasma trail + light),
shockwave rings, volcanic plumes + lightning, lava fountains, tornado (twisting funnel + debris), tsunami spray,
lightning bolts (branching, with flash light), aurora curtains, rocket exhaust (Mach diamonds, plume, smoke column,
light), rifts (glowing cracks), plague miasma, locust swarms (instanced flock), solar flare (sky tint, aurora surge),
gravity slip (things lift), eclipse (corona, darkening). Point lights from fires, lava, explosions, windows, rockets
contribute (budgeted: nearest N dynamic lights + emissive). Nothing pops: fades on every spawn/despawn.

### 15.8 Cameras
`camera/rig.ts` blends modes smoothly: **orbit** (around a planet; zoom continuously from system scale to 2 m above
the ground, with the camera up vector easing from system-up to local-up as altitude drops), **system** (whole system,
click a planet to fly in), **free-fly** (6DoF, speed scales with altitude), **follow** (agent/creature/ship/disaster),
**dolly** (cinematic arc around a settlement), **walk** (the player's body on the surface, third/first person; the
people can see it and react by belief), **photo** (free camera, UI hidden, DOF/exposure/filters/frame, capture PNG).
Gameplay readability: selection outlines, hover highlights, brush preview decal on the terrain.

### 15.9 Quality
`render/quality.ts`: Low / Medium / High / Ultra / Cinematic: render scale, MSAA, shadow cascades + map size, cloud
steps + resolution, atmosphere steps, vegetation density and range, grass, particle budgets, light budget, SSAO,
god rays, DOF. **Quality never removes a power and never changes the sim.** Target: 60 fps at 1440p on a high-end PC
at High. Auto-detect a starting preset from a quick GPU probe.

---

## 16. UI (DOM over the canvas; `src/ui/**`)
Look: dark glass panels, fine gold/ivory accents, a serif display face for titles and a clean sans for UI; minimal
chrome; everything readable at 1080p–4K; no right-edge control card.

1. **HUD**: top-left world name + calendar (Year, season, day, hour) + time controls (pause, 1x/10x/100x/1000x,
   step, achieved speed); top-right worlds strip (planets, click to fly) + worship/belief; bottom-centre the current
   tool + brush size/strength; small toasts bottom-left; chronicle ticker.
2. **Command palette** (`/` or Ctrl+K or gamepad Y): fuzzy search over every power, parameter and entity; enter to
   arm the tool or run it.
3. **Radial menu** (hold Q / right stick click / long-press): categories (Shape, Water, Sky, Life, Peoples, Ideas,
   Fire, Disasters, Hand, Creature, Worlds, Time) → powers.
4. **Freeform "do this"** (Enter or `;`): text field with live parse preview ("→ rain · intensity 0.8 · north coast
   of Aru · 2 days") from `sim.parse`, Enter to execute, history (↑/↓), examples.
5. **Gestures**: draw with the hand (hold G or middle mouse) — a $1-style unistroke recogniser maps shapes to
   miracles from `powers.json` (`gesture` field): spiral = water, zigzag = lightning/storm, circle = shield,
   triangle = fire, V = heal, wave = forest, square = food, star = meteor.
6. **Inspector** (click anything): agent biography (name, age, family, role, needs, knowledge, memories, faith,
   mood), settlement (population, era, library, stores, buildings, belief, alignment, relations, stories, language),
   cell (fields, biome), species, disaster (with cancel/scale/move/freeze controls), weather, ship, planet (laws of
   the world: the parameter registry).
7. **Chronicle** (C): full history with filters (planet, kind, weight), search, export (Markdown/HTML/TXT).
8. **Overlays** (O): temperature, moisture, biome, belief, territory, knowledge (era), ore, population, trade
   routes, pollution.
9. **Settings**: quality presets + individual toggles, key rebinding (all actions), gamepad, audio volumes,
   restraint mode, autosave, UI scale, colour-blind palettes.
10. **Saves**: slots (IndexedDB), export/import file, seed display, new world (scenario picker with seed).
11. **Opening** (§17.1).

Input: mouse + keyboard (rebindable, stored in localStorage), gamepad (standard mapping; virtual cursor), touch is out
of scope. Every UI action is a Command or a camera action, so the test surface can drive it.

### 16.1 Opening (first 3 minutes, `ui/opening.ts` + scenario `barren`)
1. Black. A star ignites (bloom swell, lens flare, low roar).
2. One airless world turns into view: grey cratered rock, hard shadows, no sky. A whisper: *"It is quiet. Breathe on
   it?"* (`add-air`), or wait — after ~20 s it suggests a gesture, never forces.
3. Air: the limb turns blue, the sky fills in. *"Water?"* — rain falls from new clouds; seas find the low places
   (the real hydrology).
4. *"Soil, and a seed."* — green spreads only where water and warmth allow.
5. *"Someone to see it?"* — drop a people from the hand (or later).
6. First night: if they have fire (lightning, a gift, or discovery), hearths glow; otherwise they huddle cold in the
   dark, and the whisper notes it.
Full powers are available from the first frame; the opening teaches by suggestion and adapts to what the player
does first. Skippable (Esc → scenario menu: Barren world, Two worlds, Living system, Sandbox, Load).

---

## 17. Audio (`src/audio/**`, WebAudio, synthesized; no silence)
Layered ambience per biome/time/weather at the camera (wind by altitude, surf near coasts, birds by day, insects at
night, rain/thunder by local weather, fire crackle, lava rumble, crowd murmur near settlements, space hum in orbit).
**Emergent culture music**: each culture gets a scale/mode, tempo and instrument set from its era and alignment
(drums/flutes → lyres/strings → brass/organ → synth) and plays near its settlements; orbit gets an ambient score.
Spatial audio (PannerNode/HRTF) for fires, crowds, storms, impacts, launches. SFX for hand (grab, whoosh, slap, stroke),
miracles, disasters, discoveries (a chime), births, deaths (distant toll). Master/music/sfx/ambience volumes.

---

## 18. Test surface (`window.__GENESIS__`, `src/testsurface.ts`)
```
ready: Promise<void>
state(): { tick, speed, achievedSpeed, fps, scenario, seed, camera, planets: [{ id, name, pop, settlements, agents, buildings, era }], ... }
cmd(c: Command): Promise<CommandResult>
freeform(text): Promise<CommandResult>
parse(text): Promise<CommandResult>
setSpeed(x), step(ticks): Promise<number>
camera(spec): void      // { mode: 'orbit'|'surface'|'system'|'follow'|'dolly'|'walk'|'photo', planet, lat, lon, alt, yaw, pitch, dist, target }
quality(name), ui(visible: boolean)
shot(name): Promise<string>   // canvas -> POST /__shot/<name>
```
URL params: `?scenario=barren|twoworlds|system|sandbox|lookdev`, `?seed=`, `?intro=0`, `?quality=`, `?speed=`,
`?dev=1` (perf HUD), `?cam=` presets. `_harness/shots.mjs` (Playwright, headless Chromium + SwiftShader): starts
`vite` (or uses a running one), loads a list of shot specs, saves PNGs to `_shots/` and a JSON report (console
errors, fps). Shots run at 1280×720 by default.

---

## 19. Tests (`npm test` = `node --test "tests/*.test.ts"`; all must pass)
Required (each its own file): `grid.test.ts` (done), `determinism.test.ts` (same seed → same `hash()` after 1 000
ticks; chunked stepping (1×1000 vs 10×100 vs 1000×1) identical; save/load round trip preserves hash and continues
identically), `water.test.ts` (water flows downhill and pools; sea-level slider; volume conserved without
sources/sinks), `fire.test.ts` (spreads in dry fuel, faster downwind, stopped by water/rain, cooks/hardens clay
in a kiln context), `discovery.test.ts` (a band with clay + fire near discovers pottery without player teaching within
N days; observation and teaching spread it), `knowledge-loss.test.ts` (sole knower dies unwritten → lost; written in a
library → kept; library burns → lost), `meteor.test.ts` (player-spawned meteor on a city kills, destroys buildings;
after N days survivors rebuild with the knowledge that remains), `ships.test.ts` (two inhabited worlds: the recipe
chain is required (no chain → no launch), with it a ship launches, transits and arrives; cross-planet disease/
trade/belief happens), `content.test.ts` (≥ 40 recipes, all references resolve, every power has a handler, mod pack
loads), `freeform.test.ts` (phrases → commands, unknown nouns create content, never throws), `emergence.test.ts`
(dead rock + air + water + plants + people + fire, run fast → a settlement knows something nobody taught it),
`disasters.test.ts` (every disaster kind spawns, affects the sim, and can be cancelled/scaled/moved/frozen).
`_harness/detban.ts` scans `src/sim/**` for banned APIs.

---

## 20. Coding rules
* TypeScript strict; Node type-stripping compatible: **no `enum`, no `namespace`, no constructor parameter
  properties**, `import type` for types, explicit `.ts` extensions in relative imports, JSON imports with
  `with { type: 'json' }`.
* Comments explain *why*; files start with a short header saying what they own.
* No placeholder art on the final camera path: no capsules, no plain spheres for trees, no cubes for houses.
* Errors never blank the screen: the app shows a fatal card with the error.
* Performance: no per-frame allocations in hot loops; typed arrays; instancing; reuse geometries/materials.

## 21. Done when (acceptance)
1. From the barren start: add air, water, plants, people, fire; leave at 100x; return to a settlement that invented
   something the player did not place (chronicle shows it).
2. Live: call a disaster, rewrite the weather, scrub the sun, and do a fourth thing not in any menu at boot via the
   freeform field.
3. Two inhabited worlds reach a ship crossing (scenario `twoworlds`/`system` + tests).
4. A meteor ruins a city; survivors rebuild with whatever knowledge remains.
5. Screenshots read as a game trailer still, not the reference video.
6. `npm run check` passes. README and CONTROLS exist. No placeholder capsules on the final camera path.
