"""Dunsom paint loop (fix pass 1; a copy of proto/kemdo_paint.py) on the cached build (no rebuild, no bake): re-runs the CURRENT projection paint of
fighters/dunsom.py on the cached game mesh, prints every part's median colour (sRGB hex, L*), writes the atlas,
and optionally swaps it into the cached material and re-renders splash / portrait / icon PREVIEWS.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/dunsom_paint.py -- \
        [--skin dunsom_highrim] [--render splash,portrait,icon] [--scale 0.5] [--out <png>]

The baked AO is approximated from the cached ORM occlusion channel (the build multiplies the real AO in).
Previews land in art/renders/fighters/dunsom/preview_*.png (shipped files untouched).
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import pipeline, render, rig, scene  # noqa: E402
from common.fighter import Context  # noqa: E402
from common.hifi import project  # noqa: E402


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--skin", default="")
    p.add_argument("--render", default="")
    p.add_argument("--scale", type=float, default=0.5)
    p.add_argument("--size", type=int, default=2048)
    p.add_argument("--out", default=os.path.join(scene.CACHE_DIR, "_fit", "dunsom_paint.png"))
    p.add_argument("--splash", default="", help="SPLASH overrides: key=value,key=value (numbers parsed)")
    p.add_argument("--no-paint", action="store_true", help="keep the cached texture (pose / framing tries)")
    return p.parse_args(scene.script_args())


def load_spec():
    path = os.path.join(os.path.dirname(HERE), "fighters", "dunsom.py")
    spec = importlib.util.spec_from_file_location("dunsom_spec", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def lstar(c):
    c = np.asarray(c, dtype=np.float64)
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    y = lin @ np.array([0.2126, 0.7152, 0.0722])
    return np.where(y > 0.008856, 116 * np.cbrt(y) - 16, 903.3 * y)


def main():
    a = args()
    K = load_spec()
    for kv in [x for x in a.splash.split(",") if x]:
        k, v = kv.split("=")
        try:
            v = float(v)
        except ValueError:
            pass
        K.SPLASH[k] = v
    P = pipeline.paths(K)
    bpy.ops.wm.open_mainfile(filepath=P["cache"])
    body = bpy.context.scene.objects[K.ID]
    names = json.load(open(os.path.join(scene.CACHE_DIR, "fighters", "dunsom_parts.json")))
    skin = next((s for s in K.SKINS if s["id"] == a.skin), None) if a.skin else None
    cfg = dict(K.PROJECTION)
    if skin:
        flat = {}
        pal = dict(K.PALETTE)
        pal.update(skin["palette"])
        for pn, role in K.SKIN_FLAT.items():
            if pn in names:
                flat[pn] = pal.get(role)
        cfg["flat"] = flat
    if a.no_paint:
        render_only(a, K, P, skin)
        return
    img, maps = project.paint_object(body, a.size, cfg, names, log=scene.log, return_maps=True)
    if skin:
        roles = {it[0]: it[3] for it in K.sculpts() + K.skin_extras(skin.get("extra") or {})}
        base_pal = dict(K.PALETTE)
        pal = dict(K.PALETTE)
        pal.update(skin["palette"])
        img = project.recolour(img, maps, names, roles, base_pal, pal, skip=set(K.SKIN_FLAT), log=scene.log)
    part = maps["part"]
    print("[dunsom-paint] part medians (sRGB, before AO):")
    for i, n in enumerate(names):
        m = part == i
        if not m.any():
            continue
        med = np.median(img[m], axis=0)
        hexs = "#" + "".join(f"{int(round(float(c) * 255)):02X}" for c in np.clip(med, 0, 1))
        print(f"  {n:16s} {hexs}  L* {float(lstar(med)):5.1f}  texels {int(m.sum())}")
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    project.save_rgb(img, a.out)
    print(f"[dunsom-paint] atlas -> {scene.rel(a.out)}")
    if not a.render:
        return
    # swap into the cached material: base = paint x approx AO (from the ORM occlusion channel)
    mat = body.data.materials[0]
    base_img = orm_img = None
    for nd in mat.node_tree.nodes:
        if nd.type == "TEX_IMAGE" and nd.image is not None:
            nm = nd.image.name.lower()
            if "base" in nm:
                base_img = nd.image
            elif "orm" in nm:
                orm_img = nd.image
    W, H = base_img.size
    rgb = img
    if (W, H) != (img.shape[1], img.shape[0]):
        raise SystemExit(f"atlas size {img.shape[:2]} != cached base {W}x{H}")
    if orm_img is not None:
        ow, oh = orm_img.size
        o = np.empty(ow * oh * 4, dtype=np.float32)
        orm_img.pixels.foreach_get(o)
        o = o.reshape(oh, ow, 4)[::-1, :, 0]
        ry = (np.arange(H) * oh // H)
        rx = (np.arange(W) * ow // W)
        ao = o[ry][:, rx]
        k = (1.0 - K.AO_INTO_BASE) + K.AO_INTO_BASE * np.power(np.clip(ao, 0, 1), 0.8)
        rgb = rgb * k[..., None]
    rgba = np.ones((H, W, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    base_img.pixels.foreach_set(rgba[::-1].ravel())
    base_img.update()
    render_only(a, K, P, skin)


def render_only(a, K, P, skin):
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    ctx = Context(spec=K)
    ctx.info = rig.RigInfo(armature=arm, props=K.PROPORTIONS)
    chains = {}
    for b in arm.data.bones:
        mm = re.match(r"x_(.+)_(\d+)$", b.name)
        if mm:
            chains.setdefault(mm.group(1), []).append((int(mm.group(2)), b.name))
    ctx.chains = {k: [n for _, n in sorted(v)] for k, v in chains.items()}
    objs = [arm] + [o for o in bpy.context.scene.objects if o.type == "MESH" and o.parent == arm and not o.hide_render]
    only = {x for x in a.render.split(",") if x}
    res = render.fighter_renders(ctx, objs, P, skin, only=only, scale=a.scale)
    print(f"[dunsom-paint] renders: {res}")


if __name__ == "__main__":
    main()
