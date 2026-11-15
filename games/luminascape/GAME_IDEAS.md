I have full confirmation of what's shipped. Key exclusions I now know: ponds, seasons on clock, window glow at night, named worlds, particle paint (fireflies/butterflies), grass paint, forest gizmo, part-editor, GLB-swap leaf drop, thumbnails, herds NOT yet built, aquatic swim NOT built (statics only), pet-follow NOT built, growth-over-time NOT built, habitat attraction NOT built, goals NOT built, field guide NOT built. The prior UX roadmap (Photo Mode, HDRI, world share, rotation snap, InstancedMesh/LOD, onboarding) is excluded per instructions.

Here is the synthesized owner-facing doc:

---

# LuminaScape — What To Build Next (Gameplay Depth + Content/Creative Tools)

*Synthesis of two research passes: the gameplay-depth gap analysis and the content/creative-tool brainstorm. Deduped, prioritized, and cross-checked against the CHANGELOG (Waves 1–10) so nothing here is already shipped. Excludes the prior UX roadmap items (Photo Mode, HDRI/IBL, World share, rotation snap, InstancedMesh+LOD, onboarding). Everything below is wholesome (no combat), single-file-Three.js-feasible, and respects the no-bridges constraint.*

**The one-sentence framing:** LuminaScape is a superb *toy* (you build; ~700 assets, paint, sculpt, weather, seasons) but not yet a *game* — nothing in the world evolves on its own, arrives because of what you built, or gives you a reason to return tomorrow. The gameplay picks below add that living loop; the content picks make the building itself faster and richer. The two halves reinforce each other: a grown forest (content) attracts more birds (gameplay).

---

## ⭐ TOP 6 — most worth building next (ordered)

1. **Wildlife ARRIVES because of what you built (habitat attraction)** [P0, gameplay] — the single change that flips toy → game: animals aren't placed, they *show up* when your painted grass / pond / tree density meets a species recipe. Every existing system suddenly becomes a cause→effect loop with an unplanned payoff.
2. **Season scrubber slider** [P0, content] — highest value-per-line item on the list: the whole seasonal cross-fade already exists (`__MS__.setSeason`); a spring↔winter slider just exposes it, and showing off a world across seasons is an instant delight moment.
3. **Working lamps/lanterns/torches glow at night** [P0, content] — reuse the shipped `windowGlow` emissive ramp on 112 local light models + a small camera-local point-light pool; night scenes are currently dark and dead, and this is enormous visual payoff for low effort.
4. **Biome brush (terrain + matching flora in one stroke)** [P0, content] — the biggest builder time-saver: pick Meadow/Pine/Desert/Wetland/Alpine and one drag paints ground splat + scatters the right trees/flowers/rocks/grass together, fanning out to brushes you already have.
5. **Plants GROW over time (living, not placed-at-final-size)** [P1, gameplay] — saplings scale up across game-days on the existing day/season clock; gives the seasons real teeth and a genuine reason to return, and directly feeds habitat attraction (a grown forest draws more birds).
6. **Gentle optional goals / "Journal"** [P1, gameplay] — dismissable no-fail objectives ("bring 5 kinds of bird," "grow a forest of 20 trees") that give a sandbox direction, double as tutorials pointing at built-but-undiscovered features, and reward with new-asset/palette unlocks.

---

## GAMEPLAY GAPS (depth / replayability)

**Core diagnosis:** the world runs only in the "build" direction. There's no state that evolves, responds, or persists-of-life. Wildlife wanders on fixed AI but doesn't *arrive because of what you built*; plants never grow; seasons change visuals but no *rules*; there are no goals, discovery, or consequences. Every comparison title (Terra Nil, Horticular, Animal Crossing, Viridi, Dorfromantik) earns replayability from exactly these missing loops. Critically, these are **one loop**, not scattered features: *build habitat → life arrives → it grows & multiplies over seasons → you discover/collect it → a "Flourishing" meter rises → soft goals point at the next thing → you return tomorrow.*

### P0

- **Habitat attraction** *(TOP 6 #1)* — species recipes over painted grass / water / plant density (deer → grass + ≥3 trees; ducks → pond in radius; bees/butterflies → ≥N flowers; frogs → pond edge; songbirds → forest cluster). Throttled scan like the existing `_huntScan`; fade-in + chime on satisfy, fade-out if habitat destroyed. Zero new assets (79 rigged animals already loaded). *Evidence: Horticular's whole loop; Terra Nil's biodiversity-triggers-wildlife.* *Feasibility: high.*
  `HABITAT[sp]={needs:[{type:'grass',min:20,rad:15},{type:'tree',min:3}],spawn:'deer'}`

### P1

- **Plants grow over time** *(TOP 6 #5)* — each placed plant stores `plantedAt`+`stage`; per-frame `scale` lerp toward stage target on the day clock; rain/river proximity speeds it, winter pauses it, mature trees self-seed nearby (reuse `placeProp`). Persist stage in save. *Evidence: Viridi real-time growth; AC daily-return.* *Feasibility: medium.*
- **Gentle optional goals / Journal** *(TOP 6 #6)* — `GOALS=[{id,text,check,reward}]` re-checked on habitat/grow/collect events → toast + `unlock(reward)`. No timers, no penalties. *Evidence: Dorfromantik quests; AC museum checklist.* *Feasibility: high.*
- **Discovery collection — living Field Guide / Almanac** — a card grid that fills in as species first appear in *your* world (reuse the 96² `thumbFor` thumbnails you already generate): habitat + season + one cozy fact; rare visitors under special conditions (heron at a stocked pond at dawn, fireflies on warm summer nights). Collection is the strongest cozy retention driver known and reframes the roster as things to *earn*. *Evidence: AC Critterpedia = the engine of daily return.* *Feasibility: high.* Pairs with habitat attraction (mark `discovered` on first spawn).
- **Day/night & seasonal *gameplay* (not just visuals)** — gate habitat recipes on `SEASON`/`dayFrac` you already compute: nocturnal owls/fireflies/deer at night; migratory birds arrive spring, leave winter; flowers bloom spring/summer, seed in autumn; ponds freeze (skate-ready) in deep winter. Makes the clock a reason to *wait and watch*. *Feasibility: high.*
- **"Flourishing" gentle score + positive feedback loop** — one always-positive meter from biodiversity + greenery + water (counts you already track); crossing thresholds unlocks palettes/assets and *scales ambient richness* (more birdsong via `cricketGain`, more butterflies via particle paint) so a lush world literally becomes livelier; neglect gently lowers it and animals drift away. This is the connective tissue that makes the other loops feel like one system. *Evidence: Terra Nil biodiversity %; Spiritfarer's purpose-driven warmth.* *Feasibility: high.*

### P2

- **Animal life-cycle & family behavior** — paired animals near good habitat produce a child-scaled follow-the-parent offspring; herds form; birds nest in mature trees and return. The unscripted moments players screenshot. Cap population for perf. *Feasibility: medium.*
- **Weather cause→effect on life** — rain draws frogs/ducks to fresh puddles; drought wilts crops; a storm scatters a flock into the trees. The weather sim currently changes look but rarely *outcomes*; hook into existing weather state + the habitat scan. *Feasibility: high.*
- **Sanctuary / feeding stations as intentional tools** — placeable bird feeders, nest boxes, salt licks, reed beds that are *habitat magnets* raising local attraction for a species — a direct, satisfying lever on habitat attraction ("I want herons → I place a reed bed"). *Evidence: Horticular sheltering items.* *Feasibility: high.*
- **"Scenario" seeds / restoration prompts** — optional starter worlds with a soft brief ("a dry valley — bring it back to life," "an empty pond — make it a bird haven") = preset heightfield + splat + a goal set, reusing named-worlds. A Terra-Nil restoration fantasy without wrecking free-build. *Feasibility: high.*
- **Gentle interaction verbs in Play mode** — Play mode is a dead end today (you just walk). Add wholesome verbs: pet/feed an animal (happy reaction), sit on a bench (cozy camera), whistle to call birds, water a plant (speeds growth). Rigs already have idle/eat clips. *Evidence: Wylde Flowers/AC purpose-in-cozy-play.* *Feasibility: medium.*
- **Ambient "moments" / micro-vignettes** — rare cozy toasts surfaced from events already firing: "A family of deer settled by your pond," "Your oldest oak is now home to a bird's nest," "The first snow fell on your meadow." Named moments, not stats, are where the warmth lives. *Feasibility: high.*
- **Time-lapse "watch it grow" fast-forward** — a "let a day/season pass" button that plays the world forward in ~20s (plants grow, animals arrive, seasons turn) using existing `timeAuto`/`setTime`/`step(dt)`. The payoff-delivery mechanism for every slow loop. *Feasibility: high.*

---

## CONTENT & CREATIVE-TOOL IDEAS (painting, animals, buildings, modes)

**Library verdict up front:** nearly every asset gap below is fillable *today* from the local Poly.Pizza library (`F:\AssetLibrary\polypizza\_manifest.json`, 3,689 models) — livestock, aquatic life, pets, boats, carts, docks/piers, stairs, 112 lights, mills, 228 furniture pieces, 128 gate/wall/fence hits, 90+ buildings. **The single new-source item in this entire doc is a proper "well"** (0 title hits) — reuse a stone-trough/fountain or grab one CC0 well later.

### PAINTING & TERRAIN

**P0**
- **Season scrubber slider** *(TOP 6 #2)* — expose `__MS__.setSeason` as a spring↔winter slider that pauses auto-advance; the Wave-6 seasonal cross-fade already does all the work. *Very high feasibility.*
- **Biome brush** *(TOP 6 #4)* — `BIOMES={pine:{tint:'forest',trees:['pine','spruce'],grass:0.7,flowers:0.1}}`; one density-controlled stroke calls the existing `scatterFlowers`/`plantForest`/`grassPaint`/splat-paint along the drag. Highest-leverage tool you could add. *High feasibility.*
- **More ground-paint types (extend PAINT12 → 16+)** — add flower-field, autumn-leaf-litter, cobblestone, farmland furrows, moss, wet-sand, path-dirt, pebble-shore. Structurally the safest change: a `PAINT12[]` array + swatch-row extension, no shader restructure (furrows = directional stripe in the tint G-channel). Painting is the #1 verb. *Very high feasibility.*

**P1**
- **Height-stamp brushes (hill / crater / plateau / mesa / ridge)** — reuse the pond's `smootherstep` radial-falloff heightfield write with different profile curves; plateau = clamp-to-target inside radius. One click makes a believable hill. *High feasibility.*
- **Decal crop rows & flower beds** — reuse the CatmullRom road/`buildVegLine` path to emit food/flower models at fixed spacing perpendicular to the drag, so farmland reads as *rows* not scatter (Corn/Carrot/Wheat/Cabbage/tulip/rose all local). The difference between "field" and "farm." *High feasibility.*

**P2**
- **Cliff / terrace tool** — quantize heights to N bands inside the brush (terraces) or steep falloff (cliffs); the auto-rock-on-slope shader already paints the faces gray, so it looks right immediately. Terrain is all rolling today. *Medium feasibility.*
- **Water-edge / shoreline tool** — bias height toward the `seaLevel` waterline band to sculpt beaches/coves/sandbars; leans on existing `autoBeachAll`. *Medium feasibility.*
- **Symmetry / mirror paint** — wrap `applyAt`/`placeProp` to also fire at a mirrored coord (or radial N-fold) for instant formal gardens/boulevards; undo must batch both. *Medium feasibility.*

### ASSET CATEGORIES (thin & genuinely useful — nearly all local)

**P0**
- **Working lamps/lanterns/torches/streetlights glow at night** *(TOP 6 #3)* — reuse `windowGlow`'s emissive ramp on 112 local light models + a capped camera-local point-light pool. Lit paths and a lantern by the pond are what make night mode worth having. *High feasibility. Fully covered.*

**P1**
- **Livestock herds + a herd/flock scatter placer** — Cow/Horse/Sheep/Goat/Pig/Donkey/Llama (all local) plus a mode that drops a cluster of 4–8 grazers with jitter + a shared wander leash. Species-aware graze idles already exist, so herds animate for free; a lone cow looks empty, a herd is the payoff. *High feasibility. Fully covered.*
- **Aquatic life that moves** — Wave-10 wired 15 *static* pond-life models; this makes a few actually **swim** (sub-surface bob path) and adds floating ducks/swans on top + ocean species (Koi/Whale/Crab/Dolphin/Turtle, all local). Ponds/ocean are currently lifeless water; koi is the most iconic cozy detail. *High for floaters, medium for sub-surface swim. Fully covered.*
- **Interior furniture as placeables (phase 1 of enterable interiors)** — 228 furniture hits (Bed/Chair/Table/Sofa/Rocking Chair/Fireplace/Stove/Rug/Barrel) placed via the existing placement system. This is the deepest content-surface unlock in the list; do furniture-as-placeables *first* (trivial), enterable-interiors (door-trigger camera move) as the follow-up flagged in your own "Known limits." *Furniture fully covered; medium-hard for enter step.*
- **Boats on water + carts/wagons on land** — Canoe/Rowboat/Sailboat/Ferry (water-Y grounding via `seaLevel`/pond Y, with bob) and Wagon/Cart/Wheelbarrow/Carriage/Tractor. A boat on your pond gives water *purpose* — the elegant answer to the no-bridges constraint. *High feasibility. Fully covered.*

**P2**
- **Pets that follow the player in Play mode** — Dog/Cat/Puppy/Rabbit/Hamster (local); reuse the predator chase AI with target=player, capped speed, sit-when-stopped. Turns "walk around" into "walk your dog around your world" — instant attachment and a *reason* for Play mode. *Medium feasibility. Fully covered.*
- **Building variety pass (the cozy middle)** — pure `_XTRA_DATA` additions of cottages/cabins/farmhouses/shops/ruins; more cottage silhouettes matter more than exotic buildings. Windmill/Barn/Silo/Lighthouse already local; hand-pick 10–15 distinct cottages. *High feasibility. Mostly covered.*
- **Infrastructure: docks/piers, stairs, wells** — Dock/Dock Long/Dock Stairs + modular Stairs (local) make waterfronts/terraces walkable *without bridges*; a village well is an iconic centerpiece (⚠ **the one new-source item** — reuse a trough/fountain or grab one CC0 well). *High for docks/stairs; one download for well.*
- **Gate/wall/fence style variety + village/market kit** — 128 gate/wall/fence hits; round out picket/ranch/stone/hedge so enclosures match the biome. Fences are placed constantly. Pure `_XTRA_DATA` additions. *High feasibility. Fully covered.*

### CREATIVE MODES

**P1**
- **Terrain presets / one-click world generators** — "New World → Island / Valley / Archipelago / Mountain / Coastal Plains" via layered value-noise into `_bootChunks` (island = radial falloff below `seaLevel` at edges, reusing the pond-bowl carve). Kills the blank-flat "what now?" start and adds roll-a-new-island replayability. *Medium feasibility.*
- **Density-brush procedural scatter** — a general scatter brush with a density slider + multi-select asset palette (trees + rocks + flowers together); generalizes the forest/meadow brushes into one flexible tool builders will live in. *High feasibility.*

**P2**
- **Village auto-builder** — click-drag an area → a small village: spaced terrain-grounded houses facing a center + connecting dirt paths (road system) + a well/fountain + fences + a lamp; a simple jittered-grid + radial-path layout solver over existing place/road/fence calls. Instant civilization to then customize. *Medium-hard feasibility. Assets local.*
- **"Paint the weather" / weather regions** — brush a local micro-climate (fog over a valley, snow on a peak, fireflies always here at night) by localizing the existing global weather multipliers to painted point-regions. Makes one world feel like many places. *Medium feasibility.* (Overlaps the gameplay "seasonal gameplay" item — build the weather-region *tool* here, wire the *rules* there.)

---

## The through-line for the owner

The gameplay picks are one loop, and the content picks feed it. Start with **habitat attraction (#1)** — it alone converts sandbox to game and everything else hangs off it. But the three P0 *content* items (season scrubber, night lights, biome brush) are near-free, high-delight, and can ship in parallel or first as quick wins while habitat attraction is built. All of it reuses systems already in the codebase (`PAINT12`/`tnt` tint, pond `smootherstep` bowl, `windowGlow`, `SEASON`/`setSeason`, `_FALL_MAP` GLB-swap, `buildVegLine` path, `_bootChunks`, `_LAZY`/`_XTRA_DATA`, `thumbFor`, `_huntScan`, save schema), adds **zero required new content** (one optional "well" download aside), and never introduces combat or stress.

**Files:** `C:\Users\TestRun\Claude Claw\deliverables\demos\meadowsmith\CHANGELOG.md` (feature source of truth) · `C:\Users\TestRun\Claude Claw\deliverables\demos\meadowsmith\GAP_ROADMAP.md` (prior UX roadmap — this doc deliberately does NOT overlap it) · `F:\AssetLibrary\polypizza\_manifest.json` (3,689-model local library).