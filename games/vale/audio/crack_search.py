#!/usr/bin/env python3
"""VALE crack search (max SFX-2): find kits_c.CRACK_TUNE (and the take count per hit) so every kit attack hit and ability hit
gets as much crack and air as it can while every fighter stays >= the kit gate's identity distance from every other in
its slot, by both measures (audio/build.py id_distance), with a margin for the codec.

    python3 crack_search.py [--margin 0.4] [-j 7] [--out tune.json]

Every option (level scale x band ratio) is rendered and mastered once (cuelib.master, no codec), its features measured
as the kit gate does; then coordinate descent over the cues picks, per cue, the option and take count (3 or HIT_TAKES)
that maximises its brightness score with no pair under the bar, starting from the shipped table (feasible). Prints the
table to paste into kits_c.CRACK_TUNE / CRACK_TAKES (and writes it as JSON with --out).
"""
from __future__ import annotations

import argparse
import itertools
import json
import multiprocessing as mp
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import numpy as np  # noqa: E402

SCALES = (0.0, 0.3, 0.55, 0.8, 1.0)
GRITS = (0.08, 0.16, 0.28)          # the grit's length (s): kits_c.GRIT_S, or a long splinter / crumble / tinkle
RATIOS = (0.65, 0.8, 1.0, 1.25, 1.55)
FLOOR_26, FLOOR_6 = 0.04, 0.006     # the least bite (2-6 kHz) and air (> 6 kHz) share a hit should have
SLOTS = ('attack_hit', 'hit')
SR = 48000


def _render(job):
    import build as B  # noqa: F401  (registers the cues)
    from cues import kits_c as K
    from cuelib import REGISTRY, master
    cid, cfg, v = job
    K.CRACK_TUNE[cid] = cfg
    y, _ = master(REGISTRY[cid].fn(v), REGISTRY[cid])
    return job, np.pad(y, ((0, 0), (240, 0))).astype(np.float32)


def _feat(xs):
    import build as B
    centres = 1000.0 * 2.0 ** (np.arange(-16, 13) / 3.0)
    ps = [10 ** (B.third_octave_db(x) / 10) for x in xs]
    hi = np.mean(ps, axis=0)[centres >= B.ID_FROM_HZ * 0.99]
    hi = hi / hi.sum()
    sh = []
    for x in xs:
        m = x.mean(0)
        P = np.abs(np.fft.rfft(m)) ** 2
        f = np.fft.rfftfreq(m.size, 1 / SR)
        t = P[f > 20].sum()
        sh.append((P[(f >= 2000) & (f < 6000)].sum() / t, P[f >= 6000].sum() / t, P[(f >= 2000) & (f < 5000)].sum() / t,
                   B.transient_share(x), B.laptop_loss(x)))
    sh = np.array(sh)
    return {'hi': 10 * np.log10(np.maximum(hi, 1e-9)), 'takes': [B.confuse_db(x) for x in xs],
            'b26': float(sh[:, 0].mean()), 'b6': float(sh[:, 1].mean()), 'b25': float(sh[:, 2].max()),
            'on_max': float(sh[:, 3].max()), 'lap': float(sh[:, 4].max())}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--margin', type=float, default=0.4)
    ap.add_argument('-j', type=int, default=7)
    ap.add_argument('--out')
    a = ap.parse_args()
    import build as B
    from cues import kits_c as K
    fids = K.FIGHTERS
    cues = [f'f_{f}_{s}' for s in SLOTS for f in fids]
    opts = [(sc, r, m, g) for sc, r, m, g in itertools.product(SCALES, RATIOS, ('full', 'crack'), GRITS) if sc > 0]
    opts += [(0.0, 1.0, 'full', K.GRIT_S), (0.0, 1.0, 'plain', K.GRIT_S)]

    def as_opt(t):
        t = tuple(t)
        return t if len(t) > 3 else (*t, K.GRIT_S)
    shipped = {c: (as_opt(K.CRACK_TUNE.get(c, (1.0, 1.0, 'full'))), K.CRACK_TAKES.get(c, K.HIT_TAKES)) for c in cues}
    for o, _ in shipped.values():
        if o not in opts:
            opts.append(o)
    jobs = [(c, o, v) for c in cues for o in opts for v in range(K.HIT_TAKES)]
    X: dict = {}
    with mp.Pool(a.j) as p:
        for (c, o, v), y in p.imap_unordered(_render, jobs, chunksize=4):
            X.setdefault((c, o), {})[v] = y
    F: dict = {}
    for (c, o), d in X.items():
        xs = [d[v] for v in sorted(d)]
        for n in (3, K.HIT_TAKES):
            F[(c, o, n)] = _feat(xs[:n])
    bar = B.ID_MIN_DIST_DB + a.margin

    def score(c, o, n):
        f = F[(c, o, n)]
        ok = f['on_max'] <= 0.28 and f['lap'] <= 2.8 and (f['b25'] <= 0.55 or c.endswith('_hit') and 'attack' not in c)
        if o[2] == 'plain' and n != 3:
            return -100.0
        return (min(1.0, f['b26'] / K.BITE_SHARE) + min(1.0, f['b6'] / K.AIR_SHARE) + 0.25 * o[0] + 0.3 * (n == K.HIT_TAKES)
                - 0.1 * (o[3] > K.GRIT_S)
                + 1.5 * (f['b26'] >= FLOOR_26) + 1.5 * (f['b6'] >= FLOOR_6) - (0 if ok else 5.0))

    def dist(k1, k2):
        return min(B.id_distance(F[k1], F[k2]))

    choice = dict(shipped)                                      # start from the shipped table (feasible)
    keys = [(o, n) for o in opts for n in (3, K.HIT_TAKES)]
    for it in range(8):
        changed = 0
        for c in cues:
            slot = c.split('_', 2)[2]
            others = [d for d in cues if d != c and d.split('_', 2)[2] == slot]
            best, bk = None, None
            for o, n in keys:
                k = (c, o, n)
                pen = sum(max(0.0, bar - dist(k, (d, *choice[d]))) for d in others)
                v = score(c, o, n) - 20.0 * pen
                if best is None or v > best + 1e-9:
                    best, bk = v, (o, n)
            if bk != choice[c]:
                choice[c] = bk
                changed += 1
        print(f'pass {it}: {changed} changed', flush=True)
        if not changed:
            break
    worst = []
    for c in cues:
        slot = c.split('_', 2)[2]
        others = [d for d in cues if d != c and d.split('_', 2)[2] == slot]
        k = (c, *choice[c])
        near = min((min(B.id_distance(F[k], F[(d, *choice[d])])), d) for d in others)
        f = F[k]
        worst.append(near[0])
        print(f"{c:22s} scale {choice[c][0][0]:.2f} ratio {choice[c][0][1]:.2f} {choice[c][0][2]:5s} grit {choice[c][0][3]:.2f} takes {choice[c][1]}  near {near[0]:4.1f} ({near[1]})"
              f"  2-6k {f['b26'] * 100:4.1f}%  >6k {f['b6'] * 100:4.2f}%  onset<= {f['on_max']:.3f}  2-5k {f['b25']:.2f}  lap {f['lap']:.1f}")
    print(f'min distance {min(worst):.2f} (bar {bar:.1f})')
    tune = {c: list(choice[c][0][:3]) + ([choice[c][0][3]] if choice[c][0][3] != K.GRIT_S else []) for c in cues
            if choice[c][0] != (1.0, 1.0, 'full', K.GRIT_S)}
    takes = {c: choice[c][1] for c in cues if choice[c][1] != K.HIT_TAKES}
    if a.out:
        with open(a.out, 'w') as f:
            json.dump({'tune': tune, 'takes': takes}, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
