# Siegeheart — Design Document

**Inward-defense tower defense.** The player protects a central Bastion; enemies spawn at the map
perimeter and converge along multiple winding roads. Slug `bastion-stronghold`.
(Title note: the flat title "Bastion Realms" is already taken by the outward-lane TD published
earlier today; this game ships as "Siegeheart" — rename is a one-line change.)

## Zero-duplication guarantee (goal requirement)
Checked all prior games (incl. bastion-realms v1) + F:\ libraries. This game **loads no model files
at all** — every tower, enemy, boss, bastion, prop and effect is an original composed procedural
Three.js build with hand-written materials + canvas/xAI textures. Music is **generated fresh via
Stable Audio** (8 original tracks, prompts in tools/gen_music.py). All SFX are **WebAudio-synthesized**
(no sound files). UI theme, palette, terrain style, FX colors all differ from v1
(v1: navy/gold cards, grass plains, organic GLB creatures → Stronghold: iron/parchment/crimson,
radial flagstone arenas, construct armies with glowing seams).

## Core loop
- Bastion HP **100** (the "lives"). Breaching enemy deals its `siegeDmg` (1 basic / 2 heavy / 5 boss /
  8 powder keg). Bastion **visibly degrades** through 4 damage tiers (pristine → scorched → battered →
  crumbling: cracks, smoke, fires, collapsed roofs) and heals visually when repaired.
- 2–4 roads per level converge on the central plaza. Between waves: 20s build phase (no early-send gold).
- Stars: ≥90% HP = 3★, ≥50% = 2★, win = 1★. Endless mode per world after clearing it.

## Towers (8 — all-new mechanics vs v1)
| Tower | Cost | Type | Mechanic |
|---|---|---|---|
| Ballista | 110 | phys | Heavy bolt **pierces 2/3/4 enemies in a line** |
| Arcane Spire | 240 | magic | **Homing missiles**, volley of 1/2/3, never miss |
| Oil Cauldron | 200 | fire | Lobs pots creating **burning ground zones** (dps+slow, no flying) |
| Thorn Barricade | 90 | nature | **Placed ON the road**; slows 35/45/55% + DoT on the cell; max 3/4/5 active |
| Siege Crossbow | 170 | phys | Long-range single target, **×1.5/1.75/2 dmg vs armored** |
| Holy Beacon | 220 | holy | Damage aura (half-ignores warding) + **repairs the Bastion** 0.35/0.5/0.7 HP/s when near plaza |
| Rune Trap | 80 | magic | **Placed ON the road**; AoE detonation on crossing, 6/5/4s rearm; max 3/4/5 |
| Storm Caller | 260 | magic | Chain 3/4/5 + **stun** 0.3/0.4/0.6s (bosses resist) |
3 levels each, +13% scale/level, orbiting gems L2/L3 (kept convention), distinct new silhouettes.

## Worlds (5 × 9 levels = 45)
1. **Ancient Colosseum** — sand arena, marble stands ring the map. Enemies: Bronze Legionnaire,
   Arena Hound (fast), Shield Phalanx (shielded), Laurel Wisp (fly), Chariot Runner (fast heavy).
   Boss **Colossus Aurelius** (rally-cry haste, shield wall). Hazard: arena gates release bonus squads.
2. **Gothic Castle** — night siege, rain, moonlit crags. Battering Ram (siege ×2 bastion dmg),
   Plague Swarm, Cursed Knight (armor), Gargoyle (fly+ward), Trebuchet Crawler (heavy).
   Boss **Siege Titan** (summons rams, armor plates). Hazard: lightning strike stuns a random tower.
3. **Floating Sky Citadel** — clouds below, floating rock ring. Wind Wisp (fast), Sky Skiff (fly heavy),
   Cloud Ray (fly), Zephyr Twin (**splits in two** on death), Storm Herald (ward).
   Boss **Gale Leviathan** (FLYING boss — ground-only towers useless; summons rays, wind shield).
   Hazard: tailwind gusts briefly haste all enemies.
4. **Crystal Fortress** — amethyst caverns. Shard Skitterer (swarm), Prism Golem (armor+ward),
   Light Moth (fly), Refractor (heavy ward), Geode Brute (**splits into 3 skitterers**).
   Boss **The Prime Prism** (alternating phys-immune / magic-immune phases — mixed damage required).
   Hazard: resonance zones buff tower rate but haste enemies inside.
5. **Dwarven Mountain Hold** — forge hall, lava falls. Drill Crawler (armor), **Powder Keg Runner**
   (fast detonator, 8 bastion dmg on breach), Ore Golem (heavy), Gyrocopter (fly), Forge Sentinel (elite).
   Boss **Magma Forge Engine** (segmented siege train: overdrive bursts, deploys keg runners, plate shield).
   Hazard: mine carts periodically cross the roads, damaging enemies they hit (friendly hazard).

Elite squads on every 5th wave; true bosses close levels 3/6/9 (empowered at 9).

## Enemy traits
armor / warding / flying (immune to Cauldron zones + road placeables) / fast / shielded / swarm /
**siege** (double bastion dmg) / **detonator** (huge bastion dmg, dies to a single hit) /
**splitter** (spawns children on death).

## Art direction
Construct armies: bronze automata, siege engines, storm elementals, crystal beings, forge machines —
composed multi-part procedural models with emissive seams, procedural gait animation (phased leg
rotation, spinning wheels/rotors, hover bob). Terrain: painted radial flagstone/tile canvas with
road ribbons; per-world surroundings (colosseum stands, gothic crags + moon, cloud sea + floating
rocks, crystal cavern walls, forge pillars + lava falls). xAI-generated seamless ground textures
per world + key-art thumbnail.

## Audio
Stable Audio originals: menu, 5 world themes, victory + defeat stingers (see tools/gen_music.py).
All SFX synthesized: ballista thunk, crossbow snap, arcane warble, oil splash + fire crackle,
thorn rustle, holy chime, rune detonation, storm crack, bastion-hit boom, repair shimmer,
construct death clanks (pitch by size), UI taps, build hammer, wave horn, coin chime.

## Tech
Same proven architecture as v1 (fixed-step deterministic sim + view layer + __TD_TEST__ sync hooks +
selftest greedy bot), heavily adapted: multi-road map gen, bastion entity, road placeables,
ground-zone system, piercing/homing projectiles, boss phase immunities, splitter deaths.
Balance gate: bot must clear 45/45.
