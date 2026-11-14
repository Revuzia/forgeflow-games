# EMBER FOUNDRY props — basalt columns, slag chunks with glowing seams, iron catwalk grate + rail,
# furnace vent, pipe elbows, gears, chain.
import math
from mathutils import Vector
import propkit as K
from propkit import bm_cyl, bm_box, bm_lathe, bm_blob, bm_torus, bm_ring_slab, bm_tube_path, bm_grid, bm_ico, bm_prism_profile, bm_gear, rng, TAU, RAD

EMISSIVE_STRENGTH = 4.0
AO_SAMPLES = 24

def materials():
    M = {}

    def basalt(nb):
        o = nb.coord('Object')
        cols = nb.voronoi(nb.mapping(o, scale=(3.0, 3.0, 0.4)), scale=1.0, feature='F1', out='Color')
        n = nb.noise(o, scale=9.0, detail=4.0, rough=0.65)
        edge = nb.voronoi(nb.mapping(o, scale=(3.0, 3.0, 0.4)), scale=1.0, feature='DISTANCE_TO_EDGE', out='Distance')
        base = nb.ramp(nb.sepc(cols, 'Red'), [(0.0, (0.10, 0.10, 0.11)), (1.0, (0.20, 0.19, 0.19))])
        col = nb.blend(0.4, base, nb.ramp(n, [(0, (0.7, 0.7, 0.7)), (1, (1.25, 1.2, 1.15))]), 'MULTIPLY')
        crack = nb.mapr(edge, 0.0, 0.05, 0.0, 1.0)
        col = nb.mix(nb.math('SUBTRACT', 1.0, crack), col, nb.rgb((0.05, 0.05, 0.05)))
        ash = nb.math('MULTIPLY', nb.upmask(0.5, 0.9), nb.mapr(nb.noise(o, 5.0), 0.45, 0.7))
        col = nb.mix(ash, col, nb.rgb((0.42, 0.40, 0.37)))
        h = nb.math('ADD', nb.math('MULTIPLY', n, 0.4), nb.math('MULTIPLY', crack, 0.6))
        return {'color': col, 'rough': 0.9, 'normal': nb.bump(h, 0.5, 0.03)}
    M['basalt'] = K.make_material('e_basalt', basalt)

    def slag(nb):
        o = nb.coord('Object')
        edge = nb.voronoi(o, scale=5.5, feature='DISTANCE_TO_EDGE', out='Distance')
        n = nb.noise(o, scale=14.0, detail=4.0, rough=0.7)
        seam = nb.mapr(nb.math('ADD', edge, nb.math('MULTIPLY', n, 0.05)), 0.02, 0.09, 1.0, 0.0)
        base = nb.ramp(n, [(0.0, (0.05, 0.04, 0.04)), (1.0, (0.16, 0.13, 0.12))])
        hot = nb.ramp(seam, [(0.0, (0.0, 0.0, 0.0)), (0.5, (0.9, 0.25, 0.02)), (1.0, (1.0, 0.75, 0.25))])
        col = nb.mix(seam, base, nb.rgb((0.30, 0.10, 0.03)))
        return {'color': col, 'rough': nb.mapr(seam, 0, 1, 0.85, 0.4), 'emit': hot, 'normal': nb.bump(nb.math('SUBTRACT', 1.0, seam), 0.6, 0.03)}
    M['slag'] = K.make_material('e_slag', slag)

    def iron(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=10.0, detail=3.0)
        rust = nb.mapr(nb.noise(o, 2.6, 3.0, dist=0.3), 0.52, 0.72)
        scratches = nb.wave(nb.mapping(o, rot=(0, 0, RAD(20))), scale=120.0, wtype='BANDS', direction='X', dist=1.5, detail=1.0)
        grey = nb.ramp(n, [(0, (0.14, 0.14, 0.15)), (1, (0.30, 0.29, 0.29))])
        col = nb.mix(rust, grey, nb.ramp(n, [(0, (0.30, 0.13, 0.05)), (1, (0.55, 0.26, 0.10))]))
        h = nb.math('ADD', nb.math('MULTIPLY', n, 0.6), nb.math('MULTIPLY', scratches, 0.15))
        return {'color': col, 'rough': nb.mapr(rust, 0, 1, 0.48, 0.92), 'metal': nb.mapr(rust, 0, 1, 1.0, 0.15), 'normal': nb.bump(h, 0.25, 0.01)}
    M['iron'] = K.make_material('e_iron', iron)

    def brass(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=7.0, detail=3.0)
        tarn = nb.mapr(nb.noise(o, 3.0, 2.0), 0.5, 0.75)
        col = nb.mix(tarn, nb.ramp(n, [(0, (0.72, 0.50, 0.20)), (1, (0.90, 0.68, 0.32))]), nb.rgb((0.35, 0.28, 0.14)))
        return {'color': col, 'rough': nb.mapr(tarn, 0, 1, 0.32, 0.7), 'metal': 1.0, 'normal': nb.bump(n, 0.12, 0.01)}
    M['brass'] = K.make_material('e_brass', brass)

    def glow(nb):
        # furnace throat / vent core: the tint is the emissive colour, darkened albedo
        o = nb.coord('Object')
        n = nb.noise(o, scale=12.0, detail=3.0)
        col = nb.blend(0.8, nb.tint(), nb.rgb((0.35, 0.2, 0.1)), 'MULTIPLY')
        emit = nb.blend(0.5, nb.tint(), nb.ramp(n, [(0, (0.6, 0.6, 0.6)), (1, (1.0, 1.0, 1.0))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.6, 'emit': emit}
    M['glow'] = K.make_material('e_glow', glow)

    def grate(nb):
        # bar grating: a UV-space grid punches holes (alpha) in a thin card; bars get a steel finish
        uv = nb.uv('CardUV')
        u = nb.sep(uv, 'X'); v = nb.sep(uv, 'Y')
        fu = nb.math('FRACT', nb.math('MULTIPLY', u, 20.0)); fv = nb.math('FRACT', nb.math('MULTIPLY', v, 10.0))
        bar_u = nb.mapr(nb.math('ABSOLUTE', nb.math('SUBTRACT', fu, 0.5)), 0.36, 0.40, 0.0, 1.0)
        bar_v = nb.mapr(nb.math('ABSOLUTE', nb.math('SUBTRACT', fv, 0.5)), 0.30, 0.34, 0.0, 1.0)
        alpha = nb.math('MAXIMUM', bar_u, bar_v)
        o = nb.coord('Object')
        n = nb.noise(o, scale=12.0, detail=3.0)
        col = nb.ramp(n, [(0, (0.16, 0.15, 0.15)), (1, (0.30, 0.28, 0.27))])
        return {'color': col, 'rough': 0.6, 'metal': 0.9, 'alpha': alpha}
    M['grate'] = K.make_material('e_grate', grate)

    def hazard(nb):
        o = nb.coord('Object')
        stripes = nb.wave(nb.mapping(o, rot=(0, 0, RAD(45))), scale=14.0, wtype='BANDS', direction='X', profile='SAW')
        s = nb.mapr(stripes, 0.45, 0.55)
        n = nb.noise(o, scale=9.0, detail=3.0)
        col = nb.mix(s, nb.rgb((0.95, 0.65, 0.10)), nb.rgb((0.12, 0.12, 0.12)))
        col = nb.blend(0.4, col, nb.ramp(n, [(0, (0.7, 0.7, 0.7)), (1, (1.1, 1.1, 1.1))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.7, 'metal': 0.6, 'normal': nb.bump(n, 0.2, 0.01)}
    M['hazard'] = K.make_material('e_hazard', hazard)
    return M

# ----------------------------------------------------------------------------- props
def hex_columns(P, M, cols, seed):
    r = rng(seed)
    for (x, y, h, rad, tilt) in cols:
        pts = [(rad * math.cos(TAU * k / 6 + 0.3), rad * math.sin(TAU * k / 6 + 0.3)) for k in range(6)]
        bm = bm_prism_profile(pts, h)
        # a broken top: shove the top ring a little
        for v in bm.verts:
            if v.co.z > h - 1e-4:
                v.co.z += r.uniform(-0.08, 0.08) * h * 0.3
        K.bm_bevel(bm, rad * 0.06, 1)
        P.add(bm, M['basalt'], loc=(x, y, -0.05), rot=(tilt[0], tilt[1], 0), flat=True)

def basalt_a(P, M):
    hex_columns(P, M, [
        (0, 0, 1.35, 0.26, (0, 0)), (0.42, 0.1, 1.05, 0.24, (0, 0.05)), (-0.38, 0.2, 0.85, 0.25, (0.04, -0.03)),
        (0.1, -0.44, 0.7, 0.23, (-0.05, 0)), (0.25, 0.5, 0.55, 0.22, (0, 0)), (-0.2, -0.3, 0.45, 0.2, (0.06, 0.04)),
        (0.55, -0.35, 0.4, 0.2, (0, 0)),
    ], seed=1)

def basalt_b(P, M):
    hex_columns(P, M, [
        (0, 0, 1.9, 0.30, (0.18, 0.06)), (0.55, -0.1, 1.5, 0.28, (0.16, 0.08)), (-0.5, 0.25, 1.2, 0.27, (0.2, -0.05)),
        (0.15, 0.55, 0.8, 0.24, (0.1, 0.1)), (-0.15, -0.55, 0.6, 0.24, (0.12, 0)),
    ], seed=2)
    r = rng(5)
    for i in range(4):
        a = r.uniform(0, TAU); d = r.uniform(0.6, 0.9)
        P.add(bm_blob(0.14, seed=30 + i, subdiv=1, amp=0.3, freq=2.0, floor=0.5), M['basalt'], loc=(math.cos(a) * d, math.sin(a) * d, 0.06), flat=True)

def slag_chunk(P, M, r0, seed, n=4):
    r = rng(seed)
    for i in range(n):
        a = r.uniform(0, TAU); d = 0.0 if i == 0 else r.uniform(0.3, 0.55) * r0 * 2
        s = r0 if i == 0 else r0 * r.uniform(0.35, 0.6)
        P.add(bm_blob(s, seed=seed * 7 + i, subdiv=2, amp=0.34, freq=1.7, aniso=(1.2, 1.0, 0.8), amp2=0.08, freq2=5.0, floor=0.55),
              M['slag'], loc=(math.cos(a) * d, math.sin(a) * d, s * 0.8 * 0.55), rot=(0, 0, r.uniform(0, TAU)), flat=True)

def catwalk_grate(P, M):
    W, D, T = 2.0, 1.0, 0.06
    # frame: 4 bevelled bars + 2 stiffeners under the deck, kick plates with hazard stripes
    for sy in (-1, 1):
        P.add(bm_box(W, 0.06, T, bevel=0.008), M['iron'], loc=(0, sy * (D * 0.5 - 0.03), T * 0.5))
    for sx in (-1, 1):
        P.add(bm_box(0.06, D, T, bevel=0.008), M['iron'], loc=(sx * (W * 0.5 - 0.03), 0, T * 0.5))
    for x in (-W / 6, W / 6):
        P.add(bm_box(0.05, D - 0.12, 0.05), M['iron'], loc=(x, 0, T * 0.45))
    for sy in (-1, 1):
        P.add(bm_box(W - 0.12, 0.02, 0.10, bevel=0.004), M['hazard'], loc=(0, sy * (D * 0.5 - 0.01), T + 0.05))
    # the grating itself: one double-sided card, holes punched by the alpha grid
    P.add(bm_grid(W - 0.12, D - 0.12), M['grate'], loc=(0, 0, T * 0.9), card=True)
    # bolts
    for sx in (-1, 1):
        for sy in (-1, 1):
            P.add(bm_cyl(0.022, 0.018, 0.02, 6), M['brass'], loc=(sx * (W * 0.5 - 0.03), sy * (D * 0.5 - 0.03), T))

def catwalk_rail(P, M):
    L, H = 2.0, 1.05
    for y in (-L * 0.5 + 0.05, L * 0.5 - 0.05):
        P.add(bm_cyl(0.028, 0.028, H, 8), M['iron'], loc=(0, y, 0))
        P.add(bm_box(0.12, 0.12, 0.02, bevel=0.004), M['iron'], loc=(0, y, 0.01))
        P.add(bm_lathe([(0.028, H), (0.04, H + 0.005), (0.04, H + 0.02), (0, H + 0.03)], 8), M['iron'], loc=(0, y, 0))
    P.add(bm_cyl(0.026, 0.026, L, 8), M['iron'], loc=(0, 0, H), rot=(RAD(90), 0, 0))
    P.add(bm_cyl(0.018, 0.018, L - 0.1, 6), M['iron'], loc=(0, 0, H * 0.55), rot=(RAD(90), 0, 0))
    P.add(bm_box(0.02, L - 0.1, 0.10, bevel=0.003), M['hazard'], loc=(0, 0, 0.07))
    # knee brace
    P.add(bm_box(0.03, 0.03, 0.75), M['iron'], loc=(0.0, 0.0, H * 0.32), rot=(RAD(52), 0, 0))
    P.add(bm_box(0.03, 0.03, 0.75), M['iron'], loc=(0.0, 0.0, H * 0.32), rot=(RAD(-52), 0, 0))

def furnace_vent(P, M):
    R = 0.45
    body = [(0, 0), (R * 1.08, 0), (R * 1.1, 0.06), (R, 0.10), (R, 0.42), (R * 1.06, 0.46), (R * 1.06, 0.52), (R * 0.72, 0.55), (R * 0.72, 0.50), (R * 0.62, 0.50), (0, 0.50)]
    P.add(bm_lathe(body, 20), M['iron'])
    P.add(bm_torus(R * 1.02, 0.025, 20, 6), M['iron'], loc=(0, 0, 0.26))
    # glowing throat
    P.add(bm_lathe([(0, 0.24), (R * 0.62, 0.30), (R * 0.62, 0.49), (0, 0.49)], 16), M['glow'], tint=(1.0, 0.45, 0.08))
    # grille bars + hub over the throat
    for k in range(5):
        a = TAU * k / 5
        P.add(bm_box(R * 1.3, 0.05, 0.03, bevel=0.005), M['iron'], loc=(0, 0, 0.545), rot=(0, 0, a))
    P.add(bm_cyl(0.07, 0.07, 0.05, 10), M['iron'], loc=(0, 0, 0.53))
    P.add(bm_torus(R * 0.66, 0.02, 20, 5), M['iron'], loc=(0, 0, 0.55))
    r = rng(9)
    for k in range(10):
        a = TAU * k / 10
        P.add(bm_ico(0.02, 1), M['brass'], loc=(math.cos(a) * R * 1.02, math.sin(a) * R * 1.02, 0.15))
    # feet
    for k in range(3):
        a = TAU * k / 3 + 0.5
        P.add(bm_box(0.16, 0.12, 0.05, bevel=0.006), M['iron'], loc=(math.cos(a) * R * 0.95, math.sin(a) * R * 0.95, 0.025), rot=(0, 0, a))

def flange(P, M, at, axis_rot, R):
    P.add(bm_ring_slab(R * 0.98, R * 1.55, 0.06, 16), M['iron'], loc=at, rot=axis_rot)
    for k in range(6):
        a = TAU * k / 6
        off = Vector((math.cos(a) * R * 1.3, math.sin(a) * R * 1.3, 0.06))
        m = K._mat4(at, axis_rot, 1.0)
        p = m @ off
        P.add(bm_cyl(0.02, 0.018, 0.025, 6), M['brass'], loc=p, rot=axis_rot)

def pipe_elbow(P, M):
    R = 0.17
    pts = []
    for k in range(9):
        t = k / 8.0
        a = t * math.pi * 0.5
        pts.append((R * 1.8 * (1 - math.cos(a)), 0, 0.5 + R * 1.8 * math.sin(a)))
    pts = [(0, 0, 0)] + pts + [(R * 1.8 + 0.5, 0, 0.5 + R * 1.8)]
    P.add(bm_tube_path(pts, R, 12), M['iron'])
    flange(P, M, (0, 0, 0.0), (0, 0, 0), R)
    flange(P, M, (R * 1.8 + 0.5, 0, 0.5 + R * 1.8), (0, RAD(90), 0), R)
    P.add(bm_torus(R * 1.02, 0.02, 16, 5), M['iron'], loc=(R * 1.8 * 0.5, 0, 0.5 + R * 1.8 * 0.5), rot=(0, RAD(45), 0))

def pipe_straight(P, M):
    R = 0.17
    L = 2.4
    P.add(bm_cyl(R, R, L, 12), M['iron'], rot=(RAD(90), 0, 0), loc=(0, L * 0.5, R * 1.6))
    flange(P, M, (0, 0.12, R * 1.6), (RAD(-90), 0, 0), R)
    flange(P, M, (0, L - 0.12, R * 1.6), (RAD(-90), 0, 0), R)
    # wall/floor brackets
    for y in (L * 0.3, L * 0.7):
        P.add(bm_box(0.08, 0.10, R * 1.6, bevel=0.006, base=True), M['iron'], loc=(0, y, 0))
        P.add(bm_torus(R * 1.02, 0.025, 14, 5), M['iron'], loc=(0, y, R * 1.6), rot=(RAD(90), 0, 0))
    # valve wheel on top
    P.add(bm_cyl(R * 0.36, R * 0.44, 0.2, 10), M['iron'], loc=(0, L * 0.5, R * 2.5))
    P.add(bm_torus(R * 0.95, 0.022, 16, 6), M['brass'], loc=(0, L * 0.5, R * 1.6 + 0.35))
    for k in range(4):
        P.add(bm_cyl(0.015, 0.015, R * 1.9, 5), M['brass'], loc=(0, L * 0.5, R * 1.6 + 0.35), rot=(RAD(90), 0, TAU * k / 4))

def gear(P, M, R=0.6, teeth=14, thick=0.13, spokes=5, small=False):
    # lies in the Blender XZ plane (face normal = axle = Blender Y = glTF Z); pivot at the axle
    P.add(bm_gear(R, teeth, thick, depth=R * 0.17, bevel=thick * 0.12), M['iron'], rot=(RAD(90), 0, 0), loc=(0, thick * 0.5, 0))
    # inner disc cut-out look: a ring + spokes + hub
    P.add(bm_ring_slab(R * 0.62, R * 0.80, thick * 1.05, 24), M['iron'], rot=(RAD(90), 0, 0), loc=(0, thick * 0.52, 0))
    hub = [(0, -thick * 0.9), (R * 0.22, -thick * 0.9), (R * 0.26, -thick * 0.5), (R * 0.26, thick * 0.5), (R * 0.22, thick * 0.9), (0, thick * 0.9)]
    P.add(bm_lathe(hub, 14), M['brass'], rot=(RAD(90), 0, 0))
    P.add(bm_cyl(R * 0.10, R * 0.10, thick * 2.4, 8), M['iron'], rot=(RAD(90), 0, 0), loc=(0, thick * 1.2, 0))
    for k in range(spokes):
        a = TAU * k / spokes
        P.add(bm_box(R * 0.13, thick * 0.75, R * 0.5, bevel=thick * 0.1), M['iron'], loc=(math.cos(a) * R * 0.45, 0, math.sin(a) * R * 0.45), rot=(0, -a + RAD(90), 0))
        P.add(bm_cyl(R * 0.05, R * 0.05, thick * 1.1, 6), M['brass'], loc=(math.cos(a) * R * 0.71, 0, math.sin(a) * R * 0.71), rot=(RAD(90), 0, 0))
    if not small:
        for k in range(spokes):
            a = TAU * k / spokes + math.pi / spokes
            P.add(bm_cyl(R * 0.03, R * 0.03, thick * 1.2, 5), M['brass'], loc=(math.cos(a) * R * 0.71, 0, math.sin(a) * R * 0.71), rot=(RAD(90), 0, 0))

def chain(P, M):
    # hanging chain: interlocked torus links, a top shackle, a bottom hook. origin at the BOTTOM tip.
    pitch = 0.20
    n = 12
    z0 = 0.16
    for i in range(n):
        z = z0 + i * pitch
        P.add(bm_torus(0.075, 0.018, 12, 6), M['iron'], loc=(0, 0, z), rot=(RAD(90), 0, (i % 2) * RAD(90)))
    top = z0 + n * pitch - 0.02
    P.add(bm_box(0.18, 0.05, 0.06, bevel=0.01), M['iron'], loc=(0, 0, top + 0.06))
    P.add(bm_cyl(0.02, 0.02, 0.2, 6), M['brass'], loc=(0, 0, top + 0.06), rot=(0, RAD(90), 0))
    # hook at the bottom
    pts = [(0, 0, z0), (0, 0, 0.10), (0.03, 0, 0.05), (0.07, 0, 0.03), (0.10, 0, 0.06), (0.11, 0, 0.11)]
    P.add(bm_tube_path(pts, [0.02, 0.02, 0.02, 0.018, 0.015, 0.01], 7), M['iron'])

def props():
    return [
        {'name': 'basalt_rock_a', 'build': basalt_a, 'runtime': {'id': 'lavaRock', 'fit': 'max'}, 'notes': 'columnar basalt cluster (7 hex columns)'},
        {'name': 'basalt_rock_b', 'build': basalt_b, 'runtime': {'id': 'lavaRock', 'fit': 'max'}, 'notes': 'leaning basalt columns + rubble'},
        {'name': 'slag_chunk_a', 'build': lambda P, M: slag_chunk(P, M, 0.34, 3), 'runtime': {'id': 'lavaRock', 'fit': 'max'}, 'notes': 'obsidian slag with glowing seams (emissive)'},
        {'name': 'slag_chunk_b', 'build': lambda P, M: slag_chunk(P, M, 0.48, 8, n=3), 'runtime': {'id': 'lavaRock', 'fit': 'max'}},
        {'name': 'catwalk_grate', 'build': catwalk_grate, 'cutout': True, 'card_keep': 1.0, 'runtime': {'kind': 'deck', 'w': 2.0, 'd': 1.0},
         'pivot': 'deck underside centre; 2.0 (X) x 1.0 (Z) x 0.06', 'notes': 'iron frame + hazard kick plates; the grating is an alpha-punched card (MASK)'},
        {'name': 'catwalk_rail', 'build': catwalk_rail, 'runtime': {'kind': 'rail', 'len': 2.0}, 'pivot': 'floor centre; runs +/-1.0 along Z', 'notes': 'posts + 2 rails + kick plate + knee braces'},
        {'name': 'furnace_vent', 'build': furnace_vent, 'runtime': {'id': 'lavavent', 'h': 0.55}, 'notes': 'iron housing, glowing throat (emissive), grille'},
        {'name': 'pipe_elbow', 'build': pipe_elbow, 'runtime': {'id': 'pipe', 'fit': 'max'}, 'pivot': 'bottom flange centre; rises +Y then turns +X', 'notes': 'r 0.17 flanged 90° elbow'},
        {'name': 'pipe_straight', 'build': pipe_straight, 'runtime': {'id': 'pipe', 'fit': 'max'}, 'pivot': 'floor at the first bracket; runs +Z (glTF) 2.4 m', 'notes': 'flanged run with brackets + valve wheel'},
        {'name': 'gear', 'build': lambda P, M: gear(P, M), 'anim': {'seconds': 10.0, 'axis': 'Y', 'name': 'spin'}, 'runtime': {'id': 'gear', 'fit': 'max'},
         'pivot': 'AXLE centre; gear in the XY plane, spins about glTF +Z (clip "spin", 10 s)', 'notes': 'iron 14-tooth wheel, brass hub + bolts'},
        {'name': 'gear_small', 'build': lambda P, M: gear(P, M, R=0.3, teeth=10, thick=0.09, spokes=4, small=True), 'anim': {'seconds': 6.0, 'axis': 'Y', 'name': 'spin'},
         'runtime': {'id': 'gear_small', 'fit': 'max'}, 'pivot': 'AXLE centre; spins about glTF +Z (clip "spin", 6 s)'},
        {'name': 'chain', 'build': chain, 'runtime': {'id': 'chain', 'h': 2.8}, 'pivot': 'hook tip (y=0); hangs UP to y 2.7 — hang it from its top shackle', 'notes': '12 interlocked links + shackle + hook'},
    ]
