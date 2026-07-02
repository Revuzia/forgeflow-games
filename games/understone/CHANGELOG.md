# Understone — Changelog

## v2.0 (2026-07-02) — "Elements & Animation" (owner feedback round)
- **PixelLab asset pipeline** (`pipeline/understone_pixellab.mjs`): 106 real item icons
  (auto-derived prompts from the item registry, 32×32 RGBA) now render in hotbar,
  inventory, crafting, chests, and in the player's HAND; 10 animated characters
  (hero + 9 enemies) with walk/idle/attack/jump/dying frame sets, east-generated + mirrored.
- **Held item & swing**: selected item visibly held at rest and swung through a 160°
  overhead arc; element-tinted arc flash (Terraria-style); precise content-box scaling.
- **Elements**: fire/ice/lightning/water/shadow weapon tiers (Frostbrand, Stormblade,
  Tide Edge, Glacier/Tempest Bows + tagged vanilla molten/demonite gear), affinity cycle
  (fire>ice>lightning>water>fire, ×1.35/×0.7/×0.5-self), On Fire!/Chill debuffs,
  chain lightning proc (3 jumps, ×0.7 falloff, midpoint-displacement bolts with branches).
- **D&D roll layer**: nimble enemies dodge (≤10%, pity reroll, never bosses/hitstun) with
  gray MISS floaters; crits show golden "N!" + hit-stop + screenshake; weak/resist hits
  color-coded green/blue.
- **Particle/juice engine**: pooled SoA particles (fire/smoke/frost/mist/wisp/ember/spark/
  droplet/bubble/dust), two-pass blend batching, torch/furnace ambient flames, dig dust,
  trauma screenshake, hit-stop.
- **18 new enemies** with biome spawn tables: ghost (phases through walls), mummy, vulture,
  antlion, ice slime, ice wolf, undead viking, harpy, crab, piranha (swims), goblin scout,
  blood zombie + drippler (blood moon), cursed skull, hellbat, lava slime, demon, bone serpent.
- **Worldgen**: 1-tile "pinhole" fall-through shafts widened + near-surface cave interiors
  get dirt wall backdrops (the invisible-hole bug); biome ranges persisted to saves.
- **Visuals**: 2-layer parallax hills with atmospheric haze, grass tufts + flowers,
  stalactites, pickup name floaters, corruption grass lips.
- **UI**: SVG hearts w/ partial fill + mana stars, coin denominations with coin dots,
  selected-item name under hotbar, real icons everywhere.
- **Music**: all 8 tracks replaced with original ForgeFlow catalog instrumentals
  (day/night/underground/corruption/boss/hell/title/victory) — no overlap with other
  ForgeFlow games; lazy per-track loading; pause menu plays the title theme.
- **Perf**: lazy visible-only chunk flushing (first frame 2423ms → 69ms); boot no longer
  hangs in hidden tabs.


## v1.0 (2026-07-01 → 2026-07-02) — initial release
Built research-first: 5 parallel research agents produced decompile/wiki-verified specs
(`research/terraria/01-05` in the Claude Claw repo) before engine work began.

**Engine**
- Fixed-timestep 60 tps loop, render decoupled with interpolation; catch-up guard
- Typed-array world 2100×600 (tiles/walls u16, liquid u8); chunked offscreen-canvas renderer (32² tiles/chunk, dirty-only redraw)
- Worldgen: value-noise heightmap, TileRunner cave/ore carver, dirt→stone strata with dithered band, desert/snow/corruption strips, oceans, underworld (ash/hellstone/lava caverns + guaranteed lava sea), trees, cabins+loot chests, pots, life crystals, demon altars, hellforges, gem pockets
- Lighting: Terraria doColors() port — sky/emitter seed + 4-direction max-carry sweeps ×2; decay 0.91 air / 0.56 solid / per-channel water; cutoff 0.0185; 1px-per-tile bilinear multiply overlay
- Liquids: sparse cellular automaton (byte amounts, 10-tick cycles, lava ×6 slower, evaporation, settle-kill), water+lava→obsidian
- Day/night: 54000/32400 ticks, dawn/dusk ramps, stars/sun/moon, parallax-ready sky

**Player** (constants from decompiled 1.4.0.5 source)
- 20×42 hitbox; accel 0.08, friction 0.2 (air 0.1), skid 0.28, max run 3.0
- Velocity-pin jump (−5.01 × ≤15 ticks), gravity 0.4, terminal 10, fall damage (d−25)×10
- Old-position-side-test collision with corner tie-breaks, sub-stepping >16 px, one-way platforms with drop-through
- Water/honey position-factor integration, breath meter, lava damage, 40-tick i-frames, knockback-replaces-velocity
- Mining: 100-damage accumulator, pickPower×mult (soft ×2 / hard ×0.5), min-power gates, grass strip cycle, reach 5×4 from hitbox edges; axes fell whole trees; hammers remove player walls
- Placement with cardinal-anchor rule; torch/door/chest interactions; Magic Mirror recall

**Items & crafting**
- 90+ items: full pre-hardmode tool/weapon/armor ladder (wood→copper→iron→silver→gold→demonite→molten) with wiki-exact stats and recipe costs
- Recipe-list crafting near stations (workbench/furnace/anvil/bottle/altar/hellforge/water); 3-or-4-ore bar ratios
- Inventory 10 hotbar + 40 main + 3 armor with set bonuses; chests with seeded loot + transfer UI; drops with magnet pickup

**Combat**
- Spawn system: rates/caps by depth & time (day 1/600×5 → cavern 1/240×9, blood moon 1/108×10), off-screen ring, wall suppression, despawn timers
- AI archetypes with decompile constants: slime (hop cycles ×2 aggro), fighter (jump ladder), flyer (asymmetric seek), bat, worm (through-tile steering + segments), caster (3 casts → teleport)
- Damage floor(atk±15% − def/2), crits ×2, per-source 10-tick enemy i-frames, KB resist
- Bosses: King Slime (hop pattern, teleport when kited, shrinks + spawns slimes), Eye of Cthulhu (hover/servants/3-charge cycle, phase 2 mouth form + chain dashes, flees at dawn), Eater of Worlds (40-segment worm; shared HP pool — splitting deferred)
- Blood moon (1/9 nights >120 HP), corruption biome with Eater of Souls farming → Worm Food

**Presentation**
- Grok-generated (grok-imagine-image) seamless 16px tile textures ×22, character/enemy/boss sprites ×10, cave-wall set, parallax hills; procedural furniture sprites; ~$0.74 total generation cost
- Kenney CC0 audio: 20 SFX + 6 music tracks with context switching (day/night/underground/boss) and crossfade
- DOM HUD: hearts/mana/hotbar/money, drag-drop inventory, tooltips, crafting panel, chest panel, announcements, death screen
- Title menu (New World/Continue), pause menu (Esc), autosave every 2 min + beforeunload
- Save: RLE+base64 world snapshot in localStorage (~700 KB), full state round-trip

**QA**
- selftest.mjs: 329 assertions (registry integrity, worldgen invariants, collision cases, crafting)
- Preview-verified with real dispatched input events: run/jump/mine/place/craft/chest/save-load/boss fight

**Known v1 deviations (vs Terraria)** — flagged for v1.1:
- EoW splitting simplified to shared HP pool; accessories not equippable (no accessory slots); coins are an integer purse, not slots; wormFood recipe simplified (20 rotten chunks); NPCs/housing, wiring, hardmode out of scope
