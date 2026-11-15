#!/usr/bin/env python3
"""art_a_glbinfo.py - dump the structure of a (clip-only or skinned) GLB: generator, node tree
top, hips chain TRS, animations (name, duration, channel counts per path, hips pos range).
Usage: python art_a_glbinfo.py file.glb [more.glb ...] [--tree]"""
import json, struct, sys
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load(path):
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    js = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl = struct.unpack_from("<I", b, off)[0]
    binb = b[off + 8: off + 8 + bl]
    return js, binb


def acc(js, binb, i):
    a = js["accessors"][i]
    bv = js["bufferViews"][a["bufferView"]]
    dt = CT[a["componentType"]]
    n = a["count"] * NC[a["type"]]
    o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.frombuffer(binb, dtype=dt, count=n, offset=o).astype(np.float64)
    if a.get("normalized"):
        arr = arr / {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}[a["componentType"]]
        if a["componentType"] in (5120, 5122):
            arr = np.maximum(arr, -1.0)
    return arr.reshape(a["count"], NC[a["type"]]) if NC[a["type"]] > 1 else arr


def parents(js):
    par = {}
    for i, n in enumerate(js["nodes"]):
        for c in n.get("children", []):
            par[c] = i
    return par


def info(path, tree=False):
    js, binb = load(path)
    nodes = js["nodes"]
    par = parents(js)
    print("==", path)
    print(" generator:", js["asset"].get("generator"), "| ext:", js.get("extensionsUsed"), "| nodes:", len(nodes),
          "| meshes:", len(js.get("meshes", [])), "| skins:", len(js.get("skins", [])))
    roots = js["scenes"][js.get("scene", 0)]["nodes"]
    print(" scene roots:", [nodes[r].get("name") for r in roots])
    hips = None
    for i, n in enumerate(nodes):
        nm = n.get("name", "")
        if nm.lower().endswith("hips") and hips is None:
            hips = i
    if hips is not None:
        chain = []
        j = hips
        while j is not None:
            n = nodes[j]
            chain.append((n.get("name"), n.get("translation"), n.get("rotation"), n.get("scale")))
            j = par.get(j)
        print(" hips chain (hips->root):")
        for c in chain:
            print("   ", c)
    for ai, a in enumerate(js.get("animations", [])):
        cnt = {}
        dur = 0
        for ch in a["channels"]:
            p = ch["target"]["path"]
            cnt[p] = cnt.get(p, 0) + 1
            s = a["samplers"][ch["sampler"]]
            t = acc(js, binb, s["input"])
            dur = max(dur, float(t[-1]))
        print(f" anim[{ai}] name={a.get('name')!r} dur={dur:.3f}s channels={len(a['channels'])} {cnt}")
        for ch in a["channels"]:
            nm = nodes[ch["target"]["node"]].get("name")
            if nm and nm.lower().endswith("hips") and ch["target"]["path"] == "translation":
                s = a["samplers"][ch["sampler"]]
                v = acc(js, binb, s["output"])
                t = acc(js, binb, s["input"])
                print(f"   hips.position frames={len(t)} first={np.round(v[0],4).tolist()} last={np.round(v[-1],4).tolist()} "
                      f"Ymin={v[:,1].min():.4f} Ymax={v[:,1].max():.4f} Ymean={v[:,1].mean():.4f}")
    if tree:
        def rec(i, d):
            n = nodes[i]
            print("  " * d + f"- {n.get('name')} t={n.get('translation')} r={n.get('rotation')} s={n.get('scale')}")
            for c in n.get("children", []):
                rec(c, d + 1)
        for r in roots:
            rec(r, 0)
    bones = set()
    for s in js.get("skins", []):
        bones.update(s["joints"])
    print(" total bytes:", len(open(path, "rb").read()))


if __name__ == "__main__":
    tree = "--tree" in sys.argv
    for p in sys.argv[1:]:
        if p.startswith("--"):
            continue
        info(p, tree)
