"""Odrum clip check: re-runs fighters/odrum.py clip_overrides on the CACHED skinned build (art/.cache/fighters/
odrum.blend) and measures every clip frame by frame on the deformed mesh, in seconds instead of a full build.

    /Applications/Blender.app/Contents/MacOS/Blender -b art/.cache/fighters/odrum.blend --python \
        art/blender/proto/odrum_clipcheck.py -- [--clips cast_a1,attack1] [--step 1] [--dump out.npz]

Per frame: the lowest point of each body group (ground penetration), pot penetration (body vertices inside
each pot's belly cylinder, and inside it grown by 4 cm), staff penetration of the head/neck and of the torso and
arms (vertices within the bar's radius of its axis), and the sling pouch's position (the lob origin).
`--dump` writes a downsampled vertex cloud per sampled frame (+ group ids) for proto/odrum_clipsheet.py.
The rest pose must match the cache (rig_extras unchanged since the last full build).
"""
from __future__ import annotations

import argparse
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "fighters"))
from common import anim, scene  # noqa: E402

import odrum  # noqa: E402

GROUPS = ["head", "torso", "armL", "armR", "handL", "handR", "hips", "shin", "foot", "staff", "potL", "potR", "other"]


def group_of(b: str) -> str:
    if b in ("head", "neck"):
        return "head"
    if b in ("chest", "spine") or b.startswith("shoulder"):
        return "torso"
    if b.startswith(("upper_arm", "forearm")):
        return "armL" if b.endswith(".L") else "armR"
    if b.startswith("hand"):
        return "handL" if b.endswith(".L") else "handR"
    if b == "hips" or b.startswith("thigh"):
        return "hips"
    if b.startswith("shin"):
        return "shin"
    if b.startswith(("foot", "toe")):
        return "foot"
    if b.startswith("prop") or b in ("x_sling_pouch", "x_pellet"):
        return "staff"
    if b in ("x_hang_l", "x_pot_l"):
        return "potL"
    if b in ("x_hang_r", "x_pot_r"):
        return "potR"
    return "other"


def classify(ob) -> np.ndarray:
    names = [g.name for g in ob.vertex_groups]
    out = np.zeros(len(ob.data.vertices), dtype=np.int32)
    for v in ob.data.vertices:
        best, bw = None, -1.0
        for g in v.groups:
            if g.weight > bw:
                best, bw = names[g.group], g.weight
        out[v.index] = GROUPS.index(group_of(best or ""))
    return out


class Ctx:
    pass


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--clips", default="")
    p.add_argument("--step", type=int, default=1)
    p.add_argument("--dump", default="")
    p.add_argument("--every", type=int, default=3, help="vertex downsample for the dump")
    a = p.parse_args(scene.script_args())
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
    cls = np.concatenate([classify(o) for o in meshes])
    ctx = Ctx()
    ctx.info = Ctx()
    ctx.info.armature = arm
    overrides = odrum.clip_overrides(ctx)
    skel = anim.Skeleton(arm)
    clips = anim.standard_clips(skel, odrum.MOTION, overrides)
    want = [c for c in a.clips.split(",") if c] or list(clips)
    G = {g: i for i, g in enumerate(GROUPS)}
    dump = {}
    x0, x1 = odrum.STAFF_X
    s0, s1 = (x0 - odrum.GRIP_R[0]) / odrum.STAFF_AX[0], (x1 - odrum.GRIP_R[0]) / odrum.STAFF_AX[0]
    summary = {}
    for name in want:
        clip = clips[name]
        poses = anim.sample_clip(skel, clip, None)
        print(f"\n== {name} ({clip.frames} f, impact {clip.impact})")
        worst = {"potIn": 0, "potNear": 0, "staffHead": 0, "staffBody": 0, "low": 9.0}
        for f in range(0, len(poses), a.step):
            anim.apply_pose(arm, poses[f])
            bpy.context.view_layer.update()
            dg = bpy.context.evaluated_depsgraph_get()
            V = []
            for o in meshes:
                oe = o.evaluated_get(dg)
                me = oe.to_mesh()
                co = np.empty(len(me.vertices) * 3, dtype=np.float64)
                me.vertices.foreach_get("co", co)
                co = co.reshape(-1, 3)
                M = np.array(o.matrix_world)
                V.append(co @ M[:3, :3].T + M[:3, 3])
                oe.to_mesh_clear()
            V = np.concatenate(V)
            pb = arm.pose.bones
            Mw = np.array(arm.matrix_world)

            def bone_mat(n):
                return Mw @ np.array(pb[n].matrix)
            lows = {g: float(V[cls == G[g], 2].min()) for g in ("foot", "shin", "hips", "potL", "potR", "staff", "torso")
                    if (cls == G[g]).any()}
            body = np.isin(cls, [G[g] for g in ("head", "torso", "armL", "armR", "hips", "shin", "handL")])
            pots = {}
            for side, g in (("l", "potL"), ("r", "potR")):
                B = bone_mat(f"x_hang_{side}")
                h = B[:3, 3]
                ax = B[:3, 1] / np.linalg.norm(B[:3, 1])
                d = V[body] - h
                t = d @ ax
                rad = np.linalg.norm(d - t[:, None] * ax, axis=1)
                L = pb[f"x_hang_{side}"].length
                inz = (t > L - 0.135) & (t < L + 0.135)
                pots[side] = (int(((rad < 0.122) & inz).sum()), int(((rad < 0.162) & inz).sum()))
            Bp = bone_mat("prop.R")
            g0, sx = Bp[:3, 3], Bp[:3, 1] / np.linalg.norm(Bp[:3, 1])

            hits = []

            def near_staff(mask, r):
                d = V[mask] - g0
                t = d @ sx
                rad = np.linalg.norm(d - t[:, None] * sx, axis=1)
                h = (t > s0) & (t < s1) & (rad < r)
                if h.any():
                    hits.append(V[mask][h].mean(axis=0))
                return int(h.sum())
            sh = near_staff(cls == G["head"], 0.03)
            sb = near_staff(np.isin(cls, [G["torso"], G["armL"], G["hips"]]), 0.03)
            for side in ("l", "r"):
                B = bone_mat(f"x_hang_{side}")
                h, ax = B[:3, 3], B[:3, 1] / np.linalg.norm(B[:3, 1])
                d = V[body] - h
                t = d @ ax
                rad = np.linalg.norm(d - t[:, None] * ax, axis=1)
                L = pb[f"x_hang_{side}"].length
                m = (rad < 0.122) & (t > L - 0.135) & (t < L + 0.135)
                if m.any():
                    gs = np.bincount(cls[body][m], minlength=len(GROUPS))
                    hits.append(f"pot{side}:" + ",".join(f"{GROUPS[i]}{n}" for i, n in enumerate(gs) if n))
            pouch = bone_mat("x_sling_pouch")[:3, 3]
            hips = bone_mat("hips")[:3, 3]
            low = min(lows.values())
            worst["potIn"] = max(worst["potIn"], pots["l"][0], pots["r"][0])
            worst["potNear"] = max(worst["potNear"], pots["l"][1], pots["r"][1])
            worst["staffHead"] = max(worst["staffHead"], sh)
            worst["staffBody"] = max(worst["staffBody"], sb)
            worst["low"] = min(worst["low"], low)
            below = " ".join(f"{k}:{v:+.3f}" for k, v in lows.items() if v < -0.01)
            print(f"f{f:3d} pouch=({pouch[0]:+.2f},{pouch[1]:+.2f},{pouch[2]:+.2f}) hips=({hips[0]:+.2f},{hips[1]:+.2f},{hips[2]:+.2f}) "
                  f"staffDir=({sx[0]:+.2f},{sx[1]:+.2f},{sx[2]:+.2f}) potL={pots['l']} potR={pots['r']} staffHead={sh} "
                  f"staffBody={sb} low={low:+.3f} {('BELOW ' + below) if below else ''} "
                  + " ".join(x if isinstance(x, str) else "hit@(%+.2f,%+.2f,%+.2f)" % tuple(x) for x in hits))
            if a.dump:
                dump[f"{name}/{f}"] = V[:: a.every].astype(np.float32)
        summary[name] = worst
    print("\nSUMMARY")
    for k, w in summary.items():
        print(f"  {k:11s} potIn {w['potIn']:4d} potNear {w['potNear']:4d} staffHead {w['staffHead']:4d} "
              f"staffBody {w['staffBody']:4d} low {w['low']:+.3f}")
    if a.dump:
        dump["_groups"] = cls[:: a.every]
        np.savez_compressed(a.dump, **dump)
        print("dump", a.dump)


main()
