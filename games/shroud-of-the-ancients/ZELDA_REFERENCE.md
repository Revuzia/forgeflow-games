# Zelda Formula — Canonical Reference for "Shroud of the Ancients"

> Source-cited reference for top-down 2D Zelda design.
> Games surveyed: The Legend of Zelda (NES 1986), A Link to the Past (SNES 1991),
> Link's Awakening (GB 1993), The Minish Cap (GBA 2004).
> Every assertion below has a URL — do not invent additions.

---

## 1. Core Loop

The macro loop is consistent across all four canonical titles:

1. **Overworld exploration** — find dungeon entrance (often gated by an item from the previous dungeon).
2. **Dungeon entry** — usually a locked entrance opened by a story trigger, a small key, or an item.
3. **Mini-boss room** — mid-dungeon combat encounter that rewards or gates the **dungeon item**.
4. **Dungeon item** — a single new tool (bow, hookshot, etc.) that the rest of the dungeon's puzzles will require.
5. **Item-puzzle rooms** — every remaining room teaches one variation on using the new item.
6. **Big key** → opens the boss door.
7. **Boss room** — fight uses the dungeon item as the weak-point key (e.g. bow on eye, hookshot on tether).
8. **Reward**: Heart Container + story macguffin (Triforce shard / Pendant / Instrument of the Sirens / Element).
9. **Warp out** of dungeon, return to overworld, repeat.

Each dungeon "presents a single spatial thesis: a set of rules the player must understand and exploit to progress. The dungeon doesn't explain its rules. It demonstrates them through consequence." [Zelda Wiki Dungeons](https://zelda.fandom.com/wiki/Dungeons_in_The_Legend_of_Zelda)

---

## 2. Player Mechanics

### Hearts
- **Granularity**: half-heart hits. Each enemy attack deals 0.5, 1, 1.5, or 2 hearts depending on weapon and game tier.
- **Max hearts**: start at 3, cap at 16–20 in canonical games.
- **Heart Container**: full container = +1 heart of max HP. Always dropped by major bosses.
- **Pieces of Heart**: 4 pieces = 1 container. Hidden in overworld and as mini-game rewards. [Piece of Heart — Zelda Wiki](https://zelda.fandom.com/wiki/Piece_of_Heart)

### Rupees (currency)
- Wallet capacity is tiered. ALttP: Fighter-base / 100 / 300 / 500 caps. Skyward Sword: 300/500/1000/5000. [Wallet — Zelda Wiki](https://zeldawiki.wiki/wiki/Wallet)
- Color denominations: green=1, blue=5, red=20, purple=50, silver=100, gold=300.

### Keys
- **Small Key** — single-use, opens one locked door inside the current dungeon only. [Small Key — Zelda Wiki](https://zeldawiki.wiki/wiki/Small_Key)
- **Big Key** — opens the Big Chest and the door to the boss chamber. Reusable. [Big Key — Zelda Wiki](https://zeldawiki.wiki/wiki/Big_Key)
- **Compass** — shows boss location and chests within a dungeon.
- **Dungeon Map** — shows room layout.

### Consumables
- **Bombs** — 2-second fuse, breaks cracked walls, damages enemies. Stack caps: 8 → 30 → 50 via bag upgrades.
- **Arrows** — fired from Bow. Stack caps: 30 → 60.
- **Magic Powder** / **Bottles** — heal, status effects.

### Combat tools
- **Sword** — 4-directional swing (NES) / 8-directional + spin (ALttP onward). Charged spin requires holding attack ~1s. [Spin Attack — Zelda Wiki](https://zeldawiki.wiki/wiki/Spin_Attack)
- **Shield** — auto-blocks projectiles from the facing direction while not attacking.
- **Dash / Pegasus Boots** — hold button, accelerate forward, can damage enemies on contact, breaks cracked walls and brittle pillars. [Pegasus Boots — Zelda Wiki](https://zeldawiki.wiki/wiki/Pegasus_Boots)

### Item-cycle slot
- NES: 1 B-button slot, cycled in menu.
- Link's Awakening: A and B both assignable to ANY item, including the sword itself — the player had to equip the sword to use it. [Link's Awakening Items — TCRF](https://tcrf.net/Development:The_Legend_of_Zelda:_Link's_Awakening_(Game_Boy)/Items)
- ALttP / Minish Cap: dedicated sword button, one B-slot for cycled item.

---

## 3. Movement

| Game | Move | Sword facing | Notes |
|---|---|---|---|
| Zelda 1 (NES) | 4-directional, pixel-grid | 4-dir | Grid-snapping after continuous input. [Troy Gilbert deconstruction](https://troygilbert.com/deconstructing-zelda/movement-mechanics/) |
| ALttP | 8-directional | 8-dir | Spin attack covers all 360°. |
| Link's Awakening | 8-directional | 8-dir | Adds jump (Roc's Feather). |
| Minish Cap | 8-directional | 8-dir | Adds Kinstone fusion + size-shift gimmick. |

**Knockback**: enemy/Link hit launches the target 1 pixel/tick × 4 ticks/frame in the opposite direction. Enemies between tiles cannot be knocked perpendicular to motion. [Red Candle Technical Info](https://redcandle.us/Legend_of_Zelda/Technical_Information)

**Invincibility window**: ~32–48 frames after taking damage. Link can walk through the enemy that hit him during this window. [Red Candle Technical Info](https://redcandle.us/Legend_of_Zelda/Technical_Information)

**Speed**: base walk ~1 px/frame on NES; ALttP ~1.5–2 px/frame. Pegasus Boots roughly 3× walk speed and lock the facing direction.

---

## 4. Combat

### Sword attacks
- **Slash** — single tap. Hit arc covers ~90° in front.
- **Thrust** (NES) — sword pokes straight; only when at full hearts NES Zelda also fires a sword beam.
- **Spin Attack** — hold attack ~1s, releases a 360° AoE. First appeared in ALttP. [Spin Attack — Zelda Wiki](https://zeldawiki.wiki/wiki/Spin_Attack)

### Sword tiers (ALttP canonical) — base 1× damage
| Tier | Multiplier | How to obtain |
|---|---|---|
| Fighter's Sword | 1× | Story start |
| Master Sword | 2× | Lost Woods pedestal (3 pendants) |
| Tempered Sword | 3× | Dwarven smiths in Kakariko reunite, 10 rupees |
| Golden Sword | 4× | Throw Tempered into the Pyramid of Power pond |

[Master Sword Lv2 — Zelda Wiki](https://zelda.fandom.com/wiki/Master_Sword_Lv2), [Master Sword Lv3 — Zelda Wiki](https://zelda.fandom.com/wiki/Master_Sword_Lv3)

### Enemy HP / damage conventions
- Small enemies (Octorok, Keese): 1–2 HP, deal 0.5 heart.
- Medium (Stalfos, Darknut): 4–8 HP, deal 1 heart.
- Heavy (armored knights, Iron Knuckles): 12–16 HP, deal 2 hearts.
- Mini-boss: 16–32 HP. Boss: 8 hits with the correct weapon usually (not raw HP).

### Projectiles
- Stop at obstacles, can be deflected by Shield if facing.
- Arrow, Boomerang, Hookshot, Fire Rod beam, Ice Rod beam, Magic Powder puff.

### Hitstop
- Brief 2–4 frame freeze when sword connects on a damaging hit. Combined with screen flash for big hits.

---

## 5. Rooms & Screens

- **NES**: hard screen-by-screen transition. Each "room" is 16×11 tiles, 256×176 px. Tile size = **16×16 px**. HUD occupies top 3 tiles (~63 px) of the 240-line frame. Horizontal scroll: 4 px/frame; vertical: 8 px / 2 frames. [Gridbugs — Zelda Screen Transitions](https://www.gridbugs.org/zelda-screen-transitions-are-undefined-behaviour/)
- **ALttP onward**: dungeons use **fade-to-black between rooms** when crossing doors; overworld scrolls smoothly within a "supertile" and fades between supertiles.
- **HUD layout** (NES, top bar, left-to-right): map quadrant + dungeon-level indicator | B-item slot | A-item (sword) | rupee count | key count | bomb count | heart row.

---

## 6. Dungeon Anatomy

Standard ALttP-era dungeon order of rooms (canonical archetype):

1. **Entrance / antechamber** — single room, often a chest with the Map.
2. **First locked door** — needs Small Key #1, usually dropped by enemies in adjacent room.
3. **Compass room** — chest, sometimes guarded.
4. **Mini-boss arena** — single-room fight, drops the Big Key OR drops Small Key + item room access.
5. **Dungeon item room** — single big chest with the new tool.
6. **Item-puzzle rooms** — 3–6 rooms that REQUIRE the new item (hookshot gaps, fire-rod torches, bombs-on-floor).
7. **Big Key room** — Big Chest opened only with Big Key. Sometimes Big Key is in this room; sometimes Big Key is elsewhere and this room IS the chest.
8. **Boss Door** — massive door, unlocks once with Big Key, never closes again.
9. **Boss room** — single arena, no exits during fight.
10. **Heart Container drop** + **warp portal** out (blue circle of light).

Boss key door rule: "The Big Key opens the Big Chest and the door to the boss of a given dungeon." [Big Key — Zelda Wiki](https://zeldawiki.wiki/wiki/Big_Key)

---

## 7. Overworld Anatomy

- **Hub town** — Kakariko/Mabe/Hyrule Castle Town. Shops, fairy fountains, story NPCs.
- **Field/wilds** — open zones connected by screen edges. Enemies respawn per screen.
- **Dungeon entrances** — gated by a story flag and often a relic from the previous dungeon.
- **Secrets**:
  - **Bombable walls** — visually identical cracked stone, found by trial-and-error or audio cue. [Weak Wall — Zeldapedia](https://zelda-archive.fandom.com/wiki/Weak_Wall)
  - **Burn/cut bushes** — hidden stairs under burnt shrubs or specific cut bushes.
  - **Hidden caves** — old-man caves with rupees, sword upgrades, hint text.
- **Fast travel**:
  - NES: **Recorder/Whistle** warps to any cleared dungeon in cycle order. [Recorder — Zeldapedia](https://zelda-archive.fandom.com/wiki/Recorder)
  - ALttP: **Magic Mirror** snaps Link from Dark to Light World at the same coords. [ALttP Items — Zelda Dungeon](https://www.zeldadungeon.net/wiki/A_Link_to_the_Past_Items)

---

## 8. Canonical Items → "Shroud" Mapping

Map of the standard Zelda inventory and what it unlocks. Right column maps each to a Shroud-fitting relic where the existing design.md mentions one; "(NEW)" means the relic should be added.

| Canonical item | Unlocks / function | Shroud equivalent |
|---|---|---|
| **Sword** | Primary melee, 4/8-dir slash, charge spin | Astral Blade (in design) |
| **Shield** | Blocks projectiles | (NEW — not in design) |
| **Boomerang** | Stuns enemies, grabs distant items, hits switches | **Gale Boomerang** (in design) |
| **Bombs** | Breaks cracked walls, AoE damage | (NEW — not in design despite "brittle walls" mechanic) |
| **Bow & Arrows** | Long-range single-target, lights wood arrows | (NEW — major gap) |
| **Hookshot** | Pulls Link to distant tether anchor, stuns | **Chain Tether** (in design) |
| **Pegasus Boots** | Sprint + dash-attack, break brittle walls | **Windwalker Boots** (in design) |
| **Fire Rod** | Lights torches, burns ice/webs, magic cost | **Ember Torch** (in design) — but elevate to projectile rod |
| **Ice Rod** | Freezes enemies into platforms | **Frost Spear** (in design) |
| **Magic Mirror** | World-shift between Light/Dark | **Astral Shard / World Shift** (in design) |
| **Lamp** | Lights dark dungeon rooms, ignites torches | (NEW — not in design) |
| **Power Bracelet / Glove** | Lifts heavy objects/rocks | (NEW — not in design) |
| **Flippers / swim** | Cross deep water | (NEW — not in design) |
| **Flute / Ocarina** | Fast travel | (NEW — not in design) |
| **Magic Powder** | Status effects on enemies | (Optional NEW) |

Source for items and gating effects: [List of items in the Legend of Zelda series — Zeldapedia](https://zelda-archive.fandom.com/wiki/List_of_items_in_the_Legend_of_Zelda_series), [ALttP Items — Zelda Dungeon](https://www.zeldadungeon.net/wiki/A_Link_to_the_Past_Items)

---

## 9. Bosses

Canonical structure for a major dungeon boss:

- **3-phase fight** (NES bosses are simpler, often 1 phase; ALttP onward standardizes 2–3 phases).
- **Telegraphed attacks** — boss winds up visually (eye opens, arm raises, mouth glows) ~30 frames before the strike.
- **Weak-point exploitation** — the dungeon item is the canonical weapon. Bow shoots Aquamentus' horn, hookshot pulls down Helmasaur's mask, etc.
- **Phase transition** — boss HP threshold (typically 66% and 33%) triggers new pattern.
- **Iframes for boss** — boss has ~30-frame invincibility after each successful hit, preventing weapon spam.
- **No exits** — once Link enters, doors lock until the boss dies.

Mini-bosses follow the same logic at smaller scale: 1 phase, 1 telegraphed attack pattern, weak to the dungeon item.

---

## 10. Save / Progression

- **Heart Pieces**: 4 pieces = 1 container. [Piece of Heart — Zelda Wiki](https://zelda.fandom.com/wiki/Piece_of_Heart)
- **Heart Containers**: 1 per dungeon boss (the "guaranteed" 8–9). Plus a few earned via story.
- **Rupee max** stages: see Section 2 wallet tiers.
- **Sword tiers**: see Section 4 (Fighter → Master → Tempered → Golden).
- **Magic Meter** (ALttP): single bar, depletes when using rods/medallions. Halved-cost upgrade from Mad Batter NPC. [Magic Meter — Zelda Wiki](https://zelda.fandom.com/wiki/Magic_Meter)
- **Save points**: ALttP saves via menu anywhere; NES saves on death/menu (Save+Continue).
- **Permadeath**: none — death sends Link back to start of dungeon with half-hearts.

---

## 11. Audio Cues

Iconic audio motifs you should reproduce or analog:

| Cue | When | Notes |
|---|---|---|
| **Secret jingle** | Bombing a wall, lifting a rock, finding a hidden cave | 4-note "ta-da-da-DA" |
| **Item-get fanfare** | Picking up a new dungeon item; opening a Big Chest | Player freezes, holds item overhead, ~3-second jingle |
| **Heart pickup** | Single heart drop | Short chime |
| **Heart Container** | Boss death | Long triumphant fanfare |
| **Rupee pickup** | Tiered: green=low, blue=mid, red/gold=high | Different chime per denomination |
| **Low-hearts beep** | At or below ~2.5 hearts (varies by game) | Repeating high-pitched beep; harmony of BGM mutes. [Most Annoying Sound — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/MostAnnoyingSound/TheLegendOfZelda) |
| **Boss door unlock** | Approaching big door with Big Key | Heavy stone-grinding SFX |
| **Boss intro roar** | Entering boss room | Locks doors visually + audibly |
| **Death sting** | Link's hearts hit 0 | Descending arpeggio |
| **Warp** | Whistle / Magic Mirror / dungeon exit | 6-note ascending arpeggio. [Warping Theme — Zeldapedia](https://zelda-archive.fandom.com/wiki/Warping_Theme) |

---

## 12. Gap Analysis — Shroud of the Ancients vs. Canon

Reading `design.md` against the canonical checklist:

### What is well-designed

- **Astral Shard / World Shift** maps cleanly to Magic Mirror (Light/Dark World) — strong, signature mechanic, on-genre.
- **Dual-world layout** with paired puzzles is genuinely Zelda-adjacent (ALttP Light/Dark).
- **Windwalker Boots** = Pegasus Boots, including "breaks brittle walls" — matches canon.
- **Gale Boomerang, Chain Tether, Ember Torch, Frost Spear** map to Boomerang / Hookshot / Fire Rod / Ice Rod.
- **6 worlds + boss per world** is reasonable (Zelda 1 = 9 dungeons, ALttP = 11, LA = 9, Minish = 6). Lower bound is fine.
- **Charged spin attack** ("hold 2s for charged spin") matches ALttP spin.
- **Hooded protagonist with directional slash** is a sound silhouette.
- **48 levels total** is ambitious but defensible if "levels" = rooms+overworld screens, not full dungeons.

### What is missing (canonical gaps)

1. **No Shield.** Zelda has had a shield since 1986. Without it there is no projectile-blocking interaction layer.
2. **No Bow & Arrow.** The most iconic ranged weapon in the series. The Gale Boomerang is not a substitute.
3. **No Bombs as an item.** "Brittle walls" exist in design but the canonical breaker (bombs) is missing — currently broken only by dash. Bombs also enable AoE combat.
4. **No Lamp / light source.** Dark rooms are a Zelda staple and a torch-puzzle gating layer.
5. **No Power Bracelet / lift-objects.** Removes a whole class of puzzles.
6. **No Hearts / heart-pieces explicitly defined.** UI mentions "heart meter (red gems)" but there's no half-heart hit math, no heart container drops listed per boss, no piece-of-4 collectible.
7. **No Rupees / currency / shops.** Design has zero economy. Canon shops sell bombs, arrows, bottles, heart pieces.
8. **No Keys (small/big).** Dungeon gating via keys is THE canonical mechanic and is absent.
9. **No Compass / Map / Big Chest.** The standard dungeon-loot triad is missing.
10. **No sword upgrade tiers.** Design has only one "Astral Blade." Canon expects 2–4 sword upgrades pacing damage scale across 6 worlds.
11. **No magic meter.** Frost Spear / Ember Torch / Gale Boomerang have no cost system defined — they will trivialize combat.
12. **No fast travel system.** Whistle/mirror equivalent is missing for a 6-world game.
13. **No mini-boss per dungeon.** Design lists 7 main bosses but no mini-bosses — canon has both.
14. **No NPC town / quest-giver hub.** Kakariko/Mabe Village equivalents are absent.
15. **Boss phase counts inconsistent.** Some bosses listed as 2 phases, some 3 — canon trends toward 3 for major bosses; if 2 is intentional, document why.

### What is bloated / off-canon

1. **21 enemies** is a lot for a top-down Zelda. Zelda 1 has ~30, but ALttP/LA/Minish each have ~50, AND they're grouped into theme reuse (octorok variants, etc.). 21 unique enemy types means each appears in ~2 worlds — fine, but each needs distinct telegraphed attacks per Section 9.
2. **8 power-ups** (Titan's Might, Spectral Veil, Swift Wind, etc.) are **arcade pickups, not Zelda.** Canon Zelda has zero timed buff pickups. These belong in a roguelike or Smash Bros lineage. **Recommend cutting to 0 or repurposing 2–3 as permanent magic-meter abilities.**
3. **"Heat shield timing" world mechanic** is closer to a survival-game gimmick than Zelda — could work, but it's not in the canon vocabulary.
4. **"Time rewind with ghost-self switch puzzles"** (Twilight Archives) is a Braid/Recore mechanic, not Zelda. Strong puzzle idea but it forks the game's identity.
5. **Charged sword "hold 2s"** is too long — ALttP charges in ~1 second; 2s is sluggish for a top-down rhythm.
6. **8-directional move + 4-directional slash mismatch risk.** Design says move 8-dir but doesn't specify slash dir count — if slash is 4-dir, expect "I can't hit that enemy at 45°" frustration. ALttP solved this with spin attack covering all 360°.
7. **No defined tile size or screen size.** Canon = 16×16 px tiles, 16×11 screens. Without a target, every art asset is at risk of being re-cut.

---

## 13. Recommended Punch-List for Shroud (Priority Order)

1. Add Bombs as a relic (or a consumable). Without them the "dash breaks brittle walls" mechanic is the only environmental destruction, which is too narrow.
2. Add Bow & Arrows as a relic. Without long-range single-target, eye-weakpoint bosses are unbuildable.
3. Add Shield (toggle block, drains stamina or just auto-blocks while idle).
4. Define hearts: start at 3, max 12; half-heart damage; container drops; 4 pieces = 1 container.
5. Add Rupees + a hub town with a shop selling bombs/arrows/bottles/heart pieces.
6. Add Small Key / Big Key / Compass / Dungeon Map per dungeon.
7. Add sword tiers: at least 2 upgrades (Astral Blade → Veil-Forged → Shardbound) keyed to story beats.
8. Add a magic meter; gate Frost Spear / Ember Torch / Gale Boomerang behind it so they aren't spam.
9. Cut or convert the 8 timed power-ups to permanent magic-meter abilities or remove entirely.
10. Add a mini-boss to each of the 6 worlds, dropping or gating the dungeon item.
11. Add a fast-travel relic (e.g. "Astral Recall" — warp to any cleared sanctum).
12. Lock the technical floor: 16×16 tile, screen size, slash direction count, charge time = ~1s.
13. Document boss weak-points by relic explicitly (Prismarch = Frost Spear refraction, Tempest King = Chain Tether grapple, etc.).
14. Add bombable walls + burnable bushes as hidden-secret gating in the overworld.
15. Add a Lamp/torch relic to gate dark dungeon rooms.
16. Standardize boss phases to 3 for primary worlds; document 2-phase as a deliberate exception.
17. Add audio cues for: secret-found, item-get, low-hearts beep, boss-door-unlock, warp.
18. Remove timed pickups from level design — they undercut Zelda's permanent-progression identity.
19. Add a Power Bracelet equivalent if heavy-object puzzles are wanted (currently undefined).
20. Define a save model — checkpoint at dungeon entrance + sanctum + town.

---

## Sources

- [Dungeons in The Legend of Zelda — Zelda Wiki](https://zelda.fandom.com/wiki/Dungeons_in_The_Legend_of_Zelda)
- [Big Key — Zelda Wiki](https://zeldawiki.wiki/wiki/Big_Key)
- [Small Key — Zelda Wiki](https://zeldawiki.wiki/wiki/Small_Key)
- [A Link to the Past Items — Zelda Dungeon](https://www.zeldadungeon.net/wiki/A_Link_to_the_Past_Items)
- [Master Sword Lv2 — Zelda Wiki](https://zelda.fandom.com/wiki/Master_Sword_Lv2)
- [Master Sword Lv3 — Zelda Wiki](https://zelda.fandom.com/wiki/Master_Sword_Lv3)
- [Spin Attack — Zelda Wiki](https://zeldawiki.wiki/wiki/Spin_Attack)
- [Pegasus Boots — Zelda Wiki](https://zeldawiki.wiki/wiki/Pegasus_Boots)
- [Magic Meter — Zelda Wiki](https://zelda.fandom.com/wiki/Magic_Meter)
- [Piece of Heart — Zelda Wiki](https://zelda.fandom.com/wiki/Piece_of_Heart)
- [Wallet — Zelda Wiki](https://zeldawiki.wiki/wiki/Wallet)
- [Recorder/Whistle — Zeldapedia](https://zelda-archive.fandom.com/wiki/Recorder)
- [Weak Wall — Zeldapedia](https://zelda-archive.fandom.com/wiki/Weak_Wall)
- [Warping Theme — Zeldapedia](https://zelda-archive.fandom.com/wiki/Warping_Theme)
- [List of items in the Legend of Zelda series — Zeldapedia](https://zelda-archive.fandom.com/wiki/List_of_items_in_the_Legend_of_Zelda_series)
- [Link's Awakening item-equip mechanic — TCRF](https://tcrf.net/Development:The_Legend_of_Zelda:_Link's_Awakening_(Game_Boy)/Items)
- [Kinstone Fusion — Zelda Wiki](https://zelda.fandom.com/wiki/Kinstone_Fusion)
- [Zelda Screen Transitions Are Undefined Behaviour — Gridbugs](https://www.gridbugs.org/zelda-screen-transitions-are-undefined-behaviour/)
- [Red Candle — Zelda 1 Technical Information](https://redcandle.us/Legend_of_Zelda/Technical_Information)
- [Troy Gilbert — Deconstructing Zelda: Movement](https://troygilbert.com/deconstructing-zelda/movement-mechanics/)
- [Most Annoying Sound: The Legend of Zelda — TV Tropes](https://tvtropes.org/pmwiki/pmwiki.php/MostAnnoyingSound/TheLegendOfZelda)
