"""Clip probe: sample a fighter's REAL clips (generated + clip_overrides, the fighter script as it stands NOW) on its
cached rig (art/.cache/fighters/<id>.blend) and write bone world positions per clip frame, without a rebuild.
Use it to iterate on key poses before spending a full build (closing review VAS-M1/M2: per-display-frame steps).

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/common/clip_probe.py -- \
        <fighter id> <out.json> [clip,clip,...] [--bones x_rod_head,hand.R,...]

Output JSON: {clip: {"frames": n, "loop": bool, "impact": f|null, "pos": {bone: [[x, y, z] per frame 0..n]}}} in glTF
axes (x his left, y up, z his front), armature space (the root not moved). No secondary motion (x_ chains are skipped).
Read it with art/tools/clip_steps.py --probe <out.json> --clip <clip> --speed <x>.
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402

from common import anim, pipeline, render, rig, scene  # noqa: E402
from common.fighter import Context  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bones = None
    if "--bones" in argv:
        i = argv.index("--bones")
        bones = argv[i + 1].split(",")
        argv = argv[:i] + argv[i + 2:]
    fid, out = argv[0], argv[1]
    want = argv[2].split(",") if len(argv) > 2 and argv[2] else None
    path = os.path.join(scene.BLENDER_DIR, "fighters", f"{fid}.py")
    s = importlib.util.spec_from_file_location(f"fighter_{fid}", path)
    spec = importlib.util.module_from_spec(s)
    sys.modules[s.name] = spec
    s.loader.exec_module(spec)
    P = pipeline.paths(spec)
    bpy.ops.wm.open_mainfile(filepath=P["cache"])
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    ctx = Context(spec=spec)
    p = rig.proportions(**(spec.PROPORTIONS or {}))
    ctx.info = rig.RigInfo(armature=arm, props=spec.PROPORTIONS, joints=rig._layout(p))
    skel = anim.Skeleton(arm)
    clips = render.fighter_clips(ctx, skel)
    names = bones or [b for b in skel.order if not b.startswith("x_") or b in ("x_rod_head", "x_halo")]
    res = {}
    for name, c in clips.items():
        if want and name not in want:
            continue
        poses = anim.sample_clip(skel, c, None)
        pos = {b: [] for b in names if b in skel.rest}
        for po in poses:
            M = skel.fk(po)
            for b in pos:
                v = M[b].translation
                pos[b].append([round(v.x, 5), round(v.z, 5), round(-v.y, 5)])      # Blender Z-up -Y-front -> glTF
        res[name] = {"frames": c.frames, "loop": c.loop, "impact": c.impact, "pos": pos}
    with open(out, "w") as f:
        json.dump(res, f)
    print(f"clip_probe: {fid}: {len(res)} clips -> {out}")


main()
