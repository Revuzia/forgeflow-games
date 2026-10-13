"""Numpy signed-distance sculpting (ART 2.0 step 1: sculpted volumes).

A *shape* is built as an ordered list of operations on one distance grid:

    S = sdf.Sculpt()
    S.add(sdf.Ellipsoid(c, (0.2, 0.15, 0.3)), k=0.06)          # smooth union, blend radius 6 cm
    S.add(sdf.RoundCone(a, b, 0.08, 0.05), k=0.04)
    S.sub(sdf.Capsule(a, b, 0.01), k=0.008)                     # carve a groove (smooth subtract)
    S.inter(sdf.HalfSpace(p, n), k=0.01)                         # cut a plane (smooth intersect)
    verts, quads = S.mesh(voxel=0.008)                          # narrow-band grid + surface nets
    obj = sdf.to_object("body_sdf", verts, quads, col)

Distances are metres, world space (Blender Z-up, models face -Y). Primitives evaluate only inside
their own bounding box (+ blend radius), so a body of ~100 volumes on a 1 cm grid takes seconds.
Blending uses the polynomial smooth min/max (k = blend radius): muscles flow into each other
instead of meeting at a crease, which is what separates a sculpt from a tube mannequin.

Everything here is deterministic (no RNG except seeded noise tables) and numpy-only.
"""
from __future__ import annotations

import math

import numpy as np

BIG = 1.0e3


# ── math helpers ─────────────────────────────────────────────────────────────────────────────────
def _v(x) -> np.ndarray:
    return np.asarray(tuple(x), dtype=np.float64)


def frame(z, x_hint=(1.0, 0.0, 0.0)) -> np.ndarray:
    """Rows = local X, Y, Z axes (world) with local Z along `z` and X as close to `x_hint` as possible."""
    z = _v(z)
    z = z / (np.linalg.norm(z) + 1e-12)
    x = _v(x_hint)
    x = x - z * x.dot(z)
    if np.linalg.norm(x) < 1e-6:
        x = np.array([0.0, 1.0, 0.0]) - z * z[1]
    x = x / np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z])


def rot_x(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]], dtype=np.float64)


def rot_y(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float64)


def rot_z(deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]], dtype=np.float64)


def axes_from_rot(R) -> np.ndarray:
    """A rotation matrix (columns = local axes in world) -> rows-as-axes frame used by primitives."""
    return np.asarray(R, dtype=np.float64).T.copy()


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def _len(p, axis=-1):
    return np.sqrt(np.sum(p * p, axis=axis))


# ── noise (seeded gradient noise, numpy) ─────────────────────────────────────────────────────────
class Noise:
    """3D gradient (Perlin-style) noise with a seeded permutation; fbm / ridged helpers.
    Values are roughly in -1..1. Works on (N, 3) arrays of points (metres) at any frequency."""

    _GRAD = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1],
                      [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0],
                      [0, -1, 1], [0, -1, -1]], dtype=np.float32)

    def __init__(self, seed: int = 0):
        rs = np.random.RandomState(seed & 0x7FFFFFFF)
        p = rs.permutation(256).astype(np.int32)
        self.perm = np.concatenate([p, p])

    def _h(self, x, y, z):
        P = self.perm
        return P[P[P[x & 255] + (y & 255)] + (z & 255)] & 15

    def __call__(self, pts, freq: float = 1.0, offset=(0.0, 0.0, 0.0)) -> np.ndarray:
        q = np.asarray(pts, dtype=np.float64) * freq + _v(offset)
        fl = np.floor(q)
        f = (q - fl).astype(np.float32)
        i = fl.astype(np.int64)
        x0, y0, z0 = i[:, 0], i[:, 1], i[:, 2]
        fx, fy, fz = f[:, 0], f[:, 1], f[:, 2]
        u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        v = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
        w = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
        G = self._GRAD
        out = None
        acc = {}
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    g = G[self._h(x0 + dx, y0 + dy, z0 + dz)]
                    acc[(dx, dy, dz)] = g[:, 0] * (fx - dx) + g[:, 1] * (fy - dy) + g[:, 2] * (fz - dz)
        x00 = acc[(0, 0, 0)] + u * (acc[(1, 0, 0)] - acc[(0, 0, 0)])
        x10 = acc[(0, 1, 0)] + u * (acc[(1, 1, 0)] - acc[(0, 1, 0)])
        x01 = acc[(0, 0, 1)] + u * (acc[(1, 0, 1)] - acc[(0, 0, 1)])
        x11 = acc[(0, 1, 1)] + u * (acc[(1, 1, 1)] - acc[(0, 1, 1)])
        y0_ = x00 + v * (x10 - x00)
        y1_ = x01 + v * (x11 - x01)
        out = y0_ + w * (y1_ - y0_)
        return out.astype(np.float32)

    def fbm(self, pts, freq=1.0, octaves=4, lac=2.03, gain=0.5, offset=(0.0, 0.0, 0.0)) -> np.ndarray:
        amp, tot, s = 1.0, 0.0, 0.0
        for o in range(octaves):
            s = s + amp * self(pts, freq * lac ** o, (offset[0] + 17.1 * o, offset[1] + 5.3 * o, offset[2] + 9.7 * o))
            tot += amp
            amp *= gain
        return s / tot

    def ridged(self, pts, freq=1.0, octaves=3, lac=2.0, gain=0.5, offset=(0.0, 0.0, 0.0)) -> np.ndarray:
        """1 at sharp ridges, ~0 in the valleys (cracks, chips, creases)."""
        amp, tot, s = 1.0, 0.0, 0.0
        for o in range(octaves):
            n = 1.0 - np.abs(self(pts, freq * lac ** o, (offset[0] + 3.1 * o, offset[1] + 7.7 * o, offset[2])))
            s = s + amp * n * n
            tot += amp
            amp *= gain
        return s / tot


NOISE = Noise(7)


# ── primitives ──────────────────────────────────────────────────────────────────────────────────
class Prim:
    """Base primitive: subclasses implement _d(P local or world) and bounds()."""
    pad = 0.0                       # extra bound padding (displacement amplitude)

    def bounds(self):
        raise NotImplementedError

    def d(self, P):
        raise NotImplementedError

    def displaced(self, fn, amp: float):
        """d + fn(P) (fn returns metres, |fn| <= amp): carved / chipped surfaces."""
        return Displaced(self, fn, amp)


class _Framed(Prim):
    def __init__(self, c, axes=None):
        self.c = _v(c)
        self.ax = np.eye(3) if axes is None else np.asarray(axes, dtype=np.float64)

    def local(self, P):
        return (P - self.c) @ self.ax.T

    def _corners(self, half):
        hx, hy, hz = half
        pts = np.array([[sx * hx, sy * hy, sz * hz] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
        w = pts @ self.ax + self.c
        return w.min(0), w.max(0)


class Sphere(Prim):
    def __init__(self, c, r):
        self.c, self.r = _v(c), float(r)

    def bounds(self):
        return self.c - self.r, self.c + self.r

    def d(self, P):
        return _len(P - self.c) - self.r


class Ellipsoid(_Framed):
    """Ellipsoid with radii (rx, ry, rz) along the frame axes (IQ's bound; accurate near the surface)."""

    def __init__(self, c, radii, axes=None):
        super().__init__(c, axes)
        self.r = _v(radii)

    def bounds(self):
        return self._corners(self.r)

    def d(self, P):
        p = self.local(P)
        k0 = _len(p / self.r)
        k1 = _len(p / (self.r * self.r))
        return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


class RoundCone(Prim):
    """Capsule with different end radii (a: ra, b: rb), exact distance (IQ)."""

    def __init__(self, a, b, ra, rb=None):
        self.a, self.b = _v(a), _v(b)
        self.ra = float(ra)
        self.rb = float(ra if rb is None else rb)
        ba = self.b - self.a
        L = np.linalg.norm(ba)
        if abs(self.ra - self.rb) >= L * 0.999:          # degenerate: one sphere swallows the other
            big = max(self.ra, self.rb)
            self.rb = self.ra = big
        self.ba = ba
        self.l2 = float(ba.dot(ba)) + 1e-12

    def bounds(self):
        r = max(self.ra, self.rb)
        return np.minimum(self.a, self.b) - r, np.maximum(self.a, self.b) + r

    def d(self, P):
        ba, l2 = self.ba, self.l2
        rr = self.ra - self.rb
        a2 = l2 - rr * rr
        il2 = 1.0 / l2
        pa = P - self.a
        y = pa @ ba
        z = y - l2
        q = pa * l2 - np.outer(y, ba)
        x2 = np.sum(q * q, axis=1)
        y2 = y * y * l2
        z2 = z * z * l2
        k = np.sign(rr) * rr * rr * x2
        d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0.0)) + y * rr) * il2 - self.ra
        d1 = np.sqrt(x2 + z2) * il2 - self.rb
        d2 = np.sqrt(x2 + y2) * il2 - self.ra
        out = np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))
        return out


def Capsule(a, b, r):
    return RoundCone(a, b, r, r)


class FlatCapsule(_Framed):
    """A capsule squashed across its axis: radius rw along the frame's X, rd along Y (limb sections
    are wider than deep). Segment a->b; frame X = `side` hint. Approximate (scaled) distance."""

    def __init__(self, a, b, rw_a, rd_a, rw_b=None, rd_b=None, side=(1.0, 0.0, 0.0)):
        a, b = _v(a), _v(b)
        ax = frame(b - a, side)
        super().__init__(a, ax)
        self.L = float(np.linalg.norm(b - a))
        self.rw = (float(rw_a), float(rw_a if rw_b is None else rw_b))
        self.rd = (float(rd_a), float(rd_a if rd_b is None else rd_b))
        self.a, self.b = a, b

    def bounds(self):
        r = max(self.rw + self.rd)
        return np.minimum(self.a, self.b) - r, np.maximum(self.a, self.b) + r

    def d(self, P):
        p = self.local(P)
        t = np.clip(p[:, 2] / max(self.L, 1e-9), 0.0, 1.0)
        rw = self.rw[0] + (self.rw[1] - self.rw[0]) * t
        rd = self.rd[0] + (self.rd[1] - self.rd[0]) * t
        q = np.stack([p[:, 0] / rw, p[:, 1] / rd, (p[:, 2] - t * self.L) / np.minimum(rw, rd)], axis=1)
        return (_len(q) - 1.0) * np.minimum(rw, rd)


class RoundBox(_Framed):
    def __init__(self, c, half, radius=0.0, axes=None):
        super().__init__(c, axes)
        self.h = _v(half)
        self.r = float(radius)

    def bounds(self):
        return self._corners(self.h)

    def d(self, P):
        q = np.abs(self.local(P)) - self.h + self.r
        return _len(np.maximum(q, 0.0)) + np.minimum(np.max(q, axis=1), 0.0) - self.r


class Torus(_Framed):
    """Ring of major radius R in the frame's XY plane, tube radius r (rz squashes along Z)."""

    def __init__(self, c, R, r, axes=None, rz=None):
        super().__init__(c, axes)
        self.R, self.r = float(R), float(r)
        self.rz = float(rz if rz is not None else r)

    def bounds(self):
        e = self.R + max(self.r, self.rz)
        return self._corners((e, e, max(self.r, self.rz)))

    def d(self, P):
        p = self.local(P)
        q0 = _len(p[:, :2]) - self.R
        q1 = p[:, 2] * (self.r / self.rz)
        return np.sqrt(q0 * q0 + q1 * q1) - self.r


class Lathe(_Framed):
    """Surface of revolution about the frame's Z: `prof(r, z)` returns the 2D signed distance in the
    (radius, height) half-plane. Bounds given explicitly (max radius, z range)."""

    def __init__(self, c, prof, rmax, z0, z1, axes=None):
        super().__init__(c, axes)
        self.prof = prof
        self.rmax, self.z0, self.z1 = float(rmax), float(z0), float(z1)

    def bounds(self):
        pts = np.array([[sx * self.rmax, sy * self.rmax, z] for sx in (-1, 1) for sy in (-1, 1)
                        for z in (self.z0, self.z1)])
        w = pts @ self.ax + self.c
        return w.min(0), w.max(0)

    def d(self, P):
        p = self.local(P)
        return self.prof(_len(p[:, :2]), p[:, 2])


class HalfSpace(Prim):
    """Inside = the side opposite the normal: d = dot(P - point, n). Bounds = a box `extent` around point."""

    def __init__(self, point, normal, extent=1.0):
        self.p = _v(point)
        n = _v(normal)
        self.n = n / np.linalg.norm(n)
        self.e = float(extent)

    def bounds(self):
        return self.p - self.e, self.p + self.e

    def d(self, P):
        return (P - self.p) @ self.n


class Tube(Prim):
    """Smooth union of round cones through points with radii (straps, bands, fingers, rolls)."""

    def __init__(self, pts, radii, k=0.0):
        self.parts = [RoundCone(pts[i], pts[i + 1], radii[i], radii[i + 1]) for i in range(len(pts) - 1)]
        self.k = k

    def bounds(self):
        los, his = zip(*[p.bounds() for p in self.parts])
        return np.min(los, axis=0), np.max(his, axis=0)

    def d(self, P):
        d = None
        for p in self.parts:
            di = p.d(P)
            d = di if d is None else smin(d, di, self.k)
        return d


class Displaced(Prim):
    def __init__(self, base: Prim, fn, amp: float):
        self.base, self.fn, self.amp = base, fn, float(amp)

    def bounds(self):
        lo, hi = self.base.bounds()
        return lo - self.amp, hi + self.amp

    def d(self, P):
        return self.base.d(P) + self.fn(P)


class Blend(Prim):
    """A sub-sculpt usable as one primitive (its own op list), e.g. a hand inside a body."""

    def __init__(self, ops):
        self.ops = ops

    def bounds(self):
        los = [op[1].bounds()[0] - op[2] for op in self.ops if op[0] == "add"]
        his = [op[1].bounds()[1] + op[2] for op in self.ops if op[0] == "add"]
        return np.min(los, axis=0), np.max(his, axis=0)

    def d(self, P):
        d = np.full(len(P), BIG, dtype=np.float64)
        for op, prim, k in self.ops:
            di = prim.d(P)
            if op == "add":
                d = smin(d, di, k)
            elif op == "sub":
                d = smax(d, -di, k)
            else:
                d = smax(d, di, k)
        return d


# ── the sculpt (op list) and grid evaluation ─────────────────────────────────────────────────────
class Sculpt:
    """Ordered smooth-CSG op list evaluated on a narrow-band grid. Ops: add (smooth union),
    sub (smooth subtract), inter (smooth intersect; evaluated over the whole grid), and `clip`
    (intersect inside a box only: cheap plane cuts)."""

    def __init__(self, name: str = "sdf"):
        self.name = name
        self.ops: list = []

    def add(self, prim: Prim, k: float = 0.0, tag: str | None = None):
        self.ops.append(("add", prim, float(k), tag))
        return prim

    def sub(self, prim: Prim, k: float = 0.0, tag: str | None = None):
        self.ops.append(("sub", prim, float(k), tag))
        return prim

    def inter(self, prim: Prim, k: float = 0.0, tag: str | None = None):
        self.ops.append(("inter", prim, float(k), tag))
        return prim

    def bounds(self, pad: float = 0.0):
        los, his = [], []
        for op, prim, k, _ in self.ops:
            if op == "add":
                lo, hi = prim.bounds()
                los.append(lo - k)
                his.append(hi + k)
        return np.min(los, axis=0) - pad, np.max(his, axis=0) + pad

    def grid(self, voxel: float, bounds=None):
        lo, hi = bounds if bounds is not None else self.bounds(pad=3 * voxel)
        lo = np.floor(lo / voxel) * voxel - 2 * voxel
        hi = np.ceil(hi / voxel) * voxel + 2 * voxel
        n = np.round((hi - lo) / voxel).astype(int) + 1
        return lo, n

    def evaluate(self, voxel: float, bounds=None, log=None):
        lo, n = self.grid(voxel, bounds)
        D = np.full(tuple(n), BIG, dtype=np.float32)
        for op, prim, k, _ in self.ops:
            if op == "inter":
                sl = (slice(0, n[0]), slice(0, n[1]), slice(0, n[2]))
            else:
                plo, phi = prim.bounds()
                pad = k + 2.5 * voxel + getattr(prim, "pad", 0.0)
                i0 = np.maximum(np.floor((plo - pad - lo) / voxel).astype(int), 0)
                i1 = np.minimum(np.ceil((phi + pad - lo) / voxel).astype(int) + 1, n)
                if np.any(i1 <= i0):
                    continue
                sl = (slice(i0[0], i1[0]), slice(i0[1], i1[1]), slice(i0[2], i1[2]))
            xs = lo[0] + voxel * np.arange(sl[0].start, sl[0].stop)
            ys = lo[1] + voxel * np.arange(sl[1].start, sl[1].stop)
            zs = lo[2] + voxel * np.arange(sl[2].start, sl[2].stop)
            X, Y, Z = np.meshgrid(xs, ys, zs, indexing="ij")
            P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
            di = prim.d(P).reshape(X.shape).astype(np.float32)
            cur = D[sl]
            if op == "add":
                D[sl] = smin(cur, di, k)
            elif op == "sub":
                D[sl] = smax(cur, -di, k)
            else:
                D[sl] = smax(cur, di, k)
        return D, lo

    def mesh(self, voxel: float, bounds=None):
        D, lo = self.evaluate(voxel, bounds)
        return surface_nets(D, lo, voxel)


# ── surface nets ────────────────────────────────────────────────────────────────────────────────
_CORNERS = np.array([[i, j, k] for k in (0, 1) for j in (0, 1) for i in (0, 1)], dtype=np.int64)
_EDGES = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]


def surface_nets(D: np.ndarray, lo, voxel: float):
    """Naive surface nets on a distance grid (inside < 0): one vertex per sign-changing cell at the
    mean of its edge crossings, one quad per sign-changing grid edge. Returns (verts (N,3) float64
    world, quads (M,4) int64) with outward-facing winding."""
    nx, ny, nz = D.shape
    S = D < 0
    code = np.zeros((nx - 1, ny - 1, nz - 1), dtype=np.uint8)
    for b, (i, j, k) in enumerate(_CORNERS):
        code |= (S[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k].astype(np.uint8) << b)
    active = (code != 0) & (code != 255)
    ci, cj, ck = np.nonzero(active)
    M = len(ci)
    vid = np.full(code.shape, -1, dtype=np.int64)
    vid[ci, cj, ck] = np.arange(M)
    acc = np.zeros((M, 3), dtype=np.float64)
    cnt = np.zeros(M, dtype=np.float64)
    for e0, e1 in _EDGES:
        o0, o1 = _CORNERS[e0], _CORNERS[e1]
        d0 = D[ci + o0[0], cj + o0[1], ck + o0[2]].astype(np.float64)
        d1 = D[ci + o1[0], cj + o1[1], ck + o1[2]].astype(np.float64)
        m = (d0 < 0) != (d1 < 0)
        t = np.where(m, d0 / np.where(m, d0 - d1, 1.0), 0.0)
        for a in range(3):
            acc[:, a] += np.where(m, o0[a] + t * (o1[a] - o0[a]), 0.0)
        cnt += m
    cnt = np.maximum(cnt, 1)
    base = np.stack([ci, cj, ck], axis=1).astype(np.float64)
    verts = np.asarray(lo, dtype=np.float64) + voxel * (base + acc / cnt[:, None])
    quads = []
    # x edges: grid points (i, j, k) -> (i+1, j, k); cells (i, j-1..j, k-1..k)
    sx = S[:-1, 1:-1, 1:-1] != S[1:, 1:-1, 1:-1]
    i, j, k = np.nonzero(sx)
    j, k = j + 1, k + 1
    q = np.stack([vid[i, j - 1, k - 1], vid[i, j, k - 1], vid[i, j, k], vid[i, j - 1, k]], axis=1)
    flip = ~S[i, j, k]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    sy = S[1:-1, :-1, 1:-1] != S[1:-1, 1:, 1:-1]
    i, j, k = np.nonzero(sy)
    i, k = i + 1, k + 1
    q = np.stack([vid[i - 1, j, k - 1], vid[i - 1, j, k], vid[i, j, k], vid[i, j, k - 1]], axis=1)
    flip = ~S[i, j, k]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    sz = S[1:-1, 1:-1, :-1] != S[1:-1, 1:-1, 1:]
    i, j, k = np.nonzero(sz)
    i, j = i + 1, j + 1
    q = np.stack([vid[i - 1, j - 1, k], vid[i, j - 1, k], vid[i, j, k], vid[i - 1, j, k]], axis=1)
    flip = ~S[i, j, k]
    q[flip] = q[flip][:, ::-1]
    quads.append(q)
    quads = np.concatenate(quads, axis=0)
    quads = quads[np.all(quads >= 0, axis=1)]
    return verts, quads


# ── Blender bridge ──────────────────────────────────────────────────────────────────────────────
def to_mesh(name: str, verts, faces):
    """numpy verts (N,3) + faces (M,k) -> bpy Mesh (fast foreach_set path)."""
    import bpy
    verts = np.asarray(verts, dtype=np.float32)
    faces = np.asarray(faces, dtype=np.int32)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(verts))
    me.vertices.foreach_set("co", verts.ravel())
    k = faces.shape[1]
    me.loops.add(faces.size)
    me.loops.foreach_set("vertex_index", faces.ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set("loop_start", np.arange(0, faces.size, k, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    return me


def to_object(name: str, verts, faces, col=None):
    import bpy
    me = to_mesh(name, verts, faces)
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    me.polygons.foreach_set("use_smooth", np.ones(len(me.polygons), dtype=bool))
    return ob


def mesh_object(sculpt: Sculpt, voxel: float, name: str | None = None, col=None, bounds=None):
    v, q = sculpt.mesh(voxel, bounds)
    return to_object(name or sculpt.name, v, q, col)
