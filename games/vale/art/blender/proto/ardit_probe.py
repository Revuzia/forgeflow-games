"""Ardit clip probe on the build's cached .blend: re-samples the CURRENT clip code (chains included) and prints, per
(clip, t), where the held items stand (the pavise foot and spire tip, the spear butt and tip, the fists) and how far
each fist is turned on its forearm against the bind pose (the review's wrist-twist check).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/ardit_probe.py -- \\
        --at "victory:1.0,cast_a3:0.4,run:0.25"
"""
from __future__ import annotations

import importlib.util
import math
import os
import sys
from types import SimpleNamespace

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import anim, scene  # noqa: E402


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--at", required=True)
    a = ap.parse_args(scene.script_args())
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "ardit.blend"))
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    spec = importlib.util.spec_from_file_location("ardit_spec", os.path.join(os.path.dirname(HERE), "fighters", "ardit.py"))
    K = importlib.util.module_from_spec(spec)
    sys.modules["ardit_spec"] = K
    spec.loader.exec_module(K)
    at = [(c.split(":")[0], float(c.split(":")[1])) for c in a.at.split(",")]
    ctx = SimpleNamespace(info=SimpleNamespace(armature=arm), chains={})
    for s_ in ("l", "r"):
        ctx.chains[f"tabard_{s_}"] = sorted(b.name for b in arm.data.bones if b.name.startswith(f"x_tabard_{s_}_"))
    clips = {k: c for k, c in K.clip_overrides(ctx).items() if k in {c for c, _ in at}}
    anim.write_clips(arm, clips, K.chain_config(ctx))
    F_L, F_R = Vector(tuple(K.F_L)), Vector(tuple(K.F_R))
    pav = {"foot": Vector(K.PAV_FOOT_L),
           "spire": Vector((K.SPIRE_X - 0.01 - K.F_L[0], 2.15 - K.F_L[2], -(K.PAV_Y - K.F_L[1]))),
           "top": Vector((-0.10, K.PAV_TOP_Y, -(K.PAV_Y - K.F_L[1])))}
    spr = {"butt": Vector((0.0, -K.SPEAR_BUTT, 0.0)), "tip": Vector((0.0, K.SPEAR_S["tip"], 0.0))}

    def rest_rel(a_, b_):
        return arm.data.bones[a_].matrix_local.inverted() @ arm.data.bones[b_].matrix_local

    for clip, t in at:
        act = bpy.data.actions[clip]
        f0, f1 = act.frame_range
        anim.set_action_frame(arm, clip, f0 + t * (f1 - f0))
        pb = arm.pose.bones
        out = [f"{clip}@{t:.2f}"]
        Mx = pb["x_pavise"].matrix
        for nm, v in pav.items():
            w = Mx @ v
            out.append(f"pav_{nm}=({w.x:+.3f},{w.y:+.3f},{w.z:+.3f})")
        Ms = pb["x_spear"].matrix
        for nm, v in spr.items():
            w = Ms @ v
            out.append(f"spear_{nm}=({w.x:+.3f},{w.y:+.3f},{w.z:+.3f})")
        for s_ in ("L", "R"):
            fist = pb[f"prop.{s_}"].matrix.translation
            rel = pb[f"forearm.{s_}"].matrix.inverted() @ pb[f"hand.{s_}"].matrix
            d = rest_rel(f"forearm.{s_}", f"hand.{s_}").to_quaternion().rotation_difference(rel.to_quaternion())
            out.append(f"fist{s_}=({fist.x:+.3f},{fist.y:+.3f},{fist.z:+.3f}) twist{s_}={math.degrees(d.angle):.0f}")
        out.append(f"xpav_loc={tuple(round(c, 3) for c in pb['x_pavise'].location)} "
                   f"xpav_rot={tuple(round(math.degrees(c)) for c in pb['x_pavise'].rotation_euler)} "
                   f"xspr_loc={tuple(round(c, 3) for c in pb['x_spear'].location)}")
        for s_ in ("l", "r"):
            bn = ctx.chains[f"tabard_{s_}"][0]
            th = pb[f"thigh.{s_.upper()}"]
            out.append(f"tab_{s_}={math.degrees(pb[bn].rotation_euler.x):.0f} thigh_{s_}={math.degrees(th.rotation_euler.x):.0f}")
        print("PROBE " + "  ".join(out))


if __name__ == "__main__":
    main()
