# tools/a11_build_operators.py — BLACKRIDGE operator variety: modular gear + body mask.
#
# 2026-11-14. Every operator in a match was the same soldier.glb: ten identical bodies.
# This generator AUTHORS original modular gear against that body's own rest pose
# (the node-TRS T-pose Blender shows on import — the pose the runtime measures its
# bone inverses from, core/chars/operator_looks.js) and bakes a small UV-space mask
# the body shader uses to recolour cloth and skin per look. No downloads, no
# external meshes: every piece below is built from primitives here.
#
# OUTPUTS (assets/chars/, MISSION phase by prefix):
#   op_gear.glb   meshes named "L<look>__<Bone>" — plain (unskinned) meshes in the
#                 body's model space (metres, glTF Y-up after export), vertex colour
#                 COLOR_0 ("Col"). Pure magenta (1,0,1) marks TEAM-ACCENT faces: the
#                 runtime replaces them with the team colour from core/team_color.js.
#                 Runtime merges each look's pieces into ONE rigidly-skinned mesh
#                 (one draw per operator), each piece weighted 1.0 to <Bone>.
#   op_mask.png   256x256 RGB in the body's UV space: R = bare skin (face, ears,
#                 forearms), G = trousers. B unused. The body shader recolours
#                 cloth by luminance and multiplies skin per look.
#
# usage: blender -b --factory-startup -noaudio --python tools/a11_build_operators.py -- [--preview DIR]
import sys, os, math, json, subprocess, shutil
import bpy, bmesh
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
SRC = os.path.join(GAME, "assets", "chars", "soldier.glb")
OUT_GLB = os.path.join(GAME, "assets", "chars", "op_gear.glb")
OUT_MASK = os.path.join(GAME, "assets", "chars", "op_mask.png")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGV[ARGV.index("--preview") + 1] if "--preview" in ARGV else None


def lin(hexstr):
    h = hexstr.lstrip("#")
    def f(x):
        x = int(x, 16) / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return (f(h[0:2]), f(h[2:4]), f(h[4:6]))


ACCENT = (1.0, 0.0, 1.0)
# gear palette (sRGB). Kept dark: the night light pool lifts albedo ~1.4x in game.
C = {
    "tan": lin("#5f5440"), "olive": lin("#3c4130"), "black": lin("#1b1c1e"),
    "grey": lin("#46494c"), "green": lin("#323a2a"), "coyote": lin("#5a4a36"),
    "khaki": lin("#6a6048"), "strap": lin("#26271f"), "lens": lin("#0c0e10"),
    "knit": lin("#38342f"), "sand": lin("#7a6c52"),
}

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
ARM = next(o for o in bpy.data.objects if o.type == "ARMATURE")
BODY = max((o for o in bpy.data.objects if o.type == "MESH"), key=lambda o: len(o.data.vertices))
DG = bpy.context.evaluated_depsgraph_get()
_bme = BODY.evaluated_get(DG).to_mesh()
BV = [BODY.matrix_world @ v.co for v in _bme.vertices]
# The runtime's REST space is the BIND pose (three.js: node TRS == inverse bind on
# this rig, raw geometry centred on the origin). Blender DISPLAYS the body in the
# glTF node pose, which differs from bind by the hips lift (+0.94 m) and a few
# degrees in the arms. Gear is authored against the displayed body, and each piece
# is carried into bind space by ITS bone at export: v_bind = Rest_B @ Pose_B^-1 @ v.
def to_bind(bone):
    pb = ARM.pose.bones["mixamorig:" + bone]
    rest = ARM.matrix_world @ pb.bone.matrix_local
    pose = ARM.matrix_world @ pb.matrix
    return rest @ pose.inverted()


def bone_head(nm):
    pb = ARM.pose.bones["mixamorig:" + nm]
    return (ARM.matrix_world @ pb.matrix).translation.copy()


def extent(pred):
    pts = [v for v in BV if pred(v)]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi, pts


# head: skull above the ear line, inside the headset cups
H_LO, H_HI, _ = extent(lambda v: v.z > 1.70 and abs(v.x) < 0.125 and -0.16 < v.y < 0.15)
HC = (H_LO + H_HI) * 0.5
HR = (H_HI - H_LO) * 0.5
print("A11 head lo", tuple(round(x, 3) for x in H_LO), "hi", tuple(round(x, 3) for x in H_HI))
HEAD_TOP = H_HI.z


def radius_about(axis_pt, axis_dir, pred):
    """max distance of matching body verts from an axis line"""
    d = axis_dir.normalized()
    r = 0.0
    for v in BV:
        if not pred(v):
            continue
        w = v - axis_pt
        r = max(r, (w - d * w.dot(d)).length)
    return r


L_ARM = bone_head("LeftArm"); L_FORE = bone_head("LeftForeArm")
R_ARM = bone_head("RightArm"); R_FORE = bone_head("RightForeArm")
L_LEG = bone_head("LeftLeg"); R_LEG = bone_head("RightLeg")
R_UP = bone_head("RightUpLeg")
ARM_R = radius_about(L_ARM, L_FORE - L_ARM, lambda v: abs(v.x - 0.31) < 0.012 and v.z > 1.35)
THIGH_R = radius_about(R_UP, R_LEG - R_UP, lambda v: abs(v.z - 0.74) < 0.012 and v.x < -0.02)
print("A11 armR %.3f thighR %.3f" % (ARM_R, THIGH_R))

GEAR = []   # (object, look, bone)


# ---------------------------------------------------------------- mesh helpers
def mk(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def ellipsoid(c, r, seg=24, rings=14):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    for v in bm.verts:
        v.co = Vector((c.x + v.co.x * r.x, c.y + v.co.y * r.y, c.z + v.co.z * r.z))
    return bm


def box(c, s, rot=(0, 0, 0), bevel=0.008):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2]))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES")
    R = (Matrix.Rotation(rot[2], 4, "Z") @ Matrix.Rotation(rot[1], 4, "Y") @ Matrix.Rotation(rot[0], 4, "X"))
    for v in bm.verts:
        v.co = R @ v.co + Vector(c)
    return bm


def tube(p0, p1, r0, r1=None, seg=16, cap=True):
    r1 = r0 if r1 is None else r1
    bm = bmesh.new()
    d = (Vector(p1) - Vector(p0))
    L = d.length
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=L)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    M = Matrix.Translation((Vector(p0) + Vector(p1)) * 0.5) @ q.to_matrix().to_4x4()
    for v in bm.verts:
        v.co = M @ v.co
    return bm


def ring(center, axis, r_in, width, thick=0.008, seg=20):
    """a band (short open tube with thickness) around an axis"""
    a = Vector(axis).normalized()
    p0 = Vector(center) - a * width * 0.5
    p1 = Vector(center) + a * width * 0.5
    bm = tube(p0, p1, r_in + thick, seg=seg, cap=False)
    return bm


def cut(bm, pred):
    kill = [v for v in bm.verts if pred(v.co)]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    return bm


def thicken(o, t):
    m = o.modifiers.new("solid", "SOLIDIFY")
    m.thickness = t; m.offset = 1.0; m.use_even_offset = True
    apply_mods(o)


def shrink(o, offset, smooth=0):
    m = o.modifiers.new("sw", "SHRINKWRAP")
    m.target = BODY; m.wrap_method = "NEAREST_SURFACEPOINT"; m.offset = offset
    if smooth:
        s = o.modifiers.new("sm", "SMOOTH"); s.factor = 0.6; s.iterations = smooth
    apply_mods(o)


def apply_mods(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    o.modifiers.clear()
    old = o.data
    o.data = me
    bpy.data.meshes.remove(old)


def paint(o, col, ao=0.45):
    """per-point linear colour with a cheap baked occlusion: faces turned down
    darken (reads as volume under the night light). ACCENT stays pure."""
    me = o.data
    me.calc_loop_triangles()
    ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    for i, v in enumerate(me.vertices):
        k = 1.0
        if col != ACCENT:
            k = 1.0 - ao * max(0.0, -v.normal.z) * 0.6 - 0.12 * max(0.0, -v.normal.y if False else 0.0)
        ca.data[i].color = (col[0] * k, col[1] * k, col[2] * k, 1.0)
    for p in me.polygons:
        p.use_smooth = True
    return o


def part(look, bone, bm, col, ao=0.45, solid=0.0, wrap=None):
    o = mk("tmp", bm)
    if wrap is not None:
        shrink(o, wrap[0], wrap[1] if len(wrap) > 1 else 0)
    if solid:
        thicken(o, solid)
    paint(o, col, ao)
    GEAR.append((o, look, bone))
    return o


# ---------------------------------------------------------------- shared pieces
def armband(look):
    """team-colour armband on the LEFT upper arm — every look carries it, so the
    team read never depends on which look an operator drew"""
    c = L_ARM.lerp(L_FORE, 0.42)
    part(look, "LeftArm", ring(c, L_FORE - L_ARM, ARM_R + 0.004, 0.055, 0.007), ACCENT)


def helmet_shell(look, col, high_cut=True, lift=0.0, pad=0.024, accent_band=True, bump=False):
    r = Vector((HR.x + pad, HR.y + pad, HR.z + pad + 0.012))
    c = Vector((HC.x, HC.y, HC.z + 0.006 + lift))
    bm = ellipsoid(c, r, 28, 16)
    def below(p):
        fy = (p.y - c.y) / r.y          # -1 front .. +1 back
        zcut = c.z - 0.012 + (-fy) * 0.030 if fy < 0 else c.z - 0.012 - fy * 0.045
        if bump:
            zcut = c.z - 0.002 + (-fy) * 0.020 if fy < 0 else c.z - 0.010 - fy * 0.030
        if high_cut and abs(p.x - c.x) > 0.62 * r.x and -0.45 < fy < 0.55:
            zcut = max(zcut, c.z + 0.012)
        return p.z < zcut
    cut(bm, below)
    o = part(look, "Head", bm, col, 0.5, solid=0.010)
    if accent_band:
        # a narrow band round the back of the shell (visible from behind and the side)
        bm2 = ellipsoid(c, r + Vector((0.013, 0.013, 0.013)), 28, 48)
        cut(bm2, lambda p: not (c.z + 0.030 < p.z < c.z + 0.058) or p.y < c.y - 0.1 * r.y)
        part(look, "Head", bm2, ACCENT, 0.0, solid=0.004)
    return c, r


# ---------------------------------------------------------------- looks
# L0 LINE — high-cut helmet, NV mount + rails, rear counterweight pouch
def look0():
    c, r = helmet_shell(0, C["tan"])
    fz = c.z + 0.035
    part(0, "Head", box((0, c.y - r.y - 0.004, fz), (0.045, 0.018, 0.035), (0.35, 0, 0), 0.004), C["black"])   # shroud
    part(0, "Head", box((0, c.y - r.y - 0.026, fz - 0.012), (0.03, 0.03, 0.02), (0.2, 0, 0), 0.004), C["black"])  # mount arm
    for s in (-1, 1):   # side rails
        part(0, "Head", box((s * (r.x + 0.002), c.y - 0.01, c.z + 0.008), (0.012, 0.095, 0.02), (0, 0, 0), 0.003), C["black"])
    part(0, "Head", box((0, c.y + r.y + 0.004, c.z + 0.0), (0.075, 0.03, 0.05), (-0.35, 0, 0), 0.008), C["olive"])  # counterweight
    armband(0)


# L1 RECON — soft patrol cap with brim, assault pack, binocular chest pouch
def look1():
    c = Vector((HC.x, HC.y, HC.z + 0.004))
    r = Vector((HR.x + 0.012, HR.y + 0.012, HR.z + 0.030))
    bm = ellipsoid(c, r, 24, 14)
    cut(bm, lambda p: p.z < c.z - 0.004 + max(0.0, -(p.y - c.y) / r.y) * 0.018)
    # flatten the crown into a cap profile
    for v in bm.verts:
        if v.co.z > c.z + 0.07:
            v.co.z = c.z + 0.07 + (v.co.z - c.z - 0.07) * 0.35
    part(1, "Head", bm, C["coyote"], 0.4, solid=0.006)
    # brim: a curved half-disc out the front, tipped down
    bmb = bmesh.new()
    rr = r.x * 1.02
    verts = []
    N = 14
    for i in range(N + 1):
        a = math.pi * i / N
        x = math.cos(a) * rr
        y0 = -math.sin(a) * r.y * 0.98
        y1 = -math.sin(a) * (r.y + 0.07) - 0.0
        verts.append((bmb.verts.new((c.x + x, c.y + y0, c.z + 0.0)), bmb.verts.new((c.x + x * 1.04, c.y + y1, c.z - 0.012 - 0.006 * math.sin(a)))))
    for i in range(N):
        bmb.faces.new((verts[i][0], verts[i + 1][0], verts[i + 1][1], verts[i][1]))
    part(1, "Head", bmb, C["coyote"], 0.3, solid=0.006)
    part(1, "Head", ring(Vector((c.x, c.y, c.z + 0.012)), (0, 0, 1), r.x - 0.004, 0.016, 0.006), ACCENT)  # hat band
    # assault pack on the back plate
    part(1, "Spine2", box((0, 0.335, 1.27), (0.27, 0.12, 0.34), (0.05, 0, 0), 0.022), C["coyote"])
    part(1, "Spine2", box((0, 0.405, 1.22), (0.20, 0.035, 0.16), (0.05, 0, 0), 0.012), C["coyote"], 0.3)
    part(1, "Spine2", box((0, 0.33, 1.455), (0.25, 0.10, 0.04), (0.05, 0, 0), 0.01), C["strap"])
    part(1, "Spine2", box((0.07, -0.295, 1.255), (0.10, 0.07, 0.08), (0, 0, 0), 0.012), C["coyote"])  # binocular pouch
    armband(1)


# L2 BREACH — balaclava with eye slot, goggles, shoulder armour
def look2():
    c = Vector((HC.x, HC.y - 0.004, HC.z - 0.03))
    r = Vector((HR.x + 0.03, HR.y + 0.03, HR.z + 0.085))
    bm = ellipsoid(c, r, 32, 22)
    cut(bm, lambda p: p.z < 1.605)
    eye_z = 1.752   # measured off the front render of soldier.glb (pupils)
    o = mk("tmp", bm)
    shrink(o, 0.006, 2)
    # eye slot: drop the front faces in the eye band
    bm3 = bmesh.new(); bm3.from_mesh(o.data)
    kill = [f for f in bm3.faces if all((o.matrix_world @ v.co).y < HC.y - HR.y * 0.45 and abs(v.co.x) < 0.072
                                        and eye_z - 0.018 < v.co.z < eye_z + 0.024 for v in f.verts)]
    bmesh.ops.delete(bm3, geom=kill, context="FACES")
    bm3.to_mesh(o.data); bm3.free()
    paint(o, C["knit"], 0.3)
    GEAR.append((o, 2, "Head"))
    # goggles strap + lenses resting on the brow
    gz = eye_z + 0.048
    part(2, "Head", ring(Vector((HC.x, HC.y, gz)), (0, 0.0, 1), HR.x + 0.030, 0.022, 0.006), C["strap"])
    for s in (-1, 1):
        part(2, "Head", box((s * 0.036, HC.y - HR.y - 0.035, gz + 0.004), (0.058, 0.03, 0.04), (0.3, 0, -s * 0.18), 0.01), C["lens"], 0.2)
    # shoulder armour: curved plates over both upper arms
    for side, a0, a1, bone in ((1, L_ARM, L_FORE, "LeftArm"), (-1, R_ARM, R_FORE, "RightArm")):
        ax = (a1 - a0).normalized()
        cc = a0 + ax * 0.06
        bm4 = tube(cc - ax * 0.07, cc + ax * 0.06, ARM_R + 0.028, ARM_R + 0.020, seg=20, cap=False)
        cut(bm4, lambda p, cc=cc: p.z < cc.z - 0.012)
        part(2, bone, bm4, C["black"], 0.5, solid=0.008)
    # breaching tool pouch low on the back
    part(2, "Spine2", box((0.0, 0.31, 1.16), (0.24, 0.07, 0.09), (0, 0, 0), 0.012), C["black"])
    armband(2)


# L3 SIGNAL — bump helmet with ear protection, radio pack + antenna
def look3():
    c, r = helmet_shell(3, C["green"], high_cut=True, lift=0.004, pad=0.020, accent_band=False, bump=True)
    for s in (-1, 1):   # ear cups
        x = s * (HR.x + 0.050)
        part(3, "Head", tube((x - s * 0.012, HC.y + 0.01, HC.z - 0.045), (x + s * 0.03, HC.y + 0.01, HC.z - 0.045), 0.045, 0.040, 18), C["black"], 0.3)
        part(3, "Head", box((s * (HR.x + 0.05), HC.y + 0.01, HC.z + 0.02), (0.012, 0.03, 0.07), (0, 0, 0), 0.004), C["black"])
    part(3, "Head", box((0, HC.y + 0.012, c.z + r.z + 0.002), (0.05, 0.10, 0.012), (0, 0, 0), 0.004), ACCENT)  # crown stripe
    part(3, "Spine2", box((-0.05, 0.33, 1.29), (0.20, 0.12, 0.33), (0.04, 0, 0), 0.018), C["olive"])
    part(3, "Spine2", box((-0.05, 0.40, 1.26), (0.15, 0.03, 0.18), (0.04, 0, 0), 0.01), C["black"])
    part(3, "Spine2", tube((-0.12, 0.33, 1.45), (-0.16, 0.36, 1.86), 0.006, 0.003, 8), C["black"], 0.0)  # antenna
    part(3, "Spine2", tube((-0.157, 0.358, 1.83), (-0.161, 0.361, 1.87), 0.007, 0.007, 8), ACCENT)
    armband(3)


# L4 SCOUT — knit cap, thigh drop pouch, knee pads
def look4():
    c = Vector((HC.x, HC.y + 0.006, HC.z + 0.012))
    r = Vector((HR.x + 0.010, HR.y + 0.010, HR.z + 0.040))
    bm = ellipsoid(c, r, 24, 14)
    cut(bm, lambda p: p.z < c.z - 0.010 + max(0.0, -(p.y - c.y) / r.y) * 0.030)
    part(4, "Head", bm, C["knit"], 0.35, solid=0.008)
    part(4, "Head", ring(Vector((c.x, c.y, c.z + 0.002)), (0, 0.25, 1), r.x + 0.002, 0.030, 0.008, 24), C["knit"], 0.2)  # rolled cuff
    # drop-leg pouch on the right thigh (outer side) + strap
    tc = R_UP.lerp(R_LEG, 0.5)
    part(4, "RightUpLeg", box((tc.x - THIGH_R - 0.03, tc.y + 0.01, tc.z - 0.02), (0.05, 0.13, 0.17), (0, 0, 0), 0.015), C["grey"])
    part(4, "RightUpLeg", ring(tc + Vector((0, 0, 0.03)), R_LEG - R_UP, THIGH_R + 0.002, 0.03, 0.006), C["strap"])
    # knee pads
    for lp, bone in ((L_LEG, "LeftLeg"), (R_LEG, "RightLeg")):
        kc = Vector((lp.x, lp.y - 0.02, lp.z - 0.02))
        bm5 = ellipsoid(kc, Vector((0.07, 0.07, 0.085)), 16, 10)
        cut(bm5, lambda p, kc=kc: p.y > kc.y - 0.035)
        part(4, bone, bm5, C["black"], 0.4, solid=0.01)
    part(4, "LeftLeg", box((L_LEG.x + 0.0, L_LEG.y - 0.095, L_LEG.z - 0.02), (0.05, 0.012, 0.03), (0, 0, 0), 0.003), ACCENT)
    armband(4)


# L5 SHARP — wide-brim field hat, chest range-finder pouch, rolled mat on the back
def look5():
    c = Vector((HC.x, HC.y, HC.z + 0.006))
    r = Vector((HR.x + 0.016, HR.y + 0.016, HR.z + 0.026))
    bm = ellipsoid(c, r, 24, 14)
    cut(bm, lambda p: p.z < c.z - 0.002)
    for v in bm.verts:
        if v.co.z > c.z + 0.06:
            v.co.z = c.z + 0.06 + (v.co.z - c.z - 0.06) * 0.45
    part(5, "Head", bm, C["khaki"], 0.4, solid=0.006)
    # wide brim all round (annulus, drooping)
    bmb = bmesh.new()
    N = 28
    inner, outer = [], []
    for i in range(N):
        a = 2 * math.pi * i / N
        ca, sa = math.cos(a), math.sin(a)
        inner.append(bmb.verts.new((c.x + ca * r.x * 0.98, c.y + sa * r.y * 0.98, c.z + 0.0)))
        outer.append(bmb.verts.new((c.x + ca * (r.x + 0.065), c.y + sa * (r.y + 0.065), c.z - 0.022)))
    for i in range(N):
        j = (i + 1) % N
        bmb.faces.new((inner[i], inner[j], outer[j], outer[i]))
    part(5, "Head", bmb, C["khaki"], 0.3, solid=0.005)
    part(5, "Head", ring(Vector((c.x, c.y, c.z + 0.016)), (0, 0, 1), r.x - 0.003, 0.018, 0.006), ACCENT)
    part(5, "Spine2", box((-0.085, -0.292, 1.26), (0.09, 0.06, 0.12), (0, 0, 0), 0.012), C["olive"])
    # rolled mat across the top of the back
    part(5, "Spine2", tube((-0.17, 0.30, 1.47), (0.17, 0.30, 1.47), 0.055, seg=16), C["sand"], 0.4)
    for s in (-1, 1):
        part(5, "Spine2", ring(Vector((s * 0.11, 0.30, 1.47)), (1, 0, 0), 0.056, 0.02, 0.005), C["strap"])
    armband(5)


for fn in (look0, look1, look2, look3, look4, look5):
    fn()

# ---------------------------------------------------------------- join + export
by = {}
for o, look, bone in GEAR:
    by.setdefault((look, bone), []).append(o)
gear_objs = []
for (look, bone), objs in sorted(by.items()):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = "L%d__%s" % (look, bone)
    j.data.name = j.name
    gear_objs.append(j)

mat = bpy.data.materials.new("gear")
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Col"
nt.links.new(ca.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.8
stats = {}
for o in gear_objs:
    o.data.materials.clear(); o.data.materials.append(mat)
    o.data.calc_loop_triangles()
    stats[o.name] = len(o.data.loop_triangles)
print("A11TRIS", json.dumps(stats), "total", sum(stats.values()))

for o in bpy.data.objects:
    o.select_set(o in gear_objs)
for o in gear_objs:                       # into the runtime bind space (see to_bind)
    o.data.transform(to_bind(o.name.split("__")[1]))
bpy.ops.export_scene.gltf(
    filepath=OUT_GLB, export_format="GLB", use_selection=True, export_apply=True,
    export_animations=False, export_skins=False, export_morph=False,
    export_tangents=False, export_texcoords=False, export_normals=True,
    export_vertex_color="NAME", export_vertex_color_name="Col", export_all_vertex_colors=False)
for o in gear_objs:                       # back onto the displayed body for previews
    o.data.transform(to_bind(o.name.split("__")[1]).inverted())
gt = shutil.which("gltf-transform")
if gt:
    before = os.path.getsize(OUT_GLB)
    for attempt in range(3):
        rr = subprocess.run([gt, "draco", OUT_GLB, OUT_GLB, "--quantize-position", "14",
                             "--quantize-normal", "8", "--quantize-color", "8"],
                            capture_output=True, text=True, shell=(os.name == "nt"))
        if rr.returncode == 0:
            break
    print("A11DRACO %d -> %d%s" % (before, os.path.getsize(OUT_GLB), "" if rr.returncode == 0 else " FAILED " + rr.stderr[-300:]))

# ---------------------------------------------------------------- body mask bake
# Rasterise the body's UV triangles into a 256 mask. Region comes from the rest-pose
# GEOMETRY (where the triangle is on the man), skin needs the TEXTURE too (a skin
# tone inside the skin region: face/ears/forearms — not hair, gaiter, headset, gloves).
import numpy as np
N = 256
base_img = None
for m in BODY.data.materials:
    for n in m.node_tree.nodes:
        if n.type == "BSDF_PRINCIPLED" and n.inputs["Base Color"].links:
            fn = n.inputs["Base Color"].links[0].from_node
            if fn.type == "TEX_IMAGE":
                base_img = fn.image
tw, th = base_img.size
tex = np.array(base_img.pixels[:], dtype=np.float32).reshape(th, tw, 4)[:, :, :3]
if tw != N:
    f = tw // N
    tex = tex[: N * f, : N * f].reshape(N, f, N, f, 3).mean(axis=(1, 3))
# skin colour test (image pixels are sRGB-encoded floats here)
r_, g_, b_ = tex[:, :, 0], tex[:, :, 1], tex[:, :, 2]
skin_col = (r_ > g_ * 1.07) & (r_ > b_ * 1.22) & (r_ > 0.28) & ((r_ - b_) > 0.08)

region = np.zeros((N, N, 2), dtype=np.uint8)   # [skin-region, trouser-region]
me = BODY.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
me.calc_loop_triangles()
uvl = me.uv_layers.active.data
mw = BODY.matrix_world
for t in me.loop_triangles:
    ps = [mw @ me.vertices[i].co for i in t.vertices]
    uvs = [uvl[li].uv for li in t.loops]
    cz = sum(p.z for p in ps) / 3
    cx = max(abs(p.x) for p in ps)
    sk = 1 if (cz > 1.60 or cx > 0.53) else 0
    tr = 1 if (0.16 < cz < 0.975 and cx < 0.4) else 0
    if not (sk or tr):
        continue
    xs = [u.x * N for u in uvs]; ys = [u.y * N for u in uvs]
    x0, x1 = int(max(0, math.floor(min(xs)))), int(min(N - 1, math.ceil(max(xs))))
    y0, y1 = int(max(0, math.floor(min(ys)))), int(min(N - 1, math.ceil(max(ys))))
    (ax, ay), (bx, by_), (cx2, cy) = zip(xs, ys)
    den = (by_ - cy) * (ax - cx2) + (cx2 - bx) * (ay - cy)
    for py in range(y0, y1 + 1):
        for px in range(x0, x1 + 1):
            X, Y = px + 0.5, py + 0.5
            if abs(den) < 1e-9:
                inside = True
            else:
                l1 = ((by_ - cy) * (X - cx2) + (cx2 - bx) * (Y - cy)) / den
                l2 = ((cy - ay) * (X - cx2) + (ax - cx2) * (Y - cy)) / den
                inside = l1 >= -0.35 and l2 >= -0.35 and (1 - l1 - l2) >= -0.35   # conservative (1px pad)
            if inside:
                if sk: region[py, px, 0] = 1
                if tr: region[py, px, 1] = 1
mask = np.zeros((N, N, 4), dtype=np.float32)
mask[:, :, 0] = (region[:, :, 0] == 1) & skin_col
mask[:, :, 1] = region[:, :, 1]
mask[:, :, 3] = 1.0
# grow 2 px into the UV gutters so bilinear sampling at seams stays clean
for _ in range(2):
    for ch in (0, 1):
        m = mask[:, :, ch]
        g = m.copy()
        g[1:, :] = np.maximum(g[1:, :], m[:-1, :]); g[:-1, :] = np.maximum(g[:-1, :], m[1:, :])
        g[:, 1:] = np.maximum(g[:, 1:], m[:, :-1]); g[:, :-1] = np.maximum(g[:, :-1], m[:, 1:])
        # only grow where no geometry claims the texel
        claimed = region.any(axis=2)
        mask[:, :, ch] = np.where(claimed, m, g)
img = bpy.data.images.new("op_mask", N, N, alpha=False)
img.pixels[:] = mask.ravel().tolist()
img.filepath_raw = OUT_MASK
img.file_format = "PNG"
img.save()
print("A11MASK skin px %d trouser px %d bytes %d" % (int(mask[:, :, 0].sum()), int(mask[:, :, 1].sum()), os.path.getsize(OUT_MASK)))
print("A11BUILD glb %d bytes" % os.path.getsize(OUT_GLB))

# ---------------------------------------------------------------- preview
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = 420; sc.render.resolution_y = 760
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs[0].default_value = (0.45, 0.46, 0.5, 1)
    for m in bpy.data.materials:
        if m.node_tree and m is not mat:
            for n in m.node_tree.nodes:
                if n.type == "BSDF_PRINCIPLED":
                    n.inputs["Emission Strength"].default_value = 0
                    n.inputs["Metallic"].default_value = 0
    sun = bpy.data.lights.new("s", "SUN"); sun.energy = 3.5
    so = bpy.data.objects.new("s", sun); sc.collection.objects.link(so); so.rotation_euler = (0.8, 0.2, 0.5)
    cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; cam.ortho_scale = 2.0
    co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
    for look in range(6):
        for o in gear_objs:
            o.hide_render = not o.name.startswith("L%d__" % look)
        for vi, (dx, dy) in enumerate(((0.55, -1), (1, 0.35), (-0.3, 1))):
            co.location = (dx * 5, dy * 5, 1.0)
            co.rotation_euler = Vector((-dx, -dy, 0)).to_track_quat("-Z", "Y").to_euler()
            sc.render.filepath = os.path.join(PREVIEW, "look%d_%d.png" % (look, vi))
            bpy.ops.render.render(write_still=True)
