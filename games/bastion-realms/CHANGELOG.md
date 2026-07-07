# Bastion Realms — Changelog

## v1.4 — 2026-07-07 (continuous waves)
- **The wave clock never stops**: the next wave arrives 18s after the current wave's last spawn,
  cleared or not (early clears keep a short prep, capped by the clock). HUD icon is now a war
  horn 📯 with a live "next Xs" countdown.
- **Call waves early, mid-combat**: 📯 CALL THE NEXT WAVE is available during a wave — stack
  freely. Still no gold for early calls; each wave's bonus pays when its spawns finish.
- Balance gate unchanged at **45/45** (no retune needed — the 20-lives model absorbed the pacing).

## v1.3 — 2026-07-06 (third playtest feedback round)
- **Removed the toon rabbit** (it was a cartoon lumberjack character, not a real rabbit). Forest now has
  deer/sheep/foxes, tundra white stags/arctic foxes/snowy sheep, astral void-fish/void toads.
- **Early wave send no longer pays gold** — sending early is a pacing choice, not an income exploit.
  Economy re-verified: the balance bot still clears all 45 levels, now with visibly tighter margins.
- **Animals can never touch the road**: wander targets AND the straight line walked to them are both
  checked against the road (with bigger clearance for large animals like deer/stags), plus a hard runtime
  repulsion as a final guarantee. Verified over simulated minutes: nothing comes within a body-length of the dirt.
- **Breach damage was already tiered** (regular −1 life, heavies/elites −2, bosses −5); enemy tooltips in
  the wave preview now state exactly how many lives each type costs.
- b4l7 "The Last Bridge" and b4l3 "Voidlight Span" got re-rolled longer/fairer paths (late-biome minimum
  path length raised; per-level seed salt for targeted map fixes).
- Cache version bumped to ?v=4.

## v1.2 — 2026-07-06 (second playtest feedback round)
- **Tower bar reordered to match unlock progression**: Bolt → Frost → Cannon → Sniper → Ember → Banner → Storm → Venom (hotkeys 1-8 follow).
- **Upgrade button fixed**: the selection panel was rebuilding its DOM every frame, destroying the button
  between mouse-down and mouse-up so clicks never registered. It now only rebuilds on real state changes.
  All three panel buttons (Target/Upgrade/Sell) are now uniform full-width, and max-level towers show ★ MAX LEVEL.
- **Upgrades are visually obvious**: towers grow ~13% per level, L2 gains two orbiting silver gems,
  L3 gains three orbiting gold gems + a pulsing accent-colored ground ring (plus the existing
  iron→silver→gold trim and per-type structural growth).
- **Attack FX upgraded**: frost shards trail ice mist, venom globs drip poison, cannon shells leave smoke
  trails, bolts leave tracer sparkles; every hit now lands with an elemental impact burst.
- **Death audio**: replaced the generic blip with a synthesized creature death (pitch-dropping growl +
  body thump + breath tail, pitched by enemy size). Bosses still roar.
- **Horizon backgrounds for every biome**: a vast lower plain (forest valley, glowing lava sea, ice sheet,
  swamp murk) ringed by 22 distant peaks (snow-capped in tundra); Astral gets drifting nebulas + rock shards.
- **Ambient wildlife on every map**: per-biome critters that wander the meadows and stay off the road —
  deer/sheep/rabbits/fox (forest), snakes/ember toads/cinder crabs (volcanic), white stags/snow rabbits/
  snowy sheep (tundra), cats/snakes/toads (ruins), drifting void-fish/void toads (astral).
- **Forest variety**: autumn pines, birch clusters, large bushes; all decor now scales slightly
  non-uniformly so no two props read identical.
- **Mouse controls**: left-drag pans (click still selects/builds), right-drag orbits, middle/wheel zooms.
- Cache version bumped to ?v=3.

## v1.1 — 2026-07-06 (owner playtest feedback)
- **Start/finish clarity**: enemy spawn is now a crimson rift with dark spikes + floating "☠ ENEMIES" label;
  the exit is a proper stone keep gate (twin gold-capped towers, shimmering barrier) + "🛡 DEFEND" label.
  Animated chevrons march along the path showing enemy direction.
- **Camera**: right-drag now ORBITS (middle-drag pans, wheel zooms), R resets the view, and the camera
  resets to standard framing on every level load (no more inheriting the menu's tilted auto-rotate angle).
- **Corpses**: death animation is snappier (sink+fade fully gone in ~1.25s) and an orphan-view sweep
  guarantees no body can ever linger even if a death event is missed under heavy load.
- **Victory/defeat music**: replaced the arcade jingles with ForgeFlow catalog tracks — "Cedar Breeze"
  (warm, victory) and "Ember Midnight" (somber, defeat).
- Cache version bumped to ?v=2.

## v1.0 — 2026-07-06 (initial release)
- Full 3D tower-defense campaign: 5 biomes × 9 levels (45 unique seeded winding paths, all verified structurally distinct).
- 8 towers with 3 upgrade levels each, procedural composed models, distinct FX and roles:
  Bolt, Sniper (crit + armor pierce), Storm Coil (chain + anti-shield ×3 + L3 stun), Ember Altar (burn DoT, L3 splash ignite),
  Frost Obelisk (slow, L3 freeze), Venom Bloom (stacking true-damage poison, L3 death burst), Cannon Bastion (AoE, L3 double shell),
  War Banner (rate/damage/range auras, strongest-only).
- Targeting modes (First/Last/Strong/Close), 70% sell refund, early-call bonus gold, wave preview chips with enemy tooltips.
- 29 real animated enemy models (Quaternius UM + Poly Pizza, CC0): armored/warded/flying/regen/shield/swarm traits,
  elites every 5th wave, five bosses with abilities (heal auras, summons, wing gusts, ember rain, ice/star shields,
  blizzards, ethereal phase, rift hops).
- Biome hazards: lava vents (tower stun), blizzards (global rate penalty), grave fog (range penalty), mana surges (rate buff).
- Per-biome ambient FX (fireflies/embers/snow/ghostlights/stardust), painted terrain w/ emissive lava veins + astral runes,
  glowing crystal decor, starfield sky.
- Economy tuned via headless greedy-bot: all 45 levels beatable (bot wins 45/45; early biomes comfortable, finales tight).
- Endless mode per realm (post-clear), 19 achievements, star ratings (lives-based), localStorage saves.
- Audio: 6 original ForgeFlow instrumental tracks (menu + one per biome), Kenney SFX + synthesized elemental sounds,
  music/SFX volume settings.
- Perf: ~50 FPS with 23+ enemies + FX (DPR≤1.5, single 1024 shadow map). `selftest.mjs` = structural/smoke/balance gate.
