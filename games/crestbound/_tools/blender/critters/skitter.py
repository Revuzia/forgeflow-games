"""SKITTER — four-winged dragonfly with a banded body (swooping flyer). Runtime natural height 0.60 m.
Clips: fly, swoop.  Bones: root, thorax, head, eye_L/R, pupil_L/R, abd1..abd5, wing_FL/FR/BL/BR."""
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
b = Builder("skitter", out, atlas=1024, height=0.6)

shell = b.mat("shell", mat_paint, base=(0.16, 0.42, 0.30), rough=0.35, chips=False, scale=10.0, bump=0.25)
band_y = b.mat("band_y", mat_paint, base=(0.95, 0.72, 0.12), rough=0.45, chips=False, scale=12.0, bump=0.2)
band_k = b.mat("band_k", mat_paint, base=(0.07, 0.08, 0.07), rough=0.5, chips=False, scale=12.0, bump=0.2)
white = b.mat("white", mat_flat, base=(0.97, 0.96, 0.92), rough=0.12)
pupil = b.mat("pupil", mat_flat, base=(0.03, 0.03, 0.05), rough=0.3)
chitin = b.mat("chitin", mat_flat, base=(0.10, 0.12, 0.09), rough=0.5, bump=0.1)
wing = b.mat("wing", mat_wing)

# thorax + head
T = Vector((0, -0.08, 0.38))
b.sphere("thorax", 0.17, T, "thorax", shell, seg=24, rings=16, scale=(1.0, 1.25, 0.95))
b.torus("collar", 0.13, 0.025, T + Vector((0, -0.20, 0)), "thorax", band_y, seg_major=20, seg_minor=6, rot=(90, 0, 0))
H = Vector((0, -0.31, 0.40))
b.sphere("head", 0.13, H, "head", shell, seg=22, rings=14)
eyes = {}
for side, sx in (("L", -1), ("R", 1)):
    ec = H + Vector((sx * 0.085, -0.06, 0.04))
    outv = ((ec - H).normalized() + Vector((0, -0.9, 0))).normalized()
    b.sphere("eye_" + side, 0.085, ec, "eye_" + side, white, seg=18, rings=12)
    pc = ec + outv * 0.064
    b.sphere("pupil_" + side, 0.036, pc, "pupil_" + side, pupil, seg=12, rings=8)
    eyes[side] = (ec, pc, outv)
    # antenna: bevelled tube + bead
    b.tube("antenna_" + side, [tuple(H + Vector((sx * 0.05, -0.08, 0.10))), tuple(H + Vector((sx * 0.10, -0.17, 0.20))), tuple(H + Vector((sx * 0.15, -0.21, 0.24)))],
           0.011, "head", chitin, seg=8)
    b.sphere("bead_" + side, 0.02, H + Vector((sx * 0.15, -0.21, 0.24)), "head", band_y, seg=10, rings=6)
# mandibles: two tiny fangs
for sx in (-1, 1):
    b.cone("fang_%d" % sx, 0.018, 0.05, H + Vector((sx * 0.04, -0.10, -0.08)), "head", chitin, seg=6, rot=(180, 0, 0))

# banded abdomen (5 segments, chained bones)
ABD = [(0.10, 0.125), (0.26, 0.108), (0.41, 0.09), (0.54, 0.075), (0.65, 0.06)]
for i, (y, r) in enumerate(ABD):
    m = band_y if i % 2 == 0 else band_k
    b.sphere("abd%d" % (i + 1), r, (0, y, 0.37 - i * 0.004), "abd%d" % (i + 1), m, seg=20, rings=12, scale=(1.0, 1.35, 0.95))
b.cone("stinger", 0.03, 0.10, (0, 0.77, 0.35), "abd5", chitin, seg=8, rot=(-90, 0, 0))

# wings: rounded slabs; pivots at the thorax sides, front pair raised more
def wing_outline(n=18):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 0.31 + 0.31 * math.cos(t)
        y = 0.075 * math.sin(t) * (0.55 + 0.45 * (x / 0.62))       # narrower root, rounded tip
        pts.append((x, y))
    return pts
WING = {}
for name, sx, y, raise_deg, sweep in (("wing_FR", 1, -0.12, 22, 8), ("wing_FL", -1, -0.12, 22, 8), ("wing_BR", 1, 0.00, 16, 20), ("wing_BL", -1, 0.00, 16, 20)):
    piv = Vector((sx * 0.11, y, 0.43))
    if sx > 0:
        rot = (0, -raise_deg, sweep)
    else:
        rot = (0, raise_deg, 180 - sweep)
    b.slab(name, wing_outline(), 0.006, piv, name, wing, rot=rot)
    R = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix()
    WING[name] = (piv, piv + R @ Vector((0.3, 0, 0)))
    # a chitin vein along the leading edge
    b.tube(name + "_vein", [tuple(piv + R @ Vector((0.0, 0.03, 0))), tuple(piv + R @ Vector((0.3, 0.06, 0))), tuple(piv + R @ Vector((0.58, 0.02, 0)))], 0.006, name, chitin, seg=8)

# six legs tucked under the thorax
for i, y in enumerate((-0.18, -0.08, 0.02)):
    for sx in (-1, 1):
        b.tube("leg_%d_%d" % (i, sx), [(sx * 0.07, y, 0.28), (sx * 0.19, y - 0.02, 0.16), (sx * 0.21, y - 0.05, 0.0)], 0.013, "thorax", chitin, seg=8)

b.face_at = Vector((0, -0.42, 0.40))
b.face_r = 0.26

b.build_mesh()
b.bake(ao_samples=24)

eL, pL, oL = eyes["L"]
eR, pR, oR = eyes["R"]
bones = [
    ("root", (0, 0, 0), (0, 0, 0.1), None),
    ("thorax", tuple(T), tuple(T + Vector((0, -0.18, 0))), "root"),
    ("head", tuple(H), tuple(H + Vector((0, -0.14, 0))), "thorax"),
    ("eye_L", tuple(eL), tuple(eL + oL * 0.08), "head"),
    ("pupil_L", tuple(pL), tuple(pL + oL * 0.03), "eye_L"),
    ("eye_R", tuple(eR), tuple(eR + oR * 0.08), "head"),
    ("pupil_R", tuple(pR), tuple(pR + oR * 0.03), "eye_R"),
]
prev = "thorax"
py = 0.02
for i, (y, r) in enumerate(ABD):
    nm = "abd%d" % (i + 1)
    nxt = ABD[i + 1][0] if i + 1 < len(ABD) else 0.78
    bones.append((nm, (0, py, 0.37), (0, (y + nxt) * 0.5 if i + 1 < len(ABD) else 0.78, 0.36), prev))
    py = (y + nxt) * 0.5 if i + 1 < len(ABD) else 0.78
    prev = nm
for nm, (h, t) in WING.items():
    bones.append((nm, tuple(h), tuple(t), "thorax"))
b.rig(bones)

def flap(c, f, up):
    """up: +deg raises every wing tip (right wings: -Y rotation; left wings: +Y rotation)."""
    for nm in ("wing_FR", "wing_BR"):
        c.key(f, nm, rot=(0, -up if nm == "wing_FR" else up * -0.9, 0))
    for nm in ("wing_FL", "wing_BL"):
        c.key(f, nm, rot=(0, up if nm == "wing_FL" else up * 0.9, 0))

# fly: 2 full flaps per 12 frames (8 Hz), rear pair ~half a beat behind via alternating amplitude
with b.clip("fly", 12) as c:
    for f, up in ((0, 28), (3, -26), (6, 28), (9, -26), (12, 28)):
        c.key(f, "wing_FR", rot=(0, -up, 0)); c.key(f, "wing_FL", rot=(0, up, 0))
    for f, up in ((0, -20), (3, 24), (6, -20), (9, 24), (12, -20)):
        c.key(f, "wing_BR", rot=(0, -up, 0)); c.key(f, "wing_BL", rot=(0, up, 0))
    for f, z in ((0, 0), (6, 0.02), (12, 0)):
        c.key(f, "root", loc=(0, 0, z))
    for f, a in ((0, 0), (6, -4), (12, 0)):
        for i in range(1, 6):
            c.key(f, "abd%d" % i, rot=(a * 0.6, 0, 0))
    for f, yaw in ((0, 0), (6, 4), (12, 0)):
        c.key(f, "head", rot=(0, 0, yaw))

# swoop: nose down, wings sweep back with a faster beat, tail curls, pull up
with b.clip("swoop_attack", 28) as c:
    for f, pitch in ((0, 0), (6, 34), (14, 30), (20, -14), (28, 0)):
        c.key(f, "thorax", rot=(pitch, 0, 0))
    for f, z in ((0, 0), (14, -0.10), (28, 0)):
        c.key(f, "root", loc=(0, 0, z))
    for f, a in ((0, 0), (8, -12), (16, -14), (22, 4), (28, 0)):
        for i in range(1, 6):
            c.key(f, "abd%d" % i, rot=(a, 0, 0))
    for f, hp in ((0, 0), (8, -14), (20, 6), (28, 0)):
        c.key(f, "head", rot=(hp, 0, 0))
    # sweep back (Z) + fast flap (Y)
    for f in range(0, 29, 2):
        up = 34 if (f // 2) % 2 == 0 else -30
        sweep = 30 * smooth01(f / 8.0) * (1 - smooth01((f - 18) / 8.0))
        c.key(f, "wing_FR", rot=(0, -up, sweep)); c.key(f, "wing_FL", rot=(0, up, -sweep))
        c.key(f, "wing_BR", rot=(0, up * 0.9, sweep * 0.8)); c.key(f, "wing_BL", rot=(0, -up * 0.9, -sweep * 0.8))

b.notes.append("Runtime naturalHeight 0.60 m; rest bounds include raised wings. Wings are a separate alpha-blended slot (skitter_wing).")
finish(b, os.path.join(out, "skitter.manifest.json"), idle_clip="fly",
       extra={"kind": "critter", "states": {"walk": "fly", "attack": "swoop_attack"}})
