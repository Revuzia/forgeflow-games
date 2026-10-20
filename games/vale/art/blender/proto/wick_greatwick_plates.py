#!/usr/bin/env python3
"""greatwick projection plates (both factions): art/tools/concept_plates.py's cut with the frame set by hand.

    ~/Developer/forgeflow-games/.venv/bin/python3 art/blender/proto/wick_greatwick_plates.py [aubade|serenade]

The shared cut gets the greatwick frames wrong (brief §5.2): the Aubade front sole row lands at 1285 (the slate
boots run to ~1385, so the feet and the hem were cut out and the painting landed ~5 % too large), and the
`top` row is the lantern, not the hood. Here every frame is measured on the concept grid:
  ground  the boot-sole row (the forward boot's sole and the back boot's averaged: the sheet has a little
          perspective, one boot stands a few px lower)
  top     the back-lantern roof top (Aubade, roof slab, 1.52 m in concept space) or the drum lid's felt
          dome top (Serenade, 1.56 m) -- PLATE_HEIGHT below, the PROJECTION height
  cx      the body axis (between the boots, checked on the hem and the hood)
The floor shadow and the background between the boots are trimmed: below the boot tops only the dark boot
(and Serenade's dark hem band) pixels are kept. Painted lamp glow is handled later, at grade time
(wick_common.graded_projection, in the build).
Writes art/.cache/concept/wicks/greatwick_<faction>_{front,back,mask}.png + _plates.json and a debug overlay
greatwick_<faction>_plates_debug.png.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = Path(__file__).resolve().parent
ART = HERE.parent.parent
GAME = ART.parent
sys.path.insert(0, str(ART / "tools"))
import concept_plates as cp  # noqa: E402

# concept-space plate heights (m): the row `top` sits this high (wick_greatwick.PLATE_HEIGHT)
PLATE_HEIGHT = {"aubade": 1.52, "serenade": 1.56}
FRAMES = {
    "aubade": {"front": {"cx": 573.0, "ground": 1372, "top": 211},
               "back": {"cx": 1506.0, "ground": 1370, "top": 215}},
    "serenade": {"front": {"cx": 527.0, "ground": 1353, "top": 175},
                 "back": {"cx": 1521.0, "ground": 1345, "top": 165}},
}
BOOT_TOP = {"aubade": 0.085, "serenade": 0.115}   # m: below this only dark (boot / hem band) paint is figure
DARK = {"aubade": 128, "serenade": 110}            # luma threshold of the boots against the floor shadow
ERODE = 7
SCALE = 0.5            # plates are written at half the sheet's resolution (~380 px/m: a 76 px-tall unit needs far
                       # less; the projection pass runs 4x faster)


def main() -> None:
    which = sys.argv[1:] or list(FRAMES)
    out = ART / ".cache" / "concept" / "wicks"
    out.mkdir(parents=True, exist_ok=True)
    for fac in which:
        cid = f"greatwick_{fac}"
        im = np.asarray(Image.open(GAME / "_design" / "concept" / "wicks" / f"{cid}.webp").convert("RGB")).astype(np.float32)
        H, W, _ = im.shape
        M = cp.figure_mask(im)
        lum = im.mean(axis=2)
        keep = nd.binary_erosion(M, iterations=ERODE)
        meta = {"size": [W, H], "id": f"wicks/{cid}"}
        for side, (x0, x1) in (("front", (0, W // 2)), ("back", (W // 2, W))):
            f = FRAMES[fac][side]
            g, t = f["ground"], f["top"]
            ppm = (g - t) / PLATE_HEIGHT[fac]
            keep[g + 3:, x0:x1] = False
            b0 = int(g - BOOT_TOP[fac] * ppm)
            band = slice(b0, g + 3)
            boot = nd.binary_opening(lum[band, x0:x1] < DARK[fac], iterations=2)
            boot = nd.binary_closing(boot, iterations=4)
            keep[band, x0:x1] &= boot
            keep[:, x0:x1] = nd.binary_opening(keep[:, x0:x1], iterations=2)
            # the dark robe opening between the Aubade stoles (trousers, under-robe) is figure, not background:
            # the shared cut leaves it out where it opens down between the boots
            sub = keep[t:b0, x0:x1]
            cols = np.where(sub.any(0))[0]
            dark = (lum[t:b0, x0:x1] < 120) & ~sub
            span = np.zeros_like(sub)
            for r in range(sub.shape[0]):
                c = np.where(sub[r])[0]
                if len(c) > 1:
                    span[r, c[0]:c[-1]] = True
            add = nd.binary_opening(dark & span, iterations=2)
            keep[t:b0, x0:x1] |= add
            # ... and the pale chalk stole that hangs into that opening (its colour is close to the paper)
            r1 = int(g - 0.12 * ppm)
            c0, c1 = int(f["cx"] - 0.12 * ppm) - x0, int(f["cx"] + 0.12 * ppm) - x0
            keep[t:r1, x0 + c0:x0 + c1] |= span[:r1 - t, c0:c1]
            meta[side] = {"cx": f["cx"], "ground": g, "top": t}
        _, (iy, ix) = nd.distance_transform_edt(~keep, return_indices=True)
        padded = im[iy, ix]
        soft = np.stack([nd.gaussian_filter(padded[..., c], 5) for c in range(3)], -1)
        padded = np.where(keep[..., None], im, soft)
        Wh, Hh = int(W * SCALE), int(H * SCALE)
        img = Image.fromarray(padded.clip(0, 255).astype(np.uint8)).resize((Wh, Hh), Image.LANCZOS)
        for side in ("front", "back"):
            img.save(out / f"{cid}_{side}.png")
        Image.fromarray((keep * 255).astype(np.uint8)).resize((Wh, Hh), Image.BILINEAR).save(out / f"{cid}_mask.png")
        meta["size"] = [Wh, Hh]
        for side in ("front", "back"):
            m_ = meta[side]
            meta[side] = {"cx": m_["cx"] * SCALE, "ground": m_["ground"] * SCALE, "top": m_["top"] * SCALE}
        meta["m_per_px"] = PLATE_HEIGHT[fac] / (meta["front"]["ground"] - meta["front"]["top"])
        meta["plate_height"] = PLATE_HEIGHT[fac]
        (out / f"{cid}_plates.json").write_text(json.dumps(meta, indent=2))
        # debug: the cut over the concept, frame rows (ground, top) and the body axis
        dbg = im * 0.55 + np.where(keep[..., None], np.array([255.0, 60, 60]), 0.0) * 0.45
        for side in ("front", "back"):
            f = {k: int(round(v / SCALE)) for k, v in meta[side].items()}
            dbg[f["ground"], :] = (0, 255, 0)
            dbg[f["top"], :] = (0, 255, 255)
            dbg[:, int(f["cx"])] = (255, 255, 0)
        Image.fromarray(dbg.clip(0, 255).astype(np.uint8)).resize((W // 2, H // 2)).save(out / f"{cid}_plates_debug.png")
        print(json.dumps(meta))


if __name__ == "__main__":
    main()
