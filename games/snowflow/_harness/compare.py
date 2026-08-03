#!/usr/bin/env python
"""
Blind A/B pairing for the SNOWFLOW critic loop.

For every shot captured in BOTH the reference and the port, this writes a blind
pair into `_shots/blind/<shot>/`:

    A.png, B.png            the two full frames, side assigned by a seeded coin flip
    A_crop.png, B_crop.png  a 2x magnified detail crop, same region from both
    stats.json              objective per-frame statistics (no side labels)

...and a single `_shots/blind/key.json` recording which side is which.

The critic agent is pointed at `_shots/blind/` and must NEVER be given key.json.
`python compare.py --reveal` prints the key and scores a critic's verdict file.

    python compare.py --seed 1
    python compare.py --reveal --verdicts verdicts.json
"""
import argparse, hashlib, json, os, random, sys
import numpy as np
from PIL import Image

# Windows consoles default to cp1252 and cannot encode this script's output; force
# utf-8 before anything writes, or a print raises and masks the real result.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "..", "_shots")

# Where the interesting detail lives, per shot, as (cx, cy) in 0..1 of the frame.
# Snow micro-detail and silhouettes, not empty sky.
CROP_AT = {
    "01-hero":            (0.42, 0.58),
    "02-snow-grazing":    (0.50, 0.62),
    "03-shadow-penumbra": (0.45, 0.62),
    "04-backlit-sss":     (0.50, 0.55),
    "05-trail-berms":     (0.48, 0.62),
    "06-surf-wake":       (0.47, 0.58),
    "07-spell-sweep":     (0.50, 0.55),
    "08-spell-ribbon":    (0.50, 0.52),
    "09-spell-bloom":     (0.50, 0.50),
    "10-spell-crystallize": (0.50, 0.55),
    "11-spell-vortex":    (0.50, 0.52),
    "12-far-range":       (0.50, 0.42),
    "13-char-closeup":    (0.36, 0.55),
    "14-sky-sun":         (0.50, 0.40),
}
CROP_W, CROP_H, CROP_ZOOM = 420, 236, 3


def luma(a: np.ndarray) -> np.ndarray:
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def frame_stats(img: Image.Image) -> dict:
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    y = luma(a)
    # High-frequency energy: how much fine detail survives. A port that has lost
    # the sastrugi / detail normals reads as a much lower number here.
    gx = np.abs(np.diff(y, axis=1)).mean()
    gy = np.abs(np.diff(y, axis=0)).mean()
    return {
        "mean_luma": round(float(y.mean()), 5),
        "std_luma": round(float(y.std()), 5),
        "p01": round(float(np.percentile(y, 1)), 5),
        "p99": round(float(np.percentile(y, 99)), 5),
        "clipped_white_pct": round(float((y > 0.995).mean() * 100), 4),
        "crushed_black_pct": round(float((y < 0.005).mean() * 100), 4),
        "detail_energy": round(float(gx + gy), 6),
        "mean_rgb": [round(float(a[..., i].mean()), 5) for i in range(3)],
        # Shadow tint: the reference's shadows are distinctly blue. B-R in the
        # darkest quartile is the single number that captures it.
        "shadow_blue_bias": round(
            float((a[..., 2] - a[..., 0])[y < np.percentile(y, 25)].mean()), 5),
    }


def crop_of(img: Image.Image, shot: str) -> Image.Image:
    cx, cy = CROP_AT.get(shot, (0.5, 0.55))
    w, h = img.size
    x = int(cx * w - CROP_W / 2)
    y = int(cy * h - CROP_H / 2)
    x = max(0, min(w - CROP_W, x))
    y = max(0, min(h - CROP_H, y))
    return img.crop((x, y, x + CROP_W, y + CROP_H)).resize(
        (CROP_W * CROP_ZOOM, CROP_H * CROP_ZOOM), Image.NEAREST)


def build(seed: int) -> int:
    ref_dir = os.path.join(SHOTS, "ref")
    port_dir = os.path.join(SHOTS, "port")
    blind = os.path.join(SHOTS, "blind")
    os.makedirs(blind, exist_ok=True)

    names = sorted(
        n[:-4] for n in os.listdir(ref_dir)
        if n.endswith(".png") and os.path.exists(os.path.join(port_dir, n))
    )
    if not names:
        print("no shots captured for BOTH ref and port yet", file=sys.stderr)
        return 1

    key = {"seed": seed, "pairs": {}}
    for shot in names:
        # Seeded per shot, so adding a shot does not reshuffle the others.
        rng = random.Random(hashlib.sha256(f"{seed}:{shot}".encode()).digest())
        ref_is_a = rng.random() < 0.5

        out = os.path.join(blind, shot)
        os.makedirs(out, exist_ok=True)
        imgs = {}
        for side, which in (("A", "ref" if ref_is_a else "port"),
                            ("B", "port" if ref_is_a else "ref")):
            src = os.path.join(ref_dir if which == "ref" else port_dir, shot + ".png")
            im = Image.open(src).convert("RGB")
            im.save(os.path.join(out, f"{side}.png"))
            crop_of(im, shot).save(os.path.join(out, f"{side}_crop.png"))
            imgs[side] = (which, im)

        with open(os.path.join(out, "stats.json"), "w", encoding="utf-8") as f:
            json.dump({s: frame_stats(im) for s, (_, im) in imgs.items()}, f, indent=2)

        key["pairs"][shot] = {s: w for s, (w, _) in imgs.items()}
        print(f"  {shot}: A={key['pairs'][shot]['A']}  B={key['pairs'][shot]['B']}")

    with open(os.path.join(blind, "key.json"), "w", encoding="utf-8") as f:
        json.dump(key, f, indent=2)
    print(f"\n{len(names)} blind pairs -> {blind}")
    print("!! key.json must NOT be shown to the critic")
    return 0


def reveal(verdicts_path: str) -> int:
    blind = os.path.join(SHOTS, "blind")
    key = json.load(open(os.path.join(blind, "key.json"), encoding="utf-8"))
    if not verdicts_path or not os.path.exists(verdicts_path):
        print(json.dumps(key, indent=2))
        return 0

    # verdicts: { shot: {"better": "A"|"B"|"TIE", "confidence": 0..1, "why": str} }
    vs = json.load(open(verdicts_path, encoding="utf-8"))
    rows, wins, ties, losses = [], 0, 0, 0
    for shot, v in sorted(vs.items()):
        pair = key["pairs"].get(shot)
        if not pair:
            continue
        pick = str(v.get("better", "")).upper()
        if pick == "TIE":
            outcome, ties = "TIE", ties + 1
        elif pair.get(pick) == "port":
            outcome, wins = "PORT WINS", wins + 1
        else:
            outcome, losses = "ref wins", losses + 1
        rows.append((shot, outcome, round(float(v.get("confidence", 0)), 2),
                     str(v.get("why", ""))[:88]))

    w = max((len(r[0]) for r in rows), default=4)
    print(f"{'shot'.ljust(w)}  {'outcome'.ljust(9)}  conf  why")
    for shot, outcome, conf, why in rows:
        print(f"{shot.ljust(w)}  {outcome.ljust(9)}  {conf:<4}  {why}")
    n = len(rows)
    print(f"\nport wins {wins}/{n} · ties {ties}/{n} · reference wins {losses}/{n}")
    # "Indistinguishable" is the target: a tie, or a low-confidence pick either way.
    indist = ties + sum(1 for r in rows if r[2] < 0.6)
    print(f"indistinguishable-or-better: {wins + indist}/{n}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--reveal", action="store_true")
    ap.add_argument("--verdicts", default="")
    args = ap.parse_args()
    return reveal(args.verdicts) if args.reveal else build(args.seed)


if __name__ == "__main__":
    sys.exit(main())
