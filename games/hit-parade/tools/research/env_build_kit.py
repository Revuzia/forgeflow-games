# Build env_kit.json from measured render results + texture files (no hand-typed numbers).
# Usage: python env_build_kit.py <env_research_dir>
# ASCII only.
import json, os, sys
from PIL import Image

R = os.path.abspath(sys.argv[1])
SCR = "C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/fe7123c7-88cd-4a67-b2b5-dcae3effdcc7/scratchpad/extract/"
C = "F:/games/unity-asset-cache/"
PKG = {
    "fantastic_interior": (C + "Tidal Flask Studios/3D ModelsPropsInterior/FANTASTIC - Interior Pack.unitypackage", "nested: Assets/FANTASTIC - Interior Pack/URP_FANTASTIC_Interior_Pack.unitypackage"),
    "mnostva_cozy": (C + "Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage", None),
    "lowpoly_ultimate": (C + "polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage", None),
    "toon_city": (C + "SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage", None),
    "synty_city": (C + "Synty Studios/3D ModelsEnvironmentsUrban/POLYGON - City Pack - Art by Synty.unitypackage", None),
    "scifi_modular": (C + "karboosx/3D ModelsEnvironmentsSci-Fi/Sci-Fi Styled Modular Pack.unitypackage", None),
    "vp_wires": (C + "VPStudio 3d/3D ModelsEnvironmentsIndustrial/Wires pack.unitypackage", None),
    "vp_lamps": (C + "VPStudio 3d/3D ModelsEnvironmentsIndustrial/Best Lamps pack.unitypackage", None),
    "synty_dungeons": (C + "Synty Studios/3D ModelsEnvironmentsDungeons/POLYGON - Dungeons Pack - Art by Synty.unitypackage", None),
    "toon_harbor": (C + "SICS Games/3D ModelsEnvironmentsIndustrial/Toon Harbor Pack.unitypackage", "nested: Assets/Toon Harbor Pack/BuiltIn_Toon Harbor Pack_6000.0.32.unitypackage"),
    "jp_classroom": (C + "SbbUtutuya/3D ModelsEnvironments/Japanese School Classroom.unitypackage", None),
    "gamebuffs25": (C + "Game Buffs/Textures Materials/25 Free Stylized Textures - Grass Ground Floors Walls More.unitypackage", None),
    "gamebuffs100": (C + "Game Buffs/Textures Materials/100 Stylized Historical Textures - Medieval Egyptian Roman More.unitypackage", None),
}
res = {}
for sub in ("set1", "local2", "cache", "gyp"):
    p = os.path.join(R, "renders", sub, "_results.json")
    if os.path.exists(p):
        for k, v in json.load(open(p, encoding="utf-8")).items():
            v["_render_group"] = sub
            res[k] = v
hdri = json.load(open(os.path.join(R, "renders", "hdri", "_hdri_stats.json"), encoding="utf-8"))


def lic_for(path):
    p = path.replace("\\", "/")
    if "/_downloaded/polyhaven" in p:
        return "CC0 (Poly Haven)"
    if "/3d-models/medieval-village" in p or "/3d-models/fantasy-props" in p or "/3d-models/modular-dungeon" in p:
        return "CC0 (Quaternius) - License_Standard.txt / License.txt read"
    if "/_downloaded/" in p:
        return "CC0 (Kenney) - License.txt read"
    if "generated-materials" in p:
        return "original (xAI-generated for ForgeFlow) - no third-party licence"
    return "Unity Asset Store EULA"


def src_ref(path):
    p = path.replace("\\", "/")
    if p.startswith(SCR):
        rel = p[len(SCR):]
        pack, inner = rel.split("/", 1)
        outer, nest = PKG.get(pack, ("?", None))
        d = {"cache_package": outer, "package_pathname": inner}
        if nest:
            d["nested_package"] = nest
        return d
    return {"path": p}


def model(mid, note=""):
    v = res.get(mid)
    if not v:
        return {"id": mid, "error": "not rendered"}
    d = {"id": mid}
    d.update(src_ref(v["path"]))
    d["licence"] = lic_for(v["path"])
    d["tris"] = v.get("tris")
    d["dims_m"] = v.get("dims_m")
    d["textures_loaded"] = v.get("textures", [])
    if v.get("albedo_attached"):
        d["albedo_used_for_preview"] = src_ref(v["albedo_attached"]).get("path") or src_ref(v["albedo_attached"]).get("package_pathname")
    d["preview_png"] = os.path.relpath(v.get("png", ""), R).replace("\\", "/") if v.get("png") else None
    if note:
        d["note"] = note
    return d


def tex(label, albedo, normal=None, rough=None, note=""):
    d = {"label": label}
    for k, p in (("albedo", albedo), ("normal", normal), ("rough", rough)):
        if not p:
            continue
        try:
            sz = list(Image.open(p).size)
        except Exception as e:
            sz = "ERR " + str(e)[:40]
        ref = src_ref(p)
        d[k] = ref.get("path") or ref
        d[k + "_size"] = sz
    d["licence"] = lic_for(albedo)
    if note:
        d["note"] = note
    return d


def hd(hid, note=""):
    v = hdri.get(hid, {})
    return {"id": hid, "path": v.get("path"), "size": v.get("size"), "mean_lum_512x256": v.get("mean_lum"),
            "p99_lum_512x256": v.get("p99_lum"), "licence": lic_for(v.get("path", "")) if "polyhaven" in v.get("path", "") else "Unity Asset Store EULA",
            "preview_png": os.path.relpath(v.get("png", ""), R).replace("\\", "/") if v.get("png") else None, "note": note}


GY = "F:/games/unity-assets/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/"
QM = "F:/games/forgeflow-games-assets/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/Textures/"
QF = "F:/games/forgeflow-games-assets/3d-models/fantasy-props-mega/Textures/"
BL = "F:/games/unity-assets/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/"
PH = "F:/games/forgeflow-games-assets/_downloaded/polyhaven-textures/"
JP = "F:/games/unity-assets/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/"
GM = "F:/games/forgeflow-games-assets/generated-materials/"


def fx(name):
    for root, ds, fs in os.walk(SCR):
        if name in fs:
            return os.path.join(root, name).replace("\\", "/")
    return None


def bl(n, note=""):
    return tex("Blink " + n, BL + n + "/" + n + "_BaseColor.png", BL + n + "/" + n + "_Normal.png", BL + n + "/" + n + "_Roughness.png", note)


def ph(n, note=""):
    return tex("PolyHaven " + n, PH + n + "/diffuse.jpg", None, PH + n + "/rough.jpg", note + " (no normal map in the local download; displacement.jpg + ao.jpg present)")


def jp(folder, base, note=""):
    return tex("JapanVillage " + base, JP + folder + "/" + base + "_A.tga", JP + folder + "/" + base + "_N.tga", None, note)


def gm(n, note=""):
    return tex("GEN " + n, GM + n + "_albedo.webp", GM + n + "_normal.webp", GM + n + "_rough.webp", note)


def gb(n, note=""):
    a = fx(n + "_Albedo.png")
    return tex("GameBuffs " + n, a, fx(n + "_Normal.png"), None, note) if a else {"label": n, "error": "not extracted"}


kit = {
    "generated": "2026-09-29",
    "method": "Every model below was imported in Blender 5.1.2 headless (tools/research/env_render_models.py); tris = evaluated loop triangles; dims_m = world bounding box as imported (Synty FBX import at 0.01 scale); textures sizes read with PIL. Every recommendation was checked on a rendered contact sheet in sheets/.",
    "style_direction": "hand-painted stylised PBR (Quaternius MegaKits + GYP + Blink + Tidal Flask FANTASTIC + Japan Village semi-real props), graded saturated; flat-colour toon kits (SICS, Synty, polyperfect, Kenney) only for background/far silhouettes.",
    "sets": {
        "1_rust_theater": {
            "verdict": "STRONG - library covers walls, doors, torches, curtains, chains; stage lights + proscenium arch + seating are the gaps",
            "textures": [
                tex("GYP Wall_Rock_01 BLUE (painted stone wall - closest match to the reference's blue brick)", GY + "Wall/Rock/Wall_Rock_01_Blue_Albedo.tif", GY + "Wall/Rock/Wall_Rock_01_Normal.tif"),
                tex("QMV T_Brick (light grey brick; multiply-tint blue in shader)", QM + "T_Brick_BaseColor.png", QM + "T_Brick_Normal.png", QM + "T_Brick_Roughness.png"),
                tex("GYP Wall_Brick_Damaged_01 (plaster with exposed brick - condemned look)", GY + "Wall/Damaged/Wall_Brick_Damaged_01_Albedo.tif", GY + "Wall/Damaged/Wall_Brick_Damaged_01_Normal.tif"),
                tex("QMV T_UnevenBrick (stone floor/wall)", QM + "T_UnevenBrick_BaseColor.png", QM + "T_UnevenBrick_Normal.png", QM + "T_UnevenBrick_Roughness.png"),
                tex("FANTASTIC PlanksLong_01 v1 (stage floorboards)", fx("T_ENV_MOD_Interior_PlanksLong_01_v1_BC.png"), fx("T_ENV_MOD_Interior_PlanksLong_01_N.png")),
                tex("GYP Wall_Wood_01 (wood wall)", GY + "Wall/Wood/Wall_Wood_01_Albedo.tif", GY + "Wall/Wood/Wall_Wood_01_Normal.tif"),
                tex("GYP Door_Wood_01 BLUE / RED (door plank atlas, asset UVs)", GY + "Door/Door_Wood_01/Door_Wood_01_Blue_Albedo.tif", GY + "Door/Door_Wood_01/Door_Wood_01_Normal.tif"),
                bl("Stone_Gate", "art-deco gold-on-black panel: proscenium/trim"),
                tex("FANTASTIC T_PROP_fabrics (curtain cloth, red)", fx("T_PROP_fabrics_interior_BC.png")),
                tex("QMV T_RockTrim + T_WoodTrim trim sheets", QM + "T_RockTrim_BaseColor.png", QM + "T_RockTrim_Normal.png"),
            ],
            "models": [model(m) for m in ["qmv_Wall_UnevenBrick_Straight", "qmv_Wall_UnevenBrick_Door_Round", "qmv_DoorFrame_Round_Brick", "qmv_Door_4_Flat", "qmv_Door_1_Round", "qmv_Floor_UnevenBrick", "qmv_Floor_WoodDark", "qmv_Wall_Arch", "qmv_Prop_MetalFence_Ornament",
                                          "qfp_Torch_Metal", "qfp_Lantern_Wall", "qfp_Chandelier", "qfp_Cage_Small", "qfp_Chain_Coil", "qfp_Barrel", "qfp_Crate_Metal", "qfp_WeaponStand", "qfp_Banner_1_Cloth", "qfp_Bucket_Metal",
                                          "fant_curtain_01", "fant_curtain_02_01", "fant_curtain_03", "fant_curtain_04", "fant_curtainrod",
                                          "qmd_Arch_Door", "qmd_Trapdoor", "qmd_Cobweb", "qmd_Arch_bars", "qmd_Spikes", "qmd_Torch"]]
                      + [model("astro_Door_RectangleTall", "photoreal/dark - alt only; clashes with the painted kit"), model("astro_IronFixtures_TorchBracket", "photoreal alt")],
            "hdri": [hd("ph_afrikaans_church_interior", "dark red interior with arches - theatre-like fill"), hd("ph_abandoned_workshop_02", "dim vaulted derelict"), hd("ph_anniversary_lounge", "warm lamp-lit interior")],
            "vfx_masks": ["F:/games/forgeflow-games-assets/_downloaded/light-masks/Default/circle_a_streaks.png (512x512, CC0 Kenney) - stage-light gobo/cookie",
                          "F:/games/unity-assets/Deko__Animated Fire Textures/Assets/Animated FireTextures/Textures/TorchFire01.png (1024x1024 flipbook, EULA) - torch flame",
                          "F:/games/unity-assets/CamelotVFX__CamelotVFX Fire Smoke/Assets/CamelotVFX_ Fire&Smoke/Sprite_Sheets/Fire_Sprites_v1.png (4096x4096, EULA)"],
            "thin_procedural": ["stage spotlights/fresnels (no usable model: LPU Spotlight 204 tris flat-colour; VPStudio lamps preview mis-textured)", "proscenium arch + torn curtain drape at stage scale (FANTASTIC curtains are 2.2 m, 108-188 tris)", "theatre seating rows / balcony rail"],
        },
        "2_butcher_block": {
            "verdict": "THIN - no white ceramic tile, no brushed steel, no meat hooks, no hanging carcasses, no walk-in freezer",
            "textures": [bl("Boss_Floor_1", "black/white marble checker - kitchen floor"), gm("floor_marble", "white marble blocks - closest thing to white tile"), ph("anti_slip_concrete", "dotted non-slip concrete floor"),
                         jp("House/JP_Celling", "JP_Ceiling", "plain white plaster"), tex("QFP T_Trim_Metal (grey metal trim sheet)", QF + "T_Trim_Metal_BaseColor.png", QF + "T_Trim_Metal_Normal.png")],
            "models": [model(m) for m in ["mno_Fridge_1", "mno_Fridge_2", "mno_Fridge_4", "mno_Gas_stove_1", "mno_Kitchen_Cabinet_3", "mno_Kitchen_Hood_1", "fant_meat", "fant_knife", "fant_safe_door", "jp_JP_Water_Heater", "jp_JP_Propane", "thb_TH_Shipping_Metal_Crate_01A"]]
                      + [model("lpu_Meat_Haunch_A", "92 tris - background only"), model("fant_hook_01", "wall COAT hook 0.2 m - NOT a meat hook")],
            "hdri": [hd("ph_abandoned_factory_canteen_01", "cool white canteen - best kitchen fill"), hd("ph_abandoned_tiled_room", "despite the name, previews as a tan/wood derelict room")],
            "thin_procedural": ["white subway/square tile (procedural grout shader + per-tile tint + grime mask)", "brushed stainless steel counters/prep tables (bevelled boxes + anisotropic brushed-steel shader)", "meat hooks on rails + chains (simple torus/curve metal)", "hanging carcass / meat sides (organic - hardest; needs sculpt or generator, not in library)", "walk-in freezer door + strip curtain", "cooking-show counter set with host desk"],
        },
        "3_wheel_of_pain": {
            "verdict": "VERY THIN - no game-show hardware in the library; textures only",
            "textures": [bl("Dwarven_Casting_Wall", "dark with glowing orange/teal zigzag bands - retro game-show wall"), bl("Golden_Wall", "orange geometric - 70s/80s show panel"), bl("Boss_Floor_1", "checker floor"),
                         gb("Marble_Surface_20", "white marble + gold veins - glossy show floor"), bl("Stone_Gate", "deco panel"), gb("Roman_Patterned_Floor_1", "gold pattern - podium tops")],
            "models": [model(m, "flat-colour low poly - background only") for m in ["lpu_Trophy_Gold_Big", "lpu_Stage_Truss", "lpu_Stage_Platform_Big", "lpu_Light_Moving", "lpu_Spotlight", "lpu_Tv_Camera", "lpu_Microphone_Stand"]]
                      + [model("mno_Neon_Sign_4", "fixed English slogan - retexture/replace text"), model("tcy_Billboard_4A", "novelty cup sign"), model("qmd_Trapdoor", "medieval style - wrong era")],
            "hdri": [hd("ph_aft_lounge", "dark room with bright lamps"), hd("ph_adams_place_bridge", "dark with bright strip lights")],
            "thin_procedural": ["GIANT SPINNING WHEEL (hero prop: segmented disc, bulb-ringed rim, pegs, flapper, emissive segment labels - fully procedural)", "contestant podiums (bevelled + emissive name panels)", "trapdoors (flush floor panels, hazard stripes, hinge animation)", "light rigs / truss + marquee bulb strips (instanced)", "glossy black stage floor with LED strips (shader)", "audience bleachers"],
        },
        "4_channel13_rooftop": {
            "verdict": "GOOD - Japan Village + SICS Toon City cover AC units, tanks, vents, antenna, billboards, railings; rain + neon tubes procedural",
            "textures": [ph("bitumen", "roof felt with roll bands"), ph("asphalt_02", "grey with cracks"), ph("asphalt_pit_lane", "dark"), gb("Cracked_Asphalt_5", "stylised cracked asphalt"),
                         ph("asbestos_sheet_02", "grey corrugated sheet"), jp("House/JP_Concrete", "JP_Concrete"), jp("House/JP_Red_Brick", "JP_Red_Brick", "parapet brick"), jp("Environment/JP_Road_Hatches", "JP_Road_Hatches", "vent/manhole/grate decal atlas (asset UVs)")],
            "models": [model(m) for m in ["jp_JP_Conditioner_01", "jp_JP_Conditioner_03", "jp_JP_Conditioner_05", "jp_JP_Conditioner_07", "jp_JP_Propane", "jp_JP_Water_Heater", "jp_JP_Electric_Meter_01", "jp_JP_Gas_Meter_01", "jp_JP_Electric_Post_01", "jp_JP_Railing", "jp_JP_Fence_Metal_4m", "jp_JP_Hatch_01", "jp_JP_Grid_01", "jp_JP_Cable_Mounting_01"]]
                      + [model(m, "flat toon style") for m in ["tcy_Water_Tank_1A", "tcy_Water_Tank_1B", "tcy_Air_Vent_1A", "tcy_Antenna_1A", "tcy_Billboard_1A", "tcy_Billboard_3A", "tcy_Emergency_Stairs_1A", "tcy_Skylight_1A", "tcy_Industrial_Ventilation_1A", "tcy_Light_Projector_1A", "thb_TH_Roof_Service_Entrance_01A", "thb_TH_Pipe_Cluster_01A", "syc_Prop_Billboard_Roof_01", "syc_Bld_Roof_Access_01"]]
                      + [model("lpu_Water_Tower_Big", "12 m tall, 746 tris - far skyline only"), model("tcy_Billboard_2A", "AVOID: carries the SICS brand logo")],
            "hdri": [hd("jp_Sky_Night_4a", "ONLY night sky in the library: purple starry dusk, sunset glow on horizon (EXR 4096x2048, 91.7 MB file)"), hd("acr_Toon_sky_79", "dusk toon sky - LDR (max 0.8), backdrop only"), hd("acr_Toon_sky_80", "dusk toon sky - LDR")],
            "thin_procedural": ["rain (particles + wet-floor roughness/ripple normal)", "neon tube signs (emissive tube along spline - show logo 'CHANNEL 13' must be original)", "distant city skyline cards (Kenney low-detail buildings need the colormap wired - 4 GLBs rendered magenta = missing texture)", "roof parapet walls (modular box + JP_Red_Brick/JP_Concrete)"],
        },
        "5_control_room": {
            "verdict": "MIXED - pipes/tanks/valves/cables/meters covered; CRT monitor banks, boiler, metal grating floor are gaps",
            "textures": [bl("Cracked_Concrete_Floor"), ph("asbestos_sheet", "rusty-brown corrugated sheet"), jp("House/JP_Concrete", "JP_Concrete"), jp("Environment/JP_Road_Hatches", "JP_Road_Hatches", "grate/manhole decals"), jp("Environment/JP_Meters", "JP_Meters", "panel/meter atlas"), gm("bronze_worn", "brass fittings")],
            "models": [model(m) for m in ["thb_TH_Giant_Pipe_Straight_Regular_01A", "thb_TH_Giant_Pipe_Corner_Side_01A", "thb_TH_Pipe_Cluster_01A", "thb_TH_Liquid_Tank_01A", "thb_TH_Metal_Stairs_01A", "syd_Gen_Bld_Pipe_Valve_01", "syd_Env_Grate_Ground_01", "syd_Env_Door_Bars_01", "syd_Gen_Prop_Chain_01",
                                          "vpw_Cable_trunk", "vpw_Bunch_of_wires", "vpw_Damaged_wires", "vpw_Counter", "jp_JP_Electric_Meter_01", "jp_JP_Gas_Meter_01", "jp_JP_Cable_Mounting_01", "jpc_speaker01_1", "jpc_screen01_1"]]
                      + [model("lpu_Television_Old", "CRT but 108 tris flat-colour - reject for hero"), model("mno_TV_1", "cartoon pastel TV - reject"), model("vpl_Lamp_5", "industrial pendant lamp 2214 tris - preview mis-textured (orange patches), verify UVs before use")],
            "hdri": [hd("ph_abandoned_garage", "dark industrial"), hd("ph_aircraft_workshop_01", "industrial with machinery"), hd("ph_abandoned_bakery", "dark derelict interior")],
            "thin_procedural": ["CRT MONITOR BANKS (hero: rounded-box CRT with curved emissive screen, scanline shader, instanced racks - Poly Haven Television_01 is a broken stub)", "boiler (riveted cylinder + gauges + firebox glow; Toon Harbor Liquid_Tank is a stand-in)", "metal grating / catwalk floor (alpha-cut grate shader) + diamond plate", "host's control desk / mixing console", "steam vents (particles)"],
        },
    },
    "fonts_hud": {
        "note": "Google-CSS woff2 subsets: the Latin file is NOT the last-numbered one - use the paths below (checked via fontTools cmap). Every family in _downloaded/fonts ships weight 400 only.",
        "display_primary": {"family": "Bungee", "path": "F:/games/forgeflow-games-assets/_downloaded/fonts/Bungee/Bungee_02.woff2", "licence": "SIL OFL 1.1", "use": "LIVE bug, show logo, SCORE in slanted frame"},
        "display_digits": {"family": "Russo One", "path": "F:/games/forgeflow-games-assets/_downloaded/fonts/Russo_One/Russo_One_01.woff2", "licence": "SIL OFL 1.1", "use": "score digits, combo counter"},
        "display_condensed": {"family": "Bebas Neue", "path": "F:/games/forgeflow-games-assets/_downloaded/fonts/Bebas_Neue/Bebas_Neue_01.woff2", "licence": "SIL OFL 1.1", "use": "round/timer, labels, lower-thirds"},
        "caption_comic": {"family": "Acme", "path": "F:/games/unity-assets/Danil Chernyaev__2D Platformer Tileset/Assets/2D Platformer Tileset/Simple UI Pack/Font/Acme-Regular.ttf", "licence": "SIL OFL 1.1 (Acme is a Google Font)", "use": "host/announcer captions"},
        "body": {"family": "Oswald 400", "path": "F:/games/forgeflow-games-assets/_downloaded/fonts/Oswald/Oswald_02.woff2", "licence": "SIL OFL 1.1", "use": "captions, menus"},
        "body_alt": [{"family": "Nunito 800", "path": "C:/Users/TestRun/Claude Claw/forgeflow-games/games/dyefield/dist/assets/nunito-latin-800-normal-Dz8SOQK_.woff2", "licence": "SIL OFL 1.1", "use": "readable menus/settings"},
                     {"family": "Liberation Sans", "path": "F:/games/unity-assets/ArtZombie__Skill Icon PackCartoon01/Assets/TextMesh Pro/Fonts/LiberationSans.ttf", "licence": "SIL OFL 1.1", "use": "fallback"}],
        "screens": [{"family": "VT323", "path": "F:/games/forgeflow-games-assets/_downloaded/fonts/VT323/VT323_00.woff2", "licence": "SIL OFL 1.1", "use": "CRT monitor text (control room)"},
                    {"family": "Press Start 2P", "path": "F:/games/forgeflow-games-assets/_downloaded/fonts/Press_Start_2P/Press_Start_2P_00.woff2", "licence": "SIL OFL 1.1", "use": "retro scoreboard"},
                    {"family": "Share Tech Mono", "path": "F:/games/unity-assets/Alchemist Lab__Sci Fi windows/Assets/AlchemistUITools/SciFiContent/Fonts/ShareTechMono-Regular.ttf", "licence": "SIL OFL 1.1 (Google Font)", "use": "data readouts"}],
        "avoid": ["Alchemist Lab bundle fonts with unverified third-party licences: Agency_FB, Sonic_XB_dBT, Space_BdBt, Starliner-BTN, Amputa_Bangiz (its comma renders as a cat-face glyph), Ticker_Tape, Neuropol_Medium, CafeParisC, Demun_Lotion, BEDR-CYR, Picaresque_Two, Potra, cristal, quazi_mode, rod, start"],
        "input_prompts": {"path": "F:/games/forgeflow-games-assets/_downloaded/input-prompts", "licence": "CC0 (Kenney Input Prompts 1.4.1)", "counts_default_png": {"Keyboard & Mouse": 243, "Xbox Series": 99, "PlayStation Series": 134, "Touch": 28, "Generic": 36, "Flairs": 93}, "png_size": [64, 64], "also": "matching SVG per icon + kenney_input_*.ttf glyph fonts + spritesheets (_sheet_default.png/.xml)"},
        "mobile_controls": {"path": "F:/games/forgeflow-games-assets/_downloaded/mobile-controls", "licence": "CC0 (Kenney Mobile Controls 1.0)", "counts_default_png": {"Style A..H": "46 each", "Icons": 42, "Highlights A/B": "26 each"}, "svg": 462, "elements": "buttons (circle/square/diamond/hexagon/bean, wide variants), dpads, joystick pads + nubs"},
    },
    "library_facts": {
        "polyhaven_textures": "40 sets, alphabetical slice aerial_asphalt_01..bitumen; diffuse/rough/ao/displacement only (no normal)",
        "polyhaven_hdris": "40, abandoned_bakery..anniversary_lounge; 2k all, 4k for first 20",
        "polyhaven_models": "40 folders, all .gltf stubs with missing .bin/textures - unusable",
        "unity_assets_extracted": "66 packs, publishers 1..G only; H..Z live only as .unitypackage in F:/games/unity-asset-cache",
        "unity_models_index": "1409 GLBs from 10 packs only",
        "corrupt_cache": ["VPStudio 3d/3D ModelsEnvironmentsIndustrial/Ventilation System pack.unitypackage - gzip ends before end-of-stream (truncated download)", "Magic Pig Games * - several entries are 0-byte .tmp.json (incomplete downloads)"],
        "decals": "essentially none: no blood splat, graffiti, posters or stains anywhere; only JP_Grunge_Mask.tga (2048x2048, RGB-packed masks, alpha empty) and Blink Cracked_Concrete",
    },
}
out = os.path.join(R, "env_kit.json")
json.dump(kit, open(out, "w", encoding="utf-8"), indent=1)
errs = []
for s, v in kit["sets"].items():
    for m in v["models"]:
        if "error" in m:
            errs.append((s, m["id"]))
    for t in v["textures"]:
        if "error" in t:
            errs.append((s, t["label"]))
print("WROTE", out, "errors:", errs)
