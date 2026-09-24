"""DYEFIELD - TIDE-RUNNER hero (CONTRACT section 3.2), authored headless in Blender 5.1.

    python art/build.py hero                          # build, export art/gltf/tide_runner.glb, QA renders
    python art/build.py hero -- --no-render           # build + export + GLB self-check only
    python art/build.py hero -- --only turntable,clips,kit

Everything is procedural and deterministic (no random numbers anywhere).

Frames. Blender is Z-up; the runner faces -Y (arrives as glTF/three +Z); feet on z = 0.
Character left = +X (the .L side). Every bone rests with the SAME world-aligned orientation
(bone +Y = world +Z up, bone +Z = world -Y forward, roll 0), so every glTF joint has an identity
rest rotation and its local axes are x = character left, y = up, z = forward. A runtime rotation
about a joint's local X is a pitch (+ = bend forward), about local Y a yaw (+ = turn left).

Poses are authored as rotations in world axes relative to the parent (W), solved with our own
FK/IK in world space, and keyed as pose-bone quaternions q = R0^-1 W R0 (R0 = bone rest basis).
build_kits.py imports this module for its mesh/material/render helpers (main() only runs as a script).
"""
import bpy
import math
import os
import sys
import json
import struct
import time
from math import sin, cos, pi, sqrt, atan2, acos, radians
from mathutils import Vector, Matrix, Quaternion

T0 = time.time()


def log(*a):
    print("[hero %6.1fs]" % (time.time() - T0), *a, flush=True)


HERE = os.path.dirname(os.path.abspath(__file__))
ART = os.path.dirname(HERE)
GLTF_DIR = os.path.join(ART, "gltf")
REN_DIR = os.path.join(ART, "renders")
ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg_flag(name):
    return name in ARGV


def arg_val(name, default=None):
    if name in ARGV:
        i = ARGV.index(name)
        if i + 1 < len(ARGV):
            return ARGV[i + 1]
    return default


# ================================================================================ math helpers
def clamp(x, a, b):
    return a if x < a else (b if x > b else x)


def lerp(a, b, t):
    return a + (b - a) * t


def sstep(e0, e1, x):
    """smoothstep from e0 to e1 (works with e0 > e1)."""
    if e1 == e0:
        return 0.0 if x < e0 else 1.0
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def se(t, p):
    """signed superellipse power: sign(t)|t|^(2/p)."""
    return math.copysign(abs(t) ** (2.0 / p), t)


def wrap_pi(a):
    while a > pi:
        a -= 2 * pi
    while a <= -pi:
        a += 2 * pi
    return a


def _cr(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def table(keys, x):
    """Catmull-Rom through (x, value-or-tuple) keys, clamped at the ends."""
    if x <= keys[0][0]:
        return keys[0][1]
    if x >= keys[-1][0]:
        return keys[-1][1]
    i = 0
    while keys[i + 1][0] < x:
        i += 1
    x0, x1 = keys[i][0], keys[i + 1][0]
    t = (x - x0) / (x1 - x0)
    k0 = keys[i - 1][1] if i > 0 else keys[i][1]
    k1, k2 = keys[i][1], keys[i + 1][1]
    k3 = keys[i + 2][1] if i + 2 < len(keys) else keys[i + 1][1]
    if isinstance(k1, (tuple, list)):
        return tuple(_cr(k0[c], k1[c], k2[c], k3[c], t) for c in range(len(k1)))
    return _cr(k0, k1, k2, k3, t)


def spline_pts(pts, s):
    """uniform Catmull-Rom through a list of Vectors, s in [0, 1]."""
    n = len(pts) - 1
    f = clamp(s, 0.0, 1.0) * n
    i = min(int(f), n - 1)
    t = f - i
    p0 = pts[i - 1] if i > 0 else pts[i] * 2 - pts[i + 1]
    p3 = pts[i + 2] if i + 2 <= n else pts[i + 1] * 2 - pts[i]
    return Vector(tuple(_cr(p0[c], pts[i][c], pts[i + 1][c], p3[c], t) for c in range(3)))


def hex_lin(h):
    h = h.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def any_perp(a):
    t = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 1, 0))
    return (t - a * a.dot(t)).normalized()


def frame_from(A, hint):
    """U, V with U x V = A (A unit); U as close to hint as possible."""
    U = hint - A * A.dot(hint)
    if U.length < 1e-6:
        U = any_perp(A)
    U.normalize()
    V = A.cross(U)
    return U, V


# ================================================================================ mesh builder
WHITE = (1.0, 1.0, 1.0, 1.0)


def gray(v, a=1.0):
    return (v, v, v, a)


class MB:
    """Accumulates vertices (+ bone weights + color) and faces (+ material) for one Blender mesh."""

    def __init__(self, name):
        self.name = name
        self.V, self.W, self.C = [], [], []
        self.F, self.M = [], []
        self.parts = []          # (label, first_face, first_vert)

    def begin(self, label):
        self.parts.append((label, len(self.F), len(self.V)))

    def v(self, p, w, c=None):
        self.V.append((float(p[0]), float(p[1]), float(p[2])))
        self.W.append(w if isinstance(w, dict) else {w: 1.0})
        self.C.append(c if c is not None else WHITE)
        return len(self.V) - 1

    def f(self, idx, mat):
        self.F.append(tuple(idx))
        self.M.append(mat)

    def tris(self, f0=0, f1=None):
        return sum(len(f) - 2 for f in self.F[f0:f1])

    def part_report(self):
        out = []
        for k, (label, f0, v0) in enumerate(self.parts):
            f1 = self.parts[k + 1][1] if k + 1 < len(self.parts) else len(self.F)
            out.append((label, self.tris(f0, f1), self.signed_volume(f0, f1)))
        return out

    def signed_volume(self, f0=0, f1=None):
        vol = 0.0
        for f in self.F[f0:f1]:
            a = Vector(self.V[f[0]])
            for k in range(1, len(f) - 1):
                b, c = Vector(self.V[f[k]]), Vector(self.V[f[k + 1]])
                vol += a.dot(b.cross(c)) / 6.0
        return vol


def grid(mb, rows, mat, wrap=True, close_rows=False):
    """rows: list of rings (lists of vertex indices). Faces (a, b, c, d) = ring i -> i+1; outward when
    each ring runs counter-clockwise about the direction of increasing i."""
    R = len(rows)
    C = len(rows[0])
    for i in range(R - 1 + (1 if close_rows else 0)):
        r0, r1 = rows[i], rows[(i + 1) % R]
        for j in range(C if wrap else C - 1):
            j2 = (j + 1) % C
            m = mat(i, j) if callable(mat) else mat
            mb.f((r0[j], r0[j2], r1[j2], r1[j]), m)


def fan(mb, pole, ring, mat, start):
    C = len(ring)
    for j in range(C):
        j2 = (j + 1) % C
        m = mat(j) if callable(mat) else mat
        if start:
            mb.f((pole, ring[j2], ring[j]), m)
        else:
            mb.f((pole, ring[j], ring[j2]), m)


def tube(mb, pts, radii, n, wfn, mat, hint=Vector((0, -1, 0)), cap0=None, cap1=None, colfn=None,
         phase=0.0, ex=2.0, flip=False, closed_path=False, frames=None):
    """Loft rings along a polyline. radii[i] = r or (ru, rv). cap0/cap1: pole point (Vector),
    'flat' (centroid fan) or None. wfn(i, j, p) -> weights; mat: name or fn(i, j)."""
    rows = []
    U = None
    npt = len(pts)
    for i, c in enumerate(pts):
        if frames is not None:
            U, V, A = frames[i]
        else:
            if closed_path:
                A = (pts[(i + 1) % npt] - pts[(i - 1) % npt]).normalized()
            elif i == 0:
                A = (pts[1] - pts[0]).normalized()
            elif i == npt - 1:
                A = (pts[-1] - pts[-2]).normalized()
            else:
                A = (pts[i + 1] - pts[i - 1]).normalized()
            U, V = frame_from(A, hint if U is None else U)
        r = radii[i]
        ru, rv = (r, r) if not isinstance(r, (tuple, list)) else r
        ring = []
        for j in range(n):
            ph = 2 * pi * j / n + phase
            p = c + U * (ru * se(cos(ph), ex)) + V * (rv * se(sin(ph), ex))
            ring.append(mb.v(p, wfn(i, j, p), colfn(i, j, p) if colfn else None))
        if flip:
            ring.reverse()
        rows.append(ring)
    grid(mb, rows, mat, close_rows=closed_path)
    ends = []
    for which, cap, ring in ((0, cap0, rows[0]), (1, cap1, rows[-1])):
        if cap is None:
            continue
        if isinstance(cap, str):
            cen = sum((Vector(mb.V[k]) for k in ring), Vector()) / len(ring)
        else:
            cen = cap
        pole = mb.v(cen, wfn(0 if which == 0 else npt - 1, 0, cen),
                    colfn(0 if which == 0 else npt - 1, 0, cen) if colfn else None)
        m = mat(0 if which == 0 else npt - 2, 0) if callable(mat) else mat
        fan(mb, pole, ring, m, start=(which == 0) != flip)
        ends.append(pole)
    return rows


def blob(mb, center, A, Uh, ra, ru, rv, nu, nv, w, mat, e_ring=2.0, e_prof=2.0, colfn=None):
    """superellipsoid with its poles on axis A (unit); ring starts toward Uh."""
    U, V = frame_from(A, Uh)
    rows = []
    for i in range(1, nv):
        t = -pi / 2 + pi * i / nv
        rf = abs(cos(t)) ** (2.0 / e_prof)
        ax = se(sin(t), e_prof) * ra
        ring = []
        for j in range(nu):
            ph = 2 * pi * j / nu
            p = center + A * ax + U * (rf * ru * se(cos(ph), e_ring)) + V * (rf * rv * se(sin(ph), e_ring))
            ring.append(mb.v(p, w if not callable(w) else w(p), colfn(p) if colfn else None))
        rows.append(ring)
    grid(mb, rows, mat)
    for k, sgn in ((0, -1), (1, 1)):
        p = center + A * (ra * sgn)
        pole = mb.v(p, w if not callable(w) else w(p), colfn(p) if colfn else None)
        fan(mb, pole, rows[0] if k == 0 else rows[-1], mat, start=(k == 0))
    return rows


def surface_tube(mb, pts, nrms, half_w, half_h, n, wfn, mat, closed=True, colfn=None, lift=0.0):
    """Flattened tube lying ON a surface along pts (surface normals nrms): width half_w across the
    surface, thickness half_h along the normal. Used for trims, straps, bands."""
    frames = []
    npt = len(pts)
    centers = []
    for i in range(npt):
        if closed:
            A = (pts[(i + 1) % npt] - pts[(i - 1) % npt]).normalized()
        elif i == 0:
            A = (pts[1] - pts[0]).normalized()
        elif i == npt - 1:
            A = (pts[-1] - pts[-2]).normalized()
        else:
            A = (pts[i + 1] - pts[i - 1]).normalized()
        N = nrms[i] - A * A.dot(nrms[i])
        N.normalize()
        U, V = N, A.cross(N)
        frames.append((U, V, A))
        centers.append(pts[i] + nrms[i] * lift)
    return tube(mb, centers, [(half_h, half_w)] * npt, n, wfn, mat, closed_path=closed, frames=frames,
                colfn=colfn)


# ================================================================================ materials
# name: (hex, roughness, metallic, alpha)
HERO_MATS = {
    "M_skin": ("#F7C4A0", 0.55, 0.0, 1.0),
    "M_hair": ("#333A5C", 0.40, 0.0, 1.0),
    "M_crest": ("#F2F2F2", 0.32, 0.0, 1.0),
    "M_eye_white": ("#FFFFFF", 0.12, 0.0, 1.0),
    "M_eye_dark": ("#2D4E96", 0.10, 0.0, 1.0),
    "M_mouth": ("#8E2F43", 0.45, 0.0, 1.0),
    "M_top": ("#F7F8FB", 0.70, 0.0, 1.0),
    "M_top_trim": ("#F0F0F0", 0.55, 0.0, 1.0),
    "M_shorts": ("#2B3144", 0.62, 0.0, 1.0),
    "M_shorts_stripe": ("#F0F0F0", 0.55, 0.0, 1.0),
    "M_shoe": ("#F5F6F8", 0.48, 0.0, 1.0),
    "M_sole": ("#EDEDED", 0.42, 0.0, 1.0),
    "M_band": ("#F0F0F0", 0.60, 0.0, 1.0),
    "M_tank_shell": ("#E4E9F0", 0.30, 0.0, 1.0),
    "M_glass": ("#FFFFFF", 0.03, 0.0, 0.06),
    "M_tank_dye": ("#F2F2F2", 0.08, 0.0, 1.0),
}
TEAM_MATS = ["M_crest", "M_top_trim", "M_shorts_stripe", "M_sole", "M_tank_dye", "M_band", "M_kit_dye"]
TEAM_DYE = {1: "#FF8A1F", 2: "#5B4BF0"}


def make_material(name, hexc, rough, metal=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    out = next((n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'), None)
    if bsdf is None:
        bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    if out is None:
        out = nt.nodes.new('ShaderNodeOutputMaterial')
    if not out.inputs['Surface'].is_linked:
        nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    lin = hex_lin(hexc)
    bsdf.inputs['Base Color'].default_value = (lin[0], lin[1], lin[2], 1.0)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Alpha'].default_value = alpha
    if alpha < 1.0:
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
        try:
            m.blend_method = 'BLEND'
        except Exception:
            pass
    m.diffuse_color = (lin[0], lin[1], lin[2], alpha)
    m.use_backface_culling = True
    m["_base"] = list(lin)      # remembered for render tints (removed before export)
    return m


def strip_material_props():
    for m in bpy.data.materials:
        if "_base" in m.keys():
            del m["_base"]


def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def render_materials(team, base_cache):
    """For QA renders only (after export): multiply the vertex color in and tint team materials."""
    dye = hex_lin(TEAM_DYE[team]) if team else (1, 1, 1)
    for m in bpy.data.materials:
        if not m.node_tree or not m.name.startswith("M_"):
            continue
        b = principled(m)
        if m.name not in base_cache:
            c = b.inputs['Base Color'].default_value
            base_cache[m.name] = (c[0], c[1], c[2])
        base = base_cache[m.name]
        is_team = any(m.name == t or m.name.startswith(t + ".") for t in TEAM_MATS)
        col = tuple(base[i] * (dye[i] if is_team else 1.0) for i in range(3))
        nt = m.node_tree
        mix = nt.nodes.get("QA_MIX")
        if mix is None:
            vc = nt.nodes.new('ShaderNodeVertexColor')
            vc.name = "QA_VC"
            vc.layer_name = "Col"
            mix = nt.nodes.new('ShaderNodeMix')
            mix.name = "QA_MIX"
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs['Factor'].default_value = 1.0
            nt.links.new(vc.outputs['Color'], mix.inputs[7])
            nt.links.new(mix.outputs[2], b.inputs['Base Color'])
        mix.inputs[6].default_value = (col[0], col[1], col[2], 1.0)


# ================================================================================ skeleton
A_DEG = 55.0                                   # A-pose: arms 55 deg below horizontal
_ca, _sa = cos(radians(A_DEG)), sin(radians(A_DEG))
ARM_L1, ARM_L2 = 0.135, 0.125                  # upper arm, forearm
LEG_L1, LEG_L2 = 0.160, 0.130                  # thigh, shin


def _arm(s):
    sh = Vector((0.135 * s, 0.004, 0.642))
    d = Vector((_ca * s, 0.0, -_sa))
    return sh, sh + d * ARM_L1, sh + d * (ARM_L1 + ARM_L2), d


def _leg(s):
    hip = Vector((0.077 * s, 0.006, 0.375))
    ank = Vector((0.088 * s, 0.006, 0.085))
    d = (ank - hip).normalized()
    knee = hip + d * LEG_L1
    ank = hip + d * (LEG_L1 + LEG_L2)
    return hip, knee, ank, d


HEAD_C = Vector((0.0, 0.0, 0.935))
REST = {
    "root": Vector((0, 0, 0)),
    "hips": Vector((0, 0.006, 0.400)),
    "spine": Vector((0, 0.004, 0.470)),
    "chest": Vector((0, 0.0, 0.555)),
    "neck": Vector((0, 0.004, 0.690)),
    "head": Vector((0, 0.0, 0.760)),
    "tank": Vector((0, 0.158, 0.440)),
}
for _s, _n in ((1, "L"), (-1, "R")):
    _sh, _el, _wr, _d = _arm(_s)
    REST["shoulder." + _n] = Vector((0.035 * _s, 0.004, 0.655))
    REST["upper_arm." + _n] = _sh
    REST["forearm." + _n] = _el
    REST["hand." + _n] = _wr
    _hp, _kn, _an, _ld = _leg(_s)
    REST["thigh." + _n] = _hp
    REST["shin." + _n] = _kn
    REST["foot." + _n] = _an
    REST["toe." + _n] = Vector((_an.x + 0.002 * _s, -0.080, 0.030))
ARM_DIR = {"L": _arm(1)[3], "R": _arm(-1)[3]}
LEG_DIR = {"L": _leg(1)[3], "R": _leg(-1)[3]}

PARENT = {
    "root": None, "hips": "root", "spine": "hips", "chest": "spine", "neck": "chest", "head": "neck",
    "crest_1": "head", "crest_2": "crest_1", "crest_3": "crest_2", "tank": "chest",
    "shoulder.L": "chest", "upper_arm.L": "shoulder.L", "forearm.L": "upper_arm.L", "hand.L": "forearm.L",
    "shoulder.R": "chest", "upper_arm.R": "shoulder.R", "forearm.R": "upper_arm.R", "hand.R": "forearm.R",
    "thigh.L": "hips", "shin.L": "thigh.L", "foot.L": "shin.L", "toe.L": "foot.L",
    "thigh.R": "hips", "shin.R": "thigh.R", "foot.R": "shin.R", "toe.R": "foot.R",
}
BONES = ["root", "hips", "spine", "chest", "neck", "head", "crest_1", "crest_2", "crest_3",
         "shoulder.L", "upper_arm.L", "forearm.L", "hand.L", "shoulder.R", "upper_arm.R", "forearm.R", "hand.R",
         "thigh.L", "shin.L", "foot.L", "toe.L", "thigh.R", "shin.R", "foot.R", "toe.R", "tank"]
ORDER = ["root", "hips", "spine", "chest", "neck", "head", "crest_1", "crest_2", "crest_3", "tank",
         "shoulder.L", "upper_arm.L", "forearm.L", "hand.L", "shoulder.R", "upper_arm.R", "forearm.R", "hand.R",
         "thigh.L", "shin.L", "foot.L", "toe.L", "thigh.R", "shin.R", "foot.R", "toe.R"]
UPPER = ["spine", "chest", "neck", "head", "shoulder.L", "upper_arm.L", "forearm.L", "hand.L",
         "shoulder.R", "upper_arm.R", "forearm.R", "hand.R"]

# bone rest basis in armature space: columns = bone X, Y, Z = world X, Z, -Y
R0 = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
QR0 = R0.to_quaternion()
QR0i = QR0.inverted()


def wn(d):
    """normalize a weight dict to <= 4 influences summing to 1."""
    items = sorted(((k, v) for k, v in d.items() if v > 1e-4), key=lambda kv: -kv[1])[:4]
    s = sum(v for _, v in items) or 1.0
    return {k: v / s for k, v in items}


# ================================================================================ head + face
HRX, HRY_F, HRY_B, HRZ_T, HRZ_B = 0.200, 0.178, 0.192, 0.188, 0.172


def head_local(az, el):
    ce, sel = cos(el), sin(el)
    sa, ca = sin(az), cos(az)
    low = sstep(0.0, 1.0, -sel)
    front = sstep(-0.25, 0.6, ca)
    rx = HRX * (1.0 - 0.17 * low * low) * (1.0 + 0.035 * front * sstep(0.0, 0.5, -sel) * (1 - low))
    ry = lerp(HRY_B, HRY_F * (1.0 - 0.06 * low), sstep(-0.3, 0.3, ca))
    rz = lerp(HRZ_B, HRZ_T, sstep(-0.2, 0.2, sel))
    return Vector((rx * ce * sa, -ry * ce * ca, rz * sel))


def head_nrm(az, el):
    lim = pi / 2 - 2e-3
    e = clamp(el, -lim, lim)
    h = 1e-4
    du = head_local(az + h, e) - head_local(az - h, e)
    dv = head_local(az, e + h) - head_local(az, e - h)
    n = du.cross(dv)
    if n.length < 1e-12:
        return head_local(az, el).normalized()
    return n.normalized()


def head_pt(az, el, off=0.0):
    p = HEAD_C + head_local(az, el)
    if off:
        p = p + head_nrm(az, el) * off
    return p


def build_head(mb):
    mb.begin("head")
    NU, NV = 30, 16
    rows = []
    for i in range(1, NV):
        el = -pi / 2 + pi * i / NV
        rows.append([mb.v(head_pt(2 * pi * j / NU, el), "head") for j in range(NU)])
    grid(mb, rows, "M_skin")
    fan(mb, mb.v(head_pt(0, -pi / 2), "head"), rows[0], "M_skin", True)
    fan(mb, mb.v(head_pt(0, pi / 2), "head"), rows[-1], "M_skin", False)


def head_decal(mb, az0, el0, bfn, off, dome, mat, colfn=None, na=20, nr=3, skirt=0.004, label=None):
    """A thin domed patch conforming to the head: boundary bfn(ph) -> (d_az, d_el) radians."""
    if label:
        mb.begin(label)
    ca = max(cos(el0), 0.2)

    def P(r, ph, o):
        du, dv = bfn(ph)
        return head_pt(az0 + r * du / ca, el0 + r * dv, o)

    def col(r, ph):
        if not colfn:
            return None
        du, dv = bfn(ph)
        return colfn(r * cos(ph), r * sin(ph), r)

    cen = mb.v(head_pt(az0, el0, off + dome), "head", colfn(0, 0, 0) if colfn else None)
    rings = []
    for k in range(1, nr + 1):
        r = k / nr
        rings.append([mb.v(P(r, 2 * pi * j / na, off + dome * (1 - r * r)), "head", col(r, 2 * pi * j / na))
                      for j in range(na)])
    sk = [mb.v(P(1.0, 2 * pi * j / na, off - skirt), "head", col(1.0, 2 * pi * j / na)) for j in range(na)]
    for j in range(na):
        j2 = (j + 1) % na
        mb.f((cen, rings[0][j], rings[0][j2]), mat)
    for ring_a, ring_b in zip(rings + [], rings[1:] + [sk]):
        for j in range(na):
            j2 = (j + 1) % na
            mb.f((ring_a[j], ring_b[j], ring_b[j2], ring_a[j2]), mat)


def ellipse(a, b):
    return lambda ph: (a * cos(ph), b * sin(ph))


def build_face(mb):
    for s, side in ((1, "L"), (-1, "R")):
        az = 0.375 * s
        el = -0.07
        # eye white (tall anime oval, slightly squared at the top)
        head_decal(mb, az, el, lambda ph: (0.128 * cos(ph), (0.172 if sin(ph) > 0 else 0.160) * sin(ph)),
                   0.0012, 0.0035, "M_eye_white", na=18, nr=2, label="eye_white." + side)
        # iris: dark top -> bright blue bottom (vertex gradient)
        head_decal(mb, az - 0.012 * s, el - 0.018, ellipse(0.100, 0.145), 0.0040, 0.0036, "M_eye_dark",
                   colfn=lambda u, v, r: gray(lerp(0.30, 1.0, sstep(0.55, -0.85, v)) * (1.0 - 0.12 * r)),
                   na=18, nr=3, label="iris." + side)
        # pupil
        head_decal(mb, az - 0.012 * s, el - 0.004, ellipse(0.046, 0.074), 0.0068, 0.0030, "M_eye_dark",
                   colfn=lambda u, v, r: gray(0.10), na=12, nr=1, label="pupil." + side)
        # highlights (same side on both eyes -> one consistent key light)
        head_decal(mb, az - 0.045, el + 0.055, ellipse(0.036, 0.040), 0.0092, 0.0012, "M_eye_white",
                   na=10, nr=1, label="glint1." + side)
        head_decal(mb, az + 0.040, el - 0.080, ellipse(0.018, 0.020), 0.0092, 0.0010, "M_eye_white",
                   na=8, nr=1, label="glint2." + side)
        # upper lash line: a bold arc hugging the top of the eye with a flick at the outer corner
        mb.begin("lash." + side)
        pts, nrm = [], []
        for k in range(11):
            t = k / 10.0
            ph = lerp(pi * 0.93, pi * 0.07, t) if s > 0 else lerp(pi * 0.07, pi * 0.93, t)
            ph_n = pi - ph if s > 0 else ph              # 0 = inner side .. pi = outer side for both eyes
            du = 0.136 * cos(ph)
            dv = 0.176 * sin(ph)
            outer = sstep(0.55, 1.0, ph_n / pi)
            du += 0.020 * outer * s * (1 if cos(ph) * s > 0 else 0)
            dv += 0.010 * outer
            a_, e_ = az + du / cos(el), el + dv
            pts.append(head_pt(a_, e_, 0.0))
            nrm.append(head_nrm(a_, e_))
        widths = [0.004 + 0.007 * sin(pi * k / 10.0) ** 0.6 for k in range(11)]
        _lash(mb, pts, nrm, widths)
        # brow: short thick arc
        mb.begin("brow." + side)
        pts, nrm = [], []
        for k in range(5):
            t = k / 4.0
            a_ = az + (t - 0.5) * 0.20 * s + 0.01 * s
            e_ = el + 0.300 + 0.030 * sin(pi * t) - 0.02 * t
            pts.append(head_pt(a_, e_, 0.0))
            nrm.append(head_nrm(a_, e_))
        surface_tube(mb, pts, nrm, 0.0065, 0.0035, 4, lambda i, j, p: "head", "M_hair", closed=False,
                     lift=0.0028)
        # rosy cheek
        head_decal(mb, 0.64 * s, -0.30, ellipse(0.085, 0.050), 0.0010, 0.0015, "M_skin",
                   colfn=lambda u, v, r: (1.0, 0.64, 0.64, 1.0), na=12, nr=1, label="cheek." + side)
        # ear (a soft domed bump)
        head_decal(mb, 1.53 * s, -0.10, ellipse(0.13, 0.19), 0.0, 0.028, "M_skin",
                   colfn=lambda u, v, r: gray(lerp(0.9, 1.0, r)), na=12, nr=2, skirt=0.006, label="ear." + side)
    # mouth: a small open smile (D shape, corners up)
    a, b, c = 0.080, 0.070, 0.018

    def mouth_b(ph):
        x = a * cos(ph)
        cc = c * cos(ph) ** 2
        return (x, cc + (0.10 * b * sin(ph) if sin(ph) > 0 else b * sin(ph)))
    head_decal(mb, 0.0, -0.405, mouth_b, 0.0012, 0.0010, "M_mouth",
               colfn=lambda u, v, r: gray(lerp(1.0, 0.72, sstep(0.0, 1.0, r))), na=16, nr=1, label="mouth")
    # tiny nose dot
    head_decal(mb, 0.0, -0.215, ellipse(0.028, 0.022), 0.0, 0.0045, "M_skin",
               colfn=lambda u, v, r: gray(0.95), na=8, nr=1, label="nose")


def _lash(mb, pts, nrm, widths):
    """tapered flat stroke on the head surface (open ends pointed)."""
    n = len(pts)
    top, bot, tb, bb = [], [], [], []
    for i in range(n):
        A = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        N = nrm[i]
        side = N.cross(A).normalized()
        w = widths[i]
        base = pts[i] + N * 0.0042
        top.append(mb.v(base + side * w * 0.35 + N * 0.0012, "head", gray(0.12)))
        bot.append(mb.v(base - side * w * 0.65 + N * 0.0012, "head", gray(0.12)))
        tb.append(mb.v(base + side * w * 0.35 - N * 0.006, "head", gray(0.12)))
        bb.append(mb.v(base - side * w * 0.65 - N * 0.006, "head", gray(0.12)))
    for i in range(n - 1):
        mb.f((top[i], bot[i], bot[i + 1], top[i + 1]), "M_eye_dark")       # face (+N)
        mb.f((top[i], top[i + 1], tb[i + 1], tb[i]), "M_eye_dark")         # upper wall (+side)
        mb.f((bot[i], bb[i], bb[i + 1], bot[i + 1]), "M_eye_dark")         # lower wall (-side)
    mb.f((top[0], tb[0], bb[0], bot[0]), "M_eye_dark")                     # start cap (-A)
    mb.f((top[-1], bot[-1], bb[-1], tb[-1]), "M_eye_dark")                 # end cap (+A)


# ================================================================================ hair + crest
HAIRLINE = [(0.0, 0.46), (0.55, 0.44), (0.95, 0.34), (1.18, 0.06), (1.30, -0.20), (1.42, -0.05),
            (1.62, 0.04), (1.92, -0.08), (2.35, -0.34), (2.80, -0.50), (pi, -0.56)]
BANG_TIPS = [-0.97, -0.60, -0.23, 0.23, 0.60, 0.97]
NAPE_TIPS = [pi - 0.42, pi, -pi + 0.42]


def hairline(az):
    a = wrap_pi(az)
    el = table(HAIRLINE, abs(a))
    sp = 0.0
    for t in BANG_TIPS:
        sp = max(sp, max(0.0, 1.0 - abs(a - t) / 0.19) ** 1.4)
    el -= 0.17 * sp
    np_ = 0.0
    for t in NAPE_TIPS:
        np_ = max(np_, max(0.0, 1.0 - abs(wrap_pi(a - t)) / 0.21) ** 1.4)
    el -= 0.10 * np_
    return el


def hair_off(az, el):
    top = max(0.0, sin(el)) ** 0.8
    back = max(0.0, -cos(az)) * max(0.0, cos(el * 0.8))
    return 0.023 + 0.024 * top + 0.018 * back


def hair_columns():
    cols = set()
    for k in range(28):
        cols.add(round(wrap_pi(-pi + 2 * pi * k / 28), 5))
    k = -1.14
    while k <= 1.14:
        cols.add(round(k, 5))
        k += 0.076
    for t in BANG_TIPS + NAPE_TIPS:
        cols.add(round(wrap_pi(t), 5))
    out = sorted(cols)
    ded = [out[0]]
    for c in out[1:]:
        if c - ded[-1] > 0.02:
            ded.append(c)
    return ded


HAIR_T = [0.0, 0.05, 0.20, 0.42, 0.66, 0.88]


def build_hair(mb):
    mb.begin("hair")
    cols = hair_columns()
    rows = [[] for _ in range(len(HAIR_T) + 1)]
    for az in cols:
        e0 = hairline(az)
        for ti, t in enumerate(HAIR_T):
            el = e0 + (pi / 2 - e0) * t
            o = hair_off(az, el) * (0.55 if ti == 0 else (0.86 if ti == 1 else 1.0))
            # soft sheen band: slightly lighter around the crown
            c = gray(lerp(0.66, 1.0, sstep(0.35, 0.72, sin(el)) * (1 - sstep(0.86, 0.99, sin(el)))))
            rows[ti + 1].append(mb.v(head_pt(az, el, o), "head", c))
        rows[0].append(mb.v(head_pt(az, e0, -0.004), "head", gray(0.7)))
    grid(mb, rows, "M_hair")
    top = mb.v(head_pt(0, pi / 2, hair_off(0, pi / 2)), "head", gray(0.9))
    fan(mb, top, rows[-1], "M_hair", False)


# swept locks that break the helmet silhouette: (az, el, sweep dir (world), length, width)
HAIR_SPIKES = [
    (2.05, 0.30, (0.10, 1.0, 0.02), 0.095, 0.036),
    (2.35, -0.02, (0.20, 1.0, -0.40), 0.100, 0.036),
    (2.78, -0.30, (0.10, 0.75, -1.0), 0.080, 0.034),
]


def build_hair_spikes(mb):
    mb.begin("hair_spikes")
    for az0, el, sw, L, r in HAIR_SPIKES:
        for s in (1, -1):
            az = az0 * s
            n = head_nrm(az, el)
            d = Vector((sw[0] * s, sw[1], sw[2]))
            d = (d - n * n.dot(d)).normalized()          # tangent sweep: the lock lies on the hair
            base = head_pt(az, el, hair_off(az, el) - 0.020)
            p1 = base + n * 0.012 + d * (L * 0.30)
            p2 = p1 + (d * 0.92 + n * 0.08).normalized() * (L * 0.38)
            p3 = p2 + (d * 0.9 + n * 0.1 + Vector((0, 0, -0.12))).normalized() * (L * 0.34)
            tube(mb, [base, p1, p2], [(r * 0.40, r), (r * 0.36, r * 0.86), (r * 0.22, r * 0.50)], 6,
                 lambda i, j, p: "head", "M_hair", hint=n, cap1=p3,
                 colfn=lambda i, j, p: gray(lerp(0.8, 1.0, i / 2.0)))


# crest: side-view top edge (y, z) - a wave-like fin sweeping from the brow over the crown to a swept tip
CREST_TOP = [(-0.198, 1.048), (-0.222, 1.108), (-0.196, 1.162), (-0.118, 1.186), (-0.010, 1.203),
             (0.105, 1.224), (0.212, 1.246), (0.312, 1.252), (0.262, 1.178), (0.228, 1.066),
             (0.207, 0.948), (0.182, 0.852)]
CREST_W = [(0.0, 0.020), (0.15, 0.028), (0.38, 0.038), (0.60, 0.037), (0.82, 0.028), (1.0, 0.020)]
CREST_H = [0.0, 0.20, 0.40, 0.58, 0.74, 0.87, 0.955, 1.0]
PSI0, PSI1 = 0.56, 3.66


def crest_base(s):
    psi = lerp(PSI0, PSI1, s)
    if psi <= pi / 2:
        az, el = 0.0, psi
    else:
        az, el = pi, pi - psi
    return head_pt(az, el, hair_off(az, el) - 0.014)


def crest_top(s):
    return spline_pts([Vector((0.0, y, z)) for y, z in CREST_TOP], s)


def crest_point(s, h, side, base_fn=None, top_fn=None):
    """side in {-1, 0, +1} (x offset direction); h in [0, 1]."""
    B = (base_fn or crest_base)(s)
    T = (top_fn or crest_top)(s)
    C = B.lerp(T, h)
    w = table(CREST_W, s) * (max(0.0, 1.0 - h) ** 0.62) * (1.0 + 0.18 * sin(pi * min(h, 1.0)) * (1 - h))
    return C + Vector((w * side, 0.0, 0.0))


def crest_weight(s, h):
    wc1 = 1.0 - sstep(0.20, 0.38, s)
    wc3 = sstep(0.50, 0.66, s)
    wc2 = max(0.0, 1.0 - wc1 - wc3)
    head = 1.0 - sstep(0.06, 0.34, h)
    k = 1.0 - head
    return wn({"head": head, "crest_1": wc1 * k, "crest_2": wc2 * k, "crest_3": wc3 * k})


def build_crest(mb, wfn=crest_weight, xform=None, ns=20, label="crest", base_fn=None, top_fn=None):
    mb.begin(label)
    rows = []
    H = CREST_H
    for i in range(ns + 1):
        s = i / ns
        ring = []
        # ring runs: right side up (x<0), top, left side down -> CCW about +s (backward)
        seq = [(h, -1) for h in H[:-1]] + [(1.0, 0)] + [(h, 1) for h in reversed(H[:-1])]
        for h, side in seq:
            p = crest_point(s, h, side, base_fn, top_fn)
            if xform:
                p = xform(p)
            c = gray(lerp(0.80, 1.0, sstep(0.0, 0.85, h)))
            ring.append(mb.v(p, wfn(s, h), c))
        rows.append(ring)
    grid(mb, rows, "M_crest")
    for k, (ring, sgn) in enumerate(((rows[0], -1), (rows[-1], 1))):
        cen = sum((Vector(mb.V[q]) for q in ring), Vector()) / len(ring)
        s = 0.0 if k == 0 else 1.0
        ax = (crest_point(min(s + 0.02, 1), 0.3, 0, base_fn, top_fn) -
              crest_point(max(s - 0.02, 0), 0.3, 0, base_fn, top_fn)).normalized()
        if xform:
            pass
        pole = mb.v(cen + ax * (0.008 * sgn), wfn(s, 0.3), gray(0.9))
        fan(mb, pole, ring, "M_crest", start=(k == 0))


# ================================================================================ torso + clothes
TORSO = [(0.385, (0.090, 0.068, 0.010, 2.3)), (0.430, (0.097, 0.071, 0.008, 2.4)),
         (0.480, (0.105, 0.075, 0.004, 2.5)), (0.530, (0.113, 0.079, 0.000, 2.6)),
         (0.580, (0.120, 0.082, -0.002, 2.7)), (0.620, (0.124, 0.081, -0.002, 2.8)),
         (0.650, (0.123, 0.077, 0.000, 2.8)), (0.675, (0.116, 0.070, 0.002, 2.6)),
         (0.695, (0.100, 0.060, 0.004, 2.4)), (0.708, (0.078, 0.048, 0.005, 2.2)),
         (0.716, (0.048, 0.032, 0.005, 2.0))]


def torso_local(th, z):
    rx, ry, cy, p = table(TORSO, z)
    return Vector((rx * se(sin(th), p), cy - ry * se(cos(th), p), z))


def torso_nrm(th, z):
    h = 1e-4
    du = torso_local(th + h, z) - torso_local(th - h, z)
    dv = torso_local(th, z + h) - torso_local(th, z - h)
    n = du.cross(dv)
    return n.normalized() if n.length > 1e-12 else Vector((sin(th), -cos(th), 0))


def torso_pt(th, z, off=0.0):
    p = torso_local(th, z)
    return p + torso_nrm(th, z) * off if off else p


def w_torso(p):
    z, ax = p.z, abs(p.x)
    wh = 1.0 - sstep(0.42, 0.48, z)
    wc = sstep(0.50, 0.59, z)
    d = {"hips": wh, "chest": wc, "spine": max(0.0, 1.0 - wh - wc)}
    sh = sstep(0.070, 0.125, ax) * sstep(0.60, 0.67, z) * 0.45
    nk = sstep(0.700, 0.725, z) * (1.0 - sstep(0.03, 0.06, ax)) * 0.5
    k = 1.0 - sh - nk
    d = {b: v * k for b, v in d.items()}
    d["shoulder." + ("L" if p.x > 0 else "R")] = sh
    d["neck"] = nk
    return wn(d)


def build_torso(mb):
    mb.begin("torso")
    N = 20
    zs = [0.55, 0.60, 0.635, 0.66, 0.68, 0.695, 0.705, 0.712, 0.717]
    rows = []
    for z in zs:
        rows.append([mb.v(torso_pt(2 * pi * j / N, z), w_torso(torso_pt(2 * pi * j / N, z))) for j in range(N)])
    grid(mb, rows, "M_skin")
    fan(mb, mb.v(Vector((0, 0.005, 0.721)), w_torso(Vector((0, 0.005, 0.721)))), rows[-1], "M_skin", False)
    fan(mb, mb.v(Vector((0, 0.0, 0.55)), "chest"), rows[0], "M_skin", True)


NECK_Z = [(0.0, 0.625), (0.40, 0.700)]
ARM_A0, ARM_A1 = 0.62, pi - 0.62            # armhole theta span (each side)
BACK_N = pi - 0.45


def top_edge(th):
    """z of the tank top's upper edge at theta (neckline, straps, armhole bottoms, back scoop)."""
    a = abs(wrap_pi(th))
    if a < 0.40:
        return 0.625 + 0.075 * (a / 0.40) ** 2
    if a < ARM_A0 - 0.06:
        return 0.700
    if a < ARM_A0:
        return lerp(0.700, 0.672, sstep(ARM_A0 - 0.06, ARM_A0, a))
    if a <= ARM_A1:
        u = (a - ARM_A0) / (ARM_A1 - ARM_A0)
        return 0.672 - 0.098 * (sin(pi * u) ** 0.75)
    if a < ARM_A1 + 0.06:
        return lerp(0.672, 0.700, sstep(ARM_A1, ARM_A1 + 0.06, a))
    if a < BACK_N:
        return 0.700
    return 0.700 - 0.036 * ((a - BACK_N) / (pi - BACK_N)) ** 2


def top_off(z):
    return 0.006 + 0.017 * (1.0 - sstep(0.405, 0.47, z))


def top_columns():
    cols = set()
    for k in range(30):
        cols.add(round(wrap_pi(-pi + 2 * pi * k / 30), 5))
    for a in (0.40, ARM_A0 - 0.06, ARM_A0, ARM_A1, ARM_A1 + 0.06, BACK_N):
        cols.add(round(a, 5))
        cols.add(round(-a, 5))
    out = sorted(cols)
    ded = [out[0]]
    for c in out[1:]:
        if c - ded[-1] > 0.03:
            ded.append(c)
    return ded


TOP_ROWS = [0.0, 0.08, 0.20, 0.36, 0.52, 0.68, 0.84, 1.0]
Z_HEM = 0.403


def build_tank_top(mb):
    mb.begin("tank_top")
    cols = top_columns()
    rows = [[] for _ in range(len(TOP_ROWS) + 1)]
    for th in cols:
        zt = top_edge(th)
        rows[0].append(mb.v(torso_pt(th, Z_HEM + 0.004, -0.003), w_torso(torso_pt(th, Z_HEM))))
        for k, t in enumerate(TOP_ROWS):
            z = lerp(Z_HEM, zt, t)
            p = torso_pt(th, z, top_off(z))
            rows[k + 1].append(mb.v(p, w_torso(p)))

    def mat(i, j):
        return "M_top_trim" if i <= 1 else "M_top"
    grid(mb, rows, mat)
    # shoulder bands (strap over the armhole, each side)
    for s in (1, -1):
        brow = []
        ths = [lerp(ARM_A0, ARM_A1, k / 12.0) * s for k in range(13)]
        if s < 0:
            ths.reverse()
        for z in (0.672, 0.686, 0.700):
            brow.append([mb.v(torso_pt(th, z, 0.0075), w_torso(torso_pt(th, z))) for th in ths])
        grid(mb, brow, "M_top", wrap=False)
    # trims: neckline/strap tops, armholes, hem
    mb.begin("top_trims")
    pts, nrm = [], []
    for k in range(40):
        th = -pi + 2 * pi * k / 40
        a_ = abs(wrap_pi(th))
        z = top_edge(th) if (a_ < 0.40 or a_ > BACK_N) else 0.700
        pts.append(torso_pt(th, z, 0.008))
        nrm.append(torso_nrm(th, z))
    surface_tube(mb, pts, nrm, 0.0060, 0.0032, 4, lambda i, j, p: w_torso(p), "M_top_trim", closed=True)
    for s in (1, -1):
        pts, nrm = [], []
        n1 = 11
        for k in range(n1 + 1):                       # lower armhole curve A0 -> A1
            th = lerp(ARM_A0, ARM_A1, k / n1)
            z = top_edge(th)
            pts.append(torso_pt(th * s, z, 0.008))
            nrm.append(torso_nrm(th * s, z))
        for k in range(n1 - 1, 0, -1):                # back along the band's lower edge
            th = lerp(ARM_A0, ARM_A1, k / n1)
            pts.append(torso_pt(th * s, 0.672, 0.0095))
            nrm.append(torso_nrm(th * s, 0.672))
        if s < 0:
            pts.reverse()
            nrm.reverse()
        surface_tube(mb, pts, nrm, 0.0058, 0.0032, 4, lambda i, j, p: w_torso(p), "M_top_trim", closed=True)


def build_neck(mb):
    mb.begin("neck")
    pts = [Vector((0, 0.006, z)) for z in (0.655, 0.69, 0.73, 0.77, 0.81)]
    pts = [p + Vector((0, -0.012 * sstep(0.69, 0.81, p.z), 0)) for p in pts]

    def w(i, j, p):
        z = p.z
        wh = sstep(0.74, 0.79, z)
        wc = 1.0 - sstep(0.67, 0.70, z)
        return wn({"head": wh, "chest": wc, "neck": max(0.0, 1.0 - wh - wc)})
    tube(mb, pts, [0.046, 0.045, 0.043, 0.043, 0.042], 12, w, "M_skin", hint=Vector((0, -1, 0)))


SHORTS = [(0.332, (0.060, 0.048, 0.012, 2.0)), (0.345, (0.092, 0.068, 0.012, 2.2)),
          (0.365, (0.108, 0.080, 0.012, 2.4)), (0.400, (0.111, 0.083, 0.011, 2.5)),
          (0.440, (0.106, 0.080, 0.009, 2.5)), (0.470, (0.104, 0.078, 0.008, 2.5))]


def build_shorts(mb):
    mb.begin("shorts")
    N = 20
    zs = [0.332, 0.345, 0.365, 0.39, 0.42, 0.45, 0.47]
    rows = []
    for z in zs:
        rx, ry, cy, p = table(SHORTS, z)
        ring = []
        for j in range(N):
            th = 2 * pi * j / N
            q = Vector((rx * se(sin(th), p), cy - ry * se(cos(th), p), z))
            wt = {"hips": 1.0}
            if z < 0.37 and abs(q.x) > 0.04:
                wt = wn({"hips": 0.7, ("thigh.L" if q.x > 0 else "thigh.R"): 0.3})
            ring.append(mb.v(q, wt))
        rows.append(ring)

    def mat(i, j):
        th = 2 * pi * (j + 0.5) / N
        return "M_shorts_stripe" if (abs(sin(th)) > 0.97 and zs[i] >= 0.345) else "M_shorts"
    grid(mb, rows, mat)
    fan(mb, mb.v(Vector((0, 0.01, 0.326)), "hips"), rows[0], "M_shorts", True)
    fan(mb, mb.v(Vector((0, 0.008, 0.476)), "hips"), rows[-1], "M_shorts", False)
    # leg tubes (flared, open hem with a thick lip)
    for s, side in ((1, "L"), (-1, "R")):
        top = Vector((0.078 * s, 0.008, 0.392))
        bot = Vector((0.092 * s, 0.008, 0.248))
        prof = [(0.0, 0.070), (0.23, 0.073), (0.54, 0.076), (0.80, 0.079), (0.93, 0.0805), (1.0, 0.0795)]
        pts = [top.lerp(bot, t) for t, _ in prof]
        rad = [r for _, r in prof]
        lip = [bot + (top - bot).normalized() * 0.004, bot + (top - bot).normalized() * 0.03]
        pts += lip
        rad += [0.069, 0.066]
        ax = (bot - top).normalized()
        U, V = frame_from(ax, Vector((s, 0, 0)))
        frames = [(U, V, ax)] * len(pts)

        def w(i, j, p, side=side):
            wt = sstep(0.385, 0.335, p.z)
            return wn({"thigh." + side: wt, "hips": 1.0 - wt})

        def mat(i, j, s=s):
            ph = 2 * pi * (j + 0.5) / 14
            outward = cos(ph)
            if i >= 3:
                return "M_shorts_stripe"
            return "M_shorts_stripe" if outward > 0.93 else "M_shorts"
        tube(mb, pts, rad, 14, w, mat, frames=frames)


LEG_PROF = [(0.330, 0.061), (0.270, 0.058), (0.238, 0.054), (0.215, 0.052), (0.190, 0.0535),
            (0.1665, 0.0525), (0.163, 0.0565), (0.150, 0.0555), (0.140, 0.0545), (0.118, 0.0500),
            (0.090, 0.0460), (0.060, 0.0440)]


def leg_axis(side, z):
    hp, kn, an = REST["thigh." + side], REST["shin." + side], REST["foot." + side]
    if z >= kn.z:
        t = (hp.z - z) / (hp.z - kn.z)
        return hp.lerp(kn, t)
    t = (kn.z - z) / (kn.z - an.z)
    return kn.lerp(an, t)


def build_legs(mb):
    for s, side in ((1, "L"), (-1, "R")):
        mb.begin("leg." + side)
        pts = [leg_axis(side, z) for z, _ in LEG_PROF]
        rad = [r for _, r in LEG_PROF]

        def w(i, j, p, side=side):
            z = p.z
            ws = sstep(0.245, 0.190, z)
            wh = sstep(0.345, 0.395, z) * 0.55
            wf = sstep(0.100, 0.070, z)
            return wn({"hips": wh, "thigh." + side: (1 - ws) * (1 - wh), "shin." + side: ws * (1 - wf),
                       "foot." + side: wf})

        def mat(i, j):
            z = LEG_PROF[i][0]
            if z <= 0.152 and z > 0.139:
                return "M_band"
            return "M_top" if z <= 0.1665 else "M_skin"
        tube(mb, pts, rad, 12, w, mat, hint=Vector((0, -1, 0)))


SHOE = [(0.060, 0.082, 0.030), (0.054, 0.106, 0.041), (0.040, 0.121, 0.048), (0.018, 0.125, 0.051),
        (-0.005, 0.121, 0.053), (-0.035, 0.110, 0.055), (-0.065, 0.097, 0.056), (-0.095, 0.085, 0.056),
        (-0.118, 0.074, 0.052), (-0.133, 0.062, 0.045), (-0.143, 0.051, 0.034)]
SHOE_ZB = 0.028
SHOE_H = [(-r[0], r[1]) for r in SHOE]
SHOE_W = [(-r[0], r[2]) for r in SHOE]


def shoe_ring(side_s, y, off=0.0, n=14):
    xc = REST["foot." + ("L" if side_s > 0 else "R")].x
    h = table(SHOE_H, -y)
    hw = table(SHOE_W, -y)
    zc = (h + SHOE_ZB) / 2
    hh = (h - SHOE_ZB) / 2
    pts = []
    for j in range(n):
        ph = 2 * pi * j / n
        # U = +Z (ph=0 at top), V = -X ; U x V = -Y (the loft runs heel -> toe)
        pts.append(Vector((xc - (hw + off) * se(sin(ph), 2.4), y, zc + (hh + off) * se(cos(ph), 2.4))))
    return pts


def build_shoes(mb):
    for s, side in ((1, "L"), (-1, "R")):
        mb.begin("shoe." + side)
        fb, tb = "foot." + side, "toe." + side

        def w(p, fb=fb, tb=tb):
            k = sstep(-0.055, -0.090, p.y)
            return wn({fb: 1 - k, tb: k})
        ys = [0.060, 0.052, 0.036, 0.012, -0.014, -0.040, -0.066, -0.092, -0.113, -0.130, -0.142]
        rows = []
        for y in ys:
            ring = []
            for p in shoe_ring(s, y):
                c = gray(0.93) if y < -0.098 else WHITE
                ring.append(mb.v(p, w(p), c))
            rows.append(ring)
        grid(mb, rows, "M_shoe")
        xc = REST[fb].x
        fan(mb, mb.v(Vector((xc, 0.066, 0.056)), w(Vector((xc, 0.066, 0.056)))), rows[0], "M_shoe", True)
        fan(mb, mb.v(Vector((xc, -0.149, 0.042)), w(Vector((xc, -0.149, 0.042))), gray(0.93)), rows[-1], "M_shoe", False)
        # sole: a thick bevelled slab under the whole footprint, toe spring at the front
        mb.begin("sole." + side)
        loop = []
        ys_s = [-0.152 + (0.068 + 0.152) * k / 11 for k in range(12)]
        hw = lambda y: table([(r[0] * -1, r[2]) for r in SHOE], -clamp(y, -0.140, 0.060)) + 0.006
        # CCW seen from above: +X side from toe to heel, heel arc, -X side back to toe, toe arc
        for y in ys_s[1:-1]:
            loop.append((xc + hw(y), y))
        for k in range(1, 5):
            a = pi * k / 5
            loop.append((xc + hw(0.064) * cos(a), 0.064 + 0.012 * sin(a)))
        for y in reversed(ys_s[1:-1]):
            loop.append((xc - hw(y), y))
        for k in range(1, 5):
            a = pi + pi * k / 5
            loop.append((xc + hw(-0.146) * 0.95 * cos(a), -0.146 + 0.012 * sin(a)))
        cx = sum(p[0] for p in loop) / len(loop)
        cy = sum(p[1] for p in loop) / len(loop)

        def spring(y):
            return 0.013 * sstep(-0.095, -0.156, y)
        levels = [(0.0, 0.006), (0.006, 0.0), (0.036, 0.0), (0.043, 0.004)]
        rows = []
        for z, inset in levels:
            ring = []
            for (x, y) in loop:
                d = Vector((x - cx, y - cy, 0))
                dl = d.length
                q = Vector((x, y, 0)) - (d / dl) * inset if dl > 1e-6 else Vector((x, y, 0))
                q.z = z + spring(y)
                ring.append(mb.v(q, w(q)))
            rows.append(ring)
        grid(mb, rows, "M_sole")
        fan(mb, mb.v(Vector((cx, cy, 0.0)), fb), rows[0], "M_sole", True)
        fan(mb, mb.v(Vector((cx, cy, 0.043)), fb), rows[-1], "M_sole", False)
        # velcro strap over the instep
        mb.begin("strap." + side)
        ystr = -0.044
        ring = shoe_ring(s, ystr, 0.0, 24)
        sel = list(range(-6, 7))
        pts = [ring[k % 24] for k in sel]
        h = table([(r[0] * -1, r[1]) for r in SHOE], -ystr)
        zc = (h + SHOE_ZB) / 2
        nrm = [(p - Vector((xc, ystr, zc))).normalized() for p in pts]
        surface_tube(mb, pts, nrm, 0.012, 0.0045, 4, lambda i, j, p: w(p), "M_band", closed=False, lift=0.001)
        # padded collar around the ankle opening
        mb.begin("collar." + side)
        an = REST[fb]
        pts, nrm = [], []
        for k in range(14):
            a = 2 * pi * k / 14
            d = Vector((sin(a), -cos(a), 0))
            pts.append(Vector((an.x, 0.020, 0.120)) + Vector((0.047 * sin(a), -0.040 * cos(a), 0.006 * cos(a))))
            nrm.append(d)
        surface_tube(mb, pts, nrm, 0.010, 0.0075, 4, lambda i, j, p: fb, "M_shoe", closed=True,
                     colfn=lambda i, j, p: gray(0.80))


def arm_w(side, t):
    sh, ua, fa = "shoulder." + side, "upper_arm." + side, "forearm." + side
    wsh = 0.35 * sstep(0.012, -0.03, t)
    wf = sstep(0.105, 0.160, t)
    return wn({sh: wsh, ua: (1 - wf) * (1 - wsh), fa: wf * (1 - wsh)})


ARM_PROF = [(-0.049, 0.024), (-0.037, 0.039), (-0.020, 0.050), (0.004, 0.0540), (0.035, 0.0510),
            (0.075, 0.0475), (0.135, 0.0440), (0.170, 0.0450), (0.205, 0.0425), (0.235, 0.0392),
            (0.258, 0.0370)]


def build_arms(mb):
    for s, side in ((1, "L"), (-1, "R")):
        mb.begin("arm." + side)
        S, d = REST["upper_arm." + side], ARM_DIR[side]
        pts = [S + d * t for t, _ in ARM_PROF]
        rad = [r for _, r in ARM_PROF]
        tube(mb, pts, rad, 12, lambda i, j, p, side=side: arm_w(side, (p - S).dot(d)), "M_skin",
             hint=Vector((0, -1, 0)), cap0=S - d * 0.054)
        # wristband
        mb.begin("wristband." + side)
        prof = [(0.204, 0.0395), (0.209, 0.0462), (0.249, 0.0462), (0.254, 0.0400), (0.256, 0.031)]
        tube(mb, [S + d * t for t, _ in prof], [r for _, r in prof], 12, lambda i, j, p, side=side: "forearm." + side,
             "M_band", hint=Vector((0, -1, 0)), cap1="flat")


def hand_frame(side):
    d = ARM_DIR[side]
    f = Vector((0, -1, 0))
    f = (f - d * d.dot(f)).normalized()
    inward = Vector((-1 if side == "L" else 1, 0, 0))
    n = (inward - d * d.dot(inward) - f * f.dot(inward)).normalized()
    return d, f, n


FIST_OFF = 0.046


def fist_center(side):
    return REST["hand." + side] + ARM_DIR[side] * FIST_OFF


def build_hands(mb):
    for s, side in ((1, "L"), (-1, "R")):
        mb.begin("hand." + side)
        d, f, n = hand_frame(side)
        c = fist_center(side)
        blob(mb, c, d, f, 0.054, 0.048, 0.039, 12, 7, "hand." + side, "M_skin", e_ring=2.4, e_prof=2.2)
        tc = REST["hand." + side] + d * 0.034 + f * 0.040 + n * 0.009
        ta = (d * 0.75 + f * 0.45).normalized()
        blob(mb, tc, ta, n, 0.024, 0.016, 0.016, 6, 5, "hand." + side, "M_skin")


TANK_C = Vector((0.0, 0.160, 0.0))
TANK_R = 0.068
TANK_Z0, TANK_Z1 = 0.448, 0.660
WIN_A = 0.66
WIN_Z0, WIN_Z1 = 0.472, 0.640
DYE_Z0, DYE_Z1 = 0.474, 0.638


def tank_pt(phi, z, r):
    return Vector((TANK_C.x - r * sin(phi), TANK_C.y + r * cos(phi), z))


def build_tank(mb):
    mb.begin("tank")
    cols = [lerp(-WIN_A, WIN_A, k / 4.0) for k in range(5)]
    cols += [lerp(WIN_A, 2 * pi - WIN_A, k / 13.0) for k in range(1, 13)]
    N = len(cols)
    zrows = []
    for k in range(1, 4):          # bottom dome
        a = -pi / 2 + (pi / 2) * k / 4
        zrows.append((TANK_Z0 + 0.034 * sin(a), TANK_R * cos(a) ** 0.8))
    for z in (TANK_Z0, WIN_Z0, 0.51, 0.55, 0.59, WIN_Z1, TANK_Z1):
        zrows.append((z, TANK_R))
    for k in range(1, 4):          # top dome
        a = (pi / 2) * k / 4
        zrows.append((TANK_Z1 + 0.042 * sin(a), TANK_R * cos(a) ** 0.8))
    rows = [[mb.v(tank_pt(phi, z, r), "tank") for phi in cols] for z, r in zrows]

    def mat(i, j):
        z0, z1 = zrows[i][0], zrows[i + 1][0]
        inwin = j < 4 and z0 >= WIN_Z0 - 1e-6 and z1 <= WIN_Z1 + 1e-6
        return "M_glass" if inwin else "M_tank_shell"
    grid(mb, rows, mat)
    fan(mb, mb.v(Vector((TANK_C.x, TANK_C.y, TANK_Z0 - 0.034)), "tank"), rows[0], "M_tank_shell", True)
    fan(mb, mb.v(Vector((TANK_C.x, TANK_C.y, TANK_Z1 + 0.042)), "tank"), rows[-1], "M_tank_shell", False)
    # padded back plate the tank sits on
    blob(mb, Vector((TANK_C.x, 0.093, 0.548)), Vector((0, 0, 1)), Vector((1, 0, 0)), 0.095, 0.050, 0.016, 10, 5,
         "tank", "M_shorts", e_ring=3.2, e_prof=3.2)
    # dark liner so the tank reads as hollow above the dye
    mb.begin("tank_liner")
    pts = [Vector((TANK_C.x, TANK_C.y, z)) for z in (WIN_Z0 - 0.01, WIN_Z1 + 0.01)]
    tube(mb, pts, [TANK_R - 0.005] * 2, 12, lambda i, j, p: "tank", "M_tank_shell", hint=Vector((0, 1, 0)),
         colfn=lambda i, j, p: gray(0.30), flip=True)
    # window frame (dark), team bands, valve
    mb.begin("tank_trim")
    pts, nrm = [], []
    corner = 0.028

    def win_loop():
        out = []
        for k in range(8):
            out.append((lerp(-WIN_A + 0.08, WIN_A - 0.08, k / 7.0), WIN_Z0))
        for k in range(6):
            out.append((WIN_A, lerp(WIN_Z0 + corner, WIN_Z1 - corner, k / 5.0)))
        for k in range(8):
            out.append((lerp(WIN_A - 0.08, -WIN_A + 0.08, k / 7.0), WIN_Z1))
        for k in range(6):
            out.append((-WIN_A, lerp(WIN_Z1 - corner, WIN_Z0 + corner, k / 5.0)))
        return out
    for phi, z in win_loop():
        pts.append(tank_pt(phi, z, TANK_R + 0.002))
        nrm.append(Vector((-sin(phi), cos(phi), 0)))
    surface_tube(mb, pts, nrm, 0.0065, 0.0045, 4, lambda i, j, p: "tank", "M_tank_shell", closed=True,
                 colfn=lambda i, j, p: gray(0.42))
    for z in (0.456, 0.652):
        pts, nrm = [], []
        for k in range(16):
            phi = 2 * pi * k / 16
            pts.append(tank_pt(phi, z, TANK_R + 0.002))
            nrm.append(Vector((-sin(phi), cos(phi), 0)))
        surface_tube(mb, pts, nrm, 0.0075, 0.0045, 4, lambda i, j, p: "tank", "M_band", closed=True)
    vt = [Vector((TANK_C.x, TANK_C.y, z)) for z in (TANK_Z1 + 0.030, TANK_Z1 + 0.058)]
    tube(mb, vt, [0.020, 0.018], 10, lambda i, j, p: "tank", "M_tank_shell", cap1="flat",
         colfn=lambda i, j, p: gray(0.62))
    blob(mb, Vector((TANK_C.x, TANK_C.y, TANK_Z1 + 0.066)), Vector((0, 0, 1)), Vector((0, 1, 0)), 0.011, 0.030,
         0.030, 10, 5, "tank", "M_band", e_ring=2.0, e_prof=2.8)


def build_tank_dye(mb):
    mb.begin("tank_dye")
    pts = [Vector((TANK_C.x, TANK_C.y, z)) for z in (DYE_Z0, DYE_Z1)]
    tube(mb, pts, [TANK_R - 0.009] * 2, 16, lambda i, j, p: "tank", "M_tank_dye", hint=Vector((0, 1, 0)),
         cap0="flat", cap1="flat")


HARNESS = [(pi - 0.34, 0.575), (pi - 0.50, 0.635), (pi - 0.86, 0.688), (pi / 2, 0.704),
           (0.86, 0.688), (0.56, 0.648), (0.45, 0.598), (0.43, 0.515)]


def build_harness(mb):
    mb.begin("harness")
    for s in (1, -1):
        ctrl = [Vector((th * s, z, 0)) for th, z in HARNESS]
        pts, nrm = [], []
        for k in range(13):
            q = spline_pts(ctrl, k / 12.0)
            pts.append(torso_pt(q.x, q.y, 0.0175))
            nrm.append(torso_nrm(q.x, q.y))
        if s < 0:
            pts.reverse()
            nrm.reverse()
        surface_tube(mb, pts, nrm, 0.0125, 0.0040, 4, lambda i, j, p: "chest", "M_shorts", closed=False)
    pts, nrm = [], []
    for k in range(9):
        th = lerp(-0.47, 0.47, k / 8.0)
        pts.append(torso_pt(th, 0.552, 0.018))
        nrm.append(torso_nrm(th, 0.552))
    surface_tube(mb, pts, nrm, 0.0105, 0.0038, 4, lambda i, j, p: "chest", "M_shorts", closed=False)
    bc = torso_pt(0.0, 0.552, 0.026)
    blob(mb, bc, Vector((0, -1, 0)), Vector((0, 0, 1)), 0.008, 0.020, 0.026, 8, 5, "chest", "M_band",
         e_ring=3.0, e_prof=2.5)


SLICK_PROF = [(-0.330, 0.050, 0.030), (-0.300, 0.125, 0.052), (-0.230, 0.195, 0.068), (-0.120, 0.236, 0.076),
              (0.000, 0.244, 0.074), (0.130, 0.225, 0.066), (0.260, 0.180, 0.052), (0.380, 0.120, 0.036),
              (0.480, 0.062, 0.022), (0.540, 0.024, 0.012)]


def hump_at(y):
    w = table([(a, b) for a, b, c in SLICK_PROF], y)
    h = table([(a, c) for a, b, c in SLICK_PROF], y)
    return w, h


def build_slick_fin(mb):
    """swim form: the crest-fin cutting through a flat, glossy teardrop dye hump (~0.9 m), root-weighted."""
    mb.begin("slick_hump")
    prof = SLICK_PROF
    N = 14
    rows = []
    for y, w, h in prof:
        ring = []
        for j in range(N):
            ph = 2 * pi * j / N
            # U = +Z, V = -X  (U x V = -Y ... loft runs toward +Y, so mirror with +X to keep CCW about +Y)
            x = w * se(sin(ph), 2.2)
            zz = h * se(cos(ph), 2.0)
            zz = zz if zz > 0 else zz * 0.15
            ring.append(mb.v(Vector((x, y, zz - 0.004)), "root"))
        rows.append(ring)
    grid(mb, rows, "M_tank_dye")
    fan(mb, mb.v(Vector((0, -0.345, 0.010)), "root"), rows[0], "M_tank_dye", True)
    fan(mb, mb.v(Vector((0, 0.556, 0.004)), "root"), rows[-1], "M_tank_dye", False)
    # the fin: the head crest's swept silhouette standing on a flat base along the hump's spine
    def base(s):
        y = lerp(-0.215, 0.215, s)
        return Vector((0.0, y, 0.030))

    def top(s):
        t = crest_top(s)
        z = max(t.z - 1.000, 0.045 + 0.02 * sin(pi * s))
        return Vector((0.0, t.y - 0.030, z))
    build_crest(mb, wfn=lambda s, h: "root", ns=12, label="slick_crest", base_fn=base, top_fn=top)
    # wake: two ripples fanning back from the fin across the hump
    mb.begin("slick_wake")
    for sx in (1, -1):
        pts, nrm = [], []
        for k in range(8):
            t = k / 7.0
            y = lerp(-0.10, 0.34, t)
            x = sx * lerp(0.045, 0.115, t ** 0.8)
            w, hgt = hump_at(y)
            z = hgt * max(0.0, 1.0 - (abs(x) / max(w, 1e-3)) ** 2.2) ** 0.5 - 0.004
            pts.append(Vector((x, y, z)))
            nrm.append(Vector((0, 0, 1)))
        surface_tube(mb, pts, nrm, 0.014, 0.0045, 4, lambda i, j, p: "root", "M_tank_dye", closed=False,
                     colfn=lambda i, j, p: gray(1.0))


# ================================================================================ rig + objects
def new_mesh_object(mb, name, coll, mats, groups=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(mb.V, [], mb.F)
    me.update(calc_edges=True)
    names = []
    for m in mb.M:
        if m not in names:
            names.append(m)
    order = [m for m in mats if m in names] + [m for m in names if m not in mats]
    for m in order:
        me.materials.append(bpy.data.materials[m])
    idx = {m: i for i, m in enumerate(order)}
    me.polygons.foreach_set("material_index", [idx[m] for m in mb.M])
    me.shade_smooth()
    ca = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
    flat = []
    for c in mb.C:
        flat.extend(c)
    ca.data.foreach_set("color", flat)
    me.color_attributes.active_color = ca
    try:
        me.attributes.default_color_name = "Col"
        me.attributes.active_color_name = "Col"
    except Exception:
        pass
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if not groups:
        return ob
    # vertex groups
    groups = {}
    for vi, w in enumerate(mb.W):
        for b, x in w.items():
            groups.setdefault(b, {}).setdefault(round(x, 6), []).append(vi)
    for b in BONES:
        vg = ob.vertex_groups.new(name=b)
        for x, vs in groups.get(b, {}).items():
            vg.add(vs, x, 'REPLACE')
    for b in groups:
        if b not in BONES:
            raise RuntimeError("weight to unknown bone %r in %s" % (b, name))
    return ob


def build_armature(coll, crest_joints):
    arm_data = bpy.data.armatures.new("rig")
    arm = bpy.data.objects.new("rig", arm_data)
    coll.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    rest = dict(REST)
    rest.update(crest_joints)
    for b in ORDER:
        e = arm_data.edit_bones.new(b)
        h = rest[b]
        e.head = h
        e.tail = h + Vector((0, 0, 0.05))
        e.roll = 0.0
        e.use_connect = False
        e.use_deform = True
        if PARENT[b]:
            e.parent = eb[PARENT[b]]
        eb[b] = e
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in ORDER:
        m = arm_data.bones[b].matrix_local.to_3x3()
        if max(abs(m[i][j] - R0[i][j]) for i in range(3) for j in range(3)) > 1e-5:
            raise RuntimeError("bone %s rest basis %s != R0" % (b, m))
    REST.update(crest_joints)
    return arm


# ================================================================================ pose system
def qe(rx=0.0, ry=0.0, rz=0.0):
    """world-axis rotation, degrees: Rz @ Ry @ Rx (pitch first)."""
    return (Quaternion((0, 0, 1), radians(rz)) @ Quaternion((0, 1, 0), radians(ry)) @
            Quaternion((1, 0, 0), radians(rx)))


class Pose:
    def __init__(self):
        self.off = Vector((0, 0, 0))
        self.e = {}           # bone -> (rx, ry, rz) deg, world axes, relative to parent
        self.arm = {}         # side -> dict(kind='fk', abd, swing, twist, elbow) | dict(kind='ik', target, pole)
        self.leg = {}         # side -> dict(kind='fk', thigh=(rx,ry,rz), knee, foot=(rx,ry,rz)) | dict(kind='ik', ankle, foot_q)
        self.hand = {}        # side -> ('e', (rx,ry,rz)) | ('world', Quaternion) | ('kit', Quaternion)
        self.toe = {}         # side -> deg


def _limb_world(S, rest_dir, hinge0, u, v):
    """world rotations for a 2-bone limb given new upper dir u and lower dir v (unit)."""
    c = clamp(u.dot(v), -1.0, 1.0)
    bend = acos(c)
    if bend < 1e-4:
        h = u.cross(hinge0.cross(u)) if False else None
        q_up = rest_dir.rotation_difference(u)
        return q_up, 0.0
    hstar = u.cross(v).normalized()
    F0 = Matrix((rest_dir, hinge0, rest_dir.cross(hinge0))).transposed()
    F1 = Matrix((u, hstar, u.cross(hstar))).transposed()
    return (F1 @ F0.transposed()).to_quaternion(), bend


def _ik(S, T, l1, l2, pole):
    d = T - S
    dist = clamp(d.length, abs(l1 - l2) + 1e-4, l1 + l2 - 1e-4)
    dn = d.normalized()
    a1 = acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1))
    pv = pole - S
    perp = pv - dn * dn.dot(pv)
    if perp.length < 1e-6:
        perp = any_perp(dn)
    perp.normalize()
    E = S + (dn * cos(a1) + perp * sin(a1)) * l1
    Tc = S + dn * dist
    return (E - S).normalized(), (Tc - E).normalized()


ARM_HINGE = {k: ARM_DIR[k].cross(Vector((0, -1, 0))).normalized() for k in ("L", "R")}
LEG_HINGE = {k: LEG_DIR[k].cross(Vector((0, 1, 0))).normalized() for k in ("L", "R")}
GRIP_Q = None       # world rotation of hand.R in the aim reference (set in main)
CREST_GAIN = 0.5


def arm_dir(side, abd, swing):
    s = 1 if side == "L" else -1
    d = Quaternion((1, 0, 0), radians(-swing)) @ Quaternion((0, 1, 0), radians(-abd * s)) @ Vector((0, 0, -1))
    return d


def evaluate(pose):
    W, Wt, P = {}, {}, {}
    for b in ORDER:
        par = PARENT[b]
        Wp = Wt[par] if par else Quaternion()
        pos = (P[par] + Wp @ (REST[b] - REST[par])) if par else REST[b].copy()
        if b == "hips":
            pos = pos + pose.off
        P[b] = pos
        if b in W:                      # already solved by a limb solver
            Wt[b] = Wp @ W[b]
            continue
        side = b[-1] if b[-2:] in (".L", ".R") else None
        if b.startswith("upper_arm") and side in pose.arm:
            spec = pose.arm[side]
            if spec["kind"] == "fk":
                u = arm_dir(side, spec["abd"], spec["swing"])       # in the shoulder's frame
                q_up = Quaternion(u, radians(spec.get("twist", 0.0))) @ ARM_DIR[side].rotation_difference(u)
                W[b] = q_up
                W["forearm." + side] = Quaternion(ARM_HINGE[side], radians(spec.get("elbow", 0.0)))
            else:
                T = spec["target"]
                u, v = _ik(pos, T, ARM_L1, ARM_L2, spec["pole"])
                q_up, bend = _limb_world(pos, ARM_DIR[side], ARM_HINGE[side], u, v)
                W[b] = Wp.inverted() @ q_up
                W["forearm." + side] = Quaternion(ARM_HINGE[side], bend)
            Wt[b] = Wp @ W[b]
            continue
        if b.startswith("thigh") and side in pose.leg:
            spec = pose.leg[side]
            if spec["kind"] == "fk":
                W[b] = qe(*spec.get("thigh", (0, 0, 0)))
                W["shin." + side] = Quaternion(LEG_HINGE[side], radians(spec.get("knee", 0.0)))
            else:
                u, v = _ik(pos, spec["ankle"], LEG_L1, LEG_L2, spec.get("pole", pos + Vector((0, -0.4, -0.1))))
                q_up, bend = _limb_world(pos, LEG_DIR[side], LEG_HINGE[side], u, v)
                W[b] = Wp.inverted() @ q_up
                W["shin." + side] = Quaternion(LEG_HINGE[side], bend)
            Wt[b] = Wp @ W[b]
            continue
        if b.startswith("foot") and side in pose.leg:
            spec = pose.leg[side]
            if "foot_q" in spec:
                W[b] = Wp.inverted() @ spec["foot_q"]
            else:
                W[b] = qe(*spec.get("foot", (0, 0, 0)))
            Wt[b] = Wp @ W[b]
            continue
        if b.startswith("toe") and side in pose.toe:
            W[b] = qe(pose.toe[side], 0, 0)
            Wt[b] = Wp @ W[b]
            continue
        if b.startswith("hand") and side in pose.hand:
            kind, val = pose.hand[side]
            if kind == "e":
                W[b] = qe(*val)
            elif kind == "world":
                W[b] = Wp.inverted() @ val
            else:                               # 'kit': the socket (and kit) end up rotated by val
                W[b] = Wp.inverted() @ (val @ GRIP_Q)
            Wt[b] = Wp @ W[b]
            continue
        e = pose.e.get(b, (0, 0, 0))
        if b.startswith("crest"):
            e = tuple(c * CREST_GAIN for c in e)     # chain rotations accumulate
        W[b] = qe(*e)
        Wt[b] = Wp @ W[b]
    return W, Wt, P


def socket_world(Wt, P):
    """world position + rotation of socket_weapon for an evaluated pose."""
    fc = P["hand.R"] + Wt["hand.R"] @ (fist_center("R") - REST["hand.R"])
    return fc, Wt["hand.R"] @ GRIP_Q.inverted()


# ---------------------------------------------------------------------------------------- clips
def cyc(ph):
    return cos(2 * pi * ph)


def syc(ph):
    return sin(2 * pi * ph)


def bump(ph, c, w):
    d = ((ph - c + 0.5) % 1.0) - 0.5
    return math.exp(-(d / w) ** 2)


def stand_legs(p, pw=None, spread=0.0, bend_foot=(0, 0), ankle_off=None):
    """IK legs with feet planted at rest (optionally shifted); feet flat."""
    for s, side in ((1, "L"), (-1, "R")):
        a = REST["foot." + side] + Vector((spread * s, 0, 0))
        if ankle_off and side in ankle_off:
            a = a + ankle_off[side]
        hp = REST["thigh." + side]
        pole = Vector((hp.x + 0.03 * s, hp.y - 0.5, hp.z - 0.1))
        fq = qe(bend_foot[0 if side == "L" else 1], 0, 0)
        p.leg[side] = dict(kind="ik", ankle=a, pole=pole, foot_q=fq)


def kitq(pitch=0.0, yaw=0.0, roll=0.0):
    """world rotation of the kit: pitch + = nose up, yaw + = to the left.
    (a +X rotation pitches -Y (the barrel) DOWN, hence the minus.)"""
    return qe(-pitch, roll, yaw)


def clip_idle(t, T):
    ph = t / T
    p = Pose()
    br = syc(ph)
    p.off = Vector((0.010 * syc(ph), 0.0, -0.014 + 0.004 * syc(2 * ph)))
    p.e["hips"] = (0, 2.2 * syc(ph), 0)
    p.e["spine"] = (1.5, -1.4 * syc(ph), 0)
    p.e["chest"] = (-1.5 + 1.2 * syc(2 * ph + 0.1), -0.6 * syc(ph), 0)
    p.e["neck"] = (0, 0, 0)
    p.e["head"] = (-1.5 + 1.8 * syc(2 * ph - 0.1), 2.6 * syc(ph + 0.15), 2.0 * syc(ph - 0.1))
    p.e["crest_1"] = (-1.2 * syc(2 * ph - 0.25), -1.6 * syc(ph + 0.02), 0)
    p.e["crest_2"] = (-1.8 * syc(2 * ph - 0.33), -2.2 * syc(ph - 0.04), 0)
    p.e["crest_3"] = (-2.6 * syc(2 * ph - 0.42), -2.8 * syc(ph - 0.10), 0)
    p.e["shoulder.L"] = (0, 0, 0)
    p.arm["L"] = dict(kind="fk", abd=13 + 1.5 * br, swing=4, elbow=22 + 3 * syc(2 * ph))
    p.hand["L"] = ("e", (-8, 0, 0))
    p.arm["R"] = dict(kind="fk", abd=16, swing=12 + 1.5 * syc(2 * ph), elbow=48 + 2 * syc(2 * ph))
    p.hand["R"] = ("kit", kitq(-38 + 2 * syc(2 * ph), 4, 0))
    p.e["tank"] = (0.6 * syc(2 * ph - 0.2), 0, 0)
    stand_legs(p, spread=0.012)
    return p


def clip_lobby_idle(t, T):
    ph = t / T
    p = Pose()
    p.off = Vector((0.020 + 0.006 * syc(ph), 0.0, -0.016 + 0.004 * syc(2 * ph)))
    p.e["hips"] = (0, 4.5, -8 + 2 * syc(ph))
    p.e["spine"] = (0.5, -3.0, 4)
    p.e["chest"] = (-3 + 1.2 * syc(2 * ph), -2.0, 6 + 2 * syc(ph))
    look = 14 * sin(2 * pi * ph) * abs(sin(2 * pi * ph)) ** 0.5
    p.e["head"] = (-4 + 2 * syc(2 * ph + 0.2), -5 + 2 * syc(ph), look)
    p.e["crest_1"] = (-1.5 * syc(2 * ph - 0.2), -0.12 * look, 0)
    p.e["crest_2"] = (-2.0 * syc(2 * ph - 0.3), -0.18 * look, 0)
    p.e["crest_3"] = (-3.0 * syc(2 * ph - 0.4), -0.25 * look, 0)
    # kit shouldered: right hand up by the shoulder, barrel pointing up-back
    p.arm["R"] = dict(kind="fk", abd=30, swing=62, elbow=132, twist=0)
    p.hand["R"] = ("kit", kitq(70, -20, 0))
    # left fist on the hip
    p.arm["L"] = dict(kind="fk", abd=48, swing=-22, elbow=104, twist=-38)
    p.hand["L"] = ("e", (0, -20, 20))
    p.e["tank"] = (0, 0, 0)
    stand_legs(p, spread=0.018, ankle_off={"R": Vector((-0.02, -0.05, 0))})
    return p


def run_like(t, T, back=False, strafe=0):
    """run cycle. back: backpedal. strafe: +1 = to the left (+X), -1 = to the right."""
    ph = t / T
    if back:
        ph = 1.0 - ph
    p = Pose()
    amp = 0.72 if back else 1.0
    if strafe:
        amp = 0.0
    lean = -3 if back else 11
    p.off = Vector((0, 0, -0.010 + 0.017 * cos(4 * pi * (ph - 0.40))))
    if strafe:
        p.off = Vector((0.010 * strafe * syc(2 * ph), 0, -0.018 + 0.016 * cos(4 * pi * (ph - 0.40))))
    p.e["hips"] = (4 * amp + (0 if not back else -2), 3.0 * syc(ph), -9 * cyc(ph) * amp)
    p.e["spine"] = (lean * 0.55, -1.5 * syc(ph), 5 * cyc(ph) * amp)
    p.e["chest"] = (lean * 0.45 + 1.5 * cos(4 * pi * (ph - 0.45)), -1.0 * syc(ph), 11 * cyc(ph) * amp)
    p.e["neck"] = (0, 0, -2 * cyc(ph) * amp)
    p.e["head"] = (-lean * 0.9 + 3.5 * cos(4 * pi * (ph - 0.48)), 1.5 * syc(ph), -6 * cyc(ph) * amp)
    if strafe:
        p.e["hips"] = (3, -7 * strafe + 3 * syc(2 * ph), 0)
        p.e["spine"] = (4, 4 * strafe, 0)
        p.e["chest"] = (3 + 1.5 * cos(4 * pi * (ph - 0.45)), 2 * strafe, 0)
        p.e["head"] = (-3 + 3 * cos(4 * pi * (ph - 0.48)), 2 * strafe, 0)
    # crest follow-through: lags the bounce, swept back by the wind
    wind = -7 if not back else 4
    for k, b in enumerate(("crest_1", "crest_2", "crest_3")):
        lag = 0.08 + 0.07 * k
        p.e[b] = (wind * (0.5 + 0.35 * k) - (3 + 2.5 * k) * cos(4 * pi * (ph - 0.48 - lag)),
                  (2 + 1.5 * k) * syc(ph - lag), 0)
    p.e["tank"] = (2.5 * cos(4 * pi * (ph - 0.55)), 0, 0)
    # legs
    for side, off in (("L", 0.0), ("R", 0.5)):
        q = (ph + off) % 1.0
        s = 1 if side == "L" else -1
        if not strafe:
            thigh = -42 * cos(2 * pi * q) * (0.8 if back else 1.0) + 4
            knee = 24 + 78 * bump(q, 0.66, 0.16) + 10 * bump(q, 0.10, 0.08)
            foot = -(thigh + knee) * 0.55 + 22 * bump(q, 0.47, 0.10) - 12 * bump(q, 0.92, 0.08)
            p.leg[side] = dict(kind="fk", thigh=(thigh, -2.5 * s, 0), knee=knee, foot=(foot, 0, 0))
        else:
            # side-shuffle: the leading leg reaches out, the trailing leg follows; knees lift in swing
            lead = 1 if (s == strafe) else -1
            swing_out = 20 * cos(2 * pi * q)
            abd = -(6 + swing_out * lead) * s
            knee = 18 + 58 * bump(q, 0.62, 0.15)
            thigh = -12 * bump(q, 0.62, 0.18) - 4
            foot = -(thigh + knee) * 0.6
            p.leg[side] = dict(kind="fk", thigh=(thigh, abd, 0), knee=knee, foot=(foot, 0, 0))
        p.toe[side] = 18 * bump(q, 0.44, 0.08)
    # arms: strong pump opposite to the legs (right arm forward when the left leg is forward)
    if not strafe:
        a = 1.0 if not back else 0.6
        sw_r = 50 * cyc(ph) * a + 10
        sw_l = -50 * cyc(ph) * a + 10
        p.arm["L"] = dict(kind="fk", abd=14 + 4 * syc(ph), swing=sw_l, elbow=88 + 14 * cyc(ph + 0.5))
        p.arm["R"] = dict(kind="fk", abd=16 - 4 * syc(ph), swing=sw_r, elbow=86 + 14 * cyc(ph))
        p.hand["L"] = ("e", (-10, 0, 0))
        p.hand["R"] = ("kit", kitq(-20 + 0.35 * sw_r, 0, 0))
    else:
        p.arm["L"] = dict(kind="fk", abd=22 + 6 * syc(2 * ph), swing=30, elbow=80)
        p.hand["L"] = ("e", (-10, 0, 0))
        p.arm["R"] = dict(kind="fk", abd=18, swing=48, elbow=78 + 5 * syc(2 * ph))
        p.hand["R"] = ("kit", kitq(-6, 6 * strafe, 0))
    return p


def clip_run(t, T):
    return run_like(t, T)


def clip_back(t, T):
    return run_like(t, T, back=True)


def clip_strafe_l(t, T):
    return run_like(t, T, strafe=1)


def clip_strafe_r(t, T):
    return run_like(t, T, strafe=-1)


def air_pose(p, k, ph=0.0):
    """shared airborne shape; k in [0, 1] = tuck amount."""
    p.e["spine"] = (4, 0, 0)
    p.e["chest"] = (-4, 0, 0)
    p.e["head"] = (-8, 0, 0)
    p.arm["L"] = dict(kind="fk", abd=58 + 8 * syc(ph), swing=58 + 10 * syc(ph + 0.25), elbow=38)
    p.arm["R"] = dict(kind="fk", abd=50 - 6 * syc(ph + 0.5), swing=70 + 8 * syc(ph + 0.75), elbow=44)
    p.hand["L"] = ("e", (-10, 0, 0))
    p.hand["R"] = ("kit", kitq(-10, 0, 0))
    p.leg["L"] = dict(kind="fk", thigh=(-30 * k - 8 * syc(ph), -6, 0), knee=40 + 45 * k, foot=(12, 0, 0))
    p.leg["R"] = dict(kind="fk", thigh=(-10 * k + 8 * syc(ph), 6, 0), knee=26 + 30 * k, foot=(18, 0, 0))
    for side in ("L", "R"):
        p.toe[side] = 8


def clip_jump(t, T):
    p = Pose()
    # 0 .. 0.07 anticipation crouch, 0.07 .. 0.17 launch extension, then tuck into the air pose
    a = sstep(0.0, 0.07, t) * (1 - sstep(0.07, 0.13, t))          # crouch weight
    l = sstep(0.07, 0.16, t) * (1 - sstep(0.20, 0.36, t))          # launch stretch weight
    air = sstep(0.16, 0.36, t)
    air_pose(p, 0.6 * air)
    base_l = p.leg["L"]
    base_r = p.leg["R"]
    # blend: crouch -> stretch -> air
    p.off = Vector((0, 0, -0.065 * a + 0.030 * l))
    p.e["hips"] = (10 * a - 4 * l, 0, 0)
    p.e["spine"] = (lerp(4, 16, a) - 8 * l, 0, 0)
    p.e["chest"] = (lerp(-4, 8, a) - 6 * l, 0, 0)
    p.e["head"] = (lerp(-8, -2, a) - 10 * l, 0, 0)
    p.e["crest_1"] = (8 * a - 10 * l - 4 * air, 0, 0)
    p.e["crest_2"] = (11 * a - 14 * l - 6 * air, 0, 0)
    p.e["crest_3"] = (14 * a - 18 * l - 8 * air, 0, 0)
    p.e["tank"] = (4 * a - 5 * l, 0, 0)
    sw = lerp(lerp(-10, -48, a), 135, l) if l > 0 else lerp(-10, -48, a)
    if t > 0.16:
        sw = lerp(135, 64, sstep(0.16, 0.36, t))
    p.arm["L"] = dict(kind="fk", abd=lerp(18, 42, air), swing=sw, elbow=lerp(30, 40, l))
    p.arm["R"] = dict(kind="fk", abd=lerp(18, 40, air), swing=sw * 0.85, elbow=lerp(40, 44, l))
    p.hand["R"] = ("kit", kitq(-25 + 30 * l, 0, 0))
    if t < 0.14:
        stand_legs(p, spread=0.01)
        fq = qe(-10 * l, 0, 0)
        for side in ("L", "R"):
            p.leg[side]["foot_q"] = qe(35 * l, 0, 0)
            if l > 0.01:
                # extension: straight legs, toes pointing
                s = 1 if side == "L" else -1
                p.leg[side] = dict(kind="fk", thigh=(-4 * l if side == "L" else 6 * l, -2 * s, 0),
                                   knee=lerp(40, 4, l), foot=(40 * l, 0, 0))
    else:
        k = sstep(0.14, 0.36, t)
        p.leg["L"] = dict(kind="fk", thigh=(lerp(-4, base_l["thigh"][0], k), -5, 0), knee=lerp(6, base_l["knee"], k),
                          foot=(lerp(40, 12, k), 0, 0))
        p.leg["R"] = dict(kind="fk", thigh=(lerp(6, base_r["thigh"][0], k), 5, 0), knee=lerp(6, base_r["knee"], k),
                          foot=(lerp(40, 18, k), 0, 0))
    return p


def clip_fall(t, T):
    ph = t / T
    p = Pose()
    air_pose(p, 0.55, ph)
    p.off = Vector((0, 0, 0.0))
    p.e["hips"] = (-4, 2 * syc(ph), 0)
    p.e["crest_1"] = (6 + 3 * syc(2 * ph), 2 * syc(ph), 0)
    p.e["crest_2"] = (9 + 4 * syc(2 * ph - 0.1), 3 * syc(ph - 0.1), 0)
    p.e["crest_3"] = (12 + 5 * syc(2 * ph - 0.2), 4 * syc(ph - 0.2), 0)
    p.e["tank"] = (-2 + 1.5 * syc(2 * ph), 0, 0)
    return p


def clip_land(t, T):
    p = Pose()
    imp = sstep(0.0, 0.05, t) * (1 - sstep(0.07, 0.30, t))
    rec = sstep(0.05, 0.30, t)
    p.off = Vector((0, 0, -0.085 * imp - 0.014 * (1 - imp) * rec))
    p.e["hips"] = (14 * imp, 0, 0)
    p.e["spine"] = (lerp(4, 16, imp), 0, 0)
    p.e["chest"] = (lerp(-4, 10, imp), 0, 0)
    p.e["head"] = (lerp(-8, 2, imp) * (1 - rec) + (-1.5) * rec, 0, 0)
    p.e["crest_1"] = (14 * imp - 4 * sstep(0.1, 0.2, t) * (1 - rec), 0, 0)
    p.e["crest_2"] = (20 * imp - 6 * sstep(0.12, 0.22, t) * (1 - rec), 0, 0)
    p.e["crest_3"] = (26 * imp - 8 * sstep(0.14, 0.24, t) * (1 - rec), 0, 0)
    p.e["tank"] = (6 * imp, 0, 0)
    p.arm["L"] = dict(kind="fk", abd=lerp(13, 48, imp), swing=lerp(4, 22, imp), elbow=lerp(22, 30, imp))
    p.arm["R"] = dict(kind="fk", abd=lerp(16, 42, imp), swing=lerp(12, 30, imp), elbow=lerp(48, 50, imp))
    p.hand["R"] = ("kit", kitq(lerp(-38, -30, imp), 4, 0))
    stand_legs(p, spread=0.012 + 0.012 * imp)
    return p


AIM_FIST = Vector((-0.070, -0.215, 0.585))


def aim_base(p, sway=0.0):
    p.e["spine"] = (4, 0, -4)
    p.e["chest"] = (-2 + sway, 0, -6)
    p.e["neck"] = (0, 0, 4)
    p.e["head"] = (-2, 0, 5)
    p.e["shoulder.R"] = (0, 0, 6)
    p.e["shoulder.L"] = (0, 0, 4)


def clip_aim(t, T):
    ph = t / T
    p = Pose()
    aim_base(p, 0.8 * syc(ph))
    wr = AIM_FIST - AIM_D * FIST_OFF + Vector((0, 0, 0.003 * syc(ph)))
    p.arm["R"] = dict(kind="ik", target=wr, pole=Vector((-0.30, 0.20, 0.30)))
    p.hand["R"] = ("kit", Quaternion())
    # left hand braces the kit's side
    p.arm["L"] = dict(kind="ik", target=AIM_LEFT, pole=Vector((0.40, 0.15, 0.35)))
    p.hand["L"] = ("e", (-60, 0, -40))
    return p


def clip_brush(t, T):
    """upper body: sweep the kit down to the ground in front and back up, like a brush stroke."""
    ph = t / T
    p = Pose()
    down = 0.5 - 0.5 * cos(2 * pi * ph)          # 0 at the top, 1 at the bottom of the stroke
    across = sin(2 * pi * ph)
    p.e["spine"] = (7 + 8 * down, 0, -8 + 10 * across)
    p.e["chest"] = (3 + 6 * down, 2 * across, -6 + 8 * across)
    p.e["neck"] = (2 * down, 0, 0)
    p.e["head"] = (4 + 7 * down, 0, 6 - 6 * across)
    p.e["shoulder.R"] = (0, 0, 8 * down)
    tgt = Vector((-0.10 + 0.10 * across, -0.25 - 0.03 * down, 0.56 - 0.26 * down))
    p.arm["R"] = dict(kind="ik", target=tgt, pole=Vector((-0.40, 0.25, 0.40)))
    p.hand["R"] = ("kit", kitq(-25 - 45 * down, -6 * across, 0))
    p.arm["L"] = dict(kind="fk", abd=28 + 10 * down, swing=18 - 16 * across, elbow=62 + 18 * down)
    p.hand["L"] = ("e", (-12, 0, 0))
    return p


def clip_slick_dive(t, T):
    p = Pose()
    c = sstep(0.0, 0.08, t) * (1 - sstep(0.08, 0.16, t))
    d = sstep(0.08, 0.34, t)
    p.off = Vector((0, -0.10 * d, -0.06 * c - 0.30 * d))
    p.e["hips"] = (10 * c + 72 * d, 0, 0)
    p.e["spine"] = (10 * c + 4 * d, 0, 0)
    p.e["chest"] = (6 * c - 2 * d, 0, 0)
    p.e["head"] = (-4 * c - 30 * d, 0, 0)
    p.e["crest_1"] = (8 * c - 18 * d, 0, 0)
    p.e["crest_2"] = (10 * c - 22 * d, 0, 0)
    p.e["crest_3"] = (12 * c - 26 * d, 0, 0)
    p.arm["L"] = dict(kind="fk", abd=lerp(20, 12, d), swing=lerp(-35 * c, 165, d), elbow=lerp(30, 8, d))
    p.arm["R"] = dict(kind="fk", abd=lerp(20, 12, d), swing=lerp(-35 * c, 162, d), elbow=lerp(40, 10, d))
    p.hand["R"] = ("kit", kitq(lerp(-35, 60, d), 0, 0))
    for side in ("L", "R"):
        s = 1 if side == "L" else -1
        p.leg[side] = dict(kind="fk", thigh=(lerp(-20 * c, 14, d), -3 * s, 0), knee=lerp(50 * c, 12, d),
                           foot=(lerp(-10 * c, 55, d), 0, 0))
        p.toe[side] = 10 * d
    return p


def clip_washed(t, T):
    p = Pose()
    hit = sstep(0.0, 0.10, t)
    fall = sstep(0.10, 0.55, t)
    settle = sstep(0.55, 0.85, t)
    wob = sin(2 * pi * t * 6) * (1 - settle) * 0.4
    p.off = Vector((0, 0.05 * hit + 0.06 * fall, -0.02 * hit - 0.24 * fall))
    p.e["hips"] = (-12 * hit - 30 * fall, 6 * fall, 30 * fall)
    p.e["spine"] = (-16 * hit + 10 * fall, 0, 6 * wob)
    p.e["chest"] = (-12 * hit + 8 * fall, -8 * fall, 8 * wob)
    p.e["head"] = (-18 * hit + 30 * fall + 8 * settle, 10 * fall, 10 * wob)
    for k, b in enumerate(("crest_1", "crest_2", "crest_3")):
        p.e[b] = (-10 * hit + (18 + 8 * k) * fall + 4 * wob, 6 * fall, 0)
    p.arm["L"] = dict(kind="fk", abd=lerp(15, 72, hit) - 30 * fall, swing=lerp(5, 60, hit) - 40 * fall + 10 * wob,
                      elbow=lerp(20, 40, hit))
    p.arm["R"] = dict(kind="fk", abd=lerp(15, 78, hit) - 40 * fall, swing=lerp(10, 70, hit) - 50 * fall - 10 * wob,
                      elbow=lerp(40, 30, hit))
    p.hand["R"] = ("kit", kitq(lerp(-30, 40, hit) - 70 * fall, 20 * fall, 0))
    for side in ("L", "R"):
        s = 1 if side == "L" else -1
        p.leg[side] = dict(kind="fk", thigh=(lerp(0, -20, hit) - 50 * fall + 6 * wob * s, -10 * s * fall, 0),
                           knee=lerp(8, 40, hit) + 20 * fall, foot=(lerp(0, 25, fall), 0, 0))
    p.e["tank"] = (-10 * hit + 6 * fall, 0, 0)
    return p


def clip_victory(t, T):
    ph = t / T
    p = Pose()
    hop = max(0.0, sin(2 * pi * ph))              # airborne half
    squash = max(0.0, -sin(2 * pi * ph))          # landing half
    p.off = Vector((0, 0, 0.060 * hop - 0.030 * squash))
    p.e["hips"] = (4 * squash, 0, 8 * syc(ph + 0.1))
    p.e["spine"] = (-4 * hop + 6 * squash, 0, 0)
    p.e["chest"] = (-6 * hop + 3 * squash, 0, -6 * syc(ph + 0.1))
    p.e["head"] = (-14 * hop + 2 * squash, 6 * syc(ph), 0)
    for k, b in enumerate(("crest_1", "crest_2", "crest_3")):
        p.e[b] = (-(4 + 3 * k) * cos(2 * pi * (ph - 0.12 - 0.06 * k)), 0, 0)
    # right arm thrusts the kit skyward; left arm pumps
    p.arm["R"] = dict(kind="fk", abd=20 + 8 * hop, swing=150 + 12 * hop, elbow=26 - 12 * hop)
    p.hand["R"] = ("kit", kitq(80 + 10 * hop, 0, 0))
    p.arm["L"] = dict(kind="fk", abd=30, swing=96 + 34 * hop, elbow=96 - 40 * hop)
    p.hand["L"] = ("e", (-20, 0, 0))
    if hop > 0:
        for side in ("L", "R"):
            s = 1 if side == "L" else -1
            p.leg[side] = dict(kind="fk", thigh=(-30 * hop, -4 * s, 0), knee=56 * hop, foot=(20 * hop, 0, 0))
            p.toe[side] = 10 * hop
    else:
        stand_legs(p, spread=0.02)
        p.off.z = -0.030 * squash
    p.e["tank"] = (-4 * hop + 5 * squash, 0, 0)
    return p


# name, fn, duration (s), loop, key-set ('full' | 'upper'), sheet time (fraction)
CLIPS = [
    ("idle", clip_idle, 2.0, True, "full", 0.25),
    ("run", clip_run, 0.4, True, "full", 0.08),
    ("jump", clip_jump, 0.40, False, "full", 0.35),
    ("fall", clip_fall, 0.60, True, "full", 0.0),
    ("land", clip_land, 0.30, False, "full", 0.17),
    ("aim", clip_aim, 1.0, True, "upper", 0.0),
    ("brush", clip_brush, 0.80, True, "upper", 0.45),
    ("slick_dive", clip_slick_dive, 0.40, False, "full", 0.55),
    ("washed", clip_washed, 0.90, False, "full", 0.25),
    ("victory", clip_victory, 1.0, True, "full", 0.25),
    ("lobby_idle", clip_lobby_idle, 3.0, True, "full", 0.0),
    ("strafe_l", clip_strafe_l, 0.40, True, "full", 0.30),
    ("strafe_r", clip_strafe_r, 0.40, True, "full", 0.30),
    ("back", clip_back, 14 / 30, True, "full", 0.20),      # whole frames at 30 fps
]
FPS = 30
RUN_SPEED = 5.2
AIM_D = None
AIM_LEFT = None


def setup_grip():
    """GRIP_Q = world rotation of hand.R when aiming (fist pointing forward, thumb up); AIM_LEFT."""
    global GRIP_Q, AIM_D, AIM_LEFT
    d0, f0, n0 = hand_frame("R")
    d1 = Vector((0.10, -1.0, -0.10)).normalized()
    f1 = Vector((0.0, -0.25, 1.0))
    f1 = (f1 - d1 * d1.dot(f1)).normalized()
    n1 = d1.cross(f1)
    M0 = Matrix((d0, f0, d0.cross(f0))).transposed()
    M1 = Matrix((d1, f1, n1)).transposed()
    GRIP_Q = (M1 @ M0.transposed()).to_quaternion()
    AIM_D = d1
    # the left hand braces the rear-left of the kit body (kit space +X side, above the grip)
    AIM_LEFT = AIM_FIST + Vector((0.080, 0.015, 0.035))


def action_fcurves(act):
    """every F-curve of a (Blender 5 slotted) action."""
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", []):
                out.extend(cb.fcurves)
    if not out and hasattr(act, "fcurves"):
        out = list(act.fcurves)
    return out


def set_linear(act):
    fcs = action_fcurves(act)
    for fc in fcs:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
        fc.update()
    if not fcs:
        raise RuntimeError("no F-curves found on action %s" % act.name)
    return len(fcs)


def key_clips(arm, only_verify=False):
    scn = bpy.context.scene
    scn.render.fps = FPS
    scn.render.fps_base = 1.0
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    if arm.animation_data is None:
        arm.animation_data_create()
    ad = arm.animation_data
    pbs = arm.pose.bones
    for pb in pbs:
        pb.rotation_mode = 'QUATERNION'
    meta = {}
    for name, fn, dur, loop, keyset, sheet in CLIPS:
        n = int(round(dur * FPS))
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        ad.action = act
        bones = BONES if keyset == "full" else UPPER
        prev = {}
        for fi in range(n + 1):
            t = dur * fi / n
            if loop and fi == n:
                t = 0.0           # exact first == last key
            W, Wt, P = evaluate(fn(t, dur))
            for b in bones:
                q = QR0i @ W[b] @ QR0
                q.normalize()
                if b in prev and prev[b].dot(q) < 0:
                    q.negate()
                prev[b] = q
                pb = pbs[b]
                pb.rotation_quaternion = q
                pb.keyframe_insert("rotation_quaternion", frame=fi)
            if keyset == "full":
                off = P["hips"] - REST["hips"]
                pbs["hips"].location = QR0i @ off
                pbs["hips"].keyframe_insert("location", frame=fi)
        nfc = set_linear(act)
        act.use_frame_range = True
        act.frame_range = (0, n)
        act.use_cyclic = bool(loop)
        slot = ad.action_slot
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, act)
        try:
            strip.action_slot = slot
        except Exception as ex:
            log("WARN action_slot", name, repr(ex))
        track.mute = True
        ad.action = None
        meta[name] = dict(frames=n, dur=dur, loop=loop, sheet=sheet, keyset=keyset)
        log("clip %-11s frames %3d  %.2fs %s %s  fcurves %d (linear)" % (name, n + 1, dur, "loop" if loop else "once",
                                                                          keyset, nfc))
    for pb in pbs:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    return meta


def fk_check(arm):
    """falsifier for the whole convention: our FK == Blender's evaluated pose on a busy pose."""
    ad = arm.animation_data
    ad.action = bpy.data.actions["run"]
    try:
        ad.action_slot = ad.action.slots[0]
    except Exception:
        pass
    ad.use_nla = False
    bpy.context.scene.frame_set(3)
    bpy.context.view_layer.update()
    W, Wt, P = evaluate(clip_run(3 / FPS, 0.4))
    worst = 0.0
    for b in BONES:
        hb = arm.pose.bones[b].head
        worst = max(worst, (Vector(hb) - P[b]).length)
    # swing-forward sanity: the right fist is ahead of the right shoulder in 'run' at frame 0 (arm forward)
    ad.action = None
    ad.use_nla = True
    log("FK check: max |blender - ours| joint error = %.6f m" % worst)
    if worst > 1e-4:
        raise RuntimeError("FK mismatch %.6f" % worst)
    Wq, Wtq, Pq = evaluate(clip_run(0.0, 0.4))
    assert Pq["hand.R"].y < REST["hand.R"].y - 0.05, "run: right arm should swing forward at phase 0"
    assert Pq["hand.L"].y > REST["hand.L"].y, "run: left arm should swing back at phase 0"
    # barrel direction sanity (world -Y rotated by the socket): idle/brush point down, lobby/victory up
    checks = []
    for name, t, T, want in (("idle", 0.5, 2.0, -1), ("brush", 0.4, 0.8, -1), ("lobby_idle", 0.0, 3.0, 1),
                             ("victory", 0.25, 1.0, 1), ("aim", 0.0, 1.0, 0)):
        fn = next(c[1] for c in CLIPS if c[0] == name)
        W_, Wt_, P_ = evaluate(fn(t, T))
        _, q = socket_world(Wt_, P_)
        bz = (q @ Vector((0, -1, 0))).z
        checks.append("%s %.2f" % (name, bz))
        assert (want == 0 and abs(bz) < 0.02) or (want != 0 and bz * want > 0.3), "barrel %s z=%.2f" % (name, bz)
    log("barrel z (down<0<up):", ", ".join(checks))


# ================================================================================ export + verify
def export_glb(path):
    strip_material_props()
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=False, export_yup=True, export_apply=False,
        export_texcoords=False, export_normals=True, export_materials='EXPORT', export_image_format='NONE',
        export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_extras=True, export_cameras=False,
        export_lights=False, export_skins=True, export_influence_nb=4, export_def_bones=False,
        export_rest_position_armature=True, export_animations=True, export_animation_mode='ACTIONS',
        export_force_sampling=False, export_anim_slide_to_zero=True, export_optimize_animation_size=False,
        export_frame_range=False, export_reset_pose_bones=True, export_anim_single_armature=True,
        export_nla_strips=True, export_morph=False, export_draco_mesh_compression_enable=False)


class Glb:
    def __init__(self, path):
        data = open(path, "rb").read()
        clen, _ = struct.unpack_from("<II", data, 12)
        self.j = json.loads(data[20:20 + clen].decode("utf-8"))
        off = 20 + clen
        blen, _ = struct.unpack_from("<II", data, off)
        self.bin = data[off + 8: off + 8 + blen]

    def acc(self, i):
        a = self.j["accessors"][i]
        bv = self.j["bufferViews"][a["bufferView"]]
        ncomp = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        fmt = {5126: "f", 5125: "I", 5123: "H", 5121: "B", 5122: "h", 5120: "b"}[a["componentType"]]
        size = struct.calcsize(fmt)
        stride = bv.get("byteStride", size * ncomp)
        base = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        out = []
        for k in range(a["count"]):
            v = struct.unpack_from("<" + fmt * ncomp, self.bin, base + k * stride)
            out.append(v if ncomp > 1 else v[0])
        return out


def _qmul(a, b):
    ax, ay, az, aw = a
    bx, by, bz, bw = b
    return (aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz)


def _qrot(q, v):
    x, y, z, w = q
    qv = Vector((x, y, z))
    vv = Vector(v)
    t = qv.cross(vv) * 2.0
    return vv + t * w + qv.cross(t)


def verify_glb(path, meta):
    g = Glb(path)
    j = g.j
    nodes = j["nodes"]
    names = [n.get("name", "") for n in nodes]
    ok = True
    report = {}
    joints = set()
    for sk in j.get("skins", []):
        joints |= {names[k] for k in sk["joints"]}
    miss = [b for b in BONES if b not in joints]
    report["skin_joints"] = len(joints)
    if miss:
        ok = False
        log("VERIFY FAIL skin misses", miss)
    rest_rot = [names[k] for k in range(len(nodes)) if names[k] in BONES and
                any(abs(a - b) > 1e-5 for a, b in zip(nodes[k].get("rotation", [0, 0, 0, 1]), [0, 0, 0, 1]))]
    report["joints_with_rest_rotation"] = rest_rot
    anims = {a["name"]: a for a in j.get("animations", [])}
    report["animations"] = list(anims)
    upper_ok = True
    loop_err = 0.0
    interps = set()

    def values(smp):
        out = g.acc(smp["output"])
        if smp.get("interpolation") == "CUBICSPLINE":
            out = out[1::3]
        return out
    for name, a in anims.items():
        tgt = set()
        for ch in a["channels"]:
            nn = names[ch["target"]["node"]]
            if nn not in BONES:
                ok = False
                log("VERIFY FAIL channel targets non-bone node", name, nn)
            tgt.add(nn)
            smp = a["samplers"][ch["sampler"]]
            interps.add(smp.get("interpolation", "LINEAR"))
            if meta.get(name, {}).get("loop"):
                out = values(smp)
                f, l = out[0], out[-1]
                if ch["target"]["path"] == "rotation":
                    d = min(max(abs(x - y) for x, y in zip(f, l)), max(abs(x + y) for x, y in zip(f, l)))
                else:
                    d = max(abs(x - y) for x, y in zip(f, l))
                loop_err = max(loop_err, d)
        if meta.get(name, {}).get("keyset") == "upper":
            extra = sorted(tgt - set(UPPER))
            if extra:
                upper_ok = False
                ok = False
                log("VERIFY FAIL upper clip %s keys %s" % (name, extra))
        report.setdefault("channel_nodes", {})[name] = len(tgt)
    report["loop_first_last_max_diff"] = loop_err
    report["sampler_interpolations"] = sorted(interps)
    if loop_err > 1e-4 or interps != {"LINEAR"}:
        ok = False
    report["upper_clips_upper_only"] = upper_ok
    # socket orientation in the aim clip at t = 0: evaluate the node hierarchy with animated TRS
    idx = {n: k for k, n in enumerate(names)}
    parent = {}
    for k, n in enumerate(nodes):
        for c in n.get("children", []):
            parent[c] = k
    trs = {}
    for k, n in enumerate(nodes):
        trs[k] = [list(n.get("translation", [0, 0, 0])), list(n.get("rotation", [0, 0, 0, 1]))]
    aim = anims.get("aim")
    for ch in aim["channels"]:
        smp = aim["samplers"][ch["sampler"]]
        v = values(smp)[0]
        k = ch["target"]["node"]
        if ch["target"]["path"] == "rotation":
            trs[k][1] = list(v)
        elif ch["target"]["path"] == "translation":
            trs[k][0] = list(v)

    def world(k):
        t, q = trs[k]
        if k in parent:
            pt, pq = world(parent[k])
            return pt + _qrot(pq, t), _qmul(pq, q)
        return Vector(t), tuple(q)
    sp, sq = world(idx["socket_weapon"])
    want = Vector((AIM_FIST.x, AIM_FIST.z, -AIM_FIST.y))
    report["aim_socket_pos_err_m"] = round((sp - want).length, 5)
    if (sp - want).length > 0.005:
        ok = False
        log("VERIFY FAIL aim socket position", sp, "want", want)
    # exported animation == our FK (joint world positions, glTF frame) on sample frames
    fk_err = 0.0
    for cname, frame in (("run", 3), ("aim", 0), ("brush", 9), ("jump", 4)):
        an = anims[cname]
        spec = next(c for c in CLIPS if c[0] == cname)
        W_, Wt_, P_ = evaluate(spec[1](spec[2] * frame / meta[cname]["frames"], spec[2]))
        for k, n in enumerate(nodes):
            trs[k] = [list(n.get("translation", [0, 0, 0])), list(n.get("rotation", [0, 0, 0, 1]))]
        for ch in an["channels"]:
            smp = an["samplers"][ch["sampler"]]
            v = values(smp)[frame]
            k = ch["target"]["node"]
            trs[k][0 if ch["target"]["path"] == "translation" else 1] = list(v)
        for b in BONES:
            if meta[cname]["keyset"] == "upper" and b not in UPPER and b not in ("root", "hips"):
                continue
            gp, _ = world(idx[b])
            ours = Vector((P_[b].x, P_[b].z, -P_[b].y))
            if meta[cname]["keyset"] == "upper":
                # upper clips leave the lower body at rest; our FK used the same rest hips
                pass
            fk_err = max(fk_err, (gp - ours).length)
    report["glb_vs_fk_max_err_m"] = round(fk_err, 6)
    if fk_err > 1e-3:
        ok = False
    # restore the aim t=0 TRS for the socket checks below
    for k, n in enumerate(nodes):
        trs[k] = [list(n.get("translation", [0, 0, 0])), list(n.get("rotation", [0, 0, 0, 1]))]
    for ch in aim["channels"]:
        smp = aim["samplers"][ch["sampler"]]
        v = values(smp)[0]
        trs[ch["target"]["node"]][0 if ch["target"]["path"] == "translation" else 1] = list(v)
    fwd = _qrot(sq, (0, 0, 1))     # kit barrel = Blender -Y = glTF +Z
    up = _qrot(sq, (0, 1, 0))
    report["aim_socket_pos"] = [round(c, 4) for c in sp]
    report["aim_barrel_dir"] = [round(c, 4) for c in fwd]
    report["aim_socket_up"] = [round(c, 4) for c in up]
    if fwd.dot(Vector((0, 0, 1))) < 0.99 or up.dot(Vector((0, 1, 0))) < 0.99:
        ok = False
        log("VERIFY FAIL socket orientation in aim", fwd, up)
    ex = {}
    for n in ("rig", "tank_dye"):
        ex[n] = nodes[idx[n]].get("extras")
    report["extras"] = ex
    if not ex["rig"] or "df_run_stride" not in ex["rig"]:
        ok = False
    if not ex["tank_dye"] or "df_fill_min" not in ex["tank_dye"]:
        ok = False
    tris = 0
    for m in j["meshes"]:
        for p in m["primitives"]:
            tris += j["accessors"][p["indices"]]["count"] // 3
    report["tris"] = tris
    report["materials"] = [m["name"] for m in j["materials"]]
    report["alpha_modes"] = {m["name"]: m.get("alphaMode", "OPAQUE") for m in j["materials"] if m.get("alphaMode")}
    report["size_kb"] = round(os.path.getsize(path) / 1024.0, 1)
    for k, v in report.items():
        log("VERIFY", k, "=", v)
    log("VERIFY RESULT:", "OK" if ok else "FAIL")
    return ok


# ================================================================================ renders
def setup_render(res=(560, 820), ortho=None):
    scn = bpy.context.scene
    try:
        scn.render.engine = 'BLENDER_EEVEE'
    except TypeError:
        scn.render.engine = 'BLENDER_EEVEE_NEXT'
    scn.render.resolution_x, scn.render.resolution_y = res
    scn.render.resolution_percentage = 100
    scn.render.image_settings.file_format = 'PNG'
    scn.render.image_settings.color_mode = 'RGB'
    try:
        scn.eevee.taa_render_samples = 48
    except Exception:
        pass
    try:
        scn.view_settings.view_transform = 'AgX'
        scn.view_settings.look = 'AgX - Medium High Contrast'
    except Exception:
        try:
            scn.view_settings.look = 'None'
        except Exception:
            pass
    world = bpy.data.worlds.get("QA") or bpy.data.worlds.new("QA")
    scn.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = next(n for n in world.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (0.62, 0.72, 0.84, 1.0)
    bg.inputs['Strength'].default_value = 0.85
    coll = bpy.data.collections.get("QA") or bpy.data.collections.new("QA")
    if coll.name not in scn.collection.children:
        scn.collection.children.link(coll)

    def sun(name, rot, energy, angle, shadow=True):
        L = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
        L.energy = energy
        L.angle = radians(angle)
        try:
            L.use_shadow = shadow
        except Exception:
            pass
        ob = bpy.data.objects.get(name) or bpy.data.objects.new(name, L)
        if ob.name not in coll.objects:
            coll.objects.link(ob)
        ob.rotation_euler = [radians(r) for r in rot]
        return ob
    sun("QA_key", (48, 0, -32), 3.2, 8)
    sun("QA_fill", (62, 0, 145), 0.9, 20, False)
    sun("QA_rim", (60, 0, 180 + 20), 1.6, 10, False)
    # floor disc
    if not bpy.data.objects.get("QA_floor"):
        mb = MB("QA_floor")
        rows = []
        for r in (0.35, 0.8, 1.4, 3.0):
            rows.append([mb.v(Vector((r * cos(2 * pi * j / 48), r * sin(2 * pi * j / 48), -0.0005)), "root")
                         for j in range(48)])
        grid(mb, rows, "QA_floor")
        fan(mb, mb.v(Vector((0, 0, -0.0005)), "root"), rows[0], "QA_floor", True)
        mb.F = [tuple(reversed(f)) for f in mb.F]          # face up (materials cull back faces)
        fm = make_material("QA_floor", "#DDE3EA", 0.8)
        me = bpy.data.meshes.new("QA_floor")
        me.from_pydata(mb.V, [], mb.F)
        me.materials.append(fm)
        fl = bpy.data.objects.new("QA_floor", me)
        coll.objects.link(fl)
    cam_d = bpy.data.cameras.get("QA_cam") or bpy.data.cameras.new("QA_cam")
    cam = bpy.data.objects.get("QA_cam") or bpy.data.objects.new("QA_cam", cam_d)
    if cam.name not in coll.objects:
        coll.objects.link(cam)
    scn.camera = cam
    return cam


def aim_camera(cam, target, az_deg, el_deg, dist, ortho=None, lens=85):
    a, e = radians(az_deg), radians(el_deg)
    # az 0 = in front of the runner (at -Y), + = toward the runner's left (+X)
    d = Vector((sin(a) * cos(e), -cos(a) * cos(e), sin(e)))
    cam.location = target + d * dist
    cam.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = 'PERSP'
        cam.data.lens = lens
    cam.data.clip_start = 0.05
    cam.data.clip_end = 50


def label_obj(text):
    ob = bpy.data.objects.get("QA_label")
    if ob is None:
        cu = bpy.data.curves.new("QA_label", 'FONT')
        ob = bpy.data.objects.new("QA_label", cu)
        bpy.data.collections["QA"].objects.link(ob)
        cu.align_x = 'LEFT'
        cu.size = 0.07
        m = make_material("QA_ink", "#1D2433", 0.9)
        cu.materials.append(m)
    ob.data.body = text
    return ob


def place_label(ob, cam, dist_below=0.07):
    """pin the label to the camera's top-left corner (ortho cameras)."""
    scn = bpy.context.scene
    rx, ry = scn.render.resolution_x, scn.render.resolution_y
    big = cam.data.ortho_scale if cam.data.type == 'ORTHO' else 1.4
    hh = big / 2 if ry >= rx else big / 2 * ry / rx
    hw = big / 2 if rx > ry else big / 2 * rx / ry
    ob.parent = cam
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.location = (-hw + 0.035, hh - 0.085, -1.0)
    ob.rotation_euler = (0, 0, 0)
    ob.scale = (big / 1.42,) * 3


def render_to(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def compose(paths, cols, out):
    import numpy as np
    ims = []
    for p in paths:
        im = bpy.data.images.load(p, check_existing=False)
        w, h = im.size
        a = np.empty(w * h * 4, dtype=np.float32)
        im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)
        ims.append(a)
        bpy.data.images.remove(im)
    h, w = ims[0].shape[:2]
    rows = (len(ims) + cols - 1) // cols
    canvas = np.ones((rows * h, cols * w, 4), dtype=np.float32)
    for k, a in enumerate(ims):
        r, c = divmod(k, cols)
        canvas[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w, :] = a
    img = bpy.data.images.new("QA_sheet", cols * w, rows * h, alpha=False)
    img.pixels.foreach_set(canvas.ravel())
    img.filepath_raw = out
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)
    for p in paths:
        try:
            os.remove(p)
        except Exception:
            pass
    log("sheet", out)


def set_clip(arm, name, frame):
    ad = arm.animation_data
    ad.use_nla = False
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
    act = bpy.data.actions.get(name) if name else None
    ad.action = act
    if act is not None:
        try:
            ad.action_slot = act.slots[0]
        except Exception:
            pass
    bpy.context.scene.frame_set(int(frame))
    bpy.context.view_layer.update()


def import_kit(socket):
    path = os.path.join(GLTF_DIR, "kit_mist_rasp.glb")
    if not os.path.isfile(path):
        log("WARN kit GLB missing; hero_with_kit will render without it:", path)
        return []
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        if o.type == 'MESH':
            me = o.data
            # the QA material multiplies attribute 'Col': give the kit one (imported COLOR_0 or white)
            if me.color_attributes and "Col" not in me.color_attributes:
                me.color_attributes[0].name = "Col"
            if "Col" not in me.color_attributes:
                ca = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
                ca.data.foreach_set("color", [1.0] * (4 * len(me.vertices)))
    for o in new:
        if o.parent is None:
            mw = o.matrix_basis.copy()
            o.parent = socket
            o.matrix_parent_inverse = Matrix.Identity(4)
            o.matrix_basis = mw
    log("kit imported:", [o.name for o in new])
    return new


def do_renders(arm, meta, which, socket, extra_hide, body_objs=()):
    tmp = os.path.join(REN_DIR, "_tmp")
    os.makedirs(tmp, exist_ok=True)
    cam = setup_render()
    cache = {}
    for o in extra_hide:
        o.hide_render = True
    kit_objs = import_kit(socket) if any(w in which for w in ("clips", "strip", "kit")) else []

    def show_kit(flag):
        for o in kit_objs:
            o.hide_render = not flag
    tgt = Vector((0, 0.02, 0.63))
    if "turntable" in which:
        show_kit(False)
        render_materials(1, cache)
        set_clip(arm, None, 0)
        for pb in arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
        paths = []
        for k, (az, lab) in enumerate(((0, "FRONT"), (40, "3/4"), (90, "SIDE"), (180, "BACK"))):
            aim_camera(cam, tgt, az, 6, 6.0, ortho=1.42)
            lb = label_obj(lab)
            place_label(lb, cam)
            p = os.path.join(tmp, "tt_%d.png" % k)
            render_to(p)
            paths.append(p)
        compose(paths, 4, os.path.join(REN_DIR, "hero_turntable.png"))
    if "clips" in which:
        show_kit(True)
        render_materials(1, cache)
        paths = []
        for name, fn, dur, loop, keyset, sheet in CLIPS:
            fr = int(round(sheet * meta[name]["frames"]))
            set_clip(arm, name, fr)
            aim_camera(cam, Vector((0, 0.0, 0.58)), 35, 8, 6.0, ortho=1.55)
            lb = label_obj(name)
            place_label(lb, cam)
            p = os.path.join(tmp, "clip_%s.png" % name)
            bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 400, 520
            render_to(p)
            paths.append(p)
        compose(paths, 7, os.path.join(REN_DIR, "hero_clips.png"))
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 560, 820
    if "strip" in which:
        # motion filmstrips (side view): run cycle and jump take-off, every other frame
        show_kit(True)
        render_materials(1, cache)
        scn = bpy.context.scene
        scn.render.resolution_x, scn.render.resolution_y = 300, 420
        paths = []
        for clip, frames in (("run", range(0, 12, 2)), ("jump", range(0, 12, 2))):
            for fr in frames:
                set_clip(arm, clip, fr)
                aim_camera(cam, Vector((0, 0.0, 0.60)), 90, 4, 6.0, ortho=1.45)
                lb = label_obj("%s %d" % (clip, fr))
                place_label(lb, cam)
                p = os.path.join(tmp, "strip_%s_%02d.png" % (clip, fr))
                render_to(p)
                paths.append(p)
        compose(paths, 6, os.path.join(REN_DIR, "hero_motion_strip.png"))
        scn.render.resolution_x, scn.render.resolution_y = 560, 820
    if "slick" in which:
        # swim form: body hidden, slick_fin shown on the floor (runtime toggles the same way)
        show_kit(False)
        render_materials(1, cache)
        set_clip(arm, None, 0)
        for o in body_objs:
            o.hide_render = True
        for o in extra_hide:
            o.hide_render = False
        paths = []
        for k, (az, el, lab) in enumerate(((35, 24, "SLICK 3/4"), (90, 8, "SLICK SIDE"), (160, 30, "SLICK WAKE"))):
            aim_camera(cam, Vector((0, 0.08, 0.10)), az, el, 6.0, ortho=1.25)
            lb = label_obj(lab)
            place_label(lb, cam)
            p = os.path.join(tmp, "slick_%d.png" % k)
            render_to(p)
            paths.append(p)
        compose(paths, 3, os.path.join(REN_DIR, "hero_slick.png"))
        for o in body_objs:
            o.hide_render = False
        for o in extra_hide:
            o.hide_render = True
    if "kit" in which:
        show_kit(True)
        render_materials(2, cache)
        paths = []
        for k, (clip, fr_frac, az, el, lab) in enumerate((("aim", 0.0, 35, 10, "AIM 3/4"), ("aim", 0.0, 90, 4, "AIM SIDE"),
                                                          ("idle", 0.25, 30, 8, "IDLE"), ("brush", 0.45, 60, 10, "BRUSH"))):
            set_clip(arm, clip, int(round(fr_frac * meta[clip]["frames"])))
            aim_camera(cam, Vector((0, -0.08, 0.60)), az, el, 6.0, ortho=1.55)
            lb = label_obj(lab)
            place_label(lb, cam)
            p = os.path.join(tmp, "kit_%d.png" % k)
            render_to(p)
            paths.append(p)
        compose(paths, 4, os.path.join(REN_DIR, "hero_with_kit.png"))
    try:
        os.rmdir(tmp)
    except Exception:
        pass


# ================================================================================ main
def clean_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras, bpy.data.actions,
                 bpy.data.armatures, bpy.data.curves, bpy.data.images):
        for d in list(coll):
            coll.remove(d)


def main():
    log("start; args", ARGV, "blender", bpy.app.version_string)
    os.makedirs(GLTF_DIR, exist_ok=True)
    os.makedirs(REN_DIR, exist_ok=True)
    clean_scene()
    scn = bpy.context.scene
    coll = scn.collection
    for name, (hexc, rough, metal, alpha) in HERO_MATS.items():
        make_material(name, hexc, rough, metal, alpha)

    setup_grip()
    body = MB("tide_runner")
    build_head(body)
    build_face(body)
    build_hair(body)
    build_hair_spikes(body)
    build_crest(body)
    build_neck(body)
    build_torso(body)
    build_tank_top(body)
    build_shorts(body)
    build_legs(body)
    build_shoes(body)
    build_arms(body)
    build_hands(body)
    build_tank(body)
    build_harness(body)
    dye = MB("tank_dye")
    build_tank_dye(dye)
    fin = MB("slick_fin")
    build_slick_fin(fin)
    total = body.tris() + dye.tris() + fin.tris()
    for label, tris, vol in body.part_report() + dye.part_report() + fin.part_report():
        log("part %-14s tris %5d  signed-vol %+.6f" % (label, tris, vol))
    log("TOTAL tris (pre-export):", total)

    crest_joints = {"crest_1": crest_point(0.16, 0.30, 0), "crest_2": crest_point(0.40, 0.34, 0),
                    "crest_3": crest_point(0.60, 0.40, 0)}
    arm = build_armature(coll, crest_joints)
    arm["df_run_stride"] = round(RUN_SPEED * 0.4, 4)
    arm["df_run_speed"] = RUN_SPEED
    order = list(HERO_MATS.keys())
    objs = []
    for mb in (body, dye, fin):
        ob = new_mesh_object(mb, mb.name, coll, order)
        ob.parent = arm
        mod = ob.modifiers.new("Armature", 'ARMATURE')
        mod.object = arm
        objs.append(ob)
    body_ob, dye_ob, fin_ob = objs
    dye_ob["df_fill_min"] = DYE_Z0
    dye_ob["df_fill_max"] = DYE_Z1
    # socket_weapon: at the right fist centre, rotated so the kit points forward in the aim pose
    sock = bpy.data.objects.new("socket_weapon", None)
    sock.empty_display_type = 'ARROWS'
    sock.empty_display_size = 0.08
    coll.objects.link(sock)
    sock.parent = arm
    sock.parent_type = 'BONE'
    sock.parent_bone = "hand.R"
    bpy.context.view_layer.update()
    sock.matrix_world = Matrix.Translation(fist_center("R")) @ GRIP_Q.inverted().to_matrix().to_4x4()
    bpy.context.view_layer.update()

    meta = key_clips(arm)
    fk_check(arm)
    glb = os.path.join(GLTF_DIR, "tide_runner.glb")
    if arg_flag("--no-export"):
        return
    # export: rest pose, every clip as its own animation
    arm.animation_data.action = None
    arm.animation_data.use_nla = True
    export_glb(glb)
    log("exported", glb, "%.1f KB" % (os.path.getsize(glb) / 1024.0))
    ok = verify_glb(glb, meta)
    if not ok:
        raise SystemExit(1)
    if arg_flag("--no-render"):
        return
    which = (arg_val("--only") or "turntable,clips,strip,slick,kit").split(",")
    do_renders(arm, meta, which, sock, [fin_ob], body_objs=[body_ob, dye_ob])


if __name__ == "__main__":
    main()
