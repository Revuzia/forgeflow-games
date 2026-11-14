"""HIT PARADE - objective contact / limb / facing check of a baked fighter (lane ASSETS, part 2).

  python tools/contact_check.py <fighter> [<fighter> ...] [--all-clips] [--json out.json]

Reads art/renders/<id>/_build/bake.json (written by art/blender/bake_fighter.py; each clip carries a
per-frame `trace` of the four main effector points + their limb roots, fighter-local [fwd, up, right]
metres, root motion stripped) and, for every clip with a contact, reports:
  eff      the effector clips.json names (plan / CMU limb / fastest near the contact)
  c        contact frame (30 fps)            ext  limb extension (root -> point) at c, metres
  extPk    the frame in [c-6, c+6] with the largest extension, and ext(c) / ext(peak)
  fwd lat  effector forward / lateral (+ = model right) at c, metres
  fast     the limb with the highest speed in [c-6, c+2] (speed of point - root, m/s) and its ratio to
           the named effector's
Flags (a flag is a lead to look at in the QC sheet, not a verdict):
  EXT   ext(c) < 0.85 * ext(peak)           contact not at the strike's extension
  BACK  fwd(c) < 0.15 m for a hand/foot     the strike point is not in front of the body (facing)
  LAT   |lat(c)| > 0.45 m                   strike off to the side (facing / wrong line)
  LIMB  another limb is > 1.6x faster near c (wrong limb / mirrored side)
ASCII only.
"""
import argparse
import json
import math
import os

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIMBS = ("RightHand", "LeftHand", "RightFoot", "LeftFoot")   # speed comparison (knees are traced too)


def sub(a, b):
    return [a[i] - b[i] for i in range(3)]


def norm(a):
    return math.sqrt(sum(x * x for x in a))


def check_clip(cid, c):
    tr = c.get("trace")
    clip = c["clip"]
    cf = c.get("contact_frame")
    if not tr or cf is None or clip.get("contact") is None:
        return None
    eff = (clip.get("effector") or {}).get("bone")
    n = clip["frames"]

    def ext(limb, k):
        t = tr.get(limb)
        return norm(sub(t["p"][k], t["root"][k]))

    def speed(limb, k):
        t = tr[limb]
        a, b = max(0, k - 1), min(n - 1, k + 1)
        if b == a:
            return 0.0
        pa = sub(t["p"][a], t["root"][a])
        pb = sub(t["p"][b], t["root"][b])
        return norm(sub(pb, pa)) * 30.0 / (b - a)
    row = {"clip": cid, "eff": eff, "c": cf, "n": n}
    flags = []
    limb = eff if eff in tr else None
    if limb:
        lo, hi = max(0, cf - 6), min(n - 1, cf + 6)
        pk = max(range(lo, hi + 1), key=lambda k: ext(limb, k))
        e_c, e_pk = ext(limb, cf), ext(limb, pk)
        p = tr[limb]["p"][cf]
        row.update({"ext": round(e_c, 3), "extPk": pk, "extRatio": round(e_c / e_pk if e_pk else 1.0, 3),
                    "fwd": p[0], "up": p[1], "lat": p[2]})
        if e_pk > 0 and e_c < 0.85 * e_pk:
            flags.append("EXT")
        if p[0] < 0.15:
            flags.append("BACK")
        if abs(p[2]) > 0.45:
            flags.append("LAT")
        wlo, whi = max(0, cf - 6), min(n - 1, cf + 2)
        sp = {L: max(speed(L, k) for k in range(wlo, whi + 1)) for L in set(LIMBS) | {limb}}
        fast = max(sorted(sp), key=lambda L: sp[L])
        row["fast"] = fast
        row["fastRatio"] = round(sp[fast] / sp[limb], 2) if sp[limb] > 1e-6 else None
        if fast != limb and sp[limb] > 0 and sp[fast] > 1.6 * sp[limb]:
            flags.append("LIMB")
    else:
        row["note"] = "effector %s not traced" % eff
    row["flags"] = flags
    return row


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fighters", nargs="+")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    allrows = {}
    for fid in a.fighters:
        bp = os.path.join(GAME, "art", "renders", fid, "_build", "bake.json")
        bake = json.load(open(bp))
        rows = []
        for cid in sorted(bake["clips"]):
            r = check_clip(cid, bake["clips"][cid])
            if r:
                rows.append(r)
        allrows[fid] = rows
        print("== %s: %d contact clips, %d flagged" % (fid, len(rows), sum(1 for r in rows if r["flags"])))
        for r in rows:
            if "ext" in r:
                print("  %-22s %-9s c=%-3d ext=%.2f pk=%-3d r=%.2f fwd=%5.2f up=%5.2f lat=%5.2f fast=%-9s x%-5s %s" % (
                    r["clip"], r["eff"], r["c"], r["ext"], r["extPk"], r["extRatio"], r["fwd"], r["up"], r["lat"],
                    r["fast"], r["fastRatio"], " ".join(r["flags"])))
            else:
                print("  %-22s %s" % (r["clip"], r.get("note")))
    if a.json:
        with open(a.json, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(allrows, fh, indent=1)


if __name__ == "__main__":
    main()
