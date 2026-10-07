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
  CHANGED(TOOLS): it deletes and rebuilds `--out`, so it refuses an `--out` that is a filesystem root,
  contains the project, overlaps `--dist`/`--catalog`, or is a non-empty folder that is not a previous
  deploy (exit 2).

### §3.2 Manifest
```json
{ "format": 1, "product": "vale",
  "schemas": { "1": { "version": "2026.10.0", "catalog": "schema-1/2026.10.0/catalog.json", "sha256": "…" } },
  "history": [ { "schema": 1, "version": "2026.10.0", "builtAt": "…" } ] }
```
Paths are relative to the manifest URL. Asset refs inside a catalog are relative to the manifest
directory too (`assets/…`).
CHANGED(TOOLS): the shape is typed once in `src/contracts/manifest.ts` (`CatalogManifest`), imported by
both `tools/build_content.ts` (writer) and `src/boot/catalog.ts` (reader). `history` is append-only;
an unchanged rebuild of the same version keeps the catalog bytes and adds no entry.

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
CHANGED(TOOLS), additive: the build also fails on duplicate ids, map coordinates outside `size`,
unknown `script` ids (no `src/sim/scripts/<id>.ts`), `form`/`inForm` ids not in the fighter's
`passive.forms`, offers/shelves/wallet → currencies/skus, setup defaults/paths, map music, mode
slots, team buffs, structure/camp/pickup/minion unit kinds, and §9.5 VFX layer types/keys/values.
CHANGED(TOOLS), additive: `UnitDef.behavior` is checked against the sim's vocabulary
(`src/sim/units/behavior_keys.ts`, §5.4): a key not read for the unit's kind, a wrong value shape or an
unknown priority token fails the build; effect lists in behavior (pickup `grant`) are zod-parsed like
any effect list and shipped WITH their defaults. A map whose `size / navCell` exceeds 2 000 000 nav cells
fails (the sim allocates per cell).
Deny-list tiers (full rule in the header of `tools/names_check.ts`): multi-word and non-dictionary
entries match whole-word anywhere (names and prose); dictionary words in a `strict` category match
inside name fields; other dictionary words and every `exact_only` entry match only an ENTIRE name;
`_design/names_allowlist.json` `allow` removes an entry, `scope` limits that to catalog paths
(`modes[].name`). `strings.en.json` is checked with prose rules.

### §3.6 Content source files (CHANGED(TOOLS): new; documents what `tools/build_content.ts` reads)
- `content/version.json` = `{ "version": "YYYY.M.patch" }`; bump it for every published change.
- Array families (`roles items units team_buffs modes queues ranks vfx bot_names`, `skins/<fighter>`)
  are a JSON array (or `{ "<family>": [ … ] }`); object families (`setup store client audio
  strings.en`) are one object; `fighters/<id>.json` and `maps/<id>.json` hold ONE record whose `id`
  equals the file name; a skin in `skins/<f>.json` must have `fighter: "<f>"`. Records are read in
  file-name order. `"$comment"`/`"$schema"` keys are stripped at any depth; a UTF-8 BOM is fine.
- Asset refs `assets/<path>` resolve against `content/<path>`, then `art/out/<path>`, then (for
  `assets/audio/<p>`) `audio/out/<p>`; exact case; known formats are sniffed (a Git LFS pointer
  fails). Each is copied to `dist-catalog/assets/<sha256-12>-<basename>` and the ref rewritten.
- Dev and preview serve `/catalog/*` from `dist-catalog/` (`VALE_CATALOG_DIR` overrides), so
  `./catalog/manifest.json` works unchanged in dev, preview and deploy.

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

CHANGED(TOOLS), zod 4 fixes in `catalog.ts` (no valid content changes meaning): `FighterArt.clips` is
an explicit strict object (§12 required roles required, optional roles optional) because zod 4 made
`z.record(ClipRole, …)` exhaustive; `buff.statScaling` is `z.partialRecord` for the same reason;
`setup.spells`/`setup.boons` use `.extend()` instead of `.and()` (an intersection let unknown keys
through); `Scaling.perCounter`/`perMark` are `.strict()`.

CHANGED(SIM), additive optional fields in `catalog.ts` (no schema bump): `FighterDef.sightRange` (fog-of-war
sight in metres; omitted = 12) and `RulesParams.tuning` = `{ assistWindow, xpShareRange, killXpFraction,
multiKillWindow, fountainHealPerSec, suddenDeathRespawnMult }`, every key optional, defaults = the numbers in
§5.5/§5.6 (10 s, 16 m, 0.6, 10 s, 0.15/s, ×1.5). Queues override them key by key like any rules.

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

CHANGED(SIM), additive: `createSim(catalog, setup, opts?)`. `opts.bots?: (seat, host) => BotController | null`
gives each `controller: 'bot'` seat its brain (§5.7; `host` = `{ catalog, setup, rng }`, a per-seat seeded
stream); `opts.pregameSeconds` (default 5; 0 starts live). It returns `Sim` = `SimApi` + `world` (the internal
World, for harness/bots tooling) + `faults` (bot controllers that threw and were disabled). The match starts in
phase `pregame` at time −pregame: seats may buy, sell, undo, swap items, level abilities and ping; move, attack,
stop, cast, recall and surrender votes are dropped. At time 0 it turns `live` (announce `match_start`). After the
`end` event `step()` returns `[]` and the view stays frozen on the final state. Commands apply the tick after they
are queued, in seat order (arrival order within a seat); an eliminated seat's commands are dropped except pings;
pings are limited to 5 per 4 s per seat. A practice `resetMatch` rebuilds the world (tick 0) behind the same
SimApi. The exact system list per phase is the header of `src/sim/sim.ts`.
CHANGED(SIM): commands are untrusted input. `command()` drops a malformed one (not an object, unknown `type`,
non-finite `x`/`y`, a non-integer `target`/`slot`/`a`/`b`, an unknown ping `kind`) instead of letting a NaN
reach a position; a bot whose `think` returns a non-array is a fault like a throw. A non-finite
`pregameSeconds` means the default.

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

**CHANGED(SIM): resolved semantics** (clarifications only: no schema or type change, nothing
existing breaks). Content authors rely on these:
- **Rank** of non-ability sources: battle spells and item actives use `min(level, maxRank)`;
  passives, boons, item and team-buff passives use the owner's level. Unit abilities are rank 1.
- **Ranks/level-up:** one skill point per level; a basic ability's rank is capped at
  `min(maxRank, abilityRanks.basicMax, ceil(level / 2))`; ult rank r needs `level ≥ ultLevels[r−1]`.
- **Haste** shortens a1..ult cooldowns and recharges only, not battle spells or item actives.
  **Silence** blocks a1..ult only. Taunt and fear also block casting.
- **Casting:** cost and cooldown are paid when the windup ends (a windup cancelled by stun,
  airborne, sleep, taunt, fear or silence costs nothing). A move order never cancels a windup.
  **Channel:** `onTick` runs every `interval`; the ability's `effects` run when the channel
  **completes**. A move order ends a channel unless `canMove`. Interruptible channels end on the
  same CC. **Recast:** the recast record's `cooldown` is the lockout before it can be used; the
  first record's cooldown starts when the window closes (recast used or expired).
  **Charges:** `cooldown` is the lockout between uses; `recharge` refills one charge at a time.
- **Unit targets** must be visible to the caster's team. Out-of-range unit/point casts walk into
  range first. Range is centre-to-edge for unit targets (`range + target radius`).
- **Ops:** `repeat` runs its first iteration at once and stops if the caster dies.
  `cooldown.percent` reduces the *remaining* cooldown. `perCounter`/`perMark` multiply the whole
  value by `stacks × per`. `consumeMark` removes the mark before running `perStack`. Marks belong
  to their applier. `form` on the current form toggles back to the base kit. Buff `onExpire` runs
  on timeout only, not when empowered attacks use the buff up. Homing projectiles hit only their
  target. `gold` credits the caster's player.
- **Triggers:** `statusApplied` fires on the applier. `lowHp` fires once per dip, when damage
  leaves the owner matching `cond` (default: below 30 % hp). `interval` and `moveDistance` use
  `Trigger.interval`, in seconds and metres respectively. `damageTaken`, `shieldBroken` and
  `death` have the attacker as their subject; every other trigger has the unit it affected.
  Nested triggers stop at depth 4.
- **Stats:** `range` in stat blocks is bonus attack range. `res` stats add to the resource pool's
  max. Tenacity caps at 0.9 and does not apply to self-inflicted statuses. Default status powers:
  slow 0.3, haste 0.2, grievous 0.4, armor/resist shred 0.2 (a fraction of positive armor/resist).
- **Filters (zod defaults):** a parsed `TargetFilter` has every key. `{ allies: true }` still
  means `enemies: true`, so ally-only effects must say `enemies: false`. Default filters never
  include structures, wards or pickups.
- CHANGED(SIM), review fixes:
  - **Fizzle:** a unit-targeted windup whose target died, left the store, became untargetable, or died and
    respawned before the release does nothing and costs nothing (like a CC-cancelled windup).
  - **One life:** a unit that dies and respawns is a new target. `repeat` iterations stop at the caster's
    death even if it respawns before the next one; a homing projectile whose target died flies to where it
    died and ends there; a `follow` zone stays where its unit died.
  - **Untargetable means unhittable:** a homing projectile (basic attacks included) whose target turns
    untargetable in flight is lost, and so is a basic attack whose target turns untargetable during the
    windup.
  - `stopAtWalls` stops at map walls only. A structure's path-clearance disc is not a wall; a filter with
    `structures: true` decides whether the projectile hits structures.
  - Gold from `gold` ops is × `goldMult` and rounded to a whole number (§5.6).
  - A channel's `onTick` runs at most 16 times in one tick (a sub-tick `interval` cannot hang the sim).
  - **Loadouts:** the sim honours only known spells and boons that are in the rules' pool (the setup
    record's `pools`: empty = every pool), are not duplicates, and fit `spellSlots` (2 slots at most) and
    `boonSlots`. A dropped spell leaves its slot empty and the other spell keeps its slot.

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
  CHANGED(SIM): rebuilt at 10 Hz. Fighters see 12 m (`FIGHTER_SIGHT`); units use
  `UnitDef.sightRange`. Walls do not block sight in this slice. Structures are always visible to
  everyone. Neutral units (team −1) give no vision. Structures block nav cells while alive, so
  paths go around them. Long paths use a graph of the convex corners of the walls, and grid A* is
  the fallback.
  CHANGED(SIM): a body may stand inside a structure's clearance disc, because bodies collide with the
  structure's radius. Dashes and knockbacks starting there move out when they head away from the
  structure, and never pass through it. A blink into a wall lands on the nearest walkable cell, with a tie
  going to the caster's side. Neutral units (team −1) are hostile to every team and allied to each other,
  so a monster's area ability never hits its campmates. A new unit is visible to its own team from its
  first tick. `FighterDef.sightRange` sets a fighter's sight (default 12).
- Pickups (Fray/Bridge): units of kind `pickup` with `behavior.grant` effects; respawn per map.

CHANGED(SIM): resolved unit semantics (clarifications; no schema change).
- `UnitDef.behavior` keys the sim reads (all optional; defaults in brackets; documented in
  `src/sim/units/common.ts`): minion `aggroRange` [max(7, attack range + 3)], `chaseRange` [aggroRange + 4],
  `callForHelpRange` [9], `priority` [`fighterAttacker, minion, summon, structure, fighter`] · structure
  `targetRules` ['tower', or 'none'], `priority` [`fighterAttacker, minion, summon, monster, fighter`],
  `callForHelpRange` [attack range + radius + 2], `rampPerHit` [0.4], `rampMax` [1.2], `rampReset` [3 s] ·
  monster `leash` [8], `resetRegen` [0.25 of max hp/s] · summon `aggroRange` [8], `followRange` [3],
  `ownerLeash` [12] · ward `invisible` [false] · pickup `grant` (EffectT[]), `gold` [0] · any unit
  `damageMult` ({ <entity kind>: multiplier } on its damage) and `dummy` (marks the practice training
  dummy). CHANGED(SIM)/(TOOLS): the machine-readable list is `src/sim/units/behavior_keys.ts`, and the
  content build validates every behavior against it (§3.4). Summons also read `priority` and
  `callForHelpRange`. Pickup `grant` lists are zod-parsed by the build and ship with their defaults. Priority tokens: `fighterAttacker` / `minionAttacker` (hurt a fighter /
  minion of my team within the last 2 s, that ally standing within my callForHelpRange) or an entity kind;
  nearest within a token; a valid current target is kept unless a call-for-help token outranks it.
- Waves: wave n spawns at `first + (n − 1) × interval` on every lane for teams 0 and 1; a composition entry
  joins when `n % everyNth === 0` and the wave time ≥ `from` (match seconds); minion level =
  1 + floor(wave time / upgradeEvery). A minion pulled off its lane rejoins at the next waypoint ahead.
- CHANGED(SIM): `end.coreStructure` may name a structure UNIT id (every placement of that unit is a core) or
  one map PLACEMENT id (only that placement is); the content build accepts both, so the sim matches both.
- Structures: protected (untargetable + invulnerable) while any `requires` id stands; never in sudden death.
  A map entry with `respawn` comes back as a new entity. Falling emits `structure` (final = the
  `end.coreStructure` unit in a `core` mode) + announce `structure_destroyed`; the destroying team's
  `structuresDestroyed` + 1; a structure's `onTakedownTeamBuff` is granted like a monster's.
  `rules.structures` false: no map structures; `rules.jungle` false: no camps.
- Camps: neutral (team −1), passive until hit, the whole camp aggroes on the attacker, reset beyond the leash
  (walk home invulnerable, arrive at full hp, statuses cleared); the camp respawns `respawn` s after its LAST
  unit died. `WorldView.objectives` lists the `objective` camps. The killing team gets the team buff when a
  unit with `onTakedownTeamBuff` dies or the last unit of an objective camp dies (`objective` event +
  announce `objective_taken`; `TeamView.objectives` lists the buff ids; minionStats apply to that team's minions).
- Pickups: taken by the touching fighter with the lowest id, no death event, back `respawn` s later.
- Summons belong to their caster (kill and gold credit), follow it and attack its target; wards are static
  vision for their `duration`.

### §5.5 Mode rules (rules layers on one sim)
`src/sim/modes/<kind>.ts` implements `ModeRules` for each `RulesParams.end.kind` plus the pick
specifics. Queues override `RulesParams` (merged in `session/`, passed in `MatchSetup` via the
queue id; the sim resolves `mode.rules ⊕ queue.rules`).
- `core`: the team whose `coreStructure` dies loses (Rift, Bridge). Surrender vote per rules.
- `last_standing_or_score` (Fray): each player has `lives`; a death costs one; respawn while lives
  remain; eliminated players get placement in reverse elimination order; first to `killScore`
  ends it; at `timeLimit` the rest are ranked by score, then damage. Placement points per rules.
- Practice: `queue.kind === 'practice'` enables the `practice` command family.

CHANGED(SIM): resolved mode semantics (clarifications; no schema change).
- `core`: with `end.timeLimit`, time ranks teams by structures destroyed, kills, gold earned (a tie at the top
  is a draw). Surrender: `{ yes: true }` opens a 30 s vote once time ≥ `earliest`; only human seats vote when the
  team has any, else every seat; needed = `votesNeeded` when > 1 (capped at the voters), else
  ceil(votesNeeded × voters); a failed or expired vote blocks new ones for 60 s. Sudden death
  (`suddenDeathAt`): `WorldView.suddenDeath`, a `suddenDeath` event, respawn timers × 1.5, no structure protection.
- `last_standing_or_score`: lives default 1; score = kills (`PlayerView.score`); an eliminated seat stops
  respawning and its commands are dropped at once. At the end of that tick (`modes` phase) it gets its
  `placement` (= seats still in when it fell) and an `eliminated` event. CHANGED(SIM): seats eliminated on the
  SAME tick share that block of places by score, then damage to fighters, then seat order. Before, the order
  the deaths happened to be processed in decided, so a double KO of the last two could crown the lower
  score. One seat left ends it (`last_standing`), `killScore` (`score`), `timeLimit` (`time`); the seats still
  in are placed above the eliminated ones by score, then damage to fighters, then seat order (placements are
  always distinct). `placementPoints` is not read by the sim. The sim never reassigns teams: SESSION gives every
  Fray seat its own team.
- `score`: team kills; the first team to `killScore` wins (`score`); at `timeLimit` most kills, then damage
  (a tie is a draw).
- MatchResult: team modes place the winners 1 and the losers 2 (a draw: everyone 1, nobody won); FFA
  `won` = placement 1; `PlayerResult.gold` = gold earned (no start gold, no refunds); `goldGraph` = one sample at
  0:00, one per live minute and one at the end (team 0 − team 1 earned gold; FFA: leader − runner-up); `digest`
  = FNV-1a over every entity's position/hp/statuses/buffs (rounded 1e-4), every seat's level, xp, items, gold and
  stats, the rng streams and the outcome — never skins.
- Practice (queue kind `practice` only; `MatchSetup.practice` is ignored elsewhere): `startLevel`,
  `noCooldowns`, `infiniteGold` (gold kept ≥ 50 000), `dummies` (in a row in front of seat 0; at most 20,
  and a non-finite `startLevel` or `dummies` is ignored). Commands: `gold`
  (+5000), `level` (+1), `resetCooldowns`, `toggleCooldowns`, `spawnDummy` (the first unit in catalog order with
  `behavior.dummy === true`, 4 m ahead, on an enemy team; dummies never attack and heal to full 4 s after the
  last hit), `heal` (respawns a dead fighter), `resetMatch`.
- Announce keys the sim emits: `match_start`, `first_blood`, `multikill` (n), `shutdown` (gold, victim),
  `structure_destroyed` (def, by), `structure_respawned` (def), `objective_taken` (unit), `eliminated`
  (placement), `sudden_death`, `surrender_vote` (yes, no, needed), `surrender_failed`, `surrender_passed`,
  `shop_denied` (item, reason: unknown | pool | access | gold | slots | unique | empty), `practice` (action),
  `practice_reset`.

### §5.6 Economy in-match
Gold: last hits (bounty to killer), passive gold, kill bounty with streak/shutdown, assists share,
structures (team-wide), objectives. XP: shared among fighters in range (`xpRange` 16 m) of a death.
Shop: `rules.shopAccess`, 6 slots, recipes consume owned components (price = total − owned
components), sell at `sellRatio`, undo until leaving the shop. Item pool filter: `rules.itemPool`.

CHANGED(SIM): resolved economy semantics (clarifications; no schema change).
- Every gold amount is × `goldMult` and rounded (DSL `gold` ops included); XP × `xpMult`.
- Unit kills: `bounty.gold` to the credited fighter (reason `cs` and cs + 1 for minions/monsters, `objective`
  for objective monsters, `structure`, else `kill`); `bounty.goldGlobal` to every seat of the destroying team
  (`structure` / `objective`). Kills by neutral units pay nothing.
- Fighter kills: streak bonus = min(streakMax, streakStep × (victim's streak − 1)); shutdown = min(shutdownMax,
  streak bonus); the killer gets kill + shutdown; the assisters split (kill + shutdown) × assistShare, also when
  no fighter got the kill. `takedown.first` = the first takedown with a credited killer; `multi` counts that
  killer's takedowns ≤ 10 s apart (max 5). `PlayerView.bounty` = what the seat is worth now.
- XP: units give `bounty.xp`; fighters 0.6 × the xp step at their level; split evenly between the living
  hostile fighters within 16 m (plus the credited killer anywhere; FFA: only the killer and the assisters).
  `xpTable` shorter than maxLevel − 1 repeats its last step. Passive gold is paid once per second.
- Respawn = min(max, base + perLevel × (level − 1)) × lateGameMult once time ≥ lateGameRampAt (× 1.5 in
  sudden death). Recall: `recallTime` (default 8) to the fountain; broken by damage, new orders, casts, CC or
  being moved; needs a base. The fountain restores 15 %/s of max hp (and of a pool resource) to its team.
- Shop access: `base` (alive in the base shop circle) · `base_or_dead` · `anywhere` · `shops` (alive in a
  `MapDef.shops` circle or the base shop). Recipe prices recurse through components; `uniqueGroup` ignores the
  components a purchase consumes; consumables stack to charges × maxStack; refunds = floor(cost × sellRatio ×
  charge fraction) and are not earned gold; undo is LIFO and clears on leaving the shop or on fighter-vs-fighter
  combat. `src/sim/shop.ts` `quoteBuy` prices a purchase without side effects (bots).
  CHANGED(SIM): `swapItems` only relabels slots, so actives keep their cooldown, charges and recast, and
  passives keep their trigger cooldowns. An undo puts an item back with its active's cooldown and charges
  as they were, minus the time since, so sell + undo is never a free reset. Removing an item (sell, recipe
  consumption, undo) cancels a cast of its active that is in progress. The `rules.tuning` keys (§4) replace
  the fixed numbers of this section when present.

### §5.7 Bots (`src/sim/bots/`, lane BOTS)
Bots are controllers inside the sim tick (deterministic, seeded). Each bot reads the same view a
player would (respecting fog), and emits `Command`s. Utility-scored modes: lane, farm, trade,
all-in, retreat, recall/shop, push, defend, objective, roam, teamfight, ffa-hunt, pickup.
Difficulty changes reaction delay, aim error, last-hit accuracy and decision quality — never stats.
Draft bots (`src/sim/bots/draft.ts`) pick by role need, comfort, counters; ban by threat. Bot
shopping follows per-style build paths derived from item tags.
CHANGED(SIM), additive: the controller seam is `src/sim/sim.ts` `interface BotController { think(world: WorldView,
player: PlayerView): readonly Command[] }`, registered per bot seat through `createSim(catalog, setup, { bots })`
(§5.1). `think` runs every tick in the `bots` phase; its commands apply next tick, exactly like a human's. A
controller that throws is disabled for the match and listed in `Sim.faults`. The harness ships only a trivial
fixture bot (`_harness/fixtures/fixture_bot.ts`).

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
- §9.5 VFX: see §9.5 below.
- §9.4 Quality ladder (settings.video): Low (scale 0.75, no AO, shadows 1024 hard, no bloom, FXAA-off,
  particles 0, scatter 0) · Medium (0.9, AO half-res, 2048, bloom, SMAA, 1, 1) · High (1.0, AO, 2048
  PCF, bloom, SMAA, 2, 2) · Ultra (1.0 + DPR up to 2, AO full, 4096, bloom, SMAA, 2, 2). Target:
  stable 1080p60 on High on a mid-range gaming GPU; dynamic resolution may drop scale to 0.8.

### §9.5 VFX vocabulary (content/vfx.json → render/vfx/)
A `VfxDef` is `{ id, duration, teamTint, layers: Layer[] }`. Every layer has `type`, optional
`delay` (s), optional `at` (`origin` caster/emitter · `target` hit unit · `path` along a projectile
or dash · `ground` the area/zone centre), and colors as `#rrggbb` or `"team"` (the readability color
of the source: ally/enemy/self in team modes, the player color in Fray) or `"element"` (the
fighter palette primary). Ranges are `[min, max]`; `size`/`alpha`/`radius` pairs are `[start, end]`
over a particle's life. Layer types and their keys:
- `burst`: `count, life[], speed[], spreadDeg, size[], color[2], alpha[2], gravity, drag, blend ('add'|'alpha'), texture`
- `trail`: `width, life, color, alpha, texture, blend` (follows a projectile/dash)
- `ring`: `radius[2], width, life, color, alpha[2], blend` (flat ground ring)
- `beam`: `width, life, color, texture, blend` (source → target)
- `flash`: `radius, life, color, intensity` (short point light + glow sprite)
- `mesh`: `shape ('orb'|'blade'|'shard'|'cone'|'pillar'|'disc'|'spiral'|'crescent'|'spike'), scale[2], life, color, alpha[2], spinDeg, blend`
- `decal`: `shape ('circle'|'ring'|'cone'|'rect'|'line'), radius, life, color, alpha[2], texture` (ground mark)
Textures (procedural, render/vfx/textures.ts): `spark, glow, smoke, shard, ring, streak, petal, ember, drop, rune, crack, dust, mote`.
Shared library presets are named `lib_*`; bespoke ones `<fighter>_<slot>_*`. Unknown keys are ignored
by the renderer but flagged by the content build.

### §9.6 Fixed internal ids (code vocabulary, not player-facing)
Mode ids `rift`, `bridge`, `fray` · queue ids `rift_standard`, `rift_quick`, `rift_ranked`,
`rift_coop`, `bridge_standard`, `fray_standard`, `custom`, `practice` · map ids `map_rift`,
`map_bridge`, `map_fray` · item/setup pool ids `rift`, `bridge`, `fray`. Player-facing names live in
the records. Code still never branches on these ids (it branches on `kind`, `pick`, `end.kind`).

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
- CHANGED(TOOLS): probe protocol — each probe is a standalone `node _harness/probe_<x>.ts` run in its
  own process from the project root; exit 0 = PASS, 77 = SKIP (print why), else FAIL.
  `node _harness/run_probes.ts [--only <substr>] [--verbose] [--timeout <s>] [--list]`; results in
  `_harness/_reports/probes.json`. Probes needing content use synthetic fixtures under
  `_harness/fixtures/` (`fx_*` ids). `probe_content_ids` skips ids < 4 chars, contract enum/literal
  vocabulary and the §9.6 fixed internal ids.
- CHANGED(SIM): the skin-neutrality probe of §0 is `_harness/probe_sim_skin_neutral.ts` (lane SIM owns
  `probe_sim_*`, §14). Sim probes: `probe_sim_core_*` (core systems) and `probe_sim_{waves, structures, camps,
  economy, shop, fighters, fray, modes, units, practice, match_core, determinism, skin_neutral, perf, edge}`
  (`edge` = adversarial cases plus a seeded fuzz match with invariants checked every tick).
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
