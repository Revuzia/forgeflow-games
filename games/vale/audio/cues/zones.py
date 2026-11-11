"""The fighters' lasting zones that were silent after their cast (max SFX-6, AUD2-2): every own zone of 2 s or longer
now holds a quiet loop in its fighter's palette (kits_a.py / kits_b.py), bound in content/audio.json through its vfx
('area.<vfx>' → f_<fighter>_<slot>_zone), so an enemy standing in one hears it:

    f_ervet_a3_zone     the shattered ground: the singing glass E6/B5 held faint and beating, shards settling
    f_hesmi_ult_zone    the great shadow: the stone bar's A2 hum deep in the ground, ink murmuring, a cold draught
    f_ilsheta_a2_zone   the hung lamp: its flame fluttering, the dial harp's D5 / A5 glinting now and then
    f_ilsheta_ult_zone  the lamps lit all round: the harp's D5 F5 A5 held as a hum, many flames breathing
    f_kemdo_a2_zone     the heat shimmer: steam hissing off hot ground, a faint D5 sear wavering in it
    f_odrum_ult_zone    the amber pool: resin creaking and ticking as it sets, the slit drum's A3 hum under it
    f_rishal_a1_zone    the glass track: the rods' E6 ringing faintly along it, heat ticking
    f_rishal_a3_zone    the feint's after-image: a glass rod's A6 whisper and a thin hiss of air
    f_rishal_ult_zone   the glint field: E6 B6 A6 rods glinting at random over a heat haze

Built like areas.py's zones (seamless 2 s loops: partials snapped to whole cycles, circular filters) at its level,
-22 LUFS integrated, so they sit with the six zones already there (and under every cue that means a hit).
"""
from __future__ import annotations

import numpy as np

from cuelib import cue
from synth import filters as F
from synth import sfx as S
from synth.core import SR, TAU, hz, ns

from .areas import T_ZONE, ZK, ZONE_S, ZONE_W, drone, held, zone_out
from .kit import BAR_R, R, bubble, norm
from .kits_b import amber, rod, slit
from .world import band_noise, grain, scatter, wobble


@cue('f_ervet_a3_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_ervet_a3_zone(v: int):
    r = R('f_ervet_a3_zone', v=v)
    n = ns(ZONE_S)
    hum = drone([(hz('E6'), 1.0), (hz('E6') + 0.5, 0.7), (hz('B5'), 0.6), (hz('B5') + 1.0, 0.4)], r)
    shards = scatter(n, r, 7.0, lambda rr: S.glass_ping(rr.uniform(2600, 5200), 0.12, 0.06, 0.6, rr) * rr.uniform(0.2, 0.7))
    grit = scatter(n, r, 20.0, lambda rr: grain(rr, 1800, 6000, (2.0, 6.0), 1.4) * 0.4)
    mid = 0.7 * norm(hum) * wobble(n, r, (1, 2), 0.35) + 0.5 * norm(shards) + 0.15 * norm(grit)
    return zone_out(mid, band_noise(n, r, np.full(n, 4200.0), 0.9, slope=-2.0), 0.3, hp_hz=200, lp_hz=10000)


@cue('f_hesmi_ult_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_hesmi_ult_zone(v: int):
    r = R('f_hesmi_ult_zone', v=v)
    n = ns(ZONE_S)
    hum = F.apply(held(hz('A2'), BAR_R[:3], (1.0, 0.35, 0.1), r), [F.lowpass(1600, 0.7)], circular=True)
    murmur = scatter(n, r, 6.0, lambda rr: bubble(rr.uniform(110, 300), rr.uniform(0.06, 0.12), rr.uniform(1.5, 2.2), 0.06)
                     * rr.uniform(0.3, 1.0))
    draught = band_noise(n, r, np.full(n, 520.0), 0.7, slope=-4.0) * wobble(n, r, (1, 2, 3), 0.5)
    mid = norm(hum) + 0.45 * norm(murmur) + 0.55 * norm(draught)
    return zone_out(mid, band_noise(n, r, np.full(n, 900.0), 0.8, slope=-4.0), 0.35, hp_hz=40, lp_hz=6000)


def flame(n: int, r: np.random.Generator, centre: float = 700.0, depth: float = 0.55) -> np.ndarray:
    """A small flame breathing: low band noise with a quick, irregular flutter, a few soft pops."""
    fl = band_noise(n, r, np.full(n, centre), 0.8, slope=-3.5) * wobble(n, r, (3, 5, 7, 11), depth)
    pops = scatter(n, r, 5.0, lambda rr: grain(rr, 600, 2200, (2.0, 5.0), 1.2) * rr.uniform(0.3, 1.0))
    return norm(fl) + 0.25 * norm(pops)


def harp_glint(f: float, rr: np.random.Generator) -> np.ndarray:
    """A dial-harp string touched lightly: a short plucked partial set."""
    return S.partials(f, (1.0, 2.0, 3.0, 4.01), (1.0, 0.45, 0.2, 0.08), (0.5, 0.3, 0.18, 0.1), 0.6, rr, 0.3)


@cue('f_ilsheta_a2_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_ilsheta_a2_zone(v: int):
    r = R('f_ilsheta_a2_zone', v=v)
    n = ns(ZONE_S)
    glints = scatter(n, r, 1.6, lambda rr: harp_glint(hz(str(rr.choice(['D5', 'A5']))), rr) * rr.uniform(0.4, 0.9))
    warm = drone([(hz('D4'), 1.0), (hz('D4') + 0.5, 0.6)], r)
    mid = norm(flame(n, r, 650.0)) + 0.45 * norm(glints) + 0.2 * norm(warm)
    return zone_out(mid, band_noise(n, r, np.full(n, 1800.0), 0.8, slope=-3.0), 0.3, hp_hz=90, lp_hz=8000)


@cue('f_ilsheta_ult_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_ilsheta_ult_zone(v: int):
    r = R('f_ilsheta_ult_zone', v=v)
    n = ns(ZONE_S)
    chord = drone([(hz('D5'), 1.0), (hz('D5') + 0.5, 0.6), (hz('F5'), 0.7), (hz('A5'), 0.6), (hz('A5') + 0.5, 0.4)], r)
    flames = norm(flame(n, r, 600.0, 0.5)) + norm(flame(n, R('f_ilsheta_ult_zone', 'b', v), 820.0, 0.6))
    mid = 0.55 * norm(chord) * wobble(n, r, (1, 2), 0.3) + 0.7 * norm(flames)
    side = norm(flame(n, R('f_ilsheta_ult_zone', 's', v), 1100.0, 0.6))
    return zone_out(mid, side, 0.45, hp_hz=90, lp_hz=8500)


@cue('f_kemdo_a2_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_kemdo_a2_zone(v: int):
    r = R('f_kemdo_a2_zone', v=v)
    n = ns(ZONE_S)
    t = np.arange(n) / SR
    fc = round(hz('D5') * ZONE_S) / ZONE_S
    fm = round(hz('D5') * 1.41 * ZONE_S) / ZONE_S
    sear = np.sin(TAU * fc * t + (0.8 + 0.5 * wobble(n, r, (1, 3), 0.6)) * np.sin(TAU * fm * t))
    sear = F.apply(sear, [F.lowpass(3000, 0.7)], circular=True) * wobble(n, r, (2, 3), 0.5)
    steam = band_noise(n, r, np.full(n, 3200.0), 1.0, slope=-2.0) * wobble(n, r, (1, 2, 5), 0.5)
    mid = 0.45 * norm(sear) + norm(steam)
    return zone_out(mid, band_noise(n, r, np.full(n, 5500.0), 0.9, slope=-2.0), 0.35, hp_hz=120, lp_hz=10000)


@cue('f_odrum_ult_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_odrum_ult_zone(v: int):
    r = R('f_odrum_ult_zone', v=v)
    n = ns(ZONE_S)
    hum = F.apply(held(hz('A3'), (1.0, 2.08), (1.0, 0.3), r), [F.lowpass(1800, 0.7)], circular=True)
    ticks = scatter(n, r, 6.0, lambda rr: amber(rr, rr.uniform(600, 1100), 2800) * rr.uniform(0.2, 0.7))
    creak = band_noise(n, r, np.full(n, 380.0), 2.5, slope=-3.0) * wobble(n, r, (1, 2), 0.6)
    knock = scatter(n, r, 0.8, lambda rr: slit(hz('A3'), 0.4, 0.25, rr) * 0.5)
    mid = 0.7 * norm(hum) + 0.55 * norm(ticks) + 0.4 * norm(creak) + 0.3 * norm(knock)
    return zone_out(mid, band_noise(n, r, np.full(n, 1400.0), 0.8, slope=-3.0), 0.3, hp_hz=60, lp_hz=7000)


@cue('f_rishal_a1_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_rishal_a1_zone(v: int):
    r = R('f_rishal_a1_zone', v=v)
    n = ns(ZONE_S)
    ring = drone([(hz('E6'), 1.0), (hz('E6') + 0.5, 0.7), (hz('E6') * 2.76, 0.15)], r) * wobble(n, r, (1, 2), 0.4)
    ticks = scatter(n, r, 9.0, lambda rr: grain(rr, 2500, 7000, (1.0, 3.0), 2.0) * rr.uniform(0.3, 1.0))
    haze = band_noise(n, r, np.full(n, 2400.0), 0.8, slope=-2.5) * wobble(n, r, (1, 3), 0.4)
    mid = 0.6 * norm(ring) + 0.3 * norm(ticks) + 0.5 * norm(haze)
    return zone_out(mid, band_noise(n, r, np.full(n, 5000.0), 0.9, slope=-2.0), 0.3, hp_hz=150, lp_hz=11000)


@cue('f_rishal_a3_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_rishal_a3_zone(v: int):
    r = R('f_rishal_a3_zone', v=v)
    n = ns(ZONE_S)
    whisper = drone([(hz('A6'), 1.0), (hz('A6') + 0.75, 0.8)], r) * wobble(n, r, (1, 2, 3), 0.6)
    air = band_noise(n, r, np.full(n, 6000.0), 1.2, slope=-1.5) * wobble(n, r, (1, 2), 0.5)
    low = band_noise(n, r, np.full(n, 900.0), 0.8, slope=-3.0)
    mid = 0.5 * norm(whisper) + 0.6 * norm(air) + 0.4 * norm(low)
    return zone_out(mid, band_noise(n, r, np.full(n, 7000.0), 1.0, slope=-1.5), 0.4, hp_hz=200, lp_hz=12000)


@cue('f_rishal_ult_zone', 'loop', T_ZONE, ZONE_W, **ZK)
def f_rishal_ult_zone(v: int):
    r = R('f_rishal_ult_zone', v=v)
    n = ns(ZONE_S)
    glints = scatter(n, r, 6.0, lambda rr: rod(hz(str(rr.choice(['E6', 'B6', 'A6']))), 0.25, 0.1, rr) * rr.uniform(0.3, 0.9))
    haze = band_noise(n, r, np.full(n, 1800.0), 0.7, slope=-2.5) * wobble(n, r, (1, 2, 3), 0.45)
    warm = drone([(hz('E4'), 1.0), (hz('E4') + 0.5, 0.6)], r)
    mid = 0.6 * norm(glints) + 0.6 * norm(haze) + 0.25 * norm(warm)
    return zone_out(mid, band_noise(n, r, np.full(n, 4500.0), 0.9, slope=-2.0), 0.4, hp_hz=110, lp_hz=11000)
