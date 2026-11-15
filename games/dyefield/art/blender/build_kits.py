"""DYEFIELD - kit, sub and special models (CONTRACT section 3.2 'Kit', CONTRACT_ART_P6_8 section 17), authored
headless in Blender 5.1.

    python art/build.py kits                    # every GLB below + its QA sheet
    python art/build.py kits --no-render
    python art/build.py kits --only sheet_drum,cloudburst

    art/gltf/kit_mist_rasp.glb      MIST-RASP    shooter  (phase 2)         renders/kit_mist_rasp.png
    art/gltf/kit_sheet_drum.glb     SHEET-DRUM   roller   drum, muzzle, grip_L   renders/kit_sheet_drum.png
    art/gltf/kit_needle_glint.glb   NEEDLE-GLINT charger  muzzle, scope, grip_L  renders/kit_needle_glint.png
    art/gltf/kit_pop_well.glb       POP-WELL     blaster  muzzle                 renders/kit_pop_well.png
    art/gltf/sub_jelly_charge.glb   JELLY CHARGE sub      jelly_puddle           renders/sub_special.png
    art/gltf/special_cloudburst.glb CLOUDBURST   special  rain, core             renders/sub_special.png

The two-handed kits' grip_L, bar height and the drum geometry come from build_hero.py (GRIP_L_KIT, KIT_BAR_Z,
DRUM_C, DRUM_R, DRUM_HALF, ROLL_PITCH, NEEDLE_TIP): the hero clips hold the kits by the same numbers, and the hero
build re-measures its hands against the grip_L nodes exported here (so build kits before hero).

MIST-RASP: a chunky toy paint sprayer that must read at gameplay distance (the follow camera sits
4.3 m behind the runner): a bold white/grey body, a BIG team-dye canister riding on top (it faces the
camera in aim), a team-dye rear end (the face the follow camera sees in every pose), and a wide
flared team-dye nozzle. Built facing Blender -Y (barrel along
-Y, arrives as glTF +Z), +Z up, the GRIP AT THE ORIGIN (the runtime attaches the kit to the hero's
socket_weapon with an identity transform, and the socket sits at the centre of the right fist).
~0.53 m long; the rear stays at +0.128 so the aim pose keeps it clear of the chest, all the extra
length is forward. A 'muzzle' empty marks the nozzle mouth. Team-tinted parts use M_kit_dye (light
neutral; the runtime multiplies the team dye in). Deterministic: no random numbers.
"""
import bpy
import os
import sys
from math import pi, sin, cos, radians, sqrt
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_hero as H          # noqa: E402  (mesh/material/render helpers; its main() does not run)
from build_hero import MB, tube, blob, grid, fan, surface_tube, gray, lerp, sstep, se, log  # noqa: E402

KIT_MATS = {
    "M_kit_shell": ("#F3F5F8", 0.34, 0.0, 1.0),
    "M_kit_grip": ("#2B3144", 0.62, 0.0, 1.0),
    "M_kit_metal": ("#A9B4C4", 0.30, 0.55, 1.0),
    "M_kit_dye": ("#F2F2F2", 0.12, 0.0, 1.0),
}
BODY_Z = 0.118           # body axis height above the grip origin (the body sits on top of the fist)
NOZZLE_TIP = -0.405      # y of the nozzle mouth (barrel points -Y)
TANK_R = 0.047           # the team-dye canister on top
TANK_Z = BODY_Z + 0.068 + 0.030
TANK_Y0, TANK_Y1 = -0.110, 0.092


def body_ring(y):
    """(half-width x, half-height z) of the main body at y (rear +0.128 .. front -0.215)."""
    keys = [(-0.215, (0.040, 0.044)), (-0.198, (0.046, 0.051)), (-0.160, (0.053, 0.060)), (-0.100, (0.058, 0.066)),
            (-0.030, (0.060, 0.068)), (0.040, (0.060, 0.068)), (0.085, (0.057, 0.064)), (0.108, (0.050, 0.056)),
            (0.121, (0.037, 0.041)), (0.128, (0.018, 0.020))]
    return H.table(keys, y)


def shell_col(z):
    """two-tone shell: white upper half, light grey belly (vertex colour; the shell material is white)."""
    return gray(lerp(0.74, 1.0, sstep(BODY_Z - 0.030, BODY_Z - 0.010, z)))


def build_body(mb):
    mb.begin("body")
    ys = [0.128, 0.121, 0.108, 0.085, 0.040, -0.030, -0.100, -0.160, -0.198, -0.215]
    N = 22
    rows = []
    for y in ys:
        hw, hh = body_ring(y)
        ring = []
        for j in range(N):
            ph = 2 * pi * j / N
            # U = +Z (ph=0 on top), V = -X ; U x V = -Y = loft direction (rear -> front)
            x = -hw * se(sin(ph), 2.7)
            z = BODY_Z + hh * se(cos(ph), 2.7)
            ring.append(mb.v(Vector((x, y, z)), "root", shell_col(z)))
        rows.append(ring)

    def mat(i, j):
        ph = 2 * pi * (j + 0.5) / N
        # the rounded rear end is team dye: in every hero pose the kit's rear points at the follow
        # camera (idle/run/brush/aim: rear . to-camera = 0.70 .. 0.99), so that is the face players see
        if ys[i] >= 0.108:
            return "M_kit_dye"
        # a bold team stripe along each flank
        if abs(cos(ph)) < 0.34 and -0.19 < ys[i] < 0.10:
            return "M_kit_dye"
        return "M_kit_shell"
    grid(mb, rows, mat)
    fan(mb, mb.v(Vector((0, 0.131, BODY_Z)), "root", gray(1.0)), rows[0], "M_kit_dye", True)
    fan(mb, mb.v(Vector((0, -0.217, BODY_Z)), "root", gray(1.0)), rows[-1], "M_kit_shell", False)


def build_nozzle(mb):
    mb.begin("nozzle")
    ax = Vector((0, -1, 0))
    # barrel neck
    pts = [Vector((0, y, BODY_Z)) for y in (-0.205, -0.235, -0.315, -0.332)]
    tube(mb, pts, [0.027, 0.025, 0.025, 0.029], 14, lambda i, j, p: "root", "M_kit_metal", hint=Vector((0, 0, 1)))
    # grip rings on the barrel
    for y in (-0.250, -0.288):
        tube(mb, [Vector((0, y + 0.008, BODY_Z)), Vector((0, y - 0.008, BODY_Z))], [0.031, 0.031], 14,
             lambda i, j, p: "root", "M_kit_grip", hint=Vector((0, 0, 1)), cap0="flat", cap1="flat")
    # big flared trumpet nozzle with a rolled lip and a dark throat
    prof = [(-0.326, 0.028), (-0.350, 0.034), (-0.370, 0.043), (-0.386, 0.055), (-0.398, 0.065),
            (-0.405, 0.066), (-0.403, 0.058), (-0.390, 0.050)]
    pts = [Vector((0, y, BODY_Z)) for y, _ in prof]
    rad = [r for _, r in prof]
    U, V = Vector((0, 0, 1)), Vector((-1, 0, 0))
    frames = [(U, V, ax)] * len(pts)

    def mat(i, j):
        return "M_kit_dye" if i < 5 else "M_kit_grip"
    tube(mb, pts, rad, 20, lambda i, j, p: "root", mat, frames=frames,
         colfn=lambda i, j, p: gray(0.35 if i >= 6 else 1.0))
    # throat plug
    blob(mb, Vector((0, -0.386, BODY_Z)), ax, Vector((0, 0, 1)), 0.005, 0.049, 0.049, 16, 3, "root", "M_kit_grip",
         colfn=lambda p: gray(0.25))


def build_grip(mb):
    mb.begin("grip")
    tilt = radians(14)
    d = Vector((0, sin(tilt), -cos(tilt)))       # down and slightly back
    top = Vector((0, -0.010, 0.070))
    pts = [top + d * t for t in (0.0, 0.045, 0.090, 0.130, 0.150)]
    rad = [(0.025, 0.031), (0.023, 0.029), (0.024, 0.030), (0.025, 0.031), (0.018, 0.024)]
    tube(mb, pts, rad, 14, lambda i, j, p: "root", "M_kit_grip", hint=Vector((1, 0, 0)), cap1=top + d * 0.158, ex=2.6)
    # finger bumps on the front of the grip
    for t in (0.060, 0.090, 0.120):
        c = top + d * t + Vector((0, -0.025, 0))
        blob(mb, c, Vector((1, 0, 0)), Vector((0, -1, 0)), 0.020, 0.010, 0.011, 8, 4, "root", "M_kit_grip",
             colfn=lambda p: gray(0.8))
    # trigger guard loop + trigger
    mb.begin("trigger")
    ctrl = [Vector((0, y, z)) for y, z in ((-0.100, 0.064), (-0.108, 0.032), (-0.096, 0.004), (-0.072, -0.010),
                                           (-0.046, -0.008), (-0.022, 0.008))]
    pts = [H.spline_pts(ctrl, k / 9.0) for k in range(10)]
    nrm = [Vector((1, 0, 0)) for _ in pts]
    surface_tube(mb, pts, nrm, 0.0055, 0.0085, 6, lambda i, j, p: "root", "M_kit_grip", closed=False)
    blob(mb, Vector((0, -0.058, 0.040)), Vector((0, 0.35, -1)).normalized(), Vector((0, -1, 0)), 0.020, 0.010, 0.008,
         8, 5, "root", "M_kit_dye")


def build_canister(mb):
    """the big team-dye canister riding on top of the body: a solid M_kit_dye cylinder with white domed
    end caps and dark clamp bands, on a saddle, fed into the barrel neck by a pipe."""
    mb.begin("canister")
    ax = Vector((0, -1, 0))
    U = Vector((0, 0, 1))
    cz = TANK_Z
    # saddle: a low block joining canister and body
    tube(mb, [Vector((0, y, BODY_Z + 0.052)) for y in (0.070, -0.090)], [(0.020, 0.030), (0.020, 0.030)], 10,
         lambda i, j, p: "root", "M_kit_shell", hint=U, cap0="flat", cap1="flat", colfn=lambda i, j, p: gray(0.78))
    # the dye cylinder (rear -> front)
    ys = [TANK_Y1 - 0.012, TANK_Y1 - 0.030, 0.030, -0.030, TANK_Y0 + 0.030, TANK_Y0 + 0.012]
    tube(mb, [Vector((0, y, cz)) for y in ys], [TANK_R] * len(ys), 20, lambda i, j, p: "root", "M_kit_dye",
         hint=U, colfn=lambda i, j, p: gray(lerp(0.86, 1.0, sstep(-0.2, 0.9, (p.z - cz) / TANK_R))))
    # domed end caps: the rear one (toward the follow camera) team dye, the front one white
    blob(mb, Vector((0, TANK_Y1 - 0.012, cz)), -ax, U, 0.024, TANK_R + 0.002, TANK_R + 0.002, 20, 6, "root",
         "M_kit_dye", e_prof=2.6)
    blob(mb, Vector((0, TANK_Y0 + 0.012, cz)), ax, U, 0.024, TANK_R + 0.002, TANK_R + 0.002, 20, 6, "root",
         "M_kit_shell", e_prof=2.6)
    # dark clamp bands
    for y in (TANK_Y1 - 0.040, TANK_Y0 + 0.040):
        tube(mb, [Vector((0, y + 0.007, cz)), Vector((0, y - 0.007, cz))], [TANK_R + 0.004] * 2, 20,
             lambda i, j, p: "root", "M_kit_grip", hint=U, cap0="flat", cap1="flat")
    # filler cap on the rear dome
    blob(mb, Vector((0, TANK_Y1 + 0.014, cz)), -ax, U, 0.010, 0.018, 0.018, 12, 4, "root", "M_kit_grip")
    # feed pipe from the front of the canister into the barrel neck
    tube(mb, [Vector((0, TANK_Y0 + 0.004, cz - 0.020)), Vector((0, -0.150, cz - 0.030)),
              Vector((0, -0.196, BODY_Z + 0.030))],
         [0.010, 0.010, 0.010], 8, lambda i, j, p: "root", "M_kit_metal", hint=Vector((1, 0, 0)))


def build_top(mb):
    mb.begin("top")
    # front sight fin (team dye)
    blob(mb, Vector((0, -0.180, BODY_Z + 0.052)), Vector((0, 0, 1)), Vector((0, -1, 0)), 0.016, 0.024, 0.006, 8, 5,
         "root", "M_kit_dye", e_prof=2.4)
    # rear cap: a dark rim around a team-dye disc (the face the follow camera sees)
    tube(mb, [Vector((0, 0.112, BODY_Z)), Vector((0, 0.124, BODY_Z))], [(0.058, 0.052), (0.052, 0.046)], 18,
         lambda i, j, p: "root", "M_kit_grip", hint=Vector((0, 0, 1)))
    tube(mb, [Vector((0, 0.120, BODY_Z)), Vector((0, 0.127, BODY_Z))], [(0.046, 0.040), (0.044, 0.038)], 18,
         lambda i, j, p: "root", "M_kit_dye", hint=Vector((0, 0, 1)), cap1="flat")


def build_kit():
    mb = MB("kit_mist_rasp")
    build_body(mb)
    build_nozzle(mb)
    build_grip(mb)
    build_canister(mb)
    build_top(mb)
    for label, tris, vol in mb.part_report():
        log("kit part %-10s tris %5d  signed-vol %+.6f" % (label, tris, vol))
    log("kit tris", mb.tris())
    return mb


def main():
    log("kits: start; args", H.ARGV)
    os.makedirs(H.GLTF_DIR, exist_ok=True)
    os.makedirs(H.REN_DIR, exist_ok=True)
    only = H.arg_val("--only")
    only = set(only.split(",")) if only else None
    for key, fn in (("mist_rasp", main_mist_rasp), ("sheet_drum", main_sheet_drum),
                    ("needle_glint", main_needle_glint), ("pop_well", main_pop_well),
                    ("jelly", main_jelly), ("cloudburst", main_cloudburst)):
        if only and key not in only:
            continue
        fn()
    if (not only or "jelly" in only or "cloudburst" in only) and not H.arg_flag("--no-render"):
        render_sub_special()
    log("kits: done")


def main_mist_rasp():
    H.clean_scene()
    coll = bpy.context.scene.collection
    for name, (hexc, rough, metal, alpha) in KIT_MATS.items():
        H.make_material(name, hexc, rough, metal, alpha)
    mb = build_kit()
    ob = H.new_mesh_object(mb, "kit_mist_rasp", coll, list(KIT_MATS.keys()), groups=False)
    mz = bpy.data.objects.new("muzzle", None)
    mz.empty_display_type = 'ARROWS'
    mz.empty_display_size = 0.05
    coll.objects.link(mz)
    mz.parent = ob
    mz.location = (0.0, NOZZLE_TIP, BODY_Z)
    bpy.context.view_layer.update()
    bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    length = max(v.y for v in bb) - min(v.y for v in bb)
    log("kit length %.3f m (y %.3f .. %.3f), z %.3f .. %.3f" % (length, min(v.y for v in bb), max(v.y for v in bb),
                                                               min(v.z for v in bb), max(v.z for v in bb)))
    path = os.path.join(H.GLTF_DIR, "kit_mist_rasp.glb")
    H.strip_material_props()
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
        export_texcoords=False, export_normals=True, export_materials='EXPORT', export_image_format='NONE',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_extras=True, export_cameras=False,
        export_lights=False, export_skins=False, export_animations=False, export_morph=False,
        export_draco_mesh_compression_enable=False)
    g = H.Glb(path)
    names = [n.get("name") for n in g.j["nodes"]]
    mzn = g.j["nodes"][names.index("muzzle")]
    tris = sum(g.j["accessors"][p["indices"]]["count"] // 3 for m in g.j["meshes"] for p in m["primitives"])
    log("exported", path, "%.1f KB" % (os.path.getsize(path) / 1024.0), "nodes", names, "muzzle", mzn.get("translation"),
        "tris", tris, "materials", [(m["name"], m.get("doubleSided", False)) for m in g.j["materials"]])
    # the barrel must arrive along glTF +Z with the grip at the origin
    t = mzn.get("translation", [0, 0, 0])
    if not (t[2] > 0.3 and abs(t[0]) < 1e-4):
        raise SystemExit("muzzle not along glTF +Z: %s" % t)
    if H.arg_flag("--no-render"):
        return
    render(ob)


def render(ob):
    cam = H.setup_render(res=(640, 520))
    bpy.data.objects["QA_floor"].hide_render = True
    cache = {}
    tmp = os.path.join(H.REN_DIR, "_tmp_kit")
    os.makedirs(tmp, exist_ok=True)
    paths = []
    tgt = Vector((0.0, -0.140, 0.085))
    for k, (az, el, team, lab) in enumerate(((-55, 22, 1, "MIST-RASP  3/4"), (-90, 4, 1, "SIDE (barrel -Y)"),
                                             (135, 28, 2, "REAR 3/4  (gulf)"))):
        H.render_materials(team, cache)
        H.aim_camera(cam, tgt, az, el, 3.0, ortho=0.74)
        lb = H.label_obj(lab)
        lb.data.size = 0.028
        H.place_label(lb, cam)
        lb.scale = (1, 1, 1)
        p = os.path.join(tmp, "kit_%d.png" % k)
        H.render_to(p)
        paths.append(p)
    H.compose(paths, 3, os.path.join(H.REN_DIR, "kit_mist_rasp.png"))
    try:
        os.rmdir(tmp)
    except Exception:
        pass


# ================================================================================ phase 6 (CONTRACT_ART_P6_8 s17)
# Kit space = socket_weapon space: the grip at the origin (the right fist closes around it), barrel -Y, +Z up.
# Every phase-6 kit uses the same pistol-grip stance as MIST-RASP, so the hero's GRIP_Q holds all of them.
Z = H.KIT_BAR_Z
UP = Vector((0, 0, 1))
FWD = Vector((0, -1, 0))
XAX = Vector((1, 0, 0))
P6_MATS = dict(KIT_MATS)
P6_MATS["M_kit_lens"] = ("#BDF3FF", 0.04, 0.0, 1.0)            # the NEEDLE-GLINT scope lens
SUB_MATS = {k: KIT_MATS[k] for k in ("M_kit_shell", "M_kit_grip", "M_kit_dye")}
SUB_MATS["M_jelly"] = ("#E6F6FF", 0.06, 0.0, 0.30)              # translucent jelly shell over the dye core
CLOUD_MATS = {k: KIT_MATS[k] for k in ("M_kit_shell", "M_kit_grip", "M_kit_dye")}
CLOUD_MATS["M_cloud"] = ("#F4F7FB", 0.78, 0.0, 1.0)
TMP = os.path.join(H.REN_DIR, "_tmp_p6")


def R(i, j, p):
    return "root"


def setup_scene(mats):
    H.clean_scene()
    for name, (hexc, rough, metal, alpha) in mats.items():
        H.make_material(name, hexc, rough, metal, alpha)
    return bpy.context.scene.collection


def crisp(ob, deg=42.0):
    """sharp edges above deg (flat caps, band steps, collars) so smooth shading does not smear across them;
    exported as split normals, triangle count unchanged."""
    ob.data.set_sharp_from_angle(angle=radians(deg))
    return ob


def add_empty(name, parent, loc, size=0.04, props=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'ARROWS'
    e.empty_display_size = size
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    for k, v in (props or {}).items():
        e[k] = v
    return e


def export_and_verify(path, want_nodes, max_tris=3000):
    H.strip_material_props()
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
        export_texcoords=False, export_normals=True, export_materials='EXPORT', export_image_format='NONE',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_extras=True, export_cameras=False,
        export_lights=False, export_skins=False, export_animations=False, export_morph=False,
        export_draco_mesh_compression_enable=False)
    g = H.Glb(path)
    names = [n.get("name") for n in g.j["nodes"]]
    tris = sum(g.j["accessors"][p["indices"]]["count"] // 3 for m in g.j["meshes"] for p in m["primitives"])
    pos = {}
    for n in g.j["nodes"]:
        if n.get("name") in want_nodes:
            pos[n["name"]] = [round(c, 4) for c in n.get("translation", [0, 0, 0])]
    log("exported %s  %.1f KB  tris %d  nodes %s" % (os.path.basename(path), os.path.getsize(path) / 1024.0, tris,
                                                     names))
    log("  node translations (glTF, parent-relative):", pos)
    log("  materials:", [(m["name"], m.get("alphaMode", "OPAQUE")) for m in g.j["materials"]])
    missing = [n for n in want_nodes if n not in names]
    if missing:
        raise SystemExit("%s: missing nodes %s" % (path, missing))
    if tris > max_tris:
        raise SystemExit("%s: %d tris > %d budget" % (path, tris, max_tris))
    return g


def extent_log(obs, label):
    bpy.context.view_layer.update()
    pts = []
    for ob in obs:
        if ob.type == 'MESH':
            pts += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    log("%s extent x %.3f..%.3f (%.3f)  y %.3f..%.3f (%.3f)  z %.3f..%.3f (%.3f)" % (
        label, lo.x, hi.x, hi.x - lo.x, lo.y, hi.y, hi.y - lo.y, lo.z, hi.z, hi.z - lo.z))
    return lo, hi


def qa_panels(views, tgt, ortho, prefix, res=(640, 520)):
    """one render per view (az, el, team, label); returns temp PNG paths for H.compose."""
    cam = H.setup_render(res=res)
    bpy.data.objects["QA_floor"].hide_render = True
    cache = {}
    os.makedirs(TMP, exist_ok=True)
    paths = []
    for k, (az, el, team, lab) in enumerate(views):
        H.render_materials(team, cache)
        H.aim_camera(cam, tgt, az, el, 8.0, ortho=ortho)
        lb = H.label_obj(lab)
        kx = ortho / 0.74
        lb.data.size = 0.028 * kx
        H.place_label(lb, cam)
        lb.scale = (1, 1, 1)
        hw = ortho / 2 if res[0] >= res[1] else ortho / 2 * res[0] / res[1]
        hh = ortho / 2 * res[1] / res[0] if res[0] >= res[1] else ortho / 2
        lb.location = (-hw + 0.035 * kx, hh - 0.070 * kx, -1.0)
        p = os.path.join(TMP, "%s_%d.png" % (prefix, k))
        H.render_to(p)
        paths.append(p)
    return paths


def done_tmp():
    try:
        os.rmdir(TMP)
    except Exception:
        pass


def ribbed(mb, stations, n, mat_fn, col_fn, rad_fn, axis="y", c=Vector((0, 0, 0)), cap0=None, cap1=None):
    """loft rings along an axis ('y' runs -> -Y front, 'x' runs -> +X) with per-vertex radius rad_fn(s, r, j)."""
    rows = []
    for i, (s, r) in enumerate(stations):
        ring = []
        for j in range(n):
            ph = 2 * pi * j / n
            rr = rad_fn(s, r, j)
            if axis == "x":            # loft +X: U = +Y, V = +Z (U x V = +X)
                p = c + Vector((s, rr * cos(ph), rr * sin(ph)))
            else:                      # loft -Y: U = +Z, V = -X (U x V = -Y)
                p = c + Vector((-rr * sin(ph), s, rr * cos(ph)))
            ring.append(mb.v(p, "root", col_fn(s, j)))
        rows.append(ring)
    grid(mb, rows, lambda i, j: mat_fn(0.5 * (stations[i][0] + stations[i + 1][0]), j))
    for which, cap in ((0, cap0), (1, cap1)):
        if cap is None:
            continue
        s, mat = cap
        pole = mb.v(c + (Vector((s, 0, 0)) if axis == "x" else Vector((0, s, 0))), "root", col_fn(s, 0))
        fan(mb, pole, rows[0] if which == 0 else rows[-1], mat, start=(which == 0))
    return rows


def kit_grip(mb):
    """the shared pistol grip (MIST-RASP stance) with a compact trigger guard that leaves room for the left hand
    at grip_L, and a team-dye butt cap."""
    mb.begin("grip")
    tilt = radians(14)
    d = Vector((0, sin(tilt), -cos(tilt)))
    top = Vector((0, -0.010, 0.070))
    pts = [top + d * t for t in (0.0, 0.045, 0.090, 0.130, 0.150)]
    rad = [(0.025, 0.031), (0.023, 0.029), (0.024, 0.030), (0.025, 0.031), (0.018, 0.024)]
    tube(mb, pts, rad, 14, R, "M_kit_grip", hint=XAX, cap1=top + d * 0.158, ex=2.6)
    for t in (0.060, 0.090, 0.120):
        blob(mb, top + d * t + Vector((0, -0.025, 0)), XAX, FWD, 0.020, 0.010, 0.011, 8, 4, "root", "M_kit_grip",
             colfn=lambda p: gray(0.8))
    blob(mb, top + d * 0.150, d, Vector((0, 1, 0)), 0.010, 0.022, 0.028, 12, 3, "root", "M_kit_dye")
    mb.begin("trigger")
    ctrl = [Vector((0, y, z)) for y, z in ((-0.056, 0.062), (-0.066, 0.034), (-0.058, 0.008), (-0.040, -0.006),
                                           (-0.020, 0.006))]
    pts = [H.spline_pts(ctrl, k / 7.0) for k in range(8)]
    surface_tube(mb, pts, [XAX] * len(pts), 0.0055, 0.0080, 6, R, "M_kit_grip", closed=False)
    blob(mb, Vector((0, -0.040, 0.036)), Vector((0, 0.35, -1)).normalized(), FWD, 0.017, 0.009, 0.007, 8, 5, "root",
         "M_kit_dye")


def bar_sleeve(mb, y0, y1, r=0.0205, ribs=2):
    """rubber sleeve on a bar along -Y at KIT_BAR_Z (the left hand's hold), with raised ribs, flat ends."""
    mb.begin("sleeve")
    L = y0 - y1
    st = [(y0, r - 0.003), (y0 - 0.004, r)]
    for k in range(ribs):
        yc = y0 - L * (k + 1) / (ribs + 1)
        st += [(yc + 0.006, r), (yc + 0.003, r + 0.0025), (yc - 0.003, r + 0.0025), (yc - 0.006, r)]
    st += [(y1 + 0.004, r), (y1, r - 0.003)]
    tube(mb, [Vector((0, y, Z)) for y, _ in st], [rr for _, rr in st], 10, R, "M_kit_grip", hint=UP,
         cap0="flat", cap1="flat")


def collar(mb, y, r, w, mat="M_kit_dye", z=None, n=12):
    z = Z if z is None else z
    tube(mb, [Vector((0, y + w / 2, z)), Vector((0, y - w / 2, z))], [r, r], n, R, mat, hint=UP, cap0="flat",
         cap1="flat")


def loft_body(mb, label, keys, cz, n, mat_fn, rear_mat, front_mat, ex=2.8, colfn=None):
    """a rounded body lofted rear (+Y) -> front (-Y) through (y, (half-width, half-height)) keys."""
    mb.begin(label)
    ys = [k[0] for k in sorted(keys, key=lambda k: -k[0])]
    rows = []
    for y in ys:
        hw, hh = H.table(sorted(keys), y)
        ring = []
        for j in range(n):
            ph = 2 * pi * j / n
            p = Vector((-hw * se(sin(ph), ex), y, cz + hh * se(cos(ph), ex)))
            ring.append(mb.v(p, "root", colfn(p) if colfn else gray(1.0)))
        rows.append(ring)
    grid(mb, rows, lambda i, j: mat_fn(0.5 * (ys[i] + ys[i + 1]), j))
    fan(mb, mb.v(Vector((0, ys[0] + 0.003, cz)), "root", gray(1.0)), rows[0], rear_mat, True)
    fan(mb, mb.v(Vector((0, ys[-1] - 0.002, cz)), "root", gray(1.0)), rows[-1], front_mat, False)
    return rows


# ---------------------------------------------------------------------------------------- SHEET-DRUM (roller)
DRUM_RIB_N = 24


def drum_rib(j):
    return (j % 4) in (1, 2)


def build_drum_mesh():
    """the 1.10 m drum, centred on its own origin (the 'drum' empty), axis +X: team-dye tread with raised ribs
    (so the runtime's spin reads), white bands, dark rubber tyres at both ends, white end faces."""
    mb = MB("drum_roller")
    mb.begin("drum")
    hw = H.DRUM_HALF
    half = [(hw, 0.118), (hw - 0.003, 0.142), (hw - 0.012, H.DRUM_R), (hw - 0.045, H.DRUM_R),
            (hw - 0.052, H.DRUM_R - 0.010), (hw - 0.088, H.DRUM_R - 0.010), (hw - 0.095, H.DRUM_R),
            (0.040, H.DRUM_R), (0.034, H.DRUM_R - 0.009)]
    st = [(-x, r) for x, r in half] + [(x, r) for x, r in reversed(half)]

    def zone(s):
        a = abs(s)
        if a > hw - 0.0485:
            return "tyre"
        if a > hw - 0.0915:
            return "band"
        if a > 0.037:
            return "dye"
        return "band"

    def rad(s, r, j):
        on = zone(s) == "dye" and 0.040 <= abs(s) <= hw - 0.095
        return r + (0.011 if (on and drum_rib(j)) else 0.0)

    def col(s, j):
        if zone(s) == "dye":
            return gray(1.0 if drum_rib(j) else 0.62)
        return gray(1.0)

    def mat(s, j):
        if zone(s) == "dye" and j % 4 == 1 and (j // 4) % 2 == 0:
            return "M_kit_shell"               # a white stripe on every other rib: the spin reads
        return {"tyre": "M_kit_grip", "band": "M_kit_shell", "dye": "M_kit_dye"}[zone(s)]
    ribbed(mb, st, DRUM_RIB_N, mat, col, rad, axis="x", cap0=(-hw - 0.006, "M_kit_shell"),
           cap1=(hw + 0.006, "M_kit_shell"))
    return mb


def build_sheet_drum():
    mb = MB("kit_sheet_drum")
    kit_grip(mb)
    # rear housing: the pump block over the fist; its rear (the follow camera's view) is team dye
    keys = [(-0.044, (0.026, 0.026)), (-0.036, (0.038, 0.039)), (-0.018, (0.046, 0.047)), (0.040, (0.049, 0.050)),
            (0.080, (0.047, 0.048)), (0.098, (0.039, 0.040)), (0.108, (0.022, 0.023))]
    HZ = 0.094

    def hmat(y, j):
        ph = 2 * pi * (j + 0.5) / 16
        if y > 0.089:
            return "M_kit_dye"
        if abs(sin(ph)) > 0.92 and -0.03 < y < 0.08:        # a team stripe down each flank
            return "M_kit_dye"
        return "M_kit_shell"
    loft_body(mb, "housing", keys, HZ, 16, hmat, "M_kit_dye", "M_kit_shell",
              colfn=lambda p: gray(lerp(0.76, 1.0, sstep(HZ - 0.030, HZ - 0.008, p.z))))
    # a dark filler knob on top of the housing
    blob(mb, Vector((0, 0.040, HZ + 0.050)), UP, FWD, 0.012, 0.018, 0.018, 12, 4, "root", "M_kit_grip")
    # shaft, the left hand's ribbed sleeve, dye collars
    mb.begin("shaft")
    tube(mb, [Vector((0, y, Z)) for y in (-0.036, -0.200, -0.392)], [0.0170] * 3, 12, R, "M_kit_metal", hint=UP)
    bar_sleeve(mb, -0.050, -0.136)
    collar(mb, -0.150, 0.0225, 0.012)
    collar(mb, -0.362, 0.0225, 0.012)
    # hub where the shaft meets the cross-bar
    mb.begin("yoke")
    YB, ZB = -0.410, Z
    blob(mb, Vector((0, YB + 0.004, ZB)), XAX, FWD, 0.052, 0.034, 0.034, 12, 5, "root", "M_kit_shell", e_ring=2.4,
         e_prof=2.6, colfn=lambda p: gray(lerp(0.8, 1.0, sstep(ZB - 0.02, ZB + 0.02, p.z))))
    xe = H.DRUM_HALF + 0.030
    x0, x1 = H.DRUM_C.x - xe, H.DRUM_C.x + xe
    tube(mb, [Vector((x, YB, ZB)) for x in (x0, 0.0, x1)], [0.0135] * 3, 10, R, "M_kit_metal", hint=UP)
    # the dye manifold that feeds the drum: a wide team-dye bar above/behind the drum, drip nozzles toward it
    MY, MZ = -0.434, Z + 0.036
    mx = 0.47
    tube(mb, [Vector((H.DRUM_C.x + x, MY, MZ)) for x in (-mx, -mx * 0.5, 0.0, mx * 0.5, mx)], [(0.026, 0.021)] * 5, 12,
         R, "M_kit_dye", hint=UP, cap0=Vector((H.DRUM_C.x - mx - 0.024, MY, MZ)),
         cap1=Vector((H.DRUM_C.x + mx + 0.024, MY, MZ)),
         colfn=lambda i, j, p: gray(lerp(0.80, 1.0, sstep(MZ - 0.02, MZ + 0.015, p.z))))
    for x in (-0.36, 0.36):
        collar_x = H.DRUM_C.x + x
        tube(mb, [Vector((collar_x - 0.008, MY, MZ)), Vector((collar_x + 0.008, MY, MZ))], [(0.0295, 0.0245)] * 2, 12,
             R, "M_kit_grip", hint=UP, cap0="flat", cap1="flat")
        # strut from the cross-bar up to the manifold
        tube(mb, [Vector((collar_x, YB, ZB)), Vector((collar_x, MY, MZ))], [0.008, 0.008], 6, R, "M_kit_metal",
             hint=XAX)
    toward = (H.DRUM_C - Vector((H.DRUM_C.x, MY, MZ)))
    toward.x = 0.0
    toward.normalize()
    for k in range(3):
        x = H.DRUM_C.x + lerp(-0.24, 0.24, k / 2.0)
        blob(mb, Vector((x, MY, MZ)) + toward * 0.022, toward, XAX, 0.010, 0.010, 0.010, 8, 3, "root", "M_kit_grip")
    # side arms down to the axle bearings
    for sg in (-1, 1):
        xa = H.DRUM_C.x + sg * xe
        blob(mb, Vector((xa, YB, ZB)), XAX, FWD, 0.024, 0.026, 0.026, 10, 4, "root", "M_kit_shell")
        pts = [Vector((xa, YB, ZB)), Vector((xa, -0.480, ZB + 0.004)), Vector((xa, -0.552, H.DRUM_C.z + 0.030)),
               Vector((xa, H.DRUM_C.y, H.DRUM_C.z))]
        tube(mb, pts, [(0.019, 0.013)] * 4, 10, R, "M_kit_shell", hint=XAX,
             colfn=lambda i, j, p: gray(0.9))
        # bearing cap: white hub with a team-dye button
        xi, xo = H.DRUM_C.x + sg * (H.DRUM_HALF + 0.006), H.DRUM_C.x + sg * (H.DRUM_HALF + 0.044)
        pts = [Vector((xi, H.DRUM_C.y, H.DRUM_C.z)), Vector((xo, H.DRUM_C.y, H.DRUM_C.z))]
        tube(mb, pts, [0.056, 0.050], 18, R, "M_kit_shell", hint=UP, cap0="flat", cap1="flat")
        blob(mb, Vector((xo, H.DRUM_C.y, H.DRUM_C.z)), XAX * sg, UP, 0.012, 0.030, 0.030, 12, 3, "root", "M_kit_dye")
    return mb


def main_sheet_drum():
    coll = setup_scene(P6_MATS)
    mats = list(P6_MATS.keys())
    mb = build_sheet_drum()
    dmb = build_drum_mesh()
    for label, tris, vol in mb.part_report() + dmb.part_report():
        log("sheet_drum part %-10s tris %5d  signed-vol %+.6f" % (label, tris, vol))
    ob = H.new_mesh_object(mb, "kit_sheet_drum", coll, mats, groups=False)
    crisp(ob)
    a = radians(-H.ROLL_PITCH)
    contact = H.DRUM_C + Vector((0.0, -sin(a), -cos(a))) * H.DRUM_R        # floor contact in the 'roll' pose
    add_empty("muzzle", ob, contact, props={"df_note": "drum floor contact in the hero 'roll' pose"})
    add_empty("grip_L", ob, H.GRIP_L_KIT)
    dr = add_empty("drum", ob, H.DRUM_C, 0.08, props={"df_radius": H.DRUM_R, "df_width": 2 * H.DRUM_HALF,
                                                     "df_spin_axis": [1.0, 0.0, 0.0]})
    dob = H.new_mesh_object(dmb, "drum_roller", coll, mats, groups=False)
    crisp(dob)
    dob.parent = dr
    dob.location = (0, 0, 0)
    extent_log([ob, dob], "sheet_drum")
    g = export_and_verify(os.path.join(H.GLTF_DIR, "kit_sheet_drum.glb"), ["muzzle", "grip_L", "drum", "drum_roller"])
    if H.arg_flag("--no-render"):
        return
    paths = qa_panels(((-55, 24, 1, "SHEET-DRUM  3/4"), (-90, 4, 1, "SIDE (barrel -Y)"),
                       (150, 34, 2, "REAR 3/4  (gulf)")), Vector((0.03, -0.33, 0.02)), 1.48, "drum")
    H.compose(paths, 3, os.path.join(H.REN_DIR, "kit_sheet_drum.png"))
    done_tmp()


# ---------------------------------------------------------------------------------------- NEEDLE-GLINT (charger)
RZ = Z + 0.010                   # receiver axis
SZ = RZ + 0.044 + 0.029          # scope axis
CH_Y0, CH_Y1, CH_Z, CH_R = -0.146, -0.292, Z + 0.052, 0.033      # the charge chamber rides above the barrel


def build_needle_glint():
    mb = MB("kit_needle_glint")
    kit_grip(mb)
    keys = [(-0.058, (0.016, 0.020)), (-0.050, (0.026, 0.032)), (-0.032, (0.032, 0.041)), (0.010, (0.034, 0.044)),
            (0.050, (0.034, 0.043)), (0.062, (0.030, 0.037)), (0.070, (0.019, 0.024))]

    def rmat(y, j):
        ph = 2 * pi * (j + 0.5) / 16
        if y > 0.046:
            return "M_kit_dye"                           # the butt pad, the face the follow camera sees
        if abs(sin(ph)) > 0.92:
            return "M_kit_dye"
        return "M_kit_shell"
    loft_body(mb, "receiver", keys, RZ, 16, rmat, "M_kit_dye", "M_kit_shell",
              colfn=lambda p: gray(lerp(0.76, 1.0, sstep(RZ - 0.030, RZ - 0.006, p.z))))
    # scope: dark tube with a rubber eyecup at the rear and a flared objective + bright lens at the front
    mb.begin("scope")
    prof = [(0.058, 0.017), (0.054, 0.024), (0.034, 0.024), (0.026, 0.020), (-0.006, 0.020), (-0.018, 0.026),
            (-0.036, 0.030), (-0.042, 0.030)]
    tube(mb, [Vector((0, y, SZ)) for y, _ in prof], [r for _, r in prof], 14, R,
         lambda i, j: "M_kit_dye" if 4 <= i <= 5 else "M_kit_grip", hint=UP, cap0="flat", cap1="flat")
    blob(mb, Vector((0, -0.043, SZ)), FWD, UP, 0.006, 0.0265, 0.0265, 14, 4, "root", "M_kit_lens")
    for y in (0.036, -0.012):
        blob(mb, Vector((0, y, RZ + 0.046)), UP, FWD, 0.018, 0.010, 0.012, 8, 4, "root", "M_kit_grip")
    # the bar: fore-end sleeve (grip_L), long needle barrel with dye collars, dye tip
    mb.begin("barrel")
    prof = [(-0.040, 0.0180), (-0.150, 0.0180), (-0.300, 0.0168), (-0.500, 0.0152), (-0.700, 0.0136)]
    tube(mb, [Vector((0, y, Z)) for y, _ in prof], [r for _, r in prof], 10, R,
         lambda i, j: "M_kit_dye" if (i >= 1 and j in (0, 9)) else "M_kit_shell", hint=UP,
         colfn=lambda i, j, p: gray(lerp(0.78, 1.0, sstep(Z - 0.010, Z + 0.006, p.z))))
    bar_sleeve(mb, -0.052, -0.134, r=0.0230)
    for y in (-0.340, -0.470, -0.600):
        collar(mb, y, 0.0215, 0.016)
    prof = [(-0.696, 0.0155), (-0.708, 0.0215), (-0.738, 0.0175), (-0.764, 0.0112), (-0.776, 0.0094),
            (-0.782, 0.0082)]
    tube(mb, [Vector((0, y, Z)) for y, _ in prof], [r for _, r in prof], 12, R,
         lambda i, j: "M_kit_dye" if i < 4 else "M_kit_grip", hint=UP, cap0="flat", cap1="flat")
    # charge chamber: a glowing team-dye capsule on a saddle, wound with dark coils, white end domes
    mb.begin("chamber")
    tube(mb, [Vector((0, y, Z + 0.024)) for y in (CH_Y0 + 0.004, CH_Y1 - 0.004)], [(0.014, 0.018)] * 2, 10, R,
         "M_kit_shell", hint=UP, cap0="flat", cap1="flat", colfn=lambda i, j, p: gray(0.82))
    ys = [CH_Y0 - 0.018, lerp(CH_Y0, CH_Y1, 0.5), CH_Y1 + 0.018]
    tube(mb, [Vector((0, y, CH_Z)) for y in ys], [CH_R] * 3, 18, R, "M_kit_dye", hint=UP,
         colfn=lambda i, j, p: gray(lerp(0.85, 1.0, sstep(CH_Z - 0.02, CH_Z + 0.02, p.z))))
    blob(mb, Vector((0, CH_Y0 - 0.018, CH_Z)), -FWD, UP, 0.022, CH_R + 0.002, CH_R + 0.002, 18, 5, "root", "M_kit_shell",
         e_prof=2.6)
    blob(mb, Vector((0, CH_Y1 + 0.018, CH_Z)), FWD, UP, 0.022, CH_R + 0.002, CH_R + 0.002, 18, 5, "root", "M_kit_shell",
         e_prof=2.6)
    for k in range(4):
        y = lerp(CH_Y0 - 0.030, CH_Y1 + 0.030, k / 3.0)
        collar(mb, y, CH_R + 0.0035, 0.008, "M_kit_grip", z=CH_Z, n=18)
    return mb


def main_needle_glint():
    coll = setup_scene(P6_MATS)
    mats = list(P6_MATS.keys())
    mb = build_needle_glint()
    for label, tris, vol in mb.part_report():
        log("needle_glint part %-10s tris %5d  signed-vol %+.6f" % (label, tris, vol))
    ob = H.new_mesh_object(mb, "kit_needle_glint", coll, mats, groups=False)
    crisp(ob)
    add_empty("muzzle", ob, Vector((0, H.NEEDLE_TIP, Z)))
    add_empty("scope", ob, Vector((0, -0.049, SZ)), props={"df_note": "scope glint origin (front lens)"})
    add_empty("grip_L", ob, H.GRIP_L_KIT)
    extent_log([ob], "needle_glint")
    export_and_verify(os.path.join(H.GLTF_DIR, "kit_needle_glint.glb"), ["muzzle", "scope", "grip_L"])
    if H.arg_flag("--no-render"):
        return
    paths = qa_panels(((-55, 22, 1, "NEEDLE-GLINT  3/4"), (-90, 4, 1, "SIDE (barrel -Y)"),
                       (140, 30, 2, "REAR 3/4  (gulf)")), Vector((0.0, -0.36, 0.06)), 1.02, "needle")
    H.compose(paths, 3, os.path.join(H.REN_DIR, "kit_needle_glint.png"))
    done_tmp()


# ---------------------------------------------------------------------------------------- POP-WELL (blaster)
PW_C = Vector((0.0, -0.036, 0.160))      # the big round chamber
PW_R = (0.112, 0.116, 0.110)             # radii along y (barrel), z, x
PW_BZ = 0.152                            # barrel axis
PW_TIP = -0.416                          # front of the muzzle lip


def sphere_ring(y_off, lift=0.0):
    """points + normals of the chamber's cross-section ring at y = PW_C.y + y_off."""
    ry, rz, rx = PW_R
    k = sqrt(max(0.0, 1.0 - (y_off / ry) ** 2))
    pts, nrm = [], []
    for j in range(22):
        ph = 2 * pi * j / 22
        p = PW_C + Vector((rx * k * cos(ph), y_off, rz * k * sin(ph)))
        n = Vector(((p.x - PW_C.x) / rx ** 2, (p.y - PW_C.y) / ry ** 2, (p.z - PW_C.z) / rz ** 2)).normalized()
        pts.append(p + n * lift)
        nrm.append(n)
    return pts, nrm


def build_pop_well():
    mb = MB("kit_pop_well")
    kit_grip(mb)
    mb.begin("saddle")
    tube(mb, [Vector((0, y, 0.074)) for y in (0.036, -0.010, -0.062)], [(0.020, 0.032)] * 3, 14, R, "M_kit_shell",
         hint=UP, cap0="flat", cap1="flat", colfn=lambda i, j, p: gray(0.8))
    mb.begin("chamber")
    ry, rz, rx = PW_R
    blob(mb, PW_C, FWD, UP, ry, rz, rx, 24, 13, "root", "M_kit_dye",
         colfn=lambda p: gray(lerp(0.80, 1.0, sstep(PW_C.z - 0.08, PW_C.z + 0.06, p.z))))
    # white belt round the equator, a porthole rim at the rear, a collar where the barrel leaves
    for y_off, hw, hh in ((0.0, 0.019, 0.0065), (0.080, 0.0080, 0.005), (-0.090, 0.012, 0.006)):
        pts, nrm = sphere_ring(y_off)
        surface_tube(mb, pts, nrm, hw, hh, 4, R, "M_kit_shell", closed=True, lift=0.001)
    # rear pump knob (the follow camera's view): white boss, team-dye button
    tube(mb, [PW_C + Vector((0, ry - 0.012, -0.004)), PW_C + Vector((0, ry + 0.020, -0.004))], [0.026, 0.024], 16, R,
         "M_kit_shell", hint=UP, cap1="flat")
    blob(mb, PW_C + Vector((0, ry + 0.021, -0.004)), -FWD, UP, 0.009, 0.017, 0.017, 14, 4, "root", "M_kit_dye")
    # pop valve on top + side gauge nubs
    blob(mb, PW_C + Vector((0, 0.012, rz - 0.004)), UP, FWD, 0.014, 0.024, 0.024, 14, 5, "root", "M_kit_grip")
    blob(mb, PW_C + Vector((0, 0.012, rz + 0.012)), UP, FWD, 0.010, 0.013, 0.013, 12, 4, "root", "M_kit_dye")
    for sg in (-1, 1):
        blob(mb, PW_C + Vector((sg * (rx - 0.002), 0.030, 0.030)), XAX * sg, UP, 0.008, 0.016, 0.016, 12, 4, "root",
             "M_kit_grip")
    # a short fat cannon (not a trumpet: that is MIST-RASP's read) with dark bands, a team-dye band, and a
    # rolled donut lip round a dark bore
    mb.begin("barrel")
    tube(mb, [Vector((0, y, PW_BZ)) for y in (-0.100, -0.240, -0.388)], [0.043, 0.045, 0.047], 16, R, "M_kit_shell",
         hint=UP, colfn=lambda i, j, p: gray(lerp(0.78, 1.0, sstep(PW_BZ - 0.03, PW_BZ + 0.01, p.z))))
    for y in (-0.196, -0.246):
        collar(mb, y, 0.0485, 0.014, "M_kit_grip", z=PW_BZ, n=16)
    collar(mb, -0.330, 0.0515, 0.034, "M_kit_dye", z=PW_BZ, n=16)
    ring = [Vector((0.052 * cos(2 * pi * k / 20), -0.396, PW_BZ + 0.052 * sin(2 * pi * k / 20))) for k in range(20)]
    tube(mb, ring, [0.020] * 20, 10, R, "M_kit_dye", hint=FWD, closed_path=True)
    blob(mb, Vector((0, -0.388, PW_BZ)), FWD, UP, 0.006, 0.050, 0.050, 16, 3, "root", "M_kit_grip",
         colfn=lambda p: gray(0.25))
    return mb


def main_pop_well():
    coll = setup_scene(P6_MATS)
    mats = list(P6_MATS.keys())
    mb = build_pop_well()
    for label, tris, vol in mb.part_report():
        log("pop_well part %-10s tris %5d  signed-vol %+.6f" % (label, tris, vol))
    ob = H.new_mesh_object(mb, "kit_pop_well", coll, mats, groups=False)
    crisp(ob)
    add_empty("muzzle", ob, Vector((0, PW_TIP, PW_BZ)))
    extent_log([ob], "pop_well")
    export_and_verify(os.path.join(H.GLTF_DIR, "kit_pop_well.glb"), ["muzzle"])
    if H.arg_flag("--no-render"):
        return
    paths = qa_panels(((-55, 22, 1, "POP-WELL  3/4"), (-90, 4, 1, "SIDE (barrel -Y)"),
                       (140, 28, 2, "REAR 3/4  (gulf)")), Vector((0.0, -0.17, 0.10)), 0.80, "popwell")
    H.compose(paths, 3, os.path.join(H.REN_DIR, "kit_pop_well.png"))
    done_tmp()


# ---------------------------------------------------------------------------------------- JELLY CHARGE (sub)
def lobed_loft(mb, prof, n, wob, mat, colfn, c=Vector((0, 0, 0))):
    """closed body of revolution about +Z through (z, r) prof (bottom -> top, poles at both ends), with the ring
    radius wobbled into 'lobes' (amp_fn(z) fraction) - a jelly gumdrop / a dye splat."""
    rows = []
    for z, r in prof[1:-1]:
        ring = []
        for j in range(n):
            ph = 2 * pi * j / n
            rr = r * wob(ph, z)
            p = c + Vector((rr * cos(ph), rr * sin(ph), z))       # CCW about +Z, rows bottom -> top: outward
            ring.append(mb.v(p, "root", colfn(p)))
        rows.append(ring)
    grid(mb, rows, mat)
    fan(mb, mb.v(c + Vector((0, 0, prof[0][0])), "root", colfn(c + Vector((0, 0, prof[0][0])))), rows[0], mat, True)
    fan(mb, mb.v(c + Vector((0, 0, prof[-1][0])), "root", colfn(c + Vector((0, 0, prof[-1][0])))), rows[-1], mat,
        False)
    return rows


def build_jelly():
    """the thrown capsule (~0.28 m), centred on its origin: a lobed translucent jelly dome over a team-dye core,
    on a white base cap with a dye stripe, a little white fuse on top."""
    mb = MB("sub_jelly_charge")
    mb.begin("shell")
    prof = [(-0.086, 0.0), (-0.083, 0.086), (-0.075, 0.121), (-0.056, 0.137), (-0.020, 0.140), (0.020, 0.133),
            (0.054, 0.112), (0.080, 0.075), (0.096, 0.038), (0.104, 0.0)]
    lobed_loft(mb, prof, 26, lambda ph, z: 1.0 + 0.12 * sstep(-0.09, -0.04, z) * (1 - sstep(0.05, 0.10, z)) *
               cos(5 * ph + 7.0 * z), "M_jelly", lambda p: gray(lerp(0.92, 1.0, sstep(-0.05, 0.08, p.z))))
    mb.begin("core")
    blob(mb, Vector((0, 0, -0.008)), UP, FWD, 0.084, 0.108, 0.108, 18, 10, "root", "M_kit_dye",
         colfn=lambda p: gray(lerp(0.78, 1.0, sstep(-0.06, 0.06, p.z))))
    mb.begin("base")
    blob(mb, Vector((0, 0, -0.078)), UP, FWD, 0.022, 0.112, 0.112, 24, 6, "root", "M_kit_shell", e_prof=2.8)
    pts = [Vector((0.114 * cos(2 * pi * j / 24), 0.114 * sin(2 * pi * j / 24), -0.078)) for j in range(24)]
    nrm = [Vector((cos(2 * pi * j / 24), sin(2 * pi * j / 24), 0)) for j in range(24)]
    surface_tube(mb, pts, nrm, 0.013, 0.005, 6, R, "M_kit_dye", closed=True, lift=0.0)
    mb.begin("fuse")
    tube(mb, [Vector((0, 0, 0.090)), Vector((0, 0, 0.122))], [0.017, 0.015], 12, R, "M_kit_shell", hint=XAX,
         cap1="flat")
    blob(mb, Vector((0, 0, 0.124)), UP, FWD, 0.010, 0.013, 0.013, 12, 4, "root", "M_kit_dye")
    return mb


def build_puddle():
    """the landed variant (origin on the floor): a flat lobed dye splat, a low jelly dome and the core bump,
    a ring of droplets."""
    mb = MB("jelly_puddle")
    mb.begin("splat")
    R0 = 0.33
    prof = [(0.0, 0.0), (0.0005, R0), (0.012, R0 * 0.97), (0.022, R0 * 0.86), (0.030, R0 * 0.62), (0.034, R0 * 0.30),
            (0.036, 0.0)]
    lobed_loft(mb, prof, 36, lambda ph, z: 1.0 + 0.11 * cos(7 * ph) + 0.07 * cos(3 * ph + 1.1) + 0.04 * cos(11 * ph + 0.4),
               "M_kit_dye", lambda p: gray(lerp(0.80, 1.0, p.z / 0.036)))
    mb.begin("dome")
    prof = [(0.020, 0.0), (0.021, 0.165), (0.040, 0.150), (0.066, 0.110), (0.082, 0.058), (0.088, 0.0)]
    lobed_loft(mb, prof, 24, lambda ph, z: 1.0 + 0.07 * cos(5 * ph + 5.0 * z), "M_jelly", lambda p: gray(1.0))
    blob(mb, Vector((0, 0, 0.040)), UP, FWD, 0.034, 0.070, 0.070, 16, 6, "root", "M_kit_dye")
    for k in range(6):
        a = 2 * pi * k / 6 + 0.35
        rr = 0.40 + 0.04 * ((k * 5) % 3)
        blob(mb, Vector((rr * cos(a), rr * sin(a), 0.010)), UP, FWD, 0.012, 0.024 - 0.003 * (k % 2),
             0.024 - 0.003 * (k % 2), 10, 4, "root", "M_kit_dye")
    return mb


def main_jelly():
    coll = setup_scene(SUB_MATS)
    mats = list(SUB_MATS.keys())
    mb = build_jelly()
    pm = build_puddle()
    for label, tris, vol in mb.part_report() + pm.part_report():
        log("jelly part %-10s tris %5d  signed-vol %+.6f" % (label, tris, vol))
    ob = H.new_mesh_object(mb, "sub_jelly_charge", coll, mats, groups=False)
    crisp(ob)
    pob = H.new_mesh_object(pm, "jelly_puddle", coll, mats, groups=False)
    crisp(pob)
    pob["df_hidden"] = 1              # hidden by default: the runtime shows it (and hides the capsule) on landing
    pob.hide_viewport = True
    pob.hide_render = True
    extent_log([ob], "jelly capsule")
    extent_log([pob], "jelly puddle")
    export_and_verify(os.path.join(H.GLTF_DIR, "sub_jelly_charge.glb"), ["sub_jelly_charge", "jelly_puddle"])
    if H.arg_flag("--no-render"):
        return
    p1 = qa_panels(((-40, 24, 1, "JELLY CHARGE  3/4"), (140, 14, 2, "JELLY CHARGE (gulf)")), Vector((0, 0, 0.01)),
                   0.42, "jelly")
    ob.hide_render = True
    pob.hide_render = False
    p2 = qa_panels(((-40, 34, 1, "jelly_puddle (hidden by default)"),), Vector((0, 0, 0.02)), 1.0, "puddle")
    global SUB_PANELS
    SUB_PANELS = p1 + p2


# ---------------------------------------------------------------------------------------- CLOUDBURST (special)
CB_PUFFS = [((0.00, 0.06, 0.60), 0.54), ((-0.56, 0.12, 0.47), 0.44), ((0.58, 0.03, 0.49), 0.45),
            ((-0.28, -0.34, 0.40), 0.37), ((0.31, -0.35, 0.42), 0.38), ((-0.88, -0.10, 0.33), 0.30),
            ((0.90, -0.06, 0.35), 0.31), ((0.08, 0.42, 0.44), 0.37), ((-0.36, 0.34, 0.66), 0.32)]
CB_CORE = Vector((0.0, 0.0, -0.34))


def build_cloud():
    """the rain cell (~2.4 m wide), origin = belly centre: a team-dye rain slab (the underside the follow camera
    sees when it hovers at 2.8 m) under a cluster of white puffs, dye droplets hanging from the belly."""
    mb = MB("special_cloudburst")
    mb.begin("slab")
    blob(mb, Vector((0, 0, 0.140)), UP, FWD, 0.170, 0.70, 1.02, 26, 8, "root", "M_kit_dye", e_ring=2.3, e_prof=2.6,
         colfn=lambda p: gray(lerp(0.68, 1.0, sstep(0.0, 0.22, p.z))))
    mb.begin("puffs")
    for (x, y, z), r in CB_PUFFS:
        blob(mb, Vector((x, y, z)), UP, FWD, r * 0.86, r, r * 0.94, 12, 7, "root", "M_cloud",
             colfn=lambda p, z=z, r=r: gray(lerp(0.80, 1.0, sstep(z - r * 0.9, z + r * 0.4, p.z))))
    mb.begin("drops")
    for k in range(5):
        a = 2 * pi * k / 5 + 0.2
        rr = 0.40 + 0.22 * (k % 3) / 2.0
        c = Vector((rr * cos(a) * 1.3, rr * sin(a), -0.06 - 0.05 * (k % 2)))
        blob(mb, c, UP, FWD, 0.052, 0.030, 0.030, 8, 4, "root", "M_kit_dye", e_prof=1.6)
    return mb


def build_core():
    """the spinning buoy-core, on its own origin (the 'core' empty; spin axis +Z = glTF +Y): a glowing team-dye
    ball with a white band, four fins and white caps."""
    mb = MB("core_buoy")
    mb.begin("core")
    blob(mb, Vector((0, 0, 0)), UP, FWD, 0.130, 0.130, 0.130, 16, 8, "root", "M_kit_dye",
         colfn=lambda p: gray(lerp(0.86, 1.0, sstep(-0.1, 0.1, p.z))))
    pts = [Vector((0.133 * cos(2 * pi * j / 20), 0.133 * sin(2 * pi * j / 20), 0)) for j in range(20)]
    nrm = [Vector((cos(2 * pi * j / 20), sin(2 * pi * j / 20), 0)) for j in range(20)]
    surface_tube(mb, pts, nrm, 0.024, 0.008, 4, R, "M_kit_shell", closed=True)
    for k in range(4):
        a = 2 * pi * k / 4
        d = Vector((cos(a), sin(a), 0))
        blob(mb, d * 0.160, d, UP, 0.030, 0.040, 0.008, 6, 4, "root", "M_kit_shell", e_prof=2.6)
    for sg in (-1, 1):
        blob(mb, Vector((0, 0, sg * 0.128)), UP * sg, FWD, 0.022, 0.040, 0.040, 12, 3, "root", "M_kit_shell")
    return mb


def main_cloudburst():
    coll = setup_scene(CLOUD_MATS)
    mats = list(CLOUD_MATS.keys())
    mb = build_cloud()
    cm = build_core()
    for label, tris, vol in mb.part_report() + cm.part_report():
        log("cloudburst part %-10s tris %5d  signed-vol %+.6f" % (label, tris, vol))
    ob = H.new_mesh_object(mb, "special_cloudburst", coll, mats, groups=False)
    crisp(ob)
    add_empty("rain", ob, Vector((0, 0, -0.030)), 0.3, props={"df_note": "rain emitter centre (belly); rain falls -Y"})
    ce = add_empty("core", ob, CB_CORE, 0.2, props={"df_spin_axis": [0.0, 1.0, 0.0]})
    cob = H.new_mesh_object(cm, "core_buoy", coll, mats, groups=False)
    crisp(cob)
    cob.parent = ce
    cob.location = (0, 0, 0)
    extent_log([ob, cob], "cloudburst")
    export_and_verify(os.path.join(H.GLTF_DIR, "special_cloudburst.glb"), ["rain", "core", "core_buoy"])
    if H.arg_flag("--no-render"):
        return
    global SPECIAL_PANELS
    SPECIAL_PANELS = qa_panels(((-35, 14, 2, "CLOUDBURST (gulf)"), (160, -16, 1, "from below (suncrew)")),
                               Vector((0, 0, 0.30)), 3.3, "cloud")


SUB_PANELS = []
SPECIAL_PANELS = []


def render_sub_special():
    paths = SUB_PANELS + SPECIAL_PANELS
    if not paths:
        return
    while len(paths) % 5:
        paths.append(paths[-1])
    H.compose(paths[:5], 5, os.path.join(H.REN_DIR, "sub_special.png"))
    done_tmp()


if __name__ == "__main__":
    main()
