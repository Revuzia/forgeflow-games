# BLACKRIDGE — BUILD PLAN (authoritative synthesis, v1)

Status: **BINDING**. Build director synthesis of all six design docs, 2026-08-19.
Authority order: `pipeline/knowledge/GAME_DOCTRINE.md` > **this document** > the six
design docs. Where a design doc conflicts with a ruling below, the ruling wins and the
conflict is recorded here — no build agent re-litigates a ruling; a genuinely new
conflict goes to A0 as a freeze-amendment request.

Inputs read in full: `visual_target.md`, `asset_inventory.md`, `architecture.md`,
`level_design.md`, `combat_spec.md`, `harness_plan.md`, GAME_DOCTRINE.md,
`reference_review_2026-07/adoption_plan.json`. On-disk facts verified this session are
marked **[verified]**.

Game: **BLACKRIDGE** — original modern-military FPS. One showcase mission in
**Meridian Ward, Zarov** (night urban rain), player vs Vektor Ancile PMC bots,
4 original weapons, full FFG shell. No multiplayer. Original IP only.

---

## PART 1 — CONFLICT RESOLUTIONS (explicit rulings)

Every known cross-doc conflict, with ruling and reason. R# ids are referenced by the
workstream matrix and the freeze-amendment list (Part 8).

**R1 — Setting & map: Meridian Ward wins.**
Conflict: visual_target §0.1 prescribes a blue-hour Black-Sea *port compound*;
architecture assumes a "Blackridge comms compound" (Operation Ridgeline, ~180×180 m,
gatehouse/barracks/motorpool); level_design delivers "Meridian Ward" (120×120 m night
urban district, full fiction, 44 spawns, 6 beats).
Ruling: **level_design.md wins wholesale** — map, fiction (Zarov / Vektor Ancile /
CINDERLOCK / RAVEN 2-1), beats, spawns, practicals, shot framings. Why: visual_target
§0.1 explicitly permits the level designer to override the setting if the replacement
states equivalent WebGL cheats — level_design §0 states four, each stack-specific
(1024-shadow cap, no baked GI, AgX+bloom already in kernel, fog as perf tool).
Architecture's compound content was placeholder; its module *contracts* survive, its
content *examples* (node keys, mission name, "Operation Ridgeline" tagline) are amended
(R24, Part 8). index.html tagline becomes `meridian ward`.

**R2 — Time of day: night storm.**
Blue hour (visual_target) vs night blackout (level_design). Ruling: night storm per
level_design; visual_target's "bruised warm band at the horizon" survives as the
sodium-pollution band of level_design §5.1. Scorecard D8's "blue-hour ramp" language
reads as "night-storm ramp per level_design §5.1" — recorded as a visual_target
amendment, the anchor's substance (LUT sky, horizon event, ≥2 parallax cloud layers,
survives magnification) is unchanged. `setTimeOfDay('night'|'dusk')` stays in the
frozen surface; 'night' is the only shipped state.

**R3 — Fixed light pool: 1 dir + 1 hemi + 8 spot + 4 point = 14 lights.**
Three different pools were specced (VT: 1+1+8pt+1sp; ARCH: 1+1+10pt+4sp; LD: 1 moon +
8 spot + 4 pt fx, hemi described but uncounted). Ruling — the frozen pool:
- 1 DirectionalLight — moon, **sole shadow caster**, 1024 map (doctrine cap)
- 1 HemisphereLight — sky `#1a2030` / ground `#0a0c10` + sodium tint per LD §3.2
- 8 SpotLight — static leases = LD §3.3's named practicals `L_QUAY, L_ALLEY_A,
  L_PLAZA_KEY, L_ARCADE_SKY, L_BLVD_1, L_BLVD_3, L_FLOOD_W, L_FLOOD_E`
- 4 PointLight — dynamic fx leases: 3 muzzle-flash grants (player + 2 nearest
  on-screen shooters, combat_spec §4.2) + 1 explosion/transformer/fuel-drum
Why: LD's practicals need aimable cones (points cannot aim); combat_spec's flash pool
needs 3 points + headroom. All created at boot `visible:true, intensity 0`, never
added/removed (doctrine §3). `lighting.js` API (bindStatic/lease/dynamicFree) is
unchanged; only the counts amend (Part 8). Every other "light" is emissive + glow card
+ baked ground decal per LD §3.3.

**R4 — Weapon ids, names, and all gameplay numbers: combat_spec wins.**
ARCH shipped ids havoc7/wraith9/longbow/p11 with rough baselines; combat_spec shipped
M-72 "Warden" / KS-23 "Vesper" / LR-1 "Corvus" / GS-9 "Pike" with complete TTK-verified
tables. Ruling: ids = **`warden`, `vesper`, `corvus`, `pike`**; every stat from
combat_spec §2 (damage/RPM/falloff/recoil tables/ADS/spread/reload/sprint-out).
weapon_data.js keeps architecture §3.10's field SHAPE, filled with combat_spec values.
Why: combat_spec is the tuned deliverable (TTK math checked against the 150–400 ms
band); no code exists yet so the rename is free; ids matching display names kills the
"killed by glauncher" bug class. ADS FOVs come from combat_spec §2.1 (vertical).

**R5 — Ballistics: swept projectile, not pure hitscan.**
ARCH §3.7 said "hitscan v1 for all four"; combat_spec §3.1 specs last-circle's swept
sub-stepped projectiles (Warden 700 m/s, Corvus 850, Vesper/Pike 999 "hitscan").
Ruling: combat_spec wins. The frozen `muzzleVel` field already exists, so no interface
change. Why: proven architecture, kills the through-cover bug class, and the ~100 ms
Corvus flight time is the marksman fantasy at zero interface cost. Penetration table
per combat_spec §3.2 (ARCH's "penetration-none-v1" comment amended).

**R6 — Grenades SHIP in v1.**
ARCH's bark table said `grenade-none-v1`; combat_spec §5.9 fully specs frags (bot
eligibility, 1.2 s bark telegraph, 3.8 s fuse, escape-margin math, player 2 carried)
and level_design beat 6 has explodable fuel drums. Ruling: grenades ship. Why: fully
numbered spec exists; explosion FX/light are needed anyway (transformer set-piece +
fuel drums); the camper-dislodge persona assertion depends on a dislodge verb.
Event vocabulary amended (R13).

**R7 — Slide + mantle SHIP in v1.**
ARCH's file comment said "mantle-none-v1"; combat_spec §1.4–1.5 fully specs slide
("the MW2019 signature verb") and mantle, and both C1 (sprint→fire→reload capture) and
the rusher persona ("slide entries") exercise them. Ruling: combat_spec wins. The
frozen cmd struct needs no change: slide derives from crouch-while-sprinting, mantle
from buffered jump at a ledge — both inside player.js.

**R8 — Viewmodel renders via dual-camera, same scene.**
ARCH §3.11 proposed a camera-attached group with "clip-through accepted"; visual_target
§5 hard-requires separate viewmodel FOV + `clearDepth()` + never-clips, and D5 caps
punish world-FOV distortion. Ruling: visual_target wins — same scene graph, same fixed
light pool, layer masks, world camera then `clearDepth()` then viewmodel camera at
**60° vertical** (combat_spec's number; VT's "~54°" approximate superseded). The
dual-SCENE trap (20× irradiance, adoption_plan) stays banned. viewmodel.js signature
unchanged; implementation note amended.

**R9 — FOV units: vertical degrees everywhere.**
VT "world FOV 90–105°" is horizontal; combat_spec "74° vertical default" ≈ 103–106°
horizontal at 16:9 — the docs agree once units are stated. Ruling: all code and
settings use VERTICAL degrees: world default 74, settings range **60–90 vertical**
(ARCH settings_ui's "70–110" was horizontal shorthand — amended), viewmodel 60,
per-weapon ADS FOVs per combat_spec §2.1.

**R10 — ONE shot battery: visual_target's S1–S6 + C1, posed on Meridian Ward.**
Four vocabularies existed (VT S1–S6/C1; ARCH menu/vista/hipfire/ads/night_firefight/
muzzle; LD's six named framings; harness 01-hero-vista…06-soldier-closeup).
harness_plan itself concedes "visual_target's names win." Ruling — canonical scenario
ids in content.json `scenarios`, poses drawn from level_design §8:

| id | VT state (binding for scoring) | Pose source (level_design) |
|---|---|---|
| `S1` | hip-fire mid-firefight w/ muzzle flash | `market_neon_rain` — plaza hero: neon wall, hero puddles w/ planar reflections, ≥2 bots, Warden hip mid-burst, flash light live |
| `S2` | ADS on an AI at range | `boulevard_long_rain` re-posed: Corvus ADS from the barricade line (+37, 1.8, +36) at the platform marksman, 78 m, sodium pools receding |
| `S3` | quiet establishing wide | `dock_infil_skyline` — quay, freighter/crane silhouettes, L_QUAY god-ray, rain |
| `S4` | close-up ground/wall material in practical light | alley under `L_ALLEY_A`: close crop of wet asphalt + wall + steam (derived from `alley_steam_cqb`) |
| `S5` | sky/horizon from elevated position | tram-platform deck (y +4.5) looking S over the boulevard to the 3-ring harbor silhouette |
| `S6` | pause menu + in-mission HUD | ESC overlay over a live plaza frame |
| `C1` | 6 s capture: sprint → stop → fire burst → reload | plaza run, Warden |
| `S7`* | supplementary | `arcade_god_rays` (interior shaft, rain-occlusion proof) |
| `S8`* | supplementary | `gate9_floodlight_stand` (flood beams, wave silhouettes) |
| `S9`* | supplementary | soldier close-up ~2 m, running clip, never bind pose |

\* S7–S9 are scored on D1–D10 like the rest but are NOT part of the blind-verdict set
(VT fixes that at S1–S5 + overall). Utility scenarios `menu` and `bench` also exist;
`?bench=1` = scenario S1 + `autoplay('objective', 30)` (ARCH's `night_firefight`
fixture name superseded). All battery captures: 1920×1080, DPR 1.5, post chain on,
after prewarm, fixed per-scenario seeds (R21).

**R11 — Test surface: architecture §6 API wins; harness extras merged in.**
harness_plan §1 used different member names. Ruling: the frozen surface is
architecture §6 (`__FPS__` aliased `__FFG3D__`, startMission/state/step/spawnBot/
teleport/aimAt/aimAtBot/fire-via-real-MouseEvents/press/look/damage/god/counters/
setScenario/capture/autoplay/pause/setTimeOfDay) **plus** four additions from
harness_plan: `freeze(on)`, `hud(show)`, `give(weaponId)`, `setAmmo(n)`; plus
compatibility aliases `startMatch`→`startMission`, `placePlayer(x,y,z,yaw,pitch)`→
teleport+aim; plus `__FPS__.perfStats` (live counter object) alongside `stats()`.
bootcheck ready expression = ARCH's:
`!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)`.

**R12 — Dev serve port: 8841.**
ARCH said 8799; harness_plan's census **[verified reasoning]** shows 8799 is
driftwake's harness port. Ruling: 8841, so both games' harnesses can run concurrently.

**R13 — Event vocabulary: architecture §4 table + four amendments.**
combat_spec Appendix A used different event names. Ruling: the frozen 16-event table
stands (combat semantics map onto `shot`/`hurt`/`death`/etc.); FOUR events are added
via the freeze-amendment path:
- `explosion {pos:[3], radius, source:'grenade'|'drum'|'transformer'}` → fx, audio, hud(shake/tinnitus)
- `grenade {phase:'out'|'bounce'|'land'|'detonate', who, pos:[3]}` → fx, audio, hud(indicator)
- `whiz {pos:[3], dist}` → audio (supersonic crack, combat_spec §7.2)
- `zone {reverbZone}` → audio (convolver crossfade, combat_spec §7.3)
`bark` kinds become `'contact'|'flank'|'down'|'reload'|'grenade'|'push'|'lastman'|'hit'|'idle'`
(the `grenade-none-v1` placeholder deleted per R6; lines per combat_spec §5.10).

**R14 — Music: fully procedural Web-Audio score.**
asset_inventory suggested Sonniss cinematic packs first; combat_spec §7.5 specs a
complete procedural two-layer adaptive score. Ruling: procedural per combat_spec
(satisfies the FFG no-duplicate-music rule at $0, unique to blackridge). Sonniss
cinematic material may be layered in later ONLY if the critic loop flags the score,
recorded in CREDITS.md when used.

**R15 — Bot bodies: last-circle Meshy `soldier.glb` primary + `juggernaut.glb` heavy;
swat.glb NOT used.**
asset_inventory ranked CC0 `swat.glb` first; visual_target/architecture demand
Meshy-bar characters. Ruling: `games/last-circle/assets/chars/meshy/soldier.glb`
**[verified on disk]** with its baked clip set (`soldier_rifle_idle/walk/run/crouch/
reload`, deaths, hit — the exact ANIMS map) is the primary body; `juggernaut.glb`
**[verified]** is the beat-6 heavy visual; faction identity via material tint
variants (2 bodies, 4 archetype looks — ARCH §3.15's "3 archetypes do NOT need 3
bodies"). swat.glb (low-poly flat-shaded) would fail the S9 close-up and mix art
styles — dropped. Mixamo Rifle-8-Way/Basic-Shooter packs = RESERVE for clip gaps
(e.g. 8-way strafe), baked via the existing mixamo flow, never shipped raw (Adobe
terms).

**R16 — "Heavies" are cosmetic + band, never HP.**
LD beat 6 asks for "armored" heavies; combat_spec §5.5 bans HP inflation and damage
multipliers at every band. Ruling: heavy = juggernaut body + hardened/veteran band +
longer burst allowance — 100 HP like everything else. Fairness is doctrine-anchored;
the silhouette sells the fantasy.

**R17 — FSM naming: frozen state strings carry combat_spec semantics.**
ARCH's 8-string enum vs combat_spec's 7-state FSM. Ruling: strings stay
(`patrol|suspicious|alert|combat|flank|suppress|retreat|dead`); `suspicious` =
combat_spec INVESTIGATE (move to stimulus, search), `alert` = post-search heightened
patrol (detectRange ×1.2 for 60 s). All behavior numbers from combat_spec §5.

**R18 — Environment reflections: baked-from-scene cube, not Poly Haven HDRI.**
asset_inventory recommends industrial HDRIs for IBL; LD §5.4 specs a cube baked once
at load from plaza center + the 512 px planar pass for the 3 hero puddles. Ruling:
LD wins — an abandoned-daylight HDRI mismatches a night scene; the baked cube IS the
scene. Poly Haven HDRIs are not shipped (reference/keyart use only). `sky.env()`
PMREM per ARCH §3.13 feeds standard materials; the plaza cube feeds puddles/glass.

**R19 — Harness file set: harness_plan's wins.**
ARCH §1 listed `shots.py/autoplay.py/bench.py`; harness_plan's set (`shots.js,
shotbattery.py, perfprobe.py, playprobe.py, personas.js, deployverify.py, bootcheck.py`)
is more complete and is the harness designer's deliverable. Ruling: harness_plan set +
`shotserver.py` (R20). ARCH names superseded.

**R20 — Dev server: copy colosseum's shotserver.py; serve_nocache.py is NOT enough.**
harness_plan claims "serve_nocache.py … reuse as-is, zero new server code."
**[verified FALSE this session]**: `grep -n "__shot|do_POST" serve_nocache.py` → no
matches; the actual `/__shot/` POST sink is `games/colosseum/tools/shotserver.py`
(combined static file server + capture sink + no-store, read this session). Ruling:
copy shotserver.py → `games/blackridge/_harness/shotserver.py`, shots dir →
`games/blackridge/_shots/inbox/`, run on port 8841. This is the one dev-server
process for the whole build.

**R21 — Capture resolution: 1920×1080 for the battery** (harness_plan) — ARCH's
1600×900 default parameter stays in the `capture()` signature but the battery always
passes 1920×1080. Determinism per harness §5: the per-scenario seed table lives in
shots.js `SCENARIOS[name] = {seed, timeOfDay, rainPhase, botSeed, …}` and
`setScenario` consumes it atomically (re-seed every stream, freeze sky/rain phase,
zero transient state).

**R22 — Death & checkpoints: beat-checkpoint respawn.**
combat_spec §6 says death cuts to mission-failed; LD §6 says respawn at beat
checkpoint. Ruling: each beat start is a checkpoint; death → 1.2 s fade → restart
current beat (full HP, loadout as at beat entry, completed objectives persist).
Forfeit/abandon still routes through the real loss path (doctrine §6). mission.js
gains checkpoint restore (freeze amendment, A1/A2).

**R23 — Bot caps: 8 live (mission content) / 12 (engine budget).** Not a conflict —
different layers. LD beats never exceed 8 alive; sim/AI/perf budgets sized for 12.

**R24 — Collider `nodes` keys: Meridian Ward set.**
ARCH's compound keys (gate/motorpool/uplink/…) are replaced with the frozen set:
`dock_spawn, quay_mid, alley_dogleg_s, alley_dogleg_n, arcade_ground, arcade_upper,
plaza_center, plaza_west, gallery_mid, blvd_barricade, blvd_mid, platform_deck,
customs_sandbags, gate9, exfil` — A3 owns coordinates (from LD §2), A2/content and
A11/scenarios reference only these keys; contract-gated at load.

**R25 — Mission phases:** frozen enum stands; beats 1–2 = `infil`, 3–5 = `assault`,
6 = `exfil`.

**R26 — Loadout & pickups:** start `warden` + `pike`. `vesper` in a weapon crate at
the arcade west door (beat 4 entry); `corvus` lootable from the platform marksman's
nest (beat 5). Ammo pickup = +1 class mag walkover (combat_spec §2.2). A2 encodes as
content `pickups[]`; interact via the existing cmd `interact`.

**R27 — Critic scoring format: visual_target's JSON.**
harness §3.2's per-(scenario×dimension) rows are superseded. `_shots/scores.jsonl`
appends ONE visual_target-format object per critic per iteration (iteration, critic,
D1–D10 scores, hard_caps_triggered, blind_verdict per S1–S5 + overall,
worst_single_tell, fix_first). Dimension ids are exactly `D1`…`D10`.

**R28 — Critic count:** ≥2 cold critics every scoring iteration; **3 critics on the
ship-decision iteration** (75%-consensus, aegis-gate). Critics see ONLY the PNGs +
the scorecard (+ previous iteration's PNGs from iter 2 on). STOP/plateau rule per
harness §3.3 (quoted in Part 5).

**R29 — Personas: union of both docs.**
combat_spec §8.2 (Novice/Tactician/Rusher + bars) vs harness §2.5 (rusher/optimal/
novice/camper). Ruling: four personas — `rusher`, `optimal` (=Tactician; inherits
Tactician's pass bars), `novice`, `camper` (assertions from harness: never wins
passively, bots dislodge). Pass bars quoted in Part 5.

**R30 — Difficulty:** no player-facing selector v1. The mission ships the authored
band mix of combat_spec §5.5 (beat 1 recruit/regular → finale hardened + ≤2 veterans).

**R31 — three.js import: vendored, from colosseum.**
combat_spec mentioned last-circle's CDN pin; ARCH rules vendored importmap copied from
`games/colosseum/assets/vendor/three/` — **[verified on disk: build/three.module.js +
examples/jsm/ present]**. Vendored wins (no external dep at deploy, newer convention).

---

## PART 2 — MODULE-OWNER MATRIX (12 workstreams)

One owner per file — **no file has two owners**. Cross-lane needs go into the lane
report as `needsElsewhere`, never into another lane's file. All signatures are frozen
by architecture.md §3 as amended by Part 1; a lane may add private exports only.
Asset manifests: each producing lane writes `assets/manifest.<lane>.json`; A0 merges
into `assets/manifest.json` (single-writer rule preserved).

### A0 — `foundation` (integrator; the only agent touching shared entry files)
- **Files**: `index.html`, `game_meta.json` (status `"unpublished"`), `CREDITS.md`,
  `runtime/boot.js`, `core/events.js`, `core/rng.js`, `core/perf.js`, `core/gfx.js`,
  `core/input.js`, `core/settings.js`, `core/view/bridge.js` (FROZEN ≤40 lines),
  `assets/vendor/three/**` + `assets/vendor/draco/**` (copies), `game_controls.js`
  (byte-copy from colosseum, DO NOT EDIT), `assets/manifest.json` (merge owner).
- **Implements**: ARCH §0–§2, §3.1–3.4, §3.18, §5 (boot phases), §7 (page skeleton);
  rulings R3 (pool counts in gfx caps), R9 (FOV units), R12, R24 (amendment logging).
- **Contract**: every export signature in ARCH §3.1/3.2/3.3/3.4/3.18; boot phase
  table §5; the frame loop (single rAF, single `renderer.info.reset()`, fixed-dt
  accumulator, pause discards accumulator); `?v=N` propagation to all dynamic imports;
  `__FPS__`/`__FFG3D__` assignment + `"[boot] COMPLETE — __FPS__ assigned (v<N>)"`.
- **Self-verify**: `python _harness/bootcheck.py` → exit 0 against the skeleton
  (stub sim acceptable in wave 1).

### A1 — `sim-core`
- **Files**: `core/sim/sim.js`, `core/sim/player.js`, `core/sim/ballistics.js`,
  `core/sim/damage.js`, `core/sim/world.js`, `core/sim/mission.js`,
  `core/sim/grenades.js`, `core/sim/sim.selftest.cjs`.
- **Implements**: ARCH §3.5–3.8 (as amended R5/R6/R7/R22/R25); combat_spec §1
  (movement incl. slide/mantle/tac-sprint/buffering), §2.2 (reload commit), §2.5
  (effectiveSpread — THE shared function), §3 (ballistics/penetration/falloff/flinch),
  §5.9 grenade physics, §6 (health/regen); LD §6 beats via content.json.
- **Contract**: THREE-free, Node-runnable, fixed dt 1/60, tick order per ARCH §3.5,
  `sim.state` shape frozen, emits only the R13-amended vocabulary.
- **Self-verify**: `node core/sim/sim.selftest.cjs` → exit 0. The selftest FOLDS IN
  combat_spec §8.1's THREE-free probes: ttk, recoil, spread-identity, movement,
  penetration, grenade, plus determinism (same seed twice → identical snapshot hash)
  and the contract gate over content.json refs.

### A2 — `mission-data`
- **Files**: `content.json` (sole owner).
- **Implements**: LD §2.4 (POIs), §2.7 (path), §6 (all 44 spawns by id + coordinate,
  waves, beat triggers, checkpoints), §7 + §3.3 (signage[] invented brands), §8 →
  `scenarios` (R10 table: S1–S9, C1, menu, bench with seeds/poses vs `nodes` keys),
  R26 `pickups[]`, combat_spec §7.3 reverb zone volumes, archetypes
  (`rifleman`→warden, `cqb`→vesper, `marksman`→corvus, `heavy`→warden+juggernaut,
  R15/R16), mission phases R25.
- **Contract**: ARCH §3.8 mission schema; every objective/archetype/node/scenario/
  spawn ref must resolve (gate throws at load — the Colosseum empty-bout lesson).
- **Self-verify**: `node core/sim/sim.selftest.cjs --contract` → exit 0 (A1 implements
  the gate; A2's data must pass it).

### A3 — `level`
- **Files**: `core/level/layout.js`, `core/level/colliders.js`, `core/level/level.js`,
  `core/level/props.js`, `core/level/materials.js`, `tools/probe_props.mjs`.
- **Implements**: LD §2 (metre-exact layout, 3 lanes + flank, cover density), §3.3
  static practical PLACEMENTS (specs handed to A6 via `staticLightSpecs`), §4 (prop
  dressing + ground-contact GATES: raycast placement, 1.5 cm sink, fail on float
  >0 mm / clip >3 cm, mandatory base decals), §5.4 wetness material setup (roughness
  pulls, puddle masks in vertex color, R18 cube hook); VT §3 (roughness-variance
  maps, anti-tiling, trim sheet, metres/TILE UVs, grime decals); R24 nodes.
- **Contract**: ARCH §3.12 — `layout.js` is the THREE-free single source read by BOTH
  `colliders.js` and `level.js` (visuals and collision cannot drift); colliders shape
  frozen incl. `nodes` (R24 keys), `matClass` surface tags (combat_spec §3.2);
  level.js emits `staticLightSpecs`, never creates THREE.Light.
- **Self-verify**: `node tools/probe_props.mjs` → exit 0 (zero floats/clips) AND
  `node core/sim/sim.selftest.cjs` still exit 0 (colliders feed the sim battery).

### A4 — `weapons`
- **Files**: `core/weapons/weapon_data.js` (wave-1 deliverable), `core/weapons/
  viewmodel.js`, `core/weapons/recoil.js`, `core/weapons/weapon_meshes.js`,
  `assets/weapons/*.glb` (+ its manifest fragment).
- **Implements**: combat_spec §2 in full (R4 tables, §2.3 recoil patterns verbatim,
  §2.4 ADS, §2.6 sway/breath, §2.7 viewmodel lag, §2.8 first-shot signature);
  VT §5 (dual-camera per R8, sway/bob/ADS spring layers, muzzle socket, shell
  ejection positions, pixel-exact sight alignment); asset plan Part 6 (FP spike).
- **Contract**: ARCH §3.10 field shape / §3.11 signatures (viewmodel implementation
  note amended per R8); recoil feeds `input.addLook` (the player fights it); an
  unresolvable GLB spawns the dev placeholder + `__FFG_FALLBACKS__` push (ship
  blocked while non-empty).
- **Self-verify**: `node core/sim/sim.selftest.cjs` (tables drive TTK/recoil probes)
  AND `python _harness/shotbattery.py --iter N --shots S2` + look at the PNG (D5
  bar; sight-alignment pixel probe in testsurface).

### A5 — `ai`
- **Files**: `core/ai/nav.js`, `core/ai/perception.js`, `core/ai/botfsm.js`,
  `core/ai/squad.js`, `core/ai/ai.selftest.cjs`.
- **Implements**: combat_spec §5 in full — awareness meter + night light-factor,
  hearing table (last-known only), FSM per R17, squad director (2 fire + 1 suppress
  token, cross-squad ≤3 damaging attackers per 250 ms), muzzle-block raycast, cover
  scoring, §5.5 bands (R30 authored mix), roll-once-and-latch, §5.9 grenade
  eligibility, §5.10 bark triggers, engagement referee (40 s flank / 75 s push).
- **Contract**: ARCH §3.9 — THREE-free, runs inside sim.step, ≤4 brains think/tick;
  nav grid ≤160×160 baked <150 ms.
- **Self-verify**: `node core/ai/ai.selftest.cjs` → exit 0. Folds in combat_spec
  §8.1 `probe_fairness` (30 seeds: zero pre-reaction shots, latched rolls, token
  caps, zero muzzle-blocked pulls, blow-counted bursts) + `probe_engagement_ends`.

### A6 — `render-atmosphere`
- **Files**: `core/render/sky.js`, `core/render/lighting.js`, `core/render/post.js`,
  `core/render/prewarm.js`, `core/render/dynres.js`, `core/render/weather.js`,
  `core/render/reflect.js`.
- **Implements**: R3 pool via ARCH §3.13 lease API; LD §3 (practicals binding, zone
  contrast, blackout set-piece = intensity/emissive animation ONLY, 5 god-ray cone
  cards), §5.1 sky (3-ring parallax silhouettes, storm clouds, no stars), §5.2 height
  fog (density 0.010, falloff 0.06, start 18 m, 78 m transmittance ≈0.46 check),
  §5.3 rain (2,800 instanced streaks, 220 splashes, 6 drip columns, 4 indoor
  occlusion AABBs), §5.4 planar reflection (512 px, every 2nd frame, plaza layer
  mask ~40 draws, auto-off at dynres floor → envMap fallback), R18 baked cube;
  VT §1 (key:ambient ≥4:1 probe), §2 post stack (AgX + half-res selective bloom +
  ONE composite ShaderPass: vignette/grain/CA/grade/sharpen — GTAO/TAA/MB/DOF/SSR
  banned), §4 (dust motes, aerial perspective).
- **Contract**: ARCH §3.13 signatures; prewarm ×2 (RT-bound + canvas) with fx and
  viewmodel prewarmables; post owns tonemapping (gfx toneMapping NONE).
- **Self-verify**: `python _harness/bootcheck.py` (programs baseline printed) +
  `python _harness/perfprobe.py` perf-static exit 0 + shotbattery S3/S5/S7 review.

### A7 — `fx`
- **Files**: `core/fx/fx.js`, `core/fx/muzzle.js`, `core/fx/tracers.js`,
  `core/fx/impacts.js`, `core/fx/decals.js`, `core/fx/casings.js`,
  `core/fx/explosions.js`.
- **Implements**: combat_spec §4.2 (per-surface table — frozen keys shared with
  audio; muzzle flash = sprite + leased point pulse 0→18→0/55 ms/9 m; 3-light grant
  rule), §2.8 first-shot pop (scale ×1.2), §3.1 tracers (300 m/s cosmetic cap, warm
  0xffd9a0), grenade/explosion fx (R6: flash + ring + smoke + debris, drum/transformer
  variants); VT §5 (shell ejection w/ 10–20 s persistence, decal ring buffer 256,
  ~20 s fade); permanence = D6 hard-cap insurance.
- **Contract**: ARCH §3.14 — `attach(bridge)` registers `shot/death/land/hurt` +
  R13's `explosion/grenade`; all pools preallocated (24 tracers, 12 muzzle sprites,
  64 bursts, 256 decals, 96 casings, ≤4 leased lights via `lights.dynamicFree()`);
  epoch-checked handlers; `fx.prewarmables()` complete (any missed material = a
  perfprobe hitch with `programs` attribution — the gate catches it).
- **Self-verify**: `python _harness/perfprobe.py` perf-combat: **programs delta == 0**
  through a full fx storm; shotbattery S1 review.

### A8 — `soldiers`
- **Files**: `core/chars/actor.js`, `core/chars/anim_map.js`, `core/chars/soldiers.js`,
  `assets/chars/*.glb` (Draco+WebP repacks + manifest fragment).
- **Implements**: doctrine §1 in full (material repair at load, TRS snapshot before
  mixer, strip scale/arm-position tracks, frustumCulled=false, never bind pose);
  R15 bodies (soldier.glb + juggernaut.glb, tint variants), clip set from
  last-circle's baked `soldier_*` GLBs; LD §5.4 wet-shoulder override (on top of
  repair); VT §7 (aim-pose blend, directional deaths, flinch via 70 ms color-multiply
  flash — never emissive, bodies persist ≥20 s); interpolated state reads with alpha,
  off-screen 1-in-3 pose evaluation.
- **Contract**: ARCH §3.15 — `soldiers.ready()` gates mission start (requiredBodies
  pattern, boot never gated); `validateAnimMap` throws on dangling clip (contract
  gate); ≤400 KB per body.
- **Self-verify**: `python _harness/bootcheck.py` (anim_map gate runs at load) +
  shotbattery S9 review + playprobe `stuckBotSeconds == 0`.

### A9 — `audio`
- **Files**: `core/audio/audio.js`, `core/audio/sfx.js`, `core/audio/ambience.js`,
  `core/audio/music.js`, `assets/audio/**` (+ manifest fragment).
- **Implements**: combat_spec §7 in full — 3-layer gunshot stack, distance rings w/
  dist/343 delay, whiz-by, synthesized reverb zones (shooter-tail/listener-wet rule),
  footsteps keyed to §4.2 surface vocabulary + bob-trough lockstep, foley at
  animation beats, R14 procedural score (tense bed + 92 BPM combat layer + stingers,
  music ≤ −12 dB vs guns), hp-muffle lowpass; asset plan Part 6 (last-circle sfx
  copy + Sonniss slices — never raw 96 kHz WAVs).
- **Contract**: ARCH §3.16 — context via wrapped `globalThis.AudioContext` (page Mute
  works), `attach(bridge)` on the R13-amended vocabulary, buses master→{sfx, music,
  ambience}; every recorded call site keeps a synth fallback.
- **Self-verify**: `python _harness/playprobe.py --persona rusher --seeds 11` zero
  page errors + C1 capture listen; manifest byte sums within Part 5 payload budget.

### A10 — `hud-shell`
- **Files**: `core/hud/hud.js`, `core/hud/menu.js`, `core/hud/pause.js`,
  `core/hud/settings_ui.js`.
- **Implements**: VT §6 verbatim (one condensed family, off-white #e8e8e4 + amber
  #d9a441 + reserved red, compass tape, ammo block, no permanent health bar, damage
  vignette curve per combat_spec §6, crosshair driven by the LIVE `effectiveSpread`
  — never a second model, hitmarker/kill variants per combat_spec §4.1, threat-ring
  damage direction §4.3, killfeed with display names, Corvus scope overlay, grenade
  indicator R6); menus = blurred in-engine still + left rail; settings per R9
  (FOV 60–90 vertical) + quality/volumes/sensitivity/bob.
- **Contract**: ARCH §3.17 — `__PAUSE__` wiring, ESC never destroys, abandon →
  `mission.forfeit` (real loss), `screenBefore` assigned on every navigation, hotkeys
  gated while mission live, sim accumulator discarded on resume.
- **Self-verify**: `python _harness/playprobe.py` parity assertions (HUD hitmarkers ==
  sim shotsHit; HUD ammo == sim ammo post-reload; killfeed == kills+deaths) +
  shotbattery S6 review.

### A11 — `qa-harness`
- **Files**: `core/test/testsurface.js`, `core/test/scenarios.js`,
  `core/test/autoplay.js`, `_harness/shotserver.py` (colosseum copy per R20),
  `_harness/bootcheck.py` (driftwake copy, 2 lines changed: URL → port 8841 path,
  ready expr → R11), `_harness/shots.js`, `_harness/shotbattery.py`,
  `_harness/perfprobe.py`, `_harness/playprobe.py`, `_harness/personas.js`,
  `_harness/deployverify.py`.
- **Implements**: harness_plan in full as amended (R10 battery ids, R11 surface,
  R12/R20 serve, R21 determinism + 1920×1080, R27 scores format, R28 critic loop,
  R29 personas); ARCH §6 surface incl. real-input `fire()`/`press()` (doctrine §5),
  hidden-tab-proof `step()` w/ gl.finish timing and `capture()` → POST `/__shot/`;
  headed-Chrome flags + utf-8 preamble + frames-not-wall-clock + `pin()` for held
  inputs + never-overwrite iterNN (exit 3) — all driftwake lessons verbatim.
- **Contract**: `__FPS__.__test` per R11; scenario data read from content.json +
  shots.js seed table; scores.jsonl append-only.
- **Self-verify**: `python _harness/bootcheck.py` exit 0, then one full
  `python _harness/shotbattery.py --iter 1` producing 10 PNGs + manifest with every
  `until` fired.

---

## PART 3 — BUILD ORDER

**Wave 1 — no dependencies (parallel from hour zero):**
| Lane | Wave-1 deliverable | Unblocks |
|---|---|---|
| A0 | full skeleton: index.html, boot phases (stubs OK), all core plumbing, FROZEN bridge.js, vendored three, `__FPS__` stub assigned | everyone (bootcheck target) |
| A3 | `layout.js` + `colliders.js` (THREE-free data FIRST; visuals wave 2) | A1 (world), A5 (nav), A2 (node keys) |
| A4 | `weapon_data.js` complete (combat_spec §2 transcribed; pure data) | A1 (sim imports it) |
| A2 | `content.json` v1 complete (all 44 spawns, scenarios, archetypes, pickups) — iterate by amendment only | A1 (mission), A11 (scenarios) |
| A1 | sim core against frozen contracts + the above data; selftest battery | A5 (aiStep host), A11 (state reads) |
| A11 | shotserver up on 8841; bootcheck ported; shots.js seed table drafted | the whole verify loop |

**Wave 2 — needs wave-1 interfaces (parallel):**
A4 (viewmodel/recoil/meshes + FP asset spike), A5 (ai full), A6 (render/atmosphere),
A7 (fx), A8 (soldiers), A9 (audio), A10 (hud/shell), A3 (level.js/props.js/
materials.js visuals), A11 (perfprobe/playprobe/personas/full battery). Every lane
codes against Part 2 contracts only — no lane waits on another wave-2 lane.

**Wave 3 — integration (A0 leads, all lanes on call):**
1. Full mission runs end-to-end via `__test.startMission` + `autoplay('objective')`.
2. Gate pass 1: bootcheck + sim/ai selftests + probe_props + contract gate all green.
3. Critic loop iterations (shotbattery → ≥2 cold critics → ranked fixes → generator-
   level fixes) until the Part 5 ship bar or the plateau STOP.
4. Perf gates: perfprobe all three phases green at the Part 5 numbers.
5. Persona battery green at Part 5 bars.
6. Deploy (standard FFG R2 flow, withhold `_design/ _harness/ tools/`), then
   `deployverify.py` exit 0 — including one production bot-match.
7. CREDITS.md complete per-asset; `__FFG_FALLBACKS__` empty; `game_meta.json` stays
   `"unpublished"` — the PUBLISH flip is the owner's call (established FFG rule).

---

## PART 4 — ASSET DECISIONS (locked)

All paths verified on disk this session unless noted. Licenses per asset_inventory §3;
CREDITS.md ships day one in last-circle format.

| Asset class | Decision | Exact source path |
|---|---|---|
| Bot body (all archetypes) | last-circle Meshy `soldier` + tint variants (R15) | `games/last-circle/assets/chars/meshy/soldier.glb` + `soldier_*.glb` clip GLBs **[verified]** |
| Heavy body (beat 6) | `juggernaut` tinted, 100 HP (R16) | `games/last-circle/assets/chars/meshy/juggernaut.glb` **[verified]** |
| Bot clips | last-circle baked set primary (rifle idle/walk/run/crouch/reload, deaths, hit); Mixamo packs RESERVE for gaps, baked-only | `games/last-circle/assets/chars/meshy/` + `pipeline/assets/_downloaded/mixamo/animations/` |
| swat.glb / chibi soldier | **NOT USED** (R15) | — |
| 3P/pickup weapons | last-circle Meshy weapons ×6 (bots carry ar/smg/sniper) | `games/last-circle/assets/props/meshy_wpn/wpn_{ar,smg,pistol,shotgun,sniper,glauncher}.glb` **[verified 6 files]** |
| **FP weapons (hero gap)** | Spike (a): upscale `wpn_ar/smg/sniper/pistol` + procedural rail/optic/greeble dressing + dense material treatment, judged at the S2/S4 close-up gate. If the gate fails → **GATED** Meshy generation (~150–250 credits, owner Telegram YES required; only measured datum 180 cr/6 models). Stand-in meanwhile: the spike weapons, flagged in `__FFG_FALLBACKS__` if below bar — ship stays blocked until resolved. Fully-procedural hero weapons are NOT an approved fallback (doctrine §7 letter). | base: `games/last-circle/assets/props/meshy_wpn/` |
| **FP arms (hero gap)** | Rig-cut gloved forearms from the last-circle Meshy body (primary) or `mixamo/characters/Swat.fbx` (backup), posed via Actor snapshot — never bind pose; re-material sleeve+glove. Procedural arms banned (not viable, asset_inventory honest assessment). | `games/last-circle/assets/chars/meshy/soldier.glb` / `pipeline/assets/_downloaded/mixamo/characters/Swat.fbx` |
| Buildings/props/vehicles | Kenney/Quaternius cc0-city kit (mind SOURCES.json scale_warning — per-model rescale for poly.pizza props) | `pipeline/assets/_downloaded/cc0-city/{buildings,vehicles,props,walls,furniture}/` |
| Interior photoreal props (sparing) | Poly Haven models | `pipeline/assets/_downloaded/polyhaven-models/` |
| Ground/wall PBR | Poly Haven asphalt ×7 + concrete/walls; normals GENERATED from displacement (Sobel) at build time — sets ship no normal maps; metres/TILE UVs by construction | `pipeline/assets/_downloaded/polyhaven-textures/` |
| Metal/dirt PBR fill | generated-materials iron_plate / dirt_packed / stone_cobble | `pipeline/assets/generated-materials/` |
| HDRI | **NOT shipped** (R18) — env = sky.env() PMREM + plaza-baked cube | — |
| Gun SFX base | copy last-circle sfx dir wholesale (CC0, licenses in-dir) | `games/last-circle/assets/audio/sfx/` **[verified, FFSL-LICENSE.txt present]** |
| Gun SFX upgrades | Sonniss GDC 2024 per-weapon (Indoor Gun Acoustics 2 for CQB tails, per-weapon mech foley, DavidDumais explosions) — slice to short OGGs, never ship raw WAVs; all 9 zips local so any pack extractable at $0 | `pipeline/assets/sonniss-gdc2024/` |
| Footsteps | Kenney impact-sounds + Antifon pack | `pipeline/assets/impact-sounds/Audio/`, `pipeline/assets/_downloaded/Antifon__Footsteps Pack/Audio/` |
| Ambience | Sonniss beds (UK Construction, Industrial Harbor) at low loop volume | `pipeline/assets/sonniss-gdc2024/` |
| Music | procedural Web-Audio score (R14) — no files | — |
| Crosshair/HUD | procedural canvas (skips game-icons CC-BY attribution); Kenney input-prompts for controls screen | `pipeline/assets/_downloaded/input-prompts/` |
| HUD font | check `pipeline/assets/_downloaded/fonts/` for a bundled condensed grotesque; else system stack (`"Barlow Semi Condensed", "Arial Narrow", system-ui`) — no runtime webfont fetch on the game path | `pipeline/assets/_downloaded/fonts/` |
| Menu backdrop | in-engine captured mission still (VT §6 wants exactly this) — **xAI key-art unnecessary; that gated-cost item is dropped** | self-generated |

**Gated-cost register (owner Telegram YES required before ANY of these):**
1. Meshy FP arms/weapons ~150–250 credits — triggered ONLY if the $0 spike fails the
   S2/S4 close-up gate. Stand-in: spike assets + `__FFG_FALLBACKS__` flag.
2. Suno music — NOT planned; procedural score is the design. Stand-in: permanent.
**Total unavoidable spend for v1: $0.**

---

## PART 5 — FROZEN ACCEPTANCE CRITERIA (verbatim — later phases may not drift)

### 5.1 Boot gate
From harness_plan §2.1 (bootcheck.py): "Exit 0 iff ready && bootGone && !nogpu && no
shader errors && no page errors." Ready expression (R11):
`!!(globalThis.__FPS__ && __FPS__.renderer && __FPS__.sim)`. The deterministic done
signal (architecture §6): `console.log("[boot] COMPLETE — __FPS__ assigned (v<N>)")`.

### 5.2 Performance budget (architecture §8, amended only at the `lights` row per R3)
| metric | budget | gate |
|---|---|---|
| p50 frame time | ≤ 16.7 ms @ dynres-chosen DPR | bench |
| p99 frame time | ≤ 33.3 ms (no sub-30 fps percentile) | bench, FAIL |
| programs at end of prewarm | ≤ 70 | stats() |
| programs delta during mission | **0** | bench, FAIL |
| draw calls (firefight median) | ≤ 320 (planar-reflection pass budgeted inside this at ~40) | stats() |
| draw calls (absolute) | ≤ 480 | bench |
| triangles in view | ≤ 1.2 M | stats() |
| texture count / est. VRAM | ≤ 120 / ≤ 200 MB | stats() |
| lights | fixed pool only: 1 dir + 1 hemi + 8 spot + 4 point (R3) | code review + probe |
| shadow maps | 1 × 1024 (moon dir) — static lamps unshadowed | code review |
| DPR | dynres 1.0–1.5, never above 1.5 | dynres |
| sim tick CPU | ≤ 3 ms; AI share ≤ 1.5 ms (≤4 brains think/tick, 12 bots max) | selftest timing |
| soldier GLB | ≤ 400 KB each (Draco+WebP), 2 bodies total | manifest |
| weapon GLB | ≤ 250 KB each ×4 | manifest |
| payload to MENU | ≤ 6 MB | manifest sum |
| payload mission gate | ≤ +5 MB | manifest sum |
| per-frame allocations | 0 in any update() | review + heap probe |

perfprobe gate wording (harness_plan §2.4, verbatim): "`programs` delta == 0 across
the entire perf-combat phase (pre-warm complete; first muzzle flash/decal/ragdoll
compiles nothing)" and "p99 >= 30 fps equiv (<= 33.3 ms) at DPR 1.5, 1920x1080, on
this box; p50 >= 60 fps equiv."

### 5.3 Autoplay acceptance battery (architecture §6.2, verbatim)
"`objective` on fixed seed finishes the mission ≥ 1/3 runs; `idle` never wins;
`rusher` dies to ≥ 2 different archetypes across 5 seeds; zero page errors; zero
program-count growth after tick 600."

### 5.4 Persona pass bars (combat_spec §8.2, verbatim; `optimal` inherits Tactician)
- **Novice**: "survives mission beat 1 on Recruit-mix ≥ **60%**; completes full
  mission on Recruit ≥ **40%**; median deaths-per-run ≤ 4 (checkpoint respawns)"
- **Tactician**: "clears full mission on Regular-mix ≥ **70%**; on Hardened-mix ≥
  **45%**; ends beats with ≥ 50 hp median"
- **Rusher**: "clears beat 1 on Regular ≥ **50%**; full mission ≥ **25%** (rushing
  viable early, punished late — the intended skill curve); dies to flanks/tokens,
  NOT to sub-band reaction times (assert: every rusher death traces to a shot fired
  ≥ reaction-min after confirm)"
- Fairness-feel bar: "median time from FIRST bot damage on the player to player death
  when caught in the open ≥ **1.2 s** on Regular, ≥ **0.7 s** on Veteran"
- Camper (harness_plan §2.5): "`camper` does not win passively; bots dislodge or
  flank within the match timer" + "`stuckBotSeconds` == 0" + "Every match ENDS".
- Parity: "HUD hitmarker count == sim `shotsHit` … HUD ammo == sim ammo after every
  reload … kill feed entries == sim `kills + deaths`."

### 5.5 Critic ship bar (visual_target, verbatim — the binding contract)
> "**SHIP BAR: every dimension ≥ 8 AND mean ≥ 8.5 AND blind verdict at least
> "borderline" from EVERY critic. Miss any one → iterate. No exceptions, no
> averaging-away a weak dimension.**"

Blind verdict question (verbatim): "Shown this frame cold — no context, no slug, no
expectations — would you believe it is from a AAA console title? **yes / borderline /
no**" — asked per-screenshot for S1–S5, and once overall. "A single confident 'no'
from any critic blocks ship regardless of dimension scores".

Hard-cap rule (verbatim): "A named amateur tell that is VISIBLE in the battery
hard-caps its dimension at the score listed with it, regardless of everything else
done right."

Mean + perf separation (verbatim): "Mean = arithmetic mean of D1–D10 AFTER hard caps.
The perf gate (60 fps p99 at DPR 1.5, doctrine §3/p99 verdicts) is a separate,
non-scored PASS/FAIL gate that must also pass — a beautiful frame at p99 12 fps does
not ship, and a critic never trades visual score against performance".

Critic count: ≥2 cold critics per scoring iteration; 3 on the ship decision (R28).

### 5.6 STOP / plateau rule (harness_plan §3.3, verbatim)
"**Plateau:** 2 consecutive iterations with no improvement in any scenario's mean
score (compare iterN vs iterN-1 vs iterN-2 from scores.jsonl) → STOP burning
iterations and escalate to the owner with: the trend table, the 3 worst tells, and
the builder's honest assessment of what the plateau is (asset ceiling? technique gap?
needs Meshy/asset spend?). Escalation goes through the session outbox (Telegram =
automations only). Never both-loop: after a plateau escalation, no further iterations
until the owner answers."

### 5.7 Deploy gate (harness_plan §2.6)
deployverify.py exit 0 = live URL 200 + current-version fingerprint chosen from the
actual diff + clean headed boot + one production bot-match (counters moved, match
ended). "Report deployed state SEPARATELY from local readiness." CDN staleness: purge,
re-check once after ~5 min; else "action taken, verification pending".

### 5.8 Ship blockers (absolute)
`__FFG_FALLBACKS__` non-empty · any contract-gate throw · probe_props failure ·
any selftest non-zero · `game_meta.json` publish flip without owner OK.

---

## PART 6 — TOP 10 RISKS (ranked, with mitigations)

1. **FP viewmodel quality misses the bar** (the whole CoD read hangs on D5; the 3P
   Meshy weapons were generated for distance). Mitigation: wave-2 spike judged at the
   S2/S4 gate EARLY (first shotbattery iteration); gated Meshy fallback pre-scoped
   (~150–250 cr, ask ready to send); dual-camera rendering + densest material
   treatment per VT §5; `__FFG_FALLBACKS__` blocks ship so it cannot slip through.
2. **Perf on Iris Xe: planar reflection + 2,800 rain instances + 8 bots + post.**
   Mitigation: every named heavy has a specced degradation path (planar auto-off at
   dynres floor → envMap; rain count scales with quality preset; dynres 1.0 floor);
   perfprobe p99/hitch gates are FAIL-class; draw budget already reserves the ~40
   planar draws.
3. **Shader-permutation hitches from pool violations** (any lane creating a light or
   a lane missing a prewarmable). Mitigation: only `lights.lease()` grants lights
   (level.js emits specs, never Lights); `fx.prewarmables()` contract; perfprobe
   programs-delta==0 FAIL gate catches the first offender with attribution.
4. **Vocabulary drift back to the source docs** (agents coding to their designer's
   doc instead of the rulings — 3 shot-battery vocabularies and 2 weapon-id sets
   existed). Mitigation: this document is the tiebreaker by declared authority order;
   the R-numbered rulings are grep-able; contract gates validate content.json
   scenario/archetype/node ids at load so a stale name throws at boot.
5. **44-spawn / nav referential integrity** (the Colosseum empty-bout class).
   Mitigation: contract gate throws on any dangling ref at makeMission; selftest
   asserts every spawn sits on walkable nav; A2 commits content.json complete in
   wave 1 so the gate runs from day one.
6. **Meshy soldier close-up quality at 2 m** (bodies built for last-circle's
   third-person camera). Mitigation: S9 supplementary shot in iteration 1; wet-spec
   + tint treatment; battery keeps hero framings ≥3 m except S9; if S9 tanks D-scores,
   plateau path escalates (possible gated Meshy regen — owner call).
7. **Determinism leaks poisoning the critic loop** (rain phase, time-of-day, seeds —
   drift's six-wasted-rounds lesson). Mitigation: `setScenario` atomically re-seeds
   every stream + freezes sky/rain; manifest records seed/endPos/untilReached;
   shotbattery refuses to overwrite iterNN (exit 3); non-comparable frames block the
   iteration.
8. **Boot payload blowing the 6 MB menu budget** (Poly Haven JPGs + Draco bodies +
   audio). Mitigation: WebP ≤2048 everywhere, manifest byte-sum gate in Part 5 table,
   soldier/weapon GLBs stream during menu behind `soldiers.ready()` (never gate boot).
9. **Audio slicing pipeline** (Sonniss 96 kHz WAVs are ~30 MB each; shipping one raw
   would nuke budgets). Mitigation: explicit never-ship-raw rule (Part 4), slices to
   short OGGs, manifest gate; last-circle's ready-sliced set is the working base so
   audio is never blocking.
10. **Integration-phase serialization** (12 lanes converge on A0; freeze amendments
    mid-build stall everyone). Mitigation: ALL known amendments are enumerated in
    Part 8 and applied to architecture.md BEFORE fan-out; bridge self-registration
    means no shared-file merges; wave-1 data-first ordering (layout/content/
    weapon_data) resolves the only true dependencies up front.

---

## PART 7 — OPEN QUESTIONS (cannot be ruled here)

1. **Meshy spend authorization is not pre-granted.** If the $0 FP-weapon/arms spike
   fails the S2/S4 close-up gate, the build PAUSES on that asset class until the
   owner answers a Telegram/outbox YES/NO for ~150–250 Meshy credits (current
   per-generation pricing unconfirmed — confirm in the Meshy dashboard before
   asking). The stand-in path keeps every other lane building.
2. **Cold-critic independence is an orchestration requirement.** The ship bar needs
   ≥2 (final: 3) critics who see ONLY PNGs + the scorecard. If the build runs
   single-session, the orchestrator must spawn fresh subagent critics with clean
   context; this plan cannot enforce that from inside the repo — flagging it so the
   fan-out script owns it.

No design doc was missing. Every located self-contradiction was ruled on above
(R1–R31); the one factual error found (harness_plan's "serve_nocache.py as-is") was
verified against the repo and corrected in R20.

---

## PART 8 — FREEZE AMENDMENTS (A0 applies to architecture.md changelog BEFORE fan-out)

Append to architecture.md's changelog as "v2 2026-08-19: BUILD_PLAN synthesis":
1. Map/fiction: Meridian Ward per level_design (R1); tagline `meridian ward`;
   `nodes` key set replaced (R24).
2. Light pool counts: 1 dir + 1 hemi + 8 spot + 4 point (R3); perf-budget lights row
   updated.
3. Weapon ids `warden/vesper/corvus/pike`; all stats from combat_spec (R4).
4. Ballistics = swept projectile w/ per-weapon speeds; penetration ships (R5).
5. Grenades ship; events `explosion`, `grenade`, `whiz`, `zone` added; bark kinds
   updated (R6, R13).
6. Slide + mantle ship (R7); player.js comment updated.
7. Viewmodel = dual-camera same-scene, clearDepth, vFOV 60 (R8).
8. FOV values are VERTICAL degrees; settings 60–90 (R9).
9. Scenario names S1–S9/C1/menu/bench (R10); `?bench` fixture = S1.
10. `__test` additions: freeze/hud/give/setAmmo + aliases; `perfStats` member (R11).
11. Dev port 8841; bootcheck URL updated (R12).
12. Harness file set per harness_plan + shotserver.py (R19, R20).
13. mission.js checkpoint restore (R22); phases↔beats mapping (R25); pickups (R26).
14. sky.js: storm sky, no stars, 3-ring parallax silhouettes (LD §5.1).
15. capture battery at 1920×1080 (R21).

---
*Build director sign-off: every ruling above traces to a doc section or an on-disk
observation made this session. Fix the generator, verify at the player's layer,
report with total fidelity.*
