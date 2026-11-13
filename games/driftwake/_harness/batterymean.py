#!/usr/bin/env python
"""
Battery-wide mean |delta| against the reference baseline.

`shotdiff.py` reports the WORST shot per statistic, which is the right reading
for "did any single frame move". The scoreboard quotes the other one — the mean
of |delta| across all fourteen shots — and this prints exactly that, plus the
per-shot table sorted by how far each shot moved, so a regression names itself.

    python batterymean.py --a ../_shots/port
    python batterymean.py --a ../_shots/port --prev ../_shots/port_scaling2
"""
import argparse, json, os, sys
from PIL import Image
from compare import frame_stats

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = ("mean_luma", "detail_energy", "shadow_blue_bias")
# The pre-optimisation battery-wide mean |delta|, from the brief (round 6).
BEFORE = {"mean_luma": 0.00209, "detail_energy": 0.00061, "shadow_blue_bias": 0.00330}


def load(d):
    out = {}
    for f in sorted(os.listdir(d)):
        if f.endswith(".png"):
            out[f[:-4]] = frame_stats(Image.open(os.path.join(d, f)).convert("RGB"))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--prev", default="", help="an earlier port capture, for shot-by-shot drift")
    ap.add_argument("--ref-stats",
                    default=os.path.join(HERE, "..", "_shots", "ref", "baseline_stats.json"))
    args = ap.parse_args()

    ref = json.load(open(args.ref_stats, encoding="utf-8"))
    A = load(args.a)
    prev = load(args.prev) if args.prev else {}

    rows, sums, n = [], {k: 0.0 for k in KEYS}, 0
    for s in sorted(A):
        if s not in ref:
            print(f"  {s}: not in baseline, skipped"); continue
        d = {k: A[s][k] - ref[s][k] for k in KEYS}
        for k in KEYS: sums[k] += abs(d[k])
        n += 1
        rows.append((s, d))

    print(f"{'shot':20} " + " ".join(f"{k:>20}" for k in KEYS))
    for s, d in sorted(rows, key=lambda r: -abs(r[1]["mean_luma"])):
        cells = []
        for k in KEYS:
            rel = 100 * d[k] / ref[s][k] if ref[s][k] else float("nan")
            cells.append(f"{d[k]:+.5f} ({rel:+6.2f}%)")
        print(f"{s:20} " + " ".join(f"{c:>20}" for c in cells))

    print(f"\nbattery-wide mean |delta| over {n} shots:")
    for k in KEYS:
        m = sums[k] / n
        print(f"  {k:20} {m:.5f}   (before: {BEFORE[k]:.5f}   "
              f"{'BETTER' if m < BEFORE[k] else 'WORSE'} by {abs(m-BEFORE[k]):.5f})")

    if prev:
        print(f"\n--- shot-by-shot drift vs {os.path.basename(args.prev)} ---")
        print(f"{'shot':20} " + " ".join(f"{k:>14}" for k in KEYS))
        for s in sorted(A):
            if s not in prev: continue
            print(f"{s:20} " + " ".join(f"{A[s][k]-prev[s][k]:+14.6f}" for k in KEYS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
