# DYEFIELD — build contract (phases 0–2)

This file is the spine. Every lane builds against the signatures and formats written here.
Where the brief, `DESIGN.md` and this file disagree, this file wins for *interfaces* and
`DESIGN.md` wins for *intent*. A lane that needs an interface change writes the change **here
first**, marked `CHANGED(<lane>): …`, and never breaks an existing signature silently.

## §0 Ground rules

- **Own your files only (§8).** Never edit another lane's files. If you need something from
  another lane, depend on the signature here and leave a note in your final report.
- **THREE-free core:** `runtime/src/core/**` never imports `three` and never touches the DOM.
  It must run under plain `node` (Node 22.20 type stripping), exactly like the browser.
- TypeScript: `erasableSyntaxOnly` (no `enum`, `namespace` or parameter properties); relative
  imports **with `.ts` extensions**; JSON via `import x from '…json' with { type: 'json' }`.
- Deterministic sims: no `Math.random()` in `core/`. Seeded streams come from `core/rng.ts`.
- **No primitive hero assets.** Capsules and boxes may appear only as debug geometry behind `?dev=1`.
- Verification is at the player's layer: real key and mouse events in real Chrome, pixels read
  back. A teleporting harness is not a playtest.
- Windows: every subprocess uses utf-8. Never run `claude -p`. Only one headed Chrome at a time
  for perf numbers.

## §1 Layout

```
games/dyefield/
  README.md  package.json  tsconfig.json  vite.config.ts
  data/            teams.json  weapons.json  maps.json           (tuning + layout truth)
  art/
    build.py                      runner + contract check  (python art/build.py check)
    blender/*.py                  headless bpy sources (committed; deterministic)
    gltf/*.glb                    exported assets (committed)
    renders/*.png                 QA renders from Blender (turntables, map overviews)
  runtime/                        Vite root (the web project)
    index.html
    src/main.ts game.ts input.ts testsurface.ts
    src/core/   types.ts data.ts rng.ts glb.ts mapgeo.ts config.ts physics.ts player.ts
    src/core/paint/  atlas.ts painter.ts minimap.ts
    src/view/   renderer.ts sky.ts water.ts surfaces.ts paintlayer.ts mapview.ts heroview.ts camera.ts
    src/ui/     hud.ts boot.ts styles.css
  _harness/  probe_paint.ts probe_move.ts common.py bootcheck.py lookshots.py   _reports/ (gitignored)
  _shots/    (gitignored)
  _spec/     CONTRACT.md DESIGN.md
```

## §2 Conventions

- **Units:** metres, seconds, radians in code (degrees only in JSON, suffixed `Deg`).
- **Axes:** runtime/glTF are Y-up. SUNCREW (team 1, side A) spawns at −Z; GULF CREW (team 2,
  side B) at +Z. Blender is Z-up. The glTF exporter maps Blender (x, y, z) → glTF (x, z, −y).
  So **author forward as Blender −Y**, and it arrives as glTF/three **+Z**.
- **Yaw:** 0 faces +Z; forward = (sin yaw, 0, cos yaw), matching three's `rotation.y`.
  Positive yaw turns *left* (counter-clockwise seen from above), so mouse-right *decreases* yaw.
- **Teams:** `TeamId` 0 neutral / 1 SUNCREW / 2 GULF CREW (`core/types.ts`). Colors come only
  from `data/teams.json`.
- **Sim tick:** fixed 60 Hz (`config.ts: TICK = 1/60`). The render loop interpolates. At most
  5 sim steps per frame; excess debt is dropped (and discarded entirely on pause).
- **Atlas texel ↔ UV (no flips anywhere):** texel `(x, row)` has centre UV
  `((x+0.5)/S, (row+0.5)/S)`, and `row = floor(v·S)` where `v` is glTF TEXCOORD_1 as exported.
  The `DataTexture` keeps `flipY = false`, so data row *r* is sampled at `v = (r+0.5)/S`.

## §3 Asset formats (Blender → runtime)

### §3.1 Map GLB — `art/gltf/map_<id>.glb` (lane MAP)

- Built by `art/blender/build_map.py -- --map <id>` from the map's `brushes` in `data/maps.json`
  (mirror rule applied). Deterministic.
- **Object/node naming** (the prefix decides runtime behavior; mesh-data names don't matter):

  | prefix | visible | collides | paintable |
  |---|---|---|---|
  | `paint_*` | yes | yes | **yes** |
  | `solid_*` | yes | yes | no (spawn pads, lamp posts, bollards, rails, palm trunks, grates) |
  | `deco_*` | yes | no | no (distant scenery, fronds, over-water billboards, pilings) |
  | `col_*` | no | yes | no (invisible blockers) |
  | `water_*` | yes | no | no (optional; the runtime may use its own water) |

- `paint_*`, `solid_*` and `col_*` mesh objects have **all transforms applied** (node TRS =
  identity). Their vertices are world-space.
- `paint_*` meshes carry exactly two UV maps. **`UVMap`** (→ TEXCOORD_0) is the material tiling
  in metres (1 UV unit = 1 m along the surface). **`Atlas`** (→ TEXCOORD_1) is the paint atlas.
  All `paint_*` Atlas UVs share ONE square atlas space and must be:
  - non-overlapping;
  - inside [m, 1−m], with an island margin of ≥ 3 px at the atlas size;
  - scaled uniformly by world area (texel density within ±15 % across islands).
  Only faces a player can see or reach are paintable. Bottoms, faces flush against other
  solids, and the pier skirt below the deck are **not** `paint_*` (make them `solid_*` or delete
  them).
- Empties: `spawn_A` and `spawn_B` (location = pad top centre; the empty's forward encodes
  spawn yaw) and `mapinfo`. `mapinfo`'s custom properties are exported as node **extras** and
  must include:
  - `df_map_id` (str);
  - `df_atlas_size` (int: 512 | 1024 | 2048, square), chosen so the achieved density is ≥ 80 %
    of `paint.texelsPerMeter`, capped at `paint.atlasMax`;
  - `df_texels_per_meter` (float, achieved average);
  - `df_paint_area` (float, m² of all `paint_*` triangles);
  - `df_version` (int).
- **Materials** are named `M_<name>` from this set: `M_tile M_concrete M_boardwalk M_crate
  M_chevron M_hazard M_planter M_soil M_metal M_pad_A M_pad_B M_palm_trunk M_palm_leaf M_lamp
  M_glass M_billboard M_sign_text M_rope M_rock M_sand M_island M_lighthouse M_crane M_hull
  M_water M_foliage M_paint_trim`. Each sets a sensible Principled base color, roughness and
  metallic (0 unless metal), so the GLB previews correctly anywhere. The runtime swaps them by
  name for stylized shaders (§5), and an unknown name falls back to its base color. An optional
  `Col` vertex color (→ COLOR_0) gives per-vertex tint variation.
- Budgets: GLB ≤ 8 MB; ≤ 250k triangles total; ≤ 120k triangles in `paint_*`.
- QA outputs: `art/renders/map_<id>_top.png` (orthographic, team sides visible) and
  `map_<id>_persp.png` (a player's-eye view from the SUNCREW base).

`CHANGED(integrator): maps.json pier18 crate_a3 center [-18.0, 1.2, -27.5] → [-18.6, 1.2, -27.5]`
(a value fix, not a semantics change). As authored, the stacked crate hung half over the lower
crate_a2 with a 0.1 m air gap. MAP had patched it inside `build_map.py FIXUPS`; the fix now lives
in the data and the fixup is gone. The rebuilt `map_pier18.glb` is byte-identical (sha256
`e0534bc9fe1e6625…`).

### §3.2 Hero GLB — `art/gltf/tide_runner.glb` (lane HERO)

- One armature object **`rig`**, skinned mesh object(s) parented to it. Built facing Blender −Y,
  so it arrives facing glTF +Z. Rest pose is a relaxed A-pose, feet on y = 0.
- **Proportions (kid-scale toy athlete):** total height to the crest tip ≈ 1.25 m, crown of
  head ≈ 1.12 m. The head is ≈ ⅓ of body height (big head, short body, chunky hands and
  sneakers). Outfit: sport shorts, tank top, sneakers, wristbands, and a back **dye tank**. The
  swept **hair-crest** is the silhouette read, a bold fin-like sweep from brow to nape, and it is
  *not* a squid or octopus shape.
- **Bones (exact names):** `root hips spine chest neck head crest_1 crest_2 crest_3 shoulder.L
  upper_arm.L forearm.L hand.L shoulder.R upper_arm.R forearm.R hand.R thigh.L shin.L foot.L
  toe.L thigh.R shin.R foot.R toe.R tank`.
- **Nodes (exact names):**
  - `socket_weapon`: an empty parented to bone `hand.R`, oriented so its local Blender −Y is the
    barrel direction and +Z is up. The runtime attaches a kit with an **identity** transform.
  - `tank_dye`: the mesh of the dye inside the back tank, weighted 100 % to `tank`. Its node
    extras hold `df_fill_min` and `df_fill_max`, the bind-space glTF-Y range of the dye, which
    the runtime clips against the tank level.
  - `slick_fin`: the swim-form mesh (crest-fin plus a glossy low hump), hidden by default and
    shown by the runtime in SLICK.
- **Materials (exact names).** Team-tinted by the runtime: `M_crest M_top_trim M_shorts_stripe
  M_sole M_tank_dye M_band`. Neutral: `M_skin M_hair M_eye_white M_eye_dark M_mouth M_top
  M_shorts M_shoe M_tank_shell M_glass`. Team-tinted materials use a *light neutral* base
  color (the runtime multiplies the team dye in).
- **Clips (exact names).** Required now: `idle run jump fall land aim brush`. Wanted in the same
  pass: `slick_dive washed victory lobby_idle strafe_l strafe_r back`.
  - Locomotion clips loop and animate the whole body. `jump` is a take-off, `fall` loops and
    `land` is a short recovery.
  - `aim` and `brush` are **upper-body** clips that key only `spine chest neck head shoulder.*
    upper_arm.* forearm.* hand.*`, so the runtime can layer them over locomotion.
  - `run` is authored for ~5.2 m/s ground speed, and its foot-plant cycle length is stored in
    the `rig` node extras as `df_run_stride` (metres per cycle), so the runtime can sync
    playback to speed.
- Budget: ≤ 12k triangles, flat materials and vertex colors (no image textures needed).
- Kit: `art/gltf/kit_mist_rasp.glb`, built facing Blender −Y (barrel along −Y) with the grip at
  the origin. It has a node **`muzzle`** (empty) at the nozzle and is ~0.5–0.55 m long.
  Materials use the same naming; team-tinted parts use `M_kit_dye`.
  `CHANGED(orchestrator, fix round 1)`: the kit is 0.536 m and chunkier, with no `M_glass`, so it
  reads in hand at gameplay distance. Its rear end, rear cap and canister dome are `M_kit_dye`,
  because the follow camera sees the kit's rear in every pose. The crest tip sits at 1.271 m
  (the "≈ 1.25 m" target above is approximate): the crest is now one big swept `M_crest` mass
  (fringe → crown → nape ducktail), and `M_hair` is only the undercut.
- QA outputs: `art/renders/hero_turntable.png` (front / ¾ / side / back on one sheet),
  `hero_clips.png` (a key pose from each clip) and `hero_with_kit.png`.

## §4 Core APIs (THREE-free; lane PAINT unless noted)

### §4.1 `core/types.ts`, `core/data.ts` — written by the orchestrator, read-only for lanes.

### §4.2 `core/rng.ts`
```ts
export function mulberry32(seed: number): () => number;          // [0,1)
export function hash32(a: number, b?: number, c?: number): number; // stable uint32 mix
export function hash01(a: number, b?: number, c?: number): number; // [0,1)
```

### §4.3 `core/glb.ts`
```ts
export interface GlbMeshPart {
  node: string;                     // node name
  material: string;                 // material name ('' if none)
  positions: Float32Array;          // WORLD space (node hierarchy applied), xyz
  normals: Float32Array | null;     // WORLD space, unit
  uv0: Float32Array | null;
  uv1: Float32Array | null;
  colors: Float32Array | null;      // rgba 0..1
  indices: Uint32Array;             // triangle list
}
export interface GlbNodeInfo {
  name: string; parent: number; mesh: number | null;
  world: Float64Array;              // 4x4 column-major world matrix
  extras: Record<string, unknown> | null;
}
export interface GlbDoc { json: any; nodes: GlbNodeInfo[]; parts: GlbMeshPart[] }
export function parseGlb(buf: ArrayBuffer | Uint8Array): GlbDoc;
/** file path, file:// URL (Node) or http(s) URL (browser) */
export function loadGlb(url: string): Promise<GlbDoc>;
/** URL of an exported asset: new URL(`../../../art/gltf/${file}`, import.meta.url).href */
export function artUrl(file: string): string;
```
It handles float/normalized-int accessors, byteStride, u8/u16/u32 indices, and non-indexed
primitives. Skins and animations are not needed here, because the view uses three's
GLTFLoader for rendering.

### §4.4 `core/mapgeo.ts`
```ts
export interface TriSoup {
  positions: Float32Array; normals: Float32Array; uv1: Float32Array; indices: Uint32Array;
  triMaterial: Uint16Array; materials: string[];
}
export interface MapGeometry {
  id: string;
  paint: TriSoup;                                              // all paint_* merged
  collision: { positions: Float32Array; indices: Uint32Array }; // paint_* ∪ solid_* ∪ col_*
  spawns: Record<Side, { x: number; y: number; z: number; yaw: number }>;
  atlasSize: number; texelsPerMeter: number; paintArea: number;
  info: Record<string, unknown>;                               // mapinfo extras
}
export function extractMapGeometry(doc: GlbDoc, def: MapDef): MapGeometry;
export function loadMapGeometry(def: MapDef): Promise<MapGeometry>;   // artUrl(`map_${def.id}.glb`)
```

### §4.5 `core/paint/atlas.ts`
```ts
export interface AtlasOptions { wallWeight: number; floorMinNy: number; cellSize?: number /*1.0*/; gutter?: number /*2*/ }
export interface PaintAtlas {
  size: number;               // S (square)
  count: number;              // surface texels
  idOf: Int32Array;           // S*S linear → id | -1
  lin: Int32Array;            // id → linear (row*S + x)
  srcOf: Int32Array;          // S*S linear → id whose color this texel shows (surface: itself; gutter: nearest surface id) | -1
  mirrorStart: Int32Array;    // CSR id → gutter linear indices mirroring it
  mirrorItems: Int32Array;
  px: Float32Array; py: Float32Array; pz: Float32Array;   // id → world position of texel centre
  nx: Float32Array; ny: Float32Array; nz: Float32Array;   // id → unit normal
  area: Float32Array;         // id → m² this texel represents (triangle world area / UV texel area)
  weight: Float32Array;       // id → 1 (floor/ramp: ny ≥ floorMinNy) | wallWeight
  floor: Uint8Array;          // id → 1 if ny ≥ floorMinNy
  team: Uint8Array;           // id → TeamId — THE paint state of the game
  noise: Uint8Array;          // id → stable 0..255 hash (edge noise; GPU B channel)
  grid: { cell: number; ox: number; oy: number; oz: number; nx: number; ny: number; nz: number; start: Int32Array; items: Int32Array };
  totalArea: number; totalWeighted: number;
  overlaps: number;           // texels claimed by >1 triangle (UV2 overlap; should be ~0)
}
export function buildAtlas(soup: TriSoup, size: number, opts: AtlasOptions): PaintAtlas;
```
Raster rule: a texel belongs to a triangle when its centre lies inside the triangle's UV2
footprint (edge functions plus a top-left tie rule). The first claim wins; later claims count
as `overlaps`. Gutter texels within `gutter` px of a surface texel become mirrors of the
nearest one.

### §4.6 `core/paint/painter.ts`
```ts
export interface SplatOpts {
  radius: number; team: TeamId;
  nx?: number; ny?: number; nz?: number;   // surface normal of the hit; enables the facing filter
  minFacing?: number;                      // dot(texelN, n) must be > this (default -0.1)
  edgeNoise?: number;                      // fraction of radius (default 0.18) for organic edges
  seed?: number;
}
export interface SurfaceHit { id: number; team: TeamId; dist: number; x: number; y: number; z: number }
export class Painter {
  readonly atlas: PaintAtlas;
  onFlip: ((id: number, from: TeamId, to: TeamId) => void) | null;
  constructor(atlas: PaintAtlas);
  splat(x: number, y: number, z: number, o: SplatOpts): number;                              // #texels flipped
  capsule(ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: SplatOpts): number;
  surfaceAt(x: number, y: number, z: number, maxDist: number, kind: 'floor' | 'wall' | 'any'): SurfaceHit | null;
  teamUnder(x: number, y: number, z: number): TeamId | null;  // surfaceAt(x, y, z, 0.35, 'floor')
  coverage(): Coverage;                                       // weighted fractions, sum 1
  weighted(team: TeamId): number;                             // Σ area·weight
  takeDirty(cb: (row: number, x0: number, x1: number) => void): void; // incl. mirrors; clears
  reset(): void;
  hash(): string;                                             // FNV-1a of team[] (8 hex)
  readonly flips: number;
}
```
Splat membership: `|p − c| ≤ r · (1 − e + 2e · noise)`, where `e = edgeNoise` and noise is a
per-texel hash mixed with `seed`. Weighted totals update incrementally (O(1) per flip). A splat
costs O(texels in the touched grid cells), and it must never scan the whole atlas.

### §4.7 `core/paint/minimap.ts`
```ts
export interface MinimapOptions {
  min: [number, number]; max: [number, number];   // world x,z rectangle (maps.json minimap)
  pxPerMeter: number;
  colors: { base: [number, number, number]; sun: [number, number, number]; gulf: [number, number, number] }; // 0..255
}
export class MinimapRaster {
  readonly w: number; readonly h: number; readonly rgba: Uint8ClampedArray; dirty: boolean;
  constructor(atlas: PaintAtlas, o: MinimapOptions);
  apply(id: number): void;            // repaint the pixel(s) this floor texel owns (top-most y wins)
  rebuild(): void;
  worldToPixel(x: number, z: number): [number, number];
}
```
Orientation is the SUNCREW view: pixel row 0 = max z, column 0 = max x (screen-up = +Z,
screen-right = −X, which is exactly what a runner at the SUNCREW base facing +Z sees). The HUD
rotates it 180° for GULF CREW. Base pixels shade by height, so decks read lighter.

### §4.8 `core/config.ts`, `core/physics.ts`, `core/player.ts` (lane RUNTIME)
```ts
// config.ts — tuning truth for movement/camera (numbers from DESIGN §4)
export const TICK: number;                 // 1/60
export const MOVE: { walk: number; slog: number; slick: number; wallSlick: number; accel: number; airAccel: number;
                     jump: number; jumpSlog: number; jumpSlick: number; gravity: number; maxFall: number;
                     radius: number; halfHeight: number; slickHalfHeight: number; stepHeight: number; maxSlopeDeg: number };
export const CAMERA: { fovDeg: number; pivotY: number; distance: number; shoulder: number; restPitchDeg: number;
                       minPitchDeg: number; maxPitchDeg: number; slickPivotY: number; slickDistance: number; collideRadius: number; sensitivity: number };
export const DEV_BRUSH: { radius: number; perSecond: number };   // phase-2 paint-under-feet brush

// physics.ts — Rapier 0.20 compat; works in Node and the browser
export type Rapier = typeof import('@dimforge/rapier3d-compat').default;
export function loadRapier(): Promise<Rapier>;
export interface CastHit { toi: number; x: number; y: number; z: number; nx: number; ny: number; nz: number }
export class PhysicsWorld {
  constructor(R: Rapier, geo: MapGeometry);
  createCharacter(radius: number, halfHeight: number): CharacterBody;
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): CastHit | null;
  sphereCast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, radius: number, maxDist: number): CastHit | null;
}
export interface CharacterBody {
  /** desired displacement this tick → applied displacement + grounded (Rapier KCC: autostep, snap, slope limit) */
  move(dx: number, dy: number, dz: number): { dx: number; dy: number; dz: number; grounded: boolean };
  setFeet(x: number, y: number, z: number): void;   // feet position (capsule bottom)
  feet(): Vec3;
  setShape(radius: number, halfHeight: number): void;
}

// player.ts
export class Player {
  readonly team: TeamId; readonly side: Side;
  x: number; y: number; z: number;          // feet
  vx: number; vy: number; vz: number;
  yaw: number;                              // body facing (turns toward move/aim direction)
  state: MoveState; grounded: boolean; tank: number;
  constructor(team: TeamId, body: CharacterBody, spawn: { x: number; y: number; z: number; yaw: number });
  step(dt: number, intent: PlayerIntent, painter: Painter): void;  // phase 2: walk/air + DEV_BRUSH under feet while intent.fire
  respawn(spawn: { x: number; y: number; z: number; yaw: number }): void;
}
```
Out of bounds: feet below `killY` → respawn at the team spawn (phase 5 turns this into
WASHED).

## §5 View APIs (`three` allowed)

### §5.0 LOOK lane signatures (exact — APP lane codes against these)
```ts
// view/paintlayer.ts
export class PaintTexture {
  readonly texture: THREE.DataTexture; readonly size: number;
  constructor(atlas: PaintAtlas);
  rebuildAll(): void;                       // full RGBA rebuild from atlas.team (first frame / after reset)
  upload(painter: Painter): number;         // drain painter.takeDirty → addUpdateRange + needsUpdate; returns rows touched
}
// view/surfaces.ts
export interface SurfaceOptions { mapId: string; courtLines?: MapDef['courtLines'] }
/** stylized replacement for an exported M_* material (fallback = the GLTFLoader material, used for unknown names) */
export function materialFor(name: string, fallback: THREE.Material | null, o: SurfaceOptions): THREE.MeshStandardMaterial;
export interface DyeUniforms { [k: string]: THREE.IUniform; uDyeTex: THREE.IUniform; uViewerTeam: THREE.IUniform; uTime: THREE.IUniform; uColorblind: THREE.IUniform }
export function createDyeUniforms(paint: PaintTexture): DyeUniforms;   // one shared set per map (team colors from teams.json)
/** inject the dye layer (onBeforeCompile). Mesh geometry must carry the 'uv1' attribute (GLTFLoader maps TEXCOORD_1 → uv1). */
export function applyDye(mat: THREE.MeshStandardMaterial, dye: DyeUniforms): void;
// view/sky.ts
export interface SkyRig {
  sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; sunDir: THREE.Vector3;   // sunDir = unit vector TOWARD the sun
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3): void;              // shadow camera box follows focus
  dispose(): void;
}
export function createSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, preset: LightingPreset): SkyRig;
// view/water.ts
export interface WaterRig { mesh: THREE.Mesh; update(t: number, camera: THREE.Camera): void }
export function createWater(scene: THREE.Scene, preset: LightingPreset, waterY: number, sunDir: THREE.Vector3): WaterRig;
```
Visual targets are toy-bright Saturday-morning sports, not realistic: saturated, clean,
soft-shadowed, with readable silhouettes. Surfaces carry procedural detail in world or UV0
metres (tile grout plus the court lines from `maps.json courtLines`, concrete speckle and edge
wear, boardwalk planks, crate planks, chevron and hazard stripes, planter rim). Dye is the hero
material: saturated team color, glossy spec and a soft raised rim for the viewer's crew; flatter,
darker, matte and "sticky" for the enemy. Edges are organic via the B-channel noise plus
high-frequency procedural noise; there are no blocky texel edges at 2 m viewing distance.

### §5.1 APP lane views

- `view/renderer.ts`: WebGL2, `antialias`, DPR ≤ 1.5, ~~AgX~~ **Neutral** tone mapping, sRGB
  output, PCF soft shadows (sun shadow-camera box follows the player), `info.autoReset = false`
  reset per frame.

  `CHANGED(integrator): tone mapping AgX → Neutral.` three r186's AgX has no "punchy" look and
  greys the toy palette. Measured in headed Chrome on the same painted spot at 1600×900: the
  SUNCREW dye averaged (204,147,115) under AgX and (234,125,66) under Neutral (teams.json dye is
  (255,138,31)); tiles went from grey to warm white. DESIGN's intent (toy-bright, saturated)
  wins. `?dev=1&tonemap=agx|neutral|aces|none` still switches it for comparison.
- `view/sky.ts` + `view/water.ts`: they apply a `LightingPreset` (sun direction from
  elevation/azimuth, hemi light, exp2 fog, gradient sky dome with sun disc and stylized clouds).
  Water is a large stylized sea plane at `waterY`, with fresnel, animated normals and sun glint.
- `view/paintlayer.ts`: a `PaintTexture` that owns a `THREE.DataTexture(S×S, RGBA8,
  LinearFilter, no mips, flipY false)`. The encoding is: R = 255 when SUNCREW, G = 255 when GULF
  CREW, B = `noise[id]`, A = 255 on surface/gutter texels. `upload(painter)` drains
  `takeDirty` into `addUpdateRange` + `needsUpdate`, and never re-uploads the whole atlas after
  the first frame.
- `view/surfaces.ts`: `materialFor(name, opts)` returns the stylized shader for an `M_*` name.
  Tile has grout and court lines in world space, the boardwalk has planks, chevrons and hazard
  have stripes, and so on. `applyDye(material, paintTexture, viewerTeam)` injects the dye layer
  through `onBeforeCompile`, sampling `uv1`: bilinear dye + noise threshold gives an organic edge,
  **friendly dye is glossy with a soft height bump**, and enemy dye is matte and sticky.
- `view/mapview.ts`: loads the map GLB with GLTFLoader and applies the prefix rules of §3.1.
- `view/heroview.ts`: `HeroView` clones the hero per player (SkeletonUtils), runs an
  `AnimationMixer` with locomotion blending (idle ↔ run by speed, run playback synced to speed
  via `df_run_stride`, jump/fall/land by vertical state) plus upper-body `brush` layered while
  brushing. It tints team materials and attaches the kit to `socket_weapon` with an identity
  transform. `frustumCulled = false` on skinned meshes.
- `view/camera.ts`: `FollowCamera`, with the numbers from `CAMERA`. Mouse yaw and pitch under
  pointer lock, a shoulder offset, a sphere-cast collision pull-in, and smoothing that never
  lags the pivot by more than ~0.15 s.
- `ui/hud.ts` (DOM, chunky style, fonts Lilita One + Nunito) shows:
  - a coverage bar (SUNCREW % vs GULF CREW %, with shape marks ◉ / ▲);
  - the minimap canvas (bottom-left);
  - the reticle plus a tank pipette (center);
  - a phase-2 hint line;
  - the **F1 debug panel**: coverage %, tank, map id, fps, swim/move state, atlas size and
    texel count, draw calls.
- `ui/boot.ts`: loading card → "CLICK TO PLAY" (pointer lock) → play. The error card shows the
  message and never leaves a blank canvas. After 2+ `pointerlockerror`s with no success it
  shows the "mouse capture blocked" message (doctrine §6).
- `game.ts` owns the fixed-step loop and `window.__PAUSE__ = { pause, resume, toggle }` (ESC
  pauses; the pause gates the step function itself). `input.ts` holds an action map
  (`move*/jump/fire/slick/sub/special/pause/debug/map`) ready for remapping.

### §5.2 Added in fix round 1 (APP lane; additive, no existing signature changed)
```ts
// view/renderer.ts — adaptive render resolution (ResolutionGovernor)
export type RenderQuality = 'auto' | 'high' | 'low';
export function createRenderer(canvas: HTMLCanvasElement, toneMap?: string /*'neutral'*/, quality?: RenderQuality /*'auto'*/): RendererRig;
// RendererRig gains setQuality(q), frame-time stats, and stats().scale. The pixel ratio floats
// between max(0.75, 0.6·DPR) and min(1.5, DPR). Decisions use the p90 frame time over 1 s
// windows, with hysteresis and undo-on-cost probes; nothing scales in the first 2 s of play.
// view/mapview.ts — loadMapView(loader, def, dye, onProgress?, options?: { mergeStatic?: boolean /*true*/ })
// Static solid_/deco_ meshes that share a material and layout are merged (never paint_,
// skinned, transparent or multi-material meshes). Small props outside the court don't cast shadows.
// game.ts — Game.settings.quality + Game.setQuality(q); query ?quality=auto|high|low; ?merge=0 disables merging.
```
Look harnesses pin `&quality=high` so a review shot is never taken at a reduced scale.
`_harness/perfcheck.py` (headless or headed) refuses to run while another automated Chrome is
alive, and marks a run CONTAMINATED if one appears. In headed runs, `bootcheck.py` uses an OS
foreground watch to tell focus theft by another window (NOTE + one real re-click) apart from a
game-caused pointer-lock loss (FAIL).

## §6 Test surface — `window.__DF__` (lane RUNTIME)

```ts
window.__DF__ = {
  version: string,
  state(): { phase: 'boot'|'loading'|'ready'|'play'|'paused'|'error'; mapId: string; tick: number; fps: number;
             player: { x: number; y: number; z: number; yaw: number; state: MoveState; grounded: boolean; tank: number; team: TeamId };
             coverage: Coverage; atlas: { size: number; count: number; overlaps: number }; error?: string },
  teamUnderFeet(): TeamId | null,
  paintHash(): string,
  flips(): number,
  shot(name: string): Promise<{ ok: boolean; path?: string }>,   // renders a frame → POST /__shot/<name>
  // dev-only (?dev=1):
  teleport(x: number, y: number, z: number, yaw?: number): void,
  splat(x: number, y: number, z: number, r: number, team: TeamId): number,
  start(): void,                                                  // skip CLICK TO PLAY (no pointer lock)
}
```
Query params: `?map=pier18`, `?dev=1`, `?preset=noon|golden`, `?seed=N`.

## §7 Gates (all must pass before a phase is called done)

| gate | command | pass |
|---|---|---|
| G0 types | `npm run typecheck` | 0 errors |
| G1 paint | `node _harness/probe_paint.ts` | exit 0. **Synthetic soup:** atlas area within 1 % of analytic; floor/wall weights; splat radius and facing filter (a thin wall is not painted through); incremental totals equal a full recount; gutter mirrors; `surfaceAt`/`teamUnder`; `hash()` identical across two runs. **`map_pier18.glb`:** atlas builds, `overlaps` ≤ 0.5 % of `count`, `totalArea` within 10 % of `df_paint_area`, a splat on the base deck 3 m ahead of `spawn_A` (along the spawn yaw, off the pad) makes `teamUnder` there `=== 1` (and the mirrored point by `spawn_B` → 2), a splat at `spawn_A` itself leaves the pad unpainted (`teamUnder(spawn_A) === null`), one splat < 2 ms |

`CHANGED(integrator): G1 map criterion.` The original text asked for "a splat at `spawn_A` makes
`teamUnder(spawn_A) === 1`". That contradicts §3.1 and `maps.json → brushKinds.spawnpad` ("NOT
paintable"): `spawn_A` is the top centre of the 2.2 m `solid_pad_A`, and the nearest paintable
floor texel on Pier 18 is 2.2 m away, beyond `teamUnder`'s 0.35 m. The data rule wins. G1 now
tests the gate's intent (dye near spawn reads back as SUNCREW) on the base deck just off the pad,
and asserts the pad itself stays unpaintable. G4 likewise moves the runner off the pad (the real
`W` hold) before its LMB / `teamUnderFeet` / minimap checks. Phase 3 note: a runner standing on
its own pad therefore has no dye underfoot. If SLICK/refill should work on the pad, phase 3 must
add an explicit "own pad counts as own dye" rule in the sim, not make the pad paintable.
| G2 move | `node _harness/probe_move.ts` | exit 0. On `map_pier18.glb` with Rapier in Node: walk forward 3 s from spawn A (> 12 m, stays on the deck); walk down a base ramp to y ≈ 0; walk up a side ramp onto a side deck (y ≈ 2.0); jump apex 1.1–1.5 m; walking off the pier edge ends below `killY` and respawns |
| G3 art | `python art/build.py check` | RESULT: OK |
| G4 boot | `python _harness/bootcheck.py` | **BOOTS CLEAN:** 0 console/page errors, 0 shader errors, 0 failed requests; reaches `play`; a real `W` hold moves the runner > 3 m; a real LMB hold makes `teamUnderFeet() === 1` and `coverage.sun > 0`; the minimap pixel under the runner is SUNCREW; screenshots saved |
| G5 look | vision review of `_shots/*.png` + `art/renders/*.png` (in-game inputs: `python _harness/lookshots.py` → `_shots/int_*.png`, 1600×900 headed, real W+LMB trail, F1 fps at spawn) | the hero reads as a toy-bright kid athlete (not a capsule); Pier 18 reads as a harbor sports court; dye visibly glossy under the feet |

## §8 Lanes and file ownership

| lane | owns |
|---|---|
| **PAINT** | `runtime/src/core/{rng,glb,mapgeo}.ts`, `runtime/src/core/paint/*`, `_harness/probe_paint.ts` |
| **MAP** | `art/blender/common.py`, `art/blender/build_map.py`, `art/blender/deco_assets.py`, `art/gltf/map_*.glb`, `art/renders/map_*` |
| **HERO** | `art/blender/build_hero.py`, `art/blender/build_kits.py`, `art/gltf/tide_runner.glb`, `art/gltf/kit_*.glb`, `art/renders/hero_*`, `art/renders/kit_*` |
| **LOOK** | `runtime/src/view/{sky,water,surfaces,paintlayer}.ts` |
| **APP** (a.k.a. RUNTIME) | `runtime/index.html`, `runtime/src/{main,game,input,testsurface}.ts`, `runtime/src/core/{config,physics,player}.ts`, `runtime/src/view/{renderer,mapview,heroview,camera}.ts`, `runtime/src/ui/*`, `_harness/{common.py,bootcheck.py,probe_move.ts}` |
| orchestrator | this file, `DESIGN.md`, `README.md`, `package.json`, `tsconfig.json`, `vite.config.ts`, `data/*`, `art/build.py`, `runtime/src/core/{types,data}.ts` |


---

# PART II — phases 3–5 (swim / MIST-RASP / 3:00 match with 7 bots)

## §10 Match simulation (THREE-free, deterministic, runs in node)

### §10.1 Rules, from the brief and DESIGN §4 (numbers live in `config.ts` / `data/*.json`)
- **Movement states:**
  - WALK on neutral dye.
  - SLOG on enemy dye: 2.0 m/s, jump 3.8, **cannot slick**, no refill.
  - SLICK: SHIFT held on own dye. 8.4 m/s, jump 7.0, capsule shrinks, tank refills 36 %/s, no firing.
  - WALL-SLICK: SHIFT held while pushing into an own-dyed wall (the texel at the contact within
    0.5 m). Climbs at 5.2 m/s with gravity off, and pops onto the ledge at the top. A wall losing
    its dye under you drops you.
  - AIR.
  - Releasing SHIFT surfaces in ~0.12 s.
  - Neutral and enemy dye never refill; there is **no passive regen**.
- **Own spawn pad counts as own dye** (slick and refill work on it). An **enemy** entering your
  pad radius is pushed back out (no spawn camping).
- **Hidden:** a SLICK runner who is not moving faster than 1.5 m/s is invisible to enemy bots
  beyond 3 m. The view shows enemies the same way (only a faint ripple). Moving slickers leave a
  wake that is visible at any range.
- **Tank 0–100.** Firing with too little tank does not fire: it emits a `dry` event with a
  click, no paint, no damage, and a 0.25 s cooldown. At tank ≤ 20 % the `tankLow` event fires
  (once per dip).
- **HP 100**, with no regen for 1.2 s after taking a hit, then +40 HP/s. At 0 HP the runner is
  WASHED: a `washed` event naming the attacker (or the sea / a sub / a special), then
  `respawnSeconds` (3) dead, then a respawn at the team pad with a tank of 100. Falling below
  `killY` is WASHED with cause `sea`. **No friendly fire.**
- **MIST-RASP (phase 4):** `data/weapons.json` kits[mist-rasp].fire. The tank cost applies per
  shot. A projectile flies straight for `straightTime`, then falls with `gravity`; it has a
  spread cone (wider while airborne). On impact with the map it splats `impactRadius` at the hit
  point with the hit normal; drips paint `dripRadius` every `dripEvery` s under the flight path
  (a raycast down). A hit on a runner capsule (radius 0.42 m, height 1.2 m; SLICK capsule
  0.5 m tall) deals `damage` and splats a small puddle under the victim. Projectiles are swept
  per tick (a segment test vs the map through Rapier, and segment vs capsule for runners), so
  nothing tunnels.
- **Match:** a `countdownS` (3 s) countdown with inputs frozen, then `live` for 180 s, then
  `ended`. `horn` events at start, at 60 s left, at 10 s left (the final countdown) and at the
  end. The result is the weighted coverage per team (`Painter.coverage()`); the winner is the
  larger share, with a strict comparison (equal = draw). No input is accepted after the end.

### §10.2 Modules and exact signatures
```ts
// core/match/roster.ts
export type BotSkill = 'chill' | 'fresh' | 'fierce';
export interface RosterEntry { id: number; name: string; team: TeamId; kit: string; bot: boolean; skill: BotSkill }
/** id 0 = the human on SUNCREW; ids 1-3 SUNCREW bots; ids 4-7 GULF CREW bots. Names are drawn
 *  deterministically from an ORIGINAL pool (never Suki/Coral/Kelp/Juno/Riptide/Zest/Inky Vee or
 *  any Nintendo name), e.g. Brine, Pip, Marlo, Tully, Sable, Wren, Dune, Quill, Skerry, Fathom,
 *  Lark, Moss, Bex, Rook, Tamsin. */
export function defaultRoster(o: { humanKit: string; humanName?: string; seed: number; skill: BotSkill; botKits?: string[] }): RosterEntry[];

// core/match/events.ts
export type MatchPhase = 'countdown' | 'live' | 'ended';
export type SimEvent =
  | { t: 'shot'; pid: number; kit: string; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { t: 'dry'; pid: number }
  | { t: 'splat'; x: number; y: number; z: number; r: number; team: TeamId; nx: number; ny: number; nz: number; flips: number }
  | { t: 'hit'; victim: number; by: number; dmg: number; x: number; y: number; z: number }
  | { t: 'washed'; victim: number; by: number | null; cause: 'dye' | 'sea' | 'sub' | 'special' }
  | { t: 'respawn'; pid: number }
  | { t: 'slick'; pid: number; on: boolean; wall: boolean }
  | { t: 'jump'; pid: number }
  | { t: 'land'; pid: number; hard: boolean }
  | { t: 'tankLow'; pid: number }
  | { t: 'special'; pid: number; id: string; phase: 'ready' | 'start' | 'end'; x: number; y: number; z: number }
  | { t: 'sub'; pid: number; id: string; phase: 'throw' | 'land' | 'pop'; x: number; y: number; z: number }
  | { t: 'horn'; kind: 'start' | 'minute' | 'final10' | 'end' }
  | { t: 'phase'; phase: MatchPhase };

// core/runner.ts  (replaces core/player.ts's Player; keep player.ts as a re-export shim until nothing imports it)
export class Runner {
  readonly id: number; readonly name: string; readonly team: TeamId; readonly side: Side; readonly kit: string; readonly bot: boolean;
  x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number;   // feet, velocity, body yaw
  px: number; py: number; pz: number; pyaw: number;                                    // previous tick (interpolation)
  aimYaw: number; aimPitch: number;                                                    // current aim (view: upper body + kit)
  state: MoveState; grounded: boolean; tank: number; hp: number; alive: boolean; respawnT: number;
  hidden: boolean;          // SLICK + still-ish (see §10.1): enemies can't see beyond 3 m
  special: number;          // 0..1 meter (phase 6 uses it; phases 4-5 fill it per specialCharge)
  firing: boolean;          // fired this tick or holding fire with tank (view: aim pose + muzzle FX)
  lastAttacker: number;     // runner id or -1
  lastHitT: number;         // seconds since last damage taken
  washes: number; washedCount: number; painted: number;   // stats (painted = weighted m²)
  landings: number; jumps: number;                          // counters the view watches
}

// core/combat/projectiles.ts
export class ProjectilePool {           // struct-of-arrays, fixed capacity (512), no per-shot allocation
  count: number;
  x: Float32Array; y: Float32Array; z: Float32Array; px: Float32Array; py: Float32Array; pz: Float32Array;  // current + previous tick
  team: Uint8Array; kind: Uint8Array; owner: Int16Array;   // kind 0 = MIST-RASP droplet (phase 6 adds kinds)
}

// core/match/world.ts
export interface MatchOptions {
  def: MapDef; geo: MapGeometry; physics: PhysicsWorld; painter: Painter; roster: RosterEntry[];
  seed: number; durationS?: number /*180*/; countdownS?: number /*3*/;
}
export interface MatchResult { sun: number; gulf: number; neutral: number; winner: TeamId }
export class MatchWorld {
  readonly runners: Runner[]; readonly projectiles: ProjectilePool; readonly painter: Painter; readonly physics: PhysicsWorld;
  readonly def: MapDef; readonly seed: number;
  phase: MatchPhase; tick: number; timeLeft: number; countdown: number; result: MatchResult | null;
  constructor(o: MatchOptions);
  /** advance exactly one TICK. intents[i] belongs to runners[i] (human and bot alike). */
  step(intents: readonly PlayerIntent[]): void;
  /** move queued events into out (append); returns the count. */
  drainEvents(out: SimEvent[]): number;
  onOwnPad(r: Runner): boolean;
  /** can `viewer` currently see `target` (alive, not hidden beyond 3 m, line of sight via physics raycast) */
  canSee(viewer: Runner, target: Runner): boolean;
  hash(): string;     // painter.hash() + runner states → determinism probes
}

// core/bots/nav.ts
export interface NavGraph {
  nodes: number;
  x: Float32Array; y: Float32Array; z: Float32Array;   // node positions (walkable floor points, ~1 m grid, multi-level)
  edgeStart: Int32Array; edgeTo: Int32Array; edgeCost: Float32Array; edgeKind: Uint8Array; // CSR; kind 0 walk, 1 drop, 2 jump, 3 wall-slick climb
  nearest(x: number, y: number, z: number): number;          // node id or -1
  path(from: number, to: number, out: number[]): boolean;     // A*, deterministic tie-breaks
}
export function buildNav(geo: MapGeometry, physics: PhysicsWorld, def: MapDef): NavGraph;

// core/bots/director.ts
export class BotDirector {
  constructor(world: MatchWorld, nav: NavGraph, seed: number);
  /** fill intents[i] for every bot runner i (humans untouched). Bots think on their own clock (~10 Hz)
   *  with per-bot mulberry32 streams; reaction delay + aim jitter by skill (doctrine §2 fairness). */
  think(intents: PlayerIntent[]): void;
}
```

### §10.3 Bot behavior (acceptance, measured by `_harness/probe_bots.ts`)
- **Paint-hungry:** a bot picks the goals with the most neutral or enemy floor area nearby,
  sampled from the atlas, not random wandering. It sweeps fire across the floor while moving.
- **Peeks cover:** it holds behind crates and walls when an enemy is visible and out of range,
  and strafes when engaged.
- **Flees when tank < 20 %:** it goes to the nearest own dye (or its pad), slicks and refills,
  then returns.
- **Chases its last attacker for ~2 s**, then gives up.
- **Uses SLICK** to travel through its own dye.
- **Fairness:** reaction delay 300–800 ms by skill, aim jitter ~0.018 rad × a skill factor, and
  it rolls its reactions once per stimulus.
- **Deterministic:** the same seed gives the same `world.hash()` after a full match.
- **Probe gates:** a full 180 s 8-bot match (the human slot is a bot too) on Pier 18, run
  headless in node, must show:
  - both teams cover > 15 %, the neutral share < 55 %, and ≥ 6 washes in total;
  - no bot stuck (displacement < 1 m over any 6 s window while alive and not deliberately
    holding);
  - ≥ 20 slick entries in total and ≥ 4 refills from < 20 %;
  - an identical hash across 2 runs with the same seed and different hashes with different
    seeds;
  - the whole match simulates in < 20 s of wall time.

## §11 View / app for phases 3–5 (`three` + DOM)

- `view/players.ts` shows 8 runners from one `HeroAssets`. The runtime **merges each hero's
  primitives into one skinned geometry**: vertex color from the material colors, plus a
  per-vertex team-mask attribute; one custom `MeshStandardMaterial` with a team-color uniform. So
  each runner is ≤ 2 draw calls (body, plus the kit if it is not merged).
  - Interpolated pose; locomotion and upper-body layers as in phase 2 (`aim` while firing).
  - SLICK: the body is hidden and `slick_fin` is shown with a dye ripple/wake. Enemies' hidden
    slickers are drawn as a faint ripple only.
  - Name tags above allies always and above enemies only when visible.
  - WASHED: a dye burst, then the body is hidden until respawn. Respawn is a tide-spout drop onto
    the pad (~0.6 s).
- `view/fx.ts`: instanced projectile droplets (one draw call), splat particles (pooled instanced
  quads), hit sparks, muzzle mist, the dry-click puff, slick splash rings and wakes, and the
  washed burst. There are no per-event allocations; each pool has a fixed size.
- `view/camera.ts`: SLICK tucks the camera (`slickPivotY`, `slickDistance`), with a smooth blend.
- **HUD, from the brief's rhythm.** Use ONLY the brief's strings for these UI elements.
  - A top-center **timer pill** (3:00 → 0:00, pulsing in the final 10).
  - **4 + 4 crests** (◉ / ▲ shapes in team color; a downed crest shows ✕ plus its respawn
    count).
  - A top-right **special gauge**.
  - A **kill feed** top-right using exactly `{A} washed {B}`. A sea death shows `{B}` with a wave
    icon.
  - The reticle plus the **tank pipette**.
  - The low-tank toast **`Tank low — hold SHIFT on your color to drink`**.
  - The death slate **`WASHED BY {name}`** with a 3 s countdown ring. A sea death shows the wave
    icon and "the sea".
  - A countdown `3 · 2 · 1`.
  - The victory slate **`THE HARBOR CHOSE A COLOR.`** with both percentages and the winning
    crew's mark.
  - The minimap with ally dots and seen-enemy dots.
- `game.ts` owns a `MatchWorld` and a `BotDirector`. Human input becomes `intents[0]`, with the
  aim point from a camera raycast (`physics.raycast` from the camera through the reticle, max
  60 m). The bots fill the rest. It drains events into fx / players / hud every frame.
  Queries: `?kit=`, `?bots=chill|fresh|fierce`, `?seed=`, `?matchSeconds=` (dev only), and
  `?autostart=1` (skip to the match).
- `window.__DF__` additions: `match()` (phase, timeLeft, runners[] {id, name, team, state, hp,
  tank, alive, x, y, z, hidden}, result, coverage) and `events(n)`. Dev-only extras:
  `setTimeLeft(s)`, `damage(pid, n)`, `setTank(pid, v)`.

## §12 Gates for phases 3–5
| gate | command | pass |
|---|---|---|
| G6 swim | `node _harness/probe_swim.ts` | SLICK only on own dye or own pad; speed ≈ 8.4; refill from 0 to 100 in 2.6–3.0 s; SLOG ≈ 2.0 on enemy dye; wall-slick climbs an own-dyed side-deck wall to the deck top (y ≈ 2.0) and cannot climb an undyed or enemy-dyed one; releasing SHIFT surfaces; hidden rules |
| G7 combat | `node _harness/probe_combat.ts` | MIST-RASP: rate 8.5 ± 0.5/s; tank drops 0.9/shot; an empty tank dry-clicks (no projectile, no paint); impact splats at the hit point; drips land; 3 hits wash (34 × 3 ≥ 100); no friendly fire; no tunnelling through a 0.6 m wall at point blank; respawn after 3 s at the pad with a full tank; the sea washes |
| G8 bots | `node _harness/probe_nav.ts && node _harness/probe_bots.ts` | §10.3 |
| G9 match (browser) | `python _harness/playtest.py` | real keys and mouse in headed Chrome: countdown → live; the human shoots and dyes; slicks in own dye and refills; the HUD crests/timer/tank update; bots move and fight; a dev `?matchSeconds=20` match reaches the victory slate with sane percentages; 0 errors; fps logged |
| G0–G5 | as before | still green |

## §13 Lanes for phases 3–5
| lane | owns |
|---|---|
| **SIM** | `core/runner.ts`, `core/player.ts` (shim), `core/config.ts`, `core/physics.ts`, `core/match/*`, `core/combat/*`, `_harness/probe_swim.ts`, `probe_combat.ts`, `probe_move.ts` (update for Runner), `probe_match.ts` |
| **BOTS** | `core/bots/*`, `_harness/probe_nav.ts`, `probe_bots.ts` |
| **FRONT** (view + app) | `runtime/src/{main,game,input,testsurface}.ts`, `view/{players,fx,camera,heroview,renderer,mapview}.ts`, `ui/*`, `_harness/{common.py,bootcheck.py,playtest.py,lookshots.py,perfcheck.py}` |
| LOOK (unchanged owner) | `view/{sky,water,surfaces,paintlayer}.ts` (FRONT may call `surfaces.ts` exports; changes to it go through the integrator) |
