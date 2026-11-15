# dev helper: re-pose the arms on an already-built first-person weapon without the
# full texture/mesh pipeline. Imports assets/weapons/<id>.glb, drops its arms, places
# fresh ones from ARM_POSE (or a JSON override) and renders judgment views to
# _shots/a4_fp/lab/<id>_<view>.png.
# usage: blender -b --factory-startup --python pose_lab.py -- <id> [pose.json]
import sys, os, math, json
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
code = open(SRC, encoding="utf-8").read().split("ids = ONLY or list(CFG.keys())")[0]
_args = sys.argv[sys.argv.index("--") + 1:]
sys.argv = [sys.argv[0], "--"]
g = {"__file__": os.path.abspath(SRC), "__name__": "a4build"}
exec(compile(code, SRC, "exec"), g)
bpy = g["bpy"]; D = math.radians
wid = _args[0]
pose = None
if len(_args) > 1:
    raw = json.load(open(_args[1], encoding="utf-8"))
    pose = [tuple(p) for p in raw.get(wid, raw if isinstance(raw, list) else [])]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(g["GAME"], "assets", "weapons", wid + ".glb"))
for o in list(bpy.data.objects):
    if o.name.startswith("arms_") or o.type in ("LIGHT", "CAMERA"):
        bpy.data.objects.remove(o, do_unlink=True)
# the imported gun lives under glTF nodes; that's fine, it's already in the build frame
pose = pose or [tuple(p) for p in g["ARM_POSE"][wid]]
g["place_arms"](wid, None, pose_override=pose)
OUT = os.path.join(g["GAME"], "_shots", "a4_fp", "lab")
os.makedirs(OUT, exist_ok=True)
g["preview_lights"]()
v = g["VIEW"][wid]["posHip"]
cam = g["cam_at"]((-v[0], v[2], -v[1]), (90, 0, 0), 46)   # in-game viewmodel fov
only =_args[2].split(",") if len(_args) > 2 else None
VIEWS = {
    "hip":   ((-v[0], v[2], -v[1]), (90, 0, 0), 46, (1600, 900)),
    "wide":  ((-v[0], v[2] - 0.10, -v[1] + 0.02), (90, 0, 0), 80, (1600, 900)),
    "left":((-0.55, 0.12, 0.00), (90, 0, -90), 40, (1200, 800)),     # from the left, level
    "below": ((-0.10, 0.18, -0.50), (0, 0, 0), 40, (1200, 800)),       # looking straight up
    "front": ((-0.05, 0.85, 0.02), (90, 0, 180), 34, (1200, 800)),     # from the muzzle end
    "rside": ((0.45, -0.02, -0.01), (90, 0, 90), 30, (1200, 800)),     # from the right
    "q3":    ((-0.42, -0.30, 0.18), (72, 0, -50), 40, (1200, 800)),    # behind-left, above
}
for k, (loc, rot, fov, res) in VIEWS.items():
    if only and k not in only:
        continue
    cam.location = loc
    cam.rotation_euler = tuple(D(a) for a in rot)
    cam.data.angle_y = D(fov)
    g["render"](os.path.join(OUT, f"{wid}_{k}.png"), *res)
print("LAB done", wid)
