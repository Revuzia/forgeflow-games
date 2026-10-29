#!/usr/bin/env python3
"""Apply the closing-C1 light pass (passes.light_pass) to defs in content/vfx.json in place.

    python3 tools/vfx/rekey_light.py                 # every def passes.is_rekey_slot names (a3 / ult, LIGHT_EXTRA)
    python3 tools/vfx/rekey_light.py --ids a,b,c     # just these
    python3 tools/vfx/rekey_light.py --dry           # list what would change

content/vfx.json carries hand-tuned defs the generators do not reproduce, so the pass runs on the defs as they stand
(the pass is idempotent; build_vfx.py applies the same pass to the bespoke sources).
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import passes  # noqa: E402
from vfxkit import write  # noqa: E402

GAME = HERE.parent.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ids", default="")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    out = GAME / "content" / "vfx.json"
    defs = json.loads(out.read_text(encoding="utf-8"))
    want = set(filter(None, a.ids.split(",")))
    changed = []
    for k, d in enumerate(defs):
        if not (d["id"] in want if want else passes.is_rekey_slot(d["id"])):
            continue
        n = passes.light_pass(copy.deepcopy(d))
        if n != d:
            defs[k] = n
            changed.append(d["id"])
    print(f"light pass: {len(changed)} defs changed: {' '.join(changed)}")
    if not a.dry and changed:
        write(defs, out)


if __name__ == "__main__":
    main()
