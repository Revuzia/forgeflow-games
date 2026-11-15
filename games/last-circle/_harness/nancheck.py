#!/usr/bin/env python
"""nancheck - is the GROUND finite on every seed?  (Last Circle Wave 7, lane 7D; promoted from the stage-A check's nanscan.mjs.)  NODE ONLY.

    python _harness/nancheck.py --disk                          # the working copy: ashgrid 200 seeds (counted), isla_viva + deepwood 200 seeds (counted)
    python _harness/nancheck.py --disk --quick                  # 40 seeds
    python _harness/nancheck.py --rev 60b854d0                  # the must-fail proof: the live (Wave-6) maps.js has the NaN on Savanna seed 14, Isla Viva seed 17

`probe_nan.mjs` imports the UNMODIFIED maps.js of the chosen revision, builds every (map, seed) and counts non-finite nodes in the baked ground lattice and non-finite
heightAt() samples on an 11 m grid (a bot or a player standing on one gets y = NaN; the nav grid refuses such ground). One row per map:

  ground-finite [map]   0 seeds with a non-finite lattice node or heightAt() sample over seeds 1..N

The defect: TerrainField.live did `h += (swh / sw - h) * mw` and sw (a sum of w^32) underflowed to 0 while mw > 0 (0/0). The live build 60b854d0 reads it on 1 of its first 60
Savanna seeds; the Wave-7 city's extra pads and corridors raised the rate to 7 of 200 seeds (3.5 %) until the `&& sw > 0` guard in maps.js. Isla Viva and Deepwood are judged
too: the guard is shared, and a build whose ground differs only where it was NaN is the Wave-7 promise to the squad version guard.

Exit 0 pass / 1 fail / 2 could-not-judge (node missing, a probe crashed).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import placementcheck as PC  # noqa: E402

GATE = "nancheck"
PROBE = os.path.join(C.HERE, "probe_nan.mjs")
WIDE_N = 200
QUICK_N = 40


def run_probe(root, vendor, map_id, n, timeout):
    out = os.path.join(tempfile.gettempdir(), "lc_nan_%d_%s_%d.json" % (os.getpid(), map_id, int(time.time() * 1000) % 100000))
    cmd = ["node", PROBE, "--root", root, "--vendor", vendor, "--maps", map_id, "--seeds", "1-%d" % n, "--out", out]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("probe_nan.mjs (%s) still running after %d s" % (map_id, timeout))
    if p.returncode != 0 or not os.path.exists(out):
        raise C.EnvFailure("probe_nan.mjs (%s) exit %s: %s" % (map_id, p.returncode, " | ".join((p.stderr or p.stdout or "").strip().splitlines()[-4:])[:500]))
    with open(out, encoding="utf-8") as fh:
        doc = json.load(fh)
    try:
        os.remove(out)
    except OSError:
        pass
    return doc["maps"][map_id]


def main_fn(v, args):
    root, label = C.ROOT, "working copy"
    if args.rev:
        root, sha = PC.rev_root(args.rev)
        label = "git %s" % sha
    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    n = QUICK_N if args.quick else args.seeds_n
    maps = [m for m in args.maps.split(",") if m]
    print("%s: %s | maps %s | seeds 1..%d" % (GATE, label, ",".join(maps), n), flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=max(1, min(len(maps), args.jobs))) as ex:
        futs = {m: ex.submit(run_probe, root, vendor, m, n, args.timeout) for m in maps}
        results = {m: f.result() for m, f in futs.items()}
    v.info("Node probes", "%d builds in %.0f s" % (sum(r["seeds"] for r in results.values()), time.time() - t0))
    v.data["maps"] = results
    for m in maps:
        r = results[m]
        if r["seeds"] < n * 0.95:
            v.cnj("ground-finite [%s]" % m, "only %d of %d seeds built (%s)" % (r["seeds"], n, [b for b in r["bad"] if "error" in b][:2]))
            continue
        bad = [b for b in r["bad"] if "error" not in b]
        errs = [b for b in r["bad"] if "error" in b]
        ok = not bad and not errs
        if ok:
            v.check("ground-finite [%s]" % m, True, "every lattice node and every heightAt() sample is finite on %d seeds (1..%d)" % (r["seeds"], n), "0 seeds with a non-finite ground")
        else:
            show = "; ".join("s%d: %s lattice node(s), %s heightAt sample(s)%s" % (b["seed"], b.get("latticeNodes"), b.get("heightAtSamples"),
                                                                              (" first at (%s, %s) near %s" % (b["first"]["x"], b["first"]["z"], b["first"]["nearPoi"])) if b.get("first") else "") for b in bad[:6])
            v.check("ground-finite [%s]" % m, False, "%d of %d seeds have a non-finite ground: %s%s" % (len(bad), r["seeds"], show, ("; build errors: %s" % errs[:2]) if errs else ""),
                    "0 seeds with a non-finite ground")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default=",".join(["ashgrid", "isla_viva", "deepwood"]), help="comma list (default all three; each map is its own Node job)")
    ap.add_argument("--seeds-n", type=int, default=WIDE_N, help="seeds 1..N (default %d)" % WIDE_N)
    ap.add_argument("--quick", action="store_true", help="%d seeds" % QUICK_N)
    ap.add_argument("--jobs", type=int, default=3, help="Node processes at a time")
    ap.add_argument("--timeout", type=int, default=1800)
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
