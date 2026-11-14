# CRESTBOUND prop kit — headless Blender (5.1) library.
#   modelling (bmesh) -> procedural node materials -> per-realm UV atlas -> Cycles bakes
#   (albedo+alpha / normal / ORM / emissive) -> glTF (separate, Draco OFF, +Y up, metres)
#   -> LOD1 (decimate ~40 %) -> Eevee turntables -> manifest.json measured in bpy.
# Every number in the manifest is MEASURED here (tris, bounds, clip lengths); nothing is typed in.
import bpy, bmesh, math, os, json, time, sys
import numpy as np
from mathutils import Vector, Matrix, Euler, noise

TAU = math.tau
RAD = math.radians
MAT_SPEC = {}          # material name -> dict of bake sources (python side registry)
ATLAS_MATS = {}        # realm -> {'opaque': mat, 'cutout': mat}

# ----------------------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    sc.render.fps = 24
    return sc

def link(ob):
    bpy.context.scene.collection.objects.link(ob)

def select_only(obs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]

def log(*a):
    print('[propkit]', *a, flush=True)

# ----------------------------------------------------------------------------- bmesh primitives
def _mat4(loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    if isinstance(scale, (int, float)):
        scale = (scale, scale, scale)
    return (Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4()
            @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0)))

def xf(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0):
    bmesh.ops.transform(bm, matrix=_mat4(loc, rot, scale), verts=bm.verts[:])
    return bm

def bm_cyl(r1, r2, h, segs=12, base=True, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r1, radius2=r2, depth=h)
    if base:
        bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, h * 0.5))
    return bm

def bm_bevel(bm, offset, segs=1, profile=0.7, angle=None):
    edges = bm.edges[:]
    if angle is not None:
        edges = [e for e in edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > angle]
    if edges and offset > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=offset, offset_type='OFFSET', segments=segs,
                        profile=profile, affect='EDGES', clamp_overlap=True)
    return bm

def bm_box(sx, sy, sz, bevel=0.0, segs=1, base=False):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts[:])
    if base:
        bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, sz * 0.5))
    if bevel > 0:
        bm_bevel(bm, min(bevel, min(sx, sy, sz) * 0.45), segs)
    return bm

def bm_ico(r, subdiv=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    return bm

def bm_uvsphere(r, segs=16, rings=10):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    return bm

def bm_grid(w, h, nx=1, ny=1):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=1.0)
    xs = [v.co.x for v in bm.verts]; ys = [v.co.y for v in bm.verts]
    ex = (max(xs) - min(xs)) or 1.0; ey = (max(ys) - min(ys)) or 1.0
    bmesh.ops.scale(bm, vec=(w / ex, h / ey, 1.0), verts=bm.verts[:])
    return bm

def bm_lathe(profile, segs=16, closed=False):
    """profile = [(r, z), ...] traversed with the SOLID ON THE LEFT: bottom pole -> outward ->
    up the outside -> inward at the top -> top pole. Normals then point out by construction."""
    bm = bmesh.new()
    rings = []
    for (r, z) in profile:
        if abs(r) < 1e-6:
            rings.append([bm.verts.new((0.0, 0.0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(TAU * i / segs), r * math.sin(TAU * i / segs), z))
                          for i in range(segs)])
    n = len(rings)
    pairs = [(i, i + 1) for i in range(n - 1)] + ([(n - 1, 0)] if closed else [])
    for a, b in pairs:
        A, B = rings[a], rings[b]
        if len(A) == 1 and len(B) == 1:
            continue
        for i in range(segs):
            j = (i + 1) % segs
            if len(A) == 1:
                f = (A[0], B[j], B[i])
            elif len(B) == 1:
                f = (A[i], A[j], B[0])
            else:
                f = (A[i], A[j], B[j], B[i])
            try:
                bm.faces.new(f)
            except ValueError:
                pass
    if closed:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm

def bm_torus(R, r, segs_major=24, segs_minor=8):
    prof = [(R + r * math.cos(TAU * k / segs_minor), r * math.sin(TAU * k / segs_minor)) for k in range(segs_minor)]
    return bm_lathe(prof, segs_major, closed=True)

def bm_ring_slab(r_in, r_out, h, segs=24):
    """a flat annulus with thickness (washer / rim / flange)"""
    return bm_lathe([(r_in, 0), (r_out, 0), (r_out, h), (r_in, h)], segs, closed=True)

def bm_tube_path(pts, radii, segs=8, caps=True):
    """tube swept along a polyline (parallel-transport frames); radii per point (float or list)"""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    if isinstance(radii, (int, float)):
        radii = [radii] * n
    bm = bmesh.new()
    tans = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        tans.append(t.normalized())
    t0 = tans[0]
    up = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    nrm = (up - t0 * up.dot(t0)).normalized()
    rings = []
    for i in range(n):
        t = tans[i]
        nrm = (nrm - t * nrm.dot(t)).normalized()
        bn = t.cross(nrm).normalized()
        ring = []
        for k in range(segs):
            a = TAU * k / segs
            ring.append(bm.verts.new(pts[i] + (nrm * math.cos(a) + bn * math.sin(a)) * radii[i]))
        rings.append(ring)
    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        for k in range(segs):
            j = (k + 1) % segs
            bm.faces.new((A[k], A[j], B[j], B[k]))
    if caps:
        try:
            bm.faces.new(list(reversed(rings[0])))
            bm.faces.new(rings[-1])
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm

def bm_blob(r, seed=0, subdiv=2, amp=0.28, freq=1.4, aniso=(1, 1, 1), amp2=0.08, freq2=4.0, floor=None):
    """noisy icosphere: rocks, bushes, drifts, clouds. floor = fraction of r below which verts are clamped flat."""
    bm = bm_ico(1.0, subdiv)
    off = Vector((seed * 1.731 + 0.3, seed * 0.377 + 2.1, seed * 2.913 + 5.7))
    for v in bm.verts:
        p = v.co.copy()
        n1 = noise.noise(p * freq + off)
        n2 = noise.noise(p * freq2 + off * 1.7)
        v.co = p * (1.0 + amp * n1 + amp2 * n2)
    bmesh.ops.scale(bm, vec=(r * aniso[0], r * aniso[1], r * aniso[2]), verts=bm.verts[:])
    if floor is not None:
        zf = -floor * r * aniso[2]
        for v in bm.verts:
            if v.co.z < zf:
                v.co.z = zf
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm

def bm_prism_profile(points2d, h, base=True):
    """extrude an arbitrary closed 2D polygon (CCW) to height h"""
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, 0.0)) for (x, y) in points2d]
    top = [bm.verts.new((x, y, h)) for (x, y) in points2d]
    n = len(bot)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if not base:
        bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0, 0, -h * 0.5))
    return bm

def bm_gear(R, teeth, thick, depth=None, bevel=0.0):
    """a real toothed wheel: trapezoid teeth on a rim, extruded (centred on the origin, axis Z)"""
    depth = depth or R * 0.16
    pts = []
    for i in range(teeth):
        a0 = TAU * i / teeth
        da = TAU / teeth
        for (fa, fr) in ((0.00, R - depth), (0.18, R - depth), (0.30, R), (0.52, R), (0.64, R - depth)):
            a = a0 + fa * da
            pts.append((fr * math.cos(a), fr * math.sin(a)))
    bm = bm_prism_profile(pts, thick, base=False)
    if bevel > 0:
        bm_bevel(bm, bevel, 1)
    return bm

def rng(seed):
    import random
    return random.Random(seed)

# ----------------------------------------------------------------------------- Prop assembly
class Prop:
    """accumulates bmesh parts with material slots, per-corner tint colours and card UVs"""
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self._ensure_layers(self.bm)
        self.tris = 0

    @staticmethod
    def _ensure_layers(bm):
        if 'tint' not in bm.loops.layers.float_color:
            bm.loops.layers.float_color.new('tint')
        if 'UVMap' not in bm.loops.layers.uv:
            bm.loops.layers.uv.new('UVMap')
        if 'CardUV' not in bm.loops.layers.uv:
            bm.loops.layers.uv.new('CardUV')
        if 'card' not in bm.faces.layers.int:
            bm.faces.layers.int.new('card')
        if 'flat' not in bm.faces.layers.int:
            bm.faces.layers.int.new('flat')

    def slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def add(self, part, mat, loc=(0, 0, 0), rot=(0, 0, 0), scale=1.0, tint=(1, 1, 1, 1), card=False, flat=False,
            card_uv=None):
        """part: bmesh (consumed). card=True marks the faces as alpha cards (UV kept = CardUV)."""
        self._ensure_layers(part)
        si = self.slot(mat)
        col = part.loops.layers.float_color['tint']
        uvm = part.loops.layers.uv['UVMap']
        uvc = part.loops.layers.uv['CardUV']
        fcard = part.faces.layers.int['card']
        fflat = part.faces.layers.int['flat']
        if len(tint) == 3:
            tint = (tint[0], tint[1], tint[2], 1.0)
        for f in part.faces:
            f.material_index = si
            f[fcard] = 1 if card else 0
            f[fflat] = 1 if flat else 0
            f.smooth = not flat
            for lp in f.loops:
                lp[col] = tint
        if card_uv is not None or card:
            rect = card_uv or (0.0, 0.0, 1.0, 1.0)
            for f in part.faces:
                lps = f.loops
                if len(lps) == 4:
                    c = f.calc_center_median()
                    ex = (lps[1].vert.co - lps[0].vert.co).normalized()
                    ey = f.normal.cross(ex).normalized()
                    prj = [((lp.vert.co - c).dot(ex), (lp.vert.co - c).dot(ey)) for lp in lps]
                    xs = [p[0] for p in prj]; ys = [p[1] for p in prj]
                    x0, x1 = min(xs), max(xs); y0, y1 = min(ys), max(ys)
                    for lp, (px, py) in zip(lps, prj):
                        u = rect[0] + (rect[2] - rect[0]) * ((px - x0) / ((x1 - x0) or 1))
                        v = rect[1] + (rect[3] - rect[1]) * ((py - y0) / ((y1 - y0) or 1))
                        lp[uvm].uv = (u, v)
                        lp[uvc].uv = (u, v)
        bmesh.ops.transform(part, matrix=_mat4(loc, rot, scale), verts=part.verts[:])
        tmp = bpy.data.meshes.new('_tmp')
        part.to_mesh(tmp)
        part.free()
        self.bm.from_mesh(tmp)
        bpy.data.meshes.remove(tmp)

    def finish(self, sharp_deg=32.0, weld=0.0):
        bm = self.bm
        if weld > 0:
            bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=weld)
        ang = RAD(sharp_deg)
        fflat = bm.faces.layers.int['flat']
        for e in bm.edges:
            lf = e.link_faces
            if len(lf) == 2:
                if e.calc_face_angle(0.0) > ang or lf[0][fflat] or lf[1][fflat]:
                    e.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        link(ob)
        ob['prop'] = 1
        self.ob = ob
        self.tris = mesh_tris(me)
        return ob

def mesh_tris(me):
    return sum(len(p.vertices) - 2 for p in me.polygons)

# ----------------------------------------------------------------------------- UV
def uv_unwrap(ob, angle_deg=66.0, margin=0.02):
    """smart-project every NON-card face into this object's UVMap (cards keep their card UVs)"""
    me = ob.data
    me.uv_layers.active_index = 0
    cardattr = me.attributes.get('card')
    cards = [cardattr.data[i].value for i in range(len(me.polygons))] if cardattr else [0] * len(me.polygons)
    for i, p in enumerate(me.polygons):
        p.select = not cards[i]
    for e in me.edges:
        e.select = False
    for v in me.vertices:
        v.select = False
    select_only([ob])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.smart_project(angle_limit=RAD(angle_deg), island_margin=margin, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')

def uv_scale_object(ob, factor, offset_u=0.0):
    uv = ob.data.uv_layers['UVMap'].data
    for d in uv:
        d.uv = (d.uv[0] * factor + offset_u, d.uv[1] * factor)

def uv_pack_all(obs, margin=0.006):
    """pack every object's islands into ONE 0..1 atlas (identical stacked card islands stay stacked)"""
    for k, ob in enumerate(obs):
        uv_scale_object(ob, 1.0, offset_u=float(k * 4))
    select_only(obs)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(udim_source='ACTIVE_UDIM', rotate=True, rotate_method='ANY', scale=True,
                            merge_overlap=True, margin_method='FRACTION', margin=margin, shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')
    lo = [1e9, 1e9]; hi = [-1e9, -1e9]
    for ob in obs:
        for d in ob.data.uv_layers['UVMap'].data:
            u, v = d.uv
            lo[0] = min(lo[0], u); lo[1] = min(lo[1], v); hi[0] = max(hi[0], u); hi[1] = max(hi[1], v)
    span = max(hi[0] - lo[0], hi[1] - lo[1]) or 1.0
    s = (1.0 - 2 * margin) / span
    for ob in obs:
        for d in ob.data.uv_layers['UVMap'].data:
            u, v = d.uv
            d.uv = ((u - lo[0]) * s + margin, (v - lo[1]) * s + margin)
    log('uv atlas span', round(span, 3), 'objects', len(obs))

# ----------------------------------------------------------------------------- node materials
def _sock(node, ident, inputs=True):
    coll = node.inputs if inputs else node.outputs
    for s in coll:
        if s.identifier == ident or s.name == ident:
            return s
    raise KeyError(ident)

class NB:
    """tiny node builder"""
    def __init__(self, mat):
        self.nt = mat.node_tree
        self.n = self.nt.nodes
        self.l = self.nt.links
        self.x = 0

    def node(self, typ, **props):
        nd = self.n.new(typ)
        for k, v in props.items():
            setattr(nd, k, v)
        nd.location = (self.x, -200 * (len(self.n) % 4))
        self.x += 180
        return nd

    def put(self, inp, v):
        if v is None:
            return
        if hasattr(v, 'is_linked'):
            self.l.new(v, inp)
        elif isinstance(v, (tuple, list)):
            if inp.type == 'RGBA':
                inp.default_value = (v[0], v[1], v[2], 1.0) if len(v) == 3 else tuple(v)
            elif inp.type == 'VECTOR':
                inp.default_value = tuple(v[:3])
            else:
                inp.default_value = float(v[0])
        else:
            if inp.type == 'RGBA':
                inp.default_value = (v, v, v, 1.0)
            elif inp.type == 'VECTOR':
                inp.default_value = (v, v, v)
            else:
                inp.default_value = float(v)

    def val(self, v):
        nd = self.node('ShaderNodeValue'); nd.outputs[0].default_value = v; return nd.outputs[0]

    def rgb(self, c):
        nd = self.node('ShaderNodeRGB'); nd.outputs[0].default_value = (c[0], c[1], c[2], 1.0); return nd.outputs[0]

    def coord(self, kind='Object'):
        return self.node('ShaderNodeTexCoord').outputs[kind]

    def uv(self, name='CardUV'):
        nd = self.node('ShaderNodeUVMap'); nd.uv_map = name; return nd.outputs[0]

    def tint(self):
        nd = self.node('ShaderNodeVertexColor'); nd.layer_name = 'tint'; return nd.outputs['Color']

    def tint_alpha(self):
        nd = self.node('ShaderNodeVertexColor'); nd.layer_name = 'tint'; return nd.outputs['Alpha']

    def mapping(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        nd = self.node('ShaderNodeMapping')
        self.put(nd.inputs['Vector'], vec); nd.inputs['Scale'].default_value = scale
        nd.inputs['Location'].default_value = loc; nd.inputs['Rotation'].default_value = rot
        return nd.outputs[0]

    def noise(self, vec, scale=5.0, detail=2.0, rough=0.5, dist=0.0, color=False):
        nd = self.node('ShaderNodeTexNoise')
        self.put(nd.inputs['Vector'], vec)
        nd.inputs['Scale'].default_value = scale; nd.inputs['Detail'].default_value = detail
        nd.inputs['Roughness'].default_value = rough; nd.inputs['Distortion'].default_value = dist
        return nd.outputs['Color'] if color else nd.outputs['Fac']

    def voronoi(self, vec, scale=5.0, feature='F1', dist='EUCLIDEAN', rand=1.0, out='Distance'):
        nd = self.node('ShaderNodeTexVoronoi'); nd.feature = feature; nd.distance = dist
        self.put(nd.inputs['Vector'], vec); nd.inputs['Scale'].default_value = scale
        nd.inputs['Randomness'].default_value = rand
        return nd.outputs[out]

    def wave(self, vec, scale=5.0, wtype='BANDS', direction='X', dist=0.0, detail=2.0, dscale=1.0, profile='SIN'):
        nd = self.node('ShaderNodeTexWave'); nd.wave_type = wtype
        if wtype == 'BANDS':
            nd.bands_direction = direction
        else:
            nd.rings_direction = direction
        nd.wave_profile = profile
        self.put(nd.inputs['Vector'], vec); nd.inputs['Scale'].default_value = scale
        nd.inputs['Distortion'].default_value = dist; nd.inputs['Detail'].default_value = detail
        nd.inputs['Detail Scale'].default_value = dscale
        return nd.outputs['Fac']

    def brick(self, vec, scale=5.0, mortar=0.02, bias=0.0, w=0.5, h=0.25, c1=(0.6, 0.6, 0.6), c2=(0.4, 0.4, 0.4), m=(0.1, 0.1, 0.1), offset=0.5):
        nd = self.node('ShaderNodeTexBrick'); nd.offset = offset
        self.put(nd.inputs['Vector'], vec); nd.inputs['Scale'].default_value = scale
        nd.inputs['Mortar Size'].default_value = mortar; nd.inputs['Bias'].default_value = bias
        nd.inputs['Brick Width'].default_value = w; nd.inputs['Row Height'].default_value = h
        nd.inputs['Color1'].default_value = (*c1, 1); nd.inputs['Color2'].default_value = (*c2, 1); nd.inputs['Mortar'].default_value = (*m, 1)
        return nd.outputs['Color'], nd.outputs['Fac']

    def gradient(self, vec, gtype='LINEAR'):
        nd = self.node('ShaderNodeTexGradient'); nd.gradient_type = gtype
        self.put(nd.inputs['Vector'], vec); return nd.outputs['Fac']

    def math(self, op, a, b=None, c=None, clamp=False):
        nd = self.node('ShaderNodeMath'); nd.operation = op; nd.use_clamp = clamp
        self.put(nd.inputs[0], a)
        if b is not None: self.put(nd.inputs[1], b)
        if c is not None: self.put(nd.inputs[2], c)
        return nd.outputs[0]

    def vmath(self, op, a, b=None, scale=None):
        nd = self.node('ShaderNodeVectorMath'); nd.operation = op
        self.put(nd.inputs[0], a)
        if b is not None: self.put(nd.inputs[1], b)
        if scale is not None: self.put(nd.inputs['Scale'], scale)
        return nd.outputs['Value'] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else nd.outputs['Vector']

    def mapr(self, v, fmin, fmax, tmin=0.0, tmax=1.0, clamp=True):
        nd = self.node('ShaderNodeMapRange'); nd.clamp = clamp
        self.put(nd.inputs['Value'], v); nd.inputs['From Min'].default_value = fmin; nd.inputs['From Max'].default_value = fmax
        nd.inputs['To Min'].default_value = tmin; nd.inputs['To Max'].default_value = tmax
        return nd.outputs['Result']

    def ramp(self, fac, stops, interp='LINEAR'):
        nd = self.node('ShaderNodeValToRGB'); nd.color_ramp.interpolation = interp
        cr = nd.color_ramp
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        cr.elements[0].position = stops[0][0]; cr.elements[0].color = (*stops[0][1], 1.0)
        for pos, col in stops[1:]:
            e = cr.elements.new(pos); e.color = (*col, 1.0)
        self.put(nd.inputs['Fac'], fac)
        return nd.outputs['Color']

    def mix(self, fac, a, b):
        nd = self.node('ShaderNodeMix'); nd.data_type = 'RGBA'; nd.blend_type = 'MIX'; nd.clamp_factor = True
        self.put(_sock(nd, 'Factor_Float'), fac); self.put(_sock(nd, 'A_Color'), a); self.put(_sock(nd, 'B_Color'), b)
        return _sock(nd, 'Result_Color', inputs=False)

    def blend(self, fac, a, b, mode='MULTIPLY'):
        nd = self.node('ShaderNodeMix'); nd.data_type = 'RGBA'; nd.blend_type = mode; nd.clamp_factor = True
        self.put(_sock(nd, 'Factor_Float'), fac); self.put(_sock(nd, 'A_Color'), a); self.put(_sock(nd, 'B_Color'), b)
        return _sock(nd, 'Result_Color', inputs=False)

    def mixf(self, fac, a, b):
        nd = self.node('ShaderNodeMix'); nd.data_type = 'FLOAT'; nd.clamp_factor = True
        self.put(_sock(nd, 'Factor_Float'), fac); self.put(_sock(nd, 'A_Float'), a); self.put(_sock(nd, 'B_Float'), b)
        return _sock(nd, 'Result_Float', inputs=False)

    def bump(self, height, strength=0.3, distance=0.02, normal=None):
        nd = self.node('ShaderNodeBump'); nd.inputs['Strength'].default_value = strength
        nd.inputs['Distance'].default_value = distance; self.put(nd.inputs['Height'], height)
        if normal is not None: self.put(nd.inputs['Normal'], normal)
        return nd.outputs['Normal']

    def geo(self, out='Normal'):
        return self.node('ShaderNodeNewGeometry').outputs[out]

    def sep(self, vec, comp='Z'):
        nd = self.node('ShaderNodeSeparateXYZ'); self.put(nd.inputs[0], vec); return nd.outputs[comp]

    def sepc(self, col, comp='Red'):
        nd = self.node('ShaderNodeSeparateColor'); self.put(nd.inputs[0], col); return nd.outputs[comp]

    def upmask(self, lo=0.35, hi=0.75):
        """1 on upward-facing surfaces (snow / moss / dust caps)"""
        return self.mapr(self.sep(self.geo('Normal'), 'Z'), lo, hi)

    def hue(self, col, h=0.5, s=1.0, v=1.0):
        nd = self.node('ShaderNodeHueSaturation'); nd.inputs['Hue'].default_value = h
        nd.inputs['Saturation'].default_value = s; nd.inputs['Value'].default_value = v
        self.put(nd.inputs['Color'], col); return nd.outputs[0]

def make_material(name, fn):
    """fn(nb) -> dict(color, rough, metal, emit, alpha, normal) of sockets / constants"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    nb = NB(m)
    out = nb.node('ShaderNodeOutputMaterial', name='OUT')
    bsdf = nb.node('ShaderNodeBsdfPrincipled', name='BSDF')
    nb.node('ShaderNodeEmission', name='BAKE_EMIT')
    bake = nb.node('ShaderNodeTexImage', name='BAKE_TARGET')
    spec = fn(nb)
    spec.setdefault('rough', 0.6); spec.setdefault('metal', 0.0); spec.setdefault('emit', (0, 0, 0)); spec.setdefault('alpha', 1.0)
    nb.put(bsdf.inputs['Base Color'], spec['color'])
    nb.put(bsdf.inputs['Roughness'], spec['rough'])
    nb.put(bsdf.inputs['Metallic'], spec['metal'])
    if spec.get('normal') is not None:
        nb.put(bsdf.inputs['Normal'], spec['normal'])
    nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
    nt.nodes.active = bake
    MAT_SPEC[m.name] = spec
    return m

def set_bake_mode(m, mode):
    nt = m.node_tree
    out = nt.nodes['OUT']; bsdf = nt.nodes['BSDF']; em = nt.nodes['BAKE_EMIT']
    spec = MAT_SPEC[m.name]
    for l in list(out.inputs['Surface'].links):
        nt.links.remove(l)
    if mode == 'shade':
        nt.links.new(bsdf.outputs[0], out.inputs['Surface'])
        return
    for l in list(em.inputs['Color'].links):
        nt.links.remove(l)
    src = spec.get(mode)
    NB(m).put(em.inputs['Color'], src)
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs['Surface'])

# ----------------------------------------------------------------------------- baking
def _new_image(name, size, srgb, alpha=False):
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, size, size, alpha=alpha, float_buffer=False)
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    img.generated_color = (0, 0, 0, 1)
    return img

def _pixels(img):
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    return buf.reshape(h, w, 4)

def _save(name, arr, path, srgb, alpha):
    h, w, _ = arr.shape
    img = _new_image(name, w, srgb, alpha=alpha)
    if not alpha:
        arr = arr.copy(); arr[..., 3] = 1.0
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.file_format = 'WEBP' if path.lower().endswith('.webp') else 'PNG'
    if img.file_format == 'WEBP':
        try:
            bpy.context.scene.render.image_settings.quality = 92
        except Exception:
            pass
    img.filepath_raw = path
    bpy.context.scene.render.image_settings.compression = 90
    img.save()
    img.filepath = path
    img.source = 'FILE'
    img.reload()
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return img

def bake_atlas(obs, realm, outdir, size=2048, size_small=1024, emit_size=1024, ao_samples=24):
    """bake every object of the realm into shared atlas maps. returns dict of saved bpy images"""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.use_adaptive_sampling = False
    sc.render.bake.margin = 10
    sc.render.bake.margin_type = 'EXTEND'
    sc.render.bake.use_clear = True
    sc.render.bake.use_selected_to_active = False
    sc.render.bake.use_pass_direct = False
    sc.render.bake.use_pass_indirect = False
    sc.render.bake.use_pass_color = True
    mats = []
    for ob in obs:
        for m in ob.data.materials:
            if m and m not in mats:
                mats.append(m)
    passes = [
        ('color', 'EMIT', size, True, 1),
        ('alpha', 'EMIT', size, False, 1),
        ('normal', 'NORMAL', size_small, False, 1),
        ('rough', 'EMIT', size_small, False, 1),
        ('metal', 'EMIT', size_small, False, 1),
        ('emit', 'EMIT', emit_size, True, 1),
        ('ao', 'AO', size_small, False, ao_samples),
    ]
    results = {}
    select_only(obs)
    for (pname, btype, psize, srgb, samples) in passes:
        img = _new_image('bk_' + pname, psize, srgb, alpha=False)
        for m in mats:
            m.node_tree.nodes['BAKE_TARGET'].image = img
            m.node_tree.nodes.active = m.node_tree.nodes['BAKE_TARGET']
            set_bake_mode(m, pname if btype == 'EMIT' else 'shade')
        sc.cycles.samples = samples
        t = time.time()
        bpy.ops.object.bake(type=btype)
        log('bake', realm, pname, psize, 'px', round(time.time() - t, 1), 's')
        results[pname] = _pixels(img)
    for m in mats:
        set_bake_mode(m, 'shade')
    texdir = os.path.join(outdir, 'textures')
    os.makedirs(texdir, exist_ok=True)
    col = results['color'].copy()
    col[..., 3] = results['alpha'][..., 0]
    nrm = results['normal'].copy()
    orm = np.zeros_like(results['ao'])
    orm[..., 0] = results['ao'][..., 0]
    orm[..., 1] = results['rough'][..., 0]
    orm[..., 2] = results['metal'][..., 0]
    emi = results['emit'].copy()
    out = {}
    out['albedo'] = _save(realm + '_albedo', col, os.path.join(texdir, realm + '_albedo.png'), True, True)
    out['normal'] = _save(realm + '_normal', nrm, os.path.join(texdir, realm + '_normal.png'), False, False)
    out['orm'] = _save(realm + '_orm', orm, os.path.join(texdir, realm + '_orm.png'), False, False)
    out['emissive'] = _save(realm + '_emissive', emi, os.path.join(texdir, realm + '_emissive.png'), True, False)
    for k, im in out.items():
        log('atlas', k, im.size[0], 'px', os.path.getsize(im.filepath), 'bytes')
    for pname in ('color', 'alpha', 'normal', 'rough', 'metal', 'emit', 'ao'):
        bpy.data.images.remove(bpy.data.images['bk_' + pname])
    return out

def _gltf_settings_group():
    name = 'glTF Material Output'
    ng = bpy.data.node_groups.get(name)
    if ng is None:
        ng = bpy.data.node_groups.new(name, 'ShaderNodeTree')
        ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        ng.nodes.new('NodeGroupInput')
    return ng

def make_atlas_materials(realm, imgs, emissive_strength=3.0):
    """the two export materials (opaque / alpha-cutout) sharing the realm's four atlas maps"""
    res = {}
    for kind in ('opaque', 'cutout'):
        m = bpy.data.materials.new(realm + '_atlas' + ('' if kind == 'opaque' else '_cutout'))
        m.use_nodes = True
        nt = m.node_tree; nt.nodes.clear()
        nb = NB(m)
        out = nb.node('ShaderNodeOutputMaterial')
        bsdf = nb.node('ShaderNodeBsdfPrincipled')
        alb = nb.node('ShaderNodeTexImage'); alb.image = imgs['albedo']; alb.interpolation = 'Linear'
        nrm = nb.node('ShaderNodeTexImage'); nrm.image = imgs['normal']
        orm = nb.node('ShaderNodeTexImage'); orm.image = imgs['orm']
        emi = nb.node('ShaderNodeTexImage'); emi.image = imgs['emissive']
        nmap = nb.node('ShaderNodeNormalMap'); nmap.uv_map = 'UVMap'; nmap.inputs['Strength'].default_value = 1.0
        sep = nb.node('ShaderNodeSeparateColor')
        grp = nb.node('ShaderNodeGroup'); grp.node_tree = _gltf_settings_group()
        L = nt.links
        L.new(alb.outputs['Color'], bsdf.inputs['Base Color'])
        if kind == 'cutout':
            # hard 0.5 cut so the Eevee turntable previews exactly what the game's alphaMode MASK shows
            cut = nb.node('ShaderNodeMath'); cut.operation = 'GREATER_THAN'; cut.inputs[1].default_value = 0.5
            L.new(alb.outputs['Alpha'], cut.inputs[0])
            L.new(cut.outputs[0], bsdf.inputs['Alpha'])
        L.new(nrm.outputs['Color'], nmap.inputs['Color']); L.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        L.new(orm.outputs['Color'], sep.inputs['Color'])
        L.new(sep.outputs['Green'], bsdf.inputs['Roughness']); L.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
        L.new(sep.outputs['Red'], grp.inputs['Occlusion'])
        L.new(emi.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = emissive_strength
        L.new(bsdf.outputs[0], out.inputs['Surface'])
        m.use_backface_culling = (kind == 'opaque')
        if kind == 'cutout':
            try:
                m.surface_render_method = 'DITHERED'
            except Exception:
                pass
        res[kind] = m
    ATLAS_MATS[realm] = res
    return res

def assign_atlas(ob, mat):
    me = ob.data
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0
    # the card UV layer only served the bake; never ship it as TEXCOORD_1
    lay = me.uv_layers.get('CardUV')
    if lay is not None:
        me.uv_layers.remove(lay)

# ----------------------------------------------------------------------------- LOD
def fit_budget(ob, budget, floor=0.55):
    """Collapse-decimate a prop that OVERSHOOTS its triangle budget down to the budget and no
    further. This is tessellation, not content: no part is removed, the collapse solver keeps the
    silhouette, and a prop already inside its budget is not touched at all. Run BEFORE the unwrap
    so the atlas is packed for the shipped topology. Returns (before, after, ratio).

    Never call this on a `cutout` prop: its alpha cards carry a `card` face attribute and a
    collapse would merge card faces into solid ones."""
    before = mesh_tris(ob.data)
    if before <= budget:
        return (before, before, 1.0)
    ratio = max(floor, (budget / float(before)) * 0.97)
    mod = ob.modifiers.new('fit', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), depsgraph=dg)
    me2.name = ob.data.name
    old = ob.data
    for m in old.materials:
        me2.materials.append(m)
    ob.modifiers.clear()
    ob.data = me2
    bpy.data.meshes.remove(old)
    return (before, mesh_tris(me2), ratio)


def make_lod(ob, ratio=0.4, card_keep=0.4):
    me0 = ob.data
    ob2 = ob.copy(); ob2.data = me0.copy(); ob2.name = ob.name + '_LOD1'; ob2.data.name = ob2.name
    link(ob2)
    ob2.animation_data_clear()
    me = ob2.data
    bm = bmesh.new(); bm.from_mesh(me)
    bm.faces.ensure_lookup_table()
    fc = bm.faces.layers.int.get('card')
    kill = []
    if fc:
        k = 0
        keep_n = int(round(card_keep * 10))
        for f in bm.faces:
            if f[fc]:
                k += 1
                if (k % 10) >= keep_n:
                    kill.append(f)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me); bm.free()
    vg = ob2.vertex_groups.new(name='lod')
    cardattr = me.attributes.get('card')
    cardv = set()
    if cardattr:
        for p in me.polygons:
            if cardattr.data[p.index].value:
                cardv.update(p.vertices)
    solid = [v.index for v in me.vertices if v.index not in cardv]
    if solid:
        vg.add(solid, 1.0, 'REPLACE')
    if cardv:
        vg.add(list(cardv), 0.0, 'REPLACE')
    mod = ob2.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'; mod.ratio = ratio; mod.use_collapse_triangulate = True
    mod.vertex_group = 'lod'; mod.vertex_group_factor = 1.0
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob2.evaluated_get(dg))
    me2.name = ob2.name
    for m in me.materials:
        me2.materials.append(m)
    ob2.modifiers.clear()
    ob2.data = me2
    bpy.data.meshes.remove(me)
    ob2['prop'] = 0
    return ob2

# ----------------------------------------------------------------------------- animation
def add_spin(ob, seconds=8.0, axis='Y', name='spin'):
    """object-level rotation clip (glTF node animation). axis is a BLENDER axis: Y = glTF Z (spin facing)."""
    sc = bpy.context.scene
    try:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    except Exception:
        pass
    ob.rotation_mode = 'XYZ'
    frames = int(round(seconds * sc.render.fps))
    idx = 'XYZ'.index(axis)
    ob.rotation_euler = (0, 0, 0)
    ob.keyframe_insert('rotation_euler', frame=1)
    rot = [0, 0, 0]; rot[idx] = TAU
    ob.rotation_euler = rot
    ob.keyframe_insert('rotation_euler', frame=1 + frames)
    act = ob.animation_data.action
    act.name = name
    fcurves = []
    if hasattr(act, 'fcurves'):
        fcurves = list(act.fcurves)
    else:                                   # Blender 4.4+/5.x layered (slotted) actions
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    fcurves += list(cb.fcurves)
    for fc in fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    sc.frame_start = 1; sc.frame_end = 1 + frames
    ob.rotation_euler = (0, 0, 0)
    return {'name': name, 'seconds': seconds, 'frames': frames, 'axis_gltf': {'X': 'X', 'Y': 'Z', 'Z': 'Y'}[axis]}

# ----------------------------------------------------------------------------- export + measure
def bounds_gltf(ob):
    """object-space bounds in glTF axes (x, y=up, z=-blender_y)"""
    xs = [v.co.x for v in ob.data.vertices]; ys = [v.co.y for v in ob.data.vertices]; zs = [v.co.z for v in ob.data.vertices]
    mn = [min(xs), min(zs), -max(ys)]; mx = [max(xs), max(zs), -min(ys)]
    return {'min': [round(v, 4) for v in mn], 'max': [round(v, 4) for v in mx],
            'size': [round(mx[i] - mn[i], 4) for i in range(3)]}

def export_gltf(ob, path, animated=False):
    select_only([ob])
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLTF_SEPARATE', use_selection=True, export_texture_dir='textures',
        export_yup=True, export_apply=True, export_animations=animated, export_image_format='AUTO',
        export_materials='EXPORT', export_normals=True, export_texcoords=True, export_tangents=False,
        export_extras=False, export_lights=False, export_cameras=False, export_skins=False,
        export_draco_mesh_compression_enable=False, export_attributes=False,
        export_frame_range=True, export_force_sampling=True, export_anim_single_armature=False,
        export_reset_pose_bones=False, export_optimize_animation_size=True)

def patch_gltf(path, cutout):
    """post-process: alpha MASK for cutouts, count what shipped"""
    with open(path, 'r', encoding='utf-8') as f:
        j = json.load(f)
    for m in j.get('materials', []):
        if cutout:
            m['alphaMode'] = 'MASK'; m['alphaCutoff'] = 0.5; m['doubleSided'] = True
        else:
            m.pop('alphaMode', None); m.pop('alphaCutoff', None); m['doubleSided'] = False
    j['asset']['generator'] = 'Crestbound propkit (Blender ' + bpy.app.version_string + ')'
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(j, f, separators=(',', ':'))
    tris = 0
    for mesh in j.get('meshes', []):
        for prim in mesh.get('primitives', []):
            if 'indices' in prim:
                tris += j['accessors'][prim['indices']]['count'] // 3
    clips = [{'name': a.get('name', ''), 'channels': len(a.get('channels', []))} for a in j.get('animations', [])]
    imgs = [i.get('uri') for i in j.get('images', [])]
    return {'tris': tris, 'clips': clips, 'images': imgs, 'materials': [m.get('name') for m in j.get('materials', [])]}

# ----------------------------------------------------------------------------- turntables (Eevee)
def _load_px(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    buf = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(buf)
    bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)

def _save_sheet(arr, path):
    """Writes WebP when `path` says .webp (a turntable sheet) and PNG otherwise (a baked texture).
    The format has to follow the extension: this used to hard-code PNG, which after the turntables
    moved to WebP would have written PNG bytes into a .webp file."""
    h, w, _ = arr.shape
    name = '_sheet'
    if name in bpy.data.images:
        bpy.data.images.remove(bpy.data.images[name])
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(np.ascontiguousarray(arr, dtype=np.float32).ravel())
    img.file_format = 'WEBP' if path.lower().endswith('.webp') else 'PNG'
    if img.file_format == 'WEBP':
        try:
            bpy.context.scene.render.image_settings.quality = 92
        except Exception:
            pass
    img.filepath_raw = path
    img.save()
    bpy.data.images.remove(img)

class Turntable:
    """8 angles at 512 px composed into one 2048x1024 sheet (a0..a3 top row, a4..a7 bottom row),
    a 1024 px close-up, and a 1024x512 LOD1 pair (angles a1 / a5). Eevee, AgX, neutral 3-point rig."""
    def __init__(self, outdir, px=1024):
        sc = bpy.context.scene
        self.sc = sc; self.outdir = outdir; self.px = px
        os.makedirs(outdir, exist_ok=True)
        sc.render.engine = 'BLENDER_EEVEE'
        sc.render.resolution_percentage = 100
        # WEBP, not PNG: a turntable is a REVIEW render, and the same 1024x1024 Eevee frame is
        # 948,655 bytes as PNG against 21,262 as WebP q92 (measured, keep/arch_door_00). The four
        # kits had put ~333 MB of turntable PNGs in the repo; as WebP the same 430 frames are 13.5 MB.
        sc.render.image_settings.file_format = 'WEBP'; sc.render.image_settings.color_mode = 'RGB'
        sc.render.image_settings.quality = 92
        sc.render.image_settings.compression = 100
        sc.render.film_transparent = False
        sc.render.dither_intensity = 0.0       # dither noise wrecks PNG compression
        try:
            sc.eevee.taa_render_samples = 48
            sc.eevee.use_shadows = True
        except Exception:
            pass
        try:
            sc.view_settings.view_transform = 'AgX'
        except Exception:
            sc.view_settings.view_transform = 'Filmic'
        sc.view_settings.look = 'None'
        sc.view_settings.exposure = 0.0
        cam = bpy.data.cameras.new('tt_cam'); cam.lens_unit = 'FOV'; cam.angle = RAD(32)
        self.cam = bpy.data.objects.new('tt_cam', cam); link(self.cam); sc.camera = self.cam
        self.lights = []
        for nm, col in (('key', (1.0, 0.96, 0.9)), ('fill', (0.85, 0.9, 1.0)), ('rim', (1.0, 1.0, 1.0))):
            L = bpy.data.lights.new('tt_' + nm, 'AREA'); L.color = col; L.use_shadow = True
            o = bpy.data.objects.new('tt_' + nm, L); link(o); self.lights.append(o)
        w = bpy.data.worlds.new('tt_world'); sc.world = w
        w.use_nodes = True
        w.node_tree.nodes['Background'].inputs[0].default_value = (0.22, 0.23, 0.25, 1)
        w.node_tree.nodes['Background'].inputs[1].default_value = 1.0
        try:
            sc.eevee.taa_render_samples = 24
        except Exception:
            pass
        gm = bpy.data.meshes.new('tt_ground'); bm = bmesh.new()
        bmesh.ops.create_circle(bm, cap_ends=True, segments=48, radius=1.0); bm.to_mesh(gm); bm.free()
        mat = bpy.data.materials.new('tt_ground'); mat.use_nodes = True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.30, 0.30, 0.31, 1)
        mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
        gm.materials.append(mat)
        self.ground = bpy.data.objects.new('tt_ground', gm); link(self.ground)
        self.own = set([self.cam.name, self.ground.name] + [o.name for o in self.lights])

    def _aim(self, ob, at):
        d = Vector(at) - ob.location
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

    def _show(self, obs):
        keep = set(o.name for o in obs)
        for o in self.sc.objects:
            if o.name not in self.own and o.type == 'MESH':
                o.hide_render = (o.name not in keep)

    def _frame(self, obs):
        bb = []
        for ob in obs:
            bb += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        mn = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
        mx = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
        c = (mn + mx) * 0.5
        r = max((mx - mn).length * 0.5, 0.2)
        d = r / math.tan(self.cam.data.angle * 0.5) * 1.12
        self.ground.location = (c.x, c.y, mn.z - 0.002)
        self.ground.scale = (r * 14, r * 14, 1)
        for o, (dx, dy, dz, e, sz) in zip(self.lights, ((1.6, -1.8, 2.2, 9.0, 1.4), (-2.2, -1.2, 1.1, 3.0, 2.4), (0.4, 2.2, 1.8, 6.5, 1.2))):
            o.location = (c.x + dx * d * 0.55, c.y + dy * d * 0.55, c.z + dz * d * 0.55)
            dist2 = (Vector(o.location) - c).length_squared
            o.data.energy = e * dist2          # watts scale with distance^2 -> constant irradiance on the subject
            o.data.size = sz * r
            self._aim(o, c)
        return mn, mx, c, r, d

    def _shot(self, path, px, look_at, cam_pos):
        self.sc.render.resolution_x = px; self.sc.render.resolution_y = px
        self.cam.location = cam_pos
        self._aim(self.cam, look_at)
        self.sc.render.filepath = path
        bpy.ops.render.render(write_still=True)

    def render(self, obs, prefix, lod_obs=None, angles=8, elev_deg=18.0):
        sc = self.sc
        # PER-PROCESS scratch: the four realms build in parallel and every one of them used to
        # write and then delete <out>/_turntable/_tmp/a0.png, so two realms rendering at the same
        # moment killed each other with WinError 32 (verdant and ember both died there).
        tmp = os.path.join(self.outdir, '_tmp%d' % os.getpid()); os.makedirs(tmp, exist_ok=True)
        self._show(obs)
        mn, mx, c, r, d = self._frame(obs)
        el = RAD(elev_deg)
        def cam_at(az_deg, dist, tgt, el):
            az = RAD(az_deg)
            return (tgt.x + dist * math.cos(el) * math.cos(az), tgt.y + dist * math.cos(el) * math.sin(az), tgt.z + dist * math.sin(el))
        tiles = []
        for k in range(angles):
            p = os.path.join(tmp, 'a%d.png' % k)
            self._shot(p, 512, c, cam_at(30.0 + 360.0 * k / angles, d, c, el))
            tiles.append(_load_px(p))
        sheet = np.zeros((1024, 2048, 4), dtype=np.float32); sheet[..., 3] = 1
        for k, t in enumerate(tiles):
            row = 1 - (k // 4)               # blender rows start at the bottom: a0..a3 on top
            col = k % 4
            sheet[row * 512:(row + 1) * 512, col * 512:(col + 1) * 512] = t
        out_sheet = os.path.join(self.outdir, prefix + '_turntable.webp')
        _save_sheet(sheet, out_sheet)
        # close-up of the upper part, 3/4 view
        tgt = Vector((c.x, c.y, mn.z + (mx.z - mn.z) * 0.66))
        d2 = max(d * 0.55, r * 1.6)
        out_close = os.path.join(self.outdir, prefix + '_close.webp')
        self._shot(out_close, self.px, tgt, cam_at(35.0, d2, tgt, RAD(12.0)))
        files = [os.path.basename(out_sheet), os.path.basename(out_close)]
        if lod_obs:
            self._show(lod_obs)
            pair = []
            for k, az in enumerate((75.0, 255.0)):
                p = os.path.join(tmp, 'l%d.png' % k)
                self._shot(p, 384, c, cam_at(az, d, c, el))
                pair.append(_load_px(p))
            lod = np.concatenate(pair, axis=1)
            out_lod = os.path.join(self.outdir, prefix + '_lod1.webp')
            _save_sheet(lod, out_lod)
            files.append(os.path.basename(out_lod))
        for f in os.listdir(tmp):
            os.remove(os.path.join(tmp, f))
        os.rmdir(tmp)
        return files
