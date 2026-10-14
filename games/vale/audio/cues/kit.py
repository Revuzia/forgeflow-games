"""Shared building blocks for the VALE cue recipes (lane AUDIO). All original synthesis.

The sound language (STYLE_BIBLE "Audio", tokens.audio):
  Lumen      glass and light: struck dawnglass, FM shimmer, in-key sparkle; rises
  Shade      breath and ink: swept pink noise, reversed swells, bubbling ink, hollow low bells; falls
  physical   stone and wood knocks, a saturated body, opaque chip debris
  magic      glass ping + shimmer over a soft body
  true       a hollow tube pop followed by its own tail played backwards (the inverted swell)
  big        hourbell + frame drum + stone rumble
  UI         glass and wood, short, never shrill

Every helper returns a MONO float array unless it says stereo. Recipes mix layers with
`S.Layers` (levels as peak dB) and end with `finish()`, which peak-normalises so the mastering
chain's tail floor is relative to the cue's own peak.
"""
from __future__ import annotations

import math

import numpy as np

from synth import env as E
from synth import filters as F
from synth import fx
from synth import instruments as I
from synth import osc as O
from synth import sfx as S
from synth.core import SR, TAU, add_at, fade, hz, ns, rng, stereo

Layers = S.Layers
norm = S.norm


def R(cue_id: str, part: str = '', v: int = 0) -> np.random.Generator:
    """Deterministic generator for one layer of one cue variant."""
    return rng(f'cue:{cue_id}:{part}', v)


# ── filters ──────────────────────────────────────────────────────────────────────────────────────
def lp(x: np.ndarray, f: float, q: float = 0.7071) -> np.ndarray:
    return F.apply(x, [F.lowpass(f, q)])


def hp(x: np.ndarray, f: float, q: float = 0.7071) -> np.ndarray:
    return F.apply(x, [F.highpass(f, q)])


def bp(x: np.ndarray, f: float, q: float = 1.0) -> np.ndarray:
    return F.apply(x, [F.bandpass(f, q)])


def peq(x: np.ndarray, f: float, g_db: float, q: float = 1.0) -> np.ndarray:
    return F.apply(x, [F.peaking(f, g_db, q)])


def shelf(x: np.ndarray, f: float, g_db: float, high: bool = True) -> np.ndarray:
    return F.apply(x, [F.highshelf(f, g_db) if high else F.lowshelf(f, g_db)])


def deharsh(x: np.ndarray, g_db: float = -3.0, f: float = 3300.0, q: float = 0.8) -> np.ndarray:
    """A broad dip in the ear's most sensitive band: cues that fire constantly must not stab."""
    return F.apply(x, [F.peaking(f, g_db, q)])


# ── stereo ───────────────────────────────────────────────────────────────────────────────────────
def spread(x: np.ndarray, amt: float = 0.4, ms: float = 0.55, hp_hz: float = 500.0) -> np.ndarray:
    """Mono → stereo by mid/side: side = a delayed, high-passed copy. Collapses back to the dry mono
    exactly (the side cancels), so spatial panning and mono playback stay clean."""
    m = np.asarray(x, float) if x.ndim == 1 else 0.5 * (x[0] + x[1])
    d = max(1, ns(ms / 1000.0))
    s = hp(np.concatenate([np.zeros(d), m[:-d]]), hp_hz) * amt
    return np.vstack([m + s, m - s])


def mono(x: np.ndarray) -> np.ndarray:
    return x if x.ndim == 1 else 0.5 * (x[0] + x[1])


# ── tonal elements ───────────────────────────────────────────────────────────────────────────────
def _voice(x: np.ndarray, width: float = 0.0, fout: float = 0.015) -> np.ndarray:
    """Mono-first wrapper for the shared instruments. dawnglass / hourbell / fm_shimmer render each
    channel with its own partial phases (a wide shimmer in stereo) but their L+R sum partly cancels:
    up to -7 LU on a mono speaker, and a StereoPanner folds L into R when a spatial cue pans. So a cue
    takes ONE channel (a complete voice on its own) and gets width only from mid/side `spread`, which
    sums back to it exactly. Every voice also fades out at its end, so a truncated ring never clicks."""
    xs = np.asarray(x, float)
    m = xs[0].copy() if xs.ndim == 2 else xs.copy()
    m *= (np.max(np.abs(xs)) + 1e-12) / (np.max(np.abs(m)) + 1e-12)
    m = fade(m, 0.0, min(fout, m.size / SR * 0.25))
    return spread(m, width) if width else m


def tink(f: float, dur: float = 0.06, t60: float = 0.05, bright: float = 0.3, attack: float = 0.0015,
         phase: float = 0.0) -> np.ndarray:
    """The smallest glass grain: a sine with faint dawnglass partials and a click-free attack."""
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.sin(TAU * f * t + phase) * np.exp(-6.9078 * t / t60)
    y += 0.5 * bright * np.sin(TAU * f * 2.32 * t + 0.7) * np.exp(-6.9078 * t / (t60 * 0.55))
    y += 0.2 * bright * bright * np.sin(TAU * f * 4.25 * t + 1.9) * np.exp(-6.9078 * t / (t60 * 0.3))
    k = max(2, ns(attack))
    y[:k] *= 0.5 - 0.5 * np.cos(np.pi * np.arange(k) / k)
    return norm(y)


def glass(note, dur: float = 1.0, vel: float = 0.8, decay: float = 1.0, bright: float = 1.0, seed: str = 'cue',
          strike: float = 1.0, width: float = 0.0) -> np.ndarray:
    """Struck dawnglass (mono, or M/S stereo with width)."""
    f = hz(note) if isinstance(note, str) else float(note)
    return _voice(I.dawnglass(f, dur, vel, seed=seed, decay_scale=decay, bright=bright, strike=strike), width)


def bell(note, dur: float | None = None, vel: float = 0.8, decay: float = 1.0, bright: float = 1.0,
         seed: str = 'cue', width: float = 0.0) -> np.ndarray:
    """Hourbell; f is the strike note, the hum sounds an octave below."""
    f = hz(note) if isinstance(note, str) else float(note)
    return _voice(I.hourbell(f, dur, vel, seed=seed, decay_scale=decay, bright=bright), width, 0.03)


def harp(note, dur: float = 0.8, vel: float = 0.8, bright: float = 0.45, damp_at: float | None = None, rr: int = 0,
         seed: str = 'cue', t60: float | None = None, body: float = 0.35, width: float = 0.0) -> np.ndarray:
    """Dial harp pluck (Karplus-Strong)."""
    f = hz(note) if isinstance(note, str) else float(note)
    return _voice(I.dial_harp(f, dur, vel, rr=rr, seed=seed, t60=t60, bright=bright, damp_at=damp_at, body=body), width, 0.04)


def shimmer(note, dur: float = 1.0, vel: float = 0.7, decay: float = 0.8, index: float = 2.5, ratio: float = 3.5,
            seed: str = 'cue', attack: float = 0.002, width: float = 0.0) -> np.ndarray:
    """FM shimmer (2-op, ratio 3.5, index falling to 0)."""
    f = hz(note) if isinstance(note, str) else float(note)
    return _voice(I.fm_shimmer(f, dur, vel, seed=seed, ratio=ratio, index_from=index, decay_s=decay, attack=attack), width)


def breath(dur: float, f0: float, f1: float, shape: str = 'swell', q: float = 2.0, vel: float = 0.8, seed: str = 'cue',
           peak_at: float | None = None, curve: float = -2.5, sweep_curve: float = 1.0, width: float = 1.0) -> np.ndarray:
    """Shade breath (stereo noise; uncorrelated L/R sums to mono at -3 dB with no comb): pink noise
    through a band-pass sweeping f0 → f1."""
    y = I.shade_breath(dur, f0, f1, q, vel, seed=seed, shape=shape, peak_at=peak_at, curve=curve,
                       sweep_curve=sweep_curve, width_=width)
    return fade(y, 0.0, 0.006)          # a swell cut by its impact still ends without a step


def drum(note='D2', vel: float = 0.8, stroke: str = 'doum', seed: str = 'cue', dur: float = 0.8, t60: float = 0.45,
         kick: float | None = None, rr: int = 0) -> np.ndarray:
    f = hz(note) if isinstance(note, str) else float(note)
    return _voice(I.frame_drum(f, vel, stroke, seed=seed, rr=rr, kick=kick, dur=dur, tone_t60=t60), 0.0, 0.03)


def esc(kind: str = 'tick', vel: float = 0.8, rr: int = 0, seed: str = 'cue', res=(850.0, 1900.0), band: float = 2500.0,
        q: float = 4.0, wood: float = 1.0) -> np.ndarray:
    """Escapement tick / tock (mono)."""
    return _voice(I.escapement(kind, vel, seed=seed, rr=rr, wood=wood, band_hz=band, q=q, res=res), 0.0, 0.01)


def fm_tone(f0: float, f1: float, dur: float, ratio: float = 3.5, i0: float = 2.0, i1: float = 0.0, t60: float | None = None,
            attack: float = 0.002, curve: float = 3.0, env: str = 'decay') -> np.ndarray:
    """A pitch-gliding 2-op FM tone (the light 'zing' of bolts and lances)."""
    n = ns(dur)
    u = np.arange(n) / n
    g = (1 - np.exp(-curve * u)) / (1 - np.exp(-curve)) if curve else u
    f = np.exp(np.log(f0) + (np.log(f1) - np.log(f0)) * g)
    idx = i1 + (i0 - i1) * np.exp(-np.arange(n) / SR / max(dur * 0.35, 1e-3))
    y = O.fm(f, ratio, idx, n)
    if env == 'decay':
        y *= E.decay(n, t60 or dur * 0.8, attack)
    elif env == 'swell':
        y *= E.swell(n, dur * 0.9, -2.0, release=dur * 0.1)
    return norm(y)


def sweep(f0: float, f1: float, dur: float, curve: float = 3.0, t60: float | None = None, env: str = 'decay',
          attack: float = 0.002, shape: str = 'sine') -> np.ndarray:
    return S.tone_sweep(f0, f1, dur, curve, t60, attack, shape, env)


def hollow(f: float, dur: float, t60: float, r: np.random.Generator, odd: int = 4, hit_ms: float = 3.0,
           inharm: float = 0.012) -> np.ndarray:
    """A closed tube struck at the mouth: noise into odd-harmonic resonances (f, 3f, 5f …), the
    'hollow' of true damage and Shade bells."""
    n = ns(dur)
    k = ns(hit_ms / 1000.0)
    x = np.zeros(n)
    x[:k] = O.white(k, r) * E.decay(k, hit_ms / 1000.0, 0.0002)
    fr = [f * (2 * i + 1) * (1 + inharm * i * i) for i in range(odd)]
    dc = [t60 * (0.62 ** i) for i in range(odd)]
    am = [1.0 / (1 + 1.2 * i) for i in range(odd)]
    y = F.resonate(x, fr, dc, am, dur, full=False)
    return norm(y)


def bubble(f0: float, dur: float = 0.06, rise: float = 2.2, t60: float = 0.04, attack: float = 0.0015) -> np.ndarray:
    """One ink bubble: a sine whose pitch rises as it decays (the physics of a forming bubble)."""
    n = ns(dur)
    t = np.arange(n) / SR
    f = f0 * (1.0 + (rise - 1.0) * (t / dur))
    y = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-6.9078 * t / t60)
    k = max(2, ns(attack))
    y[:k] *= np.linspace(0, 1, k)
    return y


def ink(r: np.random.Generator, dur: float, count: int, lo: float = 160.0, hi: float = 700.0, spread_s: float = 0.15,
        wash: float = 0.35, wash_hz: float = 420.0) -> np.ndarray:
    """Viscous ink: a scatter of low bubbles over a dark, low-passed wash."""
    n = ns(dur)
    y = np.zeros(n)
    for _ in range(count):
        t0 = r.exponential(spread_s)
        if t0 > dur - 0.05:
            continue
        f0 = math.exp(r.uniform(math.log(lo), math.log(hi)))
        b = bubble(f0, r.uniform(0.04, 0.09), r.uniform(1.6, 2.8), r.uniform(0.025, 0.06))
        add_at(y, b * r.uniform(0.3, 1.0) * math.exp(-t0 / (spread_s * 2.5)), ns(t0))
    if wash:
        w = O.pink(n, r)
        w = F.apply(w, [F.lowpass(wash_hz, 0.9), F.highpass(70, 0.7)])
        w *= E.stages([(0, 0, 0), (min(0.03, dur * 0.2), 1, -1.5), (dur, 0, 2.0)], n)
        y = norm(y) + wash * norm(w)
    return norm(y)


def crumble(r: np.random.Generator, dur: float, count: int, lo: float = 120.0, hi: float = 900.0, spread_s: float = 0.35,
            t60: float = 0.07, material: str = 'stone', level_decay: float | None = None) -> np.ndarray:
    """A cascade of stone knocks (falling masonry), denser and louder early."""
    n = ns(dur)
    y = np.zeros(n)
    ld = level_decay or spread_s * 2.2
    for i in range(count):
        t0 = r.exponential(spread_s)
        if t0 > dur - 0.1:
            continue
        f = math.exp(r.uniform(math.log(lo), math.log(hi)))
        k = S.knock(r, f, t60 * r.uniform(0.6, 1.5), 4, material)
        add_at(y, k * r.uniform(0.25, 1.0) * math.exp(-t0 / ld), ns(t0))
    return norm(y)


def crackle(r: np.random.Generator, dur: float, rate: float = 60.0, lo: float = 1200.0, hi: float = 6000.0,
            hiss: float = 0.15, decay_s: float | None = None) -> np.ndarray:
    """Burning resin / sizzle: Poisson micro-clicks with heavy-tailed sizes over a soft hiss."""
    n = ns(dur)
    y = np.zeros(n)
    m = int(r.poisson(rate * dur))
    for _ in range(m):
        t0 = r.uniform(0, dur - 0.01)
        k = ns(r.uniform(0.0004, 0.002))
        c = O.white(k, r) * np.linspace(1, 0, k) ** 2 * (r.pareto(2.5) + 0.2)
        add_at(y, c, ns(t0))
    y = F.apply(y, [F.highpass(lo, 0.7), F.lowpass(hi, 0.7)])
    if hiss:
        h = F.apply(O.pink(n, r), [F.bandpass(math.sqrt(lo * hi), 0.6)])
        y = norm(y) + hiss * norm(h)
    if decay_s:
        y *= E.decay(n, decay_s, 0.002)
    return norm(y)


def scrape(r: np.random.Generator, dur: float, f: float = 900.0, q: float = 1.2, rough_hz: float = 35.0,
           rough: float = 0.6, peak_at: float = 0.25) -> np.ndarray:
    """Stone scrape / foot scuff: band-passed brown-pink noise with stick-slip roughness."""
    n = ns(dur)
    x = O.coloured(n, r, -4.5)
    x = F.apply(x, [F.bandpass(f, q), F.lowpass(f * 3.5, 0.7)])
    jitter = np.repeat(r.uniform(1 - rough, 1.0, int(dur * rough_hz) + 2), int(SR / rough_hz) + 1)[:n]
    jitter = np.convolve(jitter, np.ones(48) / 48, mode='same')
    envl = E.stages([(0, 0, 0), (dur * peak_at, 1, -1.5), (dur, 0, 2.5)], n)
    return norm(x * jitter * envl)


def roll(note='D2', dur: float = 0.8, rate0: float = 8.0, rate1: float = 24.0, vel0: float = 0.25, vel1: float = 0.8,
         seed: str = 'roll', stroke: str = 'roll') -> np.ndarray:
    """An accelerating frame-drum roll (grains at a rate gliding rate0 → rate1, crescendo)."""
    n = ns(dur)
    y = np.zeros(n)
    t = 0.0
    i = 0
    while t < dur - 0.03:
        u = t / dur
        v = vel0 + (vel1 - vel0) * u ** 1.5
        g = drum(note, v, stroke, seed=seed, dur=0.25, t60=0.18, rr=i % 4)
        add_at(y, g * v, ns(t))
        t += 1.0 / (rate0 + (rate1 - rate0) * u)
        i += 1
    return y


def rev(x: np.ndarray, fin: float = 0.006) -> np.ndarray:
    """Play backwards (pre-swells, the inverted true-damage tail)."""
    return S.reversed_tail(x, fin)


def swell_into(x: np.ndarray, length: float) -> np.ndarray:
    """Reverse the first `length` s of x's ring: a suck-in that ends where x's attack would be."""
    k = min(x.shape[-1], ns(length))
    return rev(x[..., :k].copy() * np.linspace(1, 0.2, k), 0.004)


def flutter(x: np.ndarray, r0: float, r1: float, depth: float = 0.6) -> np.ndarray:
    n = x.shape[-1]
    rate = np.exp(np.linspace(math.log(r0), math.log(r1), n))
    return S.am(x, rate, depth)


def env_ad(n: int, a: float, d: float, curve_a: float = -2.0, curve_d: float = 3.0) -> np.ndarray:
    return E.stages([(0, 0, 0), (a, 1, curve_a), (a + d, 0, curve_d)], n)


# ── spaces ───────────────────────────────────────────────────────────────────────────────────────
def room(x: np.ndarray, name: str, wet: float = 0.2, dry: float = 1.0) -> np.ndarray:
    """'wood' 'tiny' 'small' 'stone' 'glass' 'hall' rooms from sfx.space(), or 'plate'."""
    if name == 'plate':
        return fx.reverb(stereo(x), fx.plate_ir(), wet=wet, dry=dry, tail=True)
    return S.room(x, name, wet, dry)


def finish(x: np.ndarray, hp_hz: float = 28.0, lp_hz: float | None = None, eq=None) -> np.ndarray:
    """Final clean-up of a recipe: stereo, rumble-free, optional tone EQ, peak 1.0."""
    y = stereo(np.asarray(x, float))
    fl = [F.highpass(hp_hz, 0.7071)]
    if lp_hz:
        fl.append(F.lowpass(lp_hz, 0.7071))
    for b in eq or []:
        k = b[0]
        if k == 'peak':
            fl.append(F.peaking(b[1], b[2], b[3] if len(b) > 3 else 1.0))
        elif k == 'high':
            fl.append(F.highshelf(b[1], b[2]))
        elif k == 'low':
            fl.append(F.lowshelf(b[1], b[2]))
    y = F.apply(y, fl)
    return norm(y)


def at_len(x: np.ndarray, dur: float, fout: float = 0.02) -> np.ndarray:
    """Cut a layer to dur seconds with a cosine fade (keeps a recipe's length deliberate)."""
    k = ns(dur)
    y = x[..., :k].copy()
    return fade(y, 0.0, min(fout, dur * 0.5))
