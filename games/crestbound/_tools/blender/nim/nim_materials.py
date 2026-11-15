"""
NIM — procedural PBR looks (Blender node trees) for every part, built so they
can be BAKED into one atlas: each material carries a shared Image Texture
target node, named channel outputs (ALB / RGH / MET) and a Bump-fed Principled
BSDF for the normal pass. After baking, `make_atlas_material` builds the ONE
material the game gets (albedo + normal + ORM with occlusion in R).
"""
import bpy
import math
from nim_lib import COL, hex_lin


def _new_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.name = "OUT"; out.location = (900, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.name = "BSDF"; bsdf.location = (600, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m, nt, bsdf


def _coords(nt, x=-1400):
    tc = nt.nodes.new("ShaderNodeTexCoord"); tc.location = (x, 0)
    return tc


def _noise(nt, coords, scale, detail=2.0, rough=0.5, distortion=0.0, x=-1000, y=0):
    n = nt.nodes.new("ShaderNodeTexNoise"); n.location = (x, y)
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    n.inputs["Distortion"].default_value = distortion
    nt.links.new(coords, n.inputs["Vector"])
    return n


def _wave(nt, coords, scale, direction='X', distortion=0.0, detail=1.0, profile='SIN', x=-1000, y=0, wtype='BANDS'):
    w = nt.nodes.new("ShaderNodeTexWave"); w.location = (x, y)
    w.wave_type = wtype
    if wtype == 'BANDS':
        w.bands_direction = direction
    w.wave_profile = profile
    w.inputs["Scale"].default_value = scale
    w.inputs["Distortion"].default_value = distortion
    w.inputs["Detail"].default_value = detail
    nt.links.new(coords, w.inputs["Vector"])
    return w


def _math(nt, op, a, b=None, x=-600, y=0, clamp=False, val_b=None):
    m = nt.nodes.new("ShaderNodeMath"); m.operation = op; m.location = (x, y); m.use_clamp = clamp
    if isinstance(a, (int, float)):
        m.inputs[0].default_value = a
    else:
        nt.links.new(a, m.inputs[0])
    if b is not None:
        if isinstance(b, (int, float)):
            m.inputs[1].default_value = b
        else:
            nt.links.new(b, m.inputs[1])
    return m


def _maprange(nt, v, a0, a1, b0, b1, x=-500, y=0):
    m = nt.nodes.new("ShaderNodeMapRange"); m.location = (x, y); m.clamp = True
    nt.links.new(v, m.inputs["Value"])
    m.inputs["From Min"].default_value = a0; m.inputs["From Max"].default_value = a1
    m.inputs["To Min"].default_value = b0; m.inputs["To Max"].default_value = b1
    return m


def _mix_color(nt, fac, col_a, col_b, x=-300, y=0, blend='MIX'):
    mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = 'RGBA'; mx.blend_type = blend; mx.location = (x, y)
    mx.clamp_result = True
    if isinstance(fac, (int, float)):
        mx.inputs["Factor"].default_value = fac
    else:
        nt.links.new(fac, mx.inputs["Factor"])
    for sock, c in (("A", col_a), ("B", col_b)):
        if isinstance(c, tuple):
            mx.inputs[sock].default_value = (c[0], c[1], c[2], 1.0)
        else:
            nt.links.new(c, mx.inputs[sock])
    return mx


def _rgb(nt, c, x=-700, y=0):
    n = nt.nodes.new("ShaderNodeRGB"); n.location = (x, y)
    n.outputs[0].default_value = (c[0], c[1], c[2], 1.0)
    return n


def _value(nt, v, x=-700, y=0):
    n = nt.nodes.new("ShaderNodeValue"); n.location = (x, y); n.outputs[0].default_value = v
    return n


def _bump(nt, height, strength, distance, x=300, y=-300):
    b = nt.nodes.new("ShaderNodeBump"); b.location = (x, y)
    b.inputs["Strength"].default_value = strength
    b.inputs["Distance"].default_value = distance
    nt.links.new(height, b.inputs["Height"])
    return b


def _finish(nt, bsdf, alb, rgh, met, nrm=None):
    """Wire the named channel outputs to the BSDF and tag them for the baker."""
    # ALB / RGH / MET are Reroute nodes so the baker can find the sockets by name
    for name, sock, y in (("ALB", alb, 200), ("RGH", rgh, 0), ("MET", met, -100)):
        rr = nt.nodes.new("NodeReroute"); rr.name = name; rr.location = (450, y)
        if isinstance(sock, (int, float)):
            v = _value(nt, float(sock), x=300, y=y); sock = v.outputs[0]
        elif isinstance(sock, tuple):
            v = _rgb(nt, sock, x=300, y=y); sock = v.outputs[0]
        nt.links.new(sock, rr.inputs[0])
    nt.links.new(nt.nodes["ALB"].outputs[0], bsdf.inputs["Base Color"])
    nt.links.new(nt.nodes["RGH"].outputs[0], bsdf.inputs["Roughness"])
    nt.links.new(nt.nodes["MET"].outputs[0], bsdf.inputs["Metallic"])
    if nrm is not None:
        nt.links.new(nrm, bsdf.inputs["Normal"])


def _pointiness(nt, x=-1200, y=-500):
    g = nt.nodes.new("ShaderNodeNewGeometry"); g.location = (x, y)
    return g.outputs["Pointiness"]


# ------------------------------------------------------------------ looks
def cloth(name, base_hex, rough=0.88, weave_scale=420.0, weave_amt=0.16, sheen_tint=None, knit=False, stripes=()):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(base_hex)
    w1 = _wave(nt, tc.outputs["Object"], weave_scale, 'X', distortion=0.6 if knit else 0.0, y=300)
    w2 = _wave(nt, tc.outputs["Object"], weave_scale, 'Z' if not knit else 'Y', distortion=0.6 if knit else 0.0, y=100)
    weave = _math(nt, 'MULTIPLY', w1.outputs["Fac"], w2.outputs["Fac"], y=200)
    if knit:
        weave = _math(nt, 'MULTIPLY', w1.outputs["Fac"], 1.0, y=200)
    grime = _noise(nt, tc.outputs["Object"], 9.0, detail=3.0, rough=0.6, y=-200)
    grime_v = _maprange(nt, grime.outputs["Fac"], 0.35, 0.75, 0.86, 1.06, y=-200)
    weave_v = _maprange(nt, weave.outputs["Value"], 0.0, 1.0, 1.0 - weave_amt, 1.0 + weave_amt * 0.5, y=100)
    shade = _math(nt, 'MULTIPLY', weave_v.outputs["Result"], grime_v.outputs["Result"], x=-200, y=0)
    col = _mix_color(nt, 1.0, (0, 0, 0), base, x=-100, y=300)
    # knit stripes by height (blender Z): (z0, z1, hex)
    sep = None
    for i, (z0, z1, hx) in enumerate(stripes):
        if sep is None:
            sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-1200, 600)
            nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
        lo = _math(nt, 'GREATER_THAN', sep.outputs["Z"], z0, x=-1000, y=600 + i * 120)
        hi = _math(nt, 'LESS_THAN', sep.outputs["Z"], z1, x=-1000, y=660 + i * 120)
        band = _math(nt, 'MULTIPLY', lo.outputs["Value"], hi.outputs["Value"], x=-850, y=630 + i * 120)
        col = _mix_color(nt, band.outputs["Value"], col.outputs["Result"], hex_lin(hx), x=-100 + i * 60, y=400 + i * 60)
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'; tint.location = (100, 200)
    tint.inputs["Factor"].default_value = 1.0
    nt.links.new(col.outputs["Result"], tint.inputs["A"])
    grey = nt.nodes.new("ShaderNodeCombineColor"); grey.location = (-50, 0)
    for k in range(3):
        nt.links.new(shade.outputs["Value"], grey.inputs[k])
    nt.links.new(grey.outputs["Color"], tint.inputs["B"])
    rgh_n = _maprange(nt, grime.outputs["Fac"], 0.3, 0.8, rough - 0.05, rough + 0.06, x=100, y=-150)
    bump = _bump(nt, weave.outputs["Value"], 0.55 if knit else 0.22, 0.0012, x=300, y=-350)
    _finish(nt, bsdf, tint.outputs["Result"], rgh_n.outputs["Result"], 0.0, bump.outputs["Normal"])
    if sheen_tint is not None:
        bsdf.inputs["Sheen Weight"].default_value = 0.4
        bsdf.inputs["Sheen Tint"].default_value = (*hex_lin(sheen_tint), 1.0)
    return m


def skin(name, eye_centres=()):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(COL["skin"]); shade = hex_lin(COL["skinShade"])
    # a face is not a plaster wall: the value variation is a whisper, low-frequency and warm
    mottle = _noise(nt, tc.outputs["Object"], 14.0, detail=2.0, rough=0.5, y=200)
    pores = _noise(nt, tc.outputs["Object"], 260.0, detail=1.0, rough=0.4, y=-100)
    fac = _maprange(nt, mottle.outputs["Fac"], 0.38, 0.66, 0.0, 0.30, y=200)
    col = _mix_color(nt, fac.outputs["Result"], base, shade, x=-100, y=200)
    # eye sockets: a soft warm-dark ring around each eyeball so the eyes sit IN the face
    sock = None
    for i, c in enumerate(eye_centres):
        vm = nt.nodes.new("ShaderNodeVectorMath"); vm.operation = 'DISTANCE'; vm.location = (-1000, -600 - i * 150)
        nt.links.new(tc.outputs["Object"], vm.inputs[0]); vm.inputs[1].default_value = c
        ring = _maprange(nt, vm.outputs["Value"], 0.050, 0.076, 1.0, 0.0, x=-800, y=-600 - i * 150)
        sock = ring.outputs["Result"] if sock is None else _math(nt, 'MAXIMUM', sock, ring.outputs["Result"], x=-650, y=-650).outputs["Value"]
    if sock is not None:
        socket_col = (base[0] * 0.62, base[1] * 0.52, base[2] * 0.50)
        col = _mix_color(nt, _math(nt, 'MULTIPLY', sock, 0.55, x=-500, y=-650).outputs["Value"], col.outputs["Result"], socket_col, x=50, y=200)
    # a warm blush on the cheeks: below the eyes, front of the face
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-1000, -400)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    band = _maprange(nt, sep.outputs["Z"], 1.12, 1.19, 1.0, 0.0, x=-700, y=-400)
    front = _maprange(nt, sep.outputs["Y"], 0.05, 0.20, 0.0, 1.0, x=-700, y=-500)
    side = _math(nt, 'ABSOLUTE', sep.outputs["X"], x=-700, y=-560)
    side_w = _maprange(nt, side.outputs["Value"], 0.05, 0.16, 0.2, 1.0, x=-550, y=-560)
    bw = _math(nt, 'MULTIPLY', _math(nt, 'MULTIPLY', band.outputs["Result"], front.outputs["Result"], x=-500, y=-450).outputs["Value"],
               side_w.outputs["Result"], x=-350, y=-450)
    blush_col = (min(1, base[0] * 1.08), base[1] * 0.78, base[2] * 0.72)
    blush = _mix_color(nt, _math(nt, 'MULTIPLY', bw.outputs["Value"], 0.28, x=-200, y=-450).outputs["Value"], col.outputs["Result"], blush_col, x=250, y=200)
    rgh = _maprange(nt, pores.outputs["Fac"], 0.3, 0.7, 0.70, 0.78, x=100, y=-150)
    bump = _bump(nt, pores.outputs["Fac"], 0.05, 0.0005, x=300, y=-350)
    _finish(nt, bsdf, blush.outputs["Result"], rgh.outputs["Result"], 0.0, bump.outputs["Normal"])
    bsdf.inputs["Subsurface Weight"].default_value = 0.0
    return m


def hair(name):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(COL["hair"])
    # strands RADIATE from the crown: azimuth about the head's vertical axis, not rings
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-1200, 300)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    az = _math(nt, 'ARCTAN2', sep.outputs["Y"], sep.outputs["X"], x=-1050, y=300)
    wob = _noise(nt, tc.outputs["Object"], 30.0, detail=2.0, y=450)
    azw = _math(nt, 'ADD', _math(nt, 'MULTIPLY', az.outputs["Value"], 38.0, x=-900, y=300).outputs["Value"],
                _math(nt, 'MULTIPLY', wob.outputs["Fac"], 5.0, x=-900, y=450).outputs["Value"], x=-780, y=300)
    # plus a vertical component so the strands also shear as they come down the sides
    azw2 = _math(nt, 'ADD', azw.outputs["Value"], _math(nt, 'MULTIPLY', sep.outputs["Z"], 9.0, x=-900, y=200).outputs["Value"], x=-680, y=300)
    sn = _math(nt, 'SINE', azw2.outputs["Value"], x=-560, y=300)
    strands = _maprange(nt, sn.outputs["Value"], -1.0, 1.0, 0.0, 1.0, x=-440, y=300)
    n2 = _noise(nt, tc.outputs["Object"], 14.0, detail=2.0, y=-100)
    lit = _maprange(nt, strands.outputs["Result"], 0.0, 1.0, 0.84, 1.18, y=200)
    v2 = _maprange(nt, n2.outputs["Fac"], 0.3, 0.7, 0.85, 1.1, y=-100)
    shade = _math(nt, 'MULTIPLY', lit.outputs["Result"], v2.outputs["Result"], x=-300, y=100)
    grey = nt.nodes.new("ShaderNodeCombineColor"); grey.location = (-100, 0)
    for k in range(3):
        nt.links.new(shade.outputs["Value"], grey.inputs[k])
    col = _mix_color(nt, 1.0, (0, 0, 0), base, x=-100, y=300)
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'; tint.location = (100, 200)
    tint.inputs["Factor"].default_value = 1.0
    nt.links.new(col.outputs["Result"], tint.inputs["A"]); nt.links.new(grey.outputs["Color"], tint.inputs["B"])
    rgh = _maprange(nt, strands.outputs["Result"], 0.0, 1.0, 0.62, 0.76, x=100, y=-150)
    bump = _bump(nt, strands.outputs["Result"], 0.6, 0.0022, x=300, y=-350)
    _finish(nt, bsdf, tint.outputs["Result"], rgh.outputs["Result"], 0.0, bump.outputs["Normal"])
    return m


def rubber(name, base_hex, rough=0.86):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(base_hex)
    grain = _noise(nt, tc.outputs["Object"], 180.0, detail=2.0, y=200)
    scuff = _noise(nt, tc.outputs["Object"], 7.0, detail=5.0, rough=0.7, distortion=0.5, y=-100)
    edge = _pointiness(nt)
    edge_v = _maprange(nt, edge, 0.5, 0.62, 0.0, 1.0, x=-900, y=-500)
    scuff_v = _maprange(nt, scuff.outputs["Fac"], 0.5, 0.85, 0.0, 0.45, y=-100)
    dust = _mix_color(nt, scuff_v.outputs["Result"], base, (0.085, 0.074, 0.062), x=-100, y=200)
    edge_w = _math(nt, 'MULTIPLY', edge_v.outputs["Result"], 0.55, x=-700, y=-500)
    worn = _mix_color(nt, edge_w.outputs["Value"], dust.outputs["Result"], (0.12, 0.11, 0.10), x=100, y=200)
    rgh = _maprange(nt, scuff.outputs["Fac"], 0.3, 0.8, rough - 0.08, rough + 0.06, x=100, y=-150)
    bump = _bump(nt, grain.outputs["Fac"], 0.25, 0.0008, x=300, y=-350)
    _finish(nt, bsdf, worn.outputs["Result"], rgh.outputs["Result"], 0.0, bump.outputs["Normal"])
    bsdf.inputs["Coat Weight"].default_value = 0.2
    return m


def metal(name, base_hex, metallic=0.8, rough=0.42):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(base_hex)
    scratch = _wave(nt, tc.outputs["Object"], 260.0, 'X', distortion=6.0, detail=2.0, y=200)
    tarnish = _noise(nt, tc.outputs["Object"], 18.0, detail=3.0, y=-100)
    t_v = _maprange(nt, tarnish.outputs["Fac"], 0.35, 0.75, 0.0, 1.0, y=-100)
    dark = (base[0] * 0.55, base[1] * 0.5, base[2] * 0.45)
    col = _mix_color(nt, t_v.outputs["Result"], base, dark, x=-100, y=200)
    edge = _pointiness(nt)
    edge_v = _maprange(nt, edge, 0.5, 0.64, 0.0, 1.0, x=-900, y=-500)
    bright = (min(1.0, base[0] * 1.6), min(1.0, base[1] * 1.55), min(1.0, base[2] * 1.4))
    col2 = _mix_color(nt, edge_v.outputs["Result"], col.outputs["Result"], bright, x=100, y=200)
    rgh = _maprange(nt, scratch.outputs["Fac"], 0.0, 1.0, rough - 0.10, rough + 0.12, x=100, y=-150)
    rgh2 = _math(nt, 'ADD', rgh.outputs["Result"], _math(nt, 'MULTIPLY', t_v.outputs["Result"], 0.18, x=-100, y=-250).outputs["Value"], x=250, y=-150, clamp=True)
    bump = _bump(nt, scratch.outputs["Fac"], 0.12, 0.0004, x=300, y=-350)
    _finish(nt, bsdf, col2.outputs["Result"], rgh2.outputs["Value"], metallic, bump.outputs["Normal"])
    return m


def leather(name, base_hex, rough=0.72):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(base_hex)
    grain = nt.nodes.new("ShaderNodeTexVoronoi"); grain.location = (-1000, 200)
    grain.inputs["Scale"].default_value = 150.0; grain.feature = 'F1'
    nt.links.new(tc.outputs["Object"], grain.inputs["Vector"])
    creases = _noise(nt, tc.outputs["Object"], 11.0, detail=5.0, rough=0.65, distortion=0.8, y=-100)
    edge = _pointiness(nt)
    edge_v = _maprange(nt, edge, 0.5, 0.63, 0.0, 1.0, x=-900, y=-500)
    c_v = _maprange(nt, creases.outputs["Fac"], 0.3, 0.7, 0.8, 1.08, y=-100)
    grey = nt.nodes.new("ShaderNodeCombineColor"); grey.location = (-300, -100)
    for k in range(3):
        nt.links.new(c_v.outputs["Result"], grey.inputs[k])
    col = _mix_color(nt, 1.0, (0, 0, 0), base, x=-100, y=300)
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'; tint.location = (100, 200)
    tint.inputs["Factor"].default_value = 1.0
    nt.links.new(col.outputs["Result"], tint.inputs["A"]); nt.links.new(grey.outputs["Color"], tint.inputs["B"])
    worn = _mix_color(nt, edge_v.outputs["Result"], tint.outputs["Result"],
                      (min(1, base[0] * 1.7), min(1, base[1] * 1.6), min(1, base[2] * 1.5)), x=250, y=200)
    rgh = _maprange(nt, creases.outputs["Fac"], 0.3, 0.7, rough - 0.10, rough + 0.10, x=100, y=-150)
    h = _math(nt, 'ADD', _math(nt, 'MULTIPLY', grain.outputs["Distance"], 0.5, x=-500, y=-350).outputs["Value"],
              creases.outputs["Fac"], x=-200, y=-350)
    bump = _bump(nt, h.outputs["Value"], 0.35, 0.0012, x=300, y=-350)
    _finish(nt, bsdf, worn.outputs["Result"], rgh.outputs["Result"], 0.0, bump.outputs["Normal"])
    bsdf.inputs["Coat Weight"].default_value = 0.25
    return m


def rope(name, base_hex):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(base_hex)
    twist = _wave(nt, tc.outputs["Object"], 160.0, 'Z', distortion=1.2, detail=1.0, y=200)
    twist.wave_type = 'BANDS'
    fibre = _noise(nt, tc.outputs["Object"], 400.0, detail=1.0, y=-100)
    lit = _maprange(nt, twist.outputs["Fac"], 0.0, 1.0, 0.72, 1.15, y=200)
    grey = nt.nodes.new("ShaderNodeCombineColor"); grey.location = (-300, 0)
    for k in range(3):
        nt.links.new(lit.outputs["Result"], grey.inputs[k])
    col = _mix_color(nt, 1.0, (0, 0, 0), base, x=-100, y=300)
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'; tint.location = (100, 200)
    tint.inputs["Factor"].default_value = 1.0
    nt.links.new(col.outputs["Result"], tint.inputs["A"]); nt.links.new(grey.outputs["Color"], tint.inputs["B"])
    h = _math(nt, 'ADD', twist.outputs["Fac"], _math(nt, 'MULTIPLY', fibre.outputs["Fac"], 0.25, x=-500, y=-300).outputs["Value"], x=-200, y=-300)
    bump = _bump(nt, h.outputs["Value"], 0.8, 0.0025, x=300, y=-350)
    _finish(nt, bsdf, tint.outputs["Result"], 0.94, 0.0, bump.outputs["Normal"])
    return m


def blanket(name):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    base = hex_lin(COL["blanket"]); stripe = hex_lin(0x3d6b78); stripe2 = hex_lin(0xc0553a)
    weave = _wave(nt, tc.outputs["Object"], 300.0, 'X', y=300)
    weave2 = _wave(nt, tc.outputs["Object"], 300.0, 'Y', y=100)
    wv = _math(nt, 'MULTIPLY', weave.outputs["Fac"], weave2.outputs["Fac"], y=200)
    wool = _noise(nt, tc.outputs["Object"], 60.0, detail=3.0, y=-100)
    # stripes run around the roll: bands along blender X (the roll axis)
    sep = nt.nodes.new("ShaderNodeSeparateXYZ"); sep.location = (-1000, -400)
    nt.links.new(tc.outputs["Object"], sep.inputs["Vector"])
    band = _math(nt, 'MULTIPLY', sep.outputs["X"], 9.0, x=-800, y=-400)
    fr = _math(nt, 'FRACT', band.outputs["Value"], x=-650, y=-400)
    s1 = _math(nt, 'LESS_THAN', fr.outputs["Value"], 0.22, x=-500, y=-400)
    s2a = _math(nt, 'GREATER_THAN', fr.outputs["Value"], 0.55, x=-500, y=-500)
    s2b = _math(nt, 'LESS_THAN', fr.outputs["Value"], 0.66, x=-500, y=-600)
    s2 = _math(nt, 'MULTIPLY', s2a.outputs["Value"], s2b.outputs["Value"], x=-350, y=-550)
    c1 = _mix_color(nt, s1.outputs["Value"], base, stripe, x=-100, y=300)
    c2 = _mix_color(nt, s2.outputs["Value"], c1.outputs["Result"], stripe2, x=100, y=300)
    lit = _maprange(nt, wv.outputs["Value"], 0.0, 1.0, 0.86, 1.06, y=200)
    grey = nt.nodes.new("ShaderNodeCombineColor"); grey.location = (-100, 0)
    for k in range(3):
        nt.links.new(lit.outputs["Result"], grey.inputs[k])
    tint = nt.nodes.new("ShaderNodeMix"); tint.data_type = 'RGBA'; tint.blend_type = 'MULTIPLY'; tint.location = (300, 200)
    tint.inputs["Factor"].default_value = 1.0
    nt.links.new(c2.outputs["Result"], tint.inputs["A"]); nt.links.new(grey.outputs["Color"], tint.inputs["B"])
    h = _math(nt, 'ADD', wv.outputs["Value"], _math(nt, 'MULTIPLY', wool.outputs["Fac"], 0.6, x=-500, y=-300).outputs["Value"], x=-200, y=-300)
    bump = _bump(nt, h.outputs["Value"], 0.6, 0.0016, x=300, y=-350)
    _finish(nt, bsdf, tint.outputs["Result"], 0.94, 0.0, bump.outputs["Normal"])
    return m


def flat(name, base_hex, rough, metallic=0.0, use_vertex_color=False, micro=0.0):
    m, nt, bsdf = _new_material(name)
    tc = _coords(nt)
    if use_vertex_color:
        ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Col"; ca.location = (-300, 200)
        alb = ca.outputs["Color"]
    else:
        alb = hex_lin(base_hex)
    nrm = None
    if micro > 0:
        n = _noise(nt, tc.outputs["Object"], 300.0, detail=1.0, y=-200)
        nrm = _bump(nt, n.outputs["Fac"], micro, 0.0004, x=300, y=-350).outputs["Normal"]
    _finish(nt, bsdf, alb, rough, metallic, nrm)
    return m


def lens_material(name):
    m, nt, bsdf = _new_material(name)
    c = hex_lin(COL["lens"])
    bsdf.inputs["Base Color"].default_value = (*c, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.05
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["IOR"].default_value = 1.45
    bsdf.inputs["Alpha"].default_value = 0.30
    bsdf.inputs["Coat Weight"].default_value = 1.0
    bsdf.inputs["Coat Roughness"].default_value = 0.04
    bsdf.inputs["Emission Color"].default_value = (*c, 1.0)
    bsdf.inputs["Emission Strength"].default_value = 0.04
    m.surface_render_method = 'BLENDED'
    m.use_backface_culling = True
    return m


# ------------------------------------------------------------- the looks map
def build_looks(eye_centres=()):
    return {
        "coat": cloth("nim_coat", COL["coat"], 0.88, weave_amt=0.10, sheen_tint=0x7a3a22),
        "coatDark": cloth("nim_coatDark", COL["coatDark"], 0.93, weave_amt=0.10, sheen_tint=0x5d2816),
        "trim": cloth("nim_trim", COL["trim"], 0.80, weave_scale=260.0, weave_amt=0.22, sheen_tint=0x2f4c55, knit=True),
        "scarf": cloth("nim_scarf_look", COL["scarf"], 0.95, weave_scale=220.0, weave_amt=0.20, sheen_tint=0x7c2a1e, knit=True,
                       stripes=((0.505, 0.535, 0x3d6b78), (0.560, 0.578, 0xc0553a), (0.600, 0.630, 0x3d6b78))),
        "blanket": blanket("nim_blanket"),
        "skin": skin("nim_skin", eye_centres),
        "hair": hair("nim_hair"),
        "boot": rubber("nim_boot", COL["boot"], 0.86),
        "metal": metal("nim_metal", COL["metal"], 0.80, 0.42),
        "gold": metal("nim_gold", COL["buckle"], 0.90, 0.30),
        "leather": leather("nim_leather", COL["leather"], 0.72),
        "rope": rope("nim_rope", COL["rope"]),
        "eyeWhite": flat("nim_eyeWhite", COL["eyeWhite"], 0.38, micro=0.05),
        "iris": flat("nim_iris", 0xffffff, 0.46, use_vertex_color=True),
        "lip": flat("nim_lip", COL["lip"], 0.52, micro=0.2),
    }


# ------------------------------------------------------------------ baking
def attach_bake_target(mat, image):
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.name = "BAKE"; tex.image = image; tex.location = (900, -400)
    tex.select = True
    nt.nodes.active = tex


def set_bake_mode(mat, mode):
    """mode: 'albedo' | 'orm' | 'pbr' (Principled for NORMAL / AO passes)."""
    nt = mat.node_tree
    out = nt.nodes["OUT"]
    for l in list(out.inputs["Surface"].links):
        nt.links.remove(l)
    old = nt.nodes.get("BAKE_EMIT")
    if old:
        nt.nodes.remove(old)
    oldc = nt.nodes.get("BAKE_COMB")
    if oldc:
        nt.nodes.remove(oldc)
    if mode == 'pbr':
        nt.links.new(nt.nodes["BSDF"].outputs["BSDF"], out.inputs["Surface"])
        return
    em = nt.nodes.new("ShaderNodeEmission"); em.name = "BAKE_EMIT"; em.location = (700, 300)
    em.inputs["Strength"].default_value = 1.0
    if mode == 'albedo':
        nt.links.new(nt.nodes["ALB"].outputs[0], em.inputs["Color"])
    else:
        comb = nt.nodes.new("ShaderNodeCombineColor"); comb.name = "BAKE_COMB"; comb.location = (550, 300)
        comb.inputs[0].default_value = 1.0
        nt.links.new(nt.nodes["RGH"].outputs[0], comb.inputs[1])
        nt.links.new(nt.nodes["MET"].outputs[0], comb.inputs[2])
        nt.links.new(comb.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])


def make_atlas_material(name, albedo, normal, orm, occlusion=True):
    """The shipped material: albedo (sRGB) + tangent normal + ORM (R = AO -> glTF occlusion)."""
    m, nt, bsdf = _new_material(name)
    ta = nt.nodes.new("ShaderNodeTexImage"); ta.image = albedo; ta.location = (-600, 300); ta.name = "T_ALB"
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = normal; tn.location = (-600, -300); tn.name = "T_NRM"
    to = nt.nodes.new("ShaderNodeTexImage"); to.image = orm; to.location = (-600, 0); to.name = "T_ORM"
    nt.links.new(ta.outputs["Color"], bsdf.inputs["Base Color"])
    sep = nt.nodes.new("ShaderNodeSeparateColor"); sep.location = (-300, 0)
    nt.links.new(to.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-300, -300); nm.inputs["Strength"].default_value = 1.0
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if occlusion:
        from io_scene_gltf2.blender.com.material_helpers import get_gltf_node_name, create_settings_group
        gname = get_gltf_node_name()
        grp = bpy.data.node_groups.get(gname) or create_settings_group(gname)
        gn = nt.nodes.new("ShaderNodeGroup"); gn.node_tree = grp; gn.location = (600, -400)
        nt.links.new(sep.outputs["Red"], gn.inputs["Occlusion"])
    bsdf.inputs["Specular IOR Level"].default_value = 0.5
    m.use_backface_culling = True       # glTF doubleSided: false — one closed prism/lathe per part
    return m
