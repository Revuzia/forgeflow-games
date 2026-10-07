"""Filters: RBJ biquads (applied exactly in the frequency domain or sample by sample), a
time-varying TPT state-variable filter, one-poles, modal resonator banks, FFT convolution and an
STFT time-varying spectral filter.

Why the frequency domain: numpy has no lfilter. A stable biquad's output equals the input convolved
with its (decaying) impulse response, so multiplying the zero-padded spectrum by the exact complex
response H(e^jw) reproduces the causal IIR to within the truncated tail. circular=True skips the
padding on purpose: a loop then sees its own tail wrapped to the start, which is exactly what a
seamless loop needs.
"""
from __future__ import annotations

import math

import numpy as np

from .core import SR, TAU, next_fast_len

Biquad = tuple[np.ndarray, np.ndarray]   # (b[3], a[3]) with a[0] == 1


# ── RBJ cookbook designs ─────────────────────────────────────────────────────────────────────────
def _norm(b, a) -> Biquad:
    b = np.asarray(b, float) / a[0]
    a = np.asarray(a, float) / a[0]
    return b, a


def _w0(f: float) -> tuple[float, float, float]:
    f = min(max(f, 1.0), SR * 0.49)
    w = TAU * f / SR
    return w, math.cos(w), math.sin(w)


def lowpass(f: float, q: float = 0.7071) -> Biquad:
    w, c, s = _w0(f); al = s / (2 * q)
    return _norm([(1 - c) / 2, 1 - c, (1 - c) / 2], [1 + al, -2 * c, 1 - al])


def highpass(f: float, q: float = 0.7071) -> Biquad:
    w, c, s = _w0(f); al = s / (2 * q)
    return _norm([(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al])


def bandpass(f: float, q: float = 1.0) -> Biquad:
    """Constant 0 dB peak gain band-pass."""
    w, c, s = _w0(f); al = s / (2 * q)
    return _norm([al, 0, -al], [1 + al, -2 * c, 1 - al])


def notch(f: float, q: float = 1.0) -> Biquad:
    w, c, s = _w0(f); al = s / (2 * q)
    return _norm([1, -2 * c, 1], [1 + al, -2 * c, 1 - al])


def peaking(f: float, gain_db: float, q: float = 1.0) -> Biquad:
    w, c, s = _w0(f); al = s / (2 * q); A = 10 ** (gain_db / 40)
    return _norm([1 + al * A, -2 * c, 1 - al * A], [1 + al / A, -2 * c, 1 - al / A])


def lowshelf(f: float, gain_db: float, slope: float = 1.0) -> Biquad:
    w, c, s = _w0(f); A = 10 ** (gain_db / 40)
    al = s / 2 * math.sqrt((A + 1 / A) * (1 / slope - 1) + 2); k = 2 * math.sqrt(A) * al
    return _norm([A * ((A + 1) - (A - 1) * c + k), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - k)],
                 [(A + 1) + (A - 1) * c + k, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - k])


def highshelf(f: float, gain_db: float, slope: float = 1.0) -> Biquad:
    w, c, s = _w0(f); A = 10 ** (gain_db / 40)
    al = s / 2 * math.sqrt((A + 1 / A) * (1 / slope - 1) + 2); k = 2 * math.sqrt(A) * al
    return _norm([A * ((A + 1) + (A - 1) * c + k), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - k)],
                 [(A + 1) - (A - 1) * c + k, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - k])


def allpass(f: float, q: float = 0.7071) -> Biquad:
    w, c, s = _w0(f); al = s / (2 * q)
    return _norm([1 - al, -2 * c, 1 + al], [1 + al, -2 * c, 1 - al])


# ── frequency responses ──────────────────────────────────────────────────────────────────────────
def response(filters: list[Biquad], nfft: int) -> np.ndarray:
    """Complex response of a biquad cascade at the rfft bins of an nfft-point FFT."""
    w = TAU * np.arange(nfft // 2 + 1) / nfft
    z1 = np.exp(-1j * w)
    z2 = z1 * z1
    h = np.ones_like(z1)
    for b, a in filters:
        h *= (b[0] + b[1] * z1 + b[2] * z2) / (a[0] + a[1] * z1 + a[2] * z2)
    return h


def ir_length(filters: list[Biquad], floor_db: float = -100.0) -> int:
    """Samples until the slowest pole decays by floor_db."""
    worst = 0.0
    for _, a in filters:
        r = np.abs(np.roots(a)) if abs(a[2]) > 1e-15 or abs(a[1]) > 1e-15 else np.array([0.0])
        worst = max(worst, float(np.max(r)) if r.size else 0.0)
    if worst <= 1e-9:
        return 8
    worst = min(worst, 1 - 1e-9)
    return int(min(SR * 8, math.ceil((floor_db / 20) * math.log(10) / math.log(worst)) + 8))


def apply(x: np.ndarray, filters: list[Biquad] | Biquad, circular: bool = False) -> np.ndarray:
    """Run a biquad cascade over x (mono or stereo) — exact causal IIR via the FFT."""
    if isinstance(filters, tuple):
        filters = [filters]
    n = x.shape[-1]
    if n == 0 or not filters:
        return x.copy()
    if circular:
        X = np.fft.rfft(x, axis=-1)
        h = response(filters, n)
        return np.fft.irfft(X * h, n=n, axis=-1)
    pad = ir_length(filters)
    m = next_fast_len(n + pad)
    X = np.fft.rfft(x, n=m, axis=-1)
    return np.fft.irfft(X * response(filters, m), n=m, axis=-1)[..., :n]


def apply_mag(x: np.ndarray, mag_fn, circular: bool = False, pad: int = 4096) -> np.ndarray:
    """Zero-phase filter by an arbitrary magnitude curve mag_fn(freqs_hz) → gains."""
    n = x.shape[-1]
    m = n if circular else next_fast_len(n + pad)
    X = np.fft.rfft(x, n=m, axis=-1)
    f = np.fft.rfftfreq(m, 1 / SR)
    y = np.fft.irfft(X * mag_fn(f), n=m, axis=-1)
    if circular:
        return y
    # zero-phase spreads both ways: take the window starting at 0 (pre-ringing folds from the end)
    return y[..., :n]


def biquad_loop(x: np.ndarray, b: np.ndarray, a: np.ndarray) -> np.ndarray:
    """Plain sample loop (Direct Form II transposed) for short mono signals."""
    y = np.empty_like(x)
    b0, b1, b2 = (float(v) for v in b); a1, a2 = float(a[1]), float(a[2])
    z1 = z2 = 0.0
    for i in range(x.shape[0]):
        xi = x[i]
        yi = b0 * xi + z1
        z1 = b1 * xi - a1 * yi + z2
        z2 = b2 * xi - a2 * yi
        y[i] = yi
    return y


def svf(x: np.ndarray, fc, q, mode: str = 'bp') -> np.ndarray:
    """Time-varying TPT state-variable filter (Zavalishin), sample loop — for short sweeps.
    fc and q are scalars or per-sample arrays. mode: lp | bp | hp | notch | peak."""
    n = x.shape[0]
    fc = np.broadcast_to(np.clip(np.asarray(fc, float), 10.0, SR * 0.45), (n,))
    q = np.broadcast_to(np.maximum(np.asarray(q, float), 0.05), (n,))
    g = np.tan(np.pi * fc / SR)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k))
    y = np.empty(n)
    ic1 = ic2 = 0.0
    lp_m, bp_m, hp_m = {'lp': (1, 0, 0), 'bp': (0, 1, 0), 'hp': (0, 0, 1), 'notch': (1, 0, 1), 'peak': (1, 0, -1)}[mode]
    gl = g.tolist(); kl = k.tolist(); al = a1.tolist(); xl = x.tolist()
    for i in range(n):
        gi = gl[i]; ki = kl[i]
        v3 = xl[i] - ic2
        v1 = al[i] * (ic1 + gi * v3)
        v2 = ic2 + gi * v1
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        hp = xl[i] - ki * v1 - v2
        y[i] = lp_m * v2 + bp_m * v1 * ki + hp_m * hp   # bp normalised to 0 dB peak
    return y


def onepole_lp(x: np.ndarray, f: float, circular: bool = False) -> np.ndarray:
    """6 dB/oct lowpass (bilinear one-pole), via the frequency domain."""
    w = math.tan(math.pi * min(f, SR * 0.49) / SR)
    b = np.array([w / (1 + w), w / (1 + w), 0.0]); a = np.array([1.0, (w - 1) / (w + 1), 0.0])
    return apply(x, [(b, a)], circular)


def onepole_hp(x: np.ndarray, f: float, circular: bool = False) -> np.ndarray:
    w = math.tan(math.pi * min(f, SR * 0.49) / SR)
    b = np.array([1 / (1 + w), -1 / (1 + w), 0.0]); a = np.array([1.0, (w - 1) / (w + 1), 0.0])
    return apply(x, [(b, a)], circular)


def lp24(f: float) -> list[Biquad]:
    """24 dB/oct Butterworth lowpass (two biquads)."""
    return [lowpass(f, 0.5412), lowpass(f, 1.3066)]


def hp24(f: float) -> list[Biquad]:
    return [highpass(f, 0.5412), highpass(f, 1.3066)]


# ── convolution ──────────────────────────────────────────────────────────────────────────────────
def fft_convolve(x: np.ndarray, h: np.ndarray, circular: bool = False, full: bool = False) -> np.ndarray:
    """Convolve x (mono/stereo) with h (mono or stereo with the same channel count, or mono
    applied to every channel). circular=True wraps the tail over len(x)."""
    n = x.shape[-1]
    k = h.shape[-1]
    if circular:
        m = n
        hh = h
        if k > n:   # fold a long IR onto the loop length
            reps = int(math.ceil(k / n))
            hh = np.pad(h, [(0, 0)] * (h.ndim - 1) + [(0, reps * n - k)])
            hh = hh.reshape(hh.shape[:-1] + (reps, n)).sum(axis=-2)
        H = np.fft.rfft(hh, n=m, axis=-1)
        return np.fft.irfft(np.fft.rfft(x, n=m, axis=-1) * H, n=m, axis=-1)
    out_n = n + k - 1
    m = next_fast_len(out_n)
    y = np.fft.irfft(np.fft.rfft(x, n=m, axis=-1) * np.fft.rfft(h, n=m, axis=-1), n=m, axis=-1)
    return y[..., :out_n] if full else y[..., :n]


def modal_ir(freqs, decays, amps, length_s: float, phases=None) -> np.ndarray:
    """Impulse response of a bank of damped sinusoidal modes (decays = T60 seconds)."""
    n = int(length_s * SR)
    t = np.arange(n) / SR
    h = np.zeros(n)
    for i, (f, d, a) in enumerate(zip(freqs, decays, amps)):
        if f >= SR * 0.48:
            continue
        ph = 0.0 if phases is None else phases[i]
        h += a * np.exp(-6.9078 * t / d) * np.sin(TAU * f * t + ph)
    return h


def resonate(x: np.ndarray, freqs, decays, amps, length_s: float | None = None, circular: bool = False,
             full: bool = True) -> np.ndarray:
    """Excite a modal resonator bank with x (body resonance, wood, membranes)."""
    L = length_s if length_s is not None else max(decays) * 1.1
    return fft_convolve(x, modal_ir(freqs, decays, amps, L), circular=circular, full=full and not circular)


# ── STFT time-varying spectral filter ────────────────────────────────────────────────────────────
def stft_filter(x: np.ndarray, gain_fn, frame: int = 2048, hop: int | None = None, circular: bool = False) -> np.ndarray:
    """Time-varying zero-phase filter. gain_fn(times_s[frames], freqs_hz[bins]) → gains[frames, bins].
    Hann analysis + Hann synthesis at 75 % overlap (constant-overlap-add). Mono or stereo."""
    hop = hop or frame // 4
    xs = x if x.ndim == 2 else x[None, :]
    ch, n = xs.shape
    if circular:
        # wrap: pad with the loop's own end/start so the edges see continuous signal
        padded = np.concatenate([xs[:, -frame:], xs, xs[:, :frame]], axis=1)
        y = _stft_core(padded, gain_fn, frame, hop, t_offset=-frame / SR)
        y = y[:, frame:frame + n]
    else:
        padded = np.pad(xs, ((0, 0), (frame, frame)))
        y = _stft_core(padded, gain_fn, frame, hop, t_offset=-frame / SR)[:, frame:frame + n]
    return y if x.ndim == 2 else y[0]


def _stft_core(xs: np.ndarray, gain_fn, frame: int, hop: int, t_offset: float) -> np.ndarray:
    ch, n = xs.shape
    win = 0.5 - 0.5 * np.cos(TAU * np.arange(frame) / frame)
    nfr = 1 + int(math.ceil(max(0, n - frame) / hop))
    total = (nfr - 1) * hop + frame
    xp = np.pad(xs, ((0, 0), (0, total - n)))
    times = (hop * np.arange(nfr) + frame / 2) / SR + t_offset
    freqs = np.fft.rfftfreq(frame, 1 / SR)
    G = np.asarray(gain_fn(times, freqs), float)
    if G.ndim == 1:
        G = np.broadcast_to(G, (nfr, freqs.size))
    y = np.zeros((ch, total))
    norm = np.sum(win ** 2) / hop
    step = 256
    for c in range(ch):
        for f0 in range(0, nfr, step):
            f1 = min(nfr, f0 + step)
            idx = np.arange(frame)[None, :] + hop * np.arange(f0, f1)[:, None]
            fr = xp[c][idx] * win
            out = np.fft.irfft(np.fft.rfft(fr, axis=1) * G[f0:f1], n=frame, axis=1) * win
            for j in range(f1 - f0):
                s = (f0 + j) * hop
                y[c, s:s + frame] += out[j]
    return y[:, :n] / norm


def bp_curve(freqs: np.ndarray, fc, q: float, order: int = 2) -> np.ndarray:
    """Band-pass magnitude centred on fc (scalar or per-frame array) for stft_filter.
    order 2 = one resonant biquad; 4 = two cascaded (steeper skirts)."""
    fc = np.atleast_1d(np.asarray(fc, float))[:, None]
    f = np.maximum(freqs[None, :], 1.0)
    r = f / fc - fc / f
    return (1.0 / np.sqrt(1.0 + (q * r) ** 2)) ** (order / 2)


def lp_curve(freqs: np.ndarray, fc, order: int = 4, res_db: float = 0.0) -> np.ndarray:
    """Butterworth-like lowpass magnitude (order = poles) with an optional resonant bump at fc."""
    fc = np.atleast_1d(np.asarray(fc, float))[:, None]
    f = freqs[None, :]
    g = 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))
    if res_db:
        g = g * (1.0 + (10 ** (res_db / 20) - 1.0) * np.exp(-0.5 * (np.log2(np.maximum(f, 1) / fc) / 0.25) ** 2))
    return g


def hp_curve(freqs: np.ndarray, fc, order: int = 2) -> np.ndarray:
    fc = np.atleast_1d(np.asarray(fc, float))[:, None]
    f = np.maximum(freqs[None, :], 1e-3)
    return 1.0 / np.sqrt(1.0 + (fc / f) ** (2 * order))
