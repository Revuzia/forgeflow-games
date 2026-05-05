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


def remap_music_from_per_game(output_dir: str) -> dict:
    """2026-05-05: post-music-generator remap. Override the music_*.ogg files
    in <game>/assets/audio/ with the per-game Stable Audio tracks from
    <game>/assets/music/*.mp3 (if they exist).

    music_generator writes design-driven tracks named `menu_theme.mp3`,
    `boss_theme.mp3`, `world_01.mp3`, etc. This function maps them to the
    audio_mapper slot names (music_menu, music_level, music_boss) that
    game.js loads.

    Called by phase_assets AFTER music_generator finishes — must be after
    so the per-game tracks exist on disk.
    """
    audio_dir = Path(output_dir) / "assets" / "audio"
    music_dir = Path(output_dir) / "assets" / "music"
    if not music_dir.exists():
        return {"remapped": 0, "reason": "no music/ dir"}

    SLOT_TO_STEMS = {
        "music_menu":  ["menu_theme", "menu", "title"],
        "music_level": ["world_01", "level_theme", "level", "main"],
        "music_boss":  ["boss_theme", "boss", "battle"],
    }
    remapped = 0
    for slot_name, stems in SLOT_TO_STEMS.items():
        src = None
        for stem in stems:
            for ext in (".mp3", ".ogg", ".wav"):
                candidate = music_dir / f"{stem}{ext}"
                if candidate.exists():
                    src = candidate
                    break
            if src:
                break
        if not src:
            continue
        # Wipe any prior Kenney fallback for this slot, then copy per-game
        for ext in (".ogg", ".mp3", ".wav"):
            stale = audio_dir / f"{slot_name}{ext}"
            if stale.exists():
                try:
                    stale.unlink()
                except Exception:
                    pass
        dst = audio_dir / f"{slot_name}{src.suffix}"
        shutil.copy2(src, dst)
        log(f"  [audio remap] {slot_name} <- {src.name} (per-game Stable Audio)")
        remapped += 1
    return {"remapped": remapped}


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

    # ── 2026-05-05 PER-GAME MUSIC RESOLUTION (priority order) ──
    # Previously: every game shipped with menu_theme.ogg / level_theme_1.ogg
    # / boss_theme.ogg from the shared Kenney pool. MD5-verified across 3
    # production games (barrel-blitz, wilds-of-aether, nebula-drift) — all
    # IDENTICAL music files. With 138 games that's a non-shippable failure.
    #
    # Architectural fix: phase_assets calls music_generator (Stable Audio)
    # per game. Output lands in <game>/assets/music/*.mp3 with prompt-driven
    # names (menu_theme, boss_theme, world_NN). audio_mapper used to ignore
    # those entirely and write Kenney fallback to <game>/assets/audio/.
    # Now the priority is:
    #   1. <game>/assets/music/menu_theme.{mp3,ogg}    (per-game generated)
    #   2. <game>/assets/music/world_01.{mp3,ogg}      (per-game level)
    #   3. <game>/assets/music/boss_theme.{mp3,ogg}    (per-game boss)
    #   4. Shared Kenney pool, seed-picked by game slug for variation
    per_game_music_dir = audio_dir.parent / "music"

    def _per_game_track(slot_name):
        """Return the per-game generated track for this slot, if any."""
        if not per_game_music_dir.exists():
            return None
        slot_to_stems = {
            "music_menu":  ["menu_theme", "menu", "title"],
            "music_level": ["world_01", "level_theme", "level", "main"],
            "music_boss":  ["boss_theme", "boss", "battle"],
        }
        for stem in slot_to_stems.get(slot_name, []):
            for ext in (".mp3", ".ogg", ".wav"):
                p = per_game_music_dir / f"{stem}{ext}"
                if p.exists():
                    return p
        return None

    music_dir = ASSETS_DIR / "music"
    # Each slot has keyword filters used to expand the pool from whatever's
    # actually in /music/ (we have menu_theme, level_theme_1/2/3, boss_theme,
    # game_over, victory; expanding logic also tolerates future additions).
    MUSIC_SLOTS = {
        "music_menu":  {"primary": ["menu_theme", "calm"],   "fallback_keywords": ["menu", "title", "intro", "ambient"]},
        "music_level": {"primary": ["level_theme", "adventure", "upbeat"], "fallback_keywords": ["level", "play", "action", "loop", "main"]},
        "music_boss":  {"primary": ["boss_theme", "battle", "intense"],   "fallback_keywords": ["boss", "battle", "fight", "intense", "epic"]},
    }

    def _music_pool_for_slot(slot_cfg):
        """Build pool: curated names first, then keyword-matched siblings."""
        pool = []
        if not music_dir.exists():
            return pool
        seen = set()
        # All available music files
        all_oggs = sorted(music_dir.glob("*.ogg")) + sorted(music_dir.glob("*.mp3"))
        # Primary: any file matching a curated stem
        for stem in slot_cfg["primary"]:
            for f in all_oggs:
                if stem.lower() in f.stem.lower() and f not in seen:
                    pool.append(f); seen.add(f)
        # Fallback: keyword-matched
        for kw in slot_cfg["fallback_keywords"]:
            for f in all_oggs:
                if kw.lower() in f.stem.lower() and f not in seen:
                    pool.append(f); seen.add(f)
        # Last resort: ALL music files (deterministic ordering)
        for f in all_oggs:
            if f not in seen:
                pool.append(f); seen.add(f)
        return pool

    for music_idx, (music_name, slot_cfg) in enumerate(MUSIC_SLOTS.items()):
        dst = audio_dir / f"{music_name}.ogg"
        found = False

        # PRIORITY 1: per-game generated music (Stable Audio, design-driven)
        per_game_src = _per_game_track(music_name)
        if per_game_src and per_game_src.exists():
            dst = audio_dir / f"{music_name}{per_game_src.suffix}"
            shutil.copy2(per_game_src, dst)
            result[music_name] = str(dst)
            log(f"  [audio] {music_name} -> {per_game_src.name} (PER-GAME generated)")
            found = True
            continue

        # PRIORITY 2: shared Kenney pool — seed-picked per game slug so
        # each game gets a deterministic but DIFFERENT track when Stable
        # Audio fallback is in play.
        pool = _music_pool_for_slot(slot_cfg)
        if pool:
            slot_seed = base_seed + music_idx * 91
            src = pool[slot_seed % len(pool)]
            dst = audio_dir / f"{music_name}{src.suffix}"
            shutil.copy2(src, dst)
            result[music_name] = str(dst)
            log(f"  [audio] {music_name} -> {src.name} (seed-pick from {len(pool)} candidates)")
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
