"""Painted dusk plates behind the fighter images (final parity client F3, art half).

portrait.png (512 x 512) and splash.png (1600 x 900), and every <skin>_portrait.png / <skin>_splash.png, are the
menu art: the draft grid, the Lot, the loading cards (a 3:5 crop of the splash), Collection, Skins and the shop.
Before this pass they stood on the maps' pale daylight plate and were the brightest things on every menu screen.
A fighter listed in art/blender/fighters/plates.json now stands on a PAINTED plate cut from the menu paintings
(art/out/backdrops/<src>.webp) and graded to dusk for its origin (spec.ORIGIN):

  * aubade    the morning rim at blue hour: chalk spires, cool slate sky, a pale low glow on the west (left)
  * serenade  the evening rim at lamp-time: ironstone domes, warm amber windows, the low glow on the east (right)
  * hourless  the needle over the gorge at twilight: both rims, a violet sky, the glow straight behind
  a skin line may take its own painting (plates.json "lines"); the origin grade and light stay.

The plate is cut (a per-image window, jittered by id so no two plates repeat), Kuwahara-brushed, defocused like a
long lens, exposed to a target median, tinted, darkened toward the top (it fades into the UI's ink) and the
foreground, given a soft low-sun glow on the origin's side, shouldered so only small highlights (the lamps) pass
luma 200, and canvas-toothed. The subject is lit to match (art_light: key, fill tint, rims). The subject is
composed over it exactly as render.splash_post does (light wrap, bloom, vignette), then the vale_grade_01 LUT.

The raw subject passes (straight RGBA, display sRGB, before the post) are kept in art/.cache/fighters/plates/, so
the plates are re-graded without Blender:
    python3 art/blender/common/plates.py compose [sids] [--preview]
    python3 art/blender/common/plates.py measure [sids] [--preview]
`measure` reads the shipped (or preview) images and reports the two crops the client shows: the 3:5 loading card
(object-position 86 % 50 % of the splash) and the draft cell (the portrait at 50 % 20 %), p50 / p95 / share > 200
by Rec. 709 luma (the same measure as _harness/_reports/final_menus_scripts/luma.cjs). Gate: p50 70-110, at most
a small share above 200.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
ART_DIR = os.path.dirname(BLENDER_DIR)
GAME_DIR = os.path.dirname(ART_DIR)
TABLE = os.path.join(BLENDER_DIR, "fighters", "plates.json")
BACKDROPS = os.path.join(ART_DIR, "out", "backdrops")
OUT_DIR = os.path.join(ART_DIR, "out", "fighters")
RENDERS_DIR = os.path.join(ART_DIR, "renders", "fighters")
CACHE_DIR = os.path.join(ART_DIR, ".cache", "fighters", "plates")
LUT = os.path.join(ART_DIR, "out", "grade", "vale_grade_01.cube")
Y709 = np.array([0.2126, 0.7152, 0.0722], np.float32)

DEFAULTS = {
    "src": "seat_center",       # art/out/backdrops/<src>.webp
    # the cut: splash = a 16:9 window (zoom >= 1, centre jittered by id); portrait = a square window around the
    # far horizon behind the head (size: fraction of the painting's height)
    "zoom": 1.06, "zoom_j": 0.10, "cx": 0.52, "cx_j": 0.05, "cy": 0.50,
    "p_size": 0.56, "p_cx": 0.62, "p_cx_j": 0.10, "p_cy": 0.40,
    "paint_r": 3,               # Kuwahara radius at 1600 px (the painting's brushwork, unified with the game's)
    "dof": 2.2,                 # defocus sigma at 1600 px (splash); the portrait's long lens:
    "dof_p": 4.5,               # sigma at 512 px
    "median": 0.27,             # display luma median of the plate before the LUT (the LUT is near identity there)
    "tint": "#A0A8C8",          # linear multiply, normalised to luma 1
    "sat": 0.85,
    "top": 0.42,                # darkening toward the top edge (the card fades into the UI ink above the plate)
    "top_to": 0.50,             #   ... reaching zero at this height
    "floor": 0.30,              # foreground darkening below `floor_from` (the empty ground frames the subject)
    "floor_from": 0.78,
    "vignette": 0.22,
    "glow": [0.50, 0.60, 0.42, 0.08],    # x, y, radius (fractions), strength (linear, added): the low sun
    "glow_color": "#F0C8A0",
    "knee": 0.60, "cap": 0.86,  # display shoulder: values above `knee` approach `cap` (only small highlights > 200)
    "tooth": 0.05,
    # the subject, lit to match the plate (render.fighter_renders via art_light)
    "key": 0.80, "key_color": None, "fill": 0.50, "fill_tint": None, "rim_cool": 1.0, "rim_warm": 1.0,
    # the subject's grade in the composite (the dusk exposure): its brightest 5 % (solid pixels) at most `sub_p95`
    # display luma (a white chalk kit under the dusk key), a dark kit's median lifted toward `sub_floor`, the
    # scale bounded to [sub_min_k, sub_max_k] (linear), then a shoulder above `sub_knee` toward `sub_cap`
    "sub_p95": 0.74, "sub_floor": 0.20, "sub_min_k": 0.55, "sub_max_k": 1.35, "sub_knee": 0.68, "sub_cap": 0.84,
    # a kit still under its floor after the scale (a face in a hat brim's shadow) gets a toe lift: a gamma that
    # takes its median to the floor (`sub_floor_p` for the portrait: a draft cell is a face) and keeps white white
    "sub_floor_p": 0.30, "sub_gamma_min": 0.62,
    "sub_ceil": 0.39,           # ... and a pale kit's median at most this (the cell stays a mid value)
    # the post (render.splash_post's light wrap / bloom / vignette strengths)
    "post": 1.0, "post_p": 0.6,
}


# ── table ────────────────────────────────────────────────────────────────────────────────────────
def table() -> dict:
    if not os.path.isfile(TABLE):
        return {}
    with open(TABLE, encoding="utf-8") as f:
        return json.load(f)


def _origin_of(fid: str) -> str | None:
    """spec.ORIGIN read from the fighter's script without importing it (plain python3 has no bpy)."""
    p = os.path.join(BLENDER_DIR, "fighters", f"{fid}.py")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        for line in f:
            if line.startswith("ORIGIN"):
                return line.split("=", 1)[1].split("#")[0].strip().strip("\"'")
    return None


def params(fid: str, skin=None, origin: str | None = None) -> dict | None:
    """The plate parameters for fighter `fid` (and skin dict/id `skin`), or None when the fighter has no entry
    (it keeps the map's backdrop plate)."""
    t = table()
    ent = (t.get("fighters") or {}).get(fid)
    if ent is None:
        return None
    p = dict(DEFAULTS)
    p.update(t.get("defaults") or {})
    org = ent.get("origin") or origin or _origin_of(fid) or "hourless"
    p.update((t.get("origins") or {}).get(org) or {})
    p["origin"] = org
    p.update({k: v for k, v in ent.items() if k != "skins"})
    sid = skin.get("id") if isinstance(skin, dict) else skin
    if sid:
        line = sid[len(fid) + 1:] if sid.startswith(fid + "_") else sid
        p.update((t.get("lines") or {}).get(line) or {})
        p.update((ent.get("skins") or {}).get(sid) or {})
    p["sid"] = sid or fid
    return p


def ids() -> list[str]:
    return sorted((table().get("fighters") or {}).keys())


def sids() -> list[str]:
    """Every fighter and skin id with a plate (skins from art/out/fighters/<id>/skins.json)."""
    out = []
    for fid in ids():
        out.append(fid)
        sk = os.path.join(OUT_DIR, fid, "skins.json")
        if os.path.isfile(sk):
            with open(sk, encoding="utf-8") as f:
                out += [s["id"] for s in json.load(f)]
    return out


def fighter_of(sid: str) -> str:
    for fid in sorted(ids(), key=len, reverse=True):
        if sid == fid or sid.startswith(fid + "_"):
            return fid
    return sid


# ── colour helpers ───────────────────────────────────────────────────────────────────────────────
def _hex(h: str) -> np.ndarray:
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], np.float32)


def _dec(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4).astype(np.float32)


def _enc(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055).astype(np.float32)


def hex_linear(h: str) -> tuple:
    c = _dec(_hex(h))
    return tuple(float(v) for v in c)


# ── the subject's light ──────────────────────────────────────────────────────────────────────────
def art_light(cfg: dict, light: dict, p: dict) -> tuple[dict, dict]:
    """(cfg, light) for the splash / portrait renders of a plated fighter: the map sun scaled and re-coloured to the
    dusk key, the sky fill dimmed and tinted toward the plate, the rim pair re-weighted (the cool dawn rim leads
    for Aubade, the warm lamp rim for Serenade). The inputs are not modified (the face chip keeps the map light)."""
    la = dict(light)
    la["sunIntensity"] = float(light["sunIntensity"]) * float(p["key"])
    if p.get("key_color"):
        la["sunColor"] = p["key_color"]
    la["ambient"] = float(light["ambient"]) * float(p["fill"])
    if p.get("fill_tint"):
        t = np.array(hex_linear(p["fill_tint"]), np.float32)
        t = t / max(1e-6, float(t @ Y709))
        la["tint"] = tuple(float(v) for v in t)
    ca = dict(cfg)
    ca["rim_cool"] = float(cfg.get("rim_cool", 1.0)) * float(p["rim_cool"])
    ca["rim_warm"] = float(cfg.get("rim_warm", 1.0)) * float(p["rim_warm"])
    return ca, la


# ── numpy image helpers (the same maths as imageops, without bpy) ───────────────────────────────
def _box_mean(a: np.ndarray, r: int) -> np.ndarray:
    p = np.pad(a, ((r + 1, r), (r + 1, r)) + ((0, 0),) * (a.ndim - 2), mode="edge").astype(np.float64)
    c = p.cumsum(0).cumsum(1)
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return (s / (k * k)).astype(np.float32)


def kuwahara(rgb: np.ndarray, r: int) -> np.ndarray:
    if r <= 0:
        return rgb
    lum = rgb @ Y709
    H, W = lum.shape
    q = r // 2 + 1
    m = _box_mean(rgb, q)
    m2 = _box_mean(lum[..., None] ** 2, q)[..., 0]
    ml = _box_mean(lum[..., None], q)[..., 0]
    var = m2 - ml * ml
    best = np.full((H, W), np.inf, np.float32)
    out = np.zeros_like(rgb)
    for dy, dx in ((-q, -q), (-q, q), (q, -q), (q, q)):
        ys = np.clip(np.arange(H) + dy, 0, H - 1)
        xs = np.clip(np.arange(W) + dx, 0, W - 1)
        v = var[ys][:, xs]
        mm = m[ys][:, xs]
        sel = v < best
        best = np.where(sel, v, best)
        out = np.where(sel[..., None], mm, out)
    return out


def gaussian(arr: np.ndarray, sigma: float) -> np.ndarray:
    if sigma <= 0:
        return arr
    r = max(1, int(sigma * 3))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-(x * x) / (2 * sigma * sigma))
    k /= k.sum()
    out = arr.astype(np.float32)
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (r, r)
        p = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for i, w in enumerate(k):
            sl = [slice(None)] * out.ndim
            sl[axis] = slice(i, i + out.shape[axis])
            acc += w * p[tuple(sl)]
        out = acc
    return out


def _bilinear(src: np.ndarray, xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    H, W = src.shape[:2]
    xs = np.clip(xs, 0, W - 1)
    ys = np.clip(ys, 0, H - 1)
    x0 = np.floor(xs).astype(int)
    y0 = np.floor(ys).astype(int)
    x1 = np.minimum(x0 + 1, W - 1)
    y1 = np.minimum(y0 + 1, H - 1)
    fx = (xs - x0)[None, :, None]
    fy = (ys - y0)[:, None, None]
    a = src[y0][:, x0] * (1 - fx) + src[y0][:, x1] * fx
    b = src[y1][:, x0] * (1 - fx) + src[y1][:, x1] * fx
    return (a * (1 - fy) + b * fy).astype(np.float32)


def cut(src: np.ndarray, x0: float, y0: float, x1: float, y1: float, w: int, h: int) -> np.ndarray:
    """Resample the window [x0, x1) x [y0, y1) (pixels) of `src` to (h, w); a big reduction is box-filtered first."""
    f = max(1, int((x1 - x0) / w))
    if f > 1:
        H, W = src.shape[:2]
        src = src[:H - H % f, :W - W % f].reshape(H // f, f, W // f, f, src.shape[2]).mean(axis=(1, 3))
        x0, y0, x1, y1 = x0 / f, y0 / f, x1 / f, y1 / f
    xs = x0 + (np.arange(w) + 0.5) * (x1 - x0) / w - 0.5
    ys = y0 + (np.arange(h) + 0.5) * (y1 - y0) / h - 0.5
    return _bilinear(src, xs, ys)


def resize(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    H, W = arr.shape[:2]
    if W % w == 0 and H % h == 0 and W >= w:
        fx, fy = W // w, H // h
        return arr.reshape(h, fy, w, fx, arr.shape[2]).mean(axis=(1, 3))
    return cut(arr, 0, 0, W, H, w, h)


def premul_resize(arr: np.ndarray, w: int, h: int) -> np.ndarray:
    a = arr[..., 3:4]
    pm = np.concatenate([arr[..., :3] * a, a], axis=2)
    r = resize(pm, w, h)
    al = np.maximum(r[..., 3:4], 1e-6)
    return np.concatenate([np.where(r[..., 3:4] > 1e-6, r[..., :3] / al, 0), r[..., 3:4]], axis=2)


def _noise(w: int, h: int, cells: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1)).astype(np.float32)
    ys = np.linspace(0, cells, h, dtype=np.float32)
    xs = np.linspace(0, cells, w, dtype=np.float32)
    y0 = np.minimum(np.floor(ys).astype(int), cells - 1)
    x0 = np.minimum(np.floor(xs).astype(int), cells - 1)
    fy = ys - y0
    fx = xs - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]
    fx = (fx * fx * (3 - 2 * fx))[None, :]
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    b = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return a * (1 - fy) + b * fy


# ── I/O ──────────────────────────────────────────────────────────────────────────────────────────
_GL = None
_LUTC = None
_SRC: dict = {}


def gradelib():
    global _GL
    if _GL is None:
        s = importlib.util.spec_from_file_location("vale_gradelib_plates", os.path.join(ART_DIR, "grade", "gradelib.py"))
        _GL = importlib.util.module_from_spec(s)
        s.loader.exec_module(_GL)
    return _GL


def lut():
    global _LUTC
    if _LUTC is None and os.path.isfile(LUT):
        _LUTC = gradelib().read_cube(LUT)
    return _LUTC


def load_image(path: str) -> np.ndarray:
    """(H, W, C) float32 0..1, rows top-down: Pillow when present (plain python3), else Blender's image loader."""
    try:
        from PIL import Image
        im = Image.open(path)
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        return np.asarray(im).astype(np.float32) / 255.0
    except ImportError:
        from . import imageops
        return imageops.load(path)


def save_png(path: str, rgb: np.ndarray) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        from PIL import Image
        Image.fromarray((np.clip(rgb[..., :3], 0, 1) * 255 + 0.5).astype(np.uint8), "RGB").save(path, optimize=True)
        return path
    except ImportError:
        return gradelib().save_png(path, rgb[..., :3])


def source(name: str) -> np.ndarray:
    if name not in _SRC:
        for ext in (".webp", ".png", ".jpg"):
            p = os.path.join(BACKDROPS, name + ext)
            if os.path.isfile(p):
                _SRC[name] = load_image(p)[..., :3].astype(np.float32)
                break
        else:
            raise FileNotFoundError(f"plates: no art/out/backdrops/{name}.webp")
    return _SRC[name]


# ── the plate ────────────────────────────────────────────────────────────────────────────────────
def _jit(sid: str, salt: str) -> float:
    """A stable -1..1 jitter per image id."""
    return (zlib.crc32(f"{sid}:{salt}".encode()) % 10007) / 10006.0 * 2.0 - 1.0


def window(p: dict, kind: str, W: int, H: int) -> tuple:
    sid = p.get("sid", "x")
    if kind == "splash":
        z = max(1.0, float(p["zoom"]) + 0.5 * (_jit(sid, "z") + 1.0) * float(p["zoom_j"]))
        ww, wh = W / z, H / z
        cx = (float(p["cx"]) + _jit(sid, "x") * float(p["cx_j"])) * W
        cy = float(p["cy"]) * H
    else:
        ww = wh = float(p["p_size"]) * H
        cx = (float(p["p_cx"]) + _jit(sid, "px") * float(p["p_cx_j"])) * W
        cy = float(p["p_cy"]) * H
    x0 = min(max(0.0, cx - ww / 2), W - ww)
    y0 = min(max(0.0, cy - wh / 2), H - wh)
    return x0, y0, x0 + ww, y0 + wh


def plate(p: dict, kind: str, w: int, h: int) -> np.ndarray:
    """The painted dusk plate, (h, w, 4) display sRGB before the LUT (alpha 1)."""
    src = source(p["src"])
    SH, SW = src.shape[:2]
    x0, y0, x1, y1 = window(p, kind, SW, SH)
    k = w / 1600.0 if kind == "splash" else w / 512.0
    rgb = cut(src, x0, y0, x1, y1, w, h)
    rgb = kuwahara(rgb, max(1, int(round(float(p["paint_r"]) * (k if kind == "splash" else 0.7 * k)))))
    rgb = gaussian(rgb, float(p["dof"]) * k if kind == "splash" else float(p["dof_p"]) * k)
    lin = _dec(rgb)
    t = _dec(_hex(p["tint"]))
    t = t / max(1e-6, float(t @ Y709))
    lin = lin * t
    Y = (lin @ Y709)[..., None]
    lin = np.maximum(Y + (lin - Y) * float(p["sat"]), 0.0)
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    xx = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    top = 1.0 - float(p["top"]) * np.clip(1.0 - yy / max(1e-3, float(p["top_to"])), 0, 1) ** 1.6
    flo = 1.0 - float(p["floor"]) * np.clip((yy - float(p["floor_from"])) / max(1e-3, 1 - float(p["floor_from"])), 0, 1) ** 1.3
    if kind != "splash":
        flo = np.ones_like(flo)          # the portrait sees no ground
    dx, dy = (xx - 0.55) / 0.78, (yy - 0.50) / 0.66
    vig = 1.0 - float(p["vignette"]) * np.clip(dx * dx + dy * dy, 0.0, 1.6) ** 1.25
    M = (top * flo * vig)[..., None]
    lin = lin * M
    # expose to the target median (display luma), then the low-sun glow on the origin's side
    med = float(np.median(lin @ Y709))
    lin = lin * (float(_dec(np.float32(p["median"]))) / max(1e-5, med))
    gx, gy, gr, gk = (float(v) for v in p["glow"])
    if kind != "splash":
        gr, gk = gr * 1.5, gk * 0.6
    g = np.exp(-(((xx - gx) / gr) ** 2 + ((yy - gy) / (gr * 0.8)) ** 2))[..., None]
    lin = lin + gk * g * _dec(_hex(p["glow_color"]))
    if kind != "splash":                       # the portrait is all far plate behind a head: its median IS the target
        lin = lin * (float(_dec(np.float32(p["median"]))) / max(1e-5, float(np.median(lin @ Y709))))
    # the shoulder: only small highlights (the lamps) pass the knee toward `cap`
    d = _shoulder(_enc(lin), float(p["knee"]), float(p["cap"]))
    tooth = _noise(w, h, max(8, w // 6), zlib.crc32(p.get("sid", "x").encode()) % 997)
    d = d * (1.0 - float(p["tooth"]) / 2 + float(p["tooth"]) * tooth[..., None])
    return np.concatenate([np.clip(d, 0, 1), np.ones((h, w, 1), np.float32)], axis=2)


def splash_post(fg: np.ndarray, pl: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """render.splash_post (light wrap, bloom of the brightest values, a gentle vignette), in plain numpy."""
    h, w = fg.shape[:2]
    k = w / 1600.0
    a = fg[..., 3:4]
    comp = np.concatenate([fg[..., :3] * a + pl[..., :3] * (1 - a), np.ones_like(a)], axis=2)
    if strength <= 0:
        return comp
    ab = gaussian(fg[..., 3:4].repeat(4, axis=2), 1.6 * k)[..., :1]
    wrap = np.clip(a * (1.0 - ab) * 2.0, 0.0, 1.0)
    pb = gaussian(pl, 4.0 * k)
    comp[..., :3] = comp[..., :3] * (1.0 - 0.14 * strength * wrap) + pb[..., :3] * 0.14 * strength * wrap
    lum = comp[..., :3] @ Y709
    hi = np.clip((lum - 0.82) / 0.18, 0.0, 1.0)[..., None] * comp[..., :3]
    hi4 = np.concatenate([hi, np.ones_like(hi[..., :1])], axis=2)
    bloom = gaussian(hi4, 16.0 * k)[..., :3]
    comp[..., :3] = np.clip(comp[..., :3] + 0.16 * strength * bloom, 0.0, 1.0)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx, dy = (xx / w - 0.62) / 0.75, (yy / h - 0.52) / 0.62
    vig = 1.0 - 0.16 * strength * np.clip(dx * dx + dy * dy, 0.0, 1.6) ** 1.3
    comp[..., :3] *= vig[..., None]
    comp[..., 3] = 1.0
    return comp


def _shoulder(d: np.ndarray, knee: float, cap: float) -> np.ndarray:
    L = d @ Y709
    over = np.maximum(L - knee, 0.0)
    Ls = np.where(L > knee, knee + over / (1.0 + over / max(1e-3, cap - knee)), L)
    return d * (Ls / np.maximum(L, 1e-5))[..., None]


def subject_grade(fg: np.ndarray, p: dict, kind: str = "splash") -> tuple[np.ndarray, float]:
    """The dusk exposure of the subject layer (straight RGBA, display sRGB): one linear scale from its solid
    pixels' luma (the brightest 5 % at most `sub_p95`; a dark kit's median lifted toward `sub_floor`), then the
    highlight shoulder. Returns (graded, scale)."""
    a = fg[..., 3]
    m = a > 0.9
    if int(m.sum()) < 64:
        return fg, 1.0
    lin = _dec(fg[..., :3])
    ys = (lin @ Y709)[m]
    p95 = float(np.percentile(ys, 95))
    med = float(np.median(ys))
    k_hi = float(_dec(np.float32(p["sub_p95"]))) / max(p95, 1e-5)
    k = min(1.0, k_hi)
    flo = float(_dec(np.float32(p["sub_floor"])))
    if med * k < flo:                          # a dark kit: lift toward the floor, the highlights still capped
        k = min(flo / max(med, 1e-5), k_hi)
    k = min(k, float(_dec(np.float32(p["sub_ceil"]))) / max(med, 1e-5))
    k = float(np.clip(k, float(p["sub_min_k"]), float(p["sub_max_k"])))
    lin = np.clip(lin * k, 0.0, 1.0)
    flo2 = float(_dec(np.float32(p["sub_floor_p"] if kind == "portrait" else p["sub_floor"])))
    mk = med * k
    if 1e-4 < mk < flo2:
        g = max(float(p["sub_gamma_min"]), float(np.log(flo2) / np.log(mk)))
        lin = lin ** g
    out = fg.copy()
    out[..., :3] = _shoulder(_enc(lin), float(p["sub_knee"]), float(p["sub_cap"]))
    return out, k


def finish(fg: np.ndarray, p: dict, kind: str, post: float = 1.0) -> np.ndarray:
    """Subject (straight RGBA, display sRGB, at the output size) over its plate, the post (x `post`: the fighter's
    SPLASH "post" switch), the LUT."""
    h, w = fg.shape[:2]
    pl = plate(p, kind, w, h)
    fg, _k = subject_grade(fg.astype(np.float32), p, kind)
    comp = splash_post(fg, pl, post * float(p["post"] if kind == "splash" else p["post_p"]))
    L = lut()
    if L is not None:
        comp[..., :3] = np.clip(gradelib().apply_lut(comp[..., :3], L, "trilinear"), 0, 1).astype(np.float32)
    return comp


# ── the kept subject passes ──────────────────────────────────────────────────────────────────────
def raw_path(sid: str, kind: str, preview: bool = False) -> str:
    return os.path.join(CACHE_DIR, f"{'preview_' if preview else ''}{sid}_{kind}.png")


def keep_raw(src_png: str, sid: str, kind: str, preview: bool = False) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    dst = raw_path(sid, kind, preview)
    shutil.copyfile(src_png, dst)
    return dst


def fg_for(raw: np.ndarray, kind: str, size: int | None = None) -> np.ndarray:
    """The raw pass as the subject layer: the splash is used as rendered; the portrait renders at 1.5x and is
    reduced premultiplied to `size` (512) like render.fighter_renders."""
    if raw.shape[2] == 3:
        raw = np.concatenate([raw, np.ones(raw.shape[:2] + (1,), np.float32)], axis=2)
    if kind == "portrait":
        n = size or int(round(raw.shape[0] / 1.5))
        return premul_resize(raw, n, n)
    return raw


def image_path(sid: str, kind: str, preview: bool = False) -> str:
    fid = fighter_of(sid)
    pre = "" if sid == fid else f"{sid}_"
    if preview:
        return os.path.join(RENDERS_DIR, fid, f"preview_{pre}{kind}.png")
    return os.path.join(OUT_DIR, fid, f"{pre}{kind}.png")


def compose_to(sid: str, kind: str, preview: bool = False) -> str | None:
    rp = raw_path(sid, kind, preview)
    if not os.path.isfile(rp):
        return None
    fid = fighter_of(sid)
    p = params(fid, None if sid == fid else sid)
    raw = load_image(rp)
    size = None
    if kind == "portrait":
        size = 512 if not preview else int(round(raw.shape[0] / 1.5))
    img = finish(fg_for(raw, kind, size), p, kind)
    return save_png(image_path(sid, kind, preview), img)


# ── measure: the crops the client shows ─────────────────────────────────────────────────────────
def stats(rgb: np.ndarray) -> dict:
    L = np.sort(((np.clip(rgb[..., :3], 0, 1) * 255.0) @ Y709).ravel())
    q = lambda f: float(L[int(f * (len(L) - 1))])  # noqa: E731
    return {"p50": round(q(0.5)), "p95": round(q(0.95)), "mean": round(float(L.mean())),
            "over200": round(float((L > 200).mean()) * 100, 1)}


def card_crop(splash: np.ndarray, pos_x: float = 0.86) -> np.ndarray:
    """The loading card: a 3:5 window of the splash at object-position 86 % 50 % (loading.tsx CARD_CROP)."""
    h, w = splash.shape[:2]
    cw = int(round(h * 3 / 5))
    x0 = int(round(pos_x * (w - cw)))
    return splash[:, x0:x0 + cw]


def cell_crop(portrait: np.ndarray, aspect: float = 1.0, pos_y: float = 0.20) -> np.ndarray:
    """The draft cell: the portrait at object-position 50 % 20 % in a cell of `aspect` (w / h)."""
    h, w = portrait.shape[:2]
    if aspect >= 1.0:
        ch = int(round(w / aspect))
        y0 = int(round(pos_y * (h - ch)))
        return portrait[y0:y0 + ch]
    cw = int(round(h * aspect))
    x0 = (w - cw) // 2
    return portrait[:, x0:x0 + cw]


def measure(sel: list[str], preview: bool = False) -> list[dict]:
    rows = []
    for sid in sel:
        sp, pp = image_path(sid, "splash", preview), image_path(sid, "portrait", preview)
        r = {"sid": sid}
        if os.path.isfile(sp):
            s = load_image(sp)[..., :3]
            r["splash"] = stats(s)
            r["card"] = stats(card_crop(s))
        if os.path.isfile(pp):
            r["cell"] = stats(cell_crop(load_image(pp)[..., :3]))
        rows.append(r)
    return rows


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "measure"
    preview = "--preview" in argv
    sel = [a for a in argv[1:] if not a.startswith("--")] or sids()
    if cmd == "compose":
        for sid in sel:
            for kind in ("splash", "portrait"):
                out = compose_to(sid, kind, preview)
                print(f"[plates] {sid} {kind}: {os.path.relpath(out, GAME_DIR) if out else 'no raw pass'}")
        cmd = "measure"
    if cmd == "measure":
        rows = measure(sel, preview)
        bad = 0
        for r in rows:
            line = f"  {r['sid']:<22}"
            for k in ("card", "cell", "splash"):
                if k in r:
                    s = r[k]
                    ok = 70 <= s["p50"] <= 110 and s["over200"] <= 5.0 if k != "splash" else True
                    bad += 0 if ok else 1
                    line += f" {k} p50 {s['p50']:>3} p95 {s['p95']:>3} >200 {s['over200']:>4}%{'' if ok else ' !'}"
            print(line)
        cards = [r["card"]["p50"] for r in rows if "card" in r]
        cells = [r["cell"]["p50"] for r in rows if "cell" in r]
        if cards:
            print(f"[plates] cards {len(cards)}: p50 range {min(cards)}-{max(cards)}; cells {len(cells)}: p50 range "
                  f"{min(cells) if cells else '-'}-{max(cells) if cells else '-'}; outside the gate: {bad}")
        return 1 if bad else 0
    if cmd == "frame":                        # the figure's height in the 3:5 loading card (from the kept raw passes)
        fr = []
        for sid in sel:
            rp = raw_path(sid, "splash", preview)
            if not os.path.isfile(rp):
                continue
            a = card_crop(load_image(rp))[..., 3]
            rows = np.where((a > 0.6).any(axis=1))[0]
            if len(rows):
                f = (rows[-1] - rows[0] + 1) / a.shape[0] * 0.84      # the plate covers the card's lower 84 %
                fr.append((sid, round(float(f), 3)))
        v = sorted(x[1] for x in fr)
        for sid, f in fr:
            print(f"  {sid:<22} figure {f:.3f} of the card height{'' if 0.70 <= f <= 0.80 else ' (outside 0.70-0.80)'}")
        if v:
            print(f"[plates] {len(v)} splashes: figure p50 {v[len(v) // 2]:.3f}, range {v[0]:.3f}-{v[-1]:.3f}, "
                  f"in 0.70-0.80: {sum(0.70 <= x <= 0.80 for x in v)}")
        return 0
    if cmd == "plates":                       # the bare plates of every origin and line (look-dev sheet)
        t = table()
        names = sorted(set([v["src"] for v in (t.get("origins") or {}).values()]))
        out = []
        for org in (t.get("origins") or {}):
            p = params(ids()[0], origin=org)
            p.update((t.get("origins") or {})[org])
            for kind, (w, h) in (("splash", (800, 450)), ("portrait", (256, 256))):
                im = plate(dict(p, sid=f"look_{org}"), kind, w, h)
                out.append((org, kind, stats(im[..., :3])))
                save_png(os.path.join(CACHE_DIR, f"look_{org}_{kind}.png"), im)
        for r in out:
            print(r)
        print("sources:", names)
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
