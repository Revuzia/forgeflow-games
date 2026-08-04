#!/usr/bin/env python
"""
Score a set of port shots two ways at once.

  vs REF     the objective per-frame statistics against
             `_shots/ref/baseline_stats.json`, which is what the parity envelope
             is quoted in.
  vs PORT    the same statistics against a second port capture, plus the raw
             per-pixel difference between the two images.

The second comparison is the one that matters for a change claimed to be
output-neutral: the reference comparison only says "still inside the envelope",
whereas port-against-port says "this specific edit moved N pixels by M". TAA
carries a jitter sequence, so even two captures of an unchanged build differ
slightly; the useful reading is the SHAPE of that difference (a thin scatter
everywhere = temporal noise, a solid region = a real change).

    python shotdiff.py --a ../_shots/port_skylast --b ../_shots/port_skyfirst
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image
from compare import frame_stats

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

HERE = os.path.dirname(os.path.abspath(__file__))
KEYS = ("mean_luma", "detail_energy", "shadow_blue_bias")
# The port's established parity envelope against the reference, from the brief.
ENVELOPE = {"mean_luma": 0.0020, "detail_energy": 0.00060, "shadow_blue_bias": 0.0030}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True, help="port capture under test")
    ap.add_argument("--b", default="", help="second port capture, for A/B")
    ap.add_argument("--ref-stats",
                    default=os.path.join(HERE, "..", "_shots", "ref", "baseline_stats.json"))
    args = ap.parse_args()

    ref = json.load(open(args.ref_stats, encoding="utf-8"))
    shots = sorted(f[:-4] for f in os.listdir(args.a) if f.endswith(".png"))

    print(f"{'shot':20} {'stat':18} {'ref':>10} {'A':>10} {'|d|':>9}  envelope")
    worst = {k: 0.0 for k in KEYS}
    statsA = {}
    for s in shots:
        a = frame_stats(Image.open(os.path.join(args.a, s + ".png")).convert("RGB"))
        statsA[s] = a
        if s not in ref:
            print(f"{s:20} (not in reference baseline)")
            continue
        for k in KEYS:
            d = abs(a[k] - ref[s][k])
            worst[k] = max(worst[k], d)
            flag = "OK " if d <= ENVELOPE[k] else "OVER"
            print(f"{s:20} {k:18} {ref[s][k]:10.5f} {a[k]:10.5f} {d:9.5f}  "
                  f"{flag} (<= {ENVELOPE[k]})")

    print("\nworst |delta| vs reference: " +
          "  ".join(f"{k}={worst[k]:.5f}/{ENVELOPE[k]}" for k in KEYS))
    print("VERDICT: " + ("INSIDE the port's parity envelope"
                         if all(worst[k] <= ENVELOPE[k] for k in KEYS)
                         else "OUTSIDE the envelope"))

    if args.b:
        print(f"\n--- port A/B: {os.path.basename(args.a)} vs {os.path.basename(args.b)} ---")
        print(f"{'shot':20} {'d_mean_luma':>12} {'d_detail':>11} {'d_blue':>10}"
              f" {'px>1/255':>9} {'px>4/255':>9} {'maxdiff':>8}")
        for s in shots:
            pb = os.path.join(args.b, s + ".png")
            if not os.path.exists(pb):
                continue
            b = frame_stats(Image.open(pb).convert("RGB"))
            ia = np.asarray(Image.open(os.path.join(args.a, s + ".png")).convert("RGB"), np.int16)
            ib = np.asarray(Image.open(pb).convert("RGB"), np.int16)
            d = np.abs(ia - ib).max(axis=2)
            n = d.size
            print(f"{s:20} {statsA[s]['mean_luma']-b['mean_luma']:12.6f}"
                  f" {statsA[s]['detail_energy']-b['detail_energy']:11.6f}"
                  f" {statsA[s]['shadow_blue_bias']-b['shadow_blue_bias']:10.6f}"
                  f" {100*(d > 1).sum()/n:8.3f}% {100*(d > 4).sum()/n:8.3f}%"
                  f" {int(d.max()):8d}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
