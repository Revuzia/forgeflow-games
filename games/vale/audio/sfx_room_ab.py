#!/usr/bin/env python3
"""VALE map rooms A/B (max SFX-9): a cue dry (before: every map the same dry studio) vs the same cue with the engine's
room send (after), near and far, through each map's impulse response as the engine plays it: the response scaled the
way a WebAudio ConvolverNode with normalize = true scales it (Chromium: 1 / RMS power x 0.00125 x 44100 / rate), the
send at ROOM_NEAR_DB / ROOM_FAR_DB re the voice (src/audio/index.ts), the return at 0 dB.

    python3 sfx_room_ab.py --cue out/c_hit_phys_light.ogg --sheet ../_design/reviews/max/sfx/sfx9_rooms_ab.png --json …
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from build import decode  # noqa: E402
from synth import loudness as L  # noqa: E402
from synth import viz  # noqa: E402
from synth.core import SR  # noqa: E402
from synth.filters import fft_convolve  # noqa: E402


def engine_db(name: str) -> float:
    src = open(os.path.join(HERE, '..', 'src', 'audio', 'index.ts'), encoding='utf8').read()
    return float(re.search(rf'const {name} = (-?[0-9.]+);', src).group(1))


def webaudio_scale(ir: np.ndarray) -> float:
    p = float(np.sqrt(np.sum(ir ** 2) / ir.size))
    return (1.0 / max(p, 1e-6)) * 0.00125 * (44100.0 / SR)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cue', default=os.path.join(HERE, 'out', 'c_hit_phys_light.ogg'))
    ap.add_argument('--sheet')
    ap.add_argument('--json')
    a = ap.parse_args()
    near, far, ret = engine_db('ROOM_NEAR_DB'), engine_db('ROOM_FAR_DB'), engine_db('ROOM_RETURN_DB')
    x = decode(a.cue)
    rep: dict = {'cue': os.path.basename(a.cue), 'nearDb': near, 'farDb': far, 'returnDb': ret, 'rooms': {}}
    tiles = [viz.tile(x, f'before: dry, every map ({os.path.basename(a.cue)})',
                      [f'{L.max_momentary(x):.1f} LUFS-M  {x.shape[1] / SR * 1000:.0f} ms  (no room send)'])]
    for m in ('rift', 'bridge', 'fray'):
        ir = decode(os.path.join(HERE, 'out', f'room_{m}.ogg'))
        ir = ir * webaudio_scale(ir) * 10 ** (ret / 20)
        wet = np.vstack([fft_convolve(x.mean(axis=0), ir[0], full=True), fft_convolve(x.mean(axis=0), ir[1], full=True)])
        row = {}
        for label, sdb in (('near', near), ('far', far)):
            dry = np.pad(x, ((0, 0), (0, wet.shape[1] - x.shape[1])))
            y = dry + wet * 10 ** (sdb / 20)
            e_dry = float(np.sum(dry ** 2))
            e_wet = float(np.sum((wet * 10 ** (sdb / 20)) ** 2))
            tail = y[:, x.shape[1]:]
            row[label] = {'sendDb': sdb, 'wetToDryDb': round(10 * np.log10(e_wet / e_dry + 1e-30), 1),
                          'lufsM': round(float(L.max_momentary(y)), 1), 'lufsDryM': round(float(L.max_momentary(x)), 1),
                          'tailMs': round(1000 * tail.shape[1] / SR), 'side': round(float(np.sum((0.5 * (y[0] - y[1])) ** 2) / (np.sum((0.5 * (y[0] + y[1])) ** 2) + 1e-30)), 3)}
            if label == 'far':
                tiles.append(viz.tile(y, f'after: room_{m}, far send {sdb:g} dB',
                                      [f"wet/dry {row[label]['wetToDryDb']:+.1f} dB  side/mid {row[label]['side']:.3f}  near {row['near']['wetToDryDb']:+.1f} dB"]))
        rep['rooms'][m] = row
        print(m, json.dumps(row))
    if a.sheet:
        viz.sheet(tiles, 'SFX-9 rooms: dry everywhere (before) vs each map\'s room send (after)', cols=2).save(a.sheet)
    if a.json:
        with open(a.json, 'w', encoding='utf8') as f:
            json.dump(rep, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
