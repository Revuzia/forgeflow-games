#!/usr/bin/env python3
"""Zero the metalness of a shipped fighter GLB in place (closing review OBS-metal), without Blender.

    python3 art/tools/glb_zero_metal.py art/out/fighters/kemdo/*.glb [--check]

The bible fighters are metalness 0 everywhere (STYLE_BIBLE: no metal), but older bakes carried residual metal in the
ORM's B channel (Kemdo 30 % of texels > 0.05, max 0.38) under metallicFactor 1. glTF metalness = metallicFactor x
texture B, so setting every material's pbrMetallicRoughness.metallicFactor to 0 makes the effective metalness 0
whatever the texture holds. New builds also write B = 0 at bake (common/bake.py zero_metal, on for bible fighters).
Only the JSON chunk changes (re-padded to 4 bytes); the binary chunk is copied byte for byte.
--check: report only (exit 1 if any material still has an effective metallicFactor > 0).
"""
import json
import struct
import sys


def read(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, total = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or ver != 2:
        raise SystemExit(f"{path}: not a glTF 2 binary")
    off, chunks = 12, []
    while off < total:
        ln, typ = struct.unpack_from("<I4s", data, off)
        chunks.append([typ, data[off + 8:off + 8 + ln]])
        off += 8 + ln
    return chunks


def write(path, chunks):
    out = b""
    for typ, body in chunks:
        pad = (b" " if typ == b"JSON" else b"\0") * ((4 - len(body) % 4) % 4)
        body = body + pad
        out += struct.pack("<I4s", len(body), typ) + body
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + len(out)) + out)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    bad = 0
    for path in args:
        chunks = read(path)
        js = json.loads(chunks[0][1].decode("utf-8"))
        changed = []
        for m in js.get("materials", []):
            pbr = m.setdefault("pbrMetallicRoughness", {})
            mf = pbr.get("metallicFactor", 1.0)
            if mf > 0:
                changed.append(f"{m.get('name', '?')} {mf:g}")
                if not check:
                    pbr["metallicFactor"] = 0.0
        if check:
            bad += bool(changed)
            print(f"{path}: {'metal ' + ', '.join(changed) if changed else 'metal 0 on every material'}")
            continue
        if changed:
            chunks[0][1] = json.dumps(js, separators=(",", ":")).encode("utf-8")
            write(path, chunks)
        print(f"{path}: metallicFactor -> 0 on {', '.join(changed) if changed else 'nothing (already 0)'}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
