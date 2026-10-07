"""ITU-R BS.1770-4 loudness meter: K-weighting, momentary (400 ms), short-term (3 s), gated
integrated loudness (−70 LUFS absolute, −10 LU relative), loudness range (EBU Tech 3342) and
true peak by 4× oversampling (windowed-sinc polyphase interpolator).

All at 48 kHz, where the standard's published K-weighting coefficients apply exactly.
Validated against ffmpeg's ebur128 filter (audio/qa/validate_meter.py).
"""
from __future__ import annotations

import math

import numpy as np

from .core import SR, stereo
from .filters import apply, fft_convolve

# BS.1770-4 Table 1/2 (48 kHz)
K_PRE = (np.array([1.53512485958697, -2.69169618940638, 1.19839281085285]),
         np.array([1.0, -1.69065929318241, 0.73248077421585]))
K_RLB = (np.array([1.0, -2.0, 1.0]),
         np.array([1.0, -1.99004745483398, 0.99007225036621]))


def k_weight(x: np.ndarray, circular: bool = False) -> np.ndarray:
    return apply(stereo(x), [K_PRE, K_RLB], circular=circular)


def _lufs(ms: np.ndarray | float) -> np.ndarray | float:
    return -0.691 + 10.0 * np.log10(np.maximum(ms, 1e-20))


def _power(x: np.ndarray, circular: bool = False) -> np.ndarray:
    k = k_weight(x, circular)
    return np.sum(k * k, axis=0)          # channel weights L = R = 1


def _windows(p: np.ndarray, win: int, hop: int) -> np.ndarray:
    if p.size < win:
        return np.array([])
    cs = np.concatenate([[0.0], np.cumsum(p)])
    starts = np.arange(0, p.size - win + 1, hop)
    return (cs[starts + win] - cs[starts]) / win


def integrated(x: np.ndarray, circular: bool = False) -> float:
    """Gated integrated loudness (LUFS). circular=True measures a loop as it plays (wrapped)."""
    p = _power(x, circular)
    if circular:
        p = np.concatenate([p, p[:int(0.4 * SR)]])
    z = _windows(p, int(0.4 * SR), int(0.1 * SR))
    if z.size == 0:
        z = np.array([np.mean(p)]) if p.size else np.array([1e-20])
    l = _lufs(z)
    z1 = z[l > -70.0]
    if z1.size == 0:
        return -math.inf
    rel = _lufs(np.mean(z1)) - 10.0
    z2 = z[(l > -70.0) & (l > rel)]
    return float(_lufs(np.mean(z2))) if z2.size else -math.inf


def momentary(x: np.ndarray, hop_s: float = 0.01) -> np.ndarray:
    """Momentary loudness series (400 ms), zero-padded so short sounds are measured fully."""
    pad = int(0.4 * SR)
    p = np.pad(_power(x), (pad, pad))
    return _lufs(_windows(p, int(0.4 * SR), max(1, int(hop_s * SR))))


def short_term(x: np.ndarray, hop_s: float = 0.1, circular: bool = False) -> np.ndarray:
    p = _power(x, circular)
    if circular:
        p = np.concatenate([p, p[:3 * SR]])
    else:
        p = np.pad(p, (3 * SR, 3 * SR))
    return _lufs(_windows(p, 3 * SR, max(1, int(hop_s * SR))))


def max_momentary(x: np.ndarray) -> float:
    m = momentary(x)
    return float(np.max(m)) if m.size else -math.inf


def max_short_term(x: np.ndarray, circular: bool = False) -> float:
    s = short_term(x, circular=circular)
    return float(np.max(s)) if s.size else -math.inf


def loudness_range(x: np.ndarray, circular: bool = False) -> float:
    """EBU Tech 3342 LRA (LU): 10th–95th percentile of gated short-term loudness."""
    p = _power(x, circular)
    if circular:
        p = np.concatenate([p, p[:3 * SR]])
    st = _lufs(_windows(p, 3 * SR, int(0.1 * SR)))
    st = st[st > -70.0]
    if st.size < 2:
        return 0.0
    rel = _lufs(np.mean(10 ** ((st + 0.691) / 10))) - 20.0
    st = st[st > rel]
    if st.size < 2:
        return 0.0
    return float(np.percentile(st, 95) - np.percentile(st, 10))


# ── true peak ────────────────────────────────────────────────────────────────────────────────────
def _interp_kernel(up: int = 4, taps_per_phase: int = 48) -> np.ndarray:
    n = up * taps_per_phase
    t = (np.arange(n) - (n - 1) / 2) / up
    h = np.sinc(t) * np.kaiser(n, 8.0)
    return h


_KERNEL = _interp_kernel()


def true_peak(x: np.ndarray, circular: bool = False) -> float:
    """dBTP via 4× polyphase windowed-sinc oversampling (BS.1770-4 Annex 2 method)."""
    xs = stereo(x)
    best = float(np.max(np.abs(xs))) if xs.size else 0.0
    up = 4
    for ch in range(xs.shape[0]):
        sig = xs[ch]
        for ph in range(up):
            h = _KERNEL[ph::up]
            if circular:
                y = fft_convolve(sig, h, circular=True)
            else:
                y = fft_convolve(sig, h, full=True)
            best = max(best, float(np.max(np.abs(y))))
    return 20.0 * math.log10(best) if best > 0 else -math.inf


def sample_peak_db(x: np.ndarray) -> float:
    p = float(np.max(np.abs(x))) if x.size else 0.0
    return 20.0 * math.log10(p) if p > 0 else -math.inf


def dc_offset(x: np.ndarray) -> float:
    return float(np.max(np.abs(np.mean(stereo(x), axis=1))))
