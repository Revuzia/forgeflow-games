#!/usr/bin/env python3
"""
asset_manifest.py — Central tagged asset library for the game pipeline.

Per 2026-04-17 research (XDA/Wheadon LLM-game case studies), the #1 failure mode
for automated game production is asset/code drift: sprites whose dimensions don't
match the collision boxes the generated code expects, tilesets referenced by
wrong filename, audio files the loader can't find.

SOLUTION: every asset lives in a tagged manifest with enforced metadata:
  { path, kind, dimensions, author, license, tags, role_hints }

When the build phase generates Phaser/Three.js code, it reads the manifest and
MUST use the real paths + dimensions — no hallucinated filenames or sizes.

This module:
  1. Scans the entire assets/ tree and builds a manifest of all Kenney + Quaternius assets
  2. Provides query API — "give me a jungle tileset with tile_size=16"
  3. Validates game manifests — "does this game reference real files?"
  4. Persists to state/game_asset_manifest.json
"""
import json
import sys
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent.parent.parent
PIPELINE_DIR = ROOT / "forgeflow-games" / "pipeline"
ASSETS_DIR   = PIPELINE_DIR / "assets"
MANIFEST_PATH = ROOT / "state" / "game_asset_manifest.json"


# ── Asset kind taxonomy (what the game code expects) ────────────────────────
KINDS = {
    "tileset_2d":   "2D tile-based world graphics (platformer levels, topdown maps)",
    "character_2d": "2D character sprite (can be spritesheet or single pose)",
    "object_2d":    "2D object/item sprite (pickup, powerup, obstacle)",
    "ui_2d":        "2D UI element (button, panel, icon)",
    "bg_2d":        "2D background image (sky, parallax layer)",
    "model_3d":     "3D GLB/GLTF/FBX model",
    "audio_music":  "Background music track",
    "audio_sfx":    "Sound effect",
    "font":         "Font file",
}


# ── Tag vocabulary — hand-curated for discoverability ───────────────────────
# Add new tags when new asset categories arrive. Don't remove existing ones.
TAG_HINTS = {
    # Themes
    "jungle", "cave", "ice", "desert", "sky", "underwater", "space", "castle",
    "forest", "lava", "snow", "ruins", "village", "dungeon", "grassland",
    # Style
    "pixel", "photorealistic", "toon", "16bit", "1bit", "flat", "hand-drawn",
    # Mood / function
    "boss", "enemy", "hero", "npc", "ambient", "action", "victory", "hurt",
    # Physics hints
    "solid", "spike", "platform", "ladder", "collectible",
    # Color
    "warm", "cool", "monochrome", "vibrant",
}


# ── Kenney pack metadata (hand-audited for correctness) ─────────────────────
# Without this, the LLM has to guess file locations.
KENNEY_PACKS = {
    "pixel-platformer": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "16bit", "platform", "grassland"],
        "tile_size": 18,
        "entry_files": ["Tilemap/tilemap_packed.png", "Tilemap/tilemap-characters_packed.png",
                        "Tilemap/tilemap-backgrounds_packed.png"],
        "good_for_genres": ["platformer"],
    },
    "roguelike-rpg-pack": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "dungeon", "ruins"],
        "tile_size": 16,
        "entry_files_pattern": "*.png",
        "good_for_genres": ["rpg", "adventure", "topdown"],
    },
    "roguelike-caves-dungeons": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "cave", "dungeon"],
        "tile_size": 16,
        "good_for_genres": ["rpg", "adventure"],
    },
    "roguelike-indoors": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "village", "castle"],
        "tile_size": 16,
        "good_for_genres": ["rpg", "adventure"],
    },
    "roguelike-characters": {
        "kind": "character_2d",
        "theme_tags": ["pixel", "hero", "enemy"],
        "good_for_genres": ["rpg", "adventure", "topdown"],
    },
    "platformer-art-deluxe": {
        "kind": "tileset_2d",
        "theme_tags": ["grassland", "hand-drawn"],
        "tile_size": 64,
        "good_for_genres": ["platformer"],
    },
    "tiny-dungeon": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "dungeon", "1bit"],
        "tile_size": 16,
        "good_for_genres": ["rpg", "adventure", "topdown"],
    },
    "tiny-town": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "village", "grassland"],
        "tile_size": 16,
        "good_for_genres": ["rpg", "adventure", "topdown"],
    },
    "pixel-shmup": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "sky", "space", "action"],
        "good_for_genres": ["shmup", "arcade"],
    },
    "ui-pack-rpg": {
        "kind": "ui_2d",
        "theme_tags": ["fantasy", "panel"],
        "good_for_genres": ["rpg", "adventure", "platformer"],
    },
    "fantasy-ui-borders": {
        "kind": "ui_2d",
        "theme_tags": ["fantasy", "panel"],
        "good_for_genres": ["rpg", "adventure"],
    },
    "board-game-icons": {
        "kind": "ui_2d",
        "theme_tags": ["icon", "boardgame"],
        "good_for_genres": ["boardgame"],
    },
    "game-icons": {
        "kind": "ui_2d",
        "theme_tags": ["icon", "generic"],
        "good_for_genres": ["all"],
    },
    "generic-items": {
        "kind": "object_2d",
        "theme_tags": ["collectible"],
        "good_for_genres": ["rpg", "adventure"],
    },
    "1-bit-pack": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "1bit", "monochrome"],
        "tile_size": 16,
        "good_for_genres": ["rpg", "adventure", "topdown"],
    },
    "micro-roguelike": {
        "kind": "tileset_2d",
        "theme_tags": ["pixel", "dungeon", "tiny"],
        "tile_size": 8,
        "good_for_genres": ["rpg", "arcade"],
    },
    "rpg-urban-pack": {
        "kind": "tileset_2d",
        "theme_tags": ["urban", "modern"],
        "good_for_genres": ["rpg", "adventure"],
    },
    "impact-sounds": {"kind": "audio_sfx", "theme_tags": ["action", "hurt"], "good_for_genres": ["all"]},
    "interface-sounds": {"kind": "audio_sfx", "theme_tags": ["ui"], "good_for_genres": ["all"]},
    "music": {"kind": "audio_music", "theme_tags": ["ambient"], "good_for_genres": ["all"]},
    "rpg-audio": {"kind": "audio_sfx", "theme_tags": ["action"], "good_for_genres": ["rpg", "adventure"]},
}


# ── Quaternius 3D pack metadata ─────────────────────────────────────────────
# Original 7 packs + 7 NEW mega-kit packs extracted 2026-04-17 from user's Downloads
QUATERNIUS_PACKS = {
    # Original packs (already indexed)
    "ultimate-monsters":        {"kind": "model_3d", "theme_tags": ["enemy", "fantasy"],             "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "base-characters":          {"kind": "model_3d", "theme_tags": ["hero", "npc"],                   "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "fantasy-outfits":          {"kind": "model_3d", "theme_tags": ["hero", "equipment"],            "good_for_genres": ["arpg", "3d-arpg"]},
    "fantasy-props":            {"kind": "model_3d", "theme_tags": ["ambient", "ruins"],             "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "medieval-village":         {"kind": "model_3d", "theme_tags": ["village", "grassland"],         "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "medieval-weapons":         {"kind": "model_3d", "theme_tags": ["weapon", "equipment"],          "good_for_genres": ["arpg", "3d-arpg"]},
    "modular-dungeon":          {"kind": "model_3d", "theme_tags": ["dungeon", "ruins"],             "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    # NEW mega-kit packs (2022 files added 2026-04-17)
    "fantasy-props-mega":       {"kind": "model_3d", "theme_tags": ["ambient", "props", "fantasy"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "medieval-village-mega":    {"kind": "model_3d", "theme_tags": ["village", "castle", "buildings"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "medieval-weapons-pack":    {"kind": "model_3d", "theme_tags": ["weapon", "equipment", "sword", "shield"], "good_for_genres": ["arpg", "3d-arpg"]},
    "modular-character-outfits":{"kind": "model_3d", "theme_tags": ["hero", "outfit", "armor"],      "good_for_genres": ["arpg", "3d-arpg"]},
    "ultimate-monsters-bundle": {"kind": "model_3d", "theme_tags": ["enemy", "boss", "creature"],    "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "universal-base-characters":{"kind": "model_3d", "theme_tags": ["hero", "npc", "base"],          "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "updated-modular-dungeon":  {"kind": "model_3d", "theme_tags": ["dungeon", "castle", "ruins"],  "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
}

# Poly Haven CC0 packs (downloaded via asset_downloader.py 2026-04-17)
POLYHAVEN_PACKS = {
    "polyhaven-hdris":    {"kind": "bg_2d", "theme_tags": ["skybox", "hdri", "lighting"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "polyhaven-textures": {"kind": "tileset_2d", "theme_tags": ["pbr", "ground", "wall", "material"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg", "platformer"]},
    "polyhaven-models":   {"kind": "model_3d", "theme_tags": ["realistic", "prop"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
}

# Mocap packs under assets/_downloaded/ (extracted zip contents)
MOCAP_PACKS = {
    "cmu-mocap/cmu-mocap-master": {"kind": "animation_3d", "theme_tags": ["mocap", "humanoid", "motion"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "mixamo/characters":          {"kind": "model_3d",     "theme_tags": ["character", "humanoid", "rigged"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
    "mixamo/animations":          {"kind": "animation_3d", "theme_tags": ["mocap", "humanoid", "motion"], "good_for_genres": ["arpg", "3d-platformer", "3d-arpg"]},
}

# Other downloaded extras under assets/_downloaded/
EXTRA_PACKS = {
    "game-icons":             {"kind": "ui_2d",       "theme_tags": ["icon", "ability", "generic"], "good_for_genres": ["all"]},
    "platformer-kit":         {"kind": "model_3d",    "theme_tags": ["platform", "grassland", "3d"], "good_for_genres": ["3d-platformer", "3d-arpg"]},
    "platformer-kit-3d":      {"kind": "model_3d",    "theme_tags": ["platform", "grassland", "3d"], "good_for_genres": ["3d-platformer", "3d-arpg"]},
    "new-platformer-pack":    {"kind": "tileset_2d",  "theme_tags": ["platform", "2d", "grassland"], "good_for_genres": ["platformer", "obby"]},
    "light-masks":            {"kind": "bg_2d",       "theme_tags": ["vfx", "particle", "light"],   "good_for_genres": ["all"]},
    "input-prompts":          {"kind": "ui_2d",       "theme_tags": ["ui", "controller", "input"],  "good_for_genres": ["all"]},
    "mobile-controls":        {"kind": "ui_2d",       "theme_tags": ["ui", "touch", "mobile"],      "good_for_genres": ["all"]},
    "graveyard-kit":          {"kind": "model_3d",    "theme_tags": ["dungeon", "spooky", "3d"],    "good_for_genres": ["3d-platformer", "3d-arpg", "arpg"]},
    "modular-dungeon-kit":    {"kind": "model_3d",    "theme_tags": ["dungeon", "ruins", "3d"],     "good_for_genres": ["3d-arpg", "arpg"]},
    "modular-space-kit":      {"kind": "model_3d",    "theme_tags": ["space", "sci-fi", "3d"],      "good_for_genres": ["3d-platformer", "3d-arpg", "shooter"]},
    "pirate-kit":             {"kind": "model_3d",    "theme_tags": ["pirate", "island", "3d"],     "good_for_genres": ["3d-platformer", "3d-arpg", "adventure"]},
    "retro-textures-fantasy": {"kind": "tileset_2d",  "theme_tags": ["retro", "fantasy", "pbr"],    "good_for_genres": ["all"]},
    "impact-sounds":          {"kind": "audio_sfx",   "theme_tags": ["impact", "action", "combat"], "good_for_genres": ["all"]},
    "interface-sounds":       {"kind": "audio_sfx",   "theme_tags": ["ui"],                          "good_for_genres": ["all"]},
    "ui-audio":               {"kind": "audio_sfx",   "theme_tags": ["ui"],                          "good_for_genres": ["all"]},
    "fonts":                  {"kind": "font",        "theme_tags": ["pixel", "sci-fi", "retro"],   "good_for_genres": ["all"]},
}


def build_manifest() -> dict:
    """Scan assets dir, build complete manifest using metadata above."""
    manifest = {
        "version": 1,
        "generated_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
        "packs": {},
        "summary": {"total_files": 0, "total_bytes": 0},
    }

    # Kenney packs (2D, audio) live directly under assets/
    for pack_name, meta in KENNEY_PACKS.items():
        pack_dir = ASSETS_DIR / pack_name
        if not pack_dir.exists():
            continue
        files = []
        total_bytes = 0
        exts_for_kind = {
            "tileset_2d":   [".png"],
            "character_2d": [".png"],
            "object_2d":    [".png"],
            "ui_2d":        [".png"],
            "bg_2d":        [".png", ".jpg"],
            "audio_music":  [".ogg", ".mp3", ".wav"],
            "audio_sfx":    [".ogg", ".mp3", ".wav"],
        }
        wanted = exts_for_kind.get(meta["kind"], [".png"])
        for f in pack_dir.rglob("*"):
            if f.is_file() and f.suffix.lower() in wanted:
                try:
                    size = f.stat().st_size
                except Exception:
                    size = 0
                files.append({
                    "rel_path": str(f.relative_to(ASSETS_DIR).as_posix()),
                    "size_bytes": size,
                })
                total_bytes += size
        if files:
            manifest["packs"][pack_name] = {
                **meta,
                "source": "kenney",
                "files": files,
                "file_count": len(files),
                "total_bytes": total_bytes,
            }
            manifest["summary"]["total_files"] += len(files)
            manifest["summary"]["total_bytes"] += total_bytes

    # Quaternius 3D models under assets/3d-models/
    models_root = ASSETS_DIR / "3d-models"
    for pack_name, meta in QUATERNIUS_PACKS.items():
        pack_dir = models_root / pack_name
        if not pack_dir.exists():
            continue
        files = []
        total_bytes = 0
        for f in pack_dir.rglob("*"):
            if f.is_file() and f.suffix.lower() in (".glb", ".gltf", ".fbx", ".obj"):
                try:
                    size = f.stat().st_size
                except Exception:
                    size = 0
                files.append({
                    "rel_path": str(f.relative_to(ASSETS_DIR).as_posix()),
                    "size_bytes": size,
                })
                total_bytes += size
        if files:
            manifest["packs"][pack_name] = {
                **meta,
                "source": "quaternius",
                "files": files,
                "file_count": len(files),
                "total_bytes": total_bytes,
            }
            manifest["summary"]["total_files"] += len(files)
            manifest["summary"]["total_bytes"] += total_bytes

    # Poly Haven + other downloads under assets/_downloaded/
    downloads_root = ASSETS_DIR / "_downloaded"
    for pack_name, meta in POLYHAVEN_PACKS.items():
        pack_dir = downloads_root / pack_name
        if not pack_dir.exists():
            continue
        files = []
        total_bytes = 0
        for f in pack_dir.rglob("*"):
            if f.is_file() and f.suffix.lower() in (".hdr", ".exr", ".jpg", ".png", ".gltf", ".glb", ".bin"):
                try:
                    size = f.stat().st_size
                except Exception:
                    size = 0
                files.append({"rel_path": str(f.relative_to(ASSETS_DIR).as_posix()), "size_bytes": size})
                total_bytes += size
        if files:
            manifest["packs"][pack_name] = {
                **meta, "source": "polyhaven",
                "files": files, "file_count": len(files), "total_bytes": total_bytes,
            }
            manifest["summary"]["total_files"] += len(files)
            manifest["summary"]["total_bytes"] += total_bytes

    # Mocap + mixamo packs
    for pack_name, meta in MOCAP_PACKS.items():
        pack_dir = downloads_root / pack_name
        if not pack_dir.exists():
            continue
        files = []
        total_bytes = 0
        wanted_exts = {".bvh", ".fbx", ".glb", ".gltf"} if meta["kind"] == "animation_3d" else {".fbx", ".glb", ".gltf"}
        for f in pack_dir.rglob("*"):
            if f.is_file() and f.suffix.lower() in wanted_exts:
                try: size = f.stat().st_size
                except Exception: size = 0
                files.append({"rel_path": str(f.relative_to(ASSETS_DIR).as_posix()), "size_bytes": size})
                total_bytes += size
        if files:
            safe_pack_name = pack_name.replace("/", "-")
            manifest["packs"][safe_pack_name] = {
                **meta, "source": "mocap" if "cmu" in pack_name else "mixamo",
                "files": files, "file_count": len(files), "total_bytes": total_bytes,
            }
            manifest["summary"]["total_files"] += len(files)
            manifest["summary"]["total_bytes"] += total_bytes

    # Game-Icons + extra Kenney packs under _downloaded/
    ext_map = {
        "ui_2d":       {".svg", ".png"},
        "tileset_2d":  {".png", ".jpg"},
        "model_3d":    {".glb", ".gltf", ".fbx", ".obj"},
        "audio_sfx":   {".ogg", ".mp3", ".wav"},
        "audio_music": {".ogg", ".mp3", ".wav"},
        "bg_2d":       {".png", ".jpg", ".hdr", ".exr"},
        "character_2d":{".png"},
        "object_2d":   {".png"},
        "font":        {".woff2", ".woff", ".ttf", ".otf"},
        "animation_3d":{".bvh", ".fbx", ".glb", ".gltf"},
    }
    for pack_name, meta in EXTRA_PACKS.items():
        pack_dir = downloads_root / pack_name
        if not pack_dir.exists():
            continue
        wanted = ext_map.get(meta["kind"], {".png", ".svg"})
        files = []
        total_bytes = 0
        for f in pack_dir.rglob("*"):
            if f.is_file() and f.suffix.lower() in wanted:
                try:
                    size = f.stat().st_size
                except Exception:
                    size = 0
                files.append({"rel_path": str(f.relative_to(ASSETS_DIR).as_posix()), "size_bytes": size})
                total_bytes += size
        if files:
            manifest["packs"][pack_name] = {
                **meta, "source": "kenney-extra",
                "files": files, "file_count": len(files), "total_bytes": total_bytes,
            }
            manifest["summary"]["total_files"] += len(files)
            manifest["summary"]["total_bytes"] += total_bytes

    return manifest


# ── Query API — used by the build phase to find the right asset ────────────
def query(manifest: dict, kind: str = None, tags: list = None,
          genre: str = None, limit: int = 50) -> list:
    """Return list of (pack_name, file_rel_path) matching filter criteria.

    Example:
        query(m, kind="tileset_2d", tags=["jungle", "pixel"], genre="platformer")
        → [("pixel-platformer", "pixel-platformer/Tilemap/tilemap_packed.png"), ...]
    """
    results = []
    for pack_name, pack in manifest["packs"].items():
        if kind and pack.get("kind") != kind:
            continue
        if tags:
            pack_tags = set(pack.get("theme_tags", []))
            if not any(t in pack_tags for t in tags):
                continue
        if genre:
            good = pack.get("good_for_genres", [])
            if "all" not in good and genre not in good:
                continue
        for f in pack.get("files", []):
            results.append({
                "pack":     pack_name,
                "rel_path": f["rel_path"],
                "kind":     pack.get("kind"),
                "tags":     pack.get("theme_tags", []),
                "tile_size": pack.get("tile_size"),
            })
            if len(results) >= limit:
                return results
    return results


def validate_game_references(game_dir: Path, manifest: dict) -> list:
    """Check a game's index.html + game.js for referenced asset paths.
    Return list of BROKEN references (referenced path that doesn't exist).
    """
    import re
    broken = []
    for src in (game_dir / "index.html", game_dir / "game.js"):
        if not src.exists():
            continue
        try:
            text = src.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        # Find common asset reference patterns
        for m in re.finditer(r'["\']([^"\']+\.(?:png|jpg|jpeg|gif|ogg|mp3|wav|glb|gltf|fbx))["\']', text):
            ref = m.group(1)
            if ref.startswith("http"):
                continue  # CDN assets are out-of-scope
            # Check if this file exists within the game's own assets/
            candidate = game_dir / "assets" / ref.split("/")[-1]
            if not candidate.exists():
                # Also check if ref is a nested path relative to assets/
                nested = game_dir / "assets" / ref
                if not nested.exists():
                    broken.append({"file": str(src.name), "ref": ref})
    return broken


def main():
    """Build and save the manifest."""
    m = build_manifest()
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST_PATH.write_text(json.dumps(m, indent=2), encoding="utf-8")
    print(f"Manifest saved: {MANIFEST_PATH}")
    print(f"  Packs: {len(m['packs'])}")
    print(f"  Files: {m['summary']['total_files']}")
    print(f"  Size:  {m['summary']['total_bytes'] / (1024*1024):.1f} MB")

    # Print sample queries
    print()
    print("Sample queries:")
    for kind in ("tileset_2d", "model_3d", "audio_music"):
        results = query(m, kind=kind, limit=3)
        print(f"  {kind}: {len(results)} sample hits")


if __name__ == "__main__":
    main()
