"""
CRESTBOUND / NIM — shared constants + hero-local geometry builders for the
headless Blender build (bpy). Everything here is authored in HERO-LOCAL space
(the runtime's frame: +X = Nim's right, +Y = up, -Z = forward, feet on y = 0,
metres) and converted to Blender's Z-up frame only when a Blender object is
made (`to_blender`): hero (x, y, z) -> Blender (x, -z, y), which the glTF
exporter (export_yup=True) maps back to exactly (x, y, z). Verified by
_tools probe: a vertex written as Blender (1, -3, 2) read back as glTF (1, 2, 3).

Proportions, palette and every face constant are the numbers in
runtime/player/hero.js (P, COL, EYE_*, GOG_*, ...) so the GLB agrees with the
procedural rig to the millimetre — the bone positions in particular.
"""
import math

TAU = math.pi * 2.0
DEG = math.pi / 180.0

# ---------------------------------------------------------------- proportions
P = dict(
    hipY=0.66, hipDrop=0.04, spineY=0.10, chestY=0.18, neckY=0.16, headY=0.12,
    headR=0.250, torsoR=0.205, waistR=0.170, shoulderX=0.185, shoulderY=0.055,
    upperArm=0.215, lowerArm=0.195, handLen=0.105, legX=0.112, upperLeg=0.245,
    lowerLeg=0.215, ankleY=0.160, bootH=0.160, bootL=0.300, bootW=0.170,
)
RIG_PIVOT_Y = 0.62
CHEST_Y = P["hipY"] + P["spineY"] + P["chestY"]     # 0.94
NECK_Y = CHEST_Y + P["neckY"]                        # 1.10
HEAD_Y = NECK_Y + P["headY"]                         # 1.22

# head shape (hero.js headDirRadius)
HEAD_JAW = 0.040
HEAD_BROW = 0.0085
NOSE_LAT = -0.26
NOSE_NY = math.sin(NOSE_LAT); NOSE_NZ = -math.cos(NOSE_LAT)
NOSE_UY = math.cos(NOSE_LAT); NOSE_UZ = math.sin(NOSE_LAT)
NOSE_AX = 0.200; NOSE_AY_UP = 0.240; NOSE_AY_DN = 0.175; NOSE_H = 0.048

EYE_YAW = 0.285; EYE_R = 0.056; EYE_PROUD = 0.0131; EYE_Y = 0.036
PUPIL_R = 0.0200; IRIS_INNER = 0.0092; IRIS_LIMBAL = 0.0182; GLINT_R = 0.0105
BROW_Y = 0.086
GOG_Y = 0.172; GOG_AZ = 0.380; GOG_STRAP_Y0 = 0.150; GOG_STRAP_Y1 = 0.205
MOUTH_Y = -0.145; MOUTH_SWEEP = 0.300; MOUTH_LIFT = 0.020

# scarf (runtime verlet numbers)
SCARF_LINKS = 7; SCARF_SEG = 0.105
SCARF_ANCHOR_BACK = 0.135; SCARF_ANCHOR_UP = 0.030; SCARF_ANCHOR_SIDE = 0.070
SCARF_W0 = 0.085; SCARF_W1 = 0.046; SCARF_H0 = 0.021; SCARF_H1 = 0.009

# ------------------------------------------------------------------- palette
COL = dict(
    coat=0xd8532b, coatDark=0xa63a1c, trim=0x2c4a52, skin=0xc0916b, skinShade=0xa87a58,
    hair=0x4a2f22, boot=0x37312e, leather=0x7a5233, rope=0x8a6f45, metal=0x9d8148,
    lens=0x9fe8ff, eyeWhite=0xf7f1e6, eyePupil=0x161b22, irisRim=0x2b1a10, iris=0xa8621f,
    irisIn=0x6d3a12, lip=0x9c4a3e, blanket=0xcfd6c8, buckle=0xd8b25c, scarf=0xeaf1dc,
)


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    """0xRRGGBB (sRGB) -> linear (r, g, b)."""
    return (srgb_to_lin(((h >> 16) & 255) / 255.0), srgb_to_lin(((h >> 8) & 255) / 255.0),
            srgb_to_lin((h & 255) / 255.0))


def hex_srgb(h):
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


# ------------------------------------------------------------------- vectors
def clamp(x, a, b): return a if x < a else (b if x > b else x)
def clamp01(x): return clamp(x, 0.0, 1.0)
def lerp(a, b, t): return a + (b - a) * t


def smoothstep(e0, e1, x):
    t = clamp01((x - e0) / (e1 - e0)) if e1 != e0 else (0.0 if x < e0 else 1.0)
    return t * t * (3 - 2 * t)


def vadd(a, b): return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
def vsub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def vmul(a, s): return [a[0] * s, a[1] * s, a[2] * s]
def vdot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def vcross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def vlen(a): return math.sqrt(vdot(a, a))


def vnorm(a):
    l = vlen(a) or 1.0
    return [a[0] / l, a[1] / l, a[2] / l]


def quat_from_unit_vectors(a, b):
    """Quaternion (w,x,y,z) rotating unit a onto unit b (three.js setFromUnitVectors)."""
    r = vdot(a, b) + 1.0
    if r < 1e-9:
        if abs(a[0]) > abs(a[2]):
            q = [0.0, -a[1], a[0], 0.0]
        else:
            q = [0.0, 0.0, -a[2], a[1]]
    else:
        c = vcross(a, b)
        q = [r, c[0], c[1], c[2]]
    l = math.sqrt(sum(v * v for v in q)) or 1.0
    return [v / l for v in q]


def quat_mul(a, b):
    aw, ax, ay, az = a; bw, bx, by, bz = b
    return [aw * bw - ax * bx - ay * by - az * bz,
            aw * bx + ax * bw + ay * bz - az * by,
            aw * by - ax * bz + ay * bw + az * bx,
            aw * bz + ax * by - ay * bx + az * bw]


def quat_axis(axis, ang):
    s = math.sin(ang * 0.5)
    return [math.cos(ang * 0.5), axis[0] * s, axis[1] * s, axis[2] * s]


def quat_xyz(x, y, z):
    """three.js Euler 'XYZ' (Rx * Ry * Rz) as a quaternion (w,x,y,z)."""
    return quat_mul(quat_mul(quat_axis((1, 0, 0), x), quat_axis((0, 1, 0), y)), quat_axis((0, 0, 1), z))


def quat_to_mat(q):
    w, x, y, z = q
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]


def mat_apply(m, v):
    return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]]


def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return [[1, 0, 0], [0, c, -s], [0, s, c]]


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, 0, s], [0, 1, 0], [-s, 0, c]]


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return [[c, -s, 0], [s, c, 0], [0, 0, 1]]


# ----------------------------------------------------------- the head surface
def head_dir_radius(dx, dy, dz):
    """Radius (m) of the head along unit direction, head-local. Port of hero.js."""
    R = P["headR"]
    u = dy
    dn = -u if u < 0 else 0.0
    r = R * (1 + 0.024 * (1 - u * u) - 0.030 * u - 0.020 * dn * dn)
    front = -dz if dz < 0 else 0.0
    jf = front * front * (3 - 2 * front)
    jd = dn * dn * math.sqrt(dn) * (1 - smoothstep(0.86, 1.0, dn))
    r += HEAD_JAW * jf * jd
    bw = (u - 0.215) / 0.150
    r += HEAD_BROW * jf * front * math.exp(-bw * bw)
    na = dy * NOSE_NY + dz * NOSE_NZ
    if na > 0.30:
        nu = dy * NOSE_UY + dz * NOSE_UZ
        raw_u = math.atan2(nu, na)
        ar = math.atan2(dx, na) / NOSE_AX
        au = raw_u / (NOSE_AY_UP if raw_u >= 0 else NOSE_AY_DN)
        q = ar * ar + au * au
        if q < 1:
            r += NOSE_H * (1 - q ** 2.5)
    return r


def head_point(a, e):
    """Surface point at azimuth a, elevation e. x = r cos a, z = r sin a: FACE at a = -pi/2."""
    ce, se = math.cos(e), math.sin(e)
    dx, dy, dz = ce * math.cos(a), se, ce * math.sin(a)
    r = head_dir_radius(dx, dy, dz)
    return [dx * r, dy * r, dz * r]


def head_normal(a, e):
    h = 0.006
    lim = math.pi * 0.5 - 1e-3
    e0 = clamp(e, -lim, lim)
    p1 = head_point(a + h, e0); p2 = head_point(a - h, e0)
    eu = min(lim, e0 + h); ed = max(-lim, e0 - h)
    p3 = head_point(a, eu); p4 = head_point(a, ed)
    t1 = vsub(p1, p2); t2 = vsub(p3, p4)
    n = vnorm(vcross(t1, t2))
    p = head_point(a, e0)
    if vdot(n, p) < 0:
        n = vmul(n, -1)
    return n


def head_elev_at_height(a, y):
    lo, hi = -math.pi * 0.5, math.pi * 0.5
    for _ in range(30):
        m = (lo + hi) * 0.5
        if head_point(a, m)[1] < y:
            lo = m
        else:
            hi = m
    return (lo + hi) * 0.5


def head_radius_at_height(a, y):
    p = head_point(a, head_elev_at_height(a, y))
    return math.hypot(p[0], p[2])


HEAD_TOP = head_dir_radius(0, 1, 0)


# ------------------------------------------------------------------ geometry
class Geo:
    """A hero-local triangle/quad soup with per-loop UVs and optional colours."""

    def __init__(self):
        self.verts = []      # [x,y,z]
        self.faces = []      # [i0,i1,i2(,i3)]
        self.uvs = []        # per face: [(u,v), ...]
        self.colors = None   # per vertex (r,g,b) or None
        self.uvmode = []     # per face: 0 = keep authored UVs, 1 = smart-project at pack time

    def add(self, other):
        base = len(self.verts)
        if other.colors is not None and self.colors is None:
            self.colors = [(1.0, 1.0, 1.0)] * base
        if self.colors is not None and other.colors is None:
            self.colors = self.colors + [(1.0, 1.0, 1.0)] * len(other.verts)
        elif self.colors is not None:
            self.colors = self.colors + list(other.colors)
        self.verts.extend([list(v) for v in other.verts])
        self.faces.extend([[i + base for i in f] for f in other.faces])
        self.uvs.extend([list(u) for u in other.uvs])
        self.uvmode.extend(list(other.uvmode))
        return self

    def transform(self, m, t=(0, 0, 0)):
        self.verts = [vadd(mat_apply(m, v), t) for v in self.verts]
        return self

    def translate(self, x, y, z):
        self.verts = [[v[0] + x, v[1] + y, v[2] + z] for v in self.verts]
        return self

    def scale(self, sx, sy=None, sz=None):
        sy = sx if sy is None else sy
        sz = sx if sz is None else sz
        self.verts = [[v[0] * sx, v[1] * sy, v[2] * sz] for v in self.verts]
        return self

    def rotate(self, rx=0, ry=0, rz=0):
        """hero.js `place` order: rotateX, then Y, then Z (each about the origin)."""
        if rx:
            self.transform(rot_x(rx))
        if ry:
            self.transform(rot_y(ry))
        if rz:
            self.transform(rot_z(rz))
        return self

    def orient_to(self, px, py, pz, nx, ny, nz, roll=0.0):
        """Place the +Y axis along (n) at (p) — hero.js orientTo."""
        q = quat_from_unit_vectors([0, 1, 0], vnorm([nx, ny, nz]))
        m = quat_to_mat(q)
        if roll:
            m = mat_mul(m, rot_y(roll))
        return self.transform(m, (px, py, pz))

    def tri_count(self):
        return sum(len(f) - 2 for f in self.faces)


def place(g, x=0, y=0, z=0, rx=0, ry=0, rz=0, sx=None, sy=None, sz=None):
    if sx is not None:
        g.scale(sx, sy, sz)
    g.rotate(rx, ry, rz)
    if x or y or z:
        g.translate(x, y, z)
    return g


def lathe(pts, seg, closed=False, arc=None):
    """Revolve profile [(r, y)] (bottom->top) about +Y. r == 0 rows become poles.
    UV: u around (in metres of circumference at the mean radius), v along the profile.
    `arc=(a0, a1)` sweeps only that azimuth range (an OPEN band, e.g. a goggle strap
    that must stop at the cups instead of running under the lenses)."""
    g = Geo()
    n = len(pts)
    s = max(4, int(seg))
    if arc is not None:
        a0, a1 = arc
        cols = s + 1
        def ang(i): return a0 + (a1 - a0) * (i / s)
    else:
        cols = s
        def ang(i): return (i / s) * TAU
    # profile arc-length for v
    v_at = [0.0]
    for i in range(1, n):
        v_at.append(v_at[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    if closed:
        v_at.append(v_at[-1] + math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]))
    total = v_at[-1] or 1.0
    r_mean = sum(p[0] for p in pts) / n
    u_scale = TAU * max(r_mean, 0.004)
    rows = []           # per profile point: list of vertex ids (len s) or [pole]
    for j, (r, y) in enumerate(pts):
        if r < 1e-6:
            rows.append([len(g.verts)])
            g.verts.append([0.0, y, 0.0])
        else:
            ids = []
            for i in range(cols):
                a = ang(i)
                ids.append(len(g.verts))
                g.verts.append([math.cos(a) * r, y, math.sin(a) * r])
            rows.append(ids)
    pairs = list(range(n - 1)) + ([n - 1] if closed else [])
    span = s if arc is None else s
    for jj, j in enumerate(pairs):
        j1 = (j + 1) % n
        r0, r1 = pts[j][0], pts[j1][0]
        v0, v1 = v_at[jj] / total * total, v_at[jj + 1] / total * total
        v0 = v_at[jj]; v1 = v_at[jj + 1]
        if r0 < 1e-6 and r1 < 1e-6:
            continue
        for i in range(span):
            i1 = (i + 1) % s if arc is None else i + 1
            u0, u1 = (i / s) * u_scale, ((i + 1) / s) * u_scale
            if r0 < 1e-6:        # bottom pole fan
                g.faces.append([rows[j][0], rows[j1][i1], rows[j1][i]])
                g.uvs.append([((u0 + u1) * 0.5, v0), (u1, v1), (u0, v1)])
            elif r1 < 1e-6:      # top pole fan
                g.faces.append([rows[j][i], rows[j][i1], rows[j1][0]])
                g.uvs.append([(u0, v0), (u1, v0), ((u0 + u1) * 0.5, v1)])
            else:
                # outward winding: (i,j) -> (i,j+1) -> (i+1,j+1) -> (i+1,j)
                g.faces.append([rows[j][i], rows[j1][i], rows[j1][i1], rows[j][i1]])
                g.uvs.append([(u0, v0), (u0, v1), (u1, v1), (u1, v0)])
            g.uvmode.append(0)
    return g


def limb(r_top, r_bot, length, seg, rings):
    """Tapered capsule, origin at the TOP of the shaft, shaft down -Y (hero.js limbGeo)."""
    rr = max(3, int(rings))
    pts = []
    for i in range(rr + 1):
        a = (i / rr) * math.pi * 0.5
        pts.append((r_bot * math.sin(a), -length - r_bot * math.cos(a)))
    pts.append((r_top, 0.0))
    for i in range(1, rr + 1):
        a = (i / rr) * math.pi * 0.5
        pts.append((r_top * math.cos(a), r_top * math.sin(a)))
    return lathe(pts, seg)


def sphere(r, seg, rings):
    pts = []
    for j in range(rings + 1):
        e = -math.pi * 0.5 + (j / rings) * math.pi
        pts.append((r * math.cos(e), r * math.sin(e)))
    return lathe(pts, seg)


def head_geo(seg, rings):
    """The skull sampled off head_dir_radius with the face-weighted azimuth warp."""
    s = max(10, int(seg)); n = max(8, int(rings))
    g = Geo()
    lim = math.pi * 0.5
    W = 0.45
    a_face = -math.pi * 0.5

    def warp(t):
        phi = t * TAU - math.pi
        return a_face + phi - W * math.sin(phi)
    R = P["headR"]
    rows = []
    for j in range(n + 1):
        e = -lim + (j / n) * (2 * lim)
        if j == 0 or j == n:
            rows.append([len(g.verts)])
            g.verts.append(head_point(0, -lim + 1e-4 if j == 0 else lim - 1e-4))
            g.verts[-1] = [0.0, g.verts[-1][1], 0.0]
        else:
            ids = []
            for i in range(s):
                ids.append(len(g.verts))
                g.verts.append(head_point(warp(i / s), e))
            rows.append(ids)
    us = TAU * R
    vs = math.pi * R
    for j in range(n):
        for i in range(s):
            i1 = (i + 1) % s
            u0, u1 = (i / s) * us, ((i + 1) / s) * us
            v0, v1 = (j / n) * vs, ((j + 1) / n) * vs
            if j == 0:
                g.faces.append([rows[0][0], rows[1][i1], rows[1][i]])
                g.uvs.append([((u0 + u1) * 0.5, v0), (u1, v1), (u0, v1)])
            elif j == n - 1:
                g.faces.append([rows[j][i], rows[j][i1], rows[n][0]])
                g.uvs.append([(u0, v0), (u1, v0), ((u0 + u1) * 0.5, v1)])
            else:
                g.faces.append([rows[j][i], rows[j + 1][i], rows[j + 1][i1], rows[j][i1]])
                g.uvs.append([(u0, v0), (u0, v1), (u1, v1), (u1, v0)])
            g.uvmode.append(0)
    return g


def surface_tube(a0, a1, y_at, half_w, half_h, lift, samples, ring):
    """A closed tube swept along an arc riding the head surface (brows, lip)."""
    N = max(3, int(samples)); K = max(4, int(ring))
    cx, sx, nx, hw, hh = [], [], [], [], []
    for i in range(N):
        f = (i / (N - 1)) * 2 - 1
        a = a0 + (a1 - a0) * (i / (N - 1))
        y = y_at(f)
        e = head_elev_at_height(a, y)
        p = head_point(a, e); nn = head_normal(a, e)
        cx.append(vadd(p, vmul(nn, lift))); nx.append(nn)
        hw.append(half_w(f)); hh.append(half_h(f))
    for i in range(N):
        ia = max(0, i - 1); ib = min(N - 1, i + 1)
        t = vnorm(vsub(cx[ib], cx[ia]))
        sx.append(vnorm(vcross(nx[i], t)))
    g = Geo()
    rows = []
    for i in range(N):
        ids = []
        for k in range(K):
            th = (k / K) * TAU
            c, si = math.cos(th), math.sin(th)
            w = vadd(vmul(sx[i], hw[i] * c), vmul(nx[i], hh[i] * si))
            ids.append(len(g.verts)); g.verts.append(vadd(cx[i], w))
        rows.append(ids)
    circ = TAU * max(hw) * 1.0
    length = sum(vlen(vsub(cx[i + 1], cx[i])) for i in range(N - 1)) or 1.0
    for i in range(N - 1):
        for k in range(K):
            k1 = (k + 1) % K
            u0, u1 = (k / K) * circ, ((k + 1) / K) * circ
            v0, v1 = (i / (N - 1)) * length, ((i + 1) / (N - 1)) * length
            # winding matches hero.js surfaceTubeGeo (i,k)->(i+1,k+1)->(i+1,k) ; (i,k)->(i,k+1)->(i+1,k+1)
            g.faces.append([rows[i][k], rows[i][k1], rows[i + 1][k1], rows[i + 1][k]])
            g.uvs.append([(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
            g.uvmode.append(0)
    # caps
    for i, rev in ((0, False), (N - 1, True)):
        ids = rows[i] if not rev else list(reversed(rows[i]))
        c = [sum(g.verts[v][j] for v in ids) / K for j in range(3)]
        cid = len(g.verts); g.verts.append(c)
        for k in range(K):
            k1 = (k + 1) % K
            g.faces.append([cid, ids[k1], ids[k]] if not rev else [cid, ids[k1], ids[k]])
            g.uvs.append([(0, 0), (0.01, 0), (0, 0.01)])
            g.uvmode.append(1)
    return g


def hair_shell(seg, rings, off):
    R = P["headR"]
    s = max(8, int(seg)); n = max(3, int(rings))
    y_top = HEAD_TOP + 0.012

    def line(a):
        # hero.js ran 0.60R at the front, which put the hairline (0.15 m) straight through the
        # goggle cups (0.107..0.237 m) and showed as a brown blob behind each lens. A plateau
        # above the cups across the whole front, dropping to the temples by ~78 deg off-axis.
        front = -math.sin(a)
        fs = smoothstep(0.20, 0.95, front)
        return R * (0.10 + 0.80 * fs - 0.03 * front
                    + (0.055 * math.sin(a * 5 + 0.7) + 0.032 * math.sin(a * 8 - 1.1)) * (1 - 0.7 * fs))

    def ring(a, j):
        t = j / n
        y0 = line(a)
        y = y0 + (y_top - y0) * (t ** 0.80)
        # the radius is asked of the skull just BELOW the crown: asking above it returns the
        # pole (r = 0), which collapsed the top ring to a point, made the top row and the fan
        # zero-area in 3D and baked their tangent frames as saturated garbage
        r = head_radius_at_height(a, min(y, HEAD_TOP - 0.003)) + off * (1 - t * t * t)
        return [math.cos(a) * r, y, math.sin(a) * r]
    g = Geo()
    rows = []
    for j in range(n + 1):
        ids = []
        for i in range(s):
            ids.append(len(g.verts)); g.verts.append(ring((i / s) * TAU, j))
        rows.append(ids)
    # close the crown with a centre vertex
    top = len(g.verts); g.verts.append([0.0, y_top + 0.004, 0.0])
    us = TAU * R; vs = 0.5 * R
    for j in range(n):
        for i in range(s):
            i1 = (i + 1) % s
            u0, u1 = (i / s) * us, ((i + 1) / s) * us
            v0, v1 = (j / n) * vs, ((j + 1) / n) * vs
            g.faces.append([rows[j][i], rows[j + 1][i], rows[j + 1][i1], rows[j][i1]])
            g.uvs.append([(u0, v0), (u0, v1), (u1, v1), (u1, v0)])
            g.uvmode.append(0)
    for i in range(s):
        i1 = (i + 1) % s
        g.faces.append([rows[n][i], rows[n][i1], top])
        # a real disc in UV space, not a sliver: slivers baked as saturated tangent garbage
        a0, a1 = (i / s) * TAU, ((i + 1) / s) * TAU
        rr = 0.06
        g.uvs.append([(math.cos(a0) * rr, math.sin(a0) * rr), (math.cos(a1) * rr, math.sin(a1) * rr), (0.0, 0.0)])
        g.uvmode.append(0)
    return g


def bevel_box(w, h, d, bevel, seg=1):
    """Chamfered box centred on the origin (hero.js bevelBoxGeometry). Built with bmesh."""
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= w; v.co.y *= h; v.co.z *= d
    b = max(0.0008, min(bevel, w * 0.5 * 0.85, h * 0.5 * 0.85, d * 0.5 * 0.85))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=b, segments=max(1, int(seg)), profile=0.5,
                    affect='EDGES', clamp_overlap=True)
    bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
    g = Geo()
    g.verts = [[v.co.x, v.co.y, v.co.z] for v in bm.verts]
    for f in bm.faces:
        idx = [v.index for v in f.verts]
        g.faces.append(idx)
        # box projection by dominant normal axis, metres
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        uv = []
        for v in f.verts:
            c = v.co
            if ax == 0:
                uv.append((c.y, c.z))
            elif ax == 1:
                uv.append((c.x, c.z))
            else:
                uv.append((c.x, c.y))
        g.uvs.append(uv)
        g.uvmode.append(1)
    bm.free()
    return g


def scarf_rest_points():
    """Rest particle positions (hero-local, 8 points) — hanging down the back and
    off the right shoulder from the nape anchor, each link SCARF_SEG long."""
    ax = SCARF_ANCHOR_SIDE
    ay = NECK_Y + SCARF_ANCHOR_UP
    az = SCARF_ANCHOR_BACK
    pts = [[ax, ay, az]]
    # out of the nape (the anchor is inside the skull, as in the runtime), over the wrap
    # ring, then down the back beside the pack with a gentle S: the shape a scarf takes
    # when it has just stopped swinging
    dirs = [(0.30, -0.55, 0.78), (0.18, -0.80, 0.55), (0.06, -0.96, 0.25), (-0.04, -1.0, 0.05),
            (-0.12, -0.98, -0.08), (-0.20, -0.95, -0.12), (-0.26, -0.92, -0.10)]
    p = pts[0]
    for d in dirs:
        d = vnorm(list(d))
        p = vadd(p, vmul(d, SCARF_SEG))
        pts.append(p)
    return pts


def scarf_geo(points):
    """Four-sided tapered prism along the chain (hero.js _writeScarfGeometry at rest).
    Returns (geo, ring_vertex_ids) so the caller can weight rings to link bones."""
    N = len(points)
    g = Geo()
    rings = []
    up = [0, 1, 0]
    for i in range(N):
        if i < N - 1:
            t = vnorm(vsub(points[i + 1], points[i]))
        else:
            t = vnorm(vsub(points[i], points[i - 1]))
        s = [-t[2], 0.0, t[0]]
        if math.hypot(s[0], s[2]) < 0.08:
            s = [1.0, 0.0, 0.0]
        s = vnorm(s)
        nrm = vcross(s, t)
        f01 = i / (N - 1)
        tw = 0.35 * f01
        ct, st = math.cos(tw), math.sin(tw)
        s2 = vsub(vmul(s, ct), vmul(nrm, st))
        n2 = vadd(vmul(nrm, ct), vmul(s, st))
        w = lerp(SCARF_W0, SCARF_W1, f01); h = lerp(SCARF_H0, SCARF_H1, f01)
        cx = [w, w, -w, -w]; cn = [h, -h, -h, h]
        ids = []
        for k in range(4):
            ids.append(len(g.verts))
            g.verts.append(vadd(points[i], vadd(vmul(s2, cx[k]), vmul(n2, cn[k]))))
        rings.append(ids)
    length = SCARF_SEG * (N - 1)
    for i in range(N - 1):
        for k in range(4):
            k2 = (k + 1) % 4
            a0, a1 = rings[i], rings[i + 1]
            g.faces.append([a0[k], a1[k], a1[k2], a0[k2]])
            u0 = k * 0.11; u1 = (k + 1) * 0.11
            v0 = (i / (N - 1)) * length; v1 = ((i + 1) / (N - 1)) * length
            g.uvs.append([(u0, v0), (u0, v1), (u1, v1), (u1, v0)])
            g.uvmode.append(0)
    # tip cap
    r = rings[-1]
    g.faces.append([r[0], r[1], r[2], r[3]])
    g.uvs.append([(0, 0), (0.02, 0), (0.02, 0.02), (0, 0.02)]); g.uvmode.append(1)
    r = rings[0]
    g.faces.append([r[3], r[2], r[1], r[0]])
    g.uvs.append([(0, 0), (0.02, 0), (0.02, 0.02), (0, 0.02)]); g.uvmode.append(1)
    return g, rings


# ------------------------------------------------------------ into Blender
HERO_TO_BLENDER = ((1, 0, 0), (0, 0, -1), (0, 1, 0))     # (x, y, z) -> (x, -z, y)


def to_b(v):
    return (v[0], -v[2], v[1])


def to_blender_object(geo, name, bone_weights, material, sharp_deg=58.0, smooth=True):
    """Create a mesh object from a hero-local Geo. `bone_weights` is either a bone
    name (rigid, all verts 1.0) or a list per vertex of [(bone, w), ...]."""
    import bpy
    me = bpy.data.meshes.new(name)
    verts = [to_b(v) for v in geo.verts]
    me.from_pydata(verts, [], geo.faces)
    me.update()
    uv = me.uv_layers.new(name="UVMap")
    li = 0
    for f, fuv in zip(me.polygons, geo.uvs):
        for k in range(len(fuv)):
            uv.data[f.loop_start + k].uv = fuv[k]
        li += 1
    mode = me.attributes.new("uvmode", 'INT', 'FACE')
    mode.data.foreach_set("value", [int(m) for m in geo.uvmode])
    if geo.colors is not None:
        col = me.color_attributes.new("Col", 'FLOAT_COLOR', 'POINT')
        flat = []
        for c in geo.colors:
            flat.extend([c[0], c[1], c[2], 1.0])
        col.data.foreach_set("color", flat)
    me.polygons.foreach_set("use_smooth", [smooth] * len(me.polygons))
    me.validate(verbose=False)
    # sharp edges by dihedral angle
    import bmesh
    bm = bmesh.new(); bm.from_mesh(me)
    bm.normal_update()
    thr = math.radians(sharp_deg)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            ang = e.calc_face_angle(0.0)
            e.smooth = ang < thr
    bm.to_mesh(me); bm.free()
    me.update()
    if material is not None:
        me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    if isinstance(bone_weights, str):
        vg = ob.vertex_groups.new(name=bone_weights)
        vg.add(list(range(len(verts))), 1.0, 'REPLACE')
    else:
        groups = {}
        for vi, lst in enumerate(bone_weights):
            for bone, w in lst:
                groups.setdefault(bone, []).append((vi, w))
        for bone, lst in groups.items():
            vg = ob.vertex_groups.new(name=bone)
            for vi, w in lst:
                vg.add([vi], w, 'REPLACE')
    return ob
