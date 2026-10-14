#!/usr/bin/env python3
"""Rewrite the key-art prompts in manifest.json from keyart_subjects.json: the visual scene, then the
record's existing fixed tail (from "Characters never show a bare face", else from "Style:", to the end).

    python3 tools/imagegen/build_keyart_prompts.py [--dry-run]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
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
        k = rec["prompt"].find(MARK)
        if k < 0:
            k = rec["prompt"].find("Style:")   # tiles and loading screens have no character rule
        if k < 0:
            sys.exit(f"{rec['id']}: no fixed tail")
        rec["prompt"] = f"{subjects[rec['id']]} {rec['prompt'][k:]}"
        n += 1
    if "--dry-run" in sys.argv:
        print(f"{n} key-art prompts (dry run)")
        return
    indent = 1 if raw.startswith("{\n \"") else 2
    mpath.write_text(json.dumps(m, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {n} key-art prompts")


if __name__ == "__main__":
    main()
