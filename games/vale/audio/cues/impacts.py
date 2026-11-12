"""Per-ability impacts (max2 SFX-4): every fighter's ULTIMATE and its heaviest Q/W/E land with their own impact
(f_<fighter>_ult_hit, f_<fighter>_<slot>_hit), not the kit's shared ability impact (f_<fighter>_hit, kits_c.py), which
keeps voicing the rest. src/audio/index.ts plays f_<fighter>_<slot>_hit on a 'hit' of that slot's ability when content
binds it, else f_<fighter>_hit.

Round 2 (verify1_q: the round-1 impacts shared one dark pitch-dropping boom, so ults and heavies were confusable
across fighters, centroid 541 / 604 Hz against the shared hits' 1300, 24 of 32 under the HF floors): each impact is now
LED by the fighter's own blow, i.e. its shared impact as kits_c voices it (its material, its crack tuned so the 16 sit
>= 8 dB apart, its contact) on its own take, with its signature instrument struck on top, and the weight comes UNDER
it, never over it:

  heavy   the fighter's shared impact a semitone down, struck twice (a second, lower blow of another take FLAM_S later:
          the ear hears a bigger blow from the same hand), its signature struck with it, the material's crack and grit
          at the onset, and a sub thump below 120 Hz (under the identity bands: it adds weight, not a common colour).
  ult     the shared impact at its own pitch with the signature struck hard and its octave-down bloom ringing on, the
          crack, grit and the material's air tail in the fighter's own upper band, a deep sub boom under 120 Hz, in a
          wetter home room; the loudest blow of the kit (max momentary T_ULT, about 2 dB over the shared impact as
          heard).

Every body layer's attack is cut to its peak (_tight: the 2 ms RMS envelope peaks within TIGHT_MS of the onset, so
the blow itself lands sooner, not only a click in front of it), then the HF floors are solved in (HF_FLOOR: the grit
for 2-6 kHz, the air for > 6 kHz, each at the least level that reaches its floor on the finished take). Per cue,
IMP_TUNE moves the pitch and the signature's level where two fighters' impacts would sit under the identity bar
(audio/build.py impact_id_gate: 8 dB by both measures, ults against ults and heavies against heavies).

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
from synth.core import ns

from .fighters import detune
from .kit import Layers, finish, mono, norm, room
from .kits_c import (FIGHTERS, HIT_TAKES, ROOMS, SNAP_RISE_MAX_MS, _band_share, _crack, _ease, _lower, _place, _sig,
                     _solve, _tight, _voice, snap_post)

T_HEAVY = ('m', -16.0)
T_ULT = ('m', -14.7)     # heard about 2.2 dB over the shared impact (catalog gains: both about -0.5 dB)
HEAVYW = (0.2, 1.0)
ULTW = (0.3, 1.6)
IMPK = dict(tail_floor_db=-54.0, clip_drive=1.5, max_gr_db=6.0)
ULTK = dict(tail_floor_db=-56.0, clip_drive=1.5, max_gr_db=6.0)    # the ult's ring and boom run on longer
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
TAKE_SEMIS = (0.0, 0.0, 0.0)  # per take: the lead's own pitch (the takes differ in pitch as well as shape)              # the boom / thump stay under the identity bands (ID_FROM_HZ 125 Hz)
# the layers' defaults per kind (dB re the lead's peak; None leaves the layer out) …
P_HEAVY = dict(semis=0.0, flam=-6.0, flam_semis=0.0, sig=None, crack=None, grit=None, sub=None, wet=0.0, base=0, floors=False)
P_ULT = dict(semis=0.0, flam=-5.0, sig=None, bloom=None, crack=None, grit=None, air=None, sub=None, wet=0.12, base=0, floors=False)
# … and per cue (found by the identity search: every pair of ults, and of heavies, >= 8 dB apart by both measures)
IMP_TUNE: dict[str, dict] = {}


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


def _lead(fid: str, v: int, semis: float) -> np.ndarray:
    """The fighter's shared impact (kits_c's voiced, cracked, contacted take v), `semis` down, its attack cut."""
    x = np.atleast_2d(REGISTRY[f'f_{fid}_hit'].fn(v % HIT_TAKES))
    semis += TAKE_SEMIS[v % len(TAKE_SEMIS)]
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
        L.add(_lead(fid, v + b, p['semis']), 0.0, peak_db=0)
        _opt(L, lambda: _lead(fid, v + b, p['semis'] + p['flam_semis']), FLAM_S[v % 3], p['flam'])
        _opt(L, lambda: _tight(_sig(fid, v, 0.5)), 0.0, p['sig'])
        _opt(L, lambda: crack, 0.0, p['crack'])
        _opt(L, lambda: grit, 0.003, p['grit'])
        _opt(L, lambda: _sub(0.3, 62 * detune(v, 40), 38, 0.025, 0.2), 0.0, p['sub'])
        x = _ease(mono(room(L.out(), ROOMS[fid], wet=p['wet'])))
        x = mono(_voice(finish(x, hp_hz=30), p.get('eq')))
        return _ease(_floors(x, fid, v, _onset(x)) if p.get('floors', FLOORS) else x)
    recipe.__doc__ = (f"{fid.capitalize()}'s heaviest ability ({slot}) lands: its own impact a semitone down struck twice, "
                      f"its signature on the blow, its crack and grit, a sub thump under it.")
    recipe.__name__ = cid
    REGISTRY[cid].extra['post'] = lambda y, v, ceiling=-1.5, boost=0.0, _fid=fid, _cid=cid: snap_post(y, _fid, v, _cid, ceiling, boost, ease=True)
    REGISTRY[cid].extra['rise_max_ms'] = SNAP_RISE_MAX_MS
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
        L.add(_lead(fid, v + b, p['semis']), 0.0, peak_db=0)
        _opt(L, lambda: _lead(fid, v + b, p['semis']), ULT_FLAM_S[v % 3], p['flam'])
        _opt(L, lambda: sig, 0.0, p['sig'])
        _opt(L, lambda: mono(_lo(sig, 2.0)), 0.008, p['bloom'])
        _opt(L, lambda: crack, 0.0, p['crack'])
        _opt(L, lambda: grit, 0.004, p['grit'])
        _opt(L, lambda: air, 0.006, p['air'])
        _opt(L, lambda: _sub(0.9, 56 * detune(v, 40), 30, 0.04, 0.55), 0.0, p['sub'])
        x = _ease(mono(room(L.out(), ROOMS[fid], wet=p['wet'])))
        x = mono(_voice(finish(x, hp_hz=25), p.get('eq')))
        return _ease(_floors(x, fid, v, _onset(x)) if p.get('floors', FLOORS) else x)
    recipe.__doc__ = (f"{fid.capitalize()}'s ult lands: its own impact struck hard with its signature and that "
                      f"signature's octave-down bloom, its crack, grit and air, a deep sub boom under it, in a wetter "
                      f"{ROOMS[fid]} room.")
    recipe.__name__ = cid
    REGISTRY[cid].extra['post'] = lambda y, v, ceiling=-1.5, boost=0.0, _fid=fid, _cid=cid: snap_post(y, _fid, v, _cid, ceiling, boost, ease=True)
    REGISTRY[cid].extra['rise_max_ms'] = SNAP_RISE_MAX_MS
    return recipe


SLOTS = impact_slots()
for _fid in FIGHTERS:
    for _slot in SLOTS.get(_fid, []):
        if _slot == 'ult':
            globals()[f'f_{_fid}_ult_hit'] = _make_ult(_fid)
        else:
            globals()[f'f_{_fid}_{_slot}_hit'] = _make_heavy(_fid, _slot)
