"""DYEFIELD — CINDER REEF terrain: a rot180-symmetric wet-sand heightfield (CONTRACT_ART_P6_8 §16).

Pure numpy (runs outside Blender too, for the route checker) + bmesh for the mesh. The height at glTF (x, z) is the MAX over every sand feature in the expanded
brush list (mirror copies included, so the field is symmetric by construction), then small
symmetric dune ripples, then 'flat' beds (the wreck bed), then 'dune' ramps (maxed so a ramp can
climb onto a basalt shelf or the wreck deck), then the 'over' flats (bridge heads, spring pads).

Feature brushes (glTF coordinates; 'points' / 'pos' / 'dir' are mirrored by the pipeline):
  land     points [[x, _, z], ...]  the COAST polygon (waterline). pos [x, H, z] + dir [gx, 0, gz]
           give the plateau height H(p) = pos.y + dot(dir, p - pos), clamped to 'clamp' [lo, hi].
           wIn = coast -> plateau run (m), wOut = coast -> channel bed run (m), coastNoise (m).
  sandbar  points [[x, crest_y, z], ...] polyline; hw = crest half-width, coastW = crest edge ->
           waterline run, wOut = waterline -> bed run.
  dune     points [[x0, y0, z0], [x1, y1, z1]] ramp axis low -> high; hw = flat half-width,
           side = flank slope (deg). Ends are rounded (the axis distance is clamped).
  flat     pos [x, H, z] + r (+ fall) disc, or points polygon + H: the terrain is forced to H inside
           and blends back to the natural field over 'fall' metres. "over": true applies it AFTER the
           dunes (bridge heads, spring pads); otherwise before them (the wreck bed under a dune).
Profiles: inside a coast the sand rises W -> H with an ease-out (steepest at the waterline);
outside it drops W -> bed with an ease-out (a steep underwater bank: wading past the waterline
slides you into the deep channel's oob_ volume).
"""
from __future__ import annotations

import math

import numpy as np


# ── symmetric value noise ────────────────────────────────────────────────────────────────────────
class Noise:
    """Deterministic 2D value noise (seeded permutation lattice, quintic fade)."""

    def __init__(self, seed: int):
        r = np.random.RandomState(seed & 0x7FFFFFFF)
        self.perm = np.concatenate([r.permutation(256)] * 2).astype(np.int64)
        self.vals = r.uniform(-1.0, 1.0, 256)

    def _h(self, ix, iz):
        return self.vals[self.perm[(self.perm[ix & 255] + iz) & 255]]

    def __call__(self, x, z, freq):
        x = np.asarray(x, np.float64) * freq
        z = np.asarray(z, np.float64) * freq
        x0, z0 = np.floor(x), np.floor(z)
        fx, fz = x - x0, z - z0
        ix, iz = x0.astype(np.int64), z0.astype(np.int64)
        u = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
        v = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
        a = self._h(ix, iz)
        b = self._h(ix + 1, iz)
        c = self._h(ix, iz + 1)
        d = self._h(ix + 1, iz + 1)
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v

    def sym(self, x, z, freq, octaves=1):
        """rot180-symmetric fBm: n(p) + n(-p), normalised to roughly [-1, 1]."""
        out = np.zeros(np.broadcast(np.asarray(x), np.asarray(z)).shape)
        amp, f, tot = 1.0, freq, 0.0
        for _ in range(octaves):
            out += amp * (self(x, z, f) + self(-np.asarray(x), -np.asarray(z), f)) * 0.5
            tot += amp
            amp *= 0.5
            f *= 2.03
        return out / tot * 1.6


# ── 2D distance helpers (vectorised over points) ─────────────────────────────────────────────────
def poly_sd(px, pz, poly):
    """Signed distance of points to a closed polygon (negative inside). poly: (M, 2) glTF (x, z)."""
    x = px[..., None]
    z = pz[..., None]
    ax, az = poly[:, 0], poly[:, 1]
    bx, bz = np.roll(ax, -1), np.roll(az, -1)
    ex, ez = bx - ax, bz - az
    wx, wz = x - ax, z - az
    t = np.clip((wx * ex + wz * ez) / (ex * ex + ez * ez), 0.0, 1.0)
    dx, dz = wx - ex * t, wz - ez * t
    d = np.sqrt((dx * dx + dz * dz).min(-1))
    with np.errstate(divide="ignore", invalid="ignore"):
        xc = ax + (bx - ax) * (z - az) / np.where(np.abs(bz - az) < 1e-12, 1e-12, bz - az)
    cond = ((az > z) != (bz > z)) & (x < xc)
    inside = (cond.sum(-1) % 2) == 1
    return np.where(inside, -d, d)


def polyline_closest(px, pz, pts):
    """Distance to an open polyline and the interpolated per-vertex value at the closest point.
    pts: (M, 3) rows [x, value, z]. Returns (d, value)."""
    x = px[..., None]
    z = pz[..., None]
    ax, av, az = pts[:-1, 0], pts[:-1, 1], pts[:-1, 2]
    bx, bv, bz = pts[1:, 0], pts[1:, 1], pts[1:, 2]
    ex, ez = bx - ax, bz - az
    wx, wz = x - ax, z - az
    t = np.clip((wx * ex + wz * ez) / (ex * ex + ez * ez), 0.0, 1.0)
    dx, dz = wx - ex * t, wz - ez * t
    dd = dx * dx + dz * dz
    k = dd.argmin(-1)
    d = np.sqrt(np.take_along_axis(dd, k[..., None], -1)[..., 0])
    tk = np.take_along_axis(t, k[..., None], -1)[..., 0]
    val = av[k] + (bv[k] - av[k]) * tk
    return d, val


def ease_out(t):
    t = np.clip(t, 0.0, 1.0)
    return 1.0 - (1.0 - t) ** 2


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ── the field ────────────────────────────────────────────────────────────────────────────────────
class Terrain:
    def __init__(self, brushes, water_y: float, bed_y: float, seed: int = 0x51D3, ripple: float = 0.07):
        self.W = float(water_y)
        self.bed = float(bed_y)
        self.lands = [b for b in brushes if b["kind"] == "land"]
        self.bars = [b for b in brushes if b["kind"] == "sandbar"]
        self.dunes = [b for b in brushes if b["kind"] == "dune"]
        self.flats = [b for b in brushes if b["kind"] == "flat"]
        self.noise = Noise(seed)
        self.noise2 = Noise(seed * 7 + 3)
        self.ripple = ripple

    def height(self, X, Z):
        X = np.asarray(X, np.float64)
        Z = np.asarray(Z, np.float64)
        W, bed = self.W, self.bed
        h = np.full(X.shape, bed)
        for b in self.lands:
            poly = np.array([[p[0], p[2]] for p in b["points"]], np.float64)
            sd = poly_sd(X, Z, poly)
            amp = float(b.get("coastNoise", 0.8))
            if amp:
                sd = sd + amp * self.noise.sym(X, Z, 0.11, 2)
            px, py, pz = b["pos"]
            gx, _, gz = b.get("dir", [0.0, 0.0, 0.0])
            H = py + gx * (X - px) + gz * (Z - pz)
            lo, hi = b.get("clamp", [-1e9, 1e9])
            H = np.clip(H, lo, hi)
            w_in, w_out = float(b.get("wIn", 3.0)), float(b.get("wOut", 3.5))
            hin = W + (H - W) * ease_out(-sd / w_in)
            hout = W - (W - bed) * ease_out(sd / w_out)
            h = np.maximum(h, np.where(sd < 0, hin, hout))
        for b in self.bars:
            pts = np.array(b["points"], np.float64)
            d, crest = polyline_closest(X, Z, pts)
            hw, cw, w_out = float(b.get("hw", 1.4)), float(b.get("coastW", 0.9)), float(b.get("wOut", 3.0))
            d = d + float(b.get("edgeNoise", 0.25)) * self.noise2.sym(X, Z, 0.35, 1)
            e = d - hw
            hin = crest + (W - crest) * (1.0 - ease_out(1.0 - np.clip(e / cw, 0, 1)))   # crest -> W
            hout = W - (W - bed) * ease_out((e - cw) / w_out)
            hb = np.where(e <= 0, crest, np.where(e <= cw, hin, hout))
            h = np.maximum(h, hb)
        # dune ripples on dry sand (symmetric, faded out toward the waterline)
        if self.ripple:
            dry = smoothstep(W + 0.15, W + 0.6, h)
            h = h + dry * self.ripple * self.noise.sym(X * 0.6 + Z * 0.8, Z * 0.6 - X * 0.8, 0.45, 2)
        for b in self.flats:
            if not b.get("over"):
                h = self._flat(b, X, Z, h)
        for b in self.dunes:
            (x0, y0, z0), (x1, y1, z1) = b["points"][0], b["points"][1]
            ex, ez = x1 - x0, z1 - z0
            L2 = ex * ex + ez * ez
            t = np.clip(((X - x0) * ex + (Z - z0) * ez) / L2, 0.0, 1.0)
            cx, cz = x0 + ex * t, z0 + ez * t
            dp = np.hypot(X - cx, Z - cz)
            Hax = y0 + (y1 - y0) * t
            hw = float(b.get("hw", 1.8))
            side = math.tan(math.radians(float(b.get("side", 30.0))))
            hd = Hax - np.maximum(dp - hw, 0.0) * side
            h = np.maximum(h, hd)
        for b in self.flats:                  # "over": bridge heads / spring pads win over dune flanks
            if b.get("over"):
                h = self._flat(b, X, Z, h)
        return h

    @staticmethod
    def _flat(b, X, Z, h):
        if "points" in b:
            poly = np.array([[p[0], p[2]] for p in b["points"]], np.float64)
            d = np.maximum(poly_sd(X, Z, poly), 0.0)
            H = float(b["H"])
        else:
            px, H, pz = b["pos"]
            d = np.maximum(np.hypot(X - px, Z - pz) - float(b["r"]), 0.0)
        f = smoothstep(0.0, float(b.get("fall", 1.6)), d)
        return H * (1 - f) + h * f

    def at(self, x: float, z: float) -> float:
        return float(self.height(np.array([x]), np.array([z]))[0])


# ── mesh ────────────────────────────────────────────────────────────────────────────────────────
def terrain_solid_bm(T: Terrain, half_x: float, half_z: float, step: float, bottom: float, mat_index: int = 0):
    """Closed heightfield solid in Blender space: top triangles (diagonal along the smaller height
    change, rot180-symmetric on the symmetric grid), vertical skirts, flat bottom at `bottom`."""
    import bmesh                      # Blender-only (the height field itself runs in plain python)
    import common as C
    nx = int(round(2 * half_x / step)) + 1
    nz = int(round(2 * half_z / step)) + 1
    xs = np.linspace(-half_x, half_x, nx)
    zs = np.linspace(-half_z, half_z, nz)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    H = T.height(X, Z)
    bm = bmesh.new()
    top = [[bm.verts.new(C.g2b(float(xs[i]), float(H[i, j]), float(zs[j]))) for j in range(nz)] for i in range(nx)]
    for i in range(nx - 1):
        for j in range(nz - 1):
            a, b, c, d = top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]
            # glTF (x, z) -> Blender (x, -z): the quad a(i,j) b(i+1,j) c(i+1,j+1) d(i,j+1) is CW
            # seen from above in Blender, so wind it reversed for +Z normals
            if abs(H[i, j] - H[i + 1, j + 1]) <= abs(H[i + 1, j] - H[i, j + 1]) + 1e-9:
                tris = ((a, d, c), (a, c, b))
            else:
                tris = ((a, d, b), (b, d, c))
            for tr in tris:
                f = bm.faces.new(tr)
                f.material_index = mat_index
    # boundary loop (i, j) around the grid, then skirts + bottom
    loop = [top[i][0] for i in range(nx)] + [top[nx - 1][j] for j in range(1, nz)] + \
           [top[i][nz - 1] for i in range(nx - 2, -1, -1)] + [top[0][j] for j in range(nz - 2, 0, -1)]
    low = [bm.verts.new((v.co.x, v.co.y, bottom)) for v in loop]
    n = len(loop)
    for k in range(n):
        m = (k + 1) % n
        f = bm.faces.new((loop[k], low[k], low[m], loop[m]))
        f.material_index = mat_index
    f = bm.faces.new(low)
    f.material_index = mat_index
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm, (xs, zs, H)
