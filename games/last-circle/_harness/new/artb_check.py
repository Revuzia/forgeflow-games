#!/usr/bin/env python
"""ART-B asset validator as a harness gate (lane ART-B, wave 4). No browser, no server: it reads the files on disk.

Wraps games/last-circle/_tools/art_b_check.py (the same checks, one verdict row each):
  manifest.json vs the GLBs (every file exists, tris within +-2 %, bbox_m at suggested_scale, bytes/compression fields,
  colliders non-empty / min<max / inside the bbox), palettes + variants, totals; PNG/JPG size caps for assets/fx,
  assets/hud/wpn_*.png and assets/tex; the vendored meshopt decoder; plus INFO rows with the new downloadable bytes by group.

Exit 0 pass / 1 fail / 2 could-not-judge (repo layout missing). The decode half (real Chrome through the vendored meshopt
decoder) is artb_decode.py.

USAGE   python _harness/new/artb_check.py
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
H = os.path.dirname(HERE)
GAME = os.path.dirname(H)
sys.path.insert(0, H)
sys.path.insert(0, os.path.join(GAME, "_tools"))

from common import EnvFailure, run_gate  # noqa: E402


def main_fn(v):
    import art_b_check
    if not os.path.isdir(os.path.join(GAME, "assets")):
        raise EnvFailure("assets/ missing next to _harness")
    rows, info = art_b_check.run_checks()
    for r in rows:
        v.check(r["name"], r["ok"], r["detail"])
    for k, b in info.get("bytes_by_group", {}).items():
        v.info("bytes " + k, "%d B (%.2f MB)" % (b, b / 1048576))
    v.info("bytes TOTAL", "%d B (%.2f MB); town-kit GLBs only %.2f MB" % (
        info.get("bytes_total", 0), info.get("bytes_total", 0) / 1048576, info.get("bytes_town_kit_glb", 0) / 1048576))
    v.data["bytes_by_group"] = info.get("bytes_by_group")


def main():
    import argparse
    from common import add_common_args
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    add_common_args(ap)
    ap.set_defaults(disk=True)
    args = ap.parse_args()
    return run_gate("artb_check", main_fn, args)


if __name__ == "__main__":
    sys.exit(main())
