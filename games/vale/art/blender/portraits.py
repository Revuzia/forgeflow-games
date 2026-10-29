"""Re-render portrait / splash / icon / turntable for fighters from their cached .blend
(art/.cache/fighters/<id>.blend, written by every fighter build) without rebuilding or baking.

    python3 art/build.py portraits            # every cached fighter
    python3 art/build.py portraits <id> [--fast]
    python3 art/build.py portraits <id> --only splash --scale 0.5   # PREVIEW (art/renders/.../preview_*.png)

Skin portraits/splashes need the skin's materials and extras. The fighter build renders them
(`build.py fighter <id> --skin <skin>`), and so does this script without a rebuild: `--skins` imports each
shipped skin GLB (art/out/fighters/<id>/<skin>.glb: the skin's own meshes, baked textures and extras),
binds its meshes to the cached rig and renders <skin>_portrait.png / <skin>_splash.png:

    python3 art/build.py portraits <id> --skins [--no-base] [--skin <skin>] --only splash,portrait

PER-SKIN CARD STAGING (closing review, CW5 cards pipeline; CW6 stages its fighters the same way)
Every card (the base and each skin) gets its own splash moment, camera and light, and its portrait derives from it.
The staging is a module-level literal in the fighter's script, art/blender/fighters/<id>.py (a plain dict literal:
plates.py reads it with ast, without bpy, so no names or expressions in it):

    CARDS = {
        "<id>": {                                   # the base card; a skin's key is its skin id
            "splash": {
                "clip": "victory", "t": 0.92,       # the moment: a shipped clip and its time (0..1)
                "yaw": 30.0, "pitch": -6.0,         # camera bearing (deg, + = toward the fighter's left) and pitch
                "lens": 55.0, "fill": 0.88, "x": 0.71,   # framing: subject height / frame, its centre across (16:9)
                "key_az": 205.0, "key_el": 22.0,    # the plate-sun key, view-relative (180 = behind the camera)
                "key_color": "#FFD9B0", "sun": 3.0, # its colour (else the plate's dusk key) and strength (3 = map)
                "rim_cool": 1.2, "rim_warm": 0.8,   # the rim pair (x the plate's own weights)
                "bounce": 0.6, "bounce_color": "#E2B48A",       # floor bounce (x 400 W), 0 = none
                "focal": [{"at": "x_halo", "az": 160.0, "el": 35.0, "dist": 0.8, "color": "#FFE0B0",
                           "power": 90.0, "size": 0.3}],        # focal lights: an area light aimed at a bone
                "accent": 1.6,                      # x the accent emission for this card (lit bells, a hot core)
                "exposure": -0.5,                   # EV of the subject pass (render.CARD_EXPOSURE by default)
                "samples": 128},                    # render.CARD_SAMPLES by default
            "portrait": {"yaw": 28.0},              # the bust: the splash's clip / t / light, then these keys
                                                    # (clip, t, yaw, any light key; pitch / lens / fill / x only
                                                    # when the fighter's own wrappers do not key off them)
            "plate": {"src": "aubade_dawn", "glow": [0.2, 0.6, 0.4, 0.1], "median": 0.30},   # plates.params keys
        },
    }

An image with no CARDS entry renders as before (the shared SPLASH, the idle_lobby portrait). Every card render
(staged or not) now: renders the subject at 2x the card's pixels (render.CARD_SS) with 128 samples and Cycles'
OpenImageDenoise (albedo + normal guides, CPU), reduced premultiplied; exposes it CARD_EXPOSURE (-0.5 EV) so a pale
kit keeps highlight headroom; the composite (plates.finish) brushes the subject with the plate's Kuwahara at radius
sub_paint_r (1 px at 1600) and expands its top 5 % so its p99.7 reaches display 0.93 (sub_hi: highlights at luma
>= 230 after the LUT); the shadow catcher keeps the contact shadow. Measure the cards with
    python3 art/tools/card_qa.py <id> [...] --out _harness/_reports/<name>.txt
(grain: figure vs plate blocks; highlights p99.9 >= 230; figure-box MAD of each skin vs its base >= 30; framing).
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


_SPECS: dict = {}


def load_spec(fid: str):
    """The fighter module, executed ONCE per process: many modules install wrappers on the shared render module
    when they load (a second load would stack them, e.g. a camera-pitch nudge applied twice)."""
    if fid in _SPECS:
        return _SPECS[fid]
    path = os.path.join(scene.BLENDER_DIR, "fighters", f"{fid}.py")
    s = importlib.util.spec_from_file_location(f"fighter_{fid}", path)
    m = importlib.util.module_from_spec(s)
    sys.modules[s.name] = m          # (W5b: a fighter module with a @dataclass needs itself in sys.modules)
    s.loader.exec_module(m)
    _SPECS[fid] = m
    return m


def render_cached(fid: str, fast: bool, only=None, scale: float = 1.0) -> dict:
    spec = load_spec(fid)
    P = pipeline.paths(spec)
    bpy.ops.wm.open_mainfile(filepath=P["cache"])
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    ctx = Context(spec=spec)
    # the joints a build's rig carries (clip overrides read them, e.g. Ervet's guard pose needs palm.R)
    p = rig.proportions(**(spec.PROPORTIONS or {}))
    ctx.info = rig.RigInfo(armature=arm, props=spec.PROPORTIONS, joints=rig._layout(p))
    chains = {}
    for b in arm.data.bones:
        m = re.match(r"x_(.+)_(\d+)$", b.name)
        if m:
            chains.setdefault(m.group(1), []).append((int(m.group(2)), b.name))
    ctx.chains = {k: [n for _, n in sorted(v)] for k, v in chains.items()}
    objs = [arm] + [o for o in bpy.context.scene.objects if o.type == "MESH" and o.parent == arm and not o.hide_render]
    return render.fighter_renders(ctx, objs, P, None, fast=fast, only=only, scale=scale)


def render_skin_cached(fid: str, sid: str, fast: bool, only=None, scale: float = 1.0) -> dict:
    """<skin>_splash.png / <skin>_portrait.png from the cached base rig and the shipped skin GLB (no rebuild, no
    bake): the GLB's meshes (the skin's geometry, extras and baked textures) are bound to the cached armature, so
    the base clips pose them exactly as the fighter build's skin pass would."""
    spec = load_spec(fid)
    skin = next((s for s in (getattr(spec, "SKINS", None) or []) if s["id"] == sid), None)
    if skin is None:
        raise SystemExit(f"{fid}: unknown skin {sid!r}")
    P = pipeline.paths(spec)
    glb = os.path.join(P["out"], f"{sid}.glb")
    if not os.path.isfile(glb):
        raise SystemExit(f"{sid}: no {scene.rel(glb)} (build the skin first)")
    bpy.ops.wm.open_mainfile(filepath=P["cache"])
    arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
    for m in bpy.data.materials:              # the skin's materials keep their own names (render tweaks look them up)
        m.name = f"{m.name}__base"
    for g in bpy.data.node_groups:            # the cache's glTF settings group predates this importer's inputs
        if g.name.startswith(("glTF Settings", "glTF Material Output")):
            g.name = f"{g.name}__base"
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=glb)
    new = [o for o in bpy.data.objects if o not in before]
    imp_arms = [o for o in new if o.type == "ARMATURE"]
    # the skinned meshes only (the importer also adds an unparented "Icosphere" bone-display shape)
    meshes = [o for o in new if o.type == "MESH" and any(md.type == "ARMATURE" for md in o.modifiers)]
    # the GLB's bind pose must be the cached rig's rest pose (else the skin was built on another rig)
    worst = 0.0
    for ia in imp_arms:
        for b in ia.data.bones:
            cb = arm.data.bones.get(b.name)
            if cb is not None:
                d = (ia.matrix_world @ b.head_local) - (arm.matrix_world @ cb.head_local)
                worst = max(worst, d.length)
    scene.log(f"{sid}: {len(meshes)} meshes from the GLB, bind pose vs cached rest: max {worst * 1000:.1f} mm")
    if worst > 0.01:
        scene.log(f"WARNING {sid}: the skin's bind pose differs from the cached rig by {worst * 1000:.0f} mm")
    for m in meshes:
        mw = m.matrix_world.copy()
        m.parent = arm
        m.matrix_parent_inverse.identity()
        m.matrix_world = mw
        for md in m.modifiers:
            if md.type == "ARMATURE":
                md.object = arm
        m.hide_render = False
    for o in new:
        if o not in meshes:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o not in meshes:
            o.hide_render = True
    ctx = Context(spec=spec, skin=skin)
    p = rig.proportions(**(spec.PROPORTIONS or {}))
    ctx.info = rig.RigInfo(armature=arm, props=spec.PROPORTIONS, joints=rig._layout(p))
    chains = {}
    for b in arm.data.bones:
        mm = re.match(r"x_(.+)_(\d+)$", b.name)
        if mm:
            chains.setdefault(mm.group(1), []).append((int(mm.group(2)), b.name))
    ctx.chains = {k: [n for _, n in sorted(v)] for k, v in chains.items()}
    only = set(only or {"splash", "portrait"}) & {"splash", "portrait"}
    if not only:
        return {"files": {}, "seconds": {}}
    return render.fighter_renders(ctx, [arm] + meshes, P, skin, fast=fast, only=only, scale=scale)


def main():
    def extra(p):
        p.add_argument("ids", nargs="*")
        p.add_argument("--scale", type=float, default=1.0, help="!= 1: preview renders (shipped files untouched)")
        p.add_argument("--skins", action="store_true", help="also render every skin from its shipped GLB")
        p.add_argument("--skin", default="", help="only this skin (implies --skins)")
        p.add_argument("--no-base", action="store_true", help="skins only")
    args = scene.parse_args(extra)
    only = {x for x in args.only.split(",") if x} or None
    ids = args.ids or [os.path.splitext(os.path.basename(p))[0]
                       for p in sorted(glob.glob(os.path.join(scene.CACHE_DIR, "fighters", "*.blend")))]
    if not ids:
        print("[vale-art] no cached fighters in art/.cache/fighters - build a fighter first")
    for fid in ids:
        if not args.no_base:
            res = render_cached(fid, args.fast, only, args.scale)
            scene.log(f"portraits {fid}: {res['seconds']}")
        if args.skins or args.skin:
            spec = load_spec(fid)
            for s in (getattr(spec, "SKINS", None) or []):
                if args.skin and s["id"] != args.skin:
                    continue
                res = render_skin_cached(fid, s["id"], args.fast, only, args.scale)
                scene.log(f"portraits {s['id']}: {res['seconds']}")


if __name__ == "__main__":
    main()
