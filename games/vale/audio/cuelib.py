"""Cue registry + mastering chain (lane AUDIO).

A cue is a function `fn(variant:int) -> stereo float array` registered with @cue. The build renders
every variant, runs `master()` (DC block, tail trim, loudness match, soft clip, true-peak limit) and
encodes. Targets follow tokens.audio.loudness:

    ('m',  x)  max momentary (400 ms) LUFS   - one-shots; UI -24..-20, queue pop -14
    ('st', x)  max short-term (3 s) LUFS     - stings (-16); defeat's -4 LU is the cue GAIN, not the asset
    ('int', x) gated integrated LUFS         - loops and beds (-23)
    ('pk', x)  sample peak dBFS              - the hover tick (-20 asset = -32 after gain/bus/master)
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from synth import fx
from synth import loudness as L
from synth.core import SR, db, fade, ns, stereo, trim_tail

CEILING_DBTP = -1.5          # pre-encode ceiling; the decoded OGG is re-checked against -1.0


@dataclass
class CueSpec:
    id: str
    fn: Callable[[int], np.ndarray]
    cat: str                              # ui | match | combat | sting | loop
    target: tuple[str, float]
    dur: tuple[float, float]              # allowed duration window (s) — QA flags outside
    variants: int = 1
    tail_floor_db: float = -62.0
    fade_out: float = 0.012
    clip_drive: float = 1.0               # >1 = soft-clip density before the limiter
    loop: bool = False
    max_gr_db: float = 9.0                # limiter reduction we accept before reporting
    notes: str = ''
    extra: dict = field(default_factory=dict)


REGISTRY: dict[str, CueSpec] = {}


def cue(id: str, cat: str, target: tuple[str, float], dur: tuple[float, float], variants: int = 1, **kw):
    def deco(fn):
        REGISTRY[id] = CueSpec(id, fn, cat, target, dur, variants, **kw)
        return fn
    return deco


# ── measuring ────────────────────────────────────────────────────────────────────────────────────
def measure(x: np.ndarray, kind: str, circular: bool = False) -> float:
    if kind == 'm':
        return L.max_momentary(x)
    if kind == 'st':
        return L.max_short_term(x, circular=circular)
    if kind == 'int':
        return L.integrated(x, circular=circular)
    if kind == 'pk':
        return L.sample_peak_db(x)
    raise ValueError(kind)


def dc_clean(x: np.ndarray, circular: bool = False) -> np.ndarray:
    """High-pass at 14 Hz (keeps the sub body) and remove mean."""
    y = fx.dc_block(stereo(x), 14.0, circular=circular)
    return y - np.mean(y, axis=1, keepdims=True)


def master(x: np.ndarray, spec: CueSpec, ceiling: float = CEILING_DBTP) -> tuple[np.ndarray, dict]:
    """Trim → match loudness → soft clip → true-peak limit. Returns (stereo, info)."""
    y = stereo(np.asarray(x, float))
    info: dict = {}
    y = dc_clean(y, circular=spec.loop)
    if not spec.loop:
        y = trim_tail(y, spec.tail_floor_db, spec.fade_out)
        # 0.4 ms fade-in guards the first sample against a click
        y = fade(y, 0.0004, 0.0)
    kind, tgt = spec.target
    cur = measure(y, kind, spec.loop)
    if not np.isfinite(cur):
        info['error'] = 'silent'
        return y, info
    g = tgt - cur
    gr_total = 0.0
    out = y
    for _ in range(4):
        z = y * db(g)
        if spec.clip_drive > 1.0 and not spec.loop:
            z = z + 0.0  # clip handled below on the scaled signal
            pk = float(np.max(np.abs(z))) + 1e-12
            zc = np.tanh(z * spec.clip_drive) / np.tanh(spec.clip_drive * pk) * pk if pk > 0 else z
            z = zc
        out = fx.limit(z, ceiling, circular=spec.loop) if kind != 'pk' else z
        got = measure(out, kind, spec.loop)
        gr = db_(np.max(np.abs(z))) - db_(np.max(np.abs(out)))
        gr_total = max(gr_total, gr)
        err = tgt - got
        if abs(err) < 0.25 or kind == 'pk':
            break
        g += err
        if g - (tgt - cur) > spec.max_gr_db + 6:        # pushing a peaky sound far into the limiter
            break
    info.update(target=tgt, kind=kind, achieved=float(got), gain_db=float(g), limiter_gr_db=float(gr_total))
    return out, info


def db_(x: float) -> float:
    return 20.0 * np.log10(max(x, 1e-12))
