# verify W1-B r2 (temp): albedo texels changed before (97cff3317^) vs now, split by part-map part (head islands must be untouched)
import sys, os, numpy as np
sys.path.insert(0, 'art/tools')
import zone_grade as z
from PIL import Image
for f in ['odrum','ulkro','ardit','dunsom','hesmi']:
    a = z.glb_image(f'_harness/_tmp_vfy_w1b/before_{f}.glb', '_base').astype(int)
    b = z.glb_image(f'_harness/_tmp_vfy_w1b/after_{f}.glb', '_base').astype(int)
    if a.shape != b.shape: print(f, 'shape', a.shape, b.shape); continue
    d = np.abs(a-b).max(-1) > 24   # beyond WebP requantisation noise
    pm = np.load(os.path.join(z.PARTMAP, f'{f}.npz'))
    names = [str(n) for n in pm['names']]
    part = np.asarray(Image.fromarray(pm['part'].astype('uint8')).resize((a.shape[1], a.shape[0]), Image.NEAREST))
    rows = []
    for i, n in enumerate(names):
        m = part == i
        if m.sum() < 200: continue
        rows.append((n, round(100*float(d[m].mean()),1), int(m.sum())))
    head = [r for r in rows if any(k in r[0].lower() for k in ('head','face','mask','eye','hair','mouth','brow','nose','beard','skin'))]
    print(f, 'changed %.1f%%' % (100*d.mean()), 'head-ish parts:', head)
