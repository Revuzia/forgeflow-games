#!/usr/bin/env python3
"""_hdr_codec.py — pure-numpy Radiance .hdr (RGBE) reader / down-sampler / writer.

Why hand-rolled: the staging step must prefilter Poly Haven 2k HDRIs (6.6MB) down to
a small environment that fits the per-game payload budget, and there is NO imageio/
freeimage/openexr or toktx/basisu on this box (checked) — only PIL+numpy. PIL can't
read .hdr. three.js RGBELoader (the AAA kernel's IBL loader) consumes Radiance .hdr,
so we decode the RLE source, box-downsample in linear-light float, and re-emit a valid
.hdr the kernel can load.

Format refs: Radiance RGBE (Ward). We decode both the new-style adaptive RLE
(Poly Haven's encoding) and flat/old scanlines; we emit NEW-style **literal** chunks
only (cnt<=128 = literal copy in every decoder) — unambiguous, no (1,1,1) old-RLE
run-marker collision, slightly larger but always correct.

API:
    H, W, rgb = read_hdr(path)         # rgb: HxWx3 float32 linear radiance
    rgb2      = downsample(rgb, target_h)
    write_hdr(path, rgb)               # new-RLE literal; RGBELoader-readable
    stage_hdr(src, dst, target_h)      # read->downsample->write, returns dst bytes
"""
import struct
from pathlib import Path

import numpy as np


def _readline(buf, pos):
    end = buf.index(b"\n", pos)
    return buf[pos:end], end + 1


def read_hdr(path):
    """Decode a Radiance .hdr -> (H, W, float32 HxWx3 linear radiance)."""
    data = Path(path).read_bytes()
    pos = 0
    line, pos = _readline(data, pos)
    if not (line.startswith(b"#?")):
        raise ValueError(f"not a Radiance .hdr (magic={line[:16]!r})")
    # header key/vals until blank line
    while True:
        line, pos = _readline(data, pos)
        if line.strip() == b"":
            break
    res, pos = _readline(data, pos)
    parts = res.split()
    if len(parts) != 4 or parts[0] != b"-Y" or parts[2] != b"+X":
        raise ValueError(f"unsupported resolution line {res!r} (only -Y H +X W)")
    H, W = int(parts[1]), int(parts[3])
    buf = np.frombuffer(data, dtype=np.uint8)
    idx = pos
    rgbe = np.empty((H, W, 4), dtype=np.uint8)
    for y in range(H):
        new_rle = (W >= 8 and W < 32768 and idx + 4 <= len(buf)
                   and buf[idx] == 2 and buf[idx + 1] == 2
                   and ((int(buf[idx + 2]) << 8) | int(buf[idx + 3])) == W)
        if new_rle:
            idx += 4
            for c in range(4):
                x = 0
                while x < W:
                    cnt = int(buf[idx]); idx += 1
                    if cnt > 128:                       # run of (cnt-128) copies
                        run = cnt - 128
                        rgbe[y, x:x + run, c] = buf[idx]; idx += 1
                        x += run
                    else:                               # literal copy of cnt bytes
                        rgbe[y, x:x + cnt, c] = buf[idx:idx + cnt]; idx += cnt
                        x += cnt
        else:                                           # flat scanline: W*4 bytes
            chunk = buf[idx:idx + W * 4].reshape(W, 4)
            rgbe[y] = chunk
            idx += W * 4
    # RGBE -> float linear (matches three.js RGBELoader: scale = 2^(e-128-8))
    e = rgbe[..., 3].astype(np.int32)
    scale = np.where(e > 0, np.exp2((e - 136).astype(np.float32)), np.float32(0.0))
    rgb = rgbe[..., :3].astype(np.float32) * scale[..., None]
    return H, W, rgb


def downsample(rgb, target_h):
    """Box-average down to height target_h (keeps 2:1 equirect aspect)."""
    H, W = rgb.shape[:2]
    if target_h >= H:
        return rgb
    ky = max(1, H // target_h)
    kx = max(1, W // (target_h * 2)) if W >= target_h * 2 else max(1, W // target_h)
    Hc, Wc = (H // ky) * ky, (W // kx) * kx
    r = rgb[:Hc, :Wc].reshape(Hc // ky, ky, Wc // kx, kx, 3)
    return r.mean(axis=(1, 3)).astype(np.float32)


def _float_to_rgbe(rgb):
    """float HxWx3 -> uint8 HxWx4 RGBE."""
    maxc = rgb.max(axis=2)
    nz = maxc > 1e-32
    mant, exp = np.frexp(np.where(nz, maxc, 1.0))      # maxc = mant*2^exp, mant in [0.5,1)
    scale = np.where(nz, mant * 256.0 / np.where(nz, maxc, 1.0), 0.0)
    out = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    out[..., 0] = np.clip(rgb[..., 0] * scale, 0, 255).astype(np.uint8)
    out[..., 1] = np.clip(rgb[..., 1] * scale, 0, 255).astype(np.uint8)
    out[..., 2] = np.clip(rgb[..., 2] * scale, 0, 255).astype(np.uint8)
    out[..., 3] = np.where(nz, np.clip(exp + 128, 0, 255), 0).astype(np.uint8)
    return out


def write_hdr(path, rgb):
    """Write float HxWx3 as a Radiance .hdr using new-style literal RLE chunks."""
    H, W = rgb.shape[:2]
    rgbe = _float_to_rgbe(rgb)
    body = bytearray()
    hdr_marker = struct.pack(">BBBB", 2, 2, (W >> 8) & 0xFF, W & 0xFF)
    for y in range(H):
        body += hdr_marker
        for c in range(4):
            chan = rgbe[y, :, c].tobytes()
            x = 0
            while x < W:
                n = min(128, W - x)
                body.append(n)                          # cnt<=128 -> literal
                body += chan[x:x + n]
                x += n
    header = b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y %d +X %d\n" % (H, W)
    Path(path).write_bytes(header + bytes(body))
    return len(header) + len(body)


def stage_hdr(src, dst, target_h=256):
    """read src -> downsample to target_h -> write dst. Returns dst byte size."""
    _, _, rgb = read_hdr(src)
    small = downsample(rgb, target_h)
    return write_hdr(dst, small)


if __name__ == "__main__":
    import sys
    if len(sys.argv) >= 3:
        n = stage_hdr(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 256)
        print(f"staged {sys.argv[2]} ({n/1024:.0f}KB)")
