"""W3-B motion pass (ruling 68): add or replace named clips in a SHIPPED fighter GLB without a rebuild.

The fighter's REAL clip set (anim.standard_clips + the spec's clip_overrides, as the script stands now) is sampled on its
cached rig (art/.cache/fighters/<id>.blend, the snapshot every build writes), the requested clips are written as actions,
and the armature alone (no mesh) is exported to a small animation GLB. art/blender/fighters/_motion_merge.mjs then copies
those animations into the shipped GLB by node name (dedup, rest-track drop, resample 1e-4 and int16 rotations, as the
build's optimize does); no texture, mesh or other clip of the shipped file changes, so card images and skins are
untouched (skins read the base model's clips by bone name).

    Blender -b --factory-startup --python-exit-code 1 --python art/blender/fighters/_motion_pass.py -- \
        <fighter id> <out_anim.glb> walk[,attack1,...] [--loa attack1:18:2,cast_ult:24:2]
--loa re-keys a clip's line of action (anim.line_of_action: extra counter-twist in degrees, impact hold in frames).

Secondary motion runs on the x_<chain>_<n> bones grouped by chain (the spec's chain_config when it has one).
"""
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import bpy  # noqa: E402

from common import anim, export, pipeline, render, rig, scene  # noqa: E402
from common.fighter import Context  # noqa: E402


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    loa = {}
    if "--loa" in argv:
        # FU-8: clip:twist_deg:hold_frames,... (anim.line_of_action over the fighter's own clip)
        i = argv.index("--loa")
        for item in argv[i + 1].split(","):
            c, tw, hf = item.split(":")
            loa[c] = (float(tw), int(hf))
        argv = argv[:i] + argv[i + 2:]
    fid, out, want = argv[0], argv[1], argv[2].split(",")
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
    groups: dict = {}
    for b in arm.data.bones:
        m = re.match(r"^x_(.+)_(\d+)$", b.name)
        if m:
            groups.setdefault(m.group(1), []).append((int(m.group(2)), b.name))
    ctx.chains = {k: [n for _, n in sorted(v)] for k, v in groups.items()}
    skel = anim.Skeleton(arm)
    clips = render.fighter_clips(ctx, skel)
    missing = [c for c in want if c not in clips]
    if missing:
        raise SystemExit(f"{fid}: no clip {missing}")
    chains = spec.chain_config(ctx) if hasattr(spec, "chain_config") else pipeline.default_chains(ctx)
    # only the requested clips go out: every other action is dropped from this throwaway session first
    ad = arm.animation_data
    if ad:
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
        ad.action = None
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    sel = {c: (anim.line_of_action(clips[c], *loa[c]) if c in loa else clips[c]) for c in want}
    info = anim.write_clips(arm, sel, chains)
    export.export_glb([arm], out, animations=True)
    print("motion_pass:", fid, json.dumps(info))


main()
