#!/usr/bin/env python3
"""generate_cover.py — generate a 16:9 key-art cover image for a ForgeFlow game
via xAI's grok-2-image-1212 model. ~$0.02 per generation.

Standard pipeline call:
    from generate_cover import generate_cover
    cover_path = generate_cover(slug, title, short_description, art_direction, out_dir)

Or stand-alone:
    python pipeline/generate_cover.py --slug vector-storm --title "Vector Storm" \\
      --description "Twin-stick neon arena shooter..." \\
      --art "Neon vector graphics on space..." \\
      --out path/to/save.png

The generic prompt template is the SAME for every game. Per-game specifics
are interpolated. This guarantees consistent quality across the catalog while
giving each cover a unique, on-brand look.
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # Claude Claw root
NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"
TOKENS_PATH = ROOT / "state/.secrets/tokens.json"

# Generic prompt template — proven on a dozen+ games. Genre-agnostic, art-direction
# driven. Critical: NO TEXT/LOGO clauses prevent xAI from rendering in-image
# titles that conflict with the portal's overlaid title cards.
PROMPT_TEMPLATE = (
    "Premium video game key art / cover image for the game '{title}'. "
    "{description} "
    "Art direction: {art_direction} "
    "Composition: 16:9 wide aspect, dramatic dynamic angle, action moment captured mid-beat, "
    "strong silhouette of the player character or main object as focal point, "
    "rich foreground/midground/background depth. "
    "Style: professional digital painting / promotional key art quality, "
    "Steam-store-grade polish, vibrant saturated palette, high contrast, "
    "dramatic rim lighting, particle effects suggesting motion. "
    "STRICT NO-NO: no text, no logos, no titles, no UI overlays, no watermarks, "
    "no human figures unless the game is character-driven. Pure visual storytelling."
)


def _load_xai_key() -> str:
    if not TOKENS_PATH.exists():
        raise RuntimeError(f"tokens.json not found at {TOKENS_PATH}")
    d = json.loads(TOKENS_PATH.read_text(encoding="utf-8"))
    key = d.get("xai_api_key", "")
    if not key:
        raise RuntimeError("xai_api_key missing in tokens.json")
    return key


def generate_cover(slug: str, title: str, description: str, art_direction: str,
                   out_dir: Path, model: str = "grok-imagine-image") -> Path:
    """Generate a cover image for one game. Returns the saved file path.

    Cost: ~$0.02 per call (xAI grok-2-image pricing as of 2026-05-05).
    Image is 1024x768 by default (xAI's grok-2-image fixed size).
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "thumbnail.png"

    prompt = PROMPT_TEMPLATE.format(
        title=title,
        description=description,
        art_direction=art_direction,
    )

    print(f"[cover] Generating cover for {slug!r} via xAI {model}...")
    print(f"[cover] Prompt length: {len(prompt)} chars")

    api_key = _load_xai_key()
    req = urllib.request.Request(
        "https://api.x.ai/v1/images/generations",
        method="POST",
        data=json.dumps({
            "model": model,
            "prompt": prompt,
            "n": 1,
            "response_format": "url",
        }).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        msg = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"xAI image API failed ({e.code}): {msg[:500]}")
    except Exception as e:
        raise RuntimeError(f"xAI image API request failed: {e}")

    if not body.get("data") or not body["data"][0].get("url"):
        raise RuntimeError(f"xAI returned no image URL: {body}")

    img_url = body["data"][0]["url"]
    print(f"[cover] Got image URL, downloading...")

    img_req = urllib.request.Request(img_url, headers={"User-Agent": "ForgeFlow/1.0"})
    img_resp = urllib.request.urlopen(img_req, timeout=60)
    img_bytes = img_resp.read()
    out_path.write_bytes(img_bytes)
    print(f"[cover] Saved {len(img_bytes)} bytes to {out_path}")
    return out_path


def main():
    parser = argparse.ArgumentParser(description="Generate a cover image for a game via xAI")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--description", required=True,
                        help="Short description (1-2 sentences) of the game's premise + setting")
    parser.add_argument("--art", required=True,
                        help="Art direction string — visual style, palette, mood")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--model", default="grok-imagine-image")
    args = parser.parse_args()

    out = generate_cover(
        slug=args.slug,
        title=args.title,
        description=args.description,
        art_direction=args.art,
        out_dir=Path(args.out),
        model=args.model,
    )
    print(f"\nDone: {out}")


if __name__ == "__main__":
    main()
