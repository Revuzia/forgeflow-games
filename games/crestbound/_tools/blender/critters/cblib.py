"""
CRESTBOUND critter kit — shared headless-Blender library (Blender 5.1, bpy only).

Conventions
  * Blender Z up, creature FRONT faces Blender -Y  ->  glTF/three.js +Z forward (export_yup=True
    maps (x, y, z) -> (x, z, -y); verified by probe: a nose at Blender y=-0.6 landed at glTF z=+0.75).
  * 1 unit = 1 metre, origin at the feet / base (armature at world origin, root bone at z=0).
  * Every visible part is a bevelled / lathed / booleaned / subdivided primitive with real UVs,
    rigidly (or softly) weighted to a NAMED bone. Parts are joined into ONE mesh with 1-3 material
    slots: the baked ATLAS (albedo / normal / ORM), optional GLOW (emissive, untextured), optional
    WING (alpha-blended, untextured).
  * Clips are Blender Actions pushed onto NLA tracks named after the clip and exported with
    export_animation_mode='NLA_TRACKS'; keys are authored as WORLD-axis rotations at rest and
    converted into bone-local space (doctrine: never guess bone-local Euler axes).
"""
import bpy, bmesh, math, os, sys, json, struct, time
from mathutils import Vector, Matrix, Quaternion, Euler
import numpy as np

FPS = 24
FRONT = Vector((0, -1, 0))   # Blender-space forward of every creature (three.js +Z)


def log(*a):
    print("[cb]", *a, flush=True)


# ----------------------------------------------------------------------------------------------
# scene
# ----------------------------------------------------------------------------------------------

def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    sc.frame_start = 0
    sc.unit_settings.system = 'METRIC'
    sc.unit_settings.scale_length = 1.0
    return sc


def deselect_all():
    for o in bpy.context.view_layer.objects:
        o.select_set(False)


def activate(o):
    deselect_all()
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def mode(m):
    if bpy.context.object and bpy.context.object.mode != m:
        bpy.ops.object.mode_set(mode=m)


# ----------------------------------------------------------------------------------------------
# materials — procedural node trees that BAKE well (Cycles): pointiness edge wear, AO-in-crevice
# grime, noise mottling, bump for the normal map. Each material remembers its category so the
# builder knows whether it joins the atlas ('atlas'), stays emissive ('glow') or alpha ('wing').
# ----------------------------------------------------------------------------------------------

def _mat(name, category='atlas'):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    m["cb_category"] = category
    return m, nt, bsdf


def _rgb(nt, col):
    n = nt.nodes.new("ShaderNodeRGB")
    n.outputs[0].default_value = (col[0], col[1], col[2], 1.0)
    return n


def _mix(nt, a_socket, b_socket, fac_socket_or_value):
    n = nt.nodes.new("ShaderNodeMix")
    n.data_type = 'RGBA'
    n.blend_type = 'MIX'
    nt.links.new(a_socket, n.inputs[6])
    nt.links.new(b_socket, n.inputs[7])
    if hasattr(fac_socket_or_value, "is_linked") or hasattr(fac_socket_or_value, "node"):
        nt.links.new(fac_socket_or_value, n.inputs[0])
    else:
        n.inputs[0].default_value = fac_socket_or_value
    return n


def _noise(nt, scale, detail=4.0, roughness=0.55, distortion=0.0):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = roughness
    n.inputs["Distortion"].default_value = distortion
    return n


def _ramp(nt, stops):
    """stops: [(pos, (r,g,b,a)), ...]"""
    n = nt.nodes.new("ShaderNodeValToRGB")
    cr = n.color_ramp
    while len(cr.elements) > 1:
        cr.elements.remove(cr.elements[-1])
    cr.elements[0].position = stops[0][0]
    cr.elements[0].color = stops[0][1]
    for pos, col in stops[1:]:
        e = cr.elements.new(pos)
        e.color = col
    return n


def _maprange(nt, lo, hi, tlo=0.0, thi=1.0):
    n = nt.nodes.new("ShaderNodeMapRange")
    n.inputs["From Min"].default_value = lo
    n.inputs["From Max"].default_value = hi
    n.inputs["To Min"].default_value = tlo
    n.inputs["To Max"].default_value = thi
    n.clamp = True
    return n


def _bump(nt, height_socket, strength=0.3, distance=0.02):
    b = nt.nodes.new("ShaderNodeBump")
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = distance
    nt.links.new(height_socket, b.inputs["Height"])
    return b


def _pointiness(nt):
    g = nt.nodes.new("ShaderNodeNewGeometry")
    return g.outputs["Pointiness"]


def _ao(nt, dist=0.25):
    a = nt.nodes.new("ShaderNodeAmbientOcclusion")
    a.inputs["Distance"].default_value = dist
    a.samples = 8
    a.only_local = True
    return a.outputs["AO"]


def mat_metal(name, base=(0.32, 0.33, 0.36), rough=0.45, worn=(0.75, 0.74, 0.70), grime=(0.06, 0.05, 0.045),
              rust=None, scale=18.0, bump=0.35, metallic=0.95):
    """Iron / steel / brass: mottled base, bright worn edges (pointiness), dark grime in crevices (AO),
    optional rust bloom, noise bump for the normal map."""
    m, nt, bsdf = _mat(name)
    n1 = _noise(nt, scale, 5.0, 0.6)
    mott = _ramp(nt, [(0.3, (base[0] * 0.82, base[1] * 0.82, base[2] * 0.82, 1)), (0.7, (base[0] * 1.12, base[1] * 1.12, base[2] * 1.12, 1))])
    nt.links.new(n1.outputs["Fac"], mott.inputs["Fac"])
    col = mott.outputs["Color"]
    if rust:
        n2 = _noise(nt, scale * 0.35, 5.0, 0.65)
        rr = _maprange(nt, 0.58, 0.74)
        nt.links.new(n2.outputs["Fac"], rr.inputs["Value"])
        rc = _rgb(nt, rust)
        mx = _mix(nt, col, rc.outputs[0], rr.outputs[0])
        col = mx.outputs[2]
    # grime in crevices
    ao = _ao(nt, 0.2)
    gr = _maprange(nt, 0.35, 0.85, 1.0, 0.0)
    nt.links.new(ao, gr.inputs["Value"])
    gc = _rgb(nt, grime)
    mxg = _mix(nt, col, gc.outputs[0], gr.outputs[0])
    col = mxg.outputs[2]
    # worn bright edges
    pt = _pointiness(nt)
    pr = _maprange(nt, 0.56, 0.70)
    nt.links.new(pt, pr.inputs["Value"])
    wc = _rgb(nt, worn)
    mxw = _mix(nt, col, wc.outputs[0], pr.outputs[0])
    col = mxw.outputs[2]
    nt.links.new(col, bsdf.inputs["Base Color"])
    # roughness: rougher in grime, glossier on worn edges
    rmix = nt.nodes.new("ShaderNodeMath"); rmix.operation = 'MULTIPLY_ADD'
    nt.links.new(pr.outputs[0], rmix.inputs[0]); rmix.inputs[1].default_value = -0.25; rmix.inputs[2].default_value = rough
    radd = nt.nodes.new("ShaderNodeMath"); radd.operation = 'MULTIPLY_ADD'
    nt.links.new(gr.outputs[0], radd.inputs[0]); radd.inputs[1].default_value = 0.35
    nt.links.new(rmix.outputs[0], radd.inputs[2])
    nt.links.new(radd.outputs[0], bsdf.inputs["Roughness"])
    bsdf.inputs["Metallic"].default_value = metallic
    if rust:
        # rust is dielectric
        mm = nt.nodes.new("ShaderNodeMath"); mm.operation = 'MULTIPLY_ADD'
        nt.links.new(rr.outputs[0], mm.inputs[0]); mm.inputs[1].default_value = -metallic; mm.inputs[2].default_value = metallic
        nt.links.new(mm.outputs[0], bsdf.inputs["Metallic"])
    # bump: hammered dents (low frequency) + faint scratches (medium) - nothing below texel size
    n3 = _noise(nt, scale * 0.5, 2.5, 0.5)
    n4 = _noise(nt, scale * 1.6, 2.0, 0.45)
    ad = nt.nodes.new("ShaderNodeMath"); ad.operation = 'MULTIPLY_ADD'
    nt.links.new(n4.outputs["Fac"], ad.inputs[0]); ad.inputs[1].default_value = 0.35
    nt.links.new(n3.outputs["Fac"], ad.inputs[2])
    b = _bump(nt, ad.outputs[0], bump, 0.03)
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_paint(name, base, rough=0.5, chip=(0.35, 0.33, 0.3), scale=14.0, bump=0.15, metallic=0.0, chips=True):
    """Painted surface with paint chipping to bare metal on the edges and soft mottling."""
    m, nt, bsdf = _mat(name)
    n1 = _noise(nt, scale, 4.0, 0.5)
    mott = _ramp(nt, [(0.3, (base[0] * 0.85, base[1] * 0.85, base[2] * 0.85, 1)), (0.7, (min(1, base[0] * 1.08), min(1, base[1] * 1.08), min(1, base[2] * 1.08), 1))])
    nt.links.new(n1.outputs["Fac"], mott.inputs["Fac"])
    col = mott.outputs["Color"]
    if chips:
        pt = _pointiness(nt)
        n2 = _noise(nt, scale * 2.2, 3.0, 0.6)
        add = nt.nodes.new("ShaderNodeMath"); add.operation = 'MULTIPLY_ADD'
        nt.links.new(pt, add.inputs[0]); add.inputs[1].default_value = 1.0
        mul = nt.nodes.new("ShaderNodeMath"); mul.operation = 'MULTIPLY'
        nt.links.new(n2.outputs["Fac"], mul.inputs[0]); mul.inputs[1].default_value = 0.12
        nt.links.new(mul.outputs[0], add.inputs[2])
        pr = _maprange(nt, 0.60, 0.66)
        nt.links.new(add.outputs[0], pr.inputs["Value"])
        cc = _rgb(nt, chip)
        mx = _mix(nt, col, cc.outputs[0], pr.outputs[0])
        col = mx.outputs[2]
        mm = nt.nodes.new("ShaderNodeMath"); mm.operation = 'MULTIPLY_ADD'
        nt.links.new(pr.outputs[0], mm.inputs[0]); mm.inputs[1].default_value = 0.8 - metallic; mm.inputs[2].default_value = metallic
        nt.links.new(mm.outputs[0], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Metallic"].default_value = metallic
    ao = _ao(nt, 0.15)
    gr = _maprange(nt, 0.3, 0.9, 1.0, 0.0)
    nt.links.new(ao, gr.inputs["Value"])
    gc = _rgb(nt, (base[0] * 0.35, base[1] * 0.35, base[2] * 0.35))
    mxg = _mix(nt, col, gc.outputs[0], gr.outputs[0])
    nt.links.new(mxg.outputs[2], bsdf.inputs["Base Color"])
    rn = _noise(nt, scale * 1.5, 3.0, 0.5)
    rr = _maprange(nt, 0.3, 0.7, rough - 0.12, rough + 0.12)
    nt.links.new(rn.outputs["Fac"], rr.inputs["Value"])
    nt.links.new(rr.outputs[0], bsdf.inputs["Roughness"])
    n3 = _noise(nt, scale * 0.7, 3.0, 0.5)
    b = _bump(nt, n3.outputs["Fac"], bump, 0.02)
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_skin(name, base, rough=0.55, blush=None, scale=9.0, bump=0.12):
    """Soft matte 'toy' skin with gentle mottling, warmer in the crevices, optional blush tint."""
    m, nt, bsdf = _mat(name)
    n1 = _noise(nt, scale, 3.0, 0.45)
    mott = _ramp(nt, [(0.35, (base[0] * 0.9, base[1] * 0.88, base[2] * 0.86, 1)), (0.65, (min(1, base[0] * 1.06), min(1, base[1] * 1.04), min(1, base[2] * 1.03), 1))])
    nt.links.new(n1.outputs["Fac"], mott.inputs["Fac"])
    col = mott.outputs["Color"]
    ao = _ao(nt, 0.12)
    gr = _maprange(nt, 0.4, 0.95, 1.0, 0.0)
    nt.links.new(ao, gr.inputs["Value"])
    warm = blush or (base[0] * 0.7, base[1] * 0.45, base[2] * 0.45)
    wc = _rgb(nt, warm)
    mx = _mix(nt, col, wc.outputs[0], gr.outputs[0])
    nt.links.new(mx.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    n3 = _noise(nt, scale * 1.2, 3.0, 0.5)
    b = _bump(nt, n3.outputs["Fac"], bump, 0.02)
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_cloth(name, base, rough=0.9, scale=60.0, bump=0.5):
    """Woven cloth: two crossed wave patterns for the weave bump, dusty AO in folds."""
    m, nt, bsdf = _mat(name)
    w1 = nt.nodes.new("ShaderNodeTexWave"); w1.wave_type = 'BANDS'; w1.bands_direction = 'X'
    w1.inputs["Scale"].default_value = scale; w1.inputs["Distortion"].default_value = 1.5; w1.inputs["Detail"].default_value = 2
    w2 = nt.nodes.new("ShaderNodeTexWave"); w2.wave_type = 'BANDS'; w2.bands_direction = 'Y'
    w2.inputs["Scale"].default_value = scale; w2.inputs["Distortion"].default_value = 1.5; w2.inputs["Detail"].default_value = 2
    mul = nt.nodes.new("ShaderNodeMath"); mul.operation = 'MULTIPLY'
    nt.links.new(w1.outputs["Fac"], mul.inputs[0]); nt.links.new(w2.outputs["Fac"], mul.inputs[1])
    n1 = _noise(nt, 6.0, 3.0, 0.5)
    mott = _ramp(nt, [(0.3, (base[0] * 0.8, base[1] * 0.8, base[2] * 0.8, 1)), (0.7, (min(1, base[0] * 1.1), min(1, base[1] * 1.1), min(1, base[2] * 1.1), 1))])
    nt.links.new(n1.outputs["Fac"], mott.inputs["Fac"])
    ao = _ao(nt, 0.15)
    gr = _maprange(nt, 0.3, 0.9, 1.0, 0.0)
    nt.links.new(ao, gr.inputs["Value"])
    gc = _rgb(nt, (base[0] * 0.4, base[1] * 0.4, base[2] * 0.4))
    mx = _mix(nt, mott.outputs["Color"], gc.outputs[0], gr.outputs[0])
    nt.links.new(mx.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.0
    b = _bump(nt, mul.outputs[0], bump, 0.003)
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_wood(name, base=(0.36, 0.22, 0.11), dark=(0.16, 0.09, 0.04), rough=0.7, scale=3.0):
    m, nt, bsdf = _mat(name)
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (1.0, 1.0, 0.12)
    tc = nt.nodes.new("ShaderNodeTexCoord"); nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    n1 = _noise(nt, scale * 6, 5.0, 0.6, 0.6); nt.links.new(mp.outputs[0], n1.inputs["Vector"])
    ramp = _ramp(nt, [(0.35, (dark[0], dark[1], dark[2], 1)), (0.55, (base[0], base[1], base[2], 1)), (0.75, (dark[0] * 1.2, dark[1] * 1.2, dark[2] * 1.2, 1))])
    nt.links.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    ao = _ao(nt, 0.15)
    gr = _maprange(nt, 0.3, 0.9, 1.0, 0.0)
    nt.links.new(ao, gr.inputs["Value"])
    gc = _rgb(nt, (dark[0] * 0.5, dark[1] * 0.5, dark[2] * 0.5))
    mx = _mix(nt, ramp.outputs["Color"], gc.outputs[0], gr.outputs[0])
    nt.links.new(mx.outputs[2], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    b = _bump(nt, n1.outputs["Fac"], 0.4, 0.01)
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_flat(name, base, rough=0.5, metallic=0.0, bump=0.0, scale=20.0, category='atlas'):
    """Plain colour (eye whites, pupils, teeth) with an optional micro-bump."""
    m, nt, bsdf = _mat(name, category)
    bsdf.inputs["Base Color"].default_value = (base[0], base[1], base[2], 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    if bump > 0:
        n3 = _noise(nt, scale * 0.4, 3.0, 0.5)
        b = _bump(nt, n3.outputs["Fac"], bump, 0.02)
        nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def mat_glow(name, color, strength=4.0, base=None):
    """Emissive (lantern glass, eye slits, gems). Stays its own material slot — never atlased."""
    m, nt, bsdf = _mat(name, 'glow')
    b = base or (color[0] * 0.6, color[1] * 0.6, color[2] * 0.6)
    bsdf.inputs["Base Color"].default_value = (b[0], b[1], b[2], 1)
    bsdf.inputs["Roughness"].default_value = 0.25
    bsdf.inputs["Emission Color"].default_value = (color[0], color[1], color[2], 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    return m


def mat_wing(name, color=(0.75, 0.93, 1.0), alpha=0.42, emit=(0.16, 0.42, 0.55), emit_strength=0.4):
    """Translucent insect wing — alpha blended, two-sided, faint self-glow so it reads against fog."""
    m, nt, bsdf = _mat(name, 'wing')
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1)
    bsdf.inputs["Roughness"].default_value = 0.15
    bsdf.inputs["Alpha"].default_value = alpha
    bsdf.inputs["Emission Color"].default_value = (emit[0], emit[1], emit[2], 1)
    bsdf.inputs["Emission Strength"].default_value = emit_strength
    for attr, val in (("surface_render_method", 'BLENDED'), ("blend_method", 'BLEND')):
        try:
            setattr(m, attr, val)
        except Exception:
            pass
    m.use_backface_culling = False
    return m


# ----------------------------------------------------------------------------------------------
# geometry primitives — every one returns a real mesh object already bevelled / smoothed and
# tagged with its bone + material. Rotation is Euler XYZ in degrees (Blender axes).
# ----------------------------------------------------------------------------------------------

class Builder:
    def __init__(self, name, out_dir, atlas=1024, height=None, detail=1.0):
        # `detail` scales EVERY primitive's segment/ring count (env CB_DETAIL overrides). It is a pure
        # tessellation knob: no part is removed, no silhouette element disappears, only facet counts drop.
        # This is how a creature meets its triangle budget without deleting content.
        self.detail = float(os.environ.get("CB_DETAIL", detail))
        self.name = name
        self.out_dir = out_dir
        self.tex_dir = os.path.join(out_dir, "textures")
        os.makedirs(self.tex_dir, exist_ok=True)
        os.makedirs(os.path.join(out_dir, "_turntable"), exist_ok=True)
        self.atlas = atlas
        self.height = height
        self.sc = fresh_scene()
        self.parts = []          # mesh objects (before join)
        self.materials = {}      # name -> material
        self.arm = None
        self.mesh = None
        self.clips = []          # (name, frames, action)
        self.bone_rest = {}      # name -> (head, tail, parent)
        self.face_at = None      # world point the close-up looks at
        self.face_r = 0.3
        self.notes = []
        self.bake_seconds = 0.0
        self.t0 = time.time()

    def _seg(self, n, lo=6):
        """Scale a segment count by self.detail, never below `lo` (a ring of 6 still reads round)."""
        if self.detail >= 0.999:
            return int(n)
        return max(int(lo), int(round(int(n) * self.detail)))

    # ---- material registry ----------------------------------------------------------------
    def mat(self, key, factory=None, *a, **kw):
        if key in self.materials:
            return self.materials[key]
        if factory is None:
            raise KeyError(key)
        m = factory(self.name + "_" + key, *a, **kw)
        self.materials[key] = m
        return m

    # ---- part registration ----------------------------------------------------------------
    def _finish(self, ob, name, bone, mat, at, rot, scale, smooth, bevel, segs, subdiv, angle=30.0):
        ob.name = name
        ob.location = Vector(at)
        ob.rotation_euler = Euler([math.radians(r) for r in rot], 'XYZ')
        ob.scale = Vector(scale)
        activate(ob)
        if bevel and bevel > 0:
            bv = ob.modifiers.new("bevel", 'BEVEL')
            bv.width = bevel
            bv.segments = segs
            bv.limit_method = 'ANGLE'
            bv.angle_limit = math.radians(40)
            bv.harden_normals = False
            bpy.ops.object.modifier_apply(modifier="bevel")
        if subdiv and subdiv > 0:
            sd = ob.modifiers.new("subd", 'SUBSURF')
            sd.levels = subdiv
            sd.render_levels = subdiv
            bpy.ops.object.modifier_apply(modifier="subd")
        # bake object transform into the mesh so joining/weights are in world space
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if smooth:
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
        else:
            bpy.ops.object.shade_flat()
        ob.data.materials.append(mat)
        vg = ob.vertex_groups.new(name=bone)
        vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
        ob["cb_bone"] = bone
        self.parts.append(ob)
        return ob

    def sphere(self, name, r, at, bone, mat, seg=24, rings=16, scale=(1, 1, 1), rot=(0, 0, 0), subdiv=0):
        seg, rings = self._seg(seg, 8), self._seg(rings, 5)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=rings)
        ob = bpy.context.active_object
        return self._finish(ob, name, bone, mat, at, rot, scale, True, 0, 0, subdiv, angle=80)

    def ico(self, name, r, at, bone, mat, subdiv=2, scale=(1, 1, 1), rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_ico_sphere_add(radius=r, subdivisions=subdiv)
        ob = bpy.context.active_object
        return self._finish(ob, name, bone, mat, at, rot, scale, True, 0, 0, 0, angle=80)

    def rbox(self, name, size, at, bone, mat, bevel=0.03, segs=3, rot=(0, 0, 0), scale=(1, 1, 1), smooth=True):
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        ob = bpy.context.active_object
        ob.scale = Vector(size)
        activate(ob)
        bpy.ops.object.transform_apply(scale=True)
        return self._finish(ob, name, bone, mat, at, rot, scale, smooth, bevel, segs, 0)

    def cyl(self, name, r1, r2, depth, at, bone, mat, seg=24, bevel=0.0, segs=2, rot=(0, 0, 0), scale=(1, 1, 1), smooth=True, cap=True):
        seg = self._seg(seg, 6)
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r1, radius2=r2, depth=depth, end_fill_type='NGON' if cap else 'NOTHING')
        ob = bpy.context.active_object
        return self._finish(ob, name, bone, mat, at, rot, scale, smooth, bevel, segs, 0, angle=40)

    def capsule(self, name, r, length, at, bone, mat, seg=16, rot=(0, 0, 0), scale=(1, 1, 1), rings=4):
        """Rounded cylinder along local Z: cylinder of `length` (between the hemisphere centres) + bevel."""
        seg, rings = self._seg(seg, 6), self._seg(rings, 2)
        bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=length + 2 * r)
        ob = bpy.context.active_object
        return self._finish(ob, name, bone, mat, at, rot, scale, True, r * 0.98, rings, 0, angle=80)

    def cone(self, name, r, h, at, bone, mat, seg=8, rot=(0, 0, 0), bevel=0.01, scale=(1, 1, 1)):
        seg = self._seg(seg, 5)
        bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=0.0, depth=h)
        ob = bpy.context.active_object
        return self._finish(ob, name, bone, mat, at, rot, scale, True, bevel, 2, 0, angle=50)

    def torus(self, name, R, r, at, bone, mat, seg_major=32, seg_minor=12, rot=(0, 0, 0), scale=(1, 1, 1)):
        seg_major, seg_minor = self._seg(seg_major, 10), self._seg(seg_minor, 5)
        bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg_major, minor_segments=seg_minor)
        ob = bpy.context.active_object
        return self._finish(ob, name, bone, mat, at, rot, scale, True, 0, 0, 0, angle=80)

    def lathe(self, name, profile, at, bone, mat, seg=32, rot=(0, 0, 0), scale=(1, 1, 1), smooth=True, close=True, angle=40):
        """Spin a (radius, z) profile around local Z. Profile runs bottom→top; r=0 endpoints make poles."""
        seg = self._seg(seg, 8)
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        prev = None
        rings = []
        for (r, z) in profile:
            if r <= 1e-6:
                v = bm.verts.new((0, 0, z))
                rings.append([v])
            else:
                ring = []
                for i in range(seg):
                    a = 2 * math.pi * i / seg
                    ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
                rings.append(ring)
        for k in range(len(rings) - 1):
            a, b = rings[k], rings[k + 1]
            if len(a) == 1 and len(b) == 1:
                continue
            if len(a) == 1:
                for i in range(seg):
                    bm.faces.new((a[0], b[(i + 1) % seg], b[i]))
            elif len(b) == 1:
                for i in range(seg):
                    bm.faces.new((a[i], a[(i + 1) % seg], b[0]))
            else:
                for i in range(seg):
                    bm.faces.new((a[i], a[(i + 1) % seg], b[(i + 1) % seg], b[i]))
        if close:
            if len(rings[0]) > 1:
                bm.faces.new(list(reversed(rings[0])))
            if len(rings[-1]) > 1:
                bm.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        self.sc.collection.objects.link(ob)
        return self._finish(ob, name, bone, mat, at, rot, scale, smooth, 0, 0, 0, angle=angle)

    def slab(self, name, outline, thickness, at, bone, mat, rot=(0, 0, 0), scale=(1, 1, 1), bevel=0.0, subdiv=0):
        """Flat rounded plate from a 2-D outline (x, y) extruded ±thickness/2 along Z (wings, brows, plates)."""
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        top = [bm.verts.new((x, y, thickness * 0.5)) for (x, y) in outline]
        bot = [bm.verts.new((x, y, -thickness * 0.5)) for (x, y) in outline]
        bm.faces.new(top)
        bm.faces.new(list(reversed(bot)))
        n = len(outline)
        for i in range(n):
            bm.faces.new((bot[i], bot[(i + 1) % n], top[(i + 1) % n], top[i]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        self.sc.collection.objects.link(ob)
        return self._finish(ob, name, bone, mat, at, rot, scale, True, bevel, 2, subdiv, angle=40)

    def tube(self, name, points, r, bone, mat, seg=8, rings=1):
        """Bevelled polyline tube (antennae, hooks, chains): points in world space."""
        seg = self._seg(seg, 6)
        cu = bpy.data.curves.new(name, 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = r
        cu.bevel_resolution = max(1, seg // 4 - 1)
        cu.resolution_u = 6
        cu.use_fill_caps = True
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(len(points) - 1)
        for i, p in enumerate(points):
            bp = sp.bezier_points[i]
            bp.co = Vector(p)
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
        ob = bpy.data.objects.new(name, cu)
        self.sc.collection.objects.link(ob)
        activate(ob)
        bpy.ops.object.convert(target='MESH')
        ob = bpy.context.active_object
        return self._finish(ob, name, bone, mat, (0, 0, 0), (0, 0, 0), (1, 1, 1), True, 0, 0, 0, angle=60)

    # ---- booleans ---------------------------------------------------------------------------
    def cut(self, target, cutter, op='DIFFERENCE', smooth_deg=40.0):
        """Boolean `target` by `cutter` (cutter is consumed). Exact solver; both must be closed.

        The EXACT solver hands back a re-tessellated mesh whose faces carry the CUTTER's flat
        shading, so a smooth lathe comes out of a boolean faceted — that is why Old Fen's hood
        (a 26-segment lathe with the face cut open) rendered as an octagonal slab. If the target
        was smooth going in, re-apply smooth-by-angle coming out."""
        was_smooth = any(pl.use_smooth for pl in target.data.polygons)
        activate(target)
        md = target.modifiers.new("bool", 'BOOLEAN')
        md.operation = op
        md.solver = 'EXACT'
        md.object = cutter
        bpy.ops.object.modifier_apply(modifier="bool")
        if was_smooth and smooth_deg:
            activate(target)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_deg))
        if cutter in self.parts:
            self.parts.remove(cutter)
        bpy.data.objects.remove(cutter, do_unlink=True)
        self._clean_slots(target)
        return target

    def _clean_slots(self, ob):
        """Booleans append the cutter's (empty) material slots — drop every None slot, remapping faces to 0."""
        while True:
            idx = next((i for i, m in enumerate(ob.data.materials) if m is None), -1)
            if idx < 0:
                break
            for p in ob.data.polygons:
                if p.material_index == idx:
                    p.material_index = 0
                elif p.material_index > idx:
                    p.material_index -= 1
            ob.data.materials.pop(index=idx)

    def cutter(self, name, size, at, rot=(0, 0, 0)):
        """An unregistered box used only for booleans."""
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        ob = bpy.context.active_object
        ob.name = name
        ob.scale = Vector(size)
        ob.location = Vector(at)
        ob.rotation_euler = Euler([math.radians(r) for r in rot], 'XYZ')
        activate(ob)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        return ob

    def cutter_sphere(self, name, r, at, scale=(1, 1, 1)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=24, ring_count=16)
        ob = bpy.context.active_object
        ob.name = name
        ob.location = Vector(at)
        ob.scale = Vector(scale)
        activate(ob)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        return ob

    def assign_faces(self, ob, mat, predicate):
        """Give faces of `ob` whose centre satisfies predicate(Vector) a second material (e.g. mouth interior)."""
        self._clean_slots(ob)
        names = [m.name for m in ob.data.materials]
        if mat.name not in names:
            ob.data.materials.append(mat)
            names.append(mat.name)
        idx = names.index(mat.name)
        for p in ob.data.polygons:
            if predicate(Vector(p.center)):
                p.material_index = idx

    def mirror(self, ob, bone=None):
        """Mirror a registered part across X (world), keeping its material, with a new bone name."""
        activate(ob)
        bpy.ops.object.duplicate(linked=False)
        d = bpy.context.active_object
        d.name = ob.name.replace("_L", "_R") if "_L" in ob.name else ob.name + "_R"
        md = d.modifiers.new("mir", 'MIRROR')
        md.use_axis[0] = True
        md.use_bisect_axis[0] = True
        md.use_bisect_flip_axis[0] = True
        md.mirror_object = None
        bpy.ops.object.modifier_apply(modifier="mir")
        # the mirror modifier keeps the original half too when it does not cross X; rebuild by flipping
        d.data.transform(Matrix.Scale(-1, 4, Vector((1, 0, 0))))
        d.data.flip_normals()
        for vg in list(d.vertex_groups):
            d.vertex_groups.remove(vg)
        b = bone or (ob["cb_bone"].replace("_L", "_R") if "_L" in ob["cb_bone"] else ob["cb_bone"])
        vg = d.vertex_groups.new(name=b)
        vg.add(list(range(len(d.data.vertices))), 1.0, 'REPLACE')
        d["cb_bone"] = b
        self.parts.append(d)
        return d

    def soft_weights(self, ob, bands):
        """Replace rigid weights with a vertical blend: bands = [(bone, z), ...] ascending; a vertex between
        two band heights is split linearly between the two bones (robes, beards, tails)."""
        for vg in list(ob.vertex_groups):
            ob.vertex_groups.remove(vg)
        groups = {}
        for bname, _ in bands:
            if bname not in groups:
                groups[bname] = ob.vertex_groups.new(name=bname)
        for v in ob.data.vertices:
            z = v.co.z
            if z <= bands[0][1]:
                groups[bands[0][0]].add([v.index], 1.0, 'REPLACE')
                continue
            if z >= bands[-1][1]:
                groups[bands[-1][0]].add([v.index], 1.0, 'REPLACE')
                continue
            for i in range(len(bands) - 1):
                b0, z0 = bands[i]
                b1, z1 = bands[i + 1]
                if z0 <= z <= z1:
                    t = (z - z0) / max(1e-6, z1 - z0)
                    t = t * t * (3 - 2 * t)
                    if b0 == b1:
                        groups[b0].add([v.index], 1.0, 'REPLACE')
                    else:
                        groups[b0].add([v.index], 1.0 - t, 'REPLACE')
                        groups[b1].add([v.index], t, 'REPLACE')
                    break
        ob["cb_bone"] = bands[0][0]

    # ---- join + uv --------------------------------------------------------------------------
    def part_tris(self):
        rows = []
        for p in self.parts:
            rows.append((p.name, sum(len(f.vertices) - 2 for f in p.data.polygons)))
        rows.sort(key=lambda r: -r[1])
        total = sum(r[1] for r in rows)
        log("part tris (total %d):" % total, ", ".join("%s=%d" % r for r in rows))
        return total

    def build_mesh(self):
        total = self.part_tris()
        if os.environ.get("CB_DRY"):
            log("DRY %s detail=%.2f tris=%d" % (self.name, self.detail, total))
            sys.exit(0)
        deselect_all()
        for p in self.parts:
            p.select_set(True)
        bpy.context.view_layer.objects.active = self.parts[0]
        bpy.ops.object.join()
        me = bpy.context.active_object
        me.name = self.name
        me.data.name = self.name + "_mesh"
        self.mesh = me
        # uv: smart project per island, then equalise + pack (all faces)
        mode('EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.select_all(action='SELECT')
        try:
            bpy.ops.uv.average_islands_scale()
        except Exception as e:
            log("average_islands_scale failed", e)
        try:
            bpy.ops.uv.pack_islands(margin=0.004, rotate=True, scale=True, margin_method='FRACTION', shape_method='AABB')
        except TypeError:
            bpy.ops.uv.pack_islands(margin=0.004, rotate=True)
        mode('OBJECT')
        return me

    # ---- bake --------------------------------------------------------------------------------
    def bake(self, ao_samples=24):
        """Bake the atlas category into albedo (sRGB) / normal / ORM(AO,rough,metal) PNGs, then
        swap every atlas material for one textured Principled material. Glow / wing materials survive
        as their own slots (they get a throw-away bake target so Cycles does not refuse the bake)."""
        sc = self.sc
        me = self.mesh
        t0 = time.time()
        size = self.atlas
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = 24
        sc.cycles.use_denoising = False
        sc.render.bake.margin = max(8, size // 128)
        sc.render.bake.margin_type = 'EXTEND'
        sc.render.bake.use_clear = True
        sc.render.bake.use_selected_to_active = False

        def new_img(nm, srgb):
            im = bpy.data.images.new(self.name + "_" + nm, size, size, alpha=False, float_buffer=False)
            im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
            im.generated_color = (0, 0, 0, 1)
            return im
        albedo = new_img("albedo", True)
        normal = new_img("normal", False)
        rough = new_img("rough", False)
        metal = new_img("metal", False)
        ao = new_img("ao", False)
        dummy = bpy.data.images.new(self.name + "_dummy", 64, 64)
        atlas_mats = [m for m in me.data.materials if m.get("cb_category", 'atlas') == 'atlas']
        other_mats = [m for m in me.data.materials if m.get("cb_category", 'atlas') != 'atlas']

        def target(img):
            for m in me.data.materials:
                nt = m.node_tree
                n = nt.nodes.get("BAKE_TARGET")
                if not n:
                    n = nt.nodes.new("ShaderNodeTexImage")
                    n.name = "BAKE_TARGET"
                n.image = img if m in atlas_mats else dummy
                for x in nt.nodes:
                    x.select = False
                n.select = True
                nt.nodes.active = n
        activate(me)

        def bake_socket(socket, img):
            """Bake ONE Principled input (Base Color / Metallic / Roughness) exactly, by routing it through a
            temporary Emission shader: Cycles' DIFFUSE colour pass is base*(1-metallic), useless for glTF metals."""
            saved = []
            for m in atlas_mats:
                nt = m.node_tree
                bs = [n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'][0]
                outn = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
                em = nt.nodes.new("ShaderNodeEmission")
                mi = bs.inputs[socket]
                if mi.is_linked:
                    nt.links.new(mi.links[0].from_socket, em.inputs["Color"])
                else:
                    v = mi.default_value
                    em.inputs["Color"].default_value = (v[0], v[1], v[2], 1) if hasattr(v, "__len__") else (v, v, v, 1)
                nt.links.new(em.outputs["Emission"], outn.inputs["Surface"])
                saved.append((nt, bs, outn, em))
            target(img)
            bpy.ops.object.bake(type='EMIT', margin=sc.render.bake.margin)
            for nt, bs, outn, em in saved:
                nt.links.new(bs.outputs["BSDF"], outn.inputs["Surface"])
                nt.nodes.remove(em)
        bake_socket("Base Color", albedo)
        target(normal)
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', margin=sc.render.bake.margin)
        bake_socket("Roughness", rough)
        bake_socket("Metallic", metal)
        # ambient occlusion (real rays)
        sc.cycles.samples = max(ao_samples, 24)
        sc.render.bake.use_pass_direct = True
        sc.render.bake.use_pass_indirect = True
        target(ao)
        bpy.ops.object.bake(type='AO', margin=sc.render.bake.margin)
        sc.cycles.samples = 1

        def px(im):
            a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
            im.pixels.foreach_get(a)
            return a.reshape(im.size[1], im.size[0], 4)
        ro, mt, aa = px(rough), px(metal), px(ao)
        orm_a = np.ones_like(ro)
        orm_a[..., 0] = np.clip(aa[..., 0] * 0.75 + 0.25, 0, 1)     # soften AO: never black holes
        orm_a[..., 1] = ro[..., 0]
        orm_a[..., 2] = mt[..., 0]
        orm = new_img("orm", False)
        orm.pixels.foreach_set(orm_a.ravel())
        self.tex_files = {}
        for key, im in (("albedo", albedo), ("normal", normal), ("orm", orm)):
            fp = os.path.join(self.tex_dir, self.name + "_" + key + ".png")
            im.filepath_raw = fp
            im.file_format = 'PNG'
            im.save()
            self.tex_files[key] = fp
            log("saved", fp, os.path.getsize(fp))
        for im in (rough, metal, ao, dummy):
            bpy.data.images.remove(im)
        # export material
        am = bpy.data.materials.new(self.name + "_atlas")
        am.use_nodes = True
        nt = am.node_tree
        bs = nt.nodes["Principled BSDF"]
        bs.inputs["Roughness"].default_value = 1.0
        bs.inputs["Metallic"].default_value = 1.0

        def tex(img, srgb):
            n = nt.nodes.new("ShaderNodeTexImage")
            n.image = img
            n.interpolation = 'Linear'
            return n
        nt.links.new(tex(albedo, True).outputs["Color"], bs.inputs["Base Color"])
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 1.0
        nt.links.new(tex(normal, False).outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bs.inputs["Normal"])
        to = tex(orm, False)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(to.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bs.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bs.inputs["Metallic"])
        # occlusion via the exporter's custom group
        try:
            g = bpy.data.node_groups.get("glTF Material Output") or bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
            if not any(s.name == "Occlusion" for s in g.interface.items_tree):
                g.interface.new_socket("Occlusion", in_out='INPUT', socket_type='NodeSocketFloat')
            gn = nt.nodes.new("ShaderNodeGroup")
            gn.node_tree = g
            nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])
        except Exception as e:
            log("occlusion group skipped:", e)
        am["cb_category"] = 'atlas'
        # rebuild the slot list: one atlas slot + the survivors. Face indices are captured FIRST —
        # materials.clear() resets them to 0 (that silently dropped the glow/wing slots from the export).
        old = list(me.data.materials)
        new_list = [am] + other_mats
        remap = [0 if m in atlas_mats else new_list.index(m) for m in old]
        old_idx = [p.material_index for p in me.data.polygons]
        me.data.materials.clear()
        for m in new_list:
            me.data.materials.append(m)
        for p, oi in zip(me.data.polygons, old_idx):
            p.material_index = remap[oi]
        me.data.update()
        used = sorted(set(p.material_index for p in me.data.polygons))
        log("material slots used by faces:", [new_list[i].name for i in used])
        for m in other_mats:
            n = m.node_tree.nodes.get("BAKE_TARGET")
            if n:
                m.node_tree.nodes.remove(n)
        for m in atlas_mats:
            bpy.data.materials.remove(m)
        self.bake_seconds = time.time() - t0
        log("bake done in", round(self.bake_seconds, 1), "s; slots:", [m.name for m in me.data.materials])

    # ---- rig ------------------------------------------------------------------------------------
    def rig(self, bones):
        """bones: ordered list of (name, head, tail, parent_or_None). Creates the armature at the origin,
        parents the mesh with an armature modifier (the vertex groups are the weights)."""
        bpy.ops.object.armature_add(location=(0, 0, 0))
        arm = bpy.context.active_object
        arm.name = self.name + "_rig"
        arm.data.name = self.name + "_armature"
        self.arm = arm
        mode('EDIT')
        eb = arm.data.edit_bones
        first = eb[0]
        made = {}
        for i, (name, head, tail, parent) in enumerate(bones):
            b = first if i == 0 else eb.new(name)
            b.name = name
            b.head = Vector(head)
            b.tail = Vector(tail)
            b.roll = 0.0
            if parent:
                b.parent = made[parent]
                b.use_connect = False
            made[name] = b
            self.bone_rest[name] = (Vector(head), Vector(tail), parent)
        mode('OBJECT')
        me = self.mesh
        md = me.modifiers.new("armature", 'ARMATURE')
        md.object = arm
        me.parent = arm
        # every vertex group must name a bone
        missing = [vg.name for vg in me.vertex_groups if vg.name not in arm.data.bones]
        if missing:
            raise RuntimeError("vertex groups without bones: %s" % missing)
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        arm.animation_data_create()
        self._rest_basis = {}
        for b in arm.data.bones:
            self._rest_basis[b.name] = (arm.matrix_world @ b.matrix_local).to_3x3()
        return arm

    # ---- animation -------------------------------------------------------------------------------
    def rest_pose(self):
        """Zero every pose bone. The NLA overrides only the channels a strip keys; every other channel keeps
        the bone's STATIC pose - which after authoring is the last clip's last key. Reset before any
        evaluation (export, renders) so unkeyed channels mean 'rest', never 'whatever was keyed last'."""
        if not self.arm:
            return
        for pb in self.arm.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.scale = (1, 1, 1)

    def clip(self, name, frames):
        """Start a clip: returns a Clip context. Frames = last frame index (clip spans 0..frames)."""
        return Clip(self, name, frames)

    def _key(self, act, frame, bone, rot=None, loc=None, scale=None):
        pb = self.arm.pose.bones[bone]
        B = self._rest_basis[bone]
        if rot is not None:
            if isinstance(rot, Quaternion):
                R = rot.to_matrix()
            else:
                R = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix()
            L = B.inverted() @ R @ B
            pb.rotation_quaternion = L.to_quaternion()
            pb.keyframe_insert("rotation_quaternion", frame=frame)
        if loc is not None:
            pb.location = B.inverted() @ Vector(loc)
            pb.keyframe_insert("location", frame=frame)
        if scale is not None:
            # world-axis scale mapped onto the bone's local axes by their dominant world axis
            s = Vector((1, 1, 1))
            for li in range(3):
                axis = Vector(B.col[li]).normalized()
                dom = max(range(3), key=lambda k: abs(axis[k]))
                s[li] = scale[dom]
            pb.scale = s
            pb.keyframe_insert("scale", frame=frame)

    def warp(self, ob, fn):
        """Displace every vertex of a registered part: fn(Vector world) -> Vector world (stoops, shears, bulges)."""
        for v in ob.data.vertices:
            v.co = fn(Vector(v.co))
        ob.data.update()

    # ---- export ----------------------------------------------------------------------------------
    def export(self, filename=None):
        fn = filename or (self.name + ".glb")
        path = os.path.join(self.out_dir, fn)
        deselect_all()
        self.mesh.select_set(True)
        animated = self.arm is not None
        if animated:
            for tr in self.arm.animation_data.nla_tracks:
                tr.mute = False
                tr.is_solo = False
            self.arm.animation_data.action = None
            self.rest_pose()
            self.arm.select_set(True)
            bpy.context.view_layer.objects.active = self.arm
        else:
            bpy.context.view_layer.objects.active = self.mesh
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True,
            export_apply=True, export_yup=True,
            export_animations=animated, export_animation_mode='NLA_TRACKS', export_anim_slide_to_zero=True,
            export_optimize_animation_size=True, export_skins=animated, export_all_influences=False,
            export_draco_mesh_compression_enable=False, export_image_format='AUTO',
            export_texcoords=True, export_normals=True, export_materials='EXPORT',
            export_extras=False, export_lights=False, export_cameras=False)
        self.glb_path = path
        log("exported", path, os.path.getsize(path))
        return path

    # ---- stats ------------------------------------------------------------------------------------
    def stats(self):
        me = self.mesh
        dg = bpy.context.evaluated_depsgraph_get()
        ev = me.evaluated_get(dg)
        m = ev.to_mesh()
        tris = sum(len(p.vertices) - 2 for p in m.polygons)
        verts = len(m.vertices)
        ev.to_mesh_clear()
        xs = [v.co.x for v in me.data.vertices]
        ys = [v.co.y for v in me.data.vertices]
        zs = [v.co.z for v in me.data.vertices]
        bmin = (min(xs), min(ys), min(zs))
        bmax = (max(xs), max(ys), max(zs))
        # glTF space: (x, z, -y)
        gmin = [round(bmin[0], 4), round(bmin[2], 4), round(-bmax[1], 4)]
        gmax = [round(bmax[0], 4), round(bmax[2], 4), round(-bmin[1], 4)]
        d = open(self.glb_path, 'rb').read()
        ln = struct.unpack('<I', d[12:16])[0]
        j = json.loads(d[20:20 + ln])
        anims = []
        acc = j["accessors"]
        for a in j.get("animations", []):
            tmax = 0.0
            for s in a["samplers"]:
                tmax = max(tmax, acc[s["input"]]["max"][0])
            anims.append({"name": a["name"], "seconds": round(tmax, 4), "frames": int(round(tmax * FPS)) + 1, "channels": len(a["channels"])})
        prim_tris = 0
        for mm in j["meshes"]:
            for p in mm["primitives"]:
                prim_tris += acc[p["indices"]]["count"] // 3
        info = {
            "name": self.name,
            "file": os.path.basename(self.glb_path),
            "file_bytes": os.path.getsize(self.glb_path),
            "tris": prim_tris,
            "tris_blender": tris,
            "verts": verts,
            "bones": len(self.arm.data.bones) if self.arm else 0,
            "bone_names": [b.name for b in self.arm.data.bones] if self.arm else [],
            "clips": anims,
            "bounds": {"min": gmin, "max": gmax, "height_m": round(bmax[2] - bmin[2], 4)},
            "pivot": [0, 0, 0],
            "forward": "+Z (glTF) — built facing Blender -Y",
            "materials": [m["name"] for m in j["materials"]],
            "textures": {k: os.path.relpath(v, self.out_dir).replace("\\", "/") for k, v in self.tex_files.items()},
            "atlas_px": self.atlas,
            "images_in_glb": [i.get("name") for i in j.get("images", [])],
            "notes": list(self.notes),
        }
        return info

    # ---- renders -----------------------------------------------------------------------------------
    def _render_scene(self):
        sc = self.sc
        sc.render.engine = 'BLENDER_EEVEE'
        try:
            sc.eevee.taa_render_samples = 24
            sc.eevee.use_shadows = True
            sc.eevee.use_raytracing = False
        except Exception:
            pass
        sc.render.resolution_x = sc.render.resolution_y = 1024
        sc.render.resolution_percentage = 100
        # WEBP, not PNG: a turntable is a REVIEW render, and the same 1024x1024 Eevee frame is
        # 948,655 bytes as PNG against 21,262 as WebP q92 (measured, keep/arch_door_00). The four
        # kits had put ~333 MB of turntable PNGs in the repo; as WebP the same 430 frames are 13.5 MB.
        sc.render.image_settings.file_format = 'WEBP'
        sc.render.image_settings.quality = 92
        sc.render.dither_intensity = 0.0
        sc.render.image_settings.color_mode = 'RGB'
        sc.render.film_transparent = False
        try:
            sc.view_settings.view_transform = 'AgX'
            sc.view_settings.look = 'AgX - Medium High Contrast'
            sc.view_settings.exposure = -0.3
        except Exception:
            pass
        w = bpy.data.worlds.new("w")
        sc.world = w
        w.use_nodes = True
        w.node_tree.nodes["Background"].inputs[0].default_value = (0.32, 0.33, 0.35, 1)
        w.node_tree.nodes["Background"].inputs[1].default_value = 0.5
        # backdrop: floor + curved wall (a big bevelled box behind, matte grey)
        bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
        floor = bpy.context.active_object
        floor.name = "_floor"
        fm = bpy.data.materials.new("_floor")
        fm.use_nodes = True
        fb = fm.node_tree.nodes["Principled BSDF"]
        fb.inputs["Base Color"].default_value = (0.36, 0.36, 0.37, 1)
        fb.inputs["Roughness"].default_value = 0.85
        floor.data.materials.append(fm)
        cam_d = bpy.data.cameras.new("cam")
        cam_d.lens = 50
        cam = bpy.data.objects.new("cam", cam_d)
        sc.collection.objects.link(cam)
        sc.camera = cam
        self._cam = cam
        me = self.mesh
        xs = [v.co.x for v in me.data.vertices]; ys = [v.co.y for v in me.data.vertices]; zs = [v.co.z for v in me.data.vertices]
        c = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
        rad = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)) * 0.5 * 1.1
        self._center, self._rad = c, rad
        # three-point rig scaled to the creature
        d = rad * 4.0
        for nm, ang, elev, e, col, sz in (("key", -40, 45, 1.0, (1.0, 0.96, 0.9), 2.0),
                                          ("fill", 70, 20, 0.35, (0.85, 0.9, 1.0), 3.0),
                                          ("rim", 200, 35, 0.8, (0.95, 0.98, 1.0), 1.5)):
            L = bpy.data.lights.new(nm, 'AREA')
            L.energy = e * 260 * (rad ** 2)
            L.size = sz * rad
            L.color = col
            o = bpy.data.objects.new(nm, L)
            sc.collection.objects.link(o)
            a = math.radians(ang); el = math.radians(elev)
            o.location = c + Vector((math.sin(a) * math.cos(el) * d, -math.cos(a) * math.cos(el) * d, math.sin(el) * d))
            o.rotation_euler = (c - o.location).to_track_quat('-Z', 'Y').to_euler()

    def _aim(self, at, dist, yaw_deg, elev_deg, lens=50):
        cam = self._cam
        cam.data.lens = lens
        a = math.radians(yaw_deg); el = math.radians(elev_deg)
        cam.location = at + Vector((math.sin(a) * math.cos(el) * dist, -math.cos(a) * math.cos(el) * dist, math.sin(el) * dist))
        cam.rotation_euler = (at - cam.location).to_track_quat('-Z', 'Y').to_euler()

    def _solo(self, clip_name):
        """Evaluate exactly one NLA track (mute the rest). is_solo is NOT used: assigning is_solo=False to
        any other track clears the armature-level solo flag, which stacked every clip on every render."""
        if not self.arm:
            return
        self.rest_pose()
        for tr in self.arm.animation_data.nla_tracks:
            tr.is_solo = False
            tr.mute = (clip_name is not None and tr.name != clip_name)

    def turntables(self, idle_clip=None, closeup_lens=85):
        self._render_scene()
        sc = self.sc
        tdir = os.path.join(self.out_dir, "_turntable")
        c, rad = self._center, self._rad
        fov = 2 * math.atan(36 / (2 * 50))     # 36 mm sensor, 50 mm lens
        dist = rad / math.tan(fov / 2) * 1.15
        if idle_clip:
            self._solo(idle_clip)
            sc.frame_set(0)
        files = []
        t0 = time.time()
        for i in range(8):
            self._aim(c, dist, i * 45, 14, 50)
            fp = os.path.join(tdir, "%s_tt_%02d.webp" % (self.name, i))
            sc.render.filepath = fp
            bpy.ops.render.render(write_still=True)
            files.append(fp)
        fa = self.face_at or (c + Vector((0, 0, rad * 0.5)))
        fr = self.face_r
        self._aim(Vector(fa), fr / math.tan(2 * math.atan(36 / (2 * closeup_lens)) / 2) * 1.2, -30, 8, closeup_lens)
        fp = os.path.join(tdir, "%s_closeup.webp" % self.name)
        sc.render.filepath = fp
        bpy.ops.render.render(write_still=True)
        files.append(fp)
        log("turntables", len(files), "in", round(time.time() - t0, 1), "s")
        return files

    def contact_sheet(self, cell=512):
        """One frame per clip (the clip's most-displaced frame ~ 45 % through), 3/4 view, tiled with labels."""
        if not self.clips:
            return None
        sc = self.sc
        tdir = os.path.join(self.out_dir, "_turntable")
        c, rad = self._center, self._rad
        fov = 2 * math.atan(36 / (2 * 50))
        dist = rad / math.tan(fov / 2) * 1.25
        sc.render.resolution_x = sc.render.resolution_y = cell
        # a label text object parented to the camera
        cu = bpy.data.curves.new("label", 'FONT')
        cu.size = 0.055
        cu.align_x = 'LEFT'
        lab = bpy.data.objects.new("label", cu)
        sc.collection.objects.link(lab)
        lm = bpy.data.materials.new("_label")
        lm.use_nodes = True
        lb = lm.node_tree.nodes["Principled BSDF"]
        lb.inputs["Base Color"].default_value = (0, 0, 0, 1)
        lb.inputs["Emission Color"].default_value = (1, 1, 1, 1)
        lb.inputs["Emission Strength"].default_value = 12.0
        cu.materials.append(lm)
        lab.parent = self._cam
        lab.location = (-0.50, -0.52, -1.6)
        cells = []
        for (name, frames, act) in self.clips:
            self._solo(name)
            f = int(round(frames * 0.45))
            sc.frame_set(f)
            cu.body = "%s  f%d/%d" % (name, f, frames)
            self._aim(c, dist, -35, 12, 50)
            fp = os.path.join(tdir, "_cell_%s.png" % name)
            sc.render.filepath = fp
            bpy.ops.render.render(write_still=True)
            cells.append(fp)
        # tile
        n = len(cells)
        cols = min(5, n)
        rows = (n + cols - 1) // cols
        sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.float32)
        sheet[..., 3] = 1
        for i, fp in enumerate(cells):
            im = bpy.data.images.load(fp)
            a = np.empty(im.size[0] * im.size[1] * 4, dtype=np.float32)
            im.pixels.foreach_get(a)
            a = a.reshape(im.size[1], im.size[0], 4)
            r, cidx = i // cols, i % cols
            y0 = (rows - 1 - r) * cell
            sheet[y0:y0 + cell, cidx * cell:(cidx + 1) * cell, :] = a
            bpy.data.images.remove(im)
            os.remove(fp)
        out = bpy.data.images.new("_sheet", cols * cell, rows * cell, alpha=True)
        out.pixels.foreach_set(sheet.ravel())
        fp = os.path.join(tdir, "%s_clips.webp" % self.name)
        out.filepath_raw = fp
        out.file_format = 'WEBP'
        out.save()
        sc.frame_set(0)
        self._solo(None)
        log("contact sheet", fp)
        return fp


class Clip:
    def __init__(self, b, name, frames):
        self.b = b
        self.name = name
        self.frames = frames
        self.act = None

    def __enter__(self):
        b = self.b
        act = bpy.data.actions.new(self.name)
        b.arm.animation_data.action = act
        self.act = act
        # reset every bone to rest so clips never inherit a pose
        for pb in b.arm.pose.bones:
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        return self

    def key(self, frame, bone, rot=None, loc=None, scale=None):
        self.b._key(self.act, frame, bone, rot, loc, scale)
        return self

    def keys(self, frame, **bones):
        """keys(12, head=dict(rot=(10,0,0)), jaw=dict(rot=(30,0,0)))"""
        for bone, kw in bones.items():
            self.b._key(self.act, frame, bone, kw.get("rot"), kw.get("loc"), kw.get("scale"))
        return self

    def __exit__(self, et, ev, tb):
        b = self.b
        act = self.act
        # make every keyed channel smooth
        try:
            for fc in act.fcurves:
                for kp in fc.keyframe_points:
                    kp.interpolation = 'BEZIER'
                    kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        except Exception:
            for layer in act.layers:
                for strip in layer.strips:
                    for cb in strip.channelbags:
                        for fc in cb.fcurves:
                            for kp in fc.keyframe_points:
                                kp.interpolation = 'BEZIER'
                                kp.handle_left_type = kp.handle_right_type = 'AUTO_CLAMPED'
        act.frame_range = (0, self.frames)
        act.use_frame_range = True
        b.arm.animation_data.action = None
        tr = b.arm.animation_data.nla_tracks.new()
        tr.name = self.name
        st = tr.strips.new(self.name, 0, act)
        if hasattr(st, "action_slot") and len(act.slots):
            st.action_slot = act.slots[0]
        st.frame_start = 0
        st.frame_end = self.frames
        b.clips.append((self.name, self.frames, act))
        b.sc.frame_end = max(b.sc.frame_end, self.frames)
        b.rest_pose()
        return False


# ----------------------------------------------------------------------------------------------
# helpers for scripts
# ----------------------------------------------------------------------------------------------

def smooth01(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def finish(b, manifest_path, idle_clip, extra=None):
    """Export, measure, render, write the per-asset manifest fragment. Returns the info dict."""
    b.export()
    info = b.stats()
    if extra:
        info.update(extra)
    info["turntable"] = [os.path.relpath(p, b.out_dir).replace("\\", "/") for p in b.turntables(idle_clip)]
    cs = b.contact_sheet()
    info["contact_sheet"] = os.path.relpath(cs, b.out_dir).replace("\\", "/") if cs else None
    info["bake_seconds"] = round(b.bake_seconds, 1)
    info["build_seconds"] = round(time.time() - b.t0, 1)
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
    print("MANIFEST_FRAGMENT " + json.dumps({"name": info["name"], "file": info["file"], "tris": info["tris"], "bones": info["bones"],
                                             "clips": [c["name"] for c in info["clips"]], "height_m": info["bounds"]["height_m"],
                                             "bytes": info["file_bytes"]}), flush=True)
    return info
