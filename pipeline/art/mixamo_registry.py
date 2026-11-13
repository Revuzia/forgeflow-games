#!/usr/bin/env python3
"""
mixamo_registry.py — Hand-curated metadata for Mixamo characters.

WHY: filename-based classifier gets "Newspaper Boy" wrong in Diablo context —
it has no concept of thematic era/fit. We need richer per-file tags.

This registry maps known Mixamo characters to:
  - role: hero | villain | npc | enemy | boss
  - era/setting: medieval | fantasy | modern | sci-fi | horror | post-apoc | victorian
  - incompatible_with: genres this character should NEVER appear in
  - visual_description: 1-sentence summary for Claude design prompts

When asset_classifier can't guess a filename, this registry is consulted first.
If still unknown, falls back to abstract "generic humanoid".

API:
  from mixamo_registry import lookup, compatible_with
  meta = lookup("Paladin J Nordstrom")    # -> {"role": "hero", "era": "medieval", ...}
  chars = compatible_with("arpg", "medieval-fantasy")  # list of good matches
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
MIXAMO_DIR = ROOT / "forgeflow-games" / "pipeline" / "assets" / "_downloaded" / "mixamo"


# Pattern-based registry (order matters — specific before generic)
# Each entry: (filename_pattern_regex, metadata dict)
PATTERN_REGISTRY = [
    # ── HERO / WARRIOR types ──
    (r"paladin", {
        "role": "hero", "era": "medieval", "archetype": "knight",
        "incompatible_with": ["cyberpunk", "modern", "voxel-sandbox", "farming-life", "life-sim"],
        "good_for": ["arpg", "rpg", "3d-arpg", "3d-platformer", "tactical-rpg", "3d-souls-like"],
        "visual_description": "Holy armored knight, templar/paladin class with sword and shield or warhammer",
    }),
    (r"knight", {
        "role": "hero", "era": "medieval", "archetype": "knight",
        "incompatible_with": ["cyberpunk", "modern", "voxel-sandbox", "roblox-clicker", "farming-life"],
        "good_for": ["arpg", "rpg", "3d-arpg", "3d-platformer", "tactical-rpg", "3d-souls-like"],
        "visual_description": "Medieval knight in plate armor, could be hero or elite enemy",
    }),
    (r"castle.guard", {
        "role": "npc", "era": "medieval", "archetype": "guard",
        "incompatible_with": ["cyberpunk", "modern", "voxel-sandbox", "life-sim", "farming-life", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "tactical-rpg"],
        "visual_description": "Medieval castle guard in partial plate, spear or halberd",
    }),
    (r"erika.archer", {
        "role": "hero", "era": "fantasy", "archetype": "archer",
        "incompatible_with": ["cyberpunk", "modern", "voxel-sandbox", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "3d-platformer", "tactical-rpg"],
        "visual_description": "Female archer in light leather, carries bow",
    }),
    (r"kachujin", {
        "role": "hero", "era": "medieval-eastern", "archetype": "samurai",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "tactical-rpg", "3d-souls-like"],
        "visual_description": "Japanese samurai warrior in traditional armor",
    }),
    (r"vanguard", {
        "role": "hero", "era": "medieval", "archetype": "knight",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "tactical-rpg"],
        "visual_description": "Heavy armored medieval soldier, front-line warrior",
    }),
    (r"heraklios", {
        "role": "hero", "era": "ancient-classical", "archetype": "warrior",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "3d-platformer"],
        "visual_description": "Greek/ancient warrior, inspired by Heracles, muscular with toga-armor",
    }),
    (r"yaku", {
        "role": "hero", "era": "modern-fantasy", "archetype": "martial-artist",
        "incompatible_with": ["medieval", "roblox-clicker"],
        "good_for": ["fighting", "beat-em-up", "3d-platformer"],
        "visual_description": "Modern martial artist, athletic fighter",
    }),
    (r"nightshade", {
        "role": "hero", "era": "fantasy", "archetype": "rogue",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "3d-souls-like"],
        "visual_description": "Hooded female assassin/rogue in dark leather, daggers",
    }),

    # ── ENEMY / HORROR types ──
    (r"(.*zombie.*|skeleton.*zombie|copzombie)", {
        "role": "enemy", "era": "horror", "archetype": "undead",
        "incompatible_with": ["farming-life", "life-sim", "cute", "roblox-clicker"],
        "good_for": ["arpg", "3d-arpg", "3d-souls-like", "fps", "beat-em-up"],
        "visual_description": "Zombie/undead creature, rotting flesh, aggressive enemy",
    }),
    (r"demon", {
        "role": "enemy", "era": "horror-fantasy", "archetype": "demon",
        "incompatible_with": ["farming-life", "life-sim", "cute"],
        "good_for": ["arpg", "3d-arpg", "3d-souls-like", "fps"],
        "visual_description": "Demonic creature with horns, clawed limbs, fiery or dark aura",
    }),
    (r"vampire", {
        "role": "enemy", "era": "horror-gothic", "archetype": "vampire",
        "incompatible_with": ["farming-life", "life-sim", "cute"],
        "good_for": ["arpg", "3d-arpg", "3d-souls-like", "tactical-rpg"],
        "visual_description": "Gothic vampire noble, pale skin, dark elegant clothing",
    }),
    (r"goblin", {
        "role": "enemy", "era": "fantasy", "archetype": "goblin",
        "incompatible_with": ["cyberpunk", "modern", "farming-life"],
        "good_for": ["arpg", "rpg", "3d-arpg", "tactical-rpg"],
        "visual_description": "Small green goblin, malicious grin, wields crude weapons",
    }),
    (r"parasite", {
        "role": "enemy", "era": "horror-alien", "archetype": "alien",
        "incompatible_with": ["farming-life", "life-sim", "medieval"],
        "good_for": ["arpg", "3d-arpg", "fps", "3d-souls-like"],
        "visual_description": "Alien parasite creature, organic horror with tentacles/claws",
    }),
    (r"pumpkinhulk", {
        "role": "enemy", "era": "horror-halloween", "archetype": "monster",
        "incompatible_with": ["farming-life", "cyberpunk", "modern"],
        "good_for": ["arpg", "3d-arpg", "3d-platformer", "3d-souls-like"],
        "visual_description": "Pumpkin-headed hulking monster, Halloween/horror themed",
    }),
    (r"warzombie|ganfaul", {
        "role": "enemy", "era": "horror", "archetype": "undead",
        "incompatible_with": ["farming-life", "life-sim", "cute"],
        "good_for": ["arpg", "3d-arpg", "3d-souls-like", "fps"],
        "visual_description": "Armored zombie warrior, post-death combatant",
    }),
    (r"whiteclown", {
        "role": "enemy", "era": "horror-circus", "archetype": "clown",
        "incompatible_with": ["farming-life", "life-sim"],
        "good_for": ["arpg", "3d-arpg", "fps", "3d-souls-like"],
        "visual_description": "Disturbing white-faced clown, horror-themed enemy",
    }),
    (r"prisoner", {
        "role": "enemy", "era": "modern-grim", "archetype": "prisoner",
        "incompatible_with": ["medieval", "fantasy", "cute"],
        "good_for": ["arpg", "fps", "3d-souls-like", "beat-em-up"],
        "visual_description": "Prison inmate in jumpsuit, hostile",
    }),
    (r"brute", {
        "role": "enemy", "era": "modern", "archetype": "muscle",
        "incompatible_with": ["cute", "roblox-clicker", "farming-life"],
        "good_for": ["arpg", "fps", "3d-souls-like", "beat-em-up"],
        "visual_description": "Large muscular thug, brawler type enemy",
    }),

    # ── NPC / VILLAGER types ──
    (r"peasant", {
        "role": "npc", "era": "medieval", "archetype": "villager",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["rpg", "arpg", "3d-arpg", "tactical-rpg", "life-sim"],
        "visual_description": "Medieval peasant villager, simple clothes, non-combatant",
    }),
    (r"sporty.granny", {
        "role": "npc", "era": "modern", "archetype": "elderly",
        "incompatible_with": ["medieval", "fantasy", "roblox-clicker"],
        "good_for": ["life-sim", "farming-life", "beat-em-up"],
        "visual_description": "Elderly woman in athletic wear, quirky modern NPC",
    }),
    (r"maria", {
        "role": "npc", "era": "fantasy", "archetype": "civilian",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["rpg", "arpg", "tactical-rpg", "life-sim"],
        "visual_description": "Female civilian in simple dress, fantasy setting villager",
    }),
    (r"girlscout", {
        "role": "npc", "era": "modern", "archetype": "civilian",
        "incompatible_with": ["medieval", "fantasy", "sci-fi"],
        "good_for": ["life-sim", "farming-life", "adventure"],
        "visual_description": "Young girl in scout uniform, modern setting",
    }),

    # ── MODERN / MILITARY types ──
    (r"(swat|swat.guy)", {
        "role": "enemy_or_hero", "era": "modern-military", "archetype": "soldier",
        "incompatible_with": ["medieval", "fantasy", "roblox-clicker"],
        "good_for": ["fps", "3d-arpg", "beat-em-up"],
        "visual_description": "SWAT officer in tactical gear, modern military",
    }),
    (r"alien.soldier", {
        "role": "enemy", "era": "sci-fi", "archetype": "soldier",
        "incompatible_with": ["medieval", "fantasy", "farming-life"],
        "good_for": ["fps", "3d-arpg", "shmup"],
        "visual_description": "Alien soldier, sci-fi armored combatant",
    }),
    (r"exo.gray|exo_red", {
        "role": "hero", "era": "sci-fi", "archetype": "exosuit",
        "incompatible_with": ["medieval", "fantasy", "farming-life"],
        "good_for": ["fps", "3d-arpg", "arpg"],
        "visual_description": "Exosuit-wearing soldier, sci-fi heavy armor",
    }),
    (r"doozy|racer", {
        "role": "hero", "era": "modern-racing", "archetype": "racer",
        "incompatible_with": ["medieval", "fantasy"],
        "good_for": ["kart-racing", "arcade-racing", "3d-platformer"],
        "visual_description": "Colorful modern character, racing game aesthetic",
    }),

    # ── CUTE / ROBLOX ──
    (r"crypto", {
        "role": "hero", "era": "sci-fi", "archetype": "cute-robot",
        "incompatible_with": ["medieval", "fantasy", "horror"],
        "good_for": ["roblox-clicker", "3d-platformer", "arcade"],
        "visual_description": "Small cute robot or stylized character",
    }),
    (r"arissa|ty", {
        "role": "hero", "era": "modern", "archetype": "casual",
        "incompatible_with": ["medieval", "fantasy"],
        "good_for": ["life-sim", "farming-life", "adventure", "3d-platformer"],
        "visual_description": "Modern casual character, everyday clothing",
    }),

    # ── SPECIAL / UNIQUE ──
    (r"pirate", {
        "role": "enemy_or_hero", "era": "age-of-sail", "archetype": "pirate",
        "incompatible_with": ["cyberpunk", "modern-military"],
        "good_for": ["arpg", "rpg", "3d-arpg", "3d-platformer", "adventure"],
        "visual_description": "Swashbuckling pirate, tricorn hat, cutlass",
    }),
    (r"mutant", {
        "role": "enemy", "era": "post-apocalyptic", "archetype": "mutant",
        "incompatible_with": ["medieval", "fantasy", "farming-life", "cute"],
        "good_for": ["fps", "3d-arpg", "3d-souls-like", "beat-em-up"],
        "visual_description": "Mutated creature, post-apocalyptic horror",
    }),
    (r"warrok", {
        "role": "enemy_or_hero", "era": "fantasy", "archetype": "orc",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "tactical-rpg"],
        "visual_description": "Large orc warrior, tusks, muscular, fantasy enemy or boss",
    }),
    (r"uriel", {
        "role": "hero", "era": "fantasy-angelic", "archetype": "angel",
        "incompatible_with": ["cyberpunk", "modern", "horror"],
        "good_for": ["arpg", "rpg", "3d-arpg"],
        "visual_description": "Angelic warrior with glowing aura, celestial weapon",
    }),
    (r"medea", {
        "role": "hero_or_enemy", "era": "fantasy", "archetype": "sorceress",
        "incompatible_with": ["cyberpunk", "modern", "roblox-clicker"],
        "good_for": ["arpg", "rpg", "3d-arpg", "tactical-rpg"],
        "visual_description": "Female sorceress/witch, mystical robes",
    }),
    (r"maw", {
        "role": "enemy", "era": "fantasy-monstrous", "archetype": "monster",
        "incompatible_with": ["farming-life", "life-sim", "cute"],
        "good_for": ["arpg", "3d-arpg", "3d-souls-like", "3d-platformer"],
        "visual_description": "Monstrous creature with oversized mouth/jaws",
    }),
    (r"akai", {
        "role": "hero", "era": "fantasy-asian", "archetype": "ninja",
        "incompatible_with": ["cyberpunk", "modern-military", "farming-life"],
        "good_for": ["arpg", "rpg", "3d-arpg", "beat-em-up"],
        "visual_description": "Japanese ninja/assassin, stealth warrior",
    }),
    (r"survivor", {
        "role": "hero", "era": "post-apocalyptic", "archetype": "survivor",
        "incompatible_with": ["medieval", "fantasy", "roblox-clicker"],
        "good_for": ["fps", "3d-arpg", "survival-crafting", "beat-em-up"],
        "visual_description": "Post-apocalyptic survivor, ragged modern clothing",
    }),
    (r"aj", {
        "role": "hero", "era": "modern", "archetype": "casual",
        "incompatible_with": ["medieval", "fantasy"],
        "good_for": ["adventure", "life-sim", "3d-platformer", "beat-em-up"],
        "visual_description": "Young modern man, casual everyday clothes",
    }),
    (r"lola", {
        "role": "hero", "era": "modern-athletic", "archetype": "runner",
        "incompatible_with": ["medieval", "fantasy"],
        "good_for": ["3d-platformer", "life-sim", "sports-arcade"],
        "visual_description": "Athletic female runner, modern sportswear",
    }),
    (r"eve", {
        "role": "hero", "era": "sci-fi", "archetype": "space-suit",
        "incompatible_with": ["medieval", "fantasy"],
        "good_for": ["fps", "3d-arpg", "shmup", "space-sim"],
        "visual_description": "Female astronaut/space marine in futuristic suit",
    }),
    (r"ely", {
        "role": "hero", "era": "fantasy", "archetype": "mage",
        "incompatible_with": ["cyberpunk", "modern"],
        "good_for": ["arpg", "rpg", "3d-arpg", "tactical-rpg"],
        "visual_description": "Female mage in robes, staff, magical aura",
    }),

    # ── ABSTRACT CATCH-ALL (Ch##_nonPBR files — Mixamo character export naming) ──
    # These are generic Mixamo T-pose/rigged characters that came from pack downloads.
    # Without visual inspection we can't know their specific look. Mark as "generic humanoid".
    (r"ch\d+.nonpbr", {
        "role": "generic_humanoid",
        "era": "unknown",
        "archetype": "character-pack",
        "incompatible_with": [],  # usable anywhere — the animations matter more than the skin
        "good_for": ["all"],
        "visual_description": "Generic Mixamo character with bundled animations (abstract skin)",
        "needs_vision_classification": True,
    }),
]


def lookup(filename: str) -> dict | None:
    """Look up metadata for a Mixamo filename. Returns None if no pattern matches."""
    name_lower = filename.lower()
    # Strip extension
    name_lower = re.sub(r"\.fbx$|\.glb$|\.gltf$", "", name_lower)
    for pattern, meta in PATTERN_REGISTRY:
        if re.search(pattern, name_lower):
            return {**meta, "source_pattern": pattern, "filename": filename}
    return None


def compatible_with(genre: str = None, sub_genre: str = None) -> list:
    """Return all Mixamo files known to match a genre or sub_genre tag."""
    chars_dir = MIXAMO_DIR / "characters"
    if not chars_dir.exists():
        return []
    matches = []
    for fbx in chars_dir.glob("*.fbx"):
        meta = lookup(fbx.name)
        if not meta:
            continue
        good_for = meta.get("good_for", [])
        if "all" in good_for:
            matches.append({"path": str(fbx), "meta": meta})
            continue
        if genre and genre in good_for:
            matches.append({"path": str(fbx), "meta": meta})
        elif sub_genre and sub_genre in good_for:
            matches.append({"path": str(fbx), "meta": meta})
    return matches


def build_classification_report():
    """Classify every Mixamo file we have on disk + save detailed metadata."""
    chars_dir = MIXAMO_DIR / "characters"
    if not chars_dir.exists():
        return {}
    results = {}
    for fbx in sorted(chars_dir.glob("*.fbx")):
        meta = lookup(fbx.name)
        if meta:
            results[fbx.name] = meta
        else:
            results[fbx.name] = {
                "role": "unknown",
                "era": "unknown",
                "archetype": "unclassified",
                "incompatible_with": [],
                "good_for": [],
                "visual_description": f"Unclassified: {fbx.name} — vision check recommended",
                "needs_vision_classification": True,
            }
    return results


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--classify", action="store_true", help="Classify every mixamo file on disk + save JSON")
    ap.add_argument("--lookup", help="Look up a single filename")
    ap.add_argument("--for-genre", help="List characters compatible with a genre/sub_genre")
    args = ap.parse_args()

    if args.lookup:
        meta = lookup(args.lookup)
        print(json.dumps(meta, indent=2) if meta else "No match")
    elif args.for_genre:
        matches = compatible_with(sub_genre=args.for_genre) + compatible_with(genre=args.for_genre)
        seen = set()
        for m in matches:
            if m["path"] in seen: continue
            seen.add(m["path"])
            print(f"  - {Path(m['path']).name:45s}  era={m['meta'].get('era'):15s}  role={m['meta'].get('role')}")
    elif args.classify:
        results = build_classification_report()
        out = MIXAMO_DIR / "classification.json"
        out.write_text(json.dumps(results, indent=2), encoding="utf-8")
        total = len(results)
        classified = sum(1 for r in results.values() if r["role"] != "unknown" and not r.get("needs_vision_classification"))
        needs_vision = sum(1 for r in results.values() if r.get("needs_vision_classification"))
        print(f"Classified {total} Mixamo files:")
        print(f"  - Fully classified via registry: {classified}")
        print(f"  - Generic humanoid (abstract Ch## names, no era-lock): {needs_vision}")
        print(f"  - Unknown (needs vision check): {total - classified - needs_vision}")
        print(f"Report saved to: {out}")
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
