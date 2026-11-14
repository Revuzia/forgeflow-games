#!/usr/bin/env python
"""CRESTBOUND — recorded music build (stage 1, music lane).

    python assets/music/_build/build_music.py              # encode + write manifest.js + CREDITS.json
    python assets/music/_build/build_music.py --register   # ... and register the tracks in state/music_assignments.json

Sources are OWNED Unity Asset Store packs, already unpacked by forgeflow-engine/tools/unity_cache_ingest.py into
F:/games/unity-assets/<Publisher>__<Pack>/ (the .unitypackage files live in F:/games/unity-asset-cache/). Nothing is
generated or bought. Every track used here is registered for the slug `crestbound` in
C:/Users/TestRun/Claude Claw/state/music_assignments.json, whose `used` map guarantees no track is shared by two games.

Outputs (all in assets/music/):
  * <cue>.ogg      stereo 44.1 kHz Ogg Vorbis <= 128 kb/s (libvorbis q 3, stepped down if it measures above 126 kb/s)
  * <cue>.m4a      the AAC-LC twin (WebKit before 18.4 cannot decode Ogg; DYEFIELD does the same). The source is padded so
                   that a decoder that IGNORES the MP4 edit list returns exactly AAC_DELAY priming samples + the padded
                   source, and one that honours it returns the padded source; the runtime tells them apart by length.
  * manifest.js    data-only ES module the runtime imports (URLs, loop region, loudness)
  * CREDITS.json   every track, pack, author, source, licence

Looping cues are the pack's own LOOP files. Each is written with a GUARD of wrap-around audio on both sides
([last G s] + loop + [first G s]) and played with AudioBufferSourceNode.loopStart/loopEnd = [G, G + loop], so the
browser's resampler (44.1 kHz file -> 48 kHz context) sees real signal across the loop seam instead of silence.

Deterministic: no wall-clock input. Needs ffmpeg/ffprobe on PATH and numpy.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)                                   # assets/music
REGISTRY = "C:/Users/TestRun/Claude Claw/state/music_assignments.json"
SLUG = "crestbound"

SR = 44100
GUARD_S = 0.06
GUARD = int(round(GUARD_S * SR))
AAC_DELAY = 1024                                              # ffmpeg native AAC priming (checked on every build)
AAC_KBPS = 128
MUSIC_Q = 3.0

HP_DIR = ("F:/games/unity-assets/Florian Stracker__The Heros Path Free 16bit Adventure Game Music/Assets/TheHerosPath/"
          "The Hero's Path (Free 16bit Video Game Music)/WAV")
HP_PACK = {"author": "Florian Stracker", "pack": "The Hero's Path (Free 16bit Adventure Game Music)",
           "registry_pack": "The Heros Path Free 16bit Adventure Game Music",
           "source": "Unity Asset Store (F:/games/unity-asset-cache/Florian Stracker/AudioMusic/"
                     "The Heros Path Free 16bit Adventure Game Music.unitypackage)",
           "license": "Unity Asset Store End User License Agreement (Standard Unity Asset Store EULA)"}
CK_DIR = ("F:/games/unity-assets/Chris Kohler__8-Bit RPG Adventure Music Pack/Assets/8-Bit RPG Adventure Music Pack v1.1/"
          "Tracks WAV/Jingles+SFX")
CK_PACK = {"author": "Chris Kohler", "pack": "8-Bit RPG Adventure Music Pack",
           "registry_pack": "8-Bit RPG Adventure Music Pack",
           "source": "Unity Asset Store (F:/games/unity-asset-cache/Chris Kohler/AudioMusicElectronic8bit/"
                     "8-Bit RPG Adventure Music Pack.unitypackage)",
           "license": "Unity Asset Store End User License Agreement (Standard Unity Asset Store EULA)"}

# cue -> (pack, source file, registry track name, display title, loops?, mood note)
CUES = [
    ("keep",    HP_PACK, "07_LOOP_The_Maple_Sprout_by_Florian_Stracker.wav", "07_The_Maple_Sprout", "The Maple Sprout", True,
     "hub: D major, no drums, no bass, warm plucked line"),
    ("verdant", HP_PACK, "02.2_LOOP_Valley_Grounds_by_Florian_Stracker.wav", "02_Valley_Grounds", "Valley Grounds", True,
     "bright and bouncy: G major, busiest pulse, bass + drums"),
    ("ember",   HP_PACK, "08.2_LOOP_Besiege_the_Castle_by_Florian_Stracker.wav", "08_Besiege_the_Castle", "Besiege the Castle", True,
     "driving and hot: A minor, marching block-chord stabs, heavy low end"),
    ("rime",    HP_PACK, "04.2_LOOP_Sleep_In_by_Florian_Stracker.wav", "04_Sleep_In", "Sleep In", True,
     "airy and cold: no drums, no bass, thin legato lines"),
    ("azure",   HP_PACK, "03.2_LOOP_Breaking_the_Chains_by_Florian_Stracker.wav", "03_Breaking_the_Chains", "Breaking the Chains", True,
     "flowing and bright: B-flat major, legato melody over a steady pulse"),
    ("boss",    HP_PACK, "06.2_LOOP_Battle_to_the_Blood_by_Florian_Stracker.wav", "06_Battle_to_the_Blood", "Battle to the Blood", True,
     "boss: G minor, 172 bpm, the densest cue"),
    ("fanfare", CK_PACK, "04_Jingle_ Key Item Obtained 1.wav", "Jingle_Key_Item_Obtained_1", "Key Item Obtained 1", False,
     "crest get: 3.7 s jingle resolving on a major third"),
    ("clear",   CK_PACK, "02_Jingle_ Level Clear 2.wav", "Jingle_Level_Clear_2", "Level Clear 2", False,
     "course clear: 4.2 s jingle resolving on C major"),
]


def registry_key(pack, track):
    return "%s/%s/%s" % (pack["author"], pack["registry_pack"], track)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        raise SystemExit("command failed: %s\n%s" % (" ".join(cmd[:6]), r.stderr.decode("utf-8", "replace")[-800:]))
    return r


def decode_f32(path, extra=None):
    """-> (frames, 2) float32 at SR"""
    cmd = ["ffmpeg", "-v", "error"] + (extra or []) + ["-i", path, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    x = np.frombuffer(run(cmd).stdout, dtype=np.float32)
    return x.reshape(-1, 2)


def write_f32(path, x):
    x.astype(np.float32).tofile(path)


def encode_vorbis(raw, n_ch, ogg, q):
    run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(n_ch), "-i", raw,
         "-c:a", "libvorbis", "-q:a", "%.2f" % q, "-map_metadata", "-1", "-fflags", "+bitexact", ogg])
    return os.path.getsize(ogg) * 8 / 1000.0


def ebur128(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True)
    t = r.stderr.decode("utf-8", "replace")
    tail = t[t.rfind("Summary:"):]
    lufs = float(re.search(r"I:\s+(-?[\d.]+) LUFS", tail).group(1))
    m = re.search(r"Peak:\s+(-?[\d.]+|-inf) dBFS", tail)
    peak = float(m.group(1)) if m and m.group(1) != "-inf" else -99.0
    return lufs, peak


def build_cue(cue, pack, fname, loops, tmp):
    src = os.path.join(HP_DIR if pack is HP_PACK else CK_DIR, fname)
    if not os.path.isfile(src):
        raise SystemExit("missing source: %s" % src)
    body = decode_f32(src)
    n = len(body)
    if loops:
        buf = np.concatenate([body[-GUARD:], body, body[:GUARD]], axis=0)
        guard = GUARD
    else:
        buf = body
        guard = 0
    raw = os.path.join(tmp, cue + ".f32")
    write_f32(raw, buf)

    ogg = os.path.join(OUT, cue + ".ogg")
    q = MUSIC_Q
    kbits = encode_vorbis(raw, 2, ogg, q)
    kbps = kbits / (len(buf) / SR)
    while kbps > 126 and q > 0.5:
        q -= 0.5
        kbps = encode_vorbis(raw, 2, ogg, q) / (len(buf) / SR)
    # the Ogg must decode to exactly the samples we wrote (granule-trimmed), or the loop region is wrong
    dec = decode_f32(ogg)
    if len(dec) != len(buf):
        raise SystemExit("%s: ogg decodes to %d samples, wrote %d" % (cue, len(dec), len(buf)))

    # AAC twin: pad so (padded + AAC_DELAY) is a whole number of 1024-sample frames
    pad = (-(len(buf) + AAC_DELAY)) % 1024
    padded = np.concatenate([buf, np.zeros((pad, 2), np.float32)], axis=0)
    rawp = os.path.join(tmp, cue + "_pad.f32")
    write_f32(rawp, padded)
    m4a = os.path.join(OUT, cue + ".m4a")
    run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", rawp,
         "-c:a", "aac", "-b:a", "%dk" % AAC_KBPS, "-map_metadata", "-1", "-fflags", "+bitexact", "-movflags", "+faststart", m4a])
    el = decode_f32(m4a)
    raw_dec = decode_f32(m4a, ["-ignore_editlist", "1"])
    problems = []
    if len(el) != len(padded):
        problems.append("edit-list decode %d != %d" % (len(el), len(padded)))
    if len(raw_dec) != len(padded) + AAC_DELAY:
        problems.append("raw decode %d != %d + %d" % (len(raw_dec), len(padded), AAC_DELAY))
    # alignment: the edit-list decode must line up with the source at lag 0
    mid = len(buf) // 2
    a = buf[mid:mid + SR, 0]
    best, best_lag = -2.0, 0
    for lag in range(-8, 9):
        b = el[mid + lag:mid + lag + SR, 0]
        c = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-12))
        if c > best:
            best, best_lag = c, lag
    if best_lag != 0 or best < 0.98:
        problems.append("aac alignment lag %d corr %.4f" % (best_lag, best))
    if problems:
        raise SystemExit("%s AAC twin: %s" % (cue, "; ".join(problems)))

    lufs, peak = ebur128(ogg)
    info = {
        "loop": bool(loops),
        "guard": round(guard / SR, 6),
        "seconds": round(n / SR, 6),
        "samples": n,
        "ogg": cue + ".ogg", "oggBytes": os.path.getsize(ogg), "oggKbps": round(kbps, 1), "q": q,
        "m4a": cue + ".m4a", "m4aBytes": os.path.getsize(m4a), "m4aSamples": len(padded), "aacDelay": AAC_DELAY,
        "m4aKbps": round(os.path.getsize(m4a) * 8 / 1000.0 / (len(padded) / SR), 1),
        "lufs": lufs, "peakDb": peak,
    }
    print("%-8s %7.2f s  ogg %6.1f KB %5.1f kb/s (q %.1f)  m4a %6.1f KB  %6.1f LUFS  peak %5.1f dB" % (
        cue, n / SR, info["oggBytes"] / 1024, kbps, q, info["m4aBytes"] / 1024, lufs, peak), flush=True)
    return info


def write_manifest(entries):
    L = []
    L.append("/* CRESTBOUND — recorded music manifest. GENERATED by assets/music/_build/build_music.py: do not edit by hand,")
    L.append(" * fix the generator and rebuild. Data only: no side effects at import (URLs are resolved against this module).")
    L.append(" *")
    L.append(" * loop cues: the file is [guard] + loop + [guard]; play with loopStart = guard, loopEnd = guard + seconds.")
    L.append(" * m4a: AAC-LC twin for browsers without Ogg Vorbis; a decode that ignores the MP4 edit list starts with")
    L.append(" * `aacDelay` priming samples (44.1 kHz) — the runtime detects it by duration and skips it. */")
    L.append("")
    L.append("export const MUSIC_RATE = %d;" % SR)
    L.append("")
    L.append("export const MUSIC_CUES = Object.freeze({")
    for cue, e in entries:
        L.append("  %s: Object.freeze({" % cue)
        L.append("    ogg: new URL('./%s', import.meta.url).href," % e["ogg"])
        L.append("    m4a: new URL('./%s', import.meta.url).href," % e["m4a"])
        L.append("    loop: %s, guard: %s, seconds: %s, samples: %d," % ("true" if e["loop"] else "false", e["guard"], e["seconds"], e["samples"]))
        L.append("    m4aSamples: %d, aacDelay: %d, lufs: %s, peakDb: %s," % (e["m4aSamples"], e["aacDelay"], e["lufs"], e["peakDb"]))
        L.append("    oggBytes: %d, m4aBytes: %d," % (e["oggBytes"], e["m4aBytes"]))
        L.append("    track: %s, pack: %s, author: %s," % (json.dumps(e["title"]), json.dumps(e["pack"]), json.dumps(e["author"])))
        L.append("  }),")
    L.append("});")
    L.append("")
    tot_o = sum(e["oggBytes"] for _, e in entries)
    tot_m = sum(e["m4aBytes"] for _, e in entries)
    L.append("/** every Ogg byte (a browser downloads one set: these, or the .m4a twins) */")
    L.append("export const MUSIC_OGG_BYTES = %d;" % tot_o)
    L.append("export const MUSIC_M4A_BYTES = %d;" % tot_m)
    L.append("")
    L.append("/** tracks registered for the slug `crestbound` in state/music_assignments.json */")
    L.append("export const REGISTERED_TRACKS = Object.freeze(%s);" % json.dumps([e["registry"] for _, e in entries]))
    L.append("")
    with open(os.path.join(OUT, "manifest.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L))
    return tot_o, tot_m


def write_credits(entries):
    tracks = []
    for cue, e in entries:
        tracks.append({"cue": cue, "title": e["title"], "pack": e["pack"], "author": e["author"], "source": e["source"],
                       "license": e["license"], "registry": e["registry"], "mood": e["mood"]})
    packs = {}
    for t in tracks:
        packs.setdefault((t["author"], t["pack"]), []).append(t["title"])
    lines = ["Music: " + ", ".join("\u201c%s\u201d" % s for s in titles) + " from \u201c%s\u201d by %s (Unity Asset Store)" % (p, a)
             for (a, p), titles in packs.items()]
    data = {"music": tracks, "lines": lines,
            "registry": "C:/Users/TestRun/Claude Claw/state/music_assignments.json (slug crestbound)"}
    with open(os.path.join(OUT, "CREDITS.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")


def register(keys):
    """Add `keys` to assignments[crestbound] and `used`. Refuses if any key is used by ANOTHER slug. Idempotent."""
    with open(REGISTRY, "r", encoding="utf-8") as f:
        reg = json.load(f)
    assign = reg.setdefault("assignments", {})
    used = reg.setdefault("used", {})
    mine = assign.get(SLUG) or []
    others = {}
    for slug, v in assign.items():
        if slug == SLUG:
            continue
        for k in (v if isinstance(v, list) else [v]):
            others[k] = slug
    clash = [k for k in keys if (k in used and k not in mine) or k in others]
    if clash:
        raise SystemExit("REFUSED: already used by another game: %s" % clash)
    if sorted(mine) == sorted(keys) and all(used.get(k) == 1 for k in keys):
        print("registry: already registered (%d tracks), unchanged" % len(keys))
        return
    backup = REGISTRY + ".bak_crestbound_music"
    shutil.copy2(REGISTRY, backup)
    for k in keys:
        if k not in mine:
            used[k] = used.get(k, 0) + 1
    assign[SLUG] = list(keys)
    tmp = REGISTRY + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(reg, f, indent=1, ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, REGISTRY)
    print("registry: %d tracks registered to %s (backup %s)" % (len(keys), SLUG, backup))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", action="store_true", help="also write the crestbound entries into state/music_assignments.json")
    args = ap.parse_args()
    for exe in ("ffmpeg", "ffprobe"):
        if not shutil.which(exe):
            raise SystemExit("%s not on PATH" % exe)
    entries = []
    with tempfile.TemporaryDirectory(prefix="crestbound-music-") as tmp:
        for cue, pack, fname, track, title, loops, mood in CUES:
            info = build_cue(cue, pack, fname, loops, tmp)
            info.update({"title": title, "pack": pack["pack"], "author": pack["author"], "source": pack["source"],
                         "license": pack["license"], "registry": registry_key(pack, track), "mood": mood})
            entries.append((cue, info))
    tot_o, tot_m = write_manifest(entries)
    write_credits(entries)
    print("total: ogg %.2f MB, m4a %.2f MB (a browser downloads one set, on demand per realm)" % (tot_o / 1048576, tot_m / 1048576))
    if args.register:
        register([e["registry"] for _, e in entries])


if __name__ == "__main__":
    main()
