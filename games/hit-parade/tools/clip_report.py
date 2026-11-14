"""HIT PARADE - per-clip bake report of a fighter (lane ASSETS, part 2).

  python tools/clip_report.py <fighter> [--fighter-only] [--tsv]

One row per baked clip from art/renders/<id>/_build/bake.json (+ qc/qc.json when present):
  clip, kind (source summary), frames, contact s (frame), effector bone @ [x_fwd, y_up], root distance
  (forward travel stripped into clips.json root, end value / max |value|, metres), QC lowest-vertex range,
  contact aim / limb check / settle notes, and contact_check.py flags. ASCII only.
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import contact_check as CC  # noqa: E402


def kind_of(e):
    s = e.get("src", "mixamo")
    if s == "mixamo":
        return "mixamo %s %s" % (e.get("file", "").split("/")[-1], e.get("range") or "")
    if s == "cmu":
        return "cmu %s %s %s/%s" % (e.get("file"), e.get("range"), e.get("kind"), e.get("_limb_resolved") or e.get("limb"))
    if s == "author":
        return "author %s" % e.get("file")
    if s == "layer":
        lo, up = e["layer"]["lower"], e["layer"]["upper"]
        f = lambda x: (x if isinstance(x, str) else x.get("file", "?")).split("/")[-1]  # noqa: E731
        return "layer %s + %s" % (f(lo), f(up))
    if s == "seq":
        return "seq %d segs xf%s" % (len(e["seq"]), e.get("xf", 2))
    return s


def rows(fid, fighter_only=False):
    bake = json.load(open(os.path.join(GAME, "art", "renders", fid, "_build", "bake.json")))
    qp = os.path.join(GAME, "art", "renders", fid, "qc", "qc.json")
    qc = json.load(open(qp))["clips"] if os.path.exists(qp) else {}
    shared = set(k for k in json.load(open(os.path.join(GAME, "tools", "clipplan", "_shared.json"))) if not k.startswith("_"))
    fplan = json.load(open(os.path.join(GAME, "tools", "clipplan", fid + ".json")))
    out = []
    for cid in sorted(bake["clips"]):
        c = bake["clips"][cid]
        origin = "fighter" if cid in fplan else "shared"
        if fighter_only and origin == "shared":
            continue
        clip = c["clip"]
        root = [r[1] for r in clip["root"]]
        eff = clip.get("effector")
        notes = []
        if c.get("aim"):
            notes.append("aim %+.0f deg (%s, %s)" % (c["aim"]["deg"], c["aim"]["point"], c["aim"]["scope"]))
        lc = (c.get("src") or {}).get("_limb_check")
        if isinstance(lc, dict) and lc.get("resolved"):
            notes.append("limb %s->%s" % (lc["declared"], lc["resolved"]))
        fl = c.get("floor") or {}
        if fl.get("settled_m"):
            notes.append("settled %.3f m" % fl["settled_m"])
        if clip.get("apexY") is not None:
            notes.append("apexY %.2f" % clip["apexY"])
        if clip.get("marks"):
            notes.append("marks " + ",".join("%s@%.3f" % (k, v) for k, v in sorted(clip["marks"].items(), key=lambda kv: kv[1])))
        cc = CC.check_clip(cid, c) or {}
        q = qc.get(cid, {})
        out.append({
            "clip": cid, "origin": origin, "kind": kind_of(c.get("src") or {}), "frames": clip["frames"],
            "contact": None if clip.get("contact") is None else "%.3fs (f%s)" % (clip["contact"], c.get("contact_frame")),
            "effector": None if not eff else "%s @ [%.2f, %.2f]" % (eff["bone"], eff["at"][0], eff["at"][1]),
            "root": "%.2f / %.2f" % (root[-1], max(abs(x) for x in root)),
            "low": None if not q else "%.3f..%.3f" % (q.get("lowest_min", 0), q.get("lowest_max", 0)),
            "tpose": None if not q else len(q.get("tpose_frames", [])),
            "notes": "; ".join(notes), "flags": " ".join(cc.get("flags", [])),
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("fighter")
    ap.add_argument("--fighter-only", action="store_true")
    ap.add_argument("--json", default=None)
    a = ap.parse_args()
    rs = rows(a.fighter, a.fighter_only)
    for r in rs:
        print("%-20s %-7s %-44s %3df  c=%-14s eff=%-26s root=%-12s low=%-14s tp=%s %s %s" % (
            r["clip"], r["origin"], r["kind"][:44], r["frames"], r["contact"], r["effector"], r["root"], r["low"],
            r["tpose"], r["notes"], ("FLAGS " + r["flags"]) if r["flags"] else ""))
    if a.json:
        json.dump(rs, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
