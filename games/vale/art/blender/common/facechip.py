"""HUD face chips: the fighter identity chip (final parity HUD-2).

art/out/fighters/<id>/icon.png (128 x 128) is what the minimap (26 px), the scoreboard (28 px), the kill feed
(22-24 px), the ally frames and the banners draw; portrait.png stays the menu art. A chip is a tight head-and-
shoulders crop (the head fills `head_frac` of the frame height) on a dark ink ground with a soft glow and a rim in
the fighter's signature hue (content/fighters/<id>.json vfx.signature, overridable here), plus a value floor that
lifts dark kits off the ink. Gate: every pair of chips differs by a mean absolute difference >= 55 at 26 px
inside the circle mask (`python3 art/blender/common/facechip.py gate`, the same measure as the HUD review's
fdist.mjs).

Two halves:
  * render_chip(...)  in Blender (called by render.fighter_renders for every fighter listed in
    art/blender/fighters/face_chips.json): poses the fighter, frames the head, renders two linear EXRs with the
    same seed (key + sky fill; key + fill + a white rim pair), keeps them as art/renders/fighters/<id>/chip_raw.npz
    and composes the chip.
  * compose(...)      pure numpy (+ art/grade/gradelib.py): rim tint, exposure / value floor, the painted ink
    ground, tone map (Khronos PBR Neutral), the vale_grade_01 LUT. It runs in plain python3 too, so the hues and
    grounds are tuned against the gate without re-rendering:
        python3 art/blender/common/facechip.py compose [ids] [--preview]
        python3 art/blender/common/facechip.py gate [--preview]
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER_DIR = os.path.dirname(HERE)
ART_DIR = os.path.dirname(BLENDER_DIR)
GAME_DIR = os.path.dirname(ART_DIR)
TABLE = os.path.join(BLENDER_DIR, "fighters", "face_chips.json")
OUT_DIR = os.path.join(ART_DIR, "out", "fighters")
RENDERS_DIR = os.path.join(ART_DIR, "renders", "fighters")
LUT = os.path.join(ART_DIR, "out", "grade", "vale_grade_01.cube")

DEFAULTS = {
    "size": 128,            # shipped icon size
    "render": 384,          # render size (3x supersampled, area-averaged down)
    "samples": 128,
    "lens": 85.0,
    "yaw": None,            # None: the fighter's SPLASH icon_yaw
    "pitch": 4.0,
    "head_frac": 0.66,      # head (chin to crown) / frame height
    "top_margin": 0.05,     # crown to the top edge, fraction of the frame
    "x_center": 0.5,        # head centre across the frame
    "chin": 0.05,           # chin below the head joint, x height / 1.9 (m)
    "crown_pct": 99.5,      # crown = this percentile of the head vertices' height (stray tips ignored)
    "crown_cap": None,      # crown at most this far above the head joint, x height / 1.9 (m): tall hats crop
    "clip": None,           # None: the portrait pose (SPLASH portrait_clip / portrait_t)
    "t": None,
    "key": 1.0,             # sun scale
    "fill": 1.0,            # sky fill scale
    "ink": "#0E1016",       # ground
    "hue": None,            # None: content vfx.signature
    "glow_v": 0.50,         # hue glow value (HSV V, display) behind the head
    "glow_s": 0.85,         # glow saturation scale
    "glow_r": 0.60,         # glow radius, fraction of the frame
    "glow_c": [0.50, 0.40], # glow centre (x, y from the top)
    "rim": 1.0,             # rim gain (linear), tinted in the hue
    "rim_s": 0.70,          # rim tint saturation cap
    "ev": 0.0,              # exposure (stops) before the value floor
    "floor": 0.36,          # value floor: median display luma of the lit head (sRGB 0..1)
    "max_ev": 1.5,          # the floor lifts at most this many stops
}


# ── table ────────────────────────────────────────────────────────────────────────────────────────
def table() -> dict:
    if not os.path.isfile(TABLE):
        return {}
    with open(TABLE, encoding="utf-8") as f:
        return json.load(f)


def signature(fid: str) -> str | None:
    p = os.path.join(GAME_DIR, "content", "fighters", f"{fid}.json")
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    return ((d.get("vfx") or {}).get("signature")) or None


def params(fid: str) -> dict | None:
    """The chip parameters for `fid`, or None when the fighter has no face chip (old icon pass)."""
    t = table()
    ent = (t.get("fighters") or {}).get(fid)
    if ent is None:
        return None
    p = dict(DEFAULTS)
    p.update(t.get("defaults") or {})
    p.update(ent)
    if not p.get("hue"):
        p["hue"] = signature(fid) or "#8090A0"
    return p


def ids() -> list[str]:
    return sorted((table().get("fighters") or {}).keys())


_GL = None


def gradelib():
    global _GL
    if _GL is None:
        s = importlib.util.spec_from_file_location("vale_gradelib_chip", os.path.join(ART_DIR, "grade", "gradelib.py"))
        _GL = importlib.util.module_from_spec(s)
        s.loader.exec_module(_GL)
    return _GL


_LUT = None


def lut():
    global _LUT
    if _LUT is None and os.path.isfile(LUT):
        _LUT = gradelib().read_cube(LUT)
    return _LUT


# ── compose (pure numpy) ────────────────────────────────────────────────────────────────────────
def _noise(w: int, h: int, cells: int, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    g = rng.random((cells + 1, cells + 1))
    ys = np.linspace(0, cells, h)
    xs = np.linspace(0, cells, w)
    y0 = np.minimum(np.floor(ys).astype(int), cells - 1)
    x0 = np.minimum(np.floor(xs).astype(int), cells - 1)
    fy = ys - y0
    fx = xs - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]
    fx = (fx * fx * (3 - 2 * fx))[None, :]
    a = g[y0][:, x0] * (1 - fx) + g[y0][:, x0 + 1] * fx
    b = g[y0 + 1][:, x0] * (1 - fx) + g[y0 + 1][:, x0 + 1] * fx
    return a * (1 - fy) + b * fy


def ground(n: int, p: dict, seed: int = 11) -> np.ndarray:
    """The painted ink ground (display sRGB, (n, n, 3)): ink, a soft glow of the fighter's hue behind the head,
    a few low brush blotches and a canvas tooth, darker toward the corners."""
    gl = gradelib()
    hue = gl.hex_to_rgb(p["hue"])
    h, s, _ = gl.rgb_to_hsv(hue)
    glow = gl.hsv_to_rgb(np.array([h, min(1.0, s * p["glow_s"]), p["glow_v"]]))
    ink = gl.hex_to_rgb(p["ink"])
    ink = ink * 0.82 + glow * 0.10
    yy, xx = np.mgrid[0:n, 0:n] / max(1, n - 1)
    cx, cy = p["glow_c"]
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    g = np.exp(-(d / p["glow_r"]) ** 2 * 1.6)
    col = ink[None, None, :] * (1 - g[..., None]) + glow[None, None, :] * g[..., None]
    blot = _noise(n, n, 4, seed) * 0.6 + _noise(n, n, 9, seed + 1) * 0.4
    tooth = _noise(n, n, max(8, n // 6), seed + 3)
    col = col * (0.90 + 0.18 * blot[..., None]) * (0.97 + 0.05 * tooth[..., None])
    vig = 1 - 0.45 * np.clip((np.sqrt((xx - 0.5) ** 2 + (yy - 0.45) ** 2) - 0.42) / 0.35, 0, 1) ** 1.4
    return np.clip(col * vig[..., None], 0, 1)


def _down(a: np.ndarray, n: int) -> np.ndarray:
    h = a.shape[0]
    if h == n:
        return a
    if h % n == 0:
        f = h // n
        return a.reshape(n, f, n, f, a.shape[2]).mean(axis=(1, 3))
    ys = np.linspace(0, h - 1, n).round().astype(int)
    return a[ys][:, ys]


def compose(raw: dict, p: dict, grade: bool = True) -> tuple[np.ndarray, dict]:
    """raw: {"base": (N, N, 4) linear premultiplied RGBA (key + fill), "lit": (N, N, 4) the same with the white
    rim pair}. Returns the chip (size, size, 3) display sRGB (graded) and an info dict."""
    gl = gradelib()
    base = raw["base"].astype(np.float64)
    lit = raw["lit"].astype(np.float64)
    a = np.clip(lit[..., 3:4], 0, 1)
    rim = np.clip(lit[..., :3] - base[..., :3], 0, None)
    hue = gl.hex_to_rgb(p["hue"])
    h, s, _ = gl.rgb_to_hsv(hue)
    tint = gl.srgb_decode(gl.hsv_to_rgb(np.array([h, min(s, p["rim_s"]), 1.0])))
    inv = np.where(a > 1e-4, 1.0 / np.maximum(a, 1e-4), 0.0)
    sbase = base[..., :3] * inv                       # straight (un-premultiplied) key + fill
    srim = rim * tint[None, None, :] * p["rim"] * inv  # the tinted rim (the value floor does not scale it)
    n = sbase.shape[0]
    head = (a[..., 0] > 0.5) & (np.arange(n)[:, None] < int(0.72 * n))

    def disp(ev):
        return gl.srgb_encode(np.clip(gl.neutral_tonemap(sbase * (2.0 ** ev) + srim), 0, 1))

    def med(img):
        if not head.any():
            return 1.0
        y = img[..., 0] * 0.2126 + img[..., 1] * 0.7152 + img[..., 2] * 0.0722
        return float(np.median(y[head]))

    ev = float(p["ev"])
    fig = disp(ev)
    m0 = med(fig)
    if m0 < p["floor"]:
        lo, hi = ev, ev + float(p["max_ev"])
        if med(disp(hi)) <= p["floor"]:
            ev = hi
        else:
            for _ in range(14):
                mid = (lo + hi) / 2
                if med(disp(mid)) < p["floor"]:
                    lo = mid
                else:
                    hi = mid
            ev = hi
        fig = disp(ev)
    bg = ground(n, p)
    comp = fig * a + bg * (1 - a)
    comp = _down(comp, int(p["size"]))
    if grade and lut() is not None:
        comp = gl.apply_lut(comp, lut(), "trilinear")
    return np.clip(comp, 0, 1), {"ev": round(ev, 3), "head_luma": round(m0, 3), "head_luma_out": round(med(fig), 3)}


def raw_path(fid: str) -> str:
    return os.path.join(RENDERS_DIR, fid, "chip_raw.npz")


def load_raw(fid: str) -> dict:
    z = np.load(raw_path(fid))
    return {"base": z["base"], "lit": z["lit"]}


def icon_path(fid: str, preview: bool = False) -> str:
    if preview:
        return os.path.join(RENDERS_DIR, fid, "preview_icon.png")
    return os.path.join(OUT_DIR, fid, "icon.png")


def compose_to(fid: str, raw: dict | None = None, preview: bool = False, p: dict | None = None) -> dict:
    p = p or params(fid)
    raw = raw if raw is not None else load_raw(fid)
    img, info = compose(raw, p)
    dest = icon_path(fid, preview)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    gradelib().save_png(dest, img)
    info["file"] = os.path.relpath(dest, GAME_DIR).replace("\\", "/")
    return info


# ── the gate (the HUD review's fdist.mjs measure) ───────────────────────────────────────────────
def chip26(img: np.ndarray, s: int = 26) -> np.ndarray:
    """(H, W, 3) 0..1 -> the pixels inside the circle at s x s (0..255), Lanczos like sharp's resize."""
    try:
        from PIL import Image
        im = Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)).resize((s, s), Image.LANCZOS)
        a = np.asarray(im).astype(np.float64)
    except ImportError:
        a = _down(img, s) * 255
    yy, xx = np.mgrid[0:s, 0:s] + 0.5
    m = (xx - s / 2) ** 2 + (yy - s / 2) ** 2 <= (s / 2) ** 2
    return a[m]


def distances(imgs: dict) -> list:
    names = sorted(imgs)
    px = {k: chip26(imgs[k]) for k in names}
    out = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            out.append((a, b, float(np.abs(px[a] - px[b]).mean())))
    return sorted(out, key=lambda r: r[2])


def _load_png(path: str) -> np.ndarray:
    return gradelib().load_png(path)[..., :3]


def main(argv: list[str]) -> int:
    cmd = argv[0] if argv else "gate"
    preview = "--preview" in argv
    sel = [a for a in argv[1:] if not a.startswith("--")] or ids()
    if cmd == "compose":
        for fid in sel:
            if not os.path.isfile(raw_path(fid)):
                print(f"[chip] {fid}: no {os.path.relpath(raw_path(fid), GAME_DIR)} (render it: build.py portraits {fid} --only icon)")
                continue
            print(f"[chip] {fid}: {compose_to(fid, preview=preview)}")
        cmd = "gate"
        sel = ids()
    if cmd == "gate":
        imgs = {fid: _load_png(icon_path(fid, preview and os.path.isfile(icon_path(fid, True)))) for fid in sel
                if os.path.isfile(icon_path(fid, preview and os.path.isfile(icon_path(fid, True))))}
        d = distances(imgs)
        bad = [r for r in d if r[2] < 55.0]
        print(f"[chip] gate: {len(imgs)} chips, {len(d)} pairs, min {d[0][2]:.1f} ({d[0][0]}-{d[0][1]}), "
              f"median {d[len(d) // 2][2]:.1f}, below 55: {len(bad)}")
        for r in d[:10]:
            print(f"    {r[0]:>8} - {r[1]:<8} {r[2]:.1f}")
        return 1 if bad else 0
    print(__doc__)
    return 2


# ── render (Blender) ────────────────────────────────────────────────────────────────────────────
def _head_points(arm, objs) -> np.ndarray | None:
    """World positions of the posed vertices bound (>= 50 %) to the head bone or its children (hats, crests,
    hood tips), plus every mesh parented straight to one of those bones."""
    import bpy
    hb = arm.data.bones.get("head")
    if hb is None:
        return None
    hs = {hb.name} | {c.name for c in hb.children_recursive}
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type != "MESH" or o.hide_render:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        n = len(me.vertices)
        if n == 0:
            ev.to_mesh_clear()
            continue
        co = np.empty(n * 3, np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(n, 3).astype(np.float64)
        if o.parent_type == "BONE" and o.parent_bone in hs:
            sel = np.ones(n, bool)
        else:
            idx = {g.index for g in o.vertex_groups if g.name in hs}
            sel = np.zeros(n, bool)
            if idx:
                src = o.data if len(o.data.vertices) == n else me
                w = np.zeros(n)
                for v in src.vertices:
                    for g in v.groups:
                        if g.group in idx:
                            w[v.index] += g.weight
                sel = w >= 0.5
        if sel.any():
            M = np.array(ev.matrix_world)
            pts.append(co[sel] @ M[:3, :3].T + M[:3, 3])
        ev.to_mesh_clear()
    return np.concatenate(pts) if pts else None


def _project(cam, pts: np.ndarray) -> np.ndarray:
    import bpy
    from bpy_extras.object_utils import world_to_camera_view
    from mathutils import Vector
    sc = bpy.context.scene
    return np.array([tuple(world_to_camera_view(sc, cam, Vector(tuple(q)))) for q in pts])


def frame(cam, arm, objs, p: dict, yaw: float, H: float) -> dict:
    """Aim `cam` so the head (chin to crown) fills p.head_frac of the frame height, the crown p.top_margin below
    the top edge, the head centred across at p.x_center."""
    import bpy
    from mathutils import Vector

    from . import render as R
    bpy.context.view_layer.update()
    joint = R.bone_pos(arm, "head")
    tip = R.bone_pos(arm, "head", tail=True)
    pts = _head_points(arm, objs)
    k = H / 1.9
    if pts is None or len(pts) < 50:
        pts = np.array([tuple(joint), tuple(tip + (tip - joint) * 0.2)])
    crown = float(np.percentile(pts[:, 2], p["crown_pct"]))
    if p.get("crown_cap") is not None:
        crown = min(crown, joint.z + float(p["crown_cap"]) * k)
    chin_z = joint.z - p["chin"] * k
    sub = pts[np.linspace(0, len(pts) - 1, min(len(pts), 2500)).astype(int)]
    sub = sub[(sub[:, 2] >= chin_z - 0.02) & (sub[:, 2] <= crown + 0.005)]
    cx, cy = float(np.median(sub[:, 0])), float(np.median(sub[:, 1]))
    tgt = Vector((cx, cy, (crown + chin_z) / 2))
    chin = Vector((cx, cy, chin_z))
    cam.data.lens = p["lens"]
    cam.data.sensor_fit = "AUTO"
    cam.data.sensor_width = 36.0
    cam.data.shift_x = cam.data.shift_y = 0.0
    vfov = 2 * math.atan(18.0 / p["lens"])
    dist = (crown - chin_z) / p["head_frac"] / (2 * math.tan(vfov / 2))
    top_pt = Vector((cx, cy, crown))
    for _ in range(4):                      # the head's height measured on its axis (a near hat brim or a crest
        R.look_at(cam, tgt, R.orbit(tgt, dist, yaw, p["pitch"]))     # leaning at the camera does not count)
        bpy.context.view_layer.update()
        pc, pt = _project(cam, np.array([tuple(chin), tuple(top_pt)]))
        dist *= float(pt[1] - pc[1]) / p["head_frac"]
    R.look_at(cam, tgt, R.orbit(tgt, dist, yaw, p["pitch"]))
    bpy.context.view_layer.update()
    pc, pt, pm = _project(cam, np.array([tuple(chin), tuple(top_pt), tuple(tgt)]))
    cam.data.shift_x = float(pm[0] - p["x_center"])
    cam.data.shift_y = float(pt[1] - (1.0 - p["top_margin"]))
    bpy.context.view_layer.update()
    return {"crown": round(crown, 3), "chin": round(chin_z, 3), "head_h": round(crown - chin_z, 3), "dist": round(dist, 3),
            "target": [round(v, 3) for v in tgt], "pts": int(len(pts))}


def _exr(path: str) -> np.ndarray:
    import OpenImageIO as oiio
    b = oiio.ImageBuf(path)
    a = b.get_pixels(oiio.FLOAT)
    names = list(b.spec().channelnames)
    order = [next(i for i, c in enumerate(names) if c.split(".")[-1] == ch) for ch in "RGBA"]
    return np.ascontiguousarray(a[..., order]).astype(np.float32)


def render_chip(ctx, objs, P: dict, cfg: dict, light: dict, chains, clips, fast: bool, dest: str) -> tuple[str, dict]:
    """Render the face chip's two linear passes for ctx.spec.ID, keep them (chip_raw.npz) and write the chip."""
    import time

    import bpy
    from mathutils import Vector

    from . import anim, render as R, scene
    t0 = time.perf_counter()
    spec = ctx.spec
    p = params(spec.ID)
    arm = ctx.info.armature
    H = spec.PROPORTIONS["height"]
    clip = p["clip"] or cfg["portrait_clip"]
    t = cfg["portrait_t"] if p["t"] is None else p["t"]
    pose_fn = getattr(spec, "chip_pose", None)
    if pose_fn is not None:
        if arm.animation_data:
            arm.animation_data.action = None
        anim.apply_pose(arm, pose_fn())
    else:
        R.pose_frame(arm, spec.MOTION, clip, t=t, chains=chains, clips=clips)
    cam = bpy.data.objects.get("vale_cam") or R.camera(lens=50)
    yaw = cfg["icon_yaw"] if p["yaw"] is None else p["yaw"]
    N = max(48, int(p["render"]) // (4 if fast else 1))
    N -= N % int(p["size"]) if N >= int(p["size"]) else 0
    samples = max(16, int(p["samples"]) // (8 if fast else 1))
    sc = bpy.context.scene
    sc.render.resolution_x = sc.render.resolution_y = N      # square before framing (the cached .blend keeps
    sc.render.resolution_percentage = 100                     # whatever resolution it was saved with)
    info = frame(cam, arm, objs, p, yaw, H)
    tgt = Vector(info["target"])
    # lights: the bible sun (view 225 / 45, the map's colour), the map sky as fill (the camera sees none of it),
    # and a white rim pair from behind (tinted in the compose)
    R.clear_lights()
    for o in list(bpy.context.scene.objects):
        if o.type == "LIGHT" and o.name.startswith("vale_key_sun"):
            o.hide_render = True
    R.sun_lamp(R.view_dir_light(cam, cfg["key_az"], cfg["key_el"]),
               light["sunIntensity"] * 0.9 * cfg["sun"] / 3.0 * p["key"], scene.hex_rgb(light["sunColor"]))
    R.sky_world(light["sky"], light["ambient"] * p["fill"], camera_strength=0.0)
    rims = []
    for nm, az, el, e in (("vale_chiprim_l", -30.0, 22.0, 1.0), ("vale_chiprim_r", 28.0, 16.0, 1.15)):
        d = R.view_dir_light(cam, az, el)
        rims.append(R._area(nm, tgt + d * 1.8, tgt, 520.0 * e, (1.0, 1.0, 1.0), 0.45))
    os.makedirs(P["renders"], exist_ok=True)
    raw = {}
    for key, on in (("base", False), ("lit", True)):
        for o in rims:
            o.hide_render = not on
        R.setup(N, N, samples, transparent=True, noise=0.01, view="Standard")
        sc = bpy.context.scene
        sc.cycles.seed = 7
        st = sc.render.image_settings
        if hasattr(st, "media_type"):
            st.media_type = "IMAGE"
        st.file_format = "OPEN_EXR"
        st.color_depth = "32"
        st.color_mode = "RGBA"
        path = os.path.join(P["renders"], f"_chip_{key}.exr")
        R.render(path)
        raw[key] = _exr(path)
        os.remove(path)
    scene.log(f"face chip {spec.ID}: raw {N}px x{samples}, lit max {float(raw['lit'][..., :3].max()):.2f}")
    for o in rims:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.context.scene.render.image_settings.file_format = "PNG"
    np.savez_compressed(os.path.join(P["renders"], "chip_raw.npz"), base=raw["base"].astype(np.float16),
                        lit=raw["lit"].astype(np.float16))
    img, cinfo = compose(raw, p)
    gradelib().save_png(dest, img)
    for o in list(bpy.context.scene.objects):
        if o.type == "LIGHT" and o.name.startswith("vale_key_sun"):
            o.hide_render = True
    cam.data.shift_x = cam.data.shift_y = 0.0
    info.update(cinfo)
    info["seconds"] = round(time.perf_counter() - t0, 2)
    scene.log(f"face chip {spec.ID}: {json.dumps(info)}")
    return dest, info


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
