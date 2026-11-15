#!/usr/bin/env python
"""WORLD-space ridge bearing of the analytic fine layer, from the fineNormals view.

WHY NOT MEASURE THE BEAUTY FRAME. `qa_aniso` takes the structure tensor of the
SCREEN luminance. On the shipped chase camera the ground is seen at near-grazing
incidence, where the world->screen Jacobian is nearly singular, so every world
direction projects into a narrow cone around the foreshortening axis. Measured
control, same crop the last wave used: rotating `S.windDirection` by 90 degrees
-- which rotates every analytic fine layer and nothing else -- moved the reported
bearing from 161.8 to 161.3. A 90 degree rotation of the thing under test showed
up as half a degree. That number is the projection's, not the surface's.

WHAT THIS MEASURES INSTEAD. `debugView 'fineNormals'` writes
`normalFromGradient(fine.yz) * 0.5 + 0.5`, and `fine` is the analytic fine layer
ALONE -- lib/terrain's sastrugi plus lib/ground's realmFine, with the macro
landform, the deformation and the three tiled detail scales all excluded (see
snow.glsl.js, the debugMode 6 branch). So

    R = 0.5 - 0.5 * dH/dx / |n|      B = 0.5 - 0.5 * dH/dz / |n|

carries the WORLD gradient of the micro-relief, per pixel, with no lighting, no
albedo, no exposure and no projection in it. The structure tensor of THAT is the
height field's own anisotropy:

    Jxx = <gx gx>   Jzz = <gz gz>   Jxz = <gx gz>
    gradient bearing = 0.5 * atan2(2 Jxz, Jxx - Jzz), ridges perpendicular
    coherence        = hypot(Jxx - Jzz, 2 Jxz) / (Jxx + Jzz)

Angles are WORLD angles in the port's x/z plane, degrees CCW from +x, folded
into [0,180). The absolute value is only meaningful against a reference, so the
useful numbers are (a) the offset between two realms and (b) how far the bearing
moves under the wind-90 control -- an instrument that does not move ~90 degrees
there is not measuring the wind-aligned relief.

    python qa_worldaniso.py _shots/td_cold_fineonly.png 240 60 800 600
"""
import sys

import numpy as np
from PIL import Image


def channels(path, x, y, w, h):
    """The two world-gradient channels of a fineNormals crop, mean removed."""
    a = np.asarray(Image.open(path).convert("RGB").crop((x, y, x + w, y + h)),
                   dtype=np.float64) / 255.0
    # R and B encode -dH/dx and -dH/dz. The common sign cancels in every product
    # the tensor takes, so it is left in.
    gx = a[..., 0] - a[..., 0].mean()
    gz = a[..., 2] - a[..., 2].mean()
    return gx, gz


def measure(path, x, y, w, h):
    gx, gz = channels(path, x, y, w, h)
    jxx, jzz, jxz = (gx * gx).sum(), (gz * gz).sum(), (gx * gz).sum()
    tr = jxx + jzz
    if tr <= 0:
        return dict(ridge_deg=0.0, coherence=0.0, energy=0.0)
    coh = float(np.hypot(jxx - jzz, 2.0 * jxz) / tr)
    grad = 0.5 * np.degrees(np.arctan2(2.0 * jxz, jxx - jzz))
    ridge = float((grad + 90.0) % 180.0)
    return dict(ridge_deg=ridge, coherence=coh,
                energy=float(np.sqrt(tr / gx.size)))


def sep(a, b):
    """Unsigned separation between two ridge bearings, in [0, 90]."""
    d = abs(a - b) % 180.0
    return d if d <= 90.0 else 180.0 - d


if __name__ == "__main__":
    p = sys.argv[1]
    x, y, w, h = (int(v) for v in sys.argv[2:6])
    r = measure(p, x, y, w, h)
    print("%s [%d,%d %dx%d]  ridge=%6.1f deg  coherence=%.4f  energy=%.5f"
          % (p, x, y, w, h, r["ridge_deg"], r["coherence"], r["energy"]))
