#!/usr/bin/env python3
"""
asset_classifier.py — Auto-classify individual assets by filename + optional vision.

PROBLEM this solves: asset_manifest.py tags at PACK level, but packs can contain
mixed content. A medieval-village-mega pack has houses, trees, NPCs, furniture —
all different roles. Without per-file classification, a 3D ARPG might pick a
"decorative lamppost" as a monster.

SOLUTION: 3-tier classifier:
  Tier 1 (fast, ~instant): filename NLP — regex-match filenames against known
    role vocabularies. Works for ~70% of assets that have descriptive names like
    "Zombie_01.fbx" or "Ice_Sword.glb".
  Tier 2 (~free): Claude CLI classifies ambiguous filenames from text-only prompt.
  Tier 3 (optional, slow): vision classification via Grok/Claude vision on a
    thumbnail rendered from the GLB. Requires Blender or three.js headless
    render. Reserved for the 5-10% of assets where filename is useless
    ("Asset_042.glb").

Output: state/asset_classifications.json
  { "path/to/file.glb": {"role": "enemy", "theme": "undead", "confidence": 0.9}, ... }

Used by phase_build when picking specific files from a pack. Query example:
  classifier.pick(kind="model_3d", role="enemy", theme="undead", count=4)
  -> returns 4 specific file paths matching the criteria

Usage:
  python scripts/asset_classifier.py --classify-all
  python scripts/asset_classifier.py --pack ultimate-monsters-bundle
  python scripts/asset_classifier.py --stats
"""
import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
ASSETS_DIR = ROOT / "forgeflow-games" / "pipeline" / "assets"
MANIFEST_PATH = ROOT / "state" / "game_asset_manifest.json"
CLASS_PATH    = ROOT / "state" / "asset_classifications.json"


# ══ Role vocabulary ══════════════════════════════════════════════════════════
# Each role has a set of keywords that when found in a filename indicate the
# file plays that role. Order matters — earlier roles take precedence.

ROLE_KEYWORDS = {
    "enemy": [
        "zombie", "skeleton", "orc", "goblin", "demon", "dragon", "monster",
        "ghost", "ghoul", "mummy", "vampire", "werewolf", "troll", "giant",
        "spider", "bat", "rat", "wolf", "snake", "wyvern", "lich", "beholder",
        "creature", "wraith", "slime", "fiend", "imp", "horror", "minotaur",
        "gorgon", "hydra", "kraken",
    ],
    "boss": [
        "boss", "dragon", "kraken", "lich", "titan", "warden", "hydra",
        "leviathan", "behemoth", "colossus", "god_of", "lord_of", "king_of",
        "queen_of", "overlord", "emperor",
    ],
    "hero": [
        "hero", "knight", "paladin", "warrior", "archer", "ranger", "mage",
        "wizard", "sorcerer", "cleric", "bard", "rogue", "assassin", "monk",
        "druid", "samurai", "ninja", "valkyrie", "hunter", "guard",
        "protagonist", "player", "pc_", "adventurer",
    ],
    "npc": [
        "villager", "farmer", "merchant", "shopkeeper", "bartender", "priest",
        "priestess", "innkeeper", "blacksmith", "child", "elder", "beggar",
        "noble", "servant", "civilian", "citizen", "peasant",
    ],
    "weapon": [
        "sword", "axe", "bow", "mace", "hammer", "spear", "dagger", "shield",
        "staff", "wand", "crossbow", "club", "katana", "lance", "scythe",
        "gauntlet", "flail", "glaive",
    ],
    "structure": [
        "house", "castle", "church", "wall", "tower", "gate", "bridge",
        "tavern", "temple", "shrine", "building", "hut", "cottage", "mansion",
        "ruin", "fort", "barracks", "market", "bakery", "smithy",
    ],
    "prop": [
        "barrel", "crate", "chest", "chair", "table", "bed", "lamp", "torch",
        "candle", "bench", "bucket", "vase", "pot", "fence", "sign", "bookshelf",
        "cauldron", "altar", "pillar", "statue",
    ],
    "nature": [
        "tree", "bush", "rock", "stone", "grass", "flower", "mushroom",
        "log", "branch", "leaf", "plant", "vine", "fern", "hedge",
    ],
    "pet_cute": [  # Adopt-Me / Roblox friendly pets, NOT combat creatures
        "cube_pet", "plush", "cute", "baby_", "mini_", "chibi", "toy_",
    ],
    "vehicle": [
        "car", "truck", "bike", "plane", "boat", "ship", "tank", "mech",
    ],
}


# ══ Theme vocabulary ═════════════════════════════════════════════════════════
THEME_KEYWORDS = {
    "undead":   ["zombie", "skeleton", "ghost", "ghoul", "mummy", "vampire", "lich", "wraith"],
    "demonic":  ["demon", "fiend", "imp", "devil", "infernal", "abyss"],
    "forest":   ["forest", "tree", "leaves", "elf", "druid", "woodland", "grove"],
    "ice":      ["ice", "snow", "frost", "glacier", "winter", "cold", "frozen"],
    "fire":     ["fire", "flame", "lava", "burn", "magma", "inferno"],
    "water":    ["water", "sea", "ocean", "reef", "fish", "shark", "kraken", "tide"],
    "desert":   ["desert", "sand", "sun", "cactus", "arid", "dune"],
    "space":    ["space", "alien", "cosmic", "star", "galaxy", "void", "astro"],
    "mech":     ["mech", "robot", "cyber", "cyborg", "android", "drone"],
    "medieval": ["knight", "castle", "medieval", "feudal", "peasant", "lord"],
    "fantasy":  ["dragon", "wizard", "magic", "spell", "enchant", "wand"],
    "horror":   ["zombie", "horror", "gore", "blood", "nightmare"],
    "cute":     ["cube_pet", "chibi", "plush", "toy_", "baby_", "mini_"],
}


# ══ Classification ═══════════════════════════════════════════════════════════
def classify_filename(name: str) -> dict:
    """Apply filename-based role + theme + confidence heuristics."""
    lower = re.sub(r"[_\-\.]", " ", name.lower())

    # Role: pick first matching role (order matters → boss before enemy)
    role = "unknown"
    role_conf = 0.0
    for r in ["boss", "hero", "enemy", "pet_cute", "npc", "weapon", "structure", "prop", "nature", "vehicle"]:
        for kw in ROLE_KEYWORDS[r]:
            if kw in lower:
                role = r
                role_conf = 0.85 if len(kw) > 4 else 0.7  # longer keywords = higher confidence
                break
        if role != "unknown":
            break

    # Theme: any matching theme keywords
    themes = []
    for t, kws in THEME_KEYWORDS.items():
        if any(kw in lower for kw in kws):
            themes.append(t)

    return {"role": role, "themes": themes, "confidence": role_conf, "method": "filename_nlp"}


def classify_all(manifest: dict, only_packs: list = None) -> dict:
    """Classify every file in the manifest. Returns dict keyed by rel_path."""
    results = {}
    for pack_name, pack in manifest.get("packs", {}).items():
        if only_packs and pack_name not in only_packs:
            continue
        for f in pack.get("files", []):
            rel = f["rel_path"]
            filename = Path(rel).stem
            c = classify_filename(filename)
            c["pack"] = pack_name
            c["kind"] = pack.get("kind")
            # Inherit pack-level themes when filename doesn't yield any
            if not c["themes"]:
                c["themes"] = pack.get("theme_tags", [])
            results[rel] = c
    return results


def _load_vision_overlay():
    """Load vision-based classifications from state/asset_vision_classifications.json.

    Vision classifications are richer than filename-based ones — they include
    era, incompatible_with, visual_description. When present they OVERRIDE
    the filename classification for that path.
    """
    vision_path = ROOT / "state" / "asset_vision_classifications.json"
    if not vision_path.exists():
        return {}
    try:
        return json.loads(vision_path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def pick(classifications: dict, kind: str = None, role: str = None,
         theme: str = None, era: str = None, genre: str = None,
         exclude_genres: list = None,
         count: int = 1, exclude_paths: set = None) -> list:
    """Return matching file paths ranked by confidence + theme + era match.

    Uses vision-based classifications (richer) when available, falling back
    to filename-based otherwise. The query can constrain by:
      - kind (tileset_2d, model_3d, etc.)
      - role (enemy, hero, boss, npc, weapon, structure, prop, etc.)
      - theme (single theme tag to match)
      - era (medieval, fantasy, modern, sci-fi, etc.)
      - genre (genre tag — file must include it in good_for)
      - exclude_genres (file must NOT include these in incompatible_with — otherwise skipped)
    """
    exclude_paths = exclude_paths or set()
    exclude_genres = exclude_genres or []
    # Overlay richer vision classifications on top of filename classifications
    vision = _load_vision_overlay()
    merged = dict(classifications)
    for path, v in vision.items():
        base = merged.get(path, {})
        merged[path] = {**base, **v, "source": "vision"}

    candidates = []
    for path, c in merged.items():
        if path in exclude_paths:
            continue
        if kind and c.get("kind") != kind:
            continue
        if role and c.get("role") != role:
            continue
        # Era match
        if era and c.get("era") and era != c["era"]:
            # If the file has a definite era and it doesn't match, skip
            continue
        # Theme match
        if theme and theme not in c.get("themes", []):
            continue
        # Genre fit
        good_for = c.get("good_for", [])
        if genre and "all" not in good_for and genre not in good_for:
            # File must explicitly say this genre is good (or say "all")
            if good_for:  # only enforce if file has an opinion
                continue
        # Incompatibility check
        incompatible = c.get("incompatible_with", [])
        blocked = False
        for exg in exclude_genres:
            if exg in incompatible:
                blocked = True
                break
        if blocked:
            continue
        # Score
        score = c.get("confidence", 0.5)
        if c.get("source") == "vision":
            score += 0.2  # prefer vision-classified files
        if theme and theme in c.get("themes", []):
            score += 0.3
        if genre and genre in good_for:
            score += 0.2
        candidates.append((path, score))

    candidates.sort(key=lambda x: -x[1])
    return [p for p, _ in candidates[:count]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--classify-all", action="store_true")
    ap.add_argument("--pack")
    ap.add_argument("--stats", action="store_true")
    args = ap.parse_args()

    if not MANIFEST_PATH.exists():
        print("Run asset_manifest.py first to build the manifest.")
        sys.exit(1)
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    if args.classify_all or args.pack:
        only_packs = [args.pack] if args.pack else None
        results = classify_all(manifest, only_packs)
        # Merge with existing classifications
        existing = {}
        if CLASS_PATH.exists():
            try:
                existing = json.loads(CLASS_PATH.read_text(encoding="utf-8"))
            except Exception:
                existing = {}
        existing.update(results)
        CLASS_PATH.write_text(json.dumps(existing, indent=2), encoding="utf-8")
        print(f"Classified {len(results)} files (total classified: {len(existing)})")
        # Stats
        role_counts = {}
        for c in results.values():
            role_counts[c["role"]] = role_counts.get(c["role"], 0) + 1
        for r, n in sorted(role_counts.items(), key=lambda x: -x[1]):
            print(f"  {r:12s}: {n}")

    if args.stats:
        if not CLASS_PATH.exists():
            print("No classifications yet.")
            return
        classifications = json.loads(CLASS_PATH.read_text(encoding="utf-8"))
        print(f"Total classified: {len(classifications)}")
        by_role = {}
        for c in classifications.values():
            by_role[c["role"]] = by_role.get(c["role"], 0) + 1
        for r, n in sorted(by_role.items(), key=lambda x: -x[1]):
            print(f"  {r:12s}: {n}")


if __name__ == "__main__":
    main()
