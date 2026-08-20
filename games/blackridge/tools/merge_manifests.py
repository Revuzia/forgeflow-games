#!/usr/bin/env python
"""A0 manifest merge (BUILD_PLAN Part 2: A0 is the merge owner).

Reads assets/manifest.a*.json fragments + the existing A0 entries in
assets/manifest.json, re-verifies every entry's byte count against disk
(fragments can go stale when a lane rebuilds after writing its fragment —
observed: manifest.a4.json's GLB sizes predated A4's final rebuild), and
writes the merged assets/manifest.json with payload-gate sums.

Payload classes (Part 5):
  menu    — fetched on the boot/menu critical path: vendor three+draco,
            level textures + props (buildLevel awaits them), warden+pike FP
            GLBs (boot phase 4), HUD font.
  mission — streamed during menu / behind soldiers.ready(): chars, audio,
            vesper+corvus FP GLBs.
Gates: menu <= 6 MB, mission <= +5 MB. Exit 1 on missing file or blown gate.
"""
import glob
import json
import os
import sys

GAME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(GAME, "assets")

MISSION_PREFIXES = ("assets/chars/", "assets/audio/")
MISSION_FILES = {"assets/weapons/vesper.glb", "assets/weapons/corvus.glb"}


def classify(path):
    if path in MISSION_FILES or path.startswith(MISSION_PREFIXES):
        return "mission"
    return "menu"


def main():
    base = json.load(open(os.path.join(ASSETS, "manifest.json"), encoding="utf-8"))
    merged = {}
    # A0's own entries (vendor) stay; fragments layer on top, keyed by path.
    for e in base.get("entries", []):
        merged[e["path"]] = dict(e)
    frag_names = sorted(glob.glob(os.path.join(ASSETS, "manifest.a*.json")))
    for fn in frag_names:
        frag = json.load(open(fn, encoding="utf-8"))
        lane = frag.get("lane", os.path.basename(fn))
        for e in frag.get("entries", []):
            row = dict(e)
            row["lane"] = lane
            merged[e["path"]] = row

    problems = []
    sums = {"menu": 0, "mission": 0}
    for path, e in sorted(merged.items()):
        fp = os.path.join(GAME, path.replace("/", os.sep))
        if not os.path.isfile(fp):
            problems.append(f"MISSING on disk: {path}")
            continue
        real = os.path.getsize(fp)
        if real != e.get("bytes"):
            e["bytes_fragment_stale"] = e.get("bytes")
            e["bytes"] = real
        e["payload"] = classify(path)
        sums[e["payload"]] += real

    out = {
        "game": base.get("game", "blackridge"),
        "updated": "2026-08-19",
        "note": ("Merged by tools/merge_manifests.py (A0). Byte counts are "
                 "re-verified against disk at merge time; a bytes_fragment_stale "
                 "field records a fragment's stale figure. Fragments "
                 "(manifest.a*.json) remain the per-lane sources."),
        "entry_shape": base.get("entry_shape"),
        "payload_sums_bytes": {
            "menu": sums["menu"],
            "mission": sums["mission"],
            "menu_budget": 6 * 1024 * 1024,
            "mission_budget": 5 * 1024 * 1024,
        },
        "entries": [merged[k] for k in sorted(merged)],
    }
    with open(os.path.join(ASSETS, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
        f.write("\n")

    print(f"fragments merged: {[os.path.basename(f) for f in frag_names]}")
    print(f"entries: {len(out['entries'])}")
    print(f"menu payload:    {sums['menu']:>9d} bytes ({sums['menu']/1048576:.2f} MB, budget 6 MB)")
    print(f"mission payload: {sums['mission']:>9d} bytes ({sums['mission']/1048576:.2f} MB, budget +5 MB)")
    for p in problems:
        print("PROBLEM:", p)
    if sums["menu"] > 6 * 1024 * 1024:
        problems.append("menu payload gate BLOWN")
        print("PROBLEM: menu payload gate BLOWN")
    if sums["mission"] > 5 * 1024 * 1024:
        problems.append("mission payload gate BLOWN")
        print("PROBLEM: mission payload gate BLOWN")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
