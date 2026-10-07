# Hourfall (`map_rift`): landmark and art brief

For the Blender map artist (`art/blender/maps/map_rift.py` → `art/out/maps/map_rift/scene.glb`, `minimap.png`). The layout truth is `content/maps/map_rift.json`. Its walls, Needlegrass, roads, structures, camps and bases are what the sim plays on, so the scene **builds on those polygons and never moves them**. The generator is `_design/tools/map_gen.py`, the top-down preview is `_design/maps/map_rift.png`, and `_harness/probe_maps.ts` checks the layout in the real sim. Look law: `_design/STYLE_BIBLE.md` and `_design/tokens.json` `grade.maps.rift`. Names: `_design/WORLD.md` §3.

**Coordinates.** Sim `(x, y)` in metres. x runs west → east (Aubade, screen-left → Serenade, screen-right). y runs north → south (screen-top → screen-bottom).
- Three.js: `(X = x, Y = height, Z = y)`.
- Blender (Z-up, exporter maps (x, y, z) → (x, z, −y)): **`(x, −y, height)`**.
- All walkable ground is flat at height 0 (CONTRACT §2). Relief on walkable ground is ≤ 0.15 m and read by material, never by height.

## 1. The map in one paragraph

Hourfall is the carved sundial seen from above. It is an oval dial face, 170 × 110 m, mirrored across the north–south **Noonline** at x = 85.
- **Bases.** The two bases sit at the oval's west and east tips: the **Glass Belfry** for Aubade and the **Lamp Dome** for Serenade.
- **Roads.** The **North Road** and **South Road** run along the inside of the dial's rim like its hour-band. The **Mid Road** runs straight across the dial's centre over **the Seat**.
- **The Dialwood.** The jungle between the roads is cut by the dial's own engraving: an **hour-ring** path circles the Seat at 27 m, and two radial **hour-lines** per quadrant run out from it to the side road.
- **The Noonline.** Its north half is the **Standing Shadow**, whose hard violet tip falls in **Longshade**'s pit. Its south half is the **Fallen Shaft**, where a lying drum of the needle splits the channel and its broken tip is **Sunsplinter**'s pit.

The silhouette that must survive at minimap size is **an oval, three roads, a wheel of hour-lines, and one vertical line through the middle**. It must never look like a diagonal square with a diagonal river.

## 2. Regions and their landmark (one silhouette per region)

Heights are above the walkable plane. **Camera rule:** the camera looks north (−Z) at 52°, so anything h metres tall hides 0.78·h m of ground **north** of it.
- Tall things (> 3.4 m) stand **north** of the play space they belong to, or outside the map.
- Anything **south** of play space stays ≤ 3.4 m, the cliff height.
- Every landmark below stands on wall cells or outside the sim rectangle, never on open ground. Flush inlays are the exception.
- The same list is machine-readable in `art.terrain.landmarks` (id, `at`, footprint `size`, `height`, `flush`), so `map_rift.py` can place from the JSON.
- `_harness/probe_maps.ts` checks every solid one: it must stand on wall or off the map, and hide no more open ground than a 3.4 m cliff already does.

| Region | Landmark (the one silhouette) | Sim (x, y) | Footprint · height | Materials · light |
|---|---|---|---|---|
| **Glass Belfry** (Aubade base) | The **Glass Belfry**: a stacked chalk spire of three open-lattice stages with a dawnglass bell-lantern in the top stage. Height ≥ 3× footprint (spire language). It stands just beyond the west edge, behind the fountain. | (−5.0, 55.0) | 7 × 7 m · 22 m | chalk limestone, dawnglass, blued steel bands. The lantern glass stays neutral cool (`#BFD3E6`): the **Hourbell** carries relationship light, not the Belfry |
| **Lamp Dome** (Serenade base) | The **Lamp Dome**: a low banded ironstone dome on a heavy drum, with a lampresin oculus. Footprint ≥ 2× height (dome language). It stands beyond the east edge, behind the fountain; its wide footprint sits 5 m further out than the Belfry so it stays off the plaza. | (180.0, 55.0) | 18 m Ø · 8 m | ironstone, ochre sandstone drum, lampresin oculus (`#E8A04A` translucency, emissive ≤ 0.8) |
| **The Seat** (centre) | The needle's base-stone: a polished round disc of dial-stone, **flush** with the road (r 8 m). It has a 0.15 m carved rim step, a ring-shaped socket scar (r 3 m) where the needle stood, and the twelve hour-ticks engraved round its rim. Nothing rises from it. It never blocks sight. | (85.0, 55.0) | r 8 m · ≤ 0.15 m | honed pale dial-stone L* 66–70, engraving ≤ 6 L* contrast |
| **The Standing Shadow** (north Noonline) | The shadow itself: a hard-edged violet-cool floor from the Seat's north rim up the strip and into **Longshade's pit**. Its tip is a sharp point engraved on the pit floor at (85, 24). The pit's silhouette is **two leaning basalt slabs** framing the north choke, like the edges of the shadow standing up. | pit (85, 31) r 9 · slabs (79.4, 19.6) and (90.6, 19.6) | slabs 2 × 3 m · 4 m (north of the pit, so they hide only wall) | shadow floor L* 30–36, violet `#4A4560`, saturation **kept** and the edge engraved, so it never reads as fog of war (bible: "the Standing Shadow keeps colour and a hard edge"). Slabs: dark basalt with chalk-lit top edges |
| **The Fallen Shaft** (south Noonline) | One **lying drum of the fallen needle** splits the channel south of the Seat. It is a banded cylinder on its side, its broken face turned toward **Sunsplinter's pit**. The pit is the broken tip; its floor is shallow water over pale stone. | drum (85.0, 66.6), 3 × 6.4 m (a wall) · pit (85, 80) r 8.5 | drum ≤ 2.2 m (south of the Seat: low) | needle stone (pale chalk-grey with two carved hour-bands), shallow water ≤ 0.05 m, floor L* 40–48 cool. Loose shard fragments in the water stay flush |
| **Elevenmark** (NW Dialwood) | The numeral **XI**, giant and half-buried, tilted 20° in the block between the two hour-lines | (55.3, 28.2) | 9 × 4 m · ≤ 5 m | carved dial-stone, weathered; inscription L* 70 on the cut faces only |
| **Twomark** (NE) | numeral **II**, same treatment | (114.7, 28.2) | 6 × 4 m · ≤ 5 m | as above |
| **Sevenmark** (SW) | numeral **VII** | (55.3, 81.8) | 10 × 4 m · ≤ 5 m (the block's south edge is 8 m away, so it occludes nothing) | as above |
| **Fourmark** (SE) | numeral **IIII** (the dial-maker's four) | (114.7, 81.8) | 9 × 4 m · ≤ 5 m | as above |
| **North rim** (12 o'clock) | The **noon stone**: a tall upright XII stele on the rim, north of the North Road, where the Noonline meets the dial's edge | (85.0, 3.0) | 3 × 1.5 m · 9 m (north of everything) | chalk dial-stone; the side road's one vertical landmark |
| **South rim** (6 o'clock) | The **VI slab**, lying flat, because it is south of the South Road | (85.0, 107.0) | 6 × 2 m · ≤ 1.2 m | as above |

The four **numerals are the callouts** players use ("they're in Twomark"). Keep each one unmistakable at 1.8 px/m on the minimap, as a pale glyph on the dark block (§7). A bare "Seven" is a deny-list entry, so the *-mark* form is the name; the stone itself shows only the numeral.

## 3. Structures, bases and camps (the sim's placements; model to these exactly)

Structures are units with their own GLBs (`assets/units/<unit>.glb`). The scene only gives each a **plinth decal and clearing** at the placement. They stand at alternating road edges, 2.8 m off the centre line, so the Wicks' line stays straight. Team 0 is listed; team 1 is the mirror (x → 170 − x).

| Placement | Sim (x, y) | Note |
|---|---|---|
| Hourbell `a_hourbell` | (15.0, 55.0) | the core. Clearing r 6 on the plaza. The bell's lamp core carries relationship light |
| Bell Needles `a_bell_needle_north/south` | (21.5, 51.2) · (21.5, 58.8) | flank the Mid Road gate. They open when the Mid Road Lantern falls |
| Mid Road: Lantern · Inner · Outer | (32.0, 52.2) · (46.0, 57.8) · (62.0, 52.2) | Lantern relights after 4:00 |
| North Road: Lantern · Inner · Outer | (26.9, 35.8) · (35.0, 18.4) · (59.5, 16.1) | South Road = the same with y → 110 − y |
| Base plaza (Glass Belfry terrace) | disc (12, 55) r 13 | fountain (4.5, 55) r 5 · shop circle (6, 47.5) r 3 · spawn (8.5, 55) |
| Lampwright's stall prop (Aubade) | (5.5, 41.5), on the wall lip north of the shop circle | a small spire-roofed kiosk facing the circle; never on the walkable plaza |

| Camp (team 0 side; mirror for team 1) | Sim (x, y) of the lead unit | Clearing (L* 45–50) | Dressing (low, flush or on the clearing's wall lip) |
|---|---|---|---|
| **Glasshorn** (buff) | (61.6, 41.5), where the hour-ring meets the Baseward line | r 4.6 | shed glass antler tines on the lip, catching the sun |
| **Gloamoths** | (64.3, 24.9), half-way out the Rimward line | r 4.2 | moth-lamps hung in the canopy above the north lip (unlit by day) |
| **Strays** (north) | (46.0, 32.5) on the Baseward line | r 4.2 | toppled small carved numerals around the rim |
| **Resinback** (buff) | (64.3, 85.1), near the South Road and Sunsplinter | r 4.6 | amber resin pooled in the cracks; warm but below bloom |
| **Stilltusks** | (61.6, 68.5), near the Mid Road | r 4.2 | tusk-scored stone |
| **Strays** (south) | (46.0, 77.5) | r 4.2 | as the north Strays |
| **Sunsplinter** (objective) | (85, 80) | pit r 8.5 | see the Fallen Shaft |
| **Longshade** (objective) | (85, 31) | pit r 9 | see the Standing Shadow |

## 4. The Dialwood paths (callouts for the brief, not player-facing names)

- **Hour-ring.** This path circles the Seat at r 27 m in each quadrant. It runs from the Mid Road mouth at (58.4, 50.4), through Glasshorn (61.6, 41.5) and the Rimward junction (69.1, 33.2), into Longshade's pit at (76.7, 29.3). The south quadrants are the same with y → 110 − y.
- **Baseward line.** This hour-line runs from Glasshorn out to the North Road by the Inner Needle: (61.6, 41.5) → (44.3, 31.5) → (36.4, 23.4).
- **Rimward line.** This hour-line runs from the hour-ring out to the North Road by the Outer Needle: (69.1, 33.2) → (63.8, 23.5) → (61.2, 13.9).
- The paths are 5.6 m of open ground. The roads are 10.4 m open (7.2 m paving + 1.6 m verge each side).

Engrave the floor of every Dialwood path with a faint **hour-line**: a 0.3 m chalk groove along its centre, ≤ 6 L* contrast. The whole dial then reads as one carved instrument when you scroll the camera.

## 5. Terrain materials (all walkable roughness ≥ 0.5)

| Surface | Where (from the JSON) | Material | Value (L*, after grade) |
|---|---|---|---|
| Roads | `lanes[]` centre ± 3.6 m | honed pale dial-stone flags. A 0.3 m inscription band runs on each outer edge, with hour-ticks every 9 m along the side roads | 62–68, variation ≤ ±4 |
| Road verges | road ± 3.6 to 5.2 m | worn stone with moss in the joints | 50–56 |
| Dialwood floor | open ground off the roads | moss and leaf-litter over stone, with the faint hour-line groove | 30–40 |
| Camp clearings | camp discs | dusty pale stone "rooms" inside the dark wood | 45–50 |
| Base plazas | disc (12, 55) r 13 and mirror | Aubade: chalk flags with dawnglass inlay rings round the fountain. Serenade: ochre sandstone with lampresin inlay | 60–66 |
| Standing Shadow | `art.terrain.noonline.standingShadow.floor` | violet-cool stone, hard engraved edge | 30–36, saturation kept |
| Fallen Shaft | `art.terrain.noonline.fallenShaft.floor` | shallow water (≤ 0.05 m) over pale stone, fragments flush | 40–48, cool |
| The Seat | disc (85, 55) r 8 | polished dial-stone | 66–70 |
| Wall tops | every `walls[]` polygon, extruded 2.6–3.4 m | carved stone lip, then Dialwood canopy on the block | lit top 55–62, with a painted 1 px edge light at 1080p |
| Wall faces | the extrusion sides | dark cut stone in horizontal courses | 18–25 |
| Needlegrass | `thickets[]` | tall stone-green solid blades (no alpha cards) on a carved stone curb | 48–54, more yellow than the moss |

- **Temperature field.** Ambient/IBL is tinted cool `#B8C6D9` on the west half and warm `#D9C2A0` on the east, at strength 0.08 (`art.terrain.temperatureField`). The west stone sits at L* 66–72 with a blue-grey cast; the east at 58–64 with an ochre cast (WORLD §2). Never use a team hue.
- **Height mist.** Mist `#9AA7B4` at 0.035/m sits below 0.8 m, in the Fallen Shaft and the Dialwood hollows only. Edge fog `#8E9AA6` starts 4 m outside the map and is full at 18 m. There is no camera-distance fog and no cloud shadow.

## 6. Scatter

| Type | Where | Rule |
|---|---|---|
| Dialwood trees (lacquered fan-leaved plates, bevelled, instanced) | wall-block tops and the rim frame | within 3 m of a block's **south** edge (camera side), canopy ≤ 4 m. Deeper in, up to 9 m. Never over open ground |
| Fallen hour-tick stones | jungle floor near walls | ≤ 0.4 m. Keep ≥ 1.5 m from path centres |
| Moss and leaf-litter decals | jungle floor | never on roads |
| Needle shards (flush) | Fallen Shaft water | ≤ 0.05 m relief |
| Rim kerb | the dial's edge (frame polygons' inner rings) | carved band with hour-ticks, 0.6 m tall on the wall top |

Budget: ≤ 700k triangles for the whole scene, scatter through EXT_mesh_gpu_instancing, landmarks at 2048² textures (CONTRACT §12).

## 7. Minimap (`minimap.png`, shown at 352 × 198 px, about 1.8 px/m)

Paint it top-down and orthographic from the same JSON, flat values only:
- **Walls:** darkest (L* 15). No texture, so corridors pop.
- **Dialwood floor:** L* 35.
- **Roads:** lightest (L* 75), 13 px wide.
- **Noonline:** the Standing Shadow is a violet band, the Fallen Shaft a blue-grey band, with the drum in wall-dark.
- **Seat and camp clearings:** L* 50 dots.
- **Numerals:** the four as pale glyphs on their blocks. They are the callouts players will say.
- **Leave out:** structures, camps' live state and Needlegrass. The UI draws those live.

Readability comes from three things only:
1. the pale oval of roads against the dark dial;
2. the vertical Noonline;
3. the wheel of hour-ring paths.

## 8. Checklist before export

- [ ] The scene's cliff footprints equal `walls[]` exactly (export a top-down mask and diff it against `_design/maps/map_rift.png`).
- [ ] Nothing solid stands on open ground. Every landmark is on a wall cell or outside the 170 × 110 rectangle.
- [ ] Nothing taller than 3.4 m stands south of play space. The noon stone, the Belfry and the Dome may be tall. A moved landmark is moved in `map_gen.py` too, and the probe re-run.
- [ ] The Standing Shadow floor is violet and keeps its colour under fog of war. The Fallen Shaft is water, not fog.
- [ ] The scene is mirror-identical across x = 85 except the side marks (Belfry/Dome, spire vs dome stone, cool vs warm cast) and the two Noonline halves. Stone says whose land; light says whose side.
