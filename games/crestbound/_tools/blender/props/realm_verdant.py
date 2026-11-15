# VERDANT BAILEY props — oak + pine (trunk / canopy cards / climbable trunk), rocks, bushes,
# mushrooms, flowerbed, stump, fence, signpost, bridge planks, windmill sails.
import math
from mathutils import Vector
import propkit as K
from propkit import bm_cyl, bm_box, bm_lathe, bm_blob, bm_torus, bm_ring_slab, bm_tube_path, bm_grid, bm_ico, bm_prism_profile, rng, TAU, RAD

EMISSIVE_STRENGTH = 2.0
AO_SAMPLES = 24

# ----------------------------------------------------------------------------- materials
def materials():
    M = {}

    def bark(nb):
        # VERTICAL fissures: bands over (angle-around-the-trunk, height) so they run up the bole on every side
        o = nb.coord('Object')
        x = nb.sep(o, 'X'); y = nb.sep(o, 'Y'); z = nb.sep(o, 'Z')
        ang = nb.math('ARCTAN2', y, x)
        cx = nb.node('ShaderNodeCombineXYZ')
        nb.put(cx.inputs[0], nb.math('MULTIPLY', ang, 1.6)); nb.put(cx.inputs[1], nb.math('MULTIPLY', z, 0.30)); cx.inputs[2].default_value = 0.0
        pv = cx.outputs[0]
        grooves = nb.wave(pv, scale=2.4, wtype='BANDS', direction='X', dist=1.4, detail=3.0, dscale=1.2, profile='SAW')
        n = nb.noise(o, scale=9.0, detail=3.0, rough=0.6)
        plates = nb.voronoi(nb.mapping(o, scale=(4.0, 4.0, 1.2)), scale=1.0, feature='DISTANCE_TO_EDGE', out='Distance')
        h = nb.math('ADD', nb.math('MULTIPLY', grooves, 0.55), nb.math('ADD', nb.math('MULTIPLY', n, 0.30), nb.math('MULTIPLY', nb.mapr(plates, 0.0, 0.12), 0.35)))
        col = nb.ramp(h, [(0.0, (0.15, 0.09, 0.05)), (0.5, (0.36, 0.23, 0.13)), (1.0, (0.55, 0.40, 0.25))])
        moss = nb.math('MULTIPLY', nb.upmask(0.3, 0.8), nb.mapr(nb.noise(o, 3.0, 2.0), 0.45, 0.7))
        col = nb.mix(moss, col, nb.rgb((0.30, 0.50, 0.17)))
        return {'color': col, 'rough': nb.mapr(h, 0, 1, 0.95, 0.75), 'normal': nb.bump(h, 0.6, 0.035)}
    M['bark'] = K.make_material('v_bark', bark)

    def leafcard(nb):
        # a SOLID lobed leaf mass (the game cuts at alpha 0.5): radial falloff + 9 sine lobes + low noise;
        # leaf clumps are painted as COLOUR variation, and only the rim gets punched with a few holes
        uv = nb.uv('CardUV')
        u = nb.sep(uv, 'X'); v = nb.sep(uv, 'Y')
        dx = nb.math('SUBTRACT', u, 0.5); dy = nb.math('SUBTRACT', v, 0.5)
        d = nb.math('SQRT', nb.math('ADD', nb.math('MULTIPLY', dx, dx), nb.math('MULTIPLY', dy, dy)))
        ang = nb.math('ARCTAN2', dy, dx)
        lobes = nb.math('MULTIPLY', nb.math('SINE', nb.math('MULTIPLY', ang, 9.0)), 0.045)
        n = nb.noise(nb.mapping(uv, scale=(3.5, 3.5, 1)), scale=1.0, detail=3.0, rough=0.6)
        edge = nb.math('ADD', d, nb.math('ADD', lobes, nb.math('MULTIPLY', nb.math('SUBTRACT', n, 0.5), 0.16)))
        body = nb.mapr(edge, 0.33, 0.38, 1.0, 0.0)
        holes = nb.voronoi(nb.mapping(uv, scale=(6, 6, 1)), scale=1.0, feature='F1', rand=1.0, out='Distance')
        rimzone = nb.mapr(d, 0.20, 0.30)
        punch = nb.math('MULTIPLY', nb.mapr(holes, 0.10, 0.14, 1.0, 0.0), rimzone)
        alpha = nb.math('MULTIPLY', body, nb.math('SUBTRACT', 1.0, punch))
        base = nb.ramp(v, [(0.0, (0.10, 0.30, 0.10)), (0.5, (0.22, 0.52, 0.16)), (1.0, (0.42, 0.72, 0.24))])
        cellc = nb.voronoi(nb.mapping(uv, scale=(5, 5, 1)), scale=1.0, feature='F1', out='Color')
        cells = nb.voronoi(nb.mapping(uv, scale=(5, 5, 1)), scale=1.0, feature='F1', out='Distance')
        cvar = nb.ramp(nb.sepc(cellc, 'Red'), [(0.0, (0.72, 0.78, 0.62)), (1.0, (1.18, 1.22, 0.98))])
        col = nb.blend(0.55, base, cvar, 'MULTIPLY')
        # each clump: lighter crown (small voronoi distance), darker creases (large) -> painted leaf balls
        clumpshade = nb.ramp(cells, [(0.0, (1.18, 1.18, 1.05)), (0.35, (1.0, 1.0, 1.0)), (0.7, (0.72, 0.76, 0.66))])
        col = nb.blend(0.7, col, clumpshade, 'MULTIPLY')
        rimdark = nb.ramp(edge, [(0.24, (1.0, 1.0, 1.0)), (0.37, (0.66, 0.70, 0.60))])
        col = nb.blend(1.0, col, rimdark, 'MULTIPLY')
        h = nb.math('SUBTRACT', 1.0, cells)
        return {'color': col, 'rough': 0.72, 'alpha': alpha, 'normal': nb.bump(h, 0.45, 0.05)}
    M['leafcard'] = K.make_material('v_leafcard', leafcard)

    def leaves(nb):
        o = nb.coord('Object')
        cells = nb.voronoi(o, scale=16.0, feature='F1', out='Distance')
        cc = nb.voronoi(o, scale=16.0, feature='F1', out='Color')
        var = nb.mapr(nb.sepc(cc, 'Green'), 0, 1, 0.8, 1.2)
        up = nb.upmask(-0.2, 0.9)
        base = nb.ramp(up, [(0.0, (0.10, 0.28, 0.10)), (1.0, (0.36, 0.66, 0.22))])
        col = nb.blend(1.0, base, nb.ramp(var, [(0.8, (0.8, 0.85, 0.7)), (1.2, (1.15, 1.15, 1.0))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.78, 'normal': nb.bump(cells, 0.5, 0.04)}
    M['leaves'] = K.make_material('v_leaves', leaves)

    def needles(nb):
        o = nb.coord('Object')
        v = nb.mapping(o, scale=(1.0, 1.0, 4.0))
        streak = nb.noise(v, scale=14.0, detail=3.0, rough=0.7)
        up = nb.upmask(-0.3, 0.8)
        base = nb.ramp(up, [(0.0, (0.07, 0.20, 0.10)), (1.0, (0.22, 0.48, 0.20))])
        col = nb.blend(0.6, base, nb.ramp(streak, [(0.3, (0.7, 0.75, 0.7)), (0.7, (1.2, 1.2, 1.0))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.82, 'normal': nb.bump(streak, 0.4, 0.02)}
    M['needles'] = K.make_material('v_needles', needles)

    def stone(nb):
        o = nb.coord('Object')
        cells = nb.voronoi(o, scale=3.2, feature='F1', out='Distance')
        cc = nb.voronoi(o, scale=3.2, feature='F1', out='Color')
        n = nb.noise(o, scale=12.0, detail=4.0, rough=0.6)
        grey = nb.ramp(nb.sepc(cc, 'Red'), [(0.0, (0.40, 0.42, 0.40)), (1.0, (0.56, 0.56, 0.52))])
        col = nb.blend(0.35, grey, nb.ramp(n, [(0.0, (0.6, 0.6, 0.6)), (1.0, (1.2, 1.15, 1.1))]), 'MULTIPLY')
        moss = nb.math('MULTIPLY', nb.upmask(0.45, 0.85), nb.mapr(nb.noise(o, 4.0, 2.0), 0.4, 0.65))
        col = nb.mix(moss, col, nb.rgb((0.28, 0.48, 0.16)))
        h = nb.math('ADD', nb.math('MULTIPLY', n, 0.5), nb.math('MULTIPLY', cells, 0.5))
        return {'color': col, 'rough': 0.86, 'normal': nb.bump(h, 0.45, 0.03)}
    M['stone'] = K.make_material('v_stone', stone)

    def wood(nb):
        o = nb.coord('Object')
        grain = nb.wave(nb.mapping(o, scale=(1, 6, 6)), scale=3.0, wtype='BANDS', direction='X', dist=1.6, detail=3.0, dscale=1.2)
        n = nb.noise(o, scale=20.0, detail=2.0)
        col = nb.ramp(grain, [(0.0, (0.38, 0.24, 0.12)), (0.5, (0.55, 0.36, 0.19)), (1.0, (0.66, 0.46, 0.26))])
        col = nb.blend(0.25, col, nb.ramp(n, [(0, (0.8, 0.8, 0.8)), (1, (1.15, 1.1, 1.05))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.70, 'normal': nb.bump(grain, 0.25, 0.01)}
    M['wood'] = K.make_material('v_wood', wood)

    def woodrings(nb):
        o = nb.coord('Object')
        rings = nb.wave(o, scale=9.0, wtype='RINGS', direction='Z', dist=0.6, detail=2.0, dscale=1.0)
        col = nb.ramp(rings, [(0.0, (0.55, 0.38, 0.20)), (1.0, (0.78, 0.60, 0.36))])
        return {'color': col, 'rough': 0.75, 'normal': nb.bump(rings, 0.3, 0.01)}
    M['woodrings'] = K.make_material('v_woodrings', woodrings)

    def iron(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=8.0, detail=3.0)
        rust = nb.mapr(nb.noise(o, 3.0, 2.0), 0.55, 0.75)
        col = nb.mix(rust, nb.ramp(n, [(0, (0.16, 0.16, 0.17)), (1, (0.30, 0.30, 0.31))]), nb.rgb((0.36, 0.17, 0.07)))
        return {'color': col, 'rough': nb.mapr(rust, 0, 1, 0.5, 0.9), 'metal': nb.mapr(rust, 0, 1, 0.95, 0.2), 'normal': nb.bump(n, 0.2, 0.01)}
    M['iron'] = K.make_material('v_iron', iron)

    def mushcap(nb):
        o = nb.coord('Object')
        spots = nb.voronoi(o, scale=11.0, feature='F1', rand=0.8, out='Distance')
        sp = nb.mapr(spots, 0.16, 0.24, 1.0, 0.0)
        base = nb.blend(0.5, nb.tint(), nb.ramp(nb.noise(o, 6.0), [(0, (0.8, 0.8, 0.8)), (1, (1.2, 1.15, 1.1))]), 'MULTIPLY')
        col = nb.mix(sp, base, nb.rgb((0.96, 0.92, 0.80)))
        return {'color': col, 'rough': nb.mapr(sp, 0, 1, 0.42, 0.7), 'normal': nb.bump(sp, 0.3, 0.02)}
    M['mushcap'] = K.make_material('v_mushcap', mushcap)

    def painted(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=12.0, detail=2.0)
        col = nb.blend(0.35, nb.tint(), nb.ramp(n, [(0, (0.85, 0.85, 0.85)), (1, (1.12, 1.12, 1.1))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.6, 'normal': nb.bump(n, 0.15, 0.01)}
    M['painted'] = K.make_material('v_painted', painted)

    def soil(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=18.0, detail=4.0, rough=0.7)
        col = nb.ramp(n, [(0.0, (0.16, 0.10, 0.06)), (1.0, (0.32, 0.22, 0.13))])
        return {'color': col, 'rough': 1.0, 'normal': nb.bump(n, 0.6, 0.02)}
    M['soil'] = K.make_material('v_soil', soil)

    def moss(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=22.0, detail=4.0, rough=0.7)
        col = nb.ramp(n, [(0.0, (0.20, 0.38, 0.12)), (1.0, (0.42, 0.62, 0.22))])
        return {'color': col, 'rough': 0.95, 'normal': nb.bump(n, 0.7, 0.02)}
    M['moss'] = K.make_material('v_moss', moss)

    def cloth(nb):
        o = nb.coord('Object')
        wx = nb.wave(o, scale=90.0, wtype='BANDS', direction='X'); wy = nb.wave(o, scale=90.0, wtype='BANDS', direction='Z')
        weave = nb.math('MULTIPLY', wx, wy)
        n = nb.noise(o, scale=2.0, detail=2.0)
        col = nb.blend(0.3, nb.rgb((0.88, 0.84, 0.70)), nb.ramp(n, [(0, (0.8, 0.78, 0.7)), (1, (1.1, 1.1, 1.05))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.92, 'normal': nb.bump(weave, 0.2, 0.005)}
    M['cloth'] = K.make_material('v_cloth', cloth)

    def rope(nb):
        o = nb.coord('Object')
        tw = nb.wave(nb.mapping(o, rot=(0, 0, RAD(35))), scale=60.0, wtype='BANDS', direction='X', dist=0.4)
        col = nb.ramp(tw, [(0.0, (0.42, 0.32, 0.18)), (1.0, (0.68, 0.55, 0.34))])
        return {'color': col, 'rough': 0.9, 'normal': nb.bump(tw, 0.5, 0.01)}
    M['rope'] = K.make_material('v_rope', rope)
    return M

# ----------------------------------------------------------------------------- helpers
def lean_trunk(bm, amount=0.16, h=6.0, seed=1):
    r = rng(seed)
    ax = r.uniform(0, TAU)
    for v in bm.verts:
        t = max(0.0, v.co.z) / h
        off = amount * math.sin(t * math.pi * 0.9) * t
        v.co.x += math.cos(ax) * off * h * 0.35
        v.co.y += math.sin(ax) * off * h * 0.35

def add_roots(P, M, n=5, R=0.62, h=1.1, seed=3, scale=1.0):
    """buttress roots: tubes swept from inside the bole, out and down, tapering into the ground"""
    r = rng(seed)
    for i in range(n):
        a = TAU * i / n + r.uniform(-0.3, 0.3)
        reach = R * (1.9 + r.uniform(0, 0.8)) * scale
        rise = h * (0.75 + r.uniform(0, 0.4)) * scale
        ca, sa = math.cos(a), math.sin(a)
        pts = [(ca * R * 0.35, sa * R * 0.35, rise), (ca * R * 0.85, sa * R * 0.85, rise * 0.55),
               (ca * R * 1.35, sa * R * 1.35, rise * 0.22), (ca * reach, sa * reach, -0.06)]
        rad = [0.30 * R, 0.24 * R, 0.16 * R, 0.06 * R]
        P.add(bm_tube_path(pts, [x * scale for x in rad], 7, caps=True), M['bark'])

def add_bough(P, M, base, yaw, pitch, length, r0, r1, seed):
    r = rng(seed)
    pts = []
    p = Vector(base)
    d = Vector((math.cos(yaw) * math.cos(pitch), math.sin(yaw) * math.cos(pitch), math.sin(pitch)))
    for k in range(4):
        pts.append(p.copy())
        d = (d + Vector((r.uniform(-0.15, 0.15), r.uniform(-0.15, 0.15), 0.22))).normalized()
        p = p + d * (length / 3.0)
    radii = [r0, r0 * 0.75, r0 * 0.5, r1]
    P.add(bm_tube_path(pts, radii, 7), M['bark'])
    return pts[-1]

def canopy_cards(P, M, centre, radius, n, seed, size=(2.6, 2.0), inner=True):
    r = rng(seed)
    for i in range(n):
        # fibonacci shell
        t = (i + 0.5) / n
        z = 1.0 - 2.0 * t * 0.85
        rad = math.sqrt(max(0.0, 1.0 - z * z))
        a = i * 2.399963 + r.uniform(-0.2, 0.2)
        p = Vector(centre) + Vector((rad * math.cos(a), rad * math.sin(a), z * 0.85)) * radius * r.uniform(0.62, 1.0)
        yaw = a + r.uniform(-0.5, 0.5)
        pitch = r.uniform(-0.35, 0.35)
        s = r.uniform(0.85, 1.2)
        card = bm_grid(size[0] * s, size[1] * s)
        # face the card outward-ish, then random roll
        P.add(card, M['leafcard'], loc=p, rot=(RAD(90) + pitch, r.uniform(-0.6, 0.6), yaw), card=True)
    if inner:
        P.add(bm_blob(radius * 0.74, seed=seed + 7, subdiv=1, amp=0.22, freq=1.6, aniso=(1.0, 1.0, 0.85)), M['leaves'], loc=centre)

# ----------------------------------------------------------------------------- props
def oak_trunk(P, M, climb=False):
    H = 7.6
    prof = [(0, 0), (0.66, 0), (0.62, 0.35), (0.55, 1.6), (0.48, 3.1), (0.40, 4.5), (0.30, 5.6), (0.16, 6.3), (0, 6.5)]
    bm = bm_lathe(prof, 16)
    lean_trunk(bm, 0.14, 6.5, seed=11)
    P.add(bm, M['bark'])
    add_roots(P, M, 5, 0.66, 1.15, seed=3)
    ends = []
    for k, (yaw, pitch, z, L) in enumerate(((0.4, 0.78, 4.1, 2.2), (2.5, 0.72, 4.5, 2.2), (4.4, 0.62, 5.0, 2.0), (1.5, 0.9, 5.7, 1.5))):
        ends.append(add_bough(P, M, (math.cos(yaw) * 0.35, math.sin(yaw) * 0.35, z), yaw, pitch, L, 0.20, 0.06, seed=20 + k))
    if climb:
        # hand-hold stubs spiralling up the bole + a vine: readable as CLIMBABLE from the ground
        for i in range(11):
            a = i * 1.9 + 0.3
            z = 0.9 + i * 0.48
            rr = 0.58 - (z / 6.5) * 0.28
            P.add(bm_cyl(0.05, 0.07, 0.38, 6), M['bark'], loc=(math.cos(a) * rr, math.sin(a) * rr, z),
                  rot=(-math.sin(a) * RAD(80), math.cos(a) * RAD(80), 0))
        pts = []
        for i in range(26):
            t = i / 25.0
            a = t * TAU * 2.2
            z = 0.2 + t * 6.0
            rr = 0.70 - (z / 6.5) * 0.30
            pts.append((math.cos(a) * rr, math.sin(a) * rr, z))
        P.add(bm_tube_path(pts, 0.045, 5), M['moss'])
    return ends

def oak_canopy(P, M):
    canopy_cards(P, M, (0.1, 0.05, 7.1), 2.6, 30, seed=41, size=(3.1, 2.4))
    canopy_cards(P, M, (1.3, 0.9, 5.7), 1.3, 7, seed=43, size=(2.2, 1.7), inner=True)
    canopy_cards(P, M, (-1.4, -0.8, 6.1), 1.2, 7, seed=45, size=(2.2, 1.7), inner=True)

def pine_trunk(P, M):
    prof = [(0, 0), (0.42, 0), (0.38, 0.4), (0.30, 3.0), (0.22, 6.0), (0.12, 8.6), (0, 9.2)]
    bm = bm_lathe(prof, 12)
    lean_trunk(bm, 0.06, 9.2, seed=5)
    P.add(bm, M['bark'])
    add_roots(P, M, 4, 0.42, 0.7, seed=9, scale=0.8)
    r = rng(77)
    for i in range(12):
        a = r.uniform(0, TAU); z = 2.2 + i * 0.55
        rr = 0.34 - (z / 9.2) * 0.2
        P.add(bm_cyl(0.03, 0.05, 0.45, 5), M['bark'], loc=(math.cos(a) * rr, math.sin(a) * rr, z),
              rot=(-math.sin(a) * RAD(75), math.cos(a) * RAD(75), 0))

def pine_tiers(P, M, tiers, mat, snow=None, seed=1):
    r = rng(seed)
    for (z, rad, h) in tiers:
        segs = 14
        prof = [(0, z + 0.12), (rad, z), (rad * 0.42, z + h * 0.55), (0, z + h)]
        bm = bm_lathe(prof, segs)
        # scallop the skirt: alternate rim verts in/down
        for v in bm.verts:
            if abs(v.co.z - z) < 1e-4 and v.co.length > 1e-4:
                a = math.atan2(v.co.y, v.co.x)
                k = int(round(a / (TAU / segs))) % segs
                if k % 2:
                    v.co.xy *= 0.86
                    v.co.z -= 0.14
                v.co.z += r.uniform(-0.05, 0.05)
        P.add(bm, mat)
        if snow is not None:
            prof2 = [(rad * 0.28, z + h * 0.62), (rad * 0.48, z + h * 0.52), (rad * 0.16, z + h * 0.88), (0, z + h + 0.05)]
            P.add(bm_lathe(prof2, segs), snow)

def pine_canopy(P, M, mat=None, snow=None):
    mat = mat or M['needles']
    tiers = [(2.6, 2.3, 1.9), (4.3, 1.95, 1.7), (5.8, 1.55, 1.5), (7.1, 1.15, 1.3), (8.2, 0.75, 1.1), (9.0, 0.38, 0.9)]
    pine_tiers(P, M, tiers, mat, snow=snow, seed=3)

def rock(P, M, r, seed, aniso, amp=0.30, floor=0.55, subdiv=2, chips=2):
    P.add(bm_blob(r, seed=seed, subdiv=subdiv, amp=amp, freq=1.5, aniso=aniso, amp2=0.06, freq2=5.0, floor=floor),
          M['stone'], loc=(0, 0, r * aniso[2] * floor * 0.98), flat=True)
    rr = rng(seed)
    for i in range(chips):
        a = rr.uniform(0, TAU); d = r * (0.85 + rr.uniform(0, 0.3))
        cr = r * rr.uniform(0.22, 0.36)
        P.add(bm_blob(cr, seed=seed * 3 + i, subdiv=1, amp=0.3, freq=2.0, floor=0.5), M['stone'],
              loc=(math.cos(a) * d, math.sin(a) * d, cr * 0.45), rot=(0, 0, rr.uniform(0, TAU)), flat=True)

def bush(P, M, lobes=5, berries=True, seed=1, scale=1.0):
    r = rng(seed)
    P.add(bm_cyl(0.05, 0.08, 0.22, 6), M['bark'], scale=scale)
    for i in range(lobes):
        a = TAU * i / lobes + r.uniform(-0.4, 0.4)
        d = 0.0 if i == 0 else r.uniform(0.14, 0.26)
        s = r.uniform(0.22, 0.32) * (1.15 if i == 0 else 1.0)
        P.add(bm_blob(s, seed=seed * 10 + i, subdiv=2, amp=0.22, freq=2.2, aniso=(1.0, 1.0, 0.85)), M['leaves'],
              loc=(math.cos(a) * d * scale, math.sin(a) * d * scale, (0.26 + r.uniform(0, 0.14) + s * 0.4) * scale), scale=scale)
    if berries:
        for i in range(8):
            a = r.uniform(0, TAU); d = r.uniform(0.18, 0.34)
            P.add(bm_ico(0.028, 1), M['painted'], loc=(math.cos(a) * d * scale, math.sin(a) * d * scale, (0.30 + r.uniform(0, 0.3)) * scale),
                  scale=scale, tint=(0.85, 0.12, 0.16))

def mushroom(P, M, count=3, seed=1, ring=False, scale=1.0):
    r = rng(seed)
    caps = [(0.86, 0.20, 0.13), (0.95, 0.55, 0.14), (0.78, 0.30, 0.42)]
    for i in range(count):
        if ring:
            a = TAU * i / count; d = 0.28
        else:
            a = TAU * i / count + r.uniform(0, 0.8); d = 0.0 if i == 0 else r.uniform(0.15, 0.24)
        s = (1.0 if (i == 0 and not ring) else r.uniform(0.45, 0.8)) * scale
        H = 0.42 * s; CR = 0.30 * s
        x, y = math.cos(a) * d * scale, math.sin(a) * d * scale
        stalk = [(0, 0), (CR * 0.44, 0), (CR * 0.40, H * 0.12), (CR * 0.25, H * 0.4), (CR * 0.24, H * 0.75), (CR * 0.33, H * 0.95), (CR * 0.30, H)]
        P.add(bm_lathe(stalk, 10), M['painted'], loc=(x, y, 0), tint=(0.92, 0.86, 0.70))
        P.add(bm_torus(CR * 0.36, 0.025 * s, 10, 5), M['painted'], loc=(x, y, H * 0.72), tint=(0.88, 0.80, 0.62))
        # a bulbous dome: underside rises to the stalk, the rim tucks under, the crown is round
        cap = [(0, H - CR * 0.20), (CR * 0.34, H - CR * 0.24), (CR * 0.72, H - CR * 0.40), (CR * 0.98, H - CR * 0.55),
               (CR * 1.02, H - CR * 0.40), (CR * 0.94, H - CR * 0.12), (CR * 0.70, H + CR * 0.16), (CR * 0.36, H + CR * 0.32), (0, H + CR * 0.38)]
        P.add(bm_lathe(cap, 16), M['mushcap'], loc=(x, y, 0), tint=caps[i % 3])
        # gills: a dark annulus under the cap
        P.add(bm_ring_slab(CR * 0.30, CR * 0.92, 0.012, 14), M['painted'], loc=(x, y, H - CR * 0.50), tint=(0.36, 0.22, 0.14))

def flowerbed(P, M):
    r = rng(0xF10)
    P.add(bm_blob(0.55, seed=4, subdiv=2, amp=0.18, freq=1.6, aniso=(1.0, 0.85, 0.28), floor=0.2), M['soil'], loc=(0, 0, 0.02))
    for i in range(4):
        a = r.uniform(0, TAU); d = r.uniform(0.3, 0.5)
        P.add(bm_blob(0.09, seed=50 + i, subdiv=1, amp=0.3, freq=2.0, floor=0.5), M['stone'], loc=(math.cos(a) * d, math.sin(a) * d, 0.05), flat=True)
    petals = [(0.95, 0.30, 0.55), (0.98, 0.80, 0.20), (0.40, 0.55, 0.95), (0.98, 0.45, 0.25)]
    for i in range(9):
        a = r.uniform(0, TAU); d = math.sqrt(r.random()) * 0.42
        x, y = math.cos(a) * d, math.sin(a) * d
        H = r.uniform(0.16, 0.30)
        lean = r.uniform(-0.3, 0.3)
        P.add(bm_cyl(0.006, 0.009, H, 5), M['painted'], loc=(x, y, 0.05), rot=(lean, lean * 0.5, 0), tint=(0.30, 0.55, 0.20))
        for k in range(2):
            la = r.uniform(0, TAU)
            P.add(bm_grid(0.04, 0.09), M['leaves'], loc=(x + math.cos(la) * 0.025, y + math.sin(la) * 0.025, 0.05 + H * r.uniform(0.3, 0.6)),
                  rot=(RAD(60), 0, la))
        pr = r.uniform(0.045, 0.065)
        # a cupped 6-petal head: scalloped rim, tilted up toward the light
        head = bm_lathe([(0, -0.006), (pr * 0.45, 0.0), (pr * 0.85, 0.014), (pr, 0.03), (pr * 0.6, 0.02), (0, 0.006)], 12)
        for v in head.verts:
            if v.co.length > pr * 0.8:
                k = int(round(math.atan2(v.co.y, v.co.x) / (TAU / 12))) % 12
                if k % 2:
                    v.co.xy *= 0.74
                    v.co.z -= 0.006
        hx = x + math.sin(lean) * H * 0.8
        P.add(head, M['painted'], loc=(hx, y, 0.05 + H), rot=(lean * 0.5, 0, r.uniform(0, 1)), tint=petals[i % 4])
        P.add(bm_lathe([(0, 0.004), (pr * 0.30, 0.012), (pr * 0.22, 0.026), (0, 0.032)], 8), M['painted'], loc=(hx, y, 0.05 + H), tint=(1.0, 0.82, 0.25))
    for i in range(7):
        a = r.uniform(0, TAU); d = math.sqrt(r.random()) * 0.48
        for k in range(3):
            ba = r.uniform(0, TAU)
            P.add(bm_cyl(0.010, 0.0, r.uniform(0.09, 0.17), 4, caps=False), M['painted'],
                  loc=(math.cos(a) * d + math.cos(ba) * 0.02, math.sin(a) * d + math.sin(ba) * 0.02, 0.04),
                  rot=(-math.sin(ba) * 0.55, math.cos(ba) * 0.55, 0), tint=(0.34, 0.62, 0.22))

def stump(P, M, moss=True, seed=1):
    r = rng(seed)
    R, H = 0.42, 0.55
    prof = [(R * 1.06, 0), (R, 0.12), (R * 0.96, H)]
    bm = bm_lathe(prof, 12)
    for v in bm.verts:
        if v.co.z > H - 1e-4:
            v.co.z += r.uniform(-0.03, 0.03)
    P.add(bm, M['bark'])
    P.add(bm_lathe([(0, H - 0.01), (R * 0.95, H - 0.01), (R * 0.95, H + 0.005), (0, H + 0.005)], 12), M['woodrings'])
    for i in range(6):
        a = TAU * i / 6 + r.uniform(-0.3, 0.3)
        L = R * r.uniform(1.4, 2.0)
        P.add(bm_cyl(0.05, 0.13, L, 6), M['bark'], loc=(math.cos(a) * R * 0.75, math.sin(a) * R * 0.75, 0.05),
              rot=(-math.sin(a) * RAD(78), math.cos(a) * RAD(78), 0))
    if moss:
        P.add(bm_blob(R * 0.5, seed=61, subdiv=1, amp=0.3, freq=2.0, aniso=(1.0, 1.0, 0.25)), M['moss'], loc=(R * 0.2, R * 0.15, H + 0.01))
        P.add(bm_blob(R * 0.4, seed=62, subdiv=1, amp=0.3, freq=2.0, aniso=(1.0, 1.0, 0.3)), M['moss'], loc=(-R * 0.8, -R * 0.2, 0.3), rot=(0, RAD(30), 0))

def fence_bay(P, M):
    L, H = 2.2, 1.25
    P.add(bm_box(0.15, 0.15, H, bevel=0.018, base=True), M['wood'], loc=(0, 0, 0))
    P.add(bm_lathe([(0, H), (0.105, H + 0.012), (0.09, H + 0.055), (0.045, H + 0.085), (0, H + 0.10)], 10), M['wood'])
    P.add(bm_torus(0.088, 0.012, 12, 5), M['iron'], loc=(0, 0, H - 0.14))
    for rh in (H * 0.34, H * 0.72):
        P.add(bm_box(0.075, L, 0.16, bevel=0.012), M['wood'], loc=(0, L * 0.5, rh))
    for k in range(4):
        y = L * (k + 1) / 5.0
        P.add(bm_box(0.045, 0.09, H * 0.82, bevel=0.008, base=True), M['wood'], loc=(0.055, y, 0.06))
        P.add(bm_cyl(0.012, 0.012, 0.06, 6), M['iron'], loc=(0.09, y, H * 0.72), rot=(0, RAD(90), 0))

def fence_post(P, M):
    H = 1.25
    P.add(bm_box(0.15, 0.15, H, bevel=0.018, base=True), M['wood'])
    P.add(bm_lathe([(0, H), (0.105, H + 0.012), (0.09, H + 0.055), (0.045, H + 0.085), (0, H + 0.10)], 10), M['wood'])
    P.add(bm_torus(0.088, 0.012, 12, 5), M['iron'], loc=(0, 0, H - 0.14))

def signpost(P, M):
    P.add(bm_lathe([(0, 0), (0.09, 0), (0.07, 0.06), (0.06, 2.1), (0.045, 2.2), (0, 2.22)], 10), M['wood'])
    P.add(bm_ico(0.07, 1), M['painted'], loc=(0, 0, 2.28), tint=(0.85, 0.65, 0.2))
    for (z, yaw, L) in ((1.62, 0.0, 0.95), (1.92, RAD(210), 0.8)):
        arrow = bm_prism_profile([(0.02, -0.14), (L - 0.18, -0.14), (L, 0.0), (L - 0.18, 0.14), (0.02, 0.14)], 0.045, base=False)
        P.add(arrow, M['wood'], loc=(0, 0, z), rot=(RAD(90), 0, yaw))
        P.add(bm_cyl(0.014, 0.014, 0.08, 6), M['iron'], loc=(math.cos(yaw) * 0.1, math.sin(yaw) * 0.1, z), rot=(0, RAD(90), yaw))
    r = rng(4)
    for i in range(3):
        a = r.uniform(0, TAU)
        P.add(bm_blob(0.1, seed=70 + i, subdiv=1, amp=0.3, freq=2.0, floor=0.5), M['stone'], loc=(math.cos(a) * 0.16, math.sin(a) * 0.16, 0.05), flat=True)

def bridge_plank(P, M):
    W, D, T = 2.0, 0.30, 0.085
    P.add(bm_box(W, D, T, bevel=0.012, base=True), M['wood'])
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.add(bm_torus(0.05, 0.012, 12, 5), M['rope'], loc=(sx * (W * 0.5 - 0.10), sy * D * 0.28, T * 0.5), rot=(0, RAD(90), 0))
        P.add(bm_cyl(0.012, 0.012, D * 0.62, 6), M['rope'], loc=(sx * (W * 0.5 - 0.10), 0, T + 0.012), rot=(RAD(90), 0, 0))

def bridge_post(P, M):
    H = 0.95
    P.add(bm_box(0.16, 0.16, H, bevel=0.02, base=True), M['wood'])
    P.add(bm_lathe([(0, H), (0.11, H + 0.01), (0.08, H + 0.06), (0, H + 0.08)], 8), M['wood'])
    P.add(bm_torus(0.095, 0.014, 12, 5), M['iron'], loc=(0, 0, H - 0.12))
    for k in range(3):
        P.add(bm_torus(0.115 - k * 0.006, 0.02, 14, 6), M['rope'], loc=(0, 0, H * 0.62 + k * 0.038))
    P.add(bm_cyl(0.02, 0.02, 0.5, 6), M['rope'], loc=(0.12, 0, H * 0.7), rot=(0, RAD(100), 0))

def windmill_sails(P, M):
    # rotor in the Blender XZ plane, axle along Blender Y (= glTF Z). pivot = axle centre.
    P.add(bm_lathe([(0, -0.30), (0.42, -0.30), (0.46, -0.10), (0.46, 0.30), (0.34, 0.40), (0, 0.42)], 14), M['wood'], rot=(RAD(-90), 0, 0))
    P.add(bm_torus(0.47, 0.03, 16, 5), M['iron'], loc=(0, -0.05, 0), rot=(RAD(90), 0, 0))
    P.add(bm_torus(0.40, 0.03, 16, 5), M['iron'], loc=(0, 0.22, 0), rot=(RAD(90), 0, 0))
    L = 7.0
    for i in range(4):
        a = TAU * i / 4
        rot = (0, -a, 0)   # rotate about Y (the axle)
        # spar
        P.add(bm_box(L, 0.12, 0.16, bevel=0.015), M['wood'], loc=(math.cos(a) * L * 0.5, 0.05, math.sin(a) * L * 0.5), rot=rot)
        # lattice: two rails + cross bars + a cloth over the outer 2/3
        for sz in (0.55, 1.65):
            P.add(bm_box(L * 0.78, 0.05, 0.06), M['wood'],
                  loc=(math.cos(a) * L * 0.57 - math.sin(a) * sz, 0.02, math.sin(a) * L * 0.57 + math.cos(a) * sz), rot=rot)
        for k in range(8):
            d = L * (0.22 + 0.76 * k / 7.0)
            P.add(bm_box(0.06, 0.05, 1.75), M['wood'],
                  loc=(math.cos(a) * d - math.sin(a) * 1.1, 0.02, math.sin(a) * d + math.cos(a) * 1.1), rot=rot)
        P.add(bm_box(L * 0.62, 0.02, 1.5), M['cloth'],
              loc=(math.cos(a) * L * 0.64 - math.sin(a) * 1.1, -0.03, math.sin(a) * L * 0.64 + math.cos(a) * 1.1), rot=rot)

def props():
    return [
        {'name': 'oak_trunk', 'build': lambda P, M: oak_trunk(P, M), 'runtime': {'kind': 'tree', 'h': 7.6, 'part': 'trunk'},
         'notes': 'oak bole + root buttresses + 4 boughs; pair with oak_canopy at the same origin'},
        {'name': 'oak_trunk_climb', 'build': lambda P, M: oak_trunk(P, M, climb=True), 'runtime': {'kind': 'tree', 'h': 7.6, 'climbable': True, 'part': 'trunk'},
         'notes': 'CLIMBABLE variant: hand-hold stubs + a mossy vine spiral read as a ladder'},
        {'name': 'oak_canopy', 'build': oak_canopy, 'cutout': True, 'card_keep': 0.5, 'runtime': {'kind': 'tree', 'part': 'canopy'},
         'pivot': 'tree base (y=0) — the canopy floats at y 4.5..9.5; place at the trunk origin',
         'notes': 'leaf-card cluster (alpha MASK, double-sided) over an inner leaf mass'},
        {'name': 'oak_tree', 'compose': ['oak_trunk', 'oak_canopy'], 'runtime': {'kind': 'tree', 'h': 9.6}, 'notes': 'trunk + canopy in one file'},
        {'name': 'oak_tree_climb', 'compose': ['oak_trunk_climb', 'oak_canopy'], 'runtime': {'kind': 'tree', 'h': 9.6, 'climbable': True}, 'notes': 'climbable trunk + canopy'},
        {'name': 'pine_trunk', 'build': pine_trunk, 'runtime': {'kind': 'tree', 'h': 9.2, 'part': 'trunk'}, 'notes': 'tall straight pine bole with branch whorls'},
        {'name': 'pine_canopy', 'build': lambda P, M: pine_canopy(P, M), 'runtime': {'kind': 'tree', 'part': 'canopy'},
         'pivot': 'tree base (y=0) — tiers from y 2.6 to 9.9', 'notes': 'six scalloped needle tiers'},
        {'name': 'pine_tree', 'compose': ['pine_trunk', 'pine_canopy'], 'runtime': {'kind': 'tree', 'h': 9.9}},
        {'name': 'rock_a', 'build': lambda P, M: rock(P, M, 0.55, 3, (1.3, 1.0, 0.75)), 'runtime': {'id': 'rock', 'fit': 'max'}, 'notes': 'faceted boulder + chips'},
        {'name': 'rock_b', 'build': lambda P, M: rock(P, M, 0.75, 8, (1.1, 1.25, 0.8), amp=0.36), 'runtime': {'id': 'rock', 'fit': 'max'}},
        {'name': 'rock_c', 'build': lambda P, M: rock(P, M, 0.42, 13, (1.6, 0.9, 0.55), amp=0.25, chips=3), 'runtime': {'id': 'rock', 'fit': 'max'}, 'notes': 'low slab'},
        {'name': 'bush', 'build': lambda P, M: bush(P, M, 5, True, 1), 'runtime': {'id': 'bush', 'h': 0.8}},
        {'name': 'bush_small', 'build': lambda P, M: bush(P, M, 3, False, 2, scale=0.62), 'runtime': {'id': 'bush_small', 'h': 0.48}},
        {'name': 'mushroom', 'build': lambda P, M: mushroom(P, M, 3, 1), 'runtime': {'id': 'mushroom', 'h': 0.55}},
        {'name': 'mushroom_ring', 'build': lambda P, M: mushroom(P, M, 5, 2, ring=True, scale=0.9), 'runtime': {'id': 'mushroom_ring', 'fit': 'max'}},
        {'name': 'flowerbed', 'build': flowerbed, 'runtime': {'id': 'flowerbed', 'fit': 'max'}, 'uv_weight': 1.3},
        {'name': 'stump', 'build': lambda P, M: stump(P, M), 'runtime': {'id': 'stump', 'h': 0.6}},
        {'name': 'fence_bay', 'build': fence_bay, 'runtime': {'kind': 'fence', 'bay': 2.2}, 'pivot': 'post base; the bay runs +Z (glTF) 2.2 m — tile it',
         'notes': 'post + 2 rails + 4 pickets'},
        {'name': 'fence_post', 'build': fence_post, 'runtime': {'kind': 'fence', 'part': 'end post'}},
        {'name': 'signpost', 'build': signpost, 'runtime': {'id': 'signpost', 'h': 2.3}},
        {'name': 'bridge_plank', 'build': bridge_plank, 'runtime': {'kind': 'bridge', 'w': 2.0}, 'pivot': 'plank centre-bottom; 2.0 wide (X) x 0.30 deep (Z)'},
        {'name': 'bridge_post', 'build': bridge_post, 'runtime': {'kind': 'bridge', 'part': 'rope post'}},
        {'name': 'windmill_sails', 'build': windmill_sails, 'anim': {'seconds': 12.0, 'axis': 'Y', 'name': 'spin'},
         'pivot': 'AXLE centre; rotor in the XY plane, spins about glTF +Z (clip "spin", 12 s loop)',
         'runtime': {'kind': 'mill', 'len': 7.0, 'arms': 4}, 'uv_weight': 2.0, 'notes': '4 lattice sails with cloth over the outer 2/3; hub + iron bands'},
    ]
