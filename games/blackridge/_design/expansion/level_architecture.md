# BLACKRIDGE EXPANSION — Level Architecture: ONE map → MANY

Status: **PROPOSAL** (design deliverable, not yet binding). Authority order unchanged:
`pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` > `_design/architecture.md`
> this document. Nothing here amends a frozen contract; where a change to a frozen
signature is unavoidable it is called out explicitly as a **freeze-amendment request**
(A0 approves, per architecture.md changelog protocol).

Scope: the engineering refactor that takes the level system from one hardcoded map
(Meridian Ward) to N maps across N biomes, so that the campaign can span outdoor /
forest / office / industrial locales and PVP arenas can be carved out of them — the
owner's directive. This document does **not** design any specific new map; it defines
the format a new map is authored against, the kit that keeps N maps from costing N ×
the assets, the migration order, and how the verification loop scales to N maps.

Every on-disk claim below was read this session and is quoted with file:line.

---

## PART 1 — HONEST ASSESSMENT: what is actually there

### 1.1 Verdict up front

`layout.js` is **imperative construction that emits a data table**. It is not a data
table, and it is not a map format — it is *one map, written in JavaScript*, with three
builder functions (`makeBuildings`, `makeWalls`, `makeProps`) whose bodies are 460 lines
of literal metre coordinates, plus five module-level `const` tables (`NODES`,
`REF_SPAWNS`, `WALK_RECTS`, `ZONES`, `LIGHT_POLES`, `ROADS`, `TERRAIN`) that are
Meridian-specific by construction.

```js
// core/level/layout.js:758
export function buildLayout(seed = 1) {
  const buildings = makeBuildings();
  const walls = makeWalls();
  const props = makeProps();
  return { buildings, walls, props, roads: ROADS, terrain: TERRAIN, zones: ZONES,
           lightPoles: LIGHT_POLES, nodes: NODES, refSpawns: REF_SPAWNS,
           walkRects: WALK_RECTS, bounds: BOUNDS, seed };
}
```

**Nothing anywhere parameterises by map id.** The only parameter in the whole level
stack is `seed`, and the file's own header says it does nothing:

```js
// core/level/layout.js:12-14
// the `seed` parameter is accepted per the frozen signature and reserved for
// wave-2 cosmetic scatter (trash bags, paper decals); wave-1 placement uses
// no RNG so layout, colliders and nav are bit-identical for every seed.
```

`tools/probe_props.mjs:53-56` actively *asserts* that seed does nothing
("determinism: seed 999 differs from seed 1 (wave-1 layout must be seed-invariant)").
So the one existing parameter is contractually inert. There is no second axis.

**The good news:** the shape of the emitted data is already very close to what a map
format needs, and the derivation chain below it is genuinely map-agnostic. The refactor
is mostly *extraction and re-plumbing*, not redesign. Concretely:

| Layer | Map-agnostic today? | Evidence |
|---|---|---|
| `colliders.js` (80 lines) | **YES — fully generic** | It is a pure fold over `buildLayout()`'s output; zero literal coordinates. `colliders.js:28-80` |
| `computePlacements(layout)` | **YES — fully generic** | Analytic ground-raycast + sink + decal-kind derivation, driven entirely off `layout.props` + `layout.terrain`. `layout.js:700-755` |
| `nav.bakeNav(colliders)` | **Mostly** — bounds/cells derived, but zone-cost table hardcoded | `nav.js:44-50` derives grid from `colliders.bounds`; `nav.js:33-34` hardcodes Meridian POI ids |
| `props.buildKind()` | **YES — kit-shaped already** | 28 parametric `case` branches taking `(kind, size, M)`; nothing knows about Meridian. `props.js:238-511` |
| `materials.augment()` shader layer | **YES** — biome-independent | `materials.js:411-502`; the program cache key is value-free |
| `level.js` | **NO — heavily hardcoded** | see §1.2 |

### 1.2 `level.js` is where the map really lives

This is the single most important finding. The architecture contract says layout.js is
the single source *both* colliders and visuals read, so "visuals and collision cannot
drift" (architecture.md §3.12). That is true for the **masses** and false for the
**dressing** — and the dressing is exactly what makes a biome look like a biome.

`level.js` is 955 lines. Only **14 lines** reference `layout.` at all. It contains
**62** literal-coordinate geometry constructions. The map-specific content it owns
outright, with no representation in layout.js:

| Block | level.js lines | What is hardcoded |
|---|---|---|
| Puddle field | 129-143 | 30 puddle circles; only 3 come from `layout.terrain.heroPuddles` |
| Wet rects | 144-148 | quay sheet + both boulevard gutters |
| Canal water | 219-237 | a 340 × 110 m plane at `z 54+55`, `y −0.55` |
| Skylight rim + shards | 303-325 | arcade lightwell hole `x[−35,−29] z[−11,−5]` |
| Boulevard furniture | 444-465 | tram rails at `x 35.05/36.65`, 4 gantries at `z −30/−10/10/30`, deck strip |
| Catenaries | 488-518 | plaza `lampX = [−22,−17,1,5,9,13]`, 6 alley spans, quay crane run, 2 tram wires |
| Practical intensities | 562-571 | `specById` keyed by the 8 Meridian light ids |
| Skylight glow | 601-612 | `rg.translate(-32, 8.13, -8)` |
| Gatehouse window | 625-637 | `wg.translate(11.03, 1.7, -52.5)` |
| Painted signs | 772-790 | 6 signs at absolute positions |
| Arcade shop signs | 794-813 | 6 signs at `x = −37.5 + (i%3)*4.2`, `z = −15.5 \| 1.2` |
| Decal scatter | 857-914 | 8 oil-stain xz, plaza/blvd paper ranges, 12 crack xz, 4 door jambs, perimeter drips at `z −57.94` |
| Rain occlusion | 941-946 | 4 interior AABBs |

A second map does not "just work" with a new layout.js — it renders with Meridian's
catenaries strung across it, Meridian's canal behind it, and Meridian's oil stains on
its floor.

### 1.3 The single-source invariant is ALREADY partially broken

Two verified violations, both of which the refactor must close rather than inherit:

**(a) Street lamp masts have no colliders.** `LIGHT_POLES` (layout.js:631-655) carries
positions but no geometry; the mast is built visual-only inside level.js:

```js
// core/level/level.js:547-557
function sodiumPole(lp) {
  const [x, y, z] = lp.pos;
  poleGeos.push(boxGeo([x - 0.09, 0, z - 0.09], [x + 0.09, y, z + 0.09]));
  ...
```

The authored prop-kind set in layout.js is `ac_unit barrier bench bin breaker_box car
ceiling_fan chairs crate dumpster fence flood_tower fuel_drums guard_hut kiosk
mop_bucket newsbox pallet phone_booth planter rope route_board sandbags scaffold
shelving stall steam_vent table ticket_machine tram_shelter transformer_pole truck van`
— no lamp/pole kind. So every sodium and neon mast on the map is walk-through geometry,
and every bullet passes through it. Same class: the boulevard gantry posts
(level.js:456-458) and the neon cabinets that stand up to 0.4 m proud of the gallery
wall (level.js:716-726).

**(b) Rain-occlusion volumes exist in two files and already disagree.**

```js
// core/level/level.js:941-946                     // core/render/weather.js:132-138
{ id:"arcade",  max:[-25, 8.2, 6] }                { max: [-25, 8.6,  6] }
{ id:"gallery", max:[24.5, 5.0, 14] }              { max: [24.5, 7.0, 14] }
{ id:"gatehouse", max:[11, 3.2, -50] }             { max: [11, 4.0, -50] }
{ id:"platform_canopy", max:[44, 7.3, -48] }       { max: [44, 8.2, -48] }
```

Four volumes, four different ceiling heights. This is a copy-paste fork that drifted
with one map. With eight maps it is eight forks.

### 1.4 What breaks the moment a second map exists

Ranked by how hard it bites.

1. **Module-level singletons that ignore their arguments.**
   - `materials.js:31` `let CACHE = null;` → `:521` `if (CACHE) return CACHE;`.
     `makeMaterials(ctx)` returns the *first* map's material set forever. A second biome
     silently renders in the first biome's materials.
   - `props.js:24` `let LIB = null;` → `:189` `if (LIB) return LIB;`. Same failure for
     the GLB prop library (7 kinds: `car van truck dumpster crate planter ac_unit`,
     props.js:127-130).
   - Both are correct today (one map, one session) and both are wrong the instant a map
     switch happens without a page reload — which PVP map rotation requires.

2. **Frozen node keys are a global literal, in three places.** R24's 15 keys are
   declared in `layout.js:544-560 NODES`, re-exported by `colliders.js:73`, asserted as a
   literal array in `tools/probe_props.mjs:28-32 R24_KEYS`, and referenced by
   `content.json` objectives/scenarios (`_contract.nodes`, content.json:4). Node keys are
   inherently *per-map* vocabulary; they are currently *global* vocabulary. Map 2's
   `office_lobby` node fails the probe's literal check.

3. **content.json assumes exactly one mission and one map.** `mission` is an object, not
   an array (content.json:12); `scenarios` is a top-level map-agnostic id space
   (`S1`…`S9`, `C1`, `menu`, `bench`) whose poses are Meridian coordinates
   (content.json:336-464); `pois`, `signage`, `reverbZones`, `pickups` are all
   single-map. There is no `mapId` field anywhere in the file.

4. **boot.js hardwires the one map into the boot path.**
   ```js
   // runtime/boot.js:158-163
   const layout = buildLayout(seedParam);
   const colliders = buildColliders(seedParam);
   const nav = bakeNav(colliders);
   const levelOut = await buildLevel({ THREE, renderer, scene, layout, settings: S });
   ```
   Plus `fetch('./content.json')` at a fixed path (boot.js:136) and an inline fallback
   whose mission id is literally `"meridian_ward"` (boot.js:141). There is no teardown
   path: `buildLevel` adds to `scene` and nothing ever removes or disposes it.

5. **Five render/AI consumers each hold a private copy of map truth.**
   | File | Private Meridian data |
   |---|---|
   | `core/ai/nav.js:33-34` | `ZONE_BASE` keyed by `poi_dock…poi_customs`; `DEFAULT_AMBIENT 0.35` fallback |
   | `core/render/weather.js:132-155` | `OCCL` ×4, `DRIPS` ×6 (arcade skylight, gallery leaks, awnings) |
   | `core/render/reflect.js:32-35` | `PLAZA_CENTER (−5,0,2)`, `PLAZA_BOX`, `NEAR_GATE 55` |
   | `core/render/prewarm.js:22-24` | anchor poses "dock_spawn ≈ (−38,1.7,50)", "plaza_center ≈ (−5,1.6,2)" |
   | `core/render/sky.js:34,256-266` | `RINGS` radii + landmark list: 2 cranes + freighter + TV tower |
   Each is a correct optimisation for one map and a hardcode for N.

6. **Scenario poses are absolute world coordinates with no map dimension.**
   `content.json` scenarios carry `camera.pos`, `lookAt`, `player.pos`, per-bot `pos`
   (e.g. S2 `camera.pos [37, 1.62, 18]`). `_harness/shots.js SCENARIOS` holds seeds and
   drive descriptors keyed by the same flat ids. `shotbattery.py` writes
   `_shots/iterNN/<sid>.png` — no map namespace, so map 2's S1 would overwrite map 1's S1
   in the same iteration dir, and the never-overwrite guard (`exit 3`, shotbattery.py:363)
   would fire on the second map instead of protecting history.

7. **The fixed light pool is a per-SESSION shader key, not a per-map budget.**
   `lighting.js:33-34` `SPOT_COUNT = 8; POINT_COUNT = 4;` and `:577-579` truncates any
   spec list longer than 8 with a console warning. Doctrine §3 is explicit that visible
   light count is a permutation key. So the pool cannot be resized per biome — see
   §2.5 for how a pool works across biomes with wildly different practical counts.

8. **Nav bake budget assumes a 120 × 120 m map.** `nav.js:29` `GRID_MAX = 160` with
   `cell = max(cellOpt, W/160, H/160)` (nav.js:47). Meridian at 120 m gives a 1.0 m cell.
   A 240 m outdoor map silently degrades to a 1.5 m cell — which is coarser than the
   0.5 m slit the code already documents having to thread (nav.js:204). Multi-floor maps
   (office) will hit the `MAX_FLOOR_ABOVE = 6` and floor-model assumptions harder.

9. **Reverb zones and audio are map-shaped data living in content.json.**
   `reverbZones.volumes` (content.json:328-333) are Meridian AABBs; `ambience.js:96`
   positions a tram-wire hum at "the boulevard centre-line". A forest map needs a
   different zone *vocabulary*, not just different volumes.

10. **Texture/VRAM budget is per-session, and nothing disposes.** Part 5's gate is
    ≤120 textures / ≤200 MB. `materials.js:526-568` builds 10 canvas textures + 6 file
    sets × 3 maps each. Two biomes resident = double. There is no `dispose()` anywhere in
    the level stack. Program count survives a map switch (good — no recompile); texture
    count does not.

---

## PART 2 — THE TARGET SHAPE: a map format

### 2.1 Principles

1. **One file per map, THREE-free, no side effects.** `core/level/maps/<mapId>.js`
   exports `buildMap(seed) → MapData`. It may import *authoring helpers* (the `box`,
   `prop`, `steps` functions that exist today at layout.js:26-77) from
   `core/level/kit/authoring.js`, and nothing else. It must be `node`-runnable — that is
   what lets `probe_props.mjs` and the contract gate run without a browser.
2. **The map file owns everything spatial and everything that dresses space.** If a
   coordinate appears in a render module today (§1.4 item 5), it moves here.
3. **Both consumers read the same fields.** `colliders.js` and `level.js` already do
   this for masses; the format extends the discipline to dressing by giving every
   dressed element that occupies space a `solid` flag and an AABB, exactly like props do
   now (layout.js:54-77). *A visual element with no collider must be a deliberate,
   flagged choice, not an accident of which file it was written in.*
4. **Derived data stays derived.** `computePlacements`, `buildColliders`, `bakeNav`
   remain pure folds; the map never hand-authors a Y coordinate for a ground prop
   (LD §4.1 rule 1) or a collider box for a prop.
5. **Biome is a reference, not a copy.** The map names a biome id; the biome supplies
   materials, palettes, prop-kind → mesh bindings, and dressing vocabularies.

### 2.2 Schema

```js
// core/level/maps/<mapId>.js
import { box, prop, steps, catenary, sign, decalPatch } from "../kit/authoring.js";

export const META = {
  id: "meridian_ward",            // unique; the registry key
  name: "Meridian Ward",
  biome: "wet_city_night",        // → core/level/biomes/wet_city_night.js
  bounds: { min: [-60, -2, -60], max: [60, 14, 60] },
  coord: "+X east, +Z south, Y up",   // documentation only; all maps share it
  campaignRole: "mission",        // 'mission' | 'arena' | 'both'
  navHint: { cell: 1.0, floors: ["ground", 4.2, 4.5] },
};

export function buildMap(seed = 1) { return { META, arch, ground, props,
  dressing, lights, atmosphere, nav, nodes, spawnPoints, reflect, prewarm }; }
```

Field by field. **Bold** = new relative to today's `layout` shape; everything else is
today's field, unchanged or renamed.

#### `arch` — masses (was `buildings` + `walls`)
```js
arch: {
  buildings: [{ id, kind:'building'|'shell', footprint:{min:[2],max:[2]},
                floors, height, box:{min:[3],max:[3]}|null, surface, matClass,
                **facade**: { windowGrid:'grid_2_7'|'strip'|'none', trim:'parapet'|'cornice'|'none',
                              roofClutter:'city'|'industrial'|'none' } }],
  walls:     [{ id, kind:'wall'|'roof'|'slab'|'deck'|'step'|'rail'|'gate'|'post',
                min:[3], max:[3], surface, matClass, **piece**: 'plain'|'corrugated_gate'|'coping_rail'|'balustrade' }],
}
```
`facade` and `piece` are the seam that lets `level.js` stop branching on Meridian ids.
Today level.js:274 branches on `w.kind === "gate"` and level.js:263 on
`w.id === "canal_edge"` — an **id** check, which is unportable by construction. `piece`
replaces both with a kit-piece name the biome can bind differently.

#### `ground`
```js
ground: {
  paints:  [{ id, kind:'asphalt'|'cobble'|'concrete_yard'|'forest_floor'|'office_carpet'|…,
              min:[2], max:[2] }],           // was ROADS; `kind` resolves through the BIOME
  terrain: { base:0, **planes**: [{ id, kind:'water'|'grass'|'sand', y, min:[2], max:[2],
                                    **extend**: 120 }] },   // was TERRAIN.canal + the hardcoded
                                                            // canal plane at level.js:219-237
  **wet**: { puddles:[{ pos:[2], r, hero:bool }],           // hero ⇒ planar-reflection member
             rects:[{ min:[2], max:[2], g:0..1 }] },        // was level.js PUDDLES/WET_RECTS
}
```
`hero: true` replaces `layout.terrain.heroPuddles` AND drives `reflect.js`'s zone
(§2.7) — one declaration, two consumers, no `PLAZA_BOX` constant.

#### `props` — unchanged shape, extended vocabulary
Today's `prop()` output (layout.js:73-77) already carries everything needed:
`{id, kind, pos, rot, size, surface, matClass, solid, aabb, cover, flags}`. Two additions:
```js
  **mast**: { h, headOffset:[2] } | null,   // lamp/gantry masts BECOME props (closes §1.3a)
  **variant**: 'a'|'b'|null,                // biome dressing-set selector
```
`kind` is now a **kit vocabulary**, not a free string — validated against the union of
`kit/props.js` `buildKind` cases and the biome's `glbKinds`. An unknown kind is a probe
failure, not a silent `default: B(M.metal, w, h, d)` box (props.js:508-509).

#### `dressing` — **entirely new; this is the level.js extraction**
```js
dressing: {
  catenaries: [{ id, from:[3], to:[3], sag, segs, lamps:[{ t:0..1, lit:bool, circuit }] }],
  signs:      [{ id, kind:'painted'|'backlit'|'neon'|'stencil', text:[…], fg, bg,
                 pos:[3], face:'+x'|'-x'|'+z'|'-z', w, h, signageRef }],
  decals:     { scatter:[{ kind:'oil_stain'|'paper'|'crack'|'splat', area:[[2],[2]],
                           count, r, seedSalt }],
                placed:[{ kind, pos:[3], face, w, h }],
                rules:[{ kind:'tide_ring', follows:'wet.puddles.hero' },
                       { kind:'splat',     follows:'props.kind=dumpster' },
                       { kind:'rust_streak', follows:'lights.practicals.kind=sodium' }] },
  furniture:  [{ id, piece:'tram_rail'|'gantry'|'deck_strip'|'kerb'|'fence_run',
                 from:[3], to:[3], every?, **solid**: bool }],
}
```
`decals.rules` preserves the derived scatter that level.js:888-898 does today
(tide rings follow hero puddles, splats follow dumpsters, rust streaks follow sodium
poles) so those stay generative rather than becoming 40 hand-typed coordinates.
`scatter` keeps the random fields but pins them: `seedSalt` + the map seed, so the
battery stays bit-stable (R21).

#### `lights` — see §2.5 for the pool argument
```js
lights: {
  practicals: [{ id, pos:[3], aim:[3]|null, kind, color, real:bool,
                 cone, intensity, distance, penumbra,      // was level.js specById
                 godRay:bool, circuit:'main'|'emergency'|'always',
                 blackout:{relight,level}|null, mast:'pole_5m'|'bracket'|'none',
                 sign?:string }],
  ambient: { moon:{az,el,color,intensity}, hemi:{sky,ground,tint} },
  **circuits**: [{ id:'main', setPiece:'transformer_blackout'|null }],
}
```
`intensity/distance/penumbra` move **out of level.js's `specById`** (level.js:562-571)
and into the map, because they are per-map exposure decisions (LD §3.4's zone-contrast
plan is map-specific by definition). `circuit` generalises the beat-3 blackout registry
(level.js:117) from "plaza vs everything" to named circuits.

#### `atmosphere` — **new; consolidates weather/sky/audio map data**
```js
atmosphere: {
  sky: { preset:'night_storm'|'overcast_dusk'|'interior_none',
         rings:[{ r, h, dots }], landmarks:[{ ring, kind:'crane'|'tower'|'ridge'|'treeline', phi }],
         horizonBand:{ color, quadrant } },        // was sky.js RINGS + landmark literals
  fog: { density, heightFalloff, start, color, warmDir },
  rain:{ enabled, count, splashes, wind:[2] },     // 'enabled:false' for interior/forest-dry maps
  occlusion: [{ id, min:[3], max:[3], skylight?:{min:[2],max:[2]} }],   // ONE copy (§1.3b)
  drips: [{ top:[3], fall }],
  reverbZones: [{ id, zone:'exterior'|'warehouse'|'corridor'|'small_room'|'forest'|'office_open',
                  min:[3], max:[3] }],
  ambienceBeds: [{ id, bed:'harbour'|'wind_trees'|'hvac', pos:[3]|null, gain }],
}
```
Moving `reverbZones` out of content.json and into the map is the correct home: reverb
follows *geometry*, not *mission*. content.json keeps only the `params` table (rt60 per
zone name), which is genuinely global.

#### `nav`
```js
nav: { walkRects:[{id,min:[2],max:[2],y}],      // unchanged
       zones:{ <zoneId>: {min:[2],max:[2]} },   // was ZONES / pois
       **zoneAmbient**: { <zoneId>: 0..1 },     // was nav.js ZONE_BASE — moves here
       **links**: [{ from, to, kind:'door'|'stair'|'ramp'|'mantle' }] }
```
`links` is optional but pays for itself on multi-floor maps: it gives the A* bake a
declared connectivity hint instead of discovering the arcade stair the hard way — the
class of bug already recorded at layout.js:207-215 ("BOTH arcade staircases were
physically unclimbable … the full-mission e2e deadlocked at beat 4").

#### `nodes` and `spawnPoints`
```js
nodes:       { <nodeKey>: [3] },      // PER-MAP key set (no longer a global R24 literal)
spawnPoints: { player:{pos,yaw}, <spawnId>:[3] },
```
Contract change: the frozen R24 list stops being a global constant and becomes
*whatever this map declares*. The gate becomes referential, not literal: **every node a
mission/scenario references must exist in the map that mission declares.**
`probe_props.mjs`'s `R24_KEYS` array is deleted; for `meridian_ward` the same 15 keys are
asserted by a per-map `expectNodes` fixture so the existing gate strength is preserved.
This is a **freeze-amendment request** against BUILD_PLAN R24.

#### `reflect` and `prewarm` — **new; kills two private consumer copies**
```js
reflect: { zone:{ center:[3], box:{minX,maxX,minZ,maxZ,maxY}, planeY }, nearGate } | null,
prewarm: { poses:[{ pos:[3], lookAt:[3] }] },   // ≥2, per architecture §3.13 prewarm ×2
```
A forest or office map may set `reflect: null` (no planar pass at all) — which is also
the perf lever that buys those biomes their draw-call headroom back.

### 2.3 Registry and loading

```js
// core/level/registry.js  [new, A3-owned]
export const MAPS = {
  meridian_ward: () => import(`./maps/meridian_ward.js${V}`),
  // …one line per map; dynamic import keeps unused maps out of the boot payload
};
export async function loadMap(mapId, seed, V) → MapData    // throws on unknown id
```
This is the **payload answer**: at ≤6 MB to MENU (Part 5), N maps must not all be in the
boot graph. `MAPS` is a table of thunks; only the selected map's module (and its biome's
textures) is fetched. A map module is pure data — Meridian's is ~43 KB of source,
~10 KB gzipped — so even the code side is cheap.

### 2.4 Signature changes (freeze-amendment requests)

| Frozen today (architecture §3.12) | Proposed |
|---|---|
| `buildLayout(seed) → layout` | `buildLayout(mapData, seed) → layout` *(pure normalise/derive; map module is the input)* |
| `buildColliders(seed) → colliders` | `buildColliders(layout) → colliders` *(it already only uses `buildLayout(seed)`'s output — colliders.js:29)* |
| `buildLevel(ctx) → {group, staticLightSpecs}` | unchanged signature; `ctx.layout` + `ctx.biome` carry the map |
| `buildProps(layout, ctx) → {group, batches}` | unchanged signature |
| `makeMaterials(ctx) → materials` | `makeMaterials(biomeId, ctx) → materials` |
| `bakeNav(colliders, opts)` | unchanged; `opts` gains `zoneAmbient`, `links` (already an options bag) |

Four of six are unchanged. `buildColliders` losing its `seed` param and gaining
`layout` is strictly a simplification of what the code already does. This is a small
freeze delta for a large capability — worth taking to A0 as one amendment block.

### 2.5 The fixed light pool across biomes

This deserves its own answer because it is the constraint most likely to be got wrong.

**The pool size is a property of the GAME, not of a map.** Doctrine §3: "Visible-light
COUNT is a shader-permutation key. Fixed light pools (visible:true, intensity 0), never
add/remove at runtime (+33–36 recompiles at 640–900 ms measured)." If map A binds 8
spots and map B binds 5, and B *resizes* the pool, every material in the scene
recompiles on the map switch — the exact failure the doctrine names, now landing in the
middle of a PVP map rotation.

So: **1 dir + 1 hemi + 8 spot + 4 point stays fixed for every map, forever.** What
changes per map is only which slots are *leased* and what they are aimed at. This is
already how `lighting.js` behaves — `bindStatic` consumes a spec list and parks the
remainder at intensity 0 (`lighting.js:577-587`). Three rules make it work across
biomes:

1. **Fewer practicals than slots is free.** A forest map binding 2 spots (a moon shaft
   through a canopy gap, a vehicle headlight) leaves 6 parked at intensity 0. Zero cost,
   zero recompiles. The map declares 2; nothing else changes.
2. **More practicals than slots is a design constraint, not an engine problem.** An
   office floor "wants" 40 ceiling panels. It gets ≤8 real spots and 32 emissive +
   glow-card + pool-decal fakes — exactly the technique Meridian already ships (LD §3.3
   FAKE practicals; level.js:537-546 `addPool`, :529-536 `addGlow`). The map format
   makes this explicit with `real: bool`, which is already the field name in
   `LIGHT_POLES` (layout.js:632). **The authoring rule: a map may declare unlimited
   practicals; at most 8 may carry `real: true`, and `probe_props` fails the map if it
   declares 9.** Today that condition produces a console warning and silent truncation
   (lighting.js:577-579) — the refactor promotes it to a build-time failure.
3. **Point slots stay reserved for fx.** All 4 points are dynamic leases (muzzle ×3 +
   explosion, R3). No map may bind a point statically — points cannot aim, so a static
   point is always the wrong answer for a practical anyway (the reason R3 chose 8 spots
   over 10 points in the first place).

Biome-specific consequence worth stating: an **interior** biome (office) has the
opposite problem to a night-exterior one — it is *uniformly* lit, which is where the
1024-shadow-map cap and no-baked-GI hurt most (LD §0 argued exactly this against golden
hour). The lighting answer for interior maps is the same shape as Meridian's: one
directional (window light or skylight, sole shadow caster), a hemi for the floor bounce,
and 8 spots spent on *chiaroscuro* — pools of light with dark between them — with every
other fixture emissive-only. The format does not need to change; the map's exposure plan
does. That plan lives in `lights.practicals[].intensity` (moved out of `specById`), which
is precisely why that move matters.

---

## PART 3 — THE BIOME KIT SYSTEM

### 3.1 The cost argument

Eight maps must not cost 8 × the assets. The lever is that Meridian's visual identity
is already **~90 % procedural**: 10 canvas-generated textures + 6 PBR file sets + 28
parametric prop builders + 7 GLB kinds. There is no Meridian-specific mesh in the level
stack at all. What makes it "wet city night" is a *combination* — material params,
palettes, dressing vocabulary, and light plan — not unique geometry.

So the split is:

```
core/level/
  kit/            SHARED BY EVERY MAP — geometry generators, zero style
    authoring.js    box/prop/steps/catenary/sign/decalPatch  (from layout.js:26-77)
    arch.js         wall/slab/roof/stair/rail/door-header/window-grid/facade-trim
                    (from level.js §2-§3: 239-442)
    props.js        buildKind's 28 cases + mergeParts/normalize (props.js as-is)
    dress.js        addGlow/addPool/addCatenary/sign-plane/decal-quad
                    (from level.js:470-546, 694-813, 857-914)
    shader.js       augment() — grunge/mottle/aowet/puddle  (materials.js:411-502)
  biomes/         PER-BIOME — style only, no coordinates
    wet_city_night.js
    forest_night.js
    office_interior.js
    …
  maps/           PER-MAP — coordinates only, no style
    meridian_ward.js
    …
```

### 3.2 What a biome file contains

```js
// core/level/biomes/<biomeId>.js  — THREE-free except the material factory
export const BIOME = {
  id: "wet_city_night",

  // 1. texture sets to fetch (the ONLY per-biome download cost)
  textures: { file: ["asphalt_worn","concrete_yard","wall_plaster","cobble","wood","iron_plate"],
              canvas: ["grunge","ripple","decal","glow","pool","tile","corrugated",
                       "burlap","awningA","awningB","window"] },

  // 2. material recipes: params only; augment() is shared
  materials: {
    ground: { asphalt:{set:"asphalt_worn", color:0xb4b4b4, rough:0.46, tile:7.3,
                       normalScale:1.3, env:1.15, aowet:true, puddle:true, grunge:0.40 },
              cobble:{…}, concrete_yard:{…} },
    wall:   { plaster:{…}, plasterDark:{…}, concreteWall:{…} },
    prop:   { metal:{…}, steel:{…}, carPaint:{…}, carGlass:{…}, wood:{…}, … },
    emissiveKit: { sodium:0xff9a3c, cool:0xdce8ff, fluor:0xcfe0d8, warm:0xffc88a },
  },

  // 3. ground `kind` → material binding  (map says 'asphalt', biome decides what that is)
  groundBinding: { asphalt:"asphalt", asphalt_worn:"asphalt", plaza_cobble:"cobble",
                   concrete_yard:"concrete_yard", forest_floor:null /* unsupported */ },

  // 4. prop kind → mesh source + material class
  props: { glb: { car:"car_sedan", van:"van", truck:"truck", dumpster:"dumpster",
                  crate:"crate", planter:"planter", ac_unit:"ac_unit" },
           palettes: { car:[…], dumpster:[…], kiosk:[…] },     // props.js:514-523
           matFor: (kind, meshName) => …  },                    // props.js:132-139

  // 5. facade + dressing vocabulary (drives kit/arch.js and kit/dress.js)
  facade: { windowGrid:{ cols:2.7, floorH:2.95, y0:2.15, w:1.25, h:1.55, litRate:0.085, litCap:19 },
            trim:"parapet", roofClutter:"city" },
  dressVocab: { signKinds:["neon","painted","backlit","stencil"],
                decalKinds:["oil_stain","paper","crack","splat","tide_ring","rust_streak",
                            "wear_edge","drip_stain","grime_ring","edge_chip","dirt_ring",
                            "scorch_ring","ao_blob"] },

  // 6. defaults a map may override
  defaults: { fog:{…}, sky:"night_storm", rain:{enabled:true,count:2800}, wetPass:true },
};
```

### 3.3 How `materials.js` generalises

Three surgical changes; the 350-line shader-injection body is untouched.

1. **Kill the singleton, key the cache.**
   ```js
   // materials.js:31,521  BEFORE
   let CACHE = null;  …  if (CACHE) return CACHE;
   // AFTER
   const CACHE = new Map();          // biomeId → materials
   export function makeMaterials(biomeId, ctx = {}) {
     if (CACHE.has(biomeId)) return CACHE.get(biomeId);
     …
   }
   export function disposeBiome(biomeId)   // textures + materials; programs are NOT freed
                                           // (and must not be — that is the point)
   ```
2. **Drive the recipe table from `BIOME.materials` instead of 180 literal lines.** Today
   materials.js:584-742 is ~40 hand-written `augment(uv(std({…})))` calls. That becomes
   one loop over the recipe objects. The *values* move to the biome file; the
   construction stays in materials.js.
3. **Keep the frozen vocabulary keys.** `M.concrete / M.metal / M.dirt / M.asphalt /
   M.wood / M.glass` (materials.js:746) are contract keys shared with fx and audio
   (architecture §3.14 surface vocabulary). **Every biome must export all six**, whatever
   they mean locally — forest `M.dirt` is loam, office `M.concrete` is polished screed.
   This is what lets `fx/impacts.js` and `audio/sfx.js` stay completely biome-blind. It
   is the single most valuable constraint in the whole biome system and it costs nothing,
   because the surface vocabulary is already frozen and already in the collider data
   (`colliders.js:8-10`).

**Why this does not blow the shader budget.** The program cache key is value-free by
construction:
```js
// core/level/materials.js:496-500
// ONE program per injected-code variant: grunge/mottle amplitudes are
// UNIFORMS (never in the key), only the aowet/puddle code paths fork.
mat.customProgramCacheKey = () => `a3w${opts.aowet ? 1 : 0}p${opts.puddle ? 1 : 0}`;
```
Four injected variants total, forever, across every biome. Adding a biome costs
**textures and draw calls, never programs** — so the ≤70-programs gate and the
programs-delta-== 0 gate (Part 5.2) survive N biomes untouched. That is the technical
core of "8 maps without 8× the cost".

**Where the real per-biome cost lands, honestly:**
- 6 PBR file sets × 3 maps = 18 WebP fetches per biome (~1.5–3 MB). Two biomes resident
  = up to 240 textures against a ≤120 gate. **Therefore map switch MUST dispose the
  outgoing biome** unless the two maps share it. This is the one new hard requirement the
  biome system creates.
- The 11 canvas textures are generated at runtime from code (materials.js:526-536) —
  those are ~0 bytes of payload and a few ms of CPU per biome. Biomes should prefer
  canvas generation over new file sets wherever the surface will be seen at night or at
  distance.
- GLB prop kinds: 7 today. A forest biome adds maybe 5 (`tree_conifer`, `tree_broadleaf`,
  `rock`, `stump`, `log`) — and those are the *only* new authored art an entire forest
  biome needs, because everything else (walls, floors, fences, crates) is already
  parametric. Sources are already on disk per BUILD_PLAN Part 4
  (`cc0-city`, `polyhaven-models`, `generated-materials`).

### 3.4 Making biomes look genuinely different (not recoloured)

Recolouring is the failure mode that would show up on the critic scorecard as D7
(environment density) and D3 (material truth) tells. Four levers, all already present in
the code, that separate biomes structurally rather than chromatically:

| Lever | Meridian today | How another biome differs |
|---|---|---|
| **Ground `puddle` shader path** | `puddle:true` on 4 ground materials → ripple normal + planar blend (materials.js:476-493) | Forest: `puddle:false`, `aowet:true` — the `aowet.g` channel repurposed as moss/leaf-litter mask through a different injected chunk. Office: neither — flat, high-gloss screed |
| **Facade grid** | `windowGrid` 2.7 m cols, 2.95 m floors, 8.5 % lit (level.js:375-386) | Office interior: no facade at all — `arch.walls` with `piece:'partition'`; forest: no buildings |
| **Dressing vocabulary** | catenaries + neon cabinets + gutter strips | Forest: canopy spans, root flares, deadfall; Office: ceiling grid, cable trays, cubicle runs |
| **Light plan** | 8 aimed sodium/neon/flood spots, 30 fakes | Forest: 1–2 spots (moon shaft), everything else hemi + emissive; Office: 8 spots as chiaroscuro pools, ceiling panels emissive-only |

The unifying claim: **the kit generates geometry; the biome decides which kit pieces
exist in its vocabulary at all.** A biome that omits `windowGrid` and `catenary` from
`dressVocab` cannot accidentally look like Meridian.

---

## PART 4 — MIGRATION ORDER

Constraint: **Meridian Ward keeps passing every Part 5 gate at every step.** The gates
that must stay green after each phase are named per phase. The phases are individually
committable and individually revertable.

### Phase 0 — Freeze a regression baseline *(no code change)*
Capture, into `_design/expansion/baseline/`:
- `colliders.sha256` — hash of `JSON.stringify(buildColliders(1))` using probe_props'
  own `strip()` (probe_props.mjs:47-52).
- `placements.sha256` — same for `computePlacements(buildLayout(1))`.
- The most recent green `_shots/iterNN/` PNG set + its `scores.jsonl` rows.

Without this, Phase 1 has no "identical" to prove.
**Gate:** none (this IS the gate machinery for what follows).

### Phase 1 — Extract Meridian, change nothing *(pure move)*
- New `core/level/kit/authoring.js` — `box`, `prop`, `steps` moved verbatim from
  layout.js:26-77.
- New `core/level/maps/meridian_ward.js` — `makeBuildings`, `makeWalls`, `makeProps`,
  `NODES`, `REF_SPAWNS`, `WALK_RECTS`, `ZONES`, `LIGHT_POLES`, `ROADS`, `TERRAIN`,
  `BOUNDS` moved verbatim, wrapped in `buildMap(seed)`.
- `layout.js` becomes the normaliser: `buildLayout(mapData, seed)` returning today's
  exact shape, plus `computePlacements` (unchanged).
- `colliders.js`, `nav.js`, `probe_props.mjs` updated for the new import path only.
**Gate:** `node tools/probe_props.mjs` exit 0 **and** both Phase-0 hashes byte-identical.
This is a mechanical move; if the hashes differ, something was retyped.

### Phase 2 — Move level.js's hardcoded dressing into the map *(the risky one)*
Extract, in this order (each is its own commit + battery check):
1. `wet` (puddles + rects) — level.js:129-148
2. `terrain.planes` (canal) — level.js:219-237
3. `atmosphere.occlusion` + `drips` — level.js:941-946 **and delete `weather.js`'s
   `OCCL`/`DRIPS` duplicate** (weather.js:132-155). *This deliberately changes behaviour*
   — the two copies disagree today (§1.3b). Pick level.js's values (they match the
   collider geometry: arcade roof underside 8.2 at layout.js:185) and record the diff.
4. `dressing.furniture` (tram rails, gantries, deck strip) — level.js:444-465, **with
   `solid: true` on the gantry posts**, which adds colliders that did not exist. This
   changes nav and ballistics: re-run the sim/ai selftests, not just the visual gate.
5. `dressing.catenaries` — level.js:488-518
6. `lights.practicals[].intensity|distance|penumbra` — level.js `specById`:562-571
7. `dressing.signs` (painted ×6, shop ×6) + skylight/gatehouse specials — level.js:601-637,
   772-813
8. `dressing.decals` — level.js:857-914, with the three `rules` preserving derived scatter
9. **`mast` props for every practical** — closes §1.3a. New colliders again → selftests.
**Gate after each sub-step:** `probe_props` exit 0, `node core/sim/sim.selftest.cjs`
exit 0, `node core/ai/ai.selftest.cjs` exit 0, and `shotbattery.py --iter N+1` compared
against the Phase-0 PNGs. Steps 4 and 9 are the only ones expected to move pixels
(new collider geometry is also new visible geometry in the same place) — everything else
must be visually identical.

### Phase 3 — De-singleton materials and props
- `materials.js`: `CACHE` → `Map` keyed by biome; add `disposeBiome`.
- `props.js`: `LIB` → `Map` keyed by biome/kit id; add dispose.
- `level.js`/`props.js` call sites take a biome id (Meridian passes `"wet_city_night"`).
- Create `core/level/biomes/wet_city_night.js` holding *exactly today's values*, with
  materials.js reading recipes from it.
**Gate:** boot + full battery unchanged; `stats().programs` at end of prewarm unchanged
(this is the proof the cache-key argument in §3.3 holds).

### Phase 4 — Parameterise the five private consumers
One commit each: `nav.ZONE_BASE` → `map.nav.zoneAmbient`; `reflect.PLAZA_*` →
`map.reflect`; `prewarm` anchors → `map.prewarm.poses`; `sky.RINGS`/landmarks →
`map.atmosphere.sky`; `ambience` bed positions → `map.atmosphere.ambienceBeds`.
Each keeps its current values as the *fallback* when the map omits the field, so nothing
regresses if a field is forgotten.
**Gate:** full battery + `perfprobe.py` all three phases (sky and reflect changes are
draw-call-visible).

### Phase 5 — Content split and map selection
- `content.json` → `content/missions/meridian_ward.json` + `content/index.json`
  (mission list, each with `mapId`). `reverbZones.volumes` move to the map;
  `reverbZones.params` stay global.
- `scenarios` move into the map's own file (they are map poses) or into
  `content/scenarios/<mapId>.json` — recommend the latter, so A2 and A3 ownership stays
  split as BUILD_PLAN Part 2 requires.
- `boot.js`: `?map=<id>` / mission-declared `mapId`; `loadMap` replaces the direct
  import; add a `teardownLevel()` that removes and disposes the level group.
- Contract gate becomes per-(mission, map): every node/spawn/scenario ref resolves
  against *that mission's* map.
**Gate:** `bootcheck.py` exit 0, full battery, and one `playprobe` per persona (the
teardown path is new and is where epoch/handler leaks will show up).

### Phase 6 — Prove the seams with a throwaway second map
A deliberately minimal blockout in a **new biome** (recommend the office interior — it
stresses the format hardest: no sky, no rain, `reflect:null`, multi-floor nav,
interior-only reverb). Do not dress it. Its only job is to prove that boot, nav, sim,
the light pool, and the harness all survive a map that shares no assumption with
Meridian.
**Gate:** `probe_props --map <id>` exit 0; sim selftest against its content; boot to a
playable state; one battery iteration that produces PNGs at all (not that they score).

### Phase 7 — PVP arena layer *(separable; needs no further level refactor)*
An arena is `{ arenaId, mapId, region:{min,max}, spawnSets:[…], mode }` — a subregion of
an existing map plus spawn data and no mission. This is why the map format keeps
`campaignRole` and why `nav.walkRects` are rectangles: clipping a map to an arena region
is a bounds intersection over walkRects + a nav re-bake with tighter `bounds` (which
also *improves* the nav cell size, per §1.4 item 8). Nothing in Parts 1–3 needs to
change for PVP; that is the design goal being met.

### Where regression risk is highest

1. **Phase 2 steps 4 and 9** — adding colliders where visual-only geometry stood.
   Bots pathed through those posts yesterday; today they collide. Watch `playprobe`'s
   `stuckBotSeconds == 0` assertion and the persona pass bars (Part 5.4), not just the
   PNGs.
2. **Phase 2 step 3** — the occlusion de-fork changes rain behaviour near four interior
   ceilings. The rain-occlusion build probe (LD §5.3: "camera inside each volume for 120
   frames → zero streak instances") is the detector; make sure it is actually wired
   before this step, not after.
3. **Phase 3** — a `Map`-keyed cache that is keyed *wrong* (e.g. by ctx identity) silently
   rebuilds materials per call and doubles the texture count. The gate is
   `stats().textures`, and it must be read, not assumed.
4. **Phase 4 sky/reflect** — both are draw-call and program-adjacent. `perfprobe`'s
   `programs delta == 0` is the FAIL-class gate; run it, don't infer it.
5. **Phase 5 teardown** — the epoch discipline (architecture §0.3) has never been
   exercised by a *level* teardown, only a mission restart. Handlers registered by
   `attach(bridge)` and `onBeforeRender` hooks planted on level meshes
   (level.js:933-937, the self-driven flicker driver) will leak across a map switch if
   `bridge.clear()` and disposal are not both called.

### What stays frozen and untouched throughout

`core/view/bridge.js` (FROZEN, ≤40 lines) · the event vocabulary (architecture §4 + R13)
· `sim.state` shape · the `__FPS__.__test` surface (R11) · weapon data · the fixed light
pool counts · the surface/matClass vocabularies · the Part 5 acceptance numbers ·
`game_controls.js`. None of this refactor touches the sim, AI, weapons, chars, fx, hud,
or audio *contracts* — only the data those modules are handed.

---

## PART 5 — AUTHORING WORKFLOW

### 5.1 Building a new map

1. **Blockout in data.** New `maps/<id>.js`: `META`, `bounds`, `arch.buildings`,
   `arch.walls`, `nav.walkRects`, `nodes`, `spawnPoints`. Nothing else. Lane discipline
   from LD §2.3 applies to every map: name the lanes, state the sightline band per lane,
   and place cross-cuts every 25–35 m of the traversal axis.
2. **`node tools/probe_props.mjs --map <id>` — gate 1.** Determinism, schema, no
   overlapping AABBs, nodes walkable/supported, spawns walkable, cover well-formed.
   This runs with zero browser and zero art.
3. **Nav.** `--map <id> --nav` extension: bake time under budget, every node and spawn
   reachable from the player spawn, no isolated components. The arcade-stair deadlock
   (layout.js:207-215) is the reason this is a gate and not an observation.
4. **Sim playthrough before art.** Point a mission (or an arena mode) at the map and run
   `playprobe.py --persona rusher/optimal/novice/camper`. `stuckBotSeconds == 0`,
   every match ends. A map that fails here is a *layout* problem, and it is 10× cheaper
   to fix before dressing.
5. **Props + cover.** `props[]` with `cover` nodes; re-run probe_props for the wave-2
   contact gate (raycast placement, 1.5 cm sink, float > 0 mm / clip > 3 cm fail, base
   decal required over 0.3 m²).
6. **Biome selection.** Reuse an existing biome, or author a new one (§3.2). New biome =
   new work; reusing one is nearly free. **Two maps in the same biome should look
   different through layout, light plan, and dressing vocabulary — not through new
   textures.**
7. **Light plan.** `lights.practicals` with ≤8 `real:true`, per the LD §3.4 zone-contrast
   discipline: write down the relative brightness of each zone along the traversal axis
   *before* placing lights.
8. **Dressing.** `dressing.*`, using the biome's `dressVocab`. Then the battery.

### 5.2 Generalising the gates

**`probe_props.mjs` → `--map <id>` / `--all`.**
- Delete the `R24_KEYS` literal (probe_props.mjs:28-32). Replace with: nodes come from
  the map; a per-map `expectNodes` fixture may pin an exact set (Meridian pins its 15,
  preserving today's strength); the *cross-file* check moves to the contract gate —
  every node referenced by a mission/scenario exists in that mission's map.
- Add per-map checks the format makes possible: `real:true` practical count ≤ 8;
  every `props[].kind` in the kit ∪ biome vocabulary; every `ground.paints[].kind` bound
  by the biome's `groundBinding`; every `dressing.decals.kind` in `dressVocab`.
- `--all` iterates the registry. **CI meaning: adding map 5 cannot break map 2 silently.**

**Contract gate (A1's `sim.selftest.cjs --contract`).** Today it validates content.json
against one collider set. It becomes a loop over `content/index.json` missions, each
resolving `mapId` → map → colliders. Same assertions, per pair. The Colosseum
empty-bout lesson scales with it.

**Shot battery → per-map.**
- `shotbattery.py --map <id> --iter N` → `_shots/<mapId>/iterNN/*.png`. The
  never-overwrite guard (exit 3) becomes per-map, so map 2's iteration 1 does not
  collide with map 1's.
- `_harness/shots.js SCENARIOS` gains a map dimension: the *battery ids* stay the R10
  vocabulary (`S1`…`S9`, `C1`) because they encode **what the frame must show** (VT
  states), not where it is shot. Each map supplies its own poses for the same ids. That
  is the key insight — S3 is "quiet establishing wide" on every map; only the pose
  changes. A map may legitimately mark a scenario `n/a` (an office map has no `S5`
  sky/horizon frame) — the format must allow it, and the critic must be told it is
  absent by design rather than missing.
- `scores.jsonl` rows gain `"map": "<id>"`. Format otherwise unchanged (R27).

**Critic loop across N maps.** The ship bar (Part 5.5) is per-map and non-negotiable:
*every dimension ≥ 8, mean ≥ 8.5, blind verdict ≥ borderline from every critic* — on
each map independently. Averaging maps together would let a strong Meridian carry a weak
forest, which is exactly the "averaging-away a weak dimension" the bar forbids. Two
practical additions:
- **Iteration cost.** N maps × ~10 shots × ≥2 critics is the new per-iteration cost.
  Mitigation: run the *full* battery on the map under active iteration and a **3-shot
  regression subset** (`S1`, `S3`, `S4`) on every other map, to catch a shared-kit change
  degrading a finished map. A regression subset that moves triggers a full battery on
  that map.
- **Biome coherence (non-scored).** A separate pass, outside the D1–D10 scorecard (which
  is frozen): show a critic one frame from each map and ask whether they read as the same
  game. This catches the opposite failure from per-map scoring — eight maps that each pass
  and collectively look like eight different games.

**perfprobe per map.** The Part 5.2 budget is per-map, and the draw-call line is the one
most likely to differ: a forest with 4,000 instanced trees and no planar pass has a
completely different draw profile from Meridian's plaza. Each map needs its own
perf-static / perf-combat run and its own named degradation path (Meridian's is the
planar pass auto-off at the dynres floor; a forest's would be instance-count scaling).

### 5.3 A new map's definition of done

Mirrors Part 3's wave-3 list, per map: probe_props exit 0 · nav gate exit 0 ·
contract gate exit 0 · sim + ai selftests exit 0 · playprobe personas at the Part 5.4
bars · perfprobe three phases green · shot battery at the Part 5.5 ship bar ·
`__FFG_FALLBACKS__` empty · deployverify exit 0 including one production match on that
map.

---

## PART 6 — OPEN QUESTIONS FOR THE OWNER / A0

1. **Freeze-amendment approval.** §2.4's six signature changes and §2.2's replacement of
   the global R24 node-key list with per-map node sets need A0 sign-off before any lane
   codes against them.
2. **Map switch without reload — required or not?** If PVP rotates maps in-session, the
   dispose/teardown path (Phase 5) is load-bearing and must be built and probed. If every
   map change is a page reload, Phase 3's dispose work is optional and the texture-budget
   pressure in §3.3 disappears. **This single answer changes the size of Phases 3 and 5.**
   Recommendation: build the teardown path anyway (a reload between PVP rounds is a bad
   player experience), but treat in-session switching as a Phase-5 acceptance criterion,
   not a Phase-3 one.
3. **Biome count for the campaign.** The owner named outdoor, forest, office. Each new
   biome is real work (~1 new file set or a canvas-texture equivalent + 3–5 GLB prop
   kinds + a light plan); each new *map in an existing biome* is nearly free. A campaign
   of 8 maps across 3 biomes is a fundamentally cheaper project than 8 maps across 8.
   Recommend fixing the biome list before authoring map 2.
4. **Where PVP arena data lives** — inside the map file (`campaignRole: 'both'` plus an
   `arenas[]` block) or as separate `content/arenas/<id>.json` files. Recommend separate
   files: it keeps A3 (space) and A2 (content) ownership disjoint, which is the rule that
   made the 12-lane build work.

---

*Sources: every file:line citation above was read this session —
`core/level/{layout,colliders,level,materials,props}.js`, `content.json`,
`runtime/boot.js`, `core/ai/nav.js`, `core/render/{weather,reflect,sky,lighting,prewarm}.js`,
`core/audio/ambience.js`, `tools/probe_props.mjs`, `_harness/{shots.js,shotbattery.py}`,
`_design/{BUILD_PLAN,architecture,level_design,visual_target}.md`,
`pipeline/knowledge/GAME_DOCTRINE.md`. Claims about what is hardcoded are from grep +
read, not recollection; the two invariant violations in §1.3 were verified by absence
searches whose results are quoted.*
