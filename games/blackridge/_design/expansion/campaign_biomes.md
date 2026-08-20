# BLACKRIDGE — EXPANSION: MULTI-ENVIRONMENT CAMPAIGN & BIOME BIBLE

Status: **DESIGN PROPOSAL v1** (2026-08-19). Not binding until an owner ruling +
a BUILD_PLAN amendment. Authority order unchanged:
`pipeline/knowledge/GAME_DOCTRINE.md` > `_design/BUILD_PLAN.md` > the six v1 design
docs > this document.

Scope of this deliverable: the **campaign locale set** — 8 missions across 7 distinct
environments plus one transformed reprise, each authored so the locale is fought in
twice (once as a scripted mission, once as a PVP arena carved from it). PVP rules,
netcode, modes, and matchmaking are NOT in scope here; this document only guarantees
that every locale *contains* an arena-shaped space and states its carve.

Owner directive (verbatim): *"I want a pvp mode ultimately, where we have MULTIPLE maps
from different areas of the campaign, which im assuming has things like outdoor, or
forest, or office, or various areas to fight/explore."*
The three named biomes are honoured explicitly: **outdoor → M5 Sable Run**,
**forest → M3 Hollowmere**, **office → M4 The Glass Floor**.

---

## PART 0 — WHAT EXISTS TODAY (verified on disk this session)

Every claim below came from reading the file named, this session.

| Fact | Evidence |
|---|---|
| One map, hard-coded. `buildLayout(seed)` returns a single Meridian Ward object; `NODES`, `WALK_RECTS`, `ZONES`, `LIGHT_POLES`, `ROADS`, `TERRAIN` are module-level consts | `core/level/layout.js:544–680, 758` |
| Colliders take no map id — `buildColliders(seed = 1)` imports `buildLayout` directly | `core/level/colliders.js:26–28` |
| Ground is **flat**: `groundY = (x,z) => (z >= canal.zMin ? canal.y : terrain.base)` | `core/level/colliders.js:63` |
| Materials are a single module-level cache: `makeMaterials(ctx)` opens `if (CACHE) return CACHE;` and hard-codes 6 file texture sets (`asphalt_worn`, `concrete_yard`, `wall_plaster`, `cobble`, `wood`, `iron_plate`) | `core/level/materials.js:520–566` |
| Materials already carry a per-material shader-injection hook with a program cache key: `mat.customProgramCacheKey = () => \`a3w${aowet}p${puddle}\`` | `core/level/materials.js` (`augment()`) |
| Props: 7 cc0-city GLB kinds (`GLB_KINDS`) + ~30 procedural builders in one switch | `core/level/props.js:127–129, 241–510` |
| Sky is night-storm-only; `DOME_R = 520`, `RINGS = [[280,28,.32],[400,40,.20],[500,50,.11]]` are module consts | `core/render/sky.js:26–34` |
| Fog is a module const: `FOG = {density:0.010, falloff:0.06, start:18, refY:1.5, color:0x232a3a}` | `core/render/weather.js:45–51` |
| Light pool is **frozen at 14**: 1 dir + 1 hemi + 8 spot + 4 point | BUILD_PLAN R3 |
| Collider `nodes` key set frozen to Meridian Ward's 15 keys | BUILD_PLAN R24 |
| Assets on disk that this plan leans on: Kenney furniture kit (`desk`, `chairDesk`, `computerScreen`, `computerKeyboard`, `laptop`, `bookcase*`, `kitchen*`, `trashcan`, `pottedPlant`, `loungeSofa`), cc0-city buildings/vehicles/props/walls, Poly Haven texture library incl. `bark_*`, `aerial_grass_rock`, `aerial_mud_1`, `asphalt_01..07` | `pipeline/assets/_downloaded/cc0-city/{furniture,buildings,props,vehicles}`, `pipeline/assets/_downloaded/polyhaven-textures/` |
| **No vegetation asset pack exists on disk** — no Quaternius/KayKit nature set; only Kenney `tree-large.glb` / `tree-small.glb` (low-poly, below bar for a hero forest) | `ls pipeline/assets/_downloaded/` — no nature/tree/foliage match |

That last row is the single most important cost fact in this document: **the forest is
the only biome whose hero asset class does not exist yet.**

---

## PART 1 — THE ARC

A campaign is a shape, not a playlist. The shape here is **tight/dark → wide/bright →
tight/dark → wide/white → home, transformed**, and the player's *question* escalates
across three acts: you are chasing a package, then a company, then a weapon.

| # | Mission | Locale | Time / weather | Act | Beat function |
|---|---|---|---|---|---|
| 1 | **MERIDIAN WARD** *(SHIPPED)* | night urban district, Zarov | 23:40, storm blackout, rain | I | Infiltration. Seize CINDERLOCK. It is a decoy shell. |
| 2 | **DRYDOCK SEVEN** | dewatered graving dock + bulk carrier, Zarov outer harbour | 04:40, blue hour, sea fog | I | Board the ship before it sails. The hold carries the *airframe*, not the guidance module. Scale reveal. |
| 3 | **HOLLOWMERE** | coastal conifer belt + Soviet relay compound, 40 km inland | 06:20, first light, ground fog | II | The courier aircraft went down. Recover the recorder. First dispersed-patrol combat, first open sightlines. |
| 4 | **THE GLASS FLOOR** | corporate HQ, floors 21–26, Astral Meridian tower | 19:50, storm outside | II | Pull the ledger from Vektor Ancile's registered head office. The reveal — and the building goes loud. |
| 5 | **SABLE RUN** | chalk quarry + mountain border crossing | 12:30, broken overcast, wind | II | Interdict the convoy. **You lose.** The convoy is bait; RAVEN takes its casualties here. |
| 6 | **THE UNDERCROFT** | 19th-c. brick cistern + Soviet service tunnels under the old town | no daylight | III | Hunted. The low point: least ammo, closest quarters, emergency lighting only. |
| 7 | **PALE HARVEST** | over-the-horizon radar + missile relay, 1,900 m ridge | whiteout blizzard | III | The assault on the actual **Blackridge**. Largest bot counts, most set-pieces. The title pays off. |
| 8 | **MERIDIAN ASH** | Meridian Ward, burning | 05:10, dawn through smoke | III | CINDERLOCK was never leaving Zarov — it was *aimed* at it. Fighting retreat through mission 1's streets. |

Escalation is legible on four independent axes, which is what makes it feel like a
campaign rather than a level select:

- **Space**: 120×120 enclosed → 90 m dock canyon → dispersed forest → 3-floor interior
  → 140 m open quarry → 55 m tunnels → 70 m ridge in 60 m visibility → back to M1's
  streets with new blocking.
- **Light**: authored practicals → blue hour → first sun → fluorescent + slats →
  full daylight → total darkness → whiteout → firelight.
- **Enemy posture**: static cordon → shipboard watch → dispersed patrol → corporate
  security then a QRF → a convoy escort with armour → hunters → a garrison → an assault
  wave.
- **Player posture**: infiltrator → boarder → tracker → thief → attacker → prey →
  attacker → defender.

**Fiction hygiene** (level_design §7 extended): Zarov, Meridian Ward, Vektor Ancile,
CINDERLOCK, RAVEN 2-1 are canon. New invented names introduced here: Drydock Seven,
the *Anixa Meridian*, Hollowmere, the Astral Meridian tower, Sable Run, the Undercroft,
Pale Harvest, the Blackridge relay. No real place names, no real manufacturers, no
real unit insignia.

---

## PART 2 — THE AUTHORING RULE THAT MAKES EACH LOCALE PAY TWICE

This is the structural commitment the owner's directive actually requires. It is a
process rule, not a wish.

1. **The arena carve is chosen BEFORE the mission is laid out.** Every locale is
   authored as a ~120×120 m *mission volume* containing a designated 55–80 m
   *arena carve*. The carve rectangle and its three lanes are drawn first; the
   mission's beats are then routed to pass through it.
2. **The mission's climax happens inside the carve.** The space the player fights
   hardest in as a soloist is the space that becomes the arena — that is why CoD
   arenas feel authored rather than harvested.
3. **The carve gets a LOOP PATCH.** Campaign spaces are directional (every beat's exit
   faces the next beat's entrance — level_design §2.7). Arenas must loop. Each carve
   therefore authors ONE extra connector that closes the circuit; in campaign it is
   simply an unused alternate route, in PVP it is the flank that makes the map work.
   The loop patch is authored at the same time as the map, never retrofitted.
4. **Two spawn zones minimum, on opposite short edges of the carve, each with three
   exits** into different lanes. No spawn exit may see another spawn exit.
5. **Lane discipline inside the carve** (inherited from level_design §2.3): three
   lanes with distinct sightline bands + one flank, cross-cuts every 25–35 m.
6. **The carve is a data flag, not a copy.** `arena: {min, max, spawns[], loopPatch}`
   in the map's layout export. One geometry source, two consumers — the same rule that
   keeps `layout.js` the single source for visuals and collision today.

Arena roster produced by the campaign:

| Arena | From | Size | Team size | Character |
|---|---|---|---|---|
| **MERIDIAN** | M1 plaza + arcade + gallery door | 70×70 | 6v6 | neon CQB/mid, the flagship |
| **DRYDOCK** | M2 aft ship + dock floor | 60×80, 3 decks | 6v6 | vertical, drop-heavy |
| **HOLLOWMERE COMPOUND** | M3 relay compound + treeline | 70×70 | 6v6 | buildings anchor, forest flanks |
| **DEADFALL** *(2nd carve)* | M3 pure forest | 60×60 | 4v4 | concealment duel, near-free (same instances rescattered) |
| **GLASS FLOOR** | M4 one floor plate + cores | 65×65 | 6v6 / 3v3 | the best Breach map in the set |
| **THE ATRIUM** *(2nd carve)* | M4 lobby + mezzanine | 45×45 | 4v4 | vertical CQB |
| **SABLE PIT** | M5 lower benches + crusher | 80×80 | 8v8 | the one LARGE arena |
| **THE CROSSING** *(2nd carve)* | M5 border post | 55×55 | 4v4 | tight, from the same locale |
| **THE CISTERN** | M6 flooded reservoir + 2 tunnels | 55×55 | 4v4 | the fast brutal small map the roster needs |
| **PALE HARVEST** | M7 dish platform + bunker apron | 70×70 | 6v6 | whiteout makes a big map play small |
| **ASHFALL** | M8 plaza + market street | 65×65 | 6v6 | M1 geometry, fire-lit — a free extra map |

**11 arenas from 8 missions.** Note the shape of that: the second carves (Deadfall,
The Atrium, The Crossing) and Ashfall together are four arenas for roughly one arena's
worth of new work.

---

## PART 3 — THE SHARED KIT (the reuse architecture)

The catalogue cannot afford eight disjoint art sets. It does not need to. Four tiers:

### TIER 0 — ENGINE (100% shared, never re-authored per biome)
Light pool (14, frozen), fog uber-shader + aerial perspective, post composite
(AgX + half-res bloom + one composite pass), sky dome/cloud/ring machinery, the
weather instancer, planar reflection, prewarm, all seven fx modules, HUD, audio buses
+ reverb zones, sim, ballistics, AI, nav, weapons. **A new biome must not add a render
pass, a light, or an fx pool.** If it needs one, it is a design error — find the cheat.

### TIER 1 — CORE ART KIT (shared across all biomes; the thing that must not multiply)
- **6 file texture sets** already shipping: `asphalt_worn`, `concrete_yard`,
  `wall_plaster`, `cobble`, `wood`, `iron_plate`.
- **12 canvas-procedural textures**: grunge, ripple, decal atlas, glow, pool, tile,
  corrugated, burlap, awning ×2, window, black.
- **~30 procedural prop builders** — of which these are biome-agnostic and get reused
  everywhere: `crate, pallet, barrier, sandbags, dumpster, bin, bench, shelving, fence,
  fuel_drums, breaker_box, ac_unit, steam_vent, flood_tower, table, chairs, guard_hut,
  bollard, newsbox, mop_bucket`.
- **7 cc0-city GLB kinds**: car, van, truck, dumpster, crate, planter, ac_unit.
- **Characters**: `soldier.glb` + `juggernaut.glb` + material tint variants.
- **Weapons**: 4 FP viewmodels + 6 3P Meshy weapons.
- **The catenary/cable-span system**, the decal atlas + placement rules, the
  ground-contact gate (`computePlacements`, `probe_props.mjs`).

### TIER 2 — BIOME DRESSING (per-biome, hard budget)
Per biome, at most: **6 new file texture sets · 8 new procedural prop builders ·
1 sky preset · 1 weather preset · 1 grade preset · 1 ambient audio bed · 1 reverb set.**
New *GLB kinds* are exempt from the count (a GLB kind is a loader entry plus a material
classifier — cheap; a procedural builder is code — expensive).

### TIER 3 — HERO SET-PIECE (exactly one per biome)
The single unique mass that gives the locale its identity and eats most of its
geometry budget: the freighter hull (M2), the canopy system (M3), the curtain wall +
ceiling grid (M4), the crusher plant (M5), the brick vault (M6), the radar dish (M7),
the collapsed facade (M8). One per biome. Not two.

### The one new shared FEATURE: LIGHTCOOKIE
A single world-space multiply channel injected into `materials.augment()` — a greyscale
texture projected along the key-light axis, tinted toward the key colour where bright,
scrolling on a per-biome vector. Cost: one texture fetch + one multiply, plus one bit
in `customProgramCacheKey` (`a3w{aowet}p{puddle}c{cookie}`). It adds **no lights**, so
it triggers no light-count permutation.

It serves three biomes with one implementation:

| Biome | Cookie | What it buys |
|---|---|---|
| M3 Hollowmere | leaf dapple | canopy shadow a 1024 map can never resolve |
| M4 Glass Floor | venetian slats | the striped-light cinematography read |
| M5 Sable Run | cloud shadow bands | the single best daylight-realism cheat there is |
| *(M7 Pale Harvest)* | gust-density modulation | optional 4th consumer |

**Build LIGHTCOOKIE once, in the generalization phase, before any of the three biomes
that need it.** It is the highest-leverage line of shader in the whole expansion.

---

## PART 4 — THE BIOMES

Each entry: fiction & arc position · WebGL cheats (the "why this reads AAA on OUR
stack" argument, with honesty about where it is harder) · palette / key-light /
atmosphere / materials / props / audio · gameplay identity · reuse economics.

Every biome states how it spends the **frozen 14-light pool** (1 dir + 1 hemi +
8 spot + 4 point). The pool never changes size — parking a spot at intensity 0 is free;
adding a 9th is a 640–900 ms recompile storm across every map.

---

### M2 — DRYDOCK SEVEN
**Blue-hour maritime steel.**

**Fiction / arc.** Zarov Outer Harbour, Drydock Seven, 04:40. The bulk carrier
*Anixa Meridian* sits half-loaded in a dewatered graving dock; she sails at dawn.
The storm of mission 1 has passed — which is *why* the sky is different and it is
earned, not arbitrary. Act I close: you board expecting CINDERLOCK and find a launch
airframe and a manifest. This is the mission where the scale of the thing lands.

**Visual cheats.**
1. **Blue-hour silhouette stacking.** A graving dock is a canyon: hull wall on one
   side, dock wall on the other, gantry overhead. Every frame is composed of black
   cutouts at three depths against a graded dawn sky. Geometric poverty is invisible in
   silhouette — this is the cheapest way in existence to look photographed.
2. **Alpha-plane lattice density.** Deck grating, catwalk mesh, chain-link, safety
   netting, ladder cages. A two-triangle alpha-**tested** plane produces per-pixel
   complexity no polygon budget can buy. Rule: alpha-test only (never blend — sorting
   and depth die), double-sided, with a normal map. This is the biome's density engine
   and it is reused by M7's radar mesh.
3. **Honest modularity.** Shipping containers *are* identical in reality. This is the
   only biome where repeated identical props do not trip D7's copy-paste hard cap —
   **but only if** stacked with ±2° yaw/roll jitter, per-instance colour draw, and
   per-instance rust/placard decals. Perfect grids still fail.
4. **The wet path, transferred whole.** Dock floor puddled, hull wet, everything
   mirroring the sodium quay lamps. Zero new shader work — `augment({aowet, puddle})`
   applies verbatim.
5. **One volumetric hero:** two crane floods crossing the dock at ~30° through sea fog.
   That is the S3-equivalent establishing frame.

**Hardness, honestly.** Easier than M1 in one way (dark, wet, practical-lit — the whole
v1 toolkit applies) and harder in one: the hull is a **very large single-material
surface**, which is D3's uniform-roughness hard cap waiting to happen. It must ship
with a weld-seam/drip-rust trim sheet and per-panel roughness variance, or it reads as
a red plastic wall.

**Palette.** Steel blue-grey `#4a5766`, hull red-oxide `#6b3a2e`, sodium `#ff9a3c`
islands, dawn horizon bruise `#c8875a` → `#2a3a52`. Cold frame, one warm horizon band.

**Key-light story.** The DirectionalLight becomes a dawn sun still ~4° *below* the
horizon: no direct beam, only a bright eastern sky quarter. Hemisphere carries more
than in M1 (sky `#2c3a4e` / ground `#12161c`). The 4:1 key:ambient ratio is held by
keeping the dock floor in deep shadow while the hull-top and gantry get a hard sky
**rim** — rim-lighting is what preserves the ratio when the sun is technically absent.
*Light pool:* spots = crane floods ×2, quay sodium ×2, ship deck floods ×2, hold
interior ×1, welding arc ×1 (animated flicker). Points = 3 muzzle + 1 explosion.

**Fog.** Sea fog: density 0.014 (denser than M1), falloff **0.03** — sea fog is a slab,
not a hugging haze — start 12 m, colour warming hard to the east.

**Signature materials.** Painted ship steel with weld seams + drip rust (trim sheet),
deck grating (alpha), container paint, wet timber dunnage, marine growth below the
waterline, wet concrete dock wall.

**Signature props.** 40 ft containers, gantry-crane bogie, mooring bollards + hawsers
(catenary code, already shipping), lifeboat davits, an animated welding station, oil
drums, the dock caisson, ladder cages, hose reels, a pilot ladder.

**Ambient audio.** Hull groan (low, irregular — the map's signature), water drip in the
dock, gulls, a distant harbour horn, wind through the gantry, welding crackle near the
arc. Reverb zones: open dock (long), hold (very long, metallic), superstructure (short).

**Gameplay identity.**
- Sightlines: **CQB 30% / mid 55% / long 15%.** The dock floor is a ~90 m canyon (the
  long lane, at the bottom); the deck is a mid-range container maze; the hold is CQB.
- Verticality **is** the identity: three decks — dock floor (y 0), main deck (y +9),
  superstructure/bridge (y +15) — linked by a gangway, two ladders and the crane
  catwalk. Every level can be entered from above.
- Cover: dense on deck (containers at 4–6 m), deliberately sparse on the dock floor.
  Crossing the floor is the authored risk.
- **Tactical verb: the drop.** Damage-free descents (≤4 m) are the shortcut *and* the
  ambush. Height is the resource.

**Reuse economics.**
*Shared:* the wet/puddle path 1:1, sodium practicals, cone cards, catenary, decals, fx,
characters, weapons, and ~70% of the prop kit (`crate, pallet, fuel_drums, barrier,
bollard, fence, bin, shelving, guard_hut`).
*New:* container + gantry + hull-panel modular geometry (Tier 3), 4 texture sets
(ship_steel_seamed, deck_grating alpha, marine_rust, container_paint), 6 builders
(container, gantry bogie, davit, ladder cage, hawser bollard, welding rig), the
lattice alpha-test material class, a dawn sky preset, a harbour ambient bed.

---

### M3 — HOLLOWMERE  *(owner-named: FOREST)*
**Dawn conifer belt.**

**Fiction / arc.** The Hollowmere pine belt in the coastal hills 40 km inland, and the
Soviet-era microwave relay mast and service compound inside it. A Vektor courier
aircraft went down here in the storm; the relay is still retransmitting its telemetry.
06:20, first light, ground fog, the forest still dripping from last night's rain
(which lets the wetness path apply to bark and needles for free). Act II opens: the
first daylight-ish combat and the first enemy who is a dispersed patrol rather than a
static cordon.

**Visual cheats.**
1. **Cone cards, at last motivated *en masse*.** A conifer canopy at a low sun angle is
   the one real-world condition where twenty light shafts are literally correct. One
   shared additive cone material, ~24 instances, all parallel to the sun azimuth, faded
   by view angle and by camera distance < 2 m. M1 already ships five of these; this is
   the same code at scale, and it is the biome's hero image.
2. **The canopy cookie** (LIGHTCOOKIE, Part 3). A 1024 shadow map cannot resolve
   leaves. The dapple channel puts leaf shadow on the ground and on props at no
   shadow-map cost. Without it, sunlit ground is a flat lit plane — *the* daylight
   amateur tell. With it, the forest floor is the best-looking surface in the game.
3. **Ground fog as the LOD system.** 0–2.5 m ground mist plus aggressive aerial
   perspective lets tree instance density fall from ~40 in the 0–25 m band to
   silhouette-card bands beyond 45 m. Extreme fog is not a cheat here at all — it is
   what a coastal pine belt at dawn genuinely looks like.
4. **Alpha-TEST foliage, wind in the vertex shader.** Cross-billboard branch cards +
   3 trunk meshes, all instanced. Wind = two-frequency vertex sway on a per-instance
   phase, amplitude scaled by height. The whole frame moves — this is the forest's
   answer to what rain does for Meridian Ward, and constant micro-motion is a large
   part of why AAA frames feel alive.
5. **The floor is the frame.** Instanced ferns, deadfall, stumps and rocks at three
   densities, plus a needle-litter decal layer through the existing decal atlas. In a
   forest the camera looks *down* more than anywhere else; the floor gets the same
   investment the plaza puddles got in M1.

**Hardness, honestly — this is the second-hardest biome and it carries the top perf
risk in the expansion.**
- **Alpha-test foliage is the worst overdraw case in the catalogue on Iris Xe.**
  Mitigations, all mandatory: ≤12 cards per tree; alpha-test (`alphaTest 0.5`,
  `depthWrite true`) so sorting is free; never alpha-blend; foliage LOD drops *cards*
  before it drops *trees* (silhouette count must survive); the whole layer scales with
  the quality preset; and the perfprobe combat phase runs inside the densest stand,
  not at the compound.
- **This is the first biome where the DirectionalLight is the star**, so the 1024
  shadow map finally bites. Re-spend it: a tight ~25 m frustum around the player for
  trunk contact shadows; everything beyond 25 m is dapple-cookie + fog.
- **Hero assets do not exist on disk.** No vegetation pack is present
  (verified — Part 0). Trees are either procedurally generated behind the
  visual-quality gate (doctrine §7 permits procedural for props/architecture) or a
  gated asset spend. This is the reason the forest is expensive.

**Palette.** Bark `#3a3129`, needle `#2f3a2c`, moss `#4a5a3a`, fog `#b6bfc0`
(cool near-neutral), shaft `#ffd9a0`. **Low saturation, lifted greens** — the
over-saturated Kodachrome forest is the hobby tell; the reference is a damp northern
pine belt, not a nature documentary.

**Key-light story.** DirectionalLight at **6° elevation from the east**, warm
`#ffcf9e`, strong — it rakes *horizontally* through the trunks and IS the composition.
Hemisphere sky `#9fb0b8` / ground `#241f18`. This scene passes 4:1 comfortably; it is
the easiest D1 among the daylight biomes precisely because the sun is at grazing angle.
*Light pool:* spots = relay-station interior ×2, vehicle headlights ×2, generator shed
×1, road flare ×1, 2 parked. Points = 3 muzzle + 1 explosion.

**Fog.** Density 0.016, falloff **0.10** (hugs hard — ground mist), start 8 m, plus a
separate near-camera mist card layer for the 0–8 m band.

**Signature materials.** Bark (Poly Haven `bark_*`, on disk), forest-floor litter,
moss-on-rock, wet foliage atlas (alpha), dirt track with tyre ruts (puddles via the
existing path), corrugated relay-shed steel (reuses `corrugated`).

**Signature props.** Conifers ×3 silhouette variants, deadfall logs, stumps, ferns,
boulders, the relay mast + guy wires (catenary), the service shed, the downed aircraft
tail section (**Tier 3 hero**), a fuel bowser, compound chain-link (`fence` reused),
a firewatch tower.

**Ambient audio.** Dawn birds — **thinning to silence when combat starts**, which is
the cheapest and best tension tool in the campaign — wind in canopy (procedural
filtered noise), drip, distant crow, guy-wire hum. New footstep surface: **`needles`**.

**Gameplay identity.**
- Sightlines: **CQB 25% / mid 55% / long 20%.** Trees break lines *statistically*, not
  architecturally — this is the level that teaches moving between cover you cannot
  fully trust.
- Verticality: the firewatch tower (y +8) and a ridge shelf (y +5) — two hard overlooks
  in an otherwise flat space, which is exactly what makes them contested.
- Cover: **high count, low quality.** A 0.4 m trunk is partial cover. Everywhere is
  half-cover; nowhere is safe. That distinction is the entire tactical identity.
- **Tactical verb: flanking through concealment.** Concealment ≠ cover — foliage is
  `matClass: soft`, so the shipping penetration table (BUILD_PLAN R5) makes suppressive
  fire through a bush genuinely work for the first time in the game.

**Reuse economics.**
*Shared:* engine, fx, wet path, catenary, decals, `fence/shed/fuel_drums/barrier/crate/
guard_hut` props, `corrugated` + `iron_plate` materials, LIGHTCOOKIE.
*New:* the **foliage system** (instancer + wind shader + card LOD) — the single largest
new render-side subsystem in the expansion; tree/fern/log/rock geometry; 5 texture
sets; the `needles` surface key; a dawn-overcast sky preset; a forest ambient bed.

---

### M4 — THE GLASS FLOOR  *(owner-named: OFFICE)*
**Fluorescent interior, storm outside.**

**Fiction / arc.** Vektor Ancile's registered head office — floors 21 to 26 of the
Astral Meridian tower in Zarov's new financial district. 19:50, and the *same weather
system* from mission 1 is outside the glass, seen from 90 m up. Act II middle: you go
in for the ledger, and the building goes loud. This is the reveal mission.

**Visual cheats.**
1. **The window wall IS the key light.** One DirectionalLight raking through a
   floor-to-ceiling curtain wall with venetian blinds. The slat shadows across the
   floor plate and the desks come from the **same LIGHTCOOKIE channel** as the forest
   dapple — a striped cookie instead of a leaf cookie. Striped light is a photographic
   idiom; it reads as *cinematography* instantly, and it costs one texture.
2. **Polished floor = the office's wet asphalt.** Vinyl/polished concrete at roughness
   0.12–0.25 and glass partitions at 0.06. Re-scope the **existing** planar-reflection
   pass (512 px, every 2nd frame, layer-masked, ~40 draws) from the plaza to the floor
   plate: ceiling troffers, the city outside, and characters smear down the floor.
   Same code, new mask, same budget. This is the screenshot moment.
3. **A ceiling, always.** Suspended tile grid + recessed troffers + sprinkler / HVAC /
   cable-tray runs above head height. Interiors without ceilings read as dioramas; this
   one costs one trim material and instantly reads institutional. **The troffers are
   emissive planes plus baked floor pool-decals, NOT lights** — that is how a
   40-luminaire floor gets lit with six spot slots.
4. **Density is free here.** The Kenney furniture kit is on disk (verified): desks,
   task chairs, monitors, keyboards, laptops, bookcases, cabinets, trashcans, potted
   plants, sofas. D7 (environment density) is the easiest 9 in the catalogue.
   Anti-copy-paste rule: every bay draws its dressing from a 5-item random set with
   per-desk yaw jitter, and 1 in 6 desks is "abandoned mid-shift" — jacket over the
   chair, mug, monitor still on.
5. **Glass is a rendering asset AND a gameplay asset.** Meeting-room partitions let you
   see a fight before you can join it, break to the `glass` surface already in the fx
   table, and permanently change the map when they go. Breaking glass is this biome's
   permanence story (D6).
6. **The city as backdrop, for free.** Outside the curtain wall: the existing sky ring
   silhouettes viewed from y +90 — the same sky code, a completely new read — plus rain
   running down the glass with the droplet-normal material that already ships.

**Hardness, honestly.** This is the **lowest-risk new biome** and the best payoff per
unit cost in the set. The one genuine exposure is D1: an interior legitimately lit by
its hemisphere is one step from "delete the key and nothing changes" (the D1 → max 3
hard cap). It survives only if all three of these are true and probe-verified:
(a) the slat cookie gives visible directional structure, (b) troffer pool-decals give
local light structure on the floor, (c) the server room, the stairwells and the
alarm-state floor are **genuinely dark**. Build the calibration-card probe into the
open-plan bay, not the lobby.
Second, smaller exposure: this is the only **clean** biome we ship. The grime pass does
not disappear — it *relocates* to wear at hand height: scuffed skirting, chair-scarred
carpet tracks, worn keycaps, coffee rings, greasy door pushes, ceiling-tile water
stains. A spotless office is as much a lie as a spotless alley.

**Palette.** Fluorescent cool white `#dfe9ff`, corporate grey-blue `#3f4a55`, warm
veneer `#8a6b4a`, storm outside `#1a2230` speckled with the city's sodium and neon,
and ONE red emergency-strobe state for the alarm phase. Neutral-cool grade, low
saturation, high micro-contrast.

**Key-light story.** DirectionalLight through the west curtain wall at 8°
(setting sun through storm — dim, orange) + HemisphereLight carrying the fluorescent
ambient (sky `#c6d4e6` / ground `#2a2e33`).
*Light pool:* spots = lobby ×1, elevator lobby ×1, boardroom ×1, server room ×1,
stairwell ×1, exec office ×1, 2 parked (leased to the alarm strobe in the loud phase).
Points = 3 muzzle + 1 (glass-shatter / server-fire flash).

**Fog.** Almost none indoors (density 0.002). Instead: an **alarm-phase smoke layer**
ramping to 0.03 on the affected floor, haze visible only in the troffer and emergency
beams. Outside the glass, the full M1 fog stack — which is what sells the height.

**Signature materials.** Carpet tile, ceiling tile, polished vinyl, wood veneer,
painted drywall, partition glass, brushed-aluminium mullions.

**Signature props.** Workstation bays, monitors/keyboards/laptops, task chairs,
whiteboards, **server racks** (the interior hero), a glass-walled boardroom, an
elevator lobby with open shafts, a fire stair, potted plants, a kitchenette, blinds,
ceiling troffers, cable trays, a shredder room.

**Ambient audio.** HVAC hum (procedural pink noise + one resonant band), fluorescent
buzz near troffers, a **server-room fan wall** — the loudest room in the game, which
masks footsteps and is therefore a real tactical texture — an unanswered desk phone,
the alarm klaxon in the loud phase, rain on glass, an elevator chime. Reverb zones:
open plan (short), stairwell (long metallic), server room (dead but loud), lobby
(long marble).

**Gameplay identity.**
- Sightlines: **CQB 60% / mid 35% / long 5%.** The tightest map after the Undercroft.
- Verticality: three floors joined by two stairwell cores, an elevator lobby with open
  shafts giving the map's one truly long sightline — straight up — and a mezzanine over
  the lobby.
- Cover: **very high density, almost all SOFT.** Desks and partitions are
  `matClass: soft`; the penetration table makes desk-camping lethal. Cover is
  everywhere and none of it is real.
- **Tactical verb: angles and pre-fire.** A cubicle maze rewards clearing discipline
  and punishes sprinting. This is the Vesper SMG's home map.

**Reuse economics.**
*Shared:* the entire engine; fx (the `glass` surface already exists); the planar
reflection (re-masked, zero new code); sky (seen through glass); rain (against glass);
the decal atlas; characters; weapons; ~40% of the prop kit (`bin, shelving,
breaker_box, barrier, crate, table, chairs`).
*New:* 5 texture sets; ~10 Kenney GLB kinds (loader entries, **no** new builders);
6 new builders (troffer, ceiling grid, cubicle partition, blinds, server rack, cable
tray); the slat cookie (shares M3's channel); an office ambient bed; 4 reverb presets.
**Zero new render technology beyond the shared cookie.** That is why it wins the ratio.

---

### M5 — SABLE RUN  *(owner-named: OUTDOOR)*
**Open daylight. The honest hard one.**

**Fiction / arc.** The Sable Run border crossing and the disused chalk quarry above it,
on the mountain road out of Zarov. 12:30, broken overcast, high wind, intermittent
drizzle. Act II closes: you interdict the convoy, and **you lose** — the convoy is
bait and RAVEN 2-1 takes its casualties here. The arc's widest, loudest, most exposed
space, and its defeat.

**Visual cheats — and this is where we say out loud that DAYLIGHT EXPOSES EVERYTHING.**
level_design §0 rejected daylight for v1 on four stack-specific grounds, all still
true: the 1024 shadow cap, no baked GI, no GTAO/TAA, and fog-as-perf-tool fighting the
premise. None of that has changed. What follows is not a refutation; it is the
mitigation set that makes ONE daylight map survivable.

1. **Commit to BROKEN OVERCAST. Never clear noon.** A clear sun at 60° is the hardest
   possible lighting to fake: it demands crisp long shadows the 1024 map cannot deliver
   across 120 m (~12 cm/texel), and it flattens every material we own. Broken overcast
   is a real, common, *cinematic* daylight state where the key is soft and only
   loosely directional. This is a lighting choice with a defensible photographic
   reference, not a cop-out — most northern-European conflict photography looks exactly
   like this.
2. **Cloud shadows — the daylight cheat.** Slow world-space bands of shade drifting
   across the terrain, from the same LIGHTCOOKIE channel. Nothing makes flat daylight
   ground look photographed faster than brightness breathing in bands across it. Third
   consumer of one feature.
3. **Re-spend the shadow budget.** With a soft key, the 1024 map takes a tight ~20 m
   frustum around the player and does **contact shadows only**. Beyond 20 m, grounding
   comes from vertex AO, blob decals and the cloud bands. Acceptance probe: no prop in
   the battery lacks contact darkening at any distance — D1's floating-prop → max 6
   cap is the real enemy in daylight, more than the key ratio.
4. **Terracing beats terrain.** An open field has no silhouette layering, which is
   precisely what daylight demands. A **quarry** does: benches, berms, haul ramps,
   spoil heaps, a crusher plant. Build the "outdoor" map as stacked horizontal planes
   at 4–6 m intervals so every frame has a foreground edge, a mid mass and a far ridge.
   Composition does the work the lighting cannot.
5. **Aerial perspective, low but present.** Density 0.0035 with strong
   desaturation-toward-sky. Distant ridges must lose contrast or D4's
   full-contrast-distant-geometry → max 5 cap fires immediately.
6. **Anti-tiling is life or death here.** A 120 m gravel plane under diffuse light is
   the worst tiling case we will ever ship (D3 → max 6 on a visible repeat). Mandatory,
   all three: macro-variation vertex tint at 20–40 m scale, a second grunge layer at a
   non-integer UV scale, and scatter decals (tyre tracks, oil, spoil, water staining)
   at ≥1 element per 4 m². `augment()`'s grunge/mottle path already provides two.
7. **Wind is the animation layer.** Grass and scrub sway (M3's vertex-wind shader,
   reused), dust devils, drifting drizzle sheets, flapping tarps and a torn flag, and
   the rain instancer re-parameterised as blown grit. Daylight without motion reads
   dead, and this map has no rain to carry it.

**Hardness, honestly — the most expensive and highest-risk biome in the set.**
- **Three critic dimensions have their worst case here simultaneously:** D1 (key:ambient
  under a soft sky), D3 (a huge tiled ground plane), D4 (aerial perspective at
  daylight densities). No other biome stacks three.
- **Chalk is the clamped-whites trap.** D2's non-light clamped whites → max 4 cap is
  one careless albedo away. Author chalk at `#c8c4b8`, never above `#e0`, and let AgX
  roll the highlights.
- **It requires the first non-flat ground in the game.** `colliders.groundY` is
  currently `(x,z) => terrain.base` with one canal step (`colliders.js:63`). A terraced
  quarry needs a real heightfield in the THREE-free collider layer, which touches
  `world.sphereGround`, `moveCapsule`, and the nav bake. **This is the single largest
  sim-side change any biome demands, and it is why this biome ships late.**
- It also carries the largest draw distance and therefore the largest draw-call
  exposure against the ≤320 firefight median.

**Palette.** Chalk white-grey `#c8c4b8`, wet slate `#4a4f52`, ochre earth `#8a7350`,
scrub grey-green `#6a7058`, sky `#b8c2cc` with one bright quarter. Cool-neutral grade,
saturation ~0.85, highlights rolled hard.

**Key-light story.** DirectionalLight at 42°, `#e8eef5`, moderate intensity, high
`shadow.radius` (soft). Hemisphere sky `#aebdc9` / ground `#4a4238` — an unusually
strong ground-bounce term, because chalk genuinely bounces. The 4:1 ratio is the
hardest in the campaign; it is achieved by keeping the quarry's north faces, the
culverts, the crusher plant's interior and the crossing booths **genuinely dark**, and
the calibration card is placed in the crusher's shadow, not in the open.
*Light pool:* spots = customs booth interior ×1, burning vehicle ×1, **6 parked at 0**.
Points = 3 muzzle + 1 explosion. Daylight biomes waste most of the spot pool — this is
an accepted, documented cost of the frozen pool, not a reason to change it.

**Fog.** Density 0.0035, falloff 0.02 (daylight haze does not hug), start 40 m, colour
tracking the sky.

**Signature materials.** Chalk/limestone faces, gravel haul road, wet slate, dry scrub
grass (alpha cards), rusted plant steel, concrete crash barriers, weathered road paint.

**Signature props.** The crossing (booths, boom barriers, canopy, queue lanes, jerseys —
mostly existing), the convoy (2 trucks + 2 technicals from the existing `truck` GLB
with new dressing), the **crusher plant + conveyor** (Tier 3 hero — a vertical
silhouette in a horizontal world), spoil heaps, haul berms, a water-filled sump (the
wet path, again), pylons + power lines (catenary), road signage, culverts.

**Ambient audio.** High wind is the dominant bed — wide filtered noise with gusts —
plus grit against metal, distant thunder, corrugated flapping. **No birds.** A quarry
is dead, and the silence of this map against Hollowmere's dawn chorus is a deliberate
contrast the player will feel without naming.

**Gameplay identity.**
- Sightlines: **CQB 15% / mid 40% / long 45%.** The longest lines in the campaign — up
  to ~140 m across the pit.
- Verticality is the identity: four quarry benches at y 0 / +5 / +10 / +16, plus the
  crusher tower at +20.
- Cover: low in the open, clustered at the plant and the crossing. Transit is
  deliberately punishing.
- **Tactical verb: long-range positioning and the approach.** The Corvus DMR's home
  map. If smoke grenades are ever added to the frag system, this is the mission that
  justifies them.

**Reuse economics.**
*Shared:* engine, fx, decals, `barrier/sandbags/truck/fuel_drums/fence/guard_hut`
props, catenary, `iron_plate`/`concrete` materials, M3's wind shader and foliage
instancer (scrub reuses it wholesale), LIGHTCOOKIE.
*New:* the **heightfield/terracing approach** (sim-side, the real cost), 4–5 texture
sets, scrub/grass cards, the crusher plant, a **daylight sky preset** (the largest sky
change in the expansion — clouds must now be lit, with a bright quarter and shaded
undersides), a daylight grade preset, a wind ambient bed.

---

### M6 — THE UNDERCROFT
**Subterranean brick and standing water. The cheapest map in the expansion.**

**Fiction / arc.** The Zarov cistern network — a 19th-century brick water reservoir
with Soviet service tunnels grafted onto it, under the old town. After Sable Run you
are hunted, so you go under. Emergency lighting only, knee-deep water in places, one
working generator. Act III opens at the low point: least ammo, closest quarters, most
dread.

**Visual cheats.**
1. **It reuses Meridian Ward's entire lighting model with none of its costs.**
   Practical pools on wet surfaces + fog + darkness allowed to be dark — but with
   **no sky, no weather, no horizon, no LOD problem, no aerial perspective duty.**
   Everything the outdoors makes expensive simply does not exist here. This is why it
   is the correct map to prove the multi-map refactor on.
2. **Total authored darkness.** With no sun, the DirectionalLight parks at intensity 0
   and the 8 spots ARE the lighting design. Zone contrast can run 2% → 100% inside
   20 m — the most dramatic exposure rhythm in the campaign, and the most obvious
   possible proof to a critic that the frame is not ambient-lit: you can delete one
   spot and a room goes black.
3. **The weapon light — a new verb, and it belongs here.** Lease one spot slot to a
   player-mounted light (cone ~28°, 22 m, warm white, off by default, toggled). It
   moves with aim, it lights wet brick, and it gives away position. The biome's
   mechanic and its lighting design are the same object, and it costs an
   already-allocated slot. Bots get the equivalent, so their approach telegraphs —
   a fairness win, not just a visual one.
4. **The wet path at maximum.** Standing water at roughness 0.04 with the existing
   ripple normal and a baked cube env: the emergency strips reflect down the whole
   length of a tunnel. It is the M1 puddle trick with the puddle covering the floor.
   Wading disturbs it (a ripple emission at the feet — a small addition to an existing
   path) and it is **loud**, which is a stealth mechanic for free.
5. **Vault geometry is trim-sheet paradise.** Brick barrel vaults, arch springings,
   pipe runs, valve wheels, conduit: one 2048 trim sheet carries the entire biome,
   exactly the technique visual_target §3 names as how AAA gets dense detail from few
   materials. And curved vaults give the frame **continuous shading gradients**, which
   is the single best thing that can happen to a low-polygon scene.
6. **Reverb is half the atmosphere.** The convolver zone system already exists (the
   `zone` event, R13). Here it becomes a headline feature: a 4 s tail on every shot,
   footsteps that arrive before their owner does.

**Hardness, honestly.** The **safest** biome for the critic bar and the best perf
profile in the catalogue (smallest volume, fewest draws, no sky, no weather instancer,
no planar pass required). Its only real risk is monotony: brick and water for
14 minutes. Mitigations are content, not tech — the daylight shaft through a storm
grate (the map's one cool colour and its emotional payoff), the generator hall, the
collapsed brick fall, the flooded reservoir's scale change, and one room that is
plainly *not* Victorian (a Soviet control room with dead CRTs).

**Palette.** Brick red-brown `#5a3a30` under sodium `#ff9a3c`, black-green water
`#0e1613`, emergency amber `#d9a441`, and ONE cold daylight shaft `#b9cfe0`. The most
warm-saturated biome in the campaign — the deliberate inverse of M1's magenta/cyan.

**Key-light story.** Directional parked at 0 (documented, deliberate). Hemisphere very
low (sky `#10120f` / ground `#06070a`). The 8 spots do literally everything.
*Light pool:* spots = emergency strip ×2, sump lamp ×1, generator hall ×1, grate shaft
×1, control room ×1, **player weapon light ×1**, bot weapon light ×1. Points = 3 muzzle
+ 1 explosion.

**Fog.** Density 0.020 in the flooded sections (mist off the water), 0.006 elsewhere,
falloff 0.12 (hugs the water hard). Its whole job here is beam volumetrics, not depth.

**Signature materials.** Wet engineering brick (trim sheet), lime bloom and
efflorescence streaks, rusted cast iron (reuses `iron_plate`), silt, algae, painted
steel bulkhead doors.

**Signature props.** Valve wheels + manifolds, pipe runs, a bulkhead door (a gated
set-piece), the generator, cable conduit, sluice gates, floating debris, a rowboat,
a collapsed brick fall (the traversal obstacle), pallet catwalks over water, cage lamps.

**Ambient audio.** Drip with a 4 s tail, water flow, generator drone, and — the detail
that makes it feel like it is under a living city — **distant traffic rumbling through
the ceiling**. Plus metal groan and boot-in-water footsteps. New surface: **`water_shallow`**.

**Gameplay identity.**
- Sightlines: **CQB 75% / mid 25% / long 0%.** The most claustrophobic map in the game.
- Verticality: modest but real — catwalks at +2.5 over flooded chambers, a sump pit at
  −3, ladder shafts.
- Cover: dense, hard (brick piers), and almost all at 90°. This map is about **corners**,
  not cover.
- **Tactical verb: sound and light discipline.** Wade or walk. Light on or blind. It is
  the campaign's stealth-adjacent chapter without ever needing a stealth system.

**Reuse economics.** The highest of any new biome.
*Shared:* engine, fx, the wet/puddle path, practical pools, cone cards, decals,
reverb zones, and the industrial half of the prop kit (`fuel_drums, pallet,
breaker_box, shelving, fence, bin, crate`).
*New:* 2–3 texture sets (the brick-vault trim sheet is the only substantial one), the
vault geometry approach, the weapon-light lease, the wade-ripple, the `water_shallow`
surface, an underground ambient bed.
**No sky. No weather. No LOD system. No new render technology.**

---

### M7 — PALE HARVEST
**Whiteout blizzard on the ridge.**

**Fiction / arc.** The Blackridge relay — a Cold-War over-the-horizon radar and missile
relay at 1,900 m, above the treeline. Snow, whiteout, 40 kt wind. Act III middle: the
assault, the largest bot counts and the most set-piece-driven mission in the campaign,
and the moment the operation's name finally means a place.

**Visual cheats.**
1. **Whiteout is a fog dial, and it is the strongest LOD hider we have — stronger than
   night.** Draw distance can be 60 m and be *correct*. A blizzard is the cheapest way
   in existence to build a location that feels big.
2. **Snow reuses the weather instancer, free.** The same 2,800-instance system with new
   velocity, size and blend parameters: slow, wide, heavily sheared, plus an additive
   near-camera layer. Zero new systems.
3. **Snow's real cost is the MATERIAL, and it must not clamp.** White + AgX is exactly
   D2's clamped-whites → max 4 trap. Rules: albedo authored at `#c4cad2` (never white);
   roughness 0.72 with a genuine **variance map** — wind-scoured ice at 0.15 in the lee,
   powder at 0.9 in drifts; a strong blue shadow term from the hemisphere; sparkle from
   a sparse high-frequency normal, **never** from emissive.
4. **Drift geometry, not a flat plane.** Wind-carved sastrugi ridges as low-poly
   geometry carrying the snow material — the terracing trick at 0.5 m scale. It is what
   makes snow read as snow rather than as a white floor.
5. **Everything man-made is BLACK against it.** The dish, the gantry, the antenna farm,
   the bunker vents: high-contrast silhouettes on a white ground is a composition that
   survives any amount of geometric poverty. **The frame becomes a graphic** — that is
   this biome's real payoff.
6. **Warm islands.** The bunker interior, vehicle headlights, a burning wreck — three
   or four warm practicals in a blue-white world do enormous work for D1's
   colour-temperature story.

**Hardness, honestly.** The **second-hardest for D1** after Sable Run: in a whiteout
there are almost no shadows and the hemisphere carries much of the frame, so 4:1 is
nearly unachievable in the open. The honest answer is that the ratio is carried by the
bunker interiors, the lee sides of the structures and the warm-island practicals — and
that the battery's D1-scoring frames must be composed to include one of those. State
that up front rather than discovering it in iteration 3.
It also depends on M5 having shipped: a whiteout sky is a degenerate daylight sky, so
if the daylight sky preset exists this biome is cheap, and if it does not, this biome
pays for it.

**Palette.** Snow `#c4cad2`, shadow-snow `#8a99ad` (blue), flat sky `#cdd4dc`, black
steel `#1a1c1f`, warm interior `#ffb46b` islands. Grade: high-key but never clipped,
saturation ~0.75 (the lowest in the campaign), strong blue shadow lift.

**Key-light story.** DirectionalLight at 22°, `#eef3f8`, low intensity, shadows nearly
off. Hemisphere sky `#d2d9e2` / ground `#97a5b6`.
*Light pool:* spots = launch-gantry floods ×4, bunker interior ×2, snowcat headlights
×2. Points = 3 muzzle + 1 explosion.

**Fog.** Density 0.030 (the highest in the campaign), falloff **0.01** — a whiteout is
uniform, not layered — start 5 m, colour = sky. Crucially, **density modulates over the
mission in gusts**, which makes atmosphere gameplay-relevant for the first time.

**Signature materials.** Packed snow, wind-ice, frosted painted steel, ice-glazed
concrete, radar-dish mesh (the M2 alpha-lattice class, reused).

**Signature props.** The OTH radar dish (**Tier 3 hero**), antenna farm + guy wires
(catenary), bunker vents, snowcats, a fuel farm, blast doors, aviation-warning masts,
wind-flags, half-buried vehicles.

**Ambient audio.** The wind IS the mix — a wide gusting bed that ducks everything else,
so combat audio has to fight it, which is a real tension mechanic. Plus snow-crunch
footsteps (**new surface: `snow`**), metal singing in the wind, muffled interiors via
the existing lowpass, and the dish motor.

**Gameplay identity.**
- Sightlines: **CQB 35% / mid 50% / long 15%** — long lines exist but the whiteout eats
  them. Engagement range is dictated by **weather, not geometry**, and it *changes as
  gusts pass*. No other map in the campaign has that.
- Verticality: gantry and dish platform at +12; bunker interior at −4.
- Cover: medium density, mostly hard (concrete + drifts). Drifts are chest-high cover
  that does **not** stop rounds (`matClass: soft`) — a lovely penetration-table moment
  that teaches the player something real about the table.
- **Tactical verb: visibility management.** Push during a gust, hold when it clears.

**Reuse economics.**
*Shared:* engine, fx, the weather instancer (re-parameterised), catenary, the M2 lattice
alpha material, M5's daylight sky machinery, and M6's practical model for the bunker
interiors.
*New:* 3 texture sets, sastrugi geometry, the `snow` surface key, a wind ambient bed,
a snow footstep/foley set.

---

### M8 — MERIDIAN ASH
**Meridian Ward, burning. The return-transformed finale.**

**Fiction / arc.** Back to Meridian Ward at 05:10 the next morning. CINDERLOCK was
never leaving Zarov — it was aimed at it. The ward is burning, the district is
evacuating, and the streets you infiltrated in silence are now the defensive line.
The campaign ends where it began, unrecognisable.

**Visual cheats.**
1. **A whole "new" map for near-zero art.** Identical `layout.js` geometry, identical
   colliders, identical props — with a fire-lit key instead of a neon key, a smoke sky
   instead of a storm sky, a damage-state dressing pass, and ash instead of rain.
   Perceptually this reads as a different location. It is the highest ratio of
   perceived-new to cost anywhere in this plan, and it is a proven AAA move.
2. **FIRE is the light source, and it reuses the pool exactly.** The 8 spots move from
   neon and sodium practicals to fire pools — burning kiosks, a burning car, the
   collapsed arcade, the tram fire — each with an intensity flicker curve at
   `#ff7a2e`. The 4 points keep their muzzle/explosion duty. **Zero new lighting code;
   only a new `LIGHT_POLES` data array.**
3. **Dawn-through-smoke, not clean daylight.** The sun sits at ~2° behind a smoke
   column: the sky is a graded orange-brown bruise, ambient is warm and dim, and the
   frame still has deep shadows. This deliberately does **not** depend on M5's daylight
   technology, which is what makes the finale cheap and schedule-safe.
4. **Ash for rain.** The weather instancer again: slow, drifting, warm-lit motes plus a
   lazy near-camera layer. And the wet surfaces from M1 are now **drying** — a global
   wetness dial at 0.35 instead of 1.0, which is one uniform.
5. **The damage-state pass is the only real art cost.** A collapsed facade section
   (Tier 3 hero), a crater in the plaza, burned-out car shells (tint + soot decals on
   existing GLBs), toppled kiosks, dead neon (emissive off + glass-shard decals),
   scorch and soot from the existing decal atlas, and five smoke columns (cone cards,
   inverted). Budget: ~12 modified or added props, one collapsed mass, ~8 decal
   variants. Nothing else.

**Hardness, honestly.** Low risk, with one caveat worth naming: a lighting-and-dressing
variant can read as *lazy* if the blocking is unchanged. It must not be. The collapsed
facade closes the alley dog-legs, the plaza crater opens a sightline that never existed,
and the arcade's upper floor becomes impassable. **If the player can walk mission 1's
route unchanged, the reprise has failed.**

**Palette.** Fire orange `#ff7a2e`, soot `#14100e`, smoke brown-grey `#6a5c50`, ash
`#b8b2a8`, and ONE cold dawn sliver `#6f8aa8`. The exact inverse of Meridian Ward's
cold-frame-with-warm-islands: **warm frame with cold slivers.** That inversion is what
sells it as a different place.

**Key-light story.** Directional at 2° through smoke, warm `#ff9a5c`, low. Hemisphere
sky `#6a5546` / ground `#241c16` — warm in both terms, the burning-city bounce. The
ratio holds because the fire spots dominate locally.
*Light pool:* spots = 8 fire pools. Points = 3 muzzle + 1 explosion. Unchanged counts.

**Fog.** Density 0.018, colour warm `#5a4438`, falloff 0.05, start 10 m — smoke haze —
plus the five smoke columns.

**Ambient audio.** Positional fire crackle at each fire spot, structural collapse, a
distant siren loop, no rain, evacuation PA in invented Zarovian, secondary explosions.

**Gameplay identity.** It **inverts** mission 1. The same geometry played backwards
(north → south — you are falling back to the canal) with new blocking. The sightline
profile shifts from M1's roughly 45/40/15 to **CQB 30% / mid 50% / long 20%**, because
smoke shortens the boulevard and rubble opens the plaza.
**Tactical verb: the fighting retreat — holding a line that keeps shrinking.**

**Reuse economics.** ~95% shared.
*New:* one `LIGHT_POLES` data set, a smoke-sky preset, an ash weather preset, ~12
damage props, 8 decal variants, a fire ambient bed.
**No new textures. No new technology. No new characters.**

---

## PART 5 — WHAT MUST GENERALIZE (the engineering precondition)

None of the above can be built until the single-map assumptions come out. This is the
real work of the expansion; the biomes are art on top of it.

| # | Change | Current state (verified) | Shape of the fix |
|---|---|---|---|
| G1 | **Map registry** | `buildLayout(seed)` returns one hard-coded object; `NODES`/`ZONES`/`WALK_RECTS`/`LIGHT_POLES`/`ROADS`/`TERRAIN` are module consts (`layout.js:544–680, 758`) | `buildLayout(mapId, seed)`; move each map into `core/level/maps/<mapId>.js` exporting the same shape; `layout.js` becomes the registry + the shared helpers (`box`, `steps`, `prop`, `computePlacements`) |
| G2 | **Collider map id** | `buildColliders(seed = 1)` imports `buildLayout` directly (`colliders.js:26–28`) | `buildColliders(mapId, seed)`; frozen return shape unchanged |
| G3 | **Node namespacing** | R24 freezes 15 keys, all Meridian Ward | Namespace as `<mapId>.<nodeKey>`; the contract gate resolves against the *loaded* map. **Freeze amendment required.** |
| G4 | **Per-map materials** | `makeMaterials(ctx)` opens `if (CACHE) return CACHE;` with 6 hard-coded sets (`materials.js:520–566`) | `makeMaterials(ctx, mapId)`; Tier-1 kit cached globally, Tier-2 sets cached per map with explicit disposal on map change. **Without this the ≤120 texture / ≤200 MB VRAM budget breaks on map 3.** |
| G5 | **Sky presets** | night-storm hard-coded; `DOME_R`, `RINGS` module consts (`sky.js:26–34`) | `createSky(ctx, preset)` with presets `night_storm, dawn_harbour, forest_dawn, interior_storm, overcast_day, none, whiteout, smoke_dawn` |
| G6 | **Weather presets** | `FOG` is a module const (`weather.js:45–51`); rain count/occlusion AABBs hard-coded | `createWeather(ctx, preset)`: fog block + particle-mode (`rain\|snow\|ash\|grit\|none`) + occlusion AABBs read from the map's layout |
| G7 | **LIGHTCOOKIE** | does not exist; `augment()` already owns the injection point and a `customProgramCacheKey` | one world-space multiply channel + one cache-key bit. **Build before M3/M4/M5.** |
| G8 | **Surface vocabulary** | frozen at `concrete\|metal\|dirt\|wood\|glass` (architecture §3.14, shared with audio) | add `needles`, `water_shallow`, `snow`. Touches fx impacts, audio footsteps, colliders `surface`, the impact table. **Freeze amendment required.** |
| G9 | **Heightfield ground** | `groundY = (x,z) => flat` (`colliders.js:63`) | a real heightfield in the THREE-free layer; touches `world.sphereGround`, `moveCapsule`, nav bake. **Only M5 needs it — gate it behind M5.** |
| G10 | **Per-map asset manifests + eviction** | one `assets/manifest.json` | per-map manifest fragments + a load/evict path so the ≤6 MB menu / ≤+5 MB mission-gate budgets hold with 8 maps on disk |
| G11 | **Arena carve data** | does not exist | `arena: {min, max, spawns[], loopPatch}` on every map's layout export |

**G1, G2, G4, G5, G6, G7, G11 are the generalization phase. They block everything and
should be proven on ONE cheap map before any expensive art is commissioned.**

---

## PART 6 — RANKING AND BUILD ORDER

Payoff = perceived variety + critic-scorecard headroom + arena quality (1–10, higher
better). Cost = new art + new technology + new risk (1–10, higher worse).
Ratio = payoff ÷ cost.

| Rank | Biome | Payoff | Cost | Ratio | Critic risk | Dimension most at risk |
|---|---|---|---|---|---|---|
| 1 | **M8 Meridian Ash** | 8 | 2 | **4.00** | LOW | D7 (must change the blocking, or it reads lazy) |
| 2 | **M6 The Undercroft** | 8 | 3 | **2.67** | LOW | D7 (monotony over 14 min) |
| 3 | **M4 The Glass Floor** | 9 | 5 | **1.80** | LOW–MED | D1 (hemisphere-lit interior vs the ambient-only cap) |
| 4 | **M2 Drydock Seven** | 8 | 5 | **1.60** | LOW | D3 (large single-material hull) |
| 5 | **M7 Pale Harvest** | 8 | 6 | **1.33** | MED | D1 + D2 (no shadows; clamped whites) |
| 6 | **M3 Hollowmere** | 9 | 8 | **1.13** | MED–HIGH | perf gate (alpha-test overdraw) before any D-score |
| 7 | **M5 Sable Run** | 7 | 10 | **0.70** | HIGH | D1 + D3 + D4 simultaneously |

### Recommended build order

**Mission order is not build order.** The campaign plays 1→8; it is built in the order
below, which is driven by risk retirement and reuse dependency.

> **Phase E0 — GENERALIZATION.** G1, G2, G4, G5, G6, G7, G11. No art. Blocks everything.
>
> **Wave 1 (the first three after Meridian Ward): M6 THE UNDERCROFT → M4 THE GLASS
> FLOOR → M2 DRYDOCK SEVEN.**
>
> **Wave 2:** M3 Hollowmere → M8 Meridian Ash.
> **Wave 3:** M5 Sable Run → M7 Pale Harvest.

**Why the Undercroft first, even though the owner named forest/office/outdoor.**
It is the *refactor vehicle*, not the headline. The multi-map generalization (Part 5)
is the actual hard work here, and it should be proven on the map with the fewest new
variables — no sky, no weather, no LOD, no new render technology, and a lighting model
identical to the one already shipping. If the refactor is proven on the Undercroft,
every later biome is art plus a preset. If we prove it on the forest, we will be
debugging the map registry and the foliage instancer at the same time, and we will not
know which one is lying to us. The Undercroft costs roughly what the office costs, and
its entire purpose is to make the office cheap — then the office ships immediately
after, as the owner's number-one named biome and the best payoff-per-cost in the set.

**Why Drydock third rather than the forest.** It proves "outdoor but still dark" — the
half-step between the fully-controlled M1 lighting and a real sun — while reusing the
wet path wholesale. It also builds the alpha-lattice material class that M7 needs later.
Going straight from interiors to a bright forest skips the rung.

**Why Sable Run last.** It is the only biome that requires a sim-side change (G9,
heightfield ground), it stacks three critic dimensions' worst cases, and everything it
would teach us about daylight is learned more cheaply in Hollowmere first.

**If the owner wants his three named biomes first**, the priced swap is:
**M4 Glass Floor → M3 Hollowmere → M5 Sable Run.** The cost of that ordering is that
the generalization refactor is debugged concurrently with the foliage system and the
heightfield, the two highest-risk pieces of technology in the expansion, and Wave 1
approximately doubles in duration. That is a legitimate choice; it is just not the
cheap one, and it should be made knowingly.

### Two schedule notes worth acting on independently

1. **ASHFALL is the cheapest arena in the roster and it does not need the M8 mission.**
   It is a lighting-and-dressing variant of already-shipped geometry. If PVP needs a
   second map before Wave 1 completes, Ashfall is the answer — it can ship into the
   arena roster long before the finale mission exists.
2. **The second carves are nearly free.** Deadfall, The Atrium and The Crossing are
   three additional arenas for roughly one arena's worth of work, because they are
   different rectangles of maps that already exist. Budget them explicitly rather than
   letting them fall off the end.

---

## PART 7 — THINGS THIS PLAN DOES NOT SOLVE (named, not buried)

1. **The critic ship bar applies per biome.** visual_target is explicit that any new
   environment must also pass it — every dimension ≥ 8, mean ≥ 8.5, no confident "no"
   from any of ≥2 (final: 3) cold critics. That is seven more full critic loops, each
   with its own plateau risk, and the daylight biomes are the likeliest to plateau.
   The expansion's schedule is dominated by that loop, not by geometry.
2. **Two character bodies across eight environments will read thin.** The catalogue
   currently ships `soldier.glb` + `juggernaut.glb` with tint variants. A harbour
   crew, a forest recon element, corporate security and an arctic garrison are four
   distinct silhouettes; tinting one body four ways will be noticed. This is a gated
   Meshy spend (BUILD_PLAN Part 4 register) and an owner decision, not a design one.
   Cheapest partial mitigation: per-biome **attachment** sets (helmets, packs, hoods,
   parkas) on the existing bodies rather than new bodies.
3. **The frozen 14-light pool wastes 6–8 spot slots on every daylight map.** That is an
   accepted cost. Do not "fix" it — light count is a shader-permutation key and
   changing it costs 640–900 ms of recompiles across every map, which is a far worse
   trade than parked lights.
4. **Payload at eight maps is unproven.** The ≤6 MB-to-menu and ≤+5 MB-per-mission
   budgets were sized for one map. G10 (per-map manifests + eviction) is real
   plumbing and it has no owner in the current lane matrix.
5. **PVP itself is out of scope here.** This document guarantees arena-shaped spaces
   and states their carves. Modes, spawn logic, netcode, and the question of whether
   the sim's fixed-dt deterministic core can host authoritative multiplayer are a
   separate design, and that last question is a substantial one that should be answered
   before any arena is authored *specifically* for PVP.

---

*Design sign-off: every on-disk claim in Part 0 and Part 5 traces to a file read this
session and is cited to its file and line. Every biome's cheat set is stated in terms
of the constraints this stack actually has — 1024 shadow map, no baked GI, no
SSR/TAA/GTAO, a fixed pool of 14 lights — and the three biomes that are harder than
Meridian Ward say so in their own section rather than in a footnote.*
