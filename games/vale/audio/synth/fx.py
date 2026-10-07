"""Effects: generated reverb impulse responses (shaped-noise hall/plate and an 8-line FDN) with
FFT convolution, stereo feedback delay, chorus, anti-aliased saturation, (multiband) compression,
a true-peak look-ahead limiter and small mix utilities.

Every effect takes circular=True for loops: the effect then sees the loop as an endless signal
(its tail wraps to the start) so the rendered loop is seamless at the seam.
"""
from __future__ import annotations

import math

import numpy as np

from .core import SR, TAU, db, next_fast_len, rng, stereo
from .filters import apply, apply_mag, fft_convolve, highpass, lowpass, stft_filter, peaking, highshelf, lowshelf
from .loudness import _KERNEL


# ── reverb impulse responses ─────────────────────────────────────────────────────────────────────
def _rt60_curve(freqs: np.ndarray, rt_low: float, rt_high: float, f_lo: float = 300.0, f_hi: float = 6000.0) -> np.ndarray:
    x = np.clip((np.log2(np.maximum(freqs, 1.0)) - math.log2(f_lo)) / (math.log2(f_hi) - math.log2(f_lo)), 0.0, 1.0)
    # extra air absorption above f_hi
    rt = rt_low + (rt_high - rt_low) * (0.5 - 0.5 * np.cos(np.pi * x))
    air = np.clip((freqs - f_hi) / 10000.0, 0.0, 1.0)
    return rt * (1.0 - 0.55 * air)


def shaped_ir(name: str, rt_low: float, rt_high: float, predelay_ms: float = 20.0, er_ms: float = 70.0,
              er_count: int = 14, hp_hz: float = 120.0, lp_hz: float = 12000.0, width_: float = 1.0,
              length_s: float | None = None) -> np.ndarray:
    """A dense stereo IR: decorrelated noise with frequency-dependent exponential decay, a smooth
    density build-up, sparse early reflections and a pre-delay. Energy-normalised to 1."""
    r = rng('ir:' + name)
    L = length_s or max(rt_low, rt_high) * 1.15
    n = int(L * SR)
    noise = r.standard_normal((2, n))
    # mid/side width control on the diffuse field
    m, s = 0.5 * (noise[0] + noise[1]), 0.5 * (noise[0] - noise[1]) * width_
    noise = np.vstack([m + s, m - s])
    tail = stft_filter(noise, lambda t, f: np.exp(-6.9078 * np.maximum(t, 0)[:, None] / _rt60_curve(f, rt_low, rt_high)[None, :]),
                       frame=1024)
    t = np.arange(n) / SR
    build = 1.0 - np.exp(-t / 0.018)              # density build-up over ~20 ms
    tail *= build
    # early reflections: sparse, slightly low-passed taps, alternating sides
    er = np.zeros((2, n))
    for i in range(er_count):
        d = r.uniform(0.004, er_ms / 1000.0)
        a = (0.8 - 0.5 * d / (er_ms / 1000.0)) * r.uniform(0.4, 1.0) * (1 if r.random() < 0.5 else -1)
        k = int(d * SR)
        side = r.uniform(-1, 1)
        er[0, k] += a * (1 - 0.6 * side)
        er[1, k + int(r.uniform(0, 0.0012) * SR)] += a * (1 + 0.6 * side)
    er = apply(er, [lowpass(7000)])
    ir = tail / (np.sqrt(np.sum(tail ** 2)) + 1e-12) + er * 0.35 / (np.sqrt(np.sum(er ** 2)) + 1e-12)
    ir = apply(ir, [highpass(hp_hz, 0.6), lowpass(lp_hz, 0.6)])
    pre = int(predelay_ms / 1000.0 * SR)
    ir = np.pad(ir, ((0, 0), (pre, 0)))
    return ir / (np.sqrt(np.sum(ir ** 2) / 2) + 1e-12)


def fdn_ir(name: str, rt60: float, damping_hz: float = 6000.0, length_s: float | None = None,
           delays=(1031, 1327, 1523, 1801, 2063, 2297, 2647, 2953)) -> np.ndarray:
    """Algorithmic reverb: an 8-line feedback delay network (Householder mixing, per-line gain for
    the target RT60, a 3-tap FIR damper in each loop) driven by a unit impulse and rendered to an IR.
    Processed in blocks shorter than the shortest delay, so every block is pure numpy."""
    r = rng('fdn:' + name)
    L = length_s or rt60 * 1.2
    n = int(L * SR)
    N = len(delays)
    d = np.array(delays, int)
    g = 10 ** (-3.0 * d / (rt60 * SR))
    A = np.eye(N) - (2.0 / N) * np.ones((N, N))     # Householder: lossless, dense mixing
    c = math.exp(-TAU * damping_hz / SR)            # damper strength from the cutoff
    fir = np.array([0.25 * (1 - c), 0.5 + 0.5 * c, 0.25 * (1 - c)])
    fir /= fir.sum()
    maxd = int(d.max()) + 4
    lines = np.zeros((N, n + maxd))                 # line outputs over time (write head = time)
    b_in = r.choice([-1.0, 1.0], N) * (1.0 / math.sqrt(N))
    c_out = np.vstack([r.choice([-1.0, 1.0], N), r.choice([-1.0, 1.0], N)]) / math.sqrt(N)
    out = np.zeros((2, n))
    blk = int(d.min()) - 3
    imp = np.zeros(n); imp[0] = 1.0
    t0 = 0
    while t0 < n:
        t1 = min(n, t0 + blk)
        k = t1 - t0
        # delayed, damped line reads for times t0..t1 (read positions t - d_i, all already written)
        reads = np.zeros((N, k))
        for i in range(N):
            base = t0 - d[i]
            idx = np.arange(base - 2, base + k)
            valid = idx >= 0
            v = np.zeros(k + 2)
            v[valid] = lines[i, idx[valid]]
            reads[i] = fir[0] * v[2:] + fir[1] * v[1:-1] + fir[2] * v[:-2]
        reads *= g[:, None]
        out[:, t0:t1] = c_out @ reads
        lines[:, t0:t1] = A @ reads + b_in[:, None] * imp[None, t0:t1]
        t0 = t1
    out = apply(out, [highpass(100, 0.6)])
    return out / (np.sqrt(np.sum(out ** 2) / 2) + 1e-12)


_IR_CACHE: dict[str, np.ndarray] = {}


def hall_ir() -> np.ndarray:
    """tokens.audio.space.hall: RT60 2.8 s low / 1.6 s high, 24 ms pre-delay."""
    if 'hall' not in _IR_CACHE:
        _IR_CACHE['hall'] = shaped_ir('hall', 2.8, 1.6, predelay_ms=24, er_ms=80, lp_hz=11000)
    return _IR_CACHE['hall']


def plate_ir() -> np.ndarray:
    """tokens.audio.space.plate: RT60 0.6 s, bright and dense, no pre-delay."""
    if 'plate' not in _IR_CACHE:
        _IR_CACHE['plate'] = shaped_ir('plate', 0.75, 0.55, predelay_ms=4, er_ms=18, er_count=8, hp_hz=180, lp_hz=14000)
    return _IR_CACHE['plate']


def room_ir() -> np.ndarray:
    """A small wooden room for UI sounds (short, warm, ~0.35 s)."""
    if 'room' not in _IR_CACHE:
        _IR_CACHE['room'] = shaped_ir('room', 0.42, 0.25, predelay_ms=3, er_ms=22, er_count=10, hp_hz=200, lp_hz=9000)
    return _IR_CACHE['room']


def chamber_ir() -> np.ndarray:
    """Algorithmic stone chamber (FDN) for combat tails — rougher, more 'stone' than the hall."""
    if 'chamber' not in _IR_CACHE:
        _IR_CACHE['chamber'] = fdn_ir('chamber', 1.3, damping_hz=4500)
    return _IR_CACHE['chamber']


def reverb(x: np.ndarray, ir: np.ndarray, wet: float = 0.25, dry: float = 1.0, circular: bool = False,
           tail: bool = True) -> np.ndarray:
    """Send/return convolution reverb. tail=True extends one-shots by the IR length."""
    xs = stereo(x)
    if circular:
        w = np.vstack([fft_convolve(xs[c], ir[c], circular=True) for c in range(2)])
        return dry * xs + wet * w
    if tail:
        n = xs.shape[1] + ir.shape[1]
        xs2 = np.pad(xs, ((0, 0), (0, ir.shape[1])))
        w = np.vstack([fft_convolve(xs2[c], ir[c]) for c in range(2)])
        return dry * xs2 + wet * w[:, :n]
    w = np.vstack([fft_convolve(xs[c], ir[c]) for c in range(2)])
    return dry * xs + wet * w


# ── delay / chorus ───────────────────────────────────────────────────────────────────────────────
def stereo_delay(x: np.ndarray, t_l: float, t_r: float, feedback: float = 0.35, cross: float = 0.6,
                 damp_hz: float = 5000.0, mix: float = 0.25, circular: bool = False, tail_s: float | None = None) -> np.ndarray:
    """Feedback stereo delay with cross-feed (ping-pong when cross≈1), damped repeats.
    Solved exactly per frequency bin: Y = (I − G·D·H)^−1 · G·D·H · X."""
    xs = stereo(x)
    n = xs.shape[1]
    if circular:
        m = n
        xp = xs
    else:
        if tail_s is None:
            rep = math.log(1e-3) / math.log(max(feedback, 1e-3))
            tail_s = min(8.0, rep * max(t_l, t_r))
        m = next_fast_len(n + int(tail_s * SR))
        xp = np.pad(xs, ((0, 0), (0, m - n)))
    X = np.fft.rfft(xp, n=m, axis=1)
    w = TAU * np.arange(m // 2 + 1) / m
    Dl = np.exp(-1j * w * t_l * SR)
    Dr = np.exp(-1j * w * t_r * SR)
    f = np.arange(m // 2 + 1) * SR / m
    H = 1.0 / np.sqrt(1.0 + (f / damp_hz) ** 2)     # gentle damping magnitude per repeat
    a, b = feedback * (1 - cross), feedback * cross
    # loop matrix M = [[a Dl H, b Dl H], [b Dr H, a Dr H]]  (row = destination)
    M11, M12, M21, M22 = a * Dl * H, b * Dl * H, b * Dr * H, a * Dr * H
    # first tap: L hears Dl·H·X_L, R hears Dr·H·X_R (input split, wet only)
    F1, F2 = Dl * H * X[0], Dr * H * X[1]
    det = (1 - M11) * (1 - M22) - M12 * M21
    Y1 = ((1 - M22) * F1 + M12 * F2) / det
    Y2 = (M21 * F1 + (1 - M11) * F2) / det
    wet = np.vstack([np.fft.irfft(Y1, n=m), np.fft.irfft(Y2, n=m)])
    return xp[:, :m] + mix * wet if not circular else xs + mix * wet


def chorus(x: np.ndarray, depth_ms: float = 2.5, rate_hz: float = 0.3, base_ms: float = 12.0, voices: int = 2,
           mix: float = 0.4, circular: bool = False, seed: str = 'chorus') -> np.ndarray:
    """Modulated-delay chorus (linear interpolation), voices spread across the stereo field.
    For loops the LFO rate is snapped to whole cycles of the loop."""
    xs = stereo(x)
    n = xs.shape[1]
    r = rng(seed)
    out = xs.copy()
    if circular:
        cycles = max(1, round(rate_hz * n / SR))
        rate_hz = cycles * SR / n
    t = np.arange(n)
    for v in range(voices):
        ph = r.uniform(0, 1)
        d = (base_ms + depth_ms * np.sin(TAU * (rate_hz * (1 + 0.13 * v) * t / SR + ph))) * SR / 1000.0
        if circular:
            rate_v = max(1, round(rate_hz * (1 + 0.13 * v) * n / SR)) * SR / n
            d = (base_ms + depth_ms * np.sin(TAU * (rate_v * t / SR + ph))) * SR / 1000.0
        pos = t - d
        side = -1 if v % 2 == 0 else 1
        for c in range(2):
            sig = xs[c]
            if circular:
                p = np.mod(pos, n)
                i0 = np.floor(p).astype(int)
                fr = p - i0
                y = sig[i0 % n] * (1 - fr) + sig[(i0 + 1) % n] * fr
            else:
                y = np.interp(pos, t, sig, left=0.0, right=0.0)
            g = 0.5 * (1 + 0.7 * side * (1 if c == 1 else -1))
            out[c] += mix * g * y
    return out


# ── saturation / dynamics ───────────────────────────────────────────────────────────────────────
def saturate(x: np.ndarray, drive: float = 2.0, mix: float = 1.0, asym: float = 0.0) -> np.ndarray:
    """tanh saturation with first-order antiderivative anti-aliasing (ADAA). asym adds even
    harmonics (warmth); the result is DC-corrected and gain-compensated to the input peak."""
    xs = np.asarray(x, float)
    u = drive * xs + asym
    F = np.log(np.cosh(np.clip(u, -40, 40)))
    du = np.diff(u, axis=-1, prepend=u[..., :1])
    dF = np.diff(F, axis=-1, prepend=F[..., :1])
    small = np.abs(du) < 1e-6
    y = np.where(small, np.tanh(u), dF / np.where(small, 1.0, du))
    y = y - np.tanh(asym)
    y -= np.mean(y, axis=-1, keepdims=True)
    pk_in = np.max(np.abs(xs)) + 1e-12
    y *= pk_in / (np.max(np.abs(y)) + 1e-12)
    return (1 - mix) * xs + mix * y


def _envelope_db(sig_power: np.ndarray, hop: int, win: int) -> np.ndarray:
    cs = np.concatenate([[0.0], np.cumsum(sig_power)])
    n = sig_power.size
    centers = np.arange(0, n, hop)
    a = np.clip(centers - win // 2, 0, n)
    b = np.clip(centers + win // 2, 0, n)
    ms = (cs[b] - cs[a]) / np.maximum(b - a, 1)
    return 10 * np.log10(ms + 1e-20)


def _smooth_gain(gr_db: np.ndarray, hop: int, attack: float, release: float) -> np.ndarray:
    ca = math.exp(-hop / (attack * SR)); cr = math.exp(-hop / (release * SR))
    out = np.empty_like(gr_db)
    s = 0.0
    for i, g in enumerate(gr_db.tolist()):          # gr_db <= 0: more negative = more reduction
        s = ca * s + (1 - ca) * g if g < s else cr * s + (1 - cr) * g
        out[i] = s
    return out


def compress(x: np.ndarray, threshold_db: float = -18.0, ratio: float = 2.0, attack: float = 0.01,
             release: float = 0.15, knee_db: float = 6.0, makeup_db: float = 0.0, circular: bool = False) -> np.ndarray:
    """Feed-forward RMS compressor (linked stereo), soft knee. Gain computed at a 32-sample hop."""
    xs = stereo(x)
    n = xs.shape[1]
    pad = int(min(n, 2 * SR)) if circular else 0
    src = np.concatenate([xs[:, n - pad:], xs, xs[:, :pad]], axis=1) if circular else xs
    hop = 32
    lvl = _envelope_db(np.mean(src ** 2, axis=0) * 2.0, hop, int(0.01 * SR))
    over = lvl - threshold_db
    gr = np.where(over <= -knee_db / 2, 0.0,
                  np.where(over >= knee_db / 2, -over * (1 - 1 / ratio),
                           -(1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
    g = _smooth_gain(gr, hop, attack, release)
    gs = np.interp(np.arange(src.shape[1]), np.arange(g.size) * hop, g)
    y = src * db(makeup_db) * (10 ** (gs / 20))[None, :]
    return y[:, pad:pad + n] if circular else y


def multiband_compress(x: np.ndarray, xover=(220.0, 2800.0), settings=None, circular: bool = False) -> np.ndarray:
    """3-band compressor with linear-phase complementary FFT crossovers (bands sum back exactly
    when no gain is applied). settings: list of 3 dicts of compress() kwargs."""
    xs = stereo(x)
    settings = settings or [dict(threshold_db=-24, ratio=2.0, attack=0.02, release=0.25),
                            dict(threshold_db=-22, ratio=1.6, attack=0.01, release=0.18),
                            dict(threshold_db=-26, ratio=2.0, attack=0.004, release=0.12)]
    lo_mag = lambda f: 1.0 / np.sqrt(1.0 + (f / xover[0]) ** 8)
    mid_lo = lambda f: 1.0 / np.sqrt(1.0 + (f / xover[1]) ** 8)
    low = apply_mag(xs, lo_mag, circular=circular)
    below_hi = apply_mag(xs, mid_lo, circular=circular)
    mid = below_hi - low
    high = xs - below_hi
    return sum(compress(b, circular=circular, **s) for b, s in zip((low, mid, high), settings))


def limit(x: np.ndarray, ceiling_dbtp: float = -1.0, lookahead_ms: float = 1.5, release_ms: float = 80.0,
          circular: bool = False, iterations: int = 3) -> np.ndarray:
    """True-peak look-ahead brickwall limiter (linked stereo). The detector uses the same 4×
    interpolator as the meter; the gain curve is a min-filter + box smoothing (never above the
    needed gain) followed by a release follower. Iterates until the true peak is under the ceiling."""
    from .loudness import true_peak
    xs = stereo(x).copy()
    n = xs.shape[1]
    ceil = db(ceiling_dbtp - 0.05)
    for _ in range(iterations):
        pad = int(0.05 * SR) if circular else 0
        src = np.concatenate([xs[:, n - pad:], xs, xs[:, :pad]], axis=1) if circular else np.pad(xs, ((0, 0), (0, 64)))
        env = np.max(np.abs(src), axis=0)
        for ph in range(4):
            h = _KERNEL[ph::4]
            for c in range(2):
                y = fft_convolve(src[c], h, full=True)
                off = (h.size - 1) // 2
                env = np.maximum(env, np.abs(y[off:off + src.shape[1]]))
        need = np.minimum(1.0, ceil / np.maximum(env, 1e-12))
        if np.min(need) >= 1.0:
            break
        R = max(1, int(lookahead_ms / 1000 * SR))
        padded = np.pad(need, (R, R), constant_values=1.0)
        win = np.lib.stride_tricks.sliding_window_view(padded, 2 * R + 1)
        mn = win.min(axis=1)
        h = R // 2
        k = 2 * h + 1                       # box half-width h <= R, so box[i] <= need[i]
        cs = np.concatenate([[0.0], np.cumsum(np.pad(mn, (h, h), mode='edge'))])
        box = (cs[k:k + mn.size] - cs[:mn.size]) / k
        # release follower at a 16-sample block rate
        hop = 16
        blocks = box[: (box.size // hop) * hop].reshape(-1, hop).min(axis=1)
        if box.size % hop:
            blocks = np.append(blocks, box[(box.size // hop) * hop:].min())
        cr = math.exp(-hop / (release_ms / 1000 * SR))
        rel = np.empty_like(blocks)
        s = 1.0
        for i, v in enumerate(blocks.tolist()):
            s = v if v < s else cr * s + (1 - cr) * v
            rel[i] = s
        rel_up = np.repeat(rel, hop)[:box.size]
        gain = np.minimum(box, rel_up)
        src = src * gain[None, :]
        xs = src[:, pad:pad + n] if circular else src[:, :n]
        if true_peak(xs, circular=circular) <= ceiling_dbtp:
            break
    return xs


# ── EQ / utility ─────────────────────────────────────────────────────────────────────────────────
def dc_block(x: np.ndarray, f: float = 15.0, circular: bool = False) -> np.ndarray:
    y = apply(x, [highpass(f, 0.7071)], circular=circular)
    return y - np.mean(y, axis=-1, keepdims=True) if circular else y


def eq(x: np.ndarray, bands, circular: bool = False) -> np.ndarray:
    """bands: list of ('peak', f, gain_db, q) | ('low', f, gain_db) | ('high', f, gain_db) | ('hp', f, q) | ('lp', f, q)."""
    fl = []
    for b in bands:
        k = b[0]
        if k == 'peak':
            fl.append(peaking(b[1], b[2], b[3] if len(b) > 3 else 1.0))
        elif k == 'low':
            fl.append(lowshelf(b[1], b[2]))
        elif k == 'high':
            fl.append(highshelf(b[1], b[2]))
        elif k == 'hp':
            fl.append(highpass(b[1], b[2] if len(b) > 2 else 0.7071))
        elif k == 'lp':
            fl.append(lowpass(b[1], b[2] if len(b) > 2 else 0.7071))
    return apply(x, fl, circular=circular)


def speech_dip(x: np.ndarray, gain_db: float = -3.0, circular: bool = False) -> np.ndarray:
    """tokens.audio.beds.menu.dipHz [1000, 4000], dipDb −3: a broad bell centred at 2 kHz."""
    return eq(x, [('peak', 2000.0, gain_db, 0.7)], circular=circular)
