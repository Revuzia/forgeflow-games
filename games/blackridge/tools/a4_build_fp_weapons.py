# tools/a4_build_fp_weapons.py [A4] — FP weapon GLB generator (the $0 spike,
# BUILD_PLAN Part 4 "FP weapons (hero gap)" option (a)+(b) hybrid).
#
# Run INSIDE Blender headless:
#   "C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -b
#       --factory-startup -noaudio --python tools/a4_build_fp_weapons.py -- [ids...]
#
# Pipeline per weapon (fix-the-generator: every asset decision lives HERE):
#   1. import last-circle Meshy base (wpn_ar/smg/sniper/pistol — original IP,
#      CREDITS.md), kill the Meshy emissive-as-albedo export bug;
#   2. normalize: muzzle -X -> Blender +Y (glTF -Z on export), real-world
#      length, origin at the GRIP, centerline x=0;
#   3. geometry repair (sniper: weld the detached stock);
#   4. authored dressing: rail strips, CRISP iron sights on the x=0 plane
#      with the post top at EXACTLY the chosen sight height (pixel-exact ADS
#      alignment is by construction), muzzle devices, suppressor (vesper),
#      foregrips, ejection-port plate;
#   5. material replacement: the Meshy lime albedo is unusable at FP range —
#      authored PBR set generated procedurally (numpy value-noise albedo
#      mottle + ORM w/ roughness VARIANCE + Sobel normal — VT §3: uniform
#      roughness is THE amateur tell);
#   6. rig-cut arms: soldier.glb posed (finger curl) via its armature, then
#      hands+forearms cut by a PLANAR HALF-SPACE BISECT perpendicular to the
#      forearm bone axis (never by skin-weight threshold — that tears the shell;
#      see the W1 iter03 note in build_arm_chunks), capped, cuffed, decimated,
#      glove-tinted, placed per weapon;
#   7. SOCKET_muzzle / SOCKET_eject empties baked;
#   8. export GLB (+ separate gltf-transform webp+draco pass, see
#      a4_compress.sh printed at the end) and render judgment previews
#      (hip / ADS-alignment / closeup) to _shots/a4_fp/.
#
# The chosen view constants (grip origin, sight height, muzzle/eject offsets)
# are PRINTED as a JSON block — core/weapons/weapon_data.js view.* fields are
# updated from that output (single direction: tool -> data file).

import bpy, bmesh, math, os, sys, json
import numpy as np
from mathutils import Vector, Matrix, Euler

GAME = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
LC = r"C:\Users\TestRun\Claude Claw\forgeflow-games\games\last-circle\assets"
SRC_WPN = os.path.join(LC, "props", "meshy_wpn")
SRC_SOLDIER = os.path.join(LC, "chars", "meshy", "soldier.glb")
OUT_DIR = os.path.join(GAME, "assets", "weapons")
GEN_DIR = os.path.join(GAME, "tools", "_a4_gen")  # build intermediates — textures ship INSIDE the GLBs; tools/ is withheld from deploy
PREV_DIR = os.path.join(GAME, "_shots", "a4_fp")
os.makedirs(OUT_DIR, exist_ok=True)
os.makedirs(GEN_DIR, exist_ok=True)
os.makedirs(PREV_DIR, exist_ok=True)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ONLY = [a for a in ARGS if not a.startswith("-")]
PREVIEW_ONLY = "--preview-only" in ARGS

D = math.radians

# ---------------------------------------------------------------------------
# CONFIG — all judgment-tuned numbers live here.
# Blender build frame: +Y = muzzle/forward, +Z = up, +X = right, origin = grip.
# On glTF export (Y-up): Blender +Y -> glTF -Z, +Z -> +Y, +X -> +X.
# ---------------------------------------------------------------------------
CFG = {
    "warden": {  # M-72 Warden — AR (base wpn_ar)
        "src": "wpn_ar.glb", "length": 0.88,
        # raw-frame (unscaled, muzzle at -X) landmarks measured off renders:
        "grip_x_raw": 0.42,        # pistol-grip center
        "barrel_probe_raw": 0.10,  # sample width at the muzzle end to find bore z
        # W1 (iter02 fix): sight line = the BASE MESH's own rail plane + real
        # sight height, MEASURED off the mesh (tools probe, this session):
        # wpn_ar carries a genuine flat top rail at bore+0.041 from y 0.084 to
        # y 0.430, with its own front (y 0.462) and rear (y ~0.00) sight bosses
        # at bore+0.070. We keep the rifle and replace only the two mushy Meshy
        # bosses — the old build fabricated a rail and deleted the whole spine.
        "sight_h": 0.070,          # sight line ABOVE the bore line (m)
        "rail": None,              # the base mesh HAS a rail — never stack one
        "iron_base_rel": 0.041,    # the mesh's own rail plane, rel bore
        "iron": {"rear_y": -0.004, "front_y": 0.462},
        "strip_regions": [         # surgical: the two mushy Meshy sight bosses
            {"y0": -0.044, "y1": 0.036, "half_w": 0.017, "z_rel": 0.046},
            {"y0": 0.440, "y1": 0.486, "half_w": 0.016, "z_rel": 0.046},
        ],
        "barrel_y": 0.47,          # exposed barrel/muzzle starts here
        "lh_y": 0.240,             # support-hand station on the handguard
        "muzzle_dev": {"r": 0.0115, "len": 0.062, "kind": "birdcage"},
        # W1 (iter03): NO fabricated foregrip. wpn_ar already models an angled
        # foregrip on the handguard; the authored cylinder was stacked on top of
        # it from the GRIP origin (not the handguard underside), so it hung in
        # the air behind the magazine — clay-rendered this session.
        "foregrip": None,
        "eject": {"y": 0.045, "z_rel": -0.004},
        "sights": "iron",
        "arms": True,
    },
    "vesper": {  # KS-23 Vesper — suppressed SMG (base wpn_smg)
        "src": "wpn_smg.glb", "length": 0.72,
        "grip_x_raw": 0.30,
        "barrel_probe_raw": 0.10,
        # measured: rail plane bore+0.038 (y 0.023..0.160); rear boss y ~-0.015,
        # front boss y 0.333 — both at bore+0.049..0.060.
        "sight_h": 0.058,
        "rail": None,
        "iron_base_rel": 0.038,
        "iron": {"rear_y": -0.014, "front_y": 0.333},
        "strip_regions": [
            {"y0": -0.048, "y1": 0.014, "half_w": 0.015, "z_rel": 0.042},
            {"y0": 0.316, "y1": 0.352, "half_w": 0.014, "z_rel": 0.040},
        ],
        "barrel_y": 0.36,
        "lh_y": 0.190,
        "muzzle_dev": {"r": 0.017, "len": 0.16, "kind": "suppressor"},
        "foregrip": None,          # W1 (iter03): see warden — floating cylinder
        "eject": {"y": 0.035, "z_rel": -0.004},
        "sights": "iron_low",
        "arms": True,
    },
    "corvus": {  # LR-1 Corvus — DMR (base wpn_sniper; scope baked in mesh)
        "src": "wpn_sniper.glb", "length": 1.12,
        "grip_x_raw": 0.36,
        "barrel_probe_raw": 0.10,
        # measured: the Meshy scope tube runs y -0.09..0.19 with its axis at
        # bore+0.081. The OCULAR end is the blobby torus that filled iter02's
        # S2 frame — stripped and rebuilt as a crisp eyepiece (see build_scope).
        "sight_h": 0.098,          # scope axis (ADS rides this line)
        "rail": None,
        # W1 (iter05): clear_r is the number that sets the SIZE of the sight
        # picture — the bore cone is narrowest here, at the eye, and flares to
        # clear_r2 so nothing further down the tube can vignette it.
        "scope": {"axis_rel": 0.098, "y_ocular": -0.088, "y_obj": 0.022,
                  "tube_r": 0.0300, "bell_r": 0.0335, "obj_r": 0.0345,
                  "clear_r": 0.0210, "clear_r2": 0.0300,
                  "y_turret": -0.020, "mount_base_rel": 0.045},
        # the ENTIRE Meshy scope goes: a ray cast along its own axis crosses
        # five solid slabs, so no boolean on the authored parts alone could
        # ever open a sight line through it (see build_scope).
        "strip_regions": [
            {"y0": -0.150, "y1": 0.232, "half_w": 0.046, "z_rel": 0.050},
        ],
        "barrel_y": 0.60,
        "lh_y": 0.235,
        "muzzle_dev": {"r": 0.0125, "len": 0.07, "kind": "brake"},
        "foregrip": None,
        "eject": {"y": 0.10, "z_rel": -0.002},
        "sights": "none",
        "stock_fix": {"gap_x_raw": 0.60, "shift_raw": -0.085},
        "arms": True,
    },
    "pike": {  # GS-9 Pike — pistol (base wpn_pistol)
        "src": "wpn_pistol.glb", "length": 0.235,
        "grip_x_raw": 0.55,
        "barrel_probe_raw": 0.12,
        "sight_h": 0.028,
        "rail": None,
        "barrel_y": 0.075,
        "muzzle_dev": None,
        "foregrip": None,
        "eject": {"y": 0.01, "z_rel": -0.002},
        "sights": "pistol",
        "arms": True,
    },
}

# arm placement per weapon: (hand, wrist_pos, fingers_dir, palm_dir).
# canonical hand chunk frame: origin at the wrist, fingers +Y, palm -Z
# (canonicalized from the hand bone matrix at cut time). Placement builds an
# explicit basis from the two direction vectors (eulers were unreviewable).
#
# W1 (iter03) FRAMING: the forearm stub runs roughly ANTI-parallel to fingers_dir
# (the chunk is cut on the forearm bone axis, which is near-collinear with the
# hand bone in the T-pose). The old trigger-hand fingers_dir (-0.10, 0.90, 0.25)
# therefore pointed the forearm almost straight back AT THE EYE: at the Corvus
# ADS pose the wrist sits 0.21 m from the vm camera and the stub reached to
# 0.05 m, so a 10 cm-thick forearm filled the whole lower frame (iter03 S2, and
# the corvus_ads preview). Trigger-hand fingers_dir now carries real +Z so the
# stub falls away DOWN-and-back and leaves frame the way a shouldered rifle's
# firing arm actually does.
ARM_POSE = {
    "warden": [
        ("R", (0.035, -0.088, -0.088), (-0.10, 0.72, 0.68), (-0.95, 0.24, -0.20)),
        ("L", (-0.05, 0.22, -0.090), (0.82, 0.22, 0.53), (0.52, 0.06, 0.85)),
    ],
    "vesper": [
        ("R", (0.035, -0.088, -0.088), (-0.10, 0.72, 0.68), (-0.95, 0.24, -0.20)),
        ("L", (-0.05, 0.16, -0.088), (0.82, 0.22, 0.53), (0.52, 0.06, 0.85)),
    ],
    "corvus": [
        ("R", (0.035, -0.088, -0.088), (-0.10, 0.72, 0.68), (-0.95, 0.24, -0.20)),
        ("L", (-0.05, 0.19, -0.10), (0.82, 0.18, 0.55), (0.48, 0.04, 0.88)),
    ],
    "pike": [
        ("R", (0.030, -0.080, -0.092), (-0.10, 0.70, 0.70), (-0.95, 0.22, -0.18)),
        ("L", (-0.030, -0.095, -0.105), (0.90, 0.30, 0.20), (0.60, 0.30, 0.70)),
    ],
}

# ---------------------------------------------------------------------------
# texture generation (numpy — Blender's python has no PIL)
#
# W1 (iter04 -> 05) THE MEASURED DEFECT AND THE RULE THAT REPLACES IT.
# Three cold critics independently called the viewmodel "untextured light-grey
# clay with one flat albedo and one uniform roughness". That was not an opinion
# and it was not mesh density: the shipped texture set MEASURED
#   gun_albedo_body std 0.0105 (+/-2.7 levels out of 255 — a solid swatch)
#   gun_albedo_metal std 0.0171,  gun_orm_polymer roughness std 0.0488
#   gun_normal       B mean 0.9998 (a flat map is exactly (0.5,0.5,1.0))
# because every expression had the shape `_fbm(...) * 0.09 + 0.29` — a
# 0.09-wide band that AgX then flattens the rest of the way. VT §3 hard-caps
# uniform roughness on a hero surface at D3 = 5 and doctrine §7 caps D5 at 2.
#
# TWO RULES NOW HOLD THIS FILE:
#  1. VARIANCE IS THE PRODUCT. Every emitted channel records its std and the
#     build ASSERTS the floors in TEX_FLOORS before it exports anything. A
#     silently flat texture can never ship again.
#  2. DETAIL IS GEOMETRY-AWARE, NOT JUST NOISE. The base meshes are Meshy
#     atlases whose UV layout we do not author, so panel lines painted in UV
#     space would land at random. Instead, per-vertex signals measured off the
#     MESH — convex edge wear, crevice grime, muzzle/ejection-port carbon
#     fouling, hand polish at the two grip stations, and the axial/radial
#     position in WEAPON space — are rasterised through the mesh's own UVs into
#     mask images. So "fouling near the muzzle" is fouling near the muzzle on
#     the actual gun, and circumferential machining detail runs around the
#     actual barrel whatever the atlas does.
#
# THE GENERATOR HAZARD THAT WAS HERE: every texture was guarded by
# `if not os.path.exists(p)`, so editing these expressions changed NOTHING
# until tools/_a4_gen/*.png was deleted by hand — an edit that silently
# no-ops is worse than no edit. Replaced by TEX_VERSION: the stamp is written
# beside the textures and any mismatch (or --regen) rebuilds the whole set.
# ---------------------------------------------------------------------------
TEX_VERSION = "a4tex-v3-hardsurface"     # bump to force a full texture regen
TEX_SIZE = 768                           # albedo/normal; ORM ships at half
TEX_FLOORS = {"albedo": 0.045, "rough": 0.070, "normal": 0.045}
FORCE_REGEN = "--regen" in ARGS


def _value_noise(size, cx, cy, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cy + 2, cx + 2))
    ys, xs = np.mgrid[0:size, 0:size]
    fx = xs * cx / size
    fy = ys * cy / size
    x0 = fx.astype(int); y0 = fy.astype(int)
    tx = fx - x0; ty = fy - y0
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
    a = g[y0, x0]; b = g[y0, x0 + 1]; c = g[y0 + 1, x0]; d = g[y0 + 1, x0 + 1]
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty


def _fbm(size, seed, octaves=4, cell=6, aspect=1.0):
    """aspect > 1 stretches the noise along U. Directional mould flow and
    machining lines are anisotropic; isotropic fbm is exactly why the old set
    read as 'Photoshop add-noise plus emboss'."""
    out = np.zeros((size, size))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        cx = max(1, int(round(cell * (2 ** o) * aspect)))
        cy = max(1, int(round(cell * (2 ** o) / aspect)))
        out += _value_noise(size, cx, cy, seed + o * 17) * amp
        tot += amp
        amp *= 0.55
    return out / tot


def _n01(a):
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / max(1e-6, hi - lo)


def _sstep(e0, e1, x):
    t = np.clip((x - e0) / max(1e-6, e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _scratches(size, seed, n, lo_len, hi_len, width=1, bias_deg=None, spread_deg=90):
    """Scratch coverage 0..1. bias_deg biases direction so the wear reads as
    handling marks along one axis instead of random pen strokes; the ends taper
    so a scratch fades out instead of stopping dead."""
    img = np.zeros((size, size), np.float64)
    rng = np.random.default_rng(seed)
    for _ in range(n):
        x0, y0 = rng.integers(0, size, 2)
        if bias_deg is None:
            ang = rng.random() * math.pi * 2
        else:
            ang = math.radians(bias_deg + (rng.random() * 2 - 1) * spread_deg)
            if rng.random() < 0.5:
                ang += math.pi
        ln = int(rng.integers(max(2, int(size * lo_len)),
                              max(int(size * lo_len) + 2, int(size * hi_len))))
        dx, dy = math.cos(ang), math.sin(ang)
        w = int(rng.integers(1, width + 1))
        s = 0.25 + 0.75 * rng.random() ** 2
        t = np.arange(ln)
        fade = np.minimum(1.0, np.minimum(t, ln - 1 - t) / max(1.0, ln * 0.25))
        xs = ((x0 + dx * t).astype(int)) % size
        ys = ((y0 + dy * t).astype(int)) % size
        for oy in range(w):
            for ox in range(w):
                yy = (ys + oy) % size
                xx = (xs + ox) % size
                img[yy, xx] = np.maximum(img[yy, xx], s * fade)
    return img


def _pits(size, seed, n, rmin, rmax):
    """Casting porosity and handling dings."""
    img = np.zeros((size, size), np.float64)
    rng = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:size, 0:size]
    for _ in range(n):
        cxp, cyp = rng.integers(0, size, 2)
        r = int(rng.integers(rmin, rmax + 1))
        dx = np.minimum(np.abs(xs - cxp), size - np.abs(xs - cxp))
        dy = np.minimum(np.abs(ys - cyp), size - np.abs(ys - cyp))
        d = np.sqrt(dx * dx + dy * dy) / r
        img = np.maximum(img, (1.0 - np.clip(d, 0, 1)) ** 1.5 * (0.5 + 0.5 * rng.random()))
    return img


# ---- per-vertex geometry signals -> UV-space masks --------------------------
def mesh_wear_channels(mo, cfg, bore_z, muzzle_y, right_x):
    """Signals measured off the MESH, in the build frame (+Y muzzle, +Z up,
    origin at the grip). Returns {name: np.array(len(verts))}."""
    me = mo.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float64); me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    nrm = np.empty(n * 3, np.float64); me.vertices.foreach_get("normal", nrm)
    nrm = nrm.reshape(n, 3)

    # Convexity: for vertex a with neighbour b, b drops BELOW a's tangent plane
    # on a convex ridge and rises above it inside a crevice. Averaged per
    # vertex this is the cheapest correct edge-wear / crevice-grime mask there
    # is, and it needs no UV knowledge at all — which is the whole point.
    ei = np.empty(len(me.edges) * 2, np.int32); me.edges.foreach_get("vertices", ei)
    ei = ei.reshape(-1, 2)
    a, b = ei[:, 0], ei[:, 1]
    d = co[b] - co[a]
    L = np.linalg.norm(d, axis=1)
    keep = L > 1e-9
    a, b, d, L = a[keep], b[keep], d[keep], L[keep]
    d = d / L[:, None]
    acc = np.zeros(n); cnt = np.zeros(n)
    np.add.at(acc, a, -(d * nrm[a]).sum(1))
    np.add.at(acc, b, (d * nrm[b]).sum(1))
    np.add.at(cnt, a, 1.0)
    np.add.at(cnt, b, 1.0)
    conv = acc / np.maximum(cnt, 1.0)

    x, y, z = co[:, 0], co[:, 1], co[:, 2]
    rad = np.sqrt(x * x + (z - bore_z) ** 2)

    # carbon fouling: a cone behind the crown + a plume around the port
    foul = np.clip(1.0 - (muzzle_y - y) / 0.17, 0, 1) ** 1.6
    foul *= np.clip(1.25 - (rad - 0.014) / 0.055, 0, 1)
    e = cfg.get("eject") or {}
    if e:
        ep = np.array([right_x, e.get("y", 0.04), bore_z + e.get("z_rel", 0.0)])
        foul = np.maximum(foul, 0.85 * np.exp(-((co - ep) ** 2).sum(1) / (2 * 0.050 ** 2)))
    foul = np.clip(foul, 0, 1)

    # hand polish: the two stations a shooter's hands actually live on
    hand = np.zeros(n)
    gs = grip_seat(mo, cfg, bore_z)
    if gs is not None:
        gp = np.array([0.0, gs[0], gs[1]])
        hand = np.maximum(hand, np.exp(-((co - gp) ** 2).sum(1) / (2 * 0.055 ** 2)))
    lh = cfg.get("lh_y")
    if lh is not None:
        hand = np.maximum(hand, np.exp(
            -(((y - lh) ** 2) / (2 * 0.075 ** 2) + ((rad - 0.030) ** 2) / (2 * 0.045 ** 2))))

    # the left receiver flat — where real stencilled markings live
    st = ((nrm[:, 0] < -0.72) & (y > -0.05) & (y < 0.13) &
          (z > bore_z - 0.055) & (z < bore_z + 0.012)).astype(np.float64)

    return {
        "edge": np.clip(conv * 3.4, 0, 1) ** 0.85,
        "crevice": np.clip(-conv * 3.4, 0, 1) ** 0.85,
        "fouling": foul,
        "hand": np.clip(hand, 0, 1),
        "stencil": st,
        "axial": y,                                   # metres along the weapon
        "radial": np.arctan2(x, z - bore_z),          # radians around the bore
    }


def bake_channels_to_uv(mo, chans, S):
    """Rasterise per-vertex scalars through the mesh's own UVs.

    Row convention: Blender's Image.pixels start at the BOTTOM row and the glTF
    exporter emits v_gltf = 1 - v_blender, so writing array row = v*S is the one
    convention where the sampled texel matches the surface point. Verified by
    the fouling mask landing on the muzzle in the a4 preview renders."""
    me = mo.data
    uvl = me.uv_layers.active
    if uvl is None:
        print("A4BAKE no active UV layer — wear masks skipped")
        return None
    nl = len(me.loops)
    uvs = np.empty(nl * 2, np.float64); uvl.data.foreach_get("uv", uvs)
    uvs = uvs.reshape(nl, 2)
    lv = np.empty(nl, np.int32); me.loops.foreach_get("vertex_index", lv)

    names = list(chans.keys())
    acc = {k: np.zeros((S, S), np.float64) for k in names}
    wsum = np.zeros((S, S), np.float64)
    px = np.clip(uvs[:, 0], 0, 1) * (S - 1)
    py = np.clip(uvs[:, 1], 0, 1) * (S - 1)

    tris = []
    for p in me.polygons:
        ls = list(p.loop_indices)
        for i in range(1, len(ls) - 1):
            tris.append((ls[0], ls[i], ls[i + 1]))
    if not tris:
        return None

    for i0, i1, i2 in tris:
        x0, y0 = px[i0], py[i0]; x1, y1 = px[i1], py[i1]; x2, y2 = px[i2], py[i2]
        xlo = max(0, int(math.floor(min(x0, x1, x2))))
        xhi = min(S - 1, int(math.ceil(max(x0, x1, x2))))
        ylo = max(0, int(math.floor(min(y0, y1, y2))))
        yhi = min(S - 1, int(math.ceil(max(y0, y1, y2))))
        if xhi < xlo or yhi < ylo:
            continue
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-9:
            continue
        gx, gy = np.meshgrid(np.arange(xlo, xhi + 1), np.arange(ylo, yhi + 1))
        w0 = ((y1 - y2) * (gx - x2) + (x2 - x1) * (gy - y2)) / den
        w1 = ((y2 - y0) * (gx - x2) + (x0 - x2) * (gy - y2)) / den
        w2 = 1.0 - w0 - w1
        m = (w0 >= -0.003) & (w1 >= -0.003) & (w2 >= -0.003)
        if not m.any():
            continue
        sub = (slice(ylo, yhi + 1), slice(xlo, xhi + 1))
        wsum[sub] += m
        v0, v1, v2 = lv[i0], lv[i1], lv[i2]
        for k in names:
            c = chans[k]
            acc[k][sub] += np.where(m, w0 * c[v0] + w1 * c[v1] + w2 * c[v2], 0.0)

    cov = wsum > 0
    out = {}
    for k in names:
        arr = np.zeros((S, S), np.float64)
        arr[cov] = acc[k][cov] / wsum[cov]
        out[k] = arr
    # dilate into the UV gutter so seams do not show an unpainted hairline
    filled = cov.copy()
    for _ in range(5):
        cn = np.zeros((S, S), np.float64)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            cn += np.roll(filled.astype(np.float64), (dy, dx), (0, 1))
        grow = (cn > 0) & (~filled)
        if not grow.any():
            break
        for k in names:
            s = np.zeros((S, S), np.float64)
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                s += np.roll(out[k] * filled, (dy, dx), (0, 1))
            out[k] = np.where(grow, s / np.maximum(cn, 1.0), out[k])
        filled = filled | grow
    print(f"A4BAKE uv coverage {100.0 * cov.mean():.1f}% of {S}x{S}")
    return out


def gun_texture_arrays(S, masks=None, seed=0):
    """The authored hard-surface set. Returns float arrays in 0..1."""
    z = np.zeros((S, S))
    M = {k: (masks or {}).get(k, z) for k in
         ("fouling", "crevice", "edge", "hand", "stencil")}
    axial = (masks or {}).get("axial")
    radial = (masks or {}).get("radial")

    mac = _n01(_fbm(S, 11 + seed, 5, 3))                  # batch / dye variation
    mid = _n01(_fbm(S, 23 + seed, 4, 11))                 # panel-scale blotch
    fine = _n01(_fbm(S, 37 + seed, 3, 46))                # micro speckle
    flow = _n01(_fbm(S, 51 + seed, 3, 2, aspect=9.0))     # mould flow
    brush = _n01(_fbm(S, 67 + seed, 2, 3, aspect=26.0))   # machining lines
    pit = _pits(S, 83 + seed, 120, 2, max(3, S // 110))
    scr_f = _scratches(S, 97 + seed, 900, 0.006, 0.030, 1, bias_deg=0, spread_deg=26)
    scr_c = _scratches(S, 113 + seed, 110, 0.02, 0.085, 2, bias_deg=0, spread_deg=42)
    scr_x = _scratches(S, 127 + seed, 260, 0.004, 0.018, 1)
    soot = _sstep(0.42, 0.95, _n01(_fbm(S, 149 + seed, 4, 5)))

    # ---- hard-surface structure in WEAPON space (see the module note) ------
    # Each one is WINDOWED to where that feature actually exists on a carbine —
    # an unwindowed rib/slot field corrugates the buttstock too and the whole
    # gun reads as a radiator (observed in the first iter05 preview render).
    ribs = np.zeros((S, S)); slots = np.zeros((S, S)); seam = np.zeros((S, S))
    if axial is not None and radial is not None:
        # knurling/texturing lives on the two grip stations, nowhere else
        ribs = (_sstep(0.55, 0.95, 0.5 + 0.5 * np.cos(radial * 16.0))
                * np.clip(M["hand"] * 1.7, 0, 1))
        # handguard vent slots: forward of the receiver only
        slots = (_sstep(0.66, 0.98, 0.5 + 0.5 * np.cos(axial * (2 * math.pi / 0.0165)))
                 * _sstep(0.115, 0.215, axial))
        # a shallow panel seam every 75 mm is fine the whole length
        seam = _sstep(0.92, 1.00, 0.5 + 0.5 * np.cos(axial * (2 * math.pi / 0.075)))

    # ==================== POLYMER FURNITURE (body / grip) ==================
    wear_p = _sstep(0.26, 0.80, np.clip(0.55 * mac + 0.45 * mid, 0, 1))
    a = 0.095 + 0.165 * wear_p
    a += 0.105 * (flow - 0.35) * (0.35 + 0.65 * wear_p)
    a += 0.070 * fine
    a += (0.075 * scr_f + 0.115 * scr_c + 0.055 * scr_x) * (0.35 + 0.65 * wear_p)
    a -= 0.060 * pit
    a -= 0.055 * soot
    a -= 0.026 * slots + 0.014 * seam
    a *= (1.0 - 0.42 * M["fouling"])                      # carbon at muzzle/port
    a *= (1.0 - 0.30 * M["crevice"])                      # grime in recesses
    a += 0.075 * M["edge"] * (0.4 + 0.6 * wear_p)         # rubbed-through edges
    a += 0.030 * M["hand"]                                # hand-polished sheen
    a += 0.26 * M["stencil"] * _sstep(0.45, 0.75, mid)    # stencilled markings
    alb_body = np.clip(a, 0.02, 1.0)

    r = 0.975 - 0.26 * wear_p
    r -= 0.34 * (scr_f * 0.5 + scr_c + scr_x * 0.4)
    r -= 0.26 * M["edge"] + 0.20 * M["hand"]
    r += 0.16 * M["fouling"] + 0.13 * M["crevice"] + 0.10 * pit
    r += 0.14 * (mid - 0.5) + 0.08 * (flow - 0.5)
    r += 0.07 * slots
    rough_poly = np.clip(r, 0.44, 0.995)

    # ==================== PARKERISED / BLUED STEEL =========================
    wear_m = _sstep(0.30, 0.82, np.clip(0.45 * mac + 0.55 * mid, 0, 1))
    m = 0.160 + 0.190 * wear_m
    m += 0.120 * brush
    m += 0.048 * fine
    m += (0.130 * scr_f + 0.215 * scr_c + 0.085 * scr_x) * (0.35 + 0.65 * wear_m)
    m -= 0.080 * pit
    m -= 0.070 * soot
    m += 0.048 * ribs - 0.030 * slots
    m *= (1.0 - 0.46 * M["fouling"])
    m *= (1.0 - 0.26 * M["crevice"])
    m += 0.150 * M["edge"]                                # polished bare edges
    m += 0.045 * M["hand"]
    alb_metal = np.clip(m, 0.03, 1.0)

    rm = 0.965 - 0.20 * wear_m
    rm -= 0.22 * brush
    rm -= 0.42 * (scr_f * 0.6 + scr_c + scr_x * 0.4) + 0.34 * M["edge"] + 0.22 * M["hand"]
    rm += 0.20 * M["fouling"] + 0.15 * M["crevice"] + 0.12 * pit
    rm += 0.08 * slots - 0.05 * ribs
    # FLOOR 0.48, measured against the live capture, not by eye: at 0.30 a
    # small authored part (front sight tower, rail notch) can land on a single
    # low-roughness texel and render as CHROME under the env map — that was the
    # blown-white front sight in the first iter05 S8 capture. No texel on a
    # parkerised gun may be a mirror.
    rough_metal = np.clip(rm, 0.48, 0.995)

    # ==================== HEIGHT ===========================================
    h = (0.34 * _n01(_fbm(S, 131 + seed, 5, 8))
         + 0.26 * brush
         + 0.10 * flow
         + 0.34 * fine
         - 0.55 * pit
         - 0.34 * scr_c - 0.20 * scr_f - 0.12 * scr_x
         + 0.22 * M["stencil"]
         - 0.18 * M["crevice"]
         + 0.24 * ribs - 0.30 * slots - 0.16 * seam)
    # A single-texel-period normal is aliasing, not detail, and it is also what
    # made the emitted PNG 2.7 MB. One 3x3 smoothing pass keeps the machining
    # read and roughly halves the file.
    h = 0.72 * h + 0.28 * (0.25 * (np.roll(h, 1, 0) + np.roll(h, -1, 0) +
                                   np.roll(h, 1, 1) + np.roll(h, -1, 1)))
    return {"alb_body": alb_body, "alb_metal": alb_metal,
            "rough_poly": rough_poly, "rough_metal": rough_metal,
            "height": _n01(h)}


def _height_to_normal(h, k):
    gx = np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)
    gy = np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)
    nx = -gx * k; ny = -gy * k; nz = np.ones_like(h)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5, nz / ln * 0.5 + 0.5


def _save_img(name, rgba, fmt="PNG", quality=93):
    """rgba float 0..1, HxWx4.

    fmt="JPEG" for the ALBEDO maps only. A 768x768 field of authored grain is
    incompressible as PNG (the first iter05 build shipped a 7.9 MB warden.glb
    against 1.6 MB before), and this build already sits behind a perf gate that
    is failing by two orders of magnitude — a texture win that costs 6 MB of
    download and VRAM per weapon is not a win. JPEG q93 on a noise albedo is
    visually free. Normal and ORM stay PNG: chroma subsampling on a tangent-
    space normal is a real artifact, and roughness is the channel VT §3 grades."""
    h, w = rgba.shape[:2]
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)      # a stale size/content must not survive
    img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(rgba, dtype=np.float32).ravel())
    ext = ".jpg" if fmt == "JPEG" else ".png"
    path = os.path.join(GEN_DIR, name + ext)
    img.filepath_raw = path
    img.file_format = fmt
    img.save(quality=quality)
    return path


_TEX_STATS = {}


def _emit(name, arr, kind, tint=(1.0, 1.0, 1.0), chan=None, fmt="PNG"):
    """Write one texture and RECORD its std. VT §3's uniform-roughness cap is
    enforced numerically at the end of the build, never by eye."""
    if chan is None:
        rgba = np.stack([np.clip(arr * tint[0], 0, 1), np.clip(arr * tint[1], 0, 1),
                         np.clip(arr * tint[2], 0, 1), np.ones_like(arr)], axis=-1)
    else:
        cr, cg, cb = chan
        rgba = np.stack([cr, cg, cb, np.ones_like(cg)], axis=-1)
    p = _save_img(name, rgba, fmt=fmt)
    _TEX_STATS[name] = {"kind": kind, "std": round(float(arr.std()), 4),
                        "mean": round(float(arr.mean()), 4), "px": int(arr.shape[0])}
    return p


def gen_textures(wid, masks=None):
    """Per-weapon set — the wear masks are that weapon's own geometry."""
    S = TEX_SIZE
    stamp = os.path.join(GEN_DIR, ".texversion")
    have = ""
    try:
        have = open(stamp, encoding="utf-8").read().strip()
    except Exception:
        pass
    if FORCE_REGEN or have != TEX_VERSION:
        for f in os.listdir(GEN_DIR):
            if f.endswith(".png") or f.endswith(".jpg"):
                try:
                    os.remove(os.path.join(GEN_DIR, f))
                except OSError:
                    pass
        with open(stamp, "w", encoding="utf-8") as fh:
            fh.write(TEX_VERSION)

    t = gun_texture_arrays(S, masks, seed=(sum(ord(c) for c in wid) * 7) % 997)
    pre = wid + "_"
    done = {}
    done["albedo_body"] = _emit(pre + "albedo_body", t["alb_body"], "albedo",
                                tint=(1.00, 1.02, 1.06), fmt="JPEG")
    done["albedo_metal"] = _emit(pre + "albedo_metal", t["alb_metal"], "albedo",
                                 tint=(0.95, 1.00, 1.10), fmt="JPEG")
    rp = t["rough_poly"][::2, ::2]
    done["orm_polymer"] = _emit(pre + "orm_polymer", rp, "rough",
                                chan=(np.ones_like(rp), rp, np.zeros_like(rp)))
    rm = t["rough_metal"][::2, ::2]
    done["orm_metal"] = _emit(pre + "orm_metal", rm, "rough",
                              chan=(np.ones_like(rm), rm, np.ones_like(rm)))
    nx, ny, nz = _height_to_normal(t["height"], 9.0)
    done["normal"] = _emit(pre + "normal", nx, "normal",
                           chan=(nx, ny, nz))
    return done


def assert_texture_variance():
    """Doctrine §5: done = the measured effect. A build that would ship a flat
    hero texture fails HERE, before the GLB is written."""
    bad = [f"{n} std {s['std']} < {TEX_FLOORS[s['kind']]} ({s['kind']})"
           for n, s in _TEX_STATS.items()
           if s["kind"] in TEX_FLOORS and s["std"] < TEX_FLOORS[s["kind"]]]
    print("A4TEX " + json.dumps(_TEX_STATS))
    if bad:
        raise SystemExit("A4TEX FAIL — flat texture(s) would ship: " + "; ".join(bad))

# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
def _mat(name, albedo_img, tint, orm_img, normal_img, rough_factor=None,
         color_mul=None, rough_mul=None, normal_strength=1.0, emissive=None):
    """One PBR material.

    color_mul / rough_mul exist so PARTS of one gun can be genuinely different
    MATERIALS without paying for another texture set: the Blender exporter turns
    `baseColorTexture * constant` into baseColorFactor and `roughnessMap * value`
    into roughnessFactor, both of which three.js multiplies exactly the same way.
    Rubberised grip, anodised receiver and moulded furniture therefore share the
    maps (so the wear story stays continuous across a part boundary) but respond
    to light as four different surfaces — VT §3's "distinct albedo/roughness per
    part", which is what the critics said the old single-material gun lacked."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    outn = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], outn.inputs["Surface"])
    if emissive is not None:
        bsdf.inputs["Emission Color"].default_value = (*emissive, 1.0)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    else:
        bsdf.inputs["Emission Strength"].default_value = 0.0
    if albedo_img:
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(albedo_img, check_existing=True)
        tex.image.colorspace_settings.name = "sRGB"
        src = tex.outputs["Color"]
        if color_mul is not None:
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            nt.links.new(src, mix.inputs[6])                 # A (colour)
            mix.inputs[7].default_value = (*color_mul, 1.0)  # B (colour)
            src = mix.outputs[2]
        nt.links.new(src, bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*tint, 1.0)
    if orm_img:
        orm = nt.nodes.new("ShaderNodeTexImage")
        orm.image = bpy.data.images.load(orm_img, check_existing=True)
        orm.image.colorspace_settings.name = "Non-Color"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
        rsrc = sep.outputs["Green"]
        if rough_mul is not None:
            mul = nt.nodes.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            nt.links.new(rsrc, mul.inputs[0])
            mul.inputs[1].default_value = rough_mul
            rsrc = mul.outputs[0]
        nt.links.new(rsrc, bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Roughness"].default_value = rough_factor if rough_factor is not None else 0.8
        bsdf.inputs["Metallic"].default_value = 0.0
    if normal_img:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = bpy.data.images.load(normal_img, check_existing=True)
        ntex.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        # W1 (iter05): the old 0.6 was applied to a map whose own B channel
        # measured 0.9998 — 0.6 of nothing. The map now carries real machining,
        # casting and scratch relief, so it is read at full strength.
        nm.inputs["Strength"].default_value = normal_strength
        nt.links.new(ntex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def make_materials(tex):
    """Four hard-surface materials off one map set (see _mat's note):
    moulded polymer furniture, parkerised steel, rubberised grip, anodised
    receiver — plus the tritium accent."""
    return {
        "body": _mat("br_body", tex["albedo_body"], None, tex["orm_polymer"],
                     tex["normal"], normal_strength=1.0),
        "metal": _mat("br_metal", tex["albedo_metal"], None, tex["orm_metal"],
                      tex["normal"], normal_strength=0.85),
        # rubberised grip: darker, matter, and it keeps the moulded rib relief
        "grip": _mat("br_grip", tex["albedo_body"], None, tex["orm_polymer"],
                     tex["normal"], color_mul=(0.74, 0.74, 0.76), rough_mul=1.06,
                     normal_strength=1.25),
        # hard-anodised alloy receiver: a touch warmer and markedly slicker than
        # the furniture, which is what separates the two by eye under a moving
        # light instead of by an outline
        "recv": _mat("br_recv", tex["albedo_body"], None, tex["orm_polymer"],
                     tex["normal"], color_mul=(1.06, 1.02, 0.96), rough_mul=0.84,
                     normal_strength=0.75),
        # W1 (iter03): the front-sight dot only. It was near-white (0.85) — a
        # tritium dot is a tiny bright POINT, and at 0.85 albedo on a 2 mm
        # cylinder it just adds another blown pixel cluster. Warm, dimmer.
        "accent": _mat("br_accent", None, (0.42, 0.40, 0.30), None, None, rough_factor=0.45),
        # illuminated reticle: near-black posts that carry their own amber glow
        # so the cross reads against a blue-hour sight picture (VT §5/§6 amber).
        "reticle": _mat("br_reticle", None, (0.030, 0.028, 0.026), None, None,
                        rough_factor=0.80, emissive=(0.86, 0.46, 0.14)),
        "glove": None,  # built at arm-cut time (needs the soldier image)
    }

# ---------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------
def link(o):
    bpy.context.scene.collection.objects.link(o)
    return o

def new_mesh_obj(name, verts, faces, mat):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    if mat: o.data.materials.append(mat)
    return link(o)

def box(name, cx, cy, cz, sx, sy, sz, mat, bevel=0.0015):
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    v = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
         (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz),
         (cx - hx, cy - hy, cz + hz), (cx + hx, cy - hy, cz + hz),
         (cx + hx, cy + hy, cz + hz), (cx - hx, cy + hy, cz + hz)]
    f = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    o = new_mesh_obj(name, v, f, mat)
    if bevel > 0:
        b = o.modifiers.new("bv", "BEVEL")
        b.width = bevel
        b.segments = 1
        b.limit_method = "ANGLE"
    return o

def cyl(name, cx, cy, cz, r, length, mat, axis="Y", verts=20, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts,
                          radius1=r, radius2=r2 if r2 is not None else r, depth=length)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    if mat: o.data.materials.append(mat)
    if axis == "Y":
        o.rotation_euler = (D(90), 0, 0)
    elif axis == "X":
        o.rotation_euler = (0, D(90), 0)
    o.location = (cx, cy, cz)
    return link(o)

# doctrine §3: UVs in metres per tile. The base Meshy atlas lays the whole
# weapon out over roughly one UV tile (~0.9 m), so the authored dressing has to
# project at the SAME real-world density or it wears the identical texture at a
# different scale. It was 0.12 m/tile — 7x magnified — which is why the authored
# scope and sights rendered as craggy rock in the a4 preview while the receiver
# beside them read as metal. Mismatched texel density between adjacent parts is
# VT §3's own named tell.
UV_METRES_PER_TILE = 0.30      # fallback only; measured per weapon below


def measure_uv_density(mo):
    """metres per UV tile on the base atlas — MEASURED, not guessed.

    sqrt(sum 3D triangle area / sum UV triangle area). A Meshy atlas packs
    shells far tighter than the model's bounding box implies (0.90 m/tile was
    my first guess and it starved the authored optic of texture), so the only
    honest number is the one the mesh itself carries."""
    me = mo.data
    uvl = me.uv_layers.active
    if uvl is None:
        return UV_METRES_PER_TILE
    a3 = a2 = 0.0
    for p in me.polygons:
        ls = list(p.loop_indices)
        for i in range(1, len(ls) - 1):
            i0, i1, i2 = ls[0], ls[i], ls[i + 1]
            v0 = me.vertices[me.loops[i0].vertex_index].co
            v1 = me.vertices[me.loops[i1].vertex_index].co
            v2 = me.vertices[me.loops[i2].vertex_index].co
            a3 += (v1 - v0).cross(v2 - v0).length * 0.5
            u0 = uvl.data[i0].uv; u1 = uvl.data[i1].uv; u2 = uvl.data[i2].uv
            a2 += abs((u1.x - u0.x) * (u2.y - u0.y) - (u2.x - u0.x) * (u1.y - u0.y)) * 0.5
    if a2 <= 1e-9 or a3 <= 1e-12:
        return UV_METRES_PER_TILE
    m_per_tile = math.sqrt(a3 / a2)
    print(f"A4UV base atlas density {m_per_tile:.4f} m per UV tile")
    return max(0.05, min(1.5, m_per_tile))


def uv_cube_project(objs, cube_size=None):
    """Project the authored dressing.

    W1 (iter05), MEASURED IN THE LIVE CAPTURE, not reasoned about: projecting a
    16 mm front-sight tower at the base atlas's own 0.73 m/tile gives it ~0.02
    of UV space — well under one texel of the roughness and albedo maps — so
    the whole part shades off a SINGLE texel. In S8 that texel was a bright
    scratch and the sight rendered as polished chrome. Small hardware therefore
    gets a tighter tile, exactly the way a trim sheet gives small fixtures
    their own scale; parts at or above the atlas tile keep the measured
    density, so no two ADJACENT LARGE surfaces disagree (VT §3's actual tell)."""
    base_cs = cube_size or UV_METRES_PER_TILE
    for o in objs:
        if o.type != "MESH" or not o.data.polygons:
            continue
        d = o.dimensions
        diag = max(1e-4, math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z))
        # diag * 2.2: a part the size of the optic body lands near the base
        # atlas density (no magnified grain — 0.90 made it read as rock in the
        # live S2 frame), while the floor still stops a 16 mm sight tower from
        # collapsing onto one texel.
        cs = max(0.060, min(base_cs, diag * 2.2))
        bpy.context.view_layer.objects.active = o
        for so in bpy.context.selected_objects: so.select_set(False)
        o.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.cube_project(cube_size=cs)
        bpy.ops.object.mode_set(mode="OBJECT")

def apply_all(o):
    bpy.context.view_layer.objects.active = o
    for so in bpy.context.selected_objects: so.select_set(False)
    o.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.convert(target="MESH")  # applies modifiers (bevel)

def shade_smooth(o, angle_deg=40):
    """Auto-smooth: Meshy meshes arrive flat-faceted — smoothing curved runs
    while keeping hard edges is the single cheapest close-up win."""
    bpy.context.view_layer.objects.active = o
    for so in bpy.context.selected_objects: so.select_set(False)
    o.select_set(True)
    try:
        bpy.ops.object.shade_auto_smooth(angle=D(angle_deg))
    except Exception:
        try:
            bpy.ops.object.shade_smooth_by_angle(angle=D(angle_deg))
        except Exception:
            bpy.ops.object.shade_smooth()

# ---------------------------------------------------------------------------
# dressing builders (build frame: +Y muzzle, +Z up, origin at grip)
# ---------------------------------------------------------------------------
def weld_mesh(mo, dist=0.0004):
    """Weld UV-seam vertex splits. W1 (iter03): the last-circle Meshy props ship
    SPLIT along every UV seam — wpn_ar imports as 4,908 verts for 5,943 tris,
    i.e. hundreds of open boundary edges masquerading as a closed body (the same
    defect measured on soldier.glb: 20,010 boundary edges). Any vertex delete
    then tears along those seams instead of cutting cleanly, and smooth shading
    breaks at every one of them — that is the faceted 'polygon soup' read on the
    receiver at viewmodel range. Weld first, cut second."""
    bm = bmesh.new()
    bm.from_mesh(mo.data)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=dist)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    after = len(bm.verts)
    bm.to_mesh(mo.data)
    bm.free()
    mo.data.update()
    print(f"A4WELD {mo.name}: {before} -> {after} verts")


def strip_top(mo, y0, y1, z_cut, half_w):
    """Remove the base mesh's mangled top furniture (bent Meshy sight towers,
    mushy rail) in a narrow centerline channel — the authored rail/sights
    replace it. W1 (iter03): the delete used to leave the channel OPEN, so the
    receiver showed torn triangle fans and black backface wedges right where the
    viewmodel camera stares (S6, this session). Now the cut boundary is capped —
    fill restricted to the strip's own bbox so genuine openings elsewhere on the
    mesh (the bore, the mag well) are left alone."""
    bm = bmesh.new()
    bm.from_mesh(mo.data)
    doomed = [v for v in bm.verts
              if v.co.z > z_cut and y0 < v.co.y < y1 and abs(v.co.x) < half_w]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
    pad = 0.012
    ring = [e for e in bm.edges if e.is_boundary
            and all(y0 - pad < v.co.y < y1 + pad and abs(v.co.x) < half_w + pad
                    and v.co.z > z_cut - pad for v in e.verts)]
    if ring:
        try:
            bmesh.ops.holes_fill(bm, edges=ring, sides=0)
        except Exception:
            try:
                bmesh.ops.triangle_fill(bm, edges=ring, use_beauty=True)
            except Exception:
                pass
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mo.data)
    bm.free()
    mo.data.update()

def build_rail(cfg_rail, top_z, mats):
    objs = []
    y0, y1 = cfg_rail["y0"], cfg_rail["y1"]
    w = cfg_rail["w"]
    zb = top_z + cfg_rail["z_rel"]
    length = y1 - y0
    # tall base: seats INTO the stripped channel (no floating gap)
    base = box("rail_base", 0, (y0 + y1) / 2, zb - 0.006, w, length, 0.020, mats["metal"])
    objs.append(base)
    n = int(length / 0.012)
    for i in range(n):
        y = y0 + 0.006 + i * (length / n)
        objs.append(box(f"rail_n{i}", 0, y, zb + 0.005, w * 0.92, 0.006, 0.004, mats["metal"], bevel=0.0008))
    return objs, zb + 0.007  # rail top z

def build_sights(kind, rail_top_z, sight_z, y_front, y_rear, mats):
    """Front post + rear ring, centered EXACTLY on x=0, post top at sight_z."""
    objs = []
    if kind == "none":
        return objs
    if kind in ("iron", "iron_low"):
        # front: tower + thin post, top of post at sight_z
        tower_h = (sight_z - rail_top_z) * 0.55
        objs.append(box("fs_tower", 0, y_front, rail_top_z + tower_h / 2, 0.014, 0.016, tower_h, mats["metal"]))
        post_h = (sight_z - rail_top_z) - tower_h
        objs.append(box("fs_post", 0, y_front, rail_top_z + tower_h + post_h / 2, 0.0022, 0.0035, post_h, mats["metal"], bevel=0.0004))
        # protective ears
        for sx in (-1, 1):
            objs.append(box(f"fs_ear{sx}", sx * 0.0085, y_front, rail_top_z + tower_h * 0.9, 0.003, 0.014, tower_h * 1.15, mats["metal"]))
        # rear: aperture ring, center at sight_z (peep: post tip centers in it)
        ring_r = 0.0075
        ring = cyl("rs_ring", 0, y_rear, sight_z, ring_r, 0.006, mats["metal"], axis="Y", verts=24)
        # hollow: inner disc removed via solidified torus illusion — build as
        # two stacked rings (outer ring + thin inner lip), reads as an aperture
        inner = cyl("rs_inner", 0, y_rear, sight_z, ring_r * 0.62, 0.008, None, axis="Y", verts=24)
        # boolean the hole
        mod = ring.modifiers.new("hole", "BOOLEAN")
        mod.operation = "DIFFERENCE"
        mod.object = inner
        objs.append(ring)
        bpy.context.view_layer.update()
        apply_all(ring)
        bpy.data.objects.remove(inner, do_unlink=True)
        objs.append(box("rs_base", 0, y_rear, (rail_top_z + sight_z) / 2 - 0.004, 0.012, 0.014, (sight_z - rail_top_z) * 0.8, mats["metal"]))
    elif kind == "pistol":
        # slide-top: front post w/ white dot + rear notch blades
        objs.append(box("fs_post", 0, y_front, sight_z - 0.003, 0.0022, 0.004, 0.007, mats["metal"], bevel=0.0004))
        dot = cyl("fs_dot", 0, y_front - 0.0021, sight_z - 0.0012, 0.0009, 0.0012, mats["accent"], axis="Y", verts=10)
        objs.append(dot)
        for sx in (-1, 1):
            objs.append(box(f"rs_blade{sx}", sx * 0.0042, y_rear, sight_z - 0.003, 0.004, 0.005, 0.0065, mats["metal"], bevel=0.0004))
    return objs

def build_scope(cfg, bore_z, mats):
    """The DMR optic — REBUILT AS A REAL SIGHT PICTURE (W1, iter05 S2 fix).

    MEASURED DEFECT: iter04's S2 put an opaque black annulus at frame centre
    with no sight picture at all, and all three critics called it the single
    most damning image in the battery. Diagnosed by ray-casting the normalised
    wpn_sniper base mesh along its own scope axis this session: the ray crosses
    FIVE solid slabs between y -0.10 and +0.20. The Meshy scope is a solid
    lump, and the previous authored ocular bored only its own bell and then
    parked a CAPPED cylinder directly behind it. There was never anything to
    see through.

    THE RULE NOW: an optic the player aims through is a HOLE, not a shape. The
    Meshy scope body is stripped out entirely (cfg strip_regions) and the whole
    assembly is authored here, then bored end to end with a truncated cone that
    is narrowest at the eye and opens toward the objective. The world — already
    drawn by the world camera before the vm pass clears depth — shows straight
    through it, and a duplex reticle rides the optical axis at x = 0 so
    alignment is exact BY CONSTRUCTION (VT §5), not by a tuned offset.

    WHY THE OPTIC IS SHORT AND WIDE, and this is the whole design constraint:
    with no lens simulation, the sight picture is a pinhole cone. From an eye
    at d0 in front of the ocular, an aperture r0 needs clear radius
    r0*(d0+s)/d0 at every s down the tube. The first iter05 attempt kept the
    30 cm scope body: to pass a 21.5 mm aperture it would have needed a 14 cm
    objective, so the boolean simply ate the tube and the turrets were left
    floating in the hole (observed in the a4 preview). A 110 mm optic at
    d0 = 0.14 m passes r0 = obj_r*d0/(d0+L) ~ 16 mm, i.e. ~13 deg against the
    34 deg ADS vFOV — about 38% of frame height of genuine through-optic image.
    That is a compact prism sight, which is what a modern DMR actually wears.
    """
    sc = cfg.get("scope")
    if not sc:
        return []
    z = bore_z + sc["axis_rel"]
    y0 = sc["y_ocular"]                       # rear face of the eyecup
    y_obj = sc.get("y_obj", y0 + 0.110)
    tr = sc["tube_r"]
    br = sc["bell_r"]
    orr = sc.get("obj_r", br * 1.03)
    clear = sc.get("clear_r", tr * 0.70)      # ocular aperture
    flare = sc.get("clear_r2", orr * 0.87)    # opens toward the objective
    objs = []

    # --- shell (bored) -----------------------------------------------------
    objs.append(cyl("sc_cup", 0, y0 + 0.004, z, br * 1.05, 0.008, mats["grip"], axis="Y", verts=36))
    objs.append(cyl("sc_bell", 0, y0 + 0.021, z, br, 0.026, mats["metal"], axis="Y", verts=36))
    objs.append(cyl("sc_step", 0, y0 + 0.043, z, tr, 0.018, mats["metal"], axis="Y", verts=36, r2=br))
    tube_y0, tube_y1 = y0 + 0.052, y_obj - 0.026
    objs.append(cyl("sc_tube", 0, (tube_y0 + tube_y1) / 2, z, tr, max(0.006, tube_y1 - tube_y0),
                    mats["metal"], axis="Y", verts=36))
    objs.append(cyl("sc_objstep", 0, y_obj - 0.019, z, orr, 0.014, mats["metal"], axis="Y",
                    verts=36, r2=tr))
    objs.append(cyl("sc_objbell", 0, y_obj - 0.007, z, orr, 0.014, mats["metal"], axis="Y", verts=36))
    objs.append(cyl("sc_objrim", 0, y_obj - 0.001, z, orr * 1.03, 0.005, mats["grip"], axis="Y", verts=36))

    bore_y0, bore_y1 = y0 - 0.006, y_obj + 0.010
    bore = cyl("sc_bore", 0, (bore_y0 + bore_y1) / 2, z, flare, bore_y1 - bore_y0,
               None, axis="Y", verts=44, r2=clear)   # r2 sits at -Y = the eye
    for o in list(objs):
        m = o.modifiers.new("bore", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = bore
        m.solver = "EXACT"
        bpy.context.view_layer.update()
        apply_all(o)
    bpy.data.objects.remove(bore, do_unlink=True)

    # --- turrets + mounts: OUTSIDE the shell, never bored -------------------
    # (the first attempt seated these against the tube radius and the boolean
    # then opened the tube out past them — they hung inside the sight picture
    # as four grey slabs. They now clear the OUTER radius by construction.)
    ty = sc.get("y_turret", (y0 + y_obj) * 0.5)
    objs.append(cyl("sc_turret_up", 0, ty, z + tr + 0.008, 0.013, 0.020, mats["metal"], axis="Z", verts=20))
    objs.append(cyl("sc_turret_cap", 0, ty, z + tr + 0.024, 0.0105, 0.006, mats["grip"], axis="Z", verts=20))
    objs.append(cyl("sc_turret_lw", -(tr + 0.008), ty, z, 0.012, 0.018, mats["metal"], axis="X", verts=20))
    rail_z = bore_z + sc.get("mount_base_rel", 0.045)
    for i, my in enumerate((y0 + 0.040, y_obj - 0.036)):
        h = max(0.005, (z - tr * 0.96) - rail_z)
        objs.append(box(f"sc_mount{i}", 0, my, rail_z + h / 2, 0.030, 0.017, h, mats["metal"]))
        objs.append(box(f"sc_mclamp{i}", 0, my, rail_z + 0.004, 0.040, 0.013, 0.010, mats["metal"]))

    # --- reticle: duplex cross + illuminated centre dot ---------------------
    # Amber and faintly emissive: a night DMR reticle is illuminated, and a
    # black reticle over a blue-hour sight picture is an invisible reticle.
    ry = y_obj - 0.010
    r_at = clear + (flare - clear) * ((ry - bore_y0) / max(1e-4, bore_y1 - bore_y0))
    r_out = r_at * 0.99
    thick_o, thick_i = 0.0022, 0.0008
    depth = 0.0012
    gap = r_at * 0.15
    mid = r_at * 0.50
    for sgn in (-1, 1):
        objs.append(box(f"rt_h_o{sgn}", sgn * (mid + r_out) / 2, ry, z,
                        r_out - mid, depth, thick_o, mats["reticle"], bevel=0))
        objs.append(box(f"rt_h_i{sgn}", sgn * (gap + mid) / 2, ry, z,
                        mid - gap, depth, thick_i, mats["reticle"], bevel=0))
        objs.append(box(f"rt_v_o{sgn}", 0, ry, z + sgn * (mid + r_out) / 2,
                        thick_o, depth, r_out - mid, mats["reticle"], bevel=0))
        objs.append(box(f"rt_v_i{sgn}", 0, ry, z + sgn * (gap + mid) / 2,
                        thick_i, depth, mid - gap, mats["reticle"], bevel=0))
    objs.append(cyl("rt_dot", 0, ry, z, 0.0011, 0.0012, mats["reticle"], axis="Y", verts=12))
    return objs


def build_muzzle_device(cfg, muzzle_y, bore_z, mats):
    objs = []
    md = cfg.get("muzzle_dev")
    if not md:
        return objs, muzzle_y
    r, ln, kind = md["r"], md["len"], md["kind"]
    if kind == "suppressor":
        objs.append(cyl("supp", 0, muzzle_y + ln * 0.35, bore_z, r, ln, mats["metal"], verts=28))
        for i, fy in enumerate((0.12, 0.62)):
            objs.append(cyl(f"supp_g{i}", 0, muzzle_y + ln * 0.35 - ln / 2 + ln * fy, bore_z, r * 1.06, 0.008, mats["metal"], verts=28))
        tip = muzzle_y + ln * 0.35 + ln / 2
    else:  # birdcage / brake: stepped rings
        objs.append(cyl("md_body", 0, muzzle_y + ln * 0.3, bore_z, r, ln, mats["metal"], verts=20))
        objs.append(cyl("md_ring1", 0, muzzle_y + ln * 0.3 + ln * 0.28, bore_z, r * 1.18, ln * 0.16, mats["metal"], verts=20))
        objs.append(cyl("md_ring2", 0, muzzle_y + ln * 0.3 - ln * 0.22, bore_z, r * 1.14, ln * 0.14, mats["metal"], verts=20))
        objs.append(cyl("md_crown", 0, muzzle_y + ln * 0.3 + ln / 2, bore_z, r * 0.55, 0.006, mats["metal"], verts=16))
        tip = muzzle_y + ln * 0.3 + ln / 2
    return objs, tip

def build_foregrip(fg, mats):
    objs = []
    if not fg:
        return objs
    objs.append(cyl("fg", 0, fg["y"], -fg["drop"] / 2 + 0.005, fg["r"], fg["drop"], mats["grip"], axis="Z", verts=14, r2=fg["r"] * 0.85))
    objs.append(cyl("fg_cap", 0, fg["y"], -fg["drop"] + 0.002, fg["r"] * 1.1, 0.008, mats["grip"], axis="Z", verts=14))
    return objs

def build_eject_plate(cfg, right_x, mats):
    e = cfg.get("eject")
    if not e:
        return [], None
    y, z = e["y"], e["z_rel"]
    plate = box("ej_plate", right_x + 0.001, y, z, 0.003, 0.052, 0.02, mats["metal"], bevel=0.0008)
    bump = box("ej_deflector", right_x + 0.004, y - 0.032, z, 0.007, 0.01, 0.016, mats["metal"])
    return [plate, bump], (right_x + 0.006, y, z)

# ---------------------------------------------------------------------------
# base mesh import + normalize
# ---------------------------------------------------------------------------
def import_base(cfg):
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC_WPN, cfg["src"]))
    mo = max([o for o in bpy.data.objects if o.type == "MESH"], key=lambda o: len(o.data.vertices))
    # de-parent, keep world transform
    mw = mo.matrix_world.copy()
    mo.parent = None
    mo.matrix_world = mw
    # kill everything else from the import
    for o in list(bpy.data.objects):
        if o is not mo and o.type in ("EMPTY", "ARMATURE", "MESH", "LIGHT", "CAMERA"):
            bpy.data.objects.remove(o, do_unlink=True)
    apply_all(mo)

    # raw frame: length along X, muzzle at -X, up +Z (blender import of Y-up glTF)
    xs = [v.co.x for v in mo.data.vertices]
    lo, hi = min(xs), max(xs)

    # sniper stock weld BEFORE scaling (raw coordinates)
    sf = cfg.get("stock_fix")
    if sf:
        for v in mo.data.vertices:
            if v.co.x > sf["gap_x_raw"]:
                v.co.x += sf["shift_raw"]
        xs = [v.co.x for v in mo.data.vertices]
        lo, hi = min(xs), max(xs)

    # bore line: median z of verts within probe range of the muzzle tip
    probe = [v.co.z for v in mo.data.vertices if v.co.x < lo + cfg["barrel_probe_raw"]]
    probe.sort()
    bore_z_raw = probe[len(probe) // 2] if probe else 0.1

    scale = cfg["length"] / (hi - lo)
    grip_x = cfg["grip_x_raw"]

    # transform: translate grip->origin, scale, rotate muzzle(-X)->(+Y)
    T = (Matrix.Rotation(D(-90), 4, "Z") @
         Matrix.Diagonal((scale, scale, scale, 1)) @
         Matrix.Translation((-grip_x, 0, 0)))
    mo.data.transform(T)
    mo.data.update()

    # measured landmarks in the build frame
    ys = [v.co.y for v in mo.data.vertices]
    muzzle_y = max(ys)
    bore_z = bore_z_raw * scale
    xs2 = [v.co.x for v in mo.data.vertices]
    right_x = max(xs2)
    mo.name = "base"
    return mo, muzzle_y, bore_z, right_x, scale

def assign_metal_regions(mo, mats, bore_z, cfg):
    """slot0 furniture (moulded polymer) / slot1 steel (barrel + muzzle) /
    slot2 rubberised grip / slot3 anodised receiver.

    W1 (iter05): the receiver slot is new. One material across receiver AND
    furniture is half of why the gun read as a single clay object — a real
    carbine shows an anodised alloy housing against matt polymer at every
    lighting angle, and that boundary is the eye's first "this is a made thing"
    cue at viewmodel range."""
    mo.data.materials.clear()
    mo.data.materials.append(mats["body"])
    mo.data.materials.append(mats["metal"])
    mo.data.materials.append(mats["grip"])
    mo.data.materials.append(mats["recv"])
    fg_y = cfg.get("barrel_y", cfg["length"] * 0.52)
    # receiver box: around the action, from just behind the grip line to the
    # rear of the handguard, at bore height. Measured off the build frame, so
    # it follows each weapon's own proportions rather than a magic number.
    rv_y0, rv_y1 = -0.075, min(fg_y * 0.72, 0.185)
    for p in mo.data.polygons:
        c = p.center
        if c.y > fg_y and abs(c.z - bore_z) < 0.05:
            p.material_index = 1     # exposed barrel/muzzle area
        elif c.z < -0.02 and abs(c.y) < 0.07:
            p.material_index = 2     # pistol grip region
        elif rv_y0 < c.y < rv_y1 and abs(c.z - bore_z) < 0.055:
            p.material_index = 3     # upper/lower receiver
        else:
            p.material_index = 0

# ---------------------------------------------------------------------------
# arms (rig-cut from soldier.glb)
# ---------------------------------------------------------------------------
_ARM_CACHE = {}

def _curl(pb, x_deg):
    pb.rotation_mode = "XYZ"
    pb.rotation_euler = Euler((D(x_deg), 0, 0), "XYZ")

def build_arm_chunks():
    """Returns {'R': obj, 'L': obj} canonical hand+forearm chunks (linked into
    the current scene; caller duplicates). Canonical frame: wrist at origin,
    fingers +Y, palm -Z."""
    if _ARM_CACHE:
        return _ARM_CACHE
    pre = set(bpy.data.objects)  # everything that existed before this import
    bpy.ops.import_scene.gltf(filepath=SRC_SOLDIER)
    imported = [o for o in bpy.data.objects if o not in pre]
    arm = next(o for o in imported if o.type == "ARMATURE")
    mesh = max([o for o in imported if o.type == "MESH"], key=lambda o: len(o.data.vertices))

    # grip pose: curl fingers (mixamo: local X curls), slight thumb wrap
    for side in ("Left", "Right"):
        for f, degs in (("Index", (55, 75, 55)), ("Middle", (62, 80, 60)),
                        ("Ring", (66, 82, 62)), ("Pinky", (70, 84, 64))):
            for j, dg in enumerate(degs, 1):
                pb = arm.pose.bones.get(f"mixamorig:{side}Hand{f}{j}")
                if pb: _curl(pb, dg)
        for j, dg in ((1, 28), (2, 30), (3, 24)):
            pb = arm.pose.bones.get(f"mixamorig:{side}HandThumb{j}")
            if pb: _curl(pb, dg)
    bpy.context.view_layer.update()

    # record hand bone frames (world) BEFORE applying
    frames = {}
    elbows = {}     # ForeArm bone HEAD (the elbow) — defines the cut-plane axis
    for side, key in (("Right", "R"), ("Left", "L")):
        pb = arm.pose.bones[f"mixamorig:{side}Hand"]
        elbows[key] = arm.matrix_world @ arm.pose.bones[f"mixamorig:{side}ForeArm"].head
        head = arm.matrix_world @ pb.head
        tail = arm.matrix_world @ pb.tail
        y_axis = (tail - head).normalized()          # fingers direction
        # T-pose palms face -Z (world down)
        z_axis = Vector((0, 0, 1))                    # back of hand up
        x_axis = y_axis.cross(z_axis).normalized()
        z_axis = x_axis.cross(y_axis).normalized()
        M = Matrix((
            (x_axis.x, y_axis.x, z_axis.x, head.x),
            (x_axis.y, y_axis.y, z_axis.y, head.y),
            (x_axis.z, y_axis.z, z_axis.z, head.z),
            (0, 0, 0, 1)))
        frames[key] = M

    # apply the armature so the curl is baked
    bpy.context.view_layer.objects.active = mesh
    for so in bpy.context.selected_objects: so.select_set(False)
    mesh.select_set(True)
    bpy.ops.object.convert(target="MESH")

    # ---- GLOVE MATERIAL (W1, iter05) --------------------------------------
    # MEASURED DEFECT: glove_albedo.png shipped at std 0.0142 with no normal
    # and no roughness map at all, so the hands read as "a featureless olive
    # mitten" to all three critics — on the very soldier atlas those same
    # critics call "the only surface in the battery with real texture
    # authorship". The old remap was the cause: luminance was crushed into a
    # 0.115-wide band (0.110 + 0.115*v), throwing away every seam, knuckle pad
    # and stitch line the atlas already carries.
    # THE RULE NOW: keep the authored detail, force only the HUE. Value is
    # EXPANDED about its own mean instead of compressed, and that same
    # luminance drives a derived NORMAL (Sobel) and ROUGHNESS map — so the
    # stitching and the rubberised knuckle/palm pads respond to light instead
    # of being painted on. Identical UV space, so it lands exactly.
    sol_img = None
    for m in mesh.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and any(
                        l.to_socket.name == "Base Color" for l in n.outputs["Color"].links):
                    sol_img = n.image
    glove_alb = os.path.join(GEN_DIR, "glove_albedo.jpg")
    glove_nrm = os.path.join(GEN_DIR, "glove_normal.png")
    glove_orm = os.path.join(GEN_DIR, "glove_orm.png")
    if sol_img and not os.path.exists(glove_alb):
        w, h = sol_img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        sol_img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        lum = 0.30 * px[..., 0] + 0.60 * px[..., 1] + 0.10 * px[..., 2]
        v = np.clip(lum, 0.0, 1.0)
        mu = float(v.mean())
        # W1 (iter05) MEASURED IN THE LIVE ADS FRAME: expanding contrast 1.45x
        # and then spreading it over a 0.285-wide band puts the soldier atlas's
        # light wrist-gauntlet region at sRGB 0.34 against a 0.06 glove palm —
        # an 18:1 ALBEDO ratio on one glove, which AgX then reads out as flat
        # white plates jammed on the wrist in S2. The atlas's own contrast is
        # right (the critics praise it on the character at S9); it must be
        # carried, not amplified. Slight expansion, narrower band, and the
        # variance the gate wants comes from the weave, not from a value split.
        vx = np.clip((v - mu) * 1.05 + mu, 0.0, 1.0) ** 0.95
        def _tile(a, n):
            return np.tile(a, (int(np.ceil(h / n)), int(np.ceil(w / n))))[:h, :w]
        weave = _tile(_n01(_fbm(64, 907, 3, 16)), 64)      # knit/rib structure
        grain = _tile(_n01(_fbm(128, 913, 3, 40)), 128)    # fibre grain
        # Floor LIFTED and range narrowed: the tell is the LINEAR ratio between
        # the light gauntlet and the dark palm, not the sRGB spread. 0.060+0.285
        # put those two at 19:1 in linear; 0.098+0.225 puts them at ~3.6:1, and
        # the variance the gate measures now comes from real fabric grain
        # instead of from a blocky value split.
        band = (0.098 + 0.300 * vx) * (0.88 + 0.24 * weave)
        band = band + 0.160 * (grain - 0.5) * (0.35 + 0.65 * vx)
        band = np.clip(band, 0.030, 0.60)
        px[..., 0] = np.clip(band * 0.98, 0, 1)
        px[..., 1] = np.clip(band * 1.00, 0, 1)
        px[..., 2] = np.clip(band * 0.63, 0, 1)
        px[..., 3] = 1.0
        img = bpy.data.images.new("glove_albedo", w, h, alpha=True)
        img.pixels.foreach_set(np.ascontiguousarray(px, dtype=np.float32).ravel())
        img.filepath_raw = glove_alb
        img.file_format = "JPEG"
        img.save(quality=93)
        # derived normal: the atlas luminance IS the glove's height field
        hh = 0.74 * np.clip((v - mu) * 1.4 + 0.5, 0, 1) + 0.14 * weave + 0.12 * grain
        hh = 0.6 * hh + 0.4 * (0.25 * (np.roll(hh, 1, 0) + np.roll(hh, -1, 0) +
                                       np.roll(hh, 1, 1) + np.roll(hh, -1, 1)))
        gx = np.roll(hh, -1, axis=1) - np.roll(hh, 1, axis=1)
        gy = np.roll(hh, -1, axis=0) - np.roll(hh, 1, axis=0)
        k = 5.5
        nx = -gx * k; ny = -gy * k; nz = np.ones_like(hh)
        ln = np.sqrt(nx * nx + ny * ny + nz * nz)
        # half-res: the glove is a small screen area and this map is embedded
        # in EVERY weapon GLB, so full-res grain here is pure download weight
        npx = np.stack([nx / ln * 0.5 + 0.5, ny / ln * 0.5 + 0.5,
                        nz / ln * 0.5 + 0.5, np.ones_like(hh)], axis=-1)[::2, ::2]
        nimg = bpy.data.images.new("glove_normal", w // 2, h // 2, alpha=True)
        nimg.pixels.foreach_set(np.ascontiguousarray(npx, dtype=np.float32).ravel())
        nimg.filepath_raw = glove_nrm
        nimg.file_format = "PNG"
        nimg.save()
        # roughness: the rubberised pads (the DARK atlas regions) are markedly
        # slicker than the nomex back of the hand
        rg = np.clip(0.995 - 0.42 * (1.0 - vx) - 0.22 * weave - 0.18 * (grain - 0.5),
                     0.46, 0.995)
        opx = np.stack([np.ones_like(rg), rg, np.zeros_like(rg), np.ones_like(rg)], axis=-1)[::2, ::2]
        oimg = bpy.data.images.new("glove_orm", w // 2, h // 2, alpha=True)
        oimg.pixels.foreach_set(np.ascontiguousarray(opx, dtype=np.float32).ravel())
        oimg.filepath_raw = glove_orm
        oimg.file_format = "PNG"
        oimg.save()
        _TEX_STATS["glove_albedo"] = {"kind": "albedo", "std": round(float(band.std()), 4),
                                      "mean": round(float(band.mean()), 4), "px": int(h)}
        _TEX_STATS["glove_orm"] = {"kind": "rough", "std": round(float(rg.std()), 4),
                                   "mean": round(float(rg.mean()), 4), "px": int(h)}
        _TEX_STATS["glove_normal"] = {"kind": "normal",
                                      "std": round(float((nx / ln).std() * 0.5), 4),
                                      "mean": round(float((nz / ln).mean()), 4), "px": int(h)}
    cuff_mat = _mat("br_cuff", None, (0.052, 0.058, 0.044), None, None,
                    rough_factor=0.93)
    glove = _mat("br_glove",
                 glove_alb if os.path.exists(glove_alb) else None,
                 (0.09, 0.095, 0.085),
                 glove_orm if os.path.exists(glove_orm) else None,
                 glove_nrm if os.path.exists(glove_nrm) else None,
                 rough_factor=0.88, normal_strength=1.0)

    # ---- W1 (iter03 fix): CLEAN GEOMETRIC CUT, never a weight-threshold delete
    # ROOT CAUSE of iter01-03's "shattered white polygon" viewmodel, isolated
    # this session by clay-rendering the shipped warden.glb with the gun hidden
    # (_shots/a4_fp + scratch iso renders): the RIFLE was always fine — 5.6k
    # clean tris, readable receiver/stock/mag/rail. The wreckage was the ARMS.
    # The old extraction deleted every vertex whose Hand+ForeArm skin-weight sum
    # fell under 0.45. A skin-weight isosurface is not a surface boundary: the
    # delete tore straight through the body shell, leaving ripped triangle fans,
    # interior holes and open cone mouths (backfaces reading as black gashes),
    # and the 0.22 decimate then shredded those open boundaries further.
    # Doctrine 1: never measure/cut against the bind pose - cut GEOMETRY.
    # Now: one planar half-space bisect perpendicular to the FOREARM BONE AXIS
    # at CUT_LEN behind the wrist. A half-space cut can never tear a shell; the
    # torso, the far arm and everything proximal fall entirely on the cleared
    # side, so what remains is exactly hand+forearm, watertight after the cut
    # loop is filled. Island-keep then drops any sliver the plane clipped.
    # Frame economy: at the Corvus ADS pose the trigger wrist is 0.21 m from
    # the vm camera, so every extra cm of stub is a cm closer to the eye.
    # 0.105 m = hand + a cuffed sleeve stub that leaves frame instead of
    # arriving at it. (0.19 was iter02, 0.155 still filled the ADS frame.)
    CUT_LEN = 0.105        # m of forearm kept behind the wrist
    for side, key in (("Right", "R"), ("Left", "L")):
        dup = mesh.copy()
        dup.data = mesh.data.copy()
        dup.name = f"arm_{key}"
        link(dup)

        # canonicalize FIRST (wrist -> origin, fingers +Y, palm -Z) so the cut
        # plane, the cuff and the island test all live in one frame.
        F = frames[key]
        dup.data.transform(F.inverted())
        dup.data.update()
        elbow_c = F.inverted() @ elbows[key]          # elbow in canonical space
        if elbow_c.length < 1e-4:
            elbow_c = Vector((0.0, -1.0, 0.0))
        e_dir = elbow_c.normalized()                  # wrist -> elbow

        bm = bmesh.new()
        bm.from_mesh(dup.data)
        # 0) WELD THE UV SEAMS FIRST. Measured this session: soldier.glb ships
        #    214,760 verts / 409,150 tris with 20,010 BOUNDARY edges — the mesh
        #    is split along every UV seam, so it is 20k open edges pretending to
        #    be a closed body. Every downstream op (cut, hole-fill, and above all
        #    DECIMATE COLLAPSE) treats a UV seam as a real silhouette boundary and
        #    rips along it: those are the jagged dark gashes down the forearm in
        #    the iter03 battery. Welding at 0.4 mm takes it to 204,493 verts / 32
        #    boundary edges — a genuinely closed shell that survives decimation.
        #    (Seam UVs collapse to one value; the glove albedo is a near-uniform
        #    olive luminance band, so there is nothing to smear.)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.0004)
        # 1) the cut. clear_outer removes the +normal side => the elbow side.
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        res = bmesh.ops.bisect_plane(
            bm, geom=geom, dist=1e-6,
            plane_co=tuple(e_dir * CUT_LEN), plane_no=tuple(e_dir),
            clear_outer=True)
        # 2) cap the single cut loop -> watertight tube mouth, no torn rim
        cut_edges = [e for e in res.get("geom_cut", [])
                     if isinstance(e, bmesh.types.BMEdge)]
        cap_faces = []
        if cut_edges:
            try:
                cap_faces = list(bmesh.ops.edgeloop_fill(bm, edges=cut_edges).get("faces", []))
            except Exception:
                cap_faces = list(bmesh.ops.triangle_fill(
                    bm, edges=cut_edges, use_beauty=True).get("geom", []))
                cap_faces = [f for f in cap_faces if isinstance(f, bmesh.types.BMFace)]
        # 3) island-keep: everything connected to the wrist, plus any shell
        #    (sleeve/glove cuff modelled as a separate skin) big enough to be
        #    real. Slivers the plane clipped off elsewhere go.
        bm.verts.ensure_lookup_table()
        seen, islands = set(), []
        for v in bm.verts:
            if v.index in seen:
                continue
            stack, isl = [v], []
            seen.add(v.index)
            while stack:
                cur = stack.pop()
                isl.append(cur)
                for e in cur.link_edges:
                    o2 = e.other_vert(cur)
                    if o2.index not in seen:
                        seen.add(o2.index)
                        stack.append(o2)
            islands.append(isl)
        # W1 (iter05): size alone was the wrong test. The bisect keeps ANY
        # >=120-vert island in the half-space, so plate-carrier pouches and
        # webbing that happen to fall forward of the cut plane survived and
        # rendered as loose white plates jammed into the wrist — visible at
        # macro range in the iter04/early-iter05 S2 ADS frame, and read by the
        # critics as "shattered polygon" viewmodel. An island also has to be
        # NEAR THE WRIST (the chunk's origin) to be part of a hand.
        doomed = []
        for isl in islands:
            near = min((v.co.length for v in isl), default=9.9)
            if len(isl) >= 60 and near <= 0.16:
                continue
            doomed.extend(isl)
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        # 4) belt-and-braces: nothing may still be open
        hole_faces = []
        try:
            hole_faces = list(bmesh.ops.holes_fill(
                bm, edges=[e for e in bm.edges if e.is_boundary],
                sides=0).get("faces", []))
        except Exception:
            pass
        # Every cap here is the INSIDE of a cut sleeve, not skin. Left on the
        # glove material it took the glove atlas AND a full specular hit from
        # the vm key rig, which is the flat white plate sitting on the wrist in
        # the S2 ADS frame. Matt black sleeve lining instead — a sleeve mouth
        # reads as a dark opening, never as a lit disc.
        for f in cap_faces + hole_faces:
            try:
                f.material_index = 1
            except ReferenceError:
                pass
        # 5) sleeve cuff sized off the arm's OWN section at the cut, measured
        #    from the section CENTROID (measuring from the canonical axis folds
        #    the offset into the radius and produces a pancake).
        cut_pt = e_dir * CUT_LEN
        band = [v.co for v in bm.verts
                if -0.004 < (v.co - cut_pt).dot(e_dir) < 0.030]
        if len(band) >= 8:
            ctr = Vector((0, 0, 0))
            for c in band:
                ctr += c
            ctr /= len(band)
            rs = sorted((c - ctr).length for c in band)
            cuff_r = min(rs[int(len(rs) * 0.92)], 0.045)   # a forearm is not 9 cm
            if cuff_r > 0.004:
                up = Vector((0, 0, 1))
                if abs(e_dir.dot(up)) > 0.95:
                    up = Vector((1, 0, 0))
                zc = e_dir
                xc = up.cross(zc).normalized()
                yc = zc.cross(xc).normalized()
                seat = ctr + e_dir * 0.002
                rot = Matrix(((xc.x, yc.x, zc.x, seat.x),
                              (xc.y, yc.y, zc.y, seat.y),
                              (xc.z, yc.z, zc.z, seat.z),
                              (0, 0, 0, 1)))
                pre_f = set(bm.faces)
                bmesh.ops.create_cone(
                    bm, cap_ends=True, cap_tris=False, segments=20,
                    radius1=cuff_r * 1.14, radius2=cuff_r * 1.04, depth=0.042,
                    calc_uvs=True, matrix=rot)
                # W1 (iter05): the cuff used to wear the GLOVE material, and
                # create_cone's calc_uvs wraps the circumference across the
                # full U range — so the soldier atlas was smeared around it as
                # bright horizontal bands. In iter04's S2 that band is the
                # white shiny lump under the optic. A sleeve cuff is plain matt
                # nomex; give it its own untextured slot instead of a stripe.
                n_cuff = 0
                for f in bm.faces:
                    if f not in pre_f:
                        f.material_index = 1
                        n_cuff += 1
                print(f"A4CUFF {key}: {n_cuff} faces -> br_cuff")
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(dup.data)
        bm.free()
        dup.data.update()
        dup.data.materials.clear()
        dup.data.materials.append(glove)
        dup.data.materials.append(cuff_mat)
        # decimate — collapse on a WATERTIGHT mesh stays watertight; 0.22 on
        # the old torn shells is what turned the rips into confetti.
        mod = dup.modifiers.new("dec", "DECIMATE")
        mod.ratio = 0.30
        apply_all(dup)
        shade_smooth(dup, 55)
        dup.name = f"arm_{key}"
        _ARM_CACHE[key] = dup

    # remove ONLY what the soldier import brought in (never the weapon parts)
    for o in imported:
        try:
            if o.name.startswith("arm_"):
                continue
            bpy.data.objects.remove(o, do_unlink=True)
        except ReferenceError:
            pass
    return _ARM_CACHE

def support_hand_seat(base, y, bore_z, half_w=0.024):
    """Underside of the handguard at station y (build frame) — the surface the
    support hand must actually wrap. W1: the old ARM_POSE hard-coded the left
    wrist ~9 cm BELOW the handguard on every rifle, so the support hand gripped
    empty air (visible in this session's clay render). Measured, not guessed."""
    zs = [v.co.z for v in base.data.vertices
          if abs(v.co.y - y) < 0.035 and abs(v.co.x) < half_w]
    if not zs:
        return bore_z - 0.030
    return min(zs)


def grip_seat(base, cfg, bore_z):
    """Centroid of the PISTOL-GRIP region of the base mesh, in build frame.
    W1 (iter03): the trigger-hand wrist was a hard-coded (0.035, -0.088, -0.088)
    for every rifle regardless of where that rifle's grip actually is, so the
    curled fingers closed inside the receiver and a fingertip poked out through
    the top of it (S6 capture this session). Same discipline as
    support_hand_seat: measure the mesh, do not guess. The region test matches
    assign_metal_regions' slot-2 rule so the hand lands on the polygons that are
    actually textured as the grip."""
    pts = [p.center for p in base.data.polygons
           if p.center.z < bore_z - 0.02 and abs(p.center.y) < 0.075]
    if not pts:
        return None
    n = len(pts)
    return (sum(p.y for p in pts) / n, sum(p.z for p in pts) / n)


def place_arms(wid, mats, pose_override=None):
    chunks = build_arm_chunks()
    placed = []
    for hand, loc, fingers, palm in (pose_override or ARM_POSE.get(wid, [])):
        src = chunks[hand]
        dup = src.copy()
        dup.data = src.data
        dup.name = f"arms_{hand}_{wid}"
        link(dup)
        y = Vector(fingers).normalized()
        z = -Vector(palm)                 # canonical -Z is the palm
        x = y.cross(z).normalized()
        z = x.cross(y).normalized()
        M = Matrix((
            (x.x, y.x, z.x, loc[0]),
            (x.y, y.y, z.y, loc[1]),
            (x.z, y.z, z.z, loc[2]),
            (0, 0, 0, 1)))
        dup.matrix_world = M
        placed.append(dup)
    return placed

# ---------------------------------------------------------------------------
# preview renders
# ---------------------------------------------------------------------------
VIEW = {  # posHip / zAds in glTF camera space (x right, y up, z back).
    # zAds MUST track core/weapons/weapon_data.js view.posAds[2] — the ADS
    # preview is worthless as a judgment view if it stands somewhere the game
    # never stands, and for an optic the eye distance IS the size of the sight
    # picture (build_scope's pinhole-cone note).
    "warden": {"posHip": (0.165, -0.185, -0.34), "zAds": -0.26},
    "vesper": {"posHip": (0.155, -0.175, -0.30), "zAds": -0.24},
    "corvus": {"posHip": (0.175, -0.195, -0.40), "zAds": -0.228},
    "pike":   {"posHip": (0.145, -0.165, -0.27), "zAds": -0.22},
}

def add_area(name, loc, energy, color, size, rot):
    l = bpy.data.lights.new(name, "AREA")
    l.energy = energy; l.color = color; l.size = size
    o = bpy.data.objects.new(name, l)
    o.location = loc; o.rotation_euler = rot
    return link(o)

def preview_lights():
    # night-adjacent neutral judgment lighting (the game scene is a night
    # storm — a hot studio setup lies about how dark materials will read)
    add_area("key", (0.9, -1.1, 1.1), 70, (1.0, 0.93, 0.82), 1.1, (D(48), 0, D(35)))
    add_area("fill", (-1.2, -0.8, 0.4), 24, (0.66, 0.78, 1.0), 1.5, (D(66), 0, D(-58)))
    add_area("rim", (0.2, 1.4, 0.9), 60, (0.85, 0.92, 1.0), 0.9, (D(-52), 0, D(168)))

def cam_at(pos, rot=(90, 0, 0), fov_v=60):
    c = bpy.data.cameras.new("pc")
    c.sensor_fit = "VERTICAL"; c.lens_unit = "FOV"; c.angle_y = D(fov_v)
    c.clip_start = 0.005
    o = bpy.data.objects.new("pcam", c)
    o.location = pos
    o.rotation_euler = tuple(D(a) for a in rot)
    link(o)
    bpy.context.scene.camera = o
    return o

def render(path, x=1600, y=900):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = x; sc.render.resolution_y = y
    if not sc.world:
        sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.045, 0.055, 0.07, 1)
        bg.inputs[1].default_value = 1.0
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

def previews(wid, sight_z):
    v = VIEW[wid]["posHip"]
    # camera-space -> build frame: (a,b,c) -> (a, -c, b); camera at -gunpos
    cam_pos = (-v[0], v[2], -v[1])
    preview_lights()
    cam_at(cam_pos, (90, 0, 0), 60)
    render(os.path.join(PREV_DIR, f"{wid}_hip.png"))
    # ADS: camera on the sight line: gun at (0,-sightY,zAds) rel cam
    z_ads = VIEW[wid].get("zAds", v[2] * 0.76)
    bpy.context.scene.camera.location = (0, z_ads, sight_z)
    render(os.path.join(PREV_DIR, f"{wid}_ads.png"))
    # closeup 3/4 for material judgment
    bpy.context.scene.camera.location = (-0.30, -0.42, 0.22)
    bpy.context.scene.camera.rotation_euler = (D(70), 0, D(-32))
    render(os.path.join(PREV_DIR, f"{wid}_close.png"))
    # grip closeup — hand-pose tuning view (right side, looking at the grip)
    bpy.context.scene.camera.location = (0.22, -0.16, 0.02)
    bpy.context.scene.camera.rotation_euler = (D(84), 0, D(55))
    render(os.path.join(PREV_DIR, f"{wid}_grip.png"))

# ---------------------------------------------------------------------------
# per-weapon build
# ---------------------------------------------------------------------------
def build(wid):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _ARM_CACHE.clear()  # per-weapon fresh scene invalidates cached objects
    cfg = CFG[wid]

    # W1 (iter05) ORDER MATTERS NOW: the mesh comes in FIRST, because the
    # texture set is baked against THIS weapon's geometry (edge wear, crevice
    # grime, muzzle/port fouling, hand polish, axial/radial machining). Import
    # and weld, measure, bake, then author the textures and the materials.
    base, muzzle_y, bore_z, right_x, scale = import_base(cfg)
    weld_mesh(base)                      # W1 (iter03) — before any cutting
    chans = mesh_wear_channels(base, cfg, bore_z, muzzle_y, right_x)
    masks = bake_channels_to_uv(base, chans, TEX_SIZE)
    tex = gen_textures(wid, masks)
    mats = make_materials(tex)
    assign_metal_regions(base, mats, bore_z, cfg)

    parts = [base]
    # ---- W1: SURGICAL strips only -------------------------------------------
    # iter02's shattered-viewmodel root cause lived here: the old build called
    # strip_top over a ~50 cm centreline channel (rail y0-0.01 .. muzzle-0.05 at
    # bore+0.026) AND a 10 cm-wide front-half channel, deleting the whole spine
    # out of a perfectly good 5.9k-tri AR — torn triangle fans everywhere — then
    # stacked a fabricated rail and a 22 cm 'cheek_plate' slab on top of the
    # wreckage. Verified by clay-rendering the shipped GLB this session.
    # The base meshes carry their own rail and sight bosses; we now remove ONLY
    # the two mushy bosses (a few cm each) and seat crisp sights on the mesh's
    # own rail plane. No fabricated rail, no cheek plate.
    for sr in (cfg.get("strip_regions") or []):
        strip_top(base, sr["y0"], sr["y1"], bore_z + sr["z_rel"], sr["half_w"])

    sight_z = bore_z + cfg["sight_h"]
    if cfg["sights"] == "pistol":
        # sights ride the slide top: find top of mesh near centerline
        top = max(v.co.z for v in base.data.vertices if abs(v.co.x) < 0.01)
        sight_z = top + 0.006
        parts += build_sights("pistol", top, sight_z, muzzle_y - 0.02, -0.03, mats)
    elif cfg["sights"] != "none":
        iron = cfg.get("iron") or {}
        base_z = bore_z + cfg.get("iron_base_rel", 0.030)   # the MESH's rail plane
        y_front = iron.get("front_y", muzzle_y - 0.05)
        y_rear = iron.get("rear_y", -0.02)
        parts += build_sights(cfg["sights"], base_z, sight_z, y_front, y_rear, mats)
    parts += build_scope(cfg, bore_z, mats)
    md_objs, muzzle_tip_y = build_muzzle_device(cfg, muzzle_y, bore_z, mats)
    parts += md_objs
    parts += build_foregrip(cfg.get("foregrip"), mats)
    ej_objs, ej_pos = build_eject_plate(cfg, right_x, mats)
    parts += ej_objs

    # UVs for authored parts (noise textures forgive seams)
    uv_cube_project([p for p in parts if p is not base],
                    cube_size=measure_uv_density(base))
    for p in parts:
        if p is not base:
            apply_all(p)
            shade_smooth(p, 35)
    # W1 (iter05): 40 deg left the base meshes' 8-sided handguard/barrel tubes
    # (45 deg between faces) flat-shaded — that is the "visible polygon facets"
    # all three critics named on the viewmodel. 52 deg smooths a tube run and
    # still holds a receiver corner hard.
    shade_smooth(base, 52)

    # join all dressing into ONE mesh (material slots survive a join) — the
    # first bootcheck measured ~70 draws per gun from loose rail notches;
    # the vm must cost ~6-8 draws inside the 320-draw firefight budget
    dressing = [p for p in parts if p is not base]
    if dressing:
        for o in bpy.context.selected_objects: o.select_set(False)
        for o in dressing: o.select_set(True)
        bpy.context.view_layer.objects.active = dressing[0]
        bpy.ops.object.join()
        joined = bpy.context.view_layer.objects.active
        joined.name = "dressing"
        parts = [base, joined]

    # arms — support hand seated on the MEASURED handguard underside (W1)
    if cfg.get("arms"):
        pose = [list(p) for p in ARM_POSE.get(wid, [])]
        gs = grip_seat(base, cfg, bore_z)
        if gs is not None:
            gy, gz = gs
            for p in pose:
                if p[0] == "R":
                    # wrist just behind and below the grip centroid: the curled
                    # fingers then close ON the backstrap instead of inside the
                    # receiver (W1 iter03, see grip_seat).
                    p[1] = (p[1][0], gy - 0.028, gz - 0.022)
        lh_y = cfg.get("lh_y")
        if lh_y is not None:
            seat = support_hand_seat(base, lh_y, bore_z)
            for p in pose:
                if p[0] == "L":
                    # wrist sits under the handguard so the curled fingers
                    # close ON it. W1 (iter03): 3.2 cm put the palm INSIDE the
                    # handguard — the fingertips poked out through the top of
                    # the rail (S6 capture). 4.6 cm seats the grip on the
                    # underside where a support hand actually goes.
                    p[1] = (p[1][0], lh_y, seat - 0.046)
        pose = [tuple(p) for p in pose]
        parts += place_arms(wid, mats, pose_override=pose)

    # sockets
    mz = bpy.data.objects.new("SOCKET_muzzle", None)
    mz.location = (0, muzzle_tip_y, bore_z)
    link(mz)
    ej = bpy.data.objects.new("SOCKET_eject", None)
    ej.location = ej_pos if ej_pos else (right_x, 0.03, bore_z)
    link(ej)
    # W1 (iter03): SOCKET_sight — the sight line, baked. weapon_data.js's
    # view.sightY is a HAND-COPIED number and it drifts (warden shipped 0.126
    # against a built 0.134 = 8 mm = ~1.8 deg of ADS error at the 0.26 m pose).
    # With the socket in the file, weapon_meshes.js aligns the prototype to the
    # DECLARED sightY at load, so ADS is pixel-correct by construction whatever
    # weapon_data says. Never re-derive the sight height at runtime — read it.
    sg = bpy.data.objects.new("SOCKET_sight", None)
    sg.location = (0, 0, sight_z)
    link(sg)

    # VT §3 / doctrine §5: a flat hero texture never leaves this function.
    assert_texture_variance()

    # previews
    previews(wid, sight_z)

    # export
    out = os.path.join(OUT_DIR, f"{wid}.glb")
    for o in bpy.context.scene.collection.objects: o.select_set(False)
    for o in parts + [mz, ej, sg]:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_apply=True, export_image_format="AUTO",
        export_yup=True,
    )

    report = {
        "weapon": wid, "glb": out,
        "muzzle_tip": [0, round(bore_z, 4), round(-muzzle_tip_y, 4)],  # glTF space [x,y,z]
        "eject": [round(ej_pos[0], 4), round(ej_pos[2], 4), round(-ej_pos[1], 4)] if ej_pos else None,
        "sightY": round(sight_z, 4),
        "scale_applied": round(scale, 4),
        "bytes_raw": os.path.getsize(out),
    }
    print("A4BUILD " + json.dumps(report))
    return report

ids = ONLY or list(CFG.keys())
reports = []
for wid in ids:
    reports.append(build(wid))
print("A4DONE " + json.dumps([r["weapon"] for r in reports]))
