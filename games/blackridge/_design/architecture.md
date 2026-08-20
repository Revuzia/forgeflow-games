# BLACKRIDGE — Technical Architecture & Module Contracts (v1 freeze)

Status: **INTERFACE FREEZE**. This document is the binding contract for every build
agent. One owner per file; never edit a file you do not own. If you need a change in
another owner's file, put a `needsElsewhere` entry in your report and code against the
contract written here. Where this document conflicts with
`pipeline/knowledge/GAME_DOCTRINE.md`, the doctrine wins; where it conflicts with an
agent's preference, this document wins.

Game: original modern-military FPS, one showcase mission ("Operation Ridgeline" — a
night raid on the Blackridge comms compound), player vs AI soldier bots, 4 weapons,
full FFG shell. No multiplayer in v1. Visual/feel bar: recent-CoD-era, honestly
approached in browser Three.js. NO CoD names/maps/assets — original IP only.

Conventions inherited (verified against the repo this session):

- Three r172 **vendored**, imported as the bare specifier `three` through an import
  map, exactly like driftwake/colosseum (`games/driftwake/index.html:24-30`,
  `games/colosseum/index.html:12-13`). Copy the vendor dir from
  `games/colosseum/assets/vendor/three/` (it includes `examples/jsm/` for the
  `three/addons/` mapping; driftwake's copy lacks it).
- No build step. Native ES modules served from disk. Dev server:
  `python forgeflow-games/serve_nocache.py 8799` (port 8788 is another project).
- `runtime/boot.js?v=N` cache-bust bumped EVERY iteration; boot.js propagates its own
  `import.meta.url` search string to every dynamic import (colosseum
  `runtime/boot.js` pattern, `index.html:25` → `boot.js?v=62`).
- Boot DOM ids match driftwake: `#view`, `#boot`, `#boot-bar`, `#boot-phase`,
  `#nogpu`, `#hint` — so `_harness/bootcheck.py` (copied from driftwake) runs with
  only its two config lines changed (URL + ready-expression; see §8).
- `window.__PAUSE__ = {pause, resume, toggle}` shell contract; ESC pauses, never
  destroys; forfeit/abandon routes through the mission-end path (doctrine §6).
- `game_controls.js` (shared FFG page furniture) loads as a classic script BEFORE
  anything else — it wraps `Audio`/`AudioContext` at load time; all our contexts are
  constructed later through `globalThis.AudioContext` so page-level Mute reaches them
  (driftwake `index.html:230-247`).

---

## 0. Non-negotiables (doctrine, restated as build rules)

1. **Sim is THREE-free, fixed-dt (60 Hz), deterministic.** Every module under
   `core/sim/` and `core/ai/` and `core/weapons/weapon_data.js` must run under Node
   (`node core/sim/sim.selftest.cjs`) with zero `three` imports. One mulberry32
   stream per system (`rng.spread`, `rng.ai`, `rng.mission`); view-side cosmetic
   randomness uses its own `rng.fx` and may never affect sim state.
2. **The view reads events + state, never writes gameplay.** One bridge file
   (`core/view/bridge.js`, FROZEN, owned by A0) dispatches sim events; continuous
   transforms are read from `sim.state` each render frame. No view module calls a
   sim mutator except through the test surface.
3. **Every deferred callback carries the sim epoch.** `sim.epoch` increments on every
   mission start; any `setTimeout`/promise continuation captured pre-await must
   no-op if `epoch` moved.
4. **compileAsync prewarm ×2** — once with a render target BOUND, once for the
   canvas — before the boot screen lifts. Acceptance: `renderer.info.programs`
   delta = 0 during the first firefight.
5. **Fixed light pools.** Light count is a shader-permutation key. All lights are
   created at boot, `visible:true, intensity:0`, and leased — never added/removed.
6. **`renderer.info.autoReset = false`** + one explicit reset per frame (A0 owns the
   reset call site in boot.js's frame fn; nobody else touches info).
7. **DPR ≤ 1.5**, shadow map 1024, GLB-embedded lights stripped,
   `frustumCulled = false` on skinned meshes, Draco+WebP on every character/weapon.
8. **Never gate boot on a fat asset.** Menu appears after shader prewarm; soldier
   GLBs stream during the menu; mission start gates on `soldiers.ready(...)` with a
   determinate bar (Colosseum requiredBodies pattern).
9. **No primitive hero assets.** Soldier bodies = Meshy auto-rigged GLBs (repair
   materials at load, never trust the bind pose — go through `Actor`). Weapon
   viewmodels are hero assets: real hard-surface GLBs from the asset pipeline, NOT
   box-compositions (last-circle's composed guns are below the Blackridge bar). An
   unresolvable asset spawns the honest dev placeholder and pushes to
   `window.__FFG_FALLBACKS__`; ship is blocked while that array is non-empty.
10. **Nothing allocates in the render loop.** Pools and scratch vectors are
    constructed at init. No `new` inside any `update()`.
11. **Referential integrity is a gate**: every content reference (mission→archetype,
    archetype→GLB, anim_map→clip-in-GLB, weapon→viewmodel GLB, scenario→fixture)
    must resolve at load; a dangling reference throws at boot in dev.
12. **Bot fairness constants** (doctrine §2 / Ironhold): reaction delay 300–800 ms
    LOS-to-first-shot scaled by distance and off-centre angle; aim jitter
    ~0.018 rad; ≤ 2 simultaneous attack tokens; muzzle-block raycast (a bot never
    fires through cover the player can't shoot through); reactions rolled ONCE per
    stimulus and latched.

---

## 1. Ownership map & file tree

11 lanes. A0 is the integrator/foundation and the only agent who edits shared entry
files. Every other agent owns a disjoint directory. `[gen]` = generated asset,
produced by the asset lane, consumed read-only.

```
games/blackridge/
  index.html                     [A0 FOUNDATION]  boot page, cap gate, importmap
  game_controls.js               (copy from games/colosseum/, DO NOT EDIT)
  game_meta.json                 [A0]  title/desc/controls/tags, status:"unpublished"
  content.json                   [A2 MISSION-DATA] mission, archetypes, scenarios, fixtures
  CREDITS.md                     [A0]  per-asset provenance (imported/generated/procedural + license)
  thumbnail.png                  [gen]
  runtime/
    boot.js                      [A0]  entry module: loop, wiring, __FPS__ global, ?v propagation
  core/
    events.js                    [A0]  event bus (ring buffer)
    rng.js                       [A0]  mulberry32 streams
    perf.js                      [A0]  frame ring, p50/p95/p99, hitch attribution
    gfx.js                       [A0]  renderer construction, caps, DPR, resize
    input.js                     [A0]  pointer lock, key/mouse state, cmd builder
    settings.js                  [A0]  S object, SCHEMA, quality presets, persistence
    view/
      bridge.js                  [A0]  FROZEN dispatcher (≤40 lines, written at freeze)
    sim/
      sim.js                     [A1 SIM]  createSim, tick orchestration
      player.js                  [A1]  movement: walk/sprint/crouch/jump/mantle-none-v1
      ballistics.js              [A1]  ray vs boxes/ground, spread, falloff, penetration-none-v1
      damage.js                  [A1]  hp/armor, hit zones, death
      world.js                   [A1]  THREE-free collision queries over collider data
      mission.js                 [A1]  objective state machine (data-driven from content.json)
      sim.selftest.cjs           [A1]  Node probe: deterministic 3k-tick battery, exit-code
    ai/
      nav.js                     [A5 AI]  grid bake from colliders + A* + string pulling
      perception.js              [A5]  LOS, hearing, last-known-position
      botfsm.js                  [A5]  8-state brain, aiStep(sim) entry
      squad.js                   [A5]  attack tokens, flank claims, bark scheduling
      ai.selftest.cjs            [A5]  Node probe: nav + fairness invariants
    weapons/
      weapon_data.js             [A4 WEAPONS]  THREE-free constants (sim imports this)
      viewmodel.js               [A4]  arms+gun rig: sway, bob, ADS lerp, kick
      recoil.js                  [A4]  pattern kick accumulator (view-side, feeds input)
      weapon_meshes.js           [A4]  GLB load + material repair + muzzle sockets
    level/
      layout.js                  [A3 LEVEL]  THREE-free single-source map layout data
      colliders.js               [A3]  THREE-free collider/spawn/cover/nav-seed export
      level.js                   [A3]  visual build of layout: buildings, terrain, kill lanes
      props.js                   [A3]  InstancedMesh prop batches
      materials.js               [A3]  PBR materials, UVs in metres/tile, WebP textures
    render/
      sky.js                     [A6 RENDER]  night sky, moon, horizon glow, env
      lighting.js                [A6]  fixed pools + lease API, sun/moon, static placements
      post.js                    [A6]  HDR chain: tonemap(AgX) + bloom + vignette + grain
      prewarm.js                 [A6]  compileAsync ×2 routine + fx-material blit
      dynres.js                  [A6]  dynamic resolution 1.0→1.5 under frame-time control
    fx/
      fx.js                      [A7 FX]  registry, pools, update; attach(bridge)
      muzzle.js                  [A7]  flash sprites + light lease
      tracers.js                 [A7]  line pool
      impacts.js                 [A7]  sparks/dust/flesh puffs (per-surface)
      decals.js                  [A7]  pooled bullet holes / scorch (≤256)
      casings.js                 [A7]  instanced shell ejection
    chars/
      actor.js                   [A8 CHARS]  Meshy Actor (TRS snapshot, clip strip, mat repair)
      anim_map.js                [A8]  semantic anim → GLB clip names (gated)
      soldiers.js                [A8]  spawn/interp/death; ready() gate; attach(bridge)
    audio/
      audio.js                   [A9 AUDIO]  context (via wrapped globalThis.AudioContext), buses
      sfx.js                     [A9]  gunshots+tails, impacts, footsteps, reloads, UI
      ambience.js                [A9]  night wind, distant war, insects
      music.js                   [A9]  menu/stinger beds (catalog track or procedural)
    hud/
      hud.js                     [A10 HUD/SHELL]  crosshair, ammo, health, hitmarker,
                                                  killfeed, objective tracker, damage dir
      menu.js                    [A10]  title/menu screens, screenBefore discipline
      pause.js                   [A10]  ESC overlay: Resume/Settings/confirm-Abandon
      settings_ui.js             [A10]  quality/volume/sensitivity/fov panel
    test/
      testsurface.js             [A11 QA]  window.__FPS__.__test implementation
      scenarios.js               [A11]  setScenario poses (data in content.json)
      autoplay.js                [A11]  scripted play profiles + event counters
  assets/
    vendor/three/                (copy from games/colosseum/assets/vendor/three/, incl. examples/jsm)
    vendor/draco/                (copy decoder from colosseum vendor if present, else three examples)
    chars/*.glb                  [gen]  Meshy soldier bodies, Draco+WebP, ≤400 KB each
    weapons/*.glb                [gen]  hard-surface viewmodels, ≤250 KB each
    textures/*.webp              [gen]  level PBR sets, ≤2048², tiled in metres
    audio/**                     [gen]  SFX/ambience files
    manifest.json                [A0 schema; asset lane fills]  every file + bytes + license
  _design/
    architecture.md              (this file)
  _harness/                      [A11 QA]
    bootcheck.py                 copy of driftwake's; 2 config lines changed (§8)
    shots.py                     shot battery via __test.setScenario + capture
    autoplay.py                  drives __test.autoplay on local + deployed URL
    bench.py                     ?bench=1 runner, before/after JSON diff
```

**Shared-write exceptions:** none. `content.json` has one owner (A2) — other agents
request content additions via `needsElsewhere`. `assets/manifest.json` is appended by
the asset producer only.

---

## 2. Data flow (one diagram to rule the lanes)

```
input.js ──cmd──▶ sim.step(cmd) ──events──▶ events bus ──drain──▶ bridge ──▶ fx/audio/hud/chars handlers
                    │   ▲                                              (registered, frozen names)
                    │   └── ai (botfsm.aiStep, inside the tick, rng.ai)
                    │
                    └── sim.state (plain data) ◀─read-only each frame─ soldiers.update / viewmodel.update / hud.update
```

- **cmd** is built once per sim tick by `input.buildCmd()` (see §3.4).
- **events** are plain objects `{t, type, data}` accumulated during `sim.step`,
  drained once per render frame by boot.js, dispatched by bridge.
- **state reads** (positions, aim, ammo) are continuous — NOT events.
- View→sim writes happen in exactly two places: the cmd stream, and the
  `__FPS__.__test` mutators (which call documented sim methods).

---

## 3. Module contracts (the freeze)

Signatures below are exact. You may ADD private exports; you may not rename,
re-sign, or repurpose anything listed. All positions are `[x,y,z]` metre arrays in
sim-land (THREE-free) and `THREE.Vector3` only inside view modules. +Y up, -Z is
"north" on the map. Angles radians. Time seconds. `who` is `'P'` (player) or a
numeric `botId`.

### 3.1 core/events.js [A0]

```js
export function makeBus() // → bus
// bus.emit(type, data)        push {t: simTime, type, data}; O(1), pooled
// bus.drain() → Array         returns & clears the pending list (boot calls 1×/frame)
// bus.count(type) → int       running per-type counters since last resetCounters()
// bus.resetCounters()
```

### 3.2 core/rng.js [A0]

```js
export function mulberry32(seed) // → () => float [0,1)
export function makeStreams(seed) // → { spread, ai, mission, fx }  (independent streams)
```

### 3.3 core/view/bridge.js [A0 — FROZEN, written at freeze time, never edited after]

```js
export function makeBridge() // → bridge
// bridge.register(type, fn)   fn(data, t); multiple handlers per type allowed
// bridge.dispatch(events)     for each event, call every handler registered for its type
// bridge.clear()              drop all handlers (called on mission teardown)
```

Consumers self-register: each of fx/audio/hud/soldiers exports
`attach(bridge, ctx)` and registers ONLY the events in the vocabulary table (§4).
Nobody edits bridge.js — that is how ten agents share one bridge without conflicts.

### 3.4 core/input.js [A0]

```js
export function createInput(canvas, settings) // → input
// input.state        live: {moveX, moveZ, jump, crouch, sprint, fire, ads, reload,
//                          switchTo:null|weaponId, interact, yaw, pitch}
//   fire/ads/etc are PLAIN configurable data properties (harness pins them with
//   Object.defineProperty — driftwake ARCHITECTURE §2 rule). Never accessors,
//   never read through cached locals.
// input.buildCmd() → cmd     snapshot for one sim tick:
//   {moveX:-1..1, moveZ:-1..1, yaw, pitch, jump:bool, crouch:bool, sprint:bool,
//    fire:bool, ads:bool, reload:bool, switchTo:null|string, interact:bool}
// input.addLook(dyaw, dpitch)   used by recoil kick and __test.look
// input.lock() / input.unlock() pointer lock mgmt (lock only on user gesture)
// input.enabled = bool          gated false in menu/pause (hotkey gate, doctrine §6)
```

Yaw/pitch are applied to `input.state` immediately on mousemove (zero look latency)
and enter the sim via the next cmd — the sim's stored aim is authoritative for
ballistics; the camera renders from `sim.state.player.yaw/pitch` plus view-only
bob/kick offsets.

### 3.5 core/sim/sim.js [A1] — the heart

```js
export function createSim(opts) // → sim
// opts: { content,          // parsed content.json
//         colliders,        // from level/colliders.buildColliders(seed)
//         nav,              // from ai/nav.bakeNav(colliders)
//         weapons,          // WEAPONS table from weapons/weapon_data.js
//         seed,             // int
//         emit }            // bus.emit
// sim.step(cmd)             ONE fixed tick, dt = 1/60 exactly. No other dt exists.
// sim.state                 plain-data tree, shape in §3.5.1. View reads, never writes.
// sim.snapshot() → obj      JSON-safe structuredClone of state (tests/HUD dumps)
// sim.epoch                 int; caller (boot) sets before first step; sim never changes it
// sim.spawnBot(archetype, x, z, o={}) → botId     o: {yaw, patrol:[[x,z]...], alerted}
// sim.damage(who, amount, src='test')             routes through damage.js
// sim.teleport(who, x, y, z)
// sim.aimAt(x, y, z)        sets player yaw/pitch to face point (test use)
// sim.setGod(bool) / sim.setNoTarget(bool)
```

Tick order inside `step` (fixed, documented so probes can reason about it):
1. player movement + stance (player.js) from cmd
2. player weapon state machine (fire/ads/reload/switch) → `shot` events via ballistics
3. AI: `aiStep(sim, nav, squad, dt)` — round-robin, ≤4 brains think per tick,
   every brain acts every tick on its latched intent
4. bot weapon fire → ballistics
5. damage resolution + death (damage.js)
6. mission.js objective checks + phase transitions
7. counters + timeout referees (every engagement ends; doctrine §2)

#### 3.5.1 sim.state shape (frozen)

```js
{
  tick, time, phase: 'menu'|'infil'|'assault'|'exfil'|'won'|'lost',
  player: {
    pos:[3], vel:[3], yaw, pitch, stance:'stand'|'crouch', grounded:bool,
    hp:0..100, alive:bool,
    weapon: { id, mag, reserve, state:'idle'|'firing'|'reloading'|'switching',
              ads:bool, adsT:0..1, recoilIndex:int, stateT:sec },
    slots: [weaponId, weaponId],      // primary, secondary
    speedNorm: 0..1                    // for bob/footsteps
  },
  bots: [ { id, archetype, pos:[3], yaw, hp, alive:bool,
            state:'patrol'|'suspicious'|'alert'|'combat'|'flank'|'suppress'|'retreat'|'dead',
            anim:'idle'|'walk'|'run'|'crouch_idle'|'crouch_walk'|'aim'|'fire'|'hit'|'death_a'|'death_b',
            aimAt:[3]|null, stance:'stand'|'crouch' } ],
  objectives: [ { id, label, state:'locked'|'active'|'done' } ],
  counters: { shotsFired, shotsHit, kills, headshots, damageDealt, damageTaken, deaths }
}
```

### 3.6 core/sim/world.js [A1]

```js
export function makeWorld(colliders) // → world  (THREE-free)
// world.raycast(origin:[3], dir:[3], maxDist) → null | {pos:[3], normal:[3], dist, surface, box}
// world.sphereGround(x, z) → y                 ground height (terrain planes + box tops)
// world.moveCapsule(pos:[3], vel:[3], dt, radius, height) → {pos:[3], vel:[3], grounded, hitWall}
// world.losBlocked(a:[3], b:[3]) → bool        (perception + muzzle-block checks)
```

### 3.7 core/sim/ballistics.js [A1]

```js
export function fireShot(sim, shooter, weapon, origin:[3], aimDir:[3], rng) // → hit|null
// applies spread cone (hip/ads/move multipliers from weapon_data), recoil pattern
// offset at player.weapon.recoilIndex, per-pellet loop (pellets field), raycasts
// world → nearest of {world hit, bot capsule+head sphere, player}, applies falloff
// damage via damage.js, emits ONE 'shot' event per pellet (see §4).
// Hitscan v1: muzzleVel is Infinity for all four weapons; the field exists so a
// projectile path can be added without re-signing.
```

### 3.8 core/sim/mission.js [A1] — data-driven from content.json (A2 owns data)

```js
export function makeMission(content, emit) // → mission
// mission.start(sim)
// mission.tick(sim)          objective triggers: reach-zone, kill-count, interact
// mission.forfeit(sim)       routes to phase 'lost' through the SAME end path
// content.json contract (A2): { mission: { id, phases:[...], objectives:[
//   {id, label, kind:'reach'|'clear'|'interact', zone:[x,z,r] | area:[minXZ,maxXZ] | node:string,
//    unlocks:[objectiveId...] } ], spawns:{waves:[{trigger, bots:[{archetype,pos,patrol}]}]} } }
// Every objective/archetype/node reference is resolved at makeMission() — throw on dangling.
```

### 3.9 core/ai/* [A5] — THREE-free, imported by sim

```js
// nav.js
export function bakeNav(colliders, opts={cell:1.0}) // → nav
// nav.findPath(from:[3], to:[3]) → [[x,y,z],...] | null    A* + string pulling
// nav.randomPoint(near:[3], r) → [3]
// nav.reachable(from:[3], to:[3]) → bool
// grid ≤ 160×160 cells, baked once at mission load (<150 ms budget, measured in selftest)

// perception.js
export function perceive(bot, sim, world, dt, rngAi) // → mutates bot.percept:
// { seesPlayer:bool, lastKnown:[3]|null, heardAt:[3]|null, firstSeenT:sec }
// hearing updates lastKnown ONLY (never a magic wallhack; Claude-of-Duty pattern)

// botfsm.js
export function aiStep(sim, nav, squad, dt) // top-level, called by sim.step
// 8 states as in state shape §3.5.1. Fairness invariants (ai.selftest.cjs asserts):
//  - LOS→first-shot delay 300–800 ms scaled by dist + off-centre angle
//  - aim jitter 0.018 rad baseline (difficulty scales these two knobs only)
//  - fires only with squad token (≤2); tokenless bots flank/suppress-reposition
//  - muzzle-block: world.losBlocked(muzzle, target) refuses the shot
//  - reaction rolls latch per stimulus; burst limits count BLOWS not ticks

// squad.js
export function makeSquad() // → squad
// squad.requestToken(botId) → bool   ≤2 held simultaneously
// squad.release(botId)
// squad.claimFlank(botId, 'L'|'R') → bool   one claimant per side
// squad.reset()
```

### 3.10 core/weapons/weapon_data.js [A4] — THREE-free (sim imports it)

```js
export const WEAPONS = { havoc7:{...}, wraith9:{...}, longbow:{...}, p11:{...} };
```

Roster (original IP names) and REQUIRED fields per entry:

| id | name | class | role |
|---|---|---|---|
| `havoc7` | HAVOC-7 | ar | full-auto 5.56 AR, mission primary |
| `wraith9` | Wraith-9 | smg | suppressed SMG, CQB alt primary |
| `longbow` | Longbow DMR | dmr | semi-auto marksman, 3.2× ADS |
| `p11` | P-11 | pistol | sidearm, always in slot 2 |

```js
{ name, class, auto:bool, rpm,
  damage: { body, headMult, limbMult, falloffStart, falloffEnd, min },
  spread: { hip:rad, ads:rad, moveMult, crouchMult }, pellets:1,
  recoil: { pattern:[[dYaw,dPitch],...>=12], scale, recoverPerS },
  adsTime:s, adsFov:deg, mag, reserve, reloadS, reloadEmptyS, switchS,
  muzzleVel: Infinity, tracerEvery:int,
  view: { glb:'assets/weapons/<id>.glb', posHip:[3], posAds:[3], muzzle:[3], scale } }
```

Baseline feel numbers (tune within ±30% only, they anchor to the CoD-era bar):
havoc7 rpm 750, body 26, head ×1.8, adsTime 0.24; wraith9 rpm 880, body 20,
adsTime 0.19; longbow rpm 240 semi, body 62, head ×2.0, adsTime 0.34, adsFov 20;
p11 rpm 400 semi, body 30, adsTime 0.16. ADS move speed ×0.6; sprint blocks fire
with a 0.18 s sprint-out delay (sim/player.js implements, reads these from a
shared `FEEL` export in weapon_data.js).

### 3.11 core/weapons/viewmodel.js + recoil.js + weapon_meshes.js [A4]

```js
// viewmodel.js
export function createViewmodel(ctx) // → vm
// vm.equip(weaponId) → Promise      swaps GLB (preloaded during menu)
// vm.update(dt)                     reads ctx.sim.state.player: bob (speedNorm),
//                                   sway (input look vel), ADS pose lerp (adsT),
//                                   sprint lower, reload/switch dip
// vm.kick(weaponId)                 visual punch; bridge calls on shot(shooter 'P')
// vm.muzzleWorld(outVec3) → outVec3 world muzzle pos for fx
// vm.setVisible(bool)
// Renders in the MAIN scene (no second scene — dual-scene viewmodel lighting is a
// documented trap, adoption_plan "skipped"). camera-attached group, near plane 0.01,
// renderOrder high + depthTest on (clip-through accepted at this bar), FOV-independent
// pose via its own group scale.

// recoil.js
export function createRecoil(input) // → recoil
// recoil.kick(weaponId)             adds pattern step to accumulator AND calls
//                                   input.addLook(dYaw, dPitch) — recoil is REAL:
//                                   the player fights it; sim aim already moved.
// recoil.update(dt)                 recovery decay (recoverPerS)
// bridge wires: on shot(shooter='P') → recoil.kick + vm.kick.

// weapon_meshes.js
export async function loadWeaponGLB(id) // → THREE.Group  (cached; Draco+WebP;
// strips embedded lights; repairs materials; resolves view.muzzle socket or uses
// the data offset; on failure: dev placeholder + __FFG_FALLBACKS__ push)
```

### 3.12 core/level/* [A3]

```js
// layout.js — THREE-free SINGLE SOURCE. colliders.js and level.js both read this;
// visual geometry and collision can therefore never drift.
export function buildLayout(seed) // → layout
// layout: { buildings:[{footprint, floors, kind}], walls:[...], props:[{kind,pos,rot}],
//           roads:[...], terrain:{...}, zones:{...}, lightPoles:[{pos,color}] }

// colliders.js
export function buildColliders(seed) // → colliders (THREE-free)
// { boxes: [{min:[3], max:[3], surface:'concrete'|'metal'|'dirt'|'wood'|'glass'}],
//   groundY: (x,z)=>y,
//   spawns: { player:[3], playerYaw },
//   cover:  [{pos:[3], dir:[3], height:'low'|'high'}],
//   nodes:  { gate:[3], motorpool:[3], uplink:[3], exfil:[3], overlook:[3], range12m:[3], range40m:[3] },
//   bounds: {min:[3], max:[3]} }
// `nodes` keys are referenced by content.json objectives and scenarios — contract-gated.

// level.js
export async function buildLevel(ctx) // → { group, staticLightSpecs }
// staticLightSpecs: [{kind:'point'|'spot', pos, color, intensity, distance}] — A6
// binds these to pool slots at boot; level NEVER creates THREE.Light instances.
// Map: ~180×180 m night compound — gatehouse, two barracks, motor pool with
// vehicle hulks, comms building with uplink mast, perimeter wall, ridge overlook.
// Interiors only where objectives need them. Kill lanes sized to weapon bands
// (SMG 5–15 m courtyards, AR 15–40 m lanes, DMR 40–90 m ridge line).

// props.js
export function buildProps(layout, ctx) // → { group, batches:int }
// InstancedMesh per prop kind: crates, barrels, sandbags, fence panels, barriers,
// pallets, floodlight poles. ≤ 40 instanced batches total.

// materials.js
export function makeMaterials(ctx) // → { concrete, metal, dirt, asphalt, wood, glass, ... }
// MeshStandardMaterial + WebP maps ≤2048², UVs authored in METRES/TILE (doctrine §3).
```

### 3.13 core/render/* [A6]

```js
// lighting.js
export function createLights(ctx) // → lights
// Fixed pool created at boot, ALL visible:true intensity:0:
//   1 DirectionalLight (moon, shadow 1024, tight frustum over playspace)
//   1 HemisphereLight
//   10 PointLight  (static leases: ~6 compound lamps; dynamic leases: 4 for fx)
//   4 SpotLight    (static leases: floodlights)
// lights.bindStatic(specs)            consumes level's staticLightSpecs at boot
// lights.lease(kind) → slot|null      slot: {set(pos,color,intensity,distance), release()}
// lights.dynamicFree() → int          fx checks before flashing; 0 free = skip light, keep sprite
// lights.moon / lights.hemi           direct refs for sky/post tuning

// sky.js
export function createSky(ctx) // → sky
// sky.mesh; sky.update(dt)  night sky dome: stars, moon disc, horizon city-glow,
// low cloud band. Fragment-shader dome, no textures >1024. sky.env() → PMREM env for
// standard materials (baked ONCE at boot).

// post.js
export function createPost(ctx) // → post
// post.render(scene, camera)   HDR RGBA16F target → AgX tonemap + threshold bloom
//                              (muzzle/lamps) + vignette + subtle grain → canvas
// post.resize(w, h); post.setQuality('low'|'med'|'high')  low = tonemap only
// Composer note: renderer.info reset discipline is A0's; post must not touch info.

// prewarm.js
export function prewarm(renderer, scene, camera, extras) // → Promise<{programs:int}>
// 1) bind a scratch WebGLRenderTarget (same format as post's HDR target),
//    compileAsync(scene, camera) from 2 poses (vista node + hipfire node), and
//    DRAW each fx pool material once into the RT (compileAsync alone leaves ANGLE
//    D3D11 uploads cold — measured in driftwake shadows.js:608).
// 2) unbind, compileAsync again for the canvas-variant programs.
// extras: [materials/objects the fx+viewmodel pools expose via fx.prewarmables()
//          and vm-equivalent]. Acceptance: info.programs delta 0 in first firefight.

// dynres.js
export function createDynres(renderer, perf) // → dynres
// dynres.update()  once/frame: p95 of last 120 frames > 20 ms → step DPR down 0.1
//                  (floor 1.0); < 13 ms for 300 frames → step up (ceil min(1.5, device DPR))
```

### 3.14 core/fx/* [A7]

```js
// fx.js
export function createFx(ctx) // → fx
// fx.attach(bridge)     registers: shot, death, land, hurt (flesh puff on bot hurt)
// fx.update(dt)
// fx.prewarmables() → [THREE.Object3D]   one instance of every fx material for prewarm
// All pools preallocated: 24 tracers, 12 muzzle sprites, 64 impact bursts,
// 256 decals (ring buffer), 96 casings (one InstancedMesh), 4 leased lights max.
// Every fx event handler is epoch-checked via ctx.sim.epoch capture.
```

Per-surface impact table (frozen keys — audio shares them): `concrete` (grey dust +
sparks few), `metal` (bright sparks + ping), `dirt` (brown puff), `wood` (splinters),
`glass` (shards), `flesh` (red puff, restrained).

### 3.15 core/chars/* [A8]

```js
// actor.js  (port the colosseum Actor discipline)
export async function loadBody(name) // → proto   cached per name; repairs Meshy
// materials at load (metalness 0, roughness .78, emissive black+map null); strips
// .scale tracks and (Shoulder|Arm|Hand).position tracks; snapshots node TRS BEFORE
// any mixer; frustumCulled=false on skinned meshes; strips embedded lights.
export function createActor(proto) // → actor
// actor.root:THREE.Group  actor.play(anim, {fade=0.15})  actor.update(dt)
// actor.attachWeapon(group, hand='R')  world-space solve, full basis (doctrine §1)
// actor.dispose()

// anim_map.js
export const ANIMS = { idle, walk, run, crouch_idle, crouch_walk, aim, fire, hit,
                       death_a, death_b } // semantic → clip name per archetype
export function validateAnimMap(protoClips) // throws on dangling (contract gate)

// soldiers.js
export function createSoldiers(ctx) // → soldiers
// soldiers.ready(archetypes) → Promise   requiredBodies gate before mission start;
//                                        reports progress cb for the mission load bar
// soldiers.attach(bridge)                spawn/death/botstate handlers
// soldiers.update(dt, alpha)             reads ctx.sim.state.bots; interpolates
//                                        prev→curr tick positions with alpha; drives
//                                        actor.play from bot.anim; off-screen actors
//                                        evaluate pose 1-in-3 frames w/ dt accumulate
// soldiers.count() → {alive, total}
```

Archetypes v1 (content.json `archetypes`, A2 owns; A8 provides bodies):
`rifleman` (havoc7), `cqb` (wraith9), `marksman` (longbow). Bodies: 2 Meshy
soldier GLBs reused with material tint variants — 3 archetypes do NOT need 3 bodies.

### 3.16 core/audio/* [A9]

```js
// audio.js
export function createAudio(ctx) // → audio
// audio.unlock()               first user gesture (menu click); constructs context
//                              via globalThis.AudioContext (post-wrap; page Mute works)
// audio.attach(bridge)         shot (distance/indoor filter, suppressed variant for
//                              wraith9), reload, step, land, empty, ads, death, bark,
//                              objective, mission:end
// audio.setVolumes({music, sfx})   wired from settings + shell mutechange event
// audio.update(dt)             listener follows camera
// Buses: master → {sfx, music, ambience}. Positional panner for bot shots/barks.
```

Gunshots: layered close crack + 0.8 s tail; distant bot fire uses the tail only.
Footsteps keyed to the surface vocabulary in §3.14.

### 3.17 core/hud/* [A10]

```js
// hud.js
export function createHud(ctx) // → hud
// hud.attach(bridge)   hurt(victim P → red vignette pulse + directional chevron from
//                      data.dir), shot(shooter P + hit.entity → hitmarker; headshot
//                      variant), death(attacker P → killfeed row), objective,
//                      reload/switch/ads (ammo + crosshair state), mission:phase/end
// hud.update(dt)       ammo, hp, compass strip, objective distance
// hud.show()/hide()    hidden in menu + scenario 'vista'
// DOM-based (like colosseum), inline styles, no external fonts before menu.

// menu.js
export function createMenu(ctx, cb) // → menu
// cb: { onStartMission(), onSettings(), onQuality(q) }
// menu.show(screen)    'title'|'briefing'|'settings'|'credits'; ASSIGNS
//                      menu.screenBefore on every navigation (doctrine §6)
// menu.hide()

// pause.js
export function createPause(ctx, cb) // → pauseCtl
// cb: { onResume(), onAbandon() }   Abandon = confirm → mission.forfeit (real loss path)
// pauseCtl.pause()/resume()/toggle()/get active()
// boot.js wires window.__PAUSE__ = {pause, resume, toggle} to this, gates the sim
// accumulator (step fn gated + accumulator discarded on resume — doctrine §5),
// and pauses audio. ESC handled here; menu/settings hotkeys gated while mission live.

// settings_ui.js
export function createSettingsUI(ctx) // → panel  (quality low/med/high, sensitivity,
// FOV 70–110, volumes; writes through core/settings.js S + persists localStorage)
```

### 3.18 core/settings.js / core/gfx.js / core/perf.js [A0]

```js
// settings.js
export const S = { quality:'med', fov:80, sens:1.0, music:0.3, sfx:1.0, ... };
export function onChange(key, fn); export function set(key, val); // persists

// gfx.js
export function initRenderer(canvas) // → renderer   WebGL2, antialias:false (post AA
// not in v1 — bloom+grain hide it), outputColorSpace LinearSRGB (post encodes),
// toneMapping NONE (post owns), shadowMap PCF 1024, DPR min(devicePixelRatio,1.5),
// info.autoReset = false
export function checkCaps() // → {ok, fatal:[], missing:[]}  (mirrors index.html gate)

// perf.js
export function createPerf(renderer) // → perf
// perf.frame(ms)               called by boot each frame WITH programs/textures counts
// perf.stats() → { fps, p50, p95, p99, hitches:[{i, ms, cause:'shader-compile'|
//                  'upload'|'unknown'}], drawCalls, triangles, programs }
// hitch = frame > max(2*median, median+8ms); programsDelta>0 → shader-compile;
// texturesDelta>0 → upload (adoption_plan p99 verdict spec).
// perf.benchDump() → JSON      for ?bench=1
```

---

## 4. Event vocabulary (frozen — the sim→view bridge)

Emitters: A1 (sim/ai lanes emit through the sim's `emit`). Consumers register in
`attach(bridge, ctx)`. Adding an event type requires an A0-approved freeze
amendment appended to this file's changelog — never an ad-hoc emit.

| type | data | consumers |
|---|---|---|
| `mission:start` | `{missionId, epoch}` | hud, audio, fx(clear pools), soldiers(clear) |
| `mission:phase` | `{phase, prev}` | hud, audio(music stinger), ai-none |
| `mission:end` | `{result:'won'\|'lost', stats:counters}` | hud(debrief), audio, boot(→menu after debrief) |
| `objective` | `{id, state, label}` | hud, audio(ping) |
| `shot` | `{shooter:'P'\|botId, weaponId, origin:[3], dir:[3], hit:{pos:[3], normal:[3], surface, entity:'P'\|botId\|null, part:'head'\|'body'\|'limb'\|null}\|null, tracer:bool, pellet:int}` | fx(muzzle+tracer+impact), audio(bang by distance/suppressor), hud(hitmarker if shooter P ∧ entity), soldiers(fire anim if shooter bot), viewmodel-via-bridge(kick if 'P') |
| `hurt` | `{victim, attacker, amount, hp, part, dir:[3]}` | hud(vignette+chevron if victim P), fx(flesh puff if victim bot), soldiers(hit anim), audio |
| `death` | `{victim, attacker, headshot, pos:[3], dir:[3]}` | soldiers(death anim/pose), hud(killfeed), audio, fx |
| `spawn` | `{botId, archetype, pos:[3], yaw}` | soldiers |
| `reload` | `{who, weaponId, phase:'start'\|'done', duration}` | audio, hud(ammo), viewmodel(dip on 'P') |
| `switch` | `{who:'P', from, to}` | viewmodel.equip, hud, audio |
| `ads` | `{on}` | audio(cloth), hud(crosshair fade), — vm reads adsT from state |
| `step` | `{who, surface, sprint:bool}` | audio |
| `land` | `{who, height}` | audio, fx(dust if height>1.5) |
| `botstate` | `{botId, state, prev}` | soldiers(anim), audio(bark scheduling via `bark`) |
| `bark` | `{botId, kind:'contact'\|'flank'\|'down'\|'reload'\|'grenade-none-v1'}` | audio |
| `empty` | `{who, weaponId}` | audio(click), hud(ammo flash) |

Rules: events carry PLAIN data (arrays, numbers, strings) — never THREE objects,
never live sim references. Continuous data (positions, adsT, ammo count) is state,
not events; the two HUD exceptions (ammo on reload/switch) exist because they are
edges, not levels.

---

## 5. Boot sequence spec (runtime/boot.js [A0])

`index.html` (skeleton in §7) runs the cap gate, then injects
`runtime/boot.js?v=N` as a module. boot.js reads `new URL(import.meta.url).search`
into `V` and appends `V` to EVERY dynamic import (colosseum pattern) — bumping one
number busts the whole graph. Serve dev with `serve_nocache.py` (no-store).

Phases — each sets `#boot-phase` text (lower-case, bootcheck-visible) and advances
`#boot-bar` (real fractions, this bar is determinate):

| # | phase text | work | budget |
|---|---|---|---|
| 1 | `initialising` | parse `?v`, `?fixture`, `?bench`; `gfx.initRenderer`; settings load | <100 ms |
| 2 | `loading core` | dynamic-import all core modules (parallel `Promise.all`, `V`-suffixed) | net-bound |
| 3 | `building world` | `buildLayout(seed)` → `buildColliders` → `bakeNav` → `buildLevel` + `buildProps` + `createSky` + `createLights.bindStatic` | <900 ms |
| 4 | `loading weapons` | `loadWeaponGLB('havoc7')` + `('p11')` ONLY (mission loadout); viewmodel constructed | small GLBs |
| 5 | `compiling shaders` | `prewarm(renderer, scene, camera, [...fx.prewarmables(), vmProto])` — RT-bound pass, draws, then canvas pass | ~1–1.5 s |
| 6 | `ready` | `#boot` gets class `gone` (node removed 6 s later, driftwake loading.js pattern); `menu.show('title')` | — |

Background during menu (never blocks boot): `soldiers` body GLBs, `wraith9` +
`longbow` GLBs, audio buffers, music. All tracked in a `bgLoad` progress object.

`startMission()` (menu → play):
1. mission loading overlay (determinate: `soldiers.ready(missionArchetypes)` +
   remaining weapon GLBs + audio); this screen is allowed to wait on fat assets —
   the TITLE screen never is (doctrine §3).
2. `epoch++`; `bus.resetCounters()`; `sim = createSim({content, colliders, nav,
   weapons, seed, emit: bus.emit})`; `sim.epoch = epoch`; `bridge.clear()`; call
   every subsystem's `attach(bridge, ctx)`; `mission.start(sim)`.
3. hud.show(); input.enabled = true; pointer lock on first canvas click.

Frame loop (the only rAF in the game):
```js
// fixed-dt accumulator, 60 Hz, max 5 steps/frame (clamp discards the remainder);
// paused ⇒ no steps AND acc = 0 (resume must not fast-forward — doctrine §5);
// alpha = acc / DT passed to view updates for interpolation.
renderer.info.reset();               // autoReset=false discipline, once, here only
while (acc >= DT && steps < 5) { sim.step(input.buildCmd()); acc -= DT; steps++; }
bridge.dispatch(bus.drain());
recoil.update(dt); vm.update(dt); soldiers.update(dt, alpha); fx.update(dt);
hud.update(dt); audio.update(dt); sky.update(dt); dynres.update();
post.render(scene, camera);
perf.frame(ms /* + programs/textures counts */);
```

`?fixture=<scenario>`: after phase 6, skip menu, run `__test.setScenario(name)`
(names contract-gated against content.json `scenarios`). `?bench=1`: fixture
`night_firefight` + `autoplay('objective', 30)` + `perf.benchDump()` →
`window.__BENCH__` + POST `/__shot/bench.json`.

---

## 6. Test surface (window.__FPS__ [A11 owns core/test/*; A0 assigns the global])

Assigned at the END of boot phase 6, after which
`console.log("[boot] COMPLETE — __FPS__ assigned (v<N>)")` — the deterministic
"eval done" signal harnesses poll for. Also aliased: `window.__FFG3D__ =
window.__FPS__` so existing pipeline QA bots and `_play` launcher hooks work
unchanged.

```js
window.__FPS__ = window.__FFG3D__ = {
  renderer, scene, camera,
  get sim() {...}, lights, fx, hud, vm, soldiers, audio, settings: S,
  version: 'v<N>',                       // MUST equal the boot.js?v number
  stats() → {                            // colosseum shape + perf verdict fields
    fps, frameMs, p50, p95, p99, hitches, dpr, drawCalls, triangles, programs,
    geometries, textures, bots: soldiers.count(), phase: sim.state.phase, frames },
  __test: { ... }                        // below
};
```

`__test` members (every mutator epoch-safe; every return JSON-safe):

```js
startMission(opts={seed}) → Promise      // full real path incl. soldiers.ready gate
state() → sim.snapshot()
step(n=1, dt=1/60) → {frames, totalMs, msPerFrame, drawCalls, triangles}
   // drives THE SAME step+dispatch+render path synchronously with gl.finish()
   // timing (colosseum boot.js pattern) — hidden tabs have no rAF; without this
   // every automated check sees a dead game.
spawnBot(archetype, x, z, opts) → botId
teleport(x, y, z)                        // player
aimAt(x, y, z)                           // player yaw/pitch face point
aimAtBot(botId, part='body')
fire(n=1) → Promise                      // REAL input path: dispatches mousedown/
                                         // mouseup MouseEvents on #view spanning n
                                         // sim ticks (doctrine §5: instrument real
                                         // input, not a bypass)
fireRaw(ticks=1)                         // fallback: pins input.state.fire for N ticks
press(code, ms) → Promise                // real KeyboardEvent down/up (e.g. 'KeyR')
look(dyaw, dpitch)                       // input.addLook
damage(who, amount)
god(on) / noTarget(on)
counters() → { ...sim.state.counters, events: bus per-type counts }
resetCounters()
setScenario(name) → Promise              // §6.1
capture(name='shot.png', w=1600, h=900, opts) → Promise
   // RT render + readRenderTargetPixels + row-flip + POST /__shot/<name>
   // (colosseum implementation verbatim — hidden-tab-proof; never toDataURL)
autoplay(profile, seconds) → Promise<report>   // §6.2
pause(on)                                // drives the same gate as __PAUSE__
setTimeOfDay(k)                          // 'night' (default) | 'dusk' — sky rebake
```

### 6.1 setScenario — the deterministic shot battery

Named world+camera poses so the critic loop captures IDENTICAL framings every
iteration. Scenario data lives in `content.json` → `scenarios` (A2), positions
referenced by collider `nodes` keys (contract-gated). Implementation
(`core/test/scenarios.js`): fixed seed per scenario, teardown current mission,
`startMission({seed})`, place player/bots exactly, aim exactly, `step()` an exact
tick count, then hold paused (autoplay of time stops) so `capture()` is
bit-stable modulo GPU noise.

| name | pose (frozen) |
|---|---|
| `menu` | title screen, menu visible, HUD hidden |
| `vista` | player at `nodes.overlook`, yaw SW over the lit compound, HUD hidden, hipfire pose, 240 ticks settled |
| `hipfire` | player at `nodes.range12m` origin, one `rifleman` at 12 m dead ahead (noTarget on), havoc7 hip, mid-burst: fireRaw pinned, captured on tick where muzzle sprite is live |
| `ads` | longbow ADS (adsT=1) on a `marksman` at 40 m from `nodes.range40m`, breath still |
| `night_firefight` | 4 bots in combat state around `nodes.motorpool`, player behind low cover, 2 bots firing (tokens forced), tracers + 2 leased muzzle lights live, HUD on |
| `muzzle` | camera low-right of havoc7 muzzle, single-shot flash frame (step to the exact emit tick), bloom visible |

`_harness/shots.py` iterates this table → `_shots/<name>.png`; the blind A/B critic
loop (memory: blind_ab_render_harness) diffs against reference-bar screenshots.

### 6.2 Autoplay bots (scripted PLAY with event counters — doctrine §5)

`core/test/autoplay.js` drives the REAL input path (KeyboardEvent/MouseEvent +
input.addLook) — never sim internals:

```js
autoplay(profile, seconds) → Promise<report>
// profiles: 'rusher'    sprint at nearest alive bot, hip fire inside 15 m
//           'sniper'    hold overlook, ADS longbow, single taps on LOS
//           'objective' path to active objective, engage on contact, interact
//           'idle'      stand still (fairness probe: time-to-first-bot-hit must
//                       exceed the 300 ms reaction floor; kiting must not win)
// report: { seconds, counters, kills, deaths, hp, phase, accuracy,
//           timeToFirstContact, perf: perf.stats() }
```

Acceptance battery (run by `_harness/autoplay.py`, local AND deployed URL):
`objective` on fixed seed finishes the mission ≥ 1/3 runs; `idle` never wins;
`rusher` dies to ≥ 2 different archetypes across 5 seeds; zero page errors; zero
program-count growth after tick 600.

---

## 7. index.html + boot skeleton conventions

`index.html` is driftwake's page with Blackridge content — same ids, same gate
shape (driftwake `index.html:249-330`), no module code inline:

```html
<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
<title>BLACKRIDGE</title>
<link rel="icon" href="data:image/svg+xml,..."/>   <!-- inline, chevron wordmark glyph -->
<script type="importmap">
{ "imports": { "three": "./assets/vendor/three/build/three.module.js",
               "three/addons/": "./assets/vendor/three/examples/jsm/" } }
</script>
<style>/* driftwake boot CSS, palette: --ink #05070a, --accent #9db4c8 (steel),
          #boot / #boot-bar / #boot-phase / #nogpu / #hint EXACT ids */</style>
</head><body>
<canvas id="view" tabindex="0"></canvas>
<div id="hint">wasd move · mouse look · lmb fire · rmb ads · r reload · shift sprint ·
ctrl crouch · space jump · 1/2 weapons · f interact · esc pause</div>
<div id="boot"><div class="boot-inner">
  <div class="wordmark">BLACKRIDGE</div>
  <div class="tagline">operation ridgeline</div>
  <div class="bar"><div class="bar-fill" id="boot-bar"></div></div>
  <div class="phase" id="boot-phase">initialising</div>
</div></div>
<div id="nogpu"><div><b>WebGL2 is not available in this browser.</b><br/>
BLACKRIDGE requires WebGL2 with floating-point render targets.</div></div>

<script src="./game_controls.js"></script>   <!-- FIRST: wraps Audio/AudioContext -->
<script>
/* capability gate — classic inline, verbatim driftwake mechanism:
   probe webgl2 on a throwaway canvas, require EXT_color_buffer_float (post HDR
   target), loseContext the probe, publish window.__BR_CAPS__, on fatal: remove
   #boot + #__ff_controls__, show #nogpu; else inject the module tag:
     var s=document.createElement("script"); s.type="module";
     s.src="./runtime/boot.js?v=1";          // ?v=N — BUMP EVERY ITERATION
     document.body.appendChild(s);                                          */
</script>
</body></html>
```

boot.js header conventions:

```js
// runtime/boot.js — the only entry module, the only rAF, the only info.reset().
const V = new URL(import.meta.url).search;          // "?v=N"
const [{ initRenderer }, { makeBus }, ...] = await Promise.all([
  import(`../core/gfx.js${V}`), import(`../core/events.js${V}`), /* ... every module */
]);
// phase() helper writes #boot-phase + #boot-bar; loading failure path calls
// fail(msg): shows #nogpu with the message — never a silent dead bar.
// window.__PAUSE__ wired to pause.js; ESC never destroys; abandon → mission.forfeit.
// end of boot: assign __FPS__/__FFG3D__, console.log("[boot] COMPLETE — __FPS__ assigned (v<N>)").
```

Notes: no `ffg_shell.js` (Blackridge builds its own menu like colosseum);
`game_controls.js` copied byte-identical from `games/colosseum/`; `GAME_CONFIG`
inline script optional, same keys as last-circle if needed.

---

## 8. Performance budget (integrated GPU = Intel Iris Xe, the harness machine)

Hard numbers; `perf_gate` + `_harness/bench.py` assert them. Report p99 and hitch
attribution, never averages.

| metric | budget | gate |
|---|---|---|
| p50 frame time | ≤ 16.7 ms @ dynres-chosen DPR | bench |
| p99 frame time | ≤ 33.3 ms (no sub-30 fps percentile) | bench, FAIL |
| programs at end of prewarm | ≤ 70 | stats() |
| programs delta during mission | **0** | bench, FAIL |
| draw calls (firefight median) | ≤ 320 | stats() |
| draw calls (absolute) | ≤ 480 | bench |
| triangles in view | ≤ 1.2 M | stats() |
| texture count / est. VRAM | ≤ 120 / ≤ 200 MB | stats() |
| lights | fixed pool only: 1 dir + 1 hemi + 10 point + 4 spot | code review + probe |
| shadow maps | 1 × 1024 (moon dir) — static lamps unshadowed | code review |
| DPR | dynres 1.0–1.5, never above 1.5 | dynres |
| sim tick CPU | ≤ 3 ms; AI share ≤ 1.5 ms (≤4 brains think/tick, 12 bots max) | selftest timing |
| soldier GLB | ≤ 400 KB each (Draco+WebP), 2 bodies total | manifest |
| weapon GLB | ≤ 250 KB each ×4 | manifest |
| payload to MENU | ≤ 6 MB (three ~1.2 MB + code + level textures) | manifest sum |
| payload mission gate | ≤ +5 MB (bodies, guns, audio) | manifest sum |
| per-frame allocations | 0 in any update() | review + heap probe |

Instancing plan: all repeated props via InstancedMesh (≤ 40 batches, §3.12);
casings one InstancedMesh; decals one merged pooled geometry; tracers one
LineSegments pool; buildings merged per-material (level.js emits ≤ 25 static
meshes). Off-screen skinned actors evaluate pose 1-in-3 frames with dt
accumulation (adoption plan).

Counters exposed: `__FPS__.stats()` (§6) + `__FPS__.perf` = the perf object
(`frame ring`, `stats()`, `benchDump()`). `renderer.info.autoReset=false`; the ONE
reset lives in boot's frame fn.

---

## 9. Build order & verification (who blocks whom)

Parallel-safe from day 1 because every cross-lane surface is frozen above. True
dependencies, thin by design:

1. **A0 first commit** (skeleton day): index.html, boot.js with phases stubbed,
   events/rng/gfx/perf/input/settings/bridge, vendored three copied, `__FPS__`
   assigned with stubs. Everything after this is parallel.
2. **A3 layout.js + colliders.js** unblock A1 (world) and A5 (nav) — layout data
   FIRST, visuals later.
3. **A2 content.json** (mission + archetypes + scenarios) unblocks A1 mission.js
   and A11 scenarios — commit a complete v1 on day 1, iterate by amendment.
4. Everyone else (A4, A6, A7, A8, A9, A10, A11) builds against this document alone.

Per-lane definition of done (doctrine §5 — observed effect, not compiles):
- A1/A5: `node core/sim/sim.selftest.cjs` + `ai.selftest.cjs` exit 0 — deterministic
  battery: same seed twice → identical `snapshot()` hash; fairness invariants;
  mission completes under scripted optimal cmds; kiting/idle does not win.
- View lanes: `_harness/bootcheck.py` RESULT OK + their scenario's `shots.py` PNG
  meets the visual bar (look at it).
- A11: full battery green locally, then against the deployed URL with the
  `version` fingerprint check (stats().version === expected `v<N>`).

`_harness/bootcheck.py` = byte copy of
`games/driftwake/_harness/bootcheck.py` with exactly two lines changed:
`DEFAULT_URL = "http://localhost:8799/games/blackridge/index.html"` and the ready
expression → `"!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)"`
(driftwake's line 66 checks its SNOWFLOW global). All DOM checks (`#boot` gone,
`#boot-phase`, `#nogpu`, shader-error scan) work unchanged because §7 keeps the ids.

Deploy: standard FFG R2 flow (`upload_game.py`), withholds `_design/ _harness/
tools/`; after upload, fetch live URL, assert the `?v=N` marker + one new-code
fingerprint, run one `autoplay('objective', 20)` on production via `__FPS__.__test`.

---

## Changelog (freeze amendments — A0 approves, append only)

- v1 2026-08-19: initial freeze.
- v2 2026-08-19: BUILD_PLAN synthesis (Part 8, applied by A0 before fan-out):
  1. Map/fiction: Meridian Ward per level_design (R1); tagline `meridian ward`;
     `nodes` key set replaced (R24: dock_spawn, quay_mid, alley_dogleg_s,
     alley_dogleg_n, arcade_ground, arcade_upper, plaza_center, plaza_west,
     gallery_mid, blvd_barricade, blvd_mid, platform_deck, customs_sandbags,
     gate9, exfil).
  2. Light pool counts: 1 dir + 1 hemi + 8 spot + 4 point (R3); perf-budget
     lights row updated accordingly.
  3. Weapon ids `warden/vesper/corvus/pike`; all stats from combat_spec (R4).
  4. Ballistics = swept projectile w/ per-weapon speeds; penetration ships (R5).
  5. Grenades ship; events `explosion`, `grenade`, `whiz`, `zone` added; bark
     kinds → 'contact'|'flank'|'down'|'reload'|'grenade'|'push'|'lastman'|
     'hit'|'idle' (R6, R13).
  6. Slide + mantle ship (R7); player.js "mantle-none-v1" comment void.
  7. Viewmodel = dual-camera same-scene, clearDepth, vFOV 60 (R8) — §3.11's
     "clip-through accepted" superseded.
  8. FOV values are VERTICAL degrees everywhere; settings range 60–90,
     default 74 (R9) — §3.17's "70–110" was horizontal shorthand, void.
  9. Scenario names S1–S9/C1/menu/bench (R10); `?bench` fixture = S1;
     §6.1's menu/vista/hipfire/ads/night_firefight/muzzle table superseded.
  10. `__test` additions: freeze/hud/give/setAmmo + aliases startMatch/
      placePlayer; `perfStats` live-counter member (R11).
  11. Dev port 8841 (R12); bootcheck URL updated.
  12. Harness file set per harness_plan + shotserver.py (R19, R20); §1's
      shots.py/autoplay.py/bench.py names superseded.
  13. mission.js checkpoint restore (R22); phases↔beats mapping (R25);
      pickups[] + starting loadout warden/pike (R26).
  14. sky.js: night-storm sky, NO stars, 3-ring parallax silhouettes (LD §5.1).
  15. capture battery at 1920×1080 (R21).
- v2.1 2026-08-19 (A0 wave-1 integrator amendments, discovered building the
  skeleton — append-only, one item each):
  a. `cmd` (§3.4) gains `grenade:bool` (KeyG, held-state: pin on press, throw
     on release so cook works) — required by R6 player frags, combat_spec §5.9;
     the R7 "no cmd change" note covered slide/mantle only.
  b. Boot-seam export names frozen for files §3 left unsigned (boot.js
     constructs them): `core/test/testsurface.js` → `createTestSurface(ctx)`,
     `core/test/scenarios.js` → `createScenarios(ctx)`, `core/test/autoplay.js`
     → `createAutoplay(ctx)`, `core/render/weather.js` → `createWeather(ctx)`,
     `core/render/reflect.js` → `createReflect(ctx)`. ctx provides: renderer/
     scene/camera/canvas, settings+setSetting+onChange, bus/bridge/input/perf,
     layout/colliders/nav/content, weapons, `sim()` live getter,
     `startMission(opts)`, `stepFrames(n,dt)` (the synchronous real step+
     dispatch+render path with gl.finish timing), `pauseCtl`, V, version.
     Owning lanes replace file CONTENTS freely but keep these export names.
  c. viewmodel additionally exposes `prewarmables()` (prewarm extras source,
     same shape as fx.prewarmables()).
- v2.2 2026-08-19 (A0 wave-3 integrator amendments — servicing lane
  needsElsewhere; append-only):
  a. `shot` event gains ADDITIVE fields (A1's swept-projectile convention,
     granted): `impactOnly:true` = a projectile that resolved on a LATER tick
     than fire (muzzle/bang/vm-kick/fire-anim consumers MUST ignore; impact-fx/
     hitmarker consumers process); `pen:'entry'|'exit'` = penetration
     both-face FX events (hit.entity always null); `firstShot:true` (§2.8
     signature). Fire-time events are always emitted on time with hit inline
     when the pellet resolves within the fire tick. No new event TYPES.
     Boot's recoil/vm wiring gates on `!impactOnly && !pen`.
  b. The DRIVEN mission instance IS `sim.mission` (A1's offered
     simplification, adopted): boot starts sim.mission and never constructs a
     second instance when content is present; sim.step ticks it internally
     (boot does not tick it again). Consequence: `sim.mission.drainRadio()`
     (A10 hud subtitles) and `sim.mission.drainSetPieces()` (A6 blackout) are
     live. The separate `radio`/`setpiece` EVENT amendment A1 requested is
     therefore NOT granted v1 — the drains are the contract.
  c. ctx additionally provides: `lights` (the lease API — A7's seam), `post`,
     `menu`, `mission()` live getter (the driven instance).
  d. Boot's `__test.setScenario(name, seedObj)` and
     `__test.autoplay(profile, seconds, opts)` forward ALL args (R21/A11).
  e. All 14 pool lights carry `layers.enableAll()` — the viewmodel camera
     renders only its own layer; lights must reach every camera (A4).
  f. gfx shadowMap type = PCFSoftShadowMap (honours shadow.radius; LD §3.2
     soft moon shadow).
  g. prewarm() restores each extra's ORIGINAL parent after the staging pass
     (THREE add() reparents — fx/vm/weather pools were being orphaned).
  h. lighting's blackout consumes level.js's registry handles
     (group.userData.level.practicals.blackout: emissiveMats/sprites/
     poolMesh) in addition to userData.blackout-tagged materials.
  i. hud additionally exposes `counts()` → {hitmarkers, killfeedRows,
     ammoShown} (playprobe parity hook).
  j. NOT granted: camera far stays 600 (A6's silhouette rings ship at
     280/400/500 m with angular size preserved — raising far to 1100+ would
     push the rings into fog transmittance ~e^-6 and kill them; the
     documented deviation in sky.js stands). Bark kinds stay the R13 set
     (A5's two spec lines without a kind stay unemitted).
