# PERF s25c: read a `wshade3=ssrdbg` shot: sea pixels = blue (mask-skipped), yellow (marched; brightness ~ 0.15 + 0.85
# taps / 24 before the post chain, normalised here by the image's brightest yellow = 24 taps), dark (gated off).
# Prints the share of each and the mean depth taps per sea pixel (the Mac-speed proxy). Usage: s25-ssrcount.py a.png ...
import sys
from PIL import Image
for f in sys.argv[1:]:
  im = Image.open(f).convert('RGB'); px = list(im.get_flattened_data() if hasattr(im, 'get_flattened_data') else im.getdata())
  blue = yel = dark = 0; ys = []
  for r, g, b in px:
    if r > b + 40 and g > b + 40: yel += 1; ys.append((r + g) / 2)
    elif b > r + 40 and b > g + 25 and b > 150: blue += 1
    elif r < 110 and g < 120 and b <= 150 and b >= r: dark += 1
  top = max(ys) if ys else 1; lo = min(ys) if ys else 0
  # map brightness linearly from the 0.15 floor to the top = 24 taps
  steps = [max(0.0, (y / top - 0.15) / 0.85) * 24 for y in ys]
  sea = blue + yel + dark
  print(f"{f}: sea px {sea}  skipped(mask) {blue/sea:.1%}  marched {yel/sea:.1%}  gated {dark/sea:.1%}  mean taps/sea px {sum(steps)/sea:.1f}  (marched mean {sum(steps)/max(yel,1):.1f})")
