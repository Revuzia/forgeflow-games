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
    "fde":    lin((88, 74, 55)),      # flat dark earth polymer / cerakote
    "fdem":   lin((80, 68, 52)),      # FDE on metal (cerakote) — slightly cooler
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
    c *= (1.0 - 0.45 * cav)[:, None]
    if kind == "metal":
        w = np.array(WEAR["metal"])
        c = c * (1 - 0.55 * edge[:, None]) + w * (0.55 * edge[:, None])
    else:
        c = c * (1.0 + 0.55 * edge)[:, None]
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
    rgba = np.concatenate([np.clip(c, 0, 1), np.ones((n, 1))], axis=1).astype(np.float32)
    ca.data.foreach_set("color", rgba.ravel())


# ---------------------------------------------------------------------------
# materials: vertex-colour albedo + tileable micro normal
# ---------------------------------------------------------------------------
_TEX = {}


def micro_normal(kind):
    if kind in _TEX:
        return _TEX[kind]
    S = 256
    if kind == "metal":     # bead-blast: fine isotropic grain + faint machining streaks
        h = 0.55 * _g["_n01"](_g["_fbm"](S, 5101, 3, 48)) + 0.25 * _g["_n01"](_g["_fbm"](S, 5111, 2, 90, aspect=6.0))
        k = 2.0
    else:                   # polymer stipple: cellular bumps
        h = _g["_n01"](_g["_fbm"](S, 5203, 2, 64)) ** 2.0 + 0.3 * _g["_n01"](_g["_fbm"](S, 5209, 2, 128))
        k = 1.6
    nx, ny, nz = _g["_height_to_normal"](h, k)
    rgba = np.stack([nx, ny, nz, np.ones_like(nx)], axis=-1)
    _TEX[kind] = _g["_save_img"]("a5_%s_normal" % kind, rgba, fmt="PNG")
    return _TEX[kind]


def materials():
    M = {}
    # names: weapon_meshes.repair() keys the colour factor on /metal|optic/ (0.85) vs 0.70
    # (judged on the studio renders: the first pass's 0.35 / 0.30 read as hammered metal and cork)
    M["metal"] = _g["_mat_vcol"]("br5_metal", 0.50, micro_normal("metal"), nstrength=0.14, metallic=0.35)
    M["poly"] = _g["_mat_vcol"]("br5_polymer", 0.62, micro_normal("metal"), nstrength=0.10, metallic=0.0)
    M["grip"] = _g["_mat_vcol"]("br5_polymer_grip", 0.74, micro_normal("poly"), nstrength=0.40, metallic=0.0)
    M["rubber"] = _g["_mat_vcol"]("br5_rubber", 0.86, micro_normal("poly"), nstrength=0.8, metallic=0.0)
    M["optic"] = _g["_mat_vcol"]("br5_optic", 0.42, micro_normal("metal"), nstrength=0.20, metallic=0.35)
    g = bpy.data.materials.get("br5_glass") or bpy.data.materials.new("br5_glass")
    g.use_nodes = True
    b = next(n for n in g.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (0.02, 0.05, 0.06, 1)
    b.inputs["Roughness"].default_value = 0.05
    M["glass"] = g
    return M


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


def flash_hider(y0, y1, z, r):
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
    part("flash_hider", b, COL["steel"], "metal", "dressing", bevel=0.0008, seg=2, cut=cut)


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
        part("muzzle_brake", brake, COL["anod"], "metal", "dressing", bevel=0.0010, cut=bcut)
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
        part("suppressor", can, COL["anod"], "metal", "dressing", bevel=0.0010, cut=ccut)

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
        part("stock", stock, furn, "poly", bevel=0.0026, seg=3, angle=25, cut=stock_cut)
    elif st["kind"] == "precision":
        y0s, y1s = st["y0"], st["y1"]

        def stock(bm):
            prism_x(bm, [(y1s, tz + 0.020), (y1s - 0.020, tz + 0.034), (y0s + 0.016, tz + 0.034),
                         (y0s, tz + 0.026), (y0s, tz - 0.080), (y0s + 0.020, tz - 0.084),
                         (y0s + 0.070, tz - 0.032), (y1s, tz - 0.024)], -0.0200, 0.0200)
            rbox(bm, -0.0215, 0.0215, y0s - 0.012, y0s + 0.002, tz - 0.082, tz + 0.030)            # buttpad
            prism_x(bm, [(y0s + 0.020, tz + 0.034), (y1s - 0.030, tz + 0.034), (y1s - 0.040, tz + 0.046),
                         (y0s + 0.030, tz + 0.048)], -0.0160, 0.0160)                               # cheek riser
        part("stock", stock, furn, "poly", bevel=0.0030, seg=3, angle=25)
    elif st["kind"] == "skeleton":
        y0s = st["y0"]

        def stock(bm):
            for zz in (tz + 0.012, tz - 0.018):
                cyl_y(bm, 0.0, zz, y0s + 0.004, ry0 - 0.004, 0.0055, seg=16)
            prism_x(bm, [(y0s, tz + 0.030), (y0s + 0.014, tz + 0.030), (y0s + 0.014, tz - 0.066),
                         (y0s, tz - 0.066)], -0.0180, 0.0180)
        part("stock", stock, furn, "poly", bevel=0.0024, seg=2)

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
        scope(spec["scope_y"][0], spec["scope_y"][1], sz, rail_top=rail_top)
    else:
        iron_rear(spec["rear_y"], rail_top, sz)
        iron_front(spec["front_y"], rail_top, sz)

    return {"bore_z": bz, "sight_z": sz, "muzzle_y": my1,
            "eject": (hw + 0.004, ry0 + 0.085, bz - 0.001)}


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

    def barrel(bm):
        cyl_y(bm, 0, bz, 0.170, 0.750, 0.0118, 0.0112, seg=28)
        rbox(bm, -0.0035, 0.0035, 0.700, 0.742, bz + 0.010, bz + 0.016)     # front sight ramp
        rbox(bm, -0.0012, 0.0012, 0.734, 0.740, bz + 0.010, 0.1237)          # blade (sight line)
    def bcut(bm):
        cyl_y(bm, 0, bz, 0.742, 0.756, 0.0092, seg=24)
    part("barrel", barrel, COL["steel"], "metal", "dressing", bevel=0.0008, cut=bcut)

    def magtube(bm):
        cyl_y(bm, 0, 0.060, 0.170, 0.700, 0.0115, seg=28)
        cyl_y(bm, 0, 0.060, 0.700, 0.716, 0.0122, 0.0110, seg=28)          # end cap
        rbox(bm, -0.0105, 0.0105, 0.672, 0.694, 0.054, bz + 0.006)          # barrel clamp
        cyl_x(bm, 0.683, 0.074, -0.013, 0.013, 0.0030, seg=12)
    part("mag_tube", magtube, COL["anod"], "metal", "dressing", bevel=0.0010)

    # ghost-ring rear on the receiver
    def rear(bm):
        rbox(bm, -0.010, 0.010, 0.120, 0.150, 0.110, 0.114)
        for x0, x1 in ((-0.0105, -0.0060), (0.0060, 0.0105)):
            prism_x(bm, [(0.128, 0.112), (0.146, 0.112), (0.142, 0.131), (0.132, 0.131)], x0, x1)
        tube_ring_y(bm, 0, 0.1237, 0.133, 0.139, 0.0044, 0.0070, seg=28)
        prism_x(bm, [(0.132, 0.112), (0.140, 0.112), (0.138, 0.118), (0.134, 0.118)], -0.0035, 0.0035)
    part("rear_sight", rear, COL["anod"], "metal", "dressing", bevel=0.0005, seg=1)

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
        prism_x(bm, [(-0.012, 0.104), (-0.060, 0.088), (-0.110, 0.080), (-0.110, -0.026), (-0.080, -0.044), (-0.058, -0.068),
                     (-0.040, -0.066), (-0.030, -0.046), (-0.022, -0.016), (-0.012, 0.030)], -0.0160, 0.0160)
    part("stock_wrist", wrist, COL["poly"], "poly", bevel=0.0045, seg=3, angle=24)

    def butt(bm):
        prism_x(bm, [(-0.100, 0.082), (-0.232, 0.066), (-0.239, 0.058), (-0.239, -0.070),
                     (-0.228, -0.078), (-0.100, -0.028)], -0.0200, 0.0200)
    def butt_cut(bm):
        for x0, x1 in ((-0.030, -0.0185), (0.0185, 0.030)):            # recessed side panels
            prism_x(bm, [(-0.130, 0.060), (-0.212, 0.050), (-0.212, -0.046), (-0.130, -0.014)], x0, x1)
    part("stock_butt", butt, COL["poly"], "poly", bevel=0.0050, seg=3, angle=24, cut=butt_cut)
    def pad(bm):
        rbox(bm, -0.0210, 0.0210, -0.252, -0.238, -0.076, 0.064)
    part("buttpad", pad, COL["rubber"], "rubber", bevel=0.0030, seg=2)
    return {"bore_z": bz, "sight_z": 0.1237, "muzzle_y": 0.750, "eject": (0.020, 0.100, 0.083)}


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

    def sights(bm):
        prism_x(bm, [(-0.042, 0.0730), (-0.028, 0.0730), (-0.030, sz + 0.0030), (-0.040, sz + 0.0030)],
                -0.0080, -0.0018)
        prism_x(bm, [(-0.042, 0.0730), (-0.028, 0.0730), (-0.030, sz + 0.0030), (-0.040, sz + 0.0030)],
                0.0018, 0.0080)
        rbox(bm, -0.0080, 0.0080, -0.042, -0.028, 0.0725, 0.0770)
        prism_x(bm, [(0.164, 0.0730), (0.176, 0.0730), (0.174, sz), (0.168, sz)], -0.0016, 0.0016)
    part("sights", sights, COL["anod"], "metal", "dressing", bevel=0.0004, seg=1)

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
    return {"bore_z": bz, "sight_z": sz, "muzzle_y": 0.186, "eject": (0.014, 0.040, 0.066)}


SPECS = {
    "warden": dict(bore_z=0.062, recv=(-0.104, 0.090), magwell=(0.060, 0.118), handguard=(0.090, 0.405),
                   hg_r=0.0270, barrel_end=0.620, muzzle="a2", muzzle_end=0.683, sight_z=0.134,
                   rear_y=-0.080, front_y=0.385, lower_z0=0.000,
                   stock=dict(kind="carbine", y_tube=-0.236, y0=-0.262, y1=-0.150),
                   mag=dict(depth=0.170, curve=0.042, half_w=0.0112, col=COL["fde"]),
                   furniture=COL["fde"], grip_col=COL["poly"]),
    "vesper": dict(bore_z=0.042, recv=(-0.095, 0.105), magwell=(0.038, 0.078), handguard=(0.105, 0.300),
                   hg_r=0.0225, barrel_end=0.330, muzzle="can", can_r=0.0185, muzzle_end=0.609,
                   sight_z=0.0997, rear_y=-0.074, front_y=0.282, lower_z0=-0.006,
                   stock=dict(kind="skeleton", y_tube=-0.120, y0=-0.253),
                   mag=dict(depth=0.120, curve=0.010, half_w=0.0095, col=COL["poly"]),
                   furniture=COL["poly"], grip_col=COL["poly"], gas_block=False),
    "corvus": dict(bore_z=0.060, k=1.08, recv=(-0.112, 0.100), magwell=(0.064, 0.128), handguard=(0.100, 0.480),
                   hg_r=0.0300, barrel_end=0.805, barrel_r=0.0100, muzzle="brake", muzzle_end=0.867,
                   sight_z=0.139, optic="scope", scope_y=(-0.110, 0.200), lower_z0=-0.004,
                   stock=dict(kind="precision", y_tube=-0.230, y0=-0.322, y1=-0.150),
                   mag=dict(depth=0.105, curve=0.012, half_w=0.0125, col=COL["poly"]),
                   furniture=COL["fde"], recv_col=COL["fdem"], hg_col=COL["fdem"], grip_col=COL["fde"]),
}

# support / trigger hand poses for THESE guns (same form as a4 ARM_POSE; seated on the
# authored handguard undersides: warden 0.062-0.027 = 0.035, vesper 0.0195, corvus 0.030,
# breaker pump 0.040)
A5_POSE = {
    "warden": [
        ("R", (0.040, -0.075, -0.040), (0.0, 1.0, 0.15), (-1.0, 0.0, 0.05),
         {"index_curl": (12, 16, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.062, 0.235, 0.026), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.62, -0.45, -0.64), "curl": (40, 70, 35), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "vesper": [
        ("R", (0.040, -0.081, -0.046), (0.0, 1.0, 0.15), (-1.0, 0.0, 0.05),
         {"index_curl": (12, 16, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.058, 0.180, 0.010), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.62, -0.45, -0.64), "curl": (44, 74, 38), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "corvus": [
        ("R", (0.040, -0.079, -0.044), (0.0, 1.0, 0.15), (-1.0, 0.0, 0.05),
         {"index_curl": (12, 16, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.064, 0.255, 0.020), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.62, -0.45, -0.64), "curl": (38, 68, 34), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "breaker": [
        ("R", (0.036, -0.112, 0.004), (0.0, 0.92, -0.38), (-1.0, 0.0, 0.0),
         {"index_curl": (10, 14, 8), "elbow_world": (0.35, -0.70, -0.62)}),
        ("L", (-0.062, 0.315, 0.032), (0.82, 0.48, -0.31), (0.35, 0.0, 0.94),
         {"elbow_world": (-0.60, -0.50, -0.62), "curl": (40, 70, 35), "thumb_rot": (0, 0, 5, 5)}),
    ],
    "pike": [
        ("R", (0.028, -0.066, 0.004), (0.0, 0.90, -0.43), (-1.0, 0.0, 0.0),
         {"index_curl": (8, 12, 6), "elbow_world": (0.20, -0.95, -0.20)}),
        ("L", (-0.043, -0.026, 0.000), (0.1, 0.7, -0.7), (1.0, 0.0, 0.0),
         {"elbow_world": (-0.35, -0.90, -0.25), "curl": (50, 70, 40), "thumb_rot": (0, 0, 5, 5)}),
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
    bz, sz = info["bore_z"], info["sight_z"]
    mz = bpy.data.objects.new("SOCKET_muzzle", None); mz.location = (0, info["muzzle_y"], bz); link(mz)
    ej = bpy.data.objects.new("SOCKET_eject", None); ej.location = info["eject"]; link(ej)
    sg = bpy.data.objects.new("SOCKET_sight", None); sg.location = (0, 0, sz); link(sg)

    tris = sum(len(p.vertices) - 2 for o in joined for p in o.data.polygons)
    print("A5GUN %s: %d tris in %s" % (wid, tris, [o.name for o in joined]))

    if not NO_PREVIEW:
        _g["previews"](wid, sz)
        studio(wid, joined, arms)

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
        export_image_quality=88, export_yup=True, export_tangents=True)
    try:
        import shutil, subprocess
        gt = shutil.which("gltf-transform")
        if gt:
            before = os.path.getsize(out)
            for attempt in range(3):           # the CLI occasionally exits non-zero on a cold npx start
                r = subprocess.run([gt, "draco", out, out, "--quantize-position", "16",
                                    "--quantize-normal", "10", "--quantize-texcoord", "13"],
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


def studio(wid, joined, arms):
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
    for a in arms:
        a.hide_render = False
    sc.camera = old_cam


ids = ONLY or ["warden", "vesper", "corvus", "breaker", "pike"]
reports = [build(w) for w in ids]
print("A5DONE " + json.dumps(reports))
