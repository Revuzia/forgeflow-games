#!/usr/bin/env python
"""HIT PARADE audio build (CONTRACT s9) - THE GENERATOR for runtime/src/audio/assets/*, runtime/src/audio/manifest.ts,
runtime/src/audio/CREDITS.json and runtime/src/audio/build/kit_report.json. Never hand-edit those outputs.
Adapted from dyefield's build_audio.py (sprite + guards, AAC twins, generated manifest); new: Opus, 48 kHz, three
sprites, a mastering chain per variant, music cut from the FULL mixes.

    python runtime/src/audio/build/build_audio.py              # full build
    python runtime/src/audio/build/build_audio.py --register   # also register the music in state/music_assignments.json
    python runtime/src/audio/build/build_audio.py --only sfx   # rebuild one group (ui|sfx|crowd|music) + manifest

Sources (read-only, local disk; the Unity packages are unpacked by build/extract_packages.py):
  * Imphenzia "Universal Sound FX" (Unity Asset Store) - F:/games/unity-assets/Imphenzia__Universal Sound FX/
  * Travis Rise "SynthWave Music Pack 2" + "SynthWave Music Pack" tracks 03/04/07 (Unity Asset Store)
    - F:/games/unity-assets/Travis Rise__SynthWave Music Pack 2/ and Travis Rise__SynthWave Music Pack/
    (pack 1 tracks 01/02/05/06 are dyefield's: never read here)
  * Daniel Gooding "Action RPG Characters" (Unity Asset Store) - female fighter efforts
  * Kenney "Impact Sounds" (CC0), Sonniss #GameAudioGDC 2024 (royalty free) - a few layers
  * offline-synthesised layers (numpy; fixed seeds): the game-show buzzer

Mastering chain for every sprite variant (measured into kit_report.json, gated at the end of the build):
  1. layers aligned on their transients (each hit layer is cut 10 ms before its peak: no lead-in, sample-true strike)
  2. lead-in trim of the finished sound (first sample over -40 dB of its peak, 2 ms pre-roll, 1 ms fade)
  3. high-pass 40 Hz (2nd-order Butterworth), phone-speaker fix where the 150 Hz-4 kHz share is < 25 %
     (a mid transient layer in the recipe + `excite`: harmonics of the sub band, so a phone speaker hears the thump)
  4. true peak (4x oversampled) normalised to -1.5 dBTP before encoding; the decoded Opus + AAC are re-measured and
     must read <= -1.0 dBTP
Music: each cue is a whole number of bars cut from the FULL mix at a measured bar line; the loop wrap is crossfaded
(60 ms, equal power) with the song's own continuation, so the seam is click-free by construction; levelled to -16 LUFS.

Outputs (Opus in Ogg, 48 kHz, + an AAC-LC .m4a twin each; a device downloads one set):
  assets/ui.ogg     mono sprite (menus)        assets/sfx.ogg   mono sprite (combat, voices, announcer, host)
  assets/crowd.ogg  stereo sprite (beds + reactions)   assets/music_<cue>.ogg  stereo
Deterministic: fixed seeds, no wall-clock input. Needs ffmpeg/ffprobe (libopus, aac) on PATH, numpy + scipy.
ASCII only.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, resample_poly, sosfilt

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO_DIR = os.path.dirname(HERE)
GAME = os.path.normpath(os.path.join(AUDIO_DIR, "..", "..", ".."))
ASSETS = os.path.join(AUDIO_DIR, "assets")
MANIFEST_TS = os.path.join(AUDIO_DIR, "manifest.ts")
CREDITS_JSON = os.path.join(AUDIO_DIR, "CREDITS.json")
REPORT_JSON = os.path.join(HERE, "kit_report.json")
REGISTRY = os.path.normpath(os.path.join(GAME, "..", "..", "..", "state", "music_assignments.json"))
SLUG = "hit-parade"

IMP = "F:/games/unity-assets/Imphenzia__Universal Sound FX/Assets/Universal Sound FX"
TR2 = "F:/games/unity-assets/Travis Rise__SynthWave Music Pack 2/Assets/Music/TR_SYNTHWAVE_2"
TR1 = "F:/games/unity-assets/Travis Rise__SynthWave Music Pack/Assets/Music/TR_SYNTHWAVE"
DG = "F:/games/unity-assets/Daniel Gooding__Action RPG Characters/Assets/Action RPG Characters/Vocal Files"
FFA = "F:/games/forgeflow-games-assets"
SONNISS = FFA + "/sonniss-gdc2024"
K_IMP = FFA + "/impact-sounds/Audio"

# encoder settings (kb/s). Opus VBR; AAC-LC twins (ffmpeg native encoder)
OPUS_KBPS = {"ui": 40, "sfx": 40, "crowd": 56, "music": 64}
AAC_KBPS = {"ui": 56, "sfx": 56, "crowd": 80, "music": 80}
SPRITE_CH = {"ui": 1, "sfx": 1, "crowd": 2}
PAYLOAD_BUDGET = 12_000_000          # CONTRACT s9: shipped audio <= 12 MB - checked on Ogg + AAC together
TP_TARGET = -1.5                     # pre-encode true peak
TP_LIMIT = -1.0                      # decoded (shipped) true peak gate
PHONE_MIN = 0.25                     # 150 Hz - 4 kHz energy share gate for impact categories
PHONE_CATS = {"hit", "layer", "block", "body", "impact", "super"}
LEAD_DB = -30.0                      # lead-in trim / gate threshold, dB below the sound's peak
LEAD_GATE_MS = 8.0                   # decoded lead-in allowed (3 ms pre-roll + codec smear)
SILENCE_DB = -45.0                   # 'silence' threshold for the no-dead-air gate of soft-onset sounds
SOFT_ONSET_MS = 40.0                 # voices / crowd / stings may swell in (a breath, a laugh) - never dead air
SOFT_CATS = {"voice", "ann", "crowd", "sting", "ui", "splat", "foley"}
GUARD = 0.06                         # s of wrap-around written around each sprite loop region
GAP = 0.05                           # s of silence between sprite regions


# ------------------------------------------- io -----------------------------------------------
def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, check=True, **kw)


def ffprobe_json(path: str) -> dict:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", path],
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def decode(path: str, t0: float = 0.0, dur: float | None = None, stereo: bool = False) -> np.ndarray:
    """-> float64 mono (N,) or stereo (N, 2) at SR (ffmpeg resampler, whole-file context)"""
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    cmd = ["ffmpeg", "-v", "error", "-nostdin"]
    if t0 > 0:
        cmd += ["-ss", f"{t0:.6f}"]
    if dur is not None:
        cmd += ["-t", f"{dur:.6f}"]
    cmd += ["-i", path, "-ac", "2" if stereo else "1", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return x.reshape(-1, 2) if stereo else x


def write_wav(path: str, x: np.ndarray) -> None:
    wavfile.write(path, SR, np.clip(x, -1.0, 1.0).astype(np.float32))


def encode_opus(wav: str, ogg: str, kbps: int, ch: int) -> None:
    run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", wav, "-ac", str(ch), "-c:a", "libopus", "-b:a", f"{kbps}k", "-vbr", "on",
         "-application", "audio", "-frame_duration", "20", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", ogg])


def decode_file(path: str, ch: int, ignore_editlist: bool = False) -> np.ndarray:
    cmd = ["ffmpeg", "-v", "error", "-nostdin"] + (["-ignore_editlist", "1"] if ignore_editlist else []) + [
        "-i", path, "-f", "f32le", "-ac", str(ch), "-ar", str(SR), "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").astype(np.float64).reshape(-1, ch)


def ebur128(path_or_arr, stereo: bool = False) -> tuple[float, float]:
    """(integrated LUFS, true peak dBTP) via ffmpeg ebur128 (-70 = undefined / too short)"""
    tmp = None
    path = path_or_arr
    if not isinstance(path_or_arr, str):
        fd, tmp = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        write_wav(tmp, path_or_arr)
        path = tmp
    try:
        r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-nostdin", "-i", path, "-af", "ebur128=peak=true", "-f", "null", "-"],
                           capture_output=True, text=True)
        txt = r.stderr
        i = re.findall(r"I:\s+(-?[\d.]+|-inf) LUFS", txt)
        pk = re.findall(r"Peak:\s+(-?[\d.]+|-inf) dBFS", txt)
        return (float(i[-1].replace("-inf", "-70")) if i else -70.0, float(pk[-1].replace("-inf", "-70")) if pk else -70.0)
    finally:
        if tmp:
            os.remove(tmp)


# ------------------------------------------- dsp ----------------------------------------------
def db2(g: float) -> float:
    return 10 ** (g / 20)


def n_of(sec: float) -> int:
    return int(round(sec * SR))


def silence(sec: float, ch: int = 1) -> np.ndarray:
    return np.zeros(n_of(sec)) if ch == 1 else np.zeros((n_of(sec), ch))


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.0) -> np.ndarray:
    y = x.copy()
    a, b = min(n_of(fin), len(y)), min(n_of(fout), len(y))
    if a > 0:
        w = np.sin(np.linspace(0, math.pi / 2, a)) ** 2
        y[:a] *= w if y.ndim == 1 else w[:, None]
    if b > 0:
        w = np.cos(np.linspace(0, math.pi / 2, b)) ** 2
        y[len(y) - b:] *= w if y.ndim == 1 else w[:, None]
    return y


def _sos(kind: str, f, order: int):
    return butter(order, f, kind, fs=SR, output="sos")


def hp(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return sosfilt(_sos("highpass", f, order), x, axis=0)


def lp(x: np.ndarray, f: float, order: int = 2) -> np.ndarray:
    return sosfilt(_sos("lowpass", f, order), x, axis=0)


def bp(x: np.ndarray, lo: float, hi: float, order: int = 2) -> np.ndarray:
    return sosfilt(_sos("bandpass", [lo, hi], order), x, axis=0)


def resample_rate(x: np.ndarray, rate: float) -> np.ndarray:
    """play `x` at `rate` (pitch and speed together, like playbackRate)"""
    if abs(rate - 1) < 1e-6:
        return x
    n = len(x)
    m = max(1, int(round(n / rate)))
    t = np.arange(m) * rate
    if x.ndim == 1:
        return np.interp(t, np.arange(n), x)
    return np.stack([np.interp(t, np.arange(n), x[:, c]) for c in range(x.shape[1])], axis=1)


def mono_of(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else x.mean(axis=1)


def mix(*parts: tuple) -> np.ndarray:
    """parts: (array, offset_s, gain_db); mono and stereo may be mixed (the result is stereo then)"""
    st = any(a.ndim == 2 for a, _, _ in parts)
    end = max(n_of(off) + len(a) for a, off, _ in parts)
    y = np.zeros((end, 2)) if st else np.zeros(end)
    for a, off, g in parts:
        o = n_of(off)
        aa = a if not st or a.ndim == 2 else np.stack([a, a], axis=1)
        y[o:o + len(aa)] += aa * db2(g)
    return y


def true_peak_db(x: np.ndarray) -> float:
    """4x-oversampled peak (dBTP), per channel"""
    xs = x if x.ndim == 2 else x[:, None]
    m = 0.0
    for c in range(xs.shape[1]):
        up = resample_poly(xs[:, c], 4, 1)
        m = max(m, float(np.abs(up).max()) if len(up) else 0.0)
    return 20 * math.log10(m + 1e-12)


def norm_tp(x: np.ndarray, target: float = TP_TARGET) -> np.ndarray:
    tp = true_peak_db(x)
    return x if tp < -90 else x * db2(target - tp)


def peak_index(x: np.ndarray) -> int:
    return int(np.argmax(np.abs(mono_of(x))))


def lead_index(x: np.ndarray, thr_db: float) -> int:
    m = np.abs(mono_of(x))
    pk = m.max()
    if pk < 1e-9:
        return 0
    idx = np.where(m >= pk * db2(thr_db))[0]
    return int(idx[0]) if len(idx) else 0


def trim_lead(x: np.ndarray, thr_db: float = -40.0, pre: float = 0.002) -> tuple[np.ndarray, float]:
    """drop leading near-silence; returns (trimmed, ms removed)"""
    i = lead_index(x, thr_db)
    a = max(0, i - n_of(pre))
    if a <= 0:
        return x, 0.0
    return fade(x[a:], 0.001, 0.0), a * 1000.0 / SR


def trim_tail(x: np.ndarray, thr_db: float = -60.0, fout: float = 0.02) -> np.ndarray:
    m = np.abs(mono_of(x))
    pk = m.max()
    if pk < 1e-9:
        return x
    idx = np.where(m > pk * db2(thr_db))[0]
    y = x[: idx[-1] + 1] if len(idx) else x
    return fade(y, 0.0, min(fout, len(y) / SR / 4))


def band_shares(x: np.ndarray) -> tuple[float, float, float]:
    """energy share <150 Hz, 150 Hz-4 kHz, >4 kHz (mono)"""
    m = mono_of(x)
    X = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(len(m), 1 / SR)
    tot = float(X.sum()) + 1e-18
    return float(X[f < 150].sum() / tot), float(X[(f >= 150) & (f < 4000)].sum() / tot), float(X[f >= 4000].sum() / tot)


def excite(x: np.ndarray, drive: float = 5.0, mix_db: float = -6.0) -> np.ndarray:
    """phone-speaker fix: harmonics of the sub band (tanh of the < 220 Hz content), kept between 280 Hz and 3 kHz, mixed
    in. A phone speaker (no output below ~300 Hz) then hears the thump's upper partials (missing-fundamental effect)."""
    lo = lp(mono_of(x) if x.ndim == 1 else x, 220, 4)
    pk = float(np.abs(lo).max()) + 1e-9
    sat = np.tanh(drive * lo / pk) * pk
    h = lp(hp(sat, 280, 4), 3000, 2)
    return x + h * db2(mix_db)


def ldb(x: np.ndarray) -> float:
    """rough perceived level: RMS (dBFS) of the loudest 400 ms after a 100 Hz high-pass + 2 kHz presence tilt"""
    y = hp(mono_of(x), 100)
    y = y + 0.4 * hp(y, 2000)
    w = min(len(y), n_of(0.4))
    if w < 16:
        return -90.0
    c = np.concatenate([[0.0], np.cumsum(y * y)])
    best = max((c[i + w] - c[i]) / w for i in range(0, len(y) - w + 1, max(1, w // 8)))
    return round(10 * math.log10(best + 1e-12), 1)


def loop_xfade(seg: np.ndarray, L: int, X: int) -> np.ndarray:
    """seamless loop of length L from a segment of >= L+X samples: the continuation seg[L:L+X] is crossfaded (equal
    power) into the head, so out[0] continues out[L-1] exactly"""
    assert len(seg) >= L + X, (len(seg), L, X)
    out = seg[:L].copy()
    a = np.linspace(0, 1, X)
    fi, fo = np.sin(a * math.pi / 2), np.cos(a * math.pi / 2)
    if seg.ndim == 2:
        fi, fo = fi[:, None], fo[:, None]
    out[:X] = seg[:X] * fi + seg[L:L + X] * fo
    return out


def step995(x: np.ndarray) -> float:
    return float(np.percentile(np.abs(np.diff(x)), 99.5)) + 1e-9


def seam_ratio(x: np.ndarray) -> float:
    """click test of a loop's wrap: |x[0] - x[-1]| over the 99.5th-percentile sample step (per channel, worst)"""
    xs = x if x.ndim == 2 else x[:, None]
    return max(abs(xs[0, c] - xs[-1, c]) / step995(xs[:, c]) for c in range(xs.shape[1]))


# ------------------------------------------- synth --------------------------------------------
def tt(dur: float) -> np.ndarray:
    return np.arange(n_of(dur)) / SR


def syn_buzzer(dur: float = 0.95) -> np.ndarray:
    """a game-show 'wrong answer' buzzer: two detuned square-ish tones (110 / 116.5 Hz) + a fifth, band-limited, with a
    fast attack and a short release (no recording of a buzzer exists in the sources: AUDIO_KIT.md gap list)"""
    t = tt(dur)
    out = np.zeros(len(t))
    for f0, a in ((110.0, 1.0), (116.5, 0.8), (164.8, 0.45)):
        k = 1
        while k * f0 < 6000:
            out += a * np.sin(2 * math.pi * k * f0 * t) / k
            k += 2
    out = lp(hp(out, 90), 4200, 2)
    env = np.clip(t / 0.006, 0, 1) * np.clip((dur - t) / 0.06, 0, 1)
    return out * env


# ------------------------------------- source lookup + credits --------------------------------
_USED: list[str] = []
_IMP_CACHE: dict[str, list[str]] = {}


def I(rel: str) -> str:
    """Imphenzia file by folder/base name (the pack suffixes each file _mono/_stereo/_loop). Some folders nest one more
    level (WHOOSHES/Air/Fast/...): the name must then match exactly one file anywhere under the given folder."""
    folder, base = os.path.split(rel)
    d = os.path.join(IMP, folder)
    if d not in _IMP_CACHE:
        _IMP_CACHE[d] = sorted(os.path.relpath(os.path.join(r, f), d).replace("\\", "/")
                               for r, _, fs in os.walk(d) for f in fs if f.lower().endswith(".wav"))
    rx = re.compile(r"^" + re.escape(base) + r"(_loop)?_(mono|stereo)(_loop)?\.wav$|^" + re.escape(base) + r"\.wav$")
    hits = [f for f in _IMP_CACHE[d] if rx.match(f.split("/")[-1])]
    if len(hits) > 1:      # "X_stereo.wav" and "X_loop_stereo.wav" both exist: the name without _loop means the plain take
        exact = [f for f in hits if re.match(r"^" + re.escape(base) + r"_(mono|stereo)\.wav$", f.split("/")[-1])]
        hits = exact if len(exact) == 1 else hits
    if len(hits) != 1:
        raise FileNotFoundError(f"Imphenzia {rel}: {hits}")
    return os.path.join(d, hits[0]).replace("\\", "/")


def S(pack: str, name: str) -> str:
    return f"{SONNISS}/{pack}/{name}"


def D(actor: str, sub: str, name: str) -> str:
    return f"{DG}/{actor}/{sub}/{name}"


def src(path: str, t0: float = 0.0, dur: float | None = None, stereo: bool = False, rate: float = 1.0,
        align: str = "lead", pre: float = 0.010, fout: float = 0.0, maxdur: float | None = None) -> np.ndarray:
    """one source layer (recorded for the credits). align='peak': start `pre` s before the loudest sample (transient
    alignment for layering; drops any pre-swing); 'lead': start 2 ms before the first sample over -40 dB of the peak;
    'none': as cut."""
    _USED.append(path)
    x = decode(path, t0, dur, stereo=stereo)
    if align == "peak":
        a = max(0, peak_index(x) - n_of(pre))
        x = fade(x[a:], 0.001, 0.0)
    elif align == "lead":
        x, _ = trim_lead(x, -40.0, 0.002)
    if maxdur is not None and len(x) > n_of(maxdur):
        x = fade(x[: n_of(maxdur)], 0.0, min(0.08, maxdur / 3))
    if fout:
        x = fade(x, 0.0, fout)
    return resample_rate(x, rate)


# ------------------------------------------- the kit -----------------------------------------
# id -> {sprite, cat, loop, variants[builders]}. Categories set the runtime level targets (router.ts CAT_TARGET_DB).
# Every id is referenced by router.ts (EVENT_SOUNDS / STATE_SOUNDS / the UI + music API); probe_audio.ts proves both
# directions. Voice banks: vo_<bank>_<kind>; banks m1 m2 m3 f1 f2 mon (router.ts FIGHTER_VOICE picks one per fighter).
def build_table() -> dict:
    T: dict = {}

    def add(sid: str, sprite: str, cat: str, *variants, loop: bool = False, excite_db: float | None = None, note: str = "") -> None:
        T[sid] = {"sprite": sprite, "cat": cat, "loop": loop, "variants": list(variants), "excite": excite_db, "note": note}

    P = lambda rel, **k: src(I(rel), align="peak", **k)          # transient-aligned Imphenzia layer
    L = lambda rel, **k: src(I(rel), **k)                        # lead-trimmed Imphenzia layer

    # -- UI (ui sprite) --
    add("ui_move", "ui", "ui", lambda: L("USER_INTERFACES/Clicks_Taps/UI_Click_Snappy"),
        lambda: L("USER_INTERFACES/Clicks_Taps/UI_Click_Distinct_Short"))
    add("ui_confirm", "ui", "ui", lambda: mix((P("IMPACTS/Punch/IMPACT_Punch_03"), 0, 0), (L("USER_INTERFACES/Clicks_Taps/UI_Click_Metallic_Bright"), 0, -4)))
    add("ui_back", "ui", "ui", lambda: L("USER_INTERFACES/Clicks_Taps/UI_Click_TapBack_01"))
    add("ui_error", "ui", "ui", lambda: L("USER_INTERFACES/Errors/UI_Error_Double_Note_Down"))
    add("ui_toggle", "ui", "ui", lambda: L("USER_INTERFACES/Toggles/UI_Toggle_Clean_Deep_Enable"),
        lambda: L("USER_INTERFACES/Toggles/UI_Toggle_Clean_Deep_Disable"))
    add("ui_start", "ui", "sting", lambda: mix((L("PUZZLES/PUZZLE_Success_Brass_Stab_Wet"), 0, 0), (L("SPORTS/Boxing/BOXING_Bell_Ring_03"), 0.0, -7)))
    add("ui_lock", "ui", "ui", lambda: mix((P("SPORTS/Boxing/BOXING_Punch_03"), 0, 0), (P("IMPACTS/Slap/SLAP_Hand_Face_03"), 0, -5),
                                           (L("PUZZLES/PUZZLE_Success_Brass_Stab_Wet"), 0.02, -9)), excite_db=-8)
    add("ui_vs", "ui", "sting", lambda: mix((L("WHOOSHES/Classic/WHOOSH_Wide_Fast"), 0, -2), (P("IMPACTS/Generic/IMPACT_Generic_04"), 0.22, 0),
                                            (L("PUZZLES/PUZZLE_Success_Brass_Fanfare_Bright_Wet"), 0.24, -3)), excite_db=-8)
    add("ui_pause", "ui", "ui", lambda: L("USER_INTERFACES/Appear_Disappear/UI_Animate_Whisper_Appear"))
    add("ui_resume", "ui", "ui", lambda: L("USER_INTERFACES/Appear_Disappear/UI_Animate_Whister_Disappear"))
    add("ui_tick", "ui", "ui", lambda: L("NOTIFICATIONS/NOTIFICATION_Metal_01", maxdur=0.35))
    add("ui_cash", "ui", "sting", lambda: L("MONEY_CASH_CURRENCY/CASH_REGISTER_Cha-ching_05"))
    add("ui_unlock", "ui", "sting", lambda: L("MUSIC_EFFECTS/Solo_Orchestral_Brass/MUSIC_EFFECT_Orchestral_Brass_Positive_02"))
    add("ui_ladder", "ui", "ui", lambda: mix((L("WHOOSHES/Classic/WHOOSH_Short_02"), 0, -3), (P("THUDS_THUMPS/THUD_Bright_01"), 0.09, 0)))

    # -- strikes (sfx sprite) --
    jabs = ["01", "02", "03", "04", "05", "06"]
    mids = ["01", "03", "10", "01", "03", "10"]
    slaps = ["01", "02", "03", "04", "05", "01"]
    add("hit_l", "sfx", "hit", *[(lambda j=j, m=m, s=s: mix((P(f"SPORTS/Boxing/BOXING_Jab_{j}"), 0, 0), (P(f"IMPACTS/Punch/IMPACT_Punch_{m}"), 0, -3),
                                                                (P(f"IMPACTS/Slap/SLAP_Hand_Face_{s}"), 0.002, -11)))
                                  for j, m, s in zip(jabs, mids, slaps)], excite_db=-7)
    kn = ["impactPunch_medium_000.ogg", "impactPunch_medium_001.ogg", "impactPunch_medium_003.ogg"]
    add("hit_m", "sfx", "hit", *[(lambda b=b, i=i, s=s, k=k: mix((P(f"SPORTS/Boxing/BOXING_Punch_{b}"), 0, 0), (P(f"IMPACTS/Punch/IMPACT_Punch_{i}"), 0, -3),
                                                                     (src(f"{K_IMP}/{k}", align="peak"), 0, -6), (P(f"BREAKS_SNAPS/SNAP_Generic_0{s}"), 0.003, -10),
                                                                     (P(f"IMPACTS/Slap/SLAP_Hand_Face_0{s}"), 0.002, -12)))
                                  for b, i, s, k in zip(["01", "03", "05", "09", "11", "04"], ["06", "13", "05", "12", "11", "04"], ["3", "4", "3", "4", "3", "4"], kn * 2)],
        excite_db=-6)
    add("hit_h", "sfx", "hit", *[(lambda i=i, b=b, t=t, c=c: mix((P(f"IMPACTS/Punch/IMPACT_Punch_{i}"), 0, 0), (P(f"SPORTS/Boxing/BOXING_Punch_{b}"), 0, -2),
                                                                     (P(f"THUDS_THUMPS/{t}"), 0.004, -5), (P(f"BREAKS_SNAPS/{c}"), 0.004, -7),
                                                                     (P("IMPACTS/Slap/SLAP_Hand_Face_01"), 0.002, -11)))
                                  for i, b, t, c in zip(["12", "05", "16", "13", "14", "04"], ["10", "06", "02", "10", "06", "02"],
                                                        ["THUD_Deep_Noisy_01", "THUD_Noisy_02", "THUD_Noisy_03", "THUD_Deep_Noisy_01", "THUD_Noisy_02", "THUD_Noisy_03"],
                                                        ["BREAK_Loud_Short_Crack", "CRACK_High_02", "BREAK_Crunch_04", "CRACK_High_04", "BREAK_Loud_Short_Crack", "CRACK_High_02"])],
        excite_db=-5)
    add("hit_sp", "sfx", "super", *[(lambda g=g, c=c: mix((P("WEAPONS/Melee/Hammer/HAMMER_Hit_Body"), 0, 0), (P(f"IMPACTS/Generic/IMPACT_Generic_{g}"), 0, -2),
                                                          (P("IMPACTS/Punch/IMPACT_Punch_12"), 0, -3), (P(f"BREAKS_SNAPS/{c}"), 0.004, -8)))
                                     for g, c in (("10", "CRACK_High_03"), ("05", "BREAK_Crunch_03"), ("16", "CRACK_High_01"))], excite_db=-5)
    add("hit_ctr", "sfx", "layer", *[(lambda c=c, w=w: mix((P(f"BREAKS_SNAPS/{c}"), 0, 0), (P(f"WHOOSHES/Mixed/WHOOSH_Whip_RR{w}"), 0.0, -4),
                                                           (P("IMPACTS/Slap/SLAP_Hand_Face_01"), 0, -6)))
                                      for c, w in (("CRACK_High_02", "1"), ("CRACK_High_04", "2"), ("SNAP_Generic_02", "3"))])
    add("hit_pun", "sfx", "layer", *[(lambda b=b: mix((P(f"BREAKS_SNAPS/{b}"), 0, 0), (P("IMPACTS/Generic/IMPACT_Generic_18"), 0, -4),
                                                      (P("EXPLOSIONS/Short/EXPLOSION_Short_Smooth_Clean_Deep", maxdur=0.9), 0.0, -10)))
                                      for b in ("BREAK_Crunch_03", "BREAK_Crunch_04")], excite_db=-6)
    add("whiff_l", "sfx", "whiff", *[(lambda r=r: L(f"WHOOSHES/Martial_Arts/MARTIAL_ARTS_Kick_Punch_RR{r}")) for r in ("12", "3", "4", "10")])
    add("whiff_m", "sfx", "whiff", *[(lambda r=r: L(f"WHOOSHES/Air/WHOOSH_Air_Fast_Bright_RR{r}")) for r in ("1", "2", "3")])
    add("whiff_h", "sfx", "whiff", *[(lambda r=r: L(f"WHOOSHES/Air/WHOOSH_Air_Slow_RR{r}")) for r in ("1", "2", "3")])
    add("block_l", "sfx", "block", *[(lambda p=p, t=t: mix((P(f"SPORTS/Boxing/BOXING_Pad_{p}"), 0, 0), (P(f"THUDS_THUMPS/THUD_Bright_0{t}"), 0.002, -5)))
                                      for p, t in (("02", "1"), ("04", "2"), ("01", "3"))], excite_db=-6)
    add("block_h", "sfx", "block", *[(lambda p=p, g=g: mix((P(f"SPORTS/Boxing/BOXING_Pad_{p}"), 0, 0), (P(f"IMPACTS/Generic/IMPACT_Generic_{g}"), 0.002, -3),
                                                           (P("IMPACTS/Metal/IMPACT_Metal_Soft_Plate_01"), 0.003, -14)))
                                      for p, g in (("02", "06"), ("04", "01"), ("01", "12"))], excite_db=-6)

    # -- grapples, defence, system verbs --
    add("throw_grab", "sfx", "body", *[(lambda f=f: mix((L(f"FABRIC_CLOTHING/FABRIC_Movement_Fast_0{f}"), 0, 0), (L("FABRIC_CLOTHING/FABRIC_Tear_05_Quick"), 0.02, -6),
                                                        (P("THUDS_THUMPS/THUD_Bright_02"), 0.01, -4))) for f in ("1", "2")], excite_db=-8)
    add("throw_slam", "sfx", "body", *[(lambda r=r: mix((P("THUDS_THUMPS/THUD_Deep_Noisy_01"), 0, 0), (P(f"IMPACTS/Bricks/IMPACT_Brick_vs_Hard_Ground_RR{r}"), 0.003, -3),
                                                        (P("IMPACTS/Generic/IMPACT_Generic_09"), 0, -3))) for r in ("1", "2")], excite_db=-5)
    add("throw_tech", "sfx", "impact", lambda: mix((P("IMPACTS/Slap/SLAP_Hand_Face_03"), 0, 0), (P("IMPACTS/Slap/SLAP_Hand_Face_05"), 0.035, -2),
                                                   (L("WHOOSHES/Classic/WHOOSH_Bright_Snap"), 0.0, -8)))
    add("parry", "sfx", "impact", *[(lambda m=m: mix((P(f"IMPACTS/Metal/IMPACT_Metal_Cling_{m}"), 0, 0), (P("SPORTS/Boxing/BOXING_Pad_02"), 0, -4),
                                                     (L("WHOOSHES/Classic/WHOOSH_Short_02"), 0, -10))) for m in ("Bright", "Clean")])
    add("parry_perfect", "sfx", "sting", lambda: mix((P("IMPACTS/Metal/IMPACT_Metal_Cling_Clean"), 0, 0), (L("NOTIFICATIONS/NOTIFICATION_Glass_01"), 0.0, -3),
                                                     (L("PUZZLES/PUZZLE_Success_Brass_Stab_Wet"), 0.05, -8), (L("ZAPS/ZAP_Reverse_01"), 0.0, -12)))
    add("impact_start", "sfx", "impact", lambda: mix((src(I("CHARGE_UPS_DOWNS/CHARGE_Complex_Wet_12_Semi_Up_500ms"), align="none"), 0, 0),
                                                     (L("WHOOSHES/Classic/WHOOSH_Wide_Deep_Slow"), 0.1, -4)), excite_db=-8)
    add("impact_armor", "sfx", "impact", *[(lambda m=m: mix((P(f"IMPACTS/Metal/IMPACT_Metal_Hard_0{m}"), 0, -2), (P("SPORTS/Boxing/BOXING_Pad_02"), 0, 0)))
                                            for m in ("1", "2")], excite_db=-7)
    add("impact_clash", "sfx", "super", lambda: mix((P("IMPACTS/Metal/IMPACT_Metal_Large_Deep_Metallic_Bang_Rattle"), 0, 0),
                                                    (P("EXPLOSIONS/Short/EXPLOSION_Short_Bright_Kickback", maxdur=1.0), 0, -4), (P("ZAPS/ZAP_Bright_01"), 0, -8)), excite_db=-6)
    add("shove", "sfx", "body", lambda: mix((L("WHOOSHES/Mixed/WHOOSH_Breath"), 0, -4), (P("SPORTS/Boxing/BOXING_Pad_04"), 0.06, 0),
                                            (P("THUDS_THUMPS/THUD_Medium_02"), 0.062, -3)), excite_db=-6)
    add("wall_splat", "sfx", "body", *[(lambda r=r, t=t: mix((P(f"IMPACTS/Bricks/IMPACT_Brick_vs_Brick_RR{r}"), 0, -1), (P(f"THUDS_THUMPS/{t}"), 0, 0),
                                                             (P("IMPACTS/Generic/IMPACT_Generic_10"), 0, -3), (P("WEAPONS/Melee/Blunt/BLUNT_Swing_Hit_Brick_01"), 0.004, -5)))
                                        for r, t in (("1", "THUD_Dark_02"), ("2", "THUD_Deep_Noisy_01"), ("3", "THUD_Dark_03_Short"))], excite_db=-4)
    add("ground_bounce", "sfx", "body", *[(lambda r=r, t=t: mix((P(f"THUDS_THUMPS/{t}"), 0, 0), (P(f"IMPACTS/Bricks/IMPACT_Brick_vs_Hard_Ground_RR{r}"), 0.002, -4),
                                                                (L("CARTOON/CARTOON_Spring_Bounce_01"), 0.03, -16)))
                                           for r, t in (("3", "THUD_Noisy_01"), ("2", "THUD_Noisy_04"))], excite_db=-6)
    add("knockdown", "sfx", "body", *[(lambda t=t, f=f, g=g: mix((P(f"THUDS_THUMPS/{t}"), 0, 0), (L(f"FABRIC_CLOTHING/FABRIC_Flap_0{f}"), 0, -6),
                                                                 (P(f"IMPACTS/Generic/IMPACT_Generic_{g}"), 0.03, -3)))
                                       for t, f, g in (("THUD_Dark_01", "1", "03"), ("THUD_Dark_03_Short", "3", "07"), ("THUD_Deep_Noisy_01", "5", "11"))], excite_db=-5)
    add("wakeup", "sfx", "foley", *[(lambda r=r: L(f"FABRIC_CLOTHING/FABRIC_Movement_Short_RR{r}")) for r in ("1", "2")])
    add("crumple", "sfx", "body", lambda: mix((P("THUDS_THUMPS/THUD_Smooth_01"), 0.25, 0), (L("FABRIC_CLOTHING/FABRIC_Movement_Long"), 0, -6)), excite_db=-6)
    add("dizzy", "sfx", "sting", lambda: mix((L("CARTOON/CARTOON_Wobble_01"), 0, 0), (src(I("HUMAN/Ringing_Ears/Ringing_Ears_Tinitus_PTSD_01"), stereo=False, maxdur=1.6), 0, -14)))

    # -- projectiles (router.ts PROJ_BY_FIGHTER picks the spawn sound) --
    add("proj_throw", "sfx", "whiff", *[(lambda r=r: L(f"WHOOSHES/Classic/WHOOSH_Fast_0{r}")) for r in ("1", "2")])
    add("proj_card", "sfx", "whiff", *[(lambda r=r: mix((L(f"CARDS/CARDS_Deal_01_RR{r}"), 0, 0), (L("WHOOSHES/Air/WHOOSH_Air_Blade_RR1"), 0.01, -6))) for r in ("1", "2")])
    add("proj_ball", "sfx", "impact", *[(lambda r=r: P(f"SPORTS/Soccer/SOCCER_Kick_Ball_0{r}")) for r in ("1", "2")])
    add("proj_zap", "sfx", "impact", lambda: mix((L("ZAPS/ZAP_Electric_01"), 0, 0), (L("ELECTRICITY/ELECTRICITY_Spark_01"), 0.02, -6)))
    add("proj_fire", "sfx", "impact", lambda: mix((L("MAGIC_SPELLS/MAGIC_SPELL_Flame_Mechanical_01", maxdur=1.2), 0, 0),
                                                 (L("MAGIC_SPELLS/MAGIC_SPELL_Flame_03"), 0.02, -6)), excite_db=-8)
    add("proj_hit", "sfx", "impact", *[(lambda g=g: mix((P(f"IMPACTS/Generic/IMPACT_Generic_{g}"), 0, 0), (P("ZAPS/ZAP_Subtle_01"), 0, -12))) for g in ("01", "06")],
        excite_db=-8)
    add("proj_clash", "sfx", "impact", lambda: mix((P("ZAPS/ZAP_Bright_02"), 0, 0), (P("IMPACTS/Metal/IMPACT_Metal_Cling_Dual_Tone"), 0, -3)))

    # -- supers, KO, meters, show --
    add("super_freeze", "sfx", "sting", lambda: mix((L("PUZZLES/PUZZLE_Success_Brass_Stab_Wet"), 0.0, 0), (L("ZAPS/ZAP_Reverse_02"), 0, -6),
                                                    (src(I("CHARGE_UPS_DOWNS/CHARGE_Complex_Wet_12_Semi_Up_500ms"), align="none"), 0, -8)))
    add("super_hit", "sfx", "super", *[(lambda e=e, c=c: mix((P(f"EXPLOSIONS/Short/{e}", maxdur=1.2), 0, -2), (P("WEAPONS/Melee/Hammer/HAMMER_Hit_Body"), 0, 0),
                                                             (P("IMPACTS/Punch/IMPACT_Punch_12"), 0, -2), (P(f"BREAKS_SNAPS/{c}"), 0.004, -7)))
                                        for e, c in (("EXPLOSION_Short_Impact_Explosion", "CRACK_High_01"), ("EXPLOSION_Short_Smooth_Clean_Kickback_Smooth_Tail", "BREAK_Crunch_03"),
                                                     ("EXPLOSION_Short_Bang_Reverb", "CRACK_High_03"))], excite_db=-5)
    add("ko_hit", "sfx", "super", lambda: mix((P("EXPLOSIONS/Short/EXPLOSION_Short_Smooth_Clean_Kickback_Smooth_Tail", maxdur=2.2), 0, -1),
                                              (P("IMPACTS/Punch/IMPACT_Punch_12"), 0, 0), (P("WEAPONS/Melee/Hammer/HAMMER_Hit_Body_Break"), 0.004, -4),
                                              (P("BREAKS_SNAPS/BREAK_Crunch_03"), 0.01, -8), (P("THUDS_THUMPS/THUD_Deep_Noisy_01"), 0.0, -3)), excite_db=-4)
    add("stage_fright", "sfx", "sting", lambda: mix((L("MUSIC_EFFECTS/Solo_Orchestral_Brass/MUSIC_EFFECT_Orchestral_Brass_Negative_03"), 0, 0),
                                                    (src(I("HUMAN/Ringing_Ears/Ringing_Ears_Tinitus_PTSD_01"), maxdur=1.8), 0.1, -12)))
    add("meter_bar", "sfx", "ui", lambda: L("NOTIFICATIONS/NOTIFICATION_Glass_05", maxdur=0.8))
    add("meter_full", "sfx", "sting", lambda: L("PUZZLES/PUZZLE_Success_Brass_Fanfare_Bright_Wet"))
    add("splat", "sfx", "splat", *[(lambda s=s: P(f"GORE_SPLATS/SPLAT_Generic_{s}", pre=0.004)) for s in ("02", "03", "01", "06")])
    add("sparks", "sfx", "splat", *[(lambda s=s: L(f"ELECTRICITY/ELECTRICITY_Spark_0{s}")) for s in ("2", "3")])
    add("confetti", "sfx", "splat", lambda: mix((L("CARTOON/POP_Mouth"), 0, 0), (L("FIREWORKS/FIREWORKS_Rocket_02_Explode_Mixed", maxdur=1.4), 0.03, -10)),
        lambda: mix((L("CARTOON/CARTOON_Plop_01"), 0, 0), (L("FIREWORKS/FIREWORKS_Rocket_04_Explode_Mixed", maxdur=1.4), 0.03, -10)))
    add("taunt", "sfx", "sting", lambda: L("CARTOON/CARTOON_Whistle_01"), lambda: L("CARTOON/LOTUS_FLUTE_Whistle_Down_Up_01"))
    # move-authored weapon / prop cues (router.ts SFX_CUE_ALIASES: slap, metal_pipe_clang, wooden_bat_crack, glass_break, explosion)
    add("slap", "sfx", "impact", *[(lambda n=n: P(f"IMPACTS/Slap/SLAP_Hand_Face_0{n}")) for n in ("1", "3", "4")])
    add("clang", "sfx", "impact", lambda: mix((P("IMPACTS/Metal/IMPACT_Metal_Hit_Metal"), 0, 0), (P("SPORTS/Boxing/BOXING_Pad_02"), 0, -8)),
        lambda: mix((P("IMPACTS/Metal/IMPACT_Metal_Cling_Deep"), 0, 0), (P("SPORTS/Boxing/BOXING_Pad_04"), 0, -8)))
    add("wood_crack", "sfx", "impact", lambda: mix((P("WEAPONS/Melee/Blunt/BLUNT_Swing_Hit_Wood_01"), 0, 0), (P("BREAKS_SNAPS/SNAP_Generic_03"), 0.004, -6)),
        lambda: mix((P("IMPACTS/Wood/IMPACT_Wood_01"), 0, 0), (P("BREAKS_SNAPS/SNAP_Generic_04"), 0.004, -6)), excite_db=-8)
    add("glass_break", "sfx", "impact", lambda: mix((L("SHATTER/SHATTER_Glass_Medium_Short_01"), 0, 0), (P("GLASS/GLASS_Hit_01"), 0, -4)))
    add("explosion", "sfx", "super", lambda: P("EXPLOSIONS/Short/EXPLOSION_Short_Messy", maxdur=1.6),
        lambda: P("EXPLOSIONS/Arcade/EXPLOSION_Arcade_05", maxdur=1.6), excite_db=-5)
    add("goon_down", "sfx", "body", *[(lambda t=t: mix((P(f"THUDS_THUMPS/{t}"), 0, 0), (L("FABRIC_CLOTHING/FABRIC_Flap_02"), 0, -8)))
                                       for t in ("THUD_Dark_02", "THUD_Noisy_03")], excite_db=-6)
    add("heckle_throw", "sfx", "whiff", *[(lambda r=r: L(f"WHOOSHES/Air/WHOOSH_Air_Very_Fast_RR{r}")) for r in ("1", "2")])
    add("heckle_smash", "sfx", "impact", *[(lambda r=r: L(f"SHATTER/SHATTER_Glass_Small_0{r}")) for r in ("1", "2")])
    add("score", "sfx", "ui", lambda: L("MONEY_CASH_CURRENCY/CASH_REGISTER_Cha-ching_02"))
    add("bell_round", "sfx", "bell", lambda: L("SPORTS/Boxing/BOXING_Bell_Ring_03"))
    add("bell_ko", "sfx", "bell", lambda: L("SPORTS/Boxing/BOXING_Bell_3_Rings_02"))
    add("bell_end", "sfx", "bell", lambda: L("SPORTS/Boxing/BOXING_Bell_2_Rings_01", maxdur=2.4))
    horn = S("Pole Position - The Vehicle Doors and More Library", "Man Lions Coach - VAR SFX - Horn Various - Mono - RSM191.wav")
    add("horn", "sfx", "bell", lambda: src(horn, 59.9, 1.0, fout=0.12), note="air-horn stand-in (coach horn); no air horn in any source")
    add("buzzer", "sfx", "bell", lambda: (_USED.append("synth"), syn_buzzer(0.95))[1], note="synthesised; no buzzer recording in any source")
    add("roar", "sfx", "voice", lambda: L("MONSTERS_CREATURES/MONSTER_Growl_Deep_04_Medium", maxdur=1.8))
    add("host_laugh", "sfx", "voice", lambda: L("VOICES/Laugh/VOICE_Male_Haha_Mocking_02"), lambda: L("VOICES/Laugh/VOICE_Male_B_Haha_Evil_01"),
        lambda: L("VOICES/Laugh/VOICE_Male_Haha_Mocking_03"))
    add("host_pos", "sfx", "sting", *[(lambda n=n: L(f"MUSIC_EFFECTS/Solo_Orchestral_Brass/MUSIC_EFFECT_Orchestral_Brass_Positive_{n}")) for n in ("01", "03", "04")])
    add("host_neg", "sfx", "sting", *[(lambda n=n: L(f"MUSIC_EFFECTS/Solo_Orchestral_Brass/MUSIC_EFFECT_Orchestral_Brass_Negative_{n}")) for n in ("05", "03")])
    add("host_fanfare", "sfx", "sting", lambda: L("PUZZLES/PUZZLE_Success_Brass_Fanfare_Wet"))

    # -- announcer (sfx sprite): Imphenzia word set; transcripts in kit_report.json (faster-whisper, offline) --
    W = "VOICES/Words_Phrases"
    ann = {"ann_ready": "Female/VOICE_FEMALE_Get_Ready_1", "ann_fight": "Male_A/VOICE_MALE_Fight_3_Aggressive",
           "ann_timeup": "Male_A/VOICE_MALE_Time's_Up_1", "ann_victory": "Male_A/VOICE_MALE_Victory_2_Aggressive",
           "ann_win": "Male_A/VOICE_MALE_You_Win_1_Aggressive", "ann_lose": "Male_A/VOICE_MALE_You_Lose_2",
           "ann_gameover": "Male_A/VOICE_MALE_Game_Over_2_Aggressive", "ann_wow": "Male_A/VOICE_MALE_Wow_2_Impressed",
           "ann_ohyeah": "Male_A/VOICE_MALE_Oh_Yeah_4_Aggressive", "ann_bonus": "Female/VOICE_FEMALE_Bonus_1",
           "ann_begin": "Female/VOICE_FEMALE_Begin_1", "ann_go": "Female/VOICE_FEMALE_Go_2_Shout",
           "ann_1": "Female/VOICE_FEMALE_1", "ann_2": "Female/VOICE_FEMALE_2", "ann_3": "Female/VOICE_FEMALE_3",
           "ann_combo_quad": "Male_A/VOICE_MALE_Combo_Quad", "ann_combo_super": "Male_A/VOICE_MALE_Combo_Super",
           "ann_combo_mega": "Male_A/VOICE_MALE_Combo_Mega", "ann_combo_ultra": "Male_A/VOICE_MALE_Combo_Ultra",
           "ann_combo_monster": "Male_A/VOICE_MALE_Combo_Monster_Aggressive"}
    # what each line says, by an offline faster-whisper small.en transcript of the source (2026-09-29, audio lane)
    said = {"ann_ready": "Get ready.", "ann_fight": "Fight!", "ann_timeup": "Time's up.", "ann_victory": "Victory!", "ann_win": "You win.",
            "ann_lose": "You loose.", "ann_gameover": "GAME OVER!", "ann_wow": "WOAH!", "ann_ohyeah": "Oh yeah!", "ann_bonus": "BONUS",
            "ann_begin": "BEGIN", "ann_go": "Go!", "ann_1": "1", "ann_2": "2.", "ann_3": "3", "ann_combo_quad": "Quad Combo",
            "ann_combo_super": "SUPER COMBO!", "ann_combo_mega": "Mega Combo!", "ann_combo_ultra": "ultra combo",
            "ann_combo_monster": "MONSTER COMBO!"}
    for sid, rel in ann.items():
        add(sid, "sfx", "ann", (lambda rel=rel: src(I(f"{W}/{rel}"), align="lead")), note=f"{rel} (transcript: {said[sid]!r})")

    # -- fighter voice banks (atk / hurt / ko) --
    VM = "VOICES/Martial_Arts_Male"
    VG = "VOICES/Grunts_Groans_Hurt"
    add("vo_m1_atk", "sfx", "voice", *[(lambda n=n: L(f"{VM}/VOICE_Martial_Art_Shout_{n}", maxdur=0.7)) for n in ("01", "04", "07", "10")])
    add("vo_m1_hurt", "sfx", "voice", *[(lambda n=n: L(f"{VG}/GRUNT_Male_Hurt_0{n}", maxdur=0.8)) for n in ("1", "2", "3", "4")])
    add("vo_m1_ko", "sfx", "voice", lambda: L(f"{VG}/GROAN_Male_Hurt_Long", maxdur=1.6))
    add("vo_m2_atk", "sfx", "voice", *[(lambda n=n: L(f"{VM}/VOICE_Martial_Art_Male_B_Shout_0{n}", maxdur=0.7)) for n in ("1", "2", "3", "4")])
    add("vo_m2_hurt", "sfx", "voice", *[(lambda n=n: L(f"{VG}/GRUNT_Male_B_Hurt_Short_0{n}", maxdur=0.8)) for n in ("1", "2", "3", "4")])
    add("vo_m2_ko", "sfx", "voice", lambda: L("VOICES/Screams/SCREAM_Male_B_03", maxdur=1.6))
    JM = "Jamaal/Stout/AA_GenericBattleSounds"
    add("vo_m3_atk", "sfx", "voice", *[(lambda n=n: src(D("Jamaal", "Stout/AA_GenericBattleSounds", f"Male_Attack_0{n}_Jamaal5.wav"), maxdur=0.7)) for n in ("1", "2", "3", "4")])
    add("vo_m3_hurt", "sfx", "voice", *[(lambda n=n: src(D("Jamaal", "Stout/AA_GenericBattleSounds", f"Male_Hurt_0{n}_Jamaal5.wav"), maxdur=0.8)) for n in ("1", "2", "3", "4")])
    add("vo_m3_ko", "sfx", "voice", lambda: src(D("Jamaal", "Stout/AA_GenericBattleSounds", "Male_Death_01_Jamaal5.wav"), maxdur=1.6))
    KK = "AA_GenericBattleSounds"
    add("vo_f1_atk", "sfx", "voice", *[(lambda n=n: src(D("KarenK", f"{KK}/Attack", f"Female_Attack_0{n}_KarenK.wav"), maxdur=0.7)) for n in ("1", "2", "3", "4")])
    add("vo_f1_hurt", "sfx", "voice", *[(lambda n=n: src(D("KarenK", f"{KK}/Hurt", f"Female_Hurt_0{n}_KarenK.wav"), maxdur=0.8)) for n in ("1", "2", "3", "4")])
    add("vo_f1_ko", "sfx", "voice", lambda: src(D("KarenK", f"{KK}/Death", "Female_Death_01_KarenK.wav"), maxdur=1.6))
    add("vo_f2_atk", "sfx", "voice", *[(lambda n=n: src(D("Kimlinh", f"{KK}/Attack", f"Female_Attack_{n}_Kimlinh.wav"), maxdur=0.7)) for n in ("01", "03", "05", "07")])
    add("vo_f2_hurt", "sfx", "voice", *[(lambda n=n: L(f"{VG}/VOICE_Female_36yo_Hurt_{n}", maxdur=0.8)) for n in ("01", "03", "05", "07")])
    add("vo_f2_ko", "sfx", "voice", lambda: src(D("Kimlinh", f"{KK}/Death", "Female_Death_01_Kimlinh.wav"), maxdur=1.6))
    MC = "MONSTERS_CREATURES"
    add("vo_mon_atk", "sfx", "voice", *[(lambda n=n: L(f"{MC}/MONSTER_Effort_0{n}", maxdur=0.8)) for n in ("1", "3", "5", "7")])
    add("vo_mon_hurt", "sfx", "voice", *[(lambda n=n: L(f"{MC}/MONSTER_Growl_Short_0{n}", maxdur=0.8)) for n in ("1", "3", "5", "7")])
    add("vo_mon_ko", "sfx", "voice", lambda: L(f"{MC}/MONSTER_Groan_Long", maxdur=1.8))

    # -- crowd (stereo sprite) --
    A = "CROWDS/Medieval_Jousting_Tournament"
    ST = lambda rel, **k: src(I(rel), stereo=True, **k)
    add("bed_low", "crowd", "bed", lambda: ST("AMBIENCES/Crowds/AMBIENCE_Public_Hall_Chatter_01_loop", align="none"), loop=True,
        note="murmur bed (designed loop); router crossfades bed_low -> bed_high with the ratings")
    add("bed_high", "crowd", "bed", lambda: decorrelate(src(I("CROWDS/Generic/CROWD_Cheer_On_01"), align="none")), loop=True,
        note="cheering bed (designed mono loop), right channel rolled half a loop for width")
    add("bed_stomp", "crowd", "bed", lambda: ST(f"{A}/AUDIENCE_Stomp_Stomp_Clap_loop", align="none"), loop=True, note="stomp-stomp-clap at peak ratings")
    add("crowd_cheer", "crowd", "crowd", *[(lambda n=n: ST(f"{A}/AUDIENCE_Claps_and_Cheers_{n}", maxdur=3.0)) for n in ("05", "07", "13")])
    add("crowd_roar", "crowd", "crowd", lambda: ST(f"{A}/AUDIENCE_Claps_and_Cheers", maxdur=3.4), lambda: ST(f"{A}/AUDIENCE_Claps_and_Cheers_06", maxdur=3.1))
    add("crowd_ooh", "crowd", "crowd", lambda: ST(f"{A}/AUDIENCE_Ohh_01", maxdur=2.3))
    add("crowd_ouch", "crowd", "crowd", lambda: ST(f"{A}/AUDIENCE_Ouch_Claps", maxdur=2.2))
    add("crowd_boo", "crowd", "crowd", lambda: ST(f"{A}/AUDIENCE_Bhoos_06_Short"), lambda: ST(f"{A}/AUDIENCE_Bhoos_01", maxdur=2.3),
        lambda: ST(f"{A}/AUDIENCE_Bhoos_05", maxdur=2.6))
    add("crowd_applause", "crowd", "crowd", lambda: ST("CROWDS/Hall/AUDIENCE_Clapping_Hall_03_Crop1", maxdur=2.7),
        lambda: ST("CROWDS/Hall/AUDIENCE_Clapping_Hall_06", maxdur=3.0))
    add("crowd_laugh", "crowd", "crowd", lambda: ST(f"{A}/AUDIENCE_Hahaha_03"), lambda: ST(f"{A}/AUDIENCE_Hahaha_01"))
    add("crowd_claps", "crowd", "crowd", lambda: ST(f"{A}/AUDIENCE_Claps_Multi_02"))
    return T


def decorrelate(x: np.ndarray) -> np.ndarray:
    """mono loop -> stereo: right = the same loop rolled by half its length (circular, so the loop stays seamless)"""
    return np.stack([x, np.roll(x, len(x) // 2)], axis=1)


# ------------------------------------------- music --------------------------------------------
# Cues cut from the FULL mixes: t0 = a bar line (bar phase measured from onset strength: full_scan in the lane
# report), `bars` whole bars, wrap crossfaded 60 ms with the continuation. Windows chosen for high, steady loudness
# (per-bar loudness std <= 0.5 dB) and matched wrap levels. Stingers are the song endings.
MUSIC = {
    "menu": {"track": "Beginning", "pack": 2, "file": TR2 + "/01_Beginning/01_TR_Beginning_FULL.wav", "bpm": 90, "t0": 156.68, "bars": 12, "loop": True, "lufs": -17.0},
    "select": {"track": "Arrival", "pack": 2, "file": TR2 + "/06_Arrival/06_TR_Arrival_FULL.wav", "bpm": 90, "t0": 48.68, "bars": 12, "loop": True, "lufs": -17.0},
    "rust_theater": {"track": "Outbreak", "pack": 2, "file": TR2 + "/02_Outbreak/02_TR_Outbreak_FULL.wav", "bpm": 100, "t0": 61.95, "bars": 16, "loop": True, "lufs": -16.0},
    "butcher_block": {"track": "Disorder", "pack": 2, "file": TR2 + "/03_Disorder/03_TR_Disorder_FULL.wav", "bpm": 100, "t0": 134.43, "bars": 16, "loop": True, "lufs": -16.0},
    "wheel_of_pain": {"track": "RETROWAVE", "pack": 1, "file": TR1 + "/07_RETROWAVE/WAV_TR_07_RETROWAVE_FULL.wav", "bpm": 100, "t0": 205.83, "bars": 16, "loop": True, "lufs": -16.0},
    "rooftop": {"track": "Electric Phase", "pack": 1, "file": TR1 + "/04_ElectricPhase/04_TR_ElectricPhase_FULL.wav", "bpm": 110, "t0": 168.54, "bars": 16, "loop": True, "lufs": -16.0},
    "control_room": {"track": "Chasm", "pack": 2, "file": TR2 + "/05_Chasm/05_TR_Chasm_FULL.wav", "bpm": 100, "t0": 144.90, "bars": 16, "loop": True, "lufs": -16.0},
    "boss": {"track": "Anxiety", "pack": 2, "file": TR2 + "/04_Anxiety/04_TR_Anxiety_FULL.wav", "bpm": 100, "t0": 51.02, "bars": 16, "loop": True, "lufs": -15.5},
    "miniboss": {"track": "Darkness Behind", "pack": 1, "file": TR1 + "/03_DarknessBehind/03_TR_DarknessBehind_FULL.wav", "bpm": 90, "t0": 126.00, "bars": 12, "loop": True, "lufs": -16.0},
    # results jingles: the last bars + ring-out of two of the same tracks (no extra track is used for them)
    "win": {"track": "Outbreak", "pack": 2, "file": TR2 + "/02_Outbreak/02_TR_Outbreak_FULL.wav", "bpm": 100, "t0": 210.75, "dur": 8.25, "loop": False, "lufs": -15.0,
            "fin": 0.03, "fout": 1.2},
    "lose": {"track": "Darkness Behind", "pack": 1, "file": TR1 + "/03_DarknessBehind/03_TR_DarknessBehind_FULL.wav", "bpm": 90, "t0": 192.67, "dur": 10.6, "loop": False,
             "lufs": -16.5, "fin": 0.03, "fout": 2.0},
}
XFADE = 0.06


def registry_key(m: dict) -> str:
    folder = os.path.basename(os.path.dirname(m["file"]))
    return f"Travis Rise/SynthWave Music Pack{' 2' if m['pack'] == 2 else ''}/{folder}"


def build_music(tmp: str, report: dict, only: str | None) -> dict:
    out = {}
    for cue, m in MUSIC.items():
        ogg = os.path.join(ASSETS, f"music_{cue}.ogg")
        if only and only != "music" and os.path.exists(ogg):
            out[cue] = report.get("music", {}).get(cue)
            continue
        _USED.append(m["file"])
        if m["loop"]:
            bar = 240.0 / m["bpm"]
            L = n_of(m["bars"] * bar)
            X = n_of(XFADE)
            seg = decode(m["file"], m["t0"], m["bars"] * bar + XFADE + 0.05, stereo=True)
            # what a bare cut (no crossfade) would click by: |last - first| over the segment's 99.5 % sample step
            raw_seam = max(abs(seg[L - 1, c] - seg[0, c]) / step995(seg[:L, c]) for c in range(2))
            x = loop_xfade(seg, L, X)
            seam = seam_ratio(x)
            bars = m["bars"]
        else:
            x = decode(m["file"], m["t0"], m["dur"], stereo=True)
            x = fade(x, m["fin"], m["fout"])
            raw_seam = seam = 0.0
            bars = 0
        i_lufs, tp = ebur128(x, True)
        gain = min(m["lufs"] - i_lufs, TP_TARGET - true_peak_db(x))
        x = x * db2(gain)
        wav = os.path.join(tmp, f"music_{cue}.wav")
        write_wav(wav, x)
        encode_opus(wav, ogg, OPUS_KBPS["music"], 2)
        dec = decode_file(ogg, 2)
        lufs_after, tp_after = ebur128(ogg, True)
        info = {"file": f"assets/music_{cue}.ogg", "seconds": round(len(x) / SR, 6), "samples": len(x), "decoded": len(dec), "bytes": os.path.getsize(ogg),
                "bpm": m["bpm"], "bars": bars, "loop": m["loop"], "lufs": round(lufs_after, 1), "tp": round(tp_after, 1), "gain_db": round(gain, 2),
                "track": m["track"], "registry": registry_key(m), "t0": m["t0"], "seam_ratio": round(seam, 3), "raw_cut_seam_ratio": round(raw_seam, 2)}
        out[cue] = info
        print(f"music {cue:14s} {m['track']:16s} {len(x) / SR:7.2f} s  {info['bytes'] / 1024:6.0f} KB  {lufs_after:6.1f} LUFS  tp {tp_after:5.1f}  "
              f"seam {seam:.2f} (raw cut {raw_seam:.1f})  decoded {len(dec)}/{len(x)}", flush=True)
    report["music"] = out
    return out


# ------------------------------------------- sprites ------------------------------------------
def circular(x: np.ndarray, f) -> np.ndarray:
    """apply filter f to a loop circularly (three back-to-back copies, keep the middle): no start-up transient at the seam"""
    n = len(x)
    return f(np.concatenate([x, x, x], axis=0))[n:2 * n]


def phone_risk(lo: float, mid: float) -> bool:
    """a sound whose energy sits below 150 Hz and barely reaches the 150 Hz-4 kHz band vanishes on a phone speaker"""
    return lo > 0.5 and mid < PHONE_MIN


def master_variant(sid: str, d: dict, i: int, builder, ch: int) -> tuple[np.ndarray, dict]:
    """build one variant and run the mastering chain; returns (samples, measurements)"""
    before = len(_USED)
    x = np.asarray(builder(), dtype=np.float64)
    used = _USED[before:]
    if ch == 2 and x.ndim == 1:
        x = np.stack([x, x], axis=1)
    if ch == 1 and x.ndim == 2:
        x = x.mean(axis=1)
    lo0, mid0, hi0 = band_shares(x)
    lead_ms = 0.0
    if not d["loop"]:
        x = trim_tail(x, -60.0)
        x = hp(x, 40.0, 2)                                # no energy below 40 Hz (phone speakers + headroom)
    else:
        X = min(n_of(0.2), len(x) // 8)
        x = loop_xfade(x, len(x) - X, X)                  # a "designed loop" still ticks at its wrap: crossfade the tail in
        x = circular(x, lambda y: hp(y, 40.0, 2))
    # phone-speaker fix: the recipe's mid layers + the exciter; stepped up while the sound is still sub-dominated
    mix_db = d["excite"]
    steps = 0
    base = x
    if mix_db is not None:
        x = excite(base, 5.0, mix_db)
    lo1, mid1, hi1 = band_shares(x)
    while d["cat"] in PHONE_CATS and phone_risk(lo1, mid1 - 0.05) and steps < 4:
        mix_db = (mix_db if mix_db is not None else -12.0) + 3.0
        steps += 1
        x = excite(base, 5.0, mix_db)
        lo1, mid1, hi1 = band_shares(x)
    if not d["loop"]:
        # lead-in trim LAST (after the high-pass + exciter moved where the sound crosses LEAD_DB), then the peak
        x, lead_ms = trim_lead(x, LEAD_DB, 0.003)
        x = norm_tp(x, TP_TARGET)
    else:
        # beds are levelled by LUFS (quiet under the fight), not peak-normalised
        i_l, _ = ebur128(x, ch == 2)
        x = x * db2(min(-20.0 - i_l, TP_TARGET - true_peak_db(x)))
    meas = {"variant": i, "sec": round(len(x) / SR, 3), "lead_trim_ms": round(lead_ms, 1), "lo_share_before": round(lo0, 3),
            "mid_share_before": round(mid0, 3), "lo_share": round(lo1, 3), "mid_share": round(mid1, 3), "hi_share": round(hi1, 3),
            "excite_db": mix_db, "excite_steps": steps, "tp_pre": round(true_peak_db(x), 2), "ldb": ldb(x),
            "sources": sorted(set(os.path.basename(u) for u in used))}
    return x, meas


def assemble(order: list, parts: dict, table: dict, ch: int) -> tuple[np.ndarray, dict]:
    """lay the mastered variants out in a sprite: [gap][v][gap]..., loops as [tail guard][loop][head guard]"""
    chunks: list[np.ndarray] = [silence(GAP, ch)]
    pos = n_of(GAP)
    where: dict = {}
    for sid in order:
        vs = []
        for x in parts[sid]:
            if table[sid]["loop"]:
                g = n_of(GUARD)
                chunks.append(x[-g:])
                pos += g
                vs.append((pos, len(x)))
                chunks.append(x)
                pos += len(x)
                chunks.append(x[:g])
                pos += g
            else:
                vs.append((pos, len(x)))
                chunks.append(x)
                pos += len(x)
            chunks.append(silence(GAP, ch))
            pos += n_of(GAP)
        where[sid] = vs
    return np.concatenate(chunks, axis=0), where


def region_peaks(dec: np.ndarray, where: dict) -> dict:
    return {sid: [true_peak_db(dec[s:s + n]) for s, n in vs] for sid, vs in where.items()}


def build_sprite(name: str, table: dict, tmp: str, report: dict) -> dict:
    ch = SPRITE_CH[name]
    order = [sid for sid, d in table.items() if d["sprite"] == name]
    parts: dict = {}
    entries: dict = {}
    for sid in order:
        d = table[sid]
        xs, meas_all, credit = [], [], set()
        for i, b in enumerate(d["variants"]):
            before = len(_USED)
            x, meas = master_variant(sid, d, i, b, ch)
            credit.update(_USED[before:])
            if d["loop"]:
                meas["seam_ratio_pcm"] = round(seam_ratio(x), 3)
            xs.append(x)
            meas_all.append(meas)
        parts[sid] = xs
        entries[sid] = {"loop": d["loop"], "cat": d["cat"], "sprite": name, "credit": sorted(credit), "measure": meas_all, "note": d["note"]}
    # encode; lossy codecs overshoot bright / noisy takes by up to ~2 dB: measure every region in the decoded Opus AND the
    # decoded AAC twin, pull the offenders down by their excess (+0.2 dB), re-encode; at most 5 passes
    ogg = os.path.join(ASSETS, f"{name}.ogg")
    tpo: dict = {}
    tpa: dict = {}
    trims = {sid: [0.0] * len(parts[sid]) for sid in order}
    for attempt in range(5):
        sprite, where = assemble(order, parts, table, ch)
        wav = os.path.join(tmp, f"{name}.wav")
        write_wav(wav, sprite)
        encode_opus(wav, ogg, OPUS_KBPS[name], ch)
        dec = decode_file(ogg, ch)
        aac_twin(ogg, AAC_KBPS[name], quiet=True)
        dec_aac = decode_file(os.path.splitext(ogg)[0] + ".m4a", ch)
        tpo, tpa = region_peaks(dec, where), region_peaks(dec_aac, where)
        fixes = 0
        for sid in order:
            for k in range(len(parts[sid])):
                excess = max(tpo[sid][k], tpa[sid][k]) - (TP_LIMIT - 0.2)
                if excess > 0:
                    parts[sid][k] = parts[sid][k] * db2(-(excess + 0.2))
                    trims[sid][k] += excess + 0.2
                    fixes += 1
        print(f"  sprite {name} pass {attempt + 1}: {fixes} regions over {TP_LIMIT - 0.2:.1f} dBTP after Opus/AAC", flush=True)
        if fixes == 0:
            break
    for sid in order:
        vs = where[sid]
        e = entries[sid]
        e["v"] = [(round(s / SR, 6), round(n / SR, 6)) for s, n in vs]
        e["n"] = [n for _, n in vs]
        for k, m in enumerate(e["measure"]):
            m["tp_opus"] = round(tpo[sid][k], 2)
            m["tp_aac"] = round(tpa[sid][k], 2)
            m["codec_trim_db"] = round(trims[sid][k], 2)
        e["ldb"] = round(float(np.mean([ldb(x) for x in parts[sid]])), 1)
    worst = max(max(max(v) for v in tpo.values()), max(max(v) for v in tpa.values()))
    info = {"file": f"assets/{name}.ogg", "channels": ch, "seconds": round(len(sprite) / SR, 6), "samples": len(sprite), "decoded": len(dec),
            "bytes": os.path.getsize(ogg), "kbps": round(os.path.getsize(ogg) * 8 / 1000 / (len(sprite) / SR), 1), "worst_region_tp": round(worst, 2),
            "passes": attempt + 1}
    print(f"sprite {name:5s}: {len(entries)} sounds, {sum(len(e['v']) for e in entries.values())} regions, {len(sprite) / SR:.2f} s, {ch} ch, "
          f"{info['kbps']} kb/s, {info['bytes'] / 1024:.0f} KB, decoded {len(dec)}/{len(sprite)}, worst region tp {worst:.2f} dBTP (Opus+AAC)", flush=True)
    report.setdefault("sprites", {})[name] = info
    report.setdefault("sounds", {}).update({k: {kk: v for kk, v in e.items() if kk not in ("credit",)} for k, e in entries.items()})
    return {"sprite": info, "entries": entries}


# ----------------------------------- AAC twins (dyefield mobile review A-A3) ----------------------
# WebKit before 18.4 (every iOS browser up to iOS 18.3) cannot decode Ogg; every Ogg output gets an AAC-LC twin encoded
# from the Ogg's OWN decode. The source is padded with silence so samples + priming is a whole number of 1024-sample
# frames: a decoder that honours the MP4 edit list returns exactly `samples`, one that ignores it returns
# samples + AAC_DELAY (engine.ts altOffset tells them apart by length). Checked here on every build.
AAC_DELAY = 1024


def _best_lag(ref: np.ndarray, x: np.ndarray, lags: range) -> int:
    a = ref.mean(axis=1)
    b = x.mean(axis=1)
    win = 2 * SR
    starts = sorted(range(AAC_DELAY + 8, max(AAC_DELAY + 9, len(a) - win - AAC_DELAY - 8), win), key=lambda s: -float(np.sum(a[s:s + win] ** 2)))[:4] or [0]
    best, best_c = 0, -2.0
    for lag in lags:
        c = 0.0
        for s in starts:
            u = a[s:s + win]
            v = b[s + lag:s + lag + len(u)]
            if len(v) < len(u):
                continue
            c += float(np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v) + 1e-12))
        if c > best_c:
            best, best_c = lag, c
    return best


def aac_twin(ogg_path: str, kbps: int, quiet: bool = False) -> dict:
    ch = int(ffprobe_json(ogg_path)["streams"][0]["channels"])
    pcm = decode_file(ogg_path, ch)
    n = len(pcm)
    pad = (-(n + AAC_DELAY)) % 1024
    samples = n + pad
    m4a = os.path.splitext(ogg_path)[0] + ".m4a"
    with tempfile.TemporaryDirectory(prefix="hp-aac-") as tmp:
        f32 = os.path.join(tmp, "src.f32")
        np.concatenate([pcm, np.zeros((pad, ch))]).astype("<f4").tofile(f32)
        run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", f32, "-c:a", "aac", "-b:a", f"{kbps}k",
             "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", "-movflags", "+faststart", m4a])
    el = decode_file(m4a, ch)
    raw = decode_file(m4a, ch, ignore_editlist=True)
    lag = _best_lag(pcm, el, range(-AAC_DELAY - 4, AAC_DELAY + 5, 1 if n < 20 * SR else 2))
    problems = []
    if len(el) != samples:
        problems.append(f"edit-list decode {len(el)} samples != {samples}")
    if len(raw) != samples + AAC_DELAY:
        problems.append(f"raw decode {len(raw)} samples != {samples} + {AAC_DELAY} priming")
    if lag != 0:
        problems.append(f"edit-list decode lines up with the Ogg at lag {lag}, not 0")
    _, tp = ebur128(m4a)
    if problems:
        raise SystemExit(f"AAC twin {os.path.basename(m4a)}: " + "; ".join(problems))
    size = os.path.getsize(m4a)
    info = {"file": "assets/" + os.path.basename(m4a), "bytes": size, "samples": samples, "delay": AAC_DELAY,
            "kbps": round(size * 8 / 1000 / (samples / SR), 1), "tp": round(tp, 2)}
    if not quiet:
        print(f"  aac twin {os.path.basename(m4a)}: {ch} ch, {samples} samples (+{pad} pad), {info['kbps']} kb/s, {size / 1024:.0f} KB, tp {tp:.1f} dBTP - exact, lag 0",
              flush=True)
    return info


# ------------------------------------------- credits ------------------------------------------
UAS = ("Standard Unity Asset Store EULA (Extension Asset): licensed to Forge Flow Labs for use embedded in the game; "
       "no standalone redistribution of the audio.")
SONNISS_LICENCE = ("Sonniss #GameAudioGDC 2024 bundle licence: royalty-free, commercial use, no attribution required; "
                   "may be embedded in a game, never redistributed as sound files.")
KENNEY_LICENCE = "Creative Commons Zero (CC0 1.0), https://creativecommons.org/publicdomain/zero/1.0/"


def pack_of(path: str) -> tuple[str, dict]:
    if path == "synth":
        return "synth", {"pack": "Procedural layers", "author": "HIT PARADE (numpy synthesis, build_audio.py)", "license": "original work"}
    if path.startswith(IMP):
        return "imphenzia", {"pack": "Universal Sound FX", "author": "Imphenzia", "source": "Unity Asset Store", "license": UAS}
    if path.startswith(DG):
        return "gooding", {"pack": "Action RPG Characters", "author": "Daniel Gooding", "source": "Unity Asset Store", "license": UAS}
    if path.startswith(SONNISS):
        folder = path[len(SONNISS) + 1:].split("/")[0]
        author, _, pack = folder.partition(" - ")
        return "sonniss:" + folder, {"pack": pack.strip(), "author": author.strip(), "source": "Sonniss #GameAudioGDC 2024 bundle", "license": SONNISS_LICENCE}
    if path.startswith(K_IMP):
        return "kenney:impact", {"pack": "Impact Sounds", "author": "Kenney (www.kenney.nl)", "source": "kenney.nl", "license": KENNEY_LICENCE}
    if path.startswith(TR2) or path.startswith(TR1):
        return "travis", {"pack": "SynthWave Music Pack / SynthWave Music Pack 2", "author": "Travis Rise", "source": "Unity Asset Store", "license": UAS}
    raise SystemExit(f"no credit rule for {path}")


def credits(sprites: dict, music: dict) -> dict:
    packs: dict[str, dict] = {}
    for sp in sprites.values():
        for sid, e in sp["entries"].items():
            for src_path in e["credit"]:
                k, meta = pack_of(src_path)
                p = packs.setdefault(k, {**meta, "files": [], "sounds": []})
                bn = os.path.basename(src_path)
                if src_path != "synth" and bn not in p["files"]:
                    p["files"].append(bn)
                if sid not in p["sounds"]:
                    p["sounds"].append(sid)
    for p in packs.values():
        p["files"].sort()
        p["sounds"].sort()
    tracks: dict[str, dict] = {}
    for cue, m in music.items():
        t = tracks.setdefault(m["track"], {"title": m["track"], "cues": [], "pack": "SynthWave Music Pack 2" if "Pack 2" in m["registry"] else "SynthWave Music Pack",
                                           "author": "Travis Rise", "source": "Unity Asset Store", "license": UAS, "registry": m["registry"]})
        t["cues"].append(cue)
    sonniss_authors = sorted({v["author"] for k, v in packs.items() if k.startswith("sonniss:")})
    lines = [
        "Music: " + ", ".join(f"\"{t}\"" for t in tracks) + " by Travis Rise (SynthWave Music Pack 1 + 2, Unity Asset Store)",
        "Sound effects, crowd and announcer: \"Universal Sound FX\" by Imphenzia (Unity Asset Store)",
        "Fighter voices: \"Action RPG Characters\" by Daniel Gooding (Unity Asset Store)",
    ]
    if any(k.startswith("kenney") for k in packs):
        lines.append("Sound effects: Kenney (www.kenney.nl), Impact Sounds (CC0)")
    if sonniss_authors:
        lines.append("Sound effects: Sonniss #GameAudioGDC 2024 bundle: " + ", ".join(sonniss_authors))
    if "synth" in packs:
        lines.append("Game-show buzzer: synthesised for HIT PARADE")
    lines.append("Motion capture: CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), created with funding from NSF EIA-0196217")
    lines.append("Character models and animations: Mixamo (Adobe)")
    return {
        "_doc": "GENERATED by runtime/src/audio/build/build_audio.py. Every audio source HIT PARADE ships (plus the motion credits the CREDITS "
                "screen shows next to them). `lines` are ready-to-show credit lines; `music` and `sfx` carry the detail.",
        "lines": lines,
        "music": list(tracks.values()),
        "sfx": sorted(packs.values(), key=lambda p: (p["author"], p["pack"])),
        "other": [
            {"what": "motion capture", "credit": "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217.",
             "source": "CMU Graphics Lab Motion Capture Database"},
            {"what": "characters + animations", "credit": "Mixamo (Adobe)", "source": "mixamo.com"},
        ],
    }


# ------------------------------------------- manifest -----------------------------------------
def ts_str(s: str) -> str:
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'") + "'"


def alt_ts(a: dict) -> str:
    return (f"alt: {{ url: new URL({ts_str('./' + a['file'])}, import.meta.url).href, file: {ts_str(a['file'])}, "
            f"bytes: {a['bytes']}, samples: {a['samples']}, delay: {a['delay']} }}")


def write_manifest(sprites: dict, music: dict, alts: dict) -> tuple[int, int]:
    ids = [sid for sp in sprites.values() for sid in sp["entries"]]
    ogg_total = sum(sp["sprite"]["bytes"] for sp in sprites.values()) + sum(m["bytes"] for m in music.values())
    aac_total = sum(a["bytes"] for a in alts.values())
    cats = sorted({e["cat"] for sp in sprites.values() for e in sp["entries"].values()})
    L: list[str] = []
    L.append("// HIT PARADE - audio manifest. GENERATED by runtime/src/audio/build/build_audio.py: do not edit by hand, fix the generator")
    L.append("// and rebuild. THREE-free, DOM-free (the URLs are plain `new URL(..., import.meta.url)`: Vite emits the hashed files,")
    L.append("// Node resolves them to file: URLs for _harness/probe_audio.ts).")
    L.append("")
    L.append("export type SfxId =\n  | " + "\n  | ".join(ts_str(i) for i in ids) + ";")
    L.append("export type SfxCategory = " + " | ".join(ts_str(c) for c in cats) + ";")
    L.append("export type SpriteId = " + " | ".join(ts_str(s) for s in sprites) + ";")
    L.append("export type MusicCueId = " + " | ".join(ts_str(c) for c in music) + ";")
    L.append("")
    L.append("/** the AAC-LC (MP4) twin of an Ogg asset, for WebKit before 18.4 (no Ogg decode): `samples` = the decode that honours")
    L.append(" *  the MP4 edit list; a decoder that ignores it returns `samples` + `delay` priming samples first (engine.ts skips them) */")
    L.append("export interface AltCodec { readonly url: string; readonly file: string; readonly bytes: number; readonly samples: number; readonly delay: number }")
    L.append("export interface SpriteEntry {")
    L.append("  readonly url: string; readonly file: string; readonly channels: number; readonly seconds: number;")
    L.append("  readonly samples: number; readonly bytes: number; readonly alt: AltCodec;")
    L.append("}")
    L.append("export interface SfxEntry {")
    L.append("  readonly sprite: SpriteId;")
    L.append("  /** variants: [start s, duration s] inside the sprite */")
    L.append("  readonly v: readonly (readonly [number, number])[];")
    L.append("  /** variant lengths in samples at SAMPLE_RATE (exact) */")
    L.append("  readonly n: readonly number[];")
    L.append("  readonly loop: boolean;")
    L.append("  readonly cat: SfxCategory;")
    L.append("  /** perceived level of the mastered take (dBFS RMS of its loudest 400 ms); the router levels by category */")
    L.append("  readonly ldb: number;")
    L.append("}")
    L.append("export interface MusicEntry {")
    L.append("  readonly url: string; readonly file: string; readonly alt: AltCodec;")
    L.append("  readonly seconds: number; readonly samples: number; readonly bytes: number;")
    L.append("  /** looping cues: whole bars at `bpm`; stingers play once */")
    L.append("  readonly loop: boolean; readonly bpm: number; readonly bars: number;")
    L.append("  readonly lufs: number; readonly track: string;")
    L.append("}")
    L.append("")
    L.append(f"export const SAMPLE_RATE = {SR};")
    L.append("/** s of wrap-around written before and after every loop region (seam.ts crossfades the head from it) */")
    L.append(f"export const SPRITE_GUARD_S = {GUARD};")
    L.append("")
    L.append("export const SPRITES: { readonly [K in SpriteId]: SpriteEntry } = {")
    for name, sp in sprites.items():
        s = sp["sprite"]
        L.append(f"  {name}: {{ url: new URL({ts_str('./' + s['file'])}, import.meta.url).href, file: {ts_str(s['file'])}, channels: {s['channels']}, "
                 f"seconds: {s['seconds']}, samples: {s['samples']}, bytes: {s['bytes']}, {alt_ts(alts[s['file']])} }},")
    L.append("};")
    L.append("")
    L.append("export const SFX: { readonly [K in SfxId]: SfxEntry } = {")
    for sp in sprites.values():
        for sid, e in sp["entries"].items():
            v = ", ".join(f"[{s}, {d}]" for s, d in e["v"])
            n = ", ".join(str(x) for x in e["n"])
            L.append(f"  {sid}: {{ sprite: {ts_str(e['sprite'])}, v: [{v}], n: [{n}], loop: {'true' if e['loop'] else 'false'}, cat: {ts_str(e['cat'])}, ldb: {e['ldb']} }},")
    L.append("};")
    L.append("")
    L.append("export const MUSIC: { readonly [K in MusicCueId]: MusicEntry } = {")
    for cue, m in music.items():
        L.append(f"  {cue}: {{")
        L.append(f"    url: new URL({ts_str('./' + m['file'])}, import.meta.url).href, file: {ts_str(m['file'])},")
        L.append(f"    {alt_ts(alts[m['file']])},")
        L.append(f"    seconds: {m['seconds']}, samples: {m['samples']}, bytes: {m['bytes']},")
        L.append(f"    loop: {'true' if m['loop'] else 'false'}, bpm: {m['bpm']}, bars: {m['bars']}, lufs: {m['lufs']}, track: {ts_str(m['track'])},")
        L.append("  },")
    L.append("};")
    L.append("")
    L.append("/** every shipped Ogg byte (sprites + music) */")
    L.append(f"export const AUDIO_PAYLOAD_BYTES = {ogg_total};")
    L.append("/** the AAC twins' bytes (a device downloads one set: Ogg, or these on WebKit before 18.4) */")
    L.append(f"export const AUDIO_ALT_PAYLOAD_BYTES = {aac_total};")
    L.append("/** CONTRACT s9 budget: Ogg + AAC together (everything dist/ carries) */")
    L.append(f"export const AUDIO_BUDGET_BYTES = {PAYLOAD_BUDGET};")
    L.append(f"/** tracks registered for the slug `{SLUG}` in state/music_assignments.json */")
    L.append("export const REGISTERED_TRACKS = [" + ", ".join(ts_str(t) for t in sorted({m['registry'] for m in music.values()})) + "] as const;")
    L.append("")
    with open(MANIFEST_TS, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(L))
    return ogg_total, aac_total


# ------------------------------------------- registry -----------------------------------------
def register(music: dict) -> dict:
    """add this game's tracks to state/music_assignments.json (keeps the file's format; `used` counts +1 per newly
    registered track; idempotent: a second run changes nothing)"""
    with open(REGISTRY, "rb") as fb:
        raw = fb.read().decode("utf-8")
    reg = json.loads(raw)
    # keep the file's own format: indent width, line endings, trailing newline (the file is shared by every game)
    m_ind = re.search(r"\n( +)\"", raw)
    indent = len(m_ind.group(1)) if m_ind else 1
    eol = "\r\n" if "\r\n" in raw else "\n"
    trailing = raw.endswith("\n")
    want = sorted({m["registry"] for m in music.values()})
    have = reg["assignments"].get(SLUG) or []
    clash = {t: [s for s, v in reg["assignments"].items() if s != SLUG and (v == t or (isinstance(v, list) and t in v))] for t in want}
    clash = {t: s for t, s in clash.items() if s}
    if clash:
        raise SystemExit(f"music already assigned to other slugs: {clash}")
    added = [t for t in want if t not in have]
    for t in added:
        reg["used"][t] = reg["used"].get(t, 0) + 1
    reg["assignments"][SLUG] = want
    text = json.dumps(reg, indent=indent).replace("\n", eol) + (eol if trailing else "")
    if text != raw:
        with open(REGISTRY, "wb") as fb:
            fb.write(text.encode("utf-8"))
    return {"registered": want, "added": added, "format": {"indent": indent, "eol": "CRLF" if eol == "\r\n" else "LF", "trailing_newline": trailing}}


# ------------------------------------------- gates --------------------------------------------
def gates(sprites: dict, music: dict, alts: dict, ogg_total: int, aac_total: int) -> list[str]:
    bad = []
    for name, sp in sprites.items():
        s = sp["sprite"]
        if s["decoded"] != s["samples"]:
            bad.append(f"sprite {name}: decoded {s['decoded']} != {s['samples']} samples")
        for sid, e in sp["entries"].items():
            for m in e["measure"]:
                if max(m["tp_opus"], m["tp_aac"]) > TP_LIMIT:
                    bad.append(f"{sid}#{m['variant']}: decoded tp Opus {m['tp_opus']} / AAC {m['tp_aac']} dBTP > {TP_LIMIT}")
                if e["cat"] in PHONE_CATS and phone_risk(m["lo_share"], m["mid_share"]):
                    bad.append(f"{sid}#{m['variant']}: sub-dominated ({m['lo_share']} < 150 Hz), 150 Hz-4 kHz share {m['mid_share']} < {PHONE_MIN}")
                if not e["loop"]:
                    lead, sil = m.get("lead_after_ms", 0), m.get("silence_after_ms", 0)
                    if e["cat"] in SOFT_CATS:
                        if sil > LEAD_GATE_MS or lead > SOFT_ONSET_MS:
                            bad.append(f"{sid}#{m['variant']}: dead air {sil} ms (to {SILENCE_DB:.0f} dB) / onset {lead} ms (to {LEAD_DB:.0f} dB), decoded Opus")
                    elif lead > LEAD_GATE_MS:
                        bad.append(f"{sid}#{m['variant']}: lead-in {lead} ms (to {LEAD_DB:.0f} dB of the peak, decoded Opus) - an impact must land on its frame")
                if e["loop"] and m.get("seam_ratio_pcm", 0) > 1.5:
                    bad.append(f"{sid}#{m['variant']}: loop seam {m['seam_ratio_pcm']}x")
    for cue, m in music.items():
        if m["decoded"] != m["samples"]:
            bad.append(f"music {cue}: decoded {m['decoded']} != {m['samples']}")
        if m["tp"] > TP_LIMIT:
            bad.append(f"music {cue}: tp {m['tp']} dBTP")
        if m["loop"] and m["seam_ratio"] > 1.5:
            bad.append(f"music {cue}: seam {m['seam_ratio']}x")
    for f, a in alts.items():
        if a["tp"] > TP_LIMIT:
            bad.append(f"{a['file']}: tp {a['tp']} dBTP")
    if ogg_total + aac_total > PAYLOAD_BUDGET:
        bad.append(f"payload {ogg_total + aac_total} B > {PAYLOAD_BUDGET} B")
    return bad


def measure_leads(sprites: dict) -> None:
    """lead-in of the finished variants in the decoded Opus, per region: first sample over LEAD_DB (onset) and over
    SILENCE_DB (end of dead air) of the region's peak"""
    for name, sp in sprites.items():
        dec = decode_file(os.path.join(ASSETS, f"{name}.ogg"), SPRITE_CH[name])
        for sid, e in sp["entries"].items():
            for k, ((st, _), n) in enumerate(zip(e["v"], e["n"])):
                seg = dec[int(round(st * SR)): int(round(st * SR)) + n]
                e["measure"][k]["lead_after_ms"] = round(lead_index(seg, LEAD_DB) * 1000 / SR, 1)
                e["measure"][k]["silence_after_ms"] = round(lead_index(seg, SILENCE_DB) * 1000 / SR, 1)


def check_only() -> int:
    """re-evaluate every gate from the shipped assets + kit_report.json (no rebuild): decoded lead-ins re-measured"""
    with open(REPORT_JSON, encoding="utf-8") as f:
        report = json.load(f)
    sprites: dict = {}
    for name, info in report["sprites"].items():
        entries = {sid: e for sid, e in report["sounds"].items() if e.get("sprite") == name}
        sprites[name] = {"sprite": info, "entries": entries}
    measure_leads(sprites)
    alts = report["alts"]
    ogg_total = sum(sp["sprite"]["bytes"] for sp in sprites.values()) + sum(m["bytes"] for m in report["music"].values())
    aac_total = sum(a["bytes"] for a in alts.values())
    for f_ in list(sprites.values()):
        for sid, e in f_["entries"].items():
            report["sounds"][sid]["measure"] = e["measure"]
    bad = gates(sprites, report["music"], alts, ogg_total, aac_total)
    report["gates"] = {"pass": not bad, "problems": bad}
    with open(REPORT_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1, ensure_ascii=True)
        f.write("\n")
    print(f"payload: Ogg {ogg_total / 1e6:.3f} MB + AAC {aac_total / 1e6:.3f} MB = {(ogg_total + aac_total) / 1e6:.3f} MB (budget {PAYLOAD_BUDGET / 1e6:.0f} MB)")
    print("GATES " + ("PASS" if not bad else "FAIL:\n  " + "\n  ".join(bad)))
    return 0 if not bad else 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--register", action="store_true", help="register the music in state/music_assignments.json")
    ap.add_argument("--only", choices=["ui", "sfx", "crowd", "music"], default=None)
    ap.add_argument("--check", action="store_true", help="only re-evaluate the gates on the shipped assets (no rebuild)")
    a = ap.parse_args()
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            print(f"{tool} not on PATH")
            return 1
    if a.check:
        return check_only()
    os.makedirs(ASSETS, exist_ok=True)
    prev = {}
    if a.only and os.path.exists(REPORT_JSON):
        with open(REPORT_JSON, encoding="utf-8") as f:
            prev = json.load(f)
    report: dict = {"music": prev.get("music", {})}
    table = build_table()
    sprites: dict = {}
    with tempfile.TemporaryDirectory(prefix="hp-audio-") as tmp:
        music = build_music(tmp, report, a.only)
        for name in ("ui", "sfx", "crowd"):
            sprites[name] = build_sprite(name, table, tmp, report)
    measure_leads(sprites)
    # drop stale outputs, then the AAC twins of every Ogg
    keep = {f"{n}.ogg" for n in sprites} | {os.path.basename(m["file"]) for m in music.values()}
    keep |= {os.path.splitext(k)[0] + ".m4a" for k in keep}
    for f in os.listdir(ASSETS):
        if f not in keep:
            os.remove(os.path.join(ASSETS, f))
    alts = {}
    for name in sprites:
        alts[f"assets/{name}.ogg"] = aac_twin(os.path.join(ASSETS, f"{name}.ogg"), AAC_KBPS[name])
    for cue, m in music.items():
        alts[m["file"]] = aac_twin(os.path.join(ASSETS, os.path.basename(m["file"])), AAC_KBPS["music"])
    ogg_total, aac_total = write_manifest(sprites, music, alts)
    cr = credits(sprites, music)
    with open(CREDITS_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(cr, f, indent=2, ensure_ascii=True)
        f.write("\n")
    report["alts"] = alts
    report["payload"] = {"ogg_bytes": ogg_total, "aac_bytes": aac_total, "total_bytes": ogg_total + aac_total, "budget_bytes": PAYLOAD_BUDGET}
    for name, sp in sprites.items():
        for sid, e in sp["entries"].items():
            report["sounds"][sid]["measure"] = e["measure"]
    if a.register:
        report["registry"] = register(music)
        print(f"registry: {report['registry']}")
    bad = gates(sprites, music, alts, ogg_total, aac_total)
    report["gates"] = {"pass": not bad, "problems": bad}
    with open(REPORT_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, indent=1, ensure_ascii=True)
        f.write("\n")
    print(f"payload: Ogg {ogg_total / 1e6:.3f} MB + AAC {aac_total / 1e6:.3f} MB = {(ogg_total + aac_total) / 1e6:.3f} MB (budget {PAYLOAD_BUDGET / 1e6:.0f} MB)")
    print("GATES " + ("PASS" if not bad else "FAIL:\n  " + "\n  ".join(bad)))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
