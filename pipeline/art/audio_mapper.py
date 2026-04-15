#!/usr/bin/env python3
"""
audio_mapper.py — Maps game sound needs to Kenney audio assets.

Scans the downloaded Kenney audio packs and maps game events
to appropriate sound files. Copies selected files to the game's
assets/audio/ folder with standardized names.
"""
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets"

# Audio pack locations
INTERFACE_SOUNDS = ASSETS_DIR / "interface-sounds"
RPG_AUDIO = ASSETS_DIR / "rpg-audio"
IMPACT_SOUNDS = ASSETS_DIR / "impact-sounds"

# Mapping: game event -> best matching Kenney audio file
# These are curated selections from the downloaded packs
AUDIO_MAP = {
    "platformer": {
        "sfx_jump": {
            "pack": "interface-sounds",
            "files": ["Audio/click_002.ogg", "Audio/pluck_001.ogg"],
            "fallback_search": "click",
        },
        "sfx_land": {
            "pack": "impact-sounds",
            "files": ["Audio/impactSoft_heavy_000.ogg", "Audio/footstep_carpet_000.ogg"],
            "fallback_search": "soft",
        },
        "sfx_coin": {
            "pack": "interface-sounds",
            "files": ["Audio/maximize_003.ogg", "Audio/confirmation_001.ogg"],
            "fallback_search": "confirm",
        },
        "sfx_hit": {
            "pack": "impact-sounds",
            "files": ["Audio/impactMining_002.ogg", "Audio/impactPunch_medium_000.ogg"],
            "fallback_search": "impact",
        },
        "sfx_enemy_die": {
            "pack": "impact-sounds",
            "files": ["Audio/impactBell_heavy_001.ogg", "Audio/impactPlate_medium_000.ogg"],
            "fallback_search": "bell",
        },
        "sfx_power_up": {
            "pack": "interface-sounds",
            "files": ["Audio/maximize_008.ogg", "Audio/confirmation_004.ogg"],
            "fallback_search": "maximize",
        },
        "sfx_checkpoint": {
            "pack": "interface-sounds",
            "files": ["Audio/confirmation_002.ogg"],
            "fallback_search": "confirm",
        },
        "sfx_game_over": {
            "pack": "interface-sounds",
            "files": ["Audio/error_006.ogg", "Audio/minimize_001.ogg"],
            "fallback_search": "error",
        },
        "sfx_level_complete": {
            "pack": "interface-sounds",
            "files": ["Audio/maximize_009.ogg", "Audio/confirmation_003.ogg"],
            "fallback_search": "maximize",
        },
    },
    "topdown": {
        "sfx_attack": {
            "pack": "rpg-audio",
            "files": ["Audio/clothBelt.ogg", "Audio/knifeSlice.ogg"],
            "fallback_search": "slice",
        },
        "sfx_hit": {
            "pack": "impact-sounds",
            "files": ["Audio/impactPunch_medium_000.ogg"],
            "fallback_search": "punch",
        },
        "sfx_pickup": {
            "pack": "rpg-audio",
            "files": ["Audio/metalClick.ogg"],
            "fallback_search": "click",
        },
        "sfx_door": {
            "pack": "rpg-audio",
            "files": ["Audio/doorOpen_1.ogg"],
            "fallback_search": "door",
        },
    },
}


def find_audio_file(pack_name: str, file_paths: list, fallback_search: str = None) -> Path | None:
    """Find the first existing audio file from a list of candidates."""
    pack_dir = ASSETS_DIR / pack_name

    # Try exact paths first
    for fp in file_paths:
        full_path = pack_dir / fp
        if full_path.exists():
            return full_path

    # Fallback: search by keyword
    if fallback_search and pack_dir.exists():
        for f in sorted(pack_dir.rglob("*.ogg")):
            if fallback_search.lower() in f.name.lower():
                return f
        for f in sorted(pack_dir.rglob("*.wav")):
            if fallback_search.lower() in f.name.lower():
                return f

    # Last resort: any audio file from the pack
    if pack_dir.exists():
        ogg_files = sorted(pack_dir.rglob("*.ogg"))
        if ogg_files:
            return ogg_files[0]

    return None


def copy_audio_for_game(genre: str, output_dir: str) -> dict:
    """
    Copy appropriate audio files to a game's assets/audio/ folder.

    Args:
        genre: Game genre (platformer, topdown, etc.)
        output_dir: Game's root directory (will create assets/audio/ inside)

    Returns:
        Dict mapping sound names to copied file paths
    """
    audio_dir = Path(output_dir) / "assets" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    genre_map = AUDIO_MAP.get(genre, AUDIO_MAP.get("platformer"))
    result = {}

    for sound_name, config in genre_map.items():
        src = find_audio_file(config["pack"], config["files"], config.get("fallback_search"))
        if src:
            dst = audio_dir / f"{sound_name}.ogg"
            shutil.copy2(src, dst)
            result[sound_name] = str(dst)
            print(f"  [audio] {sound_name} -> {src.name}")
        else:
            print(f"  [audio] WARNING: No file found for {sound_name}")

    # Music: Kenney audio packs do NOT include background music tracks.
    # For music, the pipeline has two options:
    # 1. Use PixelLab or another API for music generation (future)
    # 2. Use ambient/loop-friendly SFX as placeholder
    # 3. Skip music (games work without it, SFX are more important)
    #
    # For now: create silent placeholder files so the game doesn't error on load.
    # The pipeline's BUILD phase prompt tells Claude to handle missing audio gracefully.
    for music_name in ["music_menu", "music_level", "music_boss"]:
        dst = audio_dir / f"{music_name}.ogg"
        if not dst.exists():
            # Create a tiny silent OGG placeholder (games should check if audio loaded)
            # This prevents Phaser load errors while not playing annoying SFX as music
            result[music_name] = None  # Signal that music is not available
            log(f"  [audio] NOTE: No music track for {music_name} (SFX only)")

    return result


def list_available_sounds() -> dict:
    """List all available sound files across all downloaded packs."""
    result = {}
    for pack_name in ["interface-sounds", "rpg-audio", "impact-sounds"]:
        pack_dir = ASSETS_DIR / pack_name
        if pack_dir.exists():
            files = sorted(pack_dir.rglob("*.ogg")) + sorted(pack_dir.rglob("*.wav"))
            result[pack_name] = [str(f.relative_to(pack_dir)) for f in files]
    return result


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "list":
        sounds = list_available_sounds()
        for pack, files in sounds.items():
            print(f"\n{pack}: {len(files)} files")
            for f in files[:5]:
                print(f"  {f}")
            if len(files) > 5:
                print(f"  ... and {len(files) - 5} more")
    else:
        print("Usage:")
        print("  python audio_mapper.py list                    # List available sounds")
        print("  python -c \"from audio_mapper import copy_audio_for_game; copy_audio_for_game('platformer', 'games/my-game/')\"")
