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
import sys
from pathlib import Path

log = print  # simple logger alias

ROOT = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT / "assets"

# Hoist audio-fetch imports to module load (was dynamic per-call — Issue 15 / audit pass 2)
_AUDIO_PKG = Path(__file__).resolve().parent.parent / "audio"
if str(_AUDIO_PKG) not in sys.path:
    sys.path.insert(0, str(_AUDIO_PKG))
try:
    from jamendo_fetch import fetch_music as _jamendo_fetch_music  # noqa: E402
except Exception as _e:
    _jamendo_fetch_music = None
    log(f"[audio_mapper] jamendo_fetch unavailable at module load: {_e}")
try:
    from audio_cache import build_credits_for_game as _build_credits_for_game  # noqa: E402
except Exception:
    _build_credits_for_game = None

# Audio pack locations
INTERFACE_SOUNDS = ASSETS_DIR / "interface-sounds"
RPG_AUDIO = ASSETS_DIR / "rpg-audio"
IMPACT_SOUNDS = ASSETS_DIR / "impact-sounds"

# Mapping: game event -> best matching Kenney audio file
# These are curated selections from the downloaded packs
# ══════════════════════════════════════════════════════════════════════════════
# SFX TAXONOMY — expanded 2026-04-17 from 9 to 24 platformer SFX + 15 ARPG SFX.
# Real games need SFX for every interactive event. 282 Kenney audio files
# available across interface/rpg/impact packs. This map uses them comprehensively.
# ══════════════════════════════════════════════════════════════════════════════
AUDIO_MAP = {
    "platformer": {
        # ── Movement ──
        "sfx_jump":          {"pack": "interface-sounds", "files": ["Audio/click_002.ogg", "Audio/pluck_001.ogg"], "fallback_search": "click"},
        "sfx_double_jump":   {"pack": "interface-sounds", "files": ["Audio/pluck_002.ogg"], "fallback_search": "pluck"},
        "sfx_land":          {"pack": "impact-sounds",    "files": ["Audio/impactSoft_heavy_000.ogg", "Audio/footstep_carpet_000.ogg"], "fallback_search": "soft"},
        "sfx_dash":          {"pack": "impact-sounds",    "files": ["Audio/impactWood_medium_000.ogg"], "fallback_search": "wood"},
        "sfx_wall_slide":    {"pack": "impact-sounds",    "files": ["Audio/footstep_concrete_000.ogg"], "fallback_search": "concrete"},
        "sfx_ground_pound":  {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_000.ogg"], "fallback_search": "impactMetal"},
        # ── Player damage ──
        "sfx_hurt":          {"pack": "impact-sounds",    "files": ["Audio/impactPunch_medium_000.ogg"], "fallback_search": "punch"},
        "sfx_death":         {"pack": "interface-sounds", "files": ["Audio/error_004.ogg", "Audio/error_006.ogg"], "fallback_search": "error"},
        # ── Collect / reward ──
        "sfx_coin":          {"pack": "interface-sounds", "files": ["Audio/maximize_003.ogg", "Audio/confirmation_001.ogg"], "fallback_search": "maximize"},
        "sfx_gem":           {"pack": "interface-sounds", "files": ["Audio/confirmation_004.ogg"], "fallback_search": "confirmation"},
        "sfx_power_up":      {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
        "sfx_checkpoint":    {"pack": "interface-sounds", "files": ["Audio/confirmation_002.ogg"], "fallback_search": "confirm"},
        # ── Combat ──
        "sfx_hit":           {"pack": "impact-sounds",    "files": ["Audio/impactMining_002.ogg"], "fallback_search": "impact"},
        "sfx_enemy_die":     {"pack": "impact-sounds",    "files": ["Audio/impactBell_heavy_001.ogg"], "fallback_search": "bell"},
        "sfx_projectile":    {"pack": "interface-sounds", "files": ["Audio/click_004.ogg"], "fallback_search": "click"},
        "sfx_explosion":     {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_002.ogg"], "fallback_search": "heavy"},
        # ── Boss ──
        "sfx_boss_hit":      {"pack": "impact-sounds",    "files": ["Audio/impactPlate_heavy_000.ogg"], "fallback_search": "impactPlate"},
        "sfx_boss_phase":    {"pack": "interface-sounds", "files": ["Audio/question_001.ogg"], "fallback_search": "question"},
        "sfx_boss_die":      {"pack": "impact-sounds",    "files": ["Audio/impactBell_heavy_003.ogg"], "fallback_search": "impactBell"},
        "sfx_boss_telegraph":{"pack": "interface-sounds", "files": ["Audio/drop_003.ogg"], "fallback_search": "drop"},
        # ── UI ──
        "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
        "sfx_menu_confirm":  {"pack": "interface-sounds", "files": ["Audio/confirmation_003.ogg"], "fallback_search": "confirmation"},
        "sfx_menu_cancel":   {"pack": "interface-sounds", "files": ["Audio/back_001.ogg"], "fallback_search": "back"},
        "sfx_pause":         {"pack": "interface-sounds", "files": ["Audio/minimize_002.ogg"], "fallback_search": "minimize"},
        # ── Game flow ──
        "sfx_game_over":     {"pack": "interface-sounds", "files": ["Audio/error_006.ogg"], "fallback_search": "error"},
        "sfx_level_complete":{"pack": "interface-sounds", "files": ["Audio/maximize_009.ogg"], "fallback_search": "maximize"},
        "sfx_level_start":   {"pack": "interface-sounds", "files": ["Audio/confirmation_005.ogg"], "fallback_search": "confirmation"},
        # 2026-04-23: DKC-authenticity SFX (enemy stomp, crumble tile, KONG letter,
        # 1UP, bonus barrel, world complete fanfare, boss roar/charge).
        "sfx_stomp":         {"pack": "impact-sounds",    "files": ["Audio/impactSoft_medium_000.ogg"], "fallback_search": "impactSoft"},
        "sfx_crumble":       {"pack": "impact-sounds",    "files": ["Audio/impactWood_medium_002.ogg"], "fallback_search": "impactWood"},
        "sfx_coin_letter":   {"pack": "interface-sounds", "files": ["Audio/confirmation_001.ogg"], "fallback_search": "confirmation"},
        "sfx_1up":           {"pack": "interface-sounds", "files": ["Audio/confirmation_004.ogg"], "fallback_search": "confirm"},
        "sfx_bonus":         {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
        "sfx_world_complete":{"pack": "interface-sounds", "files": ["Audio/maximize_009.ogg"], "fallback_search": "maximize"},
        "sfx_boss_roar":     {"pack": "impact-sounds",    "files": ["Audio/impactBell_heavy_002.ogg"], "fallback_search": "impactBell"},
        "sfx_boss_charge":   {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_003.ogg"], "fallback_search": "impactMetal"},
        "sfx_vine_grab":     {"pack": "impact-sounds",    "files": ["Audio/impactSoft_light_000.ogg"], "fallback_search": "impactSoft"},
        "sfx_barrel_roll":   {"pack": "impact-sounds",    "files": ["Audio/impactWood_heavy_001.ogg"], "fallback_search": "impactWood"},
    },
    "topdown": {
        # ── Movement ──
        "sfx_footstep":      {"pack": "impact-sounds",    "files": ["Audio/footstep_concrete_000.ogg"], "fallback_search": "footstep"},
        "sfx_door":          {"pack": "rpg-audio",        "files": ["Audio/doorOpen_1.ogg"], "fallback_search": "door"},
        # ── Combat ──
        "sfx_attack":        {"pack": "rpg-audio",        "files": ["Audio/knifeSlice.ogg", "Audio/clothBelt.ogg"], "fallback_search": "slice"},
        "sfx_attack_heavy":  {"pack": "rpg-audio",        "files": ["Audio/metalLatch.ogg"], "fallback_search": "metal"},
        "sfx_hit":           {"pack": "impact-sounds",    "files": ["Audio/impactPunch_medium_000.ogg"], "fallback_search": "punch"},
        "sfx_shoot":         {"pack": "rpg-audio",        "files": ["Audio/bowDraw.ogg"], "fallback_search": "bow"},
        "sfx_enemy_die":     {"pack": "impact-sounds",    "files": ["Audio/impactBell_heavy_001.ogg"], "fallback_search": "bell"},
        # ── Damage + status ──
        "sfx_hurt":          {"pack": "impact-sounds",    "files": ["Audio/impactPunch_heavy_000.ogg"], "fallback_search": "punch"},
        "sfx_death":         {"pack": "interface-sounds", "files": ["Audio/error_004.ogg"], "fallback_search": "error"},
        "sfx_heal":          {"pack": "rpg-audio",        "files": ["Audio/handleCoins.ogg"], "fallback_search": "coin"},
        # ── Loot ──
        "sfx_pickup":        {"pack": "rpg-audio",        "files": ["Audio/metalClick.ogg"], "fallback_search": "metal"},
        "sfx_equip":         {"pack": "rpg-audio",        "files": ["Audio/metalLatch.ogg"], "fallback_search": "metalLatch"},
        "sfx_coin":          {"pack": "rpg-audio",        "files": ["Audio/handleCoins.ogg"], "fallback_search": "handleCoins"},
        "sfx_levelup":       {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
        # ── UI ──
        "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
        "sfx_menu_confirm":  {"pack": "interface-sounds", "files": ["Audio/confirmation_003.ogg"], "fallback_search": "confirmation"},
    },
}
# Alias: adventure/rpg/arpg share the topdown map (can be overridden later)
AUDIO_MAP["adventure"] = AUDIO_MAP["topdown"]
AUDIO_MAP["rpg"]       = AUDIO_MAP["topdown"]
AUDIO_MAP["arpg"]      = AUDIO_MAP["topdown"]
AUDIO_MAP["action"]    = AUDIO_MAP["topdown"]   # 2D action games map well to topdown SFX

# 2026-05-05: full genre audio coverage. Previously strategy/simulation/arcade
# /shmup/flight/obby/puzzle/boardgame all silently fell back to platformer SFX
# (jump sounds for a Civilization clone). Now each genre gets a curated SFX
# palette built from the 589-file Kenney + impact + interface + rpg pool.

# Twin-stick / arena arcade: rapid-fire SFX, screen-shake feedback
AUDIO_MAP["arcade"] = {
    "sfx_shoot":         {"pack": "interface-sounds", "files": ["Audio/click_004.ogg"], "fallback_search": "click"},
    "sfx_explode":       {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_002.ogg"], "fallback_search": "heavy"},
    "sfx_hit":           {"pack": "impact-sounds",    "files": ["Audio/impactMining_002.ogg"], "fallback_search": "impact"},
    "sfx_powerup":       {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
    "sfx_pickup":        {"pack": "interface-sounds", "files": ["Audio/confirmation_001.ogg"], "fallback_search": "confirmation"},
    "sfx_player_die":    {"pack": "interface-sounds", "files": ["Audio/error_004.ogg"], "fallback_search": "error"},
    "sfx_enemy_die":     {"pack": "impact-sounds",    "files": ["Audio/impactBell_heavy_001.ogg"], "fallback_search": "bell"},
    "sfx_wave_clear":    {"pack": "interface-sounds", "files": ["Audio/maximize_009.ogg"], "fallback_search": "maximize"},
    "sfx_multiplier":    {"pack": "interface-sounds", "files": ["Audio/pluck_001.ogg"], "fallback_search": "pluck"},
    "sfx_bomb":          {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_003.ogg"], "fallback_search": "impactMetal"},
    "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
    "sfx_game_over":     {"pack": "interface-sounds", "files": ["Audio/error_006.ogg"], "fallback_search": "error"},
}

# Shoot-em-up: classic SHMUP slot mapping
AUDIO_MAP["shmup"] = {
    "sfx_shoot":         {"pack": "interface-sounds", "files": ["Audio/click_004.ogg", "Audio/click_005.ogg"], "fallback_search": "click"},
    "sfx_shoot_heavy":   {"pack": "impact-sounds",    "files": ["Audio/impactMetal_medium_000.ogg"], "fallback_search": "impactMetal"},
    "sfx_explosion":     {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_002.ogg"], "fallback_search": "heavy"},
    "sfx_hit":           {"pack": "impact-sounds",    "files": ["Audio/impactPunch_medium_000.ogg"], "fallback_search": "punch"},
    "sfx_pickup":        {"pack": "interface-sounds", "files": ["Audio/confirmation_001.ogg"], "fallback_search": "confirmation"},
    "sfx_powerup":       {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
    "sfx_player_die":    {"pack": "interface-sounds", "files": ["Audio/error_004.ogg"], "fallback_search": "error"},
    "sfx_boss_appear":   {"pack": "interface-sounds", "files": ["Audio/question_001.ogg"], "fallback_search": "question"},
    "sfx_boss_die":      {"pack": "impact-sounds",    "files": ["Audio/impactBell_heavy_003.ogg"], "fallback_search": "impactBell"},
    "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
    "sfx_game_over":     {"pack": "interface-sounds", "files": ["Audio/error_006.ogg"], "fallback_search": "error"},
}

# Flight games — overlap with shmup but with engine + altitude SFX
AUDIO_MAP["flight"] = {
    "sfx_engine":        {"pack": "impact-sounds",    "files": ["Audio/footstep_concrete_000.ogg"], "fallback_search": "footstep"},
    "sfx_shoot":         {"pack": "interface-sounds", "files": ["Audio/click_004.ogg"], "fallback_search": "click"},
    "sfx_missile":       {"pack": "impact-sounds",    "files": ["Audio/impactMetal_medium_000.ogg"], "fallback_search": "impactMetal"},
    "sfx_explosion":     {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_002.ogg"], "fallback_search": "heavy"},
    "sfx_hit":           {"pack": "impact-sounds",    "files": ["Audio/impactPunch_medium_000.ogg"], "fallback_search": "punch"},
    "sfx_warning":       {"pack": "interface-sounds", "files": ["Audio/error_002.ogg"], "fallback_search": "error"},
    "sfx_landing":       {"pack": "impact-sounds",    "files": ["Audio/impactSoft_heavy_000.ogg"], "fallback_search": "soft"},
    "sfx_crash":         {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_003.ogg"], "fallback_search": "impactMetal"},
    "sfx_radar":         {"pack": "interface-sounds", "files": ["Audio/pluck_002.ogg"], "fallback_search": "pluck"},
    "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
}

# Obby — platformer-derived runner: jump-heavy, light combat, lots of restart
AUDIO_MAP["obby"] = {
    "sfx_jump":          {"pack": "interface-sounds", "files": ["Audio/click_002.ogg"], "fallback_search": "click"},
    "sfx_double_jump":   {"pack": "interface-sounds", "files": ["Audio/pluck_002.ogg"], "fallback_search": "pluck"},
    "sfx_land":          {"pack": "impact-sounds",    "files": ["Audio/impactSoft_heavy_000.ogg"], "fallback_search": "soft"},
    "sfx_death":         {"pack": "interface-sounds", "files": ["Audio/error_004.ogg"], "fallback_search": "error"},
    "sfx_checkpoint":    {"pack": "interface-sounds", "files": ["Audio/confirmation_002.ogg"], "fallback_search": "confirm"},
    "sfx_collect":       {"pack": "interface-sounds", "files": ["Audio/maximize_003.ogg"], "fallback_search": "maximize"},
    "sfx_finish":        {"pack": "interface-sounds", "files": ["Audio/maximize_009.ogg"], "fallback_search": "maximize"},
    "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
}

# Strategy — 4X / tactics: turn-end fanfare, unit move, capture, victory
AUDIO_MAP["strategy"] = {
    "sfx_unit_move":     {"pack": "impact-sounds",    "files": ["Audio/footstep_carpet_000.ogg"], "fallback_search": "footstep"},
    "sfx_unit_select":   {"pack": "interface-sounds", "files": ["Audio/click_003.ogg"], "fallback_search": "click"},
    "sfx_attack":        {"pack": "rpg-audio",        "files": ["Audio/knifeSlice.ogg"], "fallback_search": "slice"},
    "sfx_capture":       {"pack": "interface-sounds", "files": ["Audio/confirmation_004.ogg"], "fallback_search": "confirmation"},
    "sfx_build":         {"pack": "impact-sounds",    "files": ["Audio/impactWood_medium_000.ogg"], "fallback_search": "impactWood"},
    "sfx_research":      {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
    "sfx_endturn":       {"pack": "interface-sounds", "files": ["Audio/confirmation_003.ogg"], "fallback_search": "confirmation"},
    "sfx_victory":       {"pack": "interface-sounds", "files": ["Audio/maximize_009.ogg"], "fallback_search": "maximize"},
    "sfx_defeat":        {"pack": "interface-sounds", "files": ["Audio/error_006.ogg"], "fallback_search": "error"},
    "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
    "sfx_menu_confirm":  {"pack": "interface-sounds", "files": ["Audio/confirmation_003.ogg"], "fallback_search": "confirmation"},
    "sfx_alert":         {"pack": "interface-sounds", "files": ["Audio/error_002.ogg"], "fallback_search": "error"},
}

# Simulation — SimCity / management: place building, money in/out, day tick
AUDIO_MAP["simulation"] = {
    "sfx_place":         {"pack": "impact-sounds",    "files": ["Audio/impactWood_medium_000.ogg"], "fallback_search": "impactWood"},
    "sfx_money_in":      {"pack": "rpg-audio",        "files": ["Audio/handleCoins.ogg"], "fallback_search": "coin"},
    "sfx_money_out":     {"pack": "interface-sounds", "files": ["Audio/drop_003.ogg"], "fallback_search": "drop"},
    "sfx_event":         {"pack": "interface-sounds", "files": ["Audio/question_001.ogg"], "fallback_search": "question"},
    "sfx_levelup":       {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
    "sfx_bankrupt":      {"pack": "interface-sounds", "files": ["Audio/error_006.ogg"], "fallback_search": "error"},
    "sfx_day_tick":      {"pack": "interface-sounds", "files": ["Audio/pluck_001.ogg"], "fallback_search": "pluck"},
    "sfx_demolish":      {"pack": "impact-sounds",    "files": ["Audio/impactWood_medium_002.ogg"], "fallback_search": "impactWood"},
    "sfx_disaster":      {"pack": "impact-sounds",    "files": ["Audio/impactMetal_heavy_002.ogg"], "fallback_search": "heavy"},
    "sfx_complete":      {"pack": "interface-sounds", "files": ["Audio/maximize_009.ogg"], "fallback_search": "maximize"},
    "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
}

# Puzzle / Boardgame — turn-based, click-heavy, satisfaction sounds
AUDIO_MAP["puzzle"] = {
    "sfx_click":         {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
    "sfx_place":         {"pack": "interface-sounds", "files": ["Audio/click_003.ogg"], "fallback_search": "click"},
    "sfx_match":         {"pack": "interface-sounds", "files": ["Audio/confirmation_004.ogg"], "fallback_search": "confirmation"},
    "sfx_invalid":       {"pack": "interface-sounds", "files": ["Audio/error_002.ogg"], "fallback_search": "error"},
    "sfx_complete":      {"pack": "interface-sounds", "files": ["Audio/maximize_009.ogg"], "fallback_search": "maximize"},
    "sfx_combo":         {"pack": "interface-sounds", "files": ["Audio/maximize_008.ogg"], "fallback_search": "maximize"},
    "sfx_undo":          {"pack": "interface-sounds", "files": ["Audio/back_001.ogg"], "fallback_search": "back"},
    "sfx_hint":          {"pack": "interface-sounds", "files": ["Audio/pluck_002.ogg"], "fallback_search": "pluck"},
    "sfx_menu_select":   {"pack": "interface-sounds", "files": ["Audio/click_001.ogg"], "fallback_search": "click"},
    "sfx_menu_confirm":  {"pack": "interface-sounds", "files": ["Audio/confirmation_003.ogg"], "fallback_search": "confirmation"},
}
AUDIO_MAP["boardgame"]  = AUDIO_MAP["puzzle"]
AUDIO_MAP["board_game"] = AUDIO_MAP["puzzle"]

# 3D variants reuse their 2D counterparts' SFX (audio doesn't differ by dimension)
AUDIO_MAP["3d-platformer"] = AUDIO_MAP["platformer"]
AUDIO_MAP["3d-arpg"]       = AUDIO_MAP["topdown"]


def _build_candidate_pool(pack_name: str, file_paths: list, fallback_search: str = None) -> list:
    """Collect ALL audio files in the pack matching either the curated list or
    the keyword search. 2026-04-23: per-game SFX diversity — we now return the
    full pool so callers can seed-pick, instead of always returning files[0].
    """
    pack_dir = ASSETS_DIR / pack_name
    # Also check the _downloaded mirror (newer packs live there)
    alt_pack_dir = ASSETS_DIR / "_downloaded" / pack_name
    search_dirs = [d for d in (pack_dir, alt_pack_dir) if d.exists()]
    pool: list = []
    # Curated exact paths first
    for base in search_dirs:
        for fp in file_paths:
            full_path = base / fp
            if full_path.exists() and full_path not in pool:
                pool.append(full_path)
    # Keyword-matched siblings (drastically expands pool)
    if fallback_search:
        kw = fallback_search.lower()
        for base in search_dirs:
            for f in sorted(list(base.rglob("*.ogg")) + list(base.rglob("*.wav")) + list(base.rglob("*.mp3"))):
                if kw in f.name.lower() and f not in pool:
                    pool.append(f)
    return pool


def find_audio_file(pack_name: str, file_paths: list, fallback_search: str = None,
                     seed: int = 0) -> Path | None:
    """Pick one audio file from the candidate pool using a deterministic seed
    (same game always picks the same sound; different games get different
    sounds across the ~350-file SFX catalog).
    """
    pool = _build_candidate_pool(pack_name, file_paths, fallback_search)
    if pool:
        return pool[seed % len(pool)]

    # Last resort: any audio file from the pack (keeps the old failsafe)
    pack_dir = ASSETS_DIR / pack_name
    if pack_dir.exists():
        ogg_files = sorted(pack_dir.rglob("*.ogg"))
        if ogg_files:
            return ogg_files[seed % len(ogg_files)]
    return None


def copy_audio_for_game(genre: str, output_dir: str) -> dict:
    """
    Copy appropriate audio files to a game's assets/audio/ folder.

    2026-04-23: SFX selection is now seeded by the game's folder name so each
    game gets a DISTINCT but deterministic sound palette pulled from the full
    ~350-file Kenney catalog. Same game run twice = identical picks; two
    different games = different picks per slot. Prior behavior always picked
    file[0] for every slot on every game.

    Args:
        genre: Game genre (platformer, topdown, etc.)
        output_dir: Game's root directory (will create assets/audio/ inside)

    Returns:
        Dict mapping sound names to copied file paths
    """
    audio_dir = Path(output_dir) / "assets" / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    # Deterministic per-game seed from the folder name
    game_slug = Path(output_dir).name
    base_seed = abs(hash(game_slug))

    genre_map = AUDIO_MAP.get(genre, AUDIO_MAP.get("platformer"))
    result = {}

    for idx, (sound_name, config) in enumerate(genre_map.items()):
        # Each slot gets its own seed offset so different SFX vary independently
        slot_seed = base_seed + idx * 17
        src = find_audio_file(config["pack"], config["files"], config.get("fallback_search"),
                               seed=slot_seed)
        if src:
            dst = audio_dir / f"{sound_name}.ogg"
            shutil.copy2(src, dst)
            result[sound_name] = str(dst)
            log(f"  [audio] {sound_name} -> {src.name}")
        else:
            log(f"  [audio] WARNING: No file found for {sound_name}")

    # Music: check if CC0 music pack has been downloaded
    music_dir = ASSETS_DIR / "music"
    MUSIC_MAP = {
        "music_menu": ["menu_theme.ogg", "calm_theme.ogg"],
        "music_level": ["level_theme_1.ogg", "adventure_theme.ogg", "upbeat_theme.ogg"],
        "music_boss": ["boss_theme.ogg", "battle_theme.ogg", "intense_theme.ogg"],
    }

    for music_name, candidates in MUSIC_MAP.items():
        dst = audio_dir / f"{music_name}.ogg"
        found = False
        if music_dir.exists():
            for candidate in candidates:
                src = music_dir / candidate
                if src.exists():
                    shutil.copy2(src, dst)
                    result[music_name] = str(dst)
                    log(f"  [audio] {music_name} -> {candidate}")
                    found = True
                    break
            if not found:
                # Try any .ogg in music dir
                oggs = sorted(music_dir.glob("*.ogg"))
                if oggs:
                    src = oggs[hash(music_name) % len(oggs)]
                    shutil.copy2(src, dst)
                    result[music_name] = str(dst)
                    log(f"  [audio] {music_name} -> {src.name} (fallback)")
                    found = True
        if not found and _jamendo_fetch_music is not None:
            # 2026-04-17: Instead of just warning, fetch from Jamendo live
            try:
                mood = {
                    "music_menu":  "calm ambient menu",
                    "music_level": f"upbeat {genre} action",
                    "music_boss":  "intense epic battle",
                }.get(music_name, "instrumental background")
                paths = _jamendo_fetch_music(mood, audio_dir, count=1, min_duration=60, max_duration=240)
                if paths:
                    # Rename to expected music_name.mp3 (Jamendo returns mp3)
                    src = paths[0]
                    final_dst = audio_dir / f"{music_name}.mp3"
                    if src != final_dst:
                        src.rename(final_dst)
                    result[music_name] = str(final_dst)
                    log(f"  [audio] {music_name} -> {final_dst.name} (Jamendo, CC-BY)")
                    found = True
            except Exception as _e:
                log(f"  [audio] Jamendo fetch failed for {music_name}: {_e}")
            if not found:
                log(f"  [audio] NOTE: No music for {music_name} (Jamendo unavailable)")

    # Generate CREDITS.md for any CC-BY tracks used
    if _build_credits_for_game is not None:
        try:
            audio_files_used = [Path(p).name for p in result.values()]
            _build_credits_for_game(Path(output_dir), audio_files_used)
        except Exception:
            pass  # Credits are optional for CC0-only games

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
