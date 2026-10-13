"""art_a_canopy_build.py - ART-A / plan P2.6: parametric RAM-AIR CANOPY for Last Circle, built in Blender (headless).

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup --python art_a_canopy_build.py -- <out_raw.glb> <out_meta.json>

A real ram-air wing instead of the half-sphere dome (player.js ensureChute): an ARCHED wing (tips curve down, ref t22), nine
inflated CELLS separated by ribs (alternating colour / white = the gore mask), an airfoil section with a flatter underside,
pillowed top skin, the open intake MOUTH under the leading edge (with the interior wall behind it), tapered / swept tips,
a stabiliser panel hanging from each wingtip, and 16 suspension-line segments (8 of the 10 ribs x 2 rows) that meet four risers.

Coordinates: metres, +Y up, nose toward -Z (the pilot faces -Z in actor space), origin = the harness HANG POINT (where the
four risers meet, between the shoulders).  Blender is Z-up so geometry is authored in (X, Y_up, Z_nose) and written to Blender
as (X, -Z, Y); the glTF exporter's Y-up conversion then gives back exactly (X, Y, Z).

COLOR_0 (float): R = GORE MASK (0 = canopy colour from instanceColor, 1 = white gore; player.js mixes instanceColor -> white by
R), G = ambient-occlusion-like darkening (1 = open top skin ... 0.18 = inside the mouth) that the current shader ignores and an
optional "* color.g" multiplies in for free, B = 1 (unused).  One mesh node "Canopy", one material, a UV0 for a future fabric normal.
"""
import bpy, bmesh, math, json, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_GLB = argv[0] if len(argv) > 0 else "canopy_raw.glb"
OUT_META = argv[1] if len(argv) > 1 else "canopy_meta.json"

# ------------------------------------------------------------------ parameters (metres)
CELLS = 9               # odd -> a symmetric alternating colour/white pattern with a coloured centre and coloured tips
SEG = 5                 # span segments per cell on the top skin (pillow resolution)
SPAN = 4.40             # projected tip-to-tip width (X extent of the rib centre lines)
CHORD = 1.80            # centre chord
DROP = 0.80             # tip drop below the centre (arch)
TMAX = 0.15             # max airfoil thickness / chord
TAPER = 0.28            # chord lost at the tip (fraction)
SWEEP = 0.10            # leading edge swept back at the tip (m)
Y_CHORD = 2.15          # chord-line height above the hang point at the centre (bottom skin at the centre = ~2.05 = the old dome base)
Z_NOSE = -0.70          # leading edge z at the centre (mid-chord sits just behind the pilot)
PILLOW_TOP = 0.045      # inflated-cell bulge of the top skin (m)
PILLOW_BOT = 0.012
TOP_FRAC, BOT_FRAC = 0.62, 0.38     # share of the thickness above / below the chord line (flatter underside)
LIP_X = [0.02, 0.06, 0.10]          # lower-surface points wrapping round the nose to the mouth
BOT_X = [0.17, 0.27, 0.39, 0.52, 0.66, 0.80, 0.92, 1.0]   # bottom skin from behind the mouth to the trailing edge
WALL_X = 0.32                        # the diaphragm that closes the cells behind the mouth
NUP = 12                             # upper-surface segments TE -> LE
N_LINES_ROWS = (0.25, 0.70)          # line attach rows (x / chord)
RISERS = {("L", "F"): (-0.22, 0.0, -0.10), ("R", "F"): (0.22, 0.0, -0.10), ("L", "R"): (-0.22, 0.0, 0.14), ("R", "R"): (0.22, 0.0, 0.14)}

R_ARC = ((SPAN / 2) ** 2 + DROP ** 2) / (2 * DROP)
PHI_M = math.asin((SPAN / 2) / R_ARC)
NS = CELLS * SEG


def yt(x):
    """NACA-00xx half thickness (fraction of chord) for t = TMAX."""
    return max(0.0, 5 * TMAX * (0.2969 * math.sqrt(max(x, 0)) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4))


TMAX_ABS = 2 * max(yt(i / 200) for i in range(201))      # fraction of chord
UP_X = [0.5 * (1 + math.cos(math.pi * k / NUP)) for k in range(NUP + 1)]     # TE (1) -> LE (0), cosine spaced


def station(phi):
    t = abs(phi) / PHI_M
    chord = CHORD * (1 - TAPER * t * t)
    z_le = Z_NOSE + SWEEP * t * t
    return chord, z_le


def surf(phi, x, off_frac, extra=0.0):
    """Point of the skin at arc angle phi, chord fraction x, offset = off_frac * local thickness + extra along the arc normal."""
    chord, z_le = station(phi)
    T = 2 * yt(x) * chord
    off = off_frac * T + extra
    s, c = math.sin(phi), math.cos(phi)
    px, py = R_ARC * s, Y_CHORD + R_ARC * (c - 1)
    return Vector((px + s * off, py + c * off, z_le + x * chord))


def tshape(x):
    return min(1.0, (2 * yt(x)) / TMAX_ABS) ** 0.6


to_blender = lambda v: Vector((v.x, -v.z, v.y))

bm = bmesh.new()
vcol = {}      # vert -> (r, g, b)
vuv = {}       # vert -> (u, v)


def V(p, col, uv=(0, 0)):
    v = bm.verts.new(to_blender(p))
    vcol[v] = col
    vuv[v] = uv
    return v


def poly(verts, smooth=False):
    try:
        f = bm.faces.new(verts)
        f.smooth = smooth
        return f
    except ValueError:
        return None


def phi_of(j):
    return -PHI_M + 2 * PHI_M * j / NS


def mask_of(cell):
    return 1.0 if cell % 2 == 1 else 0.0


def ao_top(x):
    return 1.0


def ao_bot(x):
    return 0.70 + 0.25 * min(1.0, max(0.0, (x - 0.17) / 0.40))


# ------------------------------------------------------------------ top skin: TE -> nose -> lower lip, per cell (verts per cell: creases at ribs)
top_rows = [(x, TOP_FRAC) for x in UP_X] + [(x, -BOT_FRAC) for x in LIP_X]      # 13 upper + 3 lip = 16 rows
cell_top = []
for c in range(CELLS):
    grid = []
    for m in range(SEG + 1):
        j = c * SEG + m
        phi = phi_of(j)
        s = m / SEG
        pf = math.sin(math.pi * s) ** 0.75
        col = []
        for (x, frac) in top_rows:
            if frac > 0:
                extra = PILLOW_TOP * pf * tshape(x)
                ao = ao_top(x)
            else:
                extra = 0.0
                ao = 0.92 - 0.30 * (x - LIP_X[0]) / (LIP_X[-1] - LIP_X[0])      # the lip darkens toward the mouth
            p = surf(phi, x, frac, extra if frac > 0 else 0.0)
            col.append(V(p, (mask_of(c), ao, 1.0), ((j) / NS, 1.0 - x)))
        grid.append(col)
    for m in range(SEG):
        for r in range(len(top_rows) - 1):
            poly([grid[m][r], grid[m + 1][r], grid[m + 1][r + 1], grid[m][r + 1]], smooth=True)
    cell_top.append(grid)

# ------------------------------------------------------------------ bottom skin (mouth gap between the lip and BOT_X[0])
BSEG = 2
for c in range(CELLS):
    grid = []
    for m in range(BSEG + 1):
        j = c * SEG + round(m * SEG / BSEG)
        phi = phi_of(c * SEG) + (phi_of((c + 1) * SEG) - phi_of(c * SEG)) * m / BSEG
        s = m / BSEG
        pf = math.sin(math.pi * s) ** 0.75
        col = []
        for x in BOT_X:
            p = surf(phi, x, -BOT_FRAC, PILLOW_BOT * pf * tshape(x))
            col.append(V(p, (mask_of(c), ao_bot(x), 1.0), ((c * SEG + s * SEG) / NS, 1.0 - x)))
        grid.append(col)
    for m in range(BSEG):
        for r in range(len(BOT_X) - 1):
            poly([grid[m][r], grid[m][r + 1], grid[m + 1][r + 1], grid[m + 1][r]], smooth=True)

# ------------------------------------------------------------------ interior: wall behind the mouth, inner rib fronts, end caps (own verts, flat)
DARK = 0.18


def rib_point(phi, x, frac, c):
    return V(surf(phi, x, frac), (c, DARK, 1.0))


def rib_outline(phi, x_max):
    """Rib plane polygon, nose region only: the upper surface from the wall line to the LE, the lip points, the bottom from behind the mouth to the wall line."""
    return ([("u", x_max)] + [("u", x) for x in sorted(UP_X, reverse=True) if x < x_max - 1e-6] +
            [("l", x) for x in LIP_X] + [("b", x) for x in BOT_X if x < x_max - 1e-6] + [("b", x_max)])


def frac_of(kind):
    return TOP_FRAC if kind == "u" else -BOT_FRAC


for rib in range(CELLS + 1):
    phi = phi_of(rib * SEG)
    side_cell = min(rib, CELLS - 1)
    mk = mask_of(side_cell)
    if rib in (0, CELLS):
        # end cap: the whole airfoil outline (24 points)
        outline = [("u", x) for x in UP_X] + [("l", x) for x in LIP_X] + [("b", x) for x in BOT_X]
        poly([V(surf(phi, x, frac_of(k)), (mk, 0.9, 1.0)) for (k, x) in outline], smooth=False)
    else:
        outline = rib_outline(phi, WALL_X)
        # the wall edge: from the last bottom point back up to the first upper point (WALL_X), closing the polygon
        poly([V(surf(phi, x, frac_of(k)), (0.0, DARK, 1.0)) for (k, x) in outline], smooth=False)
# wall behind the mouth, one quad per cell (between rib lines)
for c in range(CELLS):
    p0, p1 = phi_of(c * SEG), phi_of((c + 1) * SEG)
    quad = [V(surf(p0, WALL_X, TOP_FRAC), (0.0, DARK, 1.0)), V(surf(p1, WALL_X, TOP_FRAC), (0.0, DARK, 1.0)),
            V(surf(p1, WALL_X, -BOT_FRAC), (0.0, DARK, 1.0)), V(surf(p0, WALL_X, -BOT_FRAC), (0.0, DARK, 1.0))]
    poly(quad, smooth=False)

# ------------------------------------------------------------------ stabiliser panels at the wingtips (hang below the tip rib plane)
for side in (-1, 1):
    phi = side * PHI_M
    s, c = math.sin(phi), math.cos(phi)
    down = Vector((-s, -c, 0))          # -n : down the end-cap plane
    a = surf(phi, 0.26, -BOT_FRAC)
    b = surf(phi, 0.94, -BOT_FRAC)
    pts = [a, b, b + down * 0.12, a + down * 0.36]
    f = poly([V(p, (0.0, 0.95, 1.0)) for p in pts], smooth=False)

bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
bm.verts.index_update()
uvl = bm.loops.layers.uv.new("UVMap")
for f in bm.faces:
    for l in f.loops:
        l[uvl].uv = vuv[l.vert]
nverts, ntris = len(bm.verts), len(bm.faces)

mesh = bpy.data.meshes.new("Canopy")
bm.to_mesh(mesh)
mesh.update()
attr = mesh.color_attributes.new("Color", "FLOAT_COLOR", "POINT")
for i, v in enumerate(bm.verts):
    r, g, b = vcol[v]
    attr.data[i].color = (r, g, b, 1.0)
mesh.color_attributes.active_color = attr
mesh.color_attributes.render_color_index = 0
bm.free()

obj = bpy.data.objects.new("Canopy", mesh)
bpy.context.scene.collection.objects.link(obj)
mat = bpy.data.materials.new("Canopy")
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
bsdf.inputs["Roughness"].default_value = 0.85
mat.use_backface_culling = False
mesh.materials.append(mat)
bpy.ops.object.select_all(action="DESELECT")
obj.select_set(True)
bpy.context.view_layer.objects.active = obj

# ------------------------------------------------------------------ suspension lines (segment endpoint pairs: canopy attach, riser)
lines = []
for rib in [r for r in range(CELLS + 1) if r not in (2, CELLS - 2)]:
    phi = phi_of(rib * SEG)
    for row, xf in enumerate(N_LINES_ROWS):
        a = surf(phi, xf, -BOT_FRAC)
        side = "L" if (phi < -1e-6 or (abs(phi) < 1e-6 and row == 0)) else "R"
        rk = ("F" if row == 0 else "R")
        b = Vector(RISERS[(side, rk)])
        lines.append((a, b))
pts = []
for a, b in lines:
    pts.append({"x": round(a.x, 4), "y": round(a.y, 4), "z": round(a.z, 4)})
    pts.append({"x": round(b.x, 4), "y": round(b.y, 4), "z": round(b.z, 4)})

xs = [p["x"] for p in pts]
meta = {
    "about": "ART-A ram-air canopy (contract C-ART-CANOPY). Metres, +Y up, nose toward -Z, origin = harness hang point (where the four risers meet).",
    "lines": pts,
    "lines_layout": "segment endpoint pairs: lines[2i] = attach point on the underside (rib index in `lineRibs`[floor(i/2)], row i mod 2), lines[2i+1] = riser end; " + str(2 * len(lines)) + " points",
    "lineSegments": len(lines),
    "lineRibs": [r for r in range(CELLS + 1) if r not in (2, CELLS - 2)],
    "span": SPAN, "chord": CHORD, "arcDrop": DROP, "cells": CELLS, "ribs": CELLS + 1,
    "hang": {"x": 0.0, "y": 1.55, "z": 0.0},
    "hang_about": "where the origin of canopy.glb sits in ACTOR space (feet origin, +Y up, forward -Z): shoulder height, on the centreline; the riser ends in `lines` are +-0.22 m / -0.10..+0.14 m around it",
    "risers": {"%s%s" % k: list(v) for k, v in RISERS.items()},
    "tris": ntris, "verts": nverts,
    "vertexColor": {"COLOR_0.r": "gore mask (0 = instanceColor, 1 = white)", "COLOR_0.g": "AO-like darkening 0.18..1 (ignored by today's shader; multiply it in for the mouth/underside depth)", "COLOR_0.b": "1 (unused)"},
    "mesh": "one node named Canopy",
}
json.dump(meta, open(OUT_META, "w"), indent=1)

bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                          export_materials="EXPORT", export_vertex_color="ACTIVE", export_normals=True, export_texcoords=True,
                          export_cameras=False, export_lights=False, export_draco_mesh_compression_enable=False)
print("CANOPY built: verts", nverts, "tris", ntris, "R_ARC %.3f phi_m %.2f deg" % (R_ARC, math.degrees(PHI_M)), "lines", len(lines))
