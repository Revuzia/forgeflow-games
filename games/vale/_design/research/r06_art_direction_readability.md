# R06: Art Direction in Service of Readability

Gap-fill pass 2026-10-07: 40 searches, 29 claims verified, 7 corrected, 14 still unverified.

**Project:** VALE (Forgeflow Games), an original browser-based competitive lane-brawler (custom Three.js / WebGL2 client)
**Date:** 2026-10-07
**Primary reference:** League of Legends (LoL) as of 2026. **Secondary:** Dota 2. Comparisons: Overwatch, Deadlock, Pokemon UNITE, Heroes of the Storm, SMITE 2, Predecessor.

> **Method note. Read this before relying on anything below.**
> **First pass:** ran with **no web search budget**. The shared per-turn budget was used up by sibling agents, and direct fetches were blocked by the egress proxy (`media.steampowered.com`, `steamcdn-a.akamaihd.net`, `en.wikipedia.org`). Sources [1]-[24] were confirmed from search snippets by sibling passes R02, R04 and R05 on the same day.
>
> **Gap-fill pass (same day):** 40 web searches. Two fetches were tried and both were egress-blocked (`help.steampowered.com`, `www.surrenderat20.net`), so every new citation [25]-[64] rests on **search-result snippets**, not on reading the full page. Valve's Dota 2 Character Art Guide PDF itself was still not opened. Its principles below come from snippets of Valve's Steam Support page that hosts it, from CG Channel's 2012 summary, and from Polycount threads.
>
> Each claim falls into one of these classes:
> - **Cited [n]:** confirmed from search-result snippets (sibling passes for [1]-[24], this pass for [25]+).
> - **[unverified]:** recalled from memory or seen only in a low-reliability source. Re-check before it becomes spec. The remaining items are listed in section 11 (c) 7.
> - **Corrected in gap-fill:** the first pass said something different. The note says what changed.
> - ***Analysis:*** design reasoning or arithmetic. It is not a reported fact and needs no citation, but it should be tested.

---

## 0. Key takeaways

1. **Readability is a priority stack, and art direction decides who gets the contrast.** Shipped lane-brawlers give the most value contrast, saturation and detail to whatever the player must react to (threat VFX), then to champions, then to units, then to terrain that matters for play (walls, brush, lanes), and the least to decoration. Riot's public VFX style guide says it directly: an effect's visual impact should match its gameplay impact, and pure white is kept for the most important effects [1][2][4]. Riot's 2014 map rebuild did the same thing for terrain. It controlled color and level of detail, **clamped the environment's value range** and cut character occlusion, so the map would act as background during fights [30][31][32].
2. **The thing to dodge gets the highest contrast.** Within one effect, the part that carries danger (a missile's tip, an impact edge) is the primary element. Secondary elements use value and saturation to support it, not to compete with it [3][2][4]. Riot's smaller VFX updates mainly target spells whose hitbox is not clearly shown [33].
3. **Hue is a reserved resource.** Riot moved a champion's visual update away from red because red reads as enemy [5]. Team colors (self, ally, enemy) live in an overlay layer of bars, outlines and decals [6][12], not in the character's own palette. A friendly kit should never spend the hue that means "enemy".
4. **Silhouette and value come before color.** Valve's Dota 2 Character Art Guide is built on keeping each hero identifiable **from above, during gameplay** [26]. Its confirmed principles:
   - A hero's silhouette must be readable at first glance and should show which way the hero faces [26][27].
   - Heroes follow an overall **lighter-at-the-top, darker-at-the-bottom value gradient**. If the feet are as bright and intense as the head, the eye cannot split the figure up at a glance [26][27].
   - The palette should be coherent [25].
   - Small patches of detail that look good in a close-up profile view become hard to read in normal play. Detail is balanced against simple **areas of rest**, and assets are judged **in context** at the game camera [25][26].
   - Weapons need their own clear read but must support the hero's overall design [26].
   *(Corrected in gap-fill: the first pass said the guide puts saturation and detail "at the head and weapon". The snippets confirm the weapon read, the top-light value gradient and the rest-vs-detail rule, but none say "saturation at the head". That detail is still unverified.)* The reason all this matters: at about 100 px tall, only the big shapes and value groups survive.
5. **The environment is a stage, not a painting.** Riot's 2014 map update made this a stated goal. In a fight, the environment should sit behind the champions and effects so they stand out [30][32]. Overwatch's map team describes the same aim: maps are not meant to stand out, they give heroes ways to stand out, and a limited palette pushes artists to define areas through shape, material and landmarks [43]. Lanes as lighter, quieter paths and jungle as darker and busier remain *analysis* for Vale.
6. **Map visuals now carry live game state.** LoL's 2026 map changes its terrain theme after early dragons, and that change also decides where special glowing vision spots appear [20][21]. The art layer is part of the rules display.
7. **Friend and foe are shown redundantly, and the trend is player-chosen enemy color.**
   - LoL colors bars by relationship (self green, ally blue, enemy red) [6]. Its colorblind mode moves "self" to yellow [7], and players say that alone is not enough [8]. Riot's own stated goal for its 2013 health-bar rework was to identify self, ally and enemy instantly, and to move toward **one shared view for colorblind and non-colorblind players** [38].
   - Dota's colorblind mode turns own and allied bars blue, and a separate setting makes allied bars ocher while yours stays green [9][39].
   - Overwatch lets players pick enemy and friendly UI and outline colors separately from nine options [40].
   - Deadlock shipped an **Enemy UI Color** setting in its September 2026 update, after players had asked for one [11][49][50]. *(Updated in gap-fill: the first pass only knew of the request.)*
   - Lesson: never let hue be the only carrier of friend or foe, and give the enemy color to the player as a setting.
8. **UI art direction is a system with rules.** Riot built its client language on three shapes, each with one job (structure, guidance, focus). It was designed so new screens would not each need a dedicated artist [18]. A style bible is what makes that possible.
9. **Camera geometry sets the art budget.** Dota's default camera distance is 1134 units [15]. LoL's FOV and pitch still come only from one low-reliability source (about 40 degrees FOV, about 56 degrees pitch) [16]. Two more searches in this pass found no official or technical source **[still unverified]**. *Analysis* (section 5): with those values, a hero about 110 px tall at 1080p needs the camera at about 7.5 hero-heights from the hero. That puts on-screen detail at about 100 px per meter, which sets texel density, outline width and VFX scale.
10. **In FFA, color alone fails beyond about 8 players.** Warcraft III gave each of 12 lobby slots a fixed color and added 12 more colors when lobbies grew to 24 players in 2018 [60]. Dota 2 has per-player colors (custom games can set them by API) and a "Simple Colors" option that uses one color per team [61][14]. The best-known colorblind-safe categorical palette, Okabe-Ito, has 8 colors including black, and data-visualization guidance says more than about 8 colors can hardly be told apart [58][59]. Past that, add marks, patterns or numbers.

---

## 1. The readability problem, stated as a design rule

A lane-brawler screen at a teamfight can hold 10 heroes, 20 to 40 minions, several structures, a dozen overlapping ability effects, ground telegraphs, health bars and the HUD. The player has a fraction of a second to answer four questions in order:

1. **What will hurt me, and where, right now?** (telegraphs, projectiles, impact zones)
2. **Who is who?** (which hero, which team, how healthy)
3. **Where can I go?** (lanes, walls, brush, chokepoints)
4. **Where am I on the map?** (landmarks, team territory, minimap)

*Analysis:* every art decision in shipped games of this genre can be read as dividing a fixed **contrast budget** among those four questions. The environment gets the least. If every layer is "beautiful" at full contrast, nothing is readable. Riot's VFX guide makes this explicit for effects: its goals are gameplay clarity, minimal clutter, theme support, and surprise and delight, worked through gameplay, value, color, shape and timing [1][2][4]. Clarity comes first in that list. Delight only works inside the clarity budget. The 2014 Summoner's Rift update applied the same budget to the map, with "clarity and readability" first among its five goals [30][31].

**Practical form of the rule (*analysis*):** keep a written "value ladder" for the project:

| Layer | Value range (0 = black, 100 = white) | Saturation | Detail | Motion |
|---|---|---|---|---|
| Top-tier threat VFX (ultimates, executes) | Can reach 100 (pure white is reserved) | High at focus | High at focus | Fast, readable timing |
| Normal ability VFX | 40 to 90 | Medium-high at focus, low at trails | Concentrated at the dangerous edge | Short |
| Heroes | Full range; darkest at feet, lightest at head | Highest at focal areas | Big shapes and areas of rest; detail placed with intent | Readable anticipation |
| Minions / neutral units | Narrower than heroes | Lower than heroes | Low | Simple loops |
| Gameplay terrain (lanes, walls, brush) | 25 to 70 (clamped) | Low to medium | Low on paths, medium off-path | Static, or a slow sway for brush |
| Decoration / out-of-bounds | 15 to 60, compressed | Low | Free, but not noisy at gameplay zoom | Very slow ambient |

The numbers are a starting proposal for Vale, not reported values from any game. Riot reports clamping the map's value range in 2014 but did not publish the numbers [30][32].

---

## 2. League of Legends

### 2.1 VFX style guide (2017, public)

- **Authorship and frame:** the guide was written and designed by Riot art director Jin Ho Yang [4]. It is organized around gameplay, value, color, shape and timing [4].
- **Four goals:** gameplay clarity, minimal clutter, theme support, and surprise and delight [1][2][4].
- **Importance scoring:** visual impact should match gameplay impact. A basic attack should not look as big as an ultimate. Pure white is held back for the most important and most damaging effects [2][4]. *Principle:* brightness is a currency. If every spell spends it, it buys nothing.
- **Area of focus:** each effect has primary and secondary elements. A missile's head or an impact edge gets the strongest contrast, saturation and detail. Tails and ambient particles use their value and saturation to support the primary element [3][4].
- **Hue discipline:** during a champion's visual update, Riot moved effects away from red because red carries enemy meaning [5]. *Principle:* reserve a small set of hues for system meanings (enemy, self, damage types) and keep cosmetic kits out of them.
- **Update tiers:** Riot runs small VFX-only updates whose main aim is gameplay clarity, especially for spells that do not show their hitbox clearly, without changing the champion's art direction [33]. Full Visual and Gameplay Updates (VGUs) rebuild both look and kit [34]. *Principle:* "the hitbox is not readable" is reason enough to change art.

### 2.2 Relationship colors, outlines and bars

- Health bars are colored by relationship: self green, allies blue, enemies red [6]. Colorblind mode changes self to yellow and leaves blue and red in place [7]. Critics say this does too little for people with real color-vision deficiency [8].
- **Bar design goals (2013):** Riot's health-bar rework aimed for instant identification of self, ally and enemy, raising the most vital information, and moving toward one view shared by colorblind and non-colorblind players [38]. Tests in the same year added heavier tick marks at 1,000 HP to help read high-HP champions [38][39a]. *Principle:* a CVD-safe default beats a separate colorblind mode.
- Hovering over an enemy draws a red outline around it [12]. *Principle:* outlines are a selective, on-demand layer for targeting, not a permanent cel-shading style. That keeps the base image clean.
- Champion models themselves are not team-tinted. Team identity comes from bars, outlines, the minimap and some team-colored ability decals **[unverified: no search was spent on this; which abilities is unknown]**. *Principle:* identity (who) belongs to the model. Allegiance (whose side) belongs to the overlay. This separation is also what makes paid cosmetics safe for competitive readability.

### 2.3 Champion texture style

- **Hand-painted, light baked in:** LoL champions are not lit by the surrounding environment at runtime, so artists bake roughly top-down lighting into the color texture and paint over it. Most of what players see comes from the texture itself [36][37]. A Riot art-contest brief asked for no normal maps, diffuse-only textures, and all AO, colored light and GI painted or baked into the diffuse [36a]. *(Was [unverified]; now cited. Newer champions and skins may use more maps. Not checked.)*
- *Analysis:* the top-down baked light gives the same lighter-top, darker-bottom value gradient that Valve asks for in Dota (section 3.1). Two studios reached one rule.

### 2.4 Visual updates and the 2014 map rebuild

- **Visual Updates and VGUs:** Riot uses VGUs for full look-and-kit rebuilds, while smaller updates modernize visuals and keep the kit [34][33]. Pure visual reworks keep the champion's kit and core identity (Lee Sin's rework is one reported example) [34]. *(Was [unverified]; now cited.)*
- **The 2014 Summoner's Rift update** rebuilt the map's art while keeping its gameplay. Confirmed details [30][31][32]:
  - **Five goals:** clarity and readability, visual fidelity, gameplay, thematic cohesion, and performance.
  - **Environment as background:** in fights, the map should recede so champions and effects pop. The team controlled color and level of detail, clamped value ranges and reduced how often terrain hides characters.
  - **Gameplay kept identical:** flashable walls, turret ranges, lane sizes, brush interaction and ward spots stayed the same. Preserving the navigation mesh was the first design priority.
  - **Readability fixes in play:** a more accurate nav mesh so players can see where paths end and walls begin; clearer particle hits for last-hitting; clearer minion attack animations.
  - **Dashable walls made visible:** base walls were standardized as thin and dashable near turrets and thicker between turrets, so short-dash champions can tell which walls they can cross.
  - *(Corrected in gap-fill: the first pass recalled "cleaner, more consistent edges for walls and brush". The confirmed version is the nav-mesh accuracy and the thin-vs-thick wall standard above. The first pass's "environmental storytelling kept outside the play space" was not found in any snippet and is removed.)*
- *Analysis:* the lasting lesson is that **map art is a gameplay UI**. A wall edge you can't read is a balance problem, not a cosmetic one. Riot proved that a full art rebuild can leave geometry untouched.

### 2.5 2026 and the road to 2027

- **Map as state display:** in 2026 the map's terrain changes element after early dragons, and that change also decides which special vision spots appear [21][20]. Those spots are fixed glowing points on the map. Warding one extends vision for a while [20]. *Principle:* if terrain changes mid-match, the change must be readable as a rule ("this area now works differently"), not only as a mood.
- **2027 overhaul:** Riot has confirmed a full visual overhaul of the map as part of a larger 2027 update that also includes a new client [22][23][24]. *Implication:* even the genre leader treats its 2014-era art as due for replacement. Vale's art direction should plan for a full visual refresh over the game's lifetime, by keeping gameplay geometry and visual skin as separate data.

---

## 3. Dota 2

### 3.1 Character Art Guide (Valve, public, written for Workshop artists)

Valve released the 18-page guide in June 2012. It covers a clear silhouette, value patterning and a coherent color palette, ideas of rest and detail, and evaluating assets in context, with before-and-after examples from Valve's own heroes [25]. The PDF itself was still not opened (two hosts and the Steam Support page were egress-blocked). Everything below comes from search snippets of the Steam Support page, CG Channel and Polycount.

- **Readable from the game camera first.** The principles exist to keep each hero immediately and uniquely identifiable **from above during gameplay** [26]. Small patches of detail can look fine in a profile view but become hard to read in normal play. Where detail goes, and at what value and contrast, is a key decision for any item [26]. Assets are judged in context [25]. *(Was [unverified]; now cited.)*
- **Silhouette:** a hero's silhouette must be clearly identifiable at first glance, and it should show the hero's orientation [26][27]. Weapons need a unique read but should support the character's design. Simple areas of rest balance complicated shapes elsewhere [26]. *(Was [unverified]; now cited. The first pass's wording about items not blurring "wings or head shape" is not in any snippet; treat those examples as illustration.)*
- **Value pattern, lighter at the top, darker at the bottom:** Dota heroes have an overall top-light, bottom-dark gradient. If the feet are as bright and intense as the head, the figure is hard for the eye to break apart at a glance [26][27]. *(Corrected in gap-fill: the first pass gave three reasons. The confirmed reason is the one above, readability at a glance. "It separates the hero from the ground" and "it copies light from above" are reasonable *analysis* but are not confirmed as Valve's reasoning.)*
- **Color and saturation:** the guide asks for a coherent palette [25]. Polycount snippets describe Dota's palette as bright and intense, with many saturated colors, and treat saturation as a final adjustment pass along with the value gradient [27]. Whether the guide places saturation at the head specifically is **[still unverified]**.
- **Detail density:** rest vs detail is a named topic of the guide [25][26]. Paint broad shapes with intentional detail patches, not uniform detail everywhere.
- **Texture painting under a custom shader:** Valve's character texture guide says Dota's in-game lighting is subtle, so sculpted detail gets lost in normal maps, and light is baked or painted into the color texture instead (for example, an AO bake multiplied over the base color, plus a light-map pass) [28]. Dota's hero shader reads two mask textures (Mask1, Mask2) on top of the color map. Pipeline outputs include metalness, self-illumination (emissive), specular, gloss, detail, Fresnel, rim light and specular tint [28][29]. *(Was [unverified]; now cited. The exact channel-per-mask layout is still unverified.)*
- **Team identity is not in the model.** Like LoL, Dota heroes keep their colors on either team. Allegiance appears in bars, the top bar and the minimap **[still unverified as a stated rule; consistent with the Health and Minimap pages [9][14]]**.

### 3.2 Environment and map

- **Two territories, two looks [partly verified]:** the Radiant side has a bright, natural theme, and each side uses its own tree set (eight bamboo, oak and pine types on the Radiant side, three on the Dire side) [57]. The Dire side's "dark and blighted" look was not confirmed in a snippet. *Principle:* make each team's territory recognizable from a 200 px crop of the screen.
- **Terrain skins:** Dota has alternate full-map terrains: Desert Terrain, Immortal Gardens, Sanctums of the Divine, Reef's Edge, Emerald Abyss and Overgrown Empire, which were Battle Pass rewards from TI5 to TI9, plus four seasonal terrains for Dota Plus subscribers [56]. Immortal Gardens even adds a built-in weather effect (falling petals) [56]. *(Corrected in gap-fill: the first pass said "sold or awarded". They were Battle Pass rewards and subscription perks, not direct sales.)* *Principle:* when gameplay geometry is separate from surface theming, cosmetic map variants become possible without balance risk. This only works if every theme keeps the same value relationships: path lighter than off-path, trees clearly blocking, cliff tops readable (*analysis*).
- **Minimap abstraction:** by default Dota draws heroes on the minimap as abstract markers, with options to show portraits or names [14]. A guide site says Radiant and Dire markers also differ in shape (teardrops vs arrows) [62] **[low reliability]**. LoL draws portraits on the minimap, uses team-colored ward icons whose shape shows the ward type, and removes towers as they die [13]. *Principle:* the minimap is a separate art style, a schematic rather than a shrunk-down render.
- **Team colors:** Radiant is green and Dire is red in Dota's team-color scheme [62a].
- **Camera:** Dota's default camera distance is 1134 units, the value custom games override [15].

---

## 4. Overwatch, Deadlock and others: readability lessons

- **Overwatch** (the strongest reference for team-color highlighting in a fast game):
  - Players can set enemy and friendly UI colors separately, covering nameplates, HUD, health bars and hero outlines, from nine colorblind-friendly options. These settings do not recolor ability effects [40]. *(Was [unverified]; now cited. The default red-enemy, blue-ally scheme was not re-checked.)*
  - Overwatch's art leads (Bill Petras, Arnold Tsang) presented readability as the base of hero design at GDC 2017, with a vibrant palette and shape language built from familiar shapes such as squares and circles [41][42]. *(Partly verified. The specific mapping "blocky tanks, angular damage, round supports" is **[still unverified]** as a Blizzard statement.)*
  - Map design aims to let heroes stand out rather than make the environment stand out. A limited color palette pushes artists to define areas by shape language, materials and distinct landmarks [43]. *(Was [unverified]; now cited.)*
  - A counterpoint from an art-direction comparison: several Overwatch heroes do not keep a strict light-to-dark value hierarchy, and lean on bright color and lighting instead [44]. *Lesson for Vale:* a top-down camera at about 100 px cannot afford that. Keep the value rule.
  - Many ultimates play a **different voice line** to allies and to enemies, often in the hero's native language for one side [45]. *(Corrected in gap-fill: the first pass said the enemy version is "louder, more alarming". The confirmed fact is only that the line differs by relationship.)*
- **Deadlock:**
  - The teams are the Sapphire Flame and the Amber Hand [52]. Their exact UI hues were not checked **[unverified]**.
  - Readability options: earlier, the only colorblind setting was reticle color [51]. The **City Never Sleeps** update (29 September 2026) added an accessibility section with an **Enemy UI Color** setting. Enemy trooper health bars follow the chosen color, and a separate "enemy damaged" bar color (yellow by default) was added [49][50]. This answers the player request in [11]. *(Updated in gap-fill.)*
  - **Art style revised in public:** in October 2024 Valve changed how heroes are rendered to a brighter, more stylized look to improve visibility [46]. The August 2025 "Old Gods, New Blood" update overhauled the whole map, the Patrons and the creeps in a new style [47][48]. One report says the map now splits into industrial red brick on one side and white marble on the other, which helps orientation in fights [48] **[single secondary source]**. *(Was [unverified]; now cited.)* *Lesson:* even teams with strong art direction iterate on readability in public tests. Plan for at least one readability pass after real play data.
- **Pokemon UNITE:** the two teams are the **purple team and the orange team** [53]. *(Corrected in gap-fill: the first pass said your own team is always one color family and opponents a contrasting warm one. The confirmed fact is two fixed team colors, purple and orange. Whether the UI remaps them by relationship was not checked **[unverified]**.)*
- **Heroes of the Storm:** battlegrounds range widely in theme across Blizzard's universes [no reliable snippet]. The claim that all of them share one gameplay grammar (paths, walls, objectives, team-colored structures) is **[still unverified]**. *Principle (analysis):* consistent gameplay grammar across many visual themes.
- **SMITE 2 / Predecessor:** SMITE 2 is built on Unreal Engine 5 (the original ran on Unreal Engine 3) and keeps a stylized look [54]. Predecessor moved to Unreal Engine 5 to future-proof a game it expects to run for a decade [55]. *(Engine move now cited. "Stylized PBR" as their material approach, and the claim that third-person readability leans more on outlines, are **[still unverified]**.)*

---

## 5. Camera, character size, lighting and grading

### 5.1 How tall is a hero on screen? (*analysis* plus formula)

Reported values:

- Dota default camera distance: 1134 units [15].
- LoL: FOV about 40 degrees, pitch about 56 degrees below horizontal, from a low-reliability source [16] **[still unverified after two more searches]**.

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

- **Silhouette budget.** At about 100 px tall, a hero's head is about 12 to 15 px across. Facial detail is invisible, and only head shape, shoulders, weapon and a few value groups read. This is why the genre paints big shapes, uses areas of rest, and keeps the top of the figure lightest [26][27].
- **Browser reality.** Vale runs in a browser, often windowed or on 720p and 768p laptops. Readability must be signed off at the **smallest supported viewport**, where the same hero may be only 60 to 75 px tall.
- **Texel density.** At about 100 screen px per meter, hero textures need roughly 1 to 2 texels per screen pixel at max zoom, so about 100 to 200 texels per meter. More than that only costs memory and causes shimmering. Use mipmaps and anisotropic filtering on the tilted ground plane.
- **Outline width.** A 1 px outline on a 110 px hero is about 1% of its height, which is readable. A 3 px outline starts to look like a cel-shaded style choice. Width should be set in screen pixels (DPI-aware), not world units.

### 5.2 Lighting characters vs environment

- **Painted light, simple runtime light.** LoL champions get no environment lighting at runtime. Roughly top-down light is baked and painted into the color texture [36][37]. Dota's subtle in-game lighting likewise leads Valve to have artists bake or paint light into the color map, with rim, specular and self-illumination driven by masks [28][29]. Both approaches favor **authored control over physical accuracy**. *(Was [unverified]; now cited.)*
- **Separate light rigs (*analysis*).** Lighting heroes with a dedicated key, fill and rim, separate from the environment's light, lets the map be moody while heroes keep their readable value pattern. In Three.js this can be a second light set on a layer or a per-material uniform. A camera-relative rim (a Fresnel term) gives "free" separation from the ground at any map position. Dota's shader exposes rim light and Fresnel as painted masks for the same reason [28][29].
- **Contact shadows (*analysis*).** A soft, dark ground disc or projected blob under each unit anchors it to the painted ground and shows the footprint. That matters for hitbox reading and skillshot dodging. Full dynamic shadows are optional at quality tiers. The contact shadow should not be.
- **Color grading and fog.** Fog of war, which darkens and desaturates areas your team cannot see, is both a gameplay layer and a grading layer [13]. Riot listed fog-of-war work among the 2014 map's performance changes [30]. Seen areas should be at full brightness and unseen areas clearly compressed. *Analysis:* avoid atmospheric distance fog in a top-down MOBA. The whole play area sits at about the same camera distance, so depth fog adds murk without adding information.
- **Sky.** At a 50 to 60 degree pitch the sky is mostly off-screen [16]. Sky work in this genre goes into reflections, ambient tint and the lobby or loading presentation, not into the match view (*analysis*).

---

## 6. Map readability

### 6.1 Lanes, jungle, walls and brush

*Analysis*, grounded where noted in the confirmed 2014 Summoner's Rift goals [30][31][32]:

- **Lanes:** a lighter, smoother, lower-detail surface (worn path, paving) running clearly from base to base. Lanes are where most of the fighting happens, so the ground there must be the quietest backdrop. A light path also makes dark-footed heroes pop, which is the Dota value pattern [26][27] working with the map.
- **Jungle:** darker and more textured than lanes, but still below the characters' contrast (the clamped environment value range [30]). Camp clearings should be lighter "rooms" inside the darker jungle, so you can tell where fights happen.
- **Walls and cliffs:** read through a **lit top and a dark face**, with a clean, continuous edge line. The exact walkable boundary must be visible, because dashes and blinks depend on it. Riot fixed this in 2014 by making the nav mesh match the visible walls, and by standardizing wall thickness so dashable walls look different from non-dashable ones [30]. Keep decoration on top of walls, never on the edge line.
- **Brush (concealment):**
  - Units in brush are hidden from enemies outside it and count as in fog of war until something grants sight there, such as a ward. Enemies outside cannot target them. Brush is concealment, not stealth. Models of units inside brush are drawn semi-transparent [35]. *(Was [unverified per R02]; now cited.)*
  - Readability needs: a distinct hue or texture clump with a clear outer boundary; a visible state change when you or an ally is inside (semi-transparent model, as LoL does [35], plus optionally a tint); and a gentle animated "rustle" when something enters, if Vale chooses to give that information away. That is a design decision, not an art one.
- **River or divider:** a cool, horizontal band between halves gives instant "which half am I on" information and a natural place for objectives (*analysis*).

### 6.2 Landmarks and orientation

- **Every region needs one unique silhouette prop** visible at gameplay zoom: a broken statue, a big tree, a crystal. Players then learn locations by name ("fight at the statue"), which also helps comms (*analysis*). Overwatch's map team uses distinct landmarks for the same reason [43].
- **Objective pits** should be the most distinctive architecture outside the bases. The LoL 2026 glowing vision spots show that map points can carry rules as well as art [20].
- **Camera symmetry:** an angled camera sees more ground in some directions than others. One shipped-MOBA level designer describes aligning lanes with the camera rotation and centering objectives so neither team gets a geometric edge [17]. Art should not break that symmetry, for example by placing tall foreground props that hide units only on one team's side. Riot's 2014 goal of reducing character occlusion [30][32] is the same concern.

### 6.3 Team territory and base identity

- **Two-axis identity:** each team's base should differ in **color temperature** (cool vs warm) and in **architecture shape language** (for example, rounded and organic vs angular and crystalline). That way it still reads under color-vision deficiency and in grayscale (*analysis*). References: Dota's Radiant side is bright and natural and each side has its own tree set [57]; Deadlock's 2025 map reportedly splits into red brick vs white marble halves, which is a value and material split, not just a hue split [48].
- **Structures carry team color as an accent**, in banners, crystals or lights, while their massing carries team architecture. The team color can then swap to the viewer's relationship colors (ally or enemy) in an option, without remodeling (*analysis*).

### 6.4 Minimap art

- Use a schematic style with flat terrain colors, lanes as light strokes, team territories tinted, and icons that use **shape for type and color for team** (LoL's ward icons do this [13]).
- Heroes should appear as portrait or marker with heading. Dota's abstract-marker default [14] stays readable with 10 overlapping heroes, which portraits do not always do. LoL's overlapping portraits can hide each other [13].

---

## 7. UI art direction and the style bible

### 7.1 What shipped clients do

- **Riot's client language:**
  - It frames the client as a Hextech tool the player uses to reach the game's world [18].
  - It uses three shapes, each with one job: a square for structure, a diamond to guide the eye to key information, and a circle for primary items that need action [18].
  - It was designed to scale across features and media without a dedicated visual artist on every team, which Riot saw as a bottleneck [18].
  - *Principle:* ornament is allowed only where it marks hierarchy.
- **Riot's bar language:** the 2013 health-bar goals (instant self/ally/enemy identification, raise vital information, one view for colorblind and non-colorblind players) [38] are a compact style-bible rule for any status widget.
- **Dota 2's Panorama:** Valve's UI framework authors layout, style and behavior like a web stack and can place 3D models and particles inside the UI [19]. *Principle:* the UI can show live game assets (heroes, effects) instead of flat renders, which keeps the client and the match visually continuous. That is directly relevant to a browser game, where menu and match share one WebGL context.
- **Deadlock's HUD** was rebuilt in the September 2026 update alongside the new accessibility section [49][50]. *Lesson:* HUD art and accessibility settings ship together.
- **Gilded vs flat [still unverified as a trend claim]:** the genre's older UIs used heavy metallic frames and gradients. Recent updates seem to lean toward flatter panels with fewer, sharper accents, keeping ornament for rarity and prestige (ranked borders, premium cosmetics). *Analysis:* ornament level works best as a **ranked scale with meaning**: plain, then trimmed, then gilded, mapped to importance or rarity. Decoration alone is not a reason for it.

### 7.2 What a style bible should contain (*analysis*, standard practice)

1. **Purpose statement and pillars** (for example, "readable in 200 ms, then beautiful").
2. **Color tokens:**
   - Reserved system hues (self, ally, enemy, damage types, rarity tiers).
   - Neutral ramps for panels.
   - Light and dark values for every token.
   - CVD test results for each pair that carries meaning.
   - A player-settable enemy color [40][49].
3. **Type scale:** one display face and one text face (licensed or open-source, chosen for Vale), sizes at 720p and 1080p, a minimum size floor, and number styling (tabular figures for timers and gold).
4. **Shape language:** which shapes mean what (container, call to action, alert), corner radii, frame tiers.
5. **Iconography grid:** pixel grid, stroke weight, silhouette-first rule, team and type redundancy rules.
6. **Motion tokens:** durations and easings (R05 covers this).
7. **In-world art rules:**
   - The value ladder from section 1.
   - Hero value pattern, silhouette and rest-vs-detail tests.
   - The VFX importance scale and hue reservations.
   - Texel density targets.
   - Outline rules.
8. **Do and don't sheets** with screenshot pairs, and a **checklist for every new asset**: grayscale test, silhouette test, CVD test, test at the minimum viewport, and review in context at the game camera [25].

---

## 8. Stylized PBR, texel density and shape language

- **Stylized PBR [still unverified for the specific games]:** recent genre titles on modern engines (SMITE 2 and Predecessor are both on Unreal Engine 5 [54][55]) are assumed to use physically based materials with painted, simplified albedo. LoL's classic approach (diffuse-only, baked light [36][37]) and Dota's (painted color plus masks [28][29]) are closer to "hand-painted with helper masks". *Analysis for Vale:*
  - A good middle ground is **hand-painted albedo with light painted in only lightly** (ambient occlusion and soft gradients, no hard cast shadows), plus a simple roughness/metal map, under a fixed, authored key light. Valve's texture guide recommends a similar AO-over-color bake [28].
  - Add a Fresnel rim and contact shadows on top.
  - This keeps the painted look under dynamic lights and is cheap in WebGL2.
- **Texel density (*analysis*):** pick one world density per class. For example, heroes about 160 to 256 px/m, environment about 100 to 160 px/m, and props near the lanes matched to the environment. Enforce it with a checker in the asset pipeline. Uneven density is a common sign of amateur art (an internal Forgeflow audit in another project found it the most visible tell).
- **Shape language for role readability:**
  - Overwatch's art leads confirm shape language from familiar shapes (squares, circles) as a core tool [41]. The specific mapping below is standard character-design theory **[unverified as a reported genre rule]**:
  - Round shapes read as friendly, supportive or soft.
  - Square or blocky shapes read as sturdy and defensive (tanks).
  - Triangular, angular shapes read as dangerous or fast (assassins, damage).
  - Shipped hero rosters use this as a strong default, not an absolute rule. *Analysis:* encode role mainly in the silhouette's **mass distribution** (top-heavy vs bottom-heavy, wide vs narrow), because that survives at 100 px better than surface detail.

---

## 9. FFA ("Fray") player colors for 6 to 10 players

- **Slot colors in shipped games:**
  - Warcraft III gave each of its 12 lobby slots a fixed color. Patch 1.29 (2018) raised lobbies to 24 players and added 12 more colors (maroon, navy, turquoise, violet, wheat, peach, mint, lavender, coal, snow, emerald, peanut) [60]. *(Corrected in gap-fill: the first pass said "up to 12". The current count is 24.)* *Analysis:* several of those added names (wheat/peach, mint/emerald, coal/navy) suggest pairs that are hard to tell apart even with normal vision, which shows why a large slot palette needs a second code.
  - Dota 2 has per-player colors: custom games can set them by API, and the lobby assigns colors by slot position. A "Simple Colors" option collapses them to one color per team [61][62]. The exact 10-color list is **[still unverified]**.
  - Fixed slot colors help with match-long tracking, but many pairs are hard to tell apart under color-vision deficiency (*analysis*).
- **Accessible palettes:** Okabe and Ito's Color Universal Design palette has 8 colors (orange, sky blue, bluish green, yellow, blue, vermillion, reddish purple, black), chosen to stay distinct for colorblind and non-colorblind viewers. It is also known as the Wong palette after a 2011 Nature Methods column [58][59]. Paul Tol's schemes are reported to go up to about 12 categorical colors [59], but guidance in the same sources says more than about 8 colors can hardly be told apart [58]. *(Was [unverified]; now cited. Tol's exact scheme sizes were not checked.)*
- **What works (*analysis*):**
  1. **Reserve "self" as a fixed hue** that never appears in the opponent palette, the way LoL keeps self apart from allies and enemies [6][7].
  2. **Use about 8 opponent hues spread in lightness as well as hue.** Pairs that collide under deuteranopia or protanopia (red vs green, green vs brown, blue vs purple) must also differ by at least about 25 to 30 L* (lightness).
  3. **Make every color double-coded** with a **mark** (a simple glyph shown on the overhead bar, the minimap icon and the kill feed) and optionally a **pattern** on ground decals.
     - Forgeflow's own Dyefield FFA spec already does this: 8 crews, each with a color plus a mark, and a hatch pattern in colorblind mode (internal: `games/dyefield/_spec/CONTRACT_FFA.md`).
  4. **Give players options:** "enemy color" and "self color" overrides (now shipped in Overwatch and Deadlock [40][49]), plus a high-visibility bar mode [10], plus a "simple colors" switch that collapses slot colors into self vs others, like Dota's [62].
  5. **Test** with CVD simulation (deuteranopia, protanopia, tritanopia, achromatopsia) on real match screenshots, not on swatches, because ground color changes how bars and marks are perceived.

---

## 10. Using Blender for Vale (the studio has Blender)

*Analysis / practical.*

- **Readability test scene:**
  - Build a lane segment, a jungle corner and a wall at true scale.
  - Put a camera at the candidate FOV, pitch and distance from section 5.1, and render at 1280x720 and 1920x1080.
  - Do the hero pixel-height and texel-density sign-off here before anything goes into Three.js.
- **Silhouette pass:** render heroes as flat black on white (holdout or emission-only material) at gameplay framing. Line up the whole roster. Two heroes that can be confused in this pass will be confused in play. Also check that each silhouette shows which way the hero faces [26].
- **Value pass:** render in grayscale (view transform or a compositor desaturate) to check the dark-feet, light-head ladder [26][27] and the hero vs terrain separation.
- **Hand-painted plus light PBR workflow:** paint albedo in Blender's texture paint mode or an external painter. Bake ambient occlusion and soft gradients into albedo at low strength (Valve's guide multiplies an AO bake over the color [28]), and export glTF 2.0 for Three.js.
- **Texel density:** use the free, GPL **Texel Density Checker** add-on by Ivan Vostrikov. It is on the official Blender Extensions site for Blender 4.2 and later, and it can measure density per texture size, rescale UVs to a target density, copy density between objects and show density as vertex colors [63][64]. *(Was [unverified]; now cited.)*
- **Minimap and indicators:** author minimap icon silhouettes and ground-indicator meshes (rings, cones, lines) as simple geometry, consistent with R04's recommendation.

---

## 11. Implications for Vale

### (a) Principles and systems worth adopting, in Vale's own form

1. **A written contrast and value ladder** (section 1). Threat VFX are on top, then heroes, minions, gameplay terrain and decoration. Pure white is reserved for top-tier threats [2][4]. **Clamp the terrain value range** so the map acts as background in fights, as Riot did in 2014 [30][32].
2. **VFX importance scoring per ability**, with brightness and saturation capped by the score, a clear primary element at the dangerous edge, and secondary elements that support it [2][3][4]. Any ability whose hitbox is not readable gets a VFX fix, as in Riot's clarity updates [33].
3. **Reserved system hues** (self, ally, enemy, damage types). Cosmetic and friendly kits may not use the enemy hue [5].
4. **Identity in the model, allegiance in the overlay:**
   - Heroes look the same on both teams.
   - Team shows in bars, outlines, decals and the minimap [6][12].
   - Outlines appear on hover or target, not as a permanent style.
5. **Hero art rules** (now grounded in the Dota guide [25][26][27]):
   - Silhouette-first, readable from the game camera, and showing facing direction.
   - Lighter-top, darker-bottom value gradient.
   - Simple areas of rest balance a few intentional detail patches. No uniform fine detail.
   - Weapons get their own clear read.
   - Shape language set by mass distribution.
   - Every asset is reviewed in context at the game camera and signed off at the smallest supported viewport.
6. **Separate hero lighting** (authored key and rim), plus **mandatory contact shadows** at every quality tier. Paint soft light and AO into albedo, as both LoL and Dota do [28][36][37].
7. **Environment as stage:**
   - Light, quiet lanes; darker jungle with lighter camp clearings.
   - Walls with lit tops, dark faces and clean edges. The nav mesh must match the visible wall, and dashable walls must look different from non-dashable ones [30].
   - Brush with clear boundaries and an "inside" state (semi-transparent units, as in LoL [35]).
   - One landmark silhouette per region [43].
   - Minimize terrain that hides characters [30][32].
8. **Two-axis team territory:** color temperature plus architecture shape and material (Deadlock's brick vs marble is a reported example [48]), so it reads in grayscale and under CVD.
9. **Gameplay geometry separate from surface theme,** so maps can be reskinned or refreshed without balance risk. Riot rebuilt the 2014 map's art without changing walls, ranges or brush [30][31]. Dota ships whole-map terrain skins [56]. LoL is replacing its map art again for 2027 [22][23].
10. **Visible map state:** if terrain changes mid-match, the change must read as a rule [20][21].
11. **Schematic minimap:** shape for type, color for team, heading markers for heroes [13][14].
12. **UI built as a system:**
    - A small set of shapes, each with one job [18].
    - An ornament scale tied to meaning.
    - Live 3D assets in menus where cheap, since a browser game shares one WebGL context [19].
    - Status bars designed for instant self/ally/enemy identification, with **one default view that already works for colorblind players** rather than relying on a separate mode [38].
13. **Player-set enemy color** is now standard (Overwatch, Deadlock 2026) [40][49]. Vale should ship it at launch for bars, outlines and minimap, along with a high-visibility bar option [10] and an ally-bar variant [9][39].
14. **Friend/foe variants beyond color:** consider different ultimate cues (voice or sound) for ally and enemy casts, as Overwatch does [45]. Hand this to the audio note (R07).
15. **FFA palette:**
    - A fixed self hue plus about 8 opponent hues spread in lightness; 8 is the practical ceiling for hue alone [58].
    - Every color double-coded with a mark.
    - Self and enemy color overrides, a "simple colors" switch, plus high-visibility bars [7][9][10][11][49][62].
16. **A style bible** (section 7.2) with a per-asset checklist: grayscale, silhouette, rest-vs-detail, CVD and minimum-viewport tests, reviewed in context.
17. **Blender test scenes** (section 10) as the sign-off gate before assets enter the Three.js client, with Texel Density Checker [63] in the pipeline.
18. **Plan a public readability revision.** Deadlock changed its hero rendering for visibility and then overhauled its whole map style during testing [46][47]. Vale should budget for at least one art-readability pass after real play data.

### (b) Protected expression that must NOT be copied

- **Champion and hero designs:** names, faces, costumes, signature weapons, silhouettes recognizable as specific characters, color schemes tied to a specific character, and animation sets.
- **Map art and layout as composition:**
  - LoL's and Dota's exact map geometry, brush placement, wall shapes, river shape and pit designs.
  - Dota's specific Radiant and Dire visual themes as rendered, and its named terrain skins.
  - Deadlock's specific district and architecture designs.
  - Specific landmark props.
- **Named systems and assets:** the names of LoL's elemental terrain variants, its glowing vision spots, team names (Radiant, Dire, Order, Chaos, Sapphire Flame, Amber Hand), objective and Patron names, and update names.
- **UI expression:** Riot's gold-and-dark-blue client look, its specific diamond and circle motifs as drawn, frame art, Dota's Panorama layouts as composed, fonts, icons, ward and ping glyphs, minimap icon art, and rank borders.
- **Exact palettes:** specific hex values from any game's team colors, slot colors or UI, and Warcraft III's or Dota's slot color lists as a set. Pick Vale's palette independently and validate it for CVD. Generic hue families (for example, "cool vs warm") are fine. Public-domain research palettes such as Okabe-Ito may be used as a starting point, but Vale's final values should be tuned for its own ground colors.
- **Shader look-alikes:** do not reproduce a specific game's signature rendering combination so closely that a screenshot reads as that game.
- **Text from guides:** the Dota Character Art Guide, Valve's texture guide and Riot's VFX guide are reference for principles only. Do not paste their text or diagrams into Vale's style bible.
- **Voice-line conventions are fine; lines are not:** ally/enemy cue variants are a free mechanic. Specific lines are protected.

### (c) Open questions

1. **Camera numbers:** confirm θ, φ and D through Blender framing tests and a Three.js prototype. LoL's published numbers are still unconfirmed [16], so Vale's own tests decide. Decide the target hero height at 1080p (proposal: about 110 px) and the minimum supported viewport (720p?).
2. **Outline policy:** hover-only outlines (the LoL model) vs persistent enemy highlights (the hero-shooter model, with player-chosen color [40]). A top-down camera probably needs less, but FFA may need more.
3. **Brush disclosure:** does Vale give a visual "rustle" when an unseen enemy enters brush? This is a design decision with art consequences.
4. **Team color model:** absolute team colors (each team has a fixed color, as in Pokemon UNITE's purple and orange [53] and Dota's green and red [62a]) vs relationship colors (ally or enemy from the viewer's side, as LoL's bars do [6])? Base architecture is absolute. Vale needs a rule for which elements switch.
5. **Stylized PBR depth:** how much light to paint into albedo vs leave to runtime? LoL and Dota both bake light in [28][36]. Heavier baking blocks a later day/night or weather system, though Dota's Immortal Gardens shows weather can be part of a terrain skin [56].
6. **FFA scale:** 6, 8 or 10 players? Above 8, a mark system is mandatory and slot colors should be shown alongside numbers [58].
7. **Remaining re-verification backlog** (14 items still unverified after this pass):
   - LoL camera FOV and pitch (only a low-reliability source [16]).
   - Dota guide: whether saturation is focused at the head specifically.
   - Dota guide: exact Mask1/Mask2 channel layout.
   - Dota: the Dire side's look ("dark and blighted").
   - Dota: exact 10-slot player color list.
   - Dota and LoL: team identity kept out of models as a stated rule; which LoL ability decals are team-colored.
   - Overwatch: default enemy/ally outline colors.
   - Overwatch/Blizzard: role-to-shape mapping (tank/damage/support).
   - Deadlock: team UI hues.
   - Pokemon UNITE: whether team colors remap by relationship.
   - Heroes of the Storm: shared gameplay grammar across battlegrounds.
   - SMITE 2 and Predecessor: stylized PBR material approach and outline reliance.
   - The "gilded to flat" UI trend.
   - Paul Tol scheme sizes.

---

## Sources

**[1]-[24]:** confirmed via search snippets in sibling passes R02/R04/R05 (same date, same folder). This agent did not reopen them.

1. https://nexus.leagueoflegends.com/en-us/2017/10/dev-leagues-vfx-style-guide/
2. https://nexus.leagueoflegends.com/wp-content/uploads/2017/10/VFX_Styleguide_final_public_hidpjqwx7lqyx0pjj3ss.pdf
3. https://realtimevfx.com/t/anatomy-of-a-league-of-legends-missile-part-1-creating-areas-of-focus/11614
4. https://www.vfxapprentice.com/blog/10-league-of-legends-vfx-design-tips (re-seen in gap-fill: gameplay/value/color/shape/timing frame, impact matches importance, primary vs secondary elements, author Jin Ho Yang)
5. https://devtrackers.gg/leagueoflegends/p/668c1112-syndra-vfx-update-pre-pbe-preview
6. https://wiki.leagueoflegends.com/en-us/Life
7. https://support.riotgames.com/en-us/league-of-legends/gameplay/colorblind-mode
8. https://www.gamepressure.com/newsroom/lol-colorblind-mode-is-useles-for-players-suffering-from-actual-c/za2e03
9. https://dota2.fandom.com/wiki/Health (re-seen in gap-fill: colorblind mode and Differentiate Ally Healthbars)
10. https://www.gamersunchained.com/news/health-bars-are-now-more-visible-in-dota-2-and-voting-opens-for-collectors-cache
11. https://forums.playdeadlock.com/threads/a11y-colorblind-setting-for-enemy-colors.10548/latest
12. https://mobalytics.gg/blog/lol-s13-must-have-settings/
13. https://lol.fandom.com/wiki/New_To_League/Understanding_the_Stream/The_Minimap
14. https://liquipedia.net/dota2/Minimap
15. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/CDOTABaseGameMode.SetCameraDistanceOverride
16. https://lensviewing.com/what-is-the-camera-angle-used-in-league-of-legends/ (low reliability; values treated as unverified; re-seen in gap-fill with no better source found)
17. https://danouellette.com/infinitecrisis
18. https://nexus.leagueoflegends.com/en-us/2016/12/the-visual-language-of-hextech (re-seen in gap-fill: client as a Hextech tool, no dedicated artist per team)
19. https://developer.valvesoftware.com/wiki/Panorama/Overview
20. https://fanstanza.gg/faelights-league-of-legends-explained/
21. https://www.nerfplz.com/2026/08/every-summoners-rift-objective.html
22. https://www.dexerto.com/league-of-legends/riot-confirms-plans-for-lol-shakeup-in-2027-with-new-visuals-client-3296182/
23. https://www.gamesradar.com/games/league-of-legends/league-of-legends-is-getting-a-new-client-entirely-new-visuals-and-a-bit-of-new-gameplay-in-a-massive-2027-update-reportedly-codenamed-league-next/
24. https://www.engadget.com/gaming/a-total-league-of-legends-revamp-is-coming-in-2027-130000644.html

**[25]-[64]:** confirmed via search snippets in this gap-fill pass (2026-10-07). Full pages were not opened.

25. https://www.cgchannel.com/2012/06/valve-releases-useful-character-design-guide (Dota 2 Character Art Guide: 18 pages, silhouette, value patterning, coherent palette, rest and detail, evaluating in context)
26. https://help.steampowered.com/faqs/view/0688-7692-4D5A-1935 (Valve Steam Support page hosting the guide; snippets only, fetch blocked)
27. https://polycount.com/discussion/comment/1888930/ (Polycount discussion of the guide: top-light, bottom-dark gradient; bright, saturated Dota palette)
28. https://support.steampowered.com/kb/8700-SJKN-4322/dota-2-character-texture-guide (Valve texture and light-baking guide)
29. https://polycount.com/discussion/comment/1819031 (Polycount: Mask1/Mask2 and Dota shader outputs)
30. https://www.surrenderat20.net/2014/06/update-to-summoners-rift-headed-to-pbe.html (repost of Riot's "Updating Summoner's Rift" dev blog; fetch blocked, snippets only)
31. https://www.nerfplz.com/2014/06/huge-visual-updates-for-summoners-rift.html
32. https://www.destructoid.com/?p=147859 (Riot details Summoner's Rift update in dev blog)
33. https://www.oneesports.gg/lol/riot-gives-lol-champions-annie-and-nautilus-stunning-vfx-updates/
34. https://www.dexerto.com/league-of-legends/new-league-vgu-remake-poll-2022-udyr-skarner-quinn-shyvana-nocturne-1491859/ (VGU scope); also https://esports.gg/news/league-of-legends/the-lee-sin-visual-rework-finally-updates-the-blind-monk/ (visual rework keeping the kit)
35. https://wiki.leagueoflegends.com/en-us/Brush
36. https://sketchfab.com/blogs/community/art-spotlight-high-noon-senna (baked top-down light, no dynamic champion lighting)
36a. https://polycount.com/discussion/comment/2190982 (Riot art-contest brief: diffuse-only, no normal maps, light painted in; snippet-level)
37. https://nexus.leagueoflegends.com/en-us/2019/05/the-latest-on-little-demon-tristana
38. https://www.surrenderat20.net/2013/11/red-post-colection-pbe-health-bar.html (2013 health-bar rework goals)
39. https://liquipedia.net/dota2/Health (Dota colorblind and ally-bar colors)
39a. https://www.nerfplz.com/2013/02/29-pbe-update-new-sona-splash-art.html (2013 PBE HP tick test; which of [38]/[39a] carried the tick detail was not clear from snippets)
40. https://www.slashgear.com/overwatch-gets-updated-colorblind-feature-with-nine-color-options-22546973
41. https://www.cookandbecker.com/en/article/378/designing-overwatch.html
42. https://gdcvault.com/play/1024268/The-Art-of-Overwatch-Evolving
43. https://www.redbull.com/us-en/constructing-a-hero’s-playground-in-overwatch (map design lets heroes stand out; limited palette; landmarks; attribution among the returned results is likely but not certain)
44. https://80.lv/articles/comparing-team-fortress-2-and-overwatch-art-direction
45. https://gamertweak.com/ultimate-voice-lines-ow-2/
46. https://www.gamingonlinux.com/2024/10/deadlock-from-valve-gets-6-new-experimental-heroes-and-new-stylized-rendering-of-heroes/
47. https://www.shacknews.com/article/147546/deadlock-old-gods-new-blood-update ; https://www.gosugamers.net/entertainment/news/77889-deadlock-launches-old-gods-new-blood-update-adds-six-new-heroes-and-4v4-mode
48. https://www.exitlag.com/news/deadlock-old-gods-new-blood-update/ (brick vs marble map split; single secondary source)
49. https://mobalytics.gg/deadlock/guides/city-never-sleeps-update-summary
50. https://tracklock.gg/articles/deadlock-city-never-sleeps ; https://thegamehaus.com/deadlock/deadlock-major-update-adds-new-heroes-map-changes-hero-reworks-and-more/2026/09/29/
51. https://www.pcgamingwiki.com/wiki/Deadlock (pre-2026: colorblind option limited to reticle color)
52. https://deadlock.wiki/Teams
53. https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_UNITE_Opening_Cinematic (purple and orange teams)
54. https://www.unrealengine.com/spotlights/smite-2-is-being-built-for-the-long-haul-with-community-and-unreal-engine-5-at-its-core
55. https://www.unrealengine.com/en-US/developer-interviews/why-paragon-fueled-moba-predecessor-shifted-to-unreal-engine-5
56. https://www.sportskeeda.com/esports/dota-2-how-change-terrain ; https://liquipedia.net/dota2/Immortal_Gardens
57. https://dota2.fandom.com/wiki/Trees (Radiant bright and natural; tree types per side)
58. https://thenode.biologists.com/data-visualization-with-flying-colors/research/ (Okabe-Ito; about 8 colors as the practical limit)
59. https://conceptviz.app/blog/okabe-ito-palette-hex-codes-complete-reference (Okabe-Ito list; Wong 2011; Paul Tol up to about 12)
60. https://www.tweaktown.com/news/61530/warcraft-3-patch-largest-16-years-offers-24-player-games/index.html (Warcraft III patch 1.29: 24 players, 12 new colors)
61. https://developer.valvesoftware.com/wiki/Dota_2_Workshop_Tools/Scripting/API/CDOTA_PlayerResource.SetCustomPlayerColor
62. https://profilerr.net/dota-2-minimap-guide/ (low reliability: Simple Colors option, slot-ordered lobby colors, teardrop vs arrow minimap markers)
62a. https://steelseries.com/blog/pretend-to-watch-dota-29 (Radiant green, Dire red)
63. https://extensions.blender.org/add-ons/texel-density-checker
64. https://80.lv/articles/a-cool-add-on-for-working-with-texel-density-in-blender

**Attempted but not reached (egress blocked; not used as sources):**
- https://media.steampowered.com/apps/dota2/workshop/Dota2CharacterArtGuide.pdf
- https://steamcdn-a.akamaihd.net/apps/dota2/workshop/Dota2CharacterArtGuide.pdf
- https://en.wikipedia.org/wiki/Color_blindness
- https://help.steampowered.com/faqs/view/0688-7692-4D5A-1935 (gap-fill fetch; snippets used as [26])
- https://www.surrenderat20.net/2014/06/update-to-summoners-rift-headed-to-pbe.html (gap-fill fetch; snippets used as [30])

**Internal references:**
- `games/vale/_design/research/r02_match_rules_rift.md` (brush and vision rules)
- `games/vale/_design/research/r04_hud_camera_readability.md` (HUD, camera, colorblind, VFX)
- `games/vale/_design/research/r05_client_flow_menu_craft.md` (client visual language, Panorama, 2027 client)
- `games/vale/_design/research/r07_audio.md` (ally/enemy audio cue variants, section 11 (a) 14)
- `games/dyefield/_spec/CONTRACT_FFA.md` (Forgeflow precedent: 8-color plus mark FFA palette with a colorblind hatch)
