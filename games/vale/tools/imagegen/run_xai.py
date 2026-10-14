#!/usr/bin/env python3
"""Generate VALE's painted 2D images with xAI (grok-imagine-image), the API Forgeflow already uses.

    python tools/imagegen/run_xai.py                     # everything missing in tools/imagegen/raw/
    python tools/imagegen/run_xai.py --kind icon         # one kind: concept | icon | keyart | backdrop | texture
    python tools/imagegen/run_xai.py --only ability_marund_domefall --force
    python tools/imagegen/run_xai.py --variants 2        # n images per prompt (raw/<id>__1.png, __2.png …)
    python tools/imagegen/run_xai.py --dry-run           # print what would be generated and the cost

Key: $XAI_API_KEY, else tokens.json {"xai_api_key": …} found at the Forgeflow location
(<Claude Claw root>/state/.secrets/tokens.json, the same file pipeline/generate_cover.py reads),
else --tokens <path>. The key is never printed or written anywhere.

Raw images land in tools/imagegen/raw/ (gitignored). Then run tools/imagegen/post.py to produce
the shipped files. ~$0.02 per image (pipeline note, 2026-05); the full pack is ~190 images.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
API = "https://api.x.ai/v1/images/generations"


def find_key(explicit: str | None) -> str:
    if os.environ.get("XAI_API_KEY"):
        return os.environ["XAI_API_KEY"].strip()
    cands = [Path(explicit)] if explicit else []
    for up in range(2, 7):  # walk up from games/vale/tools/imagegen to find state/.secrets/tokens.json
        base = HERE.parents[up] if up < len(HERE.parents) else None
        if base:
            cands.append(base / "state" / ".secrets" / "tokens.json")
    for c in cands:
        if c and c.exists():
            key = json.loads(c.read_text(encoding="utf-8")).get("xai_api_key", "")
            if key:
                return key.strip()
    sys.exit("no xAI key: set XAI_API_KEY or pass --tokens <path to tokens.json with xai_api_key>")


# the record's size class -> the API's aspect ratio (same table as queue.py); icons at the default
# resolution (1024²), everything else at "2k" (16:9 = 2816×1584) so key art and backdrops are not upscaled
ASPECT = {"square": "1:1", "landscape": "4:3", "wide": "16:9", "portrait": "2:3"}


def call(key: str, prompt: str, n: int, model: str, aspect: str | None = None, resolution: str | None = None) -> list[bytes]:
    """Ask for base64 image data first (only api.x.ai has to be reachable); fall back to URLs."""
    import base64
    for fmt in ("b64_json", "url"):
        body = {"model": model, "prompt": prompt, "n": n, "response_format": fmt}
        if aspect:
            body["aspect_ratio"] = aspect
        if resolution:
            body["resolution"] = resolution
        req = urllib.request.Request(API, method="POST", data=json.dumps(body).encode("utf-8"),
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 400 and fmt == "b64_json":
                continue  # this model/account only serves URLs
            raise
        out = [base64.b64decode(d["b64_json"]) for d in data.get("data", []) if d.get("b64_json")]
        out += [fetch(d["url"]) for d in data.get("data", []) if d.get("url") and not d.get("b64_json")]
        if out:
            return out
    raise RuntimeError("xAI returned no image data")


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "Forgeflow-Vale/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind"), ap.add_argument("--only", help="id or id prefix")
    ap.add_argument("--force", action="store_true"), ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--variants", type=int, default=1), ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--tokens"), ap.add_argument("--model", default="grok-imagine-image")
    ap.add_argument("--sleep", type=float, default=1.0)
    a = ap.parse_args()

    man = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    items = [i for i in man["items"]
             if (not a.kind or i["kind"] == a.kind) and (not a.only or i["id"].startswith(a.only))]
    RAW.mkdir(exist_ok=True)
    todo = [i for i in items if a.force or not (RAW / f"{i['id']}.png").exists()]
    if a.limit:
        todo = todo[: a.limit]
    print(f"{len(todo)} to generate ({len(items)} matched), ~${0.02 * len(todo) * a.variants:.2f}")
    if a.dry_run:
        for i in todo:
            print(f"  {i['id']:<48} {i['kind']:<8} -> {i['out']}")
        return
    key = find_key(a.tokens)
    ok = fail = 0
    for k, it in enumerate(todo, 1):
        for attempt in range(3):
            try:
                imgs = call(key, it["prompt"], a.variants, a.model, ASPECT.get(it.get("size", "square"), "1:1"),
                            None if it["kind"] == "icon" else "2k")
                for vi, img in enumerate(imgs):
                    name = f"{it['id']}.png" if vi == 0 else f"{it['id']}__{vi + 1}.png"
                    (RAW / name).write_bytes(img)
                ok += 1
                print(f"[{k}/{len(todo)}] ok   {it['id']}")
                break
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", "replace")[:200]
                print(f"[{k}/{len(todo)}] http {e.code} {it['id']}: {msg}")
                if e.code in (400, 401, 403):
                    break
                time.sleep(5 * (attempt + 1))
            except Exception as e:  # network hiccup
                print(f"[{k}/{len(todo)}] err  {it['id']}: {e}")
                time.sleep(5 * (attempt + 1))
        else:
            fail += 1
        time.sleep(a.sleep)
    print(f"done: {ok} ok, {fail} failed. Next: python tools/imagegen/post.py --apply-refs")


if __name__ == "__main__":
    main()
