#!/usr/bin/env python3
"""twod_asset_selector.py — slug-seeded REAL 2D sprite selection from the F: pixel packs,
replacing engine_game_emit's hardcoded 5-asset map (every platformer shipped the SAME
tile_0000 hero, every shooter the SAME pair — so generated 2D games looked identical).

select_asset_set(template, slug) returns the exact shape engine_game_emit._stage_assets
consumes — {"sprites": {role: <relpath under pipeline/assets>}} — but picks a DIFFERENT
real sprite per slug from the pack, so each game gets a distinct hero/foe/pickup. Returns
None for the 3D "collect" template (keeps its GLB models) and when F: isn't mounted
(caller falls back to the old ASSET_SETS / colour). Deterministic: same slug -> same set.

Pools are built by scanning the real packs and filtering to files that exist, so a missing
pack degrades to fewer choices, never a broken ref:
  • pixel-platformer/Tiles/Characters + platformer-art-deluxe Base pack (Player/Enemies/Items)
  • pixel-shmup/Ships (+ Tiles)
NOTE: the emitter renders STATIC sprite quads (no walk-cycle animation), so single-pose
frames are correct here; animated sprite-sheets (Kenney new-platformer-pack — absent on F:)
are a separate future tier. See feedback_never_patch_games / project_kenney_enemies.
"""
import hashlib
from pathlib import Path

ART_DIR = Path(__file__).resolve().parent
ASSETS_ROOT = ART_DIR.parent / "assets"            # junction -> F:/games/forgeflow-games-assets

PP_CHARS = "pixel-platformer/Tiles/Characters"
DELUXE = "platformer-art-deluxe/Base pack"
SHMUP_SHIPS = "pixel-shmup/Ships"
SHMUP_TILES = "pixel-shmup/Tiles"

# pickup/coin sprites we want from the deluxe Items dir (filtered to those that exist)
COIN_KEYWORDS = ("coingold", "coinsilver", "coinbronze", "gemblue", "gemgreen", "gemred",
                 "gemyellow", "star", "keyyellow", "keyblue", "keygreen", "keyred", "heart")


def root():
    return ASSETS_ROOT if (ASSETS_ROOT / PP_CHARS).exists() or (ASSETS_ROOT / SHMUP_SHIPS).exists() else None


def _scan(rel_dir, predicate=None):
    """Sorted list of relpaths (posix, under ASSETS_ROOT) of *.png in rel_dir matching predicate."""
    d = ASSETS_ROOT / rel_dir
    if not d.exists():
        return []
    out = []
    for p in sorted(d.glob("*.png")):
        if predicate is None or predicate(p.name.lower()):
            out.append(f"{rel_dir}/{p.name}")
    return out


def _pools():
    """Build role -> [relpath] pools from whatever packs are present on F:.
    Role KEYS must match what engine_game_emit's templates consume:
      • platformer template reads sprite keys "hero" + "star" (the pickup) — NO enemy sprite.
      • shooter template reads "hero" + "foe"."""
    # platformer hero: distinct standing characters
    hero_plat = _scan(PP_CHARS) + _scan(f"{DELUXE}/Player",
                                        lambda n: n.endswith("_front.png") or n.endswith("_stand.png"))
    star_plat = _scan(f"{DELUXE}/Items", lambda n: any(k in n for k in COIN_KEYWORDS))
    # shooter: split the ships list so hero ships and enemy ships differ
    ships = _scan(SHMUP_SHIPS)
    half = max(1, len(ships) // 2)
    hero_ship, foe_ship = ships[:half], ships[half:] or ships[:half]
    return {
        "platformer": {"hero": hero_plat, "star": star_plat},
        "shooter": {"hero": hero_ship, "foe": foe_ship},
    }


def _pick(pool, *seed_parts):
    if not pool:
        return None
    h = hashlib.sha1("::".join(str(s) for s in seed_parts).encode("utf-8")).hexdigest()
    return pool[int(h[:8], 16) % len(pool)]


def select_asset_set(template, slug):
    """Return {"sprites": {role: relpath}} for a 2D template, slug-seeded. None for the 3D
    "collect" template or when F: isn't mounted (caller keeps the old ASSET_SETS/colour)."""
    if template not in ("platformer", "shooter"):
        return None
    if not root():
        return None
    pools = _pools().get(template, {})
    sprites = {}
    for role, pool in pools.items():
        rel = _pick(pool, slug, template, role)
        if rel:
            sprites[role] = rel
    return {"sprites": sprites} if sprites else None


if __name__ == "__main__":
    if not root():
        print("F: pixel packs not mounted"); raise SystemExit(0)
    pools = _pools()
    for t, roles in pools.items():
        print(f"{t}: " + ", ".join(f"{r}={len(p)}" for r, p in roles.items()))
    print("--- variety sample ---")
    for slug in ("lumen-run", "neon-breakout", "star-drift", "cave-hopper"):
        for t in ("platformer", "shooter"):
            s = select_asset_set(t, slug)
            print(f"  {slug}/{t}: {s['sprites'] if s else None}")
