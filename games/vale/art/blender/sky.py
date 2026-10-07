"""Build one sky HDR from art/blender/sky_presets.json.

    python3 art/build.py sky <id>        (or: blender -b --factory-startup --python sky.py -- --id <id>)

Writes art/out/<preset.out or maps/<id>/sky.hdr>, a tonemapped QA preview to
art/renders/skies/<id>.png and timings to art/renders/skies/<id>.json.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402,F401  (first: the bpy wheel registers mathutils on import)

from common import scene, sky  # noqa: E402


def main():
    args = scene.parse_args(lambda p: p.add_argument("--id", required=True))
    presets = scene.read_json(os.path.join(scene.BLENDER_DIR, "sky_presets.json"), {})
    if args.id not in presets:
        raise SystemExit(f"no sky preset {args.id!r} in sky_presets.json (have: {[k for k in presets if not k.startswith('_c')]})")
    p = dict(presets[args.id])
    out = os.path.join(scene.OUT_DIR, p.pop("out", f"maps/{args.id}/sky.hdr"))
    if args.fast:
        p["samples"] = 4
    prev = os.path.join(scene.RENDERS_DIR, "skies", f"{args.id}.png")
    stats = sky.build_sky(p, out, prev)
    stats["out"] = scene.rel(out)
    stats["bytes"] = os.path.getsize(out)
    scene.write_json(os.path.join(scene.RENDERS_DIR, "skies", f"{args.id}.json"), stats)


if __name__ == "__main__":
    main()
