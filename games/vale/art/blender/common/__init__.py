"""VALE art lane: shared Blender helpers (CONTRACT §12).

Every entry script (fighters/<id>.py, units/<id>.py, maps/<id>.py, sky.py, portraits.py) starts
with the same three lines so it runs both as `blender --background --python <file> -- args` and as
`python3 <file> -- args` with the `bpy` wheel:

    import os, sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from common import scene, rig, mesh, materials, bake, anim, export, render

Modules:
    scene      reset, units, seeds, collections, paths, timers, argument parsing
    rig        VALE_BIPED_1 armature from a proportions dict, x_ chains, prop/VFX sockets
    mesh       lofts/sweeps, skin bodies, voxel union with junction fillets, conformed armour
               plates, cloth panels, cleanup, budgets, binding (rigid + auto weights)
    materials  stylized-PBR node materials driven by a palette dict, value gradient, `accent`
    bake       UV layout, exploded selected-to-active Cycles bakes, ORM packing, glTF materials
    anim       pose library, FK/IK evaluator, easing, standard clip generators, NLA stashing
    export     glTF (GLB) export + gltf-transform optimisation
    render     Cycles portrait / splash / icon / turntable contact sheet (+ ffmpeg denoise)
    sky        equirect HDR sky with a painted procedural cloud layer
    fighter    the per-fighter pipeline that ties all of the above together
    imageops   numpy image helpers (no Pillow: Blender's Python on Windows ships without it)
"""

import bpy  # noqa: F401,E402  (with the `bpy` wheel, mathutils/bmesh exist only after bpy is imported)

# a Blender process (not the `bpy` wheel) takes one machine-wide heavy slot for its lifetime, so parallel
# agents queue instead of swapping the machine to a halt (heavy.py)
if bpy.app.background and bpy.app.binary_path:
    import os as _os, sys as _sys
    from . import heavy as _heavy
    _script = next((a for a in _sys.argv[_sys.argv.index("--python") + 1:][:1]), "") if "--python" in _sys.argv else ""
    _heavy.hold("blender:" + (_os.path.relpath(_script) if _script else "?") + " " + " ".join(_sys.argv[_sys.argv.index("--") + 1:] if "--" in _sys.argv else [])[:60])

