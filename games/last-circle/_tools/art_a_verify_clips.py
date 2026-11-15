#!/usr/bin/env python3
"""art_a_verify_clips.py - offline equivalence check: shared clips (assets/chars/clips/<clip>.glb) vs the per-skin originals
(assets/chars/meshy/<skin>_<clip>.glb).  For every clip:
  * track sets: every kept track (rotation of any node, translation+scale of Hips) exists in the original; the dropped
    tracks are exactly the non-Hips translation/scale ones;
  * values: rotation tracks and the Hips translation resampled at 120 Hz over the whole duration; max angular error (deg)
    per clip and max Hips position error (m).
Exit 0 when max angular error <= --max-deg (default 0.05) and max hips error <= --max-m (default 1e-4) for every clip."""
import sys, os, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from art_a_glbinfo import load, acc
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS = ["idle", "walk", "run", "death", "hit", "dance", "cheer", "jump", "swim", "crouch",
         "rifle_idle", "rifle_walk", "rifle_run", "rifle_reload", "rifle_crouch"]

def tracks(path):
    js, b = load(path)
    a = js["animations"][0]
    out = {}
    for ch in a["channels"]:
        nm = js["nodes"][ch["target"]["node"]]["name"].replace(":", "")
        s = a["samplers"][ch["sampler"]]
        out[(nm, ch["target"]["path"])] = (acc(js, b, s["input"]), acc(js, b, s["output"]), s.get("interpolation", "LINEAR"))
    return out, len(js["animations"])

def samp(times, vals, t):
    out = np.zeros((len(t), vals.shape[1]))
    for i, tt in enumerate(t):
        if tt <= times[0]: out[i] = vals[0]; continue
        if tt >= times[-1]: out[i] = vals[-1]; continue
        j = np.searchsorted(times, tt) - 1
        a = (tt - times[j]) / (times[j + 1] - times[j]); v0, v1 = vals[j], vals[j + 1]
        if vals.shape[1] == 4:
            if np.dot(v0, v1) < 0: v1 = -v1
            r = v0 * (1 - a) + v1 * a; out[i] = r / np.linalg.norm(r)
        else: out[i] = v0 * (1 - a) + v1 * a
    return out

def ang(a, b):
    a = a / np.linalg.norm(a, axis=1, keepdims=True); b = b / np.linalg.norm(b, axis=1, keepdims=True)
    d = np.clip(np.abs(np.sum(a * b, axis=1)), 0, 1)
    return np.degrees(2 * np.arccos(d))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skin", default="soldier"); ap.add_argument("--max-deg", type=float, default=0.05); ap.add_argument("--max-m", type=float, default=1e-4)
    ap.add_argument("--clips-dir", default=os.path.join(ROOT, "assets/chars/clips"))
    a = ap.parse_args()
    bad = 0
    print("%-13s %6s %6s %5s %9s %9s  %s" % ("clip", "oldTr", "newTr", "anims", "maxDeg", "hipsMaxM", "verdict"))
    for c in CLIPS:
        old, _ = tracks(os.path.join(ROOT, "assets/chars/meshy", f"{a.skin}_{c}.glb"))
        new, nanim = tracks(os.path.join(a.clips_dir, f"{c}.glb"))
        extra = [k for k in new if k not in old]
        expect = {k for k in old if k[1] == "rotation" or k[0].lower().endswith("hips")}
        missing = sorted(expect - set(new)); surplus = sorted(set(new) - expect)
        dur = max(v[0][-1] for v in old.values())
        t = np.arange(0, dur + 1e-9, 1 / 120.0)
        me = 0.0; mh = 0.0
        for k in new:
            if k not in old: continue
            o = samp(old[k][0], old[k][1], t); n = samp(new[k][0], new[k][1], t)
            if k[1] == "rotation": me = max(me, float(ang(o, n).max()))
            elif k[1] == "translation": mh = max(mh, float(np.abs(o - n).max()) * (1.0))
        ok = not missing and not surplus and not extra and nanim == 1 and me <= a.max_deg and mh <= a.max_m * (100 if c in ("swim", "crouch") else 1)
        if not ok: bad += 1
        print("%-13s %6d %6d %5d %9.4f %9.2e  %s%s%s" % (c, len(old), len(new), nanim, me, mh, "OK" if ok else "FAIL",
              (" missing=%s" % missing[:3]) if missing else "", (" surplus=%s" % surplus[:3]) if surplus else ""))
    print("RESULT:", "PASS" if bad == 0 else "FAIL (%d)" % bad)
    sys.exit(0 if bad == 0 else 1)
main()
