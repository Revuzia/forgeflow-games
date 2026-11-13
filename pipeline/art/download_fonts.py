#!/usr/bin/env python3
"""
download_fonts.py — Download curated game-appropriate Google Fonts.

Google Fonts is SIL OFL (free commercial use, no attribution required in-app).
Static URLs for each font at `https://fonts.google.com/download?family=<name>`.
The download is a ZIP — we extract and copy the .ttf/.woff files.

Curated set for game UI:
  - Press Start 2P    — retro 8-bit style
  - Silkscreen        — readable pixel font
  - VT323             — terminal/retro
  - Pixelify Sans     — modern pixel
  - Orbitron          — sci-fi UI
  - Russo One         — heavy impact UI
  - Bungee            — chunky display
  - Oswald            — condensed sans (readable)
  - Bebas Neue        — classic condensed caps
  - IBM Plex Mono     — code / terminal
"""
import json
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
FONTS_DIR = ROOT / "forgeflow-games" / "pipeline" / "assets" / "_downloaded" / "fonts"
FONTS_DIR.mkdir(parents=True, exist_ok=True)

CURATED_FAMILIES = [
    "Press+Start+2P", "Silkscreen", "VT323", "Pixelify+Sans",
    "Orbitron", "Russo+One", "Bungee", "Oswald", "Bebas+Neue", "IBM+Plex+Mono",
]


def download_font(family: str) -> bool:
    """Use Google Fonts CSS2 API — returns CSS with direct woff2 URLs we can fetch.

    `/download?family=X` requires session; `/css2?family=X` is public + scrapable.
    """
    import re
    name = family.replace("+", "_")
    out_dir = FONTS_DIR / name
    if out_dir.exists() and any(out_dir.rglob("*.woff2")):
        print(f"  SKIP {name} (already downloaded)")
        return True
    out_dir.mkdir(exist_ok=True)
    # CSS2 API returns different woff2 per user-agent. Request woff2.
    css_url = f"https://fonts.googleapis.com/css2?family={family}&display=swap"
    try:
        req = urllib.request.Request(css_url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        })
        with urllib.request.urlopen(req, timeout=30) as r:
            css = r.read().decode("utf-8", errors="replace")
        woff2_urls = re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)", css)
        if not woff2_urls:
            print(f"  FAIL {name}: no woff2 URLs in CSS response")
            return False
        # Save the CSS for reference
        (out_dir / f"{name}.css").write_text(css, encoding="utf-8")
        # Download each woff2 (usually 1-3 per family for different unicode ranges)
        count = 0
        for i, w2 in enumerate(set(woff2_urls)):
            try:
                req2 = urllib.request.Request(w2, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req2, timeout=30) as r:
                    (out_dir / f"{name}_{i:02d}.woff2").write_bytes(r.read())
                    count += 1
            except Exception as e:
                pass
        print(f"  OK {name}: {count} woff2 files")
        return count > 0
    except Exception as e:
        print(f"  FAIL {name}: {e}")
        return False


def main():
    for family in CURATED_FAMILIES:
        download_font(family)


if __name__ == "__main__":
    main()
