# VALE · Names deliberately not used

Every name VALE chose not to use, and why. The owner's brief asks the design note to list "every name that was deliberately not used" (`_design/BRIEF.md`); the summary is in [`DESIGN_NOTE.md`](../DESIGN_NOTE.md) §5 and this file is the full record. Compiled 2026-10-14 from `_design/WORLD.md` §4.4 and §6, `_design/ROSTER.md` §5 and §6, `_design/proposals/JUDGING.md` and the three style-bible proposals, `_design/sections/items_setup.md`, and `_design/research/r11_protected_names.md` with its registry `protected_names.json`.

## How the content build reads this file

`tools/names_check.ts` loads this file on every content build and in its CLI (CONTRACT §0 "Originality", §3.4). Each line that starts with a dash is read as one denied name and filed under the heading above it. The text after " — " is the reason and is ignored. A heading marked "(strict)" also catches its plain-English words inside longer names. So:

1. **Bullets are names, and only names.** A bullet makes the content build fail when that name appears as a fighter, skin, item, ability, map, mode or other catalog name. Multi-word names and invented words fail in prose too; a plain dictionary word fails only when a whole name equals it.
2. **Tables are the record.** They hold names the registry already denies, names dropped for reasons other than originality, and genre words VALE replaced with its own. The checker ignores tables.
3. **To log a new rejection,** add a bullet under the right heading (the name, then " — " and the reason) and run `node tools/names_check.ts "<name>"` to see it hit.

### The one exception: "Rift"

The registry denies "Rift" as a whole word: it is the community's short name for the primary reference map and part of several of its owner's product names (r11 §6). The owner's brief names the 5v5 mode RIFT, so `_design/names_allowlist.json` allows "Rift" **only** in mode names, queue names, mode-select labels and UI strings. It is never a map, objective, structure, fighter, item or currency: the RIFT map is **Hourfall**. The risk is recorded in `DESIGN_NOTE.md` §5. The only fallback name on record is **KEELBREAK** (`_design/proposals/bible_clarity.md`, risk table item 13, checked clear on 2026-10-07). It comes from a world VALE did not adopt, so if the owner wants a rename, a new dial-world name checked the same way would fit better.

---

## (a) World and premise names dropped

### The kiln world

Three style-bible proposals were judged on 2026-10-07 (`_design/proposals/JUDGING.md`). One of them, "FIRED" (`bible_craft.md`), built the Vale as a clay valley of kilns, potters' houses and fired-clay fighters. A web check then found Double Fine's *Kiln* (released 23 April 2026), an online team brawler in which players shape clay pots, fight in them and win by putting out the enemy's kiln. A pottery world would read as derivative, so the premise and every name built on it were dropped (WORLD §4.4, §6). The winning world is the stopped sundial.

### Kiln, the word (strict)

- Kiln — no VALE name may contain the word, even inside a longer name

### Kiln-world names

- Kilnhollow — the FIRED proposal's RIFT map
- Kilnyard — its jungle
- Bellkiln — its north objective
- Underkiln — the furnace under its world
- Kilnglass — its "self" colour and spark material
- Kilnlight — its brand accent
- Kilnwright — its shopkeeper
- Bottle Kiln — its west base landmark
- Stepped Kiln — its east base landmark
- Kilnstair — a base name in the "Clarity" proposal, caught by the same rule
- Handlespan — its BRIDGE map
- Wheelhead — its FRAY map
- Wheelfair — its yearly free-for-all fair
- Glazeway — its river
- Glaze Gorge — the gorge under its BRIDGE
- Old Sagger — its south objective
- Glost — its in-match currency
- Wakened — its name for the fighters as a people
- Wheel — its west house, "the Wheel" (WORLD §4.4)

**Dropped with the kiln world but not enforced** (plain craft words with no originality problem of their own):

| Name | Was | Why it is not a rule |
|---|---|---|
| the Slab | FIRED's east house | VALE's own dial uses carved slabs as scenery |
| Flue · Hearth · Sprigs | lane gate, core, lane units | plain words |
| Clay · Lustre | earned and bought currencies | plain words |
| Raw · Fired · Glazed · Gilt | item tiers | plain words |
| Earthen · Slipware · Stoneware · Ashglaze · Celadon · Cobalt · Eggshell · Whiteheat | rank ladder | plain craft words |
| Luted Join · Saggar Stacks · Shard Garden · Slip-jar · Cooling Terrace · the Spindle | landmarks | dropped with the map layouts |
| FIRED | the proposal's title | never a player-facing name |

### The cloud world (not adopted)

The "Clarity" proposal (`bible_clarity.md`) set the Vale in a chalk valley held clear of a sea of cloud. It lost on originality and appeal (`JUDGING.md`: sky islands above cloud are a familiar image, and its blue-ally, red-enemy colours are the genre default). Its names were checked clear and are not rules; they are listed so nobody mixes the two worlds.

| Name | Was |
|---|---|
| the Pall | the sea of cloud |
| Ollun · Skerra | the west and east peoples |
| Keel · Keels | the hull-stones that hold the cloud back (the core) |
| Masts · the Brakes · the Stack | lane structures, jungle, FRAY summit |
| Longspan | its BRIDGE map |
| Tarnhallow | its west base |
| Haarwyrm · Driftkites | its late siege objective and its stacking objective |
| Haar Hollow · Kiteford · Ennerdown · Gorsemoor | places |
| Glint | its in-match currency (VALE uses the word only inside the battle spell Glint Step) |
| KEELBREAK | its RIFT fallback name, kept on record (see "Rift" above) |

### Candidates rejected while naming the world

Caught while the three proposals and the world sheet were written, by web checks or by reading the registry (`bible_identity.md` §1.5, `bible_clarity.md` §1.4, `bible_craft.md` §1.5, WORLD §4.4 and §6).

- Sundial — a seasonal activity in Destiny 2 is called "the Sundial", so no VALE name may be "Sundial"
- Penumbra — an existing game series
- Meridian — an existing game series
- Cairn — a 2026 climbing game by The Game Bakers
- Spindrift — an itch.io game title and a drinks trademark; a 2026 Steam title is "Spindledrift"
- Uncharted — a Naughty Dog series
- Skyglass — a TV product trademark
- Ithra — a Saudi cultural-centre brand
- Kellam — a Fire Emblem character
- Vosk — an existing fictional name
- Terminator — a film IP
- Zenith — sits inside an ability name of the primary reference game
- Spurs — a sports club's nickname
- Sherds — sounds like a reference game's "Shards" currency

**Rejected while naming the world, already denied by the registry:**

| Name | Where it came up | What VALE did instead |
|---|---|---|
| Seven | the bare numeral callout for a jungle quadrant | the *-mark* form: Elevenmark, Sevenmark, Twomark, Fourmark |
| Crack | a candidate world word (identity proposal) | not used as a name |
| Porcelain | FIRED's seventh rank | dropped with the kiln world |
| Keystone | FIRED's BRIDGE midpoint | dropped with the kiln world |
| Bulwark · Vanguard | caught by the FIRED proposal's own check (`bible_craft.md` §1.5) | not used |
| Glyph | a Clarity candidate for the FRAY seat marks | seat marks are plain "glyphs" in UI text, never a name |
| Wisp · Mark | Clarity candidates | not used as names |
| Facets · Pearl | caught by `names_check.ts` during the merge (`JUDGING.md`); Pearl was the identity proposal's shield colour | the shield colour is Dawnglass |

---

## (b) Role, class and term names avoided

### Role and term names

The winning proposal named its roles after the primary reference game's classes. The merge replaced them with Plinth, Breaker, Striker, Slinger, Caster and Tender (`content/classes.json`; `JUDGING.md` "Changed in the merge"; WORLD §4.4).

- Marksman — a reference game's class name; VALE's ranged class is the Slinger
- Keeper — too close to the reference hero "Keeper of the Light" in a light-themed world
- Hourglass — as the name of a glyph; it is adjacent to a famous item in the primary reference game, so the glyph is the sandglass
- First Cut — a boon name too close to a reference game's rune of the same idea (the 2026-10-14 review); the boon is Opening Hour

Vanguard and Warden, the other two replaced role names, are already in the registry (exact-name entries).

**Genre words and reference terms, and what VALE says instead.** r11 §6 allows the plain genre words (minion, hero, lane, jungle, tower, ward, gold and so on), but VALE gave most of them an in-world name anyway, and it never uses the reference games' coined terms.

| Genre word or reference term | Registry status | VALE says |
|---|---|---|
| champion, hero (the playable characters) | "Champion" is an exact-name entry; "hero" is allowed | **fighter** |
| summoner (the player) | denied as a word | you, the player |
| minion, creep | allowed | **Wicks**: Shieldwick, Glimwick, Greatwick, Brightwick |
| gold (in a match) | allowed | **Gleam** |
| tower, turret | allowed | **Needle** (outer, inner, Bell Needle) |
| inhibitor | denied | **Lantern** |
| nexus, ancient (the core) | denied; exact-name entry | **Hourbell** |
| river | allowed | **Noonline** (Standing Shadow, Fallen Shaft) |
| jungle · brush | allowed | **Dialwood** · **Needlegrass** |
| the reference epic monsters and buff camps | denied names | **Longshade**, **Sunsplinter**, **Glasshorn**, **Resinback** |
| the reference team names | Radiant and Dire denied; Team Order and Team Chaos listed | **Aubade** and **Serenade** |
| the eleven reference summoner spells | Flash and Smite denied; the rest exact-name entries | battle spells: Glint Step, Saplight, Hairline, Hourstrike, Running Light, Shake Loose, Glass Pane, Calling Bell |
| runes, rune trees, keystones | Rune(s) denied; tree names exact-name entries | **boons** (9) and **paths**: Shadeline, Warmstone, Hourturn |
| map pickups called runes | denied | **Sunmotes** |
| the phrase for armor-ignoring damage | a protected skin line and trademark | "damage that ignores armor and resist" (`items_setup.md`) |
| the reference rank ladders | must not be copied as a set | Lamplit, Greylight, Rosewake, Clearmorn, Highsun, Noonward, Unshadowed |
| the reference currencies | denied, or exact-name entries | **Candles** (earned); this slice has no premium currency |
| the shop and its keeper | allowed | **the Lampwright** |
| the reference mode and map names | denied | **RIFT**, **BRIDGE**, **FRAY**; the Lot; the Hour Board |
| the single-lane mode's mark-and-dash spell | name protected | not built: BRIDGE has no mode-only gap-closer (`items_setup.md`) |

**Kit names renamed although the policy allowed them** (ROSTER §5):

| Name | Why it was renamed |
|---|---|
| Sanctum | an exact-name registry entry (a reference UI term) |
| Dart · Drive | each sits inside a longer protected ability or item name |
| Wayfarer | it sits inside a protected skin-line phrase |

**Battle-spell tuning changed** (the 2026-10-14 adversarial review): the eight battle spells cover the genre's usual
jobs, but three matched a reference game's numbers exactly, so they were retuned: Hourstrike's charge returns every
95 s with a 10 s lockout (was 90 s / 15 s), Glass Pane's 90 + 20 per level shield lasts 3 s on 160 s (was 2.5 s on
180 s), Hairline is 170 s with a 35% healing cut (was 180 s / 40%).

---

## (c) Fighter names rejected for closeness

WORLD §4.2 requires every fighter name to be at least 3 edits from every champion, hero and character name in the registry (`lol_champions`, `dota_heroes`, `other_moba`, `spelling_variants`), and each launch name was also web-checked (ROSTER §6). The nearest protected names below were recomputed against `protected_names.json` on 2026-10-14.

### Within two edits of a protected character

- Obran — 2 edits from Brand and Ornn
- Avira — 2 from Azir and Samira
- Hesk — 2 from Tusk
- Visel — 2 from Viper
- Reska — 2 from Renna
- Elvit — 2 from Kelvin
- Kemi — 2 from Nami and Kez
- Bodri — 2 from Boris
- Avrel — 2 from Yrel
- Bramund — 2 from Brand
- Hendo — 2 from Hanzo and Mundo

### Too close to other games or real people

- Bulmor — 2 edits from Bulma (Dragon Ball)
- Visha — the nickname of a lead character in The Saga of Tanya the Evil
- Umbri — 1 edit from Umbra, a Rogue Company hero
- Ustro — near Ultros (Final Fantasy VI) and Ostro (Super Mario Bros. 2)
- Unsho — the given name of a famous voice actor
- Dunmor — 1 edit from Dunmer (The Elder Scrolls)

**Checked and kept** (ROSTER §6):

| Name | Nearest find | Why it was kept |
|---|---|---|
| Ulkro | Ulki (a Fire Emblem side character) and Ultros (Final Fantasy VI), 2 edits | neither is in the registry or a famous match |
| Rishal | "Rishaal Tamir", a minor Battlespire character | not a match |
| Ardit | an Albanian given name | no game character |

The other thirteen launch names (Marund, Hesmi, Kemdo, Ervet, Nurrow, Lisvel, Ilsheta, Odrum, Burdam, Vashil, Tunlan, Dunsom, Sukri) found no game character.

---

## (d) Reference kits each fighter deliberately does not echo

Kits may use public mechanics (dash, skillshot, slow, stun, shield, root, sleep, fear, disarm, form switch, zone). Combinations may not copy a shipped kit. For every fighter the content lane named the two or three closest shipped kits and shaped the kit until it was clearly different (ROSTER §5). Every reference name below is already in the registry, so this table is the record, not an extra rule.

| Fighter (class) | Closest shipped kits | How VALE's kit differs |
|---|---|---|
| Marund (Plinth) | Braum, Galio; Disruptor | His dome keeps enemies out while allies move freely, the reverse of a trapping ring. No projectile-blocking shield, no dash to an ally. His ultimate leaps to ground he picks and throws enemies outward. |
| Burdam (Breaker) | Darius, Sett; Legion Commander | His marks are written by whoever hits him and spent by his attacks for healing. His ultimate drags every marked enemy at once. No execute, reset, stored-damage punch or duel. |
| Rishal (Striker) | Akali, Irelia; Batrider | His glass tracks fire once when crossed and build Cuts that his attacks cash in for Heat. No dash reset, no stealth, no damage-over-time trail. |
| Odrum (Slinger) | Caitlyn, Jhin, Varus | Lobbed resin roots only those still in it when it sets, and his passive shreds rooted targets for the team. No traps, headshot, snipe or spreading root. |
| Dunsom (Caster) | Orianna; Dark Seer, Magnus | No proxy object. His ultimate throws enemies from around him to a point he chooses, which then erupts: the player picks where the fight goes. |
| Ilsheta (Tender) | Yuumi, Karma; the Healing Ward of Juggernaut | She stays separate and targetable. Her lamp is a timed healing zone riding on an ally, her passive rewards healing allies under crowd control, and her ultimate lights every nearby ally. |
| Hesmi (Plinth) | Trundle, Ornn; Earthshaker | Her shard blocks nothing. It casts a shadow that slows and marks, then topples along that shadow as a delayed stun. |
| Kemdo (Breaker) | Rumble; Huskar, Phoenix | No empowered Heat state. Vent is a free cooldown that dumps Heat even while overheated, takedowns cool her, and her ultimate pins a burning spot to one enemy. |
| Ardit (Plinth) | Leona, Alistar; Keeper of the Light | His control is disarm in a cone, his dash knocks up the first fighter, and his ultimate is an aura that disarms enemies as they enter. No stun-on-attack, no delayed sun-burst. |
| Ervet (Breaker) | Kled, Gnar, Jayce | She shatters her own blade on purpose, both forms are melee, the reform is timed or manual, and her ultimate is a leap slam with an oversized blade. |
| Nurrow (Striker) | Lillia, Zoe, Mordekaiser; Naga Siren | Her sleeps give no wake-up bonus. Her ultimate sleeps everyone around a target except the target, which isolates it without a separate realm. |
| Lisvel (Slinger) | Ashe, Ezreal, Varus | Her piercing shots leave speed lines for allies, and her ultimate is a lasting haste corridor. No stun arrow, reveal shot or frost slow. |
| Ulkro (Slinger) | Zeri; Gyrocopter, Hoodwink | Her charge comes from distance run and is spent in one long throw. Her ultimate fires per 3 m travelled, not per second. |
| Tunlan (Caster) | Fiddlesticks, Vex; Dark Willow | Her fears are a line and a cone cast from her own lamp, her hand turns fear into a stun, and she runs on Heat. No root zone, on purpose. |
| Vashil (Caster) | Annie, Seraphine, Darius | His stun needs two hits on one enemy within 3 s, with an 8 s lockout per enemy. Peal is a ring cast at range and his ultimate tolls three times on one area. A shield-and-haste tool was dropped for Ring Out. |
| Sukri (Tender) | Kalista, Thresh, Kindred | He pulls any ally with a point-click shield, his ultimate gathers the whole team, and Spare Hour is a 1 s untargetable burst at his own low health, not a no-death zone. |

In the second column, names before the semicolon are from the primary reference game and names after it from the secondary one.

---

## (e) The protected-names registry

`_design/research/protected_names.json` (r11, generated 2026-10-07) holds **3,590 whole-word entries and 827 exact-name entries in 21 categories**. The rosters were parsed from game-data files, not memory: the primary reference game's data at patch 16.20.1 (173 champions) and the secondary's at the 6 October 2026 build (127 heroes), plus public data for other lane-brawlers. Entries that came from memory are marked [unverified] in r11.

| Category | Whole-word | Exact-name |
|---|---|---|
| `lol_champions` (173 champions plus 5 component names) | 178 | 0 |
| `spelling_variants` | 31 | 7 |
| `lol_champion_titles` | 152 | 21 |
| `lol_abilities` | 721 | 172 |
| `lol_maps_modes` | 70 | 10 |
| `lol_objectives_structures` | 93 | 2 |
| `lol_items` | 491 | 39 |
| `lol_runes_spells` | 74 | 39 |
| `lol_regions_lore` | 87 | 14 |
| `lol_ui_terms` | 48 | 14 |
| `lol_skins_lines` | 112 | 32 |
| `riot_trademarks` | 50 | 4 |
| `dota_heroes` | 127 | 0 |
| `dota_items` | 325 | 52 |
| `dota_neutral_enhancements` | 3 | 24 |
| `dota_abilities` | 604 | 217 |
| `dota_map_objectives` | 85 | 19 |
| `dota_modes` | 37 | 4 |
| `dota_terms` | 34 | 15 |
| `other_moba` (other lane-brawlers) | 239 | 122 |
| `generic_terms_to_avoid_as_proper_nouns` | 29 | 20 |
| **Total** | **3,590** | **827** |

**Decisions recorded in r11 §6:**

| Decision | Words |
|---|---|
| Denied as whole words, though most are English | Nexus, Rift, Inhibitor, Baron, Summoner(s), Smite, Flash, Rune(s), Radiant, Dire, Aegis, Tormentor, Roshan, Turbo, Hextech, Chemtech, Poro, Darkin, Yordle, Aghanim |
| Exact-name only (fine inside a longer name) | Ancient(s), Herald, Champion(s), Drake, Scuttle, Arena, Brawl, Clash, Honor, Mastery, Essence, Courier, Glyph, Shrine, Watcher, Outpost, Facet |
| Allowed as shared genre words | minion, creep, hero, lane, jungle, tower, turret, ward, buff, gank, carry, support, tank, last hit, deny, gold, boots, potion, recall, fountain, shop, core |

**Named in the owner's brief as off limits:** Riot, League of Legends, Summoner's Rift, Howling Abyss, Dota, and every fighter and skin name from those games (`_design/BRIEF.md`). All are in the registry.

**Allowed on purpose** (`_design/names_allowlist.json`): "Vale", the owner's working title, and "Rift" in the scope described at the top of this file.

**Known gaps** (r11 §8): augment names from the reference augment modes, the reference's auto-battler trait and unit names, hero lore names, and the full rosters of the large mobile lane-brawlers are not in the registry. Rebuild it from the same sources at every content milestone and before launch.
