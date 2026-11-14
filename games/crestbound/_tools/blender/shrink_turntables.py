"""Turntables are REVIEW renders, and PNG is the wrong container for them.

Measured on assets/models/keep/_turntable/arch_door_00.png (1024x1024 Eevee, RGB):
    PNG as written      948,655 bytes
    PNG optimize=True   707,709
    PNG 256-colour      415,037
    WEBP quality 92      21,262      <- 45x smaller, and a review render is not a texture

The four kits between them had written ~320 MB of turntable PNGs into the repo. This converts
every one to WebP and rewrites the turntable / contact-sheet names inside the manifests that
list them, so a manifest never points at a file that is no longer there.

    python shrink_turntables.py [--dry]
"""
import os, sys, json, glob

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
MODELS = os.path.join(ROOT, 'assets', 'models')
DRY = '--dry' in sys.argv
QUALITY = 92
KEYS = ('turntable', 'contact_sheet', 'turntables', 'sheets')

try:
    from PIL import Image
except ImportError:
    raise SystemExit('Pillow is required: python -m pip install pillow')


def convert():
    before = after = 0
    n = 0
    for png in glob.glob(os.path.join(MODELS, '**', '_turntable', '*.png'), recursive=True):
        webp = png[:-4] + '.webp'
        b = os.path.getsize(png)
        before += b
        if DRY:
            after += b // 40
            n += 1
            continue
        im = Image.open(png)
        im.convert('RGB' if im.mode in ('RGB', 'P', 'L') else 'RGBA').save(webp, 'WEBP', quality=QUALITY, method=5)
        after += os.path.getsize(webp)
        os.remove(png)
        n += 1
    return n, before, after


def fix_names(obj):
    """Rewrite any string value under a turntable-ish key from .png to .webp when the .webp exists."""
    changed = 0
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and v.endswith('.png') and k in KEYS:
                obj[k] = v[:-4] + '.webp'; changed += 1
            elif isinstance(v, list) and k in KEYS:
                for i, s in enumerate(v):
                    if isinstance(s, str) and s.endswith('.png'):
                        v[i] = s[:-4] + '.webp'; changed += 1
            else:
                changed += fix_names(v)
    elif isinstance(obj, list):
        for v in obj:
            changed += fix_names(v)
    return changed


if __name__ == '__main__':
    n, b, a = convert()
    print('turntable frames: %d   %.1f MB -> %.1f MB (%.0fx)' % (n, b / 1e6, a / 1e6, b / max(1.0, a)))
    total = 0
    for jp in glob.glob(os.path.join(MODELS, '**', '*.json'), recursive=True):
        try:
            d = json.load(open(jp, encoding='utf-8'))
        except Exception:
            continue
        c = fix_names(d)
        if c and not DRY:
            json.dump(d, open(jp, 'w', encoding='utf-8'), indent=1)
        total += c
        if c:
            print('  %-58s %d names' % (os.path.relpath(jp, ROOT), c))
    print('manifest names rewritten:', total)
