"""greatwick motion probe: regenerates the clips from the CURRENT module against the build's cached rig + mesh
(art/.cache/fighters/greatwick_<faction>.blend) and measures them at the exported key times (30 fps), so the
attack / death timing is tuned in seconds instead of full rebuilds:

  * the hammer head and pommel centroids per key, the head's step (m) and speed (m/s) per 33 ms key;
  * the largest LOCAL bone rotation step per key (deg) and which bone (IK flips show up here);
  * the haft line (pommel -> head) tested against the posed cloak / mantle / stole (inside points);
  * the lowest point of the body and of the hammer per key; the hips' vertical step (hops).

    /Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/proto/wick_greatwick_motion.py -- \
        --faction aubade [--clips attack1,death] [--quiet]
"""
from __future__ import annotations

import math
import os
import sys
import types

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
from common import scene  # noqa: E402


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="aubade")
    p.add_argument("--clips", default="attack1,death")
    p.add_argument("--quiet", action="store_true")
    return p.parse_args(scene.script_args())


def quat(e):
    from mathutils import Euler
    return Euler([math.radians(a) for a in e], "XYZ").to_quaternion()


def main():
    a = args()
    sid = f"greatwick_{a.faction}"
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", f"{sid}.blend"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    import wick_greatwick as gw
    from common import anim
    spec = gw.Greatwick(a.faction)
    ctx = types.SimpleNamespace(info=types.SimpleNamespace(armature=arm))
    clips = gw.motion_clips(ctx, spec)
    GR = gw._Ground(ctx, spec)
    head = GR.sel("hammer_head")
    pom = GR.sel("pommel")
    ham = GR.sel(*gw.HAMMER_PARTS)
    body = ~GR.sel(*gw.HAMMER_PARTS)
    # the cloak shell's triangles (main object only: its vertices come first in GR.V)
    ob = bpy.data.objects.get(spec.ID)
    me = ob.data
    me.calc_loop_triangles()
    tri = np.array([t.vertices[:] for t in me.loop_triangles], np.int64)
    shell = GR.sel("cloak", "mantle", "stole")
    tri = tri[shell[tri].all(1)]
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree
    for name in a.clips.split(","):
        clip = clips[name]
        N = clip.frames
        poses = [anim.resolve(GR.skel, clip.sample(f / N)) for f in range(N + 1)]
        H, Pm, steps, rot, lo_b, lo_h, hz, inside = [], [], [], [], [], [], [], []
        for f, p in enumerate(poses):
            X = GR.points(p)
            H.append(X[head].mean(0))
            Pm.append(X[pom].mean(0))
            lo_b.append(float(X[body][:, 2].min()))
            lo_h.append(float(X[ham][:, 2].min()))
            hz.append(p.get("hips_loc", (0, 0, 0))[2])
            if f:
                worst = (0.0, "")
                for b in GR.skel.order:
                    e0, e1 = poses[f - 1].get(b), p.get(b)
                    if e0 is None and e1 is None:
                        continue
                    q0, q1 = quat(e0 or (0, 0, 0)), quat(e1 or (0, 0, 0))
                    ang = math.degrees(q0.rotation_difference(q1).angle)
                    ang = min(ang, 360 - ang)
                    if ang > worst[0]:
                        worst = (ang, b)
                rot.append(worst)
            else:
                rot.append((0.0, ""))
            # haft inside the cloak shell: 9 points between 15 % and 85 % of pommel -> head
            bvh = BVHTree.FromPolygons([Vector(v) for v in X[:len(me.vertices)]], tri.tolist())
            n_in = 0
            for s in np.linspace(0.15, 0.85, 9):
                q = Vector(Pm[-1] + (H[-1] - Pm[-1]) * s)
                loc, nrm, _, dist = bvh.find_nearest(q)
                if loc is not None and (q - loc).dot(nrm) < -0.005:
                    n_in += 1
            inside.append(n_in)
        H, Pm = np.array(H), np.array(Pm)
        st = np.r_[0.0, np.linalg.norm(np.diff(H, axis=0), axis=1)]
        print(f"== {sid} {name}: {N} frames ({N / anim.FPS:.2f} s), impact {clip.impact}")
        for f in range(N + 1):
            if a.quiet and st[f] < 0.25 and rot[f][0] < 45 and not inside[f]:
                continue
            print(f"  t={f / anim.FPS:.3f} head ({H[f][0]:+.2f},{H[f][1]:+.2f},{H[f][2]:+.2f}) step {st[f]:.3f} m "
                  f"({st[f] * anim.FPS:5.1f} m/s)  rot {rot[f][0]:5.1f} {rot[f][1]:<12s} body {lo_b[f]:+.3f} "
                  f"hammer {lo_h[f]:+.3f} hips z {hz[f]:+.3f} haft-in-cloak {inside[f]}")
        imp = int(round((clip.impact or 0) * N))
        if clip.impact:
            wind = st[1:imp + 1]
            strike = st[max(1, imp - 2):imp + 1]
            print(f"  SUMMARY wind-up max step {wind.max():.3f} m (key {int(np.argmax(wind)) + 1}), mean {wind.mean():.3f};"
                  f" last 2 keys into impact {strike.tolist()}; follow max {st[imp + 1:].max():.3f}")
        print(f"  SUMMARY max step {st.max():.3f} m at f{int(np.argmax(st))}, max rot {max(r[0] for r in rot):.1f} deg "
              f"({max(rot)[1]}), haft-in-cloak keys {sum(1 for i in inside if i)}, body min {min(lo_b):+.3f}, "
              f"hammer min {min(lo_h):+.3f}, hips max step {np.abs(np.diff(hz)).max():.3f}")


if __name__ == "__main__":
    main()
