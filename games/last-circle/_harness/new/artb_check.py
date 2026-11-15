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
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(GAME, "_tools"))
sys.dont_write_bytecode = True      # (Wave 8, lane K3) importing _tools/art_b_check.py must not leave a stray _tools/__pycache__ in the deploy tree

from common import EnvFailure, run_gate  # noqa: E402


COLL_ROW = "manifest: colliders non-empty, min<max, inside the bbox"


def main_fn(v, plant=None):
    import art_b_check
    import artb_colliders
    if not os.path.isdir(os.path.join(GAME, "assets")):
        raise EnvFailure("assets/ missing next to _harness")
    rows, info = art_b_check.run_checks()
    for r in rows:
        if r["name"] == COLL_ROW:
            # (Wave 8, lane K3) the tool's row has no collider_mode "none" exemption (the interior kit's rugs + pallet carry no collider on purpose):
            # the row is judged here by the shared rule (artb_colliders.py) on the same manifest; the tool's own verdict is printed as information
            import json
            m = json.loads(art_b_check.MANIFEST.read_text(encoding="utf-8"))
            bad, exempt, boxes, note = artb_colliders.judge(m["types"], plant)
            v.info(COLL_ROW + " (the tool's own verdict, no 'none' exemption)", ("ok " if r["ok"] else "FAIL ") + r["detail"])
            v.check(COLL_ROW, not bad, ((note + "; ") if note else "") + (", ".join(bad[:8]) if bad else "%d types, %d boxes; %d collider_mode 'none' types carry none on purpose (%s)" % (
                len(m["types"]), boxes, len(exempt), ", ".join(exempt[:6]) or "-")))
            continue
        if plant:
            v.info(r["name"] + " (not counted in plant mode)", ("ok " if r["ok"] else "FAIL ") + r["detail"])
            continue
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
    ap.add_argument("--plant", default=None, choices=["drop-colliders"], help="negative control: one boxed type's colliders emptied in memory (the collider row must FAIL)")
    ap.set_defaults(disk=True)
    args = ap.parse_args()
    return run_gate("artb_check", lambda v: main_fn(v, args.plant), args)


if __name__ == "__main__":
    sys.exit(main())
