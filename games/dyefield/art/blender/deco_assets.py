"""DYEFIELD — prop and scenery builders for the map lane (headless bpy, deterministic).

Every builder returns geometry in the ASSET-LOCAL frame (Blender coords: origin at the asset's
base point, up = +Z, forward = -Y) as `common.Geo` buckets. build_map.py places them with
`common.place_matrix(pos, yaw)` and routes each bucket to a paint_/solid_/deco_ object.

Text: the ONLY in-world strings are "HARBOR CUP" and "TIDE CO." (DESIGN §1). billboard() and
banner() refuse anything else.
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector, geometry

import common as C
from common import Geo

ALLOWED_TEXT = ("HARBOR CUP", "TIDE CO.")
# Paintable relief (crate panels/grooves/braces, planter lip) slopes at <= 35 degrees from its
# face so smart-project keeps it in the face's island: 45 degrees is an exact tie between two
# sides and produced hundreds of sliver islands.
SLOPE_DEG = 35.0
FONT_CANDIDATES = ("C:/Windows/Fonts/ariblk.ttf", "C:/Windows/Fonts/impact.ttf", "C:/Windows/Fonts/arialbd.ttf")


# ── small helpers ────────────────────────────────────────────────────────────────────────────────
def _geo_from_bm(name, bm, mat, smooth=False, matrix=None) -> Geo:
    g = Geo(name)
    g.add_bm(bm, mat, matrix=matrix, smooth=smooth)
    bm.free()
    return g


def _prism(bm, origin, n, a, c, half_len, hw_out, depth, lift=0.01):
    """Triangular prism for a V-groove: apex `depth` below the surface along -n, opening
    `hw_out` wide at `lift` above it, extruded +-half_len along a."""
    o = Vector(origin)
    tri = [(-hw_out, -lift), (hw_out, -lift), (0.0, depth)]
    ends = []
    for s in (-half_len, half_len):
        ends.append([bm.verts.new(o + a * s + c * cc - n * dd) for (cc, dd) in tri])
    e0, e1 = ends
    bm.faces.new(e0)
    bm.faces.new(list(reversed(e1)))
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((e0[i], e1[i], e1[j], e0[j]))


def _groove(bm, origin, n, a, c, half_len, hw_out, depth, lift=0.01, taper=0.026):
    """V-groove cutter whose two ends taper to a point over `taper`, so every facet of the cut
    stays within ~50 degrees of the panel normal (it unwraps with the panel, no sliver islands)."""
    o = Vector(origin)
    P = lambda s_, cc, dd: bm.verts.new(o + a * s_ + c * cc - n * dd)  # noqa: E731
    L = half_len - taper
    secs = [[P(s_, -hw_out, -lift), P(s_, hw_out, -lift), P(s_, 0.0, depth)] for s_ in (-L, L)]
    e0, e1 = P(-half_len, 0.0, -lift), P(half_len, 0.0, -lift)
    s0, s1 = secs
    for i in range(3):
        j = (i + 1) % 3
        bm.faces.new((s0[i], s1[i], s1[j], s0[j]))
        bm.faces.new((e0, s0[j], s0[i]))
        bm.faces.new((e1, s1[i], s1[j]))


def _jitter_rock(bm, verts, rnd, amt=0.22):
    for v in verts:
        v.co *= 1.0 + rnd.uniform(-amt, amt)


def _rock(bm, center, size, rnd, flat=0.7, rot=None):
    m = Matrix.Translation(Vector(center)) @ (rot or Matrix.Rotation(rnd.uniform(0, math.tau), 4, "Z")) \
        @ Matrix.Diagonal((size[0], size[1], size[2] * flat, 1.0))
    verts = C.bm_icosphere(bm, 0.5, 1)
    _jitter_rock(bm, verts, rnd)
    C.bm_transform(bm, m, verts)


# ── text ─────────────────────────────────────────────────────────────────────────────────────────
def _font():
    import os
    for p in FONT_CANDIDATES:
        if os.path.isfile(p):
            return bpy.data.fonts.load(p, check_existing=True)
    raise FileNotFoundError(f"none of {FONT_CANDIDATES} exists")


def text_bm(text: str, depth: float, bevel: float = 0.0):
    """Extruded lettering as a bmesh: reading plane = local XZ, facing -Y (asset forward),
    baseline-centred at the origin, 1 unit cap-ish height before fitting, back face at y = 0."""
    if text not in ALLOWED_TEXT:
        raise ValueError(f"in-world text {text!r} is not allowed (only {ALLOWED_TEXT})")
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = text
    cu.font = _font()
    cu.size = 1.0
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = 3
    cu.extrude = depth * 0.5
    cu.bevel_depth = bevel
    cu.bevel_resolution = 0
    cu.fill_mode = "BOTH"
    ob = bpy.data.objects.new("txt", cu)
    C.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    xs = [v.co.x for v in bm.verts]
    ys = [v.co.y for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    zb = min(zs)
    # curve XY plane (reads from +Z)  ->  local XZ plane reading from -Y; back at y = 0
    m = Matrix.Rotation(math.radians(90), 4, "X") @ Matrix.Translation((-cx, -cy, -zb))
    C.bm_transform(bm, m)
    return bm


def fit_text(bm, max_w: float, max_h: float, center: Vector):
    """Uniformly scale lettering (in X/Z only; the extrusion depth is kept) to fit max_w x max_h
    and centre its bounding box on `center` (the back face lands at center.y)."""
    xs = [v.co.x for v in bm.verts]
    zs = [v.co.z for v in bm.verts]
    w, h = max(xs) - min(xs), max(zs) - min(zs)
    cx, cz = (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2
    s = min(max_w / w, max_h / h)
    m = Matrix.Translation(center) @ Matrix.Diagonal((s, 1.0, s, 1.0)) @ Matrix.Translation((-cx, 0.0, -cz))
    C.bm_transform(bm, m)
    return s, w * s, h * s


# ── crate (paintable) ────────────────────────────────────────────────────────────────────────────
_CRATE_CACHE: dict[int, Geo] = {}


def _frustum(bm, center, n, a, c, w_top, h_top, w_bot, h_bot, depth_top, depth_bot):
    """Closed frustum whose big face sits depth_top below the surface plane through `center`
    (negative = above it) and whose small face sits depth_bot below it. n = outward normal,
    a / c = in-plane axes."""
    o = Vector(center)
    rings = []
    for (w, h, dd) in ((w_top, h_top, depth_top), (w_bot, h_bot, depth_bot)):
        rings.append([bm.verts.new(o + a * (sa * w / 2) + c * (sc * h / 2) - n * dd)
                      for (sa, sc) in ((-1, -1), (1, -1), (1, 1), (-1, 1))])
    t, b_ = rings
    bm.faces.new(t)
    bm.faces.new(list(reversed(b_)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((t[i], b_[i], b_[j], t[j]))


def _trapezoid_bar(bm, center, n, along, across, length, w_top, rise, sink, run=1.0):
    """Raised batten: flat top `w_top` wide lying ON the surface plane through `center`, sloped
    flanks (horizontal `run` per metre of drop) falling `rise` to the panel, then `sink` deeper
    (buried in the solid)."""
    o = Vector(center)
    r = rise * run
    prof = [(-w_top / 2, 0.0), (w_top / 2, 0.0), (w_top / 2 + r, rise), (w_top / 2 + r, rise + sink),
            (-w_top / 2 - r, rise + sink), (-w_top / 2 - r, rise)]
    ends = []
    for s in (-length / 2, length / 2):
        ends.append([bm.verts.new(o + along * s + across * pa - n * pd) for (pa, pd) in prof])
    e0, e1 = ends
    bm.faces.new(e0)
    bm.faces.new(list(reversed(e1)))
    k = len(prof)
    for i in range(k):
        j = (i + 1) % k
        bm.faces.new((e0[i], e1[i], e1[j], e0[j]))


def crate_unit(variant: int) -> Geo:
    """Unit (1 m) stacked-plank cargo crate, bottom at z = 0 (bottom faces removed).

    A bevelled box whose five visible faces each carry a recessed plank panel: the frame border
    is the uncut rim, the panel is a pocket with 35-degree walls, V-grooves (35-degree walls,
    tapered ends) split the planks, and variants add 35-degree-flanked diagonal braces or a mid
    rail. Every face stays within ~45
    degrees of its side's normal, so each side unwraps as ONE atlas island (no thin slivers)."""
    if variant in _CRATE_CACHE:
        return _CRATE_CACHE[variant]
    b, t, g = 0.12, 0.045, 0.026                # frame width, panel recess, groove width
    run = 1.0 / math.tan(math.radians(SLOPE_DEG))   # horizontal run per metre of depth
    d = (g * 0.5) * math.tan(math.radians(SLOPE_DEG))
    X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
    bm = bmesh.new()
    C.bm_box(bm, (-0.5, -0.5, 0.0), (0.5, 0.5, 1.0))
    core = C.mesh_object_from_bm(f"_crate_core{variant}", bm, ["M_crate"])
    bm.free()
    sides = [(-Y, X, Z, Vector((0, -0.5, 0.5))), (Y, X, Z, Vector((0, 0.5, 0.5))),
             (-X, Y, Z, Vector((-0.5, 0, 0.5))), (X, Y, Z, Vector((0.5, 0, 0.5))),
             (Z, X, Y, Vector((0, 0, 1.0)))]
    cut = bmesh.new()
    open_w = 1.0 - 2 * b
    for (n, a, c, ctr) in sides:
        _frustum(cut, ctr, n, a, c, open_w + 2 * 0.05 * run, open_w + 2 * 0.05 * run,
                 open_w - 2 * t * run, open_w - 2 * t * run, -0.05, t)
    hw_out = (g * 0.5) * (d + 0.01) / d
    side_planks = 4 if variant != 2 else 3
    for (n, a, c, ctr) in sides[:4]:
        for k in range(1, side_planks):
            cc = -0.5 + b + t * run + (open_w - 2 * t * run) * k / side_planks
            _groove(cut, ctr - n * t + c * cc, n, a, c, 0.5 - b - t * run - 0.012, hw_out, d, taper=0.034)
    top_axis, across = (X, Y) if variant != 1 else (Y, X)
    for k in range(1, 5):
        cc = -0.5 + b + t * run + (open_w - 2 * t * run) * k / 5
        _groove(cut, Vector((0, 0, 1.0 - t)) + across * cc, Z, top_axis, across, 0.5 - b - t * run - 0.012, hw_out, d,
                taper=0.034)
    cutter = C.mesh_object_from_bm(f"_crate_cut{variant}", cut, ["M_crate"])
    cut.free()

    add = bmesh.new()
    span = open_w - 2 * t * run
    if variant in (0, 1):
        faces = sides[0:2] if variant == 0 else sides[2:4]
        for k, (n, a, c, ctr) in enumerate(faces):
            ang = math.atan2(span, span) * (1 if k == 0 else -1)
            along = a * math.cos(ang) + c * math.sin(ang)
            acr = -a * math.sin(ang) + c * math.cos(ang)
            _trapezoid_bar(add, ctr, n, along, acr, math.hypot(open_w, open_w) + 0.02, 0.085, t, d + 0.02, run)
    else:
        for (n, a, c, ctr) in sides[:4]:
            _trapezoid_bar(add, ctr, n, a, c, open_w + 0.02, 0.085, t, d + 0.02, run)
    adds = [C.mesh_object_from_bm(f"_crate_add{variant}", add, ["M_crate"])] if add.faces else []
    add.free()

    steps = [("DIFFERENCE", [cutter])] + ([("UNION", adds)] if adds else [])
    me = C.boolean_chain(core, steps)
    bpy.data.objects.remove(core)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    edges = C.sharp_convex_edges(bm, 60.0, exclude=lambda e: all(v.co.z < 1e-3 for v in e.verts))
    C.bevel_edges(bm, edges, 0.028, segments=1)
    C.cleanup_degenerate(bm)
    # drop ONLY the bottom (faces lying on z = 0); groove walls on the sides face partly down
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9 and all(v.co.z < 2e-3 for v in f.verts)],
                     context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    g = _geo_from_bm(f"crate_v{variant}", bm, "M_crate")
    _CRATE_CACHE[variant] = g
    return g


# ── planter (rim paintable, soil solid) ─────────────────────────────────────────────────────────
def planter(w: float, h: float, d: float):
    """Raised planter box. Returns {'shell': paint Geo (M_planter walls + M_concrete cap),
    'soil': solid Geo (M_soil top, soil mound, pebbles), 'soil_z': soil height}. The inner lip
    slopes at SLOPE_DEG so the rim + lip unwrap as one atlas island."""
    rim, cap_h, sd = 0.15, 0.1, 0.14            # flat rim width, concrete cap band, soil depth
    soil_z = h - sd
    run = 1.0 / math.tan(math.radians(SLOPE_DEG))
    wall = rim + sd * run                        # cavity floor inset (sloped inner lip)
    bm = bmesh.new()
    C.bm_box(bm, (-w / 2, -d / 2, 0.0), (w / 2, d / 2, h - cap_h), 0)
    base = C.mesh_object_from_bm("_pl_base", bm, ["M_planter", "M_concrete"])
    bm.free()
    cbm = bmesh.new()
    C.bm_box(cbm, (-w / 2, -d / 2, h - cap_h), (w / 2, d / 2, h), 1)
    cap = C.mesh_object_from_bm("_pl_cap", cbm, ["M_planter", "M_concrete"])
    cbm.free()
    ibm = bmesh.new()
    _frustum(ibm, Vector((0, 0, h)), Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, 1, 0)),
             w - 2 * rim + 0.1 * run, d - 2 * rim + 0.1 * run, w - 2 * wall, d - 2 * wall, -0.05, sd)
    for f in ibm.faces:
        f.material_index = 1
    hole = C.mesh_object_from_bm("_pl_hole", ibm, ["M_planter", "M_concrete"])
    ibm.free()
    me = C.boolean_chain(base, [("UNION", [cap]), ("DIFFERENCE", [hole])])
    bpy.data.objects.remove(base)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    edges = C.sharp_convex_edges(bm, 60.0, exclude=lambda e: all(v.co.z < 1e-3 for v in e.verts))
    C.bevel_edges(bm, edges, 0.035, segments=2)
    C.cleanup_degenerate(bm)
    bm.faces.ensure_lookup_table()
    names = ["M_planter", "M_concrete"]
    shell, soil = Geo("planter_shell"), Geo("planter_soil")
    keep_shell, keep_soil = [], []
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.z < -0.9 and all(v.co.z < 2e-3 for v in f.verts):
            continue                                           # bottom: dropped
        if f.normal.z > 0.9 and abs(c.z - soil_z) < 0.02 and abs(c.x) < w / 2 - wall + 0.01                 and abs(c.y) < d / 2 - wall + 0.01:
            keep_soil.append((f, "M_soil"))
        else:
            keep_shell.append((f, names[f.material_index]))
    for geo, lst in ((shell, keep_shell), (soil, keep_soil)):
        vmap = {}
        for f, m in lst:
            idx = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = len(geo.verts)
                    geo.verts.append(v.co.copy())
                idx.append(vmap[v])
            geo.faces.append(tuple(idx))
            geo.fmat.append(m)
            geo.fsmooth.append(False)
    bm.free()
    # soil mound around the trunk + a few pebbles (solid, not paintable)
    rnd = C.rng("planter", w, h, d)
    mbm = bmesh.new()
    prof = [(0.0, soil_z + 0.13), (0.3, soil_z + 0.11), (0.55, soil_z + 0.05), (0.72, soil_z - 0.01)]
    C.bm_lathe(mbm, prof, seg=14)
    soil.add_bm(mbm, "M_soil", smooth=True)
    mbm.free()
    pbm = bmesh.new()
    for k in range(6):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.62, min(w, d) / 2 - wall - 0.08)
        s = rnd.uniform(0.07, 0.12)
        _rock(pbm, (r * math.cos(a), r * math.sin(a), soil_z + 0.01), (s, s * 1.2, s), rnd, flat=0.6)
    soil.add_bm(pbm, "M_rock")
    pbm.free()
    return {"shell": shell, "soil": soil, "soil_z": soil_z}


# ── palm (trunk solid, fronds deco) ─────────────────────────────────────────────────────────────
def palm(seed: str, base_z: float):
    rnd = C.rng("palm", seed)
    H = rnd.uniform(4.5, 5.3)
    lean = rnd.uniform(0.75, 1.25)
    phi = rnd.uniform(0, math.tau)
    nseg, sides = 11, 9

    def P(t):
        return Vector((lean * t * t * math.cos(phi), lean * t * t * math.sin(phi), base_z - 0.05 + H * t))

    def T(t):
        return Vector((2 * lean * t * math.cos(phi), 2 * lean * t * math.sin(phi), H)).normalized()

    def R(t):
        return (0.19 - 0.065 * t) * (1.0 + 0.45 * (1.0 - t) ** 8)

    bm = bmesh.new()
    rings = []
    side_prev = None
    for i in range(nseg):
        for (t, k) in ((i / nseg, 0.86), ((i + 1) / nseg - 0.004, 1.07)):
            p, tt = P(t), T(t)
            ref = Vector((1, 0, 0))
            side = tt.cross(ref).normalized() if side_prev is None else (side_prev - tt * side_prev.dot(tt)).normalized()
            side_prev = side
            up = side.cross(tt).normalized()
            r = R(t) * k
            rings.append([bm.verts.new(p + (side * math.cos(2 * math.pi * s / sides) + up * math.sin(2 * math.pi * s / sides)) * r)
                          for s in range(sides)])
    for a, b in zip(rings[:-1], rings[1:]):
        for s in range(sides):
            j = (s + 1) % sides
            bm.faces.new((a[s], a[j], b[j], b[s]))
    top = P(1.0)
    cap = bm.verts.new(top + T(1.0) * 0.06)
    last = rings[-1]
    for s in range(sides):
        bm.faces.new((last[s], last[(s + 1) % sides], cap))
    C.bm_fix_normals(bm)
    trunk = _geo_from_bm("palm_trunk", bm, "M_palm_trunk", smooth=True)

    fronds = Geo("palm_fronds")
    # crownshaft bulb + coconuts
    cbm = bmesh.new()
    verts = C.bm_icosphere(cbm, 0.24, 1, Matrix.Translation(top + Vector((0, 0, 0.02))) @ Matrix.Diagonal((1, 1, 0.8, 1)))
    fronds.add_bm(cbm, "M_palm_trunk", smooth=True)
    cbm.free()
    nbm = bmesh.new()
    for k in range(3):
        a = phi + math.pi + (k - 1) * 0.7
        c = top + Vector((0.2 * math.cos(a), 0.2 * math.sin(a), -0.2))
        C.bm_icosphere(nbm, 0.11, 1, Matrix.Translation(c))
    fronds.add_bm(nbm, "M_palm_trunk", smooth=True)
    nbm.free()

    nf = rnd.choice((7, 8, 9))
    up = Vector((0, 0, 1))
    for k in range(nf):
        az = 2 * math.pi * k / nf + rnd.uniform(-0.22, 0.22)
        el = rnd.uniform(0.45, 0.85)
        L = rnd.uniform(2.3, 3.0)
        droop = rnd.uniform(0.35, 0.65)
        wmax = rnd.uniform(0.40, 0.50)
        dirh = Vector((math.cos(az), math.sin(az), 0))
        p0 = top + Vector((0, 0, 0.05))
        p1 = p0 + dirh * (L * 0.45) + up * (L * 0.55 * math.sin(el))
        p2 = p0 + dirh * (L * 0.95) - up * (L * droop)
        N = 14
        fbm = bmesh.new()
        spine, left, right = [], [], []
        for i in range(N + 1):
            s = i / N
            pt = p0 * (1 - s) ** 2 + p1 * 2 * (1 - s) * s + p2 * s * s
            tg = ((p1 - p0) * 2 * (1 - s) + (p2 - p1) * 2 * s).normalized()
            lat = tg.cross(up).normalized()
            nrm = lat.cross(tg).normalized()
            if s < 0.12:
                wd = 0.035
            else:
                u = (s - 0.12) / 0.88
                wd = wmax * math.sin(math.pi * min(1.0, u * 1.08)) ** 0.75 * (1.0 - 0.3 * u)
            if i % 2 == 1 and 0.12 <= s < 0.98:
                wd *= 0.6  # leaflet notches
            fold = -nrm * wd * 0.38
            spine.append(fbm.verts.new(pt))
            left.append(fbm.verts.new(pt + lat * wd + fold))
            right.append(fbm.verts.new(pt - lat * wd + fold))
        for i in range(N):
            fbm.faces.new((left[i], spine[i], spine[i + 1], left[i + 1]))
            fbm.faces.new((spine[i], right[i], right[i + 1], spine[i + 1]))
        fronds.add_bm(fbm, "M_palm_leaf", smooth=True)
        fbm.free()
    return {"trunk": trunk, "fronds": fronds, "top": top}


# ── spawn pad (solid, never paintable) ─────────────────────────────────────────────────────────
def spawn_pad(team: str, radius: float = 2.2, depth: float = 0.32) -> Geo:
    """Chunky pad: dark slate disc flush with the deck (top at z = 0), a raised rounded team
    ring, and the team mark inlaid at the centre (A = sun-disc dot, B = wave-peak triangle
    pointing forward). Materials: M_metal (dark) + M_pad_<team>."""
    R = radius
    team_mat = f"M_pad_{team}"
    names = ["M_metal", team_mat]
    ring_in = R * 0.69
    ring_out = R * 0.895
    bm = bmesh.new()
    prof = [(ring_in, 0.0), (ring_in + 0.035, 0.035), (ring_in + 0.1, 0.085), (0.5 * (ring_in + ring_out), 0.105),
            (ring_out - 0.1, 0.085), (ring_out - 0.035, 0.035), (ring_out, 0.0),
            (R - 0.06, 0.0), (R, -0.05), (R, -depth)]
    mats = [1, 1, 1, 1, 1, 1, 0, 0, 0]
    C.bm_lathe(bm, prof, seg=64, mats=mats)
    seg = 64
    circle = [(ring_in * math.cos(2 * math.pi * i / seg), ring_in * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
    if team == "A":
        dot = R * 0.24
        inner = [(dot * math.cos(2 * math.pi * i / seg), dot * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        outer_v = [bm.verts.new((x, y, 0.0)) for (x, y) in circle]
        inner_v = [bm.verts.new((x, y, 0.0)) for (x, y) in inner]
        for i in range(seg):
            j = (i + 1) % seg
            f = bm.faces.new((inner_v[i], outer_v[i], outer_v[j], inner_v[j]))
            f.material_index = 0
        cen = bm.verts.new((0, 0, 0))
        for i in range(seg):
            f = bm.faces.new((cen, inner_v[i], inner_v[(i + 1) % seg]))
            f.material_index = 1
    else:
        s = R * 0.36
        tri = [(0.0, -s * 1.15), (s, s * 0.62), (-s, s * 0.62)]  # apex toward forward (-Y)
        pts2 = circle + tri
        outer_v = [bm.verts.new((x, y, 0.0)) for (x, y) in circle]
        tri_v = [bm.verts.new((x, y, 0.0)) for (x, y) in tri]
        allv = outer_v + tri_v
        tris = geometry.tessellate_polygon([[Vector((x, y, 0)) for (x, y) in circle], [Vector((x, y, 0)) for (x, y) in tri]])
        for (a, b2, c) in tris:
            f = bm.faces.new((allv[a], allv[b2], allv[c]))
            f.material_index = 0
        f = bm.faces.new(tri_v)
        f.material_index = 1
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    # lathe + fan faces are wound outward by construction (open bottom, so no recalc); only the
    # tessellated emblem-surround triangles can come out facing down
    for f in bm.faces:
        if f.normal.z < -0.5:
            f.normal_flip()
    g = Geo(f"pad_{team}")
    g.add_bm(bm, None, mat_names=names, smooth=False)
    bm.free()
    return g


# ── lamp + bollard (solid) ──────────────────────────────────────────────────────────────────────
def lamp() -> Geo:
    g = Geo("lamp")
    bm = bmesh.new()
    C.bm_lathe(bm, [(0.075, 0.26), (0.09, 0.22), (0.14, 0.12), (0.21, 0.06), (0.21, 0.0), (0.0, 0.0)], seg=14)
    C.bm_cylinder(bm, 0.075, 0.06, 0.26, 4.0, seg=12, cap0=False, cap1=True)
    C.bm_cylinder(bm, 0.098, 0.098, 0.9, 0.98, seg=12)
    pts = [Vector((0, 0, 3.9)), Vector((0, -0.08, 4.12)), Vector((0, -0.32, 4.22)), Vector((0, -0.62, 4.2)), Vector((0, -0.86, 4.1))]
    C.bm_tube(bm, pts, 0.045, seg=8)
    g.add_bm(bm, "M_metal", smooth=True)
    bm.free()
    hbm = bmesh.new()
    C.bm_lathe(hbm, [(0.0, 0.25), (0.1, 0.23), (0.24, 0.12), (0.31, 0.02), (0.32, -0.02)], seg=18)
    C.bm_transform(hbm, Matrix.Translation((0, -0.92, 3.94)))
    g.add_bm(hbm, "M_paint_trim", smooth=True)
    hbm.free()
    lbm = bmesh.new()
    C.bm_lathe(lbm, [(0.32, -0.02), (0.26, -0.09), (0.12, -0.13), (0.0, -0.14)], seg=18)
    C.bm_transform(lbm, Matrix.Translation((0, -0.92, 3.94)))
    g.add_bm(lbm, "M_lamp", smooth=True)
    lbm.free()
    return g


def bollard() -> Geo:
    prof = [(0.0, 0.97), (0.21, 0.94), (0.25, 0.87), (0.24, 0.8), (0.17, 0.74), (0.16, 0.62), (0.175, 0.14),
            (0.21, 0.09), (0.26, 0.05), (0.26, 0.0), (0.0, 0.0)]
    bm = bmesh.new()
    C.bm_lathe(bm, prof, seg=16)
    g = Geo("bollard")
    g.add_bm(bm, "M_metal", smooth=True)
    bm.free()
    bbm = bmesh.new()
    C.bm_cylinder(bbm, 0.172, 0.172, 0.46, 0.56, seg=16)
    g.add_bm(bbm, "M_hazard", smooth=True)
    bbm.free()
    return g


def rope_coil_and_line(neck_center: Vector, out_dir: Vector, water_z: float, seed: str) -> Geo:
    """A mooring line: two turns around a bollard neck, then a sagging run over the pier edge
    into the water (Blender world coords)."""
    rnd = C.rng("rope", seed)
    g = Geo("rope")
    bm = bmesh.new()
    for k, dz in enumerate((0.0, 0.07)):
        pts = []
        for i in range(17):
            a = 2 * math.pi * i / 16
            pts.append(neck_center + Vector((0.2 * math.cos(a), 0.2 * math.sin(a), dz + 0.015 * math.sin(a * 2))))
        C.bm_tube(bm, pts, 0.032, seg=6, cap=False)
    od = Vector((out_dir.x, out_dir.y, 0)).normalized()
    start = neck_center + od * 0.2
    end = neck_center + od * rnd.uniform(2.6, 3.4) + Vector((0, 0, water_z - neck_center.z - 0.2))
    pts = []
    for i in range(9):
        s = i / 8
        p = start.lerp(end, s)
        p.z += 0.25 * math.sin(math.pi * s) * (1 - s)
        pts.append(p)
    C.bm_tube(bm, pts, 0.035, seg=6)
    g.add_bm(bm, "M_rope", smooth=True)
    bm.free()
    return g


# ── pilings under the pier (deco) ───────────────────────────────────────────────────────────────
def pilings(half_x: float, half_y: float, slab_bottom: float, water_z: float, seed: str = "pier") -> Geo:
    """Perimeter + inner-row pilings, a stringer beam under the fascia and X-bracing on the
    outside of the outer row (Blender world coords about the pier centre)."""
    g = Geo("pilings")
    bm = bmesh.new()
    mbm = bmesh.new()
    inset, spacing = 0.75, 3.6
    z_lo = water_z - 3.0
    for ring, (ring_inset, rad) in enumerate(((inset, 0.3), (inset + 4.0, 0.26))):
        hx, hy = half_x - ring_inset, half_y - ring_inset
        corners = [(-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy)]
        outward = [(0.0, -1.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)]
        for k in range(4):
            (ax, ay), (bx, by) = corners[k], corners[(k + 1) % 4]
            n = max(1, round(math.hypot(bx - ax, by - ay) / spacing))
            pts = [(ax + (bx - ax) * i / n, ay + (by - ay) * i / n) for i in range(n + 1)]
            for (x, y) in pts[:-1]:
                C.bm_cylinder(bm, rad, rad * 0.92, z_lo, slab_bottom, seg=10, cap0=False, cap1=False, center=(x, y))
            if ring:
                continue
            ox, oy = outward[k]
            # stringer beam under the slab edge
            x0, x1 = sorted((ax, bx))
            y0, y1 = sorted((ay, by))
            C.bm_box(bm, (x0 - 0.3, y0 - 0.3, slab_bottom - 0.45), (x1 + 0.3, y1 + 0.3, slab_bottom))
            zt, zb = slab_bottom - 0.5, water_z + 0.15
            for i in range(n):
                (xa, ya), (xb, yb) = pts[i], pts[i + 1]
                pa = Vector((xa + ox * 0.36, ya + oy * 0.36, 0))
                pb = Vector((xb + ox * 0.36, yb + oy * 0.36, 0))
                C.bm_tube(mbm, [Vector((pa.x, pa.y, zt)), Vector((pb.x, pb.y, zb))], 0.07, seg=5)
                C.bm_tube(mbm, [Vector((pa.x, pa.y, zb)), Vector((pb.x, pb.y, zt))], 0.07, seg=5)
    g.add_bm(bm, "M_concrete", smooth=False)
    g.add_bm(mbm, "M_metal", smooth=True)
    bm.free()
    mbm.free()
    return g


# ── billboard on stilts (deco) ─────────────────────────────────────────────────────────────────
def billboard(text: str, width: float = 24.0, height: float = 5.6, bottom: float = 6.2) -> Geo:
    """Big over-water board on stilts, lettering on the forward (-Y) face. Origin = water level."""
    g = Geo("billboard")
    W, H, T, z0 = width, height, 0.5, bottom
    # board panel + back ribs
    bm = bmesh.new()
    C.bm_box(bm, (-W / 2, -T / 2, z0), (W / 2, T / 2, z0 + H))
    g.add_bm(bm, "M_billboard")
    bm.free()
    # red frame, proud of the face
    fbm = bmesh.new()
    fw, fp = 0.42, 0.2
    y0, y1 = -T / 2 - fp, -T / 2 + 0.02
    C.bm_box(fbm, (-W / 2 - 0.05, y0, z0 - 0.05), (W / 2 + 0.05, T / 2 + 0.05, z0 + fw))
    C.bm_box(fbm, (-W / 2 - 0.05, y0, z0 + H - fw), (W / 2 + 0.05, T / 2 + 0.05, z0 + H + 0.05))
    C.bm_box(fbm, (-W / 2 - 0.05, y0, z0 + fw), (-W / 2 + fw, T / 2 + 0.05, z0 + H - fw))
    C.bm_box(fbm, (W / 2 - fw, y0, z0 + fw), (W / 2 + 0.05, T / 2 + 0.05, z0 + H - fw))
    edges = C.sharp_convex_edges(fbm, 60.0)
    C.bevel_edges(fbm, edges, 0.05, segments=2)
    g.add_bm(fbm, "M_paint_trim")
    fbm.free()
    # lettering
    tbm = text_bm(text, depth=0.26, bevel=0.018)
    fit_text(tbm, W - 2 * fw - 2.2, H - 2 * fw - 1.3, Vector((0, -T / 2 + 0.01, z0 + H / 2)))
    g.add_bm(tbm, "M_sign_text")
    tbm.free()
    # stilts: legs behind the board, concrete caissons, bracing, catwalk, floodlights
    mbm = bmesh.new()
    cbm = bmesh.new()
    legs = [(x, y) for x in (-8.0, 0.0, 8.0) for y in (T / 2 + 0.28, T / 2 + 2.3)]
    for (x, y) in legs:
        C.bm_box(mbm, (x - 0.24, y - 0.24, 0.35), (x + 0.24, y + 0.24, z0 + H - 0.2))
        C.bm_cylinder(cbm, 0.72, 0.62, -2.5, 0.35, seg=12, cap0=False, center=(x, y))
    for x in (-8.0, 0.0, 8.0):
        ya, yb = T / 2 + 0.28, T / 2 + 2.3
        for (za, zb) in ((0.6, z0 - 0.4), (z0 - 0.4, 0.6)):
            C.bm_tube(mbm, [Vector((x, ya, za)), Vector((x, yb, zb))], 0.09, seg=6)
        for zz in (z0 * 0.5, z0 - 0.6):
            C.bm_box(mbm, (x - 0.12, ya, zz - 0.12), (x + 0.12, yb, zz + 0.12))
    for (xa, xb) in ((-8.0, 0.0), (0.0, 8.0)):
        yb = T / 2 + 2.3
        for (za, zb) in ((0.6, z0 - 0.4), (z0 - 0.4, 0.6)):
            C.bm_tube(mbm, [Vector((xa, yb, za)), Vector((xb, yb, zb))], 0.09, seg=6)
    # catwalk under the board, in front
    cw_z = z0 - 0.95
    C.bm_box(mbm, (-W / 2 + 0.2, -1.55, cw_z - 0.12), (W / 2 - 0.2, T / 2 + 0.5, cw_z))
    for x in [(-W / 2 + 0.4) + i * ((W - 0.8) / 12) for i in range(13)]:
        C.bm_box(mbm, (x - 0.04, -1.5, cw_z), (x + 0.04, -1.42, cw_z + 1.0))
        C.bm_tube(mbm, [Vector((x, -1.35, cw_z - 0.1)), Vector((x, T / 2 + 0.3, cw_z - 1.3))], 0.05, seg=5)
    C.bm_tube(mbm, [Vector((-W / 2 + 0.3, -1.46, cw_z + 1.0)), Vector((W / 2 - 0.3, -1.46, cw_z + 1.0))], 0.05, seg=6)
    C.bm_tube(mbm, [Vector((-W / 2 + 0.3, -1.46, cw_z + 0.5)), Vector((W / 2 - 0.3, -1.46, cw_z + 0.5))], 0.035, seg=6)
    lbm = bmesh.new()
    for x in (-8.5, 0.0, 8.5):
        C.bm_tube(mbm, [Vector((x, -1.46, cw_z + 1.0)), Vector((x, -2.1, cw_z + 1.55))], 0.05, seg=6)
        C.bm_oriented_box(mbm, (x, -2.2, cw_z + 1.62), (0.7, 0.36, 0.34), Matrix.Rotation(math.radians(-35), 3, "X"))
        C.bm_oriented_box(lbm, (x, -2.08, cw_z + 1.74), (0.6, 0.06, 0.26), Matrix.Rotation(math.radians(-35), 3, "X"))
    g.add_bm(mbm, "M_metal", smooth=False)
    g.add_bm(cbm, "M_concrete", smooth=True)
    g.add_bm(lbm, "M_lamp")
    mbm.free()
    cbm.free()
    lbm.free()
    return g


def banner(text: str, width: float = 6.6, height: float = 1.12, lift: float = 0.5) -> Geo:
    """Deck banner on two posts; lettering on the forward (-Y) face. Origin = base centre."""
    g = Geo("banner")
    W, H = width, height
    z0, z1 = lift, lift + H
    th = 0.035
    hem = 0.11
    bm = bmesh.new()
    C.bm_box(bm, (-W / 2, -th / 2, z0 + hem), (W / 2, th / 2, z1 - hem))
    g.add_bm(bm, "M_billboard")
    bm.free()
    hbm = bmesh.new()
    C.bm_box(hbm, (-W / 2, -th / 2 - 0.004, z0), (W / 2, th / 2 + 0.004, z0 + hem))
    C.bm_box(hbm, (-W / 2, -th / 2 - 0.004, z1 - hem), (W / 2, th / 2 + 0.004, z1))
    g.add_bm(hbm, "M_paint_trim")
    hbm.free()
    pbm = bmesh.new()
    for x in (-W / 2 - 0.08, W / 2 + 0.08):
        C.bm_cylinder(pbm, 0.055, 0.05, 0.0, z1 + 0.18, seg=10, center=(x, 0.0))
        for zz in (z0 + 0.06, z1 - 0.06):
            C.bm_tube(pbm, [Vector((x, 0, zz)), Vector((x - math.copysign(0.1, x), 0, zz))], 0.02, seg=5)
    g.add_bm(pbm, "M_metal", smooth=True)
    pbm.free()
    kbm = bmesh.new()
    for x in (-W / 2 - 0.08, W / 2 + 0.08):
        C.bm_icosphere(kbm, 0.075, 1, Matrix.Translation((x, 0, z1 + 0.22)))
    g.add_bm(kbm, "M_paint_trim", smooth=True)
    kbm.free()
    tbm = text_bm(text, depth=0.03, bevel=0.0)
    fit_text(tbm, W - 0.7, H - 2 * hem - 0.2, Vector((0, -th / 2 + 0.002, (z0 + z1) / 2)))
    g.add_bm(tbm, "M_sign_text")
    tbm.free()
    return g


def buoy(kind: str, seed: str) -> Geo:
    """Floating channel buoy (deco). kind 'red' = red/white can with a lantern cage,
    'yellow' = yellow special-mark sphere with an X topmark. Origin = waterline."""
    rnd = C.rng("buoy", seed)
    g = Geo("buoy")
    if kind == "red":
        b1 = bmesh.new()
        C.bm_lathe(b1, [(0.0, 1.05), (0.5, 1.05), (0.58, 0.95), (0.58, 0.55)], seg=16)
        C.bm_lathe(b1, [(0.58, 0.2), (0.62, -0.1), (0.5, -0.5), (0.0, -0.55)], seg=16)
        g.add_bm(b1, "M_paint_trim", smooth=True)
        b1.free()
        b2 = bmesh.new()
        C.bm_cylinder(b2, 0.585, 0.585, 0.2, 0.55, seg=16, cap0=False, cap1=False)
        g.add_bm(b2, "M_hull", smooth=True)
        b2.free()
        b3 = bmesh.new()
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            C.bm_tube(b3, [Vector((0.34 * math.cos(a), 0.34 * math.sin(a), 1.05)), Vector((0.12 * math.cos(a), 0.12 * math.sin(a), 2.0))], 0.035, seg=5)
        C.bm_cylinder(b3, 0.16, 0.14, 1.95, 2.05, seg=10)
        g.add_bm(b3, "M_metal", smooth=True)
        b3.free()
        b4 = bmesh.new()
        C.bm_cylinder(b4, 0.1, 0.1, 2.05, 2.28, seg=10)
        g.add_bm(b4, "M_lamp", smooth=True)
        b4.free()
    else:
        b1 = bmesh.new()
        C.bm_icosphere(b1, 0.7, 2, Matrix.Translation((0, 0, 0.25)) @ Matrix.Diagonal((1, 1, 0.9, 1)))
        C.bm_cylinder(b1, 0.06, 0.06, 0.8, 1.9, seg=8)
        for ang in (45.0, -45.0):
            C.bm_oriented_box(b1, (0, 0, 2.1), (0.62, 0.1, 0.12), Matrix.Rotation(math.radians(ang), 3, "Y"))
        g.add_bm(b1, "M_hazard", smooth=True)
        b1.free()
    tilt = Matrix.Rotation(math.radians(rnd.uniform(-6, 6)), 4, "X") @ Matrix.Rotation(math.radians(rnd.uniform(-6, 6)), 4, "Y")
    g.verts = [tilt @ v for v in g.verts]
    return g


def pennant(team: str, seed: str) -> Geo:
    """Team pennant on a pole (deco). Origin = pole foot; the flag streams toward local +X."""
    rnd = C.rng("pennant", seed)
    g = Geo("pennant")
    H = 4.6
    pbm = bmesh.new()
    C.bm_cylinder(pbm, 0.05, 0.04, 0.0, H, seg=8)
    C.bm_icosphere(pbm, 0.08, 1, Matrix.Translation((0, 0, H + 0.04)))
    C.bm_cylinder(pbm, 0.14, 0.12, 0.0, 0.08, seg=10)
    g.add_bm(pbm, "M_metal", smooth=True)
    pbm.free()
    fbm = bmesh.new()
    L, Hf, cols = 2.1, 1.05, 8
    phase = rnd.uniform(0, math.tau)
    top, bot = [], []
    for i in range(cols + 1):
        u = i / cols
        wave = 0.16 * u * math.sin(phase + u * 5.0)
        half = (Hf / 2) * (1.0 - u * 0.92)
        zc = H - 0.1 - Hf / 2 - 0.12 * u
        top.append(fbm.verts.new((u * L, wave, zc + half)))
        bot.append(fbm.verts.new((u * L, wave, zc - half)))
    for i in range(cols):
        fbm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
    g.add_bm(fbm, f"M_pad_{team}", smooth=True)
    fbm.free()
    return g


# ── lighthouse + breakwater (deco) ─────────────────────────────────────────────────────────────
def lighthouse(seed: str = "lighthouse") -> Geo:
    rnd = C.rng(seed)
    g = Geo("lighthouse")
    rbm = bmesh.new()
    for k in range(16):
        a = 2 * math.pi * k / 16 + rnd.uniform(-0.15, 0.15)
        r = rnd.uniform(3.3, 5.6)
        s = rnd.uniform(1.8, 3.0)
        _rock(rbm, (r * math.cos(a), r * math.sin(a), rnd.uniform(-0.3, 0.6)), (s, s * rnd.uniform(0.8, 1.2), s), rnd, flat=0.65)
    g.add_bm(rbm, "M_rock")
    rbm.free()
    pbm = bmesh.new()
    C.bm_lathe(pbm, [(0.0, 2.6), (3.2, 2.6), (3.45, 2.35), (3.45, -0.8)], seg=8, phase=math.pi / 8)
    g.add_bm(pbm, "M_concrete")
    pbm.free()
    # banded tower
    zb, zt, r0, r1 = 2.6, 17.0, 2.15, 1.38
    bands = 6
    for i in range(bands):
        za = zb + (zt - zb) * i / bands
        zc = zb + (zt - zb) * (i + 1) / bands
        ra = r0 + (r1 - r0) * i / bands
        rc = r0 + (r1 - r0) * (i + 1) / bands
        tb = bmesh.new()
        C.bm_cylinder(tb, ra, rc, za, zc, seg=20, cap0=False, cap1=(i == bands - 1))
        g.add_bm(tb, "M_lighthouse" if i % 2 == 0 else "M_paint_trim", smooth=True)
        tb.free()
    # door + windows
    wbm = bmesh.new()
    C.bm_box(wbm, (-0.5, -r0 - 0.06, zb), (0.5, -r0 + 0.3, zb + 2.1))
    for (z, a) in ((7.0, 0.4), (10.6, -0.9), (14.2, 1.9)):
        rr = r0 + (r1 - r0) * (z - zb) / (zt - zb)
        m = Matrix.Rotation(a, 4, "Z")
        verts_before = set(wbm.verts)
        C.bm_box(wbm, (-0.28, -rr - 0.06, z), (0.28, -rr + 0.25, z + 0.8))
        C.bm_transform(wbm, m, [v for v in wbm.verts if v not in verts_before])
    g.add_bm(wbm, "M_metal")
    wbm.free()
    # gallery, railing, lantern, dome
    gbm = bmesh.new()
    C.bm_cylinder(gbm, 2.25, 2.25, zt, zt + 0.3, seg=20)
    for k in range(20):
        a = 2 * math.pi * k / 20
        C.bm_cylinder(gbm, 0.04, 0.04, zt + 0.3, zt + 1.3, seg=5, center=(2.1 * math.cos(a), 2.1 * math.sin(a)))
    ring = [Vector((2.1 * math.cos(2 * math.pi * i / 24), 2.1 * math.sin(2 * math.pi * i / 24), zt + 1.3)) for i in range(25)]
    C.bm_tube(gbm, ring, 0.05, seg=6, cap=False)
    for k in range(6):
        a = 2 * math.pi * k / 6
        C.bm_cylinder(gbm, 0.07, 0.07, zt + 0.3, zt + 2.1, seg=5, center=(1.12 * math.cos(a), 1.12 * math.sin(a)))
    C.bm_cylinder(gbm, 0.1, 0.03, zt + 3.35, zt + 4.1, seg=6)
    g.add_bm(gbm, "M_metal", smooth=True)
    gbm.free()
    lbm = bmesh.new()
    C.bm_cylinder(lbm, 1.1, 1.1, zt + 0.3, zt + 2.1, seg=12, cap0=False, cap1=False)
    g.add_bm(lbm, "M_glass")
    lbm.free()
    ibm = bmesh.new()
    C.bm_cylinder(ibm, 0.45, 0.45, zt + 0.7, zt + 1.6, seg=10)
    g.add_bm(ibm, "M_lamp", smooth=True)
    ibm.free()
    dbm = bmesh.new()
    C.bm_lathe(dbm, [(0.0, zt + 3.38), (0.3, zt + 3.3), (0.8, zt + 3.0), (1.2, zt + 2.55), (1.35, zt + 2.1)], seg=16)
    g.add_bm(dbm, "M_paint_trim", smooth=True)
    dbm.free()
    return g


def breakwater(points: list[Vector], seed: str = "breakwater") -> Geo:
    """Rock-armoured jetty with a concrete crest along a polyline (Blender coords, z = water)."""
    rnd = C.rng(seed)
    g = Geo("breakwater")
    rbm = bmesh.new()
    cbm = bmesh.new()
    step = 1.9
    stations = []
    for a, b in zip(points[:-1], points[1:]):
        L = (b - a).length
        n = max(1, int(L / step))
        for i in range(n):
            stations.append((a.lerp(b, i / n), (b - a).normalized()))
    stations.append((points[-1], (points[-1] - points[-2]).normalized()))
    for i, (p, d) in enumerate(stations):
        side = Vector((-d.y, d.x, 0))
        for off in (-2.3, 2.3):
            s = rnd.uniform(1.6, 2.5)
            c = p + side * (off + rnd.uniform(-0.4, 0.4)) + d * rnd.uniform(-0.5, 0.5)
            c.z = rnd.uniform(-0.2, 0.35)
            _rock(rbm, c, (s, s * rnd.uniform(0.8, 1.3), s), rnd, flat=0.62)
    for a, b in zip(points[:-1], points[1:]):
        d = (b - a)
        L = d.length
        d.normalize()
        ang = math.atan2(d.y, d.x)
        mid = (a + b) * 0.5
        C.bm_oriented_box(cbm, (mid.x, mid.y, 0.35), (L + 1.6, 2.6, 1.9), Matrix.Rotation(ang, 3, "Z"))
    edges = C.sharp_convex_edges(cbm, 60.0)
    C.bevel_edges(cbm, edges, 0.08, segments=1)
    g.add_bm(rbm, "M_rock")
    g.add_bm(cbm, "M_concrete")
    rbm.free()
    cbm.free()
    return g


# ── distant port: cranes, quay, container yard, ship (deco) ───────────────────────────────────
def cranes(seed: str = "cranes") -> Geo:
    """Quay runs along local Y; the water side (and the booms) face local +X."""
    rnd = C.rng(seed)
    g = Geo("cranes")
    qbm = bmesh.new()
    C.bm_box(qbm, (-62.0, -70.0, -2.0), (0.0, 70.0, 2.6))
    g.add_bm(qbm, "M_concrete")
    qbm.free()
    cr, mt, wh, rd = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()
    gl = bmesh.new()
    for yc in (-36.0, 0.0, 36.0):
        for x in (-24.0, -4.0):
            for y in (yc - 8.0, yc + 8.0):
                C.bm_box(cr, (x - 0.7, y - 0.7, 2.6), (x + 0.7, y + 0.7, 31.0))
            C.bm_box(cr, (x - 0.6, yc - 8.0, 14.0), (x + 0.6, yc + 8.0, 15.2))
        for y in (yc - 8.0, yc + 8.0):
            C.bm_box(cr, (-24.0, y - 0.6, 29.8), (-4.0, y + 0.6, 31.0))
            C.bm_box(cr, (-24.0, y - 0.5, 5.0), (-4.0, y + 0.5, 6.0))
        C.bm_box(cr, (-44.0, yc - 1.6, 31.0), (50.0, yc + 1.6, 34.2))
        for y in (yc - 2.6, yc + 2.6):
            C.bm_box(cr, (-9.5, y - 0.55, 34.2), (-8.4, y + 0.55, 52.0))
        C.bm_box(cr, (-9.5, yc - 3.2, 51.0), (-8.4, yc + 3.2, 52.2))
        for (xe, ze) in ((49.0, 34.2), (-43.0, 34.2), (22.0, 34.2)):
            C.bm_tube(mt, [Vector((-9.0, yc, 51.6)), Vector((xe, yc, ze))], 0.22, seg=5)
        C.bm_box(wh, (-36.0, yc - 3.0, 34.2), (-22.0, yc + 3.0, 39.5))
        C.bm_box(rd, (-36.2, yc - 3.2, 39.5), (-21.8, yc + 3.2, 40.1))
        C.bm_box(rd, (46.0, yc - 1.7, 30.8), (50.4, yc + 1.7, 34.4))
        C.bm_box(wh, (4.0, yc - 1.5, 27.5), (8.0, yc + 1.5, 31.0))
        C.bm_box(gl, (3.8, yc - 1.3, 28.4), (8.2, yc + 1.3, 30.2))
    g.add_bm(cr, "M_crane")
    g.add_bm(mt, "M_metal", smooth=True)
    g.add_bm(wh, "M_hull")
    g.add_bm(rd, "M_paint_trim")
    g.add_bm(gl, "M_glass")
    for b in (cr, mt, wh, rd, gl):
        b.free()
    # container yard behind the cranes
    colors = ("M_paint_trim", "M_crane", "M_hull", "M_metal", "M_sand")
    per = {c: bmesh.new() for c in colors}
    for row in range(7):
        x = -57.0 + row * 3.1
        for col in range(9):
            y = -60.0 + col * 13.4
            hgt = rnd.choice((1, 2, 2, 3, 3, 4))
            for k in range(hgt):
                c = rnd.choice(colors)
                C.bm_box(per[c], (x, y, 2.6 + k * 2.6), (x + 2.44, y + 12.2, 2.6 + (k + 1) * 2.6 - 0.05))
    # moored container ship (outboard of the quay)
    sbm = bmesh.new()
    hull = [(3.0, 8.0), (25.0, 8.0), (25.0, 62.0), (14.0, 74.0), (3.0, 62.0)]
    lo = [sbm.verts.new((x, y, -3.0)) for (x, y) in hull]
    hi = [sbm.verts.new((x, y, 7.0)) for (x, y) in hull]
    sbm.faces.new(list(reversed(lo)))
    sbm.faces.new(hi)
    for i in range(len(hull)):
        j = (i + 1) % len(hull)
        sbm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    C.bm_fix_normals(sbm)
    g.add_bm(sbm, "M_metal")
    sbm.free()
    hbm = bmesh.new()
    C.bm_box(hbm, (5.0, 10.0, 7.0), (23.0, 19.0, 19.0))
    C.bm_box(hbm, (11.0, 12.0, 19.0), (17.0, 15.5, 24.0))
    g.add_bm(hbm, "M_hull")
    hbm.free()
    for bay in range(3):
        y = 21.0 + bay * 12.8
        for lane in range(8):
            x = 4.2 + lane * 2.55
            hgt = rnd.choice((1, 2, 2, 3))
            for k in range(hgt):
                c = rnd.choice(colors)
                C.bm_box(per[c], (x, y, 7.0 + k * 2.6), (x + 2.44, y + 12.2, 7.0 + (k + 1) * 2.6 - 0.05))
    for c in colors:
        g.add_bm(per[c], c)
        per[c].free()
    return g


# ── horizon islands (deco) ──────────────────────────────────────────────────────────────────────
ISLANDS = (  # (yaw deg from +Z toward +X, distance m, radius m, height m)
    (-24.0, 470.0, 115.0, 36.0),
    (14.0, 560.0, 165.0, 52.0),
    (52.0, 390.0, 70.0, 24.0),
    (135.0, 480.0, 125.0, 40.0),
    (178.0, 540.0, 170.0, 48.0),
    (-150.0, 430.0, 90.0, 30.0),
    (-95.0, 620.0, 200.0, 44.0),
)


def islands(seed: str = "islands") -> Geo:
    rnd = C.rng(seed)
    g = Geo("islands")
    for k, (yaw, dist, rad, hgt) in enumerate(ISLANDS):
        cx, cy = math.sin(math.radians(yaw)) * dist, -math.cos(math.radians(yaw)) * dist
        rot = Matrix.Rotation(rnd.uniform(0, math.tau), 4, "Z")
        # land mass
        bm = bmesh.new()
        verts = C.bm_icosphere(bm, 1.0, 3)
        for v in verts:
            h = v.co.z
            n = 0.0
            for (fx, fy, fz, amp) in ((1.7, 2.3, 1.1, 0.16), (3.9, 3.1, 2.7, 0.07)):
                n += amp * math.sin(fx * v.co.x + k) * math.cos(fy * v.co.y + fz * v.co.z + k * 1.7)
            r = 1.0 + n
            v.co = Vector((v.co.x * rad * r * (1.0 + 0.25 * math.sin(k)), v.co.y * rad * r * 0.8,
                           max(h, -0.2) * hgt * (1.0 + 0.8 * n) - 1.0))
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(v.co.z < -0.9 for v in f.verts)], context="FACES")
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        m = Matrix.Translation((cx, cy, 0.0)) @ rot
        g.add_bm(bm, "M_island", matrix=m, smooth=True)
        bm.free()
        # sand rim at the waterline
        sbm = bmesh.new()
        C.bm_lathe(sbm, [(0.0, 0.9), (rad * 0.92, 0.9), (rad * 1.02, 0.2), (rad * 1.1, -0.8)], seg=28)
        m2 = Matrix.Translation((cx, cy, 0.0)) @ rot @ Matrix.Diagonal((1.0 + 0.25 * math.sin(k), 0.8, 1.0, 1.0))
        g.add_bm(sbm, "M_sand", matrix=m2, smooth=True)
        sbm.free()
        # foliage clumps
        fbm = bmesh.new()
        for j in range(5):
            a = rnd.uniform(0, math.tau)
            rr = rnd.uniform(0.15, 0.55) * rad
            s = rnd.uniform(0.18, 0.3) * rad
            px, py = rr * math.cos(a) * (1.0 + 0.25 * math.sin(k)), rr * math.sin(a) * 0.8
            pz = hgt * max(0.0, 1.0 - (rr / rad) ** 2) * 0.72
            C.bm_icosphere(fbm, 1.0, 1, Matrix.Translation((px, py, pz)) @ Matrix.Diagonal((s, s * 0.9, s * 0.45, 1)))
        g.add_bm(fbm, "M_foliage", matrix=m, smooth=True)
        fbm.free()
    return g


# ── sailboat (deco) ─────────────────────────────────────────────────────────────────────────────
def sailboat(seed: str) -> Geo:
    rnd = C.rng("sail", seed)
    g = Geo("sailboat")
    L, B, fb, dr = 8.6, 2.7, 0.95, 0.55
    secs = [(L / 2, 0.82), (L * 0.3, 1.0), (0.0, 0.98), (-L * 0.25, 0.8), (-L * 0.4, 0.45), (-L / 2, 0.04)]
    bm = bmesh.new()
    rings = []
    for (y, wf) in secs:
        w = B / 2 * wf
        rings.append([bm.verts.new(p) for p in ((-w, y, fb), (-w * 0.92, y, 0.0), (-w * 0.45, y, -dr),
                                                (0.0, y, -dr * 1.15), (w * 0.45, y, -dr), (w * 0.92, y, 0.0), (w, y, fb))])
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(6):
            f = bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    C.bm_fix_normals(bm)
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = 1 if c.z > fb - 0.28 and abs(f.normal.z) < 0.7 else 0
    top = [r[0].co.copy() for r in rings]
    g.add_bm(bm, None, mat_names=["M_hull", "M_paint_trim"], smooth=True)
    bm.free()
    dbm = bmesh.new()
    deck = [dbm.verts.new(Vector((p.x, p.y, fb))) for p in top] + \
           [dbm.verts.new(Vector((-p.x, p.y, fb))) for p in reversed(top)]
    dbm.faces.new(deck)
    C.bm_box(dbm, (-0.8, 0.2, fb), (0.8, 2.4, fb + 0.55))
    g.add_bm(dbm, "M_boardwalk")
    dbm.free()
    mbm = bmesh.new()
    mast_y, mh = -0.9, 11.5
    C.bm_cylinder(mbm, 0.08, 0.06, fb, mh, seg=8, center=(0.0, mast_y))
    C.bm_tube(mbm, [Vector((0, mast_y, 2.0)), Vector((0, 3.3, 2.0))], 0.06, seg=6)
    g.add_bm(mbm, "M_metal", smooth=True)
    mbm.free()
    sbm = bmesh.new()
    camber = rnd.uniform(0.22, 0.34)
    rows = 5
    main = []
    for i in range(rows + 1):
        s = i / rows
        z = 2.1 + (mh - 0.5 - 2.1) * s
        yb = mast_y + (3.2 - mast_y) * (1 - s) + 0.05
        pa = Vector((0.0, mast_y + 0.08, z))
        pb = Vector((0.0, yb, z))
        pm = (pa + pb) * 0.5 + Vector((camber * (1 - s), 0, 0))
        main.append([sbm.verts.new(pa), sbm.verts.new(pm), sbm.verts.new(pb)])
    for a, b in zip(main[:-1], main[1:]):
        sbm.faces.new((a[0], a[1], b[1], b[0]))
        sbm.faces.new((a[1], a[2], b[2], b[1]))
    jib = [sbm.verts.new(p) for p in ((0, mast_y - 0.1, mh - 1.6), (0.0, -L / 2 + 0.25, fb + 0.25), (0.35, mast_y + 0.7, fb + 0.45))]
    sbm.faces.new(jib)
    g.add_bm(sbm, "M_billboard", smooth=True)
    sbm.free()
    # heel a little for life
    heel = Matrix.Rotation(math.radians(rnd.uniform(4.0, 8.0)), 4, "Y")
    g.verts = [heel @ v for v in g.verts]
    return g
