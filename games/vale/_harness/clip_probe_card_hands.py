"""Card hand-integrity probe (orch1 W2-C, FU-10): the card renders' hands, as the renderer deforms them.

_harness/clip_probe_hands.mjs covers the game clips on the shipped GLBs. The cards are rendered in Blender from the
cached rig with card-only steps on top (render.smooth_card_hands: a Laplacian smooth of the hand vertex groups after
the armature; card poses and pose_tweak). This probe poses every staged card (splash + portrait, base and each skin's
staging) on the cached base mesh, applies the same card-only modifiers, evaluates, and measures every hand triangle
(all three corners >= 0.5 of their weight on hand.L / hand.R) against the unposed, unsmoothed mesh: an edge outside
0.4-1.6x rest is a torn, spiked or crumpled hand (bd2: Burdam's carry fist, Dunsom's spiked staff hands).

    Blender -b --factory-startup --python-exit-code 1 --python _harness/clip_probe_card_hands.py -- <fid>[,<fid>...]
        [--json out.json] [--no-smooth] [--smooth 8,1.2,0.05,1]   (iterations, lambda, border, volume: the old setting)

Prints one line per card: "card <sid>:<kind> tris N out K min a max b" and a final "card-hands: ... PASS|FAIL".
"""
import importlib.util
import json
import os
import sys

GAME = os.getcwd()
sys.path.insert(0, os.path.join(GAME, "art", "blender"))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

from common import pipeline, render, rig, scene  # noqa: E402
from common.fighter import Context  # noqa: E402

LO, HI = 0.4, 1.6


def load_spec(fid):
    path = os.path.join(scene.BLENDER_DIR, "fighters", f"{fid}.py")
    s = importlib.util.spec_from_file_location(f"fighter_{fid}", path)
    spec = importlib.util.module_from_spec(s)
    sys.modules[s.name] = spec
    s.loader.exec_module(spec)
    return spec


def hand_tris(o, bones):
    groups = {g.index: g.name for g in o.vertex_groups}
    hand_ix = {i for i, n in groups.items() if n in ("hand.L", "hand.R")}
    if not hand_ix:
        return np.zeros((0, 3), int)
    nv = len(o.data.vertices)
    hw = np.zeros(nv)
    tw = np.zeros(nv)
    for v in o.data.vertices:
        for g in v.groups:
            nm = groups.get(g.group, "")
            # deform groups only (bone names); card_hide / helper groups are not weights
            if nm in bones:
                tw[v.index] += g.weight
                if g.group in hand_ix:
                    hw[v.index] += g.weight
    isv = (tw > 0) & (hw / np.maximum(tw, 1e-9) >= 0.5)
    o.data.calc_loop_triangles()
    T = np.array([t.vertices[:] for t in o.data.loop_triangles], int).reshape(-1, 3)
    return T[isv[T].all(axis=1)]


def coords(o, evaluated):
    if evaluated:
        dg = bpy.context.evaluated_depsgraph_get()
        e = o.evaluated_get(dg)
        m = e.to_mesh()
        n = len(m.vertices)
        co = np.empty(n * 3)
        m.vertices.foreach_get("co", co)
        e.to_mesh_clear()
    else:
        n = len(o.data.vertices)
        co = np.empty(n * 3)
        o.data.vertices.foreach_get("co", co)
    return co.reshape(-1, 3)


def edges(co, T):
    a, b, c = co[T[:, 0]], co[T[:, 1]], co[T[:, 2]]
    return np.stack([np.linalg.norm(a - b, axis=1), np.linalg.norm(b - c, axis=1), np.linalg.norm(c - a, axis=1)], 1)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    fids = argv[0].split(",")
    out_json = argv[argv.index("--json") + 1] if "--json" in argv else None
    smooth = "--no-smooth" not in argv
    if "--smooth" in argv:
        a = argv[argv.index("--smooth") + 1].split(",")
        render.HAND_SMOOTH = (int(a[0]), float(a[1]), float(a[2]), bool(int(a[3])))
    print(f"card hand smooth: {render.HAND_SMOOTH if smooth else 'off'}")
    res = {}
    bad_all = 0
    for fid in fids:
        spec = load_spec(fid)
        P = pipeline.paths(spec)
        bpy.ops.wm.open_mainfile(filepath=P["cache"])
        arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
        ctx = Context(spec=spec)
        p = rig.proportions(**(spec.PROPORTIONS or {}))
        ctx.info = rig.RigInfo(armature=arm, props=spec.PROPORTIONS, joints=rig._layout(p))
        objs = [o for o in bpy.context.scene.objects if o.type == "MESH" and any(
            m.type == "ARMATURE" for m in o.modifiers) and not o.hide_render]
        clips = render.fighter_clips(ctx)
        chains = spec.chain_config(ctx) if hasattr(spec, "chain_config") else None
        # rest: armature modifiers off, no smoothing
        rest = {}
        tris = {}
        for o in objs:
            T = hand_tris(o, {b.name for b in arm.data.bones})
            if len(T):
                tris[o.name] = T
                rest[o.name] = edges(coords(o, False), T)
        mods = render.smooth_card_hands(objs, smooth)
        skins = [None] + list(getattr(spec, "SKINS", []) or [])
        for skin in skins:
            sid = (skin or {}).get("id") or fid
            cfg = render._splash_cfg(spec, skin)
            pcfg = render._portrait_cfg(spec, skin, cfg)
            for kind, c in (("splash", cfg), ("portrait", pcfg)):
                try:
                    render.pose_frame(arm, spec.MOTION, c["clip"], t=c["t"], chains=chains, clips=clips)
                except KeyError as e:
                    print(f"card {sid}:{kind} skipped: no clip {e}")
                    continue
                render.pose_tweak(arm, c)
                bpy.context.view_layer.update()
                n = out = 0
                lo, hi = 9.0, 0.0
                worst = []
                for o in objs:
                    if o.name not in tris:
                        continue
                    E = edges(coords(o, True), tris[o.name])
                    R = rest[o.name]
                    ok = R > 1e-5
                    r = E[ok] / R[ok]
                    n += len(tris[o.name])
                    if r.size:
                        lo, hi = min(lo, float(r.min())), max(hi, float(r.max()))
                        out += int(((r < LO) | (r > HI)).sum())
                key = f"{sid}:{kind}"
                res[key] = {"tris": n, "out": out, "min": round(lo, 3), "max": round(hi, 3)}
                bad_all += out
                print(f"card {key:34s} tris {n:5d} out {out:5d} min {lo:.3f} max {hi:.3f} ({c['clip']} t {c['t']})")
        for o, md in mods:
            o.modifiers.remove(md)
    print(f"card-hands: {len(res)} cards, {bad_all} hand edges outside {LO}-{HI}x rest -> {'FAIL' if bad_all else 'PASS'}")
    if out_json:
        with open(out_json, "w") as f:
            json.dump({"smooth": smooth, "bad": bad_all, "cards": res}, f, indent=1)


main()
