#!/usr/bin/env python
"""SKY lane (Wave 4): how drop-frame luma spread and the map-edge / ocean-horizon seam respond to the fog multiplier.

Serves everything frozen at git HEAD except maps.js (--src head|work, default work), starts a PRACTICE match per map, places the
camera at the drop poses used by sky_shots.py and, WITHOUT running the kernel updaters (so the altitude-fog updater cannot
overwrite the experiment), sets fog.density = K.fog * multiplier and renders the composer once per multiplier.

  luma_sd  imgstats centre-crop luma standard deviation (plan P1.10 gate: >= 0.08 on drop frames)
  seam     max over rows of the mean vertical luminance step (3-row difference) in the two side column bands - a horizontal
           map-edge / ocean-horizon seam shows up as a single large step; a seamless horizon only has the smooth haze gradient.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sky_lib as L  # noqa: E402

C = L.C

RENDER_JS = r"""(mul) => { const W = window.__LC__.W, k = W.kernel, f = W.scene.fog;
  f.density = W.map.K.fog * mul; if (k.composer) k.composer.render(1 / 60); else k.renderer.render(k.scene, k.camera);
  return k.renderer.domElement.toDataURL('image/png'); }"""


def seam_strength(path):
    import cv2
    import numpy as np
    im = cv2.imread(path)
    g = (0.0722 * im[..., 0] + 0.7152 * im[..., 1] + 0.2126 * im[..., 2]).astype(np.float32) / 255.0
    h, w = g.shape
    bands = np.concatenate([g[:, int(w * 0.04):int(w * 0.30)], g[:, int(w * 0.70):int(w * 0.96)]], axis=1)
    prof = bands.mean(axis=1)
    step = np.abs(prof[3:] - prof[:-3])
    step[:6] = 0
    return float(step.max()), int(step.argmax())


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--src", default="work", choices=["head", "work"])
    ap.add_argument("--mults", default="1.0,0.7,0.5,0.35,0.25,0.15")
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--tag", default="fogcurve")
    args = ap.parse_args()
    args.disk = True
    args.rev = "HEAD"
    outdir = args.outdir or os.path.join(C.SHOTS, "sky_fogcurve")
    os.makedirs(outdir, exist_ok=True)
    mults = [float(x) for x in args.mults.split(",")]
    rows = []
    with C.Session(args, "fogcurve") as s:
        L.maps_override(s, args.src)
        s.boot()
        s.freeze_loop()
        s.install_pump()
        for mid in [m for m in args.maps.split(",") if m]:
            s.start_match("practice", 1, mid, enter=True)
            s.js(L.HELPERS_JS)
            s.guard_player(True)
            pois = s.js("() => window.__SKY__.pois()")
            half = s.js("() => window.__LC__.W.map.half")
            big = max(pois, key=lambda p: p["r"])
            px, pz = big["x"], big["z"]
            gy = s.js("([x,z]) => window.__SKY__.ground(x,z)", [px, pz])
            poses = {}
            for alt, nm in ((250.0, "drop250"), (330.0, "drop330")):
                back = alt / math.tan(0.82)
                fx, fz = px + math.sin(0.7) * back, pz + math.cos(0.7) * back
                poses[nm] = (fx, gy + alt, fz, s.js("([a,b,c,d]) => window.__SKY__.yawTo(a,b,c,d)", [fx, fz, px, pz]), -0.2)
            e = half * 0.9
            for nm, (x, z, yaw) in {"edge_px": (e, 0, -math.pi / 2), "edge_nx": (-e, 0, math.pi / 2),
                                    "edge_pz": (0, e, math.pi), "edge_nz": (0, -e, 0.0)}.items():
                poses[nm] = (x, 250.0, z, yaw, -0.12)
            for nm, (x, y, z, yaw, pitch) in poses.items():
                for _ in range(2):
                    s.js("([x,y,z,yw,pt]) => window.__SKY__.place(x,y,z,yw,pt,{vy:-2,ground:false})", [x, y, z, yaw, pitch])
                    s.js("() => window.__SKY__.top()")
                    s.step_frames(6, 1 / 60, render=False)
                s.js("([x,y,z,yw,pt]) => window.__SKY__.place(x,y,z,yw,pt,{vy:-2,ground:false})", [x, y, z, yaw, pitch])
                s.step_frames(1, 1 / 60, render=False)
                for m in mults:
                    url = s.js(RENDER_JS, m)
                    import base64
                    p = os.path.join(outdir, "%s_%s_%s_m%03d.png" % (args.tag, mid, nm, int(round(m * 100))))
                    with open(p, "wb") as f:
                        f.write(base64.b64decode(url.split(",", 1)[1]))
                    st = L.stats(p)
                    seam, row = seam_strength(p)
                    rows.append({"map": mid, "pose": nm, "mult": m, "luma_sd": round(st["luma_sd"], 4), "sat": round(st["sat"], 3),
                                 "r_minus_b": round(st["r_minus_b"], 3), "seam": round(seam, 4), "seamRow": row, "png": p})
                    print("  %-9s %-9s mult %.2f  luma_sd %.3f  seam %.4f @row %d" % (mid, nm, m, st["luma_sd"], seam, row), flush=True)
        d = s.diagnostics()
    jp = os.path.join(outdir, "%s_%s.json" % (args.tag, args.src))
    json.dump({"src": args.src, "rows": rows, "diag": {k: v[:3] for k, v in d.items() if isinstance(v, list) and v}}, open(jp, "w"), indent=1)
    print("wrote", jp)
    return 0


if __name__ == "__main__":
    sys.exit(main())
