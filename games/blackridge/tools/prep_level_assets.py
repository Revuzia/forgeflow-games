#!/usr/bin/env python3
# tools/prep_level_assets.py [A3-level] — one-shot asset generator for the
# Meridian Ward level (BUILD_PLAN Part 4 asset decisions).
#
# Produces (all under games/blackridge/assets/):
#   textures/*.webp   — Poly Haven + generated-materials PBR sets, downscaled
#                       to <=1024, normals GENERATED from displacement via
#                       Sobel (the sets ship no normal maps — BUILD_PLAN Part 4)
#   props/*.glb       — Kenney/Quaternius cc0-city prop meshes: texture refs
#                       stripped (they point at external Textures/colormap.png
#                       which we do not ship — level re-materials every prop),
#                       TANGENT attribute dropped, then gltf-transform
#                       prune+quantize (KHR_mesh_quantization; three r172
#                       GLTFLoader supports it)
#   manifest.a3.json  — A3's manifest fragment (A0 merges into manifest.json)
#
# Deterministic: same inputs -> same outputs. Re-run after changing SETS/PROPS.
# This file is deploy-withheld (tools/ never ships).
import json, os, struct, subprocess, sys, io

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
REPO = os.path.dirname(os.path.dirname(GAME))  # forgeflow-games/
PH   = os.path.join(REPO, "pipeline", "assets", "_downloaded", "polyhaven-textures")
GEN  = os.path.join(REPO, "pipeline", "assets", "generated-materials")
CITY = os.path.join(REPO, "pipeline", "assets", "_downloaded", "cc0-city")
OUT_TEX  = os.path.join(GAME, "assets", "textures")
OUT_PROP = os.path.join(GAME, "assets", "props")

from PIL import Image
import numpy as np

# ---------------------------------------------------------------- textures
# (name, source kind, albedo px, rough px, normal px, albedo q, normal q,
#  normal strength). Payload discipline: menu budget is 6 MB TOTAL and the
# vendored three is already 3.65 MB — the A3 texture share targets <= 1.6 MB.
SETS = [
    # hero ground: cracked worn asphalt (alleys, market street, cut, quay edge)
    dict(name="asphalt_worn", src=("ph", "asphalt_02"), a=1024, r=512, n=768, q=58, nq=58, ns=2.2),
    # worn concrete: customs yard, quay apron
    dict(name="concrete_yard", src=("ph", "asphalt_04"), a=1024, r=512, n=512, q=60, nq=70, ns=1.8),
    # plaster walls (buildings, arcade interior walls) — albedo is near-flat
    # beige (std 0.5 measured): 512 is free; facade variance comes from the
    # grunge/vertex layers in materials.js, not this map.
    dict(name="wall_plaster", src=("ph", "beige_wall_001"), a=512, r=512, n=512, q=68, nq=70, ns=2.0),
    # plaza cobbles (hero puddle ground)
    dict(name="cobble", src=("gen", "stone_cobble"), a=1024, r=512, n=1024, q=68, nq=62, ns=1.0),
    # crates / stalls / pallets
    dict(name="wood", src=("gen", "wood_planks"), a=512, r=512, n=512, q=70, nq=70, ns=1.0),
    # painted/worn steel: dumpsters, scaffolds, shelving, towers, gate
    dict(name="iron_plate", src=("gen", "iron_plate"), a=512, r=512, n=512, q=70, nq=70, ns=1.0),
]

LICENSES = {"ph": "CC0 (Poly Haven)", "gen": "generated (FFG pipeline, original)"}
SOURCES  = {"ph": "pipeline/assets/_downloaded/polyhaven-textures",
            "gen": "pipeline/assets/generated-materials"}

def sobel_normal(gray_f32, strength):
    """height (HxW float 0..1) -> normal map uint8 RGB (OpenGL convention)."""
    h = gray_f32
    gx = np.zeros_like(h); gy = np.zeros_like(h)
    gx[:, 1:-1] = (h[:, 2:] - h[:, :-2]) * 0.5
    gx[:, 0] = h[:, 1] - h[:, -1]; gx[:, -1] = h[:, 0] - h[:, -2]  # wrap (tiling)
    gy[1:-1, :] = (h[2:, :] - h[:-2, :]) * 0.5
    gy[0, :] = h[1, :] - h[-1, :]; gy[-1, :] = h[0, :] - h[-2, :]
    nx = -gx * strength * 255.0
    ny =  gy * strength * 255.0   # +Y (OpenGL); three.js default
    nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
    return ((n * 0.5 + 0.5) * 255.0).clip(0, 255).astype(np.uint8)

def load_map(kind, setname, role):
    """role: albedo|rough|height|normal -> PIL Image or None"""
    if kind == "ph":
        f = {"albedo": "diffuse.jpg", "rough": "rough.jpg", "height": "displacement.jpg"}.get(role)
        p = os.path.join(PH, setname, f) if f else None
    else:
        f = {"albedo": f"{setname}_albedo.webp", "rough": f"{setname}_rough.webp",
             "normal": f"{setname}_normal.webp"}.get(role)
        p = os.path.join(GEN, f) if f else None
    if p and os.path.exists(p):
        return Image.open(p)
    return None

def prep_textures():
    os.makedirs(OUT_TEX, exist_ok=True)
    entries = []
    for s in SETS:
        kind, src = s["src"]
        # albedo
        alb = load_map(kind, src, "albedo").convert("RGB").resize((s["a"], s["a"]), Image.LANCZOS)
        p = os.path.join(OUT_TEX, f'{s["name"]}_albedo.webp')
        alb.save(p, "WEBP", quality=s["q"], method=6)
        entries.append((p, kind, src, "albedo"))
        # roughness (grayscale)
        rg = load_map(kind, src, "rough").convert("L").resize((s["r"], s["r"]), Image.LANCZOS)
        p = os.path.join(OUT_TEX, f'{s["name"]}_rough.webp')
        rg.convert("RGB").save(p, "WEBP", quality=60, method=6)
        entries.append((p, kind, src, "rough"))
        # normal: from displacement (ph) or downscale existing (gen)
        if kind == "ph":
            disp = load_map(kind, src, "height").convert("L").resize((s["n"], s["n"]), Image.LANCZOS)
            arr = np.asarray(disp, dtype=np.float32) / 255.0
            nrm = Image.fromarray(sobel_normal(arr, s["ns"]))
        else:
            nrm = load_map(kind, src, "normal").convert("RGB").resize((s["n"], s["n"]), Image.LANCZOS)
        p = os.path.join(OUT_TEX, f'{s["name"]}_normal.webp')
        nrm.save(p, "WEBP", quality=s.get("nq", 80), method=6)
        entries.append((p, kind, src, "normal"))
        print(f'  set {s["name"]:14s} <- {kind}:{src}')
    return entries

# ------------------------------------------------------------------- props
PROPS = [  # (out name, source path relative to cc0-city)
    ("car_sedan",  "vehicles/sedan.glb"),
    ("van",        "vehicles/van.glb"),
    ("truck",      "vehicles/truck.glb"),
    ("dumpster",   "props/dumpster-quaternius.glb"),
    ("crate",      "props/crate-quaternius.glb"),
    ("planter",    "props/planter.glb"),
    ("ac_unit",    "props/ac-unit-quaternius.glb"),
]

def strip_glb(src_path, dst_path):
    """Remove texture/image/sampler refs + TANGENT attribute from a GLB's JSON
    chunk (BIN untouched; textures were external URIs we never shipped)."""
    with open(src_path, "rb") as f:
        data = f.read()
    magic, ver, total = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB"
    jlen, jtype = struct.unpack_from("<II", data, 12)
    js = json.loads(data[20:20 + jlen].decode("utf-8"))
    rest = data[20 + jlen:]  # BIN chunk (header + payload), verbatim
    js.pop("images", None); js.pop("textures", None); js.pop("samplers", None)
    for m in js.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        pbr.pop("baseColorTexture", None); pbr.pop("metallicRoughnessTexture", None)
        m.pop("normalTexture", None); m.pop("occlusionTexture", None); m.pop("emissiveTexture", None)
    for mesh in js.get("meshes", []):
        for prim in mesh.get("primitives", []):
            prim.get("attributes", {}).pop("TANGENT", None)
    payload = json.dumps(js, separators=(",", ":")).encode("utf-8")
    pad = (4 - len(payload) % 4) % 4
    payload += b" " * pad
    out = struct.pack("<III", magic, ver, 12 + 8 + len(payload) + len(rest)) + \
          struct.pack("<II", len(payload), jtype) + payload + rest
    with open(dst_path, "wb") as f:
        f.write(out)

def prep_props():
    os.makedirs(OUT_PROP, exist_ok=True)
    entries = []
    for name, rel in PROPS:
        src = os.path.join(CITY, rel)
        tmp = os.path.join(OUT_PROP, f"_{name}_stripped.glb")
        dst = os.path.join(OUT_PROP, f"{name}.glb")
        strip_glb(src, tmp)
        # prune (drops the accessors/bufferViews the strip orphaned), then
        # quantize (KHR_mesh_quantization: pos int16, normal int8, uv int16)
        r = subprocess.run(["npx", "--yes", "gltf-transform", "prune", tmp, tmp + "2"],
                           capture_output=True, text=True, shell=(os.name == "nt"))
        if r.returncode != 0:
            print(r.stdout); print(r.stderr); sys.exit(f"gltf-transform prune failed on {name}")
        r = subprocess.run(["npx", "--yes", "gltf-transform", "quantize", tmp + "2", dst],
                           capture_output=True, text=True, shell=(os.name == "nt"))
        if r.returncode != 0:
            print(r.stdout); print(r.stderr); sys.exit(f"gltf-transform quantize failed on {name}")
        os.remove(tmp); os.remove(tmp + "2")
        print(f"  prop {name:12s} {os.path.getsize(src):7d} -> {os.path.getsize(dst):7d} bytes")
        entries.append((dst, rel))
    return entries

# ---------------------------------------------------------------- manifest
def main():
    print("[prep] textures")
    tex = prep_textures()
    print("[prep] props")
    props = prep_props()
    entries = []
    for p, kind, src, role in tex:
        entries.append({
            "path": os.path.relpath(p, GAME).replace("\\", "/"),
            "bytes": os.path.getsize(p),
            "kind": "imported" if kind == "ph" else "generated",
            "license": LICENSES[kind],
            "source": f"{SOURCES[kind]}/{src} ({role}; normals Sobel-generated from displacement at build time)",
        })
    for p, rel in props:
        entries.append({
            "path": os.path.relpath(p, GAME).replace("\\", "/"),
            "bytes": os.path.getsize(p),
            "kind": "imported",
            "license": "CC0 (Kenney / Quaternius via poly.pizza; proof: cc0-city/SOURCES.json)",
            "source": f"pipeline/assets/_downloaded/cc0-city/{rel} (textures stripped, re-materialed at load, quantized)",
        })
    frag = {
        "lane": "A3-level",
        "updated": "2026-08-19",
        "note": "level PBR texture sets + cc0-city prop meshes. All other level "
                "textures (facade/trim/emissive/decal/glow/ripple/metal/burlap/tarp) "
                "are canvas-procedural at load — zero payload.",
        "entries": entries,
    }
    mp = os.path.join(GAME, "assets", "manifest.a3.json")
    with open(mp, "w", encoding="utf-8") as f:
        json.dump(frag, f, indent=1)
    total = sum(e["bytes"] for e in entries)
    print(f"[prep] manifest.a3.json written — {len(entries)} entries, {total} bytes ({total/1048576:.2f} MB)")

if __name__ == "__main__":
    main()
