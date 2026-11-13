#!/usr/bin/env python3
"""repack_glb.py — shrink a GLB by resizing its embedded textures.

Parses the GLB container (header + JSON chunk + BIN chunk), decodes every
image bufferView with Pillow, resizes to --max-size (keeping aspect), re-encodes
(JPEG for opaque, PNG when alpha), rebuilds the BIN with re-based bufferView
offsets, and writes a new GLB. Geometry bytes are copied verbatim.

Usage: python repack_glb.py in.glb out.glb --max-size 1024 [--quality 82]
"""
import argparse
import io
import json
import struct
import sys
from PIL import Image

MAGIC = 0x46546C67
JSON_T = 0x4E4F534A
BIN_T = 0x004E4942


def align4(n, pad=b"\x00"):
    return (4 - n % 4) % 4


def repack(src, dst, max_size=1024, quality=82):
    buf = open(src, "rb").read()
    magic, version, _length = struct.unpack_from("<III", buf, 0)
    assert magic == MAGIC, "not a GLB"
    off = 12
    js = None
    bin_ = b""
    while off < len(buf):
        clen, ctype = struct.unpack_from("<II", buf, off)
        off += 8
        data = buf[off:off + clen]
        off += clen
        if ctype == JSON_T:
            js = json.loads(data.decode("utf-8"))
        elif ctype == BIN_T:
            bin_ = data
    assert js is not None

    views = js.get("bufferViews", [])
    images = js.get("images", [])
    img_by_view = {}
    for i, im in enumerate(images):
        if "bufferView" in im:
            img_by_view[im["bufferView"]] = i

    new_bin = bytearray()
    saved = 0
    for vi, v in enumerate(views):
        start = v.get("byteOffset", 0)
        length = v["byteLength"]
        chunk = bin_[start:start + length]
        if vi in img_by_view:
            im_idx = img_by_view[vi]
            try:
                img = Image.open(io.BytesIO(chunk))
                w, h = img.size
                if max(w, h) > max_size:
                    s = max_size / max(w, h)
                    img = img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)
                has_alpha = img.mode in ("RGBA", "LA", "P") and (img.mode != "P" or "transparency" in img.info)
                out = io.BytesIO()
                if has_alpha:
                    img.save(out, "PNG", optimize=True)
                    images[im_idx]["mimeType"] = "image/png"
                else:
                    img.convert("RGB").save(out, "JPEG", quality=quality)
                    images[im_idx]["mimeType"] = "image/jpeg"
                nc = out.getvalue()
                if len(nc) < len(chunk):
                    saved += len(chunk) - len(nc)
                    chunk = nc
            except Exception as e:
                print(f"  [warn] image view {vi}: {e} — kept original", file=sys.stderr)
        v["byteOffset"] = len(new_bin)
        v["byteLength"] = len(chunk)
        new_bin.extend(chunk)
        new_bin.extend(b"\x00" * align4(len(new_bin)))

    js["buffers"][0]["byteLength"] = len(new_bin)
    jbytes = json.dumps(js, separators=(",", ":")).encode("utf-8")
    jbytes += b" " * align4(len(jbytes))
    total = 12 + 8 + len(jbytes) + 8 + len(new_bin)
    with open(dst, "wb") as f:
        f.write(struct.pack("<III", MAGIC, 2, total))
        f.write(struct.pack("<II", len(jbytes), JSON_T))
        f.write(jbytes)
        f.write(struct.pack("<II", len(new_bin), BIN_T))
        f.write(new_bin)
    import os
    print(f"{src}: {os.path.getsize(src)//1024}KB -> {os.path.getsize(dst)//1024}KB (images saved {saved//1024}KB)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--max-size", type=int, default=1024)
    ap.add_argument("--quality", type=int, default=82)
    a = ap.parse_args()
    repack(a.src, a.dst, a.max_size, a.quality)
