"""Combat cues (bus `sfx`, spatial). Panned and attenuated around your fighter by the engine, so they
are built mostly mono-centred (narrow, mid/side tails only) and front-loaded: the hit lands on the
first millisecond, never after a pre-swell, unless the cue is a wind-up whose job is to build.

Impact recipe (sfx.py): transient snap + saturated pitch-dropping body + material knock + chips +
short room. By damage type:
  physical   stone and wood knocks with opaque chip debris (light: wood-led, heavy: stone-led)
  magic      a struck glass ping and an FM shimmer over a soft body
  true       a hollow tube pop, then its own ring played backwards: the inverted swell
Casts: Lumen rises into glass; Shade inhales, then a hollow low tone and bubbling ink.
Big moments: hourbell + frame drum + stone rumble.
Cues that fire constantly (swings, light hits, bolts, whooshes, wick deaths) are short, carry a broad
dip around 3.3 kHz and a soft top so a teamfight of them never stabs.
Loudness (max momentary, asset level, before the cue gain): air -21..-19, hits -17..-14, casts
-19..-16, big -14..-12; the zone loop is integrated -22.
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
from synth.core import SR, TAU, fade, hz, ns

from .kit import (Layers, R, at_len, bell, breath, crackle, crumble, drum, finish, flutter, fm_tone, glass, harp,
                  hollow, ink, lp, rev, roll, room, scrape, shimmer, sweep, tink)

AIR = (0.12, 0.45)          # QA duration windows (s)
HIT = (0.12, 0.75)
CAST = (0.3, 1.2)
BIG = (0.8, 3.6)
# mastering profiles (cuelib.CueSpec kwargs): tail floor re the cue's peak, tail fade, soft-clip density
AIRK = dict(tail_floor_db=-48.0)
HITK = dict(tail_floor_db=-48.0, clip_drive=1.6, max_gr_db=6.0)
CASTK = dict(tail_floor_db=-50.0, fade_out=0.025)
BIGK = dict(tail_floor_db=-54.0, fade_out=0.04, clip_drive=1.4, max_gr_db=6.0)
SOFT_TOP = [('peak', 3300, -3.0, 0.8), ('high', 9000, -3.0)]     # frequent cues


def woomf(dur: float, f0: float, f1: float, peak_at: float) -> np.ndarray:
    """A low sine push that swells and falls (the weight under a heavy swing)."""
    n = ns(dur)
    t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / dur)
    y = np.sin(TAU * np.cumsum(f) / SR)
    return y * E.stages([(0, 0, 0), (peak_at, 1, -1.5), (dur, 0, 2.5)], n)


def daze(f: float, dur: float, vib_hz: float, cents: float, t60: float, ratio: float = 2.0) -> np.ndarray:
    """A wobbling bell tone (the 'seeing stars' of a stun)."""
    n = ns(dur)
    t = np.arange(n) / SR
    fr = f * 2 ** (cents / 1200 * np.sin(TAU * vib_hz * t))
    idx = 0.2 + 1.2 * np.exp(-t / 0.08)
    return S.norm(O.fm(fr, ratio, idx, n) * E.decay(n, t60, 0.003))


# ── swings and shots ─────────────────────────────────────────────────────────────────────────────
@cue('c_swing_light', 'combat', ('m', -20.0), AIR, **AIRK)
def c_swing_light(v: int):
    """Light swing (fires constantly, minions too): a quick airy pass rising to 1.7 kHz and gone in 170 ms."""
    r = R('c_swing_light', v=v)
    L = Layers(0.2)
    L.add(S.whoosh(r, 0.17, 600, 1000, q=1.3, peak_at=0.38, f_mid=1700, rise=-1.2, fall=2.5), 0.0, peak_db=0, width=0.5)
    L.add(S.whoosh(r, 0.15, 320, 420, q=0.9, peak_at=0.4, f_mid=600), 0.005, peak_db=-9, width=0.3)
    return finish(L.out(), hp_hz=150, eq=SOFT_TOP)


@cue('c_swing_heavy', 'combat', ('m', -18.0), AIR, **AIRK)
def c_swing_heavy(v: int):
    """Heavy swing: a slower, lower pass with body (a low woomf) and cloth, peaking at 140 ms."""
    r = R('c_swing_heavy', v=v)
    L = Layers(0.36)
    L.add(S.whoosh(r, 0.34, 260, 600, q=1.0, peak_at=0.42, f_mid=1250, low_body=0.9, rise=-1.4), 0.0, peak_db=0, width=0.5)
    L.add(woomf(0.32, 130, 62, 0.14), 0.0, peak_db=-11)
    L.add(S.burst(r, 0.09, 400, 1800, 0.06, attack=0.01), 0.1, peak_db=-17)
    return finish(L.out(), hp_hz=45, eq=SOFT_TOP)


@cue('c_shot_bow', 'combat', ('m', -19.0), AIR, **AIRK)
def c_shot_bow(v: int):
    """Bow release: the arrow's thwip leading, the string's short twang (Karplus-Strong B2, damped at
    60 ms) and the nock's snap."""
    r = R('c_shot_bow', v=v)
    L = Layers(0.36)
    L.add(harp('B2', 0.22, 0.95, bright=0.75, damp_at=0.06, seed='bow', body=0.5), 0.0, peak_db=-4)
    L.add(S.snap(r, 2400, 1.5), 0.0, peak_db=-10)
    L.add(S.knock(r, 820, 0.03, 4, 'wood'), 0.0, peak_db=-10)
    L.add(S.whoosh(r, 0.14, 3400, 1500, q=1.5, peak_at=0.16, rise=-0.8), 0.006, peak_db=-2, width=0.4)
    return finish(L.out(), hp_hz=70, eq=SOFT_TOP)


@cue('c_shot_bolt_lumen', 'combat', ('m', -19.0), AIR, **AIRK)
def c_shot_bolt_lumen(v: int):
    """Light bolt (casters, Glimwicks): a glass 'zing' falling A6 → A5, an E6 glint, a little air."""
    r = R('c_shot_bolt_lumen', v=v)
    L = Layers(0.26)
    L.add(fm_tone(hz('A6'), hz('A5'), 0.2, ratio=3.5, i0=1.2, i1=0.2, t60=0.16, curve=2.5), 0.0, peak_db=-2)
    L.add(tink(hz('E6'), 0.16, 0.1, bright=0.3), 0.0, peak_db=-10)
    L.add(S.whoosh(r, 0.2, 1600, 3000, q=1.4, peak_at=0.15), 0.0, peak_db=-11, width=0.5)
    L.add(S.thump(0.08, 320, 160, 0.01, 0.05, 1.2), 0.0, peak_db=-12)
    return finish(room(L.out(), 'tiny', wet=0.08), hp_hz=180, eq=SOFT_TOP + [('peak', 1500, 1.5, 1.0)])


@cue('c_shot_bolt_shade', 'combat', ('m', -19.0), AIR, **AIRK)
def c_shot_bolt_shade(v: int):
    """Shade bolt: an inky 'fwum' (breath falling 1.8 kHz → 450 Hz) over a hollow falling tone and a bubble."""
    r = R('c_shot_bolt_shade', v=v)
    L = Layers(0.32)
    L.add(breath(0.26, 1800, 450, shape='breath', q=2.4, seed=f'sbs{v}', peak_at=0.05), 0.0, peak_db=-1, width=0.6)
    L.add(lp(sweep(330, 150, 0.25, curve=2.0, t60=0.2, shape='tri'), 1200), 0.0, peak_db=-5)
    L.add(ink(r, 0.25, 4, 220, 600, 0.05, wash=0.15), 0.01, peak_db=-11)
    L.add(S.burst(r, 0.05, 200, 1500, 0.03), 0.0, peak_db=-13)
    return finish(room(L.out(), 'tiny', wet=0.1), hp_hz=60, lp_hz=9000, eq=SOFT_TOP)


@cue('c_thrown', 'combat', ('m', -19.0), AIR, **AIRK)
def c_thrown(v: int):
    """Thrown weapon or stone: a spinning whoosh (24 → 15 Hz rotation) with a wooden release tick."""
    r = R('c_thrown', v=v)
    L = Layers(0.38)
    w = S.whoosh(r, 0.34, 600, 900, q=1.4, peak_at=0.45, f_mid=1800)
    L.add(flutter(w, 24, 15, 0.75), 0.0, peak_db=0, width=0.5)
    lo = S.whoosh(r, 0.3, 260, 380, q=0.9, peak_at=0.45, f_mid=520)
    L.add(flutter(lo, 24, 15, 0.6), 0.0, peak_db=-9, width=0.3)
    L.add(S.knock(r, 640, 0.025, 4, 'wood'), 0.0, peak_db=-13)
    return finish(L.out(), hp_hz=90, eq=SOFT_TOP)


@cue('c_proj_whoosh', 'combat', ('m', -21.0), AIR, **AIRK)
def c_proj_whoosh(v: int):
    """Generic projectile in flight (every projectile, minions included): a soft mid pass with a
    falling Doppler-ish band, nothing above 6 kHz."""
    r = R('c_proj_whoosh', v=v)
    w = S.whoosh(r, 0.22, 1300, 650, q=1.2, peak_at=0.35, f_mid=1650, rise=-1.0, fall=2.0)
    return finish(Layers(0.24).add(w, 0.0, peak_db=0, width=0.4).out(), hp_hz=200, lp_hz=6000, eq=SOFT_TOP)


# ── hits ─────────────────────────────────────────────────────────────────────────────────────────
@cue('c_hit_phys_light', 'combat', ('m', -18.5), HIT, **HITK)
def c_hit_phys_light(v: int):
    """Physical light hit (the most frequent sound in the game): a short wooden knock with a mid thwack
    over a saturated 230 → 100 Hz body, a few chips. Knock-led so it reads on laptop speakers; soft-topped."""
    r = R('c_hit_phys_light', v=v)
    L = Layers(0.2)
    L.add(S.snap(r, 2800, 1.8), 0.0, peak_db=-9)
    L.add(S.thump(0.17, 230, 100, 0.012, 0.09, 2.4), 0.0, peak_db=-3)
    L.add(S.knock(r, 470, 0.05, 5, 'wood'), 0.0, peak_db=0)
    L.add(S.knock(r, 880, 0.03, 4, 'stone'), 0.002, peak_db=-8)
    L.add(S.burst(r, 0.04, 700, 2600, 0.02, q=0.9), 0.0, peak_db=-6)
    L.add(S.chips(r, 0.14, 8, 1500, 5000, 0.025, 0.05), 0.006, peak_db=-16)
    return finish(room(L.out(), 'tiny', wet=0.1), hp_hz=55, eq=SOFT_TOP)


@cue('c_hit_phys_heavy', 'combat', ('m', -16.5), HIT, **HITK)
def c_hit_phys_heavy(v: int):
    """Physical heavy hit: stone-led. A deep 150 → 45 Hz body, two stone knocks, crunch, a spray of
    opaque chips and a short stone room."""
    r = R('c_hit_phys_heavy', v=v)
    L = Layers(0.45)
    L.add(S.snap(r, 2500, 3.0), 0.0, peak_db=-9)
    L.add(S.thump(0.4, 160, 48, 0.03, 0.16, 2.8), 0.0, peak_db=-5)
    L.add(S.knock(r, 240, 0.18, 6, 'stone'), 0.0, peak_db=0)
    L.add(S.burst(r, 0.14, 300, 1200, 0.08, q=0.8), 0.0, peak_db=-5)
    L.add(S.knock(r, 560, 0.06, 5, 'stone'), 0.001, peak_db=-4)
    L.add(lp(S.burst(r, 0.09, 450, 3500, 0.05), 4000), 0.0, peak_db=-5)
    L.add(S.chips(r, 0.35, 22, 1200, 5500, 0.05, 0.1), 0.008, peak_db=-12)
    L.add(S.rumble(r, 0.45, 150, 0.3, 0.005), 0.0, peak_db=-14)
    return finish(room(L.out(), 'stone', wet=0.12), hp_hz=35, eq=[('peak', 3300, -2.5, 0.8), ('high', 9000, -2)])


@cue('c_hit_magic', 'combat', ('m', -18.0), HIT, **HITK)
def c_hit_magic(v: int):
    """Magic hit: a struck E6 glass ping and an A5 FM shimmer (index 3 → 0) over a soft body, a puff
    of light and a few glass bits."""
    r = R('c_hit_magic', v=v)
    L = Layers(0.4)
    L.add(glass('E6', 0.36, 0.85, decay=0.1, bright=0.7, seed=f'hm{v}'), 0.0, peak_db=0)
    L.add(shimmer('A5', 0.32, 0.7, decay=0.22, index=3.0, seed=f'hm{v}'), 0.0, peak_db=-5)
    L.add(S.thump(0.12, 260, 120, 0.01, 0.07, 1.3), 0.0, peak_db=-8)
    L.add(S.burst(r, 0.06, 1500, 7000, 0.03), 0.0, peak_db=-16)
    L.add(S.shards(r, 0.25, 8, 3000, 8000, 0.03), 0.004, peak_db=-16)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=120, eq=[('peak', 3300, -2.5, 0.8), ('high', 9000, -2)])


@cue('c_hit_true', 'combat', ('m', -16.0), HIT, **HITK)
def c_hit_true(v: int):
    """True damage: a hollow tube pop on A3 with a sub knock, then the tube's own ring played
    backwards, swelling for 220 ms and cut off: the inverted swell no armour stops."""
    r = R('c_hit_true', v=v)
    L = Layers(0.4)
    L.add(hollow(220.0, 0.25, 0.16, r), 0.0, peak_db=0)
    L.add(S.thump(0.18, 120, 60, 0.015, 0.1, 1.5), 0.0, peak_db=-6)
    ring = hollow(220.0, 0.5, 0.45, R('c_hit_true', 'ring', v)) + 0.4 * hollow(330.0, 0.5, 0.3, R('c_hit_true', 'r5', v))
    inv = fade(rev(at_len(ring, 0.22, 0.002), 0.03), 0.0, 0.006)
    L.add(lp(inv, 2500), 0.04, peak_db=-3)
    L.add(rev(breath(0.2, 1300, 400, shape='breath', q=1.6, seed=f'ht{v}', peak_at=0.02), 0.03), 0.06, peak_db=-13, width=0.6)
    L.add(S.thump(0.06, 300, 180, 0.006, 0.03, 1.0), 0.26, peak_db=-16)
    return finish(room(L.out(), 'small', wet=0.08), hp_hz=50, eq=[('peak', 3300, -2, 0.8)])


@cue('c_crit', 'combat', ('m', -15.5), HIT, **HITK)
def c_crit(v: int):
    """Critical strike: the heavy hit doubled at the front (a 'kr-rack' of two snaps), a deeper body, a
    glass crack and a short E6/B6 ring so it reads as a different, better hit."""
    r = R('c_crit', v=v)
    L = Layers(0.5)
    L.add(S.snap(r, 3000, 2.5), 0.0, peak_db=-6)
    L.add(S.snap(r, 2200, 3.0), 0.011, peak_db=-7)
    L.add(S.thump(0.45, 170, 45, 0.028, 0.2, 3.0), 0.0, peak_db=-5)
    L.add(S.knock(r, 300, 0.16, 6, 'stone'), 0.0, peak_db=0)
    L.add(S.burst(r, 0.14, 300, 1200, 0.08, q=0.8), 0.0, peak_db=-5)
    L.add(S.knock(r, 700, 0.05, 5, 'stone'), 0.011, peak_db=-4)
    L.add(S.burst(r, 0.06, 900, 3500, 0.03, q=0.9), 0.0, peak_db=-6)
    L.add(S.shards(r, 0.3, 14, 2500, 8000, 0.03, 0.08, 0.2), 0.006, peak_db=-9)
    L.add(glass('E6', 0.5, 0.8, decay=0.12, bright=0.8, seed=f'cr{v}'), 0.004, peak_db=-11)
    L.add(glass('B6', 0.4, 0.7, decay=0.09, bright=0.6, seed=f'cr{v}'), 0.012, peak_db=-15)
    L.add(S.chips(r, 0.4, 24, 1200, 6000, 0.05, 0.1), 0.01, peak_db=-15)
    L.add(S.rumble(r, 0.5, 160, 0.35, 0.005), 0.0, peak_db=-11)
    return finish(room(L.out(), 'stone', wet=0.13), hp_hz=35, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_monster_hit', 'combat', ('m', -19.0), HIT, **HITK)
def c_monster_hit(v: int):
    """Hitting a camp monster (and its death): a thick-hide slap and clay thud, no chips, muffled top."""
    r = R('c_monster_hit', v=v)
    L = Layers(0.32)
    L.add(S.thump(0.3, 150, 60, 0.02, 0.11, 2.6), 0.0, peak_db=-5)
    L.add(S.knock(r, 210, 0.11, 5, 'clay'), 0.0, peak_db=0)
    L.add(S.knock(r, 520, 0.04, 4, 'clay'), 0.001, peak_db=-6)
    L.add(S.burst(r, 0.05, 500, 1800, 0.035, q=0.8), 0.0, peak_db=-4)
    L.add(S.knock(r, 120, 0.1, 3, 'clay'), 0.004, peak_db=-10)
    return finish(room(L.out(), 'small', wet=0.08), hp_hz=40, lp_hz=6000)


@cue('c_needle_hit', 'combat', ('m', -15.5), HIT, **HITK)
def c_needle_hit(v: int):
    """A Needle's (tower's) bolt landing on you: a deep stone thud and crack, then a searing sizzle of
    focused sunlight with a ringing A5. The sizzle tail is the tower's signature."""
    r = R('c_needle_hit', v=v)
    L = Layers(0.5)
    L.add(S.thump(0.35, 160, 48, 0.025, 0.14, 2.6), 0.0, peak_db=-5)
    L.add(S.knock(r, 300, 0.12, 6, 'stone'), 0.0, peak_db=0)
    L.add(S.snap(r, 2800, 2.5), 0.0, peak_db=-8)
    L.add(S.shards(r, 0.25, 8, 2500, 8000, 0.03), 0.004, peak_db=-12)
    L.add(crackle(r, 0.45, 120, 1500, 7000, hiss=0.3, decay_s=0.4), 0.02, peak_db=-5, width=0.6)
    L.add(glass('A5', 0.5, 0.7, decay=0.14, bright=0.7, seed=f'nh{v}'), 0.0, peak_db=-11)
    return finish(room(L.out(), 'stone', wet=0.1), hp_hz=40, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_needle_shot', 'combat', ('m', -17.0), (0.25, 0.8), **HITK)
def c_needle_shot(v: int):
    """A Needle (tower) fires: the stone housing thunks, a lance of light zings down from A7 to A5 and the
    Bell Needle's metal-glass rings once. Heavier than any fighter bolt: a tower is a threat."""
    r = R('c_needle_shot', v=v)
    L = Layers(0.6)
    L.add(S.knock(r, 160, 0.1, 6, 'stone'), 0.0, peak_db=0)
    L.add(S.knock(r, 420, 0.05, 5, 'stone'), 0.001, peak_db=-6)
    L.add(S.thump(0.3, 130, 50, 0.02, 0.2, 2.2), 0.0, peak_db=-6)
    L.add(S.snap(r, 3000, 2.0), 0.0, peak_db=-9)
    L.add(S.burst(r, 0.04, 1500, 7000, 0.02), 0.0, peak_db=-12)
    L.add(fm_tone(hz('A7'), hz('A5'), 0.28, ratio=3.5, i0=3.0, i1=0.2, t60=0.25, curve=2.5), 0.006, peak_db=-5)
    L.add(S.whoosh(r, 0.3, 2500, 900, q=1.4, peak_at=0.12), 0.0, peak_db=-10, width=0.5)
    L.add(bell('A5', 0.8, 0.6, decay=0.08, bright=0.8, seed=f'ns{v}'), 0.0, peak_db=-13)
    return finish(room(L.out(), 'stone', wet=0.12), hp_hz=40, eq=[('peak', 3300, -2.5, 0.8)])


# ── casts and movement ───────────────────────────────────────────────────────────────────────────
@cue('c_cast_lumen', 'combat', ('m', -18.0), CAST, **CASTK)
def c_cast_lumen(v: int):
    """Lumen cast: light gathers (a 120 ms upward tone and air) and releases as an A5+E6 glass fifth with
    an FM shimmer and a rising sparkle."""
    r = R('c_cast_lumen', v=v)
    L = Layers(0.6)
    L.add(sweep(700, 1760, 0.14, curve=-1.0, env='swell'), 0.0, peak_db=-9)
    L.add(breath(0.15, 1500, 5000, shape='swell', q=1.2, seed=f'cl{v}', vel=0.6), 0.0, peak_db=-13, width=0.6)
    L.add(glass('A5', 0.5, 0.85, decay=0.18, bright=0.8, seed=f'cl{v}'), 0.12, peak_db=0)
    L.add(glass('E6', 0.45, 0.75, decay=0.15, bright=0.7, seed=f'cl{v}'), 0.128, peak_db=-3)
    L.add(shimmer('E6', 0.45, 0.6, decay=0.3, index=2.5, seed=f'cl{v}'), 0.12, peak_db=-9)
    L.add(S.sparkle(r, 0.3, 6, 86, 100, t60=0.12, rise=True), 0.12, peak_db=-16)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=200, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_cast_shade', 'combat', ('m', -18.5), CAST, **CASTK)
def c_cast_shade(v: int):
    """Shade cast: an inhale (breath swelling 400 → 1600 Hz), then a hollow D3 tube, bubbling ink and the
    exhale falling away. Out means harm: it ends lower than it began."""
    r = R('c_cast_shade', v=v)
    L = Layers(0.7)
    L.add(breath(0.2, 400, 1600, shape='swell', q=2.0, seed=f'cs{v}', peak_at=0.19), 0.0, peak_db=-4, width=0.6)
    L.add(hollow(hz('D3'), 0.45, 0.35, r), 0.18, peak_db=0)
    L.add(ink(r, 0.35, 6, 150, 500, 0.08, wash=0.3), 0.18, peak_db=-7)
    L.add(breath(0.28, 1400, 300, shape='breath', q=1.8, seed=f'cs{v}x', peak_at=0.03), 0.18, peak_db=-7, width=0.6)
    L.add(S.thump(0.2, 110, 55, 0.02, 0.15, 1.6), 0.18, peak_db=-8)
    return finish(room(L.out(), 'stone', wet=0.1), hp_hz=50, lp_hz=8000)


@cue('c_cast_charge', 'combat', ('m', -19.0), (0.9, 1.5), **CASTK)
def c_cast_charge(v: int):
    """Charging (e.g. Noon Glare's 1.2 s charge): an FM tone climbing 220 → 880 Hz with its index opening,
    a flutter accelerating 4 → 22 Hz, breath and glass rising with it; it peaks and stops at 1.2 s."""
    r = R('c_cast_charge', v=v)
    L = Layers(1.3)
    riser = fm_tone(220, 880, 1.2, ratio=3.5, i0=0.3, i1=2.0, curve=-0.8, env='swell')
    L.add(flutter(riser, 4, 22, 0.5), 0.0, peak_db=-3)
    L.add(breath(1.2, 300, 3500, shape='swell', q=1.6, seed=f'cc{v}', curve=-2.0), 0.0, peak_db=-6, width=0.6)
    L.add(lp(sweep(73.4, 110, 1.2, curve=-0.5, env='swell', shape='tri'), 500), 0.0, peak_db=-9)
    L.add(S.sparkle(r, 1.1, 12, 84, 100, t60=0.12, rise=True), 0.1, peak_db=-15)
    return finish(L.out(), hp_hz=50, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_cast_big', 'combat', ('m', -16.0), (0.6, 2.0), **BIGK)
def c_cast_big(v: int):
    """A large non-ultimate cast: a deep push, an A3 hourbell, a glass E5/A5 fifth and a bright shimmer."""
    r = R('c_cast_big', v=v)
    L = Layers(1.2)
    L.add(S.thump(0.5, 140, 45, 0.03, 0.35, 2.5), 0.0, peak_db=-3)
    L.add(bell('A3', 1.4, 0.8, decay=0.2, seed=f'cb{v}'), 0.0, peak_db=-4)
    L.add(glass('E5', 1.0, 0.85, decay=0.3, seed=f'cb{v}'), 0.0, peak_db=-2)
    L.add(glass('A5', 0.9, 0.8, decay=0.26, seed=f'cb{v}x'), 0.006, peak_db=-4)
    L.add(shimmer('E6', 0.8, 0.6, decay=0.5, index=3.0, seed=f'cb{v}'), 0.0, peak_db=-9)
    L.add(breath(0.4, 2500, 600, shape='breath', q=1.5, seed=f'cb{v}', peak_at=0.03), 0.0, peak_db=-13, width=0.6)
    L.add(S.shards(r, 0.4, 12, 2500, 8000, 0.05), 0.0, peak_db=-15)
    return finish(room(L.out(), 'stone', wet=0.14), hp_hz=40, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_dash', 'combat', ('m', -18.0), AIR, **AIRK)
def c_dash(v: int):
    """Dash: a fast whoosh swept up to 2.4 kHz and back, the push-off scraping stone, a foot plant."""
    r = R('c_dash', v=v)
    L = Layers(0.32)
    L.add(S.whoosh(r, 0.27, 500, 1000, q=1.1, peak_at=0.3, f_mid=2400, low_body=0.5), 0.0, peak_db=0, width=0.6)
    L.add(scrape(r, 0.18, 700, 1.2, 40, 0.6, 0.2), 0.0, peak_db=-8)
    L.add(S.knock(r, 260, 0.04, 4, 'stone'), 0.0, peak_db=-10)
    L.add(S.burst(r, 0.08, 500, 2000, 0.05, attack=0.005), 0.02, peak_db=-16)
    return finish(room(L.out(), 'tiny', wet=0.07), hp_hz=60, eq=SOFT_TOP)


@cue('c_blink', 'combat', ('m', -18.0), (0.2, 0.8), **CASTK)
def c_blink(v: int):
    """Blink: an E6 glass note drawn in backwards (you vanish), a zip of FM upward, a small air pop and a
    B5 glass note forward (you appear)."""
    r = R('c_blink', v=v)
    L = Layers(0.45)
    L.add(rev(glass('E6', 0.18, 0.7, decay=0.1, bright=0.7, seed=f'bl{v}'), 0.01), 0.0, peak_db=-4)
    L.add(fm_tone(900, 3500, 0.1, ratio=3.5, i0=2.0, i1=0.3, curve=-1.0, env='swell'), 0.08, peak_db=-9)
    L.add(S.thump(0.08, 400, 200, 0.006, 0.04, 1.2), 0.18, peak_db=-10)
    L.add(S.burst(r, 0.03, 2000, 8000, 0.015), 0.18, peak_db=-14)
    L.add(glass('B5', 0.3, 0.75, decay=0.12, bright=0.7, seed=f'bl{v}x'), 0.18, peak_db=-1)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=150, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_slam', 'combat', ('m', -15.5), (0.5, 1.6), **BIGK)
def c_slam(v: int):
    """Ground slam / stamp / topple: a stone-kicked frame drum and a deep body, the ground knocking, a
    crumble of stone, chips and a rumble that rolls away through the stone room."""
    r = R('c_slam', v=v)
    L = Layers(1.0)
    L.add(drum('D2', 1.0, 'doum', seed=f'sl{v}', dur=1.0, t60=0.55, kick=0.9), 0.0, peak_db=-2)
    L.add(S.thump(0.6, 120, 38, 0.04, 0.28, 3.0), 0.0, peak_db=-8)
    L.add(S.snap(r, 2200, 3.0), 0.0, peak_db=-9)
    L.add(S.knock(r, 180, 0.22, 6, 'stone'), 0.0, peak_db=0)
    L.add(S.burst(r, 0.2, 250, 1100, 0.12, q=0.8), 0.0, peak_db=-5)
    L.add(S.knock(r, 450, 0.08, 5, 'stone'), 0.002, peak_db=-5)
    L.add(lp(S.burst(r, 0.1, 400, 3000, 0.06), 3500), 0.0, peak_db=-6)
    L.add(crumble(r, 0.7, 14, 150, 900, 0.12, 0.06), 0.02, peak_db=-6)
    L.add(S.chips(r, 0.6, 30, 1000, 5000, 0.08, 0.15), 0.01, peak_db=-12)
    L.add(S.rumble(r, 1.0, 120, 0.7, 0.01, rough=0.4), 0.0, peak_db=-8)
    return finish(room(L.out(), 'stone', wet=0.16), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])


@cue('c_burst_lumen', 'combat', ('m', -15.0), (0.5, 1.6), **BIGK)
def c_burst_lumen(v: int):
    """Lumen burst (shard rain, radiant blasts): a short suck of light, a bright whoomp, a shatter of glass
    shards, a D6 FM shimmer (index 4 → 0), an A5/E6 glass fifth and falling sparkle."""
    r = R('c_burst_lumen', v=v)
    L = Layers(1.0)
    L.add(rev(shimmer('E6', 0.08, 0.6, decay=0.08, seed=f'bu{v}'), 0.01), 0.0, peak_db=-14)
    t = 0.05
    L.add(S.thump(0.4, 180, 60, 0.02, 0.25, 2.0), t, peak_db=-4)
    L.add(S.shards(r, 0.8, 40, 2200, 9000, 0.1), t, peak_db=-3, width=0.8)
    L.add(shimmer('D6', 1.0, 0.8, decay=0.6, index=4.0, seed=f'bu{v}'), t, peak_db=-5)
    L.add(glass('A5', 0.9, 0.8, decay=0.35, seed=f'bu{v}'), t, peak_db=-6)
    L.add(glass('E6', 0.8, 0.7, decay=0.3, seed=f'bu{v}x'), t + 0.006, peak_db=-8)
    L.add(S.sparkle(r, 0.8, 18, 86, 105, t60=0.16, decay_level=1.0), t + 0.02, peak_db=-13)
    L.add(S.burst(r, 0.12, 2000, 10000, 0.07), t, peak_db=-13)
    return finish(room(L.out(), 'glass', wet=0.16), hp_hz=60, eq=[('peak', 3300, -3, 0.8)])


@cue('c_burst_shade', 'combat', ('m', -15.0), (0.5, 1.6), **BIGK)
def c_burst_shade(v: int):
    """Shade burst: breath drawn in for 90 ms, then a dark boom, a muffled D3 bell, ink bursting and the
    breath thrown out and down to 250 Hz over a low rumble."""
    r = R('c_burst_shade', v=v)
    L = Layers(1.0)
    L.add(breath(0.1, 300, 1200, shape='swell', q=1.6, seed=f'bs{v}', peak_at=0.095), 0.0, peak_db=-8, width=0.6)
    t = 0.09
    L.add(S.thump(0.6, 120, 38, 0.035, 0.45, 3.0), t, peak_db=-3)
    L.add(lp(bell('D3', 1.2, 0.7, decay=0.15, bright=0.5, seed=f'bs{v}'), 1500), t, peak_db=-6)
    L.add(S.knock(r, 190, 0.1, 5, 'clay'), t, peak_db=-5)
    L.add(ink(r, 0.7, 14, 120, 500, 0.12, wash=0.4), t, peak_db=-3)
    L.add(breath(0.6, 2200, 250, shape='breath', q=1.6, seed=f'bs{v}x', peak_at=0.05), t, peak_db=-4, width=0.7)
    L.add(S.rumble(r, 0.8, 110, 0.6, 0.01), t, peak_db=-10)
    return finish(room(L.out(), 'stone', wet=0.14), hp_hz=30, lp_hz=8000)


@cue('c_zone_loop', 'combat', ('int', -22.0), (1.9, 2.1), loop=True)
def c_zone_loop(v: int):
    """A lingering hazard zone (burning resin, pooled shade): a seamless 2 s loop of a low D2 lamp hum,
    a breathing band of noise, two glass partials beating slowly and a sparse resin crackle."""
    r = R('c_zone_loop', v=v)
    D = 2.0
    n = ns(D)
    t = np.arange(n) / SR
    hum = I.lamp_drone(hz('D2'), D, 0.6, seed='zone', cutoff=(220.0, 520.0), lfo_hz=0.5, attack=0.0, release=0.0, loop_len=D)
    band = I.shade_breath(D, 350, 1100, 1.0, 0.7, seed='zone', shape='flat', loop_len=D)
    band = band * (1.0 - 0.35 + 0.35 * np.sin(TAU * 1.0 * t))[None, :]
    gl = np.zeros(n)
    for f, a in ((440.0, 1.0), (440.5, 0.8), (659.5, 0.45), (660.0, 0.4)):
        gl += a * np.sin(TAU * f * t)                          # whole cycles in 2 s: seamless
    cr = np.zeros(n)
    for _ in range(int(r.poisson(18 * D))):
        k = ns(r.uniform(0.0005, 0.002))
        s = ns(r.uniform(0, D))
        c = O.white(k, r) * np.linspace(1, 0, k) ** 2 * (r.pareto(2.5) + 0.2)
        idx = (s + np.arange(k)) % n
        cr[idx] += c
    cr = F.apply(cr, [F.highpass(900, 0.7), F.lowpass(5000, 0.7)], circular=True)
    mix = (S.norm(hum) * 10 ** (-3 / 20) + S.norm(band) * 10 ** (-2 / 20)
           + (S.norm(gl) * 10 ** (-17 / 20))[None, :] + (S.norm(cr) * 10 ** (-14 / 20))[None, :])
    mix = F.apply(mix, [F.highpass(40, 0.7), F.peaking(3300, -3, 0.8)], circular=True)
    return mix / (np.max(np.abs(mix)) + 1e-12)


# ── statuses and support ─────────────────────────────────────────────────────────────────────────
@cue('c_shield', 'combat', ('m', -18.0), CAST, **CASTK)
def c_shield(v: int):
    """Shield: a glass dome closes (air swell, a low 'vwm' rising 180 → 360 Hz), struck D5+A5 glass and a
    D6 shimmer, a faint 12 Hz field flutter in the tail."""
    L = Layers(0.8)
    L.add(breath(0.12, 800, 3000, shape='swell', q=1.4, seed=f'sh{v}', vel=0.6), 0.0, peak_db=-12, width=0.6)
    L.add(sweep(180, 360, 0.3, curve=-1.0, env='swell'), 0.0, peak_db=-9)
    L.add(glass('D5', 0.8, 0.8, decay=0.3, bright=0.7, seed=f'sh{v}'), 0.06, peak_db=-1)
    L.add(glass('A5', 0.8, 0.7, decay=0.28, bright=0.65, seed=f'sh{v}x'), 0.07, peak_db=-3)
    L.add(shimmer('D6', 0.7, 0.6, decay=0.45, index=2.0, seed=f'sh{v}'), 0.06, peak_db=-8)
    n = ns(0.6)
    hum = O.sine(hz('D4'), n) * E.decay(n, 0.5, 0.03)
    L.add(S.am(hum, 12.0, 0.6), 0.08, peak_db=-12)
    return finish(room(L.out(), 'glass', wet=0.14), hp_hz=100, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_heal', 'combat', ('m', -19.0), CAST, **CASTK)
def c_heal(v: int):
    """Heal (up means help): no strike at all. A D minor triad of bowed dawnglass (D5 F5 A5) swells in
    over 220 ms and lets go, breath rising under it and a few sparks floating up. Soft enough to repeat."""
    r = R('c_heal', v=v)
    D = 0.85
    n = ns(D)
    sw = E.stages([(0, 0, 0), (0.22, 1, -2.2), (D, 0, 2.5)], n)
    L = Layers(D)
    for i, (note, g, p) in enumerate((('D5', 0, -0.2), ('F5', -3, 0.2), ('A5', -5, 0.0))):
        L.add(glass(note, D, 0.7, decay=0.5, bright=0.5, seed=f'he{v}{i}', strike=0.0) * sw, 0.004 * i, peak_db=g, pan=p)
    L.add(O.sine(hz('D4'), n) * sw, 0.0, peak_db=-15)
    L.add(breath(0.6, 600, 2400, shape='breath', q=1.2, seed=f'he{v}', peak_at=0.22, vel=0.5), 0.0, peak_db=-12, width=0.7)
    L.add(S.sparkle(r, 0.45, 6, 86, 98, t60=0.12, rise=True), 0.15, peak_db=-17)
    return finish(room(L.out(), 'glass', wet=0.14), hp_hz=150, lp_hz=9000, eq=[('peak', 3300, -2, 0.8)])


@cue('c_buff', 'combat', ('m', -19.0), CAST, **CASTK)
def c_buff(v: int):
    """Empower / buff: a bright FM glide A4 → A5 whose index opens, a rising sparkle, an E6 glass cap."""
    r = R('c_buff', v=v)
    L = Layers(0.7)
    L.add(fm_tone(440, 880, 0.35, ratio=3.5, i0=0.3, i1=1.5, curve=-1.0, env='swell'), 0.0, peak_db=-3)
    L.add(S.sparkle(r, 0.35, 10, 84, 100, t60=0.1, rise=True), 0.05, peak_db=-11)
    L.add(breath(0.35, 500, 3000, shape='swell', q=1.4, seed=f'bf{v}', vel=0.6), 0.0, peak_db=-11, width=0.6)
    L.add(glass('E6', 0.4, 0.65, decay=0.2, bright=0.6, seed=f'bf{v}'), 0.33, peak_db=-5)
    return finish(room(L.out(), 'glass', wet=0.12), hp_hz=150, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_stun', 'combat', ('m', -16.0), CAST, **CASTK)
def c_stun(v: int):
    """Stun: a hard thud and stone knock, then a dazed wobble (B5 and F5, 8-9 Hz vibrato) with glass
    bits circling left and right."""
    r = R('c_stun', v=v)
    L = Layers(0.75)
    L.add(S.thump(0.25, 190, 70, 0.015, 0.15, 2.4), 0.0, peak_db=0)
    L.add(S.knock(r, 420, 0.06, 5, 'stone'), 0.0, peak_db=-6)
    L.add(S.snap(r, 2600, 2.0), 0.0, peak_db=-11)
    L.add(daze(hz('B5'), 0.6, 8.5, 40, 0.5), 0.02, peak_db=-7)
    L.add(daze(hz('F5'), 0.55, 7.0, 35, 0.45), 0.03, peak_db=-10)
    sp = S.sparkle(r, 0.5, 8, 90, 100, t60=0.08)
    n = sp.size
    ph = np.sin(TAU * 5.0 * np.arange(n) / SR)
    L.add(np.vstack([sp * (0.6 + 0.4 * ph), sp * (0.6 - 0.4 * ph)]), 0.04, peak_db=-14)
    return finish(room(L.out(), 'small', wet=0.1), hp_hz=50, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_slow', 'combat', ('m', -19.0), CAST, **CASTK)
def c_slow(v: int):
    """Slow: a glass tone sagging D6 → D5 like a tape slowing, a viscous breath closing down, sticky ink."""
    r = R('c_slow', v=v)
    L = Layers(0.6)
    L.add(fm_tone(hz('D6'), hz('D5'), 0.45, ratio=2.32, i0=0.8, i1=0.1, t60=0.4, curve=1.5), 0.0, peak_db=-4)
    L.add(breath(0.5, 2000, 350, shape='breath', q=2.5, seed=f'sw{v}', peak_at=0.08), 0.0, peak_db=-3, width=0.6)
    L.add(ink(r, 0.4, 5, 150, 400, 0.1, wash=0.2), 0.02, peak_db=-10)
    L.add(S.thump(0.15, 160, 90, 0.02, 0.1, 1.2), 0.0, peak_db=-10)
    return finish(room(L.out(), 'small', wet=0.1), hp_hz=60, lp_hz=9000, eq=[('peak', 3300, -2, 0.8)])


@cue('c_root', 'combat', ('m', -17.5), CAST, **CASTK)
def c_root(v: int):
    """Root: the ground grabs (a low wooden knock and thud), roots creak (a stick-slip train of wood
    clicks slowing down) and small vines snap, over a little earth rumble."""
    r = R('c_root', v=v)
    L = Layers(0.65)
    L.add(S.knock(r, 180, 0.1, 5, 'wood'), 0.0, peak_db=-2)
    L.add(S.thump(0.2, 140, 70, 0.02, 0.12, 1.8), 0.0, peak_db=-5)
    creak = np.zeros(ns(0.45))
    t, i = 0.03, 0
    while t < 0.4:
        k = S.knock(r, 700 * r.uniform(0.9, 1.1), 0.015, 3, 'wood')
        a = 0.4 + 0.6 * math.sin(math.pi * t / 0.42)
        s = ns(t)
        creak[s:s + k.size] += k[:creak.size - s] * a
        t += 0.006 + 0.03 * (t / 0.4) ** 1.5
        i += 1
    L.add(lp(creak, 3500), 0.0, peak_db=-5)
    for tt in (0.05, 0.12, 0.2):
        L.add(S.knock(r, 1100 * r.uniform(0.9, 1.2), 0.02, 4, 'wood'), tt, peak_db=-10)
    L.add(S.chips(r, 0.3, 10, 1500, 4500, 0.08, 0.1), 0.05, peak_db=-17)
    L.add(S.rumble(r, 0.4, 200, 0.25, 0.01), 0.0, peak_db=-14)
    return finish(room(L.out(), 'small', wet=0.1), hp_hz=50, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_summon', 'combat', ('m', -18.0), (0.5, 1.5), **CASTK)
def c_summon(v: int):
    """Summon: a glass chord gathers backwards out of the air and pops into being (a body, a puff, an A5
    glass strike and a muffled D3 bell), sparkle rising off it."""
    r = R('c_summon', v=v)
    L = Layers(1.1)
    ch = Layers(0.4)
    ch.add(glass('D5', 0.4, 0.7, decay=0.25, seed=f'su{v}'), 0.0, peak_db=0)
    ch.add(glass('A5', 0.4, 0.6, decay=0.22, seed=f'su{v}x'), 0.0, peak_db=-2)
    L.add(rev(ch.out(), 0.02), 0.0, peak_db=-6)
    L.add(breath(0.3, 300, 1800, shape='swell', q=1.4, seed=f'su{v}', vel=0.6), 0.0, peak_db=-11, width=0.6)
    t = 0.3
    L.add(S.thump(0.25, 220, 80, 0.015, 0.15, 2.0), t, peak_db=-3)
    L.add(S.burst(r, 0.04, 1500, 8000, 0.02), t, peak_db=-13)
    L.add(lp(bell('D3', 1.0, 0.7, decay=0.12, bright=0.5, seed=f'su{v}'), 2000), t, peak_db=-7)
    L.add(glass('A5', 0.6, 0.8, decay=0.25, seed=f'su{v}y'), t, peak_db=-2)
    L.add(S.sparkle(r, 0.4, 8, 86, 100, t60=0.12, rise=True), t + 0.01, peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.13), hp_hz=50, eq=[('peak', 3300, -2.5, 0.8)])


# ── big moments ──────────────────────────────────────────────────────────────────────────────────
@cue('c_ult_windup', 'combat', ('m', -16.0), (0.7, 1.2), **CASTK)
def c_ult_windup(v: int):
    """Ultimate wind-up: power gathering for 0.9 s. A D4 hourbell played backwards, breath swelling up to
    3.5 kHz, a frame-drum roll accelerating 6 → 22 Hz and a low riser, all cresting together."""
    r = R('c_ult_windup', v=v)
    D = 0.9
    L = Layers(D + 0.05)
    b = bell('D4', 1.2, 0.9, decay=0.2, seed=f'uw{v}')
    L.add(fade(rev(at_len(b, D - 0.02, 0.002), 0.05), 0.0, 0.004), 0.0, peak_db=-3)
    L.add(breath(D, 300, 3500, shape='swell', q=1.4, seed=f'uw{v}', curve=-2.5), 0.0, peak_db=-6, width=0.7)
    L.add(roll('D2', D - 0.04, 6, 22, 0.2, 0.85, seed=f'uw{v}'), 0.0, peak_db=-7)
    L.add(lp(sweep(110, 220, D, curve=-1.5, env='swell', shape='tri'), 900), 0.0, peak_db=-8)
    L.add(S.sparkle(r, D - 0.1, 14, 84, 102, t60=0.1, rise=True), 0.05, peak_db=-16)
    x = L.out()
    return finish(at_len(x, D + 0.03, 0.03), hp_hz=35, eq=[('peak', 3300, -2.5, 0.8)])


@cue('c_ult_release', 'combat', ('m', -14.0), (1.2, 3.4), **BIGK)
def c_ult_release(v: int):
    """Ultimate release, the biggest combat sound: a stone-kicked frame drum and sub, D3 and A3 hourbells,
    a bright E5 glass, a shatter of shards and an A5 shimmer, then a stone rumble rolling through the hall."""
    r = R('c_ult_release', v=v)
    L = Layers(2.4)
    L.add(S.snap(r, 2600, 3.0), 0.0, peak_db=-10)
    L.add(drum('D2', 1.0, 'doum', seed=f'ur{v}', dur=1.4, t60=0.7, kick=1.6), 0.0, peak_db=0)
    L.add(S.thump(0.9, 110, 34, 0.05, 0.7, 2.6), 0.0, peak_db=-5)
    L.add(S.knock(r, 210, 0.14, 6, 'stone'), 0.0, peak_db=-4)
    L.add(bell('D3', 2.4, 0.9, decay=0.3, bright=0.9, seed=f'ur{v}'), 0.0, peak_db=-2)
    L.add(bell('A3', 2.2, 0.8, decay=0.28, seed=f'ur{v}x'), 0.004, peak_db=-5)
    L.add(glass('E5', 1.6, 0.85, decay=0.5, bright=0.9, seed=f'ur{v}'), 0.006, peak_db=-6)
    L.add(S.shards(r, 0.9, 30, 2000, 9000, 0.1), 0.0, peak_db=-10, width=0.8)
    L.add(shimmer('A5', 1.4, 0.6, decay=0.9, index=3.5, seed=f'ur{v}'), 0.0, peak_db=-10)
    L.add(S.rumble(r, 2.0, 110, 1.4, 0.02, rough=0.4), 0.0, peak_db=-5)
    L.add(crumble(r, 1.2, 12, 120, 700, 0.25), 0.05, peak_db=-15)
    return finish(room(L.out(), 'hall', wet=0.15), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])


@cue('c_structure_fall', 'combat', ('m', -13.0), (2.0, 4.5), **BIGK)
def c_structure_fall(v: int):
    """A structure collapses: the fracture cracks, stone grinds, chunks land as three frame-drum hits,
    masonry cascades into chips over a long rumble, and a low D3 bell tolls under it."""
    r = R('c_structure_fall', v=v)
    L = Layers(3.4)
    L.add(S.snap(r, 2000, 4.0), 0.0, peak_db=-6)
    L.add(S.burst(r, 0.15, 300, 4000, 0.1), 0.0, peak_db=-6)
    L.add(scrape(r, 1.2, 220, 2.0, 12, 0.7, 0.4), 0.05, peak_db=-8)
    for t, note, vel, g in ((0.0, 'D2', 1.0, -2), (0.55, 'D2', 0.8, -4), (1.1, 'A1', 0.7, -6)):
        L.add(drum(note, vel, 'doum', seed=f'sf{t}', dur=1.0, t60=0.6, kick=1.5), t, peak_db=g)
    L.add(S.rumble(r, 3.0, 100, 2.0, 0.05, rough=0.5), 0.0, peak_db=-3)
    L.add(crumble(r, 2.4, 50, 100, 900, 0.5, 0.08), 0.1, peak_db=-2)
    L.add(S.chips(r, 2.2, 60, 1000, 5000, 0.4, 0.8), 0.15, peak_db=-10)
    L.add(lp(bell('D3', 2.6, 0.7, decay=0.25, bright=0.6, seed='sf'), 2000), 0.6, peak_db=-8)
    x = room(L.out(), 'stone', wet=0.18)
    return finish(room(x, 'hall', wet=0.06), hp_hz=28, eq=[('peak', 3300, -2, 0.8)])


@cue('c_death_shatter', 'combat', ('m', -15.0), (0.8, 2.0), **BIGK)
def c_death_shatter(v: int):
    """A fighter falls: the body's thud, a glass crack and a long shatter of shards, a low D3 hum and a
    breath falling away to 250 Hz, sparkle thinning out."""
    r = R('c_death_shatter', v=v)
    L = Layers(1.4)
    L.add(S.thump(0.4, 150, 45, 0.025, 0.3, 2.4), 0.0, peak_db=-6)
    L.add(S.knock(r, 260, 0.08, 5, 'stone'), 0.0, peak_db=-6)
    L.add(S.snap(r, 3200, 2.0), 0.0, peak_db=-9)
    L.add(S.shards(r, 1.0, 50, 1800, 9000, 0.14, 0.1, 0.5), 0.0, peak_db=-1, width=0.8)
    L.add(lp(bell('D3', 1.4, 0.6, decay=0.18, bright=0.5, seed=f'ds{v}'), 1800), 0.0, peak_db=-10)
    L.add(breath(1.0, 2500, 250, shape='breath', q=1.6, seed=f'ds{v}', peak_at=0.05), 0.0, peak_db=-8, width=0.7)
    L.add(S.sparkle(r, 0.9, 14, 84, 100, t60=0.16, decay_level=2.0), 0.02, peak_db=-14)
    return finish(room(L.out(), 'glass', wet=0.15), hp_hz=40, eq=[('peak', 3300, -3, 0.8)])


@cue('c_wick_die', 'combat', ('m', -20.0), (0.15, 0.45), **AIRK)
def c_wick_die(v: int):
    """A Wick (minion lamp) dies: its flame snuffed (a short 'ffp' of breath and a puff), the lamp glass
    tinkling. Small, soft, frequent."""
    r = R('c_wick_die', v=v)
    L = Layers(0.32)
    L.add(breath(0.14, 1600, 350, shape='breath', q=1.8, seed=f'wd{v}', peak_at=0.02), 0.0, peak_db=0, width=0.5)
    L.add(S.burst(r, 0.05, 300, 1500, 0.03), 0.0, peak_db=-6)
    L.add(S.thump(0.08, 220, 120, 0.008, 0.05, 1.2), 0.0, peak_db=-9)
    L.add(S.shards(r, 0.25, 4, 2500, 6000, 0.05, 0.06, 0.12), 0.01, peak_db=-12)
    return finish(L.out(), hp_hz=90, eq=SOFT_TOP)


@cue('c_monster_roar', 'combat', ('m', -14.0), (0.9, 2.0), **BIGK)
def c_monster_roar(v: int):
    """Glasshorn's Glass Bellow: a growling throat (saws 62 → 92 → 70 Hz with noise through moving vowel
    formants and a 28 Hz rasp) and, inside it, bowed glass on D4 and G#4 swelling, over a sub."""
    r = R('c_monster_roar', v=v)
    D = 1.4
    n = ns(D)
    t = np.arange(n) / SR
    f0 = np.interp(t, [0, 0.35, 1.0, D], [62, 92, 78, 66])
    src = O.saw(f0, n) + 0.7 * O.saw(f0 * 1.007, n, 0.3) + 0.5 * O.saw(f0 * 0.5, n, 0.6)
    src = src / 3 + 0.12 * O.pink(n, r) * 4            # voiced throat first, breath under it
    f1 = np.interp(t, [0, 0.35, 1.0, D], [380, 720, 560, 420])
    f2 = np.interp(t, [0, 0.35, 1.0, D], [950, 1350, 1150, 900])
    growl = S.formants(src, f1, f2, q=5.0, mix=0.95)
    growl = S.am(growl, 28.0, 0.3)
    envl = E.stages([(0, 0, 0), (0.15, 1, -1.5), (1.0, 0.8, 0), (D, 0, 2.0)], n)
    L = Layers(D)
    L.add(growl * envl, 0.0, peak_db=0)
    sw = E.stages([(0, 0, 0), (0.4, 1, -2.0), (1.1, 0.7, 0), (D, 0, 2.0)], n)
    L.add(glass('D4', D, 0.7, decay=1.0, bright=0.7, seed=f'mr{v}', strike=0.0) * sw, 0.0, peak_db=-5, pan=-0.2)
    L.add(glass('G#4', D, 0.6, decay=1.0, bright=0.6, seed=f'mr{v}x', strike=0.0) * sw, 0.0, peak_db=-8, pan=0.2)
    L.add(glass('D5', D, 0.5, decay=1.0, bright=0.5, seed=f'mr{v}y', strike=0.0) * sw, 0.05, peak_db=-13)
    L.add(O.sine(46.0, n) * envl, 0.0, peak_db=-8)
    return finish(room(L.out(), 'stone', wet=0.16), hp_hz=30, eq=[('peak', 3300, -2, 0.8)])
