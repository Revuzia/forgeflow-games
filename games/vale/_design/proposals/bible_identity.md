# VALE style bible proposal: "The Stopped Dial" (world identity first)

**Status:** proposal for the STYLE_BIBLE (lane LEAD). **Angle:** start from the world, then derive palette, type, menus, camera, HUD, VFX and audio from it, without giving up competitive readability.
**Sources used:** research notes r04, r05, r06 and r07 (read in full), plus r01–r03, r08 and r10 (skimmed for systems and rendering facts), `_spec/CONTRACT.md` and `src/contracts/catalog.ts`.
**What was verified locally:** font packages (npm and fontTools), every coined name (grep on the deny-list plus `tools/names_check.ts`), and every color claim. The color claims come from a script that computes WCAG contrast, CIELAB L* and ΔE2000 under Machado-2009 CVD simulation at severity 1.0. Numbers marked *computed* are reproducible from that script. See the appendix.

**The visual hook in one line:** the vale's whole floor is a single enormous sundial whose stone needle has fallen, and the needle's shadow stayed behind. So the map has a carved dial-floor, a broken needle lying across the river, and a shadow with no object casting it. Morning is stuck on one side and evening on the other. No other lane-brawler has a time-of-day split built into the map itself.

---

## 1. WORLD

### 1.1 Premise (243 words, including the tone line)

The vale is a round valley carved by a forgotten people into one great sundial. Its hour-lines are a lane wide, its numerals the size of houses, and at its centre stood a needle taller than any tower. The needle fell. Its shaft lies broken along the noon line. Its shadow, impossibly, stayed on the stone. Since then the light has stopped moving. The western rim lives in a morning that never ends, and the eastern rim in an evening that never reaches night. The stalled light settles like water. It can be cupped in glass, burned in lamps, rung in bells and thrown as a weapon.

Two peoples keep the stopped hours. **The Aubade** sing the morning and build tall and thin: chalk spires capped with dawnglass, cool, upright and sharp. **The Serenade** sing the evening and build low and round: ironstone domes ringed with lampresin, warm, heavy and settled. Each believes the last bell left ringing will raise the needle in its own hour. So they fight across the dial lane by carved lane (RIFT), and along the fallen shaft where it spans the gorge (BRIDGE).

Once a year the sun stands straight over the needle's seat and nothing in the vale casts a shadow. At the Shadowless Noon nobody belongs to a side. Every fighter keeps only their own hour, and everyone fights everyone on the Seat (FRAY).

**Tone:** luminous, competitive, a little melancholy. Long light, clean stone, bright bells.

### 1.2 The two sides

| | **Aubade** (team 0, canonical bottom-left) | **Serenade** (team 1, canonical top-right) |
|---|---|---|
| Hour | the stopped morning (a dial's morning hours sit on its *west* side, because the morning shadow points west) | the stopped evening (east side) |
| Architecture shape | **Spire**: vertical, thin, pointed, stacked; height ≥ 3× footprint; triangular gables; open lattices | **Dome**: low, wide, round, banded; footprint ≥ 2× height; arches and drums; heavy plinths |
| Materials | chalk limestone, dawnglass (cool translucent, clearcoat), pale ash, blued steel, linen | ironstone and ochre sandstone, lampresin (warm translucent amber), walnut, oxidised iron, felt |
| Color temperature | cool. Stone L* 66–72 with a blue-grey cast. Glass is cyan-blue | warm. Stone L* 58–64 with an ochre cast. Resin is amber |
| Team mark (CVD shape code) | **▲ Spire glyph** | **◠ Dome glyph** |
| Absolute UI color (spectator) | Dawn azure `#3F9CFF` | Dusk marigold `#FF9A1F` |

**Rule: stone tells you whose land it is, and light tells you whose side someone is on.** Massing, stone and the Spire/Dome glyph are absolute and the same for every viewer. Every glowing accent is relationship-colored for players: the `accent` emissive on fighters, structure crystals and lamp cores, bars and rings (ally = azure, enemy = marigold). For spectators these glows switch to absolute colors (Aubade azure, Serenade marigold). An Aubade player therefore sees the world in its canonical colors. A Serenade player sees warm domes with azure lamps, which is still unambiguous because shape and stone carry the side.

### 1.3 Why each mode exists in the fiction

- **RIFT** (5v5, three lanes, jungle, structures before the core): the war for the dial itself. "Rift" is the split between the stuck morning and the stuck evening. A team wins by silencing the enemy **Hourbell**.
- **BRIDGE** (one lane, random fighters with a bench trade): the needle's shaft fell beyond the dial rim and now spans a gorge. A single lane runs along its flat top, so the fight has nowhere to go but into the middle. Fighters are sent across by lot, which is why they are random.
- **FRAY** (free-for-all, small map, shared shop and pickups, respawn, placement): the Shadowless Noon on the needle's round **Seat**. With no shadows there are no sides. Each fighter takes one of ten hour-marks on the rim, respawns from it, and is ranked by how well they keep their hour.
- **Reserved slot:** on the Mode Dial (section 4) this is an **uncarved hour mark**, a designed tile that reads "an hour not yet cut".

### 1.4 Naming conventions

**Places** are one-word English compounds built from a fixed root set: *Hour-, Noon-, Dial-, Needle-, Shade-/Shadow-, Lamp-, Glass-, Bell-* plus *-fall, -span, -plate, -line, -ward, -wake*. Use at most two roots. Possessives (`X's Y`) are banned, because the reference games lean on them.
**Structures** are plain timekeeping nouns: **Needle** (tower, a small gnomon whose "shadow ring" is its attack range), **Lantern** (the lane gate that must fall before the core, holding that lane's stored light), **Hourbell** (the core).
**Objectives** are a light or shade word fused with a physical noun: **Longshade** (the beast of the standing shadow), **Sunsplinter** (a construct made from the needle's broken tip).
**Currency** is named after substances of light: **Gleam** (in-match, spent at the shop) and **Candles** (earned only, unlocks fighters and cosmetics).
**Ranks** are times of day, climbing toward noon (section 2.8).
**Fighters** follow the dial-tongue phonetic palette below.

**Dial-tongue (the fighter-name palette):**
- **Letters:** a b d e h i k l m n o r s t u v, the diphthong *au*, and *sh*/*th* in the middle of a word only. *g p w* are allowed in at most 2 of 16 names each. **Banned:** c f j q x y z, apostrophes, hyphens, diacritics, doubled vowels, titles and epithets in the name field, and the *-iel/-wen/-thel* elvish endings.
- **Shape:** 2 syllables (at least 12 of 16), 3 at most, 4–9 letters, stress on the first syllable, readable aloud on first sight. No two fighters may share their first two letters or their last three. No name may be within edit distance 2 of a single-word deny-list entry.
- **Allegiance is heard in the ending** (lore only, never a gameplay rule):
  - *Aubade-born* (front vowels i/e/a, liquid onsets l/r/v) end in a vowel, *-l* or *-t*.
  - *Serenade-born* (back vowels o/u/a, nasals and stops) end in *-m, -n, -nd, -or* or *-ow*.
  - *Hourless* wanderers are one heavy syllable, or CVCV ending in *-i/-o*.
  - Suggested 16-split: 6 / 6 / 4.
- **Morphemes** for the lore glossary: *il* light · *sen* shade · *dun* late day · *tav* hour · *hes* point/needle · *mar* stone · *row* song · *lan* lamp · *au* dawn.
- **Fighter examples:**
  - Aubade-born: *Ilvane* (light that turns), *Tavrel* (hour-keeper), *Reska*
  - Serenade-born: *Dunmarrow* (evening-stone-song), *Senrow* (shade-song), *Sauden*, *Lantor* (lamp-bearer)
  - Hourless: *Hesk* (the point), *Tobri*

### 1.5 Coined proper nouns, verified

All of the names below returned **0 hits** from `grep -i` on `protected_names.json` (a substring hit is noted when a longer protected name contains the word), and **clean** from `node tools/names_check.ts`. That covers 102 strings in four runs. Known-IP screening was done from knowledge, and the rejects are listed.

| # | Name | Use | grep | names_check |
|---|---|---|---|---|
| 1 | Aubade | side (morning) | 0 | clean |
| 2 | Serenade | side (evening) | 0 | clean |
| 3 | Hourfall | RIFT map | 0 | clean |
| 4 | Needlespan | BRIDGE map | 0 | clean |
| 5 | Noonplate | FRAY map | 0 | clean |
| 6 | Hourbell | core structure | 0 | clean |
| 7 | Longshade | shadow-side objective | 0 | clean |
| 8 | Sunsplinter | needle-side objective | 0 | clean |
| 9 | Gleam | in-match currency | substring only ("Gleaming Quill"), whole-word clean | clean |
| 10 | Candles | earned currency | 0 | clean |
| 11 | Ilvane · Tavrel · Reska · Dunmarrow · Senrow · Sauden · Lantor · Hesk · Tobri | fighter examples | 0 each | clean |
| 12 | Dawnglass · Lampresin | materials (lore text) | 0 | clean |
| 13 | Lamplit · Greylight · Rosewake · Clearmorn · Highsun · Noonward · Unshadowed | rank tiers | 0 each | clean |
| 14 | Shadowless Noon · Standing Shadow · Noonline · The Seat · The Snap · Wicks (minions) | places, landmarks, units | 0 each | clean |
| 15 | Glass Belfry · Lamp Dome · Dawn Arch · Lamp Gate · Fallen Shaft · Sevenmark · Fourmark · Elevenmark · Twomark · Dialwood | landmarks | 0 each | clean |
| 16 | Noonwhite · Chalkstone · Gloam · Noonlit · Verdigris · Lampwick · Hourless | token, tier and lore words that may surface in UI | 0 each | clean |

**Rejected while coining:**
- *Penumbra* and *Meridian*: names of existing game series.
- *Skyglass*: a TV product trademark.
- *Kellam*: a Fire Emblem character.
- *Vosk*: an existing fictional name.
- *Crack*: a deny-list entry.
- *Terminator*: a film IP.
- *Seven*, as a bare landmark callout: a deny-list entry, so the numerals take the *-mark* form.

**Deny-list adjacency to respect.** The registry lists two bridge-themed single-lane maps from the reference game (*Butcher's Bridge*, *Bridge of Progress*). Needlespan must therefore be a fallen natural monolith over a gorge: no built deck, railings, city backdrop, harbor or industrial dressing. It must also not be snowy.

---

## 2. PALETTE

**Principle: color is a gameplay resource, and the client spends almost none of it.** The client runs on ink, chalk and light. A saturated hue appears only where it means something: relationship, damage type, rarity, rank or mode. Default relationship colors are chosen so **one default view works for all four vision types** (r06: "a CVD-safe default beats a separate colorblind mode"). The alternates widen the margins further.

### 2.1 UI neutrals ("Ink and Chalk")

| Token | Hex | Role | L* | Contrast (WCAG) |
|---|---|---|---|---|
| `--ink-0` | `#0B0D11` | page backdrop, scrims, vignette | 4 | — |
| `--ink-1` | `#11141A` | base surface, all bar backgrounds | 6 | — |
| `--ink-2` | `#171B22` | panel plate | 9 | — |
| `--ink-3` | `#1E232C` | raised / hover plate | 13 | — |
| `--ink-4` | `#262C37` | pressed well, selected background | 17 | — |
| `--line-1` | `#2C333F` | hairline divider | 21 | 1.4 on ink-2 (decorative only) |
| `--line-2` | `#3D4656` | input outline, locked dashed border | 30 | 1.8 on ink-2 (paired with text) |
| `--text-1` | `#EDE6D6` | primary text ("chalk") | 91 | **13.9** on ink-2, 15.6 on ink-0 (AAA) |
| `--text-2` | `#ABA597` | secondary text | 68 | **7.0** on ink-2 (AAA) |
| `--text-3` | `#6E6B66` | disabled text | 45 | **3.3** on ink-2 (disabled text is exempt from WCAG; kept above 3:1 so it stays visible) |
| `--chalk` / `--chalk-hi` | `#EDE6D6` / `#FFF8EA` | primary CTA plate / its hover | — | ink-0 text on chalk **15.6**, on chalk-hi 18.4 |
| `--brand-gloam` | `#A99BFF` | brand mark, "new" dots, season/pass, and the T3 item-tier frame (the twilight between hours). Never on world overlays. | 69 | 7.3 on ink-2 |

### 2.2 Relationship and team colors, with CVD alternates and double coding

| Role | Default | Deutan alt | Protan alt | Tritan alt | Shape and mark (always on, in every palette) |
|---|---|---|---|---|---|
| **SELF** ("Noonwhite") | `#F4EFE2` | `#FBF8F0` | `#FBF8F0` | `#FBF8F0` | Ground ring: solid, with a **gnomon wedge** at the facing direction. Bar: **double frame** (chalk 2 px + ink 1 px). Minimap: wedge arrow. |
| **ALLY** ("Dawn azure") | `#3F9CFF` | `#2FA8FF` | `#3F9CFF` | `#2FA8FF` | Ring: **12 dashes (hour ticks)**. Bar: rounded ends. Minimap: round portrait, azure ring. |
| **ENEMY / HARM** ("Dusk marigold") | `#FF9A1F` | `#FFC21F` | `#FFC21F` | `#FF3D6E` | Ring: solid with **4 inward notches**. Bar: **pointed chevron ends**. Minimap: round portrait plus a heading wedge. Every harmful telegraph fill uses this token. |
| Team A **Aubade** (spectator) | `#3F9CFF` | as ally alt | as ally alt | as ally alt | **▲ Spire** glyph on scoreboard, structure bars, minimap structures |
| Team B **Serenade** (spectator) | `#FF9A1F` | as enemy alt | as enemy alt | as enemy alt | **◠ Dome** glyph |

*Computed:* minimum ΔE2000 between {self, ally, enemy} and the terrain and bar references (lane `#9A927F`, jungle `#4E5547`, river `#5F6E73`, bar background `#11141A`).

| Palette | normal | deutan | protan | tritan |
|---|---|---|---|---|
| Default | 24.2 | 24.0 | 21.7 | 21.2 |
| Deutan alt | 26.2 | 26.1 | 26.6 | 20.9 |
| Protan alt | 26.1 | 26.1 | 26.6 | 20.9 |
| Tritan alt | 26.2 | — | — | 26.2 |

The tritan alt is for tritan viewers only, because its enemy rose collapses under protan (5.6). As text on `--ink-1`: ally 6.5:1, enemy 8.7:1, self 16.1:1.

*Why not the classic red enemy:* under protan, `#FF5C39` darkened into the lane stone (ΔE 15.7, computed). Marigold holds at 21.7.

**Settings:**
- Colorblind mode: off, deutan, protan, tritan.
- **Enemy color override:** 6 presets.
- **Self color override:** 4 presets.
- High-visibility bars (+2 px height and a 1 px chalk outline).
- **Simple colors** for FRAY: self Noonwhite, everyone else marigold.

### 2.3 FRAY seat colors: ten hours, each with a glyph

Seat colors are **stable for every viewer and for spectators**, so a callout like "Indigo is leading" means the same thing to everyone. The local player keeps their seat color but adds the SELF shape grammar (double frame, gnomon wedge). Each seat respawns from its own carved hour-mark on the Noonplate rim.

| Seat | Name | Hex | L* | Glyph | vs basalt floor ΔE | Text contrast on ink-1 |
|---|---|---|---|---|---|---|
| I | Red | `#E0303A` | 50 | ● dot | 32.9 | 4.1 |
| II | Apricot | `#FFA273` | 75 | ○ ring | 49.2 | 9.4 |
| III | Yellow | `#FFDD33` | 89 | ▲ triangle | 58.3 | 13.7 |
| IV | Lime | `#74C41F` | 72 | ■ square | 50.1 | 8.5 |
| V | Mint | `#45F2B5` | 86 | ◆ diamond | 56.9 | 12.8 |
| VI | Sky | `#52D1EB` | 78 | ✚ plus | 51.7 | 10.3 |
| VII | Blue | `#1F86C8` | 54 | ▬ bar | 32.3 | 4.7 |
| VIII | Indigo | `#6C52EB` | 46 | ☾ crescent | 35.5 | 3.6 |
| IX | Orchid | `#E873FF` | 67 | ⌃ chevron | 48.5 | 7.3 |
| X | Berry | `#D9217D` | 49 | ⧗ hourglass | 33.5 | 3.9 |

- **Spread:** L* runs from 46 to 89 and hue covers the full wheel. The set was optimised with a maximin search over 131 candidates, then hand-tuned.
- **Normal vision:** minimum ΔE 19.4 (Red/Berry).
- **Under CVD,** these pairs fall to 6.8–9.6 and the **glyph carries them** (they were deliberately given dissimilar glyphs):
  - deutan: Blue/Indigo (▬ vs ☾), Apricot/Lime (○ vs ■), Sky/Orchid (✚ vs ⌃)
  - protan: Blue/Orchid, Yellow/Lime
  - tritan: Mint/Sky, Red/Berry
- **Where the glyph appears:** in the bar's level chip, on the minimap icon, in the kill feed, on the Hour Board and stamped on the back of the ground ring.
- **Glyph sets never meet:** seat glyphs are FRAY-only and the Spire/Dome team marks are RIFT/BRIDGE-only, so seat III's filled triangle never appears beside the Aubade spire.
- **Dark seats on the ink HUD:** the dark seats (I, VII, VIII, X) are always drawn with a 1 px chalk keyline on ink.

### 2.4 Damage, heal, shield

| Meaning | Token | Hex / treatment | Notes (computed) |
|---|---|---|---|
| Physical | `--dmg-phys` "Chalkstone" | `#F1E2C6` | L* 90 |
| Magic | `--dmg-magic` "Orchid-rose" | `#FF7BD5` | vs physical: ΔE 41.9 normal, 29.2 deutan, 37.6 protan, 24.3 tritan. Avoids the violet-to-azure collapse that `#D27BFF` showed under protan (2.7). |
| True | `--dmg-true` "Shade" | **ink `#101216` numerals with a 2 px Noonwhite halo** (inverted value) | 16.3:1 internal contrast. True damage is the stopped shadow, and the value inversion reads on any ground. |
| Heal | `--heal` "Sap" | `#63D88B`, always with a "+" prefix | phys/heal deutan ΔE 10.6, so the "+" and the motion (rise vs fall) disambiguate |
| Shield | `--shield` "Pearl" | `#DCE8EE` with a **45° hatch** | hatch = shape code |

### 2.5 Status and feedback (client and HUD)

- **Warning:** Noon yellow `#F6D04D`, always with a ▲ glyph. 11.6:1 on ink-2.
- **Danger / error:** the HARM token (`--enemy`), always with a wedge "!" glyph. "Marigold means it can hurt you" holds everywhere, menus included.
- **Success:** Sap `#63D88B` with a ✓. 9.6:1.
- **Info:** chalk.

### 2.6 Resource bar colors (catalog `ResourceDef.color` may only pick from these)

| Resource model | Hex |
|---|---|
| pool | Gloam-lite `#8F86F0` |
| build | Lampwick `#E8C27A` |
| heat | Kiln `#D96A4A` (drawn with a heat hatch) |
| none | no bar |

These colors always sit in the second bar row, so **position disambiguates** them from relationship hues.

### 2.7 Item tiers (shop and inventory frames; tier = number of hour-ticks on the frame)

| Tier | Ticks | Name | Hex |
|---|---|---|---|
| T1 | 1 | Slate | `#8E96A3` |
| T2 | 2 | Verdigris | `#5FBFA8` |
| T3 | 3 | Gloam | `#A99BFF` |
| T4 | 4 | Noonlit | `#FFF4DA` with a soft glow |

The tick count is the primary code: under deutan, T1 and T2 are only ΔE 9.6 apart (computed).

### 2.8 Rank tiers: "the climb of the sun", where rank equals brightness

L* rises monotonically, so rank reads in grayscale.

| Tier | Name | Hex | L* |
|---|---|---|---|
| 1 | Lamplit | `#8A6248` | 45 |
| 2 | Greylight | `#7D8A9E` | 57 |
| 3 | Rosewake | `#D9897F` | 65 |
| 4 | Clearmorn | `#8FB8E0` | 73 |
| 5 | Highsun | `#E8D39A` | 85 |
| 6 | Noonward | `#F4EEDD` | 94 |
| 7 | Unshadowed | `#FFFFFF` with a prismatic rim | 100 |

**Emblem:** a dial disc showing the sun at the tier's height, with the shadow growing shorter at each tier. At Unshadowed there is no shadow at all.

### 2.9 Mode accents (mode cards and backgrounds only)

| Mode | Accent |
|---|---|
| RIFT | a split card: azure on the left, marigold on the right, the stuck hours |
| BRIDGE | Gorge rose `#E59A8C` |
| FRAY | Noon `#F6D04D` |
| Reserved | Unlit `#6E7380` |

---

## 3. TYPE

All four faces were verified on 2026-10-07 with `npm view` (license OFL-1.1). The packages were downloaded and their latin woff2 files inspected with fontTools.

| Role | Face | Package (version) | Verified facts | Why this face for this world |
|---|---|---|---|---|
| **Display** | **Gloock** | `@fontsource/gloock` 5.3.0 | single weight 400; `tnum` + `pnum` present; Roman numerals I V X L C present | A high-contrast Scotch-Roman serif, the lettering of almanacs and instrument dials (almanacs print the hours of sunrise and sunset). Thick and thin strokes read as lit and shadowed. It is unlike the flared wedge-serif look of the reference game and unlike any "fantasy" face. |
| **Heading / labels / buttons** | **Instrument Sans Variable** | `@fontsource-variable/instrument-sans` 5.3.0 (`standard.css`: wght 400–700, **wdth 75–100**) | `tnum` present | A crisp grotesque. The width axis gives semi-condensed caps (wdth 88) for tabs and buttons, which leaves the 35% localisation headroom r05 asks for. |
| **Body** | **Atkinson Hyperlegible Next** | `@fontsource/atkinson-hyperlegible-next` 5.3.0 (weights 200–800) | `tnum` present | Built for low-vision legibility. "Spectator clarity beats decoration" applies to text as well. |
| **Numeric** | **Atkinson Hyperlegible Mono** | `@fontsource/atkinson-hyperlegible-mono` 5.3.0 (weights 200–800) | all digits 632 units wide, so **tabular by construction** | Timers, gold, cooldowns, damage numbers and stats never jitter, and the distinct 0/O and 1/l shapes come from the same hyperlegible design. |

### Scale at 1080p

UI scale 100% = 1080p reference. At 720p the scale is 0.75, and **no text goes below 12 px**.

| Token | Face | Size / line | Weight | Tracking | Casing |
|---|---|---|---|---|---|
| `display-xl` | Gloock | 112/112 | 400 | +0.02em | ALL CAPS only for single result or mode words (VICTORY, RIFT) |
| `display-l` | Gloock | 72/76 | 400 | 0 | Title Case (fighter names on splash, map names) |
| `display-m` | Gloock | 44/48 | 400 | 0 | Title Case (screen titles). **Never below 28 px.** |
| `h1` | Instrument Sans | 24/28 | 650, wdth 88 | +0.06em | CAPS |
| `h2` | Instrument Sans | 18/24 | 600, wdth 88 | +0.08em | CAPS |
| `label` / button | Instrument Sans | 15/20 | 600, wdth 90 | +0.06em | CAPS |
| `body` | Atkinson Next | 16/24 | 400 | 0 | Sentence case |
| `body-s` | Atkinson Next | 14/20 | 400 | +0.01em | Sentence case |
| `caption` | Atkinson Next | 13/18 | 500 | +0.02em | Sentence case |
| `num-hud` | Atkinson Mono | 18 (gold), 20 (clock), 22/700 (cooldown) | 500–700 | 0 | — |
| `num-dmg` | Atkinson Mono | 18/700, crit 26/800 | — | -0.02em | — |
| `overhead-name` | Atkinson Next | 12/14 | 600 | +0.02em | with a 2 px ink outline (SDF or text-shadow stack) |

**Rules:**
- Never put text inside images.
- Every number uses `font-variant-numeric: tabular-nums`, or the Mono face.
- No faux bold, no outline text, no gradients on text.
- Preload Gloock and Atkinson Next 400/600. Display text uses `font-display: block` with a 300 ms budget. Body uses `swap` with size-adjusted fallbacks so layout never shifts.

---

## 4. MENU MOOD: "honed stone in long light"

### 4.1 Materials and surfaces

- **Plates** are honed slate.
  - Surface: `--ink-2` at **94% opacity** over the 3D scene, plus a static 128 px grain tile (2% multiply).
  - Edges: a 1 px top-edge catch-light `rgba(237,230,214,0.06)`, because the sun comes from the upper left, and a 1 px bottom-right inner shade at 40% ink.
  - Corner radius: **2 px** (cut stone).
- **No glassmorphism.** `backdrop-filter` blur over the WebGL canvas is banned: it forces a re-composite of the canvas every frame and stutters.
- **Dawnglass inlays** are the only translucent material. Used only for "lit" states: selected, ready, the primary CTA hover. Treatment: a desaturated cool inner gradient `#BFD3E6` → transparent at 10% (deliberately not the ally azure), plus a 1 px chalk rim.
- **Chalk plate** is the primary CTA (one per screen): an opaque `--chalk` fill with ink text. On hover a **shadow line** (a soft 30° dark band at 25% ink) sweeps across it in 240 ms, like a dial shadow passing.

### 4.2 Layout grid and safe areas

- **Reference canvas:** 1920×1080.
- **Grid:** 12 columns, **96 px outer margins**, **24 px gutters**, so a column is **122 px**. Baseline 8 px. Spacing scale 4/8/12/16/24/32/48/64/96.
- **Top bar:** 72 px. Wordmark in columns 1–2, nav in columns 3–7, Candles balance and profile in columns 10–12.
- **Party rail:** right side, 288 px, collapsible.
- **Safe areas:**
  - Text never comes within **48 px** of the screen edge.
  - The HUD keeps a 16 px margin.
  - On 21:9 the content max width is 1920 and centred; the 3D scene fills the rest.
  - On 16:10 and 4:3 the columns shrink and the margins stay.
  - Minimum viewport is 1280×720.
- **Composition:** the 3D focal subject lives in **columns 7–12**, the UI in columns 1–6. "The light comes from the left and the UI lives in it."

### 4.3 Shape jobs and ornament rules

Three shapes, each with one job:
- the **plate** (rectangle): structure;
- the **ring**: time and state (timers, cooldowns, ranks, the Mode Dial);
- the **wedge** (the gnomon triangle): "this demands action". Used for the CTA pointer, the selected marker and the self facing pointer.

**Ornament tells time, rank or rarity, and never fills space.** Only three ornaments exist:
1. **Hour-ticks:** 1–4 short ticks (8×1 px) at a plate's top-left corner. The count is tier, rarity or rank.
2. **The hour-line:** a 1 px rule extending from a heading's baseline, 1–3 columns long, ending in a 3 px dot (the shadow's tip).
3. **The dial arc:** a 1 px partial circle (≤ 120°) behind a focal 3D subject.

At most 2 ornaments per panel. No ornament on scrolling lists. **Banned:** gears, cogs, clock hands, filigree, metallic bevels, gold.

### 4.4 Menu background: one continuous live 3D scene, "The Rim at the Split Hour"

**The scene:**
- A terrace on the dial's rim at the split hour.
- **Camera:** 6 m above the terrace, pitch 12° down, vFOV 32°.
- **Midground:** the carved dial floor, with the fallen needle lying across it and the violet **Standing Shadow** beside it.
- **Horizon:** the **Glass Belfry** (Aubade) on the left and the **Lamp Dome** (Serenade) on the right. Both sides are in one frame.
- **Light:**
  - Key sun from screen-right: elevation 18°, sunDir ≈ (0.894, 0.309, 0.325), `#FFC27E`, warm.
  - Cool sky fill from the left.
  - A split sky HDR baked in Blender with procedural cumulus.
- **Foreground:** the player's last-played fighter (`idle_lobby`) stands on a carved numeral in columns 8–10, about 620 px tall on Home, with its own key + rim rig.
- **Ambient motion:**
  - 200 drifting light motes (GPU particles);
  - grass vertex wind (0.3 Hz);
  - **the needle's shadow edge creeps across the terrace at 1° per minute**, so the menu is quietly keeping time.
- **Fog:** distance fog is allowed here, since menus are not competitive: `#A7B1BE`, exp2 density 0.004.
- **Budget:** ≤ 180k tris, one 2048² shadow map re-rendered only when the fighter changes, N8AO half-res, bloom 6 levels, ≤ 3 ms GPU at High. The scene pauses when the tab is hidden.

**Screens are camera positions in this one scene.** Moves take 720 ms using the `dawn` easing (4.5), which ties Rift, Bridge, Fray and the client into one product.

| Screen | Camera / set | Notes |
|---|---|---|
| Home | the vista | Season art swaps in as a sky + LUT + banner swap, so the background is the live event channel (r05) |
| Play | tilts down onto the **Mode Dial** carved in the terrace | The DOM dial aligns to it: three carved hour-marks (RIFT · BRIDGE · FRAY) plus the uncarved reserved mark. Selecting a mode swings a gnomon shadow to that hour (clockwise, 360 ms). The queue list and party slots sit under the selected mark. |
| Collection / Store | trucks right to a turntable plinth (a small dial) | Uses **Khronos PBR Neutral** tone mapping (r10) and a near-identity showcase LUT, so skins show their true colors |
| Draft ("the Choosing") | a separate set: ten hour-marks on an arc | Aubade's five on the left arc, Serenade's five on the right. Bans show as shadowed marks at the arc ends. Fighter grid in the lower half, the hovered fighter in 3D at the centre. Our own composition, not a portrait-column layout. |
| Loading | a **shadow-line wipe** (900 ms) from the vista to ink loading cards | One card per player (splash crop, name, rank emblem) |
| Post-game | "the Dial at Rest": the vista at full evening | The staged reveal in 4.6 |

### 4.5 Motion language (tokens)

**Durations:**

| Token | ms | Use |
|---|---|---|
| `--dur-instant` | 60 | press depress |
| `--dur-micro` | 100 | hover, toggle |
| `--dur-fast` | 160 | tooltip, dropdown |
| `--dur-base` | 240 | state change, card select |
| `--dur-panel` | 360 | drawer, modal, screen content |
| `--dur-scene` | 720 | 3D camera move |
| `--dur-sweep` | 900 | shadow-line wipe |
| `--dur-reward` | 1200 | count-ups |

**Exits run at 0.7× their entry duration.**

**Easings:**

| Token | Curve | Use |
|---|---|---|
| `--ease-dawn` (enter) | `cubic-bezier(0.16, 1, 0.3, 1)` | anything entering |
| `--ease-dusk` (exit) | `cubic-bezier(0.7, 0, 0.84, 0)` | anything leaving |
| `--ease-std` | `cubic-bezier(0.2, 0, 0, 1)` | ordinary state changes |
| `--ease-swing` | `cubic-bezier(0.34, 1.4, 0.64, 1)` | **reward settles only** |
| linear | — | **timers, cooldowns, sweeps: time is linear** |

**Stagger:** 32 ms per item, capped at 8 items (256 ms). Grids stagger by row (48 ms), not by item. Text never staggers per letter.

**Movement:**
- Offsets: 16 px for small elements, 32 px for panels. Modals scale 0.98 → 1.
- Forward navigation enters from the right ("clockwise"), and back navigation from the left. Radial elements turn clockwise.
- Nothing bounces except rewards.

**Signature transition:** the **shadow-line wipe**, a soft-edged 30° band (CSS mask gradient) that sweeps the screen in the sun's direction. It is used only between the client and a match.

**Reduced motion:** 120 ms fades, no wipe, no parallax, and the 3D camera cuts instead of moving.

### 4.6 State treatments (every component ships all of them)

| State | Visual | Sound |
|---|---|---|
| Default | `--ink-2` plate, 1 px `--line-1`, top catch-light | — |
| Hover / focus | `--ink-3`, border chalk 40%, a 100 ms catch-light gradient sliding in from the top-left. Keyboard focus is **2 px chalk ring + 2 px ink gap**, as strong as hover. | glass tink (rate-limited) |
| Pressed | translateY(1 px), `--ink-4`, 60 ms; fires on pointerdown | escapement tick |
| Selected | 1 px chalk border, an **8×2 px chalk hour-tick** at the left edge, 8% chalk light from the left. Persists after hover ends. | — |
| Disabled | `--text-3`, no light response, `not-allowed` cursor, **a tooltip saying why (mandatory)** | none |
| Locked | **dashed** 1 px `--line-2` border, padlock glyph, the unlock path in `--text-2` ("4,800 Candles" or "Reach level 6"). Never greyed out like disabled. | muffled tick + low glass "denied" |
| Loading | skeleton plates at final size with a **shadow sweep** (a 35%-darker 30° band moving left to right, 1.4 s linear loop). Spinner only after 2 s: a small dial with a rotating shadow. | — |
| Empty | an **uncarved-dial** line drawing (120 px), one sentence, one CTA | — |
| Error | 3 px HARM left border, wedge "!" glyph, plain-language message, Retry. Never a dead end. | clay double-thud |
| Timed | a linear ring sweep around the element that turns HARM in the last 5 s, with a tick every second | last-5-s tick |
| New / unseen | 6 px `--brand-gloam` dot at the top-right, cleared once seen | — |

**Post-game staged reveal** (skippable with any key):

| Time | Beat |
|---|---|
| 0–1.2 s | outcome word in `display-xl` with the hour-line, plus the sting |
| 1.2–2.4 s | the player's own result |
| 2.4–4.0 s | progression bars count up (ease-out, glass ticks rising in pitch) |
| 4.0–5.2 s | rewards |
| 5.2 s | social and next actions; one-click requeue is the chalk CTA |

### 4.7 Sound feel of the UI

The UI sounds like **glass and wood**: a struck dawnglass tink, a clock-escapement tick and a plucked dial-harp. There are no swooshes, no buzzers and no electronic beeps. Details are in section 10.

---

## 5. IN-GAME CAMERA

### 5.1 Numbers

| Parameter | Value |
|---|---|
| Pitch φ (below horizontal) | **52°** |
| Vertical FOV θ | **26°** (narrow, which limits perspective distortion: far/near ground scale is 1.44) |
| Default distance D (camera to focus) | **28.5 m**, so camera height is 22.5 m |
| Zoom range (players) | **24.5–33.0 m**, i.e. a 1.9 m fighter is 112–83 px tall. Identical for all players. |
| Spectator / replay max | 44 m (62 px) |
| Fixed yaw | the camera looks toward world **−Z** (sim −y). Screen right = +X. The minimap is the sim plane drawn with +y downward. |
| Ground coverage at default (1080p, hero centred) | **23.4 m wide** at the focus (±11.7 m). **10.2 m** above the hero, **7.1 m** below (about 5.7 m clear of the HUD). |
| Content implication | ability ranges ≤ 10 m stay on-screen in every direction. Longer ranges must show an off-screen edge indicator. |

### 5.2 The math

For a vertical figure of height *h* at the focus point, on a screen *H* px tall:

```
px_per_m  = H / (2 · D · tan(θ/2))     = 1080 / (2 · 28.5 · tan 13°) = 82.1 px/m
hero_px   = h · cos(φ) · px_per_m      = 1.9 · cos 52° · 82.1        = 96 px   (1080p)
                                                                       = 64 px   (720p)
```

- A 1.4 m small fighter is 71 px at 1080p; a 2.5 m large fighter is 126 px.
- At default zoom the head is about 14 px. Only crown shape, shoulders, the weapon and three value groups survive, which is what section 8 is written for.
- **Texel budget:** 82 px/m on screen, so fighter textures at about 300 px/m give 3.6× headroom at closest zoom (112 px).
- **Why 52° and 26° rather than 56–60°:**
  - Lower pitch gives a taller silhouette for the same ground scale (cos 52° = 0.62 vs 0.53 at 58°).
  - At this pitch the view is still about 11.7 m to each side.
  - The narrow FOV keeps telegraph circles nearly round across the screen.
  - Candidates from 50° to 58° and 24° to 32° are tabulated in the appendix.

### 5.3 Lanes and fairness

- **RIFT (Hourfall):**
  - Aubade base at the bottom-left (low x, high y), Serenade at the top-right.
  - The two side lanes run **parallel to the screen axes** (vertical and horizontal legs).
  - Mid runs along the 45° diagonal through the Seat.
  - The river (the Noonline) runs on the anti-diagonal.
  - **Per-side offset:** the Serenade camera focus sits **+4.5 m toward screen-bottom** (world +Z) from their fighter, and the Aubade offset is 0.
  - With that offset, each side sees **10.2 m toward the enemy** and about 5.7 m behind, after the HUD band. The numbers are symmetric by construction. Spectators use offset 0.
- **BRIDGE (Needlespan):** the lane runs **screen-horizontal**, with Aubade on the left. The 16:9 width becomes the fighting axis (±11.7 m each way) and fairness is exact with **no offset**.
- **FRAY (Noonplate):** a circular arena centred on the map, with no offset.
- **Modes:** lock (fighter-centred with the side offset), semi-lock (free within a 6 m leash), free (edge pan + grip drag), and hold-to-scout that snaps back on release.

---

## 6. HUD DENSITY

**Target:** ≤ **12%** of a 16:9 screen always on, and ≤ **19%** at peak with non-modal contextual elements. The centre stays clear; edges carry density (r04).

### 6.1 Allocation at 1080p, HUD scale 100%

| Element | Region | Size (px) | % screen | Always / contextual |
|---|---|---|---|---|
| **Dial Bar** (self) | bottom-centre, 12 px from the edge | 620 × 132 | 3.9 | always |
| Minimap | **bottom-right** (option: bottom-left), 16 px margins | 272 × 272 (25% of height) | 3.6 | always |
| Sky strip (score · clock · objective timers) | top-centre | 720 × 48 | 1.7 | always |
| Ally frames ×4 | left edge, y 320–620 | 168 × 52 each | 1.7 | always (RIFT, BRIDGE) |
| Hour Board (placement) | top-right | 220 × 236 | 2.5 | always (FRAY; replaces the ally frames) |
| Kill feed | top-right | 360 × 28 per row, ≤ 5 rows, 6 s each | ≤ 2.4 | contextual |
| Announcer banner | under the Sky strip | 640 × 64, 3.5 s | 2.0 | contextual |
| Chat | bottom-left | 420 × 160, fades after 8 s | 3.2 | contextual |
| Ping wheel | at the cursor | 220 Ø | — | contextual |
| Shop / Tab board / death recap | modal or dimmed overlays | — | — | on demand |

**Totals:** **10.9%** always on (RIFT) and **12.1%** (FRAY). Peak is ≈ 18.9%.
**Scaling:** separate HUD-scale (75–125%) and minimap-scale (80–130%) sliders, with a floor that keeps text ≥ 12 px.

### 6.2 Dial Bar composition (our own; not the reference arrangement)

The Dial Bar has **no self portrait**, because the camera already shows you.

**Row 1:**
- the **level chip** (22 px ring, with XP shown as a linear shadow sweep around it);
- an HP bar 440×16 with a resource bar 440×8 under it;
- the Gleam total (Mono 18) at the right end.

**Row 2**, sitting on a shallow arc (6 px sagitta, the "dial arc"):

```
[items 3×2, 40 px] · [a1][a2][a3] 64 px · [ULT 76 px, ring-framed] · [spell][spell] 48 px · [recall / ward 36 px stacked]
```

**Cooldowns are shadow sweeps:**
- an ink overlay rotating clockwise from 12 o'clock, linear;
- a 3 px soft penumbra on the leading edge;
- seconds in Mono 22/700;
- on ready, a 120 ms light glint crosses the icon (with a glass tick, for the ult only);
- rank pips are small hour-ticks under each socket.

### 6.3 Overhead bar anatomy (fighters, 1080p, 100%)

```
          [status icons ≤3, 14 px]           ← CC: a 2 px chalk bar above HP shows remaining duration
 (Lv)  ═════════════════════════╗           ← name 12 px above (allies/enemies; optional)
 18px  HP 82×9  |·|·|·|·‖·|·|·|  ║ shield: pearl + 45° hatch appended; total rescales if HP+shield > max
       res 82×4 ─────────────────╝           ← 1 px gap; resource color from 2.6
```

- **Ticks:** a 1 px tick every 100 HP (ink 35%) and a 2 px tick every 1,000 HP (ink 70%).
- **Damage trail:** a Noonwhite segment that holds 150 ms, then eases out over 450 ms.
- **Frame by relationship:**
  - **self:** double frame;
  - **ally:** rounded ends;
  - **enemy:** pointed chevron ends;
  - **FRAY:** the seat glyph inside the level chip.
- **Placement:** anchored at `FighterArt.height + 0.35 m`.
- **Draw order:** bars and rings are drawn **after the color grade** (section 12, risk 4).
- **Smaller units:** minions get a 40×4 bar with no chip. Structures get 120×10 with the Spire/Dome glyph.

### 6.4 Telegraphs

| Source (in your view) | Fill | Edge | Rule |
|---|---|---|---|
| Enemy / anything that can hurt you (RIFT, BRIDGE, monsters) | HARM, α 0.16 rising to 0.30 | HARM, α 0.90, 3 px | the **landing edge** is the brightest element |
| FRAY opponent | HARM, α 0.16 → 0.30 | **caster's seat color**, α 0.90 | caster glyph stamped at the origin |
| Ally | none | azure, α 0.45, 2 px | heal or shield zones use a Sap edge, α 0.5 |
| Own aim | Noonwhite, α 0.08 | Noonwhite, α 0.60, 2 px | range ring dashed, α 0.25 |

- **Delayed area effects use a dial sweep:** the fill sweeps **clockwise from 12 o'clock** and impact lands when the circle closes. Timing is readable the way a clock is.
- **Lines and cones** fill from the origin toward the tip. Skillshot paths are two edge lines plus a wedge at the tip.
- **Global caps:**
  - overlapping fills clamp at α 0.45;
  - telegraphs are never pure white;
  - no pulsing faster than 2 Hz, except a 150 ms impact flash.
- **Locked at every quality tier:** shapes, colors and opacities (r10 §8).

### 6.5 Damage numbers

**Shown:**
- **Your outgoing damage on targets.** Physical in Chalkstone, magic in Orchid-rose, true as ink-with-halo. Mono 18/700; crits are 26/800 with a small wedge.
- **Heals** you give, as "+N" in Sap, only when ≥ 5% of the target's max HP.

**Not shown:**
- **Incoming damage to yourself** never becomes floating numbers. Your bar flashes and the damage trail shows it.

**Behaviour:**
- DoT and aura ticks merge per 0.5 s.
- At most 6 numbers per target, newest on top.
- Numbers rise 24 px over 600 ms (ease-out) and fade over the last 200 ms.
- In FRAY, only your own outgoing numbers are shown.
- Spectators: off by default.
- There is a settings toggle.

---

## 7. WORLD LOOK (per map)

### 7.1 Shared rules for all gameplay maps

**Value ladder (L*):**

| Layer | L* | Saturation |
|---|---|---|
| threat VFX | up to 100 | — |
| fighters | full range, top-light | — |
| minions | 35–75 | — |
| playable terrain | **25–70, clamped** | ≤ 35% |
| out of bounds | 15–55 | ≤ 25% |

**Fog and fog-of-war:**
- **No camera-distance fog in gameplay.** One world-space include handles height mist (masked to low areas), map-edge fog and fog of war (r10 §3.3).
- **Fog of war:** value ×0.55, saturation ×0.4, a 15% tint toward `#2A3140`, a 1.5 m soft edge and no animated noise. It is identical at every tier.

**Tone mapping and grade:**
- **AgX, exposure owned once per map**, with all punch coming from the LUT (r10 §1.1).
- **Pass order:** tone map → LUT3D (sRGB input, tetrahedral on High and Ultra) → vignette → SMAA.
- **Every LUT keeps identity on three protected hue windows:** 25–50°, 200–225° and 340–350° (HSV), so team-tinted accents keep their hue.
- The grade is **locked**: one `.cube` per map, never animated. The player brightness slider is a post-LUT ±0.3 EV offset only.

**Characters and contact:**
- Fighters get a **separate authored key + rim** that the environment's shadow bands never darken (r06 §5.2).
- Every unit has a contact anchor at every tier: N8AO + shadow map, or blob quads on Low.

**Sky:**
- Blender 5.2 **Multiple Scattering** sky with the sun disc off and procedural clouds composited in.
- Baked to 1024×512 for maps and 2048×1024 for menus, shipped as UltraHDR, PMREM'd for IBL (r10 §3.1).
- A Hosek-Wilkie turbidity equivalent is given for reference.

### 7.2 RIFT, Hourfall: "the Split Hour"

| Aspect | Spec |
|---|---|
| Time / sun | a stalled mid-afternoon. Elevation **52°**, from the camera's lower-left (35° left of behind-camera): sunDir **(−0.353, 0.788, 0.504)**. `#FFEBD8` (≈5400 K). Relative intensity 3.0, IBL 0.65. |
| Sky | MS sky: air 1.0, aerosol 1.4, ozone 1.0, altitude 300 m (≈ turbidity 3). **35% fair-weather cumulus**, soft edges. |
| Temperature split | a world-space temperature field along the base-to-base diagonal: cool `#B8C6D9` on the Aubade half, warm `#D9C2A0` on the Serenade half, multiplied into ambient/IBL at strength 0.08. Data lives in `MapDef.art.terrain.temperatureField` (that record is free-form, so no schema bump). |
| Fog | height mist `#9AA7B4`, density 0.035/m below 0.8 m, river and jungle hollows only. Map-edge fog `#8E9AA6`, starting 4 m outside bounds and full at 18 m. |
| Value structure | **lanes** are honed pale dial-stone, L* 62–68, texture variation ≤ ±4. The carved hour-lines are **≥ 0.3 m wide with ≤ 6 L* contrast in play space**; numerals appear only off-lane. **Jungle** ("dialwood" groves, dark leaves with pale undersides) floors L* 30–40; camp clearings L* 45–50 as lighter "rooms". **Walls:** lit tops L* 55–62 with a painted 1 px-at-1080p edge light, faces L* 18–25; dash-through walls are thin with a chalk curb, solid walls are thick with no curb. **Thickets** are tall needle-grass, L* 48–54 and more yellow than the moss, ringed by a carved stone curb; your units inside drop to 55% opacity with a dashed ring. |
| River (Noonline) | the **Standing Shadow** covers the NW half: hard-edged, violet-cool, L* 30–36, **saturation kept** and edge engraved, so it can never be mistaken for fog of war. The **Fallen Shaft** covers the SE half: needle segments in shallow water, L* 40–48, cool. |
| Landmarks (one silhouette per region) | Aubade base: the **Glass Belfry**. Serenade base: the **Lamp Dome**. Centre: **the Seat** (the needle's round stump, about 1 m high, never occluding). NW pit: **Longshade**, where the shadow's tip lies. SE pit: **Sunsplinter**, at the needle's broken tip. Each jungle quadrant has a **giant half-buried numeral** as its callout: **Sevenmark** (VII), **Fourmark** (IIII), **Elevenmark** (XI) and **Twomark** (II). A bare "Seven" is a deny-list entry, so the *-mark* form is mandatory. |
| **Locked grade** | **lift** RGB (−0.008, −0.002, +0.012) for cool shadows · **gamma** (1.00, 1.00, 0.985) · **gain** (1.025, 1.00, 0.975) for warm highlights · contrast +6% at a 0.42 pivot · saturation **×0.85 shadows / ×1.05 mids / ×0.92 highlights** · greens 75–150° rotated **−5°** toward yellow at sat ×0.88, so foliage recedes · cyans 170–200° sat ×0.9 · protected windows identity |
| Tone map / exposure | AgX, exposure 1.0 |

### 7.3 BRIDGE, Needlespan: "the Long Light"

| Aspect | Spec |
|---|---|
| Time / sun | low evening sun. Elevation **30°**, from **directly behind the camera**: sunDir **(0, 0.5, 0.866)**. Shadows fall straight up-screen, so they are **mirror-fair to both teams**. `#FFC890` (≈3800 K), intensity 2.6. Shadow opacity is capped at 0.55, so long shadows never read as a second figure. |
| Sky | aerosol 2.2, air 1.2 (≈ turbidity 4.5), **45% altocumulus** with warm-lit undersides |
| Fog | **gorge depth fog:** exponential height fog below Y = −2 m, `#5E6C93`, 0.06/m, reaching near-solid blue-violet by −25 m. Lane ends fade into `#8A7F96`. |
| Value structure | **maximum figure/ground.** The needle's top surface (the lane) is honed stone, L* 60–66. A 0.4 m **inscription band runs along each walkable edge** at L* 70, so the edge is unmistakable. The chasm is L* 15–30 and cool. Fighters (warm-lit tops, dark feet) sit on a light lane against a dark void. |
| Landmarks | Aubade end: the **Dawn Arch** (glass). Serenade end: the **Lamp Gate**. Centre: **the Snap**, the widened plaza where the needle cracked, which is the teamfight floor. Its fragments are low (≤ 0.8 m) and never occlude. |
| **Locked grade** | **lift** (0.0, −0.004, +0.020) · gamma (1.0, 1.0, 0.98) · **gain** (1.04, 1.00, 0.95) · saturation ×1.08 mids, ×0.95 highlights · purples 260–290° sat ×1.05 for chasm depth · protected windows identity |
| Tone map / exposure | AgX, exposure **1.12** (+0.16 EV to compensate the low sun) |

### 7.4 FRAY, Noonplate: "the Shadowless Noon"

| Aspect | Spec |
|---|---|
| Time / sun | **elevation 86°**, almost overhead: sunDir **(−0.024, 0.998, 0.066)**. `#FFF3E6` (≈5900 K), intensity 3.4. Shadows pool **directly under every fighter**: a built-in footprint read, and the top-light value gradient for free. |
| Sky | air 0.9, aerosol 0.5, ozone 1.2 for a deep blue zenith (≈ turbidity 2.2). **8% cirrus.** |
| Fog | none in the arena. **Map-edge "glare":** beyond the plate rim the world whites out to `#E6E1D6`, so a **bright** boundary, the noon glare, replaces dark edge fog. |
| Value structure | the Seat is **polished basalt, L* 28–36** (the one dark stone in the vale; "the noon would blind otherwise"), so all ten seat colors pop. Chalk-inlaid hour-lines are 0.15 m wide at L* 60. The central shared-shop ring is L* 40. **Ten carved rim numerals I–X** are the seats' respawn marks, and each lights in its seat color. |
| **Locked grade** | lift (+0.004, +0.004, +0.010) · gamma 1.0 · gain 1.0 · contrast +10% · environment saturation ×0.90 · protected windows identity |
| Tone map / exposure | AgX, exposure **0.88** (−0.18 EV) |

---

## 8. FIGHTER LOOK

### 8.1 Shape language per role class

Encode role by **mass distribution**, because it survives at 96 px (r06 §8).

| Role class | Silhouette rule | Footprint |
|---|---|---|
| Vanguard (tank) | blocky; widest at the shoulders (≥ 1.4× hip width); flat crown; shield or pauldrons read from above | 1.3–1.6 m |
| Duelist (bruiser) | inverted triangle; one oversized weapon on one side | 1.0–1.3 m |
| Striker (assassin) | narrow forward-leaning diagonal (10–15°); sharp asymmetric triangles; long blade or claws | 0.7–0.9 m |
| Caster (mage) | a vertical line with a circle: tall headpiece, hood or halo disc (the gnomon) | 0.8–1.0 m |
| Marksman | horizontal read: a long weapon held across the body (bow, sling-staff, lens-thrower; no firearms) | 0.9–1.1 m |
| Warden (support) | rounded and open; carries a light vessel (lamp, bell or glass) as a circular secondary shape | 0.9–1.2 m |

### 8.2 Value, detail and silhouette

- **Value gradient:**
  - **top 25% L* 70–85**, middle 50% L* 45–65, **bottom 25% L* 20–35**;
  - painted into albedo as a +12% / −18% vertical value ramp, plus AO multiplied at 0.6;
  - the feet are never as bright as the head (r06 §3.1).
- **Detail density:**
  - ≥ 40% of the visible silhouette is **rest** (≤ ±4 L* variation), about 40% mid detail, and ≤ 20% focal detail, at head, chest and weapon;
  - minimum feature size **6 cm** (about 5 px at default zoom);
  - texel density 280–340 px/m on 1024² sheets (`body` + `accent` materials).
- **Silhouette tests**, all signed off at 64 px (the 720p default):
  - **crown test:** a black silhouette rendered from the game camera; the whole roster on one sheet; any pair with mask IoU > 0.8 is redesigned;
  - **facing test:** front and back must differ (weapon side, cape);
  - **grayscale test:** a value check on lane and jungle ground.
- **Skin-modifier bodies** must carry **≥ 2 hard-edged secondary shapes** (bevelled armor, swept blades or horns, cloth panels) so the organic mass never reads as clay.

### 8.3 Material vocabulary

| Group | Materials |
|---|---|
| Aubade-born | linen, dawnglass, pale ash, blued steel, gull-grey feather |
| Serenade-born | ochre felt and wool, lampresin, walnut, oxidised iron, waxed leather |
| Hourless | undyed hemp, basalt, horn, pewter |

**Stylized PBR ranges:**

| Material | Roughness |
|---|---|
| stone | 0.70–0.90 |
| cloth | 0.80–0.95 |
| leather | 0.50–0.70 |
| glass and resin | 0.05–0.20, with clearcoat |
| metal | 0.30–0.50 |

- Metalness is binary.
- Albedo stays between sRGB 30 and 240.

**Banned on fighters:**
- gold or brass over 5% of the surface;
- chrome;
- gears, cogs and rivet clusters (the steampunk tell);
- circuitry and neon tubes;
- glowing runes as surface pattern.

### 8.4 Accent emissive rule

- Exactly **one** `accent` material (CONTRACT §12).
- It covers **≤ 6%** of the visible surface at the game camera and sits **in the top half** (crown, chest or weapon head).
- Emission is the **readability color** (ally or enemy for players, absolute for spectators, the seat color in FRAY) at HDR intensity 2.0–3.0. It blooms lightly, but **must still read with bloom off** (the Low tier).
- No other fighter emissive. VFX carries the rest.

### 8.5 Skins

**Skins may change:**
- material vocabulary and palette (outside reserved hues);
- props of the **same weapon type and hand**;
- VFX theme colors (outside reserved hues);
- SFX timbre.

**Skins must keep:**
- rig, clips and timing;
- silhouette class (footprint ±10%, height ±5%, crown read);
- the accent location;
- the value gradient;
- telegraphs (untouchable).

**Hues reserved from skins** apply to any emissive, any VFX core, or albedo above 40% saturation covering more than 8% of the visible area:

| Window (HSV hue) | Reserved for |
|---|---|
| 200–225° | ally azure family, including alternates |
| 28–50° | harm marigold and its yellow alternate |
| 340–350° | tritan-alt rose |
| 125–150° | Sap, healing |
| V > 95% and S < 5% | pure white (T4 VFX cores) |

No skin may be a single saturated full-body color, which would read as a FRAY seat.

---

## 9. VFX LANGUAGE

### 9.1 Two families, from the world

- **Lumen** (stored light): additive glass flares, lamp-fire and sun-shards.
- **Shade** (the stopped shadow): **alpha-blended ink** smoke and stains. This is a value-inverted family the genre rarely uses. Shade always carries a 1 px Noonwhite rim at α 0.6 so it reads on dark ground.

### 9.2 Importance tiers (score 1–4)

| Tier | Use | Max L* | Particles | Ground decals | Other |
|---|---|---|---|---|---|
| T1 | basic attacks, passives | 75 | ≤ 24 | none | ≤ 0.35 s |
| T2 | basic abilities | 88 | ≤ 64 | ≤ 1 | — |
| T3 | crowd control, mobility, zones | 94 | — | — | must have a telegraph; crisp edges |
| T4 | ultimates, objectives, structure falls | **100, in the danger element only** | — | — | flash ≤ 120 ms; camera shake only for the local caster and structure falls, ≤ 0.15 m |

### 9.3 Color and value rules

- The **danger element** (missile tip, landing edge) has the highest value and saturation. Trails and ambient particles stay ≤ 60% of its value (r06).
- **Reserved hues** are the same windows as 8.5. With `teamTint` on, team tint is applied **only to the danger element's rim**.
- Plain radial-gradient sprites may make up ≤ 30% of any effect. The rest comes from authored atlases (glass shards, light petals, ink wisps), rendered as Blender flipbooks.

### 9.4 Ally vs enemy in your view

| Source | Opacity | Density | Rim |
|---|---|---|---|
| Ally | **65%** | secondary particles −50% | — |
| Enemy | 100% | full | marigold **danger rim** on the threatening element |
| Own | 100% | full | none |

### 9.5 Impact grammar

Three beats, matching audio's transient / body / tail (r07):

| Beat | Time | What happens |
|---|---|---|
| **Flash** | 0–50 ms | a 1–2 frame value spike at the contact point (radius 0.3 / 0.5 / 0.8 / 1.2 m for T1–T4) |
| **Mark** | 50–250 ms | a burst whose **core (≤ 30%) shows the damage type**: chalk chips (physical), orchid-rose light (magic), ink splash (true). The rest follows the fighter theme. |
| **Settle** | 250–900 ms | desaturated motes and dust, L* ≤ 55, no reserved hues |

There is no hit-stop in the sim. Your own crits get a 40 ms flash on the target outline.

**Telegraph style** is "carved light": thin bright edges with 1.5 px AA, faint fills and the dial sweep (6.4).

---

## 10. AUDIO PALETTE

All audio is synthesized originally in numpy (CONTRACT §11).

- **Key and mode:** home is **D Dorian**. The Aubade, the menus' bright moments and FRAY add the **Lydian G#**. "Two songs, one key."
- **Tempo grid:** **60 BPM menu** (one beat per clock second), **90 BPM draft**, **120 BPM match**, all in 4/4. Every transition lands on an **8 s phrase grid**: 2 bars at 60, 3 at 90, 4 at 120.

### 10.1 Instrument palette (8, all synthesizable)

| # | Instrument | Synthesis |
|---|---|---|
| 1 | **Dawnglass** (struck glass bowl) | additive; inharmonic partials 1, 2.32, 4.25, 6.63 with per-partial decay (2.4 / 1.1 / 0.6 / 0.3 s); ±0.6 Hz detune beating |
| 2 | **Hourbell** | additive bell partials 0.5, 1.0, 1.2 (minor-third tierce), 1.5, 2.0, 2.51, 3.0, 4.0; strike noise burst 8 ms |
| 3 | **Dial harp** | Karplus-Strong pluck, one-pole lowpass in the loop (nylon), 4 round-robin variants, ±8 ms humanise |
| 4 | **Lamp drone** | subtractive: 3 detuned saws (±7 cents) → 24 dB lowpass, cutoff 400–1600 Hz on a 0.05 Hz LFO |
| 5 | **Clay and frame drums** | modal membrane (Bessel ratios 1.00, 1.59, 2.14, 2.30, 2.65, 2.92) with a pitch-drop envelope; "stone kick" sine sweep 90→45 Hz |
| 6 | **Escapement** (the clock tick, our hi-hat) | band-passed noise burst (2.5 kHz, Q 4) into two-pole wood resonators at 850 Hz and 1.9 kHz |
| 7 | **Shade breath** | pink noise through a sweeping band-pass; reversed swells for wind-ups |
| 8 | **FM shimmer** | 2-op FM, ratio 1:3.5, index 2.5 → 0 over 1.2 s; used for light and magic hits and Gleam |

**Space:** one shared convolution "Vale hall" IR, synthesized as stereo exponentially-decaying filtered noise (RT60 2.8 s low / 1.6 s high, 24 ms predelay), plus a 0.6 s "plate" IR for UI. Use sends only, never one reverb per sound (r07 §4.3).

### 10.2 Motif (the sonic logo)

- **Core:** **A4 – E5 – D5 – B4**. It avoids the third scale degree (F or F#), so it is neither major nor minor: "between hours".
- **Hour notes** that complete it:
  - **Aubade / victory:** … B4 → **F#5** (rising fifth, major, morning)
  - **Serenade:** … B4 → **G4** (falling to the major IV, the warm plagal settle of evening)
  - **FRAY:** … B4 → **G#4** (the Lydian #4 that hangs: no shadow, no side)
- **Usage:**
  - the menu intro plays the full core;
  - **queue pop** plays three rising Hourbell strikes, **A4–E5–A5**, 120 ms apart;
  - **lock-in** plays D5 over a low D3 bell;
  - level-up plays E5–B4 on Dawnglass;
  - reward ticks rise through D Lydian.

### 10.3 Beds and stings

- **Menu bed (60 BPM):**
  - lamp drone on D/A, sparse Dawnglass, and harp fragments, with no hook in the loop;
  - the escapement ticks softly on the beat in the B section only;
  - stems of 64, 48 and 80 s, so the full combination repeats only every 16 minutes;
  - a 1–4 kHz dip leaves room for voice chat and UI (r07 §1.1).
- **Draft bed (90 BPM):** builds by phase. A calm drone in bans, harp pulse in picks, drums in finalize. A local-only urgency layer (escapement accelerating) plays in the last 8 s of your own turn.
- **Match bed (120 BPM, 2 layers):**
  - **calm:** harp ostinato D–A–E, drone, a frame drum every half bar;
  - **combat:** clay drums on beats 1 and 3, Dawnglass 16ths, a rising bowed-drone cluster;
  - layer changes are intensity-driven with hysteresis and quantized to the bar (2 s).
- **Stings:**
  - **Victory (6 s):** the full motif on Hourbell + Dawnglass, resolving to **D–A–E–F#–G#** (Dadd9#11) as the enemy Hourbell's crack decays under it.
  - **Defeat (4 s):** the core motif on harp at half speed, held on B4 over **Dsus2**. Dignified and unresolved, never mocking.
  - **FRAY placement:** the FRAY motif. 1st place lands the full Noon chord; lower places truncate it by placement.

### 10.4 UI sound character: glass and wood

| Event | Sound | Level / limit |
|---|---|---|
| hover | Dawnglass tink E6, 40 ms | −32 dBFS, ≤ 1 per 70 ms |
| press | escapement tick on pointerdown | — |
| confirm | A5 → E6 glass fifth | — |
| back | E6 → A5 wood-glass | — |
| error | clay double-thud D3 (no buzzer) | — |
| tab | harp B4 | — |
| purchase | FM shimmer arpeggio D–F#–A–C# | — |
| locked | muffled tick + low glass | — |
| queue pop | see 10.2 | **+6 LU over UI**, its own slider, cannot be muted below a floor (r07 §3.3) |

### 10.5 Loudness

- **Game mix:** **−18 LUFS integrated ±1.5**, true peak ≤ **−1 dBTP**, measured over a 30-minute representative match capture (r07 §4.1).
- **Music beds:** normalized to −23 LUFS, so they sit about 5 LU under SFX.
- **Stings:** −16 LUFS short-term.
- **UI cues:** −24 to −20 LUFS momentary; the queue pop at −14 LUFS-M.
- **Format:** WebM/Opus primary, AAC fallback, no MP3 loops (r07 §6.3).

---

## 11. ONE-PAGE TEST (the bible page itself)

**VALE · STYLE BIBLE · law for every screen**

**WORLD.** The vale is one carved sundial. Its needle fell, its shadow stayed, and the light stopped: morning on the west rim, evening on the east. The **Aubade** (morning) build tall chalk spires with dawnglass. The **Serenade** (evening) build low ironstone domes with lampresin. RIFT is the war for the dial (Hourfall). BRIDGE is the fight along the needle's fallen shaft over the gorge (Needlespan). FRAY is the **Shadowless Noon** on the needle's Seat, where nobody has a side (Noonplate). Tone: luminous, competitive, a little melancholy. *Stone tells you whose land; light tells you whose side.*

**NAMES.** Places are one-word compounds of Hour/Noon/Dial/Needle/Shade/Lamp/Glass/Bell. Structures: Needle, Lantern, Hourbell. Objectives: Longshade, Sunsplinter. Currency: Gleam (in-match), Candles (earned). Fighters use the letters a b d e h i k l m n o r s t u v, two syllables, no apostrophes. Aubade-born end in a vowel, -l or -t; Serenade-born end in -m, -n, -nd, -or or -ow. Every name passes `names_check.ts`.

**PALETTE.** The client is **ink and chalk**: ink `#0B0D11`–`#262C37`, text `#EDE6D6` (13.9:1), secondary `#ABA597` (7.0:1), disabled `#6E6B66`. Brand gloam `#A99BFF` is for brand, new, season and T3 items. **Color is a gameplay resource.**
- **Relationship:** SELF Noonwhite `#F4EFE2` (gnomon wedge, double frame). ALLY azure `#3F9CFF` (dashed ring, round bar ends). ENEMY / HARM marigold `#FF9A1F` (notched ring, pointed bar ends). ΔE ≥ 21 under all four vision types; CVD alternates reach about 26.
- **Spectators:** Aubade azure ▲, Serenade marigold ◠.
- **FRAY:** ten stable seat colors, each with a glyph, L* 46–89.
- **Damage:** physical `#F1E2C6`, magic `#FF7BD5`, true as ink numerals with a halo. Heal `#63D88B` with "+". Shield `#DCE8EE` with hatch.
- **Tiers:** items carry 1–4 ticks. Ranks climb the sun from Lamplit to Unshadowed, and **rank equals brightness**.

**TYPE.**
- Gloock for display, never below 28 px.
- Instrument Sans for headings and buttons, in CAPS, wdth 88–90, +0.06–0.08em.
- Atkinson Hyperlegible Next for body, 16/24.
- Atkinson Hyperlegible Mono for every number.
- No text under 12 px at 720p.

**MENUS.**
- Honed-slate plates: 94% opaque, 2 px radius, top-left catch-light, no backdrop blur. One chalk CTA per screen.
- 12 columns, 96 px margins, 24 px gutters; 3D in columns 7–12, UI in columns 1–6.
- Ornament only tells time, rank or rarity: hour-ticks, the hour-line, the dial arc. Never gears, gold or filigree.
- **One live scene,** the dial rim at the split hour. Each screen is a camera position in it. Mode select is the **Mode Dial**: RIFT, BRIDGE, FRAY and an uncarved reserved hour.
- **Motion:** 100 / 160 / 240 / 360 / 720 / 900 ms. Enter with `dawn` (0.16, 1, 0.3, 1); exit with `dusk` (0.7, 0, 0.84, 0) at 0.7×. Timers are linear. Stagger 32 ms, capped at 8. Forward is clockwise.
- **States:** hover/focus, pressed, selected, disabled (says why), locked (shows the path), loading (shadow sweep), empty, error (retry), timed, new.

**CAMERA.**
- Pitch 52°, vFOV 26°, distance 28.5 m (zoom 24.5–33).
- A 1.9 m fighter is **96 px at 1080p** and 64 px at 720p. View width 23.4 m; ability ranges ≤ 10 m.
- Fixed yaw looking at −Z. RIFT side lanes follow the screen axes and mid runs on the diagonal; Serenade gets a +4.5 m focus offset. BRIDGE's lane is horizontal. FRAY is centred.

**HUD.**
- ≤ 12% always on: the Dial Bar (bottom-centre, no portrait, items left), the minimap (272 px, bottom-right), the Sky strip, ally frames, and the FRAY Hour Board.
- Cooldowns are clockwise shadow sweeps. Bars tick every 100 / 1,000 HP.
- Telegraphs: HARM fill α 0.16–0.30, edge 0.9; ally edges only (0.45). Delayed areas sweep like a dial. Never pure white; locked across tiers; drawn after the grade.
- Damage numbers: outgoing only.

**WORLD LOOK.**
- AgX, then one locked LUT per map; protected hue windows stay at identity. No camera-distance fog. Fog of war darkens and desaturates.
- **Hourfall:** sun at 52°, a cool/warm split, lanes L* 62–68, jungle L* 30–40, a hard-edged violet Standing Shadow.
- **Needlespan:** sun at 30° from behind the camera, a light lane over a blue-violet gorge.
- **Noonplate:** sun at 86°, a dark basalt arena, white glare at the edges.

**FIGHTERS.**
- Role reads as mass: Vanguard blocky, Duelist V, Striker diagonal, Caster vertical with a disc, Marksman horizontal, Warden round with a vessel.
- Value runs light at the top (L* 70–85) to dark at the feet (L* 20–35). At least 40% rest areas, features ≥ 6 cm, and at least 2 hard-edged shapes.
- One accent emissive (≤ 6%, top half) carries the readability color.
- Skins keep silhouette, accent and value; no reserved hues.

**VFX.** Two families: Lumen (light) and Shade (ink with a light rim). Tiers T1–T4 cap value at 75, 88, 94 and 100. The danger element is brightest. Allies show at 65%. Impacts run Flash, then Mark (damage-type core), then Settle.

**AUDIO.**
- D Dorian with a Lydian G#; 60 / 90 / 120 BPM on an 8 s grid.
- Instruments: Dawnglass, Hourbell, dial harp, lamp drone, clay drum, escapement, shade breath, FM shimmer.
- Motif A4–E5–D5–B4, completed by F#5 (Aubade, victory), G4 (Serenade) or G#4 (FRAY).
- The UI is glass and wood.
- −18 LUFS integrated, true peak −1 dBTP.

---

## 12. RISKS: what could look cheap in this pipeline, and how the bible prevents it

1. **Skin-modifier bodies read as blobby clay.**
   - Prevention: at least 2 hard-edged secondary shapes per fighter; a crown/silhouette sheet at 64 px; bevel normals baked; the value ramp painted into albedo.
2. **PBR without a hand-painted feel looks like a plastic toy.**
   - Prevention: albedo bakes carry the +12% / −18% value ramp, AO multiplied at 0.6, painted edge highlights (+8%) and ±4° hue jitter. Roughness per material class (8.3). Previews in Blender use AgX with no look, to match three (r10 §1.1).
3. **Neon and bloom soup.**
   - Prevention: bloom threshold 1.0 on HDR. Emissive is limited to the fighter accent (≤ 6%), the danger elements of T3–T4 VFX, and environment glass and lamps at ≤ 1.5. Everything must read with bloom off (Low).
4. **AgX looks grey, or the LUT shifts team colors.**
   - Prevention: punch lives in the LUT. Reserved-hue windows stay at identity. Team rings, bars and telegraphs are composited **after** tone map + LUT, using the main depth texture for occlusion.
   - **Contract conflict to fix:** CONTRACT §9 lists `LUT3D → tone mapping`, but `LUT3DEffect` expects display-referred sRGB input (r10 §1.3). The bible requires `ToneMapping(AgX) → LUT3D`.
5. **Murk.**
   - Prevention: no camera-distance fog in gameplay; height mist only in masked hollows.
   - The **Standing Shadow must never look like fog of war:** it has a hard engraved edge and keeps its saturation, while fog of war is soft and desaturated. Characters keep full key and rim light inside it.
6. **Dial motif turns kitsch or steampunk.**
   - Prevention: gears, cogs, clock hands and gold are banned. Only three ornaments exist.
   - The dial carvings in play space are ≥ 0.3 m wide with ≤ 6 L* contrast, so they never become lane noise. Numerals sit off-lane.
7. **The client looks like a default web page.**
   - Prevention: no native widgets (selects, scrollbars, focus outlines are custom); fonts preloaded with size-adjusted fallbacks; the full state matrix per component.
   - Text never sits directly on the 3D scene, except display type ≥ 44 px over a 24 px ink scrim.
8. **`backdrop-filter` over WebGL** costs a frame-time spike every frame. It is banned; plates are 94% opaque ink.
9. **A monochrome client feels flat.**
   - Prevention: warmth comes from the live scene and the split light. Color appears where it carries meaning (mode cards, rank, rarity, team). Motion and sound give every input an answer within one frame (r05 §3.2).
10. **The sky looks like a gradient.**
    - Prevention: Blender Multiple Scattering sky plus procedural clouds, baked unclamped HDR, the sun disc off, and the same bake driving IBL. Menus get 2048×1024.
11. **Particles look like soft dots.**
    - Prevention: authored atlases (shards, petals, ink wisps) as Blender flipbooks; radial sprites ≤ 30% of any effect.
12. **Telegraphs look like stickers.**
    - Prevention: SDF edges with 1.5 px AA, a faint inner glow, the dial-sweep timer, `polygonOffset`. They are never textured bitmaps.
13. **Uneven texel density** is the tell r06 flags as most visible.
    - Prevention: fighters 280–340 px/m, environment 100–160 px/m, checked by Texel Density Checker before export.
14. **Synthesized audio sounds like a chiptune.**
    - Prevention: inharmonic partials with per-partial decay, Karplus-Strong for strings (never raw square or saw leads), round-robin variants, ±8 ms humanise, a shared convolution hall, loudness normalization.
15. **Low quality tier changes readability.**
    - Prevention: the Low tier drops bloom and AO and uses hard 1024² shadows (CONTRACT §9.4), so contact anchors, the value gradient and telegraph shapes must carry everything. Readability sign-off happens at **Low, 720p**.
16. **Long Bridge shadows read as extra figures.**
    - Prevention: sun from directly behind the camera (fair), shadow opacity ≤ 0.55, elevation ≥ 28°.
17. **A FRAY seat collides with a skin.**
    - Prevention: no single-color saturated skins; the glyph is always present; "Simple colors" is available.
18. **The names drift during content authoring.**
    - Prevention: `names_check.ts` runs on every content build, and the dial-tongue rules (1.4) cap shape and endings so 16 names stay one family.

---

## Appendix: verification log (2026-10-07)

- **Fonts:**
  - `npm view @fontsource/<name> version` returned 5.3.0 for gloock, atkinson-hyperlegible-next and atkinson-hyperlegible-mono, and for instrument-sans (static and `@fontsource-variable/`). The license is OFL-1.1 on all of them.
  - Tarballs were unpacked in the scratchpad and inspected with fontTools:
    - Gloock: features include `tnum`, `pnum`, `liga`, `kern`; only weight 400.
    - Instrument Sans Variable: axes `wdth` 75–100 and `wght` 400–700; `tnum` present.
    - Atkinson Next: `tnum` present; weights 200–800.
    - Atkinson Mono: every digit is 632 units wide.
- **Names:**
  - `grep -i` on `protected_names.json` for every coined name: 0 hits, apart from the substring cases noted in 1.5.
  - `node tools/names_check.ts` on 33 + 14 + 33 + 22 strings: "clean", exit 0. An earlier run flagged the bare callout "Seven" (exit 1), which led to the *-mark* rename.
- **Colors:**
  - Python implementation: sRGB → linear → Machado et al. 2009 matrices (severity 1.0) → CIELAB → ΔE2000; WCAG 2.x relative-luminance contrast.
  - The FRAY set came from a maximin local search over 131 HSV candidates with L* 45–90 and ΔE ≥ 22 vs the basalt floor, then hand-tuned. Every ΔE and contrast figure in sections 2 and 11 comes from those runs.
- **Camera:**
  - `px_per_m = H / (2·D·tan(θ/2))`, `hero_px = h·cos φ·px_per_m`. Ground extents come from the ray angles φ ± θ/2.
  - Candidates tabulated (φ 50–58°, θ 24–32°, fighter fixed at 96 px):

| φ | θ | D (m) | width (m) | up / down (m) | far/near |
|---|---|---|---|---|---|
| 50 | 26 | 29.8 | 24.4 | 11.1 / 7.5 | 1.48 |
| **52** | **26** | **28.5** | **23.4** | **10.2 / 7.1** | **1.44** |
| 54 | 26 | 27.2 | 22.3 | 9.3 / 6.6 | 1.40 |
| 56 | 26 | 25.9 | 21.2 | 8.5 / 6.2 | 1.37 |
| 58 | 26 | 24.5 | 20.1 | 7.8 / 5.8 | 1.34 |
