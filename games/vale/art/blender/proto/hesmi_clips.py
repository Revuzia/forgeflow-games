"""Hesmi clip loop (fix pass): re-author the clips on the CACHED build without re-sculpting or re-baking.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/hesmi_clips.py -- [--out art/.cache/hesmi_clips.glb]
    node art/.cache/hesmi_measure.mjs art/.cache/hesmi_clips.glb [clip,...] [--v]        # ground / reach / stretch

Opens art/.cache/fighters/hesmi.blend (written by `art/build.py fighter hesmi`), regenerates every clip from
art/blender/fighters/hesmi.py (clip_overrides + the standard generators), writes the actions and exports an
unoptimised GLB for the measuring script and three_snapshot.mjs (--unit --cam yaw,pitch). The shipped files are
untouched: the real build re-runs the same code.
"""
from __future__ import annotations

import importlib.util
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402

from common import anim, export, rig, scene  # noqa: E402
from common.fighter import Context  # noqa: E402


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(scene.CACHE_DIR, "hesmi_clips.glb"))
    ap.add_argument("--only", default="", help="comma list: export just these clips (faster sheets)")
    a = ap.parse_args(scene.script_args())
    path = os.path.join(scene.BLENDER_DIR, "fighters", "hesmi.py")
    s = importlib.util.spec_from_file_location("fighter_hesmi", path)
    spec = importlib.util.module_from_spec(s)
    s.loader.exec_module(spec)
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "hesmi.blend"))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    ctx = Context(spec=spec)
    ctx.info = rig.RigInfo(armature=arm, props=spec.PROPORTIONS)
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    overrides = spec.clip_overrides(ctx)
    clips = anim.standard_clips(anim.Skeleton(arm), spec.MOTION, overrides)
    if a.only:
        clips = {k: v for k, v in clips.items() if k in a.only.split(",")}
    info = anim.write_clips(arm, clips, [])
    objs = [arm] + [o for o in bpy.context.scene.objects if o.type == "MESH" and o.parent == arm and not o.hide_render]
    export.export_glb(objs, a.out, animations=True)
    for k, v in info.items():
        print(f"[hesmi-clips] {k}: {v['frames']} f, impact {v['impact']}")
    print(f"[hesmi-clips] wrote {a.out}")


if __name__ == "__main__":
    main()
