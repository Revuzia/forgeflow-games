#!/usr/bin/env python3
"""
music_generator.py -- Generate original game music via Stable Audio API.

Per 2026-04-17 research, **Stable Audio is the best production choice** for
automated music generation:
  - $0.035 per track (~20x cheaper than ElevenLabs, ~3x cheaper than Suno wrappers)
  - Official commercial-licensed API (no TOS risk like Suno wrappers)
  - 90-120 second clips, loopable
  - https://api.stability.ai/v2beta/audio/stable-audio-2/

Cost at scale: 10 tracks/game × $0.035 = $0.35/game. 50 games = $17.50 total.

Fallback chain:
  1. Stable Audio (if STABILITY_API_KEY in api_config.json)
  2. Pre-existing Kenney music from assets/music/ (random pick matching theme)
  3. Fail gracefully -- game still ships, silent or with Kenney fallback

Usage (as module):
    from music_generator import generate_music, generate_music_for_game
    path = generate_music("upbeat tropical jungle theme, 120 seconds, loopable", output_path)

CLI:
    python scripts/music_generator.py --prompt "..." --out file.mp3
    python scripts/music_generator.py --game-dir path/to/game  # reads prompts from music_prompts/
"""
import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

NOMI = Path(os.path.expandvars("%APPDATA%")) / "Nomi"
ROOT = Path(__file__).resolve().parent.parent.parent.parent
PIPELINE_DIR = ROOT / "forgeflow-games" / "pipeline"
KENNEY_MUSIC = PIPELINE_DIR / "assets" / "music"


def _load_stability_key() -> str:
    """Get Stability AI key from api_config.json. Returns empty string if missing."""
    try:
        cfg = json.loads((NOMI / "api_config.json").read_text(encoding="utf-8"))
        # Look in a few plausible locations
        return (
            cfg.get("stability", {}).get("api_key")
            or cfg.get("providers", {}).get("stability", {}).get("api_key")
            or cfg.get("stable_audio", {}).get("api_key")
            or ""
        )
    except Exception:
        return ""


def generate_music(prompt: str, output_path: Path, duration_seconds: int = 90,
                   model: str = "stable-audio-2") -> bool:
    """Generate a single music track via Stable Audio. Returns True on success."""
    key = _load_stability_key()
    if not key:
        print("[music] No Stability AI key found -- skipping generation")
        return False

    url = f"https://api.stability.ai/v2beta/audio/{model}/text-to-audio"

    # 2026-04-22 FIX: Stability AI requires multipart/form-data (not JSON) and
    # Accept: audio/* (not audio/mpeg). JSON POST returned 400 "content-type:
    # must be multipart/form-data".
    import uuid
    boundary = f"----ForgeFlowBoundary{uuid.uuid4().hex}"
    fields = {
        "prompt":        prompt,
        "duration":      str(duration_seconds),
        "output_format": "mp3",
        "steps":         "50",
    }
    body_parts = []
    for _n, _v in fields.items():
        body_parts.append(f"--{boundary}\r\n".encode())
        body_parts.append(f'Content-Disposition: form-data; name="{_n}"\r\n\r\n'.encode())
        body_parts.append(_v.encode("utf-8"))
        body_parts.append(b"\r\n")
    body_parts.append(f"--{boundary}--\r\n".encode())
    payload = b"".join(body_parts)

    req = urllib.request.Request(
        url, data=payload,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type":  f"multipart/form-data; boundary={boundary}",
            "Accept":        "audio/*",
            "User-Agent":    "ForgeFlow/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            audio_bytes = resp.read()
            if len(audio_bytes) < 10_000:  # sanity check -- real MP3 is at least 10KB
                print(f"[music] Response too small ({len(audio_bytes)} bytes) -- likely error")
                return False
            output_path.write_bytes(audio_bytes)
            print(f"[music] Generated {output_path.name} ({len(audio_bytes) / 1024:.0f} KB)")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")[:300]
        print(f"[music] HTTPError {e.code}: {body}")
        return False
    except Exception as e:
        print(f"[music] Error: {e}")
        return False


def fallback_to_kenney(theme: str, output_path: Path, used: set | None = None) -> bool:
    """Pick a Kenney music track matching the theme. Always succeeds if Kenney exists.

    2026-04-22 FIX: rotate through candidates -- `used` is a set of absolute paths
    of Kenney tracks already assigned this run. Without this, every world copied
    the same 'boss_theme.ogg' because the filename match always returned the
    same first hit.
    """
    if not KENNEY_MUSIC.exists():
        return False
    candidates = sorted(list(KENNEY_MUSIC.glob("*.ogg")) + list(KENNEY_MUSIC.glob("*.mp3")))
    if not candidates:
        return False
    used = used if used is not None else set()
    theme_lower = theme.lower()

    # Prefer unused theme-matches, then any unused track, then fall back to reuse.
    matching = [f for f in candidates if any(k in f.name.lower() for k in theme_lower.split())]
    unused_matching = [f for f in matching if str(f) not in used]
    unused_any = [f for f in candidates if str(f) not in used]

    if unused_matching:
        chosen = unused_matching[0]
    elif unused_any:
        chosen = unused_any[0]
    elif matching:
        chosen = matching[0]
    else:
        chosen = candidates[0]

    used.add(str(chosen))
    import shutil
    shutil.copy2(chosen, output_path.with_suffix(chosen.suffix))
    print(f"[music] Fallback to Kenney: {chosen.name} -> {output_path.name}")
    return True


def generate_music_for_game(game_dir: Path, max_tracks: int = 10) -> dict:
    """Read music_prompts/ inside a game dir, generate music for each prompt.

    Returns dict with counts + per-track status.
    """
    prompts_dir = game_dir / "assets" / "music_prompts"
    music_dir   = game_dir / "assets" / "music"
    music_dir.mkdir(parents=True, exist_ok=True)

    if not prompts_dir.exists():
        return {"error": "no music_prompts/ dir in game", "generated": 0}

    prompt_files = sorted(prompts_dir.glob("*.txt"))[:max_tracks]
    if not prompt_files:
        return {"error": "no prompt files", "generated": 0}

    results = {"generated": 0, "fallback": 0, "failed": 0, "cached": 0, "tracks": []}
    used_kenney: set[str] = set()  # 2026-04-22: rotate Kenney fallback across tracks
    for pf in prompt_files:
        prompt_text = pf.read_text(encoding="utf-8").strip()
        # Use stem (e.g. "world_01") as output name
        out_path = music_dir / f"{pf.stem}.mp3"
        if out_path.exists():
            # Counted as "cached" so the summary shows N already-on-disk tracks
            # rather than hiding them in a vague "0 generated / 0 fallback".
            print(f"[music] Reuse cached: {out_path.name}")
            results["cached"] += 1
            results["tracks"].append({"name": pf.stem, "source": "cached"})
            continue

        # Try Stable Audio first
        ok = generate_music(prompt_text, out_path, duration_seconds=90)
        if ok:
            results["generated"] += 1
            results["tracks"].append({"name": pf.stem, "source": "stable_audio"})
        else:
            # Extract theme hint from prompt for Kenney fallback
            theme = prompt_text.split("\n")[0].lower()
            ok_fb = fallback_to_kenney(theme, out_path, used=used_kenney)
            if ok_fb:
                results["fallback"] += 1
                results["tracks"].append({"name": pf.stem, "source": "kenney_fallback"})
            else:
                results["failed"] += 1
                results["tracks"].append({"name": pf.stem, "source": "failed"})
        time.sleep(1)  # polite pause between API calls

    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", help="Generate single track from text prompt")
    ap.add_argument("--out", help="Output file path (for --prompt mode)")
    ap.add_argument("--duration", type=int, default=90)
    ap.add_argument("--game-dir", help="Generate all music for a game (reads music_prompts/)")
    args = ap.parse_args()

    if args.prompt and args.out:
        ok = generate_music(args.prompt, Path(args.out), args.duration)
        sys.exit(0 if ok else 1)
    elif args.game_dir:
        result = generate_music_for_game(Path(args.game_dir))
        print(json.dumps(result, indent=2))
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
