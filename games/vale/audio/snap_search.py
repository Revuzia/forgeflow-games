#!/usr/bin/env python3
"""VALE snap search (max2 SFX-2b): find kits_c.SNAP_TUNE, the per-cue snap setting that keeps every fighter >= the kit
gate's identity distance from every other in its slot (audio/build.py id_distance, both measures) with a margin for the
codec, while as many kit hits as possible snap (onset to peak <= kits_c.SNAP_GOAL_MS).

    python3 snap_search.py [--margin 0.15] [-j 6]

Every kit attack hit and ability hit is rendered and mastered once per take (cuelib.master, no codec), then measured
under each snap state, in order of preference: the default (SNAP_MARGIN_DB, SNAP_MAX_MS), a lighter easing and a
shorter transient, and none (the cue keeps its own onset). Greedy: while a pair in a slot sits under the bar, the cue of
that pair whose next state lifts its own nearest distance most moves on. Prints the table to paste into
kits_c.SNAP_TUNE (only the cues that leave the default) and each cue's mastered onset-to-peak per take.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import os
import sys
import warnings

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
warnings.filterwarnings('ignore')

import numpy as np  # noqa: E402

STATES = ('default', (0.3, 2.0), (0.3, 1.0), (0.1, 1.0), None)   # (0.1, 1.0): max2 round 2, the lightest easing
SLOTS = ('attack_hit', 'hit')


def _feats(cid: str) -> dict:
    import cues  # noqa: F401
    import build as B
    from cuelib import REGISTRY, master
    from cues import kits_c as K
    sp = REGISTRY[cid]
    centres = 1000.0 * 2.0 ** (np.arange(-16, 13) / 3.0)
    ys = [master(sp.fn(v), sp)[0] for v in range(sp.variants)]
    out = {}
    for st in STATES:
        K.SNAP_TUNE[cid] = (K.SNAP_MARGIN_DB, K.SNAP_MAX_MS) if st == 'default' else st
        ps, takes, rises = [], [], []
        for v, y in enumerate(ys):
            z = sp.extra['post'](y, v)
            ps.append(10 ** (B.third_octave_db(z) / 10))
            takes.append(B.confuse_db(z))
            e = np.max(np.abs(z), axis=0)
            i = int(np.argmax(e > e.max() * 0.01))
            rises.append(round(float(np.argmax(e) - i) / 48.0, 1))
        hi = np.mean(ps, axis=0)[centres >= B.ID_FROM_HZ * 0.99]
        hi = hi / (hi.sum() + 1e-30)
        out[str(st)] = {'hi': 10 * np.log10(np.maximum(hi, 1e-9)), 'takes': takes, 'rise': rises}
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--margin', type=float, default=0.15)
    ap.add_argument('-j', type=int, default=6)
    ap.add_argument('--slots', default=','.join(SLOTS), help='comma-separated slots to search (pairs only meet within a slot)')
    a = ap.parse_args()
    import json
    import build as B
    with open(B.CONTRACT, encoding='utf8') as f:
        ids = [k for k in json.load(f)['cues'] if k.startswith('f_') and any(k == f"f_{k.split('_')[1]}_{s}" for s in a.slots.split(','))]
    with cf.ProcessPoolExecutor(max_workers=a.j) as ex:
        F = dict(zip(ids, ex.map(_feats, ids)))
    bar = B.ID_MIN_DIST_DB + a.margin
    state = {c: 0 for c in ids}
    slot = {c: c.split('_', 2)[2] for c in ids}

    def dist(x: str, y: str) -> float:
        return min(B.id_distance(F[x][str(STATES[state[x]])], F[y][str(STATES[state[y]])]))

    def nearest(c: str) -> float:
        return min(dist(c, o) for o in ids if o != c and slot[o] == slot[c])

    for _ in range(200):
        bad = [(x, y) for i, x in enumerate(ids) for y in ids[i + 1:] if slot[x] == slot[y] and dist(x, y) < bar]
        if not bad:
            break
        best = None
        for c in sorted({c for p in bad for c in p}):
            if state[c] + 1 >= len(STATES):
                continue
            before = nearest(c)
            state[c] += 1
            gain = nearest(c) - before
            state[c] -= 1
            if best is None or gain > best[0]:
                best = (gain, c)
        if best is None:
            print('no move left; pairs under the bar:', [(x, y, round(dist(x, y), 2)) for x, y in bad])
            break
        state[best[1]] += 1
    print('SNAP_TUNE = {')
    for c in ids:
        if state[c]:
            print(f"    '{c}': {STATES[state[c]]!r},")
    print('}')
    for c in ids:
        st = str(STATES[state[c]])
        print(f"{c:24s} {st:12s} rise {F[c][st]['rise']}  nearest {nearest(c):.2f}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
