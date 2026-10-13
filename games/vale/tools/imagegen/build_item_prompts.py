#!/usr/bin/env python3
"""Rewrite the item-icon prompts in manifest.json from item_subjects.json (what each object LOOKS
like) plus the tier's craftsmanship and the pack's fixed style and exclusion clauses.

    python3 tools/imagegen/build_item_prompts.py [--dry-run]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent.parent
TIER = {
    "starter": "Simple, sturdy, modest craftsmanship.",
    "consumable": "A humble everyday object, clean and appealing.",
    "basic": "Plain but well made, honest materials.",
    "boots": "Well-made travel gear, practical and handsome.",
    "core": "Finely crafted, careful carved detail, a faint inner light.",
    "apex": "A masterwork: exquisite carved detail and a soft radiant inner light.",
}
TAIL = ("Square game item icon: one bold centred object in a dynamic three-quarter view that reads clearly at 48 pixels, "
        "strong value contrast against a dark ink-blue painted background with a soft vignette, light from the top-left. "
        "Premium hand-painted stylized fantasy illustration, confident painterly brushwork, clean readable shapes, strong "
        "silhouette, soft dramatic light with crisp rim light, rich but restrained palette, high polish, shipped AAA game quality. "
        "No text, no letters, no numbers, no logo, no watermark, no signature, no UI, no border or frame. No gears, no clock "
        "hands, no clock faces, no gems or jewels, no glowing runes or glyphs, no gold, no gold filigree, no shiny chrome or "
        "polished metal, no teal-and-gold colour scheme, no red-versus-green.")


def main() -> None:
    subjects = {k: v for k, v in json.loads((HERE / "item_subjects.json").read_text()).items() if not k.startswith("$")}
    items = json.loads((GAME / "content" / "items.json").read_text())
    items = items.get("items", items)
    tiers = {i["id"]: i["tier"] for i in items}
    mpath = HERE / "manifest.json"
    raw = mpath.read_text(encoding="utf-8")
    m = json.loads(raw)
    n = 0
    for rec in m["items"]:
        if not rec["id"].startswith("item_"):
            continue
        iid = rec["id"][5:]
        if iid not in subjects:
            sys.exit(f"no subject for {iid}")
        rec["prompt"] = f"Game item icon of {subjects[iid]}. {TIER[tiers[iid]]} {TAIL}"
        n += 1
    if "--dry-run" in sys.argv:
        print(f"{n} item prompts (dry run)")
        return
    indent = 1 if raw.startswith("{\n \"") else 2
    mpath.write_text(json.dumps(m, indent=indent, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {n} item prompts")


if __name__ == "__main__":
    main()
