# RIME SPIRE props — snow pines, icicle clusters, snowdrifts, ice crystals, lantern posts,
# cottage roof modules, a snowy rock.
import math
from mathutils import Vector
import propkit as K
from propkit import bm_cyl, bm_box, bm_lathe, bm_blob, bm_torus, bm_ring_slab, bm_tube_path, bm_grid, bm_ico, bm_prism_profile, rng, TAU, RAD
import realm_verdant as V

EMISSIVE_STRENGTH = 3.0
AO_SAMPLES = 24

def materials():
    M = {}

    def snow(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=6.0, detail=3.0, rough=0.5)
        fine = nb.noise(o, scale=40.0, detail=2.0)
        cav = nb.mapr(nb.geo('Pointiness'), 0.35, 0.65)
        col = nb.ramp(cav, [(0.0, (0.66, 0.76, 0.90)), (0.5, (0.86, 0.91, 0.97)), (1.0, (0.98, 0.99, 1.0))])
        col = nb.blend(0.25, col, nb.ramp(n, [(0, (0.85, 0.9, 1.0)), (1, (1.05, 1.05, 1.05))]), 'MULTIPLY')
        sparkle = nb.mapr(fine, 0.72, 0.8)
        return {'color': col, 'rough': nb.mapr(sparkle, 0, 1, 0.75, 0.3), 'normal': nb.bump(nb.math('ADD', n, nb.math('MULTIPLY', fine, 0.4)), 0.35, 0.02)}
    M['snow'] = K.make_material('r_snow', snow)

    def barkfrost(nb):
        o = nb.coord('Object')
        v = nb.mapping(o, scale=(2.2, 2.2, 0.45))
        grooves = nb.wave(v, scale=6.0, wtype='BANDS', direction='Z', dist=2.2, detail=3.0, dscale=1.4, profile='SAW')
        n = nb.noise(o, scale=9.0, detail=3.0, rough=0.6)
        h = nb.math('MULTIPLY_ADD', grooves, 0.7, nb.math('MULTIPLY', n, 0.5))
        col = nb.ramp(h, [(0.0, (0.13, 0.09, 0.07)), (0.5, (0.26, 0.19, 0.14)), (1.0, (0.40, 0.32, 0.25))])
        frost = nb.math('MULTIPLY', nb.upmask(0.25, 0.75), nb.mapr(nb.noise(o, 4.0, 2.0), 0.35, 0.6))
        col = nb.mix(frost, col, nb.rgb((0.85, 0.90, 0.97)))
        return {'color': col, 'rough': 0.85, 'normal': nb.bump(h, 0.55, 0.03)}
    M['bark'] = K.make_material('r_bark', barkfrost)

    def needles(nb):
        o = nb.coord('Object')
        streak = nb.noise(nb.mapping(o, scale=(1.0, 1.0, 4.0)), scale=14.0, detail=3.0, rough=0.7)
        up = nb.upmask(-0.3, 0.8)
        base = nb.ramp(up, [(0.0, (0.06, 0.16, 0.14)), (1.0, (0.18, 0.40, 0.32))])
        col = nb.blend(0.6, base, nb.ramp(streak, [(0.3, (0.7, 0.75, 0.75)), (0.7, (1.2, 1.2, 1.1))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.82, 'normal': nb.bump(streak, 0.4, 0.02)}
    M['needles'] = K.make_material('r_needles', needles)

    def ice(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=5.0, detail=3.0, rough=0.6)
        veins = nb.mapr(nb.voronoi(o, scale=6.0, feature='DISTANCE_TO_EDGE', out='Distance'), 0.0, 0.04, 1.0, 0.0)
        col = nb.ramp(n, [(0.0, (0.55, 0.78, 0.92)), (1.0, (0.82, 0.94, 1.0))])
        col = nb.mix(nb.math('MULTIPLY', veins, 0.6), col, nb.rgb((0.95, 0.99, 1.0)))
        emit = nb.blend(0.6, nb.tint(), nb.ramp(n, [(0, (0.15, 0.30, 0.45)), (1, (0.30, 0.55, 0.75))]), 'MULTIPLY')
        return {'color': col, 'rough': nb.mapr(n, 0, 1, 0.08, 0.28), 'emit': emit, 'normal': nb.bump(nb.math('ADD', n, veins), 0.25, 0.02)}
    M['ice'] = K.make_material('r_ice', ice)

    def irondark(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=10.0, detail=3.0)
        col = nb.ramp(n, [(0, (0.08, 0.08, 0.09)), (1, (0.20, 0.20, 0.22))])
        frost = nb.math('MULTIPLY', nb.upmask(0.45, 0.85), nb.mapr(nb.noise(o, 6.0), 0.4, 0.6))
        col = nb.mix(frost, col, nb.rgb((0.8, 0.86, 0.95)))
        return {'color': col, 'rough': nb.mapr(frost, 0, 1, 0.45, 0.9), 'metal': nb.mapr(frost, 0, 1, 0.9, 0.0), 'normal': nb.bump(n, 0.2, 0.01)}
    M['iron'] = K.make_material('r_iron', irondark)

    def glass(nb):
        o = nb.coord('Object')
        n = nb.noise(o, scale=8.0, detail=2.0)
        col = nb.blend(0.5, nb.tint(), nb.rgb((0.8, 0.6, 0.3)), 'MULTIPLY')
        emit = nb.blend(0.3, nb.tint(), nb.ramp(n, [(0, (0.8, 0.8, 0.8)), (1, (1.0, 1.0, 1.0))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.2, 'emit': emit}
    M['glass'] = K.make_material('r_glass', glass)

    def shingles(nb):
        o = nb.coord('Object')
        # rows of wooden shingles: brick pattern in the roof's local XZ (rows along Z)
        v = nb.mapping(o, rot=(RAD(90), 0, 0))
        bcol, bfac = nb.brick(v, scale=1.0, mortar=0.02, w=0.36, h=0.22, c1=(0.36, 0.26, 0.18), c2=(0.30, 0.20, 0.13), m=(0.14, 0.09, 0.06), offset=0.5)
        n = nb.noise(o, scale=16.0, detail=3.0)
        col = nb.blend(0.35, bcol, nb.ramp(n, [(0, (0.75, 0.75, 0.75)), (1, (1.15, 1.1, 1.05))]), 'MULTIPLY')
        frost = nb.math('MULTIPLY', nb.upmask(0.5, 0.9), nb.mapr(nb.noise(o, 3.0), 0.45, 0.65))
        col = nb.mix(frost, col, nb.rgb((0.85, 0.9, 0.97)))
        return {'color': col, 'rough': 0.8, 'normal': nb.bump(nb.math('SUBTRACT', 1.0, bfac), 0.6, 0.02)}
    M['shingles'] = K.make_material('r_shingles', shingles)

    def stone(nb):
        o = nb.coord('Object')
        cc = nb.voronoi(o, scale=3.0, feature='F1', out='Color')
        n = nb.noise(o, scale=12.0, detail=4.0, rough=0.6)
        grey = nb.ramp(nb.sepc(cc, 'Red'), [(0.0, (0.36, 0.39, 0.44)), (1.0, (0.52, 0.55, 0.60))])
        col = nb.blend(0.35, grey, nb.ramp(n, [(0.0, (0.6, 0.6, 0.65)), (1.0, (1.2, 1.15, 1.1))]), 'MULTIPLY')
        return {'color': col, 'rough': 0.85, 'normal': nb.bump(n, 0.45, 0.03)}
    M['stone'] = K.make_material('r_stone', stone)

    def wood(nb):
        o = nb.coord('Object')
        grain = nb.wave(nb.mapping(o, scale=(1, 6, 6)), scale=3.0, wtype='BANDS', direction='X', dist=1.6, detail=3.0, dscale=1.2)
        col = nb.ramp(grain, [(0.0, (0.30, 0.20, 0.12)), (0.5, (0.45, 0.31, 0.18)), (1.0, (0.56, 0.40, 0.24))])
        return {'color': col, 'rough': 0.72, 'normal': nb.bump(grain, 0.25, 0.01)}
    M['wood'] = K.make_material('r_wood', wood)
    return M

# ----------------------------------------------------------------------------- props
def pine_snow_canopy(P, M):
    tiers = [(2.6, 2.3, 1.9), (4.3, 1.95, 1.7), (5.8, 1.55, 1.5), (7.1, 1.15, 1.3), (8.2, 0.75, 1.1), (9.0, 0.38, 0.9)]
    V.pine_tiers(P, M, tiers, M['needles'], snow=M['snow'], seed=3)

def pine_snow_trunk(P, M):
    prof = [(0, 0), (0.42, 0), (0.38, 0.4), (0.30, 3.0), (0.22, 6.0), (0.12, 8.6), (0, 9.2)]
    bm = bm_lathe(prof, 12)
    V.lean_trunk(bm, 0.06, 9.2, seed=5)
    P.add(bm, M['bark'])
    V.add_roots(P, M, 4, 0.42, 0.7, seed=9, scale=0.8)
    # snow collar on the roots
    P.add(bm_blob(0.62, seed=17, subdiv=1, amp=0.25, freq=2.0, aniso=(1.0, 1.0, 0.22)), M['snow'], loc=(0, 0, 0.12))

def icicle_cluster(P, M, n=7, spread=0.42, seed=1, bar=False):
    # origin at the TOP (attachment); spikes hang to -y
    r = rng(seed)
    if bar:
        P.add(bm_box(spread * 2.2, 0.16, 0.10, bevel=0.01), M['ice'], loc=(0, 0, -0.05), tint=(0.9, 0.95, 1.0))
    else:
        P.add(bm_blob(spread * 0.95, seed=seed, subdiv=1, amp=0.3, freq=2.0, aniso=(1.0, 0.8, 0.22)), M['ice'], loc=(0, 0, -0.03), flat=True, tint=(0.9, 0.95, 1.0))
    for i in range(n):
        if bar:
            x = -spread + 2 * spread * (i + 0.5) / n; y = r.uniform(-0.05, 0.05)
        else:
            a = r.uniform(0, TAU); d = math.sqrt(r.random()) * spread
            x, y = math.cos(a) * d, math.sin(a) * d
        L = r.uniform(0.28, 0.95)
        rad = r.uniform(0.03, 0.065)
        bm = bm_lathe([(0, -L), (rad * 0.35, -L * 0.55), (rad, -0.02), (rad * 1.3, 0.0), (0, 0.02)], 7)
        P.add(bm, M['ice'], loc=(x, y, -0.02), rot=(r.uniform(-0.08, 0.08), r.uniform(-0.08, 0.08), 0), tint=(0.6, 0.85, 1.0))

def snowdrift(P, M, seed=4):
    r = rng(seed)
    wind = 0.6
    for i in range(3):
        t = i / 2.0
        s = 0.66 - t * 0.28
        P.add(bm_blob(s, seed=seed * 5 + i, subdiv=3, amp=0.14, freq=1.4, aniso=(1.5, 1.0, 0.36), amp2=0.03, freq2=4.0, floor=0.15),
              M['snow'], loc=(math.sin(wind) * t * 0.75, math.cos(wind) * t * 0.75, s * 0.36 * 0.14), rot=(0, 0, wind + r.uniform(-0.3, 0.3)))
    P.add(bm_blob(0.34, seed=99, subdiv=2, amp=0.2, freq=2.0, aniso=(1.2, 1.0, 0.5), floor=0.3), M['snow'], loc=(-0.55, 0.3, 0.05))

def ice_crystal(P, M, n=6, seed=2, scale=1.0):
    r = rng(seed)
    P.add(bm_blob(0.42 * scale, seed=seed, subdiv=1, amp=0.3, freq=2.0, aniso=(1.0, 1.0, 0.45), floor=0.4), M['stone'], loc=(0, 0, 0.1 * scale), flat=True)
    for i in range(n):
        a = TAU * i / n + r.uniform(-0.3, 0.3)
        d = 0.0 if i == 0 else r.uniform(0.12, 0.30) * scale
        H = (1.2 if i == 0 else r.uniform(0.45, 0.9)) * scale
        rad = (0.14 if i == 0 else r.uniform(0.06, 0.11)) * scale
        lean = 0.0 if i == 0 else r.uniform(0.15, 0.45)
        prof = [(0, 0), (rad * 0.8, 0.02), (rad, H * 0.6), (rad * 0.55, H * 0.88), (0, H)]
        bm = bm_lathe(prof, 6)
        tint = (0.55 + r.uniform(0, 0.3), 0.85, 1.0)
        P.add(bm, M['ice'], loc=(math.cos(a) * d, math.sin(a) * d, 0.08 * scale), rot=(math.sin(a) * lean, -math.cos(a) * lean, r.uniform(0, 1)), tint=tint, flat=True)

def lantern_post(P, M):
    H = 2.4
    P.add(bm_lathe([(0, 0), (0.14, 0), (0.12, 0.05), (0.07, 0.12), (0.045, 0.3), (0.045, H - 0.2), (0.06, H - 0.1), (0.04, H), (0, H)], 10), M['iron'])
    P.add(bm_torus(0.062, 0.012, 10, 5), M['iron'], loc=(0, 0, 0.35))
    # curled arm
    pts = [(0.03, 0, H - 0.25), (0.20, 0, H - 0.05), (0.40, 0, H + 0.03), (0.55, 0, H - 0.02), (0.60, 0, H - 0.12)]
    P.add(bm_tube_path(pts, [0.03, 0.028, 0.025, 0.02, 0.016], 6), M['iron'])
    P.add(bm_tube_path([(0.60, 0, H - 0.12), (0.60, 0, H - 0.26)], 0.006, 5), M['iron'])
    # the lantern box
    cx, cz = 0.60, H - 0.62
    for k in range(4):
        a = TAU * k / 4 + math.pi / 4
        P.add(bm_box(0.018, 0.018, 0.40, bevel=0.003, base=True), M['iron'], loc=(cx + math.cos(a) * 0.115, math.sin(a) * 0.115, cz), rot=(0, 0, a))
    P.add(bm_lathe([(0, cz + 0.40), (0.17, cz + 0.42), (0.14, cz + 0.50), (0.06, cz + 0.55), (0.03, cz + 0.62), (0, cz + 0.62)], 4), M['iron'], loc=(cx, 0, 0), rot=(0, 0, math.pi / 4))
    P.add(bm_lathe([(0, cz - 0.03), (0.16, cz - 0.03), (0.16, cz + 0.02), (0.12, cz + 0.04), (0, cz + 0.04)], 4), M['iron'], loc=(cx, 0, 0), rot=(0, 0, math.pi / 4))
    P.add(bm_lathe([(0, cz + 0.04), (0.108, cz + 0.04), (0.108, cz + 0.40), (0, cz + 0.40)], 4), M['glass'], loc=(cx, 0, 0), rot=(0, 0, math.pi / 4), tint=(1.0, 0.75, 0.35))
    P.add(bm_cyl(0.04, 0.04, 0.16, 8), M['glass'], loc=(cx, 0, cz + 0.12), tint=(1.0, 0.9, 0.6))
    # snow caps
    P.add(bm_blob(0.19, seed=21, subdiv=1, amp=0.25, freq=2.0, aniso=(1.0, 1.0, 0.35)), M['snow'], loc=(cx, 0, cz + 0.58))
    P.add(bm_blob(0.32, seed=22, subdiv=1, amp=0.25, freq=2.0, aniso=(1.0, 1.0, 0.25)), M['snow'], loc=(0, 0, 0.06))

def cottage_roof_module(P, M):
    # a 3.0 (X) x 2.2 (slope) gable slab at 35°, shingle rows stepped, snow on top. origin at the EAVE line, floor y=0.
    W, S, pitch = 3.0, 2.2, RAD(35)
    rows = 7
    for i in range(rows):
        t = i / rows
        L = S / rows
        y = t * S * math.cos(pitch); z = t * S * math.sin(pitch)
        P.add(bm_box(W + 0.06, L * 1.18, 0.06, bevel=0.008), M['shingles'],
              loc=(0, y + L * 0.5 * math.cos(pitch), z + L * 0.5 * math.sin(pitch) + 0.03), rot=(pitch, 0, 0))
    for x in (-W * 0.5 + 0.1, 0, W * 0.5 - 0.1):
        P.add(bm_box(0.12, S, 0.14, bevel=0.01), M['wood'], loc=(x, S * 0.5 * math.cos(pitch), S * 0.5 * math.sin(pitch) - 0.09), rot=(pitch, 0, 0))
    P.add(bm_box(W + 0.1, 0.10, 0.20, bevel=0.01), M['wood'], loc=(0, 0.0, -0.05))
    P.add(bm_blob(1.0, seed=33, subdiv=2, amp=0.15, freq=1.6, aniso=(1.55, 1.05, 0.18)), M['snow'],
          loc=(0, S * 0.55 * math.cos(pitch), S * 0.55 * math.sin(pitch) + 0.14), rot=(pitch, 0, 0))
    P.add(bm_blob(0.5, seed=34, subdiv=1, amp=0.25, freq=2.0, aniso=(1.4, 1.0, 0.2)), M['snow'],
          loc=(-0.9, S * 0.2 * math.cos(pitch), S * 0.2 * math.sin(pitch) + 0.12), rot=(pitch, 0, 0))

def cottage_roof_ridge(P, M):
    L = 3.0
    pts = [(-0.22, -0.02), (0.0, 0.16), (0.22, -0.02), (0.15, -0.06), (0.0, 0.08), (-0.15, -0.06)]
    P.add(bm_prism_profile(pts, L), M['wood'], rot=(RAD(90), 0, RAD(90)), loc=(-L * 0.5, 0, 0))
    P.add(bm_box(0.05, L + 0.1, 0.05, bevel=0.006), M['wood'], loc=(0, 0, 0.14))
    P.add(bm_blob(0.55, seed=41, subdiv=2, amp=0.2, freq=1.8, aniso=(0.5, 2.6, 0.22)), M['snow'], loc=(0, 0, 0.2))
    for y in (-L * 0.32, L * 0.32):
        P.add(bm_lathe([(0, 0.10), (0.06, 0.12), (0.05, 0.30), (0.02, 0.36), (0, 0.40)], 8), M['iron'], loc=(0, y, 0))

def snow_rock(P, M):
    P.add(bm_blob(0.62, seed=51, subdiv=2, amp=0.3, freq=1.5, aniso=(1.25, 1.0, 0.72), floor=0.55), M['stone'], loc=(0, 0, 0.62 * 0.72 * 0.55), flat=True)
    P.add(bm_blob(0.55, seed=52, subdiv=2, amp=0.22, freq=1.8, aniso=(1.15, 0.9, 0.24)), M['snow'], loc=(0.02, 0.0, 0.62 * 0.72 * 0.55 + 0.42))
    P.add(bm_blob(0.2, seed=53, subdiv=1, amp=0.3, freq=2.0, floor=0.5), M['stone'], loc=(0.7, -0.2, 0.08), flat=True)

def props():
    return [
        {'name': 'pine_snow_trunk', 'build': pine_snow_trunk, 'runtime': {'kind': 'tree', 'h': 9.2, 'part': 'trunk'}, 'notes': 'frosted pine bole + snow collar'},
        {'name': 'pine_snow_canopy', 'build': pine_snow_canopy, 'runtime': {'kind': 'tree', 'part': 'canopy'}, 'pivot': 'tree base (y=0)', 'notes': 'six needle tiers each with a snow cap'},
        {'name': 'pine_snow_tree', 'compose': ['pine_snow_trunk', 'pine_snow_canopy'], 'runtime': {'kind': 'tree', 'h': 9.9}},
        {'name': 'icicle_cluster', 'build': lambda P, M: icicle_cluster(P, M), 'runtime': {'id': 'icicle', 'fit': 'max'}, 'pivot': 'TOP attachment (y=0); spikes hang to y -1.0',
         'notes': 'ice shelf + 7 tapered icicles (faint emissive)'},
        {'name': 'icicle_fringe', 'build': lambda P, M: icicle_cluster(P, M, n=12, spread=0.8, seed=6, bar=True), 'runtime': {'id': 'icicle_fringe', 'fit': 'max'},
         'pivot': 'TOP attachment (y=0); a 1.76 m eave bar with 12 icicles'},
        {'name': 'snowdrift', 'build': snowdrift, 'runtime': {'id': 'snowdrift', 'fit': 'max'}, 'notes': 'wind-shaped drift, three mounds'},
        {'name': 'ice_crystal', 'build': lambda P, M: ice_crystal(P, M), 'runtime': {'id': 'crystal', 'h': 1.6}, 'notes': 'hex crystal cluster on a rock (emissive)'},
        {'name': 'ice_crystal_small', 'build': lambda P, M: ice_crystal(P, M, n=4, seed=7, scale=0.55), 'runtime': {'id': 'crystal_small', 'h': 0.8}},
        {'name': 'lantern_post', 'build': lantern_post, 'runtime': {'id': 'lantern', 'h': 2.6}, 'notes': 'iron post, curled arm, glowing lantern box, snow caps'},
        {'name': 'cottage_roof_module', 'build': cottage_roof_module, 'budget': 3000, 'runtime': {'kind': 'building', 'style': 'cottage', 'part': 'roof slab'},
         'pivot': 'EAVE line centre (y=0); slab rises +Z (glTF -Z toward the ridge) at 35°, 3.0 wide', 'notes': 'architecture: 7 shingle rows, 3 rafters, snow'},
        {'name': 'cottage_roof_ridge', 'build': cottage_roof_ridge, 'runtime': {'kind': 'building', 'style': 'cottage', 'part': 'ridge cap'}, 'pivot': 'ridge line centre; runs 3.0 along Z'},
        {'name': 'snow_rock', 'build': snow_rock, 'runtime': {'id': 'rock', 'fit': 'max'}},
    ]
