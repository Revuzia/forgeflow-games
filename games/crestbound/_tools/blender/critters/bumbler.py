"""BUMBLER — round waddler with stubby legs, googly eyes and a bowler hat. Runtime natural height 0.924 m.
Clips: waddle, squish, respawn.  Bones: root (whole-body rock), body (squash only), hat, eye_L/R, pupil_L/R,
arm_L/R, leg_L/R. Eyes/hat/arms hang off ROOT (not body) so the squash never shears them."""
# CLIP NAMES: runtime/entities/critters.js `_playClip(state)` does NOT look a clip up by name --
# it walks CLIP_MAP[state]'s fragment list and takes the first clip whose lower-cased name CONTAINS
# the fragment (falling back to clips[0]). Every clip below therefore carries BOTH its semantic name
# and the fragment that makes the runtime resolve it. Proven by _tools/blender/critters/glbcheck.mjs
# (`runtime_state_resolution`), which loads the shipped GLB through the game's own GLTFLoader.
import bpy, sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cblib import *
from mathutils import Vector, Euler

out = sys.argv[sys.argv.index("--") + 1]
b = Builder("bumbler", out, atlas=1024, height=0.924)

skin = b.mat("skin", mat_skin, base=(0.86, 0.40, 0.10), rough=0.55, blush=(0.6, 0.18, 0.05), scale=7.0)
belly = b.mat("belly", mat_skin, base=(0.96, 0.86, 0.62), rough=0.6, blush=(0.8, 0.55, 0.35), scale=7.0)
cheek = b.mat("cheek", mat_skin, base=(0.95, 0.45, 0.42), rough=0.5, blush=(0.8, 0.3, 0.3))
leather = b.mat("leather", mat_paint, base=(0.30, 0.17, 0.08), rough=0.7, chip=(0.45, 0.3, 0.18), scale=10.0, bump=0.3)
felt = b.mat("felt", mat_cloth, base=(0.55, 0.07, 0.10), rough=0.85, scale=90.0, bump=0.35)
band = b.mat("band", mat_paint, base=(0.85, 0.62, 0.15), rough=0.5, chips=False, scale=12.0, bump=0.1)
white = b.mat("white", mat_flat, base=(0.97, 0.96, 0.92), rough=0.12)
pupil = b.mat("pupil", mat_flat, base=(0.03, 0.03, 0.05), rough=0.3)
mouthm = b.mat("mouth", mat_flat, base=(0.25, 0.05, 0.06), rough=0.5)

C = Vector((0, 0, 0.50))
# body + belly
b.sphere("body", 0.40, C, "body", skin, seg=28, rings=18, scale=(1.0, 0.95, 0.92))
b.sphere("belly", 0.30, C + Vector((0, -0.14, -0.06)), "body", belly, seg=22, rings=14, scale=(0.9, 0.5, 0.85))
# cheeks + smile
for sx in (-1, 1):
    b.sphere("cheek_%d" % sx, 0.055, (sx * 0.235, -0.30, 0.50), "body", cheek, seg=12, rings=8, scale=(1, 0.55, 0.8))
smile = b.torus("smile", 0.075, 0.017, (0, -0.375, 0.48), "body", mouthm, seg_major=20, seg_minor=6, rot=(90, 0, 0))
b.cut(smile, b.cutter("smile_cut", (0.4, 0.4, 0.3), (0, -0.375, 0.48 + 0.15)))
# eyes
eyes = {}
for side, sx in (("L", -1), ("R", 1)):
    ec = Vector((sx * 0.145, -0.31, 0.63))
    outv = ((ec - C).normalized() + Vector((0, -0.8, 0))).normalized()
    b.sphere("eye_" + side, 0.115, ec, "eye_" + side, white, seg=18, rings=12)
    pc = ec + outv * 0.087
    b.sphere("pupil_" + side, 0.048, pc, "pupil_" + side, pupil, seg=12, rings=8)
    eyes[side] = (ec, pc, outv)
# arms (stubby nubs)
for side, sx in (("L", -1), ("R", 1)):
    b.capsule("arm_" + side, 0.062, 0.10, (sx * 0.41, -0.03, 0.47), "arm_" + side, skin, seg=12, rot=(0, sx * 40, 0), rings=3)
    b.sphere("mitt_" + side, 0.068, (sx * 0.46, -0.05, 0.40), "arm_" + side, belly, seg=12, rings=8)
# legs + feet
for side, sx in (("L", -1), ("R", 1)):
    b.capsule("leg_" + side, 0.075, 0.10, (sx * 0.15, 0.0, 0.18), "leg_" + side, skin, seg=12, rings=3)
    b.rbox("foot_" + side, (0.19, 0.26, 0.10), (sx * 0.15, -0.04, 0.05), "leg_" + side, leather, bevel=0.035, segs=3)
    b.rbox("sole_" + side, (0.17, 0.24, 0.02), (sx * 0.15, -0.04, 0.01), "leg_" + side, mouthm, bevel=0.008, segs=1)
# bowler hat (lathe) with band, jaunty tilt
HAT = Vector((0.02, 0.0, 0.855))
HROT = (5, -9, 0)
b.lathe("hat", [(0, 0), (0.30, 0), (0.315, 0.012), (0.30, 0.024), (0.215, 0.024), (0.215, 0.10), (0.195, 0.16), (0.13, 0.20), (0, 0.21)],
        HAT, "hat", felt, seg=32, rot=HROT)
R = Euler([math.radians(a) for a in HROT], 'XYZ').to_matrix()
b.torus("hatband", 0.218, 0.02, HAT + R @ Vector((0, 0, 0.055)), "hat", band, seg_major=32, seg_minor=6, rot=HROT)

b.face_at = Vector((0, -0.38, 0.58))
b.face_r = 0.36

b.build_mesh()
b.bake(ao_samples=24)

eL, pL, oL = eyes["L"]
eR, pR, oR = eyes["R"]
b.rig([
    ("root", (0, 0, 0), (0, 0, 0.12), None),
    ("body", (0, 0, 0.10), (0, 0, 0.86), "root"),
    ("hat", tuple(HAT), tuple(HAT + Vector((0, 0, 0.2))), "root"),
    ("eye_L", tuple(eL), tuple(eL + oL * 0.12), "root"),
    ("pupil_L", tuple(pL), tuple(pL + oL * 0.05), "eye_L"),
    ("eye_R", tuple(eR), tuple(eR + oR * 0.12), "root"),
    ("pupil_R", tuple(pR), tuple(pR + oR * 0.05), "eye_R"),
    ("arm_L", (-0.37, -0.02, 0.55), (-0.47, -0.05, 0.38), "root"),
    ("arm_R", (0.37, -0.02, 0.55), (0.47, -0.05, 0.38), "root"),
    ("leg_L", (-0.15, 0, 0.28), (-0.15, 0, 0.04), "root"),
    ("leg_R", (0.15, 0, 0.28), (0.15, 0, 0.04), "root"),
])

# --- waddle: 2 steps per second; root carries the rock/bob/yaw, legs alternate, hat lags -----------------
with b.clip("waddle_walk", 24) as c:
    for f, roll, bob, yaw in ((0, 0, 0, 0), (6, -7, 0.022, 3), (12, 0, 0, 0), (18, 7, 0.022, -3), (24, 0, 0, 0)):
        c.key(f, "root", rot=(0, roll, yaw), loc=(0, 0, bob))
    for f, l in ((0, 0), (6, -26), (12, 0), (18, 26), (24, 0)):
        c.key(f, "leg_L", rot=(l, 0, 0)); c.key(f, "leg_R", rot=(-l, 0, 0))
        c.key(f, "arm_L", rot=(-l * 0.5, 0, 0)); c.key(f, "arm_R", rot=(l * 0.5, 0, 0))
    for f, h in ((0, 0), (8, 5), (14, 0), (20, -5), (24, 0)):
        c.key(f, "hat", rot=(0, h, 0))
    for f, s in ((0, (1, 1, 1)), (6, (1.02, 1.02, 0.97)), (12, (1, 1, 1)), (18, (1.02, 1.02, 0.97)), (24, (1, 1, 1))):
        c.key(f, "body", scale=s)
    for f, dx in ((0, 0), (12, 0.008), (24, 0)):
        c.key(f, "pupil_L", loc=(dx, 0, 0)); c.key(f, "pupil_R", loc=(dx, 0, 0))

# --- squish: pancake in 8 frames; hat pops, eyes bulge then drop with the body ----------------------------
SQ = (1.55, 1.55, 0.22)
EYE_DROP = -0.42
with b.clip("squish_flat", 8) as c:
    c.key(0, "body", scale=(1, 1, 1)); c.key(2, "body", scale=(0.9, 0.9, 1.15)); c.key(4, "body", scale=(1.62, 1.62, 0.18)); c.key(8, "body", scale=SQ)
    for s in ("L", "R"):
        c.key(0, "leg_" + s, scale=(1, 1, 1), loc=(0, 0, 0)); c.key(4, "leg_" + s, scale=(1.4, 1.4, 0.3), loc=(0, 0, -0.16)); c.key(8, "leg_" + s, scale=(1.3, 1.3, 0.3), loc=(0, 0, -0.16))
        c.key(0, "arm_" + s, loc=(0, 0, 0), scale=(1, 1, 1)); c.key(4, "arm_" + s, loc=((-1 if s == "L" else 1) * 0.12, 0, -0.30), scale=(1.2, 1.2, 0.6)); c.key(8, "arm_" + s, loc=((-1 if s == "L" else 1) * 0.10, 0, -0.28), scale=(1.2, 1.2, 0.6))
        c.key(0, "eye_" + s, loc=(0, 0, 0), scale=(1, 1, 1)); c.key(2, "eye_" + s, loc=(0, -0.06, 0.03), scale=(1.35, 1.35, 1.35))
        c.key(4, "eye_" + s, loc=(0, -0.10, EYE_DROP + 0.06), scale=(1.3, 1.3, 1.3)); c.key(8, "eye_" + s, loc=(0, -0.09, EYE_DROP), scale=(1.15, 1.15, 1.15))
    c.key(0, "hat", loc=(0, 0, 0), rot=(0, 0, 0)); c.key(2, "hat", loc=(0, 0, 0.28), rot=(-25, 0, 0)); c.key(5, "hat", loc=(0, 0.02, 0.10), rot=(-10, 0, 0)); c.key(8, "hat", loc=(0, 0.03, -0.58), rot=(6, 0, 0))

# --- respawn: from the pancake, inflate with overshoot ---------------------------------------------------------
with b.clip("respawn", 20) as c:
    c.key(0, "body", scale=SQ); c.key(6, "body", scale=(0.86, 0.86, 1.28)); c.key(12, "body", scale=(1.08, 1.08, 0.94)); c.key(16, "body", scale=(0.98, 0.98, 1.03)); c.key(20, "body", scale=(1, 1, 1))
    for s in ("L", "R"):
        sx = -1 if s == "L" else 1
        c.key(0, "leg_" + s, scale=(1.3, 1.3, 0.3), loc=(0, 0, -0.16)); c.key(6, "leg_" + s, scale=(1, 1, 1), loc=(0, 0, 0))
        c.key(0, "arm_" + s, loc=(sx * 0.10, 0, -0.28), scale=(1.2, 1.2, 0.6)); c.key(6, "arm_" + s, loc=(0, 0, 0), scale=(1, 1, 1))
        c.key(0, "eye_" + s, loc=(0, -0.09, EYE_DROP), scale=(1.15, 1.15, 1.15)); c.key(6, "eye_" + s, loc=(0, -0.02, 0.06), scale=(1.1, 1.1, 1.1)); c.key(12, "eye_" + s, loc=(0, 0, -0.01), scale=(1, 1, 1)); c.key(20, "eye_" + s, loc=(0, 0, 0), scale=(1, 1, 1))
    c.key(0, "hat", loc=(0, 0.03, -0.58), rot=(6, 0, 0)); c.key(6, "hat", loc=(0, 0, 0.12), rot=(-8, 0, 0)); c.key(12, "hat", loc=(0, 0, -0.02), rot=(2, 0, 0)); c.key(20, "hat", loc=(0, 0, 0), rot=(0, 0, 0))

b.notes.append("Runtime naturalHeight 0.924 m (BM_R 0.42 * 2.2). Hat top is the tallest point.")
b.notes.append("root = whole-body rock/bob/yaw; body = squash/stretch only; hat/eyes/arms are children of root so the squash never shears them.")
finish(b, os.path.join(out, "bumbler.manifest.json"), idle_clip="waddle_walk",
       extra={"kind": "critter", "states": {"walk": "waddle_walk", "squish": "squish_flat", "respawn": "respawn"}})
