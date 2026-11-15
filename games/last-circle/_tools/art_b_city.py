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

THEMES  (Wave 7b, lane B3) The town themes resort (Isla Viva) and lodge (Deepwood) have their own recoloured colormaps: THEME_VARIANTS below names six colourways each (resort: coral, mint,
        lagoon, sun, shell, rose; lodge: pine, cedar, walnut, driftwood, forest, barn). A colourway recolours four swatches of the suburban AND the commercial colormap (SWATCH_USE: wall,
        roof, trim, door / ground-floor base; each keeps its own light -> dark ramp), the lodge ones also paint horizontal boards into the wall swatch (SIDING_PX). Output:
        palettes/<key>_<variant>.png (PNG-8, exact colours: ~11 KB suburban, ~3 KB commercial), manifest `palettes[key].variants.<variant>` (+ `theme`), `themes` (variants, colours, types per
        role: THEME_TYPE_LISTS) and `swatch_use`. The four shipped variants (slate / brick / sand + base) are untouched, byte for byte. runtime/3d/royale/citykit.js keeps literal copies of the
        theme tables (VARIANT_ORDER, PROXY_COLORS_X, THEMES, THEME_TYPES): --emit-theme-tables FILE writes exactly those blocks; citykit.selftest.cjs and _harness/themeshots.py compare them.

USAGE   python games/last-circle/_tools/art_b_city.py [--only SUBSTR] [--scratch DIR] [--no-plots] [--skip-pack] [--out-root DIR] [--colliders-only] [--palettes-only] [--emit-theme-tables FILE]
          --colliders-only   recompute only the colliders / collider_mode / collider_info (+ the manifest readme) into the existing manifest: ~1 min, no GLB, palette or
                             plot is written, every other byte of the manifest is kept. The full run and this one write the SAME manifest bytes (checked 2026-10-14).
          --palettes-only    regenerate ONLY the palette PNGs and the manifest's palettes / themes / swatch_use / readme blocks (~10 s, no GLB is written, every other manifest byte is kept)
          --emit-theme-tables FILE   (with --palettes-only) the literal citykit.js blocks for the theme variants (VARIANT_ORDER, PROXY_COLORS_X, THEMES, THEME_TYPES entries)
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

# ── Wave 7b (lane B3): the town THEMES' own colourways ───────────────────────────────────────────────────────────────────────────────────────────────────────────
# What a swatch of the two colormaps is (measured 2026-10-15: a debug colormap with one flat colour per swatch rendered on every suburban + commercial type, then the UV area
# of every swatch per type). Swatch = 64 x 128 px, (col, row) under the 128 px black band, a light (top) -> dark (bottom) ramp; u is constant per triangle and v runs 13..102 px
# over ONE storey face (35.6 px per metre on the suburban kit, 21.3 on the commercial kit), so a stripe pattern along v is horizontal siding on every storey of every wall.
#   wall (3,1)   the white facades                                   trim (0,1)   window frames, cornice / storey bands, gutters + drain pipes, chimneys, porch posts, sills
#   roof (0,0)   the green pitched roof planes                       door (1,1)   suburban: the front door (and carport / garage door)
#   base (1,1)   commercial: the dark ground-floor band and flat roof decks (the same swatch as the suburban door)
# The other swatches in use (bushes (1,2), window glass (5,0), soil tops (4,1)) stay as authored in every colourway.
SWATCH_USE = {
    "suburban": {"wall": (3, 1), "roof": (0, 0), "trim": (0, 1), "door": (1, 1)},
    "commercial": {"wall": (3, 1), "roof": (0, 0), "trim": (0, 1), "base": (1, 1)},
}
SIDING_PX = {"suburban": 9, "commercial": 6}      # plank pitch in swatch rows (~0.25 m of wall: 9 / 35.6 px per metre, 6 / 21.3)


def swatch_box(cell):
    c, r = cell
    return (c * 64, 128 + r * 128, c * 64 + 64, 128 + r * 128 + 128)


# Colours are the MID tone of each swatch (sRGB); the swatch keeps its own light -> dark ramp (recolor(): luminance ratio of the cell). `siding` paints horizontal boards into the
# wall swatch: (gap depth, board-to-board jitter). resort = Isla Viva (pastel stucco, white trim, terracotta / teal / blue / silver roofs, bright doors); lodge = Deepwood (stained
# timber walls, dark trim, dark green / brown / red-brown / slate roofs, painted red and green outbuildings).
THEME_VARIANTS = {
    "resort": {
        "coral":  dict(wall=(247, 170, 148), trim=(255, 247, 238), door=(24, 140, 152), base=(24, 132, 144), roof=(192, 88, 62)),
        "mint":   dict(wall=(170, 226, 204), trim=(255, 255, 252), door=(238, 118, 96), base=(238, 122, 100), roof=(34, 128, 140)),
        "lagoon": dict(wall=(144, 212, 228), trim=(255, 255, 255), door=(250, 204, 88), base=(248, 200, 92), roof=(46, 96, 168)),
        "sun":    dict(wall=(252, 228, 152), trim=(255, 251, 240), door=(30, 148, 160), base=(30, 140, 152), roof=(220, 110, 60)),
        "shell":  dict(wall=(250, 244, 232), trim=(98, 178, 198), door=(232, 104, 88), base=(98, 178, 198), roof=(200, 206, 212)),
        "rose":   dict(wall=(240, 170, 186), trim=(255, 250, 246), door=(40, 150, 150), base=(40, 140, 142), roof=(180, 74, 58)),
    },
    "lodge": {
        "pine":      dict(wall=(188, 140, 86), trim=(74, 50, 34), door=(118, 38, 32), base=(88, 60, 40), roof=(58, 98, 76), siding=(0.30, 0.05)),
        "cedar":     dict(wall=(150, 84, 58), trim=(58, 40, 30), door=(40, 78, 62), base=(70, 44, 32), roof=(92, 64, 50), siding=(0.30, 0.05)),
        "walnut":    dict(wall=(116, 80, 56), trim=(74, 54, 40), door=(160, 108, 60), base=(66, 48, 36), roof=(142, 64, 50), siding=(0.32, 0.05)),
        "driftwood": dict(wall=(156, 146, 128), trim=(80, 68, 56), door=(112, 42, 36), base=(96, 86, 74), roof=(80, 88, 100), siding=(0.28, 0.05)),
        "forest":    dict(wall=(74, 108, 84), trim=(232, 224, 204), door=(152, 60, 44), base=(60, 86, 68), roof=(98, 70, 54), siding=(0.18, 0.03)),
        "barn":      dict(wall=(156, 58, 46), trim=(238, 230, 212), door=(58, 44, 36), base=(110, 44, 36), roof=(76, 82, 88), siding=(0.18, 0.03)),
    },
}
# the colormap files these add: palettes/<key>_<variant>.png for every key in SWATCH_USE x every variant above (manifest palettes[key].variants[<variant>])
THEME_TINT = {"resort": 0xffffff, "lodge": 0xffffff}     # the colours are baked into the variants: no tint on top (a tint multiplies in linear light and only darkens)
# Types per role (the manifest's `role` field decides the role of a type; citykit.selftest checks it). resort strips are low-rise: bungalows and flat-roofed villas, one low shop,
# hotel blocks of 15 m; a lodge village is steep-gabled houses, one shop and a hall: no mid-rise, no tower, no skyline silhouette in either.
THEME_TYPE_LISTS = {
    "resort": {
        "house": ["suburban/building-type-g", "suburban/building-type-h", "suburban/building-type-i", "suburban/building-type-m", "suburban/building-type-p", "suburban/building-type-q"],
        "shop": ["commercial/building-c"],
        "midrise": ["commercial/building-a", "commercial/building-h"],
    },
    "lodge": {
        "house": ["suburban/building-type-a", "suburban/building-type-c", "suburban/building-type-e", "suburban/building-type-o"],
        "shop": ["commercial/building-c"],
        "warehouse": ["commercial/building-e"],
    },
}
THEME_CHARACTER = {
    "resort": "Isla Viva: pastel stucco walls (coral, mint, lagoon, sun, shell, rose), white or sea-blue trim, terracotta / teal / blue / silver roofs, bright doors, low-rise",
    "lodge": "Deepwood: stained timber walls with horizontal boards (pine, cedar, walnut, driftwood), painted forest-green and barn-red outbuildings, dark trim, dark roofs, steep gables, no mid-rise",
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
        "Theme colourways (Wave 7b): variants whose `theme` is resort (coral, mint, lagoon, sun, shell, rose) or lodge (pine, cedar, walnut, driftwood, forest, barn) recolour the roof, wall, trim and door / ground-floor swatches (swatch_use) and, for the lodge, paint horizontal boards into the wall swatch; `themes` lists each theme's variants, colours and types per role.",
        "Cars have no roof palette variants (no roofs); front = +Z; collider boxes in two layers (body up to the beltline, cabin above it).",
        "The suburban and commercial kits both name their texture Textures/colormap.png but the two colormaps DIFFER: never share one THREE.Texture between them (one shared Texture per palette key).",
        "districts: suggested type lists for the Savanna pilot (downtown, suburb, warehouse_yard, far_skyline, street, parking, interior_kit).",
]

KIT_SCALE = 2.2   # furniture + walls share one grid: a 1.0 wall module = 2.2 m

# ── Wave 8 stage A (lane H2): the INTERIOR KIT ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
# More furniture for furnished, lootable rooms (bedroom, bathroom, kitchen, living, dining, office, shop, storage) + stairs and a cover-rule window wall, through the SAME
# intake (meshopt, 0.5 mm snap, per-type colliders, manifest rows). Sources, both on disk, both CC0 (CREDITS rows in the lane report):
#   KIT_SRC   the full Kenney Furniture Kit 2.0 (140 GLBs; License.txt "Creative Commons Zero, CC0"); the 32 pieces shipped since Wave 4 are byte-identical copies of these files
#   QUAT_SRC  Quaternius pieces from Poly Pizza (CC0 1.0 per F:/AssetLibrary/polypizza/_manifest.json): Shelf Tall TDgvIuorcX, Shelf Large 3FmjkLClVE, Pallet MwOFAOgOhg
#             (the pallet's embedded atlas is byte-identical to palettes/quaternius_atlas.png, so it costs no new palette)
# Rows go to manifest_interior.json (same row schema as manifest.json) while INTERIOR_IN_MAIN is False: the shipped gates (kitcollide.py, citykit.selftest.cjs, citykit_probe.py) assert
# EXACTLY 81 types in manifest.json, and the 7b fix round runs them while stage A is built. Stage B sets INTERIOR_IN_MAIN = True (or passes --interior-into-main), regenerates
# citykit.js COLLIDER_BOXES (citykit.selftest.cjs --emit-table) and raises those counts to 81 + len(INTERIOR); manifest_interior.json then keeps only the `catalogue`.
# Wave 8 stage A2 (lane H5, kit merge): MERGED. INTERIOR_IN_MAIN = True, so a plain run of this file reproduces the merged tree (136 types in manifest.json, the catalogue alone in
# manifest_interior.json); citykit.js COLLIDER_BOXES was re-emitted from it and citykit.selftest.cjs counts 136. citykit only fetches the GLBs of the types a place() list draws,
# so the 55 new types cost a map nothing until it places them (the manifest JSON grows; no GLB is requested).
KIT_SRC = Path("F:/3d-asset-packs/kenney_furniture-kit/Models/GLTF format")
QUAT_SRC = Path("F:/AssetLibrary/polypizza/furniture")
INTERIOR_IN_MAIN = True
WINDOW_PORT_Y = [(0.0, 0.0), (0.755, 0.983), (0.864, 1.092), (0.972, 1.20), (2.217, 2.30), (2.325, 2.408), (2.434, 2.517), (2.837, 2.837)]
# ^ wallWindowPort: Kenney wallWindow (sill 0.864 / opening 0.972-2.217 m at 2.2) re-authored to the game's window cover rule (maps.js house(): solid to the 1.20 m sill - standing
#   eye 1.62 clears it, crouched eye 0.97 does not - and the header from 2.30 m): every vertex sits on one of these knots (metres at KIT_SCALE), mapped piecewise-linearly in y;
#   the glass panes are dropped (an open firing port, like house()'s), so the elevation colliders leave exactly the 1.20-2.30 m aperture free.
# name, group, source file, scale, collider mode, rooms, use, place (floor | wall | ceiling | surface), extra options
#   place: floor = stands on the floor; wall = hung on a wall (mount height is the placer's: the model's y = 0 is its own bottom); ceiling = hangs from the ceiling (y = 0 at
#   its bottom: put y = ceiling - bbox height); surface = on a table / counter / cabinet top (y = that top). Colliders are the real extents at the placed height in every case.
_K, _Q = KIT_SRC, QUAT_SRC
INTERIOR = [
    # bedroom
    ("bedSingle", "furniture", _K / "bedSingle.glb", KIT_SCALE, "bbox", ["bedroom"], "bed", "floor", {}),
    ("bedDouble", "furniture", _K / "bedDouble.glb", KIT_SCALE, "bbox", ["bedroom"], "bed", "floor", {}),
    ("cabinetBed", "furniture", _K / "cabinetBed.glb", KIT_SCALE, "bbox", ["bedroom"], "nightstand", "floor", {}),
    ("cabinetBedDrawer", "furniture", _K / "cabinetBedDrawer.glb", KIT_SCALE, "bbox", ["bedroom"], "nightstand", "floor", {}),
    ("bookcaseClosedDoors", "furniture", _K / "bookcaseClosedDoors.glb", KIT_SCALE, "bbox", ["bedroom", "office"], "wardrobe", "floor", {}),
    ("sideTableDrawers", "furniture", _K / "sideTableDrawers.glb", KIT_SCALE, "bbox", ["bedroom", "living"], "dresser", "floor", {}),
    ("coatRackStanding", "furniture", _K / "coatRackStanding.glb", KIT_SCALE, "footprint", ["bedroom", "hall"], "coat_rack", "floor", {}),
    # lighting
    ("lampRoundFloor", "furniture", _K / "lampRoundFloor.glb", KIT_SCALE, "footprint", ["living", "bedroom", "office"], "floor_lamp", "floor", {}),
    ("lampSquareFloor", "furniture", _K / "lampSquareFloor.glb", KIT_SCALE, "footprint", ["living", "bedroom"], "floor_lamp", "floor", {}),
    ("lampSquareTable", "furniture", _K / "lampSquareTable.glb", KIT_SCALE, "bbox", ["bedroom", "living", "office"], "table_lamp", "surface", {}),
    ("lampSquareCeiling", "furniture", _K / "lampSquareCeiling.glb", KIT_SCALE, "bbox", ["any"], "ceiling_lamp", "ceiling", {}),
    ("lampWall", "furniture", _K / "lampWall.glb", KIT_SCALE, "bbox", ["any"], "wall_lamp", "wall", {}),
    # rugs (flat: nothing at body height, no collider)
    ("rugRectangle", "furniture", _K / "rugRectangle.glb", KIT_SCALE, "none", ["living", "bedroom", "dining"], "rug", "floor", {}),
    ("rugSquare", "furniture", _K / "rugSquare.glb", KIT_SCALE, "none", ["living", "bedroom", "office"], "rug", "floor", {}),
    ("rugRound", "furniture", _K / "rugRound.glb", KIT_SCALE, "none", ["living", "bedroom", "dining"], "rug", "floor", {}),
    # bathroom
    ("toilet", "furniture", _K / "toilet.glb", KIT_SCALE, "bbox", ["bathroom"], "toilet", "floor", {}),
    ("bathtub", "furniture", _K / "bathtub.glb", KIT_SCALE, "bbox", ["bathroom"], "bathtub", "floor", {}),
    ("bathroomSinkSquare", "furniture", _K / "bathroomSinkSquare.glb", KIT_SCALE, "bbox", ["bathroom"], "basin", "floor", {}),
    ("bathroomCabinet", "furniture", _K / "bathroomCabinet.glb", KIT_SCALE, "bbox", ["bathroom"], "wall_cabinet", "wall", {}),
    # kitchen
    ("kitchenCabinet", "furniture", _K / "kitchenCabinet.glb", KIT_SCALE, "bbox", ["kitchen"], "base_cabinet", "floor", {}),
    ("kitchenCabinetDrawer", "furniture", _K / "kitchenCabinetDrawer.glb", KIT_SCALE, "bbox", ["kitchen"], "base_cabinet", "floor", {}),
    ("kitchenCabinetCornerInner", "furniture", _K / "kitchenCabinetCornerInner.glb", KIT_SCALE, "bbox", ["kitchen"], "base_cabinet_corner", "floor", {}),
    ("kitchenCabinetUpper", "furniture", _K / "kitchenCabinetUpper.glb", KIT_SCALE, "bbox", ["kitchen"], "wall_cabinet", "wall", {}),
    ("kitchenStoveElectric", "furniture", _K / "kitchenStoveElectric.glb", KIT_SCALE, "bbox", ["kitchen"], "stove", "floor", {}),
    ("kitchenMicrowave", "furniture", _K / "kitchenMicrowave.glb", KIT_SCALE, "bbox", ["kitchen"], "appliance", "surface", {}),
    ("hoodModern", "furniture", _K / "hoodModern.glb", KIT_SCALE, "footprint", ["kitchen"], "cooker_hood", "wall", {}),
    ("dryer", "furniture", _K / "dryer.glb", KIT_SCALE, "bbox", ["kitchen", "bathroom", "storage"], "laundry", "floor", {}),
    # living
    ("loungeChair", "furniture", _K / "loungeChair.glb", KIT_SCALE, "bbox", ["living"], "armchair", "floor", {}),
    ("loungeSofaCorner", "furniture", _K / "loungeSofaCorner.glb", KIT_SCALE, "footprint", ["living"], "sofa_corner", "floor", {}),
    ("loungeSofaLong", "furniture", _K / "loungeSofaLong.glb", KIT_SCALE, "footprint", ["living"], "sofa_chaise", "floor", {}),
    ("loungeSofaOttoman", "furniture", _K / "loungeSofaOttoman.glb", KIT_SCALE, "bbox", ["living"], "ottoman", "floor", {}),
    ("loungeDesignSofa", "furniture", _K / "loungeDesignSofa.glb", KIT_SCALE, "bbox", ["living"], "sofa", "floor", {}),
    ("tableCoffeeSquare", "furniture", _K / "tableCoffeeSquare.glb", KIT_SCALE, "bbox", ["living"], "coffee_table", "floor", {}),
    ("televisionModern", "furniture", _K / "televisionModern.glb", KIT_SCALE, "bbox", ["living", "bedroom"], "tv", "surface", {}),
    ("bookcaseOpen", "furniture", _K / "bookcaseOpen.glb", KIT_SCALE, "bbox", ["living", "office", "shop", "storage"], "shelf", "floor", {}),
    ("bookcaseOpenLow", "furniture", _K / "bookcaseOpenLow.glb", KIT_SCALE, "bbox", ["living", "office", "shop"], "shelf_low", "floor", {}),
    ("books", "furniture", _K / "books.glb", KIT_SCALE, "bbox", ["living", "office", "bedroom"], "decor", "surface", {}),
    ("plantSmall1", "furniture", _K / "plantSmall1.glb", KIT_SCALE, "bbox", ["any"], "decor", "surface", {}),
    # dining
    ("tableCross", "furniture", _K / "tableCross.glb", KIT_SCALE, "bbox", ["dining", "kitchen"], "dining_table", "floor", {}),
    ("tableRound", "furniture", _K / "tableRound.glb", KIT_SCALE, "footprint", ["dining", "kitchen", "office"], "dining_table", "floor", {}),
    ("tableCloth", "furniture", _K / "tableCloth.glb", KIT_SCALE, "bbox", ["dining"], "dining_table", "floor", {}),
    ("chairCushion", "furniture", _K / "chairCushion.glb", KIT_SCALE, "bbox", ["dining", "kitchen"], "dining_chair", "floor", {}),
    ("chairModernCushion", "furniture", _K / "chairModernCushion.glb", KIT_SCALE, "bbox", ["dining", "office"], "dining_chair", "floor", {}),
    # office
    ("deskCorner", "furniture", _K / "deskCorner.glb", KIT_SCALE, "footprint", ["office"], "desk_corner", "floor", {}),
    ("computerScreen", "furniture", _K / "computerScreen.glb", KIT_SCALE, "bbox", ["office"], "computer", "surface", {}),
    ("bookcaseClosedWide", "furniture", _K / "bookcaseClosedWide.glb", KIT_SCALE, "bbox", ["office", "living", "storage"], "shelf_wide", "floor", {}),
    # shop
    ("kitchenBar", "furniture", _K / "kitchenBar.glb", KIT_SCALE, "bbox", ["shop", "kitchen"], "counter", "floor", {}),
    ("kitchenBarEnd", "furniture", _K / "kitchenBarEnd.glb", KIT_SCALE, "bbox", ["shop", "kitchen"], "counter_end", "floor", {}),
    ("shelfTall", "furniture", _Q / "TDgvIuorcX.glb", 0.64, "bbox", ["shop", "storage"], "gondola_shelf", "floor", {"credit": "Shelf Tall by Quaternius, https://poly.pizza/m/TDgvIuorcX (CC0 1.0)"}),
    ("shelfLarge", "furniture", _Q / "3FmjkLClVE.glb", 0.45, "footprint", ["shop", "storage", "office"], "storage_rack", "floor", {"credit": "Shelf Large by Quaternius, https://poly.pizza/m/3FmjkLClVE (CC0 1.0)"}),
    # storage
    ("cardboardBoxOpen", "furniture", _K / "cardboardBoxOpen.glb", KIT_SCALE, "bbox", ["storage", "shop", "any"], "box", "floor", {}),
    ("pallet", "furniture", _Q / "MwOFAOgOhg.glb", 1.0, "none", ["storage", "shop"], "pallet", "floor", {"palette": "quaternius_atlas", "credit": "Pallet by Quaternius, https://poly.pizza/m/MwOFAOgOhg (CC0 1.0)"}),
    # walls: stairs (one storey) + the cover-rule window wall
    ("stairs", "walls", _K / "stairs.glb", KIT_SCALE, "steps", ["any"], "stairs", "floor", {}),
    ("stairsCorner", "walls", _K / "stairsCorner.glb", KIT_SCALE, "steps", ["any"], "stairs_corner", "floor", {}),
    ("wallWindowPort", "walls", _K / "wallWindow.glb", KIT_SCALE, "elevation", ["any"], "window_wall", "floor", {"remap_y": WINDOW_PORT_Y, "drop_mats": ["glass"]}),
]
# Looked at and left out: laptop and bathroomMirror (at body height only a thin screen / mirror plate stands over a flat base, so neither one box nor a band fit passes both
# kitcollide's phantom bar and citykit.selftest's body-cover rule), bedBunk / shower / showerRound / washer / washerDryerStacked / stairsOpen (580-992 triangles), the Quaternius
# counters (a dark-wood medieval look that clashes with the Kenney kit), the open-tread stairs (a hide space under the flight). Railing: walls/paneling (1.31 m half wall).
# The 32 pieces shipped since Wave 4 (manifest.json rows unchanged): their room / use / place for the catalogue of manifest_interior.json
INTERIOR_SHIPPED = {
    "furniture/bookcaseClosed": (["living", "office"], "bookcase", "floor"), "furniture/cabinetTelevision": (["living", "bedroom"], "tv_cabinet", "floor"),
    "furniture/cardboardBoxClosed": (["storage", "shop", "any"], "box", "floor"), "furniture/chair": (["dining", "kitchen", "office"], "dining_chair", "floor"),
    "furniture/chairDesk": (["office"], "desk_chair", "floor"), "furniture/desk": (["office", "bedroom"], "desk", "floor"),
    "furniture/kitchenFridge": (["kitchen"], "fridge", "floor"), "furniture/kitchenSink": (["kitchen"], "sink_cabinet", "floor"),
    "furniture/kitchenStove": (["kitchen"], "stove", "floor"), "furniture/loungeSofa": (["living"], "sofa", "floor"),
    "furniture/pottedPlant": (["any"], "plant", "floor"), "furniture/sideTable": (["living", "bedroom", "hall"], "side_table", "floor"),
    "furniture/stoolBar": (["kitchen", "shop"], "bar_stool", "floor"), "furniture/table": (["dining", "kitchen"], "dining_table", "floor"),
    "furniture/tableCoffee": (["living"], "coffee_table", "floor"), "furniture/trashcan": (["any"], "trashcan", "floor"),
    "walls/doorway": (["any"], "door_frame", "floor"), "walls/doorwayFront": (["any"], "door_frame_front", "floor"), "walls/doorwayOpen": (["any"], "door_frame_open", "floor"),
    "walls/floorCorner": (["any"], "floor_corner", "floor"), "walls/floorCornerRound": (["any"], "floor_corner_round", "floor"), "walls/floorFull": (["any"], "floor", "floor"),
    "walls/floorHalf": (["any"], "floor_half", "floor"), "walls/paneling": (["any"], "half_wall_railing", "floor"), "walls/wall": (["any"], "wall", "floor"),
    "walls/wallCorner": (["any"], "wall_corner", "floor"), "walls/wallCornerRond": (["any"], "wall_corner_round", "floor"), "walls/wallDoorway": (["any"], "wall_door", "floor"),
    "walls/wallDoorwayWide": (["any"], "wall_door_wide", "floor"), "walls/wallHalf": (["any"], "wall_half", "floor"), "walls/wallWindow": (["any"], "window_wall_glazed", "floor"),
    "walls/wallWindowSlide": (["any"], "window_wall_glazed", "floor"),
}
README_INTERIOR = [
    "Wave 8 stage A (lane H2) interior kit: furniture + walls rows in the SAME schema as manifest.json (`types`), generated by art_b_city.py with the shipped kit. Stage B merges them into manifest.json (INTERIOR_IN_MAIN / --interior-into-main).",
    "catalogue: every interior piece (the 32 shipped since Wave 4 + the new ones): rooms, use, place (floor | wall | ceiling | surface), collide (solid = boxes at its real extents; none = nothing drawn at body height, e.g. rugs and pallets), new (true = a row of this file).",
    "Kenney pieces: suggested_scale 2.2, origin at a CORNER of the piece (x 0..w, z -d..0, front +Z), so place them by bbox_min_m / bbox_max_m. Storey = wall 2.837 m + floor slab 0.11 m = 2.947 m = one stairs flight (11 risers of 0.268 m: the mover's 0.55 m step climbs them).",
    "Collider modes: bbox (one box, the real extents), footprint (the drawn body-band solid covered by a few boxes: L-shaped sofas / desks, lamps on a thin stand), elevation (front-elevation decomposition: the window aperture stays free), steps (stairs: one box per tread, ground to tread top), none.",
    "walls/wallWindowPort = Kenney wallWindow re-authored to the game's window cover rule: solid to the 1.20 m sill, open 1.20-2.30 m (no glass), header above (art_b_city.py WINDOW_PORT_Y).",
]


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
    for n, g, src, sc, mode, rooms, use, place, opt in INTERIOR:              # Wave 8 stage A: the interior kit (rows -> manifest_interior.json unless INTERIOR_IN_MAIN)
        cat.append(dict(group=g, src=src, name=n, palette=opt.get("palette"), scale=sc, role="furniture" if g == "furniture" else "wall", mode=mode,
                        out=OUT / g / f"{n}.glb", kind="furniture" if g == "furniture" else "wall", interior=True, rooms=rooms, use=use, place=place,
                        remap_y=opt.get("remap_y"), drop_mats=opt.get("drop_mats"), credit=opt.get("credit"), yaw_q=opt.get("yaw_q", 0), center=(g == "furniture")))
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
    if c.get("drop_mats"):                     # Wave 8: e.g. the glass panes of wallWindowPort (an open firing port)
        names = [m.get("name", "") for m in g.json.get("materials", [])]
        prims = [p for p in prims if names[p.mat] not in c["drop_mats"]]
    if c.get("remap_y"):                       # Wave 8: re-author heights (piecewise-linear knots in metres at the suggested scale; every source vertex sits on a knot)
        ky = np.array([a for a, _ in c["remap_y"]], np.float64)
        vy = np.array([b for _, b in c["remap_y"]], np.float64)
        out = []
        for p in prims:
            y = p.pos[:, 1].astype(np.float64) * c["scale"]
            if np.abs(y[:, None] - ky[None, :]).min(1).max() > 0.002:
                raise RuntimeError("%s: a vertex at y %.3f m is not on a remap_y knot" % (c["name"], float(y[np.abs(y[:, None] - ky[None, :]).min(1).argmax()])))
            pos = p.pos.copy()
            pos[:, 1] = (np.interp(y, ky, vy) / c["scale"]).astype(np.float32)
            out.append(Prim(pos, p.nrm, p.uv, p.idx, p.mat, p.node))
        prims = out
    if c.get("yaw_q"):                         # Wave 8: quarter-turn the source about +Y so the piece's front faces +Z (x' = c x + s z, z' = -s x + c z, the citykit turn)
        q = c["yaw_q"] % 4
        cs, sn = [(1, 0), (0, 1), (-1, 0), (0, -1)][q]
        rot = lambda a: np.stack([cs * a[:, 0] + sn * a[:, 2], a[:, 1], -sn * a[:, 0] + cs * a[:, 2]], 1).astype(np.float32)
        prims = [Prim(rot(p.pos), rot(p.nrm), p.uv, p.idx, p.mat, p.node) for p in prims]
    if c.get("center"):                        # Wave 8 interior furniture: origin = footprint centre at the bottom (the contract of this file; the Kenney sources sit anywhere in the kit's scene)
        P = np.concatenate([p.pos for p in prims]).astype(np.float64)
        lo, hi = P.min(0), P.max(0)
        sh = np.array([-(lo[0] + hi[0]) / 2, -lo[1], -(lo[2] + hi[2]) / 2])
        prims = [Prim((p.pos.astype(np.float64) + sh).astype(np.float32), p.nrm, p.uv, p.idx, p.mat, p.node) for p in prims]
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


def elevation_colliders(prims, scale, cell=0.05, max_boxes=4, snap=False):
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
    if snap:                                   # Wave 8 interior pieces only (the shipped elevation types keep their Wave 4 boxes byte for byte)
        boxes = snap_boxes(boxes, tris)
    return boxes, dict(coverage=round(cov, 3), view="front elevation")


def steps_colliders(prims, scale, max_boxes=MAX_BOXES):
    """Stairs (Wave 8): one box per tread, from the ground to the tread top, so a flight is a staircase of axis-aligned boxes the mover climbs riser by riser (Kenney: 0.268 m, under
    its 0.55 m step) and nothing is open underneath (no hide area under a flight). The tread map = the top view of the UPWARD faces only (normal.y > 0.7: risers, nosing undersides
    and the bottom are left out), each cell holding the height of the highest one; cells of one tread height are covered by maximal rectangles (exact: a tread is a rectangle, the
    corner flight's landing a square)."""
    tris = tri_world(prims, scale)
    n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    ny = n[:, 1] / np.maximum(np.linalg.norm(n, axis=1), 1e-12)
    up = tris[ny > 0.7]
    grid = Grid(tris, CELL, margin=4)
    top = np.zeros((grid.H, grid.W), np.float32)
    for t in up[np.argsort(up[:, :, 1].max(1), kind="stable")]:
        pts = grid.pts(t[:, [0, 2]])
        cv2.fillConvexPoly(top, pts, float(t[:, 1].max()), lineType=cv2.LINE_8, shift=4)     # fill only (no outline): a tread does not bleed one cell past its edge
    lv = np.round(top / 0.005).astype(np.int32)
    boxes, cells, covered = [], 0, 0
    for L in sorted(set(lv[lv > 0].tolist())):
        region = lv == L
        rects, cov = decompose(region, max_boxes, 0.0)
        cells += int(region.sum())
        covered += int(round(cov * region.sum()))
        for r0, c0, r1, c1 in rects:
            x0, z0, x1, z1 = grid.to_world(c0, r0, c1, r1)
            boxes.append([round(x0, 3), 0.0, round(z0, 3), round(x1, 3), round(L * 0.005, 3), round(z1, 3)])
    if len(boxes) > max_boxes:
        raise RuntimeError("steps: %d boxes > %d" % (len(boxes), max_boxes))
    boxes = snap_boxes(boxes, tris)
    return boxes, dict(coverage=round(covered / max(cells, 1), 3), treads=len(boxes), view="tread map")


def snap_boxes(boxes, tris, tol=0.08):
    """Wave 8 (interior pieces): a raster box edge stands up to a cell (+ the rasteriser's boundary pixel) off the real geometry; move every box coordinate to the nearest vertex
    coordinate of the piece on that axis when one is within tol, so a collider face sits ON the drawn face (the 1.20 m sill of wallWindowPort is 1.200, not 1.25)."""
    V = tris.reshape(-1, 3)
    vals = [np.unique(np.round(V[:, a], 4)) for a in range(3)]
    out = []
    for b in boxes:
        nb = list(b)
        for k in range(6):
            a = k % 3
            j = int(np.abs(vals[a] - b[k]).argmin())
            if abs(float(vals[a][j]) - b[k]) <= tol:
                nb[k] = round(float(vals[a][j]), 3)
        out.append(nb if all(nb[a] < nb[a + 3] for a in range(3)) else list(b))
    return out


def make_colliders(c, prims):
    sc = c["scale"]
    info, dbg = {}, None
    if c["mode"] == "none":                   # Wave 8: nothing drawn at body height (a rug, a pallet): no collider
        return [], {"none": "nothing drawn above %.2f m" % BAND[0]}, None
    if c["mode"] == "steps":
        boxes, info = steps_colliders(prims, sc)
        return boxes, info, None
    if c["mode"] == "footprint":
        boxes, info, dbg = footprint_colliders(prims, sc)
        if not boxes:
            boxes, info = bbox_collider(prims, sc), {"fallback": "bbox"}
    elif c["mode"] == "pole":
        boxes = pole_colliders(prims, sc)
    elif c["mode"] == "bands":
        boxes, info = band_colliders(prims, sc)
    elif c["mode"] == "elevation":
        boxes, info = elevation_colliders(prims, sc, snap=bool(c.get("interior")))
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


def siding_profile(period: int, depth: float, jitter: float, rows: int = 128) -> np.ndarray:
    """Per-row luminance factor of horizontal boards painted along a swatch's v axis: a dark gap line at the top of each board (depth) and a small board-to-board shade jitter.
    Integer hash of the board index, so the profile is the same on every run."""
    gap = max(1, int(round(period * 0.22)))
    f = np.ones(rows, np.float32)
    for k in range(rows):
        j = k // period
        h = (((j + 1) * 2654435761) >> 7) & 255
        f[k] = (1.0 + jitter * (h / 127.5 - 1.0)) * (1.0 - depth if (k % period) < gap else 1.0)
    return f


def recolor_theme(im: Image.Image, key: str, spec: dict) -> tuple[Image.Image, list]:
    """One theme colourway of a colormap: roof, wall, trim and door / base swatches take the spec's mid colour (each keeps its own light -> dark ramp); the wall swatch can carry boards."""
    cells = []
    for what, cell in SWATCH_USE[key].items():
        cells.append((swatch_box(cell), spec[what], what))
    out = np.asarray(recolor(im, cells)).astype(np.float32)
    if spec.get("siding"):
        x0, y0, x1, y1 = swatch_box(SWATCH_USE[key]["wall"])
        prof = siding_profile(SIDING_PX[key], spec["siding"][0], spec["siding"][1], y1 - y0)
        out[y0:y1, x0:x1] = np.clip(out[y0:y1, x0:x1] * prof[:, None, None], 0, 255)
    return Image.fromarray((out + 0.5).astype(np.uint8), "RGB"), sorted({w for *_, w in cells} | ({"siding"} if spec.get("siding") else set()))


def save_pal(im: Image.Image, dst: Path) -> int:
    """PNG-8 when the picture has <= 256 colours (every colour exact: the shipped base colormaps are PNG-8 too), else a deterministic median-cut to 256 colours. The theme
    colourways go through here: an RGB copy of the suburban colormap is 18 KB, the PNG-8 one 12 KB."""
    dst.parent.mkdir(parents=True, exist_ok=True)
    a = np.asarray(im.convert("RGB"))
    flat = a.reshape(-1, 3)
    uniq, inv = np.unique(flat, axis=0, return_inverse=True)
    if len(uniq) <= 256:
        pim = Image.fromarray(inv.reshape(a.shape[:2]).astype(np.uint8), "P")
        pim.putpalette(uniq.astype(np.uint8).reshape(-1).tolist())
    else:
        pim = im.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pim.save(dst, optimize=True)
    return dst.stat().st_size


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
        if key in SWATCH_USE:                                  # Wave 7b: the resort / lodge colourways (after the four shipped variants: the manifest keeps their order)
            for theme, vs_ in THEME_VARIANTS.items():
                for vname, spec in vs_.items():
                    vf = p["file"].replace(".png", f"_{vname}.png")
                    img, rec = recolor_theme(im.convert("RGB"), key, spec)
                    out[key]["variants"][vname] = {"file": vf, "bytes": save_pal(img, (OUT / vf).resolve()), "recolours": rec, "theme": theme}
    return out


# ── far-proxy colours of the theme variants + the JS tables the runtime keeps as literal copies ─────────────────────────────────────────────────────────────────────
BASE_VARIANTS = ["base", "slate", "brick", "sand"]                    # citykit.js VARIANT_ORDER as shipped (PROXY_COLORS holds [wall, roof] per entry in this order)


def theme_variant_names() -> list:
    return [n for t in THEME_VARIANTS for n in THEME_VARIANTS[t]]


def proxy_colours(cat, pal_dir: Path) -> dict:
    """[wall, roof] sRGB per palette-textured building type per theme variant (the far proxy of a district and the box fallback of a type whose GLB failed draw these).
    wall = the area-weighted mean colour over the type's non-roof faces (normal.y <= 0.5), roof = over its roof faces (normal.y > 0.5), each triangle sampled at its UV centroid
    in the variant's colormap. (The shipped PROXY_COLORS roofs agree with this within ~0x10; its walls were weighted lighter - they are not used for the new variants.)"""
    out = {}
    pals = {}
    for key in SWATCH_USE:
        for v in theme_variant_names():
            pals[(key, v)] = np.asarray(Image.open(pal_dir / f"{key}_{v}.png").convert("RGB")).astype(np.float64)
    for c in cat:
        if c["kind"] != "building" or not c["palette"] or c["palette"] not in SWATCH_USE:
            continue
        g = read_glb(c["src"])
        tris = []
        for pr in g.prims:
            tr = pr.pos[pr.idx].astype(np.float64) * c["scale"]
            uv = pr.uv[pr.idx].astype(np.float64).mean(1) * 512
            n = np.cross(tr[:, 1] - tr[:, 0], tr[:, 2] - tr[:, 0])
            a = 0.5 * np.linalg.norm(n, axis=1)
            n = n / np.maximum(2 * a[:, None], 1e-12)
            tris.append((a, n[:, 1], np.clip(uv[:, 0].astype(int), 0, 511), np.clip(uv[:, 1].astype(int), 0, 511)))
        row = []
        for v in theme_variant_names():
            img = pals[(c["palette"], v)]
            for roof in (False, True):
                acc, tot = np.zeros(3), 0.0
                for a, ny, ux, uy in tris:
                    m = (ny > 0.5) if roof else (ny <= 0.5)
                    acc += (img[uy[m], ux[m]] * a[m, None]).sum(0)
                    tot += float(a[m].sum())
                col = acc / tot if tot > 0 else np.zeros(3)
                row.append(int(round(col[0])) << 16 | int(round(col[1])) << 8 | int(round(col[2])))
        out[c["id"]] = row
    return out


def emit_theme_tables(dst: Path, pal_dir: Path) -> None:
    """The literal blocks citykit.js keeps (VARIANT_ORDER, PROXY_COLORS_X, THEMES, THEME_TYPES), generated; `--check-tables` compares the runtime files against the same text."""
    cat = [c for c in catalogue() if c["kind"] == "building" and c["palette"] in SWATCH_USE]
    px = proxy_colours(cat, pal_dir)
    order = sorted(px, key=lambda i: ["suburban", "commercial", "skyscraper", "lowdetail"].index(i.split("/")[0]) * 1000 + sorted(px).index(i))
    lines = ["// generated by games/last-circle/_tools/art_b_city.py (--emit-theme-tables): copy these blocks into runtime/3d/royale/citykit.js (do not edit by hand)",
             'const VARIANT_ORDER = [%s];' % ", ".join('"%s"' % v for v in BASE_VARIANTS + theme_variant_names()),
             "/** [wall, roof] per type for the theme variants, in VARIANT_ORDER order after the four shipped ones (the far proxy / box fallback; see art_b_city.py proxy_colours) */",
             "const PROXY_COLORS_X = Object.freeze({"]
    for i, tid in enumerate(order):
        lines.append('  "%s": [%s]%s' % (tid, ", ".join("0x%06x" % x for x in px[tid]), "," if i + 1 < len(order) else ""))
    lines.append("});")
    lines.append("// THEMES entries (default colourway when an entry carries no palette; the colours are baked into the variants, so the tint stays white)")
    for t in THEME_VARIANTS:
        d = list(THEME_VARIANTS[t])[0]
        lines.append('  %s Object.freeze({ variant: Object.freeze({ suburban: "%s", commercial: "%s" }), tint: 0x%06x }),' % ((t + ":").ljust(7), d, d, THEME_TINT[t]))
    lines.append("// THEME_TYPES entries")
    for t in THEME_TYPE_LISTS:
        lines.append("  %s: Object.freeze({" % t)
        for role, ids in THEME_TYPE_LISTS[t].items():
            lines.append("    %s: [%s]," % (role, ", ".join('"%s"' % x for x in ids)))
        lines.append("  }),")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print("theme tables ->", dst, "(%d types x %d variants)" % (len(px), len(theme_variant_names())))


def theme_block() -> dict:
    """manifest.themes / manifest.swatch_use: the generator's own record of the theme colourways, the types per role and the swatch cells (themeshots.py audits them; citykit.js
    THEMES / THEME_TYPES and towngen.js THEMES are literal copies the selftests compare)."""
    return {
        "themes": {t: {"character": THEME_CHARACTER[t], "tint": "0x%06x" % THEME_TINT[t], "variants": {k: list(THEME_VARIANTS[t]) for k in SWATCH_USE},
                       "colours": {n: {w: "#%02x%02x%02x" % tuple(v) for w, v in sp.items() if w != "siding"} for n, sp in THEME_VARIANTS[t].items()},
                       "types": THEME_TYPE_LISTS[t]} for t in THEME_VARIANTS},
        "swatch_use": {k: {w: list(c) for w, c in d.items()} for k, d in SWATCH_USE.items()},
    }


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


def palettes_only() -> int:
    """Regenerate the palette PNGs and the manifest's `palettes`, `themes`, `swatch_use` and `readme`; nothing else is read or written (the GLBs and every type row are kept byte for byte).
    The output is a pure function of (the source colormaps, this file, the existing manifest)."""
    mpath = OUT / "manifest.json"
    if not mpath.exists():
        game_m = GAME / "assets" / "props" / "city" / "manifest.json"
        mpath.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(game_m, mpath)
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    palettes = build_palettes(catalogue())
    tb = theme_block()
    new = {}
    for k, v in manifest.items():                       # keep the key order of the manifest; the new blocks go right after `palettes`
        if k == "palettes":
            new["palettes"] = palettes
            new["themes"] = tb["themes"]
            new["swatch_use"] = tb["swatch_use"]
        elif k in ("themes", "swatch_use"):
            continue
        elif k == "readme":
            new["readme"] = README
        else:
            new[k] = v
    mpath.write_text(json.dumps(new, separators=(",", ":")), encoding="utf-8")
    nvar = sum(len(p["variants"]) for p in palettes.values())
    print("palettes ->", mpath, "(%d palettes, %d variants, themes %s)" % (len(palettes), nvar, ", ".join(tb["themes"])))
    for key in SWATCH_USE:
        for vn, vv in palettes[key]["variants"].items():
            print("  %-10s %-10s %6d B  %s" % (key, vn, vv["bytes"], vv["file"]))
    return 0


def colliders_only(cat) -> int:
    """Recompute ONLY the colliders (boxes, mode, info) from the source models and rewrite them into the existing manifest. Nothing else is written
    (no GLB, palette or plot) and every other byte of the manifest is kept, so the output is a pure function of (source models, this file, the manifest).
    Wave 8: an interior row is rewritten where it lives (manifest_interior.json in stage A, manifest.json once merged)."""
    mpath = OUT / "manifest.json"
    ipath = OUT / "manifest_interior.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    imanifest = json.loads(ipath.read_text(encoding="utf-8")) if ipath.exists() else {"types": {}}
    types, itypes = manifest["types"], imanifest["types"]
    for c in cat:
        if c["id"] in types:
            t = types[c["id"]]
        elif c["id"] in itypes:
            t = itypes[c["id"]]
        else:
            print("FAIL", c["id"], "is not in the existing manifest (run the full intake first)")
            return 1
        boxes, info, _ = make_colliders(c, clean_prims(read_glb(c["src"]), c))
        t["colliders"] = [{"min": b[:3], "max": b[3:]} for b in boxes]
        t["collider_mode"] = c["mode"]
        t["collider_info"] = info
        print("%-34s %-9s %d box%s %s" % (c["id"], c["mode"], len(boxes), "" if len(boxes) == 1 else "es", info))
    manifest["readme"] = README + (README_INTERIOR if any(k in types for k in (f"{g}/{n}" for n, g, *_ in INTERIOR)) else [])
    mpath.write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    if ipath.exists():
        ipath.write_text(json.dumps(imanifest, separators=(",", ":")), encoding="utf-8")
    print("\ncolliders ->", mpath, "(%d types, %d boxes)" % (len(types), sum(len(v["colliders"]) for v in types.values())))
    if itypes:
        print("colliders ->", ipath, "(%d interior rows, %d boxes)" % (len(itypes), sum(len(v["colliders"]) for v in itypes.values())))
    return 0


def interior_catalogue() -> dict:
    """rooms / use / place / collide of every interior piece (the 32 shipped + INTERIOR), in a fixed order: shipped first (manifest order), then INTERIOR as listed."""
    out = {}
    for tid in sorted(INTERIOR_SHIPPED, key=lambda k: (k.split("/")[0] != "furniture", k)):
        rooms, use, place = INTERIOR_SHIPPED[tid]
        out[tid] = {"rooms": rooms, "use": use, "place": place, "collide": "solid", "new": False}
    for n, g, src, sc, mode, rooms, use, place, opt in INTERIOR:
        out[f"{g}/{n}"] = {"rooms": rooms, "use": use, "place": place, "collide": "none" if mode == "none" else "solid", "new": True}
    return out


def write_interior_manifest(rows: dict, into_main: bool, merge: bool) -> None:
    """assets/props/city/manifest_interior.json: README_INTERIOR, the catalogue and (stage A) the interior `types` rows in manifest.json's schema. A pure function of the inputs:
    a second run writes the same bytes. merge (an --only run): rows of the existing file that this run did not produce are kept. into_main: no rows (they are in manifest.json)."""
    ipath = OUT / "manifest_interior.json"
    old = {}
    if merge and not into_main and ipath.exists():
        old = json.loads(ipath.read_text(encoding="utf-8")).get("types", {})
    if not into_main:
        old.update(rows)
    order = [f"{g}/{n}" for n, g, *_ in INTERIOR]
    rows = {k: old[k] for k in sorted(old, key=lambda k: order.index(k) if k in order else len(order))}
    totals = {}
    for v in rows.values():
        t = totals.setdefault(v["group"], {"files": 0, "tris": 0, "bytes": 0, "src_bytes": 0})
        t["files"] += 1
        t["tris"] += v["tris"]
        t["bytes"] += v["bytes"]
        t["src_bytes"] += v["src_bytes"]
    doc = {
        "version": 1,
        "generated_by": "games/last-circle/_tools/art_b_city.py",
        "stage": "Wave 8 stage A (lane H2): rows NOT yet in manifest.json" if rows else "merged into manifest.json (INTERIOR_IN_MAIN): catalogue only",
        "licence": "CC0 throughout: Kenney Furniture Kit 2.0; Quaternius (Poly Pizza, CC0 1.0): Shelf Tall, Shelf Large, Pallet. See CREDITS.md.",
        "readme": README_INTERIOR,
        "palettes": "manifest.json `palettes` (the pallet uses quaternius_atlas; every other interior piece uses flat material colours and no texture)",
        "catalogue": interior_catalogue(),
        "totals": totals,
        "types": rows,
    }
    ipath.parent.mkdir(parents=True, exist_ok=True)
    ipath.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")
    print("\ninterior manifest ->", ipath, "(%d rows, catalogue %d)" % (len(rows), len(doc["catalogue"])))
    for grp, t in totals.items():
        print("  interior %-11s %2d files  %6d tris  %8d B  (source %8d B)" % (grp, t["files"], t["tris"], t["bytes"], t["src_bytes"]))


# ───────────────────────────── main ─────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None, help="process only ids containing this substring")
    ap.add_argument("--scratch", default=str(DEFAULT_SCRATCH))
    ap.add_argument("--no-plots", action="store_true")
    ap.add_argument("--skip-pack", action="store_true", help="reuse the GLBs already on disk (collider / manifest iteration)")
    ap.add_argument("--out-root", default=None, help="write assets/props/{city,cars} under this directory instead of the game directory (reproducibility checks)")
    ap.add_argument("--palettes-only", action="store_true",
                    help="regenerate ONLY the palette PNGs and the manifest's palettes / themes / swatch_use / readme blocks (no GLB is written, every other byte of the manifest is kept; "
                         "needs an existing manifest under the output root, copied from the game directory when --out-root is new)")
    ap.add_argument("--emit-theme-tables", default=None, metavar="FILE",
                    help="with --palettes-only (or alone): write the literal citykit.js blocks (VARIANT_ORDER, PROXY_COLORS_X, THEMES, THEME_TYPES) for the theme variants to FILE")
    ap.add_argument("--interior-into-main", action="store_true",
                    help="Wave 8 stage B: write the interior kit rows (INTERIOR) into manifest.json instead of manifest_interior.json (the same as INTERIOR_IN_MAIN = True)")
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
    if args.palettes_only:
        rc = palettes_only()
        if args.emit_theme_tables and rc == 0:
            emit_theme_tables(Path(args.emit_theme_tables), OUT / "palettes")
        return rc
    t0 = time.time()
    palettes = build_palettes(catalogue())
    types = {}
    interior_ids: set = set()
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
        if c["mode"] == "none" and float(hi[1]) > BAND[0]:
            print("FAIL", c["id"], "collider mode none but drawn up to %.3f m (> %.2f m: a player meets it)" % (float(hi[1]), BAND[0]))
            bad += 1
        rel = os.path.relpath(c["out"], OUT).replace("\\", "/")
        types[c["id"]] = {
            "file": rel, "group": c["group"], "kind": c["kind"], "role": c["role"], "palette": c["palette"], "tris": st["tris"],
            "verts": st["verts"], "bytes": c["out"].stat().st_size, "src_bytes": c["src"].stat().st_size,
            "suggested_scale": sc, "bbox_m": {"x": round(float(hi[0] - lo[0]), 3), "y": round(float(hi[1] - lo[1]), 3), "z": round(float(hi[2] - lo[2]), 3)},
            "bbox_min_m": [round(float(v), 3) for v in lo], "bbox_max_m": [round(float(v), 3) for v in hi],
            "compression": compression, "front": "+Z", "double_sided": bool(mats[0].get("doubleSided", False)),
            "materials": len({p.mat for p in prims}) if c.get("interior") else len(mats), "uv": bool(uvs),
            "colliders": [{"min": b[:3], "max": b[3:]} for b in boxes], "collider_mode": c["mode"],
            "collider_info": info,
        }
        if c.get("interior"):
            interior_ids.add(c["id"])
            types[c["id"]]["source"] = c["credit"] or "Kenney Furniture Kit 2.0 (CC0): %s" % c["src"].name
        plots.setdefault(c["group"], []).append(dict(name=c["name"], size=hi - lo, colliders=boxes, dbg=dbg,
                                                     tris_world=tri_world(prims, sc) if dbg is None else None))
        print("%-34s tris %5d  %7d B (src %7d B, %.2fx)  %5.1f x %5.1f x %5.1f m  colliders %d %s" % (
            c["id"], st["tris"], c["out"].stat().st_size, c["src"].stat().st_size, c["out"].stat().st_size / c["src"].stat().st_size,
            *(hi - lo), len(boxes), info.get("coverage", "")))
    if not args.no_plots:
        for grp, items in plots.items():
            plot_group(grp, items, scratch / "plots" / f"colliders_{grp}.png")
    # Wave 8 stage A: the interior rows go to manifest_interior.json unless they are merged into the main manifest (stage B)
    into_main = INTERIOR_IN_MAIN or args.interior_into_main
    itypes = {k: v for k, v in types.items() if k in interior_ids}
    if not into_main:
        types = {k: v for k, v in types.items() if k not in interior_ids}
    write_interior_manifest(itypes, into_main, merge=bool(args.only))
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
        "readme": README + (README_INTERIOR if into_main else []),
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
        "themes": theme_block()["themes"],
        "swatch_use": theme_block()["swatch_use"],
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
