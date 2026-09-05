"""LIGHT LANE r1 measurements on a 1920x1080 station frame:
  pad contact: mean luminance in a 9x9 window at `behind` (0.3 m behind the heels) vs `ahead` (1.2 m ahead)
  rim: on torso rows, the outer 6 px of the coat silhouette (each side) vs the coat interior.
    python _harness/_light_measure.py _shots/x.png _harness/_lp_x.json [torsoRowOffsets]
"""
import json, sys
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB'); px = img.load()
meta = json.load(open(sys.argv[2]))
def lum(p): return 0.2126*p[0]+0.7152*p[1]+0.0722*p[2]
def win(x, y, r=4):
    v = [lum(px[i, j]) for i in range(x-r, x+r+1) for j in range(y-r, y+r+1)]
    return sum(v)/len(v)
b = win(*meta['behind']); a = win(*meta['ahead'])
print('PAD  behind %.1f  ahead %.1f  ratio %.2f  diff %.0f%%' % (b, a, b/max(1,a), 100*(1-b/max(1,a))))
hx, hy = meta['head']; fx, fy = meta['feet']
def is_coat(p):
    r,g,bb = p; return r > 110 and r > g*1.25 and g > bb*0.9 and r-bb > 60
rows = [int(hy + (fy-hy)*t) for t in (0.50, 0.58, 0.66)]
for y in rows:
    xs = [x for x in range(hx-140, hx+140) if is_coat(px[x, y])]
    if len(xs) < 20: print('row', y, 'no coat run'); continue
    # contiguous run containing the median
    xs.sort(); mid = xs[len(xs)//2]; L = mid; R = mid
    sx = set(xs)
    while L-1 in sx: L -= 1
    while R+1 in sx: R += 1
    if R - L < 16: print('row', y, 'coat run too narrow', L, R); continue
    left = sum(lum(px[x, y]) for x in range(L, L+6))/6
    right = sum(lum(px[x, y]) for x in range(R-5, R+1))/6
    inner = sum(lum(px[x, y]) for x in range(L+10, R-9))/max(1, R-9-(L+10))
    print('RIM row %d coat x[%d..%d] w=%d  edgeL %.1f  edgeR %.1f  interior %.1f  ratio L %.2f R %.2f' % (y, L, R, R-L+1, left, right, inner, left/max(1,inner), right/max(1,inner)))
