#!/usr/bin/env python3
"""Rewrite the ability, Hour-spell, boon and team-buff icon prompts in manifest.json from
ability_subjects.json and setup_subjects.json (what each icon SHOWS) plus a sentence for the kind
of icon and the pack's fixed style and exclusion clauses (the item TAIL of build_item_prompts.py,
worded for abilities).

    python3 tools/imagegen/build_ability_prompts.py [--dry-run]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent.parent
PREFIXES = ("ability_", "spell_", "boon_", "buff_")
KIND = {
    "passive": "Calm, emblematic composition.",
    "a1": "Dynamic action at the moment of impact.",
    "a2": "Dynamic action at the moment of impact.",
    "a3": "Dynamic action at the moment of impact.",
    "ult": "The most dramatic moment, radiant and powerful.",
    "setup": "Emblematic, one clear shape.",
}
TAIL = ("Square game ability icon: one bold centred subject in a dynamic three-quarter view that reads clearly at 48 pixels, "
        "strong value contrast against a dark ink-blue painted background with a soft vignette, light from the top-left. "
        "Premium hand-painted stylized fantasy illustration, confident painterly brushwork, clean readable shapes, strong "
        "silhouette, soft dramatic light with crisp rim light, rich but restrained palette, high polish, shipped AAA game quality. "
        "No text, no letters, no numbers, no logo, no watermark, no signature, no UI, no border or frame. No gears, no clock "
        "hands, no clock faces, no gems or jewels, no glowing runes or glyphs, no gold, no gold filigree, no shiny chrome or "
        "polished metal, no teal-and-gold colour scheme, no red-versus-green.")


def load_subjects(name: str) -> dict:
    return {k: v.rstrip(". ") for k, v in json.loads((HERE / name).read_text()).items() if not k.startswith("$")}


def main() -> None:
    subjects = {**load_subjects("ability_subjects.json"), **load_subjects("setup_subjects.json")}
    slots = {}
    for path in sorted((GAME / "content" / "fighters").glob("*.json")):
        kit = json.loads(path.read_text())["kit"]
        for slot in ("passive", "a1", "a2", "a3", "ult"):
            slots[f"ability_{kit[slot]['id']}"] = slot
        for form in (kit["passive"].get("forms") or {}).values():     # a form's own kit (Ervet's hilt)
            for slot, ab in (form.get("kit") or {}).items():
                slots[f"ability_{ab['id']}"] = slot if slot in KIND else "a1"
    for u in json.loads((GAME / "content" / "units.json").read_text())["units"]:   # monster abilities
        for ab in u.get("abilities") or []:
            slots[f"ability_{ab['id']}"] = "a1"
        if u.get("passive"):
            slots[f"ability_{u['passive']['id']}"] = "passive"
    mpath = HERE / "manifest.json"
    raw = mpath.read_text(encoding="utf-8")
    m = json.loads(raw)
    seen = set()
    for rec in m["items"]:
        rid = rec["id"]
        if not rid.startswith(PREFIXES):
            continue
        if rid not in subjects:
            sys.exit(f"no subject for {rid}")
        kind = slots[rid] if rid.startswith("ability_") else "setup"
        rec["prompt"] = f"Game ability icon: {subjects[rid]}. {KIND[kind]} {TAIL}"
        seen.add(rid)
    unused = sorted(set(subjects) - seen)
    if unused:
        sys.exit(f"subjects with no manifest record: {', '.join(unused)}")
    if "--dry-run" in sys.argv:
        print(f"{len(seen)} ability/setup prompts (dry run)")
        return
    indent = 1 if raw.startswith("{\n \"") else 2
    mpath.write_text(json.dumps(m, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {len(seen)} ability/setup prompts")


if __name__ == "__main__":
    main()
