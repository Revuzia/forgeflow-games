#!/usr/bin/env python3
"""Ilsheta fit check (ART 2.0 step 2, the marund_v2.py proof's overlay without Blender; Tunlan's tool): the SDF parts
of art/blender/fighters/ilsheta.py evaluated on a voxel grid and ray-marched along the view axes, laid over the
concept on the 10 cm grid; plus a POSE CHECK of the held staff and the hanging lamp against the body (the clips' key
poses, the torso treated as unturned). Runs in the repo venv (numpy, scipy, Pillow); Blender modules are stubbed.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ilsheta_fit.py [--voxel 0.01] [--only hood,mantle]
    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/ilsheta_fit.py --poses

Writes art/renders/fighters/ilsheta/_fit/{fit_front,fit_back,views}.png:
  fit_*   the concept with the model's silhouette (red) and the concept cut (green), 10 cm grid (blue)
  views   front / back / left side / top, parts in flat colours with depth shading (form check)
"""
from __future__ import annotations

import argparse
import json
import sys
import types
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
BL = HERE.parent
ART = BL.parent
CACHE = ART / ".cache" / "concept"
OUT = ART / "renders" / "fighters" / "ilsheta" / "_fit"


class _Any:
    def __init__(self, *a, **k):
        pass

    def __getattr__(self, n):
        return _Any()

    def __call__(self, *a, **k):
        return _Any()

    def __mro_entries__(self, bases):
        return (object,)


class _Mod(types.ModuleType):
    def __getattr__(self, n):
        if n.startswith("__"):
            raise AttributeError(n)
        return _Any


for m in ("bpy", "bpy.types", "bmesh", "mathutils", "mathutils.bvhtree", "mathutils.kdtree"):
    sys.modules[m] = _Mod(m)
sys.modules["bpy"].app = types.SimpleNamespace(background=False, binary_path="", version=(5, 2, 0))
sys.path.insert(0, str(BL))
sys.path.insert(0, str(BL / "fighters"))
import ilsheta  # noqa: E402

COLS = {"cloth2": (214, 204, 190), "chalk": (210, 205, 196), "cloth": (110, 124, 138), "cloth3": (78, 83, 92),
        "wood": (188, 174, 152), "leather": (60, 64, 74), "under": (40, 44, 52), "dawnglass": (200, 214, 222),
        "lampglass": (191, 211, 222), "accent": (63, 156, 255), "reed": (142, 150, 114)}


def march(parts, voxel):
    """per view: (depth, part index, normal z-ish shade) images on a common world grid"""
    lo = np.array([-0.75, -0.72, -0.02])
    hi = np.array([0.75, 0.72, 1.80])
    n = np.ceil((hi - lo) / voxel).astype(int)
    views = {"front": (0, 2, 1, +1), "back": (0, 2, 1, -1), "side": (1, 2, 0, -1), "top": (0, 1, 2, -1)}
    res = {}
    for v, (a, b, d, s) in views.items():
        res[v] = {"dep": np.full((n[b], n[a]), np.inf), "pid": np.full((n[b], n[a]), -1, int)}
    for pi, (name, S, vs, role, bind, tris, *_r) in enumerate(parts):
        D, plo = S.evaluate(voxel)
        inside = D < 0
        if not inside.any():
            print("empty part", name)
            continue
        for v, (a, b, d, s) in views.items():
            # first inside index along axis d from the viewer: front looks +Y (min y), back -Y (max y),
            # side from +X (max x), top from +Z (max z)
            ins = np.moveaxis(inside, d, -1)
            has = ins.any(-1)
            if s > 0:
                idx = np.argmax(ins, axis=-1)
                depth = plo[d] + idx * voxel
            else:
                idx = ins.shape[-1] - 1 - np.argmax(ins[..., ::-1], axis=-1)
                depth = -(plo[d] + idx * voxel)
            # remaining axes order after moveaxis: the two other axes in increasing order
            others = [k for k in range(3) if k != d]
            A, B = np.nonzero(has)
            ca = plo[others[0]] + A * voxel
            cb = plo[others[1]] + B * voxel
            dep = depth[A, B]
            if others[0] == a:
                ga, gb = ca, cb
            else:
                ga, gb = cb, ca
            ia = np.round((ga - lo[a]) / voxel).astype(int)
            ib = np.round((hi[b] - gb) / voxel).astype(int)
            ok = (ia >= 0) & (ia < n[a]) & (ib >= 0) & (ib < n[b])
            ia, ib, dep = ia[ok], ib[ok], dep[ok]
            R = res[v]
            better = dep < R["dep"][ib, ia]
            R["dep"][ib[better], ia[better]] = dep[better]
            R["pid"][ib[better], ia[better]] = pi
        print(f"  {name}: {int(inside.sum())} voxels")
    return res, lo, hi


def shade(R, parts, voxel, flip=False):
    dep, pid = R["dep"], R["pid"]
    h, w = dep.shape
    img = np.full((h, w, 3), 40, np.float32)
    have = pid >= 0
    dz = np.where(have, dep, np.nan)
    gy, gx = np.gradient(np.nan_to_num(dz, nan=np.nanmax(dz[have]) if have.any() else 0.0) / voxel)
    nx, ny = -np.clip(gx, -4, 4), np.clip(gy, -4, 4)
    nrm = np.stack([nx, ny, np.ones_like(nx)], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    L = np.array([-0.45, 0.55, 0.7])
    L /= np.linalg.norm(L)
    lam = np.clip(nrm @ L, 0, 1) * 0.75 + 0.3
    for i, p in enumerate(parts):
        m = pid == i
        img[m] = np.array(COLS.get(p[3], (255, 0, 255)), np.float32) * lam[m, None]
    # part borders
    edge = (nd.maximum_filter(pid, 3) != nd.minimum_filter(pid, 3)) & have
    img[edge] *= 0.55
    img = img[:, ::-1] if flip else img
    return Image.fromarray(img.clip(0, 255).astype(np.uint8))


def overlay(side, R, lo, hi, voxel, meta, concept, mask):
    info = meta[side]
    k = (info["ground"] - info["top"]) / ilsheta.HEIGHT
    sign = 1 if side == "front" else -1
    x0, x1 = int(info["cx"] - 0.70 * k), int(info["cx"] + 0.70 * k)
    y0, y1 = int(info["ground"] - 1.80 * k), int(info["ground"] + 0.02 * k)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    wx = sign * (xx - info["cx"]) / k
    wz = (info["ground"] - yy) / k
    ia = np.round((wx - lo[0]) / voxel).astype(int)
    ib = np.round((hi[2] - wz) / voxel).astype(int)
    sil = (R["pid"] >= 0)
    ok = (ia >= 0) & (ia < sil.shape[1]) & (ib >= 0) & (ib < sil.shape[0])
    S = np.zeros(yy.shape, bool)
    S[ok] = sil[ib[ok], ia[ok]]
    img = np.asarray(concept)[y0:y1, x0:x1].astype(np.float32) * 0.8 + 40
    C = mask[y0:y1, x0:x1]
    es = S & ~nd.binary_erosion(S, iterations=2)
    ec = C & ~nd.binary_erosion(C, iterations=2)
    img[S & ~C] = img[S & ~C] * 0.6 + np.array([255, 60, 60]) * 0.4      # model outside the concept
    img[C & ~S] = img[C & ~S] * 0.6 + np.array([60, 255, 60]) * 0.4      # concept not covered
    img[ec] = (0, 200, 0)
    img[es] = (255, 0, 0)
    im = Image.fromarray(img.clip(0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for t in range(-8, 9):
        X = info["cx"] + sign * t * 0.1 * k - x0
        d.line([(X, 0), (X, im.height)], fill=(0, 90, 255) if t % 5 else (0, 0, 160), width=1)
    for t in range(0, 24):
        Y = info["ground"] - t * 0.1 * k - y0
        d.line([(0, Y), (im.width, Y)], fill=(0, 90, 255) if t % 5 else (0, 0, 160), width=1)
    iou = (S & C).sum() / max(1, (S | C).sum())

    def runs(row):
        d = np.diff(np.concatenate([[0], row.astype(int), [0]]))
        st, en = np.nonzero(d == 1)[0], np.nonzero(d == -1)[0]
        out = []
        for a_, b_ in zip(st, en):
            u, v = sorted((sign * (x0 + a_ - info["cx"]) / k, sign * (x0 + b_ - 1 - info["cx"]) / k))
            if v - u > 0.012:
                out.append(f"{u:+.2f}..{v:+.2f}")
        return " ".join(sorted(out, key=lambda r: float(r.split("..")[0])))
    table = []
    for z in (1.70, 1.65, 1.60, 1.55, 1.50, 1.45, 1.40, 1.35, 1.30, 1.25, 1.20,
              1.15, 1.10, 1.05, 1.00, 0.95, 0.90, 0.85, 0.80, 0.75, 0.70, 0.65, 0.60, 0.55, 0.50, 0.45, 0.40, 0.35, 0.30,
              0.25, 0.20, 0.15, 0.10, 0.05):
        r = int(info["ground"] - z * k) - y0
        if 0 <= r < S.shape[0]:
            table.append(f"  z {z:.2f}  model {runs(S[r]):<44} concept {runs(C[r])}")
    return im, iou, table


def accent_estimate(parts, voxel=0.01, px=0.0186):
    """the three QA's accent share (three_snapshot.mjs: unlit accent vs body pixels at the 52 degree game camera,
    8 facings, ~1.86 cm per 1080p pixel), estimated from the SDF voxels with an orthographic z-buffer"""
    pts, acc = [], []
    for name, S, vs, role, bind, tris, *_r in parts:
        D, plo = S.evaluate(voxel)
        idx = np.argwhere(D < 0)
        if not len(idx):
            continue
        pts.append(plo + idx * voxel)
        acc.append(np.full(len(idx), role == "accent"))
    P = np.concatenate(pts)
    A = np.concatenate(acc)
    pitch = np.radians(52.0)
    tot_a = tot_b = 0
    per = []
    for i in range(8):
        y = np.radians(45.0 * i)
        R = np.array([[np.cos(y), -np.sin(y), 0], [np.sin(y), np.cos(y), 0], [0, 0, 1]])
        Q = P @ R.T
        v = np.array([0.0, np.cos(pitch), -np.sin(pitch)])          # camera in front (-Y), above, looking down
        u = np.array([0.0, np.sin(pitch), np.cos(pitch)])
        dep = Q @ v
        sx = np.round(Q[:, 0] / px).astype(int)
        sy = np.round((Q @ u) / px).astype(int)
        key = (sy - sy.min()) * 100000 + (sx - sx.min())
        o = np.lexsort((dep, key))
        k2 = key[o]
        first = np.ones(len(o), bool)
        first[1:] = k2[1:] != k2[:-1]
        win = o[first]
        a = int(A[win].sum())
        tot_a += a
        tot_b += len(win)
        per.append(round(100 * a / len(win), 2))
    print(f"accent estimate {100 * tot_a / tot_b:.2f}% (per facing {per})")


def sdf_at(S, P):
    """a Sculpt's distance at arbitrary points (its op list replayed)"""
    from common.hifi import sdf
    d = np.full(len(P), 1e3)
    for op, prim, k, _ in S.ops:
        di = prim.d(P)
        if op == "add":
            d = sdf.smin(d, di, k) if k > 0 else np.minimum(d, di)
        elif op == "sub":
            d = sdf.smax(d, -di, k) if k > 0 else np.maximum(d, -di)
        else:
            d = sdf.smax(d, di, k) if k > 0 else np.maximum(d, di)
    return d


class _Shift:
    def __init__(self, prim, off):
        self.p, self.off = prim, np.asarray(off, float)
        self.pad = getattr(prim, "pad", 0.0)

    def bounds(self):
        lo, hi = self.p.bounds()
        return lo + self.off, hi + self.off

    def d(self, P):
        return self.p.d(P - self.off)


def shift_part(part, off):
    from common.hifi.sdf import Sculpt
    name, S, *rest = part
    S2 = Sculpt(name)
    S2.ops = [(op, _Shift(prim, off), k, tag) for op, prim, k, tag in S.ops]
    return (name, S2, *rest)


def pose_check():
    """each key pose's held staff and hanging lamp against the body at rest (torso unturned): the clearance (m) of the
    shaft and the lamp from the mantle, scarf, hood, sleeves... and the left hand's reach"""
    I = ilsheta
    body = {n: S for n, S, *_ in I.sculpts() if n in ("mantle", "scarf", "hood", "dress", "chimney", "collar", "mask")}
    poses = {}
    G_R, G_L = I.G_R, I.G_L
    poses["guard"] = (G_R, G_L)
    run = ((I.wr("R", -0.400, -0.120, 0.975), I.staff_or((0.18, 0.08, 0.98), (0.20, -0.98, 0.0))),)
    poses["run"] = run + (G_L,)
    for name, (R, L) in poses.items():
        ht, o = R
        W = I.SHJ["R"] + np.array(ht.rel) * I.LA
        u = np.cross(np.array(o.fdir), np.array(o.palm))      # u = k x n ... recover u from (k, n = u x k)
        k = np.array(o.fdir)
        n = np.array(o.palm)
        u = np.cross(k, n)
        C = W + k * I.GRIP_AB[0] + n * I.GRIP_AB[1]
        pts = [C + u * s for s in np.linspace(I.S_BUTT, I.S_TOP, 25)]
        hang = C + u * I.HANG_UK[1] + k * I.HANG_UK[0]
        lamp = []
        for dz, r in I.GLASS_R:
            for a in np.linspace(0, 2 * np.pi, 12, endpoint=False):
                lamp.append(hang + np.array([r * np.cos(a), r * np.sin(a), -dz]))
        lamp = np.array(lamp)
        pts = np.array(pts)
        print(f"{name}: wrist {W.round(3)} grip {C.round(3)} butt {pts[0].round(3)} hang {hang.round(3)} lamp bottom z {hang[2] - I.LAMP_DROP:.3f}")
        for bn, S in body.items():
            ds = sdf_at(S, pts) - I.SHAFT_R
            dl = sdf_at(S, lamp)
            print(f"   {bn:8s} shaft clearance {ds.min():+.3f}  lamp clearance {dl.min():+.3f}")
        if L is not None:
            hl, ol = L
            WL = I.SHJ["L"] + np.array(hl.rel) * I.LA
            print(f"   left wrist {WL.round(3)} reach {np.linalg.norm(WL - I.SHJ['L']):.3f} / arm {I.LA}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voxel", type=float, default=0.01)
    ap.add_argument("--only", default="")
    ap.add_argument("--table", action="store_true", help="print model / concept extents per height")
    ap.add_argument("--accent", action="store_true", help="estimate the accent share at the game camera and exit")
    ap.add_argument("--poses", action="store_true", help="the held staff / lamp clearance check and exit")
    ap.add_argument("--skin", default="", help="add a skin's extra geometry (stillwater | first_bell)")
    ap.add_argument("--lamp-at", default="", help="x,y,z: hang the lamp there (the accent estimate in a held pose)")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    if a.poses:
        pose_check()
        return
    parts = ilsheta.sculpts()
    if a.skin == "stillwater":
        parts += ilsheta.skin_extras({"reed_plates": True})
    elif a.skin == "first_bell":
        parts += ilsheta.skin_extras({"glass_bell": True, "hour_marks": True})
    if a.only:
        keep = set(a.only.split(","))
        parts = [p for p in parts if p[0] in keep]
    if a.lamp_at:
        off = np.array([float(v) for v in a.lamp_at.split(",")]) - ilsheta.HANG0
        parts = [shift_part(p_, off) if p_[0] in ("lamp_stone", "lamp_glass", "flame") else p_ for p_ in parts
                 if p_[0] != "staff"]
    if a.accent:
        accent_estimate(parts, a.voxel)
        return
    R, lo, hi = march(parts, a.voxel)
    meta = json.loads((CACHE / "ilsheta_plates.json").read_text())
    concept = Image.open(ART.parent / "_design" / "concept" / "ilsheta.webp").convert("RGB")
    mask = np.asarray(Image.open(CACHE / "ilsheta_mask.png")) > 127
    mask = nd.binary_dilation(mask, iterations=6)          # the plates' cut is eroded 6 px off the outline
    for side in ("front", "back"):
        im, iou, table = overlay(side, R[side], lo, hi, a.voxel, meta, concept, mask)
        im.save(OUT / f"fit_{side}.png")
        print(f"{side}: silhouette IoU vs concept {iou:.3f}")
        if a.table:
            print("\n".join(table))
    ims = [shade(R["front"], parts, a.voxel), shade(R["back"], parts, a.voxel, flip=True),
           shade(R["side"], parts, a.voxel), shade(R["top"], parts, a.voxel)]
    W = sum(i.width for i in ims) + 10 * (len(ims) - 1)
    Hh = max(i.height for i in ims)
    sheet = Image.new("RGB", (W, Hh), (20, 20, 24))
    x = 0
    for i in ims:
        sheet.paste(i, (x, 0))
        x += i.width + 10
    sheet.save(OUT / "views.png")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
