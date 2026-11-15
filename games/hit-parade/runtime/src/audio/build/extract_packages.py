#!/usr/bin/env python
"""HIT PARADE audio lane - extract the selected audio of the local Unity packages the audio build reads.

    python runtime/src/audio/build/extract_packages.py imphenzia   # Imphenzia / Universal Sound FX (selected folders)
    python runtime/src/audio/build/extract_packages.py tr2         # Travis Rise / SynthWave Music Pack 2 (all audio)
    python runtime/src/audio/build/extract_packages.py tr1         # Travis Rise / SynthWave Music Pack, tracks 03/04/07 only
    python runtime/src/audio/build/extract_packages.py all

Same approach as tools/research/unitypackage_extract_selected.py (stream the gzip tar once; `pathname` may come before or
after `asset`), but it keeps the package's own paths under the F:/games/unity-assets/<Publisher>__<Package>/ convention
so the build can name every source by its package path. Read-only on the packages; idempotent (a file already extracted
with the same size is skipped). Writes <dest>/_extracted.json (package path -> bytes). No network, no spend: the packages
already sit in F:/games/unity-asset-cache (orchestrator-authorised for this lane, 2026-09-29).
Travis Rise pack 1 tracks 01/02/05/06 are NOT extracted: they are registered to dyefield (state/music_assignments.json).
ASCII only.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
import tarfile
import time

CACHE = "F:/games/unity-asset-cache"
DEST = "F:/games/unity-assets"

IMPHENZIA_RX = (
    r"^Assets/Universal Sound FX/("
    r"CROWDS/(Hall|Generic|Medieval_Jousting_Tournament)/|AMBIENCES/Crowds/|SPORTS/(Boxing|Soccer)/|"
    r"IMPACTS/(Punch|Slap|Snappy|Generic|Bricks|Wood|Metal|Stone)/|THUDS_THUMPS/|"
    r"WHOOSHES/(Martial_Arts|Air|Classic|Mixed)/|"
    r"VOICES/(Fighting|Martial_Arts_Male|Grunts_Groans_Hurt|Exclamations|Laugh|Screams)/|"
    r"VOICES/Words_Phrases/(Male_A|Male_B|Female)/|"
    r"MONEY_CASH_CURRENCY/|GORE_SPLATS/|BREAKS_SNAPS/|FABRIC_CLOTHING/|CARTOON/|"
    r"MUSIC_EFFECTS/(?=[^/]+$)|MUSIC_EFFECTS/Solo_Orchestral_Brass/|NOTIFICATIONS/|"
    r"USER_INTERFACES/(Clicks_Taps|Errors|Notifications|Appear_Disappear|Toggles|Switches|Beeps)/|"
    r"ALARMS/Digital/|FIREWORKS/|HUMAN/(Body|Ringing_Ears|Heartbeat)/|ZAPS/|ELECTRICITY/|CARDS/|SHATTER/|GLASS/|"
    r"WEAPONS/Melee/|TOOLS/Whip/|EXPLOSIONS/(Arcade|Short|Quick)/|CHARGE_UPS_DOWNS/|TIME_WARPS/|"
    r"FOLEY/(CHURCH_BELL|DOOR_BELLS|COINS)/|ELEMENTS/Fire/|MAGIC_SPELLS/|PUZZLES/|MONSTERS_CREATURES/|"
    # P2 (2026-09-30): stage ambiences (rooftop rain/wind/thunder, butcher-block fridge, control-room hum, neon buzz),
    # prop foley (camera shutter for the TV cuts, clock ticks, the gourd swig, ball bounces, cleaver chops)
    r"WIND/|THUNDER/|ELEMENTS/Water/(Rain|Drops)/|AMBIENCES/(SciFi|City)/|"
    r"MACHINES/(Household_Appliances|Factory|Deep|Generic|Cartoon)/|HVAC/COOLING/|FOLEY/(CAMERA|CLOCKS)/|"
    r"HUMAN/Eating_Drinking/|SPORTS/Basketball/|TOOLS/Axe/"
    r").*\.(wav|ogg|mp3)$"
)

PACKS = {
    "imphenzia": {
        "pkg": CACHE + "/Imphenzia/AudioSound FX/Universal Sound FX.unitypackage",
        "dest": DEST + "/Imphenzia__Universal Sound FX",
        "rx": IMPHENZIA_RX,
    },
    "tr2": {
        "pkg": CACHE + "/Travis Rise/AudioMusicElectronic/SynthWave Music Pack 2.unitypackage",
        "dest": DEST + "/Travis Rise__SynthWave Music Pack 2",
        "rx": r"^Assets/Music/TR_SYNTHWAVE_2/.*\.(wav|ogg|mp3)$",
    },
    "tr1": {
        "pkg": CACHE + "/Travis Rise/AudioMusicElectronic/SynthWave Music Pack.unitypackage",
        "dest": DEST + "/Travis Rise__SynthWave Music Pack",
        "rx": r"^Assets/Music/TR_SYNTHWAVE/(03_DarknessBehind|04_ElectricPhase|07_RETROWAVE)/.*\.(wav|ogg|mp3)$",
    },
}


def extract(key: str) -> dict:
    spec = PACKS[key]
    rx = re.compile(spec["rx"], re.I)
    dest = spec["dest"]
    os.makedirs(dest, exist_ok=True)
    names: dict[str, str] = {}
    pending: dict[str, bytes] = {}
    done: dict[str, int] = {}
    skipped = 0
    t0 = time.time()

    def put(path: str, data: bytes) -> None:
        nonlocal skipped
        out = os.path.join(dest, path)
        if os.path.exists(out) and os.path.getsize(out) == len(data):
            skipped += 1
        else:
            os.makedirs(os.path.dirname(out), exist_ok=True)
            tmp = out + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, out)
        done[path] = len(data)

    with gzip.open(spec["pkg"], "rb") as gz, tarfile.open(fileobj=gz, mode="r|") as tf:
        for m in tf:
            parts = m.name.replace("\\", "/").lstrip("./").split("/")
            if len(parts) != 2:
                continue
            guid, leaf = parts
            if leaf == "pathname":
                f = tf.extractfile(m)
                p = f.read().decode("utf-8", "replace").splitlines()[0].strip() if f else ""
                names[guid] = p
                data = pending.pop(guid, None)
                if data is not None and rx.search(p):
                    put(p, data)
            elif leaf == "asset" and m.isfile():
                p = names.get(guid)
                if p is not None:
                    if rx.search(p):
                        put(p, tf.extractfile(m).read())
                elif m.size < 64 * 1024 * 1024:
                    # pathname not seen yet: buffer the bytes until it shows up (only audio-sized assets)
                    pending[guid] = tf.extractfile(m).read()
    with open(os.path.join(dest, "_extracted.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump({"package": spec["pkg"], "regex": spec["rx"], "files": dict(sorted(done.items()))}, f, indent=1)
    total = sum(done.values())
    print(f"{key}: {len(done)} files, {total / 1e6:.1f} MB -> {dest} ({skipped} already present) in {time.time() - t0:.0f} s", flush=True)
    return done


def main() -> int:
    keys = sys.argv[1:] or ["all"]
    if keys == ["all"]:
        keys = list(PACKS)
    for k in keys:
        if k not in PACKS:
            print(f"unknown package key {k!r}; one of {list(PACKS)} or all")
            return 2
        extract(k)
    return 0


if __name__ == "__main__":
    sys.exit(main())
