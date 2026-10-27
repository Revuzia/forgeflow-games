"""VALE ambient props (r12 M14): the faction banners, resin lamps, fair bunting and paper lanterns that carry the
maps' ambient life (src/render/ambient.ts instances them from content/maps/*.json art.ambient.props; the T0 amb_*
effects in content/vfx.json add the flames and the lantern glow at their `fx` points).

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/props/ambient_props.py [--only banner_aubade,...]
    (pure numpy: kit.py's parts; no Blender needed)

  banner_aubade    spire language: a tall pale-ash pole (3.4 m) with a pointed dawnglass-grey finial, a short
                   crossbar and a long narrow LINEN pennant with a swallowtail, painted with the slate spire mark.
  banner_serenade  dome language: a low walnut pole (2.6 m) with an oxidised-iron drum-and-dome finial, a wide
                   T-bar and a broad FELT banner with a round foot, painted with the ochre dome arc.
  resin_lamp       a walnut post on an ironstone block with an open lampresin dish under an iron cap on three
                   rods (the flame is the amb_*_resin_flame effect at `fx`, 1.74 m up).
  bunting          a fair garland: two posts 8 m apart, a sagging cord and fourteen muted cloth pennants (linen,
                   rose-lilac lacquer, sage, ochre, slate; never a seat colour, saturation <= 0.3).
  fair_lantern     a shepherd's-crook post with a round ribbed paper lantern (the glow is amb_fray_lantern_glow).

Stone tells you whose land; light tells you whose side (WORLD §2): the banners carry the SIDE's materials and
marks (linen and slate spire, felt and ochre dome), never a team hue. Values stay in the environment band
(albedo sRGB <= ~0.55, L* <= 60 on screen after the grade).

Vertex attributes: POSITION, NORMAL, COLOR_0 (linear RGB, alpha 0 = matte) and _SWAY (0..1: how far the vertex
follows the cloth sway: 0 on poles and the attached edge of a cloth, 1 at its free edge). The renderer's sway is
slow (<= 0.5 Hz, tokens vfx.tiers.T0) and runs in the vertex shader. Real size in metres, origin at the ground
contact, Blender axes (Z up; the writer converts to glTF Y up). Cloth is single-layer: the renderer draws it
double-sided.

Output: art/out/props/ambient/<name>.glb and art/renders/props/ambient_props_report.json.
"""
from __future__ import annotations

import json
import math
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from kit import Part, merge, tube  # noqa: E402

GAME = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OUT = os.path.join(GAME, "art", "out", "props", "ambient")
RENDERS = os.path.join(GAME, "art", "renders", "props")


def lin(h: str) -> np.ndarray:
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Prop:
    """parts with a colour (n,3 linear) and a sway weight (n,) each"""

    def __init__(self):
        self.parts: list[Part] = []
        self.cols: list[np.ndarray] = []
        self.sway: list[np.ndarray] = []

    def add(self, p: Part, col, sway=0.0):
        n = len(p.P)
        c = np.asarray(col, float)
        self.parts.append(p)
        self.cols.append(np.broadcast_to(c, (n, 3)).copy() if c.ndim == 1 else c)
        self.sway.append(np.broadcast_to(np.asarray(sway, float), (n,)).copy())

    def build(self):
        m = merge(self.parts)
        return m, np.vstack(self.cols), np.concatenate(self.sway)


def shade(P, col, z0, z1, lo=0.7):
    """a baked vertical light ramp: darker at the foot (ground occlusion), full at the top"""
    k = lo + (1 - lo) * smooth(z0, z1, P[:, 2])
    return np.asarray(col)[None, :] * k[:, None]


def grid(w: int, h: int, fn):
    """a (w+1) × (h+1) vertex grid through fn(u, v) -> (x, y, z); returns P, F, U, V"""
    us, vs = np.linspace(0, 1, w + 1), np.linspace(0, 1, h + 1)
    U, V = np.meshgrid(us, vs)
    U, V = U.ravel(), V.ravel()
    P = np.array([fn(u, v) for u, v in zip(U, V)])
    F = []
    for j in range(h):
        for i in range(w):
            a = j * (w + 1) + i
            b, c, d = a + 1, a + w + 1, a + w + 2
            F += [[a, c, b], [b, c, d]]
    return P, np.array(F), U, V


def box(c, s) -> Part:
    x, y, z = c
    a, b, h = s[0] / 2, s[1] / 2, s[2] / 2
    P = np.array([[x + dx * a, y + dy * b, z + dz * h] for dz in (-1, 1) for dy in (-1, 1) for dx in (-1, 1)])
    F = np.array([[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6], [0, 1, 4], [1, 5, 4], [2, 6, 3], [3, 6, 7], [0, 4, 2], [2, 4, 6], [1, 3, 5], [3, 7, 5]])
    # per-face normals (hard edges): duplicate verts per face
    PP, FF = [], []
    for f in F:
        base = len(PP)
        PP += [P[f[0]], P[f[1]], P[f[2]]]
        FF.append([base, base + 1, base + 2])
    PP = np.array(PP)
    FF = np.array(FF)
    n = np.cross(PP[FF[:, 1]] - PP[FF[:, 0]], PP[FF[:, 2]] - PP[FF[:, 0]])
    c0 = np.array(c)
    flip = np.einsum("ij,ij->i", n, PP[FF].mean(1) - c0) < 0
    FF[flip] = FF[flip][:, [0, 2, 1]]
    N = np.repeat(np.cross(PP[FF[:, 1]] - PP[FF[:, 0]], PP[FF[:, 2]] - PP[FF[:, 0]]), 3, axis=0)
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    order = FF.ravel()
    Nv = np.zeros_like(PP)
    Nv[order] = N
    return Part(PP, FF, Nv)


def cone(base, top, r, sides=6) -> Part:
    b = np.asarray(base, float)
    t = np.asarray(top, float)
    ax = (t - b) / np.linalg.norm(t - b)
    ref = np.array([1.0, 0, 0]) if abs(ax[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(ax, ref); u /= np.linalg.norm(u)
    v = np.cross(ax, u)
    ring = [b + (u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)]
    P = np.array(ring + [t, b])
    F = []
    for k in range(sides):
        F += [[k, (k + 1) % sides, sides], [(k + 1) % sides, k, sides + 1]]
    F = np.array(F)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    cen = (b + t) / 2
    flip = np.einsum("ij,ij->i", fn, P[F].mean(1) - cen) < 0
    F[flip] = F[flip][:, [0, 2, 1]]
    return Part(P, F)


def cloth(P, F, N=None) -> Part:
    p = Part(P, F, N)
    return p


# ── the props ────────────────────────────────────────────────────────────────────────────────────
ASH = lin("#8F8574")
WALNUT = lin("#4E3B2C")
IRON = lin("#3E3B38")
IRONSTONE = lin("#5B4A3C")
LINEN = lin("#ABA393")
SLATE = lin("#4F5A66")
GLASS = lin("#7D8E9B")
FELT = lin("#6E4630")
OCHRE = lin("#A07E4C")
RESIN = lin("#8A5A2A")


def banner_aubade() -> Prop:
    pr = Prop()
    H = 3.4
    pole = tube([[0, 0, 0], [0, 0, H * 0.5], [0, 0, H]], [0.05, 0.043, 0.036], sides=6)
    pr.add(pole, shade(pole.P, ASH, 0, 1.2))
    fin = cone([0, 0, H], [0, 0, H + 0.34], 0.05, sides=4)
    pr.add(fin, shade(fin.P, GLASS, H, H + 0.3, 0.85))
    bar = tube([[-0.34, 0, H - 0.36], [0.34, 0, H - 0.36]], [0.024, 0.024], sides=5, cap_end=True)
    pr.add(bar, ASH * 0.92)
    # the pennant: 0.6 m wide, 1.62 m long below the bar, a swallowtail notch 0.32 m deep
    top, L, W, notch = H - 0.38, 1.62, 0.6, 0.32

    def f(u, v):
        x = (u - 0.5) * W
        # the swallowtail: the foot edge rises toward the middle
        foot = L - notch * (1 - abs(2 * u - 1))
        z = top - v * foot
        return (x, 0.012 * math.sin(u * math.pi * 2.0) * v, z)   # a faint hang crease

    P, Fc, U, V = grid(6, 14, f)
    depth = top - P[:, 2]
    col = np.repeat(LINEN[None, :], len(P), 0)
    # the spire mark: a tall narrow slate triangle in the upper middle; a slate band above the tails
    tri = (np.abs(U - 0.5) * 2 < (depth - 0.18) / 0.62 * 0.42) & (depth > 0.18) & (depth < 0.8)
    col[tri] = SLATE
    band = (depth > 1.0) & (depth < 1.1)
    col[band] = SLATE * 1.1
    col *= (0.82 + 0.18 * (1 - smooth(0.0, 1.6, depth)))[:, None]       # the cloth darkens toward its foot
    sway = smooth(0.0, 1.5, depth) ** 1.2
    pr.add(cloth(P, Fc), col, sway)
    return pr


def banner_serenade() -> Prop:
    pr = Prop()
    H = 2.6
    pole = tube([[0, 0, 0], [0, 0, H * 0.5], [0, 0, H]], [0.065, 0.06, 0.055], sides=8)
    pr.add(pole, shade(pole.P, WALNUT, 0, 1.0))
    drum = tube([[0, 0, H], [0, 0, H + 0.09]], [0.1, 0.1], sides=8, cap_end=True)
    pr.add(drum, IRON * 1.1)
    # a low dome cap on the drum (dome language)
    dome = []
    sides, rings = 8, 3
    for i in range(rings + 1):
        th = (math.pi / 2) * i / rings
        for k in range(sides):
            ph = 2 * math.pi * k / sides
            dome.append([math.cos(th) * 0.1 * math.cos(ph), math.cos(th) * 0.1 * math.sin(ph), H + 0.09 + math.sin(th) * 0.07])
    dome = np.array(dome)
    Fd = []
    for i in range(rings):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            Fd += [[a, b, b + sides], [a, b + sides, a + sides]]
    dp = Part(dome, np.array(Fd))
    pr.add(dp, IRON)
    bar = tube([[-0.58, 0, H - 0.22], [0.58, 0, H - 0.22]], [0.032, 0.032], sides=6, cap_end=True)
    pr.add(bar, WALNUT * 1.05)
    # the banner: 1.04 m wide, 1.0 m deep with a round (half-ellipse) foot
    top, W, L = H - 0.25, 1.04, 1.0

    def f(u, v):
        x = (u - 0.5) * W
        xs = (u - 0.5) * 2
        foot = 0.62 + 0.38 * math.sqrt(max(0.0, 1 - xs * xs))
        z = top - v * L * foot
        return (x, 0.01 * math.sin(u * math.pi * 3) * v, z)

    P, Fc, U, V = grid(8, 10, f)
    depth = top - P[:, 2]
    col = np.repeat(FELT[None, :], len(P), 0)
    # the dome arc: an ochre half-ring in the middle of the cloth, and an ochre hem
    cx, cz = 0.0, top - 0.68
    r = np.hypot(P[:, 0] - cx, (P[:, 2] - cz) * 1.0)
    arc = (r > 0.2) & (r < 0.3) & (P[:, 2] > cz)
    col[arc] = OCHRE
    hem = depth < 0.06
    col[hem] = OCHRE * 0.8
    col *= (0.82 + 0.18 * (1 - smooth(0.0, 1.0, depth)))[:, None]
    sway = smooth(0.0, 0.95, depth) ** 1.2
    pr.add(cloth(P, Fc), col, sway)
    return pr


def resin_lamp() -> Prop:
    """an ironstone block, a walnut post, a shallow lampresin dish that holds the flame (amb_*_resin_flame at 1.74 m)
    and an iron cap on three rods: an open lamp, so the flame reads from the gameplay camera"""
    pr = Prop()
    base = box((0, 0, 0.13), (0.34, 0.34, 0.26))
    pr.add(base, IRONSTONE * 0.9)
    post = tube([[0, 0, 0.26], [0, 0, 1.58]], [0.05, 0.042], sides=8)
    pr.add(post, shade(post.P, WALNUT, 0.3, 1.6, 0.8))
    collar = tube([[0, 0, 1.56], [0, 0, 1.6]], [0.075, 0.075], sides=6, cap_end=True)
    pr.add(collar, IRON)
    # the dish: a flared six-sided bowl of lampresin with an iron lip
    z0, z1 = 1.6, 1.7
    dish = tube([[0, 0, z0], [0, 0, z0 + 0.05], [0, 0, z1]], [0.05, 0.11, 0.14], sides=6, cap_end=False)
    pr.add(dish, RESIN * 0.9)
    lip = tube([[0, 0, z1 - 0.008], [0, 0, z1 + 0.008]], [0.145, 0.145], sides=6)
    pr.add(lip, IRON * 1.1)
    # three rods to a low iron cap well above the flame
    zc = 2.0
    for k in range(3):
        a = 2 * math.pi * k / 3 + math.pi / 6
        x, y = 0.135 * math.cos(a), 0.135 * math.sin(a)
        rod = tube([[x, y, z1], [x * 0.75, y * 0.75, zc]], [0.01, 0.009], sides=4)
        pr.add(rod, IRON)
    capc = cone([0, 0, zc], [0, 0, zc + 0.12], 0.13, sides=6)
    pr.add(capc, IRON * 1.15)
    ring = tube([[0, 0, zc + 0.12], [0, 0, zc + 0.16]], [0.02, 0.012], sides=4, cap_end=True)
    pr.add(ring, IRON)
    return pr


FAIR = ["#A69D8A", "#7E6474", "#66705A", "#8C6E42", "#59616B"]


def bunting() -> Prop:
    pr = Prop()
    span, H, sag = 8.0, 3.0, 0.62
    for s in (-1, 1):
        post = tube([[s * span / 2, 0, 0], [s * span / 2, 0, H + 0.2]], [0.055, 0.045], sides=6, cap_end=True)
        pr.add(post, shade(post.P, WALNUT * 1.1, 0, 1.2))
    n = 24
    xs = np.linspace(-span / 2, span / 2, n + 1)

    def cord_z(x):
        u = (x + span / 2) / span
        return H - sag * 4 * u * (1 - u)

    cpts = [[x, 0, cord_z(x)] for x in xs]
    cord = tube(cpts, [0.012] * len(cpts), sides=4)
    cu = (cord.P[:, 0] + span / 2) / span
    pr.add(cord, ASH * 0.7, 0.35 * np.sin(np.pi * np.clip(cu, 0, 1)))
    k = 14
    for i in range(k):
        u = (i + 0.5) / k
        x = -span / 2 + u * span
        w, L = 0.3, 0.38
        zc = cord_z(x)

        def f(a, b, x=x, zc=zc, w=w, L=L):
            # a triangle: top edge along the cord (a = across), point at the bottom
            half = (1 - b) * w / 2
            return (x + (a - 0.5) * 2 * half, 0.0, zc - 0.015 - b * L)

        P, Fc, A, B = grid(2, 3, f)
        col = lin(FAIR[i % len(FAIR)])
        cc = np.repeat(col[None, :], len(P), 0) * (0.85 + 0.15 * (1 - B))[:, None]
        sw = 0.35 * math.sin(math.pi * u) + 0.65 * smooth(0.0, 1.0, B)
        pr.add(cloth(P, Fc), cc, sw)
    return pr


PAPER = lin("#A88E6A")


def fair_lantern() -> Prop:
    pr = Prop()
    H = 2.5
    post = tube([[0, 0, 0], [0, 0, H], [0.08, 0, H + 0.14], [0.36, 0, H + 0.16]], [0.045, 0.04, 0.03, 0.025], sides=6, cap_end=True)
    pr.add(post, shade(post.P, WALNUT * 1.1, 0, 1.2))
    hang = tube([[0.36, 0, H + 0.16], [0.36, 0, H - 0.08]], [0.006, 0.006], sides=3)
    pr.add(hang, IRON, smooth(H + 0.16, H - 0.08, hang.P[:, 2]) * 0.3)
    # the paper lantern: a ribbed ellipsoid (dark ribs, warm paper), centre 0.36, 0, H - 0.3
    cx, cz, rx, rz = 0.36, H - 0.31, 0.16, 0.21
    seg, rings = 10, 7
    P = []
    for i in range(rings + 1):
        th = math.pi * i / rings
        for kk in range(seg):
            ph = 2 * math.pi * kk / seg
            rr = rx * math.sin(th) * (1 - 0.06 * (kk % 2))
            P.append([cx + rr * math.cos(ph), rr * math.sin(ph), cz + rz * math.cos(th)])
    P = np.array(P)
    F = []
    for i in range(rings):
        for kk in range(seg):
            a, b = i * seg + kk, i * seg + (kk + 1) % seg
            F += [[a, b + seg, b], [a, a + seg, b + seg]]
    F = np.array(F)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    flip = np.einsum("ij,ij->i", fn, P[F].mean(1) - np.array([cx, 0, cz])) < 0
    F[flip] = F[flip][:, [0, 2, 1]]
    lp = Part(P, F)
    ribs = (np.arange(len(P)) % seg) % 2 == 1
    col = np.repeat(PAPER[None, :], len(P), 0)
    col[ribs] *= 0.55
    caps = (np.abs(P[:, 2] - cz) > rz * 0.86)
    col[caps] = IRON * 1.2
    pr.add(lp, col, 0.3)
    return pr


PROPS = {
    "banner_aubade": (banner_aubade, {"fx": None}),
    "banner_serenade": (banner_serenade, {"fx": None}),
    "resin_lamp": (resin_lamp, {"fx": [0.0, 1.74, 0.0]}),
    "bunting": (bunting, {"fx": None}),
    "fair_lantern": (fair_lantern, {"fx": [0.36, 2.19, 0.0]}),
}


# ── GLB (POSITION, NORMAL, COLOR_0, _SWAY) ───────────────────────────────────────────────────────
def write_glb(path: str, P, N, C, F, S, name: str) -> int:
    P = np.asarray(P, float); N = np.asarray(N, float); C = np.clip(np.asarray(C, float), 0, 1); F = np.asarray(F)
    Py = np.column_stack([P[:, 0], P[:, 2], -P[:, 1]]).astype(np.float32)
    Ny = np.column_stack([N[:, 0], N[:, 2], -N[:, 1]])
    Ny = (Ny / np.maximum(np.linalg.norm(Ny, axis=1, keepdims=True), 1e-12)).astype(np.float32)
    Cq = np.round(np.column_stack([C, np.zeros(len(C))]) * 65535).astype(np.uint16)
    Sq = np.clip(np.asarray(S, float), 0, 1).astype(np.float32)
    big = len(P) > 65535
    Iq = F.astype(np.uint32 if big else np.uint16).ravel()
    chunks, views, off = [], [], 0

    def view(b: bytes, target=None):
        nonlocal off
        pad = (-len(b)) % 4
        chunks.append(b + b"\0" * pad)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(b)}
        if target:
            v["target"] = target
        views.append(v)
        off += len(b) + pad
        return len(views) - 1

    vp, vn, vc, vs = view(Py.tobytes(), 34962), view(Ny.tobytes(), 34962), view(Cq.tobytes(), 34962), view(Sq.tobytes(), 34962)
    vi = view(Iq.tobytes(), 34963)
    acc = [
        {"bufferView": vp, "componentType": 5126, "count": len(Py), "type": "VEC3", "min": Py.min(0).tolist(), "max": Py.max(0).tolist()},
        {"bufferView": vn, "componentType": 5126, "count": len(Ny), "type": "VEC3"},
        {"bufferView": vc, "componentType": 5123, "normalized": True, "count": len(Cq), "type": "VEC4"},
        {"bufferView": vs, "componentType": 5126, "count": len(Sq), "type": "SCALAR"},
        {"bufferView": vi, "componentType": 5125 if big else 5123, "count": len(Iq), "type": "SCALAR"},
    ]
    gl = {
        "asset": {"version": "2.0", "generator": "vale art/blender/props/ambient_props.py"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2, "_SWAY": 3},
                                                  "indices": 4, "material": 0, "mode": 4}]}],
        "materials": [{"name": "vale_ambient_vcol", "doubleSided": True,
                       "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.88}}],
        "accessors": acc, "bufferViews": views, "buffers": [{"byteLength": off}],
    }
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    binb = b"".join(chunks)
    total = 12 + 8 + len(js) + 8 + len(binb)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<III", 0x46546C67, 2, total))
        fh.write(struct.pack("<II", len(js), 0x4E4F534A)); fh.write(js)
        fh.write(struct.pack("<II", len(binb), 0x004E4942)); fh.write(binb)
    return total


def main():
    args = sys.argv[1:]
    only = args[args.index("--only") + 1].split(",") if "--only" in args else list(PROPS)
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(RENDERS, exist_ok=True)
    rp = os.path.join(RENDERS, "ambient_props_report.json")
    report = json.load(open(rp)) if os.path.isfile(rp) else {}
    for name in only:
        fn, meta = PROPS[name]
        m, C, S = fn().build()
        path = os.path.join(OUT, f"{name}.glb")
        size = write_glb(path, m.P, m.N, C, m.F, S, name)
        ext = (m.P.max(0) - m.P.min(0)).round(3).tolist()
        report[name] = {"tris": int(len(m.F)), "verts": int(len(m.P)), "kb": round(size / 1024, 1), "size_m": ext,
                        "swayVerts": int((S > 0.01).sum()), "fx": meta["fx"],
                        "albedoMaxSrgb": round(float(np.max(np.where(C <= 0.0031308, C * 12.92, 1.055 * C ** (1 / 2.4) - 0.055))), 3)}
        print(f"{name}: {len(m.F)} tris, {len(m.P)} verts, {size / 1024:.1f} KB, size {ext}")
    with open(rp, "w") as fh:
        json.dump(report, fh, indent=1, sort_keys=True)


if __name__ == "__main__":
    main()
