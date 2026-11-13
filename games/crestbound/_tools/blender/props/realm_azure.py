# AZURE SANCTUM props — coral fans, fluted temple columns with gold caps, clockwork gears,
# prism crystals, cloud islands.
import math
from mathutils import Vector
import propkit as K
from propkit import bm_cyl, bm_box, bm_lathe, bm_blob, bm_torus, bm_ring_slab, bm_tube_path, bm_grid, bm_ico, bm_prism_profile, bm_gear, rng, TAU, RAD

EMISSIVE_STRENGTH = 3.0
AO_SAMPLES = 24

def materials():
    M = {}

    def marble(nb):
        o = nb.coord('Object')
        warp = nb.noise(o, scale=2.0, detail=4.0, rough=0.7, dist=1.5)
        veins = nb.mapr(nb.math('ABSOLUTE', nb.math('SUBTRACT', nb.math('FRACT', nb.math('MULTIPLY', warp, 3.0)), 0.5)), 0.0, 0.06, 1.0, 0.0)
        n = nb.noise(o, scale=12.0, detail=3.0)
        col = nb.ramp(n, [(0.0, (0.80, 0.83, 0.88)), (1.0, (0.94, 0.95, 0.97))])
        col = nb.mix(nb.math('MULTIPLY', veins, 0.55), col, nb.rgb((0.40, 0.55, 0.70)))
        return {'color': col, 'rough': nb.mapr(veins, 0, 1, 0.32, 0.5), 'normal': nb.bump(n, 0.1, 0.01)}
    M['marble'] = K.make_material('a_marble', marble)

    def gold(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=9.0, detail=3.0)
        col = nb.ramp(n, [(0.0, (0.85, 0.62, 0.22)), (1.0, (1.0, 0.82, 0.40))])
        return {'color': col, 'rough': nb.mapr(n, 0, 1, 0.22, 0.4), 'metal': 1.0, 'normal': nb.bump(n, 0.08, 0.005)}
    M['gold'] = K.make_material('a_gold', gold)

    def brass(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=7.0, detail=3.0)
        scr = nb.wave(nb.mapping(o, rot=(0, 0, RAD(30))), scale=140.0, wtype='BANDS', direction='X', dist=1.0, detail=1.0)
        col = nb.ramp(n, [(0.0, (0.60, 0.42, 0.18)), (1.0, (0.85, 0.65, 0.32))])
        return {'color': col, 'rough': nb.mapr(scr, 0, 1, 0.3, 0.45), 'metal': 1.0, 'normal': nb.bump(nb.math('ADD', n, nb.math('MULTIPLY', scr, 0.2)), 0.12, 0.006)}
    M['brass'] = K.make_material('a_brass', brass)

    def steel(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=9.0, detail=3.0)
        col = nb.ramp(n, [(0.0, (0.35, 0.40, 0.48)), (1.0, (0.60, 0.66, 0.74))])
        return {'color': col, 'rough': 0.35, 'metal': 1.0, 'normal': nb.bump(n, 0.1, 0.005)}
    M['steel'] = K.make_material('a_steel', steel)

    def coral(nb):
        o = nb.coord('Object')
        pores = nb.voronoi(o, scale=28.0, feature='F1', out='Distance')
        n = nb.noise(o, scale=5.0, detail=3.0)
        base = nb.blend(0.7, nb.tint(), nb.ramp(n, [(0, (0.7, 0.6, 0.6)), (1, (1.15, 1.05, 1.0))]), 'MULTIPLY')
        col = nb.mix(nb.mapr(pores, 0.0, 0.12, 1.0, 0.0), base, nb.blend(1.0, base, nb.rgb((0.55, 0.45, 0.5)), 'MULTIPLY'))
        return {'color': col, 'rough': 0.75, 'normal': nb.bump(pores, 0.5, 0.01)}
    M['coral'] = K.make_material('a_coral', coral)

    def coralfan(nb):
        # a sea-fan card: a polar-warped voronoi net punched into alpha, fading toward the fan's rim
        uv = nb.uv('CardUV')
        u = nb.sep(uv, 'X'); v = nb.sep(uv, 'Y')
        dx = nb.math('SUBTRACT', u, 0.5)
        rr = nb.math('SQRT', nb.math('ADD', nb.math('MULTIPLY', dx, dx), nb.math('MULTIPLY', v, v)))
        ang = nb.math('ARCTAN2', v, dx)
        # `nb.vmath(...).node` is the VECTOR MATH node, not the CombineXYZ that was meant, so
        # inputs[2] was a vector socket and `= 0.0` raised TypeError — realm_azure never built once.
        cx = nb.node('ShaderNodeCombineXYZ')
        nb.put(cx.inputs[0], nb.math('MULTIPLY', ang, 5.0))
        nb.put(cx.inputs[1], nb.math('MULTIPLY', rr, 14.0))
        cx.inputs[2].default_value = 0.0
        polar = cx.outputs[0]
        edge = nb.voronoi(polar, scale=1.0, feature='DISTANCE_TO_EDGE', rand=0.8, out='Distance')
        net = nb.mapr(edge, 0.05, 0.10, 1.0, 0.0)
        rim = nb.mapr(nb.math('ADD', rr, nb.math('MULTIPLY', nb.noise(uv, 6.0, 3.0), 0.16)), 0.78, 0.96, 1.0, 0.0)
        # ribs: a few solid radial spokes so the fan reads at distance
        spokes = nb.mapr(nb.math('ABSOLUTE', nb.math('SUBTRACT', nb.math('FRACT', nb.math('MULTIPLY', ang, 2.2)), 0.5)), 0.44, 0.5, 0.0, 1.0)
        alpha = nb.math('MULTIPLY', rim, nb.math('MAXIMUM', net, nb.math('MULTIPLY', spokes, nb.mapr(rr, 0.0, 0.9, 1.0, 0.0))))
        alpha = nb.math('MULTIPLY', alpha, nb.mapr(rr, 0.02, 0.08, 0.0, 1.0))
        col = nb.blend(0.6, nb.tint(), nb.ramp(rr, [(0, (0.75, 0.6, 0.6)), (0.9, (1.15, 1.1, 1.05))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.8, 'alpha': alpha}
    M['coralfan'] = K.make_material('a_coralfan', coralfan)

    def prism(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=4.0, detail=2.0)
        z = nb.sep(o, 'Z')
        grad = nb.mapr(z, 0.0, 1.4)
        col = nb.blend(0.8, nb.tint(), nb.ramp(grad, [(0.0, (0.55, 0.75, 1.0)), (1.0, (1.0, 0.8, 1.0))]), 'MULTIPLY')
        emit = nb.blend(0.55, nb.tint(), nb.ramp(grad, [(0.0, (0.15, 0.35, 0.6)), (1.0, (0.6, 0.3, 0.6))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.06, 'emit': emit, 'normal': nb.bump(n, 0.05, 0.005)}
    M['prism'] = K.make_material('a_prism', prism)

    def cloud(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=3.0, detail=4.0, rough=0.6)
        up = nb.upmask(-0.6, 0.7)
        col = nb.ramp(up, [(0.0, (0.62, 0.72, 0.90)), (0.6, (0.90, 0.94, 1.0)), (1.0, (1.0, 1.0, 1.0))])
        col = nb.blend(0.2, col, nb.ramp(n, [(0, (0.88, 0.9, 0.95)), (1, (1.05, 1.05, 1.05))]), 'MULTIPLY')
        return {'color': col, 'rough': 1.0, 'normal': nb.bump(n, 0.3, 0.05)}
    M['cloud'] = K.make_material('a_cloud', cloud)

    def sandstone(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=8.0, detail=4.0)
        bands = nb.wave(o, scale=6.0, wtype='BANDS', direction='Z', dist=1.0, detail=2.0)
        col = nb.ramp(bands, [(0.0, (0.72, 0.62, 0.46)), (1.0, (0.86, 0.78, 0.60))])
        col = nb.blend(0.3, col, nb.ramp(n, [(0, (0.8, 0.8, 0.8)), (1, (1.1, 1.1, 1.05))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.9, 'normal': nb.bump(n, 0.3, 0.02)}
    M['sandstone'] = K.make_material('a_sandstone', sandstone)
    return M

# ----------------------------------------------------------------------------- props
def coral_fan_a(P, M):
    P.add(bm_blob(0.34, seed=61, subdiv=1, amp=0.3, freq=2.0, aniso=(1.2, 1.0, 0.5), floor=0.5), M['sandstone'], loc=(0, 0, 0.08), flat=True)
    tints = [(0.95, 0.35, 0.45), (1.0, 0.55, 0.30), (0.85, 0.30, 0.60)]
    for k, (yaw, s, x, y) in enumerate(((0.0, 1.0, 0, 0), (RAD(70), 0.75, 0.18, 0.1), (RAD(-55), 0.6, -0.15, 0.12))):
        card = bm_grid(1.3 * s, 1.15 * s)
        P.add(card, M['coralfan'], loc=(x, y, 0.15 + 0.575 * s), rot=(RAD(90), 0, yaw), card=True, tint=tints[k])
        P.add(bm_cyl(0.05 * s, 0.03 * s, 0.25 * s, 6), M['coral'], loc=(x, y, 0.05), tint=tints[k])

def coral_fan_b(P, M):
    r = rng(7)
    P.add(bm_blob(0.30, seed=62, subdiv=1, amp=0.3, freq=2.0, aniso=(1.1, 1.0, 0.5), floor=0.5), M['sandstone'], loc=(0, 0, 0.07), flat=True)
    tint = (1.0, 0.5, 0.35)

    def branch(p, d, L, rad, depth):
        pts = [Vector(p)]
        dd = Vector(d)
        for k in range(3):
            dd = (dd + Vector((r.uniform(-0.35, 0.35), r.uniform(-0.35, 0.35), 0.28))).normalized()
            pts.append(pts[-1] + dd * (L / 3.0))
        P.add(bm_tube_path(pts, [rad, rad * 0.8, rad * 0.6, rad * 0.4], 6), M['coral'], tint=tint)
        if depth > 0:
            for k in range(2):
                branch(pts[-1], dd + Vector((r.uniform(-0.8, 0.8), r.uniform(-0.8, 0.8), 0.2)), L * 0.62, rad * 0.62, depth - 1)
    for k in range(3):
        a = TAU * k / 3 + 0.4
        branch((math.cos(a) * 0.08, math.sin(a) * 0.08, 0.1), (math.cos(a) * 0.5, math.sin(a) * 0.5, 1.0), 0.55, 0.05, 2)

def temple_column(P, M, H=4.5, R=0.30):
    # base
    P.add(bm_box(R * 3.2, R * 3.2, 0.14, bevel=0.02, base=True), M['marble'])
    P.add(bm_lathe([(R * 1.45, 0.14), (R * 1.45, 0.20), (R * 1.25, 0.28), (R * 1.05, 0.34), (R, 0.40)], 24), M['marble'])
    P.add(bm_torus(R * 1.28, 0.05, 24, 7), M['gold'], loc=(0, 0, 0.24))
    # fluted shaft: 24-gon with alternating radii, three rings with entasis
    flutes = 24
    def ring(rad):
        return [((rad if k % 2 == 0 else rad * 0.92) * math.cos(TAU * k / flutes), (rad if k % 2 == 0 else rad * 0.92) * math.sin(TAU * k / flutes)) for k in range(flutes)]
    zs = [0.40, H * 0.45, H - 0.55]
    rads = [R, R * 1.02, R * 0.90]
    import bmesh
    bm = bmesh.new()
    rings = []
    for z, rad in zip(zs, rads):
        rings.append([bm.verts.new((x, y, z)) for (x, y) in ring(rad)])
    for i in range(len(rings) - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(flutes):
            j = (k + 1) % flutes
            bm.faces.new((A[k], A[j], B[j], B[k]))
    P.add(bm, M['marble'])
    # capital + gold cap
    zc = H - 0.55
    P.add(bm_lathe([(R * 0.90, zc), (R * 0.95, zc + 0.06), (R * 1.15, zc + 0.20), (R * 1.35, zc + 0.30), (R * 1.35, zc + 0.36), (0, zc + 0.36)], 24), M['marble'])
    P.add(bm_torus(R * 1.0, 0.045, 24, 7), M['gold'], loc=(0, 0, zc + 0.03))
    P.add(bm_box(R * 3.0, R * 3.0, 0.16, bevel=0.025), M['gold'], loc=(0, 0, zc + 0.44))
    P.add(bm_box(R * 3.3, R * 3.3, 0.06, bevel=0.012), M['marble'], loc=(0, 0, zc + 0.55))
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4
        P.add(bm_ico(0.06, 1), M['prism'], loc=(math.cos(a) * R * 1.35, math.sin(a) * R * 1.35, zc + 0.44), tint=(0.6, 0.9, 1.0))

def gear_clockwork(P, M, R=0.6, teeth=16, thick=0.10, spokes=6, small=False):
    P.add(bm_gear(R, teeth, thick, depth=R * 0.15, bevel=thick * 0.15), M['brass'], rot=(RAD(90), 0, 0), loc=(0, thick * 0.5, 0))
    P.add(bm_ring_slab(R * 0.58, R * 0.80, thick * 1.1, 28), M['brass'], rot=(RAD(90), 0, 0), loc=(0, thick * 0.55, 0))
    P.add(bm_ring_slab(R * 0.50, R * 0.56, thick * 1.3, 28), M['steel'], rot=(RAD(90), 0, 0), loc=(0, thick * 0.65, 0))
    hub = [(0, -thick * 0.9), (R * 0.20, -thick * 0.9), (R * 0.24, -thick * 0.5), (R * 0.24, thick * 0.5), (R * 0.20, thick * 0.9), (0, thick * 0.9)]
    P.add(bm_lathe(hub, 16), M['steel'], rot=(RAD(90), 0, 0))
    for k in range(spokes):
        a = TAU * k / spokes
        P.add(bm_box(R * 0.10, thick * 0.7, R * 0.42, bevel=thick * 0.1), M['brass'], loc=(math.cos(a) * R * 0.38, 0, math.sin(a) * R * 0.38), rot=(0, -a + RAD(90), 0))
        if not small:
            P.add(bm_ico(R * 0.045, 1), M['prism'], loc=(math.cos(a) * R * 0.67, -thick * 0.65, math.sin(a) * R * 0.67), tint=(0.7, 0.9, 1.0))
    P.add(bm_ico(R * 0.09, 2), M['prism'], loc=(0, -thick * 0.95, 0), tint=(0.6, 0.85, 1.0))

def prism_crystal(P, M, n=5, seed=3, scale=1.0):
    r = rng(seed)
    P.add(bm_blob(0.36 * scale, seed=seed, subdiv=1, amp=0.3, freq=2.0, aniso=(1.0, 1.0, 0.4), floor=0.4), M['marble'], loc=(0, 0, 0.08 * scale), flat=True)
    tints = [(0.55, 0.85, 1.0), (0.9, 0.6, 1.0), (0.6, 1.0, 0.95), (1.0, 0.7, 0.85), (0.7, 0.8, 1.0)]
    for i in range(n):
        a = TAU * i / n + r.uniform(-0.3, 0.3)
        d = 0.0 if i == 0 else r.uniform(0.10, 0.26) * scale
        H = (1.5 if i == 0 else r.uniform(0.5, 1.0)) * scale
        rad = (0.13 if i == 0 else r.uniform(0.06, 0.10)) * scale
        lean = 0.0 if i == 0 else r.uniform(0.2, 0.5)
        prof = [(0, -H * 0.1), (rad * 0.7, H * 0.08), (rad, H * 0.5), (rad * 0.8, H * 0.8), (0, H)]
        P.add(bm_lathe(prof, 6), M['prism'], loc=(math.cos(a) * d, math.sin(a) * d, 0.12 * scale),
              rot=(math.sin(a) * lean, -math.cos(a) * lean, r.uniform(0, 1)), tint=tints[i % 5], flat=True)

def cloud_island(P, M, R=2.6, seed=5, n=7):
    r = rng(seed)
    # main flat-topped mass + puffs around the rim + a couple below
    P.add(bm_blob(R, seed=seed, subdiv=2, amp=0.16, freq=1.3, aniso=(1.0, 0.85, 0.42), floor=0.35), M['cloud'], loc=(0, 0, R * 0.42 * 0.35 * 0.5))
    for i in range(n):
        a = TAU * i / n + r.uniform(-0.25, 0.25)
        d = R * r.uniform(0.62, 0.9)
        s = R * r.uniform(0.28, 0.42)
        P.add(bm_blob(s, seed=seed * 9 + i, subdiv=1, amp=0.2, freq=1.8), M['cloud'], loc=(math.cos(a) * d * 0.9, math.sin(a) * d * 0.85, s * r.uniform(0.2, 0.6)))
    for i in range(3):
        a = r.uniform(0, TAU); d = R * r.uniform(0.2, 0.5); s = R * r.uniform(0.3, 0.45)
        P.add(bm_blob(s, seed=seed * 13 + i, subdiv=1, amp=0.2, freq=1.8), M['cloud'], loc=(math.cos(a) * d, math.sin(a) * d, -s * 0.55))

def props():
    return [
        {'name': 'coral_fan_a', 'build': coral_fan_a, 'cutout': True, 'card_keep': 1.0, 'runtime': {'id': 'coral', 'h': 1.5}, 'notes': 'three sea-fan cards (alpha net) on a rock'},
        {'name': 'coral_fan_b', 'build': coral_fan_b, 'runtime': {'id': 'coral_branch', 'h': 1.2}, 'notes': 'branching tube coral'},
        {'name': 'temple_column', 'build': lambda P, M: temple_column(P, M), 'budget': 3000, 'runtime': {'id': 'pillar', 'h': 4.5}, 'notes': 'architecture: fluted marble shaft, gold cap, prism studs'},
        {'name': 'temple_column_short', 'build': lambda P, M: temple_column(P, M, H=2.4, R=0.26), 'budget': 3000, 'runtime': {'id': 'pillar_short', 'h': 2.4}, 'notes': 'architecture'},
        {'name': 'gear_clockwork', 'build': lambda P, M: gear_clockwork(P, M), 'anim': {'seconds': 14.0, 'axis': 'Y', 'name': 'spin'}, 'runtime': {'id': 'gear', 'fit': 'max'},
         'pivot': 'AXLE centre; gear in the XY plane, spins about glTF +Z (clip "spin", 14 s)', 'notes': 'brass 16-tooth, steel hub, prism jewels'},
        {'name': 'gear_clockwork_small', 'build': lambda P, M: gear_clockwork(P, M, R=0.29, teeth=12, thick=0.07, spokes=4, small=True), 'anim': {'seconds': 7.0, 'axis': 'Y', 'name': 'spin'},
         'runtime': {'id': 'gear_small', 'fit': 'max'}, 'pivot': 'AXLE centre; spins about glTF +Z (clip "spin", 7 s)'},
        {'name': 'prism_crystal', 'build': lambda P, M: prism_crystal(P, M), 'runtime': {'id': 'crystal', 'h': 1.5}, 'notes': 'five prism shards, cyan->magenta emissive gradient'},
        {'name': 'prism_crystal_small', 'build': lambda P, M: prism_crystal(P, M, n=3, seed=9, scale=0.5), 'runtime': {'id': 'crystal_small', 'h': 0.8}},
        {'name': 'cloud_island_a', 'build': lambda P, M: cloud_island(P, M), 'runtime': {'id': 'cloud', 'fit': 'max'}, 'pivot': 'island centre at the FLAT TOP level (y=0 = the walkable plane); puffs hang below',
         'notes': 'flat-topped cloud mass, rim puffs, underside puffs; decorative unless given a collider'},
        {'name': 'cloud_island_b', 'build': lambda P, M: cloud_island(P, M, R=1.5, seed=11, n=5), 'runtime': {'id': 'cloud_small', 'fit': 'max'}, 'pivot': 'island centre at the flat top level'},
    ]
