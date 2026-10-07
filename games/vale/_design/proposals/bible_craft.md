# VALE Style Bible Proposal: "FIRED" (craft and feasibility first)

**Author angle:** art direction that starts from what our exact pipeline renders beautifully, and picks a world in which those strengths are the look.
**Date:** 2026-10-07 · **Inputs:** r04, r05, r06, r07 read in full; r10 sections 0-8 and 11; r01-r03, r08, r11 skimmed; `protected_names.json` searched for every coined name (§1.5).
**Verification done for this proposal:** fonts checked with `npm view` and fontTools (§3); every colour pair measured for WCAG contrast and for CIEDE2000 separation under simulated deutan, protan and tritan vision using Machado-2009 full-severity matrices (§2); camera framing computed (§5); the locked LUT prototyped as a 33³ `.cube` and measured (§7.4). Scripts were run from the session scratchpad and are not committed.

---

## 0. The feasibility thesis

We are not going to out-render a 2027 AAA engine at photoreal humans in a browser tab. We can beat most shipped games at one thing: **objects that are smooth, bevelled, glossy and lit by a real sky**. Our tools are built for exactly that kind of object.

| What our pipeline does beautifully | Why | What VALE turns it into |
|---|---|---|
| Bevelled hard surfaces under a PMREM sky | Bevels catch 2-3 px specular edges; glossy dielectrics mirror the sky HDR | **Glaze.** Every fighter and building is fired ceramic, and every glazed top reflects the Blender sky the camera never sees directly |
| Skin-modifier organic bodies | Out of the modifier they look smooth and hand-pressed, never anatomical | **Clay bodies.** We stop pretending they are flesh |
| Screw/lathe modelling | Perfect rotational forms in seconds, endlessly variable | **Thrown ware:** vessels, domes, bottle kilns, rank emblems, menu props |
| Baked AO and curvature in 1024² base colour | A hand-painted feel survives PBR light | **Glaze pooling and breaking**, a real ceramic effect: glaze runs thick and dark in recesses and thin and light over edges |
| N8AO contact AO | Crevice darkening for free | Glaze pooling at runtime, plus contact grounding |
| Mipmap bloom on HDR emissive | Only true highlights bloom | **Kilnglass** sparks and kiln mouths: white-hot glow that means something |
| Height fog in world space | Cheap, stable for a top-down camera (r10 §3.3) | Kiln smoke, gorge mist, valley haze |
| Instanced opaque meshes | No sorting, no overdraw, receives AO and shadow | **Shards.** Impacts, deaths and destruction throw real ceramic sherds instead of big alpha sprites |

What the world deliberately **does not contain**, because it would expose our limits: photoreal faces and skin (fighters wear fired masks), hair (sculpted ceramic forms instead), simulated cloth (rigid glazed drapery with at most two sway bones), dense alpha-card foliage (the Vale grows clay reeds and shard thickets, not grass), large transparent volumes, water caustics, low-sun long shadows during play, and camera-distance fog.

**The one-line pitch for the look:** *a living kiln-valley of glazed figures, read from above in clean high-morning light: glaze on top, raw clay at the feet, and colour reserved for meaning.*

---

## 1. WORLD

### 1.1 Premise (250 words with the tone line)

The Vale is the floor of a volcano that never finished cooling. Its ground is clay, its rivers run slow with liquid glaze, and below it the Underkiln still burns. Anything shaped from Vale clay and fired in Vale heat wakes up. The fighters are those pieces, the Wakened: thrown, pressed, glazed and given a spark of kilnglass.

Two houses hold the rim. The Wheel, in the west, throws porcelain and builds as it throws: domes, drums, bottle kilns and rings, pale stone under cool light, like a kiln's first hour. The Slab, in the east, presses stoneware and builds in steps, slabs and tiled roofs, iron-red clay under amber light, like a kiln at full heat. Each season the Underkiln vents for one house only, and the houses settle it on the Vale floor.

RIFT is the full settlement at Kilnhollow: three roads, the Kilnyard between them, and Kilns and Flues that must fall before a house's Hearth goes cold. BRIDGE is Handlespan, one pulled-clay arch over the Glaze Gorge. Nobody picks who crosses; the morning's firing decides, and pieces left on the cooling shelf can be swapped. FRAY is the Wheelfair on the Wheelhead. Once a year house marks are set aside and every piece fights under its own maker's stamp. Whatever cracks is refired from the rim kilns, and the fair ranks every piece that comes out.

**Tone:** warm, tactile, sporting. Nobody bleeds. Pieces crack and are refired, and a defeat is mended in gold, never mocked.

### 1.2 How the fiction pays for itself (every element is a rule, a mechanic or a pipeline saving)

| Fiction | What it does for us |
|---|---|
| Fighters are fired pieces | Clay bodies, masks instead of faces, rigid drapery. The skin modifier, bevels and lathe become the art style instead of fighting it |
| Potters leave the foot of a pot unglazed | **The value-gradient rule is real pottery practice:** glazed and light at the top, raw and dark at the feet (r06 §0.4) |
| Glaze runs thick in hollows and thin over edges | Baked AO and curvature in base colour plus N8AO read as a material property, not as dirt |
| Death is a crack; respawn is a refire | No gore at any rating. Deaths become opaque instanced sherds (cheap, beautiful, readable). The kilnglass spark flies home and marks the respawn |
| Defeat is mended in gold seams | A dignified defeat screen (r07 §1.4) that is a single material swap on the post-game model |
| Kilns burn white, not orange | Environment emissives stay out of the enemy hue. "The only hot colour in the Vale is white heat" |
| Kiln spy-holes | Every structure has a peephole of kilnglass. That is where relationship colour lives on architecture (§2.3) |
| Maker's stamps | The FRAY double-coding glyphs are potter's stamps (§2.4). Identity marks are part of the world, not a UI afterthought |
| The Vale grows clay reeds and shard thickets | Brush and jungle without alpha foliage (§7.2) |
| The Glaze Gorge under Handlespan | A fog sea: depth for BRIDGE without modelling anything below the deck |

### 1.3 The two sides (RIFT and BRIDGE)

| | **The Wheel** (west, screen-left) | **The Slab** (east, screen-right) |
|---|---|---|
| Craft | Throwing on the wheel; porcelain | Slab-building and press-moulding; stoneware and terracotta |
| Architecture shape language | **Rotational.** Domes, drums, bottle kilns, rings, flared lips, horizontal throwing rings. Every building is a lathe profile | **Planar.** Stepped chambers (a climbing kiln), slabs, tiled pitched roofs, chamfered blocks, diagonal bracing. Every building is bevelled boxes |
| Clay body (albedo) | Pale grey-white, L* 70-78, chroma ≤ 8, cool cast (hue 230-260) | Iron-red to ochre, L* 42-58, chroma 14-24, warm cast (hue 40-70) |
| Glaze accents on buildings | Celadon, pale cobalt brushwork, at chroma ≤ 25 | Tenmoku brown-black and salt-glaze orange-peel, at chroma ≤ 25 |
| Light temperature at home base | Cool fill, 7000 K feel (one ground-bounce tint uniform per map half in the terrain and prop shaders; same sun for both) | Warm fill, 4200 K feel (same mechanism) |
| Base landmark | **The Bottle Kiln**: a 14 m bottle-oven silhouette visible from anywhere in the west half | **The Stepped Kiln**: seven chambers climbing the east slope, each mouth lit white |
| House stamp (absolute mark) | **◎ Wheel stamp** (ring with a centre dot) | **▣ Slab stamp** (square with an inset square) |
| Spectator colour (absolute) | Azure `#3D8BFF` | Ember `#FF5A2C` |

**The allegiance rule: the world tells you whose ground it is; the overlay tells you who is on your side.** Massing, clay body and the house stamp are absolute and look the same for every viewer, so "which half of the map am I in" reads in greyscale and under any CVD (r06 §6.3). Allegiance is relationship-coloured and drawn only by the system layer: health bars, ground rings, telegraphs, minimap, kill feed and the kilnglass spy-hole on each structure (ally Azure, enemy Ember, for every player on both sides). Spectators get the absolute version: west Azure, east Ember. Architecture never carries a team hue at chroma above 25, and the locked LUT actively suppresses world chroma in those hue bands (§7.4).

### 1.4 Naming conventions: "Cant for who, English for what"

Two registers, never mixed:

1. **The Vale Cant** is used for *who*: fighters and people. It is short and invented, and it sounds like clay being worked: soft wet consonants for the Wheel, hard fired ones for the Slab.
2. **Craft English** is used for *what*: maps, places, structures, objectives, currencies, ranks and items. These are compounds a new player can parse on first read ("they're taking the Bellkiln"), which serves spectator clarity and callouts.

**Phonetic palette (Cant)**

| Rule | Value |
|---|---|
| Length | 4-6 letters, two syllables, stress on the first |
| Allowed initials | **A B D E H I K L M N O R S T U V**: exactly 16, so **the 16 launch fighters take one initial each**. Minimap, scoreboard and pings can then fall back to a single letter without ambiguity |
| Medial clusters | ll nn rr tt kk · ls lv ms nd dr br kr tr sk |
| Endings | -a -i -o · -el -en -ev -im -in · -ad -ar -ik -ok · -sk |
| Wheel skew (soft) | l m n s v, with vowels e and i (Simel, Nimsa, Ilsev) |
| Slab skew (hard) | b d k r t, with vowels o and a (Rukta, Ottak, Tadok) |
| Unaligned skew | u and a with one soft and one hard consonant (Umbrin, Ambrel) |
| Banned | c f g j p q w x y z in fighter names; apostrophes, hyphens and diacritics; th, ph, ae; Latinate -us/-ius/-ia; angelic -iel/-ael; orcish -gar/-gor/-ak; the onsets Kha, Vel, Zh, Xer; doubled vowels. These rules keep the Cant clear of the reference games' signature sounds |
| Titles | None. A fighter is a name plus a forming-method tag ("Simel, thrown"; "Rukta, pressed"; tags: thrown, pressed, coiled, cast, carved). The genre's "Name, the Epithet" pattern is not used, and no tag may be a bare clay-body word that the deny-list holds (e.g. *Porcelain*) |

**Example launch roster names (16, one per initial, all checked clear in §1.5):**
Ambrel · Badro · Doknar · Elsiv · Hesmi · Ilsev · Korrad · Lenvi · Melsi · Nimsa · Ottak · Rukta · Simel · Tadok · Umbrin · Vimse.

**Craft English patterns**

| Category | Pattern | Examples |
|---|---|---|
| Maps and places | Closed compound of two craft morphemes (Kiln-, Glaze-, Slip-, Wheel-, Handle-, Sagger-) | Kilnhollow (RIFT map), Handlespan (BRIDGE map), Wheelhead (FRAY map), Glazeway (RIFT river), Kilnyard (RIFT jungle), Glaze Gorge |
| Structures | A single kiln-works noun | Kiln (lane tower), Flue (the base structure that gates the core), Hearth (core) |
| Objectives | "The" plus a craft noun, so each reads as a named thing | the Bellkiln (north river), the Old Sagger (south river) |
| Lane units | A small applied ornament | Sprigs |
| Currencies | Uncountable craft materials | **Glost** (in-match; a real potter's word for glaze-firing), **Clay** (earned), **Lustre** (bought) |
| Ranks | Wares in order of refinement | Earthen, Slipware, Stoneware, Ashglaze, Celadon, Cobalt, Eggshell, Whiteheat |
| Item tiers | Firing states | Raw, Fired, Glazed, Gilt |
| Items (for designers) | [Glaze or material] + [tool or vessel] | e.g. "Saltglaze Mallet", "Ash Ewer" (illustrative only; each must be checked) |

### 1.5 Ten coined proper nouns, verified

Method: a script applied `protected_names.json`'s own policy. Category entries were matched as whole words or phrases inside each name, `exact_only` entries were matched as whole-name equality after NFKD and apostrophe normalisation, and a second pass stripped non-alphanumerics. A raw case-insensitive `grep -i` substring search over the whole file was run as well.

| # | Name | Use | Deny-list result | Substring in file | Known-IP sanity |
|---|---|---|---|---|---|
| 1 | **Kilnhollow** | RIFT map | clear | none | No known game or brand |
| 2 | **Handlespan** | BRIDGE map | clear | none | none known |
| 3 | **Wheelhead** | FRAY map | clear | none | Generic pottery term (the disc of a wheel), not an IP |
| 4 | **Glazeway** | RIFT river | clear | none | none known |
| 5 | **Bellkiln** | RIFT north objective | clear | none | none known |
| 6 | **Old Sagger** | RIFT south objective | clear | none | "Sagger" is a generic kiln-box term |
| 7 | **Glost** | In-match currency | clear | none | Obscure craft word, not an IP |
| 8 | **Wakened** | The fighters, collectively | clear | none | Generic English |
| 9 | **Simel** | Example fighter (Wheel skew) | clear | none | none known |
| 10 | **Rukta** | Example fighter (Slab skew) | clear | none | none known |

Also checked clear: all 16 example roster names, Kilnyard, Underkiln, Kilnglass, Kilnlight, Wheelfair, Sprigs, Kiln, Flue, Hearth, Clay, Lustre, the eight rank names, the four item tiers, Slip-jar, Cooling Terrace, Luted Join, Saggar Stacks, Shard Garden, and the role names Guard, Brawler, Striker, Slinger, Caster and Tender.

**Caught and rejected by the check:** *Porcelain* (an exact-match LoL skin line, so the seventh rank became **Eggshell**, and "porcelain" appears in this bible only as a material description, never as a player-facing name), *Keystone* (an exact-match LoL rune term; the Handlespan midpoint is the **Luted Join**), *Vanguard* and *Bulwark* (exact matches in three reference games). Also dropped on IP grounds although the list allows them: *Spurs* (sports-club nickname) and *Sherds* (sounds like Dota's "Shards" currency).

---

## 2. PALETTE

All hex values are sRGB. "L*" is CIELAB lightness. ΔE is CIEDE2000. CVD figures use Machado-2009 at full severity. Contrast is WCAG 2.x.

### 2.1 UI neutrals: iron glaze and bisque

The client is a dark, warm, matte "tenmoku" (iron glaze) world with porcelain-white text. It is not a cold blue-black, so it cannot drift toward the reference client's dark-teal look, and the warmth matches the kilns.

| Token | Hex | L* | Role | Contrast as text on bg-1 / surface-1 / surface-3 |
|---|---|---|---|---|
| `bg-0` | `#0E0C0B` | 3 | Letterbox, behind the canvas, scrim at 80% | n/a |
| `bg-1` | `#161311` | 6 | Screen base | n/a |
| `surface-1` | `#1F1B18` | 10 | Panels, cards | n/a |
| `surface-2` | `#2A2521` | 15 | Raised and hover fills, inputs | n/a |
| `surface-3` | `#353029` | 20 | Popovers, tooltips, menus | n/a |
| `line-1` | `#3E3731` | 24 | Hairline incisions (1 px) | n/a |
| `line-2` | `#5A5048` | 35 | Strong dividers, idle borders | 2.4 / 2.2 / 1.7 (non-text UI ≥ 1.5 against its own surface) |
| `text-1` "Eggshell" | `#F4EFE6` | 95 | Primary text | **16.2 / 14.9 / 11.4** (AAA) |
| `text-2` "Bisque" | `#BDB2A3` | 73 | Secondary text, labels | **8.9 / 8.2 / 6.3** (AAA / AAA / AA) |
| `text-3` "Ash" | `#958A7D` | 58 | Captions, meta, timestamps | **5.5 / 5.1** (AA); 3.9 on surface-3, so large text only there |
| `text-disabled` "Cinder" | `#6A6158` | 42 | Disabled labels | 3.05 / 2.8. Deliberately under AA (WCAG exempts disabled controls) but still legible; always paired with a "why" tooltip |
| `incise-hi` | `rgba(255,241,214,0.06)` | n/a | The light lip under an incised line (§4.1) | n/a |

**Brand accent: light, not hue.** In VALE, hue means something (team, damage, tier), so the brand accent is **Kilnlight**, a warm white-hot.

| Token | Hex | Role |
|---|---|---|
| `kilnlight` | `#FFF1D6` | Primary call-to-action fill, focus rings, active tab underline, brand wordmark. Dark text on it: **16.6:1** |
| `kilnglow` | `#FFC46B` | Decorative only: a 24-48 px outer glow at ≤ 35% around the single primary action and around kiln mouths. Never text, never a state |

**Modes get no colour.** RIFT, BRIDGE and FRAY share every token. Each mode is told apart by its kiln door, its emblem silhouette and its live diorama (§4.4). That is how mode select reads as one product.

**Status (client):** ok `#6FD3A6` (10.2:1) · warn `#FFB547` (10.5:1, always with a ▲ icon) · danger = Ember `#FF5A2C` (5.95:1, always with a ✕ or crack icon) · info = Kilnlight.

### 2.2 Relationship colours: SELF, ALLY, ENEMY (plus neutral)

**The rule: cool is us, warm is them, and the brightest cool is you.** Self and ally share a temperature and differ by about 30 L*. Enemy is warm. Nothing in the enemy family is ever used for "friendly".

| Role | Default | Deutan alt | Protan alt | Tritan alt | Shape code (independent of colour) |
|---|---|---|---|---|---|
| **SELF** "Kilnglass" | `#8FF3FF` (L*90) | `#B9F6FF` | `#B9F6FF` | `#FFE8F4` | **Diamond pip** at the right end of the bar; ground ring with a **kiln-arch notch** pointing the way you face; minimap **diamond** with a heading tick; no name tag |
| **ALLY** "Azure" | `#3D8BFF` (L*59) | `#2F6BFF` | `#2F6BFF` | `#3D8BFF` | **Smooth** bar ends; **continuous** ground ring; minimap disc with a **solid** rim |
| **ENEMY** "Ember" | `#FF5A2C` (L*61) | `#FFA51F` | `#FFB21F` | `#FF4060` | **V-notched ("cracked")** bar ends; ground ring **broken into four arcs**; minimap disc with a **cracked (four-gap)** rim |
| Neutral (monsters, objectives) | `#E3C77A` "Straw" (L*81) | same | same | same | Square bar ends; no ring until aggroed; minimap **square** |

**Measured separation (minimum ΔE00 across the three pairs):**

| Set | Normal | Deutan | Protan | Tritan | Ally-enemy (worst case) |
|---|---|---|---|---|---|
| Default | 34.6 | 29.0 | 28.6 | 22.0 (ally-self) | **49.4** |
| Deutan alt | 41.3 | **37.5** | 36.4 | 29.9 | 58.4 |
| Protan alt | 41.3 | 37.5 | **36.4** | 29.9 | 56.5 |
| Tritan alt | 35.9 | 31.2 | 31.2 | **39.0** | 38.9 |

Each alternate is judged on its own (bold) column; the other columns show it stays usable when someone with a different vision type watches the same screen. The default already holds ally-versus-enemy at ΔE ≥ 49 for all four vision types, which is the pair that decides fights (r06 §0.7 asks for one default view that works for colour-blind players). The alternates exist because a protan sees the default Ember at L*51 (dim), and the alternate lifts it to L*74. They also raise the self-versus-ally floor. Players can override **self** and **enemy** colours freely (r06 §11 a13); the picker shows a live ΔE warning when a choice falls under 20 against the other two.

**Contrast against the world:** team hues sit at only 1.5-1.8:1 against mid-value clay (L*45-55), so every relationship mark on the ground is drawn with a **1 px dark keyline** (`#000` at 40%) outside it and a lighter core. On dark HUD plates they reach 5.6:1 (Azure) and 5.95:1 (Ember).

### 2.3 Where team colour may appear

| Layer | Team colour? |
|---|---|
| Overhead bars, ground rings, telegraph edges, minimap, kill feed, scoreboard rows, ally frames | Yes: relationship colour (absolute in spectator) |
| Structures | Only the **kilnglass spy-hole** (a 0.4 m emissive disc) and the HP bar |
| Fighter models, skins, ability VFX bodies | **Never.** Identity lives in the model; allegiance lives in the overlay (r06 §2.2) |
| Architecture, terrain, props | Never above chroma 25 in the Azure (H 200-232) or Ember (H 4-28) bands; the LUT suppresses those bands further |

### 2.4 FRAY: ten seat colours, each with a maker's stamp

In FRAY every fighter has a **seat**: a colour, a stamp glyph and a number 1-10. **Locally, your own seat is always drawn as SELF (Kilnglass) with your stamp**, so "gold is you" style ambiguity never arises: you are always the bright cool diamond, in every mode. The ten seat colours were chosen by a max-min search over ~150 in-gamut LCh candidates, excluding anything within ΔE 24 of Self, 22 of Ember (reserved for danger telegraphs) or 25 of the clay ground, and anything under 3:1 on `bg-1`. One swap was then made by hand to keep every colour nameable and to clear Self under tritan.

| Seat | Name | Hex | L* | Stamp (glyph) | Contrast on `bg-1` |
|---|---|---|---|---|---|
| 1 | Raspberry | `#E90F60` | 50 | ● **Boss** (filled disc) | 4.1 |
| 2 | Apricot | `#FEC07A` | 82 | ✚ **Cross** | 11.5 |
| 3 | Olive | `#B3A116` | 66 | ○ **Hoop** (ring) | 7.1 |
| 4 | Lime | `#DBEE19` | 90 | ▲ **Peak** | 14.3 |
| 5 | Forest | `#277203` | 42 | ═ **Rails** (two bars) | 3.1 |
| 6 | Teal | `#139D8A` | 58 | ■ **Block** | 5.5 |
| 7 | Periwinkle | `#A6B2F8` | 74 | ✖ **Tie** (saltire) | 9.1 |
| 8 | Indigo | `#6162FE` | 50 | ◆ **Lozenge** | 4.1 |
| 9 | Magenta | `#B60A99` | 42 | ⧓ **Hourglass** (bowtie) | 3.1 |
| 10 | Rose | `#FD97B7` | 74 | ☾ **Moon** | 9.1 |

- **Spread:** L* from 42 to 90 and hue round the whole wheel, with no pure red and no sky blue (both reserved).
- **Measured minimum pairwise ΔE00:** normal **19.9** (Olive-Lime and Raspberry-Magenta), deutan **10.2** (Apricot-Lime), protan **13.3** (Apricot-Olive), tritan **9.0** (Apricot-Rose). Every seat stays ≥ 13 from Self under all four vision types (Periwinkle is closest at 13.3, deutan).
- **Glyphs were assigned to the closest pairs first,** so every pair under ΔE 15 in any vision type differs by stamp family (filled vs hollow, round vs straight, upright vs rotated): Apricot ✚ / Lime ▲ / Olive ○ / Rose ☾; Indigo ◆ / Magenta ⧓; Teal ■ / Rose ☾; Periwinkle ✖ / Rose ☾. Ten colours is past the ~8-colour limit for hue alone (r06 §9), so **the stamp is the primary key and the colour is the fast key**.
- **Keylines:** seats with L* < 55 (Raspberry, Forest, Indigo, Magenta) get a 1 px Eggshell keyline on dark UI. Seats with L* > 75 get a 1 px Iron keyline on light ground.
- **Where seats show:** bar plate edge, stamp beside the level disc, ground ring, minimap marker (the stamp itself, 12 px), kill feed, standings rail, and the seat's rim kiln door. Enemy telegraphs in FRAY stay **Ember** (danger) with a 6 px tick in the caster's seat colour at the origin.
- **Options:** "Stamp-forward" (stamps at 150% and colour fill at 60%, the default when any CVD mode is on) and "Simple colours" (all other seats become Ember, which turns FRAY into self versus everyone, after r06 §9).

### 2.5 Damage, healing, shields, resources

| Token | Hex | L* | Contrast on `bg-1` | Fiction |
|---|---|---|---|---|
| Physical | `#F9D9AE` "Biscuit" | 88 | 13.7 | Cracks the clay body |
| Magic | `#D0A8FF` "Glaze violet" | 75 | 9.5 | Melts the glaze |
| True | `#FFFFFF` "White heat" | 100 | 18.5 | Pure kiln heat (also the T4 VFX colour, §9) |
| Heal | `#3FBF6A` "Green slip" | 69 | 7.8 | Always shown with a "+" prefix and upward motion |
| Shield | `#EADFC7` "Bone glaze" + 45° hatch (1 px Iron lines every 3 px) | 89 | 14.0 | A fresh coat of glaze |
| Resource: Heat (default) | `#F3E2A6` | 90 | 14.3 | |
| Resource: Breath (energy-type kits) | `#A9E7CF` | 87 | 13.2 | |

The damage hues avoid both team hues: physical sits 20.8+ from Ember and magic sits 11.3+ from Azure under every CVD. Physical against heal is the tightest pair (12.6 under protan, 15.6 under deutan), and it is also separated by context (heals appear only on you and the allies you heal), by the "+" prefix and by motion (heals rise and fade, damage pops and falls). The same three damage colours are used in numbers, bar flashes, tooltips and the death recap (r04 §4.3).

### 2.6 Item tiers (shop, inventory, tooltips)

| Tier | Hex | L* | Rim bands (double code) |
|---|---|---|---|
| Raw | `#8E8475` | 56 | 1 incised band |
| Fired | `#6FD3A6` | 78 | 2 bands |
| Glazed | `#F49BCB` | 74 | 3 bands |
| Gilt | `#F5C84C` | 83 | 4 bands plus a lustre sheen sweep on hover |

Minimum ΔE00: normal 29.6, deutan 15.2, protan 16.7, tritan 10.7. The ladder avoids the genre's grey-green-blue-purple-orange convention, because blue and orange are our team hues.

### 2.7 Rank tiers: the vessel gets more refined

Rank is shown by **a Cycles-rendered vessel** that becomes finer at each tier (a lathe profile and a glaze: cheap to make and premium to look at), plus division rim bands (I-III).

| Tier | Vessel | Colour | L* |
|---|---|---|---|
| Earthen | Pinch pot, raw clay | `#A27A5A` | 54 |
| Slipware | Shallow dish, trailed slip | `#D8C4A2` | 80 |
| Stoneware | Salt-glazed jug | `#93A0AD` | 65 |
| Ashglaze | Ash-glazed bottle with runs | `#A7B98F` | 73 |
| Celadon | Celadon vase | `#7FD1B0` | 78 |
| Cobalt | Brush-painted ewer | `#5B83F0` | 57 |
| Eggshell (apex, capped pool) | Translucent bowl, backlit | `#EEF2F6` | 95 |
| Whiteheat (top of apex) | The vessel still glowing in the kiln | `#FFF4DC` with animated `kilnglow` rim | 96 |

Rank colours appear only in the client, profile, loading cards and post-game, never on in-match overlays. Silhouette is the primary key, because rank colours alone fall to ΔE 3.7 under protan. That is acceptable only because each tier has a unique vessel shape.

---

## 3. TYPE

Three OFL families, all variable, about **101 KB total for Latin** (normal styles). Verified on 2026-10-07: `npm view @fontsource/<name> version license` returned **5.3.0 / OFL-1.1** for `anybody`, `figtree` and `chivo-mono`, and `@fontsource-variable/{anybody,figtree,chivo-mono}` are also 5.3.0. The packages were downloaded and their woff2 files read with fontTools.

| Role | Face | Package | Verified facts | Why this face |
|---|---|---|---|---|
| **Display** | **Anybody** (variable) | `@fontsource-variable/anybody` | Axes `wdth` 50-150 and `wght` 100-900; `tnum` present (tabular digits 900 units wide); x-height to cap-height 0.88; latin woff2 55.6 KB | A mechanical grotesque whose **width axis is a motion tool**. Titles expand into place (wdth 100 → 125) the way clay is pulled. The huge x-height reads at distance and over 3D. Nothing like a flared fantasy serif (Beaufort) or the reference clients' faces |
| **Heading / labels** | **Anybody**, condensed (wdth 75-90) | same file | same | One file covers screen titles (wide) and tabs, buttons and chips (condensed caps leave the 30-40% localisation headroom r05 asks for) |
| **Body** | **Figtree** (variable) | `@fontsource-variable/figtree` | `wght` 300-900; `tnum` present (620 units); U+2212 minus and U+00D7 times present; latin woff2 19.7 KB | A clean, friendly geometric sans whose round forms echo thrown ware. Calm and highly legible at 14-16 px; it leaves the personality to Anybody |
| **Numeric (tabular)** | **Chivo Mono** (variable) | `@fontsource-variable/chivo-mono` | `wght` 100-900; all digits 600 units (monospaced by construction); latin woff2 25.7 KB | Timers, Glost, cooldowns, stat tables and the scoreboard never jitter. A sturdy grotesque mono with a stamped feel; it is not a code font |

**Scale at 1080p (UI scale 100%).** Tracking is in % of the font size. Line height follows the slash.

| Token | Face · settings | Size / line | Tracking | Case | Use |
|---|---|---|---|---|---|
| `display-xxl` | Anybody 900, wdth 125 | 120 / 112 | -1 | CAPS | VICTORY / DEFEAT, mode name on its kiln door |
| `display-xl` | Anybody 850, wdth 120 | 72 / 72 | 0 | CAPS | Screen titles (PLAY, COLLECTION) |
| `display-l` | Anybody 800, wdth 115 | 48 / 52 | +1 | CAPS | Fighter name in draft, collection and loading |
| `h1` | Anybody 750, wdth 90 | 32 / 36 | +2 | CAPS | Panel titles |
| `h2` | Anybody 700, wdth 85 | 22 / 28 | +4 | CAPS | Section labels |
| `label` | Anybody 700, wdth 80 | 14 / 16 | +8 | CAPS | Buttons, tabs, chips |
| `body-l` | Figtree 500 | 18 / 26 | 0 | Sentence | Lore, descriptions, patch notes |
| `body` | Figtree 500 | 16 / 22 | 0 | Sentence | Default UI text, tooltip body |
| `body-s` | Figtree 500 | 14 / 20 | +1 | Sentence | Secondary lines |
| `caption` | Figtree 600 | 12 / 16 | +2 | Sentence | Smallest text allowed |
| `num-xl` | Anybody 800, wdth 80, `tnum` | 40 / 40 | 0 | n/a | Post-game counts, score strip kills |
| `num-l` | Chivo Mono 700 | 24 / 28 | 0 | n/a | Match clock, Glost |
| `num-m` | Chivo Mono 600 | 16 / 20 | 0 | n/a | Cooldowns, stats, prices |
| `num-s` | Chivo Mono 600 | 12 / 14 | 0 | n/a | Scoreboard cells, tooltip stats |
| `dmg` | Anybody 850, wdth 80, `tnum` | 18-30 | 0 | n/a | Damage numbers (§6.6) |

**Rules**
- **Casing:** Anybody is always CAPS. Figtree is always sentence case; names are title case. Never set body text in caps, and never set Anybody below 12 px.
- **Floors:** no rendered text under **12 px**, and no HUD numeral under **11 px**, at any UI scale (0.8-1.5) or resolution. At 1280×720 the UI scale defaults to 0.85 and the floors still apply.
- **Numbers:** every number that updates live uses `tnum` (Chivo Mono or Anybody with `tnum`). Proportional figures (`pnum`) only inside running prose.
- **Variable-axis motion:** only `wdth` animates, only on `display-*` layers, inside `contain: layout paint` boxes of fixed width, so animating it never reflows the page (§4.5).
- **Localisation:** none of the three ships Cyrillic, Greek or CJK. The stack falls back to `@fontsource/noto-sans` (and Noto Sans JP/KR/SC subsets) per locale; layouts carry +35% width headroom.

---

## 4. MENU MOOD: "a fired-clay workshop at the kiln's last light"

### 4.1 Materials and surfaces

| Choice | Decision | Reason (craft and feasibility) |
|---|---|---|
| Glass? | **No.** No `backdrop-filter` blur over the live canvas | A blur over a moving WebGL canvas is re-sampled every frame. It costs GPU time on the laptops we target and shimmers. Glass is also the default look of every 2020s UI |
| Stone / ceramic? | **Yes: matte bisque.** Panels are opaque at 94-96% `surface-1` with a 64×64 tiling grain (a 2 KB PNG at 3% opacity) | Reads as fired clay, costs nothing, and the 3D scene shows *around* panels rather than *through* them |
| Glaze? | **Only as state.** A glossy treatment (a diagonal specular sweep gradient) appears on the selected item and the one primary action | Glaze means "this one". It is not a texture for everything |
| Paper / cloth? | No | Not of this world |
| Lines | **Incised:** 1 px `line-1` plus a 1 px `incise-hi` lip below it, so a line looks cut into the clay | Depth without shadows or gradients |
| Corners | **4 px** radius on slabs (fired corners are never knife-sharp). Discs are circles. The kiln arch has a segmental top | |
| Shadows | One elevation shadow only, for popovers: `0 12px 32px rgba(0,0,0,.45)` | Panels sit on the scene, not in a stack of cards |

### 4.2 Shape language: three shapes, one job each

| Shape | Job | Used for |
|---|---|---|
| **Slab** (rectangle, 4 px radius) | Structure: holds content | Panels, cards, list rows, tooltips |
| **Disc** (circle) | Identity: who or what | Fighter portraits, player avatars, seat stamps, rank vessels, mode emblems |
| **Kiln arch** (rectangle with a segmental arch top, the shape of a kiln door) | **The one primary action on the screen** | PLAY, ACCEPT, LOCK IN, BUY, PLAY AGAIN. Exactly one per screen, filled Kilnlight with dark text and a `kilnglow` halo |

Secondary actions are slabs with a `line-2` border and Bisque text. Tertiary actions are text-only labels with an underline on hover.

### 4.3 Layout grid and safe areas (1920×1080 reference)

- **12 columns × 120 px, 32 px gutters, 64 px outer margins** (12·120 + 11·32 + 2·64 = 1920 exactly). Base spacing unit 8 px; allowed steps 4, 8, 12, 16, 24, 32, 48, 64, 96.
- **Safe area:** 64 px left and right, 40 px top and bottom. No interactive element or text sits outside it. Reserve 72 px at the top for the nav bar and 88 px at the bottom for the party bar.
- **Anchoring:** the 3D subject (fighter or kiln door) owns columns 1-6 or 7-12. Panels never cover the subject's face or mask.
- **Supported range:** 1280×720 to 3840×2160; UI scale 0.8-1.5; content reflows at < 1440 wide into 8 columns.

### 4.4 The menu background: "the Cooling Terrace" (one continuous live set)

The whole client is one Three.js scene: a stone terrace on the caldera rim at the kiln's last light. Every screen is a **camera station** on that terrace, so moving between screens is a camera move, not a page swap.

| Element | Build (our pipeline) |
|---|---|
| Sky | Blender Multiple Scattering sky, **sun elevation 7°, azimuth 250°**, aerosol (dust) 3.5, air 1.0, ozone 1.0, procedural altocumulus at 45% cover. The golden hour is allowed here because no gameplay is read in menus |
| The Wheel plinth | A turning stone wheel-head where the selected fighter stands. Drag to rotate (inertia factor 0.92 per frame); idle spin 6°/s |
| Cooling shelves | ~400 instanced lathe vessels (6 profiles × 8 glazes) on stepped shelves. AO and glaze reflections do all the work |
| Kiln doors | **Four arched kiln mouths in a row: RIFT, BRIDGE, FRAY and a bricked-up fourth door** (the reserved, data-driven mode slot). A mode added to `modeSlots[]` unseals its door, with no UI rework |
| The Vale below | Low-detail silhouettes of the three maps' landmarks in the valley haze: the Bottle Kiln and Stepped Kiln (Kilnhollow, left), Handlespan's arch (centre), the Wheelhead disc (right). The menu literally shows where each mode happens |
| Atmosphere | Height fog in the valley (`#E7C9A0`, density 0.02 m⁻¹ below y = −20 m), heat shimmer above kiln mouths (a cheap UV-offset quad), white-gold drifting cinders (≤ 60 GPU particles) |

**Stations:** Home = wide on the terrace with the fighter on the wheel. Play = dolly to the kiln doors; each door shows a live diorama of its map. Collection = close on the wheel. Shop = the display shelf. Profile = the trophy niche holding your rank vessel. Post-game = a kiln door opens and your fighter steps out: glowing on a victory, or with **gold-mended seams** after a defeat. Champ select = the cooling shelf, with picks stepping onto ten plinths.

**Budget:** menus cap at 60 fps while interacting and fall to **30 fps after 4 s idle**. Rendering pauses when the tab is hidden. Half-resolution N8AO, one 1024² shadow map, no SMAA below 1.0 render scale. Reduced-motion mode makes the scene static and turns camera dollies into 200 ms crossfades.

### 4.5 Motion language: "set, lift, fire"

Things **set** into place like clay put down, **lift** away like a pot off the wheel, and **fire** (glow, then reveal) when they are rewards.

| Token | Duration | Easing | Use |
|---|---|---|---|
| `--dur-micro` | 80 ms | `cubic-bezier(.2,0,0,1)` | Toggles, pips, checkboxes |
| `--dur-press` | 70 ms down, 160 ms release | down `cubic-bezier(.4,0,1,1)`; release `cubic-bezier(.34,1.4,.64,1)` (4% overshoot) | Press and release |
| `--dur-hover` | 120 ms | `cubic-bezier(.2,0,0,1)` | Hover and focus |
| `--dur-set` (enter) | 240 ms | `cubic-bezier(.22,1,.36,1)` | Panels and cards enter: translateY 12 → 0 px, opacity 0 → 1, scale .985 → 1 |
| `--dur-lift` (exit) | 180 ms (0.75 × enter) | `cubic-bezier(.55,0,1,.45)` | Exit: opacity 1 → 0, translateY 0 → −6 px |
| `--dur-panel` | 320 ms | `cubic-bezier(.22,1,.36,1)` | Drawers and modals (modals also scale .96 → 1) |
| `--dur-station` | 900 ms | `cubic-bezier(.65,0,.35,1)` | 3D camera moves between stations. UI lifts at t = 0 and sets from t = 520 ms |
| `--stagger` | 32 ms per item, **cap 8** (256 ms); later items arrive together | | Grids and lists |
| `--dur-sheen` | 520 ms, once per hover | linear | The glaze highlight sweep across the kiln-arch CTA and Gilt items |
| `--dur-fire` | 1200 ms build, 180 ms crack, 400 ms settle | build ease-in; crack linear; settle `--ease-set` | Reward reveals and rank-ups: the vessel glows (emissive 0 → 3), a hairline crack opens, the piece settles |
| `--dur-count` | 800 ms (max 1600 ms for large deltas) | ease-out | Number tick-ups; skippable on click |

Only `transform`, `opacity` and the Anybody `wdth` axis (on isolated display layers) ever animate. No layout properties animate.

### 4.6 State treatments (every component ships all of them)

| State | Treatment |
|---|---|
| Default | Slab `surface-1`, `line-1` incision, Bisque label |
| Hover | Fill → `surface-2`, border → `line-2`, label → Eggshell, lift 2 px; the hover tick sound (§10.6) |
| Focus (keyboard or pad) | **The same visual strength as hover**, plus a 2 px Kilnlight ring at 3 px offset. Never removed |
| Pressed | Down 1 px, fill darkens 6%, 70 ms; the sound fires on press, not release |
| Selected / active | **Glazed:** 2 px Kilnlight inner ring, a static sheen gradient, label Eggshell 700. Persists after the pointer leaves and stays distinct from hover |
| Disabled | Opacity 40%, no hover response, cursor default, and a tooltip that always says *why* ("Requires level 5") |
| Locked (not owned) | **"Unfired":** the art is desaturated to biscuit, a grain overlay appears, and an unlock chip shows the path (price in Clay or Lustre, or the mission). Different from disabled: it is still hoverable and previewable |
| Loading | A skeleton at final size (no layout jump): `surface-2` slabs with a 1.4 s shimmer at 6% opacity. A spinner only after 2 s, and that spinner is a small turning wheel-head |
| Empty | One line drawing of an empty vessel, one sentence and one action ("No replays yet · Watch a featured match") |
| Error | An Ember crack icon, a plain-language message, a **Retry** action and a way back. Never a dead end |
| Timed | A draining rim ring on the element itself. Under 5 s the ring turns Ember and the udu urgency pulse starts (§10.6) |
| New | A 6 px Kilnlight dot that clears once seen |

### 4.7 How the UI sounds (detail in §10.6)

UI sound is **ceramic touch**: soft clay ticks on hover, glazed-tile taps on press, two struck bowls for confirm, a muted biscuit thud for back, a dry crack for errors, and a singing bowl for rewards. Every tonal UI sound is tuned to D Mixolydian so the client plays in the key of its own music.

---

## 5. IN-GAME CAMERA

### 5.1 Numbers (locked, identical for every player and every quality tier)

| Parameter | Value |
|---|---|
| Projection | Perspective |
| **Pitch** | **56°** below horizontal |
| **Vertical FOV** | **30°** (horizontal 50.9° at 16:9) |
| **Default distance** | **20.1 m** (camera height 16.7 m); reference fighter is 112 px tall at 1080p |
| **Zoom range (play)** | **17.6 m to 22.5 m**, i.e. the reference fighter at 128 px (in) to 100 px (out) |
| Zoom range (spectator and replay) | 14.1 m to 31.3 m (160 px to 72 px) |
| **Fixed yaw** | 0°: the camera always looks due north. No rotation, ever |
| Framing | The fighter's feet project to 53% of screen height, so the body's centre sits near 48%. A **lead offset** of 1.0 m toward the enemy Hearth along the east-west axis, mirrored for the two teams. No offset in FRAY |
| Ground footprint at default | 19.2 m wide at screen centre (24.2 m at the top edge, 16.8 m at the bottom) × 13.4 m deep |

### 5.2 The math

For pitch φ, vertical FOV θ, distance D, fighter height h and screen height H:

```
focal_px  f = H / (2·tan(θ/2))            = 1080 / (2·tan 15°)      = 2015 px
fighter_px  = f · h · cos(φ) / D          = 2015 · 2.0 · 0.559 / D
            → D = 2254 / fighter_px       → 112 px ⇒ D = 20.1 m
ground_px_per_m (horizontal, at focus) = f / D = 100 px/m
```

| Zoom | D | Reference fighter (2.0 m) at 1080p | at 720p | at 1440p | px/m |
|---|---|---|---|---|---|
| In | 17.6 m | 128 px | 85 px | 171 px | 114 |
| **Default** | **20.1 m** | **112 px** | **75 px** | **149 px** | **100** |
| Out | 22.5 m | 100 px | 67 px | 133 px | 89 |

**Roster heights at default:** small 1.5 m → 84 px (56 px at 720p, the floor for silhouette sign-off); medium 2.0 m → 112 px; large 2.6 m → 146 px. **720p at the zoom-out limit is the sign-off view** (r06 §5.1: readability is approved at the smallest supported viewport).

**Why 30° and not 40°:** a narrower FOV shrinks the top-to-bottom perspective scale change. At 56°/30° a unit at the top edge draws at **0.69×** its size at the bottom edge; at 56°/40° that falls to 0.61×. A smaller difference is fairer and keeps telegraph shapes truer. It also shrinks the shadow footprint, so one fitted 2048² sun map covers about 26 × 16 m, roughly **1.3 cm per texel**: crisp contact shadows at no extra cost (r10 §2.2).

### 5.3 How lanes align to the camera: horizontal lanes

The decisive choice: **in RIFT and BRIDGE the bases sit west and east, so the mid lane and the Handlespan run exactly along screen-horizontal.**

- Along the screen's horizontal axis a perspective camera has **no depth asymmetry**, so both teams see exactly as far toward each other. The genre's diagonal layout needs per-side camera offsets to approach this (r04 §6.3); our layout is fair by construction.
- RIFT's side lanes run along the north and south edges and turn at the corners. Both teams have a north lane and a south lane, so the remaining top-versus-bottom perspective difference is **identical for both teams**.
- The **Glazeway** (river) runs north-south (screen-vertical) through the centre. Each team's half is literally its side of the screen.
- The RIFT minimap is 16:9, the same aspect as the screen, so the camera rectangle on it is the same shape as the view.
- **Occlusion rule:** no geometry above 1.2 m over walkable ground. Props taller than 6 m stay at least 4 m outside walkable space, and nothing on the south side of a lane may be taller than 3 m, because the camera looks over it. Overhangs fade to 20% opacity when any unit is beneath.

---

## 6. HUD DENSITY

### 6.1 Budget (1080p, HUD scale 100%)

| Element | Size (px) | Share of screen | Always on? |
|---|---|---|---|
| **Kiln Bar** (self cluster, bottom centre) | 640 × 116 | 3.6% | Yes |
| Minimap (RIFT, bottom-left) | 352 × 198 | 3.4% | Yes |
| Ally frames (left edge, 4 × 168 × 48) | | 1.6% | Yes |
| Score strip (top centre) | 520 × 44 | 1.1% | Yes |
| Self buffs (above Kiln Bar) | 400 × 28 | 0.5% | Yes |
| Objective timers (top-right) | 240 × 40 | 0.5% | Yes |
| **Always-on total** | | **10.6%** | |
| Kill feed (right edge, 3 entries × 300 × 28) | | 1.2% | Transient, 5 s |
| Announcer banner (upper centre) | 720 × 64 | 2.2% | Transient, 2.5-4 s |
| **Peak total** | | **14.0%** | |
| Overhead plates (10 fighters × 92 × 20) | | ≤ 0.9% | World-anchored |

**Targets:** always-on ≤ 11%, peak ≤ 14% (r04 §1.6 puts the genre at 12-20%). HUD scale runs 70-130% and the minimap scale 70-130% separately, with the text floors in §3 enforced at minimum scale.

### 6.2 Allocation

- **Centre clear zone:** an ellipse 60% of the width by 55% of the height, centred on the fighter. No persistent HUD inside it, only overhead plates, telegraphs and damage numbers.
- **Bottom centre, the Kiln Bar:** level disc · wide HP and resource bar (420 × 18) · four ability slots (64 px) · two utility slots (48 px) · six item slots (40 px, Raw-to-Gilt rim bands) · Glost counter (`num-l`). The death recap replaces it while you are dead.
- **Bottom-left, the minimap** (swappable to bottom-right in settings): RIFT 352 × 198 (16:9), BRIDGE 352 × 110 (a strip), FRAY a 224 px disc. The bottom-left default balances the item row on the right of the Kiln Bar, and it keeps the RIFT map's west-east axis directly under the player's eye.
- **Left edge:** ally frames, stacked vertically (portrait disc, HP, ultimate pip, respawn timer).
- **Top centre:** score strip (kills by team, clock, Kilns standing).
- **Top-right:** objective timers (Bellkiln and Old Sagger) and kill feed beneath them.
- **FRAY:** no ally frames. A **standings rail** at the top-right (10 rows × 22 px: placement, stamp, name, score) replaces them.

### 6.3 Overhead plate anatomy (fighters, 1080p, 100%)

```
          [st][st][st][st]+2          ← status icons, 14 px, max 4 plus overflow count
          Simel                        ← name, Figtree 600 12 px (allies and enemies only)
 (12)◉ ◄▐████████████▒▒▒░░░░░▌◆       ← level disc 18 px · HP 72 × 9 · shield hatch · end caps
       ▐▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▌          ← resource 72 × 3
```

- **Plate:** 92 × 20 px, `bg-0` at 80%, 1 px `line-1`. Fixed screen size (it does not scale with zoom) and DPI-aware.
- **HP fill:** relationship colour. **Ticks:** a 1 px tick every 100 HP at 35% black, a 2 px tick every 1,000 HP at 60% black (fixed units, r04 §1.3).
- **Shield:** appended to the right of the HP fill in Bone glaze with the 45° hatch.
- **Recent damage:** the lost segment holds at 70% white for 120 ms, then shrinks over 400 ms (ease-in).
- **End caps (the shape code):** self = **diamond pip**, ally = **smooth**, enemy = **V-notched**, neutral = **square**.
- **FRAY:** the seat stamp (12 px) sits left of the level disc, and the plate's top edge carries a 2 px seat-colour line.
- **Minions (Sprigs):** 40 × 4 px, no ticks, **shown only when damaged or targeted**. This one rule removes most of the bar clutter in a wave.
- **Structures:** 140 × 10 px with a heavy tick every 1,000 HP, plus the spy-hole glow on the model.

### 6.4 Telegraphs: colour and opacity rules

Telegraphs are system-owned instanced SDF ground quads (r10 §6.2). They are drawn **after the colour grade** (§7.4), so their colours are exact, and they look identical at every quality tier.

| Caster | Edge | Fill | Notes |
|---|---|---|---|
| **Enemy** | 2 px, Ember, 100% | 16% → 36% over the last 250 ms ("the pour"), then a 50 ms edge brighten at impact | The edge is the brightest pixel: the dangerous boundary gets the contrast (r06 §0.2) |
| **Ally** | 1.5 px, Azure, 45% | **None** | Allies' spells never fill your ground |
| **Self (aiming)** | 1.5 px, Kilnglass, 70% | 8% | Range rings are dashed at 35% |
| **Neutral** (monsters, objectives) | 2 px, Straw, 80% | 12% | |

- **Fill animation = timing:** fill "pours" from the origin (lines and cones) or from the centre (circles) toward the edge, so progress reads as how full the shape is.
- **Overlap cap:** fills accumulate into an R8 target with `MAX` blending (available in WebGL2), so stacked enemy telegraphs never exceed 36% and never hide the ground.
- **Keyline:** every edge has a 1 px dark outer keyline (`#000` at 35%) so it reads on pale lanes.
- **Never additive.** Premultiplied alpha only, so telegraphs stay readable on the brightest ground.
- **Shapes:** circle, ring, cone, line and rectangle, all with rounded line caps; one corner rule for all.

### 6.5 Ground rings

Ally rings are continuous (1.5 px, 60%). Enemy rings are four arcs with 12° gaps (2 px, 85%). The self ring is continuous with a facing notch. FRAY rings use the seat colour and are four-gapped like an enemy ring. A ring is always on under fighters (it carries allegiance in a clump) and drawn under the contact shadow's edge so it never haloes the model.

### 6.6 Damage numbers policy

- **Shown:** damage **you** deal (on its target), heals you give or receive ("+" prefix, Green slip, on the recipient), and incoming hits on you only if they are ≥ 8% of your max HP. All other incoming damage is shown by the bar's recent-damage segment instead of numbers.
- **Never shown:** numbers between other players (spectators get a toggle).
- **Look:** `dmg` style (Anybody 850, wdth 80, `tnum`) with a 2 px `bg-0` outline at 85%, coloured by damage type. Size 18 px, scaling to 30 px by the hit's share of the target's max HP. Crits add a small crack glyph and 20% size.
- **Motion:** pop to 115% over 60 ms, settle to 100%, rise 24 px over 650 ms (ease-out), fade over the last 200 ms. DoT ticks merge per target every 0.5 s. **At most 8 on screen**; the oldest goes first.
- **Options:** off / minimal (crits and kills only) / full. The default is full.

---

## 7. WORLD LOOK

### 7.1 Rules shared by all three maps

1. **Gameplay light is high morning to midday:** sun elevation 52-66°, so a 2 m fighter casts a 0.9-1.6 m shadow. Low suns are for menus only.
2. **The sun sits behind the camera and to the left** (azimuth 190-232°), so the camera sees lit fronts and shadows fall up the screen, behind units, not across them.
3. **Fog is world-space only** (r10 §3.3): height mist in low ground, edge haze outside the playable bounds, and fog-of-war darkening. **No camera-distance fog**, so a unit looks the same anywhere on screen.
4. **The value ladder** (L*, after grade): fighter top band 70-88 · lanes and roads 62-72 · glazed wall lips 72-78 · camp clearings 46-54 · jungle floor 28-40 · wall faces 18-28 · out-of-bounds 15-55. Terrain chroma ≤ 25, except landmarks (≤ 40) and seat-coloured FRAY kiln doors.
5. **Glaze on top:** every impassable wall or cliff carries a glazed lip along its exact walkable edge. The lip is the boundary line. Thin walls you can dash over get **one** lip line; thick walls get **two** parallel lips (r06 §2.4 made dashable walls visibly different).
6. **Brush = Kilnreed stands:** thousands of thin fired-clay rods (instanced 6-sided cylinders with bevelled tips, about 24 triangles each) in an ash-ochre clump with a crisp outer edge and a vertex-shader sway. No alpha cards. A unit inside fades to 45% for its own team, and the rods within 1.5 m of a friendly unit shorten by 40%. They cast no shadow; AO grounds them.
7. **Sky is seen in reflections:** the camera never sees the horizon in play, so glaze roughness (0.18-0.30) is tuned to make every glazed top carry a soft sky reflection. That is where the "real sky" lives in gameplay.

### 7.2 Per-map settings

Sky values are Blender 5.2 Multiple Scattering parameters (r10 §3.1), with an approximate Hosek-Wilkie turbidity given for reference. Each sky is baked at 1024×512 with **the sun disc off** (the sun is the dynamic light) and shipped as UltraHDR.

| | **RIFT: Kilnhollow** | **BRIDGE: Handlespan** | **FRAY: Wheelhead** |
|---|---|---|---|
| Size (art target) | 192 × 108 m (16:9), mid lane about 150 m base to base | 136 m deck × 22 m wide (12 m lane plus alcoves) | 52 m disc |
| Time of day | Mid-morning, firing day | Noon over the gorge | Late afternoon, fair day |
| Sun elevation / azimuth | **58° / 198°** | **66° / 190°** | **48° / 232°** |
| Sun colour, three.js intensity | `#FFF0DC` (about 5400 K), 3.0 | `#FFF6EA` (about 5800 K), 3.2 | `#FFE6C4` (about 4600 K), 2.8 |
| Sky (air / aerosol / ozone / altitude) | 1.0 / 2.0 / 1.0 / 300 m (turbidity ≈ 3.5) | 1.0 / 1.0 / 1.2 / 600 m (≈ 2.5) | 1.0 / 3.0 / 1.0 / 300 m (≈ 4.5) |
| Clouds (procedural) | 25%, fair-weather cumulus on the rim and kiln-smoke plumes | 40%, mostly *below* the deck (the gorge's cloud sea) | 35%, warm haze with smoke shafts |
| `environmentIntensity` | 0.90 | 1.00 | 0.85 |
| Height fog | Glazeway channel mist: `#C9D3CC`, 0.045 m⁻¹ at y ≤ 0.2 m, falling to 0 by y = 1.8 m | Gorge fog sea: `#A9BCC4`, 0.08 m⁻¹ below y = −4 m, so the deck floats over a soft cool void | None on the disc |
| Edge fog | `#D8C7AE`, from 6 m outside the bounds, full by 22 m | `#B9C6CB`, along the deck ends | `#D9B98F`, the disc rim dissolves into warm haze |
| Value structure | Lanes are pale fired paving (L*64-70, smooth, low detail); the Kilnyard (jungle) is dark wet clay and shard thickets (L*28-40) with lighter camp clearings (L*48-52); wall faces L*18-26 with glazed lips L*72-78; the Glazeway is glossy pale celadon-grey (L*58-62, specular clamped ≤ 1.5) | The deck is pale stoneware (L*66-74); parapets carry glazed lips; alcoves are slightly darker (L*55); everything below the deck is fog at L*30-45 | Concentric throwing rings in alternating L*60 and L*68 (a readable radial grid); the central hub is darker (L*45) so pickups pop; ten rim kiln doors in seat colours at chroma ≤ 40 |
| Signature landmarks | **West base:** the Bottle Kiln. **East base:** the Stepped Kiln. **North river:** the **Bellkiln**, a bell-shaped kiln whose spy-holes ring with light when it is taken. **South river:** the **Old Sagger** pit, an ancient stacked-box kiln-golem asleep in its slip. **North Kilnyard:** the Saggar Stacks (towers of kiln boxes). **South Kilnyard:** the Shard Garden. **Mid:** the Cooling Arch ruins, kept outside the lane | **West and east ends:** the Wheel Gatehouse and the Slab Gatehouse. **Midpoint:** the Luted Join, a fused seam with a glowing crack that marks the centre line. **Alcoves:** Slip-jar shrines (health pickups) | **Centre:** the Spindle, the wheel's hub and the shared shop of the Kilnwright. **Rim:** ten refire kilns, one per seat. **Backdrop:** the outer stone ring turns slowly (0.5°/s), purely as scenery |

### 7.3 Post chain (r10 §1.8, with VALE's values)

```
RenderPass (HalfFloat buffers, renderer.toneMapping = NoToneMapping)
→ N8AOPostPass   aoRadius 1.4 m · distanceFalloff 1.0 · intensity 2.5 · color #1A120E (warm "glaze pooling")
                 halfRes on Medium · quality preset per tier, set at load (changing it recompiles)
→ EffectPass     Bloom(mipmapBlur, threshold 1.0, smoothing 0.05, intensity 0.6, radius 0.7, levels 5/6/8/8 by tier)
                 ToneMapping(NEUTRAL, exposure 1.0) · LUT3D(VALE_FIRED_v1, 33³, tetrahedral on High/Ultra)
                 Vignette(offset 0.35, darkness 0.25)
→ EffectPass     SMAA (FXAA on Low)
→ Overlay pass   telegraphs, ground rings, structure spy-hole glows: depth-tested against the scene depth, NOT graded
→ DOM HUD        Preact at native resolution (never scaled by dynamic resolution)
```

### 7.4 The LOCKED colour grade, as LUT operations

**Tone mapping: Khronos PBR Neutral, exposure fixed at 1.0, everywhere (match, menus, showcase).** This deliberately departs from r10's AgX recommendation, for three craft reasons:

1. **Our albedo is the art.** Neutral keeps base-colour hue and saturation below its compression knee (about 0.76), so hand-painted glaze bakes appear as authored. AgX flattens and desaturates them, and the LUT would then have to undo that.
2. **It makes the white rule controllable.** Neutral whitens highlights gradually: a saturated emissive at 4.0 linear moves about 31% toward white, at 16.0 about 69%. Capping emissive intensity per VFX tier (§9.1) therefore guarantees that **only T4 effects reach white**. Under AgX every bright effect drifts toward white.
3. **One transform means one product.** Blender 5.2 ships a "Khronos PBR Neutral" view transform (r10 [L2]), so artists preview exactly what the game shows, and the menus and the match share one image pipeline.

Per-map brightness is set only by `environmentIntensity` and sun intensity (§7.2), never by exposure or a second LUT.

**`VALE_FIRED_v1` (33³ `.cube`, generated by script from the numbers below, version-locked and hash-checked in CI).** Input: Neutral-tonemapped display sRGB. Operations in order:

| # | Operation | Values | Intent |
|---|---|---|---|
| 1 | **Lift** (shadows, per channel) | R +0.010 · G +0.012 · B +0.024 | A faint cool lift: blacks never fall below about sRGB 0.008 (R) and 0.015 (B), so the dark Kilnyard stays readable and shadows read slightly cool against warm clay |
| 2 | **Gamma** (midtones) | R 1.04 · G 1.04 · B 1.045 (as 1/γ exponents) | Mids up about 4%, very slightly cooler |
| 3 | **Gain** (highlights) | R 1.000 · G 0.990 · B 0.962 | Warm highlights: kilnlight |
| 4 | **Contrast** | S-curve pivot 0.45, slope 1.12, soft toe and shoulder | Gentle punch without crushing |
| 5 | **Saturation by luminance** | Y < 0.12: ×0.80 · ramp to ×1.00 by 0.30 · 0.40-0.75: ×1.10 · above 0.85: ×0.92 | Clean shadows, rich glaze midtones, highlights that whiten gracefully |
| 6 | **Reserved-hue suppression** | HSV hue 200-232° (Azure band) and 4-28° (Ember band): saturation ×0.82, feathered 8°. Hue 178-198° when V > 0.85 (Kilnglass band): ×0.82 | **The grade itself enforces the reserved-hue rule.** World pixels near team hues always lose a little chroma, so post-grade team overlays always win |
| 7 | **Greens** | Hue 90-150°: saturation ×0.90 | World greens never compete with Heal |
| 8 | Hue rotation | **None anywhere** | No grade-induced hue drift, so the CVD maths in §2 holds |

**Measured on the prototype LUT:** greys stay neutral to within 0.013 per channel through the midtones (0.50 → 0.527 / 0.522 / 0.514). Typical world colours move only ΔE00 1.3-3.3 (pale lane paving `#B9A88E` → `#C5B08F`; jungle clay `#4E4036` → `#4D4139`). A world glaze in the Azure band loses 14% chroma (C* 49 → 42) and a cobalt glaze loses 13% (60 → 52), while celadon and rose glazes gain 4-8%. The overlay pass sits after the grade, so **the hex values in §2 are the exact pixels the player sees**.

---

## 8. FIGHTER LOOK

### 8.1 Shape language by role (role is carried by mass distribution, which survives at 75 px; r06 §8)

| Role | Ware metaphor | Silhouette | Mass | Top-view signature (what a 56° camera sees first) |
|---|---|---|---|---|
| **Guard** (tank) | Stacked saggars, slab-built | Wide rectangle or trapezoid; width ≥ 0.75 × height | Low and bottom-heavy | A flat lid or crown and broad slab shoulders |
| **Brawler** (bruiser) | Coil-built jug | Rounded square, barrel torso, heavy forearms | Mid-body | One oversized weapon (a mallet or paddle) ≥ 35% of height |
| **Striker** (assassin) | Shattered porcelain, sharp shards | Narrow triangles, forward lean | Top-forward, narrow base | Spikes, crests or a blade that breaks the head outline |
| **Slinger** (marksman) | Tall spouted ewer | Tall, slim vertical rectangle | Upright | A long weapon (sling-staff, glaze-thrower) extending ≥ 40% of height beyond the body |
| **Caster** (mage) | Bulbous vase or lidded jar | Rounded top on a tapering base (an inverted triangle) | Top-heavy | A large hood, lid or bulb, with one or two orbiting sprigs |
| **Tender** (support) | Bowl or teapot | Circles; wide open forms | Even and soft | A halo-ring, a handle or a spout: an open, welcoming top |

### 8.2 The glaze-line value rule (Valve's top-light gradient, made literal)

| Band | Share of height | L* | Chroma | Material |
|---|---|---|---|---|
| **Glazed top** | upper 30% (head, mask, shoulders, headgear) | 70-88 | 30-55 (the fighter's signature glaze) | Gloss glaze, roughness 0.18-0.30 |
| **Slip middle** | middle 40% | 45-65 | ≤ 30 | Slip and satin glaze, roughness 0.38-0.65, brushwork motifs |
| **Raw foot** | lower 30% (legs, feet, base) | 20-38 | ≤ 15 | Unglazed body, roughness 0.82-0.92 |

The weapon may break the rule in one direction only: it is the brightest element if it *is* the threat, or it is the darkest high-contrast silhouette if the body is the threat. **Test:** a greyscale render at 75 px must show the head as the lightest blob and the feet as the darkest.

### 8.3 Detail density

- **Areas of rest:** about 60% of the visible surface is plain glaze field. About 30% carries mid detail (slip trailing, sprigs, brush bands). Only 10% gets focal detail, in two places at most: the **mask** and the **weapon's working edge** (r06 §3.1).
- **No silhouette-defining part thinner than 5 cm** (3 px at 720p default). Thinner bits (cords, tassels) never carry the read.
- **Budgets:** LOD0 18-28k triangles, LOD1 at 50%, ≤ 60 bones, one material plus an emissive mask. 1024² base colour (sRGB), ORM and normal (UASTC for normal maps). **Texel density 256 px/m** for fighters and 128 px/m for environment, enforced with the Texel Density Checker add-on (r06 §10).
- **Normal maps carry crackle and bevel softening only.** Form comes from geometry: **bevel width 2-4 cm with 3 segments**, so every edge catches a 2-3 px highlight at default zoom. The bevel is the brushstroke.
- **Baked into base colour (Cycles bake):** AO at 60% (glaze pooling), curvature at 40% (glaze breaking lighter over edges), and a top-down gradient at 15%. Paint motifs over that.

### 8.4 Silhouette rules at camera distance

1. A black-fill render of the whole roster at 75 px, side by side (r06 §10): no two fighters may be confusable.
2. **Facing must be readable** from above: a mask beak, an asymmetric pauldron, or the weapon carried on one side.
3. **The top outline is unique per fighter.** At 56° the camera sees heads and shoulders more than legs, so crowns, lids, spouts, handles and crests are the identity carriers.
4. Silhouette envelope at idle: width between 0.45 and 1.1 × height. Nothing projects more than 0.6 m above the head (it would read as a different fighter's height class).
5. The weapon reads separately: at least 3 px of clear background between the weapon and the body in the idle pose at 75 px.

### 8.5 Material vocabulary (closed list; anything else needs art-director sign-off)

| Material | three.js values | Notes |
|---|---|---|
| Gloss glaze | metalness 0, roughness 0.18-0.30 | Signature colour; crackle normal at strength 0.15 |
| Satin glaze | metalness 0, roughness 0.38-0.50 | |
| Slip / engobe | metalness 0, roughness 0.60-0.70 | |
| Biscuit (unglazed body) | metalness 0, roughness 0.82-0.92, L* 25-55 | Feet, joints, undersides |
| Bronze or iron fittings | metalness 1, roughness 0.35-0.55 | ≤ 15% of the surface |
| Lustre (gold over glaze) | metalness 0.9, roughness 0.15 | **Skins and the Gilt tier only** |
| Kilnglass (the spark) | emissive 1.2-2.0 linear, never above 2.5 | Always below T2 VFX, so a fighter never outshines their own abilities |
| Rigid drapery | Glaze or slip | Sculpted, ≤ 2 sway bones, never simulated |
| Cord and felt | roughness 0.90 | Sparingly |

**Forbidden:** realistic skin, hair cards, cloth simulation, transparent glass bodies, mirror chrome.

### 8.6 The accent emissive rule

One kilnglass spark per fighter: **≤ 3% of the fighter's screen pixels**, placed in the top band (eyes, mask slit or chest core), in an identity hue **outside** the reserved bands (Azure H 200-232°, Ember H 4-28°, Kilnglass H 178-198° at L* > 80) and never pure white. It pulses (1.2 s period) only for "ultimate ready". It never carries team relationship.

### 8.7 How skins differ, and what they may not touch

- **Skins own:** glaze palette, motifs, materials (including lustre and crackle variants), sculpted props within the envelope, ability VFX *bodies*, sounds and the menu turntable pose.
- **Skins must keep:** the silhouette within ±8% of height and width; the top-view signature feature; the weapon's read; the three value bands; the location of the emissive spark; animation timings (exactly).
- **The system owns, and skins never change:** telegraphs, ground rings, bars, the damage-number style, and the VFX importance cap for each ability.
- **Reserved hues that skins may not use:** Azure, Ember and Kilnglass in any emissive or VFX at all, and in glaze albedo only at chroma ≤ 20. Pure-white emissive is T4 only. Gilt-gold `#F5C84C` lustre is limited to the premium tier.
- **Skin ladder** (priced by scope, r08 §7a6): *Glaze* (a recolour within the rules) → *Ware* (new materials and motifs) → *Kiln* (new sculpt within the envelope, new VFX bodies) → *Fair* (all of that plus a new kiln-reveal intro and audio).

---

## 9. VFX LANGUAGE

### 9.1 Importance tiers (brightness is a currency; r06 §0.1)

| Tier | Examples | Emissive cap (linear, pre-tone-map) | Lifetime | Telegraph | Audio wind-up |
|---|---|---|---|---|---|
| T0 Ambient | Kiln shimmer, drifting cinders | ≤ 0.8 | Loops ≤ 0.5 Hz | n/a | n/a |
| T1 Basic attacks | Hits, projectiles | ≤ 1.5 | ≤ 0.35 s | n/a | Transient only |
| T2 Abilities | Skillshots, dashes, zones | ≤ 3.0 | Trails ≤ 0.4 s | Optional | Yes |
| T3 Crowd control, big hits | Stuns, knock-ups, executes below the ultimate tier | ≤ 6.0 | | **Mandatory** | **Mandatory, enemy-audible** |
| T4 Ultimates | | ≥ 10 at the focus, which **reaches white** (Neutral whitening, §7.4) | | **Mandatory** | **Mandatory** |

### 9.2 Colour and value rules

- Each fighter has **one VFX hue family plus white-gold**. No fighter VFX use the Azure, Ember or Kilnglass bands, and **only T4 reaches white**.
- **Damage-type flavour:** physical effects are built from biscuit dust and sherds; magic from violet melted-glaze ribbons; true damage from white heat.
- **The dangerous part is the brightest:** a missile's tip, a blade's edge, an impact ring's rim (r06 §0.2). Trails are at most 50% of the head's brightness and ≤ 60% of its saturation.
- **Prefer opaque meshes to alpha sprites:** sherds, slip ribbons and glaze splashes are instanced meshes (no sorting, no overdraw, they receive AO). Alpha sprites only for glow cores and dust, each ≤ 1.2 m on screen.
- **Environment emissives are white-gold only:** kiln mouths, spy-holes (except relationship glows) and the Glazeway shimmer. No orange fire anywhere in the Vale.

### 9.3 Ally versus enemy treatment

| Caster, from your point of view | VFX opacity | VFX saturation | Telegraph (§6.4) |
|---|---|---|---|
| Self | 100% (your own T1 at 85%) | 100% | Kilnglass aim |
| Ally | **65%** | **75%** | Azure edge, no fill |
| Enemy | 100% | 100% | Ember edge and fill |
| FRAY: anyone else | 100% | 100% | Ember with a seat-colour origin tick |

Enemy T3 and T4 casts also get a short **enemy sweetener**: a dark transient in audio (r07 §4.5) and a 1-frame Ember rim flash on the caster at cast start.

### 9.4 Telegraph style: "the pour"

Crisp SDF shapes with rounded caps, an edge brightest at the boundary, and a fill that pours from origin to edge as the timer runs (§6.4). No textures, no runes, no swirling patterns inside telegraphs: the ground stays readable through them.

### 9.5 Impact grammar: crack, chip, ring

| Beat | Time | What happens | Scales with tier |
|---|---|---|---|
| **Crack** | 0-33 ms | A white-gold contact flash at the hit point (one frame, a 0.3-0.8 m sprite) plus a **fresnel rim flash** on the victim in the damage-type colour (+0.6 for 80 ms) | Flash size |
| **Chip** | 33-400 ms | 3-12 instanced **sherds** (glaze-coloured top face, biscuit underside) with gravity and one bounce | Count: T1 3, T2 6, T3 9, T4 12 |
| **Ring** | to 1.0 s | A radial crack decal or glaze splash on the ground, fading with ease-in | Radius |

- **Hit-stop:** none for other units' hits. Only your own T3/T4 impact gets a 2-frame hold on your own fighter's animation.
- **Kill:** the fighter shatters into its pre-fractured set (40-60 sherds, authored in Blender by scripted Voronoi bisection). The pieces fall and fade over 1.2 s, and the **kilnglass spark rises and streaks to the refire point**: the respawn location is shown by the death itself.
- **Structures:** a Kiln cracks along authored seams in three stages, white kiln-light leaks from the cracks, and it collapses in biscuit dust. No flames.
- **Sprigs (minions):** 2-3 sherds and a puff. Their deaths are deliberately the quietest event on screen.

---

## 10. AUDIO PALETTE

### 10.1 Key, tempo, mode

- **D Mixolydian** (D E F♯ G A B C). The home chord is **D**; the colour chord is **C major** (the ♭VII). The ♭VII-I cadence is warm, earthy and driving, a folk-craft sound rather than an orchestral one.
- **Tempo grid: 96 BPM.** One beat is 0.625 s and one 4/4 bar is **exactly 2.5 s (120,000 samples at 48 kHz)**, so every loop, stinger and bar-quantised transition lands on whole samples. Combat layers run in double time (192 feel). Menu stems are 32 bars (80 s).
- **Polymetric menu loops:** the pad cycles every 32 bars, the harp every 24 and the bowls every 40, so the full combination repeats only every 480 bars (20 minutes) from three short files. That is cheap variety for long menu sessions (r07 §1.1).

### 10.2 The motif: "the Draw"

**D4 – A4 – C5 – B4 – G4 – A4** (1-5-♭7-6-4-5). Rhythm at 96 BPM: eighth, eighth, dotted quarter, eighth, quarter, half (6 beats).

It rises a fifth, leaps to the Mixolydian ♭7 (the kiln flaring), steps down, and comes to rest on the open fifth: unresolved, so it can loop.

| Form | Notes | Use |
|---|---|---|
| Full | D4 A4 C5 B4 G4 A4 | Login, mode reveal, the menu intro (never inside the loop) |
| Victory | Full, then **D5** (resolved to the tonic) over C → D | Victory sting |
| Defeat | Full, ending held on **C5** over a D pedal (unresolved ♭VII), an octave lower on the clay harp | Defeat sting |
| Head | D – A – C | Match found (three bowl strikes, D5 A5 C6) |
| Tail | G – A | Lock-in, level-up |
| Two-note | A → D (5 → 1) | UI confirm. Back is the reverse, D → A (down) |

### 10.3 Instrument palette (all synthesised originally in numpy)

| # | Instrument | Synthesis recipe | Role |
|---|---|---|---|
| 1 | **Struck bowl** | Modal synthesis: damped sinusoids at f × [1, 2.71, 5.15, 8.43], decays [4.0, 2.2, 1.1, 0.6] s, each partial a detuned doublet (±0.4 Hz) for shimmer, plus a 3 ms mallet-click noise burst high-passed at 3 kHz | Motif carrier, confirm, rewards, match found |
| 2 | **Udu (clay pot drum)** | Sine 110 → 70 Hz exponential pitch drop over 120 ms, a Helmholtz "bloop" (band-passed noise at 180 Hz, Q 8) and a slap transient (band-passed noise at 1.8 kHz, 15 ms) | Tension pulse, timer urgency |
| 3 | **Kiln drum** | Sine 62 → 41 Hz pitch drop over 80 ms, amplitude decay 450 ms, a second mode at 1.5× at −12 dB, and a 30 ms noise thump low-passed at 300 Hz | Combat downbeats, structure falls, stings |
| 4 | **Clay harp** | Karplus-Strong pluck (damping 0.996, 2-pole low-passed noise excitation at 4 kHz) through two body band-passes at 220 Hz and 480 Hz | Ostinati, number tick-ups, defeat motif |
| 5 | **Ocarina** | Sine + 3% second harmonic + 1% third, breath noise band-passed at 2f (−24 dB), 40 ms attack with a noise "chiff", vibrato 5.2 Hz ±12 cents delayed 250 ms | Melody: motif statements, victory |
| 6 | **Kiln pad** | Subtractive: 3 saws (±7 cents) into a 2-pole low-pass at 700 Hz with a 0.07 Hz LFO (±200 Hz), plus pink-noise "kiln roar" low-passed at 250 Hz (−18 dB); 1.2 s attack | Beds, ambience glue |
| 7 | **Sherd shaker** | Granular: 6-12 micro-impulses (1-3 ms, band-passed 4-7 kHz, randomised) spread over 40 ms | Combat hats, tab switch, shard VFX |
| 8 | **Glaze tine** | FM, carrier : modulator = 1 : 3.5, index 4 → 0 over 150 ms | Bright transients on UI presses and ability casts |

**Space:** synthetic convolution impulse responses (exponentially decaying filtered noise with early-reflection taps at 7/13/19/29 ms): "Kiln Hall" (RT60 2.4 s) for menus, "Terrace" (0.9 s) for RIFT, and "Gorge" (3.2 s plus a 220 ms slap) for BRIDGE. One or two shared reverb sends; never a `ConvolverNode` per sound (r07 §4.3).

**Humanise everything:** ±8 ms timing and ±2 dB velocity jitter, and round-robin pitch ±1 semitone on percussion. Pure, un-jittered sines are what make synthesised audio sound cheap.

### 10.4 Menu bed, match bed, stings

| Cue | Character |
|---|---|
| **Menu bed** | Kiln pad drone on D2 and A2; a sparse clay-harp ostinato over a **D - C - G/D - D** vamp; bowls on chord changes; the ocarina states the motif only in the 8-bar intro, because a hook in a loop grates (r07 §1.1). No drums. −3 dB dip at 1-4 kHz for voice chat. Ducks −8 dB under match found |
| **Draft** | Menu stems plus an udu pulse that thickens by phase (bans → picks → final); the local player's own last 8 s add accelerating udu taps |
| **Match bed** | **Ambience first:** wind through the kilnreeds (filtered noise, slow gusts), distant kiln roar, rare environmental bowl chimes. Music layers, switched on bar boundaries from a weighted intensity score with hysteresis (r07 §1.3): `calm` (pad and harp at −6 dB) → `tension` (udu eighths) → `combat` (kiln drum on beats 1 and 3, sherd shaker sixteenths, harp double time) → `objective` (bowl swells and motif fragments on the ocarina). `dead` cuts immediately to the pad alone |
| **Victory sting** | 6 s: a kiln-drum hit, the full motif on ocarina and bowls, C → **D** resolution, a ringing bowl tail into the post-game bed |
| **Defeat sting** | 4 s, −3 LU quieter: the motif on clay harp an octave down, ending on the unresolved C over a D pedal. Then the post-game "mending" (gold seams) gets one warm bowl. Dignified, never mocking (r07 §1.4) |
| **FRAY placement** | 1st: the victory sting. 2nd-4th: a short 3 s "kiln-out" (the motif head resolving up). 5th-10th: a neutral bowl and harp cadence |

### 10.5 Impact sound (matches §9.5: crack, chip, ring)

Transient (glaze tine or slap, 0-30 ms) → body (a clay knock tuned to the fighter's home register: Guards low-mid, Casters airy high-mid, Slingers a tight transient) → tail (sherd-shaker scatter and reverb). Weight follows VFX tier. Enemy T3/T4 wind-ups carry the shared dark "enemy" transient layer. Last-hit Glost: a short, bright bowl partial at A5 with ±1 semitone variation, on the same frame as the number (r07 §3.2).

### 10.6 UI sound character: "ceramic touch"

| Event | Sound |
|---|---|
| Hover | A 6 ms clay tick (band-passed noise at 2.5 kHz, ±3% pitch, −32 dBFS peak), **rate-limited to 14 per second** |
| Press | A glazed-tile tap (glaze tine plus one bowl partial), 80 ms |
| Confirm | Two bowls, A4 → D5 |
| Back / cancel | A muted biscuit thud (noise low-passed at 600 Hz plus a low udu) |
| Error | A dry crack: two noise bursts 18 ms apart, high-passed at 1.2 kHz, plus a low knock. Never harsh |
| Tab switch | A sherd-shaker flick |
| Reward | A bowl swell and a tine glissando up D Mixolydian |
| Timer urgent | Accelerating udu taps |
| Tick-up | Clay-harp plucks climbing scale degrees, landing on D |
| **Match found** | Three bowl strikes D5 - A5 - C6 at 250 ms spacing, a tine shimmer, 900 ms in all. **+4 dB over other UI sounds**, on its own slider with a floor, played from the WebSocket handler (r07 §3.3) |

### 10.7 Loudness

- **Match mix: −18 LUFS integrated ±2 LU**, true peak ≤ −1 dBTP, measured over a 30-minute representative capture (r07 §4.1).
- **Menu bed: −23 LUFS integrated**, so UI and voice sit on top. Stings ≤ −16 LUFS short-term.
- Optional "full dynamics" mode for headphones (toward −24 LUFS with less master limiting).
- Sliders: master, music, SFX, announcer, UI, match found, voice.

---

## 11. ONE-PAGE TEST (the bible page itself, 856 words)

> **VALE STYLE BIBLE: "FIRED".** Law for every screen. If a choice is not here, extend the nearest rule and ask.
>
> **World.** The Vale is a volcano floor that never cooled. Its clay wakes when fired. The fighters, the Wakened, are glazed ceramic pieces with a kilnglass spark: no skin, no hair, no cloth simulation, no blood. Death is a crack and respawn is a refire. Defeat is mended in gold. Two houses: **the Wheel** (west, porcelain, rotational architecture, pale, cool) and **the Slab** (east, stoneware, stepped and planar, iron-red, warm). Maps: Kilnhollow (RIFT), Handlespan (BRIDGE), the Wheelhead (FRAY). *Cant for who* (fighters: two syllables, one of 16 initials, no apostrophes). *English for what* (Kiln, Flue, Hearth, Bellkiln, Glost). Every name passes the deny-list check before use.
>
> **The look in one sentence.** Glazed figures read from above in clean high-morning light: glaze on top, raw clay at the feet, colour reserved for meaning.
>
> **Palette.** Client: iron-glaze dark (`#161311`, panels `#1F1B18`), Eggshell text `#F4EFE6` (16:1), Bisque `#BDB2A3` (8.9:1). The brand accent is light, not hue: Kilnlight `#FFF1D6`. **Cool is us, warm is them, and the brightest cool is you:** Self Kilnglass `#8FF3FF` (diamond), Ally Azure `#3D8BFF` (smooth, continuous), Enemy Ember `#FF5A2C` (cracked: notched ends, broken ring). Ally-enemy ΔE ≥ 49 for every vision type; deutan, protan and tritan alternates ship; self and enemy colours are player-settable. FRAY uses ten seat colours, each with a maker's stamp (● ✚ ○ ▲ ═ ■ ✖ ◆ ⧓ ☾); the stamp is the key, the colour is the shortcut, and you are always Kilnglass. Damage: physical Biscuit `#F9D9AE`, magic Glaze violet `#D0A8FF`, true White. Heal Green slip `#3FBF6A` (+). Shield Bone glaze with hatch. Items: Raw, Fired, Glazed, Gilt (1-4 rim bands). Ranks are vessels: Earthen to Whiteheat. **Team hues never appear on models, skins or architecture above chroma 25.** Modes get no colour.
>
> **Type.** Anybody (display and headings, always CAPS; the width axis is our motion signature), Figtree (body, sentence case), Chivo Mono (every live number). All OFL, about 100 KB. Floors: 12 px text, 11 px numerals, at every scale.
>
> **Menus.** One live 3D set, the Cooling Terrace at golden hour; every screen is a camera station. Matte bisque slabs, incised lines, no glass blur. Glaze appears only on the selected item and on **the one kiln-arch primary action per screen**. Three shapes: slab = structure, disc = identity, arch = act. Ornament is information only. Motion: set 240 ms, lift 180 ms, hover 120 ms, press 70 ms, station 900 ms, stagger 32 ms capped at 8. Every component ships all twelve states, focus as strong as hover. Four kiln doors: RIFT, BRIDGE, FRAY, and one bricked up for the next mode.
>
> **Camera.** Pitch 56°, vertical FOV 30°, distance 20.1 m (17.6-22.5 m), fixed yaw north. A 2 m fighter is 112 px tall at 1080p (75 px at 720p; sign off at 720p, zoomed out). Bases sit west and east, so lanes run screen-horizontal and the view is fair by construction. No geometry over walkable ground.
>
> **HUD.** 10.6% always-on, 14% peak. Kiln Bar bottom centre, minimap bottom-left (swappable), ally frames left, score top centre, objectives top-right. The centre ellipse stays clear. Plates are 92 × 20 with 100/1,000 HP ticks and shape-coded end caps. Minion bars only when damaged. Telegraphs: enemy Ember edge with a fill that pours from 16% to 36%; ally edge only; self Kilnglass. Never additive, MAX-capped, drawn after the grade. Damage numbers: only yours, at most 8 on screen.
>
> **World.** Sun at 48-66°, behind-left of camera. Real Blender sky, seen in glaze reflections. World-space height fog only. Value ladder: fighter tops L*70-88 > lanes 62-72 > clearings 46-54 > jungle 28-40 > wall faces 18-28, with every walkable edge marked by a glazed lip (one lip means dashable, two mean solid). Brush is kilnreed rods, not foliage. **Khronos PBR Neutral**, exposure 1.0, everywhere; grade = locked `VALE_FIRED_v1` LUT: cool lift, warm gain, mid saturation ×1.10, shadows ×0.80, **team-hue bands ×0.82 in the world**, no hue rotation. N8AO warm pooling, bloom only above 1.0.
>
> **Fighters.** Role is mass: Guard is a low box, Brawler a jug, Striker shards, Slinger a tall ewer, Caster a bulb on a taper, Tender a bowl. Glaze line: top 30% L*70-88 glossy, middle 45-65 slip, foot 20-38 raw. 60% rest, 30% mid detail, 10% focal (mask and weapon edge). Bevels of 2-4 cm are the brushstrokes. 256 px/m, 1024² maps, one spark of kilnglass ≤ 3% of pixels, never a team hue. Skins keep silhouette (±8%), value bands and timings, and never touch the system layer.
>
> **VFX.** Tiers T0-T4 with emissive caps 0.8 / 1.5 / 3 / 6 / 10+; only T4 reaches white. The dangerous edge is the brightest. Ally effects at 65% opacity. Impacts go crack, chip, ring, with real sherds rather than sprites. No orange fire anywhere: the only hot colour in the Vale is white heat.
>
> **Audio.** D Mixolydian, 96 BPM (2.5 s bars). Motif D-A-C-B-G-A. Instruments: struck bowl, udu, kiln drum, clay harp, ocarina, kiln pad, sherd shaker, glaze tine, all synthesised. Menu bed: no drums, no looping hook. Match: ambience first, bar-quantised layers. Victory resolves to D; defeat rests on C. UI is ceramic touch. Match found is three bowls, +4 dB. −18 LUFS, true peak −1 dBTP.

---

## 12. RISKS: what could look cheap in our pipeline, and how the bible prevents it

| # | Risk | How it would show | Prevention written into the bible |
|---|---|---|---|
| 1 | **"Toy plastic" instead of ceramic** | Uniform gloss, no depth, everything looks injection-moulded | The glaze rule: every glazed surface shows ≥ 2 of pooling (AO in base colour plus N8AO), breaking (curvature), crackle (normal) and drips. A biscuit foot on every piece. Roughness ranges per material, never one global value (§8.5) |
| 2 | **Specular sparkle and aliasing on glaze** | Glittering edges at 75 px | Roughness floor 0.18; form from bevels (3 segments) rather than high-frequency normals; normal-variance (Toksvig-style) roughness bake; SMAA High from Medium up; mipmaps and anisotropy (r10 §1.5, §4.3) |
| 3 | **Brown soup** (a clay world turns into mud) | Low-contrast browns everywhere | Lanes are *pale* fired paving, not brown; the value ladder (§7.1); colour lives on glazed tops; the cool shadow lift in the LUT separates planes; terrain chroma ≤ 25, but the Glazeway, lips and skies carry cool notes |
| 4 | **Lumpy skin-modifier bodies** | Blobby joints, undefined limbs | We designed for it: clay *should* look hand-pressed. Joints are hidden under fired collars and bands (as on real ceramic figures); subdivision level 2 plus corrective smooth; the silhouette test at 75 px catches anything mushy |
| 5 | **Bloom haze** | Everything glows and the image goes soft | Threshold 1.0 on HDR buffers; emissive caps per VFX tier and for kilnglass; environment emissives ≤ 0.8; bloom levels scale by tier rather than switching off |
| 6 | **Fog murk at the top of the screen** | Units far up the screen look greyer | Only world-space height and edge fog (§7.1 rule 3); no `scene.fog` |
| 7 | **Cheap foliage** | Alpha cards, sorting pops, shadow acne | No foliage in the world. Kilnreed rods and shard thickets are opaque instanced meshes (§7.1 rule 6) |
| 8 | **Jam-game menus** | Stock widgets, dead clicks, blank states | Kiln arch, slab and disc components with all twelve states (§4.6); motion tokens; ceramic UI sounds; a live 3D set behind everything; one primary action per screen |
| 9 | **Menu jank on laptops** | Stutter when panels animate over the 3D scene | No `backdrop-filter`; only transform and opacity animate; a 30 fps idle cap; animating Anybody's width is isolated with `contain`; the scene pauses in hidden tabs |
| 10 | **Text illegible over 3D** | Labels lost on bright glaze | All text sits on opaque slabs; HUD numbers have a 2 px outline; text floors of 12 and 11 px |
| 11 | **Colour collisions** | Team hues confused with VFX or world | Reserved bands enforced in three places: in the bible (skins and VFX), in the LUT (world chroma ×0.82), and in the overlay pass after the grade (exact team pixels) |
| 12 | **Inconsistent texel density** (the most visible amateur tell, r06 §8) | Crisp and blurry assets side by side | 256 px/m fighters, 128 px/m environment, enforced by the checker add-on at export |
| 13 | **An invisible sky** ("why bake a sky the camera never sees?") | A flat, dead world | The sky lives in glaze reflections (roughness tuned for it), in IBL tint, in menu golden hour and in the gorge cloud sea |
| 14 | **Uncanny faces** | Waxy humans | No faces: fired masks with painted features. Expression comes from mask variants and kilnglass eyes |
| 15 | **Too many glaze colours** (ceramics invite rainbow palettes) | Visual noise, no hierarchy | ≤ 2 glaze hues per fighter plus neutrals; environment chroma caps; modes get no colour; brand accent is light, not hue |
| 16 | **Cheap-sounding synthesis** | Chiptune, sterile sines | Modal synthesis with inharmonic partials and doublets, noise layers on every transient, convolution space, humanised timing and velocity, loudness-normalised stems |
| 17 | **Blender/three.js mismatch** | Bakes look different in game | One tone mapper on both sides (Khronos PBR Neutral); the LUT is applied in the Blender compositor for previews; a turntable sign-off in the game's own menu scene |
| 18 | **Big boss rigs** we cannot animate well | Stiff monsters | Objectives are mostly architecture: the Bellkiln is a capturable building; only the Old Sagger is a creature, and it is a stack of boxes, so it animates well with few bones. Jungle camps are small VAT-instanced creatures (r10 §5.2) |
| 19 | **Shadows that look cheap** | Blocky or swimming shadows | The narrow camera means one fitted 2048² map at about 1.3 cm per texel, texel-snapped (r10 §2.2); short noon-ish shadows; N8AO contact; blob shadows at Low |
| 20 | **The reserved mode slot looks unfinished** | A broken-looking fourth tile | It is a designed, bricked-up kiln door with a sealed stamp and an "in the kiln" caption; it unseals from data |

---

## Appendix A: token block (copy into `tokens.css`)

```css
:root{
  --bg-0:#0E0C0B; --bg-1:#161311; --surface-1:#1F1B18; --surface-2:#2A2521; --surface-3:#353029;
  --line-1:#3E3731; --line-2:#5A5048; --incise-hi:rgba(255,241,214,.06);
  --text-1:#F4EFE6; --text-2:#BDB2A3; --text-3:#958A7D; --text-disabled:#6A6158;
  --kilnlight:#FFF1D6; --kilnglow:#FFC46B;
  --ok:#6FD3A6; --warn:#FFB547; --danger:#FF5A2C;
  --self:#8FF3FF; --ally:#3D8BFF; --enemy:#FF5A2C; --neutral:#E3C77A;   /* CVD sets swap these */
  --dmg-physical:#F9D9AE; --dmg-magic:#D0A8FF; --dmg-true:#FFFFFF; --heal:#3FBF6A; --shield:#EADFC7;
  --res-heat:#F3E2A6; --res-breath:#A9E7CF;
  --item-raw:#8E8475; --item-fired:#6FD3A6; --item-glazed:#F49BCB; --item-gilt:#F5C84C;
  --seat-1:#E90F60; --seat-2:#FEC07A; --seat-3:#B3A116; --seat-4:#DBEE19; --seat-5:#277203;
  --seat-6:#139D8A; --seat-7:#A6B2F8; --seat-8:#6162FE; --seat-9:#B60A99; --seat-10:#FD97B7;
  --dur-micro:80ms; --dur-press:70ms; --dur-hover:120ms; --dur-set:240ms; --dur-lift:180ms;
  --dur-panel:320ms; --dur-station:900ms; --stagger:32ms; --dur-sheen:520ms;
  --ease-set:cubic-bezier(.22,1,.36,1); --ease-lift:cubic-bezier(.55,0,1,.45);
  --ease-std:cubic-bezier(.2,0,0,1); --ease-station:cubic-bezier(.65,0,.35,1);
  --font-display:"Anybody Variable",system-ui,sans-serif;
  --font-body:"Figtree Variable","Noto Sans",system-ui,sans-serif;
  --font-num:"Chivo Mono Variable",ui-monospace,monospace;
}
```

## Appendix B: per-asset checklist (every asset, before merge)

1. Greyscale render at 75 px: the top band is the lightest and the foot the darkest.
2. Black silhouette beside the roster: unique, shows facing, the weapon reads.
3. CVD simulation (deutan, protan, tritan) of an in-context screenshot, not of swatches (r06 §9).
4. No reserved hue in emissive or VFX; glaze chroma in reserved bands ≤ 20.
5. Texel density within ±10% of target.
6. Rendered with Khronos PBR Neutral plus `VALE_FIRED_v1`, in the game camera, at 720p, zoomed out.
7. Every coined name run through the deny-list script.
