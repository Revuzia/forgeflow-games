"""VALE harness — every ultimate is named by ear, as heard (closing AUD-C1).

    ~/Developer/forgeflow-games/.venv/bin/python3 _harness/probe_audio_ultid.py [--out _harness/_reports/fw_CW2_ultid.json]

The closing review's measure (_harness/_reports/closing_audio_verify_tool_ultid.py, kept as it was), re-run on the
SHIPPED files with the mix the engine now plays at each ultimate's release instead of a hard-coded list: for each
fighter, the kit's own release (catalog gain) plus every cue audio/build.py's as-heard gate finds on the ult's
release events (asheard_gate: the library cues under the ult, which must be none, and the fighter's own zone loop when
the ult lays one, held for the zone's life at its catalog gain). Fingerprint: 1/3-octave levels in 6 x 120 ms slices
(and the first 300 ms: 3 x 100 ms), 60 dB floor, RMS distance between fighters; the identity threshold is the
take-to-take spread (the max distance between round-robin takes of one cue, the review's baseline set).
Gates (the closing review's CW2 done-criterion): over the review's 12 fighters (66 pairs) the first-300 ms median pair
distance >= 15 dB and 0 pairs inside the take-to-take max; 0 library cues under any ult. Also reported over all 16
(120 pairs). Exit 0 = PASS, 1 = FAIL.
"""
from __future__ import annotations

import itertools
import json
import os
import subprocess
import sys

import numpy as np
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
AUDIO = os.path.join(ROOT, 'audio')
sys.path.insert(0, AUDIO)
import build as B  # noqa: E402  (audio/build.py: the as-heard gate, the contract)

SR = 48000
OUT_DIR = os.path.join(AUDIO, 'out')
REVIEW_12 = ['burdam', 'dunsom', 'ervet', 'hesmi', 'ilsheta', 'lisvel', 'marund', 'nurrow', 'odrum', 'sukri', 'tunlan', 'vashil']
B1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]; A1 = [1.0, -1.69065929318241, 0.73248077421585]
B2 = [1.0, -2.0, 1.0]; A2 = [1.0, -1.99004745483398, 0.99007225036621]
CENT = [c for c in (25 * 2 ** (i / 3) for i in range(30)) if c < 16000]


def dec(ref: str) -> np.ndarray:
    p = subprocess.run(['ffmpeg', '-v', 'error', '-i', B.out_path(ref), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                       capture_output=True, check=True)
    return np.frombuffer(p.stdout, dtype=np.float32).astype(np.float64)


def cue(cues: dict, cid: str, take: int = 0) -> np.ndarray:
    return dec(cues[cid]['files'][take]) * cues[cid]['gain']


def mix(*xs: np.ndarray) -> np.ndarray:
    n = max(len(x) for x in xs)
    o = np.zeros(n)
    for x in xs:
        o[:len(x)] += x
    return o


def fp(x: np.ndarray, slices: int = 6, hop: float = 0.12) -> np.ndarray:
    out = []
    for s in range(slices):
        seg = x[int(s * hop * SR):int((s + 1) * hop * SR)]
        if len(seg) < 256:
            seg = np.pad(seg, (0, 256 - len(seg)))
        f, P = signal.welch(seg, SR, nperseg=min(4096, len(seg)))
        row = []
        for c in CENT:
            m = (f >= c / 2 ** (1 / 6)) & (f < c * 2 ** (1 / 6))
            row.append(10 * np.log10((P[m].sum() if m.any() else 1e-20) + 1e-14))
        out.append(row)
    return np.array(out)


def dist(a: np.ndarray, b: np.ndarray) -> float:
    A = np.maximum(a, a.max() - 60)
    Bm = np.maximum(b, b.max() - 60)
    return float(np.sqrt(np.mean((A - Bm) ** 2)))


def main() -> int:
    out = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else os.path.join(HERE, '_reports', 'fw_CW2_ultid.json')
    contract = B.load_contract()
    cues = contract['cues']
    fails, rep = B.asheard_gate(contract)
    chains = rep['ultChains']
    fighters = sorted(chains)
    heard, layers = {}, {}
    for f in fighters:
        ch = chains[f]
        rel = f'f_{f}_ult_release'
        parts = [cue(cues, rel)]
        names = [rel]
        for c in ch['library']:                       # a library cue under the ult (the gate fails on any)
            parts.append(cue(cues, c))
            names.append(c)
        for c in ch['own']:                           # the ult's own zone loop starts with the release
            if c.endswith('_zone') and cues[c].get('loop'):
                x = cue(cues, c)
                parts.append(np.tile(x, 2)[:int(2.5 * SR)])
                names.append(c)
        heard[f] = mix(*parts)
        layers[f] = names
    base6, base3 = [], []
    for n in ['c_heal', 'c_monster_hit', 'c_swing_heavy']:
        xs = [cue(cues, n, i) for i in range(3)]
        for a, b in itertools.combinations(range(3), 2):
            base6.append(dist(fp(xs[a]), fp(xs[b])))
            base3.append(dist(fp(xs[a], 3, 0.1), fp(xs[b], 3, 0.1)))
    for f in ['hesmi', 'marund', 'burdam']:
        xs = [cue(cues, f'f_{f}_attack_hit', i) for i in range(3)]
        for a, b in itertools.combinations(range(3), 2):
            base6.append(dist(fp(xs[a]), fp(xs[b])))
    take_max6, take_max3 = max(base6), max(base3)

    def pairs(group: list[str], slices: int, hop: float) -> list[tuple[float, str, str]]:
        P = {f: fp(heard[f], slices, hop) for f in group}
        return sorted((dist(P[a], P[b]), a, b) for a, b in itertools.combinations(group, 2))

    res: dict = {'probe': 'probe_audio_ultid', 'layers': layers, 'libraryUnderUlts': rep['libraryUnderUlts'],
                 'takeBaseline': {'whole': {'median': float(np.median(base6)), 'max': take_max6},
                                  'first300ms': {'median': float(np.median(base3)), 'max': take_max3}}, 'groups': {}}
    gate_fail = []
    for name, group in (('review12', [f for f in REVIEW_12 if f in heard]), ('all16', fighters)):
        w = pairs(group, 6, 0.12)
        o = pairs(group, 3, 0.1)
        g = {'pairs': len(w),
             'whole': {'min': [round(w[0][0], 2), w[0][1], w[0][2]], 'median': round(float(np.median([d for d, _, _ in w])), 2),
                       'insideTakeMax': sum(1 for d, _, _ in w if d <= take_max6)},
             'first300ms': {'min': [round(o[0][0], 2), o[0][1], o[0][2]], 'median': round(float(np.median([d for d, _, _ in o])), 2),
                            'insideTakeMax': sum(1 for d, _, _ in o if d <= take_max3), 'closest': [[round(d, 2), a, b] for d, a, b in o[:5]]}}
        res['groups'][name] = g
        print(f"{name:9s} {g['pairs']:3d} pairs  whole: min {g['whole']['min'][0]:5.2f} ({g['whole']['min'][1]}/{g['whole']['min'][2]})"
              f" median {g['whole']['median']:5.2f}, inside take max {g['whole']['insideTakeMax']}  |  first 300 ms: min"
              f" {g['first300ms']['min'][0]:5.2f} ({g['first300ms']['min'][1]}/{g['first300ms']['min'][2]}) median"
              f" {g['first300ms']['median']:5.2f}, inside take max {g['first300ms']['insideTakeMax']}")
    r12 = res['groups']['review12']
    if r12['pairs'] != 66:
        gate_fail.append(f"review12 has {r12['pairs']} pairs (want 66)")
    if r12['first300ms']['median'] < 15.0:
        gate_fail.append(f"first-300 ms median pair distance {r12['first300ms']['median']} dB < 15")
    if r12['first300ms']['insideTakeMax'] or r12['whole']['insideTakeMax']:
        gate_fail.append(f"{r12['first300ms']['insideTakeMax']} (first 300 ms) / {r12['whole']['insideTakeMax']} (whole) pairs inside the take-to-take max")
    if rep['libraryUnderUlts']:
        gate_fail.append(f"{rep['libraryUnderUlts']} library cue(s) under ultimates")
    print(f"take-to-take: whole median {np.median(base6):.2f} max {take_max6:.2f}; first 300 ms median {np.median(base3):.2f} max {take_max3:.2f}")
    print(f"layers at the release: " + '; '.join(f"{f} {'+'.join(v)}" for f, v in layers.items() if len(v) > 1))
    res['failures'] = gate_fail
    res['pass'] = not gate_fail
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w', encoding='utf8') as fh:
        json.dump(res, fh, indent=1)
    print(('FAIL\n  ' + '\n  '.join(gate_fail)) if gate_fail else
          'PASS: every ultimate lands on its own release (0 library cues under any ult); 66 review pairs all outside the take-to-take spread, first-300 ms median >= 15 dB')
    print(f'report → {out}')
    return 1 if gate_fail else 0


if __name__ == '__main__':
    sys.exit(main())
