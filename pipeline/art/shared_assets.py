"""shared_assets.py — copy the curated standard sprite library into a game.

The platformer template's lib/asset_loader.js loads sprites from
`shared/sprites/<key>.png`. This script copies those sprite PNGs from the
asset packs in `forgeflow-games/pipeline/assets/` into the per-game
`shared/sprites/` directory so the loader actually finds them.

Source mapping: each loader key maps to a path inside one of the bundled
asset packs. The mapping is the SOURCE OF TRUTH; lib/asset_loader.js
just declares the keys.

Idempotent — re-runs only re-copy missing files.
"""
from __future__ import annotations

from pathlib import Path
import shutil


# Resolve asset roots dynamically so this works whether the script is run
# from the repo root or from inside scripts/.
def _assets_root() -> Path:
    here = Path(__file__).resolve()
    # forgeflow-games/pipeline/art/shared_assets.py → forgeflow-games/pipeline/assets/
    return here.parent.parent / "assets"


# Each entry: (loader_key, source_path_under_assets/)
# Order: most general first. If a source file is missing, the entry is
# skipped silently — game falls back to the runtime placeholder texture.
SPRITE_MAP = [
    # — interactives from new-platformer-pack —
    ("spring",                   "_downloaded/new-platformer-pack/Sprites/Tiles/Default/spring.png"),
    ("spring_out",               "_downloaded/new-platformer-pack/Sprites/Tiles/Default/spring_out.png"),
    ("switch_blue",              "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_blue.png"),
    ("switch_blue_pressed",      "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_blue_pressed.png"),
    ("switch_red",               "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_red.png"),
    ("switch_red_pressed",       "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_red_pressed.png"),
    ("switch_green",             "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_green.png"),
    ("switch_green_pressed",     "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_green_pressed.png"),
    ("switch_yellow",            "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_yellow.png"),
    ("switch_yellow_pressed",    "_downloaded/new-platformer-pack/Sprites/Tiles/Default/switch_yellow_pressed.png"),
    ("lever",                    "_downloaded/new-platformer-pack/Sprites/Tiles/Default/lever.png"),
    ("lever_left",               "_downloaded/new-platformer-pack/Sprites/Tiles/Default/lever_left.png"),
    ("lever_right",              "_downloaded/new-platformer-pack/Sprites/Tiles/Default/lever_right.png"),
    ("conveyor",                 "_downloaded/new-platformer-pack/Sprites/Tiles/Default/conveyor.png"),
    ("ladder_top",               "_downloaded/new-platformer-pack/Sprites/Tiles/Default/ladder_top.png"),
    ("ladder_middle",            "_downloaded/new-platformer-pack/Sprites/Tiles/Default/ladder_middle.png"),
    ("ladder_bottom",            "_downloaded/new-platformer-pack/Sprites/Tiles/Default/ladder_bottom.png"),
    ("door_closed",              "_downloaded/new-platformer-pack/Sprites/Tiles/Default/door_closed.png"),
    ("door_closed_top",          "_downloaded/new-platformer-pack/Sprites/Tiles/Default/door_closed_top.png"),
    ("door_open",                "_downloaded/new-platformer-pack/Sprites/Tiles/Default/door_open.png"),
    ("door_open_top",            "_downloaded/new-platformer-pack/Sprites/Tiles/Default/door_open_top.png"),
    ("sign",                     "_downloaded/new-platformer-pack/Sprites/Tiles/Default/sign.png"),
    ("sign_exit",                "_downloaded/new-platformer-pack/Sprites/Tiles/Default/sign_exit.png"),
    ("sign_left",                "_downloaded/new-platformer-pack/Sprites/Tiles/Default/sign_left.png"),
    ("sign_right",               "_downloaded/new-platformer-pack/Sprites/Tiles/Default/sign_right.png"),

    # — keys —
    ("key_blue",                 "_downloaded/new-platformer-pack/Sprites/Tiles/Default/key_blue.png"),
    ("key_red",                  "_downloaded/new-platformer-pack/Sprites/Tiles/Default/key_red.png"),
    ("key_green",                "_downloaded/new-platformer-pack/Sprites/Tiles/Default/key_green.png"),
    ("key_yellow",               "_downloaded/new-platformer-pack/Sprites/Tiles/Default/key_yellow.png"),

    # — Mario-style item blocks —
    ("block_coin",               "_downloaded/new-platformer-pack/Sprites/Tiles/Default/block_coin.png"),
    ("block_coin_active",        "_downloaded/new-platformer-pack/Sprites/Tiles/Default/block_coin_active.png"),
    ("block_empty",              "_downloaded/new-platformer-pack/Sprites/Tiles/Default/block_empty.png"),
    ("block_exclamation",        "_downloaded/new-platformer-pack/Sprites/Tiles/Default/block_exclamation.png"),
    ("block_exclamation_active", "_downloaded/new-platformer-pack/Sprites/Tiles/Default/block_exclamation_active.png"),
    ("block_spikes",             "_downloaded/new-platformer-pack/Sprites/Tiles/Default/block_spikes.png"),

    # — hazards —
    ("lava",                     "_downloaded/new-platformer-pack/Sprites/Tiles/Default/lava.png"),
    ("lava_top",                 "_downloaded/new-platformer-pack/Sprites/Tiles/Default/lava_top.png"),
    ("lava_top_low",             "_downloaded/new-platformer-pack/Sprites/Tiles/Default/lava_top_low.png"),
    ("water",                    "_downloaded/new-platformer-pack/Sprites/Tiles/Default/water.png"),
    ("spikes",                   "_downloaded/new-platformer-pack/Sprites/Tiles/Default/spikes.png"),
    ("saw",                      "_downloaded/new-platformer-pack/Sprites/Tiles/Default/saw.png"),
    ("bomb",                     "_downloaded/new-platformer-pack/Sprites/Tiles/Default/bomb.png"),
    ("bomb_active",              "_downloaded/new-platformer-pack/Sprites/Tiles/Default/bomb_active.png"),

    # — castle / building (deluxe pack) —
    ("bg_castle",                "platformer-art-deluxe/Base pack/bg_castle.png"),
    ("castleMid",                "platformer-art-deluxe/Base pack/Tiles/castleMid.png"),
    ("castleCenter",             "platformer-art-deluxe/Base pack/Tiles/castleCenter.png"),
    ("brickWall",                "platformer-art-deluxe/Base pack/Tiles/brickWall.png"),
    ("torch",                    "platformer-art-deluxe/Base pack/Tiles/torch.png"),

    # — HUD —
    ("hud_heartFull",            "platformer-art-deluxe/Base pack/HUD/hud_heartFull.png"),
    ("hud_heartHalf",            "platformer-art-deluxe/Base pack/HUD/hud_heartHalf.png"),
    ("hud_heartEmpty",           "platformer-art-deluxe/Base pack/HUD/hud_heartEmpty.png"),
    ("hud_coins",                "platformer-art-deluxe/Base pack/HUD/hud_coins.png"),
    ("hud_key_blue",             "_downloaded/new-platformer-pack/Sprites/Tiles/Default/hud_key_blue.png"),
    ("hud_key_red",              "_downloaded/new-platformer-pack/Sprites/Tiles/Default/hud_key_red.png"),
    ("hud_key_green",            "_downloaded/new-platformer-pack/Sprites/Tiles/Default/hud_key_green.png"),
    ("hud_key_yellow",           "_downloaded/new-platformer-pack/Sprites/Tiles/Default/hud_key_yellow.png"),

    # — flags / checkpoint —
    ("flagBlue",                 "platformer-art-deluxe/Base pack/Items/flagBlue.png"),
    ("flagBlueHanging",          "platformer-art-deluxe/Base pack/Items/flagBlueHanging.png"),
    ("flagGreen",                "platformer-art-deluxe/Base pack/Items/flagGreen.png"),
    ("flagRed",                  "platformer-art-deluxe/Base pack/Items/flagRed.png"),
    ("flagYellow",               "platformer-art-deluxe/Base pack/Items/flagYellow.png"),

    # — coins / gems —
    ("coinGold",                 "platformer-art-deluxe/Base pack/Items/coinGold.png"),
    ("coinSilver",               "platformer-art-deluxe/Base pack/Items/coinSilver.png"),
    ("coinBronze",               "platformer-art-deluxe/Base pack/Items/coinBronze.png"),
    ("gemBlue",                  "platformer-art-deluxe/Base pack/Items/gemBlue.png"),
    ("gemRed",                   "platformer-art-deluxe/Base pack/Items/gemRed.png"),
    ("gemGreen",                 "platformer-art-deluxe/Base pack/Items/gemGreen.png"),
    ("gemYellow",                "platformer-art-deluxe/Base pack/Items/gemYellow.png"),
    ("star",                     "platformer-art-deluxe/Base pack/Items/star.png"),
]


def copy_shared_assets(game_dir: Path, log=print) -> dict:
    """Copy all SPRITE_MAP entries into <game_dir>/shared/sprites/.

    Returns: {"copied": int, "skipped_already": int, "missing_source": [keys]}.
    """
    assets_root = _assets_root()
    dst_dir = Path(game_dir) / "shared" / "sprites"
    dst_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    skipped = 0
    missing = []

    for key, rel_src in SPRITE_MAP:
        src = assets_root / rel_src
        dst = dst_dir / f"{key}.png"
        if dst.exists():
            skipped += 1
            continue
        if not src.exists():
            missing.append(key)
            continue
        try:
            shutil.copy2(src, dst)
            copied += 1
        except Exception as e:
            log(f"  shared_assets: copy failed for {key}: {e}")
            missing.append(key)

    if log:
        log(f"  shared_assets: copied={copied} skipped={skipped} missing_sources={len(missing)}")
    return {"copied": copied, "skipped_already": skipped, "missing_source": missing}


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("game_dir")
    args = ap.parse_args()
    res = copy_shared_assets(Path(args.game_dir))
    print(res)
