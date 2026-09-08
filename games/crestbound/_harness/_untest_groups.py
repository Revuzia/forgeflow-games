# -*- coding: utf-8 -*-
"""Group the replay pass's COULD-NOT-TEST defects by WHY it could not test them.

    python _untest_groups.py

Six blockers, each with the harness capability that closes it:

  no-position     the report names no machine-readable coordinate  -> station resolver
  unreachable     the driver cannot stand at the station           -> goto + verify
  needs-savestate a crest / power / trigger precondition           -> save-state setter
  needs-phase     a hazard phase the driver cannot wait for        -> clock advance
  needs-2-inputs  a move that is two keys at once                  -> two-input helper
  behind-blocker  the station is past another defect's blocker     -> goto + verify (teleport past it)
  frame-claim     the claim is about what the frame SHOWS          -> screen / material / pixel read

A defect can carry several; the printed group is the strongest one, which is the
one a harness has to fix first.
"""
import json, os, re, sys
from collections import Counter, OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
RP = os.path.join(HERE, "_playreports")
sys.path.insert(0, HERE)
from _untestlib import stations_from_text

VERD = json.load(open(os.path.join(RP, "_replay_verdicts.json"), encoding="utf-8"))
IDX = {d["key"]: d for d in json.load(open(os.path.join(RP, "_defects_index.json"), encoding="utf-8"))}

RULES = [
    ("needs-savestate", r"secret crest|power hat|metal hat|wing (hat|power)|\bhat\b|trigger '|requires \d+ crest|gated|boss crest|warden (dies|dead)|unlock"),
    ("needs-phase",     r"vanish|cycle|phase|period \d|every \d+ s|warn |on-?window|off phase|rising lava|chase clock|pulse beam|crusher|piston|stroke|oscillat|gondola|sweep|count of|timed"),
    ("needs-2-inputs",  r"long ?jump|crouch\+?\s*(and\s*)?jump|wall ?kick|ground ?pound|crouch at speed|tuck|dive|hold .{0,20}(and|then) (press|tap)|backflip|sideflip"),
    ("unreachable",     r"never got (in|on|out)|cannot be reached|unreachab|no way (in|out|up)|there is no floor|fell out of the world|stopped dead|walled|no route|impossible to"),
    ("behind-blocker",  r"blocked by|past the|only way (in|up)|beyond the|the same .{0,20}blocker|after the|behind another"),
    ("frame-claim",     r"renders? as|reads? as|looks? like|washed out|near-?black|flat (grey|gray|white|pale)|unreadable|illegible|colour|color|texture|silhouette|z-?fight|banding|blown-?out|hard-?edged|no gradient|olive|steel blue|billboard"),
]


def groups_for(d):
    t = " ".join([d.get("where") or "", d.get("did") or "", d.get("happened") or "",
                  d.get("should") or ""])
    g = []
    if not (d.get("coords") or []):
        g.append("no-position" if not stations_from_text(d) else "no-position(parseable)")
    for name, pat in RULES:
        if re.search(pat, t, re.I):
            g.append(name)
    return g or ["battery-too-generic"]


def main():
    rows = []
    prim, allc = Counter(), Counter()
    for v in VERD["verdicts"]:
        if v["verdict"] != "COULD NOT TEST":
            continue
        d = IDX[v["key"]]
        g = groups_for(d)
        # the strongest blocker: a station you cannot name or reach beats
        # everything else, because nothing can be driven without one.
        order = ["no-position", "unreachable", "behind-blocker", "needs-savestate",
                 "needs-phase", "needs-2-inputs", "no-position(parseable)", "frame-claim",
                 "battery-too-generic"]
        p = sorted(g, key=lambda x: order.index(x) if x in order else 99)[0]
        prim[p] += 1
        for x in g:
            allc[x] += 1
        rows.append(OrderedDict([("key", v["key"]), ("course", v["course"]), ("cls", v["cls"]),
                                 ("primary", p), ("groups", g),
                                 ("stations", [s["p"] for s in stations_from_text(d)] if not d.get("coords") else d["coords"][:2])]))
    json.dump({"generated": "_untest_groups.py", "primary": dict(prim), "anyOf": dict(allc),
               "rows": rows},
              open(os.path.join(RP, "_untest_groups.json"), "w", encoding="utf-8"),
              indent=1, ensure_ascii=False)
    print("COULD NOT TEST:", sum(prim.values()))
    print("\n-- primary blocker --")
    for k, n in prim.most_common():
        print("  %-24s %3d" % (k, n))
    print("\n-- any-of (a defect can carry several) --")
    for k, n in allc.most_common():
        print("  %-24s %3d" % (k, n))
    withpos = sum(1 for r in rows if r["stations"])
    print("\nstations resolvable now: %d of %d (%d had none in the index)" % (
        withpos, len(rows), sum(1 for r in rows if not IDX[r["key"]].get("coords"))))


if __name__ == "__main__":
    main()
