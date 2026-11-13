# CRESTBOUND — THE KEEP architecture kit: shared bpy library (Blender 5.1, headless).
#
#   "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup
#       --python build_kit.py -- --piece wall_panel --tex 2048
#
# Everything is modelled from primitives + modifiers in bpy, textured with procedural node
# materials that are BAKED (albedo / tangent normal / ORM) to one atlas per piece, exported
# as a GLB (Draco OFF, +Y up, metres, origin at the base) and photographed on an Eevee
# turntable (8 angles + a close-up). Nothing here touches the runtime.
#
# Conventions inside Blender (Z-up): X = width, -Y = the FRONT of a piece (the face that
# looks into the room), Z = up. The glTF exporter maps Blender (x, y, z) -> glTF (x, z, -y),
# so a front at Blender -Y lands on glTF +Z, which is the local frame builders.js uses for
# paintings and gate doors (their trigger volume sits at local +Z). A stair module climbs
# toward Blender -Y == glTF +Z, matching buildStairs (step i at z = -D/2 + (i+0.5)*run).
import bpy, bmesh, math, os, sys, json, time, random, struct
from math import radians, sin, cos, pi, atan2, sqrt
from mathutils import Vector, Matrix, Euler, Quaternion
import numpy as np

KIT = 'keep'
ROOT = 'C:/Users/TestRun/Claude Claw/forgeflow-games/games/crestbound'
OUT_DIR = f'{ROOT}/assets/models/{KIT}'
TT_DIR = f'{OUT_DIR}/_turntable'
MAN_DIR = f'{OUT_DIR}/_manifest'
SCRATCH = os.environ.get('KEEPKIT_SCRATCH') or os.path.join(os.environ.get('TEMP', '.'), 'keepkit_bake')

FPS = 24
RNG = random.Random(7)


def log(*a):
    print('[kit]', *a, flush=True)


# =============================================================================
# scene
# =============================================================================
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    sc.render.fps = FPS
    sc.frame_start = 1
    sc.frame_end = 1
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    return sc


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def activate(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    return ob


# =============================================================================
# procedural material library (Cycles node trees). Every material reads a per-face
# float attribute `rnd` (0..1, set per PART when it is built) for variation.
# =============================================================================
MATS = {}
GLOW = {}     # material name -> (emissive rgb, strength)   (exported as a separate slot)
DOUBLE = set()  # material names exported double-sided


class NT:
    """tiny node-tree DSL"""
    def __init__(self, mat):
        mat.use_nodes = True
        self.t = mat.node_tree
        self.n = self.t.nodes
        self.l = self.t.links
        for nd in list(self.n):
            self.n.remove(nd)
        self.out = self.n.new('ShaderNodeOutputMaterial')
        self.bsdf = self.n.new('ShaderNodeBsdfPrincipled')
        self.l.new(self.bsdf.outputs['BSDF'], self.out.inputs['Surface'])
        self.x = 0

    def node(self, kind, **kw):
        nd = self.n.new(kind)
        self.x -= 220
        nd.location = (self.x, 0)
        for k, v in kw.items():
            if hasattr(nd, k):
                setattr(nd, k, v)
            elif k in nd.inputs:
                nd.inputs[k].default_value = v
        return nd

    def inp(self, nd, name, v):
        nd.inputs[name].default_value = v
        return nd

    def coord(self, space='Object'):
        tc = self.node('ShaderNodeTexCoord')
        return tc.outputs[space]

    def mapping(self, src, scale=(1, 1, 1), rot=(0, 0, 0), loc=(0, 0, 0)):
        mp = self.node('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = scale
        mp.inputs['Rotation'].default_value = rot
        mp.inputs['Location'].default_value = loc
        self.l.new(src, mp.inputs['Vector'])
        return mp.outputs['Vector']

    def noise(self, vec, scale=5.0, detail=4.0, rough=0.5, dist=0.0):
        nd = self.node('ShaderNodeTexNoise')
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = rough
        nd.inputs['Distortion'].default_value = dist
        self.l.new(vec, nd.inputs['Vector'])
        return nd

    def voronoi(self, vec, scale=5.0, feature='F1', rand=1.0):
        nd = self.node('ShaderNodeTexVoronoi')
        nd.feature = feature
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Randomness'].default_value = rand
        self.l.new(vec, nd.inputs['Vector'])
        return nd

    def wave(self, vec, scale=5.0, distortion=0.0, detail=2.0, wtype='BANDS', direction='X', profile='SIN'):
        nd = self.node('ShaderNodeTexWave')
        nd.wave_type = wtype
        if wtype == 'BANDS':
            nd.bands_direction = direction
        nd.wave_profile = profile
        nd.inputs['Scale'].default_value = scale
        nd.inputs['Distortion'].default_value = distortion
        nd.inputs['Detail'].default_value = detail
        self.l.new(vec, nd.inputs['Vector'])
        return nd

    def ramp(self, fac, stops):
        """stops: [(pos, (r,g,b,a))]"""
        nd = self.node('ShaderNodeValToRGB')
        cr = nd.color_ramp
        cr.interpolation = 'LINEAR'
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]
        cr.elements[0].color = stops[0][1]
        for p, c in stops[1:]:
            e = cr.elements.new(p)
            e.color = c
        self.l.new(fac, nd.inputs['Fac'])
        return nd

    def mix(self, a, b, fac, blend='MIX'):
        nd = self.node('ShaderNodeMix')
        nd.data_type = 'RGBA'
        nd.blend_type = blend
        if isinstance(fac, (int, float)):
            nd.inputs['Factor'].default_value = fac
        else:
            self.l.new(fac, nd.inputs['Factor'])
        for sock, v in ((nd.inputs[6], a), (nd.inputs[7], b)):   # A, B colour sockets
            if isinstance(v, tuple):
                sock.default_value = v if len(v) == 4 else (v[0], v[1], v[2], 1.0)
            else:
                self.l.new(v, sock)
        return nd.outputs[2]  # Result (colour)

    def math(self, op, a, b=None, c=None):
        nd = self.node('ShaderNodeMath')
        nd.operation = op
        nd.use_clamp = False
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                nd.inputs[i].default_value = v
            else:
                self.l.new(v, nd.inputs[i])
        return nd.outputs[0]

    def attr(self, name='rnd'):
        nd = self.node('ShaderNodeAttribute')
        nd.attribute_name = name
        nd.attribute_type = 'GEOMETRY'
        return nd.outputs['Fac']

    def bump(self, height, strength=0.2, distance=0.02, prev=None):
        nd = self.node('ShaderNodeBump')
        nd.inputs['Strength'].default_value = strength
        nd.inputs['Distance'].default_value = distance
        self.l.new(height, nd.inputs['Height'])
        if prev is not None:
            self.l.new(prev, nd.inputs['Normal'])
        return nd.outputs['Normal']

    def base(self, color):
        if isinstance(color, tuple):
            self.bsdf.inputs['Base Color'].default_value = (color[0], color[1], color[2], 1.0)
        else:
            self.l.new(color, self.bsdf.inputs['Base Color'])

    def rough(self, v):
        if isinstance(v, (int, float)):
            self.bsdf.inputs['Roughness'].default_value = v
        else:
            self.l.new(v, self.bsdf.inputs['Roughness'])

    def metal(self, v):
        if isinstance(v, (int, float)):
            self.bsdf.inputs['Metallic'].default_value = v
        else:
            self.l.new(v, self.bsdf.inputs['Metallic'])

    def normal(self, sock):
        self.l.new(sock, self.bsdf.inputs['Normal'])

    def emit(self, color, strength):
        self.bsdf.inputs['Emission Color'].default_value = (color[0], color[1], color[2], 1.0)
        self.bsdf.inputs['Emission Strength'].default_value = strength


def _c(hexv, mul=1.0):
    """0xRRGGBB (sRGB) -> linear rgb tuple"""
    r, g, b = (hexv >> 16) & 255, (hexv >> 8) & 255, hexv & 255
    def lin(u):
        u /= 255.0
        return (u / 12.92 if u <= 0.04045 else ((u + 0.055) / 1.055) ** 2.4) * mul
    return (lin(r), lin(g), lin(b))


def mat(name):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    t = NT(m)
    rnd = t.attr('rnd')
    obj = t.coord('Object')

    if name == 'stone':
        # warm coursed ashlar: per-block stone from a 4-tint palette (rnd), mottle, base weathering,
        # a hewn low-frequency undulation + grit + chips in the bump
        v = t.mapping(obj, scale=(1, 1, 1))
        n1 = t.noise(v, scale=2.4, detail=5, rough=0.55)
        pal = t.ramp(rnd, [(0.0, (*_c(0xa8906a), 1)), (0.3, (*_c(0xb8a685), 1)), (0.55, (*_c(0x8f8270), 1)),
                            (0.8, (*_c(0xa88c72), 1)), (1.0, (*_c(0x9c8768), 1))])
        col = t.mix(pal.outputs['Color'], _c(0x6f5f4a), t.math('MULTIPLY', n1.outputs['Fac'], 0.5))
        mottle = t.noise(v, scale=9, detail=3)
        col = t.mix(col, _c(0xc4b08a), t.math('MULTIPLY', t.math('POWER', mottle.outputs['Fac'], 2.0), 0.35))
        sep = t.node('ShaderNodeSeparateXYZ')
        t.l.new(obj, sep.inputs['Vector'])
        weather = t.ramp(t.math('MULTIPLY', sep.outputs['Z'], 0.9), [(0.0, (0.62, 0.58, 0.52, 1)), (1.0, (1, 1, 1, 1))])
        col = t.mix(col, _c(0x4e4234), t.math('SUBTRACT', 1.0, weather.outputs['Color']))
        t.base(col)
        t.rough(t.math('ADD', 0.70, t.math('MULTIPLY', n1.outputs['Fac'], 0.24)))
        hewn = t.noise(v, scale=3.5, detail=2, rough=0.4)
        grit = t.noise(v, scale=40, detail=8, rough=0.7)
        chips = t.voronoi(v, scale=13, feature='DISTANCE_TO_EDGE')
        h = t.math('ADD', t.math('MULTIPLY', grit.outputs['Fac'], 0.35),
                   t.math('MULTIPLY', t.math('SMOOTH_MIN', chips.outputs['Distance'], 0.05, 0.02), 1.8))
        nrm = t.bump(hewn.outputs['Fac'], strength=0.8, distance=0.09)
        t.normal(t.bump(h, strength=0.5, distance=0.02, prev=nrm))

    elif name == 'mortar':
        v = t.mapping(obj, scale=(1, 1, 1))
        n = t.noise(v, scale=30, detail=6)
        col = t.mix(_c(0x5e5347), _c(0x7a6e5f), t.math('MULTIPLY', n.outputs['Fac'], 0.7))
        t.base(col)
        t.rough(0.95)
        t.normal(t.bump(n.outputs['Fac'], strength=0.8, distance=0.03))

    elif name == 'marble':
        v = t.mapping(obj, scale=(1, 1, 1))
        dist = t.noise(v, scale=1.6, detail=4, rough=0.6)
        veins = t.wave(v, scale=0.9, distortion=6.0, detail=3.0, wtype='BANDS', direction='DIAGONAL')
        vr = t.ramp(veins.outputs['Fac'], [(0.0, (1, 1, 1, 1)), (0.42, (1, 1, 1, 1)), (0.5, (0.55, 0.5, 0.42, 1)), (0.58, (1, 1, 1, 1)), (1.0, (1, 1, 1, 1))])
        cream = _c(0xd2bf96)
        deep = _c(0xb9a47c)
        col = t.mix(cream, deep, t.math('MULTIPLY', dist.outputs['Fac'], 0.5))
        col = t.mix(col, _c(0x8d7c5f), t.math('SUBTRACT', 1.0, vr.outputs['Color']))
        col = t.mix(col, _c(0xe2d2ab), t.math('MULTIPLY', rnd, 0.25))
        t.base(col)
        t.rough(t.math('ADD', 0.30, t.math('MULTIPLY', dist.outputs['Fac'], 0.12)))
        fine = t.noise(v, scale=60, detail=6)
        t.normal(t.bump(fine.outputs['Fac'], strength=0.12, distance=0.006))

    elif name == 'timber':
        # amber oak: streaked grain along local X, knots from voronoi, per-plank tint
        v = t.mapping(obj, scale=(0.9, 9.0, 9.0))
        grain = t.noise(v, scale=1.0, detail=6, rough=0.62)
        v2 = t.mapping(obj, scale=(1, 1, 1))
        bands = t.wave(v2, scale=6.0, distortion=1.8, detail=2.0, wtype='BANDS', direction='X')
        amber = _c(0xc09056)
        dark = _c(0x7a4f28)
        light = _c(0xd8ad74)
        col = t.mix(amber, dark, t.math('MULTIPLY', grain.outputs['Fac'], 0.75))
        col = t.mix(col, light, t.math('MULTIPLY', bands.outputs['Fac'], 0.22))
        col = t.mix(col, dark, t.math('MULTIPLY', rnd, 0.3))
        t.base(col)
        t.rough(t.math('ADD', 0.48, t.math('MULTIPLY', grain.outputs['Fac'], 0.3)))
        t.normal(t.bump(t.math('ADD', t.math('MULTIPLY', grain.outputs['Fac'], 0.7), t.math('MULTIPLY', bands.outputs['Fac'], 0.4)),
                        strength=0.6, distance=0.03))

    elif name == 'iron':
        v = t.mapping(obj, scale=(1, 1, 1))
        ham = t.voronoi(v, scale=32, feature='SMOOTH_F1')
        n = t.noise(v, scale=9, detail=5)
        col = t.mix(_c(0x2a2a2e), _c(0x4a4642), t.math('MULTIPLY', n.outputs['Fac'], 0.6))
        col = t.mix(col, _c(0x6b4a33), t.math('MULTIPLY', t.math('POWER', n.outputs['Fac'], 3.0), 0.5))  # rust bloom
        t.base(col)
        t.metal(0.82)
        t.rough(t.math('ADD', 0.42, t.math('MULTIPLY', n.outputs['Fac'], 0.32)))
        t.normal(t.bump(ham.outputs['Distance'], strength=0.7, distance=0.03))

    elif name == 'gilt':
        v = t.mapping(obj, scale=(1, 1, 1))
        n = t.noise(v, scale=7, detail=5)
        col = t.mix(_c(0xf3c65a), _c(0xb98a2e), t.math('MULTIPLY', n.outputs['Fac'], 0.7))
        col = t.mix(col, _c(0x7d5a1e), t.math('MULTIPLY', t.math('POWER', n.outputs['Fac'], 4.0), 0.6))
        t.base(col)
        t.metal(1.0)
        t.rough(t.math('ADD', 0.22, t.math('MULTIPLY', n.outputs['Fac'], 0.25)))
        fine = t.noise(v, scale=90, detail=4)
        t.normal(t.bump(fine.outputs['Fac'], strength=0.15, distance=0.006))

    elif name == 'brass':
        v = t.mapping(obj, scale=(1, 1, 1))
        n = t.noise(v, scale=11, detail=4)
        col = t.mix(_c(0xd9a648), _c(0x8c6a2a), t.math('MULTIPLY', n.outputs['Fac'], 0.7))
        t.base(col)
        t.metal(1.0)
        t.rough(t.math('ADD', 0.30, t.math('MULTIPLY', n.outputs['Fac'], 0.3)))

    elif name == 'cloth':
        # near-white cream so the runtime can tint it per realm (material.color multiply)
        v = t.mapping(obj, scale=(1, 1, 1))
        wa = t.wave(v, scale=140, wtype='BANDS', direction='X')
        wb = t.wave(v, scale=140, wtype='BANDS', direction='Z')
        weave = t.math('MULTIPLY', wa.outputs['Fac'], wb.outputs['Fac'])
        n = t.noise(v, scale=3, detail=3)
        col = t.mix(_c(0xe9dcc2), _c(0xc9b894), t.math('MULTIPLY', n.outputs['Fac'], 0.5))
        t.base(col)
        t.rough(0.92)
        t.normal(t.bump(weave, strength=0.3, distance=0.004))
        DOUBLE.add(name)

    elif name == 'crimson':
        v = t.mapping(obj, scale=(1, 1, 1))
        n = t.noise(v, scale=3, detail=3)
        col = t.mix(_c(0x8e1f2a), _c(0x5b1219), t.math('MULTIPLY', n.outputs['Fac'], 0.6))
        t.base(col)
        t.rough(0.9)
        DOUBLE.add(name)

    elif name == 'books':
        # each book gets its own rnd -> a hue from a rich palette, a darker spine band
        pal = t.ramp(rnd, [(0.0, (*_c(0x7a2a25), 1)), (0.2, (*_c(0x2c4a6e), 1)), (0.4, (*_c(0x4a6b34), 1)),
                            (0.6, (*_c(0xb08540), 1)), (0.8, (*_c(0x5c3a2a), 1)), (1.0, (*_c(0x8a3d5e), 1))])
        pal.color_ramp.interpolation = 'CONSTANT'
        v = t.mapping(obj, scale=(1, 1, 1))
        n = t.noise(v, scale=25, detail=3)
        col = t.mix(pal.outputs['Color'], _c(0x1c140e), t.math('MULTIPLY', n.outputs['Fac'], 0.35))
        t.base(col)
        t.rough(0.68)

    elif name == 'parchment':
        v = t.mapping(obj, scale=(1, 1, 1))
        n = t.noise(v, scale=30, detail=4)
        col = t.mix(_c(0xe8dcbb), _c(0xc8b88e), t.math('MULTIPLY', n.outputs['Fac'], 0.7))
        t.base(col)
        t.rough(0.85)

    elif name == 'canvas':
        t.base(_c(0x6f665a))
        t.rough(0.72)

    elif name == 'glass_amber':
        t.base(_c(0xffb25a))
        t.rough(0.18)
        GLOW[name] = (_c(0xffa040), 3.2)

    elif name == 'glass_day':
        t.base(_c(0xbcd6ea))
        t.rough(0.08)
        GLOW[name] = (_c(0xdcebff), 0.6)

    elif name == 'ember':
        t.base(_c(0xff7a2a))
        t.rough(0.6)
        GLOW[name] = (_c(0xff8a3c), 2.4)

    elif name == 'stripe':
        # the landable-edge stripe slot: brass in the bake, a soft keep-gold emissive on export
        t.base(_c(0xf3d489))
        t.metal(0.6)
        t.rough(0.35)
        GLOW[name] = (_c(0xf3d489), 0.9)

    elif name == 'rune':
        t.base(_c(0xf3d489))
        t.rough(0.4)
        GLOW[name] = (_c(0xf3d489), 0.5)

    else:
        raise KeyError('unknown material ' + name)

    MATS[name] = m
    return m


# =============================================================================
# geometry builders. Every builder returns a mesh object linked to the scene with ONE
# material, a per-face `rnd` attribute and (optionally) a vertex group for a bone.
# =============================================================================
def _finish(ob, matname, rnd=None, vg=None, smooth=False):
    ob.data.materials.append(mat(matname))
    a = ob.data.attributes.new('rnd', 'FLOAT', 'FACE')
    val = RNG.random() if rnd is None else float(rnd)
    a.data.foreach_set('value', [val] * len(ob.data.polygons))
    if vg:
        g = ob.vertex_groups.new(name=vg)
        g.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    ob['kit_smooth'] = bool(smooth)
    return ob


def bevel(ob, width=0.02, segments=1, angle=30.0):
    if width <= 0:
        return ob
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    m.angle_limit = radians(angle)
    m.miter_outer = 'MITER_ARC' if segments > 1 else 'MITER_SHARP'
    return ob


def mesh_obj(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    return link(ob)


def box(name, size, at=(0, 0, 0), rot=(0, 0, 0), bev=0.02, seg=1, mat='stone', anchor='bottom', rnd=None, vg=None, smooth=False):
    sx, sy, sz = size
    z0 = 0.0 if anchor == 'bottom' else -sz / 2
    v = [(-sx/2, -sy/2, z0), (sx/2, -sy/2, z0), (sx/2, sy/2, z0), (-sx/2, sy/2, z0),
         (-sx/2, -sy/2, z0+sz), (sx/2, -sy/2, z0+sz), (sx/2, sy/2, z0+sz), (-sx/2, sy/2, z0+sz)]
    f = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ob = mesh_obj(name, v, f)
    ob.location = at
    ob.rotation_euler = rot
    bevel(ob, min(bev, sx * 0.45, sy * 0.45, sz * 0.45), seg)
    return _finish(ob, mat, rnd, vg, smooth)


def lathe(name, profile, segs=24, at=(0, 0, 0), rot=(0, 0, 0), mat='stone', rnd=None, vg=None, smooth=True, radial=None):
    """profile: [(r, z)] bottom->top. r==0 makes a pole. `radial(theta)->scale` modulates r (fluting)."""
    verts, faces = [], []
    rows = []
    for (r, z) in profile:
        if r <= 1e-6:
            rows.append(('pole', len(verts)))
            verts.append((0.0, 0.0, z))
        else:
            start = len(verts)
            for i in range(segs):
                th = 2 * pi * i / segs
                rr = r * (radial(th) if radial else 1.0)
                verts.append((rr * cos(th), rr * sin(th), z))
            rows.append(('ring', start))
    for a, b in zip(rows, rows[1:]):
        ka, ia = a
        kb, ib = b
        if ka == 'ring' and kb == 'ring':
            for i in range(segs):
                j = (i + 1) % segs
                faces.append((ia + i, ia + j, ib + j, ib + i))
        elif ka == 'pole' and kb == 'ring':
            for i in range(segs):
                j = (i + 1) % segs
                faces.append((ia, ib + j, ib + i))
        elif ka == 'ring' and kb == 'pole':
            for i in range(segs):
                j = (i + 1) % segs
                faces.append((ia + i, ia + j, ib))
    ob = mesh_obj(name, verts, faces)
    ob.location = at
    ob.rotation_euler = rot
    return _finish(ob, mat, rnd, vg, smooth)


def cyl(name, r, h, segs=16, at=(0, 0, 0), rot=(0, 0, 0), mat='stone', rnd=None, vg=None, smooth=True, r2=None, bev=0.0, seg=1):
    r2 = r if r2 is None else r2
    prof = [(0, 0), (r, 0), (r2, h), (0, h)]
    ob = lathe(name, prof, segs, at, rot, mat, rnd, vg, smooth)
    if bev > 0:
        bevel(ob, bev, seg)
    return ob


def sweep(name, pts, w, h, mat='timber', rnd=None, vg=None, up=(0, 0, 1), at=(0, 0, 0), rot=(0, 0, 0), smooth=False, closed=False, bev=0.0):
    """rectangular section (w across, h along `up`) swept along a polyline"""
    P = [Vector(p) for p in pts]
    n = len(P)
    upv = Vector(up)
    verts, faces = [], []
    for i in range(n):
        if closed:
            tan = (P[(i + 1) % n] - P[i - 1]).normalized()
        else:
            tan = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized()
        u = upv if abs(tan.dot(upv)) < 0.95 else Vector((0, 1, 0))
        side = tan.cross(u).normalized()
        nrm = side.cross(tan).normalized()
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append(tuple(P[i] + side * (sx * w / 2) + nrm * (sy * h / 2)))
    rings = n if closed else n - 1
    for i in range(rings):
        a = i * 4
        b = ((i + 1) % n) * 4
        for k in range(4):
            j = (k + 1) % 4
            faces.append((a + k, a + j, b + j, b + k))
    if not closed:
        faces.append((0, 3, 2, 1))
        e = (n - 1) * 4
        faces.append((e, e + 1, e + 2, e + 3))
    ob = mesh_obj(name, verts, faces)
    ob.location = at
    ob.rotation_euler = rot
    if bev > 0:
        bevel(ob, bev, 1)
    return _finish(ob, mat, rnd, vg, smooth)


def torus(name, R, r, segs=24, rsegs=8, at=(0, 0, 0), rot=(0, 0, 0), mat='iron', rnd=None, vg=None):
    verts, faces = [], []
    for i in range(segs):
        th = 2 * pi * i / segs
        for j in range(rsegs):
            ph = 2 * pi * j / rsegs
            rr = R + r * cos(ph)
            verts.append((rr * cos(th), rr * sin(th), r * sin(ph)))
    for i in range(segs):
        for j in range(rsegs):
            a = i * rsegs + j
            b = i * rsegs + (j + 1) % rsegs
            c = ((i + 1) % segs) * rsegs + (j + 1) % rsegs
            d = ((i + 1) % segs) * rsegs + j
            faces.append((a, b, c, d))
    ob = mesh_obj(name, verts, faces)
    ob.location = at
    ob.rotation_euler = rot
    return _finish(ob, mat, rnd, vg, smooth=True)


def prism(name, r, h, n=6, at=(0, 0, 0), rot=(0, 0, 0), mat='iron', rnd=None, vg=None, bev=0.0):
    return cyl(name, r, h, n, at, rot, mat, rnd, vg, smooth=False, bev=bev)


def polyplate(name, pts2d, thick, at=(0, 0, 0), rot=(0, 0, 0), mat='iron', rnd=None, vg=None, bev=0.0, seg=1):
    """an extruded 2D polygon (in local XZ, extruded along -Y so the face looks front)."""
    n = len(pts2d)
    verts = [(x, 0.0, z) for x, z in pts2d] + [(x, -thick, z) for x, z in pts2d]
    faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
    for i in range(n):
        j = (i + 1) % n
        faces.append((j, i, i + n, j + n))
    ob = mesh_obj(name, verts, faces)
    ob.location = at
    ob.rotation_euler = rot
    if bev > 0:
        bevel(ob, bev, seg)
    return _finish(ob, mat, rnd, vg)


def arc_pts(cx, cz, R, a0, a1, n):
    """points (x, z) on a circle from angle a0 to a1 (radians)"""
    return [(cx + R * cos(a0 + (a1 - a0) * i / (n - 1)), cz + R * sin(a0 + (a1 - a0) * i / (n - 1))) for i in range(n)]


class PointedArch:
    """a two-centred (pointed) arch of half-span `a` and rise `h` over the springing line.
    centres sit ON the springing line at x = -+c, radius R = a + c."""
    def __init__(self, a, h):
        self.a, self.h = a, h
        self.c = (h * h - a * a) / (2 * a)
        self.R = a + self.c
        # right-hand arc: centre (-c, 0), from angle 0 (x=a) to the apex angle
        self.apex = atan2(h, self.c)

    def right(self, t):
        """t 0..1 along the right arc from the springing to the apex -> (x, z, tangent angle)"""
        th = self.apex * t
        x = -self.c + self.R * cos(th)
        z = self.R * sin(th)
        return x, z, th + pi / 2

    def z_at(self, x):
        x = abs(x)
        if x > self.a:
            return 0.0
        dx = x + self.c
        return sqrt(max(0.0, self.R * self.R - dx * dx))


def flute_radial(nflute=12, depth=0.10):
    def f(th):
        return 1.0 - depth * (0.5 + 0.5 * cos(nflute * th)) ** 1.6
    return f


# =============================================================================
# piece assembly: join, sharp edges, UVs
# =============================================================================
def apply_mods(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def join(parts, name):
    """join every part into the first one, then bake its transform out so the result sits at the origin"""
    for p in parts:
        apply_mods(p)
    first = parts[0]
    objs = list(parts)
    activate(first)
    for o in objs:
        o.select_set(True)
    with bpy.context.temp_override(active_object=first, selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    first.data.transform(first.matrix_world)
    first.matrix_world = Matrix.Identity(4)
    first.name = name
    first.data.name = name
    slots = [(i, m.name if m else None) for i, m in enumerate(first.data.materials)]
    log('join ->', len(first.data.polygons), 'faces, slots', slots)
    return first


def mark_sharp_and_smooth(ob, angle=35.0):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    thr = radians(angle)
    for e in bm.edges:
        if len(e.link_faces) == 2:
            a = e.calc_face_angle(0.0)
            e.smooth = a < thr
        else:
            e.smooth = False
    for f in bm.faces:
        f.smooth = True
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def unwrap(ob, margin=0.004, angle=66.0):
    activate(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=radians(angle), island_margin=margin, correct_aspect=True, scale_to_bounds=False)
    try:
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(rotate=True, margin=margin, shape_method='CONCAVE', margin_method='FRACTION')
        log('uv: pack_islands ok')
    except Exception as ex:
        log('uv: pack_islands unavailable ->', ex)
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def set_uv_rect(ob, face_filter, u0=0, v0=0, u1=1, v1=1):
    """force a quad's UVs to a rectangle (the painting canvas plate maps 0..1)."""
    uv = ob.data.uv_layers.active.data
    for p in ob.data.polygons:
        if not face_filter(p):
            continue
        co = [ob.data.vertices[v].co for v in p.vertices]
        xs = [c.x for c in co]; zs = [c.z for c in co]
        for li, c in zip(p.loop_indices, co):
            u = u0 + (u1 - u0) * (c.x - min(xs)) / max(1e-6, max(xs) - min(xs))
            v = v0 + (v1 - v0) * (c.z - min(zs)) / max(1e-6, max(zs) - min(zs))
            uv[li].uv = (u, v)


# =============================================================================
# baking
# =============================================================================
def _find(nodes, kind):
    for n in nodes:
        if n.bl_idname == kind:
            return n
    return None


class EmitChannel:
    """temporarily route a Principled input to an Emission shader so EMIT bakes that channel"""
    def __init__(self, mats, channel):
        self.mats, self.ch = mats, channel
        self.tmp = []

    def __enter__(self):
        for m in self.mats:
            nodes, links = m.node_tree.nodes, m.node_tree.links
            bsdf = _find(nodes, 'ShaderNodeBsdfPrincipled')
            out = _find(nodes, 'ShaderNodeOutputMaterial')
            em = nodes.new('ShaderNodeEmission')
            em.name = 'BAKE_EMIT'
            sock = bsdf.inputs[self.ch]
            if sock.is_linked:
                links.new(sock.links[0].from_socket, em.inputs['Color'])
            else:
                v = sock.default_value
                if isinstance(v, float):
                    em.inputs['Color'].default_value = (v, v, v, 1.0)
                else:
                    em.inputs['Color'].default_value = (v[0], v[1], v[2], 1.0)
            em.inputs['Strength'].default_value = 1.0
            links.new(em.outputs['Emission'], out.inputs['Surface'])
            self.tmp.append((m, em, bsdf, out))
        return self

    def __exit__(self, *a):
        for m, em, bsdf, out in self.tmp:
            m.node_tree.nodes.remove(em)
            m.node_tree.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])


def _np(img):
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(h, w, 4)


def _set(img, a):
    img.pixels.foreach_set(a.astype(np.float32).ravel())


def bake_maps(ob, piece, tex):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_adaptive_sampling = False
    sc.cycles.use_denoising = False
    bk = sc.render.bake
    bk.margin = 10
    bk.margin_type = 'EXTEND'
    bk.use_clear = True
    bk.target = 'IMAGE_TEXTURES'
    bk.use_selected_to_active = False
    bk.normal_space = 'TANGENT'
    ws = sc.world
    if hasattr(ws, 'light_settings') and hasattr(ws.light_settings, 'distance'):
        ws.light_settings.distance = 0.45
    mats = [m for m in ob.data.materials if m is not None]
    os.makedirs(SCRATCH, exist_ok=True)

    def new_img(kind, data):
        nm = f'{piece}_{kind}'
        if nm in bpy.data.images:
            bpy.data.images.remove(bpy.data.images[nm])
        img = bpy.data.images.new(nm, tex, tex, alpha=False, float_buffer=False)
        img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
        return img

    def target(img):
        for m in mats:
            nodes = m.node_tree.nodes
            t = nodes.get('BAKE_TARGET')
            if t is None:
                t = nodes.new('ShaderNodeTexImage')
                t.name = 'BAKE_TARGET'
                t.location = (400, -400)
            t.image = img
            for n in nodes:
                n.select = False
            t.select = True
            nodes.active = t

    for o in sc.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    ctx = dict(active_object=ob, selected_objects=[ob], selected_editable_objects=[ob], object=ob)

    t0 = time.time()
    alb = new_img('albedo', False)
    target(alb)
    with EmitChannel(mats, 'Base Color'):
        sc.cycles.samples = 4
        with bpy.context.temp_override(**ctx):
            bpy.ops.object.bake(type='EMIT')
    log(f'bake albedo {time.time()-t0:.1f}s')

    t0 = time.time()
    rough = new_img('rough', True)
    target(rough)
    with EmitChannel(mats, 'Roughness'):
        sc.cycles.samples = 2
        with bpy.context.temp_override(**ctx):
            bpy.ops.object.bake(type='EMIT')
    metal = new_img('metal', True)
    target(metal)
    with EmitChannel(mats, 'Metallic'):
        sc.cycles.samples = 2
        with bpy.context.temp_override(**ctx):
            bpy.ops.object.bake(type='EMIT')
    log(f'bake rough+metal {time.time()-t0:.1f}s')

    t0 = time.time()
    nrm = new_img('normal', True)
    target(nrm)
    sc.cycles.samples = 4
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
    log(f'bake normal {time.time()-t0:.1f}s')

    t0 = time.time()
    ao = new_img('ao', True)
    target(ao)
    sc.cycles.samples = 24
    with bpy.context.temp_override(**ctx):
        bpy.ops.object.bake(type='AO')
    log(f'bake ao {time.time()-t0:.1f}s')

    # --- pack ORM (R = occlusion, G = roughness, B = metallic) + a light cavity tint on albedo
    A = _np(alb); Rg = _np(rough); Mt = _np(metal); Ao = _np(ao)
    orm = np.ones_like(A)
    orm[..., 0] = np.clip(Ao[..., 0], 0, 1)
    orm[..., 1] = np.clip(Rg[..., 0], 0, 1)
    orm[..., 2] = np.clip(Mt[..., 0], 0, 1)
    ormimg = new_img('orm', True)
    _set(ormimg, orm)
    cav = 0.78 + 0.22 * np.clip(Ao[..., :1], 0, 1)
    A[..., :3] = np.clip(A[..., :3] * cav, 0, 1)
    _set(alb, A)

    def save(img, kind):
        p = os.path.join(SCRATCH, f'{piece}_{kind}.png')
        img.filepath_raw = p
        img.file_format = 'PNG'
        img.save()
        return p

    paths = {'albedo': save(alb, 'albedo'), 'normal': save(nrm, 'normal'), 'orm': save(ormimg, 'orm')}
    for m in mats:
        t = m.node_tree.nodes.get('BAKE_TARGET')
        if t:
            m.node_tree.nodes.remove(t)
    for im in (rough, metal, ao):
        bpy.data.images.remove(im)
    return {'albedo': alb, 'normal': nrm, 'orm': ormimg, 'paths': paths}


# =============================================================================
# export materials (baked) + GLB
# =============================================================================
def _gltf_settings_group():
    name = 'glTF Material Output'
    g = bpy.data.node_groups.get(name)
    if g:
        return g
    g = bpy.data.node_groups.new(name, 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    gi = g.nodes.new('NodeGroupInput')
    go = g.nodes.new('NodeGroupOutput')
    return g


def export_material(name, maps, emissive=None, strength=0.0, double_sided=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    for n in list(nodes):
        nodes.remove(n)
    out = nodes.new('ShaderNodeOutputMaterial'); out.location = (600, 0)
    bsdf = nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location = (300, 0)
    links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    ta = nodes.new('ShaderNodeTexImage'); ta.image = maps['albedo']; ta.location = (-400, 300)
    ta.image.colorspace_settings.name = 'sRGB'
    links.new(ta.outputs['Color'], bsdf.inputs['Base Color'])
    tn = nodes.new('ShaderNodeTexImage'); tn.image = maps['normal']; tn.location = (-400, -300)
    tn.image.colorspace_settings.name = 'Non-Color'
    nm = nodes.new('ShaderNodeNormalMap'); nm.location = (-100, -300)
    nm.inputs['Strength'].default_value = 1.0
    links.new(tn.outputs['Color'], nm.inputs['Color'])
    links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    to = nodes.new('ShaderNodeTexImage'); to.image = maps['orm']; to.location = (-400, 0)
    to.image.colorspace_settings.name = 'Non-Color'
    sep = nodes.new('ShaderNodeSeparateColor'); sep.location = (-150, 0)
    links.new(to.outputs['Color'], sep.inputs['Color'])
    links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    grp = nodes.new('ShaderNodeGroup'); grp.node_tree = _gltf_settings_group(); grp.location = (300, -400)
    links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    if emissive is not None:
        bsdf.inputs['Emission Color'].default_value = (emissive[0], emissive[1], emissive[2], 1.0)
        bsdf.inputs['Emission Strength'].default_value = strength
    else:
        bsdf.inputs['Emission Strength'].default_value = 0.0
    m.use_backface_culling = not double_sided
    return m


def remap_materials(ob, piece, maps):
    """collapse the procedural slots into baked export slots: `<piece>` (pbr) + one per glow material"""
    old = [m for m in ob.data.materials]
    newmats = {}
    slot_of = {}
    pbr = export_material(f'{piece}', maps, double_sided=any(m and m.name in DOUBLE for m in old))
    newmats[pbr.name] = pbr
    order = [pbr]
    for i, m in enumerate(old):
        if m is None:
            slot_of[i] = 0
            continue
        if m.name in GLOW:
            key = f'{piece}_{m.name}'
            if key not in newmats:
                col, stren = GLOW[m.name]
                newmats[key] = export_material(key, maps, emissive=col, strength=stren, double_sided=m.name in DOUBLE)
                order.append(newmats[key])
            slot_of[i] = order.index(newmats[key])
        else:
            slot_of[i] = 0
    idx = np.empty(len(ob.data.polygons), dtype=np.int32)
    ob.data.polygons.foreach_get('material_index', idx)
    idx = np.array([slot_of.get(int(i), 0) for i in idx], dtype=np.int32)
    ob.data.materials.clear()
    for m in order:
        ob.data.materials.append(m)
    ob.data.polygons.foreach_set('material_index', idx)
    ob.data.update()
    return [m.name for m in order]


def export_glb(objs, path):
    sc = bpy.context.scene
    for o in sc.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_apply=True, export_yup=True,
        export_animations=True, export_skins=True, export_animation_mode='ACTIONS',
        export_nla_strips=True, export_force_sampling=True, export_optimize_animation_size=True,
        export_draco_mesh_compression_enable=False,
        export_image_format='WEBP', export_image_quality=86,
        export_normals=True, export_texcoords=True, export_materials='EXPORT',
        export_extras=False, export_lights=False, export_tangents=False,
    )
    return os.path.getsize(path)


# =============================================================================
# measurement
# =============================================================================
def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def bounds_gltf(objs):
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            w = ob.matrix_world @ v.co
            g = Vector((w.x, w.z, -w.y))       # Blender -> glTF (+Y up)
            mn = Vector((min(mn.x, g.x), min(mn.y, g.y), min(mn.z, g.z)))
            mx = Vector((max(mx.x, g.x), max(mx.y, g.y), max(mx.z, g.z)))
    r = lambda v: [round(v.x, 3), round(v.y, 3), round(v.z, 3)]
    return {'min': r(mn), 'max': r(mx), 'size': r(mx - mn)}


# =============================================================================
# rigging
# =============================================================================
def make_armature(name, bones):
    """bones: [(name, head, tail, parent)] in Blender coords"""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    link(ob)
    bpy.context.view_layer.objects.active = ob
    with bpy.context.temp_override(active_object=ob, object=ob, selected_objects=[ob]):
        bpy.ops.object.mode_set(mode='EDIT')
        eb = {}
        for bn, head, tail, parent in bones:
            b = arm.edit_bones.new(bn)
            b.head = head
            b.tail = tail
            if parent:
                b.parent = eb[parent]
            eb[bn] = b
        bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def skin(mesh_ob, arm_ob):
    mesh_ob.parent = arm_ob
    md = mesh_ob.modifiers.new('Armature', 'ARMATURE')
    md.object = arm_ob
    return mesh_ob


def action_fcurves(act, slot=None):
    """Blender 4.4+ removed Action.fcurves (slotted actions): the curves live under
    layers[].strips[].channelbag(slot).fcurves. Returns a flat list, old API or new."""
    fcs = getattr(act, 'fcurves', None)
    if fcs is not None:
        return list(fcs)
    out = []
    slots = list(getattr(act, 'slots', []) or [])
    for lay in act.layers:
        for st in lay.strips:
            if st.type != 'KEYFRAME':
                continue
            bags = []
            if slot is not None:
                bags = [st.channelbag(slot)]
            elif hasattr(st, 'channelbags'):
                bags = list(st.channelbags)
            else:
                bags = [st.channelbag(sl) for sl in slots]
            for cb in bags:
                if cb is not None:
                    out.extend(cb.fcurves)
    return out


def key_action(arm_ob, name, keys, frame_end):
    """keys: {bone: [(frame, (rx,ry,rz))]} euler radians in the bone's local frame. Returns the action."""
    if arm_ob.animation_data is None:
        arm_ob.animation_data_create()
    act = bpy.data.actions.new(name)
    arm_ob.animation_data.action = act
    # Blender 4.4+ slotted actions: make sure the action has a slot for this armature
    try:
        if hasattr(act, 'slots') and len(act.slots) == 0:
            slot = act.slots.new('OBJECT', arm_ob.name)
            arm_ob.animation_data.action_slot = slot
    except Exception as ex:
        log('slot warn', ex)
    for bn, ks in keys.items():
        pb = arm_ob.pose.bones[bn]
        pb.rotation_mode = 'XYZ'
        for f, rot in ks:
            pb.rotation_euler = rot
            pb.keyframe_insert('rotation_euler', frame=f)
    for fc in action_fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    act.use_frame_range = True
    act.frame_start = 1
    act.frame_end = frame_end
    # stash into an NLA track so several clips export
    tr = arm_ob.animation_data.nla_tracks.new()
    tr.name = name
    st = tr.strips.new(name, 1, act)
    st.name = name
    arm_ob.animation_data.action = None
    for pb in arm_ob.pose.bones:
        pb.rotation_euler = (0, 0, 0)
    return act


# =============================================================================
# turntables (Eevee)
# =============================================================================
def _eevee_id():
    ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    for cand in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE'):
        if cand in ids:
            return cand
    return ids[0]


def _look(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render_turntable(objs, piece, closeup=None, frame=1):
    sc = bpy.context.scene
    sc.frame_set(frame)
    eng = _eevee_id()
    sc.render.engine = eng
    if hasattr(sc, 'eevee'):
        for k, v in (('taa_render_samples', 40), ('use_shadows', True)):
            if hasattr(sc.eevee, k):
                setattr(sc.eevee, k, v)
    sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.render.resolution_percentage = 100
    # WEBP, not PNG: a turntable is a REVIEW render, and the same 1024x1024 Eevee frame is
    # 948,655 bytes as PNG against 21,262 as WebP q92 (measured, keep/arch_door_00). The four
    # kits had put ~333 MB of turntable PNGs in the repo; as WebP the same 430 frames are 13.5 MB.
    sc.render.image_settings.file_format = 'WEBP'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.quality = 92
    sc.render.dither_intensity = 0.0
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    sc.view_settings.look = 'None'
    sc.view_settings.exposure = 0.0
    # world: neutral grey
    w = sc.world
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.20, 0.20, 0.21, 1)
        bg.inputs['Strength'].default_value = 1.0

    # bounds (Blender coords)
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for ob in objs:
        if ob.type != 'MESH':
            continue
        for v in ob.data.vertices:
            p = ob.matrix_world @ v.co
            mn = Vector(map(min, mn, p)); mx = Vector(map(max, mx, p))
    ctr = (mn + mx) / 2
    R = max((mx - mn).length / 2, 0.2)
    fov = 2 * atan2(18.0, 50.0)
    d = R / sin(fov / 2) * 1.12

    # backdrop: a big floor at the base of the piece
    floor = mesh_obj('tt_floor', [(-d * 8, -d * 8, mn.z), (d * 8, -d * 8, mn.z), (d * 8, d * 8, mn.z), (-d * 8, d * 8, mn.z)], [(0, 1, 2, 3)])
    fm = bpy.data.materials.new('tt_floor')
    fm.use_nodes = True
    fb = fm.node_tree.nodes['Principled BSDF']
    fb.inputs['Base Color'].default_value = (0.30, 0.30, 0.31, 1)
    fb.inputs['Roughness'].default_value = 0.95
    floor.data.materials.append(fm)

    # three-point rig, scaled to the framing distance
    def light(name, kind, loc, power, size, color=(1, 0.985, 0.96)):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = power
        ld.color = color
        if kind == 'AREA':
            ld.shape = 'SQUARE'
            ld.size = size
        lo = bpy.data.objects.new(name, ld)
        link(lo)
        lo.location = loc
        _look(lo, ctr)
        return lo
    k = d
    lights = [
        light('tt_key', 'AREA', ctr + Vector((-0.9 * k, -1.1 * k, 1.1 * k)), 900 * (k / 5.0) ** 2, k * 0.55),
        light('tt_fill', 'AREA', ctr + Vector((1.3 * k, -0.9 * k, 0.5 * k)), 320 * (k / 5.0) ** 2, k * 0.9, (0.93, 0.96, 1.0)),
        light('tt_rim', 'AREA', ctr + Vector((0.4 * k, 1.3 * k, 1.2 * k)), 700 * (k / 5.0) ** 2, k * 0.45),
    ]
    cam_d = bpy.data.cameras.new('tt_cam')
    cam_d.lens = 50
    cam_d.sensor_fit = 'AUTO'
    cam_d.clip_end = d * 40
    cam = bpy.data.objects.new('tt_cam', cam_d)
    link(cam)
    sc.camera = cam
    os.makedirs(TT_DIR, exist_ok=True)
    out = []
    elev = radians(16)
    for i in range(8):
        # angle 0 = straight at the FRONT (-Y), turning counter-clockwise seen from above
        a = -pi / 2 + i * pi / 4
        cam.location = ctr + Vector((cos(a) * d * cos(elev), sin(a) * d * cos(elev), d * sin(elev)))
        _look(cam, ctr)
        p = os.path.join(TT_DIR, f'{piece}_{i:02d}.webp')
        sc.render.filepath = p
        bpy.ops.render.render(write_still=True)
        out.append(p)
    # close-up: a detail at 55 % height on the front, at a third of the distance
    tgt = Vector(closeup) if closeup else Vector((ctr.x, mn.y, mn.z + (mx.z - mn.z) * 0.55))
    a = -pi / 2 + pi / 5
    cd = max(d * 0.30, 0.45)
    cam.location = tgt + Vector((cos(a) * cd * cos(radians(12)), sin(a) * cd * cos(radians(12)), cd * sin(radians(12))))
    _look(cam, tgt)
    p = os.path.join(TT_DIR, f'{piece}_closeup.webp')
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    out.append(p)
    # tidy
    for o in lights + [cam, floor]:
        bpy.data.objects.remove(o)
    return out


# =============================================================================
# GLB re-import check (fresh scene) — the independent observation
# =============================================================================
def reimport_check(path):
    # Two traps here. (1) read_factory_settings does not guarantee bpy.data is empty, so snapshot
    # first and count only what THIS import created. (2) Blender's glTF IMPORTER builds an 80-tri
    # 'Icosphere' as the POSE-BONE CUSTOM SHAPE for every imported armature — it is not in the file
    # (gate_door.glb has exactly one mesh and five nodes) but it lands in bpy.data, which is why
    # every RIGGED piece reported reimport_ok false while unrigged ones passed. Exclude bone shapes.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    before = {o.name for o in bpy.data.objects}
    before_act = {a.name for a in bpy.data.actions}
    before_img = {i.name for i in bpy.data.images}
    before_mat = {m.name for m in bpy.data.materials}
    bpy.ops.import_scene.gltf(filepath=path)
    new_objs = [o for o in bpy.data.objects if o.name not in before]
    arms = [o for o in new_objs if o.type == 'ARMATURE']
    shapes = set()
    for a in arms:
        for pb in a.pose.bones:
            if pb.custom_shape:
                shapes.add(pb.custom_shape.name)
    meshes = [o for o in new_objs if o.type == 'MESH' and o.name not in shapes]
    tris = sum(tri_count(o) for o in meshes)
    bones = sum(len(a.data.bones) for a in arms)
    acts = [(a.name, round((a.frame_range[1] - a.frame_range[0]) / FPS, 3))
            for a in bpy.data.actions if a.name not in before_act]
    imgs = [(i.name, i.size[0], i.size[1]) for i in bpy.data.images if i.name not in before_img]
    mats = [m.name for m in bpy.data.materials if m.users and m.name not in before_mat]
    return {'meshes': [o.name for o in meshes], 'tris': tris, 'bones': bones, 'clips': acts, 'images': imgs, 'materials': mats}
