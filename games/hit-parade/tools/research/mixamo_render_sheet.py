"""HIT PARADE research: render selected frames of Mixamo pack clips on the X Bot mesh.

Usage:
  blender --background --python mixamo_render_sheet.py -- <spec_json> <out_dir> <xbot_fbx>

spec_json = [{"id": "...", "file": ".../clip.fbx", "frames": [1, 5, ...]}, ...]
Each clip is imported, the X Bot meshes' Armature modifiers are pointed at the clip armature
(all 610 X Bot pack clips share the X Bot bind pose -- measured: rest maxdiff 0.0169, on
RightHandThumb3 only), and the listed frames are rendered with Workbench to
<out_dir>/<id>__f<frame>.png (360x360). Orthographic camera, 3/4 front-right view, tracking the
hips horizontally. Floor = 0.5 m checker tiles so ground contact and travel are readable.
Also writes <out_dir>/<spec basename>.hands.json: per clip, min/median/max distance between the
two hand bones (a two-handed grip keeps them close) -- a measured weapon-pose hint.
ASCII only.
"""
import bpy
import bmesh
import sys
import os
import json
import math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SPEC, OUTD, XBOT = argv[0], argv[1], argv[2]
RES = 360
os.makedirs(OUTD, exist_ok=True)
spec = json.load(open(SPEC))

bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
bpy.ops.import_scene.fbx(filepath=XBOT)
xarm = next(o for o in scn.objects if o.type == "ARMATURE")
xmeshes = [o for o in scn.objects if o.type == "MESH"]
for o in xmeshes:
    o.color = (0.93, 0.62, 0.30, 1.0) if "Surface" in o.name else (0.18, 0.18, 0.22, 1.0)
xarm.hide_render = True
xarm.hide_viewport = True
# freeze the X Bot armature's own action so it cannot interfere
if xarm.animation_data:
    xarm.animation_data.action = None

# engine + shading
try:
    scn.render.engine = "BLENDER_WORKBENCH"
except TypeError as e:
    print("[sheet] engine error", e)
sh = scn.display.shading
sh.light = "STUDIO"
sh.color_type = "OBJECT"
sh.show_cavity = True
sh.cavity_type = "BOTH"
sh.show_shadows = True
sh.shadow_intensity = 0.6
sh.show_object_outline = True
scn.display.light_direction = (0.35, -0.45, 0.82)
scn.render.resolution_x = RES
scn.render.resolution_y = RES
scn.render.film_transparent = False
scn.render.image_settings.file_format = "PNG"
try:
    scn.world = bpy.data.worlds.new("W") if scn.world is None else scn.world
    scn.world.color = (0.82, 0.84, 0.88)
except Exception:
    pass

# checker floor: 0.5 m tiles, 24 x 24
def tiles(name, parity, color):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    s = 0.5
    n = 24
    for i in range(n):
        for j in range(n):
            if (i + j) % 2 != parity:
                continue
            x0, y0 = (i - n / 2) * s, (j - n / 2) * s
            vs = [bm.verts.new((x0, y0, 0)), bm.verts.new((x0 + s, y0, 0)),
                  bm.verts.new((x0 + s, y0 + s, 0)), bm.verts.new((x0, y0 + s, 0))]
            bm.faces.new(vs)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scn.collection.objects.link(ob)
    ob.color = color
    return ob

tiles("floorA", 0, (0.55, 0.58, 0.62, 1))
tiles("floorB", 1, (0.40, 0.43, 0.47, 1))

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = 2.4
cam = bpy.data.objects.new("cam", cam_data)
scn.collection.objects.link(cam)
scn.camera = cam
VIEW_DIR = Vector((0.62, -1.0, 0.16)).normalized()  # from target toward camera (char faces -Y)


def aim(target):
    cam.location = target + VIEW_DIR * 10.0
    d = target - cam.location
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = d.to_track_quat("-Z", "Y")


hands_out = {}
for item in spec:
    before = set(scn.objects)
    bpy.ops.import_scene.fbx(filepath=item["file"])
    new = [o for o in scn.objects if o not in before]
    carm = next(o for o in new if o.type == "ARMATURE")
    for o in new:
        if o is not carm:
            o.hide_render = True
    carm.hide_render = True
    # sanity: same object transform as the X Bot armature (else deformation would be wrong)
    dm = max(abs(a - b) for ra, rb in zip(carm.matrix_world, xarm.matrix_world) for a, b in zip(ra, rb))
    if dm > 1e-5:
        print("[sheet] WARNING object transform differs", item["id"], dm)
    for o in xmeshes:
        for m in o.modifiers:
            if m.type == "ARMATURE":
                m.object = carm
    act = carm.animation_data.action
    f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
    pbs = {pb.name.split(":")[-1]: pb for pb in carm.pose.bones}
    wm = carm.matrix_world
    # hand distance over the whole clip
    dists = []
    for f in range(f0, f1 + 1):
        scn.frame_set(f)
        a = wm @ pbs["LeftHand"].head
        b = wm @ pbs["RightHand"].head
        dists.append((a - b).length)
    ds = sorted(dists)
    hands_out[item["id"]] = {"min": round(ds[0], 3), "median": round(ds[len(ds) // 2], 3),
                             "max": round(ds[-1], 3),
                             "frac_below_0p25m": round(sum(1 for d in ds if d < 0.25) / len(ds), 3)}
    for f in item["frames"]:
        f = max(f0, min(f1, int(f)))
        scn.frame_set(f)
        hp = wm @ pbs["Hips"].head
        aim(Vector((hp.x, hp.y, max(0.95, hp.z - 0.05))))
        scn.render.filepath = os.path.join(OUTD, "%s__f%03d.png" % (item["id"], f))
        bpy.ops.render.render(write_still=True)
    print("[sheet] done", item["id"], item["frames"], hands_out[item["id"]], flush=True)
    for o in xmeshes:
        for m in o.modifiers:
            if m.type == "ARMATURE":
                m.object = xarm
    for o in new:
        bpy.data.objects.remove(o, do_unlink=True)
    for a in list(bpy.data.actions):
        if a.users == 0:
            bpy.data.actions.remove(a)

with open(os.path.join(OUTD, os.path.splitext(os.path.basename(SPEC))[0] + ".hands.json"), "w") as fh:
    json.dump(hands_out, fh, indent=1)
print("[sheet] ALL DONE", len(spec))
