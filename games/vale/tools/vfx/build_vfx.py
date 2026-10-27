#!/usr/bin/env python3
"""Build content/vfx.json from the VFX authoring kit.

    python3 tools/vfx/build_vfx.py          # writes content/vfx.json, then: node tools/build_content.ts --check

Sources: lib_defs.py (the shared lib_*), bespoke_defs.py (every <fighter>_<slot>_* def, when present),
system_defs.py (lib_status_* looks, the generic wind-ups lib_windup* and lib_cast_flare: the VFX system's own),
kit_defs.py (generated from the fighter records: every timed cast's <f>_<slot>_windup and the basic attacks
<f>_atk_swing / _atk_draw / _atk_shot), ambient_defs.py (the T0 amb_* defs the maps place, r12 M14). passes.py applies the house rules (signature colours, the ultimate
envelope, mid-scale secondary shapes, no camera shake) to the bespoke defs; drop_shake to every def.
Defs in content/vfx.json that no source defines yet are KEPT as they are (a port in progress never
drops a def the catalog references); `--prune` drops them instead.
"""
from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent.parent
sys.path.insert(0, str(HERE))

from vfxkit import write  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prune", action="store_true")
    a = ap.parse_args()
    import passes  # noqa: E402

    built = []
    for mod in ("lib_defs", "bespoke_defs", "system_defs", "kit_defs", "ambient_defs"):
        try:
            m = importlib.import_module(mod)
        except ModuleNotFoundError as e:
            if e.name == mod:
                continue
            raise
        got = m.defs()
        if mod == "bespoke_defs":
            got = passes.bespoke(got)
        elif mod == "lib_defs":
            got = [passes.ult_pass(passes.drop_shake(d)) if d["id"].startswith("lib_ult_") and d["id"] != "lib_ult_windup"
                   else passes.drop_shake(d) for d in got]
        built += got
    out = GAME / "content" / "vfx.json"
    old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else []
    have = {d["id"] for d in built}
    kept = [] if a.prune else [d for d in old if d["id"] not in have]
    defs = sorted(built + kept, key=lambda d: (not d["id"].startswith("lib_"), d["id"]))
    write(defs, out)
    print(f"vfx.json: {len(built)} built, {len(kept)} kept from before, {len(defs)} total")


if __name__ == "__main__":
    main()
