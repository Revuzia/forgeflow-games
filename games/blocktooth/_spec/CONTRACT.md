# BLOCKTOOTH — Build Contract

Read §0 and your lane's sections before writing a line. Shared code that already exists
and is **owned by the orchestrator** (do not edit; propose changes in your report instead):
`src/core/types.ts`, `src/core/config.ts`, `src/core/rng.ts`, `src/core/math.ts`,
`src/core/world.ts`, `src/render/viewtypes.ts`, this file.

---

## §0 Lane rules (every agent)

1. **Own only your files** (§16). Never create or edit a file another lane owns. If you need
   something from another lane, code against the export named in §5/§6 and note the
   dependency in your report. If the contract is missing something you need, add a clearly
   marked local helper inside YOUR files and report it as a contract gap.
2. **TypeScript, erasable syntax only**: no `enum`, no `namespace`, no constructor parameter
   properties, no decorators. Imports use explicit `.ts` extensions
   (`import { clamp } from '../core/math.ts'`). Type-only imports use `import type`.
   (Sim files must run under plain `node` with type stripping — Node 22.20 here.)
3. **Sim is THREE-free and deterministic** (`src/core`, `src/city/citygen.ts`,
   `src/city/citysim.ts`, `src/city/traffic.ts`, `src/titans/titansim.ts`, `src/titans/kits/*`,
   `src/combat/*`, `src/ai/enemies.ts`, `src/ai/director.ts`, `src/ai/bosses/*` except views,
   `src/upgrades/*`, `src/data/*`). No `three` import, no DOM, no `Math.random`, no clocks.
   Randomness only from `world.rng.<stream>`. Views/UI/audio may use `Math.random` for cosmetics.
4. **Typecheck** your files: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/<your paths>"`.
   Errors that are only "Cannot find module" for another lane's not-yet-written file are
   expected during the parallel build; every other error in your files must be zero.
   **`node --check` is NOT a gate** (it passes broken ESM). For sim files also run a node
   probe that imports your module (`node -e "import('./src/x/y.ts')"` or a scratch probe).
5. **Lane scratch previews (visual lanes)**: you MAY look at your own work. Put a page at
   `_harness/scratch/<lane>/index.html` that imports ONLY your modules + `three` + orchestrator
   files, serve with `npx vite --config _harness/scratch/vite.scratch.config.ts --port <yours>
   --strictPort` (run it in the background; kill it when done), and capture with
   `python _harness/scratch/snap.py <url> _shots/scratch_<lane>_<n>.png --wait 8` (headless
   Chrome on the real GPU; set `window.__SNAP_READY__ = true` after a few frames). Then READ the
   PNG and judge it harshly. Ports: render-core 5181, city-kit 5182, titan-view 5183,
   foes-view 5184, combat-view 5185, fx 5186, ui 5187, city-view 5188.
6. **No primitive hero assets.** Titans, enemies, bosses, vehicles are MULTI-PART low-poly
   anatomy with real (procedural) animation — never a lone cube/sphere/capsule standing in for
   a character. Buildings/props are procedural kitbash geometry (allowed by doctrine behind the
   visual gate). "Faceted low poly" = custom BufferGeometry / merged parts with flat normals and
   painted vertex colours, NOT default `BoxGeometry` people.
7. **Performance is a feature**: instancing for anything repeated, merge static parts, no
   per-frame allocation in hot loops (reuse scratch vectors/arrays), never add/remove THREE
   lights after first render (fixed light pool), no per-frame `new THREE.*`.
8. Report honestly: what you built, what you verified (paste the command + output tail), what
   is stubbed, and every contract gap. A stub must be named as a stub.

---

## §1 IP lock (originality is a hard requirement)

BLOCKTOOTH is an original IP. **Forbidden anywhere in code, copy, or asset names:** any
existing kaiju/film/game proper noun or silhouette — Godzilla, Gojira, Kong, Gamera, Mothra,
Rodan, Ghidorah, Mechagodzilla, Anguirus, Ultraman, Jaeger, Pacific Rim, Rampage (the game's
characters George/Lizzie/Ralph), Kaiju No. 8, Colossal Kaiju Combat, Dawn of the Monsters, any
real TV network/callsign (NHK, CNN, BBC, Fox…), and any survivor-like upgrade name from
Vampire Survivors / Brotato / Halls of Torment / Hades / Risk of Rain (e.g. "Spinach",
"Hollow Heart", "Empty Tome", "Clover", "Attractorb", "Candelabrador"). "Kaiju" as a genre word
is allowed in docs only, never on screen. No upright dinosaur-with-dorsal-plates silhouettes:
MOLO is a LOW, SPRAWLING quadruped monitor. Every boss is a MACHINE, never a monster (owner rule
2026-09-29): IRON GULLY is a HALVARD snow-clearance walker (a road gritter + V-plough on four
crab-splayed hydraulic stamp legs: V-plough, blower turret, grit hopper, spreader spinner), low and
wide with no neck, never the famous tall snow-walker silhouette.

**Name bible (use exactly these):**

| Thing | Name | Notes |
|---|---|---|
| Game | **BLOCKTOOTH** | "You eat the street. You outgrow the block." |
| Network | **WARD-7** ("Ward Seven Municipal Alert") | bug: `WARD-7 • LIVE` |
| Open slate | `UNIDENTIFIED MASS — DOWNTOWN GRID` (GRID-EAST) · `UNIDENTIFIED MASS — WHITE STACKS` · `UNIDENTIFIED MASS — LOCKWATER` | freeze-frame lower third |
| Size-up sting | `MASS BREACH` | + sub-line per rank (§12) |
| Run-end tabloid | `THE CITY GOT SMALLER.` | masthead: **THE WARD SEVEN WITNESS** |
| Titan 1 | **MOLO** — squat jade monitor, sawtooth back-fin | SMASH TANK |
| Titan 2 | **VOLT-KITE** — charged raptor-cat under twin kite sails with a static crest (v4 model, owner feedback 3; the `data/titans.ts` species string; was the TITAN PASS storm-hound drake, before that a lean indigo jackal-drake) | CHAIN ASSASSIN |
| Titan 3 | **HEARTHBACK** — walking caldera, obsidian dome shell | ERUPTION FORTRESS |
| Titan 4 | **BRIARWICK** — horned garden-beast, seed ruff | AREA CONTROL |
| Biome 1 | **GRID-EAST** — daytime commercial blocks, zebra crossings, toy traffic | boss CAISSON-4 |
| Biome 2 | **WHITE STACKS** — snowed industrial park, dishes, tanks | boss IRON GULLY |
| Biome 3 | **LOCKWATER** — flooded container port at night | boss CAISSON-4 |
| Boss A | **CAISSON-4** — four-legged harbor crane-mech | meter **STRAIN** |
| Boss B | **IRON GULLY** — HALVARD SNOW-CLEARANCE WALKER: V-plough, blower turret, grit hopper, spreader spinner, four stamp legs | meter **FRACTURE** |
| Enemies | CROSSING WARDEN (android) · PICKET SQUAD · GNAT (drone) · HOPPER (buggy) · BULWARK (APC) · TORTOISE (tank) · STILT MORTAR (walker) · RAMROD (elite breach-dozer) | contractor: **HALVARD CIVIL DEFENSE** |
| Tabloid masthead | THE WARD SEVEN WITNESS | |

Tone: Saturday-morning monster comic + a panicking municipal news desk. Deadpan civic
language ("ZONING NO LONGER APPLIES", "RESIDENTS ADVISED TO BE ELSEWHERE"). No gore: stepped-on
things puff into dust, bolts and springs.

---

## §2 Conventions

* 1 unit = 1 m. Y up. Sim is planar XZ. Ground is y = 0 everywhere (no terrain).
* **Heading θ** → direction `(sin θ, cos θ)`; θ = 0 faces +Z. Models are authored FACING +Z,
  so `object.rotation.y = heading` is always correct. Use `headingOf(dx,dz)` from core/math.
* Camera yaw 45°: the camera sits at +X+Z of its target looking toward −X−Z. Screen-up in
  world = (−0.707, −0.707). Input conversion is `screenToWorld()` in config.ts (constant yaw).
* Sim ticks at 30 Hz (`SIM_DT`). Views interpolate with `alpha`. All entity records carry
  `px/pz/pheading` (set by world.ts at tick start).
* Entity ids come from `newId(w)` (core/world.ts). Views track entities by id (Map), never by
  array index — world.ts compacts arrays every 30 ticks.
* Events (`SimEvent`) are the only sim→view channel besides reading state.
* Titan-relative sizes: radii/ranges of titan abilities are expressed in **titan heights (H)**
  and multiplied by `titan.height` at use time, so every kit scales with growth automatically.
* Titan damage numbers are **base numbers** multiplied by `titanDamage(w, base)` (combat/damage.ts)
  = base × `RANKS[rank].dmgMul` × `stats.damage` × active frenzy buffs.

---

## §3 Size ranks & growth

**SIZE is driven by LEVEL** (2026-09-24, owner feedback: "the monster grows as it levels up"). XP is the
one progression currency: every level-up makes the body bigger, and reaching `RANK_LEVELS[r]` is the
**MASS BREACH** into Size r. `src/core/config.ts` is the source of truth (economy table at its top); this
table mirrors it.

| Rank | reached at LV | H on entry → last level (m) | per-level step | hp× | dmg× | flattens on contact | auto camera D, first → last level (m) | pitch |
|---|---|---|---|---|---|---|---|---|
| I | 1 | 1.2 → 2.66 | +17 % | 1.0 | 1 | tier 0 (cars, kiosks, hydrants, lamps, trees) | 49.8 → 38.2 | 54° |
| II | 7 | 5 → 9.89 | +8.9 % | 1.8 | 3 | ≤1 (shops, buses, trucks, containers) | 133 → 109 | 54° |
| III | 16 | 14 → 24.2 | +5.6 % | 3.2 | 8 | ≤2 (midrise corners, sheds, tanks) | 307 → 251 | 54° |
| IV | 27 | 32 → 47.3 | +5.7 % | 5.5 | 20 | ≤3 (office blocks, towers) | 519 → 464 | 54° |
| V | 35 | 60 → 63.5 → 67.2 (2 levels) | +5.8 % | 9.0 | 45 | ≤4 (megatowers) + fights bosses | 533 → 557 | 54° |

* `titan.height` tweens toward `titanHeightAt(rank, level)`: geometric from `RANKS[r].height` toward
  `RANKS[r+1].height ÷ BREACH_JUMP[r+1]` across the rank's levels; the breach level is one more step
  × `BREACH_JUMP` (→ II ×1.88 · → III ×1.42 · → IV ×1.32 · → V ×1.27). Size V grows `RANK_V_GROWTH` 12 %
  over `RANK_V_GROWTH_LEVELS` 2 more levels. A level-up tweens over `LEVEL_GROW_S` 0.45 s, a rank-up over
  `GROW_TWEEN_S` 0.9 s (easeOutBack); a running breach tween is never cut short. `radius = height × 0.42`.
* **XP** comes from pickups (rubble/scrap/chests). `gainXp(w, xp)` applies `stats.xpGain` ×
  `stats.massGain` (the "growth XP" stat) × the kit multiplier (MOLO vacuum 1.25) × the pacing rubber
  band `paceMul`: catch-up × `min(CATCHUP_MAX, 1 + CATCHUP_PER_MIN × minutesBehind)` once `w.t` passes
  `RANK_SCHEDULE_S[rank+1]`; for the Size V breach only, a pace governor × `max(AHEAD_MIN, 1 −
  AHEAD_PER_MIN × minutesEarly)` when the projected breach is more than `AHEAD_GRACE_S` early.
  `xpToNext(level)`; each level-up increments `upgrades.pendingDrafts`, emits `levelUp` and steps the
  body up; crossing `RANK_LEVELS[r]` emits `rankUp` and recomputes stats (`recomputeStats`) — maxHp
  scales by hp×, current hp keeps its ratio then +15 % heal. The upgrade action `'mass'` ("grow") is
  `gainGrowth(w, frac)`: exactly `frac` of the current level's XP bar.
* **Mass is retired.** Loot still carries `mass` (it sizes the pickup meshes and splits scrap into
  chunks); `gainMass` is a no-op kept for the pickup lane; `titan.mass` is written every tick as a
  legacy mirror of SIZE progress (`sizeMassMirror`). Views read `sizeProgress(rank, level, xp)` and
  `levelsToNextSize(rank, level)` — nothing reads `titan.mass` for size.
* **Flatten rule**: a building/prop with `tier ≤ RANKS[rank].canFlatten` is smashed by contact
  while `speed ≥ SMASH_MIN_SPEED_FRAC × maxSpeed` (and always during a dash), and does not block
  movement (the titan plows through at `SMASH_SLOW` speed). `tier > canFlatten` BLOCKS movement
  (circle push-out) and takes only `OVERSIZE_DAMAGE_MUL` (25 %) from attacks — the titan can
  still chew the bottom floors and pancake it slowly. First bump into an oversized tier emits
  `bump` (camera nudge + "too big" beat).
* Contact smash DPS against flattenable buildings = `TIERS[canFlatten].floorHp × 6 × stats.smashDamage`
  per second (a matched-tier floor pops every ~0.17 s; smaller things pop instantly).
* **Crush**: enemies with `crushable` and `height < titan.height × CRUSH_RATIO` whose circle
  overlaps the titan while it moves are killed instantly (`enemyKilled.crushed = true`).
* Level-up presentation: grow tween + squash-and-stretch pop + a cream ground ring (0.45H → 1.9H);
  the HUD GROW bar (`sizeProgress`, one notch per level of the Size) pulses.
* Rank-up presentation: sim tween + `rankUp` event → camera punch + pull-back to the new Size's
  framing, full-width `MASS BREACH` banner, ground shockwave ring, roar + news sting, app hit-stop 0.25 s.

## §4 Camera (config.ts owns the formula; render/camera.ts springs toward it)

```
k      = 2·tan(fov/2),  fov = 30°
D*(H): ln D* = ln D1 + κ1·x + c·x², x = ln(H / h1)       // cameraDistance() in config.ts (FRAMING)
         ONE run-long curve (no per-rank term): h1 = 1.2 m, frac1 = 0.066, κ1 = 0.573, hV = 60 m,
         fracV = 0.20; D1 = h1 / (frac1·k) = 33.9 m; c = (ln(hV / (fracV·k) / D1) − κ1·xV) / xV² = 0.0367.
         Local exponent κ(H) = κ1 + 2c·x: 0.573 at LV 1 → 0.86 at Size V, asserted in (0, 1) at load.
         Analytic share H/(D*·k): 6.6 % at LV 1 → 20 % at the Size V entry. On screen (live camera,
         zoom 1): foot→head 3.9 % → 11.9 % (12.0 % at LV 36); SILHOUETTE (every posed body vertex, 4
         headings) VOLT-KITE 9.3 % → 28.2 %, MOLO 13.5 % → 40.7 %.
         D* is non-decreasing in H and the share rises at every level and every MASS BREACH (the body
         jumps × BREACH_JUMP, the camera follows the same curve and pulls back less): the camera never
         moves in as the titan grows. (Replaced 2026-09-24: per-rank startFrac/endFrac framing made each
         breach a sawtooth — 2.9–3.5× pull-back for a 1.3–1.9× body — and eased IN inside a rank; a
         single κ = 0.573 then left the Size V silhouette at ~47 % (VOLT-KITE) / ~70 % (MOLO) of the
         screen, so the slope now eases up with size while Size I — and the spawn ring — stay put.)
frame  = frameDistance(w) = max(D*, director.data.bossFrameD while a boss is alive)
         BOSS FRAMING (config bossFrameNeed / BOSS_FRAME, held by ai/director.ts): the smallest distance
         (D* … 2·D*) and look-target offset (frameOffset) that keep the boss rig, every live boss-owned
         telegraph and the titan inside the default-zoom frame — below ndc y 0.58 (the boss nameplate),
         × 1.12 margin elsewhere — projected exactly through the rig's camera; the offset slides toward
         the fight's centre only when the curve's view centred on the titan cannot hold it. HELD with
         hysteresis (config stepFrameHold — generic, gatekeepers/minibosses reuse it; a post-kill floor
         rides its `floor` argument): widened at once; shrunk only after holdS 3.5 s in which no need used
         ≥ 20 % of the extra width (each re-widen that interrupts a shrink adds 4 s to the hold, ≤ 20 s;
         a full release resets it), then slowly (≤ 2.5 % of D per second, eased in / out); the offset
         eases toward the need's at 3.5/s while the width is needed, holds through the hold, eases home
         at 0.8/s after it (and the rig smooths it at 5/s).
D     ← critically-damped spring toward frame, ω = 4/s   // x'' = ω²(frame−x) − 2ω x'
         while a boss is alive: widening at ω = 9/s (CAMERA.widenOmega), and never under the boss HARD
         FLOOR (config bossFrameFloorAt): the boss rig, every live boss tell and the titan inside |ndc|
         0.95 around the look target the rig actually has, refitted every rendered frame — a tell never
         leaves the frame, not even on the frame it spawns (the view steps out on that frame instead).
         The floor also binds the drawn D through a punch at the default zoom (not a player zoom-in).
         The director's replica of the rig (camD, for spawnView) mirrors the widen rate and the floor.
zoom   : player multiplier on D (view-only; the sim never reads it): wheel notch ±0.12 ln, '=' / '-'
         (numpad + / −) held 1.35 ln/s, gamepad right stick 1.5 ln/s, Z / R3 reset; ln-smoothed
         ω = CAMERA_ZOOM.omega 11/s; clamped to CAMERA_ZOOM.min 0.55 … max 2.0 and to
         dAbsMin 12 m ≤ D ≤ dAbsMax 880 m; kept through breaches, reset on a new run; ignored in 'ui' mode
punch  : on rankUp, D is multiplied by (1 − 0.08·(1 − easeOutCubic(τ/1.2))) for τ∈[0,1.2] s
target = titanPos(interp) + v·0.25 s + up·(H·0.45) + frameOffset   // lead smoothed (ω = 6/s); boss offset (ω = 5/s)
pitch  = lerp toward RANKS[r].pitchDeg = 54° at every Size (ω = 3/s)
yaw    = 45° fixed
camPos = target + D·(cos pitch·sin yaw, sin pitch, cos pitch·cos yaw)
near/far = cameraClip(D)  → near = max(0.1, 0.02D), far = 6D + 400   (D = the ACTUAL distance incl. zoom)
shake  : trauma model (amplitude² falloff 1.6/s); heavy footstep adds H·0.02·heavy, collapse
         adds per tier, boss slams add more; disabled by settings.screenShake
```
Worked numbers (auto, first → last level of each Size): D = 33.9→54.9 / 82.8→134 / 173→265 / 331→457 /
560→617 m; vertical view extent D·k = 18.2→29.4 / 44.4→71.7 / 92.7→142 / 177→245 / 300→331 m.
dAbsMax 880 m binds the zoom-out from LV 34 (Size V tops out at ≈ 1.4–1.6×; the whole district fits).
Boss framing at LV 37 (curve 617 m): only IRON GULLY's DOUBLE STAMP (`pawSlam`) widens (659 m); every other attack fits the curve.
Telegraph x-ray (render/telegraphview.ts): never drawn through the titan's own body volume (bind-pose
box in model space + 10 %, ray-tested per fragment) — the ground decal carries the warning there.
Every LOD / fog / shadow / traffic / civilian consumer follows the ACTUAL distance (`rig.distance`,
`FrameInfo.camDist`: zoom + punch included).
Shadow camera (lighting.ts): orthographic box centred on the look target, half-size
= 0.9·D·k·(aspect) clamped ≤ 860 m, depth = 3·D, re-fit every frame, texel-snapped to kill shimmer.
**Spawn ring** (sim, `ai/enemies.ts`): reads `spawnView` (config) = `frameDistance` + the boss offset,
with a director-side replica of the rig's distance spring and offset smoothing (a boss-framing release
leaves the rig wider than `frame` for a moment) — zoom excluded, deterministic. Candidates sit just past
the visible-ground edge in their direction (the 54°, 16:9 view footprint: near edge 0.52·D·k, far edge
0.77·D·k, half-widths 0.74 / 1.10·D·k, + 0.04·D·k; fliers + 7 m) × 1.00–1.08, are street-snapped, then
CHECKED through the default-zoom camera (`screenOut`: exact projection incl. the lead, point pulled 7 m
toward the titan, must be ≥ 1.03 ndc); of 8 candidates the NEAREST off-screen one wins; if none is, the
least-visible one walks outward along its street until it is. Nominal ring `ringRadius` = max(14, D·k);
recycled beyond 1.9 × the ring. BULWARK squads are dropped where their (on-screen) APC stands.
At the player's zoom-out the spawns are visible by design (the sim never reads the zoom): enemyview
pops them in (0.32 s easeOutBack) and fx answers `enemySpawn` with a dust kick + a thin ground ring,
only when the spawn point projects inside the view, at most 6 per frame.

---

## §5 Sim architecture (exact exports — the imports in `src/core/world.ts` are law)

### 5.1 World
`createWorld(opts)` / `stepWorld(w, input)` / `stepN` / `newId` / `NO_INPUT` live in
`src/core/world.ts` (orchestrator-owned). World fields: see `World` in types.ts.

### 5.2 Tick order (stepWorld)
`events cleared → snapshot prev poses → tick/t++ → stepCity → rebuildEnemyGrid → stepTitan →
stepDirector → stepEnemies → stepBoss → rebuildEnemyGrid → stepProjectiles → stepTelegraphs →
stepHazards → stepPickups → stepUpgrades → processTriggers → peakRank → checkRunEnd → compact/30`.
The run ends (sim stops) on titan death or boss defeat (`runEnd` event).

### 5.3 Module export table

| Module (lane) | Exports (exact) |
|---|---|
| `data/titans.ts` (titan-sim) | `TITANS: Record<TitanId, TitanDef>` |
| `data/biomes.ts` (city-sim) | `BIOMES: Record<BiomeId, BiomeDef>` |
| `data/enemies.ts` (ai) | `ENEMIES: Record<EnemyKind, EnemyDef>` |
| `data/bosses.ts` (ai) | `BOSSES: Record<BossId, BossDef>` |
| `data/upgrades.ts` (upgrades) | `UPGRADES: UpgradeDef[]`, `UPGRADE_BY_ID: Record<string, UpgradeDef>` |
| `data/strings.ts` (ui) | `STR` (see §12), `ALERTS: Record<AlertKey, {title: string; sub: string}>`, `TICKER: string[]`, `RANK_SUBS: string[]` (5), `BURST_WORDS: Record<string, string[]>` |
| `city/citygen.ts` (city-sim) | `generateCity(biome: BiomeDef, seed: number, rng: () => number): CityLayout` |
| `city/citysim.ts` (city-sim) | `stepCity(w)`, `buildingsInRect(city, minX, minZ, maxX, maxZ, out: number[]): number[]`, `propsInRect(city, minX, minZ, maxX, maxZ, out: number[]): number[]`, `damageBuilding(w, id, amount, opts: DamageOpts): number` (floors broken), `damageProp(w, id, amount, opts: DamageOpts): boolean` (destroyed), `resolveCircleVsCity(city, x, z, r, canFlatten: Tier, out: {x: number; z: number; bumpTier: number}): boolean` (true if pushed), `blockOf(city, x, z): number` (−1 outside), `buildingById(city, id): Building`, `nearestRubble(city, x, z, r, max: number, out: number[]): number[]` (ids of collapsed buildings) |
| `city/traffic.ts` (city-sim) | `stepTraffic(w)` (called by stepCity) |
| `titans/titansim.ts` (titan-sim) | `createTitan(def: TitanDef, spawn: {x,z,heading}): TitanState`, `stepTitan(w)`, `hurtTitan(w, dmg, kind: DamageKind, x, z): number` (dmg actually taken), `healTitan(w, amount): void`, `gainXp(w, xp): void`, `gainMass(w, mass): void`, `titanMaxSpeed(w): number` |
| `titans/kits/index.ts` (titan-sim) | `stepKit(w)`, `kitOnHurt(w, dmg): number` (returns dmg after kit absorption), `kitOnDash(w, x0, z0, x1, z1): void` |
| `titans/kits/{molo,voltkite,hearthback,briarwick}.ts` | each: `step(w)`, optional `onHurt(w, dmg): number`, optional `onDash(w, x0,z0,x1,z1)` |
| `combat/spatial.ts` (combat) | `rebuildEnemyGrid(w)`, `enemiesInCircle(w, x, z, r, out: Enemy[]): Enemy[]`, `enemiesInShape(w, s: Shape, out: Enemy[]): Enemy[]`, `nearestEnemy(w, x, z, r, filter?: (e: Enemy) => boolean): Enemy \| null`, `nearestEnemies(w, x, z, r, n, out: Enemy[]): Enemy[]` |
| `combat/damage.ts` (combat) | `titanDamage(w, base): number`, `rollCrit(w, dmg): {dmg: number; crit: boolean}`, `damageArea(w, s: Shape, dmg, opts: DamageOpts): number` (hits), `damageEnemy(w, e, dmg, opts): boolean` (killed), `killEnemy(w, e, crushed: boolean): void`, `damageTitanArea(w, s: Shape, dmg, kind): boolean` (hostile → titan; true if hit) |
| `combat/targeting.ts` (combat) | `type Target = {kind: 'enemy', e: Enemy} \| {kind: 'boss', part: number} \| {kind: 'building', id: number} \| {kind: 'prop', id: number}`; `findTarget(w, x, z, range, preferEnemies = true): Target \| null`; `targetPos(w, t: Target): {x: number; z: number}`; `hitTarget(w, t: Target, dmg, opts): void` |
| `combat/projectiles.ts` (combat) | `spawnProjectile(w, p: ProjectileSpawn): Projectile`, `stepProjectiles(w)`; `ProjectileSpawn = Partial<Projectile> & {owner, kind, x, z, vx, vz, dmg}` (lob: set `lob`, `tx`, `tz`, `aoe`, `life` → auto circle telegraph) |
| `combat/telegraphs.ts` (combat) | `spawnTelegraph(w, t: TelegraphSpawn): Telegraph`, `stepTelegraphs(w)`, `TelegraphSpawn = {owner, style, shape, windup, dmg, kind, active?, onFire?, chain?, tag?}` — titan-owned telegraphs damage enemies/boss/city via damageArea; hostile ones damage the titan via damageTitanArea (once per telegraph unless `active` > 0 → 5 Hz ticks) |
| `combat/hazards.ts` (combat) | `spawnHazard(w, h: HazardSpawn): Hazard`, `stepHazards(w)`; `HazardSpawn = {owner, kind, shape, life, dps?, data?}`. Generic: dps to the opposing side at 5 Hz, lifetime, `frost` slows enemies (or the titan if hostile) 40 %. Kit-specific behaviour (bloom firing, wire detonation) lives in the kits. |
| `combat/pickups.ts` (combat) | `spawnPickup(w, kind: PickupKind, x, z, xp, mass): void` (burst outward with vy; merge into a nearby pickup when over `CITY.maxPickups`), `stepPickups(w)` (magnet radius = `stats.pickupRadius × H + 2`, pull speed ∝ titan speed, collect → gainXp/gainMass, heal → healTitan 10 % maxHp, chest → `upgrades.chestDrafts++` + `chest` event), `magnetAll(w, radius): number` |
| `ai/enemies.ts` (ai) | `spawnEnemy(w, kind: EnemyKind, x, z, opts?: {squad?: number; slot?: number; elite?: boolean}): Enemy`, `stepEnemies(w)` |
| `ai/director.ts` (ai) | `createDirector(): DirectorState`, `stepDirector(w)`, `spawnRing(w): number` (spawn radius, m) |
| `ai/bosses/index.ts` (ai) | `spawnBoss(w, id: BossId): void`, `stepBoss(w)`, `damageBoss(w, part: number, dmg, opts: DamageOpts): void` |
| `ai/bosses/{caisson4,irongully}.ts` | each: `create(w): BossState`, `step(w, b: BossState)`, optional `onDamage(w, b, part, dmg)` |
| `upgrades/stats.ts` (upgrades) | `createUpgradeState(): UpgradeState`, `recomputeStats(w)`, `stat(w, key: StatKey): number` (incl. frenzy buffs), `baseStatBlock(): StatBlock` (defaults every key) |
| `upgrades/engine.ts` (upgrades) | `applyUpgrade(w, id): void`, `stepUpgrades(w)`, `processTriggers(w)` |
| `upgrades/draft.ts` (upgrades) | `rollOffer(w, chest?: boolean): string[]` (3 ids, deterministic via rng.loot), `pickUpgrade(w, id): void` (applies, consumes one pending/chest draft, clears offer), `rerollOffer(w): string[] \| null`, `hasPendingDraft(w): boolean` |

### 5.4 Damage flow
* Titan-side damage → `damageArea` / `hitTarget` → enemies (`damageEnemy`), boss (`damageBoss`
  per part: circle-vs-shape against `boss.parts`), city (`damageBuilding` / `damageProp`
  × `buildingMul` × `stats.buildingDamage` × oversize rule). Crits via `rollCrit` (rng.combat).
  Emits `enemyHit`/`bossHit`; lifesteal = `stats.lifesteal` × dealt (enemies/boss only), capped
  at 2 % maxHp per tick.
* Hostile damage → `damageTitanArea` / projectile hit → `hurtTitan` (armor: ×100/(100+armor);
  iframes; `kitOnHurt`; shield pool absorbs first; god cheat). Hostile damage is multiplied by
  `RANKS[titan.rank].hpMul` at spawn time (so threat scales with the titan's HP).
* Kills → `killEnemy` → pickups (`ENEMIES[kind].xp/mass`, split into 1–4 pickups), counters,
  `enemyKilled`. Elite death also drops a `chest` pickup.
* Floor break → `damageBuilding` emits `floorBreak` (+`smash` for contact), spawns rubble pickups
  worth `TIERS[tier].floorXp/floorMass` split into 1–3 pickups at the footprint edge nearest the
  titan; on the last floor: `buildingCollapse` + bonus (`collapseBonus × floors`) + titan
  counters + `run.tonnage`. Blocks whose buildings are all collapsed increment `run.blocksLeveled`.

### 5.5 Upgrades math
`final(stat) = (base + Σ add·stacks) × Π(1 + mul·stacks)` then × frenzy buffs for `stat(w,k)`.
`abilityCooldown` and `dashCooldown` are MULTIPLIERS on cooldown time (upgrades use negative
`mul`; floor at 0.35×). Triggers fire from `processTriggers` reading `w.events` of the tick, with
`chance` (× (1 + 0.1·luck) capped 1) and per-upgrade `icd`; trigger-caused damage carries
`fromUpgrade` so it cannot re-trigger itself. Actions: see `TriggerAction` in types.ts.

---

## §6 View architecture

`render/viewtypes.ts` (orchestrator-owned) defines `ViewModule { mount; update; unmount }`,
`ViewCtx`, `FrameInfo`, `Quality`. Every view class: `export class XView implements ViewModule`,
constructed once as `new XView(ctx: ViewCtx)`.

| Module (lane) | Exports |
|---|---|
| `render/renderer.ts` (render-core) | `createRenderCore(canvas: HTMLCanvasElement, quality: Quality): RenderCore` — `RenderCore = { renderer, scene, camera, quality, resize(): void, render(): void, setQuality(q: Quality): void, stats(): RenderStats }`; `RenderStats = {draws, tris, programs, geometries, textures}` (info.autoReset=false, reset per frame) ; `defaultQuality(): Quality` |
| `render/camera.ts` (render-core) | `class CameraRig { constructor(camera); reset(w: World): void; update(w, f: FrameInfo): void; shake(amount: number): void; get distance(): number; get target(): {x,y,z} }` (§4) |
| `render/materials.ts` (render-core) | `toonRamp(): THREE.Texture`; `makeToon(opts: {color?: THREE.ColorRepresentation; vertexColors?: boolean; emissive?; emissiveIntensity?; flat?: boolean}): THREE.MeshToonMaterial`; `bakeOutlineNormals(geo: THREE.BufferGeometry): THREE.BufferGeometry` (adds smooth `outlineNormal` attribute; welds by position); `makeOutlineMaterial(opts?: {widthPx?: number; color?; instanced?: boolean}): THREE.ShaderMaterial` (inverted hull, BackSide, clip-space extrusion so width is constant in pixels, respects instanceMatrix); `addOutline(mesh: THREE.Mesh \| THREE.InstancedMesh, widthPx?: number): THREE.Mesh` (adds a hull child sharing the geometry/instanceMatrix, renderOrder −1) ; `INK = '#1b1426'` |
| `render/lighting.ts` (render-core) | `class Lighting { constructor(scene); applyBiome(b: BiomeDef): void; update(w, rig: CameraRig): void }` — fixed pool: 1 DirectionalLight (sun, shadows) + 1 HemisphereLight + 1 AmbientLight, created at construction, re-coloured per biome, never added/removed later; fog per biome |
| `render/env.ts` (render-core) | `class EnvView implements ViewModule` — sky dome gradient, out-of-city ground/harbour water, LOCKWATER flooded-street water surface + neon reflections, weather (snow/rain particles around the camera, count scaled by quality), distant skyline silhouettes beyond bounds, day clouds |
| `render/warmup.ts` (render-core) | `warmup(renderer, scene, camera): Promise<void>` — compileAsync with a HalfFloat RT bound then the canvas; force-visible traverse incl. hidden children |
| `city/meshkit.ts` (city-kit) | `buildCityKit(b: BiomeDef): CityKit`; `CityKit = { arch: Record<string, ArchMeshes>; props: Record<PropKind, PropMesh>; rubble: THREE.BufferGeometry; facade: THREE.Material; ground: Record<'road'\|'sidewalk'\|'plaza'\|'lot', THREE.Material>; dispose(): void }`; `ArchMeshes = { base: THREE.BufferGeometry; floor: THREE.BufferGeometry; roof: THREE.BufferGeometry; material: THREE.Material }` — UNIT geometry: x,z ∈ [−0.5, 0.5], y ∈ [0, 1] (one floor); the view scales by (w, floorH, d); `PropMesh = { geo: THREE.BufferGeometry; material: THREE.Material; height: number }` (authored in metres, facing +Z, vertex-coloured) |
| `city/cityview.ts` (city-view) | `class CityView implements ViewModule` — roads/sidewalks/crosswalks/lane markings, instanced floors per archetype for LIVE blocks, pancake animation, rubble piles, merged impostors for non-live blocks, traffic + static props |
| `titans/models.ts` (titan-view) | `buildTitanModel(id: TitanId): TitanModel`; `TitanModel = { root: THREE.Group; joints: Record<string, THREE.Object3D>; glow: THREE.Material[]; dispose(): void }` — authored at height 1.0, facing +Z, feet at y = 0 |
| `titans/anim.ts` (titan-view) | `class TitanAnimator { constructor(model: TitanModel, id: TitanId); update(a: AnimState, dt: number): void }`; `AnimState = { speed01; moving; turn; attack: string \| null; attackT; dashT; hurtT; abilityT; growT; t; kit: Record<string, number> }` |
| `titans/titanview.ts` (titan-view) | `class TitanView implements ViewModule` |
| `titans/portraits.ts` (titan-view) | `renderPortraits(renderer: THREE.WebGLRenderer, size?: number): Promise<Record<TitanId, string>>` (PNG data URLs, 3/4 hero pose on a transparent background) |
| `ai/enemyview.ts` (foes-view) | `class EnemyView implements ViewModule` |
| `ai/bossview.ts` (foes-view) | `class BossView implements ViewModule` |
| `render/telegraphview.ts` (combat-view) | `class TelegraphView implements ViewModule` |
| `render/projectileview.ts` (combat-view) | `class ProjectileView implements ViewModule` |
| `render/hazardview.ts` (combat-view) | `class HazardView implements ViewModule` |
| `render/fx.ts` (fx) | `class FxView implements ViewModule` |
| `render/debris.ts` (fx) | `class DebrisView implements ViewModule` (Rapier; `await RAPIER.init()` inside mount) |
| `render/civilians.ts` (fx) | `class CivilianView implements ViewModule` |
| `render/pickupview.ts` (fx) | `class PickupView implements ViewModule` |

Render budgets: ≤ 450 draw calls at Size V with 250 enemies; DPR ≤ 1.5; 1 shadow-casting
light; `renderer.info.autoReset = false`. Doctrine: compile-warm with an RT bound; fixed
light pool; no lights added after first render; `frustumCulled` sane on instanced meshes
(compute bounding spheres after instance updates or disable culling per batch).

### 6.1 Look ("Saturday-morning kaiju comic as a clean 3D diorama")
* `MeshToonMaterial` + 3-band ramp (`toonRamp`), painted vertex colours. **three r186's
  MeshToonMaterial has NO `flatShading` property** (verified: it warns and ignores it) — facet BY
  CONSTRUCTION: non-indexed geometry with per-face normals (`geo = geo.toNonIndexed();
  geo.computeVertexNormals()`), then `bakeOutlineNormals` for the smooth hull normals.
  Roughness look is irrelevant (toon). Soft LONG shadows: low sun (~28–35° elevation).
* **Ink outlines**: inverted hull, constant pixel width: titans/bosses 3.0 px, enemies/vehicles
  2.0 px, buildings/props 1.6 px, ink `#1b1426`. Hulls use `outlineNormal` (smooth), so faceted
  hard edges don't split the silhouette.
* Tone mapping: `THREE.NeutralToneMapping`, exposure ~1.0, sRGB output — palette hex values must
  read true on screen.
* **Glare bar** (owner rule, repeated across many games): emissive trims/neon/lit windows sit at
  3–8× the luminance of the surface they decorate, never 50×; no bloom pass. Readability comes
  from contrast + outline, not raw output.
* Telegraphs are pink (`palette.telegraph`) AND shape-coded with a hatch pattern + animated fill
  (never colour-only): cone = radial stripes, oval = concentric rings, lane = marching chevrons,
  ring = dashed band, circle = cross-hatch, chain = segmented links.

### 6.2 Palettes (city-sim writes these into `BIOMES[*].palette`; views read them)
* **GRID-EAST (day)** — sky `#9fd8f0`→ horizon `#fbe9d2`, road `#2f7f86` (teal asphalt),
  roadLine `#f4ecd8`, sidewalk `#d9d2c3`, curb `#b9b2a3`, crosswalk `#f6f0e0`, bodyA `#f1e4c8`
  (cream), bodyB `#e8d5b0`, bodyC `#cfe3df`, trim `#a8876a`/`#6f8f8c`, roof `#c9b79a`/`#8fa7a3`,
  glass `#5f9fb3`, sign `#ff6f5e` (coral), signB `#ffd166`, foliage `#f7a8c4` (pink blossom),
  foliageB `#e98bb0`, sun `#fff1dc`, ambient `#9ec9d9`, rim `#ffd6e6`, telegraph `#ff4fa0`.
* **WHITE STACKS (overcast)** — sky `#c9d3dc`→`#eef2f5`, ground/snow `#eef2f6`, road `#5d6670`,
  roadLine `#e8d36a`, bodyA brick `#8e4a3a`, bodyB `#a65a44`, bodyC steel `#9aa4ad`, roof white
  `#f4f6f8`/`#dfe6ec`, trim `#3f454c`, glass `#7d93a6`, sign `#ffb347`, signB `#e84a3c`, foliage
  `#5c7a6b` (snowy pines), water `#6f8797`, sun `#e9f1ff` (cool, low), ambient `#b8c6d4`.
* **LOCKWATER (night)** — sky `#0b1022`→`#1c2140`, water/road `#0d1a26`, waterGlow `#1f4a66`,
  roadLine `#3ff0ff` (dim), sidewalk `#2a2f3a`, bodyA rust `#9c4a2c`, bodyB `#3b6e8f`, bodyC
  `#c7a13a` (containers), trim `#1e242e`, roof `#39404d`, glass `#1b2a3a`, glassLit `#ffcf7a`,
  sign `#ff3fa4` (magenta neon), signB `#3ff0ff` (cyan neon), sun = moon `#8fa8ff` (low, cold),
  ambient `#2a3558`, rim `#ff3fa4`. Rain.

---

## §7 City

### 7.1 Generation (`generateCity`) — deterministic from (biome, seed)
* Grid of `blocks[0] × blocks[1]` blocks (GRID-EAST 14×14, WHITE STACKS 12×12, LOCKWATER 12×14),
  centred on the origin. Road centrelines at `origin + i·pitch` for i = 0..blocks. Block (bx,bz)
  cell centre = `origin + (b + 0.5)·pitch`; curb box ±29 m; parcel area ±26 m (`PARCEL_HALF`).
* **Downtown**: a seeded centre point; `u = dist/maxDist` (0 centre … 1 edge). Tier weights for a
  parcel = lerp(`tierCentre`, `tierEdge`, u) with noise; LOCKWATER's harbour edge (one side)
  becomes quay + water (no buildings, cranes/gantries + container stacks along it).
* **Parcels**: each block is split by recursive seeded bisection into 2–7 parcels (min side
  12 m); corner parcels prefer taller tiers. A parcel hosts one building (footprint = parcel
  minus a 1–2 m setback, clamped to the archetype's footprint range) or a plaza/lot with props.
  ~8 % of blocks are parks/plazas (trees, benches, kiosks — GRID-EAST pink trees).
* **Floors**: `floors ∈ archetype.floors`, `floorH` per archetype (shops 4 m, offices 3.5 m,
  towers 3.6 m, tanks = rings of 3 m, containers 2.6 m per layer). `floorHpMax = TIERS[tier].floorHp`.
* **Props**: sidewalk props (hydrant, lamp, kiosk, bench, vending, signpost, trees) on the
  sidewalk ring; parked cars along curbs; biome extras (drums, forklifts, containers, bollards,
  pylons, snowbanks, boats on LOCKWATER water). Ids are dense (index = id) for props and buildings.
* **Traffic lanes**: one closed loop per block (driving on the right, 1.75 m inside the lane
  edge) + a few long arterial lanes; `trafficPerLane` cars per loop. Cars are Props with
  `lane ≥ 0`.
* **Crosswalks**: zebra at every side of every intersection (`Crosswalk` records, stripes
  across the road, 4 m deep).
* **Spawn**: a crosswalk near (not at) downtown: titan stands in the middle of the zebra,
  heading along the crossing, with ≥ 2 parked cars and a kiosk within 8 m (the "baby titan in a
  crosswalk" opening frame must have food in reach). Verify this in your probe.

### 7.2 City sim
* Building index: per-block lists (`blockBuildings/blockProps`); rect queries walk the block
  cells overlapped by the rect ±1.
* `damageBuilding`: damage applies to the lowest standing floor; overflow carries into the next
  floor up to 4 floors per call (a huge hit pancakes several); each broken floor → `floorBreak`
  event + rubble pickups; when `alive` hits 0 → `collapsed = true`, `buildingCollapse`.
* `resolveCircleVsCity`: pushes a circle out of every non-collapsed building AABB (and tier-1
  props) with `tier > canFlatten`; returns the push. Collapsed buildings/rubble never block.
* Traffic (`stepTraffic`): cars follow their lane at 8–12 m/s; brake/`scared` when the titan is
  within 3H + 6 m ahead of them, reverse-flee when very close; stop at 0 when blocked by a
  stationary car ahead (simple gap check along laneS). Destroyed cars leave the lane.
* `stepCity` also refreshes `run.blocksLeveled` incrementally (on collapse events).

### 7.3 City view
* Ground: one road plane (teal asphalt etc.), sidewalks + curbs as merged meshes per block
  row, lane markings + zebra stripes as instanced quads (polygonOffset, no z-fight),
  parcel lots/plazas as merged tiles.
* LIVE blocks (Chebyshev radius `liveRadiusByRank[rank]` around the titan, hysteresis 0.5
  block): every building = instances of its archetype's `base` (floor 0), `floor` (1..n−2) and
  `roof` (top) pieces in per-archetype `InstancedMesh`es (+ outline hulls), instanceColor for
  palette variation. NON-live blocks: one merged, vertex-coloured impostor mesh per block
  (current alive heights; no outline or a cheap one), rebuilt only when the block's state changes
  or it leaves the live set.
* **Pancake**: on `floorBreak`, the broken floor vanishes with a dust ring and debris; every
  piece above it DROPS one floor height over 0.28 s (easeInCubic) and lands with a 6 % squash
  bounce; roofs ride the stack. On `buildingCollapse` the remaining pieces sink + a rubble pile
  (rubble geometry scaled to footprint, height ∝ floors) appears with a dust plume.
* Props: instanced per kind; traffic interpolated from `px/pz/pheading`; destroyed props hide
  (fx handles the burst).

---

## §8 Titans (titan-sim implements; numbers are starting points — the balance gate tunes)

**Canonical titan colours** (models.ts AND data/titans.ts `colors` use exactly these):
MOLO primary `#3fae7f` jade · secondary `#1f6f55` · belly `#cfe8b8` · accent (fin tips) `#f1e4c8` ·
glow `#9dffcf` · eye `#ffd166`. VOLT-KITE primary `#3b3f9e` indigo · secondary `#23255e` · belly
`#8f94d9` · accent (static mane) `#6ff3ff` · glow `#6ff3ff` · eye `#fff27a`. HEARTHBACK primary
`#2a2433` obsidian · secondary `#4a3f52` basalt · belly `#7a5c4f` · accent (magma seams) `#ff7a2e` ·
glow `#ffb13b` · eye `#ffd166`. BRIARWICK primary `#5e8f3a` moss · secondary `#6b4a2f` bark · belly
`#c9d98f` · accent (blossoms) `#ff9ec7` · glow `#d8ff7a` (spores) · eye `#fff3b0` · horns `#e8dcc0`.

Common: WASD/stick move; **Space** = HOOK; **Shift** = DASH (distance `dashDistance × H` in
0.22 s, i-frames 0.3 s, 2× contact smash, charges recharge `3 s × dashCooldown` each). Turn
rate 10 rad/s at Size I easing to 5 rad/s at V. Regen `regen × hp×` per second after 3 s
without damage. Auto-attack aims at `findTarget` (enemies first, then boss parts, then
flattenable-or-not buildings/props) within range; with no target it idles (no wasted swings
at air), except MOLO whose bite also snaps at buildings in front while plowing.

Base stat defaults (`baseStatBlock`): maxHp 100, regen 0.5, armor 0, iframes 0, thorns 0,
lifesteal 0, rubbleHeal 0, moveSpeed 1, dashCharges 1, dashCooldown 1, dashDistance 2.2,
pickupRadius 1.6, massGain 1, xpGain 1, luck 0, rerolls 1, damage 1, attackRate 1, attackRange 1,
area 1, critChance 0.05, critMult 1.6, knockback 1, chains 0, chainRange 1, projectiles 0,
buildingDamage 1, smashDamage 1, smashRadius 1, sparkChance 0, abilityCooldown 1, abilityPower 1,
biteCleave 0, pulseEvery 4, vacuumRadius 1, arcForks 3, wireDuration 4, wireDamage 1,
shellCapacity 1, stompDelay 0.6, magmaDuration 0, turretCap 4, turretRate 1, sporeHeal 1, vineLength 1.

**MOLO — SMASH TANK** (maxHp 140, armor 10, moveSpeed 0.95)
* Auto **CURB BITE** — every 0.75 s ÷ attackRate: cone r = 0.9H × attackRange, half-angle 50° +
  10°·biteCleave, dmg **22** (the code's `MOLO.biteDmg`; this line and the titan card said 10 until the TITAN PASS
  text fix — no tuning change), aimed at the target if within ±70° of heading (head turns), else ahead.
* **Foot-pulse** — every `pulseEvery` footsteps: ring damage r = 1.4H × area, dmg 6, `pulse` event.
* HOOK **GULLET VACUUM** (cd 9 s): 1.2 s channel. All pickups within 6H × vacuumRadius × area
  magnetize at 3× speed; crushable enemies within that radius are dragged toward the mouth at
  1.5H/s and take 12 dmg/s; on release gain a shield of 4 % maxHp + 0.2 % per pickup vacuumed
  (cap 40 %) × abilityPower. "Raw mass" — vacuumed pickups give +25 % mass.

**VOLT-KITE — CHAIN ASSASSIN** (maxHp 90, **armor 12** (TITAN PASS; was 0), moveSpeed 1.15, dashCharges 2, dashCooldown 0.75)
* Auto **FORK-ARC** — every 0.9 s ÷ attackRate: arc to a target within **3.8H** (TITAN PASS; was 3.2H) × attackRange, then
  jumps up to `arcForks + chains` more targets within 1.6H × chainRange of the previous
  (enemies first, then buildings/props), dmg 12 with ×0.85 falloff per jump. `arc` event. A single arc may strike
  at most **2 boss parts** (`VOLT.bossParts`; was 1): one follow-up jump into a second part, never the whole rig.
* **GROUNDING** (TITAN PASS rider on FORK-ARC) — every **2nd** arc whose first target is a foe or a boss part lays a
  LIVE WIRE from the struck point **1.4H** back toward VOLT-KITE (never longer than the gap), life **0.625 ×
  wireDuration** (2.5 s; owner feedback 3 — `VOLT.groundLife`). It shares the wire cap (6), the dps and the look with dash wires (one `layWire` helper), so RECAST
  has real wires to blow without dash-weaving. Kit state adds `arcN` (arc counter). Card text: "… 3.8 body-heights …
  Every 2nd strike GROUNDS: a short LIVE WIRE is left where it hit."
* **Model (v4, owner feedback 3, 2026-10-01: "looks off/derpy … maybe the face")** — "charged raptor-cat under twin kite
  sails": a deep keel chest and heavy haunches on short strong legs (digitigrade hind legs, a raptor sickle claw), a
  short broad big-cat head with narrow forward-set slit-pupil eyes under a heavy V brow, a closed jaw with sabre fangs,
  ears laid back. Ribbed insulator pauldrons on the shoulders carry the two kite sails as raked-back antenna fins (cyan
  mast spar + tip beacon); cyan coil bands on the forearms and tail; a flat diamond kite on the tail tip, a cyan bolt
  down the spine and a short swept static crest along the nape (no mane ring). (The TITAN PASS v3 "storm-hound drake"
  it replaces read as a startled pup: eyes half the head width, bulging sideways.) Same bone names, same canonical hexes (only
  their placement moves: belly `#8f94d9` on upward faces, primary on flanks/legs, secondary on brows / ear tips / lower
  legs / paw pads, glow on mane, spars, bolt and panels). Originality guard (§1): not a winged horse / lion /
  wolf-with-cloud-mane; no star-tipped tail, no cheek pouches, no spike crest over the skull; the sails are flat
  diamonds on visible spars, never feathered or bat wings. Look bar at the game camera (turntable): screen area ≥ 0.09,
  body luminance ≥ 85, dark share (luminance < 60) ≤ 0.40, head visible from behind at Size V.
* **LIVE WIRE** — every dash leaves a `wire` hazard (capsule r 0.25H × area along the dash
  path) for `wireDuration` s dealing 7 × wireDamage dps to enemies (5 Hz; was 10 before owner feedback 3). Cap 6 wires.
* HOOK **RECAST: DETONATE** (cd **8 s** — owner feedback 3, 2026-10-01: "SPACE attack needs a longer cooldown"; was
  1.5 s; `VOLT.detCdS`, probe_titan asserts ≥ 6 s and that a press while cooling does nothing): every live wire explodes
  along its capsule (r 0.8H × area, dmg 50 × abilityPower + 8 per remaining second), wires removed, `wireDetonate`
  event; each wire blown charges a STATIC SHIELD of 4 % maxHp × abilityPower (≤ 12 % per press; RECAST never tops the
  pool past 15 %). No wires → a static burst around the titan (r 1.2H, dmg 40) so the button is never dead.

**HEARTHBACK — ERUPTION FORTRESS** (maxHp 170, armor 20, moveSpeed 0.85, dashCooldown 1.35)
* Auto **MAGMA STOMP** — every 1.3 s ÷ attackRate: titan-owned `circle` telegraph r 1.1H × area
  at the target (≤ 2.5H × attackRange) or 1H ahead; windup `stompDelay` (0.6 s); fires dmg 30,
  knock, `stomp`-style `explosion` event; `magmaDuration > 0` leaves a `magma` hazard.
* **SHELL** (passive) — stores 60 % of damage taken (post-armor) + 1 per floor broken, up to
  `shellCapacity × 0.5 × maxHp`. Kit state `kit.stored`, view reads `kit.stored/kit.cap` for the
  caldera glow.
* HOOK **SHELL VENT** (cd 6 s): ring burst r = (1.5 + 2.5·fill)H × area, dmg (20 + 2.5 × stored)
  × abilityPower, heals 15 % of stored, resets store, `vent` event.

**BRIARWICK — AREA CONTROL** (maxHp 120, armor 5, **turretCap 10** — TITAN PASS kit C, 2026-09-29; it replaces VINE
LASH / BLOOM TURRETS / SOW. Tuning = `titanpass/briarwick_C.ts` shipped unchanged, all of it inside `BRIAR.*` in
`src/titans/kits/briarwick.ts`; never tuned through `BOSS_KIND_MUL` — its `seed` entry also scales every titan's
upgrade seed damage. Size-I multipliers apply only while `titan.rank === 0`.)
* Auto **BURR LASH** — every 1.0 s ÷ attackRate; a vine whip off the horns (never a tongue: the mouth stays shut). Aim
  (owner feedback 3, 2026-10-01: "the tongue just goes out in all directions"; `BRIAR.aim*`): while the stick is held the
  lash cracks only inside **±45°** of the move direction (`aimArcDeg`), down the lane through the most foes (edge lanes
  score × (1 − 0.25 · off/arc)), staying on the last crack's lane or the nearest lane to it among those scoring ≥ 0.6 ×
  the best (`goodFrac`, `keepS` 2 s); foes in reach but none ahead → it holds (no swing at the city, no whip back at a rig
  being fled); a boss with no foe in reach is lashed in any direction (`bossArcDeg` 180). Stick idle, or held while
  slower than 0.2 × the base walk (`blockedFrac`: stuck / hemmed in) → the arc is the full circle and the nearest target
  wins (`findTarget` order: weak point → foes → boss parts → city). The lane is committed `windS` 0.2 s before the crack
  (kit `lashWind` / `lashDir` / `lashSide`: the view cocks the horn toward it) and the crack goes exactly there;
  `lane` 3.2H × vineLength × attackRange long (**×1.8 at Size I**), 0.55H × area wide; **14** dmg to everything in it,
  knock 0.5, kind `vine`; **plants 1 seed pod** at the struck point (foe, boss part, building or prop). Emits `vine` +
  `titanAttack 'vineLash'`.
* **RIPENING** (passive; seed pods) — a pod is a titan-owned `bloom` hazard, r 0.3H, life **9 s**, dps 0, ripening
  0 → 1 over **2.0 s ÷ turretRate**. A RIPE pod bursts when a foe or boss part is within **0.9H**; at end of life it
  bursts anyway (×0.6 if unripe). **Burst**: r 1.1H × area (×1.3 at Size I), **18** dmg × chain multiplier, knock 0.8,
  kind `seed`, one `bloomBurst {x, z, r, link, ripe}` event (types.ts); **TANGLE** stuns foes 0.6 s (elites ×0.3,
  heavies of radius ≥ 2.4 ×0.6, bosses never) and emits `rooted {id, x, z, t}` for each foe it stuns; heals 0.4 % maxHp ×
  sporeHeal, capped at 1.5 % maxHp per rolling second. **Chain**: a burst sets off RIPE pods within 2.4H × area ×
  chainRange after 0.1 s (unripe pods there gain +0.5 ripeness); +10 % per link, cap ×2. **Sprouting**: floors broken
  within 3H sprout an unripe pod (35 %; a collapse always does). **Cap** `turretCap`: at the cap the OLDEST unfused pod
  bursts early instead of being deleted. Card and UPROAR blooms are adopted as unripe pods (`upgrades/engine.ts` skips
  `driveUpgradeBlooms` for BRIARWICK).
* HOOK **POP-UP PARK** (cd **8 s** × abilityCooldown, floor 0.35; renamed from kit C's "FULL BLOOM" because goal
  `g_bw_full_bloom` already has that name) — one tick: (1) horn-stamp ring r 1.6H × area (×1.3 Size I), **24** ×
  abilityPower, knock 1.2, TANGLE 1.0 s; (2) seed volley of 4 + round(2 × (abilityPower − 1)) pods (3..10), 0.3 s flight
  to the nearest foes within 6H (×1.8 Size I), leftovers to the nearest boss part, then fanned 2.5H ahead; they land
  RIPE and bypass the cap; (3) every pod within **12H** ripens and gets a fuse 0.15 s + 0.06 s × its distance rank
  (volley pods 0.3 s + 0.06 s × order); pod *k* bursts at link *k* (×(1 + 0.1 k), cap ×2) × abilityPower — a ripple
  rolling outward from the horns. A press with zero pods still does the ring and the volley. Emits `ability`.
* DASH **BRAMBLE BOUND** — the shared bound (2.2H in 0.22 s, i-frames, ×2 contact smash); `onDash` drops **2 unripe
  pods** at 1/3 and 2/3 of the path.
* **Kit state** `titan.kit`: `pods`, `ripe`, `chain` (length of the last cascade), `bloomT` (hook anim time), plus the
  legacy `turrets` (= pods) and `sowT` (= bloomT) so `titanview.ts` / `anim.ts` keep working. Pod hazard `data`:
  `pod 1, ripe 0..1, fuse (−1 none), link, src (0 lash/rubble, 1 hook, 2 dash, 3 card/ult), h, vol`.
* Text: stat labels `turretCap` "SEED POD cap", `turretRate` "pod ripening speed", `vineLength` "BURR LASH length";
  titan-card texts verbatim from `titanpass/briarwick_final.md` §7 (BURR LASH 14 dmg, POP-UP PARK 24 dmg / 12
  body-heights / 8 s, BRAMBLE BOUND 2 pods); flavour "Anything it knocks down tends to sprout something that goes off."
* View (lane VIEW): unripe pod = closed moss `#5e8f3a` bulb in a bark `#6b4a2f` husk, 0.6 → 1.0 scale with ripeness;
  ripe = 5-petal `#ff9ec7` blossom + `#d8ff7a` halo 0.6H + 2 Hz bob; fused = ±4 % shiver at 20 Hz + emissive ramp; bulb
  ≥ 0.3H and ≥ 12 px; `'seed'` explosion branch (petal spray + spore ring decal 0.35 s; > 6 bursts within 0.1 s → ring
  decal only); root coils (2–3 `#5e8f3a` loops round the legs) for `rooted.t`; pod / decal luminance contrast ≥ 25
  against every biome road. HUD kit row "PODS n · RIPE m" (strings_hud `HUD2.pods` / `HUD2.ripe`); the SPACE prompt
  glows at `kit.ripe ≥ 3`.

---

## §9 Enemies & director (ai lane)

| kind | name | hp | spd | r | h | dmg | range | cd | xp | mass | cost | minRank | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| android | CROSSING WARDEN | 6 | 3.4 | .45 | 1.8 | 3 | 9 | 1.6 | 2 | 1 | 1 | I | walks in, stops at range, pellet (slow, readable) |
| squad | PICKET SQUAD | 8 | 3.8 | .45 | 1.8 | 2×3 | 12 | 2.4 | 2 | 1 | 1 | I (after 45 s) | groups of 5 in a wedge; 3-round volleys |
| drone | GNAT | 5 | 7 | .6 | .5 | 4 | dive | 3 | 2 | 1 | 1.5 | II | flies y 4 → 0.8H, circles, dive-bombs (small circle tell 0.6 s) |
| buggy | HOPPER | 40 | 11 | 1.6 | 1.8 | 8 | 25 | 3.5 | 6 | 4 | 5 | II | drives on roads, strafes, rocket = circle tell r 3, 1.1 s |
| apc | BULWARK | 160 | 7 | 2.4 | 2.6 | 3 | 30 | 1.2 | 15 | 12 | 14 | III | deploys a PICKET SQUAD every 12 s (max 2), pellet turret |
| tank | TORTOISE | 320 | 4.5 | 2.8 | 2.8 | 26 | 45 | 5 | 25 | 20 | 24 | III | shell = lane tell (w 2.5, len 45, 1.4 s) |
| walker | STILT MORTAR | 700 | 3 | 3 | 12 | 30 | 90 | 6 | 60 | 60 | 55 | IV | 3 lobbed shells, circle tells r 6, 1.8 s |
| elite | RAMROD | 2400 | 6 (charge 30) | 5 | 6 | 45 | 80 | 7 | 250 | 200 | — | III | lane-tell charge (len 80, w 8, 1.6 s); never crushable; drops a CHEST |

* HP × (1 + 0.18·minutes) at spawn; hostile dmg × `RANKS[titan.rank].hpMul`.
* Spawn ring radius = `spawnRing(w)` = max(14, 0.55 × camera vertical extent at the current D)
  so spawns happen just off-screen; vehicles snap to the nearest road lane; drones anywhere.
  Enemies farther than 2.4× the ring are recycled back onto the ring.
* **Director**: spawn budget accrues `1.2 + 0.9·min(t,600)/60 + 0.6·rank` per second; a wave every
  6–9 s (rng.spawn) spends it on kinds allowed at the current rank with biome bias; caps per kind
  and `CITY.maxEnemies`. First appearance of a category raises an alert (`contractors`, `squads`,
  `drones`, `vehicles`, `armor`, `artillery`). Elite at `min(ELITE_AT_S, t(rank IV)+30)` →
  `alert elite`, run.phase `elite`. Boss at `min(BOSS_AT_S, t(rank V)+20)` → `alert boss`,
  `spawnBoss(w, biome.boss)`, run.phase `boss`, regular spawns drop to 30 %.
* Enemy AI honesty (doctrine §2): roll reactions once per incoming event and latch; 300–800 ms
  reaction delay + aim jitter; every hostile attack is telegraphed (pellets are slow and visible;
  everything heavier paints the ground first).

## §10 Bosses (ai lane: sim; foes-view lane: models)

Boss HP = `BossDef.hp × BOSS_HP_SCALE[titan.rank]`. Entrance: 4 s intro (invulnerable) —
walks in from the city edge (CAISSON-4 wades in from the harbour side in LOCKWATER). Phase 2 at
66 % hp, phase 3 at 33 % (`bossPhase` + alert). Meter (0..1): damage to high-`strainMul`
parts fills it; full → 5 s stagger (2× damage taken, `bossStagger`), meter resets.
Nameplate subtitle = the active attack's subtitle, else the default mechanic hint.

> **Superseded sizes (2026-09-24).** The metre sizes below were the first design. At Size V they were
> smaller than the titan itself (radius ~25 m, ~53 m/s), so attacks were trivially stepped out of and
> read as tiny rings on its back. Every boss attack shape is now sized in **titan heights** (`bossH(w,b)`
> = titan height locked at spawn, re-locked on a mid-fight rank-up) and every windup is computed by
> `fairWindup()` = 0.35 s reaction + 0.15 s acceleration + walk-out distance ÷ the titan's current max
> speed × ESCAPE_K[phase]. Examples: CAISSON-4 hookDrop r 0.55H, hookLane w 0.5H, winch oval
> 1.4H × 1.0H pulling 0.4H/s, boomSweep reach 2.6H; IRON GULLY coneBreath reach 3.0H, pawSlam rings
> 0–1.1H and 1.1–2.0H, plates r 0.4H, PLOUGH RUN (`ridgeCharge`) lane w 0.7H. Both bosses answer dash-spam with a
> readable drop at the dash end (`watchDash`). Boss HP now `BossDef.hp × BOSS_HP_SCALE` (1.15 at
> Size V), a per-hit cap of 0.55 × titan max HP, and structural fatigue after 90 s. Source of truth:
> `src/ai/bosses/{index,caisson4,irongully}.ts` + the BOSS rows of the config.ts table.

**CAISSON-4** (hp 150 000, height 75 m + boom) — four-legged harbour crane-mech: gantry body,
cab with lamp "eyes", 4 articulated legs, boom with trolley + hook on a cable, hazard stripes.
Keeps 60–120 m from the titan, walks 6 m/s. Parts: body r18, 4 legs r7 (strainMul 2.5), boom
r8 (hpMul 0.5), cab r6 (hpMul 1.5).
* P1 `hookLane` — "HOOK LANE — STEP OUT OF THE PAINT": lane from boss to titan (len 160, w 14),
  1.8 s, dmg 60 + knock. `hookDrop` — "HOOK DROP — MIND THE SHADOW": circle r 16 at the titan, 1.5 s, dmg 50.
* P2 + `winchLeash` — "WINCH LEASH — LEAVE THE OVAL": oval (rx 26, rz 18, rot toward boss)
  around the titan, 2.2 s; if the titan is inside on fire → `titan.leash` for 3 s pulling it
  toward the boss at 12 m/s (`leash` event, cable drawn); moving against the pull fills STRAIN
  0.12/s. `boomSweep` — "BOOM SWEEP — GET BEHIND THE CRANE": cone half 35°, r 110, 1.6 s, dmg 55.
* P3 + `legStomp` — "LEG STOMP — CLEAR THE RING": ring 0–50 m around the boss, 1.2 s, dmg 70;
  cycle 30 % faster; `hookLane` ×2 back-to-back.
* Default subtitle: "BREAK THE LEGS — BUILD STRAIN".

**IRON GULLY** (hp 170 000, height 70 m; nameplate "HALVARD CIVIL DEFENSE · HALVARD SNOW-CLEARANCE
WALKER") — HALVARD winter works' road gritter + V-plough at kaiju scale on four crab-splayed hydraulic
stamp legs: a vermilion V-plough in front, a flush blower turret with a spinning auger in a lit intake,
a charcoal grit hopper with an ochre load and an amber beacon bar, a plate magazine topped by a vermilion
spreader SPINNER (the weak point; its crack seams glow with FRACTURE), a rear engine block with two
exhaust stacks. Closes to 50–80 m, 9 m/s. Parts (sim ids unchanged): body r20 = the hopper, head r8
(hpMul 1.6, strainMul 2.0) = the blower turret, sail r10 (strainMul 2.5) = the plate magazine + spinner,
4 legs r6 = the stamp legs. Move ids are the sim's (`coneBreath`, `pawSlam`, …); the names are the
machine's.
* P1 `coneBreath` — "AUGER BLAST — GET OUT OF ITS SIGHTLINE": cone half 28°, r 140, 1.8 s windup
  then 1.2 s active (dps), sprays brine slush (`frost` hazards, slow; drawn as grey-brown slush with
  grit, not ice). `pawSlam` — "DOUBLE STAMP — DASH THROUGH THE RING": the front rams stamp (ring
  0–60 m at 1.3 s), then the hydraulics dump the whole chassis (ring 60–110 m 0.5 s later; dash
  i-frames or stand in the gap).
* P2 + `plateVolley` — "PLATE SPREADER — WATCH THE SHADOWS": the spinner flings 6–10 lobbed `plate`
  projectiles (steel road plates) with circle tells r 12 around the titan, 1.6 s. `ridgeCharge` —
  "PLOUGH RUN — SIDESTEP THE LANE": lane len 180, w 30, 1.5 s (the blade drops onto the road), then it
  charges along it; the V-plough's side throw is the shove.
* P3: `breathSlam` "WHITEOUT" — AUGER BLAST then DOUBLE STAMP; plate volley density ×2.
* Stagger: the spinner jams, hydraulic pressure drops (sag, splay, blade down). Defeat: a machine
  collapse — the legs fail one at a time (FL, BR, FR, BL), grit pours over the rim, the hopper lands on
  the road by ≈ 2 s.
* Default subtitle: "CRACK THE SPINNER — BUILD FRACTURE".

---

## §11 Upgrades (upgrades lane)

* **≥ 120** `UpgradeDef`s, data-driven: ≥ 64 generic (≥ 16 each in survival, growth/mobility,
  offense, smash/city) + ≥ 14 per titan (titan-locked, reading the kit stats) + a handful of
  legendary "mutations" (big trade-offs). Every entry: original civic/monster-humour name
  (e.g. style: "Zoning Variance", "Rebar Molars", "Eminent Domain", "Load-Bearing Gut",
  "Sinkhole Stride", "Permit Denied"), a one-line description with real per-stack numbers,
  rarity, maxStacks (1–5), tags, effects. No two names alike; none from §1's forbidden list.
* Every stat in `StatKey` must be touched by ≥ 1 upgrade; every `TriggerAction` used by ≥ 1.
* Rarity weights common 60 / rare 28 / epic 10 / legendary 2, × (1 + luck·[0, .5, 1, 1.5]).
  Offer = 3 distinct eligible ids (titan filter, minRank, not maxed). Chest drafts: rare+ only.
* **TITAN PASS D1 — BUILD SLOTS** (owner decision 2026-09-29; full rule in FEATURES_V2 §7.7): a run holds at most
  `SLOT_CAP` (8) distinct cards; once they are all taken, drafts offer only cards that need no new slot (owned-not-maxed
  cards, the missing half of a started evolution recipe, ready evolutions); an owed draft with nothing offerable pays
  an OVERFLOW reward (SICK DAY / HOT TIP) instead. API in `upgrades/draft.ts` (`SLOT_CAP`, `slotsUsed`, `slotsFull`,
  `cardSlot`, `isOverflowReward`, `OVERFLOW`); types `DraftCardSlot` / `OverflowRewardId` in `core/types.ts`.
  `rerolls` stat = rerolls per draft.
* Engine: stat recompute on apply/rank-up; triggers per §5.5; `frenzy` buffs; `shield` pool;
  `interval` triggers use `p.every` seconds.

## §12 UI (ui lane) — HTML/CSS overlay, broadcast first, game HUD second

* Fonts via npm `@fontsource/*` (OFL): a heavy condensed display face (Anton), a condensed UI face
  (Barlow Condensed), a mono for tickers/numbers (Space Mono). Import the CSS in `ui/styles.css`
  or main.ts. No network font loads at runtime.
* **Layout rhythm**: corner CREAM status card (bottom-left: titan name, HP bar, `LV n`,
  big roman `SIZE` numeral with mass bar, XP bar, dash pips, hook cooldown dial);
  `WARD-7 • LIVE` bug top-left with a pulsing red dot + broadcast clock + run timer; ticker crawl
  along the bottom; tonnage/blocks/crushed counters top-right; upgrade chips column right;
  occasional FULL-WIDTH alert banner sweeping across the upper third; boss nameplate top-centre
  (`CAISSON-4 / PHASE n / STRAIN ▮▮▮▯▯` + subtitle); low-HP vignette.
* **Screens** (all keyboard + mouse + gamepad; each sets `input.mode = 'ui'` while open):
  Title ("BLOCKTOOTH" logo, "a WARD-7 special report", PRESS ENTER) → Select Step 1 TITAN (four
  live portraits, lore column: name/species/role/tagline/lore/auto/hook/dash/difficulty, confirm
  bar) → Step 2 BIOME (three cards + lore column, confirm bar "DROP IN") → Open slate
  (freeze-frame, halftone + scanlines over the paused scene, lower third
  `UNIDENTIFIED MASS — …`, a sub-line, "PRESS ANY KEY") → HUD → Draft ("MUTATION REPORT": 3
  dossier cards, rarity frames, 1/2/3/click, R reroll) → Pause ("WE'LL BE RIGHT BACK" test-card:
  Resume / Settings / Retry / Quit) → Run end tabloid (THE WARD SEVEN WITNESS masthead,
  `THE CITY GOT SMALLER.`, the freeze-frame photo, stats columns, RETRY / CHANGE TITAN / TITLE).
  Settings: master/music/sfx volume, quality (low/med/high), screen shake, reduce flashing.
* `data/strings.ts` holds ALL copy (network, slates, rank subs e.g. II "SIZE II CONFIRMED —
  ZONING NO LONGER APPLIES", ticker headlines ×24+, alerts, tabloid sub-heads for clear/dead,
  burst words "KRUNCH!" "THOOM!" "SKRAKK!" "BZZAK!" "FWASH!" "SPLNT!" "WHUMP!"). Original only.
* UI classes (ui lane) — exact exports:
  `ui/hud.ts`: `class Hud { constructor(root: HTMLElement); show(on: boolean): void; update(w: World, dt: number): void; onEvents(w: World, ev: readonly SimEvent[]): void }`
  `ui/broadcast.ts`: `class Broadcast { constructor(root: HTMLElement); openSlate(biome: BiomeDef, titan: TitanDef): Promise<void>; sizeUp(rank: RankIndex): void; alert(key: AlertKey): void; tabloid(w: World, photo: string): Promise<'retry' | 'select' | 'title'>; clear(): void }`
  `ui/bossbar.ts`: `class BossBar { constructor(root: HTMLElement); show(def: BossDef): void; update(b: BossState | null): void; hide(): void }`
  `ui/select.ts`: `class SelectScreen { constructor(root: HTMLElement, input: Input); run(portraits: Record<TitanId, string>, initial?: {titan?: TitanId; biome?: BiomeId}): Promise<{titan: TitanId; biome: BiomeId} | null> }`
  `ui/draft.ts`: `class DraftScreen { constructor(root: HTMLElement, input: Input); open(w: World, offer: string[], rerollsLeft: number): Promise<{pick: string} | {reroll: true}> }`
  `ui/menus.ts`: `class TitleScreen { constructor(root, input); run(): Promise<void> }`, `class PauseMenu { constructor(root, input); open(): Promise<'resume' | 'retry' | 'quit'> }`, `class SettingsPanel { constructor(root, input); open(s: Settings): Promise<Settings> }`
  `ui/dom.ts`: helpers (`el(tag, cls, text?)`, etc.). `ui/styles.css`.

## §13 Audio (audio lane) — procedural WebAudio only (no duplicate/shared music files)

`audio/audio.ts`: `class AudioEngine { unlock(): Promise<void>; setVolumes(master, music, sfx): void; readonly ctx: AudioContext | null; readonly sfxBus: GainNode | null; readonly musicBus: GainNode | null }`
(unlock on the first user gesture; master limiter/compressor; safe when AudioContext is missing).
`audio/sfx.ts`: `class Sfx { constructor(engine: AudioEngine); onEvents(w: World, ev: readonly SimEvent[], camX: number, camZ: number): void; ui(kind: 'move' | 'confirm' | 'back' | 'draft' | 'pick' | 'slate' | 'print'): void }`
— footsteps pitched by 1/height, crunch/metal/glass for props, concrete crack + rumble for floors/collapses, per-kit attack voices (bite snap, arc crackle, magma whoomp, vine whip), dash whoosh, hook voices (vacuum suck, thunderclap, eruption, bloom chime), toy "pew" → rocket hiss → tank boom → mortar thunk, crush "clank-boing", titan hurt grunt, pickup ticks (rate-limited, pitch climbs with combo), level chime, MASS BREACH brass stab + roar, telegraph warning beeps by style, news alert jingle, boss siren/phase sting/stagger groan. Voice-limited (max ~24 simultaneous), distance-attenuated from the camera target.
`audio/music.ts`: `class Music { constructor(engine: AudioEngine); play(track: 'title' | 'select' | BiomeId | 'boss' | 'tabloid'): void; stop(): void; setIntensity(x01: number): void }`
— GRID-EAST city-pop/funk (major, 118 bpm), WHITE STACKS industrial minor (96 bpm, metallic percussion), LOCKWATER night synthwave (phrygian, 104 bpm, rain bed), boss 140 bpm, title/select news theme (dorian brass/synth stabs). Look-ahead scheduler; linear ramps; finite-clamped params (doctrine: exponential ramps to ~0 throw).

## §14 App, test surface, dev server (app lane)

* `src/main.ts` boots `App` from `src/game.ts`. **State machine**: boot → title → select →
  loading (createWorld, mount views, warmup) → slate (one frame rendered, sim frozen) → play ⇄
  draft / pause → end (tabloid). Retry = same titan+biome, new seed.
* `core/loop.ts`: `class GameLoop { constructor(onStep: () => void, onFrame: (alpha: number, dt: number, time: number) => void); start(): void; stop(): void; simEnabled: boolean; timeScale: number; stepSync(n: number): void }` (fixed accumulator, `MAX_STEPS_PER_FRAME`, accumulator DISCARDED when sim is disabled — doctrine §5).
* `core/input.ts`: `class Input { constructor(win: Window); mode: 'ui' | 'game'; update(): void; pressed(a: Action): boolean; held(a: Action): boolean; stick(): {x: number; y: number}; titanInput(): TitanInput; clearEdges(): void }`, `type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'pause' | 'debug' | 'ability' | 'dash' | 'pick1' | 'pick2' | 'pick3' | 'reroll'`. Keyboard (WASD/arrows, Space, Shift, Enter, Esc/P, F1, 1/2/3, R) + Gamepad API. Gameplay actions read as false while `mode === 'ui'` (no title-screen input leak). Edge presses buffered `INPUT_BUFFER_S` for ability/dash. `titanInput()` returns world-space move via `screenToWorld`.
* `core/debug.ts`: `class DebugOverlay { constructor(root: HTMLElement); toggle(): void; visible: boolean; update(w: World | null, r: RenderStats, frame: {fps: number; p99: number; simMs: number}): void }` — F1.
* `core/save.ts`: `type Settings = {master: number; music: number; sfx: number; quality: 0 | 1 | 2; screenShake: boolean; reduceFlashing: boolean}`; `loadSettings(): Settings`; `saveSettings(s)`; `loadBest(): Record<string, number>`; `saveBest(...)` — all try/catch.
* `window.__PAUSE__ = { pause, resume, toggle }` (portal contract). ESC pauses, never destroys.
  Auto-pause on `visibilitychange` hidden.
* **URL params**: `?seed=`, `?titan=`, `?biome=`, `?autostart=1` (skip title+select, go straight to
  loading→slate), `?dev=1` (cheats + debug), `?quality=0|1|2`, `?noslate=1`.
* **Test surface** `window.__BT__` (src/testsurface.ts):
  `version`, `state()` → `{screen, titan, biome, seed, t, tick, rank, height, level, xp, hp, maxHp, mass, x, z, heading, enemies, pickups, floorsEaten, buildingsLeveled, propsEaten, kills, crushed, drafts: {pending, offer}, owned, boss: {id, phase, hp, maxHp, meter, attack} | null, run, fps, draws, tris, programs}`;
  `newRun({titan, biome, seed, skipSlate?}): Promise<void>`; `step(n, input?)` (sync, only while frozen);
  `freeze(on)`; `dismiss()` (dismiss slate/draft/tabloid programmatically — harness convenience, playtests must use keys);
  `cheat.{xp(n), mass(n), rank(r), god(on), spawn(kind, n), boss(), killAll(), noSpawns(on), heal(), time(sec)}` (dev only);
  `shot(name): Promise<string>` (renders a frame, POSTs PNG to `/__shot/<name>`, returns the saved path);
  `perf()` → frame-time ring stats `{fps, p50, p99, max, simMs}`; `events(n)` → last n sim events.
* `vite.config.ts`: port 5178 `strictPort`, `server.headers` no-store, plugin: `POST /__shot/<name>`
  (body = PNG data URL) → `_shots/<name>.png`; `POST /__report/<name>` (JSON) → `_harness/_reports/<name>.json`.

## §15 Gates (a build is DONE only when all pass, observed)

1. `npx tsc --noEmit -p tsconfig.json` → 0 errors.
2. `node _harness/probe_sim.ts` — headless bot, all 4 titans × 3 biomes: no NaN/throw; deterministic
   (same seed ⇒ identical state hash); pacing bands: rank II 60–150 s, III 150–300 s, IV 280–450 s,
   V 400–560 s; boss spawns ≤ 560 s; a competent bot clears ≥ 8 of 12 runs in 8–12 min and dies in
   some (it is not a walkover); drafts every ~10–25 s early.
3. `python _harness/bootcheck.py` (headed Chrome, `?autostart=1`): 0 console/page errors, 0 shader
   errors, reaches `play`, frames rendering, screenshot shows the baby titan ON a zebra crossing.
4. `python _harness/playtest.py --titan X --biome Y` with REAL keyboard input from the title
   screen: navigates menus, dismisses slate, moves (> 20 m), eats props/floors, levels, drafts via
   keys, uses Space + Shift, observes effects in state; one per titan and per biome.
5. `python _harness/perfcheck.py`: Size V + 250 enemies, p99 frame ≤ 22 ms on this box (headed),
   draws ≤ 450.
6. Shots battery + a harsh visual critic pass (titan close-ups at every rank, each biome, bosses,
   telegraph readability, HUD/slate/draft/tabloid).

## §16 Lane ownership

| Lane | Files |
|---|---|
| core | `src/core/loop.ts`, `src/core/input.ts`, `src/core/debug.ts`, `src/core/save.ts` |
| city-sim | `src/data/biomes.ts`, `src/city/citygen.ts`, `src/city/citysim.ts`, `src/city/traffic.ts`, `_harness/probe_city.ts` |
| titan-sim | `src/data/titans.ts`, `src/titans/titansim.ts`, `src/titans/kits/*.ts`, `_harness/probe_titan.ts` |
| combat | `src/combat/*.ts`, `_harness/probe_combat.ts` |
| ai | `src/data/enemies.ts`, `src/data/bosses.ts`, `src/ai/enemies.ts`, `src/ai/director.ts`, `src/ai/bosses/index.ts`, `src/ai/bosses/caisson4.ts`, `src/ai/bosses/irongully.ts`, `_harness/probe_ai.ts` |
| upgrades | `src/upgrades/*.ts`, `src/data/upgrades.ts`, `_harness/probe_upgrades.ts` |
| render-core | `src/render/renderer.ts`, `camera.ts`, `materials.ts`, `lighting.ts`, `env.ts`, `warmup.ts` |
| city-kit | `src/city/meshkit.ts` |
| city-view | `src/city/cityview.ts` |
| titan-view | `src/titans/models.ts`, `anim.ts`, `titanview.ts`, `portraits.ts` |
| foes-view | `src/ai/enemyview.ts`, `src/ai/bossview.ts`, `src/ai/foemodels.ts` |
| combat-view | `src/render/telegraphview.ts`, `projectileview.ts`, `hazardview.ts` |
| fx | `src/render/fx.ts`, `debris.ts`, `civilians.ts`, `pickupview.ts` |
| ui | `src/ui/*`, `src/data/strings.ts`, font deps |
| audio | `src/audio/*.ts` |
| app | `src/main.ts`, `src/game.ts`, `src/testsurface.ts`, `index.html`, `vite.config.ts`, `README.md` |
| harness | `_harness/*.py`, `_harness/probe_sim.ts`, `_harness/bot.ts` |

Orchestrator-owned (read-only for lanes): `src/core/types.ts`, `config.ts`, `rng.ts`, `math.ts`,
`world.ts`, `src/render/viewtypes.ts`, `_spec/*`.

### v2 lane ownership (FEATURES_V2 §15.2; built C0–C4, 2026-09-24/25)

| Lane | Owns (new files) | Edited in existing files (only the named part) |
|---|---|---|
| L0 skeleton | the §2.6 stubs, `src/v2types.ts`, `_harness/bot_ult.ts` / `bot_draft.ts` / `bot_map.ts` stubs | `core/types.ts`, `config.ts`, `rng.ts`, `world.ts`, `input.ts`, `save.ts` (settings + profile stubs); the §2.7.3 hooks in `damage.ts`, `director.ts`, `enemies.ts`, `projectiles.ts`, `telegraphs.ts`, `titansim.ts`, `bosses/index.ts`, `data/upgrades.ts` (V2 append block); `game.ts`, `testsurface.ts`, `bot.ts`, `probe_sim.ts` (`--meta`, §0.6 lines), `probe_upgrades.ts` (`EXPECT`); `ai/bossview.ts` (rig exports, parkade6 placeholder); v2 signatures in `ui/menus.ts`, `select.ts`, `draft.ts`, `broadcast.ts` |
| L1 ult-sim | `src/meta/ultimate.ts`, `src/data/ultimates.ts`, `_harness/bot_ult.ts`, `_harness/probe_ult.ts` | — |
| L2 draft/evo-sim | `src/data/upgrades_v2.ts`, `src/data/evolutions.ts`, `_harness/bot_draft.ts`, `_harness/probe_evolutions.ts` | `upgrades/draft.ts` (eligibility, evo offers, banish / lock, reroll held slot), `upgrades/engine.ts` (`ultCharge`), `probe_upgrades.ts` (v2 rules) |
| L3 boss3-sim | `src/ai/bosses/parkade6.ts`, `_harness/probe_boss3.ts` | `data/bosses.ts` (parkade6), `data/biomes.ts` (`grideast.boss`) |
| L4 map-sim | `src/meta/objectives.ts`, `src/meta/powerups.ts`, `src/data/objectives.ts`, `src/data/powerups.ts`, `_harness/bot_map.ts`, `_harness/probe_map.ts` | — |
| L5 meta/endless-sim | `src/meta/tally.ts`, `endless.ts`, `perks.ts`, `goals.ts`, `profile.ts`, `src/data/goals.ts`, `perks.ts`, `palettes.ts`, `_harness/probe_meta.ts`, `_harness/probe_endless.ts` | `core/save.ts` (`loadProfile` / `saveProfile`) |
| L6 fx+audio-views | `src/render/ultview.ts`, `objectiveview.ts`, `powerupview.ts`, `markerview.ts` | `audio/sfx.ts` (v2 events + `ui()` kinds), `render/camera.ts` (`punch`), `titans/anim.ts` + `titanview.ts` (`ultimate` clip) |
| L7 parkade-view | `src/ai/foemodels_parkade.ts` | `ai/bossview.ts` (PARKADE-6 rig, pose, tow chain), `render/projectileview.ts` (`LOOK.carLob`), `audio/sfx.ts` (PARKADE voice) |
| L8 hud | `src/ui/icons.ts`, `abilitybar.ts`, `tracker.ts`, `markers.ts`, `toast.ts`, `hud_v2.css`, `src/data/strings_hud.ts`, `_harness/probe_icons.ts` | `ui/hud.ts` (chips column + hook dial removed, zoom hint moved, SHELL bar in the ACTIVE panel; `data-v2` hooks) |
| L9 screens | `src/ui/goals.ts`, `screens_v2.css`, `src/data/strings_screens.ts` | `ui/select.ts` (rows, NEXT PERMIT PENDING, perk + palette rows, G), `ui/menus.ts` (title G, GOALS chip, pause LOADOUT, settings rows), `ui/draft.ts` (banish / lock / evolution / NEW), `ui/broadcast.ts` (KEEP GOING + K, endless tabloid, NEW ON THE RECORD) |
| L10 cinematic | `src/render/cinecam.ts`, `src/ui/cine.ts`, `src/data/cine.ts` | `titans/titanview.ts` (`faceAnchor`, `setCine`, and the in-game model built in `w.meta.palette`), `titans/anim.ts` (`cine` channels), `titans/models.ts` (palette param, lids), `titans/portraits.ts` (palette arg), `_harness/bootcheck.py` + `playtest.py` (cinematic-aware), `_harness/shots.py` (group `cine`) |
| orchestrator (gates G1–G3 + final) | `_harness/playtest_v2.py`, `_harness/scratch/g3/perfquiet.py` | `game.ts` / `testsurface.ts` cross-lane wires (e.g. `cheat.objective(kind, ahead)`), `_harness/perfcheck.py` (`--v2`, `--ult-at`, `--prof`; scenario (b) runs the existing `--boss` with `parkade6 --enemies 150`), `_harness/shots.py` (groups `screens` and `parkade`, ported from the L9 / L7 scratch flows), `_harness/scratch/final/leakcheck.py` (`--cine`), `README.md`, this table |

Notes: `game.ts` and `testsurface.ts` stay orchestrator-only after C0; `ui/dom.ts` was edited by no v2 lane.
Two ownership gaps were closed by the lane that found them and are recorded here: nobody owned the in-game
palette (`w.meta.palette`, FEATURES_V2 §8.6), so L10 builds the in-game model in it in `titanview.mount()`;
and §15.4 asks every view lane for shots in `_harness/shots.py` although §15.2 lists the file for no lane
(L10 added `cine`; the orchestrator added `screens` and `parkade`).

### Gatekeeper lane ownership (GATEKEEPERS §8.2; built K0–K2, 2026-09-27/28)

| Lane | Owns (new files) | Edited in existing files (only the named part) |
|---|---|---|
| K0 skeleton (orchestrator, alone) | the inert stubs of `src/meta/gates.ts`, `src/ai/bosses/stencil1.ts` / `cordon2.ts` / `switchboard5.ts`, `src/ai/foemodels_gate.ts`, `src/data/upgrades_gate.ts`, `src/data/strings_gate.ts` (names only), `_harness/bot_gate.ts` | `core/types.ts`, `core/config.ts` (`GATES`, `GATE_HP_AT_RANK`, `GATE_HP_MUL`, `GATE2_V3`, `ENDLESS_V3`), `core/world.ts` (`flushGateBreach`, `checkRunEnd` v3), `src/v2types.ts`; the pre-wires in `titansim.ts`, `bosses/index.ts`, `combat/targeting.ts`, `combat/damage.ts`, `director.ts`, `game.ts`, `testsurface.ts`, `bot.ts`, `probe_sim.ts` (report lines); `data/bosses.ts` (role / slot / kicker, placeholder gate defs); `data/strings.ts` (the six ALERTS); `ai/bossview.ts` (placeholder branches); `meta/tally.ts` and `meta/endless.ts` (field initialisation) |
| K1a gate loop | `src/meta/gates.ts` (real), `_harness/bot_gate.ts`, `_harness/probe_gatekeepers.ts` | `meta/endless.ts` (the alternating rematch rotation), `meta/tally.ts` (gate fields and cases), `probe_sim.ts` (GATE2_V3 bands), `probe_endless.ts` (rotation), `probe_map.ts` (the ANNEX count note) |
| K1b gatekeeper sims | `src/ai/bosses/stencil1.ts`, `cordon2.ts`, `switchboard5.ts` | `data/bosses.ts` (the three final defs: attacks, subtitles, kickers) |
| K2a gate view | `src/ai/foemodels_gate.ts` | `ai/bossview.ts` (rig registration, scale by `b.data.H`, poses), `render/projectileview.ts` (`paintCan` / `sawhorse` / `callFlare`), `render/hazardview.ts` (`paint`), `render/markerview.ts` (`gate`, `weakPoint`), `render/fx.ts` (stagger words, `LIMIT LIFTED`, the strain beat, role-routed `bossStagger` / `bossPhase`), `render/civilians.ts` (`surge`), `render/camera.ts` (gate trauma cases), `titans/titanview.ts` (held-glow dim + strain squash), `audio/sfx.ts` (gate section) |
| K2b gate UI | `src/data/strings_gate.ts` (full copy) | `ui/hud.ts` (GROW bar lock), `ui/bossbar.ts` (gate variant), `ui/broadcast.ts` (`heldBy`, `REISSUED n`), `ui/markers.ts` (two kinds), `ui/icons.ts` (`gatekeeper` glyph), `probe_icons.ts` (glyph count) |
| K2c meta | `src/data/upgrades_gate.ts` (the five cards) | `data/upgrades.ts` (one append line), `data/goals.ts` (+6 goals; EARLY CLOSING 600 s), `meta/goals.ts` (6 metrics), `meta/profile.ts` (`life.gateRematches`), `data/perks.ts` + `meta/perks.ts` (DEFERRED MAINTENANCE), `probe_meta.ts` (46 goals / 50 unlock items, reachability), `probe_upgrades.ts` (coverage) |
| orchestrator (K1/K2 gates, K3, final) | `_harness/playtest_gate.py` | `game.ts` / `testsurface.ts` cross-lane wires (the finale SKIP hint, `cheat.gate*`), `_harness/shots.py` (group `gates`), `_harness/perfcheck.py` (`--gate c|d|e`), `_harness/playtest_v2.py` (step 6 picks the drafts owed from the finale with a real 1 before its tick check), `_harness/scratch/final/leakcheck.py` (`--gate`), `README.md`, this table; K3 fixes in `ui/broadcast.ts` (the finale banner pre-empts older alerts) and `render/civilians.ts` (the surge re-uses fleeing slots); final: the per-frame layout read in the views (below) |

Notes (recorded, not yet ratified by the owner):
* **Out-of-lane edits.** K2c edited `src/core/types.ts` (orchestrator-owned; the goal-metric names, the perk id and
  `life.gateRematches` its lane needed) instead of asking the orchestrator. The edits typecheck and every probe
  passes on them; they are recorded here rather than reverted.
* **SIGNAL BOOST 8 → 4 power-ups** (`data/goals.ts`, FEATURES_V2 §8.2 says 8). The goal is supply-capped:
  `probe_meta` G(a) requires every run-scope target to be ≤ what the quickest gate-bot run can drop (the
  `data/goals.ts` header), and K2c lowered it to 4 for the gated runs (the reason is K2c's, not re-measured here). FEATURES_V2 §8.2 still reads 8 until the owner ratifies 4.
* **Views read the canvas size from the renderer** (final battery, 2026-09-28). `hazardview`, `telegraphview`,
  `projectileview`, `fx` and `bossview` read `renderer.getSize()` (the CSS size `renderer.ts` passes to `setSize`)
  instead of `canvas.clientHeight`. The HUD's always-running CSS animations invalidate style every frame, so the
  first layout read of a frame forced a synchronous style/layout flush (≈ 0.3 ms). That flush was billed to
  HazardView (perf (d)'s ≤ 0.2 ms budget); with HazardView fixed alone it moved to TelegraphView. It now happens
  in `renderer.ts render()`'s own per-frame `clientWidth` check, so the frame total is about the same; a
  ResizeObserver there (render-core) is the way to remove it.
* **Git.** 112 gatekeeper files (K0–K2) were committed inside the unrelated `dyefield` commit `23185774`, because
  the forgeflow-games index is shared by concurrent sessions; `cf4dd1dc` records the K2 gate results for that
  content. Gate agents commit right after staging, from a clean index.

### Titan pass lane ownership (titanpass/TITAN_PASS.md §5; T0 skeleton 2026-09-29, on HEAD ea2a1c22)

Owner / orchestrator decisions that override the plan text: **D1** "tier" = card LEVEL, fixed with **BUILD SLOTS**
(FEATURES_V2 §7.7; not the plan's guaranteed-slot default, not the ×4 weight). **D2** gatekeeper / city-boss dash
counterplay = design B **SPACE-DENIAL rings** (GATEKEEPERS §3.6; `dr/B/dash_read.patch`); design A (dash lock) is
rejected. **D3** BRIARWICK = kit C with the hook renamed **POP-UP PARK** (§8); VOLT-KITE = the "storm-hound drake under
twin kite sails" remodel + kit set (§8). MOLO / HEARTHBACK: no change except card text that must match the code.
IRON GULLY AUGER BLAST (`coneBreath`) capped at HIT_CAP in total.

All lanes edit the SAME working tree: a lane edits only the files in its row; a file shared by two rows is edited with
targeted edits in the named region only, never rewritten. Prototypes are env-gated — the port strips every
`process.env`, `__PA`, `paTag` and experiment counter from shipped code. Cross-lane notes:
`_harness/scratch/tp/NOTES.md`; per-lane progress `_harness/scratch/tp/<LANE>/STATUS.txt`. No lane edits `types.ts`,
`config.ts`, `strings*.ts` or `_spec/*` (orchestrator-owned; ask through NOTES.md). Only the Merge agent commits.

| Lane | Owns (only these files) | Work (sources) |
|---|---|---|
| T0 skeleton (orchestrator, alone, before the lanes) | `core/types.ts`, `core/config.ts`, `data/strings.ts`, `data/strings_hud.ts`, `_spec/CONTRACT.md`, `_spec/FEATURES_V2.md`, `_spec/GATEKEEPERS.md`; the STUB exports at the top of `upgrades/draft.ts` | SimEvents `rooted` + `bloomBurst`; `RunTally.cascadeBest` + GoalMetric `'cascadeBest'`; `DraftCardSlot`, `OverflowRewardId`, `OVERFLOW_REWARD_IDS`; `bossFrameNeed(w, extra)` (the D2 ring frame guard); draft slot strings, `HUD2.pods` / `HUD2.ripe`; draft.ts `SLOT_CAP` 8, `OVERFLOW`, `slotsUsed` / `slotsFull` / `cardSlot` / `isOverflowReward` stubs (pre-D1 behaviour). Two Record/struct completions outside the row, one line each, so tsc stays 0: `meta/tally.ts` (`cascadeBest: 0` init) and `ui/goals.ts` (`METRIC_GLYPH.cascadeBest`). Gate: tsc 0, GATE 2 fresh + full hashes identical to ea2a1c22 |
| SIM (titan sim + the one boss line) | `src/titans/kits/briarwick.ts`, `src/titans/kits/voltkite.ts`, `src/ai/bosses/irongully.ts`, `src/data/titans.ts`, `_harness/probe_titan.ts` | kit C port (`titanpass/briarwick_C.ts`, FULL BLOOM → POP-UP PARK, env / `__PA` / `paTag` stripped; emit `rooted` where it sets `e.stun`, `bloomBurst` per burst); VOLT `vk/kit_tuning.diff`; IRON GULLY breath ≤ HIT_CAP in total (HEAD ea2a1c22 already caps every boss DoT tell in `bosses/index.ts bossTelegraph` — verify before adding a second cap); `data/titans.ts` BRIAR `turretCap 10` + §8 text, VOLT `armor 12` + FORK-ARC text + species, MOLO CURB BITE "22"; probe_titan: pod asserts replace the turret asserts, + a VOLT GROUNDING assert |
| VIEW (titan view, combat view, fx, audio, HUD row) | `src/titans/models.ts`, `anim.ts`, `titanview.ts`, `portraits.ts`, `src/render/hazardview.ts`, `src/render/fx.ts`, `src/render/camera.ts` (only if the stamp punch cannot use the trauma path), `src/ai/enemyview.ts`, `src/audio/sfx.ts`, `src/ui/abilitybar.ts` | VOLT `vk/model_prototype.diff`; BRIAR pod states, `'seed'` burst branch + budget, spore motes, root coils on `rooted`, POP-UP PARK stamp / ring / volley / ripple, comic words, SFX cues + voice caps, HUD "PODS n · RIPE m" + SPACE glow at ripe ≥ 3 (§8) |
| DATA (cards, goals, ult text, meta tally) | `src/data/upgrades.ts`, `src/data/upgrades_v2.ts`, `src/data/goals.ts`, `src/data/ultimates.ts`, `src/meta/tally.ts`, `src/meta/goals.ts`, `_harness/probe_upgrades.ts`, `_harness/probe_meta.ts` | stat labels; Domino Zoning, Pollinator Corridor, Guerrilla / Arbor `dur` 9; goal `g_bw_full_bloom` → `cascadeBest ≥ 18` (tally from `bloomBurst.link`; write down whether UPROAR-seeded chains count); GREENBELT text "(10)"; probe asserts for pods, card-effect uniqueness, `cascadeBest` (FEATURES_V2 §7.8 / §8.2 rows) |
| DRAFT | `src/upgrades/draft.ts` (below the T0 stub block, and the stub bodies), `src/ui/draft.ts` | D1 BUILD SLOTS per FEATURES_V2 §7.7: `slotsUsed` / `slotsFull` / `cardSlot` real, the restricted pool when full, OVERFLOW rewards (offer ids, `pickUpgrade` applies, `hasPendingDraft` stays true), draft UI tags / counter / banner / overflow cards from `STR.draft.slot*` / `overflow*`; no env switch, no experiment counters. Gates: tsc 0, `probe_upgrades` + `probe_evolutions` exit 0 (run, not edited), GATE 2 logged |
| HARN (harness + probes) | `_harness/bot.ts`, `_harness/probe_balance.ts` (new), `_harness/perfcheck.py`, `_harness/shots.py`, `src/testsurface.ts` (one cheat, if needed) | bot BRIAR reach from `kitReach` + the POP-UP PARK press rule; `probe_balance.ts` (player-like policy `pa/pa.ts`, report only); perfcheck scenario (f) `--kit briar|volt`; shots group `titanpass` (incl. a slot-full draft and an overflow draft) |
| RING (boss dash-read, D2) | `src/ai/bosses/index.ts`, `stencil1.ts`, `cordon2.ts`, `switchboard5.ts`, `parkade6.ts`, `_harness/probe_gatekeepers.ts` | apply `dr/B/dash_read.patch` minus its `config.ts` hunk (landed in T0): `DENIAL` / `denialRadii` / `denialRing`, the four rigs' rings (GATEKEEPERS §3.6), the case-6b ring check; gates per `dr/B/REPORT.md` (probe_gatekeepers, probe_boss3, probe_ai, GATE 2) |
| Merge (orchestrator) | commits; `README.md`, CHANGELOG, this table | merge order SIM → DATA → HARN → RING → DRAFT → VIEW; after each: tsc 0 + GATE 2 fresh + full (logged); then the tuning loop and the final battery (TITAN_PASS §4.4, §6) |
