# Bastion Realms: Stronghold — Changelog

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
