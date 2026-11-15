#!/usr/bin/env python3
"""art_b_glb.py - tiny GLB reader / writer for the ART-B intake (dev-only; _tools/ never ships).

READ  : read_glb(path) -> Glb(json, bin, prims). Every mesh primitive is flattened through its node chain
        (TRS or matrix) into world space: Prim(pos float32 Nx3, nrm float32 Nx3, uv float32 Nx2 or None,
        idx int64 Mx3, mat index, mat definition dict). Handles accessors with byteStride/normalized/sparse-free data.
        Embedded images are returned as raw bytes (Glb.images[i]).
WRITE : write_glb(path, prims, materials, extras=None) writes ONE node / ONE mesh, one primitive per material,
        float32 POSITION/NORMAL/TEXCOORD_0 + uint16/uint32 indices, no images, no tangents. The result is an
        UNCOMPRESSED clean GLB that `art_b_pack.cjs` (gltf-transform: meshopt) then compresses.
INFO  : glb_stats(path) -> triangles, vertices, bbox (from accessor min/max with node transforms), extensions used
        (works on meshopt/quantized files too: it never decodes vertex data).
"""
from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT2": 4, "MAT3": 9, "MAT4": 16}


@dataclass
class Prim:
    pos: np.ndarray
    nrm: np.ndarray
    uv: np.ndarray | None
    idx: np.ndarray
    mat: int
    node: str = ""


@dataclass
class Glb:
    json: dict
    bin: bytes
    prims: list[Prim] = field(default_factory=list)
    images: list[bytes | str | None] = field(default_factory=list)


def _split(b: bytes) -> tuple[dict, bytes]:
    if b[:4] != b"glTF":
        raise ValueError("not a GLB")
    off = 12
    js, bn = None, b""
    while off < len(b):
        ln, ty = struct.unpack("<II", b[off:off + 8])
        body = b[off + 8: off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(body.decode("utf-8"))
        elif ty == 0x004E4942:
            bn = body
        off += 8 + ln
    return js, bn


def read_accessor(js: dict, bn: bytes, ai: int) -> np.ndarray:
    a = js["accessors"][ai]
    dt = np.dtype(CT[a["componentType"]])
    n = NC[a["type"]]
    count = a["count"]
    if "bufferView" not in a:
        out = np.zeros((count, n), dt)
    else:
        bv = js["bufferViews"][a["bufferView"]]
        if "extensions" in bv and "EXT_meshopt_compression" in bv["extensions"]:
            raise ValueError("meshopt-compressed accessor: decode with the browser, not here")
        off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride") or dt.itemsize * n
        out = np.ndarray(shape=(count, n), dtype=dt, buffer=bn, offset=off, strides=(stride, dt.itemsize)).copy()
    if a.get("normalized"):
        info = np.iinfo(dt)
        out = np.maximum(out.astype(np.float32) / float(info.max), -1.0)
    return out


def _node_matrix(n: dict) -> np.ndarray:
    if "matrix" in n:
        return np.array(n["matrix"], np.float64).reshape(4, 4).T
    t = np.array(n.get("translation", [0, 0, 0]), np.float64)
    q = np.array(n.get("rotation", [0, 0, 0, 1]), np.float64)
    s = np.array(n.get("scale", [1, 1, 1]), np.float64)
    x, y, z, w = q
    R = np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])
    M = np.eye(4)
    M[:3, :3] = R * s[None, :]
    M[:3, 3] = t
    return M


def read_glb(path) -> Glb:
    raw = Path(path).read_bytes()
    js, bn = _split(raw)
    g = Glb(js, bn)
    for im in js.get("images", []):
        if "bufferView" in im:
            bv = js["bufferViews"][im["bufferView"]]
            o = bv.get("byteOffset", 0)
            g.images.append(bn[o:o + bv["byteLength"]])
        else:
            g.images.append(im.get("uri"))
    scene = js["scenes"][js.get("scene", 0)]
    roots = scene["nodes"]

    def walk(ni: int, parent: np.ndarray):
        n = js["nodes"][ni]
        M = parent @ _node_matrix(n)
        if "mesh" in n:
            for pr in js["meshes"][n["mesh"]]["primitives"]:
                at = pr["attributes"]
                pos = read_accessor(js, bn, at["POSITION"]).astype(np.float64)
                nrm = read_accessor(js, bn, at["NORMAL"]).astype(np.float64) if "NORMAL" in at else np.zeros_like(pos)
                uv = read_accessor(js, bn, at["TEXCOORD_0"]).astype(np.float32) if "TEXCOORD_0" in at else None
                if "indices" in pr:
                    idx = read_accessor(js, bn, pr["indices"]).astype(np.int64).reshape(-1)
                else:
                    idx = np.arange(len(pos), dtype=np.int64)
                if pr.get("mode", 4) != 4:
                    raise ValueError("only triangle lists")
                idx = idx.reshape(-1, 3)
                P = pos @ M[:3, :3].T + M[:3, 3]
                Nm = np.linalg.inv(M[:3, :3]).T
                N = nrm @ Nm.T
                ln = np.linalg.norm(N, axis=1, keepdims=True)
                N = N / np.maximum(ln, 1e-12)
                det = np.linalg.det(M[:3, :3])
                if det < 0:                       # mirrored node: keep the winding outward
                    idx = idx[:, ::-1].copy()
                g.prims.append(Prim(P.astype(np.float32), N.astype(np.float32), uv, idx, pr.get("material", 0), n.get("name", "")))
        for c in n.get("children", []):
            walk(c, M)

    for r in roots:
        walk(r, np.eye(4))
    return g


def pad4(b: bytes, fill=b"\x00") -> bytes:
    return b + fill * ((4 - len(b) % 4) % 4)


def write_glb(path, prims: list[Prim], materials: list[dict], name: str = "model", extras: dict | None = None) -> None:
    """One node, one mesh, one primitive per material index (prims with the same mat are concatenated)."""
    by_mat: dict[int, list[Prim]] = {}
    for p in prims:
        by_mat.setdefault(p.mat, []).append(p)
    bufs: list[bytes] = []
    views, accs, mprims = [], [], []
    mat_out, mat_map = [], {}

    def add_view(data: bytes, target: int | None):
        off = sum(len(pad4(b)) for b in bufs)
        bufs.append(data)
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        return len(views) - 1

    for mi in sorted(by_mat):
        ps = by_mat[mi]
        pos = np.concatenate([p.pos for p in ps]).astype(np.float32)
        nrm = np.concatenate([p.nrm for p in ps]).astype(np.float32)
        has_uv = all(p.uv is not None for p in ps)
        uv = np.concatenate([p.uv for p in ps]).astype(np.float32) if has_uv else None
        offs, idxs = 0, []
        for p in ps:
            idxs.append(p.idx + offs)
            offs += len(p.pos)
        idx = np.concatenate(idxs).reshape(-1)
        itype = 5123 if len(pos) < 65535 else 5125
        attrs = {}
        for key, arr, ty in (("POSITION", pos, "VEC3"), ("NORMAL", nrm, "VEC3"), ("TEXCOORD_0", uv, "VEC2")):
            if arr is None:
                continue
            bv = add_view(arr.tobytes(), 34962)
            acc = {"bufferView": bv, "componentType": 5126, "count": int(len(arr)), "type": ty}
            if key == "POSITION":
                acc["min"] = [float(x) for x in arr.min(0)]
                acc["max"] = [float(x) for x in arr.max(0)]
            accs.append(acc)
            attrs[key] = len(accs) - 1
        bv = add_view(idx.astype(np.uint16 if itype == 5123 else np.uint32).tobytes(), 34963)
        accs.append({"bufferView": bv, "componentType": itype, "count": int(len(idx)), "type": "SCALAR"})
        if mi not in mat_map:
            mat_out.append(materials[mi] if mi < len(materials) else {"name": "default"})
            mat_map[mi] = len(mat_out) - 1
        mprims.append({"attributes": attrs, "indices": len(accs) - 1, "material": mat_map[mi], "mode": 4})
    blob = b"".join(pad4(b) for b in bufs)
    js = {
        "asset": {"version": "2.0", "generator": "art_b_glb.py"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [{"name": name, "primitives": mprims}],
        "materials": mat_out,
        "accessors": accs, "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
    }
    if extras:
        js["asset"]["extras"] = extras
    jb = pad4(json.dumps(js, separators=(",", ":")).encode("utf-8"), b" ")
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(jb) + 8 + len(blob))
    out += struct.pack("<II", len(jb), 0x4E4F534A) + jb + struct.pack("<II", len(blob), 0x004E4942) + blob
    Path(path).write_bytes(out)


def glb_stats(path) -> dict:
    """Triangles / vertices / bbox / extensions straight from the JSON (never decodes vertex data)."""
    js, _ = _split(Path(path).read_bytes())
    tris = verts = 0
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)

    def walk(ni: int, parent: np.ndarray):
        nonlocal tris, verts, lo, hi
        n = js["nodes"][ni]
        M = parent @ _node_matrix(n)
        if "mesh" in n:
            for pr in js["meshes"][n["mesh"]]["primitives"]:
                at = pr["attributes"]
                pa = js["accessors"][at["POSITION"]]
                verts += pa["count"]
                tris += (js["accessors"][pr["indices"]]["count"] if "indices" in pr else pa["count"]) // 3
                if "min" in pa and "max" in pa:
                    mn, mx = np.array(pa["min"], np.float64), np.array(pa["max"], np.float64)
                    if pa.get("normalized"):
                        dt = np.dtype(CT[pa["componentType"]])
                        d = float(np.iinfo(dt).max)
                        mn, mx = np.maximum(mn / d, -1), np.maximum(mx / d, -1)
                    corners = np.array([[x, y, z, 1] for x in (mn[0], mx[0]) for y in (mn[1], mx[1]) for z in (mn[2], mx[2])])
                    w = corners @ M.T
                    lo = np.minimum(lo, w[:, :3].min(0))
                    hi = np.maximum(hi, w[:, :3].max(0))
        for c in n.get("children", []):
            walk(c, M)

    for r in js["scenes"][js.get("scene", 0)]["nodes"]:
        walk(r, np.eye(4))
    return {"tris": int(tris), "verts": int(verts), "bbox_min": lo.tolist(), "bbox_max": hi.tolist(),
            "size": (hi - lo).tolist(), "ext_used": js.get("extensionsUsed", []), "ext_required": js.get("extensionsRequired", []),
            "images": len(js.get("images", [])), "materials": len(js.get("materials", [])), "meshes": len(js.get("meshes", []))}
