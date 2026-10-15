#!/usr/bin/env python3
"""art_b_city.py - Kenney city-kit intake for the Last Circle town pilot (dev-only; _tools/ never ships).

SOURCE   F:/games/forgeflow-games-assets/_downloaded/cc0-city/ (Kenney City Kit Suburban 20, Commercial 2.1, Roads,
         Car Kit 3.1, Furniture Kit 2.0 - all CC0; 3 Quaternius props, CC0 via Poly Pizza; one Kenney Graveyard Kit
         bench, CC0) - see CREDITS.md.
OUTPUT   assets/props/city/{suburban,commercial,skyscraper,lowdetail,props,furniture,walls}/<name>.glb
         assets/props/cars/<name>.glb + palette_car.png
         assets/props/city/palettes/*.png            one PNG per palette (+ recoloured variants)
         assets/props/city/manifest.json             per type: file, tris, bbox_m, suggested_scale, palette, colliders

WHAT A GLB IS (the contract the next wave codes against)
  * ONE node / ONE mesh, geometry only: POSITION (float32), NORMAL (int8 normalised, meshopt octahedral filter),
    TEXCOORD_0 (uint16 normalised) and indices. No tangents, no embedded image. Palette-textured types carry one
    material named after the palette key; the town code assigns ONE shared THREE.Texture per palette:
        tex = new THREE.Texture/TextureLoader image; tex.flipY = false; tex.colorSpace = SRGBColorSpace
        (UVs are glTF-style: v runs down the image; the source sampler was NEAREST mag / NEAREST_MIPMAP_NEAREST min)
    Types that use flat material colours (Quaternius dumpster/crate/container, furniture, walls) keep their
    baseColorFactor materials and need no texture.
  * Compression: EXT_meshopt_compression (+ KHR_mesh_quantization for the UVs). Needs GLTFLoader.setMeshoptDecoder(
    MeshoptDecoder) - vendored at assets/vendor/three/examples/jsm/libs/meshopt_decoder.module.js.
  * POSITION is NOT quantised to int16 on purpose: that needs a dequantisation transform on the node, which breaks
    InstancedMesh(geometry, ...) and any applyMatrix4 bake (normalised int16 clamps at +-1). Positions are instead snapped
    to a 0.5 mm grid in native units so meshopt compresses them well (measured: ~8 % bigger than quant14).
  * Origin = footprint centre at ground level (y = 0 at the bottom). Authored front = +Z (Kenney convention).
    Units: native kit units; multiply by `suggested_scale` for metres (bbox_m and colliders are ALREADY in metres at
    that scale; for another scale multiply them by newScale / suggested_scale).
  * doubleSided stays as authored (Kenney = true, Quaternius / furniture = false); the shells are not watertight.

COLLIDERS  baked from the geometry, as exact axis-aligned boxes, and judged against the DRAWN mesh by _harness/probe_kitcollide.js (Wave 7, lane 7E):
             poke-out  (the drawn solid reaching outside the boxes at body height)  <= 0.10 m for EVERY type,
             phantom   (the boxes reaching outside the drawn solid)                 <= 0.25 m for EVERY type.
           Body band = feet+0.3 .. feet+1.8 m (below: a step, the mover climbs 0.55 m; above: clears the 1.8 m capsule). Mode "footprint" (buildings) and "bands"
           (cars): the triangles clipped to the band are projected to the ground (0.05 m cells), the enclosed area is filled (a hollow shell is solid, a porch roof
           or awning inside the band is solid, one above 1.8 m is NOT), and the mask is covered by a few maximal axis-aligned rectangles: each rectangle lies
           inside the solid grown by 0.15 m (so a box never stands more than 0.15 m off the drawn mesh), together they cover every part of the solid that is
           thicker than 0.10 m (so nothing visible is more than 0.10 m outside them), and each is cut back to the cells it is needed for. A column or a
           porch post three metres from the wall gets its own small box; a chamfered corner gets a plus-shaped pair instead of one box with a 0.28 m phantom
           corner. Height of each box = the 75th percentile of the roof height under it (>= 1.8 m), split at a real roof-height step. Modes "bbox", "pole" and
           "elevation" are unchanged. They are built from the manifest, not from the GLB, so they exist whether or not the GLB loads (the maps.js pattern
           that drops colliders on a failed load is the thing to avoid).

USAGE   python games/last-circle/_tools/art_b_city.py [--only SUBSTR] [--scratch DIR] [--no-plots] [--skip-pack] [--out-root DIR] [--colliders-only]
          --colliders-only   recompute only the colliders / collider_mode / collider_info (+ the manifest readme) into the existing manifest: ~1 min, no GLB, palette or
                             plot is written, every other byte of the manifest is kept. The full run and this one write the SAME manifest bytes (checked 2026-10-14).
          --out-root DIR     write assets/props/{city,cars} under DIR instead of the game directory (reproducibility checks: the full run into an empty DIR reproduces the
                             manifest and every GLB / PNG of the game directory byte for byte).
        After a run: node runtime/3d/royale/citykit.selftest.cjs --emit-table (the embedded COLLIDER_BOXES of citykit.js), then
        python _harness/kitcollide.py (poke-out / phantom of all 81 types against the drawn mesh) and node runtime/3d/royale/citykit.selftest.cjs.
Exit codes: 0 ok, 1 an assertion failed, 2 environment problem (source / gltf-transform / node missing).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
sys.path.insert(0, str(HERE))
from art_b_glb import Prim, glb_stats, read_glb, write_glb  # noqa: E402

SRC = Path("F:/games/forgeflow-games-assets/_downloaded/cc0-city")
GRAVE_TEX = Path("F:/games/forgeflow-games-assets/_downloaded/graveyard-kit/Models/GLB format/Textures/colormap.png")
OUT = GAME / "assets" / "props" / "city"
OUT_CARS = GAME / "assets" / "props" / "cars"
DEFAULT_SCRATCH = Path("C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/wave4/ART-B")

# ───────────────────────────── catalogue ─────────────────────────────
# palette key -> source colormap + licence line
PALETTES = {
    "suburban": dict(src=SRC / "_colormaps" / "city-suburban.png", file="palettes/suburban.png",
                     kit="Kenney City Kit (Suburban) 20", sampler="NEAREST/NEAREST_MIPMAP_NEAREST"),
    "commercial": dict(src=SRC / "_colormaps" / "city-commercial.png", file="palettes/commercial.png",
                       kit="Kenney City Kit (Commercial) 2.1 (also skyscrapers + low-detail)", sampler="NEAREST/NEAREST_MIPMAP_NEAREST"),
    "roads": dict(src=SRC / "_colormaps" / "city-roads.png", file="palettes/roads.png",
                  kit="Kenney City Kit (Roads)", sampler="NEAREST/NEAREST_MIPMAP_NEAREST"),
    "car": dict(src=SRC / "_colormaps" / "car.png", file="../cars/palette_car.png",
                kit="Kenney Car Kit 3.1", sampler="LINEAR/LINEAR_MIPMAP_LINEAR"),
    "graveyard": dict(src=GRAVE_TEX, file="palettes/graveyard.png", kit="Kenney Graveyard Kit 5.0", sampler="LINEAR/LINEAR_MIPMAP_LINEAR"),
    "quaternius_atlas": dict(src=None, file="palettes/quaternius_atlas.png", kit="Quaternius props via Poly Pizza (CC0)", sampler="LINEAR/LINEAR_MIPMAP_LINEAR"),
}
# recoloured variants: (variant, [(cell box x0,y0,x1,y1 in the 512 px map, target sRGB colour, what)])
ROOF_CELL = (0, 128, 64, 256)        # the green roof swatch of the suburban + commercial colormaps
WALL_CELL = (192, 256, 256, 384)     # the cream-white wall swatch
VARIANTS = {
    "suburban": {
        "slate": [(ROOF_CELL, (78, 88, 104), "roof")],
        "brick": [(ROOF_CELL, (158, 70, 52), "roof")],
        "sand": [(ROOF_CELL, (204, 176, 126), "roof")],
    },
    "commercial": {
        "slate": [(ROOF_CELL, (78, 88, 104), "roof"), (WALL_CELL, (150, 160, 176), "wall")],
        "brick": [(ROOF_CELL, (158, 70, 52), "roof"), (WALL_CELL, (176, 98, 76), "wall")],
        "sand": [(ROOF_CELL, (204, 176, 126), "roof"), (WALL_CELL, (226, 206, 168), "wall")],
    },
}

# id suffix -> (group, source file under SRC, palette, suggested_scale, role, collider mode)
B = []   # buildings
for n in "acegh" + "imopq":
    B.append(("suburban", f"buildings/building-type-{n}.glb", f"building-type-{n}", "suburban", 7.2, "house", "footprint"))
for n, role in [("a", "midrise"), ("c", "shop"), ("e", "warehouse"), ("f", "midrise"), ("h", "midrise"), ("i", "midrise"), ("m", "tower")]:
    B.append(("commercial", f"buildings/building-{n}.glb", f"building-{n}", "commercial", 12.0, role, "footprint"))
for n in "abcde":
    B.append(("skyscraper", f"buildings/building-skyscraper-{n}.glb", f"building-skyscraper-{n}", "commercial", 12.0, "tower", "footprint"))
for n in ["a", "b", "g", "h", "wide-a"]:
    B.append(("lowdetail", f"buildings/low-detail-building-{n}.glb", f"low-detail-building-{n}", "commercial", 12.0, "skyline", "footprint"))

P = [   # street / yard props
    ("props", "props/light-curved.glb", "light-curved", "roads", 9.0, "street_light", "pole"),
    ("props", "props/light-curved-double.glb", "light-curved-double", "roads", 9.0, "street_light", "pole"),
    ("props", "props/light-square.glb", "light-square", "roads", 9.0, "street_light", "pole"),
    ("props", "props/construction-barrier.glb", "construction-barrier", "roads", 9.0, "barrier", "bbox"),
    ("props", "props/cone-traffic.glb", "cone-traffic", "car", 1.2, "cone", "bbox"),
    ("props", "props/box-crate.glb", "box-crate", "car", 1.3, "crate", "bbox"),
    ("props", "props/fence-suburban.glb", "fence-suburban", "suburban", 5.0, "fence", "bbox"),
    ("props", "props/planter.glb", "planter", "suburban", 4.0, "planter", "footprint"),
    ("props", "props/grave-bench.glb", "grave-bench", "graveyard", 1.8, "bench", "bbox"),
    ("props", "props/hydrant-quaternius.glb", "hydrant", "quaternius_atlas", 1.0, "hydrant", "bbox"),
    ("props", "props/dumpster-quaternius.glb", "dumpster", None, 0.8, "dumpster", "bbox"),
    ("props", "props/barrier-traffic-quaternius.glb", "barrier-traffic", "quaternius_atlas", 1.0, "barrier", "footprint"),
    ("props", "props/crate-quaternius.glb", "crate-yard", None, 6.0, "crate", "bbox"),
    ("props", "props/shipping-container-quaternius.glb", "shipping-container", None, 1.38, "container", "bbox"),
]
CARS = [(n, "car", 1.7 if n not in ("delivery",) else 1.6) for n in
        ["sedan", "suv", "taxi", "police", "van", "hatchback-sports", "truck", "delivery"]]
FURN = ["bookcaseClosed", "cabinetTelevision", "chair", "chairDesk", "desk", "kitchenFridge", "kitchenSink", "kitchenStove",
        "loungeSofa", "tableCoffee", "table", "sideTable", "pottedPlant", "trashcan", "cardboardBoxClosed", "stoolBar"]
WALLS = ["doorway", "doorwayFront", "doorwayOpen", "floorCorner", "floorCornerRound", "floorFull", "floorHalf", "paneling",
         "wall", "wallCorner", "wallCornerRond", "wallDoorway", "wallDoorwayWide", "wallHalf", "wallWindow", "wallWindowSlide"]
README = [
        "Geometry-only GLBs. Palette-textured types: assign ONE shared THREE.Texture per palette (palettes[<key>].file, relative to this manifest): tex.flipY=false, tex.colorSpace=SRGBColorSpace, magFilter=NearestFilter, minFilter=NearestMipmapNearestFilter for the Kenney city palettes.",
        "Needs GLTFLoader.setMeshoptDecoder(MeshoptDecoder) (assets/vendor/three/examples/jsm/libs/meshopt_decoder.module.js).",
        "POSITION is float32 (no KHR_mesh_quantization transform on the node): geometry can be instanced or baked directly. NORMAL decodes to int8 normalised, TEXCOORD_0 to uint16 normalised.",
        "Origin = footprint centre at ground, authored front = +Z. Multiply native units by suggested_scale for metres. bbox_m / colliders are in metres at suggested_scale (for another scale multiply by newScale/suggested_scale).",
        "colliders: axis-aligned boxes {min,max}, local metres, fitted to the geometry that is DRAWN between feet+0.3 m and feet+1.8 m (art_b_city.py; judged by _harness/probe_kitcollide.js: nothing drawn at body height more than 0.10 m outside the boxes, no box edge more than 0.25 m off the drawn mesh). A porch roof or awning above 1.8 m is not a collider, a column or pilaster is. Build them from this manifest whether or not the GLB loads.",
        "Palette variants (palettes[key].variants): recoloured copies of the colormap (suburban: roof slate/brick/sand; commercial: roof + facade slate/brick/sand). Swap the shared texture, not the GLB.",
        "Cars have no roof palette variants (no roofs); front = +Z; collider boxes in two layers (body up to the beltline, cabin above it).",
        "The suburban and commercial kits both name their texture Textures/colormap.png but the two colormaps DIFFER: never share one THREE.Texture between them (one shared Texture per palette key).",
        "districts: suggested type lists for the Savanna pilot (downtown, suburb, warehouse_yard, far_skyline, street, parking, interior_kit).",
]

KIT_SCALE = 2.2   # furniture + walls share one grid: a 1.0 wall module = 2.2 m


def catalogue():
    cat = []
    for g, f, nm, pal, sc, role, mode in B + P:
        cat.append(dict(group=g, src=SRC / f, name=nm, palette=pal, scale=sc, role=role, mode=mode, out=OUT / g / f"{nm}.glb", kind="building" if g != "props" else "prop"))
    for n, pal, sc in CARS:
        cat.append(dict(group="cars", src=SRC / "vehicles" / f"{n}.glb", name=n, palette=pal, scale=sc, role="car", mode="bands", out=OUT_CARS / f"{n}.glb", kind="car"))
    for n in FURN:
        cat.append(dict(group="furniture", src=SRC / "furniture" / f"{n}.glb", name=n, palette=None, scale=KIT_SCALE, role="furniture", mode="bbox", out=OUT / "furniture" / f"{n}.glb", kind="furniture"))
    for n in WALLS:
        mode = "elevation" if "oorway" in n else ("footprint" if n in ("wallCorner", "wallCornerRond") else "bbox")
        cat.append(dict(group="walls", src=SRC / "walls" / f"{n}.glb", name=n, palette=None, scale=KIT_SCALE, role="wall", mode=mode, out=OUT / "walls" / f"{n}.glb", kind="wall"))
    for c in cat:
        c["id"] = f"{c['group']}/{c['name']}"
    return cat


# ───────────────────────────── helpers ─────────────────────────────
class EnvError(RuntimeError):
    pass


def cli_dir() -> Path:
    exe = shutil.which("gltf-transform")
    if not exe:
        raise EnvError("gltf-transform CLI not on PATH")
    d = Path(exe).resolve().parent / "node_modules" / "@gltf-transform" / "cli"
    if not d.exists():
        raise EnvError(f"gltf-transform install dir not found: {d}")
    return d


def snap_exp(scale: float) -> int:
    return int(math.ceil(math.log2(scale / 0.0005)))     # <= 0.5 mm grid at the suggested scale


def run_pack(cli: Path, src: Path, dst: Path, uvq: bool) -> dict:
    node = shutil.which("node")
    if not node:
        raise EnvError("node not on PATH")
    r = subprocess.run([node, str(HERE / "art_b_pack.cjs"), str(cli), str(src), str(dst), "--uvq", "1" if uvq else "0", "--pos", "float"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode:
        raise RuntimeError("pack failed for %s: %s" % (src.name, (r.stderr or r.stdout)[:600]))
    return json.loads(r.stdout.strip().splitlines()[-1])


def materials_for(c: dict, g) -> list[dict]:
    if c["palette"]:
        return [{"name": c["palette"], "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 1.0},
                 "doubleSided": True}]
    out = []
    for m in g.json.get("materials", []):
        pbr = m.get("pbrMetallicRoughness", {})
        out.append({"name": m.get("name", "mat"),
                    "pbrMetallicRoughness": {"baseColorFactor": pbr.get("baseColorFactor", [1, 1, 1, 1]), "metallicFactor": 0.0,
                                             "roughnessFactor": 1.0},
                    "doubleSided": bool(m.get("doubleSided", False))})
    return out or [{"name": "default"}]


def clean_prims(g, c) -> list[Prim]:
    prims = g.prims
    if c["palette"]:
        for p in prims:
            p.mat = 0
    k = snap_exp(c["scale"])
    q = float(2 ** k)
    out = []
    for p in prims:
        pos = (np.round(p.pos.astype(np.float64) * q) / q).astype(np.float32)
        idx = p.idx
        a, b, d = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
        area = np.linalg.norm(np.cross(b - a, d - a), axis=1)
        keep = area > 1e-12
        out.append(Prim(pos, p.nrm, p.uv, idx[keep], p.mat, p.node))
    return out


# ───────────────────────────── colliders ─────────────────────────────
BAND = (0.30, 1.80)  # body band, metres at suggested scale: lower = a step (the mover climbs 0.55 m), higher = clears a 1.8 m capsule
CELL = 0.05          # metres per grid cell of the fit
CLOSE_CELLS = 2      # a gap in the wall outline narrower than 2 x 2 cells (0.2 m) does not open a hollow shell to the outside
OPEN_CELLS = 0       # 0: every cell of the drawn solid must be covered; n > 0: a feature thinner than 2n cells (0.10 m for 1) may stay uncovered
ALLOW = 0.12         # a box may stand this far (m, plus a cell) off the drawn solid (the phantom bar is 0.25 m)
POKE_OK = 0.05       # raster estimate (m) a 1- or 2-box cover must stay under (the probe's bar is 0.10 m; the estimate is good to half a cell)
PHANTOM_OK = 0.16    # raster estimate (m) of the farthest exposed box edge from the mesh, corner slack included (the probe's bar is 0.25 m)
MAX_BOXES = 24       # per layer


def tri_world(prims, scale):
    return np.concatenate([p.pos[p.idx] * scale for p in prims]).astype(np.float64)    # (T,3,3)


def clip_y(poly: np.ndarray, lo: float, hi: float) -> np.ndarray:
    for axis_sign, bound in ((1, lo), (-1, hi)):
        if len(poly) == 0:
            return poly
        out = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            da = axis_sign * (a[1] - bound)
            db = axis_sign * (b[1] - bound)
            if da >= 0:
                out.append(a)
            if (da >= 0) != (db >= 0):
                t = da / (da - db)
                out.append(a + t * (b - a))
        poly = np.array(out) if out else np.zeros((0, 3))
    return poly


class Grid:
    def __init__(self, tris: np.ndarray, cell: float, margin: int = 3):
        self.cell = cell
        self.x0 = tris[..., 0].min() - margin * cell
        self.z0 = tris[..., 2].min() - margin * cell
        self.W = int(math.ceil((tris[..., 0].max() - self.x0) / cell)) + margin + 1
        self.H = int(math.ceil((tris[..., 2].max() - self.z0) / cell)) + margin + 1

    def pts(self, xz: np.ndarray) -> np.ndarray:
        u = (xz[:, 0] - self.x0) / self.cell
        v = (xz[:, 1] - self.z0) / self.cell
        return np.round(np.stack([u, v], 1) * 16).astype(np.int32)

    def to_world(self, c0, r0, c1, r1):
        return self.x0 + c0 * self.cell, self.z0 + r0 * self.cell, self.x0 + c1 * self.cell, self.z0 + r1 * self.cell


def draw_poly(img, grid: Grid, poly3: np.ndarray, value) -> None:
    if len(poly3) < 2:
        return
    pts = grid.pts(poly3[:, [0, 2]])
    if len(poly3) >= 3:
        cv2.fillConvexPoly(img, pts, value, lineType=cv2.LINE_8, shift=4)
    cv2.polylines(img, [pts.reshape(-1, 1, 2)], True, value, 1, lineType=cv2.LINE_8, shift=4)


def band_mask(tris, grid, lo, hi):
    m = np.zeros((grid.H, grid.W), np.uint8)
    for t in tris:
        if t[:, 1].max() < lo or t[:, 1].min() > hi:
            continue
        draw_poly(m, grid, clip_y(t, lo, hi), 255)
    return m


def fill_enclosed(wall: np.ndarray, k: int = 1) -> np.ndarray:
    d = cv2.dilate(wall, np.ones((3, 3), np.uint8), iterations=k)
    free = d == 0
    lab, n = ndimage.label(free)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    outside = np.isin(lab, border[border > 0])
    solid = (~outside).astype(np.uint8)
    return cv2.erode(solid, np.ones((3, 3), np.uint8), iterations=k).astype(bool)


def heightfield(tris, grid):
    top = np.zeros((grid.H, grid.W), np.float32)
    order = np.argsort(tris[:, :, 1].max(1))
    for i in order:
        t = tris[i]
        draw_poly(top, grid, t, float(t[:, 1].max()))
    return top


def max_rect(mask: np.ndarray):
    """Largest all-True axis-aligned rectangle: (area, r0, c0, r1, c1) with exclusive r1/c1."""
    H, W = mask.shape
    h = np.zeros(W, int)
    best = (0, 0, 0, 0, 0)
    for r in range(H):
        h = np.where(mask[r], h + 1, 0)
        stack = []
        for c in range(W + 1):
            cur = h[c] if c < W else 0
            start = c
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                area = hh * (c - s)
                if area > best[0]:
                    best = (area, r - hh + 1, s, r + 1, c)
                start = s
            stack.append((start, cur))
    return best


def decompose(solid: np.ndarray, max_boxes: int, min_frac: float):
    work = solid.copy()
    total = int(solid.sum())
    rects = []
    while len(rects) < max_boxes and work.sum() > 0:
        area, r0, c0, r1, c1 = max_rect(work)
        if area < max(4, min_frac * total):
            break
        rects.append((r0, c0, r1, c1))
        work[r0:r1, c0:c1] = False
    covered = sum((r1 - r0) * (c1 - c0) for r0, c0, r1, c1 in rects)
    return rects, covered / max(total, 1)


def split_by_height(rect, top, solid, depth=0, max_depth=2):
    """Split a footprint rectangle at a real roof-height STEP (a lower wing next to a tall block). A gabled roof changes
    height gradually (a few cm per cell) and is never split; a step is a single-cell jump >= max(1.2 m, 18 %)."""
    cell = CELL
    r0, c0, r1, c1 = rect
    if (r1 - r0) * (c1 - c0) * cell * cell < 12.0:     # a small bump is not worth two boxes
        return [rect]
    sub = np.where(solid[r0:r1, c0:c1] & (top[r0:r1, c0:c1] > 0), top[r0:r1, c0:c1], np.nan)
    best = None
    for axis in (0, 1):                       # axis 0: profile along x (per column), 1: along z (per row)
        with np.errstate(all="ignore"):
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                prof = np.nanmedian(sub, axis=0 if axis == 0 else 1)
        ok = ~np.isnan(prof)
        if ok.sum() < round(0.9 / cell):
            continue
        pf = np.where(ok, prof, np.nan)
        jumps = np.abs(np.diff(pf))
        if np.all(np.isnan(jumps)):
            continue
        i = int(np.nanargmax(jumps))
        n = len(prof)
        if i + 1 < round(1.2 / cell) or n - (i + 1) < round(1.2 / cell):           # each part at least 1.2 m wide
            continue
        if jumps[i] >= max(1.2, 0.18 * float(np.nanmax(pf))) and (best is None or jumps[i] > best[0]):
            best = (float(jumps[i]), axis, i + 1)
    if best is None or depth >= max_depth:
        return [rect]
    _, axis, k = best
    if axis == 0:
        parts = [(r0, c0, r1, c0 + k), (r0, c0 + k, r1, c1)]
    else:
        parts = [(r0, c0, r0 + k, c1), (r0 + k, c0, r1, c1)]
    out = []
    for q in parts:
        out += split_by_height(q, top, solid, depth + 1, max_depth)
    return out


def best_rect(allowed: np.ndarray, uncovered: np.ndarray):
    """The rectangle inside `allowed` (every cell True) that covers the most `uncovered` cells; ties -> the smaller one.
    Enumerates the maximal rectangles of the histogram stack (as max_rect does) and scores each from an integral image.
    -> (score, area, r0, c0, r1, c1) with exclusive r1 / c1; score 0 when nothing is left to cover."""
    H, W = allowed.shape
    ii = np.zeros((H + 1, W + 1), np.int32)
    ii[1:, 1:] = uncovered.astype(np.int32).cumsum(0).cumsum(1)
    heights = np.zeros(W, np.int32)
    best = (0, 1 << 60, 0, 0, 0, 0)
    for r in range(H):
        heights = np.where(allowed[r], heights + 1, 0)
        hl = heights.tolist()
        stack: list = []
        for c in range(W + 1):
            cur = hl[c] if c < W else 0
            start = c
            while stack and stack[-1][1] >= cur:
                s, hh = stack.pop()
                if hh:
                    r0 = r - hh + 1
                    sc = int(ii[r + 1, c] - ii[r0, c] - ii[r + 1, s] + ii[r0, s])
                    area = hh * (c - s)
                    if sc > best[0] or (sc == best[0] and sc > 0 and area < best[1]):
                        best = (sc, area, r0, s, r + 1, c)
                start = s
            stack.append((start, cur))
    return best


def cover_mask(rects, shape) -> np.ndarray:
    m = np.zeros(shape, bool)
    for r0, c0, r1, c1 in rects:
        m[r0:r1, c0:c1] = True
    return m


def cover_error(cov: np.ndarray, need: np.ndarray, dS: np.ndarray):
    """Raster estimate of how a cover stands to the drawn solid, in metres: (poke, phantom). poke = the farthest cell of `need` from the cover; phantom = the
    farthest cell on the exposed boundary of the cover from the solid (dS = distance of every cell to it) plus the 0.06 m a box CORNER stands past a cell centre
    and the raster is conservative (measured against the probe: the probe reads about this estimate, never more than 0.01 m above it)."""
    poke = float(ndimage.distance_transform_edt(~cov)[need].max()) * CELL if need.any() else 0.0
    edge = cov & ~ndimage.binary_erosion(cov, structure=ndimage.generate_binary_structure(2, 1), border_value=0)
    phantom = float(dS[edge].max()) + 0.06 if edge.any() else 0.0
    return poke, phantom


def fit_rects(solid: np.ndarray, max_boxes: int = MAX_BOXES, pre=None):
    """Cover the drawn solid (the filled band projection) with few axis-aligned rectangles so that nothing drawn is more than POKE_OK outside them and no box edge
    stands more than ALLOW (+ a cell) off the mesh. `pre` = rectangles of lower layers that already stand (a cell within POKE_OK of them needs no box: the mirrors
    of a car are within a hand of its door line). Fewest boxes first:
      1 box   the bounding box of what is left (a post, a plain block);
      2 boxes a plus: the bounding box with a notch cut out of each of its four corners (a chamfered or rounded building / car corner), the notch searched on a
              5 cm grid, smallest first;
      n boxes the greedy exact cover: the rectangle inside `allowed` (= the solid grown by ALLOW) that covers the most cells that are still more than POKE_OK from
              every box, cut back to the bounding box of those cells (tight against the mesh, never reaching into the slack), until nothing is left. A facade with
              0.5 m pilasters needs a box per pilaster: no single face is within 0.10 m of both the pilaster tip and the recess behind it.
    Boxes wholly inside the union of the others are dropped. -> (rects [(r0, c0, r1, c1)], uncovered cells, cells that needed covering)"""
    dS = ndimage.distance_transform_edt(~solid) * CELL
    allowed = dS <= ALLOW
    cov0 = cover_mask(pre or [], solid.shape)
    need = solid & ((ndimage.distance_transform_edt(~cov0) * CELL > POKE_OK) if cov0.any() else True)
    total = int(need.sum())
    if total == 0:
        return [], 0, 0
    rr, cc = np.nonzero(need)
    r0, r1, c0, c1 = int(rr.min()), int(rr.max()) + 1, int(cc.min()), int(cc.max()) + 1
    one = [(r0, c0, r1, c1)]
    p1, f1 = cover_error(cov0 | cover_mask(one, solid.shape), need, dS)
    if p1 <= POKE_OK and f1 <= PHANTOM_OK:
        return one, 0, total
    if max_boxes >= 2:
        best = None
        for ix in range(1, 11):
            for iz in range(1, 11):
                if 2 * ix >= c1 - c0 or 2 * iz >= r1 - r0:
                    continue
                cross = [(r0 + iz, c0, r1 - iz, c1), (r0, c0 + ix, r1, c1 - ix)]
                p2, f2 = cover_error(cov0 | cover_mask(cross, solid.shape), need, dS)
                if p2 <= POKE_OK and f2 <= PHANTOM_OK and (best is None or (ix + iz) < best[0]):
                    best = (ix + iz, cross)
        if best:
            return best[1], 0, total
    rects: list = []
    unc = need.copy()
    while len(rects) < max_boxes and unc.any():
        sc, _, a0, b0, a1, b1 = best_rect(allowed, unc)
        if sc == 0:
            break
        rr2, cc2 = np.nonzero(unc[a0:a1, b0:b1])
        rects.append((a0 + int(rr2.min()), b0 + int(cc2.min()), a0 + int(rr2.max()) + 1, b0 + int(cc2.max()) + 1))
        cov = cov0 | cover_mask(rects, solid.shape)
        unc = need & (ndimage.distance_transform_edt(~cov) * CELL > POKE_OK)
    # drop a rectangle wholly covered by the others (smallest first)
    cover = np.zeros(solid.shape, np.int16)
    for q in rects:
        cover[q[0]:q[2], q[1]:q[3]] += 1
    for q in sorted(rects, key=lambda q: (q[2] - q[0]) * (q[3] - q[1])):
        if (cover[q[0]:q[2], q[1]:q[3]] >= 2).all():
            rects.remove(q)
            cover[q[0]:q[2], q[1]:q[3]] -= 1
    return rects, int(unc.sum()), total


def rect_boxes(rects, grid, top, solid, y0=None, y1=None, floor=None):
    """grid rectangles -> boxes [x0, y0, z0, x1, y1, z1] in metres. y0 / y1 None: ground to the 75th percentile of the roof height under the
    rectangle (at least the top of the body band), split at a real roof-height step; given: that layer (cars)."""
    boxes = []
    for rect in rects:
        parts = split_by_height(rect, top, solid) if y1 is None else [rect]
        for r0, c0, r1, c1 in parts:
            x0, z0, x1, z1 = grid.to_world(c0, r0, c1, r1)
            if y1 is None:
                hv = top[r0:r1, c0:c1]
                hv = hv[hv > 0]
                h = max(float(np.percentile(hv, 75)) if len(hv) else BAND[1], BAND[1] if floor is None else floor)
                boxes.append([round(x0, 3), 0.0, round(z0, 3), round(x1, 3), round(h, 3), round(z1, 3)])
            else:
                boxes.append([round(x0, 3), round(y0, 3), round(z0, 3), round(x1, 3), round(y1, 3), round(z1, 3)])
    return boxes


def footprint_colliders(prims, scale, max_boxes=MAX_BOXES):
    tris = tri_world(prims, scale)
    grid = Grid(tris, CELL, margin=8)
    wall = band_mask(tris, grid, *BAND)
    solid = fill_enclosed(wall, CLOSE_CELLS)
    top = heightfield(tris, grid)
    rects, left, total = fit_rects(solid, max_boxes)
    boxes = rect_boxes(rects, grid, top, solid, floor=min(BAND[1], float(tris[..., 1].max())))      # a 0.7 m planter gets a 0.7 m box, not a 1.8 m one
    return boxes, dict(coverage=round(1 - left / max(total, 1), 3), height_splits=len(boxes) - len(rects)), (grid, wall, solid, top)


def bbox_collider(prims, scale, min_dim=0.0):
    P = np.concatenate([p.pos for p in prims]).astype(np.float64) * scale
    lo, hi = P.min(0), P.max(0)
    lo[1] = max(lo[1], 0.0)
    if min_dim:
        c = (lo + hi) / 2
        for ax in (0, 2):
            half = max((hi[ax] - lo[ax]) / 2, min_dim / 2)
            lo[ax], hi[ax] = c[ax] - half, c[ax] + half
    return [[round(float(x), 3) for x in (*lo, *hi)]]


def pole_colliders(prims, scale):
    tris = tri_world(prims, scale)
    ymax = float(tris[..., 1].max())
    pts = []
    for t in tris:
        poly = clip_y(t, 0.05, min(1.2, ymax * 0.5))
        if len(poly):
            pts.append(poly)
    P = np.concatenate(pts)
    lo, hi = P.min(0), P.max(0)
    c = (lo + hi) / 2
    half = np.maximum((hi - lo) / 2, 0.12)
    return [[round(float(c[0] - half[0]), 3), 0.0, round(float(c[2] - half[2]), 3), round(float(c[0] + half[0]), 3), round(ymax, 3), round(float(c[2] + half[2]), 3)]]


def band_colliders(prims, scale):
    """Cars: a low body layer and a narrower cabin layer, each fitted like a building footprint (the body box has round-cornered phantom corners cut away
    by the plus-shaped cover). The split is the lowest height at which the geometry above it is <= 80 % of the full length (the cabin without the hood /
    trunk); a van or box truck never gets there and splits at half height. Body boxes stand on the ground up to the split, cabin boxes from the split to the roof."""
    tris = tri_world(prims, scale)
    ymax = float(tris[..., 1].max())

    def extent(lo, hi):
        pts = [q for q in (clip_y(t, lo, hi) for t in tris if t[:, 1].max() >= lo and t[:, 1].min() <= hi) if len(q)]
        if not pts:
            return None
        return np.concatenate(pts)

    full = extent(0.25, ymax)
    full_len = float(full[:, 2].max() - full[:, 2].min())
    split = None
    for f in np.arange(0.40, 0.86, 0.02):
        y = float(f * ymax)
        P = extent(y, ymax)
        if P is not None and float(P[:, 2].max() - P[:, 2].min()) <= 0.80 * full_len:
            split = round(y, 3)
            break
    if split is None:
        split = round(0.5 * ymax, 3)
    grid = Grid(tris, CELL, margin=8)
    boxes, left, total, below = [], 0, 0, []
    for lo, hi, y0, y1 in ((BAND[0], split, 0.0, split), (split, ymax, split, ymax)):
        wall = band_mask(tris, grid, lo, hi)
        solid = fill_enclosed(wall, CLOSE_CELLS)
        rects, l, tot = fit_rects(solid, MAX_BOXES, pre=below)
        below = below + rects
        boxes += rect_boxes(rects, grid, None, solid, y0, y1)
        left += l
        total += tot
    return boxes, dict(coverage=round(1 - left / max(total, 1), 3), split=split)


def elevation_colliders(prims, scale, cell=0.05, max_boxes=4):
    """Wall pieces with an opening (doorway, wide doorway, open frame): decompose the FRONT-ELEVATION silhouette (x,y), so the
    opening stays free and the jambs / lintel become boxes. Thickness (z) = the piece's own."""
    tris = tri_world(prims, scale)
    xy = tris[:, :, [0, 1]]
    x0, y0 = xy[..., 0].min() - 2 * cell, xy[..., 1].min() - 2 * cell
    W = int(math.ceil((xy[..., 0].max() - x0) / cell)) + 3
    H = int(math.ceil((xy[..., 1].max() - y0) / cell)) + 3
    m = np.zeros((H, W), np.uint8)
    for t in xy:
        pts = np.round(np.stack([(t[:, 0] - x0) / cell, (t[:, 1] - y0) / cell], 1) * 16).astype(np.int32)
        cv2.fillConvexPoly(m, pts, 255, lineType=cv2.LINE_8, shift=4)
    solid = m > 0
    rects, cov = decompose(solid, max_boxes, 0.02)
    zlo, zhi = float(tris[..., 2].min()), float(tris[..., 2].max())
    zc = (zlo + zhi) / 2
    half = max((zhi - zlo) / 2, 0.06)
    boxes = []
    for r0, c0, r1, c1 in rects:
        boxes.append([round(x0 + c0 * cell, 3), round(max(y0 + r0 * cell, 0.0), 3), round(zc - half, 3),
                      round(x0 + c1 * cell, 3), round(y0 + r1 * cell, 3), round(zc + half, 3)])
    return boxes, dict(coverage=round(cov, 3), view="front elevation")


def make_colliders(c, prims):
    sc = c["scale"]
    info, dbg = {}, None
    if c["mode"] == "footprint":
        boxes, info, dbg = footprint_colliders(prims, sc)
        if not boxes:
            boxes, info = bbox_collider(prims, sc), {"fallback": "bbox"}
    elif c["mode"] == "pole":
        boxes = pole_colliders(prims, sc)
    elif c["mode"] == "bands":
        boxes, info = band_colliders(prims, sc)
    elif c["mode"] == "elevation":
        boxes, info = elevation_colliders(prims, sc)
    else:
        boxes = bbox_collider(prims, sc, 0.0)
    return boxes, info, dbg


# ───────────────────────────── palettes ─────────────────────────────
def save_png(im: Image.Image, dst: Path) -> int:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if im.mode == "RGBA" and np.asarray(im)[..., 3].min() == 255:
        im = im.convert("RGB")
    im.save(dst, optimize=True)
    return dst.stat().st_size


def recolor(im: Image.Image, cells) -> Image.Image:
    a = np.asarray(im.convert("RGB")).astype(np.float32) / 255.0
    for (x0, y0, x1, y1), rgb, _ in cells:
        cell = a[y0:y1, x0:x1]
        lum = cell @ np.array([0.2126, 0.7152, 0.0722], np.float32)
        ratio = lum / max(float(lum.mean()), 1e-4)
        a[y0:y1, x0:x1] = np.clip(np.array(rgb, np.float32)[None, None, :] / 255.0 * ratio[..., None], 0, 1)
    return Image.fromarray((a * 255 + 0.5).astype(np.uint8), "RGB")


def build_palettes(cat) -> dict:
    out = {}
    atlas_bytes = None
    for c in cat:
        if c["palette"] == "quaternius_atlas" and atlas_bytes is None:
            g = read_glb(c["src"])
            atlas_bytes = g.images[0]
    for key, p in PALETTES.items():
        if p["src"] is None:
            dst = OUT / p["file"]
            dst.parent.mkdir(parents=True, exist_ok=True)
            im = Image.open(__import__("io").BytesIO(atlas_bytes))
            size = save_png(im, dst)
            im_size = im.size
        else:
            dst = (OUT / p["file"]).resolve()
            im = Image.open(p["src"])
            size = save_png(im.copy(), dst)
            im_size = im.size
        out[key] = {"file": p["file"], "size_px": list(im_size), "bytes": size, "kit": p["kit"], "licence": "CC0",
                    "sampler": p["sampler"], "variants": {}}
        for vname, cells in VARIANTS.get(key, {}).items():
            vf = p["file"].replace(".png", f"_{vname}.png")
            vs = save_png(recolor(im.convert("RGB"), cells), (OUT / vf).resolve())
            out[key]["variants"][vname] = {"file": vf, "bytes": vs, "recolours": sorted({w for *_, w in cells})}
    return out


# ───────────────────────────── plotting ─────────────────────────────
def plot_group(group: str, items: list, path: Path) -> None:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    n = len(items)
    cols = min(5, n)
    rows = math.ceil(n / cols)
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3.6, rows * 3.7), squeeze=False)
    for ax in axes.flat:
        ax.axis("off")
    for ax, it in zip(axes.flat, items):
        ax.axis("on")
        dbg = it.get("dbg")
        if dbg:
            grid, wall, solid, top = dbg
            ext = [grid.x0, grid.x0 + grid.W * grid.cell, grid.z0 + grid.H * grid.cell, grid.z0]
            ax.imshow(top, extent=ext, cmap="bone", origin="upper", interpolation="nearest")
            ax.imshow(np.ma.masked_where(~solid, solid), extent=ext, cmap="Greens", alpha=0.35, origin="upper", interpolation="nearest")
            ax.imshow(np.ma.masked_where(wall == 0, wall), extent=ext, cmap="autumn", alpha=0.55, origin="upper", interpolation="nearest")
        else:
            from matplotlib.collections import PolyCollection
            tris = it["tris_world"]
            ax.set_facecolor("#223")
            ax.add_collection(PolyCollection(tris[:, :, [0, 2]], facecolors="#888", alpha=0.25, linewidths=0))
            ax.set_xlim(tris[..., 0].min() - 0.3, tris[..., 0].max() + 0.3)
            ax.set_ylim(tris[..., 2].max() + 0.3, tris[..., 2].min() - 0.3)
        for b in it["colliders"]:
            ax.add_patch(plt.Rectangle((b[0], b[2]), b[3] - b[0], b[5] - b[2], fill=False, ec="red", lw=1.6))
            ax.text((b[0] + b[3]) / 2, (b[2] + b[5]) / 2, "%.1f" % b[4], color="cyan", fontsize=6, ha="center", va="center")
        ax.set_aspect("equal")
        ax.set_title("%s  (%.1f x %.1f m)" % (it["name"].replace("building-", ""), it["size"][0], it["size"][2]), fontsize=7)
        ax.tick_params(labelsize=5)
    fig.suptitle("%s  - top view: grey = roof/height map, green = filled body footprint, orange = wall band, red = collider boxes (label = height m)" % group, fontsize=8)
    fig.tight_layout()
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(path, dpi=110)
    plt.close(fig)


def colliders_only(cat) -> int:
    """Recompute ONLY the colliders (boxes, mode, info) from the source models and rewrite them into the existing manifest. Nothing else is written
    (no GLB, palette or plot) and every other byte of the manifest is kept, so the output is a pure function of (source models, this file, the manifest)."""
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    types = manifest["types"]
    for c in cat:
        if c["id"] not in types:
            print("FAIL", c["id"], "is not in the existing manifest (run the full intake first)")
            return 1
        boxes, info, _ = make_colliders(c, clean_prims(read_glb(c["src"]), c))
        t = types[c["id"]]
        t["colliders"] = [{"min": b[:3], "max": b[3:]} for b in boxes]
        t["collider_mode"] = c["mode"]
        t["collider_info"] = info
        print("%-34s %-9s %d box%s %s" % (c["id"], c["mode"], len(boxes), "" if len(boxes) == 1 else "es", info))
    manifest["readme"] = README
    mpath.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print("\ncolliders ->", mpath, "(%d types, %d boxes)" % (len(types), sum(len(v["colliders"]) for v in types.values())))
    return 0


# ───────────────────────────── main ─────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="process only ids containing this substring")
    ap.add_argument("--scratch", default=str(DEFAULT_SCRATCH))
    ap.add_argument("--no-plots", action="store_true")
    ap.add_argument("--skip-pack", action="store_true", help="reuse the GLBs already on disk (collider / manifest iteration)")
    ap.add_argument("--out-root", default=None, help="write assets/props/{city,cars} under this directory instead of the game directory (reproducibility checks)")
    ap.add_argument("--colliders-only", action="store_true",
                    help="recompute ONLY colliders / collider_mode / collider_info from the source models and rewrite them into the existing manifest "
                         "(no GLB, palette or plot is written; every other byte of the manifest is kept)")
    args = ap.parse_args()
    global OUT, OUT_CARS
    if args.out_root:
        OUT = Path(args.out_root) / "assets" / "props" / "city"
        OUT_CARS = Path(args.out_root) / "assets" / "props" / "cars"
    scratch = Path(args.scratch)
    try:
        cli = cli_dir()
    except EnvError as e:
        print("ENV:", e)
        return 2
    if not SRC.exists():
        print("ENV: source missing", SRC)
        return 2
    cat = catalogue()
    if args.only:
        cat = [c for c in cat if args.only in c["id"]]
    if args.colliders_only:
        return colliders_only(cat)
    t0 = time.time()
    palettes = build_palettes(catalogue())
    types = {}
    plots: dict[str, list] = {}
    bad = 0
    for c in cat:
        g = read_glb(c["src"])
        prims = clean_prims(g, c)
        uvs = [p.uv for p in prims if p.uv is not None]
        uvq = bool(uvs) and all(float(u.min()) >= 0.0 and float(u.max()) <= 1.0 for u in uvs)
        if c["palette"] and not uvs:
            print("FAIL", c["id"], "palette type without UVs")
            bad += 1
            continue
        mats = materials_for(c, g)
        cdir = scratch / "clean" / c["group"]
        cdir.mkdir(parents=True, exist_ok=True)
        clean = cdir / f"{c['name']}.glb"
        write_glb(clean, prims, mats, c["name"])
        c["out"].parent.mkdir(parents=True, exist_ok=True)
        if not (args.skip_pack and c["out"].exists()):
            run_pack(cli, clean, c["out"], uvq)
            if clean.stat().st_size <= 0.9 * c["out"].stat().st_size:      # tiny files: the meshopt JSON overhead outweighs it
                shutil.copyfile(clean, c["out"])
        st = glb_stats(c["out"])
        compression = "meshopt" if "EXT_meshopt_compression" in st["ext_used"] else "none"
        src_tris = sum(len(p.idx) for p in prims)
        if abs(st["tris"] - src_tris) > max(2, 0.02 * src_tris):
            print("FAIL", c["id"], "tris", src_tris, "->", st["tris"])
            bad += 1
        sc = c["scale"]
        lo = np.array(st["bbox_min"]) * sc
        hi = np.array(st["bbox_max"]) * sc
        boxes, info, dbg = make_colliders(c, prims)
        rel = os.path.relpath(c["out"], OUT).replace("\\", "/")
        types[c["id"]] = {
            "file": rel, "group": c["group"], "kind": c["kind"], "role": c["role"], "palette": c["palette"], "tris": st["tris"],
            "verts": st["verts"], "bytes": c["out"].stat().st_size, "src_bytes": c["src"].stat().st_size,
            "suggested_scale": sc, "bbox_m": {"x": round(float(hi[0] - lo[0]), 3), "y": round(float(hi[1] - lo[1]), 3), "z": round(float(hi[2] - lo[2]), 3)},
            "bbox_min_m": [round(float(v), 3) for v in lo], "bbox_max_m": [round(float(v), 3) for v in hi],
            "compression": compression, "front": "+Z", "double_sided": bool(mats[0].get("doubleSided", False)), "materials": len(mats), "uv": bool(uvs),
            "colliders": [{"min": b[:3], "max": b[3:]} for b in boxes], "collider_mode": c["mode"],
            "collider_info": info,
        }
        plots.setdefault(c["group"], []).append(dict(name=c["name"], size=hi - lo, colliders=boxes, dbg=dbg,
                                                     tris_world=tri_world(prims, sc) if dbg is None else None))
        print("%-34s tris %5d  %7d B (src %7d B, %.2fx)  %5.1f x %5.1f x %5.1f m  colliders %d %s" % (
            c["id"], st["tris"], c["out"].stat().st_size, c["src"].stat().st_size, c["out"].stat().st_size / c["src"].stat().st_size,
            *(hi - lo), len(boxes), info.get("coverage", "")))
    if not args.no_plots:
        for grp, items in plots.items():
            plot_group(grp, items, scratch / "plots" / f"colliders_{grp}.png")
    # manifest (merge with an existing one when --only was used)
    mpath = OUT / "manifest.json"
    manifest = {}
    if args.only and mpath.exists():
        manifest = json.loads(mpath.read_text(encoding="utf-8"))
    old_types = manifest.get("types", {})
    old_types.update(types)
    order = ["suburban", "commercial", "skyscraper", "lowdetail", "props", "cars", "furniture", "walls"]
    sorted_types = dict(sorted(old_types.items(), key=lambda kv: (order.index(kv[1]["group"]), kv[0])))
    totals = {}
    for k, v in sorted_types.items():
        t = totals.setdefault(v["group"], {"files": 0, "tris": 0, "bytes": 0, "src_bytes": 0})
        t["files"] += 1
        t["tris"] += v["tris"]
        t["bytes"] += v["bytes"]
        t["src_bytes"] += v["src_bytes"]
    manifest = {
        "version": 1,
        "generated_by": "games/last-circle/_tools/art_b_city.py",
        "licence": "CC0 throughout: Kenney City Kit Suburban / Commercial / Roads, Car Kit, Furniture Kit, Graveyard Kit; Quaternius props (Poly Pizza). See CREDITS.md.",
        "readme": README,
        "districts": {
            "downtown": [k for k in sorted_types if k.startswith("skyscraper/")] + ["commercial/building-i", "commercial/building-m", "commercial/building-f", "commercial/building-a", "commercial/building-h"],
            "suburb": [k for k in sorted_types if k.startswith("suburban/")],
            "warehouse_yard": ["commercial/building-e", "props/shipping-container", "props/crate-yard", "props/dumpster", "props/barrier-traffic", "props/construction-barrier"],
            "far_skyline": [k for k in sorted_types if k.startswith("lowdetail/")],
            "street": ["props/light-curved", "props/light-curved-double", "props/light-square", "props/hydrant", "props/grave-bench", "props/cone-traffic", "props/planter", "props/fence-suburban", "props/box-crate"],
            "parking": [k for k in sorted_types if k.startswith("cars/")],
            "interior_kit": [k for k in sorted_types if k.startswith("walls/") or k.startswith("furniture/")],
        },
        "palettes": palettes,
        "totals": totals,
        "types": sorted_types,
    }
    manifest["districts"] = {d: [k for k in ks if k in sorted_types] for d, ks in manifest["districts"].items()}
    mpath.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print("\nmanifest ->", mpath, "(%d types)" % len(sorted_types), " %.1f s" % (time.time() - t0))
    for grp, t in totals.items():
        print("  %-11s %2d files  %6d tris  %8d B  (source %8d B)" % (grp, t["files"], t["tris"], t["bytes"], t["src_bytes"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
