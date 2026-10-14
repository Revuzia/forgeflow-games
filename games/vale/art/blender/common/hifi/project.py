"""ART 2.0 albedo: CONCEPT PROJECTION PAINTING in texture space.

The fighter's concept sheet (a hand-painted front and back view, cut into projection plates by
art/tools/concept_plates.py) is the paint. Every texel of the low-poly atlas is painted with the plate
pixel its surface point lands on, looking along Y:

  * the front plate on surfaces facing -Y, the back plate (mirrored) on surfaces facing +Y, blended
    across the sides by the normal;
  * OCCLUSION-AWARE: a texel the front camera cannot see (the apron behind the maul, the haft inside a
    fist) does not take the front plate's foreground paint; it takes the nearest front-plate paint of
    its OWN part (per-part nearest fills of the plate, built from ray-cast part maps), so props never
    leave ghost copies on what is behind them;
  * TOP PLATES: near-flat tops streak under a front/back projection, so a part can name a top plate
    (X, Y in [-ext, ext]) that takes over where the normal points up.

Then the atlas is bled outward (no seams at mip levels). Everything is numpy + mathutils; no scipy.

    maps = rasterize(obj, size)                       # texel position / normal / part id from the UVs
    vis = VisibilityMaps.build(obj, plates)           # front/back first-hit depth + part per plate pixel
    rgb = paint(maps, plates, vis, tops={"cap": (img, 0.7)}, flat={"windows_glass": (r, g, b)})
"""
from __future__ import annotations

import json
import math
import os

import numpy as np


# ── image helpers (numpy only) ───────────────────────────────────────────────────────────────────
def load_rgb(path: str) -> np.ndarray:
    """PNG/WebP -> float32 (H, W, 3) in 0..1, row 0 = TOP (image convention)."""
    import bpy
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1, :, :3].copy()


def save_rgb(arr: np.ndarray, path: str) -> str:
    """float (H, W, 3|4) row 0 = top -> PNG (sRGB values as given)."""
    import bpy
    h, w = arr.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :arr.shape[2]] = arr[..., :4]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path


def bilinear(img: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    """Sample img (H, W, C) at float pixel coords (x right, y down), clamped."""
    h, w = img.shape[:2]
    x = np.clip(px - 0.5, 0, w - 1.001)
    y = np.clip(py - 0.5, 0, h - 1.001)
    x0 = np.floor(x).astype(np.int64)
    y0 = np.floor(y).astype(np.int64)
    fx = (x - x0)[..., None]
    fy = (y - y0)[..., None]
    a = img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx
    b = img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def nearest_index(valid: np.ndarray):
    """Jump flooding: for every pixel, the (iy, ix) of the nearest `valid` pixel (approximate
    Euclidean, exact enough for paint fills). Pixels when nothing is valid map to themselves."""
    h, w = valid.shape
    yy, xx = np.mgrid[0:h, 0:w]
    sy = np.where(valid, yy, -1)
    sx = np.where(valid, xx, -1)
    big = np.float32(1e18)
    d = np.where(valid, 0.0, big).astype(np.float32)
    step = 1 << int(math.ceil(math.log2(max(h, w)))) - 1
    while step >= 1:
        for dy in (-step, 0, step):
            for dx in (-step, 0, step):
                if dy == 0 and dx == 0:
                    continue
                ny0, ny1 = max(0, -dy), min(h, h - dy)
                nx0, nx1 = max(0, -dx), min(w, w - dx)
                csy = sy[ny0 + dy:ny1 + dy, nx0 + dx:nx1 + dx]
                csx = sx[ny0 + dy:ny1 + dy, nx0 + dx:nx1 + dx]
                ok = csy >= 0
                dd = np.where(ok, (yy[ny0:ny1, nx0:nx1] - csy) ** 2 + (xx[ny0:ny1, nx0:nx1] - csx) ** 2, big)
                better = dd < d[ny0:ny1, nx0:nx1]
                d[ny0:ny1, nx0:nx1] = np.where(better, dd, d[ny0:ny1, nx0:nx1])
                sy[ny0:ny1, nx0:nx1] = np.where(better, csy, sy[ny0:ny1, nx0:nx1])
                sx[ny0:ny1, nx0:nx1] = np.where(better, csx, sx[ny0:ny1, nx0:nx1])
        step //= 2
    miss = sy < 0
    sy[miss] = yy[miss]
    sx[miss] = xx[miss]
    return sy, sx


def blur(img: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return img
    r = int(math.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    out = img
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (r, r)
        p = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for i, kv in enumerate(k):
            sl = [slice(None)] * out.ndim
            sl[axis] = slice(i, i + out.shape[axis])
            acc += kv * p[tuple(sl)]
        out = acc
    return out


# ── plates ───────────────────────────────────────────────────────────────────────────────────────
class Plates:
    """Front/back projection plates + their pixel frames (from <id>_plates.json)."""

    def __init__(self, cache_dir: str, fid: str, height: float):
        self.meta = json.load(open(os.path.join(cache_dir, f"{fid}_plates.json")))
        self.height = height
        self.img = {s: load_rgb(os.path.join(cache_dir, f"{fid}_{s}.png")) for s in ("front", "back")}
        self.size = self.meta["size"]

    def ppm(self, side: str) -> float:
        i = self.meta[side]
        return (i["ground"] - i["top"]) / self.height

    def to_px(self, side: str, x, z):
        i = self.meta[side]
        sign = 1.0 if side == "front" else -1.0
        k = self.ppm(side)
        return i["cx"] + sign * np.asarray(x) * k, i["ground"] - np.asarray(z) * k

    def to_world(self, side: str, px, py):
        i = self.meta[side]
        sign = 1.0 if side == "front" else -1.0
        k = self.ppm(side)
        return sign * (np.asarray(px) - i["cx"]) / k, (i["ground"] - np.asarray(py)) / k


# ── texel maps from the UVs ──────────────────────────────────────────────────────────────────────
def rasterize(obj, size: int, part_attr: str = "part"):
    """Rasterise the active UV map of `obj` (world = local; apply transforms first) into texel maps:
    P (size, size, 3) world position, N (size, size, 3) smooth normal, part (size, size) int16
    (-1 = empty), row 0 = TOP of the image (v = 1)."""
    me = obj.data
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    tri_loops = np.empty(nt * 3, dtype=np.int64)
    me.loop_triangles.foreach_get("loops", tri_loops)
    tri_loops = tri_loops.reshape(nt, 3)
    tri_poly = np.empty(nt, dtype=np.int64)
    me.loop_triangles.foreach_get("polygon_index", tri_poly)
    nl = len(me.loops)
    uv = np.empty(nl * 2, dtype=np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(nl, 2)
    lv = np.empty(nl, dtype=np.int64)
    me.loops.foreach_get("vertex_index", lv)
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    ln = np.empty(nl * 3, dtype=np.float32)
    me.corner_normals.foreach_get("vector", ln) if hasattr(me, "corner_normals") else me.loops.foreach_get("normal", ln)
    ln = ln.reshape(nl, 3)
    part_of_poly = np.zeros(len(me.polygons), dtype=np.int64)
    if part_attr in me.attributes:
        me.attributes[part_attr].data.foreach_get("value", part_of_poly)
    P = np.zeros((size, size, 3), dtype=np.float32)
    N = np.zeros((size, size, 3), dtype=np.float32)
    part = np.full((size, size), -1, dtype=np.int16)
    T = uv[tri_loops] * size                       # (nt, 3, 2) in pixel units, v up
    V = co[lv[tri_loops]]
    NN = ln[tri_loops]
    for t in range(nt):
        a, b, c = T[t]
        x0 = int(max(0, math.floor(min(a[0], b[0], c[0]) - 1)))
        x1 = int(min(size - 1, math.ceil(max(a[0], b[0], c[0]) + 1)))
        y0 = int(max(0, math.floor(min(a[1], b[1], c[1]) - 1)))
        y1 = int(min(size - 1, math.ceil(max(a[1], b[1], c[1]) + 1)))
        if x1 < x0 or y1 < y0:
            continue
        gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        w0 = ((b[1] - c[1]) * (gx - c[0]) + (c[0] - b[0]) * (gy - c[1])) / den
        w1 = ((c[1] - a[1]) * (gx - c[0]) + (a[0] - c[0]) * (gy - c[1])) / den
        w2 = 1 - w0 - w1
        m = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4)
        if not m.any():
            continue
        iy, ix = np.nonzero(m)
        rows = size - 1 - (iy + y0)
        cols = ix + x0
        W0, W1, W2 = w0[m][:, None], w1[m][:, None], w2[m][:, None]
        P[rows, cols] = W0 * V[t, 0] + W1 * V[t, 1] + W2 * V[t, 2]
        n = W0 * NN[t, 0] + W1 * NN[t, 1] + W2 * NN[t, 2]
        N[rows, cols] = n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-9)
        part[rows, cols] = part_of_poly[tri_poly[t]]
    return {"P": P, "N": N, "part": part, "size": size}


# ── visibility from the two projection cameras ───────────────────────────────────────────────────
class VisibilityMaps:
    """Per plate side: the first-hit Y (depth) and part id for every `step`-th plate pixel, ray-cast
    along +Y (front) / -Y (back) against the low mesh."""

    def __init__(self):
        self.depth, self.part, self.step = {}, {}, 2

    @classmethod
    def build(cls, obj, plates: Plates, step: int = 2, part_attr: str = "part"):
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        self = cls()
        self.step = step
        me = obj.data
        verts = [v.co.copy() for v in me.vertices]
        polys = [tuple(p.vertices) for p in me.polygons]
        bvh = BVHTree.FromPolygons(verts, polys)
        part_of_poly = np.zeros(len(me.polygons), dtype=np.int64)
        if part_attr in me.attributes:
            me.attributes[part_attr].data.foreach_get("value", part_of_poly)
        co = np.array([v[:] for v in verts])
        W, H = plates.size
        for side, y0, d in (("front", -50.0, Vector((0, 1, 0))), ("back", 50.0, Vector((0, -1, 0)))):
            gx = np.arange(0, W, step) + step * 0.5
            gy = np.arange(0, H, step) + step * 0.5
            dep = np.full((len(gy), len(gx)), np.nan, dtype=np.float32)
            pid = np.full((len(gy), len(gx)), -1, dtype=np.int16)
            # only the columns/rows the model can cover
            x, z = plates.to_world(side, gx, np.zeros_like(gx))
            xs = np.nonzero((x > co[:, 0].min() - 0.02) & (x < co[:, 0].max() + 0.02))[0]
            _, zz = plates.to_world(side, np.zeros_like(gy), gy)
            zs = np.nonzero((zz > co[:, 2].min() - 0.02) & (zz < co[:, 2].max() + 0.02))[0]
            for j in zs:
                zj = float(zz[j])
                for i in xs:
                    hit = bvh.ray_cast(Vector((float(x[i]), y0, zj)), d)
                    if hit[0] is not None:
                        dep[j, i] = hit[0].y
                        pid[j, i] = part_of_poly[hit[2]]
            self.depth[side] = dep
            self.part[side] = pid
        return self

    def lookup(self, side: str, px, py):
        s = self.step
        d = self.depth[side]
        j = np.clip((np.asarray(py) / s).astype(np.int64), 0, d.shape[0] - 1)
        i = np.clip((np.asarray(px) / s).astype(np.int64), 0, d.shape[1] - 1)
        return d[j, i], self.part[side][j, i]


# ── painting ─────────────────────────────────────────────────────────────────────────────────────
def paint(maps: dict, plates: Plates, vis: VisibilityMaps, names: list[str], tops: dict | None = None,
          flat: dict | None = None, eps: float = 0.02, bleed: bool = True, log=print) -> np.ndarray:
    """Albedo atlas (size, size, 3) float 0..1 (sRGB values). `names[i]` is part i's name; `tops`
    {name: (top_rgb_array, ext)}; `flat` {name: (r, g, b)} for parts painted a flat colour."""
    P, N, part = maps["P"], maps["N"], maps["part"]
    size = maps["size"]
    out = np.zeros((size, size, 3), dtype=np.float32)
    have = part >= 0
    tops = tops or {}
    flat = flat or {}
    # per-part nearest fills of each plate (at the visibility grid's resolution)
    fills = {}
    for side in ("front", "back"):
        pid = vis.part[side]
        s = vis.step
        small = plates.img[side][s // 2::s, s // 2::s][:pid.shape[0], :pid.shape[1]]
        for k in np.unique(part[have]):
            valid = pid == k
            if not valid.any():
                continue
            iy, ix = nearest_index(valid)
            fills[(side, int(k))] = blur(small[iy, ix], 1.0)
    log(f"project: {len(fills)} part fills")
    idx = np.nonzero(have)
    p = P[idx]
    n = N[idx]
    k = part[idx].astype(np.int64)
    # sideways-facing texels: neighbours along Y take the same plate pixel (streaks), so they sample a
    # softened plate, blended in as the normal turns to face +-X
    st = np.abs(n[:, 0]) / (np.abs(n[:, 0]) + np.abs(n[:, 1]) + 1e-6)
    ws = np.clip((st - 0.72) / 0.24, 0, 1)
    ws = (ws * ws * (3 - 2 * ws))[:, None]
    soft = {s_: blur(plates.img[s_], 4.0) for s_ in ("front", "back")} if (ws > 0).any() else None
    cols = {}
    for side in ("front", "back"):
        px, py = plates.to_px(side, p[:, 0], p[:, 2])
        c = bilinear(plates.img[side], px, py)
        if soft is not None:
            c = c * (1 - ws) + bilinear(soft[side], px, py) * ws
        dep, hid = vis.lookup(side, px, py)
        if side == "front":
            hidden = ~(p[:, 1] <= np.nan_to_num(dep, nan=1e9) + eps)
        else:
            hidden = ~(p[:, 1] >= np.nan_to_num(dep, nan=-1e9) - eps)
        # occluded texels: the nearest paint of their own part
        for kk in np.unique(k[hidden]):
            f = fills.get((side, int(kk)))
            if f is None:
                continue
            sel = hidden & (k == kk)
            c[sel] = bilinear(f, px[sel] / vis.step, py[sel] / vis.step)
        cols[side] = c
    wb = np.clip((n[:, 1] + 0.25) / 0.5, 0, 1)
    wb = wb * wb * (3 - 2 * wb)
    col = cols["front"] * (1 - wb[:, None]) + cols["back"] * wb[:, None]
    for name, (top, ext) in tops.items():
        if name not in names:
            continue
        sel = k == names.index(name)
        if not sel.any():
            continue
        th, tw = top.shape[:2]
        tx = (p[sel, 0] + ext) / (2 * ext) * tw
        ty = (1 - (p[sel, 1] + ext) / (2 * ext)) * th
        tcol = bilinear(top, tx, ty)
        wt = np.clip((n[sel, 2] - 0.55) / 0.30, 0, 1)
        wt = (wt * wt * (3 - 2 * wt))[:, None]
        col[sel] = col[sel] * (1 - wt) + tcol * wt
    for name, rgb in flat.items():
        if name in names:
            col[k == names.index(name)] = np.asarray(rgb, dtype=np.float32)
    out[idx] = col
    if bleed:
        iy, ix = nearest_index(have)
        out = out[iy, ix]
    return out
