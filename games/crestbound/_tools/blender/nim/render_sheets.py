"""
NIM — Eevee renders, headless.

    blender --background --python render_sheets.py -- --blend <file.blend> --out <kit dir>
            --mode turntable|sheet|runstrip|all [--res 1024]

turntable : 8 yaw angles (45 deg apart, starting dead-front) + 1 head close-up,
            neutral three-point light, 1024 px, into <out>/_turntable/turntable_aN.webp
sheet     : one frame per clip (the clip's most readable moment, see FRAME_AT)
            into <out>/_work/sheet/<state>.webp (composited by compose_sheets.py)
runstrip  : 12 frames of the run cycle, side-on, into <out>/_work/runstrip/run_NN.webp
"""
import bpy, sys, os, math, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else True
    return default


BLEND = arg("--blend")
OUT = os.path.abspath(arg("--out"))
MODE = arg("--mode", "turntable")
RES = int(arg("--res", 1024))
T0 = time.time()


def log(*a):
    print("[render %6.1fs]" % (time.time() - T0), *a, flush=True)


bpy.ops.wm.open_mainfile(filepath=BLEND)
scene = bpy.context.scene
arm = bpy.data.objects["nim"]
body = bpy.data.objects["nim_body"]

# ------------------------------------------------------------- the studio
scene.render.engine = 'BLENDER_EEVEE'
scene.eevee.taa_render_samples = 48
scene.eevee.use_shadows = True
scene.eevee.use_raytracing = False
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'None'
scene.view_settings.exposure = 0.0
# WEBP: the turntable is a review render (1024x1024 Eevee = 948 KB as PNG, 21 KB as WebP q92).
scene.render.image_settings.file_format = 'WEBP'
scene.render.image_settings.color_mode = 'RGB'
scene.render.image_settings.quality = 92
scene.render.dither_intensity = 0.0

world = bpy.data.worlds.get("studio") or bpy.data.worlds.new("studio")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (0.19, 0.20, 0.22, 1.0)
bg.inputs["Strength"].default_value = 0.55

# neutral grey cyclorama: ground + back wall
for n in ("cyc_ground", "cyc_wall"):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n])
cyc = bpy.data.materials.new("cyc")
cyc.use_nodes = True
cyc.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.36, 0.37, 0.39, 1.0)
cyc.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0)); g = bpy.context.active_object; g.name = "cyc_ground"; g.data.materials.append(cyc)
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, -6, 6)); w = bpy.context.active_object; w.name = "cyc_wall"
w.rotation_euler = (math.radians(90), 0, 0); w.data.materials.append(cyc)


def light(name, kind, energy, color, loc, target, size=1.0, angle=None):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if kind == 'AREA':
        ld.size = size; ld.shape = 'DISK'
    if kind == 'SUN' and angle is not None:
        ld.angle = angle
    lo = bpy.data.objects.new(name, ld); scene.collection.objects.link(lo)
    lo.location = loc
    d = [target[i] - loc[i] for i in range(3)]
    import mathutils
    lo.rotation_euler = mathutils.Vector(d).to_track_quat('-Z', 'Y').to_euler()
    return lo


for n in ("key", "fill", "rim"):
    if n in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[n])
T = (0, 0, 0.8)
# hero faces +Y: key upper-front-left (viewer's left = hero's right = +X), fill front-right, rim behind-above
light("key", 'AREA', 260.0, (1.0, 0.96, 0.90), (2.4, 3.2, 3.4), T, size=1.6)
light("fill", 'AREA', 90.0, (0.86, 0.92, 1.0), (-3.0, 2.6, 1.6), T, size=2.6)
light("rim", 'AREA', 180.0, (1.0, 0.98, 0.95), (-1.2, -3.2, 3.0), (0, 0, 1.0), size=1.0)

cam_d = bpy.data.cameras.new("turncam"); cam_d.lens = 50; cam_d.sensor_width = 36
cam = bpy.data.objects.new("turncam", cam_d); scene.collection.objects.link(cam)
scene.camera = cam
scene.render.resolution_x = RES; scene.render.resolution_y = RES; scene.render.resolution_percentage = 100


def aim(loc, target):
    import mathutils
    cam.location = loc
    d = mathutils.Vector([target[i] - loc[i] for i in range(3)])
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def orbit(yaw_deg, dist=3.7, height=1.0, target=(0, 0, 0.76)):
    a = math.radians(yaw_deg)
    # yaw 0 = dead front = camera on +Y looking -Y
    aim((math.sin(a) * dist, math.cos(a) * dist, height), target)


# ------------------------------------------------------------- posing
def clear_pose():
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0); pb.scale = (1, 1, 1)


def set_action(name, frame):
    act = bpy.data.actions.get(name)
    if act is None:
        return False
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = act
    try:
        arm.animation_data.action_slot = act.slots[0]
    except Exception:
        pass
    scene.frame_set(int(frame))
    return True


def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("wrote", os.path.relpath(path, OUT))


# ------------------------------------------------------------------ modes
if MODE in ("turntable", "all"):
    tdir = os.path.join(OUT, "_turntable"); os.makedirs(tdir, exist_ok=True)
    if not set_action("idle", 1):
        clear_pose()
        # hero.js rest pose so the turntable is not a mannequin (quaternion XYZ = Rx*Ry*Rz)
        from nim_lib import quat_xyz
        REST = {"upperArmR": (0.06, 0, 0.165), "upperArmL": (0.06, 0, -0.165), "lowerArmR": (0.32, 0, 0.06),
                "lowerArmL": (0.32, 0, -0.06), "handR": (0.10, 0, 0.05), "handL": (0.10, 0, -0.05),
                "upperLegR": (0, 0, 0.035), "upperLegL": (0, 0, -0.035), "lowerLegR": (-0.06, 0, 0),
                "lowerLegL": (-0.06, 0, 0), "spine": (-0.03, 0, 0), "chest": (0.04, 0, 0)}
        for b, e in REST.items():
            arm.pose.bones[b].rotation_quaternion = quat_xyz(*e)
    for i in range(8):
        orbit(i * 45)
        render(os.path.join(tdir, "turntable_a%d.webp" % i))
    # close-up: head, three-quarter
    aim((0.55, 1.05, 1.32), (0.0, 0.0, 1.22))
    cam_d.lens = 70
    render(os.path.join(tdir, "turntable_closeup.webp"))
    cam_d.lens = 50

if MODE in ("sheet", "all"):
    sdir = os.path.join(OUT, "_work", "sheet"); os.makedirs(sdir, exist_ok=True)
    scene.render.resolution_x = scene.render.resolution_y = 500
    clips = json.load(open(os.path.join(OUT, "_work", "clips_meta.json")))
    for c in clips:
        if not set_action(c["name"], c["sheet_frame"]):
            continue
        # three-quarter front, framed a touch wider for airborne / prone poses
        orbit(35, dist=4.3, height=1.25, target=(0, 0, 0.82))
        render(os.path.join(sdir, "%02d_%s.webp" % (c["index"], c["name"])))

if MODE in ("runstrip", "all"):
    rdir = os.path.join(OUT, "_work", "runstrip"); os.makedirs(rdir, exist_ok=True)
    scene.render.resolution_x = 360; scene.render.resolution_y = 460
    clips = {c["name"]: c for c in json.load(open(os.path.join(OUT, "_work", "clips_meta.json")))}
    run = clips["run"]
    f0, f1 = run["frame_start"], run["frame_end"]
    for i in range(12):
        f = f0 + (f1 - f0) * (i / 12.0)
        set_action("run", round(f))
        # pure side view: hero faces +Y, camera on +X looking -X
        aim((3.5, 0.0, 0.9), (0, 0, 0.78))
        render(os.path.join(rdir, "run_%02d.webp" % i))

log("done", MODE)
