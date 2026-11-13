"""Per-ability impacts (max2 SFX-4): every fighter's ULTIMATE and its heaviest Q/W/E land with their own impact
(f_<fighter>_ult_hit, f_<fighter>_<slot>_hit), not the kit's shared ability impact (f_<fighter>_hit, kits_c.py), which
keeps voicing the rest. src/audio/index.ts plays f_<fighter>_<slot>_hit on a 'hit' of that slot's ability when content
binds it, else f_<fighter>_hit.

Round 2 (verify1_q: the round-1 impacts shared one dark pitch-dropping boom, so ults and heavies were confusable
across fighters (ult pairs under the 8 dB identity bar 37/120, heavies 46/120), centroid 541 / 604 Hz against the
shared hits' 1300, 24 of 32 under the HF floors). Each impact is now LED by the fighter's own blow, its shared impact as
kits_c voices it (its material, its crack and contact, its signature instrument struck through it) on its own take
and pitch (TAKE_SEMIS: the takes differ in pitch as well as shape), and the weight comes UNDER it, never over it:

  heavy   that blow, struck twice (a second, quieter blow FLAM_S later: a bigger blow from the same hand), a sub thump
          under 70 Hz (below the identity bands: weight, not a common colour).
  ult     that blow and its flam in a wetter home room, a deep sub boom under 70 Hz; the loudest blow of the kit
          (max momentary T_ULT, about 2 dB over the shared impact as heard).

then the HF floors are solved in (_floors: the fighter's own grit for 2-6 kHz and its air for > 6 kHz, each at the
least level that reaches HF_FLOOR), and the cue gets its own VOICING (IMP_EQ: a minimum-phase curve over EQ_HZ, +-9 dB at
most). The curves were searched so every pair of ults, and every pair of heavies, sits >= 8 dB apart by both kit-gate
measures with the floors held (audio/build.py impact_id_gate), modelling each cue's bands under a curve, then
re-rendering and refining from the real takes. The blow lands first: the take's later 2 ms RMS is held IMP_EASE_DB
under its strike (kits_c._ease, before the master and around the snap), so a flam, boom or room never rides over it.
IMP_TUNE holds the few per-cue fixes (a wider take pitch spread, a shorter strike window, a denser soft clip), each
with its reason.

Mono (they are spatial: the engine pans them, with the pan-law compensation for a mono source; mono halves their
decoded memory) and snapped like the kit hits (kits_c.snap_post). All original synthesis; every random choice is seeded
from the cue id and take.
"""
from __future__ import annotations

import glob
import json
import os

import numpy as np

from cuelib import REGISTRY, cue
from synth import filters as F
from synth import sfx as S
from synth.core import SR, ns

from .fighters import detune
from .kit import Layers, finish, mono, norm, room
from .kits_c import (EASE_SKIP, FIGHTERS, HIT_TAKES, ROOMS, SNAP_RISE_MAX_MS, _band_share, _crack, _ease, _lower, _place,
                     _sig, _solve, _tight, _voice, snap_post)

T_HEAVY = ('m', -16.0)
T_ULT = ('m', -14.7)     # heard about 2.2 dB over the shared impact (catalog gains: both about -0.5 dB)
HEAVYW = (0.15, 1.0)    # (the shared impact's own window, kits_c.IMPW: Odrum's drum lands in 0.2 s)
ULTW = (0.3, 1.6)
IMPK = dict(tail_floor_db=-54.0, clip_drive=1.5, max_gr_db=9.0)   # (cuelib's default GR budget: the snap re-strikes the
                                                                   # onset after the master, so its limiter only shaves the raw crack)
ULTK = dict(tail_floor_db=-56.0, clip_drive=1.5, max_gr_db=9.0)    # the ult's ring and boom run on longer
TAKES = 3
DELIVERY_OPS = ('projectile', 'area', 'zone', 'dash')
CONTENT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..', 'content'))


def _ops(node, out: list) -> None:
    if isinstance(node, dict):
        if isinstance(node.get('op'), str):
            out.append(node)
        for k, v in node.items():
            if k != '$comment':
                _ops(v, out)
    elif isinstance(node, list):
        for v in node:
            _ops(v, out)


def _top(op: dict) -> float:
    """A damage op's base at its top rank (its amount's 'base', a per-rank list or one number)."""
    amt = op.get('amount') if isinstance(op.get('amount'), dict) else op
    v = amt.get('base', 0)
    return float(max(v)) if isinstance(v, list) else float(v or 0)


def impact_slots() -> dict[str, list[str]]:
    """fighter → the slots with their own impact: the heaviest of a1-a3 with a delivery, and the ult when it has one."""
    out: dict[str, list[str]] = {}
    for path in sorted(glob.glob(os.path.join(CONTENT, 'fighters', '*.json'))):
        with open(path, encoding='utf8') as f:
            fd = json.load(f)
        kit = fd.get('kit') or {}
        best, slots = None, []
        for s in ('a1', 'a2', 'a3', 'ult'):
            ab = kit.get(s) or {}
            ops: list = []
            _ops(ab.get('effects', []), ops)
            if not any(o['op'] in DELIVERY_OPS for o in ops):
                continue
            dmg = sum(_top(o) for o in ops if o['op'] == 'damage')
            if s == 'ult':
                slots.append('ult')
            elif dmg > 0 and (best is None or dmg > best[0]):
                best = (dmg, s)
        out[fd['id']] = ([best[1]] if best else []) + slots
    return out


FLAM_S = (0.022, 0.031, 0.017)  # the heavy's second blow, per take
ULT_FLAM_S = (0.034, 0.027, 0.041)  # … and the ult's
HF_FLOOR = (0.05, 0.0085)      # (2-6 kHz, > 6 kHz) energy share of the finished take: the lane's floors 4 % / 0.6 % plus
                               # the codec's and the mastering's margin
FLOORS = True
SUB_LP_HZ = 70.0
TAKE_SEMIS = (0.0, -1.2, 1.0)  # per take: the lead's own pitch (the takes differ in pitch as well as shape: tf <= 0.95)
# the layers' defaults per kind (dB re the lead's peak; None leaves the layer out) …
P_HEAVY = dict(semis=0.0, flam=-6.0, flam_semis=0.0, sig=None, crack=None, grit=None, sub=-14.0, wet=0.0, base=0, floors=True,
               ease_ms=1.0)
P_ULT = dict(semis=0.0, flam=-5.0, sig=None, bloom=None, crack=None, grit=None, air=None, sub=-10.0, wet=0.12, base=0, floors=True,
             ease_ms=1.0)
# … and per cue
IMP_TUNE: dict[str, dict] = {
    # (takes still near-clones after the voicing: a wider pitch spread between them)
    'f_kemdo_a1_hit': {'ts': (0.0, -1.8, 1.5)}, 'f_tunlan_ult_hit': {'ts': (0.0, -1.8, 1.5)},
    'f_hesmi_a1_hit': {'ts': (0.0, -2.2, 1.8)},
    'f_odrum_ult_hit': {'ts': (0.0, -2.5, 2.0), 'flam': -8.0},   # (its drum's second stroke rode over the snap)
    # (Dunsom's wood knocks twice within 3 ms: the strike window is shorter)
    'f_dunsom_ult_hit': {'ease_ms': 0.5}, 'f_dunsom_a2_hit': {'ease_ms': 0.5},
    # (Marund's eased blow is all crack: a denser soft clip shaves it before the limiter, GR <= the 9 dB budget)
    'f_marund_ult_hit': {'clip': 3.0}, 'f_marund_a1_hit': {'clip': 3.0, 'ts': (0.0, -1.2, -0.5)}, 'f_ervet_ult_hit': {'clip': 3.0},
    'f_ervet_a3_hit': {'clip': 3.0},
}


def _p(cid: str, base: dict) -> dict:
    return {**base, **IMP_TUNE.get(cid, {})}


def _lo(x: np.ndarray, ratio: float) -> np.ndarray:
    """kits_c._lower for a mono layer (it returns 2-D)."""
    return _lower(x, ratio)[0] if np.ndim(x) == 1 else _lower(x, ratio)


def _grit(fid: str, v: int) -> tuple[np.ndarray, np.ndarray]:
    crack, grit, _ = _crack(fid, v)
    return crack, grit


def _sub(dur: float, f0: float, f1: float, drop: float, t60: float) -> np.ndarray:
    """A pitch-dropping sine body kept under SUB_LP_HZ (8th order; no saturation: its harmonics would land in the
    identity bands)."""
    y = S.thump(dur, f0, f1, drop, t60, 0.0)
    return norm(F.apply(y, [F.lowpass(SUB_LP_HZ, q) for q in (0.5098, 0.6013, 0.9000, 2.5629)]))


def _lead(fid: str, v: int, semis: float, ts=None) -> np.ndarray:
    """The fighter's shared impact (kits_c's voiced, cracked, contacted take v), `semis` down, its attack cut."""
    x = np.atleast_2d(REGISTRY[f'f_{fid}_hit'].fn(v % HIT_TAKES))
    ts = ts or TAKE_SEMIS
    semis += ts[v % len(ts)]
    if semis:
        x = _lower(x, 2 ** (semis / 12))
    return mono(x)


def _floors(x: np.ndarray, fid: str, v: int, i: int) -> np.ndarray:
    """Solve the HF floors into a finished take (mono): the fighter's grit (its material's 2-6 kHz debris) and its
    air (its own > 6 kHz band), each at the least level that reaches HF_FLOOR."""
    _, grit, air = _crack(fid, v + 23, 1.0, 0.16)
    n = x.size
    lg = _place(n, grit, i + ns(0.002))
    la = _place(n, air, i + ns(0.003))
    g = _solve(x, lg, lambda m: _band_share(m, 2000.0, 6000.0), HF_FLOOR[0], 0.9)
    x = x + g * lg
    a = _solve(x, la, lambda m: _band_share(m, 6000.0), HF_FLOOR[1], 0.6)
    return x + a * la


EASE_MATCH = False  # an impact takes the blow-first pass exactly when its fighter's shared impact does (kits_c.EASE_SKIP)


def _eased(fid: str) -> bool:
    return not (EASE_MATCH and f'f_{fid}_hit' in EASE_SKIP)


IMP_EASE_DB = 1.5   # an impact's later 2 ms RMS sits this far under its strike (kits_c's 0.5 dB left a flam or a bloom
                    # within a codec's smear of it)


def _ez(fid: str, x: np.ndarray, ms: float = 1.5) -> np.ndarray:
    return _ease(x, ms=ms, db=IMP_EASE_DB) if _eased(fid) else x


EQ_HZ = (160.0, 315.0, 630.0, 1250.0, 2500.0, 5000.0, 10000.0)   # the voicing curve's control points …
# … and per cue its gains there (dB): the voicing that sets the 16 ults, and the 16 heavies, >= 8 dB apart by both
# identity measures with the HF floors held (found by modelling each cue's bands under a curve and searching the
# curves, then re-rendering and refining; +-9 dB at most)
IMP_EQ: dict[str, tuple[float, ...]] = {
    'f_ardit_ult_hit': (-7.5, -4.5, 4.5, 3, -7.5, 6, 4.5),
    'f_burdam_ult_hit': (-9, 4.5, 1.5, 1.5, 1.5, 9, -9),
    'f_dunsom_ult_hit': (-7.5, 3, -7.5, -3, 4.5, -9, 3),
    'f_ervet_ult_hit': (-4.5, 7.5, -1.5, 0, 0, 6, 6),
    'f_hesmi_ult_hit': (0, -6, 4.5, -6, 9, -9, 6),
    'f_ilsheta_ult_hit': (0, 4.5, -9, -9, 4.5, 9, -9),
    'f_kemdo_ult_hit': (7.5, -4.5, -6, -9, 4.5, 4.5, 7.5),
    'f_lisvel_ult_hit': (0, 9, -4.5, -4.5, -6, 0, 1.5),
    'f_marund_ult_hit': (-1.5, -7.5, 4.5, -9, -4.5, 6, 7.5),
    'f_nurrow_ult_hit': (-6, 4.5, -9, -6, 0, 7.5, -7.5),
    'f_odrum_ult_hit': (-6, -3, -9, 3, 7.5, 6, 4.5),
    'f_rishal_ult_hit': (-1.5, -9, -9, 0, 6, 1.5, 0),
    'f_sukri_ult_hit': (-9, -6, 4.5, 0, -1.5, 0, 6),
    'f_tunlan_ult_hit': (-6, -9, 4.5, -3, -4.5, 4.5, -3),
    'f_ulkro_ult_hit': (-9, -7.5, -9, -3, 6, 6, 6),
    'f_vashil_ult_hit': (-6, -6, 3, 3, -4.5, 6, 0),
    'f_ardit_a1_hit': (-9, -1.5, 0, -1.5, -1.5, 0, -6),
    'f_burdam_a3_hit': (-9, -9, -4.5, 4.5, 1.5, 9, -9),
    'f_dunsom_a2_hit': (-9, 0, -9, -9, 7.5, -3, -1.5),
    'f_ervet_a3_hit': (9, 9, -7.5, -9, -3, 7.5, 1.5),
    'f_hesmi_a1_hit': (-7.5, -9, 4.5, -1.5, 9, -9, 6),
    'f_ilsheta_a1_hit': (1.5, -7.5, -9, 3, 6, 9, -7.5),
    'f_kemdo_a1_hit': (-7.5, -9, 1.5, 4.5, 6, 9, 9),
    'f_lisvel_a1_hit': (0, 3, 0, -1.5, -4.5, 0, 6),
    'f_marund_a1_hit': (1.5, -4.5, 3, -1.5, -6, 9, 9),
    'f_nurrow_a1_hit': (3, 1.5, -9, -9, -9, 7.5, 4.5),
    'f_odrum_a1_hit': (0, -7.5, -1.5, 3, -9, 1.5, -4.5),
    'f_rishal_a1_hit': (-1.5, -9, -9, 0, -3, 0, 0),
    'f_sukri_a1_hit': (-1.5, 4.5, -9, -9, 1.5, -9, -3),
    'f_tunlan_a1_hit': (-3, -4.5, -4.5, -1.5, 6, 9, 7.5),
    'f_ulkro_a1_hit': (-9, -4.5, -1.5, 0, -4.5, 0, -4.5),
    'f_vashil_a1_hit': (-9, -9, -9, 6, -1.5, 4.5, 9),
}


def _curve(x: np.ndarray, gains) -> np.ndarray:
    """The cue's voicing: a minimum-phase filter whose magnitude is `gains` (dB at EQ_HZ, interpolated over log
    frequency, held flat beyond the ends), so the blow keeps its onset (no pre-ring)."""
    if not gains or not any(gains):
        return x
    N = 4096
    f = np.fft.rfftfreq(N, 1 / SR)
    mag = 10 ** (np.interp(np.log2(np.maximum(f, 1.0)), np.log2(EQ_HZ), gains) / 20)
    cep = np.fft.irfft(np.log(mag), n=N)
    fold = np.zeros(N)
    fold[0], fold[N // 2] = cep[0], cep[N // 2]
    fold[1:N // 2] = 2.0 * cep[1:N // 2]
    h = np.fft.irfft(np.exp(np.fft.rfft(fold)), n=N)[:N // 2]
    h *= np.r_[np.ones(N // 4), 0.5 + 0.5 * np.cos(np.linspace(0.0, np.pi, N // 4))]
    m = np.atleast_2d(x)
    y = np.stack([np.convolve(c, h)[:c.size] for c in m])
    return y[0] if np.ndim(x) == 1 else y


def _opt(L: Layers, make, t: float, db: float | None) -> None:
    if db is not None:
        L.add(make(), t, peak_db=db)


def _onset(x: np.ndarray) -> int:
    e = np.abs(np.atleast_2d(x)).max(axis=0)
    return int(np.argmax(e > e.max() * 0.01))


def _make_heavy(fid: str, slot: str):
    cid = f'f_{fid}_{slot}_hit'

    @cue(cid, 'combat', T_HEAVY, HEAVYW, variants=TAKES, **IMPK)
    def recipe(v: int):
        p = _p(cid, P_HEAVY)
        b = p['base']
        crack, grit = _grit(fid, v + 7)
        L = Layers(0.6)
        L.add(_lead(fid, v + b, p['semis'], p.get('ts')), 0.0, peak_db=0)
        _opt(L, lambda: _lead(fid, v + b, p['semis'] + p['flam_semis'], p.get('ts')), FLAM_S[v % 3], p['flam'])
        _opt(L, lambda: _tight(_sig(fid, v, 0.5)), 0.0, p['sig'])
        _opt(L, lambda: crack, 0.0, p['crack'])
        _opt(L, lambda: grit, 0.003, p['grit'])
        _opt(L, lambda: _sub(0.3, 62 * detune(v, 40), 38, 0.025, 0.2), 0.0, p['sub'])
        x = _ez(fid, mono(room(L.out(), ROOMS[fid], wet=p['wet'])), p['ease_ms'])
        x = mono(_voice(finish(x, hp_hz=30), p.get('eq')))
        x = _floors(x, fid, v, _onset(x)) if p.get('floors', FLOORS) else x
        return _ez(fid, _curve(x, IMP_EQ.get(cid)), p['ease_ms'])
    recipe.__doc__ = (f"{fid.capitalize()}'s heaviest ability ({slot}) lands: its own impact a semitone down struck twice, "
                      f"its signature on the blow, its crack and grit, a sub thump under it.")
    recipe.__name__ = cid
    REGISTRY[cid].extra['post'] = lambda y, v, ceiling=-1.5, boost=0.0, _fid=fid, _cid=cid: snap_post(y, _fid, v, _cid, ceiling, boost, ease=_eased(_fid), ease_db=IMP_EASE_DB)
    REGISTRY[cid].extra['rise_max_ms'] = SNAP_RISE_MAX_MS
    REGISTRY[cid].clip_drive = IMP_TUNE.get(cid, {}).get('clip', REGISTRY[cid].clip_drive)
    return recipe


def _make_ult(fid: str):
    cid = f'f_{fid}_ult_hit'

    @cue(cid, 'combat', T_ULT, ULTW, variants=TAKES, **ULTK)
    def recipe(v: int):
        p = _p(cid, P_ULT)
        b = p['base']
        sig = _tight(_sig(fid, v, 0.9))
        crack, grit = _grit(fid, v + 11)
        _, _, air = _crack(fid, v + 13, 1.0, 0.28)
        L = Layers(1.1)
        L.add(_lead(fid, v + b, p['semis'], p.get('ts')), 0.0, peak_db=0)
        _opt(L, lambda: _lead(fid, v + b, p['semis'], p.get('ts')), ULT_FLAM_S[v % 3], p['flam'])
        _opt(L, lambda: sig, 0.0, p['sig'])
        _opt(L, lambda: mono(_lo(sig, 2.0)), 0.008, p['bloom'])
        _opt(L, lambda: crack, 0.0, p['crack'])
        _opt(L, lambda: grit, 0.004, p['grit'])
        _opt(L, lambda: air, 0.006, p['air'])
        _opt(L, lambda: _sub(0.9, 56 * detune(v, 40), 30, 0.04, 0.55), 0.0, p['sub'])
        x = _ez(fid, mono(room(L.out(), ROOMS[fid], wet=p['wet'])), p['ease_ms'])
        x = mono(_voice(finish(x, hp_hz=25), p.get('eq')))
        x = _floors(x, fid, v, _onset(x)) if p.get('floors', FLOORS) else x
        return _ez(fid, _curve(x, IMP_EQ.get(cid)), p['ease_ms'])
    recipe.__doc__ = (f"{fid.capitalize()}'s ult lands: its own impact struck hard with its signature and that "
                      f"signature's octave-down bloom, its crack, grit and air, a deep sub boom under it, in a wetter "
                      f"{ROOMS[fid]} room.")
    recipe.__name__ = cid
    REGISTRY[cid].extra['post'] = lambda y, v, ceiling=-1.5, boost=0.0, _fid=fid, _cid=cid: snap_post(y, _fid, v, _cid, ceiling, boost, ease=_eased(_fid), ease_db=IMP_EASE_DB)
    REGISTRY[cid].extra['rise_max_ms'] = SNAP_RISE_MAX_MS
    REGISTRY[cid].clip_drive = IMP_TUNE.get(cid, {}).get('clip', REGISTRY[cid].clip_drive)
    return recipe


SLOTS = impact_slots()
for _fid in FIGHTERS:
    for _slot in SLOTS.get(_fid, []):
        if _slot == 'ult':
            globals()[f'f_{_fid}_ult_hit'] = _make_ult(_fid)
        else:
            globals()[f'f_{_fid}_{_slot}_hit'] = _make_heavy(_fid, _slot)
