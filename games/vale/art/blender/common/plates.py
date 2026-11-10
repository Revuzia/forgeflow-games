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

Card finish v2 (finish2, the default since the closing round 2 card pipeline): no filter on the figure alone. The clean 2x
render is graded to the plate, takes the plate's light (art_light: rim side and colour from its glow; shared_figure_light:
ambient tint, colour match, atmosphere), stands on a contact and cast shadow (ground_shadow, in place of the catcher's
frame-wide band), and one soft-Kuwahara paint-over and canvas tooth go over the finished composite, eased on face and hands.

The raw subject passes (straight RGBA, display sRGB, before the post) are kept in art/.cache/fighters/plates/, so
the plates are re-graded without Blender:
    python3 art/blender/common/plates.py compose [sids] [--preview] [--kind splash|portrait]
    python3 art/blender/common/plates.py measure [sids] [--preview] [--box 0.84]
    python3 art/blender/common/plates.py frame [sids] [--box 0.84]
`measure` reads the shipped (or preview) images and reports the two crops the client shows: the 3:5 loading card
(object-position 86 % 50 % of the splash) and the draft cell (the portrait at 50 % 20 %), p50 / p95 / share > 200
by Rec. 709 luma (the same measure as _harness/_reports/final_menus_scripts/luma.cjs). Gate: p50 70-110, at most
a small share above 200. `frame` reports the figure's height (subject alpha > 0.6, head to feet) in the loading card
and where its top sits in the plate (gate: 0.70-0.80 of the card). `--box h`: the card shows the plate in its lower
h (W2's screens.css .pcard__art, 0.84), so the window is 0.6 / h wide instead of 3:5.
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
    "splash_lift": 0.0,         # ... plus this for the splash only (a darker painting under a larger figure: the card
                                #     crop keeps its p50 >= 70 without lifting the portrait cells)
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
    # the subject's highlights (closing review: no card went over luma ~200, the visor, glass and lit edges never
    # caught a highlight): above its p95 the subject's luma expands smoothly so its `sub_hi_q` percentile reaches
    # `sub_hi` (display, before the LUT, which is near identity there: 0.92 -> luma ~232); None = the old shoulder
    # (`sub_knee` -> `sub_cap`)
    "sub_hi": 0.93, "sub_hi_q": 99.7,
    # the paint-over: the plate's brush (Kuwahara) over the subject at this radius (px at 1600 / 512), so the figure
    # and the painting share one finish (0 = off)
    "sub_paint_r": 1,
    "sub_median": 0,            # 3x3 median passes over the subject before the paint-over (median3; per card)
    # a kit still under its floor after the scale (a face in a hat brim's shadow) gets a toe lift: a gamma that
    # takes its median to the floor (`sub_floor_p` for the portrait: a draft cell is a face) and keeps white white
    "sub_floor_p": 0.30, "sub_gamma_min": 0.62,
    "sub_ceil": 0.39,           # ... and a pale kit's median at most this (the cell stays a mid value)
    # the post (render.splash_post's light wrap / bloom / vignette strengths)
    "post": 1.0, "post_p": 0.6,
    # the splash under the loading card (W2's screens.css .pcard): the card fades the plate's top into its ink and
    # lays an ink scrim over the foot, so the splash may bake less of either (None: `top` / `floor`)
    "top_s": None, "floor_s": None,
    # ... and the card floor (splash only; off while `card_lo_q` is None): the rows of the card window the card
    # shows (`card_rows` of the plate: below its top fade, down into the light upper part of its meta scrim; the
    # window 0.6 / `card_box` wide at `card_pos` across, as loading.tsx CARD_CROP) must hold a mid value, so the
    # composite's darks are toe-lifted until the window's `card_lo_q` quantile reaches `card_lo` (display luma). The
    # toe fades out at `toe_pv`, half its lift keeps the colour's ratio (`toe_chroma`) and half is neutral (no chroma
    # blow-up in dark cloth), and it eases to `toe_left` of its strength toward the left edge (the scenery away from
    # the figure keeps its depth)
    "card_lo_q": None, "card_lo": 0.31, "card_rows": [0.06, 0.80], "card_box": 0.84, "card_pos": 0.86,
    "toe_pv": 0.55, "toe_chroma": 0.5, "toe_left": 0.45,
    # ... and the toe's black anchor (integration pass, chars-12: the toe lifted every splash's black point, p1 +28,
    # a grey veil over the full splash): below `toe_foot` (display luma) the lift eases down to `toe_black` of itself
    # at black, so the card window's mid-darks still reach `card_lo` while the deepest shadows stay deep. The
    # defaults (1.0 / 0.0) are the old toe.
    "toe_black": 1.0, "toe_foot": 0.0,
    # ── the card finish v2 (closing round 2, every fighter's shared card major): one painted illustration instead of a
    # filtered render pasted on a plate. finish() below; finish 1 = the old chain (subject Kuwahara, then over the plate).
    "finish": 2,
    "paint_mix": 0.32,          # the unified paint-over: this much soft Kuwahara over the whole composite, figure AND plate
    "paint_mix_face": 0.08,     # ... eased to this over the face and hands (render meta points), so they stay clean
    "paint_mix_plate": 0.45,    # ... times this over the plate (the plate is already brushed once in plate())
    "paint_r2": 3,              # its radius (px at 1600; the portrait at 512 uses 0.7 of it)
    "paint_q": 4.0,             # sector sharpness (higher = crisper strokes)
    "amb_tint": 0.45,           # shadow side of the figure multiplied toward the plate's mean colour (0 = off)
    "match": 0.3,               # the figure's mean colour moved this far (ratio) toward the plate round it
    "sun_tint": 0.16,           # a colour gradient across the figure from the plate's sun side, in the glow colour
    "haze": 0.05,               # atmospheric depth: this much of the blurred plate over the figure (x 2 at the feet)
    "wrap": 0.32, "wrap_px": 4.0, "wrap_off": 0.25,  # light wrap of the plate over the figure's edge, full on the sun side
    "sun_edge": 0.38,           # an extra glow-coloured edge on the sun side
    "contact": 1.0, "cast": 0.5, "shadow_real": 0.7, "shadow_len": 0.18,  # grounding: see ground_shadow()
    "shadow_tint": 0.24,        # shadow colour: the plate's own, this bright
    "shared_light": True,       # the render's rim pair comes from the plate's sun side and colour (art_light)
    "fx": [],                   # optional soft glows at a bone: {"at": bone, "color": hex, "r": fraction of the height, "k": strength}
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


_CARDS: dict = {}


def cards_of(fid: str) -> dict:
    """The fighter module's CARDS table (the per-skin card staging, art/blender/portraits.py header), read with ast
    from art/blender/fighters/<fid>.py without importing it (plain python3 has no bpy): it must be a literal."""
    if fid in _CARDS:
        return _CARDS[fid]
    import ast
    out = {}
    p = os.path.join(BLENDER_DIR, "fighters", f"{fid}.py")
    if os.path.isfile(p):
        with open(p, encoding="utf-8") as f:
            tree = ast.parse(f.read(), p)
        for node in tree.body:
            if isinstance(node, (ast.Assign, ast.AnnAssign)):
                tg = node.targets[0] if isinstance(node, ast.Assign) else node.target
                if isinstance(tg, ast.Name) and tg.id == "CARDS" and node.value is not None:
                    out = ast.literal_eval(node.value)
    _CARDS[fid] = out
    return out


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
    p.update((cards_of(fid).get(sid or fid) or {}).get("plate") or {})     # the staged card's own plate
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
    if int(p.get("finish", 1)) >= 2 and p.get("shared_light", True):
        # the plate decides the light: the lead rim on its low-sun side in its glow colour, the off rim dim in the plate's
        # sky colour, and the world fill tinted with the plate's own mean colour (a staged rim_cool / rim_warm no longer
        # picks the side; a staged "fill_tint" still wins through plates.json / the card's "plate")
        pl = plate_light(p)
        lead, off = pl["lead"], pl["off"]
        k = max(float(cfg.get("rim_cool", 1.0)), float(cfg.get("rim_warm", 1.0)), 1.0)
        ca["rim_left_color"], ca["rim_right_color"] = (lead, off) if pl["side"] <= 0 else (off, lead)
        ca["rim_cool"], ca["rim_warm"] = (1.5 * k, 0.4) if pl["side"] < 0 else ((0.4, 1.5 * k) if pl["side"] > 0 else (k, k))
        if not p.get("fill_tint"):
            la["tint"] = pl["ambient"]
    return ca, la


_PL_CACHE: dict = {}


def plate_light(p: dict) -> dict:
    """The plate's light, sampled (finish v2): side (-1 screen left, 1 right, 0 behind: its low sun), lead (linear rgb:
    the glow colour), ambient (the plate's mean colour, normalised to luma 1) and off (the mean colour, a sky rim)."""
    key = (p.get("src"), p.get("sid"), str(p.get("glow")), str(p.get("tint")), p.get("glow_color"))
    if key in _PL_CACHE:
        return _PL_CACHE[key]
    small = plate(p, "splash", 96, 54, tooth_on=False)[..., :3]
    lin = _dec(small)
    mean = lin.reshape(-1, 3).mean(axis=0)
    amb = mean / max(1e-5, float(mean @ Y709))
    amb = np.clip(amb, 0.3, 2.0)
    gx = float(p["glow"][0])
    side = -1 if gx < 0.42 else (1 if gx > 0.58 else 0)
    r = {"side": side, "lead": hex_linear(p["glow_color"]), "ambient": tuple(float(v) for v in amb),
         "off": tuple(float(v) for v in np.clip(amb * 0.9, 0.0, 1.5)), "mean_display": _enc(mean).tolist()}
    _PL_CACHE[key] = r
    return r


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


def plate(p: dict, kind: str, w: int, h: int, tooth_on: bool = True) -> np.ndarray:
    """The painted dusk plate, (h, w, 4) display sRGB before the LUT (alpha 1). tooth_on False: no canvas tooth (the
    finish v2 lays it over the whole composite)."""
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
    tk = p["top"] if kind != "splash" or p.get("top_s") is None else p["top_s"]
    fk = p["floor"] if kind != "splash" or p.get("floor_s") is None else p["floor_s"]
    top = 1.0 - float(tk) * np.clip(1.0 - yy / max(1e-3, float(p["top_to"])), 0, 1) ** 1.6
    flo = 1.0 - float(fk) * np.clip((yy - float(p["floor_from"])) / max(1e-3, 1 - float(p["floor_from"])), 0, 1) ** 1.3
    if kind != "splash":
        flo = np.ones_like(flo)          # the portrait sees no ground
    dx, dy = (xx - 0.55) / 0.78, (yy - 0.50) / 0.66
    vig = 1.0 - float(p["vignette"]) * np.clip(dx * dx + dy * dy, 0.0, 1.6) ** 1.25
    M = (top * flo * vig)[..., None]
    lin = lin * M
    # expose to the target median (display luma), then the low-sun glow on the origin's side
    med = float(np.median(lin @ Y709))
    target = float(p["median"]) + (float(p.get("splash_lift", 0.0)) if kind == "splash" else 0.0)
    lin = lin * (float(_dec(np.float32(target))) / max(1e-5, med))
    gx, gy, gr, gk = (float(v) for v in p["glow"])
    if kind != "splash":
        gr, gk = gr * 1.5, gk * 0.6
    g = np.exp(-(((xx - gx) / gr) ** 2 + ((yy - gy) / (gr * 0.8)) ** 2))[..., None]
    lin = lin + gk * g * _dec(_hex(p["glow_color"]))
    if kind != "splash":                       # the portrait is all far plate behind a head: its median IS the target
        lin = lin * (float(_dec(np.float32(p["median"]))) / max(1e-5, float(np.median(lin @ Y709))))
    # the shoulder: only small highlights (the lamps) pass the knee toward `cap`
    d = _shoulder(_enc(lin), float(p["knee"]), float(p["cap"]))
    if tooth_on:
        d = canvas_tooth(d, p)
    return np.concatenate([np.clip(d, 0, 1), np.ones((h, w, 1), np.float32)], axis=2)


def canvas_tooth(d: np.ndarray, p: dict) -> np.ndarray:
    h, w = d.shape[:2]
    tooth = _noise(w, h, max(8, w // 6), zlib.crc32(p.get("sid", "x").encode()) % 997)
    return d * (1.0 - float(p["tooth"]) / 2 + float(p["tooth"]) * tooth[..., None])


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
    if p.get("sub_hi") is None:
        out[..., :3] = _shoulder(_enc(lin), float(p["sub_knee"]), float(p["sub_cap"]))
    else:
        out[..., :3] = _expand_hi(_enc(lin), m, float(p["sub_hi"]), float(p.get("sub_hi_q", 99.7)))
    return out, k


def _expand_hi(d: np.ndarray, m: np.ndarray, hi: float, q: float) -> np.ndarray:
    """Display rgb d: above the solid subject's p95 luma x0 the luma follows y = x0 + (hi - x0) s(u),
    u = (L - x0) / (top - x0) (top: its q percentile), s(u) = a u + (1 - a) u^2 with a = (top - x0) / (hi - x0) (the
    slope stays 1 at x0, the curve is monotone and reaches `hi` at `top`; past it, the slope at u = 1 continues up to
    luma 0.985). The colour keeps its ratio (luma scaling). A subject with no headroom over its p95 is unchanged."""
    L = d @ Y709
    ys = L[m]
    x0 = float(np.percentile(ys, 95))
    top = float(np.percentile(ys, q))
    for qk in (80.0, 65.0, 50.0):
        # (CW5, Ardit First Bell: a large flat pale surface, the pavise's pane square to the sun, filled the top 5 %
        # (the portrait: the top third) at one value, so the curve had no headroom and the card stopped at luma ~199)
        # knee lower until there is some
        if top > x0 + 0.01:
            break
        x0 = float(np.percentile(ys, qk))
    if top <= x0 + 0.01 or hi <= x0 + 0.01:
        return d
    a = float(np.clip((top - x0) / (hi - x0), 0.0, 1.0))
    u = np.maximum(L - x0, 0.0) / (top - x0)
    s1 = a * u + (1 - a) * u * u
    s2 = 1.0 + (2.0 - a) * (u - 1.0)
    Ln = np.where(L > x0, x0 + (hi - x0) * np.where(u <= 1.0, s1, s2), L)
    Ln = np.minimum(Ln, np.maximum(L, 0.985))
    return np.clip(d * (Ln / np.maximum(L, 1e-5))[..., None], 0.0, 1.0)


def paint_over(fg: np.ndarray, r: int) -> np.ndarray:
    """The plate's brush over the subject (straight RGBA): Kuwahara on the premultiplied colour of the solid pixels
    (the antialiased edge keeps its own colour and alpha, so no plate colour bleeds in); r 0 = unchanged."""
    if r <= 0:
        return fg
    a = fg[..., 3:4]
    solid = a[..., 0] > 0.98
    pm = kuwahara(fg[..., :3] * a, r)
    out = fg.copy()
    out[..., :3] = np.where(solid[..., None], np.clip(pm / np.maximum(a, 1e-4), 0.0, 1.0), fg[..., :3])
    return out


def median3(fg: np.ndarray, passes: int) -> np.ndarray:
    """pixel-scale clean-up of the subject (straight RGBA) before the paint-over: a 3x3 median of the solid pixels'
    colour, `passes` times (a fine-textured pale kit, Ervet's chalk plate and lames, kept a single-pixel texture
    speckle the Kuwahara cannot reach: card_qa speckle 3.4 > 2.5). Strokes wider than ~2 px and the edges survive;
    the antialiased rim keeps its own colour and alpha. 0 = unchanged (no scipy: Blender's python runs this too)."""
    if passes <= 0:
        return fg
    solid = fg[..., 3] > 0.98
    out = fg.copy()
    rgb = fg[..., :3]
    for _ in range(passes):
        p_ = np.pad(rgb, ((1, 1), (1, 1), (0, 0)), mode="edge")
        h, w = rgb.shape[:2]
        st = np.stack([p_[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3)], 0)
        rgb = np.where(solid[..., None], np.median(st, axis=0), rgb).astype(np.float32)
    out[..., :3] = rgb
    return out


def finish(fg: np.ndarray, p: dict, kind: str, post: float = 1.0, meta: dict | None = None) -> np.ndarray:
    """Subject (straight RGBA, display sRGB, at the output size) over its plate, the post (x `post`: the fighter's
    SPLASH "post" switch), the LUT. finish 2 (default): figure and plate become one picture (see finish2)."""
    if int(p.get("finish", 1)) >= 2:
        return finish2(fg, p, kind, post, meta)
    h, w = fg.shape[:2]
    pl = plate(p, kind, w, h)
    fg = median3(fg.astype(np.float32), int(p.get("sub_median", 0)))
    fg = paint_over(fg.astype(np.float32),
                    int(round(float(p.get("sub_paint_r", 0)) * (w / 1600.0 if kind == "splash" else w / 512.0))))
    fg, _k = subject_grade(fg, p, kind)
    comp = splash_post(fg, pl, post * float(p["post"] if kind == "splash" else p["post_p"]))
    L = lut()
    if L is not None:
        comp[..., :3] = np.clip(gradelib().apply_lut(comp[..., :3], L, "trilinear"), 0, 1).astype(np.float32)
    if kind == "splash" and p.get("card_lo_q") is not None:
        comp, _s = card_floor(comp, p)
    return comp


# ── finish v2: one painted picture ───────────────────────────────────────────────────────────────
def split_shadow(fg: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The raw pass's film alpha holds the figure AND the shadow catcher (Cycles writes the catcher black, rgb 0). Returns
    (figure RGBA with the figure's own alpha, shadow alpha h x w): the shadow is laid on the plate by ground_shadow, so
    the catcher's frame-wide band never reaches the card."""
    a = fg[..., 3]
    m = fg[..., :3].max(axis=2)
    t = np.clip((m - 0.012) / 0.05, 0.0, 1.0)
    t = t * t * (3 - 2 * t)
    af = a * t
    out = fg.copy()
    out[..., 3] = af
    return out, np.clip(a - af, 0.0, 1.0).astype(np.float32)


_FFTK: dict = {}


def soft_kuwahara(rgb: np.ndarray, radius: float, q: float = 6.0, sectors: int = 8) -> np.ndarray:
    """The generalized (smooth-sector) Kuwahara: `sectors` overlapping gaussian-windowed sectors around each pixel, their
    means weighted by inverse variance^(q/2). The box Kuwahara's hard 4-quadrant switch is what stair-steps faces; here
    every weight is continuous, so strokes form without block edges. numpy FFT only (Blender's python runs this too)."""
    h, w = rgb.shape[:2]
    r = max(2, int(round(radius)))
    key = (h, w, r, sectors)
    if key not in _FFTK:
        yy, xx = np.mgrid[-r:r + 1, -r:r + 1].astype(np.float64)
        d2 = xx * xx + yy * yy
        ang = np.arctan2(yy, xx)
        g = np.exp(-d2 / (2 * (0.55 * r) ** 2)) * (d2 <= (r + 0.5) ** 2)
        ks = []
        for i in range(sectors):
            th = 2 * np.pi * i / sectors
            ca = np.cos(ang - th)
            win = np.clip((ca - np.cos(np.pi / sectors) * 0.35) / (1 - np.cos(np.pi / sectors) * 0.35), 0.0, 1.0) ** 2
            win[r, r] = 1.0                                  # the centre pixel belongs to every sector
            kk = g * win
            kk = kk / kk.sum()
            pad = np.zeros((h, w), np.float64)
            pad[:kk.shape[0], :kk.shape[1]] = kk
            pad = np.roll(np.roll(pad, -r, axis=0), -r, axis=1)
            ks.append(np.fft.rfft2(pad))
        _FFTK[key] = ks
    F = lambda a: np.fft.rfft2(a)  # noqa: E731
    I = lambda a: np.fft.irfft2(a, s=(h, w))  # noqa: E731
    src = rgb.astype(np.float64)
    L = src @ Y709.astype(np.float64)
    fc = [F(src[..., c]) for c in range(3)]
    fl, fl2 = F(L), F(L * L)
    acc = np.zeros((h, w, 3), np.float64)
    tot = np.zeros((h, w), np.float64)
    for Kf in _FFTK[key]:
        ml = I(fl * Kf)
        v = np.maximum(I(fl2 * Kf) - ml * ml, 1e-9)
        wt = v ** (-q / 2.0)
        tot += wt
        for c in range(3):
            acc[..., c] += wt * I(fc[c] * Kf)
    return np.clip(acc / tot[..., None], 0.0, 1.0).astype(np.float32)


def _pt(meta: dict | None, name: str):
    pts = (meta or {}).get("pts") or {}
    v = pts.get(name)
    return (float(v[0]), float(v[1])) if v else None


def _figure_box(af: np.ndarray):
    rows = np.where((af > 0.8).any(axis=1))[0]
    cols = np.where((af > 0.8).any(axis=0))[0]
    if len(rows) == 0:
        return None
    return int(rows[0]), int(rows[-1]), int(cols[0]), int(cols[-1])


def face_point(meta: dict | None, p: dict, kind: str):
    """The face centre (fractions of the image): the head bone's point plus the card's "face_off" {kind: [dx, dy]} (a head
    built larger than its bone, Sukri's, has its face well below the bone's middle). None without render notes."""
    he = _pt(meta, "head")
    if he is None:
        return None
    off = (p.get("face_off") or {}).get(kind) or (0.0, 0.0)
    return he[0] + float(off[0]), he[1] + float(off[1])


def face_mask(af: np.ndarray, meta: dict | None, kind: str, p: dict | None = None) -> np.ndarray:
    """1 over the face and hands (smooth ellipses from the render's bone points; without meta: the top of the figure)."""
    h, w = af.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    box = _figure_box(af)
    m = np.zeros((h, w), np.float32)
    if box is None:
        return m
    y0, y1, _c0, _c1 = box
    fh = max(8.0, float(y1 - y0))
    he = face_point(meta, p or {}, kind)
    ne = _pt(meta, "neck")
    if he is not None:
        cx, cy = he[0] * w, he[1] * h
        rr = max(0.05 * fh, abs(he[1] - (ne[1] if ne else he[1] + 0.05)) * h * 1.25) if kind == "splash" else 0.34 * h
    else:
        cx, cy = 0.5 * w if kind == "portrait" else float(xx[af > 0.8].mean()), y0 + 0.11 * fh
        rr = 0.12 * fh if kind == "splash" else 0.34 * h
    pts = [(cx, cy, rr)]
    for n in ("hand.L", "hand.R"):
        pp = _pt(meta, n)
        if pp is not None:
            pts.append((pp[0] * w, pp[1] * h, rr * 0.55))
    for (px, py, r) in pts:
        d2 = ((xx - px) ** 2 + (yy - py) ** 2) / (r * r)
        m = np.maximum(m, np.clip(1.25 - d2 * 1.25, 0.0, 1.0))
    return m * np.clip(af, 0.0, 1.0)


def _gauss1(arr: np.ndarray, sigma: float, axis: int) -> np.ndarray:
    """A 1D gaussian along `axis`."""
    r = max(1, int(sigma * 3))
    x = np.arange(-r, r + 1, dtype=np.float32)
    k = np.exp(-(x * x) / (2 * sigma * sigma))
    k /= k.sum()
    pad = [(0, 0)] * arr.ndim
    pad[axis] = (r, r)
    p = np.pad(arr, pad, mode="edge")
    acc = np.zeros_like(arr)
    for i, w in enumerate(k):
        sl = [slice(None)] * arr.ndim
        sl[axis] = slice(i, i + arr.shape[axis])
        acc += w * p[tuple(sl)]
    return acc


def ground_shadow(pl: np.ndarray, af: np.ndarray, shadow: np.ndarray, p: dict, meta: dict | None) -> np.ndarray:
    """The plate darkened where the figure stands (finish v2, splash): a CONTACT shadow (the feet's own mask, blurred
    flat) so no foot floats, the renderer's real catcher shadow eased out with distance from the feet (no frame-wide
    band), and a soft CAST shadow: the figure's mask laid flat on the ground plane, away from the plate's sun."""
    h, w = af.shape
    k = w / 1600.0
    box = _figure_box(af)
    if box is None:
        return pl
    y0, y1, c0, c1 = box
    fh = max(8.0, float(y1 - y0))
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # the feet: the mask's lowest 4 % of the figure; their centre
    feet = af * ((yy >= y1 - 0.04 * fh) * 1.0).astype(np.float32)
    if float(feet.sum()) < 4:
        return pl
    fx = float((feet * xx).sum() / feet.sum())
    # contact: the line under the soles (each foot column's lowest pixel), spread into flat ellipses on the ground, so it
    # shows round the feet instead of hiding behind them
    sole = np.zeros((h, w, 1), np.float32)
    band = max(2, int(round(3.0 * k)))
    for col in np.where(feet.max(axis=0) > 0.5)[0]:
        ys = np.where(af[:, col] > 0.5)[0]
        if len(ys):
            sole[ys[-1]:min(h, ys[-1] + band), col] = 1.0
    c = np.roll(_gauss1(_gauss1(sole, 9.0 * k, 1), 3.0 * k, 0)[..., 0], max(1, int(round(3.0 * k))), axis=0)  # a crisp core just under the sole
    c2 = _gauss1(_gauss1(sole, 42.0 * k, 1), 11.0 * k, 0)[..., 0]
    c, c2 = c / max(1e-4, float(c.max())), c2 / max(1e-4, float(c2.max()))
    contact = np.clip(1.0 * c + 0.5 * c2, 0.0, 1.0) * float(p.get("contact", 1.0))
    # the real catcher shadow, kept close to the figure
    dx = (xx - fx) / (0.55 * fh)
    dy = (yy - y1) / (0.20 * fh)
    fall = np.clip(1.0 - (dx * dx + dy * dy), 0.0, 1.0) ** 1.5
    real = gaussian((shadow * fall)[..., None], 3.0 * k)[..., 0] * float(p.get("shadow_real", 0.45))
    # cast: for a ground row y below the feet, the figure's row y0 + (y - y1) / squash, sheared away from the sun
    side = plate_light(p)["side"]
    gdir = 1.0 if side <= 0 else -1.0
    squash = float(p.get("shadow_len", 0.18))
    t = np.clip((yy - y1) / max(1.0, squash * fh), 0.0, 1.0)
    src_y = y1 - (yy - y1) / max(1e-3, squash)
    src_x = xx - gdir * (yy - y1) * 0.9
    mask = (src_y >= 0) & (yy > y1 - 2)
    H, W = af.shape
    sx = np.clip(src_x, 0, W - 1)
    sy = np.clip(src_y, 0, H - 1)
    x0 = np.floor(sx).astype(int); y0i = np.floor(sy).astype(int)
    x1 = np.minimum(x0 + 1, W - 1); y1i = np.minimum(y0i + 1, H - 1)
    fxx = sx - x0; fyy = sy - y0i
    cast = (af[y0i, x0] * (1 - fxx) * (1 - fyy) + af[y0i, x1] * fxx * (1 - fyy) +
            af[y1i, x0] * (1 - fxx) * fyy + af[y1i, x1] * fxx * fyy) * mask
    cast = gaussian(cast[..., None], 5.0 * k)[..., 0]
    cast = cast * (1.0 - t * 0.85) * float(p.get("cast", 0.34))
    s = np.clip(1.0 - (1.0 - contact) * (1.0 - real) * (1.0 - cast), 0.0, 0.92)
    # the shadow keeps the plate's own colour (a darker, cooler plate), never a black stamp
    tint = np.array(plate_light(p)["ambient"], np.float32)
    tint = tint / max(1e-5, float(tint.max())) * float(p.get("shadow_tint", 0.32))
    lin = _dec(pl[..., :3])
    lin = lin * (1.0 - s[..., None] * (1.0 - tint))
    out = pl.copy()
    out[..., :3] = _enc(lin)
    return out


def shared_figure_light(fg: np.ndarray, pl: np.ndarray, p: dict, kind: str) -> np.ndarray:
    """The figure takes the plate's light (linear): the shadow side multiplied toward the plate's mean colour, a colour
    gradient from the sun side in the glow colour, a touch of the plate's blurred colour as atmosphere (more at the feet)."""
    af = fg[..., 3]
    if float(af.max()) <= 0:
        return fg
    h, w = af.shape
    lin = _dec(fg[..., :3])
    L = (lin @ Y709)[..., None]
    pl_info = plate_light(p)
    amb = np.array(pl_info["ambient"], np.float32)
    amb = amb / max(1e-5, float(amb @ Y709))
    shade = np.clip(1.0 - _enc(L) * 1.5, 0.0, 1.0) ** 1.4
    lin = lin * (1.0 + (amb - 1.0) * float(p.get("amb_tint", 0.45)) * shade)
    # a colour match: the figure's mean colour moves `match` of the way (in ratio) toward the plate round it, so a warm
    # figure sits in a cool plate; the figure keeps its own hues and values
    beta = float(p.get("match", 0.3))
    solid = af > 0.9
    ring = (gaussian(af[..., None], 24.0 * (w / 1600.0))[..., 0] > 0.05) & (af < 0.02)
    if beta > 0 and solid.any() and ring.any():
        fm, pm = lin[solid].mean(axis=0), _dec(pl[..., :3])[ring].mean(axis=0)
        fm, pm = fm / max(1e-5, float(fm @ Y709)), pm / max(1e-5, float(pm @ Y709))
        lin = lin * np.clip(pm / np.maximum(fm, 1e-5), 0.6, 1.6).astype(np.float32) ** beta
    # sun-side colour gradient across the figure
    box = _figure_box(af)
    if box is not None and pl_info["side"] != 0:
        _y0, _y1, c0, c1 = box
        xx = np.linspace(0, w - 1, w, dtype=np.float32)[None, :]
        gg = np.clip((xx - c0) / max(1.0, float(c1 - c0)), 0.0, 1.0)
        toward = (1.0 - gg) if pl_info["side"] < 0 else gg
        lead = np.array(pl_info["lead"], np.float32)
        lead = lead / max(1e-5, float(lead @ Y709))
        lin = lin * (1.0 + (lead - 1.0) * float(p.get("sun_tint", 0.16)) * toward[..., None])
    # atmosphere
    pb = gaussian(pl, 18.0 * (w / 1600.0))[..., :3]
    yy = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    haze = float(p.get("haze", 0.05)) * (1.0 + 1.0 * np.clip((yy - 0.55) / 0.45, 0.0, 1.0) if kind == "splash" else 1.0)
    d = _enc(np.clip(lin, 0.0, 1.0))
    d = d + (pb - d) * (np.broadcast_to(haze, (h, 1)).reshape(h, 1, 1) if np.ndim(haze) else haze)
    out = fg.copy()
    out[..., :3] = np.clip(d, 0.0, 1.0)
    return out


def integrate2(fg: np.ndarray, pl: np.ndarray, p: dict, kind: str, strength: float = 1.0) -> np.ndarray:
    """The composite with a directional light wrap: the plate's blurred colour bleeds over the figure's edge, full on the
    sun side and `wrap_off` of it on the far side, a glow-coloured sun edge, bloom and a gentle vignette."""
    h, w = fg.shape[:2]
    k = w / 1600.0 if kind == "splash" else w / 512.0 * 0.7
    a = fg[..., 3:4]
    comp = np.concatenate([fg[..., :3] * a + pl[..., :3] * (1 - a), np.ones_like(a)], axis=2)
    if strength <= 0:
        return comp
    ab = gaussian(fg[..., 3:4], float(p.get("wrap_px", 4.0)) * k)
    band = np.clip(a * (1.0 - ab) * 2.4, 0.0, 1.0)
    pb = gaussian(pl, 14.0 * k)[..., :3]
    gy, gx = np.gradient(ab[..., 0])
    nl = np.sqrt(gx * gx + gy * gy) + 1e-5
    pli = plate_light(p)
    sx = -1.0 if pli["side"] < 0 else (1.0 if pli["side"] > 0 else 0.0)
    if sx != 0.0:
        lit = np.clip(-gx / nl * sx * 0.75 + 0.05 + 0.2 * np.clip(-gy / nl, 0.0, 1.0), 0.0, 1.0)
    else:
        lit = np.clip(0.12 + 0.6 * np.clip(-gy / nl, 0.0, 1.0), 0.0, 1.0)   # a sun behind: the top edges only, no pale ring
    off = float(p.get("wrap_off", 0.25))
    side_w = (off + (1.0 - off) * lit)[..., None]
    wr = np.clip(float(p.get("wrap", 0.32)) * strength * band * side_w, 0.0, 1.0)
    comp[..., :3] = comp[..., :3] * (1.0 - wr) + pb * wr
    # the sun edge: a thin glow-coloured line on the lit side
    lead = _enc(np.array(pli["lead"], np.float32))
    ab2 = gaussian(fg[..., 3:4], 2.0 * k)
    thin = np.clip(a * (1.0 - ab2) * 3.0, 0.0, 1.0) * lit[..., None]
    comp[..., :3] = comp[..., :3] + (1.0 - comp[..., :3]) * thin * float(p.get("sun_edge", 0.38)) * strength * lead
    # bloom and vignette (the old post, unchanged)
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


def fx_layer(comp: np.ndarray, p: dict, meta: dict | None) -> np.ndarray:
    """Soft additive glows at bones from the fighter's own colours (CARDS "plate": {"fx": [...]}; screen blend)."""
    fx = p.get("fx") or []
    if not fx or not meta:
        return comp
    h, w = comp.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    out = comp.copy()
    for f in fx:
        pt = _pt(meta, f.get("at", ""))
        if pt is None:
            continue
        r = float(f.get("r", 0.08)) * h
        g = np.exp(-((xx - pt[0] * w) ** 2 + (yy - pt[1] * h) ** 2) / (2 * r * r))
        col = _hex(f.get("color", "#FFFFFF"))
        out[..., :3] = 1.0 - (1.0 - out[..., :3]) * (1.0 - float(f.get("k", 0.3)) * g[..., None] * col)
    return out


def finish2(fg: np.ndarray, p: dict, kind: str, post: float = 1.0, meta: dict | None = None) -> np.ndarray:
    """The card finish v2. No filter on the figure alone: the render stays clean and antialiased; it is graded to the
    plate's dusk (the same exposure logic as v1), takes the plate's light, stands on a contact and cast shadow, and the
    one gentle paint-over (soft Kuwahara) and canvas tooth are laid on the finished composite, figure and plate
    together, so they share a surface; face and hands keep only a trace of it."""
    h, w = fg.shape[:2]
    fg = fg.astype(np.float32)
    fig, shadow = split_shadow(fg) if kind == "splash" else (fg, np.zeros((h, w), np.float32))
    if int(p.get("sub_median", 0)) > 0:
        fig = median3(fig, int(p["sub_median"]))
    pl = plate(p, kind, w, h, tooth_on=False)
    fig, _k = subject_grade(fig, p, kind)
    fig = shared_figure_light(fig, pl, p, kind)
    if kind == "splash":
        pl = ground_shadow(pl, fig[..., 3], shadow, p, meta)
    comp = integrate2(fig, pl, p, kind, post * float(p["post"] if kind == "splash" else p["post_p"]))
    comp = fx_layer(comp, p, meta)
    L = lut()
    if L is not None:
        comp[..., :3] = np.clip(gradelib().apply_lut(comp[..., :3], L, "trilinear"), 0, 1).astype(np.float32)
    if kind == "splash" and p.get("card_lo_q") is not None:
        comp, _s = card_floor(comp, p)
    # the unified paint-over: soft Kuwahara mixed over the whole picture, eased over the face and hands
    r = float(p.get("paint_r2", 5)) * (w / 1600.0 if kind == "splash" else 0.7 * w / 512.0)
    mx = float(p.get("paint_mix", 0.55))
    if mx > 0 and r >= 1.0:
        painted = soft_kuwahara(comp[..., :3], r, float(p.get("paint_q", 6.0)))
        fm = face_mask(fig[..., 3], meta, kind, p)[..., None]
        m = mx + (float(p.get("paint_mix_face", 0.08)) - mx) * fm
        m = m * (float(p.get("paint_mix_plate", 0.45)) + (1.0 - float(p.get("paint_mix_plate", 0.45))) * fig[..., 3:4])
        comp[..., :3] = comp[..., :3] * (1.0 - m) + painted * m
    comp[..., :3] = np.clip(canvas_tooth(comp[..., :3], p), 0.0, 1.0)
    comp[..., 3] = 1.0
    return comp


def _toe(rgb: np.ndarray, s: float, pv: float, chroma: float, wx: np.ndarray | None = None,
         black: float = 1.0, foot: float = 0.0) -> np.ndarray:
    """Lift the darks of display rgb: luma L -> L + s (pv - L)^2 / pv below `pv` (x `wx` per column); `chroma` of
    the lift scales the colour, the rest is added neutral (a very dark pixel only gets the neutral part). With
    `foot` > 0 the lift eases (smoothstep) from `black` of itself at L 0 to all of it at L `foot`."""
    L = np.maximum(rgb @ Y709, 1e-4)
    d = np.clip(pv - L, 0.0, None)
    lift = s * d * d / pv
    if foot > 0.0:
        t = np.clip(L / foot, 0.0, 1.0)
        lift = lift * (black + (1.0 - black) * t * t * (3 - 2 * t))
    if wx is not None:
        lift = lift * wx
    Lp = L + lift
    c = (np.clip(L / 0.06, 0.0, 1.0) * chroma)[..., None]
    scaled = rgb * np.minimum(Lp / L, 4.0)[..., None]
    return np.clip(scaled * c + (rgb + lift[..., None]) * (1.0 - c), 0.0, 1.0).astype(np.float32)


def card_floor(comp: np.ndarray, p: dict) -> tuple[np.ndarray, float]:
    """The splash's card floor (DEFAULTS `card_lo_q`): the least toe that takes the card window's clear rows to
    `card_lo` at quantile `card_lo_q`. Returns (image, toe strength); 0 when the window already holds it."""
    h, w = comp.shape[:2]
    cw = int(round(h * 0.6 / float(p["card_box"])))
    x0 = int(round(float(p["card_pos"]) * (w - cw)))
    r0, r1 = (int(round(float(v) * h)) for v in p["card_rows"])
    xs = np.linspace(0, 1, w, dtype=np.float32)
    t = np.clip((xs - 0.15) / 0.40, 0.0, 1.0)
    wx = (float(p["toe_left"]) + (1.0 - float(p["toe_left"])) * t * t * (3 - 2 * t))[None, :]
    win, wwx = comp[r0:r1, x0:x0 + cw, :3], wx[:, x0:x0 + cw]
    q, lo_t = float(p["card_lo_q"]), float(p["card_lo"])
    pv, ch = float(p["toe_pv"]), float(p["toe_chroma"])
    tb, tf = float(p.get("toe_black", 1.0)), float(p.get("toe_foot", 0.0))
    qv = lambda s: float(np.quantile(_toe(win, s, pv, ch, wwx, tb, tf) @ Y709, q))  # noqa: E731
    if qv(0.0) >= lo_t:
        return comp, 0.0
    lo, hi = 0.0, 1.5
    for _ in range(14):
        m = 0.5 * (lo + hi)
        lo, hi = (m, hi) if qv(m) < lo_t else (lo, m)
    out = comp.copy()
    out[..., :3] = _toe(comp[..., :3], hi, pv, ch, wx, tb, tf)
    return out, hi


# ── the kept subject passes ──────────────────────────────────────────────────────────────────────
def raw_path(sid: str, kind: str, preview: bool = False) -> str:
    return os.path.join(CACHE_DIR, f"{'preview_' if preview else ''}{sid}_{kind}.png")


def keep_raw(src_png: str, sid: str, kind: str, preview: bool = False) -> str:
    os.makedirs(CACHE_DIR, exist_ok=True)
    dst = raw_path(sid, kind, preview)
    shutil.copyfile(src_png, dst)
    return dst


def keep_meta(sid: str, kind: str, preview: bool, meta: dict) -> None:
    """The render's screen-space notes (normalised 0..1 bone points: head, neck, hands, fx bones) beside the kept pass."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    with open(raw_path(sid, kind, preview) + ".json", "w", encoding="utf-8") as f:
        json.dump(meta, f)


def load_meta(sid: str, kind: str, preview: bool = False) -> dict | None:
    fp = raw_path(sid, kind, preview) + ".json"
    if not os.path.isfile(fp):
        return None
    with open(fp, encoding="utf-8") as f:
        return json.load(f)


def fg_for(raw: np.ndarray, kind: str, size: int | None = None) -> np.ndarray:
    """The raw pass as the subject layer: the splash is used as rendered; the portrait renders at 2x (1.5x before
    the CW5 card pipeline) and is reduced premultiplied to `size` (512) like render.fighter_renders."""
    if raw.shape[2] == 3:
        raw = np.concatenate([raw, np.ones(raw.shape[:2] + (1,), np.float32)], axis=2)
    if kind == "portrait":
        n = size or int(round(raw.shape[0] / 2.0))
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
        size = 512 if not preview else int(round(raw.shape[0] / 2.0))
    img = finish(fg_for(raw, kind, size), p, kind, meta=load_meta(sid, kind, preview))
    return save_png(image_path(sid, kind, preview), img)


# ── measure: the crops the client shows ─────────────────────────────────────────────────────────
def stats(rgb: np.ndarray) -> dict:
    L = np.sort(((np.clip(rgb[..., :3], 0, 1) * 255.0) @ Y709).ravel())
    q = lambda f: float(L[int(f * (len(L) - 1))])  # noqa: E731
    return {"p50": round(q(0.5)), "p95": round(q(0.95)), "mean": round(float(L.mean())),
            "over200": round(float((L > 200).mean()) * 100, 1)}


def card_crop(splash: np.ndarray, pos_x: float = 0.86, aspect: float = 0.6) -> np.ndarray:
    """The loading card: a 3:5 window of the splash at object-position 86 % 50 % (loading.tsx CARD_CROP). `aspect`
    (w / h of the window): W2's card shows the plate in its lower `box` of a 3:5 card (screens.css .pcard__art,
    84 % today), i.e. a 0.6 / box window (`--box <h>` on measure / frame)."""
    h, w = splash.shape[:2]
    cw = int(round(h * aspect))
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


def measure(sel: list[str], preview: bool = False, aspect: float = 0.6) -> list[dict]:
    rows = []
    for sid in sel:
        sp, pp = image_path(sid, "splash", preview), image_path(sid, "portrait", preview)
        r = {"sid": sid}
        if os.path.isfile(sp):
            s = load_image(sp)[..., :3]
            r["splash"] = stats(s)
            r["card"] = stats(card_crop(s, aspect=aspect))
        if os.path.isfile(pp):
            r["cell"] = stats(cell_crop(load_image(pp)[..., :3]))
        rows.append(r)
    return rows


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "measure"
    preview = "--preview" in argv
    box = float(argv[argv.index("--box") + 1]) if "--box" in argv else None     # W2's plate height in the card
    kinds = [argv[argv.index("--kind") + 1]] if "--kind" in argv else ["splash", "portrait"]   # compose only these
    argv = [a for i, a in enumerate(argv) if not (i and argv[i - 1] in ("--box", "--kind"))]
    sel = [a for a in argv[1:] if not a.startswith("--")] or sids()
    aspect = 0.6 / box if box else 0.6
    if cmd == "compose":
        for sid in sel:
            for kind in kinds:
                out = compose_to(sid, kind, preview)
                print(f"[plates] {sid} {kind}: {os.path.relpath(out, GAME_DIR) if out else 'no raw pass'}")
        cmd = "measure"
    if cmd == "measure":
        rows = measure(sel, preview, aspect)
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
        bh = box or 0.84                          # the plate covers the card's lower 84 % (screens.css .pcard__art)
        for sid in sel:
            rp = raw_path(sid, "splash", preview)
            if not os.path.isfile(rp):
                continue
            a = card_crop(load_image(rp), aspect=aspect)[..., 3]
            rows = np.where((a > 0.6).any(axis=1))[0]
            if len(rows):
                f = (rows[-1] - rows[0] + 1) / a.shape[0] * bh
                fr.append((sid, round(float(f), 3), round(float(rows[0] / a.shape[0]), 3)))
        v = sorted(x[1] for x in fr)
        for sid, f, top in fr:
            print(f"  {sid:<22} figure {f:.3f} of the card height, its top at {top:.3f} of the plate"
                  f"{'' if 0.70 <= f <= 0.80 else ' (outside 0.70-0.80)'}")
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
