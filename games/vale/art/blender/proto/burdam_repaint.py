"""Burdam post-paint re-run (polish pass): iterate the value grade without a full build.

The base build dumps its raw projection (BURDAM_PAINT_DUMP=<npz>: the painted atlas before the post-paint, with the
rasterised P / N / part maps). This script re-runs fighters/burdam.py's _post_paint on that dump twice, with the
constants the build used (--from overrides) and with new ones (--to overrides), and moves the base colour taken out
of the built GLB by the per-texel ratio of the two (linear light; the AO the pipeline multiplied in and every other
pipeline step are kept, since only the ratio is applied). Swap the result back into a GLB with
art/.cache/burdam_paint/swaptex.mjs and measure it in game (_harness/value_probe.mjs).

    node art/.cache/burdam_paint/gettex.mjs art/out/fighters/burdam/burdam.glb <base.png>
    Blender -b --factory-startup --python art/blender/proto/burdam_repaint.py -- --dump <npz> --tex <base.png> \
        --out <new.png> --to "COWL_MEAN=#A08C76;STONE_TOP=#B8AB98" [--from "..."] [--stats]

--stats prints each part's mean albedo L* (lit-independent) before / after.
"""
from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
sys.path.insert(0, BL)
sys.path.insert(0, os.path.join(BL, "fighters"))
sys.path.insert(0, HERE)


def parse_set(s: str) -> dict:
    out = {}
    for kv in (s or "").split(";"):
        if not kv.strip():
            continue
        k, v = kv.split("=", 1)
        v = v.strip()
        try:
            v = float(v) if not v.startswith("#") else v
        except ValueError:
            pass
        out[k.strip()] = v
    return out


def main():
    import argparse
    from common import scene
    from common.hifi import project
    p = argparse.ArgumentParser()
    p.add_argument("--dump", required=True)
    p.add_argument("--tex", default="")
    p.add_argument("--out", default="")
    p.add_argument("--from", dest="frm", default="")
    p.add_argument("--to", default="")
    p.add_argument("--stats", action="store_true")
    a = p.parse_args(scene.script_args())
    import burdam as F
    d = np.load(a.dump, allow_pickle=False)
    img = d["img"].astype(np.float32)
    names = [str(x) for x in d["names"]]
    maps = {"P": d["P"], "N": d["N"], "part": d["part"], "size": img.shape[0]}
    keep = {k: getattr(F, k) for k in set(parse_set(a.frm)) | set(parse_set(a.to))}

    def run(over):
        for k, v in keep.items():
            setattr(F, k, v)
        for k, v in over.items():
            setattr(F, k, v)
        return project._lin(F._post_paint(img.copy(), maps, names, log=lambda *x: None))
    A = run(parse_set(a.frm))
    B = run(parse_set(a.to))
    for k, v in keep.items():
        setattr(F, k, v)
    part = maps["part"]
    have = part >= 0
    if a.stats:
        for i, nm in enumerate(names):
            m = part == i
            if not m.any():
                continue
            ya, yb = float(np.mean(F._lum(A[m]))), float(np.mean(F._lum(B[m])))
            if abs(ya - yb) > 1e-4:
                print(f"  {nm:16s} L* {F._lstar(ya):5.1f} -> {F._lstar(yb):5.1f}")
    if not a.tex:
        return
    ratio = np.ones_like(A)
    ratio[have] = np.clip(B[have] / np.maximum(A[have], 1e-4), 0.25, 4.0)
    iy, ix = project.nearest_index(have)
    ratio = ratio[iy, ix]
    tex = project.load_rgb(a.tex)
    if tex.shape[:2] != ratio.shape[:2]:
        raise SystemExit(f"texture {tex.shape} vs dump {ratio.shape}: not the dump's build")
    # alignment check: the dump's own post-paint (A) against the shipped texture, luminance correlation
    ya, yt = F._lum(A[have]), F._lum(project._lin(tex)[have])
    print(f"alignment: corr(A, shipped) = {np.corrcoef(ya, yt)[0, 1]:.3f} (expect > 0.9)")
    out = project._srgb(np.clip(project._lin(tex) * ratio, 0.0, 1.0))
    project.save_rgb(out.astype(np.float32), a.out)
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
