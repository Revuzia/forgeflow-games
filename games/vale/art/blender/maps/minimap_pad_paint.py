"""VALE painted minimap with a margin round the map (hud HUD-3; integration run 2 world-pad). Blender 5.2, headless.

    python3 art/blender/common/heavy.py run -- /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
        --python-exit-code 1 --python art/blender/maps/minimap_pad_paint.py -- [--maps map_bridge] [--px 1100] [--samples 64] [--full]

art/blender/ui/minimap_paint.py paints a map over its own rectangle 0..W x 0..H, so a base plaza that reaches past the
map's edge is cut at the image edge. This re-renders the same painting (that script's builders, materials, sun, Cycles
settings and painterly pass, imported and unchanged) over the map's art.terrain.minimapBounds [x0, y0, x1, y1] (which
src/ui/hud/minimap.tsx draws the image over and maps clicks through), writing art/out/maps/<id>/minimap.png:
  the camera   ortho over the bounds; the pixel size keeps --px on the long side (BRIDGE 1100 x 310 over 168 x 47.34 m)
  the margin   the drop (the gorge material, at the walls' height, so it reads exactly like the walls inside the map), with
               the deck run out under each base plaza disc (art.terrain.plazas) and a 0.6 m lip round the painter's base
               terrace disc (fountain r + 3), so both read whole on the HUD instead of cut at the map's edge
  the map      kept from the shipped painting (art/renders/maps/minimap_<id>_painted.png, the unpadded image), resampled
               onto the padded grid, so only the margin is new (--full renders the map too)
BRIDGE only: RIFT pads in art/blender/maps/minimap_survey.py (its chart is the survey grade of the painting), FRAY's
plate is a disc well inside its square.
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
BLENDER = os.path.dirname(HERE)
sys.path.insert(0, BLENDER)
sys.path.insert(0, os.path.join(BLENDER, "ui"))
from common import imageops, scene  # noqa: E402
import minimap_paint as mp  # noqa: E402

LIP = 0.6          # m of deck beyond the painter's base terrace disc (fountain r + 3) where it pokes past the map's edge
ARC_STEP = 0.15    # m between samples of a disc's rim in the margin


def margin_rims(m, side: str):
    """the discs that reach past the map's x edge on `side` ('w': x < 0, 'e': x > W): (cx, cy, r)"""
    W, _ = m["size"]
    t = m["art"]["terrain"]
    discs = [(p["at"][0], p["at"][1], float(p["radius"])) for p in t.get("plazas", [])]
    discs += [(b["fountain"]["at"][0], b["fountain"]["at"][1], b["fountain"]["radius"] + 3.0 + LIP) for b in m.get("bases", [])]
    if side == "w":
        return [d for d in discs if d[0] - d[2] < 0]
    return [d for d in discs if d[0] + d[2] > W]


def envelope(discs, edge: float, side: str):
    """the outer rim of the discs' union beyond x = edge, as (x, y) from the low-y chord end to the high-y one"""
    if not discs:
        return []
    lo = min(cy - math.sqrt(max(0.0, r * r - (edge - cx) ** 2)) for cx, cy, r in discs if abs(edge - cx) < r)
    hi = max(cy + math.sqrt(max(0.0, r * r - (edge - cx) ** 2)) for cx, cy, r in discs if abs(edge - cx) < r)
    n = max(8, int(math.ceil((hi - lo) / ARC_STEP)))
    pts = []
    for i in range(n + 1):
        y = lo + (hi - lo) * i / n
        xs = [cx + (-1 if side == "w" else 1) * math.sqrt(r * r - (y - cy) ** 2) for cx, cy, r in discs if abs(y - cy) < r]
        x = edge if not xs else (min(min(xs), edge) if side == "w" else max(max(xs), edge))
        pts.append((x, y))
    pts[0] = (edge, lo); pts[-1] = (edge, hi)
    return pts


def deck_bulge(name, poly, W, H, deck, col):
    """the deck past the map's edge: one flat face just under the deck plane, in the deck plane's object space (minimap_paint
    build_bridge: a unit plane at (W/2, -H/2) scaled W x H), so the deck material's Object-coordinate noise runs on
    seamlessly instead of restarting at metre scale"""
    loc = [((x - W / 2) / W, (H / 2 - y) / H, 0.0) for x, y in poly]
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(loc, loc[1:] + loc[:1]))
    if area < 0:
        loc.reverse()                                    # the face looks up (+Z)
    me = bpy.data.meshes.new(name); me.from_pydata(loc, [], [list(range(len(loc)))]); me.update()
    ob = scene.new_object(name, me, col)
    ob.location = (W / 2, -H / 2, -0.002); ob.scale = (W, H, 1.0)
    ob.data.materials.append(deck)
    return ob


def build_margin(m, b, col):
    """the margin round the map: the drop at the walls' height, the deck out under the plazas (BRIDGE)"""
    W, H = m["size"]
    deck = bpy.data.materials.get("deck")
    drop = bpy.data.materials.get("gorge")
    if deck is None or drop is None:
        raise SystemExit("minimap_pad_paint: the map's painting has no deck / gorge materials (BRIDGE only)")
    x0, y0, x1, y1 = b
    # top and bottom strips over the full width (corners included)
    if y0 < 0:
        mp.prism("margin_n", [(x0, y0), (x1, y0), (x1, 0.0), (x0, 0.0)], 0.2, drop, col, z0=0.02)
    if y1 > H:
        mp.prism("margin_s", [(x0, H), (x1, H), (x1, y1), (x0, y1)], 0.2, drop, col, z0=0.02)
    for side, edge, far in (("w", 0.0, x0), ("e", W, x1)):
        if (side == "w" and x0 >= 0) or (side == "e" and x1 <= W):
            continue
        rim = envelope(margin_rims(m, side), edge, side)
        if rim:
            # the strip less the discs' bulge (one simple polygon: the strip's map-side edge follows the rim out), and the
            # bulge itself as deck at the deck's level, in the deck plane's object space
            ylo, yhi = rim[0][1], rim[-1][1]
            strip = [(far, 0.0), (edge, 0.0), (edge, ylo)] + rim[1:-1] + [(edge, yhi), (edge, H), (far, H)]
            mp.prism(f"margin_{side}", strip, 0.2, drop, col, z0=0.02)
            deck_bulge(f"margin_{side}_deck", rim, W, H, deck, col)
        else:
            mp.prism(f"margin_{side}", [(far, 0.0), (edge, 0.0), (edge, H), (far, H)], 0.2, drop, col, z0=0.02)


def keep_interior(arr, paint, W, H, b):
    """inside the map rectangle keep the shipped painting (art/renders/maps/minimap_<id>_painted.png, the unpadded image
    over 0..W x 0..H, bilinearly resampled onto this grid), so the margin is the only change: the shipped BRIDGE painting
    was patched by composites after its last full render (W5a env F6), and a full render today paints the roads from the
    3D lane colour, darker than the bar the brief asks for (map_bridge_landmarks.md §6). Blended over an anti-aliased
    edge; the deck, the drop and the terraces match the render to within 1 / 255 there."""
    h, w = arr.shape[:2]
    ph, pw = paint.shape[:2]
    x0, y0, x1, y1 = b
    sx, sy = w / (x1 - x0), h / (y1 - y0)
    ys, xs = np.mgrid[0:h, 0:w]
    X = x0 + (xs + 0.5) / sx
    Y = y0 + (ys + 0.5) / sy
    inside = (np.clip(np.minimum(X, W - X) * sx + 0.5, 0, 1) * np.clip(np.minimum(Y, H - Y) * sy + 0.5, 0, 1))[..., None]
    u = np.clip(X * pw / W - 0.5, 0, pw - 1); v = np.clip(Y * ph / H - 0.5, 0, ph - 1)
    u0 = np.floor(u).astype(int); v0 = np.floor(v).astype(int)
    u1 = np.minimum(u0 + 1, pw - 1); v1 = np.minimum(v0 + 1, ph - 1)
    fu = (u - u0)[..., None]; fv = (v - v0)[..., None]
    p = paint[..., :3]
    s = (p[v0, u0] * (1 - fu) + p[v0, u1] * fu) * (1 - fv) + (p[v1, u0] * (1 - fu) + p[v1, u1] * fu) * fv
    out = arr.copy()
    out[..., :3] = inside * s + (1 - inside) * arr[..., :3]
    return out


def render_padded(mid: str, px: int, samples: int, full: bool = False) -> None:
    m = json.load(open(os.path.join(mp.CONTENT, f"{mid}.json")))
    W, H = m["size"]
    b = m["art"]["terrain"].get("minimapBounds")
    if not (isinstance(b, list) and len(b) == 4):
        raise SystemExit(f"minimap_pad_paint: {mid}.json has no art.terrain.minimapBounds")
    x0, y0, x1, y1 = (float(v) for v in b)
    bw, bh = x1 - x0, y1 - y0
    scene.reset()
    sc = bpy.context.scene
    col = scene.collection(mid)
    mp.BUILDERS[mid](m, col)
    build_margin(m, (x0, y0, x1, y1), col)
    # minimap_paint.render_map's camera, light and look, over the bounds instead of the map rectangle
    cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"; cam_d.ortho_scale = max(bw, bh)
    cam = scene.new_object("cam", cam_d, col); cam.location = ((x0 + x1) / 2, -(y0 + y1) / 2, 200); sc.camera = cam
    scale = px / max(bw, bh)
    sc.render.resolution_x = int(round(bw * scale)); sc.render.resolution_y = int(round(bh * scale))
    scene.cycles_device(sc)
    sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.film_transparent = False
    w = bpy.data.worlds.new("w"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    sc.world = w
    lt = m["art"].get("lighting", {})
    sd = lt.get("sunDir", [-0.35, 0.79, 0.5])
    elev = max(0.35, min(0.85, sd[1]))
    sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.4 * lt.get("sunIntensity", 3.0) / 3.0; sun.angle = math.radians(3)
    sun.color = scene.hex_rgb("#FFF1E2")
    so = scene.new_object("sun", sun, col)
    d = Vector((-0.62, 0.5, elev)).normalized()
    so.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    out_dir = scene.ensure_dir(os.path.join(mp.OUT, mid))
    raw = os.path.join(out_dir, "minimap_raw.png")
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGB"
    sc.render.filepath = raw
    bpy.ops.render.render(write_still=True)
    arr = imageops.load(raw)
    k = imageops.kuwahara(arr[..., :3], 3)
    arr[..., :3] = arr[..., :3] * 0.45 + k * 0.55
    painted = os.path.join(scene.RENDERS_DIR, "maps", f"minimap_{mid.split('_')[1]}_painted.png")
    kept = os.path.exists(painted) and not full
    if kept:
        arr = keep_interior(arr, imageops.load(painted), W, H, (x0, y0, x1, y1))
    imageops.save(arr, os.path.join(out_dir, "minimap.png"), alpha=False)
    os.remove(raw)
    ppm = (sc.render.resolution_x / bw, sc.render.resolution_y / bh)
    scene.log(f"wrote {scene.rel(os.path.join(out_dir, 'minimap.png'))} ({sc.render.resolution_x}x{sc.render.resolution_y}) over "
              f"{[x0, y0, x1, y1]} ({ppm[0]:.3f} x {ppm[1]:.3f} px/m); inside the map: "
              + (f"the shipped painting {scene.rel(painted)}" if kept else "this render"))


def main():
    args = scene.parse_args(lambda p: (p.add_argument("--maps", default="map_bridge"), p.add_argument("--px", type=int, default=1100),
                                       p.add_argument("--samples", type=int, default=64),
                                       p.add_argument("--full", action="store_true", help="render the map too (do not keep the shipped painting inside it)")))
    for mid in [x for x in args.maps.split(",") if x]:
        if mid != "map_bridge":
            raise SystemExit(f"minimap_pad_paint: {mid}: BRIDGE only (RIFT pads in minimap_survey.py; FRAY needs no margin)")
        render_padded(mid, args.px, args.samples, args.full)


if __name__ == "__main__":
    main()
