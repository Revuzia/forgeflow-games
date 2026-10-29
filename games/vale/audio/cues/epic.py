"""The epic objectives' own kits (closing AUD-C3), resolved like the fighters' (src/audio/index.ts `epic`): content names
them u_<unit>_<slot>; a unit with any of them never falls back on a library cue, and its autos play at a fighter's
multipliers. All original synthesis, in the Vale's fiction (_design/WORLD.md):

    Longshade     the beast that lives where the shadow ends (RIFT's late siege objective, its pit on the noon line):
                  the Shade family taken to its deepest — ink breath, a hollow low hourbell, falling drones. Its fall
                  is the hour-lines collapsing: a descending peal that sinks into the ground
    Sunsplinter   a construct of the needle's broken tip (RIFT's repeatable objective): the Lumen family at its
                  sharpest — struck dawnglass shards, glass chords that rise, light flaring. Its fall is a shattering
                  noon chord

Slots: attack_swing / attack_hit (3 round-robin takes each: an auto can fire about once a second), cast (the shared
wind-up, cresting at the longest castTime of its abilities, read from content/units.json), a<n>_land (the n-th
ability's area: the cue rides the area's delay and lands exactly where the sim lands it), roar (the objective waking,
or someone starting it), death, presence (the pit's seamless loop on the ambience bus while it lives).
Loudness (max momentary, asset level): swing -17.5 and hit -15.5 (2 dB over a fighter's -19.5 / -17.5, and content
gives them a fighter's gains: an objective's blow is never under a fighter's, r07's weight ladder), cast -17,
landings -14.5..-13.5 (a fighter's ult release level, -14.5, and up), roar -14, death -13; presence -24 LUFS integrated.

Also here: c_monster_fall, a camp monster's fall (events.monsterDeath), so a camp no longer dies on its own hit cue.
"""
from __future__ import annotations

import json
import os

import numpy as np

from cuelib import cue
from synth import env as E
from synth import filters as F
from synth import osc as O
from synth import sfx as S
from synth.core import SR, TAU, hz, ns

from .fighters import detune
from .kit import (Layers, R, bell, breath, bubble, crumble, glass, hollow, ink, lp, norm, rev, room, shimmer, swell_into,
                  tink)
from .kit import finish as _fin
from .world import band_noise, loop_out, scatter, wide, wobble

SWING = (0.15, 0.7)
HITW = (0.15, 0.9)
CASTW = (0.3, 1.2)
LANDW = (0.9, 6.5)
BIGW = (1.0, 4.0)
SWK = dict(tail_floor_db=-48.0)
HTK = dict(tail_floor_db=-48.0, clip_drive=1.5, max_gr_db=6.0)
CSK = dict(tail_floor_db=-50.0, fade_out=0.025)
BGK = dict(tail_floor_db=-54.0, fade_out=0.05, clip_drive=1.3, max_gr_db=6.0)
LOOPK = dict(loop=True, max_gr_db=6.0)
SOFT_TOP = [('peak', 3300, -3.0, 0.8), ('high', 9000, -3.0)]
CALM = [('peak', 3300, -2.5, 0.8)]
V3 = 3
PRES_S = 8.0

_UNITS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'content', 'units.json'))
_U: dict[str, dict] = {}


def unit(uid: str) -> dict:
    if not _U:
        with open(_UNITS, encoding='utf8') as f:
            for u in json.load(f)['units']:
                _U[u['id']] = u
    return _U[uid]


def ability(uid: str, i: int) -> tuple[float, float, float]:
    """The unit's i-th ability (0-based, as the sim slots them a1..): (castTime, its area / zone delay, a zone's
    duration), read from content (read only), so a landing lands where the sim lands it."""
    ab = unit(uid).get('abilities', [])[i]
    ct = float(ab.get('castTime') or 0.0)
    eff = [e for e in ab.get('effects', []) if e.get('op') in ('area', 'zone')]
    dl = max((float(e.get('delay') or 0.0) for e in eff), default=0.0)
    life = max((float(e.get('duration') or 0.0) for e in eff if e.get('op') == 'zone'), default=0.0)
    return ct, dl, life


def cast_len(uid: str) -> float:
    return max((ability(uid, i)[0] for i in range(len(unit(uid).get('abilities', [])))), default=0.4)


# ── Longshade ───────────────────────────────────────────────────────────────────────────────────
def deep_bell(note: str, dur: float, r: np.random.Generator, vel: float = 0.9, dark: float = 2400.0) -> np.ndarray:
    """Longshade's hollow low hourbell: the hourbell struck low and dark, a closed tube's odd modes under it."""
    b = bell(note, dur, vel, decay=1.3, bright=0.45, seed=f'ls:{note}')
    h = hollow(hz(note) * 0.5, dur, dur * 0.55, r, odd=4, hit_ms=4.0, inharm=0.015)
    n = max(b.shape[-1], h.size)
    y = np.zeros(n)
    y[:b.shape[-1]] += norm(b if b.ndim == 1 else b.mean(axis=0))
    y[:h.size] += 0.6 * norm(h)
    return norm(lp(y, dark))


def shade_drag(r: np.random.Generator, dur: float, f0: float, f1: float, peak_at: float = 0.6) -> np.ndarray:
    """A shadow limb dragged through the air: low swept pink noise with a breath on it (Shade: breath and ink)."""
    w = S.whoosh(r, dur, f0, f1, q=0.9, peak_at=peak_at, f_mid=(f0 * f1) ** 0.5 * 1.6, low_body=1.0)
    return norm(w if w.ndim == 1 else w.mean(axis=0))


@cue('u_longshade_attack_swing', 'combat', ('m', -17.5), SWING, variants=V3, **SWK)
def u_longshade_attack_swing(v: int):
    """Longshade swings: a great shadow limb dragged through the air (a low pink sweep 120 → 520 → 180 Hz with a
    breath riding it), the ink at its edge flicking off."""
    r = R('u_longshade_attack_swing', v=v)
    d = detune(v, 25)
    L = Layers(0.55)
    L.add(shade_drag(r, 0.45, 120 * d, 180 * d, 0.55), 0.0, peak_db=-1, width=0.7)
    L.add(breath(0.4, 700 * d, 260 * d, shape='breath', q=1.6, seed=f'lsw{v}', peak_at=0.5), 0.02, peak_db=-8, width=0.8)
    L.add(ink(r, 0.25, 5, 160, 420, 0.06, wash=0.2), 0.3, peak_db=-14)
    return _fin(L.out(), hp_hz=45, lp_hz=7000, eq=SOFT_TOP)


@cue('u_longshade_attack_hit', 'combat', ('m', -15.5), HITW, variants=V3, **HTK)
def u_longshade_attack_hit(v: int):
    """Longshade's blow lands: a deep ink-heavy thud (sub thump, a hide-and-stone knock with a contact crack) and the
    low hourbell knocked dead under it, ink spattering."""
    r = R('u_longshade_attack_hit', v=v)
    d = detune(v, 25)
    L = Layers(0.6)
    L.add(S.thump(0.35, 110 * d, 40, 0.025, 0.22, 2.4), 0.0, peak_db=-1)
    L.add(S.knock(r, 240 * d, 0.09, 5, 'stone'), 0.0, peak_db=-2)
    L.add(S.knock(r, 420 * d, 0.05, 4, 'clay'), 0.001, peak_db=-4)
    L.add(S.snap(r, 2400 * d, 2.0), 0.0, peak_db=-11)
    L.add(hollow(hz('D2') * d, 0.5, 0.3, r, odd=4, hit_ms=3.0), 0.004, peak_db=-6)
    L.add(ink(r, 0.3, 8, 180, 600, 0.05, wash=0.25), 0.01, peak_db=-12)
    return _fin(room(L.out(), 'stone', wet=0.08), hp_hz=40, lp_hz=7500, eq=SOFT_TOP)


@cue('u_longshade_cast', 'combat', ('m', -17.0), CASTW, **CSK)
def u_longshade_cast(v: int):
    """Longshade draws in: an ink breath sucked in through its whole length (a low reversed swell into the bell's
    hum), cresting where its abilities commit."""
    r = R('u_longshade_cast', v=v)
    D = cast_len('longshade')
    L = Layers(D + 0.25)
    L.add(breath(D, 220, 900, shape='swell', q=1.8, seed='lsc', curve=-2.0), 0.0, peak_db=-2, width=0.7)
    L.add(swell_into(deep_bell('D3', 1.0, r), D), 0.0, peak_db=-4)
    L.add(ink(r, D, 10, 120, 360, D * 0.4, wash=0.3), 0.0, peak_db=-12)
    L.add(S.thump(0.25, 90, 45, 0.03, 0.15, 2.0), D, peak_db=-8)
    return _fin(L.out(), hp_hz=40, lp_hz=6000, eq=CALM)


@cue('u_longshade_a1_land', 'combat', ('m', -14.0), LANDW, **BGK)
def u_longshade_a1_land(v: int):
    """Shadow Sweep: the shadow is drawn wide through its delay (a dragging rise of ink and air) and at the sim's
    landing sweeps the arc — a wide low rush crossing the field and the hollow low hourbell struck D2 for the blow."""
    r = R('u_longshade_a1_land', v=v)
    _, dl, _ = ability('longshade', 0)
    L = Layers(dl + 1.6)
    L.add(breath(dl, 180, 700, shape='swell', q=1.6, seed='ls1', curve=-2.2), 0.0, peak_db=-6, width=0.8)
    L.add(ink(r, dl, 14, 120, 400, dl * 0.5, wash=0.35), 0.0, peak_db=-13)
    sweep = shade_drag(r, 0.7, 100, 160, 0.3)
    L.add(sweep, dl - 0.12, peak_db=-1, pan=-0.35)
    L.add(sweep * 0.8, dl - 0.06, peak_db=-3, pan=0.35)
    L.add(S.thump(0.4, 100, 38, 0.03, 0.3, 2.2), dl, peak_db=-2)
    L.add(deep_bell('D2', 1.4, r), dl + 0.005, peak_db=-3)
    return _fin(room(L.out(), 'hall', wet=0.1), hp_hz=35, lp_hz=7000, eq=CALM)


@cue('u_longshade_a2_land', 'combat', ('m', -14.5), LANDW, **BGK)
def u_longshade_a2_land(v: int):
    """Pooled Shade: shade pools under them through the delay (ink bubbling up, thickening), then the pool darkens
    for its whole life — a falling shade drone (two low tones sliding down and beating) with the ink still welling."""
    r = R('u_longshade_a2_land', v=v)
    _, dl, life = ability('longshade', 1)
    life = life or 4.0
    L = Layers(dl + life + 0.4)
    bub = np.zeros(ns(dl + life))
    for _ in range(60):
        t0 = float(r.uniform(0, dl + life - 0.1))
        f = float(r.uniform(110, 320)) * (1.25 if t0 < dl else 1.0)
        b = bubble(f, float(r.uniform(0.05, 0.11)), float(r.uniform(1.5, 2.3)), 0.06)
        s = ns(t0)
        bub[s:s + b.size] += b[:max(0, bub.size - s)] * float(r.uniform(0.3, 1.0)) * min(1.0, 0.35 + t0 / dl)
    L.add(bub, 0.0, peak_db=-9)
    L.add(breath(dl, 160, 520, shape='swell', q=1.4, seed='ls2', curve=-2.0), 0.0, peak_db=-8, width=0.7)
    n = ns(life)
    t = np.arange(n) / SR
    f = hz('D2') * 2 ** (-(t / life) * 5 / 12)                # falls a fourth over its life
    dr = np.sin(TAU * np.cumsum(f) / SR) + 0.6 * np.sin(TAU * np.cumsum(f * 1.5 + 0.7) / SR) + 0.3 * np.sin(TAU * np.cumsum(f * 2.01) / SR)
    dr = lp(dr, 900) * E.stages([(0, 0, 0), (0.12, 1, -1.5), (life * 0.75, 0.7, 0.0), (life, 0, 1.5)], n)
    L.add(dr, dl, peak_db=-2, width=0.5)
    L.add(S.thump(0.3, 90, 40, 0.03, 0.2, 2.0), dl, peak_db=-6)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=35, lp_hz=5000, eq=CALM)


@cue('u_longshade_a3_land', 'combat', ('m', -13.5), LANDW, **BGK)
def u_longshade_a3_land(v: int):
    """Full Length: it rears to its full length through the delay (a low groan of air and ink climbing, the bell's hum
    drawn in backwards) and crashes down where the sim lands it — a colossal sub thump, the low hourbell struck
    D2 with its octave, stone giving way and ink thrown out wide."""
    r = R('u_longshade_a3_land', v=v)
    _, dl, _ = ability('longshade', 2)
    L = Layers(dl + 2.0)
    L.add(breath(dl, 140, 1100, shape='swell', q=2.0, seed='ls3', curve=-2.5), 0.0, peak_db=-4, width=0.8)
    n = ns(dl)
    t = np.arange(n) / SR
    groan = np.sin(TAU * np.cumsum(55 * 2 ** (t / dl * 7 / 12)) / SR)
    groan = groan * (1 + 0.3 * np.sin(TAU * 6 * t)) * E.swell(n, dl * 0.95, -2.0, release=dl * 0.05)[:n]
    L.add(lp(groan, 700), 0.0, peak_db=-6)
    L.add(swell_into(deep_bell('D2', 1.6, r), min(dl, 1.2)), dl - min(dl, 1.2), peak_db=-7)
    L.add(S.snap(r, 1800, 4.0), dl, peak_db=-6)
    L.add(S.thump(0.6, 95, 32, 0.035, 0.45, 2.0), dl, peak_db=0)
    L.add(deep_bell('D2', 1.8, r), dl + 0.004, peak_db=-2)
    L.add(deep_bell('D3', 1.2, r), dl + 0.01, peak_db=-8)
    L.add(crumble(r, 1.1, 30, 120, 900, 0.4), dl + 0.03, peak_db=-9)
    L.add(S.rumble(r, 1.4, 130, 0.9, 0.006), dl, peak_db=-6)
    L.add(ink(r, 0.7, 18, 140, 520, 0.12, wash=0.4), dl + 0.02, peak_db=-11, width=0.9)
    return _fin(room(L.out(), 'hall', wet=0.12), hp_hz=30, lp_hz=7000, eq=CALM)


@cue('u_longshade_roar', 'combat', ('m', -14.0), BIGW, **BGK)
def u_longshade_roar(v: int):
    """Longshade wakes (or is struck from rest): a vast hollow exhalation — wind through a great dark throat (pink
    noise through two low formants falling), the low hourbell humming in sympathy, ink stirring. Never a voice."""
    r = R('u_longshade_roar', v=v)
    D = 1.8
    n = ns(D)
    t = np.arange(n) / SR
    x = O.coloured(n, r, -3.0)
    f1 = 520 * 2 ** (-t / D * 1.2)
    f2 = 1250 * 2 ** (-t / D * 0.9)
    y = S.formants(x, f1, f2, q=3.0, mix=0.95)
    y = norm(y if y.ndim == 1 else y.mean(axis=0)) * E.stages([(0, 0, 0), (0.25, 1, -2.0), (D * 0.6, 0.75, 0.0), (D, 0, 2.0)], n)
    L = Layers(D + 0.6)
    L.add(y, 0.0, peak_db=-1, width=0.8)
    L.add(lp(O.sine(np.full(n, hz('D2') / 2), n) * E.stages([(0, 0, 0), (0.3, 1, -1.5), (D, 0, 1.5)], n), 400), 0.0, peak_db=-5)
    L.add(deep_bell('D2', 1.6, r, vel=0.6), 0.2, peak_db=-8)
    L.add(ink(r, 1.0, 14, 120, 420, 0.3, wash=0.3), 0.3, peak_db=-13)
    return _fin(room(L.out(), 'hall', wet=0.14), hp_hz=30, lp_hz=6000, eq=CALM)


@cue('u_longshade_death', 'combat', ('m', -13.0), (1.0, 4.8), **BGK)
def u_longshade_death(v: int):
    """Longshade falls: the hour-lines collapse — a descending peal on the low hourbell (A3 F3 D3 A2 D2, each lower
    and closer together, the last one long), its shade drone sinking into the ground under a last ink exhalation and
    a heavy settling of stone."""
    r = R('u_longshade_death', v=v)
    L = Layers(3.6)
    for i, (t0, note, g) in enumerate(((0.0, 'A3', -5), (0.32, 'F3', -4), (0.58, 'D3', -3), (0.78, 'A2', -2), (0.94, 'D2', 0))):
        L.add(deep_bell(note, 2.6 - 0.3 * i if i < 4 else 2.8, R('u_longshade_death', note, v)), t0, peak_db=g,
              pan=(-0.3, 0.25, -0.15, 0.1, 0.0)[i])
    n = ns(2.6)
    t = np.arange(n) / SR
    sink = np.sin(TAU * np.cumsum(hz('D2') * 2 ** (-t / 2.6)) / SR) * E.stages([(0, 0, 0), (0.2, 1, -1.5), (2.6, 0, 1.2)], n)
    L.add(lp(sink, 500), 0.3, peak_db=-5)
    L.add(breath(2.2, 900, 160, shape='breath', q=1.6, seed='lsd', peak_at=0.15, vel=0.8), 0.1, peak_db=-8, width=0.8)
    L.add(S.thump(0.6, 90, 30, 0.04, 0.5, 2.0), 0.94, peak_db=-3)
    L.add(crumble(r, 1.2, 26, 110, 800, 0.5), 0.96, peak_db=-10)
    return _fin(room(L.out(), 'hall', wet=0.16), hp_hz=30, lp_hz=7000, eq=CALM)


@cue('u_longshade_presence', 'loop', ('int', -24.0), (PRES_S - 0.01, PRES_S + 0.01), **LOOPK)
def u_longshade_presence(v: int):
    """Longshade's pit while it lives: something vast breathing slowly where the shadow ends — a low shade drone (D1 /
    A1, beating), a breath rising and falling twice a loop, ink welling up now and then. Seamless."""
    r = R('u_longshade_presence', v=v)
    D = PRES_S
    n = ns(D)
    t = np.arange(n) / SR
    tone = np.zeros(n)
    for f, a in ((hz('D2') / 2, 1.0), (hz('D2') / 2 + 0.25, 0.7), (hz('A1'), 0.5), (hz('D2'), 0.35), (hz('D2') + 0.25, 0.25)):
        fs = max(1, round(f * D)) / D
        tone += a * np.sin(TAU * fs * t + r.uniform(0, TAU))
    tone = F.apply(tone, [F.lowpass(600, 0.7)], circular=True)
    breathe = 0.55 + 0.45 * np.sin(TAU * 2 * t / D - np.pi / 2) ** 2
    air = band_noise(n, r, 260 + 140 * breathe, 0.9, slope=-4.0) * breathe
    welling = scatter(n, r, 2.5, lambda rr: bubble(rr.uniform(90, 240), rr.uniform(0.08, 0.14), rr.uniform(1.4, 2.0), 0.08)
                      * rr.uniform(0.3, 0.9))
    hush = band_noise(n, r, np.full(n, 7500.0), 0.7, slope=-1.0) * breathe     # the faint air over the pit
    mid = norm(tone) * (0.8 + 0.2 * breathe) + 0.55 * norm(air) + 0.3 * norm(welling) + 0.06 * norm(hush)
    side = band_noise(n, r, np.full(n, 500.0), 0.8, slope=-4.0) * breathe
    return loop_out(wide(norm(mid), norm(side), 0.35), hp_hz=28, lp_hz=10000)


# ── Sunsplinter ─────────────────────────────────────────────────────────────────────────────────
def shardfall(r: np.random.Generator, dur: float, count: int, lo: float = 1800.0, hi: float = 7000.0) -> np.ndarray:
    """Struck dawnglass shards: many small inharmonic glass pings (a broken-tip shower), denser early."""
    return S.shards(r, dur, count, lo, hi, 0.1, 0.1, 0.4)


def chord(notes, dur: float, r: np.random.Generator, vel: float = 0.8, decay: float = 1.0, bright: float = 0.8) -> np.ndarray:
    """A struck dawnglass chord (each note a glass voice)."""
    parts = [glass(n_, dur, vel, decay=decay, bright=bright, seed=f'ss:{n_}') for n_ in notes]
    m = max(p.shape[-1] for p in parts)
    y = np.zeros(m)
    for p in parts:
        p1 = p if p.ndim == 1 else p.mean(axis=0)
        y[:p1.size] += norm(p1)
    return norm(y)


def rising_chord(notes, dur: float, r: np.random.Generator) -> np.ndarray:
    """A bowed glass chord gliding up a whole tone into its pitches and swelling (Lumen: rises)."""
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for k, note in enumerate(notes):
        f = hz(note) * 2 ** (-(1 - t / dur) * 2 / 12)
        y += (1.0 - 0.15 * k) * (np.sin(TAU * np.cumsum(f) / SR) + 0.3 * np.sin(TAU * np.cumsum(f * 2.32) / SR))
    return norm(y * E.swell(n, dur * 0.97, -2.5, release=dur * 0.03)[:n])


@cue('u_sunsplinter_attack_swing', 'combat', ('m', -17.5), SWING, variants=V3, **SWK)
def u_sunsplinter_attack_swing(v: int):
    """Sunsplinter looses a shard: a bright glass zing leaving its broken tip (an FM shimmer chirping up), a thin
    whistle of air behind it, a click of glass on release."""
    r = R('u_sunsplinter_attack_swing', v=v)
    d = detune(v, 40)
    L = Layers(0.5)
    L.add(tink(1900 * d, 0.05, 0.04, 0.6), 0.0, peak_db=-9)
    L.add(shimmer(hz('A4') * d, 0.35, 0.7, 0.6, 1.8, 2.0), 0.0, peak_db=-3)
    L.add(S.whoosh(r, 0.3, 700 * d, 1300 * d, q=1.4, peak_at=0.3, f_mid=1600 * d, low_body=0.3), 0.0, peak_db=-4, width=0.6)
    L.add(rising_chord(['D4', 'A4'], 0.18, r), 0.0, peak_db=-7)
    L.add(S.thump(0.15, 220 * d, 120, 0.015, 0.08, 2.4), 0.0, peak_db=-10)
    return _fin(room(L.out(), 'glass', wet=0.08), hp_hz=180, lp_hz=11000, eq=SOFT_TOP)


@cue('u_sunsplinter_attack_hit', 'combat', ('m', -15.5), HITW, variants=V3, **HTK)
def u_sunsplinter_attack_hit(v: int):
    """A shard strikes: a hard glass impact (a thump with a bright contact) and the shard shattering into a fistful
    of dawnglass bits."""
    r = R('u_sunsplinter_attack_hit', v=v)
    d = detune(v, 40)
    L = Layers(0.6)
    L.add(S.thump(0.25, 160 * d, 60, 0.02, 0.14, 2.6), 0.0, peak_db=-3)
    L.add(S.knock(r, 650 * d, 0.05, 4, 'clay'), 0.0, peak_db=-3)
    L.add(S.snap(r, 3200 * d, 1.8), 0.0, peak_db=-8)
    L.add(shardfall(r, 0.4, 16, 1600, 6500), 0.004, peak_db=-4)
    L.add(glass(hz('E5') * d, 0.4, 0.6, decay=0.5, bright=0.6, seed=f'ssh{v}'), 0.003, peak_db=-9)
    return _fin(room(L.out(), 'glass', wet=0.08), hp_hz=60, lp_hz=10000, eq=SOFT_TOP)


@cue('u_sunsplinter_cast', 'combat', ('m', -17.0), CASTW, **CSK)
def u_sunsplinter_cast(v: int):
    """Sunsplinter gathers light: a rising glass chord (D5 A5 E6 gliding up into place) swelling to the commit, a
    shimmer catching on it."""
    r = R('u_sunsplinter_cast', v=v)
    D = cast_len('sunsplinter')
    L = Layers(D + 0.2)
    L.add(rising_chord(['D5', 'A5', 'E6'], D, r), 0.0, peak_db=-2, width=0.6)
    L.add(breath(D, 900, 3200, shape='swell', q=2.0, seed='ssc', curve=-2.0), 0.0, peak_db=-10, width=0.8)
    L.add(tink(hz('A6'), 0.08, 0.06, 0.5), D, peak_db=-8)
    return _fin(L.out(), hp_hz=200, lp_hz=11000, eq=CALM)


@cue('u_sunsplinter_a1_land', 'combat', ('m', -14.5), LANDW, **BGK)
def u_sunsplinter_a1_land(v: int):
    """Shard Rain: the marked circle glitters as the shards gather overhead through the delay (a high glass
    shimmer thickening, falling whistles), then they land where the sim lands them — a shower of struck dawnglass
    over a glass thump."""
    r = R('u_sunsplinter_a1_land', v=v)
    _, dl, _ = ability('sunsplinter', 0)
    L = Layers(dl + 1.0)
    L.add(S.sparkle(r, dl, 18, 88, 103, 0.14, rise=False, decay_level=-1.5), 0.0, peak_db=-10, width=0.9)
    L.add(breath(dl, 4000, 1500, shape='swell', q=2.2, seed='ss1', curve=-2.0), 0.0, peak_db=-9, width=0.8)
    L.add(S.thump(0.3, 150, 55, 0.02, 0.18, 2.4), dl, peak_db=-3)
    L.add(shardfall(r, 0.8, 50, 1500, 7500), dl, peak_db=-1, width=1.0)
    L.add(chord(['D5', 'A5'], 0.8, r, 0.7, 0.6), dl + 0.005, peak_db=-7)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=80, lp_hz=12000, eq=CALM)


@cue('u_sunsplinter_a2_land', 'combat', ('m', -14.0), LANDW, **BGK)
def u_sunsplinter_a2_land(v: int):
    """Noon Glare: a glass chord charges through the delay (D4 A4 E5 B5 bowed and rising, the light swelling), then
    the ring flares where the sim lands it — a bright struck chord with a burst of shimmer racing outward."""
    r = R('u_sunsplinter_a2_land', v=v)
    _, dl, _ = ability('sunsplinter', 1)
    L = Layers(dl + 1.6)
    L.add(rising_chord(['D4', 'A4', 'E5', 'B5'], dl, r), 0.0, peak_db=-3, width=0.7)
    L.add(breath(dl, 600, 4000, shape='swell', q=2.4, seed='ss2', curve=-2.5), 0.0, peak_db=-9, width=0.9)
    L.add(chord(['D5', 'A5', 'E6'], 1.4, r, 0.9, 0.9, 1.0), dl, peak_db=-1, width=1.0)
    L.add(shimmer(hz('A6'), 0.9, 0.8, 0.6, 3.0, 3.5), dl, peak_db=-6)
    L.add(S.whoosh(r, 0.5, 2000, 5000, q=1.2, peak_at=0.15, f_mid=4000), dl, peak_db=-7, width=1.0)
    L.add(S.thump(0.3, 140, 60, 0.02, 0.18, 2.2), dl, peak_db=-6)
    return _fin(room(L.out(), 'glass', wet=0.14), hp_hz=90, lp_hz=12000, eq=CALM)


@cue('u_sunsplinter_a3_land', 'combat', ('m', -14.0), LANDW, **BGK)
def u_sunsplinter_a3_land(v: int):
    """Splinter Spray: the broken tip turns and strains through the delay (glass creaking under tension, a thin
    rising whine), then sprays its splinters where the sim lands them — a hard glass crack and a fan of shards
    flying out, the knock-back's push of air."""
    r = R('u_sunsplinter_a3_land', v=v)
    _, dl, _ = ability('sunsplinter', 2)
    L = Layers(dl + 1.0)
    creak = np.zeros(ns(dl))
    tt = 0.0
    while tt < dl - 0.02:
        k = tink(float(r.uniform(2200, 3800)), 0.02, 0.012, 0.8)
        s = ns(tt)
        creak[s:s + k.size] += k[:max(0, creak.size - s)] * (0.3 + 0.7 * tt / dl)
        tt += float(r.uniform(0.02, 0.06)) * (1.2 - 0.6 * tt / dl)
    L.add(creak, 0.0, peak_db=-11)
    L.add(rising_chord(['E5', 'B5'], dl, r), 0.0, peak_db=-8)
    L.add(S.snap(r, 3500, 2.0), dl, peak_db=-5)
    L.add(S.thump(0.25, 170, 70, 0.02, 0.14, 2.4), dl, peak_db=-4)
    L.add(shardfall(r, 0.7, 40, 1800, 8000), dl + 0.003, peak_db=-1, width=1.0)
    L.add(S.whoosh(r, 0.35, 900, 2400, q=1.0, peak_at=0.2, f_mid=1800, low_body=0.4), dl, peak_db=-6, width=0.9)
    return _fin(room(L.out(), 'glass', wet=0.1), hp_hz=90, lp_hz=12000, eq=CALM)


@cue('u_sunsplinter_roar', 'combat', ('m', -14.0), BIGW, **BGK)
def u_sunsplinter_roar(v: int):
    """Sunsplinter wakes (or is struck from rest): the whole construct resonates — a vast glass chord bowed up out of
    nothing (D4 A4 D5 F5), an FM shimmer blooming over it, light ringing off the needle's broken tip."""
    r = R('u_sunsplinter_roar', v=v)
    L = Layers(2.4)
    L.add(rising_chord(['D4', 'A4', 'D5', 'F5'], 0.8, r), 0.0, peak_db=-2, width=0.8)
    L.add(chord(['D4', 'A4', 'D5', 'F5'], 1.6, r, 0.8, 1.0, 0.7), 0.78, peak_db=-2, width=1.0)
    L.add(shimmer(hz('D6'), 1.4, 0.7, 0.8, 2.8, 3.5), 0.7, peak_db=-7)
    L.add(breath(0.8, 700, 2800, shape='swell', q=1.8, seed='ssr', curve=-2.0), 0.0, peak_db=-9, width=0.9)
    L.add(S.thump(0.4, 110, 45, 0.03, 0.3, 2.0), 0.78, peak_db=-7)
    return _fin(room(L.out(), 'glass', wet=0.16), hp_hz=60, lp_hz=12000, eq=CALM)


@cue('u_sunsplinter_death', 'combat', ('m', -13.0), BIGW, **BGK)
def u_sunsplinter_death(v: int):
    """Sunsplinter falls: a shattering noon chord — the full glass chord struck hard (D5 F5 A5 C6 E6), the construct
    bursting into a long shower of dawnglass, the chord's ring left hanging and falling away."""
    r = R('u_sunsplinter_death', v=v)
    L = Layers(3.4)
    L.add(S.thump(0.5, 120, 40, 0.03, 0.4, 2.2), 0.0, peak_db=-2)
    L.add(S.snap(r, 3000, 3.0), 0.0, peak_db=-6)
    L.add(chord(['D5', 'F5', 'A5', 'C6', 'E6'], 2.6, r, 0.95, 1.4, 1.0), 0.0, peak_db=-1, width=1.0)
    L.add(shardfall(r, 2.0, 120, 1400, 8500), 0.01, peak_db=-2, width=1.0)
    L.add(rev(chord(['A4', 'D5'], 0.6, r, 0.6, 0.6)), 0.0, peak_db=-14)
    L.add(S.rumble(r, 1.2, 160, 0.7, 0.005), 0.0, peak_db=-10)
    return _fin(room(L.out(), 'glass', wet=0.18), hp_hz=50, lp_hz=12000, eq=CALM)


@cue('u_sunsplinter_presence', 'loop', ('int', -24.0), (PRES_S - 0.01, PRES_S + 0.01), **LOOPK)
def u_sunsplinter_presence(v: int):
    """Sunsplinter's pit while it lives: light humming in the broken glass — a high glass drone (A4 / E5 / A5,
    beating slowly), a warm hum under it, glints ringing off the shards now and then. Seamless."""
    r = R('u_sunsplinter_presence', v=v)
    D = PRES_S
    n = ns(D)
    t = np.arange(n) / SR
    tone = np.zeros(n)
    for f, a in ((hz('A4'), 1.0), (hz('A4') + 0.25, 0.8), (hz('E5'), 0.6), (hz('E5') + 0.375, 0.45), (hz('A5'), 0.3),
                 (hz('D3'), 0.5)):
        fs = max(1, round(f * D)) / D
        tone += a * np.sin(TAU * fs * t + r.uniform(0, TAU))
    lfo = wobble(n, r, (1, 2), 0.3)
    glints = scatter(n, r, 1.5, lambda rr: tink(hz(str(rr.choice(['D6', 'E6', 'A6', 'C7']))), 0.6, 0.45, 0.4) * rr.uniform(0.3, 0.9))
    air = band_noise(n, r, np.full(n, 3500.0), 1.0, slope=-2.0) * lfo
    mid = norm(tone) * lfo + 0.35 * norm(glints) + 0.25 * norm(air)
    side = band_noise(n, r, np.full(n, 5000.0), 0.9, slope=-2.0) * lfo
    return loop_out(wide(norm(mid), norm(side), 0.3), hp_hz=120, lp_hz=10000)


# ── camps ───────────────────────────────────────────────────────────────────────────────────────
@cue('c_monster_fall', 'combat', ('m', -16.0), (0.5, 1.8), **BGK)
def c_monster_fall(v: int):
    """A camp monster falls (events.monsterDeath; the hit cue is no death): a heavy body going down — a slump of
    hide and clay (two dull knocks, the second lower), a sub thump on the ground, grit settling and a last breath
    of air out."""
    r = R('c_monster_fall', v=v)
    L = Layers(1.2)
    L.add(S.knock(r, 300, 0.09, 5, 'clay'), 0.0, peak_db=-3)
    L.add(S.knock(r, 190, 0.12, 5, 'clay'), 0.13, peak_db=-2)
    L.add(S.thump(0.45, 110, 40, 0.03, 0.32, 2.2), 0.13, peak_db=-1)
    L.add(crumble(r, 0.6, 14, 150, 900, 0.25), 0.16, peak_db=-12)
    L.add(breath(0.7, 600, 200, shape='breath', q=1.4, seed='cmf', peak_at=0.2, vel=0.6), 0.05, peak_db=-11, width=0.6)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=40, lp_hz=6000, eq=CALM)
