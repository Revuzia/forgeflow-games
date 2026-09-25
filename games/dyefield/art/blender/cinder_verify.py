"""DYEFIELD — CINDER REEF geometric verifier (plain python + numpy; no Blender).

    python art/blender/cinder_verify.py [art/gltf/map_cinder.glb] [--json art/renders/map_cinder_routes.json]

Reads the exported GLB (the runtime's view of the map) and data/layouts/cinder.json, and checks:
  1. contract: identity transforms on paint_/solid_/col_/grate_/conveyor_/spring_/oob_, TEXCOORD_1
     inside [0, 1], spring_ nodes carry df_launch, oob_ meshes are closed boxes, budgets;
  2. fairness: rot180 symmetry of every collider (paint/solid/col/spring) - per-prefix paint area
     and triangle count on each half, plus a vertex-cloud match (each vertex has a partner at
     (-x, y, -z));
  3. reachability by WALKING (no wall-slick, no jump): a 0.25 m standability grid over every
     collider triangle with a walkable normal (<= 46 deg), headroom >= 1.15 m, feet above the oob
     volumes; neighbours connect when the height step is <= 0.35 m beyond what the local slopes
     explain (MOVE.stepHeight). Tide-springs add one-way edges: their df_launch arc is simulated at
     gravity 15 m/s^2 from 9 start points on the pad and must land on a standable cell of the
     target area with >= 1 m of standable margin, without hitting any collider on the way.
  4. routes: for every area (beach, isle, crown, mid apron, wreck deck, sandbars, bridges), one route
     from each spawn, and each authored crossing on its own (the flood fill is restricted to
     start-area + crossing + end-area), and "no one-way traps" (every reachable cell reaches both
     spawns back).
Movement numbers mirror runtime/src/core/config.ts MOVE (read-only here).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
from collections import deque

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(os.path.dirname(HERE))
MOVE = {"stepHeight": 0.35, "maxSlopeDeg": 46.0, "height": 1.15, "radius": 0.32, "gravity": 15.0}
COLLIDER_PREFIXES = ("paint_", "solid_", "col_", "grate_", "conveyor_", "spring_")
APPLY_PREFIXES = ("paint_", "solid_", "col_", "grate_", "conveyor_", "spring_", "oob_")
CTYPE = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


# ── GLB ──────────────────────────────────────────────────────────────────────────────────────────
class GLB:
    def __init__(self, path):
        data = open(path, "rb").read()
        self.size = len(data)
        clen, _ = struct.unpack_from("<II", data, 12)
        self.j = json.loads(data[20:20 + clen].decode("utf-8"))
        off = 20 + clen
        blen, _ = struct.unpack_from("<II", data, off)
        self.bin = data[off + 8: off + 8 + blen]

    def acc(self, i):
        a = self.j["accessors"][i]
        bv = self.j["bufferViews"][a["bufferView"]]
        dt = CTYPE[a["componentType"]]
        n = NCOMP[a["type"]]
        start = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        stride = bv.get("byteStride", 0)
        cnt = a["count"]
        if stride and stride != n * np.dtype(dt).itemsize:
            raw = np.frombuffer(self.bin, np.uint8, count=stride * cnt, offset=start).reshape(cnt, stride)
            out = raw[:, : n * np.dtype(dt).itemsize].copy().view(dt)
        else:
            out = np.frombuffer(self.bin, dt, count=cnt * n, offset=start).copy()
        return out.reshape(cnt, n) if n > 1 else out

    def mesh_nodes(self):
        """{name: [(positions (N,3), tris (M,3), uv1 or None, material name), ...]} for every mesh node."""
        out = {}
        mats = [m.get("name", "") for m in self.j.get("materials", [])]
        for n in self.j["nodes"]:
            if "mesh" not in n:
                continue
            prims = []
            for p in self.j["meshes"][n["mesh"]]["primitives"]:
                pos = self.acc(p["attributes"]["POSITION"]).astype(np.float64)
                idx = self.acc(p["indices"]).astype(np.int64).reshape(-1, 3)
                uv1 = self.acc(p["attributes"]["TEXCOORD_1"]).astype(np.float64) if "TEXCOORD_1" in p["attributes"] else None
                prims.append((pos, idx, uv1, mats[p["material"]] if "material" in p else ""))
            out[n["name"]] = prims
        return out


def tri_area(P, T):
    a, b, c = P[T[:, 0]], P[T[:, 1]], P[T[:, 2]]
    return 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)


def uv_islands(uv, T):
    """Connected components of triangles sharing a UV edge (exact coordinates)."""
    key = {}
    parent = list(range(len(T)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    q = np.round(uv * 1e6).astype(np.int64)
    for t, tri in enumerate(T):
        for i in range(3):
            a, b = tri[i], tri[(i + 1) % 3]
            ka, kb = (q[a, 0], q[a, 1]), (q[b, 0], q[b, 1])
            k = (ka, kb) if ka < kb else (kb, ka)
            if k in key:
                ra, rb = find(t), find(key[k])
                if ra != rb:
                    parent[ra] = rb
            else:
                key[k] = t
    return len({find(i) for i in range(len(T))})


# ── contract ─────────────────────────────────────────────────────────────────────────────────────
def check_contract(g: GLB, nodes):
    errs, info = [], {}
    for n in g.j["nodes"]:
        nm = n.get("name", "")
        if "mesh" in n and nm.startswith(APPLY_PREFIXES):
            for k, ident in (("translation", [0, 0, 0]), ("rotation", [0, 0, 0, 1]), ("scale", [1, 1, 1])):
                if k in n and any(abs(a - b) > 1e-5 for a, b in zip(n[k], ident)):
                    errs.append(f"{nm}: non-identity {k} {n[k]}")
            if "matrix" in n:
                errs.append(f"{nm}: has a matrix")
        if nm.startswith("spring_") and "df_launch" not in (n.get("extras") or {}):
            errs.append(f"{nm}: spring_ without df_launch")
    uvmin, uvmax = [1e9, 1e9], [-1e9, -1e9]
    for nm, prims in nodes.items():
        if not nm.startswith("paint_"):
            continue
        for (P, T, uv, m) in prims:
            if uv is None:
                errs.append(f"{nm}: no TEXCOORD_1")
                continue
            uvmin = [min(uvmin[0], uv[:, 0].min()), min(uvmin[1], uv[:, 1].min())]
            uvmax = [max(uvmax[0], uv[:, 0].max()), max(uvmax[1], uv[:, 1].max())]
    if min(uvmin) < 0 or max(uvmax) > 1:
        errs.append(f"TEXCOORD_1 outside [0,1]: {uvmin} {uvmax}")
    info["texcoord1_range"] = [[round(v, 5) for v in uvmin], [round(v, 5) for v in uvmax]]
    for nm, prims in nodes.items():
        if nm.startswith("oob_"):
            P = np.concatenate([p[0] for p in prims])
            T = np.concatenate([p[1] + sum(len(q[0]) for q in prims[:k]) for k, p in enumerate(prims)])
            # closed = every undirected edge (on welded positions) used exactly twice
            key = {tuple(np.round(v, 5)): i for i, v in enumerate(P)}
            w = np.array([key[tuple(np.round(v, 5))] for v in P])
            cnt = {}
            for tri in w[T]:
                for i in range(3):
                    e = tuple(sorted((tri[i], tri[(i + 1) % 3])))
                    cnt[e] = cnt.get(e, 0) + 1
            if any(c != 2 for c in cnt.values()):
                errs.append(f"{nm}: oob_ mesh not closed")
    tris_total = sum(len(p[1]) for prims in nodes.values() for p in prims)
    tris_paint = sum(len(p[1]) for nm, prims in nodes.items() if nm.startswith("paint_") for p in prims)
    info.update({"glb_mb": round(g.size / 1e6, 3), "tris_total": tris_total, "tris_paint": tris_paint})
    if g.size > 8e6:
        errs.append(f"GLB {g.size / 1e6:.2f} MB > 8 MB")
    if tris_total > 250000:
        errs.append(f"{tris_total} tris > 250k")
    if tris_paint > 120000:
        errs.append(f"{tris_paint} paint tris > 120k")
    names = [n.get("name", "") for n in g.j["nodes"]]
    for s in ("spawn_A", "spawn_B", "mapinfo"):
        if s not in names:
            errs.append(f"missing node {s}")
    info["spawns"] = {n["name"]: n.get("translation") for n in g.j["nodes"] if n.get("name") in ("spawn_A", "spawn_B")}
    mi = next((n.get("extras", {}) for n in g.j["nodes"] if n.get("name") == "mapinfo"), {})
    info["mapinfo"] = mi
    return errs, info


def breakdown(nodes):
    rows = []
    for nm, prims in sorted(nodes.items()):
        tris = sum(len(p[1]) for p in prims)
        verts = sum(len(p[0]) for p in prims)
        area = float(sum(tri_area(p[0], p[1]).sum() for p in prims))
        isl = sum(uv_islands(p[2], p[1]) for p in prims if p[2] is not None) if nm.startswith("paint_") else None
        rows.append({"node": nm, "tris": tris, "verts": verts, "area": round(area, 1), "islands": isl,
                     "mats": sorted({p[3] for p in prims})})
    return rows


def symmetry(nodes):
    """Per-prefix area/tri balance between the z<0 and z>0 halves + a vertex-partner match."""
    out = {}
    for pre in ("paint_", "solid_", "col_", "spring_"):
        A = B = 0.0
        ta = tb = 0
        pts = []
        for nm, prims in nodes.items():
            if not nm.startswith(pre):
                continue
            for (P, T, uv, m) in prims:
                ar = tri_area(P, T)
                cz = P[T].mean(axis=1)[:, 2]
                A += float(ar[cz < 0].sum())
                B += float(ar[cz > 0].sum())
                ta += int((cz < 0).sum())
                tb += int((cz > 0).sum())
                pts.append(P)
        if not pts:
            continue
        V = np.unique(np.round(np.concatenate(pts), 3), axis=0)
        S = {tuple(v) for v in np.round(V, 2)}
        miss = sum(1 for v in np.round(V, 2) if (round(-v[0], 2) + 0.0, v[1], round(-v[2], 2) + 0.0) not in S)
        out[pre] = {"area_south": round(A, 2), "area_north": round(B, 2), "area_diff_pct": round(100 * abs(A - B) / max(A + B, 1e-9), 3),
                    "tris_south": ta, "tris_north": tb, "verts": len(V), "verts_without_partner": miss}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("glb", nargs="?", default=os.path.join(GAME, "art/gltf/map_cinder.glb"))
    ap.add_argument("--json", default=None)
    ap.add_argument("--breakdown", action="store_true")
    ap.add_argument("--no-routes", action="store_true")
    a = ap.parse_args()
    g = GLB(a.glb)
    nodes = g.mesh_nodes()
    errs, info = check_contract(g, nodes)
    rep = {"glb": a.glb, "contract_errors": errs, "info": info}
    if a.breakdown:
        rows = breakdown(nodes)
        rep["breakdown"] = rows
        for r in rows:
            print(f"  {r['node']:28s} tris {r['tris']:6d} verts {r['verts']:6d} area {r['area']:8.1f}"
                  + (f" islands {r['islands']}" if r["islands"] is not None else "") + f" {r['mats']}")
    rep["symmetry"] = symmetry(nodes)
    print("contract errors:", errs or "none")
    print("info:", json.dumps(info)[:600])
    print("symmetry:", json.dumps(rep["symmetry"]))
    if not a.no_routes:
        import cinder_routes
        rep["routes"] = cinder_routes.run(g, nodes, verbose=True)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(rep, f, indent=1)
        print("wrote", a.json)
    return 1 if errs else 0


if __name__ == "__main__":
    sys.path.insert(0, HERE)
    sys.exit(main())
