# CRESTBOUND — THE KEEP kit: the pieces. Blender coords (Z up, -Y = front, metres, origin at the base).
# Each builder returns a Piece whose `parts` are joined into one mesh; `separate` objects stay
# their own named nodes (the painting canvas); `rig(mesh) -> (armature, [actions])` adds bones.
from math import radians, sin, cos, pi, atan2, sqrt
import random
import bpy
from mathutils import Vector
import kitlib as K
from kitlib import box, lathe, cyl, sweep, torus, prism, polyplate, arc_pts, PointedArch, flute_radial

R = random.Random(11)


class Piece:
    def __init__(self, name, kind='architecture', tex=1024, budget=3000):
        self.name, self.kind, self.tex, self.budget = name, kind, tex, budget
        self.parts, self.separate = [], []
        self.rig, self.rig_check = None, None
        self.notes, self.pivot, self.closeup = [], 'base centre (y=0 at the floor)', None

    def add(self, *obs):
        for o in obs:
            self.parts.append(o)
        return obs[0] if len(obs) == 1 else obs


def jit(a, b):
    return R.uniform(a, b)


# =============================================================================
# WALL PANEL — 4 m x 4 m, coursed ashlar relief, plinth + string course, carved boss course
# =============================================================================
def wall_panel():
    p = Piece('wall_panel', tex=2048, budget=3000)
    W, H = 4.0, 4.0
    p.add(box('slab', (W, 0.16, H), at=(0, -0.08, 0), bev=0.008, mat='mortar', rnd=0.5))
    courses = 8
    ch = H / courses
    for c in range(courses):
        z0 = c * ch
        off = 0.5 if c % 2 else 0.0
        x = -W / 2 + off
        edges = []
        if off:
            edges.append((-W / 2, -W / 2 + 0.5))
        while x < W / 2 - 1e-6:
            x1 = min(x + 1.0, W / 2)
            edges.append((x, x1))
            x = x1
        for (a, b) in edges:
            L = b - a - 0.024
            depth = jit(0.13, 0.19)
            if c == 5:
                depth = 0.165
            blk = box(f'blk{c}', (L, depth, ch - 0.024), at=((a + b) / 2, -0.16 - depth / 2, z0 + 0.012),
                      bev=0.018, seg=1, mat='stone', anchor='bottom')
            if c == 5 and (b - a) > 0.9:
                # a carved diamond boss on every full block of the fifth course
                p.add(box('boss', (0.19, 0.06, 0.19), at=((a + b) / 2, -0.16 - depth - 0.03, z0 + ch / 2), rot=(0, pi / 4, 0),
                          bev=0.02, mat='stone', anchor='center', rnd=0.9))
            p.add(blk)
    # plinth moulding along the base and a string course over the carved course
    p.add(box('plinth', (W, 0.28, 0.20), at=(0, -0.16 - 0.14 + 0.02, 0.0), bev=0.04, seg=2, mat='marble'))
    p.add(box('string', (W, 0.24, 0.12), at=(0, -0.16 - 0.12 + 0.02, 6 * ch - 0.02), bev=0.035, seg=2, mat='marble'))
    p.pivot = 'base centre of the BACK plane: place it on a wall face; the relief stands 0.34-0.40 m proud (glTF +Z)'
    p.notes = ['4.0 x 4.0 m facing panel, 8 courses running bond, boss course at 2.5-3.0 m, string course at 3.0 m',
               'tile it along X every 4.0 m; the back plane at z=0 is unbevelled so a neighbour butts clean']
    p.closeup = (0.6, -0.42, 2.75)
    return p


# =============================================================================
# CORNER PIER — 1.0 m quoined corner, 4 m tall, plinth + cap
# =============================================================================
def corner_pier():
    p = Piece('corner_pier', tex=1024, budget=3000)
    H, S = 4.0, 1.0
    p.add(box('plinth', (S + 0.24, S + 0.24, 0.30), at=(0, 0, 0), bev=0.04, seg=2, mat='marble'))
    p.add(box('plinth2', (S + 0.12, S + 0.12, 0.10), at=(0, 0, 0.30), bev=0.03, seg=2, mat='marble'))
    z = 0.40
    i = 0
    while z < H - 0.44:
        h = 0.46
        # cross-laid quoin courses: every course is proud on one axis and recessed on the other,
        # so all four corners read the long/short quoin rhythm in raking light
        sx, sy = (S + 0.08, S - 0.05) if i % 2 == 0 else (S - 0.05, S + 0.08)
        p.add(box(f'quoin{i}', (sx, sy, h), at=(0, 0, z), bev=0.022, mat='stone', rnd=R.random()))
        # a chamfered joint band between courses
        p.add(box(f'joint{i}', (S - 0.10, S - 0.10, 0.02), at=(0, 0, z + h), bev=0.0, mat='mortar'))
        z += 0.48
        i += 1
    p.add(box('capfrieze', (S + 0.12, S + 0.12, 0.20), at=(0, 0, H - 0.42), bev=0.02, mat='stone', rnd=0.2))
    p.add(box('cap', (S + 0.30, S + 0.30, 0.22), at=(0, 0, H - 0.22), bev=0.05, seg=2, mat='marble'))
    p.pivot = 'base centre of the 1.0 m square footprint'
    p.notes = ['1.0 x 1.0 x 4.0 m; cross-laid quoin courses every 0.48 m (proud/recessed alternating on X and Z); stack for taller corners']
    p.closeup = (-0.5, -0.55, 2.2)
    return p


# =============================================================================
# GOTHIC ARCH — shared surround builder (door + window + the gate door use it)
# =============================================================================
def arch_surround(p, a, springing, rise, depth=0.7, jamb=0.5, nvous=7, hood=True, vg='root', keystone=True,
                  mseg=2, hood_n=12):
    """mseg = bevel segments on the marble mouldings (2 = rounded, 1 = single chamfer, 64 tris cheaper each);
    hood_n = points per hood arc. Both are pure tessellation: the silhouette and every part survive."""
    arch = PointedArch(a, rise)
    for sg in (-1, 1):
        x = sg * (a + jamb / 2)
        p.add(box('jplinth', (jamb + 0.16, depth + 0.12, 0.32), at=(x, 0, 0), bev=0.03, seg=mseg, mat='marble', vg=vg))
        z = 0.32
        k = 0
        while z < springing - 0.2:
            h = min(0.88, springing - 0.2 - z)
            p.add(box(f'jamb{k}', (jamb, depth, h - 0.02), at=(x, 0, z), bev=0.02, mat='stone', vg=vg))
            z += h
            k += 1
        p.add(box('impost', (jamb + 0.14, depth + 0.10, 0.18), at=(x, 0, springing - 0.2), bev=0.03, seg=mseg, mat='marble', vg=vg))
    # voussoirs along both arcs (outer radius = R + jamb*0.9)
    Ro = arch.R + jamb * 0.85
    arclen = Ro * arch.apex
    bw = arclen / nvous * 1.05
    for sg in (-1, 1):
        for i in range(nvous):
            t = (i + 0.5) / nvous
            th = arch.apex * t
            cx = -arch.c + (arch.R + jamb * 0.42) * cos(th)
            cz = springing + (arch.R + jamb * 0.42) * sin(th)
            ang = th + pi / 2   # tangent direction angle in XZ
            # the box's local X follows the tangent: rotate about Y by -ang (Blender: +Y rot turns +X toward -Z)
            p.add(box(f'vous{i}', (bw, depth, jamb * 0.84), at=(sg * cx, 0, cz), rot=(0, -sg * ang + (pi if sg < 0 else 0), 0),
                      bev=0.02, mat='stone', anchor='center', vg=vg))
    if keystone:
        p.add(box('keystone', (jamb * 0.9, depth + 0.16, jamb * 1.25), at=(0, 0, springing + rise + jamb * 0.10), bev=0.03, seg=mseg,
                  mat='marble', anchor='center', vg=vg))
    if hood:
        pts = []
        n = hood_n
        for sg in (-1, 1):
            seq = range(n) if sg < 0 else range(n)
            for i in seq:
                t = i / (n - 1)
                th = arch.apex * (1 - t) if sg < 0 else arch.apex * t
                rr = Ro + 0.08
                pts.append((sg * (-arch.c + rr * cos(th)), -depth / 2 - 0.05, springing + rr * sin(th)))
        # left arc from springing up to apex, then right arc from apex down
        left = pts[:n]
        right = pts[n:]
        # left arc springing -> apex, then the right arc apex -> springing (apex shared once)
        poly = list(reversed(left)) + list(reversed(right))[1:]
        p.add(sweep('hood', poly, 0.16, 0.14, mat='marble', vg=vg, up=(0, 1, 0), bev=0.02))
    return arch


def arch_door():
    p = Piece('arch_door', tex=2048, budget=3000)
    a, H = 1.4, 4.2
    rise = 1.8
    arch_surround(p, a, H - rise, rise)
    p.pivot = 'base centre of the opening (2.8 m clear, 4.2 m to the apex); the surround is 0.7 m deep, centred on the wall plane'
    p.notes = ['two-centred pointed arch, 7 voussoirs a side, keystone, impost + plinth mouldings, hood moulding',
               'fits keep.js IRON_DOOR (w 2.8, h 4.2) and the buildGateDoor jamb collider (0.5 m jambs)']
    p.closeup = (0.9, -0.5, 3.4)
    return p


def arch_window():
    p = Piece('arch_window', tex=1024, budget=3000)
    a, H = 0.7, 3.2
    rise = 1.05
    springing = H - rise
    arch = arch_surround(p, a, springing, rise, depth=0.5, jamb=0.32, nvous=6, hood=True)
    # sill, a central mullion with a trefoil head, and the glazing
    p.add(box('sill', (2 * a + 0.9, 0.62, 0.16), at=(0, 0, 0.0), bev=0.03, seg=2, mat='marble'))
    p.add(box('mullion', (0.12, 0.14, springing - 0.16 - 0.10), at=(0, 0, 0.16), bev=0.015, mat='stone'))
    p.add(cyl('mullshaft', 0.05, springing - 0.16 - 0.10, 10, at=(0, -0.09, 0.16), mat='stone'))
    # trefoil: three small rings at the head
    for (x, z) in ((-0.28, springing - 0.05), (0.28, springing - 0.05), (0.0, springing + 0.38)):
        p.add(torus('cusp', 0.19, 0.045, 16, 6, at=(x, 0, z), rot=(pi / 2, 0, 0), mat='stone'))
    p.add(box('transom', (2 * a, 0.10, 0.12), at=(0, 0, springing - 0.30), bev=0.015, mat='stone'))
    # glazing: one plate the shape of the opening (a polygon: rectangle + arch)
    pts = [(-a + 0.02, 0.17)] + [(x, z + springing) for (x, z) in
                                 [(-a + 0.02, 0)] + [(sg * (-arch.c + arch.R * cos(th)), arch.R * sin(th)) for sg, th in
                                                     [(-1, arch.apex * (1 - i / 8)) for i in range(0, 9)]][1:]] + \
          [(x, z + springing) for (x, z) in [(-arch.c + arch.R * cos(arch.apex * i / 8), arch.R * sin(arch.apex * i / 8)) for i in range(1, 9)]] + \
          [(a - 0.02, 0.17)]
    p.add(polyplate('glass', pts, 0.03, at=(0, 0.06, 0), mat='glass_day'))
    p.pivot = 'base centre of the opening (1.4 m clear, 3.2 m to the apex), sill on the floor line'
    p.notes = ['lancet with a mullion + trefoil head and a daylight glass slot (emissive, own material) - the god-ray window',
               'the glass sits 0.06 m behind the wall plane; the exporter names its material arch_window_glass_day']
    p.closeup = (0.0, -0.3, 2.35)
    return p


# =============================================================================
# COLUMN WITH CAPITAL — 4.0 m, fluted shaft, torus base, bell capital + abacus
# =============================================================================
def column():
    p = Piece('column', tex=1024, budget=3000)
    p.add(box('plinth', (0.96, 0.96, 0.22), at=(0, 0, 0), bev=0.03, seg=2, mat='marble'))
    p.add(lathe('base', [(0, 0.22), (0.44, 0.22), (0.46, 0.30), (0.40, 0.36), (0.36, 0.40), (0.33, 0.44), (0, 0.44)], 24, mat='marble'))
    p.add(lathe('shaft', [(0, 0.44), (0.325, 0.44), (0.33, 0.6), (0.30, 3.2), (0.29, 3.32), (0, 3.32)], 72, mat='stone', radial=flute_radial(12, 0.09)))
    p.add(torus('astragal', 0.30, 0.035, 24, 6, at=(0, 0, 3.34), mat='marble'))
    p.add(lathe('bell', [(0, 3.36), (0.30, 3.36), (0.34, 3.5), (0.44, 3.66), (0.50, 3.76), (0, 3.76)], 24, mat='marble'))
    p.add(box('abacus', (1.04, 1.04, 0.16), at=(0, 0, 3.76), bev=0.03, seg=2, mat='marble'))
    p.add(box('abacus2', (1.14, 1.14, 0.08), at=(0, 0, 3.92), bev=0.02, mat='marble'))
    for i in range(4):
        a = pi / 4 + i * pi / 2
        p.add(box('volute', (0.20, 0.20, 0.26), at=(cos(a) * 0.46, sin(a) * 0.46, 3.50), rot=(0, 0, a), bev=0.04, seg=2, mat='gilt', anchor='bottom'))
    p.pivot = 'base centre; 4.0 m to the top of the abacus'
    p.notes = ['fluted (12) shaft r 0.30 on a torus base; bell capital with gilt corner volutes; abacus 1.04 m square',
               'scale Y to taller orders (the lobby pillars are 14 m) or stack a plain drum under it']
    p.closeup = (0.0, -0.5, 3.55)
    return p


# =============================================================================
# BALUSTRADE + NEWEL — 2.0 m segment of turned balusters, 1.05 m tall; a 1.24 m newel post
# =============================================================================
def baluster_profile():
    return [(0, 0), (0.07, 0), (0.07, 0.03), (0.05, 0.05), (0.05, 0.10), (0.085, 0.16), (0.095, 0.26), (0.07, 0.40),
            (0.045, 0.52), (0.04, 0.64), (0.06, 0.70), (0.065, 0.74), (0.045, 0.78), (0.07, 0.82), (0.07, 0.86), (0, 0.86)]


def balustrade():
    p = Piece('balustrade', tex=1024, budget=3000)
    L = 2.0
    p.add(box('bottom', (L, 0.22, 0.10), at=(0, 0, 0), bev=0.02, seg=2, mat='marble'))
    for i in range(5):
        x = -L / 2 + (i + 0.5) * L / 5
        p.add(lathe('bal', baluster_profile(), 14, at=(x, 0, 0.10), mat='marble'))
    p.add(box('top', (L, 0.26, 0.09), at=(0, 0, 0.96), bev=0.03, seg=2, mat='marble'))
    p.add(box('topcap', (L, 0.20, 0.02), at=(0, 0, 1.05 - 0.02), bev=0.008, mat='marble'))
    p.pivot = 'base centre; runs along X, 2.0 m; rails 0.22-0.26 m wide; 1.05 m tall (keep.js RAILS height)'
    p.notes = ['5 turned balusters per 2.0 m; butt segments end to end, put a newel at every corner / stair foot']
    p.closeup = (0.4, -0.25, 0.5)
    return p


def newel():
    p = Piece('newel', kind='prop', tex=512, budget=3000)
    p.add(box('plinth', (0.42, 0.42, 0.12), at=(0, 0, 0), bev=0.02, seg=2, mat='marble'))
    p.add(box('post', (0.30, 0.30, 0.80), at=(0, 0, 0.12), bev=0.035, seg=2, mat='marble'))
    p.add(box('band', (0.36, 0.36, 0.06), at=(0, 0, 0.52), bev=0.015, mat='marble'))
    for sg in (-1, 1):
        p.add(box('panel', (0.20, 0.03, 0.30), at=(0, sg * 0.15, 0.62), bev=0.008, mat='marble', rnd=0.8))
        p.add(box('panel2', (0.03, 0.20, 0.30), at=(sg * 0.15, 0, 0.62), bev=0.008, mat='marble', rnd=0.8))
    p.add(box('cap', (0.40, 0.40, 0.08), at=(0, 0, 0.92), bev=0.025, seg=2, mat='marble'))
    p.add(torus('ring', 0.10, 0.014, 20, 6, at=(0, 0, 1.01), mat='gilt'))
    p.add(lathe('finial', [(0, 1.00), (0.08, 1.01), (0.11, 1.08), (0.09, 1.16), (0.05, 1.20), (0.03, 1.23), (0, 1.245)], 16, mat='marble'))
    p.pivot = 'base centre; 0.42 m footprint, 1.245 m tall (the keep.js post is 1.24)'
    p.notes = ['square newel with recessed panels, gilt collar and an acorn finial']
    return p


# =============================================================================
# STAIR MODULE — 4 steps, rise 0.30 / run 0.46 (keep.js grand stair), 4.0 m wide
# lowest tread at Blender +Y (= glTF -Z), climbing toward -Y (= glTF +Z) exactly like buildStairs
# =============================================================================
def stair_module():
    p = Piece('stair_module', tex=2048, budget=3000)
    n, rise, run, w = 4, 0.30, 0.46, 4.0
    D = n * run
    for i in range(n):
        top = (i + 1) * rise
        # buildStairs: step i centred at z = -D/2 + (i+0.5)*run (glTF)  ->  Blender y = +D/2 - (i+0.5)*run
        yc = D / 2 - (i + 0.5) * run
        p.add(box(f'step{i}', (w, run, top), at=(0, yc, 0), bev=0.03, mat='marble', rnd=0.3 + 0.1 * i))
        # recessed tread panel + a brass nose inlay on the leading (+Y here) edge, on the `stripe` slot
        p.add(box(f'tread{i}', (w - 0.16, run - 0.10, 0.03), at=(0, yc, top - 0.004), bev=0.01, mat='marble', rnd=0.7))
        p.add(box(f'nose{i}', (w - 0.12, 0.05, 0.016), at=(0, yc + run / 2 - 0.05, top + 0.01), bev=0.004, mat='stripe'))
    # carved side stringers: a sloped plank each side, with a run of raised scroll bosses
    ang = atan2(n * rise, D)
    L = sqrt(D * D + (n * rise) ** 2)
    for sg in (-1, 1):
        x = sg * (w / 2 + 0.07)
        p.add(box('stringer', (0.14, L + 0.3, 0.36), at=(x, 0, n * rise / 2 + 0.02), rot=(-ang, 0, 0), bev=0.02, seg=2, mat='timber', anchor='center'))
        for k in range(5):
            t = (k + 0.5) / 5
            yy = D / 2 - t * D
            zz = t * n * rise + 0.20
            p.add(box('scroll', (0.05, 0.16, 0.16), at=(x + sg * 0.09, yy, zz), rot=(-ang, 0, 0), bev=0.02, seg=2, mat='timber', anchor='center', rnd=0.9))
        # a closed string foot block
        p.add(box('foot', (0.16, 0.30, 0.30), at=(x, D / 2 - 0.05, 0), bev=0.02, mat='timber'))
    p.pivot = 'centre of the XZ footprint, at the FOOT height (buildStairs p): lowest riser at glTF -Z, climbs toward +Z'
    p.notes = ['4 risers x 0.30 (< TUNE.stepUp 0.45), run 0.46, width 4.0: identical to keep.js GRAND_STAIR flights',
               'brass nose inlays are on the stair_module_stripe material slot (weak keep-gold emissive) for the leading-edge law',
               'timber stringers carved with scroll bosses; chain modules every 1.84 m of run / 1.20 m of rise']
    p.closeup = (1.4, 0.55, 0.65)
    return p


# =============================================================================
# GALLERY BEAM — 4 m chamfered oak beam with carved corbels + iron straps
# =============================================================================
def gallery_beam():
    p = Piece('gallery_beam', tex=1024, budget=3000)
    L, s = 4.0, 0.5
    p.add(box('beam', (L, s, s), at=(0, 0, 0), bev=0.045, seg=2, mat='timber'))
    p.add(box('chamferline', (L - 0.6, 0.06, 0.02), at=(0, -s / 2 - 0.005, s * 0.62), bev=0.005, mat='timber', rnd=0.95))
    for sg in (-1, 1):
        x = sg * (L / 2 - 0.36)
        p.add(box('strap', (0.14, s + 0.06, s + 0.06), at=(x, 0, -0.03), bev=0.012, mat='iron'))
        for (yy, zz) in ((-s / 2 - 0.03, 0.12), (-s / 2 - 0.03, 0.38), (s / 2 + 0.03, 0.12), (s / 2 + 0.03, 0.38)):
            p.add(prism('stud', 0.03, 0.03, 6, at=(x, yy, zz), rot=(pi / 2, 0, 0), mat='iron'))
        # stepped corbel under each end
        p.add(box('corbel1', (0.5, s * 0.8, 0.22), at=(sg * (L / 2 - 0.25), 0, -0.22), bev=0.03, seg=2, mat='timber', rnd=0.4))
        p.add(box('corbel2', (0.34, s * 0.62, 0.20), at=(sg * (L / 2 - 0.17), 0, -0.42), bev=0.03, seg=2, mat='timber', rnd=0.6))
    p.pivot = 'underside centre of the 4.0 m beam: y=0 is the beam soffit; the corbels hang 0.42 m below'
    p.notes = ['0.5 m square chamfered oak, 4.0 m; two iron straps with studs; stepped corbels each end',
               'keep.js coffers: `beam` deco 40 x 0.7 x 0.7 — stack two modules and scale X for those']
    p.closeup = (1.6, -0.35, 0.1)
    return p


# =============================================================================
# HAMMER-BEAM TRUSS — 10 m span, 4.6 m tall over the wall plate
# =============================================================================
def hammer_beam_truss():
    p = Piece('hammer_beam_truss', tex=2048, budget=3000)
    S = 10.0
    half = S / 2
    post_h = 1.6
    hb = 1.7        # hammer beam length inward from the wall
    hp_h = 1.6      # hammer post height
    pitch = radians(46)
    apex_z = post_h + (half) * sin(pitch) / cos(pitch) * 1.0
    t = 0.32        # timber section
    for sg in (-1, 1):
        x = sg * (half - t / 2)
        p.add(box('wallpost', (t, t, post_h), at=(x, 0, 0), bev=0.03, seg=2, mat='timber'))
        p.add(box('hammerbeam', (hb + t, t, t * 0.9), at=(sg * (half - (hb + t) / 2), 0, post_h), bev=0.03, seg=2, mat='timber'))
        xin = sg * (half - hb - t / 2)
        p.add(box('hammerpost', (t, t, hp_h), at=(xin, 0, post_h + t * 0.9), bev=0.03, seg=2, mat='timber'))
        # pendant finial under the hammer beam's inner end
        p.add(lathe('pendant', [(0, post_h), (0.11, post_h), (0.13, post_h - 0.12), (0.09, post_h - 0.28), (0.04, post_h - 0.36), (0, post_h - 0.40)], 12,
                    at=(xin, 0, 0), mat='timber'))
        # curved brace from the wall post down to the hammer beam (an arc)
        c0 = (sg * (half - t / 2), 0.05)
        pts = [(sg * (half - t / 2 - (hb - 0.1) * (1 - cos(a))), 0, 0.10 + (post_h - 0.15) * sin(a)) for a in [pi / 2 * i / 7 for i in range(8)]]
        pts = [(x_, 0, z_) for (x_, _, z_) in pts]
        p.add(sweep('brace', pts, t * 0.7, t * 0.55, mat='timber', bev=0.02))
        # arch brace from the hammer post up to the collar
        zc = post_h + t * 0.9 + hp_h
        pts2 = [(xin + sg * 0.0 - sg * (2.2 * (1 - cos(a))), 0, post_h + t + (zc - post_h - t + 0.5) * sin(a)) for a in [pi / 2 * i / 7 for i in range(8)]]
        p.add(sweep('arch', pts2, t * 0.7, t * 0.55, mat='timber', bev=0.02))
        # principal rafter
        rl = sqrt(half ** 2 + (apex_z - post_h) ** 2)
        ra = atan2(apex_z - post_h, half)
        p.add(box('rafter', (rl + 0.3, t, t * 0.9), at=(sg * half / 2, 0, post_h + (apex_z - post_h) / 2 + 0.16), rot=(0, -sg * ra, 0),
                  bev=0.03, seg=2, mat='timber', anchor='center'))
        p.add(box('purlin', (t * 0.9, 0.8, t * 0.9), at=(sg * half * 0.55, 0, post_h + (apex_z - post_h) * 0.55 + 0.34), rot=(0, -sg * ra, 0),
                  bev=0.02, mat='timber', anchor='center'))
    zc = post_h + t * 0.9 + hp_h
    p.add(box('collar', (S - 2 * hb - t + 2.4, t, t * 0.9), at=(0, 0, zc - t * 0.2), bev=0.03, seg=2, mat='timber'))
    p.add(box('kingpost', (t * 0.9, t * 0.9, apex_z - zc + 0.25), at=(0, 0, zc + t * 0.6), bev=0.03, seg=2, mat='timber'))
    p.add(box('ridge', (t, 0.9, t), at=(0, 0, apex_z + 0.25), bev=0.03, seg=2, mat='timber'))
    p.add(box('wallplateL', (t * 1.3, 0.9, t * 0.6), at=(-(half - t / 2), 0, -0.2), bev=0.02, mat='timber'))
    p.add(box('wallplateR', (t * 1.3, 0.9, t * 0.6), at=((half - t / 2), 0, -0.2), bev=0.02, mat='timber'))
    p.pivot = 'centre of the span at the wall-plate line (top of the wall): posts stand on y=0, the truss climbs above'
    p.notes = ['10 m span, hammer beams 1.7 m, hammer posts, curved braces, collar, king post, 46 deg principals with a purlin seat each side',
               'set it across the long hall (24 m wide: two trusses + a centre post) or scale X for the 8 m nook']
    p.closeup = (-3.2, -0.6, 2.4)
    return p


# =============================================================================
# PAINTING FRAMES — ornate gilt, 3 sizes (keep.js: 3.0x3.2 ember, 3.4x3.8 default, 4.2x4.4 rime-3)
# origin = centre of the canvas at the wall plane (buildPainting's p), front toward glTF +Z
# =============================================================================
def frame_painting(size_name, w, h):
    p = Piece(f'frame_painting_{size_name}', kind='prop', tex=1024, budget=3000)
    fw, fd = 0.24, 0.20
    ho = h / 2
    # rails (moulded: a chamfered rail + an inner bead + an outer bead)
    def rail(name, lw, lh, x, z):
        p.add(box(name, (lw, fd, lh), at=(x, -fd / 2 + 0.02, z), bev=0.035, seg=2, mat='gilt', anchor='center'))
        p.add(box(name + 'b', (lw * 0.985, 0.04, lh * 0.35), at=(x, -fd - 0.0, z), bev=0.012, seg=2, mat='gilt', anchor='center', rnd=0.7))
    rail('top', w + 2 * fw, fw, 0, ho + fw / 2)
    rail('bot', w + 2 * fw, fw, 0, -ho - fw / 2)
    rail('left', fw, h + fw * 0.1, -(w + fw) / 2, 0)
    rail('right', fw, h + fw * 0.1, (w + fw) / 2, 0)
    # corner cartouches: a turned rosette with four leaf petals
    for sx in (-1, 1):
        for sz in (-1, 1):
            cx, cz = sx * (w + fw) / 2, sz * (h + fw) / 2
            p.add(lathe('rosette', [(0, 0), (0.16, 0.01), (0.12, 0.05), (0.075, 0.08), (0, 0.095)], 12, at=(cx, -fd - 0.01, cz), rot=(pi / 2, 0, 0), mat='gilt'))
            for k in range(4):
                a = pi / 4 + k * pi / 2
                p.add(box('petal', (0.10, 0.04, 0.22), at=(cx + cos(a) * 0.17, -fd - 0.01, cz + sin(a) * 0.17), rot=(0, -a + pi / 2, 0),
                          bev=0.015, mat='gilt', anchor='center', rnd=0.5))
    # crest pediment on the top rail: a small entablature + the gilt octagon crest
    p.add(box('pediment', (0.7, fd * 0.8, 0.10), at=(0, -fd * 0.4 + 0.02, ho + fw + 0.05), bev=0.02, seg=2, mat='gilt', anchor='center'))
    p.add(prism('crest', 0.16, 0.06, 8, at=(0, -fd * 0.5 - 0.01, ho + fw + 0.24), rot=(pi / 2, 0, pi / 8), mat='gilt'))
    p.add(prism('crestcore', 0.09, 0.04, 8, at=(0, -fd * 0.5 - 0.05, ho + fw + 0.24), rot=(pi / 2, 0, pi / 8), mat='brass'))
    # linen mat behind the canvas (in the atlas) — the canvas itself is a separate node
    p.add(box('mat', (w + 0.02, 0.06, h + 0.02), at=(0, -0.01, 0), bev=0.01, mat='parchment', anchor='center'))
    canvas = box('canvas', (w - 0.16, 0.012, h - 0.16), at=(0, -0.045, 0), bev=0.0, mat='canvas', anchor='center')
    canvas['kit_uvrect'] = True
    canvas['kit_color'] = (0.35, 0.31, 0.26)
    p.separate.append(canvas)
    p.pivot = f'centre of the canvas ON the wall plane (buildPainting p); canvas {w-0.16:.2f} x {h-0.16:.2f} m, frame {w+2*fw:.2f} x {h+2*fw:.2f} m'
    p.notes = [f'opening {w} x {h} m (keep.js size), gilt moulded rails, corner rosettes, crest pediment',
               'node `canvas` is a separate mesh with UVs 0..1 and its own plain material: swap its map for the course plate']
    p.closeup = (-(w + fw) / 2, -0.3, (h + fw) / 2)
    return p


def frame_painting_s():
    return frame_painting('s', 3.0, 3.2)


def frame_painting_m():
    return frame_painting('m', 3.4, 3.8)


def frame_painting_l():
    return frame_painting('l', 4.2, 4.4)


# =============================================================================
# GATE DOOR — arched double door 2.8 x 4.2 in its surround, strap hinges, crest lock plate; rigged
# =============================================================================
def gate_door():
    p = Piece('gate_door', tex=2048, budget=3000)
    a, H = 1.4, 4.2
    rise = 1.8
    springing = H - rise
    # the surround is tessellated one tier below arch_door's (mseg 1, nvous 6, hood_n 9): the gate carries
    # 1.7k tris of leaves + iron on top of it, and every part is still here — only facet counts drop.
    arch = arch_surround(p, a, springing, rise, depth=0.7, jamb=0.5, nvous=6, hood=True, vg='root',
                         mseg=1, hood_n=9)
    leafW = a - 0.03
    planks = 5
    pw = leafW / planks
    ZB = 0.03                       # plank foot, 3 cm off the threshold

    def leaf_edge(z):
        """|x| of the door OPENING at height z: the jamb below the springing, the arch curve above."""
        if z <= springing:
            return a
        dz = z - springing
        if dz >= rise:
            return 0.0
        return max(0.0, sqrt(max(0.0, arch.R * arch.R - dz * dz)) - arch.c)

    def plank_top(x):
        return springing + arch.z_at(x) - 0.04

    for sg, vg in ((-1, 'hingeL'), (1, 'hingeR')):
        hx = sg * a                     # hinge line at the jamb
        for i in range(planks):
            xc = hx - sg * (0.02 + (i + 0.5) * pw)
            x0, x1 = xc - (pw - 0.012) / 2, xc + (pw - 0.012) / 2
            # THE PLANK TOP FOLLOWS THE ARCH. A flat-topped box per plank made a 5-step sawtooth
            # under the arch (read off _turntable/gate_door_00.png); the top edge is now sampled
            # off the same PointedArch the voussoirs ride, so the leaf meets the arch as one curve.
            NT = 3
            top = [(x0 + (x1 - x0) * k / (NT - 1), plank_top(x0 + (x1 - x0) * k / (NT - 1))) for k in range(NT)]
            pts = [(x0, ZB), (x1, ZB)] + list(reversed(top))
            p.add(polyplate(f'plank{i}', pts, 0.11, at=(0, -0.045, 0), bev=0.010, mat='timber', vg=vg, rnd=R.random()))
        # strap hinges: three straps with a spear end and studs. Above the springing the leaf is
        # NARROWER than the jamb, so a strap that starts at the jamb line hangs in the air — start
        # every strap at the leaf's own edge at its height and cut its length to what is left.
        for zz in (0.55, 1.8, 3.05):
            ex = leaf_edge(zz + 0.07)
            sl = min(leafW * 0.78, max(0.35, ex - 0.10))
            sx = sg * ex                 # the leaf's outer edge at this height
            pts = [(0, -0.07), (sl * 0.72, -0.07), (sl * 0.86, -0.03), (sl, 0), (sl * 0.86, 0.03), (sl * 0.72, 0.07), (0, 0.07)]
            pts = [(sx - sg * (0.03 + x_), z_ + zz) for (x_, z_) in pts]
            p.add(polyplate('strap', pts, 0.035, at=(0, -0.155, 0), mat='iron', vg=vg))
            for k in range(3):
                p.add(prism('stud', 0.028, 0.03, 5, at=(sx - sg * (0.16 + k * sl * 0.28), -0.19, zz), rot=(pi / 2, 0, 0), mat='iron', vg=vg))
            p.add(cyl('knuckle', 0.05, 0.22, 6, at=(sx - sg * 0.02, -0.13, zz - 0.11), mat='iron', vg=vg))
        # ring handle near the meeting stile
        xr = hx - sg * (leafW - 0.22)
        p.add(prism('boss', 0.07, 0.03, 6, at=(xr, -0.16, 2.0), rot=(pi / 2, 0, 0), mat='iron', vg=vg))
        p.add(torus('ring', 0.10, 0.017, 14, 5, at=(xr, -0.21, 1.9), rot=(pi / 2, 0, 0), mat='iron', vg=vg))
    # crest lock plate on the RIGHT leaf at the meeting stile
    lx = a - 0.03 - leafW + 0.38
    p.add(prism('lockplate', 0.24, 0.03, 8, at=(lx, -0.155, 2.45), rot=(pi / 2, 0, pi / 8), mat='iron', vg='hingeR'))
    for i in range(6):
        ang = i * pi / 3
        p.add(box('glyph', (0.05, 0.03, 0.30), at=(lx + cos(ang) * 0.10, -0.20, 2.45 + sin(ang) * 0.10), rot=(0, -ang + pi / 2, 0),
                  bev=0.0, mat='gilt', vg='hingeR', anchor='center'))
    p.add(cyl('glyphcore', 0.05, 0.035, 8, at=(lx, -0.19, 2.45), rot=(pi / 2, 0, 0), mat='gilt', vg='hingeR'))
    p.add(box('keyhole', (0.03, 0.02, 0.07), at=(lx, -0.20, 2.27), bev=0.0, mat='iron', vg='hingeR', anchor='center', rnd=0.0))

    def rig(mesh):
        arm = K.make_armature('gate_door_rig', [
            ('root', (0, 0, 0), (0, 0, 0.4), None),
            ('hingeL', (-a, -0.10, 0), (-a, -0.10, 4.0), 'root'),
            ('hingeR', (a, -0.10, 0), (a, -0.10, 4.0), 'root'),
        ])
        K.skin(mesh, arm)
        A = 1.31   # 75 deg, buildGateDoor's fully-open angle
        acts = [K.key_action(arm, 'open', {
            'hingeL': [(1, (0, 0, 0)), (37, (0, -A, 0))],
            'hingeR': [(1, (0, 0, 0)), (37, (0, A, 0))],
        }, 37)]
        return arm, acts

    def rig_check(mesh, arm, actions):
        # measure the swing: the meeting-stile plank vertex must move toward -Y (the front) at the end of `open`
        sc = bpy.context.scene
        arm.animation_data.action = actions[0]
        try:
            if hasattr(actions[0], 'slots') and len(actions[0].slots):
                arm.animation_data.action_slot = actions[0].slots[0]
        except Exception:
            pass
        sc.frame_set(37)
        dg = bpy.context.evaluated_depsgraph_get()
        ev = mesh.evaluated_get(dg)
        vs = [ev.matrix_world @ v.co for v in ev.data.vertices]
        near = [v for v in vs if abs(v.x) < 0.25 and 0.5 < v.z < 3.0]
        ymin = min(v.y for v in near) if near else 0
        K.log(f'rig_check open@37: meeting-stile vertices min y = {ymin:.3f} (expect ~ -1.3: swung toward the front)')
        sc.frame_set(1)
        arm.animation_data.action = None

    p.rig, p.rig_check = rig, rig_check
    p.pivot = 'base centre of the opening on the wall plane (buildGateDoor p); leaves hang 0.10 m in front (glTF +Z)'
    p.notes = ['opening 2.8 x 4.2 (keep.js IRON_DOOR); surround as arch_door; leaves: 5 oak planks each, 3 spear-end strap hinges, ring handles',
               'crest lock plate (octagon, six-bar gilt glyph, keyhole) on the right leaf',
               'bones root / hingeL / hingeR (hinge lines at x = -+1.40, glTF); clip `open` 1.5 s swings both leaves 75 deg toward +Z',
               'swap the leaf material tint or play `open` backward to close']
    p.closeup = (0.45, -0.45, 2.45)
    return p


# =============================================================================
# PEDESTAL — buildPedestal's silhouette: stepped base, fluted drum, engraved ring, cap
# =============================================================================
def pedestal():
    p = Piece('pedestal', kind='prop', tex=1024, budget=3000)
    r, h = 0.95, 1.05
    prof = [(0, -0.08), (r * 1.02, -0.08), (r, h * 0.10), (r * 0.86, h * 0.16), (r * 0.84, h * 0.22),
            (r * 0.66, h * 0.30), (r * 0.62, h * 0.72), (r * 0.74, h * 0.82), (r * 0.92, h * 0.90), (r * 0.92, h * 0.97), (r * 0.80, h), (0, h)]
    p.add(lathe('body', prof, 28, mat='marble'))
    p.add(lathe('drumflutes', [(0, h * 0.30), (r * 0.64, h * 0.30), (r * 0.64, h * 0.72), (0, h * 0.72)], 60, mat='marble', radial=flute_radial(12, 0.07)))
    p.add(torus('ring', r * 0.80, 0.055, 32, 8, at=(0, 0, h * 0.86), mat='gilt'))
    p.add(torus('runering', r * 0.80, 0.018, 32, 6, at=(0, 0, h * 0.895), mat='rune'))
    for i in range(4):
        a = i * pi / 2 + pi / 4
        p.add(box('rune', (0.16, 0.02, 0.10), at=(cos(a) * r * 1.0, sin(a) * r * 1.0, h * 0.02), rot=(0, 0, a + pi / 2), bev=0.0,
                  mat='rune', anchor='bottom'))
    p.add(cyl('capdisc', r * 0.62, 0.02, 28, at=(0, 0, h), mat='rune'))
    p.pivot = 'base centre; the footing ring sits 0.08 m below y=0 (buildPedestal buries it the same)'
    p.notes = ['r 0.95, h 1.05; fluted drum; gilt engraved ring with a rune channel + 4 base runes + cap disc on the pedestal_rune slot (weak keep-gold emissive)',
               'the runtime pool/sparkle/beam are builders.js effects, not part of the mesh']
    p.closeup = (0.0, -0.7, 0.9)
    return p


# =============================================================================
# BRAZIER / STANDING LANTERN — iron tripod, bowl, caged amber glass (emissive), cap
# =============================================================================
def brazier():
    p = Piece('brazier', kind='prop', tex=1024, budget=3000)
    for i in range(3):
        a = pi / 2 + i * 2 * pi / 3
        pts = [(cos(a) * 0.42, sin(a) * 0.42, 0), (cos(a) * 0.34, sin(a) * 0.34, 0.45), (cos(a) * 0.22, sin(a) * 0.22, 0.62)]
        p.add(sweep('leg', pts, 0.035, 0.05, mat='iron', bev=0.006))
        p.add(box('foot', (0.10, 0.06, 0.03), at=(cos(a) * 0.45, sin(a) * 0.45, 0), rot=(0, 0, a), bev=0.008, mat='iron'))
    p.add(torus('hoop', 0.28, 0.018, 20, 6, at=(0, 0, 0.62), mat='iron'))
    p.add(lathe('bowl', [(0, 0.60), (0.10, 0.60), (0.26, 0.66), (0.30, 0.78), (0.28, 0.80), (0.22, 0.79), (0.20, 0.70), (0, 0.68)], 20, mat='iron'))
    p.add(lathe('glass', [(0, 0.78), (0.20, 0.78), (0.22, 0.86), (0.22, 1.16), (0.20, 1.24), (0, 1.24)], 16, mat='glass_amber'))
    for i in range(4):
        a = i * pi / 2 + pi / 4
        p.add(box('rib', (0.03, 0.02, 0.50), at=(cos(a) * 0.235, sin(a) * 0.235, 0.78), rot=(0, 0, a), bev=0.004, mat='iron'))
    p.add(torus('band', 0.235, 0.012, 20, 5, at=(0, 0, 1.0), mat='iron'))
    p.add(lathe('cap', [(0, 1.22), (0.30, 1.22), (0.31, 1.25), (0.16, 1.40), (0.06, 1.44), (0.06, 1.50), (0, 1.50)], 20, mat='iron'))
    p.add(torus('finial', 0.05, 0.012, 14, 5, at=(0, 0, 1.53), rot=(pi / 2, 0, 0), mat='brass'))
    p.add(lathe('ember', [(0, 0.80), (0.12, 0.80), (0.14, 0.9), (0.08, 1.02), (0, 1.06)], 10, mat='ember'))
    p.pivot = 'base centre of the tripod (0.9 m across), 1.55 m tall'
    p.notes = ['standing lantern-brazier: iron tripod + bowl, caged amber glass on the brazier_glass_amber slot (emissive 3.2), ember core on brazier_ember',
               'put the runtime point light at ~1.0 m (props.js L_TORCH y01 0.92 of 1.55 -> 1.43 m works too)']
    p.closeup = (0.0, -0.45, 1.0)
    return p


# =============================================================================
# BANNER + POLE — 3.2 m pole with a crossbar, cream cloth (tint at runtime), gilt crest; rigged sway
# =============================================================================
def banner_pole():
    p = Piece('banner_pole', kind='prop', tex=1024, budget=3000)
    p.add(lathe('polebase', [(0, 0), (0.16, 0), (0.17, 0.05), (0.08, 0.10), (0.05, 0.14), (0, 0.14)], 16, mat='iron', vg='pole'))
    p.add(cyl('pole', 0.035, 3.05, 12, at=(0, 0, 0.14), mat='timber', vg='pole', r2=0.03))
    p.add(lathe('spear', [(0, 3.19), (0.05, 3.19), (0.07, 3.25), (0.06, 3.30), (0.035, 3.34), (0.05, 3.42), (0.0, 3.62)], 10, mat='brass', vg='pole'))
    p.add(cyl('crossbar', 0.025, 1.5, 10, at=(-0.75, 0, 3.0), rot=(0, pi / 2, 0), mat='timber', vg='pole'))
    for sg in (-1, 1):
        p.add(lathe('knob', [(0, 0), (0.035, 0), (0.045, 0.03), (0.03, 0.06), (0, 0.07)], 10, at=(sg * 0.75, 0, 3.0), rot=(0, sg * pi / 2, 0), mat='brass', vg='pole'))
    # cloth: a subdivided sheet hanging from the crossbar, swallow-tailed, slightly in front of the pole
    cw, ch, nx, nz = 1.36, 2.6, 8, 16
    verts, faces = [], []
    for j in range(nz + 1):
        z = 3.0 - 0.02 - ch * j / nz
        for i in range(nx + 1):
            x = -cw / 2 + cw * i / nx
            verts.append((x, -0.08 - 0.02 * sin(j / nz * pi), z))
    for j in range(nz):
        for i in range(nx):
            a_ = j * (nx + 1) + i
            faces.append((a_, a_ + 1, a_ + nx + 2, a_ + nx + 1))
    cloth = K.mesh_obj('cloth', verts, faces)
    K._finish(cloth, 'cloth', rnd=0.5, smooth=True)
    # swallow tail: drop the bottom-centre vertices up
    for i in range(nx + 1):
        v = cloth.data.vertices[nz * (nx + 1) + i]
        v.co.z += 0.5 * (1 - abs(i / nx - 0.5) * 2)
    p.add(cloth)
    # fringe: small hanging tabs along the bottom edge, a gilt hexagram appliqué
    for i in range(nx):
        x = -cw / 2 + cw * (i + 0.5) / nx
        zb = 3.0 - 0.02 - ch + 0.5 * (1 - abs((i + 0.5) / nx - 0.5) * 2)
        p.add(box('fringe', (cw / nx * 0.7, 0.012, 0.12), at=(x, -0.09, zb - 0.10), bev=0.0, mat='gilt', rnd=0.3))
    for k in range(2):
        rot = k * pi / 3 + pi / 2
        pts = [(cos(rot + m * 2 * pi / 3) * 0.32, 1.85 + sin(rot + m * 2 * pi / 3) * 0.32) for m in range(3)]
        p.add(polyplate('star', pts, 0.012, at=(0, -0.10, 0), mat='gilt', bev=0.0))
    p.add(box('crossbarband', (0.20, 0.09, 0.09), at=(0, 0, 2.955), bev=0.015, mat='brass', vg='pole'))

    def rig(mesh):
        arm = K.make_armature('banner_pole_rig', [
            ('pole', (0, 0, 0), (0, 0, 3.0), None),
            ('cloth1', (0, -0.08, 2.98), (0, -0.08, 2.1), 'pole'),
            ('cloth2', (0, -0.08, 2.1), (0, -0.08, 1.2), 'cloth1'),
            ('cloth3', (0, -0.08, 1.2), (0, -0.08, 0.3), 'cloth2'),
        ])
        # weight the cloth (and everything on it) by height across the three chain bones
        names = ['cloth1', 'cloth2', 'cloth3']
        tops = [2.98, 2.1, 1.2, 0.3]
        vgs = {n: mesh.vertex_groups.get(n) or mesh.vertex_groups.new(name=n) for n in names}
        polev = mesh.vertex_groups.get('pole')
        pole_set = set()
        if polev:
            for v in mesh.data.vertices:
                for g in v.groups:
                    if g.group == polev.index and g.weight > 0.5:
                        pole_set.add(v.index)
        for v in mesh.data.vertices:
            if v.index in pole_set:
                continue
            z = v.co.z
            # piecewise: weight toward the bone whose span contains z, blending at the joints
            w = [0.0, 0.0, 0.0]
            for k in range(3):
                z0, z1 = tops[k], tops[k + 1]
                if z1 <= z <= z0:
                    t = (z0 - z) / (z0 - z1)
                    w[k] = 1.0 - min(1.0, max(0.0, (t - 0.7) / 0.3)) * 0.5
                    if k < 2:
                        w[k + 1] = 1.0 - w[k]
            if z > tops[0]:
                w = [1.0, 0.0, 0.0]
            if z < tops[-1]:
                w = [0.0, 0.0, 1.0]
            s = sum(w) or 1.0
            for k, n in enumerate(names):
                if w[k] > 0:
                    vgs[n].add([v.index], w[k] / s, 'REPLACE')
        K.skin(mesh, arm)
        acts = [K.key_action(arm, 'sway', {
            'cloth1': [(1, (0, 0, 0)), (19, (0.05, 0, 0.02)), (37, (0, 0, 0)), (55, (-0.05, 0, -0.02)), (73, (0, 0, 0))],
            'cloth2': [(1, (0, 0, 0)), (19, (0.09, 0, 0.03)), (37, (0, 0, 0)), (55, (-0.09, 0, -0.03)), (73, (0, 0, 0))],
            'cloth3': [(1, (0.02, 0, 0)), (19, (0.12, 0, 0.05)), (37, (-0.02, 0, 0)), (55, (-0.12, 0, -0.05)), (73, (0.02, 0, 0))],
        }, 73)]
        return arm, acts

    p.rig = rig
    p.pivot = 'base centre of the pole foot; pole 3.62 m to the spear tip, cloth 1.36 x 2.6 m hangs at glTF +Z 0.08'
    p.notes = ['cloth baked CREAM on purpose: tint banner_pole material.color per realm at runtime (keep.js banners carry a realm tint)',
               'bones pole / cloth1 / cloth2 / cloth3; clip `sway` 3.0 s loop; gilt hexagram appliqué + fringe',
               'cloth material is double-sided (no backface culling)']
    p.closeup = (0.0, -0.4, 1.9)
    return p


# =============================================================================
# TORCH SCONCE — wall bracket + torch, ember core; origin at the wall plate, front toward -Y
# =============================================================================
def torch_sconce():
    p = Piece('torch_sconce', kind='prop', tex=512, budget=3000)
    # shield back plate on the wall (y = 0 plane), bracket arm out to -Y
    pts = [(-0.10, 0.0), (-0.12, 0.22), (-0.07, 0.34), (0.0, 0.40), (0.07, 0.34), (0.12, 0.22), (0.10, 0.0), (0.0, -0.06)]
    p.add(polyplate('plate', pts, 0.02, at=(0, 0, 0.0), mat='iron', bev=0.004))
    for (x, z) in ((-0.07, 0.24), (0.07, 0.24), (0, 0.02)):
        p.add(prism('bolt', 0.016, 0.02, 5, at=(x, -0.02, z), rot=(pi / 2, 0, 0), mat='iron'))
    p.add(sweep('arm', [(0, -0.02, 0.12), (0, -0.12, 0.10), (0, -0.22, 0.16), (0, -0.26, 0.28)], 0.03, 0.03, mat='iron', bev=0.005))
    p.add(torus('holder', 0.055, 0.012, 14, 5, at=(0, -0.26, 0.34), mat='iron'))
    p.add(torus('holder2', 0.055, 0.012, 14, 5, at=(0, -0.26, 0.24), mat='iron'))
    p.add(lathe('torch', [(0, 0.10), (0.025, 0.10), (0.04, 0.44), (0.045, 0.52), (0, 0.52)], 10, at=(0, -0.26, 0), mat='timber'))
    p.add(lathe('wrap', [(0, 0.50), (0.05, 0.50), (0.075, 0.58), (0.07, 0.70), (0.05, 0.74), (0, 0.74)], 10, at=(0, -0.26, 0), mat='crimson'))
    p.add(lathe('ember', [(0, 0.72), (0.05, 0.72), (0.06, 0.80), (0.03, 0.88), (0, 0.92)], 8, at=(0, -0.26, 0), mat='ember'))
    p.pivot = 'the wall plate: origin on the wall plane at the plate base; the torch head is 0.26 m out (glTF +Z) at 0.9 m'
    p.notes = ['shield back plate, forged arm, twin ring holder, oak torch with a crimson wrap and an ember core (torch_sconce_ember slot)',
               'keep.js torches are 1.0 m tall decos at 2.5-3.5 m: hang this with its plate base at (torch centre - 0.5)']
    p.closeup = (0.0, -0.45, 0.6)
    return p


# =============================================================================
# BENCH — 2.2 m refectory bench: chamfered top, arched trestle ends, pegged stretcher
# =============================================================================
def bench():
    p = Piece('bench', kind='prop', tex=512, budget=3000)
    L, Hh, Dd = 2.2, 0.46, 0.42
    p.add(box('top', (L, Dd, 0.07), at=(0, 0, Hh - 0.07), bev=0.02, seg=2, mat='timber'))
    for sg in (-1, 1):
        x = sg * (L / 2 - 0.22)
        # trestle end: two legs + a bridge = an arched cut-out, and a foot plank
        p.add(box('foot', (0.10, Dd + 0.06, 0.05), at=(x, 0, 0), bev=0.012, mat='timber', rnd=0.4))
        for sy in (-1, 1):
            p.add(box('leg', (0.09, 0.09, Hh - 0.12), at=(x, sy * (Dd / 2 - 0.06), 0.05), bev=0.012, mat='timber', rnd=0.6))
        p.add(box('bridge', (0.09, Dd - 0.12, 0.10), at=(x, 0, Hh - 0.17), bev=0.012, mat='timber', rnd=0.5))
        p.add(box('archfill', (0.05, Dd - 0.16, 0.16), at=(x, 0, Hh - 0.33), bev=0.02, seg=2, mat='timber', rnd=0.5))
        p.add(box('peg', (0.14, 0.05, 0.05), at=(x, 0, 0.16), rot=(0, 0, 0), bev=0.008, mat='timber', rnd=0.9))
    p.add(box('stretcher', (L - 0.36, 0.05, 0.10), at=(0, 0, 0.14), bev=0.01, mat='timber', rnd=0.2))
    p.pivot = 'base centre; 2.2 x 0.42 m, seat at 0.46 m (keep.js bench deco 2.2 x 0.64 x 0.72 - scale to taste)'
    p.notes = ['refectory bench: chamfered oak top, arched trestle ends, through-pegged stretcher']
    return p


# =============================================================================
# BOOKCASE — 1.8 x 2.5 x 0.55, cornice, plinth, 4 shelves of books
# =============================================================================
def bookcase():
    p = Piece('bookcase', kind='prop', tex=1024, budget=3000)
    W, H, D = 1.8, 2.5, 0.55
    p.add(box('plinth', (W + 0.06, D + 0.04, 0.12), at=(0, 0, 0), bev=0.015, mat='timber'))
    for sg in (-1, 1):
        p.add(box('side', (0.05, D, H - 0.12 - 0.14), at=(sg * (W / 2 - 0.025), 0, 0.12), bev=0.01, mat='timber', rnd=0.3))
    p.add(box('back', (W - 0.1, 0.03, H - 0.12 - 0.14), at=(0, D / 2 - 0.03, 0.12), bev=0.0, mat='timber', rnd=0.7))
    p.add(box('cornice', (W + 0.10, D + 0.08, 0.14), at=(0, 0, H - 0.14), bev=0.035, seg=2, mat='timber'))
    shelves = [0.12, 0.66, 1.20, 1.74]
    for z in shelves:
        p.add(box('shelf', (W - 0.1, D - 0.06, 0.04), at=(0, 0.02, z), bev=0.006, mat='timber', rnd=0.5))
    p.add(box('topshelf', (W - 0.1, D - 0.06, 0.04), at=(0, 0.02, H - 0.18), bev=0.006, mat='timber', rnd=0.5))
    # books: runs of spines, random heights and thicknesses, a couple leaning, a few stacked flat
    for z in shelves:
        x = -W / 2 + 0.07
        while x < W / 2 - 0.09:
            t = R.uniform(0.035, 0.075)
            h = R.uniform(0.22, 0.42)
            lean = R.random() < 0.08
            # bev 0: a real book spine is square, and a 4 mm chamfer on a 3.5-7.5 cm spine cost
            # 32 tris x 101 books = 3,232 of this piece's 5,004 for an edge nobody can resolve.
            p.add(box('book', (t, R.uniform(0.18, 0.26), h), at=(x + t / 2, -0.06, z + 0.04), rot=(0, -0.22 if lean else 0, 0),
                      bev=0.0, mat='books', rnd=R.random()))
            x += t + 0.004
            if R.random() < 0.12:
                x += R.uniform(0.04, 0.1)
    p.add(box('flat1', (0.22, 0.18, 0.05), at=(0.5, -0.05, shelves[1] + 0.04), bev=0.004, mat='books', rnd=0.15))
    p.add(box('flat2', (0.20, 0.16, 0.04), at=(0.52, -0.06, shelves[1] + 0.09), rot=(0, 0, 0.2), bev=0.004, mat='books', rnd=0.55))
    p.pivot = 'base centre of the plinth; back at glTF -Z 0.28, front at +Z 0.28 (keep.js bookcase deco 1.8 x 2.5 x 0.55)'
    p.notes = ['oak carcass with cornice + plinth; 4 shelves of individually coloured books (per-book rnd -> palette)']
    p.closeup = (0.3, -0.35, 1.4)
    return p


PIECES = {
    'wall_panel': wall_panel, 'corner_pier': corner_pier, 'arch_door': arch_door, 'arch_window': arch_window,
    'column': column, 'balustrade': balustrade, 'newel': newel, 'stair_module': stair_module,
    'gallery_beam': gallery_beam, 'hammer_beam_truss': hammer_beam_truss,
    'frame_painting_s': frame_painting_s, 'frame_painting_m': frame_painting_m, 'frame_painting_l': frame_painting_l,
    'gate_door': gate_door, 'pedestal': pedestal, 'brazier': brazier, 'banner_pole': banner_pole,
    'torch_sconce': torch_sconce, 'bench': bench, 'bookcase': bookcase,
}


def build(name):
    if name not in PIECES:
        raise SystemExit(f'unknown piece {name}; known: {sorted(PIECES)}')
    return PIECES[name]()
