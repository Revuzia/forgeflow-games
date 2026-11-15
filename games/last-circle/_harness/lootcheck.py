#!/usr/bin/env python
"""lootcheck - is every piece of loot where a player can reach it?  (Last Circle Wave 7, lane 7D wrapper for lane 7C's probe_loot.mjs.)  NODE ONLY.

    python _harness/lootcheck.py --disk                          # the working copy: ashgrid + isla_viva + deepwood x seeds 7, 1, 2, 3, 4 (15 builds, ~15 s)
    python _harness/lootcheck.py --loot-rev 60b854d0             # the must-fail proof: the LIVE loot.js (Wave 6) measured on this tree's maps (exit 1)

`probe_loot.mjs --gate` imports the UNMODIFIED maps.js and loot.js of the working copy in Node (the world gates' environment), builds each (map, seed), runs the game's own
populate() and measures what a player would meet with an INDEPENDENT re-derivation of support and ceiling (so a loot.js bug cannot hide behind itself). Rows (probe_loot's
own gate rows, relayed one by one):

  no loot inside a solid box (items + chests)                       0   (the live loot.js leaves 49 items / chests in solids over the same 15 builds)
  no loot hovering over nothing (a stairwell hole, in the air)      0   (the live loot.js leaves 64 hovering)
  every floor ring sits on its support (+-10 cm), none in a solid   0
  no beam above its ceiling (no beam through a roof)                0
  every item got a ring (the marker pools are not exhausted)        0
  (floor guns + chests) / 50 players >= 3 on every build            min 3.36 (deepwood s7)
  >= 8 light-ammo boxes on every build                              min 48
  marker pools keep headroom after 50 death drops                   min 830 rings / 498 beams

`--loot-rev REV` writes `git show REV:games/last-circle/runtime/3d/royale/loot.js` to a temp file and passes it as probe_loot's `--loot` (the A/B for loot.js alone).
Exit 0 pass / 1 fail / 2 could-not-judge (node missing, the probe crashed, no gate rows came back).
"""
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "lootcheck"
PROBE = os.path.join(C.HERE, "probe_loot.mjs")
ROW = re.compile(r"^\s+(PASS|FAIL)\s{2}(.+?)\s{2,}(\S.*)$")


def main_fn(v, args):
    vendor = os.path.join(C.ROOT, "assets", "vendor", "three")
    if not os.path.isdir(vendor):
        raise C.EnvFailure("vendored three not found at %s" % vendor)
    cmd = ["node", PROBE, "--root", C.ROOT, "--vendor", vendor, "--maps", args.maps, "--seeds", args.seeds, "--gate"]
    tmp = None
    label = "working copy"
    if args.loot_rev:
        p = subprocess.run(["git", "-C", C.REPO, "show", "%s:games/last-circle/runtime/3d/royale/loot.js" % args.loot_rev], capture_output=True)
        if p.returncode != 0 or not p.stdout:
            raise C.HarnessError("git show %s:...loot.js failed: %s" % (args.loot_rev, p.stderr.decode("utf-8", "replace")[:200]))
        fd, tmp = tempfile.mkstemp(prefix="lc_loot_", suffix=".js")
        with os.fdopen(fd, "wb") as fh:
            fh.write(p.stdout)
        cmd += ["--loot", tmp]
        label = "working-copy maps + the loot.js of git %s" % args.loot_rev
    print("%s: %s | maps %s | seeds %s" % (GATE, label, args.maps, args.seeds), flush=True)
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=args.timeout, cwd=C.ROOT)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    except subprocess.TimeoutExpired:
        raise C.EnvFailure("probe_loot.mjs still running after %d s" % args.timeout)
    finally:
        if tmp:
            try:
                os.remove(tmp)
            except OSError:
                pass
    out = (r.stdout or "")
    rows = []
    in_rows = False
    total = None
    for ln in out.splitlines():
        if ln.startswith("probe_loot TOTAL"):
            total = ln[len("probe_loot TOTAL"):].strip()
        if ln.startswith("probe_loot gate rows"):
            in_rows = True
            continue
        if in_rows:
            m = ROW.match(ln)
            if m:
                rows.append((m.group(1) == "PASS", m.group(2).strip(), m.group(3).strip()))
    if not rows:
        raise C.EnvFailure("probe_loot.mjs exit %s printed no gate rows: %s" % (r.returncode, " | ".join(((r.stderr or "") + out).strip().splitlines()[-4:])[:500]))
    if total:
        v.info("totals", total[:700])
    for ok, name, val in rows:
        v.check(name, ok, val, "0 (or the stated minimum)")
    v.data["probeExit"] = r.returncode


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="ashgrid,isla_viva,deepwood")
    ap.add_argument("--seeds", default="7,1,2,3,4")
    ap.add_argument("--loot-rev", default=None, metavar="GITREV", help="measure THIS revision's loot.js on the working copy's maps (the live build's = the must-fail control)")
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()
    if args.loot_rev and not args.report:
        args.report = "lootcheck_loot_" + args.loot_rev[:8]
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
