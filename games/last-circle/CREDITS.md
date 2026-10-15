# Last Circle — Asset Credits

## 3D models (via Poly Pizza)
- "Pine Tree" by Quaternius — CC0 — https://poly.pizza/m/gX8WmgkeEm
- "Birch Tree" by Quaternius — CC0 — https://poly.pizza/m/k6cozoNfLH
- "Bush" by Quaternius — CC0 — https://poly.pizza/m/92EytlU1El
- "Car" by iloem — CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0) — https://poly.pizza/m/Uap8uBrkU8
- "Container Red" by Quaternius — CC0 — https://poly.pizza/m/vzzCNUB6Zn
- "Barrel" by Kenney — CC0 — https://poly.pizza/m/hTJs1zFzFz
- Palm / broadleaf tree / rocks / treasure chest — Poly Pizza CC0 packs (shared with Pirate's Cove; see that game's credits)
- "Pickaxe" by Kenney — CC0 — https://poly.pizza/m/UHZH2OoWCS
- "Shotgun Double Barrel" by CreativeTrio — CC0 — https://poly.pizza/m/k0fA37Awl8
- "Low poly Pistol" by TARgamSC — CC-BY 3.0 (https://creativecommons.org/licenses/by/3.0) — https://poly.pizza/m/p5Tax9l7mu
- Player characters (soldier / athlete / drifter / wraith / juggernaut / viper), all weapons (pistol / SMG / AR / shotgun / sniper / grenade launcher), items (medkit / bandage / shield potions), crystal deco, and all locomotion + armed + emote animations: AI-generated with Meshy on the owner's account — original to this game

## Town kit (assets/props/city/, assets/props/cars/) — look + feel wave 4, intake lane ART-B
Buildings, street props, cars, furniture and wall modules are repacked offline (geometry only, meshopt-compressed, positions snapped to a 0.5 mm grid, tangents dropped; palette PNGs recoloured for the slate / red-brick / sand variants). The models themselves are unchanged third-party CC0 art. Source and licence record: `cc0-city/SOURCES.json` + the `LICENSE-kenney-*.txt` files of each kit.
- Kenney "City Kit (Suburban)" 20 — CC0 — https://kenney.nl/assets/city-kit-suburban (building-type-*, fence, planter; also its colormap)
- Kenney "City Kit (Commercial)" 2.1 — CC0 — https://kenney.nl/assets/city-kit-commercial (buildings, skyscrapers, low-detail skyline; also its colormap)
- Kenney "City Kit (Roads)" — CC0 — https://kenney.nl/assets/city-kit-roads (street lights, construction barrier; also its colormap)
- Kenney "Car Kit" 3.1 — CC0 — https://kenney.nl/assets/car-kit (sedan, SUV, taxi, police, van, hatchback, truck, delivery; traffic cone, crate; also its colormap)
- Kenney "Furniture Kit" 2.0 — CC0 — https://kenney.nl/assets/furniture-kit (furniture + wall / door / floor modules)
- Kenney "Graveyard Kit" 5.0 — CC0 — https://kenney.nl/assets/graveyard-kit (park bench; also its colormap)
- Quaternius via Poly Pizza — CC0 — "Fire Hydrant" https://poly.pizza/m/DKkMQbEklp, "Dumpster" https://poly.pizza/m/PKsbolkZSr, "Traffic Barrier" https://poly.pizza/m/cM3aJPU9NS, "Crate" https://poly.pizza/m/3OEFd1AWfa, "Shipping Container" https://poly.pizza/m/dQXRtm5GbO

## Textures and particles (assets/tex/, assets/fx/)
- Ground and road textures (1024 px, resized from the 2K diffuse maps, colour unchanged): Poly Haven, CC0 — https://polyhaven.com/a/aerial_asphalt_01 (road_asphalt), https://polyhaven.com/a/asphalt_04 (sidewalk_concrete), https://polyhaven.com/a/aerial_grass_rock (ground_grass_rock), https://polyhaven.com/a/aerial_beach_01 (ground_beach), https://polyhaven.com/a/aerial_sand (ground_sand). Licence: https://polyhaven.com/license
- Particle textures (spark, puff, glow, tracer): derived from Kenney "Light Masks" 1.0 — CC0 — https://kenney.nl/assets/light-masks (shape_e, shape_c, shape_a, streaks_composed_e)

## Animation clips (assets/chars/clips/) and the ram-air canopy (assets/props/canopy.glb) — look + feel wave 4, lane ART-A
- Shared character clips `assets/chars/clips/<clip>.glb` (idle, walk, run, death, hit, dance, cheer, jump, swim, crouch, rifle_idle, rifle_walk, rifle_run, rifle_reload, rifle_crouch): the same clips the five per-skin `assets/chars/meshy/<skin>_<clip>.glb` files carry, de-duplicated into one file per clip (bone-translation / scale tracks removed, rotations stored as 16-bit normalised values; measured error 0.0033 degrees). No new source material; the licence is unchanged.
- Death clips `death_front`, `death_front_head`, `death_back`, `death_back_head`, `death_right`, `death_crouch_head`, `death_walking`: Adobe Mixamo animations ("death from the front", "death from front headshot", "death from the back", "death from back headshot", "death from right", "death crouching headshot front" from the Rifle 8-Way Locomotion Pack, and "walking to dying" from the Shooter Pack). Mixamo animations are royalty-free for use in games, including commercial ones (https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html). Only the baked, retargeted clips ship (rotations retargeted onto the Last Circle rig, hips converted to metres); the original FBX files are not redistributed.
- Ram-air canopy `assets/props/canopy.glb` / `canopy.json`: original asset authored for this game (parametric model built in Blender 5.1 by `_tools/art_a_canopy_build.py`); no third-party source. Draco-compressed with glTF-Transform (MIT).

## HUD
- Weapon silhouettes (assets/hud/wpn_*.png): rendered from this game's own Meshy weapon models (`assets/props/meshy_wpn/wpn_<id>.glb`, the models the game shows for all six guns) — original to this game, no third-party licence

## Code (vendored, assets/vendor/three/)
- three.js r172 (including GLTFLoader / DRACOLoader / examples) — MIT — https://threejs.org
- meshoptimizer decoder (examples/jsm/libs/meshopt_decoder.module.js, from three r172) — MIT, Copyright (C) 2016-2022 Arseny Kapoulkine — https://github.com/zeux/meshoptimizer
- Draco decoder (examples/jsm/libs/draco/) — Apache-2.0, Google — https://github.com/google/draco

## Audio
- SFX: Kenney interface-sounds / impact-sounds / rpg-audio packs — CC0

(Keep this file shipped with the game per CC-BY attribution requirements.)

## City kit module (runtime/3d/royale/citykit.js) — Wave 6, lane 6C
- No new third-party asset, library or download: citykit.js places and draws the Kenney / Quaternius CC0 kit listed under "Town kit" above with its own colormaps; the slate / brick / sand variants are the recoloured colormaps already shipped in assets/props/city/palettes/, and the O2 theme tints are multiplied on at run time (no new texture).
- Derived data inside citykit.js, both computed offline from the CC0 files above: `COLLIDER_BOXES` (a literal copy of manifest.json's collider boxes, baked from the same geometry) and `PROXY_COLORS` (average wall / roof colours of each building type, sampled from the Kenney colormaps through the models' UVs, used only for the far-LOD box proxy). CC0, like their source.

## Savanna city wiring (runtime/3d/royale/maps.js, towngen.js) — Wave 7, lane 7A
- No new third-party asset, library or download. Savanna's towns, compounds and street dressing draw only what is already credited above: the Kenney City Kit (Suburban / Commercial / Skyscrapers / low-detail) and Car Kit and the Quaternius props (CC0, assets/props/city/**), the road / ground photographs of Wave 4 (CC0, Poly Haven, assets/tex/), and the game's own generated boxes (house(), tower(), sidewalks, lane lines and zebra crossings are procedural geometry and vertex colours, no texture).
- The town layout, street-prop placement and every parcel are generated by towngen.js (the project's own code; the block / parcel bisection is transliterated from BLOCKTOOTH's citygen.ts, same owner).

## Savanna city polish (runtime/3d/royale/maps.js, towngen.js, citykit.js) — Wave 7, lane 7A2
- No new third-party asset, library, download or spend ($0). The denser towns, the five compound kinds, the extra street dressing and the car paints use only what is already credited above: the Kenney City Kit (Suburban / Commercial / Skyscrapers), Car Kit (the parked cars), Graveyard Kit (benches) and Quaternius props (hydrants, lights, planters, barriers, cones, dumpsters, crates, shipping containers), all CC0 (assets/props/city/**, assets/props/cars/**), plus the game's own procedural boxes (house(), tower(), the silo, the facade windows, awnings, porches, chimneys and rooftop units are generated geometry and vertex colours, no texture).
- The car paint is a fragment-shader recolour of the existing Kenney Car Kit palette texture (citykit.js `installCarPaint`): no new texture; the saturated body swatches take a per-instance colour, the glass, tyres and lamps keep the CC0 texture.
- The Kenney skyscraper-c and skyscraper-d models are no longer placed (their manifest collider box stops 3 m short of the drawn rear); nothing was removed from assets/.

## Savanna city completion (runtime/3d/royale/maps.js, towngen.js, citykit.js) — Wave 7 completion round, lane D2
- No new third-party asset, library, download or spend ($0). The taller downtown draws the SAME Kenney Skyscraper / Commercial CC0 models (assets/props/city/**) stretched vertically at run time (citykit.js `sy`, a vertical-only scale: no new mesh, no new texture); the towers' glass shafts, the gas stations, markets, clock-tower plazas, sports courts, hay, wood piles, rubble, crop fields, cornice bands and the windbreak acacias are the game's own procedural boxes, vertex colours and ground decals (and the existing instanced acacia), no texture and no third-party source.
- The coarse far copy of the acacia's trunk (maps.js `clusterSimplify`, vertex clustering with quadric placement after Lindstrom / Garland-Heckbert) is computed at load from the shipped CC0 tree model (assets/props/tree.glb); nothing was added to assets/.
