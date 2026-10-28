"""Per-fighter sound kits, second half (final parity AUD-1): marund, nurrow, odrum, rishal, sukri, tunlan, ulkro,
vashil. Same contract as kits_a.py (slots, loudness, mastering profiles, the castTime / delay reading of content):
bus `sfx` (spatial) except the call (bus `ui`), named f_<fighter>_<slot>, resolved by src/audio/index.ts before the
catalog's present.sfx / hitSfx (the passive procs are fighters.py's).

Each fighter is built from its brief (_design/fighters/<id>.md) around a HOME material and a SIGNATURE instrument in
D Dorian; the instrument carries the 2-3-note call (the draft's lock-in, fighterCall()) and returns, struck big, in
the ult release:

    marund   an ironstone maul, mortar, the hearth he carries         stone dome bell           G2 G3 (an octave raised)
    nurrow   a snuffer-blade, felt, the lull                          vessel flute              D5 A4 B4 (a rocking lull)
    odrum    a walnut staff-sling, resin pots, amber                  walnut slit drum          A3 E4 D4
    rishal   two dawnglass knives, glass tracks, heat                 struck glass rods         E6 B6 A6
    sukri    a walking staff, a glass cup of noon light, the hour     glass cup (light sloshing) A5 E5
    tunlan   a hanging lamp, jointed fingers, shadow beasts           a padded shadow growl     A2 C3 D3 (a beast waking)
    ulkro    a spear-thrower, darts, the run                          bullroarer                E3 A3 (two whirls)
    vashil   an ash striking rod, a halo of seven glass bells         glass handbell            D5 B5 (the Dorian sixth)

The identity slots (attack swing / hit, ult wind-up / release) keep >= 8 dB of 1/3-octave distance from every other
fighter's (audio/build.py kit gate): each fighter gets its own band and its own tonal colour, not just its own file.
"""
from __future__ import annotations

import math

import numpy as np

from cuelib import cue
from synth import env as E
from synth import filters as F
from synth import osc as O
from synth import sfx as S
from synth.core import SR, TAU, hz, ns, rng

from .combat import woomf
from .fighters import detune
from .kit import (Layers, R, at_len, breath, bubble, crackle, crumble, drum, esc, fm_tone, hiss, hollow, ink, lp, hp, bp,
                  norm, rev, room, scrape, shimmer, swell_into, tink)
from .kit import finish as _fin
from .kits_a import (BGK, CALLW, CALM, CASTW, CLK, CSK, DIEW, HITW, HTK, RELW, SOFT_TOP, SWING, SWK, T_CALL, T_CAST, T_DIE,
                     T_HIT, T_REL, T_SW, T_WIND, V3, WIND, creak, lead, timing, whump, wind)


# ── signature instruments ────────────────────────────────────────────────────────────────────────
def dome(f: float, dur: float = 1.2, t60: float = 0.9, r: np.random.Generator | None = None, dark: float = 2400.0) -> np.ndarray:
    """Marund's stone dome bell: a shallow ironstone dome struck on its crown — few, round, low modes, low-passed, a
    warm stone hum with no glass in it."""
    r = r or rng(f'dome:{f:.1f}')
    y = S.partials(f, (1.0, 1.93, 2.84, 4.05), (1.0, 0.45, 0.22, 0.08), (t60, t60 * 0.5, t60 * 0.3, t60 * 0.16), dur, r, 0.4)
    return norm(lp(y, dark))


def vessel(f0: float, f1: float, dur: float, r: np.random.Generator, vib: float = 4.5, cents: float = 12.0,
           air: float = 0.22, attack: float = 0.04, curve: float = 2.0, release: float = 1.5) -> np.ndarray:
    """Nurrow's vessel flute: a round, nearly pure clay-flute tone (faint 2nd and 3rd), a breath of air round it, a slow
    vibrato easing in."""
    n = ns(dur)
    t = np.arange(n) / SR
    u = t / dur
    g = (1 - np.exp(-curve * u)) / (1 - np.exp(-curve)) if curve else u
    vb = 2 ** (cents / 1200 * np.sin(TAU * vib * t) * np.clip(t / 0.12, 0, 1))
    f = np.exp(np.log(f0) + (np.log(f1) - np.log(f0)) * g) * vb
    ph = TAU * np.cumsum(f) / SR
    y = np.sin(ph) + 0.08 * np.sin(2 * ph) + 0.035 * np.sin(3 * ph)
    a = norm(F.apply(O.white(n, r), [F.bandpass(float(math.sqrt(f0 * f1)) * 1.02, 3.0)]))
    envl = E.stages([(0, 0, 0), (min(attack, dur * 0.3), 1, -1.5), (dur, 0, release)], n)
    return norm((y + air * a) * envl)


def slit(f: float, dur: float = 0.5, t60: float = 0.3, r: np.random.Generator | None = None) -> np.ndarray:
    """Odrum's walnut slit drum: a hollow log's tongue struck with a padded mallet — a round wooden tone, its second
    mode a little sharp of the octave, a dry wood tap on the strike."""
    r = r or rng(f'slit:{f:.1f}')
    y = S.partials(f, (1.0, 2.08, 3.4), (1.0, 0.28, 0.08), (t60, t60 * 0.4, t60 * 0.2), dur, r, 0.2)
    k = S.knock(r, f * 3.1, 0.02, 3, 'wood')
    y[:k.size] += 0.3 * k[:y.size]
    return norm(y)


def amber(r: np.random.Generator, f: float = 760.0, dark: float = 3000.0) -> np.ndarray:
    """Amber cracking: a hard, damped split (a dull glass break) low-passed to resin."""
    return norm(lp(S.partials(f, (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.07, 0.04, 0.02), 0.15, r), dark))


def rod(f: float, dur: float = 0.25, t60: float = 0.12, r: np.random.Generator | None = None, bright: float = 1.0) -> np.ndarray:
    """Rishal's struck glass rods: a thin dawnglass rod (free-bar modes), bright and short."""
    r = r or rng(f'rod:{f:.1f}')
    return S.partials(f, (1.0, 2.756, 5.404), (1.0, 0.45 * bright, 0.2 * bright), (t60, t60 * 0.45, t60 * 0.2), dur, r, 1.0)


def cup(f: float, dur: float = 0.8, t60: float = 0.6, wob: float = 4.0, cents: float = 14.0, phase: float = 0.0,
        attack: float = 0.0015) -> np.ndarray:
    """Sukri's glass cup of noon light: a small glass cup's partials with a slow wobble in its pitch (the light
    sloshing in it like water)."""
    n = ns(dur)
    t = np.arange(n) / SR
    w = 2 ** (cents / 1200 * np.sin(TAU * wob * t + phase))
    y = np.zeros(n)
    for k, a, dk in ((1.0, 1.0, 1.0), (2.32, 0.38, 0.5), (4.25, 0.14, 0.28)):
        y += a * np.sin(TAU * np.cumsum(f * k * w) / SR + 0.6 * k) * np.exp(-6.9078 * t / (t60 * dk))
    m = max(2, ns(attack))
    y[:m] *= np.linspace(0, 1, m)
    return norm(y)


def growl(r: np.random.Generator, dur: float, f0: float = 90.0, f1: float | None = None, formant=(420.0, 980.0),
          dark: float = 1600.0, rough: float = 0.5, attack: float = 0.03, release: float = 1.6) -> np.ndarray:
    """Tunlan's shadow beasts: a padded growl — a rough throat pulse gliding f0 → f1 through two dark formants,
    low-passed so it is felt more than heard sharp."""
    n = ns(dur)
    t = np.arange(n) / SR
    f1 = f1 or f0
    jit = F.apply(O.white(n, r), [F.lowpass(30.0, 0.7)])
    jit = jit / (np.max(np.abs(jit)) + 1e-12)
    f = np.geomspace(f0, f1, n) * (1 + 0.05 * jit)
    src = O.saw(f, n) * (1 + rough * jit)
    src = src + 0.6 * norm(O.pink(n, r)) * (0.5 + 0.5 * np.sin(TAU * np.cumsum(f) / SR))
    y = S.formants(src, np.full(n, formant[0]), np.full(n, formant[1]), q=3.0, mix=0.95)
    y = lp(y, dark)
    return norm(y * E.stages([(0, 0, 0), (min(attack, dur * 0.4), 1, -1.5), (dur, 0, release)], n))


def roarer(f0: float, f1: float, dur: float, r: np.random.Generator, spin0: float = 2.5, spin1: float = 5.0,
           dark: float = 1500.0, swell: bool = True, air: float = 0.25, air_hz: float | None = None) -> np.ndarray:
    """Ulkro's bullroarer: a wooden slat whirled on its cord — a buzzing reed tone whose pitch and level pulse with every
    turn (the slat flipping twice a turn), rising as it spins faster."""
    n = ns(dur)
    t = np.arange(n) / SR
    spin = np.geomspace(spin0, spin1, n)
    ph = np.cumsum(spin) / SR
    turn = 0.5 + 0.5 * np.sin(TAU * ph)
    f = np.geomspace(f0, f1, n) * (1 + 0.05 * np.sin(TAU * 2 * ph))
    y = lp(O.saw(f, n), dark) * (0.2 + 0.8 * turn ** 2)
    a = F.apply(O.white(n, r), [F.bandpass(air_hz or float(math.sqrt(f0 * f1)) * 2.5, 1.5 if air_hz is None else 4.0)])
    y = norm(y) + air * norm(a * (0.3 + 0.7 * turn))
    envl = E.swell(n, dur * 0.9, -1.5, release=dur * 0.1) if swell else E.stages([(0, 0, 0), (0.05, 1, -1.0), (dur, 0, 1.4)], n)
    return norm(y * envl)


def handbell(f: float, dur: float = 1.0, t60: float = 0.8, r: np.random.Generator | None = None, beat: float = 3.0,
             bright: float = 1.0) -> np.ndarray:
    """Vashil's glass handbells: a small dawnglass bell — its hum an octave down, the strike, a minor third and a
    fifth over it, close partial pairs beating so it trembles."""
    r = r or rng(f'hbell:{f:.1f}')
    ratios = (0.5, 1.0, 1.0 + beat / f, 1.2, 1.5, 2.0, 2.66)
    amps = (0.5, 1.0, 0.6, 0.32 * bright, 0.22 * bright, 0.18 * bright, 0.09 * bright)
    t60s = tuple(t60 * k for k in (1.6, 1.0, 1.0, 0.6, 0.5, 0.35, 0.2))
    return S.partials(f, ratios, amps, t60s, dur, r, 0.3)


def puff(r: np.random.Generator, dur: float = 0.06, f: float = 900.0, q: float = 0.8) -> np.ndarray:
    """A short breath of air (a flame pinched out, a pipe blown): soft band noise, quick in and out."""
    n = ns(dur)
    x = F.apply(O.pink(n, r), [F.bandpass(f, q)])
    return norm(x * E.stages([(0, 0, 0), (dur * 0.15, 1, -1.0), (dur, 0, 2.0)], n))


def footfalls(r: np.random.Generator, times, f: float = 140.0, felt: bool = False) -> np.ndarray:
    """A run of steps: a low thump and a scuff each (felt: padded, nothing above 1.2 kHz)."""
    end = max(times) + 0.25
    y = np.zeros(ns(end))
    for i, t0 in enumerate(times):
        th = S.thump(0.18, f * r.uniform(0.95, 1.05), f * 0.5, 0.02, 0.1, 1.4)
        sc = scrape(r, 0.08, 600 if felt else 1400, 1.2, 40, 0.6, 0.2)
        s = ns(t0)
        y[s:s + th.size] += th[:y.size - s] * (0.7 + 0.3 * (i % 2))
        y[s:s + sc.size] += 0.35 * sc[:y.size - s]
    return norm(lp(y, 1200) if felt else y)


# ══ Marund, Dome mason ═══════════════════════════════════════════════════════════════════════════
@cue('f_marund_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_marund_attack_swing(v: int):
    """Marund's maul arc: a short, heavy pass of air low in the chest (130 → 300 → 220 Hz), a sub push under it and
    embers shaken out of the hearth-stone in the maul's head (a quick bright crackle trailing it)."""
    r = R('f_marund_attack_swing', v=v)
    d = detune(v, 25)
    L = Layers(0.42)
    L.add(S.whoosh(r, 0.34, 130 * d, 220 * d, q=0.9, peak_at=0.6, f_mid=300 * d, low_body=0.8, rise=-1.6), 0.0, peak_db=-1, width=0.4)
    L.add(woomf(0.3, 120 * d, 60, 0.18), 0.02, peak_db=-5)
    L.add(crackle(r, 0.24, 160, 3200, 8500, 0.08, 0.1), 0.14, peak_db=-6)
    L.add(creak(r, 0.06, 520 * d, 0.01, 1.1), 0.0, peak_db=-16)
    return _fin(L.out(), hp_hz=45, eq=[('peak', 3300, -2.0, 0.8)])


@cue('f_marund_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_marund_attack_hit(v: int):
    """The maul lands like a mortared block: a flat, dead thud low in the chest, the dome-stone in its head knocking a
    short D4 and embers jarred out of the hearth in it (a bright crackle), a little mortar grit."""
    r = R('f_marund_attack_hit', v=v)
    d = detune(v, 30)
    L = Layers(0.5)
    L.add(S.thump(0.3, 120 * d, 66, 0.03, 0.2, 1.6), 0.0, peak_db=-2)
    L.add(dome(hz('D4') * d, 0.35, 0.2, r, dark=4000), 0.002, peak_db=0)
    L.add(crackle(r, 0.3, 150, 3500, 8000, 0.05, 0.12), 0.006, peak_db=-2)
    L.add(crumble(r, 0.3, 10, 600, 1800, 0.06, 0.04, 'clay'), 0.01, peak_db=-14)
    return _fin(room(L.out(), 'tiny', wet=0.06), hp_hz=90, eq=SOFT_TOP)


@cue('f_marund_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_marund_a1(v: int):
    """Shoulder In: he drops a shoulder and goes — two heavy stamps (a deep doum with sub), the stone apron clattering,
    a low rush of air and the dome-stone knocking once as he meets them."""
    r = R('f_marund_a1', v=v)
    d = detune(v, 20)
    t = timing('marund', 'a1')[0]
    L = Layers(t + 0.75)
    L.add(drum('G1', 0.9, 'doum', seed=f'ma1{v}', dur=0.35, t60=0.2, kick=1.5, rr=v), 0.0, peak_db=-3)
    L.add(drum('G1', 1.0, 'doum', seed=f'ma1b{v}', dur=0.35, t60=0.2, kick=1.5, rr=v + 1), t, peak_db=-1)
    L.add(S.whoosh(r, 0.5, 140 * d, 260 * d, q=0.8, peak_at=0.45, f_mid=420 * d, low_body=1.0), t, peak_db=-3, width=0.5)
    L.add(crumble(r, 0.35, 12, 400, 1600, 0.08, 0.05), t + 0.03, peak_db=-11)
    L.add(dome(hz('G2') * d, 0.5, 0.3, r), t + 0.24, peak_db=-7)
    return _fin(room(L.out(), 'stone', wet=0.08), hp_hz=35, eq=SOFT_TOP)


@cue('f_marund_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_marund_a2(v: int):
    """Shelter Dome: the maul's head set down and the dome raised over them — the stone dome bell rung G2, long and
    round, its hum swelling under a soft hearth whump and crackle (warmth inside it)."""
    r = R('f_marund_a2', v=v)
    d = detune(v, 15)
    t = timing('marund', 'a2')[0]
    L = Layers(t + 1.2)
    L.add(breath(t + 0.01, 300, 900, shape='swell', q=1.6, seed=f'ma2{v}', curve=-2.0), 0.0, peak_db=-12, width=0.6)
    L.add(S.knock(r, 210 * d, 0.1, 5, 'stone'), t, peak_db=-4)
    L.add(dome(hz('G2') * d, 1.2, 0.95, r), t, peak_db=-1)
    L.add(dome(hz('D3') * d, 1.0, 0.7, r), t + 0.01, peak_db=-9)
    L.add(whump(r, 0.35, 600), t + 0.04, peak_db=-8)
    L.add(crackle(r, 0.8, 40, 1500, 5000, 0.15, 0.4), t + 0.08, peak_db=-14)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=40, eq=SOFT_TOP)


@cue('f_marund_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_marund_a3(v: int):
    """Mortar Pail: a pail of wet mortar heaved — a grunt of air, the load sloshing as it flies (thick, low bubbles) and,
    at the area's delay, a heavy wet slap on stone with a dull thud."""
    r = R('f_marund_a3', v=v)
    d = detune(v, 20)
    ct, dl = timing('marund', 'a3')
    L = Layers(ct + dl + 0.6)
    L.add(S.whoosh(r, 0.4, 200 * d, 300 * d, q=0.9, peak_at=0.3, f_mid=480 * d, low_body=0.6), ct, peak_db=-4, width=0.5)
    L.add(ink(r, max(dl, 0.2), 10, 110, 320, 0.12, wash=0.25, wash_hz=300), ct + 0.05, peak_db=-9)
    t = ct + dl
    L.add(S.burst(r, 0.12, 120, 1800, 0.06, attack=0.001), t, peak_db=-3)
    L.add(S.thump(0.3, 120 * d, 45, 0.03, 0.2, 2.0), t, peak_db=-2)
    L.add(ink(r, 0.4, 14, 120, 380, 0.08, wash=0.4, wash_hz=500), t + 0.01, peak_db=-6)
    L.add(S.knock(r, 260 * d, 0.06, 4, 'stone'), t + 0.004, peak_db=-8)
    return _fin(room(L.out(), 'stone', wet=0.08), hp_hz=40, lp_hz=7000, eq=SOFT_TOP)


@cue('f_marund_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_marund_ult_windup(v: int):
    """Domefall wind-up: the maul lifted overhead, the hearth in its head roaring up (a crackle swelling), the dome
    bell drawn in backwards from G2 and a low hum rising under it, cresting on the leap."""
    r = R('f_marund_ult_windup', v=v)
    D = wind('marund')
    L = Layers(D + 0.12)
    cr = crackle(r, D + 0.05, 90, 1800, 7000, 0.3)
    L.add(cr * E.swell(cr.size, D * 0.95, -2.0, release=0.03)[:cr.size], 0.0, peak_db=-6)
    L.add(swell_into(dome(hz('G2'), 1.0, 0.8, r), D), 0.0, peak_db=0)
    L.add(whump(r, D, 400) * np.linspace(0.2, 1, ns(D))[:ns(D)], 0.0, peak_db=-8)
    return _fin(L.out(), hp_hz=40, eq=CALM)


@cue('f_marund_ult_release', 'combat', T_REL, RELW, **BGK)
def f_marund_ult_release(v: int):
    """Domefall: he lands and the dome comes down with him — a huge mortar-stone slam (sub, a dark crack), the dome
    bell struck G2 then G3 (his call), a whoomph of hearth fire and mortar dust settling in a long crackle."""
    r = R('f_marund_ult_release', v=v)
    L = Layers(2.4)
    L.add(S.snap(r, 1400, 3.5), 0.0, peak_db=-10)
    L.add(S.thump(0.7, 120, 60, 0.04, 0.5, 2.0), 0.0, peak_db=-14)
    L.add(dome(hz('G2'), 2.2, 1.6, R('f_marund_ult_release', 'g2'), dark=4000), 0.0, peak_db=-1)
    L.add(dome(hz('G3'), 1.8, 1.2, R('f_marund_ult_release', 'g3'), dark=4000), 0.26, peak_db=0)
    L.add(whump(r, 0.6, 1200), 0.02, peak_db=-4)
    L.add(crackle(r, 1.8, 90, 1500, 7000, 0.2, 0.9), 0.05, peak_db=-5)
    L.add(crumble(r, 1.0, 16, 300, 1400, 0.25, 0.06, 'clay'), 0.04, peak_db=-12)
    return _fin(room(L.out(), 'hall', wet=0.12), hp_hz=75, eq=CALM)


@cue('f_marund_death', 'combat', T_DIE, DIEW, **BGK)
def f_marund_death(v: int):
    """Marund falls: the maul thuds down head first, the dome-stone's G2 hum choked short, the hearth in it guttering
    out (a crackle thinning to nothing) and a long breath out."""
    r = R('f_marund_death', v=v)
    L = Layers(1.8)
    L.add(S.thump(0.5, 100, 34, 0.04, 0.35, 2.4), 0.0, peak_db=-1)
    L.add(S.knock(r, 180, 0.12, 6, 'stone'), 0.0, peak_db=-4)
    L.add(dome(hz('G2'), 0.9, 0.5, r, dark=1500), 0.0, peak_db=-5)
    L.add(crackle(r, 1.2, 60, 1500, 5000, 0.1, 0.4), 0.05, peak_db=-10)
    L.add(S.knock(r, 240, 0.08, 5, 'stone'), 0.38, peak_db=-8)
    L.add(breath(1.3, 1100, 220, shape='breath', q=1.4, seed='mad', peak_at=0.12, vel=0.7), 0.1, peak_db=-9, width=0.6)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=30, eq=CALM)


@cue('f_marund_call', 'ui', T_CALL, CALLW, **CLK)
def f_marund_call(v: int):
    """Marund's call: the stone dome bell struck G2 then G3 — an octave raised like a roof — hearth crackle under it."""
    r = R('f_marund_call')
    L = Layers(1.9)
    L.add(dome(hz('G2'), 1.4, 1.1, R('f_marund_call', 'g2')), 0.0, peak_db=0, pan=-0.1)
    L.add(dome(hz('G3'), 1.5, 1.1, R('f_marund_call', 'g3')), 0.24, peak_db=-1, pan=0.1)
    L.add(crackle(r, 1.0, 35, 1500, 5000, 0.15, 0.5), 0.0, peak_db=-18)
    return _fin(room(L.out(), 'plate', wet=0.12), hp_hz=50, eq=CALM)


# ══ Nurrow, Lull singer ══════════════════════════════════════════════════════════════════════════
@cue('f_nurrow_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_nurrow_attack_swing(v: int):
    """Nurrow's snuffer-blade: the felt muffles it — a soft, dark sweep of air (380 → 620 Hz, nothing above 1.4 kHz)
    and a hush laid over it (the lull she carries: a quiet 'shh' high and narrow)."""
    r = R('f_nurrow_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.32)
    L.add(lp(S.whoosh(r, 0.24, 380 * d, 450 * d, q=2.2, peak_at=0.4, f_mid=620 * d, rise=-1.4), 1400), 0.0, peak_db=0, width=0.4)
    L.add(breath(0.22, 4600 * d, 3900 * d, shape='breath', q=5.0, seed=f'nus{v}', peak_at=0.3), 0.02, peak_db=-6, width=0.3)
    L.add(S.knock(r, 260 * d, 0.03, 3, 'clay'), 0.0, peak_db=-14)
    return _fin(L.out(), hp_hz=200, eq=[('peak', 3300, -3.0, 0.8)])


@cue('f_nurrow_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_nurrow_attack_hit(v: int):
    """The blade snuffs: a flame pinched out (a short 'pft' of air), the felt-wrapped edge's padded thump and a low
    vessel note sinking under it (sleep-heavy, F4 → A3) and her hush laid over it."""
    r = R('f_nurrow_attack_hit', v=v)
    d = detune(v, 30)
    L = Layers(0.45)
    L.add(puff(r, 0.05, 1100 * d, 1.0), 0.0, peak_db=-12)
    L.add(S.thump(0.18, 200 * d, 110, 0.015, 0.1, 1.4), 0.0, peak_db=-16)
    L.add(vessel(hz('F4') * d, hz('A3') * d, 0.3, r, vib=0.0, cents=0.0, air=0.05, attack=0.006, release=2.4), 0.004, peak_db=0)
    L.add(breath(0.25, 6300 * d, 5500 * d, shape='breath', q=5.0, seed=f'nuh{v}', peak_at=0.15), 0.01, peak_db=0, width=0.3)
    return _fin(room(L.out(), 'tiny', wet=0.06), hp_hz=200, eq=SOFT_TOP)


@cue('f_nurrow_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_nurrow_a1(v: int):
    """Felt Step: she slips forward — three padded footfalls on felt, a hush sweeping past her and the mantle's
    points fluttering."""
    r = R('f_nurrow_a1', v=v)
    d = detune(v, 20)
    t = timing('nurrow', 'a1')[0]
    L = Layers(t + 0.6)
    L.add(footfalls(r, (t, t + 0.11, t + 0.2), 160 * d, felt=True), 0.0, peak_db=-3)
    L.add(breath(0.45, 3800 * d, 1400, shape='breath', q=2.4, seed=f'nu1{v}', peak_at=0.2), t, peak_db=-2, width=0.8)
    L.add(lp(S.am(S.whoosh(r, 0.35, 500, 700, q=1.2, peak_at=0.4, f_mid=900), 22.0, 0.6), 1800), t + 0.04, peak_db=-8, width=0.6)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=60, eq=SOFT_TOP)


@cue('f_nurrow_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_nurrow_a2(v: int):
    """Lullaby Dart: a dart breathed from a pipe — a breath drawn in through the wind-up, a short puff and the dart's
    soft vessel note sliding D5 → A4 as it goes."""
    r = R('f_nurrow_a2', v=v)
    d = detune(v, 20)
    t = timing('nurrow', 'a2')[0]
    L = Layers(t + 0.7)
    L.add(breath(t + 0.01, 400, 1600, shape='swell', q=1.8, seed=f'nu2{v}', curve=-2.0), 0.0, peak_db=-10, width=0.4)
    L.add(puff(r, 0.07, 1500 * d, 0.9), t, peak_db=-3)
    L.add(vessel(hz('D5') * d, hz('A4') * d, 0.5, r, vib=5.0, cents=10.0, attack=0.02, curve=1.5), t + 0.01, peak_db=-1)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=150, eq=SOFT_TOP)


@cue('f_nurrow_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_nurrow_a3(v: int):
    """Snuff: the snuffer clapped down over them — a muffled felt clap, the flame inside going out with a 'thup' and a
    hush falling after it (the silence)."""
    r = R('f_nurrow_a3', v=v)
    d = detune(v, 20)
    t = timing('nurrow', 'a3')[0]
    L = Layers(t + 0.8)
    L.add(lp(S.whoosh(r, max(t, 0.1) + 0.05, 500, 900, q=1.0, peak_at=0.85, f_mid=1200), 2000), 0.0, peak_db=-8, width=0.5)
    L.add(lp(S.burst(r, 0.06, 200, 2500, 0.025, attack=0.001), 1600), t, peak_db=-2)
    L.add(S.thump(0.22, 170 * d, 80, 0.02, 0.12, 1.6), t, peak_db=-4)
    L.add(puff(r, 0.09, 700 * d, 0.7), t + 0.01, peak_db=-5)
    L.add(breath(0.6, 3200, 600, shape='breath', q=1.6, seed=f'nu3{v}', peak_at=0.08, vel=0.7), t + 0.03, peak_db=-6, width=0.7)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=70, eq=SOFT_TOP)


@cue('f_nurrow_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_nurrow_ult_windup(v: int):
    """Lull the Rest wind-up: the lullaby drawn in — the vessel flute's D5 swelling out of a long hush, rocked by a slow
    tremolo, cresting on the release."""
    r = R('f_nurrow_ult_windup', v=v)
    D = wind('nurrow')
    L = Layers(D + 0.12)
    vs = vessel(hz('D5'), hz('D5'), D + 0.06, r, vib=3.0, cents=18.0, air=0.3, attack=D * 0.85, release=3.0)
    L.add(S.am(vs, 7.0, 0.35), 0.0, peak_db=0)
    L.add(breath(D + 0.04, 5200, 2600, shape='swell', q=3.0, seed='nuw', curve=-2.0), 0.0, peak_db=-6, width=0.6)
    return _fin(L.out(), hp_hz=150, eq=CALM)


@cue('f_nurrow_ult_release', 'combat', T_REL, RELW, **BGK)
def f_nurrow_ult_release(v: int):
    """Lull the Rest: she sings them under — her call on the vessel flute (D5 A4 B4) rocking over a wide hush, felt
    footfalls as she goes and a low hollow sleep tone settling under it all."""
    r = R('f_nurrow_ult_release', v=v)
    L = Layers(2.2)
    L.add(breath(1.8, 4200, 900, shape='breath', q=1.4, seed='nur', peak_at=0.15, vel=0.8), 0.0, peak_db=-4, width=0.9)
    for i, (t, a, b, g) in enumerate(((0.0, 'D5', 'D5', -1), (0.28, 'A4', 'A4', -1), (0.56, 'B4', 'B4', 0))):
        L.add(vessel(hz(a), hz(b), 0.9 if i < 2 else 1.4, R('f_nurrow_ult_release', a), vib=4.5, cents=14.0, attack=0.03),
              t, peak_db=g, pan=(-0.15, 0.15, 0.0)[i])
    L.add(footfalls(r, (0.0, 0.12, 0.24), 150, felt=True), 0.0, peak_db=-10)
    L.add(hollow(hz('D3'), 1.4, 1.0, r, odd=3), 0.56, peak_db=-8)
    return _fin(room(L.out(), 'hall', wet=0.12), hp_hz=60, eq=CALM)


@cue('f_nurrow_death', 'combat', T_DIE, DIEW, **BGK)
def f_nurrow_death(v: int):
    """Nurrow falls: the snuffer hat drops (a soft felt thump), a last vessel note sinks A4 → D4 and a long hush closes
    over it."""
    r = R('f_nurrow_death', v=v)
    L = Layers(1.6)
    L.add(lp(S.thump(0.3, 160, 60, 0.02, 0.2, 1.6), 1200), 0.0, peak_db=-2)
    L.add(lp(S.knock(r, 300, 0.05, 4, 'clay'), 1500), 0.0, peak_db=-8)
    L.add(vessel(hz('A4'), hz('D4'), 1.0, r, vib=4.0, cents=12.0, attack=0.02, curve=1.0), 0.08, peak_db=-2)
    L.add(breath(1.3, 3600, 300, shape='breath', q=1.4, seed='nud', peak_at=0.1, vel=0.7), 0.1, peak_db=-6, width=0.8)
    return _fin(room(L.out(), 'small', wet=0.14), hp_hz=60, eq=CALM)


@cue('f_nurrow_call', 'ui', T_CALL, CALLW, **CLK)
def f_nurrow_call(v: int):
    """Nurrow's call: the vessel flute rocking D5 → A4 → B4, a lull with the Dorian sixth in it, a hush under it."""
    L = Layers(1.8)
    for i, (t, note, g, dur) in enumerate(((0.0, 'D5', -1, 0.4), (0.24, 'A4', -1, 0.4), (0.48, 'B4', 0, 1.0))):
        L.add(vessel(hz(note), hz(note), dur, R('f_nurrow_call', note), vib=4.5, cents=12.0, attack=0.03), t, peak_db=g,
              pan=(-0.12, 0.12, 0.0)[i])
    L.add(breath(1.2, 3800, 900, shape='breath', q=1.6, seed='nuc', peak_at=0.15, vel=0.6), 0.0, peak_db=-16, width=0.6)
    return _fin(room(L.out(), 'wood', wet=0.14), hp_hz=150, eq=CALM)


# ══ Odrum, Amber setter ══════════════════════════════════════════════════════════════════════════
@cue('f_odrum_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_odrum_attack_swing(v: int):
    """Odrum's staff-sling let go: a whirring pass of air (one turn, a 16 Hz wobble round 900 Hz), the walnut staff
    creaking on his shoulders and the cord's crack as the shot leaves."""
    r = R('f_odrum_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.34)
    L.add(S.am(S.whoosh(r, 0.24, 600 * d, 800 * d, q=2.0, peak_at=0.55, f_mid=950 * d, rise=-1.2), 16.0, 0.7), 0.0, peak_db=0, width=0.6)
    L.add(creak(r, 0.07, 380 * d, 0.012, 1.2), 0.0, peak_db=-12)
    L.add(S.snap(r, 2600 * d, 1.5), 0.15, peak_db=-6)
    L.add(slit(hz('E4') * d, 0.12, 0.06, r), 0.15, peak_db=-12)
    return _fin(L.out(), hp_hz=200, lp_hz=9000, eq=SOFT_TOP)


@cue('f_odrum_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_odrum_attack_hit(v: int):
    """The resin shot lands: an amber crack (a dull, damped split), a sticky splat and the slit drum's dry A3 tock
    under it."""
    r = R('f_odrum_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.42)
    L.add(amber(r, 820 * d, 3200), 0.0, peak_db=0)
    L.add(slit(hz('A3') * d, 0.3, 0.14, r), 0.0, peak_db=-2)
    L.add(lp(S.burst(r, 0.05, 400, 3000, 0.02, attack=0.001), 2500), 0.004, peak_db=-8)
    L.add(ink(r, 0.25, 5, 200, 500, 0.05, wash=0.1), 0.02, peak_db=-12)
    return _fin(room(L.out(), 'wood', wet=0.08), hp_hz=150, lp_hz=6000, eq=SOFT_TOP)


@cue('f_odrum_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_odrum_a1(v: int):
    """Resin Shot: a resin pot slung — the sling's whirl and release, the pot tumbling and, at the zone's delay, a thick
    splash of resin bubbling as it spreads, the drum's low A3 under it."""
    r = R('f_odrum_a1', v=v)
    d = detune(v, 20)
    ct, dl = timing('odrum', 'a1')
    L = Layers(ct + dl + 0.7)
    L.add(S.am(S.whoosh(r, ct + 0.05, 700, 1200, q=1.6, peak_at=0.8, f_mid=1500), 12.0, 0.7), 0.0, peak_db=-8, width=0.5)
    L.add(S.snap(r, 2200 * d, 1.5), ct, peak_db=-8)
    L.add(slit(hz('E4') * d, 0.2, 0.1, r), ct, peak_db=-10)
    t = ct + dl
    L.add(lp(S.burst(r, 0.1, 150, 2500, 0.05, attack=0.001), 2000), t, peak_db=-3)
    L.add(ink(r, 0.6, 16, 150, 450, 0.12, wash=0.35, wash_hz=600), t + 0.01, peak_db=-3)
    L.add(slit(hz('A3') * d, 0.5, 0.3, r), t, peak_db=-5)
    L.add(crackle(r, 0.5, 60, 1200, 4000, 0.0, 0.3), t + 0.08, peak_db=-14)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=60, eq=SOFT_TOP)


@cue('f_odrum_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_odrum_a2(v: int):
    """Swing Out: the yoke swung round wide — a broad slow pass of air all the way round him, the two resin pots
    clunking (the slit drum's D4 and E4) and resin sloshing in them."""
    r = R('f_odrum_a2', v=v)
    d = detune(v, 20)
    t = timing('odrum', 'a2')[0]
    L = Layers(t + 0.8)
    L.add(S.whoosh(r, 0.7, 300 * d, 500 * d, q=1.0, peak_at=0.4, f_mid=800 * d, low_body=0.5), max(t - 0.12, 0.0), peak_db=-1, width=0.9)
    L.add(slit(hz('D4') * d, 0.4, 0.22, r), t, peak_db=-3, pan=-0.3)
    L.add(slit(hz('E4') * d, 0.4, 0.22, r), t + 0.13, peak_db=-4, pan=0.3)
    L.add(ink(r, 0.4, 8, 150, 400, 0.1, wash=0.2), t + 0.05, peak_db=-12)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=60, eq=SOFT_TOP)


@cue('f_odrum_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_odrum_a3(v: int):
    """Step and Load: a quick step and a fresh pot dropped into the pouch — a leather thud, a clay knock, a resin
    slosh and the drum's bright tick (loaded)."""
    r = R('f_odrum_a3', v=v)
    d = detune(v, 20)
    L = Layers(0.6)
    L.add(footfalls(r, (0.0, 0.1), 150 * d), 0.0, peak_db=-6)
    L.add(lp(S.whoosh(r, 0.25, 400, 700, q=1.0, peak_at=0.3, f_mid=1000), 3000), 0.0, peak_db=-8, width=0.6)
    L.add(S.knock(r, 420 * d, 0.05, 4, 'clay'), 0.16, peak_db=-2)
    L.add(lp(S.thump(0.15, 220, 120, 0.015, 0.08, 1.2), 1500), 0.16, peak_db=-6)
    L.add(ink(r, 0.2, 5, 200, 450, 0.04, wash=0.1), 0.18, peak_db=-12)
    L.add(slit(hz('D5') * d, 0.25, 0.12, r), 0.24, peak_db=-6)
    return _fin(room(L.out(), 'wood', wet=0.1), hp_hz=80, eq=SOFT_TOP)


@cue('f_odrum_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_odrum_ult_windup(v: int):
    """Amber Hour wind-up: the resin in both pots heating — a crackle quickening and a roll on the slit drum's two big tongues (A2 D3) building
    under it, cresting on the release."""
    r = R('f_odrum_ult_windup', v=v)
    D = wind('odrum')
    L = Layers(D + 0.12)
    tt, i = 0.0, 0
    while tt < D - 0.02:
        u = tt / D
        L.add(slit(hz('A2' if i % 2 else 'D3'), 0.2, 0.1, R('f_odrum_ult_windup', str(i))), tt, peak_db=-2 + 8 * u)
        tt += 0.09 - 0.05 * u
        i += 1
    cr = crackle(r, D + 0.04, 160, 1500, 3500, 0.05)
    L.add(cr * E.swell(cr.size, D * 0.95, -2.0, release=0.03)[:cr.size], 0.0, peak_db=0)
    return _fin(L.out(), hp_hz=60, lp_hz=4000, eq=CALM)


@cue('f_odrum_ult_release', 'combat', T_REL, RELW, **BGK)
def f_odrum_ult_release(v: int):
    """Amber Hour: both pots emptied over them — a great resin splash, his call on the slit drum (A3 E4 D4) and, at
    the zone's delay, the amber setting hard: a run of dull cracks and a long sticky crackle."""
    r = R('f_odrum_ult_release', v=v)
    dl = max(timing('odrum', 'ult')[1], 0.3)
    L = Layers(dl + 1.5)
    L.add(lp(S.whoosh(r, 0.5, 300, 600, q=0.9, peak_at=0.25, f_mid=1100, low_body=0.4), 3000), 0.0, peak_db=-4, width=0.9)
    L.add(ink(r, 0.9, 26, 140, 500, 0.15, wash=0.45, wash_hz=700), 0.05, peak_db=-3, width=0.8)
    for i, (t, note, g) in enumerate(((0.0, 'A3', -1), (0.18, 'E4', -2), (0.36, 'D4', -1))):
        L.add(slit(hz(note), 0.9, 0.55, R('f_odrum_ult_release', note)), t, peak_db=g, pan=(-0.15, 0.15, 0.0)[i])
    for k in range(5):
        L.add(amber(R('f_odrum_ult_release', f'c{k}'), 620 * (1 + 0.12 * k), 3400), dl + 0.07 * k, peak_db=-1 - k)
    L.add(crackle(r, 1.0, 70, 1200, 4500, 0.05, 0.6), dl + 0.05, peak_db=-10)
    return _fin(room(L.out(), 'hall', wet=0.1), hp_hz=80, eq=CALM)


@cue('f_odrum_death', 'combat', T_DIE, DIEW, **BGK)
def f_odrum_death(v: int):
    """Odrum falls: the two resin pots break on the ground (clay knocks, resin spilling), the walnut staff clatters down
    end over end and the slit drum's last A3 dies out."""
    r = R('f_odrum_death', v=v)
    L = Layers(1.6)
    L.add(S.knock(r, 520, 0.06, 4, 'clay'), 0.0, peak_db=-2)
    L.add(S.chips(r, 0.3, 14, 1200, 4000, 0.06, 0.08), 0.0, peak_db=-9)
    L.add(S.knock(r, 460, 0.06, 4, 'clay'), 0.09, peak_db=-4)
    L.add(ink(r, 0.7, 16, 140, 450, 0.15, wash=0.35), 0.05, peak_db=-6)
    L.add(S.knock(r, 330, 0.09, 5, 'wood'), 0.25, peak_db=-4)
    L.add(S.knock(r, 290, 0.08, 5, 'wood'), 0.4, peak_db=-7)
    L.add(S.thump(0.4, 130, 45, 0.03, 0.28, 2.0), 0.15, peak_db=-5)
    L.add(slit(hz('A3'), 1.0, 0.7, r), 0.42, peak_db=-6)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=40, eq=CALM)


@cue('f_odrum_call', 'ui', T_CALL, CALLW, **CLK)
def f_odrum_call(v: int):
    """Odrum's call: the walnut slit drum, A3 → E4 → D4, an amber crack's dull glint on the last."""
    L = Layers(1.4)
    for i, (t, note, g) in enumerate(((0.0, 'A3', -1), (0.17, 'E4', -1), (0.34, 'D4', 0))):
        L.add(slit(hz(note), 0.8, 0.5, R('f_odrum_call', note)), t, peak_db=g, pan=(-0.15, 0.15, 0.0)[i])
    L.add(amber(R('f_odrum_call', 'c'), 900, 3000), 0.34, peak_db=-14)
    return _fin(room(L.out(), 'wood', wet=0.14), hp_hz=90, eq=CALM)


# ══ Rishal, Glass runner ═════════════════════════════════════════════════════════════════════════
@cue('f_rishal_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_rishal_attack_swing(v: int):
    """Rishal's two reversed knives drawn past: two quick, thin passes of air high up (4-6.5 kHz) 50 ms apart, a tiny
    glass rod tick on each edge."""
    r = R('f_rishal_attack_swing', v=v)
    d = detune(v, 40)
    L = Layers(0.24)
    for i, t in enumerate((0.0, 0.05)):
        L.add(S.whoosh(r, 0.11, 3800 * d, 5200 * d, q=3.0, peak_at=0.4, f_mid=6500 * d, rise=-1.0, fall=2.8), t,
              peak_db=-1 - 2 * i, pan=(-0.25, 0.25)[i], width=0.3)
        L.add(rod(hz('E7') * d * (1 + 0.06 * i), 0.06, 0.03, r, 0.5), t + 0.04, peak_db=-12 - i)
    return _fin(L.out(), hp_hz=1200, eq=[('peak', 3300, -2.0, 0.8)])


@cue('f_rishal_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_rishal_attack_hit(v: int):
    """The knives bite: two hard glass rod 'tsik's (A6 then E7, very short) over a thin slicing burst; almost no body,
    a light tap of the fist behind them."""
    r = R('f_rishal_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.3)
    L.add(S.burst(r, 0.025, 6000, 12000, 0.01), 0.0, peak_db=-7)
    L.add(rod(hz('A6') * d, 0.18, 0.08, r, bright=0.5), 0.0, peak_db=0)
    L.add(rod(hz('E7') * d, 0.15, 0.06, r, bright=0.5), 0.03, peak_db=-3)
    L.add(S.thump(0.08, 300 * d, 180, 0.01, 0.04, 1.2), 0.0, peak_db=-16)
    return _fin(room(L.out(), 'glass', wet=0.06), hp_hz=600, lp_hz=11000, eq=[('peak', 3300, -4.0, 0.8), ('high', 9000, -3.0)])


@cue('f_rishal_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_rishal_a1(v: int):
    """Glass Dash: a fast low dash and the glass track laid behind him — a quick rush of air and a skitter of glass grit
    pattering out along the line, a thin rod whine over it."""
    r = R('f_rishal_a1', v=v)
    d = detune(v, 25)
    L = Layers(0.6)
    L.add(S.whoosh(r, 0.25, 1200 * d, 2000 * d, q=1.6, peak_at=0.3, f_mid=3000 * d), 0.0, peak_db=-3, width=0.5)
    L.add(S.chips(r, 0.45, 40, 3500, 11000, 0.15, 0.25), 0.03, peak_db=-2, width=0.7)
    L.add(fm_tone(hz('A6') * d, hz('E6') * d, 0.3, ratio=2.756, i0=0.6, i1=0.1, t60=0.25, curve=1.5), 0.04, peak_db=-12)
    return _fin(room(L.out(), 'glass', wet=0.08), hp_hz=400, eq=SOFT_TOP)


@cue('f_rishal_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_rishal_a2(v: int):
    """Glint Cut: a flurry — three quick slashes after the wind-up, a glass rod ping on each, rising E6 A6 B6."""
    r = R('f_rishal_a2', v=v)
    d = detune(v, 20)
    t = timing('rishal', 'a2')[0]
    L = Layers(t + 0.6)
    L.add(hiss(r, max(t, 0.05) + 0.01, 3000, 6000, q=1.6, attack=max(t, 0.05), fall=4.0), 0.0, peak_db=-12)
    for i, note in enumerate(('E6', 'A6', 'B6')):
        tt = t + 0.075 * i
        L.add(S.whoosh(r, 0.1, 3000 * d, 4500 * d, q=2.6, peak_at=0.4, f_mid=6000 * d, rise=-1.0, fall=2.8), tt,
              peak_db=-2, pan=(-0.3, 0.3, 0.0)[i], width=0.3)
        L.add(rod(hz(note) * d, 0.2, 0.1, r), tt + 0.04, peak_db=-4 - i)
    return _fin(room(L.out(), 'glass', wet=0.08), hp_hz=500, eq=SOFT_TOP)


@cue('f_rishal_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_rishal_a3(v: int):
    """Feint: a step one way and gone the other — a swish cut short, a reversed glass tick drawing him back and a
    light scuff where he lands."""
    r = R('f_rishal_a3', v=v)
    d = detune(v, 25)
    L = Layers(0.5)
    L.add(at_len(S.whoosh(r, 0.2, 1500 * d, 2500 * d, q=1.6, peak_at=0.6, f_mid=3500 * d), 0.1, 0.01), 0.0, peak_db=-2, pan=-0.3, width=0.4)
    L.add(rev(rod(hz('B6') * d, 0.2, 0.12, r), 0.004), 0.06, peak_db=-6, pan=0.2)
    L.add(S.whoosh(r, 0.18, 2000 * d, 3000 * d, q=1.6, peak_at=0.3, f_mid=4200 * d), 0.24, peak_db=-4, pan=0.3, width=0.4)
    L.add(scrape(r, 0.1, 2200, 1.4, 50, 0.6, 0.2), 0.36, peak_db=-12)
    return _fin(room(L.out(), 'glass', wet=0.06), hp_hz=500, eq=SOFT_TOP)


@cue('f_rishal_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_rishal_ult_windup(v: int):
    """Long Glint wind-up: the knives coiled — a glass rod rubbed up to a thin whine (E6 → A6, its index climbing),
    heat hissing off the blades, cresting on the release."""
    r = R('f_rishal_ult_windup', v=v)
    D = wind('rishal')
    L = Layers(D + 0.1)
    L.add(fm_tone(hz('E6'), hz('A6'), D + 0.03, ratio=2.756, i0=0.2, i1=1.6, curve=-1.5, env='swell'), 0.0, peak_db=0)
    hs = hiss(r, D + 0.03, 5000, 9000, q=1.4, attack=D, fall=6.0)
    L.add(hs, 0.0, peak_db=-6)
    return _fin(L.out(), hp_hz=600, eq=CALM)


@cue('f_rishal_ult_release', 'combat', T_REL, RELW, **BGK)
def f_rishal_ult_release(v: int):
    """Long Glint: one long cut across their line — a tearing high slash that travels, then the glass track splits
    open behind it in his call (E6 B6 A6, struck rods) and a long scatter of shards ticking down."""
    r = R('f_rishal_ult_release', v=v)
    L = Layers(2.0)
    L.add(S.whoosh(r, 0.45, 2500, 4000, q=2.0, peak_at=0.3, f_mid=7000, rise=-1.0, fall=2.0), 0.0, peak_db=0, width=0.9)
    L.add(S.burst(r, 0.04, 4000, 12000, 0.015), 0.0, peak_db=-6)
    for i, (t, note, g) in enumerate(((0.14, 'E6', -2), (0.28, 'B6', -3), (0.42, 'A6', -2))):
        L.add(rod(hz(note), 1.1, 0.7, R('f_rishal_ult_release', note)), t, peak_db=g, pan=(-0.3, 0.3, 0.0)[i])
    L.add(S.shards(r, 1.5, 50, 3500, 11000, 0.25, 0.08, 0.2), 0.14, peak_db=-6, width=0.9)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=400, eq=CALM)


@cue('f_rishal_death', 'combat', T_DIE, DIEW, **BGK)
def f_rishal_death(v: int):
    """Rishal falls: both knives drop and ring on stone (two glass clinks), the glass visor cracks, grit spills and a
    breath goes out."""
    r = R('f_rishal_death', v=v)
    L = Layers(1.5)
    L.add(rod(hz('A6'), 0.5, 0.3, r), 0.0, peak_db=-3, pan=-0.2)
    L.add(rod(hz('F6'), 0.5, 0.3, r), 0.13, peak_db=-4, pan=0.2)
    L.add(S.snap(r, 3400, 2.0), 0.24, peak_db=-8)
    L.add(S.partials(hz('B5'), (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.06, 0.04, 0.02), 0.15, r), 0.24, peak_db=-6)
    L.add(S.shards(r, 0.7, 20, 3000, 10000, 0.15, 0.08, 0.2), 0.25, peak_db=-8)
    L.add(S.thump(0.3, 150, 60, 0.02, 0.2, 1.6), 0.26, peak_db=-8)
    L.add(breath(1.0, 3000, 400, shape='breath', q=1.6, seed='rid', peak_at=0.08, vel=0.6), 0.3, peak_db=-10, width=0.7)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=80, eq=CALM)


@cue('f_rishal_call', 'ui', T_CALL, CALLW, **CLK)
def f_rishal_call(v: int):
    """Rishal's call: struck glass rods, E6 → B6 → A6, quick and bright, the last left ringing."""
    L = Layers(1.3)
    for i, (t, note, g) in enumerate(((0.0, 'E6', -1), (0.12, 'B6', -2), (0.24, 'A6', 0))):
        L.add(rod(hz(note), 0.9, 0.55 if i < 2 else 0.8, R('f_rishal_call', note)), t, peak_db=g, pan=(-0.15, 0.15, 0.0)[i])
    return _fin(room(L.out(), 'glass', wet=0.14), hp_hz=300, eq=CALM)


# ══ Sukri, Rim wanderer ══════════════════════════════════════════════════════════════════════════
@cue('f_sukri_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_sukri_attack_swing(v: int):
    """Sukri tosses a mote of noon off the crook: the glass cup on its hook tinks A5 (wobbling, light sloshing in it)
    and the crook's wooden tick; nothing else, a small and kindly sound."""
    r = R('f_sukri_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.36)
    L.add(cup(hz('A5') * d, 0.32, 0.2, wob=5.0, cents=18.0, phase=v), 0.0, peak_db=0)
    L.add(S.knock(r, 1600 * d, 0.012, 3, 'wood'), 0.0, peak_db=-12)
    L.add(breath(0.16, 700, 1800, shape='swell', q=2.5, seed=f'sus{v}'), 0.0, peak_db=-16, width=0.3)
    return _fin(L.out(), hp_hz=300, eq=[('peak', 3300, -2.0, 0.8)])


@cue('f_sukri_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_sukri_attack_hit(v: int):
    """The mote lands: a bright 'plip' (a bubble of light rising, like a drop into the cup) and a soft body tap."""
    r = R('f_sukri_attack_hit', v=v)
    d = detune(v, 40)
    L = Layers(0.32)
    b = bubble(1250 * d, 0.07, 1.9, 0.05, attack=0.001)
    L.add(b, 0.0, peak_db=0)
    L.add(bubble(1700 * d, 0.05, 1.7, 0.035, attack=0.001), 0.025, peak_db=-6)
    L.add(lp(S.thump(0.12, 260 * d, 160, 0.01, 0.06, 1.2), 1500), 0.0, peak_db=-12)
    return _fin(room(L.out(), 'small', wet=0.06), hp_hz=500, eq=SOFT_TOP)


@cue('f_sukri_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_sukri_a1(v: int):
    """Mote Toss: two motes lobbed from the cup — the cup's tink on the throw, then, at the areas' delay, two plips of
    light landing with a warm shimmer over them."""
    r = R('f_sukri_a1', v=v)
    d = detune(v, 20)
    ct, dl = timing('sukri', 'a1')
    L = Layers(ct + dl + 0.6)
    L.add(breath(ct + 0.01, 500, 1500, shape='swell', q=2.0, seed=f'su1{v}', curve=-2.0), 0.0, peak_db=-12, width=0.4)
    L.add(cup(hz('A5') * d, 0.4, 0.3, phase=v), ct, peak_db=-4)
    t = ct + dl
    L.add(bubble(1150 * d, 0.08, 1.9, 0.06), t, peak_db=-1, pan=-0.25)
    L.add(bubble(1500 * d, 0.07, 1.8, 0.05), t + 0.05, peak_db=-2, pan=0.25)
    L.add(shimmer(hz('E6') * d, 0.4, 0.5, decay=0.3, seed=f'su1{v}'), t + 0.02, peak_db=-10)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=200, eq=SOFT_TOP)


@cue('f_sukri_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_sukri_a2(v: int):
    """Draw Near: he beckons — a glass swell drawn toward him (played backwards) onto the cup's warm D5, his wraps
    rustling as the ally comes."""
    r = R('f_sukri_a2', v=v)
    d = detune(v, 20)
    t = max(timing('sukri', 'a2')[0], 0.12)
    L = Layers(t + 0.8)
    L.add(rev(at_len(cup(hz('D6') * d, 0.6, 0.5), t, 0.002), 0.02), 0.0, peak_db=-4)
    L.add(cup(hz('D5') * d, 0.7, 0.55, wob=3.0, cents=10.0, phase=v), t, peak_db=0)
    L.add(lp(S.am(O.pink(ns(0.4), r), 18.0, 0.7) * E.decay(ns(0.4), 0.3, 0.02), 3000), t + 0.02, peak_db=-12)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=200, eq=SOFT_TOP)


@cue('f_sukri_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_sukri_a3(v: int):
    """Wrap Cast: a wrap thrown — the cloth flutters as it unrolls through the air, then two escapement ticks pull it
    tight (the bind)."""
    r = R('f_sukri_a3', v=v)
    d = detune(v, 20)
    t = timing('sukri', 'a3')[0]
    L = Layers(t + 0.7)
    fl = F.apply(O.pink(ns(0.35), r), [F.bandpass(1400 * d, 0.9)])
    L.add(S.am(fl * E.stages([(0, 0, 0), (0.05, 1, -1.0), (0.35, 0, 1.5)], ns(0.35)), 26.0, 0.8), t, peak_db=-2, width=0.6)
    L.add(esc('tick', 0.9, rr=v, seed=f'su3{v}'), t + 0.3, peak_db=-3)
    L.add(esc('tock', 0.9, rr=v + 1, seed=f'su3{v}'), t + 0.38, peak_db=-2)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=150, eq=SOFT_TOP)


@cue('f_sukri_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_sukri_ult_windup(v: int):
    """Gather In wind-up: the hour wound — escapement ticks coming faster and the cup's tone bowed up A5 → D6,
    swelling, cresting on the release."""
    D = wind('sukri')
    L = Layers(D + 0.12)
    tt, i = 0.0, 0
    while tt < D - 0.03:
        u = tt / D
        L.add(esc('tick' if i % 2 == 0 else 'tock', 0.6 + 0.3 * u, rr=i % 4, seed='suw'), tt, peak_db=-9 + 6 * u)
        tt += 0.11 - 0.06 * u
        i += 1
    n = ns(D + 0.04)
    t = np.arange(n) / SR
    f = np.geomspace(hz('A5'), hz('D6'), n) * 2 ** (14 / 1200 * np.sin(TAU * 4.0 * t))
    tone = sum(a * np.sin(TAU * np.cumsum(f * k) / SR) for k, a in ((1.0, 1.0), (2.32, 0.3)))
    L.add(tone * E.swell(n, D * 0.95, -2.0, release=0.03), 0.0, peak_db=0)
    return _fin(L.out(), hp_hz=200, eq=CALM)


@cue('f_sukri_ult_release', 'combat', T_REL, RELW, **BGK)
def f_sukri_ult_release(v: int):
    """Gather In: everyone gathered into his spare hour — the cup struck in a chord (E5 A5 D6, wobbling), the clock
    stopped dead (one last tock) and a warm held shimmer of noon, then the zone settling after its delay."""
    r = R('f_sukri_ult_release', v=v)
    dl = max(timing('sukri', 'ult')[1], 0.2)
    L = Layers(2.2)
    L.add(esc('tock', 1.0, rr=2, seed='sur'), 0.0, peak_db=-6)
    for i, (note, g) in enumerate((('E5', -2), ('A5', -1), ('D6', -4))):
        L.add(cup(hz(note), 1.8, 1.4, wob=3.0 + i, cents=12.0, phase=i), 0.004 * i, peak_db=g, pan=(-0.2, 0.0, 0.2)[i])
    L.add(rev(shimmer(hz('A5'), 0.6, 0.6, decay=0.4, seed='sur'), 0.02), 0.0, peak_db=-12)
    L.add(shimmer(hz('A6'), 1.4, 0.5, decay=1.0, index=2.0, seed='sur2'), dl, peak_db=-10)
    L.add(breath(1.2, 600, 2400, shape='breath', q=1.4, seed='sur', peak_at=0.2, vel=0.5), dl, peak_db=-14, width=0.8)
    return _fin(room(L.out(), 'glass', wet=0.14), hp_hz=150, eq=CALM)


@cue('f_sukri_death', 'combat', T_DIE, DIEW, **BGK)
def f_sukri_death(v: int):
    """Sukri falls: the cup drops and cracks (its A5 cut off), the escapement ticks slowing to a stop and the staff
    clattering down beside him."""
    r = R('f_sukri_death', v=v)
    L = Layers(1.7)
    L.add(at_len(cup(hz('A5'), 0.4, 0.3), 0.12, 0.01), 0.0, peak_db=-3)
    L.add(S.snap(r, 3200, 1.8), 0.12, peak_db=-8)
    L.add(S.partials(hz('A5') * 1.1, (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.06, 0.04, 0.02), 0.15, r), 0.12, peak_db=-6)
    tt = 0.25
    for i in range(5):
        L.add(esc('tick' if i % 2 == 0 else 'tock', 0.85 - 0.1 * i, rr=i % 4, seed='sud'), tt, peak_db=-5 - 1.5 * i)
        tt += 0.12 + 0.07 * i
    L.add(S.knock(r, 360, 0.08, 5, 'wood'), 0.3, peak_db=-6)
    L.add(S.thump(0.35, 140, 50, 0.025, 0.25, 1.8), 0.3, peak_db=-7)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=60, eq=CALM)


@cue('f_sukri_call', 'ui', T_CALL, CALLW, **CLK)
def f_sukri_call(v: int):
    """Sukri's call: the glass cup struck A5 then E5, both wobbling (noon light sloshing in it), a tick between them."""
    L = Layers(1.6)
    L.add(cup(hz('A5'), 0.9, 0.7, wob=4.0, cents=14.0), 0.0, peak_db=-1, pan=-0.1)
    L.add(esc('tick', 0.5, rr=1, seed='suc'), 0.13, peak_db=-16)
    L.add(cup(hz('E5'), 1.3, 1.0, wob=3.5, cents=14.0, phase=1.0), 0.26, peak_db=0, pan=0.1)
    return _fin(room(L.out(), 'glass', wet=0.14), hp_hz=200, eq=CALM)


# ══ Tunlan, Shadow puppeteer ═════════════════════════════════════════════════════════════════════
@cue('f_tunlan_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_tunlan_attack_swing(v: int):
    """Tunlan flicks a shadow off her fingers: a dry clack of the small wooden finger joints and a short padded
    growl leaving with it (a dark 110 Hz throat, nothing bright in it)."""
    r = R('f_tunlan_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.34)
    L.add(S.knock(r, 3200 * d, 0.01, 3, 'wood'), 0.0, peak_db=-3)
    L.add(S.knock(r, 4000 * d, 0.008, 3, 'wood'), 0.02, peak_db=-6)
    L.add(growl(r, 0.24, 110 * d, 97 * d, formant=(300, 750), dark=750, attack=0.02, release=2.0), 0.02, peak_db=0)
    return _fin(L.out(), hp_hz=70, eq=SOFT_TOP)


@cue('f_tunlan_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_tunlan_attack_hit(v: int):
    """The shadow bites: a snap of padded jaws (a short growl bark, a snapping mouth, open round 1.1 and 2.4 kHz) and a little ink
    where it lands."""
    r = R('f_tunlan_attack_hit', v=v)
    d = detune(v, 30)
    L = Layers(0.4)
    L.add(growl(r, 0.2, 160 * d, 128 * d, formant=(1100, 2420), dark=5000, rough=0.45, attack=0.006, release=2.0), 0.0, peak_db=0)
    L.add(ink(r, 0.25, 5, 200, 600, 0.05, wash=0.2), 0.02, peak_db=-12)
    return _fin(room(L.out(), 'tiny', wet=0.06), hp_hz=400, lp_hz=9000, eq=SOFT_TOP)


@cue('f_tunlan_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_tunlan_a1(v: int):
    """Hound Shadow: a hound thrown off the lamp — her fingers shaping it (two clacks) through the wind-up, then a growl
    rising as it bounds away on padded paws, a rush of shade breath after it."""
    r = R('f_tunlan_a1', v=v)
    d = detune(v, 20)
    t = timing('tunlan', 'a1')[0]
    L = Layers(t + 0.7)
    L.add(S.knock(r, 1300 * d, 0.012, 3, 'wood'), 0.0, peak_db=-9)
    L.add(S.knock(r, 1500 * d, 0.012, 3, 'wood'), max(t - 0.1, 0.05), peak_db=-9)
    L.add(growl(r, 0.5, 85 * d, 120 * d, formant=(450, 1000), dark=1600, attack=0.05), t, peak_db=-1)
    L.add(footfalls(r, (t + 0.05, t + 0.15, t + 0.25, t + 0.35), 170 * d, felt=True), 0.0, peak_db=-6)
    L.add(breath(0.5, 2000, 500, shape='breath', q=1.6, seed=f'tu1{v}', peak_at=0.15), t, peak_db=-6, width=0.7)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=50, eq=SOFT_TOP)


@cue('f_tunlan_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_tunlan_a2(v: int):
    """Hand Shadow: a great shadow hand closes on them — the wooden fingers clacking shut one by one, a squeezing shade
    swell and a dull crunch as it grips."""
    r = R('f_tunlan_a2', v=v)
    d = detune(v, 20)
    t = timing('tunlan', 'a2')[0]
    L = Layers(t + 0.7)
    for i in range(4):
        L.add(S.knock(r, (1100 + 150 * i) * d, 0.012, 3, 'wood'), t * 0.25 * i, peak_db=-9 + i)
    L.add(breath(t + 0.02, 300, 1100, shape='swell', q=2.0, seed=f'tu2{v}', curve=-2.0), 0.0, peak_db=-4, width=0.6)
    L.add(lp(S.burst(r, 0.08, 150, 2000, 0.04, attack=0.001), 1500), t, peak_db=-3)
    L.add(S.thump(0.25, 140 * d, 55, 0.02, 0.15, 1.8), t, peak_db=-3)
    L.add(growl(r, 0.3, 70 * d, 60 * d, formant=(350, 800), dark=1200), t, peak_db=-7)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=40, eq=SOFT_TOP)


@cue('f_tunlan_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_tunlan_a3(v: int):
    """Lamp Flare: the lamp on her hat flares — the paper shade's sharp flap, a flame whump and a bright crackle as it
    burns high for a moment."""
    r = R('f_tunlan_a3', v=v)
    d = detune(v, 20)
    t = timing('tunlan', 'a3')[0]
    L = Layers(t + 0.7)
    flap = F.apply(O.coloured(ns(0.08), r, -1.0), [F.bandpass(1300 * d, 0.9)]) * E.stages([(0, 0, 0), (0.004, 1, -1.0), (0.08, 0, 2.0)], ns(0.08))
    L.add(flap, t, peak_db=-3)
    L.add(whump(r, 0.35, 900), t + 0.01, peak_db=-1)
    L.add(crackle(r, 0.5, 120, 1800, 7000, 0.15, 0.3), t + 0.02, peak_db=-5)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=60, eq=SOFT_TOP)


@cue('f_tunlan_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_tunlan_ult_windup(v: int):
    """Shadow Play wind-up: the lamp raised and the shadows rearing up the walls — a growl swelling from deep in the
    dark, the paper shade rattling and her fingers clacking, cresting on the release."""
    r = R('f_tunlan_ult_windup', v=v)
    D = wind('tunlan')
    L = Layers(D + 0.12)
    g = growl(r, D + 0.05, 55, 100, formant=(240, 600), dark=800, attack=D * 0.9, release=1.0)
    L.add(g, 0.0, peak_db=0)
    rat = F.apply(O.coloured(ns(D), r, -1.0), [F.bandpass(1200, 1.0)])
    L.add(S.am(rat, 30.0, 0.9) * E.swell(ns(D), D * 0.9, -2.0, release=0.03), 0.0, peak_db=-12)
    for i in range(3):
        L.add(S.knock(r, 1300 + 200 * i, 0.012, 3, 'wood'), D * (0.2 + 0.25 * i), peak_db=-12 + 2 * i)
    return _fin(L.out(), hp_hz=40, eq=CALM)


@cue('f_tunlan_ult_release', 'combat', T_REL, RELW, **BGK)
def f_tunlan_ult_release(v: int):
    """Shadow Play: the shadow beasts run — her call growled out of the dark (A2 C3 D3), a thunder of padded paws and a
    gust of shade breath sweeping through, landing where they meet the line after the area's delay."""
    r = R('f_tunlan_ult_release', v=v)
    dl = max(timing('tunlan', 'ult')[1], 0.3)
    L = Layers(dl + 1.5)
    for i, (t, note, g) in enumerate(((0.0, 'A2', -1), (0.2, 'C3', -1), (0.4, 'D3', 0))):
        L.add(growl(R('f_tunlan_ult_release', note), 0.55 if i < 2 else 1.0, hz(note), hz(note) * 0.97, formant=(400, 950),
                    dark=1500, attack=0.03), t, peak_db=g, pan=(-0.2, 0.2, 0.0)[i])
    paws = [0.05 + 0.07 * k + 0.01 * (k % 3) for k in range(int((dl + 0.4) / 0.07))]
    L.add(footfalls(r, paws, 120, felt=True), 0.0, peak_db=-6, width=0.8)
    L.add(breath(dl + 0.5, 1800, 350, shape='breath', q=1.4, seed='tur', peak_at=0.4, vel=0.8), 0.0, peak_db=-5, width=0.9)
    L.add(S.thump(0.6, 110, 40, 0.04, 0.4, 2.0), dl, peak_db=-6)
    L.add(ink(r, 0.7, 12, 150, 500, 0.12, wash=0.3), dl, peak_db=-10)
    return _fin(room(L.out(), 'stone', wet=0.1), hp_hz=40, eq=CALM)


@cue('f_tunlan_death', 'combat', T_DIE, DIEW, **BGK)
def f_tunlan_death(v: int):
    """Tunlan falls: her lamp gutters out (a puff, the paper shade crumpling), the wooden fingers clatter down and the
    last shadow sinks in a low growl."""
    r = R('f_tunlan_death', v=v)
    L = Layers(1.6)
    L.add(puff(r, 0.12, 900, 0.8), 0.0, peak_db=-3)
    L.add(S.am(F.apply(O.coloured(ns(0.3), r, -1.0), [F.bandpass(2000, 0.8)]) * E.decay(ns(0.3), 0.25, 0.005), 40.0, 0.9), 0.04, peak_db=-6)
    for i in range(5):
        L.add(S.knock(r, (900 + 160 * i) * r.uniform(0.9, 1.1), 0.015, 3, 'wood'), 0.2 + 0.05 * i + 0.02 * (i % 2), peak_db=-6 - i)
    L.add(S.thump(0.4, 130, 45, 0.03, 0.28, 2.0), 0.24, peak_db=-5)
    L.add(growl(r, 1.0, 70, 50, formant=(320, 700), dark=900, attack=0.1, release=1.5), 0.3, peak_db=-5)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=40, eq=CALM)


@cue('f_tunlan_call', 'ui', T_CALL, CALLW, **CLK)
def f_tunlan_call(v: int):
    """Tunlan's call: a shadow beast waking — a padded growl voiced A2 → C3 → D3, a finger clack on each."""
    L = Layers(1.7)
    for i, (t, note, g) in enumerate(((0.0, 'A2', -1), (0.22, 'C3', -1), (0.44, 'D3', 0))):
        rr = R('f_tunlan_call', note)
        L.add(growl(rr, 0.45 if i < 2 else 0.9, hz(note), hz(note), formant=(420, 1000), dark=1700, attack=0.03), t, peak_db=g,
              pan=(-0.15, 0.15, 0.0)[i])
        L.add(S.knock(rr, 1400 + 120 * i, 0.012, 3, 'wood'), t, peak_db=g - 10)
    return _fin(room(L.out(), 'wood', wet=0.12), hp_hz=60, eq=CALM)


# ══ Ulkro, Dart hunter ═══════════════════════════════════════════════════════════════════════════
@cue('f_ulkro_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_ulkro_attack_swing(v: int):
    """Ulkro's spear-thrower snaps: a dry wooden whip-crack as the atlatl flicks over and the dart leaving fast, its
    shaft flexing (a tight 28 Hz buzz round 5 kHz trailing away)."""
    r = R('f_ulkro_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.32)
    L.add(S.knock(r, 450 * d, 0.03, 4, 'wood'), 0.0, peak_db=0)
    L.add(S.snap(r, 3200 * d, 1.2), 0.0, peak_db=-10)
    fl = F.apply(O.pink(ns(0.22), r), [F.bandpass(5000 * d, 6.0)]) * E.stages([(0, 0, 0), (0.01, 1, -1.0), (0.22, 0, 1.8)], ns(0.22))
    L.add(S.am(fl, 28.0, 0.9), 0.012, peak_db=-6, pan=0.1)
    return _fin(L.out(), hp_hz=150, lp_hz=6000, eq=[('peak', 3300, -1.0, 0.8)])


@cue('f_ulkro_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_ulkro_attack_hit(v: int):
    """The dart thunks in: a hard wooden 'thock' and the shaft left quivering where it stands (a damped, low 123 Hz
    twang wobbling at 16 Hz)."""
    r = R('f_ulkro_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.42)
    L.add(S.knock(r, 1150 * d, 0.03, 4, 'wood'), 0.0, peak_db=-1)
    L.add(S.burst(r, 0.015, 800, 4000, 0.006), 0.0, peak_db=-8)
    n = ns(0.32)
    t = np.arange(n) / SR
    tw = np.sin(TAU * 123 * d * t + 2.0 * np.sin(TAU * 16 * t)) * np.exp(-t / 0.09) * (0.6 + 0.4 * np.cos(TAU * 16 * t))
    L.add(tw + 0.35 * np.sin(TAU * 246 * d * t) * np.exp(-t / 0.06), 0.004, peak_db=0)
    L.add(S.snap(r, 3000 * d, 1.2), 0.0, peak_db=-6)
    return _fin(room(L.out(), 'tiny', wet=0.05), hp_hz=95, lp_hz=5000, eq=SOFT_TOP)


@cue('f_ulkro_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ulkro_a1(v: int):
    """Hurl: the thrower drawn all the way back (a leather creak through the wind-up), a big whip-crack and a heavy
    dart whistling out low and long."""
    r = R('f_ulkro_a1', v=v)
    d = detune(v, 20)
    t = timing('ulkro', 'a1')[0]
    L = Layers(t + 0.7)
    L.add(creak(r, max(t, 0.08), 260 * d, 0.014, 1.4), 0.0, peak_db=-10)
    L.add(S.knock(r, 640 * d, 0.03, 4, 'wood'), t, peak_db=-1)
    L.add(S.snap(r, 2800 * d, 1.5), t, peak_db=-5)
    fl = F.apply(O.pink(ns(0.5), r), [F.bandpass(1500 * d, 2.0)]) * E.stages([(0, 0, 0), (0.02, 1, -1.0), (0.5, 0, 1.6)], ns(0.5))
    L.add(S.am(fl, 22.0, 0.85), t + 0.01, peak_db=-2, width=0.4)
    L.add(fm_tone(1100 * d, 700 * d, 0.45, ratio=1.0, i0=0.3, i1=0.0, t60=0.4, curve=1.0), t + 0.02, peak_db=-12)
    return _fin(room(L.out(), 'small', wet=0.06), hp_hz=150, eq=SOFT_TOP)


@cue('f_ulkro_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ulkro_a2(v: int):
    """Bound: a sprung leap — a push-off (the frame drum's rim), air rushing past her and a light, rolling landing."""
    r = R('f_ulkro_a2', v=v)
    d = detune(v, 20)
    t = timing('ulkro', 'a2')[0]
    L = Layers(t + 0.65)
    L.add(drum('D3', 0.9, 'tek', seed=f'ul2{v}', dur=0.2, t60=0.1, rr=v), t, peak_db=-3)
    L.add(S.whoosh(r, 0.35, 600 * d, 900 * d, q=1.2, peak_at=0.4, f_mid=1600 * d), t + 0.02, peak_db=-2, width=0.7)
    L.add(footfalls(r, (t + 0.36, t + 0.44), 180 * d), 0.0, peak_db=-6)
    return _fin(room(L.out(), 'small', wet=0.06), hp_hz=80, eq=SOFT_TOP)


@cue('f_ulkro_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ulkro_a3(v: int):
    """Hamstring Dart: a low flick of the thrower, the dart skimming in fast (a tight buzz) and its thock and quiver
    where it pins them."""
    r = R('f_ulkro_a3', v=v)
    d = detune(v, 20)
    t = timing('ulkro', 'a3')[0]
    L = Layers(t + 0.7)
    L.add(S.knock(r, 820 * d, 0.02, 4, 'wood'), t, peak_db=-3)
    fl = F.apply(O.pink(ns(0.16), r), [F.bandpass(3000 * d, 2.5)]) * E.stages([(0, 0, 0), (0.01, 1, -1.0), (0.16, 0, 1.4)], ns(0.16))
    L.add(S.am(fl, 34.0, 0.9), t + 0.01, peak_db=-2)
    L.add(S.knock(r, 560 * d, 0.03, 4, 'wood'), t + 0.17, peak_db=-2)
    n = ns(0.3)
    tt = np.arange(n) / SR
    L.add(np.sin(TAU * 190 * d * tt + 2.0 * np.sin(TAU * 20 * tt)) * np.exp(-tt / 0.07), t + 0.175, peak_db=-4)
    return _fin(room(L.out(), 'tiny', wet=0.06), hp_hz=100, eq=SOFT_TOP)


@cue('f_ulkro_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_ulkro_ult_windup(v: int):
    """Long Run wind-up: the bullroarer let out on its cord and starting to turn — a pulsing low buzz climbing E3 up
    into its spin, cresting as she sets off."""
    r = R('f_ulkro_ult_windup', v=v)
    D = wind('ulkro')
    L = Layers(D + 0.15)
    L.add(roarer(hz('B2'), hz('E3'), D + 0.08, r, spin0=6.0, spin1=12.0), 0.0, peak_db=0)
    L.add(S.whoosh(r, D + 0.05, 300, 900, q=1.2, peak_at=0.9, f_mid=700), 0.0, peak_db=-10, width=0.6)
    return _fin(L.out(), hp_hz=60, eq=CALM)


@cue('f_ulkro_ult_release', 'combat', T_REL, RELW, **BGK)
def f_ulkro_ult_release(v: int):
    """Long Run: she runs — the bullroarer at full whirl, her call (E3 then A3, two whirls, the cord whistling high
    over each turn, the slat's drone an octave under it), quick light footfalls under it and a dart's whip-crack starting the hunt."""
    r = R('f_ulkro_ult_release', v=v)
    L = Layers(2.2)
    L.add(S.knock(r, 700, 0.025, 4, 'wood'), 0.0, peak_db=-6)
    L.add(roarer(hz('E3'), hz('E3'), 0.8, R('f_ulkro_ult_release', 'e'), spin0=4.0, spin1=4.5, dark=350, swell=False,
                 air=1.4, air_hz=4200), 0.0, peak_db=-1)
    L.add(roarer(hz('A3'), hz('A3'), 1.3, R('f_ulkro_ult_release', 'a'), spin0=4.5, spin1=3.0, dark=350, swell=False,
                 air=1.4, air_hz=4450), 0.62, peak_db=0)
    L.add(footfalls(r, [0.05 + 0.13 * k for k in range(12)], 190), 0.0, peak_db=-16)
    n = ns(1.9)
    t = np.arange(n) / SR
    drone = np.sin(TAU * np.cumsum(np.where(t < 0.62, hz('E2'), hz('A2'))) / SR) * (0.5 + 0.5 * np.sin(TAU * 4.2 * t) ** 2)
    L.add(lp(drone * E.stages([(0, 0, 0), (0.05, 1, -1.0), (1.9, 0, 1.4)], n), 300), 0.0, peak_db=0)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=70, lp_hz=7000, eq=CALM)


@cue('f_ulkro_death', 'combat', T_DIE, DIEW, **BGK)
def f_ulkro_death(v: int):
    """Ulkro falls: the quiver spills — a clatter of dart shafts on the ground — the thrower drops with a wooden knock
    and her body thuds down."""
    r = R('f_ulkro_death', v=v)
    L = Layers(1.4)
    L.add(S.thump(0.4, 130, 45, 0.03, 0.28, 2.0), 0.0, peak_db=-2)
    tt = 0.03
    for i in range(9):
        L.add(S.knock(r, r.uniform(500, 1100), 0.025, 4, 'wood'), tt, peak_db=-4 - 0.8 * i, pan=r.uniform(-0.4, 0.4))
        tt += r.uniform(0.03, 0.08)
    L.add(S.knock(r, 420, 0.05, 5, 'wood'), 0.5, peak_db=-6)
    L.add(breath(1.0, 2000, 300, shape='breath', q=1.5, seed='uld', peak_at=0.08, vel=0.6), 0.05, peak_db=-10, width=0.6)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=60, eq=CALM)


@cue('f_ulkro_call', 'ui', T_CALL, CALLW, **CLK)
def f_ulkro_call(v: int):
    """Ulkro's call: the bullroarer whirled twice, E3 then A3, the hunt called out across the grass."""
    L = Layers(1.6)
    L.add(roarer(hz('E3'), hz('E3'), 0.6, R('f_ulkro_call', 'e'), spin0=4.0, spin1=4.0, swell=False), 0.0, peak_db=-1)
    L.add(roarer(hz('A3'), hz('A3'), 0.9, R('f_ulkro_call', 'a'), spin0=4.0, spin1=3.0, swell=False), 0.5, peak_db=0)
    return _fin(room(L.out(), 'wood', wet=0.12), hp_hz=80, eq=CALM)


# ══ Vashil, Bell ringer ══════════════════════════════════════════════════════════════════════════
@cue('f_vashil_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_vashil_attack_swing(v: int):
    """Vashil touches a halo bell with his rod: a light rod tick, a small glass handbell (D6, its hum trembling) and
    the note's soft zing as it flies."""
    r = R('f_vashil_attack_swing', v=v)
    d = detune(v, 25)
    L = Layers(0.4)
    L.add(S.knock(r, 2400 * d, 0.01, 3, 'wood'), 0.0, peak_db=-12)
    L.add(handbell(hz('D6') * d, 0.36, 0.22, r, beat=5.0), 0.0, peak_db=0)
    L.add(fm_tone(hz('D6') * d, hz('A6') * d, 0.18, ratio=2.0, i0=0.8, i1=0.1, t60=0.15, curve=2.0), 0.01, peak_db=-12)
    return _fin(L.out(), hp_hz=300, eq=[('peak', 3300, -2.0, 0.8)])


@cue('f_vashil_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_vashil_attack_hit(v: int):
    """The note lands: a glass bell 'ting' on B5 with its low hum beating under it (B4), a little bright and round."""
    r = R('f_vashil_attack_hit', v=v)
    d = detune(v, 30)
    L = Layers(0.45)
    L.add(handbell(hz('B5') * d, 0.42, 0.26, r, beat=4.0), 0.0, peak_db=0)
    L.add(S.burst(r, 0.012, 2500, 8000, 0.005), 0.0, peak_db=-12)
    return _fin(room(L.out(), 'glass', wet=0.06), hp_hz=250, eq=SOFT_TOP)


@cue('f_vashil_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_vashil_a1(v: int):
    """Peal: the rod struck on the halo, the peal travelling out (a glass zing falling away) and, at the area's delay,
    blooming where it lands — D5 and B5 rung together, beating."""
    r = R('f_vashil_a1', v=v)
    d = detune(v, 15)
    ct, dl = timing('vashil', 'a1')
    L = Layers(ct + dl + 1.0)
    L.add(handbell(hz('D6') * d, 0.4, 0.25, r), ct, peak_db=-6)
    L.add(fm_tone(hz('A6') * d, hz('D6') * d, max(dl, 0.15), ratio=2.0, i0=1.0, i1=0.2, t60=max(dl, 0.15), curve=1.0), ct, peak_db=-12)
    t = ct + dl
    L.add(handbell(hz('D5') * d, 0.9, 0.6, r, beat=3.0), t, peak_db=-1)
    L.add(handbell(hz('B5') * d, 0.8, 0.5, r, beat=4.0), t + 0.005, peak_db=-3)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=200, eq=SOFT_TOP)


@cue('f_vashil_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_vashil_a2(v: int):
    """Glass Chime: the chime thrown — a quick run of small bells (D6 E6 F6) rung off the halo as it flies."""
    r = R('f_vashil_a2', v=v)
    d = detune(v, 15)
    t = timing('vashil', 'a2')[0]
    L = Layers(t + 0.7)
    L.add(rev(at_len(handbell(hz('A5') * d, 0.4, 0.3, r), max(t, 0.1), 0.002), 0.02), 0.0, peak_db=-10)
    for i, note in enumerate(('D6', 'E6', 'F6')):
        L.add(handbell(hz(note) * d, 0.35, 0.2, r, beat=5.0), t + 0.05 * i, peak_db=-1 - i, pan=(-0.2, 0.0, 0.2)[i])
    return _fin(room(L.out(), 'glass', wet=0.1), hp_hz=300, eq=SOFT_TOP)


@cue('f_vashil_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_vashil_a3(v: int):
    """Ring Out: the halo shaken — all seven bells ringing at once in a bright, trembling cluster that spreads out
    round him."""
    r = R('f_vashil_a3', v=v)
    d = detune(v, 15)
    t = timing('vashil', 'a3')[0]
    L = Layers(t + 1.0)
    L.add(breath(t + 0.01, 1500, 4000, shape='swell', q=1.6, seed=f'va3{v}', curve=-2.0), 0.0, peak_db=-12, width=0.6)
    for i, note in enumerate(('D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6')):
        L.add(handbell(hz(note) * d, 0.8, 0.5, R('f_vashil_a3', note, v), beat=3.0 + i), t + 0.012 * i, peak_db=-4 - 0.5 * (i % 3),
              pan=(-0.45 + 0.15 * i))
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=200, eq=SOFT_TOP)


@cue('f_vashil_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_vashil_ult_windup(v: int):
    """Morning Toll wind-up: the rod raised to the halo, the bells bowed and swelling (a trembling glass tone rising D5
    → B5, the sixth), cresting on the toll."""
    r = R('f_vashil_ult_windup', v=v)
    D = wind('vashil')
    n = ns(D + 0.05)
    t = np.arange(n) / SR
    f = np.geomspace(hz('D5'), hz('B5'), n)
    tone = sum(a * np.sin(TAU * np.cumsum(f * k) / SR) for k, a in ((0.5, 0.4), (1.0, 1.0), (1.0 + 4.0 / hz('D5'), 0.6), (1.2, 0.25)))
    L = Layers(D + 0.12)
    L.add(tone * E.swell(n, D * 0.95, -2.0, release=0.03), 0.0, peak_db=0)
    L.add(breath(D + 0.03, 1200, 5000, shape='swell', q=2.0, seed='vaw'), 0.0, peak_db=-12, width=0.6)
    return _fin(L.out(), hp_hz=200, eq=CALM)


@cue('f_vashil_ult_release', 'combat', T_REL, RELW, **BGK)
def f_vashil_ult_release(v: int):
    """Morning Toll: the great toll — a deep glass bell D4 with B4 over it (his sixth), tolled twice, the halo's small
    bells chiming after each stroke."""
    r = R('f_vashil_ult_release', v=v)
    L = Layers(2.6)
    for k, t in enumerate((0.0, 0.7)):
        L.add(handbell(hz('D4'), 1.9, 1.4, R('f_vashil_ult_release', f'd{k}'), beat=2.0), t, peak_db=-1 - 2 * k)
        L.add(handbell(hz('B4'), 1.7, 1.2, R('f_vashil_ult_release', f'b{k}'), beat=3.0), t + 0.004, peak_db=-3 - 2 * k)
        for i, note in enumerate(('D6', 'B5', 'F6')):
            L.add(handbell(hz(note), 0.5, 0.3, R('f_vashil_ult_release', f'{note}{k}'), beat=5.0), t + 0.12 + 0.06 * i,
                  peak_db=-12 - i, pan=(-0.3, 0.3, 0.0)[i])
    L.add(S.thump(0.4, 140, 60, 0.03, 0.3, 1.6), 0.0, peak_db=-16)
    return _fin(room(L.out(), 'hall', wet=0.14), hp_hz=100, eq=CALM)


@cue('f_vashil_death', 'combat', T_DIE, DIEW, **BGK)
def f_vashil_death(v: int):
    """Vashil falls: the halo crashes down — its bells jangling and two of them cracking — and the ash rod clatters on
    stone."""
    r = R('f_vashil_death', v=v)
    L = Layers(1.8)
    for i, note in enumerate(('B5', 'D6', 'F5', 'A5', 'E6', 'C6')):
        L.add(handbell(hz(note) * r.uniform(0.99, 1.01), 0.5, 0.25, R('f_vashil_death', note), beat=6.0), 0.03 * i + 0.01 * (i % 2),
              peak_db=-3 - i, pan=r.uniform(-0.4, 0.4))
    L.add(S.snap(r, 3000, 2.0), 0.2, peak_db=-8)
    L.add(S.partials(hz('D6'), (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.05, 0.03, 0.02), 0.12, r), 0.2, peak_db=-6)
    L.add(S.knock(r, 400, 0.06, 5, 'wood'), 0.32, peak_db=-5)
    L.add(S.knock(r, 360, 0.05, 5, 'wood'), 0.46, peak_db=-8)
    L.add(handbell(hz('D5'), 1.2, 0.9, r, beat=2.0), 0.32, peak_db=-10)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=120, eq=CALM)


@cue('f_vashil_call', 'ui', T_CALL, CALLW, **CLK)
def f_vashil_call(v: int):
    """Vashil's call: glass handbells D5 then B5 — the Dorian sixth — then both rung together, beating."""
    L = Layers(1.9)
    L.add(handbell(hz('D5'), 0.9, 0.6, R('f_vashil_call', 'd'), beat=3.0), 0.0, peak_db=-1, pan=-0.12)
    L.add(handbell(hz('B5'), 0.9, 0.6, R('f_vashil_call', 'b'), beat=4.0), 0.2, peak_db=-2, pan=0.12)
    L.add(handbell(hz('D5'), 1.3, 1.0, R('f_vashil_call', 'd2'), beat=3.0), 0.45, peak_db=-1)
    L.add(handbell(hz('B5'), 1.3, 1.0, R('f_vashil_call', 'b2'), beat=4.0), 0.452, peak_db=-3)
    return _fin(room(L.out(), 'glass', wet=0.14), hp_hz=200, eq=CALM)
