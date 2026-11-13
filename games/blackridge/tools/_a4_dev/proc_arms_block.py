# =============================================================================
# PROCEDURAL ARMS (presentation pass, 2026-10) — REPLACES the soldier rig-cut.
#
# WHY. The soldier.glb rig-cut (build_arm_chunks above, kept for the record and
# no longer called) produced shells of torn camo ribbon: bell-shaped sleeve
# cones with no readable hand, in the muddy olive of the Meshy soldier's own
# uniform atlas. Rendered from the a4 grip preview the "hand" is a funnel and
# five loose strips. Ten iterations of texture/lighting work could not fix a
# surface that is not a hand, so the hand is now AUTHORED: a glove built from
# tapered capsules (palm + thumb + four 3-phalanx fingers curled by FK angles),
# unioned and smoothed by a voxel remesh (one watertight, organic glove with no
# seams to tear), plus a separate tapered sleeve. Colour comes from per-vertex
# painting (back / palm / knuckle shell / cuff) so the whole arm is two draws and
# needs no atlas — a tileable weave normal map supplies the fabric.
#
# READABILITY RULE (the owner's "muddy green blob"): the viewmodel sits on a
# near-black gun in a near-black night scene, so the hands are the one place the
# frame can carry value contrast. Gloves are mid-value coyote with a dark
# knuckle shell and dark palm; the sleeve is a dark olive that is still lighter
# than the gun. Nothing here is camo, nothing is green-on-green.
#
# Canonical hand frame (unchanged from the old pipeline so ARM_POSE keeps its
# meaning): wrist at the origin, fingers +Y, palm faces -Z, thumb at -X for the
# RIGHT hand (mirrored in X for the left).
# =============================================================================
def _srgb_lin(c):
    out = []
    for v in c:
        s = v / 255.0
        out.append(s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4)
    return tuple(out)

GLOVE_COL = {
    "back": _srgb_lin((124, 108, 80)),    # coyote knit back of hand
    "pad":  _srgb_lin((34, 33, 32)),      # knuckle shell, fingertip caps
    "palm": _srgb_lin((58, 52, 46)),      # suede palm
    "cuff": _srgb_lin((30, 30, 31)),      # neoprene wrist cuff
}
SLEEVE_COL = {"cloth": _srgb_lin((72, 77, 60)), "band": _srgb_lin((28, 29, 28))}

# adult male hand, glove thickness included (metres). Right hand, thumb at -X.
HAND_FINGERS = {
    "index":  dict(x=-0.0305, y=0.0905, z=0.0000, L=(0.044, 0.026, 0.021),
                   r=(0.0100, 0.0092, 0.0085), spread=-3.0),
    "middle": dict(x=-0.0105, y=0.0920, z=0.0000, L=(0.048, 0.030, 0.022),
                   r=(0.0102, 0.0094, 0.0087), spread=0.0),
    "ring":   dict(x=0.0095, y=0.0895, z=-0.0010, L=(0.044, 0.028, 0.021),
                   r=(0.0098, 0.0090, 0.0083), spread=3.0),
    "pinky":  dict(x=0.0285, y=0.0835, z=-0.0020, L=(0.035, 0.021, 0.018),
                   r=(0.0089, 0.0081, 0.0075), spread=8.0),
}
HAND_THUMB = dict(base=(-0.0215, 0.0120, -0.0070), L=(0.040, 0.033, 0.027),
                  r=(0.0128, 0.0112, 0.0100, 0.0092),
                  dirs=((-0.50, 0.78, -0.38), (-0.30, 0.86, -0.42), (-0.12, 0.93, -0.35)))
GRIP_CURL = (58.0, 82.0, 42.0)     # fist around a ~35 mm grip, degrees per phalanx


def _frame_z(zdir):
    z = Vector(zdir).normalized()
    ref = Vector((0, 0, 1)) if abs(z.z) < 0.9 else Vector((1, 0, 0))
    x = ref.cross(z).normalized()
    y = z.cross(x).normalized()
    return Matrix(((x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))


def _bm_cone(bm, p, q, r1, r2, seg=14):
    p, q = Vector(p), Vector(q)
    d = q - p
    if d.length < 1e-6:
        return
    M = Matrix.Translation((p + q) * 0.5) @ _frame_z(d)
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r1, radius2=r2, depth=d.length, matrix=M, calc_uvs=False)


def _bm_ball(bm, c, rx, ry=None, rz=None, seg=14):
    ry = rx if ry is None else ry
    rz = rx if rz is None else rz
    M = Matrix.Translation(Vector(c)) @ Matrix.Diagonal((rx, ry, rz, 1.0))
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2),
                              radius=1.0, matrix=M, calc_uvs=False)


def _mat_vcol(name, rough, normal_img=None, nstrength=0.8, metallic=0.0):
    """Material whose base colour is the mesh's vertex colour 'Col' — the glTF
    exporter writes COLOR_0 when a Color Attribute node feeds the shader, and
    three's GLTFLoader turns vertexColors on for it."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    outn = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], outn.inputs["Surface"])
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Emission Strength"].default_value = 0.0
    if normal_img:
        ntex = nt.nodes.new("ShaderNodeTexImage")
        ntex.image = bpy.data.images.load(normal_img, check_existing=True)
        ntex.image.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = nstrength
        nt.links.new(ntex.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    return m


_FABRIC = {}


def fabric_normal_path():
    """Tileable woven-fabric normal map (256 px): a plain-weave over/under
    lattice plus fibre noise. Authored once per build, ~60 KB PNG."""
    if "p" in _FABRIC and os.path.exists(_FABRIC["p"]):
        return _FABRIC["p"]
    S = 256
    ix = np.arange(S)[None, :].astype(np.float64)
    iy = np.arange(S)[:, None].astype(np.float64)
    pitch = 16.0
    u = (ix % pitch) / pitch
    v = (iy % pitch) / pitch
    cu = (np.floor(ix / pitch) + np.floor(iy / pitch)) % 2     # over/under checker
    thread_u = np.sin(math.pi * u) ** 1.4                      # warp thread cross-section
    thread_v = np.sin(math.pi * v) ** 1.4
    h = np.where(cu > 0.5, thread_u, thread_v) * 0.55
    h = h + 0.18 * _n01(_fbm(S, 8101, 3, 20))                  # fibre nap
    h = h + 0.05 * _n01(_fbm(S, 8113, 2, 70))
    nx, ny, nz = _height_to_normal(h, 5.5)
    rgba = np.stack([nx, ny, nz, np.ones_like(nx)], axis=-1)
    _FABRIC["p"] = _save_img("arm_fabric_normal", rgba, fmt="PNG")
    _TEX_STATS["arm_fabric_normal"] = {"kind": "normal", "std": round(float(nx.std()), 4),
                                       "mean": round(float(nx.mean()), 4), "px": S}
    return _FABRIC["p"]


def _hand_rot_curl(deg_list, spread_deg, sx):
    """direction after cumulative curl about X (toward -Z) and spread about Z."""
    out = []
    acc = 0.0
    for dg in deg_list:
        acc += dg
        a = D(acc)
        d = Vector((0.0, math.cos(a), -math.sin(a)))
        d = Matrix.Rotation(D(spread_deg) * sx, 3, "Z") @ d
        out.append(d)
    return out


def build_hand(tag, hand, prm):
    """One arm (glove + sleeve) in the canonical frame. Returns the object
    (2 material slots: 0 glove, 1 sleeve) plus a landmarks dict."""
    sx = -1.0 if hand == "L" else 1.0
    X = lambda v: Vector((v[0] * sx, v[1], v[2]))
    curl = prm.get("curl", GRIP_CURL)
    icurl = prm.get("index_curl", curl)
    fcurl = {"index": icurl, "middle": curl, "ring": prm.get("ring_curl", curl),
             "pinky": prm.get("pinky_curl", tuple(c * 1.05 for c in curl))}
    thumb_dirs = prm.get("thumb", HAND_THUMB["dirs"])
    e = X(Vector(prm.get("elbow", (0.30, -0.88, 0.38)))).normalized()   # wrist -> elbow
    spread_mul = prm.get("spread", 1.0)

    bm = bmesh.new()
    lm = {"wrist": [0.0, 0.0, 0.0]}
    joints = []     # joint ball centres, for painting (vertex colour) + landmarks
    tips = []
    # ---- palm + wrist -----------------------------------------------------
    _bm_ball(bm, X((0.0, 0.050, 0.000)), 0.0430, 0.0480, 0.0165)           # metacarpal slab
    _bm_ball(bm, X((0.0, 0.015, -0.001)), 0.0330, 0.0300, 0.0190)          # wrist block
    _bm_ball(bm, X((-0.0255, 0.036, -0.0110)), 0.0200, 0.0300, 0.0135)     # thenar
    _bm_ball(bm, X((0.0310, 0.040, -0.0075)), 0.0140, 0.0290, 0.0110)      # hypothenar
    _bm_ball(bm, X((-0.0300, 0.066, -0.0040)), 0.0170, 0.0150, 0.0120)     # thumb web
    # knuckle shell: one flat hard guard over the four MCP joints, back side
    _bm_ball(bm, X((-0.0010, 0.0880, 0.0100)), 0.0420, 0.0125, 0.0070)
    # ---- fingers ----------------------------------------------------------
    for nm, f in HAND_FINGERS.items():
        degs = fcurl[nm]
        dirs = _hand_rot_curl(degs, f["spread"] * spread_mul, sx)
        p = X((f["x"], f["y"], f["z"]))
        joints.append(p.copy())
        _bm_ball(bm, p, f["r"][0] * 1.04)
        for i in range(3):
            d = dirs[i]
            q = p + d * f["L"][i]
            _bm_cone(bm, p, q, f["r"][i], f["r"][min(i + 1, 2)] * (0.96 if i == 2 else 1.0))
            _bm_ball(bm, q, f["r"][min(i + 1, 2)] * (0.98 if i == 2 else 1.03))
            if i < 2:
                joints.append(q.copy())
            else:
                tips.append(q.copy())
                lm[nm + "_tip"] = [round(c, 4) for c in q]
            p = q
        # knuckle bump on the back of the MCP
        _bm_ball(bm, X((f["x"], f["y"] + 0.001, f["z"] + 0.0080)), 0.0085, 0.0085, 0.0055)
    # ---- thumb ------------------------------------------------------------
    p = X(HAND_THUMB["base"])
    _bm_ball(bm, p, HAND_THUMB["r"][0] * 1.05)
    for i in range(3):
        d = X(Vector(thumb_dirs[i])).normalized()
        q = p + d * HAND_THUMB["L"][i]
        _bm_cone(bm, p, q, HAND_THUMB["r"][i], HAND_THUMB["r"][i + 1])
        _bm_ball(bm, q, HAND_THUMB["r"][i + 1] * 1.03)
        if i < 2:
            joints.append(q.copy())
        p = q
    tips.append(p.copy())
    lm["thumb_tip"] = [round(c, 4) for c in p]
    # ---- wrist cuff (glove gauntlet, along the forearm axis) --------------
    _bm_cone(bm, e * -0.004, e * 0.060, 0.0335, 0.0372, seg=20)
    _bm_cone(bm, e * 0.044, e * 0.052, 0.0405, 0.0405, seg=20)       # velcro strap, proud
    lm["palm"] = [round(c, 4) for c in X((0.0, 0.050, -0.012))]

    me_g = bpy.data.meshes.new(f"hand_{tag}")
    bm.to_mesh(me_g)
    bm.free()
    og = bpy.data.objects.new(f"hand_{tag}", me_g)
    link(og)
    # --- voxel union, smooth, decimate -------------------------------------
    for o2 in bpy.context.selected_objects:
        o2.select_set(False)
    bpy.context.view_layer.objects.active = og
    og.select_set(True)
    rm = og.modifiers.new("rm", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = prm.get("voxel", 0.0024)
    rm.adaptivity = 0.0
    rm.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=rm.name)
    sm = og.modifiers.new("sm", "SMOOTH")
    sm.factor = 0.55
    sm.iterations = 5
    bpy.ops.object.modifier_apply(modifier=sm.name)
    dc = og.modifiers.new("dc", "DECIMATE")
    dc.ratio = prm.get("decimate", 0.42)
    bpy.ops.object.modifier_apply(modifier=dc.name)

    # --- sleeve (separate, tapered along the elbow axis) --------------------
    bs = bmesh.new()
    r0, r1, L = 0.0425, prm.get("sleeve_r", 0.052), prm.get("sleeve_len", 0.24)
    _bm_cone(bs, e * 0.034, e * L, r0, r1, seg=28)
    _bm_cone(bs, e * 0.030, e * 0.058, 0.0452, 0.0452, seg=28)       # elastic cuff band
    me_s = bpy.data.meshes.new(f"sleeve_{tag}")
    bs.to_mesh(me_s)
    bs.free()
    osl = bpy.data.objects.new(f"sleeve_{tag}", me_s)
    link(osl)

    # --- vertex colours ------------------------------------------------------
    def _vcol(o, painter):
        me = o.data
        n = len(me.vertices)
        co = np.empty(n * 3, np.float64); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
        no = np.empty(n * 3, np.float64); me.vertex_normals.foreach_get("vector", no); no = no.reshape(-1, 3)
        col = painter(co, no)
        if "Col" in me.color_attributes:
            me.color_attributes.remove(me.color_attributes["Col"])
        ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
        rgba = np.concatenate([col, np.ones((n, 1))], axis=1).astype(np.float32)
        ca.data.foreach_set("color", rgba.ravel())

    J = np.array([tuple(j) for j in joints], np.float64)
    T = np.array([tuple(t) for t in tips], np.float64)
    ea = np.array(tuple(e), np.float64)

    def _noise(co, k):
        return (np.sin(co[:, 0] * 190 + k) * np.sin(co[:, 1] * 230 - k * 0.7)
                * np.sin(co[:, 2] * 210 + k * 1.3))

    def paint_glove(co, no):
        ax = co @ ea                                   # distance along the forearm axis
        dj = np.sqrt(((co[:, None, :] - J[None]) ** 2).sum(2)).min(1)
        dt = np.sqrt(((co[:, None, :] - T[None]) ** 2).sum(2)).min(1)
        back = np.clip(no[:, 2] * 2.0 + 0.15, 0, 1)
        palm = np.clip(-no[:, 2] * 2.0 + 0.15, 0, 1)
        knuckle = _sstep(0.016, 0.006, dj) * back          # shell over every back-side joint
        # the MCP row is a continuous guard, not four dots
        guard = _sstep(0.064, 0.080, co[:, 1]) * _sstep(0.118, 0.100, co[:, 1]) * back * \
            (np.abs(co[:, 0]) < 0.047)
        tipcap = _sstep(0.014, 0.006, dt)
        cuffm = _sstep(0.020, 0.034, ax)
        c_back = np.array(GLOVE_COL["back"])[None]
        c_pad = np.array(GLOVE_COL["pad"])[None]
        c_palm = np.array(GLOVE_COL["palm"])[None]
        c_cuff = np.array(GLOVE_COL["cuff"])[None]
        base = c_back * (1 - palm[:, None]) + c_palm * palm[:, None]
        shell = np.clip(np.maximum(np.maximum(knuckle, guard * 0.92), tipcap * 0.9), 0, 1)[:, None]
        col = base * (1 - shell) + c_pad * shell
        col = col * (1 - cuffm[:, None]) + c_cuff * cuffm[:, None]
        col *= (1.0 + 0.10 * _noise(co, 1.0))[:, None]
        return np.clip(col, 0, 1)

    def paint_sleeve(co, no):
        ax = co @ ea
        band = _sstep(0.026, 0.032, ax) * _sstep(0.064, 0.058, ax)
        c_cl = np.array(SLEEVE_COL["cloth"])[None]
        c_bd = np.array(SLEEVE_COL["band"])[None]
        col = c_cl * (1 - band[:, None]) + c_bd * band[:, None]
        # soft longitudinal fabric streaks + slow tonal drift
        col *= (1.0 + 0.08 * _noise(co, 3.0) + 0.05 * np.sin(ax * 40.0))[:, None]
        return np.clip(col, 0, 1)

    _vcol(og, paint_glove)
    _vcol(osl, paint_sleeve)

    # --- join into one mesh: slot 0 glove, slot 1 sleeve ---------------------
    og.data.materials.clear()
    og.data.materials.append(bpy.data.materials["br_glove"])
    osl.data.materials.clear()
    osl.data.materials.append(bpy.data.materials["br_sleeve"])
    for o2 in bpy.context.selected_objects:
        o2.select_set(False)
    og.select_set(True)
    osl.select_set(True)
    bpy.context.view_layer.objects.active = og
    bpy.ops.object.join()
    arm = bpy.context.view_layer.objects.active
    arm.name = f"arm_{tag}"
    shade_smooth(arm, 60)
    # cube-project UVs for the tileable weave (0.07 m per tile)
    try:
        bpy.context.view_layer.objects.active = arm
        for o2 in bpy.context.selected_objects:
            o2.select_set(False)
        arm.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.cube_project(cube_size=0.07)
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception as ex:
        print("A4ARM unwrap failed", tag, ex)
    arm["a4_lm"] = json.dumps(lm)
    print("A4ARM %s: %d tris (glove+sleeve)" % (tag, sum(len(p.vertices) - 2 for p in arm.data.polygons)))
    return arm


def _ensure_arm_materials():
    nrm = fabric_normal_path()
    _mat_vcol("br_glove", 0.80, nrm, nstrength=0.9)
    _mat_vcol("br_sleeve", 0.92, nrm, nstrength=0.7)


def place_arms(wid, mats, pose_override=None):
    """Build + place the arms for one weapon. Each pose entry is
    (hand, wrist_pos, fingers_dir, palm_dir[, params]) — same placement basis as
    the old rig-cut (an explicit basis from the two direction vectors), plus an
    optional params dict (curl / thumb / elbow / index_curl ...) because a
    procedural hand can actually be re-posed per weapon."""
    _ensure_arm_materials()
    placed = []
    for ent in (pose_override or ARM_POSE.get(wid, [])):
        hand, loc, fingers, palm = ent[0], ent[1], ent[2], ent[3]
        prm = ent[4] if len(ent) > 4 else {}
        dup = build_hand(f"{hand}_{wid}", hand, prm)
        dup.name = f"arms_{hand}_{wid}"
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
            lm = json.loads(dup.get("a4_lm", "{}"))
            out = {k: [round(c, 4) for c in (M @ Vector(v))] for k, v in lm.items()}
            print("A4HAND %s %s %s" % (wid, hand, json.dumps(out)))
        except Exception:
            pass
        placed.append(dup)
    return placed


