"""Music bed registry + mastering (lane AUDIO).

A bed function returns ({'main': stereo, '<layer>': stereo, …}, meta). Every stem is a seamless loop
(rendered with tail wrap, mastered with circular filters/limiter). Targets follow tokens.audio.loudness:

    main stem   gated integrated LUFS  -23   (bedsLUFS; the runtime gain 0.75-0.8 and the music bus sit on top)
    layer stem  gated integrated LUFS  -25   (additive: main + layer lands near -21 LUFS = the "combat" lift)
    true peak   <= -1.5 dBTP on main, <= -3 dBTP on a layer (their sum is caught by the engine's master limiter)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from synth import fx
from synth import loudness as L
from synth.core import SR, db, stereo

MAIN_LUFS = -23.0
LAYER_LUFS = -25.0


@dataclass
class BedSpec:
    id: str
    fn: Callable[[], tuple[dict, dict]]
    notes: str = ''
    main_lufs: float = MAIN_LUFS
    layer_lufs: float = LAYER_LUFS
    extra: dict = field(default_factory=dict)


REGISTRY: dict[str, BedSpec] = {}


def bed(id: str, **kw):
    def deco(fn):
        REGISTRY[id] = BedSpec(id, fn, **kw)
        return fn
    return deco


def master_stem(x: np.ndarray, target_lufs: float, tp_ceiling: float, comp: bool = True, sat: float = 0.0) -> tuple[np.ndarray, dict]:
    """DC/rumble clean → gentle multiband glue → optional tape-ish saturation → loudness → circular true-peak limit."""
    y = stereo(np.asarray(x, float))
    y = fx.eq(y, [('hp', 28.0, 0.7), ('hp', 28.0, 0.7)], circular=True)
    y = y - np.mean(y, axis=1, keepdims=True)
    if comp:
        y = fx.multiband_compress(y, circular=True,
                                  settings=[dict(threshold_db=-27, ratio=1.8, attack=0.03, release=0.35),
                                            dict(threshold_db=-26, ratio=1.5, attack=0.02, release=0.25),
                                            dict(threshold_db=-30, ratio=1.6, attack=0.008, release=0.18)])
    if sat:
        y = fx.saturate(y, 1.5, sat)
    cur = L.integrated(y, circular=True)
    g = target_lufs - cur
    out = y
    for _ in range(4):
        out = fx.limit(y * db(g), tp_ceiling, circular=True)
        got = L.integrated(out, circular=True)
        err = target_lufs - got
        if abs(err) < 0.15:
            break
        g += err
    return out, dict(target=target_lufs, achieved=float(got), gain_db=float(g), true_peak=float(L.true_peak(out, circular=True)))


def master_bed(stems: dict[str, np.ndarray], spec: BedSpec) -> tuple[dict[str, np.ndarray], dict]:
    out, info = {}, {}
    for k, x in stems.items():
        if k == 'main':
            out[k], info[k] = master_stem(x, spec.main_lufs, -1.5)
        else:
            out[k], info[k] = master_stem(x, spec.layer_lufs, -3.0)
    return out, info
