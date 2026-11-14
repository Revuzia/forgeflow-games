# Curated per-set "top picks" sheets built from already-rendered previews + texture files.
# Usage: python env_picks.py <env_research_dir>
# ASCII only.
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from env_sheet import build
from PIL import Image

R = os.path.abspath(sys.argv[1])
S = "C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/fe7123c7-88cd-4a67-b2b5-dcae3effdcc7/scratchpad/extract/"
res = {}
for sub in ("set1", "local2", "cache", "gyp"):
    p = os.path.join(R, "renders", sub, "_results.json")
    if os.path.exists(p):
        res.update(json.load(open(p, encoding="utf-8")))
hdri = json.load(open(os.path.join(R, "renders", "hdri", "_hdri_stats.json"), encoding="utf-8"))

GY = "F:/games/unity-assets/GYP Studios__Stylized Fantasy City - Exterior Modular/Assets/Stylized Fantasy City - Exterior Modular/Textures/"
QM = "F:/games/forgeflow-games-assets/3d-models/medieval-village-mega/Medieval Village MegaKit[Standard]/Textures/"
BL = "F:/games/unity-assets/Blink__Stylized Dungeon Textures - RPG Environment/Assets/Blink/Art/Textures/StylizedDungeonTextures/"
PH = "F:/games/forgeflow-games-assets/_downloaded/polyhaven-textures/"
JP = "F:/games/unity-assets/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/"
GM = "F:/games/forgeflow-games-assets/generated-materials/"


def fx(pat):
    for root, ds, fs in os.walk(S):
        for f in fs:
            if f == pat:
                return os.path.join(root, f).replace("\\", "/")
    return None


def T(label, path, tile=True):
    try:
        sz = "%dx%d" % Image.open(path).size
    except Exception:
        sz = "?"
    return {"img": path, "label": "TEX " + label, "sub": sz, "tile2x2": tile}


def M(mid):
    v = res.get(mid, {})
    return {"img": v.get("png", ""), "label": mid, "sub": "%d tris" % v.get("tris", 0)}


def H(hid):
    v = hdri.get(hid, {})
    return {"img": v.get("png", ""), "label": "HDRI " + hid, "sub": "mean %.3f" % v.get("mean_lum", 0)}


SETS = {
    "set1_picks": ("SET 1 RUST THEATER - top picks", [
        T("GYP Wall_Rock_01 BLUE", GY + "Wall/Rock/Wall_Rock_01_Blue_Albedo.tif"),
        T("QMV T_Brick (tint blue)", QM + "T_Brick_BaseColor.png"),
        T("GYP Wall_Brick_Damaged_01", GY + "Wall/Damaged/Wall_Brick_Damaged_01_Albedo.tif"),
        T("QMV T_UnevenBrick", QM + "T_UnevenBrick_BaseColor.png"),
        T("FANT PlanksLong_01 (stage)", fx("T_ENV_MOD_Interior_PlanksLong_01_v1_BC.png") or ""),
        T("Blink Stone_Gate (deco trim)", BL + "Stone_Gate/Stone_Gate_BaseColor.png"),
        M("qmv_Wall_UnevenBrick_Door_Round"), M("qmv_DoorFrame_Round_Brick"), M("qmv_Door_4_Flat"), M("qmd_Arch_Door"),
        M("qfp_Torch_Metal"), M("qfp_Lantern_Wall"), M("qfp_Chandelier"), M("qfp_Cage_Small"), M("qfp_Chain_Coil"),
        M("fant_curtain_01"), M("fant_curtain_03"), M("fant_curtain_04"), M("qmd_Trapdoor"), M("qmd_Cobweb"),
        M("astro_Door_RectangleTall"), H("ph_afrikaans_church_interior"), H("ph_abandoned_workshop_02"), H("ph_anniversary_lounge")]),
    "set2_picks": ("SET 2 BUTCHER BLOCK - top picks (THIN: white tile, steel, hooks, carcasses)", [
        T("Blink Boss_Floor_1 checker", BL + "Boss_Floor_1/Boss_Floor_1_BaseColor.png"),
        T("GEN floor_marble", GM + "floor_marble_albedo.webp"),
        T("PH anti_slip_concrete", PH + "anti_slip_concrete/diffuse.jpg"),
        T("JP Ceiling (white plaster)", JP + "House/JP_Celling/JP_Ceiling_A.tga"),
        T("QFP T_Trim_Metal", "F:/games/forgeflow-games-assets/3d-models/fantasy-props-mega/Textures/T_Trim_Metal_BaseColor.png", False),
        M("mno_Fridge_1"), M("mno_Fridge_2"), M("mno_Gas_stove_1"), M("mno_Kitchen_Cabinet_3"), M("mno_Kitchen_Hood_1"),
        M("fant_meat"), M("fant_knife"), M("lpu_Meat_Haunch_A"), M("fant_safe_door"), M("jp_JP_Water_Heater"),
        M("thb_TH_Shipping_Metal_Crate_01A"), H("ph_abandoned_factory_canteen_01"), H("ph_abandoned_tiled_room")]),
    "set3_picks": ("SET 3 WHEEL OF PAIN - top picks (THIN: wheel, podiums, trapdoors, rigs = procedural)", [
        T("Blink Dwarven_Casting_Wall", BL + "Dwarven_Casting_Wall/Dwarven_Casting_Wall_BaseColor.png"),
        T("Blink Golden_Wall", BL + "Golden_Wall/Golden_Wall_BaseColor.png"),
        T("Blink Boss_Floor_1 checker", BL + "Boss_Floor_1/Boss_Floor_1_BaseColor.png"),
        T("GB25 Marble_Surface_20", fx("Marble_Surface_20_Albedo.png") or ""),
        T("Blink Stone_Gate (deco)", BL + "Stone_Gate/Stone_Gate_BaseColor.png"),
        T("GB100 Roman_Patterned_Floor_1", fx("Roman_Patterned_Floor_1_Albedo.png") or ""),
        M("lpu_Trophy_Gold_Big"), M("lpu_Stage_Truss"), M("lpu_Light_Moving"), M("lpu_Spotlight"), M("lpu_Tv_Camera"),
        M("lpu_Microphone_Stand"), M("mno_Neon_Sign_4"), M("tcy_Billboard_4A"), M("qmd_Trapdoor"),
        H("ph_aft_lounge"), H("ph_adams_place_bridge")]),
    "set4_picks": ("SET 4 CHANNEL 13 ROOFTOP - top picks", [
        T("PH bitumen (roof felt)", PH + "bitumen/diffuse.jpg"),
        T("PH asphalt_02", PH + "asphalt_02/diffuse.jpg"),
        T("GB25 Cracked_Asphalt_5", fx("Cracked_Asphalt_5_Albedo.png") or ""),
        T("PH asbestos_sheet_02", PH + "asbestos_sheet_02/diffuse.jpg"),
        T("JP Concrete", JP + "House/JP_Concrete/JP_Concrete_A.tga"),
        T("JP Red_Brick (parapet)", JP + "House/JP_Red_Brick/JP_Red_Brick_A.tga"),
        M("jp_JP_Conditioner_01"), M("jp_JP_Conditioner_05"), M("jp_JP_Propane"), M("jp_JP_Water_Heater"), M("jp_JP_Electric_Post_01"),
        M("jp_JP_Railing"), M("jp_JP_Hatch_01"), M("tcy_Water_Tank_1A"), M("tcy_Air_Vent_1A"), M("tcy_Antenna_1A"),
        M("tcy_Billboard_3A"), M("tcy_Emergency_Stairs_1A"), M("thb_TH_Roof_Service_Entrance_01A"), M("syc_Prop_Billboard_Roof_01"),
        H("jp_Sky_Night_4a"), H("acr_Toon_sky_79")]),
    "set5_picks": ("SET 5 CONTROL ROOM - top picks (THIN: CRT banks, boiler, grates = procedural)", [
        T("Blink Cracked_Concrete_Floor", BL + "Cracked_Concrete_Floor/Cracked_Concrete_Floor_BaseColor.png"),
        T("PH asbestos_sheet (rust corrugated)", PH + "asbestos_sheet/diffuse.jpg"),
        T("JP Concrete", JP + "House/JP_Concrete/JP_Concrete_A.tga"),
        T("JP Road_Hatches (grate atlas)", JP + "Environment/JP_Road_Hatches/JP_Road_Hatches_A.tga", False),
        T("JP Meters (panel atlas)", JP + "Environment/JP_Meters/JP_Meters_A.tga", False),
        M("thb_TH_Giant_Pipe_Straight_Regular_01A"), M("thb_TH_Giant_Pipe_Corner_Side_01A"), M("thb_TH_Pipe_Cluster_01A"),
        M("thb_TH_Liquid_Tank_01A"), M("thb_TH_Metal_Stairs_01A"), M("syd_Gen_Bld_Pipe_Valve_01"), M("syd_Env_Grate_Ground_01"),
        M("syd_Env_Door_Bars_01"), M("vpw_Cable_trunk"), M("vpw_Bunch_of_wires"), M("jp_JP_Electric_Meter_01"), M("jp_JP_Gas_Meter_01"),
        M("jpc_speaker01_1"), M("lpu_Television_Old"), M("mno_TV_1"), H("ph_abandoned_garage"), H("ph_aircraft_workshop_01")]),
}
for key, (title, items) in SETS.items():
    missing = [i["label"] for i in items if not i.get("img") or not os.path.exists(i["img"])]
    if missing:
        print("MISSING in", key, missing)
    build({"title": title, "out": os.path.join(R, "sheets", key + ".png"), "cols": 6, "cell": 250, "items": items})
