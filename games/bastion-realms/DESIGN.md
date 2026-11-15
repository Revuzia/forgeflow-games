# Bastion Realms — Design Document

Tower defense in Three.js. Five realms, 45 levels, 8 towers, boss fights.
Slug: `bastion-realms`. Working title: **Bastion Realms — "Hold the line across five realms."**

## Research → mechanics adopted

| Source | Mechanic adopted |
|---|---|
| Bloons TD 6 | Upgrade depth per tower (3 levels), targeting priorities (First/Last/Strong/Close), support-tower synergy stacking rules, speed controls (1×/2×/3×), property-gated counters (our armor/warding/flying = their lead/camo/purple) |
| Kingdom Rush | Map reading: winding paths + chokepoints, armor vs magic-resist enemy split, wave preview + early-call bonus gold, boss set-pieces, per-level stars |
| Plants vs Zombies | Economy pressure early game (cheap fodder walls vs saving up), readable enemy telegraphs, distinct silhouette per unit |
| Tower Defense Simulator | Wave-scripted bosses w/ ability phases, loadout-light approach (all towers available, unlocked progressively) |

Design pillar (from the comparative research): KR is "read the map", BTD6 is "read the synergies".
Bastion Realms does both: free grid placement but strongly winding paths create natural
chokepoints; support towers + elemental counters create synergy depth.

## Core structure
- **5 biomes × 9 levels = 45 levels.** Unlock next level by beating previous; beating a biome finale unlocks the next biome + that biome's Endless mode.
- **Grid**: 20×13 cells. Unique seeded winding path per level (min length ≥ 34 cells, ≥ 6 turns). Build on any non-path, non-blocked cell.
- **Waves**: 8 (early levels) → 18 (finales). Between waves: 20s prep, early-send button pays bonus gold (remaining seconds × 2). Wave 1 starts on player command.
- **Lives** 20. Leak: −1 normal, −2 heavy/elite, −5 boss. Lose at 0. Stars: 3★ ≥18 lives, 2★ ≥10, 1★ win.
- **Speed**: 1× / 2× / 3×. Pause anytime.
- **Endless mode** per biome (post-clear): infinite generated waves, leaderboard-style best-wave stat.

## Economy
- Start gold per level (450–900 by level).
- Kill bounty per enemy type; wave completion bonus (40 + 6×waveIndex); early-call bonus.
- Sell refund 70% of total invested.

## Towers (8)
| # | Tower | Cost | Dmg type | Role | L1→L3 highlights |
|---|---|---|---|---|---|
| 1 | Bolt Tower | 100 | physical | fast single-target | fire rate up, L3 twin barrels |
| 2 | Sniper Spire | 175 | physical | long range, huge single hit | crit 20%→L3 50% ×2.5, armor-pierce L2 |
| 3 | Storm Coil | 250 | magic | chain lightning 3→6 targets, 55% falloff | L3 brief stun (0.4s), ×3 dmg vs shields |
| 4 | Ember Altar | 200 | magic | mid-range, ignite burn DoT | burn dps/duration up, L3 splash ignite |
| 5 | Frost Obelisk | 150 | magic | slow 30/40/50%, weak dmg | L3 freeze proc (1s, 10% chance, 4s cooldown/enemy) |
| 6 | Venom Bloom | 180 | nature (true) | lobbed vials, poison stacks ×3, ignores armor+warding | stack dps up, L3 death-burst cloud |
| 7 | Cannon Bastion | 220 | physical | AoE splash, shockwave | radius/dmg up, L3 double shell. **Cannot hit flying** |
| 8 | War Banner | 160 | — | support: buffs towers in radius | +15/25/35% rate, +10/20/30% dmg, +10/15/20% range. Strongest-only (no stacking) |

- Upgrades: 3 levels each, cost ≈ 80%/110% of base, distinct visual growth per level.
- Targeting: First / Last / Strong / Close per tower (not on War Banner).
- Towers are procedural composed Three.js models (multi-part: stone bases, crystals, coils, barrels, banners — never naked primitives) with generated canvas textures; each element has its own silhouette + palette + muzzle FX.

## Enemies
Traits: `armor` (physical resist %), `warding` (magic resist %), `flying` (immune to Cannon + Venom; hovers), `fast`, `swarm`, `regen`, `shield` (absorbs N hits; Storm Coil ×3 vs shields).

### Biome rosters (all real animated CC0/CC-BY GLBs from the F:\ libraries)
1. **Verdant Hollow** (forest): Goblin (fodder), Wolf (fast), Forest Spider (spits web? no — fast+swarm), Armabee (flying), Mushnub (swarm). **Boss: Mushroom King** — spore heal aura + summons Mushnubs.
2. **Cinder Wastes** (volcanic): Fire Imp/Demon (warded), Lava Slug (slow, high HP, armor), Ash Bat (flying fast), Blue Demon (elite warded). **Boss: Magma Dragon** — wing-gust speed burst + ember rain (damages a random tower's rate briefly) + landing shockwave.
3. **Frostmaw Expanse** (tundra): Ice Troll/Orc (armor), Frost Wolf (fast), Hywirl (flying), Snow Hare (swarm), Yeti Brute (heavy regen). **Boss: Frost Behemoth (giant Yeti)** — ice shield phases + blizzard (towers −25% rate while active).
4. **Sunken Ruins**: Skeleton (armor, swarm), Zombie (regen), Wraith/Ghost (flying, warded), Necromancer/Wizard (elite; periodically shields nearby). **Boss: Lich Skull** — summons skeletons + ethereal phase (physical immune windows).
5. **Astral Isles**: Glub (flying), Star Goleling (armor+warding), Void Squidle (warded), Alien Strider (fast), Evolved elites. **Boss: Astral Wyrm (Dragon Evolved)** — star shield (must be broken; lightning ×3) + short-range teleport hops + summons Glubs.

Boss waves: every 5th wave = elite squad w/ mini-boss variant; level 3/6/9 finales = true boss with abilities. Biome 9th-level boss = empowered version.

## Environmental effects/hazards per biome
1. Forest: fireflies, god-ray tint. (Tutorial biome, no hazard.)
2. Volcanic: ember particles; **lava vents** — telegraphed cell eruptions stun towers on that cell 3s (move players to spread out).
3. Tundra: falling snow, aurora sky; **blizzard gusts** — 10s global −15% tower fire rate, telegraphed banner.
4. Ruins: green fog, ghost lights; **fog banks** — marked zones where tower range −20%.
5. Astral: starfield, shooting stars, floating isles; **mana surge** — random tower +50% rate 8s (positive hazard) and **void zones** — a few unbuildable void cells.

## Audio
- Music: menu + 1 unique instrumental track per biome from F:\Music (owned Suno catalog), looped.
- SFX (Kenney CC0 packs): per-tower fire sounds, impacts, enemy deaths, build/upgrade/sell, UI clicks, wave horn, victory/defeat stingers.

## UI
Main menu → Realm select (5 cards) → Level select (9 nodes + stars + endless) → Game.
HUD: gold, lives, wave x/y, speed, pause, tower build bar (8 cards w/ costs), selected-tower panel (stats, upgrade, sell, targeting), next-wave preview chips, early-send button.
Screens: settings (music/sfx sliders, quality), pause, results (stars, kills, gold earned), achievements page, codex/bestiary (enemy traits + counters).

## Achievements (18)
first-blood, flawless (3★) any level, biome clears ×5, full 3★ biome, all 8 towers built in one level, max-upgrade each element (4), 250 burns, 200 freezes, 300 chain hits, 500 poison ticks, sell 15 towers, endless wave 25, all 45 levels.

## Save
localStorage `bastion_realms_save_v1`: per-level stars, unlocks, achievements progress, settings, endless bests.

## Tech
- three@0.172 via importmap CDN (house pattern), ES modules, no bundler.
- Fixed-step deterministic sim (60Hz) decoupled from render; `window.__TD_TEST__` exposes synchronous `fastForward(seconds)` stepping for headless playtesting (preview rAF-freeze-proof).
- Skinned enemies: GLTF + SkeletonUtils.clone, shared materials, ≤ ~40 alive.
- Particles: pooled Points/sprite systems per element; floating damage numbers as pooled canvas billboards.
- Perf per house rules: DPR ≤ 1.5, one dir light w/ 1024 shadow map.
