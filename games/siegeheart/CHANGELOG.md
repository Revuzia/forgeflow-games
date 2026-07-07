# Siegeheart — Changelog

## v1.2.1 — 2026-07-07
- Ballista and Siege Crossbow now fire **physical bolt projectiles** (wooden shaft, iron tip,
  red fletching, motion streak) flying along the shot line — lightning ribbons are reserved for
  the Storm Caller and the gothic sky. Pooled `DartPool` in fx.js; crits fire a gold bolt.

## v1.2 — 2026-07-07 (rename + publish)
- Renamed **Bastion Realms: Stronghold → Siegeheart** (owner request: too close to Bastion Realms).
  Slug `bastion-stronghold` → `siegeheart`; the central structure is now called **the Keep** in all
  player-facing text (code identifiers unchanged). Fresh cover art generated for the new title.
- First published release on forgeflowgames.com.

## v1.1 — 2026-07-07 (owner feedback round)
- **Real creature models**: all 30 procedural construct enemies replaced with **31 animated GLB/GLTF
  library models** (orcs, bulls, war horses, demons, skeletons, cyclops, sky sharks, wizards, robots,
  the Forge Mech STAN…), every one verified unused by prior ForgeFlow games (`tools/copy_enemies.py`).
  Skinned animation mixers with move/death clips, fuzzy clip resolution, slow/stun scaling of walk
  speed, death-clip wrecks that sink and fade. The Prime Prism stays procedural by design.
- **FX overhaul** ("real FX"): lightning is now **thick two-layer ribbon bolts** (colored glow +
  white-hot core, jagged subdivision) used by Storm Caller chains and Ballista pierce tracers;
  Arcane Spire missiles and Oil Cauldron pots pull **glowing ribbon trails** (pooled, owner-keyed);
  an animated **arcane rune circle** (double ring, tick marks, 7-point star, glyph band) rotates
  and pulses around every Bastion with 5 orbiting rune glyphs.
- **Themed spawn gates** (no more shared ring-portals, distinct per world): Colosseum stone arch
  with portcullis bars, Gothic leaning-slab crypt arch, Sky Citadel spinning wind vortex with
  orbiting rocks, Crystal Fortress flanking crystals, Dwarven timber mine portal with lamp.
  All get pulsing accent glow + crimson pennant and face down-road.
- **No road ever crosses the center**: map generator rewritten with a ring-distance termination
  rule — roads stop the moment they touch the plaza ring; pass-through/overlap is impossible
  (re-validated across all 45 maps; w3l8 seed re-salted, balance gate back to **45/45**).
- **Upgrade discoverability**: first tower build shows a "click a tower to inspect/UPGRADE" tip;
  level-select nodes now display **how many roads attack** (2 → 3 → 4 as the campaign advances).
- Credits updated with model licenses (all CC0 except "Animated Wizard" by Quaternius, CC-BY 3.0).

## v1.0 — 2026-07-06 (initial release)
- **Inward defense**: the Bastion stands at the map center; 2–4 winding roads converge on it from the
  perimeter (45 verified-unique maps). Bastion has 100 HP, takes tiered breach damage (1/2/5, kegs 8),
  and **visibly degrades through 4 damage states** (cracks → smoke → fires → crumbling + rubble),
  healing visually when repaired.
- **8 all-new towers**: Ballista (line-piercing bolts), Arcane Spire (homing volleys), Oil Cauldron
  (burning ground zones), Thorn Barricade (ON-ROAD slow+DoT, capped count), Siege Crossbow (armor-killer),
  Holy Beacon (damage aura + capped Bastion repair), Rune Trap (ON-ROAD re-arming detonations),
  Storm Caller (chain + stun). 3 levels each with scale/gem/trim progression.
- **5 worlds × 9 levels**: Ancient Colosseum (arena-stand surroundings, bonus-squad gates),
  Gothic Castle (night rain, tower-stunning lightning), Floating Sky Citadel (cloud sea, tailwinds,
  FLYING boss), Crystal Fortress (resonance zones, splitter enemies, phase-immune boss),
  Dwarven Mountain Hold (lava falls, friendly runaway mine carts, powder-keg detonators).
- **28 enemy constructs + 5 bosses**, all original procedural models with gait/rotor/hover animation:
  legionnaires, chariots, battering rams, gargoyles, sky skiffs, splitting zephyrs, prism golems,
  keg runners, forge sentinels… Bosses: Colossus Aurelius (rally + shield wall), Siege Titan (summons
  rams + plates), Gale Leviathan (flying, summons rays), The Prime Prism (alternating phys/magic
  immunity), Magma Forge Engine (overdrive + keg deployment + plating).
- **All-generated assets**: xAI ground textures + key art; procedural WebAudio soundtrack (8 original
  themes) + fully synthesized SFX; zero files reused from prior games or libraries.
- Balance: greedy-bot gate clears **45/45** levels (beacon repair capped at 5 HP/wave after the bot
  exposed an out-healing exploit; detonator/splitter wave caps; two finale maps re-rolled via seed salt;
  Prime Prism immunity windows trimmed to 3s).
- Iron-and-parchment UI, endless sieges per world, 20 achievements, localStorage saves,
  `selftest.mjs` structural/smoke/balance gate, `__TD_TEST__` sync hooks.
