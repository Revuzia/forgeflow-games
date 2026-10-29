"""The fighters' own area and zone sounds, as heard (closing AUD-C1). src/audio/index.ts never plays a library cue under a
kitted fighter's own area / zone (its kit cast cue carries the gesture, its delayed landing timed from content, and
the ult's release lands on the ult's area); what an area adds on top of the cast is voiced here, in that fighter's own
palette (kits_a.py / kits_b.py: home material, signature instrument, D Dorian), and content/audio.json binds each to
its effect's vfx ('area.<vfx>' → f_<fighter>_<slot>_land | _zone):

    landings (an onExpire area that lands seconds after the cast, which the cast cue cannot carry)
      f_burdam_a2_land   Stubborn ends: a boundary stone stamped down, his ironstone gong under it
      f_hesmi_a1_land    the planted shard topples flat along its shadow
      f_odrum_a1_land    the resin pool sets: amber splits and a slit-drum knock
      f_odrum_ult_land   Amber Hour sets hard: the whole pool locks in a spreading ring of splits
    zones (a seamless 2 s loop the engine holds for the zone's delay + life, in place of the library's c_zone_loop)
      f_ardit_ult_zone   Muster: the rallied ground hums like a thick pane in its oak frame
      f_hesmi_a1_zone    the shard's shadow: a dark stone bar's hum over a slow ink murmur
      f_kemdo_ult_zone   Focus: the lens's held heat, a burning-glass sear and its sizzle
      f_lisvel_a1_zone   the drawn line: a low bowstring hum and morning air
      f_marund_a2_zone   inside the Shelter Dome: the dome bell's round hum and a hearth breathing
      f_sukri_ult_zone   the noon dust: bright grit hissing in the light, the cup's glints sloshing

Zones are mono-compatible stereo (mid + side), every partial snapped to whole cycles of the loop and every noise layer
filtered circularly, so the file loops sample-exactly (build.py encodes loops seamlessly and QA's the seam). Loudness:
zones -22 LUFS integrated (the library zone loop's level, so a zone sits where it sat), landings -16.5..-17.5 max
momentary (between a cast, -18, and a release, -14.5).
"""
from __future__ import annotations

import numpy as np

from cuelib import cue
from synth import filters as F
from synth import osc as O
from synth import sfx as S
from synth.core import SR, TAU, hz, ns

from .kit import BAR_R, PANE_R, Layers, R, bubble, crackle, crumble, hollow, litho, norm, room, scrape, whistle
from .kit import finish as _fin
from .kits_a import BGK, CALM, iron_gong
from .kits_b import amber, cup, dome, slit
from .world import band_noise, grain, loop_out, scatter, wide, wobble

ZONE_S = 2.0
ZONE_W = (ZONE_S - 0.01, ZONE_S + 0.01)
ZK = dict(loop=True, max_gr_db=6.0)
T_ZONE = ('int', -22.0)
LANDW = (0.3, 2.4)


# ── periodic building blocks ─────────────────────────────────────────────────────────────────────
def drone(parts, r: np.random.Generator, D: float = ZONE_S) -> np.ndarray:
    """A held tone: each (f, amp) partial snapped to whole cycles of the loop (so it is seamless); a partial listed
    twice, 0.5 Hz apart, beats once per loop."""
    n = ns(D)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f, a in parts:
        fs = max(1, round(f * D)) / D
        y += a * np.sin(TAU * fs * t + r.uniform(0, TAU))
    return norm(y)


def held(f: float, ratios, amps, r: np.random.Generator, beat: float = 0.5) -> np.ndarray:
    """An instrument's modes held as a hum: each mode with a twin `beat` Hz above it (a slow, living beat)."""
    parts = []
    for k, a in zip(ratios, amps):
        parts += [(f * k, a), (f * k + beat, a * 0.7)]
    return drone(parts, r)


def zone_out(mid: np.ndarray, side: np.ndarray, amt: float = 0.35, hp_hz: float = 40.0, lp_hz: float = 9000.0) -> np.ndarray:
    """Mid + an independent side layer (wide in stereo, exactly the mid in mono), cleaned circularly, peak 1.0."""
    return loop_out(wide(norm(mid), norm(side), amt), hp_hz=hp_hz, lp_hz=lp_hz)


# ── zones ────────────────────────────────────────────────────────────────────────────────────────
@cue('f_ardit_ult_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_ardit_ult_zone(v: int):
    """Muster: the ground Ardit rallied holds — his thick dawnglass pane humming in its oak frame (D4 plate modes,
    each beating slowly against its twin), warm air moving over it and the frame's odd creak."""
    r = R('f_ardit_ult_zone', v=v)
    n = ns(ZONE_S)
    hum = held(hz('D4'), PANE_R[:4], (1.0, 0.5, 0.3, 0.16), r)
    lfo = wobble(n, r, (1, 2), 0.25)
    air = band_noise(n, r, np.full(n, 900.0), 0.9, slope=-3.0) * lfo
    creaks = scatter(n, r, 3.0, lambda rr: S.knock(rr, rr.uniform(500, 800), 0.03, 3, 'wood') * rr.uniform(0.3, 0.8))
    mid = norm(hum) * lfo + 0.35 * norm(air) + 0.25 * norm(creaks)
    side = band_noise(n, r, np.full(n, 2400.0), 0.8, slope=-3.0)
    return zone_out(mid, side, 0.25, hp_hz=60)


@cue('f_hesmi_a1_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_hesmi_a1_zone(v: int):
    """The planted shard's shadow: the dark stone bar humming D3 in the ground (free-bar modes, low-passed), a slow
    murmur of ink bubbling in the shadow, a little grit sifting."""
    r = R('f_hesmi_a1_zone', v=v)
    n = ns(ZONE_S)
    hum = F.apply(held(hz('D3'), BAR_R[:3], (1.0, 0.3, 0.1), r), [F.lowpass(2200, 0.7)], circular=True)
    murmur = scatter(n, r, 9.0, lambda rr: bubble(rr.uniform(140, 380), rr.uniform(0.05, 0.1), rr.uniform(1.6, 2.4), 0.05)
                     * rr.uniform(0.3, 1.0))
    shade = band_noise(n, r, np.full(n, 380.0), 0.8, slope=-4.0) * wobble(n, r, (1, 3), 0.35)
    grit = scatter(n, r, 30.0, lambda rr: grain(rr, 1500, 4500, (3.0, 10.0), 1.4) * 0.5)
    mid = norm(hum) + 0.5 * norm(murmur) + 0.45 * norm(shade) + 0.12 * norm(grit)
    return zone_out(mid, band_noise(n, r, np.full(n, 700.0), 0.8, slope=-4.0), 0.3, hp_hz=45, lp_hz=7000)


@cue('f_kemdo_ult_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_kemdo_ult_zone(v: int):
    """Focus: the lens holding its heat on the ground — a burning-glass sear on A4 (an inharmonic FM drone whose
    index breathes), its sizzle flickering on top, steam rising off it."""
    r = R('f_kemdo_ult_zone', v=v)
    n = ns(ZONE_S)
    t = np.arange(n) / SR
    fc = round(hz('A4') * ZONE_S) / ZONE_S
    fm = round(hz('A4') * 1.41 * ZONE_S) / ZONE_S
    idx = 1.6 + 0.9 * wobble(n, r, (1, 2, 3), 0.6)
    sear = np.sin(TAU * fc * t + idx * np.sin(TAU * fm * t))
    sear = F.apply(sear, [F.lowpass(3800, 0.7)], circular=True)
    sizzle = band_noise(n, r, np.full(n, 7000.0), 0.9, slope=-1.0) * (0.6 + 0.4 * np.sin(TAU * 9.0 * t))
    steam = band_noise(n, r, np.full(n, 2600.0), 1.1, slope=-2.0) * wobble(n, r, (1, 2), 0.5)
    mid = norm(sear) + 0.3 * norm(sizzle) + 0.4 * norm(steam)
    side = band_noise(n, r, np.full(n, 5000.0), 0.9, slope=-2.0)
    return zone_out(mid, side, 0.3, hp_hz=80, lp_hz=11000)


@cue('f_lisvel_a1_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_lisvel_a1_zone(v: int):
    """The line Lisvel drew: a low bowstring humming A2 along the ground (a string's harmonic series, thinning to the
    top), soft morning air over it and, far off, the lark answering twice."""
    r = R('f_lisvel_a1_zone', v=v)
    n = ns(ZONE_S)
    f0 = hz('A2')
    hum = drone([(f0 * k, 1.0 / k ** 1.3) for k in range(1, 9)] + [(f0 + 0.5, 0.6)], r)
    bow = band_noise(n, r, np.full(n, 1300.0), 1.4, slope=-2.0) * wobble(n, r, (1, 2), 0.4)
    air = band_noise(n, r, np.full(n, 3000.0), 0.7, slope=-3.0) * wobble(n, r, (1, 3), 0.5)
    lark = np.zeros(n)
    for k, (a, b) in enumerate((('E6', 'A6'), ('D6', 'E6'))):
        w = whistle(hz(a), hz(b), 0.16, R('f_lisvel_a1_zone', f'w{k}', v), vib_hz=6.0, cents=18.0, air=0.1)
        s = ns(0.35 + k * 0.9)
        lark[s:s + w.size] += w[:max(0, min(w.size, n - s))] * (0.5 - 0.15 * k)
    mid = norm(hum) * wobble(n, r, (1,), 0.15) + 0.3 * norm(bow) + 0.18 * norm(lark)
    return zone_out(mid, air, 0.4, hp_hz=60, lp_hz=10000)


@cue('f_marund_a2_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_marund_a2_zone(v: int):
    """Inside the Shelter Dome: the stone dome bell's G2 hum held round over them (its few low modes, beating
    slowly), the hearth he carries breathing warm under it and crackling."""
    r = R('f_marund_a2_zone', v=v)
    n = ns(ZONE_S)
    hum = F.apply(held(hz('G2'), (1.0, 1.93, 2.84), (1.0, 0.4, 0.15), r), [F.lowpass(2000, 0.7)], circular=True)
    hearth = band_noise(n, r, np.full(n, 420.0), 0.7, slope=-4.0) * wobble(n, r, (1, 2), 0.45)
    crack = scatter(n, r, 26.0, lambda rr: O.white(ns(rr.uniform(0.0004, 0.0018)), rr) * (rr.pareto(2.5) + 0.2))
    crack = F.apply(crack, [F.highpass(1400, 0.7), F.lowpass(5000, 0.7)], circular=True)
    mid = norm(hum) + 0.45 * norm(hearth) + 0.16 * norm(crack)
    return zone_out(mid, band_noise(n, r, np.full(n, 900.0), 0.8, slope=-4.0), 0.3, hp_hz=40, lp_hz=7000)


@cue('f_sukri_ult_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_sukri_ult_zone(v: int):
    """The noon dust Sukri raised: fine bright grit hissing where the light falls through it, the glass cup's A5 and
    E5 glinting in and out (the light sloshing), a faint warm A3 under the dust."""
    r = R('f_sukri_ult_zone', v=v)
    n = ns(ZONE_S)
    lfo = wobble(n, r, (1, 2, 3), 0.5)
    dust = band_noise(n, r, np.full(n, 5200.0), 1.0, slope=-1.5) * lfo
    grit = scatter(n, r, 140.0, lambda rr: grain(rr, 2500, 8000, (2.0, 6.0), 1.6), np.clip(lfo / lfo.max(), 0, 1))
    glints = scatter(n, r, 3.5, lambda rr: cup(hz(str(rr.choice(['A5', 'E5', 'D6']))), 0.5, 0.35, 4.0, 18.0,
                                                rr.uniform(0, TAU)) * rr.uniform(0.3, 0.8))
    warm = drone([(hz('A3'), 1.0), (hz('A3') + 0.5, 0.6)], r)
    mid = 0.6 * norm(dust) + 0.3 * norm(grit) + 0.45 * norm(glints) + 0.25 * norm(warm)
    side = band_noise(n, r, np.full(n, 7000.0), 0.9, slope=-1.5) * lfo
    return zone_out(mid, side, 0.35, hp_hz=90, lp_hz=12000)


# ── landings ─────────────────────────────────────────────────────────────────────────────────────
@cue('f_burdam_a2_land', 'combat', ('m', -17.0), LANDW, **BGK)
def f_burdam_a2_land(v: int):
    """Stubborn ends in a stamp: Burdam sets down like a boundary stone — a deep sub thump, two stone knocks (the
    second lower, settling), his hollow ironstone gong struck A2 under them and grit thrown out."""
    r = R('f_burdam_a2_land', v=v)
    L = Layers(1.4)
    L.add(S.thump(0.4, 120, 42, 0.03, 0.28, 2.0), 0.0, peak_db=-1)
    L.add(S.knock(r, 210, 0.1, 5, 'stone'), 0.0, peak_db=-2)
    L.add(S.snap(r, 2200, 2.5), 0.0, peak_db=-10)
    L.add(S.knock(r, 150, 0.12, 5, 'stone'), 0.07, peak_db=-3)
    L.add(iron_gong(hz('A2'), 1.2, r), 0.01, peak_db=-4)
    L.add(S.chips(r, 0.5, 20, 900, 4000, 0.08, 0.15), 0.01, peak_db=-14)
    L.add(S.rumble(r, 0.8, 150, 0.5, 0.005), 0.0, peak_db=-10)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=35, lp_hz=8000, eq=CALM)


@cue('f_hesmi_a1_land', 'combat', ('m', -16.5), LANDW, **BGK)
def f_hesmi_a1_land(v: int):
    """The planted shard topples along its shadow: a short grinding lean, then the slab slaps down flat — a crack, a
    deep stone knock, the D3 bar ringing in it, rubble rolling after and the shadow's ink spilling out."""
    r = R('f_hesmi_a1_land', v=v)
    lean = 0.22
    L = Layers(lean + 1.2)
    L.add(scrape(r, lean + 0.02, 700, 3.0, 22, 0.8, 0.8), 0.0, peak_db=-9)
    L.add(S.snap(r, 1900, 3.0), lean, peak_db=-7)
    L.add(S.thump(0.4, 130, 45, 0.03, 0.25, 2.2), lean, peak_db=-1)
    L.add(S.knock(r, 260, 0.1, 5, 'stone'), lean, peak_db=-3)
    L.add(litho(hz('D3'), 1.0, 0.75, r), lean + 0.004, peak_db=-4)
    L.add(crumble(r, 0.7, 18, 140, 900, 0.3), lean + 0.04, peak_db=-10)
    L.add(S.burst(r, 0.12, 300, 1600, 0.08, q=0.8), lean, peak_db=-8)
    return _fin(room(L.out(), 'stone', wet=0.12), hp_hz=40, eq=CALM)


@cue('f_odrum_a1_land', 'combat', ('m', -17.5), LANDW, **BGK)
def f_odrum_a1_land(v: int):
    """The resin pool sets: a clutch of dull amber splits running across it, a sticky snap, and Odrum's walnut slit
    drum knocked once on A3 as it locks."""
    r = R('f_odrum_a1_land', v=v)
    L = Layers(0.9)
    for k in range(4):
        L.add(amber(R('f_odrum_a1_land', f'c{k}', v), 700 * (1 + 0.15 * k), 3200), 0.035 * k, peak_db=-2 - 1.5 * k,
              pan=(-0.3, 0.2, -0.1, 0.3)[k])
    L.add(slit(hz('A3'), 0.7, 0.4, r), 0.02, peak_db=-2)
    L.add(crackle(r, 0.5, 60, 1200, 4200, 0.05, 0.5), 0.05, peak_db=-12)
    L.add(S.thump(0.2, 160, 70, 0.02, 0.12, 2.4), 0.0, peak_db=-8)
    return _fin(room(L.out(), 'wood', wet=0.1), hp_hz=70, lp_hz=7000, eq=CALM)


@cue('f_odrum_ult_land', 'combat', ('m', -16.0), LANDW, **BGK)
def f_odrum_ult_land(v: int):
    """Amber Hour sets hard: the whole pool locks — the slit drum's low D3 struck with the mallet's full weight, a ring
    of amber splits spreading outward round it (wider and lower as they go), and a last long creak of resin."""
    r = R('f_odrum_ult_land', v=v)
    L = Layers(1.6)
    L.add(slit(hz('D3'), 1.0, 0.6, r), 0.0, peak_db=-1)
    L.add(S.thump(0.35, 120, 50, 0.025, 0.22, 2.2), 0.0, peak_db=-4)
    for k in range(7):
        L.add(amber(R('f_odrum_ult_land', f'c{k}', v), 820 * (1 - 0.07 * k), 3600 - 250 * k), 0.025 + 0.045 * k,
              peak_db=-3 - k, pan=((-1) ** k) * min(0.6, 0.1 * (k + 1)))
    L.add(hollow(hz('A3'), 0.8, 0.45, r, odd=3, hit_ms=2.0), 0.03, peak_db=-9)
    L.add(crackle(r, 0.9, 50, 1100, 4000, 0.08, 0.6), 0.15, peak_db=-12)
    return _fin(room(L.out(), 'hall', wet=0.08), hp_hz=60, lp_hz=8000, eq=CALM)
