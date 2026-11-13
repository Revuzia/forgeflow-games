#!/usr/bin/env python
"""perfcheck - the live-measure probe (lc_liveprobe.py) as a harness gate. INFORMATION ONLY: never a pass/fail on ms.

    python _harness/perfcheck.py                          # 1 rep x 3 maps, :8790 server, dgpu-uncapped profile
    python _harness/perfcheck.py --reps 3 --label after   # the PLAN section 5 step 4 "after" column
    python _harness/perfcheck.py --disk --maps ashgrid --reps 1

Runs _harness/lc_liveprobe.py (promoted unchanged from the live-measure audit, plus a --base/--disk/--rev hook) in this
process and prints, per run: boot, menu / drop / ground / endgame windows (rAF p50 / p99, draw calls, triangles, programs,
textures, heap), page errors, and the number of OTHER automated Chromes on the box at the start of the run (contention
evidence - the box is shared). The JSON goes to _harness/_reports/lc_liveprobe_<label>_<stamp>.json, the format
lc_liveprobe_table.py reads; compare with the baseline _spec/improve_2026-09/baseline/_reports/
lc_liveprobe_base_20260930_003158.json.

Exit: 0 when at least one run measured a ground window (the numbers are information), 2 when nothing could be
measured (environment). Never 1: page errors seen here are printed and are owned by bootcheck / playtest.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import lc_liveprobe as LP  # noqa: E402

BASELINE = os.path.join(C.ROOT, "_spec", "improve_2026-09", "baseline", "_reports", "lc_liveprobe_base_20260930_003158.json")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--reps", type=int, default=1)
    ap.add_argument("--maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--label", default="perfcheck")
    ap.add_argument("--profile", default="dgpu-uncapped", choices=["dgpu-uncapped", "default", "default-uncapped"])
    ap.add_argument("--no-again", action="store_true")
    ap.add_argument("--table", action="store_true", help="also print lc_liveprobe_table.py for this run and the baseline")
    args = ap.parse_args()

    def body(v):
        LP.URL = args.base
        if getattr(args, "rev", None) or args.disk:
            u = C.urllib.parse.urlparse(args.base)
            srv = C.DiskServer(["%s://%s" % (u.scheme, u.netloc)], getattr(args, "rev", None))
            LP.ROUTER = (lambda url: srv.matches(url), srv.handle)
        elif not C.url_reachable(args.base):
            raise C.EnvFailure("server not reachable at %s (use --disk)" % args.base)
        argv = ["--reps", str(args.reps), "--maps", args.maps, "--label", args.label, "--profile", args.profile,
                "--width", str(args.width if (args.width, args.height) != (1280, 720) else 1600),
                "--height", str(args.height if (args.width, args.height) != (1280, 720) else 900)]
        if args.headed:
            argv.append("--headed")
        if args.no_again:
            argv.append("--no-again")
        path = LP.main(argv)
        v.data["liveprobeReport"] = path
        res = json.load(open(path, encoding="utf-8")).get("results", []) if path and os.path.isfile(path) else []
        measured = 0
        for r in res:
            w = r.get("windows", {})
            g = w.get("ground") or {}
            if g.get("frames"):
                measured += 1
            oc = r.get("automated_chromes_at_start")
            row = {"map": r.get("map"), "rep": r.get("rep"), "otherChromes": len(oc) if isinstance(oc, list) else oc,
                   "bootColdS": (r.get("boot_cold") or {}).get("wall_s"), "pageErrors": r.get("pageerror_count"), "notes": r.get("notes")}
            for name in ("menu", "drop", "ground", "endgame", "again_drop"):
                x = w.get(name) or {}
                if x:
                    row[name] = {k: x.get(k) for k in ("frames", "p50", "p99", "calls_med", "tris_med", "tris_max", "programs", "textures", "heapMB_end")}
            v.info("run %s rep %s (INFORMATION)" % (r.get("map"), r.get("rep")), row)
        if res and measured:
            v.check("the probe measured >= 1 ground window (numbers above are INFORMATION, never a gate)", True,
                    {"runs": len(res), "withGroundWindow": measured, "report": path})
        else:
            v.cnj("the probe measured >= 1 ground window", "no run produced a ground window (rAF starved or boot failed): %s" %
                  [r.get("notes") for r in res][:3])
        if args.table and path:
            for f in (path, BASELINE):
                if os.path.isfile(f):
                    print("\n--- lc_liveprobe_table %s" % os.path.basename(f), flush=True)
                    subprocess.run([sys.executable, os.path.join(C.HERE, "lc_liveprobe_table.py"), f])
    return C.run_gate("perfcheck", body, args)


if __name__ == "__main__":
    sys.exit(main())
