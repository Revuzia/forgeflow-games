#!/usr/bin/env python3
"""Per-display-frame node steps of a shipped fighter GLB clip (closing review VAS-M1 / VAS-M2), without Blender.

    python3 art/tools/clip_steps.py art/out/fighters/vashil/vashil.glb --clip cast_a1 --speed 1.67 \
        [--nodes x_rod_head,hand.R,head,x_halo] [--hz 60] [--limit 0.3] [--all]
    python3 art/tools/clip_steps.py art/out/fighters/vashil/vashil.glb --clip recall --range

The clip is sampled the way the game plays it: one sample per display frame (--hz) with the clip advancing --speed x
real time (a cast plays at impactTime / castTime). Prints the largest step of each node between two display frames
(m), the frame it happens on, the lowest y of each node, and with --all every frame. --range prints each node's
largest distance from frame 0 (a 'does the loop move anything' check). Exit 1 when a step exceeds --limit (if given).
Pure python + numpy (shares chain_motion's GLB reader).
"""
import argparse
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chain_motion import Rig  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb")
    ap.add_argument("--clip", required=True)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--hz", type=float, default=60.0)
    ap.add_argument("--nodes", default="x_rod_head,hand.R,hand.L,forearm.L,head,chest,x_halo")
    ap.add_argument("--limit", type=float, default=None)
    ap.add_argument("--from", dest="t0", type=float, default=0.0, help="start (clip seconds)")
    ap.add_argument("--to", dest="t1", type=float, default=None, help="end (clip seconds)")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--range", action="store_true")
    a = ap.parse_args()
    rig = Rig(a.glb)
    ch, dur = rig.clip(a.clip)
    names = [n for n in a.nodes.split(",") if n in rig.name]
    dt = a.speed / a.hz
    t1 = dur if a.t1 is None else a.t1
    ts = list(np.arange(a.t0, t1 + 1e-9, dt))
    P = []
    for t in ts:
        W = rig.pose(ch, float(t))
        P.append({n: W[rig.name[n]][:3, 3].copy() for n in names})
    print(f"# {a.glb} clip {a.clip} {dur:.3f} s, speed {a.speed}x, {a.hz:.0f} Hz display frames ({len(ts)} samples)")
    fail = False
    for n in names:
        steps = [float(np.linalg.norm(P[i][n] - P[i - 1][n])) for i in range(1, len(P))]
        k = int(np.argmax(steps)) if steps else 0
        ymin = min(float(p[n][1]) for p in P)
        far = max(float(np.linalg.norm(p[n] - P[0][n])) for p in P)
        bad = a.limit is not None and steps and steps[k] > a.limit
        fail |= bool(bad)
        print(f"  {n:12s} max step {steps[k] if steps else 0:.3f} m at display f{k + 1} (clip {ts[k + 1] * 30 if steps else 0:.1f})"
              f"  y min {ymin:+.3f}" + (f"  max dist from f0 {far:.3f}" if a.range else "") + ("  FAIL" if bad else ""))
    if a.all:
        for i in range(1, len(P)):
            print(f"  d{i:3d} clip f{ts[i] * 30:5.1f} " + " ".join(
                f"{n}:{np.linalg.norm(P[i][n] - P[i - 1][n]):.3f}" for n in names)
                + (f" rodY {P[i]['x_rod_head'][1]:+.3f}" if "x_rod_head" in P[i] else ""))
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
