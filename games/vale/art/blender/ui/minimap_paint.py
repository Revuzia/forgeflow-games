"""VALE painted minimaps (CONTRACT §12 outputs: art/out/maps/<id>/minimap.png). Blender 5.2, headless.

    python3 art/build.py minimaps [--maps map_rift,map_bridge,map_fray] [--px 1100]

Built FROM THE MAP JSON (content/maps/<id>.json), the same layout truth the sim, the HUD and the
Blender map scenes read, so every road and wall is where the game says it is. Rendered top-down with
Cycles (GPU) under the map's sun, then given a light painterly pass:
  RIFT    Dialwood masses (the walls) as stone-lipped blocks under a canopy of lacquered fan-leaf
          trees; paved roads; needlegrass thickets; the Noonline: the Standing Shadow's violet stone
          (north) and the Fallen Shaft's shallow water (south); the Seat and its engraved hour-ring;
          chalk (west, Aubade) and ironstone (east, Serenade) base terraces
  BRIDGE  the needle's shaft over the gorge: a pale deck, the drop on both sides, the Snap's crack
  FRAY    the Noonplate: a honed pale dial-stone disc, dark inlaid hour-lines to the ten hour-marks, the cart
          ring; the hour-stones, the cart and the rim dark basalt (the obstacles read dark on the bright stage)
Screen-top = low sim y (the camera looks −Z): the image's top row is y = 0.
"""
from __future__ import annotations

import json
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import imageops, scene  # noqa: E402

GAME = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
CONTENT = os.path.join(GAME, "content", "maps")
OUT = os.path.join(GAME, "art", "out", "maps")


# ── geometry ─────────────────────────────────────────────────────────────────────────────────────
def B(x, y, z=0.0):
    """sim (x, y) → Blender (x, −y): the image top is sim y = 0"""
    return (x, -y, z)


def prism(name, poly, h, mat, col, z0=0.0, bevel=0.0):
    """extrude a sim-space polygon to height h (a 2D curve gives clean caps for concave outlines)"""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "2D"; cu.fill_mode = "BOTH"; cu.extrude = h / 2; cu.bevel_depth = bevel; cu.bevel_resolution = 2
    sp = cu.splines.new("POLY"); sp.points.add(len(poly) - 1)
    for i, (x, y) in enumerate(poly):
        sp.points[i].co = (x, -y, 0, 1)
    sp.use_cyclic_u = True
    ob = scene.new_object(name, cu, col)
    ob.location.z = z0 + h / 2
    ob.data.materials.append(mat)
    return ob


def ribbon(name, path, width, z, mat, col):
    """a road along a polyline (sim coords) as a flat mesh strip with round joins"""
    verts, faces = [], []
    pts = [Vector((x, -y)) for x, y in path]
    for i, p in enumerate(pts):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        t = (b - a).normalized()
        n = Vector((-t.y, t.x)) * (width / 2)
        verts += [(p.x + n.x, p.y + n.y, z), (p.x - n.x, p.y - n.y, z)]
        if i:
            k = 2 * i
            faces.append((k - 2, k - 1, k + 1, k))
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    ob = scene.new_object(name, me, col); ob.data.materials.append(mat)
    # round caps at the joins: discs
    for i, p in enumerate(pts):
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=width / 2, depth=0.02, location=(p.x, p.y, z))
        d = bpy.context.active_object; d.name = f"{name}_j{i}"; d.data.materials.append(mat)
        for c in d.users_collection: c.objects.unlink(d)
        col.objects.link(d)
    return ob


def disc(name, at, r, z, mat, col, depth=0.05, verts=64):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=B(at[0], at[1], z))
    d = bpy.context.active_object; d.name = name; d.data.materials.append(mat)
    for c in d.users_collection: c.objects.unlink(d)
    col.objects.link(d)
    return d


def ring(name, at, r, w, z, mat, col):
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=r, fill_type="NOTHING", location=B(at[0], at[1], z))
    o = bpy.context.active_object; o.name = name
    sol = o.modifiers.new("w", "SKIN") if False else None
    bpy.ops.object.convert(target="CURVE")
    o.data.bevel_depth = w / 2; o.data.bevel_resolution = 1
    o.data.materials.append(mat)
    for c in o.users_collection: c.objects.unlink(o)
    col.objects.link(o)
    return o


def point_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def dist_to_path(x, y, path):
    best = 1e9
    for (ax, ay), (bx, by) in zip(path, path[1:]):
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1e-9
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / L2))
        px, py = ax + t * dx, ay + t * dy
        best = min(best, math.hypot(x - px, y - py))
    return best


# ── materials ────────────────────────────────────────────────────────────────────────────────────
def mat(name, hexc, rough=0.8, noise=0.12, scale=0.4, voronoi=0.0, vscale=0.6, emit=None, metal=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; N, L = nt.nodes, nt.links
    b = N["Principled BSDF"]
    tc = N.new("ShaderNodeTexCoord")
    nz = N.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = scale; nz.inputs["Detail"].default_value = 8.0
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    c = scene.hex_rgba(hexc)
    ramp.color_ramp.elements[0].color = tuple(v * (1 - noise) for v in c[:3]) + (1,)
    ramp.color_ramp.elements[1].color = tuple(min(1, v * (1 + noise)) for v in c[:3]) + (1,)
    L.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    out = ramp.outputs["Color"]
    if voronoi > 0:
        vo = N.new("ShaderNodeTexVoronoi"); vo.feature = "DISTANCE_TO_EDGE"; vo.inputs["Scale"].default_value = vscale
        L.new(tc.outputs["Object"], vo.inputs["Vector"])
        mr = N.new("ShaderNodeMapRange"); mr.inputs["From Min"].default_value = 0.0; mr.inputs["From Max"].default_value = 0.06
        mr.inputs["To Min"].default_value = 1.0 - voronoi; mr.inputs["To Max"].default_value = 1.0
        L.new(vo.outputs["Distance"], mr.inputs["Value"])
        mul = N.new("ShaderNodeMix"); mul.data_type = "RGBA"; mul.blend_type = "MULTIPLY"; mul.inputs["Factor"].default_value = 1.0
        cc = N.new("ShaderNodeCombineColor")
        for k in range(3): L.new(mr.outputs["Result"], cc.inputs[k])
        L.new(out, mul.inputs["A"]); L.new(cc.outputs["Color"], mul.inputs["B"])
        out = mul.outputs["Result"]
    L.new(out, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = scene.hex_rgba(emit[0]); b.inputs["Emission Strength"].default_value = emit[1]
    return m


def canopy_mat():
    """lacquered fan-leaf canopies: object-random hue/value variation over a deep stone-green"""
    m = bpy.data.materials.new("canopy"); m.use_nodes = True
    nt = m.node_tree; N, L = nt.nodes, nt.links
    b = N["Principled BSDF"]
    info = N.new("ShaderNodeObjectInfo")
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = scene.hex_rgba("#3E5241")
    ramp.color_ramp.elements[1].color = scene.hex_rgba("#6E7A55")
    e = ramp.color_ramp.elements.new(0.55); e.color = scene.hex_rgba("#56684A")
    L.new(info.outputs["Random"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.42
    b.inputs["Specular IOR Level"].default_value = 0.6
    return m


# ── scenes per map ───────────────────────────────────────────────────────────────────────────────
def canopy(col, polys, avoid_paths, seed, density=0.22, rmin=1.4, rmax=2.6, h0=2.6):
    """scatter canopy blobs over wall polygons (Dialwood masses), skipping road margins"""
    rng = scene.rng("canopy", seed)
    proto = bpy.data.meshes.new("leaf")
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0)
    tmp = bpy.context.active_object
    proto = tmp.data
    bpy.data.objects.remove(tmp)
    cm = canopy_mat()
    proto.materials.append(cm)
    n = 0
    for poly in polys:
        xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        area = (x1 - x0) * (y1 - y0)
        tries = int(area * density)
        for _ in range(tries):
            x, y = rng.uniform(x0, x1), rng.uniform(y0, y1)
            if not point_in_poly(x, y, poly):
                continue
            if any(dist_to_path(x, y, p) < 4.5 for p in avoid_paths):
                continue
            r = rng.uniform(rmin, rmax)
            ob = bpy.data.objects.new(f"leaf{n}", proto)
            ob.location = B(x, y, h0 + rng.uniform(-0.3, 0.6))
            ob.scale = (r, r * rng.uniform(0.85, 1.15), r * 0.55)
            ob.rotation_euler = (0, 0, rng.uniform(0, math.tau))
            col.objects.link(ob)
            n += 1
    scene.log(f"canopy: {n} trees")


def build_rift(m, col):
    W, H = m["size"]
    t = m["art"]["terrain"]
    ground = mat("grove_floor", "#4B5444", noise=0.18, scale=0.08)
    plane = disc("ground", (W / 2, H / 2), 1, 0, ground, col)  # replaced below by a plane
    bpy.data.objects.remove(plane)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(W / 2, -H / 2, 0)); g = bpy.context.active_object
    g.scale = (W + 40, H + 40, 1); g.data.materials.append(ground)
    for c in g.users_collection: c.objects.unlink(g)
    col.objects.link(g)
    # clearings around roads + the dial's hour ring: pale worn ground
    clearing = mat("clearing", t["colors"]["clearing"], noise=0.15, scale=0.12)
    road = mat("road", t["colors"]["lane"], rough=0.7, noise=0.1, scale=0.3, voronoi=0.45, vscale=0.55)
    for i, lane in enumerate(m["lanes"]):
        ribbon(f"clear{i}", lane["path"], 11.0, 0.02, clearing, col)
        ribbon(f"road{i}", lane["path"], 6.2, 0.05, road, col)
    hl = t.get("hourLines")
    inscr = mat("inscription", t["colors"]["inscription"], rough=0.6, noise=0.05)
    if hl:
        ring("hour_ring", hl["centre"], hl["ring"], 0.7, 0.06, inscr, col)
    # the Noonline
    nl = t.get("noonline", {})
    if "standingShadow" in nl:
        sh = mat("standing_shadow", nl["standingShadow"]["tint"], rough=0.55, noise=0.08, scale=0.2, voronoi=0.25, vscale=0.3)
        for poly in nl["standingShadow"]["floor"]:
            prism("shadow", poly, 0.08, sh, col)
    if "fallenShaft" in nl:
        water = mat("shaft_water", "#7C9AA0", rough=0.08, noise=0.1, scale=0.3, spec=0.9)
        bed = mat("shaft_bed", "#B5B0A2", rough=0.7, noise=0.12, scale=0.25, voronoi=0.3, vscale=0.4)
        for poly in nl["fallenShaft"]["floor"]:
            prism("shaft_bed", poly, 0.04, bed, col)
            w = prism("shaft_water", poly, 0.1, water, col, z0=0.05)
            w.data.materials[0].node_tree.nodes["Principled BSDF"].inputs["Alpha"].default_value = 0.55
    seat = t.get("seat")
    if seat:
        stone = mat("seat", "#C2BBAA", rough=0.55, noise=0.06, scale=0.3)
        disc("seat", seat["at"], seat["radius"], 0.09, stone, col, depth=0.1)
        ring("seat_rim", seat["at"], seat["radius"] - 0.6, 0.35, 0.16, inscr, col)
    # bases: chalk (west) and ironstone (east) terraces around the fountains
    chalk = mat("base_chalk", "#CBC8BE", rough=0.5, noise=0.06, scale=0.2, voronoi=0.35, vscale=0.25)
    iron = mat("base_iron", "#A68E72", rough=0.55, noise=0.08, scale=0.2, voronoi=0.35, vscale=0.25)
    for b in m["bases"]:
        f = b["fountain"]
        mt = chalk if b["team"] == 0 else iron
        disc(f"base{b['team']}", f["at"], f["radius"] + 9.0, 0.07, mt, col, depth=0.1)
        ring(f"base_ring{b['team']}", f["at"], f["radius"] + 1.0, 0.5, 0.14, inscr, col)
    # thickets: needlegrass, a darker raised tuft
    grass = mat("needlegrass", "#3D5238", rough=0.85, noise=0.3, scale=1.2)
    for i, poly in enumerate(m["thickets"]):
        prism(f"thicket{i}", poly, 0.5, grass, col, bevel=0.2)
    # Dialwood masses: stone-lipped blocks, then the canopy over them
    lip = mat("wall_stone", "#6F6C64", rough=0.7, noise=0.12, scale=0.3)
    top = mat("wall_floor", "#33402F", rough=0.9, noise=0.2, scale=0.2)
    for i, poly in enumerate(m["walls"]):
        prism(f"wall{i}", poly, 2.2, lip, col, bevel=0.35)
        prism(f"wallf{i}", poly, 0.05, top, col, z0=2.2)
    canopy(col, m["walls"], [l["path"] for l in m["lanes"]], "rift")


def build_bridge(m, col):
    W, H = m["size"]
    t = m["art"]["terrain"]
    # the gorge: a deep blue-black drop with mist (the walls of Needlespan are the drop)
    abyss = mat("gorge", "#1C2230", rough=0.9, noise=0.25, scale=0.05, emit=("#5E6C93", 0.08))
    bpy.ops.mesh.primitive_plane_add(size=1, location=(W / 2, -H / 2, -6)); g = bpy.context.active_object
    g.scale = (W + 40, H + 40, 1); g.data.materials.append(abyss)
    for c in g.users_collection: c.objects.unlink(g)
    col.objects.link(g)
    deck = mat("deck", "#A39C8E", rough=0.6, noise=0.1, scale=0.2, voronoi=0.4, vscale=0.35)
    # the walkable shaft = the map rect minus the walls (gorge polygons): a deck slab with the walls cut by
    # drawing the walls as deep pits over it
    bpy.ops.mesh.primitive_plane_add(size=1, location=(W / 2, -H / 2, 0)); d = bpy.context.active_object
    d.scale = (W, H, 1); d.data.materials.append(deck)
    for c in d.users_collection: c.objects.unlink(d)
    col.objects.link(d)
    road = mat("road", t["colors"]["lane"], rough=0.65, noise=0.08, scale=0.3, voronoi=0.5, vscale=0.6)
    for i, lane in enumerate(m["lanes"]):
        ribbon(f"road{i}", lane["path"], 7.0, 0.05, road, col)
    for i, poly in enumerate(m["walls"]):
        prism(f"gorge{i}", poly, 0.2, abyss, col, z0=0.02)
    grass = mat("needlegrass", "#4A5A40", rough=0.85, noise=0.3, scale=1.2)
    for i, poly in enumerate(m["thickets"]):
        prism(f"thicket{i}", poly, 0.4, grass, col, bevel=0.15)
    inscr = mat("inscription", t["colors"]["inscription"], rough=0.6, noise=0.05)
    for b in m["bases"]:
        f = b["fountain"]
        disc(f"base{b['team']}", f["at"], f["radius"] + 3.0, 0.07, mat(f"bt{b['team']}", "#CBC8BE" if b["team"] == 0 else "#A68E72", noise=0.06, voronoi=0.3, vscale=0.3), col)
        ring(f"base_ring{b['team']}", f["at"], f["radius"] + 1.0, 0.5, 0.14, inscr, col)
    # the Snap's crack: a thin lit line across the centre
    crack = mat("crack", "#E8DCC4", rough=0.5, emit=("#FFE2B0", 0.6))
    for lm in t.get("landmarks", []):
        if lm["id"] == "snap_crack":
            x, y = lm["at"]; prism("crack", [(x - 0.25, y - lm["size"][1] / 2), (x + 0.25, y - lm["size"][1] / 2), (x + 0.35, y + lm["size"][1] / 2), (x - 0.15, y + lm["size"][1] / 2)], 0.08, crack, col)


def build_fray(m, col):
    W, H = m["size"]
    t = m["art"]["terrain"]
    cx, cy = W / 2, H / 2
    outside = mat("fair_ground", "#6D675C", rough=0.85, noise=0.15, scale=0.1)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, -cy, -0.05)); g = bpy.context.active_object
    g.scale = (W + 20, H + 20, 1); g.data.materials.append(outside)
    for c in g.users_collection: c.objects.unlink(g)
    col.objects.link(g)
    plate = mat("dial_stone", t["colors"].get("lane", "#A19A8B"), rough=0.45, noise=0.06, scale=0.15, voronoi=0.2, vscale=0.12)
    disc("plate", (cx, cy), W / 2 - 1.0, 0.05, plate, col, depth=0.1, verts=128)
    inscr = mat("inscription", t["colors"]["inscription"], rough=0.55, noise=0.05)
    ring("band", (cx, cy), W / 2 - 4.5, 1.2, 0.12, inscr, col)
    for sx, sy in m["spawns"]:
        ribbon(f"hourline{sx}", [(cx, cy), (sx, sy)], 0.45, 0.11, inscr, col)
        disc(f"mark{sx}", (sx, sy), 1.4, 0.12, inscr, col, depth=0.06)
    ring("cart_ring", (cx, cy), 4.5, 0.6, 0.12, mat("shop_ring", t["colors"].get("midInlay", "#7A766C"), rough=0.55, noise=0.05), col)
    stone = mat("hour_stone", t["colors"].get("cliffFace", "#3E3D40"), rough=0.6, noise=0.1, scale=0.4)
    for i, poly in enumerate(m["walls"]):
        prism(f"wall{i}", poly, 1.2, stone, col, bevel=0.2)
    grass = mat("needlegrass", "#4A5A40", rough=0.85, noise=0.3, scale=1.2)
    for i, poly in enumerate(m["thickets"]):
        prism(f"thicket{i}", poly, 0.4, grass, col, bevel=0.15)


BUILDERS = {"map_rift": build_rift, "map_bridge": build_bridge, "map_fray": build_fray}


def render_map(mid: str, px: int, samples: int):
    m = json.load(open(os.path.join(CONTENT, f"{mid}.json")))
    scene.reset()
    sc = bpy.context.scene
    col = scene.collection(mid)
    BUILDERS[mid](m, col)
    W, H = m["size"]
    cam_d = bpy.data.cameras.new("cam"); cam_d.type = "ORTHO"; cam_d.ortho_scale = max(W, H)
    cam = scene.new_object("cam", cam_d, col); cam.location = (W / 2, -H / 2, 200); sc.camera = cam
    scale = px / max(W, H)
    sc.render.resolution_x = int(round(W * scale)); sc.render.resolution_y = int(round(H * scale))
    scene.cycles_device(sc)
    sc.cycles.samples = samples; sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.film_transparent = False
    w = bpy.data.worlds.new("w"); w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.6, 0.68, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45
    sc.world = w
    lt = m["art"].get("lighting", {})
    sd = lt.get("sunDir", [-0.35, 0.79, 0.5])
    # sunDir is in sim/render space (x east, y up, z = sim y south); the minimap wants the light from the
    # upper left on screen whatever the map says, so tilt it there with the map's elevation
    elev = max(0.35, min(0.85, sd[1]))
    sun = bpy.data.lights.new("sun", "SUN"); sun.energy = 3.4 * lt.get("sunIntensity", 3.0) / 3.0; sun.angle = math.radians(3)
    sun.color = scene.hex_rgb("#FFF1E2")   # neutral-warm on every map: the minimap reads value, not mood
    so = scene.new_object("sun", sun, col)
    d = Vector((-0.62, 0.5, elev)).normalized()
    so.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    out_dir = scene.ensure_dir(os.path.join(OUT, mid))
    raw = os.path.join(out_dir, "minimap_raw.png")
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGB"
    sc.render.filepath = raw
    bpy.ops.render.render(write_still=True)
    # a light painterly pass: Kuwahara (brushwork) blended over the render
    arr = imageops.load(raw)
    k = imageops.kuwahara(arr[..., :3], 3)
    arr[..., :3] = arr[..., :3] * 0.45 + k * 0.55
    imageops.save(arr, os.path.join(out_dir, "minimap.png"), alpha=False)
    os.remove(raw)
    scene.log(f"wrote {scene.rel(os.path.join(out_dir, 'minimap.png'))} ({sc.render.resolution_x}×{sc.render.resolution_y})")


def main():
    args = scene.parse_args(lambda p: (p.add_argument("--maps", default="map_rift,map_bridge,map_fray"), p.add_argument("--px", type=int, default=1100),
                                       p.add_argument("--samples", type=int, default=64)))
    for mid in [x for x in args.maps.split(",") if x]:
        render_map(mid, args.px, args.samples)


if __name__ == "__main__":
    main()
