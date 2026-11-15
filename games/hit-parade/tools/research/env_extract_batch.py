# Batch-extract selected models + textures from cache .unitypackage files for preview renders.
# Usage: python env_extract_batch.py <out_root> <listing_dir> <nested_dir>
# Source packages are only read. ASCII only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from env_unitypkg import cmd_extract

OUT, LST, NEST = sys.argv[1], sys.argv[2], sys.argv[3]
C = "F:/games/unity-asset-cache/"
JOBS = [
    ("fantastic_interior", NEST + "/FANTASTIC - Interior Pack/Assets/Tidal Flask Studios/FANTASTIC Interior Pack/URP_FANTASTIC_Interior_Pack.unitypackage",
     "FANTASTIC - Interior Pack__URP_FANTASTIC_Interior_Pack.tsv",
     r"(hook_interior_0[1-4]|meat_interior|knife_interior|oven_interior|stove_interior|curtain_interior_0[134]|curtain_interior_02_0[12]|curtainrod_interior|safe_door_interior|MOD_Trapdoor_interior_01|MOD_Door_interior|console_interior_01|barrel_interior_01|cabinet_interior_01)\.fbx$|T_PROP_[a-z_0-9]+_BC\.png$|T_ENV_MOD_Interior_(Bricks_01_v1|WallPainted_v1|WallPainted_v2|PlanksLong_01_v1|StoneFloor|WoodGeneric_v1)_(BC|N)\.png$|T_ENV_MOD_Interior_(PlanksLong_01|StoneFloor)_N\.png$"),
    ("mnostva_cozy", C + "Mnostva Art/3D ModelsPropsInterior/BIG PACK Cozy Cartoon Rooms Interiors.unitypackage",
     "BIG PACK Cozy Cartoon Rooms Interiors.tsv",
     r"/(Fridge_[1-4]|Kitchen_Cabinet_[123]|Kitchen_Hood_1|Gas_stove_1|Neon_Sign_[1-6]|Rainbow_signboard_1|TV_1|PC_Monitor_1|Camera_1|Curtains_1|Speaker_1|Light_1)\.fbx$|Cartoon_Room_Texture_2048\.png$"),
    ("lowpoly_ultimate", C + "polyperfect/3D ModelsProps/Low Poly Ultimate Pack.unitypackage",
     "Low Poly Ultimate Pack.tsv",
     r"/SM_(Fridge_Modern|Meat_Haunch_A|Knife_Kitchen_Chopper|Rail_Kitchen|Light_Moving|Microphone_Stand|Pc_Monitor|Cabinet_Kitchen|Oven|Television_Old|Television|Tv_Camera|Spotlight|Stage_Truss|Stage_Platform_Big|Trophy_Gold_Big|Water_Tower_Big|Led_Panels_Pattern|Jukebox|Generator|Ventilation|Spaghetti_Server|Arcade_Machine_Race)\.fbx$|Atlas_Albedo_LPUP\.png$|Atlas_Emission_Lpup\.png$"),
    ("toon_city", C + "SICS Games/3D ModelsEnvironmentsUrban/Toon City.unitypackage", "Toon City.tsv",
     r"/(Air_Conditioner_[123]A|Water_Tank_1[AB]|Billboard_(1A|2A|3A|4A|5A)|Antenna_1A|Skylight_1A|Power_Box_1A|Air_Vent_1A|Industrial_Ventilation_1A|Light_Projector_1A|Emergency_Stairs_1A|Pipe_1A|Metal_Fence_2A)\.fbx$|\.psd$"),
    ("synty_city", C + "Synty Studios/3D ModelsEnvironmentsUrban/POLYGON - City Pack - Art by Synty.unitypackage", "POLYGON - City Pack - Art by Synty.tsv",
     r"/SM_(Prop_Aircon_01|Prop_Billboard_Roof_01|Prop_Billboard_01|Bld_Roof_Access_01|Prop_LargeSign_Burger_01|Prop_LargeSign_Donut_01)\.fbx$|/PolygonCity_01\.png$|/Billboard_01\.png$|/Emissive_01\.png$"),
    ("scifi_modular", C + "karboosx/3D ModelsEnvironmentsSci-Fi/Sci-Fi Styled Modular Pack.unitypackage", "Sci-Fi Styled Modular Pack.tsv",
     r"/(big_screen|console|console_screen|console_celing|computer_station|decorative_wall_4_computer_LOD0|light_wall_1|desk|cabinet)\.fbx$|\.png$"),
    ("vp_wires", C + "VPStudio 3d/3D ModelsEnvironmentsIndustrial/Wires pack.unitypackage", "Wires pack.tsv",
     r"/(Bunch_of_wires|Cable_trunk|Switch|Counter|Damaged_wires|Wire_1|Cable_route)\.fbx$|\.png$"),
    ("vp_lamps", C + "VPStudio 3d/3D ModelsEnvironmentsIndustrial/Best Lamps pack.unitypackage", "Best Lamps pack.tsv",
     r"/(Lamp_[1-9]|Lamp_1[01]|Speaker)\.fbx$|\.png$"),
    ("synty_dungeons", C + "Synty Studios/3D ModelsEnvironmentsDungeons/POLYGON - Dungeons Pack - Art by Synty.unitypackage", "POLYGON - Dungeons Pack - Art by Synty.tsv",
     r"/SM_(Gen_Bld_Pipe_Straight_01|Gen_Bld_Pipe_Valve_01|Env_Grate_01|Env_Grate_Ground_01|Gen_Prop_Chain_01|Env_Door_Bars_01|Env_Door_Large_Wood_01|Env_Door_01)\.fbx$|/PolygonDungeon_01_A\.png$"),
    ("toon_harbor", NEST + "/Toon Harbor Pack/Assets/Toon Harbor Pack/BuiltIn_Toon Harbor Pack_6000.0.32.unitypackage", "Toon Harbor Pack__BuiltIn_Toon Harbor Pack_6000.0.32.tsv",
     r"/TH_(Giant_Pipe_Straight_Regular_01A|Giant_Pipe_Corner_Side_01A|Pipe_Cluster_01A|Liquid_Tank_01A|Metal_Stairs_01A|Shipping_Metal_Crate_01A|Roof_Service_Entrance_01A)\.fbx$|/Atlas_1A_D\.psd$|/Atlas_Lights_1A_D\.psd$"),
    ("jp_classroom", C + "SbbUtutuya/3D ModelsEnvironments/Japanese School Classroom.unitypackage", "Japanese School Classroom.tsv",
     r"/(screen01_1|speaker01_1|switch01_1|locker01_close|lamp01_1)\.fbx$|/(screen01|speaker01|switch01|locker01|lamp01)_[0-9A-Za-z_]*\.(png|tga)$"),
]
only = sys.argv[4].split(",") if len(sys.argv) > 4 else None
for name, pkg, lst, rx in JOBS:
    if only and name not in only:
        continue
    if not os.path.exists(pkg):
        # nested path guess failed: find it
        base = os.path.join(NEST, lst.split("__")[0])
        for root, ds, fs in os.walk(base):
            for f in fs:
                if f.endswith(".unitypackage"):
                    pkg = os.path.join(root, f)
    try:
        cmd_extract(pkg, rx, os.path.join(OUT, name), os.path.join(LST, lst))
    except Exception as e:
        print("FAIL", name, e)
