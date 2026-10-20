"""greatwick pose check: evaluates the built rig + mesh (the build's cached .blend) per clip frame and reports where
things land, so the clips are tuned on numbers, not on stills:
  * per frame: the lowest point of each part group (ground penetration), the hammer head centre and the haft
    direction (prop.R +Y), the lantern's tilt (chest +Z from vertical), the wrists' distance from their targets;
  * attack1 at the impact frame (40 %): the head must be high and in front; death's last frame: at rest on the
    ground (no part below -1 cm, the lantern touching).

    /Applications/Blender.app/Contents/MacOS/Blender -b --python art/blender/proto/wick_greatwick_pose.py -- --faction aubade [--clips attack1,death]
"""
from __future__ import annotations

import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import scene  # noqa: E402

GROUPS = {
    "lantern": ("lantern", "drum", "spires", "shelf", "lid", "frame_posts"),
    "hammer": ("hammer", "haft", "pommel", "grip"),
    "hood": ("hood", "knob", "crown_band", "seam"),
    "body": ("cloak", "stole", "mantle", "sleeve", "legs", "clasp"),
    "boots": ("boot",),
}


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--faction", default="aubade")
    p.add_argument("--clips", default="idle,run,attack1,death")
    p.add_argument("--frames", default="")
    return p.parse_args(scene.script_args())


def main():
    a = args()
    sid = f"greatwick_{a.faction}"
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", f"{sid}.blend"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.parent == arm and not o.hide_render]
    sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
    import wick_greatwick as gw
    names = [sp.name for sp in (gw.aubade_parts if a.faction == "aubade" else gw.serenade_parts)(gw.LAYOUT[a.faction])]
    sc = bpy.context.scene
    for clip in a.clips.split(","):
        act = bpy.data.actions.get(clip)
        if act is None:
            print("no action", clip)
            continue
        arm.animation_data_create()
        arm.animation_data.action = act
        f0, f1 = (int(v) for v in act.frame_range)
        frames = [int(x) for x in a.frames.split(",")] if a.frames else sorted(set(np.linspace(f0, f1, 7).round().astype(int).tolist() + ([f0 + round(0.4 * (f1 - f0))] if clip.startswith("attack") else [])))
        print(f"== {clip} frames {f0}..{f1}")
        for fr in frames:
            sc.frame_set(fr)
            dg = bpy.context.evaluated_depsgraph_get()
            low = {g: 9.0 for g in GROUPS}
            cen = {}
            allmin = 9.0
            for o in meshes:
                ev = o.evaluated_get(dg)
                me = ev.to_mesh()
                n = len(me.vertices)
                co = np.empty(n * 3, np.float32)
                me.vertices.foreach_get("co", co)
                co = co.reshape(n, 3) @ np.array(o.matrix_world)[:3, :3].T + np.array(o.matrix_world)[:3, 3]
                at = me.attributes.get("vale_part")
                pid = np.zeros(n, np.int64)
                if at is not None:
                    at.data.foreach_get("value", pid)
                allmin = min(allmin, float(co[:, 2].min()))
                for g, keys in GROUPS.items():
                    sel = np.zeros(n, bool)
                    for i, nm in enumerate(names):
                        if nm.startswith(keys):
                            sel |= pid == i
                    if o.name.endswith("_accent"):
                        sel &= False
                    if sel.any():
                        low[g] = min(low[g], float(co[sel, 2].min()))
                        if g in ("hammer",):
                            hs = np.zeros(n, bool)
                            hs |= pid == names.index("hammer_head")
                            if hs.any():
                                cen["head"] = co[hs].mean(0)
                ev.to_mesh_clear()
            pb = arm.pose.bones
            M = arm.matrix_world
            pr = M @ pb["prop.R"].matrix
            axis = np.array(pr.to_3x3().col[1])
            ch = (M @ pb["chest"].matrix).to_3x3()
            tilt = math.degrees(math.acos(max(-1, min(1, np.array(ch.col[1]) @ np.array([0, 0, 1.0])))))
            hd = cen.get("head", np.zeros(3))
            print(f"  f{fr:3d} min {allmin:+.3f}  " + " ".join(f"{g}:{v:+.2f}" for g, v in low.items()) +
                  f"  head ({hd[0]:+.2f},{hd[1]:+.2f},{hd[2]:+.2f}) haft ({axis[0]:+.2f},{axis[1]:+.2f},{axis[2]:+.2f})  chest tilt {tilt:4.1f}")


if __name__ == "__main__":
    main()
