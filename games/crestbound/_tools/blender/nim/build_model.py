"""
NIM — headless Blender model build.

    blender --background --python build_model.py -- --out <kit dir> [--size 2048] [--ao 24] [--nobake]

Builds every part of Nim from hero.js's own numbers (see nim_lib.P / COL and the
per-part comments), joins the opaque parts into ONE mesh `nim_body` (materials:
nim_body + nim_scarf so the runtime can tint the scarf per realm), keeps the
goggle lenses as a separate BLEND-mode primitive, packs one UV atlas, bakes
albedo / tangent normal / ORM(+AO) at --size, builds the armature with hero.js's
exact bone names + positions (identity rest rotations, so bone-local == rig
space and the runtime pose writers drive it unchanged), skins rigidly per part
(scarf smooth along its 7-link chain), and saves `<out>/_work/nim_model.blend`
plus a static `nim.glb`. Clips are added by build_clips.py.
"""
import bpy, bmesh, sys, os, math, json, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import nim_lib as L
import nim_materials as NM
importlib.reload(L); importlib.reload(NM)
from nim_lib import (P, COL, TAU, Geo, lathe, limb, sphere, head_geo, surface_tube, hair_shell,
                     bevel_box, place, scarf_rest_points, scarf_geo, to_blender_object, to_b,
                     head_point, head_normal, head_elev_at_height, head_radius_at_height, head_dir_radius,
                     vnorm, vadd, vmul, vsub, vcross, EYE_YAW, EYE_R, EYE_PROUD, EYE_Y, PUPIL_R,
                     IRIS_INNER, IRIS_LIMBAL, GLINT_R, BROW_Y, GOG_Y, GOG_AZ, GOG_STRAP_Y0, GOG_STRAP_Y1,
                     MOUTH_Y, MOUTH_SWEEP, MOUTH_LIFT, CHEST_Y, NECK_Y, HEAD_Y, hex_lin, SCARF_LINKS)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else True
    return default


OUT = os.path.abspath(arg("--out", os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "models", "nim")))
WORK = os.path.join(OUT, "_work")
SIZE = int(arg("--size", 2048))
AO_SAMPLES = int(arg("--ao", 24))
BAKE = "--nobake" not in argv
os.makedirs(WORK, exist_ok=True)
T0 = time.time()


def log(*a):
    print("[nim %6.1fs]" % (time.time() - T0), *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ------------------------------------------------------------------ bones
# hero-local world positions of every bone at bind. Identity rest rotations.
S_R, S_L = 1, -1
BONES = [  # (name, parent, pos)
    ("rig", None, (0, 0, 0)),
    ("hips", "rig", (0, P["hipY"], 0)),
    ("spine", "hips", (0, P["hipY"] + P["spineY"], 0)),
    ("chest", "spine", (0, CHEST_Y, 0)),
    ("neck", "chest", (0, NECK_Y, 0)),
    ("head", "neck", (0, HEAD_Y, 0)),
]
for s, sfx in ((1, "R"), (-1, "L")):
    shx, shy = s * P["shoulderX"], CHEST_Y + P["shoulderY"]
    BONES += [
        ("shoulder" + sfx, "chest", (shx, shy, 0)),
        ("upperArm" + sfx, "shoulder" + sfx, (shx, shy, 0)),
        ("lowerArm" + sfx, "upperArm" + sfx, (shx, shy - P["upperArm"], 0)),
        ("hand" + sfx, "lowerArm" + sfx, (shx, shy - P["upperArm"] - P["lowerArm"], 0)),
    ]
for s, sfx in ((1, "R"), (-1, "L")):
    lx, ly = s * P["legX"], P["hipY"] - P["hipDrop"]
    BONES += [
        ("upperLeg" + sfx, "hips", (lx, ly, 0)),
        ("lowerLeg" + sfx, "upperLeg" + sfx, (lx, ly - P["upperLeg"], 0)),
        ("foot" + sfx, "lowerLeg" + sfx, (lx, ly - P["upperLeg"] - P["lowerLeg"], 0)),
    ]
BONE_POS = {b[0]: b[2] for b in BONES}

# ---------------------------------------------------------------- quality
Q = dict(coat=24, lathe=16, limb=14, limbRings=3, head=36, headRings=26, ear=8, hair=24, brow=9,
         browRing=6, lip=19, lipRing=7, gog=12, lens=12, eye=12, eyeRings=8, glint=8, iris=12, boot=8)

PARTS = []   # (geo, name, bone|weights, look, sharp_deg, uv_prio)


def part(geo, name, bone, look, sharp=58.0, prio=1.0):
    PARTS.append((geo, name, bone, look, sharp, prio))
    return geo


def at_bone(geo, bone):
    p = BONE_POS[bone]
    return geo.translate(p[0], p[1], p[2])


# ------------------------------------------------------------------- body
def build_body():
    cy = CHEST_Y
    seg = Q["coat"]
    coat = lathe([
        (0.000, 0.50 - cy), (0.150, 0.505 - cy), (0.214, 0.545 - cy), (0.198, 0.600 - cy),
        (0.186, 0.680 - cy), (P["torsoR"], 0.800 - cy), (0.196, 0.905 - cy), (0.168, 0.985 - cy),
        (0.120, 1.045 - cy), (0.086, 1.075 - cy), (0.000, 1.080 - cy)], seg)
    placket = place(bevel_box(0.055, 0.42, 0.045, 0.012, 1), 0, 0.760 - cy, -0.185, rx=0.10)
    part(at_bone(Geo().add(coat).add(placket), "chest"), "coat", "chest", "coat", prio=1.15)

    dark = Geo().add(lathe([(0.206, 0.524 - cy), (0.222, 0.534 - cy), (0.222, 0.560 - cy), (0.206, 0.570 - cy)], seg))
    for s in (1, -1):
        dark.add(place(bevel_box(0.145, 0.085, 0.185, 0.030, 1), s * 0.150, 0.985 - cy, 0, rz=-s * 0.30))
    part(at_bone(dark, "chest"), "coatDark", "chest", "coatDark")

    collar = lathe([(0.156, 0.998 - cy), (0.182, 1.010 - cy), (0.186, 1.030 - cy), (0.168, 1.048 - cy), (0.130, 1.058 - cy)], seg)
    part(at_bone(collar, "chest"), "collar", "chest", "trim")

    belt = place(lathe([(0.190, -0.010), (0.203, -0.004), (0.203, 0.030), (0.190, 0.036)], seg), 0, 0.006, 0)
    pouch = place(bevel_box(0.110, 0.095, 0.070, 0.020, 1), 0.170, -0.030, 0.060, ry=0.5)
    part(at_bone(Geo().add(belt).add(pouch), "hips"), "belt", "hips", "leather")
    buckle = place(bevel_box(0.085, 0.058, 0.030, 0.010, 1), 0, 0.013, -0.190)
    part(at_bone(buckle, "hips"), "buckle", "hips", "gold")


# ------------------------------------------------------------------- head
EYE_INFO = {}


def build_head():
    R = P["headR"]
    skull = head_geo(Q["head"], Q["headRings"])
    ear_pts = [(0.0000, 0.0072), (0.0105, 0.0040), (0.0195, 0.0068), (0.0276, 0.0165), (0.0330, 0.0262),
               (0.0366, 0.0220), (0.0356, 0.0072), (0.0286, -0.0092), (0.0143, -0.0152), (0.0000, -0.0170)]
    head = Geo().add(skull)
    for s in (1, -1):
        ex, ey, ez = s * 0.958, -0.185, 0.220
        el = math.hypot(ex, ey, ez)
        dx, dy, dz = ex / el, ey / el, ez / el
        er = head_dir_radius(dx, dy, dz) - 0.008
        g = lathe(ear_pts, Q["ear"]).scale(1.30, 1.0, 0.86)
        head.add(g.orient_to(dx * er, dy * er, dz * er, dx, dy, dz, 0))
    part(at_bone(head, "head"), "head", "head", "skin", sharp=80, prio=1.6)

    # hair: shell + blades + fringe + sideburns + brows (tufts go on their own bone)
    hair = Geo().add(hair_shell(Q["hair"], 6, 0.013))
    for i in range(5):
        a = (i - 2) * 0.34
        hair.add(place(bevel_box(0.034 - abs(i - 2) * 0.004, 0.150, 0.022, 0.009, 1),
                       math.sin(a) * 0.072, R * 0.88 + 0.014, -0.010 - math.cos(a) * 0.012, rx=-1.25, ry=a, rz=a * 0.5))
    for i in range(5):
        a = (i - 2) * 0.36
        hair.add(place(bevel_box(0.050, 0.062, 0.022, 0.009, 1),
                       math.sin(a) * 0.105, R * 0.885, -R * 0.50 + abs(a) * 0.026, rx=0.62, ry=a * 0.6, rz=a * 0.7))
    for s in (1, -1):
        hair.add(place(bevel_box(0.030, 0.075, 0.048, 0.012, 1), s * 0.205, R * 0.10, -0.030, rx=0.06, rz=-s * 0.16))
    for s in (1, -1):
        az = -math.pi * 0.5 + s * EYE_YAW
        hair.add(surface_tube(az - s * 0.175, az + s * 0.175,
                              lambda f: BROW_Y + 0.009 * (1 - f * f) - 0.004 * f,
                              lambda f: 0.0072 * max(1e-3, 1 - f * f) ** 0.32,
                              lambda f: 0.0055 * max(1e-3, 1 - f * f) ** 0.32,
                              0.0020, Q["brow"], Q["browRing"]))
    part(at_bone(hair, "head"), "hair", "head", "hair", sharp=48, prio=1.2)

    tufts = Geo()
    for i in range(3):
        a = 1.9 + i * 1.5
        tufts.add(place(bevel_box(0.044, 0.104, 0.026, 0.010, 1), math.cos(a) * 0.100, R * 0.88, math.sin(a) * 0.100,
                        rx=-0.80 + i * 0.20, ry=a, rz=0.28 - i * 0.16))
    part(at_bone(tufts, "head"), "hairTuft", "hairTuft", "hair", sharp=48)

    # goggle strap: follows the skull (leather, its own read)
    strap_pts = []
    for i in range(5):
        yy = GOG_STRAP_Y0 + (GOG_STRAP_Y1 - GOG_STRAP_Y0) * (i / 4)
        rr0 = head_radius_at_height(0, yy) + (0.016 if i in (0, 4) else 0.021)
        strap_pts.append((rr0, yy))
    # an OPEN arc: from the right cup's outer edge round the back of the skull to the
    # left cup's — never under the lenses (the 0.021 m band showed through the glass)
    a_r = -math.pi * 0.5 + (GOG_AZ + 0.36)
    a_l = -math.pi * 0.5 - (GOG_AZ + 0.36) + TAU
    part(at_bone(lathe(strap_pts, 18, arc=(a_r, a_l)), "head"), "strap", "head", "leather")

    # mouth: one swept lip
    lip = surface_tube(-math.pi * 0.5 - MOUTH_SWEEP, -math.pi * 0.5 + MOUTH_SWEEP,
                       lambda f: MOUTH_Y + f * f * MOUTH_LIFT,
                       lambda f: 0.0112 * max(1e-3, 1 - f * f) ** 0.30,
                       lambda f: 0.0066 * max(1e-3, 1 - f * f) ** 0.30,
                       0.0022, Q["lip"], Q["lipRing"])
    part(at_bone(lip, "head"), "mouth", "head", "lip", sharp=80, prio=1.3)

    # goggles pushed up on the brow: brass rims + rivets + bridge, dome lenses separate
    frames = Geo(); lenses = Geo()
    for s in (1, -1):
        az = -math.pi * 0.5 + s * GOG_AZ
        e = head_elev_at_height(az, GOG_Y)
        p = head_point(az, e); n = head_normal(az, e)
        rim = lathe([(0.0510, 0.000), (0.0600, -0.002), (0.0655, 0.006), (0.0645, 0.019),
                     (0.0575, 0.025), (0.0495, 0.019), (0.0470, 0.007)], Q["gog"], closed=True)
        frames.add(rim.orient_to(p[0] + n[0] * 0.008, p[1] + n[1] * 0.008, p[2] + n[2] * 0.008, n[0], n[1], n[2]))
        raz = -math.pi * 0.5 + s * (GOG_AZ + 0.150)
        re = head_elev_at_height(raz, GOG_Y - 0.004)
        rp = head_point(raz, re); rn = head_normal(raz, re)
        frames.add(limb(0.0090, 0.0100, 0.004, 8, 2).orient_to(rp[0] + rn[0] * 0.012, rp[1] + rn[1] * 0.012,
                                                                  rp[2] + rn[2] * 0.012, rn[0], rn[1], rn[2]))
        lens_pts = [(0.0525, 0.0)]
        for i in range(6, -1, -1):
            t = i / 6
            lens_pts.append((0.0525 * t, 0.0035 + 0.0165 * math.sqrt(max(0.0, 1 - t * t))))
        lenses.add(lathe(lens_pts, Q["lens"]).orient_to(p[0] + n[0] * 0.008, p[1] + n[1] * 0.008, p[2] + n[2] * 0.008,
                                                          n[0], n[1], n[2]))
    e = head_elev_at_height(-math.pi * 0.5, GOG_Y)
    p = head_point(-math.pi * 0.5, e); n = head_normal(-math.pi * 0.5, e)
    frames.add(bevel_box(0.062, 0.020, 0.026, 0.007, 1).orient_to(p[0] + n[0] * 0.010, p[1] + n[1] * 0.010,
                                                                    p[2] + n[2] * 0.010, n[0], n[1], n[2]))
    part(at_bone(frames, "head"), "goggleFrame", "head", "metal", sharp=50)
    EYE_INFO["lenses"] = at_bone(lenses, "head")

    # eyes: sunk against the real surface, catchlight bead, vertex-coloured iris cap
    rest_y = 0.0
    for s, sfx in ((1, "R"), (-1, "L")):
        az = -math.pi * 0.5 + s * EYE_YAW
        e = head_elev_at_height(az, EYE_Y)
        hp = head_point(az, e); n = head_normal(az, e)
        sink = EYE_R - EYE_PROUD
        c = vsub(hp, vmul(n, sink))
        rest_y += c[1] * 0.5
        u = vnorm([-n[1] * n[0], 1 - n[1] * n[1], -n[1] * n[2]])
        s2 = vcross(n, u)
        scl = Geo().add(sphere(EYE_R, Q["eye"], Q["eyeRings"]).translate(c[0], c[1] + 0.0005, c[2]))
        gd = vnorm(vadd(vadd(vmul(n, 0.970), vmul(u, 0.205)), vmul(s2, s * 0.125)))
        gr = EYE_R - 0.0055
        scl.add(sphere(GLINT_R, Q["glint"], 5).translate(c[0] + gd[0] * gr, c[1] + gd[1] * gr + 0.0005, c[2] + gd[2] * gr))
        part(at_bone(scl, "head"), "sclera" + sfx, "eye" + sfx, "eyeWhite", sharp=90, prio=1.4)
        ER = EYE_R + 0.0016
        rr = [PUPIL_R, 0.0192, IRIS_LIMBAL, 0.0160, 0.0135, 0.0110, IRIS_INNER, 0.0070, 0.0040, 0.0]
        iris_pts = [(PUPIL_R, math.sqrt(EYE_R * EYE_R - PUPIL_R * PUPIL_R) - 0.0018)]
        for r in rr:
            iris_pts.append((r, math.sqrt(max(1e-9, ER * ER - r * r))))
        iris = lathe(iris_pts, Q["iris"])
        cols = []
        rim = hex_lin(COL["irisRim"]); am = hex_lin(COL["iris"]); inn = hex_lin(COL["irisIn"]); pup = hex_lin(COL["eyePupil"])
        for v in iris.verts:
            r2 = math.hypot(v[0], v[2])
            if r2 >= IRIS_LIMBAL:
                col = rim
            elif r2 <= IRIS_INNER:
                col = pup
            else:
                t = (r2 - IRIS_INNER) / (IRIS_LIMBAL - IRIS_INNER)
                k = L.smoothstep(0.0, 0.55, t)
                col = tuple(inn[i] + (am[i] - inn[i]) * k for i in range(3))
                k2 = L.smoothstep(0.70, 1.0, t)
                col = tuple(col[i] + (rim[i] - col[i]) * k2 for i in range(3))
                k3 = 1 - L.smoothstep(0.0, 0.18, t)
                col = tuple(col[i] + (pup[i] - col[i]) * k3 for i in range(3))
            cols.append(col)
        iris.colors = cols
        iris.orient_to(c[0], c[1], c[2], n[0], n[1], n[2])
        part(at_bone(iris, "head"), "iris" + sfx, "pupil" + sfx, "iris", sharp=90, prio=1.4)
        EYE_INFO["eye" + sfx] = vadd(c, list(BONE_POS["head"]))
    EYE_INFO["eyes"] = (0, HEAD_Y + rest_y, 0)
    EYE_INFO["restY"] = rest_y


# ------------------------------------------------------------------- arms
def build_arms():
    seg = Q["limb"]; rr = Q["limbRings"]
    for s, sfx in ((1, "R"), (-1, "L")):
        sleeve = limb(0.086, 0.070, P["upperArm"], seg, rr)
        cap = place(limb(0.092, 0.092, 0.010, seg, 2), 0, 0.006, 0)
        part(at_bone(Geo().add(sleeve).add(cap), "upperArm" + sfx), "sleeveU" + sfx, "upperArm" + sfx, "coat")
        fore = limb(0.068, 0.058, P["lowerArm"], seg, rr)
        part(at_bone(fore, "lowerArm" + sfx), "sleeveL" + sfx, "lowerArm" + sfx, "coat")
        la = P["lowerArm"]
        cuff = lathe([(0.062, -la - 0.004), (0.078, -la + 0.006), (0.078, -la + 0.044), (0.062, -la + 0.052)], seg)
        part(at_bone(cuff, "lowerArm" + sfx), "cuff" + sfx, "lowerArm" + sfx, "trim")
        palm = place(limb(0.062, 0.052, P["handLen"] - 0.052, seg, rr), 0, -0.010, 0, sx=1.0, sy=1.0, sz=0.80)
        thumb = place(limb(0.026, 0.024, 0.042, 8, 2), -s * 0.052, -0.052, -0.014, rx=0.20, rz=-s * 1.05)
        part(at_bone(Geo().add(palm).add(thumb), "hand" + sfx), "mitten" + sfx, "hand" + sfx, "trim")


# ------------------------------------------------------------------- legs
def build_legs():
    seg = Q["limb"]; rr = Q["limbRings"]
    for s, sfx in ((1, "R"), (-1, "L")):
        part(at_bone(limb(0.098, 0.082, P["upperLeg"], seg, rr), "upperLeg" + sfx), "thigh" + sfx, "upperLeg" + sfx, "coat")
        knee = place(limb(0.084, 0.084, 0.012, seg, 2), 0, 0.006, -0.008)
        shin = limb(0.078, 0.064, P["lowerLeg"], seg, rr)
        part(at_bone(Geo().add(shin).add(knee), "lowerLeg" + sfx), "shin" + sfx, "lowerLeg" + sfx, "trim")
        bH, bW, bL = P["bootH"], P["bootW"], P["bootL"]
        boot = Geo()
        boot.add(place(bevel_box(bW, bH, bL * 0.74, 0.038, 2), 0, -bH * 0.5 + 0.016, -0.026))
        boot.add(place(bevel_box(0.150, 0.112, 0.110, 0.040, 2), 0, -0.078, -0.108))
        boot.add(place(bevel_box(0.116, 0.078, 0.062, 0.028, 2), 0, -0.086, -0.156, rx=-0.16))
        boot.add(place(lathe([(0.074, 0.006), (0.094, 0.018), (0.094, 0.052), (0.074, 0.062)], Q["boot"] + 2), 0, 0, -0.012))
        for i in range(2):
            boot.add(place(bevel_box(0.146, 0.011, 0.012, 0.004, 1), 0, -0.018 - i * 0.030, -0.134))
        boot.add(place(bevel_box(0.156, 0.030, 0.118, 0.013, 1), 0, -0.141, -0.126))
        boot.add(place(bevel_box(0.152, 0.034, 0.096, 0.013, 1), 0, -0.139, 0.036))
        for i in range(2):
            boot.add(place(bevel_box(0.140, 0.012, 0.028, 0.005, 1), 0, -bH + 0.006, -0.160 + i * 0.054))
        boot.add(place(bevel_box(0.128, 0.012, 0.030, 0.005, 1), 0, -bH + 0.006, 0.040))
        part(at_bone(boot, "foot" + sfx), "boot" + sfx, "foot" + sfx, "boot", sharp=62)


# ------------------------------------------------------------------- pack
def build_pack():
    cy = CHEST_Y
    body = place(bevel_box(0.230, 0.235, 0.130, 0.032, 2), 0, 0.855 - cy, 0.225)
    flap = place(bevel_box(0.238, 0.090, 0.140, 0.028, 2), 0, 0.955 - cy, 0.228, rx=-0.10)
    pa = place(bevel_box(0.060, 0.110, 0.090, 0.020, 1), 0.128, 0.840 - cy, 0.222)
    pb = place(bevel_box(0.060, 0.110, 0.090, 0.020, 1), -0.128, 0.840 - cy, 0.222)
    part(at_bone(Geo().add(body).add(flap).add(pa).add(pb), "chest"), "pack", "chest", "leather")
    roll = place(limb(0.056, 0.056, 0.230, 12, 3), -0.115, 0.995 - cy, 0.232, rz=math.pi * 0.5)
    part(at_bone(roll, "chest"), "blanket", "chest", "blanket")
    straps = Geo()
    for s in (1, -1):
        straps.add(place(bevel_box(0.046, 0.230, 0.022, 0.008, 1), s * 0.118, 0.860 - cy, -0.166, rx=0.06, rz=-s * 0.12))
        straps.add(place(bevel_box(0.040, 0.026, 0.290, 0.008, 1), s * 0.118, 0.975 - cy, 0.060, rx=0.18))
        straps.add(place(bevel_box(0.030, 0.150, 0.026, 0.006, 1), s * 0.072, 0.995 - cy, 0.234))
    part(at_bone(straps, "chest"), "packStraps", "chest", "rope")
    clasps = Geo()
    for s in (1, -1):
        clasps.add(place(bevel_box(0.044, 0.032, 0.020, 0.006, 1), s * 0.118, 0.795 - cy, -0.146))
    part(at_bone(clasps, "chest"), "packClasps", "chest", "gold")


# ------------------------------------------------------------------ scarf
SCARF_PTS = scarf_rest_points()


def build_scarf():
    # the wrap: a soft ring around the base of the head over the coat's shoulders, on the
    # neck bone, so the tail has something to hang FROM instead of appearing out of the hair
    ring = []
    for k in range(8):
        a = (k / 8) * TAU
        ring.append((0.207 + 0.027 * math.cos(a), 1.037 + 0.034 * math.sin(a)))
    wrap = lathe(ring, 20, closed=True).scale(1.0, 1.0, 1.06)
    # a little knot lump at the back-right where the tail leaves the wrap
    knot = sphere(0.040, 8, 5).scale(1.0, 0.8, 1.0).translate(0.10, 1.05, 0.17)
    part(Geo().add(wrap).add(knot), "scarfWrap", "neck", "scarf", sharp=70)
    g, rings = scarf_geo(SCARF_PTS)
    N = len(SCARF_PTS)
    weights = [None] * len(g.verts)
    for i, ids in enumerate(rings):
        if i == 0:
            w = [("scarf1", 1.0)]
        elif i == N - 1:
            w = [("scarf%d" % (N - 1), 1.0)]
        else:
            w = [("scarf%d" % i, 0.5), ("scarf%d" % (i + 1), 0.5)]
        for v in ids:
            weights[v] = w
    part(g, "scarf", weights, "scarf", sharp=70)


build_body(); build_head(); build_arms(); build_legs(); build_pack(); build_scarf()

# extra bones now that the eye centres are measured
BONES += [
    ("eyes", "head", EYE_INFO["eyes"]),
    ("eyeR", "eyes", EYE_INFO["eyeR"]), ("pupilR", "eyeR", EYE_INFO["eyeR"]),
    ("eyeL", "eyes", EYE_INFO["eyeL"]), ("pupilL", "eyeL", EYE_INFO["eyeL"]),
    ("hairTuft", "head", (0, HEAD_Y + P["headR"] * 0.88, 0)),
]
for i in range(1, SCARF_LINKS + 1):
    BONES.append(("scarf%d" % i, "neck" if i == 1 else "scarf%d" % (i - 1), tuple(SCARF_PTS[i - 1])))
BONE_POS = {b[0]: b[2] for b in BONES}

tri_report = {}
for geo, name, bone, look, sharp, prio in PARTS:
    tri_report[name] = geo.tri_count()
total_tris = sum(tri_report.values())
lens_tris = EYE_INFO["lenses"].tri_count()
log("part tris:", json.dumps(tri_report))
log("BODY TRIS", total_tris, "LENS TRIS", lens_tris, "TOTAL", total_tris + lens_tris)

# ---------------------------------------------------------------- objects
looks = NM.build_looks(eye_centres=[to_b(EYE_INFO["eyeR"]), to_b(EYE_INFO["eyeL"])])
lens_mat = NM.lens_material("nim_lens")
objs = []
for geo, name, bone, look, sharp, prio in PARTS:
    ob = to_blender_object(geo, "p_" + name, bone, looks[look], sharp_deg=sharp)
    me = ob.data
    a = me.attributes.new("uvprio", 'FLOAT', 'FACE'); a.data.foreach_set("value", [prio] * len(me.polygons))
    a = me.attributes.new("isscarf", 'INT', 'FACE'); a.data.foreach_set("value", [1 if look == "scarf" else 0] * len(me.polygons))
    objs.append(ob)
lens_ob = to_blender_object(EYE_INFO["lenses"], "nim_lens", "head", lens_mat, sharp_deg=80)

# join the opaque parts
bpy.ops.object.select_all(action='DESELECT')
for ob in objs:
    ob.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
body = bpy.context.active_object
body.name = "nim_body"; body.data.name = "nim_body"
log("joined: verts", len(body.data.vertices), "faces", len(body.data.polygons), "mats", len(body.data.materials))

# ------------------------------------------------------------------- UVs
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); bpy.context.view_layer.objects.active = body
scene.tool_settings.use_uv_select_sync = True
bpy.ops.object.mode_set(mode='EDIT')
bm = bmesh.from_edit_mesh(body.data)
mode_l = bm.faces.layers.int.get("uvmode")
for f in bm.faces:
    f.select = f[mode_l] == 1
bmesh.update_edit_mesh(body.data)
bpy.ops.uv.smart_project(angle_limit=math.radians(80.0), island_margin=0.0, area_weight=0.0,
                         correct_aspect=True, scale_to_bounds=False)
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
# texel priority: scale the face-critical islands up before packing
bm = bmesh.from_edit_mesh(body.data)
uvl = bm.loops.layers.uv.verify()
pri_l = bm.faces.layers.float.get("uvprio")
for f in bm.faces:
    pr = f[pri_l]
    if abs(pr - 1.0) > 1e-3:
        for l in f.loops:
            l[uvl].uv = l[uvl].uv * pr
bmesh.update_edit_mesh(body.data)
bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=0.0035, shape_method='CONCAVE', scale=True)
bpy.ops.object.mode_set(mode='OBJECT')
log("uv packed")

# ------------------------------------------------------------------- bake
IMG = {}


def new_image(name, srgb, alpha=False):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    img.generated_color = (0.5, 0.5, 1.0, 1.0) if name.endswith("normal") else (0.0, 0.0, 0.0, 1.0)
    IMG[name] = img
    return img


def save_image(img, path, fmt='PNG', quality=92):
    img.filepath_raw = path
    img.file_format = fmt
    if fmt == 'JPEG':
        scene.render.image_settings.quality = quality
    img.save()


def bake_pass(kind, image, samples=1):
    for m in body.data.materials:
        nt = m.node_tree
        nt.nodes["BAKE"].image = image
        nt.nodes.active = nt.nodes["BAKE"]
    scene.cycles.samples = samples
    t = time.time()
    bpy.ops.object.bake(type=kind)
    log("baked", kind, "->", image.name, "in %.1fs" % (time.time() - t))


if BAKE:
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.use_denoising = False
    scene.render.bake.margin = 8
    scene.render.bake.margin_type = 'EXTEND'
    scene.render.bake.use_clear = True
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.normal_space = 'TANGENT'
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    world = bpy.data.worlds.new("bakeworld"); scene.world = world
    world.light_settings.distance = 0.22
    world.light_settings.ao_factor = 1.0
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True); bpy.context.view_layer.objects.active = body
    lens_ob.hide_render = True
    albedo = new_image("nim_albedo", True)
    normal = new_image("nim_normal", False)
    orm = new_image("nim_orm", False)
    ao = new_image("nim_ao", False)
    for m in body.data.materials:
        NM.attach_bake_target(m, albedo)
    for m in body.data.materials:
        NM.set_bake_mode(m, 'albedo')
    bake_pass('EMIT', albedo)
    for m in body.data.materials:
        NM.set_bake_mode(m, 'orm')
    bake_pass('EMIT', orm)
    for m in body.data.materials:
        NM.set_bake_mode(m, 'pbr')
    bake_pass('NORMAL', normal)
    bake_pass('AO', ao, samples=AO_SAMPLES)
    # AO -> ORM.R
    import numpy as np
    o = np.empty(SIZE * SIZE * 4, dtype=np.float32); orm.pixels.foreach_get(o)
    a = np.empty(SIZE * SIZE * 4, dtype=np.float32); ao.pixels.foreach_get(a)
    aoc = a[0::4]
    aoc = np.clip(0.35 + 0.65 * aoc, 0.0, 1.0)     # never fully black in a crease
    o[0::4] = aoc
    o[3::4] = 1.0
    orm.pixels.foreach_set(o)
    save_image(albedo, os.path.join(OUT, "nim_albedo.png"))
    save_image(normal, os.path.join(OUT, "nim_normal.png"))
    save_image(orm, os.path.join(OUT, "nim_orm.png"))
    save_image(ao, os.path.join(WORK, "nim_ao.png"))
    for name in ("nim_albedo", "nim_normal", "nim_orm"):
        IMG[name].filepath = os.path.join(OUT, name + ".png")
        IMG[name].source = 'FILE'
        IMG[name].reload()
    lens_ob.hide_render = False
    # replace the look materials with the two shipped atlas materials
    body_mat = NM.make_atlas_material("nim_body", albedo, normal, orm)
    scarf_mat = NM.make_atlas_material("nim_scarf", albedo, normal, orm)
    scarf_flags = [0] * len(body.data.polygons)
    body.data.attributes["isscarf"].data.foreach_get("value", scarf_flags)
    body.data.materials.clear()
    body.data.materials.append(body_mat); body.data.materials.append(scarf_mat)
    body.data.polygons.foreach_set("material_index", scarf_flags)
    for m in list(bpy.data.materials):
        if m.name.startswith("nim_") and m.users == 0:
            bpy.data.materials.remove(m)
    log("atlas materials assigned")

# --------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new("nim_rig")
arm = bpy.data.objects.new("nim", arm_data)
scene.collection.objects.link(arm)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = {}
for name, parent, pos in BONES:
    b = arm_data.edit_bones.new(name)
    h = to_b(pos)
    b.head = h
    b.tail = (h[0], h[1], h[2] + 0.06)
    b.roll = 0.0
    b.use_connect = False
    b.use_deform = True
    if parent:
        b.parent = eb[parent]
    eb[name] = b
bpy.ops.object.mode_set(mode='OBJECT')
for ob in (body, lens_ob):
    ob.parent = arm
    mod = ob.modifiers.new("Armature", 'ARMATURE'); mod.object = arm
# every deform group must exist on the body (a bone with no verts is fine for glTF)
for name, _, _ in BONES:
    if name not in body.vertex_groups:
        body.vertex_groups.new(name=name)
log("armature:", len(BONES), "bones")

# -------------------------------------------------------------- metadata
meta = dict(
    tris_body=total_tris, tris_lens=lens_tris, tris=total_tris + lens_tris,
    part_tris=tri_report,
    bones=[b[0] for b in BONES], bone_parent={b[0]: b[1] for b in BONES},
    bone_pos={b[0]: [round(c, 5) for c in b[2]] for b in BONES},
    eyes=dict(restY=round(EYE_INFO["restY"], 5), eyeR=[round(c, 5) for c in EYE_INFO["eyeR"]],
              eyeL=[round(c, 5) for c in EYE_INFO["eyeL"]]),
    scarf_rest=[[round(c, 5) for c in p] for p in SCARF_PTS],
    atlas=SIZE, baked=BAKE,
)
with open(os.path.join(WORK, "model_meta.json"), "w") as f:
    json.dump(meta, f, indent=1)

blend = os.path.join(WORK, "nim_model.blend")
bpy.ops.wm.save_as_mainfile(filepath=blend)
log("saved", blend)

glb = os.path.join(OUT, "nim.glb")
bpy.ops.export_scene.gltf(
    filepath=glb, export_format='GLB', export_yup=True, export_apply=False,
    export_animations=False, export_skins=True, export_def_bones=False,
    export_rest_position_armature=True, export_image_format='AUTO',
    export_draco_mesh_compression_enable=False, export_materials='EXPORT',
    export_vertex_color='NONE', export_texcoords=True, export_normals=True,
    use_selection=False)
log("exported static", glb, "%.2f MB" % (os.path.getsize(glb) / 1e6))
