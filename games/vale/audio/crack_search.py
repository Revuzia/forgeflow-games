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
import concurrent.futures as cf
import itertools
import json
import pickle
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
    """One option of one cue: every take rendered and mastered, then measured (only the features travel back: the
    renders of every option at once would not fit in memory)."""
    import build as B  # noqa: F401  (registers the cues)
    from cues import kits_c as K
    from cuelib import REGISTRY, master
    cid, cfg = job
    K.CRACK_TUNE[cid] = cfg
    xs = [np.pad(master(REGISTRY[cid].fn(v), REGISTRY[cid])[0], ((0, 0), (240, 0))).astype(np.float32)
          for v in range(K.HIT_TAKES)]
    return job, {n: _feat(xs[:n]) for n in (3, K.HIT_TAKES)}


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
    ap.add_argument('--cache', help='a pickle of the measured features (reused, and written after measuring)')
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
    F: dict = {}
    if a.cache and os.path.exists(a.cache):
        with open(a.cache, 'rb') as f:
            F = pickle.load(f)
    jobs = [(c, o) for c in cues for o in opts if (c, o, 3) not in F]
    # a process pool that fails loudly (BrokenProcessPool) when a worker dies, where mp.Pool would wait forever
    with cf.ProcessPoolExecutor(a.j) as p:
        for k, ((c, o), fs) in enumerate(p.map(_render, jobs, chunksize=2)):
            for n, f in fs.items():
                F[(c, o, n)] = f
            if k % 200 == 0:
                print(f'measured {k}/{len(jobs)}', flush=True)
    if a.cache:
        with open(a.cache, 'wb') as f:
            pickle.dump(F, f)
    bar = B.ID_MIN_DIST_DB + a.margin

    def score(c, o, n):
        f = F[(c, o, n)]
        ok = f['on_max'] <= 0.28 and f['lap'] <= 2.8 and (f['b25'] <= 0.55 or c.endswith('_hit') and 'attack' not in c)
        if o[2] == 'plain' and n != 3:
            return -100.0
        return (min(1.0, f['b26'] / K.BITE_SHARE) + min(1.0, f['b6'] / K.AIR_SHARE) + 0.25 * o[0] + 0.3 * (n == K.HIT_TAKES)
                - 0.1 * (o[3] > K.GRIT_S)
                + 1.5 * (f['b26'] >= FLOOR_26) + 1.5 * (f['b6'] >= FLOOR_6) - (0 if ok else 5.0))

    keys = [(o, n) for o in opts for n in (3, K.HIT_TAKES)]
    choice = dict(shipped)
    rng = np.random.default_rng(7)
    for slot in SLOTS:
        sc = [c for c in cues if c.split('_', 2)[2] == slot]
        # every key's features stacked, so a distance is one vectorised step: D[i][j] (key x key) per cue pair
        ki = {c: [(o, n) for o, n in keys] for c in sc}
        Hs = {c: np.array([F[(c, o, n)]['hi'] for o, n in ki[c]]) for c in sc}
        Ts = {c: [np.array(F[(c, o, n)]['takes']) for o, n in ki[c]] for c in sc}
        S = {c: np.array([score(c, o, n) for o, n in ki[c]]) for c in sc}

        def bandD(A, Bm):
            amx, bmx = A.max(1)[:, None, None], Bm.max(1)[None, :, None]
            a_, b_ = np.maximum(A[:, None, :], amx - 50), np.maximum(Bm[None, :, :], bmx - 50)
            keep = (A[:, None, :] > amx - 50) | (Bm[None, :, :] > bmx - 50)
            d2 = np.where(keep, (a_ - b_) ** 2, 0.0).sum(2) / np.maximum(keep.sum(2), 1)
            return np.sqrt(d2)

        def confD(TA, TB):
            out = np.empty((len(TA), len(TB)))
            for i, ta in enumerate(TA):
                for j, tb in enumerate(TB):
                    out[i, j] = np.sqrt(((ta[:, None, :] - tb[None, :, :]) ** 2).mean(2)).min()
            return out
        OK = {}
        for x in range(len(sc)):
            for y in range(x + 1, len(sc)):
                c1, c2 = sc[x], sc[y]
                d = np.minimum(bandD(Hs[c1], Hs[c2]), confD(Ts[c1], Ts[c2]))
                OK[(c1, c2)] = d >= bar
                OK[(c2, c1)] = OK[(c1, c2)].T
        print(f'{slot}: distances ready', flush=True)
        idx0 = {c: ki[c].index(shipped[c]) for c in sc}

        def feasible_opts(c, cur):
            m = np.ones(len(ki[c]), bool)
            for d in sc:
                if d != c:
                    m &= OK[(c, d)][:, cur[d]]
            return m

        def climb(cur, order):
            for _ in range(10):
                moved = False
                for c in order:
                    m = feasible_opts(c, cur)
                    j = int(np.argmax(np.where(m, S[c], -1e9)))
                    if m[j] and S[c][j] > S[c][cur[c]] + 1e-9:
                        cur[c] = j
                        moved = True
                if not moved:
                    break
            return cur
        best = climb(dict(idx0), sc)
        tot = lambda cur: sum(S[c][cur[c]] for c in sc)  # noqa: E731
        for r in range(400):
            # a kick: move 1-3 cues to a random option among their top-scoring ones, repair the others greedily (drop a
            # conflicting cue back to its best option that is feasible), then climb; kept when still feasible and better
            cur = dict(best)
            for c in rng.choice(sc, size=int(rng.integers(1, 4)), replace=False):
                top = np.argsort(-S[c])[:12]
                cur[c] = int(rng.choice(top))
            fixed = set()
            ok = True
            for c in rng.permutation(sc):
                if all(OK[(c, d)][cur[c], cur[d]] for d in sc if d != c):
                    continue
                m = feasible_opts(c, cur)
                if not m.any():
                    ok = False
                    break
                cur[c] = int(np.argmax(np.where(m, S[c], -1e9)))
                fixed.add(c)
            if not ok or any(not OK[(x, y)][cur[x], cur[y]] for x in sc for y in sc if x != y):
                continue
            cur = climb(cur, list(rng.permutation(sc)))
            if tot(cur) > tot(best) + 1e-9:
                best = cur
        print(f'{slot}: score {tot(idx0):.1f} -> {tot(best):.1f}', flush=True)
        for c in sc:
            choice[c] = ki[c][best[c]]
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
