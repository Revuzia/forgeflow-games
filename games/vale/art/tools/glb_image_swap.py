#!/usr/bin/env python3
"""VALE art (lane GF): swap images inside a GLB with every other byte of the binary chunk kept: mesh, skin and clips stay
byte-identical, so GLB-level edits made after a build (clip_floor_fix, glb_paint_grade and others) survive. Importable:

    from glb_image_swap import read_glb, image_bytes, swap_images, write_glb, verify_same_geometry

Only the image buffer views change (their offsets shift); the JSON chunk changes only in bufferViews[*].byteOffset /
byteLength (a tool may stamp asset.extras). verify_same_geometry(a, b) proves it: the hash of every non-image buffer view and the JSON with the
buffer-view table and the images removed are equal."""
from __future__ import annotations

import copy
import hashlib
import json
import struct


def read_glb(path: str):
    with open(path, "rb") as f:
        d = f.read()
    magic, ver, total = struct.unpack_from("<4sII", d, 0)
    if magic != b"glTF" or ver != 2:
        raise SystemExit(f"{path}: not a glTF 2 binary")
    off, js, bin_ = 12, None, b""
    while off < total:
        ln, ty = struct.unpack_from("<I4s", d, off)
        c = d[off + 8: off + 8 + ln]
        if ty == b"JSON":
            js = json.loads(c.decode("utf-8"))
        elif ty == b"BIN\0":
            bin_ = c
        off += 8 + ln
    return js, bin_


def image_index(js: dict, suffix: str) -> int | None:
    for i, im in enumerate(js["images"]):
        if str(im.get("name", "")).endswith(suffix):
            return i
    return None


def image_bytes(js: dict, bin_: bytes, i: int) -> bytes:
    v = js["bufferViews"][js["images"][i]["bufferView"]]
    o = v.get("byteOffset", 0)
    return bin_[o: o + v["byteLength"]]


def swap_images(js: dict, bin_: bytes, new: dict[int, bytes]):
    """(js', bin') with images[i] replaced by new[i]; every view is copied in file order at a 4-byte aligned offset"""
    js = copy.deepcopy(js)
    by_view = {js["images"][i]["bufferView"]: b for i, b in new.items()}
    order = sorted(range(len(js["bufferViews"])), key=lambda k: js["bufferViews"][k].get("byteOffset", 0))
    out = bytearray()
    for k in order:
        v = js["bufferViews"][k]
        o = v.get("byteOffset", 0)
        data = by_view.get(k, bin_[o: o + v["byteLength"]])
        out += b"\0" * ((4 - len(out) % 4) % 4)
        v["byteOffset"] = len(out)
        v["byteLength"] = len(data)
        out += data
    out += b"\0" * ((4 - len(out) % 4) % 4)
    js["buffers"][0]["byteLength"] = len(out)
    return js, bytes(out)


def write_glb(path: str, js: dict, bin_: bytes) -> int:
    j = json.dumps(js, separators=(",", ":")).encode("utf-8")
    j += b" " * ((4 - len(j) % 4) % 4)
    total = 12 + 8 + len(j) + 8 + len(bin_)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, total))
        f.write(struct.pack("<I4s", len(j), b"JSON") + j)
        f.write(struct.pack("<I4s", len(bin_), b"BIN\0") + bin_)
    return total


def _fingerprint(path: str):
    js, b = read_glb(path)
    img_views = {im["bufferView"] for im in js["images"]}
    h = []
    for k, v in enumerate(js["bufferViews"]):
        if k in img_views:
            continue
        o = v.get("byteOffset", 0)
        h.append((k, hashlib.sha256(b[o: o + v["byteLength"]]).hexdigest()))
    rest = {k: v for k, v in js.items() if k not in ("bufferViews", "buffers", "asset")}
    return h, hashlib.sha256(json.dumps(rest, sort_keys=True).encode()).hexdigest()


def verify_same_geometry(a: str, b: str) -> bool:
    return _fingerprint(a) == _fingerprint(b)
