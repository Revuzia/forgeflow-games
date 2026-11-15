"""DYEFIELD — PIER 18 PLAZA builder module (CONTRACT §3.1; CONTRACT_ART_P6_8 §14.1).

Called by the shared pipeline (build_map.py) as build(mdef, layout, ctx). Layout = the legacy
inline 'brushes' of data/maps.json. Everything Pier-18-specific lives here:
  - the pier slab ('plate' brush): top = court tile, sides = concrete; its underside (min.y) is the
    slab bottom, the pilings carry it down to the sea; the slab's outer faces + all bottoms become
    solid_pier_skirt (not paintable); the court floor is cut on a 4 m grid,
  - hazard nosing on the deck ledges (NOSING), spawn-pad pockets, 0.045 m bevel on convex edges,
  - team pennants flanking each base end (with a camera-occlusion QA against the billboard
    lettering), channel buoys, pilings under the slab, the breakwater that runs to the lighthouse,
  - the extra 'props' QA camera station (crate stack, palm planter, curb + bollards).
Generic brush kinds (crate, planter, spawnpad, deco) use the shared ctx builders.
"""
from __future__ import annotations

import math

from mathutils import Matrix, Vector

import common as C
import deco_assets as D

ARCH_MATS = ["M_tile", "M_concrete", "M_boardwalk", "M_chevron", "M_hazard"]
ARCH_BEVEL = 0.045
PAD_POCKET = 0.3
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
# Floating channel buoys around the pier (deco only, in the out-of-bounds water; glTF x, z).
BUOYS = [("red", -39.0, -24.0), ("red", 40.0, 30.0), ("yellow", -41.0, 22.0),
         ("yellow", 45.0, -47.0), ("red", -22.0, 61.0), ("red", 20.0, -62.0)]
# Geometry fix-ups applied to brushes BEFORE mirroring (each logged with the recommended maps.json
# change). (crate_a3 was fixed here once; the integrator moved that fix into data/maps.json.)
FIXUPS: dict = {}
# The pier slab: every other solid stands in it (exempt from the pipeline's AABB overlap warnings).
OVERLAP_OK = {"plate"}


def plate_bottom(brushes: list[dict]) -> float:
    """Pier slab underside = the plate brush's min.y (data/maps.json is the single truth)."""
    plate = next(b for b in brushes if b["id"] == "plate")
    y0, y1 = float(plate["min"][1]), float(plate["max"][1])
    if not y0 < y1:
        raise ValueError(f"plate brush min.y {y0} must be below its top {y1} (it is the slab underside)")
    return y0


# ── architecture ─────────────────────────────────────────────────────────────────────────────────
def build_architecture(ctx):
    brushes = ctx.brushes
    arch = ctx.arch(ARCH_MATS)
    plate = ctx.brush("plate")
    ctx.log("architecture: building solids")
    ctx.log(f"architecture: pier slab underside y = {plate_bottom(brushes)} (plate brush min.y, data/maps.json)")
    base_bm = arch.box_bm(plate, top="tile", side="concrete")
    ops = []
    for b in brushes:
        if b["id"] == "plate":
            continue
        if b["kind"] in ("box", "curb"):
            bms = arch.nosed_box_bms(b, NOSING.get(b["_base"]), NOSING_W)
        elif b["kind"] == "ramp":
            bms = [arch.ramp_bm(b)]
        else:
            continue
        ops += [(f"_op_{b['id']}_{k}", bm) for k, bm in enumerate(bms)]
    pads = ctx.brushes_of("spawnpad")
    bm = arch.union(base_bm, ops, arch.pad_pockets(pads, PAD_POCKET))
    arch.bevel_convex(bm, ARCH_BEVEL, angle=30.0, segments=2, profile=0.5)
    (px0, _, pz0), (px1, _, pz1) = plate["min"], plate["max"]
    arch.grid_cut(bm, "tile", px0, px1, pz0, pz1, GRID)

    def classify(f):
        gx, gy, gz = C.b2g(f.calc_center_median())
        for b in pads:                      # pad pocket interior (hidden under the pad)
            pc = b["center"]
            if math.hypot(gx - pc[0], gz - pc[2]) < b["radius"] + 0.06 and gy < pc[1] - ARCH_BEVEL - 0.005:
                return None
        nx, ny, nz = C.b2g(f.normal)
        on_edge = (abs(gx - px0) < 0.02 and nx < -0.85) or (abs(gx - px1) < 0.02 and nx > 0.85) or \
                  (abs(gz - pz0) < 0.02 and nz < -0.85) or (abs(gz - pz1) < 0.02 and nz > 0.85)
        if ny < -0.5 or on_edge:
            return "solid_pier_skirt"
        return "paint_" + ARCH_MATS[f.material_index][2:]
    ctx.geos.update(arch.to_geos(bm, classify))
    bm.free()


# ── props + scenery ──────────────────────────────────────────────────────────────────────────────
def build_pennants(ctx):
    """Team pennants PENNANT_OUTSET outboard of each base backwall end, flags streaming outboard
    (pennant() streams toward local +X: yaw 0 -> +x, yaw 180 -> -x)."""
    for b in ctx.brushes:
        if b["_base"] == "base_backwall":
            (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
            team = "A" if (z0 + z1) < 0 else "B"
            zc = (z0 + z1) / 2
            for tag, x, yaw in (("w", x0 - PENNANT_OUTSET, 180.0), ("e", x1 + PENNANT_OUTSET, 0.0)):
                pos = [x, ctx.ground_y(x, zc), zc]
                ctx.bucket("deco_flags").extend(D.pennant(team, f"{b['id']}_{tag}"), C.place_matrix(pos, yaw))


def build_buoys(ctx):
    for k, (kind, x, z) in enumerate(BUOYS):
        ctx.bucket("deco_buoys").extend(D.buoy(kind, f"{ctx.map_id}_{k}"),
                                        C.place_matrix([x, ctx.mdef["waterY"], z], 0.0))


def _deco_pilings(ctx, b, m):
    """Pilings under the whole slab, from the slab underside down into the water."""
    (bx0, _, bz0), (bx1, _, bz1) = ctx.mdef["bounds"]["min"], ctx.mdef["bounds"]["max"]
    hx, hy = (bx1 - bx0) / 2, (bz1 - bz0) / 2
    ctx.bucket("deco_pilings").extend(D.pilings(hx, hy, plate_bottom(ctx.brushes), ctx.mdef["waterY"]),
                                      Matrix.Translation(C.g2b((bx0 + bx1) / 2, 0, (bz0 + bz1) / 2)))


def _deco_breakwater(ctx, b, m):
    """A rubble breakwater 26 m along its yaw axis, bending to end 3.5 m short of the lighthouse."""
    pos, yaw = b["pos"], b.get("yaw", 0.0)
    water_z = ctx.mdef["waterY"]
    lighthouse_pos = next((x["pos"] for x in ctx.brushes if x["kind"] == "deco" and x["asset"] == "lighthouse"), None)
    pb = C.g2b(*pos)
    axis = Matrix.Rotation(math.radians(yaw), 3, "Z") @ Vector((1, 0, 0))
    pts = [pb - axis * 26.0, pb.copy()]
    if lighthouse_pos is not None:
        lb = C.g2b(*lighthouse_pos)
        pts.append(lb + (pb - lb).normalized() * 3.5)
    for p in pts:
        p.z = water_z
    ctx.bucket("deco_breakwater").extend(D.breakwater(pts, b["id"]))


def pennant_clearance(ctx, step: float = 2.0) -> dict:
    """QA: do the team pennant flags cover a billboard's lettering from the player's camera?

    Follow-camera poses (config.ts CAMERA: pivot 1.35 m, boom 4.3 m, 0.42 m right shoulder) are
    sampled over the walkable pier on a `step` grid, aimed at each billboard at four pitches
    (-24, -14, -6, +2 deg). Every flag vertex in front of the camera is projected onto the
    lettering's front plane; a sample counts when one lands inside the lettering box (+0.3 m).
    Uses the built geometry (M_sign_text faces of deco_board_*, M_pad_* faces of deco_flags)."""
    geos = ctx.geos

    def verts_of(g, pred):
        idx = {i for f, m in zip(g.faces, g.fmat) if pred(m) for i in f}
        return [C.b2g(g.verts[i]) for i in sorted(idx)]
    flags = verts_of(geos["deco_flags"], lambda m: m.startswith("M_pad_")) if "deco_flags" in geos else []
    plate = ctx.brush("plate")
    (bx0, _, bz0), (bx1, _, bz1) = plate["min"], plate["max"]
    feet = []
    x = bx0 + step / 2
    while x < bx1:
        z = bz0 + step / 2
        while z < bz1:
            feet.append((x, ctx.ground_y(x, z), z))
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
        ctx.log(f"pennant clearance {key}: flags over the lettering from {hit}/{n} camera samples "
                f"({out[key]['pct']}%)" + (f", e.g. camera at {worst}" if worst else ""))
        if out[key]["pct"] > 2.0:
            ctx.log(f"WARN pennant clearance {key}: {out[key]['pct']}% > 2% - move the pennants clear of the lettering")
    return out


# ── entry point ──────────────────────────────────────────────────────────────────────────────────
def build(mdef: dict, layout: dict, ctx) -> None:
    ctx.register_deco("pilings", _deco_pilings)
    ctx.register_deco("breakwater", _deco_breakwater)
    build_architecture(ctx)
    ctx.build_crates()
    ctx.build_planters()
    ctx.build_spawnpads(depth=PAD_POCKET + 0.02)
    build_pennants(ctx)
    build_buoys(ctx)
    ctx.build_deco()
    clearance = pennant_clearance(ctx)
    pb = plate_bottom(ctx.brushes)
    ctx.info["df_plate_bottom"] = pb
    ctx.summary["plate_bottom"] = pb
    ctx.summary["pennant_clearance"] = clearance
    # prop close-up at the SUNCREW west corner: crate stack, palm planter, curb + bollards
    ctx.add_camera("props", eye=(-13.8, 2.3, -22.6), look=(-20.2, 0.9, -29.0), fov=46.0, clip_start=0.05)
