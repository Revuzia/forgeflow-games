"""Buff states and the shield break (max SFX-7). One c_buff used to voice haste, unstoppable, untargetable and invisible:
four very different states with one sound. Each now has its own, and a shield the sim breaks finally sounds.

    c_haste          a rising air streak: a quick filtered rush climbing with two light glass flicks at its crest
    c_unstoppable    a low iron set: a dull clank of iron settling, a short low resonance and a grounded thump
    c_veil           untargetable / invisible: a soft fold of shade, breath falling into a hollow hush (inward, dark)
    c_shield_break   a dawnglass ward cracking: a sharp crack, the pane's ring cut short, a fall-off tinkle of shards

All land by their first frames (they answer an instant change of state), three takes each (the recipe changes per
take: timing, filter and material offsets, not only the seed).
"""
from __future__ import annotations

from cuelib import cue
from synth import sfx as S
from synth.core import hz

from .kit import Layers, R, breath, finish, glass, hollow, lp, pane, room, spread, tink

STATE = (0.25, 1.0)
STATEK = dict(tail_floor_db=-50.0, fade_out=0.025)
TAKES = 3


def vary(cid: str, v: int) -> dict:
    r = R(cid, 'vary', v)
    return dict(dk=float(r.uniform(0.85, 1.15)), fk=float(r.uniform(0.9, 1.1)), off=float(r.uniform(0.0, 0.012)))


@cue('c_haste', 'combat', ('m', -19.5), STATE, variants=TAKES, **STATEK)
def c_haste(v: int):
    k = vary('c_haste', v)
    r = R('c_haste', v=v)
    L = Layers(0.5)
    L.add(S.whoosh(r, 0.28 * k['dk'], 700 * k['fk'], 4200 * k['fk'], q=1.6, peak_at=0.75, rise=-0.8, fall=3.0), 0.0,
          peak_db=0, width=0.7)
    L.add(S.burst(r, 0.02, 1500, 5000, 0.008), 0.0, peak_db=-12)
    L.add(tink(hz('A6') * k['fk'] ** 0.1, 0.12, 0.06, bright=0.4), 0.19 * k['dk'] + k['off'], peak_db=-9)
    L.add(tink(hz('E7'), 0.1, 0.05, bright=0.35), 0.22 * k['dk'] + k['off'], peak_db=-13)
    return finish(spread(L.out(), 0.3), hp_hz=300, eq=[('peak', 3300, -2.0, 0.8)])


@cue('c_unstoppable', 'combat', ('m', -18.0), STATE, variants=TAKES, **STATEK)
def c_unstoppable(v: int):
    k = vary('c_unstoppable', v)
    r = R('c_unstoppable', v=v)
    L = Layers(0.6)
    L.add(S.thump(0.3, 110 * k['fk'], 55, 0.02, 0.18 * k['dk'], 2.2), 0.0, peak_db=-2)
    # iron settling: a dull, heavy metal clank (inharmonic, low-passed: no bright ring)
    L.add(lp(S.partials(240 * k['fk'], (1.0, 2.76, 5.4, 8.9), (1.0, 0.6, 0.3, 0.12), (0.35, 0.15, 0.07, 0.04), 0.5, r, 0.8),
             2200), 0.0, peak_db=0)
    L.add(S.knock(r, 520 * k['fk'], 0.06, 5, 'stone'), 0.0, peak_db=-6)
    L.add(lp(S.partials(165, (1.0, 2.76), (1.0, 0.4), (0.3, 0.12), 0.4, r, 0.5), 1400), 0.07 + k['off'], peak_db=-7)
    return finish(room(L.out(), 'stone', wet=0.1), hp_hz=40)


@cue('c_veil', 'combat', ('m', -20.0), STATE, variants=TAKES, **STATEK)
def c_veil(v: int):
    k = vary('c_veil', v)
    r = R('c_veil', v=v)
    L = Layers(0.7)
    L.add(breath(0.4 * k['dk'], 2600 * k['fk'], 380, shape='breath', q=1.8, seed=f'veil{v}', peak_at=0.03), 0.0,
          peak_db=0, width=0.8)
    L.add(hollow(hz('D4') * k['fk'] ** 0.2, 0.5, 0.3 * k['dk'], r, odd=4, hit_ms=4.0), 0.02 + k['off'], peak_db=-6)
    L.add(lp(S.burst(r, 0.03, 300, 2500, 0.012), 2500), 0.0, peak_db=-10)
    return finish(spread(L.out(), 0.35), hp_hz=90, eq=[('high', 7000, -4.0)])


@cue('c_shield_break', 'combat', ('m', -18.5), (0.3, 1.0), variants=TAKES, instant=True, **STATEK)
def c_shield_break(v: int):
    k = vary('c_shield_break', v)
    r = R('c_shield_break', v=v)
    L = Layers(0.8)
    L.add(S.snap(r, 4200 * k['fk'], 2.0), 0.0, peak_db=-10)
    L.add(S.burst(r, 0.04, 1800, 9000, 0.012, q=0.8), 0.0, peak_db=-11)
    ring = pane(hz('A5') * k['fk'] ** 0.3, 0.3, 0.12 * k['dk'], bright=0.7, r=r)
    L.add(ring, 0.0, peak_db=0)
    L.add(glass('D6', 0.25, 0.6, decay=0.06, bright=0.6, seed=f'sb{v}'), 0.002, peak_db=-7)
    L.add(S.thump(0.12, 300, 150, 0.01, 0.06, 1.4), 0.0, peak_db=-10)
    L.add(S.shards(r, 0.55 * k['dk'], 9 + v, 2400, 8000, 0.09, 0.12, 0.18), 0.03 + k['off'], peak_db=-11, width=0.8)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=200, eq=[('peak', 3300, -2.0, 0.8), ('high', 10000, -2.0)])
