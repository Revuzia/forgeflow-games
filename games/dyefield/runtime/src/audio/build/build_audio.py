#!/usr/bin/env python
"""DYEFIELD audio build (CONTRACT_P6_11 §21) — THE GENERATOR for runtime/src/audio/assets/*,
runtime/src/audio/manifest.ts and runtime/src/audio/CREDITS.json. Never hand-edit those outputs.

    python runtime/src/audio/build/build_audio.py                 # full build (music + sfx sprite)
    python runtime/src/audio/build/build_audio.py --cache DIR     # where the Unity-package WAVs are unpacked
    python runtime/src/audio/build/build_audio.py --report FILE   # also write a JSON build report

Sources (all read-only, on F:\\):
  * music — "SynthWave Music Pack" by Travis Rise (Unity Asset Store), the .unitypackage in
    F:/games/unity-asset-cache/Travis Rise/AudioMusicElectronic/. The loop WAVs the pack ships are
    unpacked into --cache (default %TEMP%/dyefield-audio-cache) on first use. Registered for the slug
    `dyefield` in C:/Users/TestRun/Claude Claw/state/music_assignments.json (see ../README.md).
  * sfx — Kenney "Interface Sounds" + "Impact Sounds" (CC0) and the Sonniss #GameAudioGDC 2024 bundle
    on F:/games/forgeflow-games-assets/**, plus offline-synthesised layers (numpy; fixed seeds).

Outputs:
  * assets/music_<cue>.ogg  stereo 44.1 kHz Ogg Vorbis ≤ 128 kb/s. Looping cues are the pack's own loop
    sections laid end to end; the manifest lists each section (start, duration, exact sample counts) so
    the runtime re-sequences them sample-accurately (Vorbis has no encoder delay).
  * assets/sfx.ogg          one mono 44.1 kHz Ogg Vorbis sprite; every variant's (start, duration) in the
    manifest. Loop regions are written with 60 ms of their own wrap-around on both sides so the codec
    sees continuous signal across the seam.
  * manifest.ts             generated TypeScript: static `new URL('./assets/..', import.meta.url)` (Vite
    emits hashed files; Node resolves them to file: URLs for the probe), per-sound loudness (ldb) and
    category, per-cue sections/sequence/bpm.
  * CREDITS.json            every pack used, its author and licence, for the CREDITS screen.

Deterministic: fixed seeds, no wall-clock input. Needs ffmpeg/ffprobe on PATH, numpy + scipy.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, lfilter, sosfilt

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO_DIR = os.path.dirname(HERE)
ASSETS = os.path.join(AUDIO_DIR, "assets")
MANIFEST_TS = os.path.join(AUDIO_DIR, "manifest.ts")
CREDITS_JSON = os.path.join(AUDIO_DIR, "CREDITS.json")

FFA = "F:/games/forgeflow-games-assets"
SONNISS = FFA + "/sonniss-gdc2024"
K_IF = FFA + "/interface-sounds/Audio"
K_IMP = FFA + "/impact-sounds/Audio"
TR_PKG = "F:/games/unity-asset-cache/Travis Rise/AudioMusicElectronic/SynthWave Music Pack.unitypackage"
TR = "Assets/Music/TR_SYNTHWAVE/"

MUSIC_Q = 3.0          # libvorbis quality (≈112 kb/s stereo); stepped down if a file measures > 126 kb/s
SFX_Q = 3.0            # mono sprite
PAYLOAD_BUDGET = 8 * 1024 * 1024

# ─────────────────────────────────────────── io ───────────────────────────────────────────────
_CH_CACHE: dict[str, int] = {}


def channels_of(path: str) -> int:
    if path not in _CH_CACHE:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels",
                              "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout.strip()
        _CH_CACHE[path] = int(out.split(",")[0] or 1)
    return _CH_CACHE[path]


def decode(path: str, t0: float = 0.0, dur: float | None = None, ch: int | None = None, stereo: bool = False) -> np.ndarray:
    """→ float64 mono (N,) or stereo (N, 2) at SR. Mono = mean of the first two channels, or channel `ch`."""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{t0:.6f}"]
    if dur is not None:
        cmd += ["-t", f"{dur:.6f}"]
    cmd += ["-i", path]
    nch = channels_of(path)
    if stereo:
        cmd += ["-ac", "2"]
    elif ch is not None:
        cmd += ["-af", f"pan=mono|c0=c{ch}"]
    elif nch >= 2:
        cmd += ["-af", "pan=mono|c0=0.5*c0+0.5*c1"]
    cmd += ["-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return x.reshape(-1, 2) if stereo else x


def write_wav(path: str, x: np.ndarray) -> None:
    wavfile.write(path, SR, np.clip(x, -1.0, 1.0).astype(np.float32))


def encode_vorbis(wav: str, ogg: str, q: float, channels: int) -> float:
    """encode; returns the measured average bit rate (kb/s)"""
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav, "-ac", str(channels), "-c:a", "libvorbis", "-q:a", f"{q:.2f}",
                    "-map_metadata", "-1", ogg], check=True)
    return probe_kbps(ogg)


def probe_kbps(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration,size", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    f = json.loads(out)["format"]
    return float(f["size"]) * 8 / float(f["duration"]) / 1000.0


def loudness(path_or_arr, stereo: bool) -> tuple[float, float]:
    """EBU R128 integrated loudness (LUFS) + true peak (dBTP) via ffmpeg ebur128"""
    tmp = None
    path = path_or_arr
    if not isinstance(path_or_arr, str):
        fd, tmp = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        write_wav(tmp, path_or_arr)
        path = tmp
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                           capture_output=True, text=True)
        txt = r.stderr
        i = float(re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", txt)[-1].replace("-inf", "-70"))
        pk = float(re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", txt)[-1].replace("-inf", "-70"))
        return i, pk
    finally:
        if tmp:
            os.remove(tmp)


# ─────────────────────────────────────────── dsp ──────────────────────────────────────────────
def db2(g: float) -> float:
    return 10 ** (g / 20)


def n_of(sec: float) -> int:
    return int(round(sec * SR))


def silence(sec: float) -> np.ndarray:
    return np.zeros(n_of(sec))


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.0) -> np.ndarray:
    y = x.copy()
    a, b = n_of(fin), n_of(fout)
    if a > 0:
        a = min(a, len(y))
        y[:a] *= np.sin(np.linspace(0, math.pi / 2, a)) ** 2
    if b > 0:
        b = min(b, len(y))
        y[len(y) - b:] *= np.cos(np.linspace(0, math.pi / 2, b)) ** 2
    return y


def hp(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, f, "highpass", fs=SR, output="sos"), x)


def lp(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, f, "lowpass", fs=SR, output="sos"), x)


def bp(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    return sosfilt(butter(order, [lo, hi], "bandpass", fs=SR, output="sos"), x)


def peaking(x: np.ndarray, f0: float, gain_db: float, q: float) -> np.ndarray:
    """RBJ peaking EQ"""
    A = 10 ** (gain_db / 40)
    w = 2 * math.pi * f0 / SR
    al = math.sin(w) / (2 * q)
    b = [1 + al * A, -2 * math.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * math.cos(w), 1 - al / A]
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)


def resample_rate(x: np.ndarray, rate: float) -> np.ndarray:
    """play `x` at `rate` (pitch and speed together, like playbackRate)"""
    if abs(rate - 1) < 1e-6:
        return x
    n = len(x)
    m = max(1, int(round(n / rate)))
    return np.interp(np.arange(m) * rate, np.arange(n), x)


def mix(*parts: tuple) -> np.ndarray:
    """parts: (array, offset_s, gain_db)"""
    end = max(n_of(off) + len(a) for a, off, _ in parts)
    y = np.zeros(end)
    for a, off, g in parts:
        o = n_of(off)
        y[o:o + len(a)] += a * db2(g)
    return y


def norm_peak(x: np.ndarray, peak_db: float = -1.0) -> np.ndarray:
    m = np.abs(x).max()
    return x if m < 1e-9 else x * (db2(peak_db) / m)


def trim_tail(x: np.ndarray, thr_db: float = -60.0) -> np.ndarray:
    m = np.abs(x).max()
    if m < 1e-9:
        return x
    idx = np.where(np.abs(x) > m * db2(thr_db))[0]
    return x[: idx[-1] + 1] if len(idx) else x


def loop_xfade(seg: np.ndarray, L: int, X: int) -> np.ndarray:
    """seamless loop of length L from a segment of ≥ L+X samples (equal-power crossfade of the tail into the head)"""
    assert len(seg) >= L + X, (len(seg), L, X)
    out = seg[:L].copy()
    a = np.linspace(0, 1, X)
    out[:X] = seg[:X] * np.sin(a * math.pi / 2) + seg[L:L + X] * np.cos(a * math.pi / 2)
    return out


def ldb(x: np.ndarray) -> float:
    """rough perceived level: RMS (dBFS) of the loudest 400 ms after a 100 Hz high-pass + 2 kHz presence tilt"""
    y = hp(x, 100)
    y = y + 0.4 * hp(y, 2000)
    w = min(len(y), n_of(0.4))
    if w < 16:
        return -90.0
    c = np.concatenate([[0.0], np.cumsum(y * y)])
    best = max((c[i + w] - c[i]) / w for i in range(0, len(y) - w + 1, max(1, w // 8)))
    return round(10 * math.log10(best + 1e-12), 1)


# ─────────────────────────────────────────── synth ────────────────────────────────────────────
def tt(dur: float) -> np.ndarray:
    return np.arange(n_of(dur)) / SR


def sweep(dur: float, f0: float, f1: float, expo: bool = True) -> np.ndarray:
    t = tt(dur)
    f = f0 * (f1 / f0) ** (t / dur) if expo else f0 + (f1 - f0) * t / dur
    return np.sin(2 * math.pi * np.cumsum(f) / SR)


def expenv(dur: float, tau: float, att: float = 0.002) -> np.ndarray:
    t = tt(dur)
    return np.exp(-t / tau) * (np.clip(t / att, 0, 1) if att > 0 else 1.0)


def noise(dur: float, seed: int) -> np.ndarray:
    return np.random.default_rng(seed).standard_normal(n_of(dur)) * 0.3


def additive(freq: np.ndarray, maxf: float = 7000.0, tilt: float = 1.0) -> np.ndarray:
    """band-limited saw-like tone following a per-sample frequency track"""
    ph = 2 * math.pi * np.cumsum(freq) / SR
    out = np.zeros_like(freq)
    fmax = float(freq.max())
    k = 1
    while k * fmax < maxf:
        out += np.sin(k * ph) / k ** tilt
        k += 1
    return out


def syn_beep(f: float = 880.0, dur: float = 0.17) -> np.ndarray:
    t = tt(dur)
    x = np.sin(2 * math.pi * f * t) + 0.25 * np.sin(2 * math.pi * 2 * f * t) + 0.08 * np.sin(2 * math.pi * 3 * f * t)
    env = np.clip(t / 0.004, 0, 1) * np.clip((dur - t) / 0.07, 0, 1)
    return x * env


def syn_tick(seed: int = 7) -> np.ndarray:
    dur = 0.1
    t = tt(dur)
    x = np.sin(2 * math.pi * 1250 * t) * np.exp(-t / 0.02) + 0.45 * np.sin(2 * math.pi * 2630 * t) * np.exp(-t / 0.011)
    x += hp(noise(dur, seed), 3000) * np.exp(-t / 0.0025) * 1.2
    return x * np.clip(t / 0.0008, 0, 1)


def syn_horn(dur: float, att: float = 0.07, rel: float = 0.3, droop: float = 0.0, seed: int = 11) -> np.ndarray:
    """a bright harbour horn: C3 + E3 + G3 over C2, bent into pitch, slow vibrato, formant-shaped"""
    t = tt(dur)
    notes = [(130.81, 1.0), (164.81, 0.78), (196.0, 0.5), (65.41, 0.55)]
    out = np.zeros(len(t))
    for i, (f0, a) in enumerate(notes):
        cents = -70.0 * np.exp(-t / 0.045) + 7.0 * np.sin(2 * math.pi * (5.1 + 0.37 * i) * t + 1.3 * i) * np.clip((t - 0.12) / 0.25, 0, 1)
        if droop:
            cents = cents - droop * np.clip((t - (dur - rel - 0.25)) / (rel + 0.25), 0, 1) ** 1.5
        freq = f0 * (2 ** (cents / 1200)) * (1 + 0.0012 * i)
        out += a * additive(freq, maxf=5200, tilt=1.35)
    out += bp(noise(dur, seed), 900, 2800) * 0.35
    out = peaking(out, 640, 6.0, 1.1)
    out = peaking(out, 1750, 3.5, 1.4)
    out = lp(out, 2900, 4)
    env = np.clip(t / att, 0, 1) ** 1.5 * np.clip((dur - t) / rel, 0, 1) ** 1.2
    return out * env


def syn_bell(f: float, dur: float, ratio: float = 3.5, index: float = 2.2, tau: float = 0.32) -> np.ndarray:
    t = tt(dur)
    mod = index * np.exp(-t / 0.12) * np.sin(2 * math.pi * f * ratio * t)
    return np.sin(2 * math.pi * f * t + mod) * np.exp(-t / tau) * np.clip(t / 0.003, 0, 1)


def syn_squirt(seed: int) -> np.ndarray:
    """MIST-RASP shot: a wet pitched squirt (body sweep + sprayed noise + bubble blip + low thup)"""
    rng = np.random.default_rng(seed)
    dur = 0.14
    t = tt(dur)
    f0 = 980 * (1 + rng.uniform(-0.08, 0.08))
    body = sweep(dur, f0, 360) * np.exp(-t / 0.034) * np.clip(t / 0.002, 0, 1)
    wet = bp(noise(dur, seed + 1), 1800, 5600) * np.exp(-t / 0.026) * np.clip(t / 0.001, 0, 1)
    blip = np.zeros(len(t))
    b = sweep(0.035, 1700 + rng.uniform(-150, 150), 2750) * expenv(0.035, 0.011, 0.001)
    o = n_of(0.012)
    blip[o:o + len(b)] = b[: len(t) - o]
    thup = sweep(dur, 175, 85) * np.exp(-t / 0.018) * np.clip(t / 0.001, 0, 1)
    return fade(0.55 * body + 1.9 * wet + 0.28 * blip + 0.55 * thup, 0.0, 0.02)


def syn_thump(dur: float = 0.18, f0: float = 150.0, f1: float = 52.0, tau: float = 0.05) -> np.ndarray:
    t = tt(dur)
    return sweep(dur, f0, f1) * np.exp(-t / tau) * np.clip(t / 0.002, 0, 1)


def syn_bubble(dur: float, f0: float, f1: float, tau: float) -> np.ndarray:
    return sweep(dur, f0, f1) * expenv(dur, tau, 0.002)


def syn_wah(dur: float = 0.85) -> np.ndarray:
    """a cartoon 'wah' falling tone (WASHED)"""
    t = tt(dur)
    base = 520 * (130 / 520) ** (t / dur)
    freq = base * 2 ** (45 * np.sin(2 * math.pi * 7 * t) / 1200)
    x = lp(additive(freq, maxf=5000, tilt=1.7), 2200)
    env = np.clip(t / 0.012, 0, 1) * np.clip((dur - t) / 0.25, 0, 1)
    return x * env


def syn_boing(dur: float = 0.55, seed: int = 5) -> np.ndarray:
    """tide-spring launch: a rising, wobbling spring tone"""
    t = tt(dur)
    freq = 190 * (1 + 0.9 * t / dur) * 2 ** (130 * np.exp(-t / 0.22) * np.sin(2 * math.pi * 17 * t) / 1200)
    x = additive(freq, maxf=3500, tilt=1.8) * np.exp(-t / 0.28) * np.clip(t / 0.003, 0, 1)
    return x + hp(noise(dur, seed), 2500) * np.exp(-t / 0.01) * 0.6


def syn_roll_loop(seed: int = 21) -> np.ndarray:
    """SHEET-DRUM rolling: a wet, sticky low roll with the drum's 5 Hz turn (seamless 1.2 s)"""
    L, X = n_of(1.2), n_of(0.3)
    dur = (L + X) / SR
    t = tt(dur)
    br = np.cumsum(noise(dur, seed))
    br = lp(hp(br - np.convolve(br, np.ones(4410) / 4410, "same"), 45), 650)
    br /= np.abs(br).max() + 1e-9
    am = 0.62 + 0.38 * np.sin(2 * math.pi * 5 * t)
    sq = bp(noise(dur, seed + 1), 700, 2600) * (0.6 + 0.4 * np.sin(2 * math.pi * 5 * t + 1.0)) ** 2
    return loop_xfade(lp(br * am + 0.55 * sq, 3500, 2), L, X)


def syn_rise(dur: float, f0: float, f1: float) -> np.ndarray:
    t = tt(dur)
    return sweep(dur, f0, f1) * np.clip(t / (dur * 0.7), 0, 1) ** 2 * np.clip((dur - t) / 0.05, 0, 1)


# ──────────────────────────────────── sound sources (paths) ───────────────────────────────────
def S(pack: str, name: str) -> str:
    return f"{SONNISS}/{pack}/{name}"


P_SPLAT = S("Justsoundeffects - Gore Mini Pack", "GORESplt_Gore Splatter 01_JSE_GMP.wav")
P_FLESH = S("Justsoundeffects - Gore Mini Pack", "GOREFlsh_Flesh Drops on Floor 03_JSE_GMP.wav")
P_W_IMPACT = S("BluezoneCorp - Designed Water", "Bluezone_BC0298_designed_water_impact_006.wav")
P_W_TEXT = S("BluezoneCorp - Designed Water", "Bluezone_BC0298_designed_water_texture_014.wav")
P_SUB_DRAIN = S("InMotionAudio - Submerge", "WATRDran_Drain02_InMotionAudio_Submerge.wav")
P_SUB_IMPACT = S("InMotionAudio - Submerge", "WATRImpt_Impact20_InMotionAudio_Submerge.wav")
P_SOFTMOVE = S("Justsoundeffects - Water in Motion", "WATRMvmt_Soft Movement 01_JSE_WIM.wav")
P_BUBBLES = S("Justsoundeffects - Water in Motion", "WATRUndwtr_Evolving Underwater Bubbles_JSE_WIM.wav")
P_FIZZ = S("Justsoundeffects - Water in Motion", "WATRFizz_Fizzing Effervescent Tablets 03_JSE_WIM_Mono.wav")
P_AIRY = S("Rescopic Sound - Distinct Whooshes", "WHSH_Airy-Whoosh Wind Gust 11_RSCPC_DW.wav")
P_FLABBY = S("Rescopic Sound - Distinct Whooshes", "WHSH_Deviant-Whoosh Flabby Slow 09_RSCPC_DW.wav")
P_WATERY = S("Rescopic Sound - Distinct Whooshes", "WHSH_Watery-Whoosh FIzzy Fast 03_RSCPC_DW.wav")
P_PULSE = S("Rescopic Sound - Sci-Fi Energy Weapons", "SCIWeap_Shot Pulse YR 05_RSCPC_SFEW.wav")
P_BOOM = S("BluezoneCorp - Modern Cinematic Impact", "Bluezone_BC0294_modern_cinematic_impact_boom_003.wav")
P_POP = S("Rogue Waves - Kawaii UI", "TOONPop_Syringe Pop 4_RogueWaves_KawaiiUI.wav")
P_HANDPOP = S("Rogue Waves - Kawaii UI", "UIClick_Hand Pop UI Diminished 1_RogueWaves_KawaiiUI.wav")
P_CURSOR = S("Rogue Waves - Kawaii UI", "UIClick_Operating System UI Cursor_RogueWaves_KawaiiUI.wav")
P_RAIN = S("Sonik Sound Library - Spatial Rain & Thunders", "RAIN_Weather, Rain, Heavy with Distant Thunders_KS_Spatial Rain & Thunders-AmbiX_KSL_KS010.wav")
P_THUNDER = S("Bolt - Backyard Rain & Thunder - Suburban Rain Recordings", "RAIN_Distant Thunder and Rain Long Thunderstorm C_BOLT_BackyardRain_UsiPro.wav")
P_FRIDGE = S("Jake Fielding - Fridge Hums", "MACHAppl_Electrical Fridge Hum, Water Drips, Rattle,_Jake Fielding_Fridge Hums.wav")
P_HARBOR = S("Jake Fielding - Industrial Harbor", "WATRWave_Water Lapping against port_Jake Fielding_Industrial Harbor.wav")
P_FACTORY = S("Justsoundeffects - Steampunk Gadgets", "AMBDsgn_Factory Hall with Large Steam Mashines 02_JSE_SG.wav")


def K(name: str) -> str:
    return f"{K_IF}/{name}"


def KI(name: str) -> str:
    return f"{K_IMP}/{name}"


# splat onsets inside the Gore Splatter file (5 takes, 2.4 s apart; measured by onset detection)
SPLAT_T = [0.005, 2.405, 4.815, 7.215, 9.615]


def seg(path: str, t0: float, dur: float, fin: float = 0.004, fout: float = 0.05, ch: int | None = None) -> np.ndarray:
    return fade(decode(path, t0, dur, ch=ch), fin, fout)


def splat_take(i: int) -> np.ndarray:
    return lp(hp(seg(P_SPLAT, SPLAT_T[i], 0.34, 0.002, 0.14), 170), 9500)


def loop_from(path: str, t0: float, L: float, X: float, ch: int | None = None, filt=None) -> np.ndarray:
    """a seamless loop of L s cut from `path` at t0 (X s crossfade). `filt` is applied circularly (on three
    back-to-back copies, keeping the middle one) so a filter's start-up transient can never land on the seam."""
    x = loop_xfade(decode(path, t0, L + X + 0.01, ch=ch), n_of(L), n_of(X))
    if filt is None:
        return x
    n = len(x)
    return filt(np.concatenate([x, x, x]))[n:2 * n]


# ─────────────────────────────────────── the sound table ─────────────────────────────────────
# id → (category, loop, [variant builders]). Categories set the runtime's loudness target
# (router.ts CAT_TARGET_DB). Every id here is referenced by router.ts's EVENT_SOUNDS or the UI/horn
# API; probe_audio.ts proves both directions.
def build_table() -> dict:
    T: dict = {}

    def add(sid: str, cat: str, loop: bool, *variants, credit: list[str]) -> None:
        T[sid] = {"cat": cat, "loop": loop, "variants": list(variants), "credit": credit}

    # ── UI ──
    add("ui_hover", "ui", False, lambda: fade(hp(decode(P_CURSOR), 250), 0, 0.02), credit=[P_CURSOR])
    add("ui_click", "ui", False, lambda: fade(decode(P_HANDPOP), 0, 0.03), credit=[P_HANDPOP])
    add("ui_back", "ui", False, lambda: fade(decode(K("back_002.ogg")), 0, 0.02), credit=[K("back_002.ogg")])
    add("ui_start", "ui", False, lambda: fade(decode(K("confirmation_002.ogg")), 0, 0.05), credit=[K("confirmation_002.ogg")])
    # ── match flow ──
    add("beep", "flow", False, lambda: syn_beep(880.0), credit=["synth"])
    add("beep_go", "flow", False, lambda: syn_beep(1318.5, 0.32), credit=["synth"])
    add("tick", "flow", False, lambda: syn_tick(7), credit=["synth"])
    add("horn_start", "horn", False, lambda: syn_horn(1.25, rel=0.32), credit=["synth"])
    add("horn_minute", "horn", False, lambda: np.concatenate([syn_horn(0.34, rel=0.09, seed=12), silence(0.12), syn_horn(0.38, rel=0.12, seed=13)]),
        credit=["synth"])
    add("horn_final", "horn", False, lambda: syn_horn(0.62, rel=0.16, seed=14), credit=["synth"])
    add("horn_end", "horn", False, lambda: syn_horn(2.4, rel=0.85, droop=140, seed=15), credit=["synth"])
    add("special_ready", "ui", False, lambda: mix((syn_bell(1046.5, 0.9), 0, -3), (syn_bell(1318.5, 0.9), 0.07, -4), (syn_bell(1568.0, 1.0), 0.14, -4),
                                                  (syn_bell(2093.0, 1.0), 0.21, -8)), credit=["synth"])
    add("tank_low", "ui", False, lambda: fade(decode(K("question_001.ogg")), 0, 0.05), credit=[K("question_001.ogg")])
    add("confirm", "ui", False, lambda: fade(decode(K("confirmation_003.ogg")), 0, 0.04), credit=[K("confirmation_003.ogg")])
    # ── kits ──
    add("shot_mist", "weapon", False, *[(lambda s=s: syn_squirt(s)) for s in (101, 202, 303)], credit=["synth"])
    add("shot_drum", "weapon", False,
        lambda: mix((fade(hp(decode(P_WATERY, 1.0, 0.62), 160), 0.02, 0.26), 0, 0), (splat_take(1), 0.05, -5)),
        credit=[P_WATERY, P_SPLAT])
    add("roll_loop", "loop", True, lambda: syn_roll_loop(21), credit=["synth"])
    add("flick", "weapon", False, lambda: fade(hp(decode(P_AIRY, 0.45, 0.5), 250), 0.03, 0.12), credit=[P_AIRY])
    add("shot_needle", "weapon", False,
        lambda: mix((fade(hp(decode(P_PULSE, 0.0, 0.55), 150), 0.001, 0.22), 0, 0), (seg(P_SUB_IMPACT, 0.04, 0.22, 0.002, 0.08), 0.03, -3)),
        credit=[P_PULSE, P_SUB_IMPACT])
    add("shot_pop", "weapon", False,
        lambda: mix((syn_thump(0.24, 190, 58, 0.06), 0, 0), (syn_bubble(0.13, 430, 150, 0.05), 0.005, -5),
                    (lp(splat_take(1), 2600), 0.01, -7), (hp(noise(0.03, 41), 2500) * expenv(0.03, 0.006, 0.001), 0, -14)),
        credit=[P_SPLAT])
    add("burst", "impact", False,
        lambda: mix((seg(P_SUB_IMPACT, 0.03, 0.55, 0.002, 0.2), 0, 0), (splat_take(2), 0.0, -3), (lp(seg(P_BOOM, 0.27, 0.75, 0.003, 0.3), 420), 0, -9)),
        lambda: mix((seg(P_SUB_IMPACT, 0.03, 0.55, 0.002, 0.2), 0, 0), (splat_take(4), 0.0, -3), (lp(seg(P_BOOM, 0.44, 0.7, 0.003, 0.3), 420), 0, -10)),
        credit=[P_SUB_IMPACT, P_SPLAT, P_BOOM])
    add("splat", "splat", False, *[(lambda i=i: splat_take(i)) for i in range(5)], credit=[P_SPLAT])
    add("dry", "ui", False,
        lambda: mix((fade(decode(K("tick_004.ogg")), 0, 0.02), 0, 0), (bp(noise(0.06, 31), 2000, 5000) * expenv(0.06, 0.015, 0.002), 0.004, -8)),
        credit=[K("tick_004.ogg")])
    add("hit_dealt", "ui", False,
        lambda: mix((fade(hp(decode(K("glass_003.ogg")), 500), 0, 0.03), 0, 0), (np.sin(2 * math.pi * 2400 * tt(0.03)) * expenv(0.03, 0.008, 0.001), 0, -9)),
        credit=[K("glass_003.ogg")])
    add("hit_taken", "hit", False,
        lambda: mix((decode(KI("impactSoft_medium_001.ogg")), 0, 0), (lp(splat_take(3), 3200), 0.0, -6)),
        lambda: mix((decode(KI("impactSoft_medium_002.ogg")), 0, 0), (lp(splat_take(0), 3200), 0.0, -6)),
        credit=[KI("impactSoft_medium_001.ogg"), KI("impactSoft_medium_002.ogg"), P_SPLAT])
    add("washed_me", "big", False,
        lambda: mix((seg(P_W_IMPACT, 0.0, 1.65, 0.002, 0.6), 0, 0), (syn_wah(0.85), 0.05, -7)), credit=[P_W_IMPACT])
    add("washed", "impact", False,
        lambda: mix((seg(P_W_IMPACT, 0.26, 0.8, 0.004, 0.35), 0, 0), (seg(P_POP, 0.02, 0.25, 0.001, 0.08), 0, -3)), credit=[P_W_IMPACT, P_POP])
    add("respawn", "impact", False,
        lambda: mix((seg(P_W_TEXT, 0.05, 1.3, 0.03, 0.45), 0, 0), (syn_bubble(0.42, 300, 1250, 0.3), 0.05, -12)), credit=[P_W_TEXT])
    # ── movement ──
    add("slick_in", "move", False,
        lambda: mix((seg(P_SUB_IMPACT, 0.03, 0.3, 0.002, 0.12), 0, 0), (syn_bubble(0.1, 620, 230, 0.05), 0.0, -6)), credit=[P_SUB_IMPACT])
    add("slick_out", "move", False,
        lambda: mix((seg(P_SOFTMOVE, 30.93, 0.42, 0.004, 0.15), 0, 0), (syn_bubble(0.09, 230, 720, 0.05), 0.0, -8)), credit=[P_SOFTMOVE])
    add("swim_loop", "loop", True, lambda: loop_from(P_BUBBLES, 36.75, 3.0, 0.45, filt=lambda y: lp(hp(y, 110), 5200)), credit=[P_BUBBLES])
    add("refill_loop", "loop", True, lambda: loop_from(P_SUB_DRAIN, 4.0, 2.5, 0.35, filt=lambda y: hp(y, 90)), credit=[P_SUB_DRAIN])
    add("jump", "move", False, lambda: fade(hp(decode(P_AIRY, 1.0, 0.3), 300), 0.01, 0.12), credit=[P_AIRY])
    add("land", "move", False, *[(lambda f=f: fade(decode(KI(f)), 0, 0.02)) for f in ("footstep_concrete_000.ogg", "footstep_concrete_003.ogg", "footstep_concrete_004.ogg")],
        credit=[KI("footstep_concrete_000.ogg"), KI("footstep_concrete_003.ogg"), KI("footstep_concrete_004.ogg")])
    add("land_hard", "move", False,
        lambda: mix((decode(KI("impactSoft_heavy_001.ogg")), 0, 0), (decode(KI("footstep_concrete_003.ogg")), 0, -4)),
        credit=[KI("impactSoft_heavy_001.ogg"), KI("footstep_concrete_003.ogg")])
    # ── sub / specials ──
    add("sub_throw", "weapon", False, lambda: fade(hp(decode(P_FLABBY, 1.55, 0.7), 140), 0.03, 0.25), credit=[P_FLABBY])
    add("sub_land", "impact", False,
        lambda: mix((seg(P_FLESH, 9.52, 0.28, 0.002, 0.12), 0, 0), (fade(decode(P_FIZZ, 9.0, 0.8), 0.04, 0.3), 0.04, -10)), credit=[P_FLESH, P_FIZZ])
    add("sub_pop", "impact", False,
        lambda: mix((seg(P_POP, 0.02, 0.28, 0.001, 0.08), 0, 0), (seg(P_W_IMPACT, 0.25, 0.85, 0.002, 0.4), 0.0, -2),
                    (lp(seg(P_BOOM, 0.27, 0.55, 0.003, 0.25), 320), 0, -12)), credit=[P_POP, P_W_IMPACT, P_BOOM])
    add("cloud_throw", "weapon", False, lambda: fade(hp(decode(P_AIRY, 0.6, 1.7), 120), 0.05, 0.6), credit=[P_AIRY])
    add("thunder", "big", False, lambda: fade(hp(decode(P_THUNDER, 75.2, 4.0), 35), 0.01, 1.6), credit=[P_THUNDER])
    add("rain_loop", "loop", True, lambda: loop_from(P_RAIN, 23.0, 4.0, 0.6, ch=0, filt=lambda y: hp(y, 120)), credit=[P_RAIN])
    add("leap", "weapon", False,
        lambda: mix((fade(hp(decode(P_WATERY, 0.75, 0.75), 180), 0.05, 0.25), 0, 0), (syn_rise(0.45, 200, 760), 0.05, -14)), credit=[P_WATERY])
    add("slam", "big", False,
        lambda: mix((lp(seg(P_BOOM, 0.25, 1.5, 0.002, 0.6), 900), 0, -2), (seg(P_W_IMPACT, 0.0, 1.6, 0.002, 0.6), 0, 0)), credit=[P_BOOM, P_W_IMPACT])
    add("spring", "impact", False,
        lambda: mix((syn_boing(0.55), 0, -4), (seg(P_W_TEXT, 0.25, 0.6, 0.01, 0.25), 0.0, -3)), credit=[P_W_TEXT])
    # ── map loops / ambience ──
    add("conveyor_loop", "loop", True, lambda: loop_from(P_FRIDGE, 34.5, 2.5, 0.3, filt=lambda y: lp(y, 4200)), credit=[P_FRIDGE])
    add("amb_harbor", "amb", True, lambda: loop_from(P_HARBOR, 86.25, 8.0, 1.0, filt=lambda y: lp(hp(y, 60), 9000)), credit=[P_HARBOR])
    add("amb_works", "amb", True, lambda: loop_from(P_FACTORY, 13.5, 8.0, 1.0, filt=lambda y: lp(hp(y, 40), 8000)), credit=[P_FACTORY])
    return T


# ─────────────────────────────────────────── music ────────────────────────────────────────────
MUSIC = {
    # cue: track, bpm, loop sections (pack loop files) + intro/cycle order, or a cut from the FULL mix
    "lobby": {"track": "Revelation", "bpm": 100, "loop": True, "lufs": -17.0,
              "sections": [TR + "01_Revelation/01_TR_Revelation_LOOP_01.wav", TR + "01_Revelation/01_TR_Revelation_LOOP_02.wav",
                           TR + "01_Revelation/01_TR_Revelation_LOOP_03.wav"], "intro": [], "cycle": [0, 1, 0, 1, 2, 1]},   # 0→2 / 2→0 are not clean joins (probe_audio seam check)
    "match": {"track": "Chasing The Stars", "bpm": 120, "loop": True, "lufs": -16.0,
              "sections": [TR + "02_ChasingTheStars/02_TR_ChasingTheStars_LOOP_01.wav", TR + "02_ChasingTheStars/02_TR_ChasingTheStars_LOOP_02.wav"],
              "intro": [], "cycle": [0, 1]},
    "final": {"track": "Hyper Drive", "bpm": 140, "loop": True, "lufs": -15.0,
              "sections": [TR + "05_HyperDrive/05_TR_HyperDrive_LOOP_01.wav", TR + "05_HyperDrive/05_TR_HyperDrive_LOOP_02.wav",
                           TR + "05_HyperDrive/05_TR_HyperDrive_LOOP_03.wav"], "intro": [], "cycle": [0, 1, 2]},
    # stingers: the last two bars + the ring-out of the full mix (bar 86 = 206.4 s at 100 bpm)
    "victory": {"track": "Revelation", "bpm": 100, "loop": False, "lufs": -15.0,
                "cut": (TR + "01_Revelation/01_TR_Revelation_FULL.wav", 206.4, 9.6), "fin": 0.03, "fout": 1.2},
    "defeat": {"track": "8-bit Hero", "bpm": 100, "loop": False, "lufs": -16.5,
               "cut": (TR + "06_8-bitHero/06_TR_8-bitHero_FULL.wav", 206.4, 9.6), "fin": 0.03, "fout": 1.8},
}
# the keys written to state/music_assignments.json ('used' + assignments['dyefield']): <author>/<pack>/<track folder>
REGISTRY_TRACKS = ["Travis Rise/SynthWave Music Pack/01_Revelation", "Travis Rise/SynthWave Music Pack/02_ChasingTheStars",
                   "Travis Rise/SynthWave Music Pack/05_HyperDrive", "Travis Rise/SynthWave Music Pack/06_8-bitHero"]


def unpack_music(cache: str) -> None:
    want = set()
    for m in MUSIC.values():
        for p in m.get("sections", []):
            want.add(p)
        if "cut" in m:
            want.add(m["cut"][0])
    missing = [p for p in want if not os.path.exists(os.path.join(cache, p))]
    if not missing:
        return
    print(f"unpacking {len(missing)} WAVs from {os.path.basename(TR_PKG)} (one pass over the package) …", flush=True)
    # a .unitypackage is a gzip tar of <guid>/{asset, asset.meta, pathname}; `pathname` may come before or after
    # `asset`, so an asset is buffered only until its own pathname shows up (memory stays at ~1 WAV)
    names: dict[str, str] = {}
    blobs: dict[str, bytes] = {}

    def put(guid: str, data: bytes) -> None:
        dst = os.path.join(cache, names[guid])
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(data)

    with tarfile.open(TR_PKG, "r:gz") as tf:
        for m in tf:
            parts = m.name.split("/")
            if len(parts) < 2:
                continue
            guid, leaf = parts[-2], parts[-1]
            if leaf == "pathname":
                names[guid] = tf.extractfile(m).read().decode("utf-8", "replace").splitlines()[0].strip()
                blob = blobs.pop(guid, None)
                if blob is not None and names[guid] in missing:
                    put(guid, blob)
            elif leaf == "asset" and m.isfile():
                if guid in names:
                    if names[guid] in missing:
                        put(guid, tf.extractfile(m).read())
                else:
                    blobs[guid] = tf.extractfile(m).read()
    still = [p for p in missing if not os.path.exists(os.path.join(cache, p))]
    if still:
        raise SystemExit(f"could not unpack: {still}")


def build_music(cache: str, tmp: str, report: dict) -> dict:
    out = {}
    for cue, m in MUSIC.items():
        if m["loop"]:
            parts = [decode(os.path.join(cache, p), stereo=True) for p in m["sections"]]
            secs = []
            pos = 0
            for a in parts:
                secs.append((pos, len(a)))
                pos += len(a)
            x = np.concatenate(parts, axis=0)
        else:
            p, t0, d = m["cut"]
            x = decode(os.path.join(cache, p), t0, d, stereo=True)
            for c in range(2):
                x[:, c] = fade(x[:, c], m["fin"], m["fout"])
            secs = [(0, len(x))]
        i_lufs, tp = loudness(x, True)
        gain = m["lufs"] - i_lufs
        gain = min(gain, -1.0 - tp)             # true peak ≤ −1 dBTP
        x = x * db2(gain)
        wav = os.path.join(tmp, f"music_{cue}.wav")
        write_wav(wav, x)
        ogg = os.path.join(ASSETS, f"music_{cue}.ogg")
        q = MUSIC_Q
        kbps = encode_vorbis(wav, ogg, q, 2)
        while kbps > 126 and q > 0.5:
            q -= 0.5
            kbps = encode_vorbis(wav, ogg, q, 2)
        lufs_after, tp_after = loudness(ogg, True)
        out[cue] = {"file": f"assets/music_{cue}.ogg", "seconds": round(len(x) / SR, 6), "samples": len(x), "bytes": os.path.getsize(ogg),
                    "kbps": round(kbps, 1), "q": q, "sections": [(round(s / SR, 6), round(n / SR, 6), n) for s, n in secs],
                    "intro": m.get("intro", []), "cycle": m.get("cycle", [0]), "bpm": m["bpm"], "loop": m["loop"],
                    "lufs": round(lufs_after, 1), "tp": round(tp_after, 1), "gain_db": round(gain, 2), "track": m["track"]}
        print(f"music {cue:8s} {m['track']:18s} {len(x) / SR:7.2f} s  {kbps:6.1f} kb/s  {os.path.getsize(ogg) / 1024:7.0f} KB  "
              f"{lufs_after:6.1f} LUFS  tp {tp_after:5.1f}  sections {len(secs)}", flush=True)
    report["music"] = out
    return out


# ─────────────────────────────────────────── sprite ───────────────────────────────────────────
GUARD = 0.06    # s of wrap-around written around each loop region
GAP = 0.05      # s of silence between one-shot regions


def build_sfx(tmp: str, report: dict) -> dict:
    table = build_table()
    chunks: list[np.ndarray] = [silence(GAP)]
    pos = n_of(GAP)
    entries: dict = {}
    for sid, d in table.items():
        vs = []
        levels = []
        for build in d["variants"]:
            x = np.asarray(build(), dtype=np.float64)
            if not d["loop"]:
                x = trim_tail(x, -62.0)
            x = norm_peak(x, -1.5)          # Vorbis overshoots a hot peak by ~1 dB: keep 1.5 dB headroom
            levels.append(ldb(x))
            if d["loop"]:
                g = n_of(GUARD)
                chunks.append(x[-g:])
                pos += g
                vs.append((pos, len(x)))
                chunks.append(x)
                pos += len(x)
                chunks.append(x[:g])
                pos += g
                chunks.append(silence(GAP))
                pos += n_of(GAP)
            else:
                vs.append((pos, len(x)))
                chunks.append(x)
                pos += len(x)
                chunks.append(silence(GAP))
                pos += n_of(GAP)
        entries[sid] = {"v": [(round(s / SR, 6), round(n / SR, 6)) for s, n in vs], "n": [n for _, n in vs], "loop": d["loop"], "cat": d["cat"],
                        "ldb": round(float(np.mean(levels)), 1), "credit": d["credit"]}
    sprite = np.concatenate(chunks)
    wav = os.path.join(tmp, "sfx.wav")
    write_wav(wav, sprite)
    ogg = os.path.join(ASSETS, "sfx.ogg")
    q = SFX_Q
    kbps = encode_vorbis(wav, ogg, q, 1)
    while kbps > 126 and q > 0.5:
        q -= 0.5
        kbps = encode_vorbis(wav, ogg, q, 1)
    info = {"file": "assets/sfx.ogg", "seconds": round(len(sprite) / SR, 6), "samples": len(sprite), "bytes": os.path.getsize(ogg), "kbps": round(kbps, 1), "q": q}
    print(f"sfx sprite: {len(entries)} sounds, {sum(len(e['v']) for e in entries.values())} regions, {len(sprite) / SR:.2f} s, "
          f"{kbps:.1f} kb/s, {os.path.getsize(ogg) / 1024:.0f} KB", flush=True)
    report["sfx"] = {"sprite": info, "sounds": {k: {kk: v for kk, v in e.items() if kk != "credit"} for k, e in entries.items()}}
    return {"sprite": info, "entries": entries}


# ─────────────────────────────────────────── credits ──────────────────────────────────────────
SONNISS_LICENCE = ("Sonniss #GameAudioGDC 2024 bundle licence: royalty-free, commercial use, no attribution required; "
                   "may be embedded in a game, never redistributed as sound files.")
KENNEY_LICENCE = "Creative Commons Zero (CC0 1.0), https://creativecommons.org/publicdomain/zero/1.0/"
ASSET_STORE_LICENCE = ("Standard Unity Asset Store EULA (Extension Asset): licensed to Forge Flow Labs for use embedded in the game; "
                       "no standalone redistribution of the audio.")


def credits(sfx: dict, music: dict) -> dict:
    packs: dict[str, dict] = {}
    for sid, e in sfx["entries"].items():
        for src in e["credit"]:
            if src == "synth":
                key = "synth"
                packs.setdefault(key, {"pack": "Procedural layers", "author": "DYEFIELD (numpy synthesis, build_audio.py)", "license": "original work",
                                       "files": [], "sounds": []})
            elif src.startswith(SONNISS):
                folder = src[len(SONNISS) + 1:].split("/")[0]
                author, _, pack = folder.partition(" - ")
                key = "sonniss:" + folder
                packs.setdefault(key, {"pack": pack.strip(), "author": author.strip(), "source": "Sonniss #GameAudioGDC 2024 bundle",
                                       "license": SONNISS_LICENCE, "files": [], "sounds": []})
            else:
                kind = "Interface Sounds" if "/interface-sounds/" in src else "Impact Sounds"
                key = "kenney:" + kind
                packs.setdefault(key, {"pack": kind, "author": "Kenney (www.kenney.nl)", "source": "kenney.nl", "license": KENNEY_LICENCE,
                                       "files": [], "sounds": []})
            p = packs[key]
            if src != "synth" and os.path.basename(src) not in p["files"]:
                p["files"].append(os.path.basename(src))
            if sid not in p["sounds"]:
                p["sounds"].append(sid)
    tracks: dict[str, list[str]] = {}
    for cue, m in music.items():
        tracks.setdefault(m["track"], []).append(cue)
    sonniss_authors = sorted({v["author"] for k, v in packs.items() if k.startswith("sonniss:")})
    return {
        "_doc": "GENERATED by runtime/src/audio/build/build_audio.py. Every audio source DYEFIELD ships, for the CREDITS screen. "
                "`lines` are ready-to-show credit lines; `music` and `sfx` carry the detail.",
        "lines": [
            "Music: " + ", ".join(f"“{t}”" for t in tracks) + " from “SynthWave Music Pack” by Travis Rise (Unity Asset Store)",
            "Sound effects: Kenney (CC0), Interface Sounds + Impact Sounds",
            "Sound effects: Sonniss #GameAudioGDC 2024: " + ", ".join(sonniss_authors),
            "Horns, beeps, squirts and spring: synthesised for DYEFIELD",
        ],
        "music": [{"title": t, "cues": cues, "pack": "SynthWave Music Pack", "author": "Travis Rise", "source": "Unity Asset Store",
                   "license": ASSET_STORE_LICENCE, "registry": "state/music_assignments.json (slug dyefield)"} for t, cues in tracks.items()],
        "sfx": sorted(packs.values(), key=lambda p: (p["author"], p["pack"])),
    }


# ─────────────────────────────────────────── manifest ─────────────────────────────────────────
def ts_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def write_manifest(sfx: dict, music: dict) -> int:
    sp = sfx["sprite"]
    ids = list(sfx["entries"].keys())
    payload = sp["bytes"] + sum(m["bytes"] for m in music.values())
    L: list[str] = []
    L.append("// DYEFIELD — audio manifest. GENERATED by runtime/src/audio/build/build_audio.py: do not edit by hand, fix the generator")
    L.append("// and rebuild. THREE-free, DOM-free (the URLs are plain `new URL(..., import.meta.url)`: Vite emits the hashed files,")
    L.append("// Node resolves them to file: URLs for _harness/probe_audio.ts).")
    L.append("")
    L.append("export type SfxId =\n  | " + "\n  | ".join(ts_str(i) for i in ids) + ";")
    L.append("export type SfxCategory = " + " | ".join(ts_str(c) for c in sorted({e["cat"] for e in sfx["entries"].values()})) + ";")
    L.append("export type MusicCueId = " + " | ".join(ts_str(c) for c in music) + ";")
    L.append("")
    L.append("export interface SfxEntry {")
    L.append("  /** variants: [start s, duration s] inside the sprite */")
    L.append("  readonly v: readonly (readonly [number, number])[];")
    L.append("  /** variant lengths in samples at the sprite rate (exact) */")
    L.append("  readonly n: readonly number[];")
    L.append("  readonly loop: boolean;")
    L.append("  readonly cat: SfxCategory;")
    L.append("  /** perceived level of the normalised take (dBFS RMS of its loudest 400 ms); the router levels by category */")
    L.append("  readonly ldb: number;")
    L.append("}")
    L.append("export interface MusicEntry {")
    L.append("  readonly url: string;")
    L.append("  readonly file: string;")
    L.append("  readonly seconds: number;")
    L.append("  readonly bytes: number;")
    L.append("  readonly kbps: number;")
    L.append("  /** [start s, duration s, samples] of each section (a pack loop, or the whole stinger) */")
    L.append("  readonly sections: readonly (readonly [number, number, number])[];")
    L.append("  /** played once, then `cycle` repeats (looping cues) */")
    L.append("  readonly intro: readonly number[];")
    L.append("  readonly cycle: readonly number[];")
    L.append("  readonly bpm: number;")
    L.append("  readonly loop: boolean;")
    L.append("  readonly lufs: number;")
    L.append("  readonly track: string;")
    L.append("}")
    L.append("")
    L.append(f"export const SAMPLE_RATE = {SR};")
    L.append(f"/** s of wrap-around written before and after every loop region (seam.ts crossfades the head from it) */")
    L.append(f"export const SPRITE_GUARD_S = {GUARD};")
    L.append(f"export const SFX_SPRITE = {{ url: new URL({ts_str('./' + sp['file'])}, import.meta.url).href, file: {ts_str(sp['file'])}, "
             f"seconds: {sp['seconds']}, samples: {sp['samples']}, bytes: {sp['bytes']}, kbps: {sp['kbps']} }} as const;")
    L.append("")
    L.append("export const SFX: { readonly [K in SfxId]: SfxEntry } = {")
    for sid, e in sfx["entries"].items():
        v = ", ".join(f"[{s}, {d}]" for s, d in e["v"])
        n = ", ".join(str(x) for x in e["n"])
        L.append(f"  {sid}: {{ v: [{v}], n: [{n}], loop: {'true' if e['loop'] else 'false'}, cat: {ts_str(e['cat'])}, ldb: {e['ldb']} }},")
    L.append("};")
    L.append("")
    L.append("export const MUSIC: { readonly [K in MusicCueId]: MusicEntry } = {")
    for cue, m in music.items():
        secs = ", ".join(f"[{s}, {d}, {n}]" for s, d, n in m["sections"])
        L.append(f"  {cue}: {{")
        L.append(f"    url: new URL({ts_str('./' + m['file'])}, import.meta.url).href, file: {ts_str(m['file'])},")
        L.append(f"    seconds: {m['seconds']}, bytes: {m['bytes']}, kbps: {m['kbps']},")
        L.append(f"    sections: [{secs}],")
        L.append(f"    intro: [{', '.join(str(i) for i in m['intro'])}], cycle: [{', '.join(str(i) for i in m['cycle'])}],")
        L.append(f"    bpm: {m['bpm']}, loop: {'true' if m['loop'] else 'false'}, lufs: {m['lufs']}, track: {ts_str(m['track'])},")
        L.append("  },")
    L.append("};")
    L.append("")
    L.append(f"/** every shipped audio byte (sprite + music), for the ≤ 8 MB budget */")
    L.append(f"export const AUDIO_PAYLOAD_BYTES = {payload};")
    L.append(f"/** tracks registered for the slug `dyefield` in state/music_assignments.json */")
    L.append("export const REGISTERED_TRACKS = [" + ", ".join(ts_str(t) for t in REGISTRY_TRACKS) + "] as const;")
    L.append("")
    with open(MANIFEST_TS, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L))
    return payload


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "dyefield-audio-cache"))
    ap.add_argument("--report", default=None)
    a = ap.parse_args()
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            print(f"{tool} not on PATH")
            return 1
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(a.cache, exist_ok=True)
    unpack_music(a.cache)
    report: dict = {}
    with tempfile.TemporaryDirectory(prefix="dyefield-audio-") as tmp:
        music = build_music(a.cache, tmp, report)
        sfx = build_sfx(tmp, report)
    # drop stale outputs (anything in assets/ this build did not write)
    keep = {os.path.basename(m["file"]) for m in music.values()} | {"sfx.ogg"}
    for f in os.listdir(ASSETS):
        if f not in keep:
            os.remove(os.path.join(ASSETS, f))
    payload = write_manifest(sfx, music)
    with open(CREDITS_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(credits(sfx, music), f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"payload {payload / 1024 / 1024:.2f} MB (budget {PAYLOAD_BUDGET / 1024 / 1024:.0f} MB) → {MANIFEST_TS}")
    if a.report:
        report["payload_bytes"] = payload
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=1)
    return 0 if payload <= PAYLOAD_BUDGET else 1


if __name__ == "__main__":
    sys.exit(main())
