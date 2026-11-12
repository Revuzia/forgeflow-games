"""The Wicks' own sound family (max SFX-1): lane minions are small lamp-bearers (WORLD.md), so they sound of wax,
tallow, wick-flame and the brass of their lamps, never of the shared combat library (which they used to borrow:
c_swing_light, c_hit_phys_light, c_shot_bolt_lumen, c_thrown, c_swing_heavy, c_hit_phys_heavy were 55 % of the sfx a
laning player heard).

    w_shieldwick_swing   a short leathery shove with the lamp's chain giving one small brass tick
    w_glimwick_bolt      an ember spat from the lamp: a breathy 'pff' carrying its own little whoosh, a fizz of sparks
    w_greatwick_throw    a heavy wax glob lobbed: a low 'hup' of air, the pot's lid clinking
    w_brightwick_swing   the brass snuffer swung: a dull swish and a short snuffer clank
    w_wick_hit           a soft tallow thock: a dense, damped knock with no ring (wax gives under the blow)
    w_glimwick_hit       an ember landing: a small pop and a fizz that dies at once
    w_wick_hit_heavy     the Greatwick / Brightwick blow: a deeper tallow thump with a muffled brass knock

All are short, soft-topped (they fire many times a second in a wave fight) and quieter than a fighter's own kit. Each
ships WICK_TAKES takes that change the RECIPE per take (body decay, filter, layer offsets, material frequencies), not
only the seed or a detune (TAKE_SHAPE: decay, material, a flam, the contact's level), so the takes differ in spectrum and
in time (build.py's wick gate: spectral and time-frequency take similarity).
"""
from __future__ import annotations

import numpy as np

from cuelib import cue
from synth import sfx as S

from .kit import Layers, R, at_len, breath, crackle, finish, hiss, hollow, lp, room, tink

WICK_TAKES = 4
AIR = (0.08, 0.45)
HIT = (0.06, 0.45)
AIRK = dict(tail_floor_db=-48.0)
HITK = dict(tail_floor_db=-48.0, clip_drive=1.4, max_gr_db=6.0)
SOFT_TOP = [('peak', 3300, -3.0, 0.8), ('high', 9000, -3.0)]


# each take's SHAPE (max SFX fix 1: the takes differed by seed-sized offsets only, time-frequency similarity 0.99): its body
# decay, its material frequency, its transient (a flam: a second contact gap ms later, or None) and the transient's level
# (dB). The take's random offsets ride on top.
TAKE_SHAPE = (
    dict(dk=1.0, fk=1.0, flam=None, tl=0.0),
    dict(dk=0.7, fk=1.1, flam=3.2, tl=2.0),
    dict(dk=1.4, fk=0.9, flam=None, tl=-4.0),
    dict(dk=0.85, fk=1.18, flam=1.8, tl=1.0),
)


def vary(cid: str, v: int) -> dict:
    """A take's recipe: its TAKE_SHAPE, then offsets: body decay ±6 %, filter / material frequency ±5 %, layer offsets
    0-3 ms, a layer level ±2.5 dB."""
    r = R(cid, 'vary', v)
    sh = TAKE_SHAPE[v % len(TAKE_SHAPE)]
    return dict(dk=sh['dk'] * float(r.uniform(0.94, 1.06)), fk=sh['fk'] * float(r.uniform(0.95, 1.05)),
                fk2=float(r.uniform(0.9, 1.1)), off=float(r.uniform(0.0, 0.003)), off2=float(r.uniform(0.0, 0.003)),
                lv=float(r.uniform(-2.5, 2.5)), flam=sh['flam'], tl=sh['tl'])


def flam(L, r, f: float, k: dict, peak_db: float, lp_hz: float) -> None:
    """The take's second contact (TAKE_SHAPE flam), 6 dB under its first."""
    if k['flam']:
        L.add(lp(S.snap(r, f * 1.12, 1.0), lp_hz), k['flam'] / 1000.0, peak_db=peak_db + k['tl'] - 6.0)


def brass_tick(r, f: float, t60: float) -> np.ndarray:
    """A small brass lamp part struck: a few inharmonic metal modes, short."""
    return S.partials(f, (1.0, 2.32, 3.86, 5.4), (1.0, 0.55, 0.3, 0.15), (t60, t60 * 0.6, t60 * 0.4, t60 * 0.25),
                      t60 * 1.4, r, 1.5)


def tallow(r, f: float, t60: float) -> np.ndarray:
    """Wax struck: a clay-like knock, low-passed hard (wax swallows the top) — a 'thock' with no ring."""
    return lp(S.knock(r, f, t60, 4, 'clay'), f * 4.0)


# ── swings and shots ─────────────────────────────────────────────────────────────────────────────
@cue('w_shieldwick_swing', 'combat', ('m', -21.5), AIR, variants=WICK_TAKES, **AIRK)
def w_shieldwick_swing(v: int):
    k = vary('w_shieldwick_swing', v)
    r = R('w_shieldwick_swing', v=v)
    L = Layers(0.22)
    L.add(S.whoosh(r, 0.15 * k['dk'], 420 * k['fk'], 760 * k['fk'], q=1.1, peak_at=0.4, f_mid=1150 * k['fk2'],
                   rise=-1.2, fall=2.6), 0.0, peak_db=0, width=0.4)
    L.add(lp(S.burst(r, 0.05, 250, 1400, 0.03 * k['dk'], attack=0.008), 1600), 0.03 + k['off'], peak_db=-8)
    L.add(brass_tick(r, 1850 * k['fk2'], 0.05 * k['dk']), 0.06 + k['off2'], peak_db=-17 + k['lv'])
    return finish(L.out(), hp_hz=160, eq=SOFT_TOP)


# (max2 SFX f) the bolt's takes differ in gesture, not only in seed: where the 'pff' peaks, whether its whoosh rises or
# falls, how late and how thick the spark fizz comes in (round 1: STFT log-magnitude take correlation 0.989)
BOLT_SHAPE = (
    dict(bpk=0.03, w0=1300, w1=700, wpk=0.22, coff=0.004, rate=70, cl=0.0),
    dict(bpk=0.012, w0=800, w1=1600, wpk=0.12, coff=0.018, rate=110, cl=2.0),
    dict(bpk=0.05, w0=1500, w1=600, wpk=0.34, coff=0.0, rate=55, cl=-2.0),
    dict(bpk=0.022, w0=1000, w1=1100, wpk=0.5, coff=0.03, rate=140, cl=1.0),
)


@cue('w_glimwick_bolt', 'combat', ('m', -21.0), AIR, variants=WICK_TAKES, **AIRK)
def w_glimwick_bolt(v: int):
    k = vary('w_glimwick_bolt', v)
    b = BOLT_SHAPE[v % len(BOLT_SHAPE)]
    r = R('w_glimwick_bolt', v=v)
    L = Layers(0.3)
    L.add(breath(0.14 * k['dk'], 900 * k['fk'], 2300 * k['fk'], shape='breath', q=1.6, seed=f'wgb{v}', peak_at=b['bpk']),
          0.0, peak_db=-2, width=0.4)
    L.add(crackle(r, 0.22 * k['dk'], rate=b['rate'], lo=1500 * k['fk2'], hi=5200, hiss=0.12, decay_s=0.09 * k['dk']),
          0.004 + b['coff'] + k['off'], peak_db=-9 + k['lv'] + b['cl'])
    L.add(S.whoosh(r, 0.18, b['w0'] * k['fk'], b['w1'] * k['fk'], q=1.3, peak_at=b['wpk']), 0.01 + k['off2'], peak_db=-5,
          width=0.5)
    L.add(S.thump(0.06, 300 * k['fk2'], 170, 0.008, 0.035 * k['dk'], 1.2), 0.0, peak_db=-12)
    return finish(L.out(), hp_hz=170, eq=SOFT_TOP)


@cue('w_greatwick_throw', 'combat', ('m', -20.5), (0.15, 0.5), variants=WICK_TAKES, **AIRK)
def w_greatwick_throw(v: int):
    k = vary('w_greatwick_throw', v)
    r = R('w_greatwick_throw', v=v)
    L = Layers(0.4)
    L.add(S.whoosh(r, 0.3 * k['dk'], 240 * k['fk'], 520 * k['fk'], q=0.9 + 0.15 * v, peak_at=0.28 + 0.05 * v,
                   f_mid=(760 + 110 * v) * k['fk2'], low_body=0.5 + 0.15 * v, rise=-1.3), 0.0, peak_db=0, width=0.4)
    L.add(S.thump(0.18, 150 * k['fk'], 75, 0.03, 0.1 * k['dk'], 1.6), 0.02 + k['off'], peak_db=-8)
    L.add(brass_tick(r, 1320 * k['fk2'], 0.07 * k['dk']), 0.05 + k['off2'], peak_db=-15 + k['lv'])
    L.add(brass_tick(R('w_greatwick_throw', 'lid', v), 1720 * k['fk'], 0.05), 0.085 + k['off'], peak_db=-19 + k['lv'])
    return finish(L.out(), hp_hz=55, eq=SOFT_TOP)


@cue('w_brightwick_swing', 'combat', ('m', -20.0), (0.12, 0.5), variants=WICK_TAKES, **AIRK)
def w_brightwick_swing(v: int):
    k = vary('w_brightwick_swing', v)
    r = R('w_brightwick_swing', v=v)
    L = Layers(0.42)
    L.add(S.whoosh(r, 0.3 * k['dk'], 300 * k['fk'], 640 * k['fk'], q=1.0, peak_at=0.42, f_mid=1150 * k['fk2'],
                   low_body=0.8, rise=-1.4), 0.0, peak_db=0, width=0.5)
    # the snuffer's cone rattles on its pivot as it comes round
    L.add(hollow(980 * k['fk2'], 0.22, 0.12 * k['dk'], r, odd=3, hit_ms=1.5, inharm=0.04), 0.1 + k['off'], peak_db=-11 + k['lv'])
    L.add(brass_tick(r, 2400 * k['fk'], 0.04), 0.1 + k['off2'], peak_db=-17)
    return finish(L.out(), hp_hz=50, eq=SOFT_TOP)


# ── hits ─────────────────────────────────────────────────────────────────────────────────────────
@cue('w_wick_hit', 'combat', ('m', -19.5), HIT, variants=WICK_TAKES, **HITK)
def w_wick_hit(v: int):
    k = vary('w_wick_hit', v)
    r = R('w_wick_hit', v=v)
    L = Layers(0.2)
    L.add(lp(S.snap(r, 2300 * k['fk'], 1.4), 4200), 0.0, peak_db=-9 + k['tl'])
    flam(L, r, 2300 * k['fk'], k, -9, 4200)
    L.add(tallow(r, 430 * k['fk'], 0.045 * k['dk']), 0.0, peak_db=0)
    L.add(tallow(R('w_wick_hit', 'b', v), 860 * k['fk2'], 0.03 * k['dk']), 0.0015 + k['off'] * 0.5, peak_db=-3 + k['lv'])
    L.add(S.thump(0.12, 190 * k['fk2'], 95, 0.01, 0.06 * k['dk'], 2.0), 0.0, peak_db=-9)
    L.add(lp(S.burst(r, 0.035, 500, 2200, 0.016 * k['dk'], q=0.9), 2600), 0.0, peak_db=-9)
    return finish(room(L.out(), 'tiny', wet=0.07), hp_hz=60, eq=SOFT_TOP)


@cue('w_glimwick_hit', 'combat', ('m', -20.0), HIT, variants=WICK_TAKES, **HITK)
def w_glimwick_hit(v: int):
    k = vary('w_glimwick_hit', v)
    r = R('w_glimwick_hit', v=v)
    L = Layers(0.24)
    L.add(tallow(r, 420 * k['fk'], 0.035 * k['dk']), 0.0, peak_db=-3)
    L.add(S.burst(r, 0.03, 900 * k['fk2'], 3800, 0.01 * k['dk'], q=0.8), 0.0, peak_db=-6 + k['tl'])
    flam(L, r, 2600 * k['fk'], k, -8, 4400)
    L.add(at_len(hiss(r, 0.16 * k['dk'], 3200 * k['fk'], 1800, q=1.4, attack=0.004, fall=2.2), 0.16), 0.006 + k['off'],
          peak_db=-10 + k['lv'], width=0.4)
    L.add(tink(1900 * k['fk2'], 0.07, 0.035, bright=0.25), 0.002 + k['off2'], peak_db=-16)
    L.add(S.thump(0.08, 230, 120, 0.008, 0.04 * k['dk'], 1.4), 0.0, peak_db=-8)
    return finish(room(L.out(), 'tiny', wet=0.06), hp_hz=90, eq=SOFT_TOP)


@cue('w_wick_hit_heavy', 'combat', ('m', -18.0), HIT, variants=WICK_TAKES, **HITK)
def w_wick_hit_heavy(v: int):
    k = vary('w_wick_hit_heavy', v)
    r = R('w_wick_hit_heavy', v=v)
    L = Layers(0.3)
    L.add(lp(S.snap(r, 2000 * k['fk'], 1.8), 3800), 0.0, peak_db=-12 + k['tl'])
    flam(L, r, 2000 * k['fk'], k, -12, 3800)
    L.add(tallow(r, 370 * k['fk'], 0.07 * k['dk']), 0.0, peak_db=0)
    L.add(tallow(R('w_wick_hit_heavy', 'b', v), 690 * k['fk2'], 0.045 * k['dk']), 0.001 + k['off2'] * 0.5, peak_db=-4)
    L.add(S.thump(0.2, 170 * k['fk2'], 80, 0.018, 0.1 * k['dk'], 2.6), 0.0, peak_db=-9)
    L.add(lp(brass_tick(r, 760 * k['fk2'], 0.09 * k['dk']), 3000), 0.004 + k['off'], peak_db=-8 + k['lv'])
    L.add(lp(S.burst(r, 0.05, 400, 2000, 0.025 * k['dk'], q=0.9), 2400), 0.0, peak_db=-9)
    return finish(room(L.out(), 'tiny', wet=0.08), hp_hz=45, eq=SOFT_TOP)
