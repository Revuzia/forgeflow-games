"""Burdam render preview from the cached build (art/.cache/fighters/burdam.blend): the shipped renders' code
(render.fighter_renders with this module's wrappers) re-run on the cache with the CURRENT clips, at a preview
scale, without a rebuild. For iterating on the portrait / icon / splash camera and lighting.

    Blender -b --factory-startup --python art/blender/proto/burdam_render.py -- [--only portrait,icon] [--scale 0.5]
        [--fast]

Writes art/renders/fighters/burdam/preview_<name>.png (the shipped files are untouched).
"""
from __future__ import annotations

import os
import sys
import types

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
sys.path.insert(0, BL)
sys.path.insert(0, os.path.join(BL, "fighters"))
sys.path.insert(0, HERE)


def main():
    import argparse
    from common import scene
    p = argparse.ArgumentParser()
    p.add_argument("--only", default="portrait,icon")
    p.add_argument("--scale", type=float, default=0.5)
    p.add_argument("--fast", action="store_true")
    a = p.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "burdam.blend"))
    from common import render
    import burdam as F
    F._install_aim_roll()
    F._install_render_specular()
    F._install_portrait_rim()
    F._install_icon()
    arm = bpy.data.objects["burdam_rig"]
    objs = [arm, bpy.data.objects["burdam"], bpy.data.objects["burdam_accent"]]
    ctx = types.SimpleNamespace(info=types.SimpleNamespace(armature=arm, props=F.PROPORTIONS, joints={}), spec=F,
                                chains={}, skin=None)
    P = {"renders": os.path.join(scene.RENDERS_DIR, "fighters", "burdam"),
         "out": os.path.join(scene.RENDERS_DIR, "fighters", "burdam", "_preview_out")}
    os.makedirs(P["out"], exist_ok=True)
    r = render.fighter_renders(ctx, objs, P, None, fast=a.fast, only=set(a.only.split(",")), scale=a.scale)
    print("renders:", r)


if __name__ == "__main__":
    main()
