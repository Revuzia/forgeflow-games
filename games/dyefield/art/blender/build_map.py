"""DYEFIELD — the SHARED map pipeline (CONTRACT §3.1, CONTRACT_ART_P6_8 §14.1–§14.3).

    python art/build.py map <id> [flags]      (= blender --background --factory-startup
                                                  --python art/blender/build_map.py -- --map <id> [flags])
    flags:  --layout <path>   build from this layout file (a map lane's data/layouts/<id>.json before
                              the orchestrator merged maps.json; its "meta" block OVERRIDES maps.json)
            --no-render  --quick-render  --samples N      (EEVEE QA renders)
            --no-ao  --ao-samples N  --ao-distance M     (§14.3 AO bake; default 64 samples, 2.0 m)
            --out-dir <dir>   write GLB / AO / stats / renders there (experiments; nothing committed)

Nothing map-specific lives here. Per map, `art/blender/map_<id>.py` exposes
`build(mdef, layout, ctx) -> None` and authors the geometry through `ctx` (the helper API is
MapCtx below; how to write a module: art/blender/MAPS_README.md). Pipeline (deterministic,
idempotent — every run starts from an empty factory scene):
  1. load data/maps.json -> mdef and the map's layout: inline 'brushes' (legacy, pier18), or
     data/<maps.json 'layout'> ("layouts/<id>.json"), or --layout <path>; the layout's "meta"
     block fills (or with --layout overrides) the runtime metadata (spawns, bounds, lighting...),
  2. expand the brushes (module FIXUPS, then the symmetry mirror rule), warn on AABB overlaps,
  3. import map_<id> and call build(mdef, layout, ctx): geometry goes into ctx.geos buckets
     (common.Geo, world space) or ctx.add_object(); empties / lights / extras / cameras via ctx,
  4. realise every bucket as ONE object, ordered by prefix (paint_, solid_, grate_, conveyor_,
     spring_, col_, oob_, deco_, water_) then name; module objects get their transforms applied
     (§3.1 / §14.2); §14.2 extras attached and validated; UVMap (UV0) = metres box projection,
  5. ATLAS (UV2 'Atlas') over ALL paint_* objects: smart project 60 deg (each df_group instance in
     its own pass) -> average island scale -> pack (pre-pack at 2x margin, two final passes, best
     clean result kept); atlas size = the smallest reaching >= 80 % of paint.texelsPerMeter;
     verification with our own texel-centre rasteriser (overlaps, margins < 3 px, border, density)
     plus bpy.ops.uv.select_overlap as a second opinion,
  6. AO BAKE (§14.3): Cycles (GPU via OptiX/CUDA when present, else CPU, <= 64 samples) bakes
     ambient occlusion of every paint_* surface into Atlas space -> art/gltf/map_<id>_ao.png
     (8-bit grey, atlas-sized up to 1024 else half, dilated into the gutters), mapinfo df_ao,
  7. empties (mapinfo + df_* extras, spawn_A/B, module empties), GLB export (Y-up, extras),
     art/renders/map_<id>_stats.json,
  8. EEVEE QA renders (after export, render-only preview shading that mirrors the runtime LOOK
     shaders) at the camera stations: top, persp (SUNCREW spawn), aerial + module stations.
"""
from __future__ import annotations

import argparse
import importlib
import json
import math
import os
import sys
import time
from types import SimpleNamespace

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common as C  # noqa: E402
import deco_assets as D  # noqa: E402

DF_VERSION = 1
# Export / realisation order of node prefixes (CONTRACT §3.1 + CONTRACT_ART_P6_8 §14.2).
PREFIX_ORDER = ["paint_", "solid_", "grate_", "conveyor_", "spring_", "col_", "oob_", "deco_", "water_"]
# Prefixes whose nodes must carry identity transforms (vertices in world space).
APPLY_PREFIXES = ("paint_", "solid_", "col_", "grate_", "conveyor_", "spring_", "oob_")
# Prefixes never drawn in the QA renders (runtime-invisible volumes).
HIDDEN_PREFIXES = ("col_", "oob_")
# Brush kinds that are solid volumes (AABB overlap validation).
SOLID_KINDS = ("box", "ramp", "stairs", "curb", "crate", "planter")
# Brush vector fields that the mirror rule rotates with the map (glTF [x, y, z]).
MIRROR_VECTOR_KEYS = ("vel", "launch", "conveyor", "dir", "target", "land")

T0 = time.time()


def log(*a):
    print(f"[map {time.time() - T0:6.1f}s]", *a, flush=True)


# ── brushes ──────────────────────────────────────────────────────────────────────────────────────
def mirror_brush(b: dict, symmetry: str) -> dict:
    """The symmetry partner of a brush. rot180: (x, y, z) -> (-x, y, -z), yaw + 180, team A<->B."""
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
    for key in MIRROR_VECTOR_KEYS:
        v = b.get(key)
        if isinstance(v, list) and len(v) == 3 and all(isinstance(c, (int, float)) for c in v):
            m[key] = [-v[0], v[1], -v[2]]
    if isinstance(b.get("points"), list):
        m["points"] = [[-p[0], p[1], -p[2]] for p in b["points"]]
    if b["kind"] in ("crate", "planter", "deco") or "yaw" in b:
        m["yaw"] = (b.get("yaw", 0.0) + 180.0)
    if "team" in b:
        m["team"] = "B" if b["team"] == "A" else "A"
    return m


def expand_brushes(mdef: dict, brushes_in: list[dict], fixups: dict) -> tuple[list[dict], list[str]]:
    """Apply the module's FIXUPS (logged) then the mirror rule. Every brush gets `_base` = the id it
    was authored under (a mirrored copy has id '<id>_m' and _base '<id>')."""
    notes = []
    out = []
    for b in brushes_in:
        b = dict(b)
        b["_base"] = b["id"]
        if b["id"] in fixups:
            f = fixups[b["id"]]
            for k, v in f.items():
                if k != "why":
                    notes.append(f"FIXUP {b['id']}.{k}: {b.get(k)} -> {v}  ({f['why']})")
                    b[k] = v
        out.append(b)
        if b.get("mirror"):
            out.append(mirror_brush(b, mdef["symmetry"]))
    ids = [b["id"] for b in out]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        raise ValueError(f"duplicate brush ids after mirroring: {dup}")
    return out, notes


def ground_y(brushes: list[dict], x: float, z: float) -> float:
    """Top of the highest axis-aligned box/curb brush over (x, z); ramps/stairs ignored; 0 if none."""
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


def overlap_exempt(b: dict, overlap_ok=()) -> bool:
    """A slab/floor other solids stand in: "overlapOk": true on the brush, or its authored id listed
    in the module's OVERLAP_OK."""
    return bool(b.get("overlapOk")) or b.get("_base", b["id"]) in overlap_ok


def validate_brushes(brushes: list[dict], overlap_ok=()) -> list[str]:
    """Positive-volume AABB overlaps between solid brushes (touching is fine); overlap_exempt()
    brushes are skipped."""
    warn = []
    solids = [b for b in brushes if b["kind"] in SOLID_KINDS and not overlap_exempt(b, overlap_ok)
              and aabb_of(b) is not None]
    eps = 1e-3
    for i in range(len(solids)):
        a0, a1 = aabb_of(solids[i])
        for j in range(i + 1, len(solids)):
            b0, b1 = aabb_of(solids[j])
            ov = [min(a1[k], b1[k]) - max(a0[k], b0[k]) for k in range(3)]
            if all(o > eps for o in ov):
                warn.append(f"overlap {solids[i]['id']} x {solids[j]['id']}: {', '.join(f'{o:.3f}' for o in ov)} m")
    return warn


# ── architecture helpers (ctx.arch) ─────────────────────────────────────────────────────────────
_FLIP = {"+x": "-x", "-x": "+x", "+z": "-z", "-z": "+z"}


class Arch:
    """Bevelled-solid architecture kit bound to one material list (bmesh material_index = position
    in `mats`). Brush materials are short names ('concrete' -> 'M_concrete'). Typical use:

        arch = ctx.arch(["M_concrete", "M_hazard", ...])
        ops = [(f"_op_{b['id']}", arch.box_bm(b)) for b in ctx.brushes_of("box")]
        bm = arch.union(arch.box_bm(floor), ops, arch.pad_pockets(ctx.brushes_of("spawnpad")))
        arch.bevel_convex(bm, 0.045)
        ctx.geos.update(arch.to_geos(bm, arch.default_classify()))
    """

    def __init__(self, ctx, mats, default="concrete", lip="hazard"):
        self.ctx = ctx
        self.mats = list(mats)
        self.default = default
        self.lip = lip

    def idx(self, short: str) -> int:
        name = short if short.startswith("M_") else "M_" + short
        if name not in self.mats:
            raise KeyError(f"material {name} is not in this Arch's list {self.mats}")
        return self.mats.index(name)

    # solids (all return a fresh bmesh in Blender space) ───────────────────────────────────────
    def box_bm(self, b, top: str | None = None, side: str | None = None):
        """Axis-aligned box brush (min/max). top/side override the material of up-facing / other
        faces (e.g. a slab whose top is tile and whose sides are concrete)."""
        mn, mx = b["min"], b["max"]
        bm = bmesh.new()
        faces = C.bm_box(bm, (mn[0], -mx[2], mn[1]), (mx[0], -mn[2], mx[1]), self.idx(b.get("mat", self.default)))
        bm.normal_update()
        if top or side:
            for f in faces:
                if f.normal.z > 0.5:
                    if top:
                        f.material_index = self.idx(top)
                elif side:
                    f.material_index = self.idx(side)
        return bm

    def nosed_box_bms(self, b, dirs, width: float = 0.35, nose: str = "hazard"):
        """Split a deck box into a core + nosing strips (top faces in `nose` material) along the
        ledge edges `dirs` (subset of '+x', '-x', '+z', '-z', in the AUTHORED brush's frame — a
        mirrored copy flips them)."""
        if not dirs:
            return [self.box_bm(b)]
        if b["id"] != b.get("_base", b["id"]):
            dirs = tuple(_FLIP[d] for d in dirs)
        (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
        cx0, cx1, cz0, cz1 = x0, x1, z0, z1
        strips = []
        w = width
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
        out = [self.box_bm(dict(b, min=[cx0, y0, cz0], max=[cx1, y1, cz1]))]
        for (mn, mx) in strips:
            bm = self.box_bm(dict(b, min=mn, max=mx))
            for f in bm.faces:
                if f.normal.z > 0.5:
                    f.material_index = self.idx(nose)
            out.append(bm)
        return out

    def _run_frame(self, b):
        """(across range, lo_r, hi_r, P(a, r, y) -> Blender Vector) for a brush with 'rise'."""
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
        return across, lo_r, hi_r, P

    def ramp_bm(self, b):
        """Solid wedge inside min/max rising toward 'rise'; the low edge gets a lip strip in
        b.get('lip', <Arch lip>) material (hazard on Pier 18)."""
        (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
        across, lo_r, hi_r, P = self._run_frame(b)
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
        mi = self.idx(b.get("mat", self.default))
        li = self.idx(b.get("lip", self.lip)) if b.get("lip", self.lip) else mi
        for vs, m in (((A0, A1, L1, L0), li), ((L0, L1, T1_, T0_), mi), ((T0_, T1_, B1, B0), mi),
                      ((A0, B0, B1, A1), mi), ((A0, L0, T0_, B0), mi), ((A1, B1, T1_, L1), mi)):
            f = bm.faces.new(vs)
            f.material_index = m
        return bm

    def stairs_bms(self, b):
        """Stairs brush: min/max, 'rise' (+x|-x|+z|-z), optional 'steps' (default: 0.25 m risers),
        'mat', 'nose' (material of a 0.12 m strip on each tread's front edge; default the Arch lip,
        '' for none). Each step is a full-depth block to the high end, so the union is a solid
        staircase. Pair with stairs_col_bm() for a smooth invisible collider."""
        (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
        across, lo_r, hi_r, _ = self._run_frame(b)
        n = int(b.get("steps") or max(1, round((y1 - y0) / 0.25)))
        d = (hi_r - lo_r) / n
        nose = b.get("nose", self.lip)
        nd = (min(0.12, abs(d) * 0.4) * (1 if d > 0 else -1)) if nose else 0.0

        def block(ra, rb, top):
            ra, rb = sorted((ra, rb))
            if b["rise"][1] == "z":
                return self.box_bm(dict(b, min=[across[0], y0, ra], max=[across[1], top, rb]))
            return self.box_bm(dict(b, min=[ra, y0, across[0]], max=[rb, top, across[1]]))
        out = []
        for i in range(n):
            r0 = lo_r + d * i
            top = y0 + (y1 - y0) * (i + 1) / n
            out.append(block(r0 + nd, hi_r, top))
            if nose:                       # the tread's front strip: same solid, nose-coloured top
                nbm = block(r0, r0 + nd, top)
                for f in nbm.faces:
                    if f.normal.z > 0.5:
                        f.material_index = self.idx(nose)
                out.append(nbm)
        return out

    def stairs_col_bm(self, b):
        """Invisible collider for a stairs brush: a wedge through the step nosings (foot one tread
        in front of the first riser, top at the landing). Put it in a col_ bucket."""
        (x0, y0, z0), (x1, y1, z1) = b["min"], b["max"]
        across, lo_r, hi_r, P = self._run_frame(b)
        n = int(b.get("steps") or max(1, round((y1 - y0) / 0.25)))
        d = (hi_r - lo_r) / n
        bm = bmesh.new()
        V = lambda a, r, y: bm.verts.new(P(a, r, y))  # noqa: E731
        A0, A1 = V(across[0], lo_r - d, y0), V(across[1], lo_r - d, y0)
        T0_, T1_ = V(across[0], hi_r - d, y1), V(across[1], hi_r - d, y1)
        E0, E1 = V(across[0], hi_r, y1), V(across[1], hi_r, y1)
        B0, B1 = V(across[0], hi_r, y0), V(across[1], hi_r, y0)
        for vs in ((A0, A1, T1_, T0_), (T0_, T1_, E1, E0), (E0, E1, B1, B0), (A0, B0, B1, A1),
                   (A0, T0_, E0, B0), (A1, B1, E1, T1_)):
            bm.faces.new(vs)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm

    def pad_pockets(self, pads, depth: float = 0.3, seg: int = 64):
        """Cylindrical pockets (subtract in union()) so a spawn pad disc sits flush in the deck."""
        out = []
        for b in pads:
            c = C.g2b(*b["center"])
            bm = bmesh.new()
            C.bm_cylinder(bm, b["radius"], b["radius"], c.z - depth, c.z + 0.6, seg=seg, center=(c.x, c.y))
            out.append((f"_pocket_{b['id']}", bm))
        return out

    # boolean + finishing ─────────────────────────────────────────────────────────────────────
    def union(self, base_bm, ops, pockets=(), base_name: str = "arch"):
        """EXACT-solver union of base_bm with every (name, bm) in ops, minus every (name, bm) in
        pockets; merged verts + degenerate cleanup. Frees the input bmeshes; returns a new bmesh."""
        base = C.mesh_object_from_bm(base_name, base_bm, self.mats)
        base_bm.free()
        op_objs, pocket_objs = [], []
        for lst, dst in ((ops, op_objs), (pockets, pocket_objs)):
            for name, bm in lst:
                dst.append(C.mesh_object_from_bm(name, bm, self.mats))
                bm.free()
        log(f"architecture: EXACT union of {len(op_objs) + 1} solids, {len(pocket_objs)} pockets")
        steps = [("UNION", op_objs)] + ([("DIFFERENCE", pocket_objs)] if pocket_objs else [])
        me = C.boolean_chain(base, steps)
        bpy.data.objects.remove(base)
        bm = bmesh.new()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
        return bm

    def bevel_convex(self, bm, width: float = 0.045, angle: float = 30.0, segments: int = 2, profile: float = 0.5):
        """Bevel every convex edge sharper than `angle` deg, then drop zero-area slivers."""
        edges = C.sharp_convex_edges(bm, angle)
        log(f"architecture: {len(bm.faces)} faces after booleans; bevelling {len(edges)} convex edges")
        C.bevel_edges(bm, edges, width, segments=segments, profile=profile)
        nbad = C.cleanup_degenerate(bm)
        log(f"architecture: removed {nbad} zero-area faces after bevel")

    def grid_cut(self, bm, mat: str, x0: float, x1: float, z0: float, z1: float, grid: int = 4):
        """Cut the flat up-facing faces of material `mat` on a `grid` m lattice over the glTF (x, z)
        rectangle: the boolean leaves huge concave n-gons whose triangulation is long slivers (bad
        for the Rapier trimesh and per-vertex effects)."""
        mi = self.idx(mat)
        cuts = [(Vector((x, 0, 0)), Vector((1, 0, 0))) for x in range(int(x0) + grid, int(x1), grid)] + \
               [(Vector((0, -z, 0)), Vector((0, 1, 0))) for z in range(int(z0) + grid, int(z1), grid)]
        for co, no in cuts:
            floor = [f for f in bm.faces if f.material_index == mi and f.normal.z > 0.999]
            # order-preserving de-dup: iterating a set of BMesh elements is address-ordered (non-deterministic)
            geom = list(dict.fromkeys(e for f in floor for e in f.edges)) + floor + \
                list(dict.fromkeys(v for f in floor for v in f.verts))
            bmesh.ops.bisect_plane(bm, geom=geom, plane_co=co, plane_no=no, dist=1e-5)
        log(f"architecture: {mat} floor cut on a {grid} m grid -> "
            f"{sum(1 for f in bm.faces if f.material_index == mi)} {mat} faces")
        bm.faces.ensure_lookup_table()

    def default_classify(self, bottoms: str = "solid_undersides"):
        """Faces facing down -> `bottoms` (not paintable, CONTRACT §3.1); the rest -> paint_<mat>."""
        def classify(f):
            if C.b2g(f.normal)[1] < -0.5:
                return bottoms
            return "paint_" + self.mats[f.material_index][2:]
        return classify

    def to_geos(self, bm, classify) -> dict:
        """Split a bmesh into Geo buckets: classify(face) -> bucket name, or None to drop the face."""
        buckets: dict[str, list] = {}
        dropped = 0
        for f in bm.faces:
            name = classify(f)
            if name is None:
                dropped += 1
                continue
            buckets.setdefault(name, []).append(f)
        geos = {}
        for name, faces in buckets.items():
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
                g.fmat.append(self.mats[f.material_index])
                g.fsmooth.append(False)
            geos[name] = g
            log(f"architecture: {name}: {len(faces)} faces")
        log(f"architecture: dropped {dropped} faces")
        return geos


# ── deco asset handlers (ctx.build_deco; modules add/override with ctx.register_deco) ──────────────
def _solid_or_deco(b, solid, deco):
    return b.get("bucket") or (solid if b.get("collide") else deco)


def _deco_bollard(ctx, b, m):
    """Bollard; on a waterfront map (mdef has waterY) 2 of 3 bollards (seeded; 'rope': true/false
    forces it) get a coiled mooring line running out over the nearest bounds edge into the water."""
    ctx.bucket(_solid_or_deco(b, "solid_bollards", "deco_bollards")).extend(D.bollard(), m)
    water_z = ctx.mdef.get("waterY")
    rope = b.get("rope", C.seed_of(b["_base"]) % 3 != 2)
    if water_z is None or not rope:
        return
    pos = b["pos"]
    (bx0, _, bz0), (bx1, _, bz1) = ctx.mdef["bounds"]["min"], ctx.mdef["bounds"]["max"]
    gx, gz = pos[0], pos[2]
    dists = [(gx - bx0, (-1, 0)), (bx1 - gx, (1, 0)), (gz - bz0, (0, -1)), (bz1 - gz, (0, 1))]
    _, (ox, oz) = min(dists, key=lambda t: t[0])
    out_b = C.g2b(ox, 0, oz)
    neck = C.g2b(pos[0], pos[1] + 0.47, pos[2])
    ctx.bucket("deco_ropes").extend(D.rope_coil_and_line(neck, out_b, water_z, b["id"]))


DECO_HANDLERS = {
    "lamp": lambda ctx, b, m: ctx.bucket(_solid_or_deco(b, "solid_lamps", "deco_lamps")).extend(D.lamp(), m),
    "bollard": _deco_bollard,
    "billboard": lambda ctx, b, m: ctx.bucket(b.get("bucket") or f"deco_{b['_base']}").extend(D.billboard(b["text"]), m),
    "banner": lambda ctx, b, m: ctx.bucket(b.get("bucket") or "deco_banners").extend(D.banner(b["text"]), m),
    "lighthouse": lambda ctx, b, m: ctx.bucket(b.get("bucket") or "deco_lighthouse").extend(D.lighthouse(b["id"]), m),
    "cranes": lambda ctx, b, m: ctx.bucket(b.get("bucket") or "deco_cranes").extend(D.cranes(b["id"]), m),
    "islands": lambda ctx, b, m: ctx.bucket(b.get("bucket") or "deco_islands").extend(D.islands(b["id"]), m),
    "sailboat": lambda ctx, b, m: ctx.bucket(b.get("bucket") or "deco_sailboats").extend(D.sailboat(b["id"]), m),
    "buoy": lambda ctx, b, m: ctx.bucket(b.get("bucket") or "deco_buoys").extend(D.buoy(b.get("variant", "red"), b["id"]), m),
    "pennant": lambda ctx, b, m: ctx.bucket(b.get("bucket") or "deco_flags").extend(D.pennant(b["team"], b["id"]), m),
}


# ── the ctx handed to map_<id>.build() ────────────────────────────────────────────────────────────
class MapCtx:
    """Shared helpers for a map module. See MAPS_README.md for the full contract. Coordinates in
    brushes / pos / eye / look / extras are runtime glTF (Y-up); Geo buckets hold Blender space
    (use ctx.g2b / ctx.place)."""

    def __init__(self, mdef, layout, brushes, notes, team_hex, coll, args):
        self.mdef = mdef
        self.layout = layout
        self.brushes = brushes          # expanded: FIXUPS + mirror applied, each with _base
        self.notes = notes
        self.overlap_ok: set = set()    # the module's OVERLAP_OK (authored ids exempt from overlap checks)
        self.map_id = mdef["id"]
        self.team_hex = team_hex        # {'M_pad_A': '#..', 'M_pad_B': '#..'} from data/teams.json
        self.coll = coll
        self.args = args
        self.C, self.D, self.log = C, D, log
        self.g2b, self.b2g = C.g2b, C.b2g
        self.seed, self.rng = C.seed_of, C.rng
        self.geos: dict[str, C.Geo] = {}
        self.objects: list = []         # module-made bpy mesh objects (ctx.add_object)
        self.extras: dict[str, dict] = {}
        self.empties: list = []
        self.info: dict = {}            # extra mapinfo extras (after the pipeline's df_* keys)
        self.summary: dict = {}         # extra keys for art/renders/map_<id>_stats.json
        self.cameras: dict[str, dict] = default_cameras(mdef)
        self.preview_shaders: dict = {}
        self.render_hooks: list = []
        self.deco_handlers = dict(DECO_HANDLERS)
        self.ao = {"enabled": not args.no_ao, "samples": min(64, args.ao_samples), "distance": args.ao_distance,
                   "size": None, "exclude_prefixes": ("col_", "oob_", "water_"), "dilate_px": 16}
        self.render_light_scale = 60.0  # Blender W per df_light intensity unit (QA renders only)
        self.sh = SimpleNamespace(sock=_sock, math=_math, mix=_mix, uv=_uv, pos=_pos, edge_dist=_edge_dist,
                                  white=_white)

    # data ────────────────────────────────────────────────────────────────────────────────────
    def brush(self, bid: str) -> dict:
        return next(b for b in self.brushes if b["id"] == bid)

    def brushes_of(self, *kinds) -> list[dict]:
        return [b for b in self.brushes if b["kind"] in kinds]

    def ground_y(self, x: float, z: float) -> float:
        return ground_y(self.brushes, x, z)

    def place(self, pos, yaw: float = 0.0, scale=1.0) -> Matrix:
        return C.place_matrix(pos, yaw, scale)

    # materials ───────────────────────────────────────────────────────────────────────────────
    def mat(self, name: str, hexc: str | None = None):
        return C.get_material(name, hexc if hexc else self.team_hex.get(name))

    def define_material(self, name, hexc, rough=0.7, metal=0.0, emis=0.0, double=False):
        C.define_material(name, hexc, rough, metal, emis, double)

    # geometry ────────────────────────────────────────────────────────────────────────────────
    def bucket(self, name: str) -> C.Geo:
        if name not in self.geos:
            self.geos[name] = C.Geo(name)
        return self.geos[name]

    def arch(self, mats, default: str = "concrete", lip: str = "hazard") -> Arch:
        return Arch(self, mats, default, lip)

    def add_object(self, ob, extras: dict | None = None):
        """A mesh object the module built itself (name = node name, contract prefix required). It
        is (re)linked into the map collection in prefix order; transforms are applied for
        APPLY_PREFIXES; UVMap (metres) is added when missing; no modifiers on paint_ objects."""
        self.objects.append(ob)
        if extras:
            self.extras.setdefault(ob.name, {}).update(extras)
        return ob

    def set_extras(self, node: str, **kv):
        """Node extras (glTF coordinates), e.g. set_extras('conveyor_ramp_A', df_conveyor=[0, 0.9, 2.0])."""
        self.extras.setdefault(node, {}).update(kv)

    def add_empty(self, name: str, pos, yaw: float = 0.0, extras: dict | None = None, display: str = "PLAIN_AXES"):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = display
        e.location = C.g2b(*pos)
        e.rotation_euler = (0.0, 0.0, math.radians(yaw))
        for k, v in (extras or {}).items():
            e[k] = v
        self.empties.append(e)
        return e

    def add_light(self, name: str, pos, color: str, intensity: float, range_m: float):
        """§14.2 light_* empty: df_light {color:'#RRGGBB', intensity, range}."""
        if not name.startswith("light_"):
            raise ValueError(f"light empty {name!r} must be prefixed light_")
        return self.add_empty(name, pos, extras={"df_light": {"color": color, "intensity": float(intensity),
                                                               "range": float(range_m)}}, display="SPHERE")

    # props from generic brush kinds ──────────────────────────────────────────────────────────
    def build_crates(self, bucket: str = "paint_crate"):
        """kind 'crate': center (bottom-centre), size (edge), yaw. One df_group per instance."""
        n = 0
        for b in self.brushes_of("crate"):
            unit = D.crate_unit(C.seed_of(b["_base"]) % 3)
            self.bucket(b.get("bucket", bucket)).extend(unit, C.place_matrix(b["center"], b.get("yaw", 0.0), b["size"]),
                                                        group=True)
            n += 1
        log(f"props: {n} crates")

    def build_planters(self, shell="paint_planter", soil="solid_planter_soil", trunks="solid_palm_trunks",
                       fronds="deco_palm_fronds"):
        """kind 'planter': center, size [w, h, d], yaw, palm (bool)."""
        for b in self.brushes_of("planter"):
            w, h, d = b["size"]
            pl = D.planter(w, h, d)
            m = C.place_matrix(b["center"], b.get("yaw", 0.0))
            self.bucket(shell).extend(pl["shell"], m)
            self.bucket(soil).extend(pl["soil"], m)
            if b.get("palm"):
                p = D.palm(b["_base"], pl["soil_z"])
                self.bucket(trunks).extend(p["trunk"], m)
                self.bucket(fronds).extend(p["fronds"], m)

    def build_spawnpads(self, depth: float = 0.32):
        """kind 'spawnpad': center (top-centre), radius, team -> solid_pad_<team> (yaw from spawns)."""
        for b in self.brushes_of("spawnpad"):
            team = b["team"]
            g = D.spawn_pad(team, b["radius"], depth)
            self.bucket(f"solid_pad_{team}").extend(g, C.place_matrix(b["center"], self.mdef["spawns"][team]["yaw"]))

    def register_deco(self, asset: str, fn):
        """fn(ctx, brush, matrix) for kind 'deco' brushes with this asset id (overrides built-ins)."""
        self.deco_handlers[asset] = fn

    def build_deco(self):
        """kind 'deco': asset, pos, yaw, scale, collide, optional text / bucket, in brush order."""
        for b in self.brushes_of("deco"):
            fn = self.deco_handlers.get(b["asset"])
            if fn is None:
                raise ValueError(f"unknown deco asset {b['asset']!r} ({b['id']}); known: {sorted(self.deco_handlers)}")
            fn(self, b, C.place_matrix(b["pos"], b.get("yaw", 0.0), b.get("scale", 1.0)))

    # QA ──────────────────────────────────────────────────────────────────────────────────────
    def add_camera(self, name: str, eye, look, fov: float = 56.0, res=(1600, 900), clip_start: float = 0.1,
                   before=None, after=None):
        """Extra QA render station -> art/renders/map_<id>_<name>.png. eye/look in glTF metres.
        before(ctx, scene) / after(ctx, scene) may hide/show objects for this shot."""
        self.cameras[name] = {"kind": "persp", "eye": list(eye), "look": list(look), "fov": fov, "res": tuple(res),
                              "clip_start": clip_start, "before": before, "after": after}

    def add_preview_shader(self, mat: str, fn):
        """fn(ctx, nt, bsdf, base_rgb) -> colour socket (or None) for material `mat` in QA renders."""
        self.preview_shaders[mat] = fn


def default_cameras(mdef) -> dict:
    """top (ortho, SUNCREW at the bottom, screen-right = -X like the minimap), persp (player's eye
    from the SUNCREW spawn looking at mid), aerial (3/4 lobby view), all derived from bounds/spawns."""
    (bx0, _, bz0), (bx1, _, bz1) = mdef["bounds"]["min"], mdef["bounds"]["max"]
    cx, cz, hx, hz = (bx0 + bx1) / 2, (bz0 + bz1) / 2, (bx1 - bx0) / 2, (bz1 - bz0) / 2
    sa = mdef["spawns"]["A"]["pos"]
    s = 1.0 if sa[2] < cz else -1.0
    return {
        "top": {"kind": "top", "center": [cx, cz], "ortho_scale": float(round(2 * max(hx, hz) * 1.4)),
                "res": (1600, 1600), "before": None, "after": None},
        "persp": {"kind": "persp", "eye": [sa[0] + 1.2, sa[1] + 1.6, sa[2] + 3.0 * s],
                  "look": [cx, sa[1] - 1.0, cz + 4.0 * s], "fov": 56.0, "res": (1600, 900), "clip_start": 0.1,
                  "before": None, "after": None},
        "aerial": {"kind": "persp", "eye": [cx + 3.5 * hx, 0.81 * hz, cz - 1.5714 * hz],
                   "look": [cx + hx / 7.0, -2.0, cz + hz / 10.5], "fov": 56.0, "res": (1600, 900), "clip_start": 0.1,
                   "before": None, "after": None},
    }


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



def apply_preview_shading(ctx):
    """Render-only procedural looks for the QA renders (mirrors the runtime LOOK shaders). A module
    shader (ctx.add_preview_shader) wins over the built-in one for the same material."""
    mdef = ctx.mdef
    lin = C.hex_to_linear
    for mat in bpy.data.materials:
        if not mat.name.startswith("M_"):
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None:
            continue
        base = tuple(bsdf.inputs["Base Color"].default_value)[:3]
        col = None
        if mat.name in ctx.preview_shaders:
            col = ctx.preview_shaders[mat.name](ctx, nt, bsdf, base)
        elif mat.name == "M_tile":
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


def setup_render_world(ctx, samples):
    """EEVEE + AgX grade, sky/ambient world, key light, render-only sea (outdoor maps with waterY),
    point lights at light_* empties, then the module's ctx.render_hooks."""
    mdef = ctx.mdef
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
    lighting = mdef["lighting"]
    preset = lighting["presets"][lighting["default"]]
    kind = preset.get("kind", "outdoor")
    lin = C.hex_to_linear
    world = bpy.data.worlds.new("qa_world")
    sc.world = world
    nt = world.node_tree
    bg = next(n for n in nt.nodes if n.type == "BACKGROUND")
    if kind == "interior":
        bg.inputs["Color"].default_value = (*lin(preset.get("ambient", "#40485A")), 1.0)
        bg.inputs["Strength"].default_value = float(preset.get("ambientIntensity", 0.6))
    else:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        sep = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(tc.outputs["Generated"], sep.inputs[0])
        t = _math(nt, "POWER", _math(nt, "MINIMUM", _math(nt, "DIVIDE", _math(nt, "MAXIMUM", sep.outputs["Z"], 0.0), 0.42), 1.0), 0.65)
        col = _mix(nt, t, lin(preset["skyHorizon"]), lin(preset["skyZenith"]))
        nt.links.new(col, bg.inputs["Color"])
        bg.inputs["Strength"].default_value = 1.0
    # key light (outdoor sun from elevation/azimuth; interior: keyDir = direction the light travels)
    if kind == "interior":
        kd = preset.get("keyDir", [0.2, -1.0, 0.3])
        to_sun = C.g2b(-kd[0], -kd[1], -kd[2]).normalized()
        energy, color = 1.6 * float(preset.get("keyIntensity", 1.5)), preset.get("keyColor", "#DDE6F2")
    else:
        el, az = math.radians(preset["sunElevationDeg"]), math.radians(preset["sunAzimuthDeg"])
        to_sun = C.g2b(math.sin(az) * math.cos(el), math.sin(el), math.cos(az) * math.cos(el)).normalized()
        energy, color = 4.8, preset["sunColor"]
    ld = bpy.data.lights.new("qa_sun", "SUN")
    ld.energy = energy
    ld.color = lin(color)
    ld.angle = math.radians(1.2)
    sun = bpy.data.objects.new("qa_sun", ld)
    C.link(sun)
    sun.rotation_euler = to_sun.to_track_quat("Z", "Y").to_euler()
    # sea (render only)
    if kind != "interior" and mdef.get("waterY") is not None and "waterDeep" in preset:
        (bx0, _, bz0), (bx1, _, bz1) = mdef["bounds"]["min"], mdef["bounds"]["max"]
        cx, cz, hx, hz = (bx0 + bx1) / 2, (bz0 + bz1) / 2, (bx1 - bx0) / 2, (bz1 - bz0) / 2
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
        wn.links.new(nz.outputs["Fac"], bump.inputs["Height"])
        wn.links.new(bump.outputs["Normal"], wb.inputs["Normal"])
        # shallow tint near the play-space bounds (Blender Y = -glTF z)
        geo = wn.nodes.new("ShaderNodeNewGeometry")
        sep2 = wn.nodes.new("ShaderNodeSeparateXYZ")
        wn.links.new(geo.outputs["Position"], sep2.inputs[0])
        px = _math(wn, "SUBTRACT", sep2.outputs["X"], cx) if cx else sep2.outputs["X"]
        py = _math(wn, "ADD", sep2.outputs["Y"], cz) if cz else sep2.outputs["Y"]
        dx = _math(wn, "MAXIMUM", _math(wn, "SUBTRACT", _math(wn, "ABSOLUTE", px), hx), 0.0)
        dy = _math(wn, "MAXIMUM", _math(wn, "SUBTRACT", _math(wn, "ABSOLUTE", py), hz), 0.0)
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
    # light_* empties -> point lights (QA only; the runtime picks <= 6 real ones)
    for e in ctx.empties:
        dl = e.get("df_light") if e.name.startswith("light_") else None
        if dl is None:
            continue
        pl = bpy.data.lights.new(f"qa_{e.name}", "POINT")
        pl.color = lin(dl["color"])
        pl.energy = float(dl["intensity"]) * ctx.render_light_scale
        pl.shadow_soft_size = 0.15
        if hasattr(pl, "use_custom_distance"):
            pl.use_custom_distance = True
            pl.cutoff_distance = float(dl["range"])
        po = bpy.data.objects.new(f"qa_{e.name}", pl)
        po.location = e.location
        C.link(po)
    sc.render.film_transparent = False
    for hook in ctx.render_hooks:
        hook(ctx, sc)
    return sun


def render_views(ctx, quick=False):
    sc = bpy.context.scene
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    for name, st in ctx.cameras.items():
        cd = bpy.data.cameras.new(f"qa_{name}")
        cam = bpy.data.objects.new(f"qa_{name}", cd)
        C.link(cam)
        if st["kind"] == "top":
            cd.type = "ORTHO"
            cd.ortho_scale = st["ortho_scale"]
            cd.clip_end = 1000.0
            cam.location = C.g2b(st["center"][0], 300.0, st["center"][1])
            cam.rotation_euler = (0.0, 0.0, math.pi)          # SUNCREW (-Z) at the bottom, screen-right = -X
        else:
            cd.sensor_fit = "VERTICAL"
            cd.angle_y = math.radians(st.get("fov", 56.0))
            cd.clip_start = st.get("clip_start", 0.1)
            cd.clip_end = 3000.0
            eye, look = C.g2b(*st["eye"]), C.g2b(*st["look"])
            cam.location = eye
            cam.rotation_euler = (look - eye).to_track_quat("-Z", "Y").to_euler()
        sc.camera = cam
        rx, ry = st.get("res", (1600, 900))
        sc.render.resolution_x, sc.render.resolution_y = (rx // 2, ry // 2) if quick else (rx, ry)
        out = os.path.join(C.RENDER_DIR, f"map_{ctx.map_id}_{name}.png")
        sc.render.filepath = out
        if st.get("before"):
            st["before"](ctx, sc)
        log(f"render: {name} ->", out)
        bpy.ops.render.render(write_still=True)
        if st.get("after"):
            st["after"](ctx, sc)


# ── §14.3 AO bake ─────────────────────────────────────────────────────────────────────────────────
def setup_cycles_device(sc) -> str:
    """Cycles on the GPU (OptiX, then CUDA/HIP/oneAPI/Metal) when one is present, else the CPU."""
    sc.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
    except Exception:
        prefs = None
    if prefs is not None:
        for dt in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
            try:
                prefs.compute_device_type = dt
            except TypeError:
                continue
            try:
                prefs.refresh_devices()
            except Exception:
                try:
                    prefs.get_devices()
                except Exception:
                    pass
            devs = [d for d in prefs.devices if d.type == dt]
            if devs:
                for d in prefs.devices:
                    d.use = d.type == dt
                sc.cycles.device = "GPU"
                return f"GPU {dt} ({', '.join(sorted({d.name for d in devs}))})"
        try:
            prefs.compute_device_type = "NONE"
        except TypeError:
            pass
    sc.cycles.device = "CPU"
    return "CPU"


def _dilate(val, mask, iters):
    """Grow `val` from masked texels into unmasked ones (8-neighbour mean), `iters` rings."""
    import numpy as np
    val, mask = val.copy(), mask.copy()
    H, W = val.shape
    for _ in range(iters):
        acc = np.zeros_like(val)
        cnt = np.zeros_like(val)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                src = (slice(max(0, dy), H + min(0, dy)), slice(max(0, dx), W + min(0, dx)))
                dst = (slice(max(0, -dy), H + min(0, -dy)), slice(max(0, -dx), W + min(0, -dx)))
                m = mask[src]
                acc[dst] += np.where(m, val[src], 0.0)
                cnt[dst] += m
        grow = (~mask) & (cnt > 0)
        if not grow.any():
            break
        val[grow] = acc[grow] / cnt[grow]
        mask |= grow
    return val, mask


def _ao_probe(ctx, paint_objs, ao, size):
    """Sanity numbers: AO sampled on the paint surfaces (area-weighted barycentric grid) — crate
    sides near their base vs higher up, and tile floor hugging a ground crate vs open floor."""
    import numpy as np
    by = {o.name: o for o in paint_objs}
    out = {}

    def samples(ob, dens=16.0):
        me = ob.data
        me.calc_loop_triangles()
        uvl = me.uv_layers["Atlas"].data
        grp = me.attributes.get("df_group")
        gvals = None
        if grp is not None:
            gvals = [0] * len(me.polygons)
            grp.data.foreach_get("value", gvals)
        pts = []
        for lt in me.loop_triangles:
            vs = [me.vertices[i].co for i in lt.vertices]
            uvs = [uvl[li].uv for li in lt.loops]
            n = max(1, min(40, math.ceil(math.sqrt(lt.area * dens))))
            for i in range(n):
                for j in range(n - i):
                    a, b = (i + 1.0 / 3.0) / n, (j + 1.0 / 3.0) / n
                    c = 1.0 - a - b
                    p = vs[0] * a + vs[1] * b + vs[2] * c
                    u = uvs[0][0] * a + uvs[1][0] * b + uvs[2][0] * c
                    v = uvs[0][1] * a + uvs[1][1] * b + uvs[2][1] * c
                    x = min(size - 1, max(0, int(u * size)))
                    y = min(size - 1, max(0, int(v * size)))
                    pts.append((p.x, p.y, p.z, lt.normal.z, float(ao[y, x]),
                                gvals[lt.polygon_index] if gvals else -1))
        return np.array(pts, np.float64)

    if "paint_crate" in by:
        s = samples(by["paint_crate"])
        base = {}
        for g in np.unique(s[:, 5]):
            base[g] = s[s[:, 5] == g, 2].min()
        h = s[:, 2] - np.array([base[g] for g in s[:, 5]])
        side = np.abs(s[:, 3]) < 0.5
        lo, hi = side & (h < 0.2), side & (h > 0.5)
        if lo.any() and hi.any():
            out["crate_side_base_mean"] = round(float(s[lo, 4].mean()), 4)
            out["crate_side_upper_mean"] = round(float(s[hi, 4].mean()), 4)
    floor_name = next((n for n in ("paint_tile", "paint_floor", "paint_concrete") if n in by), None)
    crates = [b for b in ctx.brushes if b["kind"] == "crate"]
    if floor_name and crates:
        s = samples(by[floor_name], dens=24.0)
        s = s[s[:, 3] > 0.9]
        gx, gz, gy = s[:, 0], -s[:, 1], s[:, 2]

        def dist_to(bs):
            d = np.full(len(s), 1e9)
            for b in bs:
                (x0, y0, z0), (x1, y1, z1) = aabb_of(b)
                dx = np.maximum(np.maximum(x0 - gx, gx - x1), 0.0)
                dz = np.maximum(np.maximum(z0 - gz, gz - z1), 0.0)
                on = np.abs(gy - y0) < 0.05
                d = np.where(on, np.minimum(d, np.hypot(dx, dz)), d)
            return d
        dc = dist_to(crates)
        solids = [b for b in ctx.brushes if b["kind"] in SOLID_KINDS and not overlap_exempt(b, ctx.overlap_ok)
                  and aabb_of(b) is not None]
        dall = np.full(len(s), 1e9)
        for b in solids:
            (x0, y0, z0), (x1, y1, z1) = aabb_of(b)
            dx = np.maximum(np.maximum(x0 - gx, gx - x1), 0.0)
            dz = np.maximum(np.maximum(z0 - gz, gz - z1), 0.0)
            dall = np.minimum(dall, np.hypot(dx, dz))
        near = (dc > 0.0) & (dc < 0.3)
        far = dall > 3.0
        if near.any() and far.any():
            out["floor_by_crate_mean"] = round(float(s[near, 4].mean()), 4)
            out["floor_open_mean"] = round(float(s[far, 4].mean()), 4)
            out["floor_samples"] = [int(near.sum()), int(far.sum())]
    return out


def bake_ao(ctx, objs, paint_objs, S):
    """§14.3: Cycles AO of every paint_* surface baked into the shared Atlas UV space ->
    art/gltf/map_<id>_ao.png (8-bit grey, dilated into the gutters). Meshes are not modified; the
    temporary image nodes / world are removed before export. Returns (file name, stats)."""
    import numpy as np
    cfg = ctx.ao
    size = int(cfg["size"] or (S if S <= 1024 else S // 2))
    sc = bpy.context.scene
    prev_engine = sc.render.engine
    t0 = time.time()
    dev = setup_cycles_device(sc)
    sc.cycles.samples = int(cfg["samples"])
    for attr, val in (("use_denoising", False), ("seed", 0), ("use_animated_seed", False)):
        if hasattr(sc.cycles, attr):
            setattr(sc.cycles, attr, val)
    world = bpy.data.worlds.new("ao_bake_world")
    sc.world = world
    world.light_settings.distance = float(cfg["distance"])
    img = bpy.data.images.new("ao_bake", size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = "Non-Color"
    fill = np.zeros((size * size, 4), np.float32)
    fill[:, :3] = 1.0                                # unbaked = white with alpha 0 (the bake mask)
    img.pixels.foreach_set(fill.ravel())
    hidden = []
    for ob in list(objs.values()) + ctx.empties:
        if ob.name.startswith(tuple(cfg["exclude_prefixes"])) and not ob.hide_render:
            ob.hide_render = True
            hidden.append(ob)
    mats = []
    for ob in paint_objs:
        for slot in ob.material_slots:
            if slot.material is not None and slot.material not in mats:
                mats.append(slot.material)
    added = []
    for mat in mats:
        nt = mat.node_tree
        prev = nt.nodes.active
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        nt.nodes.active = n
        added.append((mat, n, prev))
    bpy.ops.object.select_all(action="DESELECT")
    for ob in paint_objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = paint_objs[0]
    log(f"ao: baking {len(paint_objs)} paint objects at {size}px, {sc.cycles.samples} samples, "
        f"distance {cfg['distance']} m on {dev}")
    try:
        bpy.ops.object.bake(type="AO", uv_layer="Atlas", margin=0, use_clear=False, target="IMAGE_TEXTURES",
                            use_selected_to_active=False)
    except RuntimeError as e:
        if sc.cycles.device != "GPU":
            raise
        log(f"ao: GPU bake failed ({e}); retrying on the CPU")
        sc.cycles.device = "CPU"
        dev = "CPU (GPU failed)"
        img.pixels.foreach_set(fill.ravel())
        bpy.ops.object.bake(type="AO", uv_layer="Atlas", margin=0, use_clear=False, target="IMAGE_TEXTURES",
                            use_selected_to_active=False)
    px = np.zeros(size * size * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(size, size, 4)                   # Blender buffer: row 0 = v 0 (bottom)
    mask = px[..., 3] > 0.5
    raw = px[..., 0].astype(np.float64)
    ao, filled = _dilate(raw, mask, int(cfg["dilate_px"]))
    ao[~filled] = 1.0
    ao = np.clip(ao, 0.0, 1.0)
    u8 = np.round(ao * 255.0).astype(np.uint8)
    fname = f"map_{ctx.map_id}_ao.png"
    C.write_png_gray(os.path.join(C.GLTF_DIR, fname), u8[::-1])
    # cleanup (nothing of the bake may reach the export)
    for mat, n, prev in added:
        mat.node_tree.nodes.remove(n)
        if prev is not None:
            mat.node_tree.nodes.active = prev
    for ob in hidden:
        ob.hide_render = False
    bpy.data.images.remove(img)
    sc.world = None
    bpy.data.worlds.remove(world)
    sc.render.engine = prev_engine
    vals = raw[mask]
    q = u8[mask].astype(np.float64) / 255.0
    hist = np.histogram(q, bins=10, range=(0.0, 1.0))[0]
    stats = {
        "file": fname, "size": size, "samples": int(cfg["samples"]), "distance": float(cfg["distance"]), "device": dev,
        "seconds": round(time.time() - t0, 1), "baked_texels": int(mask.sum()),
        "dilated_texels": int((filled & ~mask).sum()),
        "mean": round(float(vals.mean()), 4), "std": round(float(vals.std()), 4),
        "min": round(float(vals.min()), 4), "p05": round(float(np.percentile(vals, 5)), 4),
        "p50": round(float(np.percentile(vals, 50)), 4), "p95": round(float(np.percentile(vals, 95)), 4),
        "max": round(float(vals.max()), 4), "hist10": [int(h) for h in hist],
    }
    stats.update(_ao_probe(ctx, paint_objs, ao, size))
    flat = stats["std"] < 0.02 or (stats["p95"] - stats["p05"]) < 0.08
    stats["sane"] = (not flat) and stats.get("crate_side_base_mean", 0) < stats.get("crate_side_upper_mean", 1) and \
        stats.get("floor_by_crate_mean", 0) < stats.get("floor_open_mean", 1)
    log("ao stats:", json.dumps(stats))
    if not stats["sane"]:
        log("WARN ao: the bake looks flat or contact areas are not darker - inspect", fname)
    return fname, stats


# ── layout + module loading ──────────────────────────────────────────────────────────────────────
def load_map(map_id: str, layout_arg: str | None):
    """-> (mdef, layout). mdef = the maps.json entry (a copy) with the layout's "meta" merged in:
    missing keys are filled from meta; with --layout meta OVERRIDES (the lane's newest proposal)."""
    maps = C.load_json("maps.json")
    entry = next((m for m in maps["maps"] if m["id"] == map_id), None)
    mdef = json.loads(json.dumps(entry)) if entry else {"id": map_id}
    src = None
    if layout_arg:
        cands = [layout_arg, os.path.join(C.ROOT, layout_arg), os.path.join(C.DATA_DIR, layout_arg)]
        path = next((p for p in cands if os.path.isfile(p)), None)
        if path is None:
            raise SystemExit(f"--layout {layout_arg!r} not found (tried {cands})")
        src = path
    elif mdef.get("layout"):
        src = os.path.join(C.DATA_DIR, mdef["layout"])
        if not os.path.isfile(src):
            raise SystemExit(f"maps.json {map_id}.layout -> {src} does not exist")
    if src:
        with open(src, encoding="utf-8") as f:
            layout = json.load(f)
        log(f"layout: {os.path.relpath(src, C.ROOT)}")
    elif mdef.get("brushes"):
        layout = {"brushes": mdef["brushes"]}
        src = "data/maps.json (inline brushes)"
        log("layout: inline brushes in data/maps.json (legacy)")
    else:
        raise SystemExit(f"map {map_id!r}: no layout (no inline brushes, no maps.json 'layout', no --layout); "
                         f"status {mdef.get('status')!r}")
    meta = layout.get("meta") or {}
    over, filled = [], []
    for k, v in meta.items():
        if k == "id":
            continue
        if layout_arg and k in mdef and mdef[k] != v:
            over.append(k)
            mdef[k] = v
        elif k not in mdef:
            filled.append(k)
            mdef[k] = v
    if over:
        log(f"layout meta OVERRIDES maps.json keys: {over}")
    if filled:
        log(f"layout meta fills keys missing from maps.json: {filled}")
    if mdef.get("status") != "built":
        log(f"NOTE map status is {mdef.get('status')!r} in maps.json (building from the layout anyway)")
    missing = [k for k in ("symmetry", "bounds", "spawns", "lighting") if k not in mdef]
    if missing:
        raise SystemExit(f"map {map_id!r}: metadata missing {missing} (put them in the layout's \"meta\" block)")
    layout["_source"] = src
    return mdef, layout


def realise_objects(ctx, coll):
    """Geo buckets + module objects -> objects in PREFIX_ORDER, transforms applied, UVMap, extras."""
    entries = [(n, g) for n, g in ctx.geos.items() if not g.empty()]
    entries += [(ob.name, ob) for ob in ctx.objects]
    names = [n for n, _ in entries]
    dup = sorted({n for n in names if names.count(n) > 1})
    if dup:
        raise ValueError(f"duplicate node names: {dup}")

    def order(n):
        p = next((p for p in PREFIX_ORDER if n.startswith(p)), None)
        if p is None:
            raise ValueError(f"mesh node {n!r} has no contract prefix {PREFIX_ORDER}")
        return (PREFIX_ORDER.index(p), n)
    objs = {}
    for name, src in sorted(entries, key=lambda e: order(e[0])):
        if isinstance(src, C.Geo):
            ob = src.to_object(coll, team_hex=ctx.team_hex)
            C.uv_box_metres(ob.data, "UVMap")
        else:
            ob = src
            if ob.type != "MESH":
                raise ValueError(f"ctx.add_object({name!r}): not a mesh object")
            for c in list(ob.users_collection):
                c.objects.unlink(ob)
            coll.objects.link(ob)
            bpy.context.view_layer.update()             # matrix_world of a fresh object is stale until now
            mw = ob.matrix_world.copy()
            if name.startswith(APPLY_PREFIXES) and mw != Matrix.Identity(4):
                if ob.data.users > 1:
                    ob.data = ob.data.copy()
                ob.data.transform(mw)
                if mw.determinant() < 0 and hasattr(ob.data, "flip_normals"):
                    ob.data.flip_normals()        # a mirrored transform turned the faces inside out
                ob.parent = None
                ob.matrix_basis = Matrix.Identity(4)
                ob.data.update()
            if name.startswith("paint_") and ob.modifiers:
                raise ValueError(f"{name}: paint_ objects may not carry modifiers (the atlas is unwrapped on the base mesh)")
            if "UVMap" not in ob.data.uv_layers:
                C.uv_box_metres(ob.data, "UVMap")
        objs[name] = ob
    for name, props in ctx.extras.items():
        ob = objs.get(name) or next((e for e in ctx.empties if e.name == name), None)
        if ob is None:
            raise ValueError(f"extras for unknown node {name!r}")
        for k, v in props.items():
            ob[k] = v
    # §14.2 contract checks
    for name, ob in objs.items():
        if name.startswith("conveyor_") and "df_conveyor" not in ob.keys():
            raise ValueError(f"{name}: conveyor_ nodes need extras df_conveyor [vx, vy, vz]")
        if name.startswith("spring_") and "df_launch" not in ob.keys():
            raise ValueError(f"{name}: spring_ nodes need extras df_launch [vx, vy, vz]")
        if name.startswith("oob_"):
            me = ob.data
            cnt: dict = {}
            for p in me.polygons:
                for ek in p.edge_keys:
                    cnt[ek] = cnt.get(ek, 0) + 1
            if any(c != 2 for c in cnt.values()):
                log(f"WARN {name}: oob_ volume is not a closed mesh")
    for e in ctx.empties:
        if e.name.startswith("light_") and "df_light" not in e.keys():
            raise ValueError(f"{e.name}: light_ empties need extras df_light")
    return objs


# ── main ─────────────────────────────────────────────────────────────────────────────────────────
def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--layout", default=None, help="layout json (lane override; its meta overrides maps.json)")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--quick-render", action="store_true")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--no-ao", action="store_true")
    ap.add_argument("--ao-samples", type=int, default=64)
    ap.add_argument("--ao-distance", type=float, default=2.0)
    ap.add_argument("--out-dir", default=None, help="write GLB/AO/stats/renders here instead of art/gltf + art/renders")
    args = ap.parse_args(argv)
    if args.out_dir:
        C.GLTF_DIR = C.RENDER_DIR = os.path.abspath(args.out_dir)
        log(f"out-dir: {C.GLTF_DIR} (committed art/gltf + art/renders untouched)")

    C.reset_scene()
    mdef, layout = load_map(args.map, args.layout)
    teams = C.load_json("teams.json")
    team_hex = {f"M_pad_{t['side']}": t["dye"] for t in teams["teams"]}
    for k, v in team_hex.items():
        C.get_material(k, v)
    try:
        mod = importlib.import_module(f"map_{mdef['id']}")
    except ModuleNotFoundError as e:
        raise SystemExit(f"no builder module art/blender/map_{mdef['id']}.py ({e}); see art/blender/MAPS_README.md")
    if not callable(getattr(mod, "build", None)):
        raise SystemExit(f"map_{mdef['id']}.py has no build(mdef, layout, ctx)")

    brushes, notes = expand_brushes(mdef, layout.get("brushes", []), getattr(mod, "FIXUPS", {}) or {})
    for n in notes:
        log(n)
    overlap_ok = set(getattr(mod, "OVERLAP_OK", ()) or ())
    for w in validate_brushes(brushes, overlap_ok):
        log("WARN", w)
    log(f"{len(brushes)} brushes after mirror ({mdef['symmetry']})")

    coll = C.new_collection("map_" + mdef["id"])
    ctx = MapCtx(mdef, layout, brushes, notes, team_hex, coll, args)
    ctx.overlap_ok = overlap_ok
    mod.build(mdef, layout, ctx)

    objs = realise_objects(ctx, coll)
    paint_objs = [o for n, o in objs.items() if n.startswith("paint_")]
    if not paint_objs:
        raise RuntimeError("the module produced no paint_* objects")
    log("objects:", ", ".join(f"{n}({len(o.data.polygons)}f)" for n, o in objs.items()))

    # ── atlas ────────────────────────────────────────────────────────────────────────────────
    paint_cfg = mdef.get("paint", {"texelsPerMeter": 10, "atlasMax": 2048})
    target, amax = paint_cfg["texelsPerMeter"], paint_cfg["atlasMax"]
    unwrap_atlas(paint_objs, 0.0)
    unwrapped = save_uvs(paint_objs)
    paint_area = sum(p.area for o in paint_objs for p in o.data.polygons)
    chosen = None
    margin_px = 4
    margin_used = margin_px
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
    if chosen is None:
        raise RuntimeError(f"no atlas size <= atlasMax {amax} was tried")
    S, st = chosen
    png = os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_atlas.png")
    os.makedirs(C.RENDER_DIR, exist_ok=True)
    st = atlas_stats(paint_objs, S, 3, png_path=png)
    st["blender_select_overlap_faces"] = blender_overlap_count(paint_objs)
    log("atlas stats:", json.dumps(st))
    for ob in paint_objs:
        ob.data.uv_layers.active_index = 0
        ob.data.uv_layers["UVMap"].active_render = True

    # ── §14.3 AO bake into Atlas space ─────────────────────────────────────────────────────────
    os.makedirs(C.GLTF_DIR, exist_ok=True)
    ao_file, ao_stats = (None, None)
    if ctx.ao["enabled"]:
        ao_file, ao_stats = bake_ao(ctx, objs, paint_objs, S)
    else:
        log("ao: skipped (--no-ao); mapinfo carries no df_ao")

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
    for k, v in ctx.info.items():
        info[k] = v
    if ao_file:
        info["df_ao"] = ao_file
    spawns = []
    for side in ("A", "B"):
        sp = mdef["spawns"][side]
        e = bpy.data.objects.new(f"spawn_{side}", None)
        e.empty_display_type = "SINGLE_ARROW"
        e.location = C.g2b(*sp["pos"])
        e.rotation_euler = (0.0, 0.0, math.radians(sp["yaw"]))
        C.link(e, coll)
        spawns.append(e)
    for e in ctx.empties:
        C.link(e, coll)

    # ── export ───────────────────────────────────────────────────────────────────────────────
    out = os.path.join(C.GLTF_DIR, f"map_{mdef['id']}.glb")
    export_objs = list(objs.values()) + [info] + spawns + list(ctx.empties)
    export_glb(export_objs, out)
    tri_total = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs.values())
    tri_paint = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in paint_objs)
    summary = {
        "map": mdef["id"], "glb": out, "glb_mb": round(os.path.getsize(out) / 1e6, 3),
        "tris_total": tri_total, "tris_paint": tri_paint, "objects": sorted(objs),
        "atlas": st, "fixups": notes, "version": DF_VERSION, "layout": layout.get("_source"),
    }
    summary.update(ctx.summary)
    summary["ao"] = ao_stats
    with open(os.path.join(C.RENDER_DIR, f"map_{mdef['id']}_stats.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1)
    log(f"exported {out} ({summary['glb_mb']} MB, {tri_total} tris, {tri_paint} paint tris)")

    if not args.no_render:
        for ob in objs.values():
            if ob.name.startswith(HIDDEN_PREFIXES):
                ob.hide_render = True
        apply_preview_shading(ctx)
        setup_render_world(ctx, 16 if args.quick_render else args.samples)
        render_views(ctx, quick=args.quick_render)
    log("done")


if __name__ == "__main__":
    main()
