"""DYEFIELD - kit models (CONTRACT section 3.2 'Kit'), authored headless in Blender 5.1.

    python art/build.py kits                    # art/gltf/kit_mist_rasp.glb + art/renders/kit_mist_rasp.png
    python art/build.py kits --no-render

MIST-RASP: a chunky toy paint sprayer. Built facing Blender -Y (barrel along -Y, arrives as glTF +Z),
+Z up, the GRIP AT THE ORIGIN (the runtime attaches the kit to the hero's socket_weapon with an
identity transform, and the socket sits at the centre of the right fist). ~0.45 m long. A 'muzzle'
empty marks the nozzle mouth. Team-tinted parts use M_kit_dye (light neutral; the runtime multiplies
the team dye in). Deterministic: no random numbers.
"""
import bpy
import os
import sys
from math import pi, sin, cos, radians
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_hero as H          # noqa: E402  (mesh/material/render helpers; its main() does not run)
from build_hero import MB, tube, blob, grid, fan, surface_tube, gray, lerp, sstep, se, log  # noqa: E402

KIT_MATS = {
    "M_kit_shell": ("#F3F5F8", 0.34, 0.0, 1.0),
    "M_kit_grip": ("#2B3144", 0.62, 0.0, 1.0),
    "M_kit_metal": ("#A9B4C4", 0.30, 0.55, 1.0),
    "M_kit_dye": ("#F2F2F2", 0.12, 0.0, 1.0),
    "M_glass": ("#FFFFFF", 0.03, 0.0, 0.06),
}
BODY_Z = 0.100           # body axis height above the grip origin (the body sits on top of the fist)
NOZZLE_TIP = -0.335      # y of the nozzle mouth (barrel points -Y)


def body_ring(y):
    """(half-width x, half-height z) of the main body at y (rear +0.13 .. front -0.16)."""
    keys = [(-0.160, (0.030, 0.032)), (-0.145, (0.033, 0.036)), (-0.110, (0.038, 0.043)), (-0.060, (0.042, 0.049)),
            (-0.010, (0.044, 0.052)), (0.040, (0.044, 0.052)), (0.080, (0.042, 0.049)), (0.105, (0.037, 0.042)),
            (0.120, (0.028, 0.032)), (0.128, (0.014, 0.016))]
    return H.table(keys, y)


def build_body(mb):
    mb.begin("body")
    ys = [0.128, 0.120, 0.105, 0.080, 0.040, -0.010, -0.060, -0.110, -0.145, -0.160]
    N = 20
    rows = []
    for y in ys:
        hw, hh = body_ring(y)
        ring = []
        for j in range(N):
            ph = 2 * pi * j / N
            # U = +Z (ph=0 on top), V = -X ; U x V = -Y = loft direction (rear -> front)
            x = -hw * se(sin(ph), 2.7)
            z = BODY_Z + hh * se(cos(ph), 2.7)
            ring.append(mb.v(Vector((x, y, z)), "root", gray(1.0)))
        rows.append(ring)

    def mat(i, j):
        ph = 2 * pi * (j + 0.5) / N
        # a team stripe along each flank
        if abs(cos(ph)) < 0.28 and -0.13 < ys[i] < 0.10:
            return "M_kit_dye"
        return "M_kit_shell"
    grid(mb, rows, mat)
    fan(mb, mb.v(Vector((0, 0.132, BODY_Z)), "root"), rows[0], "M_kit_shell", True)
    fan(mb, mb.v(Vector((0, -0.162, BODY_Z)), "root"), rows[-1], "M_kit_shell", False)


def build_nozzle(mb):
    mb.begin("nozzle")
    ax = Vector((0, -1, 0))
    # barrel neck
    pts = [Vector((0, y, BODY_Z)) for y in (-0.150, -0.175, -0.255, -0.272)]
    tube(mb, pts, [0.021, 0.019, 0.019, 0.023], 14, lambda i, j, p: "root", "M_kit_metal", hint=Vector((0, 0, 1)))
    # grip rings on the barrel
    for y in (-0.195, -0.225):
        tube(mb, [Vector((0, y + 0.006, BODY_Z)), Vector((0, y - 0.006, BODY_Z))], [0.0235, 0.0235], 14,
             lambda i, j, p: "root", "M_kit_grip", hint=Vector((0, 0, 1)), cap0="flat", cap1="flat")
    # flared trumpet nozzle with a rolled lip and a dark throat
    prof = [(-0.268, 0.022), (-0.290, 0.026), (-0.308, 0.032), (-0.322, 0.040), (-0.331, 0.046),
            (-0.336, 0.046), (-0.334, 0.040), (-0.322, 0.034)]
    pts = [Vector((0, y, BODY_Z)) for y, _ in prof]
    rad = [r for _, r in prof]
    U, V = Vector((0, 0, 1)), Vector((-1, 0, 0))
    frames = [(U, V, ax)] * len(pts)

    def mat(i, j):
        return "M_kit_dye" if i < 5 else "M_kit_grip"
    tube(mb, pts, rad, 18, lambda i, j, p: "root", mat, frames=frames,
         colfn=lambda i, j, p: gray(0.35 if i >= 6 else 1.0))
    # throat plug
    blob(mb, Vector((0, -0.318, BODY_Z)), ax, Vector((0, 0, 1)), 0.004, 0.033, 0.033, 14, 3, "root", "M_kit_grip",
         colfn=lambda p: gray(0.25))


def build_grip(mb):
    mb.begin("grip")
    tilt = radians(14)
    d = Vector((0, sin(tilt), -cos(tilt)))       # down and slightly back
    top = Vector((0, -0.010, 0.066))
    pts = [top + d * t for t in (0.0, 0.045, 0.090, 0.130, 0.148)]
    rad = [(0.022, 0.028), (0.020, 0.026), (0.021, 0.027), (0.022, 0.028), (0.016, 0.022)]
    tube(mb, pts, rad, 14, lambda i, j, p: "root", "M_kit_grip", hint=Vector((1, 0, 0)), cap1=top + d * 0.156, ex=2.6)
    # finger bumps on the front of the grip
    for t in (0.060, 0.088, 0.116):
        c = top + d * t + Vector((0, -0.022, 0))
        blob(mb, c, Vector((1, 0, 0)), Vector((0, -1, 0)), 0.018, 0.009, 0.010, 8, 4, "root", "M_kit_grip",
             colfn=lambda p: gray(0.8))
    # trigger guard loop + trigger
    mb.begin("trigger")
    ctrl = [Vector((0, y, z)) for y, z in ((-0.094, 0.066), (-0.100, 0.034), (-0.090, 0.006), (-0.068, -0.008),
                                           (-0.044, -0.006), (-0.020, 0.008))]
    pts = [H.spline_pts(ctrl, k / 9.0) for k in range(10)]
    nrm = [Vector((1, 0, 0)) for _ in pts]
    surface_tube(mb, pts, nrm, 0.0048, 0.0075, 6, lambda i, j, p: "root", "M_kit_grip", closed=False)
    blob(mb, Vector((0, -0.054, 0.040)), Vector((0, 0.35, -1)).normalized(), Vector((0, -1, 0)), 0.018, 0.009, 0.007,
         8, 5, "root", "M_kit_dye")


def build_canister(mb):
    """side canister on the right (-X) flank with a dye window facing out."""
    mb.begin("canister")
    cx, cz, r = -0.066, BODY_Z + 0.006, 0.030
    y0, y1 = -0.060, 0.070
    ax = Vector((0, -1, 0))
    cols = [2 * pi * k / 16 for k in range(16)]
    # ring param: U = -X (outward, ph=0), V = ax x U
    U = Vector((-1, 0, 0))
    V = ax.cross(U)
    ys = [y1, y1 - 0.012, 0.040, 0.010, -0.020, y0 + 0.012, y0]
    rows = []
    for y in ys:
        rows.append([mb.v(Vector((cx, y, cz)) + U * (r * cos(ph)) + V * (r * sin(ph)), "root") for ph in cols])

    def mat(i, j):
        ph = 2 * pi * (j + 0.5) / 16
        win = cos(ph) > 0.35 and 0 < i < len(ys) - 2
        if i == 0 or i == len(ys) - 2:
            return "M_kit_grip"
        return "M_glass" if win else "M_kit_shell"
    grid(mb, rows, mat)
    blob(mb, Vector((cx, y1 + 0.001, cz)), -ax, U, 0.016, r, r, 16, 6, "root", "M_kit_shell")
    blob(mb, Vector((cx, y0 - 0.001, cz)), ax, U, 0.016, r, r, 16, 6, "root", "M_kit_shell")
    # the dye inside (team tinted)
    tube(mb, [Vector((cx, y1 - 0.014, cz)), Vector((cx, y0 + 0.014, cz))], [r - 0.006] * 2, 12,
         lambda i, j, p: "root", "M_kit_dye", hint=U, cap0="flat", cap1="flat")
    # feed pipe into the body
    tube(mb, [Vector((cx + 0.012, y0 - 0.004, cz - 0.004)), Vector((-0.036, -0.090, BODY_Z - 0.004))],
         [0.008, 0.008], 8, lambda i, j, p: "root", "M_kit_metal", hint=Vector((0, 0, 1)))


def build_top(mb):
    mb.begin("top")
    # rear pressure dial
    c = Vector((0, 0.086, BODY_Z + 0.046))
    tube(mb, [c, c + Vector((0, 0, 0.014))], [0.018, 0.018], 12, lambda i, j, p: "root", "M_kit_grip",
         hint=Vector((0, -1, 0)), cap1="flat")
    blob(mb, c + Vector((0, 0, 0.020)), Vector((0, 0, 1)), Vector((0, -1, 0)), 0.008, 0.021, 0.021, 12, 5, "root",
         "M_kit_dye", e_prof=3.0)
    # front sight fin
    blob(mb, Vector((0, -0.112, BODY_Z + 0.046)), Vector((0, 0, 1)), Vector((0, -1, 0)), 0.014, 0.022, 0.005, 8, 5,
         "root", "M_kit_dye", e_prof=2.4)
    # rear cap ring
    tube(mb, [Vector((0, 0.114, BODY_Z)), Vector((0, 0.124, BODY_Z))], [(0.034, 0.030), (0.030, 0.026)], 16,
         lambda i, j, p: "root", "M_kit_grip", hint=Vector((0, 0, 1)), cap1="flat")


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
    tgt = Vector((0.0, -0.105, 0.030))
    for k, (az, el, team, lab) in enumerate(((-55, 22, 1, "MIST-RASP  3/4"), (-90, 4, 1, "SIDE (barrel -Y)"),
                                             (135, 28, 2, "REAR 3/4  (gulf)"))):
        H.render_materials(team, cache)
        H.aim_camera(cam, tgt, az, el, 3.0, ortho=0.56)
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


if __name__ == "__main__":
    main()
