"""
enemy_sprite_mapper.py - Map design.json enemies to Kenney animated spritesheets.

2026-04-23: Rewritten to source from Kenney's *new-platformer-pack*, whose
enemies ship with GENUINE multi-frame walk cycles (walk_a + walk_b, fly_a + fly_b,
move_a + move_b, swim_a + swim_b, etc.) instead of the older enemies.xml atlas
where each state was a single frozen pose. PixelLab credits are reserved for
BOSSES (identity-critical); enemies use this battle-tested animated atlas.

Source atlas:
    forgeflow-games/pipeline/assets/_downloaded/new-platformer-pack/
        Spritesheets/spritesheet-enemies-default.png  +  .xml (60 subtextures)

Kenney enemy types available with genuine 2-frame animation cycles:
    bee          (rest + 2-frame fly a/b)
    fly          (rest + 2-frame fly a/b)
    ladybug      (rest + 2-frame walk a/b + fly)
    mouse        (rest + 2-frame walk a/b)
    frog         (idle + jump + rest)
    fish_blue    (rest + 2-frame swim a/b)
    fish_yellow  (rest + 2-frame swim a/b)
    fish_purple  (rest + up/down alternation)
    barnacle     (rest + 2-frame attack a/b)
    saw          (rest + 2-frame spin a/b)
    slime_normal (rest + 2-frame walk a/b + flat/squashed)
    slime_block  (rest + 2-frame walk a/b + jump)
    slime_fire   (rest + 2-frame walk a/b + flat)
    slime_spike  (rest + 2-frame walk a/b + flat)
    snail        (rest + 2-frame walk a/b + shell/defensive)
    worm_normal  (rest + 2-frame move a/b)
    worm_ring    (rest + 2-frame move a/b)
    block        (idle + fall + rest - trap-style)

The new pack does NOT ship dedicated hit/dead frames per enemy. Hit/death is
conveyed by the template's built-in VFX (tint flash, scale pulse, fade out
tween - see GameScene.updateEnemies + _playEnemyAnim), plus a "squash" variant
(slime_*_flat) used as a death pose for slime types.

Mapping heuristics (behavior + name keywords):
    behavior=fly OR name has bat/bee/ladybug/fly/wasp/moth -> bee / fly / ladybug
    behavior=swim OR name has fish/piranha/shark          -> fish_blue / fish_yellow / fish_purple
    behavior=ambush + hang/ceiling                        -> barnacle
    behavior=jump OR name has frog/toad                   -> frog / slime_block
    behavior=charge + armored/shell                       -> snail / slime_block
    behavior=shoot                                        -> bee / barnacle
    behavior=patrol (default)                             -> slime_normal / mouse / ladybug / worm_normal
    name has spike/thorn                                  -> slime_spike
    name has fire/lava/ember/magma                        -> slime_fire
    name has worm/grub                                    -> worm_normal / worm_ring
    name has snake/serpent                                -> worm_normal (closest available)
    name has saw/blade/trap                               -> saw
    name has block/crate/rock                             -> block
    fallback                                              -> slime_normal (classic platformer enemy)
"""
from __future__ import annotations
import re
from pathlib import Path

ATLAS_KEY = "enemies_atlas"
ATLAS_PNG = "spritesheet-enemies-default.png"
ATLAS_XML = "spritesheet-enemies-default.xml"

# Output filenames inside each game's assets/ dir (keep stable so templates don't change)
GAME_ATLAS_PNG = "enemies.png"
GAME_ATLAS_XML = "enemies.xml"

SOURCE_DIR = (Path(__file__).resolve().parents[1]
              / "assets" / "_downloaded" / "new-platformer-pack"
              / "Spritesheets")


# Each Kenney enemy type -> animation frame LISTS (not single frames).
# walk/fly/swim states have genuine 2-frame alternation from Kenney's pack.
KENNEY_ENEMIES: dict[str, dict[str, list[str]]] = {
    "bee": {
        "idle": ["bee_rest"],
        "walk": ["bee_a", "bee_b"],
        "fly":  ["bee_a", "bee_b"],
    },
    "fly": {
        "idle": ["fly_rest"],
        "walk": ["fly_a", "fly_b"],
        "fly":  ["fly_a", "fly_b"],
    },
    "ladybug": {
        "idle": ["ladybug_rest"],
        "walk": ["ladybug_walk_a", "ladybug_walk_b"],
        "fly":  ["ladybug_fly"],
    },
    "mouse": {
        "idle": ["mouse_rest"],
        "walk": ["mouse_walk_a", "mouse_walk_b"],
    },
    "frog": {
        "idle": ["frog_rest", "frog_idle"],
        "walk": ["frog_idle", "frog_jump"],
        "leap": ["frog_jump", "frog_idle"],
        "jump": ["frog_jump"],
    },
    "fish_blue": {
        "idle": ["fish_blue_rest"],
        "walk": ["fish_blue_swim_a", "fish_blue_swim_b"],
        "swim": ["fish_blue_swim_a", "fish_blue_swim_b"],
    },
    "fish_yellow": {
        "idle": ["fish_yellow_rest"],
        "walk": ["fish_yellow_swim_a", "fish_yellow_swim_b"],
        "swim": ["fish_yellow_swim_a", "fish_yellow_swim_b"],
    },
    "fish_purple": {
        "idle": ["fish_purple_rest"],
        "walk": ["fish_purple_up", "fish_purple_down"],
        "swim": ["fish_purple_up", "fish_purple_down"],
    },
    "barnacle": {
        "idle": ["barnacle_attack_rest"],
        "walk": ["barnacle_attack_a", "barnacle_attack_b"],
        "bite": ["barnacle_attack_a", "barnacle_attack_b"],
    },
    "saw": {
        "idle": ["saw_rest"],
        "walk": ["saw_a", "saw_b"],
        "spin": ["saw_a", "saw_b"],
    },
    "slime_normal": {
        "idle":   ["slime_normal_rest"],
        "walk":   ["slime_normal_walk_a", "slime_normal_walk_b"],
        "squash": ["slime_normal_flat"],
    },
    "slime_block": {
        "idle": ["slime_block_rest"],
        "walk": ["slime_block_walk_a", "slime_block_walk_b"],
        "jump": ["slime_block_jump"],
    },
    "slime_fire": {
        "idle":   ["slime_fire_rest"],
        "walk":   ["slime_fire_walk_a", "slime_fire_walk_b"],
        "squash": ["slime_fire_flat"],
    },
    "slime_spike": {
        "idle":   ["slime_spike_rest"],
        "walk":   ["slime_spike_walk_a", "slime_spike_walk_b"],
        "squash": ["slime_spike_flat"],
    },
    "snail": {
        "idle":  ["snail_rest"],
        "walk":  ["snail_walk_a", "snail_walk_b"],
        "shell": ["snail_shell"],
    },
    "worm_normal": {
        "idle": ["worm_normal_rest"],
        "walk": ["worm_normal_move_a", "worm_normal_move_b"],
    },
    "worm_ring": {
        "idle": ["worm_ring_rest"],
        "walk": ["worm_ring_move_a", "worm_ring_move_b"],
    },
    "block": {
        "idle": ["block_idle", "block_rest"],
        "walk": ["block_idle", "block_fall"],
        "jump": ["block_fall"],
    },
}


# Behavior -> ordered candidate Kenney enemies (first one picked deterministically by seed_hash)
BEHAVIOR_MATCH = {
    "fly":     ["bee", "fly", "ladybug"],
    "flying":  ["bee", "fly", "ladybug"],
    "swim":    ["fish_blue", "fish_yellow", "fish_purple"],
    "ambush":  ["barnacle", "snail"],
    "jump":    ["frog", "slime_block"],
    "jumper":  ["frog", "slime_block"],
    "charge":  ["snail", "slime_block"],
    "shoot":   ["bee", "barnacle"],
    "shooter": ["bee", "barnacle"],
    "patrol":  ["slime_normal", "mouse", "ladybug", "worm_normal", "worm_ring"],
    "chase":   ["slime_normal", "mouse", "ladybug"],
    "trap":    ["saw", "block"],
    "spike":   ["slime_spike", "saw"],
    "fire":    ["slime_fire"],
}

KEYWORD_MATCH = {
    # name/visual substring -> specific Kenney enemy (overrides behavior)
    "bat":       "fly",
    "bee":       "bee",
    "wasp":      "bee",
    "hornet":    "bee",
    "moth":      "fly",
    "fly":       "fly",
    "ladybug":   "ladybug",
    "beetle":    "ladybug",
    "fish":      "fish_blue",
    "piranha":   "fish_purple",
    "shark":     "fish_purple",
    "frog":      "frog",
    "toad":      "frog",
    "slug":      "slime_normal",
    "slime":     "slime_normal",
    "mushroom":  "slime_normal",
    "shroom":    "slime_normal",
    "mouse":     "mouse",
    "rat":       "mouse",
    "snail":     "snail",
    "tortoise":  "snail",
    "barnacle":  "barnacle",
    "crab":      "barnacle",
    "worm":      "worm_normal",
    "grub":      "worm_ring",
    "snake":     "worm_normal",
    "serpent":   "worm_ring",
    "spider":    "ladybug",
    "spike":     "slime_spike",
    "thorn":     "slime_spike",
    "fire":      "slime_fire",
    "ember":     "slime_fire",
    "lava":      "slime_fire",
    "magma":     "slime_fire",
    "saw":       "saw",
    "blade":     "saw",
    "block":     "block",
    "crate":     "block",
    "rock":      "block",
    "boulder":   "block",
}


def _pick_from_list(candidates: list, seed_hash: int = 0) -> str:
    """Deterministically rotate through candidates."""
    if not candidates:
        return "slime_normal"
    return candidates[seed_hash % len(candidates)]


def map_enemy_to_kenney(enemy_spec: dict, seed_hash: int = 0) -> dict:
    """Map one design.json enemy to a Kenney enemy type + animation config.

    Returns:
        {
          "kenney_type": "bee",
          "atlas_key":   "enemies_atlas",
          "base_frame":  "bee_rest",                    # initial Phaser frame
          "animations":  {"idle": ["bee_rest"], "walk": ["bee_a","bee_b"], ...}
        }
    """
    name = str(enemy_spec.get("name", "")).lower()
    behavior = str(enemy_spec.get("behavior", "patrol")).lower()
    visual = str(enemy_spec.get("visual_description", "")).lower()

    picked_type = None

    # 1. Keyword match in name (highest priority)
    for kw, kenney_type in KEYWORD_MATCH.items():
        if kw in name or kw in visual:
            if kenney_type in KENNEY_ENEMIES:
                picked_type = kenney_type
                break

    # 2. Behavior match
    if not picked_type:
        for beh_key in (behavior, behavior.replace("_", " ")):
            if beh_key in BEHAVIOR_MATCH:
                candidates = [c for c in BEHAVIOR_MATCH[beh_key] if c in KENNEY_ENEMIES]
                if candidates:
                    picked_type = _pick_from_list(candidates, seed_hash)
                    break

    # 3. Default
    if not picked_type:
        picked_type = "slime_normal"

    states = KENNEY_ENEMIES[picked_type]

    # Animation composition:
    # walk: use genuine 2-frame cycle from Kenney (walk_a + walk_b). Extend to
    # 4-frame [a, b, a, b] at 10fps for AAA-feel smoothness (NES-tier classic).
    # idle: hold the rest pose (some types have multiple idle frames).
    # Behavior-specific (fly/swim/leap/jump/bite/squash/shell/spin):
    #   use the state's frames directly as the animation.
    animations: dict[str, list[str]] = {}

    idle_frames = states.get("idle") or []
    walk_frames = states.get("walk") or []

    # Idle: gentle 2-3 frame breathing loop
    if idle_frames:
        animations["idle"] = idle_frames if len(idle_frames) >= 2 else idle_frames * 2

    # Walk: extend to 4-frame cycle for smoother motion
    if walk_frames:
        if len(walk_frames) >= 2:
            animations["walk"] = [walk_frames[0], walk_frames[1], walk_frames[0], walk_frames[1]]
        else:
            animations["walk"] = walk_frames * 2

    # Behavior-specific extras - use frame lists directly
    for behavior_key in ("fly", "swim", "leap", "jump", "bite", "squash", "shell", "spin"):
        frames = states.get(behavior_key) or []
        if not frames:
            continue
        if len(frames) >= 2:
            animations[behavior_key] = [frames[0], frames[1], frames[0], frames[1]]
        elif frames:
            animations[behavior_key] = frames * 2

    # hit / dead: no dedicated frames in the new pack. Template VFX (tint flash,
    # scale pulse, fade out tween) carries the feedback. We still register a
    # short "hit" anim pointing at the idle frame so _playEnemyAnim("hit") is a
    # valid no-op flash rather than failing silently.
    if idle_frames:
        animations["hit"] = [idle_frames[0], idle_frames[0]]
        # "dead": prefer a squashed/flat variant if available
        squash_frames = states.get("squash") or states.get("shell") or []
        if squash_frames:
            animations["dead"] = [squash_frames[0], squash_frames[0]]
        else:
            animations["dead"] = [idle_frames[0], idle_frames[0]]

    base_frame = (idle_frames[0] if idle_frames
                  else (walk_frames[0] if walk_frames else f"{picked_type}_rest"))

    return {
        "kenney_type": picked_type,
        "atlas_key":   ATLAS_KEY,
        "base_frame":  base_frame,
        "animations":  {k: [f for f in v if f] for k, v in animations.items() if v},
    }


def map_all_enemies(design_enemies: list) -> list[dict]:
    """Map all design enemies to Kenney animation configs with stable variety."""
    results = []
    for i, e in enumerate(design_enemies):
        cfg = map_enemy_to_kenney(e, seed_hash=i)
        cfg["enemy_name"] = e.get("name", f"enemy_{i}")
        cfg["enemy_index"] = i
        cfg["enemy_ref"] = e.get("name", f"enemy_{i}")
        results.append(cfg)
    return results


def copy_atlas_to_game(game_assets_dir: Path, log_fn=print) -> bool:
    """Copy the new-platformer-pack enemies atlas into the game's assets folder.

    Output files: assets/enemies.png + assets/enemies.xml  (stable names; the
    template always loads "enemies.png" + "enemies.xml"). We rewrite the XML's
    imagePath attribute to "enemies.png" on the fly so the atlas resolves.
    """
    import shutil
    src_png = SOURCE_DIR / ATLAS_PNG
    src_xml = SOURCE_DIR / ATLAS_XML
    if not src_png.exists() or not src_xml.exists():
        log_fn(f"  [enemy_mapper] Kenney source missing: {SOURCE_DIR}")
        return False
    game_assets_dir.mkdir(exist_ok=True)
    dst_png = game_assets_dir / GAME_ATLAS_PNG
    dst_xml = game_assets_dir / GAME_ATLAS_XML
    shutil.copy2(src_png, dst_png)
    # Rewrite the imagePath in the XML so the atlas resolves to "enemies.png"
    xml_text = src_xml.read_text(encoding="utf-8")
    xml_text = re.sub(r'imagePath="[^"]+"', f'imagePath="{GAME_ATLAS_PNG}"', xml_text, count=1)
    dst_xml.write_text(xml_text, encoding="utf-8")
    log_fn(f"  [enemy_mapper] Copied Kenney new-platformer-pack enemies atlas to "
           f"{game_assets_dir.name}/assets/ ({dst_png.stat().st_size:,} bytes PNG + "
           f"{dst_xml.stat().st_size:,} bytes XML)")
    return True


def generate_structured_animation_specs(mapped_enemies: list[dict]) -> list[dict]:
    """Produce a JSON-serializable list of anim specs the template iterates to
    register animations. Replaces the prior JS-string approach (eval'd via
    `new Function()`) so the template never parses untrusted code — just data.

    Returns entries like:
        [{"key": "slime_normal_walk",
          "frames": ["slime_normal_walk_a","slime_normal_walk_b", ...],
          "frameRate": 10, "repeat": -1}, ...]
    """
    ANIM_SPECS = {
        "idle":   {"fps": 3,  "repeat": -1},
        "walk":   {"fps": 10, "repeat": -1},
        "fly":    {"fps": 12, "repeat": -1},
        "swim":   {"fps": 10, "repeat": -1},
        "leap":   {"fps": 14, "repeat": 0},
        "jump":   {"fps": 14, "repeat": 0},
        "spin":   {"fps": 18, "repeat": -1},
        "bite":   {"fps": 8,  "repeat": -1},
        "squash": {"fps": 6,  "repeat": 0},
        "shell":  {"fps": 6,  "repeat": -1},
        "hit":    {"fps": 10, "repeat": 0},
        "dead":   {"fps": 6,  "repeat": 0},
    }
    out: list = []
    seen_keys: set = set()
    for cfg in mapped_enemies:
        ktype = cfg.get("kenney_type")
        if not ktype:
            continue
        for anim_name, frames in (cfg.get("animations") or {}).items():
            if not frames:
                continue
            key = f"{ktype}_{anim_name}"
            if key in seen_keys:
                continue
            seen_keys.add(key)
            spec = ANIM_SPECS.get(anim_name, {"fps": 8, "repeat": 0})
            out.append({
                "key": key,
                "frames": list(frames),
                "frameRate": spec["fps"],
                "repeat": spec["repeat"],
            })
    return out


def generate_js_enemy_animation_registrations(mapped_enemies: list[dict]) -> str:
    """Produce the JS block that registers Phaser animations per enemy type.
    Called in GameScene.createEnemies BEFORE any enemy sprites are spawned.

    Frame rate + repeat rules:
      idle:   3 fps, loop  (gentle breathing)
      walk:  10 fps, loop  (NES-tier walk cycle, 4-frame a/b/a/b)
      fly:   12 fps, loop  (wing flap feel)
      swim:  10 fps, loop
      leap:  14 fps, once  (fast action)
      jump:  14 fps, once
      spin:  18 fps, loop  (saw blade)
      bite:   8 fps, loop
      squash: 6 fps, once
      shell:  6 fps, loop  (defensive)
      hit:   10 fps, once  (flash placeholder - real VFX is tint/scale tween)
      dead:   6 fps, once
    """
    ANIM_SPECS = {
        "idle":   {"fps": 3,  "repeat": -1},
        "walk":   {"fps": 10, "repeat": -1},
        "fly":    {"fps": 12, "repeat": -1},
        "swim":   {"fps": 10, "repeat": -1},
        "leap":   {"fps": 14, "repeat": 0},
        "jump":   {"fps": 14, "repeat": 0},
        "spin":   {"fps": 18, "repeat": -1},
        "bite":   {"fps": 8,  "repeat": -1},
        "squash": {"fps": 6,  "repeat": 0},
        "shell":  {"fps": 6,  "repeat": -1},
        "hit":    {"fps": 10, "repeat": 0},
        "dead":   {"fps": 6,  "repeat": 0},
    }
    lines = []
    seen_types = set()
    for cfg in mapped_enemies:
        ktype = cfg.get("kenney_type")
        if ktype in seen_types:
            continue
        seen_types.add(ktype)
        for anim_name, frames in cfg.get("animations", {}).items():
            if not frames:
                continue
            key = f"{ktype}_{anim_name}"
            frames_js = ",\n          ".join(
                f'{{ key: "{ATLAS_KEY}", frame: "{f}" }}' for f in frames
            )
            spec = ANIM_SPECS.get(anim_name, {"fps": 8, "repeat": 0})
            lines.append(
                f'        if (!this.anims.exists("{key}")) {{\n'
                f'          this.anims.create({{ key: "{key}", frames: [\n'
                f'            {frames_js}\n'
                f'          ], frameRate: {spec["fps"]}, repeat: {spec["repeat"]} }});\n'
                f'        }}'
            )
    return "\n".join(lines)


def generate_enemy_type_to_kenney_map_js(mapped_enemies: list[dict]) -> str:
    """Produce a JS object mapping enemy.name -> Kenney animation key prefix."""
    entries = []
    for cfg in mapped_enemies:
        nm = cfg.get("enemy_name", "").replace('"', '\\"')
        ktype = cfg.get("kenney_type", "slime_normal")
        entries.append(f'    "{nm}": "{ktype}"')
    return "const ENEMY_KENNEY_MAP = {\n" + ",\n".join(entries) + "\n  };"


if __name__ == "__main__":
    # Sanity test with common enemies
    test_enemies = [
        {"name": "Tiki Hopper",       "behavior": "patrol", "visual_description": "small wooden mask"},
        {"name": "Vine Strangler",    "behavior": "ambush", "visual_description": "hanging vine"},
        {"name": "Ember Bat",         "behavior": "fly",    "visual_description": "bat with fire"},
        {"name": "Magma Slug",        "behavior": "patrol", "visual_description": "molten slime"},
        {"name": "Frost Sloth",       "behavior": "charge", "visual_description": "ice beast"},
        {"name": "Spike Trap",        "behavior": "trap",   "visual_description": "rotating blade"},
    ]
    for e in test_enemies:
        cfg = map_enemy_to_kenney(e)
        anims = {k: len(v) for k, v in cfg["animations"].items()}
        print(f"  {e['name']:20s} -> {cfg['kenney_type']:14s}  anims: {anims}")
