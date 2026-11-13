#!/usr/bin/env python
"""Measure the ORIENTATION and the ANISOTROPY of a surface's micro-relief.

The realm contract's Sand and Ash criteria are both directional claims -- Sand's
fine ripples must run TRANSVERSE to the wind (i.e. the same way as the broad dune
ridges, the deliberate negation of Cold's sastrugi criterion) and Ash's crust
cracks must be NEAR-ISOTROPIC (no wind direction at all). "It looks different" is
not a test of either. This is.

Method: high-pass the crop (subtract a box blur) so the terrain's own slope shading
cannot dominate, then accumulate the structure tensor of the residual. The dominant
GRADIENT direction is 0.5*atan2(2*Jxy, Jxx-Jyy); ridges run PERPENDICULAR to it.
Coherence = sqrt((Jxx-Jyy)^2 + 4*Jxy^2) / (Jxx+Jyy) is 0 for a perfectly isotropic
field and 1 for a perfect grating -- that single number is what falsifies or
confirms "near-isotropic".

    python qa_aniso.py _shots/realm_cold.png 40 430 360 200

Angles are reported in SCREEN space, degrees CCW from +x (image right), folded into
[0,180) because a ridge has no head or tail.
"""
import sys
import numpy as np
from PIL import Image


def boxblur(a, k):
    """Separable box blur via cumulative sums; edge-replicated."""
    p = k // 2
    b = np.pad(a, p, mode="edge")
    # Prepend the zero row/column so the running sums are inclusive-exclusive and
    # the window count comes out exactly right; without it the result is one short
    # on each axis and the subtraction silently fails to broadcast.
    c = np.vstack([np.zeros((1, b.shape[1])), np.cumsum(b, axis=0)])
    b = (c[k:, :] - c[:-k, :]) / k
    c = np.hstack([np.zeros((b.shape[0], 1)), np.cumsum(b, axis=1)])
    return (c[:, k:] - c[:, :-k]) / k


def measure(path, x, y, w, h, hp=9):
    im = Image.open(path).convert("RGB")
    a = np.asarray(im.crop((x, y, x + w, y + h)), dtype=np.float64) / 255.0
    lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    hi = lum - boxblur(lum, hp)          # kill the slope, keep the relief
    gy, gx = np.gradient(hi)
    jxx, jyy, jxy = (gx * gx).sum(), (gy * gy).sum(), (gx * gy).sum()
    tr = jxx + jyy
    coh = np.hypot(jxx - jyy, 2.0 * jxy) / tr if tr > 0 else 0.0
    grad = 0.5 * np.degrees(np.arctan2(2.0 * jxy, jxx - jyy))
    # image +y points DOWN, so negate to report a conventional CCW screen angle
    ridge = (-grad + 90.0) % 180.0
    return dict(ridge_deg=ridge, coherence=coh, energy=float(np.sqrt(tr / hi.size)))


def correlate(pa, pb, x, y, w, h, hp=9):
    """Normalised cross-correlation of two crops' high-passed relief.

    The decisive test for "recoloured snow". Orientation alone cannot separate
    'the same pattern, retinted' from 'a different pattern that happens to run
    the same way'. Correlation can: the camera, the terrain bake and the frame
    are identical between two realm shots, so if the micro-relief were genuinely
    re-authored the high-passed residuals would decorrelate toward 0. A value
    near 1 means the two frames carry literally the same surface structure.
    """
    def hi(p):
        a = np.asarray(Image.open(p).convert("RGB").crop((x, y, x + w, y + h)),
                       dtype=np.float64) / 255.0
        lum = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
        r = lum - boxblur(lum, hp)
        return (r - r.mean()) / (r.std() + 1e-12)
    a, b = hi(pa), hi(pb)
    return float((a * b).mean())


if __name__ == "__main__":
    if sys.argv[1] == "--pair":
        pa, pb = sys.argv[2], sys.argv[3]
        x, y, w, h = (int(v) for v in sys.argv[4:8])
        print(f"corr({pa}, {pb}) [{x},{y} {w}x{h}] = "
              f"{correlate(pa, pb, x, y, w, h):+.4f}")
    else:
        p = sys.argv[1]
        x, y, w, h = (int(v) for v in sys.argv[2:6])
        r = measure(p, x, y, w, h)
        print(f"{p} [{x},{y} {w}x{h}]  ridge={r['ridge_deg']:6.1f} deg   "
              f"coherence={r['coherence']:.4f}   relief_energy={r['energy']:.5f}")
