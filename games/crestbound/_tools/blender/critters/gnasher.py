"""GNASHER — spiked iron sphere with a hinged jaw (chained lunger). Runtime natural height 1.10 m.
Clips: idle, telegraph, lunge, recover, freed.  Bones: root, body, jaw, eye_L/R, pupil_L/R, brow_L/R, anchor."""
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
b = Builder("gnasher", out, atlas=1024, height=1.1)

iron = b.mat("iron", mat_metal, base=(0.30, 0.31, 0.35), rough=0.5, rust=(0.46, 0.17, 0.05), scale=12.0, bump=0.4)
dark = b.mat("dark", mat_metal, base=(0.16, 0.16, 0.18), rough=0.62, worn=(0.55, 0.55, 0.52), scale=20.0, bump=0.3)
maw = b.mat("maw", mat_skin, base=(0.42, 0.06, 0.08), rough=0.45, blush=(0.2, 0.02, 0.03))
tooth = b.mat("tooth", mat_flat, base=(0.92, 0.88, 0.78), rough=0.35, bump=0.08)
white = b.mat("white", mat_flat, base=(0.97, 0.96, 0.92), rough=0.12)
pupil = b.mat("pupil", mat_flat, base=(0.03, 0.03, 0.05), rough=0.3)
brass = b.mat("brass", mat_metal, base=(0.62, 0.45, 0.18), rough=0.4, worn=(0.9, 0.8, 0.5), grime=(0.12, 0.08, 0.03), scale=16.0)

C = Vector((0, 0, 0.55))
R = 0.50

# --- skull with the mouth cut out (front-lower) ------------------------------------------------
skull = b.sphere("skull", R, C, "body", iron, seg=28, rings=18)
mouth = b.cutter("mouth_cut", (0.64, 0.55, 0.23), (0, -0.45, 0.42))
b.cut(skull, mouth)
# the fresh interior faces sit on the cutter planes -> maw material
cav = lambda c: (c.y < -0.17 and -0.33 < c.x < 0.33 and 0.30 < c.z < 0.54)
b.assign_faces(skull, maw, lambda c: cav(c) and (abs(c.y + 0.175) < 0.006 or abs(c.z - 0.535) < 0.006))
b.assign_faces(skull, dark, lambda c: cav(c) and (abs(c.z - 0.305) < 0.006 or abs(abs(c.x) - 0.32) < 0.006))
# equatorial riveted band + rivets
b.torus("band", R + 0.012, 0.018, C, "body", dark, seg_major=32, seg_minor=5)
for i in range(10):
    a = math.radians(36 * i + 18)
    if abs(math.degrees(a) - 270) < 50:      # skip the face
        continue
    b.sphere("rivet%d" % i, 0.028, C + Vector((math.cos(a) * (R + 0.02), math.sin(a) * (R + 0.02), 0)), "body", brass, seg=8, rings=5)

# --- jaw: lower lens of the mouth region ---------------------------------------------------------
jaw = b.sphere("jaw", R + 0.006, C, "jaw", iron, seg=28, rings=18)
jbox = b.cutter("jaw_cut", (0.60, 0.7, 0.115), (0, -0.45, 0.362))
b.cut(jaw, jbox, op='INTERSECT')
b.assign_faces(jaw, maw, lambda c: abs(c.z - 0.4195) < 0.006)          # tongue top
b.assign_faces(jaw, dark, lambda c: abs(c.z - 0.3045) < 0.006 or abs(abs(c.x) - 0.30) < 0.006)   # underside + sides

# --- teeth ----------------------------------------------------------------------------------------
for k, x in enumerate((-0.235, -0.12, 0.0, 0.12, 0.235)):
    y = -(math.sqrt(R * R - x * x - 0.0004) - 0.075)
    b.cone("utooth%d" % k, 0.042, 0.115, (x, y, 0.535 - 0.05), "body", tooth, seg=8, rot=(180, 0, 0))
for k, x in enumerate((-0.19, -0.065, 0.065, 0.19)):
    y = -(math.sqrt(R * R - x * x - 0.02) - 0.08)
    b.cone("ltooth%d" % k, 0.04, 0.105, (x, y, 0.42 + 0.045), "jaw", tooth, seg=8)

# --- eyes + pupils + brows ------------------------------------------------------------------------
EYE_R = 0.145
eyes = {}
for side, sx in (("L", -1), ("R", 1)):
    ec = Vector((sx * 0.20, -0.355, 0.77))
    outv = (ec - C).normalized()
    outv = (outv + Vector((0, -0.6, 0))).normalized()
    b.sphere("eye_" + side, EYE_R, ec, "eye_" + side, white, seg=18, rings=12)
    pc = ec + outv * (EYE_R * 0.78)
    b.sphere("pupil_" + side, 0.062, pc, "pupil_" + side, pupil, seg=12, rings=8)
    eyes[side] = (ec, pc, outv)
    # brow plate hugging the sphere above the eye, angled into a scowl
    bc = ec + Vector((sx * 0.01, 0.0, EYE_R + 0.015))
    b.rbox("brow_" + side, (0.23, 0.10, 0.055), bc, "brow_" + side, dark, bevel=0.016, segs=2, rot=(42, 0, sx * -14))

# --- spikes with rivet collars ----------------------------------------------------------------------
spikes = [(0, 90)]
spikes += [(yaw, 45) for yaw in (30, 90, 150, 210, 270, 330)]
spikes += [(yaw, 0) for yaw in (60, 120, 180, 240, 300)]
spikes += [(yaw, -35) for yaw in (100, 180, 260)]
for i, (yaw, el) in enumerate(spikes):
    a = math.radians(yaw); e = math.radians(el)
    # yaw 0 = back (+Y), 180 = front (-Y); the face zone (front, level or below) is skipped above
    d = Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e))).normalized()
    if d.y < -0.35 and d.z < 0.55:
        continue
    rot = [math.degrees(x) for x in d.to_track_quat('Z', 'Y').to_euler()]
    b.cone("spike%d" % i, 0.072, 0.25, C + d * (R + 0.09), "body", iron, seg=8, rot=rot, bevel=0.012)
    b.torus("collar%d" % i, 0.085, 0.02, C + d * (R - 0.005), "body", dark, seg_major=10, seg_minor=5, rot=rot)

# --- chain anchor on the back --------------------------------------------------------------------------
b.rbox("anchor_plate", (0.2, 0.05, 0.2), C + Vector((0, R - 0.005, 0)), "anchor", dark, bevel=0.012, segs=2)
b.torus("shackle", 0.085, 0.024, C + Vector((0, R + 0.06, 0)), "anchor", brass, seg_major=16, seg_minor=7, rot=(0, 90, 0))

b.face_at = Vector((0, -0.45, 0.66))
b.face_r = 0.42

mesh = b.build_mesh()
b.bake(ao_samples=24)

# --- rig --------------------------------------------------------------------------------------------------
eL, pL, oL = eyes["L"]
eR, pR, oR = eyes["R"]
b.rig([
    ("root", (0, 0, 0), (0, 0, 0.15), None),
    ("body", (0, 0, 0.55), (0, 0, 1.05), "root"),
    ("jaw", (0, -0.18, 0.42), (0, -0.55, 0.42), "body"),
    ("anchor", (0, 0.45, 0.55), (0, 0.65, 0.55), "body"),
    ("eye_L", tuple(eL), tuple(eL + oL * 0.15), "body"),
    ("pupil_L", tuple(pL), tuple(pL + oL * 0.06), "eye_L"),
    ("eye_R", tuple(eR), tuple(eR + oR * 0.15), "body"),
    ("pupil_R", tuple(pR), tuple(pR + oR * 0.06), "eye_R"),
    ("brow_L", (-0.20, -0.34, 0.93), (-0.20, -0.46, 0.93), "body"),
    ("brow_R", (0.20, -0.34, 0.93), (0.20, -0.46, 0.93), "body"),
])

# --- clips ------------------------------------------------------------------------------------------------
with b.clip("idle", 48) as c:
    for f, z, roll, jaw in ((0, 0, 0, 0), (12, 0.012, 1.5, 2), (24, 0.025, 0, 5), (36, 0.012, -1.5, 2), (48, 0, 0, 0)):
        c.key(f, "body", loc=(0, 0, z), rot=(0, roll, 0))
        c.key(f, "jaw", rot=(jaw, 0, 0))
    for f, dx in ((0, 0), (10, 0.012), (22, -0.01), (34, 0.006), (48, 0)):
        c.key(f, "pupil_L", loc=(dx, 0, 0)); c.key(f, "pupil_R", loc=(dx, 0, 0))
    for f, br in ((0, 0), (24, -4), (48, 0)):
        c.key(f, "brow_L", rot=(br, 0, 0)); c.key(f, "brow_R", rot=(br, 0, 0))

with b.clip("telegraph_windup", 12) as c:
    c.key(0, "body", loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0))
    c.key(4, "body", loc=(0, 0.06, -0.03), scale=(1.06, 1.0, 0.92), rot=(0, 3, 0))
    c.key(8, "body", loc=(0, 0.11, -0.06), scale=(1.12, 1.0, 0.84), rot=(0, -3, 0))
    c.key(12, "body", loc=(0, 0.14, -0.07), scale=(1.14, 0.98, 0.82), rot=(-6, 0, 0))
    c.key(0, "jaw", rot=(0, 0, 0)); c.key(12, "jaw", rot=(42, 0, 0))
    for s in ("L", "R"):
        c.key(0, "brow_" + s, rot=(0, 0, 0)); c.key(12, "brow_" + s, rot=(-22, 0, 0))
        c.key(0, "pupil_" + s, scale=(1, 1, 1)); c.key(12, "pupil_" + s, scale=(0.7, 0.7, 0.7))

with b.clip("lunge", 12) as c:
    c.key(0, "body", loc=(0, 0.14, -0.07), scale=(1.14, 0.98, 0.82), rot=(-6, 0, 0))
    c.key(4, "body", loc=(0, -0.16, 0.06), scale=(0.84, 1.3, 0.9), rot=(8, 0, 0))
    c.key(8, "body", loc=(0, -0.08, 0.02), scale=(1.02, 0.96, 1.0), rot=(2, 0, 0))
    c.key(12, "body", loc=(0, -0.04, 0), scale=(1, 1, 1), rot=(0, 0, 0))
    c.key(0, "jaw", rot=(42, 0, 0)); c.key(4, "jaw", rot=(62, 0, 0)); c.key(7, "jaw", rot=(-3, 0, 0)); c.key(12, "jaw", rot=(0, 0, 0))
    for s in ("L", "R"):
        c.key(0, "brow_" + s, rot=(-22, 0, 0)); c.key(12, "brow_" + s, rot=(-12, 0, 0))
        c.key(0, "pupil_" + s, scale=(0.7, 0.7, 0.7)); c.key(12, "pupil_" + s, scale=(1, 1, 1))

with b.clip("recover", 29) as c:
    c.key(0, "body", loc=(0, -0.04, 0), scale=(1.06, 0.94, 1.04), rot=(0, 0, 0))
    c.key(7, "body", loc=(0, 0.02, -0.03), scale=(1.1, 0.9, 1.08), rot=(0, 4, 0))
    c.key(16, "body", loc=(0, -0.01, 0.015), scale=(0.97, 1.03, 0.98), rot=(0, -3, 0))
    c.key(29, "body", loc=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0))
    for f, j in ((0, 0), (3, 10), (6, 0), (9, 9), (12, 0), (15, 6), (18, 0), (29, 0)):
        c.key(f, "jaw", rot=(j, 0, 0))
    for s in ("L", "R"):
        c.key(0, "brow_" + s, rot=(-12, 0, 0)); c.key(29, "brow_" + s, rot=(0, 0, 0))

with b.clip("freed", 36) as c:
    for f, z, yaw, sq in ((0, 0, 0, (1, 1, 1)), (4, -0.05, 0, (1.1, 1.1, 0.85)), (10, 0.38, 120, (0.9, 0.9, 1.15)),
                          (16, 0, 240, (1.12, 1.12, 0.84)), (22, 0.30, 360, (0.92, 0.92, 1.1)), (28, 0, 360, (1.08, 1.08, 0.9)), (36, 0, 360, (1, 1, 1))):
        c.key(f, "body", loc=(0, 0, z), rot=(0, 0, yaw), scale=sq)
    for f, j in ((0, 0), (10, 32), (16, 20), (22, 34), (28, 12), (36, 6)):
        c.key(f, "jaw", rot=(j, 0, 0))
    for s in ("L", "R"):
        c.key(0, "brow_" + s, rot=(0, 0, 0)); c.key(8, "brow_" + s, rot=(18, 0, 0)); c.key(36, "brow_" + s, rot=(12, 0, 0))

b.notes.append("Runtime naturalHeight 1.10 m; model rest height is measured in bounds. Spikes/collars are part of the body bone.")
b.notes.append("Chain and post are SEPARATE assets (gnasher_post.glb, gnasher_link.glb) so the runtime can keep placing its own chain.")
finish(b, os.path.join(out, "gnasher.manifest.json"), idle_clip="idle",
       extra={"kind": "critter", "states": {"idle": "idle", "telegraph": "telegraph_windup", "attack": "lunge", "recover": "recover", "freed": "freed"}})
