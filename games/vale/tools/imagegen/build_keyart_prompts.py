#!/usr/bin/env python3
"""Rewrite the key-art prompts in manifest.json from keyart_subjects.json: the visual scene, then the
record's existing fixed tail (from "Characters never show a bare face", else from "Style:", to the end),
with the current FIGURE sentence and the SENSITIVITY line of build_manifest.py.

A subject is a scene string, or {"scene": ..., "roster": [fighter ids or id:skin], "figures": false?}
("figures": false = the roster's signature pieces are painted as objects, no characters). A roster is copied to
the record; run_xai.py then sends a board of those real models as the reference image, and the
sensitivity sign-off names each painted figure to one of those ids.

    python3 tools/imagegen/build_keyart_prompts.py [--dry-run]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_manifest import FIGURE, SENSITIVITY  # noqa: E402

MARK = "Characters never show a bare face"


def main() -> None:
    subjects = {k: v for k, v in json.loads((HERE / "keyart_subjects.json").read_text()).items() if not k.startswith("$")}
    mpath = HERE / "manifest.json"
    raw = mpath.read_text(encoding="utf-8")
    m = json.loads(raw)
    n = 0
    for rec in m["items"]:
        if rec["kind"] != "keyart":
            continue
        if rec["id"] not in subjects:
            sys.exit(f"no subject for {rec['id']}")
        sub = subjects[rec["id"]]
        scene, roster = (sub, None) if isinstance(sub, str) else (sub["scene"], sub.get("roster"))
        figures = bool(roster) and (isinstance(sub, str) or sub.get("figures", True))  # False: roster pieces only
        p = rec["prompt"]
        had_figures = p.find(MARK) >= 0
        w, st = p.find("The Vale:"), p.find("Style:")
        if st < 0:
            sys.exit(f"{rec['id']}: no fixed tail")
        base = p[w:] if (had_figures and w >= 0) else p[st:]   # the world + style + exclusion tail
        if figures or (not roster and had_figures):            # the current figure sentence, never a stale one
            base = f"{FIGURE} {base}"
        tail = base
        if SENSITIVITY not in tail:
            tail = f"{tail} {SENSITIVITY}"
        rec["prompt"] = f"{scene} {tail}"
        if roster:
            rec["roster"] = roster
        else:
            rec.pop("roster", None)
        n += 1
    if "--dry-run" in sys.argv:
        print(f"{n} key-art prompts (dry run)")
        return
    indent = 1 if raw.startswith("{\n \"") else 2
    mpath.write_text(json.dumps(m, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {n} key-art prompts")


if __name__ == "__main__":
    main()
