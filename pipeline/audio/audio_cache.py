"""
audio_cache.py — shared audio cache + CREDITS.md builder.

Cache layout:
  assets/_downloaded/audio-cache/
    music/
      {tag}_{track_id}.{ext}     # e.g. "adventure_epic_1234567.mp3"
    sfx/
      {tag}_{sound_id}.{ext}
    _manifest.json               # {file -> {source, license, author, track_url}}

Per-game CREDITS.md is generated at build time from _manifest.json entries
matching the assets copied into the game folder.
"""
from __future__ import annotations

import hashlib
import json
import urllib.request
from pathlib import Path
from typing import Literal

ROOT = Path(__file__).resolve().parent.parent.parent
CACHE_DIR = ROOT / "pipeline" / "assets" / "_downloaded" / "audio-cache"
MANIFEST = CACHE_DIR / "_manifest.json"


def _load_manifest() -> dict:
    if MANIFEST.exists():
        try:
            return json.loads(MANIFEST.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_manifest(m: dict) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, indent=2), encoding="utf-8")


def tag_hash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


def cache_path(kind: Literal["music", "sfx"], filename: str) -> Path:
    d = CACHE_DIR / kind
    d.mkdir(parents=True, exist_ok=True)
    return d / filename


def download(url: str, dest: Path, timeout: int = 30) -> bool:
    """Download a file to dest. Returns True on success. Skips if already exists."""
    if dest.exists() and dest.stat().st_size > 0:
        return True
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ForgeFlow-Games/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        dest.write_bytes(data)
        return dest.stat().st_size > 0
    except Exception as e:
        print(f"  [audio-cache] download failed: {url[:60]} -> {e}")
        return False


def register(key: str, meta: dict) -> None:
    """Register a cached audio file in the manifest. `meta` fields:
       source, license, license_url, author, track_url, title, kind, tag.
    """
    m = _load_manifest()
    m[key] = meta
    _save_manifest(m)


def lookup(key: str) -> dict | None:
    return _load_manifest().get(key)


def build_credits_for_game(game_dir: Path, audio_files: list[str]) -> None:
    """Generate CREDITS.md for a game, listing every non-CC0 audio track.
    audio_files = list of filenames (as they appear in the game's assets/audio/ folder).
    """
    m = _load_manifest()
    lines = [f"# Credits — {game_dir.name}\n",
             "## Audio\n"]
    has_entries = False
    # Group by source
    by_source: dict[str, list[dict]] = {}
    for fn in audio_files:
        key = fn  # filename used as cache key in our scheme
        meta = m.get(key) or m.get(Path(fn).stem)
        if not meta:
            continue
        lic = (meta.get("license") or "").lower()
        if "cc0" in lic or "public domain" in lic:
            continue  # CC0 = no attribution required
        has_entries = True
        src = meta.get("source", "Unknown")
        by_source.setdefault(src, []).append({
            "title": meta.get("title", "Untitled"),
            "author": meta.get("author", "Unknown"),
            "license": meta.get("license", "Unknown"),
            "license_url": meta.get("license_url", ""),
            "track_url": meta.get("track_url", ""),
        })
    for src, entries in by_source.items():
        lines.append(f"\n### {src}\n")
        for e in entries:
            lic_str = f"[{e['license']}]({e['license_url']})" if e['license_url'] else e['license']
            line = f"- **{e['title']}** by {e['author']} — {lic_str}"
            if e.get("track_url"):
                line += f" ([source]({e['track_url']}))"
            lines.append(line)
    if has_entries:
        (game_dir / "CREDITS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    # CC0-only games get no CREDITS.md (not legally required)


if __name__ == "__main__":
    print(f"Cache dir: {CACHE_DIR}")
    m = _load_manifest()
    print(f"Manifest entries: {len(m)}")
    for k, v in list(m.items())[:5]:
        print(f"  {k}: {v.get('title')} ({v.get('license')})")
