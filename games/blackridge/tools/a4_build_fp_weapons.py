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
#   6. rig-cut arms: soldier.glb posed (finger curl) via its armature, hands+
#      forearms cut by vertex-group weight, decimated, glove/sleeve tinted
#      (bare-skin fingers darkened to tactical-glove read), placed per weapon;
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
        "foregrip": {"y": 0.27, "drop": 0.075, "r": 0.014},
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
        "foregrip": {"y": 0.20, "drop": 0.065, "r": 0.013},
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
        "sight_h": 0.081,          # scope axis (ADS rides this line)
        "rail": None,
        "scope": {"axis_rel": 0.081, "y_ocular": -0.088, "tube_r": 0.0165,
                  "bell_r": 0.0225, "y_turret": 0.045},
        "strip_regions": [
            {"y0": -0.135, "y1": -0.052, "half_w": 0.030, "z_rel": 0.056},
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
ARM_POSE = {
    "warden": [
        ("R", (0.035, -0.095, -0.075), (-0.10, 0.90, 0.25), (-0.95, 0.20, -0.25)),
        ("L", (-0.05, 0.22, -0.090), (0.85, 0.35, 0.40), (0.50, 0.10, 0.85)),
    ],
    "vesper": [
        ("R", (0.035, -0.095, -0.075), (-0.10, 0.90, 0.25), (-0.95, 0.20, -0.25)),
        ("L", (-0.05, 0.16, -0.088), (0.85, 0.35, 0.40), (0.50, 0.10, 0.85)),
    ],
    "corvus": [
        ("R", (0.035, -0.095, -0.075), (-0.10, 0.90, 0.25), (-0.95, 0.20, -0.25)),
        ("L", (-0.05, 0.19, -0.10), (0.85, 0.30, 0.45), (0.45, 0.05, 0.90)),
    ],
    "pike": [
        ("R", (0.030, -0.085, -0.085), (-0.10, 0.85, 0.15), (-0.95, 0.15, -0.20)),
        ("L", (-0.030, -0.095, -0.105), (0.90, 0.30, 0.20), (0.60, 0.30, 0.70)),
    ],
}

# ---------------------------------------------------------------------------
# texture generation (numpy — Blender's python has no PIL)
# ---------------------------------------------------------------------------
def _value_noise(size, cell, seed):
    rng = np.random.default_rng(seed)
    g = rng.random((cell + 2, cell + 2))
    ys, xs = np.mgrid[0:size, 0:size]
    fx = xs * cell / size
    fy = ys * cell / size
    x0 = fx.astype(int); y0 = fy.astype(int)
    tx = fx - x0; ty = fy - y0
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty)
    a = g[y0, x0]; b = g[y0, x0 + 1]; c = g[y0 + 1, x0]; d = g[y0 + 1, x0 + 1]
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty

def _fbm(size, seed, octaves=4, base_cell=6):
    out = np.zeros((size, size))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += _value_noise(size, base_cell * (2 ** o), seed + o * 17) * amp
        tot += amp
        amp *= 0.55
    return out / tot

def _scratches(size, seed, n, val):
    img = np.zeros((size, size))
    rng = np.random.default_rng(seed)
    for i in range(n):
        x0, y0 = rng.integers(0, size, 2)
        ang = rng.random() * math.pi
        ln = rng.integers(size // 20, size // 5)
        dx, dy = math.cos(ang), math.sin(ang)
        for t in range(ln):
            x = int(x0 + dx * t) % size
            y = int(y0 + dy * t) % size
            img[y, x] = val * (0.5 + 0.5 * rng.random())
    return img

def _save_img(name, rgba):  # rgba float 0..1, HxWx4
    h, w = rgba.shape[:2]
    img = bpy.data.images.get(name) or bpy.data.images.new(name, w, h, alpha=True)
    if tuple(img.size) != (w, h):
        img.scale(w, h)
    img.pixels[:] = rgba.astype(np.float32).ravel()
    path = os.path.join(GEN_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return path

def gen_textures():
    S = 512
    done = {}
    # NOTE: tints are baked INTO the albedo textures. A ShaderNodeMix multiply
    # exports a correct baseColorFactor but did NOT evaluate in the EEVEE
    # preview renders this pipeline is judged with — baked pixels are the only
    # path where preview == export (observed this session; keep it this way).
    p = os.path.join(GEN_DIR, "gun_albedo_body.png")
    if not os.path.exists(p):
        # Charcoal polymer furniture. W1 CALIBRATION (iter02 fix): the previous
        # set authored sRGB 0.13-0.21 => 0.015-0.035 LINEAR, i.e. darker than
        # charcoal, which forced weapon_meshes.js to apply a 3.4x runtime colour
        # multiplier — and that multiplier is what turned the viewmodel into the
        # blown-out white polygon soup of iter02 S1/S2. Authoring real values
        # here (sRGB 0.23-0.40 => 0.042-0.13 linear, the measured range of
        # phosphate/polymer gun furniture) lets the runtime multiplier be 1.0.
        n = _fbm(S, 11, 5, 5) * 0.10 + 0.23
        n += _scratches(S, 12, 90, 0.07)
        n = np.clip(n, 0, 1)
        rgba = np.stack([n, n * 1.02, n * 1.05, np.ones_like(n)], axis=-1)
        _save_img("gun_albedo_body", rgba)
    done["albedo_body"] = p
    p = os.path.join(GEN_DIR, "gun_albedo_metal.png")
    if not os.path.exists(p):
        # metalness = 1 for these regions, so base colour IS F0 reflectance:
        # parkerised/blued steel sits near 0.11-0.30 linear (sRGB 0.37-0.60).
        n = _fbm(S, 13, 5, 7) * 0.10 + 0.37
        n += _scratches(S, 14, 130, 0.14)
        n = np.clip(n, 0, 1)
        rgba = np.stack([n * 0.95, n, n * 1.12, np.ones_like(n)], axis=-1)
        _save_img("gun_albedo_metal", rgba)
    done["albedo_metal"] = p
    p = os.path.join(GEN_DIR, "gun_orm_polymer.png")
    if not os.path.exists(p):
        r = np.clip(_fbm(S, 21, 5, 7) * 0.45 + 0.48 + _scratches(S, 22, 60, -0.25), 0.05, 1)
        rgba = np.stack([np.ones_like(r), r, np.zeros_like(r), np.ones_like(r)], axis=-1)
        _save_img("gun_orm_polymer", rgba)
    done["orm_polymer"] = p
    p = os.path.join(GEN_DIR, "gun_orm_metal.png")
    if not os.path.exists(p):
        base = _fbm(S, 31, 5, 9) * 0.30 + 0.24
        streak = _fbm(S, 32, 3, 2)
        streak = np.roll(streak, 3, axis=1) - streak  # directional smear
        r = np.clip(base + streak * 0.5 + _scratches(S, 33, 120, 0.35), 0.04, 1)
        rgba = np.stack([np.ones_like(r), r, np.ones_like(r), np.ones_like(r)], axis=-1)
        _save_img("gun_orm_metal", rgba)
    done["orm_metal"] = p
    p = os.path.join(GEN_DIR, "gun_normal.png")
    if not os.path.exists(p):
        h = _fbm(S, 41, 5, 6)
        gx = np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)
        gy = np.roll(h, -1, axis=0) - np.roll(h, 1, axis=0)
        k = 2.2  # mild
        nx = -gx * k; ny = -gy * k; nz = np.ones_like(h)
        ln = np.sqrt(nx * nx + ny * ny + nz * nz)
        rgba = np.stack([(nx / ln) * 0.5 + 0.5, (ny / ln) * 0.5 + 0.5,
                         (nz / ln) * 0.5 + 0.5, np.ones_like(h)], axis=-1)
        _save_img("gun_normal", rgba)
    done["normal"] = p
    return done

# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------
def _mat(name, albedo_img, tint, orm_img, normal_img, rough_factor=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    outn = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], outn.inputs["Surface"])
    bsdf.inputs["Emission Strength"].default_value = 0.0
    if albedo_img:
        # tint is pre-baked into the texture (see gen_textures NOTE)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(albedo_img, check_existing=True)
        tex.image.colorspace_settings.name = "sRGB"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (*tint, 1.0)
    if orm_img:
        orm = nt.nodes.new("ShaderNodeTexImage")
        orm.image = bpy.data.images.load(orm_img, check_existing=True)
        orm.image.colorspace_settings.name = "Non-Color"
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Roughness"].default_value = rough_factor if rough_factor is not None else 0.8
        bsdf.inputs["Metallic"].default_value = 0.0
    if normal_img:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = bpy.data.images.load(normal_img, check_existing=True)
        ntex.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.6
        nt.links.new(ntex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m

def make_materials(tex):
    return {
        "body": _mat("br_body", tex["albedo_body"], None, tex["orm_polymer"], tex["normal"]),
        "metal": _mat("br_metal", tex["albedo_metal"], None, tex["orm_metal"], tex["normal"]),
        "grip": _mat("br_grip", tex["albedo_body"], None, tex["orm_polymer"], tex["normal"]),
        "accent": _mat("br_accent", None, (0.85, 0.85, 0.82), None, None, rough_factor=0.35),
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

def uv_cube_project(objs):
    for o in objs:
        if o.type != "MESH" or not o.data.polygons:
            continue
        bpy.context.view_layer.objects.active = o
        for so in bpy.context.selected_objects: so.select_set(False)
        o.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.cube_project(cube_size=0.12)
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
def strip_top(mo, y0, y1, z_cut, half_w):
    """Remove the base mesh's mangled top furniture (bent Meshy sight towers,
    mushy rail) in a narrow centerline channel — the authored rail/sights
    replace it. Leaves a channel the rail base covers."""
    bm = bmesh.new()
    bm.from_mesh(mo.data)
    doomed = [v for v in bm.verts
              if v.co.z > z_cut and y0 < v.co.y < y1 and abs(v.co.x) < half_w]
    bmesh.ops.delete(bm, geom=doomed, context="VERTS")
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
    """Crisp authored OCULAR for the DMR (W1, iter02 S2 fix).

    The Meshy sniper carries a real scope body, but its rear ocular is a lumpy
    asymmetric blob — and at full ADS that blob IS the frame (iter02 S2 read as
    'a deformed torus with shattered facets'). strip_regions removes the blob;
    this rebuilds the eyepiece the shooter actually stares through: a stepped
    bell, a crisp eyecup lip, and an OPEN bore so the world stays visible
    (no black lens disc — A10 owns the scope overlay; an opaque lens would
    blind the player if that overlay is late).
    """
    sc = cfg.get("scope")
    if not sc:
        return []
    z = bore_z + sc["axis_rel"]
    y = sc["y_ocular"]
    tr, br = sc["tube_r"], sc["bell_r"]
    objs = []
    # tube stub bridging into the surviving Meshy scope body
    objs.append(cyl("sc_tube", 0, y + 0.055, z, tr, 0.075, mats["metal"], axis="Y", verts=28))
    # stepped ocular bell (tube -> bell over 18 mm)
    objs.append(cyl("sc_step", 0, y + 0.026, z, tr * 1.16, 0.018, mats["metal"], axis="Y", verts=28,
                    r2=br * 0.94))
    objs.append(cyl("sc_bell", 0, y + 0.008, z, br, 0.022, mats["metal"], axis="Y", verts=32))
    # rubber eyecup lip: a thin proud ring at the very rear face
    objs.append(cyl("sc_cup", 0, y - 0.005, z, br * 1.06, 0.007, mats["grip"], axis="Y", verts=32))
    # bore it out so the eyepiece is a RING, not a plug
    bore = cyl("sc_bore", 0, y + 0.010, z, br * 0.80, 0.060, None, axis="Y", verts=32)
    for o in (objs[-1], objs[-2]):
        m = o.modifiers.new("bore", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.object = bore
        bpy.context.view_layer.update()
        apply_all(o)
    bpy.data.objects.remove(bore, do_unlink=True)
    # elevation + windage turrets (crisp knurled cylinders on the real tube)
    ty = sc["y_turret"]
    objs.append(cyl("sc_turret_up", 0, ty, z + tr * 0.92, 0.011, 0.016, mats["metal"], axis="Z", verts=18))
    objs.append(cyl("sc_turret_up_cap", 0, ty, z + tr * 0.92 + 0.014, 0.0092, 0.005, mats["metal"], axis="Z", verts=18))
    objs.append(cyl("sc_turret_lw", -tr * 0.92, ty, z, 0.010, 0.014, mats["metal"], axis="X", verts=18))
    # ring mounts
    for my in (ty - 0.055, ty + 0.075):
        objs.append(cyl(f"sc_ring{my:.3f}", 0, my, z, tr * 1.14, 0.012, mats["metal"], axis="Y", verts=24))
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
    """slot0 = body, slot1 = metal (barrel region forward + top), slot2 = grip."""
    mo.data.materials.clear()
    mo.data.materials.append(mats["body"])
    mo.data.materials.append(mats["metal"])
    mo.data.materials.append(mats["grip"])
    fg_y = cfg.get("barrel_y", cfg["length"] * 0.52)
    for p in mo.data.polygons:
        c = p.center
        if c.y > fg_y and abs(c.z - bore_z) < 0.05:
            p.material_index = 1     # exposed barrel/muzzle area
        elif c.z < -0.02 and abs(c.y) < 0.07:
            p.material_index = 2     # pistol grip region
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
    for side, key in (("Right", "R"), ("Left", "L")):
        pb = arm.pose.bones[f"mixamorig:{side}Hand"]
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

    # glove material: soldier albedo pre-tinted dark olive (baked into pixels —
    # kills the bare-skin read; see gen_textures NOTE on why not a Mix node)
    sol_img = None
    for m in mesh.data.materials:
        if m and m.use_nodes:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE" and n.image and any(
                        l.to_socket.name == "Base Color" for l in n.outputs["Color"].links):
                    sol_img = n.image
    glove_alb = os.path.join(GEN_DIR, "glove_albedo.png")
    if sol_img and not os.path.exists(glove_alb):
        w, h = sol_img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        sol_img.pixels.foreach_get(px)
        px = px.reshape(h, w, 4)
        # W1: was 0.22/0.235/0.20 => ~0.02 linear, i.e. black at night, which is
        # why the runtime applied a 4.5x glove multiplier. A plain multiply is
        # the wrong operator though — it keeps the soldier atlas's SKIN HUE, so
        # the forearms read as bare arms (observed in this session's preview).
        # Re-map luminance into a dark-olive nomex band instead: hue is forced,
        # the albedo's own detail survives as the value variation, and the
        # result (~sRGB 0.20-0.36 => 0.03-0.10 linear) needs no runtime lift.
        lum = 0.30 * px[..., 0] + 0.60 * px[..., 1] + 0.10 * px[..., 2]
        v = np.clip(lum, 0.0, 1.0) ** 0.9
        band = 0.185 + 0.175 * v
        px[..., 0] = band * 0.90
        px[..., 1] = band * 1.00
        px[..., 2] = band * 0.74
        img = bpy.data.images.new("glove_albedo", w, h, alpha=True)
        img.pixels.foreach_set(px.ravel())
        img.filepath_raw = glove_alb
        img.file_format = "PNG"
        img.save()
    glove = bpy.data.materials.new("br_glove")
    glove.use_nodes = True
    nt = glove.node_tree
    nt.nodes.clear()
    outn = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], outn.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.88
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Emission Strength"].default_value = 0.0
    if os.path.exists(glove_alb):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(glove_alb, check_existing=True)
        tex.image.colorspace_settings.name = "sRGB"
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = (0.09, 0.095, 0.085, 1.0)

    for side, key in (("Right", "R"), ("Left", "L")):
        dup = mesh.copy()
        dup.data = mesh.data.copy()
        dup.name = f"arm_{key}"
        link(dup)
        keep = {f"mixamorig:{side}Hand", f"mixamorig:{side}ForeArm"}
        for f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
            for j in (1, 2, 3):
                keep.add(f"mixamorig:{side}Hand{f}{j}")
        gidx = {g.index: (g.name in keep) for g in dup.vertex_groups}
        bm = bmesh.new()
        bm.from_mesh(dup.data)
        dl = bm.verts.layers.deform.active
        doomed = []
        for v in bm.verts:
            wsum = sum(w for gi, w in v[dl].items() if gidx.get(gi))
            if wsum < 0.45:
                doomed.append(v)
        bmesh.ops.delete(bm, geom=doomed, context="VERTS")
        # drop shredded fragments: keep only connected islands >= 200 verts
        bm.verts.ensure_lookup_table()
        seen = set()
        islands = []
        for v in bm.verts:
            if v.index in seen:
                continue
            stack = [v]
            isl = []
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
        if islands:
            islands.sort(key=len, reverse=True)
            doomed2 = [v for isl in islands for v in isl if len(isl) < 200]
            if doomed2:
                bmesh.ops.delete(bm, geom=doomed2, context="VERTS")
        bm.to_mesh(dup.data)
        bm.free()
        # canonicalize: wrist->origin, fingers +Y, palm -Z
        dup.data.transform(frames[key].inverted())
        dup.data.update()
        # Shorten the forearm: keep ~19 cm behind the wrist (exits frame low).
        # W1 (iter02 fix): this used to be a vertex DELETE, which follows the
        # mesh's own edges and leaves a ragged, OPEN tube mouth — clay-rendered
        # this session, both forearms ended in hollow cones with torn rims, one
        # of the loudest amateur tells in the battery. Now: a clean planar
        # bisect, the cut loop filled, and a proud sleeve cuff so the arm ends
        # in a garment edge instead of a hole.
        bm2 = bmesh.new()
        bm2.from_mesh(dup.data)
        CUT_Y = -0.19
        geom = list(bm2.verts) + list(bm2.edges) + list(bm2.faces)
        res = bmesh.ops.bisect_plane(bm2, geom=geom, dist=1e-6,
                                     plane_co=(0.0, CUT_Y, 0.0),
                                     plane_no=(0.0, -1.0, 0.0),
                                     clear_outer=True)
        cut_edges = [e for e in res.get("geom_cut", [])
                     if isinstance(e, bmesh.types.BMEdge)]
        if cut_edges:
            try:
                bmesh.ops.edgeloop_fill(bm2, edges=cut_edges)
            except Exception:
                bmesh.ops.triangle_fill(bm2, edges=cut_edges, use_beauty=True)
        # belt-and-braces: close anything the bisect left open
        try:
            bmesh.ops.holes_fill(bm2, edges=list(bm2.edges), sides=0)
        except Exception:
            pass
        # Sleeve cuff sized off the arm's OWN cross-section at the cut. The
        # forearm is not axis-aligned there, so the radius must be measured
        # from the section CENTROID — measuring from the canonical Y axis
        # (first attempt this session) folded the offset into the radius and
        # produced a pancake ~2.5x the arm, which then occluded a third of the
        # ADS frame. Centroid + a hard clamp against a stray-vertex blow-up.
        band = [v.co for v in bm2.verts
                if CUT_Y - 0.004 < v.co.y < CUT_Y + 0.030]
        if len(band) >= 8:
            cx = sum(c.x for c in band) / len(band)
            cz = sum(c.z for c in band) / len(band)
            rs = sorted(math.hypot(c.x - cx, c.z - cz) for c in band)
            cuff_r = rs[int(len(rs) * 0.92)]          # 92nd pct, not max
            cuff_r = min(cuff_r, 0.045)               # a forearm is not 9 cm
            if cuff_r > 0.004:
                bmesh.ops.create_cone(
                    bm2, cap_ends=True, cap_tris=False, segments=20,
                    radius1=cuff_r * 1.14, radius2=cuff_r * 1.06, depth=0.026,
                    calc_uvs=True,
                    matrix=(Matrix.Translation((cx, CUT_Y + 0.011, cz)) @
                            Matrix.Rotation(D(90), 4, "X")))
        bmesh.ops.recalc_face_normals(bm2, faces=list(bm2.faces))
        bm2.to_mesh(dup.data)
        bm2.free()
        dup.data.update()
        # single glove material
        dup.data.materials.clear()
        dup.data.materials.append(glove)
        # decimate
        mod = dup.modifiers.new("dec", "DECIMATE")
        mod.ratio = 0.22
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
VIEW = {  # posHip / posAds in glTF camera space (x right, y up, z back)
    "warden": {"posHip": (0.165, -0.185, -0.34), "sightY": None},
    "vesper": {"posHip": (0.155, -0.175, -0.30), "sightY": None},
    "corvus": {"posHip": (0.175, -0.195, -0.40), "sightY": None},
    "pike":   {"posHip": (0.145, -0.165, -0.27), "sightY": None},
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
    z_ads = v[2] * 0.76
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
    tex = gen_textures()
    mats = make_materials(tex)

    base, muzzle_y, bore_z, right_x, scale = import_base(cfg)
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
    uv_cube_project([p for p in parts if p is not base])
    for p in parts:
        if p is not base:
            apply_all(p)
            shade_smooth(p, 35)
    shade_smooth(base, 40)

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
        lh_y = cfg.get("lh_y")
        if lh_y is not None:
            seat = support_hand_seat(base, lh_y, bore_z)
            for p in pose:
                if p[0] == "L":
                    # wrist sits ~3.2 cm under the handguard so the curled
                    # fingers close ON it rather than in the air below it
                    p[1] = (p[1][0], lh_y, seat - 0.032)
        pose = [tuple(p) for p in pose]
        parts += place_arms(wid, mats, pose_override=pose)

    # sockets
    mz = bpy.data.objects.new("SOCKET_muzzle", None)
    mz.location = (0, muzzle_tip_y, bore_z)
    link(mz)
    ej = bpy.data.objects.new("SOCKET_eject", None)
    ej.location = ej_pos if ej_pos else (right_x, 0.03, bore_z)
    link(ej)

    # previews
    previews(wid, sight_z)

    # export
    out = os.path.join(OUT_DIR, f"{wid}.glb")
    for o in bpy.context.scene.collection.objects: o.select_set(False)
    for o in parts + [mz, ej]:
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
