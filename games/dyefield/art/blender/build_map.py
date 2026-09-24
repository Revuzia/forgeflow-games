"""DYEFIELD — build an arena GLB from data/maps.json (CONTRACT §3.1, lane MAP).

    python art/build.py map pier18            (= blender --background --factory-startup
                                                 --python art/blender/build_map.py -- --map pier18)
    extra flags after the map id:  --no-render   --samples N   --quick-render

Pipeline (deterministic, idempotent — every run starts from an empty factory scene):
  1. read the map's brushes, apply fix-ups (logged) and the mirror rule (rot180),
  2. ARCHITECTURE: every axis-aligned solid (plate, decks, walls, ramps, blocks, curbs) is unioned
     with the EXACT boolean solver (contact faces vanish, touching faces split), spawn-pad
     pockets are subtracted, convex edges > 30 deg get a 0.045 m two-segment bevel, deck ledges get
     hazard nosing, the court floor is cut on a 4 m grid, and faces are classified:
     pier skirt / bottoms -> solid_pier_skirt, everything else -> paint_<material>,
  3. PROPS: crates (paint_crate), planters (paint_planter + solid soil), palms (solid trunks,
     deco fronds), spawn pads (solid_pad_A/B), lamps + bollards (solid), pilings, billboards,
     banners, lighthouse + breakwater, cranes/port, islands, sailboats (deco),
  4. UVs: 'UVMap' = metres (box projection per face); 'Atlas' = one shared paint atlas across
     ALL paint_* objects in one multi-object edit-mode session: smart project 60 deg (each crate
     instance in its own pass) -> average island scale -> pack islands (margin fraction, 90-degree
     rotations, pre-pack at 2x margin then two final passes, best clean result kept); the atlas
     size is the smallest that can reach >= 80 % of paint.texelsPerMeter (CONTRACT §3.1),
  5. verification: own rasteriser (texel centres, same rule as core/paint/atlas.ts) counts
     cross-island overlaps, margin violations (< 3 px), border violations and per-island density
     spread; bpy.ops.uv.select_overlap is run as a second opinion,
  6. empties spawn_A / spawn_B / mapinfo (extras), export GLB (Y-up, extras, modifiers applied),
  7. EEVEE QA renders (after export, with render-only preview shading that mirrors what the
     runtime LOOK shaders draw: tile grout + court lines, chevrons, hazard stripes, planks).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common as C  # noqa: E402
import deco_assets as D  # noqa: E402

DF_VERSION = 1
# The pier slab underside (fascia depth) is the plate brush's min.y in data/maps.json - the data is
# the single truth (plate_bottom() below); the pilings carry it down to the sea.
ARCH_BEVEL = 0.045
PAD_POCKET = 0.3
ARCH_MATS = ["M_tile", "M_concrete", "M_boardwalk", "M_chevron", "M_hazard"]
# Floating channel buoys around the pier (deco only, in the out-of-bounds water; glTF x, z).
BUOYS = {"pier18": [("red", -39.0, -24.0), ("red", 40.0, 30.0), ("yellow", -41.0, 22.0),
                    ("yellow", 45.0, -47.0), ("red", -22.0, 61.0), ("red", 20.0, -62.0)]}

# Hazard nosing: a 0.35 m hazard band on the top edge of every deck ledge that drops to a lower
# level (same visual language as the ramp lips). Directions are in the brush's own frame; the
# rot180 mirror flips them.
NOSING = {"base_deck": ("+z", "-x", "+x"), "side_deck": ("+x", "-z", "+z"), "buoy_block": ("+z", "-z", "+x", "-x")}
NOSING_W = 0.35
GRID = 4                     # court floor tessellation (m)
# Team pennants flank each base end (deco only; not in maps.json, no gameplay effect). They stand
# this far outboard of the base backwall ends, on the back edge of the pier, and the flag streams
# outboard, so from the court they sit beside - not in front of - the over-water billboard
# lettering behind that end (pennant_clearance() measures it on every build).
PENNANT_OUTSET = 10.0
ARCH_IDX = {"tile": 0, "concrete": 1, "boardwalk": 2, "chevron": 3, "hazard": 4}

# Geometry fix-ups applied to brushes BEFORE mirroring. Each one is reported with the exact
# maps.json change recommended to the orchestrator (data/maps.json is orchestrator-owned).
# (pier18 crate_a3 was fixed here as center [-18.6, 1.2, -27.5]; the integrator moved that fix
#  into data/maps.json, CONTRACT CHANGED(integrator), so the data is the single truth again)
FIXUPS: dict = {
    "pier18": {},
}

T0 = time.time()


def log(*a):
    print(f"[map {time.time() - T0:6.1f}s]", *a, flush=True)


# ── brushes ──────────────────────────────────────────────────────────────────────────────────────
def mirror_brush(b: dict, symmetry: str) -> dict:
    if symmetry != "rot180":
        raise ValueError(f"unsupported symmetry {symmetry!r}")
    m = json.loads(json.dumps(b))
    m["id"] = b["id"] + "_m"
    m["_base"] = b["id"]
    if "min" in b:
        mn, mx = b["min"], b["max"]
        m["min"] = [-mx[0], mn[1], -mx[2]]
        m["max"] = [-mn[0], mx[1], -mn[2]]
    if "rise" in b:
        m["rise"] = {"+x": "-x", "-x": "+x", "+z": "-z", "-z": "+z"}[b["rise"]]
    for key in ("center", "pos"):
        if key in b:
            p = b[key]
            m[key] = [-p[0], p[1], -p[2]]
    if b["kind"] in ("crate", "planter", "deco"):
        m["yaw"] = (b.get("yaw", 0.0) + 180.0)
    if b["kind"] == "spawnpad":
        m["team"] = "B" if b["team"] == "A" else "A"
    return m


def expand_brushes(mdef: dict) -> tuple[list[dict], list[str]]:
    notes = []
    fix = FIXUPS.get(mdef["id"], {})
    out = []
    for b in mdef["brushes"]:
        b = dict(b)
        b["_base"] = b["id"]
        if b["id"] in fix:
            f = fix[b["id"]]
            for k, v in f.items():
                if k != "why":
                    notes.append(f"FIXUP {b['id']}.{k}: {b.get(k)} -> {v}  ({f['why']})")
                    b[k] = v
        out.append(b)
        if b.get("mirror"):
            out.append(mirror_brush(b, mdef["symmetry"]))
    return out, notes


def plate_bottom(brushes: list[dict]) -> float:
    """Pier slab underside = the plate brush's min.y (data/maps.json is the single truth)."""
    plate = next(b for b in brushes if b["id"] == "plate")
    y0, y1 = float(plate["min"][1]), float(plate["max"][1])
    if not y0 < y1:
        raise ValueError(f"plate brush min.y {y0} must be below its top {y1} (it is the slab underside)")
    return y0


def ground_y(brushes: list[dict], x: float, z: float) -> float:
    """Top of the highest axis-aligned box/curb brush over (x, z) (the plate counts); ramps ignored."""
    y = None
    for b in brushes:
        if b["kind"] in ("box", "curb") and "min" in b:
            (x0, _, z0), (x1, y1, z1) = b["min"], b["max"]
            if x0 - 1e-6 <= x <= x1 + 1e-6 and z0 - 1e-6 <= z <= z1 + 1e-6:
                y = y1 if y is None else max(y, y1)
    return 0.0 if y is None else float(y)


def aabb_of(b: dict):
    if "min" in b:
        return b["min"], b["max"]
    if b["kind"] == "crate":
        s = b["size"]
        h = s * 0.5 * (abs(math.cos(math.radians(b.get("yaw", 0)))) + abs(math.sin(math.radians(b.get("yaw", 0)))))
        c = b["center"]
        return [c[0] - h, c[1], c[2] - h], [c[0] + h, c[1] + s, c[2] + h]
    if b["kind"] == "planter":
        c, (w, hh, d) = b["center"], b["size"]
        return [c[0] - w / 2 - 0.05, c[1], c[2] - d / 2 - 0.05], [c[0] + w / 2 + 0.05, c[1] + hh, c[2] + d / 2 + 0.05]
    return None


def validate_brushes(brushes: list[dict]) -> list[str]:
    """Positive-volume AABB overlaps between solid brushes (touching is fine)."""
    warn = []
    solids = [b for b in brushes if b["kind"] in ("box", "ramp", "curb", "crate", "planter") and b["id"] != "plate"]
    eps = 1e-3
    for i in range(len(solids)):
        a0, a1 = aabb_of(solids[i])
        for j in range(i + 1, len(solids)):
            b0, b1 = aabb_of(solids[j])
            ov = [min(a1[k], b1[k]) - max(a0[k], b0[k]) for k in range(3)]
            if all(o > eps for o in ov):
                warn.append(f"overlap {solids[i]['id']} x {solids[j]['id']}: {', '.join(f'{o:.3f}' for o in ov)} m")
    return warn


# ── architecture ─────────────────────────────────────────────────────────────────────────────────
def _box_bm(b, plate=False):
    mn, mx = b["min"], b["max"]
    y0 = mn[1]                   # the plate's min.y IS the slab underside (plate_bottom())
    bm = bmesh.new()
    faces = C.bm_box(bm, (mn[0], -mx[2], y0), (mx[0], -mn[2], mx[1]), ARCH_IDX[b.get("mat", "concrete")])
    bm.normal_update()
    if plate:
        for f in faces:
            f.material_index = ARCH_IDX["tile"] if f.normal.z > 0.5 else ARCH_IDX["concrete"]
    return bm


def _ramp_bm(b):
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    rise = b["rise"]
    sign = 1 if rise[0] == "+" else -1
    if rise[1] == "z":
        across = (x0, x1)
        lo_r, hi_r = (z0, z1) if sign > 0 else (z1, z0)

        def P(a, r, y):
            return C.g2b(a, y, r)
    else:
        across = (z0, z1)
        lo_r, hi_r = (x0, x1) if sign > 0 else (x1, x0)

        def P(a, r, y):
            return C.g2b(r, y, a)
    run = abs(hi_r - lo_r)
    lip = min(0.55, run * 0.12)
    lr = lo_r + (hi_r - lo_r) * lip / run
    ly = y0 + (y1 - y0) * lip / run
    bm = bmesh.new()
    V = lambda a, r, y: bm.verts.new(P(a, r, y))  # noqa: E731
    A0, A1 = V(across[0], lo_r, y0), V(across[1], lo_r, y0)
    L0, L1 = V(across[0], lr, ly), V(across[1], lr, ly)
    T0_, T1_ = V(across[0], hi_r, y1), V(across[1], hi_r, y1)
    B0, B1 = V(across[0], hi_r, y0), V(across[1], hi_r, y0)
    mi = ARCH_IDX[b.get("mat", "concrete")]
    for vs, m in (((A0, A1, L1, L0), ARCH_IDX["hazard"]), ((L0, L1, T1_, T0_), mi), ((T0_, T1_, B1, B0), mi),
                  ((A0, B0, B1, A1), mi), ((A0, L0, T0_, B0), mi), ((A1, B1, T1_, L1), mi)):
        f = bm.faces.new(vs)
        f.material_index = m
    return bm


def _nosed_box_bms(b):
    """Split a deck box into a core + hazard-topped nosing strips along its ledge edges."""
    base = b["_base"]
    dirs = NOSING.get(base)
    if not dirs:
        return [_box_bm(b)]
    if b["id"] != base:
        dirs = tuple({"+x": "-x", "-x": "+x", "+z": "-z", "-z": "+z"}[d] for d in dirs)
    (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
    cx0, cx1, cz0, cz1 = x0, x1, z0, z1
    strips = []
    w = NOSING_W
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
    out = [_box_bm(dict(b, min=[cx0, y0, cz0], max=[cx1, y1, cz1]))]
    for (mn, mx) in strips:
        bm = _box_bm(dict(b, min=mn, max=mx))
        for f in bm.faces:
            if f.normal.z > 0.5:
                f.material_index = ARCH_IDX["hazard"]
        out.append(bm)
    return out


def build_architecture(brushes, mdef):
    log("architecture: building solids")
    plate = next(b for b in brushes if b["id"] == "plate")
    log(f"architecture: pier slab underside y = {plate_bottom(brushes)} (plate brush min.y, data/maps.json)")
    base = C.mesh_object_from_bm("arch", _box_bm(plate, plate=True), ARCH_MATS)
    ops = []
    for b in brushes:
        if b["id"] == "plate":
            continue
        if b["kind"] in ("box", "curb"):
            bms = _nosed_box_bms(b)
        elif b["kind"] == "ramp":
            bms = [_ramp_bm(b)]
        else:
            continue
        for k, bm in enumerate(bms):
            ops.append(C.mesh_object_from_bm(f"_op_{b['id']}_{k}", bm, ARCH_MATS))
            bm.free()
    pockets = []
    pads = [b for b in brushes if b["kind"] == "spawnpad"]
    for b in pads:
        c = C.g2b(*b["center"])
        bm = bmesh.new()
        C.bm_cylinder(bm, b["radius"], b["radius"], c.z - PAD_POCKET, c.z + 0.6, seg=64, center=(c.x, c.y))
        pockets.append(C.mesh_object_from_bm(f"_pocket_{b['id']}", bm, ARCH_MATS))
        bm.free()
    log(f"architecture: EXACT union of {len(ops) + 1} solids, {len(pockets)} pad pockets")
    me = C.boolean_chain(base, [("UNION", ops), ("DIFFERENCE", pockets)])
    bpy.data.objects.remove(base)
    bm = bmesh.new()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    edges = C.sharp_convex_edges(bm, 30.0)
    log(f"architecture: {len(bm.faces)} faces after booleans; bevelling {len(edges)} convex edges")
    C.bevel_edges(bm, edges, ARCH_BEVEL, segments=2, profile=0.5)
    nbad = C.cleanup_degenerate(bm)
    log(f"architecture: removed {nbad} zero-area faces after bevel")
    # Cut the flat court floor on a 4 m grid: the boolean leaves a few huge concave n-gons whose
    # triangulation is long slivers (bad for the Rapier trimesh + per-vertex effects).
    (px0, _, pz0), (px1, _, pz1) = next(b for b in brushes if b["id"] == "plate")["min"],         next(b for b in brushes if b["id"] == "plate")["max"]
    cuts = [(Vector((x, 0, 0)), Vector((1, 0, 0))) for x in range(int(px0) + GRID, int(px1), GRID)] +            [(Vector((0, -z, 0)), Vector((0, 1, 0))) for z in range(int(pz0) + GRID, int(pz1), GRID)]
    for co, no in cuts:
        floor = [f for f in bm.faces if f.material_index == ARCH_IDX["tile"] and f.normal.z > 0.999]
        # order-preserving de-dup: iterating a set of BMesh elements is address-ordered (non-deterministic)
        geom = list(dict.fromkeys(e for f in floor for e in f.edges)) + floor +             list(dict.fromkeys(v for f in floor for v in f.verts))
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
    log(f"architecture: court floor cut on a {GRID} m grid -> "
        f"{sum(1 for f in bm.faces if f.material_index == ARCH_IDX['tile'])} tile faces")
    bm.faces.ensure_lookup_table()

    (bx0, _, bz0), (bx1, _, bz1) = plate["min"], plate["max"]
    buckets = {n: [] for n in ("tile", "concrete", "boardwalk", "chevron", "hazard", "skirt")}
    dropped = 0
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        gx, gy, gz = C.b2g(c)
        # pad pocket interior (hidden under the pad)
        pocket = False
        for b in pads:
            pc = b["center"]
            if math.hypot(gx - pc[0], gz - pc[2]) < b["radius"] + 0.06 and gy < pc[1] - ARCH_BEVEL - 0.005:
                pocket = True
        if pocket:
            dropped += 1
            continue
        nx, ny, nz = C.b2g(n)
        on_edge = (abs(gx - bx0) < 0.02 and nx < -0.85) or (abs(gx - bx1) < 0.02 and nx > 0.85) or \
                  (abs(gz - bz0) < 0.02 and nz < -0.85) or (abs(gz - bz1) < 0.02 and nz > 0.85)
        if ny < -0.5 or on_edge:
            buckets["skirt"].append(f)
        else:
            buckets[ARCH_MATS[f.material_index][2:]].append(f)
    geos = {}
    for key, faces in buckets.items():
        name = "solid_pier_skirt" if key == "skirt" else f"paint_{key}"
        g = C.Geo(name)
        vmap = {}
        for f in faces:
            idx = []
            for v in f.verts:
                if v not in vmap:
                    vmap[v] = len(g.verts)
                    g.verts.append(v.co.copy())
                idx.append(vmap[v])
            g.faces.append(tuple(idx))
            g.fmat.append(ARCH_MATS[f.material_index])
            g.fsmooth.append(False)
        geos[name] = g
        log(f"architecture: {name}: {len(faces)} faces")
    log(f"architecture: dropped {dropped} pad-pocket faces")
    bm.free()
    return geos


# ── props + scenery ─────────────────────────────────────────────────────────────────────────────
def build_props(brushes, mdef, geos):
    def bucket(name):
        if name not in geos:
            geos[name] = C.Geo(name)
        return geos[name]

    water_z = mdef["waterY"]
    (bx0, _, bz0), (bx1, _, bz1) = mdef["bounds"]["min"], mdef["bounds"]["max"]
    spawns = mdef["spawns"]
    # crates
    n = 0
    for b in brushes:
        if b["kind"] != "crate":
            continue
        variant = C.seed_of(b["_base"]) % 3
        unit = D.crate_unit(variant)
        m = C.place_matrix(b["center"], b.get("yaw", 0.0), b["size"])
        bucket("paint_crate").extend(unit, m, group=True)
        n += 1
    log(f"props: {n} crates")
    # planters + palms
    for b in brushes:
        if b["kind"] != "planter":
            continue
        w, h, d = b["size"]
        pl = D.planter(w, h, d)
        m = C.place_matrix(b["center"], b.get("yaw", 0.0))
        bucket("paint_planter").extend(pl["shell"], m)
        bucket("solid_planter_soil").extend(pl["soil"], m)
        if b.get("palm"):
            p = D.palm(b["_base"], pl["soil_z"])
            bucket("solid_palm_trunks").extend(p["trunk"], m)
            bucket("deco_palm_fronds").extend(p["fronds"], m)
    # spawn pads
    for b in brushes:
        if b["kind"] != "spawnpad":
            continue
        team = b["team"]
        g = D.spawn_pad(team, b["radius"], PAD_POCKET + 0.02)
        bucket(f"solid_pad_{team}").extend(g, C.place_matrix(b["center"], spawns[team]["yaw"]))
    # team pennants flanking each base end, PENNANT_OUTSET outboard of the backwall ends, flags
    # streaming outboard (pennant() streams toward local +X: yaw 0 -> +x, yaw 180 -> -x)
    for b in brushes:
        if b["_base"] == "base_backwall":
            (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
            team = "A" if (z0 + z1) < 0 else "B"
            zc = (z0 + z1) / 2
            for tag, x, yaw in (("w", x0 - PENNANT_OUTSET, 180.0), ("e", x1 + PENNANT_OUTSET, 0.0)):
                pos = [x, ground_y(brushes, x, zc), zc]
                bucket("deco_flags").extend(D.pennant(team, f"{b['id']}_{tag}"), C.place_matrix(pos, yaw))
    for k, (kind, x, z) in enumerate(BUOYS.get(mdef["id"], [])):
        bucket("deco_buoys").extend(D.buoy(kind, f"{mdef['id']}_{k}"), C.place_matrix([x, water_z, z], 0.0))
    # deco assets
    lighthouse_pos = next((b["pos"] for b in brushes if b["kind"] == "deco" and b["asset"] == "lighthouse"), None)
    for b in brushes:
        if b["kind"] != "deco":
            continue
        a = b["asset"]
        pos, yaw = b["pos"], b.get("yaw", 0.0)
        m = C.place_matrix(pos, yaw, b.get("scale", 1.0))
        if a == "lamp":
            bucket("solid_lamps" if b.get("collide") else "deco_lamps").extend(D.lamp(), m)
        elif a == "bollard":
            bucket("solid_bollards" if b.get("collide") else "deco_bollards").extend(D.bollard(), m)
            if C.seed_of(b["_base"]) % 3 != 2:
                gx, gz = pos[0], pos[2]
                dists = [(gx - bx0, (-1, 0)), (bx1 - gx, (1, 0)), (gz - bz0, (0, -1)), (bz1 - gz, (0, 1))]
                _, (ox, oz) = min(dists, key=lambda t: t[0])
                out_b = C.g2b(ox, 0, oz)
                neck = C.g2b(pos[0], pos[1] + 0.47, pos[2])
                bucket("deco_ropes").extend(D.rope_coil_and_line(neck, out_b, water_z, b["id"]))
        elif a == "pilings":
            hx, hy = (bx1 - bx0) / 2, (bz1 - bz0) / 2
            bucket("deco_pilings").extend(D.pilings(hx, hy, plate_bottom(brushes), water_z),
                                          Matrix.Translation(C.g2b((bx0 + bx1) / 2, 0, (bz0 + bz1) / 2)))
        elif a == "billboard":
            key = "deco_board_" + ("cup" if "CUP" in b["text"] else "tide")
            bucket(key).extend(D.billboard(b["text"]), m)
        elif a == "banner":
            bucket("deco_banners").extend(D.banner(b["text"]), m)
        elif a == "lighthouse":
            bucket("deco_lighthouse").extend(D.lighthouse(b["id"]), m)
        elif a == "breakwater":
            pb = C.g2b(*pos)
            axis = Matrix.Rotation(math.radians(yaw), 3, "Z") @ Vector((1, 0, 0))
            pts = [pb - axis * 26.0, pb.copy()]
            if lighthouse_pos is not None:
                lb = C.g2b(*lighthouse_pos)
                pts.append(lb + (pb - lb).normalized() * 3.5)
            for p in pts:
                p.z = water_z
            bucket("deco_breakwater").extend(D.breakwater(pts, b["id"]))
        elif a == "cranes":
            bucket("deco_cranes").extend(D.cranes(b["id"]), m)
        elif a == "islands":
            bucket("deco_islands").extend(D.islands(b["id"]), m)
        elif a == "sailboat":
            bucket("deco_sailboats").extend(D.sailboat(b["id"]), m)
        else:
            raise ValueError(f"unknown deco asset {a!r} ({b['id']})")
    return geos


def pennant_clearance(geos, brushes, mdef, step: float = 2.0) -> dict:
    """QA: do the team pennant flags cover a billboard's lettering from the player's camera?

    Follow-camera poses (config.ts CAMERA: pivot 1.35 m, boom 4.3 m, 0.42 m right shoulder) are
    sampled over the walkable pier on a `step` grid, aimed at each billboard at four pitches
    (-24, -14, -6, +2 deg). Every flag vertex in front of the camera is projected onto the
    lettering's front plane; a sample counts when one lands inside the lettering box (+0.3 m).
    Uses the built geometry (M_sign_text faces of deco_board_*, M_pad_* faces of deco_flags)."""
    def verts_of(g, pred):
        idx = {i for f, m in zip(g.faces, g.fmat) if pred(m) for i in f}
        return [C.b2g(g.verts[i]) for i in sorted(idx)]
    flags = verts_of(geos["deco_flags"], lambda m: m.startswith("M_pad_")) if "deco_flags" in geos else []
    (bx0, _, bz0), (bx1, _, bz1) = next(b for b in brushes if b["id"] == "plate")["min"], \
        next(b for b in brushes if b["id"] == "plate")["max"]
    feet = []
    x = bx0 + step / 2
    while x < bx1:
        z = bz0 + step / 2
        while z < bz1:
            feet.append((x, ground_y(brushes, x, z), z))
            z += step
        x += step
    out = {}
    for key in sorted(k for k in geos if k.startswith("deco_board_")):
        let = verts_of(geos[key], lambda m: m == "M_sign_text")
        if not let:
            continue
        lx0, lx1 = min(v[0] for v in let), max(v[0] for v in let)
        ly0, ly1 = min(v[1] for v in let), max(v[1] for v in let)
        zs = [v[2] for v in let]
        zc = sum(zs) / len(zs)
        zf = min(zs) if zc > 0 else max(zs)            # the lettering's court-facing plane
        tx = (lx0 + lx1) / 2
        ty = (ly0 + ly1) / 2
        n = hit = 0
        worst = None
        for (fx, fy, fz) in feet:
            yaw = math.atan2(tx - fx, zc - fz)
            for pd in (-24.0, -14.0, -6.0, 2.0):
                p = math.radians(pd)
                d = (math.sin(yaw) * math.cos(p), math.sin(p), math.cos(yaw) * math.cos(p))
                rx, rz = -math.cos(yaw), math.sin(yaw)
                cx = fx + rx * 0.42 - d[0] * 4.3
                cy = max(fy + 0.3, fy + 1.35 - d[1] * 4.3)
                cz = fz + rz * 0.42 - d[2] * 4.3
                n += 1
                for (vx, vy, vz) in flags:
                    a, bpl = vz - cz, zf - cz
                    if abs(a) < 1e-6 or a * bpl <= 0 or abs(bpl) < abs(a):
                        continue                      # flag behind the camera or beyond the board
                    t = bpl / a
                    X, Y = cx + (vx - cx) * t, cy + (vy - cy) * t
                    if lx0 - 0.3 <= X <= lx1 + 0.3 and ly0 - 0.3 <= Y <= ly1 + 0.3:
                        hit += 1
                        worst = (round(cx, 1), round(cy, 1), round(cz, 1))
                        break
        out[key] = {"lettering_box": [round(lx0, 2), round(lx1, 2), round(ly0, 2), round(ly1, 2), round(zf, 2)],
                    "camera_samples": n, "flag_over_lettering": hit,
                    "pct": round(100.0 * hit / max(n, 1), 2), "example_camera": worst}
        log(f"pennant clearance {key}: flags over the lettering from {hit}/{n} camera samples "
            f"({out[key]['pct']}%)" + (f", e.g. camera at {worst}" if worst else ""))
        if out[key]["pct"] > 2.0:
            log(f"WARN pennant clearance {key}: {out[key]['pct']}% > 2% - move the pennants clear of the lettering")
    return out


# ── atlas ────────────────────────────────────────────────────────────────────────────────────────
def unwrap_atlas(paint_objs, margin_frac):
    """Smart-project (60 deg) every paint face, then average island scale across ALL objects.
    Faces tagged with a df_group (each crate instance) are projected in their own pass, so a
    rotated crate only sees its own projection axes and every side stays one island."""
    for ob in paint_objs:
        me = ob.data
        if "Atlas" not in me.uv_layers:
            me.uv_layers.new(name="Atlas")
        me.uv_layers.active = me.uv_layers["Atlas"]
    groups = {}
    for ob in paint_objs:
        at = ob.data.attributes.get("df_group")
        if at is not None:
            vals = [0] * len(ob.data.polygons)
            at.data.foreach_get("value", vals)
            groups[ob.name] = vals
    bpy.ops.object.select_all(action="DESELECT")
    for ob in paint_objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = paint_objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True

    def select(pred):
        for ob in paint_objs:
            bm = bmesh.from_edit_mesh(ob.data)
            bm.faces.ensure_lookup_table()
            g = groups.get(ob.name)
            for f in bm.faces:
                f.select_set(pred(ob.name, g[f.index] if g else -1))
            bmesh.update_edit_mesh(ob.data, loop_triangles=False, destructive=False)

    def smart():
        bpy.ops.uv.smart_project(angle_limit=math.radians(60.0), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)

    select(lambda name, grp: grp < 0)
    smart()
    all_groups = sorted({(n, v) for n, vals in groups.items() for v in vals if v >= 0})
    for (gname, gid) in all_groups:
        select(lambda name, grp, gname=gname, gid=gid: name == gname and grp == gid)
        smart()
    log(f"atlas: smart-projected {len(all_groups)} grouped instances separately")
    select(lambda name, grp: True)
    bpy.ops.uv.average_islands_scale(scale_uv=False, shear=False)
    bpy.ops.object.mode_set(mode="OBJECT")


def pack_atlas(paint_objs, margin_frac):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in paint_objs:
        ob.select_set(True)
        ob.data.uv_layers.active = ob.data.uv_layers["Atlas"]
    bpy.context.view_layer.objects.active = paint_objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, rotate_method="AXIS_ALIGNED", scale=True,
                            merge_overlap=False, margin_method="FRACTION", margin=margin_frac,
                            shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def save_uvs(paint_objs):
    import numpy as np
    out = []
    for ob in paint_objs:
        a = np.zeros(len(ob.data.loops) * 2, np.float32)
        ob.data.uv_layers["Atlas"].data.foreach_get("uv", a)
        out.append(a)
    return out


def load_uvs(paint_objs, saved):
    for ob, a in zip(paint_objs, saved):
        ob.data.uv_layers["Atlas"].data.foreach_set("uv", a)
        ob.data.update()


def blender_overlap_count(paint_objs) -> int:
    bpy.ops.object.select_all(action="DESELECT")
    for ob in paint_objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = paint_objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.context.scene.tool_settings.use_uv_select_sync = True
    bpy.ops.mesh.select_all(action="DESELECT")
    bpy.ops.uv.select_overlap(extend=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    n = sum(sum(1 for p in ob.data.polygons if p.select) for ob in paint_objs)
    for ob in paint_objs:
        for p in ob.data.polygons:
            p.select = False
    return n


def atlas_stats(paint_objs, S: int, margin_check_px: int = 3, png_path: str | None = None) -> dict:
    """Rasterise every paint triangle's Atlas footprint at S x S (texel centres), exactly like the
    runtime atlas builder, and measure overlaps / margins / density."""
    import numpy as np

    owner = np.full((S, S), -1, np.int32)
    strict = np.zeros((S, S), np.uint8)
    overlap = np.zeros((S, S), bool)
    isl_uv, isl_3d = [], []
    island_base = 0
    tris = 0
    area3d_total = 0.0
    uv_total = 0.0
    umin = vmin = 1e9
    umax = vmax = -1e9
    for ob in paint_objs:
        me = ob.data
        uvd = me.uv_layers["Atlas"].data
        nl = len(me.loops)
        uv = np.zeros(nl * 2, np.float64)
        uvd.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        lv = np.zeros(nl, np.int64)
        me.loops.foreach_get("vertex_index", lv)
        umin, umax = min(umin, uv[:, 0].min()), max(umax, uv[:, 0].max())
        vmin, vmax = min(vmin, uv[:, 1].min()), max(vmax, uv[:, 1].max())
        npoly = len(me.polygons)
        parent = list(range(npoly))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a

        edge_seen = {}
        for p in me.polygons:
            li = list(p.loop_indices)
            k = len(li)
            for i in range(k):
                l0, l1 = li[i], li[(i + 1) % k]
                va, vb = int(lv[l0]), int(lv[l1])
                ua, ub = uv[l0], uv[l1]
                if va > vb:
                    va, vb, ua, ub = vb, va, ub, ua
                key = (va, vb)
                prev = edge_seen.get(key)
                if prev is None:
                    edge_seen[key] = (p.index, ua, ub)
                else:
                    q, qa, qb = prev
                    if abs(qa[0] - ua[0]) < 1e-6 and abs(qa[1] - ua[1]) < 1e-6 and \
                            abs(qb[0] - ub[0]) < 1e-6 and abs(qb[1] - ub[1]) < 1e-6:
                        ra, rb = find(p.index), find(q)
                        if ra != rb:
                            parent[ra] = rb
        roots = {}
        pisl = [0] * npoly
        for i in range(npoly):
            r = find(i)
            if r not in roots:
                roots[r] = island_base + len(roots)
                isl_uv.append(0.0)
                isl_3d.append(0.0)
            pisl[i] = roots[r]
        island_base += len(roots)
        me.calc_loop_triangles()
        for lt in me.loop_triangles:
            tris += 1
            isl = pisl[lt.polygon_index]
            a3 = lt.area
            p = uv[list(lt.loops)] * S
            uva = 0.5 * abs((p[1, 0] - p[0, 0]) * (p[2, 1] - p[0, 1]) - (p[2, 0] - p[0, 0]) * (p[1, 1] - p[0, 1])) / (S * S)
            isl_uv[isl] += uva
            isl_3d[isl] += a3
            area3d_total += a3
            uv_total += uva
            x0 = max(int(math.floor(p[:, 0].min() - 0.5)), 0)
            x1 = min(int(math.ceil(p[:, 0].max() - 0.5)), S - 1)
            y0 = max(int(math.floor(p[:, 1].min() - 0.5)), 0)
            y1 = min(int(math.ceil(p[:, 1].max() - 0.5)), S - 1)
            if x1 < x0 or y1 < y0:
                continue
            xs = np.arange(x0, x1 + 1) + 0.5
            ys = np.arange(y0, y1 + 1) + 0.5
            X, Y = np.meshgrid(xs, ys)
            (ax, ay), (bx, by), (cx, cy) = p
            area2 = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay)
            if abs(area2) < 1e-12:
                continue
            sgn = 1.0 if area2 > 0 else -1.0
            w0 = sgn * ((bx - ax) * (Y - ay) - (by - ay) * (X - ax))
            w1 = sgn * ((cx - bx) * (Y - by) - (cy - by) * (X - bx))
            w2 = sgn * ((ax - cx) * (Y - cy) - (ay - cy) * (X - cx))
            inside = (w0 >= 0) & (w1 >= 0) & (w2 >= 0)
            if not inside.any():
                continue
            sub = owner[y0:y1 + 1, x0:x1 + 1]
            conflict = inside & (sub >= 0) & (sub != isl)
            if conflict.any():
                overlap[y0:y1 + 1, x0:x1 + 1] |= conflict
            sub[inside & (sub < 0)] = isl
            st = (w0 > 1e-7) & (w1 > 1e-7) & (w2 > 1e-7)
            strict[y0:y1 + 1, x0:x1 + 1] += st.astype(np.uint8)
    claimed = owner >= 0
    count = int(claimed.sum())
    folds = int((strict > 1).sum())
    # margin: any two different islands with texel centres within margin_check_px
    margin_bad = np.zeros((S, S), bool)
    r = margin_check_px
    for dy in range(0, r + 1):
        for dx in range(-r, r + 1):
            if (dy == 0 and dx <= 0) or dx * dx + dy * dy > r * r:
                continue
            if dx >= 0:
                ra, rb = (slice(0, S - dy), slice(0, S - dx)), (slice(dy, S), slice(dx, S))
            else:
                ra, rb = (slice(0, S - dy), slice(-dx, S)), (slice(dy, S), slice(0, S + dx))
            a, b = owner[ra], owner[rb]
            bad = (a >= 0) & (b >= 0) & (a != b)
            if bad.any():
                margin_bad[ra] |= bad
                margin_bad[rb] |= bad
    border = np.zeros((S, S), bool)
    border[:r, :] = border[-r:, :] = border[:, :r] = border[:, -r:] = True
    border_bad = int((claimed & border).sum())
    dens = []
    for ua, a3 in zip(isl_uv, isl_3d):
        if a3 > 1e-9:
            dens.append((math.sqrt(ua * S * S / a3), a3))
    mean = sum(d * a for d, a in dens) / max(1e-9, sum(a for _, a in dens))
    out15 = [(d, a) for d, a in dens if abs(d / mean - 1.0) > 0.15]
    stats = {
        "size": S, "tris": tris, "islands": len(isl_uv), "paint_area": area3d_total, "uv_fraction": uv_total,
        "texels_per_meter": math.sqrt(uv_total * S * S / area3d_total), "texels_claimed": count,
        "overlap_texels": int(overlap.sum()), "fold_texels": folds, "margin_violation_texels": int(margin_bad.sum()),
        "border_violation_texels": border_bad, "uv_min": [umin, vmin], "uv_max": [umax, vmax],
        "density_min": min(d for d, _ in dens), "density_max": max(d for d, _ in dens), "density_mean": mean,
        "islands_outside_15pct": len(out15), "area_outside_15pct": sum(a for _, a in out15),
    }
    if png_path:
        rgb = np.zeros((S, S, 4), np.float32)
        rgb[..., 3] = 1.0
        rgb[..., :3] = 0.08
        ids = owner[claimed].astype(np.int64)
        h = (ids * 2654435761) & 0xFFFFFFFF
        rgb[claimed, 0] = 0.25 + 0.75 * ((h & 255) / 255.0)
        rgb[claimed, 1] = 0.25 + 0.75 * (((h >> 8) & 255) / 255.0)
        rgb[claimed, 2] = 0.25 + 0.75 * (((h >> 16) & 255) / 255.0)
        rgb[overlap | margin_bad] = (1.0, 0.0, 1.0, 1.0)
        img = bpy.data.images.new("atlas_qa", S, S, alpha=False)
        img.pixels.foreach_set(rgb.reshape(-1))
        img.filepath_raw = png_path
        img.file_format = "PNG"
        img.save()
        bpy.data.images.remove(img)
    return stats


# ── export ───────────────────────────────────────────────────────────────────────────────────────
def export_glb(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_extras=True, export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_vertex_color="NONE", export_cameras=False, export_lights=False,
        export_animations=False, export_skins=False, export_attributes=False,
        export_draco_mesh_compression_enable=False, export_image_format="NONE")


# ── QA renders (after export; never exported) ──────────────────────────────────────────────────
def _sock(node, ident):
    return next(s for s in node.inputs if s.identifier == ident)


def _math(nt, op, a, b=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _mix(nt, fac, a, b):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = "MIX"
    for ident, v in (("Factor_Float", fac), ("A_Color", a), ("B_Color", b)):
        s = _sock(n, ident)
        if isinstance(v, (int, float)):
            s.default_value = v
        elif isinstance(v, tuple):
            s.default_value = (*v, 1.0) if len(v) == 3 else v
        else:
            nt.links.new(v, s)
    return next(o for o in n.outputs if o.identifier == "Result_Color")


def _uv(nt):
    n = nt.nodes.new("ShaderNodeUVMap")
    n.uv_map = "UVMap"
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(n.outputs["UV"], sep.inputs[0])
    u = sep.outputs["X"]
    v = _math(nt, "SUBTRACT", 1.0, sep.outputs["Y"])  # exported/"wanted" v (see common.uv_box_metres)
    return u, v


def _pos(nt):
    g = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(g.outputs["Position"], sep.inputs[0])
    return sep.outputs["X"], _math(nt, "MULTIPLY", sep.outputs["Y"], -1.0), sep.outputs["Z"]  # glTF x, z, y


def _edge_dist(nt, t, period):
    """distance (in metres) from t to the nearest multiple of period"""
    f = _math(nt, "FRACT", _math(nt, "DIVIDE", t, period))
    return _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", 0.5, _math(nt, "ABSOLUTE", _math(nt, "SUBTRACT", f, 0.5))), period)


def _white(nt, a, b, c=0.0):
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    for i, v in enumerate((a, b, c)):
        if isinstance(v, (int, float)):
            comb.inputs[i].default_value = v
        else:
            nt.links.new(v, comb.inputs[i])
    w = nt.nodes.new("ShaderNodeTexWhiteNoise")
    w.noise_dimensions = "3D"
    nt.links.new(comb.outputs[0], w.inputs["Vector"])
    return w.outputs["Value"]


def apply_preview_shading(mdef):
    lin = C.hex_to_linear
    for mat in bpy.data.materials:
        if not mat.name.startswith("M_"):
            continue
        nt = mat.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        base = tuple(bsdf.inputs["Base Color"].default_value)[:3]
        col = None
        if mat.name == "M_tile":
            u, v = _uv(nt)
            grout = _math(nt, "LESS_THAN", _math(nt, "MINIMUM", _edge_dist(nt, u, 1.0), _edge_dist(nt, v, 1.0)), 0.018)
            tint = _math(nt, "ADD", 0.95, _math(nt, "MULTIPLY", _white(nt, _math(nt, "FLOOR", u), _math(nt, "FLOOR", v)), 0.08))
            tile = _mix(nt, 0.0, base, base)
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            _sock(mul, "Factor_Float").default_value = 1.0
            nt.links.new(tile, _sock(mul, "A_Color"))
            comb = nt.nodes.new("ShaderNodeCombineColor")
            for i in range(3):
                nt.links.new(tint, comb.inputs[i])
            nt.links.new(comb.outputs[0], _sock(mul, "B_Color"))
            tiled = next(o for o in mul.outputs if o.identifier == "Result_Color")
            col = _mix(nt, grout, tiled, tuple(c * 0.6 for c in base))
            cl = mdef.get("courtLines")
            if cl:
                x, z, _y = _pos(nt)
                r = _math(nt, "SQRT", _math(nt, "ADD", _math(nt, "MULTIPLY", x, x), _math(nt, "MULTIPLY", z, z)))
                ring = _math(nt, "LESS_THAN", _math(nt, "ABSOLUTE", _math(nt, "SUBTRACT", r, cl["centerCircleRadius"])), cl["width"] / 2)
                mid = _math(nt, "LESS_THAN", _math(nt, "ABSOLUTE", _math(nt, "SUBTRACT", z, cl["midLineZ"])), cl["width"] / 2)
                line = _math(nt, "MAXIMUM", ring, mid)
                col = _mix(nt, line, col, lin(cl["color"]))
        elif mat.name == "M_chevron":
            u, v = _uv(nt)
            t = _math(nt, "FRACT", _math(nt, "DIVIDE", _math(nt, "ADD", u, _math(nt, "ABSOLUTE", _math(nt, "SUBTRACT", v, 0.55))), 0.9))
            col = _mix(nt, _math(nt, "LESS_THAN", t, 0.42), base, lin("#F6F4EC"))
        elif mat.name == "M_hazard":
            u, v = _uv(nt)
            t = _math(nt, "FRACT", _math(nt, "DIVIDE", _math(nt, "ADD", u, v), 0.5))
            col = _mix(nt, _math(nt, "LESS_THAN", t, 0.5), base, lin("#26262B"))
        elif mat.name == "M_boardwalk":
            u, v = _uv(nt)
            seam = _math(nt, "LESS_THAN", _edge_dist(nt, v, 0.24), 0.012)
            row = _math(nt, "FLOOR", _math(nt, "DIVIDE", v, 0.24))
            butt = _math(nt, "LESS_THAN", _edge_dist(nt, _math(nt, "ADD", u, _math(nt, "MULTIPLY", row, 0.83)), 2.6), 0.01)
            tint = _math(nt, "ADD", 0.9, _math(nt, "MULTIPLY", _white(nt, row, _math(nt, "FLOOR", _math(nt, "DIVIDE", _math(nt, "ADD", u, _math(nt, "MULTIPLY", row, 0.83)), 2.6))), 0.18))
            plank = _mix(nt, 0.0, base, base)
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            _sock(mul, "Factor_Float").default_value = 1.0
            nt.links.new(plank, _sock(mul, "A_Color"))
            comb = nt.nodes.new("ShaderNodeCombineColor")
            for i in range(3):
                nt.links.new(tint, comb.inputs[i])
            nt.links.new(comb.outputs[0], _sock(mul, "B_Color"))
            col = _mix(nt, _math(nt, "MAXIMUM", seam, butt), next(o for o in mul.outputs if o.identifier == "Result_Color"),
                       tuple(c * 0.45 for c in base))
        elif mat.name in ("M_concrete",):
            x, z, y = _pos(nt)
            nz = nt.nodes.new("ShaderNodeTexNoise")
            nz.inputs["Scale"].default_value = 2.5
            comb = nt.nodes.new("ShaderNodeCombineXYZ")
            nt.links.new(x, comb.inputs[0])
            nt.links.new(y, comb.inputs[1])
            nt.links.new(z, comb.inputs[2])
            nt.links.new(comb.outputs[0], nz.inputs["Vector"])
            col = _mix(nt, _math(nt, "MULTIPLY", nz.outputs["Fac"], 0.25), base, tuple(c * 0.86 for c in base))
        if col is not None:
            nt.links.new(col, bsdf.inputs["Base Color"])


def setup_render_world(mdef, samples):
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    ev = sc.eevee
    for attr, val in (("taa_render_samples", samples), ("use_shadows", True), ("use_raytracing", True),
                      ("shadow_ray_count", 2), ("shadow_step_count", 8), ("use_gtao", True), ("fast_gi_distance", 6.0)):
        if hasattr(ev, attr):
            try:
                setattr(ev, attr, val)
            except Exception:
                pass
    vs = sc.view_settings
    vs.view_transform = "AgX"
    vs.exposure = 0.1
    for want in ("AgX - Punchy", "Punchy", "AgX - Medium High Contrast", "Medium High Contrast"):
        try:
            vs.look = want
            break
        except TypeError:
            continue
    log(f"render grade: {vs.view_transform} / {vs.look}, exposure {vs.exposure}")
    preset = mdef["lighting"]["presets"][mdef["lighting"]["default"]]
    lin = C.hex_to_linear
    world = bpy.data.worlds.new("qa_world")
    sc.world = world
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs[0])
    t = _math(nt, "POWER", _math(nt, "MINIMUM", _math(nt, "DIVIDE", _math(nt, "MAXIMUM", sep.outputs["Z"], 0.0), 0.42), 1.0), 0.65)
    col = _mix(nt, t, lin(preset["skyHorizon"]), lin(preset["skyZenith"]))
    nt.links.new(col, bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    # sun
    el, az = math.radians(preset["sunElevationDeg"]), math.radians(preset["sunAzimuthDeg"])
    to_sun = C.g2b(math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el)).normalized()
    ld = bpy.data.lights.new("qa_sun", "SUN")
    ld.energy = 4.8
    ld.color = lin(preset["sunColor"])
    ld.angle = math.radians(1.2)
    sun = bpy.data.objects.new("qa_sun", ld)
    C.link(sun)
    sun.rotation_euler = to_sun.to_track_quat("Z", "Y").to_euler()
    # sea (render only)
    wm = bpy.data.materials.new("qa_water")
    wn = wm.node_tree
    wb = next(n for n in wn.nodes if n.type == "BSDF_PRINCIPLED")
    wb.inputs["Base Color"].default_value = (*lin(preset["waterDeep"]), 1.0)
    wb.inputs["Roughness"].default_value = 0.06
    nz = wn.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.35
    nz.inputs["Detail"].default_value = 4.0
    bump = wn.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.12
    nt2 = wn
    nt2.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt2.links.new(bump.outputs["Normal"], wb.inputs["Normal"])
    # shallow tint near the pier
    geo = wn.nodes.new("ShaderNodeNewGeometry")
    sep2 = wn.nodes.new("ShaderNodeSeparateXYZ")
    wn.links.new(geo.outputs["Position"], sep2.inputs[0])
    dx = _math(wn, "MAXIMUM", _math(wn, "SUBTRACT", _math(wn, "ABSOLUTE", sep2.outputs["X"]), 28.0), 0.0)
    dy = _math(wn, "MAXIMUM", _math(wn, "SUBTRACT", _math(wn, "ABSOLUTE", sep2.outputs["Y"]), 42.0), 0.0)
    d = _math(wn, "SQRT", _math(wn, "ADD", _math(wn, "MULTIPLY", dx, dx), _math(wn, "MULTIPLY", dy, dy)))
    f = _math(wn, "EXPONENT", _math(wn, "MULTIPLY", d, -0.09))
    wcol = _mix(wn, f, lin(preset["waterDeep"]), lin(preset["waterShallow"]))
    wn.links.new(wcol, wb.inputs["Base Color"])
    me = bpy.data.meshes.new("qa_sea")
    R = 3000.0
    me.from_pydata([(-R, -R, 0), (R, -R, 0), (R, R, 0), (-R, R, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(wm)
    sea = bpy.data.objects.new("qa_sea", me)
    sea.location.z = mdef["waterY"]
    C.link(sea)
    # distance haze
    sc.render.film_transparent = False
    return sun


def render_views(mdef, out_top, out_persp, out_aerial, out_props=None, quick=False):
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    # top (orthographic): SUNCREW (-Z) at the bottom, screen-right = -X (the minimap orientation)
    cd = bpy.data.cameras.new("qa_top")
    cd.type = "ORTHO"
    cd.ortho_scale = 118.0
    cd.clip_end = 1000.0
    cam = bpy.data.objects.new("qa_top", cd)
    C.link(cam)
    cam.location = (0.0, 0.0, 300.0)
    cam.rotation_euler = (0.0, 0.0, math.pi)
    sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = 800 if quick else 1600
    sc.render.filepath = out_top
    log("render: top ->", out_top)
    bpy.ops.render.render(write_still=True)
    # player's-eye from the SUNCREW base, looking +Z
    sa = mdef["spawns"]["A"]["pos"]
    cd2 = bpy.data.cameras.new("qa_persp")
    cd2.sensor_fit = "VERTICAL"
    cd2.angle_y = math.radians(56.0)
    cd2.clip_start = 0.1
    cd2.clip_end = 3000.0
    cam2 = bpy.data.objects.new("qa_persp", cd2)
    C.link(cam2)
    eye = C.g2b(sa[0] + 1.2, sa[1] + 1.6, sa[2] + 3.0)
    look = C.g2b(0.0, 0.2, 4.0)
    cam2.location = eye
    cam2.rotation_euler = (look - eye).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam2
    sc.render.resolution_x, sc.render.resolution_y = (800, 450) if quick else (1600, 900)
    sc.render.filepath = out_persp
    log("render: persp ->", out_persp)
    bpy.ops.render.render(write_still=True)
    # 3/4 aerial (lobby-style)
    cam3 = bpy.data.objects.new("qa_aerial", cd2.copy())
    C.link(cam3)
    eye3 = C.g2b(98.0, 34.0, -66.0)
    look3 = C.g2b(4.0, -2.0, 4.0)
    cam3.location = eye3
    cam3.rotation_euler = (look3 - eye3).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam3
    sc.render.filepath = out_aerial
    log("render: aerial ->", out_aerial)
    bpy.ops.render.render(write_still=True)
    if out_props:
        # prop close-up at the SUNCREW west corner: crate stack, palm planter, curb + bollards
        cd4 = bpy.data.cameras.new("qa_props")
        cd4.sensor_fit = "VERTICAL"
        cd4.angle_y = math.radians(46.0)
        cd4.clip_start = 0.05
        cd4.clip_end = 3000.0
        cam4 = bpy.data.objects.new("qa_props", cd4)
        C.link(cam4)
        eye4 = C.g2b(-13.8, 2.3, -22.6)
        look4 = C.g2b(-20.2, 0.9, -29.0)
        cam4.location = eye4
        cam4.rotation_euler = (look4 - eye4).to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam4
        sc.render.filepath = out_props
        log("render: props ->", out_props)
        bpy.ops.render.render(write_still=True)


# ── main ─────────────────────────────────────────────────────────────────────────────────────────
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--quick-render", action="store_true")
    ap.add_argument("--samples", type=int, default=64)
    args = ap.parse_args(argv)

    C.reset_scene()
    maps = C.load_json("maps.json")
    teams = C.load_json("teams.json")
    mdef = next((m for m in maps["maps"] if m["id"] == args.map), None)
    if mdef is None:
        raise SystemExit(f"map {args.map!r} not in data/maps.json")
    if mdef.get("status") != "built" or not mdef.get("brushes"):
        raise SystemExit(f"map {args.map!r} has no brushes (status {mdef.get('status')!r})")
    team_hex = {f"M_pad_{t['side']}": t["dye"] for t in teams["teams"]}
    for k, v in team_hex.items():
        C.get_material(k, v)

    brushes, notes = expand_brushes(mdef)
    for n in notes:
        log(n)
    for w in validate_brushes(brushes):
        log("WARN", w)
    log(f"{len(brushes)} brushes after mirror ({mdef['symmetry']})")

    geos = build_architecture(brushes, mdef)
    geos = build_props(brushes, mdef, geos)
    clearance = pennant_clearance(geos, brushes, mdef)

    coll = C.new_collection("map_" + mdef["id"])
    objs = {}
    for name in sorted(geos, key=lambda n: (["paint_", "solid_", "col_", "deco_", "water_"].index(n[:n.index("_") + 1]), n)):
        g = geos[name]
        if g.empty():
            continue
        ob = g.to_object(coll, team_hex=team_hex)
        C.uv_box_metres(ob.data, "UVMap")
        objs[name] = ob
    paint_objs = [o for n, o in objs.items() if n.startswith("paint_")]
    log("objects:", ", ".join(f"{n}({len(o.data.polygons)}f)" for n, o in objs.items()))

    # ── atlas ────────────────────────────────────────────────────────────────────────────────
    paint_cfg = mdef.get("paint", {"texelsPerMeter": 10, "atlasMax": 2048})
    target, amax = paint_cfg["texelsPerMeter"], paint_cfg["atlasMax"]
    unwrap_atlas(paint_objs, 0.0)
    unwrapped = save_uvs(paint_objs)
    paint_area = sum(p.area for o in paint_objs for p in o.data.polygons)
    chosen = None
    margin_px = 4
    for S in (512, 1024, 2048):
        if S > amax:
            break
        # even an 80 %-full atlas at this size could not reach 80 % of the target: skip it
        if math.sqrt(0.8 * S * S / paint_area) < 0.8 * target and S * 2 <= amax:
            log(f"atlas {S}: skipped (max possible ~{math.sqrt(0.8 * S * S / paint_area):.2f} texels/m)")
            continue
        load_uvs(paint_objs, unwrapped)        # every size packs from the same unwrap (no path dependence)
        best = None
        # a coarse pre-pack (double margin) gives the final pack a better starting layout; every
        # pass is deterministic and the best clean one is kept (all margins are >= margin_px)
        for it, mpx in enumerate((2 * margin_px, margin_px, margin_px)):
            pack_atlas(paint_objs, mpx / S)
            st = atlas_stats(paint_objs, S, 3)
            log(f"atlas {S} pass {it + 1} (margin {mpx}px): {st['texels_per_meter']:.3f} texels/m, "
                f"islands {st['islands']}, overlap {st['overlap_texels']}, margin-violations {st['margin_violation_texels']}")
            ok = st["overlap_texels"] == 0 and st["margin_violation_texels"] == 0 and st["border_violation_texels"] == 0
            if ok and (best is None or st["texels_per_meter"] > best[0]["texels_per_meter"] + 1e-6):
                best = (st, save_uvs(paint_objs), mpx)
        if best is None:
            raise RuntimeError(f"atlas {S}: no clean packing (overlaps / margin violations)")
        load_uvs(paint_objs, best[1])
        st = best[0]
        margin_used = best[2]
        log(f"atlas {S}: {st['texels_per_meter']:.3f} texels/m (target {target}, need >= {0.8 * target:.1f})")
        chosen = (S, st)
        if st["texels_per_meter"] >= 0.8 * target:
            break
    S, st = chosen
    png = os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_atlas.png")
    st = atlas_stats(paint_objs, S, 3, png_path=png)
    st["blender_select_overlap_faces"] = blender_overlap_count(paint_objs)
    log("atlas stats:", json.dumps(st))
    for ob in paint_objs:
        ob.data.uv_layers.active_index = 0
        ob.data.uv_layers["UVMap"].active_render = True

    # ── empties ──────────────────────────────────────────────────────────────────────────────
    info = bpy.data.objects.new("mapinfo", None)
    C.link(info, coll)
    info["df_map_id"] = mdef["id"]
    info["df_atlas_size"] = int(S)
    info["df_texels_per_meter"] = round(float(st["texels_per_meter"]), 4)
    info["df_paint_area"] = round(float(st["paint_area"]), 3)
    info["df_version"] = DF_VERSION
    info["df_atlas_islands"] = int(st["islands"])
    info["df_atlas_margin_px"] = int(margin_used)
    info["df_atlas_overlap_texels"] = int(st["overlap_texels"])
    info["df_paint_tris"] = int(st["tris"])
    info["df_plate_bottom"] = plate_bottom(brushes)
    for side in ("A", "B"):
        sp = mdef["spawns"][side]
        e = bpy.data.objects.new(f"spawn_{side}", None)
        e.empty_display_type = "SINGLE_ARROW"
        e.location = C.g2b(*sp["pos"])
        e.rotation_euler = (0.0, 0.0, math.radians(sp["yaw"]))
        C.link(e, coll)

    # ── export ───────────────────────────────────────────────────────────────────────────────
    os.makedirs(C.GLTF_DIR, exist_ok=True)
    os.makedirs(C.RENDER_DIR, exist_ok=True)
    out = os.path.join(C.GLTF_DIR, f"map_{mdef['id']}.glb")
    export_objs = list(objs.values()) + [info] + [o for o in coll.objects if o.name.startswith("spawn_")]
    export_glb(export_objs, out)
    tri_total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs.values())
    tri_paint = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in paint_objs)
    summary = {
        "map": mdef["id"], "glb": out, "glb_mb": round(os.path.getsize(out) / 1e6, 3),
        "tris_total": tri_total, "tris_paint": tri_paint, "objects": sorted(objs),
        "atlas": st, "fixups": notes, "version": DF_VERSION,
        "plate_bottom": plate_bottom(brushes), "pennant_clearance": clearance,
    }
    with open(os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_stats.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    log(f"exported {out} ({summary['glb_mb']} MB, {tri_total} tris, {tri_paint} paint tris)")

    if not args.no_render:
        apply_preview_shading(mdef)
        setup_render_world(mdef, 16 if args.quick_render else args.samples)
        render_views(mdef,
                     os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_top.png"),
                     os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_persp.png"),
                     os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_aerial.png"),
                     os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_props.png"), quick=args.quick_render)
    log("done")


if __name__ == "__main__":
    main()
