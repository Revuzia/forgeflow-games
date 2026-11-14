# tools/a5_build_guns.py — BLACKRIDGE first-person weapons, HARD-SURFACE generator.
#
# 2026-10-13, owner: "looks like the weapons need a serious fix as well, they are
# poorly done". Root cause, seen in every preview: the a4 guns are Meshy AI scans —
# lumpy, melted surfaces ("wrapped in cling film"), rails that wobble, an 8-sided
# barrel smoothed into a sausage, and texture striations that follow the scan's
# atlas instead of the part. No amount of texture work fixes a blobby silhouette.
#
# This generator AUTHORS each gun from clean hard-surface parts instead — extruded
# side profiles, true cylinders and octagons, pocketed M-LOK slots, rail teeth, real
# sight towers, a proper riflescope — every part bevelled (two segments, so edges
# catch light like machined/molded parts do) and painted per vertex: base colour per
# part, edge wear on convex edges, cavity darkening in recesses. One shared micro-
# normal map (bead-blast for metal, stipple for polymer) adds surface at close range.
#
# The output keeps the a4 GLB contract that core/weapons/weapon_meshes.js reads:
#   build frame +Y muzzle / +Z up / +X right, origin at the pistol grip (exported Y-up,
#   barrel down -Z); nodes base, dressing, mag, pump, arms_R_<id>, arms_L_<id>;
#   empties SOCKET_muzzle / SOCKET_eject / SOCKET_sight (sight line height).
# Arms come from the a4 generator (real rigged hands, place_arms) — this file execs
# a4 for its helpers exactly like tools/_a4_dev/hand_preview.py does.
#
# usage: blender -b --factory-startup -noaudio --python tools/a5_build_guns.py -- [ids...]
import sys, os, math, json

HERE = os.path.dirname(os.path.abspath(__file__))
A4 = os.path.join(HERE, "a4_build_fp_weapons.py")
_code = open(A4, encoding="utf-8").read().split("ids = ONLY or list(CFG.keys())")[0]
_ARGV = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
sys.argv = [sys.argv[0], "--"]
_g = {"__file__": A4, "__name__": "a4build"}
exec(compile(_code, A4, "exec"), _g)
bpy = _g["bpy"]; bmesh = _g["bmesh"]; np = _g["np"]
Vector = _g["Vector"]; Matrix = _g["Matrix"]; D = math.radians
link = _g["link"]; shade_smooth = _g["shade_smooth"]; _bm_cone = _g["_bm_cone"]
GAME = _g["GAME"]; OUT_DIR = _g["OUT_DIR"]; PREV_DIR = _g["PREV_DIR"]

ONLY = [a for a in _ARGV if not a.startswith("--")]
NO_PREVIEW = "--no-preview" in _ARGV


def lin(c):
    """sRGB 0-255 triple -> linear floats (vertex colours are linear)."""
    def f(x):
        x = x / 255.0
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


# palette (linear). Dark on purpose: weapon_meshes.repair() and the night light pool
# lift everything; these land as black anodize / FDE polymer in game.
COL = {
    # (in-game judgment 2026-10-14: the first palette rendered blue-grey / cream under the
    # night pool — every value here is roughly 0.7x the daylight-correct swatch)
    "anod":   lin((27, 28, 30)),      # black hard-anodized aluminium
    "steel":  lin((36, 36, 35)),      # parkerized / nitrided steel (barrel, pins)
    "poly":   lin((24, 24, 25)),      # black polymer
    # (2026-11-13 hip/ADS pass) FDE was (88,74,55)/(80,68,52): linear 0.098 vs anodize 0.011,
    # ~9x the receiver, so tan mags/stocks read as glowing slabs beside near-black metal at
    # night. Halved and desaturated into the same exposure family (still clearly tan).
    "fde":    lin((63, 56, 45)),      # flat dark earth polymer / cerakote
    "fdem":   lin((58, 52, 43)),      # FDE on metal (cerakote) — slightly cooler
    "odg":    lin((46, 50, 38)),      # olive drab polymer
    "rubber": lin((24, 24, 24)),
    "slot":   lin((14, 14, 15)),      # inside of slots / bores
    "brass":  lin((150, 112, 52)),
    "optic":  lin((30, 31, 33)),
}
WEAR = {"metal": lin((120, 122, 124)), "poly": None}


# ---------------------------------------------------------------------------
# geometry primitives (into a bmesh, build frame)
# ---------------------------------------------------------------------------
def prism_x(bm, pts, x0, x1):
    """Extrude a side profile [(y, z), ...] across X from x0 to x1."""
    a = [bm.verts.new((x0, y, z)) for y, z in pts]
    b = [bm.verts.new((x1, y, z)) for y, z in pts]
    n = len(pts)
    fs = [bm.faces.new(a), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    return fs


def prism_y(bm, pts, y0, y1):
    """Extrude a cross-section [(x, z), ...] along Y from y0 to y1."""
    a = [bm.verts.new((x, y0, z)) for x, z in pts]
    b = [bm.verts.new((x, y1, z)) for x, z in pts]
    n = len(pts)
    fs = [bm.faces.new(a), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    return fs


def rbox(bm, x0, x1, y0, y1, z0, z1):
    return prism_x(bm, [(y0, z0), (y1, z0), (y1, z1), (y0, z1)], x0, x1)


def ngon_y(bm, x, z, y0, y1, r, n=8, phase=None, r1=None, flat_top=True):
    """Regular n-gon tube along Y (capped). flat_top puts a flat face on top."""
    if phase is None:
        phase = (math.pi / n) if flat_top else 0.0
    r1 = r if r1 is None else r1
    ring = lambda yy, rr: [bm.verts.new((x + rr * math.sin(phase + 2 * math.pi * i / n), yy,
                                         z + rr * math.cos(phase + 2 * math.pi * i / n))) for i in range(n)]
    a, b = ring(y0, r), ring(y1, r1)
    fs = [bm.faces.new(a), bm.faces.new(b)]
    for i in range(n):
        j = (i + 1) % n
        fs.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    return fs


def cyl_y(bm, x, z, y0, y1, r, r1=None, seg=28):
    _bm_cone(bm, (x, y0, z), (x, y1, z), r, r if r1 is None else r1, seg=seg)


def cyl_x(bm, y, z, x0, x1, r, seg=20):
    _bm_cone(bm, (x0, y, z), (x1, y, z), r, r, seg=seg)


def cyl_z(bm, x, y, z0, z1, r, r1=None, seg=20):
    _bm_cone(bm, (x, y, z0), (x, y, z1), r, r if r1 is None else r1, seg=seg)


def tube_ring_y(bm, x, z, y0, y1, r_in, r_out, seg=32):
    """Hollow ring (annular tube) along Y — scope bells, aperture rings."""
    def ring(yy, rr):
        return [bm.verts.new((x + rr * math.cos(2 * math.pi * i / seg), yy,
                              z + rr * math.sin(2 * math.pi * i / seg))) for i in range(seg)]
    oa, ob, ia, ib = ring(y0, r_out), ring(y1, r_out), ring(y0, r_in), ring(y1, r_in)
    for i in range(seg):
        j = (i + 1) % seg
        bm.faces.new((oa[i], oa[j], ob[j], ob[i]))
        bm.faces.new((ib[i], ib[j], ia[j], ia[i]))
        bm.faces.new((ia[i], ia[j], oa[j], oa[i]))
        bm.faces.new((ob[i], ob[j], ib[j], ib[i]))


# ---------------------------------------------------------------------------
# parts: object per part -> bevel -> paint -> grouped by node
# ---------------------------------------------------------------------------
PARTS = []          # (obj, node_name)
CUTTERS = {}        # target part name -> list of cutter bmesh builders


def part(name, build, col, mat="metal", node="base", bevel=0.0010, seg=2, angle=32.0,
         cut=None, wear=1.0):
    """build(bm) fills a bmesh. cut: optional build(bm) of boolean cutters (pockets)."""
    bm = bmesh.new()
    build(bm)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    link(o)
    if cut is not None:
        cb = bmesh.new()
        cut(cb)
        bmesh.ops.recalc_face_normals(cb, faces=cb.faces)
        cme = bpy.data.meshes.new(name + "_cut")
        cb.to_mesh(cme)
        cb.free()
        co = bpy.data.objects.new(name + "_cut", cme)
        link(co)
        bo = o.modifiers.new("cut", "BOOLEAN")
        bo.operation = "DIFFERENCE"
        bo.solver = "EXACT"
        bo.object = co
        try:
            bo.use_self = True             # cutters overlap each other
            bo.use_hole_tolerant = True
        except Exception:
            pass
        co.hide_render = True
        nv = len(o.data.vertices)
        _apply(o)
        if len(o.data.vertices) < nv * 0.5:
            print("A5WARN boolean ate %s (%d -> %d verts) — keeping it uncut" % (name, nv, len(o.data.vertices)))
            o.data = me
        bpy.data.objects.remove(co, do_unlink=True)
    if bevel > 0:
        bv = o.modifiers.new("bv", "BEVEL")
        bv.width = bevel
        bv.segments = seg
        bv.limit_method = "ANGLE"
        bv.angle_limit = D(angle)
        bv.profile = 0.6
        try:
            bv.harden_normals = False
            bv.miter_outer = "MITER_ARC"
        except Exception:
            pass
        _apply(o)
    o["a5_col"] = list(col)
    o["a5_mat"] = mat
    o["a5_wear"] = wear
    PARTS.append((o, node))
    return o


def _apply(o):
    bpy.context.view_layer.objects.active = o
    for so in bpy.context.selected_objects:
        so.select_set(False)
    o.select_set(True)
    for m in list(o.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as ex:
            print("A5 modifier failed", o.name, m.name, ex)
            o.modifiers.remove(m)


def paint(o):
    """Per-vertex colour: part colour, darkened in cavities, worn on convex edges."""
    col = np.array(o["a5_col"], np.float64)
    kind = o["a5_mat"]
    wear_k = float(o.get("a5_wear", 1.0))
    me = o.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    bm.verts.ensure_lookup_table()
    n = len(bm.verts)
    if n == 0:
        bm.free()
        print("A5WARN empty part", o.name)
        return
    conv = np.zeros(n)
    for v in bm.verts:
        s = k = 0.0
        for e in v.link_edges:
            d = v.co - e.other_vert(v).co
            L = d.length
            if L < 1e-7:
                continue
            s += v.normal.dot(d) / L
            k += 1
        conv[v.index] = s / max(1.0, k)
    co = np.array([tuple(v.co) for v in bm.verts])
    bm.free()
    edge = np.clip((conv - 0.06) / 0.30, 0, 1)
    cav = np.clip((-conv - 0.06) / 0.30, 0, 1)
    # cheap position noise so long edges don't wear uniformly
    nz = (np.sin(co[:, 0] * 310 + co[:, 1] * 170) * np.sin(co[:, 1] * 420 - co[:, 2] * 260) * 0.5 + 0.5)
    edge = edge * (0.55 + 0.45 * nz) * wear_k
    c = np.tile(col, (n, 1))
    c *= (1.0 - 0.30 * cav)[:, None]
    if kind == "metal":
        w = np.array(WEAR["metal"])
        # (2026-11-13) was 0.55: almost every vertex of a low-poly bevelled part is ON an
        # edge, so the blend repainted whole faces (in game: metal mean 0.055 vs base 0.011)
        c = c * (1 - 0.10 * edge[:, None]) + w * (0.10 * edge[:, None])
    elif kind in ("poly", "grip", "rubber", "optic"):
        c = c * (1.0 + 0.18 * edge)[:, None]
    if kind == "mark":
        # paint fill wears out of the engraving unevenly
        c = c * (0.80 + 0.30 * nz)[:, None]
    if kind not in ("dot", "glass", "lume"):
        c = c / DETAIL_N            # the albedo detail map (mean DETAIL_N) multiplies this back
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    rgba = np.concatenate([np.clip(c, 0, 1), np.ones((n, 1))], axis=1).astype(np.float32)
    ca.data.foreach_set("color", rgba.ravel())


# ---------------------------------------------------------------------------
# materials: vertex-colour albedo x tileable DETAIL maps + micro normal
# ---------------------------------------------------------------------------
# (2026-11-13, CoD look pass) The vertex colour carries the part colour, cavity and edge
# wear; three tileable maps carry what a vertex can't: grime, fine scratches, handling
# polish (albedo detail, MULTIPLIES COLOR_0), smudges / scuffs / scratch lines smoother
# than the bead-blast (roughness), and scratch grooves + dings on top of the grain
# (normal). glTF multiplies baseColorTexture x COLOR_0 x factor, so the detail map is
# authored around a linear mean of DETAIL_N and paint() divides every vertex colour by
# DETAIL_N: the product lands on the same palette the night-pool judgment was made on.
_TEX = {}
DETAIL_N = 0.40          # linear mean of the albedo detail map (vertex colours are / this);
                         # 0.40 leaves 2.5x headroom for a scratch to read as bare metal
ROUGH_N = 0.75           # mean of the roughness channel (material factors are / this)
METAL_N = 0.60           # base of the metalness channel (scratches -> 1.0 bare metal)
DETAIL_SCALE = 0.25      # UV x scale for albedo/ORM: cube UVs tile every 5 cm -> maps every 20 cm
NORMAL_SCALE = 0.50      # metal micro normal tiles every 10 cm (grain density as before)


def _tnoise(S, cx, cy, seed):
    """Periodic (truly tileable) value noise, cx x cy cells over S px."""
    rng = np.random.default_rng(seed)
    g = rng.random((cy, cx))

    def axis(c):
        t = (np.arange(S) + 0.5) * c / S
        i0 = np.floor(t).astype(int)
        f = t - i0
        return i0 % c, (i0 + 1) % c, f * f * (3 - 2 * f)
    x0, x1, fx = axis(cx)
    y0, y1, fy = axis(cy)
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    fx = fx[None, :]; fy = fy[:, None]
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy


def _tfbm(S, seed, octaves, cells, aspect=1.0):
    out = np.zeros((S, S)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        out += _tnoise(S, max(1, int(round(c * aspect))), max(1, int(round(c / aspect))), seed + 31 * o) * amp
        tot += amp
        amp *= 0.55
    return out / tot


def _srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def _soft_lines(img, r=1):
    """1-px scratch strokes -> a core plus a soft shoulder (mip-stable, not aliased)."""
    return np.maximum(img, 0.55 * _g["_boxblur"](img, r))


def detail_maps():
    """(albedo_path, orm_path) — 512 px, tileable, shared by every gun material."""
    if "detail" in _TEX:
        return _TEX["detail"]
    S = 512
    n01, scr = _g["_n01"], _g["_scratches"]
    ss = _g["_ss"]
    grime = n01(_tfbm(S, 7101, 4, 4))                         # big soft soil / oil patches
    mott = n01(_tfbm(S, 7111, 3, 12))                         # mid mottling
    speck = n01(_tfbm(S, 7121, 2, 96))                        # dust speckle field
    polish = n01(_tfbm(S, 7131, 3, 4, aspect=2.2))            # handling polish (stretched)
    # fine scratches: mostly along the long axis (U) like holster / sling / mag-change wear
    s_long = _soft_lines(scr(S, 7141, 170, 0.03, 0.16, width=1, bias_deg=0, spread_deg=14))
    s_rand = _soft_lines(scr(S, 7151, 70, 0.01, 0.06, width=1))
    s_deep = _soft_lines(scr(S, 7161, 10, 0.06, 0.20, width=2, bias_deg=8, spread_deg=30), r=2)
    scratch = np.clip(np.maximum(np.maximum(s_long * 0.75, s_rand * 0.85), s_deep), 0, 1)
    pits = _g["_pits"](S, 7171, 26, 1, 3)
    # smudges: soft oval fingerprints / oil wipes
    smudge = ss(0.62, 0.80, n01(_tfbm(S, 7181, 3, 7))) * ss(0.35, 0.65, mott)

    dust = ss(0.78, 0.95, speck) * ss(0.45, 0.75, grime)
    a = np.ones((S, S))
    a *= 1.0 - 0.22 * ss(0.50, 0.92, grime)                   # grime darkens
    a *= 0.92 + 0.16 * mott                                   # mottled finish
    a *= 1.0 + 0.16 * ss(0.55, 0.90, polish)                  # handled = burnished, paler
    a += 0.28 * dust                                          # pale dust specks (0.55 read as blotches)
    a *= 1.0 - 0.18 * smudge
    a = a + (2.30 - a) * (0.85 * scratch)                     # bright bare-metal lines
    a *= 1.0 - 0.35 * pits
    a *= DETAIL_N / float(a.mean())                            # exact neutral (see paint())
    a = np.clip(a, 0.0, 1.0)
    rgb = _srgb(a)
    alb = np.stack([rgb, rgb, rgb * 0.985, np.ones_like(rgb)], axis=-1)   # whisper-warm grime
    _TEX["albedo_mean"] = float(a.mean())

    r = np.full((S, S), 0.80)
    r += 0.10 * (mott - 0.5)
    r += 0.14 * dust + 0.10 * ss(0.55, 0.95, grime)           # dust / grime: rougher
    r -= 0.24 * smudge                                        # skin oil: smoother
    r -= 0.12 * ss(0.55, 0.90, polish)
    r = r + (0.42 - r) * scratch                              # scratch lines smoother than bead-blast
    r += 0.12 * pits
    r *= ROUGH_N / float(r.mean())
    r = np.clip(r, 0.30, 1.0)
    # scratches go DOWN in metalness: with an anodize-dark base colour a metallic scratch is a
    # darker mirror (F0 = albedo ~0.02); as a 4 % dielectric with a tight lobe it reads bright
    m = np.clip(METAL_N - 0.42 * scratch - 0.25 * dust, 0.0, 1.0)
    orm = np.stack([np.ones_like(r), r, m, np.ones_like(r)], axis=-1)
    _TEX["orm_stats"] = (float(r.mean()), float(r.min()), float(r.max()), float(m.mean()))
    _TEX["detail"] = (_g["_save_img"]("a5_detail_albedo", alb, fmt="PNG"),
                      _g["_save_img"]("a5_detail_orm", orm, fmt="PNG"))
    print("A5TEX albedo mean %.3f std %.3f | rough mean %.3f [%.2f..%.2f] metal mean %.3f" % (
        _TEX["albedo_mean"], float(a.std()), *_TEX["orm_stats"]))
    return _TEX["detail"]


def micro_normal(kind):
    if kind in _TEX:
        return _TEX[kind]
    if kind == "metal":
        # bead-blast grain + machining streaks (the old 256 px map, now 512 px over 10 cm so
        # the grain density is unchanged) + scratch GROOVES and handling dings
        S = 512
        h = 0.55 * _g["_n01"](_tfbm(S, 5101, 3, 96)) + 0.25 * _g["_n01"](_tfbm(S, 5111, 2, 90, aspect=6.0))
        sl = _g["_scratches"](S, 5121, 140, 0.03, 0.18, width=1, bias_deg=0, spread_deg=18)
        sr = _g["_scratches"](S, 5131, 50, 0.01, 0.07, width=1)
        h -= 0.38 * np.maximum(sl * 0.8, sr)                  # fine grooves (the first pass at 1.6
        h -= 0.55 * _g["_pits"](S, 5141, 18, 1, 3)           # read as creased paper)
        k = 1.4
    else:                   # polymer stipple: cellular bumps
        S = 256
        h = _g["_n01"](_g["_fbm"](S, 5203, 2, 64)) ** 2.0 + 0.3 * _g["_n01"](_g["_fbm"](S, 5209, 2, 128))
        k = 1.6
    nx, ny, nz = _g["_height_to_normal"](h, k)
    rgba = np.stack([nx, ny, nz, np.ones_like(nx)], axis=-1)
    _TEX[kind] = _g["_save_img"]("a5_%s_normal" % kind, rgba, fmt="PNG")
    return _TEX[kind]


def _mat_detail(name, rough, metallic, normal_img, nstrength, nscale=1.0):
    """vertex colour x albedo detail -> Base Color; ORM G x factor -> Roughness,
    B x factor -> Metallic; micro normal. Factors are chosen so factor x channel mean
    reproduces the old flat values (rough 0.40 metal etc.). glTF caps factors at 1."""
    alb_p, orm_p = detail_maps()
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links.new
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    L(bsdf.outputs["BSDF"], out.inputs["Surface"])
    uv = nt.nodes.new("ShaderNodeUVMap")

    def img(path, cs, scale):
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.vector_type = "POINT"
        mp.inputs["Scale"].default_value = (scale, scale, 1.0)
        L(uv.outputs["UV"], mp.inputs["Vector"])
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(path, check_existing=True)
        t.image.colorspace_settings.name = cs
        L(mp.outputs["Vector"], t.inputs["Vector"])
        return t
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    ta = img(alb_p, "sRGB", DETAIL_SCALE)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    sock = lambda coll, ident: next(x for x in coll if x.identifier == ident)
    L(vc.outputs["Color"], sock(mix.inputs, "A_Color"))
    L(ta.outputs["Color"], sock(mix.inputs, "B_Color"))
    L(sock(mix.outputs, "Result_Color"), bsdf.inputs["Base Color"])
    to = img(orm_p, "Non-Color", DETAIL_SCALE)
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    L(to.outputs["Color"], sep.inputs["Color"])
    rf = min(1.0, rough / ROUGH_N)
    mf = min(1.0, metallic / METAL_N) if metallic > 0 else 0.0
    mr = nt.nodes.new("ShaderNodeMath"); mr.operation = "MULTIPLY"; mr.inputs[1].default_value = rf
    L(sep.outputs[1], mr.inputs[0]); L(mr.outputs[0], bsdf.inputs["Roughness"])
    mm = nt.nodes.new("ShaderNodeMath"); mm.operation = "MULTIPLY"; mm.inputs[1].default_value = mf
    L(sep.outputs[2], mm.inputs[0]); L(mm.outputs[0], bsdf.inputs["Metallic"])
    tn = img(normal_img, "Non-Color", nscale)
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = nstrength
    L(tn.outputs["Color"], nm.inputs["Color"])
    L(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Emission Strength"].default_value = 0.0
    m["a5_factors"] = {"roughness": rf, "metallic": mf, "nscale": nscale}
    return m


def materials():
    M = {}
    # names: weapon_meshes.repair() keys the colour factor on /metal|optic/ (0.85) vs 0.70
    # (judged on the studio renders: the first pass's 0.35 / 0.30 read as hammered metal and cork)
    mn, pn = micro_normal("metal"), micro_normal("poly")
    M["metal"] = _mat_detail("br5_metal", 0.40, 0.60, mn, 0.14, NORMAL_SCALE)
    M["poly"] = _mat_detail("br5_polymer", 0.62, 0.0, mn, 0.10, NORMAL_SCALE)
    M["grip"] = _mat_detail("br5_polymer_grip", 0.74, 0.0, pn, 0.40)
    M["rubber"] = _mat_detail("br5_rubber", 0.86, 0.0, pn, 0.8)
    M["optic"] = _mat_detail("br5_optic", 0.38, 0.55, mn, 0.20, NORMAL_SCALE)
    # paint-filled engraving: dielectric, a touch rougher than the polymer
    M["mark"] = _mat_detail("br5_mark_polymer", 0.70, 0.0, mn, 0.05, NORMAL_SCALE)
    lu = bpy.data.materials.get("br5_lume") or bpy.data.materials.new("br5_lume")
    lu.use_nodes = True
    lb = next(n for n in lu.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    lb.inputs["Base Color"].default_value = (0.62, 0.78, 0.58, 1)
    lb.inputs["Emission Color"].default_value = (0.62, 0.78, 0.58, 1)
    lb.inputs["Emission Strength"].default_value = 1.5
    M["lume"] = lu          # weapon_meshes.repair(): /_lume$/ -> unlit pale sight dot
    d = bpy.data.materials.get("br5_dot") or bpy.data.materials.new("br5_dot")
    d.use_nodes = True
    db = next(n for n in d.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    db.inputs["Base Color"].default_value = (1.0, 0.05, 0.03, 1)
    db.inputs["Emission Color"].default_value = (1.0, 0.05, 0.03, 1)
    db.inputs["Emission Strength"].default_value = 6.0
    M["dot"] = d            # weapon_meshes.repair() swaps it for an unlit, un-tonemapped red
    g = bpy.data.materials.get("br5_glass") or bpy.data.materials.new("br5_glass")
    g.use_nodes = True
    b = next(n for n in g.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.02, 0.05, 0.06, 1)
    b.inputs["Roughness"].default_value = 0.05
    M["glass"] = g
    return M


# ---------------------------------------------------------------------------
# roll marks (2026-11-13): paint-filled engraving on the LEFT side — the side the
# player sees. Real glyph geometry (Blender's built-in font, flat fill), floating
# 0.15 mm proud of the face so it never z-fights at 25 cm. Fiction only: ZAROV ARMS.
# ---------------------------------------------------------------------------
MARK_COL = lin((112, 112, 108))        # pale grey paint fill (night pool lifts it ~1.4x)


def _glyphs(text, size, align="CENTER", spacing=1.08):
    """Flat text mesh in the font plane: [(x, y)] verts + faces, baseline at y=0."""
    cu = bpy.data.curves.new("a5txt", "FONT")
    cu.body = text
    cu.size = size
    cu.resolution_u = 3
    cu.extrude = 0.0
    cu.space_character = spacing
    cu.align_x = align
    ob = bpy.data.objects.new("a5txt", cu)
    link(ob)
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    verts = [(v.co.x, v.co.y) for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    bpy.data.meshes.remove(me)
    return verts, faces


def roll_mark(name, lines, x_face, y_center, node="base", col=None):
    """lines: [(text, cap_size_m, z_baseline)], all centred on y_center, on the -X face
    at x_face. Reading direction is -Y (muzzle on the viewer's left, as on a real gun)."""
    def b(bm):
        for text, size, zb in lines:
            vs, fs = _glyphs(text, size)
            bv = [bm.verts.new((x_face - 0.00015, y_center - x, zb + y)) for x, y in vs]
            for f in fs:
                try:
                    bm.faces.new([bv[i] for i in f])
                except ValueError:
                    pass
    part(name, b, col or MARK_COL, "mark", node, bevel=0, wear=0.0)


def selector_marks(name, y, z, x_face, labels, r=0.0118, size=0.0021, node="base", zmax=1.0):
    """Fire-selector legend around a selector axis at (y, z): first label forward
    (SAFE, lever pointing at the muzzle), then up, then rearward — like an AR lower.
    zmax: top of the face the legend is cut into (the up label stays below it)."""
    zu = min(z + r * 0.62, zmax - size - 0.0007)
    pos = [(y + r, z - size * 0.5), (y, zu), (y - r, z - size * 0.5)]
    up_dot = min(0.0068, zu - z - 0.0010)
    lines = []
    for (yy, zz), lab in zip(pos, labels):
        lines.append((lab, size, zz, yy))

    def b(bm):
        for text, sz, zb, yy in lines:
            vs, fs = _glyphs(text, sz)
            bv = [bm.verts.new((x_face - 0.00015, yy - x, zb + yv)) for x, yv in vs]
            for f in fs:
                try:
                    bm.faces.new([bv[i] for i in f])
                except ValueError:
                    pass
        # index dot between the selector and each legend
        for dy, dz in ((0.0068, 0), (0, up_dot), (-0.0068, 0))[:len(labels)]:
            cyl_x(bm, y + dy, z + dz, x_face - 0.00016, x_face + 0.0002, 0.00045, seg=8)
    part(name, b, MARK_COL, "mark", node, bevel=0, wear=0.0)


# ---------------------------------------------------------------------------
# shared sub-assemblies
# ---------------------------------------------------------------------------
def pic_rail(name, y0, y1, z_base, half_w=0.0105, node="base", col=None):
    """MIL-STD-1913 rail: a base bar plus crossbars every 10 mm."""
    zt = z_base + 0.0055

    def b(bm):
        prism_y(bm, [(-half_w * 0.80, z_base), (half_w * 0.80, z_base), (half_w, z_base + 0.0030),
                     (half_w * 0.62, z_base + 0.0042), (-half_w * 0.62, z_base + 0.0042),
                     (-half_w, z_base + 0.0030)], y0, y1)
        y = y0 + 0.003
        while y + 0.0052 < y1:
            prism_y(bm, [(-half_w, z_base + 0.0026), (half_w, z_base + 0.0026), (half_w, zt - 0.0008),
                         (half_w - 0.0008, zt), (-half_w + 0.0008, zt), (-half_w, zt - 0.0008)], y, y + 0.0052)
            y += 0.0100
    part(name, b, col or COL["anod"], "metal", node, bevel=0.0004, seg=1)
    return zt


def reddot(y, rail_top, sight_z, half_w=0.0165, win_h=0.0125, node="dressing"):
    """Holographic / red-dot optic (2026-11-13): a clamp, a hooded window frame you look
    THROUGH (no lens geometry: nothing to tint or fog the sight picture) and one
    emissive dot sitting exactly on the sight line. At ADS the eye is on that line by
    construction (SOCKET_sight), so the dot is the point of aim; it rides the gun
    through sway and recoil like a real collimated sight seen slightly off-axis."""
    z0 = rail_top + 0.006
    top = sight_z + win_h + 0.0035

    def body(bm):
        rbox(bm, -0.0125, 0.0125, y - 0.026, y + 0.026, rail_top - 0.004, z0)                 # clamp base
        cyl_x(bm, y - 0.014, rail_top - 0.0005, 0.0125, 0.0180, 0.0045, seg=14)                 # clamp nuts
        cyl_x(bm, y + 0.014, rail_top - 0.0005, 0.0125, 0.0180, 0.0045, seg=14)
        prism_y(bm, [(-half_w, z0 - 0.001), (half_w, z0 - 0.001), (half_w, top - 0.004), (half_w - 0.004, top),
                     (-half_w + 0.004, top), (-half_w, top - 0.004)], y - 0.020, y + 0.022)     # hood
        rbox(bm, -0.0105, 0.0105, y - 0.034, y - 0.020, z0 - 0.001, sight_z - win_h - 0.001)   # battery box
        cyl_x(bm, y - 0.027, z0 + 0.006, -0.0105, -0.0150, 0.0048, seg=14)                      # brightness dial

    def cut(bm):
        iw = half_w - 0.0030
        prism_y(bm, [(-iw, sight_z - win_h), (iw, sight_z - win_h), (iw, sight_z + win_h - 0.003),
                     (iw - 0.003, sight_z + win_h), (-iw + 0.003, sight_z + win_h), (-iw, sight_z + win_h - 0.003)],
                y - 0.040, y + 0.040)                                                           # the window
    part("optic_body", body, COL["optic"], "optic", node, bevel=0.0009, seg=2, angle=25, cut=cut)

    def dot(bm):
        cyl_y(bm, 0.0, sight_z, y + 0.0100, y + 0.0104, 0.00095, seg=12)
    part("optic_dot", dot, (1.0, 0.05, 0.03), "dot", node, bevel=0)


def iron_rear(y, rail_top, sight_z, node="dressing"):
    """Flip-up rear aperture (MBUS/Troy style): clamp, tower, protective ears, ring."""
    def b(bm):
        rbox(bm, -0.0105, 0.0105, y - 0.012, y + 0.012, rail_top - 0.0040, rail_top + 0.0030)       # clamp
        prism_x(bm, [(y - 0.007, rail_top + 0.002), (y + 0.006, rail_top + 0.002),
                     (y + 0.004, sight_z - 0.0062), (y - 0.004, sight_z - 0.0062)], -0.0060, 0.0060)  # tower
        for sx in (-1, 1):                                                                          # ears
            prism_x(bm, [(y - 0.006, rail_top + 0.002), (y + 0.005, rail_top + 0.002),
                         (y + 0.003, sight_z + 0.0085), (y - 0.004, sight_z + 0.0085)],
                    sx * 0.0060 if sx > 0 else -0.0092, 0.0092 if sx > 0 else -0.0060)
        # aperture: a game-sized ghost ring (in-game ADS judgment: a true 2 mm peep at 26 cm from the
        # eye reads as a solid disc that hides the front post)
        tube_ring_y(bm, 0.0, sight_z, y - 0.0022, y + 0.0022, 0.0042, 0.0072, seg=28)
    part("rear_sight", b, COL["anod"], "metal", node, bevel=0.0005, seg=1)


def iron_front(y, base_z, sight_z, node="dressing", clamp_w=0.0105):
    """Front post with protective wings; post top exactly on the sight line."""
    def b(bm):
        rbox(bm, -clamp_w, clamp_w, y - 0.010, y + 0.010, base_z - 0.004, base_z + 0.003)
        prism_x(bm, [(y - 0.008, base_z + 0.002), (y + 0.008, base_z + 0.002),
                     (y + 0.004, sight_z - 0.008), (y - 0.004, sight_z - 0.008)], -0.0055, 0.0055)
        for x0, x1 in ((-0.0090, -0.0055), (0.0055, 0.0090)):
            prism_x(bm, [(y - 0.006, sight_z - 0.010), (y + 0.006, sight_z - 0.010),
                         (y + 0.004, sight_z + 0.0040), (y - 0.004, sight_z + 0.0040)], x0, x1)
        rbox(bm, -0.0009, 0.0009, y - 0.0011, y + 0.0011, sight_z - 0.010, sight_z)                # post
    part("front_sight", b, COL["anod"], "metal", node, bevel=0.0003, seg=1)


def ar_grip(top_z, col, scale=1.0, name="grip"):
    """Raked AR pistol grip with finger swell and a beavertail lip."""
    s = scale
    pts = [(-0.052 * s, top_z), (-0.010 * s, top_z), (-0.013 * s, top_z - 0.018 * s),
           (-0.019 * s, top_z - 0.034 * s), (-0.017 * s, top_z - 0.046 * s), (-0.024 * s, top_z - 0.060 * s),
           (-0.030 * s, top_z - 0.084 * s), (-0.036 * s, top_z - 0.094 * s), (-0.068 * s, top_z - 0.094 * s),
           (-0.074 * s, top_z - 0.086 * s), (-0.062 * s, top_z - 0.040 * s), (-0.060 * s, top_z - 0.012 * s),
           (-0.064 * s, top_z - 0.004 * s)]
    part(name, lambda bm: prism_x(bm, pts, -0.0135, 0.0135), col, "grip", "base", bevel=0.0030, seg=3, angle=25)


def trigger_group(y0, y1, z_top, node="base"):
    def guard(bm):
        rbox(bm, -0.0055, 0.0055, y0, y1, z_top - 0.024, z_top - 0.019)          # bottom bar
        rbox(bm, -0.0055, 0.0055, y1 - 0.006, y1, z_top - 0.024, z_top)          # front post
    part("trigger_guard", guard, COL["anod"], "metal", node, bevel=0.0012, seg=2)

    def trig(bm):
        yt = y0 + (y1 - y0) * 0.42
        prism_x(bm, [(yt, z_top), (yt + 0.006, z_top), (yt + 0.004, z_top - 0.008),
                     (yt + 0.0005, z_top - 0.015), (yt - 0.002, z_top - 0.016), (yt + 0.001, z_top - 0.007)],
                -0.0028, 0.0028)
    part("trigger", trig, COL["steel"], "metal", node, bevel=0.0006, seg=1)


def mlok_handguard(y0, y1, cz, r_flat, col, name="handguard", n=8, slot_rows=(2, 3, 5, 6)):
    """Octagonal free-float handguard with pocketed M-LOK slots on the side and
    lower-diagonal faces (true recesses — boolean, exact solver)."""
    R = r_flat / math.cos(math.pi / n)

    def b(bm):
        ngon_y(bm, 0.0, cz, y0, y1, R, n)

    def cut(bm):
        # face k has its centre at angle (2*pi*(k+0.5)/n) measured from +Z toward +X
        for k in slot_rows:
            ang = 2 * math.pi * (k + 0.5) / n
            nrm = Vector((math.sin(ang), 0.0, math.cos(ang)))
            t = Vector((math.cos(ang), 0.0, -math.sin(ang)))       # across the face
            y = y0 + 0.022
            while y + 0.032 < y1 - 0.010:
                c = Vector((0.0, 0.0, cz)) + nrm * r_flat
                half_t = r_flat * math.tan(math.pi / n) * 0.42
                v = []
                for dy in (0.0, 0.032):
                    for dt in (-half_t, half_t):
                        for dn in (-0.0045, 0.004):
                            p = c + t * dt + nrm * dn
                            v.append(bm.verts.new((p.x, y + dy, p.z)))
                # 8 verts box: index = dy*4 + dt*2 + dn
                F = [(0, 2, 6, 4), (1, 5, 7, 3), (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6)]
                for f in F:
                    bm.faces.new([v[i] for i in f])
                y += 0.044
    part(name, b, col, "metal", "base", bevel=0.0012, seg=2, angle=20, cut=cut)


def flash_hider(y0, y1, z, r, node="muzzle"):
    def b(bm):
        cyl_y(bm, 0.0, z, y0, y1, r, r * 0.96, seg=24)

    def cut(bm):
        for deg in (0, 60, 120, 240, 300):       # A2-style: no slot at the bottom (no dust kick)
            a = math.radians(deg)
            c = Vector((math.sin(a) * r, 0, z + math.cos(a) * r))
            nrm = Vector((math.sin(a), 0, math.cos(a)))
            t = Vector((math.cos(a), 0, -math.sin(a)))
            v = []
            for dy in (y0 + (y1 - y0) * 0.35, y1 + 0.002):
                for dt in (-0.0016, 0.0016):
                    for dn in (-0.006, 0.003):
                        p = c + t * dt + nrm * dn
                        v.append(bm.verts.new((p.x, dy, p.z)))
            for f in [(0, 2, 6, 4), (1, 5, 7, 3), (0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6)]:
                bm.faces.new([v[k] for k in f])
        cyl_y(bm, 0.0, z, y1 - 0.012, y1 + 0.002, r * 0.55, seg=20)          # bore counter-sink
    part("flash_hider", b, COL["steel"], "metal", node, bevel=0.0008, seg=2, cut=cut)


def scope(y_ocular, y_objective, z, tube_r=0.0127, obj_r=0.0215, ocu_r=0.0195, rail_top=None,
          ring_ys=None, node="dressing"):
    """Riflescope: ocular bell, eyepiece, tube, turret saddle, objective bell, lens
    glass recessed in both bells, two rings on picatinny clamps."""
    yo, yb = y_ocular, y_objective
    L = yb - yo

    def body(bm):
        cyl_y(bm, 0, z, yo, yo + 0.030, ocu_r, ocu_r, seg=36)                       # eyepiece
        cyl_y(bm, 0, z, yo + 0.030, yo + 0.050, ocu_r, ocu_r * 0.94, seg=36)        # power ring
        cyl_y(bm, 0, z, yo + 0.050, yo + 0.075, ocu_r * 0.94, tube_r, seg=36)       # ocular taper
        cyl_y(bm, 0, z, yo + 0.075, yb - 0.075, tube_r, tube_r, seg=36)             # main tube
        cyl_y(bm, 0, z, yb - 0.075, yb - 0.045, tube_r, obj_r * 0.92, seg=36)       # objective taper
        cyl_y(bm, 0, z, yb - 0.045, yb, obj_r, obj_r, seg=40)                       # objective bell
        mid = yo + L * 0.50
        rbox(bm, -0.0155, 0.0155, mid - 0.022, mid + 0.022, z - 0.011, z + 0.011)     # turret saddle
        cyl_z(bm, 0, mid, z + 0.008, z + 0.024, 0.0105, seg=28)                     # elevation turret
        cyl_x(bm, mid, z, 0.008, 0.024, 0.0105, seg=28)                             # windage turret
        cyl_x(bm, mid + 0.030, z, -0.022, -0.012, 0.0080, seg=24)                    # parallax knob (left)

    def cut(bm):
        cyl_y(bm, 0, z, yo - 0.002, yo + 0.006, ocu_r - 0.0025, seg=36)               # recess the glass
        cyl_y(bm, 0, z, yb - 0.008, yb + 0.002, obj_r - 0.0025, seg=40)
        mid = yo + L * 0.50
        for k in range(14):                                                         # turret knurl
            a = 2 * math.pi * k / 14
            x, yy = math.cos(a) * 0.0108, math.sin(a) * 0.0108
            rbox(bm, x - 0.0012, x + 0.0012, mid + yy - 0.0012, mid + yy + 0.0012, z + 0.016, z + 0.025)
    part("scope_body", body, COL["optic"], "optic", node, bevel=0.0010, seg=2, angle=25, cut=cut)

    def glass(bm):
        for yy, r in ((yo + 0.005, ocu_r - 0.0025), (yb - 0.007, obj_r - 0.0025)):
            cyl_y(bm, 0, z, yy, yy + 0.0005, r, seg=36)
    o = part("scope_glass", glass, (0.02, 0.05, 0.06), "glass", node, bevel=0)

    if rail_top is not None:
        ys = ring_ys or (yo + L * 0.30, yo + L * 0.72)

        def rings(bm):
            for yy in ys:
                tube_ring_y(bm, 0, z, yy - 0.008, yy + 0.008, tube_r - 0.0002, tube_r + 0.0045, seg=32)
                prism_x(bm, [(yy - 0.008, rail_top - 0.003), (yy + 0.008, rail_top - 0.003),
                             (yy + 0.007, z - tube_r + 0.001), (yy - 0.007, z - tube_r + 0.001)], -0.0080, 0.0080)
                rbox(bm, -0.0125, 0.0125, yy - 0.009, yy + 0.009, rail_top - 0.004, rail_top + 0.003)   # clamp
                cyl_x(bm, yy, rail_top - 0.0005, 0.0125, 0.0175, 0.0042, seg=14)                       # clamp nut
        part("scope_rings", rings, COL["anod"], "metal", node, bevel=0.0007, seg=2)


# ---------------------------------------------------------------------------
# the five guns
# ---------------------------------------------------------------------------
def gun_ar(spec):
    """AR-platform (Warden carbine, Vesper SMG variant, Corvus DMR)."""
    bz = spec["bore_z"]
    s = spec.get("k", 1.0)                    # receiver scale (AR-10 = 1.08)
    ry0, ry1 = spec["recv"]
    up_z0 = bz - 0.022 * s
    up_z1 = max(bz + 0.024 * s, bz + spec["hg_r"] - 0.001)   # flush with the handguard top
    hw = 0.0120 * s
    furn = spec.get("furniture", COL["poly"])
    # (2026-11-13 hip pass) stocks use the textured "grip" polymer: at the hip the stock is the
    # nearest upward-facing surface to the eye and smooth polymer caught the moon at grazing
    # incidence as a pale slab in the bottom-right corner (same measurement as the breaker)
    recv_col = spec.get("recv_col", COL["anod"])

    # upper receiver: flat-top with a chamfered lower edge and the brass deflector hump
    def upper(bm):
        prism_y(bm, [(-hw, up_z0 + 0.004), (-hw + 0.004, up_z0), (hw - 0.004, up_z0), (hw, up_z0 + 0.004),
                     (hw, up_z1), (-hw, up_z1)], ry0, ry1)
        rbox(bm, hw - 0.001, hw + 0.006, ry0 + 0.040, ry0 + 0.056, bz - 0.004, bz + 0.016)          # deflector
        cyl_x(bm, ry0 + 0.028, bz + 0.008, hw - 0.001, hw + 0.010, 0.0062, seg=18)                 # fwd assist
        rbox(bm, hw - 0.001, hw + 0.0015, ry0 + 0.060, ry0 + 0.112, bz - 0.012, bz + 0.010)        # dust cover
        cyl_y(bm, hw + 0.0012, bz - 0.013, ry0 + 0.058, ry0 + 0.114, 0.0016, seg=10)                # hinge rod
    part("upper", upper, recv_col, "metal", bevel=0.0012)

    # charging handle at the back of the upper
    def ch(bm):
        rbox(bm, -0.006, 0.006, ry0 - 0.014, ry0 + 0.004, up_z1 - 0.010, up_z1 - 0.002)
        prism_y(bm, [(-0.020, up_z1 - 0.010), (0.020, up_z1 - 0.010), (0.017, up_z1 - 0.003),
                     (-0.017, up_z1 - 0.003)], ry0 - 0.018, ry0 - 0.010)
    part("charging_handle", ch, COL["anod"], "metal", bevel=0.0008)

    # lower receiver + magwell
    lz1 = up_z0 + 0.001
    lz0 = spec.get("lower_z0", 0.0)
    mw0, mw1 = spec["magwell"]

    def lower(bm):
        lt = lz0 + 0.012                      # trigger-well floor (grip + guard hang below it)
        prism_x(bm, [(ry0 + 0.004, lz1 - 0.020), (ry0 + 0.014, lz1 - 0.026), (-0.056, lt),
                     (mw0, lt), (mw0, lz1), (ry0 + 0.004, lz1)], -hw + 0.0010, hw - 0.0010)
        prism_x(bm, [(mw0 - 0.006, lz1), (mw0 - 0.006, lt), (mw0 - 0.002, lz0 - 0.016),
                     (mw0 + 0.004, lz0 - 0.026), (mw1 + 0.002, lz0 - 0.026), (mw1 + 0.007, lz0 - 0.020),
                     (mw1 + 0.004, lz0 + 0.004), (mw1 + 0.010, lz1)],
                -hw - 0.0020, hw + 0.0020)
        rbox(bm, -hw - 0.0026, -hw - 0.0004, mw0 - 0.020, mw0 - 0.006, lz1 - 0.014, lz1 - 0.004)   # bolt catch
        rbox(bm, -hw - 0.0006, hw + 0.0006, ry0 + 0.010, ry0 + 0.030, lz0 + 0.004, lz1 - 0.004)    # buffer boss
        cyl_x(bm, mw1 - 0.006, lz1 - 0.006, -hw - 0.0025, hw + 0.0025, 0.0028, seg=12)              # pivot pin
        cyl_x(bm, ry0 + 0.020, lz1 - 0.008, -hw - 0.0025, hw + 0.0025, 0.0028, seg=12)              # takedown pin
        cyl_x(bm, -0.004, lz0 + 0.020, -hw - 0.0030, -hw, 0.0045, seg=14)                            # safety
        rbox(bm, hw, hw + 0.0035, mw0 - 0.010, mw0 - 0.002, lz0 + 0.008, lz0 + 0.016)                # mag release
    part("lower", lower, recv_col, "metal", bevel=0.0012)

    # selector lever, on FIRE (rearward = AUTO on a 3-position lower, up = FIRE on a 2-position)
    mk = spec.get("marks")
    fire = mk["fire"] if mk else ("SAFE", "SEMI", "AUTO")

    def lever(bm):
        sy, sz_ = -0.004, lz0 + 0.020
        if len(fire) >= 3:
            prism_x(bm, [(sy, sz_ - 0.0019), (sy, sz_ + 0.0019), (sy - 0.0068, sz_ + 0.0013),
                         (sy - 0.0068, sz_ - 0.0013)], -hw - 0.0046, -hw - 0.0029)
        else:
            prism_x(bm, [(sy - 0.0019, sz_), (sy + 0.0019, sz_), (sy + 0.0013, sz_ + 0.0062),
                         (sy - 0.0013, sz_ + 0.0062)], -hw - 0.0046, -hw - 0.0029)
    part("selector_lever", lever, COL["steel"], "metal", bevel=0.0005, seg=1)
    if mk:
        xf = -hw - 0.0020                                   # magwell's left face
        yc = (mw0 + mw1) * 0.5 - 0.002
        roll_mark("marks_magwell", [("ZAROV ARMS", 0.0028 * s, lz1 - 0.0100),
                                    (mk["model"], 0.0040 * s, lz1 - 0.0185),
                                    (mk["cal"], 0.0027 * s, lz1 - 0.0250),
                                    ("SER " + mk["serial"], 0.0023 * s, lz1 - 0.0305)], xf, yc)
        selector_marks("marks_selector", -0.004, lz0 + 0.020, -hw + 0.0010, fire, zmax=lz1)

    trigger_group(-0.006, mw0 - 0.006, lz0 + 0.014)
    ar_grip(lz0 + 0.014, spec.get("grip_col", furn))

    # top rail along the whole receiver + handguard
    hg0, hg1 = spec["handguard"]
    rail_top = pic_rail("rail", ry0 + 0.002, hg1 - 0.004, up_z1)

    # handguard
    hr = spec["hg_r"]
    mlok_handguard(ry1 - 0.001, hg1, bz, hr, spec.get("hg_col", recv_col))

    # barrel, gas block, muzzle device
    by1 = spec["barrel_end"]
    br = spec.get("barrel_r", 0.0085)

    def barrel(bm):
        cyl_y(bm, 0, bz, hg1 - 0.020, by1, br * 1.05, br, seg=24)
        if spec.get("gas_block", True):
            rbox(bm, -0.0105, 0.0105, hg1 + 0.006, hg1 + 0.024, bz - 0.011, bz + 0.012)
    part("barrel", barrel, COL["steel"], "metal", "dressing", bevel=0.0008)
    md = spec.get("muzzle", "a2")
    my1 = spec["muzzle_end"]
    if md == "a2":
        flash_hider(by1 - 0.002, my1, bz, br * 1.35)
    elif md == "brake":
        def brake(bm):
            rbox(bm, -0.0125, 0.0125, by1 - 0.002, my1, bz - 0.0115, bz + 0.0115)

        def bcut(bm):
            for k in range(3):
                yy = by1 + 0.010 + k * 0.016
                rbox(bm, -0.020, 0.020, yy, yy + 0.008, bz - 0.006, bz + 0.0125)
            cyl_y(bm, 0, bz, my1 - 0.010, my1 + 0.003, 0.0055)
        part("muzzle_brake", brake, COL["anod"], "metal", "muzzle", bevel=0.0010, cut=bcut)
    elif md == "can":
        def can(bm):
            cyl_y(bm, 0, bz, by1 - 0.002, by1 + 0.012, br * 1.3, spec["can_r"], seg=32)
            cyl_y(bm, 0, bz, by1 + 0.012, my1 - 0.006, spec["can_r"], spec["can_r"], seg=36)
            cyl_y(bm, 0, bz, my1 - 0.006, my1, spec["can_r"], spec["can_r"] * 0.88, seg=36)

        def ccut(bm):
            cyl_y(bm, 0, bz, my1 - 0.004, my1 + 0.003, 0.0050, seg=20)
            for k in range(10):                   # wrench flats / grip rings
                yy = by1 + 0.030 + k * 0.012
                tube_ring_y(bm, 0, bz, yy, yy + 0.0025, spec["can_r"] - 0.0008, spec["can_r"] + 0.004, seg=32)
        part("suppressor", can, COL["anod"], "metal", "muzzle", bevel=0.0010, cut=ccut)

    # buffer tube + stock
    st = spec["stock"]
    tz = bz - 0.010 * s

    def buffer(bm):
        cyl_y(bm, 0, tz, st["y_tube"], ry0 + 0.004, 0.0150, seg=28)
        tube_ring_y(bm, 0, tz, ry0 - 0.004, ry0 + 0.004, 0.0148, 0.0185, seg=28)      # castle nut
    part("buffer_tube", buffer, COL["anod"], "metal", bevel=0.0008)
    if st["kind"] == "carbine":
        y0s, y1s = st["y0"], st["y1"]

        def stock(bm):
            prism_x(bm, [(y1s, tz + 0.019), (y1s - 0.030, tz + 0.024), (y0s + 0.010, tz + 0.028),
                         (y0s, tz + 0.022), (y0s, tz - 0.070), (y0s + 0.010, tz - 0.076),
                         (y0s + 0.030, tz - 0.066), (y1s - 0.020, tz - 0.024), (y1s, tz - 0.020)],
                    -0.0170, 0.0170)
            rbox(bm, -0.0190, 0.0190, y0s - 0.012, y0s + 0.001, tz - 0.074, tz + 0.026)            # buttpad

        def stock_cut(bm):
            prism_x(bm, [(y0s + 0.020, tz - 0.016), (y1s - 0.040, tz - 0.016), (y0s + 0.026, tz - 0.054)],
                    -0.030, 0.030)                                                                 # lightening cut
        part("stock", stock, furn, "grip", bevel=0.0026, seg=3, angle=25, cut=stock_cut)
    elif st["kind"] == "precision":
        y0s, y1s = st["y0"], st["y1"]

        def stock(bm):
            prism_x(bm, [(y1s, tz + 0.020), (y1s - 0.020, tz + 0.034), (y0s + 0.016, tz + 0.034),
                         (y0s, tz + 0.026), (y0s, tz - 0.080), (y0s + 0.020, tz - 0.084),
                         (y0s + 0.070, tz - 0.032), (y1s, tz - 0.024)], -0.0200, 0.0200)
            rbox(bm, -0.0215, 0.0215, y0s - 0.012, y0s + 0.002, tz - 0.082, tz + 0.030)            # buttpad
            prism_x(bm, [(y0s + 0.020, tz + 0.034), (y1s - 0.030, tz + 0.034), (y1s - 0.040, tz + 0.046),
                         (y0s + 0.030, tz + 0.048)], -0.0160, 0.0160)                               # cheek riser
        part("stock", stock, furn, "grip", bevel=0.0030, seg=3, angle=25)
    elif st["kind"] == "skeleton":
        y0s = st["y0"]

        def stock(bm):
            for zz in (tz + 0.012, tz - 0.018):
                cyl_y(bm, 0.0, zz, y0s + 0.004, ry0 - 0.004, 0.0055, seg=16)
            prism_x(bm, [(y0s, tz + 0.030), (y0s + 0.014, tz + 0.030), (y0s + 0.014, tz - 0.066),
                         (y0s, tz - 0.066)], -0.0180, 0.0180)
        part("stock", stock, furn, "grip", bevel=0.0024, seg=2)

    # magazine (its own node: reload animation moves it)
    m = spec["mag"]

    def mag(bm):
        mt = lz0 + 0.006
        ya, yb2 = mw0 + 0.002, mw1 - 0.002
        depth, curve = m["depth"], m.get("curve", 0.0)
        steps = 6
        front, back = [], []
        for i in range(steps + 1):
            t = i / steps
            zz = mt - depth * t
            off = curve * t * t
            front.append((yb2 + off, zz))
            back.append((ya + off * 0.85, zz))
        pts = front + list(reversed(back))
        prism_x(bm, pts, -m["half_w"], m["half_w"])
        fy0, fz = back[-1][0], front[-1][1]
        rbox(bm, -m["half_w"] - 0.0012, m["half_w"] + 0.0012, fy0 - 0.003, front[-1][0] + 0.004,
             fz - 0.008, fz + 0.002)                                                               # floorplate
        for k in range(1, 5):                                                                     # side ribs
            t = 0.18 + k * 0.14
            zz = mt - depth * t
            off = curve * t * t
            prism_x(bm, [(ya + off * 0.85 + 0.006, zz - 0.0015), (yb2 + off - 0.006, zz - 0.0015),
                         (yb2 + off - 0.006, zz + 0.0015), (ya + off * 0.85 + 0.006, zz + 0.0015)],
                    -m["half_w"] - 0.0008, m["half_w"] + 0.0008)
    part("mag", mag, m.get("col", COL["poly"]), "poly", "mag", bevel=0.0018, seg=2, angle=28)

    # sights
    sz = spec["sight_z"]
    if spec.get("optic") == "scope":
        scope(spec["scope_y"][0], spec["scope_y"][1], sz, rail_top=rail_top, node="optic")
    elif spec.get("optic") == "reddot":
        reddot(spec["optic_y"], rail_top, sz, half_w=spec.get("optic_w", 0.0165), win_h=spec.get("optic_h", 0.0125),
               node="optic")
    else:
        iron_rear(spec["rear_y"], rail_top, sz)
        iron_front(spec["front_y"], rail_top, sz)

    return {"bore_z": bz, "sight_z": sz, "muzzle_y": my1,
            "eject": (hw + 0.004, ry0 + 0.085, bz - 0.001), "focus": ((mw0 + mw1) * 0.5 - 0.02, lz1 - 0.018),
            # gunsmith mounts (build_attachments): rail top, handguard, bare barrel end
            "rail_top": rail_top, "ry0": ry0, "hg1": hg1, "hg_r": hr, "by1": by1, "br": br}


def gun_breaker():
    """Pump-action 12 ga (Mossberg 590 / 870 lines) with a semi-pistol-grip stock."""
    bz = 0.088
    def recv(bm):
        prism_x(bm, [(-0.012, 0.030), (0.172, 0.030), (0.176, 0.040), (0.176, 0.104), (0.168, 0.112),
                     (0.010, 0.112), (-0.012, 0.104)], -0.0175, 0.0175)
    def recv_cut(bm):
        rbox(bm, 0.012, 0.030, 0.060, 0.135, 0.068, 0.098)        # ejection port (right)
        rbox(bm, -0.010, 0.010, 0.050, 0.150, 0.020, 0.038)       # loading port (bottom)
    part("receiver", recv, COL["anod"], "metal", bevel=0.0018, cut=recv_cut)

    def tg(bm):
        prism_x(bm, [(-0.010, 0.032), (0.090, 0.032), (0.088, 0.012), (0.064, 0.002), (0.012, -0.004),
                     (-0.010, 0.012)], -0.0110, 0.0110)
    def tg_cut(bm):
        prism_x(bm, [(0.010, 0.026), (0.066, 0.026), (0.062, 0.010), (0.040, 0.004), (0.014, 0.008)],
                -0.020, 0.020)
    part("trigger_plate", tg, COL["poly"], "poly", bevel=0.0015, cut=tg_cut)
    def trig(bm):
        prism_x(bm, [(0.028, 0.028), (0.034, 0.028), (0.032, 0.018), (0.028, 0.010), (0.025, 0.011),
                     (0.028, 0.020)], -0.003, 0.003)
    part("trigger", trig, COL["steel"], "metal", bevel=0.0005, seg=1)
    def safety(bm):
        rbox(bm, -0.006, 0.006, 0.010, 0.022, 0.112, 0.118)
    part("safety", safety, COL["steel"], "metal", bevel=0.0008)

    SZ = 0.1237                                                       # sight line (SOCKET_sight)

    def barrel(bm):
        cyl_y(bm, 0, bz, 0.170, 0.750, 0.0118, 0.0112, seg=28)
        rbox(bm, -0.0035, 0.0035, 0.700, 0.742, bz + 0.010, bz + 0.016)     # front sight ramp
        # blade: its bright insert is centred ON the sight line, so the blade stands 1.4 mm above it
        prism_x(bm, [(0.7340, bz + 0.010), (0.7405, bz + 0.010), (0.7395, SZ + 0.0014),
                     (0.7340, SZ + 0.0014)], -0.0014, 0.0014)
    def bcut(bm):
        cyl_y(bm, 0, bz, 0.742, 0.756, 0.0092, seg=24)
    part("barrel", barrel, COL["steel"], "metal", "dressing", bevel=0.0008, cut=bcut)

    def bead(bm):                                                     # pale insert facing the eye
        cyl_y(bm, 0.0, SZ, 0.7334, 0.7343, 0.00105, seg=14)
    part("front_bead", bead, (0.62, 0.78, 0.58), "lume", "dressing", bevel=0)

    def magtube(bm):
        cyl_y(bm, 0, 0.060, 0.170, 0.700, 0.0115, seg=28)
        cyl_y(bm, 0, 0.060, 0.700, 0.716, 0.0122, 0.0110, seg=28)          # end cap
        rbox(bm, -0.0105, 0.0105, 0.672, 0.694, 0.054, bz + 0.006)          # barrel clamp
        cyl_x(bm, 0.683, 0.074, -0.013, 0.013, 0.0030, seg=12)
    part("mag_tube", magtube, COL["anod"], "metal", "dressing", bevel=0.0010)

    # ghost-ring rear on the receiver. (2026-11-13 ADS pass) Moved from the receiver's middle
    # (y 0.135) to its REAR (y 0.020), where Mossberg/Benelli ghost rings sit: at ADS the eye is
    # ~14 cm behind the grip, so the ring now sits ~16 cm out and frames the bead (radius ~2.9
    # deg) instead of being a 0.8-deg speck 42 cm away. Aperture 6.2 mm, wall 1.8 mm.
    RY = 0.020
    def rear(bm):
        rbox(bm, -0.011, 0.011, RY - 0.016, RY + 0.016, 0.110, 0.1145)
        for x0, x1 in ((-0.0120, -0.0076), (0.0076, 0.0120)):            # protective ears
            prism_x(bm, [(RY - 0.009, 0.112), (RY + 0.009, 0.112), (RY + 0.005, SZ + 0.0088),
                         (RY - 0.005, SZ + 0.0088)], x0, x1)
        tube_ring_y(bm, 0, SZ, RY - 0.0016, RY + 0.0019, 0.0062, 0.0080, seg=40)
        prism_x(bm, [(RY - 0.0026, 0.112), (RY + 0.0026, 0.112), (RY + 0.0016, SZ - 0.0072),
                     (RY - 0.0016, SZ - 0.0072)], -0.0018, 0.0018)
    # (gunsmith) its own node: a receiver optic hides the ghost ring (weapon_meshes.js)
    part("rear_sight", rear, COL["anod"], "metal", "irons", bevel=0.0004, seg=1)

    # SIGHT RIB (2026-11-13 ADS pass). At ADS the receiver's flat top sat 1.2 cm under the eye
    # line, 7-26 cm away: bare anodized metal at grazing incidence mirrors the sky fill and the
    # sight picture was one pale-grey slab. A matte, cross-serrated rib on the receiver plus a
    # ventilated rib down the barrel give the eye the classic shotgun lane: ring -> rib -> bead.
    def rcv_rib(bm):
        rbox(bm, -0.0062, 0.0062, -0.008, 0.168, 0.1110, 0.1150)
    def rcv_rib_cut(bm):
        yy = -0.004
        while yy < 0.164:
            if not (RY - 0.019 < yy < RY + 0.017):                 # leave the rear-sight seat
                rbox(bm, -0.010, 0.010, yy, yy + 0.0012, 0.1138, 0.1170)
            yy += 0.0032
    part("receiver_rib", rcv_rib, COL["poly"], "grip", bevel=0.0005, seg=1, cut=rcv_rib_cut, wear=0.3)

    def vent_rib(bm):
        rbox(bm, -0.0042, 0.0042, 0.176, 0.700, bz + 0.0128, bz + 0.0158)       # top strip
        y = 0.190
        while y < 0.690:                                                      # posts
            rbox(bm, -0.0022, 0.0022, y, y + 0.006, bz + 0.0100, bz + 0.0130)
            y += 0.034
    def vent_rib_cut(bm):
        yy = 0.180
        while yy < 0.696:
            rbox(bm, -0.008, 0.008, yy, yy + 0.0010, bz + 0.0146, bz + 0.0170)
            yy += 0.0030
    part("vent_rib", vent_rib, COL["poly"], "grip", "dressing", bevel=0.0004, seg=1, cut=vent_rib_cut, wear=0.3)

    roll_mark("marks_receiver", [("ZAROV ARMS", 0.0042, 0.0870),
                                 ("B-12 BREAKER", 0.0058, 0.0755),
                                 ("12 GA  76 mm", 0.0034, 0.0675),
                                 ("SER BK-11893", 0.0030, 0.0440)], -0.0175, 0.090)

    # pump (its own node)
    def pump(bm):
        y0, y1 = 0.232, 0.428
        prism_y(bm, [(-0.019, 0.040), (0.019, 0.040), (0.024, 0.048), (0.024, 0.074), (0.019, 0.080),
                     (-0.019, 0.080), (-0.024, 0.074), (-0.024, 0.048)], y0, y1)
        for k in range(9):                                     # grip ribs
            yy = y0 + 0.020 + k * 0.019
            prism_y(bm, [(-0.0255, 0.046), (0.0255, 0.046), (0.0255, 0.076), (-0.0255, 0.076)], yy, yy + 0.008)
    part("pump", pump, COL["odg"], "poly", "pump", bevel=0.0018, seg=2, angle=28)

    # black stock (in-game: an olive stock 9 cm from the eye glared across the hip view's corner)
    def wrist(bm):
        # (2026-11-13 ADS pass) comb dropped ~1 cm: with the cheek on the wrist the old comb ran
        # 2-3.6 cm under the eye and filled the lower sight picture as a slab
        prism_x(bm, [(-0.012, 0.100), (-0.060, 0.078), (-0.110, 0.068), (-0.110, -0.026), (-0.080, -0.044), (-0.058, -0.068),
                     (-0.040, -0.066), (-0.030, -0.046), (-0.022, -0.016), (-0.012, 0.030)], -0.0160, 0.0160)
    # (2026-11-13 ADS pass) textured "grip" polymer, not smooth "poly": at ADS the wrist/comb
    # top is the lower sight picture, and the smooth polymer's grazing moon specular rendered
    # it a pale slab (measured median 0.031 vs 0.010 for the grip material in the same frame)
    part("stock_wrist", wrist, COL["poly"], "grip", bevel=0.0045, seg=3, angle=24)

    def butt(bm):
        prism_x(bm, [(-0.100, 0.070), (-0.232, 0.056), (-0.239, 0.048), (-0.239, -0.070),
                     (-0.228, -0.078), (-0.100, -0.028)], -0.0200, 0.0200)
    def butt_cut(bm):
        for x0, x1 in ((-0.030, -0.0185), (0.0185, 0.030)):            # recessed side panels
            prism_x(bm, [(-0.130, 0.050), (-0.212, 0.040), (-0.212, -0.046), (-0.130, -0.014)], x0, x1)
    part("stock_butt", butt, COL["poly"], "poly", bevel=0.0050, seg=3, angle=24, cut=butt_cut)
    def pad(bm):
        rbox(bm, -0.0210, 0.0210, -0.252, -0.238, -0.076, 0.054)
    part("buttpad", pad, COL["rubber"], "rubber", bevel=0.0030, seg=2)
    return {"bore_z": bz, "sight_z": SZ, "muzzle_y": 0.750, "eject": (0.020, 0.100, 0.083),
            "focus": (0.090, 0.075),
            "rail_top": 0.1150, "by1": 0.750, "br": 0.0118}


def gun_pike():
    """Striker-fired 9 mm duty pistol (Glock/P320 lines)."""
    sz = 0.0843
    bz = 0.047

    def slide(bm):
        prism_y(bm, [(-0.0115, 0.034), (0.0115, 0.034), (0.0115, 0.068), (0.0082, 0.0735),
                     (-0.0082, 0.0735), (-0.0115, 0.068)], -0.046, 0.186)
    def slide_cut(bm):
        for k in range(7):                                 # rear serrations
            yy = -0.040 + k * 0.0055
            rbox(bm, -0.020, 0.020, yy, yy + 0.0022, 0.036, 0.066)
        for k in range(5):                                 # front serrations
            yy = 0.130 + k * 0.0055
            rbox(bm, -0.020, 0.020, yy, yy + 0.0022, 0.040, 0.064)
        rbox(bm, -0.004, 0.020, 0.012, 0.064, 0.058, 0.080)        # ejection port
        cyl_y(bm, 0, bz, 0.176, 0.192, 0.0060, seg=20)             # muzzle bore
    part("slide", slide, COL["anod"], "metal", bevel=0.0012, seg=2, cut=slide_cut)

    def hood(bm):
        rbox(bm, -0.0072, 0.0072, 0.014, 0.062, 0.050, 0.0715)
        cyl_y(bm, 0, bz, 0.150, 0.184, 0.0074, seg=22)
    part("barrel_hood", hood, COL["steel"], "metal", "dressing", bevel=0.0006)

    # 3-dot sights (2026-11-13). The sight line (SOCKET_sight, sz) runs through the CENTRE
    # of the front dot and both rear dots; post top and ear tops stand 2.8 mm above it, the
    # notch floor 2.2 mm below — the classic "dots in a row, post flush in the notch" picture.
    top = sz + 0.0028

    def sights(bm):
        for x0, x1 in ((-0.0080, -0.0018), (0.0018, 0.0080)):                     # rear ears
            prism_x(bm, [(-0.041, 0.0730), (-0.028, 0.0730), (-0.031, top), (-0.041, top)], x0, x1)
        rbox(bm, -0.0080, 0.0080, -0.041, -0.028, 0.0725, sz - 0.0022)            # notch floor
        prism_x(bm, [(0.1660, 0.0730), (0.1760, 0.0730), (0.1740, top), (0.1660, top)],
                -0.0016, 0.0016)                                                   # front post
    part("sights", sights, COL["anod"], "metal", "dressing", bevel=0.0004, seg=1)

    def dots(bm):
        cyl_y(bm, 0.0, sz, 0.16555, 0.16625, 0.00095, seg=14)                    # front: ON the line
        for x in (-0.0049, 0.0049):
            cyl_y(bm, x, sz, -0.04155, -0.04085, 0.00085, seg=14)                  # rear: level with it
    part("sight_dots", dots, (0.62, 0.78, 0.58), "lume", "dressing", bevel=0)

    roll_mark("marks_slide", [("GS-9 PIKE", 0.0042, 0.0535), ("9x19  ZAROV ARMS", 0.0024, 0.0455)],
              -0.0115, 0.072)
    roll_mark("marks_frame", [("BR-20417", 0.0022, 0.0255)], -0.0110, 0.150)

    def frame(bm):
        prism_x(bm, [(-0.040, 0.035), (0.182, 0.035), (0.182, 0.020), (0.176, 0.014), (0.098, 0.014),
                     (0.094, 0.004), (0.090, -0.016), (0.034, -0.016), (0.026, 0.010), (0.020, 0.012),
                     (-0.036, 0.014), (-0.046, 0.016), (-0.046, 0.028)], -0.0110, 0.0110)
        for k in range(3):                                         # accessory rail slots
            yy = 0.110 + k * 0.020
            rbox(bm, -0.0118, 0.0118, yy, yy + 0.010, 0.015, 0.022)
    def frame_cut(bm):
        prism_x(bm, [(0.040, 0.010), (0.086, 0.010), (0.083, -0.010), (0.044, -0.010)], -0.020, 0.020)
    part("frame", frame, COL["poly"], "poly", bevel=0.0012, seg=2, cut=frame_cut)

    def trig(bm):
        prism_x(bm, [(0.050, 0.014), (0.057, 0.014), (0.056, 0.004), (0.052, -0.004), (0.049, -0.003),
                     (0.052, 0.006)], -0.0030, 0.0030)
    part("trigger", trig, COL["poly"], "poly", bevel=0.0005, seg=1)

    def grip(bm):
        prism_x(bm, [(-0.036, 0.017), (0.024, 0.014), (0.020, 0.000), (0.015, -0.028), (0.016, -0.045),
                     (0.011, -0.066), (0.009, -0.078), (-0.031, -0.078), (-0.033, -0.050), (-0.031, -0.020),
                     (-0.036, -0.002), (-0.046, 0.008), (-0.047, 0.015)], -0.0142, 0.0142)
    part("grip", grip, COL["poly"], "grip", bevel=0.0028, seg=3, angle=25)

    def mag(bm):
        prism_x(bm, [(-0.026, 0.004), (0.016, 0.004), (0.006, -0.078), (-0.030, -0.078)], -0.0105, 0.0105)
        rbox(bm, -0.0128, 0.0128, -0.034, 0.012, -0.088, -0.078)      # baseplate
    part("mag", mag, COL["poly"], "poly", "mag", bevel=0.0015, seg=2)
    return {"bore_z": bz, "sight_z": sz, "muzzle_y": 0.186, "eject": (0.014, 0.040, 0.066),
            "focus": (0.080, 0.050),
            "rail_top": 0.0735, "by1": 0.186, "br": 0.0074}


SPECS = {
    "warden": dict(bore_z=0.062, recv=(-0.104, 0.090), magwell=(0.060, 0.118), handguard=(0.090, 0.405),
                   hg_r=0.0270, barrel_end=0.620, muzzle="a2", muzzle_end=0.683, sight_z=0.126,
                   optic="reddot", optic_y=-0.030, lower_z0=0.000,
                   stock=dict(kind="carbine", y_tube=-0.236, y0=-0.262, y1=-0.150),
                   mag=dict(depth=0.170, curve=0.042, half_w=0.0112, col=COL["fde"]),
                   furniture=COL["fde"], grip_col=COL["poly"],
                   marks=dict(model="M-72 WARDEN", cal="CAL 5.56x45", serial="BR-04417",
                              fire=("SAFE", "SEMI", "AUTO"))),
    "vesper": dict(bore_z=0.042, recv=(-0.095, 0.105), magwell=(0.038, 0.078), handguard=(0.105, 0.300),
                   hg_r=0.0225, barrel_end=0.330, muzzle="can", can_r=0.0185, muzzle_end=0.609,
                   sight_z=0.0997, optic="reddot", optic_y=-0.020, optic_w=0.0145, optic_h=0.0105,
                   lower_z0=-0.006,
                   stock=dict(kind="skeleton", y_tube=-0.120, y0=-0.253),
                   mag=dict(depth=0.120, curve=0.010, half_w=0.0095, col=COL["poly"]),
                   furniture=COL["poly"], grip_col=COL["poly"], gas_block=False,
                   marks=dict(model="KS-23 VESPER", cal="CAL 9x19", serial="VK-31260",
                              fire=("SAFE", "SEMI", "AUTO"))),
    "corvus": dict(bore_z=0.060, k=1.08, recv=(-0.112, 0.100), magwell=(0.064, 0.128), handguard=(0.100, 0.480),
                   hg_r=0.0300, barrel_end=0.805, barrel_r=0.0100, muzzle="brake", muzzle_end=0.867,
                   sight_z=0.139, optic="scope", scope_y=(-0.110, 0.200), lower_z0=-0.004,
                   stock=dict(kind="precision", y_tube=-0.230, y0=-0.322, y1=-0.150),
                   mag=dict(depth=0.105, curve=0.012, half_w=0.0125, col=COL["poly"]),
                   furniture=COL["fde"], recv_col=COL["fdem"], hg_col=COL["fdem"], grip_col=COL["fde"],
                   marks=dict(model="LR-1 CORVUS", cal="CAL 7.62x51", serial="CR-00782",
                              fire=("SAFE", "FIRE"))),
}

# (2026-11-13 hip pass) support wrists moved ~1.2 cm in and ~1.4 cm down so the hand wraps
# UNDER the handguard instead of sitting beside it in front of it (seen from the hip eye),
# and the elbow drops more (z -0.72) and swings out less toward the camera: the old
# (-0.62,-0.45,-0.64) ran the sleeve past the eye as a flat wedge to the frame edge.
# support / trigger hand poses for THESE guns (same form as a4 ARM_POSE; seated on the
# authored handguard undersides: warden 0.062-0.027 = 0.035, vesper 0.0195, corvus 0.030,
# breaker pump 0.040)
A5_POSE = {
    "warden": [
        ("R", (0.040, -0.075, -0.040), (0.0, 1.0, 0.15), (-1.0, 0.0, 0.05),
         {"index_curl": (12, 16, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.050, 0.235, 0.012), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.55, -0.42, -0.72), "curl": (40, 70, 35), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "vesper": [
        ("R", (0.040, -0.081, -0.046), (0.0, 1.0, 0.15), (-1.0, 0.0, 0.05),
         {"index_curl": (12, 16, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.046, 0.180, -0.004), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.55, -0.42, -0.72), "curl": (44, 74, 38), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "corvus": [
        ("R", (0.040, -0.079, -0.044), (0.0, 1.0, 0.15), (-1.0, 0.0, 0.05),
         {"index_curl": (12, 16, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.052, 0.255, 0.006), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.55, -0.42, -0.72), "curl": (38, 68, 34), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "breaker": [
        ("R", (0.036, -0.112, 0.004), (0.0, 0.92, -0.38), (-1.0, 0.0, 0.0),
         {"index_curl": (10, 14, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.050, 0.315, 0.018), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.55, -0.44, -0.71), "curl": (40, 70, 35), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "pike": [
        ("R", (0.028, -0.066, 0.004), (0.0, 0.90, -0.43), (-1.0, 0.0, 0.0),
         {"index_curl": (8, 12, 6), "elbow_world": (0.30, -0.74, -0.60), "sleeve_r0": 0.033, "sleeve_r": 0.040}),
        ("L", (-0.043, -0.026, 0.000), (0.1, 0.7, -0.7), (1.0, 0.0, 0.0),
         {"elbow_world": (-0.42, -0.66, -0.62), "curl": (50, 70, 40), "thumb_rot": (0, 0, 5, 5),
          "sleeve_r0": 0.033, "sleeve_r": 0.040}),
    ],
}


def build(wid):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PARTS.clear()
    _TEX.clear()
    M = materials()
    if wid in SPECS:
        info = gun_ar(SPECS[wid])
    elif wid == "breaker":
        info = gun_breaker()
    elif wid == "pike":
        info = gun_pike()
    else:
        raise SystemExit("unknown weapon " + wid)

    # paint, UV, material, then join by node
    nodes = {}
    for o, node in PARTS:
        if not o.data.vertices:
            continue
        paint(o)
        o.data.materials.clear()
        o.data.materials.append(M[o["a5_mat"]])
        bpy.context.view_layer.objects.active = o
        for so in bpy.context.selected_objects:
            so.select_set(False)
        o.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.cube_project(cube_size=0.05)
        bpy.ops.object.mode_set(mode="OBJECT")
        shade_smooth(o, 34)
        nodes.setdefault(node, []).append(o)
    joined = []
    for node, objs in nodes.items():
        for so in bpy.context.selected_objects:
            so.select_set(False)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = node
        j.data.name = node
        joined.append(j)

    arms = _g["place_arms"](wid, None, pose_override=[tuple(p) for p in A5_POSE[wid]])
    _g["glove_atlas_finish"](wid)
    bz, sz = info["bore_z"], info["sight_z"]
    mz = bpy.data.objects.new("SOCKET_muzzle", None); mz.location = (0, info["muzzle_y"], bz); link(mz)
    ej = bpy.data.objects.new("SOCKET_eject", None); ej.location = info["eject"]; link(ej)
    sg = bpy.data.objects.new("SOCKET_sight", None); sg.location = (0, 0, sz); link(sg)

    tris = sum(len(p.vertices) - 2 for o in joined for p in o.data.polygons)
    print("A5GUN %s: %d tris in %s" % (wid, tris, [o.name for o in joined]))

    if not NO_PREVIEW:
        _g["previews"](wid, sz)
        # glove macro FROM THE PLAYER'S EYE (hip camera, narrow FOV on each hand)
        v = _g["VIEW"][wid]["posHip"]
        eye = Vector((-v[0], v[2], -v[1]))
        cam = bpy.context.scene.camera
        for hand, (hx, hy, hz) in (("L", A5_POSE[wid][1][1]), ("R", A5_POSE[wid][0][1])):
            tgt = Vector((hx, hy + 0.03, hz + 0.01))
            cam.location = eye
            cam.rotation_euler = (tgt - eye).to_track_quat("-Z", "Y").to_euler()
            cam.data.angle_y = D(17)
            _g["render"](os.path.join(PREV_DIR, f"{wid}_glove{hand}.png"), 1200, 800)
        cam.data.angle_y = D(60)
        studio(wid, joined, arms, info.get("focus"))

    out = os.path.join(OUT_DIR, f"{wid}.glb")
    allo = joined + arms + [mz, ej, sg]
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in allo:
        o.select_set(True)
    for o in joined + arms:
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("tri", "TRIANGULATE")
        try:
            mod.keep_custom_normals = True
        except Exception:
            pass
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for o in bpy.context.scene.objects:
        o.select_set(o in allo)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_apply=True, export_image_format="WEBP", export_image_webp_fallback=False,
        export_image_quality=88, export_yup=True,
        # (2026-11-13) no TANGENT: weapon_meshes.js deleted the arms' copy anyway (re-smoothed
        # normals make it stale) and three derives a per-pixel frame from UV derivatives;
        # ONLY the 'Col' attribute as COLOR_0 (the Quaternius hands carried two unused
        # u16 colour sets + a second UV set: ~40 % of every arm's bytes)
        export_tangents=False, export_vertex_color="NAME", export_vertex_color_name="Col",
        export_all_vertex_colors=False)
    _patch_gltf_materials(out)
    try:
        import shutil, subprocess
        gt = shutil.which("gltf-transform")
        if gt:
            before = os.path.getsize(out)
            for attempt in range(3):           # the CLI occasionally exits non-zero on a cold npx start
                r = subprocess.run([gt, "draco", out, out, "--quantize-position", "16",
                                    "--quantize-normal", "10", "--quantize-texcoord", "14"],
                                   capture_output=True, text=True, shell=(os.name == "nt"))
                if r.returncode == 0:
                    break
            print("A5DRACO %s: %d -> %d bytes%s" % (wid, before, os.path.getsize(out),
                                                    "" if r.returncode == 0 else " FAILED " + (r.stderr or "")[-200:]))
    except Exception as ex:
        print("A5DRACO error:", ex)
    rep = {"weapon": wid, "sightY": round(sz, 4), "muzzle": [0, round(bz, 4), round(-info["muzzle_y"], 4)],
           "eject": [round(info["eject"][0], 4), round(info["eject"][2], 4), round(-info["eject"][1], 4)],
           "tris": tris, "bytes": os.path.getsize(out)}
    print("A5BUILD " + json.dumps(rep))
    return rep


def _glb_rw(path, js=None):
    """Read (js=None) or rewrite the JSON chunk of a GLB, BIN chunk untouched."""
    import struct
    b = open(path, "rb").read()
    _, ver, length = struct.unpack_from("<4sII", b, 0)
    off, chunks = 12, []
    while off < length:
        clen, ctype = struct.unpack_from("<II", b, off)
        chunks.append([ctype, b[off + 8: off + 8 + clen]])
        off += 8 + clen
    if js is None:
        return json.loads(next(c for t, c in chunks if t == 0x4E4F534A).decode("utf-8"))
    raw = json.dumps(js, separators=(",", ":")).encode("utf-8")
    raw += b" " * ((4 - len(raw) % 4) % 4)
    for c in chunks:
        if c[0] == 0x4E4F534A:
            c[1] = raw
    body = b"".join(struct.pack("<II", len(c), t) + c for t, c in chunks)
    open(path, "wb").write(struct.pack("<4sII", b"glTF", ver, 12 + len(body)) + body)


def _patch_gltf_materials(path):
    """Make the exported material contract EXPLICIT instead of trusting the exporter's
    node-graph parsing: factors from _mat_detail, KHR_texture_transform on the detail
    maps and the 10 cm metal normal, then fail loudly if a map went missing."""
    js = _glb_rw(path)
    used = set(js.get("extensionsUsed", []))
    for mat in js.get("materials", []):
        bm = bpy.data.materials.get(mat.get("name", ""))
        tt = bm.get("a4_tt") if bm is not None else None
        if tt is not None:                         # glove atlas / sleeve: weave tile transform
            ni = mat.get("normalTexture")
            if ni is None or (tt["base"] and "baseColorTexture" not in mat.get("pbrMetallicRoughness", {})):
                raise SystemExit("A5 export lost a glove map on %s" % mat["name"])
            ni.setdefault("extensions", {})["KHR_texture_transform"] = {"scale": [float(v) for v in tt["normal"]]}
            ni.pop("texCoord", None)
            bti = mat.get("pbrMetallicRoughness", {}).get("baseColorTexture")
            if bti is not None:
                bti.pop("extensions", None)
                bti.pop("texCoord", None)
            used.add("KHR_texture_transform")
            continue
        f = bm.get("a5_factors") if bm is not None else None
        if f is None:
            continue
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr["roughnessFactor"] = round(float(f["roughness"]), 4)
        pbr["metallicFactor"] = round(float(f["metallic"]), 4)
        pbr.pop("baseColorFactor", None)
        for key, holder, sc in (("baseColorTexture", pbr, DETAIL_SCALE),
                                ("metallicRoughnessTexture", pbr, DETAIL_SCALE),
                                ("normalTexture", mat, float(f["nscale"]))):
            ti = holder.get(key)
            if ti is None:
                raise SystemExit("A5 export lost %s on %s" % (key, mat["name"]))
            ext = ti.setdefault("extensions", {})
            if abs(sc - 1.0) > 1e-6:
                ext["KHR_texture_transform"] = {"scale": [sc, sc]}
                used.add("KHR_texture_transform")
            else:
                ext.pop("KHR_texture_transform", None)
            if not ext:
                ti.pop("extensions")
            ti.pop("texCoord", None)
    js["extensionsUsed"] = sorted(used)
    _glb_rw(path, js)


def studio(wid, joined, arms, focus=None):
    """Judgment renders of the bare gun: left side and 3/4, neutral grey studio."""
    for a in arms:
        a.hide_render = True
    sc = bpy.context.scene
    old_cam = sc.camera
    cam = _g["cam_at"]((-0.9, 0.2, 0.05), (90, 0, -90), 30)
    ys = [v.co.y for o in joined for v in o.data.vertices]
    cy = (min(ys) + max(ys)) * 0.5
    span = max(ys) - min(ys)
    d = max(span * 1.9, 0.62)
    cam.location = (-d, cy, 0.03)
    cam.rotation_euler = (D(90), 0, D(-90))
    _g["render"](os.path.join(PREV_DIR, f"{wid}_studio_side.png"), 1600, 900)
    cam.location = (-d * 0.62, cy - d * 0.55, 0.22 * d / 1.6)
    cam.rotation_euler = (D(76), 0, D(-48))
    _g["render"](os.path.join(PREV_DIR, f"{wid}_studio_q3.png"), 1600, 900)
    cam.location = (d * 0.62, cy - d * 0.45, 0.18 * d / 1.6)
    cam.rotation_euler = (D(78), 0, D(54))
    _g["render"](os.path.join(PREV_DIR, f"{wid}_studio_r3.png"), 1600, 900)
    if focus:
        # macro of the left-side roll marks / surface detail (~what ADS-transition shows)
        fy, fz = focus
        cam.data.angle_y = D(16)
        cam.location = (-0.30, fy - 0.10, fz + 0.04)
        cam.rotation_euler = (D(83), 0, D(-72))
        _g["render"](os.path.join(PREV_DIR, f"{wid}_studio_marks.png"), 1600, 900)
        cam.data.angle_y = D(30)
    for a in arms:
        a.hide_render = False
    sc.camera = old_cam


# ===========================================================================
# GUNSMITH ATTACHMENTS (2026-11-13) -> assets/weapons/attachments.glb
# ===========================================================================
# One shared GEOMETRY-ONLY GLB holding every weapon's optional parts, authored in
# that weapon's own build frame so they sit exactly on its rail / barrel / handguard:
#   node  <wid>__<att>                 (one mesh per attachment, per weapon)
#   empty <wid>__<att>__SIGHT          optics: a point ON the sight line (y = sightY)
#   empty <wid>__<att>__MUZZLE         muzzle devices: the new muzzle (flash origin)
#   empty <wid>__<att>__BEAM           laser: the emitter
# Materials are exported WITHOUT textures: weapon_meshes.js binds each mesh to the
# host gun's own (detail-mapped, camo-patched) material of the same name at load, so
# the parts cost geometry bytes only and wear the gun's finish and camo.
# The guns' factory optic / muzzle device / ghost ring are their own GLB nodes
# ("optic", "muzzle", "irons") so the viewmodel can swap them for these.
# Ids mirror core/sim/attachments.js GUNSMITH.weapons[*].slots.
# usage: blender ... --python tools/a5_build_guns.py -- attachments
ATT_EYE = {"warden": 0.27, "vesper": 0.25, "corvus": 0.34, "breaker": 0.15, "pike": 0.34}  # eye->grip at ADS (posAds.z)
ATT = {}          # node -> {"sight": z|None, "muzzle": (y, z)|None, "beam": (x, y, z)|None}


def _att(wid, att, **kw):
    ATT[f"{wid}__{att}"] = kw
    return f"{wid}__{att}"


def att_holo(wid, y, rail_top, sight_z, node):
    """Wide-window holographic sight: clamp, battery body, a squared hood around a big
    window, and the dot + ring reticle (unlit red, generator material br5_dot) floating
    in the window on the sight line. Ring sized to ~65 MOA at this weapon's eye relief."""
    z0 = rail_top + 0.006
    hw, wh = 0.0185, 0.0125                 # outer half-width, window half-height
    top = sight_z + wh + 0.0045

    def body(bm):
        rbox(bm, -0.0125, 0.0125, y - 0.030, y + 0.030, rail_top - 0.004, z0)                   # clamp base
        cyl_x(bm, y - 0.018, rail_top - 0.0005, 0.0125, 0.0185, 0.0048, seg=14)                  # cross bolts
        cyl_x(bm, y + 0.018, rail_top - 0.0005, 0.0125, 0.0185, 0.0048, seg=14)
        rbox(bm, -hw, hw, y - 0.006, y + 0.034, z0 - 0.001, sight_z - wh - 0.0005)              # battery body
        prism_y(bm, [(-hw, z0 - 0.001), (hw, z0 - 0.001), (hw, top - 0.005), (hw - 0.005, top),
                     (-hw + 0.005, top), (-hw, top - 0.005)], y - 0.028, y + 0.012)              # hood
        for sx in (-1, 1):                                                                       # buttons
            rbox(bm, sx * hw - 0.0015, sx * hw + 0.0015, y + 0.016, y + 0.026, sight_z - wh - 0.008, sight_z - wh - 0.003)

    def cut(bm):
        iw = hw - 0.0032
        prism_y(bm, [(-iw, sight_z - wh), (iw, sight_z - wh), (iw, sight_z + wh - 0.003), (iw - 0.003, sight_z + wh),
                     (-iw + 0.003, sight_z + wh), (-iw, sight_z + wh - 0.003)], y - 0.050, y + 0.050)
    part(node + "_body", body, COL["optic"], "optic", node, bevel=0.0009, seg=2, angle=25, cut=cut)
    yr = y - 0.006                                   # reticle plane (front third of the hood)
    dist = ATT_EYE[wid] + yr
    r_ring = dist * math.tan(math.radians(65 / 60.0 * 0.5))
    w_ring = max(0.00028, dist * 0.0012)

    def ret(bm):
        cyl_y(bm, 0.0, sight_z, yr, yr + 0.0004, max(0.00075, dist * 0.0033), seg=12)             # centre dot
        tube_ring_y(bm, 0.0, sight_z, yr, yr + 0.0004, r_ring - w_ring, r_ring, seg=40)          # ring
    part(node + "_reticle", ret, (1.0, 0.05, 0.03), "dot", node, bevel=0)


def att_minidot(y0, y1, rail_top, sight_z, half_w, win_h, node):
    """Pistol / shotgun mini reflex sight: a low body with a sloped hood and one red
    dot on the sight line."""
    z0 = rail_top
    top = sight_z + win_h + 0.003

    def body(bm):
        rbox(bm, -half_w, half_w, y0, y1, z0 - 0.0015, sight_z - win_h - 0.0005)                 # base
        prism_x(bm, [(y0, sight_z - win_h - 0.001), (y0 + 0.010, top), (y1 - 0.004, top), (y1, sight_z - win_h - 0.001)],
                -half_w, half_w)                                                                  # hood

    def cut(bm):
        iw = half_w - 0.0024
        prism_y(bm, [(-iw, sight_z - win_h), (iw, sight_z - win_h), (iw, sight_z + win_h - 0.002),
                     (iw - 0.002, sight_z + win_h), (-iw + 0.002, sight_z + win_h), (-iw, sight_z + win_h - 0.002)],
                y0 - 0.02, y1 + 0.02)
    part(node + "_body", body, COL["optic"], "optic", node, bevel=0.0008, seg=2, angle=25, cut=cut)

    def dot(bm):
        yy = y0 + (y1 - y0) * 0.55
        cyl_y(bm, 0.0, sight_z, yy, yy + 0.0004, 0.00090, seg=12)
    part(node + "_dot", dot, (1.0, 0.05, 0.03), "dot", node, bevel=0)


def att_can(y0, L, z, R, r_neck, node):
    """Screw-on suppressor. Grip rings are RAISED bands, not boolean grooves: the
    grooved version cost ~14k vertices per can for the same read at arm's length."""
    def can(bm):
        cyl_y(bm, 0, z, y0, y0 + 0.012, r_neck, R, seg=28)
        cyl_y(bm, 0, z, y0 + 0.012, y0 + L - 0.006, R, R, seg=28)
        cyl_y(bm, 0, z, y0 + L - 0.006, y0 + L, R, R * 0.88, seg=28)
        for k in range(3):
            yy = y0 + 0.020 + k * 0.010
            tube_ring_y(bm, 0, z, yy, yy + 0.004, R - 0.001, R + 0.0012, seg=28)

    def ccut(bm):
        cyl_y(bm, 0, z, y0 + L - 0.004, y0 + L + 0.003, 0.0048, seg=16)
    part(node + "_can", can, COL["anod"], "metal", node, bevel=0.0008, seg=1, cut=ccut)


def att_comp(y0, L, z, r, node):
    def b(bm):
        cyl_y(bm, 0, z, y0, y0 + L, r, r * 0.97, seg=8)                  # octagonal body

    def cut(bm):
        for k in range(3):                                                # top ports push the muzzle down
            yy = y0 + 0.012 + k * 0.012
            rbox(bm, -r * 0.45, r * 0.45, yy, yy + 0.006, z + r * 0.15, z + r * 1.5)
        for k in range(2):                                                # side ports
            yy = y0 + 0.016 + k * 0.014
            rbox(bm, -r * 1.5, r * 1.5, yy, yy + 0.005, z - r * 0.35, z + r * 0.10)
        cyl_y(bm, 0, z, y0 + L - 0.010, y0 + L + 0.003, r * 0.45, seg=16)
    part(node + "_comp", b, COL["anod"], "metal", node, bevel=0.0008, seg=2, angle=25, cut=cut)


def att_grip(y, z_bot, node):
    """Vertical fore grip clamped to the handguard's bottom flat."""
    def b(bm):
        rbox(bm, -0.0110, 0.0110, y - 0.018, y + 0.018, z_bot - 0.008, z_bot + 0.002)             # clamp
        cyl_z(bm, 0.0, y, z_bot - 0.082, z_bot - 0.006, 0.0118, 0.0128, seg=24)                  # body
        cyl_z(bm, 0.0, y, z_bot - 0.090, z_bot - 0.080, 0.0132, 0.0120, seg=24)                  # end cap
    part(node + "_grip", b, COL["poly"], "grip", node, bevel=0.0018, seg=2, angle=28)


def att_laser(x, y, z, node, length=0.050):
    """Box laser module on a side / under rail: housing, pressure switch, lens."""
    def b(bm):
        rbox(bm, x - 0.0105, x + 0.0105, y - length * 0.5, y + length * 0.5, z - 0.011, z + 0.011)
        rbox(bm, x - 0.012, x + 0.012, y - length * 0.5 + 0.006, y - length * 0.5 + 0.016, z - 0.0125, z + 0.0125)
        cyl_y(bm, x + 0.004, z + 0.004, y + length * 0.5, y + length * 0.5 + 0.004, 0.0042, seg=18)    # lens bezel
    part(node + "_body", b, COL["anod"], "metal", node, bevel=0.0012, seg=2, angle=25)

    def lens(bm):
        cyl_y(bm, x + 0.004, z + 0.004, y + length * 0.5 + 0.0040, y + length * 0.5 + 0.0044, 0.0026, seg=16)
    part(node + "_lens", lens, (1.0, 0.05, 0.03), "dot", node, bevel=0)
    return (x + 0.004, y + length * 0.5 + 0.0045, z + 0.004)


def att_tube_ext(node):
    """Breaker magazine-tube extension (+2 shells) with a second barrel clamp."""
    def b(bm):
        cyl_y(bm, 0, 0.060, 0.700, 0.742, 0.0115, seg=28)
        cyl_y(bm, 0, 0.060, 0.742, 0.748, 0.0122, 0.0108, seg=28)          # cap
        rbox(bm, -0.0105, 0.0105, 0.722, 0.736, 0.054, 0.094)                # clamp
        cyl_x(bm, 0.729, 0.074, -0.013, 0.013, 0.0030, seg=12)
    part(node + "_tube", b, COL["anod"], "metal", node, bevel=0.0010)


def att_pike_comp(n, bz):
    def b(bm):
        rbox(bm, -0.0115, 0.0115, 0.184, 0.218, 0.034, 0.0735)

    def cut(bm):
        for k in range(3):
            yy = 0.192 + k * 0.008
            rbox(bm, -0.004, 0.004, yy, yy + 0.004, 0.060, 0.080)
        cyl_y(bm, 0, bz, 0.205, 0.222, 0.0050, seg=18)
    part(n + "_comp", b, COL["anod"], "metal", n, bevel=0.0012, seg=2, cut=cut)


def build_attachments():
    """Build every weapon's attachments into ONE glb (see the block comment above)."""
    infos = {}
    for wid in ("warden", "vesper", "corvus", "breaker", "pike"):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        PARTS.clear()
        _TEX.clear()
        materials()
        infos[wid] = gun_ar(SPECS[wid]) if wid in SPECS else (gun_breaker() if wid == "breaker" else gun_pike())
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PARTS.clear()
    _TEX.clear()
    ATT.clear()
    # plain, texture-free materials carrying only the NAME contract (runtime rebinds)
    M = {}
    for key, name, col in (("metal", "br5_metal", (0.3, 0.3, 0.3)), ("poly", "br5_polymer", (0.2, 0.2, 0.2)),
                           ("grip", "br5_polymer_grip", (0.2, 0.2, 0.2)), ("optic", "br5_optic", (0.3, 0.3, 0.3)),
                           ("dot", "br5_dot", (1.0, 0.05, 0.03)), ("lume", "br5_lume", (0.6, 0.8, 0.6)),
                           ("glass", "br5_glass", (0.02, 0.05, 0.06))):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (*col, 1)
        M[key] = m

    for wid, I in infos.items():
        bz, rt = I["bore_z"], I["rail_top"]
        if wid in SPECS:                                   # AR platform: warden / vesper / corvus
            ry0, hg1, hr, by1, br = I["ry0"], I["hg1"], I["hg_r"], I["by1"], I["br"]
            hand_y = A5_POSE[wid][1][1][1]
            if wid in ("warden", "vesper"):                # folding irons on the rail
                n = _att(wid, "irons", sight=rt + 0.020)
                iron_rear(ry0 + 0.020, rt, rt + 0.020, node=n)
                iron_front(hg1 - 0.020, rt, rt + 0.020, node=n)
                # polymer folding sights (MBUS lines), matte: a flat anodized tower face square
                # to the eye mirrored the sky as a pale slab in the ADS picture (in-game capture)
                for o, nd in PARTS:
                    if nd == n:
                        o["a5_mat"] = "grip"
                        o["a5_col"] = list(COL["poly"])
            hz = rt + 0.0335
            n = _att(wid, "holo", sight=hz)
            att_holo(wid, -0.020 if wid != "corvus" else 0.010, rt, hz, n)
            if wid == "corvus":
                dz = rt + 0.0325
                n = _att(wid, "reddot", sight=dz)
                reddot(0.000, rt, dz, node=n)
            if wid == "warden":
                sz = rt + 0.034
                n = _att(wid, "scope", sight=sz)
                scope(-0.100, 0.150, sz, rail_top=rt, node=n)
            if wid in ("warden", "corvus"):                # (the vesper's can is factory)
                L, R = (0.160, 0.0190) if wid == "warden" else (0.185, 0.0215)
                n = _att(wid, "suppressor", muzzle=(by1 - 0.002 + L, bz))
                att_can(by1 - 0.002, L, bz, R, br * 1.3, n)
            Lc = 0.050
            n = _att(wid, "compensator", muzzle=(by1 - 0.002 + Lc, bz))
            att_comp(by1 - 0.002, Lc, bz, br * 1.55, n)
            n = _att(wid, "grip")                          # ahead of the support hand
            att_grip(min(hand_y + 0.080, hg1 - 0.030), bz - hr, n)
            n = _att(wid, "laser")                         # right-side rail, up front
            ATT[n]["beam"] = att_laser(hr + 0.0105, hg1 - 0.040, bz, n)
        elif wid == "breaker":
            n = _att(wid, "reddot", sight=rt + 0.0215)
            att_minidot(0.060, 0.104, rt, rt + 0.0215, 0.0135, 0.0098, n)
            n = _att(wid, "holo", sight=rt + 0.0335)
            att_holo(wid, 0.090, rt, rt + 0.0335, n)
            L = 0.150
            n = _att(wid, "suppressor", muzzle=(0.748 + L, bz))
            att_can(0.748, L, bz, 0.0235, 0.0135, n)
            n = _att(wid, "laser")                         # clamped beside the magazine tube
            ATT[n]["beam"] = att_laser(0.0225, 0.640, 0.060, n)
            n = _att(wid, "extmag")
            att_tube_ext(n)
        else:                                               # pike
            n = _att(wid, "reddot", sight=rt + 0.0170)
            att_minidot(-0.024, 0.010, rt, rt + 0.0170, 0.0110, 0.0075, n)
            L = 0.130
            n = _att(wid, "suppressor", muzzle=(0.186 + L, bz))
            att_can(0.184, L + 0.002, bz, 0.0165, 0.0080, n)
            n = _att(wid, "compensator", muzzle=(0.218, bz))
            att_pike_comp(n, bz)
            n = _att(wid, "laser")                         # under the dust-cover rail
            ATT[n]["beam"] = att_laser(0.0, 0.140, 0.004, n, length=0.044)

    # paint, plain material, join by node
    nodes = {}
    for o, node in PARTS:
        if not o.data.vertices:
            continue
        paint(o)
        o.data.materials.clear()
        o.data.materials.append(M.get(o["a5_mat"], M["metal"]))
        bpy.context.view_layer.objects.active = o
        for so in bpy.context.selected_objects:
            so.select_set(False)
        o.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.cube_project(cube_size=0.05)
        bpy.ops.object.mode_set(mode="OBJECT")
        shade_smooth(o, 34)
        nodes.setdefault(node, []).append(o)
    joined = []
    for node, objs in nodes.items():
        for so in bpy.context.selected_objects:
            so.select_set(False)
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        if len(objs) > 1:
            bpy.ops.object.join()
        j = bpy.context.view_layer.objects.active
        j.name = node
        j.data.name = node
        joined.append(j)
    empties = []
    for node, d in ATT.items():
        if d.get("sight") is not None:
            e = bpy.data.objects.new(node + "__SIGHT", None); e.location = (0, 0, d["sight"]); link(e); empties.append(e)
        if d.get("muzzle") is not None:
            e = bpy.data.objects.new(node + "__MUZZLE", None); e.location = (0, d["muzzle"][0], d["muzzle"][1]); link(e); empties.append(e)
        if d.get("beam") is not None:
            e = bpy.data.objects.new(node + "__BEAM", None); e.location = d["beam"]; link(e); empties.append(e)
    tris = 0
    for o in joined:
        for so in bpy.context.selected_objects:
            so.select_set(False)
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        mod = o.modifiers.new("tri", "TRIANGULATE")
        bpy.ops.object.modifier_apply(modifier=mod.name)
        tris += len(o.data.polygons)
    for o in bpy.context.scene.objects:
        o.select_set(o in joined or o in empties)
    out = os.path.join(OUT_DIR, "attachments.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_apply=True, export_yup=True, export_tangents=False,
        export_vertex_color="NAME", export_vertex_color_name="Col", export_all_vertex_colors=False)
    import shutil, subprocess
    gt = shutil.which("gltf-transform")
    before = os.path.getsize(out)
    if gt:
        for attempt in range(3):
            # colour at 8 bits: the vertex paint is a dark base + wear, 8 bits is plenty
            r = subprocess.run([gt, "draco", out, out, "--quantize-position", "15",
                                "--quantize-normal", "9", "--quantize-texcoord", "10",
                                "--quantize-color", "8", "--encode-speed", "0"],
                               capture_output=True, text=True, shell=(os.name == "nt"))
            if r.returncode == 0:
                break
    rep = {"weapon": "attachments", "nodes": sorted(nodes.keys()), "tris": tris,
           "sights": {k: round(v["sight"], 4) for k, v in ATT.items() if v.get("sight") is not None},
           "bytes_raw": before, "bytes": os.path.getsize(out)}
    print("A5ATT " + json.dumps(rep))
    return rep


# ===========================================================================
# [melee] KNIFE (2026-11-13) -> assets/weapons/knife.glb
# ===========================================================================
# An original fixed-blade knife: clip-point blade with a flat grind and a honed
# bevel (real lofted cross-sections: spine, grind line, edge), spine jimping, a
# short double guard, a polymer handle with finger/palm swells and rubber grip
# bands, a steel pommel with a lanyard pin. Geometry-only like attachments.glb:
# materials carry only the generator NAME contract (br5_metal / br5_polymer_grip)
# and core/weapons/viewmodel.js binds each mesh to the gun-in-hand's own
# detail-mapped material of that name — same finish as the guns, geometry bytes
# only (menu payload). Build frame like every gun: +Y toward the point, +Z = spine
# up, +X right; origin = centre of the handle (the palm). Node "knife".
# usage: blender ... --python tools/a5_build_guns.py -- knife
KNIFE = {"y_guard": 0.058, "blade_len": 0.168, "grip_half": 0.056}


def knife_blade_sections(n=22):
    """Cross-sections along the blade: (y, t_half, z_spine, z_grind, z_edge)."""
    y0, L = KNIFE["y_guard"] + 0.0065, KNIFE["blade_len"]
    out = []
    for i in range(n + 1):
        u = i / n
        y = y0 + L * u
        zs = 0.0105 if u < 0.60 else 0.0105 - 0.0100 * ((u - 0.60) / 0.40) ** 1.25     # clip drop
        ze = -0.0150 if u < 0.52 else -0.0150 + 0.0142 * ((u - 0.52) / 0.48) ** 1.7    # belly sweep
        if u < 0.06:
            ze = -0.0128 - 0.0022 * (u / 0.06)                                          # ricasso
        zg = max(min(ze + 0.0095, zs - 0.0022), ze + 0.35 * (zs - ze))                  # grind line
        t = 0.00215 * (1.0 - 0.55 * u * u)
        out.append((y, t, zs, zg, ze))
    return out


def knife_loft(bm, secs, pick):
    """Loft a closed section [(x, z)...] = pick(t, zs, zg, ze) through secs; the last
    section collapses to one point (the tip)."""
    rings, tip = [], None
    for k, (y, t, zs, zg, ze) in enumerate(secs):
        if k == len(secs) - 1:
            tip = bm.verts.new((0.0, y + 0.0015, (zs + ze) * 0.5))
            break
        rings.append([bm.verts.new((x, y, z)) for x, z in pick(t, zs, zg, ze)])
    m = len(rings[0])
    bm.faces.new(list(reversed(rings[0])))
    for k in range(len(rings)):
        a = rings[k]
        b = rings[k + 1] if k + 1 < len(rings) else None
        for i in range(m):
            j = (i + 1) % m
            if b is None:
                bm.faces.new((a[i], a[j], tip))
            else:
                bm.faces.new((a[i], a[j], b[j], b[i]))


def build_knife():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    PARTS.clear()
    _TEX.clear()
    M = {}
    for key, name, col in (("metal", "br5_metal", (0.3, 0.3, 0.3)), ("grip", "br5_polymer_grip", (0.2, 0.2, 0.2))):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (*col, 1)
        M[key] = m
    secs = knife_blade_sections()
    part("blade", lambda bm: knife_loft(bm, secs, lambda t, zs, zg, ze: [
        (-t, zg), (t, zg), (t, zs - 0.0006), (t * 0.6, zs), (-t * 0.6, zs), (-t, zs - 0.0006)]),
        lin((44, 45, 47)), "metal", "knife", bevel=0.0, wear=0.6)
    part("edge", lambda bm: knife_loft(bm, secs, lambda t, zs, zg, ze: [(-t, zg), (0.0, ze), (t, zg)]),
         lin((150, 152, 156)), "metal", "knife", bevel=0.0, wear=0.0)
    yg, h = KNIFE["y_guard"], KNIFE["grip_half"]

    def guard(bm):
        prism_x(bm, [(yg, -0.0255), (yg + 0.0065, -0.0235), (yg + 0.0065, 0.0165), (yg, 0.0180)], -0.0085, 0.0085)
    part("guard", guard, COL["anod"], "metal", "knife", bevel=0.0009, seg=2, angle=25)

    def jimping(bm):
        for k in range(6):
            y = yg + 0.012 + k * 0.0042
            rbox(bm, -0.0016, 0.0016, y, y + 0.0019, 0.0099, 0.0116)
    part("jimping", jimping, lin((44, 45, 47)), "metal", "knife", bevel=0.0, wear=0.8)

    def handle(bm):
        n = 14
        rings = []
        for i in range(n + 1):
            u = i / n
            y = -h + 2 * h * u
            sw = 1.0 + 0.10 * math.sin(math.pi * min(1.0, u / 0.55)) - 0.07 * math.exp(-((u - 0.82) / 0.07) ** 2)
            wx, wz, r = 0.0118 * sw, 0.0158 * sw, 0.0055
            pts = []
            for q, (cx, cz) in enumerate(((wx - r, wz - r), (-(wx - r), wz - r), (-(wx - r), -(wz - r)), (wx - r, -(wz - r)))):
                for s2 in range(4):
                    a = q * math.pi / 2 + s2 * (math.pi / 2) / 3
                    pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
            rings.append([bm.verts.new((x, y, z - 0.0035 * (1 - u))) for x, z in pts])
        m = len(rings[0])
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])
        for k in range(n):
            a, b = rings[k], rings[k + 1]
            for i in range(m):
                j = (i + 1) % m
                bm.faces.new((a[i], a[j], b[j], b[i]))
    part("handle", handle, COL["odg"], "grip", "knife", bevel=0.0, wear=0.5)

    def bands(bm):
        for k in range(4):
            y = -h + 0.020 + k * 0.016
            tube_ring_y(bm, 0.0, -0.0022, y, y + 0.0035, 0.0128, 0.0150, seg=20)
    part("bands", bands, COL["rubber"], "grip", "knife", bevel=0.0)

    def pommel(bm):
        cyl_y(bm, 0.0, -0.0035, -h - 0.0105, -h + 0.002, 0.0118, 0.0130, seg=20)
        cyl_x(bm, -h - 0.0055, -0.0035, -0.0128, 0.0128, 0.0030, seg=12)
    part("pommel", pommel, COL["anod"], "metal", "knife", bevel=0.0008, seg=2, angle=30)

    objs = []
    for o, node in PARTS:
        if not o.data.vertices:
            continue
        paint(o)
        o.data.materials.clear()
        o.data.materials.append(M["grip"] if o["a5_mat"] == "grip" else M["metal"])
        bpy.context.view_layer.objects.active = o
        for so in bpy.context.selected_objects:
            so.select_set(False)
        o.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.cube_project(cube_size=0.05)
        bpy.ops.object.mode_set(mode="OBJECT")
        shade_smooth(o, 30)
        objs.append(o)
    for so in bpy.context.selected_objects:
        so.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    j.name = "knife"
    j.data.name = "knife"
    mod = j.modifiers.new("tri", "TRIANGULATE")
    bpy.ops.object.modifier_apply(modifier=mod.name)
    tris = len(j.data.polygons)
    if not NO_PREVIEW:
        sun = bpy.data.objects.new("ksun", bpy.data.lights.new("ksun", "SUN"))
        sun.data.energy = 4.0
        sun.rotation_euler = (D(50), D(10), D(-60))
        link(sun)
        cam = _g["cam_at"]((-0.42, 0.055, 0.0), (90, 0, -90), 30)
        _g["render"](os.path.join(PREV_DIR, "knife_studio_side.png"), 1600, 900)
        cam.location = (-0.24, -0.16, 0.12)
        cam.rotation_euler = (D(66), 0, D(-48))
        _g["render"](os.path.join(PREV_DIR, "knife_studio_q3.png"), 1600, 900)
    for o in bpy.context.scene.objects:
        o.select_set(o is j)
    out = os.path.join(OUT_DIR, "knife.glb")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", use_selection=True,
        export_animations=False, export_skins=False, export_morph=False,
        export_apply=True, export_yup=True, export_tangents=False,
        export_vertex_color="NAME", export_vertex_color_name="Col", export_all_vertex_colors=False)
    import shutil, subprocess
    gt = shutil.which("gltf-transform")
    before = os.path.getsize(out)
    r = None
    if gt:
        for attempt in range(3):
            r = subprocess.run([gt, "draco", out, out, "--quantize-position", "15",
                                "--quantize-normal", "9", "--quantize-texcoord", "10",
                                "--quantize-color", "8", "--encode-speed", "0"],
                               capture_output=True, text=True, shell=(os.name == "nt"))
            if r.returncode == 0:
                break
    rep = {"weapon": "knife", "tris": tris, "bytes_raw": before, "bytes": os.path.getsize(out),
           "draco": bool(r is not None and r.returncode == 0)}
    print("A5KNIFE " + json.dumps(rep))
    return rep


ids = ONLY or ["warden", "vesper", "corvus", "breaker", "pike"]
reports = [build_attachments() if w == "attachments" else build_knife() if w == "knife" else build(w) for w in ids]
print("A5DONE " + json.dumps(reports))
