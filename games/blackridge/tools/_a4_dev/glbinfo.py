# dev helper: print nodes / meshes / primitives (attributes, material, counts) of a GLB
# and COLOR_0 statistics. usage: python glbinfo.py file.glb [--colors]
import sys, json, struct
import numpy as np

def load(path):
    b = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<4sII", b, 0)
    off = 12
    js = None; bin_ = None
    while off < length:
        clen, ctype = struct.unpack_from("<II", b, off); off += 8
        chunk = b[off:off + clen]; off += clen
        if ctype == 0x4E4F534A: js = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942: bin_ = chunk
    return js, bin_

def accessor(js, bin_, idx):
    a = js["accessors"][idx]
    bv = js["bufferViews"][a["bufferView"]]
    comp = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a["componentType"]]
    n = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
    off = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride")
    cnt = a["count"]
    itemsize = np.dtype(comp).itemsize * n
    if stride and stride != itemsize:
        arr = np.frombuffer(bin_, dtype=np.uint8, count=cnt * stride, offset=bv.get("byteOffset", 0) + a.get("byteOffset", 0))
        arr = arr.reshape(cnt, stride)[:, :itemsize].copy().view(comp)
    else:
        arr = np.frombuffer(bin_, dtype=comp, count=cnt * n, offset=off)
    return arr.reshape(cnt, n) if n > 1 else arr

if __name__ == "__main__":
    js, bin_ = load(sys.argv[1])
    print("extensionsUsed", js.get("extensionsUsed"))
    for i, n in enumerate(js["nodes"]):
        print("NODE", i, n.get("name"), "mesh", n.get("mesh"), "T", n.get("translation"), "R", n.get("rotation"), "S", n.get("scale"), "children", n.get("children"))
    for i, m in enumerate(js["meshes"]):
        for pr in m["primitives"]:
            at = pr["attributes"]
            mat = js["materials"][pr["material"]] if "material" in pr else None
            cnt = js["accessors"][at["POSITION"]]["count"]
            tri = js["accessors"][pr["indices"]]["count"] // 3 if "indices" in pr else cnt // 3
            print("MESH", i, m.get("name"), "attrs", sorted(at.keys()), "verts", cnt, "tris", tri, "mat", mat and mat.get("name"))
            if "--colors" in sys.argv and "COLOR_0" in at:
                c = accessor(js, bin_, at["COLOR_0"]).astype(np.float64)
                if c.dtype == np.uint8: c = c / 255.0
                print("   COLOR_0 mean", c.mean(0), "min", c.min(0), "max", c.max(0))
    for i, im in enumerate(js.get("images", [])):
        bv = js["bufferViews"][im["bufferView"]] if "bufferView" in im else None
        print("IMAGE", i, im.get("name"), im.get("mimeType"), bv and bv["byteLength"])
