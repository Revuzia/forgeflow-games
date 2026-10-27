"""shieldwick motion check (no sculpt, no bake: seconds): the rig + bespoke clips solved in Blender, printed per frame.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/wick_shieldwick_motion.py -- [--faction aubade|serenade]

run      per frame: ankle z / ball z / ankle y per foot (the three.js gate wants >= 2 consecutive contact frames with
         the ankle level within 3 mm and the ball on the ground), the bell hem's lowest point (hips-bound)
death    hem lowest point per key frame
attack1  the lantern core (prop.R + 0.178 m up the haft) per frame: y forward (-Y), z up
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace

import bpy  # noqa: F401
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "units"))
from common import anim, rig, scene  # noqa: E402
from mathutils import Vector as V  # noqa: E402
import wick_shieldwick as sw  # noqa: E402


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--faction", default="aubade")
    a = ap.parse_args(scene.script_args())
    spec = sw.Shieldwick.__new__(sw.Shieldwick)          # skip __init__ (plate grading)
    spec.faction = a.faction
    spec.F = sw.FACTION[a.faction]
    spec.H = 1.1
    spec.PROPORTIONS = rig.proportions(**sw.PROPORTIONS_KW)
    scene.reset()
    col = scene.collection("motion")
    info = rig.build_rig(spec.PROPORTIONS, name="m_rig", col=col)
    ctx = SimpleNamespace(info=info, col=col)
    spec.rig_extras(ctx)
    clips = spec.clip_overrides(ctx)
    skel = anim.Skeleton(info.armature)
    hips_rest_inv = skel.rest["hips"].inverted()
    # hem samples (bind): the bell's bottom ring
    hem_z = {"aubade": 0.100, "serenade": 0.115}[a.faction]
    hem_r = {"aubade": (0.262, 0.216), "serenade": (0.290, 0.214)}[a.faction]
    ph = np.linspace(0, 2 * np.pi, 48, endpoint=False)
    hem = [V((hem_r[0] * np.cos(p), 0.015 + hem_r[1] * np.sin(p), hem_z)) for p in ph]

    def solve(clip, t):
        pose = anim.resolve(skel, clip.sample(t))
        return skel.fk(pose)

    c, n, tt, up = sw.shield_frame(spec.F)
    rim = [V(tuple(c + spec.F["shield_r"] * (np.cos(p) * tt + np.sin(p) * up))) for p in ph]
    rim += [V(tuple(c + n * 0.083)), V(tuple(c - n * 0.036))]           # the boss crown and the strap pad
    hand_rest_inv = skel.rest["hand.L"].inverted()

    def hem_min(M):
        T = M["hips"] @ hips_rest_inv
        Ts = M["hand.L"] @ hand_rest_inv
        return min(min((T @ p).z for p in hem), min((Ts @ p).z for p in rim))

    # the shield's rib direction (prop.L local +Z) at rest and through idle / run: degrees from vertical in the front view
    def rib_tilt(M):
        z = M["prop.L"].to_3x3().col[2]
        return float(np.degrees(np.arctan2(z.x, z.z)))
    idle = clips["idle"]
    print("SHIELD rib tilt (deg from vertical, front view): idle " +
          " ".join(f"{rib_tilt(solve(idle, f / 8)):+.0f}" for f in range(8)) +
          " | run " + " ".join(f"{rib_tilt(solve(clips["run"], f / clips["run"].frames)):+.0f}" for f in range(clips["run"].frames)))
    run = clips["run"]
    print(f"RUN {a.faction}: {run.frames} f")
    for f in range(run.frames + 1):
        M = solve(run, f / run.frames)
        row = []
        for s in ("L", "R"):
            an = M[f"foot.{s}"].translation
            ball = M[f"toe.{s}"].translation
            row.append(f"{s} {an.z:.3f}/{ball.z:.3f}/{an.y:+.3f}")
        print(f"  f{f:2d} " + "  ".join(row) + f"  hem {hem_min(M):+.3f}")
    att = clips["attack1"]
    core, top = {"aubade": (0.178, 0.345), "serenade": (0.146, 0.278)}[a.faction]
    print(f"ATTACK1 lantern core y (fwd -) / core z / lamp top z / hem+shield min:")
    out = []
    for f in range(att.frames + 1):
        M = solve(att, f / att.frames)
        c = M["prop.R"] @ V((0.0, core, 0.0))
        tp = M["prop.R"] @ V((0.0, top, 0.0))
        out.append(f"f{f}:{c.x:+.2f}/{c.y:+.2f}/{c.z:.2f}/{tp.z:.2f}/{hem_min(M):+.3f}")
    print("  " + " ".join(out))
    de = clips["death"]
    out = []
    for f in range(0, de.frames + 1, 4):
        M = solve(de, f / de.frames)
        Ts = M["hand.L"] @ hand_rest_inv
        out.append(f"f{f}:{hem_min(M):+.3f}/boss{(Ts @ rim[-2]).z:+.3f}")
    print("DEATH hem+shield min / boss crown z: " + " ".join(out))


main()
