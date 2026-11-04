#!/usr/bin/env python3
"""VALE art: id-masked Lab of a shipped fighter GLB's painted base colour (closing CW5 done:4, refix 2).

    python3 art/tools/part_lab.py art/out/fighters/burdam/burdam.glb [--sid burdam]
        [--group pauldron=tier1,tier2,tier3,tier4] [--pair coat:strap ...] [--parts a,b] [--out report.txt]

The bake (common/pipeline.build -> hifi/project.paint_object) writes the texel-to-part map of every fighter and skin
build to art/.cache/fighters/partmap/<sid>.npz (part index per texel, row 0 = top, and the part names). This tool
reads the GLB's base-colour texture (the largest baseColorTexture: the body), resamples the part map onto it
(nearest) and reports, per part (or pooled group), the texel count, L* p10 / p50 / p90 and its spread (p90 - p10),
and the mean Lab; --pair a:b reports dE76 between the two means (a part or a group name). No camera, no lighting:
the painted value itself, masked by part id, so a pauldron's recess paint is measured on the pauldron only.
"""
from __future__ import annotations

import io
import json
import os
import struct
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(os.path.dirname(HERE))
PARTMAP = os.path.join(GAME, "art", ".cache", "fighters", "partmap")


def glb_base_texture(path: str) -> np.ndarray:
    with open(path, "rb") as f:
        b = f.read()
    off, js, binc = 12, None, None
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        chunk = b[off + 8: off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(chunk)
        elif ty == 0x004E4942:
            binc = chunk
        off += 8 + ln
    best = None
    for m in js.get("materials", []):
        t = (m.get("pbrMetallicRoughness") or {}).get("baseColorTexture")
        if t is None:
            continue
        tex = js["textures"][t["index"]]
        src = tex.get("source")
        for ext in (tex.get("extensions") or {}).values():
            src = ext.get("source", src)
        img = js["images"][src]
        bv = js["bufferViews"][img["bufferView"]]
        data = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        im = Image.open(io.BytesIO(data)).convert("RGB")
        if best is None or im.size[0] * im.size[1] > best.size[0] * best.size[1]:
            best = im
    if best is None:
        raise SystemExit(f"{path}: no baseColorTexture")
    return np.asarray(best).astype(np.float32) / 255.0


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def main(argv: list[str]) -> int:
    def opts(k):
        return [argv[i + 1] for i, a in enumerate(argv) if a == k and i + 1 < len(argv)]
    glb = next(a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or not argv[i - 1].startswith("--")))
    sid = (opts("--sid") or [os.path.splitext(os.path.basename(glb))[0]])[0]
    pm = os.path.join(PARTMAP, f"{sid}.npz")
    if not os.path.isfile(pm):
        raise SystemExit(f"no part map {pm}: rebuild the fighter (python3 art/build.py fighter <id>)")
    z = np.load(pm)
    part, names = z["part"], [str(n) for n in z["names"]]
    tex = glb_base_texture(glb)
    H, W = tex.shape[:2]
    ys = (np.arange(H) * part.shape[0] / H).astype(int)
    xs = (np.arange(W) * part.shape[1] / W).astype(int)
    pid = part[ys][:, xs]
    lab = srgb_to_lab(tex)
    groups = {}
    for g in opts("--group"):
        k, v = g.split("=", 1)
        groups[k] = v.split(",")
    sel = (opts("--parts") or [None])[0]
    show = sel.split(",") if sel else [n for n in names if (pid == names.index(n)).any()]
    lines = [f"# part_lab {os.path.relpath(glb, GAME)} (texture {W}x{H}, part map {pm.split('art/')[-1]}): "
             f"id-masked painted base colour, L* p10/p50/p90 spread | mean Lab | texels"]
    means = {}

    def row(label, mask):
        L = lab[mask]
        if not len(L):
            return
        p10, p50, p90 = np.percentile(L[:, 0], [10, 50, 90])
        mu = L.mean(0)
        means[label] = mu
        lines.append(f"  {label:<22} L* {p10:5.1f}/{p50:5.1f}/{p90:5.1f} spread {p90 - p10:5.1f} | "
                     f"Lab [{mu[0]:5.1f} {mu[1]:5.1f} {mu[2]:5.1f}] | {int(mask.sum())}")
    for n in show:
        if n in names:
            row(n, pid == names.index(n))
    for k, members in groups.items():
        row(k + " (group)", np.isin(pid, [names.index(m) for m in members if m in names]))
    for pr in opts("--pair"):
        a, b = pr.split(":")
        a2 = a if a in means else a + " (group)"
        b2 = b if b in means else b + " (group)"
        if a2 in means and b2 in means:
            lines.append(f"  pair {a} : {b}  dE76 {float(np.linalg.norm(means[a2] - means[b2])):.1f}")
    txt = "\n".join(lines)
    print(txt)
    out = (opts("--out") or [None])[0]
    if out:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            f.write(txt + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
