# PERF s10 item 6: mean luminance (0..1, Rec.709 on sRGB values) and the share of near-white pixels per frame of a shot
# series: python3 _harness/arc-work/perf-lum.py <prefix>   (e.g. _harness/scratch/arc/perf/shots/cz1-f)
import sys, glob
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + '*.png'))
prev = None
for f in files:
    im = Image.open(f).convert('RGB').resize((222, 125))
    px = list(im.getdata())
    lum = [(0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 for r, g, b in px]
    m = sum(lum) / len(lum)
    white = sum(1 for x in lum if x > 0.85) / len(lum)
    flag = ' <-- WHITE' if white > 0.5 or (prev is not None and m - prev > 0.25) else ''
    print(f'{f.rsplit("/", 1)[-1]} mean {m:.3f} white {white:.2f}{flag}')
    prev = m
