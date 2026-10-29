"""Per-fighter sound kits, third part (final parity AUD-1, refix 1): every fighter's own ABILITY IMPACT (f_<fighter>_hit,
3 round-robin takes: an area can land on several units in one tick) and its own DASH (f_<fighter>_dash), plus the
identity pass over the kits' attack and ult cues (kits_a.py / kits_b.py):

  hit     the fighter's ability landing (src/audio/index.ts plays it on every 'hit' of the fighter's abilities, before
          the ability's present.hitSfx, so the library c_hit_magic / c_hit_phys_heavy no longer voice nine and six
          fighters). Built from the fighter's own attack hit (its material and contact) a whole tone lower and heavier,
          with the fighter's SIGNATURE instrument struck on its call's first note through it, so the ear ties the
          impact to the auto and to the lock-in call.
  dash    the fighter's own dash (the engine plays it on the fighter's 'dash'; a displacement keeps c_dash): an air
          rush coloured by the fighter's home material and its signature instrument sounded as it leaves the ground.

The identity pass (run on import, over the cues registered by kits_a / kits_b):

  contact  every PHYSICAL fighter's attack hit carries a contact transient (final parity AUD-4, the same floor as the
           library's physical hits): an escapement tick tuned into the fighter's own 2-6 kHz pair, its level solved
           so the first 30 ms after the onset hold CONTACT_SHARE of their power above 2 kHz.
  voicing  VOICING gives an identity cue (attack swing / hit, ult wind-up / release, ability hit) its own band: a
           4th-order high-pass (a small speaker's roll-off then costs a hit little: the kit gate's laptop check), a
           low-pass and a peaking band, in one or two stages, chosen so every fighter sits >= 8 dB from every other
           fighter in the same slot by both 1/3-octave measures in audio/build.py's kit gate (from 125 Hz up over the
           averaged takes, and the closest pair of takes' 125 Hz - 16 kHz confusability) without pushing the
           mastering limiter past its budget. The table was found by search over the takes (rendered and mastered) and
           is baked here as data; the voicing runs before the contact, so the contact is always solved last.

All original synthesis; every random choice is seeded from the cue id and take.
"""
from __future__ import annotations

import numpy as np

from cuelib import REGISTRY, cue
from synth import filters as F
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

CONTACT_SHARE = 0.11         # a physical attack hit's > 2 kHz share of its first 30 ms (the build gate's floor: 0.07)
CONTACT_WIN = 0.03


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
DASH_AIR = {'ardit': (500, 1800), 'burdam': (220, 900), 'dunsom': (700, 2400), 'ervet': (1200, 5000),
            'hesmi': (260, 1000), 'ilsheta': (900, 3000), 'kemdo': (1500, 6000), 'lisvel': (1100, 4200),
            'marund': (240, 800), 'nurrow': (600, 2000), 'odrum': (400, 1500), 'rishal': (2000, 8000),
            'sukri': (1000, 3600), 'tunlan': (300, 1200), 'ulkro': (700, 2600), 'vashil': (800, 3200)}
# a physical fighter's contact: the escapement tick's two resonances (its own pair in 2-6 kHz)
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


def with_contact(x: np.ndarray, fid: str, v: int) -> np.ndarray:
    """Mix the fighter's contact tick in at the onset, at the level that gives CONTACT_SHARE (bisection on the mid)."""
    lo, hi = CONTACT[fid]
    tick = at_len(esc('tick', 0.95, rr=v, seed=f'ct_{fid}{v}', res=(lo, hi), band=0.5 * (lo + hi), q=5.0), CONTACT_WIN)
    tick = F.apply(tick, [F.highpass(lo * 0.6, 0.7071)])
    xs = np.atleast_2d(np.asarray(x, float))
    if xs.shape[0] == 1:
        xs = np.vstack([xs[0], xs[0]])
    e = np.max(np.abs(xs), axis=0)
    i = int(np.argmax(e > e.max() * 0.01))
    t = np.zeros(xs.shape[-1])
    k = min(tick.size, t.size - i)
    t[i:i + k] = norm(tick)[:k]
    mid = xs.mean(axis=0)
    if _share(mid) >= CONTACT_SHARE:
        return xs
    a, b = 0.0, 4.0
    for _ in range(30):
        g = 0.5 * (a + b)
        if _share(mid + g * t) < CONTACT_SHARE:
            a = g
        else:
            b = g
    return norm(xs + b * t[None, :])


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
    'f_marund_attack_swing': {'peaks': ((500, -9.0, 1.4),)},
    'f_marund_ult_release': {'peaks': ((315, 6.0, 1.4),)},
    'f_marund_ult_windup': {'hp': 200},
    'f_odrum_attack_swing': {'hp': 280, 'lp': 1200},
    'f_odrum_ult_release': {'hp': 280, 'peaks': ((3150, 6.0, 1.4),)},
    'f_odrum_ult_windup': {'peaks': ((500, -9.0, 1.4),)},
    'f_tunlan_attack_hit': {'peaks': ((1250, 6.0, 1.4),)},
    'f_tunlan_attack_swing': {'hp': 400, 'peaks': ((2000, -9.0, 1.4),)},
    'f_tunlan_ult_release': {'peaks': ((3150, -9.0, 1.4),)},
    'f_ulkro_attack_hit': {'hp': 200, 'lp': 3200, 'peaks': ((800, -9.0, 1.4),)},
    'f_ulkro_attack_swing': {'lp': 8000, 'peaks': ((5000, 6.0, 1.4),)},
    'f_ulkro_ult_release': {'peaks': ((5000, 6.0, 1.4),)},
    'f_ulkro_ult_windup': {'hp': 400, 'lp': 8000, 'peaks': ((1250, 6.0, 1.4),)},
    'f_vashil_attack_swing': {'peaks': ((500, 6.0, 1.4),)},
    'f_vashil_ult_release': {'hp': 280, 'peaks': ((315, 6.0, 1.4),)},
    'f_ardit_hit': {'hp': 400, 'lp': 1200, 'peaks': ((500, 6.0, 1.4),)},
    'f_burdam_hit': {'hp': 400},
    'f_dunsom_hit': {'peaks': ((1250, -9.0, 1.4),)},
    'f_ervet_hit': {'hp': 280},
    'f_hesmi_hit': {'hp': 800},
    'f_ilsheta_hit': {'lp': 8000, 'peaks': ((800, -9.0, 1.4),)},
    'f_marund_hit': {'hp': 280, 'peaks': ((1250, -9.0, 1.4),)},
    'f_odrum_hit': {'hp': 800, 'lp': 5000, 'peaks': ((800, -9.0, 1.4),)},
    'f_sukri_hit': {'peaks': ((800, -9.0, 1.4),)},
    'f_tunlan_hit': {'lp': 8000, 'peaks': ((315, -9.0, 1.4),)},
    'f_ulkro_hit': {'hp': 400, 'peaks': ((3150, -9.0, 1.4),)},
    'f_vashil_hit': {'hp': 800, 'lp': 3200, 'peaks': ((1250, 6.0, 1.4),)},
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


def _wrap(cid: str, fid: str, physical: bool) -> None:
    spec = REGISTRY[cid]
    fn = _ORIG.setdefault(cid, spec.fn)
    slot = cid[len(f'f_{fid}_'):]

    def voiced(v: int, _fn=fn, _cid=cid):
        x = _fn(v)
        if _cid in VOICING:
            x = _voice(x, VOICING[_cid])
        if physical and slot == 'attack_hit':
            x = with_contact(x, fid, v)
        return x
    voiced.__doc__ = (fn.__doc__ or '') + ' [kits_c identity pass]'
    spec.fn = voiced


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
        L.add(at_len(_sig(fid, v, 0.4), 0.3), 0.0, peak_db=-5)
        L.add(S.knock(r, max(180.0, lo * 0.6), 0.04, 4, 'wood'), 0.0, peak_db=-4)      # the push-off: it lands on its frame
        L.add(breath(0.2, hi, lo, shape='breath', q=2.0, seed=f'{cid}b', peak_at=0.05, vel=0.7), 0.0, peak_db=-12, width=0.5)
        return _fin(room(L.out(), ROOMS[fid], wet=0.08), hp_hz=max(80.0, lo * 0.4), eq=SOFT_TOP)
    recipe.__doc__ = (f"{fid.capitalize()}'s dash: the push-off knock, an air rush through its home band ({DASH_AIR[fid][0]}-"
                      f"{DASH_AIR[fid][1]} Hz) and its signature instrument sounded as it leaves the ground.")
    recipe.__name__ = cid
    return recipe


def _physical() -> set[str]:
    import glob
    import json
    import os
    here = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'content', 'fighters'))
    out = set()
    for p in glob.glob(os.path.join(here, '*.json')):
        with open(p, encoding='utf8') as f:
            fd = json.load(f)
        if (fd.get('attack') or {}).get('damageType', 'phys') in ('phys', 'physical'):
            out.add(fd['id'])
    return out


PHYSICAL = _physical()
for _fid in FIGHTERS:
    for _slot in ('attack_swing', 'attack_hit', 'ult_windup', 'ult_release'):
        if f'f_{_fid}_{_slot}' in REGISTRY:
            _wrap(f'f_{_fid}_{_slot}', _fid, _fid in PHYSICAL and _fid in CONTACT)
    globals()[f'f_{_fid}_hit'] = _make_hit(_fid)
    globals()[f'f_{_fid}_dash'] = _make_dash(_fid)
    _wrap(f'f_{_fid}_hit', _fid, False)
