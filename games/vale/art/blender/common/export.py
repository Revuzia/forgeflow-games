"""glTF (GLB) export + gltf-transform optimisation.

Exporter settings (Blender 5.2 io_scene_gltf2), chosen for three.js r186 GLTFLoader:
  * GLB, +Y up (Blender (x, y, z) -> glTF (x, z, -y)), selected objects only, modifiers applied
    (the Armature modifier is kept as a skin), max 4 influences, all bones as joints.
  * Animations: export_animation_mode='ACTIONS' -> EVERY action bound to the armature becomes
    its own glTF animation named after the action (no NLA merging). Sampled at 30 fps
    (force sampling), optimize_animation_size on. Rest pose = armature rest (A-pose).
  * No lights, no cameras. Tangents off (three derives the tangent frame in the shader).
  * Images: AUTO keeps each image's own format — bake.py saves base colour as JPEG q90 and the
    ORM / normal data maps as PNG, so they embed exactly like that.
  * Maps: export_gpu_instances=True writes EXT_mesh_gpu_instancing for objects that share mesh
    data under an instancing collection (see `instance_scatter`). three.js r186 GLTFLoader reads
    EXT_mesh_gpu_instancing natively (InstancedMesh).

Then `optimize()` runs art/tools/optimize.mjs (gltf-transform: dedup, prune, resample, drop
constant rest tracks; optional KHR_mesh_quantization which three reads natively — no decoders).
"""
from __future__ import annotations

import os
import shutil
import subprocess

import bpy

from . import scene


def export_glb(objects, path: str, animations: bool = True, instancing: bool = False,
               extras: bool = True) -> str:
    scene.ensure_dir(os.path.dirname(path))
    sc = bpy.context.scene
    sc.render.fps = scene.FPS
    for o in sc.objects:
        o.select_set(False)
    for o in objects:
        o.hide_set(False)
        o.hide_viewport = False
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    arm = next((o for o in objects if o.type == "ARMATURE"), None)
    if arm is not None:
        if arm.animation_data:
            arm.animation_data.action = None
        for pb in arm.pose.bones:
            pb.location = (0, 0, 0)
            pb.rotation_euler = (0, 0, 0)
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.scale = (1, 1, 1)
    sc.frame_set(0)
    kw = dict(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_texcoords=True, export_normals=True, export_tangents=False,
        export_materials="EXPORT", export_image_format="AUTO", export_jpeg_quality=90,
        export_image_quality=90, export_cameras=False, export_lights=False, export_extras=extras,
        export_skins=True, export_influence_nb=4, export_all_influences=False, export_def_bones=False,
        export_leaf_bone=False, export_rest_position_armature=True, export_morph=False,
        export_animations=animations, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_frame_step=1, export_frame_range=False, export_optimize_animation_size=True,
        export_anim_single_armature=True, export_reset_pose_bones=True, export_anim_slide_to_zero=False,
        export_bake_animation=False, export_gpu_instances=instancing, export_unused_images=False,
        export_unused_textures=False, export_vertex_color="NONE",
    )
    # options are filtered against the exporter this Blender ships (5.1 and 5.2 differ slightly)
    bpy.ops.export_scene.gltf(**scene.op_kwargs(bpy.ops.export_scene.gltf, **kw))
    return path


def node_exe() -> str | None:
    return shutil.which("node") or shutil.which("node.exe")


def optimize(path: str, out: str | None = None, quantize: bool = False) -> dict:
    """Run art/tools/optimize.mjs in place (or to `out`). Returns {'ok', 'before', 'after'}."""
    out = out or path
    script = os.path.join(scene.TOOLS_DIR, "optimize.mjs")
    node = node_exe()
    before = os.path.getsize(path)
    if not node or not os.path.isfile(script):
        scene.log("optimize: node or optimize.mjs missing - GLB left as exported")
        return {"ok": False, "before": before, "after": before}
    args = [node, script, path, out] + (["--quantize"] if quantize else [])
    r = subprocess.run(args, cwd=scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        scene.log(f"optimize failed ({r.returncode}): {r.stderr.strip()[:800]}")
        return {"ok": False, "before": before, "after": before, "error": r.stderr[-800:]}
    scene.log(r.stdout.strip())
    return {"ok": True, "before": before, "after": os.path.getsize(out)}


def instance_scatter(src_obj, matrices, name: str, col) -> list:
    """Scatter `src_obj` with linked mesh data at `matrices` (world) into `col`. With
    export_gpu_instances=True the exporter collapses objects sharing one mesh under a common
    parent into a single node with EXT_mesh_gpu_instancing."""
    parent = bpy.data.objects.new(name, None)
    scene.link(parent, col)
    objs = []
    for i, m in enumerate(matrices):
        o = bpy.data.objects.new(f"{name}_{i:04d}", src_obj.data)
        scene.link(o, col)
        o.matrix_world = m
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
        objs.append(o)
    return [parent] + objs


def three_qa(glb: str, out_png: str, clips: bool = False, sky: str | None = None, cell: int | None = None) -> dict:
    """Render `glb` with the real three.js r186 renderer (art/tools/three_snapshot.mjs: headless
    Chromium + SwiftShader). Returns the tool's JSON report ({facing, heightPx1080, accentPct, ...})
    or {'ok': False, 'skipped': reason}. Optional like optimise: needs node + a Chromium."""
    import glob as _glob
    import json as _json
    script = os.path.join(scene.TOOLS_DIR, "three_snapshot.mjs")
    node = node_exe()
    if not node or not os.path.isfile(script):
        return {"ok": False, "skipped": "node or three_snapshot.mjs missing"}
    if sky is None:
        cands = sorted(_glob.glob(os.path.join(scene.OUT_DIR, "maps", "*", "sky.hdr"))) + \
            [os.path.join(scene.OUT_DIR, "_proof", "sky.hdr")]
        sky = next((c for c in cands if os.path.isfile(c)), None)
    args = [node, script, glb, out_png] + (["--sky", sky] if sky else []) + (["--clips"] if clips else []) + \
        (["--cell", str(cell)] if cell else [])
    r = subprocess.run(args, cwd=scene.GAME_DIR, capture_output=True, text=True, encoding="utf-8")
    line = next((ln for ln in r.stdout.splitlines() if ln.startswith("[three-snap] {")), None)
    if line is None:
        msg = (r.stdout + r.stderr).strip()[-400:]
        scene.log(f"three QA skipped/failed: {msg}")
        return {"ok": False, "skipped": msg}
    rep = _json.loads(line[len("[three-snap] "):])
    rep["exit"] = r.returncode
    scene.log(f"three QA {os.path.basename(out_png)}: facing={rep.get('facing')} heightPx1080={rep.get('heightPx1080')} "
              f"accent={rep.get('accentPct')}% (top half {rep.get('accentTopHalfPct')}%) in {rep.get('seconds')}s")
    return rep
