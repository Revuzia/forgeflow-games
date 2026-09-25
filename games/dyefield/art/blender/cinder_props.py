"""DYEFIELD — CINDER REEF solids and props (CONTRACT_ART_P6_8 §16), for map_cinder.py.

Everything is authored in runtime/glTF coordinates (Y-up) and converted to Blender space with
common.g2b at the vertex. Solids that are unioned into the terrain come back as closed bmeshes whose
material_index follows the caller's material list; props come back as common.Geo buckets.
Deterministic: every jitter comes from common.rng(<authored id>, ...), and a mirrored brush keeps
its authored id as `_base`, so a rot180 partner gets the same jitter in its rotated frame.
"""
from __future__ import annotations

import math

import bmesh
from mathutils import Matrix, Vector

import common as C
from common import Geo


# ── 2D outline helpers (glTF x, z) ───────────────────────────────────────────────────────────────
def signed_area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
                     for i in range(len(pts)))


def vertex_normals(pts):
    """Outward unit normals (x, z) at the vertices of a closed polygon (miter-scaled)."""
    n = len(pts)
    s = 1.0 if signed_area(pts) > 0 else -1.0        # CCW (x right, z up) -> outward is (dz, -dx)
    en = []
    for i in range(n):
        (x0, z0), (x1, z1) = pts[i], pts[(i + 1) % n]
        dx, dz = x1 - x0, z1 - z0
        L = math.hypot(dx, dz) or 1.0
        en.append((s * dz / L, -s * dx / L))
    out = []
    for i in range(n):
        a, b = en[i - 1], en[i]
        mx, mz = a[0] + b[0], a[1] + b[1]
        L = math.hypot(mx, mz) or 1.0
        mx, mz = mx / L, mz / L
        cosh = max(0.35, mx * b[0] + mz * b[1])
        out.append((mx / cosh, mz / cosh))
    return out


def resample(pts, seg):
    out = []
    n = len(pts)
    for i in range(n):
        (x0, z0), (x1, z1) = pts[i], pts[(i + 1) % n]
        k = max(1, int(math.ceil(math.hypot(x1 - x0, z1 - z0) / seg)))
        for j in range(k):
            t = j / k
            out.append((x0 + (x1 - x0) * t, z0 + (z1 - z0) * t))
    return out


def _ring_faces(bm, rings, mats, caps=(True, True)):
    """Side quads between consecutive closed rings (lists of BMVerts, same length) + caps."""
    faces = []
    for r0, r1, mi in zip(rings[:-1], rings[1:], mats):
        n = len(r0)
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
            f.material_index = mi
            faces.append(f)
    return faces


def rock_prism_bm(outline, top, bottom, mat_index, seed, *, seg=1.4, jitter=0.2, bevel=0.14, batter_deg=6.0,
                  tilt=(0.0, 0.0), mid_jitter=0.09):
    """Faceted basalt block: jittered outline (glTF x, z), flat (optionally tilted) top with a chamfer,
    battered faceted sides down to `bottom`. Closed bmesh (Blender space)."""
    rnd = C.rng("rock", seed)
    P = resample(outline, seg) if seg else list(outline)
    N = vertex_normals(P)
    J = [rnd.uniform(-jitter, jitter) for _ in P]
    O = [(p[0] + n[0] * j, p[1] + n[1] * j) for p, n, j in zip(P, N, J)]
    N = vertex_normals(O)
    cx = sum(p[0] for p in O) / len(O)
    cz = sum(p[1] for p in O) / len(O)

    def ty(x, z):
        return top + tilt[0] * (x - cx) + tilt[1] * (z - cz)
    bat = math.tan(math.radians(batter_deg))
    h = top - bottom
    ymid = bottom + h * 0.55
    bm = bmesh.new()
    V = lambda x, y, z: bm.verts.new(C.g2b(x, y, z))  # noqa: E731
    # steep chamfer (~70 deg): it unwraps with the side facets instead of as a thin atlas strip
    r_top = [V(x - n[0] * bevel * 0.4, ty(x, z), z - n[1] * bevel * 0.4) for (x, z), n in zip(O, N)]
    r_ch = [V(x, ty(x, z) - bevel * 1.1, z) for (x, z), n in zip(O, N)]
    r_mid = []
    for (x, z), n in zip(O, N):
        o = bat * (top - ymid) + rnd.uniform(-mid_jitter, mid_jitter)
        r_mid.append(V(x + n[0] * o, ymid + rnd.uniform(-0.12, 0.12) * min(1.0, h / 2), z + n[1] * o))
    r_bot = [V(x + n[0] * bat * h, bottom, z + n[1] * bat * h) for (x, z), n in zip(O, N)]
    _ring_faces(bm, [r_bot, r_mid, r_ch, r_top], [mat_index] * 3)
    f = bm.faces.new(r_top)
    f.material_index = mat_index
    f = bm.faces.new(list(reversed(r_bot)))
    f.material_index = mat_index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def outcrop_outline(pos, radius, verts, seed):
    rnd = C.rng("outcrop", seed)
    out = []
    a0 = rnd.uniform(0, math.tau)
    for k in range(verts):
        a = a0 + math.tau * k / verts + rnd.uniform(-0.25, 0.25) * math.tau / verts
        r = radius * rnd.uniform(0.78, 1.15)
        out.append((r * math.cos(a), r * math.sin(a)))
    return out


def column_bm(x, z, r, top, bottom, mat_index, seed, chamfer=0.1):
    """Hexagonal basalt column (glTF centre x, z) with a chamfered top."""
    rnd = C.rng("col", seed)
    a0 = rnd.uniform(0, math.pi / 3)
    rr = r * rnd.uniform(0.94, 1.04)
    bm = bmesh.new()
    V = lambda x_, y_, z_: bm.verts.new(C.g2b(x_, y_, z_))  # noqa: E731
    ring = [(math.cos(a0 + k * math.pi / 3), math.sin(a0 + k * math.pi / 3)) for k in range(6)]
    tt = top + rnd.uniform(-0.02, 0.02)
    r_top = [V(x + c * (rr - chamfer * 0.35), tt, z + s * (rr - chamfer * 0.35)) for c, s in ring]
    r_ch = [V(x + c * rr, tt - chamfer, z + s * rr) for c, s in ring]
    r_bot = [V(x + c * rr * 1.03, bottom, z + s * rr * 1.03) for c, s in ring]
    _ring_faces(bm, [r_bot, r_ch, r_top], [mat_index] * 2)
    bm.faces.new(r_top).material_index = mat_index
    bm.faces.new(list(reversed(r_bot))).material_index = mat_index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def coral_bm(pos, size, yaw, ground_y, mat_index, seed):
    """Lumpy coral head (brain/boulder coral), sunk 35 % into the ground. Closed."""
    rnd = C.rng("coral", seed)
    bm = bmesh.new()
    verts = C.bm_icosphere(bm, 0.5, 2)
    ph = [rnd.uniform(0, math.tau) for _ in range(4)]
    for v in verts:
        d = v.co.normalized()
        bump = 1.0 + 0.10 * math.sin(7 * d.x + ph[0]) * math.cos(6 * d.y + ph[1]) + 0.07 * math.sin(11 * d.z + ph[2])
        v.co = d * 0.5 * bump
    sx, sy, sz = size
    m = C.place_matrix([pos[0], ground_y - sy * 0.35, pos[2]], yaw) @ Matrix.Translation((0, 0, sy * 0.5)) @ \
        Matrix.Diagonal((sx, sz, sy, 1.0))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    for f in bm.faces:
        f.material_index = mat_index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ── ribbons (bulwarks, rails) ────────────────────────────────────────────────────────────────────
def ribbon_bm(outer, inner, yb, yt, mat_index, closed=False, yfn=None):
    """Closed solid between an outer and an inner polyline (glTF x, z lists of equal length), from
    yb to yt (yfn(i) -> (yb, yt) overrides per station). Open runs get end caps."""
    bm = bmesh.new()
    n = len(outer)
    Ob, Ot, It, Ib = [], [], [], []
    for i in range(n):
        b, t = yfn(i) if yfn else (yb, yt)
        Ob.append(bm.verts.new(C.g2b(outer[i][0], b, outer[i][1])))
        Ot.append(bm.verts.new(C.g2b(outer[i][0], t, outer[i][1])))
        It.append(bm.verts.new(C.g2b(inner[i][0], t, inner[i][1])))
        Ib.append(bm.verts.new(C.g2b(inner[i][0], b, inner[i][1])))
    rng_ = range(n) if closed else range(n - 1)
    for i in rng_:
        j = (i + 1) % n
        for quad in ((Ob[i], Ob[j], Ot[j], Ot[i]), (Ot[i], Ot[j], It[j], It[i]), (It[i], It[j], Ib[j], Ib[i]),
                     (Ib[i], Ib[j], Ob[j], Ob[i])):
            bm.faces.new(quad).material_index = mat_index
    if not closed:
        bm.faces.new((Ob[0], Ot[0], It[0], Ib[0])).material_index = mat_index
        bm.faces.new((Ob[-1], Ib[-1], It[-1], Ot[-1])).material_index = mat_index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def box_bm(mn, mx, mat_index):
    """Axis-aligned box from glTF min/max."""
    bm = bmesh.new()
    C.bm_box(bm, (mn[0], -mx[2], mn[1]), (mx[0], -mn[2], mx[1]), mat_index)
    bm.normal_update()
    return bm


def oriented_prism_bm(profile_uv, center, u, v, n, depth, mat_index):
    """Prism: 2D profile in the (u, v) plane at `center`, extruded +-depth/2 along n (glTF vectors)."""
    bm = bmesh.new()
    c = Vector(center)
    u, v, n = Vector(u), Vector(v), Vector(n)
    rings = []
    for s in (-depth / 2, depth / 2):
        rings.append([bm.verts.new(C.g2b(*(c + u * a + v * b + n * s))) for (a, b) in profile_uv])
    _ring_faces(bm, rings, [mat_index])
    bm.faces.new(rings[0]).material_index = mat_index
    bm.faces.new(list(reversed(rings[1]))).material_index = mat_index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ── the wreck ────────────────────────────────────────────────────────────────────────────────────
# hull section: (half-width fraction, depth below the deck) from the deck edge down to the keel
SECTION = [(1.0, 0.0), (0.985, 0.8), (0.95, 1.7), (0.88, 2.6), (0.72, 3.5), (0.45, 4.2)]


class Wreck:
    """Double-ended rusted hull lying along local x (rot180-symmetric about its centre), deck at
    deckY, keel buried. Local (x, y, z) -> world via yaw about +Y and the centre."""

    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.L2 = float(cfg["halfLength"])
        self.B2 = float(cfg["beam"]) / 2
        self.deck = float(cfg["deckY"])
        self.keel = float(cfg["keelY"])
        self.center = Vector(cfg.get("center", [0, 0, 0]))
        yaw = math.radians(cfg.get("yaw", 0.0))
        self.cy, self.sy = math.cos(yaw), math.sin(yaw)

    def w(self, x):
        t = min(1.0, abs(x) / self.L2)
        return self.B2 * math.sqrt(max(0.0, 1.0 - t ** 2.4))

    def world(self, x, y, z):
        return (self.center.x + x * self.cy + z * self.sy, self.center.y + y, self.center.z - x * self.sy + z * self.cy)

    def stations(self):
        tip = self.L2 - 0.1
        xs = set()
        x = -tip
        while x < tip - 1e-6:
            xs.add(round(x, 4))
            x += 0.5 if abs(x) > 6.5 else 1.0
        xs.add(round(tip, 4))
        for g in self.cfg.get("gaps", []):
            xs.update(round(v, 4) for v in g["x"])
        t = self.cfg.get("tunnel")
        if t:
            xs.update((round(-t["halfX"], 4), round(t["halfX"], 4)))
        xs.update(round(-v, 4) for v in list(xs))            # rot180-symmetric station set
        return sorted(xs)

    def hull_bm(self, mi_side, mi_deck):
        xs = self.stations()
        bm = bmesh.new()
        rings = []
        for x in xs:
            w = max(self.w(x), 0.12)
            port = [(x, self.deck - dy, w * s) for (s, dy) in SECTION]
            keel = [(x, self.keel, 0.0)]
            star = [(x, self.deck - dy, -w * s) for (s, dy) in reversed(SECTION)]
            rings.append([bm.verts.new(C.g2b(*self.world(*p))) for p in port + keel + star])
        n = len(rings[0])
        for r0, r1 in zip(rings[:-1], rings[1:]):
            for i in range(n):
                j = (i + 1) % n
                f = bm.faces.new((r0[i], r0[j], r1[j], r1[i]))
                f.material_index = mi_deck if i == n - 1 else mi_side     # edge n-1 -> 0 is the deck chord
        bm.faces.new(rings[0]).material_index = mi_side
        bm.faces.new(list(reversed(rings[-1]))).material_index = mi_side
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm

    def perimeter(self, inset=0.0):
        """Deck-edge loop (local x, z): port side west -> east, then starboard east -> west."""
        xs = self.stations()
        port = [(x, max(self.w(x), 0.12) - inset) for x in xs]
        star = [(x, -(max(self.w(x), 0.12) - inset)) for x in reversed(xs)]
        return port + star

    def bulwark_bms(self, mi):
        cfg = self.cfg["bulwark"]
        H, T = float(cfg["height"]), float(cfg["thick"])
        outer = self.perimeter(0.03)
        inner_n = vertex_normals(outer)
        inner = [(x - n[0] * T, z - n[1] * T) for (x, z), n in zip(outer, inner_n)]
        gaps = self.cfg.get("gaps", [])

        def in_gap(a, b):
            mx, mz = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            for g in gaps:
                side = 1 if g["side"] == "+z" else -1
                if mz * side > 0 and g["x"][0] - 1e-6 <= mx <= g["x"][1] + 1e-6:
                    return True
            return False
        n = len(outer)
        cut = [in_gap(outer[i], outer[(i + 1) % n]) for i in range(n)]
        if not any(cut):
            runs = [list(range(n))]
            closed = True
        else:
            closed = False
            start = cut.index(True) + 1
            runs, cur = [], []
            for k in range(n):
                i = (start + k) % n
                cur.append(i)
                if cut[i]:
                    if len(cur) > 1:
                        runs.append(cur)
                    cur = []
            if len(cur) > 1:
                runs.append(cur)
        sheer = float(cfg.get("sheer", 0.0))
        out = []
        for run in runs:
            O = [self.world(outer[i][0], 0, outer[i][1]) for i in run]
            I = [self.world(inner[i][0], 0, inner[i][1]) for i in run]
            # sheer: the rail sweeps up toward both (identical) ends - the ship silhouette from the beach
            ys = [(self.deck - 0.12, self.deck + H + sheer * (abs(outer[i][0]) / self.L2) ** 3) for i in run]
            out.append(ribbon_bm([(p[0], p[2]) for p in O], [(p[0], p[2]) for p in I], self.deck - 0.12,
                                 self.deck + H, mi, closed=closed, yfn=lambda k, ys=ys: ys[k]))
        return out

    def stems(self, mi):
        """Raked stem posts at both tips (the double-ended hull's bow and stern), rot180 partners."""
        out = []
        tip = self.L2 - 0.1
        H = float(self.cfg["bulwark"]["height"]) + float(self.cfg["bulwark"].get("sheer", 0.0))
        for sx in (1, -1):
            prof = [(-0.2, -0.6), (0.18, -0.6), (0.62, H + 1.2), (0.3, H + 1.35)]
            prof = [(a * sx, b) for (a, b) in prof]
            c = Vector(self.world(sx * (tip - 0.15), self.deck, 0.0))
            wu = Vector(self.world(1, 0, 0)) - Vector(self.world(0, 0, 0))
            wn = Vector(self.world(0, 0, 1)) - Vector(self.world(0, 0, 0))
            out.append(oriented_prism_bm(prof, c, wu, (0, 1, 0), wn, 0.34, mi))
        return out

    def bulwark_hole_cutters(self, mi, holes):
        """Rust holes through the bulwark: holes = [(x, side), ...] (side +1 port / -1 starboard);
        every hole also gets its rot180 partner (-x, -side)."""
        cfg = self.cfg["bulwark"]
        H = float(cfg["height"])
        allh = []
        for (x, side) in holes:
            allh += [(x, side), (-x, -side)]
        out = []
        for k, (x, side) in enumerate(allh):
            rnd = C.rng("hole", abs(x), abs(side), round(x * side, 3))
            w0 = self.w(x) - 0.03 - float(cfg["thick"]) / 2
            dx = 0.05
            slope = (self.w(x + dx) - self.w(x - dx)) / (2 * dx) * side
            t = Vector((1.0, 0.0, slope)).normalized()
            nrm = Vector((-t.z, 0.0, t.x)) * (1 if side > 0 else -1)
            nrm = Vector((nrm.x, 0, nrm.z)).normalized()
            c = Vector((x, self.deck + H * 0.55, w0 * side))
            prof = []
            for j in range(7):
                a = math.tau * j / 7 + rnd.uniform(-0.2, 0.2)
                r = rnd.uniform(0.8, 1.1)
                prof.append((0.42 * r * math.cos(a), 0.24 * r * math.sin(a)))
            # rot180 partner = the same profile rotated with the hull (u, n flip; v stays up)
            wc = Vector(self.world(*c))
            wu = Vector(self.world(*(c + t))) - wc
            wn = Vector(self.world(*(c + nrm))) - wc
            if side < 0:
                prof = [(-a, b) for (a, b) in prof]
            out.append(oriented_prism_bm(prof, wc, wu, (0, 1, 0), wn, 1.2, mi))
        return out

    def tunnel_cutter(self, mi):
        """Walk-through breach under the deck amidships: a torn-topped prism across the whole beam.
        The profile is x-symmetric, so the cutter is rot180-symmetric about the hull centre."""
        t = self.cfg["tunnel"]
        hx, sill, top = float(t["halfX"]), float(t["sill"]), float(t["top"])
        right = [(hx, sill), (hx + 0.05, sill + 0.9), (hx - 0.08, top - 0.35), (hx - 0.45, top), (hx * 0.45, top - 0.16),
                 (0.0, top + 0.08)]
        pts = [(-hx, sill)] + right + [(-x, y) for (x, y) in reversed(right[1:-1])]
        c = Vector(self.world(0, 0, 0))
        wu = Vector(self.world(1, 0, 0)) - c
        wn = Vector(self.world(0, 0, 1)) - c
        return oriented_prism_bm(pts, c, wu, (0, 1, 0), wn, 2 * self.B2 + 3.0, mi)

    def house_bms(self, mi_side, mi_deck):
        h = self.cfg["house"]
        hx, hz, wall, H, door = (float(h[k]) for k in ("halfX", "halfZ", "wall", "height", "door"))
        d = self.deck
        boxes = [
            ([-hx, d - 0.1, hz - wall], [hx, d + H, hz]),
            ([-hx, d - 0.1, -hz], [hx, d + H, -hz + wall]),
        ]
        for sx in (-1, 1):
            x0, x1 = (hx - wall, hx) if sx > 0 else (-hx, -hx + wall)
            boxes += [([x0, d - 0.1, -hz + wall], [x1, d + H, -door]), ([x0, d - 0.1, door], [x1, d + H, hz - wall]),
                      ([x0, d + 2.0, -door], [x1, d + H, door])]
        out = []
        for mn, mx in boxes:
            out.append(self._local_box(mn, mx, mi_side))
        roof = self._local_box([-hx - 0.25, d + H, -hz - 0.25], [hx + 0.25, d + H + 0.22, hz + 0.25], mi_side)
        for f in roof.faces:
            if f.normal.z > 0.5:
                f.material_index = mi_deck
        out.append(roof)
        return out

    def house_window_cutters(self, mi):
        """Two windows through each long (+-z) wall of the wheelhouse (shoot-through)."""
        h = self.cfg["house"]
        hz, wall = float(h["halfZ"]), float(h["wall"])
        out = []
        for sz in (-1, 1):
            z0, z1 = (hz - wall - 0.2, hz + 0.2) if sz > 0 else (-hz - 0.2, -hz + wall + 0.2)
            for x in (-1.05, 1.05):
                out.append(self._local_box([x - 0.45, self.deck + 1.05, z0], [x + 0.45, self.deck + 1.65, z1], mi))
        return out

    def _local_box(self, mn, mx, mi):
        bm = bmesh.new()
        xs, ys, zs = (mn[0], mx[0]), (mn[1], mx[1]), (mn[2], mx[2])
        vs = {}
        for i in (0, 1):
            for j in (0, 1):
                for k in (0, 1):
                    vs[i, j, k] = bm.verts.new(C.g2b(*self.world(xs[i], ys[j], zs[k])))
        for quad in (((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)), ((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)),
                     ((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)), ((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)),
                     ((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)), ((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))):
            bm.faces.new([vs[q] for q in quad]).material_index = mi
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        return bm

    def masts(self):
        """(solid Geo: masts + yards + bands, deco Geo: rigging, [mast-top glTF points]). The masts
        with x < 0 are built; each gets its exact rot180 partner (Blender: 180 deg about Z)."""
        solid, rig = Geo("masts"), Geo("rigging")
        tops = []
        R180 = Matrix.Rotation(math.pi, 4, "Z")
        cb = C.g2b(*self.center)
        about = Matrix.Translation(cb) @ R180 @ Matrix.Translation(-cb)
        for m in self.cfg.get("masts", []):
            x, H = float(m["x"]), float(m["height"])
            if x >= 0:
                continue
            base = Vector(self.world(x, self.deck, 0.0))
            tilt = Matrix.Rotation(math.radians(-6.0), 4, "Y")             # leans outward (toward -x)
            M = Matrix.Translation(C.g2b(*base)) @ Matrix.Rotation(math.atan2(self.sy, self.cy), 4, "Z") @ tilt
            mbm = bmesh.new()
            C.bm_cylinder(mbm, 0.2, 0.15, -0.3, H, seg=10)
            C.bm_cylinder(mbm, 0.26, 0.26, H * 0.62, H * 0.66, seg=10)
            yard_z = H * 0.72
            C.bm_tube(mbm, [Vector((0, -2.1, yard_z)), Vector((0, 2.1, yard_z))], 0.09, seg=6)
            rbm = bmesh.new()
            for sx in (-2.6, 2.6):
                for sz in (-1, 1):
                    lx = x + sx
                    lz = sz * (max(self.w(lx), 0.12) - 0.12)
                    foot = C.g2b(*self.world(lx, self.deck + 0.9, lz))
                    C.bm_tube(rbm, [M @ Vector((0, 0, H * 0.95)), foot], 0.025, seg=5)
            for sy in (-1, 1):
                yard_end = M @ Vector((0, 2.1 * sy, yard_z))
                lz = sy * -(max(self.w(x), 0.12) - 0.1)
                foot = C.g2b(*self.world(x, self.deck + 0.9, lz))
                C.bm_tube(rbm, [yard_end, foot], 0.022, seg=5)
            for mat in (M, about @ M):
                solid.add_bm(mbm, "M_wreck", matrix=mat, smooth=True)
                tops.append(C.b2g(mat @ Vector((0, 0, H))))
            rig.add_bm(rbm, "M_rope", smooth=True)
            rig.add_bm(rbm, "M_rope", matrix=about, smooth=True)
            mbm.free()
            rbm.free()
        return solid, rig, tops


# ── bridges ──────────────────────────────────────────────────────────────────────────────────────
def bridge_parts(bid, p0, p1, width, arch, seabed_y, mi_plank, thick=0.22, post_every=2.7, rail_h=1.0):
    """Plank bridge p0 -> p1 (glTF [x, y, z] deck-top ends). Returns dict of
    deck (bmesh: top/sides M_plank, bottom/caps flagged by normal later), posts (Geo), ropes (Geo),
    rails (Geo boxes for col_), profile(t) -> (x, y, z) of the deck top centreline."""
    x0, y0, z0 = p0
    x1, y1, z1 = p1
    L = math.hypot(x1 - x0, z1 - z0)
    ux, uz = (x1 - x0) / L, (z1 - z0) / L
    vx, vz = -uz, ux
    n = max(4, int(math.ceil(L / 0.8)))

    def P(t, off=0.0, dy=0.0):
        y = y0 + (y1 - y0) * t + arch * math.sin(math.pi * t)
        return (x0 + (x1 - x0) * t + vx * off, y + dy, z0 + (z1 - z0) * t + vz * off)
    hw = width / 2
    bm = bmesh.new()
    rows = []
    for i in range(n + 1):
        t = i / n
        rows.append([bm.verts.new(C.g2b(*P(t, o, dy))) for (o, dy) in ((-hw, 0), (hw, 0), (hw, -thick), (-hw, -thick))])
    for r0, r1 in zip(rows[:-1], rows[1:]):
        for a in range(4):
            b = (a + 1) % 4
            bm.faces.new((r0[a], r0[b], r1[b], r1[a])).material_index = mi_plank
    bm.faces.new(rows[0]).material_index = mi_plank
    bm.faces.new(list(reversed(rows[-1]))).material_index = mi_plank
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    posts, ropes, rails = Geo("posts"), Geo("ropes"), Geo("rails")
    npost = max(2, int(round(L / post_every)) + 1)
    tops = {-1: [], 1: []}
    pb = bmesh.new()
    for k in range(npost):
        t = k / (npost - 1)
        for s in (-1, 1):
            cx, cy, cz = P(t, s * (hw + 0.13))
            bot = seabed_y
            C.bm_oriented_box(pb, C.g2b(cx, (bot + cy + rail_h) / 2, cz), (0.2, 0.2, cy + rail_h - bot),
                              Matrix.Rotation(math.atan2(-uz, ux), 3, "Z"))
            tops[s].append(Vector(C.g2b(cx, cy + rail_h - 0.05, cz)))
    posts.add_bm(pb, "M_plank")
    pb.free()
    rb = bmesh.new()
    for s in (-1, 1):
        for drop in (0.0, 0.45):
            for a, b in zip(tops[s][:-1], tops[s][1:]):
                pts = []
                for j in range(7):
                    u = j / 6
                    p = a.lerp(b, u)
                    p.z -= drop + 0.14 * math.sin(math.pi * u)
                    pts.append(p)
                C.bm_tube(rb, pts, 0.035, seg=6, cap=False)
    ropes.add_bm(rb, "M_rope", smooth=True)
    rb.free()
    cb = bmesh.new()
    for s in (-1, 1):
        for i in range(n):
            ta, tb = i / n, (i + 1) / n
            a, b = P(ta, s * (hw + 0.1)), P(tb, s * (hw + 0.1))
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
            seg_len = math.dist(a, b) + 0.02
            ang = math.atan2(b[1] - a[1], math.hypot(b[0] - a[0], b[2] - a[2]))
            R = Matrix.Rotation(math.atan2(-uz, ux), 3, "Z") @ Matrix.Rotation(-ang, 3, "Y")
            C.bm_oriented_box(cb, C.g2b(mid[0], mid[1] + rail_h / 2, mid[2]), (seg_len, 0.16, rail_h), R)
    rails.add_bm(cb, "M_plank")
    cb.free()
    return {"deck": bm, "posts": posts, "ropes": ropes, "rails": rails, "profile": P, "length": L}


# ── tide-spring pad ──────────────────────────────────────────────────────────────────────────────
def spring_pad(pos, ground_y, radius=1.05):
    """(pad Geo M_spring - the spring_ trigger surface, rim Geo M_basalt/M_coral_rock - solid).
    Pad top at ground + 0.2; the rim ring top at ground + 0.12."""
    pad, rim = Geo("spring"), Geo("spring_rim")
    m = C.place_matrix([pos[0], ground_y, pos[2]], 0.0)
    bm = bmesh.new()
    prof = [(0.0, 0.2), (radius * 0.55, 0.2), (radius * 0.62, 0.23), (radius * 0.7, 0.2), (radius - 0.06, 0.2),
            (radius, 0.15), (radius, -0.35)]
    C.bm_lathe(bm, prof, seg=28)
    pad.add_bm(bm, "M_spring", matrix=m)
    bm.free()
    rb = bmesh.new()
    prof2 = [(radius, 0.12), (radius + 0.12, 0.14), (radius + 0.32, 0.1), (radius + 0.48, 0.02), (radius + 0.52, -0.3)]
    C.bm_lathe(rb, prof2, seg=28, closed_center=False)
    rim.add_bm(rb, "M_coral_rock", matrix=m)
    rb.free()
    return pad, rim


def launch_velocity(start, target, apex, g=15.0):
    """df_launch [vx, vy, vz] so a runner leaving `start` (feet) peaks at world y `apex` and comes
    down through `target` (feet). Returns (vel, flight_time)."""
    sx, sy, sz = start
    tx, ty, tz = target
    if apex <= max(sy, ty):
        raise ValueError(f"apex {apex} must be above start {sy} and target {ty}")
    vy = math.sqrt(2 * g * (apex - sy))
    t = (vy + math.sqrt(vy * vy - 2 * g * (ty - sy))) / g
    return [(tx - sx) / t, vy, (tz - sz) / t], t


# ── deco assets ──────────────────────────────────────────────────────────────────────────────────
def driftwood(length, seed, height_fn, pos, yaw):
    """A bleached log lying on the sand (world Geo): bent tube + two broken branch stubs + a root
    flare. height_fn(x, z) -> ground y (glTF)."""
    rnd = C.rng("log", seed)
    g = Geo("driftwood")
    a = math.radians(yaw)
    fx, fz = math.sin(a), math.cos(a)
    sx, sz = fz, -fx
    r0 = rnd.uniform(0.26, 0.32)
    pts, radii = [], []
    N = 9
    for i in range(N):
        s = (i / (N - 1) - 0.5) * length
        bend = 0.25 * math.sin(math.pi * i / (N - 1)) * rnd.choice((-1, 1))
        x = pos[0] + fx * s + sx * bend
        z = pos[2] + fz * s + sz * bend
        r = r0 * (1.0 - 0.35 * i / (N - 1)) * (1.25 if i == 0 else 1.0)
        pts.append(C.g2b(x, height_fn(x, z) + r * 0.62, z))
        radii.append(r)
    bm = bmesh.new()
    C.bm_tube(bm, pts, r0, seg=9, radii=radii)
    for k in (3, 6):
        p = pts[k]
        d = Vector((sx, -sz, 0)) * (1 if k == 3 else -1) + Vector((0, 0, 0.6))
        C.bm_tube(bm, [p, p + d.normalized() * rnd.uniform(0.55, 0.8)], radii[k] * 0.38, seg=6)
    g.add_bm(bm, "M_driftwood", smooth=True)
    bm.free()
    return g


def kelp_pile(seed, height_fn, pos, yaw, scale=1.0):
    """Washed-up kelp: flat wavy ribbons + float bulbs lying on the sand (world Geo, deco)."""
    rnd = C.rng("kelp", seed)
    g = Geo("kelp")
    bm = bmesh.new()
    for k in range(rnd.randint(6, 9)):
        a = math.radians(yaw) + rnd.uniform(-1.2, 1.2)
        L = rnd.uniform(1.4, 2.6) * scale
        ox, oz = rnd.uniform(-0.5, 0.5) * scale, rnd.uniform(-0.5, 0.5) * scale
        w = rnd.uniform(0.09, 0.16) * scale
        ph = rnd.uniform(0, math.tau)
        left, right = [], []
        N = 10
        for i in range(N + 1):
            s = i / N
            px = pos[0] + ox + math.sin(a) * (s - 0.5) * L + math.cos(a) * 0.25 * math.sin(ph + s * 7)
            pz = pos[2] + oz + math.cos(a) * (s - 0.5) * L - math.sin(a) * 0.25 * math.sin(ph + s * 7)
            y = height_fn(px, pz) + 0.03 + 0.02 * k
            nx, nz = math.cos(a), -math.sin(a)
            ww = w * (0.6 + 0.4 * math.sin(math.pi * s))
            left.append(bm.verts.new(C.g2b(px + nx * ww, y, pz + nz * ww)))
            right.append(bm.verts.new(C.g2b(px - nx * ww, y, pz - nz * ww)))
        for i in range(N):
            bm.faces.new((left[i], right[i], right[i + 1], left[i + 1]))
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    g.add_bm(bm, "M_kelp")
    bm.free()
    bb = bmesh.new()
    for k in range(rnd.randint(4, 7)):
        px = pos[0] + rnd.uniform(-0.8, 0.8) * scale
        pz = pos[2] + rnd.uniform(-0.8, 0.8) * scale
        C.bm_icosphere(bb, rnd.uniform(0.07, 0.11), 1, Matrix.Translation(C.g2b(px, height_fn(px, pz) + 0.06, pz)))
    g.add_bm(bb, "M_kelp", smooth=True)
    bb.free()
    return g


def sea_stack(seed, pos, radius, height, water_y):
    """Columnar-basalt sea stack (deco): a cluster of hexagonal columns stepping down from a tall core,
    the same grammar as the spawn cliffs."""
    g = Geo("seastack")
    rnd = C.rng("stack", seed)
    r = radius * 0.34
    pts = [(0.0, 0.0, height)]
    for ring, (dist, hf) in enumerate(((1.7, 0.78), (3.3, 0.5), (4.8, 0.26))):
        n = 6 * (ring + 1)
        a0 = rnd.uniform(0, math.tau)
        for k in range(n):
            if rnd.random() < 0.25 * ring:
                continue
            a = a0 + math.tau * k / n
            d = dist * r * rnd.uniform(0.92, 1.08)
            pts.append((d * math.cos(a), d * math.sin(a), height * hf * rnd.uniform(0.8, 1.15)))
    for k, (x, z, h) in enumerate(pts):
        cb = column_bm(pos[0] + x, pos[2] + z, r * rnd.uniform(0.9, 1.1), water_y + h, water_y - 3.0, 0, f"{seed}_{k}",
                       chamfer=0.14)
        g.add_bm(cb, "M_basalt")
        cb.free()
    return g


def lantern_post(ground, height=2.4):
    """A leaning driftwood post with a hanging lantern (Geo pair: wood solid, glowing lantern deco)."""
    wood, glow = Geo("lantern_post"), Geo("lantern")
    bm = bmesh.new()
    C.bm_cylinder(bm, 0.11, 0.09, -0.3, height, seg=8)
    C.bm_tube(bm, [Vector((0, 0, height - 0.15)), Vector((0, -0.55, height - 0.05))], 0.05, seg=6)
    wood.add_bm(bm, "M_driftwood", smooth=True)
    bm.free()
    lb = bmesh.new()
    C.bm_box(lb, (-0.14, -0.69, height - 0.62), (0.14, -0.41, height - 0.28))
    glow.add_bm(lb, "M_lamp")
    lb.free()
    fb = bmesh.new()
    C.bm_box(fb, (-0.17, -0.72, height - 0.28), (0.17, -0.38, height - 0.22))
    C.bm_box(fb, (-0.17, -0.72, height - 0.66), (0.17, -0.38, height - 0.6))
    wood.add_bm(fb, "M_metal")
    fb.free()
    return wood, glow, Vector((0, -0.55, height - 0.45))
