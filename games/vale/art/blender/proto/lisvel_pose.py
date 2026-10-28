"""Lisvel pose probe on a fresh rig (no sculpt, seconds): for key frames of every clip, where the bow's tips, the string,
the hands and the head are, the string's clearance from the face, and the bow's read at the game camera in the four
facings (screen px at 1080p: x = 82.1 px/m, up = 50.5 px/m of height + 64.7 px/m of depth; HP bar bottom ~103 px).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/lisvel_pose.py -- [clip ...]
"""
import math
import os
import sys

import bpy  # noqa: F401
import numpy as np
from mathutils import Vector as V

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import anim, rig, scene  # noqa: E402
import lisvel as L  # noqa: E402

HP = (1.94 + 0.35) * 50.5 - 12


def seg_pt_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.dot(ab), 1e-9)))
    return (p - (a + ab * t)).length


def main():
    args = scene.script_args()
    scene.reset()
    col = scene.collection("lisvel")

    class Ctx:
        pass
    ctx = Ctx()
    ctx.spec = L
    ctx.info = rig.build_rig(L.PROPORTIONS, name="lisvel_rig", col=col)
    L.rig_extras(ctx)
    skel = anim.Skeleton(ctx.info.armature)
    clips = L.clip_overrides(ctx)
    rest_p = skel.rest["prop.L"].inverted()
    rest_h = skel.rest["head"].inverted()
    us = np.linspace(-L.TIP_U, L.TIP_U, 61)
    bow_rest = [V(tuple(L.bow_pt(u))) for u in us]
    tipL0, tipR0 = V(tuple(L.TIP_L)), V(tuple(L.TIP_R))
    face0 = [V((0.0, -0.137, L.VIS_Z)), V((0.0, -0.106, 1.69)), V((0.0, -0.10, 1.65)), V((0.06, -0.12, L.VIS_Z)),
             V((-0.06, -0.12, L.VIS_Z))]
    names = args or ["idle", "run", "attack1", "attack2", "cast_a1", "cast_ult", "channel", "victory"]
    for nm in names:
        c = clips[nm]
        fr = sorted(set([0, int(c.frames * 0.10), int(c.frames * 0.26), int(c.frames * 0.36), int(round(c.frames * 0.4)),
                         int(c.frames * 0.56), int(c.frames * 0.8), c.frames]))
        if nm in ("idle", "run"):
            fr = [0, c.frames // 4, c.frames // 2]
        for f in fr:
            p = anim.resolve(skel, c.sample(f / c.frames))
            M = skel.fk(p)
            Mp = L._prop_l(M, p)
            Wp = Mp @ rest_p
            tl, tr = Wp @ tipL0, Wp @ tipR0
            nock = M["prop.R"].translation if L._ch(p, "_str") > 0.5 else (Wp @ V(tuple(L.S0)))
            Wh = M["head"] @ rest_h
            face = [Wh @ q for q in face0]
            cl = [min(seg_pt_dist(q, tl, nock), seg_pt_dist(q, nock, tr)) for q in face]
            clear = min(cl)
            ci = ["visor", "face", "lips", "visL", "visR"][cl.index(clear)]
            hd = M["head"].translation
            hr = M["prop.R"].translation
            pts = [Wp @ q for q in bow_rest]
            line = (f"{nm:10s} f{f:3d}: tipL ({tl.x:+.2f},{tl.y:+.2f},{tl.z:.2f}) tipR ({tr.x:+.2f},{tr.y:+.2f},{tr.z:.2f}) "
                    f"chord {(tl - tr).length:.2f} str_z {(tl.z + tr.z) / 2:.2f} pinch ({hr.x:+.2f},{hr.y:+.2f},{hr.z:.2f}) "
                    f"head ({hd.x:+.2f},{hd.y:+.2f},{hd.z:.2f}) str-face {clear * 100:.0f}cm@{ci}")
            if nm == "victory":
                ve = Wh @ V((-0.098, -0.110, L.VIS_Z))
                hb = M["hand.R"]
                tipw = hb.translation + hb.to_3x3().col[1].normalized() * 0.11
                line += f" visR->handtip {(ve - tipw).length * 100:.0f}cm handdir {tuple(round(x, 2) for x in hb.to_3x3().col[1])}"
            if nm in ("idle", "run") or f == int(round(c.frames * 0.4)):
                rd = []
                for fc in (0, 90, 180, 270):
                    a = math.radians(fc)
                    ca, sa = math.cos(a), math.sin(a)
                    xs = np.array([(ca * q.x - sa * q.y) * 82.1 for q in pts])
                    ys = np.array([q.z * 50.5 + (sa * q.x + ca * q.y) * 64.7 for q in pts])
                    sl = math.degrees(math.atan2(abs(ys[-1] - ys[0]), abs(xs[-1] - xs[0]) + 1e-6))
                    rd.append(f"f{fc}: w{xs.max() - xs.min():.0f} top{ys.max():.0f}{'!' if ys.max() > HP else ''} sl{sl:.0f}")
                line += "\n            " + " | ".join(rd)
            print(line)


main()
