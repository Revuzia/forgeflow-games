# R11: Protected-Names Registry (the deny-list Vale content is checked against)

Prepared for: VALE (Forgeflow Games), an original browser lane-brawler
Research date: 2026-10-07
Status: reference research plus a machine-readable deliverable. The companion file is `_design/research/protected_names.json`, which `tools/names_check.ts` reads (CONTRACT section 0 "Originality" and section 3.4).

> **How this was built (read first).** This run had **no web searches available**: the shared search budget was already spent when this note started, so not one search was run for it. Direct fetches of Riot's own Data Dragon host were blocked by the egress proxy as well. I did not fall back on memory for the rosters. Instead I pulled the **primary game-data files** from reachable mirrors and package registries and parsed them locally:
> - Riot **Data Dragon 16.20.1** (champions, titles, abilities, items, runes, summoner spells, maps), taken from a GitHub mirror that pushed that patch on 7 October 2026 [1][2][3][4][5][6][7], plus Riot's static constants for maps, queues and game modes [8][9][10].
> - **dotaconstants**, the OpenDota project's extract of Valve's game files, for Dota 2 heroes, items, abilities, facets and modes [14][15]. I checked it against SteamDB's tracking repo of the **Dota 2 build dated 6 October 2026** [16].
> - Heroes of the Storm and Deadlock data from public data repos [17][18][19]. Two further npm packages were used as cross-checks [11][12][13].
>
> Facts about 2025-2026 modes and objectives come from sources that sibling notes R01 and R02 confirmed through search earlier in this run, and are cited to those URLs. Anything that came from my own memory, with no data file or confirmed source behind it, is marked **[unverified]**. That covers most of section 5 (other MOBAs), the lore and skin-line extras, and a list of iconic removed LoL items.

---

## 0. Summary

- **Deliverable:** `protected_names.json` holds **3,590 whole-word deny entries** in 21 categories, plus **827 exact-name-only entries** for ordinary English words that some reference game uses as a proper name. Section 1 explains the two tiers.
- **Rosters, verified from data:**
  - **League of Legends: 173 champions.** Data Dragon 16.20.1 [2] and a third-party registry pinned to patch 16.18 [11] agree exactly. The newest names in the data are Ambessa, Mel, Yunara, Zaahen and Locke. Their release dates are [unverified].
  - **Dota 2: 127 heroes.** dotaconstants (patch 7.41 data) [14] and the default item-build files in the 6 October 2026 game build [16] agree exactly. The newest are Kez and Largo; Largo joined Captains Mode in 7.40c [40]. No 2026 hero shows up in the October build.
- **Biggest decisions:**
  1. **"Rift" is denied as a word.** Vale's spec currently uses "Rift" as a mode and map codename (CONTRACT section 2, "Teams: Rift/Bridge…"). Its player-facing name must change. Section 6 gives the reasons.
  2. **"Radiant", "Dire", "Nexus", "Rune(s)", "Summoner", "Baron", "Aegis", "Flash" and "Smite"** are also denied as whole words, even though most are ordinary English.
  3. **"Champion", "Ancient", "Herald", "Arena", "Honor" and about 20 similar words are exact-name-only.** Vale may use them inside a longer name, but never as the whole name of the matching thing.
  4. **"Minion", "creep", "hero", "lane", "jungle", "tower", "ward", "gold" and "boots" are allowed.** They are shared genre vocabulary, not anyone's coined proper noun.

---

## 1. How the list is meant to be matched

The contract specifies a "case-insensitive whole-word match" on names, titles, item names, map names, objective names and mode/queue names (CONTRACT section 3.4). A whole-word match on a word like "Boots", "Heal" or "Arena" would block half of any MOBA's item and ability names. So the JSON uses two tiers:

| JSON key | Match rule | Example entries | Example effect |
|---|---|---|---|
| `categories.*` | **Whole word or whole phrase, anywhere in a Vale name.** Word boundaries are non-alphanumeric characters, so "Lion" also matches "Lion's". | Axe, Talon, Nexus, Rift, Shadow Step, Double Damage | "Iron Axe" fails (Dota hero Axe). "The Rift" fails. "Shadow Step" fails (an ability name in both games). |
| `exact_only.*` | **Only when the whole Vale name equals the entry**, after normalization and after dropping a leading "the". | Boots, Heal, Arena, Champion, Herald, Ancient | "Arena" fails. "Ashen Arena" passes. "Champion" fails. "Champion's Crest" passes. "The Herald" fails. |

**Normalization (both sides):** NFKD with diacritics stripped, curly apostrophes made straight, lowercase, spaces collapsed. Then run a **second pass with every non-alphanumeric character removed**, which catches "Kai Sa" and "Kaisa" against "Kai'Sa". The `policy` block in the JSON says the same thing in machine-readable form.

**Behaviour seen on test names** (I ran a reference matcher over the final JSON):

| Vale-style name | Result | Why |
|---|---|---|
| Ember Boots | pass | "Boots" is exact-only |
| Healing Rain | pass | "Healing" is not "Heal" |
| Iron Axe | **fail** | Dota hero "Axe" |
| Aurora Skies | **fail** | LoL champion "Aurora" |
| Flash Freeze | **fail** | "Flash" is a signature word |
| Radiant Bloom | **fail** | Dota team name "Radiant" |
| Rune Circle | **fail** | "Rune" is a system name in both games |
| Season VI | **fail** | LoL champion "Vi" (write "Season 6") |
| Black Hole, Shadow Step | **fail** | ability names in the reference games |
| Bridge, Fray, Ward, Minion | pass | generic |
| Arena | **fail** | exact match to the LoL mode name |
| Ashen Arena | pass | "Arena" is exact-only |

**Scope:** ids (`rift_standard`, `item_ember_boots`) are code vocabulary, not names. They should not be checked, and a regex word boundary would not fire inside them anyway, because `_` counts as a word character.

**How the exact-only tier was decided (reproducible rule):**
- **Full rosters are always whole-word.** That means every LoL champion and every Dota hero, with no exceptions, because a Vale fighter sharing a word with either roster is the core thing to prevent.
- **Any other single-word entry that is an ordinary English word goes to `exact_only`.** "Ordinary" means it appears in the SCOWL common-word lists, sizes 10 to 50 [20]. Examples: "Zeal", "Eclipse", "Cloak", "Butterfly", "Heal".
- **Multi-word names and coined words stay whole-word.** Examples: "Thornmail", "Hexdrinker", "Mekansm".
- **Hand overrides go both ways.** A short list of genre-signature words stays whole-word even though they are ordinary English (section 6). Another short list of generic gaming words that SCOWL does not contain goes to exact-only (for example "Backstab", "Chainmail", "Headshot", "Phylactery").

---

## 2. Sources and freshness

| Dataset | Version / date | Used for |
|---|---|---|
| Data Dragon mirror (InFinity54/LoL_DDragon) | 16.20.1 / "26.20", pushed 7 Oct 2026 [1] | LoL champions and titles [2], abilities [3], items [4], runes [5], summoner spells [6], maps [7] |
| Riot static constants (same mirror) | current [8][9][10] | LoL map names, 99 queue descriptions, 22 game-mode codes |
| @lol-inspector/league-commons (npm) | patch 16.18, published 10 Sep 2026 [11] | Cross-check: same 173 champions |
| twisted (npm) | 1.83.0 [12] | Cross-check of LoL game-mode names |
| @magicwenli/league-fan-assets (npm) | 15.24.1 snapshot, Dec 2025 [13] | Skin-line and event names (ward-skin sets, icon sets) |
| odota/dotaconstants | latest patch entry 7.41, dated 24 Mar 2026 [14]; npm 10.8.0 on 25 Mar 2026 [15] | Dota heroes, items, neutral items, enhancements, abilities, facets, mode ids |
| SteamDatabase GameTracking-Dota2 | game build "VersionDate Oct 06 2026" [16] | Cross-check: 127 hero item-build files |
| heroespatchnotes/heroes-talents | last commit Nov 2023 [17] | 90 Heroes of the Storm heroes |
| hots-parser (npm) | [18] | 15 Heroes of the Storm map names |
| SteamDatabase GameTracking-Deadlock | 7 Oct 2026 build [19] | Deadlock hero **codenames** only (display names are [unverified]) |
| wordlist-english (SCOWL) | [20] | The common-word test that decides exact-only |

Dota 2's numbered patch is still 7.41, which shipped on 24 March 2026 [14]. Lettered follow-ups ran through September 2026, and 7.41e landed ahead of The International 2026 [41][42].

---

## 3. League of Legends

### 3.1 Champions: 173 (category `lol_champions`, 178 entries)
The 173 names come straight from Data Dragon 16.20.1 [2]. Five component names are added so that partial reuse is caught too: Nunu, Willump, Mundo, Jarvan and Renata. Spellings without apostrophes (Kaisa, Khazix, Velkoz and so on) are in `spelling_variants`. Full roster:

Aatrox, Ahri, Akali, Akshan, Alistar, Ambessa, Amumu, Anivia, Annie, Aphelios, Ashe, Aurelion Sol, Aurora, Azir, Bard, Bel'Veth, Blitzcrank, Brand, Braum, Briar, Caitlyn, Camille, Cassiopeia, Cho'Gath, Corki, Darius, Diana, Dr. Mundo, Draven, Ekko, Elise, Evelynn, Ezreal, Fiddlesticks, Fiora, Fizz, Galio, Gangplank, Garen, Gnar, Gragas, Graves, Gwen, Hecarim, Heimerdinger, Hwei, Illaoi, Irelia, Ivern, Janna, Jarvan IV, Jax, Jayce, Jhin, Jinx, K'Sante, Kai'Sa, Kalista, Karma, Karthus, Kassadin, Katarina, Kayle, Kayn, Kennen, Kha'Zix, Kindred, Kled, Kog'Maw, LeBlanc, Lee Sin, Leona, Lillia, Lissandra, Locke, Lucian, Lulu, Lux, Malphite, Malzahar, Maokai, Master Yi, Mel, Milio, Miss Fortune, Mordekaiser, Morgana, Naafiri, Nami, Nasus, Nautilus, Neeko, Nidalee, Nilah, Nocturne, Nunu & Willump, Olaf, Orianna, Ornn, Pantheon, Poppy, Pyke, Qiyana, Quinn, Rakan, Rammus, Rek'Sai, Rell, Renata Glasc, Renekton, Rengar, Riven, Rumble, Ryze, Samira, Sejuani, Senna, Seraphine, Sett, Shaco, Shen, Shyvana, Singed, Sion, Sivir, Skarner, Smolder, Sona, Soraka, Swain, Sylas, Syndra, Tahm Kench, Taliyah, Talon, Taric, Teemo, Thresh, Tristana, Trundle, Tryndamere, Twisted Fate, Twitch, Udyr, Urgot, Varus, Vayne, Veigar, Vel'Koz, Vex, Vi, Viego, Viktor, Vladimir, Volibear, Warwick, Wukong, Xayah, Xerath, Xin Zhao, Yasuo, Yone, Yorick, Yunara, Yuumi, Zaahen, Zac, Zed, Zeri, Ziggs, Zilean, Zoe, Zyra.

- **Newest entries:** Ambessa ("Matriarch of War"), Mel ("the Soul's Reflection"), Yunara ("the Unbroken Faith"), Zaahen ("The Unsundered") and Locke ("the Ashen Exorcist") are all in the 16.20.1 data [2]. Their exact release patches are [unverified].
- **No champion appears to have been added in 16.19 or 16.20,** because the 16.18-pinned registry lists the identical 173 [11].
- **Caveat:** Data Dragon sometimes carries a champion a patch before release. If a 174th champion was announced in early October 2026, it would be missing here. Re-run the build at each Vale content milestone.

### 3.2 Champion titles (`lol_champion_titles`, 152 + 21 exact-only)
Each champion has an epithet [2], and the contract checks Vale *titles* too. Leading "the" is dropped and the phrase is matched: "Nine-Tailed Fox", "Darkin Blade", "Sad Mummy", "Card Master", "Blade's Shadow", "Grand Duelist" and so on. Coined one-word titles stay whole-word (Armordillo, Chronokeeper, Cryophoenix, Deathsinger, Gloomist, Pridestalker, Stoneweaver, Tidecaller, Voidreaver, Unsundered). Generic ones are exact-only: Boss, Exile, Fallen, Rebel, Outlaw, Colossus, Berserker, Minotaur and others.

### 3.3 Maps and modes (`lol_maps_modes`, 70 + 10 exact-only)
- **Maps** from the constants file [8] and map.json [7]: Summoner's Rift, Howling Abyss, Twisted Treeline, (The) Crystal Scar, Butcher's Bridge, (The) Proving Grounds, Valoran City Park, Substructure 43, Cosmic Ruins, Crash Site, Nexus Blitz, Rings of Wrath (the Arena map) and The Bandlewood. "Convergence" is exact-only.
- **ARAM map rotation:** since mid-2025 ARAM randomly assigns one of three single-lane maps, and Butcher's Bridge has returned to that pool [38]. "Bridge of Progress" is included from memory [unverified].
- **Modes and queues** from the queue and mode constants [9][10] plus 2025-2026 sources: ARAM, URF, ARURF, One for All, Nexus Blitz, Nexus Siege, Ultimate Spellbook, Swiftplay [32], ARAM: Mayhem [33], Arena [34], Brawl [35], League Classic [36], Ranked 5s [37], Ranked Solo/Duo, Ranked Flex, Normal Draft, Draft Pick, Blind Pick, Quickplay, Co-op vs AI, Doom Bots, Hexakill, Snowdown Showdown, Legend of the Poro King, Black Market Brawlers, Definitely Not Dominion, Blood Hunt Assassin, Dark Star: Singularity, Star Guardian Invasion, PROJECT: Hunters, Odyssey: Extraction, Operation: Anima Squad, Practice Tool [30][31].
- **Exact-only:** Arena, Brawl, Clash, Swarm, Arcade, Ascension, Dominion, Nemesis, Tutorial and Convergence.

### 3.4 Objectives and structures (`lol_objectives_structures`, 93 + 2 exact-only)
- **Structures:** Nexus, Nexus Turret, Inhibitor, Inhibitor Turret, Turret Plating.
- **Lane units:** Super, Siege, Cannon and Caster Minion.
- **Epic monsters:**
  - Baron Nashor, "Baron", Hand of Baron, Rift Herald, Eye of the Herald, Voidgrubs and Voidmites, Elder Dragon, and Dragon Soul [24][25].
  - The six drake elements as Drake, Rift and Soul phrases (Infernal, Ocean, Mountain, Cloud, Hextech, Chemtech). Their 2026 count is [unverified].
  - Atakhan (Ruinous and Voracious variants), Blood Rose and Feats of Strength. These were **removed for 2026** [21][22][23] but stay protected.
- **Jungle camps:** Blue Sentinel, Red Brambleback, Gromp, Krug and Ancient Krug, Crimson Raptor and Raptors, (Greater) Murk Wolf, Scuttle Crab and Rift Scuttler.
- **Jungle pets:** Gustwalker Hatchling, Mosstomper Seedling and Scorchclaw Pup. These live in `lol_items`, because Data Dragon stores them as items [4][27].
- **2026 systems:** Faelights [26], Crystalline Overgrowth [43] and Role Quest(s) [29].
- **Vision and plants:** Stealth Ward, Control Ward, Oracle Lens, Farsight Alteration, Honeyfruit, Scryer's Bloom, Blast Cone. The ward and lens names come from the item data [4][28]. The three plant names and the old Twisted Treeline boss Vilemaw are [unverified].
- **The Poro mascot.**
- **Exact-only:** "Drake" and "Herald".

### 3.5 Items (`lol_items`, 491 + 39 exact-only)
- **What was taken:** every named entry in item.json 16.20.1 [4] after junk was stripped (quest placeholders, health-bar cosmetics, vouchers). That covers **227 names buyable on Summoner's Rift** plus items for Arena, Swarm, League Classic and other modes.
- **Recent items are included,** for example Actualizer, Bastionbreaker, Endless Hunger, Hexoptics C44, Protoplasm Harness, Dusk and Dawn, Fiendhunter Bolts and Yun Tal Wildarrows [4]. Which patch added each one is [unverified].
- **Older items are included too,** because the current file still carries many of them, probably for League Classic: Deathfire Grasp, Sightstone, Ohmwrecker, Wriggle's Lantern, Frozen Mallet, Duskblade-era names and others.
- **Iconic removed items added from memory [unverified]:** Hextech Protobelt-01, Hextech GLP-800, Athene's Unholy Grail, Face of the Mountain, Eye of the Watchers/Oasis/Equinox, Frost Queen's Claim, Nomad's Medallion, Ancient Coin, Targon's Brace, Spellbinder, Stalker's Blade, Skirmisher's Sabre, Tracker's Knife, the "Enchantment:" jungle line, Lord Van Damm's Pillager, Kage's Lucky Pick, Zeke's Herald and Doran's Lost items.
- **Exact-only:** Boots, Dagger, Pickaxe, Zeal, Sheen, Cull, Eclipse, Hubris, Terminus, Redemption, Zephyr, Vanguard, Stinger, Leviathan and others.

### 3.6 Runes and summoner spells (`lol_runes_spells`, 74 + 39 exact-only)
- **Five trees, 62 runes in all, from runesReforged [5]:**
  - Keystones include Press the Attack, Lethal Tempo, Fleet Footwork, Conqueror, Electrocute, Dark Harvest, Hail of Blades, Summon Aery, Arcane Comet, Stormraider's Surge, Deathfire Touch, Grasp of the Undying, Aftershock, Guardian, Glacial Augment, Unsealed Spellbook and First Strike.
  - Minor runes include Cheap Shot, Taste of Blood, Sudden Impact, Sixth Sense, Grisly Mementos, Deep Ward, Treasure Hunter, Absorb Life, Triumph, Presence of Mind, Legend: Alacrity/Haste/Bloodline, Coup de Grace, Cut Down, Last Stand, Demolish, Font of Life, Shield Bash, Conditioning, Second Wind, Bone Plating, Overgrowth, Revitalize, Unflinching, Axiom Arcanist, Manaflow Band, Nimbus Cloak, Transcendence, Celerity, Absolute Focus, Scorch, Waterwalking, Gathering Storm, Hextech Flashtraption, Magical Footwear, Cash Back, Triple Tonic, Time Warp Tonic, Biscuit Delivery, Cosmic Insight, Approach Velocity and Jack Of All Trades.
- **Tree names are exact-only:** Precision, Domination, Sorcery, Resolve, Inspiration.
- **Summoner spells [6]:** Flash and Smite are whole-word. Heal, Ghost, Barrier, Exhaust, Ignite, Cleanse, Teleport, Clarity and Mark are exact-only. Also included: Poro Toss, To the King!, Unleashed Teleport/Smite, Primal Smite, Hexflash.
- **Retro spell set:** the summoner data also carries Clairvoyance, Fortify, Promote, Rally, Revive and Surge under a mode coded "JADE" [6]. My inference is that this is the League Classic spell set [36]. All six are exact-only.
- **Removed keystones from memory [unverified]:** Kleptomancy, Thunderlord's Decree, Fervor of Battle, Warlord's Bloodlust, Windspeaker's Blessing.

### 3.7 Regions and lore (`lol_regions_lore`, 87 + 14 exact-only) [mostly unverified]
- **Places:** Runeterra, Valoran, Demacia, Noxus, Ionia, Freljord, Piltover, Zaun, Bilgewater, Shurima, (Mount) Targon, Ixtal, Shadow Isles, Blessed Isles, Bandle City, Bandlewood, Icathia, Camavor, Helia.
- **Peoples and beings:** Darkin, Yordle(s), Vastaya, Brackern, Voidborn, the Black Mist and Ruination.
- **Materials and technology:** Hextech, Chemtech, Petricite, True Ice, Iceborn.
- **Orders and factions:** Solari, Lunari, Rakkor, Kinkou, Navori, the Black Rose, the Trifarian Legion, the Mageseekers, Crownguard and Lightshield.
- **Demonyms:** Noxian, Demacian and so on.
- **Sourcing:** apart from names that also appear in game data (champion titles, items, skin sets), this list comes from memory.
- **Exact-only:** Void, Aspect(s), Ascended, Shimmer, Arcane, Bastion, Watchers and similar ordinary words.

### 3.8 Client and UI terms (`lol_ui_terms`, 48 + 14 exact-only)
- **Currencies, loot and accounts:** Riot Points, RP, Blue/Orange/Mythic Essence, Hextech Crafting/Chest/Key, Key Fragment, Masterwork Chest (the loot data confirms the chest and key names [13]), Riot ID.
- **Behaviour and ranked systems:** Honor Level/Capsule/Orb, League Points and LP, Champion Mastery, LeaverBuster.
- **Kill callouts and team names:** Penta/Quadra Kill, and Team Order / Team Chaos (LoL's internal team names).
- **Exact-only:** Honor, Mastery, Eternals, Prestige, Chroma(s), Autofill, Promos, Clash, Challenger, Vanguard, and the 2025 gacha terms Sanctum, Exalted and Transcendent [unverified].
- **Left out on purpose:** the metal and gem rank tiers (Iron to Diamond), Master and Grandmaster. These are industry-wide words, and Vale must still be free to call its currency "gold". Section 7 covers copying the ladder as a set.

### 3.9 Skin lines (`lol_skins_lines`, 112 + 32 exact-only)
- **From data:** 38 ward-skin set names and 81 icon set names from the Dec 2025 snapshot [13]. Examples: Battle Academia, Blood Moon, Dark Star, Heartsteel, K/DA, Pentakill, Pool Party, PROJECT, Pulsefire, Spirit Blossom, Star Guardian, Steel Valkyries, Tales from the Rift.
- **From memory [unverified]:** Anima Squad, Coven, Dawnbringer/Nightbringer, Elderwood, Empyrean, Faerie Court, High Noon, Inkshadow, Mecha Kingdoms, Mythmaker, Primordian, Soul Fighter, Winterblessed and others.
- **Exact-only:** Arcade, Cosmic, Coven, Eclipse, Infernal, Mecha, Odyssey, Ruined, Sentinel, Victorious and similar.

### 3.10 Riot names and trademarks (`riot_trademarks`, 50 + 4 exact-only)
- **Company and franchises:** Riot Games, Riot, League of Legends, LoL, Legends of Runeterra, Teamfight Tactics/TFT, Valorant, Wild Rift, 2XKO, Project L, Riftbound, Ruined King, Hextech Mayhem, Song of Nunu, The Mageseeker, Bandle Tale.
- **Esports:** LCK, LCS, LEC, LPL, LTA, LCP, MSI, Summoner's Cup, Rift Rivals, First Stand.
- **Bands and mascots:** K/DA, Pentakill, True Damage, Heartsteel, Poro, Teemo.
- **Exact-only:** Arcane, League, Worlds, Convergence.
- **Caveat:** I did not check which of these are registered trademarks [unverified]. For a deny-list that makes no difference: Vale avoids them either way.

### 3.11 Abilities (`lol_abilities`, 721 + 172 exact-only), an extra category
This holds all 865 passive and ability names from championFull [3], because the contract checks fighter kit names too. Alternate names joined by "/" or "|" are split.

---

## 4. Dota 2

### 4.1 Heroes: 127 (`dota_heroes`)
These come from dotaconstants [14]. They match the hero item-build files in the 6 October 2026 game build one for one [16]. Old internal names and alternate spellings live in `spelling_variants` (Zuus, Nevermore, Furion, Windrunner, Skeleton King, Outworld Destroyer and others). Full roster:

Abaddon, Alchemist, Ancient Apparition, Anti-Mage, Arc Warden, Axe, Bane, Batrider, Beastmaster, Bloodseeker, Bounty Hunter, Brewmaster, Bristleback, Broodmother, Centaur Warrunner, Chaos Knight, Chen, Clinkz, Clockwerk, Crystal Maiden, Dark Seer, Dark Willow, Dawnbreaker, Dazzle, Death Prophet, Disruptor, Doom, Dragon Knight, Drow Ranger, Earth Spirit, Earthshaker, Elder Titan, Ember Spirit, Enchantress, Enigma, Faceless Void, Grimstroke, Gyrocopter, Hoodwink, Huskar, Invoker, Io, Jakiro, Juggernaut, Keeper of the Light, Kez, Kunkka, Largo, Legion Commander, Leshrac, Lich, Lifestealer, Lina, Lion, Lone Druid, Luna, Lycan, Magnus, Marci, Mars, Medusa, Meepo, Mirana, Monkey King, Morphling, Muerta, Naga Siren, Nature's Prophet, Necrophos, Night Stalker, Nyx Assassin, Ogre Magi, Omniknight, Oracle, Outworld Devourer, Pangolier, Phantom Assassin, Phantom Lancer, Phoenix, Primal Beast, Puck, Pudge, Pugna, Queen of Pain, Razor, Riki, Ring Master (Ringmaster), Rubick, Sand King, Shadow Demon, Shadow Fiend, Shadow Shaman, Silencer, Skywrath Mage, Slardar, Slark, Snapfire, Sniper, Spectre, Spirit Breaker, Storm Spirit, Sven, Techies, Templar Assassin, Terrorblade, Tidehunter, Timbersaw, Tinker, Tiny, Treant Protector, Troll Warlord, Tusk, Underlord, Undying, Ursa, Vengeful Spirit, Venomancer, Viper, Visage, Void Spirit, Warlock, Weaver, Windranger, Winter Wyvern, Witch Doctor, Wraith King, Zeus.

### 4.2 Items (`dota_items`, 325 + 52 exact-only; `dota_neutral_enhancements`, 3 + 24 exact-only)
- **Shop and neutral items:** from items.json [14], about 220 shop names and 49 current neutral-item names. Examples: Black King Bar, Blink Dagger, Aghanim's Scepter/Shard/Blessing, Divine Rapier, Eye of Skadi, Heart of Tarrasque, Khanda, Parasma, Kaya and Sange, Mekansm, Mjollnir, Radiance, Refresher Orb, Scythe of Vyse, Shiva's Guard, Linken's Sphere, Eul's Scepter of Divinity, Vladmir's Offering, Wind Waker, Gleipnir, Harpoon.
- **Older names still in the data file:** Ring of Aquila, Iron Talon, Poor Man's Shield and earlier neutral items. Whether each one can still be bought or dropped is [unverified]; all are denied either way.
- **Neutral "enhancements":** the 24 adjectives used by the 2025 neutral-crafting system (Brawny, Nimble, Vital, Wise and so on) are exact-only. Only the coined ones (Fleetfooted, Keen-eyed, Vampiric) are whole-word.
- **Exact-only items:** Bottle, Clarity, Tango, Cloak, Crown, Circlet, Butterfly, Satanic, Maelstrom, Bracer, Chainmail, Claymore, Javelin and other plain nouns.

### 4.3 Map, objectives and neutrals (`dota_map_objectives`, 85 + 19 exact-only)
- **Teams and base:** Radiant and Dire (also "The Radiant" and "The Dire"), Radiant Ancient and Dire Ancient, Defense of the Ancients.
- **Roshan and drops:** Roshan, Roshan's Pit and "Roshpit", Aegis of the Immortal, Refresher Shard, Roshan's Banner.
- **Other objectives:** Tormentor, Lotus Pool, Healing Lotus, Twin Gates, Shrine of Wisdom / Wisdom Shrine.
- **Runes:** Wisdom, Bounty, Power, Water, Haste, Illusion, Invisibility, Regeneration, Arcane and Shield Rune, plus Double Damage and Amplify Damage.
- **Structures and services:** Glyph of Fortification, Animal/Flying Courier, Melee/Ranged Barracks, Mega Creeps, Super Creeps, Siege Creep, Flagbearer Creep, Secret Shop, Side Shop, Neutral Item Stash.
- **Consumables:** Observer and Sentry Ward, Smoke of Deceit, Dust of Appearance, Town Portal Scroll.
- **Neutral camps:**
  - The **ancient camp ids are confirmed** by dotaconstants: black dragon/drake, granite/rock golem, thunder lizards, prowlers, ice shaman, frostbitten golem, jungle stalker, frogs [14]. Their **English display names are [unverified]**.
  - Common camp names (Satyr Tormenter, Hellbear Smasher, Centaur Conqueror, Wildwing Ripper and others) are [unverified].
- **Exact-only:** Ancient(s), Shrine(s), Watcher(s), Outpost(s), Courier, Glyph, Scan, Barracks, Cheese, Facet(s), Ghost.
- **Background:** R02 describes how these systems work, but its Dota objectives section is itself marked [unverified].

### 4.4 Modes (`dota_modes`, 37 + 4 exact-only)
- **Matchmade and draft modes:** All Pick (ranked and unranked), Turbo, Captains Mode, Captains Draft, Single Draft, All Random, Random Draft, Ability Draft [39], plus the other mode ids in dotaconstants [14]: Reverse Captains Mode, All Draft, Least Played, Limited Heroes, Mid Only, 1v1 Solo Mid, All Random Deathmatch, Balanced Draft, Coaches Challenge.
- **Event and seasonal modes:** Greeviling, Diretide, Frostivus, Siltbreaker, Aghanim's Labyrinth, Underhollow, Crownfall, Battle Cup.
- **Exact-only:** Overthrow, Mutation, Event, Colosseum.

### 4.5 Terms (`dota_terms`, 34 + 15 exact-only)
- **Titles and franchise:** Dota, Dota 2, DotA, DotA Allstars, Defense of the Ancients, The International, Aegis of Champions, Dota Plus, Dota Pro Circuit, Dota Underlords.
- **Systems:** Behavior Score, Communication Score, Low Priority, Overwatch (Dota's report-review system, and also a Blizzard game).
- **Lore names:** Selemene, Nightsilver Woods, Mad Moon, Ostarion, Dragonus.
- **Exact-only:** the rank medals Herald, Crusader, Archon and Immortal, plus Arcana, Persona, Compendium, Commend, Buyback, Shards, Valve, Steam, TI and Artifact.

### 4.6 Abilities and facets (`dota_abilities`, 604 + 217 exact-only), an extra category
This holds 776 hero ability names and the 49 current facet titles from dotaconstants [14].

---

## 5. Other MOBAs (`other_moba`, 239 + 122 exact-only)

**The general rule here:** for these games, common-word names are exact-only, not whole-word. They are further from Vale's design than LoL and Dota, and several of their rosters are [unverified].

- **Heroes of the Storm (data-backed):**
  - **90 heroes** [17]. Examples: Abathur, Alarak, Anub'arak, Cho'gall, D.Va, Deckard, E.T.C., Gul'dan, Kael'thas, Kel'Thuzad, Li-Ming, Lt. Morales, Sgt. Hammer, The Lost Vikings, Zul'jin.
  - **15 maps** [18]: Alterac Pass, Battlefield of Eternity, Blackheart's Bay, Braxis Holdout, Cursed Hollow, Dragon Shire, Garden of Terror, Hanamura Temple, Haunted Mines, Infernal Shrines, Sky Temple, Tomb of the Spider Queen, Towers of Doom, Volskaya Foundry, Warhead Junction.
  - Brawl and ARAM maps and objective names are [unverified]. HotS also calls its setting "the Nexus", which is one more reason to deny that word.
- **SMITE / SMITE 2 [unverified]:** god names are real-world mythology, so they are not listed, as the brief asked. Listed instead:
  - Titles and studios: SMITE, SMITE 2, Hi-Rez, Titan Forge.
  - Mode words (all exact-only): Conquest, Joust, Arena, Assault, Siege, Clash, Slash, Duel.
  - Match of the Day.
  - Objective names: Gold Fury, Fire Giant, Pyromancer, Bull Demon.
- **Pokémon UNITE [unverified]:** Remoat Stadium, Theia Sky Ruins, Mer Stadium, Auroma Park, Shivre City, Aeos Island and Aeos currencies, Unite Move, Goal Zone. Legendary objective Pokémon (Zapdos, Rayquaza, Regieleki) are listed, though Pokémon names are protected anyway.
- **Deadlock:**
  - The 7 Oct 2026 build has **44 enabled hero codenames** [19].
  - **Display names below are [unverified]:** Abrams, Bebop, Calico, Dynamo, Grey Talon, Haze, Holliday, Infernus, Ivy, Kelvin, Lady Geist, Lash, McGinnis, Mirage, Mo & Krill, Paradox, Pocket, Seven, Shiv, Sinclair, Vindicta, Viscous, Vyper, Warden, Wraith, Yamato, plus the 2025 additions Billy, Drifter, Mina, Paige, The Doorman, Victor, Apollo, Celeste, Graves, Rem and Venator.
  - **Six newer codenames have no display name known to me:** ratking, chessmaster, artist, nurse, deadpack, baba. They are probably 2026 heroes.
  - "Silver", the likely name behind the codename `werewolf`, is left out on purpose so that Vale keeps the ordinary word.
- **Paragon / Predecessor [unverified]:** about 50 hero names, including Countess, Dekker, Feng Mao, Gideon, Grux, Kallari, Khaimera, Murdock, Narbash, Sevarog, Shinbi, Twinblast, Zinx, Argus, Akeron, Bayle, Zarus and Yurei. Map names: Legacy, Monolith, Agora. Objectives: Orb Prime, Fangtooth.
- **Battlerite [unverified]:** 28 champion names.
- **Mobile and other titles [unverified]:** Mobile Legends: Bang Bang (Land of Dawn, Lord, Turtle), Arena of Valor (Antaris Battlefield, Abyssal Dragon, Dark Slayer), Honor of Kings, Vainglory (Halcyon Fold, Sovereign's Rise), Heroes of Newerth (Forests of Caldavar, Kongor, Legion, Hellbourne), Supervive, Atlas Reactor, Awesomenauts, Gigantic, Dawngate, Infinite Crisis, Strife, Demigod, Onmyoji Arena, Heroes Evolved, Eternal Return.

---

## 6. Generic genre words: what is a proper noun and what is plain English

**The question asked of each word:** is it a coined or branded proper noun that marks a specific game? Or is it shared genre vocabulary that many games use for the same idea?

| Word | Decision | Why |
|---|---|---|
| **Nexus** | Deny, whole-word | The win structure in LoL and the setting of HotS. There is no neutral meaning Vale needs. |
| **Rift** | Deny, whole-word | "The Rift" is the community's name for Summoner's Rift. Riot also uses it in Wild Rift, Rift Herald, Rift Scuttler, Rift Rivals and Riftbound. A 3-lane map called "Rift" in a lane MOBA reads as a direct borrow. |
| **Inhibitor** | Deny | Branded LoL structure name, uncommon outside the genre. |
| **Baron**, **Summoner(s)**, **Smite**, **Flash** | Deny, whole-word | Each is the shorthand players use for a specific LoL thing: the boss, the player and spell layer, the jungle spell, the blink spell. "Smite" is also a rival MOBA's title. |
| **Rune(s)** | Deny, whole-word | A core system name in **both** LoL (pre-match runes) and Dota (map runes). Vale's pre-match layer is already called "boons/paths" (CONTRACT section 4). Its map pickups need their own word too. |
| **Radiant**, **Dire** | Deny, whole-word | Dota's team names. A style-bible team called "the Radiant" would copy them directly. |
| **Aegis**, **Tormentor**, **Roshan**, **Turbo**, **Hextech**, **Chemtech**, **Poro**, **Darkin**, **Yordle**, **Aghanim** | Deny, whole-word | Signature coined or branded names. Collateral cost is low. |
| **Ancient(s)** | Exact-only | Dota's base and camp name, and the "A" in DotA. But it is a very common fantasy adjective. "Ancient Grove" is fine. Never call Vale's core, or a monster class, "the Ancient". |
| **Herald** | Exact-only | LoL monster and Dota rank, but also a common title. "Rift Herald" and "Eye of the Herald" are whole-word. |
| **Champion(s)** | Exact-only, plus a style rule | LoL's word for its playable characters. Vale calls them **fighters** (contract vocabulary) and must not label the roster "Champions" in UI copy. Plain-English uses such as "Champion's Crest" are fine. |
| **Drake**, **Scuttle**, **Arena**, **Brawl**, **Clash**, **Honor**, **Mastery**, **Essence**, **Courier**, **Glyph**, **Shrine**, **Watcher**, **Outpost**, **Facet** | Exact-only | Real words with real uses. Each is denied only as the whole name of the matching feature. |
| **Minion**, **creep** | Allowed | Shared genre vocabulary across LoL, Dota, HotS, SMITE and others. Still, an in-world name for Vale's lane units would strengthen the brand. |
| **Hero**, **lane**, **jungle**, **tower**, **turret**, **ward**, **buff**, **gank**, **carry**, **support**, **tank**, **last hit**, **deny**, **gold**, **boots**, **potion**, **recall**, **fountain**, **shop**, **core** | Allowed | Generic terms with no single owner. |

The JSON category `generic_terms_to_avoid_as_proper_nouns` holds the decisions above (29 whole-word, 20 exact-only).

---

## 7. Known collateral: ordinary words the list blocks inside any Vale name

These come from the rosters and the signature list. Designers should know about them before they name things:

- **Dota heroes:** Axe, Bane, Doom, Io, Lich, Lion, Luna, Mars, Oracle, Phoenix, Puck, Razor, Sniper, Spectre, Tiny, Tinker, Undying, Viper, Warlock, Weaver, Zeus, Silencer, Techies, Enigma, Dazzle, Medusa, Disruptor, Chen.
- **LoL champions:** Aurora, Bard, Brand, Briar, Diana, Graves, Jinx, Karma, Kindred, Lux, Nautilus, Nocturne, Pantheon, Poppy, Riven, Rumble, Singed, Smolder, Swain, Talon, Thresh, Twitch, Vex, Vi.
- **Signature words:** Radiant, Dire, Flash, Rift, Rune, Aegis, Baron, Turbo.
- **Two-letter traps:** "Vi" and "Io" catch the Roman numeral VI and the letters IO. Write "Season 6".

This strictness is on purpose: a Vale item called "Doom Axe" would point at two Dota heroes. If a name is truly original and still trips a roster word, the fix is a short human-reviewed waiver list (recommendation 3 below), not a looser matcher.

---

## 8. Gaps and what to re-verify

1. **No web search was available for this note.** Everything sourced only from memory is tagged [unverified] above. The biggest gaps:
   - display names for non-HotS rosters (Deadlock, Predecessor, Battlerite);
   - Pokémon UNITE, SMITE and mobile-MOBA map and objective names;
   - LoL lore places and factions;
   - skin lines added after December 2025;
   - removed LoL items and keystones;
   - Dota neutral-creep display names.
2. **Not included at all:**
   - LoL Arena and ARAM: Mayhem **augment names**. ARAM: Mayhem is built around augment picks [33], and R01 reports about 200 of them by patch 26.19;
   - Dota hero **lore names** (for example a hero's personal name behind the title);
   - LoL **TFT** trait and unit names;
   - the full Mobile Legends and Honor of Kings rosters (about 130 each [unverified]).
   These are lower risk, but a follow-up with search access should add the augments.
3. **Trademark status** of each name was not checked. The list protects originality, which is a wider net than registered marks.
4. **Freshness:** LoL ships new champions and items through the year and Dota adds heroes roughly yearly [unverified cadence]. Rebuild from the same sources at every Vale content milestone and before launch. A newer `dotaconstants` will reflect 7.42 when it ships [42].

---

## 9. Implications for Vale

1. **Rename the player-facing "Rift" mode and map before any content lands.**
   - The contract's `rift_*` ids can stay, because ids are not checked.
   - Display names come from the style bible and must pass this list. "Bridge" and "Fray" pass.
   - Do not name the single-lane mode after an ARAM map ("Butcher's Bridge", "Howling Abyss"), and do not call it "ARAM" or "All Random".
2. **Build `tools/names_check.ts` with both tiers and the normalization in section 1:**
   - whole-word or phrase regex over `categories`;
   - exact equality over `exact_only` after dropping a leading "the";
   - a squashed second pass (all non-alphanumerics removed) for both tiers.
   - **Fixtures:** "Iron Axe", "The Rift", "Kai Sa" and "Arena" must fail. "Ember Boots", "Ashen Arena", "Champion's Crest" and "Bridge" must pass. Also merge in `_design/NAMES_NOT_USED.md`, as the contract requires.
3. **Add a small waiver file only if needed,** for example `_design/names_waivers.json` with fields name, matched term, reason and reviewer, checked by the same tool. Start it empty. Every waiver should be a deliberate human call; never widen the matcher instead.
4. **Fighter names must be coined.**
   - Avoid any single word from either roster, including inside compounds (section 7).
   - Run the candidate list through the checker before art starts. A fighter rename after Blender work wastes the most effort.
   - Also check fighter **titles** against `lol_champion_titles`.
5. **Kit names:**
   - The `lol_abilities` and `dota_abilities` categories catch copies like "Black Hole", "Shadow Step", "Static Field" and "Mirror Image".
   - Use coined or compound names. "Blink Step" and "Healing Rain" pass.
6. **Pre-match layer:**
   - Battle spells must not reuse LoL's spell names: Flash, Smite, Ignite, Exhaust, Heal, Ghost, Barrier, Cleanse, Teleport, Clarity, Mark.
   - Paths must not reuse Precision, Domination, Sorcery, Resolve or Inspiration, or any keystone name.
   - Copying the *set* of spells (blink, burn, heal, shield, teleport, jungle-smite) under new names is a design-originality question for the design note. This list does not settle it.
7. **Structures and objectives:**
   - Do not call the base structure "Nexus" or "Ancient", lane-gate structures "Inhibitors", or the late boss "Baron".
   - Vale's map pickups (CONTRACT section 5, Fray/Bridge) must not be "runes", nor named after Dota's rune types (Double Damage, Haste, Bounty, Wisdom and so on).
8. **Teams:** do not use Radiant/Dire or Order/Chaos. Blue/Red sides or in-world faction names from the style bible are fine.
9. **Economy and store:**
   - Do not name currencies RP, Riot Points, Essence or Shards.
   - "Gold" is fine for match currency.
   - Avoid LoL's Hextech crafting, chest and key vocabulary, and loot tiers named Mythic, Exalted, Transcendent or Arcana.
10. **Ranks:** do not copy either ladder as a set, LoL's Iron-to-Challenger or Dota's Herald-to-Immortal medals. Individual metal or gem words are allowed but should not appear in the same order.
11. **Copy vocabulary in UI text:** say "fighter", not "champion" or "hero". Give lane units an in-world name. Avoid "Summoner" for the player. These words are mostly not enforced by the checker, so the style bible should state them.
12. **Keep the registry live:**
   - Rebuild at each milestone from the same mirrors [1][14][16].
   - Add augment names when a search-enabled pass can source them.
   - Log every rejected Vale name and its replacement in `NAMES_NOT_USED.md`, so the team does not re-propose it.

---

## Sources

1. https://github.com/InFinity54/LoL_DDragon
2. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/en_US/champion.json
3. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/en_US/championFull.json
4. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/en_US/item.json
5. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/en_US/runesReforged.json
6. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/en_US/summoner.json
7. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/latest/data/en_US/map.json
8. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/constants/maps.json
9. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/constants/queues.json
10. https://raw.githubusercontent.com/InFinity54/LoL_DDragon/master/constants/gameModes.json
11. https://www.npmjs.com/package/@lol-inspector/league-commons
12. https://www.npmjs.com/package/twisted
13. https://www.npmjs.com/package/@magicwenli/league-fan-assets
14. https://github.com/odota/dotaconstants
15. https://www.npmjs.com/package/dotaconstants
16. https://github.com/SteamDatabase/GameTracking-Dota2
17. https://github.com/heroespatchnotes/heroes-talents
18. https://www.npmjs.com/package/hots-parser
19. https://github.com/SteamDatabase/GameTracking-Deadlock
20. https://www.npmjs.com/package/wordlist-english
21. https://www.shacknews.com/article/146999/league-of-legends-season-1-2026-changes-feature-atakhan
22. https://esports-news.co.uk/2025/12/01/lol-2026-update-ranked-wasd-atakhan-removed-role-quests/
23. https://www.sheepesports.com/en/all/articles/league-of-legends-2026-s1-gameplay-changes-atakhan-removed-new-plates-on-t2-and-t3-nashor-back/en
24. https://www.nerfplz.com/2026/08/every-summoners-rift-objective.html
25. https://wiki.leagueoflegends.com/en-us/Baron_Nashor
26. https://fanstanza.gg/faelights-league-of-legends-explained/
27. https://riftfeed.gg/guides/league-of-legends-jungle-pets
28. https://www.dodge.gg/en-US/lol/news/support-items-2026
29. https://mobalytics.gg/lol/guides/new-role-quests
30. https://blog.loltheory.gg/league-of-legends-game-modes/
31. https://www.nerfplz.com/lol-game-modes/
32. https://blog.loltheory.gg/what-is-swiftplay/
33. https://esports.gg/news/league-of-legends/aram-mayhem-announcement/
34. https://blog.loltheory.gg/what-is-arena/
35. https://esports.gg/news/league-of-legends/introducing-brawl-the-new-5v5-game-mode-coming-to-league-of-legends/
36. https://www.gamespress.com/LEAGUE-OF-LEGENDS-CLASSIC-RELEASES-IN-PATCH-2615
37. https://blog.loltheory.gg/ranked-5s-lol/
38. https://esports.gg/news/league-of-legends/aram-rework-champion-cards-map-rotation-featuring-butchers-bridge/
39. https://guildorder.com/games/dota2/wiki/game-modes
40. https://www.gosugamers.net/dota2/news/77881-dota-2-patch-7-40c-adds-largo-to-captain-s-mode-nerfs-clinkz-and-broodmother
41. https://www.gosugamers.net/dota2/news/78889-dota-2-drops-patch-7-41e-supporter-bundles-fantasy-and-predictions-ahead-of-the-international-2026
42. https://timesaver.gg/news/dota-2-next-patch-742-silent-update-september-29
43. https://gameriv.com/all-new-turret-changes-coming-to-league-of-legends-in-2026/

Sources 21-43 were confirmed through search-result snippets by sibling notes R01 and R02 earlier in this run, and are cited as they reported them. Sources 1-20 are data files and registries that I downloaded and parsed directly.
