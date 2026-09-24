# BLOCKTOOTH

> *You eat the street. You outgrow the block.*

**BLOCKTOOTH** is an original isometric (3/4 view) survivor-like. A tiny monster wakes up in a
zebra crossing, eats parked cars and kiosks, outgrows the shops, then the offices, then the
skyline. It gets through five **SIZE** ranks while a municipal news desk (WARD-7, "Ward Seven Municipal
Alert") panics on air. HALVARD CIVIL DEFENSE sends androids, drones, buggies, APCs, tanks and
artillery walkers, then an elite breach-dozer, and finally a containment god-machine
(**CAISSON-4** or **IRON GULLY**). Level-ups open 3-card **MUTATION REPORT** drafts. The run ends
on the front page of *THE WARD SEVEN WITNESS*: **THE CITY GOT SMALLER.**

The look is a Saturday-morning monster comic built as a clean 3D diorama: faceted low-poly shapes,
toon ramps, thick ink outlines, painted palettes and long soft shadows. Everything is procedural:
geometry, animation, music and sound effects. No gore: stepped-on things puff into dust, bolts
and springs.

* 4 titans: **MOLO** (smash tank), **VOLT-KITE** (chain assassin), **HEARTHBACK** (eruption
  fortress), **BRIARWICK** (area control)
* 3 cities: **GRID-EAST** (day, commercial blocks), **WHITE STACKS** (snowed industrial park),
  **LOCKWATER** (flooded container port at night)
* 158 data-driven upgrades (currently): generic cards, 64 titan-locked cards and 13 legendary
  mutations

---

## Run it

```bash
npm install && npm run dev
```

Open **http://localhost:5178**. The port is fixed (`strictPort`) because the test harness expects it.

| script | what it does |
|---|---|
| `npm run dev` | Vite dev server on :5178 (no-store headers, `/__shot` + `/__report` endpoints) |
| `npm run build` | production build into `dist/` (`base: './'`, so it can be hosted from any sub-path) |
| `npm run preview` | serve `dist/` on :5179 |
| `npm run typecheck` | `tsc --noEmit` over `src/`, `_harness/` and `vite.config.ts` |
| `npm run probe` | headless simulation gate (`node _harness/probe_sim.ts`) |

It needs a browser with **WebGL 2**. Without it the page shows a "NO SIGNAL" card instead of a
blank canvas. If boot fails, a "TECHNICAL DIFFICULTIES" card shows the error.

## Controls

| action | keyboard | gamepad (standard mapping) |
|---|---|---|
| move | WASD / arrow keys (screen-relative) | left stick / d-pad |
| **HOOK** (titan ability) | Space | A |
| **DASH** | Shift | B / RB |
| pause (never ends a run) | Esc / P | Start |
| menus: move / confirm / back | arrows · Enter · Esc | d-pad · A · B |
| draft: pick card / reroll | 1 / 2 / 3 (or ←→ + Enter) · R | A · X |
| debug overlay | F1 | — |

The game also auto-pauses when the tab is hidden or the window loses focus (alt-tab, another monitor,
the page around an embedding iframe). Movement keys held through a pause or a draft keep walking the
titan on resume; the Space/Enter/digit that closed the screen never leaks into play.

## URL parameters

| param | effect |
|---|---|
| `?seed=N` | run seed (the city layout, spawns and loot are deterministic from it) |
| `?titan=molo\|voltkite\|hearthback\|briarwick` | titan for `autostart`, or the one pre-selected on the select screen |
| `?biome=grideast\|whitestacks\|lockwater` | biome, the same way |
| `?autostart=1` | skip title + select and go straight to loading → slate (defaults: molo / grideast / random seed) |
| `?noslate=1` | skip the open slate (also skipped on retry) |
| `?quality=0\|1\|2` | quality for this session only (low: DPR 1, no shadows · med: DPR ≤ 1.25 · high: DPR ≤ 1.5) |
| `?dev=1` | enables `window.__BT__.cheat.*` |
| `?dynres=0` | pins the drawing buffer at the quality DPR (adaptive render scale off; see below) |

## Screens

```
boot → title → select (titan, then biome) → loading → slate → play ⇄ draft / pause → end (tabloid)
                                                                                     ├ RETRY  (same titan + biome, new seed)
                                                                                     ├ CHANGE TITAN (select)
                                                                                     └ TITLE
```

* **Loading**: `createWorld`, mount every view, then warm the shaders (`compileAsync` with a render
  target bound, then once more for the canvas) before the first visible frame.
* **Slate**: one frame is rendered and the sim is frozen. The WARD-7 freeze-frame lower third
  (`UNIDENTIFIED MASS — …`) waits for any key.
* **Draft**: when a level-up (or an elite's chest) is owed, the sim freezes inside that same tick.
  The 3-card report then repeats until no draft is owed.
* **Rank-up**: hit-stop (sim time × 0.15 for 0.25 s; HOOK/DASH presses stay buffered across the
  slowed ticks), a camera punch + zoom-out, the full-width **MASS BREACH** banner, a shockwave ring,
  and a roar + news sting. A level-up owed in the same moment waits until the sting has played
  (2.3 s, play continues meanwhile), then the draft opens.
* **Adaptive render scale** (`DynRes`, `game.ts`): in live play, every 1-s window with ≥ 10 % of
  frames slower than 1.5 × the display interval lowers the drawing-buffer scale by 0.1 (floor 0.6);
  6 s with < 3 % misses raises it again (a level that fails within 4 s of a step up is locked out
  for 20 s). `__BT__.state().renderScale` and `.dynres` expose it.
* **Run end**: the sim stops. After a 2.5 s aftermath (dust still settling, hostile telegraphs
  fading out), one frame is rendered and captured as the tabloid's front-page photo; telegraphs and
  hazard paint are left out of that photo so the subject is the titan.

## Project layout

```
index.html              canvas#game, #ui overlay root, #boot / #nogpu / #fatal cards
vite.config.ts          :5178 strictPort, base './', no-store, POST /__shot + /__report, es2022
src/
  main.ts               entry: WebGL2 check → App → test surface → boot; fatal reporting
  game.ts               App: the state machine + per-frame wiring of every module
  testsurface.ts        window.__BT__ (gates/harness) + window.__PAUSE__ (portal)
  core/                 types, config (tuning + size/camera formulas), math, rng, world (tick order),
                        loop (fixed-step GameLoop), input (keys + gamepad), debug (F1), save
  data/                 titans, biomes, enemies, bosses, upgrades, strings (all copy)
  city/                 citygen, citysim, traffic (sim) · meshkit, cityview (view)
  titans/               titansim + kits/* (sim) · models, anim, titanview, portraits (view)
  combat/               spatial, damage, targeting, projectiles, telegraphs, hazards, pickups (sim)
  ai/                   enemies, director, bosses/* (sim) · enemyview, bossview, foemodels (view)
  upgrades/             stats, engine (triggers, frenzy, shield), draft (3-card offers)
  render/               renderer, camera, materials, lighting, env, warmup,
                        telegraphview, projectileview, hazardview, fx, debris (Rapier), civilians, pickupview
  ui/                   hud, broadcast (slate, MASS BREACH, alerts, tabloid), bossbar, select, draft,
                        menus (title, pause, settings), dom helpers, styles.css
  audio/                audio (engine, limiter, buses), sfx (procedural voices), music (procedural score)
_harness/               probes (node), bot, and the browser gates (bootcheck, playtest, perfcheck, shots)
_spec/CONTRACT.md       the build contract (names, exports, numbers, file ownership)
```

## Architecture

**Sim/view split.** The simulation (`src/core`, `city/citygen|citysim|traffic`, `titans/titansim`
+ kits, `combat/*`, `ai/enemies|director|bosses`, `upgrades/*`, `data/*`) never imports three.js
or touches the DOM, and runs under plain `node` (Node 22 type stripping). Views read sim state and
the per-tick `SimEvent` list. They never write gameplay state.

**Determinism.** Every random draw comes from a per-system mulberry32 stream (`world.rng.city |
spawn | ai | combat | loot | boss`), all seeded from the run seed. No `Math.random` and no clocks
run in the sim. The same seed and the same inputs produce the same state hash (the probe gate
checks this).

**Fixed tick (30 Hz).** `GameLoop` feeds real frame time × `timeScale` into an accumulator and
runs at most 5 ticks per frame. When the sim is frozen (slate, draft, pause, run end) the
accumulator is **discarded** every frame, so resuming never fast-forwards. Views interpolate
between the previous and current tick with `alpha`.

Tick order (`stepWorld`, `core/world.ts`):

```
events cleared → snapshot prev poses → tick/t++ → stepCity → rebuildEnemyGrid → stepTitan →
stepDirector → stepEnemies → stepBoss → rebuildEnemyGrid → stepProjectiles → stepTelegraphs →
stepHazards → stepPickups → stepUpgrades → processTriggers → peakRank → checkRunEnd → compact/30
```

Frame order (`game.ts`): `input.update` → sim ticks (each copies its events into the frame list
and a 400-event ring) → camera rig → lighting → every view → HUD / boss bar / broadcast / audio →
render. Every async continuation is guarded by a run **epoch**, so a timer or await from a finished
run cannot touch the next one. Loads are serialised, so a view is never mounted twice.

**Conventions.** 1 unit = 1 m, Y up, ground at y = 0. Heading θ points along (sin θ, cos θ), and
models face +Z, so `rotation.y = heading`. The camera yaw is a fixed 45° (the camera sits at +X+Z
of its target).

### Size and camera formulas

`src/core/config.ts` is the source of truth. The balance pass tunes the mass thresholds; the
values below are the current ones.

| Size | body height H | mass to next | hp× | dmg× | flattens on contact | camera D | pitch | view height D·k |
|---|---|---|---|---|---|---|---|---|
| I | 1.2 m | 95 | 1.0 | 1 | tier 0 (cars, kiosks, lamps, trees) | 17.2 m | 36° | 9.2 m |
| II | 5 m | 600 | 1.8 | 3 | ≤ 1 (shops, buses, containers) | 62.2 m | 38° | 33.3 m |
| III | 14 m | 9 000 | 3.2 | 8 | ≤ 2 (midrise, sheds, tanks) | 153.7 m | 40° | 82.4 m |
| IV | 32 m | 70 000 | 5.5 | 20 | ≤ 3 (office blocks, towers) | 314.3 m | 42° | 168.4 m |
| V | 60 m | — | 9.0 | 45 | ≤ 4 (megatowers) + the boss | 533.2 m | 44° | 285.7 m |

* `H = RANKS[r].height × (1 + 0.12 × progressInRank)` (in-rank swell). On a rank-up the height
  eases from the old value to the new base over 0.9 s (easeOutBack). Collision radius = 0.42 H.
* Titan ability radii and ranges are given in **titan heights**, so every kit scales with growth.
* Camera (`render/camera.ts`):

```
k      = 2·tan(fov/2), fov = 30°
D*     = H / (frameFrac[r] · k)          frameFrac = .13 .15 .17 .19 .21
D      → critically damped spring toward D*, ω = 4/s
punch  : on rankUp, D × (1 − 0.08·(1 − easeOutCubic(τ/1.2))), τ ∈ [0, 1.2] s
target = titan (interpolated) + v·0.25 s (smoothed, ω = 6/s) + up·0.45 H
pitch  → RANKS[r].pitchDeg (ω = 3/s); yaw fixed 45°
camPos = target + D·(cos p·sin yaw, sin p, cos p·cos yaw)
near/far = max(0.1, 0.02 D) / 6 D + 400
shake  : trauma model (amplitude², decay 1.6/s), off when Settings → screen shake is off
```

## Test surface and harness

With the dev server up, `window.__BT__` exposes:

* `state()`: screen, titan/biome/seed, tick, rank, HP, position, drafts, boss, run and renderer counters
* `world`: the live world, read-only
* `newRun({titan, biome, seed, skipSlate})`, `freeze(on)`, `step(n, input)` (only while frozen), `dismiss()`
* `cheat.{xp, mass, rank, god, spawn, boss, killAll, noSpawns, heal, time}` (only with `?dev=1`)
* `shot(name)`: saves the canvas to `_shots/<name>.png` via `POST /__shot/<name>`
* `perf()`, `events(n)`

`window.__PAUSE__ = {pause, resume, toggle}` is the portal contract.

The dev server also accepts `POST /__report/<name>` (JSON), which it writes to `_harness/_reports/<name>.json`.

### Gates (CONTRACT §15): a build is done only when all of these pass, observed

```bash
npx tsc --noEmit -p tsconfig.json                          # 1. 0 type errors
node _harness/probe_sim.ts                                 # 2. 4 titans × 3 biomes: no NaN/throw, deterministic, pacing bands
python _harness/bootcheck.py                               # 3. autostart → slate (titan ON a zebra) → real key → play, 0 errors
python _harness/playtest.py --titan molo --biome grideast  # 4. real keys from the title: menus, slate, move, eat, draft, hook, dash
python _harness/perfcheck.py                               # 5. Size V + 250 enemies: p99 ≤ 22 ms, ≤ 450 draw calls
python _harness/shots.py                                   # 6. screenshot battery for the visual critic pass
```

The browser gates start `npx vite` themselves when :5178 is not already serving. `--headless`
runs them without a window, using the same GPU flags.

## Credits and licences

* Game code, procedural geometry and animation, and the procedural WebAudio music and sound
  effects: original work for BLOCKTOOTH. All names in the game are original.
* [three.js](https://threejs.org) 0.186: MIT
* [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat` 0.20, debris physics only): Apache-2.0
* Fonts via [Fontsource](https://fontsource.org), bundled locally with no runtime network loads:
  **Anton**, **Barlow Condensed** and **Space Mono**, all under the SIL Open Font License 1.1
* Built with [Vite](https://vite.dev) (MIT) and [TypeScript](https://www.typescriptlang.org) (Apache-2.0)
