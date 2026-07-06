# Bastion Realms — Changelog

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
