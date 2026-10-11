import sys, json
from PIL import Image
import numpy as np
# usage: compose.py <prefix> <out.png> <scene_dy_css> <lockup_dy_css> [scene_scale=1.0] [lockup_scale=1.0]
prefix, out = sys.argv[1], sys.argv[2]
dy = float(sys.argv[3]); ty = float(sys.argv[4])
sc = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
ls = float(sys.argv[6]) if len(sys.argv) > 6 else 1.0
S = Image.open(f'{prefix}_S.png').convert('RGB'); L = Image.open(f'{prefix}_L.png').convert('RGBA')
W, H = S.size  # 2560x1440 (dpr 2)
k = W / 1280.0
# scene: scale about the bottom centre of the squishy's foot (x centre, y=620 css), then shift down by dy
if sc != 1.0:
    S = S.resize((int(W * sc), int(H * sc)), Image.LANCZOS)
    # crop/pad back to W x H keeping the horizontal centre; anchor the vertical position of css y=330 (squishy middle)
    cx = S.width // 2; ax = int(330 * k * sc)
    left = cx - W // 2
    top = ax - int(330 * k)
    canvas = Image.new('RGB', (W, H)); canvas.paste(S, (-left, -top)); S = canvas
sa = np.array(S)
shift = int(round(dy * k))
out_a = np.empty_like(sa)
if shift >= 0:
    out_a[shift:] = sa[:H - shift]
    # fill the top: replicate the first 6 rows' mean per column (the sky is a smooth vertical gradient)
    base = sa[:6].mean(axis=0)
    out_a[:shift] = base.astype(np.uint8)[None, :, :]
else:
    out_a[:H + shift] = sa[-shift:]
    out_a[H + shift:] = sa[-1:]
scene = Image.fromarray(out_a)
# lockup: scale about its top centre, then shift
if ls != 1.0:
    L = L.resize((int(W * ls), int(H * ls)), Image.LANCZOS)
    full = Image.new('RGBA', (W, H), (0, 0, 0, 0)); full.alpha_composite(L, (int((W - L.width) / 2), 0)) if L.width <= W else None
    L = full
tshift = int(round(ty * k))
la = np.array(L)
lo = np.empty_like(la)
if tshift >= 0:
    lo[tshift:] = la[:H - tshift]
    lo[:tshift] = la[:1]          # the halo is cut by the page's top edge: keep it running to the top of the new frame
else:
    lo[:H + tshift] = la[-tshift:]; lo[H + tshift:] = 0
lay = Image.fromarray(lo)
scene = scene.convert('RGBA'); scene.alpha_composite(lay)
final = scene.convert('RGB').resize((1280, 720), Image.LANCZOS)
if len(sys.argv) > 7 and float(sys.argv[7]) > 0:
    # optional: soften render grain in the sky and the felt only (keeps the PNG small); the squishy (eyes included) and the lockup are untouched
    from PIL import ImageFilter
    rad = float(sys.argv[7])
    fa = np.array(final).astype(float)
    warm = ((fa[..., 0] - fa[..., 2]) > 45).astype(np.uint8) * 255      # orange squishy, amber lettering
    prot = Image.fromarray(warm).filter(ImageFilter.MaxFilter(31)).filter(ImageFilter.GaussianBlur(5))
    pm = np.array(prot).astype(float)[..., None] / 255.0
    ba = np.array(final.filter(ImageFilter.GaussianBlur(rad))).astype(float)
    final = Image.fromarray((fa * pm + ba * (1 - pm)).round().astype(np.uint8))
final.save(out, optimize=True)
import os; print(out, final.size, os.path.getsize(out))
