"""HIT PARADE - facing diagnostics for the CMU entries of a clip plan (lane ASSETS, part 2).

  python tools/cmu_facing_check.py johnny bruno ...        (plain python + numpy, no Blender)

For every CMU source used by the fighter plans (top-level, layer parts, seq segments) prints the
horizontal facing candidates at the contact frame, as angles (deg) relative to the rule
tools/cmu_retarget.py applies today (kind hand: chest -> fist; foot/knee: hips -> foot/knee):
  guard   mean(hips -> mid hands) over the window (what the idle uses)
  pelvis  the pelvis forward normal at contact
  chest   the shoulder-line forward normal at contact
  reach   the direction from the chest to the fist at its farthest-from-chest frame in [c-8, c+3]
A hook / uppercut contact taken off-centre shows up as a large |rule - guard| angle.
speed_decl / speed_other: peak speed (m/s, 120 fps source) of the declared limb and of the same limb
on the other side in [c-16, c+4]; LIMB? = the other side is > 1.5x faster (wrong / mirrored limb).
ASCII only.
"""
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "research"))
import bvh_lib as B  # noqa: E402

DATA = "F:/games/forgeflow-games-assets/_downloaded/cmu-mocap/cmu-mocap-master/data"
GAME = os.path.dirname(HERE)


def take_path(take):
    return "%s/%03d/%s.bvh" % (DATA, int(take.split("_")[0]), take)


def ang(v):
    return math.degrees(math.atan2(v[1], v[0]))


def hd(v):
    v = np.array([v[0], v[1], 0.0])
    return v / (np.linalg.norm(v) + 1e-12)


def dang(a, b):
    d = (a - b + 180.0) % 360.0 - 180.0
    return round(d, 1)


def mirror(d):
    S = np.diag([-1.0, 1.0, 1.0])
    names = d["names"]
    idx = d["idx"]

    def sw(n):
        for a, b in (("Left", "Right"), ("LHip", "RHip"), ("LThumb", "RThumb")):
            if n.startswith(a):
                return b + n[len(a):]
            if n.startswith(b):
                return a + n[len(b):]
        return n
    perm = [idx[sw(n)] for n in names]
    return np.einsum("ij,fkj->fki", S, d["pos"][:, perm])


_cache = {}


def facing(e):
    key = (e["file"], bool(e.get("mirror")))
    if key not in _cache:
        d = B.load_blender(take_path(e["file"]))
        pos = mirror(d) if e.get("mirror") else d["pos"]
        _cache[key] = (d["idx"], pos)
    I, pos = _cache[key]
    s, t = e["range"]
    c = e.get("contact")
    c = int(c) if isinstance(c, (int, float)) else (s + t) // 2
    kind = e.get("kind", "getup")
    limb = e.get("limb", "body")
    S = "Left" if limb.startswith("L") else "Right"
    if kind == "hand":
        rule = hd(pos[c, I[S + "HandIndex1_End"]] - pos[c, I["Spine1"]])
    elif kind in ("foot", "knee"):
        rule = hd(pos[c, I[S + ("Foot" if kind == "foot" else "Leg")]] - pos[c, I["Hips"]])
    else:
        rule = None
    mid = (pos[s:t + 1, I["LeftHand"]] + pos[s:t + 1, I["RightHand"]]) / 2.0
    guard = hd((mid - pos[s:t + 1, I["Hips"]]).mean(axis=0))
    up = np.array([0, 0, 1.0])
    pel = hd(np.cross(pos[c, I["RightUpLeg"]] - pos[c, I["LeftUpLeg"]], up))
    sh = hd(np.cross(pos[c, I["RightArm"]] - pos[c, I["LeftArm"]], up))
    out = {"guard": 0.0}
    base = ang(guard)
    if rule is not None:
        out["rule"] = dang(ang(rule), base)
        lo, hi = max(s, c - 32), min(t, c + 12)
        k = max(range(lo, hi + 1), key=lambda f: np.linalg.norm(pos[f, I[S + "Hand" if kind == "hand" else S + "Foot"]] - pos[f, I["Spine1"]]))
        out["reach"] = dang(ang(hd(pos[k, I[(S + "HandIndex1_End") if kind == "hand" else S + "Foot"]] - pos[k, I["Spine1"]])), base)
        out["reach_frame"] = int(k)
    out["pelvis"] = dang(ang(pel) + 180.0, base)
    out["chest"] = dang(ang(sh) + 180.0, base)
    if kind in ("hand", "foot", "knee"):
        # declared limb vs the same limb on the other side: peak speed in [c-16, c+4] (120 fps)
        part = {"hand": "Hand", "foot": "Foot", "knee": "Leg"}[kind]
        ref = "Spine1" if kind == "hand" else "Hips"
        O = "Right" if S == "Left" else "Left"

        def pk(side):
            lo, hi = max(s + 1, c - 16), min(t - 1, c + 4)
            q = pos[:, I[side + part]] - pos[:, I[ref]]
            return max(np.linalg.norm(q[f + 1] - q[f - 1]) * 60.0 for f in range(lo, hi + 1))
        a_, b_ = pk(S), pk(O)
        out["speed_decl"] = round(a_, 2)
        out["speed_other"] = round(b_, 2)
        out["LIMB?"] = bool(b_ > 1.5 * a_)
    return out


def walk(cid, e, where, rows):
    if isinstance(e, str):
        return
    src = e.get("src")
    if src == "cmu":
        rows.append((cid + where, e["file"], e.get("kind"), e.get("limb"), e.get("mirror", False), facing(e)))
    elif src == "layer":
        walk(cid, e["layer"]["lower"], where + ".lower", rows)
        walk(cid, e["layer"]["upper"], where + ".upper", rows)
    elif src == "seq":
        for i, x in enumerate(e["seq"]):
            walk(cid, x, where + ".seq%d" % i, rows)


def main():
    for fid in sys.argv[1:]:
        plan = json.load(open(os.path.join(GAME, "tools", "clipplan", fid + ".json")))
        rows = []
        for cid, e in plan.items():
            if not cid.startswith("_"):
                walk(cid, e, "", rows)
        print("== %s (angles in deg relative to the guard facing; + = toward the subject's left)" % fid)
        for r in rows:
            print("  %-34s %-7s %-5s %-7s m=%d %s" % (r[0], r[1], r[2], r[3], r[4], json.dumps(r[5])))


if __name__ == "__main__":
    main()
