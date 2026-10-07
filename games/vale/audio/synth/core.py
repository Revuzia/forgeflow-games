"""VALE audio synth — core helpers (lane AUDIO).

Everything in audio/synth is ORIGINAL synthesis written for VALE: numpy only (+ ffmpeg for encoding,
Pillow for QA images). No samples, no sound packs, no imported music.

Conventions
  * SR = 48 000 Hz. Mono signals are 1-D float64 arrays; stereo signals are (2, n) arrays.
  * Levels are linear amplitude unless a name ends in _db.
  * Every random choice comes from `rng(name)`, a generator seeded from a stable hash of a string,
    so a rebuild is bit-identical (deterministic like the art pipeline).
"""
from __future__ import annotations

import math
import re
import zlib

import numpy as np

SR = 48000
TAU = 2.0 * np.pi

# ── deterministic randomness ─────────────────────────────────────────────────────────────────────
def rng(name: str, salt: int = 0) -> np.random.Generator:
    """A generator seeded from a stable hash of `name` (crc32, not Python's salted hash())."""
    return np.random.default_rng((zlib.crc32(name.encode('utf8')) << 8) ^ (salt & 0xFFFFFFFF))


# ── pitch ────────────────────────────────────────────────────────────────────────────────────────
_NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
_NOTE_RE = re.compile(r'^([A-Ga-g])([#b]*)(-?\d+)$')


def midi(note: str | int | float) -> float:
    """'A4' → 69, 'F#5' → 78, 'Bb3' → 58; numbers pass through."""
    if isinstance(note, (int, float, np.integer, np.floating)):
        return float(note)
    m = _NOTE_RE.match(note.strip())
    if not m:
        raise ValueError(f'bad note {note!r}')
    letter, acc, octave = m.groups()
    n = _NOTE[letter.upper()] + acc.count('#') - acc.count('b')
    return float(n + 12 * (int(octave) + 1))


def hz(note: str | int | float) -> float:
    """Equal-tempered frequency, A4 = 440 Hz."""
    return 440.0 * 2.0 ** ((midi(note) - 69.0) / 12.0)


def transpose(note: str | float, semis: float) -> float:
    return midi(note) + semis


# D Dorian with the Lydian G# colour (STYLE_BIBLE "Audio"; tokens.audio.key / colourTone)
DORIAN = ['D', 'E', 'F', 'G', 'A', 'B', 'C']
LYDIAN_COLOUR = 'G#'


def scale_note(degree: int, octave: int = 4, scale: list[str] = DORIAN) -> str:
    """Degree 0 = D. Negative/large degrees wrap octaves (degree 7 = D one octave up)."""
    o, d = divmod(degree, len(scale))
    name = scale[d]
    # octave numbers change at C: D..B of a D-rooted scale stay in `octave`, C goes up one
    oct_ = octave + o + (1 if name[0] == 'C' else 0)
    return f'{name}{oct_}'


# ── levels ───────────────────────────────────────────────────────────────────────────────────────
def db(x_db: float) -> float:
    return 10.0 ** (x_db / 20.0)


def to_db(x: float, floor: float = -150.0) -> float:
    return 20.0 * math.log10(x) if x > 10 ** (floor / 20) else floor


def peak(x: np.ndarray) -> float:
    return float(np.max(np.abs(x))) if x.size else 0.0


# ── time / buffers ───────────────────────────────────────────────────────────────────────────────
def ns(seconds: float) -> int:
    return int(round(seconds * SR))


def tvec(n: int) -> np.ndarray:
    return np.arange(n) / SR


def stereo(x: np.ndarray) -> np.ndarray:
    """Mono → (2, n); stereo passes through."""
    if x.ndim == 1:
        return np.vstack([x, x])
    return x


def mono(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else 0.5 * (x[0] + x[1])


def pan(x: np.ndarray, p: float) -> np.ndarray:
    """Equal-power pan of a mono signal (p in −1 … +1) → (2, n). Stereo input is balanced."""
    a = (p + 1.0) * 0.25 * np.pi
    gl, gr = math.cos(a) * math.sqrt(2.0), math.sin(a) * math.sqrt(2.0)
    if x.ndim == 1:
        return np.vstack([x * gl, x * gr])
    return np.vstack([x[0] * min(1.0, gl), x[1] * min(1.0, gr)])


def width(x: np.ndarray, w: float) -> np.ndarray:
    """Mid/side width: 0 = mono, 1 = unchanged, >1 wider."""
    x = stereo(x)
    m = 0.5 * (x[0] + x[1])
    s = 0.5 * (x[0] - x[1]) * w
    return np.vstack([m + s, m - s])


def silence(seconds: float, ch: int = 2) -> np.ndarray:
    n = ns(seconds)
    return np.zeros((ch, n)) if ch == 2 else np.zeros(n)


def add_at(buf: np.ndarray, sig: np.ndarray, start: int, wrap: bool = False) -> None:
    """Mix `sig` into `buf` at sample `start`. wrap=True folds overflow back to the start
    (render-with-tail-wrap for seamless loops); otherwise overflow is dropped."""
    if buf.ndim == 2 and sig.ndim == 1:
        sig = stereo(sig)
    n = buf.shape[-1]
    m = sig.shape[-1]
    if wrap:
        start %= n
        pos = 0
        while pos < m:
            s = (start + pos) % n
            take = min(m - pos, n - s)
            buf[..., s:s + take] += sig[..., pos:pos + take]
            pos += take
        return
    if start >= n or start + m <= 0:
        return
    a, b = max(0, start), min(n, start + m)
    buf[..., a:b] += sig[..., a - start:b - start]


def fit(x: np.ndarray, n: int) -> np.ndarray:
    """Pad with zeros or truncate to n samples."""
    m = x.shape[-1]
    if m == n:
        return x
    if m > n:
        return x[..., :n]
    pad = [(0, 0)] * (x.ndim - 1) + [(0, n - m)]
    return np.pad(x, pad)


def fade(x: np.ndarray, fin: float = 0.0, fout: float = 0.0, shape: str = 'cos') -> np.ndarray:
    """Apply fade-in / fade-out (seconds). Returns a new array."""
    y = x.copy()
    n = y.shape[-1]
    for secs, is_in in ((fin, True), (fout, False)):
        k = min(n, ns(secs))
        if k <= 1:
            continue
        r = np.linspace(0.0, 1.0, k)
        g = 0.5 - 0.5 * np.cos(np.pi * r) if shape == 'cos' else r ** 2 if shape == 'exp' else r
        if is_in:
            y[..., :k] *= g
        else:
            y[..., n - k:] *= g[::-1]
    return y


def trim_tail(x: np.ndarray, floor_db: float = -70.0, fout: float = 0.02, min_len: float = 0.0) -> np.ndarray:
    """Cut trailing samples quieter than floor_db (relative to full scale), with a short fade."""
    a = np.abs(stereo(x)).max(axis=0)
    thr = db(floor_db)
    idx = np.nonzero(a > thr)[0]
    end = int(idx[-1]) + 1 if idx.size else 1
    end = max(end, ns(min_len))
    end = min(end + ns(fout), x.shape[-1])
    return fade(x[..., :end], 0.0, fout)


def next_fast_len(n: int) -> int:
    """Smallest 2^a 3^b 5^c >= n (fast FFT length)."""
    best = 1 << (max(n - 1, 1)).bit_length()
    f5 = 1
    while f5 < best:
        f35 = f5
        while f35 < best:
            f = f35
            while f < n:
                f *= 2
            if f < best:
                best = f
            f35 *= 3
        f5 *= 5
    return best


def humanise_time(r: np.random.Generator, ms: float = 8.0) -> float:
    """Gaussian timing offset in seconds, clipped to ±2σ (tokens.audio.humanise.timingMs)."""
    return float(np.clip(r.normal(0.0, ms / 2000.0), -ms / 1000.0, ms / 1000.0))


def humanise_vel(r: np.random.Generator, db_: float = 2.0) -> float:
    return db(float(np.clip(r.normal(0.0, db_ / 2.0), -db_, db_)))
