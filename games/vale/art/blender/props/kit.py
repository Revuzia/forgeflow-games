"""VALE scatter-prop kit: numpy mesh parts (fan leaf plates, faceted tubes, cores), merging, smooth
normals and a small GLB writer. Pure numpy (no bpy), so the shapes are testable outside Blender.

Coordinates are Blender's (Z up, metres, origin at the ground contact). `write_glb` converts to glTF's
Y-up ((x, y, z) -> (x, z, -y)), the same mapping the Blender exporter uses.
"""
from __future__ import annotations

import json
import math
import struct

import numpy as np


# ── parts ────────────────────────────────────────────────────────────────────────────────────────
class Part:
    """A mesh piece: positions P (n,3), triangles F (m,3), normals N (n,3) and per-vertex attributes
    (float arrays of length n) the painter reads (ring, u, plate, row, ...)."""

    def __init__(self, P, F, N=None, **attrs):
        self.P = np.asarray(P, dtype=np.float64).reshape(-1, 3)
        self.F = np.asarray(F, dtype=np.int64).reshape(-1, 3)
        self.N = smooth_normals(self.P, self.F) if N is None else np.asarray(N, dtype=np.float64).reshape(-1, 3)
        self.A = {k: np.broadcast_to(np.asarray(v, dtype=np.float64), (len(self.P),)).copy() for k, v in attrs.items()}

    def transformed(self, M: np.ndarray) -> "Part":
        """M: 4x4 affine (rotation/uniform-ish scale + translation); normals use the inverse transpose."""
        R = M[:3, :3]
        P = self.P @ R.T + M[:3, 3]
        Nm = self.N @ np.linalg.inv(R)
        Nm /= np.maximum(np.linalg.norm(Nm, axis=1, keepdims=True), 1e-12)
        out = Part(P, self.F, Nm)
        out.A = {k: v.copy() for k, v in self.A.items()}
        return out

    def set(self, **attrs) -> "Part":
        for k, v in attrs.items():
            self.A[k] = np.broadcast_to(np.asarray(v, dtype=np.float64), (len(self.P),)).copy()
        return self

    @property
    def tris(self) -> int:
        return len(self.F)


def merge(parts: list[Part]) -> Part:
    keys = sorted({k for p in parts for k in p.A})
    P, F, N, off = [], [], [], 0
    A = {k: [] for k in keys}
    for p in parts:
        P.append(p.P); N.append(p.N); F.append(p.F + off); off += len(p.P)
        for k in keys:
            A[k].append(p.A.get(k, np.zeros(len(p.P))))
    out = Part(np.vstack(P), np.vstack(F), np.vstack(N))
    out.A = {k: np.concatenate(v) for k, v in A.items()}
    return out


def face_normals(P, F):
    n = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    return n  # area-weighted (unnormalised)


def smooth_normals(P, F):
    fn = face_normals(P, F)
    N = np.zeros_like(P)
    for k in range(3):
        np.add.at(N, F[:, k], fn)
    l = np.linalg.norm(N, axis=1, keepdims=True)
    return N / np.maximum(l, 1e-12)


def frame(origin, y_axis, z_hint) -> np.ndarray:
    """4x4 placing a local part (apex at 0, axis +Y, normal +Z) at origin, axis along y_axis, normal as
    close to z_hint as the axis allows."""
    y = np.asarray(y_axis, float); y = y / np.linalg.norm(y)
    z = np.asarray(z_hint, float); z = z - y * np.dot(z, y)
    if np.linalg.norm(z) < 1e-6:
        z = np.cross(y, [1.0, 0, 0]) if abs(y[0]) < 0.9 else np.cross(y, [0, 1.0, 0])
    z /= np.linalg.norm(z)
    x = np.cross(y, z)
    M = np.eye(4)
    M[:3, 0], M[:3, 1], M[:3, 2], M[:3, 3] = x, y, z, origin
    return M


def scale4(s) -> np.ndarray:
    M = np.eye(4)
    M[0, 0], M[1, 1], M[2, 2] = (s, s, s) if np.isscalar(s) else s
    return M


# ── the Dialwood leaf: a lacquered fan plate ─────────────────────────────────────────────────────
def fan_leaf(L: float, spread: float, K: int = 6, pleat: float = 0.015, droop: float = 0.10, curl: float = 0.08,
             round_: float = 0.42, notch: float = 0.0) -> Part:
    """A fan-shaped leaf plate, apex (the stem) at the origin, opening along +Y, top facing +Z: the apex and
    K+1 points on a rounded leading edge, K triangles. Single-sided: the crown's closed cores fill whatever
    the camera would see behind a plate turned away from it, so a plate costs K triangles, not 4·(K+2).

    `pleat` folds the fan along its ribs (alternate edge points up and down, per metre of length): hour-lines
    radiating from the stem that catch the light; `droop` bends the tip down, `curl` the two corners;
    `notch` (even K) draws the middle of the leading edge in by that fraction: the fan leaf's cleft.
    Attributes: u (0 stem → 1 edge), lobe (+1 rib, -1 valley, 0 stem), corner (1 on the two fan corners)."""
    a = np.linspace(-spread / 2, spread / 2, K + 1)
    w = np.abs(a) / (spread / 2)
    prof = 1.0 - round_ * w ** 2.4                   # a rounded shell-like blade: the corners drawn in toward the stem
    if notch and K % 2 == 0:
        prof[K // 2] *= 1.0 - notch
    x, y = L * prof * np.sin(a), L * prof * np.cos(a)
    lobe = np.where(np.arange(K + 1) % 2 == (K // 2) % 2, 1.0, -1.0)   # the middle point is a rib
    z = pleat * L * lobe - droop * L * (y / L) ** 2 - curl * L * (x / L) ** 2
    P = np.vstack([[0.0, 0.0, 0.0], np.column_stack([x, y, z])])
    F = np.array([[0, i + 2, i + 1] for i in range(K)])
    fn = face_normals(P, F)
    F[fn[:, 2] < 0] = F[fn[:, 2] < 0][:, [0, 2, 1]]
    u = np.concatenate([[0.0], np.ones(K + 1)])
    corner = np.concatenate([[0.0], (np.arange(K + 1) == 0) | (np.arange(K + 1) == K)]).astype(float)
    return Part(P, F, None, u=u, lobe=np.concatenate([[0.0], lobe]), corner=corner)


def fan_plate(L: float, spread: float, K: int = 6, crimp: float = 0.12, pleat: float = 0.02, droop: float = 0.08,
              curl: float = 0.06, round_: float = 0.30, midrib: float = 0.0, ridge: float = 0.5) -> Part:
    """The Dialwood fan leaf as a crimped, pleated plate: apex (the stem) at the origin, opening along +Y, top
    facing +Z; the apex and K+1 points on the leading edge, K triangles (K even). The edge alternates RIB
    (odd points: full length, raised by `pleat`) and VALLEY (even points, the two corners among them: drawn
    in by `crimp`, lowered), so the outline is a lobed fan (three lobes at K = 6), never a polygon disc, and
    every wedge runs from a rib to a valley: the painter strokes it light-to-dark like a brushed hour-line.
    `droop` bends the tip down along the axis, `curl` the corners down, `round_` draws the corners in.
    `midrib` (0 < f < 1; 0 = none, the old K-triangle plate): one more vertex on the middle rib, f of the way from
    the stem to its tip, raised `ridge` × the pleat over the plate: the two middle wedges split there (K + 2
    triangles), so the painter can lay a MIDRIB vein down the leaf (attribute vein = 1 on that vertex).
    Attributes: u (0 stem → 1 edge), lobe (+1 rib, -1 valley, 0 stem), corner (1 on the two corners),
    side (-1 … 1 across the fan), vein (1 on the midrib vertex)."""
    a = np.linspace(-spread / 2, spread / 2, K + 1)
    w = np.abs(a) / (spread / 2)
    rib = (np.arange(K + 1) % 2 == 1)
    lobe = np.where(rib, 1.0, -1.0)
    prof = (1.0 - round_ * w ** 2.2) * np.where(rib, 1.0, 1.0 - crimp)
    x, y = L * prof * np.sin(a), L * prof * np.cos(a)
    z = pleat * L * lobe * (0.6 + 0.4 * (1 - w)) - droop * L * (y / L) ** 2 - curl * L * (x / L) ** 2
    P = np.vstack([[0.0, 0.0, 0.0], np.column_stack([x, y, z])])
    F = [[0, i + 2, i + 1] for i in range(K)]
    u = [0.0] + [1.0] * (K + 1)
    lob = [0.0] + list(lobe)
    corner = [0.0] + list(((np.arange(K + 1) == 0) | (np.arange(K + 1) == K)).astype(float))
    side = [0.0] + list(a / (spread / 2))
    vein = [0.0] * (K + 2)
    if midrib > 0 and K % 2 == 0:
        c = K // 2 + 1                               # the middle rib's tip (P index)
        yc = midrib * P[c, 1]
        m = np.array([0.0, yc, midrib * P[c, 2] + ridge * pleat * L - droop * L * ((yc / L) ** 2 - midrib * (P[c, 1] / L) ** 2)])
        P = np.vstack([P, m])
        mi = len(P) - 1
        # the two wedges on the middle rib, (0, c, c-1) and (0, c+1, c), split at the midrib vertex
        F = [f for f in F if not (f[0] == 0 and c in f[1:])]
        F += [[0, mi, c - 1], [mi, c, c - 1], [0, c + 1, mi], [mi, c + 1, c]]
        u.append(midrib); lob.append(1.0); corner.append(0.0); side.append(0.0); vein.append(1.0)
    F = np.asarray(F)
    fn = face_normals(P, F)
    F[fn[:, 2] < 0] = F[fn[:, 2] < 0][:, [0, 2, 1]]
    return Part(P, F, None, u=np.asarray(u), lobe=np.asarray(lob), corner=np.asarray(corner), side=np.asarray(side),
                vein=np.asarray(vein))


# ── faceted tubes (trunk, limbs, roots) ──────────────────────────────────────────────────────────
def tube(points, radii, sides: int = 7, rng: np.random.Generator | None = None, jitter: float = 0.0,
         cap_end: bool = False, phase: float = 0.0) -> Part:
    """A tapered tube along a polyline with parallel-transported rings; `jitter` roughens each ring
    (hand-carved bark facets). Attributes: v (0 base → 1 end), s (around, 0..1)."""
    pts = np.asarray(points, float)
    rad = np.asarray(radii, float)
    n = len(pts)
    T = np.gradient(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    ref = np.array([1.0, 0.0, 0.0]) if abs(T[0, 0]) < 0.9 else np.array([0.0, 1.0, 0.0])
    U = np.cross(T[0], ref); U /= np.linalg.norm(U)
    rings, vv, ss = [], [], []
    ang = np.linspace(0, 2 * math.pi, sides, endpoint=False) + phase
    for i in range(n):
        if i > 0:
            U = U - T[i] * np.dot(U, T[i]); U /= np.linalg.norm(U)
        V = np.cross(T[i], U)
        r = rad[i] * (1 + (rng.uniform(-jitter, jitter, sides) if rng is not None and jitter > 0 else 0))
        ring = pts[i] + (np.cos(ang)[:, None] * U + np.sin(ang)[:, None] * V) * np.broadcast_to(r, (sides,))[:, None]
        rings.append(ring); vv.append(np.full(sides, i / (n - 1))); ss.append(np.arange(sides) / sides)
    P = np.vstack(rings)
    F = []
    for i in range(n - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            c, d = a + sides, b + sides
            F.append([a, b, d]); F.append([a, d, c])
    v = np.concatenate(vv); s = np.concatenate(ss)
    if cap_end:
        tip = pts[-1] + T[-1] * rad[-1] * 0.6
        P = np.vstack([P, tip]); v = np.append(v, 1.0); s = np.append(s, 0.0)
        ti = len(P) - 1
        base = (n - 1) * sides
        for k in range(sides):
            F.append([base + k, base + (k + 1) % sides, ti])
    F = np.asarray(F)
    # outward winding: compare with the radial direction from the spine
    fn = face_normals(P, F)
    fc = P[F].mean(1)
    spine_i = np.clip(np.round(v[F[:, 0]] * (n - 1)).astype(int), 0, n - 1)
    flip = np.einsum("ij,ij->i", fn, fc - pts[spine_i]) < 0
    F[flip] = F[flip][:, [0, 2, 1]]
    return Part(P, F, None, v=v, s=s)


def ellipsoid(center, radii, seg: int = 8, rings: int = 5) -> Part:
    """Low UV ellipsoid (the dark core of a leaf clump, so the camera never sees through the crown)."""
    P = [[0, 0, 1.0]]
    for i in range(1, rings):
        th = math.pi * i / rings
        for k in range(seg):
            ph = 2 * math.pi * (k + 0.5 * (i % 2)) / seg
            P.append([math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)])
    P.append([0, 0, -1.0])
    P = np.asarray(P)
    F = []
    for k in range(seg):
        F.append([0, 1 + k, 1 + (k + 1) % seg])
    for i in range(rings - 2):
        a0, b0 = 1 + i * seg, 1 + (i + 1) * seg
        for k in range(seg):
            k1 = (k + 1) % seg
            if i % 2 == 0:
                F.append([a0 + k, b0 + k, a0 + k1]); F.append([a0 + k1, b0 + k, b0 + k1])
            else:
                F.append([a0 + k, b0 + k, b0 + k1]); F.append([a0 + k, b0 + k1, a0 + k1])
    last = len(P) - 1
    lb = 1 + (rings - 2) * seg
    for k in range(seg):
        F.append([last, lb + (k + 1) % seg, lb + k])
    F = np.asarray(F)
    fn = face_normals(P, F)
    flip = np.einsum("ij,ij->i", fn, P[F].mean(1)) < 0
    F[flip] = F[flip][:, [0, 2, 1]]
    N = P / np.linalg.norm(P, axis=1, keepdims=True)
    Q = P * np.asarray(radii) + np.asarray(center)
    Nq = N / np.asarray(radii)
    Nq /= np.linalg.norm(Nq, axis=1, keepdims=True)
    return Part(Q, F, Nq)


# ── GLB ──────────────────────────────────────────────────────────────────────────────────────────
def write_glb(path: str, P, N, C, F, name: str, roughness: float = 0.86, gloss=None) -> int:
    """Write one vertex-coloured mesh as a binary glTF. P/N in Blender Z-up metres, C linear RGB 0..1.
    COLOR_0 is RGBA unsigned-short normalised (precise darks), indices uint16/uint32. Returns bytes.

    COLOR_0.a is the GLOSS mask (the scatter-prop interface shared with render/terrain.ts): 1 = lacquered
    leaf (roughness ~0.42, a soft clearcoat-like spec), 0 = bark / stone (roughness 0.86); `gloss` (n,) in
    0..1, None = all 0 (matte, the same as a GLB without vertex alpha)."""
    P = np.asarray(P, float); N = np.asarray(N, float); C = np.clip(np.asarray(C, float), 0, 1); F = np.asarray(F)
    G = np.zeros(len(C)) if gloss is None else np.clip(np.asarray(gloss, float).reshape(-1), 0, 1)
    assert len(G) == len(C), "gloss: one value per vertex"
    Py = np.column_stack([P[:, 0], P[:, 2], -P[:, 1]]).astype(np.float32)
    Ny = np.column_stack([N[:, 0], N[:, 2], -N[:, 1]])
    Ny = (Ny / np.maximum(np.linalg.norm(Ny, axis=1, keepdims=True), 1e-12)).astype(np.float32)
    Cq = np.round(np.column_stack([C, G]) * 65535).astype(np.uint16)
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

    vp = view(Py.tobytes(), 34962)
    vn = view(Ny.tobytes(), 34962)
    vc = view(Cq.tobytes(), 34962)
    vi = view(Iq.tobytes(), 34963)
    acc = [
        {"bufferView": vp, "componentType": 5126, "count": len(Py), "type": "VEC3",
         "min": Py.min(0).tolist(), "max": Py.max(0).tolist()},
        {"bufferView": vn, "componentType": 5126, "count": len(Ny), "type": "VEC3"},
        {"bufferView": vc, "componentType": 5123, "normalized": True, "count": len(Cq), "type": "VEC4"},
        {"bufferView": vi, "componentType": 5125 if big else 5123, "count": len(Iq), "type": "SCALAR"},
    ]
    gl = {
        "asset": {"version": "2.0", "generator": "vale art/blender/props (kit.write_glb)"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1, "COLOR_0": 2},
                                                  "indices": 3, "material": 0, "mode": 4}]}],
        "materials": [{"name": "vale_prop_vcol", "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1],
                                                                           "metallicFactor": 0.0, "roughnessFactor": roughness}}],
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
