"""Per-ability impacts (max2 SFX-4): every fighter's ULTIMATE and its heaviest Q/W/E land with their own impact
(f_<fighter>_ult_hit, f_<fighter>_<slot>_hit), not the kit's shared ability impact (f_<fighter>_hit, kits_c.py), which
keeps voicing the rest. src/audio/index.ts plays f_<fighter>_<slot>_hit on a 'hit' of that slot's ability when content
binds it, else f_<fighter>_hit.

  heavy   the heaviest of a1-a3 (the most damage at its top rank among the abilities with a delivery, read from
          content/fighters): the fighter's attack material a minor third down (the shared impact is a whole tone down),
          its signature instrument struck twice, on the call's note and a fifth under it 4 ms later (a doubled strike:
          the ear hears a bigger blow from the same hand), a heavier saturated thump and the material's own crack and
          grit (kits_c._crack) at the onset. 3 takes.
  ult     the fighter's ult lands: its attack material a fourth down, the signature instrument struck hard and its own
          octave-down bloom ringing on after it, a deep pitch-dropping boom, the crack and grit, in a wetter home room.
          3 takes; longer and louder than the heavy (max momentary -16 against -16.5 and the shared impact's -17).

Both are mono (they are spatial: the engine pans them; mono halves their decoded memory) and snap like the kit hits
(kits_c.snap_post: the onset is the peak). All original synthesis; every random choice is seeded from the cue id and take.
"""
from __future__ import annotations

import glob
import json
import os

import numpy as np

from cuelib import REGISTRY, cue
from synth import sfx as S

from .fighters import detune
from .kit import Layers, finish, mono, norm, room
from .kits_a import SOFT_TOP
from .kits_c import FIGHTERS, HIT_BASE, ROOMS, _ORIG, _crack, _lower, _sig, _voice, snap_post, with_body

T_HEAVY = ('m', -16.5)
T_ULT = ('m', -16.0)
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


def _base(fid: str, v: int, semis: float) -> np.ndarray:
    return _lower(_voice(_ORIG[f'f_{fid}_attack_hit'](v), HIT_BASE.get(fid)), 2 ** (semis / 12))


def _lo(x: np.ndarray, ratio: float) -> np.ndarray:
    """kits_c._lower for a mono layer (it returns 2-D)."""
    return _lower(x, ratio)[0] if np.ndim(x) == 1 else _lower(x, ratio)


def _grit(fid: str, v: int) -> tuple[np.ndarray, np.ndarray]:
    crack, grit, _ = _crack(fid, v)
    return crack, grit


def _make_heavy(fid: str, slot: str):
    cid = f'f_{fid}_{slot}_hit'

    @cue(cid, 'combat', T_HEAVY, HEAVYW, variants=TAKES, **IMPK)
    def recipe(v: int):
        sig = _sig(fid, v, 0.55)
        crack, grit = _grit(fid, v + 7)
        L = Layers(0.6)
        L.add(mono(_base(fid, v, 3.0)), 0.0, peak_db=-2)
        L.add(mono(sig), 0.0, peak_db=-1)
        L.add(mono(_lo(sig, 2 ** (7 / 12))), 0.004, peak_db=-6)
        L.add(S.thump(0.3, 165 * detune(v, 30), 70, 0.02, 0.18, 1.8), 0.0, peak_db=-8)
        L.add(crack, 0.0, peak_db=-9)
        L.add(grit, 0.004, peak_db=-14)
        x = mono(room(L.out(), ROOMS[fid], wet=0.12))
        return mono(with_body(finish(x, hp_hz=80, eq=SOFT_TOP)))
    recipe.__doc__ = (f"{fid.capitalize()}'s heaviest ability ({slot}) lands: its attack material a minor third down, its "
                      f"signature struck twice (the call's note and a fifth under it), a heavy thump, its crack and grit.")
    recipe.__name__ = cid
    REGISTRY[cid].extra['post'] = lambda y, v, ceiling=-1.5, _fid=fid, _cid=cid: snap_post(y, _fid, v, _cid, ceiling)
    return recipe


def _make_ult(fid: str):
    cid = f'f_{fid}_ult_hit'

    @cue(cid, 'combat', T_ULT, ULTW, variants=TAKES, **ULTK)
    def recipe(v: int):
        sig = _sig(fid, v, 0.9)
        crack, grit = _grit(fid, v + 11)
        L = Layers(1.1)
        L.add(mono(_base(fid, v, 5.0)), 0.0, peak_db=-3)
        L.add(mono(sig), 0.0, peak_db=0)
        L.add(mono(_lo(sig, 2.0)), 0.006, peak_db=-5)
        L.add(S.thump(0.9, 120 * detune(v, 30), 42, 0.035, 0.6, 2.0), 0.0, peak_db=-5)
        L.add(crack, 0.0, peak_db=-7)
        L.add(grit, 0.005, peak_db=-12)
        x = mono(room(L.out(), ROOMS[fid], wet=0.28))
        return mono(with_body(finish(norm(x), hp_hz=55, eq=SOFT_TOP)))
    recipe.__doc__ = (f"{fid.capitalize()}'s ult lands: its attack material a fourth down, its signature struck hard with "
                      f"its own octave-down bloom, a deep boom, its crack and grit, in a wetter {ROOMS[fid]} room.")
    recipe.__name__ = cid
    REGISTRY[cid].extra['post'] = lambda y, v, ceiling=-1.5, _fid=fid, _cid=cid: snap_post(y, _fid, v, _cid, ceiling)
    return recipe


SLOTS = impact_slots()
for _fid in FIGHTERS:
    for _slot in SLOTS.get(_fid, []):
        if _slot == 'ult':
            globals()[f'f_{_fid}_ult_hit'] = _make_ult(_fid)
        else:
            globals()[f'f_{_fid}_{_slot}_hit'] = _make_heavy(_fid, _slot)
