"""OLD FEN — the stooped Keep caretaker with a staff lantern (NPC). Runtime natural height 1.70 m.
Clips: idle, talk.  Bones: root, hips, spine, chest, neck, head, hood, beard, brow/eye/pupil L+R,
shoulder/upperarm/forearm/hand L+R, staff, lantern (24). Robe + beard use soft (banded) weights."""
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
b = Builder("fen", out, atlas=2048, height=1.7)

robe = b.mat("robe", mat_cloth, base=(0.10, 0.27, 0.23), rough=0.9, scale=70.0, bump=0.4)
hoodm = b.mat("hood", mat_cloth, base=(0.07, 0.19, 0.17), rough=0.92, scale=70.0, bump=0.4)
trim = b.mat("trim", mat_cloth, base=(0.62, 0.50, 0.22), rough=0.85, scale=90.0, bump=0.3)
skin = b.mat("skin", mat_skin, base=(0.84, 0.62, 0.46), rough=0.55, blush=(0.7, 0.35, 0.25), scale=6.0)
hair = b.mat("hair", mat_paint, base=(0.86, 0.85, 0.80), rough=0.8, chips=False, scale=25.0, bump=0.45)
leather = b.mat("leather", mat_paint, base=(0.36, 0.20, 0.09), rough=0.7, chip=(0.5, 0.33, 0.2), scale=8.0, bump=0.3)
rope = b.mat("rope", mat_cloth, base=(0.60, 0.48, 0.28), rough=0.95, scale=120.0, bump=0.6)
wood = b.mat("wood", mat_wood, base=(0.40, 0.25, 0.12), dark=(0.18, 0.10, 0.04))
brass = b.mat("brass", mat_metal, base=(0.66, 0.47, 0.17), rough=0.38, worn=(0.95, 0.85, 0.55), grime=(0.12, 0.08, 0.03), scale=14.0, bump=0.25)
white = b.mat("white", mat_flat, base=(0.97, 0.96, 0.92), rough=0.12)
pupil = b.mat("pupil", mat_flat, base=(0.08, 0.10, 0.16), rough=0.3)
glow = b.mat("glow", mat_glow, color=(1.0, 0.72, 0.30), strength=5.0)

STOOP = 0.20   # how far the shoulders lean forward (-Y)
def stoop(p):
    t = smooth01((p.z - 0.75) / 0.55)
    return Vector((p.x, p.y - STOOP * t, p.z))

# ---- robe (lathe) stooped forward, hem trim, rope belt ---------------------------------------------------------
robe_ob = b.lathe("robe", [(0, 0), (0.35, 0), (0.37, 0.05), (0.34, 0.30), (0.29, 0.60), (0.245, 0.85), (0.235, 1.02), (0.27, 1.16), (0.26, 1.27), (0.17, 1.35), (0, 1.38)],
                  (0, 0, 0), "hips", robe, seg=26)
b.warp(robe_ob, stoop)
b.soft_weights(robe_ob, [("hips", 0.0), ("hips", 0.80), ("spine", 1.0), ("chest", 1.2), ("chest", 1.4)])
hem = b.torus("hem", 0.36, 0.022, (0, 0, 0.03), "hips", trim, seg_major=26, seg_minor=5)
belt = b.torus("belt", 0.255, 0.026, (0, -0.03, 0.95), "hips", rope, seg_major=24, seg_minor=5)
b.soft_weights(belt, [("hips", 0.0), ("hips", 0.9), ("spine", 1.0)])
# knot: two rope tails
b.capsule("knot_a", 0.02, 0.16, (-0.05, -0.28, 0.86), "hips", rope, seg=7, rot=(15, 20, 0), rings=1)
b.capsule("knot_b", 0.02, 0.12, (0.03, -0.28, 0.88), "hips", rope, seg=7, rot=(10, -25, 0), rings=1)
# feet
for sx in (-1, 1):
    b.rbox("foot_%d" % sx, (0.13, 0.24, 0.08), (sx * 0.12, -0.12, 0.04), "root", leather, bevel=0.03, segs=3)

# ---- shoulders, arms, hands ---------------------------------------------------------------------------------------
SH = {"L": Vector((-0.25, -0.28, 1.20)), "R": Vector((0.25, -0.28, 1.20))}
for side, sx in (("L", -1), ("R", 1)):
    b.sphere("shoulder_" + side, 0.115, SH[side], "shoulder_" + side, robe, seg=14, rings=8)
b.capsule("upperarm_L", 0.085, 0.16, (-0.29, -0.31, 1.08), "upperarm_L", robe, seg=12, rot=(14, -14, 0), rings=2)
b.capsule("forearm_L", 0.08, 0.16, (-0.35, -0.38, 0.86), "forearm_L", robe, seg=12, rot=(28, -10, 0), rings=2)
b.torus("cuff_L", 0.085, 0.018, (-0.375, -0.42, 0.77), "forearm_L", trim, seg_major=16, seg_minor=5, rot=(28, -10, 0))
# mitten hands, not balls: a squashed ovoid along the forearm plus a thumb lobe (CONTRACT: "mitten hands")
b.sphere("hand_L", 0.068, (-0.39, -0.45, 0.70), "hand_L", skin, seg=12, rings=8, scale=(0.95, 1.0, 1.35))
b.sphere("thumb_L", 0.030, (-0.34, -0.46, 0.74), "hand_L", skin, seg=8, rings=6, scale=(1.0, 1.0, 1.25))
b.capsule("upperarm_R", 0.085, 0.16, (0.29, -0.32, 1.09), "upperarm_R", robe, seg=12, rot=(20, 14, 0), rings=2)
b.capsule("forearm_R", 0.08, 0.16, (0.36, -0.44, 0.92), "forearm_R", robe, seg=12, rot=(62, 4, 0), rings=2)
b.torus("cuff_R", 0.085, 0.018, (0.40, -0.52, 0.88), "forearm_R", trim, seg_major=16, seg_minor=5, rot=(62, 4, 0))
b.sphere("hand_R", 0.068, (0.42, -0.55, 0.86), "hand_R", skin, seg=12, rings=8, scale=(1.0, 1.05, 1.30))
b.sphere("thumb_R", 0.030, (0.37, -0.56, 0.90), "hand_R", skin, seg=8, rings=6, scale=(1.0, 1.0, 1.25))

# ---- staff + hook + lantern ---------------------------------------------------------------------------------------
SX, SY = 0.42, -0.56
b.cyl("staff", 0.026, 0.022, 1.62, (SX, SY, 0.81), "staff", wood, seg=12, bevel=0.005)
b.sphere("knob", 0.055, (SX, SY, 1.63), "staff", wood, seg=10, rings=7)
b.torus("ferrule", 0.03, 0.01, (SX, SY, 1.55), "staff", brass, seg_major=14, seg_minor=5)
HOOK = Vector((SX + 0.14, SY - 0.12, 1.54))
b.tube("hook", [(SX, SY, 1.50), (SX + 0.07, SY - 0.06, 1.60), (SX + 0.14, SY - 0.10, 1.58), (SX + 0.14, SY - 0.12, 1.545)], 0.014, "staff", brass, seg=8)
LZ = 1.50
b.torus("lantern_ring", 0.03, 0.008, HOOK + Vector((0, 0, -0.03)), "lantern", brass, seg_major=12, seg_minor=5, rot=(0, 90, 0))
b.cone("lantern_cap", 0.095, 0.07, HOOK + Vector((0, 0, -0.09)), "lantern", brass, seg=12, bevel=0)
b.cyl("lantern_glass", 0.062, 0.062, 0.15, HOOK + Vector((0, 0, -0.20)), "lantern", glow, seg=14)
for k in range(4):
    a = math.radians(45 + 90 * k)
    b.cyl("lbar%d" % k, 0.011, 0.011, 0.17, HOOK + Vector((math.cos(a) * 0.07, math.sin(a) * 0.07, -0.20)), "lantern", brass, seg=6)
b.cyl("lantern_base", 0.08, 0.07, 0.035, HOOK + Vector((0, 0, -0.295)), "lantern", brass, seg=14, bevel=0.004)

# ---- head, face, beard, hood -----------------------------------------------------------------------------------------
HC = Vector((0, -0.38, 1.43))
b.sphere("head", 0.18, HC, "head", skin, seg=20, rings=14, scale=(1, 1, 1.06))
b.sphere("nose", 0.055, HC + Vector((0, -0.19, -0.02)), "head", skin, seg=12, rings=8, scale=(0.9, 1.3, 1.1))
eyes = {}
for side, sx in (("L", -1), ("R", 1)):
    ec = HC + Vector((sx * 0.072, -0.155, 0.045))
    outv = Vector((sx * 0.25, -1, 0.1)).normalized()
    b.sphere("eye_" + side, 0.05, ec, "eye_" + side, white, seg=12, rings=8)
    pc = ec + outv * 0.036
    b.sphere("pupil_" + side, 0.022, pc, "pupil_" + side, pupil, seg=10, rings=7)
    eyes[side] = (ec, pc, outv)
    b.rbox("brow_" + side, (0.10, 0.05, 0.035), ec + Vector((sx * 0.005, -0.01, 0.062)), "brow_" + side, hair, bevel=0.012, segs=2, rot=(12, 0, sx * -10))
    b.capsule("moustache_" + side, 0.028, 0.06, HC + Vector((sx * 0.06, -0.185, -0.07)), "head", hair, seg=10, rot=(0, 90, sx * 22), rings=2)
CHIN = HC + Vector((0, -0.09, -0.11))
beard = b.lathe("beard", [(0, -0.42), (0.05, -0.38), (0.095, -0.26), (0.125, -0.12), (0.10, 0.0), (0, 0.0)], CHIN, "beard", hair, seg=18, rot=(18, 0, 0))
b.soft_weights(beard, [("beard", 0.9), ("beard", 1.10), ("head", 1.30), ("head", 1.4)])
# hood: shell around the head, face cut open, draped down the back
hood = b.lathe("hood", [(0, -0.02), (0.235, -0.02), (0.255, 0.10), (0.235, 0.20), (0.13, 0.26), (0, 0.27)], HC + Vector((0, 0.03, -0.03)), "hood", hoodm, seg=26)
# The face opening is cut with an ELLIPSOID, not a box. A box cutter left four straight rim
# edges and two 45-degree corners across the front of a 26-segment dome, which is what made
# the hood read as a faceted slab in _turntable/fen_tt_00.png rather than as cloth.
b.cut(hood, b.cutter_sphere("hood_cut", 0.30, HC + Vector((0, -0.30, 0.03)), scale=(0.80, 1.0, 0.88)))
b.capsule("drape", 0.19, 0.20, (0, -0.10, 1.20), "chest", hoodm, seg=14, rot=(-28, 0, 0), rings=2)

# ---- satchel + strap --------------------------------------------------------------------------------------------------
b.rbox("satchel", (0.22, 0.10, 0.18), (-0.30, -0.14, 0.80), "hips", leather, bevel=0.03, segs=3)
b.rbox("flap", (0.23, 0.05, 0.11), (-0.30, -0.18, 0.855), "hips", leather, bevel=0.015, segs=2)
b.sphere("clasp", 0.02, (-0.30, -0.21, 0.82), "hips", brass, seg=8, rings=5)
strap = b.tube("strap", [(-0.30, -0.14, 0.88), (-0.22, -0.26, 1.04), (-0.06, -0.36, 1.22), (0.14, -0.30, 1.30)], 0.02, "chest", leather, seg=8)
b.soft_weights(strap, [("hips", 0.85), ("spine", 1.0), ("chest", 1.15)])

b.face_at = HC + Vector((0, -0.1, -0.03))
b.face_r = 0.34

b.build_mesh()
b.bake(ao_samples=24)

eL, pL, oL = eyes["L"]
eR, pR, oR = eyes["R"]
b.rig([
    ("root", (0, 0, 0), (0, 0, 0.15), None),
    ("hips", (0, 0, 0.70), (0, 0, 0.95), "root"),
    ("spine", (0, 0, 0.95), (0, -0.06, 1.12), "hips"),
    ("chest", (0, -0.06, 1.12), (0, -0.22, 1.30), "spine"),
    ("neck", (0, -0.22, 1.30), (0, -0.30, 1.36), "chest"),
    ("head", (0, -0.30, 1.36), (0, -0.36, 1.60), "neck"),
    ("hood", (0, -0.30, 1.38), (0, -0.34, 1.62), "head"),
    ("beard", tuple(CHIN), tuple(CHIN + Vector((0, -0.10, -0.38))), "head"),
    ("brow_L", tuple(eL + Vector((0, 0, 0.06))), tuple(eL + Vector((0, -0.08, 0.06))), "head"),
    ("brow_R", tuple(eR + Vector((0, 0, 0.06))), tuple(eR + Vector((0, -0.08, 0.06))), "head"),
    ("eye_L", tuple(eL), tuple(eL + oL * 0.06), "head"),
    ("pupil_L", tuple(pL), tuple(pL + oL * 0.02), "eye_L"),
    ("eye_R", tuple(eR), tuple(eR + oR * 0.06), "head"),
    ("pupil_R", tuple(pR), tuple(pR + oR * 0.02), "eye_R"),
    ("shoulder_L", (-0.10, -0.26, 1.20), tuple(SH["L"]), "chest"),
    ("upperarm_L", tuple(SH["L"]), (-0.33, -0.35, 0.96), "shoulder_L"),
    ("forearm_L", (-0.33, -0.35, 0.96), (-0.38, -0.43, 0.76), "upperarm_L"),
    ("hand_L", (-0.38, -0.43, 0.76), (-0.40, -0.47, 0.64), "forearm_L"),
    ("shoulder_R", (0.10, -0.26, 1.20), tuple(SH["R"]), "chest"),
    ("upperarm_R", tuple(SH["R"]), (0.33, -0.37, 0.98), "shoulder_R"),
    ("forearm_R", (0.33, -0.37, 0.98), (0.41, -0.53, 0.87), "upperarm_R"),
    ("hand_R", (0.41, -0.53, 0.87), (0.44, -0.58, 0.80), "forearm_R"),
    ("staff", (SX, SY, 0.86), (SX, SY, 1.64), "hand_R"),
    ("lantern", tuple(HOOK), tuple(HOOK + Vector((0, 0, -0.30))), "staff"),
])

# ---- idle: breathe, look around, lantern sway, blink ---------------------------------------------------------------------
with b.clip("idle", 96) as c:
    for f, br in ((0, 0), (48, 2.2), (96, 0)):
        c.key(f, "chest", rot=(br, 0, 0)); c.key(f, "spine", rot=(br * 0.4, 0, 0)); c.key(f, "hips", loc=(0, 0, -0.004 * br / 2.2))
    for f, yaw, pitch in ((0, 0, 0), (30, -16, -3), (42, -16, -3), (70, 12, 2), (96, 0, 0)):
        c.key(f, "head", rot=(pitch, 0, yaw))
    for f, lx, ly in ((0, 0, 0), (24, 7, 3), (48, 0, -4), (72, -7, 2), (96, 0, 0)):
        c.key(f, "lantern", rot=(lx, ly, 0))
    for f, s in ((56, 1.0), (58, 0.08), (61, 1.0)):
        c.key(f, "eye_L", scale=(1, 1, s)); c.key(f, "eye_R", scale=(1, 1, s))
    for f, bd in ((0, 0), (36, 3), (72, -2), (96, 0)):
        c.key(f, "beard", rot=(bd, 0, 0))
    for f, hx in ((0, 0), (48, -5), (96, 0)):
        c.key(f, "hand_L", rot=(hx, 0, 0))
    for f, st in ((0, 0), (48, 1.5), (96, 0)):
        c.key(f, "staff", rot=(0, st, 0))

# ---- talk: nods, raised brows, free-hand gestures, beard bob ----------------------------------------------------------------
with b.clip("talk", 48) as c:
    for f, p, y in ((0, 0, 0), (8, 7, 3), (16, -3, -4), (28, 6, 2), (40, -1, -3), (48, 0, 0)):
        c.key(f, "head", rot=(p, 0, y))
    for f, bw in ((0, 0), (8, -12), (24, -2), (36, -9), (48, 0)):
        c.key(f, "brow_L", rot=(bw, 0, 0)); c.key(f, "brow_R", rot=(bw, 0, 0))
    for f, bd in ((0, 0), (6, 6), (12, 0), (20, 5), (26, 0), (34, 6), (40, 0), (48, 0)):
        c.key(f, "beard", rot=(bd, 0, 0))
    for f, fa, hz in ((0, 0, 0), (10, -55, 20), (20, -38, -15), (30, -60, 25), (40, -30, 0), (48, 0, 0)):
        c.key(f, "forearm_L", rot=(fa, 0, 0)); c.key(f, "hand_L", rot=(0, 0, hz)); c.key(f, "upperarm_L", rot=(fa * 0.2, 0, -fa * 0.1))
    for f, lx in ((0, 0), (12, 8), (24, -6), (36, 7), (48, 0)):
        c.key(f, "lantern", rot=(lx, 0, 0))
    for f, br in ((0, 0), (10, 3), (48, 0)):
        c.key(f, "chest", rot=(br, 0, 0))

b.notes.append("Runtime naturalHeight 1.70 m; staff knob is the tallest point (~1.69 m). Robe/beard/strap use banded soft weights.")
b.notes.append("Glow slot 'fen_glow' = lantern glass (untextured emissive). Blink = eye bone Z-scale in idle at f58.")
finish(b, os.path.join(out, "fen.manifest.json"), idle_clip="idle",
       extra={"kind": "npc", "states": {"idle": "idle", "talk": "talk"}})
