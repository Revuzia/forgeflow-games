# dev helper: build ONE procedural hand in the canonical frame (no weapon) and
# render back / palm / side / top views. usage: blender -b ... --python hand_preview.py -- R|L [curl a,b,c]
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "a4_build_fp_weapons.py")
code = open(SRC, encoding="utf-8").read().split("ids = ONLY or list(CFG.keys())")[0]
_args = sys.argv[sys.argv.index("--") + 1:]
sys.argv = [sys.argv[0], "--"]
g = {"__file__": os.path.abspath(SRC), "__name__": "a4build"}
exec(compile(code, SRC, "exec"), g)
bpy = g["bpy"]; Vector = g["Vector"]; D = math.radians
hand = _args[0] if _args else "R"
prm = {}
if len(_args) > 1:
    prm["curl"] = tuple(float(x) for x in _args[1].split(","))
bpy.ops.wm.read_factory_settings(use_empty=True)
g["_ensure_arm_materials"]()
arm = g["build_hand"]("T_" + hand, hand, prm)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.3, 0.32, 0.36, 1)
for (loc, e) in [((0.5, -0.5, 0.6), 60), ((-0.5, 0.2, -0.4), 25)]:
    l = bpy.data.lights.new("l", "AREA"); l.energy = e; l.size = 0.5
    o = bpy.data.objects.new("l", l); o.location = loc; sc.collection.objects.link(o)
cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = 0.40
co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
sc.render.resolution_x = 900; sc.render.resolution_y = 700
OUT = os.path.join(g["GAME"], "_shots", "presentation", "bases")
os.makedirs(OUT, exist_ok=True)
views = {
    "back": ((0, 0.05, 1.0), (0, 0, 0)),                 # looking down -Z: sees the BACK (+Z)
    "palm": ((0, 0.05, -1.0), (D(180), 0, 0)),            # looking up +Z: sees the PALM
    "side": ((1.0, 0.05, 0), (D(90), 0, D(90))),         # from +X
    "top":  ((0, 1.0, 0.0), (D(90), 0, D(180))),          # from +Y: down the fingers
}
for k, (loc, rot) in views.items():
    co.location = loc; co.rotation_euler = rot
    sc.render.filepath = os.path.join(OUT, "hand_%s_%s.png" % (hand, k))
    bpy.ops.render.render(write_still=True)
