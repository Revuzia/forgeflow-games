# VALE Style Bible Proposal: "CLARITY"

**Angle:** readability first. The world is a quiet, beautiful stage, and the fighters, threats and objectives own the contrast.
**Status:** proposal, one of several competing bibles. Date: 2026-10-07.
**Inputs:** research r04 (HUD/camera), r05 (client/menu craft), r06 (art direction), r07 (audio), r10 (WebGL tech), skimmed r01-r03, r08, r09. Names checked against `research/protected_names.json` and `_design/names_allowlist.json`. Every number in the palette section was computed (WCAG 2.x contrast; CIEDE2000 under Machado-2009 deutan/protan/tritan simulation at full severity, plus achromatic). The method and raw results are in the appendix.

---

## 0. The 200 ms contract

A player or spectator glancing at any frame must be able to answer five questions in about 200 ms, in this order:

| # | Question | What answers it | Who owns the contrast |
|---|---|---|---|
| 1 | **What will hit me, and where?** | Telegraph rims, projectile heads, wind-up glows | VFX tiers T3-T4 (the only place pure white is allowed) |
| 2 | **Whose side is that?** | Overlay hue, plus a shape for colorblind players (bar caps, badge, ground ring, telegraph pattern) | Reserved relationship hues |
| 3 | **How healthy?** | Overhead bars on dark plates with fixed-unit ticks | Bars (UI overlay, never the model) |
| 4 | **Where am I?** | Self marker (lemon "Beacon" bar with keel, dashed ground ring) | The self token |
| 5 | **What is the objective doing?** | Objective pits and structures are the only environment allowed above chroma 0.08 | Objectives |

Everything else, meaning terrain, props, sky, menus and ornament, gets what contrast is left. Six laws follow from this and hold on every screen:

1. **Hue carries meaning. The world gets value, not hue.** Terrain stays below OKLCH chroma 0.05. Saturated hue belongs to meaning: team, self, damage type, rarity, rank.
2. **Identity lives in the model. Allegiance lives in the overlay.** Fighters look the same on both teams. Bars, rings, telegraph rims and structure lanterns carry team, and they swap per viewer.
3. **The attack axis is horizontal on screen.** Every team-mode map runs from west to east on screen and mirrors across the north-south centre line. The screen is wide, so fights run wide, and both teams get the same view.
4. **Ornament is measurement.** The only ornaments are ticks, notches and survey marks, and they always measure something.
5. **One light, one grade, one key.** The sun always comes from the upper-left of the screen. One colour grade is locked for every map and the menu world. All music sits on A Dorian.
6. **Spectator clarity beats decoration.** When the two conflict, the decoration is cut.

---

## 1. WORLD

### 1.1 Premise (245 words)

Long ago the world drowned in cloud. **The Pall**, a slow white sea, filled every lowland, and only the high country stands clear. **The Vale** is the strangest part of it: a chalk valley that should lie under the cloud but doesn't. Two **Keels**, hull-stones from the age when people sailed the Pall, are sunk at either end and hold the cloud back. Break a Keel and the Pall pours into that half.

Two peoples share the Vale. The **Ollun** of the west are tarn-keepers. They build in slate and sea-glass, in domes, round arches and stacked drums, lit cool like early morning. The **Skerra** of the east are terrace-builders. They build in sandstone and timber, with pitched gables, stepped stairs and spires, warm like late afternoon. Neither can leave and neither will yield, so each season the quarrel is settled the old way: by champions, on chalk roads cut a thousand years ago.

**RIFT** is the full settlement: three roads, the **Brakes** between them, and **Masts** that must fall before the Keel. **BRIDGE** is the **Longspan**, one stone causeway over open cloud, where fighters are drawn by lot. **FRAY** is **the Stack**, a summit that rises from the Pall only when the cloud sinks low. There are no sides there. Every house sends one fighter, and the cloud throws back anyone who falls.

**Tone:** bright, sporting and mythic. A match is a public reckoning, not a war. Nobody is evil, and losing is respectable.

**Why this premise serves readability:**
- **Fog of war belongs to the world.** It is the Pall creeping in wherever nobody is watching.
- **The map edge is a cloud edge.** That justifies world-space edge fog (r10 §3.3).
- **Chalk makes boundaries visible.** Every walkable edge is literally marked in chalk.
- **The sides read in grayscale.** Their identities are split by temperature and by shape (round against angular), so they hold up in grayscale and under colour-vision deficiency (r06 §6.3).

### 1.2 The two sides (RIFT and BRIDGE)

| | **Ollun** (west, screen-left) | **Skerra** (east, screen-right) |
|---|---|---|
| Shape language | Circles, arches, domes, drum towers, bulging masses, horizontal banding | Triangles, pitched gables, stepped terraces, spires, diagonal bracing |
| Materials | Blue-grey slate, sea-glass, lime-washed render, pewter | Honey sandstone, oak, terracotta tile, bronze |
| Temperature (low chroma only) | Albedo hue 200-240°, chroma ≤ 0.04 | Albedo hue 50-80°, chroma ≤ 0.05 |
| Base landmark | **Tarnhallow**, with the **Lantern Dome** over the Ollun Keel | **Kilnstair**, with stepped terraces up to a kiln-mouthed chimney spire |
| Name sound (see 1.4) | Round sounds: *l, m, n, w, v, o, u, ou* | Spiky sounds: *k, t, sk, st, r, i, a, e* |
| Spectator side colour | Tarn blue | Cinder red |

**The rule that makes this work:** a side is a fixed property and is told apart by shape and material. Allegiance depends on who is watching, and is told by the reserved overlay hues. Architecture never uses the team hues. Banners and lantern cores are the only team accents on a structure, and they switch to the viewer's ally or enemy colour.

### 1.3 Why FRAY is a free-for-all

The Stack only stands clear of the Pall in the low-cloud weeks, and it belongs to no Keel. By custom, any house may send one champion. No sides are possible, so every fighter is their own team. Falling into the Pall is not death: the cloud throws you back up at one of the rim **Hoists**. The house still standing highest when the cloud rises again takes the season's honours, which is why **placement matters**. The **Chandler** keeps the one stall on the summit, so the shop and the pickups are shared.

### 1.4 Naming conventions

**Sound rule: names follow the bouba/kiki effect.** Round shapes get round sounds and angular shapes get spiky ones. Ollun names use sonorants and back vowels. Skerra names use stops and front vowels. A fighter's role tilts the name further, so a tank sounds heavy and an assassin sounds sharp. Listeners match the shape to the sound before they read the name.

| Category | Pattern | Examples |
|---|---|---|
| **Fighters** | 2 syllables (3 at most), 4-7 letters, stress on the first syllable. No apostrophes, hyphens, X, Z, Q or J, and no doubled vowels. | Ollun: **Moulen** (tank), **Lunow** (keeper), **Ouvel** (caster). Skerra: **Kestrit** (striker), **Tiskar** (marksman), **Askett** (bruiser). Wanderers: **Wennick**, **Brannoch** |
| Fighter roster rule | Across all 16 names: at least 12 different first letters, no two names sharing their first two letters, and lengths spread 4-8, so a kill feed can be scanned in 200 ms | |
| **Places** | A landform word plus a qualifier, or a two-word topographic name | **Tarnhallow**, **Kilnstair**, **Ennerdown**, **Gorsemoor**, **Haar Hollow**, **Kiteford**, **Longspan**, **the Stack**, **the Runnel** |
| **Structures** | One-syllable words from ship and water vocabulary | **Mast** (lane tower), **Weir** (lane gate, which holds back Pall-born waves), **Keel** (core) |
| **Objectives** | A weather or creature compound | **Haarwyrm** (a fog-wyrm that rises at Haar Hollow, late siege), **Driftkites** (kite-creatures riding the updraft at Kiteford, a stacking team boon) |
| **Currency** | Materials found in the Vale | **Glint** (in-match), **Chalk** (earned on the account), **Lumen** (premium) |
| **Systems** | Sea and harbour verbs or trades | **the Chandler** (shop), **Hoists** (FRAY respawn), **the Lot** (BRIDGE bench), **Cobbles** (lane minions: chalk-and-flint walkers carrying lanterns) |
| **Ranks** | Altitude, lowest to highest. Higher rank means higher ground, clearer air and a lighter colour | Heath, Fell, Tor, Crag, Ridge, Spire, **Cirrus** |

**The ten coined proper nouns, verified:**

| Name | Use | Deny-list policy check | grep -i substring hits | Known game or IP? |
|---|---|---|---|---|
| Ollun | west side and people | CLEAR | 0 | Web search found none |
| Skerra | east side and people | CLEAR | 0 | None found. Nearest is "Skerrit", a D&D centaur deity, which is a different word |
| the Pall | cloud sea and the fog-of-war lore | CLEAR | 0 | Common English word |
| Keel | core structure | CLEAR | 0 | Common word |
| Haarwyrm | late siege objective | CLEAR | 0 | Web search found none |
| Driftkite | repeatable objective | CLEAR | 0 | Web search found only a kitesurf product ("Drifter") |
| Longspan | BRIDGE map | CLEAR | 0 | Web search found none |
| Tarnhallow | Ollun base | CLEAR | 0 | Web search found none |
| Kilnstair | Skerra base | CLEAR | 0 | Web search found none |
| Glint | in-match currency | CLEAR | 0 | Common word |

The supporting names (Ennerdown, Gorsemoor, Haar Hollow, Kiteford, Runnel, Mast, Weir, Cobbles, Chandler, Hoists, Lumen, Chalk, Cirrus, and the eight fighter samples) were all checked and are CLEAR.

**Names rejected during this pass:**
- **Cairn.** Its whole-word check was clear, but "Cairn" is a 2026 climbing game by The Game Bakers.
- **Spindrift.** It is an itch.io game title and a drinks trademark.
- **Wisp.** It is on the exact-only deny list.
- **Glyph.** It is a deny-list term. FRAY's marks are therefore called "house chalkcuts".
- **Mark.** It is on the exact-only deny list.
- **Zenith.** It appears inside a LoL ability name.
- **Uncharted.** It is a Naughty Dog IP.
- **Ithra.** It is a Saudi cultural-centre brand.

**RIFT.** The deny registry lists "Rift" as a whole word. `names_allowlist.json` allows it **only** as the mode and queue name, and this bible obeys that rule: the RIFT map is **The Vale**, not "the Rift". If the owner ever wants a fallback name, **KEELBREAK** is clear and says what the mode is about.

---

## 2. PALETTE

### 2.1 UI neutrals: slate to chalk

| Token | Hex | L* | Role | Contrast (text tokens) |
|---|---|---|---|---|
| `bg-0` | `#07090D` | 2 | Letterbox, behind the scene | |
| `bg-1` | `#0C1016` | 5 | App background where there is no 3D | |
| `bg-2` | `#121821` | 8 | Panel base (shown at 86-92% opacity over the scene, blur 18 px) | |
| `surf-1` | `#18202B` | 12 | Card | |
| `surf-2` | `#212B38` | 17 | Raised or hovered card | |
| `surf-3` | `#2B3646` | 22 | Input wells, pressed state | |
| `line-1` | `#2E3846` | 23 | Hairline divider (decorative, about 1.4:1) | |
| `line-2` | `#4B5768` | 37 | Strong rule and focus base (2.2:1 on surf-1, used with width) | |
| `text-1` **Chalk** | `#F1ECE2` | 94 | Primary text | 13.9 on surf-1, 12.2 on surf-2: **AAA** |
| `text-2` | `#B3B8C1` | 75 | Secondary text | 8.2 on surf-1, 7.2 on surf-2: **AAA** |
| `text-3` | `#8C94A3` | 61 | Tertiary text and captions | 5.4 on surf-1, 4.7 on surf-2: **AA** |
| `text-dis` | `#5E6573` | 43 | Disabled (exempt from WCAG, kept near 3:1) | 3.3 on bg-1, 2.8 on surf-1 |
| `ink` | `#0C1016` | 5 | Text on a chalk plate | 16.2 on Chalk: **AAA** |

Panels float over a live 3D scene, so the bible requires panel opacity of at least 0.86 behind any text. That keeps the real background within ±3 L* of the token, so the contrasts above hold.

### 2.2 Brand

- **The brand accent is Chalk `#F1ECE2`, a value and not a hue.** The primary call to action is a chalk plate with ink text, which is the highest value contrast in the client. Nothing in the menus competes with it, because the menus contain no other bright hue.
- **Dawnline gradient** `#F7C59F → #EFA9B9 → #B7AEEA` (apricot to rose to lilac, the dawn over the Pall). Used **only** for the logo mark, season key art and splash backdrops. It never marks a state and never appears in a match.
- This is deliberately the opposite of a gold-on-teal client. There is no metal, no gem and no glow trim.

### 2.3 Relationship colours: self, ally, enemy

The default palette is the colourblind-safe palette. I searched about 25,000 OKLCH triplets for the set that maximises the worst-case CIEDE2000 distance under all three simulated colour-vision deficiencies. Per-type alternates gain at most 1.7 ΔE, so one default works for everyone (r06: "a CVD-safe default beats a separate colorblind mode").

| Token | Hex | L* | Use |
|---|---|---|---|
| `rel-self` **Beacon** | `#FBEB5B` | 92 | Your bar, your ground ring, your aim indicators, your minimap pip |
| `rel-ally` **Tarn** | `#48B0F0` | 68 | Ally bars, rings and rims. The Ollun side colour for spectators |
| `rel-enemy` **Cinder** | `#DD3B36` | 50 | Enemy bars, rings and telegraph rims. The Skerra side colour for spectators. In-match danger |
| `rel-ally-text` | `#6EC2F5` | | Ally names on panels: 8.4:1 on surf-1 |
| `rel-enemy-text` | `#F26A5E` | | Enemy names and error text: 5.5:1 on surf-1, 4.8:1 on surf-2 |

**Worst pairwise ΔE00 (higher is better; 10 or more reads as clearly different):**

| Palette | Normal | Deutan | Protan | Tritan | Grayscale | Enemy on bar plate |
|---|---|---|---|---|---|---|
| **Default** (Beacon / Tarn / Cinder) | 54.9 | **28.2** | **42.5** | **38.1** | 16.1 | 4.4:1 |
| Deutan alt `#F0F3C5 / #47B5FA / #ED3726` | 45.5 | 29.3 | 41.3 | 30.9 | 15.1 | 4.8:1 |
| Protan alt `#F5F86D / #47B5FA / #ED324B` | 56.2 | 27.3 | 44.2 | 34.0 | 15.2 | 4.8:1 |
| Tritan alt `#FEEEC1 / #4FBEC4 / #ED3726` | 33.0 | 28.9 | 27.0 | 37.6 | 15.6 | 4.8:1 |

The alternates ship as presets. Players can also set the enemy colour and the self colour themselves (now standard, per r06 [40][49]).

**Second code (shape) for every relationship, so colour is never the only signal:**

| | Overhead bar | Level badge | Ground ring (fighters only) | Minimap | Telegraph |
|---|---|---|---|---|---|
| **Self** | Beacon fill, plus a 2 px chalk **keel** line under the bar that overhangs 6 px each side. The bar is 10% larger | Circle with a notch | **Dashed** ring, 8 dashes | Filled disc, white halo, heading wedge | Outline only, 8% fill, visible only to you |
| **Ally** | **Rounded** end caps (r = 3 px) | Circle | Thin solid ring, 30% | Portrait disc with a heading tick | **Dashed** rim, no fill |
| **Enemy** | **Chamfered** 45° end caps (the "fang") | Chamfered square | Ring with 4 inward ticks, 50% | Portrait in a chamfered frame with a **chevron** for heading | **Solid** rim, fill and **45° hatch** |
| **Neutral** (monsters) | Square caps, ochre `#C9A25A` | Hexagon | none | Square | Bone rim and hatch |

### 2.4 FRAY: ten house colours, each with a chalkcut

The colours sit in three lightness tiers (light L* 80-86, mid 62-70, dark 47-49), and hues are spread so that no pair falls below **ΔE00 10.4 under any simulated colour-vision deficiency** (18.7 with normal vision). The palette came from a constrained search with a chroma bonus, then was named for voice callouts. The callout is always colour plus mark, for example "Red Chevron". Each slot number sits next to colours it differs from most.

| Slot | Callout | Hex | L* | Chalkcut (house mark) | Contrast on bar plate |
|---|---|---|---|---|---|
| 1 | Red | `#DB211A` | 47 | ⌄ Chevron | 3.9 |
| 2 | Cyan | `#46EDDD` | 86 | ● Disc | 13.3 |
| 3 | Orange | `#D48E06` | 65 | ‖ Bars | 7.1 |
| 4 | Violet | `#7954ED` | 48 | ✚ Cross | 4.0 |
| 5 | Green | `#23C361` | 70 | ★ Star | 8.3 |
| 6 | Pink | `#FEB0C6` | 80 | ▲ Triangle | 11.3 |
| 7 | Blue | `#39A6FB` | 66 | ■ Square | 7.4 |
| 8 | Pine | `#198643` | 49 | ☾ Crescent | 4.2 |
| 9 | Magenta | `#FB58B4` | 62 | ◆ Kite (tall diamond) | 6.6 |
| 10 | Lavender | `#CAC6FF` | 82 | ✖ Saltire | 12.0 |

**Pairs that can still be confused, and how the marks separate them.** The marks were assigned so that each of these pairs differs in outline or fill:

| Condition | Pair | Marks |
|---|---|---|
| Deutan | Cyan / Lavender | disc / saltire |
| Deutan | Orange / Green | bars / star |
| Protan | Cyan / Pink | disc / triangle |
| Protan | Violet / Magenta | cross / kite |
| Tritan | Green / Blue | star / square |
| Grayscale | Red / Violet | chevron / cross |

**Rules:**
- **Your own house always renders in Beacon** in your view, with a dashed self ring. Your slot colour is what other players and spectators see.
- No slot colour is closer than 14 ΔE00 to Beacon under any simulation.
- A **Simple Colours** switch reduces everyone else to Cinder plus their mark.
- The mark appears on the overhead badge, the minimap pip, the kill feed, the standings strip and the scoreboard.

### 2.5 Damage, healing and shields

The same language is used in world damage numbers, bar flashes, tooltips and the death recap (r04 §4.3).

| Token | Hex | L* | Second code |
|---|---|---|---|
| **Physical** "Bone" | `#F0E2C6` | 90 | Upright numerals |
| **Magic** "Heather" | `#8F7BFF` | 59 | Numerals in a slim oval chip in tooltips and the recap |
| **True** "Quill" | `#FF7AC8` | 69 | A ✦ prefix on every true-damage number |
| **Heal** "Sap" | `#57D98A` | 78 | Always **rises**: numbers and particles move up |
| **Shield** "Frost" | `#CFE6F2` | 90 | Always **hatched** at 45° on the bar, so it reads on any bar colour |

Worst case under any simulated colour-vision deficiency: 10.7 ΔE00 (Physical against Heal under deutan). Those two are separated by motion and context, since heals rise and land on allies. Grayscale collisions (Bone against Frost) never share a channel: one is a number and the other is a bar segment.

The grade also rotates foliage hue away from Sap (§7.4), so the environment never looks like healing.

### 2.6 Item tiers: metal plus notches

Hue is the second code here. The ornament ladder is the first.

| Tier | Frame metal | Hex | Notches on the frame | On surf-1 |
|---|---|---|---|---|
| T0 Consumable | Clay | `#A88470` | 0, round frame | 4.8 |
| T1 Component | Pewter | `#A3ADB8` | 1 | 7.2 |
| T2 Core | Verdigris | `#4FB8A0` | 2 | 6.8 |
| T3 Apex | Gilt | `#E2B65A` | 3, plus a chalk inner rule | 8.7 |

Gilt is a panel metal only. It never appears in the world, so it cannot be confused with Beacon.

### 2.7 Rank tiers: altitude equals lightness

Each rank is lighter than the one below. The ladder therefore reads correctly in grayscale, and the colour supports the name ("higher means clearer air").

| Rank | Hex | L* | Emblem form (ornament ladder) |
|---|---|---|---|
| Heath | `#8A6450` | 46 | Plain disc |
| Fell | `#6A9467` | 57 | Disc with 1 tick |
| Tor | `#8296BA` | 62 | Disc with 2 ticks |
| Crag | `#CF8F5F` | 65 | Notched plate |
| Ridge | `#78C4CC` | 75 | Notched plate with a contour line |
| Spire | `#D7C2F5` | 82 | Tall plate with 3 notches |
| Cirrus | `#F6F2EB` | 96 | Tall plate with a slow pearl sheen (the one animated emblem) |

### 2.8 State colours

| Token | Hex | Use | On surf-1 |
|---|---|---|---|
| `warn` | `#F2A93B` | Timers near zero, objective spawning soon, low resource | 8.2 |
| `danger` (match) | `#DD3B36` (Cinder) | Base under attack, low HP vignette | graphic only |
| `error` (client) | `#F26A5E` | Client errors | 5.5 (AA) |
| `ok` | `#57D98A` (Sap) | Success, ready | 9.1 |
| `focus` | Chalk 2 px plus a 2 px `bg-0` gap | Keyboard focus ring | 13.9 |

### 2.9 Terrain chroma ladder

These are graded-frame targets. They are the reason the world is quiet.

| Layer | L* (graded) | Max OKLCH chroma | Reference swatch |
|---|---|---|---|
| Lanes (chalk flag and turf seams) | 56-66 | 0.035 | `#9C978B` |
| Lane kerb | 46-52 | 0.03 | `#7B786F` |
| Jungle (the Brakes) floor | 26-38 | 0.05 | Ollun `#3A4541`, Skerra `#4A4236` |
| Camp clearings | 44-52 | 0.04 | `#6E6A5F` |
| Wall tops / wall faces | 58-68 / 18-28 | 0.035 | `#A8A294` / `#353A3C` |
| **Chalk lip** (every walkable edge) | 76-80 | 0.02 | `#C9C4B6` |
| Runnel (river) | 40-48 | 0.04 | `#5E6B70` |
| Bracken (brush) | 30-40 | 0.06 | `#5A4B35` |
| Landmarks | free value | 0.08 | |
| Objective pits and structure accents | free | 0.12 | |
| Fighters (focal areas) | full range | 0.20 | |
| Overlays and telegraphs | | 0.15-0.22 | |

---

## 3. TYPE

All three families are SIL OFL-1.1 and were verified with `npm view @fontsource/<name> version license` on 2026-10-07 (5.3.0 for each, plus `@fontsource-variable/*` builds). The weights and OpenType features below were read from the packaged woff2 files with fontTools. None of them resembles Beaufort, Spiegel, Radiance or Reaver: there is no flared fantasy serif and no Trajan capitals.

| Role | Face | Package | Weights present | Why |
|---|---|---|---|---|
| **Display** | **Syne** | `@fontsource/syne` | 400-800 | Wide, geometric capitals with flat-cut terminals. At 800 the letters are as wide as chalk-cut hill figures and survive motion, blur and distance. Used in capitals only. |
| **Heading** | **Syne** 600-700 (capitals, tracked) for panel titles. **Atkinson Hyperlegible Next** 700-800 for sentence-case headings | as above, and `@fontsource/atkinson-hyperlegible-next` | 200-800 | Keeps the family count at three |
| **Body** | **Atkinson Hyperlegible Next** | `@fontsource/atkinson-hyperlegible-next` | 200-800 | Designed by the Braille Institute for low-vision legibility. Letterforms that are usually confusable (I l 1, O 0, rn m) are distinct, which matters for names, chat and patch notes. Has `tnum` |
| **Numeric (tabular)** | **Atkinson Hyperlegible Mono** | `@fontsource/atkinson-hyperlegible-mono` | 200-800 | Every digit advance is the same (verified: 632 units), so timers, Glint and cooldowns never jitter. Same design DNA as the body face |

**Scale at 1080p.** Line height is shown after the slash. Tracking is in em/100.

| Token | Face / weight | Size / line | Tracking | Case | Use |
|---|---|---|---|---|---|
| `display-xl` | Syne 800 | 96/96 | +2 | CAPS | VICTORY / DEFEAT, mode names on the mode stations |
| `display-l` | Syne 800 | 64/68 | +3 | CAPS | Screen titles (PLAY, COLLECTION) |
| `display-m` | Syne 700 | 40/44 | +4 | CAPS | Fighter name in draft and collection |
| `h1` | Syne 700 | 28/32 | +5 | CAPS | Panel titles |
| `h2` | AH Next 700 | 22/28 | 0 | Sentence | Section titles |
| `h3` | AH Next 700 | 18/24 | +1 | Sentence | Card titles |
| `body-l` | AH Next 400 | 18/28 | 0 | Sentence | Lore and descriptions |
| `body` | AH Next 400 | 16/24 | 0 | Sentence | Default |
| `body-s` | AH Next 500 | 14/20 | +1 | Sentence | Tooltips, secondary text |
| `label` | AH Next 700 | 12/16 | +10 | CAPS | Overlines, chips, tab labels |
| `num-xl` | AH Mono 700 | 32/32 | 0 | | Big timer, respawn count, post-game totals |
| `num-m` | AH Mono 700 | 18/20 | 0 | | HUD gold, cooldown counts, KDA |
| `num-s` | AH Mono 500 | 14/18 | 0 | | Tables, stats |
| `hud-name` | AH Next 700 | 12/14 | +2 | As written | Overhead names (on in FRAY, optional elsewhere) |

**Rules:**
- **Capitals only for 1-3 word labels.** Display and labels may be in capitals. Buttons, body text and tooltips are sentence case. Never set a sentence in capitals.
- **Size floor.** HUD text is never below 12 px at 1080p. Below 1080p, HUD type scales with viewport height but stops at 11 CSS px. Menus scale with the UI-scale setting (80-150%).
- **Numbers.** Any number that changes while on screen uses AH Mono or AH Next with `tnum`. Prices use AH Next `tnum` with a currency mark before the number.
- **Loading.** Preload the 400, 700 and 800 latin subsets before the first paint of the client shell (`font-display: block` for about 150 ms, then `swap`). Fallback stack: `system-ui, sans-serif` tuned with `size-adjust`. No text may appear inside images.
- **Space for translation:** every label must fit 35% longer strings.

---

## 4. MENU MOOD

### 4.1 Materials: slate, vellum and chalk

| Material | What it is | CSS recipe (intent) |
|---|---|---|
| **Slate** | Matte, dark, cool panels: the structure | `bg-2` at 0.88 opacity, `backdrop-filter: blur(18px) saturate(0.8)`, a 1 px Chalk hairline at **top edge only** at 10% (light from above), radius 2 px |
| **Vellum** | Frosted, light-tinted overlays for tooltips and popovers | Chalk at 0.92 with ink text, blur 12 px, radius 2 px |
| **Chalk** | The only "accent": lines, ticks, the primary-action plate, focus | Solid `#F1ECE2` |

**Not allowed:** metal frames, gold, gems, bevels, glows on resting elements, painted textures on panels, rounded pills larger than 4 px radius (except avatars).

### 4.2 Shape language: three shapes, one job each

| Shape | Job | Where |
|---|---|---|
| **Plate** (rectangle, radius 2) | Structure: holds content | Every panel, card and list row |
| **Notch** (a 45° chamfer cut into one corner or end) | **This is where you act**, or **this is chosen** | The primary call to action has a chamfered right end (a "ticket cut"). The selected card gets a 10 px notch at top-left. Enemy UI chips have chamfered ends, matching the bar fang |
| **Tick** (a short line across a rule) | **Measurement** | Progress bars, timers, HP, rank emblems, sliders, the ornament ladder |

### 4.3 Grid and safe areas

- **Reference 1920×1080:** 12 columns of 126 px, 24 px gutters, 72 px side margins, 48 px top and bottom safe area. A 72 px header band and a 64 px footer band.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64 and 96 px. Nothing else.
- **At 1280×720:** reflow to 8 columns, keep 48 px margins, and stop type scaling at the floors in §3.
- **Ultrawide:** content stays in a centred 16:9 frame and the 3D scene fills the sides.
- **One primary action per screen.** Its chalk plate is always bottom-right of the content frame. "Back" is always top-left, and Esc does the same.

### 4.4 Ornament rules

Ornament exists to **measure** and to **rank**, never to fill space.
- **Allowed ornaments:**
  - ticks;
  - notches;
  - survey registration crosses (+) at the corners of key art;
  - topographic contour lines in backgrounds, at no more than 4% opacity;
  - the FRAY chalkcuts;
  - the ten-chalk-line mode marks.
- **The ornament ladder is the rarity and prestige scale:** plain, then 1 tick, then 2 ticks, then notched, then notched with contour, then 3 notches, then sheen. The same steps are used for item tiers, rank emblems and cosmetic rarity. If it is not on the ladder, it is not ornament.
- **Mode marks.** RIFT is three parallel chalk lines. BRIDGE is one line under an arch. FRAY is a ring of ten ticks. The reserved future slot is a dashed circle.

### 4.5 The menu background: "Above the Pall"

The client runs on **one continuous live 3D diorama**. Each screen is a **camera station** in it, so moving between screens is a short flight. This is how Rift, Bridge and Fray come to feel like one product: the three modes are three places in one world, under one light and one grade.

- **The scene.**
  - Dawn. The sun sits 8° above the horizon at the far end, so the panels are backlit.
  - The camera is about 120 m above a sea of cloud.
  - The Vale's chalk escarpment is in the middle distance, with the Lantern Dome and Kilnstair glowing faintly at either end.
  - The Longspan arches across a gap to the left, and the Stack rises out of the cloud to the right.
  - A moored cloud-hull rides at a mast in the foreground.
- **The Pall.** A large plane with two layers of domain-warped noise, faked forward-scattering toward the sun, and soft depth fade where it meets terrain. It drifts at 0.6 m/s.
- **Sky.** A Blender 5.2 Multiple Scattering sky HDR (sun disc off) with procedural clouds baked in. AgX tone mapping and the locked grade.

**Stations (camera flights use the `drift` easing):**

| Screen | Station | Flight |
|---|---|---|
| Home | The overlook: wide view of all three locations, season banner on the hull's sail | |
| Play / mode select | **The camera glides to the station of the highlighted mode**: the Vale floor (RIFT), the Longspan (BRIDGE), the Stack (FRAY). The fourth, reserved slot is a cloud-wrapped peak marked with a dashed survey circle and "Under the Pall": the designed empty state for a mode not yet charted | 1100 ms |
| Draft / loadout | A slate plinth on the overlook. Fighters turn on it under Neutral tone mapping so cosmetic colours are exact | 700 ms |
| Collection | The same plinth, with the grid on the left and the fighter on the right | 700 ms |
| Shop | **The Chandler's stall**: a lantern-lit awning on the hull deck | 900 ms |
| Profile | Your **season stones**: stacked chalk stones, one per season played, with the rank emblem on top | 900 ms |
| Settings | No flight. The scene dims to 40% and blurs to 24 px | 220 ms |
| Post-game | The station of the mode just played, re-lit: **victory** means the sun breaking through; **defeat** means the Pall rising up the slope. Both are dignified, never mocking | 1100 ms |

**Budget and behaviour:**
- GPU budget for the scene is 4 ms or less at 1080p.
- Rendering pauses when the tab is hidden.
- Reduced-motion mode replaces every flight with a 220 ms crossfade and freezes the drift.
- Idle drift: ±1.5° yaw over 90 s, plus cursor parallax of ±0.6° that settles over 600 ms.

### 4.6 Motion language: things surface and things sink

Things **surface out of the cloud** as they enter: they rise 12 px, un-blur from 4 px to 0 and fade in. Things **sink back** as they leave: they drop 6 px and fade out. Selection **settles** like chalk pressed onto a board, with a small overshoot.

| Token | Value | Use |
|---|---|---|
| `--dur-micro` | 90 ms | Press, toggle, tick, checkbox |
| `--dur-fast` | 150 ms | Hover, focus, tooltip in |
| `--dur-base` | 220 ms | Menu open, tab change, card expand |
| `--dur-panel` | 320 ms | Drawer, modal, content swap |
| `--dur-scene` | 700-1100 ms | 3D station flights |
| `--dur-reward` | 900-1400 ms | Number tick-ups, reveals (always skippable) |
| Exit duration | 0.7 × enter | Leaving should not hold attention (r05 §3.1) |
| `--ease-surface` | `cubic-bezier(0.16, 1, 0.3, 1)` | Everything that enters |
| `--ease-sink` | `cubic-bezier(0.5, 0, 0.75, 0)` | Everything that leaves |
| `--ease-settle` | `cubic-bezier(0.3, 1.35, 0.55, 1)` (about 5% overshoot) | Select, lock-in, equip |
| `--ease-drift` | `cubic-bezier(0.45, 0, 0.2, 1)` | Camera flights, long moves |
| `linear` | | Timers and fuses only |
| Stagger | 24 ms per item, capped at 240 ms total. Grids stagger by (row + column) | Lists and grids |
| Navigation direction | Forward enters from the right (24 px). Back enters from the left | Screen content swaps |

**Choreography:**
- **Lock-in has three beats:**
  1. the notch snaps (90 ms, settle);
  2. a chalk line strikes under the name (220 ms);
  3. the fighter on the plinth plays its ready pose (600 ms) and the lock-in sound fires on beat 1.
- **Ready check.** The scene dims to 40%. The panel surfaces with `settle`. A chalk **fuse** burns along the bottom edge and turns warn-orange at 5 s and Cinder at 3 s, pulsing at 2 Hz.
- **Post-game runs in order of importance, 4.5 s or less, any key skips:**
  1. outcome banner (0 ms);
  2. your result card (+400 ms);
  3. progression fill (+700 ms, 1.2 s with ticking);
  4. rewards (+300 ms each);
  5. commend;
  6. requeue as the primary call to action.

### 4.7 State treatments

Every component ships with every state (r05 §3.3: "state coverage is the clearest sign of a finished menu").

| State | Treatment |
|---|---|
| Default | Slate plate. Primary actions are a chalk plate with a ticket cut |
| Hover / focus | Plate lightens +4 L* (to surf-2). A 1 px chalk underline grows from left to right (150 ms). **Keyboard focus is identical to hover plus the focus ring** |
| Pressed | Moves down 1 px and darkens −6 L* (surf-3), 90 ms. **Sound on press, not on release** |
| Selected | Chalk 10 px notch at top-left, and a 2 px chalk rule on the left. Stays after the pointer leaves and is never confused with hover |
| Disabled | Text drops to `text-dis`, no hover. The tooltip always says **why** ("Reach Fell to queue ranked") |
| Locked (not owned or not unlocked) | **"Under the Pall"**: a 45° hatch at 12% chalk, a padlock tick and a visible **path** (price in Chalk or Lumen, level, or mission). Different from disabled |
| Loading | A skeleton at final size, with a **mist sweep** (a 6% light gradient crossing every 1.6 s). A spinner only after 1.2 s: a chalk circle drawn stroke by stroke |
| Empty | One chalk line drawing (from a set of 6), one plain sentence and one action. Example: "No replays yet. Watch a featured match" |
| Error | A 3 px Cinder rule on the left, a plain message, **Retry** as primary and **Details** as secondary. Never a dead end |
| Timed | The chalk fuse on the element itself, turning warn at 5 s and Cinder at 3 s |
| New / unseen | A 6 px chalk dot that clears on view |
| Purchase confirm | Never optimistic. Two-step confirm, then a celebration only after the server confirms |

### 4.8 How the UI sounds

The UI sounds **chalk, slate and glass**: dry, woody, close, and never synthetic beeps. Every sound comes from the audio palette in §10.

| Event | Sound |
|---|---|
| Hover | A barely audible "chalk tick" |
| Press | A slate tap |
| Confirm | A two-note harp pluck from the motif |
| Back | The same pluck reversed and quieter |
| Error | Two muted drum taps |
| Match found | The bellglass motif fragment, 5 dB above other UI sounds and on its own slider floor |

---

## 5. IN-GAME CAMERA

### 5.1 Numbers

| Parameter | Value | Reason |
|---|---|---|
| Pitch (below horizontal) | **54°** | Keeps a three-quarter silhouette (cos 54° = 0.59 of a figure's height shows) while ground telegraphs stay close to their true shape (a ground circle reads at 0.81 aspect) |
| Vertical FOV | **24°** (horizontal FOV 41.4° at 16:9) | Narrow, so perspective is mild. Objects at the top of the screen appear at **1/1.37** the size of those at the bottom, against about 1/1.65 for a 40° FOV. Telegraphs look the same size wherever they are |
| Default distance (camera to look-at point) | **29.0 m** (camera height 23.5 m) | Gives the target fighter height below |
| Zoom range (play) | **25-33 m**, scroll with a 200 ms `drift` ease, identical for every player | Information parity (r04 §6.3) |
| Spectator zoom | 22-46 m | |
| Yaw | **Fixed at 0°**: the camera looks screen-north (world −Z) | |
| Framing | The look-at point sits **0.6 m screen-south** of your fighter. The fighter's feet land at 46% of screen height and the head at 35%, which keeps the bottom HUD clear | |
| Lock modes | Locked, semi-locked (fighter kept within a 70% safe box) and free (edge-pan plus a drag-grip key). Double-tap re-centres. A hold-to-scout key snaps back on release | r04 §9a(7) |

### 5.2 The math: target fighter height

On-screen height of a standing figure: `px = H · h · cos(φ) / (2 · D · tan(θ/2))`, with H = 1080, φ = 54° and θ = 24°. Ground pixels per metre at screen centre: `H / (2 · D · tan(θ/2)) = 2540 / D`.

| Zoom | D | px per m | **Standard fighter 2.1 m** | Compact 1.8 m | Large 2.6 m | Same standard fighter at 720p | Visible ground (width at centre × depth) |
|---|---|---|---|---|---|---|---|
| Closest | 25 m | 101.6 | **125 px** | 107 | 155 | 84 px | 18.9 × 13.5 m |
| **Default** | **29 m** | **87.6** | **108 px** | 93 | 134 | **72 px** | **21.9 × 15.6 m** (27.1 m wide at the top row, 19.8 m at the bottom) |
| Farthest | 33 m | 77.0 | 95 px | 82 | 118 | 63 px | 24.9 × 17.8 m |
| Spectator | 46 m | 55.2 | 68 px | 58 | 84 | 45 px | 34.8 × 24.8 m |

**What follows from these numbers:**
- **Sign-off size.** Readability is signed off at **720p default zoom**, where a standard fighter is 72 px tall and a compact one 62 px. The silhouette rules in §8 are written for 62 px.
- **Texel density.** At closest zoom there are 101.6 px per metre. Fighter textures (1024², about 400 texels/m on a 2.1 m body) give at least 2 texels per pixel during play and are good enough for the plinth turntable. Ground materials target 160 texels/m.
- **Line widths.** The thinnest gameplay-relevant feature allowed on a model is **8 cm**, which is 7 px at default zoom.

### 5.3 How lanes line up with the camera

- **Every team map's attack axis is horizontal on screen.** Ollun is at screen-left and Skerra at screen-right.
- **Both teams see the same thing.** An angled camera always shows more ground ahead (north) than behind (about +9.0 m and −6.6 m). Because both teams attack sideways, they get **identical** view geometry in every lane, and no per-side camera offset is needed (compare r04 §6.3 and r06 §6.2).
- **Range fits the screen.** At default zoom a fighter sees about ±11 m along the attack axis, which comfortably covers the longest standard skillshot (about 10 m).
- **The Vale (RIFT map)** is 168 m × 96 m, a 1.75:1 ratio close to the screen's.
  - The North road runs along z = +36 m, the Mid road along z = 0 and the South road along z = −36 m, all straight west to east.
  - The **Runnel** (river) runs north to south through x = 0 and is the "which half am I on" divider.
  - The two objective pits sit on the centre line: **Haar Hollow** at the north crossing and **Kiteford** at the south crossing.
  - The map is a **mirror reflection** across x = 0, not a rotation.
  - This orthogonal topology (horizontal roads, a vertical river, pits on the centre line) is deliberately unlike any diagonal three-lane layout.
- **Longspan (BRIDGE)** is 112 m × 28 m, with one deck from west to east and side galleries.
- **The Stack (FRAY)** is a 64 m round summit with no axis. Fairness there comes from spawn rotation.

---

## 6. HUD DENSITY

### 6.1 Budget

**Always-on HUD at most 11% of a 1080p screen. Peak with contextual elements at most 16%.** Overhead bars are not counted.

| Element | Size at 1080p | Area | Always or contextual |
|---|---|---|---|
| Kit bar (bottom centre): portrait, HP and resource, 4 abilities, 2 utilities, 6 items, Glint | 704 × 112 | 78.8k | Always |
| Minimap, RIFT (bottom right, 1.75:1 like the map), with frame | 396 × 231 | 91.5k | Always |
| Ledger (top centre): ally score, clock, enemy score, objective pips | 440 × 56 | 24.6k | Always |
| Ally frames (left edge, upper third), 4 × 176 × 44 | | 31.0k | Always (team modes) |
| **Total always-on** | | **≈ 226k = 10.9%** | |
| Event feed (top right, 4 lines, fades after 5 s) | 360 × 112 | 40.3k | Contextual |
| Chat and ping log (bottom left, fades after 6 s) | 420 × 132 | 55.4k | Contextual |
| Objective timers (under the ledger, shown from 60 s before spawn) | 2 × 48 × 48 | 4.6k | Contextual |
| **Peak** | | **≈ 15.8%** | |

**Per mode:**
- **BRIDGE** minimap: a 384 × 96 strip.
- **FRAY** minimap: a 232 × 232 circle.
- **FRAY standings strip:** replaces the ledger (top centre, 10 chips of 40 px with colour, mark and score, sorted, your own chip outlined in Beacon).

**Settings:** HUD scale 80-120%, minimap scale 80-140%, minimap side left or right. **Legibility floor:** at minimum scale no HUD text goes below 11 CSS px.

### 6.2 Corners, centre and the line through the middle

- **The centre 40% × 50% of the screen holds no HUD at all**, only world-space overlays. That is where the fight happens.
- **Bottom centre is "me"** (the kit bar). **Top edge is "the world"** (ledger and timers). **Bottom right is "the map".** **Left edge is "my team".** **Top right is "what just happened".** **Bottom left is "what people said".**
- **Contextual layers:**
  - **Hold Tab** for the scoreboard.
  - **Hold the ping key** for the 6-way wheel, which contains only positive and logistical pings.
  - **On death**, the recap replaces the kit bar's centre: top 3 sources, damage-type split in the §2.5 colours, fight length and time spent crowd-controlled.

### 6.3 Overhead bar anatomy (fighters)

```
           [name 12px, optional]           ← FRAY: always on; team modes: off by default
   ◖14px◗◖14px◗                            ← up to 3 status icons with radial timer
 [◎18]|██████████████▒▒▒▒/////|            ← badge · HP 74×9 · ghost · shield hatch
       ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔             ← resource 74×3 (Chalk 85%)
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━           ← self only: 2px chalk keel, overhangs 6px
```

- **Size and position.** 92 px wide in total at 1080p. Bars keep a **fixed screen size**: they do not scale with zoom. They sit 14 px above the head. At 720p they shrink with the viewport only to 80% of their 1080p size, because bars are information.
- **Plate.** `#0B0E14` at 80% with a 1 px darker outer stroke. Every fill colour is measured against this plate (Cinder 4.4:1, Tarn 8.0:1, Beacon 15.8:1).
- **Ticks.** A light 1 px tick every **200 HP** (hidden when ticks would be closer than 4 px) and a heavy 2 px tick every **1000 HP**. Fixed units, so health compares across fighters (r04 §1.3).
- **Ghost.** Recent damage shows as a Chalk segment at 70% that holds for 350 ms, then shrinks over 250 ms.
- **Shield.** A Frost segment with a 45° hatch, appended after current HP. Overflow compresses the bar.
- **End caps** carry relationship: rounded for ally, chamfered fang for enemy, square for neutral. The self bar is 10% larger with the keel. In FRAY the badge becomes the house chalkcut in the slot colour.
- **Minions:** a 40 × 4 bar with no badge, shown only when damaged.
- **Structures:** a 140 × 10 bar with plating notches.

### 6.4 Telegraph colours and opacity

Telegraphs are drawn in a **post-grade overlay pass** (depth-tested against the main depth buffer, after tone mapping and the LUT, before SMAA), so **the hex in this bible is the hex on screen**. If that pass costs too much, the fallback is to pre-compensate the authored colours through the inverse LUT.

| Type | Rim | Under-stroke | Fill | Pattern | Visible to |
|---|---|---|---|---|---|
| **Enemy delayed area** | Cinder 100%, 10 px at default zoom | 3 px `#07090D` at 45% outside the rim (so it reads on light lanes) | Cinder 14%, sweeping out to 28% at impact | 45° hatch, 2 px every 10 px, 20% | Everyone |
| **Enemy skillshot during wind-up** (if the ability class shows it) | Leading-edge line plus width rails, Cinder 60% | Yes | none | none | Its targets |
| **Ally area** | Tarn, dashed 12/8 px, 55% | none | none | none | Allies |
| **Own aim** | Beacon 70% | Yes | 8% | none | You only (aim lines are private, impact zones are public) |
| Neutral or environmental hazard | Bone 80% | Yes | 10% | Hatch | Everyone |

**Rules:**
- **Overlapping fills** draw into one telegraph layer with **max blending**, so a stack of zones never goes above 40%.
- **The last 120 ms before impact:** the rim jumps to HDR 2.0 (it blooms), which is the "chalk snap".
- **Never white.** No telegraph uses white at rest.

### 6.5 Damage numbers

**Default policy:**
- Show **outgoing damage only**, as numbers on your targets.
- **Incoming damage is shown by the bar's ghost segment**, not by numbers (the numbers can be turned on).
- **Heal numbers** appear on yourself only.
- **Glint numbers** appear on last hits.

**Style:**
- **Font and outline.** AH Mono 800, 18 px base, size ∝ log10 of damage and capped at 30 px. A 2 px `#07090D` outline at 80%. Colours follow §2.5.
- **Crits and true damage.** Crits are 1.4× size with a ✦ (true damage always carries the ✦ prefix).
- **Merging and limits.** Hits on the same target within 200 ms merge into one number. At most 6 numbers on screen; the oldest is dropped.
- **Motion.** Each number rises 28 px over 700 ms (`surface` easing) and fades over the last 200 ms. Heals rise; damage pops outward.
- **Spectator view:** off by default.

---

## 7. WORLD LOOK

### 7.1 Global lighting rules

1. **One light, from the upper-left of the screen.** The sun azimuth is **270-285°** measured clockwise from screen-north, so the light comes from the left and slightly from the far side, at an elevation of 40-64°. UI bevels (the top-edge hairline), icons, portraits and splash renders all use the same upper-left key.
   - **Why not straight ahead or higher in the corner:** a sun due north at 50° elevation mirrors its specular reflection straight into a camera pitched at 54° (0.1° margin), which puts a glare band across the middle of the screen. Azimuths of 300-315° still come within 2-14° of the view cone.
   - **Margins of the chosen angles:** the sun's mirror direction stays **at least 22°** away from every view ray. This was checked numerically across the full frame: The Vale 24.6°, Longspan 28.0°, the Stack 22.8°.
2. **Fighters get their own key.** It is a per-material term in the fighter shader, not a scene light, coming from camera-upper-left (azimuth 225°, elevation 45°, 0.9× the sun's intensity), plus a Fresnel rim from the sun side. Their camera-facing fronts therefore always read light-on-top, even though the sun is beside and slightly behind them (r06 §5.2).
3. **Fighters never go dark in shadow.** A fighter in cast shadow keeps at least **75%** of its lit luminance (shader: `shadow = mix(1, s, 0.25)`). Shadows have no gameplay meaning, so the shading asymmetry between west and east faces is purely cosmetic.
4. **Contact grounding at every quality tier:** N8AO from Medium up, an instanced blob shadow on Low (r10 §1.7).
5. **No camera-distance fog in gameplay.** There is only world-space height mist, map-edge Pall fog, and fog-of-war darkening in one shader include (r10 §3.3). Fog of war is the Pall's colour: darken to 55% and desaturate to 40%.
6. **No moving cloud shadows on any play surface.** They would make visibility depend on position.
7. **No glossy surfaces on play areas.** Roughness stays at 0.45 or higher everywhere a fighter can stand.

### 7.2 Per-map settings

| | **The Vale** (RIFT) | **Longspan** (BRIDGE) | **The Stack** (FRAY) |
|---|---|---|---|
| Time of day | Mid-morning | Late afternoon | High noon |
| Sun elevation / azimuth (clockwise from screen-north) | 48° / 280° (shadow 1.9 m for a 2.1 m fighter) | 40° / 285° (shadow 2.5 m) | 64° / 270° (shadow 1.0 m) |
| Sun colour | 5600 K `#FFF1DE` | 4800 K `#FFE2BF` | 6000 K `#FFF6EC` |
| Sky (Blender 5.2 Multiple Scattering, sun disc off) | Altitude 1400 m, air 1.0, aerosol 0.8, ozone 1.0 (about Hosek turbidity 2.4) | Altitude 900 m, air 1.0, aerosol 1.4 (about turbidity 3.2) | Altitude 2600 m, air 0.8, aerosol 0.4 (about turbidity 1.9, deep-blue zenith) |
| Clouds baked into the HDR | 20% fair-weather cumulus | 35% altocumulus catching warm light | 10% wisps, with the Pall as a bright floor far below |
| Fog | Runnel height mist `#AEB8BE`, 18% maximum at ground, gone by 0.8 m. Pall edge fog `#C9CFD4` from bound +2 m to +14 m | The Pall below the deck: a shader plane at −30 m, `#6E7C8C`, value L* 40-52, in the valley's shadow, drifting 0.4 m/s. **No fog on the deck** | Rim fog `#D6DCE2` from rim +1 m to +10 m. Graded Pall floor at L* 72 or below |
| Intensity (exposure fixed at 1.0) | Sun 3.2, `environmentIntensity` 0.55 | Sun 2.8, env 0.6 | Sun 3.4, env 0.5 |

### 7.3 Value structure and landmarks

**The Vale (RIFT):**
- **Value plan.** Roads light and quiet (L* 56-66). Brakes dark (26-38) with lighter camp "rooms" (44-52). Walls with lit tops (58-68), dark faces (18-28) and a continuous **chalk lip** (76-80). The Runnel cool and mid (40-48).
- **Walls you can dash over** are knee-to-hip dry-stone walls with a chalk lip on **both** sides and a survey tick every 2 m.
- **Walls you cannot cross** are turf banks or cliffs with gorse on top and a single lip on the walkable side. They are recognisable from a 200 px crop (r06 §2.4).
- **Bracken (brush)** has a darker fringe ring and a 0.3 Hz sway. A fighter inside it shows at 60% opacity to allies.
- **One landmark per region:**

| Region | Landmark |
|---|---|
| Tarnhallow (Ollun base) | The Lantern Dome: a sea-glass dome over the Keel |
| Kilnstair (Skerra base) | The Kiln Stair: stepped terraces up to a chimney spire with a warm kiln mouth |
| Ennerdown (north Brakes) | **The Wreck**: the ribs of an ancient cloud-hull half-sunk in turf |
| Gorsemoor (south Brakes) | **The Ring**: seven leaning chalk menhirs |
| Haar Hollow (north river pit) | A mist basin around a broken sluice gate. The Haarwyrm rises out of the Pall seep here |
| Kiteford (south river pit) | Tall kite-poles with streamers that show wind direction. The Driftkites gather here |
| North escarpment | **The Long Walker**: a giant chalk figure cut into the valley wall, visible along the top edge of the screen from the North road |

**Longspan (BRIDGE):**
- **Value plan.** Deck flagstones 58-64. Parapet tops 60-66 with faces 22-30. Side galleries 44-50. The Pall below 40-52.
- **Landmarks.** The **Keystone** (the central arch platform where teamfights happen) and the two gatehouses: an Ollun drum tower and a Skerra stepped gate. The **Broken Arch** on the north side is the one place where the cloud shows through, framed.

**The Stack (FRAY):**
- **Value plan.** Concentric terrace rings alternate L* 54-62 and 46-52, so the ring you are on reads at a glance. A chalk lip runs along the drop-off.
- **Landmarks.**
  - The **Chandler's Mast** at the centre: the shared shop, with a pennant that is the summit's landmark.
  - **Six Hoists** around the rim (respawn), each a winch frame.
  - **Three pickup shelves** at 120° intervals.

### 7.4 The locked grade: VALE_GRADE_01

**One LUT for every map and the menu world.** Per-map differences come only from sun, sky and fog. There are no per-map LUTs, so all three modes look like one product.

The grade is **code**: `tools/grade.py` writes `vale_grade_01.cube` (33³, tetrahedral interpolation on High and Ultra) from the parameters below. Its hash is pinned in the contract, and changing it requires an art-director sign-off and a readability re-test.

```
Applied after AgX (no look), display-referred sRGB, in this order:
1  CDL        slope  (1.015, 1.000, 0.985)   offset (0.000, 0.003, 0.010)   power (1, 1, 1)
              → a touch warm in highlights, slightly cool-lifted blacks (laptop panels crush shadows)
2  Contrast   1.06 about pivot 0.46, soft toe and shoulder
3  Sat by luma        <0.15: ×0.80 | 0.15–0.60: ×1.00 | 0.60–0.85: ×1.05 | >0.92: ×0.90
                      (dark jungle goes quiet; bright highlights stay clean)
4  Hue-vs-sat (OKLCH hue)  95–165°: ×0.85 (foliage) | 75–95°: ×0.92 | 15–45°: ×1.08 (Cinder band)
                           | 225–260°: ×1.06 (Tarn band)   → the reserved bands are the most vivid things the grade makes
5  Hue-vs-hue  115–150° → −6° (foliage toward olive, away from heal Sap at 150–158°)
6  Split tone  shadows (luma < 0.25) +0.008 chroma toward 255° | highlights (luma > 0.75) +0.006 toward 80°
7  Gamut       soft-clip OKLCH chroma above 0.24 (knee at 0.20)
```

**Tone mapping:**
- **AgX** for gameplay and the menu world. The look comes from the LUT, not from the tone mapper, as r10 §1.1 recommends.
- **Khronos PBR Neutral** with an identity LUT for the plinth (draft, collection, shop), so purchasable colours are exact.
- **Exposure:** `toneMappingExposure` is locked at 1.0. Each map trims brightness only through sun and environment intensity, by ±0.15 EV at most. Bloom is locked: threshold 1.0, intensity 0.6, 6 mip levels.

---

## 8. FIGHTER LOOK

### 8.1 Shape language by role: mass distribution, not surface detail

| Silhouette class | Mass | Primary shape | Shoulder width : height | "Breaker" (the one element that breaks the outline) | Name sounds |
|---|---|---|---|---|---|
| **Bulwark** (tank) | Wide base, low centre of gravity | Rounded block | 0.65-0.85 | Slab shield or carapace | o, u, m, b, d |
| **Bruiser** | Top-heavy inverted wedge | Wedge | 0.55-0.70 | One oversized arm or weapon | a, o, r, g, k |
| **Striker** (assassin) | Narrow, leaning forward on a diagonal | Blade or triangle | 0.35-0.45 | One long blade or horn sweep | i, e, k, t, s |
| **Marksman** | Narrow and upright, with a strong horizontal | Cross | 0.40-0.50 (weapon reaches to 1.0) | Long weapon held level | t, k, a, short |
| **Caster** | Flared hem, slim top, vertical spike | Triangle plus a line | 0.45-0.55 at the hem | Staff or crown spike above the head | s, l, th, e |
| **Keeper** (support) | Rounded, with a hoop | Circle | 0.45-0.60 | Hoop, lantern or ring above or behind the head | m, n, w, l, ae |

**Height classes:** Compact 1.8 m, Standard 2.1 m, Large 2.6 m. Footprint radius 0.45-0.9 m. The selection collider follows the silhouette.

### 8.2 Silhouette rules (tested automatically in Blender)

1. **Uniqueness.** Black-fill renders at the gameplay camera, 62 px tall, from 8 facings. Every pair in the roster must have mask **IoU of 0.80 or less** after centring.
2. **Facing.** Facing must be readable from an asymmetric forward mass: the weapon or crest leads. A tester must call all 8 facings in under 1 s.
3. **Breakers.** At most 2 breaker elements per fighter.
4. **Minimum feature size.** Nothing gameplay-relevant is thinner than 8 cm (7 px).
5. **Width.** Shoulder width is at least 35% of height for every class except Striker and Marksman (at least 35% including the weapon). No stick figures at 62 px.
6. **Animation tells.** Wind-ups must change the silhouette (arm raised, weapon drawn back), not just the colour.

### 8.3 Value gradient: light top, dark feet

| Zone | Baked albedo L* |
|---|---|
| Head and shoulders (top 25%) | 62-82 |
| Torso | 42-62 |
| Hips and legs | 24-44 |
| Feet | 14-30 |

**Rules:**
- **Contrast between zones.** Head and leg zones differ by at least 12 L*.
- **Where light and dark go.** The brightest non-emissive patch is in the top third and the darkest in the bottom third (r06 §3.1).
- **Baked gradient.** A top-down "sky" gradient plus AO is baked into the albedo at 20-30% strength. It is soft and has no cast shadows, so the painted look survives PBR lighting.
- **Why it pays off.** A dark-footed fighter on a light chalk road stands out from the ground for free.

### 8.4 Detail density

- **Three viewing distances:**
  - **D1, gameplay** (62-155 px): 3-5 big shapes, 2-3 value groups, one focal point.
  - **D2, portraits** (Cycles, 512-1024 px): secondary forms.
  - **D3, splash and plinth:** tertiary texture.
- **Areas of rest** cover at least 50% of the silhouette.
- **Detail clusters:** at most 3, and one of them is at the focal point (head or weapon).
- **Texel density:** fighters about 400 texels/m (1024²), environment 160 texels/m. Checked with Texel Density Checker (r06 §10).

### 8.5 Material vocabulary

| Material | Roughness | Metal |
|---|---|---|
| Wool or linen cloth | 0.85-0.95 | 0 |
| Leather | 0.55-0.75 | 0 |
| Wood, slate, stone | 0.70-0.90 | 0 |
| Chalk or bone | 0.85 | 0 |
| Bronze or brass | 0.35-0.50 | 1 |
| Pewter or iron | 0.40-0.60 | 1 |
| Lacquer or enamel | 0.30-0.45 | 0 |
| Sea-glass (transmission faked with an emissive gradient of 0.6 HDR or less) | 0.15-0.30 | 0 |
| Fur and feathers: alpha-tested cards with dithered edges, never alpha-blended | 0.80 | 0 |

**Limits:**
- **Metal:** at most 30% of the surface, and at most 2 metal types per fighter.
- **Gloss:** roughness below 0.3 on no more than 3% of the surface (eyes, gems). Otherwise sharp specular glints at 100 px read as VFX noise.

### 8.6 Accent emissive: emissive is a tell

- **Area.** At most 4% of the visible surface, and only at the focal point (weapon tip, eyes, core gem).
- **At rest:** 0.8 HDR or less, which stays **below** the locked bloom threshold of 1.0.
- **During a wind-up:** rises to 1.5 or more, so it **blooms**. A glow therefore means "something is coming". It never decorates.
- **Hue.** The emissive hue is the fighter's identity hue and never a reserved band.

### 8.7 Identity hue families and skins

**Identity hue families** (one per fighter; within a family, fighters differ in lightness tier):

| Family | Hue range |
|---|---|
| Amber | 55-85°, L 0.80 or less, to stay away from Beacon |
| Moss | 110-138° |
| Teal-jade | 165-200° |
| Violet | 275-310° |
| Rose | 330-360° |
| Neutral | Bone, ink, white-hot only in T4 VFX |

**Reserved bands** that no kit and no skin may use as a dominant hue (more than 10% of body area or the core of an effect, at chroma above 0.08):
- **Cinder:** 15-45°.
- **Tarn:** 225-260°.
- **Beacon:** 95-115° at L above 0.85.
- **Sap:** 145-165°, for anything that isn't a heal.

**What a skin may and may not change:**
- **May change:** materials, ornaments, the identity hue (to another family), VFX textures and audio timbre.
- **Must keep:** silhouette IoU of **0.85 or more** against the base, the value gradient, VFX tier caps, telegraph rims and timings, the wind-up silhouette, and audio timing and loudness class.
- **Never:** a red-dominant or blue-dominant skin (it would read as a team), a pure-white body, or any emissive above the base fighter's caps.

---

## 9. VFX LANGUAGE

### 9.1 Importance tiers: brightness is a currency

| Tier | Examples | Peak HDR at the core | Duration | Particles (Ultra) | Required |
|---|---|---|---|---|---|
| T0 Ambient | Lantern flicker, pollen | 0.6 or less (never blooms) | Loop | 40 | Never inside gameplay zones |
| T1 Basic attack | Swings, bolts | 1.2 or less | 0.35 s or less | 30 | Head at least 2× tail brightness |
| T2 Ability | Most spells | 2.0 or less | 1.0 s or less (except zones) | 120 | Value sandwich (light edge plus dark edge) |
| T3 Control or heavy hit | Stuns, knock-ups, big nukes | 3.0 or less | | 200 | Ground telegraph if delayed. Allegiance rim. Distinct wind-up sound |
| T4 Ultimate or execute | | 6.0 or less. **The only tier allowed a white-hot core** (R=G=B ≥ 4) | | 300 | Unique audio, with separate ally and enemy versions |

Quality tiers scale **particle density only**: never size, colour, timing or telegraphs (r10 §0.7).

### 9.2 Value and colour rules

- **The value sandwich.** Every effect carries both a light edge and a dark edge, so it reads on a light chalk road (L* 62) and in the dark Brakes (L* 28).
- **Focus.** The dangerous part (projectile head, impact edge) has the highest value, saturation and detail. Tails stay at 40% of the head's luminance or less and at most 3× the head's length.
- **Reserved hues in VFX:**
  - Cinder and Tarn only as **allegiance rims**;
  - Beacon only for **your own** aim;
  - Sap only for **heals**;
  - white-hot only in **T4**.
- **Motion grammar:**
  - **Up means help.** Heals, shields and buffs rise.
  - **Down or out means harm.** Damage particles fall or burst outward.
  - **Sideways streaks mean movement.** Dashes leave horizontal chalk-dust streaks.
  - **Spirals mean control.** Crowd-control effects rotate.

### 9.3 Allies and enemies

- **Enemy:** damaging projectiles and zones get a Cinder rim on the **leading edge** at full opacity. Enemy wind-ups get the shared audio "chalk scrape" (§10).
- **Ally:** areas get dashed Tarn rims at 55%. Projectiles get no rim. Area effects play at 70% opacity.
- **Own:** your effects play at 85% opacity in your view, so enemy threats stay the brightest thing on your screen.
- **Spectator:** side colours (Ollun Tarn, Skerra Cinder) replace relationship colours.

### 9.4 Telegraph style: chalk lines

Telegraphs are instanced SDF ground quads (r10 §6.2): circle, ring, cone, line and rectangle. They have four parts: rim, under-stroke, hatched fill, and a progress sweep that fills from the centre out to meet the rim at impact. At impact comes the **chalk snap**: the rim goes white-hot for 1 frame, then a ring expands 0.4 m and fades over 150 ms. The colours and opacities are in §6.4.

### 9.5 Impact grammar

| Beat | Duration | What happens |
|---|---|---|
| **Tell** | 120-400 ms | Wind-up silhouette, emissive crosses the bloom threshold, enemy chalk-scrape sound |
| **Travel** | | Head brightest, tail fading |
| **Contact** | 50 ms or less | 2-frame flash. The victim gets a +25% luminance rim in the damage-type colour for 80 ms and a 60 ms animation hit-pause. **No global freeze.** |
| **Aftermath** | | Debris L* 60 or less, gone within 0.6 s. Scorch decals fade within 1.5 s. Nothing lingers except gameplay zones |

**Camera shake:** only when **you** are hit by T3+ or **you** land a T4. At most 4 px for at most 120 ms, and it can be turned off. Other people's impacts never shake your camera.

**Screen particle budget:** 2,500 or fewer at Ultra, 900 or fewer at Low.

---

## 10. AUDIO PALETTE

**One sonic-DNA sheet, all synthesised from scratch in numpy** (additive, FM, subtractive, Karplus-Strong and modal synthesis, noise, convolution). Rendered offline to WAV and shipped as WebM/Opus with an AAC fallback (r07 §6.3).

### 10.1 Key, tempo and motif

- **Key and mode: A Dorian** (A B C D E F♯ G). The home chord is Am(add9). The colour chord is **D major** (the raised sixth, F♯, is the signature).
- **Victory resolves to A major. Defeat stops on Dsus2.**
- **Tempo grid: 84 BPM.** A bar is 2.857 s. Combat layers run at the 168 BPM subdivision, so every stem and sting lines up on bar or beat boundaries.

**Motif: A3 – E4 – D4 – F♯4 – E4.** At 84 BPM the rhythm is a dotted quarter, an eighth, a quarter, a quarter and a half note.
- It climbs a fifth out of the cloud, steps down, reaches up to the Dorian F♯, and **ends on the fifth, unresolved**.
- **Only victory finishes it:** … E4 → A4.

| Use | Form |
|---|---|
| Login and victory | Full motif plus the resolution |
| Lock-in | D4 → F♯4 |
| Level-up | F♯4 – E4 – A4 |
| Match found | E5 – A5 – E5 × 2 on bellglass, 178 ms apart |
| Reward tick-up | Rising A-major arpeggio, one note per tick |

### 10.2 Instruments (8 patches, used everywhere)

| Patch | Synthesis | Role |
|---|---|---|
| **Chalk Harp** | Karplus-Strong with fractional delay and one-pole damping (stretch 0.996). Excited by a 4 ms band-limited noise pick. Two body resonators at 220 Hz and 1.1 kHz | Motif carrier, arpeggios, UI confirm |
| **Cloud Pad** | Subtractive: 7 saws detuned ±9 cents into a 24 dB/oct low-pass at 900 Hz, swept ±300 Hz by an LFO at 0.05 Hz. Attack 1.4 s, release 3 s. Sine sub-octave at −18 dB | Menu bed, draft |
| **Bellglass** | FM at carrier:modulator 1:3.5 (inharmonic glass). Index 6 → 0.5 over 1.2 s, amplitude decay 2.5 s. A quiet second operator at 1:1.41 | Stings, match found, rewards |
| **Hull Drum** | A 54 Hz sine with a pitch envelope from 150 Hz (40 ms), a 6 ms noise click at 2 kHz, and 2 inharmonic modes (×1.59, ×2.14) | Combat layer, lock-in, structure falls |
| **Rope Drone** | Bowed approximation: a saw through 3 formant band-passes (Q 8), 5.5 Hz vibrato at ±8 cents, plus bow noise | Match tension, defeat |
| **Pall Wind** | Pink noise through a band-pass that random-walks between 300 and 1,800 Hz, decorrelated in stereo | Ambience, menu air, the FRAY rim |
| **Tick Kit** | Woodblock (2 damped sines at 1.2 and 2.9 kHz, 25 ms), shaker (high-passed noise at 8 kHz, 35 ms), slate tap (modal, 640 Hz × 1, 2.32 and 4.25) | Rhythm, UI |
| **Spaces** | Synthesised convolution impulse responses. "Valley": RT60 2.8 s, 40 ms pre-delay, early reflections at 23, 41 and 67 ms, high-frequency damping above 6 kHz. "Near": RT60 0.5 s. **Two shared sends**, never one convolver per sound (r07 §4.3) | Everything |

### 10.3 Beds and stings

| Cue | Character |
|---|---|
| **Menu bed** | 84 BPM, 48 bars (2:17 loop). Pad, sparse harp (one note per beat from bars 9-40) and wind. **No drums.** The motif appears only in the 4-bar intro, because a hook repeated every minute grates (r07 §1.1). EQ dip of −3 dB at 1-4 kHz to leave room for speech. Ducks −8 dB under match found |
| **Draft bed** | Three stems that build over about 90 s: pad, then harp ostinato, then hull pulse. An urgency layer only the active picker hears: slate ticks at 2 Hz in the last 5 s of your own turn |
| **Match bed** | **Ambience first:** Pall wind plus a low rope drone. Driven by a weighted intensity score (r07 §1.3) through the states **calm** (wind, drone, sparse harp), **tension** (harp ostinato in eighths) and **combat** (hull drums on the 168 BPM grid plus the bowed ostinato). Hysteresis: enter above 0.6, leave after 8 s below 0.35. Changes quantised to the bar. `dead` cuts straight to wind. Every state has a HUD equivalent (a portrait border) |
| **Victory sting** | 6.0 s. Full motif plus resolution on bellglass and harp, a hull roll and a swell into A major |
| **Defeat sting** | 4.0 s and 4 LU quieter. A3-E4-D4 on harp over the rope drone, settling on Dsus2. **Dignified, never mocking** |
| **Impacts** | Three layers: transient (0-30 ms), body (30-300 ms), tail (0.3-2 s), scaled by VFX tier. **Every enemy T3+ wind-up gets the shared "chalk scrape" sweetener** (band-passed noise sweeping 2→5 kHz over 120 ms), so allegiance can be heard |

### 10.4 UI sound character and loudness

**UI sounds:**

| Event | Sound |
|---|---|
| Hover | 18 ms of band-passed noise at 3.6 kHz, −32 dBFS peak, ±4% random pitch, no more than one every 50 ms |
| Press | Slate tap, 60 ms |
| Confirm | Harp E5 → A5 |
| Back | Harp A5 → E5 at −4 dB |
| Error | Two hull taps on A2, 100 ms apart, low-passed |
| Tab | 90 ms soft swish |
| Timer urgent | Slate taps at 2 Hz, then 4 Hz in the last 2 s |
| Match found | −12 dBFS peak, 5 dB above other UI sounds, with a slider floor that "mute UI" cannot go below. Fired from the WebSocket handler (r07 §3.3) |

**Loudness:**
- Integrated **−18 LUFS ±2 LU**, true peak **−1 dBTP** or lower, measured over 30 minutes of representative play (r07 §4.1).
- Music bus 8 LU under SFX in a match. Menu bed −20 LUFS integrated.

---

## 11. ONE-PAGE TEST (the actual bible page)

> **VALE: the Clarity Bible.** Law for every screen. If a case is not covered, choose whatever makes the 200 ms read easier.

**World.** The Vale is a chalk valley that stands clear above **the Pall**, a sea of cloud, held back by two Keels. The **Ollun** (west, screen-left) build round in slate and sea-glass and are cool. The **Skerra** (east, screen-right) build angular in sandstone and timber and are warm. Champions settle each season: **RIFT** in The Vale, **BRIDGE** on the Longspan, **FRAY** on the Stack. Bright, sporting and mythic.

**Contract.** In 200 ms a player reads threat, then team, then health, then self, then objective. Contrast is spent in that order, and the environment gets what is left.

**Palette.** Hue carries meaning, and the world gets value.
- **Chroma caps:** terrain 0.05 or less (lanes 0.035), objectives 0.12, fighters 0.20 at focal points.
- **Menus** are slate, vellum and chalk. Text is Chalk `#F1ECE2` (13.9:1), secondary 8.2:1, tertiary 5.4:1. The brand accent is Chalk itself, and Dawnline appears only on the logo and key art.
- **Self Beacon `#FBEB5B`, Ally Tarn `#48B0F0`, Enemy Cinder `#DD3B36`.** This is the colourblind-safe default: worst-case ΔE00 is 28 (deutan), 43 (protan) and 38 (tritan).
- **Shape double-codes team:** rounded caps for allies, chamfered fangs for enemies, a keel line and dashed ring for self. Players can override the enemy and self colours.
- **FRAY:** ten house colours in three lightness tiers, each with a chalkcut mark, at least 10.4 ΔE00 apart under any colour-vision deficiency. Your own house is always Beacon.
- **Damage and healing:** physical Bone, magic Heather, true Quill with ✦. Heals rise in Sap. Shields are hatched Frost.
- **Ranks lighten as they climb:** Heath, Fell, Tor, Crag, Ridge, Spire, Cirrus.

**Type.**
- Syne 800 in capitals for display.
- Atkinson Hyperlegible Next for headings and body.
- Atkinson Hyperlegible Mono for every changing number.
- All are OFL on @fontsource. Body text is 16/24. HUD text is never below 12 px. Capitals only for labels of three words or fewer.

**Menus.**
- **One live diorama, "Above the Pall".** Each screen is a camera station, and mode select flies between The Vale, the Longspan and the Stack. The reserved fourth mode is a peak still under cloud.
- **Three shapes, one job each:** the **Plate** holds content, the **Notch** marks where you act or what is chosen, the **Tick** measures. Ornament only measures or ranks.
- **Motion:** things surface as they enter (ease-out, 150/220/320 ms), sink as they leave (0.7× the duration) and settle when chosen (5% overshoot). Stagger is 24 ms, capped at 240 ms.
- **Every component ships with every state:** hover/focus, pressed, selected, disabled (with the reason), locked (hatched, with a path to unlock), loading (a skeleton with a mist sweep), empty (one drawing, one sentence, one action), error (Retry), timed (a chalk fuse) and new.

**Camera.**
- Pitch 54°, vertical FOV 24°, distance 29 m, zoom 25-33 m for everyone, fixed yaw.
- A standard fighter is **108 px** at 1080p and 72 px at 720p. Sign-off happens at 720p.
- Team maps attack west to east and mirror across their centre line, so both sides see the same view.

**HUD.**
- At most 11% of the screen always on and 16% at peak. The centre stays empty.
- Bottom centre is me, top is the world, bottom right is the map, left is my team.
- Bars sit on dark plates with a light tick every 200 HP and a heavy tick every 1000 HP, a ghost segment and a hatched shield.
- Telegraphs render after the grade. Enemy telegraphs: solid Cinder rim, dark under-stroke, hatched fill of 28% or less. Ally telegraphs: dashed, no fill. Your own aim: Beacon, private.
- Damage numbers show outgoing damage only, merged over 200 ms, at most 6 at once.

**World look.**
- One sun from the upper-left. Fighters get their own key light and never drop below 75% in shadow.
- No camera fog, no cloud shadows, no glossy floors.
- Lanes are light and quiet, the Brakes dark, walls lit on top and dark on the face, and every walkable edge has a **chalk lip**.
- Morning for RIFT, late afternoon for BRIDGE, noon for FRAY.
- **One locked LUT** after AgX: quiet olive greens, boosted team bands, a cool lift and warm highlights. Exposure is 1.0.

**Fighters.**
- The role shows in how mass is distributed: block, wedge, blade, cross, spike or hoop.
- Light top, dark feet. At least 50% of the silhouette is rest, with at most 3 detail clusters. Silhouette IoU between any two fighters is 0.80 or less.
- Emissive covers at most 4% and stays below bloom until a wind-up: **a glow is a warning**.
- Skins are never red- or blue-dominant and must keep the silhouette, the value structure and the timing.

**VFX.** Five tiers. Brightness is a currency, and only ultimates get white-hot. Up means help, out means harm. Every effect has a light edge and a dark edge.

**Audio.** A Dorian at 84 BPM. Motif A3-E4-D4-F♯4-E4, resolved to A only by victory. −18 LUFS.

## 12. RISKS: what could make this look cheap in our pipeline, and how the bible prevents it

| # | Risk | How it shows up | What prevents it |
|---|---|---|---|
| 1 | **"Quiet world" turns into "grey world"** | Low-chroma terrain looks drab or like an unfinished prototype | Quiet means low **chroma**, not low **craft**: <ul><li>full **value** structure (lit tops, dark faces, chalk lips);</li><li>warm against cool halves;</li><li>material texture at 160 texels/m with macro variation;</li><li>a rich sky as image-based lighting;</li><li>landmarks allowed chroma 0.08, objective pits 0.12;</li><li>a split-tone grade.</li></ul>Colour arrives through fighters, VFX and the menu sky. Review in context, never as swatches |
| 2 | **Skin-modifier bodies look lumpy or blobby** | Soft, undefined forms at 108 px | Silhouette classes are defined by **mass**. Bevelled hard-surface armour plates cut the blob. Signed off with the 62 px black-fill IoU test and an 8-facing test. Painted value gradient. At most 3 detail clusters |
| 3 | **Procedural terrain tiles or repeats** | Visible texture grid, "Unity asset" ground | Splat with a macro-variation map. Decal paths for worn lanes. Chalk lips placed as geometry, not texture. Landmarks break sightlines. Triplanar only on cliffs (r10 §4.1) |
| 4 | **The post stack looks "default"** | Bloom smear, AO halos, washed-out ACES | Bloom threshold locked at 1.0 (only real highlights bloom). AgX plus the code-generated LUT with a pinned hash. N8AO radius tuned once per map (fixed pitch). Half-float buffers. SMAA after the grade (r10 §1.8) |
| 5 | **The DOM UI looks like a website** | Default focus rings, scrollbars, select boxes, layout jumps | Own component kit with every §4.7 state. Motion tokens. Sound on press. Styled scrollbars. Skeletons at final size. Font preload. One primary action per screen. **No stock widgets** |
| 6 | **The Pall shader looks fake** (a flat noise plane) | The menu world looks cheap | The Pall is seen only in the menu, at map edges and under the Longspan. Two warped noise layers, forward-scatter toward the sun, depth-fade blending, slow drift. Its cheapest fallback (Low tier, reduced motion) is a **pre-rendered Cycles loop**, never a flat texture |
| 7 | **Sun-ahead glare or flat front-lighting** | Specular band in the middle of the screen, or no form at all | Sun at upper-left azimuth 270-285° (the mirror direction stays at least 22° from every view ray, checked numerically). Fighter key as a shader term. Roughness 0.45 or more on play surfaces |
| 8 | **Numpy synthesis sounds like chiptune** | Thin, static, "made in code" | Physically modelled plucks and modal percussion rather than raw oscillators. Convolution space on every patch. Round-robin variation (3-5) and ±1-2 semitone jitter. Slow LFO movement on pads. Gentle tape-style saturation on the master. Loudness normalised |
| 9 | **Too many restrictions make fighters samey** | 16 fighters in the same muted palette | 5 identity families × 3 lightness tiers = 15 slots plus neutral. Shape classes carry most of the identity. Fighters are allowed chroma 0.20, four times the terrain |
| 10 | **Overlay colours shift under the grade or tone mapping** | Cinder looks orange on one map, Tarn looks teal | Telegraphs, rings and bars draw in the post-grade overlay pass, so the hex is the screen colour. The CI screenshot probe samples overlay pixels on every map |
| 11 | **Dark FRAY colours vanish on dark ground** | Red, Violet and Pine (L* 47-49) lost in the Brakes | Every slot colour sits on a dark bar plate (≥ 3.9:1) and has a chalkcut. Ground rings carry a dark under-stroke **and** a light inner line |
| 12 | **The DOM HUD drops frames or blurs at 720p** | Soft text, jank in teamfights | Bars composited with transform and opacity only, snapped to whole pixels, text floor of 11 px, HUD updates throttled to 30 Hz except the cooldown wipe (60 Hz) |
| 13 | **The name "RIFT"** | Deny-list collision, trademark adjacency | Allowed only as the mode name (`names_allowlist.json`). Maps, objectives and structures never use it. Fallback **KEELBREAK** is verified clear |
| 14 | **The live 3D menu is too heavy on low-end machines** | Fans spin up in menus, slow boot | GPU budget of 4 ms or less. Pause when hidden. Cycles-rendered loop fallback. Boot-to-interactive tracked as a KPI (r05 §1.1) |

---

## Appendix A: verification log

**Deny-list method.**
- **Script:** `denycheck.py` in this run's scratchpad, applying the policy in `protected_names.json`: NFKD normalisation, diacritics stripped, lowercase, collapsed spaces, a second pass with non-alphanumerics removed, and leading "the" dropped for exact-only entries.
- **Category entries** are matched as whole words or phrases inside the candidate.
- **Exact-only entries** are matched as whole-name equality.
- **Raw `grep -i` substring counts** are also reported.

All names used in this proposal returned CLEAR except "Rift", which is allowlisted for the mode name only. Whole-word or substring "info" hits that the policy allows were Spire (Dota "Ice Spire"), Fell (Dota "Fell Spirit"), Ember, Tide, Cinder, Plate and Bridge (each only inside longer protected phrases). Of those, Fell and Spire are used as rank names (the protected entries are longer phrases, which the policy allows), and Cinder only as an internal token nickname.

**Web searches for known game or IP collisions (2026-10-07):**
- "Ollun", "Skerra", "Haarwyrm", "Longspan", "Driftkite", "Kilnstair", "Tarnhallow" and "Ennerdown" returned no game or IP of that name.
- "Spindrift" returned an itch.io game and a 2026 Steam title ("Spindledrift"), so it was rejected.
- "Cairn" was rejected from prior knowledge (a 2026 game by The Game Bakers).

Sources: [itch.io Spindrift](https://ocotillo-island.itch.io/spindrift), [Spindledrift](https://nodal.gg/game/spindledrift-5044880), [Skerrit (D&D)](https://planewalker.com/encyclopedia/skerrit_.html), [Northgame: Olrun](https://wiki.rpg.net/index.php/Northgame/Olrun), [Cabrinha Drifter kite](https://www.cabrinha.com/products/0-04-drifter).

**Fonts.** `npm view` returned `5.3.0 OFL-1.1` for `@fontsource/syne`, `@fontsource/atkinson-hyperlegible-next` and `@fontsource/atkinson-hyperlegible-mono`, and variable builds exist for all three. fontTools inspection of the packaged woff2 files:
- AH Next has `tnum` and `pnum`;
- AH Mono digits all advance 632 units;
- Syne has `tnum` and `lnum`.

**Colour method.** sRGB to linear to XYZ (D65) to CIELAB. CIEDE2000. Colour-vision deficiency simulated with the Machado, Oliveira and Fernandes (2009) matrices at severity 1.0 for protan, deutan and tritan, plus luminance-only for grayscale. WCAG 2.x relative-luminance contrast. Searches:
- **Relationship triplet:** about 25k OKLCH candidates. The objective was the worst-case ΔE across normal, deutan, protan and tritan, subject to a grayscale ΔE of at least 12.
- **FRAY ten:** hue bands × three lightness tiers. The objective was the worst-case pairwise ΔE plus a chroma bonus, subject to a contrast of at least 3:1 on the bar plate and a distance of at least 14 from Beacon.
