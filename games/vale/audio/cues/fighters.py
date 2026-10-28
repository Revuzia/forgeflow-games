"""Per-fighter cues (bus `sfx`, spatial), named f_<fighter>_<slot> (attack_swing, attack_hit, a1, a2, a3,
ult_windup, ult_release, passive, death, call). src/audio/index.ts resolves them by that name before an
ability's present.sfx / hitSfx, so content/fighters/*.json is never edited for a sound.

This module holds the PASSIVE procs (final parity AUD-6): the sound of each fighter's passive paying off,
played by the engine on the sim's 'proc' event at the subject (else at the owner). Each tells WHOSE passive
fired by its own material and contour, from the fighter's fiction (content/fighters, _design/ROSTER.md); all
are front-loaded (the payoff lands on its first milliseconds), short, and quiet enough to ride on top of the
hit that triggered them. Three round-robin variants each (a proc can fire on every attack).

    ardit    a blade turned on a pavise: a wood-and-iron deflect sliding off, braced by a low thud
    burdam   a grudge tallied: a chisel notch cut in stone, a low hollow knot underneath
    dunsom   dust settling at dusk: a soft fall of fine grit and a falling shade breath into a low bell
    ervet    the dawnglass edge: a tiny bright glass zing riding her strike
    hesmi    shade-fed shards: a dark glass crack with ink bubbling out of it
    ilsheta  warm hands: a lamp catching (a soft 'whump' of flame) and a warm plucked lift
    kemdo    the cooling kill: a long vent of steam and glass ticking as it cools
    lisvel   reach of morning: a bowstring drawn a little further, a harp step up into the light
    marund   hearthside: a hearth's soft crackle and a warm stone hum (an aura's reminder)
    nurrow   the quiet kill: a lull, two soft hollow tones falling and a long hush
    odrum    cracked amber: resin snapping, a dull amber crack, a sticky tail
    rishal   split glass: glass splitting along its cuts, a quick cascade of three pings
    sukri    the spare hour: a clock's tick-tock slowing, then a held breath of shimmer
    tunlan   startle: a paper lampshade flapping and a sharp shadow gasp
    ulkro    run-up: a light footfall tick and a short rising whistle
    vashil   the hum: a struck bell left humming, two partials beating

Generic procs (the 'proc.<kind>' roles) for passives that are not a fighter's and carry no sfx of their own:
    c_proc_item  an item's mechanism engaging: an escapement click and a small brass-glass ping
    c_proc_boon  a boon's hour answering: two quiet dawnglass notes, A5 then D6
    c_proc_team  a team buff's resin taking: a resin flare and crackle
    c_proc_unit  a monster's passive growing: a low shade swell lengthening into a hollow tone
"""
from __future__ import annotations

import numpy as np

from cuelib import cue
from synth import env as E
from synth import filters as F
from synth import osc as O
from synth import sfx as S
from synth.core import SR, TAU, hz, ns

from .kit import (Layers, R, bell, breath, crackle, drum, esc, finish, fm_tone, glass, harp, hollow, ink, lp, rev, room,
                  scrape, shimmer, sweep, tink)

PROC = (0.12, 1.0)
PROCK = dict(tail_floor_db=-50.0, fade_out=0.025, max_gr_db=6.0)
SOFT_TOP = [('peak', 3300, -2.5, 0.8), ('high', 9000, -3.0)]
V3 = 3                      # round-robin variants


def detune(v: int, cents: float = 35.0) -> float:
    """A variant's pitch offset (ratio): 0, +, - around the written note."""
    return 2 ** ((0.0, cents, -cents)[v % 3] / 1200.0)


# ── fighters ─────────────────────────────────────────────────────────────────────────────────────
@cue('f_ardit_passive', 'combat', ('m', -19.0), PROC, variants=V3, **PROCK)
def f_ardit_passive(v: int):
    """Ardit, Turned Blades: a blade turned on a pavise — a wooden board knock with an iron edge sliding off it
    (a short falling scrape-ring), braced by a low thud."""
    r = R('f_ardit_passive', v=v)
    d = detune(v)
    L = Layers(0.5)
    L.add(S.knock(r, 210 * d, 0.09, 5, 'wood'), 0.0, peak_db=-1)
    L.add(S.thump(0.18, 150 * d, 80, 0.02, 0.1, 1.6), 0.0, peak_db=-6)
    ring = S.partials(1180 * d, (1.0, 2.71, 5.1), (1.0, 0.5, 0.25), (0.25, 0.12, 0.06), 0.35, r)
    n = ring.size
    L.add(ring * np.exp(-np.arange(n) / SR / 0.12), 0.012, peak_db=-9)
    L.add(scrape(r, 0.22, 2400 * d, 2.0, 60, 0.7, 0.1), 0.01, peak_db=-12)
    return finish(room(L.out(), 'small', wet=0.08), hp_hz=60, eq=SOFT_TOP)


@cue('f_burdam_passive', 'combat', ('m', -19.0), PROC, variants=V3, **PROCK)
def f_burdam_passive(v: int):
    """Burdam, Long Memory: a grudge tallied — a chisel notch cut into stone (a hard tick and a short grind)
    over a low hollow knot."""
    r = R('f_burdam_passive', v=v)
    d = detune(v)
    L = Layers(0.45)
    L.add(S.snap(r, 3200 * d, 1.5), 0.0, peak_db=-6)
    L.add(S.knock(r, 520 * d, 0.05, 5, 'stone'), 0.0, peak_db=-2)
    L.add(scrape(r, 0.12, 1500 * d, 1.6, 45, 0.8, 0.3), 0.01, peak_db=-8)
    L.add(hollow(hz('D3') * d, 0.4, 0.3, r, odd=3), 0.0, peak_db=-5)
    return finish(room(L.out(), 'stone', wet=0.08), hp_hz=55, eq=SOFT_TOP)


@cue('f_dunsom_passive', 'combat', ('m', -19.5), PROC, variants=V3, **PROCK)
def f_dunsom_passive(v: int):
    """Dunsom, Settling: dust settling at dusk — a soft fall of fine grit, a shade breath sinking and a low
    hollow bell under it (a mark, not a hit: no hard transient beyond the grit's first grain)."""
    r = R('f_dunsom_passive', v=v)
    d = detune(v)
    L = Layers(0.7)
    L.add(S.chips(r, 0.4, 26, 1500, 6000, 0.09, 0.2), 0.0, peak_db=-7)
    L.add(breath(0.45, 1800, 400, shape='breath', q=2.0, seed=f'du{v}', peak_at=0.05, vel=0.7), 0.0, peak_db=-4, width=0.5)
    L.add(bell(hz('A3') * d, 0.6, 0.6, decay=0.35, bright=0.4, seed=f'du{v}'), 0.0, peak_db=-6)
    return finish(room(L.out(), 'small', wet=0.12), hp_hz=60, lp_hz=8000, eq=SOFT_TOP)


@cue('f_ervet_passive', 'combat', ('m', -21.0), (0.1, 0.4), variants=V3, **PROCK)
def f_ervet_passive(v: int):
    """Ervet, Dawnglass Edge: a tiny bright glass zing riding every strike (an FM glint gliding up a fifth,
    one high tink) — short and soft: it rides each attack."""
    r = R('f_ervet_passive', v=v)
    d = detune(v, 50)
    L = Layers(0.25)
    L.add(fm_tone(hz('A5') * d, hz('E6') * d, 0.12, ratio=2.32, i0=1.2, i1=0.2, t60=0.12, curve=2.5), 0.0, peak_db=-2)
    L.add(tink(hz('E7') * d, 0.1, 0.06, 0.4), 0.004, peak_db=-8)
    L.add(S.burst(r, 0.03, 4000, 9000, 0.012), 0.0, peak_db=-14)
    return finish(L.out(), hp_hz=400, lp_hz=11000, eq=SOFT_TOP)


@cue('f_hesmi_passive', 'combat', ('m', -19.0), PROC, variants=V3, **PROCK)
def f_hesmi_passive(v: int):
    """Hesmi, Shade-Fed: a dark glass shard cracking, ink bubbling out of the crack."""
    r = R('f_hesmi_passive', v=v)
    d = detune(v)
    L = Layers(0.5)
    L.add(S.shards(r, 0.3, 7, 900 * d, 3200 * d, 0.03, 0.08, 0.2), 0.0, peak_db=-3)
    L.add(S.thump(0.16, 170 * d, 70, 0.015, 0.1, 2.0), 0.0, peak_db=-6)
    L.add(ink(r, 0.35, 7, 140, 520, 0.08, wash=0.25), 0.03, peak_db=-6)
    return finish(room(L.out(), 'small', wet=0.1), hp_hz=60, lp_hz=8000, eq=SOFT_TOP)


@cue('f_ilsheta_passive', 'combat', ('m', -19.5), PROC, variants=V3, **PROCK)
def f_ilsheta_passive(v: int):
    """Ilsheta, Warm Hands: a lamp catching on the ally she heals (a soft 'whump' of flame) and a warm plucked
    lift F4 → A4 → D5 (help rises)."""
    r = R('f_ilsheta_passive', v=v)
    L = Layers(0.8)
    whump = O.coloured(ns(0.25), r, -4.0)
    whump = F.apply(whump, [F.lowpass(700, 0.8)]) * E.stages([(0, 0, 0), (0.03, 1, -1.5), (0.25, 0, 2.5)], ns(0.25))
    L.add(whump, 0.0, peak_db=-3)
    L.add(crackle(r, 0.25, 70, 1500, 5000, 0.1, 0.12), 0.01, peak_db=-14)
    for i, note in enumerate(('F4', 'A4', 'D5')):
        L.add(harp(hz(note) * detune(v, 15), 0.6, 0.7, bright=0.4, rr=(v + i) % 4, seed=f'il{v}'), 0.02 + 0.06 * i,
              peak_db=-4 - 1.5 * i, pan=(-0.2, 0.0, 0.2)[i])
    return finish(room(L.out(), 'wood', wet=0.12), hp_hz=70, lp_hz=9000, eq=SOFT_TOP)


@cue('f_kemdo_passive', 'combat', ('m', -18.5), (0.4, 1.2), variants=V3, **PROCK)
def f_kemdo_passive(v: int):
    """Kemdo, Cooling Kill: all her heat venting at once — a long falling steam hiss and the glass ticking as
    it cools (sparse high pings, slowing)."""
    r = R('f_kemdo_passive', v=v)
    D = 0.9
    L = Layers(D)
    hiss = O.coloured(ns(D), r, -1.0)

    def gains(t, fr):
        fc = 6500.0 * (0.35 ** np.clip(t / D, 0, 1))
        return F.bp_curve(fr, fc, 1.2, 2)

    hiss = F.stft_filter(hiss, gains, frame=1024) * E.stages([(0, 0, 0), (0.015, 1, -1.0), (D, 0, 1.6)], ns(D))
    L.add(hiss, 0.0, peak_db=-2)
    tt = 0.08
    k = 0
    while tt < D - 0.1:
        L.add(tink(hz('B6') * r.uniform(0.85, 1.25) * detune(v), 0.08, 0.05, 0.3), tt, peak_db=-12 - 1.5 * k)
        tt += 0.07 + 0.05 * k
        k += 1
    L.add(S.thump(0.15, 140, 80, 0.02, 0.08, 1.4), 0.0, peak_db=-10)
    return finish(L.out(), hp_hz=90, lp_hz=10000, eq=SOFT_TOP)


@cue('f_lisvel_passive', 'combat', ('m', -20.0), (0.15, 0.75), variants=V3, **PROCK)
def f_lisvel_passive(v: int):
    """Lisvel, Reach of Morning: her reach grows — a bowstring drawn a little further (a short taut creak) and
    a harp step up E5 → A5 into the light."""
    r = R('f_lisvel_passive', v=v)
    L = Layers(0.5)
    creak = np.zeros(ns(0.09))
    tt = 0.0
    while tt < 0.08:
        add = S.knock(r, 1300 * r.uniform(0.95, 1.05), 0.008, 3, 'wood')
        s = ns(tt)
        m = min(add.size, creak.size - s)
        creak[s:s + m] += add[:m] * (0.4 + 0.6 * tt / 0.08)
        tt += 0.008
    L.add(creak, 0.0, peak_db=-6)
    L.add(harp(hz('E5') * detune(v, 15), 0.4, 0.6, bright=0.5, rr=v % 4, seed=f'li{v}'), 0.05, peak_db=-3)
    L.add(harp(hz('A5') * detune(v, 15), 0.45, 0.7, bright=0.55, rr=(v + 1) % 4, seed=f'li{v}'), 0.11, peak_db=-1)
    L.add(tink(hz('A6'), 0.12, 0.08, 0.3), 0.11, peak_db=-14)
    return finish(room(L.out(), 'wood', wet=0.1), hp_hz=120, eq=SOFT_TOP)


@cue('f_marund_passive', 'combat', ('m', -21.0), (0.25, 1.15), variants=V3, **PROCK)
def f_marund_passive(v: int):
    """Marund, Hearthside: the hearth he carries — a soft hearth crackle and a warm low stone hum, round and
    unhurried (it reminds his allies the aura is there; the engine plays it at most every 6 s)."""
    r = R('f_marund_passive', v=v)
    D = 0.7
    L = Layers(D)
    n = ns(D)
    hum = O.sine(hz('D3') * detune(v, 10), n) + 0.3 * O.sine(hz('A3') * detune(v, 10), n)
    L.add(hum * E.stages([(0, 0, 0), (0.06, 1, -1.5), (D, 0, 2.0)], n), 0.0, peak_db=-3)
    L.add(S.knock(r, 240, 0.08, 4, 'stone'), 0.0, peak_db=-8)
    L.add(crackle(r, 0.5, 50, 1400, 5000, 0.15, 0.3), 0.02, peak_db=-8)
    return finish(room(L.out(), 'stone', wet=0.1), hp_hz=70, lp_hz=7000, eq=SOFT_TOP)


@cue('f_nurrow_passive', 'combat', ('m', -18.5), (0.5, 1.2), variants=V3, **PROCK)
def f_nurrow_passive(v: int):
    """Nurrow, Quiet Kill: the lull after a takedown — two soft hollow tones falling F4 → D4 and a long hush
    sweeping down (sleep coming), with a soft felt knock to land it."""
    r = R('f_nurrow_passive', v=v)
    L = Layers(1.0)
    L.add(S.knock(r, 300, 0.05, 4, 'clay'), 0.0, peak_db=-6)
    L.add(hollow(hz('F4') * detune(v, 12), 0.45, 0.4, r, odd=3), 0.0, peak_db=-2)
    L.add(hollow(hz('D4') * detune(v, 12), 0.6, 0.5, r, odd=3), 0.18, peak_db=-3)
    L.add(breath(0.8, 3000, 500, shape='breath', q=1.4, seed=f'nu{v}', peak_at=0.12, vel=0.6), 0.02, peak_db=-6, width=0.6)
    return finish(room(L.out(), 'glass', wet=0.16), hp_hz=80, lp_hz=8000, eq=SOFT_TOP)


@cue('f_odrum_passive', 'combat', ('m', -19.0), PROC, variants=V3, **PROCK)
def f_odrum_passive(v: int):
    """Odrum, Cracked Amber: resin snapping — a hard amber crack (a dull, damped glass split), a few resin
    crackles and a short sticky ink tail."""
    r = R('f_odrum_passive', v=v)
    d = detune(v)
    L = Layers(0.45)
    L.add(S.snap(r, 2200 * d, 2.5), 0.0, peak_db=-8)
    crack = S.partials(760 * d, (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.07, 0.04, 0.02), 0.15, r)
    L.add(lp(crack, 3000), 0.0, peak_db=-2)
    L.add(S.thump(0.16, 190 * d, 95, 0.02, 0.11, 1.6), 0.0, peak_db=-5)
    L.add(crackle(r, 0.2, 90, 1200, 4500, 0.0), 0.01, peak_db=-10)
    L.add(ink(r, 0.25, 4, 180, 420, 0.06, wash=0.15), 0.05, peak_db=-8)
    return finish(room(L.out(), 'small', wet=0.08), hp_hz=70, eq=SOFT_TOP)


@cue('f_rishal_passive', 'combat', ('m', -19.0), PROC, variants=V3, **PROCK)
def f_rishal_passive(v: int):
    """Rishal, Split Glass: his cuts spent — glass splitting along them, a quick falling cascade of three
    clear pings (one per Cut) over a short snap."""
    r = R('f_rishal_passive', v=v)
    d = detune(v)
    L = Layers(0.45)
    L.add(S.snap(r, 4200 * d, 1.5), 0.0, peak_db=-6)
    for i, note in enumerate(('C7', 'A6', 'E6')):
        L.add(S.glass_ping(hz(note) * d, 0.25, 0.14, 0.7, r), 0.035 * i, peak_db=-2 - 1.5 * i, pan=(0.25, -0.15, 0.05)[i])
    L.add(S.chips(r, 0.2, 10, 3500, 9000, 0.05, 0.06), 0.0, peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.1), hp_hz=300, eq=SOFT_TOP)


@cue('f_sukri_passive', 'combat', ('m', -18.0), (0.6, 1.6), variants=V3, **PROCK)
def f_sukri_passive(v: int):
    """Sukri, Spare Hour: the hour he keeps in reserve — a clock's tick-tock slowing to a stop, then a held,
    reversed shimmer breath (time holding still for a second)."""
    r = R('f_sukri_passive', v=v)
    L = Layers(1.1)
    tt = 0.0
    for i in range(4):
        L.add(esc('tick' if i % 2 == 0 else 'tock', 0.9, rr=(v + i) % 4, seed=f'su{v}'), tt, peak_db=-2 - i)
        tt += 0.09 + 0.05 * i
    L.add(rev(shimmer(hz('D6') * detune(v, 10), 0.5, 0.6, decay=0.4, seed=f'su{v}'), 0.02), 0.25, peak_db=-6)
    L.add(glass('A5', 0.6, 0.6, decay=0.35, bright=0.5, seed=f'su{v}', strike=0.0), 0.72, peak_db=-6)
    return finish(room(L.out(), 'glass', wet=0.14), hp_hz=120, eq=SOFT_TOP)


@cue('f_tunlan_passive', 'combat', ('m', -19.0), (0.15, 0.6), variants=V3, **PROCK)
def f_tunlan_passive(v: int):
    """Tunlan, Startle: a paper lampshade flapping once and a sharp shadow gasp drawn in, over a tiny wooden
    puppet-clack."""
    r = R('f_tunlan_passive', v=v)
    L = Layers(0.45)
    flap = O.coloured(ns(0.08), r, -1.0)
    flap = F.apply(flap, [F.bandpass(1400 * detune(v), 0.9)]) * E.stages([(0, 0, 0), (0.004, 1, -1.0), (0.08, 0, 2.0)], ns(0.08))
    L.add(flap, 0.0, peak_db=-2)
    L.add(S.knock(r, 900 * detune(v), 0.025, 4, 'wood'), 0.005, peak_db=-6)
    L.add(breath(0.22, 700, 3200, shape='swell', q=2.2, seed=f'tu{v}', vel=0.8), 0.03, peak_db=-4, width=0.4)
    return finish(room(L.out(), 'small', wet=0.08), hp_hz=150, lp_hz=9000, eq=SOFT_TOP)


@cue('f_ulkro_passive', 'combat', ('m', -21.0), (0.1, 0.45), variants=V3, **PROCK)
def f_ulkro_passive(v: int):
    """Ulkro, Run-up: a stack gained on the run — a light footfall on the frame drum's rim and a short whistle
    flicking up (the dart hunter's breath)."""
    r = R('f_ulkro_passive', v=v)
    L = Layers(0.3)
    L.add(drum('D3', 0.7, 'tek', seed=f'ul{v}', dur=0.15, t60=0.08, rr=v), 0.0, peak_db=-3)
    L.add(sweep(hz('D6') * detune(v, 60), hz('A6') * detune(v, 60), 0.09, curve=2.0, t60=0.09), 0.02, peak_db=-6)
    L.add(S.burst(r, 0.05, 1500, 5000, 0.02), 0.0, peak_db=-12)
    return finish(L.out(), hp_hz=200, lp_hz=10000, eq=SOFT_TOP)


@cue('f_vashil_passive', 'combat', ('m', -19.0), (0.4, 1.15), variants=V3, **PROCK)
def f_vashil_passive(v: int):
    """Vashil, Hum: a bell struck lightly and left humming — the hum partial an octave under the strike, two
    close partials beating at 6 Hz so it trembles."""
    r = R('f_vashil_passive', v=v)
    D = 0.8
    n = ns(D)
    t = np.arange(n) / SR
    f = hz('A3') * detune(v, 20)
    hum = (np.sin(TAU * f * t) + 0.8 * np.sin(TAU * (f + 6.0) * t)) * E.stages([(0, 0, 0), (0.02, 1, -1.0), (D, 0, 1.2)], n)
    L = Layers(D)
    L.add(bell(f * 2, 0.5, 0.6, decay=0.3, bright=0.5, seed=f'va{v}'), 0.0, peak_db=-3)
    L.add(hum, 0.0, peak_db=-2)
    L.add(S.knock(r, 1800, 0.02, 3, 'stone'), 0.0, peak_db=-14)
    return finish(room(L.out(), 'stone', wet=0.1), hp_hz=80, lp_hz=8000, eq=SOFT_TOP)


# ── generic procs ('proc.<kind>') ────────────────────────────────────────────────────────────────
@cue('c_proc_item', 'combat', ('m', -21.0), (0.1, 0.4), variants=V3, **PROCK)
def c_proc_item(v: int):
    """An item's passive engaging: a small escapement click and a brass-glass ping (a mechanism catching)."""
    r = R('c_proc_item', v=v)
    L = Layers(0.3)
    L.add(esc('tick', 0.8, rr=v, seed='pi', res=(1200.0, 2600.0)), 0.0, peak_db=-2)
    L.add(S.partials(hz('G6') * detune(v, 25), (1.0, 2.0, 2.92), (1.0, 0.35, 0.2), (0.14, 0.08, 0.05), 0.2, r), 0.006, peak_db=-6)
    return finish(L.out(), hp_hz=300, lp_hz=10000, eq=SOFT_TOP)


@cue('c_proc_boon', 'combat', ('m', -20.0), (0.3, 0.9), variants=V3, **PROCK)
def c_proc_boon(v: int):
    """A boon's hour answering: two quiet dawnglass notes, A5 then D6, with a breath of air under them."""
    L = Layers(0.7)
    L.add(glass('A5', 0.5, 0.7, decay=0.3, bright=0.55, seed=f'pb{v}'), 0.0, peak_db=-1)
    L.add(glass('D6', 0.5, 0.65, decay=0.3, bright=0.55, seed=f'pbx{v}'), 0.08, peak_db=-3)
    L.add(breath(0.3, 800, 2400, shape='breath', q=1.4, seed=f'pb{v}', peak_at=0.06, vel=0.5), 0.0, peak_db=-12, width=0.5)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=150, eq=SOFT_TOP)


@cue('c_proc_team', 'combat', ('m', -20.0), (0.15, 0.6), variants=V3, **PROCK)
def c_proc_team(v: int):
    """A team buff's resin taking hold: a short flare of flame (a rushing 'fwip' upward) and a resin crackle."""
    r = R('c_proc_team', v=v)
    L = Layers(0.45)
    flare = O.coloured(ns(0.18), r, -2.5)

    def gains(t, fr):
        return F.bp_curve(fr, 500.0 * (4.0 ** np.clip(t / 0.18, 0, 1)), 1.0, 2)

    flare = F.stft_filter(flare, gains, frame=512) * E.stages([(0, 0, 0), (0.02, 1, -1.0), (0.18, 0, 1.8)], ns(0.18))
    L.add(flare, 0.0, peak_db=-2)
    L.add(crackle(r, 0.35, 80, 1300, 5500, 0.08, 0.2), 0.02, peak_db=-7)
    return finish(L.out(), hp_hz=120, lp_hz=9000, eq=SOFT_TOP)


@cue('c_proc_unit', 'combat', ('m', -19.0), (0.4, 1.2), variants=V3, **PROCK)
def c_proc_unit(v: int):
    """A monster's passive growing (a shadow lengthening): a low shade swell stretching down into a hollow tone."""
    r = R('c_proc_unit', v=v)
    L = Layers(1.0)
    L.add(breath(0.6, 1200, 250, shape='breath', q=2.2, seed=f'pu{v}', peak_at=0.1, vel=0.8), 0.0, peak_db=-2, width=0.5)
    L.add(hollow(hz('D2') * detune(v, 20), 0.8, 0.6, r, odd=4), 0.04, peak_db=-3)
    return finish(room(L.out(), 'stone', wet=0.12), hp_hz=40, lp_hz=6000, eq=SOFT_TOP)
