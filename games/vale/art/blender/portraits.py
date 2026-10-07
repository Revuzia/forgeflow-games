"""Re-render portrait / splash / icon / turntable for fighters from their cached .blend
(art/.cache/fighters/<id>.blend, written by every fighter build) without rebuilding or baking.

    python3 art/build.py portraits            # every cached fighter
    python3 art/build.py portraits <id> [--fast]

Skin portraits/splashes need the skin's materials, so they are rendered by the fighter build
(`build.py fighter <id> --skin <skin>`), not here.
"""
import glob
import importlib.util
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from common import pipeline, render, rig, scene  # noqa: E402
from common.fighter import Context  # noqa: E402


def load_spec(fid: str):
    path = os.path.join(scene.BLENDER_DIR, "fighters", f"{fid}.py")
    s = importlib.util.spec_from_file_location(f"fighter_{fid}", path)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


def render_cached(fid: str, fast: bool) -> dict:
    spec = load_spec(fid)
    P = pipeline.paths(spec)
    bpy.ops.wm.open_mainfile(filepath=P["cache"])
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    ctx = Context(spec=spec)
    ctx.info = rig.RigInfo(armature=arm, props=spec.PROPORTIONS)
    chains = {}
    for b in arm.data.bones:
        m = re.match(r"x_(.+)_(\d+)$", b.name)
        if m:
            chains.setdefault(m.group(1), []).append((int(m.group(2)), b.name))
    ctx.chains = {k: [n for _, n in sorted(v)] for k, v in chains.items()}
    objs = [arm] + [o for o in bpy.context.scene.objects if o.type == "MESH" and o.parent == arm and not o.hide_render]
    return render.fighter_renders(ctx, objs, P, None, fast=fast)


def main():
    args = scene.parse_args(lambda p: p.add_argument("ids", nargs="*"))
    ids = args.ids or [os.path.splitext(os.path.basename(p))[0]
                       for p in sorted(glob.glob(os.path.join(scene.CACHE_DIR, "fighters", "*.blend")))]
    if not ids:
        print("[vale-art] no cached fighters in art/.cache/fighters - build a fighter first")
    for fid in ids:
        res = render_cached(fid, args.fast)
        scene.log(f"portraits {fid}: {res['seconds']}")


if __name__ == "__main__":
    main()
