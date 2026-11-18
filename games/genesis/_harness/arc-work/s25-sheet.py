# PERF s25: side-by-side sheet A (default) | B (wfast=3) | |A-B|x4 per view, plus mean|d|, mean RGB, detail (mean abs Laplacian)
import sys, os
from PIL import Image, ImageChops, ImageFilter, ImageStat
d, p = sys.argv[1], sys.argv[2]
views = sys.argv[3].split(',') if len(sys.argv) > 3 else None
rows = []
names = sorted({f[len(p) + 3:-4] for f in os.listdir(d) if f.startswith(p + '-A-') and f.endswith('.png')}) if not views else views
for v in names:
  fa, fb = os.path.join(d, f'{p}-A-{v}.png'), os.path.join(d, f'{p}-B-{v}.png')
  if not (os.path.exists(fa) and os.path.exists(fb)): continue
  a, b = Image.open(fa).convert('RGB'), Image.open(fb).convert('RGB')
  df = ImageChops.difference(a, b)
  md = sum(ImageStat.Stat(df).mean) / 3
  det = lambda im: sum(ImageStat.Stat(im.convert('L').filter(ImageFilter.FIND_EDGES)).mean)
  print(f'{v:8s} mean|d| {md:5.2f}  A {[round(x,1) for x in ImageStat.Stat(a).mean]}  B {[round(x,1) for x in ImageStat.Stat(b).mean]}  detail {det(a):.2f} / {det(b):.2f}')
  rows.append((a, b, df.point(lambda x: min(255, x * 4))))
if rows:
  w, h = rows[0][0].size
  sh = Image.new('RGB', (w * 3, h * len(rows)))
  for i, r in enumerate(rows):
    for j, im in enumerate(r): sh.paste(im, (j * w, i * h))
  sh.save(os.path.join(d, f'sheet-{p}.png'))
