#!/usr/bin/env python3
"""Generate VALE's painted 2D images with xAI (grok-imagine-image), the API Forgeflow already uses.

    python tools/imagegen/run_xai.py                     # everything missing in tools/imagegen/raw/
    python tools/imagegen/run_xai.py --kind icon         # one kind: concept | icon | keyart | backdrop | texture
    python tools/imagegen/run_xai.py --only ability_marund_domefall --force
    python tools/imagegen/run_xai.py --variants 2        # n images per prompt (raw/<id>__1.png, __2.png …)
    python tools/imagegen/run_xai.py --dry-run           # print what would be generated and the cost
    python tools/imagegen/run_xai.py --only home_feature --force --suffix r2   # keep raw/home_feature__r2.png

Reference images: a record's "refs" (paths under games/vale), its "roster" (fighter ids, or id:skin; built
into one board of the real models by ref_board.py), or --ref <path> send the request to the edit endpoint
with those images, so painted fighters stay on-model. --no-refs forces plain text-to-image.

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
EDIT_API = "https://api.x.ai/v1/images/edits"
VALE = HERE.parent.parent


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


def data_uri(path: Path) -> str:
    import base64
    mime = "image/jpeg" if path.suffix.lower() in (".jpg", ".jpeg") else "image/png"
    return f"data:{mime};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"


def call_edit(key: str, prompt: str, refs: list[Path], n: int, model: str, aspect: str | None = None,
              resolution: str | None = None) -> list[bytes]:
    """Image edit / reference generation: the refs ride along as data URIs (one -> "image", several -> "images").
    If the endpoint refuses aspect_ratio / resolution, retry once without them (the output then follows the ref)."""
    import base64
    imgs = [{"url": data_uri(p), "type": "image_url"} for p in refs]
    extras = [{k: v for k, v in (("aspect_ratio", aspect), ("resolution", resolution)) if v}, {}]
    last = None
    for ex in extras:
        body = {"model": model, "prompt": prompt, "n": n, "response_format": "b64_json", **ex}
        if len(imgs) == 1:
            body["image"] = imgs[0]
        else:
            body["images"] = imgs
        req = urllib.request.Request(EDIT_API, method="POST", data=json.dumps(body).encode("utf-8"),
                                     headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=240) as r:
                data = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 400 and ex:
                last = e.read().decode("utf-8", "replace")[:200]
                print(f"  edit endpoint refused extras {sorted(ex)}: {last}; retrying without them")
                continue
            raise
        out = [base64.b64decode(d["b64_json"]) for d in data.get("data", []) if d.get("b64_json")]
        out += [fetch(d["url"]) for d in data.get("data", []) if d.get("url") and not d.get("b64_json")]
        if out:
            return out
    raise RuntimeError(f"xAI edit returned no image data {last or ''}")


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
    ap.add_argument("--ref", action="append", default=[], help="reference image (repeatable); overrides the record's refs")
    ap.add_argument("--no-refs", action="store_true", help="ignore the record's refs (plain text-to-image)")
    ap.add_argument("--suffix", help="write raw/<id>__<suffix>.png (keeps earlier attempts; pick it in picks.json)")
    a = ap.parse_args()

    man = json.loads((HERE / "manifest.json").read_text(encoding="utf-8"))
    items = [i for i in man["items"]
             if (not a.kind or i["kind"] == a.kind) and (not a.only or i["id"].startswith(a.only))]
    RAW.mkdir(exist_ok=True)
    base = (lambda i: f"{i['id']}__{a.suffix}") if a.suffix else (lambda i: i["id"])
    todo = [i for i in items if a.force or not (RAW / f"{base(i)}.png").exists()]
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
        refs = [Path(r) if Path(r).is_absolute() else VALE / r for r in (a.ref or ([] if a.no_refs else it.get("refs", [])))]
        if not refs and not a.no_refs and it.get("roster"):   # named roster fighters -> a board of their real models
            sys.path.insert(0, str(HERE))
            from ref_board import board
            refs = [board(it["roster"])]
        missing = [str(r) for r in refs if not r.exists()]
        if missing:
            print(f"[{k}/{len(todo)}] skip {it['id']}: missing refs {missing}")
            fail += 1
            continue
        for attempt in range(3):
            try:
                aspect = ASPECT.get(it.get("size", "square"), "1:1")
                res = None if it["kind"] == "icon" else "2k"
                imgs = (call_edit(key, it["prompt"], refs, a.variants, a.model, aspect, res) if refs
                        else call(key, it["prompt"], a.variants, a.model, aspect, res))
                for vi, img in enumerate(imgs):
                    name = f"{base(it)}.png" if vi == 0 else f"{base(it)}__{vi + 1}.png"
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
