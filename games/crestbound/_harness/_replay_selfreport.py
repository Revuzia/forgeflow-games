# -*- coding: utf-8 -*-
"""Driver self-report diff.

The playtesters' own drivers append to _playreports/<course>.json.  Re-running
them on the current build therefore leaves a machine-readable answer: an entry
that matches an ORIGINAL defect is that defect re-found (STILL REPRODUCES); a
matching entry in `worked` is that defect's healthy branch taken (FIXED).

Matching is coordinate-anchored (the playtesters quote positions in almost every
entry) plus a content-word overlap, because the same finding is rarely written
in the same words twice.
"""
import json, os, re, glob, math

HERE = os.path.dirname(os.path.abspath(__file__))
RP = os.path.join(HERE, "_playreports")
BK = os.path.join(HERE, "_playreports.PRE_REPLAY_BACKUP")

NUM = r"[-+]?\d+(?:\.\d+)?"
TRIP = re.compile(r"[\(\[]\s*(%s)\s*,\s*(%s)\s*,\s*(%s)\s*[\)\]]" % (NUM, NUM, NUM))
STOP = set("""the a an and or of to in on at is was were be been it its his he him you your they them
that this these those with for from by as not no never still only just very more most much many few
into onto over under out up down off back again then than when where which who what how why all any
some each both same other another one two three i me my we our do does did done get got make made
than there here s t m cm mm km ms fps deg m/s""".split())
WORD = re.compile(r"[a-z][a-z0-9\-']+")


def coords(s):
    return [(float(a), float(b), float(c)) for a, b, c in TRIP.findall(s or "")]


def toks(s):
    return {w for w in WORD.findall((s or "").lower()) if w not in STOP and len(w) > 2}


def entry_text(x):
    if isinstance(x, dict):
        return " ".join(str(x.get(k, "")) for k in
                        ("what", "where", "did", "what_i_did", "happened", "what_happened",
                         "should", "what_should_happen", "note"))
    return str(x)


def score(o_txt, o_c, n_txt, n_c):
    s = 0.0
    if o_c and n_c:
        best = min((math.dist(a, b) for a in o_c for b in n_c), default=1e9)
        if best <= 0.6: s += 3.0
        elif best <= 3.0: s += 2.0
        elif best <= 8.0: s += 0.8
    a, b = toks(o_txt), toks(n_txt)
    if a and b:
        s += 3.0 * (len(a & b) / float(len(a | b)))
    return s


def build():
    res = {}
    for f in sorted(glob.glob(os.path.join(RP, "*.json"))):
        b = os.path.basename(f)
        if b.startswith("_") or b.endswith(".worked.json") or b.endswith(".REPLAY.json"):
            continue
        course = b[:-5]
        # the driver re-run's output was preserved as <course>.REPLAY.json when the
        # playtesters' originals were restored; prefer it.
        replay = os.path.join(RP, b[:-5] + ".REPLAY.json")
        try:
            now = json.load(open(replay if os.path.exists(replay) else f, encoding="utf-8"))
            old = json.load(open(os.path.join(BK, b), encoding="utf-8"))
        except Exception:
            continue
        o_def = old.get("defects", []) or []
        n_def = now.get("defects", []) or []
        o_wk = [entry_text(x) for x in (old.get("worked", []) or [])]
        n_wk = [entry_text(x) for x in (now.get("worked", []) or [])]
        new_defs = [entry_text(x) for x in n_def[len(o_def):]]
        new_work = n_wk[len(o_wk):]
        if not new_defs and not new_work:
            continue                       # this course's drivers have not re-run
        for i, od in enumerate(o_def):
            key = "%s#%02d" % (course, i)
            o_txt = entry_text(od)
            o_c = coords(od.get("where", "")) or coords(o_txt)
            sd = max((score(o_txt, o_c, t, coords(t)) for t in new_defs), default=0)
            sw = max((score(o_txt, o_c, t, coords(t)) for t in new_work), default=0)
            if max(sd, sw) < 1.6:
                continue
            if sd >= sw:
                which = max(new_defs, key=lambda t: score(o_txt, o_c, t, coords(t)))
                res[key] = ("STILL REPRODUCES",
                            "the tester's own driver re-found it on this build (match %.2f): %s"
                            % (sd, which[:220]))
            else:
                which = max(new_work, key=lambda t: score(o_txt, o_c, t, coords(t)))
                res[key] = ("FIXED",
                            "the tester's own driver logged this station WORKING on this build "
                            "(match %.2f): %s" % (sw, which[:220]))
    return res


def new_findings():
    """Defects the re-run drivers found that were NOT in the original 315."""
    out = []
    for f in sorted(glob.glob(os.path.join(RP, "*.json"))):
        b = os.path.basename(f)
        if b.startswith("_") or b.endswith(".worked.json") or b.endswith(".REPLAY.json"):
            continue
        try:
            now = json.load(open(os.path.join(RP, b[:-5] + ".REPLAY.json")
                                 if os.path.exists(os.path.join(RP, b[:-5] + ".REPLAY.json")) else f,
                                 encoding="utf-8"))
            old = json.load(open(os.path.join(BK, b), encoding="utf-8"))
        except Exception:
            continue
        o_def = old.get("defects", []) or []
        for x in (now.get("defects", []) or [])[len(o_def):]:
            out.append({"course": b[:-5],
                        "what": (x.get("what") or x.get("happened") or "")[:200],
                        "where": (x.get("where") or "")[:160]})
    return out


if __name__ == "__main__":
    r = build()
    for k in sorted(r):
        print(k, r[k][0], "|", r[k][1][:150])
    print("entries", len(r))
    print("new findings:", len(new_findings()))
