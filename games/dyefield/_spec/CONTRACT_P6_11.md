# DYEFIELD — runtime contract for phases 6–11 + ship

Companion to `CONTRACT.md` (PART I–II) and `CONTRACT_ART_P6_8.md` (art formats). The orchestrator
owns this file. The same rules apply as in `CONTRACT.md §0`: THREE-free core that runs in node,
data-driven numbers, determinism, and verification by real input.

## §18 Phase 6 — four kits, JELLY CHARGE, specials

### §18.1 Sim (`core/combat/*`, `core/match/*`), with numbers from `data/weapons.json`
- **SHEET-DRUM (roll):**
  - Fire held + grounded + moving → a continuous `painter.capsule` strip `rollWidth` wide at
    the drum contact, ahead of the feet, along the motion. Speed is capped at `rollSpeed`, and
    the tank drains `tankPerMetre`.
  - An enemy within `flattenReach` in front of the drum while rolling takes `flattenDamage`,
    which washes them.
  - Tap fire (released within 0.2 s) or fire while standing starts the **flick**: `windup`,
    then `splats` projectiles (kind 1) fanned in a vertical column to `reach`, damage from
    `damageNear` to `damageFar` by distance, `tankCost`, then `cooldown`.
- **NEEDLE-GLINT (charge):**
  - Hold fire → charge 0→1 over `chargeSeconds` at `moveSpeedWhileCharging`. A `glint` event
    (origin, dir, charge) fires every 0.1 s and is visible to enemies.
  - Release → a hitscan beam along the aim to `range = lerp(minRange, maxRange, charge)`, dealing
    `lerp(damageMin, damageFull, charge)` (a full charge washes). The tank cost is
    `lerp(tankMin, tankFull, charge)`.
  - It paints splats every `lineSpacing` (radius `lineRadius`) along the beam's floor
    projection, plus an `endRadius` splat at the hit point.
  - Releasing below 15 % charge fires nothing and costs nothing.
- **POP-WELL (burst):** projectile kind 2 at `projectileSpeed`. It explodes on impact, or at
  `maxRange` when `airburstAtMaxRange`.
  - A direct capsule hit deals `directDamage`, and there is `splashDamage` within
    `splashRadius` (linear falloff to 40 %). Splash damage checks line of sight.
  - Paint: `impactRadius` at impact, or `airburstRadius` projected to the floor below an
    airburst.
- **JELLY CHARGE (`intent.sub`):** needs tank ≥ `tankCost`; the cost is paid on the throw.
  - A projectile (kind 3) flies at `throwSpeed` with `gravity`, toward the aim point.
  - On landing it becomes a puddle for `puddleFuse`, then pops: `damageCenter`→`damageEdge`
    over `blastRadius`, with line of sight, plus paint `paintRadius`.
  - Events: `sub` throw / land / pop.
- **Special meter:** per `specialCharge`: points per weighted m² newly dyed by the runner, plus
  points per wash. `chargePoints` come from the kit's special. A `special:ready` event fires
  once. `intent.special` when ready starts the special. Being washed keeps `keepOnWashed`.
- **CLOUDBURST:**
  - Thrown along the aim (up to `throwRange`) as projectile kind 4.
  - Where it lands it rises to hover `hoverHeight` above the floor, then rains for `duration`:
    `dropsPerSecond` drops at random (from the special's own stream) inside `soakRadius`, each
    painting `dropPaintRadius` where it lands (a raycast down).
  - It deals `damagePerSecond` to enemies under the disk.
  - Events: `special` start / end, with drops as normal `splat`s.
- **WELLSPRING:** the runner leaps (`leapHeight`, ~0.6 s) and slams at landing.
  - Paint: a ring of `ringRadius` × `ringWidth` (splats around the circle), plus a core splat.
  - `coreDamage` within `coreRadius`, and a `knockback` impulse.
  - The runner can't be interrupted during the leap.
- **Bots use their kit:**
  - rollers roll paint lanes and flatten at close range;
  - chargers take long sightlines, charge, and fire at visible enemies (they can also paint lines);
  - blasters hold mid range and airburst at corners;
  - everyone throws jelly into enemy groups or dye gaps when tank ≥ 90;
  - everyone uses the special when ready and ≥ 2 enemies are near its target, or to reclaim
    enemy turf.
- **Probe G10:** `node _harness/probe_kits.ts` checks each kit's numbers and behaviors exactly as
  above, plus sub and special timings and paint areas. Then `probe_bots.ts --lineup mixed` runs a
  full 8-bot match with 2 of each kit per team. The §10.3 gates still hold, and each kit gets
  ≥ 1 wash across 3 seeds.

### §18.2 View
- Per-runner kit models are attached to `socket_weapon` (two-handed kits use `grip_L` for the
  left-hand pose from the `hold_two` / kit clips).
- Clips: `roll` full-body while rolling; `flick`; `charge` held while charging; `blast`; `throw`;
  `special_throw`; `slam`.
- FX (pooled):
  - roller sheet spray;
  - the charger **glint line**: a thin team-colored beam from the scope to the aim point while
    charging, visible to enemies, and brighter at full charge;
  - the beam flash on release;
  - blaster burst rings;
  - the jelly puddle wobble and pop;
  - the CLOUDBURST cell (model + rain particles + a shadow disk);
  - the WELLSPRING ring wave.
- HUD:
  - the special gauge shows the kit's special icon and fills; at 100 % it pulses with a "F" key
    badge;
  - the sub icon greys out below the sub cost;
  - the charger shows a charge ring around the reticle.

## §19 Phases 7–8 — map features at runtime (against `CONTRACT_ART_P6_8 §14`)

- `core/mapgeo.ts` classifies the new prefixes:
  - `grate_`: runner collision only;
  - `conveyor_`: runner collision plus velocity;
  - `spring_`: runner collision plus a launch trigger;
  - `oob_`: volumes;
  - `light_`: an empty list.
  It also reads `df_*` extras and `mapinfo.df_ao`.
- `core/physics.ts` collision groups:
  - MAP_SOLID (paint/solid/col/conveyor/spring);
  - GRATE, which runners collide with, but projectile/paint/visibility rays ignore.
  `raycast(…, { grates?: boolean })` defaults to ignoring grates for paint and projectiles.
- `core/runner.ts`:
  - Grounded on a `conveyor_` collider → add `df_conveyor` to the displacement.
  - Stepping onto a `spring_` → set velocity to `df_launch` (air state) with a 0.4 s re-trigger
    lock.
  - Feet inside any `oob_` volume (AABB of the mesh) → WASHED with cause 'sea'.
- **Mist** (`maps.json` map-level `mist`): `MatchWorld.canSee` hides every runner beyond
  `hideRange` who is SLICK (moving or not), and the view fades such enemies.
- `core/bots/nav.ts`:
  - stairs are walkable;
  - conveyor edges get their cost scaled by belt direction;
  - springs become kind-2 jump edges from pad to landing, found by simulating the arc;
  - grates are walkable floor;
  - `oob_` never gets nodes.
  Probe gates (§10.3) must pass on **all three maps**: `probe_nav.ts --map <id>` and
  `probe_bots.ts --map <id>`.
- `view/mapview.ts` and LOOK `view/{sky,surfaces}.ts`:
  - interior lighting preset kind (no sky dome; skylight glow; fluorescent strip emissive;
    sodium practicals; a key-down light with shadows; dark fog);
  - `light_` empties become a fixed pool of ≤ 6 point lights, assigned by distance to the
    camera every 0.5 s (fixed pool, so no shader permutation churn);
  - the AO map applied on UV2 (`aoMap.channel = 1`; `aoMapIntensity` ≈ 0.8);
  - grates with alpha-test and a grid;
  - conveyor belts with a scrolling UV (`df_conveyor` direction);
  - spring pads with a pulsing team-neutral glow and splash on launch;
  - Cinder's water channels using the water shader, with shallow sandbars tinted;
  - mist fog.
- Map select exposes a map only when `status: 'built'`. Lockwell and Cinder flip to `built` when
  their metadata is merged into `maps.json` by the orchestrator.

## §20 Phase 9 — lobby, loadout, map select, settings, how to play, credits

- **Title/lobby:**
  - the DOM menu **PLAY / LOADOUT / SETTINGS / HOW TO PLAY / CREDITS** over a *live* 3D Pier 18
    at the `noon` preset, with a slow camera drift across the court and a few idle tide-runners
    / dye splashes for life;
  - the wordmark `DYEFIELD` and the mode line `Harbor Cup • 4 v 4`;
  - a current-loadout card;
  - a key-hint pill (Enter / Esc);
  - keyboard, mouse and gamepad navigable.
- **LOADOUT:**
  - the hint `Pick your kit — crest sits on the right`;
  - 4 kit tiles (icon from a small 3D render or SVG, name, role);
  - a card with 5 stat bars (Range / Damage / Fire rate / Mobility / Coverage from `stats`);
  - sub and special cards (name + one-line blurb from data);
  - a **live mannequin on the right**: the hero holding the selected kit, on a painted disk
    in the player's crew color, playing `lobby_idle`, with a short `aim` preview on selection;
  - crew choice (SUNCREW / GULF CREW);
  - a name field.
  Selections persist in localStorage.
- **PLAY → map select:**
  - three map cards (PIER 18 PLAZA / LOCKWELL WORKS / CINDER REEF), each with a render
    thumbnail, name, type line and favors, plus **RANDOM**;
  - bot skill with **original** tier labels **BREEZE / SWELL / STORM** (do not use the source
    clip's labels);
  - a START button → loading → countdown → match.
- **SETTINGS:**
  - key remap for every action (conflict detection; persisted);
  - mouse sensitivity and invert Y;
  - colorblind marks (shape + color, the `teams.json colorblind` palette + hatch);
  - master / music / sfx volume;
  - render quality auto / high / low;
  - show FPS.
  All persisted and applied live.
- **HOW TO PLAY:** 4 illustrated panels (the floor is the score; slick & drink; kits; sub &
  special), using the in-game icons.
- **CREDITS:** the line `An original 4 v 4 turf-paint shooter.`, then credits: the stack, the
  CC0/Asset Store audio authors used, and ForgeFlow.
- **Pause** (ESC in a match): PAUSED / RESUME / SETTINGS / HOW TO PLAY / QUIT MATCH plus a
  **control legend** for the current bindings. QUIT MATCH goes through a confirm → the lobby.
- **After the victory slate:** PLAY AGAIN (same map and kit) and LOBBY.

## §21 Phase 10 — juice, audio, horn, per-map lighting

- **Audio (`runtime/src/audio/*`, WebAudio):**
  - Music: a lobby track plus a match track (a different track per map is welcome), with a
    final-minute intensification (tempo/layer or a switch to a hype cue) and a victory/defeat
    stinger.
  - Tracks come from the unused Unity Asset Store packs extracted on
    `F:\games\unity-assets\**` (electronic/upbeat). They are **registered** in
    `C:\Users\TestRun\Claude Claw\state\music_assignments.json` under the slug `dyefield` so no
    other game reuses them (back up the file before writing; append only), and transcoded to
    OGG/Opus ≤ 128 kbps (ffmpeg is installed). They ship under `runtime/public/audio` or are
    imported as assets.
  - SFX from the Kenney CC0 / Sonniss GDC packs on F:\ plus procedural WebAudio where it's
    better: per-kit fire, splat (pitch-varied), slick in/out, a swim loop, a refill gurgle, the
    dry click, hit (dealt and taken), washed, the respawn spout, jelly throw/pop, CLOUDBURST
    rain, the WELLSPRING slam, UI clicks and hovers, the countdown beeps, and the **score horn**
    (start / 1 min / final 10 ticks / end).
  - 3D panning for world sounds, a voice limit, and ducking under the horn and slates.
  - The first user gesture unlocks the AudioContext. Volumes come from settings.
- **Juice:**
  - camera shake (small on firing, medium on hits taken, big on slams / pops / washes near you);
  - hit markers on damage dealt;
  - a damage vignette in the enemy color;
  - dye drips on the runner's body when hit;
  - landing puffs;
  - splat droplets with bounce;
  - a coverage tally animation on the victory slate (bars fill, then the winner mark stamps).
- **Per-map lighting polish:**
  - Pier 18: noon in the lobby, golden hour selectable per match;
  - Lockwell: the interior preset;
  - Cinder: warm overcast with mist.
  Each map owns its sky, fog and prop kit.

## §22 Phase 11 — harden, pause, README

- **Robustness:**
  - pause everywhere (ESC, focus loss, pointer-lock loss);
  - WebGL context loss shows a card with RELOAD;
  - loader errors show a card;
  - no leaks across 5 consecutive matches (renderer.info geometries/textures stable ±5 %;
    JS heap stable);
  - the adaptive resolution;
  - all epoch-guarded timers (doctrine §4).
- **Perf:** p99 < 25 ms at 1600x900 on the Intel UHD on all three maps during an 8-runner fight
  (perfcheck `--map`).
- **README:** stack decision (kept), run command, map list, controls, how to play, the data
  files, the harness/gates list, credits and licenses.
- **Final QA (G12):** real-input playtests in Chrome on **every map × every kit** (12 runs, short
  60 s matches). Each run: countdown → play → the victory slate, 0 errors, and a p99 report. Plus
  one full 3:00 match on each map.

## §23 Ship (G13)

- `npm run build` → `dist/` (`base: './'`).
- Cover: `python pipeline/generate_cover.py` (xAI, pre-approved ≈ $0.02; ≤ 2 tries). Generate
  into scratch, look at it, and re-encode it to a real PNG as `runtime/public/thumbnail.png` (or
  copy it into `dist/`). Art direction: kid tide-runners dyeing a sunny harbor court, amber vs
  violet-blue, no text or logos.
- Deploy: `python pipeline/deploy_game.py --game-dir games/dyefield/dist --slug dyefield`. Read
  the script's flags first: deploy to the R2 CDN, keep the registry `status` **unpublished**
  (catalog publishing is the owner's toggle), and pass `--no-portal` unless the script needs the
  portal step for the play URL.
- Verify live:
  - fetch the CDN `index.html` + one hashed JS asset and check for a version marker;
  - run `bootcheck.py --base <live url>` headless → BOOTS CLEAN;
  - run a short match on the live URL through the test surface.
- Commit and push everything.
