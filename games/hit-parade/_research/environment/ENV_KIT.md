# HIT PARADE - Environment Art Kit (scouting report)

Status: COMPLETE (scouting only - nothing copied into the game, no state files touched, no downloads, no spend).
Lane: environment. Machine-readable twin: `env_kit.json` (every tris / size / dims number there is copied from a Blender or PIL measurement made this session). Contact sheets: `sheets/*.png` (every recommendation below was looked at on one of them).

## TL;DR
- **Best-covered sets:** Rust Theater (1) and Channel 13 Rooftop (4). Control Room (5) is half covered. Butcher Block (2) is thin. Wheel of Pain (3) has almost no usable models: textures only.
- **One consistent look is available:** Quaternius Medieval Village + Fantasy Props MegaKits (CC0, 2048 PBR, hand-painted) + GYP Stylized Fantasy City textures (incl. a ready **blue** stone wall) + Blink Stylized Dungeon textures + Tidal Flask FANTASTIC curtains + Japan Village semi-real rooftop props. Flat-colour toon kits (SICS Toon City/Harbor, Synty POLYGON, polyperfect Low Poly Ultimate, Kenney) are background/far-silhouette only. Measured: SICS Toon City runs 42-982 tris on 128x128 palette textures, and polyperfect runs 60-746 tris on one 1024 atlas. Both sit below the close-camera bar.
- **Must be procedural (behind the quality bar in section 8):** giant spinning wheel, podiums, show trapdoors, truss/marquee light rigs, CRT monitor banks, boiler, metal grating, white tile, brushed steel, meat hooks, stage spotlights, rain, neon tubes. **Hanging carcasses** are the one organic gap. A procedural build would struggle there; it needs a sculpt or a spend-gated generator.
- **HUD:** Bungee (display) + Russo One (score digits) + Bebas Neue (round/timer) + Acme (host captions) + Oswald (body), all SIL OFL. Kenney Input Prompts (633 PNG + SVG across 6 device sets) and Kenney Mobile Controls (8 styles x 46 sprites) are CC0.
- **Traps found:** the 40 Poly Haven models are broken stubs. The Poly Haven textures and HDRIs are only an alphabetical a..b slice. Unity packs H..Z are cache-only. The VPStudio Ventilation pack is a truncated download. The Google-CSS woff2 numbering does not follow the CSS order. Synty FBX import at 0.01 scale. Several Unity FBX import invisible until their alpha is forced to 1.

## 0. Method
- Inventory: `F:/games/forgeflow-games-assets` (3d-models, `_downloaded/*`, generated-materials), `F:/games/unity-assets` (extracted), `F:/games/unity-asset-cache` (.unitypackage; listed with `tools/research/env_unitypkg.py`, 29 listings saved in `unitypackage_listings/`, selected assets extracted to the session scratchpad only).
- Measurement: `tools/research/env_render_models.py` (Blender 5.1.2 headless; imports GLB/glTF/FBX, forces opaque materials, counts evaluated triangles, reads loaded image sizes and world bbox, renders a 3/4 EEVEE preview). Textures: PIL header sizes. HDRIs: `env_hdri_preview.py` (auto-exposed to mean 0.18; luminance stats measured on a 512x256 downsample, so max values are lower than full-res).
- Sheets: `env_sheet.py`, `env_tex_sheet.py` (albedo tiled 2x2 so seams show; N/R insets), `env_font_sheet.py`, `env_picks.py` (curated per-set picks), `env_build_kit.py` (writes env_kit.json).
- Preview caveat: Unity FBX do not embed textures. The renderer attaches one albedo (explicit or name-matched). Multi-material props can therefore preview with one wrong texture. Where that happened it is flagged (VPStudio lamps, polyperfect atlas).

## 0.1 Source inventory facts (measured)
- `_downloaded/polyhaven-textures`: **40 sets only, alphabetical slice** aerial_asphalt_01..bitumen. Maps are diffuse/rough/ao/displacement jpg, 2048 wide (the 17 measured are 2048x2048 except beige_wall_002 at 2048x512), **no normal map**.
- `_downloaded/polyhaven-hdris`: **40 HDRIs only** (abandoned_bakery..anniversary_lounge). 2k .hdr each, 4k for the first 20. None of them is a night sky.
- `_downloaded/polyhaven-models`: 40 folders, **all 40 are .gltf JSON stubs whose .bin + textures are missing** (every uri checked). Television_01 and Camera_01 are unusable until re-downloaded.
- `F:/games/unity-assets`: 66 extracted packs, **publishers 1..G only** (digits 6, A 15, B 8, C 6, D 13, E 12, F 4, G 2). Everything from H to Z exists only as .unitypackage in the cache. That includes Synty, SICS, VPStudio, Mnostva, Tidal Flask, polyperfect and Game Buffs.
- `3d-models/UNITY_MODELS_INDEX.json`: 1409 GLB conversions from 10 packs only.
- `generated-materials`: 17 xAI-generated sets, 1024x1024 albedo/normal/rough/ao webp (original IP). Caution: `iron_plate` renders as black quilted leather, not metal, so its name misleads.
- Corrupt/incomplete cache entries: `VPStudio 3d/.../Ventilation System pack.unitypackage` (gzip "ended before the end-of-stream marker"). Several `Magic Pig Games` entries are 0-byte `.tmp.json`.
- **Decals are essentially absent:** a keyword search (splat/blood/decal/graffiti/poster/crack/grunge/stain/leak/scorch...) over both texture trees found only Blink Cracked_Concrete_Floor and `JP_Grunge_Mask.tga` (2048x2048, masks packed in RGB, alpha empty).

## 1. Set 1 - THE RUST THEATER  (verdict: STRONG)
Sheets: `sheets/set1_picks.png` (curated), `set1_models_all.png`, `set1_textures.png`, `set1_gyp_models.png`, `set1_qmd_rerender.png`.

What I saw on the sheets:
- **Walls:** `GYP Wall_Rock_01_Blue` is dark blue-slate painted stone and tiles cleanly at 2x2. It is the closest thing to the reference's blue-painted brick. `QMV T_Brick` is light-grey brick, so a shader multiply-tint gives blue-painted brick under a CC0 licence. `GYP Wall_Brick_Damaged_01` (plaster with exposed brick) sells "condemned".
- **Doors:** `qmv_Door_4_Flat` (wood with an iron lattice), `qmv_Door_1_Round` and `qmd_Arch_Door` are all stylised wood with iron bands, a direct match for the "iron-banded wooden doors". `astro_Door_RectangleTall` is the photoreal dark alternative, but it clashes with the painted kit.
- **Fire and light:** `qfp_Torch_Metal`, `qfp_Lantern_Wall` and `qfp_Chandelier` (hand-painted metal).
- **Dressing:** `qfp_Cage_Small`, `qfp_Chain_Coil`, `qmd_Cobweb`, `qmd_Arch_bars`, `qmd_Trapdoor` (environment-kill hook) and `qmd_Spikes`.
- **Curtains:** `fant_curtain_01/02/03/04` + `fant_curtainrod` are red velvet drapes; 01/02/03 are 2.16-2.17 m tall and 04 is a 0.65 m pelmet, at 108-188 tris. Good for side drapes, but too small for a proscenium.
- **Stage and trim:** `FANTASTIC PlanksLong_01` gives stage floorboards. `Blink Stone_Gate` is an art-deco gold-on-black panel for the proscenium trim.
- **HDRI:** `ph_afrikaans_church_interior` (dark red, arched, mean 0.734) is the best theatre fill.
- **Masks and fire:** Kenney `light-masks/Default/circle_a_streaks.png` works as a spotlight gobo. `Deko TorchFire01` (1024 flipbook) covers torch flames.
- Rejected: Kenney graveyard kit (toy pastel colormap at 512 px, e.g. stone-wall 60 tris); Astrofish walls (photoreal, dark, 4K; style clash); GYP meshes (walls and doors are 12-tri boxes, so only GYP *textures* are recommended).

Thin, so procedural: stage spotlights/fresnels (no good model; LPU Spotlight is 204 tris flat-colour; VPStudio lamps preview mis-textured), a proscenium arch plus a torn curtain at stage scale, and seating rows / balcony rail.

## 2. Set 2 - BUTCHER BLOCK  (verdict: THIN)
Sheets: `sheets/set2_picks.png`, `set2_textures.png`, `props_cache_A_interior.png`.
- Textures present:
  - `Blink Boss_Floor_1`: black/white marble checker, the best kitchen floor.
  - `GEN floor_marble`: white marble blocks, the closest thing to white tile.
  - `PH anti_slip_concrete`: dotted non-slip concrete.
  - `JP Ceiling`: white plaster.
  - `QFP T_Trim_Metal`: grey trim sheet.
- **Missing entirely:** white ceramic/subway tile, brushed stainless steel, meat hooks, hanging carcasses and a walk-in freezer. The FANTASTIC "hooks" are 0.1-0.2 m wall coat hooks, and `fant_meat` is a 64-tri steak.
- Usable props:
  - Mnostva fridges (586-1562 tris), `mno_Gas_stove_1` (4816 tris), cabinets and a hood. All are pastel "cozy cartoon", so recolour them or use them only as set-dressing.
  - `fant_safe_door` works as a freezer-door stand-in at 0.5x0.7 m, but it needs scaling or rebuilding.
  - `jp_JP_Water_Heater` and `thb_TH_Shipping_Metal_Crate_01A` (as a chest freezer).
- HDRI: `ph_abandoned_factory_canteen_01` (cool white canteen, mean 0.650). `ph_abandoned_tiled_room` previews as a tan/wood room despite its name.
- Procedural list: a tile shader (grout, per-tile tint, grime mask), brushed-steel counters and prep tables, meat hooks on a rail with chains, a walk-in freezer door plus strip curtain, and the cooking-show host counter. **Hanging carcasses are the one organic hero gap**: they need a sculpt, or an owner-approved generator (spend-gated).

## 3. Set 3 - WHEEL OF PAIN  (verdict: VERY THIN)
Sheets: `sheets/set3_picks.png`, `set3_textures.png`, `props_cache_B_lowpoly.png`.
- Textures carry the look:
  - `Blink Dwarven_Casting_Wall`: dark, with glowing orange/teal zigzag bands. It reads as a retro game-show wall.
  - `Blink Golden_Wall`: orange geometric.
  - `Blink Boss_Floor_1`: checker.
  - `GameBuffs Marble_Surface_20`: white marble with gold veins, for a glossy floor.
  - `Blink Stone_Gate`: deco panel.
  - `GameBuffs Roman_Patterned_Floor_1`: gold pattern.
- Models are background-only. The polyperfect trophy, truss, stage platform, moving-head light, spotlight, TV camera and mic stand are all flat-colour low poly (68-338 tris). The `mno_Neon_Sign_*` pieces carry fixed English slogans. `qmd_Trapdoor` is medieval.
- HDRI: `ph_aft_lounge` (dark with bright lamps, mean 0.822) and `ph_adams_place_bridge` (dark with strip lights).
- Procedural list:
  - the **giant spinning wheel** (hero prop)
  - contestant podiums
  - flush show trapdoors with hazard stripes and hinge animation
  - truss and marquee bulb strips
  - a glossy black stage floor with LED strips
  - audience bleachers

## 4. Set 4 - CHANNEL 13 ROOFTOP  (verdict: GOOD)
Sheets: `sheets/set4_picks.png`, `set4_textures.png`, `props_local_jp_kenney.png`, `props_cache_C_urban.png`, `hdri_skies.png`.
- Japan Village is semi-real PBR with 2048 maps:
  - 4 AC units (1423-2193 tris)
  - propane tank (1348), water heater (2426), electric and gas meters, utility pole (1084)
  - railing (212), metal fence (504), roof hatch (54), window grid, cable mounts
- SICS Toon City is flat toon:
  - water towers (335 tris each)
  - turbine air vent, antenna, billboard frames 1A/3A, emergency stairs, skylight, industrial vent, light projector
- Toon Harbor: roof service entrance and pipe cluster. Synty: roof billboard frame and roof access hut.
- Avoid `tcy_Billboard_2A`: it prints the SICS logo.
- Textures:
  - `PH bitumen`: roofing felt with roll bands.
  - `PH asphalt_02` (with cracks) and `asphalt_pit_lane`.
  - `GameBuffs Cracked_Asphalt_5`: stylised.
  - `PH asbestos_sheet_02`: corrugated.
  - `JP Concrete` and `JP Red_Brick` for the parapet.
  - `JP Road_Hatches`: an atlas of vents, grates and manholes.
- Sky: **`jp_Sky_Night_4a` is the only night sky in the library.** It is a purple starry dusk with a sunset glow on the horizon (EXR 4096x2048, mean 0.050). The Acronym toon skies 79/80 are dusk but LDR (max 0.8), so they work as backdrops only.
- Procedural list: rain (particles plus wet roughness and ripple normals), neon tube signs with an original CHANNEL 13 logo, a skyline card, and parapet walls. The Kenney low-detail building GLBs render magenta because their external colormap is missing, so wire `_colormaps/city-commercial.png` if they are used.

## 5. Set 5 - THE CONTROL ROOM  (verdict: MIXED)
Sheets: `sheets/set5_picks.png`, `set5_textures.png`, `props_cache_D_industrial.png`, `props_cache_D2_industrial.png`.
- Pipes, tanks and fittings:
  - Toon Harbor: giant pipe straight/corner (224/464 tris), pipe cluster (520), liquid tank (1114, a boiler stand-in), metal stairs (184).
  - Synty Dungeons: large valve wheel (194), floor drain grate (448), barred door (1186), chain (896).
- Cables and dressing:
  - VPStudio: cable trunk (1759 tris, 4096 maps), wire bunches and damaged wires (realistic).
  - Japan Village meters and cable mounts.
  - JP classroom: wall PA speaker (68 tris) and projection screen (596).
- Textures: `Blink Cracked_Concrete_Floor`, `PH asbestos_sheet` (rust-brown corrugated), `JP Concrete`, and the `JP Road_Hatches` and `JP Meters` atlases.
- **CRT monitor banks are the hero gap.** The only CRTs are `lpu_Television_Old` (108 tris, flat colour) and `mno_TV_1` (cartoon pastel), and Poly Haven Television_01 is a broken stub. The boiler and metal grating/catwalk floors are also gaps.
- VPStudio lamps (e.g. `vpl_Lamp_5`, 2214 tris) previewed with orange patches, which suggests a UV/atlas mismatch. Verify them before use.
- HDRI: `ph_abandoned_garage` (mean 0.599), `ph_aircraft_workshop_01` (0.430), `ph_abandoned_bakery`.

## 6. Shared: HDRIs, decals, light masks, VFX
- Full HDRI sheets: `sheets/hdri_polyhaven.png` (40, CC0), `sheets/hdri_skies.png` (Japan Village EXR x2 plus 20 Acronym toon skies at 8192x4096 whose measured max is 0.7-1.0, so they are LDR backdrops, not light sources).
- Light masks: Kenney Light Masks, 152 files in Default (plus Inverted and Transparent), 512x512, CC0. Circles with streaks/noise work as gobos and cookies for stage lights.
- Fire and smoke: Deko Animated Fire Textures (TorchFire01/02, Fire01-03, candle flipbooks; TorchFire01 measured 1024x1024) and CamelotVFX sprite sheets (fire, flamethrower, oil-rig, smoke; Fire_Sprites_v1 and Smoke_Sprites_Dense measured 4096x4096). Both are EULA.
- Decals (blood splat, posters, graffiti, stains, scorch): **none in the library**. They must come from a procedural 2D generator (metaball splats plus droplets). Posters need original art.

## 7. Fonts + HUD
Sheets: `sheets/fonts_specimen.png`, `sheets/hud_font_mock.png` (LIVE bug, slanted yellow score frame, caption bar and round/timer, mocked in each display font).
- **Display:** `Bungee` is the loudest and suits the LIVE bug and score. `Russo One` has chunky, very readable digits. `Bebas Neue` is condensed, for the round/timer and lower-thirds. `Acme` is casual comic for host captions. All SIL OFL.
- **Body:** `Oswald 400` (readable in the mock caption bar). Alternatives are `Nunito 800` (from `games/dyefield/dist/assets`) and `Liberation Sans`. All SIL OFL.
- **Screens (control room):** `VT323`, `Press Start 2P`, `Share Tech Mono`. All OFL.
- **Use these exact woff2 files.** The Latin subset is not the last-numbered file. Checked via cmap: Bebas_01, Bungee_02, IBM_Plex_Mono_03, Orbitron_00, Oswald_02, Pixelify_Sans_02, Press_Start_2P_00, Russo_One_01, Silkscreen_00, VT323_00. Every family ships **weight 400 only**, so a bold Oswald would have to be fetched.
- **Avoid** the Alchemist Lab bundled fonts with unverified third-party licences (Agency FB, Sonic XB, Space Bd, Starliner, Amputa Bangiz, Ticker Tape, Neuropol and others). Amputa Bangiz also renders its comma as a cat-face glyph.
- **Input prompts:** Kenney Input Prompts 1.4.1 (CC0), 64x64 PNG (sampled), with matching SVG and spritesheets. Keyboard & Mouse 243, Xbox 99, PlayStation 134, Touch 28, Generic 36, Flairs 93.
- **Mobile controls:** Kenney Mobile Controls 1.0 (CC0), 8 styles x 46 sprites (buttons, d-pads, joystick pads and nubs), 42 icons, 2x26 highlights, 462 SVG.

## 8. Thin spots + procedural build list (with the quality bar)
Owner rule: no primitive hero assets. A procedural prop ships only if it passes all of these:
1. **Silhouette:** every hard edge is bevelled (no raw box/cylinder faces), with secondary detail at 3 m (bolts, rims, seams, panel lines).
2. **Material parity:** PBR with a normal map and a roughness break-up that matches the painted kit's saturation. Judge it in the same render as 2 library props under the same HDRI.
3. **Side-by-side test:** a Blender contact render next to `qfp_Chandelier` + `jp_JP_Conditioner_01`. A reviewer should not be able to pick the procedural one out by flat shading or missing wear.
4. **Budget:** hero props 5k-20k tris with 2048 maps; instanced dressing up to 2k tris.
5. **Motion:** props that move (wheel, trapdoor, CRT flicker) are judged in motion, not as a still.

| Gap | Set | Why the library fails (measured/seen) | Build approach |
|---|---|---|---|
| Giant spinning wheel | 3 | nothing exists | lathe rim + N segments + bulb ring (instanced emissive) + pegs + flapper; segment labels via canvas texture |
| Podiums, trapdoors, truss/marquee | 3 | LPU pieces 68-338 tris, flat colour | bevelled kit pieces, hazard-stripe decal, instanced truss tubes, bulb strips |
| CRT monitor banks | 5 | LPU CRT 108 tris; PH Television_01 broken stub | rounded-box shell + curved screen, scanline/noise emissive shader, instanced racks |
| Boiler, grating/catwalk, diamond plate | 5 | stand-in only (Toon Harbor tank) | riveted cylinder + gauges; alpha-cut grate shader |
| White tile, brushed steel, meat hooks, freezer | 2 | no textures/props (see sec 2) | tile/grout shader; anisotropic brushed metal; curve-swept hooks + chain |
| Hanging carcasses | 2 | only a 64-tri steak / 92-tri haunch | NOT a good procedural candidate; sculpt or spend-gated generator (owner call) |
| Stage spotlights, proscenium, seating | 1 | LPU spotlight 204 tris; curtains 2.2 m | fresnel/par can model; scale cloth drape; row-instanced seats |
| Rain, neon tubes, skyline | 4 | no rain/neon assets | particles + wet shader; emissive spline tubes; skyline cards |
| Decals (blood, posters, stains) | all | none in the library | procedural splat generator; original poster art |

Zero-cost ways to widen the library (each needs the owner's OK because they are downloads):
- Re-download Poly Haven beyond the a..b slice (CC0). Tile, metal plate and night-HDRI categories exist there, but I did not search them this session.
- Re-download the truncated VPStudio Ventilation pack.
- Extract more of the H..Z cache.
- `pipeline/art/gen_pbr_materials.py` can mint original tile/steel sets, but it calls xAI, so it is spend-gated (use `--dry-run` for the cost).

## 9. Licence summary
- **CC0:** Quaternius (Medieval Village MegaKit, Fantasy Props MegaKit, Modular Dungeon 2019; License files read), Kenney (all `_downloaded` kits, input prompts, mobile controls, light masks; License.txt read), Poly Haven.
- **Original:** `generated-materials` (xAI output made for ForgeFlow).
- **Unity Asset Store EULA:** GYP, Blink, Astrofish, Japan Village, Tidal Flask FANTASTIC, Mnostva, polyperfect, SICS, Synty, VPStudio, Game Buffs, Deko, CamelotVFX, Acronym. Where CC0 and EULA are equal in quality, prefer CC0. Whether the EULA covers shipping these in a web build is the owner's call; this report is not a legal review.
- **SIL OFL 1.1:** every recommended font (Bungee, Russo One, Bebas Neue, Acme, Oswald, Nunito, Liberation Sans, VT323, Press Start 2P, Share Tech Mono).

---
# Appendix A - measured tables (generated from env_kit.json)
Path prefixes: `ASSETS/` = `F:/games/forgeflow-games-assets/`, `UNITY/` = `F:/games/unity-assets/`, `CACHE` = `F:/games/unity-asset-cache/<package> :: <path inside package>`.

### 1_rust_theater models
| id | tris | max tex | dims m | source | licence | note |
|---|---|---|---|---|---|---|
| qmv_Wall_UnevenBrick_Straight | 56 | 2048 | 2.0x0.41x3.12 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Wall_UnevenBrick_Straight.gltf` | CC0 (Quaternius) |  |
| qmv_Wall_UnevenBrick_Door_Round | 136 | 2048 | 2.0x0.41x3.12 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Wall_UnevenBrick_Door_Round.gltf` | CC0 (Quaternius) |  |
| qmv_DoorFrame_Round_Brick | 2046 | 2048 | 1.6x0.48x2.59 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/DoorFrame_Round_Brick.gltf` | CC0 (Quaternius) |  |
| qmv_Door_4_Flat | 1044 | 2048 | 1.12x0.21x2.09 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Door_4_Flat.gltf` | CC0 (Quaternius) |  |
| qmv_Door_1_Round | 470 | 2048 | 1.12x0.12x2.32 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Door_1_Round.gltf` | CC0 (Quaternius) |  |
| qmv_Floor_UnevenBrick | 4 | 2048 | 2.0x2.0x0.02 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Floor_UnevenBrick.gltf` | CC0 (Quaternius) |  |
| qmv_Floor_WoodDark | 32 | 2048 | 2.0x2.0x0.02 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Floor_WoodDark.gltf` | CC0 (Quaternius) |  |
| qmv_Wall_Arch | 196 | 2048 | 2.0x0.06x3.0 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Wall_Arch.gltf` | CC0 (Quaternius) |  |
| qmv_Prop_MetalFence_Ornament | 3988 | 1024 | 1.95x0.16x2.85 | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/glTF/Prop_MetalFence_Ornament.gltf` | CC0 (Quaternius) |  |
| qfp_Torch_Metal | 970 | 2048 | 0.22x0.39x0.65 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Torch_Metal.gltf` | CC0 (Quaternius) |  |
| qfp_Lantern_Wall | 2822 | 2048 | 0.36x1.3x1.34 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Lantern_Wall.gltf` | CC0 (Quaternius) |  |
| qfp_Chandelier | 5680 | 2048 | 1.3x1.3x1.46 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Chandelier.gltf` | CC0 (Quaternius) |  |
| qfp_Cage_Small | 4588 | 2048 | 0.85x0.88x0.81 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Cage_Small.gltf` | CC0 (Quaternius) |  |
| qfp_Chain_Coil | 3744 | 2048 | 1.07x0.91x0.09 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Chain_Coil.gltf` | CC0 (Quaternius) |  |
| qfp_Barrel | 824 | 2048 | 0.7x0.7x0.9 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Barrel.gltf` | CC0 (Quaternius) |  |
| qfp_Crate_Metal | 2738 | 2048 | 0.86x0.87x0.87 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Crate_Metal.gltf` | CC0 (Quaternius) |  |
| qfp_WeaponStand | 2084 | 2048 | 1.39x0.98x1.11 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/WeaponStand.gltf` | CC0 (Quaternius) |  |
| qfp_Banner_1_Cloth | 138 | 2048 | 0.81x0.06x2.25 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Banner_1_Cloth.gltf` | CC0 (Quaternius) |  |
| qfp_Bucket_Metal | 540 | 2048 | 0.48x0.45x0.36 | `ASSETS/3d-models/fantasy-props-mega/Exports/glTF/Bucket_Metal.gltf` | CC0 (Quaternius) |  |
| fant_curtain_01 | 108 | 2048 | 0.86x0.16x2.17 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_curtain_interior_01.fbx` | Unity Asset Store EULA |  |
| fant_curtain_02_01 | 188 | 2048 | 0.86x0.18x2.17 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_curtain_interior_02_01.fbx` | Unity Asset Store EULA |  |
| fant_curtain_03 | 182 | 2048 | 0.85x0.18x2.16 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_curtain_interior_03.fbx` | Unity Asset Store EULA |  |
| fant_curtain_04 | 122 | 2048 | 0.85x0.18x0.65 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_curtain_interior_04.fbx` | Unity Asset Store EULA |  |
| fant_curtainrod | 152 | 2048 | 2.58x0.12x0.11 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_curtainrod_interior.fbx` | Unity Asset Store EULA |  |
| qmd_Arch_Door | 1220 | - | 2.42x0.33x3.19 | `ASSETS/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/Arch_Door.fbx` | CC0 (Quaternius) |  |
| qmd_Trapdoor | 504 | - | 1.74x1.7x0.22 | `ASSETS/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/Trapdoor.fbx` | CC0 (Quaternius) |  |
| qmd_Cobweb | 1108 | - | 1.21x0.91x0.75 | `ASSETS/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/Cobweb.fbx` | CC0 (Quaternius) |  |
| qmd_Arch_bars | 1603 | - | 2.48x0.03x3.39 | `ASSETS/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/Arch_bars.fbx` | CC0 (Quaternius) |  |
| qmd_Spikes | 504 | - | 1.76x1.76x1.18 | `ASSETS/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/Spikes.fbx` | CC0 (Quaternius) |  |
| qmd_Torch | 386 | - | 0.28x0.44x1.15 | `ASSETS/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/Torch.fbx` | CC0 (Quaternius) |  |
| astro_Door_RectangleTall | 1476 | 4096 | 1.31x0.29x2.56 | `UNITY/Astrofish Games__DETAILED - Medieval Village/Assets/ASTROFISH_GAMES/MEDIEVAL_SERIES/MEDIEVAL_VILLAGE_HD/_Assets/Doors/Mods/Medieval_Door_RectangleTall.FBX` | Unity Asset Store EULA | photoreal/dark - alt only; clashes with the painted kit |
| astro_IronFixtures_TorchBracket | 1255 | 4096 | 0.43x0.67x1.04 | `UNITY/Astrofish Games__DETAILED - Medieval Village/Assets/ASTROFISH_GAMES/MEDIEVAL_SERIES/MEDIEVAL_VILLAGE_HD/_Assets/Iron/Mods/Medieval_IronFixtures_TorchBracket.FBX` | Unity Asset Store EULA | photoreal alt |

### 1_rust_theater textures
| texture | albedo size | maps | path | licence | note |
|---|---|---|---|---|---|
| GYP Wall_Rock_01 BLUE (painted stone wall - closest match to the reference's blue brick) | 2048x2048 | albedo+normal | `UNITY/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/Wall/Rock/Wall_Rock_01_Blue_Albedo.tif` | Unity Asset Store EULA |  |
| QMV T_Brick (light grey brick; multiply-tint blue in shader) | 2048x2048 | albedo+normal+rough | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/Textures/T_Brick_BaseColor.png` | CC0 (Quaternius) |  |
| GYP Wall_Brick_Damaged_01 (plaster with exposed brick - condemned look) | 2048x2048 | albedo+normal | `UNITY/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/Wall/Damaged/Wall_Brick_Damaged_01_Albedo.tif` | Unity Asset Store EULA |  |
| QMV T_UnevenBrick (stone floor/wall) | 2048x2048 | albedo+normal+rough | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/Textures/T_UnevenBrick_BaseColor.png` | CC0 (Quaternius) |  |
| FANTASTIC PlanksLong_01 v1 (stage floorboards) | 2048x2048 | albedo+normal | `CACHE :: Assets/Fantastic Interior Pack/2d/textures/T_ENV_MOD_Interior_PlanksLong_01_v1_BC.png` | Unity Asset Store EULA |  |
| GYP Wall_Wood_01 (wood wall) | 2048x2048 | albedo+normal | `UNITY/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/Wall/Wood/Wall_Wood_01_Albedo.tif` | Unity Asset Store EULA |  |
| GYP Door_Wood_01 BLUE / RED (door plank atlas, asset UVs) | 2048x2048 | albedo+normal | `UNITY/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/Door/Door_Wood_01/Door_Wood_01_Blue_Albedo.tif` | Unity Asset Store EULA |  |
| Blink Stone_Gate | 2048x2048 | albedo+normal+rough | `UNITY/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/Stone_Gate/Stone_Gate_BaseColor.png` | Unity Asset Store EULA | art-deco gold-on-black panel: proscenium/trim |
| FANTASTIC T_PROP_fabrics (curtain cloth, red) | 2048x2048 | albedo | `CACHE :: Assets/Fantastic Interior Pack/2d/textures/T_PROP_fabrics_interior_BC.png` | Unity Asset Store EULA |  |
| QMV T_RockTrim + T_WoodTrim trim sheets | 2048x2048 | albedo+normal | `ASSETS/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/Textures/T_RockTrim_BaseColor.png` | CC0 (Quaternius) |  |

### 1_rust_theater HDRI
- `ASSETS/_downloaded/polyhaven-hdris/afrikaans_church_interior/afrikaans_church_interior_2k.hdr` 2048x1024 mean 0.734 (512x256 downsample) - dark red interior with arches - theatre-like fill
- `ASSETS/_downloaded/polyhaven-hdris/abandoned_workshop_02/abandoned_workshop_02_2k.hdr` 2048x1024 mean 0.700 (512x256 downsample) - dim vaulted derelict
- `ASSETS/_downloaded/polyhaven-hdris/anniversary_lounge/anniversary_lounge_2k.hdr` 2048x1024 mean 0.654 (512x256 downsample) - warm lamp-lit interior

### 2_butcher_block models
| id | tris | max tex | dims m | source | licence | note |
|---|---|---|---|---|---|---|
| mno_Fridge_1 | 666 | 2048 | 1.11x0.86x2.08 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/Fridge_1.fbx` | Unity Asset Store EULA |  |
| mno_Fridge_2 | 586 | 2048 | 1.1x0.79x2.15 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/Fridge_2.fbx` | Unity Asset Store EULA |  |
| mno_Fridge_4 | 716 | 2048 | 1.11x1.07x2.08 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/Fridge_4.fbx` | Unity Asset Store EULA |  |
| mno_Gas_stove_1 | 4816 | 2048 | 1.05x1.05x1.01 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/Gas_stove_1.fbx` | Unity Asset Store EULA |  |
| mno_Kitchen_Cabinet_3 | 890 | 2048 | 1.11x0.76x0.98 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/Kitchen_Cabinet_3.fbx` | Unity Asset Store EULA |  |
| mno_Kitchen_Hood_1 | 356 | 2048 | 1.25x0.62x1.76 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/Kitchen_Hood_1.fbx` | Unity Asset Store EULA |  |
| fant_meat | 64 | 2048 | 0.24x0.34x0.07 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_meat_interior.fbx` | Unity Asset Store EULA |  |
| fant_knife | 68 | 2048 | 0.04x0.3x0.01 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_knife_interior.fbx` | Unity Asset Store EULA |  |
| fant_safe_door | 396 | 2048 | 0.53x0.19x0.72 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_safe_door_interior.fbx` | Unity Asset Store EULA |  |
| jp_JP_Water_Heater | 2426 | 2048 | 0.19x0.51x0.79 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Water_Heater.fbx` | Unity Asset Store EULA |  |
| jp_JP_Propane | 1348 | 2048 | 0.43x0.43x0.84 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Environment/JP_Propane.fbx` | Unity Asset Store EULA |  |
| thb_TH_Shipping_Metal_Crate_01A | 198 | 1024 | 2.0x2.02x1.99 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Shipping_Metal_Crate_01A.fbx` | Unity Asset Store EULA |  |
| lpu_Meat_Haunch_A | 92 | 1024 | 0.69x0.28x0.26 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Tribal_M/SM_Meat_Haunch_A.fbx` | Unity Asset Store EULA | 92 tris - background only |
| fant_hook_01 | 94 | 2048 | 0.18x0.16x0.21 | `CACHE Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage :: Assets/Fantastic Interior Pack/3d/PROPS/SM_PROP_hook_interior_01.fbx` | Unity Asset Store EULA | wall COAT hook 0.2 m - NOT a meat hook |

### 2_butcher_block textures
| texture | albedo size | maps | path | licence | note |
|---|---|---|---|---|---|
| Blink Boss_Floor_1 | 2048x2048 | albedo+normal+rough | `UNITY/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/Boss_Floor_1/Boss_Floor_1_BaseColor.png` | Unity Asset Store EULA | black/white marble checker - kitchen floor |
| GEN floor_marble | 1024x1024 | albedo+normal+rough | `ASSETS/generated-materials/floor_marble_albedo.webp` | original (xAI-generated for ForgeFlow) | white marble blocks - closest thing to white tile |
| PolyHaven anti_slip_concrete | 2048x2048 | albedo+rough | `ASSETS/_downloaded/polyhaven-textures/anti_slip_concrete/diffuse.jpg` | CC0 (Poly Haven) | dotted non-slip concrete floor (no normal map in the local download; displacement.jpg + ao.jpg present) |
| JapanVillage JP_Ceiling | 2048x2048 | albedo+normal | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/House/JP_Celling/JP_Ceiling_A.tga` | Unity Asset Store EULA | plain white plaster |
| QFP T_Trim_Metal (grey metal trim sheet) | 2048x2048 | albedo+normal | `ASSETS/3d-models/fantasy-props-mega/Textures/T_Trim_Metal_BaseColor.png` | CC0 (Quaternius) |  |

### 2_butcher_block HDRI
- `ASSETS/_downloaded/polyhaven-hdris/abandoned_factory_canteen_01/abandoned_factory_canteen_01_2k.hdr` 2048x1024 mean 0.650 (512x256 downsample) - cool white canteen - best kitchen fill
- `ASSETS/_downloaded/polyhaven-hdris/abandoned_tiled_room/abandoned_tiled_room_2k.hdr` 2048x1024 mean 0.656 (512x256 downsample) - despite the name, previews as a tan/wood derelict room

### 3_wheel_of_pain models
| id | tris | max tex | dims m | source | licence | note |
|---|---|---|---|---|---|---|
| lpu_Trophy_Gold_Big | 232 | 1024 | 0.36x0.28x0.38 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Furniture_M/SM_Trophy_Gold_Big.fbx` | Unity Asset Store EULA | flat-colour low poly - background only |
| lpu_Stage_Truss | 240 | 1024 | 0.5x0.5x2.03 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Music_M/SM_Stage_Truss.fbx` | Unity Asset Store EULA | flat-colour low poly - background only |
| lpu_Stage_Platform_Big | 68 | 1024 | 4.0x2.0x2.0 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Music_M/SM_Stage_Platform_Big.fbx` | Unity Asset Store EULA | flat-colour low poly - background only |
| lpu_Light_Moving | 314 | 1024 | 0.41x0.3x0.67 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Music_M/SM_Light_Moving.fbx` | Unity Asset Store EULA | flat-colour low poly - background only |
| lpu_Spotlight | 204 | 1024 | 0.61x0.61x0.69 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Music_M/SM_Spotlight.fbx` | Unity Asset Store EULA | flat-colour low poly - background only |
| lpu_Tv_Camera | 338 | 1024 | 0.27x0.62x0.29 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Electronics_M/SM_Tv_Camera.fbx` | Unity Asset Store EULA | flat-colour low poly - background only |
| lpu_Microphone_Stand | 264 | 1024 | 0.65x0.79x1.41 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Music_M/SM_Microphone_Stand.fbx` | Unity Asset Store EULA | flat-colour low poly - background only |
| mno_Neon_Sign_4 | 1849 | 2048 | 0.88x0.03x0.83 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/Neon_Sign_4.fbx` | Unity Asset Store EULA | fixed English slogan - retexture/replace text |
| tcy_Billboard_4A | 564 | 128 | 3.34x3.34x13.79 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Billboard_4A.fbx` | Unity Asset Store EULA | novelty cup sign |
| qmd_Trapdoor | 504 | - | 1.74x1.7x0.22 | `ASSETS/3d-models/modular-dungeon/.Updated Modular Dungeon - May 2019/FBX/Trapdoor.fbx` | CC0 (Quaternius) | medieval style - wrong era |

### 3_wheel_of_pain textures
| texture | albedo size | maps | path | licence | note |
|---|---|---|---|---|---|
| Blink Dwarven_Casting_Wall | 2048x2048 | albedo+normal+rough | `UNITY/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/Dwarven_Casting_Wall/Dwarven_Casting_Wall_BaseColor.png` | Unity Asset Store EULA | dark with glowing orange/teal zigzag bands - retro game-show wall |
| Blink Golden_Wall | 2048x2048 | albedo+normal+rough | `UNITY/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/Golden_Wall/Golden_Wall_BaseColor.png` | Unity Asset Store EULA | orange geometric - 70s/80s show panel |
| Blink Boss_Floor_1 | 2048x2048 | albedo+normal+rough | `UNITY/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/Boss_Floor_1/Boss_Floor_1_BaseColor.png` | Unity Asset Store EULA | checker floor |
| GameBuffs Marble_Surface_20 | 2048x2048 | albedo+normal | `CACHE :: Assets/Game Buffs/Free Stylized Textures/Textures/Marble_Surface_20/Marble_Surface_20_Albedo.png` | Unity Asset Store EULA | white marble + gold veins - glossy show floor |
| Blink Stone_Gate | 2048x2048 | albedo+normal+rough | `UNITY/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/Stone_Gate/Stone_Gate_BaseColor.png` | Unity Asset Store EULA | deco panel |
| GameBuffs Roman_Patterned_Floor_1 | 2048x2048 | albedo+normal | `CACHE :: Assets/Game Buffs/Stylized Historical Textures/Textures/Roman_Patterned_Floor_1/Roman_Patterned_Floor_1_Albedo.png` | Unity Asset Store EULA | gold pattern - podium tops |

### 3_wheel_of_pain HDRI
- `ASSETS/_downloaded/polyhaven-hdris/aft_lounge/aft_lounge_2k.hdr` 2048x1024 mean 0.822 (512x256 downsample) - dark room with bright lamps
- `ASSETS/_downloaded/polyhaven-hdris/adams_place_bridge/adams_place_bridge_2k.hdr` 2048x1024 mean 1.298 (512x256 downsample) - dark with bright strip lights

### 4_channel13_rooftop models
| id | tris | max tex | dims m | source | licence | note |
|---|---|---|---|---|---|---|
| jp_JP_Conditioner_01 | 1946 | 2048 | 0.38x0.76x0.56 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Environment/JP_Conditioner_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Conditioner_03 | 2164 | 2048 | 0.38x0.71x0.58 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Environment/JP_Conditioner_03.fbx` | Unity Asset Store EULA |  |
| jp_JP_Conditioner_05 | 2193 | 2048 | 0.47x0.74x0.56 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Environment/JP_Conditioner_05.fbx` | Unity Asset Store EULA |  |
| jp_JP_Conditioner_07 | 1423 | 2048 | 0.55x0.76x0.57 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Environment/JP_Conditioner_07.fbx` | Unity Asset Store EULA |  |
| jp_JP_Propane | 1348 | 2048 | 0.43x0.43x0.84 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Environment/JP_Propane.fbx` | Unity Asset Store EULA |  |
| jp_JP_Water_Heater | 2426 | 2048 | 0.19x0.51x0.79 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Water_Heater.fbx` | Unity Asset Store EULA |  |
| jp_JP_Electric_Meter_01 | 640 | 2048 | 0.1x0.27x0.54 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Electric_Meter_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Gas_Meter_01 | 2612 | 2048 | 0.13x0.17x0.99 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Gas_Meter_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Electric_Post_01 | 1084 | 2048 | 0.34x2.19x8.98 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Street/JP_Electric_Post_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Railing | 212 | 2048 | 0.09x1.28x0.69 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Street/JP_Railing.fbx` | Unity Asset Store EULA |  |
| jp_JP_Fence_Metal_4m | 504 | 2048 | 0.1x5.0x0.88 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Street/JP_Fence_Metal_4m.fbx` | Unity Asset Store EULA |  |
| jp_JP_Hatch_01 | 54 | 2048 | 0.72x0.72x0.09 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Street/JP_Hatch_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Grid_01 | 1040 | 2048 | 0.24x2.0x0.48 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/House/House_Object/JP_Grid_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Cable_Mounting_01 | 798 | 2048 | 0.08x0.25x0.3 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Cable_Mounting_01.fbx` | Unity Asset Store EULA |  |
| tcy_Water_Tank_1A | 335 | 128 | 3.25x3.25x6.65 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Water_Tank_1A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Water_Tank_1B | 335 | 128 | 3.25x3.25x6.65 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Water_Tank_1B.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Air_Vent_1A | 335 | 128 | 1.98x1.98x2.19 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Air_Vent_1A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Antenna_1A | 476 | 128 | 3.29x2.56x16.69 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Antenna_1A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Billboard_1A | 107 | 128 | 1.61x0.43x3.25 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Billboard_1A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Billboard_3A | 261 | 128 | 3.16x10.4x7.2 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Billboard_3A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Emergency_Stairs_1A | 210 | 128 | 3.2x8.4x4.45 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Emergency_Stairs_1A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Skylight_1A | 70 | 128 | 3.4x7.4x1.29 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Skylight_1A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Industrial_Ventilation_1A | 434 | 128 | 5.44x5.38x2.04 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Industrial_Ventilation_1A.fbx` | Unity Asset Store EULA | flat toon style |
| tcy_Light_Projector_1A | 70 | 128 | 3.36x1.3x0.71 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Light_Projector_1A.fbx` | Unity Asset Store EULA | flat toon style |
| thb_TH_Roof_Service_Entrance_01A | 340 | 1024 | 2.6x4.6x2.62 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Roof_Service_Entrance_01A.fbx` | Unity Asset Store EULA | flat toon style |
| thb_TH_Pipe_Cluster_01A | 520 | 1024 | 1.58x5.69x1.33 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Pipe_Cluster_01A.fbx` | Unity Asset Store EULA | flat toon style |
| syc_Prop_Billboard_Roof_01 | 674 | 1024 | 0.04x0.02x0.03 | `CACHE Synty Studios/3D ModelsEnvironmentsUrban/POLYGON - City Pack - Art by Synty.unitypackage :: Assets/Synty/PolygonCity/Models/SM_Prop_Billboard_Roof_01.fbx` | Unity Asset Store EULA | flat toon style |
| syc_Bld_Roof_Access_01 | 410 | 1024 | 0.03x0.03x0.03 | `CACHE Synty Studios/3D ModelsEnvironmentsUrban/POLYGON - City Pack - Art by Synty.unitypackage :: Assets/Synty/PolygonCity/Models/SM_Bld_Roof_Access_01.fbx` | Unity Asset Store EULA | flat toon style |
| lpu_Water_Tower_Big | 746 | 1024 | 12.24x10.63x34.67 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Buildings_M/SM_Water_Tower_Big.fbx` | Unity Asset Store EULA | 12 m tall, 746 tris - far skyline only |
| tcy_Billboard_2A | 634 | 2000 | 2.0x10.56x10.2 | `CACHE SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage :: Assets/Toon Series/Toon City/Models/Billboard_2A.fbx` | Unity Asset Store EULA | AVOID: carries the SICS brand logo |

### 4_channel13_rooftop textures
| texture | albedo size | maps | path | licence | note |
|---|---|---|---|---|---|
| PolyHaven bitumen | 2048x2048 | albedo+rough | `ASSETS/_downloaded/polyhaven-textures/bitumen/diffuse.jpg` | CC0 (Poly Haven) | roof felt with roll bands (no normal map in the local download; displacement.jpg + ao.jpg present) |
| PolyHaven asphalt_02 | 2048x2048 | albedo+rough | `ASSETS/_downloaded/polyhaven-textures/asphalt_02/diffuse.jpg` | CC0 (Poly Haven) | grey with cracks (no normal map in the local download; displacement.jpg + ao.jpg present) |
| PolyHaven asphalt_pit_lane | 2048x2048 | albedo+rough | `ASSETS/_downloaded/polyhaven-textures/asphalt_pit_lane/diffuse.jpg` | CC0 (Poly Haven) | dark (no normal map in the local download; displacement.jpg + ao.jpg present) |
| GameBuffs Cracked_Asphalt_5 | 2048x2048 | albedo+normal | `CACHE :: Assets/Game Buffs/Free Stylized Textures/Textures/Cracked_Asphalt_5/Cracked_Asphalt_5_Albedo.png` | Unity Asset Store EULA | stylised cracked asphalt |
| PolyHaven asbestos_sheet_02 | 2048x2048 | albedo+rough | `ASSETS/_downloaded/polyhaven-textures/asbestos_sheet_02/diffuse.jpg` | CC0 (Poly Haven) | grey corrugated sheet (no normal map in the local download; displacement.jpg + ao.jpg present) |
| JapanVillage JP_Concrete | 2048x2048 | albedo+normal | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/House/JP_Concrete/JP_Concrete_A.tga` | Unity Asset Store EULA |  |
| JapanVillage JP_Red_Brick | 2048x2048 | albedo+normal | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/House/JP_Red_Brick/JP_Red_Brick_A.tga` | Unity Asset Store EULA | parapet brick |
| JapanVillage JP_Road_Hatches | 2048x2048 | albedo+normal | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/Environment/JP_Road_Hatches/JP_Road_Hatches_A.tga` | Unity Asset Store EULA | vent/manhole/grate decal atlas (asset UVs) |

### 4_channel13_rooftop HDRI
- `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/HDRI/JP_Sky_Night_4a.exr` 4096x2048 mean 0.050 (512x256 downsample) - ONLY night sky in the library: purple starry dusk, sunset glow on horizon (EXR 4096x2048, 91.7 MB file)
- `UNITY/Acronym__20 HDRI Someones Skys - Anime - VOL 4/Assets/Someone's Sky's - Anime - HDRI - VOL. 4/Cubemaps/Toon_sky_79.hdr` 8192x4096 mean 0.149 (512x256 downsample) - dusk toon sky - LDR (max 0.8), backdrop only
- `UNITY/Acronym__20 HDRI Someones Skys - Anime - VOL 4/Assets/Someone's Sky's - Anime - HDRI - VOL. 4/Cubemaps/Toon_sky_80.hdr` 8192x4096 mean 0.184 (512x256 downsample) - dusk toon sky - LDR

### 5_control_room models
| id | tris | max tex | dims m | source | licence | note |
|---|---|---|---|---|---|---|
| thb_TH_Giant_Pipe_Straight_Regular_01A | 224 | 1024 | 2.0x6.0x2.0 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Giant_Pipe_Straight_Regular_01A.fbx` | Unity Asset Store EULA |  |
| thb_TH_Giant_Pipe_Corner_Side_01A | 464 | 1024 | 3.0x3.0x2.0 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Giant_Pipe_Corner_Side_01A.fbx` | Unity Asset Store EULA |  |
| thb_TH_Pipe_Cluster_01A | 520 | 1024 | 1.58x5.69x1.33 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Pipe_Cluster_01A.fbx` | Unity Asset Store EULA |  |
| thb_TH_Liquid_Tank_01A | 1114 | 1024 | 3.02x3.51x7.26 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Liquid_Tank_01A.fbx` | Unity Asset Store EULA |  |
| thb_TH_Metal_Stairs_01A | 184 | 1024 | 1.29x2.57x2.0 | `CACHE SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage :: Assets/Toon Harbor Pack/Models/TH_Metal_Stairs_01A.fbx` | Unity Asset Store EULA |  |
| syd_Gen_Bld_Pipe_Valve_01 | 194 | 1024 | 0.39x0.21x0.39 | `CACHE Synty Studios/3D ModelsEnvironmentsDungeons/POLYGON - Dungeons Pack - Art by Synty.unitypackage :: Assets/Synty/PolygonGeneric/Models/SM_Gen_Bld_Pipe_Valve_01.fbx` | Unity Asset Store EULA |  |
| syd_Env_Grate_Ground_01 | 448 | 1024 | 0.01x0.01x0.0 | `CACHE Synty Studios/3D ModelsEnvironmentsDungeons/POLYGON - Dungeons Pack - Art by Synty.unitypackage :: Assets/Synty/PolygonDungeon/Models/SM_Env_Grate_Ground_01.fbx` | Unity Asset Store EULA |  |
| syd_Env_Door_Bars_01 | 1186 | 1024 | 0.01x0.0x0.02 | `CACHE Synty Studios/3D ModelsEnvironmentsDungeons/POLYGON - Dungeons Pack - Art by Synty.unitypackage :: Assets/Synty/PolygonDungeon/Models/SM_Env_Door_Bars_01.fbx` | Unity Asset Store EULA |  |
| syd_Gen_Prop_Chain_01 | 896 | 1024 | 0.09x0.08x2.29 | `CACHE Synty Studios/3D ModelsEnvironmentsDungeons/POLYGON - Dungeons Pack - Art by Synty.unitypackage :: Assets/Synty/PolygonGeneric/Models/SM_Gen_Prop_Chain_01.fbx` | Unity Asset Store EULA |  |
| vpw_Cable_trunk | 1759 | 4096 | 3.23x0.6x1.54 | `CACHE VPStudio 3d/3D ModelsEnvironmentsIndustrial/Wires pack.unitypackage :: Assets/VP.studio3d/Wire_pack/Models/Cable_trunk.fbx` | Unity Asset Store EULA |  |
| vpw_Bunch_of_wires | 1548 | 4096 | 0.78x0.8x0.19 | `CACHE VPStudio 3d/3D ModelsEnvironmentsIndustrial/Wires pack.unitypackage :: Assets/VP.studio3d/Wire_pack/Models/Bunch_of_wires.fbx` | Unity Asset Store EULA |  |
| vpw_Damaged_wires | 683 | 4096 | 1.01x0.84x0.63 | `CACHE VPStudio 3d/3D ModelsEnvironmentsIndustrial/Wires pack.unitypackage :: Assets/VP.studio3d/Wire_pack/Models/Damaged_wires.fbx` | Unity Asset Store EULA |  |
| vpw_Counter | 86 | 4096 | 0.22x0.12x0.22 | `CACHE VPStudio 3d/3D ModelsEnvironmentsIndustrial/Wires pack.unitypackage :: Assets/VP.studio3d/Wire_pack/Models/Counter.fbx` | Unity Asset Store EULA |  |
| jp_JP_Electric_Meter_01 | 640 | 2048 | 0.1x0.27x0.54 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Electric_Meter_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Gas_Meter_01 | 2612 | 2048 | 0.13x0.17x0.99 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Gas_Meter_01.fbx` | Unity Asset Store EULA |  |
| jp_JP_Cable_Mounting_01 | 798 | 2048 | 0.08x0.25x0.3 | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Props/JP_Cable_Mounting_01.fbx` | Unity Asset Store EULA |  |
| jpc_speaker01_1 | 68 | 1024 | 0.45x0.2x0.34 | `CACHE SbbUtutuya/3D ModelsEnvironments/Japanese School Classroom.unitypackage :: Assets/JP_School classroom_V2/Meshes/speaker01_1.fbx` | Unity Asset Store EULA |  |
| jpc_screen01_1 | 596 | 2048 | 1.9x0.15x2.41 | `CACHE SbbUtutuya/3D ModelsEnvironments/Japanese School Classroom.unitypackage :: Assets/JP_School classroom_V2/Meshes/screen01_1.fbx` | Unity Asset Store EULA |  |
| lpu_Television_Old | 108 | 1024 | 0.7x0.36x0.49 | `CACHE polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage :: Assets/polyperfect/Low Poly Ultimate Pack/_M/Meshes_M/Electronics_M/SM_Television_Old.fbx` | Unity Asset Store EULA | CRT but 108 tris flat-colour - reject for hero |
| mno_TV_1 | 2070 | 2048 | 0.84x0.4x1.03 | `CACHE Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage :: Assets/Mnostva_Art/Meshes/Interiors/TV_1.fbx` | Unity Asset Store EULA | cartoon pastel TV - reject |
| vpl_Lamp_5 | 2214 | 4096 | 0.55x0.54x1.73 | `CACHE VPStudio 3d/3D ModelsEnvironmentsIndustrial/Best Lamps pack.unitypackage :: Assets/VP.studio3d/Lamp_pack/Models/Lamp_5.fbx` | Unity Asset Store EULA | industrial pendant lamp 2214 tris - preview mis-textured (orange patches), verify UVs before use |

### 5_control_room textures
| texture | albedo size | maps | path | licence | note |
|---|---|---|---|---|---|
| Blink Cracked_Concrete_Floor | 2048x2048 | albedo+normal+rough | `UNITY/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/Cracked_Concrete_Floor/Cracked_Concrete_Floor_BaseColor.png` | Unity Asset Store EULA |  |
| PolyHaven asbestos_sheet | 2048x2048 | albedo+rough | `ASSETS/_downloaded/polyhaven-textures/asbestos_sheet/diffuse.jpg` | CC0 (Poly Haven) | rusty-brown corrugated sheet (no normal map in the local download; displacement.jpg + ao.jpg present) |
| JapanVillage JP_Concrete | 2048x2048 | albedo+normal | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/House/JP_Concrete/JP_Concrete_A.tga` | Unity Asset Store EULA |  |
| JapanVillage JP_Road_Hatches | 2048x2048 | albedo+normal | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/Environment/JP_Road_Hatches/JP_Road_Hatches_A.tga` | Unity Asset Store EULA | grate/manhole decals |
| JapanVillage JP_Meters | 2048x2048 | albedo+normal | `UNITY/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/Environment/JP_Meters/JP_Meters_A.tga` | Unity Asset Store EULA | panel/meter atlas |
| GEN bronze_worn | 1024x1024 | albedo+normal+rough | `ASSETS/generated-materials/bronze_worn_albedo.webp` | original (xAI-generated for ForgeFlow) | brass fittings |

### 5_control_room HDRI
- `ASSETS/_downloaded/polyhaven-hdris/abandoned_garage/abandoned_garage_2k.hdr` 2048x1024 mean 0.599 (512x256 downsample) - dark industrial
- `ASSETS/_downloaded/polyhaven-hdris/aircraft_workshop_01/aircraft_workshop_01_2k.hdr` 2048x1024 mean 0.430 (512x256 downsample) - industrial with machinery
- `ASSETS/_downloaded/polyhaven-hdris/abandoned_bakery/abandoned_bakery_2k.hdr` 2048x1024 mean 0.703 (512x256 downsample) - dark derelict interior


# Appendix B - files
- Sheets (all Read during this session): `sheets/fonts_specimen.png`, `sheets/gamebuffs_textures.png`, `sheets/hdri_polyhaven.png`, `sheets/hdri_skies.png`, `sheets/hud_font_mock.png`, `sheets/hud_sprites_masks_vfx.png`, `sheets/props_cache_A_interior.png`, `sheets/props_cache_B_lowpoly.png`, `sheets/props_cache_C_urban.png`, `sheets/props_cache_D2_industrial.png`, `sheets/props_cache_D_industrial.png`, `sheets/props_local_jp_kenney.png`, `sheets/set1_gyp_models.png`, `sheets/set1_models_all.png`, `sheets/set1_picks.png`, `sheets/set1_qmd_rerender.png`, `sheets/set1_textures.png`, `sheets/set2_picks.png`, `sheets/set2_textures.png`, `sheets/set3_picks.png`, `sheets/set3_textures.png`, `sheets/set4_picks.png`, `sheets/set4_textures.png`, `sheets/set5_picks.png`, `sheets/set5_textures.png`
- Renders + raw measurements: `renders/{set1,local2,cache,gyp,hdri}/_results.json|_hdri_stats.json` + per-asset PNGs
- Package listings (size, pathname, guid): `unitypackage_listings/*.tsv` (29 files)
- Texture measurement lists: `texlists/*.json`, `sheets/*_textures.json`
- Scripts: `tools/research/env_render_models.py, env_hdri_preview.py, env_sheet.py, env_sheet_from_results.py, env_tex_sheet.py, env_font_sheet.py, env_unitypkg.py, env_extract_batch.py, env_picks.py, env_build_kit.py`
- To re-extract a cache asset: `python tools/research/env_unitypkg.py extract <cache_package> '<regex on package_pathname>' <out_dir> [listing.tsv]` (in Git Bash set MSYS_NO_PATHCONV=1 when the regex starts with '/').
