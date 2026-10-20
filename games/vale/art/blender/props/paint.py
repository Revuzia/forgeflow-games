"""VALE scatter-prop painter: ray-cast occlusion (mathutils BVH) and painterly colour ramps.

Every light term here is ROTATION-INVARIANT about the vertical: the terrain spins each instance to a
random heading, so a baked sun direction would point a different way on every tree. The props carry
sky visibility (what the open sky sees), up-facing, ambient occlusion, crevices and lit rims; the
renderer's real sun adds the direction on top.
"""
from __future__ import annotations

import math

import numpy as np


def hexc(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])


def srgb2lin(c):
    c = np.clip(np.asarray(c, dtype=np.float64), 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def smooth(a, b, x):
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def ramp(t, stops: list[tuple[float, str]]) -> np.ndarray:
    """Gradient map: t (n,) in 0..1 → sRGB (n,3) through hex stops (interpolated in sRGB, like paint)."""
    t = np.clip(np.asarray(t, float), 0, 1)
    xs = np.array([s[0] for s in stops])
    cs = np.array([hexc(s[1]) for s in stops])
    return np.stack([np.interp(t, xs, cs[:, k]) for k in range(3)], 1)


def posterize(t, steps: int, keep: float = 0.35):
    """Painterly value bands: snap toward `steps` levels, keep a little of the smooth ramp."""
    t = np.asarray(t, float)
    return np.round(t * steps) / steps * (1 - keep) + t * keep


def hash01(*xs) -> np.ndarray:
    """Deterministic per-element hash in 0..1 (no RNG state)."""
    h = np.zeros(np.broadcast(*[np.asarray(x, float) for x in xs]).shape)
    for i, x in enumerate(xs):
        h = h + np.asarray(x, float) * (12.9898 + 31.7 * i)
    return np.modf(np.abs(np.sin(h) * 43758.5453))[0]


def vnoise3(P, freq: float, seed: int = 0) -> np.ndarray:
    """Smooth value noise (trilinear, smoothstepped) at points P (n,3), 0..1."""
    Q = np.asarray(P, float) * freq + seed * 17.13
    i = np.floor(Q)
    f = Q - i
    f = f * f * (3 - 2 * f)
    out = np.zeros(len(Q))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (f[:, 0] if dx else 1 - f[:, 0]) * (f[:, 1] if dy else 1 - f[:, 1]) * (f[:, 2] if dz else 1 - f[:, 2])
                out += w * hash01(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz + seed)
    return out


def fbm3(P, freq: float, octaves: int = 3, seed: int = 0) -> np.ndarray:
    a, s, tot = 1.0, 0.0, 0.0
    for o in range(octaves):
        s += a * vnoise3(P, freq * (2 ** o), seed + o * 7)
        tot += a
        a *= 0.5
    return s / tot


def _fib_dirs(n: int, cone: float = math.pi / 2, cosine: bool = True) -> np.ndarray:
    """Deterministic directions in a cone around +Z (cosine-weighted inside a hemisphere)."""
    out = []
    ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        u = (i + 0.5) / n
        if cosine:
            r = math.sqrt(u) * math.sin(cone)
            z = math.sqrt(max(0.0, 1 - r * r))
        else:
            z = 1 - u * (1 - math.cos(cone))
            r = math.sqrt(max(0.0, 1 - z * z))
        a = i * ga
        out.append([r * math.cos(a), r * math.sin(a), z])
    return np.asarray(out)


def _basis(n):
    n = n / np.linalg.norm(n)
    a = np.array([1.0, 0, 0]) if abs(n[0]) < 0.9 else np.array([0, 1.0, 0])
    t = np.cross(n, a); t /= np.linalg.norm(t)
    b = np.cross(n, t)
    return t, b, n


class Occluder:
    """BVH over a triangle soup (+ optional ground plane z = 0) for occlusion rays."""

    def __init__(self, P, F, ground: bool = True):
        from mathutils.bvhtree import BVHTree
        self.bvh = BVHTree.FromPolygons([tuple(map(float, p)) for p in P], [tuple(map(int, f)) for f in F], all_triangles=True)
        self.ground = ground

    def hit(self, o, d, dist: float) -> bool:
        from mathutils import Vector
        loc, *_ = self.bvh.ray_cast(Vector(o), Vector(d), dist)
        if loc is not None:
            return True
        if self.ground and d[2] < -1e-4:
            tg = -o[2] / d[2]
            return 0 < tg < dist
        return False

    def ao(self, P, N, rays: int = 24, dist: float = 1.2, eps: float = 0.012) -> np.ndarray:
        """1 = open, 0 = buried: cosine-weighted hemisphere around each normal."""
        D = _fib_dirs(rays)
        out = np.empty(len(P))
        for i, (p, n) in enumerate(zip(P, N)):
            t, b, nn = _basis(n)
            o = p + nn * eps
            hits = 0
            for d in D:
                w = t * d[0] + b * d[1] + nn * d[2]
                if self.hit(o, w, dist):
                    hits += 1
            out[i] = 1 - hits / rays
        return out

    def sky(self, P, N, rays: int = 16, cone_deg: float = 55.0, dist: float = 12.0, eps: float = 0.012) -> np.ndarray:
        """Fraction of a cone of sky around +Z that each vertex sees (rays below its own surface count as
        blocked): the rotation-invariant stand-in for 'lit from above'."""
        D = _fib_dirs(rays, math.radians(cone_deg), cosine=False)
        out = np.empty(len(P))
        for i, (p, n) in enumerate(zip(P, N)):
            o = p + n * eps
            seen = 0.0
            for d in D:
                c = float(np.dot(d, n))
                if c <= 0.02:
                    continue
                if not self.hit(o, d, dist):
                    seen += min(1.0, c * 1.4)
            out[i] = seen / rays
        return out
