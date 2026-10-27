"""brightwick hood-light check: sphere-traces the hood sculpt (outer form minus the tombstone hollow, plus the crown
band's shell) and the hood-light ellipsoid from the 52 deg gameplay pitch and from eye level, and reports how much
of the light each view sees and where it sits in the opening. Fast (numpy only, no bake): for placing the light.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_brightwick_hoodlight.py \
        -- [--faction aubade|serenade|both] [--light "y,z,rx,ry,rz"] [--out PNG]

Writes art/.cache/brightwick_look/hoodlight_<faction>.png (2 views: eye level 4 deg, game 52 deg; light = blue).
"""
from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))

from common import scene  # noqa: E402

import wick_brightwick as bw  # noqa: E402

BAND = {"aubade": (*bw.CROWN_A, 0.018), "serenade": (*bw.CROWN_S, 0.016)}   # the crown bands (z0, z1, thickness)


def scene_sdf(F, fac):
    hood = bw.Sculpt("hood")
    hood.add(bw.hood_outer(F), k=0.0)
    hood.sub(bw.tomb_of(F), k=0.010)
    D = bw.sdf_of(hood)
    outer = bw.hood_outer(F)
    z0, z1, t = BAND[fac]

    def f(P):
        band = np.maximum(np.maximum(outer.d(P) - t, z0 - P[:, 2]), P[:, 2] - z1)
        return np.minimum(D.d(P), band)
    return f


def tilt_axes(deg):
    """rows = the light's local axes: X, and Y/Z turned about X by `deg` (its top leans back toward +Y)"""
    t = np.radians(deg)
    return np.array([(1.0, 0.0, 0.0), (0.0, np.cos(t), -np.sin(t)), (0.0, np.sin(t), np.cos(t))])


def ell_hit(O, d, c, r, tilt=0.0):
    """t of the first hit of rays O + t d on the ellipsoid (c, r, tilted `tilt` deg about X); inf on a miss"""
    ax = tilt_axes(tilt)
    o = ((O - c) @ ax.T) / r
    dd = (d @ ax.T) / r
    a = (dd * dd).sum(1)
    b = 2 * (o * dd).sum(1)
    cc = (o * o).sum(1) - 1
    disc = b * b - 4 * a * cc
    t = (-b - np.sqrt(np.maximum(disc, 0))) / (2 * a)
    return np.where((disc > 0) & (t > 0), t, np.inf)


def trace(f, c, r, pitch_deg, n=160, span=0.46, centre=(0.0, -0.05, 1.43), tilt=0.0):
    p = np.radians(pitch_deg)
    back = np.array((0.0, np.cos(p), -np.sin(p)))          # view direction (into the hood: +Y, down)
    up = np.array((0.0, np.sin(p), np.cos(p)))
    right = np.array((1.0, 0.0, 0.0))
    u = (np.arange(n) + 0.5) / n - 0.5
    X, Y = np.meshgrid(u * span, -u * span)
    O = np.asarray(centre)[None] + X.reshape(-1, 1) * right + Y.reshape(-1, 1) * up - back * 1.0
    d = np.tile(back, (len(O), 1))
    t = np.zeros(len(O))
    hit = np.full(len(O), np.inf)
    alive = np.ones(len(O), bool)
    for _ in range(160):
        idx = np.nonzero(alive)[0]
        if not len(idx):
            break
        dist = f(O[idx] + d[idx] * t[idx, None])
        h = dist < 6e-4
        hit[idx[h]] = t[idx[h]]
        t[idx] += np.maximum(dist, 4e-4)
        alive[idx[h | (t[idx] > 2.0)]] = False
    tl = ell_hit(O, d, np.asarray(c), np.asarray(r), tilt)
    light = tl < hit
    surf = np.isfinite(hit) & ~light
    # shade the hood by depth (ink inside the hollow = far hits)
    img = np.full((len(O), 3), (0.80, 0.80, 0.78))
    dep = np.where(surf, hit, 0.0)
    inside = surf & (dep > 1.0 + 0.0)
    img[surf] = (0.55, 0.55, 0.55)
    img[inside & (dep > np.percentile(dep[surf], 50) if surf.any() else inside)] = (0.12, 0.12, 0.14)
    img[light] = (0.25, 0.6, 1.0)
    return img.reshape(n, n, 3), float(light.mean() * span * span)


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--faction", default="both")
    ap.add_argument("--light", default="")
    ap.add_argument("--out", default="")
    ap.add_argument("--sweep", default="", help="candidates 'y,z,rx,ry,rz,tilt;...' -> one sheet row each")
    a = ap.parse_args(scene.script_args())
    facs = ("aubade", "serenade") if a.faction == "both" else (a.faction,)
    if a.sweep:
        import bpy
        for fac in facs:
            F = bw.FORM[fac]
            f = scene_sdf(F, fac)
            rows = []
            for k, cand in enumerate(a.sweep.split(";")):
                cy, cz, rx, ry, rz, tl = (float(x) for x in cand.split(","))
                tiles = []
                for pitch in (4.0, 52.0):
                    img, area = trace(f, (0.0, cy, cz), (rx, ry, rz), pitch, n=120, tilt=tl)
                    tiles.append(img)
                    print(f"[hoodlight] {fac} #{k} {cand} pitch {pitch:>4}: visible {area * 1e4:.1f} cm2")
                rows.append(np.concatenate(tiles, 1))
            sheet = np.concatenate(rows, 0)[::-1]
            h, w = sheet.shape[:2]
            im = bpy.data.images.new("sweep", w, h)
            im.pixels.foreach_set(np.concatenate([sheet, np.ones((h, w, 1))], 2).astype(np.float32).ravel())
            im.filepath_raw = os.path.join(scene.CACHE_DIR, "brightwick_look", f"hoodlight_sweep_{fac}.png")
            im.file_format = "PNG"
            im.save()
        return
    for fac in facs:
        F = bw.FORM[fac]
        (cx, cy, cz), (rx, ry, rz), tl = F["hood_light"]
        if a.light:
            cy, cz, rx, ry, rz = (float(x) for x in a.light.split(","))
        f = scene_sdf(F, fac)
        tiles = []
        for pitch in (4.0, 52.0):
            img, area = trace(f, (cx, cy, cz), (rx, ry, rz), pitch, tilt=tl)
            tiles.append(img)
            print(f"[hoodlight] {fac} light ({cy:.3f}, {cz:.3f}) r ({rx}, {ry}, {rz}) pitch {pitch:>4}: visible "
                  f"{area * 1e4:.1f} cm2")
        out = a.out or os.path.join(scene.CACHE_DIR, "brightwick_look", f"hoodlight_{fac}.png")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        import bpy
        sheet = np.concatenate(tiles, 1)[::-1]
        h, w = sheet.shape[:2]
        im = bpy.data.images.new("hoodlight", w, h)
        im.pixels.foreach_set(np.concatenate([sheet, np.ones((h, w, 1))], 2).astype(np.float32).ravel())
        im.filepath_raw = out
        im.file_format = "PNG"
        im.save()
        print(f"[hoodlight] {out}")


if __name__ == "__main__":
    main()
