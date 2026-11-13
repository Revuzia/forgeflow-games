"""
freesound_fetch.py — CC-licensed sound effects from Freesound (600k+ SFX).

CLI:
  python freesound_fetch.py --tag "laser shot" --count 3 --out ./out
  python freesound_fetch.py --tag "footstep grass" --count 5 --prefer-cc0

Library:
  from freesound_fetch import fetch_sfx
  paths = fetch_sfx(tag="explosion", dest_dir=Path("games/foo/assets/audio"), count=3)

Auth: API token only (no OAuth2 needed for preview OGGs).
License: CC0 + CC Sampling+ accepted; we filter OUT anything with "NonCommercial"
since our games are monetized. Previews are high-quality 192kbps OGG.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CFG_PATH = Path(r"C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json")

sys.path.insert(0, str(Path(__file__).parent))
from audio_cache import cache_path, download, register, tag_hash, lookup  # noqa


def _token() -> str:
    cfg = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    fs = cfg.get("freesound") or cfg.get("providers", {}).get("freesound") or {}
    return fs["api_key"]


LICENSE_OK = {
    "Creative Commons 0": "CC0 1.0",
    "Attribution": "CC BY 4.0",
    "Attribution 4.0": "CC BY 4.0",
    "Attribution 3.0": "CC BY 3.0",
    # Freesound also returns "Attribution NonCommercial" — we REJECT these.
    # Sampling+ is also permissive but rarely used; accept if encountered:
    "Sampling+": "Sampling+",
}


def _license_accepted(name: str) -> str | None:
    """Return normalized license name if acceptable, else None.
    Freesound returns license as a URL (e.g. http://creativecommons.org/publicdomain/zero/1.0/)
    or sometimes a human name. Handle both.
    """
    if not name:
        return None
    low = name.lower()
    # Reject non-commercial first (applies to both URL and text forms)
    if "/nc" in low or "-nc/" in low or "/nc-" in low or "noncommercial" in low or "non-commercial" in low:
        return None
    if "/nd" in low or "-nd/" in low or "/nd-" in low:
        return None
    # CC0 / public domain
    if "publicdomain/zero" in low or "cc0" in low:
        return "CC0 1.0"
    # Sampling+
    if "sampling" in low:
        return "Sampling+"
    # CC-BY (attribution required)
    if "/by/4.0" in low or "/by/3.0" in low or "attribution 4.0" in low or "attribution 3.0" in low or "/by/" in low:
        if "4.0" in low: return "CC BY 4.0"
        if "3.0" in low: return "CC BY 3.0"
        return "CC BY"
    return None


def search(tag: str, limit: int = 20, prefer_cc0: bool = True) -> list[dict]:
    """Search Freesound. Returns sound dicts with preview URLs."""
    token = _token()
    # Build a license filter
    # Freesound filter syntax: license:"Creative Commons 0"
    license_filter = 'license:"Creative Commons 0"' if prefer_cc0 else ''
    params = {
        "query": tag,
        "page_size": limit,
        "fields": "id,name,license,previews,username,url,duration,tags",
        "sort": "rating_desc",
    }
    if license_filter:
        params["filter"] = license_filter
    url = f"https://freesound.org/apiv2/search/text/?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, headers={
            "User-Agent": "ForgeFlow-Games/1.0",
            "Authorization": f"Token {token}",
        })
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        return data.get("results", [])
    except Exception as e:
        print(f"  [freesound] search failed: {e}")
        return []


def fetch_sfx(tag: str, dest_dir: Path, count: int = 3,
              min_duration: float = 0.2, max_duration: float = 8.0,
              prefer_cc0: bool = True) -> list[Path]:
    """Fetch up to `count` SFX matching `tag`, save into `dest_dir`.
    Returns list of Path objects.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    # First try CC0-only (simpler licensing). If we don't get enough, broaden.
    results = search(tag, limit=40, prefer_cc0=prefer_cc0)
    if prefer_cc0 and len(results) < count:
        results += search(tag, limit=40, prefer_cc0=False)

    chosen: list[Path] = []
    seen_ids = set()

    for sound in results:
        if len(chosen) >= count:
            break
        sid = sound.get("id")
        if sid in seen_ids:
            continue
        seen_ids.add(sid)

        dur = float(sound.get("duration") or 0)
        if dur < min_duration or dur > max_duration:
            continue

        lic_normalized = _license_accepted(sound.get("license", ""))
        if not lic_normalized:
            continue

        previews = sound.get("previews") or {}
        audio_url = previews.get("preview-hq-ogg") or previews.get("preview-hq-mp3")
        if not audio_url:
            continue
        ext = "ogg" if "ogg" in audio_url else "mp3"

        filename = f"{tag_hash(tag)}_fs_{sid}.{ext}"
        cached = cache_path("sfx", filename)

        if not cached.exists():
            ok = download(audio_url, cached)
            if not ok:
                continue

        register(filename, {
            "source": "Freesound",
            "license": lic_normalized,
            "license_url": sound.get("license", ""),
            "author": sound.get("username", "Unknown"),
            "title": sound.get("name", "Untitled"),
            "track_url": sound.get("url", f"https://freesound.org/s/{sid}/"),
            "kind": "sfx",
            "tag": tag,
            "duration_sec": dur,
        })

        out = dest_dir / filename
        if not out.exists():
            out.write_bytes(cached.read_bytes())
        chosen.append(out)

    return chosen


def main():
    ap = argparse.ArgumentParser(description="Download CC-licensed SFX from Freesound.")
    ap.add_argument("--tag", required=True, help="Search tag, e.g. 'laser shot'")
    ap.add_argument("--count", type=int, default=3, help="Number of SFX to fetch")
    ap.add_argument("--out", default="./out", help="Output directory")
    ap.add_argument("--prefer-cc0", action="store_true", default=True, help="Prefer CC0 (no attribution)")
    ap.add_argument("--allow-cc-by", action="store_true", help="Allow CC-BY (requires attribution)")
    ap.add_argument("--max-dur", type=float, default=8.0, help="Max duration (sec)")
    args = ap.parse_args()

    paths = fetch_sfx(args.tag, Path(args.out), count=args.count,
                      max_duration=args.max_dur,
                      prefer_cc0=not args.allow_cc_by)
    print(f"Fetched {len(paths)} SFX for tag '{args.tag}':")
    for p in paths:
        meta = lookup(p.name) or {}
        print(f"  {p.name} — {meta.get('title')} by {meta.get('author')} ({meta.get('license')}, {meta.get('duration_sec'):.2f}s)")


if __name__ == "__main__":
    main()
