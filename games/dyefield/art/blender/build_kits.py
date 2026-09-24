"""DYEFIELD - kit models (CONTRACT section 3.2 'Kit'), authored headless in Blender 5.1.

    python art/build.py kits                    # art/gltf/kit_mist_rasp.glb + art/renders/kit_mist_rasp.png
    python art/build.py kits --no-render

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


if __name__ == "__main__":
    main()
