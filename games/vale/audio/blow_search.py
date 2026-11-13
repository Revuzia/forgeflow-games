#!/usr/bin/env python3
"""VALE blow search (max2 round 2 fix, verify2_q minors): for the slow and dark shared kit hits, find the partial
blow-first pass (kits_c.EASE_TUNE: cut the attack ramp or not, ease 0.5-6 dB or none), the air-only / light crack
(kits_c.CRACK_TUNE, mode 'air') and the snap state (kits_c.SNAP_TUNE) that lift each cue's 2 ms RMS rise toward 3 ms
and its HF shares toward the floors (2-6 kHz >= 4 %, > 6 kHz >= 0.6 %) while every fighter stays >= the kit gate's
identity distance (audio/build.py id_distance, both measures) + a codec margin from every other in its slot.

    python3 blow_search.py [--margin 0.15] [-j 4] [--out tune.json]

Every option is built as audio/build.render ships it (master, post pass, loudness lift loop, Opus) and decoded, then
measured as the kit gate does; coordinate descent from the shipped tables (feasible) moves each target to its best-scoring option with no pair
under the bar. Prints the tables to paste into kits_c.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import sys
import warnings

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
warnings.filterwarnings('ignore')

import numpy as np  # noqa: E402

SR = 48000
SLOTS = ('attack_hit', 'hit')
FLOOR_26, FLOOR_6 = 0.04, 0.006
RISE_GOAL = 3.0
# the cues the verifiers named (slow 2 ms RMS rise, or under the HF floors) and the options each may take
SLOW = ('f_burdam_attack_hit', 'f_ulkro_hit', 'f_lisvel_hit', 'f_burdam_hit', 'f_nurrow_hit', 'f_ardit_hit',
        'f_kemdo_hit', 'f_dunsom_hit', 'f_hesmi_hit', 'f_marund_attack_hit', 'f_vashil_hit', 'f_vashil_attack_hit',
        'f_ilsheta_attack_hit', 'f_sukri_attack_hit', 'f_marund_hit', 'f_odrum_attack_hit', 'f_ardit_attack_hit')
DARK = ('f_dunsom_attack_hit', 'f_tunlan_hit', 'f_ulkro_attack_hit', 'f_hesmi_attack_hit', 'f_lisvel_attack_hit',
        'f_nurrow_hit', 'f_dunsom_hit', 'f_rishal_hit')
EASES = ((True, 0.5), (True, 2.0), (True, 4.0), (False, 2.0), (False, 4.0), (False, 6.0), (True, None))
CRACKS = (('air', 0.3), ('air', 0.55), ('air', 1.0), ('full', 0.3), ('full', 0.55))
SNAPS = ('default', (0.3, 2.0), (0.1, 1.0))


def _rms_rise(z: np.ndarray) -> float:
    m = np.atleast_2d(z).mean(axis=0)
    e = np.sqrt(np.convolve(m * m, np.ones(96) / 96, mode='same'))
    i = int(np.argmax(e > e.max() * 0.01))
    return float(np.argmax(e) - i) / 48.0


def _peak_rise(z: np.ndarray) -> float:
    e = np.max(np.abs(np.atleast_2d(z)), axis=0)
    i = int(np.argmax(e > e.max() * 0.01))
    return float(np.argmax(e) - i) / 48.0


def _share(m: np.ndarray, lo: float, hi: float = 1e9) -> float:
    P = np.abs(np.fft.rfft(m)) ** 2
    f = np.fft.rfftfreq(m.size, 1 / SR)
    return float(P[(f >= lo) & (f < hi)].sum() / (P[f > 20].sum() + 1e-30))


def options(cid: str) -> list[dict]:
    """The shipped state first, then every option this cue may take."""
    from cues import kits_c as K
    ship = {'ease': K.EASE_TUNE.get(cid), 'crack': K.CRACK_TUNE.get(cid), 'snap': K.SNAP_TUNE.get(cid, 'default')}
    eases = [ship['ease']] + (list(EASES) if cid in SLOW else [])
    tune = K.CRACK_TUNE.get(cid, (1.0, 1.0, 'full'))
    cracks = [ship['crack']]
    if cid in DARK:
        cracks += [(s, tune[1], m) + tuple(tune[3:]) for m, s in CRACKS if (m, s) != (tune[2], tune[0])]
    snaps = [ship['snap']] + ([s for s in SNAPS if s != ship['snap']] if ship['snap'] is None else [])
    return [{'ease': e, 'crack': c, 'snap': s} for e in eases for c in cracks for s in snaps]


def _built(sp, v: int, cid: str) -> np.ndarray:
    """One take exactly as audio/build.render ships it (the loudness lift, codec ceiling and late-peak boost loop), encoded
    to Opus in a scratch folder and decoded: the kit gate measures decoded files, and the build's re-mastering after an
    ease moves a take's spectrum by up to 2 dB (a render-domain search missed by that much)."""
    import dataclasses
    import tempfile
    import build as B
    from cuelib import CEILING_DBTP, master, measure
    raw = sp.fn(v)
    ceiling, boost, lift = CEILING_DBTP, 0.0, 0.0
    tmp = tempfile.mkdtemp(prefix='blow_')
    for attempt in range(7):
        y, info = master(raw, sp if not lift else dataclasses.replace(sp, target=(sp.target[0], sp.target[1] + lift)), ceiling)
        y = sp.extra['post'](y, v, ceiling, boost)
        y = np.pad(y, ((0, 0), (B.ns_(B.LEAD_S), 0)))
        side, mid = 0.5 * (y[0] - y[1]), 0.5 * (y[0] + y[1])
        mono = float(np.sqrt(np.mean(side ** 2))) < 0.005 * float(np.sqrt(np.mean(mid ** 2)) + 1e-12)
        wav, ogg = os.path.join(tmp, f'{cid}_{v}.wav'), os.path.join(tmp, f'{cid}_{v}.ogg')
        B._write(wav, mid if mono else y)
        B.encode_opus(wav, ogg, 1 if mono else 2)
        dec = B.decode(ogg)
        over = float(B.L.true_peak(dec)) - B.TP_MAX
        late = bool(sp.extra.get('rise_max_ms')) and B.rise_ms(dec) > sp.extra['rise_max_ms']
        short = sp.target[1] - measure(dec, sp.target[0], False)
        if (over <= 0 and not late and abs(short) <= 0.5) or attempt == 6:
            break
        if abs(short) > 0.5:
            lift += 0.6 * short
        if over > 0:
            ceiling -= over + 0.3
        if late:
            boost += 1.5
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    return dec


def _shipped(cid: str):
    """The shipped state's features, from the decoded files in audio/out (the kit gate's own input)."""
    import glob
    import build as B
    fs = sorted(glob.glob(os.path.join(HERE, 'out', f'{cid}_[0-9].ogg'))) or [os.path.join(HERE, 'out', f'{cid}.ogg')]
    return (cid, 0), _measure([B.decode(f) for f in fs])


def _measure(zs: list) -> dict:
    import build as B
    centres = 1000.0 * 2.0 ** (np.arange(-16, 13) / 3.0)
    ps = [10 ** (B.third_octave_db(z) / 10) for z in zs]
    hi = np.mean(ps, axis=0)[centres >= B.ID_FROM_HZ * 0.99]
    hi = hi / (hi.sum() + 1e-30)
    ms = [np.atleast_2d(z).mean(axis=0) for z in zs]
    return {'hi': 10 * np.log10(np.maximum(hi, 1e-9)), 'takes': [B.confuse_db(z) for z in zs],
            'rms': float(np.median([_rms_rise(z) for z in zs])), 'rmsMax': float(max(_rms_rise(z) for z in zs)),
            'peak': float(max(_peak_rise(z) for z in zs)), 's26': float(min(_share(m, 2000.0, 6000.0) for m in ms)),
            's6': float(min(_share(m, 6000.0) for m in ms)),
            'top': float(max(B.transient_share(z) for z in zs)), 'lap': float(max(B.laptop_loss(z) for z in zs))}


def _feat(job):
    import build as B
    from cuelib import REGISTRY, master
    from cues import kits_c as K
    cid, k, opt = job
    if opt['ease'] is None:
        K.EASE_TUNE.pop(cid, None)
    else:
        K.EASE_TUNE[cid] = tuple(opt['ease'])
    if opt['crack'] is None:
        K.CRACK_TUNE.pop(cid, None)
    else:
        K.CRACK_TUNE[cid] = tuple(opt['crack'])
    K.SNAP_TUNE[cid] = (K.SNAP_MARGIN_DB, K.SNAP_MAX_MS) if opt['snap'] == 'default' else (
        tuple(opt['snap']) if opt['snap'] else None)
    sp = REGISTRY[cid]
    return (cid, k), _measure([_built(sp, v, cid) for v in range(sp.variants)])


def score(f: dict, cid: str) -> float:
    s = 1.5 * (1.0 - min(f['rms'], 30.0) / 30.0) if f['rms'] > RISE_GOAL else 1.5
    s += min(f['s26'] / FLOOR_26, 1.0) + min(f['s6'] / FLOOR_6, 1.0)
    if f['peak'] > RISE_GOAL:
        s -= 0.25
    return s


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--margin', type=float, default=0.15)
    ap.add_argument('-j', type=int, default=4)
    ap.add_argument('--out')
    a = ap.parse_args()
    import build as B
    with open(B.CONTRACT, encoding='utf8') as f:
        ids = [k for k in json.load(f)['cues'] if k.startswith('f_') and any(k == f"f_{k.split('_')[1]}_{s}" for s in SLOTS)]
    opts = {c: (options(c) if c in SLOW or c in DARK else options(c)[:1]) for c in ids}
    jobs = [(c, k, o) for c in ids for k, o in enumerate(opts[c]) if k]
    print(f'{len(jobs)} renders', flush=True)
    with cf.ProcessPoolExecutor(max_workers=a.j) as ex:
        F = dict(ex.map(_shipped, ids))         # the shipped state: the decoded files in audio/out
        F.update(ex.map(_feat, jobs, chunksize=2))
    if a.out:
        import pickle
        with open(a.out + '.pkl', 'wb') as f:
            pickle.dump({'F': F, 'opts': opts, 'ids': ids}, f)
    bar = B.ID_MIN_DIST_DB + a.margin
    st = {c: 0 for c in ids}
    slot = {c: c.split('_', 2)[2] for c in ids}

    def dist(x, kx, y, ky):
        return min(B.id_distance(F[(x, kx)], F[(y, ky)]))

    def nearest(c, k):
        return min(dist(c, k, o, st[o]) for o in ids if o != c and slot[o] == slot[c])

    for c in ids:
        if nearest(c, 0) < bar:
            print(f'shipped {c} nearest {nearest(c, 0):.2f} < bar (render-domain)')
    for _ in range(4):
        moved = False
        for c in ids:
            if len(opts[c]) < 2:
                continue
            best = (score(F[(c, st[c])], c), -1.0, st[c])
            floor = min(bar, nearest(c, st[c]))       # a pair already under the bar (render domain) may not get closer
            for k in range(len(opts[c])):
                n = nearest(c, k)
                if n < floor or F[(c, k)]['top'] > B.TRANSIENT_SOFT_TOP or F[(c, k)]['lap'] > B.LAPTOP_MAX_LU:
                    continue
                s = score(F[(c, k)], c)
                if (s, n) > best[:2] and s > best[0] + 0.02:
                    best = (s, n, k)
            if best[2] != st[c]:
                st[c], moved = best[2], True
        if not moved:
            break
    res = {}
    for c in ids:
        if len(opts[c]) < 2:
            continue
        f0, f1 = F[(c, 0)], F[(c, st[c])]
        res[c] = {'opt': opts[c][st[c]], 'shipped': opts[c][0], 'nearest': round(nearest(c, st[c]), 2),
                  'before': {k: round(f0[k], 4) for k in ('rms', 'rmsMax', 'peak', 's26', 's6')},
                  'after': {k: round(f1[k], 4) for k in ('rms', 'rmsMax', 'peak', 's26', 's6')}}
        print(f"{c:24s} {str(opts[c][st[c]]):70s} rms {f0['rms']:5.1f}->{f1['rms']:5.1f} peak {f0['peak']:4.1f}->{f1['peak']:4.1f}"
              f" 2-6k {f0['s26']:.3f}->{f1['s26']:.3f} >6k {f0['s6']:.4f}->{f1['s6']:.4f} near {nearest(c, st[c]):.2f}")
    if a.out:
        with open(a.out, 'w') as f:
            json.dump(res, f, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
