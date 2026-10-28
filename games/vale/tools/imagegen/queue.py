#!/usr/bin/env python3
"""Drive the VALE image pack by hand or through a browser (Grok Imagine in Chrome).

    python3 tools/imagegen/queue.py status                 # done / pending counts per kind
    python3 tools/imagegen/queue.py next [--kind icon]     # the next pending record: id, aspect, prompt
    python3 tools/imagegen/queue.py show <id>              # one record
    python3 tools/imagegen/queue.py ingest <id> [file]     # move a downloaded image to raw/<id>.png
                                                           #   (default: newest image in ~/Downloads)
    python3 tools/imagegen/queue.py ingest <id> --variant 2   # keep as raw/<id>__2.png

Browser loop per image: `next` → paste the prompt into the generator with the printed aspect
ratio → pick the best result → download → `ingest <id>` → repeat. Then run post.py.
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ASPECT = {"square": "1:1", "landscape": "4:3", "tile": "4:3", "wide": "16:9", "portrait": "2:3"}
# the order that gives the biggest visual win first; concept sheets lead because the Blender
# characters are modelled from them
ORDER = ["concept", "texture", "backdrop", "keyart", "icon"]
IMG_EXT = {".png", ".jpg", ".jpeg", ".webp"}


def manifest() -> list[dict]:
    return json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))["items"]


def done(rid: str) -> bool:
    return (RAW / f"{rid}.png").exists()


def show(it: dict) -> None:
    print(f"id:     {it['id']}\nkind:   {it['kind']}\naspect: {ASPECT.get(it['size'], '1:1')}"
          f"\nout:    {it['out']}\n\n{it['prompt']}\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "next", "show", "ingest"])
    ap.add_argument("id", nargs="?")
    ap.add_argument("file", nargs="?")
    ap.add_argument("--kind")
    ap.add_argument("--variant", type=int, default=1)
    a = ap.parse_args()
    items = manifest()
    by_id = {i["id"]: i for i in items}

    if a.cmd == "status":
        for k in ORDER:
            ks = [i for i in items if i["kind"] == k]
            print(f"{k:<9} {sum(done(i['id']) for i in ks):>3} / {len(ks)}")
        return
    if a.cmd == "next":
        pend = [i for k in ORDER for i in items if i["kind"] == k and (not a.kind or k == a.kind) and not done(i["id"])]
        if not pend:
            print("nothing pending — run: python3 tools/imagegen/post.py --apply-refs")
            return
        show(pend[0])
        print(f"({len(pend) - 1} more pending after this one)")
        return
    if not a.id or a.id not in by_id:
        sys.exit(f"unknown id {a.id!r}")
    if a.cmd == "show":
        show(by_id[a.id])
        return
    # ingest
    src = Path(a.file).expanduser() if a.file else None
    if src is None:
        dl = Path.home() / "Downloads"
        cands = [p for p in dl.iterdir() if p.suffix.lower() in IMG_EXT and time.time() - p.stat().st_mtime < 3600]
        if not cands:
            sys.exit("no image downloaded in ~/Downloads in the last hour; pass the file path")
        src = max(cands, key=lambda p: p.stat().st_mtime)
    RAW.mkdir(exist_ok=True)
    dst = RAW / (f"{a.id}.png" if a.variant == 1 else f"{a.id}__{a.variant}.png")
    if src.suffix.lower() == ".png":
        shutil.move(str(src), dst)
    else:  # normalise to PNG so post.py sees one format
        from PIL import Image
        Image.open(src).convert("RGB").save(dst)
        src.unlink()
    print(f"ingested {src.name} -> {dst.relative_to(HERE.parent.parent)}")


if __name__ == "__main__":
    main()
