# -*- coding: utf-8 -*-
"""
qa_clipbasis_static.py -- the clip-basis regression gate, no browser needed.

For every <slug>_anims.glb: the idle clip's FIRST KEY per leg bone must sit
near the body's rest rotation (a standing idle keeps legs near bind). The
2026-08-11 leg-fold defect read 150-180 deg here; correct output reads under
~35 deg. Also reports the walk clip's Hips vertical amplitude -- the broken
basis inflated a ~4 cm bob to ~0.5 m.

Exit 0 = every body passes (UpLegs < 60 deg from rest at idle t0, walk bob
under 0.15 m). Any failure names the body and bone.
"""
import glob
import json
import os
import struct
import sys

import numpy as np

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
ENEMIES = os.path.join(os.path.dirname(HERE), "assets", "enemies")

CT = {5126: "<f4", 5121: "<u1", 5123: "<u2", 5120: "<i1", 5122: "<i2",
      5125: "<u4"}


def glb(path):
    with open(path, "rb") as f:
        struct.unpack("<III", f.read(12))
        clen, _ = struct.unpack("<II", f.read(8))
        doc = json.loads(f.read(clen).decode("utf-8"))
        blen, _ = struct.unpack("<II", f.read(8))
        return doc, f.read(blen)


def acc(doc, blob, ai):
    a = doc["accessors"][ai]
    bv = doc["bufferViews"][a["bufferView"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    nc = {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
    dt = CT[a["componentType"]]
    v = np.frombuffer(blob, dtype=dt, count=a["count"] * nc,
                      offset=off).reshape(a["count"], nc).astype(np.float64)
    if a.get("normalized"):
        mx = {"<u1": 255, "<u2": 65535, "<i1": 127, "<i2": 32767}[dt]
        v = v / mx
    return v


def qangle(q1, q2):
    d = abs(float(np.dot(q1, q2)))
    return float(np.degrees(2 * np.arccos(min(1.0, d))))


def main():
    fails = []
    rows = []
    for apath in sorted(glob.glob(os.path.join(ENEMIES, "*_anims.glb"))):
        slug = os.path.basename(apath).replace("_anims.glb", "")
        bpath = os.path.join(ENEMIES, slug + ".glb")
        bdoc, _ = glb(bpath)
        adoc, ablob = glb(apath)
        rest = {}
        for n in bdoc["nodes"]:
            if n.get("name"):
                q = np.array(n.get("rotation", [0, 0, 0, 1.0]), dtype=float)
                rest[n["name"]] = q / np.linalg.norm(q)
        anames = [n.get("name") for n in adoc["nodes"]]
        idle = next((a for a in adoc["animations"] if a["name"] == "idle"),
                    None)
        walk = next((a for a in adoc["animations"] if a["name"] == "walk"),
                    None)
        worstLeg = ("-", 0.0)
        for ch in (idle["channels"] if idle else ()):
            if ch["target"]["path"] != "rotation":
                continue
            bn = anames[ch["target"]["node"]]
            if not bn or "UpLeg" not in bn:
                continue
            q = acc(adoc, ablob, idle["samplers"][ch["sampler"]]["output"])[0]
            q = q / np.linalg.norm(q)
            a = qangle(q, rest[bn])
            if a > worstLeg[1]:
                worstLeg = (bn.replace("mixamorig:", ""), a)
        bob = 0.0
        for ch in (walk["channels"] if walk else ()):
            if ch["target"]["path"] != "translation":
                continue
            v = acc(adoc, ablob, walk["samplers"][ch["sampler"]]["output"])
            bob = float(v[:, 1].max() - v[:, 1].min())
        ok = worstLeg[1] < 60.0 and bob < 0.15
        rows.append((slug, worstLeg, bob, ok))
        if not ok:
            fails.append(slug)
    for slug, (bone, a), bob, ok in rows:
        print("%-36s upleg_vs_rest=%5.1f deg (%s)  walk_hips_bob=%.3f m  %s"
              % (slug, a, bone, bob, "ok" if ok else "FAIL"))
    print("\n%d/%d bodies pass" % (len(rows) - len(fails), len(rows)))
    print("RESULT:", "OK" if not fails else "FAIL: " + ", ".join(fails))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
