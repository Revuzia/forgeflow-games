#!/usr/bin/env python3
"""VALE sfx A/B evidence (max SFX lane): measure decoded cue files and draw a before/after contact sheet.

    python3 sfx_ab.py --pair "label=<before glob>|<after glob>" [--pair …] --sheet out.png --json out.json

Each side of a pair is a glob (several joined by ';') of decoded-able files (.ogg / .m4a), e.g. a copy of the shipped files taken before a
rebuild and audio/out/<cue>*.ogg after it. Per side (the mean over its takes): max momentary loudness (LUFS),
true peak (dBTP), onset rise (ms from the -40 dB onset to the peak of the sample envelope), spectral centroid (Hz),
energy share 2-6 kHz / 6-12 kHz / above 12 kHz, side/mid energy, and the take similarity: the highest correlation
between two takes' smoothed log spectra (1/6-octave, 100 Hz - 16 kHz; the max audit's measure; 1.0 = clones).
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

from build import decode  # noqa: E402
from synth import loudness as L  # noqa: E402
from synth import viz  # noqa: E402
from synth.core import SR  # noqa: E402


def logspec(x: np.ndarray) -> np.ndarray:
    m = x.mean(axis=0)
    P = np.abs(np.fft.rfft(m, n=1 << int(np.ceil(np.log2(max(m.size, 4096)))))) ** 2
    f = np.fft.rfftfreq((P.size - 1) * 2, 1 / SR)
    cs = 100.0 * 2 ** (np.arange(0, 7.4, 1 / 6))
    b = np.array([P[(f >= c * 2 ** (-1 / 12)) & (f < c * 2 ** (1 / 12))].sum() for c in cs])
    return 10 * np.log10(b / (b.sum() + 1e-30) + 1e-12)


def metrics(x: np.ndarray) -> dict:
    m = x.mean(axis=0)
    P = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(m.size, 1 / SR)
    tot = P[f > 20].sum() + 1e-30
    e = np.max(np.abs(x), axis=0)
    i0 = int(np.argmax(e > e.max() * 0.01))
    side = 0.5 * (x[0] - x[1])
    return dict(lufs=float(L.max_momentary(x)), tp=float(L.true_peak(x)),
                rise_ms=float((int(np.argmax(e)) - i0) / SR * 1000), centroid=float((P * f).sum() / tot),
                b2_6=float(P[(f >= 2000) & (f < 6000)].sum() / tot), b6_12=float(P[(f >= 6000) & (f < 12000)].sum() / tot),
                b12=float(P[f >= 12000].sum() / tot), side=float(np.sum(side ** 2) / (np.sum(m ** 2) + 1e-30)),
                dur_ms=float(x.shape[1] / SR * 1000))


def side_stats(files: list[str]) -> tuple[dict, list[np.ndarray]]:
    xs = [decode(p) for p in files]
    ms = [metrics(x) for x in xs]
    out = {k: float(np.mean([m[k] for m in ms])) for k in ms[0]} if ms else {}
    sp = [logspec(x) for x in xs]
    sims = [float(np.corrcoef(sp[i], sp[j])[0, 1]) for i in range(len(sp)) for j in range(i + 1, len(sp))]
    out['takes'] = len(xs)
    out['takeSim'] = max(sims) if sims else None
    out['files'] = [os.path.basename(p) for p in files]
    return out, xs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pair', action='append', default=[], help='label=<before glob>|<after glob>')
    ap.add_argument('--sheet')
    ap.add_argument('--json')
    ap.add_argument('--title', default='VALE sfx A/B')
    a = ap.parse_args()
    rep, tiles = {}, []
    for p in a.pair:
        label, globs = p.split('=', 1)
        bg, ag = globs.split('|', 1)
        row = {}
        for side, g in (('before', bg), ('after', ag)):
            files = sorted({f for gg in g.split(';') if gg for f in glob.glob(gg)})
            if not files:
                row[side] = None
                continue
            st, xs = side_stats(files)
            row[side] = st
            sim = f"  sim {st['takeSim']:.3f}" if st['takeSim'] is not None else ''
            lines = [f"{side}: {st['takes']} take(s)  {st['lufs']:.1f} LUFS-M  tp {st['tp']:.1f}  rise {st['rise_ms']:.1f} ms",
                     f"centroid {st['centroid']:.0f} Hz  2-6k {st['b2_6'] * 100:.1f}%  6-12k {st['b6_12'] * 100:.1f}%{sim}"]
            tiles.append(viz.tile(xs[0], f'{label} [{side}] {os.path.basename(files[0])}', lines))
        rep[label] = row
        print(f"{label:28s} " + '  |  '.join(
            f"{s}: n{r['takes']} {r['lufs']:.1f}LUFS rise {r['rise_ms']:.1f}ms cen {r['centroid']:.0f} 2-6k {r['b2_6'] * 100:.1f}% "
            f"6-12k {r['b6_12'] * 100:.1f}% sim {r['takeSim'] if r['takeSim'] is None else round(r['takeSim'], 3)}"
            if r else f'{s}: -' for s, r in row.items()))
    if a.sheet:
        os.makedirs(os.path.dirname(os.path.abspath(a.sheet)), exist_ok=True)
        viz.sheet(tiles, a.title, cols=2).save(a.sheet)
    if a.json:
        with open(a.json, 'w', encoding='utf8') as f:
            json.dump(rep, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
