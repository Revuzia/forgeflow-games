# VALE — build contract

This file is the spine. Every lane builds against the signatures, formats and rules written here.
`_design/DESIGN_NOTE.md` owns **intent** (what the game is), `_design/STYLE_BIBLE.md` owns **look and
feel** (it is law for every screen), and this file owns **interfaces**. When they disagree, this
file wins for interfaces and the bible wins for presentation. A lane that needs an interface change
writes it **here first**, marked `CHANGED(<lane>): …`, and never breaks an existing signature
silently. The TypeScript in `src/contracts/` is the machine-readable half of this file.

## §0 Ground rules

- **Own your files only (§14).** Never edit another lane's files. Need something from another lane?
  Depend on the signature here and leave a note in your final report.
- **Simulation and presentation are separate.** `src/sim/**` never imports `three`, `preact`, the
  DOM, `src/render`, `src/ui` or `src/audio`. It must run under plain `node` (Node 22 type
  stripping) exactly as in the browser. The presentation never imports `src/sim/**`: it sees only
  `src/contracts/sim.ts` shapes through a `MatchClient` (§7).
- **Content is data.** No content id (fighter, item, skin, map, mode, queue, unit, cue, vfx) is
  written in code outside `content/` and `_harness/`. Code reads the catalog. The probe
  `probe_content_ids.ts` greps `src/` for every catalog id and fails on a hit. Allowed exceptions:
  mode-rule *kinds* (`core`, `last_standing_or_score`), queue *kinds* (`ranked`, `practice`, …) and
  effect `op` names, which are code vocabulary, not content.
- TypeScript: `erasableSyntaxOnly` (no `enum`, `namespace`, parameter properties); relative
  imports **with `.ts`/`.tsx` extensions**; JSON imported only in tools/harness
  (`import x from '…json' with { type: 'json' }`). The client gets JSON from the catalog URL.
- **Deterministic sim.** No `Math.random()`, `Date.now()` or `performance.now()` in `src/sim/`.
  Randomness comes from `src/sim/rng.ts` streams seeded from `MatchSetup.seed`. Iterate entities in
  id order. Same setup + same command stream ⇒ same `MatchResult.digest`.
- **Cosmetics never change stats.** `SkinDef` has no stat-bearing keys (zod `.strict()` rejects
  them). The sim reads `skin` only to echo it into views/results. `probe_skin_neutral.ts` runs the
  same seed with different skins and requires identical digests.
- **No primitive hero assets.** Capsules, boxes and spheres may appear only as debug geometry behind
  `?dev=1`. Fighters, skins, landmarks, structures, minions and monsters are Blender-authored GLBs.
  Procedural tools are allowed for terrain, scatter, trim textures, crowds and VFX.
- **Originality.** No name, kit, ability text, item, map layout, objective name, UI layout, font,
  icon, VFX, music, voice or lore from any shipped game. The content build checks every
  player-facing string against `_design/research/protected_names.json` + `_design/NAMES_NOT_USED.md`
  and fails on a match (§3.4).
- **Verification is at the player's layer.** Real key and mouse events in real Chromium, pixels
  read back. A teleporting harness is not a playtest. Sim probes are in addition, not instead.

## §1 Layout

```
games/vale/
  README.md  package.json  tsconfig.json  vite.config.ts  index.html
  public/                      copied verbatim into the client build
    config.js                  window.VALE_CONFIG = { catalog: './catalog/manifest.json' }  (edit at deploy, no rebuild)
    game_meta.json  game_controls.js  thumbnail.png
  content/                     CONTENT SOURCE (lane CONTENT) → built into the catalog
    roles.json resources.json setup.json items.json units.json team_buffs.json ranks.json
    modes.json queues.json store.json client.json audio.json vfx.json strings.en.json bot_names.json
    fighters/<id>.json         one file per fighter (kit + art refs)
    skins/<fighter>.json       that fighter's skins
    maps/<id>.json             layout truth for sim, Blender and minimap alike
    ui/                        UI art sources (svg/png) referenced as assets/ui/...
  art/                         lane ART (Blender 5.2, headless, deterministic)
    build.py                   runner: `python art/build.py <target>` (blender exe if $BLENDER, else the bpy module)
    blender/common/*.py        rig standard, materials, bake helpers, export helpers
    blender/fighters/<id>.py   one hand-authored script per fighter (+ its skins)
    blender/units/*.py  blender/landmarks/*.py  blender/maps/<id>.py  blender/sky.py  blender/portraits.py
    out/                       exported GLB / HDR / PNG (tracked) → referenced as assets/...
    renders/                   QA renders (tracked, small)
  audio/                       lane AUDIO: synth/*.py (original synthesis) → out/*.ogg (tracked)
  tools/                       lane TOOLS: build_content.ts, schema_migrations.ts, package_deploy.ts, names_check.ts
  src/
    contracts/                 LEAD: catalog.ts (zod schema), sim.ts, session.ts
    boot/                      LEAD: main.ts, catalog.ts (fetch + schema negotiation), config
    sim/                       lane SIM (+ sim/bots/ lane BOTS)
    session/                   lane SESSION: LocalSession, matchmaker, draft host, grants, ratings, profile store
    render/                    lane RENDER
    ui/                        lane UI (Preact + signals)
    audio/                     lane AUDIO runtime (WebAudio)
    input/                     lane UI: keybinds → Commands
  _harness/                    probes (node) + e2e (Playwright) + _reports/ (gitignored)
  _design/                     research/, DESIGN_NOTE.md, STYLE_BIBLE.md, NAMES_NOT_USED.md
  _spec/                       this file
  dist/ dist-catalog/ deploy/  build outputs (gitignored)
```

## §2 Conventions

- **Units:** metres, seconds, radians in code; degrees only in JSON keys suffixed `Deg`.
- **Sim plane:** 2D `(x, y)`, `x ∈ [0, map.size[0]]`, `y ∈ [0, map.size[1]]`. Render maps sim
  `(x, y)` → three `(X = x, Y = height, Z = y)`. Facing `0` = +x, increasing toward +y.
- **Walkable ground is flat at Y = 0** in the render. Walls/cliffs rise from it; the Blender map
  scene and the sim's `walls` polygons come from the same `content/maps/<id>.json`.
- **Teams:** Rift/Bridge use team 0 and team 1 (display names and colors from the style bible).
  Fray: team = seat; each seat gets `ModeDef.playerColors[colorIndex]`.
- **Ids:** lower_snake_case. Display text lives in records (`name`, `desc`) or `strings.en.json`.
- **Time in data:** seconds. Percent stats are fractions.
- **Blender → glTF:** Blender Z-up, models face **−Y** in Blender (front view), feet at origin. The
  exporter maps (x, y, z) → (x, z, −y), so models face **+Z** in three. 1 Blender unit = 1 m.

## §3 Catalog: build, versioning, boot

### §3.1 Two builds that ship separately
- **Client build:** `npm run build` → `dist/` (code + fonts + `public/`). Contains **no content**.
- **Content build:** `npm run content` → `dist-catalog/`:
  ```
  dist-catalog/
    manifest.json
    schema-1/<version>/catalog.json        parsed, defaults applied, asset refs rewritten
    assets/<sha256-12>-<basename>          content-addressed, immutable, shared across versions
  ```
- `npm run package` assembles `deploy/` = `dist/` + `dist-catalog/` under `deploy/catalog/` for the
  existing R2 uploader. A CDN move only changes `public/config.js` (or `?catalog=`).

### §3.2 Manifest
```json
{ "format": 1, "product": "vale",
  "schemas": { "1": { "version": "2026.10.0", "catalog": "schema-1/2026.10.0/catalog.json", "sha256": "…" } },
  "history": [ { "schema": 1, "version": "2026.10.0", "builtAt": "…" } ] }
```
Paths are relative to the manifest URL. Asset refs inside a catalog are relative to the manifest
directory too (`assets/…`).

### §3.3 Schema negotiation (old clients keep the old schema)
- `src/contracts/catalog.ts` exports `SCHEMA_VERSION`. The client declares
  `CLIENT_SCHEMAS = [1]` (every schema it can read) and picks the **highest** schema present in
  the manifest that it supports. It never reads a schema it does not list.
- A breaking change bumps `SCHEMA_VERSION`, and `tools/schema_migrations.ts` gains a
  down-converter `vN → vN-1`. The content build then emits **every** schema it can still convert to,
  so a client built for schema 1 keeps working after schema 2 ships.
- Additive optional fields never bump the schema.

### §3.4 Content checks (the build fails on any)
zod strict parse · cross-references (roles, resources, units, items' components, skins → fighters,
offers → skins, queues → modes, modes → maps, cues/vfx ids used by abilities exist, clip roles
exist) · every fighter has ≥ 1 base skin owned by `store.starterOwnership` · every asset ref
resolves to a file · deny-list names (case-insensitive whole-word match on names, titles, item
names, map names, objective names, mode/queue names) · item recipes sum (component costs ≤ total)
· per-fighter kit completeness (passive + a1 a2 a3 ult; each with icon, desc, ai hint).

### §3.5 Boot (`src/boot/`)
1. Resolve catalog URL: `?catalog=` → `window.VALE_CONFIG.catalog` → `./catalog/manifest.json`.
2. Fetch manifest, negotiate schema, fetch `catalog.json`, check `schema`.
3. Create `Session` (LocalSession), `AudioEngine`, `Renderer`, mount `ui/App`.
4. Preload the client-critical assets (menu scene, UI art, music bed); match assets load on the
   loading screen from `MatchSetup`.

## §4 Content schema
`src/contracts/catalog.ts` is the whole schema (zod; strict). Summary of the records:
roles · resources · fighters (stats, attack, kit = passive + a1 a2 a3 ult, art, ai, palette) ·
skins (cosmetic only) · items (tiered recipes, stats, passives, active, pools) · setup (battle
spells + boons + paths; the pre-match layer) · units (minions, monsters, structures, summons,
wards, pickups) · teamBuffs · maps · modes (rules + pick format) · queues (rules overrides, draft,
bench, ranked, bots, grants) · ranks · store (currencies, offers, shelves, starter ownership) ·
client (nav, mode slots incl. reserved, home, menu scene) · audio (cues + music) · vfx · strings ·
botNames.

**Mode slot from data:** `client.modeSlots` lists the mode-select tiles. A reserved slot
(`mode: null, status: 'reserved'`) renders as a designed "future mode" tile. Adding a mode later =
new ModeDef + QueueDefs + map + filling the slot; no client change.

## §5 Simulation (`src/sim/`, lane SIM)

### §5.1 Facade
`src/sim/sim.ts` exports `createSim(catalog: CatalogT, setup: MatchSetup): SimApi` (see
`src/contracts/sim.ts`). 30 Hz fixed tick (`TICK_DT`). `step()` applies queued commands, runs
systems in a fixed order, returns that tick's `SimEvent[]`. `view` is live and read-only.

System order per tick: commands → statuses/buffs → regen → casts/channels → attacks → projectiles
→ zones/areas → movement (steering + nav) → minion/monster/structure AI → bots (they emit
commands for next tick) → deaths/respawns/economy → vision → mode rules (objectives, end checks).

### §5.2 Stats and combat
- Final stat = (base + growth × (level − 1)) + items + buffs + boons, then % modifiers.
- Damage after mitigation: `armor/resist ≥ 0 ⇒ dmg × 100 / (100 + value)`;
  `< 0 ⇒ dmg × (2 − 100 / (100 − value))`. Pen: % first, then flat. True damage ignores both.
- Cooldown with haste: `cd × 100 / (100 + haste)`.
- Shields absorb before hp. Healing/shield power multiplies outgoing heals/shields; `grievous`
  cuts incoming healing by its power.
- Tenacity shortens stun/root/slow/silence/fear/taunt/sleep (not airborne).
- Attack timing: `period = 1 / attackSpeed`; damage lands at `windup × period` (melee) or spawns
  a homing projectile then (ranged). Attack speed cap 2.5.
- Crit: `crit` chance from the seeded stream, `critDamage` default 1.75.

### §5.3 Effect DSL
The interpreter in `src/sim/effects.ts` implements **every** `op` in `EffectT` (catalog.ts).
Context: `{ caster, rank, target?, point, dir, hit?, end?, source: {kind:'ability'|'item'|'boon'|'spell'|'passive', id} }`.
Scaling: `base[rank-1]` (or the scalar) + Σ ratio × stat (caster unless `target*` keys).
`Ranked` arrays shorter than maxRank repeat their last value. Unknown `script` ids are a content
build error. Every `script` behaviour lives in `src/sim/scripts/<id>.ts` and is registered by id.

### §5.4 Units and map systems
- Nav: walkability grid at `map.navCell` from `walls`; A* with octile heuristic + string pulling;
  units are circles with soft separation; dashes stop at walls.
- Minions follow `lanes[].path` (team 1 walks it reversed) and use the target-priority rules in
  `UnitDef.behavior` (attacker-of-ally-fighter first, then nearest minion, structure, fighter).
- Structures: `requires` gates damage (protection); towers prefer minions, switch to a fighter
  that damages an allied fighter in range; consecutive hits on the same fighter ramp.
- Camps: monsters leash back and reset when pulled beyond `behavior.leash`; objectives grant
  `onTakedownTeamBuff` to the killing team.
- Vision: per-team grid (`navCell × 4` cells), sight from fighters, minions, structures, wards;
  thickets hide units inside from outsiders unless revealed; `visibleMask` per entity.
- Pickups (Fray/Bridge): units of kind `pickup` with `behavior.grant` effects; respawn per map.

### §5.5 Mode rules (rules layers on one sim)
`src/sim/modes/<kind>.ts` implements `ModeRules` for each `RulesParams.end.kind` plus the pick
specifics. Queues override `RulesParams` (merged in `session/`, passed in `MatchSetup` via the
queue id; the sim resolves `mode.rules ⊕ queue.rules`).
- `core`: the team whose `coreStructure` dies loses (Rift, Bridge). Surrender vote per rules.
- `last_standing_or_score` (Fray): each player has `lives`; a death costs one; respawn while lives
  remain; eliminated players get placement in reverse elimination order; first to `killScore`
  ends it; at `timeLimit` the rest are ranked by score, then damage. Placement points per rules.
- Practice: `queue.kind === 'practice'` enables the `practice` command family.

### §5.6 Economy in-match
Gold: last hits (bounty to killer), passive gold, kill bounty with streak/shutdown, assists share,
structures (team-wide), objectives. XP: shared among fighters in range (`xpRange` 16 m) of a death.
Shop: `rules.shopAccess`, 6 slots, recipes consume owned components (price = total − owned
components), sell at `sellRatio`, undo until leaving the shop. Item pool filter: `rules.itemPool`.

### §5.7 Bots (`src/sim/bots/`, lane BOTS)
Bots are controllers inside the sim tick (deterministic, seeded). Each bot reads the same view a
player would (respecting fog), and emits `Command`s. Utility-scored modes: lane, farm, trade,
all-in, retreat, recall/shop, push, defend, objective, roam, teamfight, ffa-hunt, pickup.
Difficulty changes reaction delay, aim error, last-hit accuracy and decision quality — never stats.
Draft bots (`src/sim/bots/draft.ts`) pick by role need, comfort, counters; ban by threat. Bot
shopping follows per-style build paths derived from item tags.

## §6 (merged into §5.3)

## §7 Session seam (`src/session/`, lane SESSION)
`src/contracts/session.ts` defines `Session`, `MatchClient`, `DraftState`, `Profile`.
- `LocalSession` implements matchmaking (simulated search 2–6 s, ready-check), party (you +
  optional bot party members), draft host (`src/session/draft.ts`, timer-driven, bots act through
  the same `DraftAction`s), Bridge random assignment + bench, Fray pick, loading, match host,
  post-game, grants, ratings, store, profile persistence.
- `LocalMatchHost` implements `MatchClient`: owns a `SimApi`, a fixed-step accumulator driven by
  `pump(dt)`, interpolation `alpha`, time scale, and the human seat's command sink.
- Dedicated-server seam: `RemoteSession` (stub file with the method list and TODOs) shows where a
  socket replaces the local host. Nothing in ui/render/audio may assume local.
- Login seam: `IdentityProvider` + `ProfileStore`; local implementations persist to
  `localStorage['vale.profile.v1']` (try/catch; in-memory fallback).

## §8 Economy, ownership, rating (lane SESSION)
- Currency is earned by play only (`CurrencyDef.earnedOnly`). Grants come from
  `QueueDef.grants` (win/loss base + per-minute, capped; Fray adds `grants.placement[placement-1]`)
  + first win of the day bonus. Bots never earn.
- Every wallet change is a `LedgerEntry`; every owned skin is an `OwnershipRecord` (§session.ts).
- `purchase(sku)`: offer exists and is in its date window → not owned → funds ≥ price → append
  ledger entry (−price) → append ownership record → persist → emit `profile`.
- `equipSkin`: only owned skins (base skins are starter-owned).
- Ranked: Glicko-2 on `QueueDef.ranked.ratingId`; tiers from `ranks`. Provisional until
  `placementGames`. Bots in ranked use `difficulty: 'by_rating'`.

## §9 Presentation (`src/render/`, lane RENDER)
- `createRenderer(canvas, catalog, settings)` → `{ setScene('menu' | MatchClient), resize, render(dt), setQuality(settings.video), pickGround(x, y), pickEntity(x, y), worldToScreen(...) }`.
- WebGL2 `WebGLRenderer`, linear workflow, sRGB output, `postprocessing` EffectComposer:
  N8AO (contact AO) → bloom (mipmap) → LUT3D (the map's locked grade) → tone mapping (per bible)
  → SMAA. Quality ladder §9.4.
- Sky: map `art.sky` equirect HDR → PMREM environment + background. Height/distance fog per map.
- Shadows: one directional sun with a shadow frustum fitted to the camera view, texel-snapped.
- Fog of war: `view.visionGrid(localTeam)` → R8 `DataTexture` (smoothed over time) sampled by a
  shader chunk injected into every world material; enemies not in `visibleMask` are hidden.
- Characters: fighter GLB cloned per entity (`SkeletonUtils.clone`), `AnimationMixer` driven by
  `state/anim/stateTime`; run clip scaled by speed / `runRefSpeed`; attack/cast clips scaled so the
  authored impact (40 % of clip) meets the sim windup. Accent material emissive = readability color.
- Readability: team/player ground ring, overhead bars (hp with tick marks, shield, resource,
  level), enemy outline on hover, telegraph decals (shader) per `Present.telegraph`, colorblind
  palettes from settings.
- §9.5 VFX: `VfxDef.layers` are emitter records `{ type: 'burst'|'trail'|'ring'|'beam'|'flash'|'mesh'|'decal', ... }`
  interpreted by `render/vfx/` (GPU-instanced quads, procedural textures). Team tint when `teamTint`.
- §9.4 Quality ladder (settings.video): Low (scale 0.75, no AO, shadows 1024 hard, no bloom, FXAA-off,
  particles 0, scatter 0) · Medium (0.9, AO half-res, 2048, bloom, SMAA, 1, 1) · High (1.0, AO, 2048
  PCF, bloom, SMAA, 2, 2) · Ultra (1.0 + DPR up to 2, AO full, 4096, bloom, SMAA, 2, 2). Target:
  stable 1080p60 on High on a mid-range gaming GPU; dynamic resolution may drop scale to 0.8.

## §10 Client UI (`src/ui/`, lane UI)
- Preact 11 + `@preact/signals`. `ui/app.tsx` mounts over the canvas. Screens are modules in
  `ui/screens/<id>.tsx` registered in `ui/screens/index.ts` by screen id; nav comes from
  `catalog.client.nav`. A new screen = new module + registry entry + catalog nav record.
- Required screens: home, play (mode select + queue select + party), lobby/queue (search,
  ready-check), draft (Rift draft/blind/role preset; Bridge assignment + bench; Fray pick),
  loadout (setup layer), loading, match (HUD), postgame, collection (fighters, skins), shop
  (store), profile (overview, history, rating), settings (video, audio, controls, accessibility
  incl. colorblind + UI scale), practice setup, custom lobby.
- Every screen has motion (enter/exit), hover/pressed/selected/disabled/locked/loading/empty
  states, keyboard focus, and UI sounds — per the style bible.
- HUD: ability bar (cooldown sweep, rank pips, cost, level-up), portrait/level/xp, hp/resource,
  items + gold + in-match shop, minimap (click to move camera, right-click move, pings), kill
  feed, announcer banner, objective timers, Tab scoreboard, death recap, ping wheel, Fray
  placement board, Bridge bench in pick, surrender vote.
- Input (`src/input/`): rebindable keymap (defaults in the bible), quick cast vs normal cast,
  attack-move, camera lock/edge pan, self-cast modifier.

## §11 Audio (`audio/`, `src/audio/`, lane AUDIO)
- All music and SFX are original, synthesized by `audio/synth/*.py` (numpy + ffmpeg → OGG/Opus).
  No samples from any shipped game, library, or sound pack.
- Required: menu bed (loop), draft bed, match bed (loop, 2 intensity layers), victory sting, defeat
  sting, Fray placement sting, impact set (attack light/heavy, ability hit by damage type, crit,
  structure hit/fall), UI set (hover, click, confirm, back, error, queue pop, lock-in, shop buy,
  shop sell, currency tick, equip), match events (level up, kill, death, objective, wave), announcer
  stingers (tonal, no voice in this slice; subtitles carry the text).
- `src/audio/engine.ts`: buses music/sfx/ui/voice/ambience → master, ducking (voice > sfx > music),
  voice limits per cue, listener at the camera target, muting via settings.

## §12 Art pipeline (`art/`, lane ART)
- Blender 5.2, `--background --factory-startup`, deterministic (fixed seeds). `art/build.py`
  runs a script with the blender exe from `$BLENDER` if set, else in-process with the `bpy` module.
- **Rig standard `VALE_BIPED_1`:** `root, hips, spine, chest, neck, head, shoulder.L, upper_arm.L,
  forearm.L, hand.L, shoulder.R, upper_arm.R, forearm.R, hand.R, thigh.L, shin.L, foot.L, toe.L,
  thigh.R, shin.R, foot.R, toe.R, prop.R (child of hand.R), prop.L (child of hand.L)`; extra bones
  are allowed with prefix `x_` (capes, tails, wings, hair). A-pose rest. Non-biped fighters still
  carry the standard bones (placed sensibly) so shared clip tooling works.
- **Clips** (Blender actions → glTF animations): required `idle, run, attack1, attack2, cast_a1,
  cast_a2, cast_a3, cast_ult, death, recall, idle_lobby, victory`; optional `crit, channel, dash,
  stunned, spawn, taunt`. Impact frame at 40 % of attack/cast clips. `run` authored for a stated
  reference speed in m/s (written to the fighter JSON).
- **Materials:** PBR (base color / ORM / normal baked from Blender materials at 1024², 2048² for
  landmarks); an emissive material named `accent` on every fighter (team/player readability tint).
- **Budgets:** fighter 10–25k tris, skin same rig, minion 1.5–4k, monster 4–12k, structure 4–20k,
  a map scene ≤ 700k tris (scatter instanced via EXT_mesh_gpu_instancing).
- **Outputs:** `art/out/fighters/<id>/<id>.glb`, `…/<skin>.glb`, `…/portrait.png` (512²),
  `…/splash.png` (1600×900), `…/icon.png` (128²); `art/out/units/<id>.glb`;
  `art/out/maps/<id>/scene.glb`, `minimap.png`, `sky.hdr`; `art/out/ui/*`. Cycles renders for
  portraits/splashes (no OIDN in the bpy wheel: use ≥ 128 samples + ffmpeg `nlmeans` denoise).
- QA: every build writes a turntable contact sheet to `art/renders/` for review.

## §13 Harness and gates
- `npm run typecheck` · `npm run content:check` · `npm run probe` (runs every `_harness/probe_*.ts`):
  determinism, skin neutrality, content ids not in code, a full bot match per queue to a real win
  condition within its time budget (rift_standard, rift_quick, rift_ranked, rift_coop,
  bridge_standard, fray_standard, custom, practice smoke), economy (grant → purchase → equip),
  schema negotiation (a schema-1 client against a manifest that also offers schema 2).
- `_harness/e2e.mjs` (Playwright, Chromium + SwiftShader): the DONE journey with real input and
  screenshots into `_harness/_shots/` (gitignored), reviewed by eye.

## §14 Lanes and ownership

| Lane | Owns |
|---|---|
| LEAD | `_spec/`, `_design/`, `src/contracts/`, `src/boot/`, `README.md` |
| SIM | `src/sim/**` except `src/sim/bots/**`; `_harness/probe_sim_*.ts` |
| BOTS | `src/sim/bots/**`; `_harness/probe_bots_*.ts` |
| CONTENT | `content/**` |
| TOOLS | `tools/**`, `vite.config.ts`, `_harness/run_probes.ts`, `_harness/probe_content_*.ts`, `_harness/e2e.mjs` |
| SESSION | `src/session/**`; `_harness/probe_session_*.ts` |
| RENDER | `src/render/**` |
| UI | `src/ui/**`, `src/input/**`, `index.html` |
| AUDIO | `audio/**`, `src/audio/**` |
| ART | `art/**` |
