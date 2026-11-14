"""DYEFIELD — CINDER REEF builder module (CONTRACT_ART_P6_8 §14, §16).

Called by the shared pipeline (build_map.py) as build(mdef, layout, ctx); layout = data/layouts/cinder.json.
A broken atoll with no tiles: the movement grammar is ROTATION TAX. Deep channels (oob_ volumes
under the water surface) split two team beaches, two basalt side isles and the high Mid Isle,
where a rusted wreck lies with its deck at 3.5 m. You cross on plank bridges, shallow sandbars
or tide-springs (spring_ pads with df_launch arcs computed here and verified by cinder_verify.py).

What this module authors:
  - GROUND: one EXACT union of the wet-sand heightfield solid (cinder_terrain.py) with every basalt
    shelf / column / outcrop, the coral heads and the wreck (hull + bulwarks + wheelhouse), minus the
    spawn-pad pockets, the tunnel breach, the bulwark rust holes and the wheelhouse windows. It is
    cut at the waterline: above it paint_wetsand / paint_shallows (the tidal band) / paint_basalt /
    paint_coral_rock / paint_wreck / paint_wreck_deck; below it solid_seabed; undersides go to
    solid_undersides.
  - BRIDGES: paint_plank decks, solid_bridge_posts, deco_ropes, col_bridge_rails.
  - SPRINGS: spring_<id> pads (M_spring) with df_launch / df_land / df_flight extras + solid rims.
  - OOB: oob_sea (everything under the water surface) + one named oob_chan_* box per deep channel.
  - PROPS: crates (flotsam, snapped to the sand), spawn pads, masts + rigging, palms, driftwood,
    kelp, lanterns (light_* empties), buoys, pennants, a HARBOR CUP banner, columnar sea stacks and
    the broken atoll rim.
  - QA: the 'mid' and 'crossing' camera stations and render-only looks (depth-tinted water with
    shoreline foam, overcast warm sun, light mist).
"""
from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

import cinder_props as CP
import cinder_terrain as CT
import common as C
import deco_assets as D

# Arch material list (bmesh material_index = position). Sand is re-tagged by height after the union.
MATS = ["M_wetsand", "M_shallows", "M_seabed", "M_basalt", "M_coral_rock", "M_wreck", "M_wreck_deck", "M_cliff"]
# M_cliff tags the back-cliff columns inside the union; their faces go to solid_cliff as M_basalt
# name -> (sRGB base, roughness, metallic, emission, double-sided). Plain Principled: the runtime swaps
# them by name and falls back to the base colour.
MATERIALS = {
    "M_wetsand":    ("#E8C084", 0.78, 0.0, 0.0, False),   # warm damp sand
    "M_shallows":   ("#BFA176", 0.42, 0.0, 0.0, False),   # the tidal band + sandbars: darker, glossy
    "M_seabed":     ("#5F9E90", 0.90, 0.0, 0.0, False),   # under the water surface (not paintable)
    "M_basalt":     ("#45403F", 0.86, 0.0, 0.0, False),   # warm charcoal basalt (neutral vs both dyes)
    "M_coral_rock": ("#E58B6E", 0.80, 0.0, 0.0, False),   # coral heads
    "M_wreck":      ("#7C4B3B", 0.72, 0.15, 0.0, False),  # dark rust brown (reads apart from SUNCREW orange)
    "M_wreck_deck": ("#77838A", 0.58, 0.30, 0.0, False),  # weathered steel deck plate
    "M_plank":      ("#B48C5C", 0.82, 0.0, 0.0, False),   # bridge planks + posts
    "M_driftwood":  ("#CDBB9E", 0.90, 0.0, 0.0, False),   # bleached logs
    "M_kelp":       ("#4E5A22", 0.62, 0.0, 0.0, True),
    "M_spring":     ("#3FF0D6", 0.30, 0.0, 1.2, False),   # tide-spring pad (the runtime pulses it)
    "M_cliff":      ("#45403F", 0.86, 0.0, 0.0, False),   # build-time tag only (exported as M_basalt)
    "M_moss":       ("#7DB04E", 0.88, 0.0, 0.0, False),   # moss caps on the sea-stack plateaus (deco only)
}
FIXUPS: dict = {}
OVERLAP_OK: set = set()
PAD_POCKET = 0.3
TIDAL_BAND = 0.38            # sand within this height above the waterline is M_shallows
# bulwark rust holes on the port (+z) side; each gets its rot180 partner on the starboard side
BULWARK_HOLES = [(-8.3, 1), (-2.9, 1), (2.3, 1), (8.9, 1)]
# sea stacks around the atoll (glTF x, z, radius, height), authored for one half; the brush mirror
# rotates them for the other half
SEA_STACKS = [(-56.0, -38.0, 3.2, 14.0), (44.0, -60.0, 2.6, 9.0), (-63.0, 6.0, 4.0, 18.0), (57.0, -14.0, 2.3, 7.5),
              (-29.0, -66.0, 3.0, 11.0), (13.0, -72.0, 2.2, 8.0), (-78.0, -52.0, 5.0, 22.0)]


def is_mirror(b) -> bool:
    return b["id"] != b.get("_base", b["id"])


def define_materials(ctx):
    for name, spec in MATERIALS.items():
        ctx.define_material(name, *spec)


# ── ground: heightfield + basalt + coral + wreck, one EXACT union ───────────────────────────────
def rock_ops(ctx, arch):
    ops = []
    mb = arch.idx("basalt")
    for b in ctx.brushes_of("shelf"):
        outline = [(p[0], p[2]) for p in b["points"]]
        ops.append((f"_op_{b['id']}", CP.rock_prism_bm(outline, b["top"], b.get("bottom", -1.8), mb, b["_base"],
                                                       seg=b.get("seg", 1.4), jitter=b.get("jitter", 0.2),
                                                       bevel=b.get("bevel", 0.14))))
    for b in ctx.brushes_of("column"):
        mi = mb if b.get("paint", True) else arch.idx("cliff")
        for k, p in enumerate(b["points"]):
            ops.append((f"_op_{b['id']}_{k}", CP.column_bm(p[0], p[2], b["r"], p[1], b.get("bottom", -1.5), mi,
                                                           f"{b['_base']}_{k}")))
    for b in ctx.brushes_of("outcrop"):
        off = CP.outcrop_outline(b["pos"], b["radius"], b.get("verts", 7), b["_base"])
        tx, _, tz = b.get("tilt", [0.0, 0.0, 0.0])
        if is_mirror(b):
            off = [(-x, -z) for (x, z) in off]
            tx, tz = -tx, -tz
        outline = [(b["pos"][0] + x, b["pos"][2] + z) for (x, z) in off]
        ops.append((f"_op_{b['id']}", CP.rock_prism_bm(outline, b["top"], b.get("bottom", -1.8), mb, b["_base"], seg=None,
                                                       jitter=0.0, bevel=0.12, batter_deg=7.0, tilt=(tx, tz),
                                                       mid_jitter=0.12)))
    mc = arch.idx("coral_rock")
    for b in ctx.brushes_of("coral"):
        gy = ctx.cinder_T.at(b["pos"][0], b["pos"][2])
        ops.append((f"_op_{b['id']}", CP.coral_bm(b["pos"], b["size"], b.get("yaw", 0.0), gy, mc, b["_base"])))
    return ops


def build_ground(ctx, wreck):
    T = ctx.cinder_T
    tp = ctx.layout["props"]["terrain"]
    W = float(ctx.mdef["waterY"])
    arch = ctx.arch(MATS, default="wetsand", lip="wetsand")
    base_bm, _ = CT.terrain_solid_bm(T, tp["halfX"], tp["halfZ"], tp["step"], tp["bottomY"], arch.idx("wetsand"))
    ctx.log(f"cinder: terrain solid {len(base_bm.faces)} faces ({tp['step']} m grid)")
    ops = rock_ops(ctx, arch)
    mw, md = arch.idx("wreck"), arch.idx("wreck_deck")
    ops.append(("_op_hull", wreck.hull_bm(mw, md)))
    for k, bm in enumerate(wreck.bulwark_bms(mw)):
        ops.append((f"_op_bulwark_{k}", bm))
    for k, bm in enumerate(wreck.house_bms(mw, md)):
        ops.append((f"_op_house_{k}", bm))
    for k, bm in enumerate(wreck.stems(mw)):
        ops.append((f"_op_stem_{k}", bm))
    pads = ctx.brushes_of("spawnpad")
    cutters = arch.pad_pockets(pads, PAD_POCKET)
    cutters.append(("_cut_tunnel", wreck.tunnel_cutter(mw)))
    for k, bm in enumerate(wreck.bulwark_hole_cutters(mw, BULWARK_HOLES)):
        cutters.append((f"_cut_hole_{k}", bm))
    for k, bm in enumerate(wreck.house_window_cutters(mw)):
        cutters.append((f"_cut_window_{k}", bm))
    bm = arch.union(base_bm, ops, cutters)
    # waterline, tidal-band and flat-bed cuts (every face is then fully above or below each level)
    bed = float(tp["bedY"])
    for y in (W, W + TIDAL_BAND, bed + 0.08):
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=C.g2b(0.0, y, 0.0), plane_no=(0.0, 0.0, 1.0), dist=1e-5)
    C.cleanup_degenerate(bm)
    bm.normal_update()
    (x0, x1), (z0, z1) = (-tp["halfX"], tp["halfX"]), (-tp["halfZ"], tp["halfZ"])
    arch.grid_cut(bm, "basalt", -34, 34, -48, 48, 4)
    arch.grid_cut(bm, "wreck_deck", -12, 12, -6, 6, 2)
    bm.normal_update()
    i_sand, i_sh, i_bed = arch.idx("wetsand"), arch.idx("shallows"), arch.idx("seabed")
    i_cliff, i_coral = arch.idx("cliff"), arch.idx("coral_rock")
    edge_eps = 0.02

    def classify(f):
        gx, gy, gz = C.b2g(f.calc_center_median())
        for b in pads:                                   # pad pocket interior (hidden under the pad)
            pc = b["center"]
            if math.hypot(gx - pc[0], gz - pc[2]) < b["radius"] + 0.06 and gy < pc[1] - 0.005:
                return None
        nx, ny, nz = C.b2g(f.normal)
        if gy < W - 1e-4:
            if gy < bed + 0.08 or abs(gx) > x1 - edge_eps or abs(gz) > z1 - edge_eps:
                return None                               # flat bed (one plane added below) + block skirts
            if f.material_index in (i_sand, i_sh):
                f.material_index = i_bed
            if f.material_index == i_cliff:
                f.material_index = arch.idx("basalt")
            return "solid_seabed"
        if ny < -0.5:
            return "solid_undersides"
        if f.material_index == i_cliff:
            return "solid_cliff"                          # the backdrop behind the spawn: not paintable
        if f.material_index == i_coral:
            return "solid_coral"                          # knee-high coral heads: cover, not turf
        if f.material_index in (i_sand, i_sh, i_bed):
            f.material_index = i_sh if gy < W + TIDAL_BAND else i_sand
            return "paint_sand"                           # one object: the tidal band stays in the dune islands
        return "paint_" + MATS[f.material_index][2:]
    ctx.geos.update(arch.to_geos(bm, classify))
    bm.free()
    g = ctx.geos.get("solid_cliff")
    if g is not None:
        g.fmat = ["M_basalt" if m == "M_cliff" else m for m in g.fmat]
    # Atlas passes (the pipeline smart-projects each df_group on its own, CONTRACT_ART_P6_8 §14.1):
    # sand by land region, basalt by connected rock - so the tilted axes of crates / chamfers / hull
    # plates never fragment the dunes into slivers.
    if "paint_sand" in ctx.geos:
        region_groups(ctx.geos["paint_sand"], sand_region)
    if "paint_basalt" in ctx.geos:
        component_groups(ctx.geos["paint_basalt"])
    for name in ("paint_sand", "solid_seabed"):          # smooth dunes (set_sharp_from_angle keeps creases)
        if name in ctx.geos:
            ctx.geos[name].fsmooth = [True] * len(ctx.geos[name].faces)
    # the flat channel bed: one plane just under the cut level (hidden under the land)
    pb = CP.box_bm([x0, bed - 0.4, z0], [x1, bed + 0.02, z1], i_bed)
    for f in list(pb.faces):
        if f.normal.z < 0.5:
            pb.faces.remove(f)
    ctx.bucket("solid_seabed").add_bm(pb, "M_seabed")
    pb.free()


def sand_region(x, z):
    """Atlas region of a sand face (glTF centroid): the two beaches, the four sandbar zones, the two
    side isles and Mid Isle (rot180-symmetric partition)."""
    if abs(z) >= 29.0:
        return 0 if z < 0 else 1
    if abs(z) >= 20.8 and abs(x) > 12.0:
        return 2 + (x > 0) + 2 * (z > 0)
    if x < -12.0:
        return 6
    if x > 12.0:
        return 7
    return 8


def region_groups(g: C.Geo, fn):
    """df_group per face = fn(centroid x, z) (renumbered densely in first-use order)."""
    ids = {}
    grp = []
    for f in g.faces:
        n = len(f)
        cx = sum(g.verts[i].x for i in f) / n
        cz = -sum(g.verts[i].y for i in f) / n              # Blender y = -glTF z
        r = fn(cx, cz)
        grp.append(ids.setdefault(r, len(ids)))
    g.fgroup, g.ngroups = grp, len(ids)


def component_groups(g: C.Geo):
    """df_group per face = its connected component (faces sharing a vertex)."""
    parent = list(range(len(g.verts)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for f in g.faces:
        r0 = find(f[0])
        for i in f[1:]:
            ri = find(i)
            if ri != r0:
                parent[ri] = r0
    ids = {}
    g.fgroup = [ids.setdefault(find(f[0]), len(ids)) for f in g.faces]
    g.ngroups = len(ids)


# ── bridges ──────────────────────────────────────────────────────────────────────────────────────
def build_bridges(ctx):
    T = ctx.cinder_T
    bed = ctx.layout["props"]["terrain"]["bedY"]
    out = []
    for b in ctx.brushes_of("bridge"):
        ends = []
        for p in b["points"]:
            y = p[1] if p[1] is not None else T.at(p[0], p[2]) + 0.05
            ends.append([p[0], y, p[2]])
        parts = CP.bridge_parts(b["_base"], ends[0], ends[1], b.get("width", 2.5), b.get("arch", 0.45), bed, 0)
        dbm = parts["deck"]
        L = parts["length"]
        ux, uz = (ends[1][0] - ends[0][0]) / L, (ends[1][2] - ends[0][2]) / L
        paint, under = C.Geo("deck"), C.Geo("under")
        dbm.normal_update()
        for f in dbm.faces:
            nx, ny, nz = C.b2g(f.normal)
            g = under if (ny < -0.5 or abs(nx * ux + nz * uz) > 0.7) else paint
            vs = [v.co.copy() for v in f.verts]
            base = len(g.verts)
            g.verts += vs
            g.faces.append(tuple(range(base, base + len(vs))))
            g.fmat.append("M_plank")
            g.fsmooth.append(False)
        dbm.free()
        ctx.bucket("paint_plank").extend(_weld(paint))
        ctx.bucket("solid_bridge_under").extend(_weld(under))
        ctx.bucket("solid_bridge_posts").extend(parts["posts"])
        ctx.bucket("deco_ropes").extend(parts["ropes"])
        ctx.bucket("col_bridge_rails").extend(parts["rails"])
        mid = parts["profile"](0.5)
        out.append({"id": b["id"], "ends": [[round(v, 3) for v in e] for e in ends], "length": round(L, 2),
                    "mid_deck_y": round(mid[1], 3), "width": b.get("width", 2.5)})
        ctx.log(f"bridge {b['id']}: {L:.1f} m, ends y {ends[0][1]:.2f} / {ends[1][1]:.2f}, mid {mid[1]:.2f}")
    return out


def _weld(g: C.Geo) -> C.Geo:
    """Merge coincident verts of a face-soup Geo (so each deck side is one connected island)."""
    out = C.Geo(g.name)
    idx = {}
    for f, m, s in zip(g.faces, g.fmat, g.fsmooth):
        ids = []
        for i in f:
            v = g.verts[i]
            k = (round(v.x, 5), round(v.y, 5), round(v.z, 5))
            if k not in idx:
                idx[k] = len(out.verts)
                out.verts.append(v.copy())
            ids.append(idx[k])
        out.faces.append(tuple(ids))
        out.fmat.append(m)
        out.fsmooth.append(s)
    return out


# ── tide-springs ─────────────────────────────────────────────────────────────────────────────────
def build_springs(ctx):
    T = ctx.cinder_T
    g = 15.0
    out = []
    for b in ctx.brushes_of("spring"):
        px, _, pz = b["pos"]
        ground = T.at(px, pz)
        pad, rim = CP.spring_pad(b["pos"], ground)
        node = b["id"] if b["id"].startswith("spring_") else "spring_" + b["id"]
        ctx.bucket(node).extend(pad)
        ctx.bucket("solid_spring_rims").extend(rim)
        start = [px, ground + 0.2, pz]
        vel, t = CP.launch_velocity(start, b["target"], float(b["apex"]), g)
        vel = [round(v, 4) for v in vel]
        ctx.set_extras(node, df_launch=vel, df_land=[round(v, 3) for v in b["target"]], df_flight=round(t, 3))
        out.append({"node": node, "pad_top": [round(v, 3) for v in start], "df_launch": vel, "target": b["target"],
                    "apex": b["apex"], "flight_s": round(t, 3)})
        ctx.log(f"spring {node}: pad top {start[1]:.2f}, df_launch {vel}, flight {t:.2f} s -> {b['target']}")
    return out


# ── out-of-bounds volumes ────────────────────────────────────────────────────────────────────────
def build_oob(ctx):
    W = float(ctx.mdef["waterY"])
    top = W - 0.2
    sea = CP.box_bm([-90.0, -9.0, -100.0], [90.0, top, 100.0], 0)
    ctx.bucket("oob_sea").add_bm(sea, "M_seabed")
    sea.free()
    out = {"oob_sea": {"min": [-90.0, -9.0, -100.0], "max": [90.0, top, 100.0]}}
    for b in ctx.brushes_of("channel"):
        mn, mx = list(b["min"]), list(b["max"])
        mx[1] = min(mx[1], top)
        bm = CP.box_bm(mn, mx, 0)
        name = "oob_" + b["id"]
        ctx.bucket(name).add_bm(bm, "M_seabed")
        bm.free()
        out[name] = {"min": mn, "max": mx}
    return out


# ── props ────────────────────────────────────────────────────────────────────────────────────────
def snap_crates(ctx):
    T = ctx.cinder_T
    for b in ctx.brushes_of("crate"):
        if not b.get("snap") or b.get("onRock"):
            continue
        x, _, z = b["center"]
        h = b["size"] * 0.5
        ys = [T.at(x + dx, z + dz) for dx in (-h, 0, h) for dz in (-h, 0, h)]
        b["center"] = [x, round(min(ys) - 0.03, 4), z]


def _deco_palm(ctx, b, m):
    x, _, z = b["pos"]
    gy = ctx.cinder_T.at(x, z)
    p = D.palm(b["_base"], 0.0)
    M = C.place_matrix([x, gy, z], b.get("yaw", 0.0))
    ctx.bucket("solid_palm_trunks").extend(p["trunk"], M)
    ctx.bucket("deco_palm_fronds").extend(p["fronds"], M)


def _deco_driftwood(ctx, b, m):
    T = ctx.cinder_T
    g = CP.driftwood(b.get("length", 3.5), b["_base"], T.at, b["pos"], b.get("yaw", 0.0))
    ctx.bucket("solid_driftwood" if b.get("collide", True) else "deco_driftwood").extend(g)


def _deco_kelp(ctx, b, m):
    T = ctx.cinder_T
    ctx.bucket("deco_kelp").extend(CP.kelp_pile(b["_base"], T.at, b["pos"], b.get("yaw", 0.0), b.get("scale", 1.0)))


def _deco_pennant(ctx, b, m):
    x, _, z = b["pos"]
    M = C.place_matrix([x, ctx.cinder_T.at(x, z) - 0.05, z], b.get("yaw", 0.0))
    ctx.bucket("deco_flags").extend(D.pennant(b["team"], b["_base"]), M)


def _deco_seastacks(ctx, b, m):
    """Columnar-basalt mesas around the atoll: moss-capped plateaus, and a palm (or two) on the big ones."""
    W = float(ctx.mdef["waterY"])
    for k, (x, z, r, h) in enumerate(SEA_STACKS):
        if is_mirror(b):
            x, z = -x, -z
        rock, moss, tops = CP.sea_stack(f"{b['_base']}_{k}", [x, W, z], r, h, W)
        ctx.bucket("deco_seastacks").extend(rock)
        ctx.bucket("deco_seastacks").extend(moss)
        for j, tp in enumerate(tops[: (2 if r >= 4.0 else 1 if r >= 2.9 else 0)]):
            p = D.palm(f"stack_{k}_{j}", 0.0)
            pm = C.place_matrix(list(tp), 37.0 * k + 120.0 * j) @ Matrix.Diagonal((0.8, 0.8, 0.8, 1.0))
            ctx.bucket("deco_seastacks").extend(p["trunk"], pm)
            ctx.bucket("deco_seastacks").extend(p["fronds"], pm)


def _deco_horizon(ctx, b, m):
    """The broken atoll rim: low basalt reefs at ~100 m with passes, and three palm islets (deco)."""
    W = float(ctx.mdef["waterY"])
    rnd = C.rng("rim", b["_base"])
    rim = C.Geo("rim")
    for k in range(34):
        a = math.tau * k / 34 + rnd.uniform(-0.05, 0.05)
        if (k % 9) in (0, 1):
            continue                                        # the atoll rim is broken (passes)
        R = rnd.uniform(96, 118)
        x, z = R * math.sin(a), R * math.cos(a) * 1.15
        s = rnd.uniform(3.0, 6.5)
        rb = bmesh.new()
        D._rock(rb, C.g2b(x, W - 0.5, z), (s * 1.6, s, s * 0.55), rnd, flat=0.5)
        rim.add_bm(rb, "M_basalt")
        rb.free()
        if k in (4, 15, 25):
            sb = bmesh.new()
            C.bm_lathe(sb, [(0.0, 0.6), (s * 1.3, 0.5), (s * 1.9, -0.6)], seg=14)
            rim.add_bm(sb, "M_wetsand", matrix=Matrix.Translation(C.g2b(x, W, z)))
            sb.free()
            for j in range(1):
                p = D.palm(f"rim_{k}_{j}", 0.0)
                pm = C.place_matrix([x + rnd.uniform(-2, 2), W + 0.5, z + rnd.uniform(-2, 2)], rnd.uniform(0, 360))
                rim.extend(p["trunk"], pm)
                rim.extend(p["fronds"], pm)
    ctx.bucket("deco_horizon").extend(rim)


def build_lanterns(ctx, wreck_tops):
    """Warm lanterns (light_* empties) at the beach bridge heads and beside the beach springs, plus
    the two masthead lamps. <= 6 get real point lights at runtime."""
    T = ctx.cinder_T
    spots = []
    for b in ctx.brushes_of("bridge"):
        if b["_base"] != "bridge_w":
            continue
        (x0, _, z0), (x1, _, z1) = b["points"]
        L = math.hypot(x1 - x0, z1 - z0)
        ux, uz = (x1 - x0) / L, (z1 - z0) / L
        vx, vz = -uz, ux
        s = 1 if not is_mirror(b) else -1
        spots.append((f"light_lantern_{b['id']}", x0 + vx * 2.1 * s - ux * 0.6, z0 + vz * 2.1 * s - uz * 0.6,
                      math.degrees(math.atan2(-ux, -uz))))
    for b in ctx.brushes_of("spring"):
        if b["_base"] != "spring_beach":
            continue
        x, _, z = b["pos"]
        s = 1 if not is_mirror(b) else -1
        spots.append((f"light_lantern_{b['id']}", x - 2.2 * s, z - 0.4 * s, 90.0 if s > 0 else -90.0))
    for name, x, z, yaw in spots:
        gy = T.at(x, z)
        wood, glow, lamp_local = CP.lantern_post(gy)
        M = C.place_matrix([x, 0.0, z], yaw)
        ctx.bucket("solid_lanterns").extend(wood, M)
        ctx.bucket("deco_lanterns").extend(glow, M)
        lp = C.b2g(M @ lamp_local)
        ctx.add_light(name, [round(v, 3) for v in lp], "#FFB35C", 2.4, 11.0)
    for k, tp in enumerate(sorted(wreck_tops, key=lambda p: p[0])):
        ctx.add_light(f"light_masthead_{'w' if tp[0] < 0 else 'e'}", [round(tp[0], 3), round(tp[1] + 0.2, 3), round(tp[2], 3)],
                      "#FFC37A", 2.0, 13.0)
        lb = bmesh.new()
        C.bm_icosphere(lb, 0.16, 1, Matrix.Translation(C.g2b(tp[0], tp[1] + 0.2, tp[2])))
        ctx.bucket("deco_lanterns").add_bm(lb, "M_lamp", smooth=True)
        lb.free()


# ── QA-render looks (never exported) ────────────────────────────────────────────────────────────
def _node(nt, kind, **inputs):
    n = nt.nodes.new(kind)
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def _noise(nt, vec, scale, detail=2.0, rough=0.5):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    nt.links.new(vec, n.inputs["Vector"])
    return n.outputs["Fac"]


def _world_vec(nt, sx=1.0, sy=1.0, sz=1.0):
    g = nt.nodes.new("ShaderNodeNewGeometry")
    mp = nt.nodes.new("ShaderNodeVectorMath")
    mp.operation = "MULTIPLY"
    mp.inputs[1].default_value = (sx, sy, sz)
    nt.links.new(g.outputs["Position"], mp.inputs[0])
    return mp.outputs[0], g


def _ps_sand(ctx, nt, bsdf, base):
    sh = ctx.sh
    vec, g = _world_vec(nt)
    mottle = _noise(nt, vec, 0.35, 3.0)
    x, z, y = sh.pos(nt)
    rip = sh.math(nt, "SINE", sh.math(nt, "ADD", sh.math(nt, "MULTIPLY", sh.math(nt, "ADD", sh.math(nt, "MULTIPLY", x, 0.6),
                                                                                 sh.math(nt, "MULTIPLY", z, 0.8)), 5.5),
                                         sh.math(nt, "MULTIPLY", mottle, 6.0)))
    streak = sh.math(nt, "MULTIPLY", sh.math(nt, "GREATER_THAN", rip, 0.82), 0.5)
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", mottle, 0.55), tuple(v * 1.06 for v in base), tuple(v * 0.84 for v in base))
    c = sh.mix(nt, streak, c, tuple(v * 0.9 for v in base))
    W = ctx.mdef["waterY"]
    wet = sh.math(nt, "SUBTRACT", 1.0, sh.math(nt, "DIVIDE", sh.math(nt, "SUBTRACT", y, W), 1.1), clamp=True)
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", wet, 0.45), c, tuple(v * 0.72 for v in base))
    return c


def _ps_shallows(ctx, nt, bsdf, base):
    sh = ctx.sh
    vec, g = _world_vec(nt)
    m = _noise(nt, vec, 0.6, 2.0)
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", m, 0.6), tuple(v * 1.05 for v in base), (0.30, 0.36, 0.30))
    bsdf.inputs["Roughness"].default_value = 0.3
    return c


def _ps_basalt(ctx, nt, bsdf, base):
    sh = ctx.sh
    u, v = sh.uv(nt)
    vec, g = _world_vec(nt)
    joints = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, sh.math(nt, "ADD", u, sh.math(nt, "MULTIPLY", _noise(nt, vec, 0.6), 1.4)), 1.15), 0.025)
    cracks = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, sh.math(nt, "ADD", v, sh.math(nt, "MULTIPLY", _noise(nt, vec, 0.5), 1.2)), 1.3), 0.02)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(g.outputs["Normal"], sep.inputs[0])
    top = sh.math(nt, "GREATER_THAN", sep.outputs["Z"], 0.8)
    mottle = _noise(nt, vec, 1.4, 3.0)
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", mottle, 0.7), tuple(v * 1.15 for v in base), tuple(v * 0.8 for v in base))
    c = sh.mix(nt, sh.math(nt, "MAXIMUM", joints, cracks), c, tuple(v * 0.45 for v in base))
    lichen = sh.math(nt, "MULTIPLY", top, sh.math(nt, "GREATER_THAN", _noise(nt, vec, 1.1, 2.0), 0.6))
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", lichen, 0.55), c, C.hex_to_linear("#9DAA86"))   # sage lichen (never dye-orange)
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", top, 0.35), c, tuple(v * 1.35 for v in base))
    x, z, y = sh.pos(nt)
    salt = sh.math(nt, "MULTIPLY", sh.math(nt, "SUBTRACT", 1.0, sh.math(nt, "DIVIDE", sh.math(nt, "SUBTRACT", y, -0.6), 1.2), clamp=True), 0.5)
    c = sh.mix(nt, salt, c, C.hex_to_linear("#8C8274"))          # salt-crusted, wet-darkened foot
    return c


def _ps_wreck(ctx, nt, bsdf, base):
    sh = ctx.sh
    vec, g = _world_vec(nt)
    x, z, y = sh.pos(nt)
    streak_v, _ = _world_vec(nt, 2.2, 2.2, 0.25)
    streaks = _noise(nt, streak_v, 1.6, 2.0)
    chips = _noise(nt, vec, 1.8, 4.0, 0.6)
    band = sh.math(nt, "MULTIPLY", sh.math(nt, "GREATER_THAN", y, 1.55), sh.math(nt, "LESS_THAN", y, 3.36))
    paint = sh.math(nt, "MULTIPLY", band, sh.math(nt, "GREATER_THAN", chips, 0.40))
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", streaks, 0.8), tuple(v * 1.05 for v in base), tuple(v * 0.55 for v in base))
    c = sh.mix(nt, paint, c, C.hex_to_linear("#3E8E86"))
    stripe = sh.math(nt, "MULTIPLY", sh.math(nt, "GREATER_THAN", y, 3.12), sh.math(nt, "LESS_THAN", y, 3.34))
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", stripe, sh.math(nt, "GREATER_THAN", chips, 0.4)), c, C.hex_to_linear("#E9DCC2"))
    return c


def _ps_deck(ctx, nt, bsdf, base):
    sh = ctx.sh
    u, v = sh.uv(nt)
    vec, g = _world_vec(nt)
    seam = sh.math(nt, "LESS_THAN", sh.math(nt, "MINIMUM", sh.edge_dist(nt, u, 1.6), sh.edge_dist(nt, v, 1.2)), 0.025)
    rust = sh.math(nt, "GREATER_THAN", _noise(nt, vec, 0.9, 3.0), 0.58)
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", _noise(nt, vec, 2.5), 0.5), tuple(v * 1.1 for v in base), tuple(v * 0.85 for v in base))
    c = sh.mix(nt, sh.math(nt, "MULTIPLY", rust, 0.7), c, C.hex_to_linear("#6B4636"))
    c = sh.mix(nt, seam, c, tuple(v * 0.5 for v in base))
    return c


def _ps_plank(ctx, nt, bsdf, base):
    sh = ctx.sh
    u, v = sh.uv(nt)
    x, z, y = sh.pos(nt)
    k = sh.math(nt, "GREATER_THAN", sh.math(nt, "ABSOLUTE", x), 22.0)   # beach bridges run along z
    coord = sh.math(nt, "ADD", sh.math(nt, "MULTIPLY", k, v), sh.math(nt, "MULTIPLY", sh.math(nt, "SUBTRACT", 1.0, k), u))
    seam = sh.math(nt, "LESS_THAN", sh.edge_dist(nt, coord, 0.3), 0.018)
    row = sh.math(nt, "FLOOR", sh.math(nt, "DIVIDE", coord, 0.3))
    tint = sh.math(nt, "ADD", 0.86, sh.math(nt, "MULTIPLY", sh.white(nt, row, 3.0), 0.24))
    comb = nt.nodes.new("ShaderNodeCombineColor")
    for i in range(3):
        nt.links.new(tint, comb.inputs[i])
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    sh.sock(mul, "Factor_Float").default_value = 1.0
    sh.sock(mul, "A_Color").default_value = (*base, 1.0)
    nt.links.new(comb.outputs[0], sh.sock(mul, "B_Color"))
    planks = next(o for o in mul.outputs if o.identifier == "Result_Color")
    return sh.mix(nt, seam, planks, tuple(v * 0.45 for v in base))


def _ps_coral(ctx, nt, bsdf, base):
    sh = ctx.sh
    vec, g = _world_vec(nt)
    n = _noise(nt, vec, 4.0, 3.0, 0.7)
    return sh.mix(nt, sh.math(nt, "MULTIPLY", n, 0.9), tuple(v * 1.2 for v in base), tuple(v * 0.7 for v in base))


def _ps_driftwood(ctx, nt, bsdf, base):
    sh = ctx.sh
    vec, g = _world_vec(nt, 3.0, 3.0, 3.0)
    n = _noise(nt, vec, 1.2, 4.0, 0.7)
    return sh.mix(nt, sh.math(nt, "MULTIPLY", n, 0.8), tuple(v * 1.1 for v in base), tuple(v * 0.7 for v in base))


def render_water(ctx, sc):
    """Depth-tinted opaque water over the play area (turquoise over sand, dark over the channels)
    with shoreline foam; the pipeline's far sea gets the deep colour so the two meet seamlessly."""
    T = ctx.cinder_T
    W = float(ctx.mdef["waterY"])
    preset = ctx.mdef["lighting"]["presets"][ctx.mdef["lighting"]["default"]]
    lin = C.hex_to_linear
    deep = lin(preset["waterDeep"])
    shallow = lin(preset["waterShallow"])
    sea = bpy.data.objects.get("qa_sea")
    if sea is not None:
        sea.hide_render = True                              # replaced by the patch + its horizon skirt
    hx, hz, st = 46.0, 58.0, 0.5
    xs = np.arange(-hx, hx + 1e-6, st)
    zs = np.arange(-hz, hz + 1e-6, st)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    H = T.height(X, Z)
    depth = np.clip(W - H, 0.0, 4.0)
    nx, nz = len(xs), len(zs)
    verts = [(float(xs[i]), -float(zs[j]), W + 0.004) for i in range(nx) for j in range(nz)]
    faces = []
    for i in range(nx - 1):
        for j in range(nz - 1):
            a = i * nz + j
            faces.append((a, a + nz, a + nz + 1, a + 1))
    dvals = list(depth.reshape(-1).astype(np.float32))
    # horizon skirt: a ring of 4 big quads out to 3 km (deep water)
    R = 3000.0
    base = len(verts)
    for (x, z) in ((-hx, -hz), (hx, -hz), (hx, hz), (-hx, hz), (-R, -R), (R, -R), (R, R), (-R, R)):
        verts.append((x, -z, W + 0.004))
        dvals.append(4.0)
    for k in range(4):
        a, b2, c, d = base + k, base + (k + 1) % 4, base + 4 + (k + 1) % 4, base + 4 + k
        faces.append((a, d, c, b2))
    me = bpy.data.meshes.new("qa_water_patch")
    me.from_pydata(verts, [], faces)
    at = me.attributes.new("depth", "FLOAT", "POINT")
    at.data.foreach_set("value", np.array(dvals, np.float32))
    mat = bpy.data.materials.new("qa_water_patch")
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.2
    an = nt.nodes.new("ShaderNodeAttribute")
    an.attribute_name = "depth"
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.92, 0.95, 0.93, 1.0)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (*deep, 1.0)
    for pos, col in ((0.03, (*[min(1.0, c * 1.35 + 0.08) for c in shallow], 1.0)), (0.12, (*shallow, 1.0)),
                     (0.38, (*[shallow[k] * 0.45 + deep[k] * 0.55 for k in range(3)], 1.0))):
        e = cr.elements.new(pos)
        e.color = col
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = 1.5
    # foam: noisy threshold near depth 0
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    nz_ = nt.nodes.new("ShaderNodeTexNoise")
    nz_.inputs["Scale"].default_value = 0.9
    nz_.inputs["Detail"].default_value = 4.0
    nt.links.new(geo.outputs["Position"], nz_.inputs["Vector"])
    jit = ctx.sh.math(nt, "MULTIPLY", ctx.sh.math(nt, "SUBTRACT", nz_.outputs["Fac"], 0.5), 0.16)
    d2 = ctx.sh.math(nt, "ADD", an.outputs["Fac"], jit)
    nt.links.new(d2, mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    nz2 = nt.nodes.new("ShaderNodeTexNoise")
    nz2.inputs["Scale"].default_value = 0.5
    nt.links.new(geo.outputs["Position"], nz2.inputs["Vector"])
    nt.links.new(nz2.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    me.materials.append(mat)
    ob = bpy.data.objects.new("qa_water_patch", me)
    C.link(ob)


def render_sky(ctx, sc):
    """Overcast warm grade: sun energy follows the preset's sunIntensity (Pier 18 noon 3.0 -> 4.8 W)
    with soft shadows, and a brighter sky fill."""
    preset = ctx.mdef["lighting"]["presets"][ctx.mdef["lighting"]["default"]]
    sun = bpy.data.objects.get("qa_sun")
    if sun is not None:
        sun.data.energy = 1.6 * float(preset.get("sunIntensity", 3.0))
        sun.data.angle = math.radians(5.0)
    bg = next(n for n in sc.world.node_tree.nodes if n.type == "BACKGROUND")
    bg.inputs["Strength"].default_value = 1.1


def render_fog(ctx, sc):
    """The runtime's mist as FogExp2 (f = 1 - exp(-(density * d)^2), d = camera distance) mixed into
    every material as an emission in the fog colour (EEVEE world volumes render black headless)."""
    preset = ctx.mdef["lighting"]["presets"][ctx.mdef["lighting"]["default"]]
    dens = float(preset.get("fogDensity", 0.012))
    col = C.hex_to_linear(preset.get("fogColor", "#E6CDB8"))
    ctx._fog_gain = []
    for mat in bpy.data.materials:
        nt = mat.node_tree
        if nt is None:
            continue
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out is None or not out.inputs["Surface"].links:
            continue
        src = out.inputs["Surface"].links[0].from_socket
        cam = nt.nodes.new("ShaderNodeCameraData")
        m = ctx.sh.math
        x = m(nt, "MULTIPLY", cam.outputs["View Distance"], dens)
        f = m(nt, "SUBTRACT", 1.0, m(nt, "EXPONENT", m(nt, "MULTIPLY", m(nt, "MULTIPLY", x, x), -1.0)))
        gain = nt.nodes.new("ShaderNodeValue")
        gain.outputs[0].default_value = 1.0
        fac = m(nt, "MULTIPLY", f, gain.outputs[0])
        em = nt.nodes.new("ShaderNodeEmission")
        em.inputs["Color"].default_value = (*col, 1.0)
        em.inputs["Strength"].default_value = 1.0
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fac, mix.inputs[0])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        ctx._fog_gain.append(gain)


def _fog_off(ctx, sc):
    for gnode in getattr(ctx, "_fog_gain", []):
        gnode.outputs[0].default_value = 0.0


def _fog_thin(ctx, sc):
    for gnode in getattr(ctx, "_fog_gain", []):
        gnode.outputs[0].default_value = 0.35       # the aerial is a lobby view, not a gameplay view


def _fog_on(ctx, sc):
    for gnode in getattr(ctx, "_fog_gain", []):
        gnode.outputs[0].default_value = 1.0


# ── entry point ──────────────────────────────────────────────────────────────────────────────────
def build(mdef: dict, layout: dict, ctx) -> None:
    define_materials(ctx)
    props = layout["props"]
    tp = props["terrain"]
    W = float(mdef["waterY"])
    ctx.cinder_T = CT.Terrain(ctx.brushes, W, tp["bedY"], ripple=tp.get("ripple", 0.07))
    wreck = CP.Wreck(props["wreck"])
    build_ground(ctx, wreck)
    bridges = build_bridges(ctx)
    springs = build_springs(ctx)
    oob = build_oob(ctx)
    msolid, mrig, mtops = wreck.masts()
    ctx.bucket("solid_masts").extend(msolid)
    ctx.bucket("deco_rigging").extend(mrig)
    snap_crates(ctx)
    ctx.build_crates()
    ctx.build_spawnpads(depth=PAD_POCKET + 0.02)
    for asset, fn in (("palm", _deco_palm), ("driftwood", _deco_driftwood), ("kelp", _deco_kelp),
                      ("pennant", _deco_pennant), ("seastacks", _deco_seastacks), ("horizon", _deco_horizon)):
        ctx.register_deco(asset, fn)
    ctx.build_deco()
    build_lanterns(ctx, mtops)
    # QA stations (§16): the wreck from the SUNCREW side of Mid Isle, and the west crossings
    ctx.add_camera("mid", eye=(8.6, 2.5, -13.2), look=(-2.2, 3.4, -0.6), fov=60.0)
    ctx.add_camera("crossing", eye=(-21.6, 2.9, -38.6), look=(-30.0, -0.2, -21.0), fov=62.0)
    ctx.cameras["aerial"].update(eye=[62.0, 34.0, -70.0], look=[0.0, -1.0, 1.0], before=_fog_thin, after=_fog_on)
    ctx.cameras["top"]["before"] = _fog_off
    ctx.cameras["top"]["after"] = _fog_on
    for mat, fn in (("M_wetsand", _ps_sand), ("M_shallows", _ps_shallows), ("M_basalt", _ps_basalt),
                    ("M_wreck", _ps_wreck), ("M_wreck_deck", _ps_deck), ("M_plank", _ps_plank),
                    ("M_coral_rock", _ps_coral), ("M_driftwood", _ps_driftwood)):
        ctx.add_preview_shader(mat, fn)
    ctx.render_hooks += [render_water, render_sky, render_fog]
    ctx.ao["exclude_prefixes"] = ("col_", "oob_", "water_", "spring_")
    ctx.info["df_tidal_band"] = TIDAL_BAND
    ctx.summary["bridges"] = bridges
    ctx.summary["springs"] = springs
    ctx.summary["oob"] = oob
    ctx.summary["terrain"] = dict(tp)
