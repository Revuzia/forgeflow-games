"""Build one sky HDR from art/blender/sky_presets.json.

    python3 art/build.py sky <id>        (or: blender -b --factory-startup --python sky.py -- --id <id>)

Writes
    art/out/<preset.out or maps/<id>/sky.hdr>       equirect Radiance HDR (mean sky radiance 1.0)
    art/out/maps/<id>/lighting.json                 MapDef.art.lighting fragment (sunDir from the
                                                    same bearing/elevation, colour, intensity,
                                                    ambient, fog) when the preset names `tokens`
    art/renders/skies/<id>.png                      equirect preview through the GAME chain:
                                                    HDR (background intensity 1.0) -> Khronos PBR Neutral -> vale_grade_01
                                                    (sun position marked)
    art/renders/skies/<id>_views.png                three 50° perspective views at +8° pitch: north (the
                                                    game camera's look direction), toward the sun, away
    art/renders/skies/<id>.json                     timings + stats
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402,F401  (first: the bpy wheel registers mathutils on import)
import numpy as np  # noqa: E402

from common import imageops, scene, sky  # noqa: E402

sys.path.insert(0, os.path.join(scene.ART_DIR, "grade"))
import gradelib  # noqa: E402

CUBE = os.path.join(scene.OUT_DIR, "grade", "vale_grade_01.cube")


def load_hdr(path: str) -> np.ndarray:
    img = bpy.data.images.load(path, check_existing=False)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1, :, :3].astype(np.float64)       # rows top-down


def sample_equirect(hdr: np.ndarray, dirs: np.ndarray) -> np.ndarray:
    """Bilinear lookup of three-convention equirect (u = atan2(z, x)/2pi + 0.5, top row = up)."""
    h, w = hdr.shape[:2]
    u = (np.arctan2(dirs[..., 2], dirs[..., 0]) / (2 * math.pi) + 0.5) * w - 0.5
    v = (0.5 - np.arcsin(np.clip(dirs[..., 1], -1, 1)) / math.pi) * h - 0.5
    x0 = np.floor(u).astype(int)
    y0 = np.clip(np.floor(v).astype(int), 0, h - 2)
    fx = (u - x0)[..., None]
    fy = np.clip(v - y0, 0, 1)[..., None]
    x0 %= w
    x1 = (x0 + 1) % w
    return (hdr[y0, x0] * (1 - fx) + hdr[y0, x1] * fx) * (1 - fy) + (hdr[y0 + 1, x0] * (1 - fx) + hdr[y0 + 1, x1] * fx) * fy


def view_dirs(bearing: float, pitch: float, fov: float, w: int, h: int) -> np.ndarray:
    b, p = math.radians(bearing), math.radians(pitch)
    fwd = np.array([math.sin(b) * math.cos(p), math.sin(p), -math.cos(b) * math.cos(p)])
    right = np.array([math.cos(b), 0.0, math.sin(b)])
    up = np.cross(right, fwd)
    t = math.tan(math.radians(fov) / 2)
    xs = np.linspace(-t, t, w)
    ys = np.linspace(t * h / w, -t * h / w, h)
    d = fwd[None, None, :] + xs[None, :, None] * right[None, None, :] + ys[:, None, None] * up[None, None, :]
    return d / np.linalg.norm(d, axis=-1, keepdims=True)


def previews(hdr: np.ndarray, p: dict, ambient: float, sid: str) -> dict:
    lut = gradelib.read_cube(CUBE) if os.path.isfile(CUBE) else None
    out = {}
    # equirect, game chain
    eq = gradelib.display(hdr * ambient, lut, method="tetrahedral")
    h, w = eq.shape[:2]
    if w > 1024:
        eq = imageops.resize(eq.astype(np.float32), 1024, 512).astype(np.float64)
        h, w = 512, 1024
    if p.get("sun_bearing_deg") is not None:
        u = int(((p["sun_bearing_deg"] - 90) / 360.0 + 0.5) % 1.0 * w)
        v = int((0.5 - p["sun_elevation_deg"] / 180.0) * h)
        for dy in range(-7, 8):
            for dx in (-7, 7):
                if 0 <= v + dy < h:
                    eq[v + dy, (u + dx) % w] = (1, 0.25, 0.1)
                    eq[np.clip(v + dx, 0, h - 1), (u + dy) % w] = (1, 0.25, 0.1)
    path = os.path.join(scene.RENDERS_DIR, "skies", f"{sid}.png")
    gradelib.save_png(path, eq)
    out["equirect"] = scene.rel(path)
    # perspective views
    bear = p.get("sun_bearing_deg", (p["sun_azimuth_deg"] + 90) % 360)
    cells = []
    for b in (0.0, bear, (bear + 180) % 360):
        d = view_dirs(b, 8.0, 50.0, 480, 270)
        cells.append(gradelib.display(sample_equirect(hdr, d) * ambient, lut, method="tetrahedral"))
    gap = np.zeros((270, 6, 3))
    strip = np.concatenate([cells[0], gap, cells[1], gap, cells[2]], 1)
    path = os.path.join(scene.RENDERS_DIR, "skies", f"{sid}_views.png")
    gradelib.save_png(path, strip)
    imageops.label(path, [(8, 8, "north (game camera look dir)"), (494, 8, f"toward the sun {bear:.0f}°"),
                          (980, 8, "away from the sun")])
    out["views"] = scene.rel(path)
    return out


def lighting_fragment(p: dict, tok: dict, stats: dict) -> tuple:
    """MapDef.art.lighting (catalog.ts, zod .strict(): exactly these keys, CONTENT copies it
    verbatim) from tokens.json + the sky's own sun vector; second value = provenance note."""
    m = tok["grade"]["maps"][p["tokens"]]
    sun = m["sun"]
    fog = m.get("fog") or {}
    fog_col, fog_den, fog_src = "#000000", 0.0, None
    for k in ("heightMist", "gorge", "distance"):
        if fog.get(k):
            fog_col = fog[k]["color"]
            fog_den = fog[k].get("densityPerM", fog[k].get("exp2Density", 0.0))
            fog_src = k
            break
    if fog_src is None:      # no fog (FRAY): keep the tokens' glare colour, zero density
        fog_col = next((v["color"] for v in fog.values() if isinstance(v, dict) and v.get("color")), fog_col)
    return {
        "sunDir": stats["sun_dir_three"], "sunColor": sun["color"], "sunIntensity": sun["intensity"],
        "ambient": m["environmentIntensity"], "fogColor": fog_col, "fogDensity": fog_den,
        "exposure": tok["grade"]["exposure"],
    }, {
        "source": f"tokens.json grade.maps.{p['tokens']} (fog: {fog_src or 'none'}); sunDir recomputed from "
                   f"bearing {p.get('sun_bearing_deg')} / elevation {p['sun_elevation_deg']} and checked against "
                   f"tokens sun.dir: {stats.get('sun_dir_check')}",
    }


def main():
    args = scene.parse_args(lambda q: q.add_argument("--id", required=True))
    presets = scene.read_json(os.path.join(scene.BLENDER_DIR, "sky_presets.json"), {})
    if args.id not in presets:
        raise SystemExit(f"no sky preset {args.id!r} in sky_presets.json (have: {[k for k in presets if not k.startswith('_c')]})")
    p = {k: v for k, v in presets[args.id].items() if not k.startswith("_")}
    out = os.path.join(scene.OUT_DIR, p.pop("out", f"maps/{args.id}/sky.hdr"))
    tok_key = p.get("tokens")
    if args.fast:
        p["samples"] = 4
    tok = scene.read_json(os.path.join(scene.GAME_DIR, "_design", "tokens.json"), {})
    if tok_key and tok:          # ground radiance below the horizon uses the map's own sun + ambient
        m = tok["grade"]["maps"][tok_key]
        p.setdefault("ground_sun_intensity", m["sun"]["intensity"])
        p.setdefault("ground_ambient", m["environmentIntensity"])
    stats = sky.build_sky(p, out, None)
    stats["out"] = scene.rel(out)
    stats["bytes"] = os.path.getsize(out)
    ambient = 1.0
    if tok_key and tok:
        frag, src = lighting_fragment({**p, **sky.resolve_params(p)}, tok, stats)
        stats["lighting_source"] = src["source"]
        tok_dir = tok["grade"]["maps"][tok_key]["sun"].get("dir")
        if tok_dir:
            stats["sun_dir_tokens"] = tok_dir
            stats["sun_dir_matches_tokens"] = max(abs(a - b) for a, b in zip(stats["sun_dir_three"], tok_dir)) < 2e-3
            if not stats["sun_dir_matches_tokens"]:
                scene.log(f"WARNING sky {args.id}: sunDir {stats['sun_dir_three']} != tokens {tok_dir}")
        ambient = frag["ambient"]
        lp = os.path.join(os.path.dirname(out), "lighting.json")
        scene.write_json(lp, frag)
        stats["lighting"] = scene.rel(lp)
    hdr = load_hdr(out)
    # previews show the dome as a background (three: scene.backgroundIntensity 1.0); `ambient`
    # (environmentIntensity) only scales the image-based lighting
    stats["previews"] = previews(hdr, sky.resolve_params(p), 1.0, args.id)
    stats["ambient"] = ambient
    stats.pop("params", None)
    stats["preset"] = presets[args.id]
    scene.write_json(os.path.join(scene.RENDERS_DIR, "skies", f"{args.id}.json"), stats)


if __name__ == "__main__":
    main()
