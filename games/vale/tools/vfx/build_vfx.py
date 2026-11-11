#!/usr/bin/env python3
"""Build content/vfx.json from the VFX authoring kit.

    python3 tools/vfx/build_vfx.py          # writes content/vfx.json, then: node tools/build_content.ts --check

Sources: lib_defs.py (the shared lib_*), bespoke_defs.py (every <fighter>_<slot>_* def, when present),
system_defs.py (lib_status_* looks, the generic wind-ups lib_windup* and lib_cast_flare: the VFX system's own),
kit_defs.py (generated from the fighter records: every timed cast's <f>_<slot>_windup and the basic attacks
<f>_atk_swing / _atk_draw / _atk_shot), ambient_defs.py (the T0 amb_* defs the maps place, r12 M14), world_defs.py
(the Hour spells' lib_spell_*, item actives' lib_item_*, team-buff hits lib_buff_*). passes.py applies the house rules (signature colours, the ultimate
envelope, mid-scale secondary shapes, no camera shake) to the bespoke defs; drop_shake to every def.
Defs in content/vfx.json that no source defines yet are KEPT as they are (a port in progress never
drops a def the catalog references); `--prune` drops them instead.

After that choice passes.post (max VFX-2's ground light under every path def) runs on every def, tuned or not.

Hand tuning: bespoke/tuned.json holds the whole def of every id tuned in content/vfx.json past what its source builds
(the kit-hue, skin and combat-polish rounds tuned the shipped defs against live probes). It wins over the source, so a
rebuild cannot undo a measured fix. To retune such a def, edit it there and in content/vfx.json, or port the change to its
source and drop the entry.
    python3 tools/vfx/build_vfx.py --check         # exit 1 if a rebuild would change content/vfx.json (writes nothing)
    python3 tools/vfx/build_vfx.py --freeze-tuned  # records today's drift of content/vfx.json into bespoke/tuned.json
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
    ap.add_argument("--check", action="store_true", help="exit 1 if a rebuild would change content/vfx.json; writes nothing")
    ap.add_argument("--freeze-tuned", action="store_true", help="record every def of content/vfx.json that differs from its source into bespoke/tuned.json")
    a = ap.parse_args()
    import passes  # noqa: E402

    built = []
    for mod in ("lib_defs", "bespoke_defs", "system_defs", "kit_defs", "ambient_defs", "world_defs"):
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
    tuned_file = HERE / "bespoke" / "tuned.json"
    if a.freeze_tuned:
        src = {d["id"]: json.loads(json.dumps(passes.post(d))) for d in built}
        drift = [d for d in old if d["id"] in src and d != src[d["id"]]]
        tuned_file.write_text(json.dumps(drift, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"bespoke/tuned.json: {len(drift)} defs tuned past their source")
        return
    tuned = {d["id"]: d for d in json.loads(tuned_file.read_text(encoding="utf-8"))} if tuned_file.exists() else {}
    unknown = sorted(set(tuned) - {d["id"] for d in built})
    if unknown:
        raise SystemExit(f"bespoke/tuned.json names ids no source builds: {unknown}")
    built = [passes.post(tuned.get(d["id"], d)) for d in built]
    have = {d["id"] for d in built}
    kept = [] if a.prune else [d for d in old if d["id"] not in have]
    defs = sorted(built + kept, key=lambda d: (not d["id"].startswith("lib_"), d["id"]))
    if a.check:
        now = {d["id"]: json.loads(json.dumps(d)) for d in defs}
        was = {d["id"]: d for d in old}
        bad = sorted(i for i in set(now) | set(was) if now.get(i) != was.get(i))
        print(f"vfx.json: {len(defs)} defs, {len(tuned)} from bespoke/tuned.json, {len(bad)} a rebuild would change" + (f": {bad}" if bad else ""))
        raise SystemExit(1 if bad else 0)
    write(defs, out)
    print(f"vfx.json: {len(built)} built, {len(kept)} kept from before, {len(defs)} total")


if __name__ == "__main__":
    main()
