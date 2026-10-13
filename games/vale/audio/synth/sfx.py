"""One-shot sound-design primitives for VALE cues (lane AUDIO). All original synthesis.

Every primitive returns a MONO float array (peak-normalised to 1.0 unless stated) so a cue can be
built as layers with explicit dB levels. `Layers` mixes them (with positions, pans, widths) into a
stereo buffer; `space()` gives short generated rooms for tails.

The impact recipe used across combat cues (a shipped-game punch):
    transient (snap/click, 1-4 ms)  +  body (pitch-dropping thump, 60-200 ms, saturated so it reads
    on laptop speakers)  +  mid knock (stone/wood modes)  +  chips (opaque debris)  +  tail (short room)
Lumen (light) sounds are glass: inharmonic partials, bright, rising. Shade (ink) sounds are breath:
noise sweeps, hollow low bells, falling. Up means help, out means harm.
"""
from __future__ import annotations

import math

import numpy as np

from . import env as E
from . import filters as F
from . import fx
from . import instruments as I
from . import osc as O
from .core import SR, TAU, add_at, db, fade, hz, midi, ns, rng, stereo, width as stereo_width

# D Dorian + Lydian G# palette, as MIDI numbers, for in-key sparkle and tonal pings
DORIAN_PCS = (2, 4, 5, 7, 9, 11, 0)           # D E F G A B C
COLOUR_PCS = DORIAN_PCS + (8,)                 # + G#


def norm(x: np.ndarray, peak: float = 1.0) -> np.ndarray:
    p = float(np.max(np.abs(x))) if x.size else 0.0
    return x * (peak / p) if p > 1e-12 else x


def scale_pitches(lo: int, hi: int, pcs=DORIAN_PCS) -> list[int]:
    return [m for m in range(lo, hi + 1) if m % 12 in pcs]


# ── mixing ───────────────────────────────────────────────────────────────────────────────────────
class Layers:
    """Accumulate layers into a stereo buffer. Positions in seconds; levels in dB; mono layers are
    panned (equal power), stereo layers are balanced; the buffer grows to fit."""

    def __init__(self, dur: float = 0.5):
        self.buf = np.zeros((2, max(1, ns(dur))))

    def add(self, sig: np.ndarray, t: float = 0.0, gain_db: float = 0.0, pan: float = 0.0, width: float = 1.0,
            peak_db: float | None = None) -> 'Layers':
        s = np.asarray(sig, float)
        if peak_db is not None:
            s = norm(s) * db(peak_db)
        else:
            s = s * db(gain_db)
        if s.ndim == 1:
            a = (pan + 1.0) * 0.25 * math.pi
            s = np.vstack([s * math.cos(a) * math.sqrt(2), s * math.sin(a) * math.sqrt(2)])
        elif pan:
            a = (pan + 1.0) * 0.25 * math.pi
            s = np.vstack([s[0] * min(1.0, math.cos(a) * math.sqrt(2)), s[1] * min(1.0, math.sin(a) * math.sqrt(2))])
        if width != 1.0 and s.ndim == 2:
            s = stereo_width(s, width)
        start = int(round(t * SR))
        need = start + s.shape[-1]
        if need > self.buf.shape[1]:
            self.buf = np.pad(self.buf, ((0, 0), (0, need - self.buf.shape[1])))
        add_at(self.buf, s, start)
        return self

    def out(self) -> np.ndarray:
        return self.buf


# ── rooms ────────────────────────────────────────────────────────────────────────────────────────
_SPACES: dict[str, np.ndarray] = {}


def space(name: str) -> np.ndarray:
    """Short generated rooms: 'wood' (UI, 0.25 s), 'tiny' (hits, 0.2 s), 'small' (0.45 s), 'stone'
    (combat tail, 0.9 s), 'glass' (bright plate-like, 0.7 s), 'hall' (stings; the bible hall)."""
    if name not in _SPACES:
        if name == 'wood':
            _SPACES[name] = fx.shaped_ir('sfx_wood', 0.28, 0.18, predelay_ms=2, er_ms=14, er_count=8, hp_hz=220, lp_hz=8500)
        elif name == 'tiny':
            _SPACES[name] = fx.shaped_ir('sfx_tiny', 0.2, 0.12, predelay_ms=1, er_ms=9, er_count=6, hp_hz=160, lp_hz=9000)
        elif name == 'small':
            _SPACES[name] = fx.shaped_ir('sfx_small', 0.5, 0.3, predelay_ms=4, er_ms=24, er_count=10, hp_hz=140, lp_hz=10000)
        elif name == 'stone':
            _SPACES[name] = fx.shaped_ir('sfx_stone', 1.0, 0.45, predelay_ms=7, er_ms=38, er_count=12, hp_hz=90, lp_hz=7500)
        elif name == 'glass':
            _SPACES[name] = fx.shaped_ir('sfx_glass', 0.8, 0.9, predelay_ms=3, er_ms=16, er_count=8, hp_hz=300, lp_hz=15000)
        elif name == 'hall':
            _SPACES[name] = fx.hall_ir()
        else:
            raise KeyError(name)
    return _SPACES[name]


def room(x: np.ndarray, name: str, wet: float = 0.2, dry: float = 1.0, tail: bool = True) -> np.ndarray:
    return fx.reverb(stereo(x), space(name), wet=wet, dry=dry, tail=tail)


# ── basic elements ───────────────────────────────────────────────────────────────────────────────
def burst(r: np.random.Generator, dur: float, lo: float, hi: float, t60: float, attack: float = 0.0003,
          q: float = 0.7) -> np.ndarray:
    """Band-limited noise burst with an exponential decay (the snap / crunch / chip element)."""
    n = ns(dur)
    x = O.white(n, r) * E.decay(n, t60, attack)
    return norm(F.apply(x, [F.highpass(lo, q), F.lowpass(min(hi, SR * 0.45), q)]))


def thump(dur: float = 0.3, f0: float = 140.0, f1: float = 50.0, drop: float = 0.035, t60: float = 0.2,
          drive: float = 1.8, attack: float = 0.0008, bend_curve: float = 1.0) -> np.ndarray:
    """Pitch-dropping sine body, saturated so its 2nd/3rd harmonics carry it on small speakers."""
    n = ns(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-(t / drop) ** bend_curve)
    y = np.sin(TAU * np.cumsum(f) / SR) * E.decay(n, t60, attack)
    return norm(fx.saturate(y, drive)) if drive else norm(y)


def knock(r: np.random.Generator, f: float, t60: float = 0.07, n_modes: int = 5, material: str = 'stone',
          dur: float | None = None, hit: float = 0.004) -> np.ndarray:
    """Struck stone / wood: a short noise tap exciting inharmonic decaying modes."""
    ratios = {'stone': (1.0, 1.47, 2.09, 2.56, 3.18, 3.9), 'wood': (1.0, 2.01, 3.4, 4.75, 6.2, 8.1),
              'clay': (1.0, 1.6, 2.3, 3.1, 4.0, 5.2)}[material]
    amps = (1.0, 0.7, 0.5, 0.38, 0.25, 0.16)
    fr = [f * ratios[i] * r.uniform(0.985, 1.015) for i in range(min(n_modes, len(ratios)))]
    dc = [t60 * (0.85 ** i) for i in range(len(fr))]
    L = dur or t60 * 1.1
    k = ns(hit)
    x = np.zeros(ns(L))
    x[:k] = O.white(k, r) * E.decay(k, hit, 0.0001)
    y = F.resonate(x, fr, dc, amps[:len(fr)], L, full=False)
    return norm(y)


def snap(r: np.random.Generator, bright: float = 4500.0, ms: float = 2.5) -> np.ndarray:
    """The transient: a hard 1-4 ms click with a little pitched tick riding it."""
    n = ns(0.012)
    k = ns(ms / 1000.0)
    x = np.zeros(n)
    x[:k] = O.white(k, r) * np.linspace(1, 0.1, k) ** 2
    x = F.apply(x, [F.highpass(bright * 0.45, 0.7), F.peaking(bright, 5, 1.4)])
    tt = np.arange(n) / SR
    x += 0.5 * np.sin(TAU * bright * 0.8 * tt) * np.exp(-tt / 0.0009)
    return norm(x)


def chips(r: np.random.Generator, dur: float, count: int, lo: float = 1800.0, hi: float = 9000.0, density_decay: float = 0.12,
          level_decay: float = 0.15) -> np.ndarray:
    """Opaque debris: a scatter of tiny clicks that thins out over time (stone chips, glass bits)."""
    n = ns(dur)
    y = np.zeros(n)
    for _ in range(count):
        t0 = r.exponential(density_decay)
        if t0 >= dur - 0.01:
            continue
        fc = math.exp(r.uniform(math.log(lo), math.log(hi)))
        k = ns(r.uniform(0.0012, 0.004))
        c = O.white(k, r) * E.decay(k, k / SR * 0.8, 0.0001)
        c = F.apply(c, [F.bandpass(fc, 3.0)]) * math.exp(-t0 / level_decay) * r.uniform(0.4, 1.0)
        add_at(y, c, ns(t0))
    return norm(y)


def whoosh(r: np.random.Generator, dur: float, f0: float, f1: float, q: float = 1.4, peak_at: float = 0.45,
           f_mid: float | None = None, order: int = 4, rise: float = -1.6, fall: float = 2.2, low_body: float = 0.0,
           width_: float = 1.0) -> np.ndarray:
    """Band-passed noise pass-by. The centre frequency glides f0 → f_mid (at peak) → f1; amplitude
    swells to the peak then falls. low_body adds a warm low-mid layer (heavy swings)."""
    n = ns(dur)
    noise = O.pink(n, r, ch=2)
    m, s = 0.5 * (noise[0] + noise[1]), 0.5 * (noise[0] - noise[1]) * width_
    noise = np.vstack([m + s, m - s])
    fm_ = f_mid if f_mid is not None else math.sqrt(f0 * f1)

    def gains(t, fr):
        u = np.clip(t / dur, 0, 1)
        up = np.clip(u / max(peak_at, 1e-3), 0, 1)
        dn = np.clip((u - peak_at) / max(1 - peak_at, 1e-3), 0, 1)
        lf = np.where(u < peak_at, np.log(f0) + (np.log(fm_) - np.log(f0)) * up, np.log(fm_) + (np.log(f1) - np.log(fm_)) * dn)
        g = F.bp_curve(fr, np.exp(lf), q, order)
        if low_body:
            g = g + low_body * F.bp_curve(fr, np.exp(lf) * 0.38, 0.9, 2)
        return g

    y = F.stft_filter(noise, gains, frame=1024, circular=False)
    pk = max(int(peak_at * n), 2)
    env = np.concatenate([E._seg(pk, 0.0, 1.0, rise), E._seg(n - pk, 1.0, 0.0, fall)])
    y = y * env[None, :n]
    return norm(y)


def tone_sweep(f0: float, f1: float, dur: float, curve: float = 3.0, t60: float | None = None, attack: float = 0.002,
               shape: str = 'sine', env_shape: str = 'decay') -> np.ndarray:
    """Pitch-gliding tone. curve>0 = fast start of the glide. env_shape: 'decay' | 'swell' | 'flat'."""
    n = ns(dur)
    x = np.arange(n) / n
    if curve:
        x = (1 - np.exp(-curve * x)) / (1 - np.exp(-curve))
    f = np.exp(np.log(f0) + (np.log(f1) - np.log(f0)) * x)
    if shape == 'sine':
        y = O.sine(f, n)
    elif shape == 'tri':
        y = O.triangle(f, n)
    else:
        y = O.saw(f, n)
    if env_shape == 'decay':
        y *= E.decay(n, t60 or dur * 0.8, attack)
    elif env_shape == 'swell':
        y *= E.swell(n, dur * 0.85, -2.0, release=dur * 0.15)
    return norm(y)


def partials(f: float, ratios, amps, t60s, dur: float, r: np.random.Generator, detune_hz: float = 0.0,
             attack: float = 0.0006) -> np.ndarray:
    """Ad-hoc additive struck object (glass / bell / metal). ratios×f, per-partial T60."""
    n = ns(dur)
    parts = [(rt, a, t, detune_hz * (1 + 0.3 * i)) for i, (rt, a, t) in enumerate(zip(ratios, amps, t60s))]
    y = O.additive(f, parts, n, r)
    k = max(2, ns(attack))
    y[:k] *= np.linspace(0, 1, k)
    return norm(y)


GLASS_R = (1.0, 2.32, 4.25, 6.63)
SHARD_R = (1.0, 2.76, 5.4, 8.9)
BELL_R = (0.5, 1.0, 1.2, 1.5, 2.0, 2.51, 3.0, 4.0)


def glass_ping(f: float, dur: float = 0.4, t60: float = 0.3, bright: float = 1.0, r: np.random.Generator | None = None,
               detune_hz: float = 0.0) -> np.ndarray:
    r = r or rng(f'gp{f:.1f}')
    amps = (1.0, 0.5 * bright, 0.28 * bright * bright, 0.16 * bright ** 3)
    return partials(f, GLASS_R, amps, (t60, t60 * 0.5, t60 * 0.28, t60 * 0.14), dur, r, detune_hz)


def shards(r: np.random.Generator, dur: float, count: int, lo: float = 2200.0, hi: float = 9500.0, spread: float = 0.12,
           t60_hi: float = 0.12, t60_lo: float = 0.45) -> np.ndarray:
    """Glass breaking: many small inharmonic pings with staggered onsets (denser early)."""
    n = ns(dur)
    y = np.zeros(n)
    for _ in range(count):
        t0 = r.exponential(spread)
        if t0 > dur - 0.03:
            continue
        f = math.exp(r.uniform(math.log(lo), math.log(hi)))
        t60 = float(np.interp(math.log(f), [math.log(lo), math.log(hi)], [t60_lo, t60_hi])) * r.uniform(0.6, 1.3)
        k = ns(min(t60 * 1.2, dur - t0))
        p = partials(f, SHARD_R[:3], (1.0, 0.45, 0.2), (t60, t60 * 0.5, t60 * 0.25), k / SR, r)
        add_at(y, p * r.uniform(0.25, 1.0) * math.exp(-t0 / (spread * 3.5)), ns(t0))
    return norm(y)


def sparkle(r: np.random.Generator, dur: float, count: int, lo_midi: int = 84, hi_midi: int = 108, t60: float = 0.18,
            rise: bool = False, pcs=DORIAN_PCS, decay_level: float = 0.0) -> np.ndarray:
    """In-key glass sparkle: short sine grains on D Dorian pitches. rise=True sorts them upward in time."""
    n = ns(dur)
    y = np.zeros(n)
    pitches = scale_pitches(lo_midi, hi_midi, pcs)
    times = np.sort(r.uniform(0, max(dur - 0.05, 0.01), count))
    ps = np.sort(r.choice(pitches, count)) if rise else r.choice(pitches, count)
    for t0, m in zip(times, ps):
        f = 440.0 * 2 ** ((m - 69) / 12)
        k = ns(t60 * 1.4)
        tt = np.arange(k) / SR
        g = (np.sin(TAU * f * tt) + 0.35 * np.sin(TAU * f * 2.32 * tt) * np.exp(-tt / (t60 * 0.3))) * np.exp(-6.9 * tt / t60)
        g[:ns(0.0006)] *= np.linspace(0, 1, ns(0.0006))
        lvl = r.uniform(0.35, 1.0) * math.exp(-decay_level * t0 / max(dur, 1e-3))
        add_at(y, g * lvl, ns(t0))
    return norm(y)


def rumble(r: np.random.Generator, dur: float, lp: float = 140.0, t60: float = 0.8, attack: float = 0.01, hp: float = 22.0,
           rough: float = 0.35) -> np.ndarray:
    """Low stone rumble: brown-ish noise through a lowpass with a decaying envelope and slow roughness."""
    n = ns(dur)
    x = O.coloured(n, r, -6.0)
    x = F.apply(x, [F.highpass(hp, 0.7), F.lowpass(lp, 0.8), F.lowpass(lp * 1.4, 0.7)])
    t = np.arange(n) / SR
    rough_env = 1.0 + rough * np.sin(TAU * (9.0 * t + r.uniform(0, 1))) * np.exp(-t / (t60 * 0.5))
    return norm(x * E.decay(n, t60, attack) * rough_env)


def formants(x: np.ndarray, f1: np.ndarray, f2: np.ndarray, q: float = 4.0, mix: float = 0.9) -> np.ndarray:
    """Sweep two vowel-like formant bands through x (time-varying band-pass pair; f1/f2 per-sample arrays,
    used at 512-sample resolution) — growls and roars."""
    n = x.shape[-1]

    def gains(t, fr):
        idx = np.clip((t * SR).astype(int), 0, n - 1)
        g = F.bp_curve(fr, f1[idx], q, 2) + 0.7 * F.bp_curve(fr, f2[idx], q, 2)
        return (1 - mix) + mix * g

    return F.stft_filter(x, gains, frame=1024, circular=False)


def reversed_tail(x: np.ndarray, fade_in: float = 0.01) -> np.ndarray:
    """Reverse a sound (for suck-in pre-swells / inversion tells)."""
    y = x[..., ::-1].copy()
    return fade(y, fade_in, 0.0)


def am(x: np.ndarray, rate: float | np.ndarray, depth: float = 0.5, phase: float = 0.0) -> np.ndarray:
    """Amplitude modulation (tremolo) — rate may be a per-sample array (accelerating flutter)."""
    n = x.shape[-1]
    ph = O.phase_of(rate, n, phase)
    return x * (1.0 - depth * 0.5 + depth * 0.5 * np.sin(TAU * ph))


def lp_sweep(x: np.ndarray, f0: float, f1: float, q: float = 0.8) -> np.ndarray:
    """Time-varying low-pass sweep f0 → f1 over the length of x (smooth, via STFT magnitudes)."""
    n = x.shape[-1]

    def gains(t, fr):
        u = np.clip(t * SR / max(n, 1), 0, 1)
        fc = np.exp(np.log(f0) + (np.log(f1) - np.log(f0)) * u)
        return F.lp_curve(fr, fc, 4, 0.0)

    return F.stft_filter(x, gains, frame=1024)


def soft_clip(x: np.ndarray, drive: float = 1.4) -> np.ndarray:
    """Output-stage soft clipper (tanh, peak preserved) — adds punch density before limiting."""
    y = np.tanh(x * drive)
    pk = float(np.max(np.abs(x))) + 1e-12
    return y * (pk / (float(np.max(np.abs(y))) + 1e-12))


def pluck(note: str | float, dur: float = 1.2, vel: float = 0.8, t60: float | None = None, bright: float = 0.45, seed: str = 'cue',
          rr: int = 0) -> np.ndarray:
    return I.dial_harp(hz(note), dur, vel, rr=rr, seed=seed, t60=t60, bright=bright)


def bell(note: str | float, dur: float | None = None, vel: float = 0.8, decay: float = 1.0, seed: str = 'cue',
         bright: float = 1.0) -> np.ndarray:
    return I.hourbell(hz(note), dur, vel, seed=seed, decay_scale=decay, bright=bright)


def glass(note: str | float, dur: float = 1.5, vel: float = 0.8, decay: float = 1.0, seed: str = 'cue',
          bright: float = 1.0) -> np.ndarray:
    return I.dawnglass(hz(note), dur, vel, seed=seed, decay_scale=decay, bright=bright)


def shimmer(note: str | float, dur: float = 1.2, vel: float = 0.6, decay: float = 1.0, index: float = 2.5, seed: str = 'cue') -> np.ndarray:
    return I.fm_shimmer(hz(note), dur, vel, seed=seed, decay_s=decay, index_from=index)


def breath(dur: float, f0: float, f1: float, shape: str = 'swell', q: float = 2.0, vel: float = 0.8, seed: str = 'cue',
           peak_at: float | None = None, curve: float = -2.5) -> np.ndarray:
    return I.shade_breath(dur, f0, f1, q, vel, seed=seed, shape=shape, peak_at=peak_at, curve=curve)


def drum(note: str | float = 'D2', vel: float = 0.8, stroke: str = 'doum', seed: str = 'cue', dur: float = 0.8, t60: float = 0.45,
         kick: float | None = None) -> np.ndarray:
    return I.frame_drum(hz(note), vel, stroke, seed=seed, dur=dur, tone_t60=t60, kick=kick)


def mono_of(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else 0.5 * (x[0] + x[1])
