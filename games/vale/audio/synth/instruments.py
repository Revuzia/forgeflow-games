"""The eight VALE voices (STYLE_BIBLE "Audio", tokens.audio.instruments), all synthesized:

  dawnglass   additive struck glass bowl: inharmonic partials 1 · 2.32 · 4.25 · 6.63, detuned pairs
              (0.6 Hz beating = the shimmer), a glassy strike tick
  hourbell    additive bell: hum 0.5 · prime 1 · tierce 1.2 · quint 1.5 · nominal 2 · 2.51 · 3 · 4,
              warbling doublets, an 8 ms strike
  dial_harp   Karplus-Strong string (one-pole lowpass in the loop, tuned for its phase delay),
              pluck-position comb, 4 round-robin excitations, wooden body resonance
  lamp_drone  3 PolyBLEP saws ±7 cents → 24 dB/oct lowpass breathing 400–1600 Hz at 0.05 Hz
  frame_drum  modal membrane 1 · 1.59 · 2.14 · 2.3 · 2.65 · 2.92 + a stone kick 90→45 Hz
  escapement  band-passed noise burst (2.5 kHz, Q 4) into wood resonators at 850 / 1900 Hz
  shade_breath pink noise through a sweeping band-pass; reversed swells
  fm_shimmer  2-op FM, ratio 3.5, index 2.5 → 0, 1.2 s decay

Every function returns a stereo (2, n) float array, roughly peak-normalised to the velocity.
`loop_len` (seconds), where accepted, snaps oscillator frequencies to whole cycles of a loop so a
sustained voice is exactly periodic across a loop seam.
"""
from __future__ import annotations

import math

import numpy as np

from . import env as E
from . import filters as F
from . import osc as O
from .core import SR, TAU, db, ns, pan, rng, stereo


def _snap(f: float, loop_len: float | None) -> float:
    if not loop_len:
        return f
    return max(1, round(f * loop_len)) / loop_len


# ── dawnglass ────────────────────────────────────────────────────────────────────────────────────
DAWNGLASS_PARTIALS = (1.0, 2.32, 4.25, 6.63)
DAWNGLASS_DECAYS = (2.4, 1.1, 0.6, 0.3)


def dawnglass(f: float, dur: float = 3.0, vel: float = 0.8, seed: str = 'glass', decay_scale: float = 1.0,
              bright: float = 1.0, detune_hz: float = 0.6, strike: float = 1.0, shimmer: float = 1.0) -> np.ndarray:
    """Struck glass bowl. vel 0..1 scales level and brightness (harder = more upper partials)."""
    r = rng(f'dawnglass:{seed}:{f:.2f}')
    n = ns(dur)
    b = (0.55 + 0.6 * vel) * bright
    amps = (1.0, 0.55 * b, 0.33 * b * b, 0.2 * b ** 3)
    out = np.zeros((2, n))
    for c in range(2):
        parts = [(ratio, a, d * decay_scale, detune_hz * (1.0 + 0.35 * i) * (1 if c == 0 else 1.13))
                 for i, (ratio, a, d) in enumerate(zip(DAWNGLASS_PARTIALS, amps, DAWNGLASS_DECAYS))]
        # faint high shimmer partials (inharmonic, fast)
        parts += [(9.38, 0.05 * b * shimmer, 0.12 * decay_scale, 2.1), (12.7, 0.03 * b * shimmer, 0.07 * decay_scale, 3.3)]
        out[c] = O.additive(f, parts, n, r)
    atk = max(1, int((0.0035 - 0.0025 * vel) * SR))
    out[:, :atk] *= np.linspace(0, 1, atk) ** 0.7
    if strike:
        k = ns(0.004)
        tick = O.white(k, r) * E.decay(k, 0.004, 0.0002)
        tick = F.apply(tick, [F.highpass(min(9000, f * 6), 0.7), F.peaking(min(12000, f * 9), 6, 2)])
        out[:, :k] += 0.18 * strike * vel * stereo(tick)
    return out / (np.max(np.abs(out)) + 1e-12) * vel


# ── hourbell ─────────────────────────────────────────────────────────────────────────────────────
HOURBELL_PARTIALS = (0.5, 1.0, 1.2, 1.5, 2.0, 2.51, 3.0, 4.0)


def hourbell(f: float, dur: float | None = None, vel: float = 0.8, seed: str = 'bell', decay_scale: float = 1.0,
             bright: float = 1.0, strike_ms: float = 8.0) -> np.ndarray:
    """Tuned bell; f is the prime (strike note). Lower bells ring longer."""
    r = rng(f'hourbell:{seed}:{f:.2f}')
    T = 7.0 * decay_scale * (f / 220.0) ** -0.55
    T = min(T, 16.0)
    dur = dur or min(T * 1.1, 18.0)
    n = ns(dur)
    b = (0.6 + 0.5 * vel) * bright
    rel = (1.0, 0.8, 0.62, 0.42, 0.55, 0.26, 0.19, 0.13)
    amps = (0.42, 0.75, 0.55, 0.28 * b, 0.95 * b, 0.32 * b * b, 0.22 * b * b, 0.13 * b ** 3)
    warble = (0.25, 0.6, 0.9, 1.3, 0.7, 1.7, 2.2, 2.9)
    out = np.zeros((2, n))
    for c in range(2):
        parts = [(ratio, a, T * rr, w * (1.0 if c == 0 else 1.21)) for ratio, a, rr, w in zip(HOURBELL_PARTIALS, amps, rel, warble)]
        out[c] = O.additive(f, parts, n, r)
    k = ns(strike_ms / 1000.0)
    hit = O.white(k, r) * E.decay(k, strike_ms / 1000.0, 0.0003)
    hit = F.apply(hit, [F.bandpass(min(9000, f * 4.2), 1.2)]) + 0.5 * F.apply(hit, [F.lowpass(min(4000, f * 2), 0.8)])
    out[:, :k] += 0.35 * vel * stereo(hit) * (np.max(np.abs(out)) + 1e-9) / (np.max(np.abs(hit)) + 1e-9)
    atk = ns(0.0015)
    out[:, :atk] *= np.linspace(0, 1, atk)
    return out / (np.max(np.abs(out)) + 1e-12) * vel


# ── dial harp (Karplus-Strong) ───────────────────────────────────────────────────────────────────
_BODY_MODES = ((118, 0.16, 1.0), (196, 0.14, 0.8), (286, 0.12, 0.7), (402, 0.10, 0.55), (548, 0.08, 0.45),
               (731, 0.07, 0.35), (980, 0.05, 0.25), (1390, 0.04, 0.18), (2010, 0.03, 0.12))


def _body_ir(seed: str) -> np.ndarray:
    r = rng('harpbody:' + seed)
    out = []
    for c in range(2):
        fr = [m[0] * r.uniform(0.97, 1.03) for m in _BODY_MODES]
        out.append(F.modal_ir(fr, [m[1] for m in _BODY_MODES], [m[2] for m in _BODY_MODES], 0.25,
                              phases=r.uniform(0, TAU, len(_BODY_MODES))))
    ir = np.vstack(out)
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


_BODY_CACHE: dict[str, np.ndarray] = {}


def dial_harp(f: float, dur: float = 3.0, vel: float = 0.8, rr: int = 0, seed: str = 'harp', t60: float | None = None,
              bright: float = 0.35, pos: float = 0.18, body: float = 0.35, damp_at: float | None = None) -> np.ndarray:
    """Plucked string. bright 0..1 (loop lowpass), pos = pluck position (comb), rr = round-robin
    (0..3 → one of 4 excitations), damp_at = seconds after which the string is damped."""
    r = rng(f'harp:{seed}:{rr % 4}')
    n = ns(dur)
    period = SR / f
    # loop filter: one-pole lowpass, truncated to a short FIR so the loop can run block-wise
    p = 0.08 + 0.55 * (1.0 - bright) * (1.0 - 0.4 * vel)
    K = 6
    h = (1 - p) * p ** np.arange(K)
    h /= h.sum()
    w0 = TAU * f / SR
    H0 = np.sum(h * np.exp(-1j * w0 * np.arange(K)))
    tau = -np.angle(H0) / w0                     # FIR phase delay at f0 (samples)
    D = period - tau
    N = int(math.floor(D)); frac = D - N
    if N < K + 2:
        raise ValueError(f'harp note too high: {f} Hz')
    T = t60 if t60 is not None else float(np.clip(5.5 * (f / 220.0) ** -0.7, 0.8, 9.0))
    # loop gain for the target T60 at f0, capped below 1 so the DC loop gain (|H(0)| = 1) can never
    # exceed unity on high notes
    g = min(10 ** (-3.0 / (T * f)) / abs(H0), 0.9993)
    # read taps: lp(y)[n − N − frac] = Σ_k h_k ((1−frac) y[n−N−k] + frac y[n−N−k−1])
    taps = np.zeros(K + 1)
    taps[:K] += h * (1 - frac)
    taps[1:] += h * frac
    taps *= g
    # excitation: one period of noise, darker for soft plucks, with a pluck-position comb
    L = int(round(period))
    ex = r.uniform(-1, 1, L)
    ex = F.apply(ex, [F.lowpass(min(SR * 0.45, 1200 + 9000 * vel * (0.4 + bright)), 0.6)])
    d = max(1, int(round(pos * L)))
    ex = ex - np.concatenate([np.zeros(d), ex[:-d]])
    ex -= ex.mean()
    x = np.zeros(n); x[:L] = ex
    y = np.zeros(n)
    blk = N - 1
    t0 = 0
    while t0 < n:
        t1 = min(n, t0 + blk)
        k = t1 - t0
        acc = x[t0:t1].copy()
        for j, tap in enumerate(taps):
            s = t0 - N - j
            lo = max(0, -s)
            if lo < k:
                acc[lo:] += tap * y[s + lo:s + k]
        y[t0:t1] = acc
        t0 = t1
    if damp_at is not None and damp_at < dur:
        y *= E.stages([(0, 1, 0), (damp_at, 1, 0), (damp_at + 0.12, 0.0, 3.0)], n)
    # nail/finger transient
    kk = ns(0.003)
    y[:kk] += 0.25 * O.white(kk, r) * np.linspace(1, 0, kk) * vel
    if seed not in _BODY_CACHE:
        _BODY_CACHE[seed] = _body_ir(seed)
    bi = _BODY_CACHE[seed]
    wet = np.vstack([F.fft_convolve(y, bi[c]) for c in range(2)])
    out = stereo(y) * (1 - body) + wet * body * 0.5
    out = F.apply(out, [F.highpass(max(25.0, f * 0.5), 0.7)])
    return out / (np.max(np.abs(out)) + 1e-12) * vel


# ── lamp drone ───────────────────────────────────────────────────────────────────────────────────
def lamp_drone(f: float, dur: float, vel: float = 0.6, seed: str = 'lamp', cutoff=(400.0, 1600.0), lfo_hz: float = 0.05,
               lfo_phase: float = 0.0, attack: float = 1.5, release: float = 2.0, res_db: float = 2.5,
               loop_len: float | None = None, sub: float = 0.0, cutoff_env=None) -> np.ndarray:
    """Three detuned saws (±7 cents) → 24 dB/oct lowpass whose cutoff breathes between cutoff[0]
    and cutoff[1] at lfo_hz. cutoff_env(t) may override the LFO (returns Hz per frame time)."""
    r = rng(f'lamp:{seed}:{f:.2f}')
    n = ns(dur)
    voices = []
    for i, cents in enumerate((-7.0, 0.0, 7.0)):
        fi = _snap(f * 2 ** (cents / 1200.0), loop_len)
        voices.append(O.saw(fi, n, r.uniform(0, 1)))
    out = np.vstack([0.8 * voices[0] + 0.55 * voices[1] + 0.25 * voices[2],
                     0.25 * voices[0] + 0.55 * voices[1] + 0.8 * voices[2]])
    if sub:
        out += sub * O.sine(_snap(f, loop_len), n)[None, :]
    lo, hi = cutoff
    if loop_len and lfo_hz:
        lfo_hz = max(1, round(lfo_hz * loop_len)) / loop_len

    def gains(t, fr):
        if cutoff_env is not None:
            fc = np.asarray(cutoff_env(t), float)
        else:
            m = 0.5 - 0.5 * np.cos(TAU * (lfo_hz * t + lfo_phase))
            fc = lo * (hi / lo) ** m
        return F.lp_curve(fr, fc, order=4, res_db=res_db)

    out = F.stft_filter(out, gains, frame=2048, circular=bool(loop_len))
    if attack or release:
        out *= E.adsr(n, max(attack, 0.005), 0.0, 1.0, max(release, 0.005))[None, :]
    pk = np.max(np.abs(out)) + 1e-12
    return out / pk * vel


# ── frame drum ───────────────────────────────────────────────────────────────────────────────────
DRUM_MODES = (1.0, 1.59, 2.14, 2.3, 2.65, 2.92)


def frame_drum(f0: float = 110.0, vel: float = 0.8, stroke: str = 'doum', seed: str = 'drum', rr: int = 0,
               kick: float | None = None, dur: float = 0.9, tone_t60: float = 0.45) -> np.ndarray:
    """Modal membrane. stroke: 'doum' (centre, deep, stone kick), 'tek' (rim, bright), 'ghost' (soft
    finger), 'roll' (single roll grain). kick overrides the stone-kick amount."""
    r = rng(f'drum:{seed}:{stroke}:{rr}')
    n = ns(dur)
    t = np.arange(n) / SR
    pitch = f0 * 2 ** (r.uniform(-0.12, 0.12) / 12)
    centre = {'doum': 1.0, 'tek': 0.15, 'ghost': 0.4, 'roll': 0.5}[stroke]
    amps = [centre * 1.0 + 0.1, 0.7 - 0.3 * centre, 0.55, 0.5 - 0.3 * centre, 0.4, 0.35]
    t60s = [tone_t60, tone_t60 * 0.6, tone_t60 * 0.45, tone_t60 * 0.4, tone_t60 * 0.3, tone_t60 * 0.25]
    bend = 1.0 + 0.05 * vel * np.exp(-t / 0.035)
    y = np.zeros(n)
    for ratio, a, d in zip(DRUM_MODES, amps, t60s):
        fr = pitch * ratio * bend
        y += a * np.exp(-6.9078 * t / d) * np.sin(TAU * np.cumsum(fr) / SR + r.uniform(0, TAU))
    # skin: noise slap, band-passed (hand on skin)
    kk = ns(0.05)
    slap = O.white(kk, r) * E.decay(kk, 0.035 if stroke != 'tek' else 0.05, 0.0005)
    slap = F.apply(slap, [F.bandpass(2600 if stroke == 'tek' else 1500, 0.9)])
    y[:kk] += slap * (1.6 if stroke == 'tek' else 0.7)
    k_amt = kick if kick is not None else {'doum': 1.0, 'tek': 0.0, 'ghost': 0.15, 'roll': 0.1}[stroke]
    if k_amt:
        fk = 45.0 + 45.0 * np.exp(-t / 0.045)          # stone kick 90 → 45 Hz
        kick_sig = np.sin(TAU * np.cumsum(fk) / SR) * np.exp(-6.9078 * t / 0.42)
        y += k_amt * 1.8 * kick_sig
    atk = ns(0.0008)
    y[:atk] *= np.linspace(0, 1, atk)
    if stroke == 'ghost':
        y *= 0.5
    out = stereo(y)
    return out / (np.max(np.abs(out)) + 1e-12) * vel


# ── escapement ───────────────────────────────────────────────────────────────────────────────────
def escapement(kind: str = 'tick', vel: float = 0.7, seed: str = 'esc', rr: int = 0, wood: float = 1.0,
               band_hz: float = 2500.0, q: float = 4.0, res=(850.0, 1900.0)) -> np.ndarray:
    """Mechanical wooden tick. 'tick' rings the upper resonator, 'tock' the lower one."""
    r = rng(f'esc:{seed}:{kind}:{rr}')
    n = ns(0.12)
    k = ns(0.004)
    burst = O.white(k, r) * E.decay(k, 0.004, 0.0001)
    burst = F.apply(burst, [F.bandpass(band_hz * r.uniform(0.95, 1.05), q)])
    x = np.zeros(n); x[:k] = burst
    lo, hi = res
    if kind == 'tick':
        fr, dc, am = [hi * r.uniform(0.98, 1.02), lo * 1.02, hi * 2.31], [0.05, 0.03, 0.02], [1.0, 0.35, 0.3]
    else:
        fr, dc, am = [lo * r.uniform(0.98, 1.02), hi * 0.97, lo * 2.7], [0.07, 0.03, 0.025], [1.0, 0.3, 0.25]
    body = F.resonate(x, fr, dc, am, 0.1, full=False)
    y = 0.6 * x * 3.0 + wood * body / (np.max(np.abs(body)) + 1e-12)
    y[-ns(0.01):] *= np.linspace(1, 0, ns(0.01))
    out = stereo(y)
    return out / (np.max(np.abs(out)) + 1e-12) * vel


# ── shade breath ─────────────────────────────────────────────────────────────────────────────────
def shade_breath(dur: float, f_start: float = 600.0, f_end: float = 2400.0, q: float = 2.5, vel: float = 0.7,
                 seed: str = 'breath', shape: str = 'swell', peak_at: float | None = None, curve: float = -2.5,
                 order: int = 4, loop_len: float | None = None, width_: float = 1.0, sweep_curve: float = 1.0) -> np.ndarray:
    """Pink noise through a sweeping band-pass. shape: 'swell' (reversed breath: slow rise, sharp
    end), 'breath' (rise then fall), 'flat' (constant; with loop_len it is seamless)."""
    r = rng(f'breath:{seed}')
    n = ns(dur)
    noise = O.pink(n, r, ch=2)
    m, s = 0.5 * (noise[0] + noise[1]), 0.5 * (noise[0] - noise[1]) * width_
    noise = np.vstack([m + s, m - s])

    def gains(t, fr):
        u = np.clip(t / dur, 0.0, 1.0) ** sweep_curve
        fc = f_start * (f_end / f_start) ** u
        if loop_len:
            fc = np.full_like(t, math.sqrt(f_start * f_end))
        return F.bp_curve(fr, fc, q, order)

    y = F.stft_filter(noise, gains, frame=1024, circular=bool(loop_len))
    if shape == 'swell':
        envl = E.swell(n, peak_at if peak_at is not None else dur - 0.03, curve, release=0.03)
    elif shape == 'breath':
        pa = peak_at if peak_at is not None else dur * 0.45
        envl = E.stages([(0, 0, 0), (pa, 1, -2.0), (dur, 0, 2.5)], n)
    else:
        envl = np.ones(n)
    y *= envl[None, :]
    return y / (np.max(np.abs(y)) + 1e-12) * vel


# ── FM shimmer ───────────────────────────────────────────────────────────────────────────────────
def fm_shimmer(f: float, dur: float = 1.6, vel: float = 0.7, seed: str = 'fm', ratio: float = 3.5,
               index_from: float = 2.5, index_to: float = 0.0, decay_s: float = 1.2, detune_cents: float = 3.0,
               attack: float = 0.002) -> np.ndarray:
    """2-op FM bell-shimmer: index sweeps index_from → index_to over decay_s (bright → pure)."""
    r = rng(f'fm:{seed}:{f:.2f}')
    n = ns(dur)
    t = np.arange(n) / SR
    idx = index_to + (index_from - index_to) * np.exp(-t / (decay_s * 0.35))
    out = np.zeros((2, n))
    for c, cents in enumerate((-detune_cents, detune_cents)):
        fc = f * 2 ** (cents / 1200.0)
        out[c] = O.fm(fc, ratio, idx, n, phase0=r.uniform(0, 1))
    out *= E.decay(n, decay_s, attack)[None, :]
    return out / (np.max(np.abs(out)) + 1e-12) * vel
