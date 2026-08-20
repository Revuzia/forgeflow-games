# -*- coding: utf-8 -*-
"""
qa_soak_report.py -- turn qa_soak_8894.out.json into TRENDS.

Prints, for every numeric counter sampled: first / min / max / last, the
delta last-minus-first, and whether the series is MONOTONIC NON-DECREASING
(the leak signature) or returns toward its baseline. Also prints the phase
timeline, the console warnings mapped onto the phase that was live when each
one fired, and the notes the driver recorded.
"""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
P = Path(sys.argv[1] if len(sys.argv) > 1
         else Path(__file__).with_name("qa_soak_8894.out.json"))
d = json.loads(P.read_text(encoding="utf-8"))
soak = d.get("soak") or {}
S = soak.get("samples") or []
if not S:
    print("no samples in", P)
    sys.exit(1)

print("=" * 78)
print("BOOT:", json.dumps(d.get("boot")))
print("END :", json.dumps(d.get("endState")))
print("samples: %d   game-time span: %.1f s (%.2f min)   stalls: %s   fatal: %s"
      % (len(S), S[-1]["gt"] - S[0]["gt"], (S[-1]["gt"] - S[0]["gt"]) / 60.0,
         soak.get("stalls"), soak.get("fatal")))
wall = (S[-1]["wall"] - S[0]["wall"]) / 1000.0
print("wall span: %.1f s (%.2f min)  -> game/wall ratio %.2f"
      % (wall, wall / 60.0, (S[-1]["gt"] - S[0]["gt"]) / max(wall, 1e-9)))
print("=" * 78)

print("\n---- PHASE TIMELINE (game seconds) ----")
for p in soak.get("phaseLog") or []:
    print("  %8.1f  %s" % (p["gt"], p["phase"]))

KEYS = [k for k, v in S[0].items()
        if isinstance(v, (int, float)) and k not in ("wall",)]


def series(k):
    return [s[k] for s in S if isinstance(s.get(k), (int, float))]


print("\n---- COUNTER TRENDS ----")
hdr = "%-16s %10s %10s %10s %10s %10s  %s"
print(hdr % ("counter", "first", "min", "max", "last", "delta", "shape"))
mono = []
for k in KEYS:
    v = series(k)
    if not v:
        continue
    nondec = all(v[i + 1] >= v[i] for i in range(len(v) - 1))
    grew = v[-1] > v[0]
    shape = ""
    if nondec and grew:
        shape = "MONOTONIC-UP"
        mono.append(k)
    elif grew and v[-1] >= max(v) * 0.999:
        shape = "ends-at-max"
    elif grew:
        shape = "up (non-mono)"
    elif v[-1] < v[0]:
        shape = "down"
    else:
        shape = "flat/returned"
    print(hdr % (k, "%.2f" % v[0], "%.2f" % min(v), "%.2f" % max(v),
                 "%.2f" % v[-1], "%+.2f" % (v[-1] - v[0]), shape))

print("\nMONOTONIC-UP counters: " + (", ".join(mono) if mono else "(none)"))

print("\n---- BASELINE vs FINAL (the return-to-start compare) ----")
tagged = {s.get("tag"): s for s in S if s.get("tag")}
b = tagged.get("BASELINE-2") or tagged.get("BASELINE") or S[0]
f = tagged.get("FINAL-2") or tagged.get("FINAL") or S[-1]
print("  baseline tag=%s gt=%.1f realm=%s | final tag=%s gt=%.1f realm=%s"
      % (b.get("tag"), b["gt"], b.get("realm"),
         f.get("tag"), f["gt"], f.get("realm")))
for k in KEYS:
    if k in ("gt",):
        continue
    if isinstance(b.get(k), (int, float)) and isinstance(f.get(k), (int, float)):
        dv = f[k] - b[k]
        if dv != 0:
            pct = (dv / b[k] * 100.0) if b[k] else float("inf")
            print("    %-16s %10.2f -> %10.2f   %+10.2f  (%+.1f%%)"
                  % (k, b[k], f[k], dv, pct))

print("\n---- PER-SAMPLE (compact) ----")
cols = ["gt", "phase", "fps", "dc", "tri", "heapMB", "geo", "tex", "prog",
        "sceneObjs", "insts", "types", "mats", "regCount", "enAlive",
        "motes", "meleeFree", "rangedFree", "dom", "lisNet", "realm"]
cols = [c for c in cols if c in S[0]]
print(" ".join("%9s" % c for c in cols))
for s in S:
    row = []
    for c in cols:
        v = s.get(c)
        row.append("%9s" % (("%.1f" % v) if isinstance(v, float) else str(v)[:9]))
    print(" ".join(row))

print("\n---- CONSOLE WARNINGS / ERRORS (with the live phase) ----")
plog = soak.get("phaseLog") or []


def phase_at(wall_ms):
    cur = "?"
    for p in plog:
        if p["wall"] <= wall_ms:
            cur = p["phase"]
        else:
            break
    return cur


cons = d.get("console") or []
if not cons:
    print("  (none)")
seen = {}
for c in cons:
    key = (c["type"], c["text"][:120])
    seen.setdefault(key, []).append(c)
for (t, txt), lst in seen.items():
    print("  [%s] x%d  first during phase=%s"
          % (t, len(lst), phase_at(lst[0]["wall"])))
    print("      " + txt.replace("\n", " ")[:400])

print("\n---- PAGE ERRORS ----")
pe = d.get("pageerrors") or []
if not pe:
    print("  (none)")
for e in pe:
    print("  during phase=%s: %s" % (phase_at(e["wall"]),
                                     e["text"].replace("\n", " ")[:400]))

print("\n---- DRIVER NOTES ----")
for n in soak.get("notes") or []:
    extra = {k: v for k, v in n.items()
             if k not in ("gt", "wall", "phase", "msg")}
    print("  %8.1f [%s] %s %s" % (n["gt"], n["phase"], n["msg"],
                                  json.dumps(extra) if extra else ""))
