#!/usr/bin/env python3
"""Stage the game's audio from the F: drive, transcoding to web-sane sizes.

Paths were verified by the audio sweep. Two needs have ZERO coverage anywhere on
F: and are therefore SYNTHESISED at runtime instead, not sourced:
  * Roman brass (cornu/buccina) — no ancient instruments in any library
  * the crowd — and procedural is the better answer anyway, because the crowd
    has to REACT to the fight rather than play back a fixed recording

Music is drawn only from albums verified unused by any other ForgeFlow title,
per the no-duplicate-music rule.

Transcode targets: music -> 96 kbps mono-ish mp3 (it is background), SFX -> ogg
at 22 kHz. The Daniel Gooding vocals are 96 kHz/24-bit WAV and are the payload
outlier — 40 files raw is ~9.8 MB, which is why they are downsampled hard.

usage: python games/colosseum/tools/stage_audio.py [--dry-run]
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "assets" / "audio"
FFMPEG = shutil.which("ffmpeg")

M = Path(r"F:\Music")
EVIL = Path(r"F:\games\unity-assets\Evil Mind__Medieval Fantasy Audio Bundle Music Ambience Effects\Assets\Medieval Fantasy Audio Bundle")
HALLO = Path(r"F:\games\unity-assets\Evil Mind__Halloween Audio Kit Music Ambience Effects\Assets\Halloween Audio Kit")
KEN = Path(r"F:\games\forgeflow-games-assets")
GOOD = Path(r"F:\games\unity-assets\Daniel Gooding__Action RPG Characters\Assets\Action RPG Characters\Vocal Files")

# --- music: moment -> source ------------------------------------------------
MUSIC = {
    "menu":     M / "Greycrown Gauntlet" / "Onslaught Rally" / "Sovereign Onset.mp3",
    "ludus":    M / "Sunspear Bulwark" / "Titan Crusade" / "Warden Dawn.mp3",
    "prematch": M / "Greycrown Gauntlet" / "Onslaught Rally" / "Vanguard Fanfare.mp3",
    "combat":   M / "Northwind Onset" / "Warden Onslaught" / "Ironhold Rally.mp3",
    "combat2":  M / "Greycrown Gauntlet" / "Onslaught Rally" / "Storm Anthem.mp3",
    "boss":     M / "Greycrown Gauntlet" / "Onslaught Rally" / "Titan Vow.mp3",
    "victory":  M / "Greycrown Gauntlet" / "Onslaught Rally" / "Gilded Triumph.mp3",
    "defeat":   M / "Greycrown Gauntlet" / "Onslaught Rally" / "Rampart Requiem.mp3",
}

# --- sfx: name -> list of candidate sources (first that exists wins) ---------
SFX = {
    "sword_swing_1": [EVIL / "FX" / "Sword 1.mp3"],
    "sword_swing_2": [EVIL / "FX" / "Sword 2.mp3"],
    "sword_swing_3": [EVIL / "FX" / "Sword 3.mp3"],
    "sword_hit_1":   [EVIL / "FX" / "Sword 4.mp3"],
    "sword_hit_2":   [EVIL / "FX" / "Sword 5.mp3"],
    "sword_hit_3":   [EVIL / "FX" / "Sword 6.mp3"],
    "block_1":       [KEN / "impact-sounds" / "Audio" / "impactPlate_heavy_000.ogg"],
    "block_2":       [KEN / "impact-sounds" / "Audio" / "impactPlate_heavy_001.ogg"],
    "block_3":       [KEN / "impact-sounds" / "Audio" / "impactPlate_medium_000.ogg"],
    "shield_break":  [KEN / "impact-sounds" / "Audio" / "impactWood_heavy_004.ogg"],
    "step_sand_1":   [EVIL / "Update 1.3" / "Steps" / "Step (sand) 1.mp3"],
    "step_sand_2":   [EVIL / "Update 1.3" / "Steps" / "Step (sand) 2.mp3"],
    "step_sand_3":   [EVIL / "Update 1.3" / "Steps" / "Step (sand) 3.mp3"],
    "step_sand_4":   [EVIL / "Update 1.3" / "Steps" / "Step (sand) 4.mp3"],
    "beast_roar_1":  [EVIL / "FX" / "Beast Roar.mp3", EVIL / "FX" / "Roar (Beast) 1.mp3"],
    "beast_roar_2":  [EVIL / "FX" / "Roar (Beast) 2.mp3", EVIL / "FX" / "Beast Fury Roar.mp3"],
    "gate_iron":     [HALLO / "FX" / "Iron Gate.mp3"],
    "stone_grind":   [HALLO / "FX" / "Grave Slab.mp3"],
    "gate_wood":     [HALLO / "FX" / "Door (Open - Huge).mp3"],
    "ui_click":      [KEN / "interface-sounds" / "Audio" / "click_001.ogg"],
    "ui_confirm":    [KEN / "interface-sounds" / "Audio" / "confirmation_001.ogg"],
    "ui_back":       [KEN / "interface-sounds" / "Audio" / "close_001.ogg"],
    "coin":          [KEN / "rpg-audio" / "Audio" / "handleCoins.ogg", KEN / "interface-sounds" / "Audio" / "coin_01.ogg"],
    "equip":         [KEN / "rpg-audio" / "Audio" / "metalClick.ogg"],
}

# Male combat vocals — two actors for variety without bloating the payload.
VOCALS = {
    "effort": [GOOD / "Edwyn" / "AA_GenericBattleSounds", GOOD / "Nile" / "AA_GenericBattleSounds"],
    "hurt":   [GOOD / "Edwyn", GOOD / "Nile"],
    "death":  [GOOD / "Edwyn", GOOD / "Nile"],
}


def find_vocals(kind, limit=4):
    """Vocal packs vary in folder layout; search by filename token."""
    token = {"effort": "attack", "hurt": "hurt", "death": "death"}[kind]
    hits = []
    for root in VOCALS[kind]:
        base = root if root.exists() else root.parent
        if not base.exists():
            continue
        for p in base.rglob("*.wav"):
            if token in p.name.lower():
                hits.append(p)
                if len(hits) >= limit:
                    return hits
    return hits


def transcode(src: Path, dst: Path, kind: str, dry=False):
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dry:
        return True, "dry"
    if not FFMPEG:
        shutil.copy(src, dst.with_suffix(src.suffix))
        return True, "copied (no ffmpeg)"
    if kind == "music":
        args = ["-vn", "-ac", "2", "-ar", "44100", "-b:a", "96k"]
    else:
        args = ["-vn", "-ac", "1", "-ar", "22050", "-q:a", "4"]
    r = subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(src), *args, str(dst)],
                       capture_output=True, text=True, timeout=180)
    if r.returncode != 0 or not dst.exists():
        return False, (r.stderr or "").strip()[:140]
    return True, "ok"


def main():
    dry = "--dry-run" in sys.argv
    print(f"ffmpeg: {'yes' if FFMPEG else 'NO — will copy raw'}")
    total = 0
    missing = []

    print("\n-- music --")
    for name, src in MUSIC.items():
        dst = OUT / "music" / f"{name}.mp3"
        if dst.exists():
            print(f"  [skip] {name}")
            total += dst.stat().st_size
            continue
        if not src.exists():
            print(f"  [MISS] {name}: {src}")
            missing.append(str(src))
            continue
        ok, note = transcode(src, dst, "music", dry)
        sz = dst.stat().st_size if dst.exists() else 0
        total += sz
        print(f"  [{'ok' if ok else 'FAIL'}] {name:10} {sz // 1024:5} KB  {note if not ok else ''}")

    print("\n-- sfx --")
    for name, cands in SFX.items():
        dst = OUT / "sfx" / f"{name}.ogg"
        if dst.exists():
            total += dst.stat().st_size
            continue
        src = next((c for c in cands if c.exists()), None)
        if not src:
            print(f"  [MISS] {name}")
            missing.append(name)
            continue
        ok, note = transcode(src, dst, "sfx", dry)
        sz = dst.stat().st_size if dst.exists() else 0
        total += sz
        print(f"  [{'ok' if ok else 'FAIL'}] {name:16} {sz // 1024:4} KB {note if not ok else ''}")

    print("\n-- vocals --")
    for kind in VOCALS:
        hits = find_vocals(kind, 4)
        if not hits:
            print(f"  [MISS] {kind} — no matching wav found")
            missing.append(f"vocal:{kind}")
            continue
        for i, src in enumerate(hits, 1):
            dst = OUT / "sfx" / f"vo_{kind}_{i}.ogg"
            if dst.exists():
                total += dst.stat().st_size
                continue
            ok, note = transcode(src, dst, "sfx", dry)
            sz = dst.stat().st_size if dst.exists() else 0
            total += sz
            print(f"  [{'ok' if ok else 'FAIL'}] vo_{kind}_{i:<2} {sz // 1024:4} KB")

    print(f"\ntotal staged: {total / 1048576:.2f} MB -> {OUT}")
    if missing:
        print(f"missing ({len(missing)}):")
        for m in missing[:12]:
            print(f"  {m}")
    print("\nNOT sourced (synthesised at runtime instead — nothing on F: covers them):")
    print("  Roman brass (cornu/buccina)  -> core/cornu.js")
    print("  the crowd                    -> core/crowd_audio.js")
    return 0


if __name__ == "__main__":
    sys.exit(main())
