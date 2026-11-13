"""DYEFIELD — LOCKWELL WORKS builder module (CONTRACT_ART_P6_8 §14, §15).

Called by the shared pipeline (build_map.py) as build(mdef, layout, ctx); the layout is
data/layouts/lockwell.json. A vertical industrial interior where HEIGHT IS THE MAP:

  FLOOR 1  PRESS HALL  y 0     hall floor (concrete), two press machines (paintable housings with a
                               steel service stair each), crate stacks + pallets, team loading docks
                               (+1.0 m, spawn pads under a team-striped canopy), a conveyor ramp per
                               team (conveyor_ramp_A/B, df_conveyor 2.2 m/s uphill toward mid),
                               corner stairwells dock -> mezzanine.
  FLOOR 2  MEZZANINE   y 4.5   galleries along both long walls (steel plate), cross-bridges at
                               z = +-8.5, an office per gallery (doors, open windows); the gallery
                               faces are paintable climb walls marked by chevron trims at their base.
  FLOOR 3  CRANE-WALK  y 9.0   grate_ catwalks (not paintable) down the centre under the crane
                               runway, the crane-cab nest at mid (solid paintable floor, parapets),
                               winch-house landings (upper stairs from the mezzanine), office roofs.

Everything is authored for the SUNCREW half / east side in the layout and mirrored rot180 by the
pipeline. Architecture = one EXACT union (so faces flush against other solids vanish), bevelled,
floors cut on a 4 m grid, climb-wall bases split into chevron bands (paint_chevron is built here as
a module object so its UV0 v restarts at each band's base). Custom brush kinds: press, conveyor,
office, catwalk, rail, column, canopy, pallet, light (see the layout's _doc).
"""
from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import common as C
import deco_assets as D
import lockwell_props as P

# ── materials (CONTRACT_ART_P6_8 §15) ────────────────────────────────────────────────────────────
NEW_MATERIALS = {
    #               sRGB base   rough  metal  emission  double
    "M_steel":     ("#86A0B8", 0.52, 0.25, 0.0, False),   # blue-grey painted steel plate (mezzanine / bridges / nest)
    "M_grate":     ("#3E4957", 0.50, 0.55, 0.0, True),    # dark galvanised bar grating (alpha-tested in the runtime)
    "M_belt":      ("#2B2F37", 0.88, 0.0, 0.0, False),    # conveyor rubber
    "M_press":     ("#3FA36B", 0.48, 0.10, 0.0, False),   # machine green press housings
    "M_brick":     ("#AE6A50", 0.90, 0.0, 0.0, False),    # red-brown brick shell
    "M_strip":     ("#E4F2FF", 0.30, 0.0, 6.0, False),    # fluorescent tube (emissive)
    "M_skylight":  ("#9DB6CF", 0.20, 0.0, 1.4, True),     # overcast skylight / clerestory panes (emissive)
    "M_office":    ("#EDE3C8", 0.80, 0.0, 0.0, False),    # cream office walls
    "M_dock":      ("#A7B2BA", 0.86, 0.0, 0.0, False),    # cool loading-dock concrete
}
ARCH_MATS = ["M_concrete", "M_dock", "M_steel", "M_press", "M_office", "M_chevron", "M_hazard", "M_belt"]
BEVEL = 0.04
PAD_POCKET = 0.3
NOSE_W = 0.35
GRID = 4
CHEVRON_H = 0.9
FIXUPS: dict = {}
OVERLAP_OK = {"floor"}
_FLIP = {"+x": "-x", "-x": "+x", "+z": "-z", "-z": "+z"}

# Chevron trims at the base of the climb shortcut walls (glTF boxes, authored half; rot180 added).
# A vertical concrete/office face whose centre lies in a band box gets M_chevron.
CHEVRON_BANDS = [
    ((12.95, 0.0, -25.0), (13.05, CHEVRON_H, 25.0)),          # gallery face over the hall
    ((13.0, 1.0, -25.05), (22.0, 1.0 + CHEVRON_H, -24.95)),   # east gallery end over the dock
    ((-22.0, 1.0, -25.05), (-13.0, 1.0 + CHEVRON_H, -24.95)), # west gallery end over the dock
    ((19.2, 1.0, -28.85), (22.0, 1.0 + CHEVRON_H, -28.75)),   # corner landing wall (dock alcove)
    ((-22.0, 1.0, -28.85), (-19.2, 1.0 + CHEVRON_H, -28.75)),
    ((16.95, 4.5, -20.0), (17.05, 4.5 + CHEVRON_H, -16.0)),   # winch house (climb to the crane-walk)
    ((17.0, 4.5, -20.05), (22.0, 4.5 + CHEVRON_H, -19.95)),
    ((17.0, 4.5, -16.05), (19.2, 4.5 + CHEVRON_H, -15.95)),
    ((16.95, 4.5, -5.0), (17.05, 4.5 + CHEVRON_H, 5.0)),      # office front + ends (climb to the roof)
    ((17.0, 4.5, -5.05), (22.0, 4.5 + CHEVRON_H, -4.95)),
    ((17.0, 4.5, 4.95), (22.0, 4.5 + CHEVRON_H, 5.05)),
]


def _rot180_box(bx):
    (x0, y0, z0), (x1, y1, z1) = bx
    return ((-x1, y0, -z1), (-x0, y1, -z0))


def chevron_bands():
    return CHEVRON_BANDS + [_rot180_box(b) for b in CHEVRON_BANDS]


def _in_box(p, bx, tol=0.03):
    (x0, y0, z0), (x1, y1, z1) = bx
    return x0 - tol <= p[0] <= x1 + tol and y0 - tol <= p[1] <= y1 + tol and z0 - tol <= p[2] <= z1 + tol


def _dirs(b, key):
    d = list(b.get(key) or [])
    if b["id"] != b.get("_base", b["id"]):
        d = [_FLIP[x] for x in d]
    return d


# ── architecture solids ──────────────────────────────────────────────────────────────────────────
def nosed_box(arch, b):
    """Box brush with 'top'/'side' materials and hazard nosing strips on its 'nose' edges."""
    top = b.get("top", b.get("mat"))
    side = b.get("side", b.get("mat"))
    dirs = _dirs(b, "nose")
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    cx0, cx1, cz0, cz1 = x0, x1, z0, z1
    w = NOSE_W
    strips = []
    if "+x" in dirs:
        cx1 = x1 - w
        strips.append(([x1 - w, y0, z0], [x1, y1, z1]))
    if "-x" in dirs:
        cx0 = x0 + w
        strips.append(([x0, y0, z0], [x0 + w, y1, z1]))
    if "+z" in dirs:
        cz1 = z1 - w
        strips.append(([x0, y0, z1 - w], [x1, y1, z1]))
    if "-z" in dirs:
        cz0 = z0 + w
        strips.append(([x0, y0, z0], [x1, y1, z0 + w]))
    out = [arch.box_bm(dict(b, min=[cx0, y0, cz0], max=[cx1, y1, cz1]), top=top, side=side)]
    for (mn, mx) in strips:
        out.append(arch.box_bm(dict(b, min=mn, max=mx), top="hazard", side=side))
    return out


def stair_solid(arch, b):
    """ONE closed solid per staircase: the stepped side profile extruded across the flight (cheaper
    for the EXACT union than a block per step). Tread fronts get a 0.12 m hazard nosing strip. Step
    layout = build_map.Arch.stairs_bms, so Arch.stairs_col_bm's wedge passes through the nosings."""
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    across, lo_r, hi_r, P_ = arch._run_frame(b)
    n = int(b.get("steps") or max(1, round((y1 - y0) / 0.25)))
    d = (hi_r - lo_r) / n
    nd = min(0.12, abs(d) * 0.4) * (1 if d > 0 else -1)
    top = lambda i: y0 + (y1 - y0) * (i + 1) / n  # noqa: E731
    prof = [(lo_r, y0, False)]
    for i in range(n):
        r = lo_r + d * i
        if i > 0:
            prof.append((r, top(i - 1), False))
        prof.append((r, top(i), True))          # the edge leaving this vertex is a nose strip
        prof.append((r + nd, top(i), False))
    prof.append((hi_r, y1, False))
    prof.append((hi_r, y0, False))
    bm = bmesh.new()
    ring0 = [bm.verts.new(P_(across[0], r, y)) for (r, y, _) in prof]
    ring1 = [bm.verts.new(P_(across[1], r, y)) for (r, y, _) in prof]
    mi = arch.idx(b.get("mat", "steel"))
    ni = arch.idx(b.get("nose", "hazard")) if b.get("nose", "hazard") else mi
    k = len(prof)
    for i in range(k):
        j = (i + 1) % k
        f = bm.faces.new((ring0[i], ring0[j], ring1[j], ring1[i]))
        f.material_index = ni if prof[i][2] else mi
    f0 = bm.faces.new(ring0)
    f0.material_index = mi
    f1 = bm.faces.new(list(reversed(ring1)))
    f1.material_index = mi
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def office_boxes(b):
    """Wall/roof boxes of an office (hollow room): door gaps + open windows on the front (the side
    facing the hall), windows on both ends, a back wall against the shell, roof slab = floor 3.
    Returns [(min, max, top, side)] and the front openings [(kind, z0, z1, y0, y1)]."""
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    t = 0.3
    rt = 0.3
    east = (x0 + x1) / 2 > 0
    fx0, fx1 = (x0, x0 + t) if east else (x1 - t, x1)        # front wall (faces the gallery walkway)
    bk0, bk1 = (x1 - t, x1) if east else (x0, x0 + t)        # back wall (against the shell)
    yw = y1 - rt
    zc = (z0 + z1) / 2
    out = [([x0, yw, z0], [x1, y1, z1], "steel", "office"),
           ([bk0, y0, z0 + t], [bk1, yw, z1 - t], "office", "office")]
    # end walls with a window each
    ix0, ix1 = (x0, x1 - t) if east else (x0 + t, x1)
    wa, wb = (x0 + 1.2, x0 + 3.6) if east else (x1 - 3.6, x1 - 1.2)
    for (za, zb) in ((z0, z0 + t), (z1 - t, z1)):
        out += [([ix0, y0, za], [wa, yw, zb], "office", "office"), ([wb, y0, za], [ix1, yw, zb], "office", "office"),
                ([wa, y0, za], [wb, y0 + 1.1, zb], "office", "office"), ([wa, y0 + 2.4, za], [wb, yw, zb], "office", "office")]
    # front wall: pier | door | pier | window | pier | door | pier
    dA, dB = (z0 + 1.1, z0 + 2.7), (z1 - 2.7, z1 - 1.1)
    win = (zc - 1.3, zc + 1.3)
    dh = 2.5
    segs = [(z0 + t, dA[0], "full"), (dA[0], dA[1], "door"), (dA[1], win[0], "full"), (win[0], win[1], "window"),
            (win[1], dB[0], "full"), (dB[0], dB[1], "door"), (dB[1], z1 - t, "full")]
    openings = []
    for (za, zb, kind) in segs:
        if kind == "full":
            out.append(([fx0, y0, za], [fx1, yw, zb], "office", "office"))
        elif kind == "door":
            out.append(([fx0, y0 + dh, za], [fx1, yw, zb], "office", "office"))
            openings.append(("door", za, zb, y0, y0 + dh))
        else:
            out.append(([fx0, y0, za], [fx1, y0 + 1.1, zb], "office", "office"))
            out.append(([fx0, y0 + 2.4, za], [fx1, yw, zb], "office", "office"))
            openings.append(("window", za, zb, y0 + 1.1, y0 + 2.4))
    return out, openings, (fx0 if east else fx1), (bk1 if east else bk0)


def build_architecture(ctx):
    arch = ctx.arch(ARCH_MATS, default="concrete", lip="hazard")
    floor = ctx.brush("floor")
    base_bm = arch.box_bm(floor)
    ops = []
    col = ctx.bucket("col_stairs")
    for b in ctx.brushes:
        k = b["kind"]
        if b is floor:
            continue
        if k in ("box", "press"):
            bms = nosed_box(arch, dict(b, mat=b.get("mat", "concrete")))
        elif k == "ramp":
            bms = [arch.ramp_bm(b)]
        elif k == "stairs":
            bms = [stair_solid(arch, b)]
            col.add_bm(arch.stairs_col_bm(b), "M_concrete")
        elif k == "conveyor":
            bms = [arch.ramp_bm(dict(b, mat="belt", lip="belt"))]
        elif k == "office":
            boxes, _, _, _ = office_boxes(b)
            bms = [arch.box_bm({"min": mn, "max": mx, "mat": side}, top=top, side=side) for (mn, mx, top, side) in boxes]
        else:
            continue
        ops += [(f"_op_{b['id']}_{i}", bm) for i, bm in enumerate(bms)]
    pads = ctx.brushes_of("spawnpad")
    bm = arch.union(base_bm, ops, arch.pad_pockets(pads, PAD_POCKET))
    arch.bevel_convex(bm, BEVEL, angle=30.0, segments=2, profile=0.5)
    (bx0, _, bz0), (bx1, _, bz1) = ctx.mdef["bounds"]["min"], ctx.mdef["bounds"]["max"]
    for m in ("concrete", "dock", "steel", "press"):
        arch.grid_cut(bm, m, bx0, bx1, bz0, bz1, GRID)
    floor_markings(ctx, arch, bm)
    chevron_split(ctx, arch, bm)

    def classify(f):
        gx, gy, gz = C.b2g(f.calc_center_median())
        nx, ny, nz = C.b2g(f.normal)
        mat = arch.mats[f.material_index]
        for b in pads:                      # pad pocket interior (hidden under the pad)
            pc = b["center"]
            if math.hypot(gx - pc[0], gz - pc[2]) < b["radius"] + 0.06 and gy < pc[1] - BEVEL - 0.005:
                return None
        if (abs(gx - bx1) < 0.02 and nx > 0.85) or (abs(gx - bx0) < 0.02 and nx < -0.85) or \
                (abs(gz - bz1) < 0.02 and nz > 0.85) or (abs(gz - bz0) < 0.02 and nz < -0.85):
            return None                     # flush against the shell walls
        if ny < -0.5 and gy < floor["min"][1] + 0.01:
            return None                     # slab bottom
        if mat == "M_belt":
            if ny > 0.5:
                return "conveyor_ramp_A" if gz < 0 else "conveyor_ramp_B"
            return "solid_conveyor"
        if ny < -0.5:
            return "solid_undersides"
        return "paint_" + mat[2:]
    ctx.geos.update(arch.to_geos(bm, classify))
    bm.free()
    if "solid_conveyor" in ctx.geos:        # housing sides: dark steel, not the belt rubber
        g = ctx.geos["solid_conveyor"]
        g.fmat = ["M_steel" for _ in g.fmat]
    chevron_object(ctx)


MARK_W = 0.22          # hall lane line width (m)
LANE_X = 9.0           # the 18 m central hall is marked between x = -9 and +9
ZONE_PAD = 0.7         # keep-clear band around each press


def floor_markings(ctx, arch, bm):
    """Industrial floor paint on the hall floor, flush (concrete faces re-materialled, so dye covers
    them like any floor): hazard lane lines along x = +-9 that mark the 18 m central hall, and a
    hazard keep-clear band around each press."""
    ci, hi = arch.idx("concrete"), arch.idx("hazard")
    zones = []
    for b in ctx.brushes_of("press"):
        (x0, _, z0), (x1, _, z1) = b["min"], b["max"]
        zones.append((x0 - ZONE_PAD, x1 + ZONE_PAD, z0 - ZONE_PAD, z1 + ZONE_PAD))
    lines = [(-LANE_X - MARK_W / 2, -LANE_X + MARK_W / 2), (LANE_X - MARK_W / 2, LANE_X + MARK_W / 2)]
    zlim = 24.3

    def floor_faces():
        return [f for f in bm.faces if f.material_index == ci and f.normal.z > 0.999 and abs(f.calc_center_median().z) < 0.01]
    cuts = [(Vector((x, 0, 0)), Vector((1, 0, 0))) for x in sorted({v for l in lines for v in l} | {v for zn in zones for v in zn[:2]})]
    cuts += [(Vector((0, -z, 0)), Vector((0, 1, 0))) for z in sorted({v for zn in zones for v in zn[2:]} | {-zlim, zlim})]
    for co, no in cuts:
        ff = floor_faces()
        geom = list(dict.fromkeys(e for f in ff for e in f.edges)) + ff + list(dict.fromkeys(v for f in ff for v in f.verts))
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
    n = 0
    for f in floor_faces():
        gx, _, gz = C.b2g(f.calc_center_median())
        on_line = any(a <= gx <= b for a, b in lines) and abs(gz) < zlim
        in_zone = any(x0 <= gx <= x1 and z0 <= gz <= z1 for (x0, x1, z0, z1) in zones)
        if on_line or in_zone:
            f.material_index = hi
            n += 1
    ctx.log(f"lockwell: {n} floor-marking faces (lane lines x = +-{LANE_X}, press keep-clear bands)")


def chevron_split(ctx, arch, bm):
    """Bisect the vertical concrete / office faces at every band's top, then give the faces inside a
    band M_chevron (flush trims: no raised strip, so wall-slick climbs straight over them)."""
    bands = chevron_bands()
    mats = (arch.idx("concrete"), arch.idx("office"))
    for h in sorted({round(bx[1][1], 4) for bx in bands}):
        faces = [f for f in bm.faces if f.material_index in mats and abs(f.normal.z) < 0.3]
        geom = list(dict.fromkeys(e for f in faces for e in f.edges)) + faces + \
            list(dict.fromkeys(v for f in faces for v in f.verts))
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((0, 0, h)), plane_no=Vector((0, 0, 1)), dist=1e-5)
    ci = arch.idx("chevron")
    n = 0
    for f in bm.faces:
        if f.material_index in mats and abs(f.normal.z) < 0.3:
            p = C.b2g(f.calc_center_median())
            if any(_in_box(p, bx) for bx in bands):
                f.material_index = ci
                n += 1
    ctx.log(f"lockwell: {n} chevron trim faces on the climb walls")


def chevron_object(ctx):
    """paint_chevron as a module object whose UV0 v restarts at each band's base (the runtime
    chevron shader draws its arrows from UV0; the band bases sit at y 0, 1.0 and 4.5)."""
    g = ctx.geos.pop("paint_chevron", None)
    if g is None:
        return
    ob = g.to_object(ctx.coll, team_hex=ctx.team_hex)
    me = ob.data
    C.uv_box_metres(me, "UVMap")
    uv = me.uv_layers["UVMap"].data
    bands = chevron_bands()
    for p in me.polygons:
        c = C.b2g(p.center)
        base = next((bx[0][1] for bx in bands if _in_box(c, bx)), 0.0)
        for li in p.loop_indices:
            u, v = uv[li].uv
            uv[li].uv = (u, v + base)         # stored v = 1 - v_world  ->  1 - (v_world - base)
    ctx.add_object(ob)


# ── props ────────────────────────────────────────────────────────────────────────────────────────
def conveyor_velocity(b):
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    run = (z1 - z0) if b["rise"][1] == "z" else (x1 - x0)
    h = y1 - y0
    L = math.hypot(run, h)
    s = float(b.get("speed", 2.2))
    sgn = 1.0 if b["rise"][0] == "+" else -1.0
    horiz, vert = s * run / L * sgn, s * h / L
    v = [0.0, vert, horiz] if b["rise"][1] == "z" else [horiz, vert, 0.0]
    return [round(c, 4) for c in v]


def build_props(ctx):
    L = ctx.layout
    props = L.get("props", {})
    preset = ctx.mdef["lighting"]["presets"][ctx.mdef["lighting"]["default"]]
    ctx.build_crates()
    ctx.build_spawnpads(depth=PAD_POCKET + 0.02)
    for b in ctx.brushes_of("pallet"):
        ctx.bucket("solid_pallets").extend(P.pallet(b["_base"]), C.place_matrix(b["center"], b.get("yaw", 0.0)))
    for b in ctx.brushes_of("canopy"):
        g = P.canopy(b)
        ctx.bucket("solid_canopy").extend(g["solid"])
        ctx.bucket("deco_canopy").extend(g["deco"])
    for b in ctx.brushes_of("column"):
        ctx.bucket("solid_columns").extend(P.column(b["pos"], b["height"], b.get("size", 0.5)))
    for b in ctx.brushes_of("press"):
        g = P.press_frame(b)
        ctx.bucket("solid_press_frame").extend(g["solid"])
        ctx.bucket("deco_press").extend(g["deco"])
    conv = {}
    for b in ctx.brushes_of("conveyor"):
        g = P.conveyor_trim(b)
        ctx.bucket("solid_conveyor_skirt").extend(g["solid"])
        ctx.bucket("deco_conveyor").extend(g["deco"])
        node = "conveyor_ramp_A" if (b["min"][2] + b["max"][2]) < 0 else "conveyor_ramp_B"
        v = conveyor_velocity(b)
        ctx.set_extras(node, df_conveyor=v)
        conv[node] = {"brush": b["id"], "df_conveyor": v, "speed": b.get("speed", 2.2),
                      "from": [round((b["min"][0] + b["max"][0]) / 2, 2), b["min"][1], b["min"][2] if b["rise"] == "+z" else b["max"][2]],
                      "to": [round((b["min"][0] + b["max"][0]) / 2, 2), b["max"][1], b["max"][2] if b["rise"] == "+z" else b["min"][2]]}
    ctx.summary["conveyors"] = conv
    hang = []
    for b in ctx.brushes_of("catwalk"):
        g = P.catwalk(b)
        ctx.bucket("grate_catwalks").extend(g["grate"])
        ctx.bucket("solid_catwalk_frame").extend(g["solid"])
        (x0, _, z0), (x1, _, z1) = b["min"], b["max"]
        if (x1 - x0) >= (z1 - z0):
            n = max(1, round((x1 - x0) / 4.0))
            for k in range(n + 1):
                xx = x0 + (x1 - x0) * k / n
                hang += [(xx, z0 - 0.06), (xx, z1 + 0.06)]
        else:
            n = max(1, round((z1 - z0) / 4.0))
            for k in range(n + 1):
                zz = z0 + (z1 - z0) * k / n
                hang += [(x0 - 0.06, zz), (x1 + 0.06, zz)]
    ctx.bucket("deco_hangers").extend(P.hangers(hang, 8.9, 13.0))
    for b in ctx.brushes_of("rail"):
        ctx.bucket("solid_rails").extend(P.railing(b["points"], b.get("height", P.RAIL_H)))
    for b in ctx.brushes_of("stairs"):
        for side in _dirs(b, "rails"):
            ctx.bucket("solid_rails").extend(P.railing(P.stair_rail_points(b, side)))
    for b in ctx.brushes_of("office"):
        _, openings, front_x, back_x = office_boxes(b)
        east = (b["min"][0] + b["max"][0]) / 2 > 0
        g = P.office_trims(front_x, back_x, b["min"][2], b["max"][2], b["min"][1], openings, 1 if east else -1)
        ctx.bucket("deco_office_trim").extend(g["deco"])
        ctx.bucket("solid_office_furn").extend(g["solid"])
    nest = ctx.brush("nest")
    cr = P.crane(nest, props, ctx.mdef["bounds"])
    ctx.bucket("solid_crane").extend(cr["solid"])
    ctx.bucket("deco_crane").extend(cr["deco"])
    for name, g in P.shell(ctx.mdef["bounds"], props).items():
        ctx.bucket(name).extend(g)
    strips = P.strip_positions(props)
    ctx.bucket("deco_strips").extend(P.strips(props, strips, props["trusses"]["y0"]))
    ctx.strip_positions = strips
    # practical lights: light_ empties (df_light) + visible fixtures
    nl = 0
    for b in ctx.brushes_of("light"):
        colr = preset.get("sodiumColor", "#FFB35C") if b.get("color", "sodium") == "sodium" else b["color"]
        name = "light_" + (b["id"][3:] if b["id"].startswith("lt_") else b["id"])
        ctx.add_light(name, b["pos"], colr, b.get("intensity", 3.0), b.get("range", 12.0))
        nl += 1
        fx = b.get("fixture", "pendant")
        top = {"pendant": props["trusses"]["y0"], "hang": 8.88, "canopy": 5.6}.get(fx, props["trusses"]["y0"])
        ctx.bucket("deco_lamps").extend(P.lamp_fixture(b["pos"], fx, top))
    ctx.summary["practical_lights"] = nl
    if nl > 12:
        ctx.log(f"WARN lockwell: {nl} light_ empties > 12 (§15)")
    # team pennants at the dock corners (deco)
    for (x, z, team, yaw) in ((-12.4, -31.4, "A", 180.0), (12.4, -31.4, "A", 0.0), (12.4, 31.4, "B", 0.0), (-12.4, 31.4, "B", 180.0)):
        ctx.bucket("deco_flags").extend(D.pennant(team, f"lockwell_{x}_{z}"), C.place_matrix([x, 1.0, z], yaw))


# ── QA render look (render-only; never exported) ────────────────────────────────────────────────
def _mul(nt, a, b):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = "MULTIPLY"
    ctx_sock(n, "Factor_Float").default_value = 1.0
    for ident, v in (("A_Color", a), ("B_Color", b)):
        s = ctx_sock(n, ident)
        if isinstance(v, tuple):
            s.default_value = (*v, 1.0) if len(v) == 3 else v
        else:
            nt.links.new(v, s)
    return next(o for o in n.outputs if o.identifier == "Result_Color")


def ctx_sock(node, ident):
    return next(s for s in node.inputs if s.identifier == ident)


def _gray(nt, sh, val):
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(val, comb.inputs[i])
    return comb.outputs[0]


def install_preview_shaders(ctx):
    sh = ctx.sh
    lin = C.hex_to_linear

    def steel(ctx, nt, bsdf, base):
        u, v = sh.uv(nt)
        seam = sh.math(nt, "LESS_THAN", sh.math(nt, "MINIMUM", sh.edge_dist(nt, u, 2.0), sh.edge_dist(nt, v, 1.25)), 0.02)
        # diamond tread: two diagonal line families
        d1 = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, sh.math(nt, "ADD", u, v), 0.09), 0.012)
        d2 = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, sh.math(nt, "SUBTRACT", u, v), 0.09), 0.012)
        tread = sh.math(nt, "MULTIPLY", sh.math(nt, "MAXIMUM", d1, d2), 0.35)
        plate = sh.mix(nt, tread, base, tuple(c * 1.25 for c in base))
        tint = sh.math(nt, "ADD", 0.94, sh.math(nt, "MULTIPLY", sh.white(nt, sh.math(nt, "FLOOR", sh.math(nt, "DIVIDE", u, 2.0)),
                                                                          sh.math(nt, "FLOOR", sh.math(nt, "DIVIDE", v, 1.25))), 0.1))
        return sh.mix(nt, seam, _mul(nt, plate, _gray(nt, sh, tint)), tuple(c * 0.55 for c in base))

    def dock(ctx, nt, bsdf, base):
        u, v = sh.uv(nt)
        joint = sh.math(nt, "LESS_THAN", sh.math(nt, "MINIMUM", sh.edge_dist(nt, u, 3.0), sh.edge_dist(nt, v, 3.0)), 0.018)
        x, z, y = sh.pos(nt)
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 1.6
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        for i, s_ in enumerate((x, y, z)):
            nt.links.new(s_, comb.inputs[i])
        nt.links.new(comb.outputs[0], nz.inputs["Vector"])
        col = sh.mix(nt, sh.math(nt, "MULTIPLY", nz.outputs["Fac"], 0.35), base, tuple(c * 0.8 for c in base))
        return sh.mix(nt, joint, col, tuple(c * 0.5 for c in base))

    def press(ctx, nt, bsdf, base):
        u, v = sh.uv(nt)
        seam = sh.math(nt, "LESS_THAN", sh.math(nt, "MINIMUM", sh.edge_dist(nt, u, 1.5), sh.edge_dist(nt, v, 1.1)), 0.015)
        rivet = sh.math(nt, "LESS_THAN", sh.math(nt, "ADD", sh.math(nt, "POWER", sh.edge_dist(nt, u, 0.5), 2.0),
                                                  sh.math(nt, "POWER", sh.edge_dist(nt, sh.math(nt, "ADD", v, 0.06), 1.1), 2.0)), 0.0009)
        col = sh.mix(nt, rivet, base, tuple(min(1.0, c * 1.5) for c in base))
        return sh.mix(nt, seam, col, tuple(c * 0.5 for c in base))

    def brick(ctx, nt, bsdf, base):
        u, v = sh.uv(nt)
        row = sh.math(nt, "FLOOR", sh.math(nt, "DIVIDE", v, 0.085))
        off = sh.math(nt, "MULTIPLY", sh.math(nt, "MODULO", row, 2.0), 0.12)
        uu = sh.math(nt, "ADD", u, off)
        mort = sh.math(nt, "LESS_THAN", sh.math(nt, "MINIMUM", sh.edge_dist(nt, uu, 0.24), sh.edge_dist(nt, v, 0.085)), 0.008)
        tint = sh.math(nt, "ADD", 0.82, sh.math(nt, "MULTIPLY", sh.white(nt, row, sh.math(nt, "FLOOR", sh.math(nt, "DIVIDE", uu, 0.24))), 0.3))
        col = _mul(nt, base, _gray(nt, sh, tint))
        return sh.mix(nt, mort, col, lin("#8E8579"))

    def belt(ctx, nt, bsdf, base):
        x, z, y = sh.pos(nt)
        # chevron arrows along the belt, pointing toward mid (conveyors carry you uphill toward z = 0):
        # a stripe is |z| = c + 0.9 * |dx|, so its tip (dx = 0) is the end nearest mid
        ax = sh.math(nt, "ABSOLUTE", sh.math(nt, "SUBTRACT", sh.math(nt, "ABSOLUTE", x), 11.25))
        az = sh.math(nt, "ABSOLUTE", z)
        t = sh.math(nt, "FRACT", sh.math(nt, "DIVIDE", sh.math(nt, "SUBTRACT", az, sh.math(nt, "MULTIPLY", ax, 0.9)), 1.4))
        arrow = sh.math(nt, "MULTIPLY", sh.math(nt, "LESS_THAN", t, 0.22), sh.math(nt, "LESS_THAN", ax, 1.2))
        ribs = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, az, 0.25), 0.02)
        col = sh.mix(nt, ribs, base, tuple(c * 0.6 for c in base))
        return sh.mix(nt, arrow, col, lin("#F2C230"))

    def grate(ctx, nt, bsdf, base):
        u, v = sh.uv(nt)
        bar_u = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, u, 0.16), 0.024)
        bar_v = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, v, 0.05), 0.009)
        solid = sh.math(nt, "MAXIMUM", bar_u, bar_v)
        nt.links.new(solid, bsdf.inputs["Alpha"])
        return None

    def skylight(ctx, nt, bsdf, base):
        u, v = sh.uv(nt)
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 3.0
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(sh.math(nt, "MULTIPLY", u, 8.0), comb.inputs[0])
        nt.links.new(sh.math(nt, "MULTIPLY", v, 0.8), comb.inputs[1])
        nt.links.new(comb.outputs[0], nz.inputs["Vector"])
        streak = sh.math(nt, "MULTIPLY", nz.outputs["Fac"], 0.45)
        col = sh.mix(nt, streak, base, lin("#E7F1FA"))
        nt.links.new(col, bsdf.inputs["Emission Color"])
        return col

    def concrete(ctx, nt, bsdf, base):
        u, v = sh.uv(nt)
        x, z, y = sh.pos(nt)
        joint = sh.math(nt, "LESS_THAN", sh.math(nt, "MINIMUM", sh.edge_dist(nt, x, 4.0), sh.edge_dist(nt, z, 4.0)), 0.02)
        flat = sh.math(nt, "LESS_THAN", y, 0.05)
        joint = sh.math(nt, "MULTIPLY", joint, flat)
        nz = nt.nodes.new("ShaderNodeTexNoise")
        nz.inputs["Scale"].default_value = 0.45
        nz.inputs["Detail"].default_value = 3.0
        comb = nt.nodes.new("ShaderNodeCombineXYZ")
        for i, s_ in enumerate((x, y, z)):
            nt.links.new(s_, comb.inputs[i])
        nt.links.new(comb.outputs[0], nz.inputs["Vector"])
        stain = sh.math(nt, "MULTIPLY", sh.math(nt, "MAXIMUM", sh.math(nt, "SUBTRACT", nz.outputs["Fac"], 0.5), 0.0), 0.9)
        col = sh.mix(nt, stain, base, tuple(c * 0.78 for c in base))
        return sh.mix(nt, joint, col, tuple(c * 0.55 for c in base))

    ctx.add_preview_shader("M_concrete", concrete)
    ctx.add_preview_shader("M_steel", steel)
    ctx.add_preview_shader("M_dock", dock)
    ctx.add_preview_shader("M_press", press)
    ctx.add_preview_shader("M_brick", brick)
    ctx.add_preview_shader("M_belt", belt)
    ctx.add_preview_shader("M_grate", grate)
    ctx.add_preview_shader("M_skylight", skylight)


# names of the shell/overhead objects the cut-away views hide
OVERHEAD = ("solid_shell_roof", "deco_skylights", "deco_trusses", "deco_strips", "deco_hangers", "deco_crane",
            "deco_lamps")


def _objs(prefixes):
    return [o for o in bpy.data.objects if o.name.startswith(tuple(prefixes))]


def _hide(names):
    hidden = []
    for o in _objs(names):
        if not o.hide_render:
            o.hide_render = True
            hidden.append(o.name)
    return hidden


def _unhide(names):
    for n in names:
        o = bpy.data.objects.get(n)
        if o is not None:
            o.hide_render = False


_TINT_STATE: list = []


def _tint_floors_on(ctx, scene):
    """Top view: cut the roof away and colour-code the floors by height (floor 2 cyan, floor 3
    magenta) with a render-only mix injected into every M_ material; the after-hook restores it."""
    ctx._top_hidden = _hide(OVERHEAD + ("solid_crane", "solid_canopy", "deco_canopy", "solid_press_frame", "deco_press"))
    sun = bpy.data.objects.get("qa_sun")
    if sun is not None:
        ctx._top_sun = sun.data.energy
        sun.data.energy *= 2.2
    lin = C.hex_to_linear
    sh = ctx.sh
    for mat in bpy.data.materials:
        if not mat.name.startswith("M_") or mat.node_tree is None:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        sock = bsdf.inputs["Base Color"]
        prev = sock.links[0].from_socket if sock.links else None
        base = prev if prev is not None else tuple(sock.default_value)[:3]
        x, z, y = sh.pos(nt)
        f2 = sh.math(nt, "MULTIPLY", sh.math(nt, "GREATER_THAN", y, 4.2), 0.42)
        f3 = sh.math(nt, "MULTIPLY", sh.math(nt, "GREATER_THAN", y, 7.6), 0.55)
        m1 = sh.mix(nt, f2, base, lin("#3FC6F2"))
        m2 = sh.mix(nt, f3, m1, lin("#FF4FA3"))
        nt.links.new(m2, sock)
        _TINT_STATE.append((mat.name, prev, tuple(sock.default_value)))


def _tint_floors_off(ctx, scene):
    for (name, prev, dv) in _TINT_STATE:
        mat = bpy.data.materials[name]
        bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        sock = bsdf.inputs["Base Color"]
        for l in list(sock.links):
            mat.node_tree.links.remove(l)
        if prev is not None:
            mat.node_tree.links.new(prev, sock)
        else:
            sock.default_value = dv
    _TINT_STATE.clear()
    _unhide(getattr(ctx, "_top_hidden", []))
    sun = bpy.data.objects.get("qa_sun")
    if sun is not None and hasattr(ctx, "_top_sun"):
        sun.data.energy = ctx._top_sun


def _cutaway_on(ctx, scene):
    ctx._cut_hidden = _hide(OVERHEAD + ("solid_shell_wall_e", "solid_shell_wall_s"))
    # the east wall is cut away, so its clerestory panes would float as bare white slabs: render the
    # aerial with a copy of deco_clerestory that keeps only the west-wall windows (render-only; the
    # export has already been written when the QA hooks run)
    ob = bpy.data.objects.get("deco_clerestory")
    ctx._cut_clere = None
    if ob is not None and ob.type == "MESH":
        x_cut = ctx.mdef["bounds"]["max"][0] - 1.0
        me = ob.data.copy()
        bm = bmesh.new()
        bm.from_mesh(me)
        mw = ob.matrix_world
        drop = [v for v in bm.verts if (mw @ v.co).x > x_cut]
        bmesh.ops.delete(bm, geom=drop, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        ctx._cut_clere = (ob.name, ob.data)
        ob.data = me


def _cutaway_off(ctx, scene):
    _unhide(getattr(ctx, "_cut_hidden", []))
    keep = getattr(ctx, "_cut_clere", None)
    if keep is not None:
        ob = bpy.data.objects.get(keep[0])
        tmp = ob.data
        ob.data = keep[1]
        bpy.data.meshes.remove(tmp)
        ctx._cut_clere = None


def render_look(ctx, scene):
    """Interior QA lighting: strip-light rows as long area lights, soft light under the skylight
    strips, emissive/overhead objects that do not cast shadows, a light blue-grey haze."""
    preset = ctx.mdef["lighting"]["presets"][ctx.mdef["lighting"]["default"]]
    lin = C.hex_to_linear
    props = ctx.layout["props"]
    s = props["strips"]
    rows = {}
    for (x, y, z) in ctx.strip_positions:
        rows.setdefault((x, y), []).append(z)
    for (x, y), zs in sorted(rows.items()):
        # one area light per contiguous run of fixtures
        zs = sorted(zs)
        runs = [[zs[0]]]
        for z in zs[1:]:
            if z - runs[-1][-1] > s["step"] + 0.01:
                runs.append([z])
            else:
                runs[-1].append(z)
        for k, run in enumerate(runs):
            z0, z1 = run[0] - s["length"] / 2, run[-1] + s["length"] / 2
            ld = bpy.data.lights.new(f"qa_strip_{x}_{k}", "AREA")
            ld.shape = "RECTANGLE"
            ld.size = 0.25
            ld.size_y = z1 - z0
            ld.color = lin(preset.get("stripColor", "#E4F2FF"))
            ld.energy = 130.0 * len(run)
            ld.use_shadow = False                  # soft overhead fill; keeps the EEVEE shadow pool for the key + practicals
            ob = bpy.data.objects.new(f"qa_strip_{x}_{k}", ld)
            ob.location = C.g2b(x, y - 0.08, (z0 + z1) / 2)
            C.link(ob)
    sk = props["skylights"]
    for (a, c) in sk["x"]:
        ld = bpy.data.lights.new(f"qa_sky_{a}", "AREA")
        ld.shape = "RECTANGLE"
        ld.size = c - a
        ld.size_y = sk["z1"] - sk["z0"]
        ld.color = lin(preset.get("windowGlow", "#9DB6CF"))
        ld.energy = 2600.0
        ob = bpy.data.objects.new(f"qa_sky_{a}", ld)
        ob.location = C.g2b((a + c) / 2, 12.9, 0.0)
        C.link(ob)
    # the crane-cab lamp (an emissive strip under the cab roof) as a soft area light (QA only)
    cr = props["crane"]
    ld = bpy.data.lights.new("qa_cab", "AREA")
    ld.shape = "RECTANGLE"
    ld.size, ld.size_y = 1.8, 0.3
    ld.color = lin(preset.get("stripColor", "#E4F2FF"))
    ld.energy = 160.0
    ob = bpy.data.objects.new("qa_cab", ld)
    ob.location = C.g2b(0.0, cr["cab_roof_y"] - 0.1, 0.0)
    C.link(ob)
    for o in bpy.data.objects:
        if o.name.startswith(("deco_skylights", "deco_strips", "deco_clerestory", "deco_lamps", "deco_hangers")):
            o.visible_shadow = False
    # a thin blue-grey haze (fogColor) confined to the building (a world volume would also swallow
    # the key light): depth reads down the hall and the skylight shafts show (QA only)
    (bx0, by0, bz0), (bx1, by1, bz1) = ctx.mdef["bounds"]["min"], ctx.mdef["bounds"]["max"]
    me = bpy.data.meshes.new("qa_haze")
    bm = bmesh.new()
    C.bm_box(bm, (bx0, -bz1, 0.0), (bx1, -bz0, by1))
    bm.to_mesh(me)
    bm.free()
    hm = bpy.data.materials.new("qa_haze")
    hnt = hm.node_tree
    for n in list(hnt.nodes):
        if n.type == "BSDF_PRINCIPLED":
            hnt.nodes.remove(n)
    out = next(n for n in hnt.nodes if n.type == "OUTPUT_MATERIAL")
    vol = hnt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (*lin(preset.get("fogColor", "#2A3346")), 1.0)
    vol.inputs["Density"].default_value = 0.004
    vol.inputs["Anisotropy"].default_value = 0.4
    hnt.links.new(vol.outputs[0], out.inputs["Volume"])
    me.materials.append(hm)
    hz = bpy.data.objects.new("qa_haze", me)
    C.link(hz)
    ev = scene.eevee
    for attr, val in (("volumetric_end", 120.0), ("volumetric_samples", 48), ("shadow_pool_size", "1024")):
        if hasattr(ev, attr):
            try:
                setattr(ev, attr, val)
            except Exception:
                pass


# ── entry point ──────────────────────────────────────────────────────────────────────────────────
def build(mdef: dict, layout: dict, ctx) -> None:
    for name, (hexc, rough, metal, emis, double) in NEW_MATERIALS.items():
        ctx.define_material(name, hexc, rough=rough, metal=metal, emis=emis, double=double)
    ctx.strip_positions = []
    build_architecture(ctx)
    build_props(ctx)
    install_preview_shaders(ctx)
    ctx.render_hooks.append(render_look)
    ctx.render_light_scale = 110.0
    ctx.info["df_floors"] = [0.0, 4.5, 9.0]
    ctx.summary["floors"] = {"press_hall": 0.0, "docks": 1.0, "mezzanine": 4.5, "crane_walk": 9.0}
    # QA stations (§15): top (roof cut away, floors colour-coded), persp (SUNCREW dock), nest, interior
    top = ctx.cameras["top"]
    top["ortho_scale"] = 74.0
    top["before"], top["after"] = _tint_floors_on, _tint_floors_off
    ctx.cameras["persp"].update({"eye": [1.8, 2.45, -24.4], "look": [0.0, 1.5, 2.0], "fov": 62.0})   # SUNCREW dock lip, player eye
    ae = ctx.cameras["aerial"]
    ae.update({"eye": [44.0, 34.0, -58.0], "look": [1.0, 1.0, 2.0], "fov": 50.0,
               "before": _cutaway_on, "after": _cutaway_off})
    ctx.add_camera("nest", eye=(0.35, 11.0, 2.95), look=(0.0, 2.2, -26.0), fov=58.0)
    # east gallery, beside (not behind) crate_g1 so the gallery floor, the conveyor head and mid all read
    ctx.add_camera("interior", eye=(14.1, 6.3, -23.3), look=(2.0, 3.8, 1.5), fov=62.0)
    ctx.add_camera("dock", eye=(5.5, 3.6, -13.5), look=(-1.0, 2.4, -30.0), fov=60.0)
