#!/usr/bin/env python3
"""test_asset_staging.py — CI for the Tier-2 F: asset staging (material_library +
hdri_library + texture_transcode + _hdr_codec).

Proves, against the REAL Poly Haven sets on F: (no claude -p, no browser):
  • pick() returns existing files for every surface / a game theme,
  • staging a PBR set produces all MeshStandard channels INCLUDING a derived normal
    (the missing-normal fix) and fits a per-material byte budget,
  • staging an HDRI prefilters 6.6MB -> a sub-MB env that re-decodes to the small dims,
  • a staged material + IBL together stay within the "few MB" added-payload target.

Hermetic: if F: isn't mounted (no junction), prints SKIP and exits 0 so CI stays green
on machines without the asset drive.
"""
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ART = HERE.parents[1] / "art"            # gates -> engine -> pipeline ; pipeline/art
sys.path.insert(0, str(ART))

import material_library as ml            # noqa: E402
import hdri_library as hl                # noqa: E402
import texture_transcode as tt          # noqa: E402
import _hdr_codec as hc                  # noqa: E402
from PIL import Image                    # noqa: E402
import numpy as np                       # noqa: E402

MAT_BUDGET = 2.0 * 1024 * 1024           # one staged PBR set @1024 WebP
HDRI_BUDGET = 0.7 * 1024 * 1024          # one prefiltered env .hdr @256
COMBINED_BUDGET = 2.5 * 1024 * 1024      # material + IBL added to a game

checks = 0
fails = []


def ok(cond, msg):
    global checks
    checks += 1
    if not cond:
        fails.append(msg)


if not (ml.root() and hl.root()):
    print("ASSET-STAGING: SKIP (F: polyhaven assets not mounted)")
    sys.exit(0)

# ── material_library.pick returns REAL files for every surface ────────────────
for surf in ml.SURFACE_KEYWORDS:
    p = ml.pick("forest", surf, 7)
    ok(p is not None, f"pick(forest,{surf}) returned None")
    if p:
        ok(p["files"]["diffuse"].exists(), f"{surf}: diffuse path missing on disk: {p['files'].get('diffuse')}")
        ok("disp" in p["files"] and p["files"]["disp"].exists(), f"{surf}: no displacement to derive a normal from")

# determinism
ok(ml.pick("urban", "concrete", 3)["name"] == ml.pick("urban", "concrete", 3)["name"],
   "material pick() not deterministic")

# ── stage a material: all channels incl derived normal, within budget ─────────
with tempfile.TemporaryDirectory() as td:
    mat = ml.pick("forest", "grass", 1)
    r = tt.stage_material(mat, td, size=1024)
    for chan in ("diffuse", "rough", "ao", "normal"):
        ok(chan in r["files"] and r["files"][chan].exists(), f"staged material missing {chan}")
    ok(r["bytes"] <= MAT_BUDGET, f"staged material {r['bytes']/1024/1024:.2f}MB > {MAT_BUDGET/1024/1024}MB")
    # the derived normal must look like a tangent-space normal map (Z≈1 -> blue high)
    nrm = np.asarray(Image.open(r["files"]["normal"]).convert("RGB"))
    ok(nrm.shape[0] == 1024 and nrm.shape[1] == 1024, f"normal not 1024px: {nrm.shape}")
    ok(nrm[..., 2].mean() > 180, f"derived normal blue/Z mean too low ({nrm[...,2].mean():.0f}) — not a normal map")
    ok(120 < nrm[..., 0].mean() < 136 and 120 < nrm[..., 1].mean() < 136,
       f"derived normal R/G not centred (~128): R={nrm[...,0].mean():.0f} G={nrm[...,1].mean():.0f}")
    mat_bytes = r["bytes"]

# ── stage an HDRI: sub-MB env that re-decodes to small dims ───────────────────
with tempfile.TemporaryDirectory() as td:
    hd = hl.pick("indoor", 1)
    ok(hd is not None and hd["file"].exists(), f"hdri pick missing file: {hd}")
    out = Path(td) / "env.hdr"
    n = hl.stage(hd, out, target_h=256)
    ok(n <= HDRI_BUDGET, f"staged HDRI {n/1024:.0f}KB > {HDRI_BUDGET/1024:.0f}KB")
    H, W, rgb = hc.read_hdr(out)
    ok((H, W) == (256, 512), f"staged HDRI dims {W}x{H} != 512x256")
    ok(np.isfinite(rgb).all() and rgb.max() > 0, "staged HDRI not finite / black")
    hdri_bytes = n

ok(mat_bytes + hdri_bytes <= COMBINED_BUDGET,
   f"material+IBL {(mat_bytes+hdri_bytes)/1024/1024:.2f}MB > {COMBINED_BUDGET/1024/1024}MB added-payload target")

if fails:
    print(f"ASSET-STAGING: FAIL ({len(fails)} of {checks} checks)")
    for f in fails:
        print("   - " + f)
    sys.exit(1)
print(f"ASSET-STAGING: PASS ({checks} checks; material {mat_bytes/1024:.0f}KB + IBL {hdri_bytes/1024:.0f}KB)")
sys.exit(0)
