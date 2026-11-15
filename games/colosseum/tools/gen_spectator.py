"""
Generate the seated-spectator LOD meshes in Blender, headless.

WHY BLENDER AND NOT MORE PROCEDURAL THREE.JS
The crowd was two hand-built primitive stacks. The near figure was a box thigh,
a 5-sided cylinder torso and an octahedron head (~30 tris); the far figure —
73.8% of all 17,974 spectators — was a single 4-sided tapered cylinder. From
the sand that far tier reads as coloured confetti, because a 4-gon prism has no
human silhouette: no head break, no shoulder line, no lap.

Silhouette is the whole game at this distance. Nobody resolves a spectator's
face in a 55 m-wide bowl; they resolve head-over-shoulders-over-lap. Building
that by hand out of three.js primitives means more draw-time triangles for a
worse outline, because primitives cannot share a shoulder. Blender can join,
weld and decimate to an exact triangle budget while KEEPING the outline, which
is precisely the tool for "as few triangles as possible, still human".

OUTPUT
Three LODs, exported as one .glb each, then baked to a JS module by
tools/bake_spectator.mjs so the crowd stays synchronous at boot (no fetch, no
async, no chance of a half-populated amphitheatre on a slow connection).

  spectator_lod0.glb  ~150 tris  seated, head/shoulders/arms/lap, for the
                                 nearest rows the camera actually passes
  spectator_lod1.glb   ~54 tris  same silhouette, decimated
  spectator_lod2.glb   ~20 tris  head + shoulder wedge + lap — still reads
                                 human in outline, unlike a 4-gon prism

run:
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background \
      --python games/colosseum/tools/gen_spectator.py
"""

import bpy
import bmesh
import math
import os
import sys

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_spectator")
os.makedirs(OUT_DIR, exist_ok=True)


def clear():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.objects):
        for item in list(block):
            try:
                block.remove(item)
            except Exception:
                pass


def add_box(name, size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return o


def add_cyl(name, r1, r2, depth, loc, verts=6, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(
        vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot
    )
    o = bpy.context.active_object
    o.name = name
    return o


def build_spectator():
    """
    A seated human, Z-up, origin at the seat surface, ~1.24 m tall seated.

    Proportions are the ones that survive to silhouette: the lap juts FORWARD
    (this is what a 4-gon prism cannot do and why the old far tier read as a
    bollard), the shoulders are wider than the head by a clear margin, and the
    neck is a real gap so the head separates against the sky.
    """
    parts = []

    # Lap / thighs — forward-projecting, the key seated read.
    parts.append(add_box("lap", (0.36, 0.40, 0.17), (0, 0.13, 0.085)))
    # Shins dropping from the seat front.
    parts.append(add_box("shins", (0.32, 0.15, 0.34), (0, 0.30, -0.10)))
    # Torso, tapered, leaning very slightly forward like someone watching.
    parts.append(
        add_cyl("torso", 0.20, 0.17, 0.46, (0, 0.02, 0.40), verts=7, rot=(math.radians(-6), 0, 0))
    )
    # Shoulder bar — wider than the head, this is the silhouette anchor.
    parts.append(add_box("shoulders", (0.44, 0.20, 0.13), (0, 0.01, 0.60)))
    # Arms resting on the lap.
    for sx in (-1, 1):
        parts.append(
            add_box("arm", (0.09, 0.30, 0.10), (sx * 0.21, 0.14, 0.46),
                    rot=(math.radians(28), 0, 0))
        )
    # Neck gap then head — an icosphere, not an octahedron, so it stays round
    # in outline at every yaw instead of showing a hard diamond edge.
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=0.108, location=(0, 0.01, 0.745))
    parts.append(bpy.context.active_object)

    # Join, weld the seams, and let normals be flat — these are lit by a
    # vertex-colour instanced material, so smooth shading buys nothing.
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "spectator"

    me = body.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.012)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    return body


def decimate_to(obj, target_tris):
    """Collapse-decimate to a triangle budget, preserving the outline."""
    cur = len(obj.data.polygons)
    if cur <= target_tris:
        return cur
    m = obj.modifiers.new(name="dec", type="DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = max(0.02, target_tris / float(cur))
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=m.name)
    return len(obj.data.polygons)


def export(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="NONE",   # vertex-colour instanced material at runtime
        export_normals=True,
        export_yup=True,           # three.js is Y-up; Blender is Z-up
    )


def main():
    clear()
    results = []
    for lod, budget in enumerate([150, 54, 20]):
        clear()
        body = build_spectator()
        tris = decimate_to(body, budget)
        path = os.path.join(OUT_DIR, "spectator_lod%d.glb" % lod)
        export(body, path)
        results.append((lod, tris, path))
        print("LOD%d  %4d tris  -> %s" % (lod, tris, path))

    print("\nSPECTATOR_GEN_OK " + " ".join("%d:%d" % (l, t) for l, t, _ in results))


if __name__ == "__main__":
    main()
