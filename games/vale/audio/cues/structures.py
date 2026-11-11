"""The structures' own voices (max SFX-5): a structure struck answers the blow in its own material, under the attacker's
hit, and the Lantern and the Hourbell fall with their own sounds instead of the Needles' collapse.

    c_struck_needle    a Needle struck: the carved stone shaft's dull knock and its brass-bound glass lamp ringing short
    c_struck_lantern   the Lantern struck: its glass globe 'tonk'-ing in the brass frame, the flame inside fluttering
    c_struck_hourbell  the Hourbell struck: the great bronze bell's muted hum answering through its housing
    c_lantern_fall     the Lantern falls: the globe bursts, the brass frame clanks down twice, the flame gutters out
    c_hourbell_fall    the Hourbell falls: the bell cracks (its partials split and buzz), the housing groans and gives,
                       the bell lands with a broken clang and rings on, out of tune, under a long stone rumble

content/audio.json binds them per structure ('structureStruck.<unit>', 'structureFall.<unit>'); src/audio/index.ts plays
the struck layer at STRUCK_GAIN under every blow on a structure (one per structure per STRUCK_GAP_S) and the unit's own
fall in place of 'structureFall'. All in D Dorian (the bells on D / A).
"""
from __future__ import annotations

from cuelib import cue
from synth import sfx as S
from synth.core import hz

from .kit import Layers, R, bell, breath, crackle, crumble, drum, finish, glass, hollow, litho, lp, room, scrape, tink

STRUCK = (0.15, 0.7)
STRUCKK = dict(tail_floor_db=-48.0, clip_drive=1.3, max_gr_db=6.0)
BIGK = dict(tail_floor_db=-54.0, fade_out=0.04, clip_drive=1.4, max_gr_db=6.0)
TAKES = 3


def vary(cid: str, v: int) -> dict:
    r = R(cid, 'vary', v)
    return dict(dk=float(r.uniform(0.85, 1.15)), fk=float(r.uniform(0.94, 1.06)), off=float(r.uniform(0.0, 0.004)))


def brass(r, f: float, t60: float):
    """A brass part struck: a few inharmonic metal modes."""
    return S.partials(f, (1.0, 2.32, 3.86, 5.4), (1.0, 0.55, 0.3, 0.15), (t60, t60 * 0.6, t60 * 0.4, t60 * 0.25), t60 * 1.5, r, 1.2)


@cue('c_struck_needle', 'combat', ('m', -21.0), STRUCK, variants=TAKES, **STRUCKK)
def c_struck_needle(v: int):
    k = vary('c_struck_needle', v)
    r = R('c_struck_needle', v=v)
    L = Layers(0.5)
    L.add(S.knock(r, 300 * k['fk'], 0.07 * k['dk'], 5, 'stone'), 0.0, peak_db=-2)
    L.add(litho(hz(('D3', 'A2', 'F3')[v % 3]), 0.45, 0.25 * k['dk'], r, dark=2600), 0.002, peak_db=-5)
    L.add(lp(brass(r, 1180 * k['fk'], 0.18 * k['dk']), 5000), 0.004 + k['off'], peak_db=-7)
    L.add(glass(('A5', 'D6', 'E6')[v % 3], 0.3, 0.5, decay=0.1, bright=0.5, seed=f'sn{v}'), 0.006 + k['off'], peak_db=-12)
    return finish(room(L.out(), 'stone', wet=0.1), hp_hz=90, eq=[('peak', 3300, -2.0, 0.8)])


@cue('c_struck_lantern', 'combat', ('m', -21.0), STRUCK, variants=TAKES, **STRUCKK)
def c_struck_lantern(v: int):
    k = vary('c_struck_lantern', v)
    r = R('c_struck_lantern', v=v)
    L = Layers(0.55)
    L.add(glass(('D5', 'F5', 'A4')[v % 3], 0.45, 0.8, decay=0.16 * k['dk'], bright=0.55, seed=f'sl{v}'), 0.0, peak_db=0)
    L.add(lp(brass(r, 640 * k['fk'], 0.14 * k['dk']), 4000), 0.0, peak_db=-5)
    L.add(S.knock(r, 520 * k['fk'], 0.04, 4, 'wood'), 0.0, peak_db=-7)
    L.add(breath(0.25, 900, 400, shape='breath', q=1.4, seed=f'slf{v}', peak_at=0.05, vel=0.6), 0.02 + k['off'], peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.1), hp_hz=120, eq=[('peak', 3300, -2.0, 0.8)])


@cue('c_struck_hourbell', 'combat', ('m', -20.5), (0.15, 1.1), variants=TAKES, **STRUCKK)
def c_struck_hourbell(v: int):
    k = vary('c_struck_hourbell', v)
    r = R('c_struck_hourbell', v=v)
    L = Layers(0.7)
    L.add(S.knock(r, 240 * k['fk'], 0.08, 5, 'stone'), 0.0, peak_db=-3)
    L.add(lp(bell('D4', 0.6, 0.55, decay=0.18 * k['dk'], bright=0.75, seed=f'shb{v}'), 3200), 0.003 + k['off'], peak_db=0)
    L.add(lp(bell('D3', 0.5, 0.5, decay=0.15 * k['dk'], bright=0.6, seed=f'shc{v}'), 2000), 0.003, peak_db=-6)
    L.add(S.knock(R('c_struck_hourbell', 'hi', v), 620 * k['fk'], 0.05, 4, 'stone'), 0.0, peak_db=-5)
    L.add(S.thump(0.2, 140, 70, 0.02, 0.1, 2.0), 0.0, peak_db=-14)
    return finish(room(L.out(), 'stone', wet=0.12), hp_hz=60, eq=[('peak', 3300, -2.0, 0.8)])


@cue('c_lantern_fall', 'combat', ('m', -13.5), (1.1, 3.6), **BIGK)
def c_lantern_fall(v: int):
    r = R('c_lantern_fall', v=v)
    L = Layers(2.6)
    L.add(S.snap(r, 3600, 3.0), 0.0, peak_db=-8)
    L.add(glass('D5', 0.6, 0.9, decay=0.12, bright=0.7, seed='lf0'), 0.0, peak_db=-4)
    L.add(S.shards(r, 1.2, 40, 2200, 9000, 0.12, 0.12, 0.35), 0.01, peak_db=-4, width=0.9)
    L.add(lp(brass(r, 420, 0.4), 3500), 0.32, peak_db=-3)
    L.add(lp(brass(R('c_lantern_fall', 'b2'), 380, 0.5), 3000), 0.58, peak_db=-5)
    L.add(S.knock(r, 260, 0.1, 5, 'stone'), 0.32, peak_db=-4)
    L.add(drum('D2', 0.8, 'doum', seed='lf', dur=0.9, t60=0.5, kick=1.2), 0.32, peak_db=-6)
    L.add(breath(1.2, 1400, 180, shape='breath', q=1.2, seed='lff', peak_at=0.05), 0.05, peak_db=-8, width=0.7)
    L.add(crackle(r, 1.4, 40, 900, 4000, 0.1, 0.5), 0.1, peak_db=-14)
    L.add(S.rumble(r, 2.0, 110, 1.2, 0.05), 0.3, peak_db=-8)
    return finish(room(L.out(), 'stone', wet=0.15), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])


@cue('c_hourbell_fall', 'combat', ('m', -12.5), (2.4, 5.0), **BIGK)
def c_hourbell_fall(v: int):
    r = R('c_hourbell_fall', v=v)
    L = Layers(4.6)
    # the crack: the bell's partials split (two detuned copies beating fast) with a buzzing rattle on them
    L.add(S.snap(r, 1800, 4.0), 0.0, peak_db=-6)
    L.add(bell('D4', 3.2, 0.9, decay=0.55, bright=0.75, seed='hbf0'), 0.0, peak_db=-2)
    L.add(bell(hz('D4') * 1.012, 3.0, 0.8, decay=0.5, bright=0.75, seed='hbf1'), 0.004, peak_db=-4)
    L.add(bell('D3', 2.4, 0.6, decay=0.45, bright=0.6, seed='hbf4'), 0.0, peak_db=-9)
    L.add(crackle(r, 0.6, 140, 700, 3000, 0.0, 0.25), 0.0, peak_db=-9)
    # the housing groans and gives
    L.add(scrape(r, 0.9, 180, 2.5, 9, 0.8, 0.6), 0.35, peak_db=-6)
    # the bell lands: a broken clang, the stone floor taking it
    L.add(S.thump(0.6, 110, 45, 0.04, 0.35, 2.8), 1.25, peak_db=-8)
    L.add(drum('A1', 1.0, 'doum', seed='hbl', dur=1.2, t60=0.7, kick=1.6), 1.25, peak_db=-8)
    L.add(S.knock(R('c_hourbell_fall', 'land'), 380, 0.14, 5, 'stone'), 1.25, peak_db=-2)
    L.add(S.knock(R('c_hourbell_fall', 'land2'), 560, 0.1, 5, 'stone'), 1.27, peak_db=-5)
    L.add(lp(bell('A3', 2.8, 0.85, decay=0.6, bright=0.7, seed='hbf2'), 4000), 1.26, peak_db=-2)
    L.add(lp(bell(hz('A3') * 0.985, 2.6, 0.75, decay=0.55, bright=0.7, seed='hbf3'), 3600), 1.27, peak_db=-5)
    L.add(crumble(r, 2.2, 45, 200, 1400, 0.5, 0.08), 1.3, peak_db=-4)
    L.add(S.chips(r, 1.6, 40, 1200, 5000, 0.3, 0.6), 1.3, peak_db=-12)
    L.add(S.rumble(r, 3.0, 90, 2.0, 0.05, rough=0.5), 1.2, peak_db=-10)
    L.add(hollow(hz('D2'), 2.0, 1.4, r, odd=3, hit_ms=4.0), 1.28, peak_db=-12)
    L.add(tink(hz('D6'), 0.4, 0.3, bright=0.4), 1.3, peak_db=-16)
    return finish(room(room(L.out(), 'stone', wet=0.16), 'hall', wet=0.07), hp_hz=28, eq=[('peak', 3300, -2, 0.8)])
