"""Kemdo motion QA on the build's cached .blend: re-samples the CURRENT clip code of fighters/kemdo.py onto the
cached rig + skinned mesh (no rebuild needed while the rig and the mesh are unchanged) and measures, per clip:
  lgap    the left palm (prop.L head) to the glaive's axis (two-hand grips: want < 0.05 m)
  body    the lowest body vertex (no glaive), glaive: the lowest glaive vertex (m; floor = 0)
  haft    the closest glaive-haft sample to a torso vertex (shirt / wrap / robe / belt / panel)
  stretch per part, the worst edge length ratio against the bind pose (max, min)
and optionally renders workbench pose sheets of the re-sampled clips.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/blender/proto/kemdo_qa.py -- \
        [--clips cast_a1,cast_ult] [--frames all|keys] [--render front,side,game] [--out <png>]
"""
from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from types import SimpleNamespace

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from common import anim, scene  # noqa: E402
from common.hifi import project  # noqa: E402

TORSO = ("shirt", "wrap", "robe", "belt", "panel", "cowl")
GLAIVE = ("glaive_",)


def args():
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--clips", default="")
    p.add_argument("--frames", default="all")
    p.add_argument("--render", default="")
    p.add_argument("--cell", type=int, default=220)
    p.add_argument("--samples", type=int, default=8)
    p.add_argument("--ts", default="")
    p.add_argument("--debug", default="", help="clip:frame -> list the worst edges with their weights")
    p.add_argument("--out", default=os.path.join(scene.CACHE_DIR, "_fit", "kemdo_qa.png"))
    p.add_argument("--json", default=os.path.join(scene.CACHE_DIR, "_fit", "kemdo_qa.json"))
    return p.parse_args(scene.script_args())


def load_spec():
    path = os.path.join(os.path.dirname(HERE), "fighters", "kemdo.py")
    spec = importlib.util.spec_from_file_location("kemdo_spec", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    a = args()
    bpy.ops.wm.open_mainfile(filepath=os.path.join(scene.CACHE_DIR, "fighters", "kemdo.blend"))
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.type == "ARMATURE")
    body = sc.objects["kemdo"]
    K = load_spec()
    ctx = SimpleNamespace(info=SimpleNamespace(armature=arm), chains={})
    clips = K.clip_overrides(ctx)
    if a.clips:
        clips = {k: v for k, v in clips.items() if k in a.clips.split(",")}
    anim.write_clips(arm, clips, [])
    names = json.load(open(os.path.join(scene.CACHE_DIR, "fighters", "kemdo_parts.json")))
    me = body.data
    pid = np.empty(len(me.vertices), dtype=np.int64)
    me.attributes["vale_part"].data.foreach_get("value", pid)
    pname = np.array([names[i] if i < len(names) else "?" for i in range(max(pid) + 1)])
    vname = pname[pid]
    is_gl = np.array([n.startswith(GLAIVE) for n in vname])
    is_torso = np.isin(vname, TORSO)
    is_hl = vname == "hand_L"
    is_haft = np.isin(vname, ("glaive_haft", "glaive_wrap"))
    ed = np.empty(len(me.edges) * 2, dtype=np.int64)
    me.edges.foreach_get("vertices", ed)
    ed = ed.reshape(-1, 2)
    rest = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", rest)
    rest = rest.reshape(-1, 3)
    L0 = np.linalg.norm(rest[ed[:, 0]] - rest[ed[:, 1]], axis=1)
    ok_e = L0 > 0.004
    epart = vname[ed[:, 0]]
    parts_e = sorted(set(epart))
    dg = bpy.context.evaluated_depsgraph_get()
    out = {}
    for clip in clips:
        act = bpy.data.actions[clip]
        n = int(round(act.frame_range[1] - act.frame_range[0]))
        rows = []
        for f in range(n + 1):
            anim.set_action_frame(arm, clip, f)
            dg.update()
            ev = body.evaluated_get(dg)
            m2 = ev.to_mesh()
            co = np.empty(len(m2.vertices) * 3)
            m2.vertices.foreach_get("co", co)
            ev.to_mesh_clear()
            co = co.reshape(-1, 3)
            co = co @ np.array(body.matrix_world.to_3x3()).T + np.array(body.matrix_world.translation)
            pbR = arm.pose.bones["prop.R"].matrix
            pbL = arm.pose.bones["prop.L"].matrix
            o = np.array(arm.matrix_world @ pbR.translation)
            ax = np.array((arm.matrix_world.to_3x3() @ pbR.to_3x3()).col[1].normalized())
            pl = np.array(arm.matrix_world @ pbL.translation)
            q = pl - o
            lgap = float(np.linalg.norm(q - ax * q.dot(ax)))
            hl = co[is_hl].mean(0) - o
            lgap_mesh = float(np.linalg.norm(hl - ax * hl.dot(ax)))
            # haft samples (axis from the butt to the throat) vs the torso
            hs = o + np.outer(np.linspace(-1.1, 0.70, 40), ax)
            tv = co[is_torso]
            d = np.min(np.linalg.norm(tv[None, :, :] - hs[:, None, :], axis=2))
            # the haft vs the torso core (the hips -> chest bone line): < ~0.16 m is inside the body
            hb = arm.pose.bones
            c0 = np.array(arm.matrix_world @ hb["hips"].head)
            c1 = np.array(arm.matrix_world @ hb["chest"].tail)
            cs = c0 + np.outer(np.linspace(0, 1, 24), c1 - c0)
            core = float(np.min(np.linalg.norm(hs[:, None, :] - cs[None, :, :], axis=2)))
            Lf = np.linalg.norm(co[ed[:, 0]] - co[ed[:, 1]], axis=1)
            r = np.where(ok_e, Lf / np.maximum(L0, 1e-6), 1.0)
            worst = []
            for pn in parts_e:
                m = (epart == pn) & ok_e
                if not m.any():
                    continue
                worst.append((pn, float(r[m].max()), float(r[m].min()), int((r[m] > 1.8).sum()), int((r[m] < 0.45).sum())))
            if a.debug and a.debug == f"{clip}:{f}":
                debug_edges(body, ed, r, ok_e, rest, vname)
            rows.append({"f": f, "lgap": round(lgap, 3), "lgap_mesh": round(lgap_mesh, 3),
                         "body": round(float(co[~is_gl, 2].min()), 3), "low": str(vname[~is_gl][np.argmin(co[~is_gl, 2])]), "glaive": round(float(co[is_gl, 2].min()), 3),
                         "haft": round(float(d), 3), "core": round(core, 3), "stretch": worst})
        out[clip] = rows
        smax = {}
        for r_ in rows:
            for pn, mx, mn, nb, ns in r_["stretch"]:
                s = smax.setdefault(pn, [0, 9, 0, 0, 0])
                if mx > s[0]:
                    s[0], s[4] = mx, r_["f"]
                s[1] = min(s[1], mn)
                s[2] = max(s[2], nb)
                s[3] = max(s[3], ns)
        bad = {k: v for k, v in smax.items() if v[0] > 1.8 or v[1] < 0.45}
        lg = [r_["lgap"] for r_ in rows]
        print(f"== {clip} ({n} f) lgap {min(lg):.2f}-{max(lg):.2f} | body min {min(r_['body'] for r_ in rows):.3f} "
              f"| glaive min {min(r_['glaive'] for r_ in rows):.3f} | haft-torso min {min(r_['haft'] for r_ in rows):.3f}")
        print("   lgap/f: " + " ".join(f"{r_['f']}:{r_['lgap']:.2f}" for r_ in rows[::max(1, n // 25)]))
        print("   body/f: " + " ".join(f"{r_['f']}:{r_['body']:.2f}/{r_['glaive']:.2f}" for r_ in rows[::max(1, n // 25)]))
        print("   low<0: " + " ".join(f"{r_['f']}:{r_['body']:.3f}({r_['low']})" for r_ in rows if r_["body"] < -0.004))
        print("   core<0.17: " + " ".join(f"{r_['f']}:{r_['core']:.2f}" for r_ in rows if r_["core"] < 0.17))
        for k, v in sorted(bad.items(), key=lambda kv: -kv[1][0]):
            print(f"   stretch {k:12s} max {v[0]:.2f} (f{v[4]}) min {v[1]:.2f} n>1.8 {v[2]} n<0.45 {v[3]}")
    os.makedirs(os.path.dirname(a.json), exist_ok=True)
    json.dump(out, open(a.json, "w"))
    if a.render:
        render_sheet(a, sc, arm, list(clips))


def debug_edges(body, ed, r, ok_e, rest, vname):
    gname = {g.index: g.name for g in body.vertex_groups}
    me = body.data

    def wts(i):
        return ", ".join(f"{gname[g.group]}:{g.weight:.2f}" for g in sorted(me.vertices[i].groups, key=lambda g: -g.weight)
                         if g.weight > 0.05)
    score = np.where(ok_e, np.maximum(r, 1.0 / np.maximum(r, 1e-3)), 0)
    for e in np.argsort(-score)[:24]:
        i, j = ed[e]
        mid = (rest[i] + rest[j]) / 2
        print(f"  edge {vname[i]:10s} r={r[e]:.2f} at ({mid[0]:+.3f},{mid[1]:+.3f},{mid[2]:.3f}) | {wts(i)} || {wts(j)}")


def render_sheet(a, sc, arm, clips):
    for o in sc.objects:
        if o.type == "MESH":
            o.hide_render = not (o.name in ("kemdo", "kemdo_accent") or o.name.startswith("form_"))
        elif o.type in ("LIGHT", "CAMERA"):
            o.hide_render = True
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "TEXTURE"
    sh.show_shadows = False
    sh.show_cavity = True
    sc.render.film_transparent = True
    sc.view_settings.view_transform = "Standard"
    cam = bpy.data.cameras.new("qc")
    co = bpy.data.objects.new("qc", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.resolution_x = sc.render.resolution_y = a.cell
    # a ground line: a thin dark plane at z=0 seen edge-on in the ortho views
    views = {"front": ((0.0, -8.0, 1.1), "O"), "side": ((8.0, 0.0, 1.1), "O"), "back": ((0.0, 8.0, 1.1), "O"),
             "rside": ((-8.0, 0.0, 1.1), "O"),
             "game": ((-3.5, -5.5, 1.0 + 6.5 * math.tan(math.radians(52))), "P"),
             "top": ((0.0, -0.01, 9.0), "O")}
    rows = []
    for clip in clips:
        act = bpy.data.actions[clip]
        f0, f1 = act.frame_range
        n = int(round(f1 - f0))
        if a.ts:
            ts = [float(x) for x in a.ts.split(",")]
        else:
            ts = [0, 0.12, 0.24, 0.32, 0.4, 0.52, 0.7, 1] if clip.startswith(("attack", "cast")) else [i / 7 for i in range(8)]
        for v in a.render.split(","):
            loc, kind = views[v]
            co.location = loc
            if kind == "O":
                cam.type = "ORTHO"
                cam.ortho_scale = 3.6 if v != "top" else 3.8
            else:
                cam.type = "PERSP"
                cam.lens = 50
            if v == "game":
                tgt = Vector((0.0, -0.2, 1.0))
            elif v == "top":
                tgt = Vector((0.0, 0.0, 0.0))
            else:
                tgt = Vector((0.0, 0.0, 1.1))
            co.rotation_euler = (tgt - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
            row = []
            for t in ts:
                anim.set_action_frame(arm, clip, f0 + t * n)
                path = os.path.join(scene.CACHE_DIR, "_fit", "qa_cell.png")
                sc.render.filepath = path
                bpy.ops.render.render(write_still=True)
                img = bpy.data.images.load(path)
                px = np.empty(a.cell * a.cell * 4, dtype=np.float32)
                img.pixels.foreach_get(px)
                bpy.data.images.remove(img)
                rgba = px.reshape(a.cell, a.cell, 4)[::-1]
                bg = np.full((a.cell, a.cell, 3), 0.42 if v != "game" else 0.62, dtype=np.float32)
                c = rgba[..., :3] * rgba[..., 3:4] + bg * (1 - rgba[..., 3:4])
                if kind == "O" and v != "top":                     # the floor line (z = 0)
                    gy = int(round(a.cell / 2 + (1.1 - 0.0) / cam.ortho_scale * a.cell))
                    if 0 <= gy < a.cell:
                        c[gy, :] = (0.9, 0.2, 0.2)
                c[:, -1] = 0.2
                c[-1, :] = 0.2
                row.append(c)
            rows.append(np.concatenate(row, axis=1))
    project.save_rgb(np.clip(np.concatenate(rows, axis=0), 0, 1), a.out)
    print(f"wrote {a.out}")


if __name__ == "__main__":
    main()
