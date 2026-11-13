#!/usr/bin/env python3
"""texture_transcode.py — stage a Poly Haven PBR set + HDRI into web-budget assets.

Two payload problems this solves (see pipeline/engine/payload_gate.py):
  • A raw Poly Haven set is ~9.7MB of 2k JPGs; a 2k HDRI is 6.6MB. Naively bundling
    those blows the single-file game budget. We resize textures to 1k/512 WebP and
    prefilter the HDRI to a small env (_hdr_codec) so a full staged material set + IBL
    fits in a couple MB.
  • The sets on disk have NO normal map. derive_normal() synthesizes a tangent-space
    (OpenGL / nor_gl, +Y up) normal from the displacement height map at stage time —
    the "missing normals" fix, with no re-download needed.

Output channels shipped for MeshStandard: map(diffuse), roughnessMap, aoMap, normalMap.
Displacement is consumed to build the normal but NOT shipped (web displacement needs
tessellated geometry; the normal carries the meso detail at zero geometry cost).

Needs PIL + numpy (both present); no native transcoder (toktx/basisu) required.
"""
from pathlib import Path

import numpy as np
from PIL import Image

from _hdr_codec import stage_hdr  # noqa: F401  (re-exported for callers)

Image.MAX_IMAGE_PIXELS = None  # Poly Haven 2k/4k are big but trusted local files


def derive_normal(disp_img: Image.Image, strength: float = 2.5) -> Image.Image:
    """Tangent-space normal (OpenGL nor_gl, +Y up) from a displacement/height map."""
    h = np.asarray(disp_img.convert("L"), dtype=np.float32) / 255.0
    gy, gx = np.gradient(h)                      # gy along rows(top->down), gx along cols
    nx = -gx * strength
    ny = gy * strength                           # +Y up: brighter-below -> normal tilts up
    nz = np.ones_like(h)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    rgb = np.stack([(nx * inv) * 0.5 + 0.5,
                    (ny * inv) * 0.5 + 0.5,
                    (nz * inv) * 0.5 + 0.5], axis=-1)
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), "RGB")


def _resize(img: Image.Image, size: int) -> Image.Image:
    if max(img.size) == size and img.width == img.height:
        return img
    return img.resize((size, size), Image.LANCZOS)


def stage_material(mat: dict, out_dir, size: int = 1024, quality: int = 85) -> dict:
    """Resize a material set to `size` WebP + derive its normal. Returns
    {"name", "size", "files": {chan: Path}, "bytes": int}.

    `mat` is a material_library.pick() result (has .files paths). Skips channels whose
    source is missing; always produces a normal (from disp, else flat) so the kernel
    can bind normalMap unconditionally.
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    src = mat["files"]
    files, total = {}, 0

    def _save(img, chan, q):
        nonlocal total
        p = out_dir / f"{chan}.webp"
        img.save(p, "WEBP", quality=q, method=6)
        files[chan] = p
        total += p.stat().st_size

    # color-ish channels
    if "diffuse" in src and src["diffuse"].exists():
        _save(_resize(Image.open(src["diffuse"]).convert("RGB"), size), "diffuse", quality)
    if "rough" in src and src["rough"].exists():
        _save(_resize(Image.open(src["rough"]).convert("L"), size), "rough", quality)
    if "ao" in src and src["ao"].exists():
        _save(_resize(Image.open(src["ao"]).convert("L"), size), "ao", quality)

    # normal: derive from displacement (the missing-normal fix); fall back to flat
    if "disp" in src and src["disp"].exists():
        disp = _resize(Image.open(src["disp"]), size)
        nrm = derive_normal(disp)
    else:
        nrm = Image.new("RGB", (size, size), (128, 128, 255))
    _save(nrm, "normal", max(quality, 90))      # normals tolerate less compression

    return {"name": mat.get("name"), "size": size, "files": files, "bytes": total}


def stage_material_to_budget(mat: dict, out_dir, budget_bytes: int,
                             sizes=(1024, 512, 256)) -> dict:
    """Stage at the largest `size` whose total fits budget_bytes (else smallest)."""
    last = None
    for s in sizes:
        last = stage_material(mat, out_dir, size=s)
        if last["bytes"] <= budget_bytes:
            return last
    return last


if __name__ == "__main__":
    import sys, tempfile
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import material_library as ml
    if not ml.root():
        print("F: not mounted — nothing to stage"); raise SystemExit(0)
    m = ml.pick("forest", "grass", 1)
    with tempfile.TemporaryDirectory() as td:
        r = stage_material(m, td, size=512)
        print(f"staged {r['name']} @512: {r['bytes']/1024:.0f}KB  channels={list(r['files'])}")
