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
| **zoom** the camera out / in (see more of the city) | mouse wheel · `-` / `=` (numpad `−` / `+`) held | right stick down / up |
| reset the zoom to the automatic framing | Z | R3 (right-stick click) |
| pause (never ends a run) | Esc / P | Start |
| menus: move / confirm / back | arrows · Enter · Esc | d-pad · A · B |
| draft: pick card / reroll | 1 / 2 / 3 (or ←→ + Enter) · R | A · X |
| debug overlay | F1 | — |

The zoom is a multiplier on the automatic framing (0.55× to 2×, and never past 12 m or 880 m of camera
distance; from LV 34 the 880 m cap binds, so at Size V the zoom-out tops out at ≈ 1.4–1.6× — at 880 m the
whole district already fits the view). It stays through Size breaches, resets on Z and at the start of every run, and only works in
play: over a menu the wheel scrolls the menu. It is view-only, so the simulation never sees it.

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
| `?dev=1` | enables `window.__BT__.cheat.*` (and `?rscale=`) |
| `?dynres=0` | adaptive render scale off: the drawing buffer stays at the quality DPR (see below) |
| `?rscale=0.3…1` | with `?dev=1` only: pins the render scale at this value (no adaptation; perf attribution) |
| `?prof=1` | frame profiler (`render/frameprof.ts`, `window.__BTPROF__`): per-section wall ms, GPU timer, LoAF, worst 50 frames |
| `?warmui=0` | skips the one-time compositor pre-warm of the MUTATION REPORT during loading (A/B only) |

## Screens

```
boot → title → select (titan, then biome) → loading → slate → play ⇄ draft / pause → end (tabloid)
                                                                                     ├ RETRY  (same titan + biome, new seed)
                                                                                     ├ CHANGE TITAN (select)
                                                                                     └ TITLE
```

* **Loading**: `createWorld`, mount every view, then warm the shaders (`compileAsync` with a render
  target bound, then once more for the canvas) before the first visible frame. Once per page it
  also replays the real draft deal-in animation on a near-transparent copy of the MUTATION REPORT,
  so the browser compiles its compositor shaders during loading and not in the first draft.
* **Slate**: one frame is rendered and the sim is frozen. The WARD-7 freeze-frame lower third
  (`UNIDENTIFIED MASS — …`) waits for any key.
* **Draft**: when a level-up (or an elite's chest) is owed, the sim freezes inside that same tick.
  The frame that froze it draws the world; the MUTATION REPORT opens one frame later (`draftArmed`),
  and that frame keeps the last picture instead of redrawing, so the DOM build and the world draw
  never share a frame. The 3-card report then repeats until no draft is owed.
* **Frame hold** (`holdCanvas`, draft and pause): the views are frozen, so the canvas is not redrawn
  under the modal; it keeps showing the last live frame. It redraws once only if the canvas size,
  DPR or shadow setting changes while the modal is open (settings in the pause menu).
* **Rank-up**: hit-stop (sim time × 0.15 for 0.25 s; HOOK/DASH presses stay buffered across the
  slowed ticks), a camera punch + zoom-out, the full-width **MASS BREACH** banner, a shockwave ring,
  and a roar + news sting. A level-up owed in the same moment waits until the sting has played
  (2.3 s, play continues meanwhile), then the draft opens.
* **Adaptive render scale** (`DynRes`, `game.ts`; live play only): the display interval is the
  fastest 1-s p10 frame time seen this session. Each 1-s window counts missed vsyncs, meaning frames
  slower than 1.5 × that interval whose previous frame's main-thread work stayed under 0.75 × the
  interval (resolution cannot fix a CPU-bound frame). At ≥ 3 % misses the scale drops by 0.1 (0.2 at
  ≥ 6 %, 0.3 at ≥ 15 %; floor 0.6). After 30 s of windows under 1 % it rises by 0.1
  (`UP_CLEAN_S = 30`, because every step reallocates the MSAA buffer, a 50–65 ms stall). The 0.75 s after a step
  is not judged. A level that fails within 6 s of a step up is locked out for 60 s. The scale
  multiplies only the drawing-buffer DPR; the CSS size stays the same. `__BT__.state().renderScale`
  and `.dynres` expose it.
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

`src/core/config.ts` is the source of truth (the growth rows of its economy table, `RANK_LEVELS`,
`titanHeightAt`, `FRAMING`, `CAMERA_ZOOM`, `cameraDistance`). **SIZE is driven by LEVEL**: XP is the
one progression currency, every level-up makes the body bigger, and reaching `RANK_LEVELS[r]` is the
**MASS BREACH** into Size r. (Mass is retired: loot still carries it, but only to size the pickup
meshes; `titan.mass` is a legacy mirror of the SIZE bar. The HUD and debug overlay read
`sizeProgress()` / `levelsToNextSize()`.)

| Size | reached at | body H on entry → last level | per-level step | hp× | dmg× | flattens on contact | auto D, first → last level | on screen, foot → head | on screen, silhouette (VOLT-KITE · MOLO) | pitch |
|---|---|---|---|---|---|---|---|---|---|---|
| I | LV 1 | 1.2 → 2.66 m | +17 % | 1.0 | 1 | tier 0 (cars, kiosks, lamps, trees) | 33.9 → 54.9 m | 3.9 → 5.4 % | 9.3 → 12.3 % · 13.5 → 18.4 % | 54° |
| II | LV 7 | 5 → 9.89 m | +8.9 % | 1.8 | 3 | ≤ 1 (shops, buses, containers) | 82.8 → 134 m | 6.6 → 8.2 % | 15.6 → 19.5 % · 23.0 → 28.1 % | 54° |
| III | LV 16 | 14 → 24.2 m | +5.6 % | 3.2 | 8 | ≤ 2 (midrise, sheds, tanks) | 173 → 265 m | 9.0 → 10.2 % | 21.2 → 24.2 % · 30.8 → 34.8 % | 54° |
| IV | LV 27 | 32 → 47.3 m | +5.7 % | 5.5 | 20 | ≤ 3 (office blocks, towers) | 331 → 457 m | 10.7 → 11.3 % | 25.4 (LV 27) · 36.7 (LV 27) | 54° |
| V | LV 35 | 60 → 63.5 → 67.2 m (2 levels) | +5.8 % | 9.0 | 45 | ≤ 4 (megatowers) + the boss | 560 → 617 m | 11.9 → 12.0 % | 28.2 → 28.3 % · 40.7 → 41.0 % | 54° |

Two on-screen measures, both projected through the live camera (settled, zoom 1): **foot → head** is the
titan's base-to-crown segment; **silhouette** is the vertical extent of every posed body vertex, averaged
over 4 headings — what the player actually sees (long bodies read 2.4–3.4× foot → head). Both rise at every
level AND at every breach. Growth sequence (real keys to LV 8, `cheat.level` after), silhouette share,
LV 1 / 6 / 7 / 8 / 15 / 16 / 17 / 26 / 27 / 28 / 35 / 36:
VOLT-KITE 9.3 / 12.3 / 15.6 / 16.1 / 19.5 / 21.2 / 21.4 / 24.2 / 25.4 / 25.7 / 28.2 / 28.3 % ·
MOLO 13.5 / 18.4 / 23.0 / 23.5 / 28.1 / 30.8 / 31.0 / 34.8 / 36.7 / 37.0 / 40.7 / 41.0 %
(foot → head 3.9 / 5.4 / 6.6 / 6.9 / 8.2 / 9.0 / 9.1 / 10.2 / 10.7 / 10.8 / 11.9 / 12.0 %).

* `H = titanHeightAt(rank, level)`: geometric across a Size's levels, and the breach level is one
  more step × `BREACH_JUMP` (→ II ×1.88, → III ×1.42, → IV ×1.32, → V ×1.27). A level-up tweens the
  body over `LEVEL_GROW_S` = 0.45 s, a breach over `GROW_TWEEN_S` = 0.9 s (easeOutBack); the view adds a
  squash-and-stretch pop and a ground ring. Collision radius = 0.42 H.
* Titan ability radii and ranges are given in **titan heights**, so every kit scales with growth.
* Camera (`config.ts cameraDistance` / `frameDistance` + `FRAMING`; `render/camera.ts` springs toward it):

```
k      = 2·tan(fov/2), fov = 30°
D*(H)  : ln D* = ln D1 + κ1·x + c·x²,  x = ln(H / 1.2)          (config.ts cameraDistance, FRAMING)
         ONE curve for the whole run: D1 = 1.2 / (0.066·k) = 33.9 m (analytic share H/(D·k) 6.6 % at
         LV 1), κ1 = 0.573, c = 0.0367 solved so the Size V entry sits at share 0.20 (D 560 m). The local
         exponent κ1 + 2c·x rises gently from 0.573 to 0.86 and stays < 1, so D never decreases as the
         body grows and the titan's share RISES with every level and every MASS BREACH (the body jumps
         × BREACH_JUMP, the camera follows the same curve and pulls back less). No per-rank reset: the
         old per-rank framing pulled back 2.9–3.5× at a breach while the body grew 1.3–1.9×, so the
         monster looked SMALLER after its biggest growth moments. The slope eases up (instead of one κ)
         so Size I stays put (the spawn ring and GATE 2's Size II band) while the late game opens up: one
         κ = 0.573 filled ~47 % of the screen with VOLT-KITE's Size V silhouette (~70 % with MOLO's).
         Size I still opens wide: a whole intersection, the baby titan small on its zebra.
frame  = frameDistance(w): D*, widened while a boss is alive (see "Boss framing"), never below it
D      → critically damped spring toward frame, ω = 4/s
zoom   : × player zoom (wheel / - = / right stick; Z resets), ln-smoothed ω = 11/s,
         clamped to CAMERA_ZOOM 0.55×…2× and 12 m ≤ D ≤ 880 m (binds from LV 34; perfcheck --zoom max)
punch  : on rankUp, D × (1 − 0.08·(1 − easeOutCubic(τ/1.2))), τ ∈ [0, 1.2] s
target = titan (interpolated) + v·0.25 s (smoothed, ω = 6/s) + up·0.45 H
         + the boss-framing offset (frameOffset; 0 without a boss; smoothed ω = 5/s)
pitch  → RANKS[r].pitchDeg = 54° at every Size (ω = 3/s); yaw fixed 45°
camPos = target + D·(cos p·sin yaw, sin p, cos p·cos yaw)
near/far = max(0.1, 0.02 D) / 6 D + 400
shake  : trauma model (amplitude², decay 1.6/s), off when Settings → screen shake is off
```

* **Boss framing** (`config.ts bossFrameNeed` / `BOSS_FRAME`, held by `ai/director.ts`): while a boss
  is alive the default-zoom view keeps the boss rig, every live boss telegraph and the titan in frame,
  below the boss nameplate (top 20 % of the screen), with a 12 % margin elsewhere — projected exactly
  through the rig's camera. It widens the distance (never below the curve, at most 2× it) and, when the
  fight is lopsided, slides the look target toward the fight's centre. The widening is held 1.6 s and
  released at 1/s, so the camera does not pump with every attack. Measured at LV 37 (curve 617 m,
  `bossframe.py`, the tell 70–92 % through its windup, MOLO): paw slam 659 m (the only one that widens,
  1.07×) · breath cone 618 m · boom sweep, leg stomp, winch, ridge charge on the curve itself (617 m) —
  every framed point in view, 0 outside, the widest tell at |ndc| 0.79.
* **Telegraph x-ray vs the titan** (`render/telegraphview.ts`): hostile paint is x-rayed through
  whatever hides it (a boss cone behind towers still reads), EXCEPT through the titan's own body — a
  fragment whose view ray passes through the titan's body volume (its bind-pose box in model space +
  10 %, the live model matrix, tested exactly per fragment) is not x-rayed at all. Stacked rocket
  circles under a Size II MOLO used to paint a pink swirl over its head and torso; now the ground decal
  around the feet carries the warning and the body stays clean.
* **Spawn ring** (`ai/enemies.ts`): the sim reads `spawnView` = the same framing (`frameDistance` +
  the boss offset, plus a replica of the rig's own spring so a boss-framing release cannot expose a
  spawn), never the player zoom, so it stays deterministic. Candidates go just past the edge of the
  visible ground in their direction (the 54°, 16:9 trapezoid: near edge 0.52·D·k, far edge 0.77·D·k,
  half-widths 0.74 / 1.10·D·k, + 0.04·D·k), are snapped to the street grid, and are then CHECKED
  through the default-zoom camera (`screenOut`: the exact projection, the camera's lead included,
  pulled 7 m toward the titan); the nearest candidate that is truly off-screen wins, and when none is,
  the least-visible one is walked outward along its street until it is. Enemies more than 1.9 × D·k
  away are recycled back onto the ring.
  Measured (`_harness/scratch/view/spawnvis2.py` = spawnvis + each spawn's source, 20 s per level at
  1×): 0 ring spawns first seen on screen at LV 1 / 6 / 7 / 15 / 16 / 26 / 27 / 35 (boss alive) / 40
  (of 6 / 6 / 31 / 34 / 27 / 27 / 34 / 48 / 70 spawns); the only in-view arrivals are BULWARK squads
  dropped from an APC that is already on screen (by design). Zoomed out to 2×
  the spawns are on screen by design (`scratch/final/spawnzoom.py`); they arrive with enemyview's
  0.32 s pop-in plus an fx arrival beat (`enemySpawn`: a dust kick and a thin ground ring, only when
  the spawn point is in view, at most 6 per frame — `scratch/final/spawnpop.py` shows it).

### Bosses: sized in titan heights

The metre sizes in CONTRACT §10 were the first design. At Size V they were smaller than the titan,
so they have been replaced. Every boss tell is authored in **titan heights**. `bossH(w, b)` in
`ai/bosses/index.ts` is the titan height latched at spawn, and it is latched again if the titan
ranks up mid-fight. Current shapes:

* CAISSON-4: hook drop r 0.55 H, hook lane w 0.5 H, winch oval 1.4 H × 1.0 H, boom sweep 2.6 H, leg stomp rig + 1.0 H
* IRON GULLY: cone breath 3.0 H, paw-slam rings 0–1.1 H and 1.1–2.0 H, plates r 0.4 H, ridge-charge lane w 0.7 H

Every windup comes from `fairWindup()`: 0.35 s reaction + 0.15 s acceleration + the walk-out
distance ÷ the titan's current top speed × `ESCAPE_K` (1.1 / 1.0 / 0.9 for phases 1 / 2 / 3).
`watchDash` answers dash-spam with a walkable drop at the dash end. HP is `BossDef.hp × BOSS_HP_SCALE`
(1.15 at Size V). No single hit deals more than 55 % of the titan's max HP, and structural fatigue
starts after 90 s. Dash-refund cards pay back recharge time, not whole charges (VOLT-KITE cards 20 %,
Peak Commute 50 %). The measured numbers are in the `config.ts` BOSS rows.

## Test surface and harness

With the dev server up, `window.__BT__` exposes:

* `state()`: screen, titan/biome/seed, tick, rank, HP, position, drafts, boss, run and renderer counters
* `world`: the live world, read-only
* `newRun({titan, biome, seed, skipSlate})`, `freeze(on)`, `step(n, input)` (only while frozen), `dismiss()`
* `cheat.{xp, level, rank, mass, god, spawn, boss, killAll, noSpawns, heal, time}` (only with `?dev=1`). `level(n)` and
  `rank(r)` go through the sim's real level/rank-ups (`growToRank`) and queue no drafts; `mass(n)` is deprecated
  (n % of the current level's XP bar)
* `shot(name)`: saves the canvas to `_shots/<name>.png` via `POST /__shot/<name>`
* `perf()`, `events(n)`

`window.__PAUSE__ = {pause, resume, toggle}` is the portal contract.

The dev server also accepts `POST /__report/<name>` (JSON), which it writes to `_harness/_reports/<name>.json`.

### Gates (CONTRACT §15): a build is done only when all of these pass, observed

```bash
npx tsc --noEmit -p tsconfig.json          # 1. 0 type errors
node _harness/probe_sim.ts --det 2         # 2. 4 titans × 3 biomes: no NaN/throw, determinism, pacing bands → "GATE 2: PASS"
for p in ai city combat econ titan upgrades; do node _harness/probe_$p.ts; done   #    lane probes (all must exit 0)
python _harness/bootcheck.py --titan T --biome B   # 3. autostart → slate (baby titan ON a zebra) → real key → play, 0 errors (run all 12)
python _harness/playtest.py --matrix       # 4. real keys from the title (4 titan/biome pairs): menus, slate, move, eat, draft, HOOK, DASH,
                                           #    camera zoom (real wheel out, '=' held in, Z reset)
python _harness/perfcheck.py               # 5. Size V + 250 enemies: p99 ≤ 22 ms, ≤ 450 draws. Run it ALONE, nothing else on the GPU
python _harness/perfcheck.py --zoom max    #    the same with the camera held at its max zoom-out (real wheel; D ≈ 680–700 m at Size V)
python _harness/shots.py                   # 6. screenshot battery (_shots/) for the visual critic pass
python _harness/scratch/final/leakcheck.py # newRun ×7: geometries / textures / programs come back to the same values
python _harness/scratch/final/blankprobe.py   # setQuality after a render never shows a blank canvas (0 blank frames)
python _harness/scratch/final/growthseq.py --out DIR --levels 1,6,7,8,15,16,17,26,27,28,35,36 --real-max 8
                                           #    the titan's screen share must rise across every size-up
python _harness/scratch/view/spawnvis.py --level L   # new enemies first seen INSIDE the viewport at the auto framing (must be 0)
python _harness/scratch/view/spawnvis2.py --level L  #    the same, split into ring spawns (must be 0) and BULWARK drops
python _harness/scratch/view/bossframe.py --out DIR  # boss attacks frozen late in the windup: boss + every boss tell in frame
node _harness/scratch/view/framing_table.ts          # D and the share per level (must be monotonic)
```

Start the server once as `BT_FROZEN=1 npx vite --port 5178 --strictPort`, with no HMR and no file
watching, so an edit cannot reload a page mid-test. Otherwise the browser gates start `npx vite`
themselves when :5178 is not serving (`--no-serve` turns that off). `--headless` runs a gate without
a window, using the same GPU flags; gate 5 is only valid headed. Perf attribution:
`python _harness/scratch/perfprof.py` (perfcheck with `?prof=1`), then `profsum.py` / `profcat.py`
on the JSON it writes. Boss threat (node only): `node _harness/scratch/boss_threat_pool.ts`.

## Credits and licences

* Game code, procedural geometry and animation, and the procedural WebAudio music and sound
  effects: original work for BLOCKTOOTH. All names in the game are original.
* [three.js](https://threejs.org) 0.186: MIT
* [Rapier](https://rapier.rs) (`@dimforge/rapier3d-compat` 0.20, debris physics only): Apache-2.0
* Fonts via [Fontsource](https://fontsource.org), bundled locally with no runtime network loads:
  **Anton**, **Barlow Condensed** and **Space Mono**, all under the SIL Open Font License 1.1
* Built with [Vite](https://vite.dev) (MIT) and [TypeScript](https://www.typescriptlang.org) (Apache-2.0)
