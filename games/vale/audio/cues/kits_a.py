"""Per-fighter sound kits, first half (final parity AUD-1): ardit, burdam, dunsom, ervet, hesmi, ilsheta, kemdo,
lisvel. Bus `sfx` (spatial) except the call (bus `ui`). Named f_<fighter>_<slot>; src/audio/index.ts resolves them
before the catalog's present.sfx / hitSfx, so content/fighters is never edited for a sound (the passive procs are
fighters.py's).

Each fighter is built from its brief (_design/fighters/<id>.md: weapon, materials, origin) around a HOME material and
a SIGNATURE instrument in D Dorian; the instrument carries the 2-3-note call (the draft's lock-in, fighterCall())
and returns, struck big, in the ult release, so the ear ties a fighter's lock-in to its ultimate:

    ardit    a thick dawnglass pane in an oak frame, an ash spear     pane (plate modes)        D4 A4 D5 rising
    burdam   an ironstone cleaver, lacquer, a tally of grudges        hollow ironstone gong     A2 D3
    dunsom   a shepherd's crook, a lampresin lantern, dusk breath     carved wooden herd bell   F4 D4 A3 falling
    ervet    an oversized dawnglass greatsword that shatters          singing glass             E6 B5 E6
    hesmi    stone gauntlets, shards of the fallen needle, shade      stone bar (lithophone)    D3 A2
    ilsheta  a dawnglass lamp on a hook-staff, its flame              dial harp                 D5 F5 A5
    kemdo    a burning-glass lens glaive, heat and steam              FM sear (burning glass)   A4 D5
    lisvel   an ash longbow, a low string, morning                    lark whistle              A5 E6 D6

Slots: attack_swing / attack_hit (3 round-robin variants each: they fire more than once a second), a1-a3 (3
variants; the ability's main gesture lands at its castTime, read from content, with the wind-up before it),
ult_windup (one fixed take, learnable: it crests at the ult's castTime), ult_release (a delayed landing lands at
the area's delay, read from content), death, call. Identity slots (attack swing / hit, ult wind-up / release) are
kept >= 8 dB apart by 1/3-octave distance (audio/build.py kit gate) by giving each fighter its own band and its
own tonal colour, not just its own file.
Loudness (max momentary, asset level): swing -19.5, hit -17.5, casts -18, wind-up -17, release -14.5, death -15.5,
call -21 (it rides on the lock-in, -20).
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

from .combat import woomf
from .fighters import detune
from .kit import (Layers, R, at_len, bell, breath, clonk, crackle, crumble, drum, fm_tone, glass, harp, hiss, hollow, ink,
                  litho, lp, norm, pane, rev, roll, room, scrape, sear, shimmer, swell_into, tink, whistle)
from .kit import finish as _fin

SWING = (0.1, 0.5)          # QA duration windows (s)
HITW = (0.1, 0.8)
CASTW = (0.25, 1.6)
WIND = (0.2, 0.9)
RELW = (0.9, 3.6)
DIEW = (0.7, 2.6)
CALLW = (0.4, 2.2)
SWK = dict(tail_floor_db=-48.0)                                         # mastering profiles
HTK = dict(tail_floor_db=-48.0, clip_drive=1.5, max_gr_db=6.0)
CSK = dict(tail_floor_db=-50.0, fade_out=0.025)
BGK = dict(tail_floor_db=-54.0, fade_out=0.04, clip_drive=1.3, max_gr_db=6.0)
CLK = dict(tail_floor_db=-52.0, fade_out=0.04)
T_SW, T_HIT, T_CAST = ('m', -19.5), ('m', -17.5), ('m', -18.0)
T_WIND, T_REL, T_DIE, T_CALL = ('m', -17.0), ('m', -14.5), ('m', -15.5), ('m', -21.0)
V3 = 3
SOFT_TOP = [('peak', 3300, -3.0, 0.8), ('high', 9000, -3.0)]          # frequent cues
CALM = [('peak', 3300, -2.5, 0.8)]
GLASS3 = (1.0, 2.32, 4.25)

_FIGHTERS = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'content', 'fighters'))
_KITS: dict[str, dict] = {}


def timing(fid: str, slot: str) -> tuple[float, float]:
    """An ability's wind-up (castTime) and its delayed landing (the largest top-level area / zone delay), read from
    content (read only), so a cue's gesture lands where the sim lands it."""
    if fid not in _KITS:
        with open(os.path.join(_FIGHTERS, f'{fid}.json'), encoding='utf8') as f:
            _KITS[fid] = json.load(f)['kit']
    ab = _KITS[fid].get(slot) or {}
    ct = float(ab.get('castTime') or 0.0)
    dl = [float(e.get('delay') or 0.0) for e in ab.get('effects', []) if e.get('op') in ('area', 'zone')]
    return ct, max(dl, default=0.0)


def wind(fid: str) -> float:
    """The ult wind-up's length: its castTime (an instant ult still gets a short gesture)."""
    return max(timing(fid, 'ult')[0], 0.15)


# ── local building blocks ────────────────────────────────────────────────────────────────────────
def bowed(f0: float, f1: float, dur: float, ratios=(1.0, 1.594, 2.136, 2.653), amps=(1.0, 0.45, 0.3, 0.18),
          peak_at: float = 0.8, trem: float = 5.0, depth: float = 0.15) -> np.ndarray:
    """A sustained (bowed) glass tone gliding f0 → f1 on the given partials, swelling to peak_at of its length."""
    n = ns(dur)
    t = np.arange(n) / SR
    f = np.geomspace(f0, f1, n)
    y = sum(a * O.sine(f * k, n) for k, a in zip(ratios, amps))
    if depth:
        y = y * (1 - depth / 2 + depth / 2 * np.sin(TAU * trem * t))
    return norm(y * E.stages([(0, 0, 0), (dur * peak_at, 1, -2.0), (dur, 0, 2.0)], n))


def creak(r: np.random.Generator, dur: float, f: float, step: float = 0.008, rise: float = 1.0) -> np.ndarray:
    """A taut creak (a bow drawn, lacquer tightening): a run of tiny wood knocks, louder and (rise > 1) higher."""
    y = np.zeros(ns(dur) + ns(0.03))
    t = 0.0
    while t < dur:
        u = t / dur
        k = S.knock(r, f * (1 + (rise - 1) * u) * r.uniform(0.96, 1.04), 0.008, 3, 'wood')
        s = ns(t)
        m = min(k.size, y.size - s)
        y[s:s + m] += k[:m] * (0.35 + 0.65 * u)
        t += step * r.uniform(0.8, 1.2)
    return norm(y)


def iron_gong(f: float, dur: float, r: np.random.Generator) -> np.ndarray:
    """A hollow ironstone gong (Burdam's): a closed tube's odd modes, long and dark, a stone knock on its lip."""
    y = hollow(f, dur, dur * 0.6, r, odd=5, hit_ms=3.0, inharm=0.02)
    k = S.knock(r, f * 1.5, 0.06, 4, 'stone')
    y[:k.size] += 0.4 * k[:y.size]
    return norm(lp(y, 4000))


def whump(r: np.random.Generator, dur: float = 0.22, cut: float = 700.0) -> np.ndarray:
    """A flame catching: a soft low-passed rush of air that blooms and falls."""
    n = ns(dur)
    x = F.apply(O.coloured(n, r, -4.0), [F.lowpass(cut, 0.8)])
    return norm(x * E.stages([(0, 0, 0), (min(0.03, dur * 0.25), 1, -1.5), (dur, 0, 2.5)], n))


def flutter_noise(r: np.random.Generator, dur: float, f: float, rate: float, depth: float = 0.9) -> np.ndarray:
    """Fletching / cloth: band-passed noise chopped at `rate`."""
    n = ns(dur)
    x = F.apply(O.white(n, r), [F.bandpass(f, 1.2)])
    return norm(S.am(x, rate, depth) * E.decay(n, dur * 0.8, 0.002))


def lead(fid: str, slot: str, f0: float, f1: float, seed: str, q: float = 2.0) -> np.ndarray | None:
    """A breath swelling through an ability's wind-up into the moment it lands (None for an instant cast)."""
    ct = timing(fid, slot)[0]
    return breath(ct + 0.01, f0, f1, shape='swell', q=q, seed=seed, curve=-2.0) if ct > 0.05 else None


# ══ Ardit, Pavise bearer ═════════════════════════════════════════════════════════════════════════
@cue('f_ardit_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_ardit_attack_swing(v: int):
    """Ardit's spear thrust: a tight jab of air rising to 950 Hz, the pavise's oak frame shifting on his arm (a low
    wood knock) and the pane answering faintly (a short D4 plate ring)."""
    r = R('f_ardit_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.24)
    L.add(S.whoosh(r, 0.19, 480 * d, 760 * d, q=1.6, peak_at=0.3, f_mid=950 * d, rise=-1.0, fall=2.6), 0.0, peak_db=0, width=0.4)
    L.add(S.knock(r, 240 * d, 0.06, 4, 'wood'), 0.0, peak_db=-3)
    L.add(pane(hz('D4') * d, 0.22, t60=0.14, bright=0.4, r=r), 0.004, peak_db=-7)
    return _fin(L.out(), hp_hz=110, eq=SOFT_TOP)


@cue('f_ardit_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_ardit_attack_hit(v: int):
    """The spear lands: a hard point snap, the ash shaft's thock, a body thump and a dull pane tock behind it."""
    r = R('f_ardit_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.4)
    L.add(S.snap(r, 3000 * d, 1.8), 0.0, peak_db=-10)
    L.add(S.knock(r, 430 * d, 0.06, 5, 'wood'), 0.0, peak_db=-1)
    L.add(S.thump(0.22, 170 * d, 70, 0.02, 0.12, 1.8), 0.0, peak_db=-7)
    L.add(lp(pane(hz('A4') * d, 0.32, t60=0.16, bright=0.8, r=r), 6000), 0.003, peak_db=0)
    L.add(S.chips(r, 0.15, 6, 1500, 5000, 0.04, 0.08), 0.004, peak_db=-16)
    return _fin(room(L.out(), 'tiny', wet=0.08), hp_hz=55, eq=SOFT_TOP)


@cue('f_ardit_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ardit_a1(v: int):
    """Lancing Run: Ardit sets the pavise and charges — a low oak creak through the wind-up, two heavy footfalls on
    the frame drum, a rush of air rising behind the pane, which thrums D4 → A4 as it cuts the wind."""
    r = R('f_ardit_a1', v=v)
    d = detune(v, 20)
    t = timing('ardit', 'a1')[0]
    L = Layers(0.8)
    L.add(creak(r, max(t, 0.08), 300 * d, 0.012, 1.3), 0.0, peak_db=-10)
    L.add(drum('D2', 0.85, 'doum', seed=f'ar1{v}', dur=0.35, t60=0.2, rr=v), t, peak_db=-3)
    L.add(drum('D2', 0.7, 'doum', seed=f'ar1b{v}', dur=0.35, t60=0.2, rr=v + 1), t + 0.16, peak_db=-6)
    L.add(S.whoosh(r, 0.55, 300 * d, 1500 * d, q=1.1, peak_at=0.7, f_mid=1150 * d, low_body=0.5, rise=-1.6), t, peak_db=-2, width=0.6)
    L.add(bowed(hz('D4') * d, hz('A4') * d, 0.5, peak_at=0.75), t + 0.04, peak_db=-7)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=45, eq=SOFT_TOP)


@cue('f_ardit_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ardit_a2(v: int):
    """Glare: the pane tilts to catch the dawn — the glass bowed up D5 → A5 through the wind-up into a flash: a bright
    pane strike on the crest, an FM glint and a scatter of in-key sparkle (light, not heat)."""
    r = R('f_ardit_a2', v=v)
    d = detune(v, 20)
    t = max(timing('ardit', 'a2')[0], 0.1)
    L = Layers(t + 0.7)
    L.add(bowed(hz('D5') * d, hz('A5') * d, t + 0.02, peak_at=0.95), 0.0, peak_db=-6)
    L.add(breath(t + 0.02, 600, 3000, shape='swell', q=1.4, seed=f'ar2{v}', vel=0.7), 0.0, peak_db=-12, width=0.6)
    L.add(pane(hz('A5') * d, 0.6, t60=0.5, bright=0.8, r=r), t, peak_db=-1)
    L.add(fm_tone(hz('E6') * d, hz('A6') * d, 0.25, ratio=2.0, i0=2.0, i1=0.2, t60=0.2, curve=2.5), t, peak_db=-6)
    L.add(S.sparkle(r, 0.4, 9, 86, 100, t60=0.12, rise=True), t + 0.01, peak_db=-13)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=150, eq=SOFT_TOP)


@cue('f_ardit_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ardit_a3(v: int):
    """Spire Strike: the pavise's spire driven into the ground — a breath of effort lifting it, then a stone-and-oak
    thud with sub, the pane ringing A4 loud and long over it, turf and grit thrown up."""
    r = R('f_ardit_a3', v=v)
    d = detune(v, 25)
    t = timing('ardit', 'a3')[0]
    L = Layers(t + 0.8)
    ld = lead('ardit', 'a3', 400, 1200, f'ar3{v}')
    if ld is not None:
        L.add(ld, 0.0, peak_db=-12, width=0.5)
    L.add(S.snap(r, 2200 * d, 2.5), t, peak_db=-8)
    L.add(S.thump(0.4, 130 * d, 45, 0.03, 0.3, 2.2), t, peak_db=-1)
    L.add(S.knock(r, 200 * d, 0.1, 5, 'stone'), t, peak_db=-5)
    L.add(S.knock(r, 330 * d, 0.07, 4, 'wood'), t, peak_db=-8)
    L.add(pane(hz('A4') * d, 0.8, t60=0.55, bright=0.6, r=r), t + 0.004, peak_db=-5)
    L.add(crumble(r, 0.5, 10, 300, 1500, 0.12, 0.05), t + 0.02, peak_db=-14)
    return _fin(room(L.out(), 'stone', wet=0.1), hp_hz=40, eq=SOFT_TOP)


@cue('f_ardit_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_ardit_ult_windup(v: int):
    """Muster wind-up: the pavise raised as a beacon — the pane bowed from D5 up to A5, trembling and swelling, a
    soft frame-drum heartbeat under it (two beats), cresting on the release."""
    D = wind('ardit')
    L = Layers(D + 0.12)
    L.add(bowed(hz('D5'), hz('A5'), D + 0.04, peak_at=0.92, trem=7.0, depth=0.3), 0.0, peak_db=0)
    L.add(breath(D + 0.04, 900, 3600, shape='swell', q=1.5, seed='arw', curve=-2.0), 0.0, peak_db=-10, width=0.6)
    L.add(drum('D2', 0.7, 'doum', seed='arw', dur=0.3, t60=0.18), 0.0, peak_db=-12)
    L.add(drum('D2', 0.9, 'doum', seed='arw2', dur=0.3, t60=0.18, rr=1), D * 0.5, peak_db=-10)
    return _fin(L.out(), hp_hz=40, eq=CALM)


@cue('f_ardit_ult_release', 'combat', T_REL, RELW, **BGK)
def f_ardit_ult_release(v: int):
    """Muster: the beacon lit — his call struck big on the pane (D4, A4, D5 rising), a doum and an hourbell D3 under
    it, a warm A5 shimmer opening out over the hall."""
    r = R('f_ardit_ult_release', v=v)
    L = Layers(2.4)
    L.add(S.snap(r, 2400, 2.5), 0.0, peak_db=-10)
    L.add(drum('D2', 1.0, 'doum', seed='arr', dur=1.2, t60=0.6, kick=1.4), 0.0, peak_db=-8)
    L.add(S.thump(0.7, 110, 38, 0.04, 0.5, 2.2), 0.0, peak_db=-14)
    for i, (t, note, g) in enumerate(((0.0, 'D4', 0), (0.16, 'A4', -1), (0.32, 'D5', -2))):
        L.add(pane(hz(note), 1.8, t60=1.3, bright=0.9, r=R('f_ardit_ult_release', note)), t, peak_db=g, pan=(-0.15, 0.0, 0.15)[i])
    L.add(bell('D3', 2.2, 0.8, decay=0.3, bright=0.7, seed='arr'), 0.0, peak_db=-8)
    L.add(shimmer('A5', 1.6, 0.6, decay=1.0, index=2.5, seed='arr'), 0.3, peak_db=-12)
    L.add(breath(1.4, 2500, 500, shape='breath', q=1.2, seed='arr', peak_at=0.1, vel=0.6), 0.0, peak_db=-13, width=0.8)
    return _fin(room(L.out(), 'hall', wet=0.14), hp_hz=60, eq=CALM)


@cue('f_ardit_death', 'combat', T_DIE, DIEW, **BGK)
def f_ardit_death(v: int):
    """Ardit falls: the pane splits (a dull glass crack and a few bits), the pavise slaps flat on the ground (a broad
    oak board thud), its D4 ring choked under it, a breath going out."""
    r = R('f_ardit_death', v=v)
    L = Layers(1.6)
    L.add(S.snap(r, 2600, 2.0), 0.0, peak_db=-8)
    L.add(S.partials(hz('D5'), (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.08, 0.05, 0.03), 0.2, r), 0.0, peak_db=-6)
    L.add(S.shards(r, 0.5, 10, 1200, 5000, 0.08, 0.1, 0.3), 0.01, peak_db=-12)
    t = 0.2
    L.add(S.burst(r, 0.08, 150, 2500, 0.05, attack=0.002), t, peak_db=-6)
    L.add(S.knock(r, 140, 0.12, 5, 'wood'), t, peak_db=-2)
    L.add(S.thump(0.4, 120, 40, 0.03, 0.3, 2.0), t, peak_db=-3)
    L.add(lp(pane(hz('D4'), 1.2, t60=0.9, bright=0.4, r=r), 1500), t, peak_db=-9)
    L.add(breath(1.0, 1800, 250, shape='breath', q=1.5, seed='ard', peak_at=0.08, vel=0.7), 0.05, peak_db=-10, width=0.7)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=35, eq=CALM)


@cue('f_ardit_call', 'ui', T_CALL, CALLW, **CLK)
def f_ardit_call(v: int):
    """Ardit's call: the pane struck three times rising D4 → A4 → D5, a beacon raised (the lock-in; his ult strikes
    it big)."""
    L = Layers(1.6)
    for i, (t, note, g) in enumerate(((0.0, 'D4', -2), (0.16, 'A4', -1), (0.32, 'D5', 0))):
        L.add(pane(hz(note), 1.1, t60=0.85, bright=0.7, r=R('f_ardit_call', note)), t, peak_db=g, pan=(-0.15, 0.0, 0.15)[i])
    L.add(drum('D2', 0.6, 'doum', seed='arc', dur=0.5, t60=0.3), 0.0, peak_db=-10)
    return _fin(room(L.out(), 'plate', wet=0.14), hp_hz=60, eq=CALM)


# ══ Burdam, Grudge holder ════════════════════════════════════════════════════════════════════════
@cue('f_burdam_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_burdam_attack_swing(v: int):
    """Burdam's overhead chop: the cleaver grinding off his shoulder as it starts, then a long low pass of air (180 →
    420 Hz, late and heavy) with a sub push under it."""
    r = R('f_burdam_attack_swing', v=v)
    d = detune(v, 25)
    L = Layers(0.44)
    L.add(scrape(r, 0.12, 650 * d, 1.8, 50, 0.7, 0.3), 0.0, peak_db=-10)
    L.add(S.whoosh(r, 0.4, 180 * d, 300 * d, q=0.9, peak_at=0.55, f_mid=420 * d, low_body=1.0, rise=-1.6), 0.0, peak_db=0, width=0.4)
    L.add(woomf(0.38, 95 * d, 45, 0.2), 0.02, peak_db=-2)
    return _fin(L.out(), hp_hz=35, lp_hz=3000, eq=SOFT_TOP)


@cue('f_burdam_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_burdam_attack_hit(v: int):
    """The cleaver lands: an ironstone chop — a dark crack, a deep stone knock with sub and a crunch of grit flying;
    no ring (ironstone is dead and heavy)."""
    r = R('f_burdam_attack_hit', v=v)
    d = detune(v, 30)
    L = Layers(0.5)
    L.add(S.snap(r, 2500 * d, 3.0), 0.0, peak_db=-4)
    L.add(S.thump(0.34, 120 * d, 42, 0.03, 0.24, 2.4), 0.0, peak_db=0)
    L.add(S.knock(r, 150 * d, 0.09, 6, 'stone'), 0.0, peak_db=-4)
    L.add(crumble(r, 0.3, 10, 400, 2000, 0.06, 0.04), 0.006, peak_db=-5)
    L.add(S.chips(r, 0.25, 22, 1500, 6000, 0.05, 0.1), 0.004, peak_db=-6)
    return _fin(room(L.out(), 'stone', wet=0.07), hp_hz=35, lp_hz=9000, eq=SOFT_TOP)


@cue('f_burdam_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_burdam_a1(v: int):
    """Bear Down: he lunges — a heavy push-off (a low doum with sub), a long drag of the cleaver on stone and a low
    pass of air rising after him, the gong's A2 knot under it."""
    r = R('f_burdam_a1', v=v)
    d = detune(v, 20)
    t = timing('burdam', 'a1')[0]
    L = Layers(t + 0.7)
    L.add(drum('A1', 0.9, 'doum', seed=f'bu1{v}', dur=0.4, t60=0.22, kick=1.4, rr=v), t, peak_db=-2)
    L.add(S.whoosh(r, 0.55, 160 * d, 700 * d, q=1.0, peak_at=0.75, f_mid=520 * d, low_body=0.8, rise=-1.4), t, peak_db=-2, width=0.5)
    L.add(scrape(r, 0.5, 400 * d, 2.0, 30, 0.8, 0.7), t + 0.05, peak_db=-8)
    L.add(hollow(hz('A2') * d, 0.5, 0.3, r, odd=3), t, peak_db=-12)
    return _fin(room(L.out(), 'stone', wet=0.08), hp_hz=35, eq=SOFT_TOP)


@cue('f_burdam_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_burdam_a2(v: int):
    """Stubborn: Burdam sets himself like a boundary stone — two deep stone knocks settling (the second lower), his
    lacquered mask creaking tight, the gong's D3 hum held under it."""
    r = R('f_burdam_a2', v=v)
    d = detune(v, 20)
    L = Layers(0.95)
    L.add(S.knock(r, 180 * d, 0.1, 5, 'stone'), 0.0, peak_db=-2)
    L.add(S.thump(0.3, 110, 50, 0.03, 0.2, 1.8), 0.0, peak_db=-5)
    L.add(S.knock(r, 120 * d, 0.12, 5, 'stone'), 0.11, peak_db=-1)
    L.add(S.thump(0.3, 90, 40, 0.03, 0.22, 1.8), 0.11, peak_db=-5)
    L.add(creak(r, 0.22, 1100 * d, 0.01, 1.15), 0.05, peak_db=-11)
    L.add(hollow(hz('D3') * d, 0.8, 0.6, r, odd=4), 0.11, peak_db=-7)
    return _fin(room(L.out(), 'stone', wet=0.1), hp_hz=40, lp_hz=8000, eq=SOFT_TOP)


@cue('f_burdam_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_burdam_a3(v: int):
    """Old Wound: a wide cleave — a broad slow pass of air (220 → 700 → 300 Hz) with the cleaver's grind dragging
    behind it the whole way, an old ache (a low hollow A2 knot) under the arc."""
    r = R('f_burdam_a3', v=v)
    d = detune(v, 20)
    t = timing('burdam', 'a3')[0]
    L = Layers(t + 0.7)
    ld = lead('burdam', 'a3', 200, 600, f'bu3{v}', q=2.4)
    if ld is not None:
        L.add(ld, 0.0, peak_db=-10, width=0.4)
    L.add(S.whoosh(r, 0.55, 220 * d, 300 * d, q=0.9, peak_at=0.45, f_mid=700 * d, low_body=0.9, rise=-1.3), t, peak_db=0, width=0.7)
    L.add(scrape(r, 0.6, 520 * d, 1.6, 22, 0.8, 0.5), t + 0.03, peak_db=-7)
    L.add(hollow(hz('A2') * d, 0.6, 0.45, r, odd=3), t + 0.12, peak_db=-9)
    return _fin(room(L.out(), 'stone', wet=0.08), hp_hz=35, eq=SOFT_TOP)


@cue('f_burdam_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_burdam_ult_windup(v: int):
    """Settled Account wind-up: the tally read out — three chisel knocks on ironstone coming faster, a grind rising
    under them (every grudge pulled taut) and the gong drawn in backwards, cresting on the release."""
    r = R('f_burdam_ult_windup', v=v)
    D = wind('burdam')
    L = Layers(D + 0.1)
    for i, t in enumerate((0.0, D * 0.42, D * 0.72)):
        L.add(S.knock(r, 520 * (1 + 0.08 * i), 0.05, 4, 'stone'), t, peak_db=-5 + i)
        L.add(S.snap(r, 3000, 1.2), t, peak_db=-13)
    L.add(S.am(breath(D, 140, 600, shape='swell', q=2.6, seed='buw'), 28.0, 0.7), 0.0, peak_db=-4, width=0.4)
    L.add(swell_into(iron_gong(hz('A2'), 0.8, r), D), 0.0, peak_db=-2)
    return _fin(L.out(), hp_hz=35, lp_hz=2500, eq=CALM)


@cue('f_burdam_ult_release', 'combat', T_REL, RELW, **BGK)
def f_burdam_ult_release(v: int):
    """Settled Account: the debt called in — a huge ironstone slam (a dark crack, sub, a stone knock), the gong
    struck A2 then D3 (his call) and grit raining down over a long rumble."""
    r = R('f_burdam_ult_release', v=v)
    L = Layers(2.4)
    L.add(S.snap(r, 1600, 4.0), 0.0, peak_db=-8)
    L.add(S.thump(0.8, 100, 32, 0.04, 0.6, 2.6), 0.0, peak_db=0)
    L.add(S.knock(r, 120, 0.16, 6, 'stone'), 0.0, peak_db=-3)
    L.add(drum('A1', 1.0, 'doum', seed='bur', dur=1.0, t60=0.5, kick=1.6), 0.0, peak_db=-5)
    L.add(iron_gong(hz('A2'), 2.0, R('f_burdam_ult_release', 'a2')), 0.0, peak_db=-2)
    L.add(iron_gong(hz('D3'), 1.8, R('f_burdam_ult_release', 'd3')), 0.24, peak_db=-2)
    L.add(crumble(r, 1.4, 30, 300, 1800, 0.3), 0.04, peak_db=-4)
    L.add(S.rumble(r, 2.0, 100, 1.3, 0.02, rough=0.5), 0.0, peak_db=-6)
    L.add(S.chips(r, 1.2, 60, 1500, 6000, 0.3, 0.5), 0.05, peak_db=-6)
    return _fin(room(L.out(), 'hall', wet=0.12), hp_hz=28, eq=CALM)


@cue('f_burdam_death', 'combat', T_DIE, DIEW, **BGK)
def f_burdam_death(v: int):
    """Burdam falls: the cleaver drops — a heavy ironstone slab striking the ground, sliding and settling with a
    second, smaller knock, the gong's A2 knot fading; the grudge let go in a long breath out."""
    r = R('f_burdam_death', v=v)
    L = Layers(1.8)
    L.add(S.thump(0.5, 110, 35, 0.04, 0.35, 2.4), 0.0, peak_db=-1)
    L.add(S.knock(r, 160, 0.12, 6, 'stone'), 0.0, peak_db=-3)
    L.add(S.snap(r, 1500, 3.0), 0.0, peak_db=-10)
    L.add(scrape(r, 0.4, 500, 1.6, 30, 0.7, 0.3), 0.08, peak_db=-9)
    L.add(S.knock(r, 220, 0.08, 5, 'stone'), 0.48, peak_db=-7)
    L.add(iron_gong(hz('A2'), 1.4, r), 0.0, peak_db=-8)
    L.add(breath(1.2, 1200, 200, shape='breath', q=1.4, seed='bud', peak_at=0.15, vel=0.7), 0.1, peak_db=-10, width=0.6)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=30, eq=CALM)


@cue('f_burdam_call', 'ui', T_CALL, CALLW, **CLK)
def f_burdam_call(v: int):
    """Burdam's call: the ironstone gong struck twice, A2 then D3 — a debt counted — over a soft doum."""
    L = Layers(1.8)
    L.add(drum('A1', 0.6, 'doum', seed='buc', dur=0.6, t60=0.35), 0.0, peak_db=-8)
    L.add(iron_gong(hz('A2'), 1.2, R('f_burdam_call', 'a')), 0.0, peak_db=-1)
    L.add(iron_gong(hz('D3'), 1.4, R('f_burdam_call', 'd')), 0.22, peak_db=0)
    return _fin(room(L.out(), 'plate', wet=0.12), hp_hz=45, eq=CALM)


# ══ Dunsom, Dusk herder ══════════════════════════════════════════════════════════════════════════
@cue('f_dunsom_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_dunsom_attack_swing(v: int):
    """Dunsom sends a mote of dusk off the crook: a knock in the crook's hook, the lantern clinking, and a narrow
    dusk breath falling 3.4 kHz → 1.1 kHz as the mote leaves (a sigh, not a blade's air)."""
    r = R('f_dunsom_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.34)
    L.add(S.knock(r, 520 * d, 0.03, 4, 'wood'), 0.0, peak_db=-8)
    L.add(tink(hz('G6') * d, 0.08, 0.05, 0.2), 0.01, peak_db=-14)
    L.add(breath(0.3, 3400 * d, 1100, shape='breath', q=3.2, seed=f'dus{v}', peak_at=0.06), 0.02, peak_db=0, width=0.5)
    return _fin(room(L.out(), 'tiny', wet=0.08), hp_hz=90, lp_hz=9000, eq=SOFT_TOP)


@cue('f_dunsom_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_dunsom_attack_hit(v: int):
    """The mote lands: a soft hollow clonk (the herd bell's wood at A3 — a nudge, not a blade), a puff of ink and a
    dull body knock."""
    r = R('f_dunsom_attack_hit', v=v)
    d = detune(v, 30)
    L = Layers(0.45)
    L.add(clonk(hz('A3') * d, 0.4, 0.2, r), 0.0, peak_db=0)
    L.add(S.thump(0.18, 190 * d, 90, 0.015, 0.1, 1.6), 0.0, peak_db=-4)
    L.add(ink(r, 0.3, 6, 160, 420, 0.05, wash=0.3, wash_hz=350), 0.01, peak_db=-6)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=70, lp_hz=2200, eq=SOFT_TOP)


@cue('f_dunsom_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_dunsom_a1(v: int):
    """Draw In: the dusk breathes in — a long breath sucked toward the point through the wind-up and the pull's delay,
    landing on the herd bell's D4 clonk with a low hollow under it as they are drawn."""
    r = R('f_dunsom_a1', v=v)
    d = detune(v, 20)
    ct, dl = timing('dunsom', 'a1')
    t = ct + dl
    L = Layers(t + 0.6)
    L.add(breath(t + 0.02, 2600, 380, shape='swell', q=2.0, seed=f'du1{v}', curve=-2.2), 0.0, peak_db=-1, width=0.8)
    L.add(clonk(hz('D4') * d, 0.3, 0.15, r), 0.0, peak_db=-9)
    L.add(clonk(hz('D4') * d, 0.55, 0.3, r), t, peak_db=-2)
    L.add(hollow(hz('D3') * d, 0.5, 0.4, r, odd=3), t, peak_db=-8)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=60, lp_hz=8500, eq=SOFT_TOP)


@cue('f_dunsom_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_dunsom_a2(v: int):
    """Crook Sweep: a wave of dusk swept along the ground — the crook's long low swing, a broad dusty pass of air
    (300 → 900 → 400 Hz) with grit hissing in it and the lantern swinging (two clinks)."""
    r = R('f_dunsom_a2', v=v)
    d = detune(v, 20)
    t = timing('dunsom', 'a2')[0]
    L = Layers(t + 0.75)
    ld = lead('dunsom', 'a2', 300, 900, f'du2l{v}')
    if ld is not None:
        L.add(ld, 0.0, peak_db=-11, width=0.6)
    L.add(S.whoosh(r, 0.65, 300 * d, 400 * d, q=0.9, peak_at=0.4, f_mid=900 * d, low_body=0.6), t, peak_db=0, width=0.8)
    L.add(S.chips(r, 0.55, 30, 1500, 6000, 0.25, 0.4), t + 0.08, peak_db=-12)
    L.add(breath(0.6, 1400, 300, shape='breath', q=1.6, seed=f'du2{v}', peak_at=0.25), t + 0.05, peak_db=-6, width=0.7)
    L.add(tink(hz('G6') * d, 0.08, 0.05, 0.2), t + 0.12, peak_db=-16)
    L.add(tink(hz('E6') * d, 0.08, 0.05, 0.2), t + 0.3, peak_db=-18)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=60, eq=SOFT_TOP)


@cue('f_dunsom_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_dunsom_a3(v: int):
    """Step Through Dusk: he steps into the dusk and out of it — a short breath drawn in, a soft hollow 'fwump' as he
    goes and the herd bell's clonk, muffled, where he lands, ink settling."""
    r = R('f_dunsom_a3', v=v)
    d = detune(v, 20)
    L = Layers(0.65)
    L.add(breath(0.18, 600, 2400, shape='swell', q=2.2, seed=f'du3{v}'), 0.0, peak_db=-2, width=0.6)
    L.add(hollow(hz('F3') * d, 0.3, 0.2, r, odd=3), 0.18, peak_db=-3)
    L.add(S.thump(0.2, 160, 70, 0.02, 0.12, 1.4), 0.18, peak_db=-6)
    L.add(lp(clonk(hz('A3') * d, 0.4, 0.25, r), 1800), 0.2, peak_db=-8)
    L.add(ink(r, 0.3, 5, 180, 500, 0.06, wash=0.2), 0.2, peak_db=-11)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=60, lp_hz=8000, eq=SOFT_TOP)


@cue('f_dunsom_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_dunsom_ult_windup(v: int):
    """Driving Hour wind-up: the herder's call — the bell clonks D4 then F4, faster, over a wind whistling up out of
    the dusk (a narrow breath rising 900 Hz → 3.8 kHz) and a faint drum roll, cresting on the release."""
    r = R('f_dunsom_ult_windup', v=v)
    D = wind('dunsom')
    L = Layers(D + 0.1)
    L.add(breath(D, 900, 3800, shape='swell', q=2.4, seed='duw', curve=-2.0), 0.0, peak_db=-1, width=0.8)
    L.add(clonk(hz('D4'), 0.3, 0.15, r), 0.0, peak_db=-4)
    L.add(clonk(hz('F4'), 0.3, 0.15, r), D * 0.55, peak_db=-3)
    L.add(roll('D2', D, 10, 26, 0.2, 0.7, seed='duw'), 0.0, peak_db=-16)
    return _fin(L.out(), hp_hz=40, eq=CALM)


@cue('f_dunsom_ult_release', 'combat', T_REL, RELW, **BGK)
def f_dunsom_ult_release(v: int):
    """Driving Hour: the herd driven — a rushing gust hurling them (a high pass of wind), the herd bell rung F4 D4
    A3 (his call) as they fly, and where they land, after the eruption's delay, a hollow D3 boom of dusk with ink
    and a root's thud."""
    r = R('f_dunsom_ult_release', v=v)
    dl = max(timing('dunsom', 'ult')[1], 0.3)
    L = Layers(dl + 1.6)
    L.add(S.whoosh(r, 0.8, 2000, 2800, q=1.4, peak_at=0.25, f_mid=4600), 0.0, peak_db=0, width=0.9)
    for t, note, g in ((0.04, 'F4', -1), (0.2, 'D4', -1), (0.36, 'A3', 0)):
        L.add(clonk(hz(note), 0.7, 0.45, R('f_dunsom_ult_release', note)), t, peak_db=g)
    L.add(S.thump(0.7, 160, 60, 0.04, 0.5, 2.0), dl, peak_db=-12)
    L.add(hollow(hz('D3'), 1.2, 0.9, r, odd=4), dl, peak_db=-4)
    L.add(ink(r, 0.8, 14, 200, 700, 0.12, wash=0.3), dl + 0.01, peak_db=-8)
    L.add(breath(1.0, 3000, 900, shape='breath', q=2.0, seed='dur', peak_at=0.05), dl, peak_db=-4, width=0.8)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=120, eq=CALM)


@cue('f_dunsom_death', 'combat', T_DIE, DIEW, **BGK)
def f_dunsom_death(v: int):
    """Dunsom falls: the lantern hits the ground (a small glass clink, its flame snuffed in a soft puff), the crook
    clatters down in two wooden knocks and the dusk sighs out into a low bell."""
    r = R('f_dunsom_death', v=v)
    L = Layers(1.6)
    L.add(tink(hz('E6'), 0.15, 0.1, 0.4), 0.0, peak_db=-6)
    L.add(S.knock(r, 900, 0.03, 4, 'clay'), 0.0, peak_db=-8)
    L.add(breath(0.25, 1500, 400, shape='breath', q=1.0, seed='dup', peak_at=0.01), 0.03, peak_db=-6, width=0.4)
    L.add(S.knock(r, 380, 0.07, 5, 'wood'), 0.16, peak_db=-3)
    L.add(S.thump(0.3, 130, 50, 0.02, 0.2, 1.6), 0.16, peak_db=-6)
    L.add(S.knock(r, 300, 0.08, 5, 'wood'), 0.31, peak_db=-6)
    L.add(breath(1.1, 2000, 250, shape='breath', q=1.6, seed='dud', peak_at=0.1, vel=0.7), 0.1, peak_db=-8, width=0.8)
    L.add(clonk(hz('A3'), 1.0, 0.7, r), 0.32, peak_db=-8)
    return _fin(room(L.out(), 'small', wet=0.14), hp_hz=40, lp_hz=8000, eq=CALM)


@cue('f_dunsom_call', 'ui', T_CALL, CALLW, **CLK)
def f_dunsom_call(v: int):
    """Dunsom's call: the carved herd bell rung three times falling F4 → D4 → A3, a breath of dusk under it."""
    L = Layers(1.6)
    for i, (t, note, g) in enumerate(((0.0, 'F4', -1), (0.17, 'D4', -1), (0.34, 'A3', 0))):
        L.add(clonk(hz(note), 0.8, 0.5, R('f_dunsom_call', note)), t, peak_db=g, pan=(0.15, 0.0, -0.15)[i])
    L.add(breath(0.8, 1600, 300, shape='breath', q=1.6, seed='duc', peak_at=0.1, vel=0.6), 0.0, peak_db=-14, width=0.6)
    return _fin(room(L.out(), 'wood', wet=0.14), hp_hz=80, eq=CALM)


# ══ Ervet, Glass blade ═══════════════════════════════════════════════════════════════════════════
@cue('f_ervet_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_ervet_attack_swing(v: int):
    """Ervet's greatsword swing: the dawnglass blade singing through the air (a glass tone gliding E5 → A5 on its
    bowl partials), only a thin edge of air around it."""
    r = R('f_ervet_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.34)
    L.add(S.whoosh(r, 0.28, 1500 * d, 2000 * d, q=1.8, peak_at=0.45, f_mid=2600 * d, rise=-1.3), 0.0, peak_db=-10, width=0.5)
    L.add(bowed(hz('E5') * d, hz('A5') * d, 0.26, ratios=GLASS3, amps=(1.0, 0.45, 0.18), peak_at=0.5, depth=0.0), 0.0, peak_db=0)
    return _fin(L.out(), hp_hz=120, eq=SOFT_TOP)


@cue('f_ervet_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_ervet_attack_hit(v: int):
    """The glass edge bites: a bright slicing 'tching' (a very short 3-9 kHz cut and an E6 glass ping with its
    partials), a light body knock and a couple of glints."""
    r = R('f_ervet_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.42)
    L.add(S.burst(r, 0.03, 3000, 9000, 0.012), 0.0, peak_db=-7)
    L.add(S.glass_ping(hz('E6') * d, 0.35, 0.2, 0.9, r), 0.0, peak_db=0)
    L.add(S.glass_ping(hz('B5') * d, 0.3, 0.15, 0.6, r), 0.002, peak_db=-6)
    L.add(S.thump(0.2, 200 * d, 90, 0.015, 0.1, 1.6), 0.0, peak_db=-13)
    L.add(S.knock(r, 360 * d, 0.05, 4, 'stone'), 0.0, peak_db=-14)
    L.add(S.shards(r, 0.2, 4, 3000, 8000, 0.03, 0.08, 0.15), 0.01, peak_db=-14)
    return _fin(room(L.out(), 'glass', wet=0.08), hp_hz=80, eq=SOFT_TOP)


@cue('f_ervet_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ervet_a1(v: int):
    """Heavy Arc: the whole blade swept wide — drawn back through the wind-up (a breath rising), then a long broad pass
    of air with the glass singing E5 up to B5, a shimmer trailing off the edge."""
    r = R('f_ervet_a1', v=v)
    d = detune(v, 20)
    t = timing('ervet', 'a1')[0]
    L = Layers(t + 0.8)
    ld = lead('ervet', 'a1', 600, 1800, f'er1l{v}')
    if ld is not None:
        L.add(ld, 0.0, peak_db=-10, width=0.5)
    L.add(S.whoosh(r, 0.55, 300 * d, 500 * d, q=1.0, peak_at=0.5, f_mid=1100 * d, low_body=0.6), t, peak_db=-2, width=0.8)
    L.add(bowed(hz('E5') * d, hz('B5') * d, 0.55, ratios=GLASS3, amps=(1.0, 0.45, 0.2), peak_at=0.55, trem=6.0, depth=0.1), t, peak_db=-4)
    L.add(shimmer('B5', 0.5, 0.5, decay=0.4, index=2.0, seed=f'er1{v}'), t + 0.3, peak_db=-12)
    return _fin(room(L.out(), 'glass', wet=0.1), hp_hz=90, eq=SOFT_TOP)


@cue('f_ervet_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ervet_a2(v: int):
    """Glass Guard: she plants the blade and braces behind it — a hard glass clack, then the blade ringing as a wall
    (E5 and B5 bowed together, swelling and holding), a shimmer over it."""
    r = R('f_ervet_a2', v=v)
    d = detune(v, 20)
    t = timing('ervet', 'a2')[0]
    L = Layers(t + 0.95)
    L.add(S.knock(r, 900 * d, 0.04, 4, 'stone'), t, peak_db=-4)
    L.add(S.glass_ping(hz('E5') * d, 0.6, 0.45, 0.7, r), t, peak_db=-3)
    L.add(bowed(hz('E5') * d, hz('E5') * d, 0.8, ratios=GLASS3, amps=(1.0, 0.4, 0.15), peak_at=0.35, trem=4.5, depth=0.2), t + 0.03, peak_db=-5)
    L.add(bowed(hz('B5') * d, hz('B5') * d, 0.8, ratios=GLASS3, amps=(1.0, 0.4, 0.15), peak_at=0.4, trem=5.3, depth=0.2), t + 0.03, peak_db=-8)
    L.add(shimmer('E6', 0.6, 0.4, decay=0.4, seed=f'er2{v}'), t + 0.05, peak_db=-14)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=150, eq=SOFT_TOP)


@cue('f_ervet_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ervet_a3(v: int):
    """Shatter: the blade smashed into the ground — raised through the wind-up, then a slam (sub and stone), a big
    glass crack and the blade bursting into a long cascade of shards, the hilt's short ring left in her hands."""
    r = R('f_ervet_a3', v=v)
    d = detune(v, 20)
    t = timing('ervet', 'a3')[0]
    L = Layers(t + 1.1)
    ld = lead('ervet', 'a3', 500, 2400, f'er3l{v}')
    if ld is not None:
        L.add(ld, 0.0, peak_db=-10, width=0.5)
    L.add(S.snap(r, 3600, 2.5), t, peak_db=-6)
    L.add(S.thump(0.4, 140, 45, 0.03, 0.3, 2.2), t, peak_db=-2)
    L.add(S.knock(r, 240, 0.08, 5, 'stone'), t, peak_db=-6)
    L.add(S.partials(hz('E5') * d, (1.0, 2.76, 5.4), (1.0, 0.5, 0.25), (0.06, 0.04, 0.02), 0.15, r), t, peak_db=-4)
    L.add(S.shards(r, 1.0, 45, 1800, 9500, 0.12, 0.1, 0.45), t + 0.005, peak_db=-1, width=0.9)
    L.add(S.glass_ping(hz('E6') * d, 0.4, 0.25, 0.6, r), t + 0.35, peak_db=-12)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=60, eq=SOFT_TOP)


@cue('f_ervet_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_ervet_ult_windup(v: int):
    """Whole Again wind-up: the shards called home — a shatter played backwards, rushing in and converging on the
    release, an FM glint rising A5 → E6 with it."""
    r = R('f_ervet_ult_windup', v=v)
    D = wind('ervet')
    L = Layers(D + 0.1)
    sh = S.shards(r, 0.8, 40, 1800, 9000, 0.1, 0.1, 0.4)
    L.add(rev(at_len(sh, D, 0.002), 0.03), 0.0, peak_db=-1)
    L.add(fm_tone(hz('A5'), hz('E6'), D, ratio=2.32, i0=0.5, i1=2.0, env='swell'), 0.0, peak_db=-6)
    L.add(breath(D, 800, 4000, shape='swell', q=1.6, seed='erw'), 0.0, peak_db=-10, width=0.7)
    return _fin(L.out(), hp_hz=100, eq=CALM)


@cue('f_ervet_ult_release', 'combat', T_REL, RELW, **BGK)
def f_ervet_ult_release(v: int):
    """Whole Again: the blade whole again as she lands — a heavy landing (sub, stone), the glass reformed in one
    crystalline chord (E5 B5 E6 struck together), her call rung on it (E6 B5 E6) and the lodged shards ticking."""
    r = R('f_ervet_ult_release', v=v)
    L = Layers(2.4)
    L.add(S.snap(r, 3000, 2.5), 0.0, peak_db=-8)
    L.add(S.thump(0.6, 120, 36, 0.035, 0.45, 2.4), 0.0, peak_db=-1)
    L.add(S.knock(r, 200, 0.12, 5, 'stone'), 0.0, peak_db=-5)
    for i, (note, g) in enumerate((('E5', -2), ('B5', -4), ('E6', -6))):
        L.add(glass(note, 2.0, 0.9, decay=0.6, bright=0.9, seed=f'err{i}'), 0.003 * i, peak_db=g)
    for t, note, g in ((0.3, 'E6', -7), (0.45, 'B5', -8), (0.6, 'E6', -9)):
        L.add(glass(note, 0.9, 0.7, decay=0.35, bright=0.7, seed=f'errc{note}{t}'), t, peak_db=g)
    L.add(S.shards(r, 1.0, 40, 2500, 9500, 0.2, 0.08, 0.25), 0.0, peak_db=-4, width=0.8)
    return _fin(room(L.out(), 'hall', wet=0.13), hp_hz=40, eq=CALM)


@cue('f_ervet_death', 'combat', T_DIE, DIEW, **BGK)
def f_ervet_death(v: int):
    """Ervet falls: the blade breaks for good — a crack, the shards falling and skittering away, the last of the
    blade's ring bending down B5 → E5 and dying, a body knock under it."""
    r = R('f_ervet_death', v=v)
    L = Layers(1.8)
    L.add(S.snap(r, 3400, 2.0), 0.0, peak_db=-8)
    L.add(S.thump(0.35, 130, 45, 0.025, 0.25, 2.0), 0.0, peak_db=-4)
    L.add(S.shards(r, 1.3, 40, 1500, 9000, 0.25, 0.12, 0.5), 0.0, peak_db=-2, width=0.8)
    n = ns(1.2)
    ring = (O.sine(np.geomspace(hz('B5'), hz('E5'), n), n) * E.decay(n, 1.0, 0.003)
            + 0.3 * O.sine(np.geomspace(hz('B5') * 2.32, hz('E5') * 2.32, n), n) * E.decay(n, 0.5, 0.003))
    L.add(ring, 0.02, peak_db=-6)
    L.add(breath(1.0, 2600, 300, shape='breath', q=1.5, seed='erd', peak_at=0.06, vel=0.7), 0.05, peak_db=-10, width=0.7)
    return _fin(room(L.out(), 'glass', wet=0.14), hp_hz=50, eq=CALM)


@cue('f_ervet_call', 'ui', T_CALL, CALLW, **CLK)
def f_ervet_call(v: int):
    """Ervet's call: the singing glass struck E6, B5, E6, each left humming (a bowed partial under the strike)."""
    L = Layers(1.6)
    for i, (t, note, g) in enumerate(((0.0, 'E6', -1), (0.15, 'B5', -1), (0.3, 'E6', 0))):
        L.add(glass(note, 1.0, 0.8, decay=0.5, bright=0.8, seed=f'erc{i}'), t, peak_db=g, pan=(-0.12, 0.12, 0.0)[i])
        L.add(bowed(hz(note), hz(note), 0.7, ratios=GLASS3, amps=(1.0, 0.3, 0.1), peak_at=0.2, trem=5.0, depth=0.2), t, peak_db=g - 10)
    return _fin(room(L.out(), 'glass', wet=0.14), hp_hz=200, eq=CALM)


# ══ Hesmi, Shard bearer ══════════════════════════════════════════════════════════════════════════
@cue('f_hesmi_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_hesmi_attack_swing(v: int):
    """Hesmi's stone fist: a short, low huff of air (gone in 200 ms), a sub push, the gauntlet's stone plates knocking
    together as the arm goes and a breath of shade off the shards on her back."""
    r = R('f_hesmi_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.26)
    L.add(S.whoosh(r, 0.2, 200 * d, 260 * d, q=0.8, peak_at=0.35, f_mid=520 * d, low_body=0.9, rise=-1.2), 0.0, peak_db=-4, width=0.3)
    L.add(woomf(0.2, 110 * d, 60, 0.07), 0.0, peak_db=-8)
    L.add(S.knock(r, 1150 * d, 0.03, 4, 'stone'), 0.0, peak_db=-2)
    L.add(S.knock(r, 1500 * d, 0.025, 3, 'stone'), 0.018, peak_db=-4)
    L.add(breath(0.2, 1800 * d, 700, shape='breath', q=2.0, seed=f'hes{v}', peak_at=0.04), 0.0, peak_db=-5, width=0.4)
    return _fin(L.out(), hp_hz=45, lp_hz=7000, eq=SOFT_TOP)


@cue('f_hesmi_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_hesmi_attack_hit(v: int):
    """The stone fist lands: a dull, dead punch (a deep thud with sub, no ring, nothing bright), a low clay knock of
    stone on bone and the shade she feeds on welling up dark (low ink)."""
    r = R('f_hesmi_attack_hit', v=v)
    d = detune(v, 30)
    L = Layers(0.4)
    L.add(S.thump(0.3, 105 * d, 38, 0.025, 0.2, 2.6), 0.0, peak_db=0)
    L.add(S.knock(r, 260 * d, 0.05, 5, 'clay'), 0.0, peak_db=-3)
    L.add(ink(r, 0.3, 8, 160, 480, 0.04, wash=0.5, wash_hz=500), 0.01, peak_db=-4)
    return _fin(room(L.out(), 'tiny', wet=0.06), hp_hz=30, lp_hz=1800, eq=SOFT_TOP)


@cue('f_hesmi_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_hesmi_a1(v: int):
    """Plant Shard: a shard of the fallen needle driven into the ground — lifted through the wind-up, then a stake's
    heavy impact, the shard ringing dark (a D3 stone bar) and its shadow spilling out (a shade breath falling)."""
    r = R('f_hesmi_a1', v=v)
    d = detune(v, 20)
    t = timing('hesmi', 'a1')[0]
    L = Layers(t + 1.0)
    ld = lead('hesmi', 'a1', 300, 1000, f'he1l{v}')
    if ld is not None:
        L.add(ld, 0.0, peak_db=-11, width=0.5)
    L.add(S.snap(r, 2000 * d, 2.5), t, peak_db=-8)
    L.add(S.thump(0.35, 140 * d, 50, 0.03, 0.25, 2.0), t, peak_db=-2)
    L.add(S.knock(r, 300 * d, 0.08, 5, 'stone'), t, peak_db=-4)
    L.add(litho(hz('D3') * d, 0.9, 0.7, r), t + 0.003, peak_db=-3)
    L.add(breath(0.8, 1500, 300, shape='breath', q=1.8, seed=f'he1{v}', peak_at=0.12, vel=0.7), t + 0.05, peak_db=-8, width=0.8)
    return _fin(room(L.out(), 'stone', wet=0.1), hp_hz=40, eq=SOFT_TOP)


@cue('f_hesmi_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_hesmi_a2(v: int):
    """Shoulder the Stone: she lowers a shoulder and goes — a heavy push-off, a low rushing grind of stone (her whole
    weight moving) and the shards on her back rattling."""
    r = R('f_hesmi_a2', v=v)
    d = detune(v, 20)
    t = timing('hesmi', 'a2')[0]
    L = Layers(t + 0.7)
    L.add(drum('A1', 0.9, 'doum', seed=f'he2{v}', dur=0.35, t60=0.2, kick=1.5, rr=v), t, peak_db=-2)
    L.add(S.whoosh(r, 0.5, 150 * d, 300 * d, q=0.8, peak_at=0.4, f_mid=500 * d, low_body=1.0), t, peak_db=-1, width=0.6)
    L.add(scrape(r, 0.45, 330 * d, 1.6, 25, 0.8, 0.4), t + 0.03, peak_db=-8)
    L.add(S.chips(r, 0.4, 14, 900, 3500, 0.15, 0.3), t + 0.05, peak_db=-12)
    return _fin(room(L.out(), 'stone', wet=0.08), hp_hz=35, eq=SOFT_TOP)


@cue('f_hesmi_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_hesmi_a3(v: int):
    """Stand Firm: she sets her stance — the gauntlets struck together twice (stone on stone), the A2 bar humming in
    her and a slow bubble of shade gathering round her."""
    r = R('f_hesmi_a3', v=v)
    d = detune(v, 20)
    L = Layers(0.95)
    L.add(S.knock(r, 520 * d, 0.06, 5, 'stone'), 0.0, peak_db=-2)
    L.add(S.snap(r, 2400, 2.0), 0.0, peak_db=-10)
    L.add(S.knock(r, 470 * d, 0.07, 5, 'stone'), 0.08, peak_db=-1)
    L.add(S.thump(0.3, 120, 50, 0.025, 0.2, 2.0), 0.08, peak_db=-6)
    L.add(litho(hz('A2') * d, 0.8, 0.6, r, dark=1800), 0.08, peak_db=-6)
    L.add(ink(r, 0.6, 10, 120, 450, 0.15, wash=0.35), 0.12, peak_db=-10)
    return _fin(room(L.out(), 'stone', wet=0.1), hp_hz=40, eq=SOFT_TOP)


@cue('f_hesmi_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_hesmi_ult_windup(v: int):
    """Felled Shard wind-up: the great shard above them begins to give — stone creaking and cracking (stick-slip
    grinding, two cracks), the D3 bar drawn in backwards, shade gathering, cresting on the release."""
    r = R('f_hesmi_ult_windup', v=v)
    D = wind('hesmi')
    L = Layers(D + 0.1)
    L.add(scrape(r, D, 1100, 4.0, 18, 0.9, 0.85), 0.0, peak_db=-4)
    L.add(S.snap(r, 2600, 2.0), D * 0.35, peak_db=-8)
    L.add(S.snap(r, 2200, 2.0), D * 0.7, peak_db=-6)
    L.add(swell_into(litho(hz('D3'), 0.8, 0.6, r), D), 0.0, peak_db=-3)
    L.add(breath(D, 250, 1200, shape='swell', q=2.0, seed='hew'), 0.0, peak_db=-9, width=0.7)
    return _fin(L.out(), hp_hz=40, eq=CALM)


@cue('f_hesmi_ult_release', 'combat', T_REL, RELW, **BGK)
def f_hesmi_ult_release(v: int):
    """Felled Shard: the great shard falls — a long falling rush of air (its shadow whistling down) and, where the sim
    lands it after the delay, a colossal stone impact: a crack, sub, a deep knock, the bar struck D3 then A2 (her
    call), rubble raining and ink spilling."""
    r = R('f_hesmi_ult_release', v=v)
    dl = max(timing('hesmi', 'ult')[1], 0.3)
    L = Layers(dl + 1.8)
    L.add(breath(dl + 0.02, 2600, 380, shape='swell', q=2.6, seed='her', curve=-1.6, sweep_curve=0.7), 0.0, peak_db=-2, width=0.6)
    n = ns(dl)
    fall = whistle(hz('A5'), hz('D4'), dl, r, vib_hz=0.0, cents=0.0, air=0.4, curve=-1.0, env='decay')
    L.add(fall * E.swell(n, dl * 0.97, -2.0, release=dl * 0.03)[:fall.size], 0.0, peak_db=-3)
    L.add(S.snap(r, 1800, 4.0), dl, peak_db=-6)
    L.add(S.thump(0.9, 95, 30, 0.045, 0.7, 2.8), dl, peak_db=0)
    L.add(S.knock(r, 130, 0.18, 6, 'stone'), dl, peak_db=-3)
    L.add(litho(hz('D3'), 1.4, 1.0, R('f_hesmi_ult_release', 'd3')), dl, peak_db=-4)
    L.add(litho(hz('A2'), 1.4, 1.0, R('f_hesmi_ult_release', 'a2')), dl + 0.22, peak_db=-4)
    L.add(crumble(r, 1.2, 30, 120, 700, 0.3), dl + 0.03, peak_db=-8)
    L.add(ink(r, 0.8, 12, 120, 500, 0.15, wash=0.4), dl + 0.1, peak_db=-6)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=28, lp_hz=5000, eq=CALM)


@cue('f_hesmi_death', 'combat', T_DIE, DIEW, **BGK)
def f_hesmi_death(v: int):
    """Hesmi falls: the shards on her back topple and break — stone cracking, a cascade of rubble, her dead weight
    landing (a dull thud), the bar's last A2 under it and shade spilling out of the cracks."""
    r = R('f_hesmi_death', v=v)
    L = Layers(1.8)
    L.add(S.snap(r, 2000, 3.0), 0.0, peak_db=-7)
    L.add(crumble(r, 1.0, 22, 150, 1200, 0.25), 0.0, peak_db=-3)
    L.add(S.thump(0.5, 100, 32, 0.04, 0.35, 2.6), 0.15, peak_db=0)
    L.add(S.knock(r, 210, 0.1, 5, 'clay'), 0.15, peak_db=-5)
    L.add(litho(hz('A2'), 1.4, 1.0, r, dark=1500), 0.15, peak_db=-7)
    L.add(ink(r, 1.0, 14, 120, 450, 0.25, wash=0.4), 0.25, peak_db=-8)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=30, eq=CALM)


@cue('f_hesmi_call', 'ui', T_CALL, CALLW, **CLK)
def f_hesmi_call(v: int):
    """Hesmi's call: the dark stone bar struck twice, D3 then A2, shade breathing out under the second."""
    L = Layers(1.8)
    L.add(litho(hz('D3'), 1.2, 0.9, R('f_hesmi_call', 'd'), dark=3500), 0.0, peak_db=0)
    L.add(litho(hz('A2'), 1.4, 1.1, R('f_hesmi_call', 'a'), dark=3000), 0.22, peak_db=0)
    L.add(breath(0.9, 1200, 250, shape='breath', q=1.8, seed='hec', peak_at=0.12, vel=0.6), 0.22, peak_db=-14, width=0.6)
    return _fin(room(L.out(), 'stone', wet=0.14), hp_hz=50, eq=CALM)


# ══ Ilsheta, Lamp hanger ═════════════════════════════════════════════════════════════════════════
@cue('f_ilsheta_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_ilsheta_attack_swing(v: int):
    """Ilsheta flicks a glint off her lamp: a small flame 'fwip' rising 600 Hz → 3 kHz, the lamp's glass globe
    tinking E6 on its hook and the hook-staff's wooden tick."""
    r = R('f_ilsheta_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.3)
    L.add(hiss(r, 0.18, 600 * d, 3000 * d, q=1.0, attack=0.02, fall=1.8), 0.0, peak_db=-2)
    L.add(tink(hz('E6') * d, 0.15, 0.1, 0.4), 0.01, peak_db=-4)
    L.add(tink(hz('A6') * d, 0.12, 0.07, 0.3), 0.03, peak_db=-11)
    L.add(S.knock(r, 1200 * d, 0.015, 3, 'wood'), 0.0, peak_db=-12)
    return _fin(L.out(), hp_hz=250, eq=SOFT_TOP)


@cue('f_ilsheta_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_ilsheta_attack_hit(v: int):
    """The glint lands: a soft glass pop (D6 with a short ring), an ember's crackle and a warm low 'whump' — help's
    light turned on an enemy, still warm."""
    r = R('f_ilsheta_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.4)
    L.add(S.glass_ping(hz('D6') * d, 0.3, 0.16, 0.6, r), 0.0, peak_db=-2)
    L.add(whump(r, 0.2, 450), 0.0, peak_db=-5)
    L.add(crackle(r, 0.25, 110, 2200, 7000, 0.1, 0.12), 0.005, peak_db=-4)
    return _fin(room(L.out(), 'wood', wet=0.08), hp_hz=100, eq=SOFT_TOP)


@cue('f_ilsheta_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ilsheta_a1(v: int):
    """Glint Bolt: a bolt of dawnglass thrown from the lamp — the flame drawn up through the wind-up, then the bolt's
    glass zing falling D6 → A5, a harp pluck D5 and the flame's whoosh after it."""
    r = R('f_ilsheta_a1', v=v)
    d = detune(v, 20)
    t = timing('ilsheta', 'a1')[0]
    L = Layers(t + 0.6)
    ld = lead('ilsheta', 'a1', 700, 2600, f'il1l{v}', q=1.6)
    if ld is not None:
        L.add(ld, 0.0, peak_db=-9, width=0.4)
    L.add(fm_tone(hz('D6') * d, hz('A5') * d, 0.22, ratio=3.5, i0=1.4, i1=0.2, t60=0.18, curve=2.5), t, peak_db=-2)
    L.add(harp('D5', 0.5, 0.7, bright=0.45, rr=v, seed=f'il1{v}'), t, peak_db=-5)
    L.add(hiss(r, 0.3, 2400 * d, 900 * d, q=1.0, attack=0.01, fall=2.0), t, peak_db=-8)
    return _fin(room(L.out(), 'wood', wet=0.1), hp_hz=150, eq=SOFT_TOP)


@cue('f_ilsheta_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ilsheta_a2(v: int):
    """Hung Lamp: a lamp hung on an ally — the hook's wooden creak, the globe chiming F5 and A5 as it swings and the
    flame catching in it (a soft whump and crackle)."""
    r = R('f_ilsheta_a2', v=v)
    d = detune(v, 20)
    t = timing('ilsheta', 'a2')[0]
    L = Layers(t + 0.9)
    L.add(creak(r, max(t, 0.1), 700 * d, 0.012, 1.2), 0.0, peak_db=-10)
    L.add(glass('F5', 0.7, 0.7, decay=0.4, bright=0.6, seed=f'il2{v}'), t, peak_db=-3, pan=-0.15)
    L.add(glass('A5', 0.7, 0.6, decay=0.4, bright=0.6, seed=f'il2b{v}'), t + 0.12, peak_db=-5, pan=0.15)
    L.add(whump(r, 0.25, 700), t + 0.02, peak_db=-3)
    L.add(crackle(r, 0.5, 70, 1500, 5000, 0.12, 0.3), t + 0.04, peak_db=-12)
    return _fin(room(L.out(), 'wood', wet=0.12), hp_hz=90, eq=SOFT_TOP)


@cue('f_ilsheta_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_ilsheta_a3(v: int):
    """Dawnglass Shell: a shell of warm glass closing round them — a glass bowl drawn in (played backwards) onto a D5
    strike, a warm harp A4 under it."""
    r = R('f_ilsheta_a3', v=v)
    d = detune(v, 20)
    L = Layers(0.95)
    L.add(rev(at_len(glass(hz('A5') * d, 0.5, 0.7, decay=0.3, seed=f'il3{v}'), 0.18, 0.002), 0.02), 0.0, peak_db=-5)
    L.add(glass(hz('D5') * d, 0.8, 0.85, decay=0.45, bright=0.8, seed=f'il3b{v}'), 0.18, peak_db=-1)
    L.add(harp(hz('A4') * d, 0.6, 0.7, bright=0.4, rr=v, seed=f'il3{v}'), 0.19, peak_db=-5)
    L.add(whump(r, 0.2, 500), 0.18, peak_db=-10)
    return _fin(room(L.out(), 'glass', wet=0.12), hp_hz=120, eq=SOFT_TOP)


@cue('f_ilsheta_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_ilsheta_ult_windup(v: int):
    """Every Window Lit wind-up: lamps kindling — a crackle quickening, a harp rising D4 F4 A4 under a breath of warm
    air, cresting on the release."""
    r = R('f_ilsheta_ult_windup', v=v)
    D = wind('ilsheta')
    L = Layers(D + 0.12)
    cr = crackle(r, D + 0.02, 140, 1400, 5500, 0.15)
    L.add(cr * E.swell(cr.size, D * 0.95, -2.0, release=0.03)[:cr.size], 0.0, peak_db=-11)
    for i, note in enumerate(('D4', 'F4', 'A4')):
        L.add(harp(note, 0.4, 0.55 + 0.15 * i, bright=0.4, rr=i, seed='ilw'), D * (0.1 + 0.3 * i), peak_db=-3 + i)
    L.add(breath(D, 400, 1800, shape='swell', q=1.4, seed='ilw', curve=-2.0), 0.0, peak_db=-10, width=0.6)
    return _fin(L.out(), hp_hz=80, eq=CALM)


@cue('f_ilsheta_ult_release', 'combat', T_REL, RELW, **BGK)
def f_ilsheta_ult_release(v: int):
    """Every Window Lit: every lamp lit at once — a warm whump of flame, the harp strummed D5 F5 A5 D6, her call
    (D5 F5 A5) and a cascade of small glass chimes, window after window catching, over a soft warm hum."""
    r = R('f_ilsheta_ult_release', v=v)
    L = Layers(2.4)
    L.add(whump(r, 0.5, 900), 0.0, peak_db=-2)
    L.add(S.thump(0.4, 160, 60, 0.03, 0.3, 1.6), 0.0, peak_db=-8)
    for i, note in enumerate(('D5', 'F5', 'A5', 'D6')):
        L.add(harp(note, 1.6, 0.85, bright=0.55, rr=i, seed='ilr'), 0.02 * i, peak_db=-2, pan=(-0.3, -0.1, 0.1, 0.3)[i])
    for t, note, g in ((0.28, 'D5', -4), (0.43, 'F5', -4), (0.58, 'A5', -3)):
        L.add(harp(note, 1.0, 0.8, bright=0.55, rr=2, seed=f'ilrc{note}'), t, peak_db=g)
    L.add(S.sparkle(r, 1.2, 26, 84, 103, t60=0.25, rise=True), 0.1, peak_db=-9)
    n = ns(1.8)
    hum = (O.sine(hz('D3'), n) + 0.4 * O.sine(hz('A3'), n)) * E.stages([(0, 0, 0), (0.2, 1, -1.5), (1.8, 0, 1.5)], n)
    L.add(hum, 0.0, peak_db=-16)
    L.add(crackle(r, 1.0, 50, 1400, 5000, 0.12, 0.6), 0.05, peak_db=-12)
    return _fin(room(L.out(), 'hall', wet=0.12), hp_hz=90, eq=CALM)


@cue('f_ilsheta_death', 'combat', T_DIE, DIEW, **BGK)
def f_ilsheta_death(v: int):
    """Ilsheta falls: her lamp hits the ground — the globe's glass clinks and cracks, the flame snuffs out in a soft
    puff, a harp gliss falls D5 → D4 and the hook clatters."""
    r = R('f_ilsheta_death', v=v)
    L = Layers(1.6)
    L.add(S.glass_ping(hz('E6'), 0.4, 0.25, 0.7, r), 0.0, peak_db=-4)
    L.add(S.partials(hz('A5'), (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.06, 0.04, 0.02), 0.15, r), 0.02, peak_db=-7)
    L.add(breath(0.3, 1600, 350, shape='breath', q=1.0, seed='ilp', peak_at=0.01), 0.04, peak_db=-5, width=0.4)
    for i, note in enumerate(('D5', 'C5', 'A4', 'G4', 'F4', 'D4')):
        L.add(harp(note, 0.7, 0.6 - 0.05 * i, bright=0.35, rr=i % 4, seed='ild'), 0.12 + 0.07 * i, peak_db=-5 - i)
    L.add(S.knock(r, 700, 0.04, 4, 'wood'), 0.3, peak_db=-8)
    L.add(S.thump(0.3, 140, 55, 0.02, 0.2, 1.6), 0.3, peak_db=-8)
    return _fin(room(L.out(), 'wood', wet=0.14), hp_hz=70, eq=CALM)


@cue('f_ilsheta_call', 'ui', T_CALL, CALLW, **CLK)
def f_ilsheta_call(v: int):
    """Ilsheta's call: the dial harp plucked D5 → F5 → A5, warm and rising, the lamp's globe tinking with the last."""
    L = Layers(1.6)
    for i, (t, note, g) in enumerate(((0.0, 'D5', -1), (0.14, 'F5', -1), (0.28, 'A5', 0))):
        L.add(harp(note, 1.1, 0.8, bright=0.5, rr=i, seed='ilc'), t, peak_db=g, pan=(-0.15, 0.0, 0.15)[i])
    L.add(tink(hz('A6'), 0.3, 0.2, 0.3), 0.29, peak_db=-14)
    return _fin(room(L.out(), 'wood', wet=0.14), hp_hz=120, eq=CALM)


# ══ Kemdo, Burning glass ═════════════════════════════════════════════════════════════════════════
@cue('f_kemdo_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_kemdo_attack_swing(v: int):
    """Kemdo's glaive swing: a pass of air (500 Hz → 1.2 kHz) with heat hissing off the lens (a sizzle at 5-9 kHz
    trailing the blade) and a small FM buzz of burning glass."""
    r = R('f_kemdo_attack_swing', v=v)
    d = detune(v, 30)
    L = Layers(0.32)
    L.add(S.whoosh(r, 0.26, 500 * d, 800 * d, q=1.2, peak_at=0.4, f_mid=1200 * d), 0.0, peak_db=-3, width=0.5)
    L.add(hiss(r, 0.28, 8000 * d, 5000 * d, q=1.4, attack=0.06, fall=1.8), 0.02, peak_db=-2)
    L.add(sear(hz('D6') * d, 0.18, r, index=(3.0, 1.0), sizzle=0.2), 0.04, peak_db=-11)
    return _fin(L.out(), hp_hz=150, eq=[('peak', 3300, -3.0, 0.8)])


@cue('f_kemdo_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_kemdo_attack_hit(v: int):
    """The lens sears: a sharp sizzle burst (noise flaring round 6 kHz and crackling), the glaive's wrapped stone frame
    thunking in (a mid knock and body) and a short white-hot FM blip."""
    r = R('f_kemdo_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.4)
    L.add(hiss(r, 0.22, 7000 * d, 4500 * d, q=1.5, attack=0.002, fall=2.4), 0.0, peak_db=-1)
    L.add(crackle(r, 0.25, 160, 3000, 9000, 0.0, 0.1), 0.0, peak_db=-8)
    L.add(S.knock(r, 230 * d, 0.06, 5, 'stone'), 0.0, peak_db=-3)
    L.add(S.thump(0.2, 180 * d, 80, 0.015, 0.1, 1.8), 0.0, peak_db=-5)
    L.add(sear(hz('A5') * d, 0.12, r, index=(5.0, 2.0), sizzle=0.1), 0.0, peak_db=-9)
    return _fin(room(L.out(), 'tiny', wet=0.06), hp_hz=90, eq=[('peak', 3300, -3.0, 0.8)])


@cue('f_kemdo_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_kemdo_a1(v: int):
    """Long Thrust: a lunge along the line — the lens heating through the wind-up (a hiss rising), then a fast focused
    jab of air and a beam of burning glass shooting out (an FM sear rising 900 Hz → 1.8 kHz) with hiss streaming
    off it."""
    r = R('f_kemdo_a1', v=v)
    d = detune(v, 20)
    t = timing('kemdo', 'a1')[0]
    L = Layers(t + 0.6)
    if t > 0.05:
        L.add(hiss(r, t + 0.01, 3000, 7000, q=1.6, attack=t, fall=4.0), 0.0, peak_db=-10)
    L.add(S.whoosh(r, 0.2, 800 * d, 1400 * d, q=1.6, peak_at=0.25, f_mid=2000 * d), t, peak_db=-3, width=0.3)
    L.add(fm_tone(900 * d, 1800 * d, 0.35, ratio=1.41, i0=5.0, i1=1.0, t60=0.3, curve=2.0), t, peak_db=-3)
    L.add(hiss(r, 0.4, 7000 * d, 3000 * d, q=1.2, attack=0.01, fall=1.8), t + 0.02, peak_db=-7)
    return _fin(L.out(), hp_hz=150, eq=[('peak', 3300, -3.0, 0.8)])


@cue('f_kemdo_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_kemdo_a2(v: int):
    """Heat Shimmer: she dashes and leaves the air shimmering — a quick whoosh and a wavering heat hiss (a 9 Hz
    tremble in it) hanging behind her."""
    r = R('f_kemdo_a2', v=v)
    d = detune(v, 20)
    L = Layers(0.9)
    L.add(S.whoosh(r, 0.3, 400 * d, 900 * d, q=1.0, peak_at=0.3, f_mid=1400 * d, low_body=0.4), 0.0, peak_db=-2, width=0.6)
    hs = hiss(r, 0.8, 5500 * d, 3500 * d, q=1.0, attack=0.05, fall=1.2)
    L.add(S.am(hs, 9.0, 0.8), 0.04, peak_db=-3)
    L.add(sear(hz('A5') * d, 0.6, r, index=(1.5, 0.5), sizzle=0.5, flicker=9.0), 0.06, peak_db=-12)
    return _fin(L.out(), hp_hz=150, eq=[('peak', 3300, -3.0, 0.8)])


@cue('f_kemdo_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_kemdo_a3(v: int):
    """Vent: fifty Heat let out at once — a big burst of steam (a bright hiss falling 7 kHz → 1.5 kHz), the blast's low
    boom and the lens ticking as it cools a little."""
    r = R('f_kemdo_a3', v=v)
    d = detune(v, 20)
    L = Layers(1.0)
    L.add(hiss(r, 0.8, 7000 * d, 1500 * d, q=0.9, attack=0.008, fall=1.6), 0.0, peak_db=0, width=0.8)
    L.add(S.thump(0.4, 120, 42, 0.03, 0.3, 2.2), 0.0, peak_db=-3)
    L.add(S.burst(r, 0.08, 200, 3000, 0.05, attack=0.001), 0.0, peak_db=-8)
    for i, t in enumerate((0.3, 0.42, 0.58)):
        L.add(tink(hz('B6') * d * (1 + 0.05 * i), 0.08, 0.05, 0.3), t, peak_db=-14 - 2 * i)
    return _fin(room(L.out(), 'small', wet=0.08), hp_hz=40, eq=[('peak', 3300, -3.0, 0.8)])


@cue('f_kemdo_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_kemdo_ult_windup(v: int):
    """Held Focus wind-up: the lens finding the sun — a tone narrowing to a point (an FM sear rising A4 → D6, its index
    climbing) and a hiss crescendo, cresting on the release."""
    r = R('f_kemdo_ult_windup', v=v)
    D = wind('kemdo')
    L = Layers(D + 0.1)
    L.add(fm_tone(hz('A4'), hz('D6'), D, ratio=1.41, i0=0.5, i1=6.0, curve=-1.5, env='swell'), 0.0, peak_db=-1)
    hs = hiss(r, D, 2500, 8000, q=1.4, attack=D * 0.9, fall=6.0)
    L.add(hs, 0.0, peak_db=-2)
    return _fin(L.out(), hp_hz=120, eq=CALM)


@cue('f_kemdo_ult_release', 'combat', T_REL, RELW, **BGK)
def f_kemdo_ult_release(v: int):
    """Held Focus: the stopped sun held on its mark — a sear impact, then a bright burning drone (her call A4 → D5 in
    burning glass, the sizzle flickering through it) holding and fading, steam rising off the spot."""
    r = R('f_kemdo_ult_release', v=v)
    L = Layers(2.2)
    L.add(S.snap(r, 4000, 2.0), 0.0, peak_db=-8)
    L.add(S.thump(0.5, 140, 45, 0.03, 0.35, 2.2), 0.0, peak_db=-12)
    L.add(hiss(r, 0.5, 9000, 4000, q=1.2, attack=0.004, fall=2.0), 0.0, peak_db=0)
    L.add(sear(hz('A4'), 1.6, R('f_kemdo_ult_release', 'a4'), index=(5.0, 1.2), sizzle=0.3), 0.0, peak_db=-3)
    L.add(sear(hz('D5'), 1.5, R('f_kemdo_ult_release', 'd5'), index=(5.0, 1.2), sizzle=0.3), 0.18, peak_db=-3)
    L.add(S.am(hiss(r, 1.8, 8000, 5000, q=0.9, attack=0.2, fall=1.4), 11.0, 0.6), 0.1, peak_db=-3, width=0.8)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=150, eq=CALM)


@cue('f_kemdo_death', 'combat', T_DIE, DIEW, **BGK)
def f_kemdo_death(v: int):
    """Kemdo falls: her heat leaves her — a long sigh of steam falling, the lens cracking and ticking as it cools, the
    glaive's stone frame thudding down."""
    r = R('f_kemdo_death', v=v)
    L = Layers(1.8)
    L.add(hiss(r, 1.4, 6000, 900, q=0.9, attack=0.02, fall=1.3), 0.0, peak_db=-2, width=0.7)
    L.add(S.snap(r, 3800, 1.8), 0.05, peak_db=-8)
    L.add(S.partials(hz('D6'), (1.0, 2.76, 5.4), (1.0, 0.5, 0.2), (0.05, 0.03, 0.02), 0.12, r), 0.05, peak_db=-7)
    tt, k = 0.25, 0
    while tt < 1.4:
        L.add(tink(hz('B6') * r.uniform(0.85, 1.2), 0.08, 0.05, 0.3), tt, peak_db=-13 - 1.5 * k)
        tt += 0.09 + 0.07 * k
        k += 1
    L.add(S.knock(r, 200, 0.1, 5, 'stone'), 0.3, peak_db=-4)
    L.add(S.thump(0.4, 120, 42, 0.03, 0.3, 2.0), 0.3, peak_db=-5)
    return _fin(room(L.out(), 'small', wet=0.1), hp_hz=40, eq=CALM)


@cue('f_kemdo_call', 'ui', T_CALL, CALLW, **CLK)
def f_kemdo_call(v: int):
    """Kemdo's call: burning glass sounded twice, A4 then D5 (FM sear tones, the sizzle round them cooling)."""
    L = Layers(1.6)
    L.add(sear(hz('A4'), 0.8, R('f_kemdo_call', 'a'), index=(4.0, 1.0), sizzle=0.25), 0.0, peak_db=-1, pan=-0.12)
    L.add(sear(hz('D5'), 1.0, R('f_kemdo_call', 'd'), index=(4.0, 1.0), sizzle=0.25), 0.18, peak_db=0, pan=0.12)
    return _fin(room(L.out(), 'small', wet=0.12), hp_hz=120, eq=CALM)


# ══ Lisvel, Morning archer ═══════════════════════════════════════════════════════════════════════
@cue('f_lisvel_attack_swing', 'combat', T_SW, SWING, variants=V3, **SWK)
def f_lisvel_attack_swing(v: int):
    """Lisvel looses: her ash longbow's string (E2, low and long, damped at 90 ms) with the limbs' wooden knock, the
    arrow's thwip and its fletching fluttering off."""
    r = R('f_lisvel_attack_swing', v=v)
    d = detune(v, 25)
    L = Layers(0.32)
    L.add(harp(hz('E2') * d, 0.25, 0.95, bright=0.85, damp_at=0.09, seed=f'lis{v}', body=0.6), 0.0, peak_db=-2)
    L.add(S.knock(r, 620 * d, 0.025, 4, 'wood'), 0.0, peak_db=-8)
    L.add(S.snap(r, 2800 * d, 1.2), 0.0, peak_db=-12)
    L.add(S.whoosh(r, 0.13, 4200 * d, 2000 * d, q=1.6, peak_at=0.15, rise=-0.8), 0.006, peak_db=-4, width=0.4)
    L.add(flutter_noise(r, 0.09, 2600 * d, 70.0), 0.03, peak_db=-12)
    return _fin(L.out(), hp_hz=60, eq=SOFT_TOP)


@cue('f_lisvel_attack_hit', 'combat', T_HIT, HITW, variants=V3, **HTK)
def f_lisvel_attack_hit(v: int):
    """The arrow strikes: an ash 'thock' (a wood knock at 820 Hz) and the shaft quivering in the target (a 330 Hz
    buzz shaking at 45 Hz: up where a laptop still plays it, so the quiver is the hit's signature on any speaker)."""
    r = R('f_lisvel_attack_hit', v=v)
    d = detune(v, 35)
    L = Layers(0.35)
    L.add(S.snap(r, 3000 * d, 1.5), 0.0, peak_db=-10)
    L.add(S.knock(r, 820 * d, 0.04, 5, 'wood'), 0.0, peak_db=0)
    L.add(S.thump(0.12, 300 * d, 180, 0.01, 0.06, 1.4), 0.0, peak_db=-8)
    n = ns(0.2)
    q = O.sine(330 * d, n) * E.decay(n, 0.18, 0.002)
    L.add(S.am(q, 45.0, 0.9), 0.006, peak_db=-2)
    return _fin(room(L.out(), 'tiny', wet=0.06), hp_hz=100, eq=SOFT_TOP)


@cue('f_lisvel_a1', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_lisvel_a1(v: int):
    """Dawn Line: she draws long and looses a line of morning — the string creaking through the wind-up, the low
    string twang, then a lark's whistle rising A5 → E6 down the line and a glass shimmer lighting it."""
    r = R('f_lisvel_a1', v=v)
    d = detune(v, 20)
    t = timing('lisvel', 'a1')[0]
    L = Layers(t + 0.75)
    L.add(creak(r, max(t, 0.08), 900 * d, 0.01, 1.4), 0.0, peak_db=-9)
    L.add(harp(hz('E2') * d, 0.3, 1.0, bright=0.9, damp_at=0.12, seed=f'li1{v}', body=0.6), t, peak_db=-2)
    L.add(whistle(hz('A5') * d, hz('E6') * d, 0.45, r, vib_hz=6.0, cents=18), t + 0.03, peak_db=-4)
    L.add(shimmer('E6', 0.5, 0.5, decay=0.4, index=2.0, seed=f'li1{v}'), t + 0.1, peak_db=-12)
    return _fin(room(L.out(), 'glass', wet=0.1), hp_hz=60, eq=SOFT_TOP)


@cue('f_lisvel_a2', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_lisvel_a2(v: int):
    """Backstep: a quick hop back — a light footfall on the frame drum's rim, her cloak fluttering and a short whistle
    flicking up."""
    r = R('f_lisvel_a2', v=v)
    d = detune(v, 25)
    t = timing('lisvel', 'a2')[0]
    L = Layers(t + 0.45)
    L.add(drum('D3', 0.7, 'tek', seed=f'li2{v}', dur=0.15, t60=0.08, rr=v), t, peak_db=-3)
    L.add(flutter_noise(r, 0.22, 1400 * d, 32.0, 0.8), t, peak_db=-6)
    L.add(whistle(hz('D6') * d, hz('A6') * d, 0.14, r, vib_hz=0.0, cents=0.0, air=0.1, curve=2.0, env='decay'), t + 0.04, peak_db=-6)
    return _fin(L.out(), hp_hz=180, eq=SOFT_TOP)


@cue('f_lisvel_a3', 'combat', T_CAST, CASTW, variants=V3, **CSK)
def f_lisvel_a3(v: int):
    """Morning Draw: she draws faster — three quick string draws (taut creaks, each higher) and a lark's trill
    answering."""
    r = R('f_lisvel_a3', v=v)
    d = detune(v, 20)
    L = Layers(0.9)
    for i in range(3):
        L.add(creak(r, 0.09, (800 + 160 * i) * d, 0.007, 1.3), 0.12 * i, peak_db=-5 + i)
    L.add(whistle(hz('E6') * d, hz('A6') * d, 0.4, r, vib_hz=14.0, cents=70, air=0.12, curve=1.0), 0.36, peak_db=-3)
    return _fin(room(L.out(), 'wood', wet=0.1), hp_hz=200, eq=SOFT_TOP)


@cue('f_lisvel_ult_windup', 'combat', T_WIND, WIND, **CSK)
def f_lisvel_ult_windup(v: int):
    """Sun Corridor wind-up: the bow drawn to the sky — one long taut creak of the string and a whistle climbing D5 →
    A5 into the light, cresting on the release."""
    r = R('f_lisvel_ult_windup', v=v)
    D = wind('lisvel')
    L = Layers(D + 0.1)
    L.add(creak(r, D, 700, 0.009, 1.6), 0.0, peak_db=-4)
    w = whistle(hz('D5'), hz('A5'), D, r, vib_hz=5.0, cents=15, air=0.15, curve=-1.0, env='decay')
    L.add(w * E.swell(w.size, D * 0.95, -2.0, release=D * 0.05)[:w.size], 0.0, peak_db=-2)
    L.add(breath(D, 1200, 5000, shape='swell', q=1.4, seed='liw'), 0.0, peak_db=-12, width=0.6)
    return _fin(L.out(), hp_hz=120, eq=CALM)


@cue('f_lisvel_ult_release', 'combat', T_REL, RELW, **BGK)
def f_lisvel_ult_release(v: int):
    """Sun Corridor: morning falls on them — a rush of light coming down (a breath and a whistle falling from high)
    and where the shaft lands, after its delay, a bright glass chord (D5 A5 E6) on a hard impact, her call (A5 E6 D6)
    whistled over the corridor's shimmer."""
    r = R('f_lisvel_ult_release', v=v)
    dl = max(timing('lisvel', 'ult')[1], 0.3)
    L = Layers(dl + 1.6)
    L.add(breath(dl + 0.02, 6000, 900, shape='swell', q=1.6, seed='lir', curve=-1.8), 0.0, peak_db=-3, width=0.7)
    L.add(whistle(hz('E7'), hz('A5'), dl, r, vib_hz=0.0, cents=0.0, air=0.25, curve=-1.0, env='decay'), 0.0, peak_db=-6)
    L.add(S.snap(r, 3200, 2.5), dl, peak_db=-7)
    L.add(S.thump(0.6, 130, 40, 0.035, 0.45, 2.2), dl, peak_db=-2)
    for i, (note, g) in enumerate((('D5', -7), ('A5', -8), ('E6', -10))):
        L.add(glass(note, 1.6, 0.85, decay=0.5, bright=0.8, seed=f'lir{i}'), dl + 0.003 * i, peak_db=g)
    for t, a, b in ((0.1, 'A5', 'A5'), (0.26, 'E6', 'E6'), (0.42, 'D6', 'D6')):
        L.add(whistle(hz(a), hz(b) * 1.002, 0.3, R('f_lisvel_ult_release', a), vib_hz=6.0, cents=15, air=0.1), dl + t, peak_db=-1)
    L.add(S.sparkle(r, 1.0, 16, 86, 100, t60=0.2), dl + 0.05, peak_db=-13)
    return _fin(room(L.out(), 'hall', wet=0.12), hp_hz=45, eq=CALM)


@cue('f_lisvel_death', 'combat', T_DIE, DIEW, **BGK)
def f_lisvel_death(v: int):
    """Lisvel falls: the bow drops — the ash limbs clattering, the string going slack in a low bending 'bwong', a lark's
    whistle fading downward."""
    r = R('f_lisvel_death', v=v)
    L = Layers(1.6)
    L.add(S.knock(r, 520, 0.05, 5, 'wood'), 0.0, peak_db=-3)
    L.add(S.thump(0.3, 140, 50, 0.02, 0.2, 1.6), 0.0, peak_db=-6)
    L.add(S.knock(r, 680, 0.04, 4, 'wood'), 0.14, peak_db=-6)
    n = ns(0.7)
    slack = O.triangle(np.geomspace(hz('E2'), hz('E2') * 0.8, n), n) * E.decay(n, 0.6, 0.004)
    L.add(lp(slack, 1600), 0.02, peak_db=-4)
    L.add(whistle(hz('E6'), hz('A5'), 0.9, r, vib_hz=5.0, cents=20, air=0.15, curve=1.0), 0.2, peak_db=-8)
    L.add(breath(0.9, 2400, 400, shape='breath', q=1.4, seed='lid', peak_at=0.08, vel=0.6), 0.05, peak_db=-12, width=0.6)
    return _fin(room(L.out(), 'wood', wet=0.12), hp_hz=50, eq=CALM)


@cue('f_lisvel_call', 'ui', T_CALL, CALLW, **CLK)
def f_lisvel_call(v: int):
    """Lisvel's call: a lark's whistle, A5 → E6 → D6 (morning), over a soft pluck of the low string."""
    L = Layers(1.4)
    L.add(harp('E2', 0.5, 0.6, bright=0.6, damp_at=0.3, seed='lic', body=0.5), 0.0, peak_db=-10)
    for i, (t, note, dur) in enumerate(((0.0, 'A5', 0.16), (0.16, 'E6', 0.16), (0.32, 'D6', 0.5))):
        L.add(whistle(hz(note), hz(note) * 1.003, dur, R('f_lisvel_call', note), vib_hz=6.0, cents=14, air=0.1), t, peak_db=-1 + (i == 2))
    return _fin(room(L.out(), 'wood', wet=0.16), hp_hz=100, eq=CALM)
