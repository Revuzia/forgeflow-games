"""VALE RIFT minimap as a calm survey chart (final parity hud HUD-3; RIFT brief map_rift_landmarks.md §7).

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/maps/minimap_survey.py [--map map_rift] [--report out.json]

Not a Blender script: numpy + PIL over the painted minimap (art/blender/ui/minimap_paint.py's Cycles render, kept as
art/renders/maps/minimap_<id>_painted.png; the first run copies the shipped minimap there) and the map JSON (the same
layout truth the sim and the HUD read), written back to art/out/maps/<id>/minimap.png at the same size and bounds
(image row 0 = sim y 0, column 0 = sim x 0; the HUD maps the image onto the map rectangle).

Flat values (brief §7), the painting kept only as a faint residual (its high frequencies at a low weight):
  walls (the Dialwood masses)  two value bands: a lit core L* 19 and an ink rim L* 11 over the outer 0.9 m (no tree
                               texture, so the corridors pop)
  Dialwood floor               L* 35, olive earth;   Needlegrass  L* 26, green;   camp clearings  L* 50 dots (r 3.2 m)
  roads                        one light band L* 75 (6.2 m, the painter's road width) with a 0.55 m ink edge (L* 12)
  flat fields in their painted colour   the Noonline's floors (Standing Shadow violet, the Fallen Shaft's water) and
                               both plazas (chalk / ironstone; the fountains ringed in ink); the Seat an L* 56 dot
Fog check (HUD fog = ink at 140/255 over unseen cells, src/ui/hud/minimap.tsx): a fogged gap is 0.451 x the seen gap,
so the road band must clear the canopy by >= 56 luma seen for >= 25 in fog; the report measures it at HUD size.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))

SS = 4                      # mask supersampling (anti-aliased edges)
ROAD_W = 6.2                # m, as the painter's ribbon (minimap_paint.py build_rift)
INK_W = 0.55                # m, the road's ink edge
RIM_W = 0.9                 # m, the walls' ink rim
CAMP_R = 3.2                # m, a camp clearing dot (map_gen.py keep-out disc)
RESID = {"wall": 0.10, "floor": 0.16, "grass": 0.14, "road": 0.08}
FOG_A = 140 / 255           # minimap.tsx fog alpha


# ── colour ────────────────────────────────────────────────────────────────────────────────────────
def lab2rgb(L, a, b):
    fy = (L + 16) / 116
    fx, fz = fy + a / 500, fy - b / 200
    e = 216 / 24389
    f = lambda t: t ** 3 if t ** 3 > e else (116 * t - 16) / (24389 / 27)
    X, Y, Z = 0.95047 * f(fx), 1.0 * f(fy), 1.08883 * f(fz)
    M = np.array([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]])
    lin = np.clip(M @ np.array([X, Y, Z]), 0, 1)
    s = np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * lin ** (1 / 2.4) - 0.055)
    return np.clip(s * 255, 0, 255)


def lstar(rgb):
    c = rgb / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    Y = lin @ np.array([0.2126, 0.7152, 0.0722])
    return np.where(Y > 216 / 24389, 116 * np.cbrt(Y) - 16, Y * 24389 / 27)


def luma(rgb):
    return rgb @ np.array([0.2126, 0.7152, 0.0722])


PAL = {
    "wall": lab2rgb(19, -8, 7), "rim": lab2rgb(11, -5, 4),
    "floor": lab2rgb(35, 1, 11), "grass": lab2rgb(26, -11, 11), "camp": lab2rgb(50, 2, 10),
    "road": lab2rgb(75, 2, 13), "ink": lab2rgb(12, 1, 4), "seat": lab2rgb(56, 2, 9),
}


# ── masks ─────────────────────────────────────────────────────────────────────────────────────────
class Raster:
    def __init__(self, W, H, w, h):
        self.W, self.H, self.w, self.h = W, H, w, h
        self.sx, self.sy = w / W, h / H
        ys, xs = np.mgrid[0:h, 0:w]
        self.X, self.Y = (xs + 0.5) / self.sx, (ys + 0.5) / self.sy          # sim metres at each pixel centre

    def polys(self, polys) -> np.ndarray:
        im = Image.new("L", (self.w * SS, self.h * SS), 0)
        d = ImageDraw.Draw(im)
        for p in polys:
            if len(p) >= 3:
                d.polygon([(x * self.sx * SS, y * self.sy * SS) for x, y in p], fill=255)
        return np.asarray(im.resize((self.w, self.h), Image.BOX), dtype=np.float64) / 255.0

    def disc(self, c, r) -> np.ndarray:
        d = np.hypot(self.X - c[0], self.Y - c[1])
        return np.clip((r - d) * self.sx + 0.5, 0, 1)

    def dist_to_path(self, path) -> np.ndarray:
        best = np.full(self.X.shape, 1e9)
        for (ax, ay), (bx, by) in zip(path[:-1], path[1:]):
            dx, dy = bx - ax, by - ay
            L2 = dx * dx + dy * dy
            t = np.clip(((self.X - ax) * dx + (self.Y - ay) * dy) / max(L2, 1e-9), 0, 1)
            best = np.minimum(best, np.hypot(self.X - (ax + t * dx), self.Y - (ay + t * dy)))
        return best


def band(dist, w, px_per_m):
    """1 inside dist <= w, anti-aliased over a pixel"""
    return np.clip((w - dist) * px_per_m + 0.5, 0, 1)


def residual(src, sigma_px):
    L = luma(src)
    im = Image.fromarray(np.clip(L, 0, 255).astype(np.uint8))
    blur = np.asarray(im.filter(ImageFilter.GaussianBlur(sigma_px)), dtype=np.float64)
    return L - blur


def mix(out, colour, mask, res=None, k=0.0):
    c = np.broadcast_to(colour, out.shape).astype(np.float64)
    if res is not None and k:
        c = c + (res * k)[..., None]
    return out * (1 - mask[..., None]) + c * mask[..., None]


# ── the chart ─────────────────────────────────────────────────────────────────────────────────────
def survey(mid: str) -> dict:
    m = json.load(open(os.path.join(GAME, "content", "maps", f"{mid}.json")))
    W, H = m["size"]
    out_png = os.path.join(GAME, "art", "out", "maps", mid, "minimap.png")
    src_png = os.path.join(GAME, "art", "renders", "maps", f"minimap_{mid.split('_')[1]}_painted.png")
    if not os.path.exists(src_png):
        os.makedirs(os.path.dirname(src_png), exist_ok=True)
        shutil.copyfile(out_png, src_png)
    src = np.asarray(Image.open(src_png).convert("RGB"), dtype=np.float64)
    h, w = src.shape[:2]
    R = Raster(W, H, w, h)
    ppm = R.sx
    t = m["art"]["terrain"]
    res = residual(src, 1.5 * ppm)

    walls = R.polys(m["walls"])
    walk = 1.0 - walls
    # the walls' ink rim: the outer RIM_W m of every wall mass (distance into the wall from open ground)
    open_im = Image.fromarray((walk * 255).astype(np.uint8))
    grow = np.asarray(open_im.filter(ImageFilter.MaxFilter(2 * int(round(RIM_W * ppm)) + 1)), dtype=np.float64) / 255.0
    grow = np.asarray(Image.fromarray((grow * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), dtype=np.float64) / 255.0
    rim = np.clip(grow - walk, 0, 1)
    out = mix(src.copy(), PAL["floor"], walk, res, RESID["floor"])
    out = mix(out, PAL["wall"], walls, res, RESID["wall"])
    out = mix(out, PAL["rim"], rim * walls, res, RESID["wall"])
    out = mix(out, PAL["grass"], R.polys(m["thickets"]) * walk, res, RESID["grass"])
    for c in m["camps"]:
        if c["id"] in ("sunsplinter", "longshade"):
            continue                                     # the objectives' pits are the Noonline's own floors
        out = mix(out, PAL["camp"], R.disc(c["units"][0]["at"], CAMP_R) * walk)
    # roads: one light band with an ink edge (the Seat and the plazas keep their painting over them)
    d = np.min([R.dist_to_path(l["path"]) for l in m["lanes"]], axis=0)
    out = mix(out, PAL["ink"], band(d, ROAD_W / 2 + INK_W, ppm))
    road = band(d, ROAD_W / 2, ppm)
    out = mix(out, PAL["road"], road, res, RESID["road"])
    # the Noonline's two floors, the Seat and the plazas: each one flat field in its own painted colour (the median of
    # its open, crown-free pixels), so they keep their identity (violet shadow, water, chalk / ironstone terraces)
    # without the painter's overhanging crowns and their shadows; the plazas' fountains and the Seat get an ink ring
    g = src[..., 1] - np.maximum(src[..., 0], src[..., 2])
    clean = (g <= 4)
    fields = []
    nl = t.get("noonline", {})
    for k in ("standingShadow", "fallenShaft"):
        for poly in nl.get(k, {}).get("floor", []):
            fields.append((R.polys([poly]), None))
    for p in t.get("plazas", []):
        fields.append((R.disc(p["at"], p["radius"]), None))
    if "seat" in t:
        fields.append((R.disc(t["seat"]["at"], t["seat"]["radius"] + 0.4), PAL["seat"]))
    for mask, colour in fields:
        mk = mask * walk
        if colour is None:
            sel = (mk > 0.95) & clean
            Ls = luma(src[sel])
            lo, hi = np.percentile(Ls, 35), np.percentile(Ls, 90)
            colour = np.median(src[sel][(Ls >= lo) & (Ls <= hi)], axis=0)
        out = mix(out, colour, mk, res, RESID["road"])
    ring = lambda c, r, wd: np.clip(1 - np.abs(np.hypot(R.X - c[0], R.Y - c[1]) - r) * ppm / max(wd * ppm / 2, 0.5), 0, 1)
    for bse in m.get("bases", []):
        f = bse["fountain"]
        out = mix(out, PAL["ink"], ring(f["at"], f["radius"], 0.35) * walk * 0.85)
    if "seat" in t:
        out = mix(out, PAL["ink"], ring(t["seat"]["at"], t["seat"]["radius"], 0.45) * 0.9)
    keep = np.zeros_like(walls)
    for mask, _ in fields:
        keep = np.maximum(keep, mask * walk)
    out8 = np.clip(np.round(out), 0, 255).astype(np.uint8)
    Image.fromarray(out8).save(out_png, optimize=True)
    return measure(m, R, out8.astype(np.float64), walls, road, keep)


def measure(m, R, img, walls, road, keep) -> dict:
    """Seen / fogged luma of the road band vs the walls, full size and at the HUD's 1x size (RIFT frame 352 x 198)."""
    rep = {}
    for tag, scale in (("full", 1.0), ("hud1x", None)):
        if scale is None:
            hh = 198 - 2 * 8                              # minimap.tsx fit: the frame's height less its padding
            ww = int(round(R.w * hh / R.h))
            im = np.asarray(Image.fromarray(img.astype(np.uint8)).resize((ww, hh), Image.BOX), dtype=np.float64)
            wm = np.asarray(Image.fromarray((walls * 255).astype(np.uint8)).resize((ww, hh), Image.BOX), dtype=np.float64) / 255
            rm = np.asarray(Image.fromarray((road * (1 - keep) * 255).astype(np.uint8)).resize((ww, hh), Image.BOX), dtype=np.float64) / 255
        else:
            im, wm, rm = img, walls, road * (1 - keep)
        L = luma(im)
        lr, lw = L[rm > 0.95], L[wm > 0.95]
        p = lambda v, q: round(float(np.percentile(v, q)), 1)
        seen_gap = p(lr, 5) - p(lw, 95)
        rep[tag] = {"road_luma_p5_p50": [p(lr, 5), p(lr, 50)], "wall_luma_p50_p95": [p(lw, 50), p(lw, 95)],
                    "road_Lstar_p50": round(float(np.median(lstar(im[rm > 0.95]))), 1),
                    "wall_Lstar_p50": round(float(np.median(lstar(im[wm > 0.95]))), 1),
                    "seen_gap_road_p5_minus_wall_p95": round(seen_gap, 1),
                    "fog_gap": round(seen_gap * (1 - FOG_A), 1)}
    return rep


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", default="map_rift")
    ap.add_argument("--report", default="")
    a = ap.parse_args()
    rep = survey(a.map)
    print(json.dumps(rep, indent=1))
    if a.report:
        with open(a.report, "w") as f:
            json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
