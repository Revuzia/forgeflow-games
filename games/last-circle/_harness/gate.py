#!/usr/bin/env python
"""gate - every Last Circle gate in one run: Node selftests, then each browser gate, one verdict table (PLAN section 5).

    python _harness/gate.py --disk                         # the integration run (serves the working copy; no server needed)
    python _harness/gate.py --disk --only bootcheck,leaktest
    python _harness/gate.py --rev 7da063ad --skip mobile,probe_match
    python _harness/gate.py --disk --negative-controls     # also prove rigcheck / portalcheck still FAIL on a planted fault

Node first (`node <file>` for every runtime/**/*.selftest.cjs: royale.selftest.cjs, aimassist.selftest.cjs, the audio pool
selftest when they exist) - they prove the SIM only. Then the browser gates run ONE AT A TIME (one Chrome at a time on this
shared box), each as its own process with the same --base / --disk / --rev / --headed / --gpu flags:

  bootcheck   bootguard   rigcheck (3 seeds)   playtest   portalcheck (--matrix)   framecheck   feelcheck
  layoutcheck (desktop + phones)   mobile (4 devices)   probe_match (>= 6 seeds, storm on)   leaktest (3 ashgrid)
  perfcheck (INFORMATION ONLY: shown, never counted)

Each gate's stdout goes to _harness/_reports/gate_<stamp>/<gate>.log and its JSON report to _harness/_reports/. A gate exits
0 pass / 1 fail / 2 could-not-judge; a timeout or a crash of the gate process is could-not-judge. The overall verdict:
any fail -> FAIL (exit 1); else any could-not-judge -> COULD-NOT-JUDGE (exit 2, re-run those gates; never counted as a
pass); else PASS (exit 0).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

# (name, script, extra args, timeout s, informational)
GATES = [
    ("bootcheck", "bootcheck.py", [], 3600, False),
    ("bootguard", "bootguard.py", [], 5400, False),
    ("rigcheck", "rigcheck.py", ["--seeds", "7,11,23"], 5400, False),
    ("playtest", "playtest.py", [], 5400, False),
    ("portalcheck", "portalcheck.py", ["--matrix"], 3600, False),
    ("framecheck", "framecheck.py", [], 5400, False),
    ("feelcheck", "feelcheck.py", [], 3600, False),
    ("layoutcheck", "layoutcheck.py", [], 5400, False),
    ("mobile", "mobile.py", [], 7200, False),
    ("probe_match", "probe_match.py", [], 14400, False),
    ("leaktest", "leaktest.py", [], 7200, False),
    ("perfcheck", "perfcheck.py", [], 7200, True),
]
# planted faults that MUST make a passing gate fail (the gate's own falsifier)
NEGATIVE = [
    ("rigcheck-injected", "rigcheck.py", ["--seeds", "7", "--inject-regression"], 3600),
    ("portalcheck-minus-pointer-lock", "portalcheck.py", ["--drop-token", "allow-pointer-lock"], 3600),
]


def node_selftests():
    files = sorted(glob.glob(os.path.join(C.ROOT, "runtime", "**", "*.selftest.cjs"), recursive=True))
    out = []
    for f in files:
        rel = os.path.relpath(f, C.ROOT).replace(os.sep, "/")
        t0 = time.time()
        try:
            r = subprocess.run(["node", f], cwd=C.ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
            code = 0 if r.returncode == 0 else 1
            tail = ((r.stdout or "") + (r.stderr or "")).strip().splitlines()[-3:]
        except subprocess.TimeoutExpired:
            code, tail = 2, ["timeout after 900 s"]
        except FileNotFoundError:
            code, tail = 2, ["node not found on PATH"]
        out.append({"name": "node " + rel, "exit": code, "wall": round(time.time() - t0, 1), "tail": tail})
        print("  %-4s node %s (%.0f s) %s" % ({0: "PASS", 1: "FAIL", 2: "CNJ "}[code], rel, time.time() - t0, " | ".join(tail)[:200]), flush=True)
    return out


def run_gate(name, script, extra, timeout, args, logdir):
    cmd = [sys.executable, "-u", os.path.join(C.HERE, script)] + list(extra)
    if args.rev:
        cmd += ["--rev", args.rev]
    elif args.disk:
        cmd += ["--disk"]
    if args.base != C.DEFAULT_BASE:
        cmd += ["--base", args.base]
    if args.headed:
        cmd += ["--headed"]
    if args.gpu and args.gpu != "d3d11" and name not in ("mobile",):
        cmd += ["--gpu", args.gpu]
    log = os.path.join(logdir, name + ".log")
    t0 = time.time()
    verdict = None
    print("\n=== %s  %s  (%s)" % (name, " ".join(cmd[2:]), time.strftime("%H:%M:%S")), flush=True)
    try:
        with open(log, "w", encoding="utf-8") as fh:
            p = subprocess.run(cmd, cwd=C.ROOT, stdout=fh, stderr=subprocess.STDOUT, timeout=timeout,
                               env=dict(os.environ, PYTHONIOENCODING="utf-8"))
        code = p.returncode if p.returncode in (0, 1, 2) else 2
    except subprocess.TimeoutExpired:
        code = 2
        verdict = "timeout after %d s" % timeout
    try:
        lines = open(log, encoding="utf-8", errors="replace").read().splitlines()
        vl = [ln for ln in lines if ln.startswith("VERDICT ")]
        rl = [ln for ln in lines if ln.startswith("REPORT ")]
        if vl and not verdict:
            verdict = vl[-1][len("VERDICT "):]
        report = rl[-1][len("REPORT "):] if rl else None
    except Exception:
        report = None
    if verdict is None:
        verdict = "no verdict line (gate process exit %s)" % code
    print("    -> exit %d  %s  [%.0f s]  log %s" % (code, verdict, time.time() - t0, log), flush=True)
    return {"name": name, "exit": code, "verdict": verdict, "wall": round(time.time() - t0, 1), "log": log, "report": report}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--only", default=None, help="comma list of gate names")
    ap.add_argument("--skip", default="", help="comma list of gate names to skip")
    ap.add_argument("--no-node", action="store_true", help="skip the Node selftests")
    ap.add_argument("--negative-controls", action="store_true", help="also run the planted-fault runs (each must exit 1)")
    args = ap.parse_args()
    only = set(x for x in (args.only or "").split(",") if x) or None
    skip = set(x for x in args.skip.split(",") if x)
    stamp = C.stamp()
    logdir = os.path.join(C.REPORTS, "gate_%s" % stamp)
    os.makedirs(logdir, exist_ok=True)
    n, err = C.automated_chromes()
    print("gate: %s | other automated Chromes: %s | logs %s" % (
        ("git " + args.rev) if args.rev else ("working copy (--disk)" if args.disk else args.base), n if err is None else err, logdir), flush=True)
    rows = []
    if not args.no_node and (only is None or "node" in only):
        print("\n=== Node selftests (the SIM only; always the WORKING COPY, even with --rev)", flush=True)
        rows += [dict(r, info=False) for r in node_selftests()]
    for name, script, extra, timeout, info in GATES:
        if (only is not None and name not in only) or name in skip:
            continue
        r = run_gate(name, script, extra, timeout, args, logdir)
        r["info"] = info
        rows.append(r)
    if args.negative_controls:
        for name, script, extra, timeout in NEGATIVE:
            if only is not None and name.split("-")[0] not in only:
                continue
            r = run_gate(name, script, extra, timeout, args, logdir)
            # a planted fault must FAIL the gate: exit 1 is the pass here
            r["negative"] = True
            r["info"] = False
            r["exit"] = {1: 0, 0: 1}.get(r["exit"], 2)
            r["verdict"] = ("planted fault detected - " if r["exit"] == 0 else "planted fault NOT detected - ") + r["verdict"]
            rows.append(r)
    counted = [r for r in rows if not r.get("info")]
    code = 1 if any(r["exit"] == 1 for r in counted) else (2 if any(r["exit"] == 2 for r in counted) or not counted else 0)
    print("\n" + "=" * 110)
    print("LAST CIRCLE GATE TABLE  %s  (%s)" % (time.strftime("%Y-%m-%d %H:%M"), ("git " + args.rev) if args.rev else ("working copy" if args.disk else args.base)))
    for r in rows:
        tag = {0: "PASS", 1: "FAIL", 2: "CNJ "}[r["exit"]] + (" (info)" if r.get("info") else "")
        print("  %-12s %-34s %6.0f s  %s" % (tag, r["name"], r.get("wall", 0), str(r.get("verdict") or " | ".join(r.get("tail") or []))[:150]))
    print("OVERALL: %s" % {0: "PASS", 1: "FAIL", 2: "COULD-NOT-JUDGE (re-run the CNJ gates; never counted as a pass)"}[code])
    out = os.path.join(logdir, "gate_table.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump({"stamp": stamp, "args": vars(args), "otherChromes": n, "rows": rows, "exit": code}, fh, indent=1)
    print("REPORT %s" % out)
    return code


if __name__ == "__main__":
    sys.exit(main())
