"""VALE RIFT minimap as a calm survey chart (final parity hud HUD-3; RIFT brief map_rift_landmarks.md §7).

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/maps/minimap_survey.py [--map map_rift] [--pad PX PY]
                                                                                   [--out file.png] [--report out.json]

Not a Blender script: numpy + PIL over the painted minimap (art/blender/ui/minimap_paint.py's Cycles render, kept as
art/renders/maps/minimap_<id>_painted.png over the map rectangle 0..W x 0..H; the first run copies the shipped minimap
there) and the map JSON (the same layout truth the sim and the HUD read), written to art/out/maps/<id>/minimap.png at
the painting's pixel size (image row 0 = sim y = bounds y0, column 0 = sim x = bounds x0).

Margin (hud HUD-3, integration run 2 world-pad): the chart covers the map's art.terrain.minimapBounds [x0, y0, x1, y1]
when the map JSON sets one (src/ui/hud/minimap.tsx minimapBounds draws the image over that rectangle and maps clicks
through it), else the map rectangle; --pad PX PY overrides it with [-PX, -PY, W + PX, H + PY] and prints the bounds to
put in the JSON. RIFT carries 6 m per side in x and 4 m in y ([-6, -4, 176, 114], the 1100 x 712 aspect), because its
base plazas (r 13 at x 12 / 158) and fountain rings (r 5 at x 4.5 / 165.5) reach past the map's x edges and were cut.
Out there the painting is sampled mirrored across the map's edge (so the canopy residual runs on), every pixel outside
the map is Dialwood mass (with its ink rim) except the plaza discs, which are painted whole out to the margin with their
fountain rings. --pad 0 0 reproduces the unpadded chart.

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
import re
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
    """a w x h pixel grid over the sim rectangle b = [x0, y0, x1, y1] (the map, or the map plus a margin)"""
    def __init__(self, b, w, h):
        self.b, self.w, self.h = tuple(float(v) for v in b), w, h
        self.sx, self.sy = w / (self.b[2] - self.b[0]), h / (self.b[3] - self.b[1])
        ys, xs = np.mgrid[0:h, 0:w]
        self.X = self.b[0] + (xs + 0.5) / self.sx                             # sim metres at each pixel centre
        self.Y = self.b[1] + (ys + 0.5) / self.sy

    def polys(self, polys) -> np.ndarray:
        im = Image.new("L", (self.w * SS, self.h * SS), 0)
        d = ImageDraw.Draw(im)
        x0, y0 = self.b[0], self.b[1]
        for p in polys:
            if len(p) >= 3:
                d.polygon([((x - x0) * self.sx * SS, (y - y0) * self.sy * SS) for x, y in p], fill=255)
        return np.asarray(im.resize((self.w, self.h), Image.BOX), dtype=np.float64) / 255.0

    def inside(self, W, H) -> np.ndarray:
        """coverage of the map rectangle 0..W x 0..H (1 inside, 0 in the margin, anti-aliased over a pixel)"""
        cx = np.clip(np.minimum(self.X, W - self.X) * self.sx + 0.5, 0, 1)
        cy = np.clip(np.minimum(self.Y, H - self.Y) * self.sy + 0.5, 0, 1)
        return cx * cy

    def sample(self, src, W, H) -> np.ndarray:
        """the painting (over 0..W x 0..H) bilinearly sampled at each pixel centre, mirrored across the map's edges in
        the margin; exact (no resampling) when the raster is the painting's own grid"""
        sh, sw = src.shape[:2]
        X = np.abs(self.X); X = np.where(X > W, 2 * W - X, X)
        Y = np.abs(self.Y); Y = np.where(Y > H, 2 * H - Y, Y)
        u = np.clip(X * sw / W - 0.5, 0, sw - 1)
        v = np.clip(Y * sh / H - 0.5, 0, sh - 1)
        u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int)
        u1 = np.minimum(u0 + 1, sw - 1); v1 = np.minimum(v0 + 1, sh - 1)
        fu = (u - u0)[..., None]; fv = (v - v0)[..., None]
        top = src[v0, u0] * (1 - fu) + src[v0, u1] * fu
        bot = src[v1, u0] * (1 - fu) + src[v1, u1] * fu
        return top * (1 - fv) + bot * fv

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
def chart_bounds(m, pad=None) -> list:
    """[x0, y0, x1, y1]: --pad PX PY, else the map's art.terrain.minimapBounds, else the map rectangle"""
    W, H = m["size"]
    if pad is not None:
        px, py = (float(v) for v in pad)
        return [(-px) or 0.0, (-py) or 0.0, W + px, H + py]
    b = m.get("art", {}).get("terrain", {}).get("minimapBounds")
    if isinstance(b, list) and len(b) == 4 and b[2] > b[0] and b[3] > b[1]:
        return [float(v) for v in b]
    return [0.0, 0.0, float(W), float(H)]


def survey(mid: str, pad=None, out_png: str = "") -> dict:
    m = json.load(open(os.path.join(GAME, "content", "maps", f"{mid}.json")))
    W, H = m["size"]
    ship_png = os.path.join(GAME, "art", "out", "maps", mid, "minimap.png")
    out_png = out_png or ship_png
    src_png = os.path.join(GAME, "art", "renders", "maps", f"minimap_{mid.split('_')[1]}_painted.png")
    if not os.path.exists(src_png):
        os.makedirs(os.path.dirname(src_png), exist_ok=True)
        shutil.copyfile(ship_png, src_png)
    paint = np.asarray(Image.open(src_png).convert("RGB"), dtype=np.float64)
    h, w = paint.shape[:2]
    b = chart_bounds(m, pad)
    R = Raster(b, w, h)
    src = R.sample(paint, W, H)
    ppm = R.sx
    t = m["art"]["terrain"]
    res = residual(src, 1.5 * ppm)

    walls_in = R.polys(m["walls"])
    # the margin: Dialwood mass beyond the map's edge, except the base plaza discs, which run on out to their rim
    plaza = np.zeros_like(walls_in)
    for p in t.get("plazas", []):
        plaza = np.maximum(plaza, R.disc(p["at"], p["radius"]))
    # (walls_in is the walled share of each pixel's area inside the map; the margin adds the share outside it, so a pixel
    # straddling the map's edge is whole wall, with no half-open seam along the edge)
    walls = np.clip(walls_in + (1.0 - R.inside(W, H)) * (1.0 - plaza), 0.0, 1.0)
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
    rep = {"out": os.path.relpath(out_png, GAME) if os.path.abspath(out_png).startswith(GAME + os.sep) else out_png, "size": [w, h], "bounds": b,
           "px_per_m": [round(R.sx, 3), round(R.sy, 3)], "inside_bounds_m": inside_report(m, b)}
    rep.update(measure(m, R, out8.astype(np.float64), walls_in, road, keep))
    return rep


def inside_report(m, b) -> dict:
    """how far each plaza disc and fountain ring stays inside the chart, in metres (negative = cut at the image edge)"""
    def room(at, r):
        return round(min(at[0] - r - b[0], b[2] - at[0] - r, at[1] - r - b[1], b[3] - at[1] - r), 2)
    rep = {}
    for i, p in enumerate(m["art"]["terrain"].get("plazas", [])):
        rep[f"plaza{i}"] = room(p["at"], p["radius"])
    for bse in m.get("bases", []):
        f = bse["fountain"]
        rep[f"fountain{bse['team']}"] = room(f["at"], f["radius"])
    return rep


def hud_frame(shape: str = "rect") -> tuple:
    """the HUD minimap canvas at 1x (src/ui/hud/frame_layout.ts FRAME.minimap.<shape>; the frame border is outside it)"""
    try:
        txt = open(os.path.join(GAME, "src", "ui", "hud", "frame_layout.ts")).read()
        mm = re.search(r'"minimap"\s*:\s*\{(.*?)\}', txt, re.S)
        hit = re.search(rf'"{shape}"\s*:\s*\[\s*(\d+)\s*,\s*(\d+)\s*\]', mm.group(1)) if mm else None
        if hit:
            return int(hit.group(1)), int(hit.group(2))
    except OSError:
        pass
    return 352, 228


def measure(m, R, img, walls, road, keep) -> dict:
    """Seen / fogged luma of the road band vs the walls, full size and at the HUD's 1x size (the RIFT frame, fitted as
    minimap.tsx fitMap does: the chart bounds scaled to fit the canvas)."""
    rep = {}
    fw, fh = hud_frame("rect")
    bw, bh = R.b[2] - R.b[0], R.b[3] - R.b[1]
    k = min(fw / bw, fh / bh)
    rep["hud1x_canvas"] = [fw, fh]
    rep["hud1x_chart_px"] = [round(bw * k, 1), round(bh * k, 1)]
    for tag, scale in (("full", 1.0), ("hud1x", None)):
        if scale is None:
            ww, hh = max(1, int(round(bw * k))), max(1, int(round(bh * k)))
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
    ap.add_argument("--pad", type=float, nargs=2, metavar=("PX", "PY"), default=None,
                    help="margin in metres per side (x, y); default: the map's art.terrain.minimapBounds, else none")
    ap.add_argument("--out", default="", help="write here instead of art/out/maps/<id>/minimap.png")
    ap.add_argument("--report", default="")
    a = ap.parse_args()
    rep = survey(a.map, tuple(a.pad) if a.pad else None, a.out)
    m = json.load(open(os.path.join(GAME, "content", "maps", f"{a.map}.json")))
    jb = m["art"]["terrain"].get("minimapBounds")
    if not jb or [round(float(v), 3) for v in jb] != [round(float(v), 3) for v in rep["bounds"]]:
        print(f"NOTE: {a.map}.json art.terrain.minimapBounds is {jb}; this chart covers {rep['bounds']} "
              f"(set the JSON to match before shipping it)")
    print(json.dumps(rep, indent=1))
    if a.report:
        with open(a.report, "w") as f:
            json.dump(rep, f, indent=1)


if __name__ == "__main__":
    main()
