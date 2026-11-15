"""verify W1-B r1 (independent): ruling 32 reserved-band shares (PIL 8-bit HSV and float HSV, texels max>2, S>0.40)
on the base albedo of each GLB given, written from scratch (does not import zone_grade.py).
usage: python3 _harness/verify_w1b_r1_albedo.py a.glb b.glb ...   -> one JSON line per file"""
import io, json, struct, sys
import numpy as np
from PIL import Image

BANDS = {"ally": (200, 225), "harm": (28, 50), "rose": (340, 350), "heal": (125, 150)}


def images(path):
    b = open(path, "rb").read()
    off, js, binc = 12, None, None
    while off < len(b):
        ln, ty = struct.unpack_from("<II", b, off)
        c = b[off + 8: off + 8 + ln]
        if ty == 0x4E4F534A:
            js = json.loads(c)
        else:
            binc = c
        off += 8 + ln
    out = {}
    for im in js.get("images", []):
        bv = js["bufferViews"][im["bufferView"]]
        d = binc[bv.get("byteOffset", 0): bv.get("byteOffset", 0) + bv["byteLength"]]
        out[im.get("name", "?")] = np.asarray(Image.open(io.BytesIO(d)).convert("RGB"))
    mats = js.get("materials", [])
    base = None
    if mats and "pbrMetallicRoughness" in mats[0] and "baseColorTexture" in mats[0]["pbrMetallicRoughness"]:
        tex = js["textures"][mats[0]["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
        src = tex.get("source", tex.get("extensions", {}).get("EXT_texture_webp", {}).get("source"))
        base = js["images"][src].get("name", "?")
    return out, base


def shares(rgb):
    used = rgb.max(-1) > 2
    tot = max(int(used.sum()), 1)
    hsv = np.asarray(Image.fromarray(rgb).convert("HSV")).astype(np.float32)
    hp, sp = hsv[..., 0] / 255 * 360, hsv[..., 1] / 255
    f = rgb.astype(np.float64) / 255
    mx, mn = f.max(-1), f.min(-1)
    d = mx - mn
    dd = np.maximum(d, 1e-12)
    r, g, b = f[..., 0], f[..., 1], f[..., 2]
    hf = np.where(d == 0, 0, np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4))) * 60 % 360
    sf = np.where(mx > 0, d / np.maximum(mx, 1e-12), 0)
    res = {}
    for k, (a, z) in BANDS.items():
        p = 100 * float(((hp >= a) & (hp <= z) & (sp > 0.4) & used).sum()) / tot
        q = 100 * float(((hf >= a) & (hf <= z) & (sf > 0.4) & used).sum()) / tot
        res[k] = {"pil": round(p, 2), "float": round(q, 2)}
    return res


for p in sys.argv[1:]:
    ims, base = images(p)
    name = base if base in ims else next((n for n in ims if "base" in n.lower() or "albedo" in n.lower() or "color" in n.lower()), list(ims)[0])
    print(json.dumps({"glb": p, "image": name, "kib": round(len(open(p, "rb").read()) / 1024, 1), "bands": shares(ims[name])}))
