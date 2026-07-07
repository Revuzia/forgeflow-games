#!/usr/bin/env python3
"""Generate the original Bastion Realms: Stronghold soundtrack via Stable Audio."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "pipeline" / "art"))
from music_generator import generate_music

OUT = Path(__file__).resolve().parents[1] / "assets" / "audio" / "music"
OUT.mkdir(parents=True, exist_ok=True)

TRACKS = {
    "menu": ("Solemn medieval fantasy main menu theme, soft choir and harp over low strings, "
             "noble and calm, seamless loop, instrumental, 100 seconds", 100),
    "colosseum": ("Epic ancient roman colosseum battle music, driving war drums, bold brass fanfares, "
                  "marching strings, gladiator arena energy, seamless loop, instrumental", 110),
    "gothic": ("Dark gothic castle siege music, pipe organ, ominous low choir, tense staccato strings, "
               "rain-soaked night battle mood, seamless loop, instrumental", 110),
    "sky": ("Soaring sky fortress adventure music, airy flutes and light strings, uplifting brass swells, "
            "wind-swept wonder above the clouds, seamless loop, instrumental", 110),
    "crystal": ("Enchanted crystal cavern music, glassy bell chimes, ethereal celesta and shimmering pads, "
                "mysterious magical sparkle, seamless loop, instrumental", 110),
    "dwarven": ("Dwarven forge hold battle music, heavy anvil percussion, deep male-choir-like low brass, "
                "stomping rhythmic power, mountain hall echo, seamless loop, instrumental", 110),
    "victory": ("Short triumphant medieval victory fanfare, bright brass and timpani flourish resolving "
                "warmly, celebratory, instrumental", 45),
    "defeat": ("Short somber defeat theme, lone french horn and low strings, mournful but dignified, "
               "fading ending, instrumental", 45),
}

failed = []
for name, (prompt, dur) in TRACKS.items():
    out = OUT / f"{name}.mp3"
    if out.exists() and out.stat().st_size > 100_000:
        print(f"[skip] {name} already generated")
        continue
    print(f"[gen] {name} ({dur}s)…", flush=True)
    try:
        p = generate_music(prompt, out, duration_seconds=dur)
        ok = p and Path(p).exists() and Path(p).stat().st_size > 100_000
        print(f"  -> {'OK ' + str(Path(p).stat().st_size // 1024) + 'KB' if ok else 'FAILED/fallback'}")
        if not ok:
            failed.append(name)
    except Exception as e:
        print(f"  -> ERROR {e}")
        failed.append(name)

print("FAILED:", failed if failed else "none")
sys.exit(1 if failed else 0)
