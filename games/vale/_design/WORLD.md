# VALE · World Reference

For content writers, UI copywriters, artists and audio. The look is law in `_design/STYLE_BIBLE.md`; this sheet owns names, lore and voice. Every proper noun below passed `grep -i` against `_design/research/protected_names.json` and `node tools/names_check.ts` on 2026-10-07 (log at the end). Any new name must do the same before it ships, and the content build re-checks it (CONTRACT §3.4).

---

## 1. Premise

The Vale is a round valley that a forgotten people carved into one great sundial. Its hour-lines are a road wide, its numerals the size of houses, and at its centre a stone needle stood taller than any tower. The needle fell. Its shaft broke across the rim and lies over a gorge. Its shadow, impossibly, stayed on the stone.

Since then the light has stopped moving. The west rim lives in a morning that never ends; the east rim in an evening that never reaches night. Stalled light settles like water: it can be cupped in glass, burned in lamps, rung in bells and thrown as a weapon.

Two peoples keep the stopped hours. Each believes that the last bell left ringing will raise the needle in its own hour and set the day moving again on its terms. So they fight across the dial road by road (RIFT), and along the fallen shaft where it spans the gorge (BRIDGE).

Once a year the sun stands straight over the needle's seat and nothing in the Vale casts a shadow. At the **Shadowless Noon** nobody belongs to a side. Every fighter keeps only their own hour, and everyone fights everyone on the Noonplate (FRAY).

**Tone:** luminous, competitive, a little melancholy. Long light, clean stone, bright bells. Nobody is evil. A match is a public reckoning between neighbours, not a war; losing is respectable.

**What the Vale never contains:** gears, cogs, clock hands, steampunk brass, gold filigree, gems, glowing runes, snow, cities, harbours, industrial dressing, gore. Time is shown by light, shadow and carved stone only.

---

## 2. The two sides (RIFT and BRIDGE)

| | **Aubade** (team A) | **Serenade** (team B) |
|---|---|---|
| Name means | a morning song | an evening song |
| Rim and screen side | west, always screen-left | east, always screen-right |
| Stopped hour | the morning that never ends (morning shadows point west, so the morning hours lie on the dial's west side) | the evening that never reaches night |
| Architecture | **Spire**: vertical, thin, pointed, stacked; height ≥ 3× footprint; gables, open lattices | **Dome**: low, wide, round, banded; footprint ≥ 2× height; arches, drums, heavy plinths |
| Materials | chalk limestone, dawnglass (cool translucent glass), pale ash wood, blued steel, linen, gull-grey feather | ironstone, ochre sandstone, lampresin (warm translucent amber), walnut, oxidised iron, felt, waxed leather |
| Temperature (never a team hue) | cool: stone L* 66–72 with a blue-grey cast, cyan-blue glass | warm: stone L* 58–64 with an ochre cast, amber resin |
| Base landmark | the **Glass Belfry** | the **Lamp Dome** |
| BRIDGE gate | the **Dawn Arch** (glass) | the **Lamp Gate** |
| Spectator mark and colour | ▲ spire, Dawn azure `#3F9CFF` | ◠ dome, Dusk marigold `#FF9A1F` |
| Temperament | early risers: precise, idealistic, quick, impatient; they speak in short bright sentences and hate waiting | keepers of the long evening: patient, proud, generous, stubborn; warm humour, long memories, they hold a grudge the way stone holds heat |
| What they want | the needle raised at dawn, so every day begins again | the needle raised at dusk, so every day can finally rest |

**The readability rule in lore terms:** *stone tells you whose land; light tells you whose side.* Spires and domes, chalk and ironstone are the same for every viewer. Lamp cores, structure lights, bars and rings glow in the viewer's ally or enemy colour. An Aubade player sees the world in its canonical colours; a Serenade player sees warm domes with azure lamps, which still reads, because shape and stone carry the side.

**Fighters' origins:** about six of sixteen are Aubade-born, six Serenade-born and four **Hourless** (wanderers who keep no side's hour). Origin is lore only; any fighter plays for either team.

**Faces:** nobody in the Vale shows a bare face to the stopped sun. Aubade wear glass visors; Serenade wear carved or lacquered masks; the Hourless wear wraps or hoods. (Pipeline reason: no skin-modifier faces, no hair cards.)

---

## 3. The modes in the world

| Mode | Map | What happens there | Why it is built this way in the fiction |
|---|---|---|---|
| **RIFT** (5v5, three roads, jungle, structures before the core) | **Hourfall**, the dial itself | The war for the dial. The rift is the split between the stuck morning and the stuck evening. A team wins by silencing the enemy **Hourbell**. | Three carved roads run west–east across the dial; the **Noonline** (the dial's north–south noon line) is the river between the halves. |
| **BRIDGE** (one lane 5v5, random fighters, bench trade, teamfights) | **Needlespan**, the needle's fallen shaft over the gorge | One road along the shaft's flat top; the fight has nowhere to go but the middle, the **Snap**, where the needle cracked. | The gorge-keepers send fighters across **by lot**, never by choice, so fighters are random; a drawn fighter may be swapped once for one left on **the Lot** (the bench). |
| **FRAY** (free-for-all, small map, shared shop and pickups, respawn, placement) | **Noonplate**, the needle's round seat-stone at the Shadowless Noon | Ten fighters, ten hours, no sides. Each fighter takes one of ten carved **hour-marks** on the rim, respawns from it, and is ranked on the **Hour Board** by how well they kept their hour. | With no shadows there are no sides. Everyone shops at the one **Lampwright** cart on the plate and picks up **Sunmotes**, the motes of light that fall only at noon. Falling is not death: your hour-mark relights and you return. **Placement matters** because the fair is remembered by its order: the first-placed fighter strikes the year's first bell. |
| **Reserved slot** | an **uncarved hour** on the Mode Dial | A designed tile: "an hour not yet cut". A new mode in `modeSlots[]` carves it. | The dial has room for more hours than anyone has used. |

### Hourfall geography (RIFT)

- Bases west (Aubade, Glass Belfry) and east (Serenade, Lamp Dome); the map is a mirror image across the noon line.
- **North road, Mid road, South road** run west–east. The Mid road crosses **the Seat**, the needle's low round base-stone at the dial's centre (≤ 1 m high, never blocks sight).
- The **Noonline** runs north–south through the Seat. Its north half is the **Standing Shadow**: hard-edged, violet-cool stone that never fades (it is not fog of war). Its south half is the **Fallen Shaft**: needle segments lying in shallow water.
- **Longshade**'s pit lies on the noon line between the North and Mid roads, where the shadow's tip lies. **Sunsplinter**'s pit lies between the Mid and South roads, at the needle's broken tip.
- The jungle is the **Dialwood**: groves of lacquered, fan-leaved trees (instanced bevelled plates, no alpha cards) between the roads. Each quadrant has a giant half-buried numeral as its callout: **Elevenmark** (north-west), **Sevenmark** (south-west), **Twomark** (north-east), **Fourmark** (south-east). A bare "Seven" is a deny-list entry; the *-mark* form is mandatory.
- Brush is **Needlegrass**: tall stone-green blades ringed by a carved curb.

---

## 4. Naming

### 4.1 Two registers, never mixed

1. **Dial-tongue for *who*.** Fighters and people get short invented names in the dial-tongue (4.2).
2. **Plain English compounds for *what*.** Maps, places, structures, objectives, currencies, ranks and items use English roots a new player can parse on first read ("they're on Longshade", "our Lantern is down"). Roots: *Hour-, Noon-, Dial-, Needle-, Shade-/Shadow-, Lamp-, Glass-, Bell-, Light-* with *-fall, -span, -plate, -line, -mark, -ward, -wake*. At most two roots per name. **No possessives** ("X's Y") and no "the [Adjective] [Noun]" epithet titles: the reference games lean on both.

### 4.2 Dial-tongue: the fighter-name palette

| Rule | Value |
|---|---|
| Letters | **a b d e h i k l m n o r s t u v** (exactly 16), the diphthong *au*, and *sh* / *th* only inside a word. *g p w* at most 2 of 16 names each |
| Initials | **the 16 launch fighters take one initial each** (A B D E H I K L M N O R S T U V), so minimap, scoreboard and pings can fall back to one letter |
| Shape | 2 syllables (≥ 12 of 16), 3 at most; 4–9 letters; stress on the first syllable; readable aloud on first sight |
| Uniqueness | no two names share their first two letters or their last three |
| Distance | edit distance ≥ 3 from every champion, hero and character name in `protected_names.json` (`lol_champions`, `dota_heroes`, `other_moba`, `spelling_variants`) |
| Banned | c f j q x y z; apostrophes, hyphens, diacritics; doubled vowels; titles or epithets in the name field; endings *-iel -wen -thel -us -ius -ia -gar -gor -ak*; onsets *Kha Vel Zh Xer* |
| Aubade-born | front vowels *i e a*, liquid onsets *l r v*; end in a vowel, *-l* or *-t* |
| Serenade-born | back vowels *o u a*, nasals and stops; end in *-m -n -nd -or -ow* |
| Hourless | one heavy stressed syllable plus a light one; end in *-i* or *-o* |
| Morphemes (lore glossary) | *il* light · *sen* shade · *dun* late day · *tav* hour · *hes* point, needle · *mar* stone · *row* song · *lan* lamp · *au* dawn |

**Example roster (one per initial; all clean on grep, `names_check.ts` and the distance rule; illustrative, the content lane names the real roster):**

| Aubade-born | Serenade-born | Hourless |
|---|---|---|
| Aletha · Eltiva · Ilvane · Restil · Tavrel · Vilmet | Dunmarrow · Lantor · Mosund · Nubor · Ostram · Sobrun | Butomi · Hulbo · Kemmi · Umbo |

A fighter's UI tag is their role (4.3 "Roles"), never an epithet: "Tavrel · Striker", not "Tavrel, the Something".

### 4.3 Glossary of coined terms

| Term | What it is | Used in |
|---|---|---|
| **Aubade / Serenade** | the two sides (west / east) | team names, spectator, lore |
| **Hourless** | fighters who keep no side's hour | lore, collection filters |
| **Hourfall** | the RIFT map, the dial itself | map name |
| **Needlespan** | the BRIDGE map, the fallen shaft over the gorge | map name |
| **Noonplate** | the FRAY map, the needle's seat-stone at noon | map name |
| **Shadowless Noon** | the yearly hour with no shadows; the reason FRAY exists | lore, FRAY intro |
| **Gleam** | in-match currency (gold), spent at the Lampwright | HUD, shop |
| **Candles** | earned account currency (unlock fighters, some cosmetics) | client, rewards |
| **Prisms** | premium (bought) currency | store |
| **Needle** | lane tower; its attack range is drawn as its "shadow ring" | RIFT, BRIDGE |
| **Lantern** | lane gate behind a road's last Needle; holds that road's stored light; must fall before the core | RIFT |
| **Hourbell** | the core; "silence the Hourbell" wins | RIFT, BRIDGE |
| **Glass Belfry / Lamp Dome** | Aubade / Serenade base (spawn, shop) | RIFT |
| **Dawn Arch / Lamp Gate** | Aubade / Serenade ends of Needlespan | BRIDGE |
| **the Snap** | Needlespan's central plaza where the shaft cracked; the teamfight floor | BRIDGE |
| **the Lot** | BRIDGE's random fighter draw and its swap bench | BRIDGE draft |
| **Wicks** | lane minions: small lamp-bearers that walk the roads | all team modes |
| **Noonline** | the river (the dial's noon line) | RIFT |
| **Standing Shadow / Fallen Shaft** | north half / south half of the Noonline | RIFT callouts |
| **the Seat** | the needle's base-stone at the dial's centre (Mid road crosses it) | RIFT callout |
| **Sunsplinter** | repeatable objective: a construct of the needle's broken tip. Each kill gives the team one **Splinter** (stacking boon) | RIFT |
| **Longshade** | late siege objective: the beast that lives where the shadow ends. Its kill grants the living team **the Long Shade** (siege boon) | RIFT |
| **Dialwood** | the jungle groves between the roads | RIFT |
| **Elevenmark · Sevenmark · Twomark · Fourmark** | jungle quadrant callouts (NW · SW · NE · SE) | RIFT callouts |
| **Glasshorn** | buff camp: a stag with glass antlers; grants **Clearglass** (resource and cooldown boon) | RIFT jungle |
| **Resinback** | buff camp: an amber-backed beast; grants **Resinburn** (damage-over-time on hit) | RIFT jungle |
| **Gloamoths · Stilltusks · Strays** | regular camps: light-moths; still-tusked boars; **Strays** are carved numerals that walked off the dial | RIFT jungle |
| **Needlegrass** | brush | all maps |
| **the Lampwright** | the shop and its keeper | all modes |
| **Sunmotes** | shared pickups that fall at noon | FRAY, BRIDGE |
| **Seats I–X, hour-marks** | FRAY slots and their rim respawn points | FRAY |
| **the Hour Board** | FRAY placement board | FRAY HUD, post-game |
| **Light · Tally · Heat** | fighter resources: pool (stored light) · builds up per action · overheats | HUD, kits |
| **Plinth · Breaker · Striker · Slinger · Caster · Tender** | roles: tank · bruiser · assassin · marksman · mage · support | draft, collection |
| **Lamplit → Greylight → Rosewake → Clearmorn → Highsun → Noonward → Unshadowed** | ranked tiers, climbing the sun (rank = brightness) | ranked |
| **Slate · Verdigris · Gloam · Noonlit** | item tiers (1–4 hour-ticks on the frame) | shop |
| **the Almanac** | the season pass | client |
| **the Mode Dial · the uncarved hour** | mode select · the reserved mode slot | client |
| **the Rim at the Split Hour** | the live 3D menu scene | client |
| **Dawnglass · Lampresin** | Aubade glass · Serenade amber resin (materials, lore text) | lore, skins |
| **Noonwhite · Dawn azure · Dusk marigold · Dialstone** | self · ally · enemy/harm · neutral colour names (settings) | settings, accessibility |
| **FRAY seat names** | Crimson, Olive, Lime, Green, Cyan, Blue, Indigo, Violet, Plum, Rose | voice callouts, Hour Board |

`RIFT`, `BRIDGE`, `FRAY` are the owner's mode names. "Rift" is allowlisted **only** as the mode and queue name (`_design/names_allowlist.json`): never a map, objective, structure, item or currency.

### 4.4 Names rejected (do not reuse)

| Name | Why |
|---|---|
| Anything **Kiln-** (Kiln, Kilnhollow, Kilnyard, Bellkiln, Kilnglass), "the Wheel", ceramic/pottery fighters as a world premise | *Kiln* is a shipped 2026 online pottery team-brawler by Double Fine, whose win condition is the enemy's kiln. A pottery world would read as derivative. |
| Vanguard, Warden, Marksman (as role names), Keeper | LoL class/subclass names; "Keeper" sits too close to Dota's *Keeper of the Light* in a light-themed world |
| Facets · Pearl | deny-list hits (Dota term · other-MOBA name) |
| Hourglass (as a glyph name) | adjacent to a famous LoL item; the glyph is the **sandglass** |
| Seven (bare) · Porcelain · Keystone · Bulwark · Glyph · Mark · Wisp | deny-list entries (exact or category) |
| Penumbra · Meridian · Cairn · Spindrift · Uncharted | existing game titles or series |
| Skyglass · Ithra · Kellam · Vosk | trademark, brand or existing character |
| Obran, Avira, Hesk, Visel, Reska, Elvit, Kemi, Bodri | within edit distance 2 of a protected character name (e.g. Obran ~ Brand) |

---

## 5. Voice: how the UI talks

1. **Plain first, world second.** Every string must work for a player who never reads lore. At most one world word per string, and none in errors, settings, payments or reports.
2. **Second person, present tense, sentence case.** Buttons are one or two verbs ("Ready", "Lock in", "Buy"). Titles are nouns.
3. **Exact numbers with units.** "12 s", "1,350 Prisms", "3 of 5". Times as m:ss above a minute.
4. **Never mock, never blame.** Defeat is dignified; penalties are factual and say when they end.
5. **Short.** Toasts ≤ 60 characters; tooltips ≤ 2 sentences; empty states one sentence and one action.
6. **Light and time metaphors only in celebration and flavour slots** (victory and defeat sub-lines, mode cards, empty states), never in warnings.
7. **No exclamation marks.** The banner, sting and motion carry the excitement.
8. Use the reference genre's words only when they are plain English (*draft*, not the reference game's screen names).

| Moment | String |
|---|---|
| Queue found | **Match found** · "RIFT · Ranked. Ready in 12 s." · [Ready] [Decline] |
| Searching | "Searching · 1:24 · usually under 2:00" |
| Lock-in disabled | "Pick a fighter to lock in." |
| Victory | **Victory** · "Their Hourbell is silent." |
| Defeat | **Defeat** · "Your Hourbell fell quiet. The light holds for another day." |
| FRAY placement | **2nd of 10** · "You kept your hour longer than eight others." |
| Purchase confirm | "Buy Lamplit Visor for 1,350 Prisms?" · [Buy] [Cancel] → after the server confirms: "Lamplit Visor is yours. Equip it?" |
| Empty collection | "No skins for Tavrel yet." · [Browse the shop] |
| Empty history | "No matches yet. Play one and it will be kept here." |
| Locked | "Reach level 20 to play Ranked." |
| Error | "Couldn't reach the server. Check your connection." · [Retry] |
| Reconnect | "Connection lost. Rejoining your match…" |
| Reserved mode slot | **The uncarved hour** · "A new mode will be cut here." |
| Level up | "Level 12 · +250 Candles" |
| Leaving draft | "You left the draft. You can queue again in 6:00." |

---

## 6. Verification log (2026-10-07)

- **Deny-list:** `grep -i` of every coined term and example name against `protected_names.json`. Only substring hits inside longer protected phrases (e.g. "Gleam" in "Gleaming Quill", "Needle" in "Needlework", "Lantern" in a multi-word item); policy allows these. `node tools/names_check.ts` on 101 + 89 strings returned **clean, exit 0**.
- **Edit distance:** Levenshtein ≥ 3 for all 16 example fighter names against the four character categories.
- **Web checks** (game/IP collisions): "Kilnhollow" and the ceramic-fighter concept (found Double Fine's *Kiln*, 2026, so the ceramic world was dropped); "the Wakened" (no exact game faction); "Wheel"/"Slab" factions (none); "Hourfall" (no game); "Aubade"/"Serenade" factions and sundial worlds (none; Destiny 2 has a seasonal activity called "the Sundial", so no Vale name may be "Sundial"); "Hourbell", "Needlespan", "Noonplate", "Sunsplinter" (none).
- Sources: [Double Fine: Kiln announcement](https://www.doublefine.com/news/announcing-our-new-game-kiln) · [Xbox Wire: Kiln launch tips](https://news.xbox.com/en-us/2026/04/23/kiln-get-started-pottery-party-brawler-journey-launch-day-tips/) · [Destinypedia: Sundial Spire](https://www.destinypedia.com/Sundial_Spire) · [Guild Wars 2 wiki: Free Awakened](https://wiki.guildwars2.com/wiki/Free_Awakened)
