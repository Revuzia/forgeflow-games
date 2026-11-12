"""Per-fighter sound kits, third part (final parity AUD-1, refix 1): every fighter's own ABILITY IMPACT (f_<fighter>_hit,
3 round-robin takes: an area can land on several units in one tick) and its own DASH (f_<fighter>_dash), plus the
identity pass over the kits' attack and ult cues (kits_a.py / kits_b.py):

  hit     the fighter's ability landing (src/audio/index.ts plays it on every 'hit' of the fighter's abilities, before
          the ability's present.hitSfx, so the library c_hit_magic / c_hit_phys_heavy no longer voice nine and six
          fighters). Built from the fighter's own attack hit (its material and contact) a whole tone lower and heavier,
          with the fighter's SIGNATURE instrument struck on its call's first note through it, so the ear ties the
          impact to the auto and to the lock-in call.
  dash    the fighter's own dash (the engine plays it on the fighter's 'dash'; a displacement keeps c_dash): an air
          rush through the fighter's own band (DASH_AIR) coloured by its home room, and its signature instrument
          sounded as it leaves the ground (at DASH_SIG), voiced so every dash is told apart by ear like the attacks.

The identity pass (run on import, over the cues registered by kits_a / kits_b):

  contact  a PHYSICAL fighter's attack hit AND ability hit carry a contact transient inside the library's band for the
           frequent hits (final parity AUD-4: >= 0.07 of the first 30 ms above 2 kHz), and no fighter's attack or
           ability hit passes the 0.30 soft top. A dull hit gets an escapement tick tuned into the fighter's own 2-6 kHz
           pair, its level solved so the first 30 ms after the onset hold CONTACT_SHARE above 2 kHz; a hit brighter
           than CONTACT_TOP has the > 2 kHz band of its onset pulled down (a zero-phase split, so nothing moves in
           time), solved on the MASTERED take (the mastering's soft clip adds its own top). A physical fighter's
           ability hit so keeps the contact of the library hit it replaced (c_hit_phys_* 0.08-0.10).
  body     every identity cue the kit gate checks on a laptop (attack swing / hit, ult release, ability hit) loses at most
           LAPTOP_SOLVE_LU of max momentary loudness through a 220 Hz roll-off: a cue whose weight lives below 250 Hz
           gets that band's own harmonics (an octave-up rectifier, 250-1000 Hz) mixed in at the level that brings the
           loss down, so a laptop hears the weight a big speaker plays as sub (the sub itself is kept).
  voicing  VOICING gives an identity cue (attack swing / hit, ult wind-up / release, ability hit, dash) its own band: a
           4th-order high-pass (a small speaker's roll-off then costs a hit little: the kit gate's laptop check), a
           low-pass and a peaking band, in one or two stages, chosen so every fighter sits >= 8 dB from every other
           fighter in the same slot by both 1/3-octave measures in audio/build.py's kit gate (from 125 Hz up over the
           averaged takes, and the closest pair of takes' 125 Hz - 16 kHz confusability) without pushing the
           mastering limiter past its budget. The table was found by search over the takes (rendered and mastered) and
           is baked here as data; the voicing runs first, then the body, and the contact is always solved last.

All original synthesis; every random choice is seeded from the cue id and take.
"""
from __future__ import annotations

import numpy as np

from cuelib import REGISTRY, cue, master
from synth import filters as F
from synth import fx
from synth import loudness as LD
from synth import sfx as S
from synth.core import SR, hz, ns

from .fighters import detune
from .kit import Layers, R, at_len, breath, clonk, esc, glass, harp, litho, norm, pane, room, sear, whistle
from .kit import finish as _fin
from .kits_a import SOFT_TOP, V3, iron_gong
from .kits_b import cup, dome, growl, handbell, roarer, rod, slit, vessel

T_IMP = ('m', -17.0)         # loudness (max momentary, asset level): an ability impact sits a touch over the auto (-17.5)
T_DASH = ('m', -18.5)
IMPW = (0.15, 0.9)           # QA duration windows (s)
DASHW = (0.2, 0.8)
IMPK = dict(tail_floor_db=-48.0, clip_drive=1.5, max_gr_db=6.0)      # mastering profiles
DASHK = dict(tail_floor_db=-48.0, fade_out=0.02)

CONTACT_SHARE = 0.11         # a kit hit's > 2 kHz share of its first 30 ms (the build gate's floor: 0.07) …
CONTACT_TOP = 0.24           # … a take above this once mastered is tamed to 0.22 (the build gate's soft top for frequent hits: 0.30)
CONTACT_WIN = 0.03
CONTACT_SPLIT_HZ = 2000.0
LAPTOP_SOLVE_LU = 2.4        # the body pass: loss through a 220 Hz roll-off (the build gate: 3 LU)
BODY_LO_HZ = 250.0           # … the band below this lends its harmonics, 250-1000 Hz


# ── each fighter: its signature instrument (struck short), the call's first note, its home room, its contact pair ──
def _sig(fid: str, v: int, dur: float = 0.5) -> np.ndarray:
    """The fighter's signature instrument sounded once, short, on its call's first note (detuned per take)."""
    d = detune(v, 25)
    r = R(f'f_{fid}_sig', v=v)
    if fid == 'ardit':
        return pane(hz('D4') * d, dur, t60=0.3, bright=0.8, r=r)
    if fid == 'burdam':
        return iron_gong(hz('A2') * d, dur, r)
    if fid == 'dunsom':
        return clonk(hz('F4') * d, dur, 0.25, r)
    if fid == 'ervet':
        return glass(hz('E6') * d, dur, 0.85, decay=0.3, bright=0.8, seed=f'ers{v}')
    if fid == 'hesmi':
        return litho(hz('D3') * d, dur, 0.35, r, dark=3200)
    if fid == 'ilsheta':
        return harp(hz('D5') * d, dur, 0.85, bright=0.55, rr=v, seed='ils')
    if fid == 'kemdo':
        return sear(hz('A4') * d, dur, r, index=(4.0, 1.0), sizzle=0.3)
    if fid == 'lisvel':
        return whistle(hz('A5') * d, hz('E6') * d, min(dur, 0.22), r, vib_hz=6.0, cents=10, air=0.1)
    if fid == 'marund':
        return dome(hz('G3') * d, dur, 0.35, r)
    if fid == 'nurrow':
        return vessel(hz('D5') * d, hz('A4') * d, min(dur, 0.3), r, vib=0.0, cents=0.0, attack=0.008, release=2.0)
    if fid == 'odrum':
        return slit(hz('A3') * d, dur, 0.25, r)
    if fid == 'rishal':
        return rod(hz('E6') * d, dur, 0.18, r, bright=0.8)
    if fid == 'sukri':
        return cup(hz('A5') * d, dur, 0.35, wob=4.0, cents=14.0, phase=0.5 * v)
    if fid == 'tunlan':
        return growl(r, min(dur, 0.35), hz('A2') * d, hz('D3') * d, formant=(420, 1000), dark=1700, attack=0.01)
    if fid == 'ulkro':
        return roarer(hz('E3') * d, hz('A3') * d, min(dur, 0.35), r, spin0=6.0, spin1=9.0, swell=False)
    if fid == 'vashil':
        return handbell(hz('D5') * d, dur, 0.4, r, beat=3.0)
    raise KeyError(fid)


ROOMS = {'ardit': 'plate', 'burdam': 'stone', 'dunsom': 'wood', 'ervet': 'glass', 'hesmi': 'stone', 'ilsheta': 'wood',
         'kemdo': 'small', 'lisvel': 'wood', 'marund': 'stone', 'nurrow': 'wood', 'odrum': 'wood', 'rishal': 'glass',
         'sukri': 'glass', 'tunlan': 'wood', 'ulkro': 'wood', 'vashil': 'glass'}
# the dash's air: band of the rush (Hz) — low and heavy for the big bodies, high and thin for the light ones
DASH_AIR = {'ardit': (500, 2500), 'burdam': (280, 560), 'dunsom': (700, 1960), 'ervet': (1200, 4320),
            'hesmi': (210, 420), 'ilsheta': (900, 1800), 'kemdo': (1500, 7500), 'lisvel': (1100, 5500),
            'marund': (240, 1200), 'nurrow': (600, 3000), 'odrum': (500, 2500), 'rishal': (2000, 7200),
            'sukri': (1000, 3600), 'tunlan': (300, 1080), 'ulkro': (700, 3500), 'vashil': (800, 4000)}
# … and its signature instrument's level in it (dB re the rush: DASH_SIG_DB unless the fighter's own is set)
DASH_SIG_DB = -5.0
DASH_SIG: dict[str, float] = {'ilsheta': -9.0, 'kemdo': -9.0, 'lisvel': -2.0, 'marund': -2.0, 'sukri': -9.0, 'ulkro': -9.0}
# a physical fighter's contact: the escapement tick's two resonances (its own pair in 2-6 kHz). The casters' hits keep
# their own onsets (they replaced the bright c_hit_magic, which had no floor to hold); only the soft top applies to them
CONTACT = {'ardit': (3000.0, 4600.0), 'burdam': (2200.0, 3300.0), 'ervet': (4200.0, 6000.0), 'hesmi': (2000.0, 2900.0),
           'kemdo': (3800.0, 5600.0), 'lisvel': (3400.0, 5200.0), 'marund': (2400.0, 3600.0), 'nurrow': (4600.0, 6200.0),
           'odrum': (2600.0, 4000.0), 'rishal': (5000.0, 6600.0), 'ulkro': (2800.0, 4400.0)}
FIGHTERS = sorted(ROOMS)


def _lower(x: np.ndarray, ratio: float) -> np.ndarray:
    """Play a (stereo) take back `ratio` slower (lower and longer), by interpolation."""
    xs = np.atleast_2d(x)
    n = xs.shape[-1]
    m = int(n / ratio)
    src = np.arange(m) * ratio
    return np.vstack([np.interp(src, np.arange(n), c) for c in xs])


# ── the identity pass: contact and voicing (applied to registered recipes on import) ───────────────
def _share(m: np.ndarray, lo: float = 2000.0) -> float:
    e = np.abs(m)
    i = int(np.argmax(e > e.max() * 0.01))
    w = m[i:i + ns(CONTACT_WIN)]
    P = np.abs(np.fft.rfft(w)) ** 2
    f = np.fft.rfftfreq(w.size, 1 / SR)
    return float(P[f >= lo].sum() / (P[f > 20].sum() + 1e-30))


def _mshare(x: np.ndarray, cid: str) -> float:
    """The build gate's contact measure (audio/build.py transient_share: onset on the channels' envelope, power of the
    mid) on the take as the mastering ships it."""
    y = master(x, REGISTRY[cid])[0]
    e = np.max(np.abs(y), axis=0)
    i = int(np.argmax(e > e.max() * 0.01))
    w = y.mean(axis=0)[i:i + ns(CONTACT_WIN)]
    P = np.abs(np.fft.rfft(w)) ** 2
    f = np.fft.rfftfreq(w.size, 1 / SR)
    return float(P[f >= CONTACT_SPLIT_HZ].sum() / (P[f > 20].sum() + 1e-30))


def _tame(xs: np.ndarray, i: int, cid: str) -> np.ndarray:
    """Pull a too-bright onset down to CONTACT_TOP - 0.02 (mastered): the > 2 kHz band of the contact window (a zero-phase
    split: nothing moves in time) scaled down under a window that is whole over the 30 ms after the onset and fades in
    2 ms before and out 15 ms after, its depth solved by bisection."""
    lo_band = F.apply_mag(xs, lambda f: 1.0 / np.sqrt(1.0 + (np.maximum(f, 0.0) / CONTACT_SPLIT_HZ) ** 8))
    hi_band = xs - lo_band
    n = xs.shape[-1]
    w = np.zeros(n)
    a0, a1, b0, b1 = max(0, i - ns(0.002)), i, min(n, i + ns(CONTACT_WIN)), min(n, i + ns(CONTACT_WIN + 0.015))
    w[a0:a1] = 0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, a1 - a0))
    w[a1:b0] = 1.0
    w[b0:b1] = 0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, b1 - b0))
    goal = CONTACT_TOP - 0.02
    a, b = 0.0, 1.0
    for _ in range(18):
        g = 0.5 * (a + b)
        if _mshare(xs - g * w * hi_band, cid) > goal:
            a = g
        else:
            b = g
    return norm(xs - b * w * hi_band)


def with_contact(x: np.ndarray, fid: str, v: int, cid: str) -> np.ndarray:
    """Hold a kit hit's contact in the band (see `contact` in the module doc): a physical fighter's dull take gets its
    contact tick mixed in at the onset, at the level that gives CONTACT_SHARE (bisection on the mid); any take brighter
    than CONTACT_TOP once mastered has its onset's top pulled down (_tame). A caster's take within the top is returned
    as it came."""
    xs = np.atleast_2d(np.asarray(x, float))
    if xs.shape[0] == 1:
        xs = np.vstack([xs[0], xs[0]])
    e = np.max(np.abs(xs), axis=0)
    i = int(np.argmax(e > e.max() * 0.01))
    if fid not in CONTACT:
        return _tame(xs, i, cid) if _mshare(xs, cid) > CONTACT_TOP else x
    lo, hi = CONTACT[fid]
    tick = at_len(esc('tick', 0.95, rr=v, seed=f'ct_{fid}{v}', res=(lo, hi), band=0.5 * (lo + hi), q=5.0), CONTACT_WIN)
    tick = F.apply(tick, [F.highpass(lo * 0.6, 0.7071)])
    t = np.zeros(xs.shape[-1])
    k = min(tick.size, t.size - i)
    t[i:i + k] = norm(tick)[:k]
    mid = xs.mean(axis=0)
    if _share(mid) < CONTACT_SHARE:
        a, b = 0.0, 4.0
        for _ in range(30):
            g = 0.5 * (a + b)
            if _share(mid + g * t) < CONTACT_SHARE:
                a = g
            else:
                b = g
        xs = norm(xs + b * t[None, :])
    if _mshare(xs, cid) > CONTACT_TOP:
        xs = _tame(xs, i, cid)
    return xs


def _laptop_loss(x: np.ndarray) -> float:
    """audio/build.py laptop_loss: max momentary loudness lost through a 4th-order Butterworth 220 Hz high-pass."""
    y = F.apply(np.asarray(x, float), [F.highpass(220.0, 0.5412), F.highpass(220.0, 1.3066)])
    return float(LD.max_momentary(x) - LD.max_momentary(y))


def with_body(x: np.ndarray) -> np.ndarray:
    """The body pass (see `body` in the module doc): a take losing more than LAPTOP_SOLVE_LU on a laptop gets its
    < BODY_LO_HZ band's harmonics (rectified for the even ones, saturated for the odd, band-passed 250-1000 Hz, at the
    sub band's own RMS times a gain solved by bisection) mixed in. A take within budget is returned as it came."""
    xs = np.atleast_2d(np.asarray(x, float))
    if xs.shape[0] == 1:
        xs = np.vstack([xs[0], xs[0]])
    if _laptop_loss(xs) <= LAPTOP_SOLVE_LU:
        return x
    sub = F.apply_mag(xs, lambda f: 1.0 / np.sqrt(1.0 + (np.maximum(f, 0.0) / BODY_LO_HZ) ** 8))
    s = sub / (float(np.max(np.abs(sub))) + 1e-12)
    h = np.abs(s) + np.tanh(3.0 * s)
    h = F.apply(h, [F.highpass(BODY_LO_HZ, 0.5412), F.highpass(BODY_LO_HZ, 1.3066), F.lowpass(1000.0, 0.7071)])
    h *= float(np.sqrt(np.mean(sub ** 2))) / (float(np.sqrt(np.mean(h ** 2))) + 1e-12)
    a, b = 0.0, 4.0
    for _ in range(20):
        g = 0.5 * (a + b)
        if _laptop_loss(xs + g * h) > LAPTOP_SOLVE_LU:
            a = g
        else:
            b = g
    return norm(xs + b * h)


# ── the crack pass (max SFX-2): every kit hit's transient and air, per material, and a take shape of its own ─────────
# A hit is a contact click, the body, and the "air" after it: the bright debris / sizzle that tells the ear something
# broke. Each fighter's crack is struck in its own material and band (a glass tink set, a plate's inharmonic ring, stone
# grit, a wood snap), so the identity distances hold; the air is a short swelling noise tail in the fighter's own
# upper band. Levels are solved per take (bisection): the onset's > 2 kHz share up to CRACK_ONSET (the contact pass
# then keeps the gate's soft top), the whole take's > 6 kHz share up to AIR_SHARE and its 2-6 kHz share up to
# BITE_SHARE. A take already over a goal keeps its own level of that part (a floor of CRACK_MIN_DB re its peak).
# fid → (material, crack centre Hz, air band lo-hi Hz, air t60 s)
CRACK: dict[str, tuple[str, float, tuple[float, float], float]] = {
    'ardit': ('plate', 3600.0, (6000.0, 10500.0), 0.16), 'burdam': ('stone', 2600.0, (4800.0, 8500.0), 0.14),
    'dunsom': ('wood', 2200.0, (4000.0, 7000.0), 0.12), 'ervet': ('glass', 6400.0, (8000.0, 12500.0), 0.18),
    'hesmi': ('stone', 2300.0, (4400.0, 7600.0), 0.15), 'ilsheta': ('wood', 3000.0, (5000.0, 9000.0), 0.13),
    'kemdo': ('click', 7000.0, (9000.0, 13000.0), 0.10), 'lisvel': ('wood', 3800.0, (6000.0, 10000.0), 0.15),
    'marund': ('stone', 2800.0, (5400.0, 9400.0), 0.17), 'nurrow': ('wood', 5000.0, (7000.0, 11500.0), 0.11),
    'odrum': ('wood', 3200.0, (5000.0, 8000.0), 0.14), 'rishal': ('glass', 7400.0, (9000.0, 13500.0), 0.16),
    'sukri': ('glass', 5400.0, (7000.0, 11000.0), 0.2), 'tunlan': ('wood', 2400.0, (4000.0, 6500.0), 0.12),
    'ulkro': ('wood', 3400.0, (6000.0, 9000.0), 0.13), 'vashil': ('glass', 4600.0, (6500.0, 10000.0), 0.22),
}
CRACK_ONSET = 0.17           # the onset's > 2 kHz share a crack lifts a take to (the contact pass tames above 0.24)
AIR_SHARE = 0.014            # the take's > 6 kHz energy share its air lifts it to …
BITE_SHARE = 0.06            # … and its 2-6 kHz share
GRIT_S = 0.08               # the grit's default length (s) …
GRIT_TOP, GRIT_LONG_TOP = 0.5, 0.85   # … and its level cap re the take's peak (a long grit spreads its energy thinner)
CRACK_MIN_DB = -20.0         # a take already bright enough still gets its crack at this level re its peak
AIR_MAX_DB = -9.0            # the air never comes nearer the peak than this (no hiss on top of a hit)
# cue id → (level scale of the solved crack / grit / air, band ratio, mode): found by audio/crack_search.py so every
# fighter keeps >= ID_MIN_DIST_DB from every other in its slot (a dark fighter's identity is its darkness: its crack is
# small). mode 'full': crack, grit and air; 'crack': the onset crack and grit only (no air tail); 'plain': the take as
# the recipe made it (no crack, no take shape). Absent: (1.0, 1.0, 'full'). An optional 4th value is the grit's length
# (s, default GRIT_S): a longer grit is the material's splinter / crumble / tinkle running on behind the crack (a dark
# take's body otherwise drowns a short grit's 2-6 kHz share), its level cap GRIT_LONG_TOP instead of GRIT_TOP.
CRACK_TUNE: dict[str, tuple] = {
    'f_ardit_attack_hit': (0.3, 1.55, 'full', 0.28),
    'f_ardit_hit': (0.8, 1.55, 'crack'),
    'f_burdam_attack_hit': (1.0, 1.55, 'full', 0.28),
    'f_burdam_hit': (0.55, 0.8, 'full'),
    'f_dunsom_attack_hit': (0.0, 1.0, 'full'),
    'f_dunsom_hit': (0.3, 1.0, 'crack'),
    'f_ervet_attack_hit': (1.0, 1.55, 'full'),
    'f_ervet_hit': (1.0, 1.55, 'full'),
    'f_hesmi_attack_hit': (0.0, 1.0, 'full'),
    'f_hesmi_hit': (1.0, 1.55, 'full'),
    'f_ilsheta_hit': (1.0, 1.25, 'full'),
    'f_kemdo_attack_hit': (1.0, 1.55, 'crack'),
    'f_kemdo_hit': (1.0, 1.25, 'full'),
    'f_lisvel_attack_hit': (0.0, 1.0, 'full'),
    'f_lisvel_hit': (1.0, 1.55, 'full', 0.28),
    'f_marund_attack_hit': (0.8, 1.55, 'full'),
    'f_marund_hit': (1.0, 1.55, 'full'),
    'f_nurrow_attack_hit': (1.0, 1.0, 'crack', 0.28),
    'f_nurrow_hit': (0.3, 0.65, 'full'),
    'f_odrum_attack_hit': (0.55, 0.8, 'full'),
    'f_odrum_hit': (1.0, 0.65, 'full'),
    'f_rishal_attack_hit': (1.0, 1.55, 'full'),
    'f_rishal_hit': (0.0, 1.0, 'full'),
    'f_sukri_attack_hit': (1.0, 1.0, 'full', 0.16),
    'f_sukri_hit': (1.0, 1.55, 'full'),
    'f_tunlan_attack_hit': (1.0, 0.8, 'full', 0.28),
    'f_tunlan_hit': (0.0, 1.0, 'full'),
    'f_ulkro_attack_hit': (0.0, 1.0, 'full'),
    'f_ulkro_hit': (0.8, 1.55, 'full'),
    'f_vashil_attack_hit': (1.0, 0.65, 'full', 0.28),
    'f_vashil_hit': (1.0, 0.8, 'full', 0.28),
}
# … and the cues that keep 3 takes (a 4th sat too near another fighter's); every other kit hit has HIT_TAKES
CRACK_TAKES: dict[str, int] = {'f_burdam_hit': 3, 'f_ervet_attack_hit': 3, 'f_hesmi_hit': 3, 'f_odrum_attack_hit': 3, 'f_odrum_hit': 3, 'f_vashil_attack_hit': 3}
# … and the cues whose takes keep a slower body decay than TAKE_SHAPE's (s): f_odrum_hit's short take ended under the
# 0.15 s QA window at tau 0.22 (round 1 relaxed the window to 0.14 s; max2 restores it and re-takes the cue instead)
TAKE_TAU_MIN: dict[str, float] = {'f_odrum_hit': 0.3}
HIT_TAKES = 4                # a kit attack hit and ability hit: 4 takes, each its own shape (TAKE_SHAPE)
# per take: (crack centre ratio, flam: (gap ms, level dB) or None, crack length ms, air t60 ratio, air peak ms,
#            body decay tau s after the first 30 ms (None: untouched), pitch ratio (playback slower > 1))
TAKE_SHAPE = (
    (1.00, None, 2.0, 1.00, 14.0, None, 1.0),
    (1.07, (3.5, -5.0), 1.4, 0.75, 9.0, 0.22, 1.0),
    (0.93, None, 3.2, 1.30, 22.0, 0.40, 1.0),
    (1.12, (2.2, -8.0), 1.0, 0.90, 12.0, 0.30, 2 ** (30 / 1200)),
)


def _crack(fid: str, v: int, ratio: float = 1.0, glen: float = GRIT_S) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(crack, grit, air) for one take of a fighter's hit, each mono and peak-normalised: the crack is the 1-3 ms click
    and its material's ring (glass tinks, plate partials, a wood snap's mode, stone's first chip), the grit the
    material's short debris (2-6 kHz, 10-60 ms), the air a noise tail that swells to its peak and dies in the
    fighter's upper band."""
    mat, fc0, (alo, ahi), at60 = CRACK[fid]
    cr, flam, cms, ar, apk, _, _ = TAKE_SHAPE[v % len(TAKE_SHAPE)]
    r = R(f'f_{fid}_crack', v=v)
    fc = fc0 * cr * ratio * r.uniform(0.97, 1.03)
    alo, ahi = alo * ratio, min(ahi * ratio, 15000.0)
    n = ns(0.06)
    t = np.arange(n) / SR
    k = max(8, ns(cms / 1000.0))
    click = np.zeros(n)
    click[:k] = r.standard_normal(k) * np.linspace(1.0, 0.0, k) ** 2
    click = F.apply(click, [F.highpass(fc * 0.5, 0.7071), F.peaking(fc, 6.0, 1.2), F.lowpass(min(fc * 2.6, 15000.0), 0.7071)])
    if mat == 'glass':
        ring = sum(a * np.sin(2 * np.pi * fc * q * t + r.uniform(0, 6.28)) * np.exp(-6.9078 * t / d)
                   for q, a, d in ((1.0, 1.0, 0.035), (1.52, 0.6, 0.022), (2.31, 0.35, 0.014)))
    elif mat == 'plate':
        ring = sum(a * np.sin(2 * np.pi * fc * q * t + r.uniform(0, 6.28)) * np.exp(-6.9078 * t / d)
                   for q, a, d in ((1.0, 1.0, 0.05), (1.41, 0.7, 0.04), (1.83, 0.45, 0.03), (2.62, 0.3, 0.02)))
    elif mat == 'wood':
        ring = np.sin(2 * np.pi * fc * t) * np.exp(-6.9078 * t / 0.012) + 0.4 * np.sin(2 * np.pi * fc * 1.71 * t) * np.exp(-6.9078 * t / 0.007)
    elif mat == 'stone':
        ring = F.apply(r.standard_normal(n) * np.exp(-6.9078 * t / 0.01), [F.bandpass(fc, 2.5)])
    else:
        ring = np.sin(2 * np.pi * fc * t) * np.exp(-6.9078 * t / 0.006)
    k2 = ns(0.0008)
    ring[:k2] *= np.linspace(0.0, 1.0, k2)
    crack = norm(click) + 0.55 * norm(ring)
    if flam:
        gap, gdb = flam
        d = ns(gap / 1000.0)
        crack[d:] += 10 ** (gdb / 20) * crack[:n - d] * np.cos(np.linspace(0, 0.3, n - d))
    crack = norm(crack)
    gk = glen / GRIT_S                  # a long grit: more grains, spread and dying over its length
    gl = ns(glen)
    grit = np.zeros(gl)
    for _ in range(int(14 * gk * (1.5 if v % len(TAKE_SHAPE) == 2 else 1.0))):
        t0 = r.exponential(0.018 * gk)
        if t0 > glen - 0.015:
            continue
        g = ns(r.uniform(0.0006, 0.0025))
        c = r.standard_normal(g) * np.linspace(1, 0, g) ** 2 * np.exp(-t0 / (0.025 * gk)) * r.uniform(0.3, 1.0)
        i0 = ns(t0)
        grit[i0:i0 + g] += c[:max(0, min(g, gl - i0))]
    grit = norm(F.apply(grit, [F.bandpass(min(fc * 0.85, 5200.0), 1.6), F.highpass(1800.0, 0.7071)]))
    al = ns(max(0.12, at60 * ar * 1.2))
    ta = np.arange(al) / SR
    pk = apk / 1000.0
    env = np.where(ta < pk, (ta / pk) ** 1.5, np.exp(-6.9078 * (ta - pk) / (at60 * ar)))
    air = r.standard_normal(al) * env
    air = F.apply(air, [F.highpass(alo, 0.7071), F.highpass(alo, 0.7071), F.lowpass(ahi, 0.7071), F.lowpass(ahi, 0.7071)])
    air = norm(air * (1.0 + 0.35 * np.sin(2 * np.pi * r.uniform(28, 55) * ta + r.uniform(0, 6.28))))
    fe = ns(0.01)
    air[-fe:] *= np.linspace(1, 0, fe)
    return crack, grit, air


def _band_share(m: np.ndarray, lo: float, hi: float = 1e9) -> float:
    P = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(m.size, 1 / SR)
    return float(P[(f >= lo) & (f < hi)].sum() / (P[f > 20].sum() + 1e-30))


def _place(n: int, layer: np.ndarray, i: int) -> np.ndarray:
    y = np.zeros(n)
    k = max(0, min(layer.size, n - i))
    y[i:i + k] = layer[:k]
    return y


def _solve(base: np.ndarray, layer: np.ndarray, meas, goal: float, top: float) -> float:
    """The smallest gain (re the base's peak, at most `top` linear) that lifts meas(base + g * layer) to goal."""
    if meas(base + top * layer) <= goal:
        return top
    a, b = 0.0, top
    for _ in range(22):
        g = 0.5 * (a + b)
        if meas(base + g * layer) < goal:
            a = g
        else:
            b = g
    return b


def with_crack(x: np.ndarray, fid: str, v: int, cid: str) -> np.ndarray:
    """The crack pass (see the section note): shape the take (TAKE_SHAPE: pitch, body decay), then add its crack at the
    onset, the grit and the air just behind it, each at its solved level scaled by the cue's CRACK_TUNE."""
    tune = CRACK_TUNE.get(cid, (1.0, 1.0, 'full'))
    scale, ratio, mode = tune[:3]
    glen = tune[3] if len(tune) > 3 else GRIT_S
    if mode == 'plain':
        return x
    _, _, _, _, apk, tau, pr = TAKE_SHAPE[v % len(TAKE_SHAPE)]
    if tau:
        tau = max(tau, TAKE_TAU_MIN.get(cid, 0.0))
    xs = np.atleast_2d(np.asarray(x, float))
    if xs.shape[0] == 1:
        xs = np.vstack([xs[0], xs[0]])
    if pr != 1.0:
        xs = _lower(xs, pr)
    e = np.max(np.abs(xs), axis=0)
    i = int(np.argmax(e > e.max() * 0.01))
    n = xs.shape[-1]
    if tau:
        t = (np.arange(n) - i) / SR - 0.03
        xs = xs * np.where(t > 0, np.exp(-np.maximum(t, 0.0) / tau), 1.0)[None, :]
    xs = norm(xs)
    if scale <= 0:
        return xs
    crack, grit, air = _crack(fid, v, ratio, glen)
    lc, lg, la = _place(n, crack, i), _place(n, grit, i + ns(0.004)), _place(n, air, i + ns(0.002))
    mid = xs.mean(axis=0)
    fl = 10 ** (CRACK_MIN_DB / 20)
    g_c = scale * max(fl, _solve(mid, lc, lambda m: _share(m), CRACK_ONSET, 0.8))
    mid = mid + g_c * lc
    g_g = scale * max(fl * 0.7, _solve(mid, lg, lambda m: _band_share(m, 2000.0, 6000.0), BITE_SHARE,
                                     GRIT_LONG_TOP if glen > GRIT_S else GRIT_TOP))
    mid = mid + g_g * lg
    g_a = 0.0 if mode == 'crack' else scale * max(fl * 0.5, _solve(mid, la, lambda m: _band_share(m, 6000.0), AIR_SHARE,
                                                                       10 ** (AIR_MAX_DB / 20)))
    w = np.array([1.0, 0.92])            # the debris sits a touch off-centre (it sums back in mono)
    side = (g_g * lg + g_a * la)
    return norm(xs + (g_c * lc)[None, :] + side[None, :] * w[:, None] + 0.08 * np.vstack([side, -side]))


# ── the snap pass (max2 SFX-2b): every kit hit's onset-to-peak <= SNAP_GOAL_MS ──────────────────────────────────────
# A hit reads as a hit when its loudest instant is its first: the crack above adds bite and air, but a body that swells
# (a drum's stroke, a struck bar's bloom, the signature instrument struck 20-80 ms in) still puts the take's peak 6-80 ms
# after its onset (round 1: median 6.4 ms). The snap is a 1-3 ms transient set at the onset of the MASTERED take
# (snap_post, which audio/build.py runs after cuelib.master and before the codec) so it IS the take's peak,
# SNAP_MARGIN_DB over everything after its first SNAP_WIN_MS (the body's peaks eased under it by a look-ahead limiter
# when they ride that high): the onset-to-peak then sits at the transient's own (< 1 ms). The transient is the take's
# OWN material struck as one impulse: the minimum-phase impulse whose spectrum is the take's (1/6-octave smoothed), cut
# to SNAP_MAX_MS. So a glass hit snaps glassy and a dark wood hit snaps dark, every band keeps its share, and the whole
# energy it adds is a 1-3 ms burst's. Two first tries cost the identity gate (8 dB between fighters) up to 3 dB: a
# foreign material click (it flattened every fighter's spectrum toward its own), and the take's own impulse added
# BEFORE the mastering (the transient then set the soft clip's level, so the body lost the clip's harmonics).
SNAP_GOAL_MS = 2.0           # mastered onset (-40 dB) to peak; the build gate: KIT_RISE_MAX_MS (3 ms, decoded)
SNAP_WIN_MS = 3.0            # the transient window after the onset …
SNAP_MARGIN_DB = 0.8         # … whose peak stands this far over the rest of the take (the codec smears a click a little)
SNAP_PEAK_DBFS = -1.8         # the transient's sample peak (the mastering's true-peak ceiling is -1.5 dBTP)
SNAP_KEEP_DB = 0.5            # a take that already peaks in its first SNAP_WIN_MS by this much keeps its own onset
SNAP_MAX_MS = 2.0            # the transient layer's own length


def _snap_layer(xs: np.ndarray) -> np.ndarray:
    """The take's own impulse (mono, peak 1, SNAP_MAX_MS): the minimum-phase response of its 1/6-octave smoothed spectrum."""
    m = xs.mean(axis=0)
    N = 8192
    P = np.abs(np.fft.rfft(m, n=max(N, 1 << int(np.ceil(np.log2(m.size)))))) ** 2
    f = np.fft.rfftfreq((P.size - 1) * 2, 1 / SR)
    fg = np.fft.rfftfreq(N, 1 / SR)
    c = np.cumsum(P)
    lo = np.searchsorted(f, np.maximum(fg, 20.0) * 2 ** (-1 / 12))
    hi = np.maximum(np.searchsorted(f, np.maximum(fg, 20.0) * 2 ** (1 / 12)), lo + 1)
    mag = np.sqrt((c[np.minimum(hi, c.size - 1)] - c[np.minimum(lo, c.size - 1)]) / (hi - lo)) + 1e-9
    mag[fg < 30.0] = mag[np.argmax(fg >= 30.0)] * np.maximum(fg[fg < 30.0] / 30.0, 1e-3)   # no DC / sub: the body carries those
    cep = np.fft.irfft(np.log(mag), n=N)
    fold = np.zeros(N)
    fold[0], fold[N // 2] = cep[0], cep[N // 2]
    fold[1:N // 2] = 2.0 * cep[1:N // 2]
    h = np.fft.irfft(np.exp(np.fft.rfft(fold)), n=N)
    k = ns(SNAP_MAX_MS / 1000.0)
    y = h[:k].copy()
    fe = ns(0.0008)
    y[-fe:] *= 0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, fe))
    return norm(y)


def snap_post(y: np.ndarray, fid: str, v: int) -> np.ndarray:
    """The snap pass on a MASTERED take (audio/build.py calls it after cuelib.master, before the codec; see the section
    note): when the take's peak is not its first SNAP_WIN_MS, the body's peaks are eased (a look-ahead limiter) to
    SNAP_MARGIN_DB under the transient's level SNAP_PEAK_DBFS, and the take's own impulse is set at the onset at the level
    that puts the window's peak on SNAP_PEAK_DBFS. After the mastering, so its soft clip colours the body exactly as it
    did (a transient added before it moved the clip's harmonics and so the fighter's spectrum)."""
    xs = np.atleast_2d(np.asarray(y, float))
    e = np.max(np.abs(xs), axis=0)
    i = int(np.argmax(e > e.max() * 0.01))
    w = i + ns(SNAP_WIN_MS / 1000.0)
    p = int(np.argmax(e))
    rest = float(np.max(e[w:])) if w < e.size else 0.0
    if (p - i) / SR * 1000.0 <= SNAP_GOAL_MS and float(np.max(e[i:w])) >= rest * 10 ** (SNAP_KEEP_DB / 20):
        return y
    top = 10 ** (SNAP_PEAK_DBFS / 20)
    room_ = top * 10 ** (-SNAP_MARGIN_DB / 20)
    if rest > room_:
        xs = fx.limit(xs, 20 * np.log10(room_) - 0.1, release_ms=40.0)[:, :xs.shape[-1]]
    lay = _place(xs.shape[-1], _snap_layer(xs), i)[None, :]
    a, b = 0.0, 4.0 * top
    for _ in range(24):
        g = 0.5 * (a + b)
        if float(np.max(np.abs(xs + g * lay)[:, i:w])) < top:
            a = g
        else:
            b = g
    return xs + a * lay


def _stages(vc) -> tuple:
    return tuple(vc) if isinstance(vc, (list, tuple)) else ((vc,) if vc else ())


def _voice(x: np.ndarray, vc) -> np.ndarray:
    """Apply a voicing (one stage, or a tuple of stages in order): 4th-order high- / low-pass, peaking bands."""
    for st in _stages(vc):
        fl = []
        if st.get('hp'):
            fl += [F.highpass(st['hp'], 0.5412), F.highpass(st['hp'], 1.3066)]         # 4th order
        if st.get('lp'):
            fl += [F.lowpass(st['lp'], 0.5412), F.lowpass(st['lp'], 1.3066)]
        for f, g, q in st.get('peaks', ()):
            fl.append(F.peaking(f, g, q))
        if fl:
            x = norm(F.apply(np.atleast_2d(np.asarray(x, float)), fl))
    return x


# cue id → {'hp': Hz, 'lp': Hz, 'peaks': ((Hz, dB, Q), …)} (or a tuple of such stages, applied in order): each identity
# cue's own band (see the module doc). Found by a greedy search over the shipped takes: per pair below 9 dB, the voicing
# (high-pass 150-800 Hz, low-pass 1.2-8 kHz, one ±6 / -9 dB peak at 315 Hz-5 kHz) that lifts that fighter's nearest
# distance to >= 9.3 dB with the least change, a laptop's roll-off costing the hits <= 2.6 LU
VOICING: dict[str, dict | tuple] = {
    'f_ardit_attack_hit': {'lp': 8000, 'peaks': ((500, 6.0, 1.4),)},
    'f_ardit_attack_swing': {'hp': 400, 'peaks': ((800, -9.0, 1.4),)},
    'f_burdam_attack_hit': ({'hp': 400, 'lp': 8000, 'peaks': ((3150, 6.0, 1.4),)}, {'hp': 200, 'lp': 8000, 'peaks': ((5000, 6.0, 1.4),)}),
    'f_burdam_ult_release': {'hp': 150, 'lp': 5000, 'peaks': ((315, -9.0, 1.4),)},
    'f_burdam_ult_windup': {'hp': 400},
    'f_dunsom_attack_hit': ({'hp': 200}, {'lp': 1200, 'peaks': ((315, 6.0, 1.4),)}),
    'f_dunsom_ult_release': {'hp': 280, 'lp': 8000},
    'f_ervet_attack_hit': {'hp': 280},
    'f_ervet_attack_swing': {'lp': 1200},
    'f_ervet_ult_release': {'hp': 150, 'lp': 8000},
    'f_hesmi_attack_hit': {'hp': 280, 'peaks': ((2000, 6.0, 1.4),)},
    'f_hesmi_ult_release': {'hp': 280, 'lp': 5000, 'peaks': ((315, -9.0, 1.4),)},
    'f_hesmi_ult_windup': {'peaks': ((1250, 6.0, 1.4),)},
    'f_ilsheta_attack_hit': {'peaks': ((315, -9.0, 1.4),)},
    'f_ilsheta_attack_swing': {'peaks': ((2000, 6.0, 1.4),)},
    'f_ilsheta_ult_windup': {'peaks': ((315, 6.0, 1.4),)},
    'f_kemdo_ult_release': {'hp': 280},
    'f_lisvel_attack_hit': {'hp': 400, 'lp': 5000, 'peaks': ((1250, -9.0, 1.4),)},
    'f_lisvel_ult_windup': {'peaks': ((3150, 6.0, 1.4),)},
    'f_marund_attack_hit': {'hp': 400},
    'f_marund_attack_swing': ({'peaks': ((500, -9.0, 1.4),)}, {'hp': 150, 'peaks': ((315, 6.0, 1.4),)}),
    'f_marund_ult_release': ({'peaks': ((315, 6.0, 1.4),)}, {'lp': 8000, 'peaks': ((1250, -9.0, 1.4),)}),
    'f_marund_ult_windup': {'hp': 200},
    'f_odrum_attack_swing': {'hp': 280, 'lp': 1200},
    'f_odrum_ult_release': {'hp': 280, 'peaks': ((3150, 6.0, 1.4),)},
    'f_odrum_ult_windup': {'peaks': ((500, -9.0, 1.4),)},
    'f_tunlan_attack_swing': {'hp': 400, 'peaks': ((2000, -9.0, 1.4),)},
    'f_tunlan_ult_release': {'peaks': ((3150, -9.0, 1.4),)},
    'f_ulkro_attack_hit': {'hp': 200, 'lp': 3200, 'peaks': ((800, -9.0, 1.4),)},
    'f_ulkro_attack_swing': {'lp': 8000, 'peaks': ((5000, 6.0, 1.4),)},
    'f_ulkro_ult_release': {'peaks': ((5000, 6.0, 1.4),)},
    'f_ulkro_ult_windup': {'hp': 400, 'lp': 8000, 'peaks': ((1250, 6.0, 1.4),)},
    'f_vashil_attack_swing': {'peaks': ((500, 6.0, 1.4),)},
    'f_vashil_ult_release': {'hp': 280, 'peaks': ((315, 6.0, 1.4),)},
    'f_ardit_hit': {'hp': 400, 'lp': 1200, 'peaks': ((500, 6.0, 1.4),)},
    'f_burdam_hit': ({'hp': 400}, {'hp': 280}),
    'f_dunsom_hit': {'peaks': ((1250, -9.0, 1.4),)},
    'f_ervet_hit': {'hp': 280},
    'f_hesmi_hit': ({'hp': 800}, {'hp': 400, 'lp': 1200, 'peaks': ((500, 6.0, 1.4),)}),
    'f_ilsheta_hit': {'lp': 8000, 'peaks': ((800, -9.0, 1.4),)},
    'f_marund_hit': {'hp': 280, 'peaks': ((1250, -9.0, 1.4),)},
    'f_odrum_hit': {'hp': 800, 'lp': 5000, 'peaks': ((800, -9.0, 1.4),)},
    'f_sukri_hit': {'peaks': ((800, -9.0, 1.4),)},
    'f_tunlan_hit': {'lp': 8000, 'peaks': ((315, -9.0, 1.4),)},
    'f_ulkro_hit': {'hp': 400, 'peaks': ((3150, -9.0, 1.4),)},
    'f_vashil_hit': {'hp': 800, 'lp': 3200, 'peaks': ((1250, 6.0, 1.4),)},
    # max SFX-2 fix: the voicings that make room for a bright crack (crack_search.py, then a voicing pass per dark hit)
    'f_lisvel_hit': {'peaks': ((2000, -9.0, 1.4),)},
    'f_sukri_attack_hit': {'hp': 800},
    'f_tunlan_attack_hit': ({'peaks': ((1250, 6.0, 1.4),)}, {'hp': 800}),
    # the dashes (integration audio-09): with DASH_AIR / DASH_SIG, each sits >= 8 dB by both measures from every other
    # fighter's and from the displacement's c_dash (a knocked unit), found by the same kind of search; a dash's voicing
    # colours its rush and never cuts its own band away (high-pass <= 1.26 x the band's floor, low-pass >= 0.8 x its
    # top), so the big bodies' dashes stay low and heavy
    'f_ardit_dash': {'hp': 200, 'lp': 3200},
    'f_burdam_dash': {'hp': 280, 'peaks': ((500, 6.0, 1.4),)},
    'f_dunsom_dash': {'hp': 400, 'peaks': ((5000, -9.0, 1.4),)},
    'f_ervet_dash': {'lp': 5000},
    'f_hesmi_dash': {'peaks': ((1250, -9.0, 1.4),)},
    'f_ilsheta_dash': {'lp': 1800},
    'f_kemdo_dash': {'peaks': ((800, -9.0, 1.4),)},
    'f_lisvel_dash': {'peaks': ((2000, -9.0, 1.4),)},
    'f_marund_dash': {'lp': 1800, 'peaks': ((500, -9.0, 1.4),)},
    'f_nurrow_dash': {'peaks': ((500, 6.0, 1.4),)},
    'f_odrum_dash': {'lp': 5000, 'peaks': ((800, -9.0, 1.4),)},
    'f_sukri_dash': {'hp': 400},
    'f_ulkro_dash': {'hp': 400, 'peaks': ((2000, -9.0, 1.4),)},
    'f_vashil_dash': {'lp': 8000},
}

# the ability impact's base: the attack hit as first voiced when the impacts' own voicings were found (kept fixed here, so a
# later change to an attack hit's VOICING does not move its fighter's impact)
HIT_BASE: dict[str, dict] = {
    'ardit': {'lp': 8000, 'peaks': ((500, 6.0, 1.4),)},
    'burdam': {'hp': 400, 'lp': 8000, 'peaks': ((3150, 6.0, 1.4),)},
    'dunsom': {'hp': 200},
    'ervet': {'hp': 280},
    'hesmi': {'hp': 280, 'peaks': ((2000, 6.0, 1.4),)},
    'ilsheta': {'hp': 200, 'peaks': ((800, -9.0, 1.4),)},
    'lisvel': {'hp': 800},
    'marund': {'hp': 400},
    'tunlan': {'peaks': ((1250, 6.0, 1.4),)},
    'ulkro': {'hp': 800, 'peaks': ((500, -9.0, 1.4),)},
}

_ORIG: dict[str, object] = {}


BODY_SLOTS = ('attack_swing', 'attack_hit', 'ult_release', 'hit')    # the slots the kit gate checks on a laptop
CONTACT_SLOTS = ('attack_hit', 'hit')                                  # … and for a contact


def _wrap(cid: str, fid: str) -> None:
    spec = REGISTRY[cid]
    fn = _ORIG.setdefault(cid, spec.fn)
    slot = cid[len(f'f_{fid}_'):]

    def voiced(v: int, _fn=fn, _cid=cid):
        x = _fn(v)
        if _cid in VOICING:
            x = _voice(x, VOICING[_cid])
        if slot in BODY_SLOTS:
            x = with_body(x)
        if slot in CONTACT_SLOTS:
            x = with_crack(x, fid, v, _cid)
            x = with_contact(x, fid, v, _cid)
        return x
    voiced.__doc__ = (fn.__doc__ or '') + ' [kits_c identity pass]'
    spec.fn = voiced
    if slot in CONTACT_SLOTS:
        spec.variants = CRACK_TAKES.get(cid, HIT_TAKES)
        spec.extra['post'] = lambda y, v, _fid=fid: snap_post(y, _fid, v)


# ── recipes ──────────────────────────────────────────────────────────────────────────────────────
def _make_hit(fid: str):
    cid = f'f_{fid}_hit'

    @cue(cid, 'combat', T_IMP, IMPW, variants=V3, **IMPK)
    def recipe(v: int):
        ah = f'f_{fid}_attack_hit'
        base = _lower(_voice(_ORIG[ah](v), HIT_BASE.get(fid)), 2 ** (2 / 12))     # the auto's material, a whole tone down
        L = Layers(0.7)
        L.add(base, 0.0, peak_db=-2)
        L.add(_sig(fid, v, 0.5), 0.003, peak_db=-1)
        L.add(S.thump(0.22, 180 * detune(v, 30), 90, 0.02, 0.12, 1.6), 0.0, peak_db=-12)
        return _fin(room(L.out(), ROOMS[fid], wet=0.1), hp_hz=90, eq=SOFT_TOP)
    recipe.__doc__ = (f"{fid.capitalize()}'s ability lands: its own attack hit a whole tone down and heavier, its signature "
                      f"instrument struck through it (the call's first note).")
    recipe.__name__ = cid
    return recipe


def _make_dash(fid: str):
    cid = f'f_{fid}_dash'

    @cue(cid, 'combat', T_DASH, DASHW, instant=True, **DASHK)
    def recipe(v: int):
        r = R(cid, v=v)
        lo, hi = DASH_AIR[fid]
        L = Layers(0.45)
        L.add(S.whoosh(r, 0.28, lo, lo * 1.4, q=1.2, peak_at=0.28, f_mid=hi, low_body=0.3), 0.0, peak_db=0, width=0.6)
        L.add(at_len(_sig(fid, v, 0.4), 0.3), 0.0, peak_db=DASH_SIG.get(fid, DASH_SIG_DB))
        L.add(S.knock(r, max(180.0, lo * 0.6), 0.04, 4, 'wood'), 0.0, peak_db=-4)      # the push-off: it lands on its frame
        L.add(breath(0.2, hi, lo, shape='breath', q=2.0, seed=f'{cid}b', peak_at=0.05, vel=0.7), 0.0, peak_db=-12, width=0.5)
        return _fin(room(L.out(), ROOMS[fid], wet=0.08), hp_hz=max(80.0, lo * 0.4), eq=SOFT_TOP)
    recipe.__doc__ = (f"{fid.capitalize()}'s dash: the push-off knock, an air rush through its home band ({DASH_AIR[fid][0]}-"
                      f"{DASH_AIR[fid][1]} Hz) and its signature instrument sounded as it leaves the ground.")
    recipe.__name__ = cid
    return recipe


for _fid in FIGHTERS:
    for _slot in ('attack_swing', 'attack_hit', 'ult_windup', 'ult_release'):
        if f'f_{_fid}_{_slot}' in REGISTRY:
            _wrap(f'f_{_fid}_{_slot}', _fid)
    globals()[f'f_{_fid}_hit'] = _make_hit(_fid)
    globals()[f'f_{_fid}_dash'] = _make_dash(_fid)
    _wrap(f'f_{_fid}_hit', _fid)
    _wrap(f'f_{_fid}_dash', _fid)
