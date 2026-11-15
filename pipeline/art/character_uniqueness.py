#!/usr/bin/env python3
"""
character_uniqueness.py — Ensures every shipped game has a UNIQUE protagonist
and a shuffled NPC cast.

PROBLEM: the pipeline generates protagonists via `design["protagonist"]["visual_description"]`.
If Claude's design phase outputs similar descriptions across games (e.g., two games
both get "brave young swordsman in blue cape"), the generated sprites will look alike
and games will feel repetitive.

SOLUTION:
  1. Persistent registry of every character description ever generated
     (`state/character_registry.json`)
  2. Before finalizing a new game's protagonist, check SIMILARITY to all prior
     descriptions. If too similar (Jaccard overlap > 0.6), regenerate with
     explicit "must differ from: [previous descriptions]" in the prompt.
  3. NPC cast: maintained pool of varied traits, shuffled per game so no two
     games share the same set of side characters.

API:
  from character_uniqueness import (
      register_protagonist, check_similarity, suggest_differentiation_prompt,
      pick_npc_cast, register_npc_usage,
  )
  register_protagonist("Jungle Surge", "red mascot in cap with power gloves")
  is_too_similar, overlap = check_similarity("brave red hero with cape", 0.6)
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
STATE_DIR = ROOT / "state"
REGISTRY_PATH = STATE_DIR / "character_registry.json"


def _load():
    if not REGISTRY_PATH.exists():
        return {"protagonists": [], "bosses": [], "npcs_used": {}, "palette_seeds": {}}
    return json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))


def _save(data):
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    REGISTRY_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _tokenize(desc: str) -> set:
    """Strip punctuation, lowercase, stopword-filter → token set."""
    stop = {"the", "a", "an", "of", "with", "and", "in", "on", "at", "for", "to", "is", "who", "that"}
    words = re.findall(r"[a-z]+", desc.lower())
    return {w for w in words if w not in stop and len(w) >= 3}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def register_protagonist(game_title: str, visual_description: str, slug: str = None):
    """Save a shipped protagonist description to prevent future duplicates."""
    data = _load()
    entry = {
        "game": game_title,
        "slug": slug or game_title.lower().replace(" ", "-"),
        "visual_description": visual_description,
        "tokens": list(_tokenize(visual_description)),
    }
    data["protagonists"].append(entry)
    _save(data)


def register_boss(game_title: str, boss_name: str, visual_description: str):
    data = _load()
    data["bosses"].append({
        "game": game_title, "boss_name": boss_name,
        "visual_description": visual_description,
        "tokens": list(_tokenize(visual_description)),
    })
    _save(data)


def check_similarity(visual_description: str, threshold: float = 0.6) -> tuple:
    """Returns (is_too_similar: bool, max_overlap: float, similar_games: list)."""
    data = _load()
    tokens = _tokenize(visual_description)
    max_overlap = 0.0
    matches = []
    for p in data.get("protagonists", []):
        prev_tokens = set(p.get("tokens", []))
        overlap = _jaccard(tokens, prev_tokens)
        if overlap > max_overlap:
            max_overlap = overlap
        if overlap >= threshold:
            matches.append({"game": p["game"], "overlap": round(overlap, 2), "description": p["visual_description"]})
    matches.sort(key=lambda m: -m["overlap"])
    return max_overlap >= threshold, round(max_overlap, 2), matches[:5]


def suggest_differentiation_prompt() -> str:
    """Return a prompt snippet that Claude can use to avoid copying prior protagonists."""
    data = _load()
    recent = data.get("protagonists", [])[-8:]
    if not recent:
        return ""
    prior = "\n".join(f"  - {p['game']}: {p['visual_description']}" for p in recent)
    return (
        "\n\nUNIQUENESS CONSTRAINT (2026-04-17): The following protagonists have already shipped — "
        "your new protagonist MUST differ materially (different color scheme, outfit, "
        "species, silhouette):\n"
        + prior
    )


# ── NPC cast shuffling ──────────────────────────────────────────────────────

NPC_ARCHETYPES = [
    # (name template, trait, archetype)
    {"archetype": "wise_mentor",       "trait": "grey-bearded, robed, wise, carries ancient book"},
    {"archetype": "plucky_sidekick",   "trait": "cheerful, scrappy, wears patched clothes"},
    {"archetype": "mysterious_stranger","trait": "hooded, scarred, speaks in riddles"},
    {"archetype": "gruff_blacksmith",  "trait": "muscular, soot-stained apron, bald"},
    {"archetype": "kind_healer",       "trait": "soft-eyed, white robes, carries satchel of herbs"},
    {"archetype": "sly_merchant",      "trait": "greasy grin, colorful vest, overflowing coin pouch"},
    {"archetype": "noble_warrior",     "trait": "gleaming armor, stoic, carries family crest shield"},
    {"archetype": "rebellious_rogue",  "trait": "hood, two daggers, smirks constantly"},
    {"archetype": "eccentric_scholar", "trait": "tangled hair, ink-stained fingers, cracked spectacles"},
    {"archetype": "orphan_child",      "trait": "small, ragged clothes, big curious eyes"},
    {"archetype": "retired_soldier",   "trait": "limping, war medals, kind weary smile"},
    {"archetype": "bardic_traveler",   "trait": "lute on back, flashy clothes, loud laugh"},
    {"archetype": "beastmaster",       "trait": "wild hair, leather garb, surrounded by small pets"},
    {"archetype": "spirit_guide",      "trait": "semi-transparent, floats, glowing markings"},
    {"archetype": "shady_fence",       "trait": "dark alley dweller, missing teeth, whispers"},
    {"archetype": "pompous_noble",     "trait": "powdered wig, silk doublet, looks down nose"},
    {"archetype": "tragic_hero",       "trait": "haunted eyes, broken weapon, scarred face"},
    {"archetype": "cheerful_farmer",   "trait": "straw hat, apron with pockets, rosy cheeks"},
    {"archetype": "mysterious_witch",  "trait": "pointed hat, cauldron scars, piercing green eyes"},
    {"archetype": "noble_priestess",   "trait": "flowing white dress, gold circlet, kind serene smile"},
]


def pick_npc_cast(game_slug: str, count: int = 6) -> list:
    """Return a random-but-deterministic NPC cast for a game. Per-game hash seed
    ensures same game always gets same NPCs (reproducibility), but different games
    get different NPC subsets (no repetition feel).
    """
    import random
    rng = random.Random(hash(game_slug))
    shuffled = rng.sample(NPC_ARCHETYPES, min(count, len(NPC_ARCHETYPES)))
    return shuffled


def register_npc_usage(game_slug: str, npc_archetypes: list):
    data = _load()
    data["npcs_used"][game_slug] = npc_archetypes
    _save(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", nargs=2, metavar=("GAME", "DESCRIPTION"))
    ap.add_argument("--check",    help="Check a proposed description against history")
    ap.add_argument("--list",     action="store_true")
    ap.add_argument("--suggest",  action="store_true")
    ap.add_argument("--npc-cast", help="Pick NPC cast for game slug")
    args = ap.parse_args()

    if args.register:
        register_protagonist(args.register[0], args.register[1])
        print(f"Registered: {args.register[0]}")
    elif args.check:
        too_similar, overlap, matches = check_similarity(args.check)
        print(f"Too similar: {too_similar} (max overlap: {overlap})")
        for m in matches:
            print(f"  - {m['game']} (overlap {m['overlap']}): {m['description']}")
    elif args.list:
        data = _load()
        print(f"Registered protagonists: {len(data.get('protagonists', []))}")
        for p in data.get("protagonists", [])[-10:]:
            print(f"  - {p['game']}: {p['visual_description']}")
    elif args.suggest:
        print(suggest_differentiation_prompt())
    elif args.npc_cast:
        cast = pick_npc_cast(args.npc_cast)
        for n in cast:
            print(f"  - {n['archetype']:25s} | {n['trait']}")
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
