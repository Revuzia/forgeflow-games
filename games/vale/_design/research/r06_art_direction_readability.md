# R06: Art Direction in Service of Readability

**Project:** VALE (Forgeflow Games), an original browser-based competitive lane-brawler (custom Three.js / WebGL2 client)
**Date:** 2026-10-07
**Primary reference:** League of Legends (LoL) as of 2026. **Secondary:** Dota 2. Comparisons: Overwatch, Deadlock, Pokemon UNITE, Heroes of the Storm, SMITE 2, Predecessor.

> **Method note. Read this before relying on anything below.**
> This pass ran with **no web search budget**. The shared per-turn search budget (200 calls) was used up by sibling research agents before this agent's first query, and both test searches came back refused. Direct fetches were also blocked by the egress proxy for every host tried: `media.steampowered.com` and `steamcdn-a.akamaihd.net` (two official hosts of Valve's Dota 2 Character Art Guide PDF) and `en.wikipedia.org`. After those three failures, no further fetches were attempted.
>
> Each claim falls into one of three classes:
> - **Cited [n]:** confirmed from search-result snippets by the sibling passes R02, R04 and R05, run the same day in this folder. The URLs in the Sources list are the ones those passes saw. This agent did not reopen them.
> - **[unverified]:** practitioner knowledge recalled from memory (for example, the contents of Valve's Dota 2 Character Art Guide and Riot's 2014 map-update posts). It is probably right in substance, but it must be re-checked before it becomes spec. **Most of the "what shipped games do" material in this file falls in this class.**
> - ***Analysis:*** my own design reasoning or arithmetic. It is not a reported fact and needs no citation, but it should be tested.
>
> A follow-up pass with a fresh search budget should confirm the [unverified] items. The re-check list is in section 11 (c).

---

## 0. Key takeaways

1. **Readability is a priority stack, and art direction decides who gets the contrast.** Shipped lane-brawlers give the most value contrast, saturation and detail to whatever the player must react to (threat VFX), then to champions, then to units, then to terrain that matters for play (walls, brush, lanes), and the least to decoration. Riot's public VFX style guide states this outright for effects. Designers rate each spell's importance, the visual weight follows that rating, and pure white is kept for the most important effects [1][2][4].
2. **The thing to dodge gets the highest contrast.** Within one effect, the part that carries danger (a missile's tip, an impact edge) gets the highest contrast and saturation. Trails and secondary particles stay quiet [3][2].
3. **Hue is a reserved resource.** Riot moved a champion's visual update away from red because red reads as enemy [5]. Team colors (self, ally, enemy) live in an overlay layer of bars, outlines and decals [6][12], not in the character's own palette. A friendly kit should never spend the hue that means "enemy".
4. **Silhouette and value come before color.** Valve's Dota 2 Character Art Guide (from memory) asks for heroes that read by silhouette from the game camera, a value gradient from dark at the feet to light at the head and shoulders, saturation and detail focused near the head and weapon, and broad shapes instead of noisy detail [unverified]. The reason: at about 100 px tall, only the big shapes and value groups survive.
5. **The environment is a stage, not a painting.** Terrain is kept in a narrower, lower-saturation value band than characters, so heroes "pop" without outlines. Lanes read as worn, lighter, low-detail paths. Jungle reads as darker and busier. Walls read by lit tops and dark faces [unverified as reported practice; *analysis* as principle].
6. **Map visuals now carry live game state.** LoL's 2026 map changes its terrain theme after early dragons, and that change also decides where special glowing vision spots appear [20][21]. The art layer is part of the rules display.
7. **Friend and foe are shown redundantly.** LoL colors bars by relationship (self green, ally blue, enemy red) [6]. Its colorblind mode moves "self" to yellow [7], and players say that alone is not enough [8]. Dota offers a separate ally-bar color and high-visibility bars [9][10]. Deadlock players have asked for an enemy-color setting [11]. Lesson: never let hue be the only carrier of friend or foe.
8. **UI art direction is a system with rules.** Riot built its client language on three shapes, each with one job (structure, guidance, focus). It was designed so new screens would not each need a dedicated artist [18]. A style bible is what makes that possible.
9. **Camera geometry sets the art budget.** Dota's default camera distance is 1134 units [15]. LoL's FOV and pitch were reported only by a low-reliability source (about 40 degrees FOV, about 56 degrees pitch) [16]. *Analysis* (section 5): with those values, a hero about 110 px tall at 1080p needs the camera at about 7.5 hero-heights from the hero. That puts on-screen detail at about 100 px per meter, which sets texel density, outline width and VFX scale.
10. **In FFA, color alone fails beyond about 6 to 8 players.** RTS games and Dota give each slot a fixed color [unverified], but 10 hues cannot all stay apart under color-vision deficiency. Shipped and well-known accessible palettes stop at about 8 hues [unverified]. Past that, add marks, patterns or numbers.

---

## 1. The readability problem, stated as a design rule

A lane-brawler screen at a teamfight can hold 10 heroes, 20 to 40 minions, several structures, a dozen overlapping ability effects, ground telegraphs, health bars and the HUD. The player has a fraction of a second to answer four questions in order:

1. **What will hurt me, and where, right now?** (telegraphs, projectiles, impact zones)
2. **Who is who?** (which hero, which team, how healthy)
3. **Where can I go?** (lanes, walls, brush, chokepoints)
4. **Where am I on the map?** (landmarks, team territory, minimap)

*Analysis:* every art decision in shipped games of this genre can be read as dividing a fixed **contrast budget** among those four questions. The environment gets the least. If every layer is "beautiful" at full contrast, nothing is readable. Riot's VFX guide makes this explicit for effects: its stated goals are gameplay clarity, minimal clutter, theme support, and surprise and delight, delivered through value, color, shape and timing [1][2]. Clarity comes first in that list. Delight only works inside the clarity budget.

**Practical form of the rule (*analysis*):** keep a written "value ladder" for the project:

| Layer | Value range (0 = black, 100 = white) | Saturation | Detail | Motion |
|---|---|---|---|---|
| Top-tier threat VFX (ultimates, executes) | Can reach 100 (pure white is reserved) | High at focus | High at focus | Fast, readable timing |
| Normal ability VFX | 40 to 90 | Medium-high at focus, low at trails | Concentrated at the dangerous edge | Short |
| Heroes | Full range; darkest at feet, lightest at head | Highest near head and weapon | Big shapes; detail near the face | Readable anticipation |
| Minions / neutral units | Narrower than heroes | Lower than heroes | Low | Simple loops |
| Gameplay terrain (lanes, walls, brush) | 25 to 70 | Low to medium | Low on paths, medium off-path | Static, or a slow sway for brush |
| Decoration / out-of-bounds | 15 to 60, compressed | Low | Free, but not noisy at gameplay zoom | Very slow ambient |

The numbers are a starting proposal for Vale, not reported values from any game.

---

## 2. League of Legends

### 2.1 VFX style guide (2017, public)

- **Four goals:** gameplay clarity, minimal clutter, theme support, and surprise and delight, achieved through value, color, shape and timing [1][2].
- **Importance scoring:** each spell gets an importance rating, and its visual intensity is kept in proportion. Pure white is held back for the most important and most damaging effects, such as ultimates [2][4]. *Principle:* brightness is a currency. If every spell spends it, it buys nothing.
- **Area of focus:** a missile's head or an impact edge gets the strongest contrast, saturation and detail. Tails and ambient particles stay subordinate, so the eye lands on the part that decides "dodge or not" [3].
- **Hue discipline:** during a champion's visual update, Riot moved effects away from red because red carries enemy meaning [5]. *Principle:* reserve a small set of hues for system meanings (enemy, self, damage types) and keep cosmetic kits out of them.

### 2.2 Relationship colors and outlines

- Health bars are colored by relationship: self green, allies blue, enemies red [6]. Colorblind mode changes self to yellow and leaves blue and red in place [7]. Critics say this does too little for people with real color-vision deficiency [8].
- Hovering over an enemy draws a red outline around it [12]. *Principle:* outlines are a selective, on-demand layer for targeting, not a permanent cel-shading style. That keeps the base image clean.
- Champion models themselves are not team-tinted. The same model and skin appear on either side, and team identity comes from bars, outlines, the minimap and some team-colored ability decals [unverified for which abilities]. *Principle:* identity (who) belongs to the model. Allegiance (whose side) belongs to the overlay. This separation is also what makes paid cosmetics safe for competitive readability.

### 2.3 Visual updates and the 2014 map rebuild [unverified]

From memory of Riot's public dev posts, not re-confirmed in this pass:

- **Visual Updates (VU)** rebuild an older champion's model, textures, animation and effects to current standards while keeping the kit and core identity, so returning players still recognize the champion at a glance. Larger reworks change gameplay as well [unverified].
- The **2014 Summoner's Rift update** rebuilt the map's art while mostly keeping its gameplay geometry. Riot's stated goals included clearer gameplay (lanes, brush and wall edges easier to read), a more unified style across the map, a map that sits behind the champions instead of competing with them, and environmental storytelling that stays outside the play space [unverified]. A widely discussed detail: walls and brush were given cleaner, more consistent edges so players could judge pathing and flash and dash distances [unverified].
- *Analysis:* the lasting lesson is that **map art is a gameplay UI**. A wall edge you can't read is a balance problem, not a cosmetic one.

### 2.4 2026 and the road to 2027

- **Map as state display:** in 2026 the map's terrain changes element after early dragons, and that change also decides which special vision spots appear [21][20]. Those spots are fixed glowing points on the map. Warding one extends vision for a while [20]. *Principle:* if terrain changes mid-match, the change must be readable as a rule ("this area now works differently"), not only as a mood.
- **2027 overhaul:** Riot has confirmed a full visual overhaul of the map as part of a larger 2027 update that also includes a new client [22][23][24]. *Implication:* even the genre leader treats its 2014-era art as due for replacement. Vale's art direction should plan for a full visual refresh over the game's lifetime, by keeping gameplay geometry and visual skin as separate data.

---

## 3. Dota 2

### 3.1 Character Art Guide (Valve, public PDF for Workshop artists) [unverified: fetch blocked]

The guide was written so outside artists could make cosmetic items that fit the game without hurting readability. The principles below are recalled from memory. The PDF itself could not be opened here.

- **Readable from the game camera first.** Heroes and items are judged at default gameplay zoom, not in a close-up turntable. Fine detail that disappears at that zoom is wasted, and it can turn into noise [unverified].
- **Silhouette:** each hero should be identifiable by outline alone. Items must not blur the hero's key silhouette features, such as a signature weapon, head shape or wings [unverified].
- **Value pattern, dark at the feet to light at the head:** the lower body and feet are darker and less saturated, and the head, shoulders and weapon area are lighter and more saturated. The reasons:
  - It separates the hero from the ground plane, because the feet melt into terrain and the top pops.
  - It points the eye to where the hero "faces" and acts.
  - It copies how a light from above reads [unverified].
- **Color and saturation focus:** keep saturation for the focal area and a few accents. Do not spread uniformly saturated color across the whole model [unverified].
- **Detail density:** paint broad shape-first forms with clear material separation. Avoid high-frequency noise and uniform detail everywhere [unverified].
- **Texture painting under a custom shader:** Dota's hero shader reads extra mask textures that control effects such as rim light, specular strength, metalness-style tint and self-illumination per texel. Artists can therefore "paint" where rim light separates the hero from the ground [unverified for the exact channel layout].
- **Team identity is not in the model.** Like LoL, Dota heroes keep their colors on either team. Allegiance appears in bars, the top bar and the minimap [unverified].

### 3.2 Environment and map

- **Two territories, two looks [unverified]:** one side of the map is lush and bright, and the other is dark and blighted. Even with no HUD, the ground under the camera tells you which half of the map you are in. *Principle:* make each team's territory recognizable from a 200 px crop of the screen.
- **Terrain skins [unverified]:** Dota sells or awards alternate terrain themes that restyle the whole map while keeping gameplay readable. *Principle:* when gameplay geometry is separate from surface theming, cosmetic map variants become possible without balance risk. This only works if every theme keeps the same value relationships: path lighter than off-path, trees clearly blocking, cliff tops readable.
- **Minimap abstraction:** by default Dota draws heroes on the minimap as abstract markers, with options to show portraits or names [14]. LoL draws portraits on the minimap, uses team-colored ward icons whose shape shows the ward type, and removes towers as they die [13]. *Principle:* the minimap is a separate art style, a schematic rather than a shrunk-down render.
- **Camera:** Dota's default camera distance is 1134 units, the value custom games override [15].

---

## 4. Overwatch, Deadlock and others: readability lessons

All of these are **[unverified]** in this pass except where cited.

- **Overwatch** (the strongest reference for team-color highlighting in a fast game):
  - Enemies get a red outline or highlight and allies a blue one, with accessibility options to recolor the enemy highlight [unverified].
  - Blizzard's art team has said publicly that heroes must be identifiable by silhouette alone, and that shape language encodes role: bulky, blocky tanks; lean, angular damage heroes; softer, rounder supports [unverified].
  - Environments use lower-contrast, lower-saturation surfaces near play areas, so characters stand out [unverified].
  - Important ability sounds and effects differ for friend and foe. An enemy's version of an ultimate voice line or effect is the louder, more alarming one [unverified].
- **Deadlock:** each team has its own UI color [unverified for hues], and players have asked for a colorblind setting just for enemy colors [11]. The art style was revised during the game's development, which has been publicly discussed [unverified]. *Lesson:* even teams with strong art direction iterate on readability in public tests. Plan for at least one readability pass after real play data.
- **Pokemon UNITE:** your own team is shown in one color family and the opponents in a contrasting warm one, on bars, goals and the score [unverified for exact hues]. The art is soft and saturated, but play surfaces are kept simple [unverified].
- **Heroes of the Storm:** maps vary widely in theme (gothic, jungle, space), but each keeps a common grammar: paths, walls, objectives and team-colored structures [unverified]. *Principle:* consistent gameplay grammar across many visual themes.
- **SMITE 2 / Predecessor:** both moved to Unreal Engine 5 with stylized PBR, painted-looking materials under physically based lighting [unverified]. They are third-person, so readability depends more on character outlines and enemy highlights than in top-down games [unverified].

---

## 5. Camera, character size, lighting and grading

### 5.1 How tall is a hero on screen? (*analysis* plus formula)

Reported values:

- Dota default camera distance: 1134 units [15].
- LoL: FOV about 40 degrees, pitch about 56 degrees below horizontal, from a low-reliability source [16] **[unverified]**.

Neither game publishes a pixel height for heroes. The geometry can be worked out instead.

For a perspective camera with vertical FOV θ and pitch φ (degrees below horizontal), at distance D from a standing hero of height h, on a screen H pixels tall:

```
hero_px  ≈  H · h · cos(φ) / (2 · D · tan(θ/2))
ground_px_per_m (screen-horizontal) ≈ H / (2 · D · tan(θ/2))
```

The cos(φ) term is the foreshortening of a vertical figure seen from above. At φ = 56°, a hero shows only about 56% of its true height. Ground depth is foreshortened by sin(φ), about 83%.

Worked example for Vale (θ = 40°, φ = 56°, H = 1080):

| Target hero height on a 1080p screen | Camera distance D / hero height h | For a 2 m hero, D ≈ | Screen px per meter (horizontal) | Same hero at 720p |
|---|---|---|---|---|
| 90 px | 9.2 | 18.3 m | ≈ 81 | 60 px |
| 110 px | 7.5 | 15.0 m | ≈ 99 | 73 px |
| 130 px | 6.4 | 12.7 m | ≈ 117 | 87 px |

*Analysis, why it matters:*

- **Silhouette budget.** At about 100 px tall, a hero's head is about 12 to 15 px across. Facial detail is invisible, and only head shape, shoulders, weapon and a few value groups read. This is why the genre paints big shapes and puts value contrast near the head.
- **Browser reality.** Vale runs in a browser, often windowed or on 720p and 768p laptops. Readability must be signed off at the **smallest supported viewport**, where the same hero may be only 60 to 75 px tall.
- **Texel density.** At about 100 screen px per meter, hero textures need roughly 1 to 2 texels per screen pixel at max zoom, so about 100 to 200 texels per meter. More than that only costs memory and causes shimmering. Use mipmaps and anisotropic filtering on the tilted ground plane.
- **Outline width.** A 1 px outline on a 110 px hero is about 1% of its height, which is readable. A 3 px outline starts to look like a cel-shaded style choice. Width should be set in screen pixels (DPI-aware), not world units.

### 5.2 Lighting characters vs environment (*analysis* plus [unverified])

- **Painted light, simple runtime light.** Classic LoL art paints most light and shadow into the color textures (hand-painted), so a champion reads well under very simple runtime lighting [unverified]. Dota uses a custom shader with painted textures plus rim and specular masks [unverified]. Both approaches favor **authored control over physical accuracy**.
- **Separate light rigs (*analysis*).** Lighting heroes with a dedicated key, fill and rim, separate from the environment's light, lets the map be moody while heroes keep their readable value pattern. In Three.js this can be a second light set on a layer or a per-material uniform. A camera-relative rim (a Fresnel term) gives "free" separation from the ground at any map position.
- **Contact shadows (*analysis*).** A soft, dark ground disc or projected blob under each unit anchors it to the painted ground and shows the footprint. That matters for hitbox reading and skillshot dodging. Full dynamic shadows are optional at quality tiers. The contact shadow should not be.
- **Color grading and fog.** Fog of war, which darkens and desaturates areas your team cannot see, is both a gameplay layer and a grading layer [13]. Seen areas should be at full brightness and unseen areas clearly compressed. *Analysis:* avoid atmospheric distance fog in a top-down MOBA. The whole play area sits at about the same camera distance, so depth fog adds murk without adding information.
- **Sky.** At a 50 to 60 degree pitch the sky is mostly off-screen [16]. Sky work in this genre goes into reflections, ambient tint and the lobby or loading presentation, not into the match view (*analysis*).

---

## 6. Map readability

### 6.1 Lanes, jungle, walls and brush

*Analysis*, consistent with the shipped practice described above [unverified as reported specifics]:

- **Lanes:** a lighter, smoother, lower-detail surface (worn path, paving) running clearly from base to base. Lanes are where most of the fighting happens, so the ground there must be the quietest backdrop. A light path also makes dark-footed heroes pop, which is the Dota value pattern working with the map.
- **Jungle:** darker and more textured than lanes, but still below the characters' contrast. Camp clearings should be lighter "rooms" inside the darker jungle, so you can tell where fights happen.
- **Walls and cliffs:** read through a **lit top and a dark face**, with a clean, continuous edge line. The exact walkable boundary must be visible, because dashes and blinks depend on it. Keep decoration on top of walls, never on the edge line.
- **Brush (concealment):**
  - Units in brush are hidden from enemies outside it unless revealed [unverified per R02].
  - Readability needs: a distinct hue or texture clump with a clear outer boundary; a visible state change when you or an ally is inside (for example, semi-transparent foliage plus a desaturated tint on the hidden unit); and a gentle animated "rustle" when something enters, if Vale chooses to give that information away. That is a design decision, not an art one.
- **River or divider:** a cool, horizontal band between halves gives instant "which half am I on" information and a natural place for objectives (*analysis*).

### 6.2 Landmarks and orientation

- **Every region needs one unique silhouette prop** visible at gameplay zoom: a broken statue, a big tree, a crystal. Players then learn locations by name ("fight at the statue"), which also helps comms (*analysis*).
- **Objective pits** should be the most distinctive architecture outside the bases. The LoL 2026 glowing vision spots show that map points can carry rules as well as art [20].
- **Camera symmetry:** an angled camera sees more ground in some directions than others. One shipped-MOBA level designer describes aligning lanes with the camera rotation and centering objectives so neither team gets a geometric edge [17]. Art should not break that symmetry, for example by placing tall foreground props that hide units only on one team's side.

### 6.3 Team territory and base identity

- **Two-axis identity:** each team's base should differ in **color temperature** (cool vs warm) and in **architecture shape language** (for example, rounded and organic vs angular and crystalline). That way it still reads under color-vision deficiency and in grayscale (*analysis*). Dota's bright vs blighted halves are the reference for this [unverified].
- **Structures carry team color as an accent**, in banners, crystals or lights, while their massing carries team architecture. The team color can then swap to the viewer's relationship colors (ally or enemy) in an option, without remodeling (*analysis*).

### 6.4 Minimap art

- Use a schematic style with flat terrain colors, lanes as light strokes, team territories tinted, and icons that use **shape for type and color for team** (LoL's ward icons do this [13]).
- Heroes should appear as portrait or marker with heading. Dota's abstract-marker default [14] stays readable with 10 overlapping heroes, which portraits do not always do. LoL's overlapping portraits can hide each other [13].

---

## 7. UI art direction and the style bible

### 7.1 What shipped clients do

- **Riot's client language:**
  - It frames the client as an in-world tool.
  - It uses three shapes, each with one job: a square for structure, a diamond to guide the eye to key information, and a circle for primary items that need action.
  - It was designed to scale to new features without a dedicated artist for each screen [18].
  - *Principle:* ornament is allowed only where it marks hierarchy.
- **Dota 2's Panorama:** Valve's UI framework authors layout, style and behavior like a web stack and can place 3D models and particles inside the UI [19]. *Principle:* the UI can show live game assets (heroes, effects) instead of flat renders, which keeps the client and the match visually continuous. That is directly relevant to a browser game, where menu and match share one WebGL context.
- **Gilded vs flat [unverified as a trend claim]:** the genre's older UIs used heavy metallic frames and gradients. Recent updates lean toward flatter panels with fewer, sharper accents, keeping ornament for rarity and prestige (ranked borders, premium cosmetics). *Analysis:* ornament level works best as a **ranked scale with meaning**: plain, then trimmed, then gilded, mapped to importance or rarity. Decoration alone is not a reason for it.

### 7.2 What a style bible should contain (*analysis*, standard practice)

1. **Purpose statement and pillars** (for example, "readable in 200 ms, then beautiful").
2. **Color tokens:**
   - Reserved system hues (self, ally, enemy, damage types, rarity tiers).
   - Neutral ramps for panels.
   - Light and dark values for every token.
   - CVD test results for each pair that carries meaning.
3. **Type scale:** one display face and one text face (licensed or open-source, chosen for Vale), sizes at 720p and 1080p, a minimum size floor, and number styling (tabular figures for timers and gold).
4. **Shape language:** which shapes mean what (container, call to action, alert), corner radii, frame tiers.
5. **Iconography grid:** pixel grid, stroke weight, silhouette-first rule, team and type redundancy rules.
6. **Motion tokens:** durations and easings (R05 covers this).
7. **In-world art rules:**
   - The value ladder from section 1.
   - Hero value pattern and silhouette tests.
   - The VFX importance scale and hue reservations.
   - Texel density targets.
   - Outline rules.
8. **Do and don't sheets** with screenshot pairs, and a **checklist for every new asset**: grayscale test, silhouette test, CVD test, test at the minimum viewport.

---

## 8. Stylized PBR, texel density and shape language

- **Stylized PBR [unverified for the specific games]:** recent genre titles on modern engines (SMITE 2, Predecessor) use physically based materials with painted, simplified albedo, exaggerated roughness separation and authored rim or specular. LoL's classic approach and Dota's are closer to "hand-painted with helper masks". *Analysis for Vale:*
  - A good middle ground is **hand-painted albedo with light painted in only lightly** (ambient occlusion and soft gradients, no hard cast shadows), plus a simple roughness/metal map, under a fixed, authored key light.
  - Add a Fresnel rim and contact shadows on top.
  - This keeps the painted look under dynamic lights and is cheap in WebGL2.
- **Texel density (*analysis*):** pick one world density per class. For example, heroes about 160 to 256 px/m, environment about 100 to 160 px/m, and props near the lanes matched to the environment. Enforce it with a checker in the asset pipeline. Uneven density is a common sign of amateur art (an internal Forgeflow audit in another project found it the most visible tell).
- **Shape language for role readability [unverified as genre-reported; standard character-design theory]:**
  - Round shapes read as friendly, supportive or soft.
  - Square or blocky shapes read as sturdy and defensive (tanks).
  - Triangular, angular shapes read as dangerous or fast (assassins, damage).
  - Shipped hero rosters use this as a strong default, not an absolute rule. *Analysis:* encode role mainly in the silhouette's **mass distribution** (top-heavy vs bottom-heavy, wide vs narrow), because that survives at 100 px better than surface detail.

---

## 9. FFA ("Fray") player colors for 6 to 10 players

- **Slot colors in shipped games [unverified for exact lists]:** classic RTS games (for example, the Warcraft III lineage) give each of up to 12 slots a fixed color. Dota 2 gives each of its 10 player slots a color (5 per team) that is used on the top bar, minimap and scoreboard. Fixed slot colors help with match-long tracking, but many pairs are hard to tell apart under color-vision deficiency.
- **Accessible palettes [unverified]:** well-known colorblind-safe categorical palettes (Okabe-Ito, Paul Tol's sets) top out at about 7 to 8 hues. Beyond that, hue alone cannot carry identity for everyone.
- **What works (*analysis*):**
  1. **Reserve "self" as a fixed hue** that never appears in the opponent palette, the way LoL keeps self apart from allies and enemies [6][7].
  2. **Use about 8 opponent hues spread in lightness as well as hue.** Pairs that collide under deuteranopia or protanopia (red vs green, green vs brown, blue vs purple) must also differ by at least about 25 to 30 L* (lightness).
  3. **Make every color double-coded** with a **mark** (a simple glyph shown on the overhead bar, the minimap icon and the kill feed) and optionally a **pattern** on ground decals.
     - Forgeflow's own Dyefield FFA spec already does this: 8 crews, each with a color plus a mark, and a hatch pattern in colorblind mode (internal: `games/dyefield/_spec/CONTRACT_FFA.md`).
  4. **Give players options:** "enemy color" and "self color" overrides [11], plus a high-visibility bar mode [10].
  5. **Test** with CVD simulation (deuteranopia, protanopia, tritanopia, achromatopsia) on real match screenshots, not on swatches, because ground color changes how bars and marks are perceived.

---

## 10. Using Blender for Vale (the studio has Blender)

*Analysis / practical.* Blender features are named from general knowledge **[unverified in this pass]**.

- **Readability test scene:**
  - Build a lane segment, a jungle corner and a wall at true scale.
  - Put a camera at the candidate FOV, pitch and distance from section 5.1, and render at 1280x720 and 1920x1080.
  - Do the hero pixel-height and texel-density sign-off here before anything goes into Three.js.
- **Silhouette pass:** render heroes as flat black on white (holdout or emission-only material) at gameplay framing. Line up the whole roster. Two heroes that can be confused in this pass will be confused in play.
- **Value pass:** render in grayscale (view transform or a compositor desaturate) to check the dark-feet, light-head ladder and the hero vs terrain separation.
- **Hand-painted plus light PBR workflow:** paint albedo in Blender's texture paint mode or an external painter. Bake ambient occlusion and soft gradients into albedo at low strength, and export glTF 2.0 for Three.js.
- **Texel density:** use a density-checker add-on, or a UV checker texture at a fixed px/m, to keep heroes and environment on target.
- **Minimap and indicators:** author minimap icon silhouettes and ground-indicator meshes (rings, cones, lines) as simple geometry, consistent with R04's recommendation.

---

## 11. Implications for Vale

### (a) Principles and systems worth adopting, in Vale's own form

1. **A written contrast and value ladder** (section 1). Threat VFX are on top, then heroes, minions, gameplay terrain and decoration. Pure white is reserved for top-tier threats [2][4].
2. **VFX importance scoring per ability**, with brightness and saturation capped by the score and the highest contrast at the dangerous edge [2][3].
3. **Reserved system hues** (self, ally, enemy, damage types). Cosmetic and friendly kits may not use the enemy hue [5].
4. **Identity in the model, allegiance in the overlay:**
   - Heroes look the same on both teams.
   - Team shows in bars, outlines, decals and the minimap [6][12].
   - Outlines appear on hover or target, not as a permanent style.
5. **Hero art rules:**
   - Silhouette-first.
   - Dark-to-light value gradient from feet to head.
   - Saturation and detail focused at the head and weapon.
   - Shape language set by mass distribution.
   - Signed off at the smallest supported viewport.
6. **Separate hero lighting** (authored key and rim), plus **mandatory contact shadows** at every quality tier.
7. **Environment as stage:**
   - Light, quiet lanes; darker jungle with lighter camp clearings.
   - Walls with lit tops, dark faces and clean edges.
   - Brush with clear boundaries and an "inside" state.
   - One landmark silhouette per region.
8. **Two-axis team territory:** color temperature plus architecture shape language, so it reads in grayscale and under CVD.
9. **Gameplay geometry separate from surface theme,** so maps can be reskinned or refreshed without balance risk. Even LoL is replacing its map art for 2027 [22][23].
10. **Visible map state:** if terrain changes mid-match, the change must read as a rule [20][21].
11. **Schematic minimap:** shape for type, color for team, heading markers for heroes [13][14].
12. **UI built as a system:**
    - A small set of shapes, each with one job [18].
    - An ornament scale tied to meaning.
    - Live 3D assets in menus where cheap, since a browser game shares one WebGL context [19].
13. **FFA palette:**
    - A fixed self hue plus about 8 opponent hues spread in lightness.
    - Every color double-coded with a mark.
    - Self and enemy color overrides plus high-visibility bars [7][9][10][11].
14. **A style bible** (section 7.2) with a per-asset checklist: grayscale, silhouette, CVD and minimum-viewport tests.
15. **Blender test scenes** (section 10) as the sign-off gate before assets enter the Three.js client.

### (b) Protected expression that must NOT be copied

- **Champion and hero designs:** names, faces, costumes, signature weapons, silhouettes recognizable as specific characters, color schemes tied to a specific character, and animation sets.
- **Map art and layout as composition:**
  - LoL's and Dota's exact map geometry, brush placement, wall shapes, river shape and pit designs.
  - Dota's specific bright-vs-blighted visual themes as rendered.
  - Specific landmark props.
- **Named systems and assets:** the names of LoL's elemental terrain variants, its glowing vision spots, team names (Radiant, Dire, Order, Chaos), Deadlock's team names, and objective names.
- **UI expression:** Riot's gold-and-dark-blue client look, its specific diamond and circle motifs as drawn, frame art, Dota's Panorama layouts as composed, fonts, icons, ward and ping glyphs, minimap icon art, and rank borders.
- **Exact palettes:** specific hex values from any game's team colors, slot colors or UI. Pick Vale's palette independently and validate it for CVD. Generic hue families (for example, "cool vs warm") are fine.
- **Shader look-alikes:** do not reproduce a specific game's signature rendering combination so closely that a screenshot reads as that game.
- **Text from guides:** the Dota Character Art Guide and Riot's VFX guide are reference for principles only. Do not paste their text or diagrams into Vale's style bible.

### (c) Open questions

1. **Camera numbers:** confirm θ, φ and D through Blender framing tests and a Three.js prototype. Decide the target hero height at 1080p (proposal: about 110 px) and the minimum supported viewport (720p?).
2. **Outline policy:** hover-only outlines (the LoL model) vs persistent enemy highlights (the hero-shooter model). A top-down camera probably needs less, but FFA may need more.
3. **Brush disclosure:** does Vale give a visual "rustle" when an unseen enemy enters brush? This is a design decision with art consequences.
4. **Team color model:** absolute team colors (each team has a fixed color) vs relationship colors (ally or enemy from the viewer's side)? The genre's HUD uses relationship colors [6]. Base architecture is absolute. Vale needs a rule for which elements switch.
5. **Stylized PBR depth:** how much light to paint into albedo vs leave to runtime? This decides whether a day/night or weather system is possible later.
6. **FFA scale:** 6, 8 or 10 players? Above 8, a mark system is mandatory and slot colors should be shown alongside numbers.
7. **Re-verification backlog** (needs a pass with search budget):
   - Contents of Valve's Dota 2 Character Art Guide (value pattern, silhouette, saturation focus, texture and mask budgets).
   - Riot's 2014 map-update goals.
   - Riot's visual-update philosophy posts.
   - Overwatch's enemy-highlight options and the Blizzard silhouette and shape-language talks.
   - Deadlock team colors and art-style revision.
   - Pokemon UNITE team colors.
   - Dota 2 and Warcraft III slot color lists.
   - Okabe-Ito and Paul Tol palette details.
   - LoL camera FOV and pitch.
   - Blender add-on names.

---

## Sources

Confirmed via search snippets in sibling passes R02/R04/R05 (same date, same folder). This agent did not reopen them.

1. https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/
2. https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf
3. https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-1-creating-areas-of-focus/11614
4. https://www.vfxapprentice.com/blog/10-league-of-legends-vfx-design-tips
5. https://devtrackers.gg/leagueoflegends/p/668c1112-syndra-vfx-update-pre-pbe-preview
6. https://wiki.leagueoflegends.com/en-us/Life
7. https://support.riotgames.com/en-us/league-of-legends/gameplay/colorblind-mode
8. https://www.gamepressure.com/newsroom/lol-colorblind-mode-is-useles-for-players-suffering-from-actual-c/za2e03
9. https://dota2.fandom.com/wiki/Health
10. https://www.gamersunchained.com/news/health-bars-are-now-more-visible-in-dota-2-and-voting-opens-for-collectors-cache
11. https://forums.playdeadlock.com/threads/a11y-colorblind-setting-for-enemy-colors.10548/latest
12. https://mobalytics.gg/blog/lol-s13-must-have-settings/
13. https://lol.fandom.com/wiki/New_To_League/Understanding_the_Stream/The_Minimap
14. https://liquipedia.net/dota2/Minimap
15. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/CDOTABaseGameMode.SetCameraDistanceOverride
16. https://lensviewing.com/what-is-the-camera-angle-used-in-league-of-legends/ (low reliability; values treated as unverified)
17. https://danouellette.com/infinitecrisis
18. https://nexus.leagueoflegends.com/en-us/2016/12/the-visual-language-of-hextech
19. https://developer.valvesoftware.com/wiki/Panorama/Overview
20. https://fanstanza.gg/faelights-league-of-legends-explained/
21. https://www.nerfplz.com/2026/08/every-summoners-rift-objective.html
22. https://www.dexerto.com/league-of-legends/riot-confirms-plans-for-lol-shakeup-in-2027-with-new-visuals-client-3296182/
23. https://www.gamesradar.com/games/league-of-legends/league-of-legends-is-getting-a-new-client-entirely-new-visuals-and-a-bit-of-new-gameplay-in-a-massive-2027-update-reportedly-codenamed-league-next/
24. https://www.engadget.com/gaming/a-total-league-of-legends-revamp-is-coming-in-2027-130000644.html

**Attempted but not reached (egress blocked; not used as sources):**
- https://media.steampowered.com/apps/dota2/workshop/Dota2CharacterArtGuide.pdf
- https://steamcdn-a.akamaihd.net/apps/dota2/workshop/Dota2CharacterArtGuide.pdf
- https://en.wikipedia.org/wiki/Color_blindness

**Internal references:**
- `games/vale/_design/research/r02_match_rules_rift.md` (brush and vision rules)
- `games/vale/_design/research/r04_hud_camera_readability.md` (HUD, camera, colorblind, VFX)
- `games/vale/_design/research/r05_client_flow_menu_craft.md` (client visual language, Panorama, 2027 client)
- `games/dyefield/_spec/CONTRACT_FFA.md` (Forgeflow precedent: 8-color plus mark FFA palette with a colorblind hatch)
