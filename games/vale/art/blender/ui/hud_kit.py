"""VALE HUD frame kit (lane ART for the client's HUD chrome). Blender 5.2, headless, deterministic.

    python3 art/build.py hud [--pieces dialbar,sky] [--scale 2] [--samples 96]

Builds the HUD's carved frames as real geometry and renders them top-down with Cycles (GPU):
  dialbar   the Dial Bar: a slab of honed ink-slate, its top edge an arc engraved with hour ticks,
            a raised medallion for the portrait and level ring, chalk-lipped sockets for the
            abilities (ultimate larger), spells, items, the Gleam well and recall, a trough for the
            health and resource bars, a pale gnomon wedge at the crown, a hairline dawnglass inlay
  minimap   three frames (rect RIFT, strip BRIDGE, disc FRAY) with hour ticks; FRAY's carries ten
            hour-marks
  sky       the sky strip lintel with the clock boss and the two side caps
  plate     a 9-slice panel frame (shop, scoreboard, recap, tooltips)
Sockets and wells are holes: the frame renders ABOVE the live widgets (icons, bars, the minimap
canvas) so its lips overlap their edges. Bible: plate = structure, ring = time, wedge = act; no gold,
metal, gems, runes or clock hands. One light from the upper left (the stopped morning).

Outputs (WebP, alpha): src/ui/art/hud/<piece>.webp at --scale × the 1080p size, and the positions as
src/ui/hud/frame_layout.ts (generated, do not edit). Layout source: art/blender/ui/hud_layout.json.
"""
from __future__ import annotations

import json
import math
import re
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import scene  # noqa: E402

GAME = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OUT_DIR = os.path.join(GAME, "src", "ui", "art", "hud")
LAYOUT_TS = os.path.join(GAME, "src", "ui", "hud", "frame_layout.ts")
LAYOUT = json.load(open(os.path.join(HERE, "hud_layout.json")))

# ── palette (linear from sRGB hex) ───────────────────────────────────────────────────────────────
SLATE_A, SLATE_B = "#161A21", "#20252E"      # the ink-slate face (cool, near ink-1/ink-2)
LIP = "#5E5A53"                              # honed chalk-grey lip: catches the morning light
LIP_DARK = "#3A3B3E"                         # the deep rim of wells
CHALK = "#D8D1C1"                            # the gnomon and the hour ticks' catch-light
DAWNGLASS = "#BFD3E6"                        # the hairline inlay


# ── geometry helpers (layout units = CSS px at 1080p, y down; Blender y = up) ─────────────────────
class Piece:
    def __init__(self, name: str, w: float, h: float):
        self.name, self.w, self.h = name, w, h
        self.col = scene.collection(name)

    def P(self, x: float, y: float) -> tuple[float, float]:
        return (x, self.h - y)


def rrect(x, y, w, h, r, seg=4):
    """a rounded rectangle as a CCW point loop (layout coords)"""
    r = max(0.0, min(r, w / 2, h / 2))
    pts = []
    corners = [(x + w - r, y + r, -90), (x + w - r, y + h - r, 0), (x + r, y + h - r, 90), (x + r, y + r, 180)]
    for cx, cy, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def chamfer_rect(x, y, w, h, c):
    return [(x + c, y), (x + w - c, y), (x + w, y + c), (x + w, y + h - c), (x + w - c, y + h), (x + c, y + h), (x, y + h - c), (x, y + c)]


def circle(cx, cy, r, n=64):
    return [(cx + r * math.cos(2 * math.pi * i / n), cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]


def offset_loop(pts, d):
    """grow a convex-ish loop outward by d (miter offset)"""
    n = len(pts)
    out = []
    # signed area for orientation
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    s = 1 if area > 0 else -1
    for i in range(n):
        p0, p1, p2 = Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n])
        e0, e1 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n0, n1 = Vector((e0.y, -e0.x)) * s, Vector((e1.y, -e1.x)) * s
        m = (n0 + n1)
        if m.length < 1e-6:
            m = n0
        m.normalize()
        k = d / max(0.35, m.dot(n0))
        out.append(tuple(p1 + m * k))
    return out


def slab(pc: Piece, name: str, loops: list, depth: float, bevel: float, z: float, mat, res: int = 4):
    """a 2D curve (first loop outer, the rest holes), extruded and bevelled, lying at height z"""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = depth
    cu.bevel_depth = bevel
    cu.bevel_resolution = res
    cu.resolution_u = 1
    for loop in loops:
        sp = cu.splines.new("POLY")
        sp.points.add(len(loop) - 1)
        for i, (x, y) in enumerate(loop):
            bx, by = pc.P(x, y)
            sp.points[i].co = (bx, by, 0.0, 1.0)
        sp.use_cyclic_u = True
    ob = scene.new_object(name, cu, pc.col)
    ob.location.z = z
    ob.data.materials.append(mat)
    return ob


# ── materials ────────────────────────────────────────────────────────────────────────────────────
def _principled(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    return m, nt, bsdf


def mat_slate(center=(388.0, -900.0), lines: float = 150.0):
    """honed ink-slate: soft mineral clouds, faint veins, and fine engraved hour-lines radiating from
    a dial centre far below the frame (object space, Blender y up), lighter toward the top edge"""
    m, nt, b = _principled("hud_slate")
    N, L = nt.nodes, nt.links
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ"); L.new(tc.outputs["Object"], sep.inputs[0])
    # clouds
    noise = N.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 0.012; noise.inputs["Detail"].default_value = 10.0
    noise.inputs["Roughness"].default_value = 0.6
    L.new(tc.outputs["Object"], noise.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = scene.hex_rgba(SLATE_A)
    ramp.color_ramp.elements[1].color = scene.hex_rgba(SLATE_B)
    L.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    # veins: a distorted wave, thresholded thin
    wave = N.new("ShaderNodeTexWave"); wave.inputs["Scale"].default_value = 0.006; wave.inputs["Distortion"].default_value = 14.0
    wave.inputs["Detail"].default_value = 6.0
    L.new(tc.outputs["Object"], wave.inputs["Vector"])
    vr = N.new("ShaderNodeValToRGB"); vr.color_ramp.interpolation = "EASE"
    vr.color_ramp.elements[0].position = 0.0; vr.color_ramp.elements[0].color = (0, 0, 0, 1)
    vr.color_ramp.elements[1].position = 0.06; vr.color_ramp.elements[1].color = (0, 0, 0, 1)
    e = vr.color_ramp.elements.new(0.03); e.color = (1, 1, 1, 1)
    L.new(wave.outputs["Fac"], vr.inputs["Fac"])
    veins = N.new("ShaderNodeMix"); veins.data_type = "RGBA"; veins.blend_type = "SCREEN"; veins.inputs["Factor"].default_value = 0.06
    veins.inputs["B"].default_value = scene.hex_rgba("#8E96A3")
    L.new(ramp.outputs["Color"], veins.inputs["A"]); L.new(vr.outputs["Color"], veins.inputs["Factor"])
    vf = N.new("ShaderNodeMath"); vf.operation = "MULTIPLY"; vf.inputs[1].default_value = 0.05
    L.new(vr.outputs["Color"], vf.inputs[0]); L.new(vf.outputs["Value"], veins.inputs["Factor"])
    # engraved hour-lines: angle around the dial centre -> thin stripes
    dx = N.new("ShaderNodeMath"); dx.operation = "SUBTRACT"; dx.inputs[1].default_value = center[0]; L.new(sep.outputs["X"], dx.inputs[0])
    dy = N.new("ShaderNodeMath"); dy.operation = "SUBTRACT"; dy.inputs[1].default_value = center[1]; L.new(sep.outputs["Y"], dy.inputs[0])
    ang = N.new("ShaderNodeMath"); ang.operation = "ARCTAN2"; L.new(dx.outputs["Value"], ang.inputs[0]); L.new(dy.outputs["Value"], ang.inputs[1])
    mul = N.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = lines; L.new(ang.outputs["Value"], mul.inputs[0])
    frac = N.new("ShaderNodeMath"); frac.operation = "FRACT"; L.new(mul.outputs["Value"], frac.inputs[0])
    dist = N.new("ShaderNodeMath"); dist.operation = "PINGPONG"; dist.inputs[1].default_value = 0.5; L.new(frac.outputs["Value"], dist.inputs[0])
    groove = N.new("ShaderNodeMath"); groove.operation = "LESS_THAN"; groove.inputs[1].default_value = 0.07; L.new(dist.outputs["Value"], groove.inputs[0])
    # every 6th line is a long hour-line; the rest fade with height (engraved toward the rim only)
    yfade = N.new("ShaderNodeMapRange"); yfade.inputs["From Min"].default_value = 20.0; yfade.inputs["From Max"].default_value = 120.0
    L.new(sep.outputs["Y"], yfade.inputs["Value"])
    gm = N.new("ShaderNodeMath"); gm.operation = "MULTIPLY"; L.new(groove.outputs["Value"], gm.inputs[0]); L.new(yfade.outputs["Result"], gm.inputs[1])
    dark = N.new("ShaderNodeMix"); dark.data_type = "RGBA"; dark.blend_type = "MULTIPLY"
    dark.inputs["B"].default_value = (0.35, 0.36, 0.40, 1)
    L.new(veins.outputs["Result"], dark.inputs["A"]); L.new(gm.outputs["Value"], dark.inputs["Factor"])
    # top-lit: a touch lighter toward the upper edge
    grad = N.new("ShaderNodeMapRange"); grad.inputs["From Min"].default_value = 20.0; grad.inputs["From Max"].default_value = 160.0
    grad.inputs["To Min"].default_value = 0.92; grad.inputs["To Max"].default_value = 1.18
    L.new(sep.outputs["Y"], grad.inputs["Value"])
    lit = N.new("ShaderNodeMix"); lit.data_type = "RGBA"; lit.blend_type = "MULTIPLY"; lit.inputs["Factor"].default_value = 1.0
    cg = N.new("ShaderNodeCombineColor"); L.new(grad.outputs["Result"], cg.inputs[0]); L.new(grad.outputs["Result"], cg.inputs[1]); L.new(grad.outputs["Result"], cg.inputs[2])
    L.new(dark.outputs["Result"], lit.inputs["A"]); L.new(cg.outputs["Color"], lit.inputs["B"])
    L.new(lit.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.46
    # bump: fine grain + the grooves
    fine = N.new("ShaderNodeTexNoise"); fine.inputs["Scale"].default_value = 0.5; fine.inputs["Detail"].default_value = 6.0
    L.new(tc.outputs["Object"], fine.inputs["Vector"])
    h = N.new("ShaderNodeMath"); h.operation = "MULTIPLY_ADD"; h.inputs[1].default_value = 0.08
    L.new(fine.outputs["Fac"], h.inputs[0])
    hg = N.new("ShaderNodeMath"); hg.operation = "SUBTRACT"; L.new(h.outputs["Value"], hg.inputs[0]); L.new(gm.outputs["Value"], hg.inputs[1])
    L.new(gm.outputs["Value"], h.inputs[2])
    bump = N.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.35; bump.inputs["Distance"].default_value = 1.0
    L.new(hg.outputs["Value"], bump.inputs["Height"]); L.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def mat_stone(name, hexc, rough=0.42, grain=0.08, edge_hex: str | None = "#C9C1AF", edge: float = 0.85):
    """honed stone with a grain; when edge_hex is set, the bevel slopes (facing away from the camera)
    take the chalk catch-light, so every lip reads as carved"""
    m, nt, b = _principled(name)
    N, L = nt.nodes, nt.links
    tc = N.new("ShaderNodeTexCoord")
    noise = N.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 0.08; noise.inputs["Detail"].default_value = 6.0
    ramp = N.new("ShaderNodeValToRGB")
    c = scene.hex_rgba(hexc)
    ramp.color_ramp.elements[0].color = tuple(v * (1 - grain) for v in c[:3]) + (1,)
    ramp.color_ramp.elements[1].color = tuple(min(1, v * (1 + grain)) for v in c[:3]) + (1,)
    L.new(tc.outputs["Object"], noise.inputs["Vector"]); L.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    out = ramp.outputs["Color"]
    if edge_hex:
        lw = N.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.35
        er = N.new("ShaderNodeMapRange"); er.inputs["From Min"].default_value = 0.08; er.inputs["From Max"].default_value = 0.6
        er.inputs["To Max"].default_value = edge
        L.new(lw.outputs["Facing"], er.inputs["Value"])
        mx = N.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.inputs["B"].default_value = scene.hex_rgba(edge_hex)
        L.new(out, mx.inputs["A"]); L.new(er.outputs["Result"], mx.inputs["Factor"])
        out = mx.outputs["Result"]
    L.new(out, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    return m


def mat_glass():
    m, nt, b = _principled("hud_dawnglass")
    b.inputs["Base Color"].default_value = scene.hex_rgba(DAWNGLASS)
    b.inputs["Roughness"].default_value = 0.2
    b.inputs["Emission Color"].default_value = scene.hex_rgba(DAWNGLASS)
    b.inputs["Emission Strength"].default_value = 0.55
    return m


# ── lighting + render ────────────────────────────────────────────────────────────────────────────
def stage(pc: Piece, scale: float, samples: int):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    scene.cycles_device(sc)
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    sc.render.resolution_x = int(round(pc.w * scale))
    sc.render.resolution_y = int(round(pc.h * scale))
    sc.render.resolution_percentage = 100
    cam_data = bpy.data.cameras.new("hud_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(pc.w, pc.h)
    cam = scene.new_object("hud_cam", cam_data, pc.col)
    cam.location = (pc.w / 2, pc.h / 2, 400)
    sc.camera = cam
    w = bpy.data.worlds.new("hud_world")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.012, 0.013, 0.016, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sc.world = w
    # key: a soft sun from the upper left, raking at 38° (the stopped morning); a cool fill from the
    # lower right; a weak top light so the slate face never goes black
    def sun(name, strength, color, angle_deg, frm):
        d = bpy.data.lights.new(name, "SUN"); d.energy = strength; d.color = scene.hex_rgb(color); d.angle = math.radians(angle_deg)
        o = scene.new_object(name, d, pc.col)
        o.rotation_euler = (-Vector(frm)).normalized().to_track_quat("-Z", "Y").to_euler()
        return o
    # a shadow catcher under the frame: its soft drop shadow lands in the alpha (depth over the world)
    pm = bpy.data.meshes.new("catcher"); pm.from_pydata([(-200, -200, -1.2), (pc.w + 200, -200, -1.2), (pc.w + 200, pc.h + 200, -1.2), (-200, pc.h + 200, -1.2)], [], [(0, 1, 2, 3)])
    po = scene.new_object("catcher", pm, pc.col); po.is_shadow_catcher = True
    sun("key", 2.6, "#FFF1DF", 14.0, (-0.66, 0.58, 0.48))
    sun("fill", 0.35, "#BFD3E6", 20.0, (0.7, -0.45, 0.55))
    sun("top", 0.25, "#FFFFFF", 30.0, (0.0, 0.0, 1.0))


def render(pc: Piece, out: str):
    sc = bpy.context.scene
    s = sc.render.image_settings
    s.file_format = "WEBP"
    s.color_mode = "RGBA"
    s.quality = 94
    sc.render.filepath = out
    scene.ensure_dir(os.path.dirname(out))
    bpy.ops.render.render(write_still=True)
    scene.log(f"wrote {scene.rel(out)}")


def isolate(pc: Piece):
    for c in bpy.data.collections:
        hide = c.name != pc.name
        c.hide_render = hide
        c.hide_viewport = hide


# ── the Dial Bar ─────────────────────────────────────────────────────────────────────────────────
def arc_y(L, x):
    W = L["size"][0]
    t = (x - W / 2) / (W / 2)
    return L["arc"]["crown"] + (L["arc"]["edge"] - L["arc"]["crown"]) * t * t


def build_dialbar(mats):
    L = LAYOUT["dialbar"]
    W, H = L["size"]
    pc = Piece("dialbar", W, H)
    x0 = L["slabLeft"]
    # slab outline: the arc top from x0 to the right edge, straight down, along the bottom
    med = L["medallion"]
    mcx, mcy = med["c"]
    rin = med["r"] - 6
    # the left end is concave around the medallion (which covers the seam): no hole crosses the outline
    a0, a1 = math.radians(62), math.radians(-78)
    hug = [(mcx + rin * math.cos(a0 + (a1 - a0) * i / 24), mcy + rin * math.sin(a0 + (a1 - a0) * i / 24)) for i in range(25)]
    xl = hug[-1][0]
    top = [(x, arc_y(L, x)) for x in [xl + (W - 6 - xl) * i / 48 for i in range(49)]]
    outer = [(hug[0][0], H)] + hug + top[1:] + [(W - 6, H)]
    holes = []
    sockets = []
    for sid, (x, y, s) in L["abilities"].items():
        c = 7 if sid == "ult" else 5
        holes.append(chamfer_rect(x, y, s, s, c))
        sockets.append((sid, x, y, s, c))
    hx, hy, hw, hh = L["hp"]; rx, ry, rw, rh = L["res"]
    trough = rrect(hx - 2, hy - 2, hw + 4, (ry + rh) - hy + 4, 3)
    holes.append(trough)
    it = L["items"]
    item_rects = []
    for r in range(it["rows"]):
        for c in range(it["cols"]):
            ix, iy = it["x"] + c * (it["size"] + it["gap"]), it["y"] + r * (it["size"] + it["gap"])
            item_rects.append((ix, iy, it["size"]))
            holes.append(rrect(ix, iy, it["size"], it["size"], 3))
    gx, gy, gw, gh = L["gleam"]
    holes.append(rrect(gx, gy, gw, gh, gh / 2))
    cx, cy, cw, ch = L["recall"]
    holes.append(circle(cx + cw / 2, cy + ch / 2, cw / 2, 40))
    slab(pc, "db_slab", [outer] + holes, depth=3.0, bevel=2.2, z=0.0, mat=mats["slate"])

    # chalk-grey lips around every socket (raised rings), the ultimate's doubled
    for sid, x, y, s, c in sockets:
        inner = chamfer_rect(x, y, s, s, c)
        lip = 4.0 if sid == "ult" else 3.0
        slab(pc, f"db_lip_{sid}", [offset_loop(inner, lip), inner], depth=1.2, bevel=1.1, z=3.6, mat=mats["lip"], res=3)
        if sid == "ult":
            outer2 = offset_loop(inner, 9.0)
            slab(pc, "db_lip_ult2", [outer2, offset_loop(inner, 6.5)], depth=0.6, bevel=0.6, z=3.2, mat=mats["lipdark"], res=2)
    slab(pc, "db_lip_trough", [offset_loop(trough, 3.0), trough], depth=1.0, bevel=1.0, z=3.4, mat=mats["lip"], res=3)
    for i, (ix, iy, s) in enumerate(item_rects):
        inner = rrect(ix, iy, s, s, 3)
        slab(pc, f"db_lip_item{i}", [offset_loop(inner, 2.4), inner], depth=0.9, bevel=0.9, z=3.3, mat=mats["lipdark"], res=3)
    g_in = rrect(gx, gy, gw, gh, gh / 2)
    slab(pc, "db_lip_gleam", [offset_loop(g_in, 2.6), g_in], depth=0.9, bevel=0.9, z=3.3, mat=mats["lip"], res=3)
    r_in = circle(cx + cw / 2, cy + ch / 2, cw / 2, 40)
    slab(pc, "db_lip_recall", [circle(cx + cw / 2, cy + ch / 2, cw / 2 + 2.6, 40), r_in], depth=0.9, bevel=0.9, z=3.3, mat=mats["lip"], res=3)

    # the medallion: a raised disc with the face hole, a groove ring for the level arc, 24 hour ticks
    slab(pc, "db_medallion", [circle(mcx, mcy, med["r"], 96), circle(mcx, mcy, med["face"], 96)], depth=5.0, bevel=2.6, z=0.6, mat=mats["slate"], res=5)
    slab(pc, "db_med_rim", [circle(mcx, mcy, med["r"] + 1.5, 96), circle(mcx, mcy, med["r"] - 3.0, 96)], depth=1.4, bevel=1.2, z=6.4, mat=mats["lip"], res=3)
    slab(pc, "db_med_facelip", [circle(mcx, mcy, med["face"] + 3.0, 96), circle(mcx, mcy, med["face"], 96)], depth=1.2, bevel=1.1, z=6.4, mat=mats["lip"], res=3)
    for i in range(24):
        a = -math.pi / 2 + 2 * math.pi * i / 24
        long = i % 6 == 0
        r0, r1 = med["r"] - (9.5 if long else 7.0), med["r"] - 4.0
        wdt = 1.6 if long else 1.0
        tx, ty = math.cos(a), math.sin(a)
        nx, ny = -ty, tx
        quad = [(mcx + tx * r0 + nx * wdt, mcy + ty * r0 + ny * wdt), (mcx + tx * r1 + nx * wdt, mcy + ty * r1 + ny * wdt),
                (mcx + tx * r1 - nx * wdt, mcy + ty * r1 - ny * wdt), (mcx + tx * r0 - nx * wdt, mcy + ty * r0 - ny * wdt)]
        slab(pc, f"db_med_tick{i}", [quad], depth=0.4, bevel=0.3, z=8.0, mat=mats["chalk"] if long else mats["lip"], res=1)

    # the arc rim: a chalk-grey lip along the top edge, the dawnglass hairline under it, hour ticks
    rim_outer = [(x, y - 1.0) for (x, y) in top]
    rim_inner = [(x, y + 4.0) for (x, y) in reversed(top)]
    slab(pc, "db_rim", [rim_outer + rim_inner], depth=1.4, bevel=1.2, z=3.4, mat=mats["lip"], res=3)
    glass_a = [(x, y + 5.2) for (x, y) in top]
    glass_b = [(x, y + 6.4) for (x, y) in reversed(top)]
    slab(pc, "db_glass", [glass_a + glass_b], depth=0.3, bevel=0.0, z=5.15, mat=mats["glass"], res=1)
    for i in range(1, 25):
        x = xl + (W - 6 - xl) * i / 25
        if x > L["items"]["x"] - 8:
            continue
        y = arc_y(L, x)
        long = i % 6 == 0
        hl = 5.0 if long else 3.0
        q = [(x - 0.8, y + 7.5), (x + 0.8, y + 7.5), (x + 0.8, y + 7.5 + hl), (x - 0.8, y + 7.5 + hl)]
        slab(pc, f"db_tick{i}", [q], depth=0.3, bevel=0.2, z=5.0, mat=mats["chalk"] if long else mats["lip"], res=1)
    # the gnomon at the crown
    g = L["gnomon"]
    gx0 = g["x"]
    gy0 = arc_y(L, gx0)
    wedge = [(gx0 - g["w"] / 2, gy0 + 4), (gx0, gy0 - g["h"]), (gx0 + g["w"] / 2, gy0 + 4), (gx0, gy0 + 1)]
    slab(pc, "db_gnomon", [wedge], depth=2.6, bevel=1.4, z=4.0, mat=mats["chalk"], res=3)
    # the divider between the ultimate and the spells: a short engraved wedge line
    dx = L["abilities"]["spell1"][0] - 10
    slab(pc, "db_divider", [[(dx - 1, 64), (dx + 1, 64), (dx + 1, 108), (dx - 1, 108)]], depth=0.3, bevel=0.2, z=5.0, mat=mats["lip"], res=1)
    return pc


# ── the minimap frames ───────────────────────────────────────────────────────────────────────────
def build_minimap(mats, kind: str):
    M = LAYOUT["minimap"]
    b = M["border"]
    w, h = M[kind]
    W, H = w + 2 * b, h + 2 * b
    pc = Piece(f"minimap_{kind}", W, H)
    if kind == "disc":
        cx, cy, r = W / 2, H / 2, w / 2
        slab(pc, "mm_frame", [circle(cx, cy, r + b - 1, 128), circle(cx, cy, r, 128)], depth=3.0, bevel=2.0, z=0, mat=mats["slate"], res=4)
        slab(pc, "mm_lip", [circle(cx, cy, r + 3.0, 128), circle(cx, cy, r, 128)], depth=1.2, bevel=1.0, z=3.4, mat=mats["lip"], res=3)
        slab(pc, "mm_outer", [circle(cx, cy, r + b, 128), circle(cx, cy, r + b - 3.0, 128)], depth=1.2, bevel=1.0, z=3.4, mat=mats["lip"], res=3)
        for i in range(10):
            a = -math.pi / 2 + 2 * math.pi * i / 10
            tx, ty = math.cos(a), math.sin(a)
            nx, ny = -ty, tx
            r0, r1, wd = r + 4, r + b - 4, 2.2
            q = [(cx + tx * r0 + nx * wd, cy + ty * r0 + ny * wd), (cx + tx * r1 + nx * wd, cy + ty * r1 + ny * wd),
                 (cx + tx * r1 - nx * wd, cy + ty * r1 - ny * wd), (cx + tx * r0 - nx * wd, cy + ty * r0 - ny * wd)]
            slab(pc, f"mm_mark{i}", [q], depth=0.5, bevel=0.4, z=4.9, mat=mats["chalk"], res=1)
        return pc
    inner = rrect(b, b, w, h, 3)
    slab(pc, "mm_frame", [rrect(1, 1, W - 2, H - 2, 8), inner], depth=3.0, bevel=2.0, z=0, mat=mats["slate"], res=4)
    slab(pc, "mm_lip", [offset_loop(inner, 3.0), inner], depth=1.2, bevel=1.0, z=3.4, mat=mats["lip"], res=3)
    slab(pc, "mm_outer", [rrect(0, 0, W, H, 9), rrect(3, 3, W - 6, H - 6, 7)], depth=1.2, bevel=1.0, z=3.4, mat=mats["lip"], res=3)
    # hour ticks along the top and bottom borders; the noon line marks the centre
    n = 24 if kind == "rect" else 26
    for i in range(1, n):
        x = b + w * i / n
        long = i == n // 2
        hl = 7.0 if long else 4.0
        for y0 in (b / 2 - hl / 2, H - b / 2 - hl / 2):
            q = [(x - 0.8, y0), (x + 0.8, y0), (x + 0.8, y0 + hl), (x - 0.8, y0 + hl)]
            slab(pc, f"mm_t{i}_{int(y0)}", [q], depth=0.3, bevel=0.2, z=4.9, mat=mats["chalk"] if long else mats["lip"], res=1)
    # the noon line: a small chalk lozenge at the top and bottom centre of the border
    for yc in (b / 2, H - b / 2):
        q = [(W / 2, yc - 5.5), (W / 2 + 7, yc), (W / 2, yc + 5.5), (W / 2 - 7, yc)]
        slab(pc, f"mm_noon{int(yc)}", [q], depth=0.8, bevel=0.6, z=4.6, mat=mats["chalk"], res=2)
    # corner wedges
    for (x, y, sx, sy) in ((b * 0.5, b * 0.5, 1, 1), (W - b * 0.5, b * 0.5, -1, 1), (b * 0.5, H - b * 0.5, 1, -1), (W - b * 0.5, H - b * 0.5, -1, -1)):
        q = [(x, y), (x + sx * 9, y), (x, y + sy * 9)]
        slab(pc, f"mm_c{int(x)}_{int(y)}", [q], depth=0.8, bevel=0.5, z=4.6, mat=mats["chalk"], res=2)
    return pc


# ── the sky strip ────────────────────────────────────────────────────────────────────────────────
def build_sky(mats):
    S = LAYOUT["sky"]
    W, H = S["size"]
    pc = Piece("sky", W, H)
    cw, ch = S["clock"]
    body = [(10, 4), (W - 10, 4), (W - 2, H / 2), (W - 10, H - 6), (W / 2 + cw / 2 + 18, H - 6), (W / 2 + cw / 2 + 6, H + 0),
            (W / 2 - cw / 2 - 6, H + 0), (W / 2 - cw / 2 - 18, H - 6), (10, H - 6), (2, H / 2)]
    face = rrect(16, 10, W - 32, H - 20, 3)
    slab(pc, "sky_body", [body, face], depth=3.0, bevel=2.0, z=0, mat=mats["slate"], res=4)
    slab(pc, "sky_lip", [offset_loop(face, 2.6), face], depth=1.0, bevel=0.9, z=3.3, mat=mats["lip"], res=3)
    # the clock boss below the strip's centre
    boss = rrect(W / 2 - cw / 2, H - 14, cw, 14, 4)
    slab(pc, "sky_boss", [boss], depth=1.4, bevel=1.2, z=3.5, mat=mats["lip"], res=3)
    for i, x in enumerate((24, W - 24)):
        q = [(x, H / 2 - 7), (x + (6 if i == 0 else -6), H / 2), (x, H / 2 + 7), (x + (-6 if i == 0 else 6), H / 2)]
        slab(pc, f"sky_cap{i}", [q], depth=1.0, bevel=0.6, z=4.6, mat=mats["chalk"], res=2)
    glass = [(40, 6.2), (W - 40, 6.2), (W - 40, 7.2), (40, 7.2)]
    slab(pc, "sky_glass", [glass], depth=0.3, bevel=0, z=4.95, mat=mats["glass"], res=1)
    return pc


# ── the 9-slice plate ────────────────────────────────────────────────────────────────────────────
def build_plate(mats):
    P = LAYOUT["plate"]
    S, B = P["size"], P["border"]
    pc = Piece("plate", S, S)
    inner = rrect(B * 0.5, B * 0.5, S - B, S - B, 4)
    slab(pc, "pl_body", [rrect(2, 2, S - 4, S - 4, 6)], depth=2.4, bevel=1.8, z=0, mat=mats["slate"], res=4)
    slab(pc, "pl_lip", [offset_loop(inner, 2.2), inner], depth=0.8, bevel=0.7, z=3.4, mat=mats["lip"], res=3)
    for (x, y, sx, sy) in ((B * 0.5, B * 0.5, 1, 1), (S - B * 0.5, B * 0.5, -1, 1), (B * 0.5, S - B * 0.5, 1, -1), (S - B * 0.5, S - B * 0.5, -1, -1)):
        q = [(x - sx * 2, y - sy * 2), (x + sx * 11, y - sy * 2), (x - sx * 2, y + sy * 11)]
        slab(pc, f"pl_c{int(x)}_{int(y)}", [q], depth=0.8, bevel=0.5, z=3.6, mat=mats["chalk"], res=2)
    return pc


# ── main ─────────────────────────────────────────────────────────────────────────────────────────
def write_layout_ts():
    body = json.dumps({k: v for k, v in LAYOUT.items() if not k.startswith("$")}, indent=2)
    body = re.sub(r"\[\s*([-\d.,\s]+?)\s*\]", lambda m: "[" + ", ".join(x.strip() for x in m.group(1).split(",")) + "]", body)
    src = ("// GENERATED by art/blender/ui/hud_kit.py from art/blender/ui/hud_layout.json — do not edit.\n"
           "// The HUD frame art (src/ui/art/hud/*.webp) was rendered from these positions (CSS px at 1080p).\n\n"
           f"export const FRAME = {body} as const;\n")
    with open(LAYOUT_TS, "w", encoding="utf-8") as f:
        f.write(src)
    scene.log(f"wrote {scene.rel(LAYOUT_TS)}")


def main():
    args = scene.parse_args(lambda p: (p.add_argument("--pieces", default=""), p.add_argument("--scale", type=float, default=2.0),
                                       p.add_argument("--samples", type=int, default=96)))
    scene.reset()
    mats = {"slate": mat_slate(), "lip": mat_stone("hud_lip", LIP), "lipdark": mat_stone("hud_lipdark", LIP_DARK, rough=0.5, edge_hex="#8F8A80", edge=0.7),
            "chalk": mat_stone("hud_chalk", CHALK, rough=0.38, grain=0.05, edge_hex="#FFF8EA", edge=0.6), "glass": mat_glass()}
    builders = {
        "dialbar": lambda: build_dialbar(mats),
        "minimap_rect": lambda: build_minimap(mats, "rect"),
        "minimap_strip": lambda: build_minimap(mats, "strip"),
        "minimap_disc": lambda: build_minimap(mats, "disc"),
        "sky": lambda: build_sky(mats),
        "plate": lambda: build_plate(mats),
    }
    only = [s for s in args.pieces.split(",") if s]
    T = scene.Timer("hud")
    write_layout_ts()
    for name, fn in builders.items():
        if only and name not in only:
            continue
        with T.step(name):
            pc = fn()
            for o in list(bpy.data.objects):
                if o.type == "CAMERA" or o.type == "LIGHT":
                    bpy.data.objects.remove(o)
            stage(pc, args.scale, args.samples)
            isolate(pc)
            render(pc, os.path.join(OUT_DIR, f"{name}.webp"))


if __name__ == "__main__":
    main()
