# verify W1-B r3 (temp): ruling 32 reserved % (PIL and float) + head-part texels changed (lane start 97cff3317^ vs HEAD)
import sys, os, numpy as np
sys.path.insert(0, 'art/tools')
import zone_grade as z
from PIL import Image
D='_harness/_tmp_vfy_w1b_r3'
for f in ['odrum','ulkro','ardit','dunsom','hesmi']:
    a = z.glb_image(f'{D}/before_{f}.glb', '_base').astype(int)
    b = z.glb_image(f'{D}/after_{f}.glb', '_base').astype(int)
    pil = z.reserved_pct(b, pil_only=True); mx = z.reserved_pct(b)
    pb = z.reserved_pct(a)
    print(f, 'HEAD PIL', pil, 'max', mx, '| lane start max', pb)
    if a.shape != b.shape: print(f, 'shape', a.shape, b.shape); continue
    d = np.abs(a-b).max(-1) > 24
    pm = np.load(os.path.join(z.PARTMAP, f'{f}.npz'))
    names = [str(n) for n in pm['names']]
    part = np.asarray(Image.fromarray(pm['part'].astype('uint8')).resize((a.shape[1], a.shape[0]), Image.NEAREST))
    rows=[]
    for i, n in enumerate(names):
        m = part == i
        if m.sum() < 200: continue
        if any(k in n.lower() for k in ('head','face','mask','eye','hair','mouth','brow','nose','beard','skin','hood','wrap','veil')):
            rows.append((n, round(100*float(d[m].mean()),2), int(m.sum())))
    print(f, 'changed %.1f%%' % (100*d.mean()), 'head-ish:', rows)
