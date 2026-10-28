"""World ambience (bus `ambience`): the seamless loops the engine places at a map's art.ambient points
(content binds 'ambient.<map id>.<source>'; src/audio/index.ts `ambience`). All original synthesis, in the
Vale's own fiction (_design/WORLD.md):

    RIFT     amb_rift_air       the valley's breeze over the carved hour-lines (the map-wide bed)
             amb_rift_canopy    leaves stirring in the jungle canopy (at the canopy motes)
             amb_rift_water     the Fallen Shaft's shallows lapping at the needle segments (at the glints)
             amb_rift_insects   dial-crickets: insects that keep time in escapement ticks (at the shallows' insects)
    BRIDGE   amb_bridge_air     the high wind over Needlespan, a thin whistle off the shaft (the bed)
             amb_bridge_updraft the gorge breathing up past the deck's edges (at the updraft points)
             amb_bridge_creak   the fallen needle settling: slow stone groans, chalk grit trickling (at the dust)
    FRAY     amb_fray_murmur    the Shadowless Noon fair beyond the rim: a warm, far crowd, stall bells (the bed)
             amb_fray_bunting   bunting fluttering on the rim
             amb_fray_lantern   paper lanterns turning, small glass chimes under them
    shared   amb_lamp_flame     a resin lamp's flame: a soft roar, flicker and crackle over a low warm hum
             amb_wren           dialwrens: short, ticking glass-whistle phrases from the flock

Every layer is periodic in the loop's length (frequency-domain noise, circular filtering, modulations with
whole cycles, scattered events wrapped across the seam), so each file loops sample-exactly (build.py encodes
loops seamlessly and QA's the seam). Positional emitters are mono (the engine pans them toward their points);
the beds are wide stereo that sums to mono without combing. Asset loudness (gated integrated): beds -23 LUFS
(the music beds' level), positional emitters -25; content/audio.json sets the cue gains.
"""
from __future__ import annotations

import math

import numpy as np

from cuelib import cue
from synth import env as E
from synth import filters as F
from synth import instruments as I
from synth import osc as O
from synth import sfx as S
from synth.core import SR, TAU, add_at, hz, ns

from .kit import R, bubble, norm

LOOPK = dict(loop=True, max_gr_db=6.0)
SEAM_GUARD_S = 0.03


def win(d: float) -> tuple[float, float]:
    return (d - 0.01, d + 0.01)


# ── periodic building blocks ─────────────────────────────────────────────────────────────────────
def wobble(n: int, r: np.random.Generator, cycles=(1, 2, 3, 5), depth: float = 0.5) -> np.ndarray:
    """A smooth, periodic random envelope in [1 - depth, 1 + depth]: a few sines with whole cycles per loop."""
    t = np.arange(n) / n
    y = np.zeros(n)
    for c in cycles:
        y += r.uniform(0.4, 1.0) / math.sqrt(c) * np.sin(TAU * c * t + r.uniform(0, TAU))
    y /= np.max(np.abs(y)) + 1e-12
    return np.roll(1.0 + depth * y, -int(np.argmin(y)))      # the loop's seam sits in a lull


def at_frames(env: np.ndarray, t: np.ndarray) -> np.ndarray:
    """Sample a per-sample periodic envelope at STFT frame times (which run past both ends when circular)."""
    n = env.size
    idx = np.mod(np.round(np.asarray(t) * SR).astype(int), n)
    return env[idx]


def band_noise(n: int, r: np.random.Generator, centre: np.ndarray, q: float, slope: float = -3.0, order: int = 2,
               ch: int = 1) -> np.ndarray:
    """Coloured noise through a band-pass whose centre follows a per-sample periodic curve (circular)."""
    x = O.coloured(n, r, slope, ch)

    def gains(t, fr):
        return F.bp_curve(fr, at_frames(centre, t), q, order)

    return F.stft_filter(x, gains, frame=2048, circular=True)


def scatter(n: int, r: np.random.Generator, rate: float, make, gate: np.ndarray | None = None) -> np.ndarray:
    """Poisson events over the loop (rate per second; `gate` thins them by a 0..1 envelope), each wrapped across
    the seam. make(r) returns a mono grain."""
    y = np.zeros(n)
    count = int(r.poisson(rate * n / SR))
    for _ in range(count):
        s = onset(r, n)
        if gate is not None and r.uniform() > gate[s]:
            continue
        add_at(y, make(r), s, wrap=True)
    return y


def onset(r: np.random.Generator, n: int, lo: float = 0.0, hi: float | None = None) -> int:
    """A random event onset in [lo, hi) s, never within SEAM_GUARD_S of the loop's seam (an event may ring across
    the wrap, but its transient never lands on it: build.py's seam check, and the codec, would hear a step)."""
    hi_s = n / SR if hi is None else hi
    while True:
        s = int(r.uniform(lo, hi_s) * SR) % n
        if ns(SEAM_GUARD_S) <= s <= n - ns(SEAM_GUARD_S):
            return s


def grain(r: np.random.Generator, lo: float, hi: float, ms=(4.0, 25.0), q: float = 1.2) -> np.ndarray:
    """A tiny band-passed noise grain (a leaf, a grit, a paper fold)."""
    k = ns(r.uniform(*ms) / 1000.0)
    g = O.white(k, r) * np.hanning(k)
    fc = math.exp(r.uniform(math.log(lo), math.log(hi)))
    return F.apply(g, [F.bandpass(fc, q)]) * r.uniform(0.2, 1.0)


def wide(m: np.ndarray, s: np.ndarray, amt: float) -> np.ndarray:
    """Mid + an independent side layer: wide in stereo, exactly `m` in mono."""
    return np.vstack([m + amt * s, m - amt * s])


def loop_out(x: np.ndarray, hp_hz: float = 30.0, lp_hz: float | None = None) -> np.ndarray:
    """Circular clean-up and peak 1.0 (the mastering chain sets the level)."""
    fl = [F.highpass(hp_hz, 0.7071)]
    if lp_hz:
        fl.append(F.lowpass(lp_hz, 0.7071))
    y = F.apply(np.asarray(x, float), fl, circular=True)
    return norm(y)


# ── RIFT ─────────────────────────────────────────────────────────────────────────────────────────
@cue('amb_rift_air', 'loop', ('int', -23.0), win(12.0), **LOOPK)
def amb_rift_air(v: int):
    """The valley breeze over the hour-lines: a warm low wind rising and settling in slow gusts, a faint airy
    top that follows them, wide and soft. No tone (the score owns the key)."""
    r = R('amb_rift_air', v=v)
    D = 12.0
    n = ns(D)
    gust = wobble(n, r, (1, 2, 3, 5), 0.55)
    low = band_noise(n, r, 260.0 * gust ** 1.2, 0.7, slope=-4.5, ch=2)
    air = band_noise(n, r, 2400.0 * gust ** 0.6, 0.9, slope=-2.0, ch=2)
    g2 = gust ** 2
    m = 0.5 * (low[0] + low[1]) * g2 + 0.18 * 0.5 * (air[0] + air[1]) * g2 ** 1.5
    s = 0.5 * (low[0] - low[1]) * g2 + 0.18 * 0.5 * (air[0] - air[1]) * g2 ** 1.5
    return loop_out(wide(m, s, 0.8), hp_hz=40, lp_hz=7000)


@cue('amb_rift_canopy', 'loop', ('int', -25.0), win(8.0), **LOOPK)
def amb_rift_canopy(v: int):
    """Leaves stirring in the canopy: a dense rustle of tiny leaf grains swelling with each gust, over a soft
    breath of wind through the branches."""
    r = R('amb_rift_canopy', v=v)
    D = 8.0
    n = ns(D)
    gust = wobble(n, r, (1, 2, 3), 0.7)
    gate = np.clip(gust / gust.max(), 0, 1) ** 1.5
    rustle = scatter(n, r, 900.0, lambda rr: grain(rr, 1800, 6500, (3.0, 14.0), 1.4), gate)
    rustle = F.apply(rustle, [F.highpass(1200, 0.7), F.lowpass(8000, 0.7)], circular=True)
    breath = band_noise(n, r, 900.0 * gust ** 0.8, 0.8, slope=-3.0) * gust ** 2
    return loop_out(norm(rustle) * 0.8 + norm(breath) * 0.35, hp_hz=200, lp_hz=9000)


@cue('amb_rift_water', 'loop', ('int', -25.0), win(8.0), **LOOPK)
def amb_rift_water(v: int):
    """The shallows lapping at the needle segments: three slow laps of a dark wash per loop, small bubbles and
    drips clustered on each lap, a thin trickle between them."""
    r = R('amb_rift_water', v=v)
    D = 8.0
    n = ns(D)
    t = np.arange(n) / n
    lap = 0.5 - 0.5 * np.cos(TAU * 3 * t + 0.4 * np.sin(TAU * t))     # three laps, unevenly spaced
    lap = lap ** 2 * wobble(n, r, (1, 2), 0.25)
    wash = band_noise(n, r, 380.0 * (0.7 + 0.6 * lap), 0.9, slope=-4.0) * (0.25 + lap)
    bub = np.zeros(n)
    count = int(r.poisson(14 * D))
    for _ in range(count):
        s = onset(r, n)
        if r.uniform() > 0.25 + 0.75 * lap[s]:
            continue
        f0 = math.exp(r.uniform(math.log(350), math.log(1300)))
        b = bubble(f0, r.uniform(0.03, 0.07), r.uniform(1.5, 2.4), r.uniform(0.015, 0.04))
        add_at(bub, b * r.uniform(0.2, 1.0), s, wrap=True)
    trickle = scatter(n, r, 160.0, lambda rr: grain(rr, 2500, 6000, (2.0, 8.0), 2.0))
    out = norm(wash) * 0.9 + norm(bub) * 0.45 + norm(trickle) * 0.12
    return loop_out(out, hp_hz=60, lp_hz=7500)


@cue('amb_rift_insects', 'loop', ('int', -25.0), win(6.0), **LOOPK)
def amb_rift_insects(v: int):
    """Dial-crickets, the Vale's clock insects: two of them trade trains of tiny escapement ticks (one at about
    4.3 kHz in fours, one lower in threes, answering), over the faintest wing-hiss."""
    r = R('amb_rift_insects', v=v)
    D = 6.0
    n = ns(D)
    y = np.zeros(n)

    def tick(f: float, rr: np.random.Generator) -> np.ndarray:
        k = ns(0.012)
        tt = np.arange(k) / SR
        x = np.sin(TAU * f * tt) * np.exp(-tt / 0.0025) + 0.4 * np.sin(TAU * f * 1.48 * tt) * np.exp(-tt / 0.0015)
        x[:ns(0.0004)] *= np.linspace(0, 1, ns(0.0004))
        return x * rr.uniform(0.7, 1.0)

    for (f, per, every, lvl, off) in ((4300.0, 4, 0.75, 1.0, 0.06), (3550.0, 3, 1.0, 0.6, 0.43)):
        tcur = off
        while tcur < D - SEAM_GUARD_S - 4 * 0.034:
            if r.uniform() < 0.85:
                for j in range(per):
                    add_at(y, tick(f * r.uniform(0.99, 1.01), r) * lvl, ns(tcur + j * 0.034), wrap=True)
            tcur += every * r.uniform(0.92, 1.08)
    hiss = band_noise(n, r, np.full(n, 5200.0), 2.0, slope=0.0)
    return loop_out(norm(y) + 0.05 * norm(hiss), hp_hz=1500, lp_hz=9000)


# ── BRIDGE ───────────────────────────────────────────────────────────────────────────────────────
@cue('amb_bridge_air', 'loop', ('int', -23.0), win(12.0), **LOOPK)
def amb_bridge_air(v: int):
    """High wind over Needlespan: a broad, exposed rush in long gusts, a thin whistle off the shaft's carved
    edge that bends with them, and the gorge's low breath far underneath. Wide."""
    r = R('amb_bridge_air', v=v)
    D = 12.0
    n = ns(D)
    gust = wobble(n, r, (1, 2, 3, 4), 0.6)
    rush = band_noise(n, r, 520.0 * gust ** 1.1, 0.7, slope=-3.5, ch=2)
    whistle = band_noise(n, r, 780.0 * gust ** 0.35, 14.0, slope=-1.0, order=4)
    low = band_noise(n, r, np.full(n, 70.0), 0.8, slope=-6.0, ch=2)
    g2 = gust ** 2
    wg = np.clip(gust - 1.0, 0, None) ** 1.5
    m = 0.5 * (rush[0] + rush[1]) * g2 + 0.5 * norm(whistle) * np.max(np.abs(rush)) * wg + 0.8 * 0.5 * (low[0] + low[1])
    s = 0.5 * (rush[0] - rush[1]) * g2 + 0.8 * 0.5 * (low[0] - low[1])
    return loop_out(wide(m, s, 0.85), hp_hz=30, lp_hz=6500)


@cue('amb_bridge_updraft', 'loop', ('int', -25.0), win(8.0), **LOOPK)
def amb_bridge_updraft(v: int):
    """The gorge breathing up past the deck's edge: two long rising rushes per loop (the band climbs as each
    one swells) over a steady low pull of air."""
    r = R('amb_bridge_updraft', v=v)
    D = 8.0
    n = ns(D)
    t = np.arange(n) / n
    ph = (2 * t + 0.08 * np.sin(TAU * t)) % 1.0                       # two rises, a little uneven
    rise = np.sin(np.pi * ph) ** 2                                     # each rise swells and settles
    centre = 300.0 * (5.0 ** (ph ** 1.4)) * (0.6 + 0.4 * rise) + 150.0
    body = band_noise(n, r, centre, 0.9, slope=-3.0) * (0.06 + rise)
    pull = band_noise(n, r, np.full(n, 160.0), 0.8, slope=-5.0) * wobble(n, r, (1, 3), 0.3)
    return loop_out(norm(body) + 0.5 * norm(pull), hp_hz=45, lp_hz=6000)


@cue('amb_bridge_creak', 'loop', ('int', -25.0), win(10.0), **LOOPK)
def amb_bridge_creak(v: int):
    """The fallen needle settling: three slow stone groans (a stick-slip train through a heavy stone body)
    and chalk grit trickling off the broken edge after each."""
    r = R('amb_bridge_creak', v=v)
    D = 10.0
    n = ns(D)
    y = np.zeros(n)
    grit = np.zeros(n)
    starts = sorted(onset(r, n) / SR for _ in range(3))
    for i, t0 in enumerate(starts):
        dur = r.uniform(0.9, 1.6)
        k = ns(dur)
        train = np.zeros(k)
        tt, rate0, rate1 = 0.0, r.uniform(16, 24), r.uniform(28, 40)
        while tt < dur:
            u = tt / dur
            a = math.sin(math.pi * u) ** 1.2
            s = ns(tt)
            p = ns(0.003)
            if s + p < k:
                train[s:s + p] += O.white(p, r) * a * r.uniform(0.5, 1.0)
            tt += 1.0 / (rate0 + (rate1 - rate0) * u) * r.uniform(0.8, 1.2)
        f0 = r.uniform(130, 190)
        body = F.resonate(train, [f0, f0 * 1.47, f0 * 2.09, f0 * 3.18], [0.12, 0.09, 0.06, 0.04], [1.0, 0.6, 0.35, 0.2],
                          dur, full=False)
        add_at(y, norm(body) * r.uniform(0.6, 1.0), ns(t0), wrap=True)
        for _ in range(int(r.integers(10, 22))):
            add_at(grit, grain(r, 2500, 7000, (2.0, 6.0), 2.0), ns(t0 + dur * 0.5 + r.exponential(0.35)), wrap=True)
    out = norm(y) + 0.3 * norm(grit)
    return loop_out(out, hp_hz=60, lp_hz=8000)


# ── FRAY ─────────────────────────────────────────────────────────────────────────────────────────
@cue('amb_fray_murmur', 'loop', ('int', -23.0), win(12.0), **LOOPK)
def amb_fray_murmur(v: int):
    """The Shadowless Noon fair beyond the rim: a warm, far crowd (many soft voices made of noise through
    shifting vowel bands, never words), small stall bells now and then, carried on a light breeze. Wide,
    distant, low-passed: company, not a crowd roaring."""
    r = R('amb_fray_murmur', v=v)
    D = 12.0
    n = ns(D)
    t = np.arange(n) / SR
    side = np.zeros(n)
    mid = np.zeros(n)
    nv = 28
    for i in range(nv):
        x = O.coloured(n, r, -2.0)
        syl = r.uniform(3.0, 5.0)
        cyc = max(1, round(syl * D))                                   # whole syllable cycles per loop
        ph = r.uniform(0, TAU)
        sylenv = np.clip(np.sin(TAU * cyc * t / D + ph + 0.6 * np.sin(TAU * t / D * max(1, round(cyc / 7)))), 0, None) ** 1.5
        talk = np.clip(wobble(n, r, (1, 2, 3), 0.9) - 0.6, 0, None)   # each voice talks, then listens
        f1 = 500.0 * (1 + 0.35 * np.sin(TAU * max(1, round(cyc / 2)) * t / D + r.uniform(0, TAU)))
        f2 = 1500.0 * (1 + 0.3 * np.sin(TAU * max(1, round(cyc / 3)) * t / D + r.uniform(0, TAU)))

        def gains(tf, fr, f1=f1, f2=f2):
            return F.bp_curve(fr, at_frames(f1, tf), 5.0, 2) + 0.6 * F.bp_curve(fr, at_frames(f2, tf), 6.0, 2)

        vv = F.stft_filter(x, gains, frame=1024, circular=True) * sylenv * talk
        vv = norm(vv) * r.uniform(0.4, 1.0)
        p = r.uniform(-1, 1)
        mid += vv * math.cos(p * math.pi / 4)
        side += vv * math.sin(p * math.pi / 4)
    crowd_m = F.apply(mid, [F.lowpass(2600, 0.7), F.highpass(180, 0.7)], circular=True)
    crowd_s = F.apply(side, [F.lowpass(2600, 0.7), F.highpass(180, 0.7)], circular=True)
    bells = np.zeros(n)
    for _ in range(int(r.integers(3, 6))):
        note = r.choice(['D6', 'A5', 'F6', 'E6', 'G6'])
        b = I.dawnglass(hz(note), 1.2, 0.6, seed=f'fair{r.integers(0, 99)}', decay_scale=0.5)
        add_at(bells, norm(b[0]) * r.uniform(0.3, 0.7), onset(r, n), wrap=True)
    breeze = band_noise(n, r, 500.0 * wobble(n, r, (1, 2), 0.4), 0.7, slope=-4.0)
    m = norm(crowd_m) + 0.12 * norm(bells) + 0.25 * norm(breeze)
    s = norm(crowd_s) * 0.7
    return loop_out(wide(m, s, 0.7), hp_hz=80, lp_hz=5000)


@cue('amb_fray_bunting', 'loop', ('int', -25.0), win(6.0), **LOOPK)
def amb_fray_bunting(v: int):
    """Bunting on the rim: cloth flags snapping and fluttering in the noon breeze, busier in each gust."""
    r = R('amb_fray_bunting', v=v)
    D = 6.0
    n = ns(D)
    t = np.arange(n) / n
    gust = wobble(n, r, (1, 2, 3), 0.6)
    rate = 11.0 + 4.0 * np.sin(TAU * 2 * t)
    flap = 0.5 + 0.5 * np.sin(TAU * np.cumsum(rate) / SR * (round(np.sum(rate) / SR) / (np.sum(rate) / SR)))
    cloth = band_noise(n, r, 1100.0 * gust ** 0.5, 0.8, slope=-2.0) * flap ** 3 * gust ** 2
    snaps = scatter(n, r, 3.0, lambda rr: grain(rr, 600, 2200, (6.0, 18.0), 1.0), np.clip(gust - 1, 0, 1))
    return loop_out(norm(cloth) + 0.4 * norm(snaps), hp_hz=200, lp_hz=7000)


@cue('amb_fray_lantern', 'loop', ('int', -25.0), win(8.0), **LOOPK)
def amb_fray_lantern(v: int):
    """Paper lanterns turning on their cords: soft paper rustles and creaks, and the small dawnglass chimes
    hung under them touching now and then (D Dorian, high and quiet)."""
    r = R('amb_fray_lantern', v=v)
    D = 8.0
    n = ns(D)
    gust = wobble(n, r, (1, 2), 0.5)
    paper = scatter(n, r, 220.0, lambda rr: grain(rr, 900, 4000, (6.0, 30.0), 0.9), np.clip(gust / gust.max(), 0, 1) ** 2)
    chimes = np.zeros(n)
    for _ in range(int(r.integers(5, 9))):
        note = r.choice(['D6', 'E6', 'F6', 'A6', 'C7'])
        k = ns(1.2)
        tt = np.arange(k) / SR
        f = hz(note)
        c = (np.sin(TAU * f * tt) + 0.3 * np.sin(TAU * f * 2.32 * tt) * np.exp(-tt / 0.15)) * np.exp(-6.9 * tt / 1.0)
        c[:ns(0.001)] *= np.linspace(0, 1, ns(0.001))
        add_at(chimes, c * r.uniform(0.3, 1.0), onset(r, n), wrap=True)
    return loop_out(norm(paper) * 0.7 + norm(chimes) * 0.45, hp_hz=300, lp_hz=10000)


# ── shared ───────────────────────────────────────────────────────────────────────────────────────
@cue('amb_lamp_flame', 'loop', ('int', -25.0), win(6.0), **LOOPK)
def amb_lamp_flame(v: int):
    """A resin lamp: the flame's soft roar flickering, resin crackle and the odd pop, over a low warm hum."""
    r = R('amb_lamp_flame', v=v)
    D = 6.0
    n = ns(D)
    t = np.arange(n) / n
    flick = 1.0 + 0.35 * np.sin(TAU * 54 * t + 2.0 * np.sin(TAU * 7 * t)) * wobble(n, r, (1, 2, 3), 0.5) * 0.6
    roar = band_noise(n, r, np.full(n, 320.0), 0.6, slope=-4.0) * flick
    crack = scatter(n, r, 45.0, lambda rr: O.white(ns(rr.uniform(0.0004, 0.002)), rr) * (rr.pareto(2.5) + 0.2))
    crack = F.apply(crack, [F.highpass(1200, 0.7), F.lowpass(6000, 0.7)], circular=True)
    pops = scatter(n, r, 0.8, lambda rr: S.knock(rr, rr.uniform(700, 1400), 0.02, 3, 'wood') * 0.8)
    hum = I.lamp_drone(hz('D2'), D, 0.6, seed='amb_lamp', cutoff=(180.0, 320.0), lfo_hz=0.5, attack=0.0, release=0.0,
                       loop_len=D)[0]
    out = norm(roar) + 0.35 * norm(crack) + 0.3 * norm(pops) + 0.22 * norm(hum)
    return loop_out(out, hp_hz=50, lp_hz=8000)


@cue('amb_wren', 'loop', ('int', -25.0), win(8.0), **LOOPK)
def amb_wren(v: int):
    """Dialwrens: short ticking phrases of glass-whistle notes (a quick upward flick, then two or three clipped
    steps on D Dorian pitches), one close, one answering farther off."""
    r = R('amb_wren', v=v)
    D = 8.0
    n = ns(D)
    y = np.zeros(n)
    pcs = [hz(x) for x in ('D6', 'E6', 'F6', 'G6', 'A6', 'B6', 'C7', 'D7')]

    def note(f0: float, f1: float, dur: float) -> np.ndarray:
        k = ns(dur)
        u = np.arange(k) / k
        f = f0 * (f1 / f0) ** (u ** 0.6)
        ph = TAU * np.cumsum(f) / SR
        x = np.sin(ph + 0.8 * np.sin(2.0 * ph)) * np.sin(np.pi * u) ** 1.2
        return x

    def phrase(rr: np.random.Generator) -> np.ndarray:
        L = np.zeros(ns(0.8))
        tt = 0.0
        i0 = int(rr.integers(1, 5))
        add_at(L, note(pcs[i0] * 0.7, pcs[i0] * 1.15, 0.045), 0)
        tt = 0.07
        for _ in range(int(rr.integers(2, 4))):
            i0 = int(np.clip(i0 + rr.integers(-2, 3), 0, len(pcs) - 1))
            add_at(L, note(pcs[i0], pcs[i0] * 0.97, rr.uniform(0.04, 0.07)) * rr.uniform(0.6, 1.0), ns(tt))
            tt += rr.uniform(0.07, 0.11)
        return L

    times = np.sort([onset(r, n) / SR for _ in range(4)])
    for j, t0 in enumerate(times):
        lvl = 1.0 if j % 2 == 0 else 0.35                              # the answer is farther off
        ph = phrase(r)
        if j % 2:
            ph = F.apply(ph, [F.lowpass(4500, 0.7)])
        add_at(y, ph * lvl, ns(t0), wrap=True)
    return loop_out(y, hp_hz=900, lp_hz=11000)
