"""Stylized-PBR node materials: the VALE studio look (hand-painted feel under PBR light).

Every material here is a Cycles node graph that ends in ONE Principled BSDF named "BSDF" whose
Base Color / Roughness / Metallic / Normal inputs carry the look. bake.py reads those inputs
(emission trick) and rebuilds a plain glTF material from the baked images, so anything painted
into these graphs (edge highlights, cavity dirt, value gradient, weave, grain) ends up in the
textures. Materials named in `KEEP` (the required emissive `accent`, glowing gems) are not baked:
they export as factor-only glTF materials.

Painted cues used throughout:
  * edge highlight from Geometry > Pointiness on the HIGH mesh (worn/lit edges)
  * cavity darkening from a local Ambient Occlusion node (dirt in creases)
  * low-frequency hue/value breakup (brush blotches) + stretched noise (brush strokes)
  * VALUE GRADIENT: object-space Z darkens toward the feet and lifts toward the head/shoulders
    (classic top-down readability: the silhouette's top pops, feet melt into the ground)

Colours come from a palette dict (hex strings) so the style bible can drive every fighter/skin.
Object coordinates are used for all textures: build parts with identity object transforms.
"""
from __future__ import annotations

import colorsys

import bpy

from .scene import hex_rgb

KEEP = ("accent",)          # material names (or prefixes 'gem_', 'glow_') that bake.py leaves alone
KEEP_PREFIXES = ("gem_", "glow_")

DEFAULT_PALETTE = {
    "metal": "#8f98a6",      # painted steel
    "metal_dark": "#3b4452",
    "trim": "#c9a04e",       # brass / gold trims
    "cloth": "#2f5a87",      # primary fabric
    "cloth2": "#d8cfb8",     # secondary fabric / lining
    "under": "#2e3138",      # padded under-suit
    "leather": "#6a442b",
    "leather_dark": "#3b261a",
    "skin": "#c99678",
    "wood": "#7a5534",
    "stone": "#8c877d",
    "gem": "#62e0ff",
    "accent": "#6fe6ff",     # readability accent (team/player tint replaces it at runtime)
}
DEFAULT_GRADIENT = {"z0": 0.0, "z1": 1.85, "low": 0.58, "high": 1.08, "gamma": 0.8}


def palette(**overrides) -> dict:
    p = dict(DEFAULT_PALETTE)
    p.update(overrides)
    return p


def is_kept(mat_or_name) -> bool:
    n = mat_or_name if isinstance(mat_or_name, str) else mat_or_name.name
    return n in KEEP or n.startswith(KEEP_PREFIXES)


def shade_hex(h: str, value: float = 1.0, sat: float = 1.0, hue: float = 0.0) -> tuple:
    """Linear RGBA of `h` with HSV value/saturation multipliers and a hue shift (turns)."""
    r, g, b = (int(h.lstrip("#")[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    hh, s, v = colorsys.rgb_to_hsv(r, g, b)
    r, g, b = colorsys.hsv_to_rgb((hh + hue) % 1.0, min(1.0, s * sat), min(1.0, v * value))
    from .scene import srgb_to_linear
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), 1.0)


# ── tiny node-graph builder ────────────────────────────────────────────────────────────────────
class G:
    def __init__(self, mat: bpy.types.Material):
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0
        self.out = self.n("ShaderNodeOutputMaterial", loc=(900, 0))
        self.bsdf = self.n("ShaderNodeBsdfPrincipled", loc=(600, 0))
        self.bsdf.name = "BSDF"
        self.link(self.bsdf.outputs["BSDF"], self.out.inputs["Surface"])
        self._coord = None
        self._geo = None

    def n(self, kind: str, loc=None, **inputs):
        node = self.nt.nodes.new(kind)
        if loc:
            node.location = loc
        else:
            node.location = (self.x, 0)
            self.x -= 10
        for k, v in inputs.items():
            if hasattr(node, k) and not k[0].isupper():
                setattr(node, k, v)
            else:
                node.inputs[k].default_value = v
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)
        return b

    @property
    def obj(self):
        """Object-space texture coordinate. When a mesh carries the `vale_obj` point attribute
        (bake.py writes it before exploding/joining bake sources) that position is used instead,
        so procedural textures stay put while parts are moved apart for baking."""
        if self._coord is None:
            tc = self.n("ShaderNodeTexCoord")
            at = self.n("ShaderNodeAttribute")
            at.attribute_name = "vale_obj"
            has = self.n("ShaderNodeAttribute")
            has.attribute_name = "vale_has"
            mx = self.n("ShaderNodeMix")
            mx.data_type = "VECTOR"
            self.link(has.outputs["Fac"], mx.inputs[0])
            self.link(tc.outputs["Object"], mx.inputs[4])
            self.link(at.outputs["Vector"], mx.inputs[5])
            self._coord = mx
        return self._coord.outputs[1]

    @property
    def geo(self):
        if self._geo is None:
            self._geo = self.n("ShaderNodeNewGeometry")
        return self._geo

    def mapping(self, vec, scale=(1, 1, 1), loc=(0, 0, 0), rot=(0, 0, 0)):
        m = self.n("ShaderNodeMapping")
        m.inputs["Scale"].default_value = scale
        m.inputs["Location"].default_value = loc
        m.inputs["Rotation"].default_value = rot
        self.link(vec, m.inputs["Vector"])
        return m.outputs["Vector"]

    def noise(self, vec=None, scale=5.0, detail=3.0, rough=0.5, distortion=0.0, dims="3D"):
        t = self.n("ShaderNodeTexNoise")
        t.noise_dimensions = dims
        t.inputs["Scale"].default_value = scale
        t.inputs["Detail"].default_value = detail
        t.inputs["Roughness"].default_value = rough
        t.inputs["Distortion"].default_value = distortion
        self.link(vec if vec is not None else self.obj, t.inputs["Vector"])
        return t

    def voronoi(self, vec=None, scale=5.0, feature="F1", metric="EUCLIDEAN"):
        t = self.n("ShaderNodeTexVoronoi")
        t.feature = feature
        t.distance = metric
        t.inputs["Scale"].default_value = scale
        self.link(vec if vec is not None else self.obj, t.inputs["Vector"])
        return t

    def wave(self, vec=None, scale=5.0, kind="BANDS", direction="X", distortion=0.0, detail=2.0, profile="SIN"):
        t = self.n("ShaderNodeTexWave")
        t.wave_type = kind
        if kind == "BANDS":
            t.bands_direction = direction
        else:
            t.rings_direction = direction
        t.wave_profile = profile
        t.inputs["Scale"].default_value = scale
        t.inputs["Distortion"].default_value = distortion
        t.inputs["Detail"].default_value = detail
        self.link(vec if vec is not None else self.obj, t.inputs["Vector"])
        return t

    def ramp(self, fac, stops):
        """stops: [(pos, (r,g,b,a) or float)]"""
        r = self.n("ShaderNodeValToRGB")
        cr = r.color_ramp
        cr.interpolation = "EASE"
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        for i, (pos, col) in enumerate(stops):
            e = cr.elements[0] if i == 0 else cr.elements.new(pos)
            e.position = pos
            if isinstance(col, (int, float)):
                col = (col, col, col, 1.0)
            e.color = col
        self.link(fac, r.inputs["Fac"])
        return r.outputs["Color"]

    def mix(self, a, b, fac, blend="MIX"):
        m = self.n("ShaderNodeMix")
        m.data_type = "RGBA"
        m.blend_type = blend
        m.clamp_result = True
        self._in(m.inputs[0], fac)
        self._in(m.inputs[6], a)
        self._in(m.inputs[7], b)
        return m.outputs[2]

    def mixf(self, a, b, fac):
        m = self.n("ShaderNodeMix")
        m.data_type = "FLOAT"
        m.clamp_result = True
        self._in(m.inputs[0], fac)
        self._in(m.inputs[2], a)
        self._in(m.inputs[3], b)
        return m.outputs[0]

    def math(self, op, a, b=None, clamp=False):
        m = self.n("ShaderNodeMath")
        m.operation = op
        m.use_clamp = clamp
        self._in(m.inputs[0], a)
        if b is not None:
            self._in(m.inputs[1], b)
        return m.outputs[0]

    def sep_z(self, vec=None):
        s = self.n("ShaderNodeSeparateXYZ")
        self.link(vec if vec is not None else self.obj, s.inputs[0])
        return s.outputs["Z"]

    def ao(self, distance=0.05, samples=8, local=True):
        a = self.n("ShaderNodeAmbientOcclusion")
        a.samples = samples
        a.only_local = local
        a.inputs["Distance"].default_value = distance
        return a.outputs["AO"]

    def bump(self, height, strength=0.2, distance=0.01, normal=None):
        b = self.n("ShaderNodeBump")
        b.inputs["Strength"].default_value = strength
        b.inputs["Distance"].default_value = distance
        self.link(height, b.inputs["Height"])
        if normal is not None:
            self.link(normal, b.inputs["Normal"])
        return b.outputs["Normal"]

    def _in(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.link(val, sock)
        else:
            if isinstance(val, (tuple, list)) and len(val) == 3 and sock.type == "RGBA":
                val = (*val, 1.0)
            sock.default_value = val

    def set_bsdf(self, color=None, rough=None, metal=None, normal=None, emission=None, emission_strength=None,
                 alpha=None, specular=None, coat=None):
        b = self.bsdf
        for name, v in (("Base Color", color), ("Roughness", rough), ("Metallic", metal), ("Normal", normal),
                        ("Emission Color", emission), ("Emission Strength", emission_strength),
                        ("Alpha", alpha), ("Specular IOR Level", specular), ("Coat Weight", coat)):
            if v is not None:
                self._in(b.inputs[name], v)


def _new(name: str) -> tuple[bpy.types.Material, G]:
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, G(m)


# ── shared painted cues ─────────────────────────────────────────────────────────────────────────
def value_gradient(g: G, color, grad: dict | None):
    """Multiply `color` by a Z ramp: `low` at z0 (feet) -> `high` at z1 (head); or, when the
    gradient has `stops` [(z_frac, mult), ...] (bible_gradient), a piecewise ramp over the height."""
    if not grad:
        return color
    z = g.sep_z()
    span = max(1e-3, grad["z1"] - grad["z0"])
    t = g.math("MULTIPLY", g.math("SUBTRACT", z, grad["z0"]), 1.0 / span, clamp=True)
    if grad.get("stops"):
        r = g.n("ShaderNodeValToRGB")
        cr = r.color_ramp
        cr.interpolation = "B_SPLINE"
        while len(cr.elements) > 1:
            cr.elements.remove(cr.elements[-1])
        for i, (pos, mult) in enumerate(grad["stops"]):
            e = cr.elements[0] if i == 0 else cr.elements.new(pos)
            e.position = pos
            e.color = (mult / 2.0, mult / 2.0, mult / 2.0, 1.0)       # ramp colours clamp at 1: store x/2
        g.link(t, r.inputs["Fac"])
        v = g.math("MULTIPLY", _bw(g, r.outputs["Color"]), 2.0)
        return _mul_scalar(g, color, v)
    t = g.math("POWER", t, grad.get("gamma", 1.0))
    v = g.math("ADD", g.math("MULTIPLY", t, grad["high"] - grad["low"]), grad["low"])
    return _mul_scalar(g, color, v)


def _bw(g: G, col):
    sep = g.n("ShaderNodeSeparateColor")
    g.link(col, sep.inputs["Color"])
    return sep.outputs["Red"]


def _mul_scalar(g: G, color, s):
    c = g.n("ShaderNodeCombineColor")
    g.link(s, c.inputs[0])
    g.link(s, c.inputs[1])
    g.link(s, c.inputs[2])
    return g.mix(color, c.outputs[0], 1.0, "MULTIPLY")


def painted_breakup(g: G, color, amount=0.12, scale=2.5, hue=0.02):
    """Low-frequency value/hue blotches + stretched brush strokes."""
    n1 = g.noise(scale=scale, detail=2.0, rough=0.55)
    blot = g.ramp(n1.outputs["Fac"], [(0.3, 1.0 - amount), (0.7, 1.0 + amount * 0.6)])
    c = g.mix(color, blot, 1.0, "MULTIPLY")
    strokes = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 7.0)), scale=9.0, detail=1.0, rough=0.4)
    s = g.ramp(strokes.outputs["Fac"], [(0.35, 1.0 - amount * 0.5), (0.65, 1.0 + amount * 0.4)])
    return g.mix(c, s, 1.0, "MULTIPLY")


def edge_cavity(g: G, color, edge_col, cavity_col, edge=0.6, cavity=0.75, ao_dist=0.04,
                edge_lo=0.505, edge_hi=0.56):
    """Edge highlight (pointiness) + cavity dirt (local AO)."""
    p = g.geo.outputs["Pointiness"]
    e = g.ramp(p, [(edge_lo, 0.0), (edge_hi, 1.0)])
    e = g.math("MULTIPLY", e, edge)
    c = g.mix(color, edge_col, e)
    ao = g.ao(distance=ao_dist)
    cav = g.ramp(ao, [(0.25, 1.0), (0.85, 0.0)])
    cav = g.math("MULTIPLY", cav, cavity)
    return g.mix(c, cavity_col, cav), e


# ── material library ────────────────────────────────────────────────────────────────────────────
def painted_metal(name: str, pal: dict, key: str = "metal", grad=None, metallic: float = 0.8,
                  rough: float = 0.46, brushed: float = 1.0, edge: float = 0.85, cavity: float = 0.8,
                  hammered: float = 0.0) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.10, scale=3.0)
    # brushed streaks (anisotropic look baked into albedo/roughness)
    br = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 40.0)), scale=14.0, detail=4.0, rough=0.6)
    brf = g.ramp(br.outputs["Fac"], [(0.35, 1.0 - 0.08 * brushed), (0.65, 1.0 + 0.06 * brushed)])
    c = g.mix(c, brf, 1.0, "MULTIPLY")
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.75, 0.6), shade_hex(pal.get(key + "_dark", pal[key]), 0.45, 1.1),
                       edge=edge, cavity=cavity)
    c = value_gradient(g, c, grad)
    r = g.ramp(br.outputs["Fac"], [(0.3, rough - 0.08), (0.7, rough + 0.10)])
    r = g.mixf(g.math("ADD", r, 0.0), rough - 0.15, e)
    nrm = None
    if hammered > 0:
        vo = g.voronoi(scale=60.0, feature="SMOOTH_F1")
        nrm = g.bump(vo.outputs["Distance"], strength=0.12 * hammered, distance=0.004)
    g.set_bsdf(color=c, rough=r, metal=metallic, normal=nrm)
    return m


def leather(name: str, pal: dict, key: str = "leather", grad=None, rough: float = 0.62) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.14, scale=4.0, hue=0.01)
    grain = g.noise(scale=180.0, detail=6.0, rough=0.7)
    cells = g.voronoi(scale=90.0, feature="F1")
    h = g.math("ADD", g.math("MULTIPLY", grain.outputs["Fac"], 0.6), g.math("MULTIPLY", cells.outputs["Distance"], 0.4))
    c = g.mix(c, shade_hex(pal[key], 0.75), g.ramp(h, [(0.35, 0.0), (0.6, 0.5)]))
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.45, 0.75), shade_hex(pal.get(key + "_dark", pal[key]), 0.5),
                       edge=0.6, cavity=0.7)
    c = value_gradient(g, c, grad)
    r = g.mixf(rough + 0.1, rough - 0.18, e)
    g.set_bsdf(color=c, rough=r, metal=0.0, normal=g.bump(h, strength=0.18, distance=0.002))
    return m


def cloth(name: str, pal: dict, key: str = "cloth", grad=None, rough: float = 0.86, weave_scale: float = 260.0,
          trim_key: str | None = None) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.12, scale=3.0, hue=0.015)
    wx = g.wave(scale=weave_scale, direction="X", profile="SIN")
    wz = g.wave(scale=weave_scale, direction="Z", profile="SIN")
    weave = g.math("MULTIPLY", wx.outputs["Fac"], wz.outputs["Fac"])
    c = g.mix(c, shade_hex(pal[key], 0.82), g.math("MULTIPLY", weave, 0.5))
    # folds: local AO deepens fold valleys, pointiness lifts crests (painted light on folds)
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.35, 0.85), shade_hex(pal[key], 0.42, 1.15),
                       edge=0.45, cavity=0.85, ao_dist=0.06, edge_lo=0.5, edge_hi=0.54)
    c = value_gradient(g, c, grad)
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(weave, strength=0.08, distance=0.001))
    return m


def skin(name: str, pal: dict, key: str = "skin", grad=None, rough: float = 0.55) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.06, scale=5.0)
    warm = g.noise(scale=3.0, detail=2.0)
    c = g.mix(c, shade_hex(pal[key], 0.92, 1.25, -0.015), g.ramp(warm.outputs["Fac"], [(0.4, 0.0), (0.7, 0.45)]))
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.18, 0.85), shade_hex(pal[key], 0.55, 1.3, -0.02),
                       edge=0.35, cavity=0.55, ao_dist=0.03)
    c = value_gradient(g, c, grad)
    pores = g.noise(scale=400.0, detail=2.0)
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(pores.outputs["Fac"], strength=0.03, distance=0.001))
    return m


def stone(name: str, pal: dict, key: str = "stone", grad=None, rough: float = 0.82) -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    c = painted_breakup(g, base, amount=0.16, scale=2.0)
    v = g.voronoi(scale=6.0, feature="DISTANCE_TO_EDGE")
    crack = g.ramp(v.outputs["Distance"], [(0.0, 1.0), (0.05, 0.0)])
    c = g.mix(c, shade_hex(pal[key], 0.45), g.math("MULTIPLY", crack, 0.8))
    n = g.noise(scale=25.0, detail=8.0, rough=0.65)
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.35, 0.7), shade_hex(pal[key], 0.4), edge=0.7, cavity=0.8,
                       ao_dist=0.08)
    c = value_gradient(g, c, grad)
    h = g.math("SUBTRACT", n.outputs["Fac"], g.math("MULTIPLY", crack, 0.6))
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(h, strength=0.35, distance=0.01))
    return m


def wood(name: str, pal: dict, key: str = "wood", grad=None, rough: float = 0.6, axis: str = "Z") -> bpy.types.Material:
    m, g = _new(name)
    base = shade_hex(pal[key])
    vec = g.mapping(g.obj, scale=(1.0, 1.0, 0.08) if axis == "Z" else (0.08, 1.0, 1.0))
    rings = g.wave(vec, scale=22.0, kind="RINGS", direction="Z" if axis == "Z" else "X", distortion=6.0, detail=3.0)
    c = g.mix(shade_hex(pal[key], 0.72), shade_hex(pal[key], 1.15), g.ramp(rings.outputs["Fac"], [(0.2, 0.0), (0.8, 1.0)]))
    c = painted_breakup(g, c, amount=0.1, scale=3.0)
    c, e = edge_cavity(g, c, shade_hex(pal[key], 1.5, 0.7), shade_hex(pal[key], 0.4), edge=0.6, cavity=0.7)
    c = value_gradient(g, c, grad)
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(rings.outputs["Fac"], strength=0.1, distance=0.002))
    return m


def gem(name: str, pal: dict, key: str = "gem", strength: float = 3.0) -> bpy.types.Material:
    """Emissive crystal; name it `gem_*` to keep it un-baked (glTF emissive factor)."""
    m, g = _new(name if name.startswith(KEEP_PREFIXES) else "gem_" + name)
    col = shade_hex(pal[key])
    g.set_bsdf(color=shade_hex(pal[key], 0.7), rough=0.15, metal=0.0, emission=col, emission_strength=strength)
    return m


ACCENT_REST_EMISSIVE = 0.8      # bible: the accent holds readability colour BELOW bloom (<= 0.8) at rest;
                                 # the renderer raises it to >= 1.5 only in wind-ups ("a glow is a warning")


def accent(pal: dict, key: str = "accent", strength: float = ACCENT_REST_EMISSIVE,
           base_value: float = 0.22) -> bpy.types.Material:
    """The REQUIRED emissive readability material (CONTRACT §12). The renderer tints its emissive
    with the team/player colour; the authored colour is what portraits show. The base colour is a
    dark, desaturated glass so the EMISSION carries the colour (a bright base would push the lit
    accent over the bloom threshold and wash the tint toward white)."""
    m, g = _new("accent")
    col = shade_hex(pal[key])
    g.set_bsdf(color=shade_hex(pal[key], base_value, 0.35), rough=0.25, metal=0.0, emission=col,
               emission_strength=min(strength, ACCENT_REST_EMISSIVE))
    return m


def flat(name: str, rgba, rough=0.5, metal=0.0) -> bpy.types.Material:
    m, g = _new(name)
    g.set_bsdf(color=rgba, rough=rough, metal=metal)
    return m


def standard_set(pal: dict, grad: dict | None = None, prefix: str = "") -> dict:
    """The usual fighter material set keyed by role."""
    grad = grad if grad is not None else dict(DEFAULT_GRADIENT)
    return {
        "metal": painted_metal(prefix + "metal", pal, "metal", grad),
        "trim": painted_metal(prefix + "trim", pal, "trim", grad, metallic=0.9, rough=0.38, brushed=0.6, edge=1.0),
        "dark_metal": painted_metal(prefix + "dark_metal", pal, "metal_dark", grad, metallic=0.75, rough=0.5),
        "cloth": cloth(prefix + "cloth", pal, "cloth", grad),
        "cloth2": cloth(prefix + "cloth2", pal, "cloth2", grad),
        "under": cloth(prefix + "under", pal, "under", grad, weave_scale=180.0),
        "leather": leather(prefix + "leather", pal, "leather", grad),
        "leather_dark": leather(prefix + "leather_dark", pal, "leather_dark", grad),
        "skin": skin(prefix + "skin", pal, "skin", grad),
        "wood": wood(prefix + "wood", pal, "wood", grad),
        "accent": accent(pal),
    }


# ════════════════════════════════════════════════════════════════════════════════════════════════
# BIBLE MATERIAL VOCABULARY (STYLE_BIBLE "World"/"Look rules", WORLD.md §2, tokens.json `fighter`)
#
# Fighters are made of the Vale's own materials, never metal: honed stone (dialstone, chalk
# limestone, ochre sandstone, ironstone), dawnglass (cool glass) and lampresin (warm amber resin),
# carved wood (pale ash, walnut), heavy cloth (linen, felt) and waxed leather. BANNED on fighters:
# metallic bevels, gold filigree, gems, gears, clock hands, glowing runes (the only emissive is the
# `accent`, a carved glass inlay holding the readability colour below bloom).
#
# Shading is baked into the base colour so the hand-painted read survives any PBR light
# (tokens.json fighter.bakeIntoBaseColor = {aoStrength 0.6, curvature 0.4, topDownGradient 0.15}):
#   * cavity darkening   local AO (creases, carved recesses, fold valleys)        x curvature
#   * edge chalking      Bevel-node edge mask on CONVEX edges (2-4 cm bevels catch a chalky
#                        highlight: the bevel is the brushstroke)                   x curvature
#   * top-light gradient each form is lighter where it faces up (world normal Z)    +-15 %
#   * value gradient     whole-figure Z ramp: light crown, dark feet (bible_gradient)
#   * whole-body AO      baked on the assembled low and multiplied into the base colour by
#                        bake.bake_asset(ao_into_base=0.6)
# Metallic is 0 everywhere; roughness stays in the 0.35-0.95 band (glass 0.12-0.2 is the only
# glossy surface). Colours come from the fighter's palette dict (keys below), so skins are swaps.
# ════════════════════════════════════════════════════════════════════════════════════════════════
BIBLE_BAKE = {"ao": 0.6, "curvature": 0.4, "top": 0.15}

BIBLE_PALETTE = {
    # honed stone family
    "chalk": "#e4ddcd",        # chalk limestone (Aubade spires) - the light top band
    "stone": "#aaa498",        # dialstone (neutral honed stone)
    "sandstone": "#c3a47a",    # ochre sandstone (Serenade)
    "ironstone": "#4b4039",    # dark warm ironstone - boots, greaves, the dark feet band
    # glass / resin (non-emissive; the accent is the only glow)
    "dawnglass": "#a9c4dc",    # cool translucent glass (Aubade)
    "lampresin": "#c98a3c",    # warm amber resin (Serenade)
    # carved wood
    "wood": "#a08262",         # pale ash
    "wood_dark": "#5c4231",    # walnut
    # cloth + leather
    "cloth": "#8d8a80",        # heavy linen / felt (main drapery)
    "cloth2": "#d6cfbf",       # light linen (hood, lining)
    "under": "#3a3735",        # dark under-suit (legs)
    "leather": "#5e4636",      # waxed leather
    "ink": "#17181b",          # carved recesses (mask eyes): ink-dark, never pure black
    # readability accent (renderer tints it with self / ally / enemy / seat colour)
    "accent": "#3f9cff",
}
# Piecewise Z ramp (fraction of the fighter height -> multiplier) used with bible palettes: the
# feet sink to ~0.62 and the crown lifts to 1.06 (bible: top quarter L* 70-85, feet 20-35).
BIBLE_GRADIENT_STOPS = [(0.0, 0.62), (0.12, 0.70), (0.30, 0.84), (0.55, 0.95), (0.80, 1.02), (1.0, 1.06)]


def bible_palette(**overrides) -> dict:
    """The bible vocabulary palette with fighter overrides (unknown keys are allowed: extra roles)."""
    p = dict(BIBLE_PALETTE)
    p.update(overrides)
    return p


def bible_gradient(height: float, stops=None) -> dict:
    return {"z0": 0.0, "z1": float(height), "stops": list(stops or BIBLE_GRADIENT_STOPS)}


def edge_mask(g: G, radius: float = 0.02, gain: float = 6.0, samples: int = 8):
    """0..1 mask on rounded edges: 1 - dot(bevel-rounded normal, true normal) (Cycles Bevel node,
    works in bakes on any mesh density, unlike Pointiness)."""
    bv = g.n("ShaderNodeBevel")
    bv.samples = samples
    bv.inputs["Radius"].default_value = radius
    dp = g.n("ShaderNodeVectorMath")
    dp.operation = "DOT_PRODUCT"
    g.link(bv.outputs["Normal"], dp.inputs[0])
    g.link(g.geo.outputs["Normal"], dp.inputs[1])
    e = g.math("SUBTRACT", 1.0, dp.outputs["Value"])
    return g.math("MULTIPLY", e, gain, clamp=True)


def top_light(g: G, color, amount: float = BIBLE_BAKE["top"]):
    """Multiply by 1 + amount * world normal Z: every form is lit from the top (painted key)."""
    if amount <= 0:
        return color
    sep = g.n("ShaderNodeSeparateXYZ")
    g.link(g.geo.outputs["Normal"], sep.inputs[0])
    v = g.math("ADD", 1.0, g.math("MULTIPLY", sep.outputs["Z"], amount))
    return _mul_scalar(g, color, v)


def paint(g: G, color, hexcol: str, grad, curvature: float = BIBLE_BAKE["curvature"], edge_radius: float = 0.02,
          edge_gain: float = 6.0, cavity_dist: float = 0.05, chalk=(1.45, 0.55), cavity=(0.42, 1.1),
          top: float = BIBLE_BAKE["top"], edge_boost: float = 1.0):
    """The bible's baked-in shading over `color`: cavity darkening, convex edge chalking, top light,
    value gradient. Returns (colour socket, edge mask socket)."""
    ao = g.ao(distance=cavity_dist, samples=8)
    cav = g.ramp(ao, [(0.30, 1.0), (0.88, 0.0)])
    c = g.mix(color, shade_hex(hexcol, cavity[0], cavity[1]), g.math("MULTIPLY", cav, min(1.0, curvature * 1.6)))
    e = edge_mask(g, edge_radius, edge_gain)
    convex = g.ramp(ao, [(0.72, 0.0), (0.95, 1.0)])           # concave edges are occluded: no chalk there
    e = g.math("MULTIPLY", e, convex)
    c = g.mix(c, shade_hex(hexcol, chalk[0], chalk[1]), g.math("MULTIPLY", e, min(1.0, curvature * 1.5 * edge_boost)))
    c = top_light(g, c, top)
    c = value_gradient(g, c, grad)
    return c, e


def honed_stone(name: str, pal: dict, key: str = "stone", grad=None, rough: float = 0.62, chisel: float = 1.0,
                speckle: float = 0.0, veins: float = 0.0, scale: float = 1.0) -> bpy.types.Material:
    """Honed stone (dialstone / chalk / sandstone / ironstone): soft painted blotches, faint chisel
    facets, pores, optional oxidised speckle (ironstone) and veins; chalky worn edges."""
    m, g = _new(name)
    hexcol = pal[key]
    c = painted_breakup(g, shade_hex(hexcol), amount=0.09, scale=2.2 * scale)
    if chisel > 0:      # broad flat chisel facets: each Voronoi cell a slightly different value
        vc = g.voronoi(scale=7.0 * scale, feature="F1")
        c = g.mix(c, g.ramp(vc.outputs["Color"], [(0.0, 0.94), (1.0, 1.05)]), 0.6 * chisel, "MULTIPLY")
    if veins > 0:
        w = g.wave(g.mapping(g.obj, scale=(1.0, 0.6, 1.4)), scale=3.0 * scale, kind="BANDS", direction="Z",
                   distortion=9.0, detail=4.0)
        c = g.mix(c, shade_hex(hexcol, 0.78, 1.1), g.math("MULTIPLY", g.ramp(w.outputs["Fac"], [(0.0, 1.0), (0.06, 0.0)]), veins))
    if speckle > 0:
        sp = g.voronoi(scale=60.0 * scale, feature="F1")
        dots = g.ramp(sp.outputs["Distance"], [(0.0, 1.0), (0.12, 0.0)])
        c = g.mix(c, shade_hex(hexcol, 1.25, 1.6, -0.02), g.math("MULTIPLY", dots, 0.55 * speckle))
    c, e = paint(g, c, hexcol, grad)
    pores = g.noise(scale=140.0 * scale, detail=3.0, rough=0.6)
    vb = g.voronoi(scale=7.0 * scale, feature="DISTANCE_TO_EDGE")
    h = g.math("ADD", g.math("MULTIPLY", pores.outputs["Fac"], 0.5),
               g.math("MULTIPLY", g.ramp(vb.outputs["Distance"], [(0.0, 0.0), (0.08, 1.0)]), 0.5 * chisel))
    r = g.mixf(rough, min(0.95, rough + 0.12), e)              # chalked edges are matte
    g.set_bsdf(color=c, rough=r, metal=0.0, normal=g.bump(h, strength=0.10, distance=0.004))
    return m


def glass(name: str, pal: dict, key: str = "dawnglass", grad=None, rough: float = 0.16, depth: float = 0.5,
          inclusions: float = 0.4) -> bpy.types.Material:
    """Dawnglass / lampresin as an OPAQUE glossy dielectric with painted depth: a deeper core tone,
    bright catch-light edges (the bevel mask), soft internal streaks and suspended inclusions.
    Not emissive (a glow is a warning: only `accent` emits)."""
    m, g = _new(name)
    hexcol = pal[key]
    st = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 3.0)), scale=6.0, detail=2.0, rough=0.5, distortion=1.5)
    core = g.mix(shade_hex(hexcol, 0.62, 1.15), shade_hex(hexcol, 1.05, 0.9), g.ramp(st.outputs["Fac"], [(0.3, 0.0), (0.7, 1.0)]))
    if inclusions > 0:
        sp = g.voronoi(scale=45.0, feature="F1")
        dots = g.ramp(sp.outputs["Distance"], [(0.0, 1.0), (0.08, 0.0)])
        core = g.mix(core, shade_hex(hexcol, 1.35, 0.6), g.math("MULTIPLY", dots, inclusions))
    ao = g.ao(distance=0.04, samples=8)
    c = g.mix(core, shade_hex(hexcol, 0.35, 1.2), g.math("MULTIPLY", g.ramp(ao, [(0.3, 1.0), (0.9, 0.0)]), depth))
    e = edge_mask(g, 0.012, 8.0)
    c = g.mix(c, shade_hex(hexcol, 1.6, 0.45), g.math("MULTIPLY", e, 0.7))
    c = top_light(g, c, 0.2)
    c = value_gradient(g, c, grad)
    g.set_bsdf(color=c, rough=g.mixf(rough, rough + 0.1, e), metal=0.0, specular=0.6,
               normal=g.bump(st.outputs["Fac"], strength=0.04, distance=0.002))
    return m


def carved_wood(name: str, pal: dict, key: str = "wood", grad=None, rough: float = 0.58, axis: str = "Z",
                grain_scale: float = 1.0) -> bpy.types.Material:
    """Carved wood: long grain along `axis`, gouge marks, worn pale edges, dark cavities."""
    m, g = _new(name)
    hexcol = pal[key]
    sc = (1.0, 1.0, 0.07) if axis == "Z" else ((0.07, 1.0, 1.0) if axis == "X" else (1.0, 0.07, 1.0))
    vec = g.mapping(g.obj, scale=sc)
    rings = g.wave(vec, scale=26.0 * grain_scale, kind="RINGS", direction=axis, distortion=7.0, detail=3.0)
    c = g.mix(shade_hex(hexcol, 0.80, 1.08), shade_hex(hexcol, 1.10, 0.95), g.ramp(rings.outputs["Fac"], [(0.15, 0.0), (0.85, 1.0)]))
    gouge = g.noise(g.mapping(g.obj, scale=(1.0, 1.0, 4.0)), scale=24.0, detail=1.0, rough=0.3)
    c = g.mix(c, shade_hex(hexcol, 0.88), g.math("MULTIPLY", g.ramp(gouge.outputs["Fac"], [(0.45, 0.0), (0.7, 1.0)]), 0.5))
    c = painted_breakup(g, c, amount=0.08, scale=3.0)
    c, e = paint(g, c, hexcol, grad, chalk=(1.35, 0.7))
    h = g.math("ADD", g.math("MULTIPLY", rings.outputs["Fac"], 0.6), g.math("MULTIPLY", gouge.outputs["Fac"], 0.4))
    g.set_bsdf(color=c, rough=g.mixf(rough, rough + 0.12, e), metal=0.0, normal=g.bump(h, strength=0.12, distance=0.003))
    return m


def heavy_cloth(name: str, pal: dict, key: str = "cloth", grad=None, rough: float = 0.9, weave: float = 1.0,
                felt: float = 0.0) -> bpy.types.Material:
    """Heavy linen / felt: a faint coarse weave, fold valleys darkened (wide local AO), fold crests
    and rolled hems chalked by the edge mask; very matte."""
    m, g = _new(name)
    hexcol = pal[key]
    c = painted_breakup(g, shade_hex(hexcol), amount=0.10, scale=2.6, hue=0.01)
    if weave > 0:
        wx = g.wave(scale=150.0, direction="X", profile="SIN")
        wz = g.wave(scale=150.0, direction="Z", profile="SIN")
        wv = g.math("MULTIPLY", wx.outputs["Fac"], wz.outputs["Fac"])
        c = g.mix(c, shade_hex(hexcol, 0.88), g.math("MULTIPLY", wv, 0.35 * weave))
    else:
        wv = g.noise(scale=200.0).outputs["Fac"]
    if felt > 0:
        fz = g.noise(scale=60.0, detail=6.0, rough=0.7)
        c = g.mix(c, shade_hex(hexcol, 1.1, 0.9), g.math("MULTIPLY", fz.outputs["Fac"], 0.3 * felt))
    c, e = paint(g, c, hexcol, grad, cavity_dist=0.08, edge_radius=0.015, chalk=(1.3, 0.75), cavity=(0.45, 1.15))
    g.set_bsdf(color=c, rough=rough, metal=0.0, normal=g.bump(wv, strength=0.05, distance=0.001))
    return m


def waxed_leather(name: str, pal: dict, key: str = "leather", grad=None, rough: float = 0.5) -> bpy.types.Material:
    m, g = _new(name)
    hexcol = pal[key]
    c = painted_breakup(g, shade_hex(hexcol), amount=0.12, scale=4.0, hue=0.01)
    grain = g.noise(scale=150.0, detail=6.0, rough=0.7)
    c = g.mix(c, shade_hex(hexcol, 0.8), g.math("MULTIPLY", g.ramp(grain.outputs["Fac"], [(0.4, 0.0), (0.65, 1.0)]), 0.4))
    c, e = paint(g, c, hexcol, grad, edge_radius=0.008, chalk=(1.4, 0.7))
    g.set_bsdf(color=c, rough=g.mixf(rough, rough + 0.2, e), metal=0.0,
               normal=g.bump(grain.outputs["Fac"], strength=0.1, distance=0.002))
    return m


def ink(name: str, pal: dict, key: str = "ink") -> bpy.types.Material:
    """Carved recess paint (mask eyes, deep grooves): near-black, matte, no gradient."""
    m, g = _new(name)
    n = g.noise(scale=30.0)
    c = g.mix(shade_hex(pal[key]), shade_hex(pal[key], 1.4), g.math("MULTIPLY", n.outputs["Fac"], 0.3))
    g.set_bsdf(color=c, rough=0.8, metal=0.0)
    return m


def bible_set(pal: dict, grad: dict | None = None, prefix: str = "") -> dict:
    """Fighter material roles in the bible's vocabulary (all non-metallic):
      chalk, stone, sandstone, ironstone   honed stone family
      dawnglass, lampresin                  glass / resin (glossy, NOT emissive)
      wood, wood_dark                       carved wood (grain along Z by default)
      cloth, cloth2, under                  heavy cloth (main drapery, light linen, dark under-suit)
      leather, ink                          waxed leather; carved-recess paint
      accent                                REQUIRED emissive readability inlay (<= 0.8 at rest)
    Keys missing from `pal` fall back to BIBLE_PALETTE."""
    p = dict(BIBLE_PALETTE)
    p.update(pal)
    gr = grad
    return {
        "chalk": honed_stone(prefix + "chalk", p, "chalk", gr, rough=0.66, chisel=0.7),
        "stone": honed_stone(prefix + "stone", p, "stone", gr, rough=0.6, chisel=1.0),
        "sandstone": honed_stone(prefix + "sandstone", p, "sandstone", gr, rough=0.7, chisel=0.8, veins=0.25),
        "ironstone": honed_stone(prefix + "ironstone", p, "ironstone", gr, rough=0.72, chisel=0.8, speckle=0.6),
        "dawnglass": glass(prefix + "dawnglass", p, "dawnglass", gr, rough=0.14),
        "lampresin": glass(prefix + "lampresin", p, "lampresin", gr, rough=0.2, inclusions=0.6),
        "wood": carved_wood(prefix + "wood", p, "wood", gr),
        "wood_dark": carved_wood(prefix + "wood_dark", p, "wood_dark", gr, rough=0.5),
        "cloth": heavy_cloth(prefix + "cloth", p, "cloth", gr),
        "cloth2": heavy_cloth(prefix + "cloth2", p, "cloth2", gr, weave=0.7),
        "under": heavy_cloth(prefix + "under", p, "under", gr, weave=0.5, felt=1.0),
        "leather": waxed_leather(prefix + "leather", p, "leather", gr),
        "ink": ink(prefix + "ink", p),
        "accent": accent(p),
    }
