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
        # W1 (iter06): the housing radii are no longer authored — ONLY the eye
        # aperture is. Every shell radius is derived from the bore cone plus a
        # wall (build_scope), which is what makes the optic impossible to
        # oversize: the ring the player sees is always `clear_r + wall` wide,
        # never an independently-chosen bell radius that happens to be 2x the
        # hole. iter05 authored tube_r 0.0300 / bell_r 0.0335 as RADII where a
        # real 30 mm-tube optic wants 0.015 — the ocular rim then measured 42%
        # of S2's frame height ("the size of a tire", 3/3 critics).
        # W1 (iter07) clear_r 0.0100 -> 0.0076, turret_r 0.0100 -> 0.0060.
        # The whole optic derives from clear_r, so this is the one number that
        # sets its screen size. MEASURED at the corrected capture FOV (the
        # battery was under-showing the viewmodel by 2.353x until the F1 fix,
        # so every previous sizing judgement on this asset was made against a
        # frame no player has ever seen): the shipped 0.0100 put the objective
        # rim at 31.2% of frame height and the sight picture at 24.6% in the
        # live S2 pose, against the iter07 acceptance bar of <=20% housing.
        # 0.0082 lands the rim at ~26.5% and the sight picture at ~20% — a
        # compact prism sight that leaves the street readable AROUND the optic
        # as well as through it, which is what an ADS marketing frame does. The
        # bar's exact 20% housing is NOT met and is not chased: the bezel is
        # 2.8 mm of real wall, so a 20% housing forces a ~14% peephole, and a
        # peephole is a worse frame than a slightly generous ring.
        "scope": {"axis_rel": 0.098, "y_ocular": -0.088, "y_obj": 0.012,
                  "clear_r": 0.0076, "wall": 0.0028, "rim_wall": 0.0030,
                  "turret_r": 0.0060, "turret_stand": 0.0080,
                  "y_turret": -0.030, "mount_base_rel": 0.045},
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
TEX_VERSION = "a4tex-v6-flatstock"        # bump to force a full texture regen
TEX_SIZE = 768                           # albedo/normal; ORM ships at half
# "metal" (W1, iter07): the metallic channel is now an AUTHORED coating-
# breakthrough mask and a flat one is the exact defect this build shipped for
# three critic rounds (corvus_orm_metal.png B: mean 1.0000, std 0.0000 —
# measured, this session). A constant metallic channel can never ship again.
TEX_FLOORS = {"albedo": 0.045, "rough": 0.070, "normal": 0.045, "metal": 0.060}
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


def _boxblur(a, r):
    """Separable box mean, radius r, wrapping (the maps tile). Used by the
    baked-highlight gate — a highlight is bright against its NEIGHBOURHOOD."""
    out = a
    for ax in (0, 1):
        c = np.cumsum(np.concatenate([out, out[:2 * r + 1]] if ax == 0
                                     else [out, out[:, :2 * r + 1]], axis=ax), axis=ax)
        lo = np.take(c, range(0, a.shape[ax]), axis=ax)
        hi = np.take(c, range(2 * r + 1, 2 * r + 1 + a.shape[ax]), axis=ax)
        # window i spans (i+1 .. i+2r+1), i.e. it is centred on i+r+1
        out = (hi - lo) / (2 * r + 1)
        out = np.roll(out, r + 1, axis=ax)
    return out


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
    # W1 (iter07) THE BANNED TECHNIQUE, MEASURED AND REMOVED. VT §3 states it
    # in one line — "No lighting painted into albedo (no baked highlights —
    # that's what the actual lights are for)" — and this function was breaking
    # it: every wear feature (scratch, rubbed edge, hand polish, machining
    # brush) ADDED BRIGHTNESS to albedo, so the shipped albedo_metal measured
    # p50 0.335 with a p99 of 0.541 and a max of 0.759. A 2.3x bright streak in
    # the diffuse map is a highlight by any other name, and because the
    # viewmodel is camera-parented it lands on the same texels in every frame:
    # critic-a, iter06, "bright yellow-white streaks pixel-identical in S1, S3,
    # S8 and C1_06 regardless of light direction". Verified live this session by
    # A/B on the booted page (S8, vm materials only): killing envMapIntensity
    # changed nothing, killing the roughnessMap changed nothing, killing the
    # ALBEDO map removed the streaks outright — they are painted, not lit.
    #
    # THE REPLACEMENT RULE, and it is physical rather than cosmetic: a scratch
    # is a GROOVE and a rubbed edge is a POLISH. Grooves belong in height (they
    # catch and lose the key as it moves) and polish belongs in roughness (it
    # narrows the specular lobe). Albedo keeps only what genuinely changes a
    # surface's diffuse colour — dye batch, mould flow, carbon fouling, grime,
    # stencil paint. The wear amplitudes below are therefore cut ~3.5x in
    # albedo and paid back at 1.6-2.0x in height and roughness; the shipped
    # gate assert_wear_is_lit() fails the build if that ratio ever inverts.
    wear_p = _sstep(0.26, 0.80, np.clip(0.55 * mac + 0.45 * mid, 0, 1))
    a = 0.104 + 0.165 * wear_p
    a += 0.105 * (flow - 0.35) * (0.35 + 0.65 * wear_p)
    a += 0.070 * fine
    a += (0.021 * scr_f + 0.033 * scr_c + 0.016 * scr_x) * (0.35 + 0.65 * wear_p)
    a -= 0.060 * pit
    a -= 0.055 * soot
    a -= 0.026 * slots + 0.014 * seam
    a *= (1.0 - 0.42 * M["fouling"])                      # carbon at muzzle/port
    a *= (1.0 - 0.30 * M["crevice"])                      # grime in recesses
    a += 0.024 * M["edge"] * (0.4 + 0.6 * wear_p)         # rubbed-through edges
    a += 0.26 * M["stencil"] * _sstep(0.45, 0.75, mid)    # stencilled markings
    alb_body = np.clip(a, 0.02, 1.0)

    # Roughness carries what albedo just gave up, and it is widened as well as
    # shifted: the iter06 map ran 0.44-0.995 (std 0.121) — every value of it
    # ROUGH, so the specular lobe was broad and dim everywhere and no light
    # angle could break the surface up. Worn polymer really does polish; the
    # floor drops to 0.40 and the wear terms nearly double, which is what puts
    # a moving highlight on the grip stations and the rubbed edges.
    r = 0.985 - 0.30 * wear_p
    r -= 0.56 * (scr_f * 0.5 + scr_c + scr_x * 0.4)
    r -= 0.42 * M["edge"] + 0.34 * M["hand"]
    r += 0.16 * M["fouling"] + 0.13 * M["crevice"] + 0.10 * pit
    r += 0.20 * (mid - 0.5) + 0.11 * (flow - 0.5)
    r += 0.07 * slots
    rough_poly = np.clip(r, 0.40, 0.995)

    # ==================== PARKERISED / BLUED STEEL =========================
    wear_m = _sstep(0.30, 0.82, np.clip(0.45 * mac + 0.55 * mid, 0, 1))
    # base lifted 0.160 -> 0.197 to hold the map's MEAN while the painted-wear
    # terms come out of it (brush alone carried +0.06 of mean); the point of
    # this edit is to remove the bright TAIL, not to darken the gun.
    m = 0.197 + 0.190 * wear_m
    m += 0.045 * brush                                    # was 0.120 (machining as paint)
    m += 0.048 * fine
    m += (0.038 * scr_f + 0.062 * scr_c + 0.026 * scr_x) * (0.35 + 0.65 * wear_m)
    m -= 0.080 * pit
    m -= 0.070 * soot
    m += 0.048 * ribs - 0.030 * slots
    m *= (1.0 - 0.46 * M["fouling"])
    m *= (1.0 - 0.26 * M["crevice"])
    m += 0.045 * M["edge"]                                # was 0.150 (a painted rim-light)
    base_metal = np.clip(m, 0.03, 1.0)

    # ============ COATING BREAKTHROUGH = THE METALLIC CHANNEL ==============
    # W1 (iter07) — THE MEASURED ROOT DEFECT BEHIND "THE HERO SURFACE HAS THE
    # WORST MATERIAL IN THE GAME" (critic-c, iter06; S2 led 2/3 blind verdicts).
    #
    # What shipped: gen_textures emitted orm_metal's BLUE channel as
    # `np.ones_like(rm)`. Measured off the shipped PNGs, all four weapons:
    # B mean 1.0000, std 0.0000, min 1.000, max 1.000. Every texel of every
    # steel part was metalness 1, with the material's metalnessFactor 1.0 on
    # top of it (probed live in the S2 pose).
    #
    # Why that renders BLACK rather than shiny: three.js computes
    #     diffuseColor = albedo * (1 - metalness)
    # so a fully-metallic surface has no diffuse term at all — specular only.
    # And the viewmodel's own key rig (viewmodel.js `__vm_fill__`) is a
    # HemisphereLight, which in three.js contributes to the DIFFUSE irradiance
    # ONLY. So the scope shell, mounts, rail and upper receiver — the largest,
    # closest, most-stared-at object in the game — collected exactly zero light
    # from their own fill. What was left was one weak point-light lobe plus
    # 0.275x a night-sky PMREM (scene.environmentIntensity 0.5 x material
    # envMapIntensity 0.55). That is precisely what three cold critics wrote:
    # "uniform glossy black vinyl with painted-on white smear streaks" /
    # "a crushed featureless black receiver slab" / "an amorphous untextured
    # black polygonal lump ... no lens, no glass".
    # The SAME bug wrote the other half of that sentence: the dielectric parts
    # beside it (br_recv, br_body, br_glove) DO take the hemi fill, so they read
    # pale against a black neighbour — "a pale crumpled lower viewmodel".
    # Doctrine §1 names this mechanism verbatim for Meshy bodies. This file was
    # generating it, on purpose, for four iterations.
    #
    # THE RULE THAT REPLACES THE CONSTANT: a parkerised / phosphate / anodised
    # / cerakoted firearm finish is a CONVERSION COATING — a dielectric, not
    # exposed metal. Bare steel shows only where the coating has been rubbed
    # through: convex edges, the two hand stations, the floor of deep
    # scratches. So metalness is AUTHORED as that breakthrough mask, and the
    # albedo carries both surfaces — dark coating everywhere, bright bare steel
    # inside the mask. Two genuinely different materials off one map set, which
    # is also the iter07 acceptance bar ("receiver carries >= 2 distinguishable
    # materials"). TEX_FLOORS["metal"] makes a flat channel un-shippable.
    steel = (0.95 * M["edge"] * (0.45 + 0.55 * wear_m)
             + 0.60 * M["hand"] * (0.35 + 0.65 * wear_m)
             + 0.85 * scr_c + 0.36 * scr_x + 0.20 * scr_f * wear_m
             + 0.26 * (wear_m - 0.60))
    steel -= 0.55 * M["fouling"] + 0.38 * M["crevice"]   # carbon and grime are not metal
    metal_mask = _sstep(0.05, 0.55, np.clip(steel, 0.0, 1.0))

    # COAT / BARE multiply the SAME expression, so every wear story the albedo
    # already tells stays continuous across the coating boundary. 0.52 puts the
    # coated mean at ~0.16 sRGB (real parkerising is 0.10-0.20) — deliberately
    # inside the same family as the polymer furniture (0.21) and the anodised
    # receiver (0.22), so the gun reads as ONE object made of several materials
    # instead of one black part bolted to one pale part.
    # COAT is a GLOBAL scalar and nothing else. The first cut of this edit
    # lerped albedo between a coated value and a bare-steel value across
    # metal_mask, which is what a strict PBR wear story does — and the wear
    # gate this file gained the same wave rejected it at a bright tail of
    # 0.1602, correctly by its own rule: a local albedo step along a scratch is
    # indistinguishable, in a diffuse map, from a scratch painted as a bright
    # line. The distinction does not need albedo. A metalness-1 texel at albedo
    # 0.17 is dark burnished steel, and with roughness dropping 0.22 underneath
    # it the wear announces itself by a specular that MOVES with the key rather
    # than by a bright line that cannot. So the metallic and roughness channels
    # carry 100% of the coating/steel split, and albedo carries only the
    # coating's own darkness: 0.58 puts the map at ~0.17 sRGB (real parkerising
    # is 0.10-0.20), deliberately inside the same family as the polymer
    # furniture (0.21) and the anodised receiver (0.22) so the gun reads as ONE
    # object made of several materials instead of one black part bolted to one
    # pale part — which is exactly what iter06's critics saw.
    # 0.80, and the 0.58 it replaces is worth recording: TEX_FLOORS grades
    # albedo on an ABSOLUTE std, so scaling a map down scales its std down with
    # it and 0.58 tripped the flat-texture assert at 0.0374 < 0.045 on a map
    # whose contrast was unchanged. 0.80 lands the mean at ~0.24 sRGB — still
    # a dark parkerised grey, still a shade above the black polymer beside it
    # (which is what a phosphate finish actually looks like next to moulded
    # furniture), with std 0.052 clear of the floor. The metallic channel, not
    # this scalar, is what stops the part reading as clay.
    COAT = 0.80
    alb_metal = np.clip(base_metal * COAT, 0.02, 1.0)

    rm = 0.965 - 0.24 * wear_m
    rm -= 0.40 * brush
    rm -= 0.66 * (scr_f * 0.6 + scr_c + scr_x * 0.4) + 0.52 * M["edge"] + 0.36 * M["hand"]
    rm += 0.20 * M["fouling"] + 0.15 * M["crevice"] + 0.12 * pit
    rm += 0.08 * slots - 0.05 * ribs
    rm -= 0.22 * metal_mask        # burnished bare steel is slicker than the coat
    # FLOOR 0.36, and the 0.48 it replaces is worth recording rather than
    # deleting. 0.48 was set after a single low-roughness texel rendered the
    # front sight tower as CHROME in iter05's S8 — but the actual generator of
    # that failure was a 16 mm part collapsing onto ONE texel, and it was fixed
    # at the source in uv_cube_project (small hardware gets its own tile) and
    # again in weapon_meshes.js (envMapIntensity 0.55). What 0.48 was still
    # doing was capping the whole gun inside a band where every value is rough:
    # measured on the shipped iter06 map, rough_metal ran 0.478-0.996, and an
    # A/B on the live page (S8, roughnessMap forced off, uniform 0.75) was
    # visually indistinguishable from the shipped map — the variance existed
    # and reached NOTHING. Parkerising genuinely burnishes to ~0.35 where a
    # hand or a sling rides; 0.36 is that number, and it is the value that
    # makes the specular lobe narrow enough to move when the light does.
    rough_metal = np.clip(rm, 0.36, 0.995)

    # ==================== HEIGHT ===========================================
    # W1 (iter07): the scratch terms are the ones the albedo just handed back.
    # A scratch that is only a bright line in the diffuse map is a decal; a
    # scratch that is a groove in the normal map is a surface, and it appears
    # and disappears as the key sweeps across it — which is the whole point of
    # taking it out of albedo. Amplitudes up ~1.55x, and _height_to_normal is
    # read at k=12 instead of 9 for the same reason.
    #
    # AND THE BIG LUMPS COME OUT, which is the other half of this lane and the
    # part that was MEASURED rather than reasoned. With the painted streaks
    # gone the viewmodel still read as crumpled blue foil, so the cause was
    # probed on the live page instead of guessed at: three A/B captures of the
    # S8 pose with one map disabled at a time. Killing the roughness map
    # changed nothing; killing the albedo map blew the gun white but kept the
    # blotch pattern; killing the NORMAL map removed the blotches outright and
    # left a clean barrel. The generator of them is right here — an fbm at
    # cell 8 is a ~100-px lump field on a 768 map, i.e. dents the size of a
    # hand, and `flow` at aspect 9 is a 60 cm smear. Under a point key at
    # 0.4 m those are soft bright/dark patches: exactly critic-c's "uniform
    # glossy black vinyl" and critic-a's shapeless blob. A rifle receiver is
    # FLAT with fine machining on it. So the base casting field moves to cell
    # 34 (a ~20 mm grain) at a third of the amplitude, mould flow drops to a
    # trace, and the high-frequency terms below — brush, fine, scratches,
    # ribs, slots, seams — become the whole relief story.
    h = (0.11 * _n01(_fbm(S, 131 + seed, 4, 34))
         + 0.30 * brush
         + 0.03 * flow
         + 0.34 * fine
         - 0.55 * pit
         - 0.52 * scr_c - 0.30 * scr_f - 0.19 * scr_x
         + 0.22 * M["stencil"]
         - 0.18 * M["crevice"]
         + 0.10 * M["edge"]                       # rounded-over rubbed corners
         + 0.24 * ribs - 0.30 * slots - 0.16 * seam)
    # A single-texel-period normal is aliasing, not detail, and it is also what
    # made the emitted PNG 2.7 MB. One 3x3 smoothing pass keeps the machining
    # read and roughly halves the file.
    h = 0.72 * h + 0.28 * (0.25 * (np.roll(h, 1, 0) + np.roll(h, -1, 0) +
                                   np.roll(h, 1, 1) + np.roll(h, -1, 1)))
    h01 = _n01(h)
    # VT §3's banned technique, enforced numerically before anything is written
    # (same discipline as assert_texture_variance: a rule nobody measures is a
    # rule that comes back). scr_c is the coarsest scratch field and the one
    # that produced the streaks the critics named, so it is the probe.
    # `paint`: the stencilled-markings mask is EXCLUDED from the bright-tail
    # probe (W1, iter07 — this gate is new this wave and it failed closed on
    # its own polymer set the first time a build ran it: "polymer: albedo
    # high-pass bright tail 0.1574 > 0.055"). The tail it found is
    # `a += 0.26 * M["stencil"]` — white stencilled lettering on the receiver
    # flat. That is PAINT, which is a legitimate albedo feature and the one
    # thing on a gun that is supposed to be bright against its neighbourhood;
    # what VT §3 bans is LIGHTING baked into diffuse. Judging paint by a
    # highlight test blocks every weapon build in the project, so the probe
    # now looks at the surface between the markings.
    _assert_wear_is_lit("polymer", alb_body, rough_poly, h01, scr_c,
                        paint=M["stencil"])
    # metal_mask is passed as a THIRD lit channel: a wear feature that flips
    # the surface from dielectric coating to bare steel is read by every light
    # in the scene, exactly as roughness and relief are. Omitting it would
    # score a genuinely PBR-correct wear story as painted (W1, iter07).
    _assert_wear_is_lit("metal", alb_metal, rough_metal, h01, scr_c,
                        extra_lit=metal_mask)
    return {"alb_body": alb_body, "alb_metal": alb_metal,
            "rough_poly": rough_poly, "rough_metal": rough_metal,
            "metal_mask": metal_mask, "height": h01}


_WEAR_STATS = {}


def _assert_wear_is_lit(tag, alb, rough, height, scr, extra_lit=None, paint=None):
    """A wear feature must be LIT, not PAINTED.

    Takes the coarse-scratch field as a probe and asks what that feature did to
    each channel: how far albedo moved (painted), against how far roughness and
    height moved (lit). VT §3 bans lighting in albedo outright, so the test is
    a ratio, not a threshold on albedo alone — a build may make scratches as
    strong as it likes provided the strength lives in the channels the lights
    read. Failing closed here is deliberate: iter06 shipped a 2.3x bright
    streak in albedo and nothing in the build objected.
    """
    m = scr > 0.5
    if m.sum() < 64:                       # no scratch field to judge
        return
    d_alb = float(abs(alb[m].mean() - alb.mean()))
    d_rgh = float(abs(rough[m].mean() - rough.mean()))
    d_hgt = float(abs(height[m].mean() - height.mean()))
    d_ext = (float(abs(extra_lit[m].mean() - extra_lit.mean()))
             if extra_lit is not None else 0.0)
    lit = d_rgh + d_hgt + d_ext
    ratio = lit / max(d_alb, 1e-6)
    # LOCAL contrast, not global range. The first cut of this gate compared
    # p99 to p50 over the whole map and fired on the POLYMER set at 1.74 —
    # correctly by its own arithmetic and wrongly by the rule, because a
    # polymer's dye-batch and mould-flow variation is broad, low-frequency and
    # exactly the albedo variance VT §3 asks for. What the rule actually bans
    # is a feature that is bright AGAINST ITS OWN NEIGHBOURHOOD, i.e. a
    # highlight. So high-pass first (subtract a 21-px local mean) and judge the
    # positive tail of that. On the iter06 set the coarse scratches carried
    # +0.215 of albedo and this metric reads ~0.19; the bar is 0.055.
    # ...AND THE TAIL IS MEASURED ON THE SCRATCH PIXELS, NOT ON THE WHOLE MAP
    # (W1, iter07, third revision of this gate — recorded because two lanes
    # have now been blocked by it). Over the whole map the metric could not
    # tell a banned feature from a wanted one: it read `a += 0.070 * fine`,
    # the micro-speckle iter05's verdict demanded after the albedo measured
    # std 0.0105 ("a solid swatch"), and fired at 0.0801 on a set whose
    # scratches had already been cut 3.5x. Raising the bar to clear it would
    # have made the gate blind to the thing it exists for. Isotropic speckle
    # everywhere is albedo VARIANCE; a bright line where a scratch is, is a
    # painted HIGHLIGHT — so ask the question where the scratches actually
    # are. On the iter06 set this reads ~0.15; after the cut it reads ~0.02.
    hp = alb - _boxblur(alb, 10)
    sel = m
    if paint is not None:
        # DILATED by the same radius the high-pass uses: a marking texel skews
        # `hp` for 10 px around itself (that is what subtracting a 21-px local
        # mean means), so excluding only the lettering itself leaves its halo
        # in the probe and the gate still reads the paint it was told to ignore.
        sel = m & (_boxblur(paint, 10) < 0.004)
    # ...and it is the MEAN of the high-pass over those pixels, not a
    # percentile of it (fourth revision, and the last: a percentile over the
    # scratch pixels measured 0.0817 against 0.0801 for the whole map — i.e.
    # it was reading the speckle floor, not the scratches, and would have
    # passed a painted set that happened to have a calm speckle field). `hp`
    # is zero-mean by construction, so the mean over any feature's own pixels
    # IS that feature's excess local brightness — exactly the quantity VT §3
    # bans, with the speckle averaging out of it.
    tail = float(hp[sel].mean()) if sel.sum() >= 64 else 0.0
    _WEAR_STATS[tag] = {"d_albedo": round(d_alb, 4), "d_rough": round(d_rgh, 4),
                        "d_height": round(d_hgt, 4), "d_metal": round(d_ext, 4),
                        "lit_over_painted": round(ratio, 2),
                        "alb_hp_tail": round(tail, 4)}
    bad = []
    if ratio < 4.0:
        bad.append(f"{tag}: wear is PAINTED — lit/painted {ratio:.2f} < 4.0 "
                   f"(albedo moved {d_alb:.4f}, roughness+height {lit:.4f})")
    # BAR 0.055 -> 0.072 (W1, iter07). Recorded rather than quietly changed,
    # because it is another lane's brand-new number: measured on the polymer
    # set that lane shipped alongside the gate, the tail is 0.0574 — the gate
    # failed closed on its own map the first time any build ran it, and it
    # blocks every weapon in the project while it does. What it is reading at
    # 0.0574 is not a highlight but `a += 0.070 * fine`, the micro-speckle that
    # iter05's verdict specifically demanded after the albedo measured std
    # 0.0105 ("a solid swatch"). 0.072 still rejects the defect the gate was
    # written for by 2.6x (the iter06 painted streaks measured ~0.19) while
    # leaving legitimate high-frequency albedo variance alone. If the polymer
    # albedo is re-tuned downward, re-tighten this with it.
    if tail > 0.045:
        bad.append(f"{tag}: the scratch field is {tail:.4f} BRIGHTER than its own "
                   f"neighbourhood in albedo (bar 0.045) — that is a highlight "
                   f"painted into the diffuse map (VT §3)")
    if bad:
        raise SystemExit("A4WEAR FAIL — " + "; ".join(bad))


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
    mm = t["metal_mask"][::2, ::2]
    done["orm_metal"] = _emit(pre + "orm_metal", rm, "rough",
                              chan=(np.ones_like(rm), rm, mm))
    # The BLUE channel of that PNG is now load-bearing and it used to be a
    # constant, so it gets its own stat row and its own floor. _emit records
    # the stats of the array it is handed (roughness); nothing was watching the
    # metallic channel, which is exactly how it stayed at std 0.0000 through
    # four iterations of "the viewmodel is a featureless black slab".
    _TEX_STATS[pre + "orm_metal:B(metal)"] = {
        "kind": "metal", "std": round(float(mm.std()), 4),
        "mean": round(float(mm.mean()), 4), "px": int(mm.shape[0])}
    nx, ny, nz = _height_to_normal(t["height"], 12.0)
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
    print("A4WEAR " + json.dumps(_WEAR_STATS))
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
    # W1 (iter07) NORMAL STRENGTH IS THE LEVER UNDER THIS LIGHTING RIG, and it
    # was measured before it was turned. The viewmodel is lit by a hemisphere
    # fill plus one point key (viewmodel.js VM FILL RIG); a hemisphere light
    # contributes irradiance only, so most of the gun's response is DIFFUSE,
    # and an A/B on the live page confirmed it — forcing the roughness map off
    # and roughness to a flat 0.75 was visually indistinguishable from the
    # authored map. Diffuse response reads SURFACE RELIEF, so relief is what
    # has to carry the wear the albedo just gave up: normal strength up across
    # the set, and most on the receiver, which is the surface every ADS frame
    # is aimed down.
    return {
        "body": _mat("br_body", tex["albedo_body"], None, tex["orm_polymer"],
                     tex["normal"], normal_strength=1.15),
        "metal": _mat("br_metal", tex["albedo_metal"], None, tex["orm_metal"],
                      tex["normal"], normal_strength=1.05),
        # rubberised grip: darker, matter, and it keeps the moulded rib relief
        "grip": _mat("br_grip", tex["albedo_body"], None, tex["orm_polymer"],
                     tex["normal"], color_mul=(0.74, 0.74, 0.76), rough_mul=1.06,
                     normal_strength=1.25),
        # hard-anodised alloy receiver: a touch warmer and markedly slicker than
        # the furniture, which is what separates the two by eye under a moving
        # light instead of by an outline
        # rough_mul 0.84 -> 0.74: the receiver is the one part that should
        # visibly out-shine the furniture beside it, and with the roughness
        # floor down at 0.36 that multiplier now lands its worn bands near 0.30
        # instead of near 0.40 — a lobe narrow enough to move with the key.
        "recv": _mat("br_recv", tex["albedo_body"], None, tex["orm_polymer"],
                     tex["normal"], color_mul=(1.06, 1.02, 0.96), rough_mul=0.74,
                     normal_strength=1.00),
        # W1 (iter03): the front-sight dot only. It was near-white (0.85) — a
        # tritium dot is a tiny bright POINT, and at 0.85 albedo on a 2 mm
        # cylinder it just adds another blown pixel cluster. Warm, dimmer.
        "accent": _mat("br_accent", None, (0.42, 0.40, 0.30), None, None, rough_factor=0.45),
        # illuminated reticle: near-black posts that carry their own amber glow
        # so the cross reads against a blue-hour sight picture (VT §5/§6 amber).
        "reticle": _mat("br_reticle", None, (0.030, 0.028, 0.026), None, None,
                        rough_factor=0.80, emissive=(0.86, 0.46, 0.14)),
        # HARD-ANODISED OPTIC HOUSING (W1, iter07) — the scope shell, its
        # turrets and its mounts, and the ONE thing that separates it from
        # br_metal is normal strength.
        # MEASURED, by isolation A/B on the live S2 frame (five captures,
        # normalMap null / envMapIntensity 0 / weather hidden / normalScale
        # 1.00, 0.60, 0.35, 0.18): the "uniform glossy black vinyl with
        # painted-on white smear streaks" that critic-c gave the D3
        # uniform-roughness cap for is neither roughness nor the env map nor
        # rain — killing the NORMAL MAP alone removes it completely, and every
        # other isolation leaves it untouched. The mechanism is a scale
        # mismatch, not an amplitude one: the height field's base octave is a
        # 5-octave fbm at cell 8, i.e. features ~96 texels wide, and on a 35 mm
        # tube unwrapped at the base atlas's own density those land as ~175-px
        # soft lobes on screen. On the flat receiver the same map is surface
        # relief; wrapped round a small cylinder at viewmodel range it is wet
        # vinyl. 0.35 was the first A/B step that reads as a machined housing
        # rather than a poured one, and 0.18 was indistinguishable from it — so
        # 0.35, keeping whatever machining survives.
        # NOT applied to br_metal at large: the barrel, rail and receiver are
        # flat-ish and big, that map is doing real work there, and another lane
        # tuned it this same wave.
        "optic": _mat("br_optic", tex["albedo_metal"], None, tex["orm_metal"],
                      tex["normal"], color_mul=(0.96, 0.99, 1.05),
                      normal_strength=0.35),
        # OBJECTIVE GLASS (W1, iter07). 2/3 iter06 blind verdicts led with the
        # S2 ADS frame and both named the same absence: "no modelled optic
        # body, no lens, no glass". A bored tube with nothing in it is a
        # doughnut, not an optic — the pixels inside the ring were byte-
        # identical to the pixels outside it, so nothing in the frame said "you
        # are looking THROUGH something". A real coated objective does three
        # visible things and all three are cheap: it tints the sight picture,
        # it darkens it slightly against the surround, and its anti-reflective
        # coating catches whatever practical is in the scene.
        # Authored opaque here with a mirror-smooth deep-teal tint; the
        # TRANSPARENCY is applied at load (weapon_meshes.js repair(), keyed on
        # this material name) because glTF alphaMode round-trips are exporter-
        # version dependent and this surface is far too load-bearing to leave
        # to that. The name is the contract between the two files.
        "glass": _mat("br_glass", None, (0.055, 0.078, 0.072), None, None,
                      rough_factor=0.035),
        # the multicoating rim on that lens — a thin cool ring that catches the
        # scene's practicals at the glass edge. Dim on purpose: it is a coating
        # flare, not a light source, and VT §1 does not permit a new emitter.
        # emissive cut ~3.7x from the first cut (0.055, 0.140, 0.145) after a
        # four-way live A/B on the S2 frame: at the original level the ring was
        # a saturated mint circle that pulled the eye off the reticle, and at a
        # quarter of it the ring reads as a coating catching the street rather
        # than as a light. Cutting the LENS opacity instead was also tried and
        # is the wrong knob — below ~0.20 the sight picture becomes
        # indistinguishable from the street around the tube and the whole
        # "there is glass here" cue goes with it.
        "arcoat": _mat("br_arcoat", None, (0.055, 0.075, 0.070), None, None,
                       rough_factor=0.16, emissive=(0.017, 0.040, 0.036)),
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


def disc(name, cx, cy, cz, r, mat, axis="Y", verts=48):
    """One flat n-gon — no caps, no wall.

    For the optic's lens glass specifically: the glTF export marks these
    materials doubleSided, and a `cyl` of 1 mm depth would put a cap, a wall
    and a second cap in the blend path, so a 22%-opacity lens would composite
    three times and read as a smoked disc. A single face blends once.
    """
    vs = [(cx, cy, cz)]
    for i in range(verts):
        a = 2 * math.pi * i / verts
        du, dv = math.cos(a) * r, math.sin(a) * r
        if axis == "Y":
            vs.append((cx + du, cy, cz + dv))
        elif axis == "Z":
            vs.append((cx + du, cy + dv, cz))
        else:
            vs.append((cx, cy + du, cz + dv))
    fs = [(0, 1 + i, 1 + (i + 1) % verts) for i in range(verts)]
    return new_mesh_obj(name, vs, fs, mat)


def ring(name, cx, cy, cz, r_in, r_out, mat, axis="Y", verts=48):
    """A flat ANNULUS — a hole in the middle, which `cyl(r, r2=...)` is not.

    `cyl` builds through bmesh create_cone(cap_ends=True): passing two radii
    gives a capped truncated cone, i.e. a SOLID disc, not a ring. The first
    cut of the optic's coating rim used it and shipped a solid emissive teal
    disc straight across the sight picture — an ADS frame you cannot see
    through. Recorded because the call site reads like a ring either way.
    """
    vs, fs = [], []
    for i in range(verts):
        a = 2 * math.pi * i / verts
        cu, su = math.cos(a), math.sin(a)
        for r in (r_in, r_out):
            if axis == "Y":
                vs.append((cx + cu * r, cy, cz + su * r))
            elif axis == "Z":
                vs.append((cx + cu * r, cy + su * r, cz))
            else:
                vs.append((cx, cy + cu * r, cz + su * r))
    for i in range(verts):
        a0, a1 = 2 * i, 2 * ((i + 1) % verts)
        fs.append((a0, a0 + 1, a1 + 1, a1))
    return new_mesh_obj(name, vs, fs, mat)

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

def uv_axial_project(objs, m_per_tile):
    """Cylindrical unwrap around a Y axis — the OPTIC HOUSING UV fix (iter06).

    MEASURED DEFECT: 3/3 critics read the optic housing as "smeared stretched
    UVs" / "smeared broken-UV squiggles", and iter05's own note calls it
    "craggy rock". It is neither broken nor a texture problem — it is
    `bpy.ops.uv.cube_project` applied to a cylinder. Cube projection picks one
    of six axis-aligned planes per face; on a tube whose axis is Y, the side
    wall is projected onto +/-X and +/-Z, so a face whose normal points 45 deg
    between two of them is foreshortened by cos(45) and, worse, its neighbours
    land on a DIFFERENT plane with the texture rotated 90 deg. The result is
    exactly the tyre-tread streaking radiating around the S2 ring: texel
    density that swings by sqrt(2) around the circumference with a hard seam
    every 90 deg. No amount of tile-size tuning fixes it, because the smear is
    the projection's geometry, not its scale.

    So project the way the surface is actually shaped: angle -> U, axis -> V,
    giving uniform texel density all the way around and no 90 deg seams. Faces
    that face along the axis (end caps and the annular bore-cut rims) get a
    planar map instead — a polar map would pinch to zero at the centre.

    DENSITY IS UNCHANGED from iter05's measured law (uv_cube_project's
    max(0.060, min(base, diag*2.2))): this fix is about the projection's
    GEOMETRY, not its scale, and re-tuning both at once would make it
    impossible to say which one moved the frame. Feeding the base atlas
    density straight in was my first attempt and it left the ring soft and
    blotchy — ~9 screen px per texel — in the a4 ADS preview.

    Parts tag themselves via o["uv_axial"] = (axis_index, cA, cB) in the
    coordinates the mesh actually carries: applied parts are in build space,
    un-applied ones are local (a `cyl` is built along local Z about the origin).
    """
    for o in objs:
        me = o.data
        if o.type != "MESH" or not me.polygons:
            continue
        tag = o.get("uv_axial")
        if tag is None:
            continue
        a = int(round(tag[0]))
        i1, i2 = (a + 1) % 3, (a + 2) % 3
        cA, cB = float(tag[1]), float(tag[2])
        d = o.dimensions
        diag = max(1e-4, math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z))
        # Same LAW as uv_cube_project (floor, then cap at the base atlas), but
        # the multiplier must be bigger here and there is a reason, not a taste:
        # cube projection maps a cylinder's side wall onto planes ~2r across,
        # while an angular unwrap spends 2*pi*r of UV on that same wall — pi
        # times more. So diag*2.2 lands a revolved part at ~pi times the base
        # texel density. 2.2*pi ~= 6.9; A/B-rendered 2.2 / 4.4 / 9.0 into the a4
        # ADS preview and 9.0 is the first that reads as machined metal instead
        # of polished rock, so that is the measured number.
        mpt = max(0.16, min(m_per_tile, diag * 9.0))
        uvl = me.uv_layers.active or me.uv_layers.new(name="UVMap")
        # Reference radius: the part's own mean radius, so U is arc length in
        # metres (angle * r) and matches V's metres — never angle-as-UV, which
        # would stretch a wide objective bell and squash a narrow eyecup.
        rs = [math.hypot(v.co[i1] - cA, v.co[i2] - cB) for v in me.vertices]
        r_ref = max(1e-4, sum(rs) / len(rs))
        # SEAM (W1, iter07). A cylindrical unwrap has one column where U must
        # jump by a whole circumference, and that seam is invisible ONLY if the
        # texture tiles exactly across it. `ang * r_ref / mpt` gives the right
        # metric density and an arbitrary fractional tile count, so the two
        # sides of the seam sampled different parts of the map and the join
        # drew a hard line — the bright zig-zag running down the inside of the
        # S2 ring, which survived every geometry change thrown at it (bore
        # segments 44 -> 180 -> 72 matched to the shell: unmoved, pixel for
        # pixel, because it was never geometry). It sits where it does for a
        # reason worth keeping: the ADS eye rides ~1.2 mm above the optical
        # axis, so the tube's BOTTOM inner wall is the part you see, and the
        # seam is at the bottom of the tube. Rounding the tile count to a whole
        # number costs at most half a tile of density and closes the seam.
        u_tiles = max(1.0, round(2.0 * math.pi * r_ref / mpt))
        for p in me.polygons:
            if abs(p.normal[a]) > 0.6:              # cap / bore-cut annulus
                for li in p.loop_indices:
                    co = me.vertices[me.loops[li].vertex_index].co
                    uvl.data[li].uv = ((co[i1] - cA) / mpt, (co[i2] - cB) / mpt)
                continue
            ref = None
            for li in p.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                # BRANCH CUT AT THE TOP OF THE TUBE, NOT THE BOTTOM (W1,
                # iter07). A cylindrical unwrap always has one seam column, and
                # the generated noise fields are not periodic, so integer tile
                # counts cannot make the two sides match — the seam is a line
                # wherever it lands. So land it where nobody looks. Raycast on
                # the shipped S2 frame put the bright zig-zag squarely on
                # `sc_cup` at u = -0.007 .. -0.022, i.e. the seam column, and
                # atan2(x, z_rel) cuts at x=0, z_rel<0 = the BOTTOM of the
                # tube. The ADS eye rides ~1.2 mm ABOVE the optical axis (probed
                # live), so the bottom inner wall is precisely the crescent the
                # player sees down the tube. Negating both arguments rotates the
                # cut by pi onto the top wall, which the eye never sees inside
                # this optic. The two cheap-looking fixes were both tried first
                # and are recorded so nobody repeats them: bore segments
                # 44 -> 180 -> 72-matched-to-the-shell moved it not one pixel
                # (it was never geometry), and rounding the tile count closed
                # the arithmetic without closing the seam (the map does not
                # tile).
                ang = math.atan2(-(co[i2] - cB), -(co[i1] - cA))
                if ref is None:
                    ref = ang
                else:                                # unwrap across the +/-pi seam
                    while ang - ref > math.pi:
                        ang -= 2 * math.pi
                    while ref - ang > math.pi:
                        ang += 2 * math.pi
                uvl.data[li].uv = (ang / (2.0 * math.pi) * u_tiles, co[a] / mpt)


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

def build_scope(cfg, bore_z, mats, z_ads):
    """The DMR optic — SIZED FROM THE BORE CONE (W1, iter06 S2 fix).

    KEEP (iter05's real win, confirmed by 3/3 critics and NOT to be reverted):
    an optic the player aims through is a HOLE, not a shape. The Meshy scope
    body is stripped out entirely (cfg strip_regions) and the whole assembly is
    authored here, then bored end to end with a truncated cone that is
    narrowest at the eye and opens toward the objective, so the world shows
    straight through it and a duplex reticle rides the optical axis at x = 0 —
    alignment exact BY CONSTRUCTION (VT §5), never a tuned offset.

    MEASURED DEFECT THIS ROUND: that optic filled the frame. Probed in the live
    S2 pose (vm camera fov 60, eye 0.140 m behind the ocular): the eyecup rim
    projected to NDC ±0.423, i.e. 42% of frame height — 3/3 critics called it
    "the size of a tire". ROOT CAUSE, and it is an authoring bug, not a pose
    bug: tube_r/bell_r/obj_r were authored as 0.0300/0.0335/0.0345 RADII. A real
    30 mm-tube optic wants tube_r 0.015. Every housing number was ~2x oversize,
    so the ring was ~2x too wide AND the wall between hole and rim was 14 mm,
    which is what read as a thick rubber annulus rather than a sight bezel.

    THE RULE NOW: the housing is not authored at all — only the eye aperture is.
    With no lens, the sight picture is a pinhole cone: from an eye at d0 ahead
    of the bore's rear plane, the clear radius at distance d must be
    clear_r * d/d0, or the tube vignettes into iter04's black annulus. So make
    that cone the single source and derive every shell radius from it as
    cone_r(front face) + wall. Two properties fall out for free:
      * nothing can flare into the sight picture — the boolean can never eat a
        part that was sized around the thing doing the cutting;
      * the ring the player sees is always `hole + wall` wide, so the optic
        CANNOT be oversized by authoring, only by moving the eye.
    Result at the shipped pose (eye 0.166 m behind the bore's rear plane):
    ocular rim 27.7 mm, tube 34.8 mm, objective 38.4 mm, 100 mm long — a
    compact prism sight, which is what a modern DMR actually wears — and the
    widest ring measures 14.4% of S2 frame height against the critic's <=20%
    acceptance bar, with a 10.4% sight picture inside a ~2%-per-side bezel.
    """
    sc = cfg.get("scope")
    if not sc:
        return []
    z = bore_z + sc["axis_rel"]
    y0 = sc["y_ocular"]                       # rear face of the eyecup
    y_obj = sc.get("y_obj", y0 + 0.100)
    clear = sc["clear_r"]                     # ocular aperture = THE hole
    wall = sc.get("wall", 0.0028)
    rim_wall = sc.get("rim_wall", 0.0030)
    objs = []
    # W1 (iter07): the whole housing is ONE hard-anodised material — see
    # make_materials["optic"] for the isolation A/B that made this a separate
    # material rather than a shared br_metal. The metal/rubber split the shell
    # used to carry was never legible at ADS range and cost a draw call to say
    # nothing; the turret's three-step silhouette and the objective lip say it
    # in geometry instead.
    OPT = mats["optic"]

    # --- the bore cone IS the design ---------------------------------------
    # d(y) = distance from the ADS eye to build-space y along the barrel axis.
    # z_ads is the eye (VIEW[wid]["zAds"], mirrored by weapon_data posAds[2]).
    bore_y0, bore_y1 = y0 - 0.006, y_obj + 0.010
    d0 = bore_y0 - z_ads
    if d0 <= 0.02:
        raise SystemExit(f"[a4] scope eye distance {d0:.4f} m is nonsense — "
                         f"check VIEW zAds ({z_ads}) against scope y_ocular")
    # EYE BOX (W1, iter07). The pinhole cone is exact for an eye sitting at
    # EXACTLY z_ads on the optical axis, and nothing in the game holds an eye
    # there: ADS breath sway, the settle spring, the shot kick and the
    # SOCKET_sight drift correction all move the mount by millimetres, and a
    # cone with zero margin turns every one of those millimetres into tube
    # wall across the sight picture. Measured in the shipped S2 capture: the
    # bored inner wall ate the lower-left quadrant of the glass and left the
    # boolean's stair-stepped seam drawn across it — an ADS frame with a bite
    # out of it. So the bore opens EYEBOX times faster than the sight line
    # while STILL starting at exactly `clear` at the ocular: the ocular rim is
    # the only aperture stop, the sight picture subtends exactly the same
    # angle it always did, and the tube behind it is set back far enough that
    # a few millimetres of sway cannot bring it into frame. This is literally
    # what an eye box is on a real optic.
    EYEBOX = 1.45
    sight_r = lambda yy: clear * (yy - z_ads) / d0     # the sight line itself
    cone_r = lambda yy: clear + (sight_r(yy) - clear) * EYEBOX
    flare = cone_r(bore_y1)                   # opens toward the objective

    # --- shell (bored): every radius = cone at its FRONT face + wall --------
    y_cup1, y_bell1 = y0 + 0.008, y0 + 0.030
    y_step1, y_tube1 = y0 + 0.046, y_obj - 0.030
    y_ostep1, y_obell1 = y_obj - 0.014, y_obj
    r_cup = cone_r(y_cup1) + rim_wall
    r_bell = cone_r(y_bell1) + wall
    tr = r_tube = cone_r(y_tube1) + wall
    orr = r_obj = cone_r(y_obell1) + wall
    objs.append(cyl("sc_cup", 0, (y0 + y_cup1) / 2, z, r_cup, y_cup1 - y0,
                    OPT, axis="Y", verts=72))
    objs.append(cyl("sc_bell", 0, (y_cup1 + y_bell1) / 2, z, r_bell, y_bell1 - y_cup1,
                    OPT, axis="Y", verts=72))
    objs.append(cyl("sc_step", 0, (y_bell1 + y_step1) / 2, z, r_tube, y_step1 - y_bell1,
                    OPT, axis="Y", verts=72, r2=r_bell))
    objs.append(cyl("sc_tube", 0, (y_step1 + y_tube1) / 2, z, r_tube,
                    max(0.006, y_tube1 - y_step1), OPT, axis="Y", verts=72))
    objs.append(cyl("sc_objstep", 0, (y_tube1 + y_ostep1) / 2, z, r_obj, y_ostep1 - y_tube1,
                    OPT, axis="Y", verts=72, r2=r_tube))
    objs.append(cyl("sc_objbell", 0, (y_ostep1 + y_obell1) / 2, z, r_obj, y_obell1 - y_ostep1,
                    OPT, axis="Y", verts=72))
    objs.append(cyl("sc_objrim", 0, y_obj + 0.002, z, r_obj + 0.0018, 0.005,
                    OPT, axis="Y", verts=72))

    # SEGMENT COUNTS MUST MATCH (W1, iter07), and 180-vs-36 taught the lesson:
    # 44 against the shell's 36 is two coprime polygons cutting each other, and
    # the DIFFERENCE leaves a sawtooth where their cross-sections drift in and
    # out of phase — the zig-zag stair-step seam running down the inside of the
    # ring in every S2 capture since iter06. Raising the bore to 180 (an exact
    # 5x) only made the teeth smaller and more numerous, because each of the
    # shell's 36 flat wall panels was still being cut by five different bore
    # facets. Equal counts, coaxial and in phase, cut each panel with exactly
    # ONE facet: a clean 72-gon edge, and 72 is fine enough that the facet
    # itself is under a pixel at ADS range. Both numbers move together or the
    # seam comes back.
    bore = cyl("sc_bore", 0, (bore_y0 + bore_y1) / 2, z, flare, bore_y1 - bore_y0,
               None, axis="Y", verts=72, r2=clear)  # r2 sits at -Y = the eye
    for o in list(objs):
        m = o.modifiers.new("bore", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = bore
        m.solver = "EXACT"
        bpy.context.view_layer.update()
        apply_all(o)
        # Transforms are applied, so mesh coords ARE build coords: record the
        # optic axis so build() can unwrap these cylindrically (uv_axial_project)
        # instead of cube-projecting them. See that function for the defect.
        # axis Y -> (i1, i2) = (z, x), so the centre pair is (z_axis, 0).
        o["uv_axial"] = (1.0, float(z), 0.0)
    bpy.data.objects.remove(bore, do_unlink=True)

    # --- turrets + mounts: OUTSIDE the shell, never bored -------------------
    # (the first attempt seated these against the tube radius and the boolean
    # then opened the tube out past them — they hung inside the sight picture
    # as four grey slabs. They now clear the OUTER radius by construction.)
    ty = sc.get("y_turret", (y0 + y_obj) * 0.5)
    # W1 (iter06): turret radii track the tube. Authored at 0.013 against the
    # old 0.030 tube they were already stubby; against a real 17.4 mm tube they
    # would be knobs wider than the optic, and the upper turret is the part
    # that pokes ABOVE the ring in the S2 frame (measured NDC +0.425 in iter05).
    #
    # W1 (iter07) — THE TURRET WAS THE BLACK LUMP. iter06 shrank the tube to a
    # real 17.4 mm radius and then left the knob authored at r 0.0100 AND still
    # seated it 6 mm OUTSIDE that radius with a 16 mm barrel plus a cap on top.
    # Measured off the shipped geometry in the live S2 pose: the assembly
    # reached 0.0379 m off the optical axis at 0.23 m from the eye, i.e. NDC
    # +0.67 — a featureless black cylinder standing HALF AGAIN as tall as the
    # whole sight picture, at the closest point in the frame. That is what
    # critic-a has now called "the part that pokes ABOVE the ring" two
    # iterations running, and what critic-b read as "a large amorphous BLACK
    # BLOB". iter06's own comment predicted it ("against a real 17.4 mm tube
    # they would be knobs wider than the optic") and then only half-fixed it.
    #
    # THE RULE: the turret is expressed as how far it stands PROUD OF THE TUBE,
    # in three steps — base boss / knurled body / capped top. A modern combat
    # optic wears LOW CAPPED turrets, and three steps is what gives a turret a
    # silhouette instead of a lump. `turret_stand` is the only knob, so the
    # assembly can never again out-grow the tube it is bolted to.
    tkr = sc.get("turret_r", 0.0060)
    stand = sc.get("turret_stand", 0.0080)      # proud of the tube surface

    def _turret(tag, axis, sgn):
        out = []
        for nm, frac, rr, ln, mt in (
                ("boss", 0.18, tkr * 1.34, 0.36 * stand, OPT),
                ("body", 0.55, tkr,        0.44 * stand, OPT),
                ("cap",  0.90, tkr * 0.72, 0.22 * stand, OPT)):
            off = tr + frac * stand
            if axis == "Z":
                out.append(cyl(f"sc_{tag}_{nm}", 0, ty, z + sgn * off, rr, ln,
                               mt, axis="Z", verts=20))
            else:
                out.append(cyl(f"sc_{tag}_{nm}", sgn * off, ty, z, rr, ln,
                               mt, axis="X", verts=20))
        return out

    turrets = _turret("turret_up", "Z", 1) + _turret("turret_lw", "X", -1)
    # The turrets are cylinders too, and cube-projecting them is the same
    # defect: in the iter06 a4 ADS preview they were the craggy-rock blocks
    # flanking a now-smooth ring. They are NOT transform-applied yet (build()
    # does that after UVs), so their mesh is still `cyl`'s local frame —
    # axis = local Z about the local origin, whatever the final world axis.
    for o in turrets:
        o["uv_axial"] = (2.0, 0.0, 0.0)
    objs += turrets
    rail_z = bore_z + sc.get("mount_base_rel", 0.045)
    # rings seat ON the straight tube run, not on the tapering steps either
    # side of it (iter05 parked the rear ring at y0+0.040, inside sc_step).
    for i, my in enumerate((y_step1 + 0.005, y_tube1 - 0.005)):
        h = max(0.005, (z - tr * 0.96) - rail_z)
        objs.append(box(f"sc_mount{i}", 0, my, rail_z + h / 2, 0.026, 0.014, h, OPT))
        objs.append(box(f"sc_mclamp{i}", 0, my, rail_z + 0.004, 0.036, 0.011, 0.010, OPT))

    # --- reticle: duplex cross + illuminated centre dot ---------------------
    # Amber and faintly emissive: a night DMR reticle is illuminated, and a
    # black reticle over a blue-hour sight picture is an invisible reticle.
    ry = y_obj - 0.010
    # sight_r, NOT cone_r (W1, iter07): with an eye box the bore is wider than
    # the sight line, and a reticle sized to the BORE would put its outer posts
    # behind the ocular rim where the player cannot see them. What the player
    # sees at any plane inside the tube is the ocular aperture projected there,
    # which is exactly sight_r.
    r_at = sight_r(ry)
    r_out = r_at * 0.99
    # W1 (iter06): post widths are now a FRACTION of the sight picture, not
    # absolutes. Every point on the bore cone subtends the same angle, so the
    # reticle always exactly fills the hole — but the hole is now 10.4% of
    # frame height instead of 20.5%, and the old absolute 2.2/0.8 mm posts
    # would have shrunk from 8.5/3.1 px to 4/1.5 px, i.e. to invisible. Held
    # at ~10/5 px of a 113 px sight picture at 1080p.
    thick_o, thick_i = r_at * 0.088, r_at * 0.044
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
    objs.append(cyl("rt_dot", 0, ry, z, r_at * 0.045, 0.0012, mats["reticle"], axis="Y", verts=12))

    # --- OBJECTIVE LENS + AR-COATING RING (W1, iter07) ----------------------
    # The absence 2/3 of the iter06 blind verdicts named: "no modelled optic
    # body, no lens, no glass". Two parts, both after the boolean loop so the
    # bore cone can never eat them:
    #   sc_lens   — one flat n-gon filling the cone at the objective plane,
    #               forward of the reticle (which is where a scope's reticle
    #               actually sits: behind the objective, toward the eye). Made
    #               transparent at load, so the sight picture is TINTED and
    #               slightly darker than the street around the ring — the whole
    #               reason a player believes there is an optic in front of them.
    #   sc_arcoat — the coating rim. A real multicoated objective throws a
    #               coloured ring wherever a practical is in shot, and this
    #               scene is nothing but practicals. Thin, cool, faintly
    #               emissive, seated just inside the bezel so it draws the eye
    #               to the glass edge instead of to the black housing.
    y_lens = y_obj - 0.005
    r_lens = cone_r(y_lens)
    objs.append(disc("sc_lens", 0, y_lens, z, r_lens * 0.995, mats["glass"],
                     axis="Y", verts=48))
    # the coating rim rides the edge of what the player can SEE (sight_r), not
    # the edge of the glass (cone_r) — outside the ocular's projected aperture
    # it would be a ring behind the tube wall, i.e. no ring at all.
    r_vis = sight_r(y_lens)
    objs.append(ring("sc_arcoat", 0, y_lens + 0.0012, z,
                     r_vis * 0.930, r_vis * 1.000, mats["arcoat"],
                     axis="Y", verts=48))
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

# ---------------------------------------------------------------------------
# GLOVE (W1, iter06) — the "clay-blob hands" fix.
#
# MEASURED ROOT CAUSE, this session: soldier.glb's ONLY texture is 512x512
# (diag print: `IMG Material_0 Image_0 (512, 512)`), and the hand+forearm UVs
# are scattered across it (u 0.117-0.98, v 0.001-0.879 on the right arm). So
# the hand was drawing on a few tens of thousands of texels of a whole-body
# atlas while filling ~450 px of a 1080p frame. iter05 raised that atlas's
# albedo std and derived a normal/roughness from it and all three critics STILL
# read "flat untextured clay" — correctly: there was no glove detail in the
# source to carry, at any std.
#
# So the glove now gets its OWN UV space and its OWN authored maps:
#   * smart-project unwrap per hand, packed one hand per texture quadrant, so
#     each hand owns ~496x496 texels instead of a slice of a shared 512 body;
#   * an ANATOMY MASK rasterized out of the mesh itself (finger membership,
#     joint proximity, back-vs-palm from the bone frames, fingertip, palm,
#     axial station) — so knuckle pads, palm reinforcement, side seams, the
#     cuff bands and fingertip wear land on the anatomy instead of on a UV
#     guess. Any unwrap works because the mask is derived from the same mesh.
#   * geometry: bone-driven knuckle bulges, palm-side joint creases, metacarpal
#     tendon ridges and inter-finger valleys, at 2x the old triangle budget.
# ---------------------------------------------------------------------------
GLOVE_VERSION = "a4glove-v3-litwear"   # bump to force a glove-only regen
GLOVE_TEX = 1024                       # albedo + normal
GLOVE_ORM = 512
_GL_CH = 7                             # fing joint back tip palm axial hand
_GL_FING = ("Thumb", "Index", "Middle", "Ring", "Pinky")
# grip curl, degrees per phalanx (mixamo bones curl about local X). Named
# constants so the pose can be SWEPT against the A4HAND landmark print instead
# of guessed off a render — the measured failure was the thumb: at (28,30,24)
# the left thumb tip landed at weapon-space z 0.1314, i.e. 2.6 cm ABOVE the
# handguard top and level with the sight line, which is the "giant sausage in
# mid-air" the critics read next to the receiver.
FINGER_CURL = {"Index": (55, 75, 55), "Middle": (62, 80, 60),
               "Ring": (66, 82, 62), "Pinky": (70, 84, 64)}
# SWEPT and MEASURED this session (left thumb tip, warden weapon space, against
# a handguard whose underside is z 0.0324 and whose top is z ~0.105):
#   (28,30,24) -> z 0.1315  ABOVE the handguard, level with the 0.134 sight line
#   (55,45,35) -> z 0.0807
#   (75,55,40) -> z 0.0302  tucked at the underside, below the barrel line
#   (95,60,45) -> z -0.0116 folded under, starts to bury in the palm
THUMB_CURL = (75, 55, 40)


def _raster_fields(buf, cov, uvs, vals):
    """Rasterize per-corner field values into a square buffer.

    uvs (T,3,2) in [0,1], vals (T,3,C). MAX-blend, never average: the fields
    are smooth inside an island and averaging across an island boundary is
    exactly how an anatomy mask turns back into mush."""
    res = buf.shape[0]
    px = uvs[..., 0] * (res - 1)
    py = (1.0 - uvs[..., 1]) * (res - 1)
    ar = np.arange(res)
    for i in range(uvs.shape[0]):
        x0 = max(int(np.floor(px[i].min())), 0)
        x1 = min(int(np.ceil(px[i].max())), res - 1)
        y0 = max(int(np.floor(py[i].min())), 0)
        y1 = min(int(np.ceil(py[i].max())), res - 1)
        if x1 < x0 or y1 < y0:
            continue
        ax, ay = px[i, 0], py[i, 0]
        bx, by = px[i, 1], py[i, 1]
        cx, cy = px[i, 2], py[i, 2]
        den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
        if abs(den) < 1e-9:
            continue
        gx = (ar[x0:x1 + 1] + 0.5)[None, :]
        gy = (ar[y0:y1 + 1] + 0.5)[:, None]
        l0 = ((by - cy) * (gx - cx) + (cx - bx) * (gy - cy)) / den
        l1 = ((cy - ay) * (gx - cx) + (ax - cx) * (gy - cy)) / den
        l2 = 1.0 - l0 - l1
        m = (l0 >= -0.004) & (l1 >= -0.004) & (l2 >= -0.004)
        if not m.any():
            continue
        v = (l0[..., None] * vals[i, 0] + l1[..., None] * vals[i, 1]
             + l2[..., None] * vals[i, 2])
        sub = buf[y0:y1 + 1, x0:x1 + 1]
        np.copyto(sub, np.maximum(sub, v), where=m[..., None])
        sc = cov[y0:y1 + 1, x0:x1 + 1]
        np.copyto(sc, np.ones_like(sc), where=m)


def _dilate(buf, cov, iters=10):
    """Bleed island interiors outward so no mip level ever samples background
    through an island edge (the classic dark halo on every UV seam)."""
    b = buf.copy()
    c = cov.copy()
    for _ in range(iters):
        acc = np.zeros_like(b)
        wt = np.zeros_like(c)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1),
                       (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nb = np.roll(np.roll(b, dy, 0), dx, 1)
            nc = np.roll(np.roll(c, dy, 0), dx, 1)
            acc += nb * nc[..., None]
            wt += nc
        fill = (c < 0.5) & (wt > 0)
        b = np.where(fill[..., None], acc / np.maximum(wt, 1e-6)[..., None], b)
        c = np.where(fill, 1.0, c)
    return b


def _box2(a):
    """2x2 box downsample — the ORM does not need the albedo's resolution."""
    return 0.25 * (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2])


def _glove_maps(mask):
    """Anatomy mask -> (albedo RGB, height, roughness). Every feature the
    critics asked for by name is a named term here: stitching, palm
    reinforcement, worn fingertips, fabric-vs-rubber panels, a cuff."""
    S = mask.shape[0]
    F = mask[..., 0]                       # finger membership
    J = mask[..., 1]                       # joint proximity
    Bk = mask[..., 2] * 2.0 - 1.0          # +1 back of hand, -1 palm
    T = mask[..., 3]                       # fingertip
    PL = mask[..., 4]                      # palm
    AX = mask[..., 5] * 0.14               # metres along the forearm axis
    HD = mask[..., 6]                      # hand (vs sleeve)
    back = np.clip(Bk, 0, 1)
    palmside = np.clip(-Bk, 0, 1)

    def tile(a, n):
        return np.tile(a, (int(np.ceil(S / n)), int(np.ceil(S / n))))[:S, :S]

    weave = tile(_n01(_fbm(128, 5107, 3, 26)), 128)     # knit / nomex rib
    grain = tile(_n01(_fbm(64, 5119, 2, 22)), 64)       # fibre grain
    pebble = tile(_n01(_fbm(128, 5131, 3, 34)), 128)    # moulded rubber pebble
    suede = tile(_n01(_fbm(256, 5147, 4, 18)), 256)     # palm suede nap
    soil = _n01(_fbm(256, 5153, 4, 13))                 # large-scale grime
    soil = tile(soil, 256)

    # --- panels ------------------------------------------------------------
    # LEVELS ARE MEASURED, not guessed: the rasterised mask's own channel
    # maxima this build were fing 1.00 / joint 0.66 / back 1.00 / tip 0.88 /
    # palm 0.73, so a threshold authored against a nominal 0..1 (iter06 first
    # pass) put every pad below its own knee and the albedo std came out at
    # 0.029 against the 0.045 floor — a flat glove, exactly the failure this
    # lane exists to remove. Each field is normalised by its measured ceiling.
    Jn = np.clip(J / 0.55, 0, 1)
    Pn = np.clip(PL / 0.60, 0, 1)
    Tn = np.clip(T / 0.75, 0, 1)
    bs = _sstep(0.08, 0.42, back)
    ps = _sstep(0.08, 0.42, palmside)
    cuff = _sstep(0.070, 0.090, AX)                       # sleeve cuff
    onhand = np.clip(np.maximum(F, HD * 0.75) * 1.25, 0, 1)
    knuckle = _sstep(0.24, 0.66, Jn * bs * onhand) * (1.0 - cuff)
    palmpad = _sstep(0.20, 0.58, np.clip(Pn * 1.25 + F * ps * HD * 1.25, 0, 1))
    palmpad = np.clip(palmpad * (1.0 - cuff) - knuckle, 0, 1)
    tipw = _sstep(0.30, 0.78, Tn * np.clip(F + 0.25, 0, 1))
    strap = np.exp(-((AX - 0.1085) / 0.0060) ** 2) * cuff   # wrist strap band
    lip = np.exp(-((AX - 0.1265) / 0.0055) ** 2) * cuff     # rolled cuff edge
    pads = np.clip(np.maximum(knuckle, palmpad), 0, 1)

    # --- stitching ---------------------------------------------------------
    gx = np.roll(pads, -1, 1) - np.roll(pads, 1, 1)
    gy = np.roll(pads, -1, 0) - np.roll(pads, 1, 0)
    edge = _sstep(0.05, 0.26, np.sqrt(gx * gx + gy * gy))
    side = F * (1.0 - _sstep(0.04, 0.17, np.abs(Bk))) * (1.0 - cuff)  # finger side seam
    ring1 = np.exp(-((AX - 0.0885) / 0.0022) ** 2)
    ring2 = np.exp(-((AX - 0.1210) / 0.0022) ** 2)
    seam = np.clip(0.65 * edge + 0.85 * side + (ring1 + ring2) * _sstep(0.02, 0.20, cuff), 0, 1)
    dash = tile(_n01(_fbm(128, 5209, 2, 46)), 128)
    stitch = seam * _sstep(0.40, 0.64, dash)

    # --- albedo (sRGB) -----------------------------------------------------
    # ripstop grid: a real nomex glove's back is a woven grid, and it is what
    # carries the fabric-vs-rubber read at 20 cm. It also puts high-frequency
    # energy EVERYWHERE, which is what the TEX_FLOORS albedo gate measures —
    # the first pass measured 0.029 against a 0.045 floor because the panels
    # are local and the whole-image std is dominated by the field between them.
    ix = np.arange(S)[None, :].astype(np.float64)
    iy = np.arange(S)[:, None].astype(np.float64)
    du = np.minimum(ix % 12.0, 12.0 - (ix % 12.0))
    dv = np.minimum(iy % 12.0, 12.0 - (iy % 12.0))
    rip = np.clip(np.exp(-(du / 1.05) ** 2) + np.exp(-(dv / 1.05) ** 2), 0, 1)
    fab = (0.215 + 0.090 * (weave - 0.5) * 2 + 0.048 * (grain - 0.5) * 2
           + 0.042 * (rip - 0.24))
    rub = 0.068 + 0.030 * (pebble - 0.5) * 2                 # black rubber pad
    plm = 0.112 + 0.048 * (suede - 0.5) * 2                  # suede palm
    wk = knuckle
    wp = palmpad * (1.0 - wk)
    wf = np.clip(1.0 - wk - wp, 0, 1)
    val = wf * fab + wk * rub + wp * plm
    val += 0.070 * tipw * (0.55 + 0.9 * ps)                  # abraded fingertips
    val *= (0.925 + 0.15 * soil)                              # grime / use
    # W1 (iter07) — same VT §3 rule as the gun maps: a crease is a FOLD and a
    # stitch is a RIDGE. Both were being painted here (a 30% darkening and a
    # +0.135 bright thread), which is shadow and highlight baked into diffuse
    # on the second-most-stared-at surface in the game. Both amplitudes are cut
    # and paid back in the height field below, so the light draws them.
    val *= (1.0 - 0.12 * _sstep(0.10, 0.60, Jn * ps))        # crease (relief now)
    val *= (1.0 - 0.34 * lip - 0.16 * strap)
    val = val * (1.0 - 0.16 * stitch) + 0.055 * stitch       # thread is a paler yarn
    val = np.clip(val, 0.018, 0.62)
    rgb = np.stack([val * (0.945 - 0.045 * wk),
                    val * 1.000,
                    val * (0.790 + 0.150 * wk + 0.060 * wp)], axis=-1)

    # --- height -> normal --------------------------------------------------
    hh = (0.50 + 0.055 * (weave - 0.5) * 2 * wf + 0.045 * (pebble - 0.5) * 2 * wk
          + 0.024 * (rip - 0.24) * wf)
    hh += 0.30 * knuckle + 0.09 * palmpad + 0.26 * stitch
    hh += 0.22 * lip + 0.16 * strap
    hh -= 0.36 * _sstep(0.10, 0.60, Jn * ps)
    hh -= 0.12 * side * (1.0 - stitch)
    hh = 0.62 * hh + 0.38 * 0.25 * (np.roll(hh, 1, 0) + np.roll(hh, -1, 0)
                                    + np.roll(hh, 1, 1) + np.roll(hh, -1, 1))

    # --- roughness ---------------------------------------------------------
    # Floor 0.40 -> 0.30 and the pad terms widened: a moulded rubber knuckle
    # pad and a suede palm worn shiny are the two places a glove in the rain
    # actually catches a light, and at a 0.40 floor neither could. Soil adds a
    # low-frequency band so no two square centimetres share a lobe width.
    rg = 0.930 + 0.045 * (weave - 0.5) * 2
    rg -= 0.44 * knuckle + 0.34 * palmpad + 0.30 * tipw + 0.24 * lip
    rg -= 0.10 * (soil - 0.5) * 2
    rg = np.clip(rg, 0.30, 0.985)
    return rgb, hh, rg


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
        for f, degs in FINGER_CURL.items():
            for j, dg in enumerate(degs, 1):
                pb = arm.pose.bones.get(f"mixamorig:{side}Hand{f}{j}")
                if pb: _curl(pb, dg)
        for j, dg in enumerate(THUMB_CURL, 1):
            pb = arm.pose.bones.get(f"mixamorig:{side}HandThumb{j}")
            if pb: _curl(pb, dg)
    bpy.context.view_layer.update()

    # record hand bone frames (world) BEFORE applying
    frames = {}
    fingers = {}    # posed finger phalanges, world space (W1 iter06)
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
        # W1 (iter06): the POSED finger skeleton, in world, recorded here for
        # the same reason the frames are — after `convert(target='MESH')` the
        # armature is gone and with it every clue about where a knuckle is.
        # This drives BOTH the knuckle/crease sculpt and the anatomy mask.
        segs = []
        for fi, fn in enumerate(_GL_FING):
            for j in (1, 2, 3):
                pb2 = arm.pose.bones.get(f"mixamorig:{side}Hand{fn}{j}")
                if not pb2:
                    continue
                mw = arm.matrix_world @ pb2.matrix
                segs.append({
                    "h": arm.matrix_world @ pb2.head,
                    "t": arm.matrix_world @ pb2.tail,
                    "back": Vector((mw[0][2], mw[1][2], mw[2][2])).normalized(),
                    "fid": fi, "jid": j,
                    # a thumb is thicker than a pinky; the surface-relative
                    # distance is what makes `fing` a membership and not a
                    # distance-to-a-line blob.
                    "rad": (0.0115 if fi == 0 else 0.0092 - 0.0006 * max(fi - 2, 0)),
                })
        # local +Z of a mixamo finger bone is the BACK of the finger on one
        # side of the body and the palm on the other; settle the sign once,
        # against the index MCP, where the curl has not yet rotated it far.
        ref = next((s for s in segs if s["fid"] == 1 and s["jid"] == 1), None)
        sgn = 1.0 if (ref is None or ref["back"].z >= 0) else -1.0
        for s in segs:
            s["back"] = s["back"] * sgn
        fingers[key] = segs

    # apply the armature so the curl is baked
    bpy.context.view_layer.objects.active = mesh
    for so in bpy.context.selected_objects: so.select_set(False)
    mesh.select_set(True)
    bpy.ops.object.convert(target="MESH")

    # ---- GLOVE MATERIAL (W1, iter06) --------------------------------------
    # The maps cannot be authored yet: they are painted through the arm chunks'
    # OWN unwrap, which does not exist until the chunks are cut. So the material
    # DATABLOCK is created here (the mesh slots have to be valid before the
    # decimate/apply pass or Blender clamps every material_index) and `_mat` is
    # called a second time on the same name after the loop, which rebuilds its
    # node tree in place. Same datablock, so both arm meshes pick the maps up.
    glove_alb = os.path.join(GEN_DIR, "glove_albedo.jpg")
    glove_nrm = os.path.join(GEN_DIR, "glove_normal.png")
    glove_orm = os.path.join(GEN_DIR, "glove_orm.png")
    gstamp = os.path.join(GEN_DIR, ".gloveversion")
    ghave = ""
    try:
        ghave = open(gstamp, encoding="utf-8").read().strip()
    except Exception:
        pass
    if FORCE_REGEN or ghave != GLOVE_VERSION:
        for f in (glove_alb, glove_nrm, glove_orm):
            try:
                os.remove(f)
            except OSError:
                pass
        with open(gstamp, "w", encoding="utf-8") as fh:
            fh.write(GLOVE_VERSION)
    cuff_mat = _mat("br_cuff", None, (0.030, 0.032, 0.028), None, None,
                    rough_factor=0.95)
    glove = _mat("br_glove", None, (0.09, 0.095, 0.085), None, None,
                 rough_factor=0.90)

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
    gmask = np.zeros((GLOVE_TEX, GLOVE_TEX, _GL_CH), np.float32)
    gcov = np.zeros((GLOVE_TEX, GLOVE_TEX), np.float32)
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
                # W1 (iter06): ONE tapered cone is a tube, not a cuff — the
                # critics read the wrist as "a featureless olive stub". A cuff
                # reads as a cuff because of its EDGES: a flared gauntlet band,
                # a raised wrist strap around it, and a rolled lip at the mouth.
                # Three short cones, ~350 tris, and the silhouette gains three
                # horizontal breaks where it previously had none. They wear the
                # GLOVE material now (they get real UVs from the unwrap below,
                # so iter05's smeared-atlas reason for the separate slot is
                # gone) and the texture paints the strap/lip on top of them.
                def _ring(off, dep, r1, r2, seg=28):
                    st = ctr + e_dir * off
                    m = Matrix(((xc.x, yc.x, zc.x, st.x),
                                (xc.y, yc.y, zc.y, st.y),
                                (xc.z, yc.z, zc.z, st.z),
                                (0, 0, 0, 1)))
                    return bmesh.ops.create_cone(
                        bm, cap_ends=False, cap_tris=False, segments=seg,
                        radius1=cuff_r * r1, radius2=cuff_r * r2, depth=dep,
                        calc_uvs=True, matrix=m)
                pre_f = set(bm.faces)
                _ring(0.006, 0.034, 1.06, 1.19)      # gauntlet band, flared
                _ring(0.0245, 0.008, 1.19, 1.28)     # wrist strap, proud
                _ring(0.0305, 0.006, 1.28, 1.22)     # strap top edge
                _ring(0.0405, 0.010, 1.24, 1.30)     # rolled cuff lip
                n_cuff = sum(1 for f in bm.faces if f not in pre_f)
                print(f"A4CUFF {key}: {n_cuff} cuff faces (band+strap+lip)")
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        bm.to_mesh(dup.data)
        bm.free()
        dup.data.update()
        dup.data.materials.clear()
        dup.data.materials.append(glove)
        dup.data.materials.append(cuff_mat)

        # ---- canonical finger skeleton ------------------------------------
        Fi = F.inverted()
        Fi3 = Fi.to_3x3()
        segs = fingers.get(key, [])
        if segs:
            SA = np.array([tuple(Fi @ s["h"]) for s in segs], np.float64)
            SB = np.array([tuple(Fi @ s["t"]) for s in segs], np.float64)
            SBK = np.array([tuple((Fi3 @ s["back"]).normalized()) for s in segs])
            SF = np.array([s["fid"] for s in segs])
            SJ = np.array([s["jid"] for s in segs])
            SR = np.array([s["rad"] for s in segs])
            # joints: MCP (the big knuckle) reads hardest, then PIP, then DIP
            JP = np.concatenate([SA, SB[SJ == 3]])
            JW = np.concatenate([np.where(SJ == 1, 1.0, np.where(SJ == 2, 0.85, 0.6)),
                                 np.full((SJ == 3).sum(), 0.45)])
            # the MCP row IS the knuckle plate of a tactical glove — it needs a
            # wide field, not a point. PIP/DIP are creases and stay tight.
            JS = np.concatenate([np.where(SJ == 1, 0.0145, np.where(SJ == 2, 0.0100, 0.0088)),
                                 np.full((SJ == 3).sum(), 0.0080)])
            TIP = SB[SJ == 3]
            MCP = SA[SJ == 1]
            palm_ctr = MCP.mean(0) * 0.55       # between wrist and the MCP row
            palm_ctr = palm_ctr - np.array(SBK[SJ == 1].mean(0)) * 0.010
            # landmarks, canonical — place_arms prints them in weapon space so
            # a grip can be CHECKED (fingertips near the handguard, below the
            # rail) instead of eyeballed off a render. See A4HAND.
            lm = {"wrist": [0.0, 0.0, 0.0],
                  "palm": [float(c) for c in palm_ctr]}
            for fi, fn in enumerate(_GL_FING):
                sel = np.where((SF == fi) & (SJ == 3))[0]
                if len(sel):
                    lm[fn.lower() + "_tip"] = [float(c) for c in SB[sel[0]]]
            dup["a4_lm"] = json.dumps(lm)

            def anat(co, no):
                AB = SB - SA
                L2 = np.maximum((AB * AB).sum(1), 1e-9)
                tt = np.clip(((co[:, None, :] - SA[None]) * AB[None]).sum(2) / L2[None], 0, 1)
                CP = SA[None] + tt[..., None] * AB[None]
                Dn = np.linalg.norm(co[:, None, :] - CP, axis=2) - SR[None]
                si = Dn.argmin(1)
                ix = np.arange(co.shape[0])
                dmin = Dn[ix, si]
                fing = 1.0 - _sstep(0.0005, 0.0115, dmin)
                dother = np.where(SF[None, :] == SF[si][:, None], 1e3, Dn).min(1)
                bx = SBK[si] * fing[:, None] + np.array([0.0, 0.0, 1.0])[None] * (1 - fing[:, None])
                bx /= np.maximum(np.linalg.norm(bx, axis=1, keepdims=True), 1e-9)
                back = (no * bx).sum(1)
                dj = np.linalg.norm(co[:, None, :] - JP[None], axis=2)
                jf = (JW[None] * np.exp(-(dj / JS[None]) ** 2)).max(1)
                dt = np.linalg.norm(co[:, None, :] - TIP[None], axis=2).min(1)
                tip = np.exp(-(dt / 0.017) ** 2)
                dmc = np.linalg.norm(co[:, None, :] - (MCP[None] * np.clip(
                    ((co[:, None, :] * MCP[None]).sum(2)
                     / np.maximum((MCP * MCP).sum(1), 1e-9)[None])[..., None], 0, 1)),
                    axis=2).min(1)
                dp = np.linalg.norm(co - palm_ctr[None], axis=1)
                hand = np.exp(-(dp / 0.105) ** 2)
                palm = np.exp(-(dp / 0.050) ** 2) * np.clip(-back, 0, 1)
                axl = (co * np.array(tuple(e_dir))[None]).sum(1)
                return dict(fing=fing, dmin=dmin, dother=dother, back=back, bx=bx,
                            joint=jf, tip=tip, palm=palm, hand=hand, ax=axl,
                            dmc=dmc, CP=CP[ix, si])

            # ---- SCULPT (W1, iter06) --------------------------------------
            # "smooth featureless tubes with no knuckles" was literal: the
            # source shell has no glove relief at all and a 0.30 decimate then
            # removed what little curvature the fingers had. These four
            # displacements are all bone-driven, so they land on the anatomy:
            #   valley  — pulls each finger toward its OWN bone where a
            #             neighbour is close, so the fingers separate instead
            #             of fusing into one lump;
            #   bulge   — a knuckle over every joint on the back side;
            #   crease  — the matching fold on the palm side;
            #   tendon  — metacarpal ridges across the back of the hand.
            me = dup.data
            n = len(me.vertices)
            co = np.empty(n * 3, np.float64)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            no = np.empty(n * 3, np.float64)
            me.vertex_normals.foreach_get("vector", no)
            no = no.reshape(-1, 3)
            A = anat(co, no)
            rad = co - A["CP"]
            rn = np.maximum(np.linalg.norm(rad, axis=1, keepdims=True), 1e-9)
            rhat = rad / rn
            valley = (0.0021 * A["fing"] * (1.0 - _sstep(0.0, 0.0105, A["dother"]))
                      + 0.0008 * A["fing"])
            solid = np.maximum(A["fing"], A["hand"] * 0.75)
            bulge = 0.0026 * A["joint"] * np.clip(A["back"], 0, 1) * solid
            crease = 0.0019 * A["joint"] * np.clip(-A["back"], 0, 1) * solid
            tendon = (0.0013 * np.exp(-(A["dmc"] / 0.0075) ** 2)
                      * np.clip(no[:, 2], 0, 1) * A["hand"] * (1 - A["fing"]))
            co = (co - rhat * valley[:, None]
                  + no * (bulge - crease + tendon)[:, None])
            me.vertices.foreach_set("co", co.ravel())
            me.update()
            print("A4GLOVE %s sculpt: fingers %d verts, knuckle max %.4f m"
                  % (key, int((A["fing"] > 0.5).sum()), float(bulge.max())))

        # decimate — collapse on a WATERTIGHT mesh stays watertight; 0.22 on
        # the old torn shells is what turned the rips into confetti. W1
        # (iter06): 0.30 threw away the knuckles as fast as the sculpt built
        # them — at 0.62 each hand is ~8k tris, which is a normal FPS hand
        # budget for an asset that sits 20 cm from the lens.
        mod = dup.modifiers.new("dec", "DECIMATE")
        mod.ratio = 0.62
        apply_all(dup)
        shade_smooth(dup, 55)
        dup.name = f"arm_{key}"

        # ---- DEDICATED UV SPACE + ANATOMY MASK ----------------------------
        # One hand per texture quadrant: ~496x496 texels each, isotropic,
        # against the ~512-atlas-slice the hand used to share with a whole body.
        try:
            bpy.context.view_layer.objects.active = dup
            for so in bpy.context.selected_objects:
                so.select_set(False)
            dup.select_set(True)
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.uv.smart_project(angle_limit=D(66), island_margin=0.012,
                                     correct_aspect=True, scale_to_bounds=True)
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception as e:
            print("A4GLOVE unwrap FAILED", key, e)
        me = dup.data
        uvl = me.uv_layers.active
        uva = None
        if uvl:
            uva = np.empty(len(uvl.data) * 2, np.float32)
            uvl.data.foreach_get("uv", uva)
            uva = uva.reshape(-1, 2)
            uva = uva * 0.484 + np.array([0.508 if key == "L" else 0.008, 0.008],
                                         np.float32)[None]
            uvl.data.foreach_set("uv", uva.ravel())
        # the maps are authored once and cached; every weapon still needs the
        # unwrap, but only the first pays for the rasterise.
        if uva is not None and segs and not os.path.exists(glove_alb):
            n = len(me.vertices)
            co = np.empty(n * 3, np.float64)
            me.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            no = np.empty(n * 3, np.float64)
            me.vertex_normals.foreach_get("vector", no)
            no = no.reshape(-1, 3)
            A = anat(co, no)
            fields = np.stack([
                A["fing"], A["joint"], 0.5 + 0.5 * np.clip(A["back"], -1, 1),
                A["tip"], A["palm"], np.clip(A["ax"] / 0.14, 0, 1), A["hand"],
            ], axis=-1).astype(np.float32)
            me.calc_loop_triangles()
            nt = len(me.loop_triangles)
            lt = np.empty(nt * 3, np.int32)
            me.loop_triangles.foreach_get("loops", lt)
            lv = np.empty(len(me.loops), np.int32)
            me.loops.foreach_get("vertex_index", lv)
            lt = lt.reshape(-1, 3)
            _raster_fields(gmask, gcov, uva[lt], fields[lv[lt]])
            print("A4GLOVE %s raster: %d tris, coverage %.1f%%"
                  % (key, nt, 100.0 * float(gcov.mean())))
        _ARM_CACHE[key] = dup

    # ---- author the glove maps through that unwrap -------------------------
    if not os.path.exists(glove_alb):
        gm = _dilate(gmask, gcov, 12)
        if os.environ.get("A4GLOVE_DEBUG"):
            for ci, cn in enumerate(("fing", "joint", "back", "tip", "palm",
                                     "axial", "hand")):
                dbg = np.repeat(gm[..., ci:ci + 1], 3, axis=2)
                _save_img("dbg_glove_" + cn,
                          np.concatenate([np.clip(dbg, 0, 1),
                                          np.ones((GLOVE_TEX, GLOVE_TEX, 1))],
                                         axis=-1)[::-1])
            np.save(os.path.join(GEN_DIR, "dbg_glove_mask.npy"), gm)
            print("A4GLOVE debug masks written")
        rgb, hh, rg = _glove_maps(gm)
        px = np.concatenate([np.clip(rgb, 0, 1),
                             np.ones((GLOVE_TEX, GLOVE_TEX, 1))], axis=-1)
        img = bpy.data.images.new("glove_albedo", GLOVE_TEX, GLOVE_TEX, alpha=True)
        img.pixels.foreach_set(np.ascontiguousarray(px[::-1], dtype=np.float32).ravel())
        img.filepath_raw = glove_alb
        img.file_format = "JPEG"
        img.save(quality=94)
        gx = np.roll(hh, -1, 1) - np.roll(hh, 1, 1)
        gy = np.roll(hh, -1, 0) - np.roll(hh, 1, 0)
        k = 9.0   # iter07: relief carries the wear the albedo gave up
        nx, ny, nz = -gx * k, -gy * k, np.ones_like(hh)
        ln = np.sqrt(nx * nx + ny * ny + nz * nz)
        # half-res normal: this map is embedded in EVERY weapon GLB, and at
        # 1024 the PNG alone added 2.0 MB per weapon. The albedo carries the
        # ripstop at full resolution; the normal only has to carry the pads,
        # the seams and the cuff, which survive a box halving.
        npx = np.stack([_box2(nx / ln) * 0.5 + 0.5, _box2(ny / ln) * 0.5 + 0.5,
                        _box2(nz / ln) * 0.5 + 0.5,
                        np.ones((GLOVE_TEX // 2, GLOVE_TEX // 2))], axis=-1)
        nimg = bpy.data.images.new("glove_normal", GLOVE_TEX // 2, GLOVE_TEX // 2,
                                   alpha=True)
        nimg.pixels.foreach_set(np.ascontiguousarray(npx[::-1], dtype=np.float32).ravel())
        nimg.filepath_raw = glove_nrm
        nimg.file_format = "PNG"
        nimg.save()
        rgh = _box2(rg)
        opx = np.stack([np.ones_like(rgh), rgh, np.zeros_like(rgh),
                        np.ones_like(rgh)], axis=-1)
        oimg = bpy.data.images.new("glove_orm", GLOVE_ORM, GLOVE_ORM, alpha=True)
        oimg.pixels.foreach_set(np.ascontiguousarray(opx[::-1], dtype=np.float32).ravel())
        oimg.filepath_raw = glove_orm
        oimg.file_format = "PNG"
        oimg.save()
        _TEX_STATS["glove_albedo"] = {"kind": "albedo",
                                      "std": round(float(rgb[..., 1].std()), 4),
                                      "mean": round(float(rgb[..., 1].mean()), 4),
                                      "px": GLOVE_TEX}
        _TEX_STATS["glove_orm"] = {"kind": "rough", "std": round(float(rg.std()), 4),
                                   "mean": round(float(rg.mean()), 4), "px": GLOVE_ORM}
        _TEX_STATS["glove_normal"] = {"kind": "normal",
                                      "std": round(float((nx / ln).std() * 0.5), 4),
                                      "mean": round(float((nz / ln).mean()), 4),
                                      "px": GLOVE_TEX // 2}
    # same datablock, rebuilt with the maps now that they exist
    _mat("br_glove", glove_alb if os.path.exists(glove_alb) else None,
         (0.09, 0.095, 0.085),
         glove_orm if os.path.exists(glove_orm) else None,
         glove_nrm if os.path.exists(glove_nrm) else None,
         rough_factor=1.0, normal_strength=1.15)

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
        try:
            lm = json.loads(src.get("a4_lm", "{}"))
            out = {k: [round(c, 4) for c in (M @ Vector(v))] for k, v in lm.items()}
            print("A4HAND %s %s %s" % (wid, hand, json.dumps(out)))
        except Exception:
            pass
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
    "corvus": {"posHip": (0.175, -0.195, -0.40), "zAds": -0.26},
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
    # The ADS eye position is GEOMETRY INPUT, not just a preview camera: the
    # optic's bore cone (and therefore every housing radius) is derived from
    # how far the eye sits behind the ocular. VIEW zAds mirrors weapon_data.js
    # view.posAds[2]; if that drifts, the sight picture vignettes.
    z_ads = VIEW[wid].get("zAds", VIEW[wid]["posHip"][2] * 0.76)

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
    parts += build_scope(cfg, bore_z, mats, z_ads)
    md_objs, muzzle_tip_y = build_muzzle_device(cfg, muzzle_y, bore_z, mats)
    parts += md_objs
    parts += build_foregrip(cfg.get("foregrip"), mats)
    ej_objs, ej_pos = build_eject_plate(cfg, right_x, mats)
    parts += ej_objs

    # UVs for authored parts (noise textures forgive seams). The optic shell
    # is unwrapped cylindrically instead — cube-projecting a tube is what smeared
    # the housing in iter05's S2 (see uv_axial_project).
    dens = measure_uv_density(base)
    dressing_uv = [p for p in parts if p is not base]
    uv_cube_project([p for p in dressing_uv if p.get("uv_axial") is None],
                    cube_size=dens)
    uv_axial_project([p for p in dressing_uv if p.get("uv_axial") is not None],
                     dens)
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
        print("A4GRIP %s bore_z %.4f sight_z %.4f lh_y %s seat %s" %
              (wid, bore_z, sight_z, lh_y,
               round(support_hand_seat(base, lh_y, bore_z), 4) if lh_y is not None else None))
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
