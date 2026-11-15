"""orch1 GFX-10: per-tier SSIM and CIELAB dE vs Ultra at the game camera, for the pack's four quality scenes (teamfight peak,
river_mid, base_aubade, jungle_glasshorn) on Low / Medium / High / Ultra.  Reads the pack PNG/WebP frames, writes
_design/reviews/orch1/quality_tiers.json (the table) and prints it.
  ~/Developer/forgeflow-games/.venv/bin/python3 _harness/quality_tiers.py [pack_dir] [out_json]
Metrics: SSIM on BT.709 luma (7x7 uniform window, 8-bit range, mean over the frame); dE76 mean / p95 / share of pixels over 2.3 (one just-noticeable
difference); a tier is 'indistinguishable from Ultra' when mean dE < 1 and SSIM >= 0.98."""
import json, os, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'visual')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, '..', '_design', 'reviews', 'orch1', 'quality_tiers.json')
SCENES = ['teamfight', 'river_mid', 'base_aubade', 'jungle_glasshorn']
TIERS = ['low', 'medium', 'high', 'ultra']


def load(scene, tier):
    for ext in ('png', 'webp'):
        p = os.path.join(PACK, f'quality_{scene}_{tier}.{ext}')
        if os.path.exists(p):
            return np.asarray(Image.open(p).convert('RGB'), dtype=np.float64)
    return None


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab(rgb):
    r, g, b = lin(rgb[..., 0]), lin(rgb[..., 1]), lin(rgb[..., 2])
    x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    f = lambda t: np.where(t > 216 / 24389, np.cbrt(t), (24389 / 27 * t + 16) / 116)
    return np.stack([116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))], -1)


def box(a, k):
    p = np.pad(a, ((k // 2, k // 2), (k // 2, k // 2)), mode='reflect')
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    h, w = a.shape
    return (c[k:k + h, k:k + w] - c[:h, k:k + w] - c[k:k + h, :w] + c[:h, :w]) / (k * k)


def ssim(a, b, k=7):
    la = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    lb = 0.2126 * b[..., 0] + 0.7152 * b[..., 1] + 0.0722 * b[..., 2]
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    ma, mb = box(la, k), box(lb, k)
    saa, sbb, sab = box(la * la, k) - ma * ma, box(lb * lb, k) - mb * mb, box(la * lb, k) - ma * mb
    s = ((2 * ma * mb + c1) * (2 * sab + c2)) / ((ma * ma + mb * mb + c1) * (saa + sbb + c2))
    return float(s.mean())


rows, missing = [], []
for sc in SCENES:
    ref = load(sc, 'ultra')
    if ref is None:
        missing.append(f'{sc}/ultra'); continue
    lref = lab(ref)
    for t in TIERS:
        im = load(sc, t)
        if im is None:
            missing.append(f'{sc}/{t}'); continue
        if im.shape != ref.shape:
            im = np.asarray(Image.fromarray(im.astype(np.uint8)).resize((ref.shape[1], ref.shape[0]), Image.LANCZOS), dtype=np.float64)
        d = np.linalg.norm(lab(im) - lref, axis=-1)
        rows.append({'scene': sc, 'tier': t, 'ssimVsUltra': round(ssim(im, ref), 4), 'dEMean': round(float(d.mean()), 3), 'dEp95': round(float(np.percentile(d, 95)), 3), 'shareOver2_3': round(float((d > 2.3).mean()), 4)})
by = {}
for r in rows:
    by.setdefault(r['tier'], []).append(r)
summ = {t: {'ssimVsUltra': round(float(np.mean([r['ssimVsUltra'] for r in v])), 4), 'dEMean': round(float(np.mean([r['dEMean'] for r in v])), 3), 'dEp95': round(float(np.mean([r['dEp95'] for r in v])), 3)} for t, v in by.items()}
hi = summ.get('high')
verdict = None
if hi:
    verdict = {'highVsUltra': hi, 'ultraIndistinguishableFromHigh': bool(hi['dEMean'] < 1.0 and hi['ssimVsUltra'] >= 0.98),
               'note': 'GFX-10: when true, either drop the 4096 shadow map to 2048 and spend the saved memory/GPU time on something visible, or label Ultra honestly in the settings copy.'}
out = {'gate': 'quality_tiers (GFX-10)', 'pack': os.path.relpath(PACK, os.path.join(HERE, '..')), 'scenes': SCENES, 'tiers': TIERS, 'rows': rows, 'perTierMean': summ, 'verdict': verdict, 'missing': missing,
       'method': 'luma SSIM (7x7 box window) and CIELAB dE76 of each tier frame against the Ultra frame of the same scene at the game camera, 1920x1080, DPR 1'}
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(out, open(OUT, 'w'), indent=1)
for r in rows:
    print(f"{r['scene']:17s} {r['tier']:7s} ssim {r['ssimVsUltra']:.4f}  dE mean {r['dEMean']:6.3f}  p95 {r['dEp95']:6.3f}  >2.3 {r['shareOver2_3'] * 100:5.1f}%")
print('per tier', json.dumps(summ)); print('verdict', json.dumps(verdict)); print('missing', missing)
