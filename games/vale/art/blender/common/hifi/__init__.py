"""VALE ART 2.0: the high-to-low character method (scripted, deterministic, CPU-only).

    sdf       numpy signed-distance sculpting: primitives (ellipsoids, round cones, round boxes,
              tori, lathe profiles), smooth CSG (smin/smax), 3D gradient noise, narrow-band grid
              evaluation, a surface-nets mesher -> Blender mesh
    sculpt    mesh-level sculpting: voxel remesh, subdivision, Laplacian/Corrective smoothing,
              numpy displacement (cloth folds, seams, wraps, stone chipping, wood grain) masked by
              vertex groups from bone proximity / joints / curvature
    anatomy   heroic stylized anatomy as smooth-blended volumes placed on the rig (VALE_BIPED_1)
    drape     cloth simulation in background mode: pleated panels pinned at belts/shoulders,
              draped against a body collider, baked, applied, then thickness + hems
    hard      hard-surface pieces: lathe shells, slabs, bevel + weighted normals, boolean carving
              (grooves, windows, hour-line engravings), straps/wraps shrinkwrapped to a surface
    retopo    high -> low per part (QuadriFlow or decimation to a tri budget), UVs, part ids
    bakes     Cycles bakes high -> low (exploded): tangent normal, object normal, AO (detail and
              global), edge/cavity masks, material ids, positions
    paint     numpy hand-painted albedo from the bakes (palette regions, AO, chalky edges, cavity,
              value gradient, painted key light, hue/value variation, brush strokes) + ORM
    paintfx   image-space painterly filters (anisotropic Kuwahara, stroke flow) for key art
    rigbind   binding to VALE_BIPED_1: heat weights + cleanup, rigid pieces, x_ drape chains
    motion    clip helpers on top of common.anim (arcs, springs, level-keeping)
    keyart    splash / portrait / icon / turntable / comparison renders (illustration grade)
    pipeline  the staged, cached fighter build (sculpt -> drape -> lows -> bakes -> paint -> rig ->
              clips -> GLB -> renders), driven by a fighter spec (art/blender/fighters/<id>.py)

Every module runs inside blender.exe (5.1/5.2) and with the `bpy` wheel (python3); only numpy is
used besides bpy. See art/ART2.md for the method, the per-fighter recipe and measured timings.
"""
import bpy  # noqa: F401  (the bpy wheel registers mathutils on import)
