"""Rishal hero-render previews on the build's cached .blend (no rebuild): the pipeline's own splash / portrait / icon
(render.fighter_renders with the CURRENT rishal.py: its SPLASH, clips and render wrapper) at a preview scale, written
to art/renders/fighters/rishal/preview_*.png (the shipped files are untouched).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/rishal_hero.py -- \
        [--only splash,portrait,icon] [--scale 0.5] [--fast]
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import pipeline, render, scene  # noqa: E402


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="splash,portrait,icon")
    ap.add_argument("--scale", type=float, default=0.5)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--set", default="", help="SPLASH overrides, e.g. yaw=34,x=0.62")
    a = ap.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "rishal.blend"))
    import rishal as R
    for kv in filter(None, a.set.split(",")):
        k, v = kv.split("=")
        R.SPLASH[k] = v if k in ("map", "clip", "portrait_clip") else float(v)
    R._install_paint()
    if hasattr(R, "_install_render"):
        R._install_render()
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.type == "ARMATURE")
    objs = [arm] + [o for o in sc.objects if o.type == "MESH" and o.name in ("rishal", "rishal_accent")]
    ctx = SimpleNamespace(spec=R, info=SimpleNamespace(armature=arm), chains={}, skin=None)
    P = pipeline.paths(R)
    out = render.fighter_renders(ctx, objs, P, None, fast=a.fast, only=set(a.only.split(",")), scale=a.scale)
    print("[rishal_hero]", out)


if __name__ == "__main__":
    main()
