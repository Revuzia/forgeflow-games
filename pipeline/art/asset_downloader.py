#!/usr/bin/env python3
"""
asset_downloader.py — Download additional CC0 asset packs to grow our library.

Per 2026-04-17 research, we can push from 5,502 assets to 25,000+ by pulling:
  - Poly Haven (~2,100 CC0 HDRIs + PBR textures + 3D)
  - Poly Pizza (10,500+ CC0 3D models)
  - Freesound CC0 subset (372k sounds, filter via OAuth)
  - More Kenney packs (particle-pack, light-masks, platformer-kit-3d, etc.)
  - Game-Icons.net (4,170 CC-BY icons — bulk archive)
  - Mixamo animations (via Adobe, per-script)

This module handles downloads where APIs are available. For sources without
bulk APIs, it generates a TASKS.md file the user can step through.

Priority order (biggest volume / lowest effort first):
  1. Poly Haven  — has JSON API, fully automatable
  2. Kenney additional packs — direct ZIP URLs
  3. Game-Icons.net — single bulk archive URL
  4. Freesound CC0 — requires free API key (user sets up once)
  5. Poly Pizza — no bulk API, manual or scrape-based
  6. Mixamo — manual (Adobe requires login)

Usage:
  python scripts/asset_downloader.py --source polyhaven --kind textures --limit 50
  python scripts/asset_downloader.py --source kenney --pack particle-pack
  python scripts/asset_downloader.py --source all  # runs everything automated
"""
import argparse
import json
import os
import time
import urllib.request
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
PIPELINE_DIR = ROOT / "forgeflow-games" / "pipeline"
ASSETS_DIR = PIPELINE_DIR / "assets"
EXTRA_ASSETS_DIR = ASSETS_DIR / "_downloaded"
EXTRA_ASSETS_DIR.mkdir(exist_ok=True, parents=True)


def _get(url, dest_path: Path, timeout: int = 60) -> bool:
    """Download a URL to dest_path. Returns True on success."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ForgeFlow/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        dest_path.write_bytes(data)
        return True
    except Exception as e:
        print(f"  [download] {url} -> FAIL {e}")
        return False


# ── Poly Haven (CC0) ────────────────────────────────────────────────────────

def polyhaven_list(kind: str = "hdris") -> dict:
    """List all Poly Haven assets of a given kind (hdris, textures, models)."""
    url = f"https://api.polyhaven.com/assets?type={kind}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ForgeFlow/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"  [polyhaven] list failed: {e}")
        return {}


def polyhaven_download(slug: str, kind: str, resolution: str = "2k") -> bool:
    """Download one Poly Haven asset (HDRI/texture/model)."""
    # Get asset files metadata
    files_url = f"https://api.polyhaven.com/files/{slug}"
    try:
        req = urllib.request.Request(files_url, headers={"User-Agent": "ForgeFlow/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            files = json.loads(r.read())
    except Exception as e:
        print(f"  [polyhaven] files lookup {slug}: {e}")
        return False

    dest_dir = EXTRA_ASSETS_DIR / f"polyhaven-{kind}" / slug
    dest_dir.mkdir(parents=True, exist_ok=True)
    downloaded = 0

    if kind == "hdris":
        # HDR file at chosen resolution
        hdri = files.get("hdri", {}).get(resolution, {}).get("hdr")
        if hdri and hdri.get("url"):
            ext = hdri["url"].rsplit(".", 1)[-1]
            dest = dest_dir / f"{slug}_{resolution}.{ext}"
            if _get(hdri["url"], dest):
                downloaded += 1
    elif kind == "textures":
        # Grab diffuse + normal + rough at chosen resolution
        blend = files.get("blend", {}).get(resolution, {})
        for map_type in ("Diffuse", "AO", "Normal", "Rough", "Displacement"):
            m = files.get(map_type, {}).get(resolution, {}).get("jpg")
            if m and m.get("url"):
                dest = dest_dir / f"{map_type.lower()}.jpg"
                if _get(m["url"], dest):
                    downloaded += 1
    elif kind == "models":
        gltf = files.get("gltf", {}).get(resolution, {}).get("gltf")
        if gltf and gltf.get("url"):
            dest = dest_dir / f"{slug}.gltf"
            if _get(gltf["url"], dest):
                downloaded += 1
        # Also grab associated bin + textures if present
        for k in ("bin", "png", "jpg"):
            for m in files.get(k, {}).get(resolution, {}).values():
                if isinstance(m, dict) and m.get("url"):
                    name = m["url"].rsplit("/", 1)[-1]
                    dest = dest_dir / name
                    if _get(m["url"], dest):
                        downloaded += 1

    return downloaded > 0


def polyhaven_bulk(kind: str, limit: int = 50, resolution: str = "2k") -> int:
    """Download up to `limit` assets of kind from Poly Haven."""
    listing = polyhaven_list(kind)
    if not listing:
        return 0
    print(f"[polyhaven] {kind}: {len(listing)} available, downloading {limit}")
    count = 0
    for slug in list(listing.keys())[:limit]:
        if polyhaven_download(slug, kind, resolution):
            count += 1
        time.sleep(0.5)  # polite
        if count >= limit:
            break
    return count


# ── Kenney additional packs (direct ZIP URLs) ────────────────────────────────

# Kenney pack slugs — URLs are auto-scraped from kenney.nl/assets/<slug> at runtime
# because Kenney rotates cache-buster timestamps in the URLs.
KENNEY_PACK_SLUGS = [
    "platformer-kit",
    "light-masks",
    "input-prompts",
    "new-platformer-pack",
    "particle-pack",
    "ui-audio",
    "impact-sounds",
    "interface-sounds",
    "cube-pets",
    "modular-dungeon-kit",
    "pirate-kit",
    "graveyard-kit",
    "modular-space-kit",
    "car-kit",
    "development-essentials",
    "mobile-controls",
    "retro-textures-fantasy",
]


def _scrape_kenney_zip_url(slug: str) -> str | None:
    """Fetch https://kenney.nl/assets/<slug> and extract the current ZIP URL.

    URLs include a cache-busting timestamp that rotates, so we can't hardcode them.
    """
    page_url = f"https://kenney.nl/assets/{slug}"
    try:
        req = urllib.request.Request(page_url, headers={"User-Agent": "ForgeFlow/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            html = r.read().decode("utf-8", errors="replace")
        # Find ZIP URLs matching kenney.nl/media/pages/assets/<slug>/...zip
        import re
        matches = re.findall(r'(https://kenney\.nl/media/pages/assets/[^"]+\.zip)', html)
        if matches:
            # Prefer the first (usually the main pack download)
            return matches[0]
    except Exception as e:
        print(f"  [kenney] scrape {slug}: {e}")
    return None


def kenney_download_pack(pack_slug: str) -> bool:
    """Scrape + download a Kenney pack by slug. Auto-refreshes rotating URLs."""
    url = _scrape_kenney_zip_url(pack_slug)
    if not url:
        print(f"  [kenney] could not find ZIP URL for {pack_slug!r}")
        return False
    dest_zip = EXTRA_ASSETS_DIR / f"{pack_slug}.zip"
    if dest_zip.exists() and dest_zip.stat().st_size > 1000:
        print(f"  [kenney] already downloaded: {pack_slug}")
        return True
    if not _get(url, dest_zip, timeout=300):
        return False
    # Extract
    try:
        import zipfile
        extract_dir = EXTRA_ASSETS_DIR / pack_slug
        extract_dir.mkdir(exist_ok=True)
        with zipfile.ZipFile(dest_zip, "r") as z:
            z.extractall(extract_dir)
        print(f"  [kenney] extracted {pack_slug}")
        return True
    except Exception as e:
        print(f"  [kenney] extract failed: {e}")
        return False


# ── Game-Icons.net (CC-BY bulk archive) ──────────────────────────────────────

def game_icons_download() -> bool:
    """Download the full Game-Icons archive (~4,170 icons)."""
    url = "https://game-icons.net/archives/svg/zip/000000/transparent/game-icons.net.svg.zip"
    dest = EXTRA_ASSETS_DIR / "game-icons.zip"
    if dest.exists() and dest.stat().st_size > 100000:
        print(f"  [game-icons] already downloaded")
        return True
    if not _get(url, dest, timeout=300):
        return False
    try:
        import zipfile
        extract_dir = EXTRA_ASSETS_DIR / "game-icons"
        extract_dir.mkdir(exist_ok=True)
        with zipfile.ZipFile(dest, "r") as z:
            z.extractall(extract_dir)
        print(f"  [game-icons] extracted to {extract_dir}")
        return True
    except Exception as e:
        print(f"  [game-icons] extract failed: {e}")
        return False


# ── Manual / per-user steps (no bulk API) ────────────────────────────────────

def write_manual_tasks():
    """Write a TASKS.md file in EXTRA_ASSETS_DIR listing sources that need user action."""
    tasks = [
        "# Asset Pack Manual Tasks",
        "",
        "These sources don't have bulk download APIs — they require user action:",
        "",
        "## Mixamo (Adobe login required)",
        "- URL: https://mixamo.com",
        "- ~2,500 free motion-capture animations for humanoid FBX",
        "- Auto-rigging for custom 3D characters",
        "- Action: log in with Adobe ID, download packs manually or via scripted Mixamo-downloader GitHub tools",
        "",
        "## Freesound CC0 subset (372k sounds)",
        "- URL: https://freesound.org/apiv2/apply",
        "- Action: apply for a free API token (manual approval ~24h)",
        "- Once approved, add to api_config.json: `\"freesound\": {\"api_key\": \"...\"}`",
        "- Pipeline can then bulk-pull sounds filtered by license:cc0",
        "",
        "## Poly Pizza (10,500 CC0 models)",
        "- URL: https://poly.pizza",
        "- No bulk API — would require scripted scraping",
        "- For now: pull individual models when a specific game needs them",
        "",
        "## CraftPix freebies (281 pages)",
        "- URL: https://craftpix.net/freebies",
        "- Per-pack download, no bulk",
        "- Action: pick top 20 high-quality packs manually, extract to pipeline/assets/",
    ]
    (EXTRA_ASSETS_DIR / "TASKS.md").write_text("\n".join(tasks), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["polyhaven", "kenney", "game-icons", "all"], default="all")
    ap.add_argument("--kind", choices=["hdris", "textures", "models"], default="textures",
                    help="For polyhaven: kind of asset")
    ap.add_argument("--pack", help="For kenney: pack slug")
    ap.add_argument("--limit", type=int, default=30)
    ap.add_argument("--resolution", default="2k")
    args = ap.parse_args()

    if args.source in ("polyhaven", "all"):
        if args.source == "polyhaven":
            count = polyhaven_bulk(args.kind, args.limit, args.resolution)
            print(f"Poly Haven {args.kind}: downloaded {count}")
        else:
            for kind in ("hdris", "textures", "models"):
                count = polyhaven_bulk(kind, args.limit, args.resolution)
                print(f"Poly Haven {kind}: downloaded {count}")

    if args.source in ("kenney", "all"):
        packs = [args.pack] if args.pack else KENNEY_PACK_SLUGS
        for p in packs:
            kenney_download_pack(p)

    if args.source in ("game-icons", "all"):
        game_icons_download()

    write_manual_tasks()
    print()
    print("Manual steps list written to:", EXTRA_ASSETS_DIR / "TASKS.md")


if __name__ == "__main__":
    main()
