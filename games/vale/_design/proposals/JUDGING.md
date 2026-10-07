# VALE style bible: judging the three proposals

**Date:** 2026-10-07 · **Judge:** creative director · **Proposals:** `bible_clarity.md` ("Clarity", the chalk vale above the Pall), `bible_identity.md` ("The Stopped Dial"), `bible_craft.md` ("FIRED", the kiln valley).
**Method:** all three read in full. Every colour claim that decides a score was re-measured with my own implementation (sRGB → linear → Machado-2009 CVD at severity 1.0 → CIELAB → CIEDE2000; WCAG 2.x contrast). My numbers reproduced the proposals' own figures to 0.1 (e.g. Identity's 24.2 / 24.0 / 21.7 / 21.2 terrain separation, Clarity's FRAY 10.4 deutan), so the comparison below is like for like. Collision checks used WebSearch on 2026-10-07.

## Scorecard (1–10)

| Criterion | Clarity | Identity | Craft |
|---|---|---|---|
| Originality vs every shipped lane-brawler | 6 | **9** | 4 |
| Competitive readability | **10** | 7 | 8 |
| Coherence as ONE product (Rift, Bridge, Fray, client) | 8 | **9** | **9** |
| Feasibility in our pipeline | 7 | 7 | **9** |
| Appeal / memorability | 6 | **9** | 7 |
| Colourblind safety | **8** | 7 | 7 |
| **Total** | 45 | **48** | 44 |

## Reasons

### Clarity (45)

- **Originality 6.** A chalk valley held clear of a sea of cloud is pleasant and well named (Ollun, Skerra, Keel, Haarwyrm), and its orthogonal map topology deliberately avoids the reference map's diagonal. But sky-islands above cloud are a familiar fantasy image, the relationship colours (blue ally, red enemy) are the genre default, and the client is brand-less by design.
- **Readability 10.** The best rules document of the three: the 200 ms read order, a terrain chroma ladder, a horizontal attack axis with mirrored maps (fair with no camera offset), a numeric sun-glare check, a per-fighter key light with a 75% shadow floor, "a glow only during a wind-up", telegraphs drawn after the grade, and a motion grammar for VFX.
- **Coherence 8.** One world, one LUT, one key, and mode select as camera flights between three places. FRAY's fiction (a summit that rises when the cloud sinks) is thinner than the others', and "the brand is no hue" risks a generic client.
- **Feasibility 7.** It specifies `backdrop-filter` blur over the live WebGL canvas (both other proposals measure this as a per-frame cost). A convincing cloud sea in the menus and under the BRIDGE deck is hard to make in WebGL, and generic clothed humanoids with fur and feather alpha cards are the weak spot of skin-modifier bodies.
- **Appeal 6.** Deliberately quiet; the proposal itself lists "grey world" as its first risk. The least memorable hook.
- **CVD 8.** The best relationship triplet (worst pair 28.2 deutan, 42.5 protan, 38.1 tritan) and the best FRAY spread (10.4). But its red enemy falls to ΔE 12.0 against jungle stone under protan, and its FRAY Red seat sits only 4.0 from its own enemy colour under CVD.

### Identity (48), the winner

- **Originality 9.** A valley carved into one sundial whose needle fell while its shadow stayed; morning stuck on one rim and evening on the other; a yearly Shadowless Noon as the in-world reason a free-for-all exists. Aubade and Serenade (morning song and evening song) are names no lane-brawler has used, and the marigold enemy breaks the red-enemy habit. WebSearch found no game with this premise or these names. One point off: its RIFT layout (bases bottom-left and top-right, diagonal mid, river on the anti-diagonal with a pit at each end) reproduces the reference map's topology, which the owner bans.
- **Readability 7.** A strong team triplet with shape codes on every channel and clockwise "dial sweep" timers. Lost points: the diagonal layout forces a +4.5 m per-side camera offset; the fighter accent glows at 2–3 HDR all the time, so brightness no longer means danger; the FRAY floor is "polished" basalt (specular glare); the BRIDGE sun sits 30° high, directly behind the camera (flat light, long shadows); and three per-map LUTs and exposures.
- **Coherence 9.** Every part grows from the one image: the Mode Dial with an uncarved hour for the reserved mode, dial-sweep cooldowns and telegraphs, ranks that "climb the sun", and one motif whose last note changes by side and mode.
- **Feasibility 7.** Glass and resin with clearcoat, a carved dial floor, clothed humans on skin-modifier bodies and swaying foliage are exactly where our pipeline is weakest. Per-map LUTs triple the grading work.
- **Appeal 9.** The most memorable hook and the strongest key-art image (the fallen needle beside a shadow with nothing casting it). "Luminous, competitive, a little melancholy" is a tone players can feel.
- **CVD 7.** Relationship colours hold ≥ 26.6 between each other and ≥ 21.2 against lane, jungle and river stone under all four visions at once. But its FRAY set falls to 6.8 under CVD and to 3.8 against its own HARM colour, and its tritan alternate collapses for protan viewers (5.6), which is acceptable only because it is opt-in.

### Craft (44)

- **Originality 4.** Inside the genre it is the most inventive (glazed fighters with masks, death as a crack, respawn as a refire, defeat mended in gold). But WebSearch found **Kiln** by Double Fine, released 23 April 2026: an online team brawler where players sculpt clay pots on a pottery wheel, fight in them, and win by putting out the enemy's kiln. Craft's towers are literally called *Kilns*, the west house is *the Wheel*, and its fighters are spirit-animated pottery. VALE would read as "the lane-brawler version of Kiln". That premise cannot ship.
- **Readability 8.** Horizontal lanes (fair by construction), a LUT that pulls world chroma out of the team bands, MAX-capped telegraph fills, minion bars only when damaged, keylines on every overlay. Lost points: glossy glaze on every surface risks specular sparkle at 75 px, and its camera shows only 19.2 m of ground across, less than the 24 m the sim's 12 m sight radius wants.
- **Coherence 9.** Kiln doors for the modes (a bricked-up one for the reserved slot), ceramic UI sounds, and one tone mapper for everything.
- **Feasibility 9.** The best pipeline thinking of the three: the world is chosen so that skin-modifier bodies, bevels and lathe forms are the style, and hair, cloth simulation, foliage and faces are designed out. Opaque instanced shards replace big alpha sprites. Khronos PBR Neutral matches Blender's view transform.
- **Appeal 7.** Shattering deaths and gold-mended defeats are memorable, but masked pottery is less aspirational as a cast of champions to sell skins for, and the proposal itself lists "brown soup".
- **CVD 7.** Ally against enemy ≥ 49 under every vision, but self against ally only 22.0 under tritan, a FRAY worst pair of 9.0, and one FRAY seat 1.0 from its own enemy colour under CVD.

## Decision: Identity is the base, with these grafts

| # | Graft | From | Why |
|---|---|---|---|
| 1 | The **200 ms read order** (threat → side → health → self → objective) as the bible's tie-breaker | Clarity | Gives every unforeseen case a rule |
| 2 | **Horizontal attack axis, maps mirrored across the north–south noon line** | Clarity (also Craft) | Removes the diagonal layout that copies the reference topology, and the +4.5 m per-side camera offset; the noon line becomes the river, which suits the sundial |
| 3 | **Per-fighter key light** in the shader and a **75% shadow floor** | Clarity | Fighters read light-on-top under every sun |
| 4 | **"A glow is a warning"**: accent emissive ≤ 0.8 at rest (below the bloom threshold), ≥ 1.5 only in wind-ups | Clarity | Keeps Identity's readability-coloured accent (which CONTRACT §9 requires) without making brightness meaningless |
| 5 | **One locked LUT** for every map, the menus and the showcase; exposure locked at 1.0 | Clarity (also Craft) | The owner asked for "a LOCKED colour grade"; one grade makes three modes one product |
| 6 | No moving cloud shadows; walkable roughness ≥ 0.5 (the FRAY floor becomes **honed** basalt) | Clarity | Removes glare and visibility that changes with position |
| 7 | VFX motion grammar (up = help, out = harm) and a **shared enemy wind-up sweetener** (here a shade-breath swell) | Clarity | Allegiance can be seen and heard |
| 8 | Mode marks (three roads, a line over an arc, a ring of ten ticks) and fixed CTA and Back positions | Clarity | Consistency across every screen |
| 9 | **Pipeline-as-style rules**: masks and visors instead of faces, no hair cards, rigid drapery, no alpha-card foliage, 2–4 cm bevels as brushstrokes, AO, curvature and a top-down gradient baked into base colour | Craft | Turns the skin-modifier, bevel and lathe pipeline into the look instead of fighting it; given a world reason (nobody shows a bare face to the stopped sun) |
| 10 | **Khronos PBR Neutral everywhere** with emissive caps 0.8 / 1.5 / 3 / 6 / ≥ 10 | Craft | One transform for menus, match and showcase; Blender parity; only T4 effects can reach white |
| 11 | **LUT suppression of world chroma in the team-hue bands**, gated to value < 0.85 | Craft (modified) | Post-grade overlays always win; the value gate keeps the bright accent emissive at full hue |
| 12 | **Opaque instanced chips and shards** for impacts | Craft | Cheaper and more readable than large alpha sprites |
| 13 | Telegraph fills MAX-blended and capped at 40%, a 1 px dark keyline on every overlay, minion bars only when damaged, at most 8 damage numbers | Craft | Declutters teamfights; marigold is lighter than the lanes, so it needs the keyline |
| 14 | **Modes get no colour** | Craft | Identity's FRAY mode accent equalled its warning yellow; the mark, camera station and motif ending already tell modes apart |
| 15 | **One initial per launch fighter**, "dial-tongue for who, English for what", the Stamp-forward FRAY option, a 30 fps idle menu cap | Craft | The dial-tongue already has exactly 16 letters, so the rule fits perfectly |

**Changed in the merge (not taken from any proposal):**

- **A new FRAY palette** from a constrained maximin search with one colour per nameable hue family. Its worst pair is **10.4 under all four visions** (normal 17.0), and it holds ≥ 15.5 from self, ≥ 10.1 from HARM and ≥ 9.6 from heal. Each proposal's own set failed against its own harm colour (Clarity 4.0, Identity 3.8, Craft 1.0) and its own heal colour (6.0, 5.4, 5.4). Glyphs were assigned by brute force so that every close pair gets glyphs from different families.
- **Role names replaced.** Identity's *Vanguard*, *Warden* and *Marksman* are the reference game's class names. The new roles are Plinth, Breaker, Striker, Slinger, Caster and Tender.
- **Portrait restored** to the Dial Bar, because CONTRACT §10 requires portrait, level and XP.
- **Menu sun moved to the left** (18°, azimuth 250°), so the scene light, the UI's top-left catch-light and the left-hand UI composition agree.
- **BRIDGE sun raised** from 30° directly behind the camera to 46°, behind-left: no flat front light and no long shadows that read as extra figures.
- **Names.** Every Craft name built on *Kiln* was dropped. *Facets* (a Dota term) and *Pearl* (another MOBA's name) were caught by `names_check.ts`. The glyph name *Hourglass* became *sandglass* (it is adjacent to a famous LoL item). Eight example fighter names sat within edit distance 2 of a protected champion or hero (e.g. Obran ~ Brand) and were replaced.

**Notes for the LEAD (interfaces I do not own):**

- CONTRACT §9 lists `LUT3D → tone mapping`. `LUT3DEffect` expects display-referred sRGB input, so the order must be **tone mapping → LUT → vignette → overlay pass → SMAA** (Identity flagged this; it is adopted).
- CONTRACT §9 "accent emissive = readability colour" is kept, with graft 4's rest and wind-up limits.

## Outputs

- `_design/STYLE_BIBLE.md`: the one-page law (954 words of prose plus compact tables).
- `_design/WORLD.md`: the writers' reference (premise, sides, modes in the world, naming palette, glossary, voice).
- `_design/tokens.json`: the machine-readable tokens.
- `_design/tools/verify_tokens.py`: recomputes every contrast and ΔE figure the bible quotes from `tokens.json`, and exits 1 if a gate fails.

Sources for the collision finding: [Double Fine: announcing Kiln](https://www.doublefine.com/news/announcing-our-new-game-kiln) · [Xbox Wire, 23 April 2026: Kiln launch-day tips](https://news.xbox.com/en-us/2026/04/23/kiln-get-started-pottery-party-brawler-journey-launch-day-tips/)
