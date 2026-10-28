"""Lisvel pose probe: evaluates clip poses on the cached rig (art/.cache/fighters/lisvel.blend) and prints where the
bow points (prop.L axes), the hands and the string nock, per key frame.

    /Applications/Blender.app/Contents/MacOS/Blender -b art/.cache/fighters/lisvel.blend --python art/blender/proto/lisvel_probe.py -- [clip ...]
"""
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import anim, scene  # noqa: E402
import lisvel  # noqa: E402


def main():
    args = scene.script_args()
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    skel = anim.Skeleton(arm)

    class Ctx:
        pass
    ctx = Ctx()
    ctx.info = type("I", (), {"armature": arm})()
    clips = lisvel.clip_overrides(ctx)
    names = args or ["idle", "attack1"]
    for nm in names:
        c = clips[nm]
        for f in sorted(set([0, int(c.frames * 0.26), int(c.frames * 0.36), int(round(c.frames * 0.4)), int(c.frames * 0.56), c.frames])):
            p = anim.resolve(skel, c.sample(f / c.frames))
            M = skel.fk(p)
            Mp = lisvel._prop_l(M, p)
            R = Mp.to_3x3()
            hr = M["prop.R"].translation
            print(f"{nm} f{f}: bowD {tuple(round(x, 2) for x in R.col[1])} bowU {tuple(round(x, 2) for x in R.col[2])} grip {tuple(round(x, 2) for x in Mp.translation)}"
                  f" pinch {tuple(round(x, 2) for x in hr)} chestF {tuple(round(x, 2) for x in (M['chest'].to_3x3().col[2]))} str {p.get('_str')} slide {p.get('_slide')}")


main()
