# BLACKRIDGE — Asset Inventory & Sourcing Plan

Designer pass, 2026-08-19. Every path below was listed/read this session (dir listings,
index reads, thumbnail views). License classes come from on-disk license files and
SOURCES/CREDITS records, quoted where they exist. Doctrine constraints applied
throughout: §7 no primitive hero assets; Draco+WebP characters; strip GLB lights;
per-asset provenance; §3 UVs in metres/tile for procedural geometry.

**Bottom line up front:** Audio is essentially SOLVED on disk (pro recorded firearms,
50 GB Sonniss GDC 2024 bundle with license text captured verbatim). AI-soldier
characters and their full rifle/pistol/death animation sets are SOLVED (Mixamo packs +
last-circle Meshy bodies + a usable low-poly SWAT GLB). Third-person weapon GLBs are
SOLVED (6 Meshy weapons in last-circle). Urban environment is COVERED at a stylized
low-poly bar (Kenney city kits) with real PBR ground/wall textures + industrial HDRIs
to push realism. The two genuine gaps are (1) **first-person arms + FP weapon models**
— the signature CoD asset — and (2) **realistic-grade building facades**. Ranked
options for both below; the only spend-gated option is Meshy generation.

---

## 1. What we already have, by asset class

### 1.1 AI soldier characters (bots)

| Asset | Path | Size | Provenance / license | Verdict |
|---|---|---|---|---|
| SWAT operator GLB (helmet, vest, knee pads; animated) | `pipeline/assets/_downloaded/cc0-units2/swat.glb` | 1.5 MB | CC0 (cc0-units2 set; Quaternius `CharacterArmature` rig per comment in `pipeline/engine/runtime/3d/ffg_tactics3d.js:1200`) | **Reuse.** Already wired in void-skirmish with clips `Idle_Gun / Walk / Death / Gun_Shoot / HitRecieve` (ffg_tactics3d.js:1206). Low-poly flat-shaded but reads as a modern operator (thumbnail verified). Best immediate bot body. |
| Meshy "soldier" body + 31 clip GLBs (incl. `rifle_idle/walk/run/crouch/reload`, `pistol_*`, 3 deaths, hit, jump, fall) | `games/last-circle/assets/chars/meshy/soldier*.glb` | ~2 MB body | Meshy on owner's account — **original IP** (per `games/last-circle/CREDITS.md`) | **Reuse.** Purpose-built armed humanoid with the exact armed locomotion set an FPS bot needs. 4 more bodies (athlete, juggernaut, viper, wraith) with identical 32-clip sets = enemy variety. Apply doctrine §1 material repair at load. |
| Mixamo `Swat.fbx` (classified "modern-military soldier — SWAT officer in tactical gear") | `pipeline/assets/_downloaded/mixamo/characters/Swat.fbx` | — | Mixamo character (Adobe's Mixamo terms: free for use in projects; NOT redistributable as raw asset — ship converted/baked GLB only) | Backup body / arms donor (see §2.1). Also `Exo Gray.fbx` / `exo_red.fbx` (sci-fi exosuit soldiers) if we want a heavy archetype. |
| `character_soldier.glb` (chibi minigun soldier) | `pipeline/assets/_downloaded/cc0-units2/character_soldier.glb` | 1.3 MB | CC0 | **Reject for BLACKRIDGE** — cartoony/chibi (thumbnail verified), clashes with the CoD-bar art direction. |

### 1.2 Soldier animations — COMPLETE on disk

`pipeline/assets/_downloaded/mixamo/animations/` (FBX, 60 FPS, X-Bot skeleton;
retarget or bake onto our body via the existing `scripts/mixamo_integration.py` flow):

- **`Rifle_8-Way_Locomotion_Pack/`** — 49 files: full 8-way walk/run/sprint, crouch
  walk 8-way, `idle aiming`, `idle crouching aiming`, turns, jumps, and **6 deaths**
  including `death from front headshot.fbx` / `death crouching headshot front.fbx`.
- **`Basic_Shooter_Pack/`** — `firing rifle.fbx`, `reloading.fbx`, `hit reaction.fbx`,
  `toss grenade.fbx`, strafes.
- **`Shooter_Pack/`** — rifle aiming idle, walking-to-dying, start/stop walk transitions.
- **`Pistol_Handgun_Locomotion_Pack/`** — 21 files incl. kneel transitions.

This is the entire AI-bot animation budget for v1. Nothing to source.
Last-circle's per-body baked GLB approach (`athlete_rifle_run.glb` etc.) is the
proven FFG integration pattern for these.

### 1.3 Weapon models — third person / world drops

`games/last-circle/assets/props/meshy_wpn/` — Meshy-generated, original IP
(CREDITS.md), loaded by `runtime/3d/royale/weapons.js:111`:

- `wpn_ar.glb` (289 KB), `wpn_smg.glb` (260 KB), `wpn_pistol.glb` (284 KB),
  `wpn_shotgun.glb` (263 KB), `wpn_sniper.glb` (249 KB), `wpn_glauncher.glb` (243 KB)

**Reuse directly** for bot-carried weapons, wall racks, and pickups. Note: these were
generated for third-person distance; §2.1 covers whether they survive first-person
close-up.

### 1.4 First-person arms + FP weapon models — **THE GAP**

Searched: nothing under `pipeline/assets/` or any game ships first-person arms or
close-up-grade weapon models. `games/ironwake/` (the existing FPS, added 2026-08-17)
ships a single 680 KB minified bundle with **procedural Box/Cylinder weapons and no
GLB assets at all** (`games/ironwake/assets/` contains only css/js + 2 AI menu JPGs)
— that is exactly the "box gun" §7 forbids for our bar. Sourcing options in §2.1.

### 1.5 Urban / industrial environment kit

`pipeline/assets/_downloaded/cc0-city/` — all CC0, provenance captured in
`cc0-city/SOURCES.json` (Kenney kit URLs + poly.pizza pages, license_proof lines):

- **buildings/** — 56 GLBs: 14 commercial `building-a..n`, 5 skyscrapers, 21 suburban
  `building-type-a..u`, 16 low-detail skyline fillers.
- **vehicles/** — 16 Kenney Car Kit GLBs: `police.glb`, `van.glb`, `truck.glb`,
  `truck-flat.glb`, `ambulance.glb`, `firetruck.glb`, `garbage-truck.glb`, sedans/SUVs/taxi.
- **props/** — 39 GLBs incl. `dumpster-quaternius.glb`, `ac-unit-quaternius.glb`,
  `shipping-container-quaternius.glb`, `barrier-large-quaternius.glb` (concrete barrier),
  `barrier-traffic-quaternius.glb`, `construction-barrier/cone/light.glb`, `crate-quaternius.glb`,
  `box-crate.glb`, street lights ×4, `sign-highway(-detailed).glb`, `hydrant-quaternius.glb`,
  fences, `bridge-pillar.glb`.
- **walls/** — 16 modular interior pieces (wall, wallCorner, doorway ×3, floor pieces)
  from Kenney Furniture Kit — building-interior blockout.
- **furniture/** — 40 GLBs (desks, cabinets, crates) for interior set dressing.
- ⚠ `SOURCES.json` `scale_warning`: Kenney kits share a ~1-unit grid; the Quaternius
  poly.pizza props are NOT on it (dumpster 2.44 wide, container 4.36 long) — per-model
  rescale required.

Also: `games/last-circle/assets/props/container.glb`, `car.glb`, `barrel.glb`
(CREDITS.md: Quaternius/Kenney CC0, car CC-BY 3.0 iloem — attribution already shipped).

**Honest verdict:** this kit is Kenney-stylized low-poly, not MW2019 photoreal. It is
the right *blockout and mid-distance* kit. The realism gap is closed with materials +
lighting (§1.6/§1.7), not more low-poly models: gritty PBR ground/walls, decals, HDRI
ambient, fog, and post — the Claude-of-Duty forensics (adoption_plan.json) confirm a
100%-procedural-asset FPS reads "modern" through lighting and post, not mesh detail.

### 1.6 PBR texture sets

- `pipeline/assets/_downloaded/polyhaven-textures/` — **40 photoscanned sets** (CC0),
  each `ao.jpg / diffuse.jpg / displacement.jpg / rough.jpg`. Urban-relevant: **7
  asphalt sets** (`asphalt_01..07` + `asphalt_floor`, `asphalt_pit_lane`, `asphalt_track`,
  `asphalt_snow`), `anti_slip_concrete`, `asbestos_sheet(_02)`, `beam_wall_01`,
  `beige_wall_001/002`, `bitumen`, gravel/mud/sand aerials.
  ⚠ Coverage stops alphabetically in the b's — this is a **partial mirror** of Poly
  Haven (download evidently stopped early). ⚠ **No normal maps** — generate normals
  from `displacement.jpg` at build time (Sobel pass; trivial with Pillow/numpy).
  Doctrine §3 reminder: these sets sat unused for a month once before because the
  geometry emitted all-zero UVs — emit metres/tile charts by construction.
- `pipeline/assets/generated-materials/` — 19 procedural PBR sets (albedo/ao/normal/
  rough webp): `iron_plate_*`, `dirt_packed_*`, `stone_cobble_*`, `wood_planks_*`
  usable; the rest are Colosseum-era (marble, travertine, sand_arena) — wrong biome.
- `pipeline/assets/_downloaded/retro-textures-fantasy/` — wrong genre, skip.

### 1.7 HDRIs / lighting

`pipeline/assets/_downloaded/polyhaven-hdris/` — **40 HDRIs, 2k + 4k .hdr each**
(CC0), listing dominated by exactly our palette: `abandoned_parking`,
`abandoned_factory_canteen_01/02`, `abandoned_garage`, `abandoned_construction`,
`abandoned_tank_farm_01..03`, `abandoned_hopper_terminal_01..04`, `abandoned_slipway`.
**Reuse for IBL + skybox.** A night/overcast industrial HDRI + fixed light pool
(doctrine §3) is the single cheapest step toward the MW look.

### 1.8 Audio — SOLVED

- **`pipeline/assets/sonniss-gdc2024/`** — 50 GB. 605 extracted WAVs across ~190 packs
  PLUS **all nine original zips** in `_zips/` (`Sonniss.com-GDC2024-GameAudioBundle1of9.zip`
  … `9of9.zip`) — the FULL bundle is locally extractable at zero cost.
  License: `LICENSE.txt` captured verbatim 2026-08-04 — "Worldwide, non-exclusive,
  ROYALTY-FREE licence … UNLIMITED projects … Commercial use allowed."
  Weapon-relevant packs verified on disk:
  - `Pole Position - The Indoor Gun Acoustics 2 Library/` — **AK5 7.62 long bursts
    (large hall), Glock 17 single shots, MP5 9mm bursts, Mossberg 12-gauge** — CQB-
    perspective recordings, exactly the MW "indoor gunfight" sound.
  - `Pole Position - The Warfare 2 Library/` (122 MB) — AK5 hits on metal armor plate,
    **RPG firing+impact through car roof**, howitzer, tank-mine explosion.
  - `Pole Position - Lynx 50 Cal Sniper Rifle/`, `Dramatic Cat - SVD Dragunov/` (30 MB),
    `Dramatic Cat - Saiga-12/`, `Pole Position - Beretta 1201 F`, `Colt Python`,
    `Desert Eagle .44`, `Franchi SPAS-12`, `S&W .38` — per-weapon shots, shell
    ejections, mag inserts, mech foley.
  - `DavidDumais - Explosion SFX Pack/` — designed car explosion, realistic explosions.
  - Ambience beds: `InMotionAudio - UK Construction Ambience`, `Jake Fielding -
    Industrial Harbor`, `Pole Position - Subway Station`, `Sculptunes - Rome - Urban
    City Surround`, `Justsoundeffects - Gore Mini Pack` (hit feedback).
- **`games/last-circle/assets/audio/sfx/`** — ready-sliced game-ready OGGs, licenses
  documented in-dir (`FFSL-LICENSE.txt`, `KENNEY-LICENSE.txt`): `shot_ar_0..2`,
  `shot_pistol_0..1`, `shot_shotgun_0..1`, `shot_smg_0..2`, `shot_sniper_0..2` (CC0,
  Free Firearm Sound Library), `step_concrete_000..003`, impact glass/metal/plank/
  plate, reload foley (`beltHandle`, `metalClick`, `metalLatch`, `drawKnife`), UI set.
  **Fastest path: copy this dir wholesale, then upgrade per-weapon from Sonniss.**
- **Footsteps:** `pipeline/assets/impact-sounds/Audio/` (Kenney CC0,
  `footstep_concrete_000..004` + carpet/grass/snow/wood, bell/metal impacts);
  `pipeline/assets/_downloaded/Antifon__Footsteps Pack/Audio/` (surface-coded mp3s:
  cbl/drt/gra/snw × 3 shoe types × 6 takes).
- **UI:** `pipeline/assets/interface-sounds/Audio/` (Kenney CC0 clicks/confirms).
- **Music:** `pipeline/assets/music/` (8 CC0 OGA loops — serviceable menu bed but
  generic-fantasy flavored; see gap §2.4). `manifest.json` documents CC0 status.
- **Research doc:** `games/last-circle/AUDIO_SOURCES.md` — a fully license-verified
  CC0 firearm-audio sourcing plan (Free Firearm Sound Library folder map per weapon
  class, grenade-launcher singles, Kenney sci-fi explosions) if more variety is needed.

### 1.9 UI / HUD bits

- Crosshairs: `pipeline/assets/_downloaded/game-icons/icons/.../delapouite/crosshair.svg`,
  `lorc/crosshair-arrow.svg` — ⚠ game-icons.net is **CC-BY 3.0** (attribution required
  in CREDITS.md) — or draw crosshairs procedurally on canvas (zero-license, preferred).
- Key-prompt glyphs: `pipeline/assets/_downloaded/input-prompts/` (Kenney CC0) — for
  the controls/settings screens.
- `pipeline/assets/_downloaded/fonts/` — check for a suitable condensed military face
  before adding any webfont.
- Menu key-art: ironwake's AI-generated `menu_compound.jpg` / `menu_weapon.jpg`
  (games/ironwake/assets/) set the visual precedent — generate BLACKRIDGE's own via
  the existing xAI image pipeline (already-budgeted route, auto-topoff $1 — see
  memory `reference_xai_image_gen`; near-zero cost but nonzero: flag to owner in the
  build plan, not a blocker).

### 1.10 What the rest of the pipeline holds (checked, NOT useful here)

- `pipeline/assets/3d-models/` (manifest.json: 135 models; UNITY_MODELS_INDEX.json:
  1409 models across 10 packs) — keyword sweep for soldier/military/rifle/urban
  returned **zero modern-military content**: it is fantasy/farm/dungeon (KUBIKOS farm,
  BitGem dungeon, medieval weapons, Quaternius monsters). The only "gun" hits are
  BitGem cartoon turret heads (`gun_head_lvl1..4.glb`) — wrong style.
- `CREATURES_INDEX.json` (470 KB), `polypizza/` (aliens/animals/dinos/monsters),
  `quaternius/` (animated monsters/robots/mechs), `kenney-creatures/` — creature
  library; MANIFEST keyword scans: no soldier/military. `polypizza/_misc/` has a
  `Butterfly Knife.glb`, `Buggy.glb`, `Retro car.glb` — marginal.
  (Quaternius robots/mechs COULD serve a future sci-fi shooter, not this one.)
- `pipeline/assets/_downloaded/polyhaven-models/` — 40 photoscanned CC0 props
  (gltf + textures): `Barrel_01/02`, `Drill_01`, `Television_01`, `CashRegister_01`,
  `WetFloorSign_01`, `Megaphone_01`, office/furniture pieces — good **interior
  set-dressing** at photoreal quality; use sparingly (poly/texture weight).
- 2D packs (`rpg-urban-pack`, `1-bit-pack`, pixel packs…) — wrong dimension.
- `games/driftwake/` — fantasy creatures; its value to BLACKRIDGE is the
  **`_harness/` Playwright rig** (abprobe.py, bootcheck pattern) and the visual-bar
  pipeline, not assets. `games/sanctum-assault/` — no assets dir at all (runtime-only
  fantasy arena). `games/colosseum/` — Meshy character pipeline reference.

---

## 2. Sourcing plan per asset class

Legend: **REUSE** = on disk, wire it in · **PROC** = procedural build per doctrine
(winding by construction, metres/tile UVs, quality gate) · **DL** = free download
needed (network, license check, $0) · **GATED** = costs credits/money — owner
approval required before generating.

### 2.1 First-person arms + FP weapon models — the hero assets (GAP)

This is the asset class the whole CoD bar hangs on. Ranked options, honest:

**(a) Best on-disk stand-in — REUSE, $0, days-fast**
Upscale `games/last-circle/assets/props/meshy_wpn/wpn_ar.glb` (+smg/pistol/shotgun)
as FP view models: re-repair materials (§1 doctrine), add procedural attachments
(rail/optic/suppressor as beveled extrusions), position at FP camera with procedural
sway/recoil/ADS. For arms: cut forearms+hands from the Mixamo `Swat.fbx` or a
last-circle Meshy body (both rigged; pose via the Actor snapshot, never bind pose),
re-material with a sleeve+glove texture.
*Honest risk:* Meshy third-person weapons at 250 KB were generated for distance —
close-up they may show soft silhouettes and mushy albedo detail. Must be judged
against a rendered FP screenshot (harness `/__shot/` capture), not hope. If they fail
the close-up gate, fall to (b) or (c).

**(b) Procedural high-effort hard-surface build — PROC, $0, the craft path**
Guns are hard-surface: extrusions, bevels, cylinders, greebles — the one hero-asset
category where procedural genuinely CAN hit the bar if built with discipline:
LatheGeometry barrels + flash hiders, ExtrudeGeometry receivers with beveled profiles,
picatinny rails as instanced greeble strips, normal-mapped metal (`polyhaven` +
`generated-materials/iron_plate_*`), decals for stamped text. Ironwake's box guns fail
§7 not because procedural is banned but because they are *primitive* — no bevels, no
greebles, flat materials. Budget: this is a multi-session build with a screenshot
quality gate per weapon (compare side-by-side against the ironwake menu_weapon.jpg
key art as the target read). Arms still come from (a)'s rig-cut approach.
*Honest assessment:* achievable for 3–4 weapons at "recent-CoD-adjacent"; the arms
(organic, skinned, animated) are the harder half — procedural arms are NOT viable;
rig-cut from an existing body is mandatory in this option too.

**(c) Meshy generation — GATED (credits = money, owner approval required)**
Generate: 1 pair of tactical FP arms (sleeves+gloves), 3–4 weapons modeled *for
close-up* ("first person view model, high detail receiver…"). Only measured cost
figure on file: the chess-piece run generated 6 textured models for **180 credits
(≈30 cr/model, 2026-07-13, memory `project_chess_meshy_pieces`)**; meshy-t2 textured
route is roughly half the old pipeline's price (memory `reference_meshy_smart_topology`).
Estimate ~5–7 generations incl. rerolls ≈ **150–250 credits**. Confirm current
per-generation pricing in the Meshy dashboard before asking. **Do not generate
without a Telegram YES** (spend gate, CLAUDE.md). Also binds: no re-rolls without
asking (memory `feedback_no_rerender_3d_without_asking`).

**Recommendation:** run (a) as the v1 spike behind a screenshot gate; commit to (b)
for the 3–4 shipped weapons (it also gives us attachment variants for free); hold (c)
in reserve for the arms/weapons that fail the gate — it is the only money on the
whole asset sheet.

### 2.2 AI soldier bots — REUSE
Body: `swat.glb` (primary) + last-circle `soldier` Meshy body (variety) — restyle via
material tint per faction. Clips: bake Mixamo Rifle-8-Way + Basic Shooter onto the
chosen body (existing `scripts/mixamo_integration.py` + last-circle `rig_pipeline.js`
patterns). Doctrine §1 material repair + §2 bot fairness constants (300–800 ms
reaction, aim jitter) already adopted. Draco+WebP-compress every body.

### 2.3 Map / environment — REUSE + PROC
- Blockout & mid-distance: cc0-city buildings/walls/props/vehicles (mind the
  `scale_warning` rescales).
- Hero surfaces: PROC geometry (metres/tile UVs) textured with polyhaven asphalt/
  concrete/wall sets (+ runtime-generated normal maps from displacement).
- Skyline: `low-detail-building-*.glb` + fog.
- Lighting: one abandoned-industrial HDRI (2k for IBL) + fixed light pool + DPR 1.5.
- Set dressing: shipping container, dumpster, AC units, barriers, crates (all on disk);
  interiors from walls/ + furniture/ + select polyhaven-models.
- Decals/grime/muzzle flash/impact sparks: PROC canvas textures (standard FFG pattern).
- If more Kenney road tiles wanted: the full Roads kit zip URL is recorded in
  `cc0-city/SOURCES.json` — DL, CC0, $0.

### 2.4 Audio — REUSE (then curate)
1. Copy `games/last-circle/assets/audio/sfx/` shot/step/impact/UI set as the working base.
2. Upgrade per-weapon from Sonniss (Indoor Gun Acoustics for CQB tail, per-weapon
   mech foley for reloads, DavidDumais explosions for frags); slice to short OGGs —
   the 96 kHz source WAVs are 30 MB each, never ship raw.
3. Ambience: UK Construction / Industrial Harbor beds, low loop volume.
4. Music: nothing on disk fits a modern-military menu (current `music/` is
   fantasy-flavored OGA). Options: Sonniss cinematic packs (`Mechanical Wave -
   Cinematic Feel`, `Orbital Emitter - Cinematic Transitions`) — REUSE; or Suno
   generation — **GATED** (credits; owner approval; see memory
   `reference_suno_credit_tracker`). Recommend trying Sonniss first: $0.
5. All nine GDC zips are in `sonniss-gdc2024/_zips/` — if a needed pack isn't among
   the 605 extracted files, extract locally; no download, no cost.

### 2.5 Shell / UI — REUSE + PROC
FFG shell contract (§6) from any recent game; procedural canvas crosshair (skip the
CC-BY icon attribution); Kenney input-prompts for the controls screen; xAI-generated
menu key-art following the ironwake precedent (pennies; flag in build plan).

---

## 3. License / provenance ledger (doctrine §7: keep per-asset provenance)

| Source | License | Proof on disk |
|---|---|---|
| cc0-city (5 Kenney kits + 8 Quaternius poly.pizza props) | CC0 | `_downloaded/cc0-city/SOURCES.json` + LICENSE-*.txt |
| cc0-units2 (swat.glb) | CC0 | set-level; rig identified as Quaternius CharacterArmature (ffg_tactics3d.js comment) |
| last-circle Meshy bodies + weapons | Original (Meshy, owner account) | `games/last-circle/CREDITS.md` |
| Mixamo animations + characters | Mixamo/Adobe terms — free in projects, no raw redistribution; ship baked GLBs only | `_downloaded/mixamo/README.md` |
| Sonniss GDC 2024 | Royalty-free, unlimited commercial | `sonniss-gdc2024/LICENSE.txt` (verbatim capture 2026-08-04) |
| Free Firearm Sound Library slices | CC0 | `games/last-circle/assets/audio/sfx/FFSL-LICENSE.txt` |
| Kenney audio/UI packs | CC0 | `License.txt` in each pack dir |
| Poly Haven textures/models/HDRIs | CC0 | polyhaven.com standard (record page URLs in BLACKRIDGE CREDITS.md at import time) |
| game-icons.net SVGs | **CC-BY 3.0** — attribution required if used | icon path structure; prefer procedural crosshair instead |
| Meshy new generations (if approved) | Original to owner account | n/a — GATED |

BLACKRIDGE must ship its own `CREDITS.md` on day one (last-circle format).

---

## 4. Gap summary

| Class | Status | Path |
|---|---|---|
| FP arms + FP weapons | **GAP — hero asset** | §2.1 ranked (a)/(b)/(c); only (c) costs money |
| AI soldier bodies | Covered | swat.glb + last-circle soldier |
| Soldier animations | Covered, complete | Mixamo rifle/pistol/shooter packs |
| 3P weapons / pickups | Covered | last-circle meshy_wpn ×6 |
| Urban buildings/props/vehicles | Covered (stylized) | cc0-city; realism via materials+lighting |
| PBR textures | Covered (partial lib) | 7 asphalt + concrete/walls; gen normals from height; more Poly Haven = free DL if needed |
| HDRI lighting | Covered | 40 industrial HDRIs 2k/4k |
| Gun/explosion/footstep SFX | Covered, pro-grade | Sonniss + last-circle slices |
| Ambience | Covered | Sonniss beds |
| Music | Thin | Sonniss cinematic first ($0); Suno = gated |
| Menu key-art | Standard pipeline | xAI images (pennies, flag it) |
| Crosshair/HUD/prompts | Covered | procedural + Kenney CC0 |

**Total unavoidable spend for v1: $0.** The only proposed spend is the *optional*
Meshy FP-asset route (§2.1c, ~150–250 credits, unconfirmed pricing) and *optional*
Suno music — both explicitly gated on owner approval.
