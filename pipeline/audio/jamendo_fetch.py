"""
jamendo_fetch.py — CC-licensed music from Jamendo (600k+ tracks).

CLI:
  python jamendo_fetch.py --tag "epic adventure" --count 1 --out ./out
  python jamendo_fetch.py --tag "8bit chiptune" --count 3

Library:
  from jamendo_fetch import fetch_music
  path = fetch_music(tag="retro arcade", dest_dir=Path("games/foo/assets/audio"))
  # Returns Path to downloaded .mp3 (also registers in audio-cache manifest)

License filter:
  We accept CC-BY and CC-BY-SA only (skip CC-BY-ND for compatibility + skip
  any NC license since our games are monetized via ads).

Auth: client_id only (free tier). No OAuth2 needed for preview MP3s.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
CFG_PATH = Path(r"C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json")

sys.path.insert(0, str(Path(__file__).parent))
from audio_cache import cache_path, download, register, tag_hash, lookup  # noqa


def _client_id() -> str:
    cfg = json.loads(CFG_PATH.read_text(encoding="utf-8"))
    # jamendo is at root level (like serpapi, pixabay), not under providers
    return (cfg.get("jamendo") or cfg.get("providers", {}).get("jamendo") or {})["client_id"]


def _license_ok(ccurl: str) -> bool:
    """Accept CC-BY and CC-BY-SA. Reject NC (non-commercial) and ND (no-derivs)."""
    if not ccurl:
        return False
    c = ccurl.lower()
    if "/nc" in c or "-nc/" in c or "/nc-" in c:
        return False
    if "/nd/" in c or "-nd/" in c or "/nd-" in c:
        return False
    return "creativecommons.org" in c or "cc-by" in c


def _license_name(ccurl: str) -> str:
    c = ccurl.lower()
    if "by-sa" in c: return "CC BY-SA 3.0"
    if "by-nc-sa" in c: return "CC BY-NC-SA 3.0"
    if "by-nc" in c: return "CC BY-NC 3.0"
    if "by-nd" in c: return "CC BY-ND 3.0"
    if "by/" in c or "by-" in c: return "CC BY 3.0"
    return "Creative Commons"


def search(tag: str, limit: int = 20) -> list[dict]:
    """Search Jamendo tracks by tag. Returns list of track dicts."""
    cid = _client_id()
    params = {
        "client_id": cid,
        "format": "json",
        "limit": limit,
        "fuzzytags": tag,
        "include": "musicinfo+licenses",
        "audioformat": "mp32",    # 96kbps MP3 preview
        "order": "popularity_total_desc",
    }
    url = f"https://api.jamendo.com/v3.0/tracks/?{urllib.parse.urlencode(params)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ForgeFlow-Games/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        if data.get("headers", {}).get("status") != "success":
            print(f"  [jamendo] search error: {data.get('headers', {}).get('error_message')}")
            return []
        return data.get("results", [])
    except Exception as e:
        print(f"  [jamendo] search failed: {e}")
        return []


def fetch_music(tag: str, dest_dir: Path, count: int = 1, min_duration: int = 60, max_duration: int = 240) -> list[Path]:
    """Fetch up to `count` commercial-safe tracks matching `tag`, save into `dest_dir`.
    Returns list of Path objects. Skips already-cached tracks.
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    results = search(tag, limit=40)
    chosen: list[Path] = []

    for track in results:
        if len(chosen) >= count:
            break
        dur = int(track.get("duration") or 0)
        if dur < min_duration or dur > max_duration:
            continue
        ccurl = track.get("license_ccurl") or ""
        if not _license_ok(ccurl):
            continue
        audio_url = track.get("audio") or track.get("audiodownload")
        if not audio_url:
            continue

        track_id = track.get("id")
        ext = "mp3"
        filename = f"{tag_hash(tag)}_jam_{track_id}.{ext}"
        cached = cache_path("music", filename)

        if not cached.exists():
            ok = download(audio_url, cached)
            if not ok:
                continue

        register(filename, {
            "source": "Jamendo",
            "license": _license_name(ccurl),
            "license_url": ccurl,
            "author": track.get("artist_name", "Unknown"),
            "title": track.get("name", "Untitled"),
            "track_url": f"https://www.jamendo.com/track/{track_id}",
            "kind": "music",
            "tag": tag,
            "duration_sec": dur,
        })

        # Copy into game's audio folder
        out = dest_dir / filename
        if not out.exists():
            out.write_bytes(cached.read_bytes())
        chosen.append(out)

    return chosen


def main():
    ap = argparse.ArgumentParser(description="Download CC-licensed music from Jamendo.")
    ap.add_argument("--tag", required=True, help="Mood/genre tag, e.g. 'epic adventure'")
    ap.add_argument("--count", type=int, default=1, help="Number of tracks to fetch")
    ap.add_argument("--out", default="./out", help="Output directory")
    ap.add_argument("--min-dur", type=int, default=60, help="Min duration (sec)")
    ap.add_argument("--max-dur", type=int, default=240, help="Max duration (sec)")
    args = ap.parse_args()

    out_dir = Path(args.out)
    paths = fetch_music(args.tag, out_dir, count=args.count,
                        min_duration=args.min_dur, max_duration=args.max_dur)
    print(f"Fetched {len(paths)} track(s) for tag '{args.tag}':")
    for p in paths:
        meta = lookup(p.name) or {}
        print(f"  {p.name} — {meta.get('title')} by {meta.get('author')} ({meta.get('license')}, {meta.get('duration_sec')}s)")


if __name__ == "__main__":
    main()
