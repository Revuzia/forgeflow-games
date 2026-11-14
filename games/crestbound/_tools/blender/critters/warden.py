"""WARDEN — armoured brute with a crest lantern (3-hit mini-boss). Runtime natural height 2.70 m.
Clips: idle, stomp_telegraph, stomp, charge_telegraph, charge, dizzy, hit, roar, death.
Bones: root, hips, spine, chest, neck, head, lantern, shoulder/upperarm/forearm/hand L+R, thigh/shin/foot L+R (20)."""
# CLIP NAMES: runtime/entities/critters.js `_playClip(state)` does NOT look a clip up by name --
# it walks CLIP_MAP[state]'s fragment list and takes the first clip whose lower-cased name CONTAINS
# the fragment (falling back to clips[0]). Every clip below therefore carries BOTH its semantic name
# and the fragment that makes the runtime resolve it. Proven by _tools/blender/critters/glbcheck.mjs
# (`runtime_state_resolution`), which loads the shipped GLB through the game's own GLTFLoader.
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cblib import *
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]
b = Builder("warden", out, atlas=2048, height=2.7)

steel = b.mat("steel", mat_metal, base=(0.24, 0.27, 0.33), rough=0.48, worn=(0.7, 0.72, 0.75), rust=(0.42, 0.18, 0.06), scale=4.0, bump=0.35)
dark = b.mat("dark", mat_metal, base=(0.12, 0.12, 0.14), rough=0.6, worn=(0.45, 0.45, 0.45), scale=5.0, bump=0.3)
brass = b.mat("brass", mat_metal, base=(0.66, 0.47, 0.17), rough=0.38, worn=(0.95, 0.85, 0.55), grime=(0.12, 0.08, 0.03), scale=6.0, bump=0.25)
leather = b.mat("leather", mat_paint, base=(0.33, 0.18, 0.08), rough=0.72, chip=(0.5, 0.33, 0.2), scale=4.0, bump=0.35)
glow = b.mat("glow", mat_glow, color=(1.0, 0.52, 0.12), strength=5.0)
gem = b.mat("gem", mat_glow, color=(0.35, 0.9, 1.0), strength=4.0, base=(0.1, 0.4, 0.5))

# ---- legs -----------------------------------------------------------------------------------------
for side, sx in (("L", -1), ("R", 1)):
    x = sx * 0.34
    b.rbox("boot_" + side, (0.42, 0.56, 0.26), (x, -0.06, 0.13), "foot_" + side, dark, bevel=0.06, segs=2)
    b.rbox("toe_" + side, (0.40, 0.22, 0.20), (x, -0.32, 0.11), "foot_" + side, steel, bevel=0.05, segs=2)
    b.torus("ankle_" + side, 0.22, 0.04, (x, 0.0, 0.28), "shin_" + side, brass, seg_major=14, seg_minor=5, scale=(1, 1.1, 1))
    b.capsule("shin_" + side, 0.20, 0.26, (x, 0.0, 0.50), "shin_" + side, leather, seg=12, rings=2)
    b.rbox("greave_" + side, (0.30, 0.16, 0.34), (x, -0.20, 0.52), "shin_" + side, steel, bevel=0.04, segs=2)
    b.sphere("knee_" + side, 0.19, (x, -0.03, 0.72), "thigh_" + side, steel, seg=14, rings=9)
    b.capsule("thigh_" + side, 0.22, 0.24, (x, 0.0, 0.90), "thigh_" + side, leather, seg=12, rings=2)
# ---- hips + belt -------------------------------------------------------------------------------------
b.rbox("hips", (0.92, 0.62, 0.42), (0, 0, 1.12), "hips", steel, bevel=0.10, segs=3)
b.torus("belt", 0.47, 0.05, (0, 0, 1.27), "hips", leather, seg_major=24, seg_minor=6, scale=(1, 0.72, 1))
b.rbox("buckle", (0.16, 0.06, 0.13), (0, -0.37, 1.27), "hips", brass, bevel=0.015, segs=2)
# ---- torso -----------------------------------------------------------------------------------------
b.rbox("torso", (1.22, 0.84, 0.80), (0, 0, 1.72), "chest", steel, bevel=0.16, segs=3)
b.rbox("chestplate", (1.0, 0.16, 0.56), (0, -0.44, 1.78), "chest", steel, bevel=0.06, segs=2)
b.torus("chest_trim", 0.28, 0.03, (0, -0.53, 1.78), "chest", brass, seg_major=18, seg_minor=5, rot=(90, 0, 0), scale=(1.6, 1, 1))
for i, (rx, rz) in enumerate(((-0.42, 1.98), (0.42, 1.98), (-0.42, 1.58), (0.42, 1.58))):
    b.sphere("rivet%d" % i, 0.035, (rx, -0.525, rz), "chest", brass, seg=8, rings=5)
b.rbox("backplate", (0.9, 0.14, 0.58), (0, 0.44, 1.76), "chest", steel, bevel=0.05, segs=2)
b.torus("socket", 0.17, 0.045, (0, 0.50, 1.78), "chest", brass, seg_major=16, seg_minor=5, rot=(90, 0, 0))
b.sphere("crestgem", 0.13, (0, 0.50, 1.78), "chest", gem, seg=12, rings=8)
# ---- shoulders + arms --------------------------------------------------------------------------------
for side, sx in (("L", -1), ("R", 1)):
    x = sx * 0.78
    b.sphere("pauldron_" + side, 0.42, (x, 0, 2.06), "shoulder_" + side, steel, seg=18, rings=10, scale=(1, 0.9, 0.72))
    b.torus("pauldron_rim_" + side, 0.40, 0.035, (x, 0, 1.94), "shoulder_" + side, brass, seg_major=18, seg_minor=5, scale=(1, 0.9, 1))
    for k, (dx, dy) in enumerate(((0.55, 0.0), (0.25, -0.75), (0.25, 0.75))):
        d = Vector((sx * dx, dy, 0.8)).normalized()
        rot = [math.degrees(a) for a in d.to_track_quat('Z', 'Y').to_euler()]
        b.cone("spike_%s%d" % (side, k), 0.07, 0.24, Vector((x, 0, 2.06)) + Vector((d.x * 0.40, d.y * 0.36, d.z * 0.28)), "shoulder_" + side, brass, seg=8, rot=rot, bevel=0)
    ax = sx * 0.92
    b.capsule("upperarm_" + side, 0.20, 0.36, (ax, 0, 1.68), "upperarm_" + side, leather, seg=12, rings=2)
    b.torus("cuff_" + side, 0.27, 0.05, (ax + sx * 0.03, -0.02, 1.40), "forearm_" + side, brass, seg_major=16, seg_minor=5)
    b.capsule("forearm_" + side, 0.25, 0.30, (ax + sx * 0.03, -0.02, 1.16), "forearm_" + side, steel, seg=14, rings=2)
    b.rbox("fist_" + side, (0.44, 0.40, 0.42), (ax + sx * 0.04, -0.02, 0.80), "hand_" + side, dark, bevel=0.10, segs=3)
    for k in range(3):
        b.sphere("knuckle_%s%d" % (side, k), 0.06, (ax + sx * 0.04 - 0.14 + k * 0.14, -0.22, 0.86), "hand_" + side, brass, seg=8, rings=5)
# ---- neck + helmet + lantern ------------------------------------------------------------------------------
b.cyl("neck", 0.17, 0.15, 0.22, (0, -0.05, 2.12), "neck", dark, seg=12, bevel=0.02)
b.sphere("helmet", 0.28, (0, -0.08, 2.36), "head", steel, seg=20, rings=13, scale=(1, 1, 0.95))
b.rbox("visor", (0.50, 0.24, 0.14), (0, -0.28, 2.34), "head", dark, bevel=0.04, segs=2)
b.rbox("jawguard", (0.46, 0.22, 0.13), (0, -0.20, 2.19), "head", steel, bevel=0.04, segs=2)
for sx in (-1, 1):
    b.rbox("eyeslit_%d" % sx, (0.12, 0.05, 0.045), (sx * 0.12, -0.405, 2.35), "head", glow, bevel=0.01, segs=1)
b.rbox("crestridge", (0.06, 0.42, 0.14), (0, -0.06, 2.60), "head", brass, bevel=0.02, segs=2)
b.cyl("lantern_base", 0.13, 0.11, 0.05, (0, -0.06, 2.665), "lantern", brass, seg=12, bevel=0.01)
b.cyl("lantern_glass", 0.085, 0.085, 0.20, (0, -0.06, 2.79), "lantern", glow, seg=12)
for k in range(4):
    a = math.radians(45 + 90 * k)
    b.cyl("bar%d" % k, 0.016, 0.016, 0.22, (math.cos(a) * 0.105, -0.06 + math.sin(a) * 0.105, 2.79), "lantern", brass, seg=6)
b.cone("lantern_cap", 0.135, 0.09, (0, -0.06, 2.93), "lantern", brass, seg=12, bevel=0)
b.torus("lantern_ring", 0.04, 0.012, (0, -0.06, 2.99), "lantern", brass, seg_major=12, seg_minor=5, rot=(0, 90, 0))

b.face_at = Vector((0, -0.35, 2.45))
b.face_r = 0.55

b.build_mesh()
b.bake(ao_samples=24)

def arm(side, sx):
    ax = sx * 0.92
    return [
        ("shoulder_" + side, (sx * 0.45, 0, 2.05), (sx * 0.85, 0, 2.05), "chest"),
        ("upperarm_" + side, (ax, 0, 1.95), (ax, 0, 1.45), "shoulder_" + side),
        ("forearm_" + side, (ax + sx * 0.03, -0.02, 1.42), (ax + sx * 0.03, -0.02, 0.98), "upperarm_" + side),
        ("hand_" + side, (ax + sx * 0.04, -0.02, 0.98), (ax + sx * 0.04, -0.02, 0.60), "forearm_" + side),
    ]
def leg(side, sx):
    x = sx * 0.34
    return [
        ("thigh_" + side, (x, 0, 1.08), (x, 0, 0.72), "hips"),
        ("shin_" + side, (x, 0, 0.72), (x, 0, 0.30), "thigh_" + side),
        ("foot_" + side, (x, 0, 0.28), (x, -0.35, 0.10), "shin_" + side),
    ]
b.rig([
    ("root", (0, 0, 0), (0, 0, 0.2), None),
    ("hips", (0, 0, 1.05), (0, 0, 1.30), "root"),
    ("spine", (0, 0, 1.30), (0, 0, 1.55), "hips"),
    ("chest", (0, 0, 1.55), (0, 0, 2.05), "spine"),
    ("neck", (0, -0.05, 2.05), (0, -0.05, 2.20), "chest"),
    ("head", (0, -0.05, 2.20), (0, -0.05, 2.60), "neck"),
    ("lantern", (0, -0.06, 2.64), (0, -0.06, 3.0), "head"),
] + arm("L", -1) + arm("R", 1) + leg("L", -1) + leg("R", 1))

L, R = "L", "R"
def both(c, f, bone, rot=None, loc=None, scale=None, mirror_z=True):
    """Key a symmetric pair; Z (yaw) and Y (roll) components mirror for the right side."""
    c.key(f, bone + "_L", rot=rot, loc=loc, scale=scale)
    if rot is not None:
        rot = (rot[0], -rot[1], -rot[2]) if mirror_z else rot
    if loc is not None:
        loc = (-loc[0], loc[1], loc[2])
    c.key(f, bone + "_R", rot=rot, loc=loc, scale=scale)

# ---- idle: breathe, sway, lantern sway, fists clench ---------------------------------------------------------
with b.clip("idle", 48) as c:
    for f, br in ((0, 0), (24, 2.5), (48, 0)):
        c.key(f, "chest", rot=(br, 0, 0)); c.key(f, "spine", rot=(br * 0.5, 0, 0))
        c.key(f, "hips", loc=(0, 0, -0.008 * (br / 2.5)))
    for f, yaw in ((0, 0), (16, 5), (32, -4), (48, 0)):
        c.key(f, "head", rot=(0, 0, yaw))
    for f, s in ((0, 1.0), (24, 1.06), (48, 1.0)):
        both(c, f, "hand", scale=(s, s, s))
    for f, o in ((0, 0), (24, 3), (48, 0)):
        both(c, f, "upperarm", rot=(0, 0, o))
    for f, lx, ly in ((0, 0, 0), (12, 4, 2), (24, 0, -3), (36, -4, 1), (48, 0, 0)):
        c.key(f, "lantern", rot=(lx, ly, 0))

# ---- stomp telegraph: knee up, arms up, lean back ----------------------------------------------------------------
def rest_all(c, f):
    for bn in b.arm.data.bones:
        if bn.name != "root":
            c.key(f, bn.name, rot=(0, 0, 0), loc=(0, 0, 0))
TELE = dict(thigh=(-78, 0, 0), shin=(70, 0, 0), foot=(-15, 0, 0))
with b.clip("stomp_telegraph", 14) as c:
    rest_all(c, 0)
    c.key(14, "thigh_L", rot=TELE["thigh"]); c.key(14, "shin_L", rot=TELE["shin"]); c.key(14, "foot_L", rot=TELE["foot"])
    c.key(14, "thigh_R", rot=(6, 0, 0)); c.key(14, "shin_R", rot=(-4, 0, 0))
    c.key(14, "hips", loc=(0, 0.04, 0.04), rot=(-8, 0, 0)); c.key(14, "chest", rot=(-10, 0, 0)); c.key(14, "spine", rot=(-4, 0, 0))
    both(c, 14, "upperarm", rot=(-95, 0, 22)); both(c, 14, "forearm", rot=(-45, 0, 0))
    c.key(14, "head", rot=(-12, 0, 0)); c.key(14, "lantern", rot=(-10, 0, 0))
    c.key(6, "hips", loc=(0, 0.02, 0.02), rot=(-4, 0, 0))

# ---- stomp: slam ----------------------------------------------------------------------------------------------------
with b.clip("stomp_attack_slam", 13) as c:
    c.key(0, "thigh_L", rot=TELE["thigh"]); c.key(0, "shin_L", rot=TELE["shin"]); c.key(0, "foot_L", rot=TELE["foot"])
    c.key(0, "thigh_R", rot=(6, 0, 0)); c.key(0, "shin_R", rot=(-4, 0, 0))
    c.key(0, "hips", loc=(0, 0.04, 0.04), rot=(-8, 0, 0)); c.key(0, "chest", rot=(-10, 0, 0)); c.key(0, "spine", rot=(-4, 0, 0))
    both(c, 0, "upperarm", rot=(-95, 0, 22)); both(c, 0, "forearm", rot=(-45, 0, 0))
    c.key(0, "head", rot=(-12, 0, 0)); c.key(0, "lantern", rot=(-10, 0, 0))
    # impact at f4
    c.key(4, "thigh_L", rot=(0, 0, 0)); c.key(4, "shin_L", rot=(0, 0, 0)); c.key(4, "foot_L", rot=(0, 0, 0))
    c.key(4, "thigh_R", rot=(0, 0, 0)); c.key(4, "shin_R", rot=(0, 0, 0))
    c.key(4, "hips", loc=(0, 0, -0.14), rot=(14, 0, 0)); c.key(4, "chest", rot=(20, 0, 0)); c.key(4, "spine", rot=(8, 0, 0))
    both(c, 4, "upperarm", rot=(22, 0, 10)); both(c, 4, "forearm", rot=(-15, 0, 0))
    c.key(4, "head", rot=(14, 0, 0)); c.key(4, "lantern", rot=(22, 0, 0))
    c.key(7, "hips", loc=(0, 0, -0.16), rot=(14, 0, 0)); c.key(7, "lantern", rot=(-8, 0, 0))
    c.key(13, "hips", loc=(0, 0, -0.06), rot=(6, 0, 0)); c.key(13, "chest", rot=(8, 0, 0)); c.key(13, "spine", rot=(3, 0, 0))
    both(c, 13, "upperarm", rot=(8, 0, 6)); both(c, 13, "forearm", rot=(-10, 0, 0))
    c.key(13, "head", rot=(4, 0, 0)); c.key(13, "lantern", rot=(4, 0, 0))

# ---- charge telegraph: crouch, lean, arms back, foot scrape, head shake ----------------------------------------
with b.clip("charge_telegraph", 19) as c:
    rest_all(c, 0)
    for f in (6, 19):
        c.key(f, "hips", loc=(0, 0, -0.20), rot=(22, 0, 0)); c.key(f, "chest", rot=(14, 0, 0)); c.key(f, "spine", rot=(6, 0, 0))
        c.key(f, "head", rot=(-14, 0, 0)); c.key(f, "lantern", rot=(-16, 0, 0))
        both(c, f, "upperarm", rot=(48, 0, 12)); both(c, f, "forearm", rot=(-35, 0, 0))
        c.key(f, "thigh_R", rot=(-30, 0, 0)); c.key(f, "shin_R", rot=(40, 0, 0)); c.key(f, "thigh_L", rot=(18, 0, 0)); c.key(f, "shin_L", rot=(10, 0, 0))
    for f, s in ((6, 0), (9, 28), (12, 0), (15, 28), (19, 0)):
        c.key(f, "foot_R", rot=(s, 0, 0))
    for f, y in ((6, 0), (9, 10), (12, -10), (15, 8), (19, 0)):
        c.key(f, "head", rot=(-14, 0, y))

# ---- charge: heavy run leaning forward (loop) -------------------------------------------------------------------------
with b.clip("charge_run", 12) as c:
    for f, a in ((0, -42), (6, 34), (12, -42)):
        c.key(f, "thigh_L", rot=(a, 0, 0)); c.key(f, "thigh_R", rot=(-a, 0, 0))
        c.key(f, "upperarm_L", rot=(-a * 0.9, 0, 8)); c.key(f, "upperarm_R", rot=(a * 0.9, 0, -8))
    for f, sL, sR in ((0, 12, 60), (3, 40, 30), (6, 60, 12), (9, 30, 40), (12, 12, 60)):
        c.key(f, "shin_L", rot=(sL, 0, 0)); c.key(f, "shin_R", rot=(sR, 0, 0))
    for f, z in ((0, -0.02), (3, -0.08), (6, -0.02), (9, -0.08), (12, -0.02)):
        c.key(f, "hips", loc=(0, 0, z), rot=(26, 0, 0))
    for f in (0, 12):
        c.key(f, "chest", rot=(12, 0, 0)); c.key(f, "spine", rot=(5, 0, 0)); c.key(f, "head", rot=(-18, 0, 0))
        both(c, f, "forearm", rot=(-65, 0, 0)); both(c, f, "foot", rot=(0, 0, 0))
    for f, lx in ((0, 6), (6, -6), (12, 6)):
        c.key(f, "lantern", rot=(lx, 0, 0))

# ---- dizzy: wobble loop (2.5 s) -------------------------------------------------------------------------------------
with b.clip("dizzy", 60) as c:
    for f, rx, ry, rz in ((0, 0, 0, 0), (15, 9, 6, 12), (30, 0, -9, 0), (45, -8, 4, -12), (60, 0, 0, 0)):
        c.key(f, "hips", rot=(rx, ry, rz), loc=(0, 0, -0.06 + 0.03 * math.sin(f / 60 * 2 * math.pi)))
        c.key(f, "chest", rot=(rx * 0.8, ry * 0.8, rz * 0.6))
    for f, hx, hy, hz in ((0, 0, 0, 0), (10, 12, 22, 0), (20, 0, 0, 26), (30, -12, -22, 0), (40, 0, 0, -26), (50, 12, 22, 0), (60, 0, 0, 0)):
        c.key(f, "head", rot=(hx, hy, hz)); c.key(f, "lantern", rot=(hx * 1.6, hy * 1.4, 0))
    for f, o in ((0, 0), (15, 14), (30, 0), (45, -14), (60, 0)):
        c.key(f, "upperarm_L", rot=(6, 0, 14 + o)); c.key(f, "upperarm_R", rot=(6, 0, -14 + o))
        both(c, f, "forearm", rot=(-22, 0, 0))
    for f, k in ((0, 0), (15, 8), (30, 0), (45, 8), (60, 0)):
        both(c, f, "thigh", rot=(-k, 0, 0)); both(c, f, "shin", rot=(2 * k, 0, 0))

# ---- hit: recoil back --------------------------------------------------------------------------------------------------
with b.clip("hit", 22) as c:
    rest_all(c, 0)
    c.key(3, "hips", loc=(0, 0.16, 0.02), rot=(-16, 0, 0)); c.key(3, "chest", rot=(-22, 0, 0)); c.key(3, "spine", rot=(-8, 0, 0))
    c.key(3, "head", rot=(-28, 0, 0)); c.key(3, "lantern", rot=(-30, 0, 0))
    both(c, 3, "upperarm", rot=(-70, 0, 30)); both(c, 3, "forearm", rot=(-30, 0, 0))
    both(c, 3, "thigh", rot=(-12, 0, 0)); both(c, 3, "shin", rot=(20, 0, 0))
    c.key(10, "hips", loc=(0, 0.12, -0.02), rot=(-10, 0, 0)); c.key(10, "head", rot=(-10, 0, 0)); c.key(10, "lantern", rot=(18, 0, 0))
    rest_all(c, 22)

# ---- roar: arms overhead, chest out ----------------------------------------------------------------------------------------
with b.clip("roar", 29) as c:
    rest_all(c, 0)
    for f in (8, 18):
        both(c, f, "upperarm", rot=(-150, 0, 32)); both(c, f, "forearm", rot=(-22, 0, 0))
        c.key(f, "chest", rot=(-16, 0, 0)); c.key(f, "spine", rot=(-6, 0, 0)); c.key(f, "hips", loc=(0, 0, 0.06), rot=(-4, 0, 0))
        c.key(f, "head", rot=(-26, 0, 0)); c.key(f, "lantern", rot=(-20, 0, 0))
        both(c, f, "thigh", rot=(4, 0, 0))
    for f, r in ((10, 0), (12, 4), (14, -4), (16, 3), (18, 0)):
        c.key(f, "head", rot=(-26, r, 0))
    both(c, 29, "upperarm", rot=(-120, 0, 26)); both(c, 29, "forearm", rot=(-20, 0, 0))
    c.key(29, "chest", rot=(-8, 0, 0)); c.key(29, "hips", loc=(0, 0, 0.02), rot=(-2, 0, 0)); c.key(29, "head", rot=(-12, 0, 0)); c.key(29, "lantern", rot=(-6, 0, 0))

# ---- death: recoil, knees buckle, fall forward onto the face ------------------------------------------------------------------
with b.clip("death", 62) as c:
    rest_all(c, 0)
    c.key(8, "chest", rot=(-15, 0, 0)); c.key(8, "head", rot=(-20, 0, 0)); both(c, 8, "upperarm", rot=(-40, 0, 20)); c.key(8, "hips", loc=(0, 0.06, 0), rot=(-6, 0, 0))
    c.key(20, "hips", loc=(0, 0, -0.55), rot=(6, 0, 0)); both(c, 20, "thigh", rot=(-38, 0, 0)); both(c, 20, "shin", rot=(78, 0, 0)); c.key(20, "chest", rot=(10, 0, 0)); c.key(20, "head", rot=(6, 0, 0))
    both(c, 20, "upperarm", rot=(-30, 0, 15)); both(c, 20, "forearm", rot=(-20, 0, 0)); c.key(20, "lantern", rot=(10, 0, 0))
    c.key(34, "hips", loc=(0, -0.20, -0.78), rot=(42, 0, 0)); c.key(34, "chest", rot=(30, 0, 0)); c.key(34, "spine", rot=(8, 0, 0)); c.key(34, "head", rot=(20, 0, 0))
    both(c, 34, "upperarm", rot=(-75, 0, 18)); both(c, 34, "forearm", rot=(-30, 0, 0)); both(c, 34, "thigh", rot=(10, 0, 0)); both(c, 34, "shin", rot=(20, 0, 0))
    c.key(48, "hips", loc=(0, -0.50, -0.96), rot=(82, 0, 0)); c.key(48, "chest", rot=(6, 0, 0)); c.key(48, "spine", rot=(2, 0, 0)); c.key(48, "head", rot=(-14, 0, 0))
    both(c, 48, "upperarm", rot=(-95, 0, 25)); both(c, 48, "forearm", rot=(-25, 0, 0)); both(c, 48, "thigh", rot=(-70, 0, 0)); both(c, 48, "shin", rot=(2, 0, 0)); both(c, 48, "foot", rot=(30, 0, 0))
    c.key(48, "lantern", rot=(26, 0, 0))
    c.key(62, "hips", loc=(0, -0.52, -0.99), rot=(84, 0, 0)); c.key(62, "head", rot=(-6, 0, 0)); c.key(62, "lantern", rot=(34, 0, 8)); both(c, 62, "upperarm", rot=(-100, 0, 28))

b.notes.append("Runtime naturalHeight 2.70 m (lantern ring is the tallest point, ~3.0 m authored; the loader rescales).")
b.notes.append("Glow slot 'warden_glow' = eye slits + lantern glass; 'warden_gem' = the back crest gem (the pound target). Both untextured emissive; the atlas is 2K.")
finish(b, os.path.join(out, "warden.manifest.json"), idle_clip="idle",
       extra={"kind": "critter", "states": {"idle": "idle", "roar": "roar", "stompTele": "stomp_telegraph", "stomp": "stomp_attack_slam", "chargeTele": "charge_telegraph",
                                            "charge": "charge_run", "dizzy": "dizzy", "hit": "hit", "death": "death"}})
