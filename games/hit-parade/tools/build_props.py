"""HIT PARADE - hand props pipeline driver (lane ASSETS, CONTRACT 6.4 / 17.1; CHANGED(ASSETS) 6.4 props.json).

  python tools/build_props.py                      # everything: decals, bake, grip solve, post, props.json, sheets
  python tools/build_props.py --props baton,cleaver --fast
  python tools/build_props.py --skip-bake          # re-solve grips + re-post + re-sheet from the last bake
  options: --no-sheet  --no-attach-check  --blender <exe>

Steps
  1. tools/prop_decals.py            -> art/renders/props/_build/tex (card atlas, shield lettering, gourd tag)
  2. art/blender/build_props.py      -> _build/<id>.raw.glb + baked PBR maps + props_build.json
  3. GRIP SOLVE (three.js, the view's own attach math): tools/prop_attach_check.html measures each user fighter's
     finger landmarks in the hand bone's scale-stripped frame on the clips listed in GRIPS; the rule below turns them
     into {bone, pos, rotDeg} per fighter (fist = circle fitted through the curled finger joints; palm; pinch; fan;
     shield; hip). The prop's default attach = its primary user's.
  4. tools/prop_post.mjs extras (root node extras.attach, CONTRACT 17.1) -> gltf-transform webp (q 88) -> meshopt
     -> art/gltf/props/<id>.glb  (+ _build/<id>.qc.glb, the webp copy Blender can import)
  5. art/gltf/props/props.json (CHANGED(ASSETS) 6.4 schema: bone, gripOffset, axis, scale, attach, fighters{}, tip,
     reachM, bounds, tris, bytes)
  6. art/blender/props_sheet.py      -> art/renders/props/sheet/*.png, composed into contact_sheet.png with the two
     ENV_KIT reference props under the same HDRI (art/gltf/stages/rust_theater_env.hdr)
  7. tools/prop_attach_check.py --suite -> art/renders/props/attach/<prop>_<fighter>.png (props in the hand on the
     users' real clips, game camera + close-up)
Never runs `claude -p`, no network, no paid APIs. ASCII only.
"""
import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import time

import numpy as np

TOOLS = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(TOOLS)
BLENDER = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
ENV = dict(os.environ, PYTHONIOENCODING="utf-8")
BUILD = os.path.join(GAME, "art", "renders", "props", "_build").replace("\\", "/")
TEX = BUILD + "/tex"
OUT = os.path.join(GAME, "art", "gltf", "props").replace("\\", "/")
ALL = ["brick", "riot_shield", "baton", "cleaver", "gourd", "football", "card", "card_fan", "mic_cane", "taser",
       "spotlight"]
REFS = [{"id": "ref_qfp_Chandelier", "ref": True,
         "path": "F:/games/forgeflow-games-assets/3d-models/fantasy-props-mega/Exports/glTF/Chandelier.gltf"},
        {"id": "ref_jp_JP_Conditioner_01", "ref": True,
         "path": "F:/games/unity-assets/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Models/Environment/JP_Conditioner_01.fbx",
         "albedo": "F:/games/unity-assets/Art Equilibrium__Japan Village/Assets/Japan_Village_ArtE/Source/Textures/Environment/JP_Conditioner/JP_Conditioner_A.tga"}]

# Grip design per prop. rule: fist | palm | pinch | fan | shield | hip | none. users[0] = the primary user (its solve
# is the GLB default). clips = [clip, t] poses whose finger landmarks are averaged (the weapon-holding frames).
# check = extra tiles for the in-hand verification suite (step 7).
GRIPS = {
    "brick": {"rule": "palm", "bone": "RightHand", "half": 0.0325, "projectile": True,
              "users": [{"fighter": "johnny", "clips": [["brick_throw", 0.1], ["brick_throw", 0.25]],
                         "check": [["brick_throw", 0.1], ["brick_throw", 0.3], ["brick_throw", "contact"]]}]},
    "riot_shield": {"rule": "shield", "bone": "LeftHand",
                    "users": [{"fighter": "krane", "clips": [["idle", 0.5], ["block_high", 0.5], ["walk_f", 0.4]],
                               "check": [["idle", 0.5], ["block_high", 0.5], ["shield_block", "contact"],
                                         ["crouch_idle", 0.5]], "with": ["baton"]}]},
    "baton": {"rule": "fist", "bone": "RightHand",
              "users": [{"fighter": "krane", "clips": [["idle", 0.5], ["baton_swing", "contact"], ["baton_chop", "contact"]],
                         "check": [["idle", 0.5], ["baton_poke", "contact"], ["baton_swing", "contact"],
                                   ["rising_baton", "contact"]], "with": ["riot_shield"]}]},
    "cleaver": {"rule": "fist", "bone": "RightHand",
                "users": [{"fighter": "boneyard", "clips": [["idle", 0.5], ["cleaver_swing", "contact"], ["chop_down", "contact"]],
                           "check": [["idle", 0.5], ["cleaver_swing", "contact"], ["chop_down", "contact"],
                                     ["walk_f", 0.4]]}]},
    "gourd": {"rule": "hip", "bone": "Hips", "pos": [-0.165, 0.0, -0.035], "rotDeg": [0.0, -90.0, 0.0],
              "users": [{"fighter": "lotus", "clips": [],
                         "check": [["idle", 0.5], ["sway_idle", 0.5], ["jab5", "contact"], ["walk_f", 0.4]]}]},
    "football": {"rule": "palm", "bone": "RightHand", "half": 0.11, "projectile": True,
                 "users": [{"fighter": "gazza", "clips": [["keeper_throw", 0.3]],
                            "check": [["keeper_throw", 0.2], ["keeper_throw", 0.4], ["win_point", "mid"],
                                      ["idle", 0.5]]}]},
    "card": {"rule": "pinch", "bone": "RightHand", "projectile": True,
             "users": [{"fighter": "zambini", "clips": [["card_flick", 0.1], ["card_flick", 0.3]],
                        "check": [["card_flick", 0.1], ["card_flick", 0.3], ["card_flick", "contact"],
                                  ["idle", 0.5]]}]},
    "card_fan": {"rule": "fan", "bone": "RightHand", "projectile": True,
                 "users": [{"fighter": "zambini", "clips": [["taunt_twirl", "50%"], ["intro_tada", "50%"]],
                            "check": [["taunt_twirl", "50%"], ["intro_tada", "30%"], ["intro_tada", "60%"],
                                      ["win_flourish", "50%"]]}]},
    "mic_cane": {"rule": "fist", "bone": "RightHand",
                 "users": [{"fighter": "ricky", "clips": [["idle", 0.5], ["cane_swing", "contact"], ["sledgehammer", "contact"]],
                            "check": [["idle", 0.5], ["cane_swing", "contact"], ["sledgehammer", "contact"],
                                      ["showstopper", "contact"]]}]},
    "taser": {"rule": "fist", "bone": "RightHand",
              "users": [{"fighter": "krane", "clips": [["idle", 0.5], ["baton_swing", "contact"]],
                         "check": [["taser_fire", 0.1], ["taser_fire", "contact"], ["idle", 0.5], ["walk_f", 0.4]],
                         "with": ["riot_shield"]}]},
    "spotlight": {"rule": "none"},
}
TIPS = {"brick": None, "riot_shield": None, "baton": [0.0, 0.5025, 0.0], "cleaver": [0.0, 0.272, 0.04],
        "gourd": None, "football": None, "card": None, "card_fan": None, "mic_cane": [0.0, 0.8005, 0.0],
        "taser": [0.0, 0.071, 0.1825], "spotlight": None}
FINGERS = ["Index", "Middle", "Ring", "Pinky"]


def P(*a):
    return os.path.join(GAME, *a).replace("\\", "/")


def run(cmd, log=None, timeout=3600):
    t = time.time()
    if log:
        with open(log, "w", encoding="utf-8", errors="replace") as lf:
            p = subprocess.run(cmd, stdout=lf, stderr=subprocess.STDOUT, env=ENV, timeout=timeout)
    else:
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", env=ENV, timeout=timeout)
    return p, round(time.time() - t, 1)


def gt():
    exe = shutil.which("gltf-transform") or shutil.which("gltf-transform.cmd")
    if not exe:
        raise SystemExit("gltf-transform CLI not found on PATH")
    return exe


# ------------------------------------------------------------------ grip solve (bone space = the view's frame)
def unit(v):
    v = np.asarray(v, float)
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def lm(hand, name, alt=None):
    if name in hand:
        return np.array(hand[name], float)
    if alt:
        return alt()
    return None


def tip(hand, f):
    """fingertip joint (end bone); extrapolated from J2 -> J3 when the body has no end bone"""
    return lm(hand, f + "4", lambda: lm(hand, f + "3") + 0.8 * (lm(hand, f + "3") - lm(hand, f + "2")))


def hand_frame(hand):
    """a = thumb-side knuckle axis, e1 = finger direction, e2 = palm normal (all bone space, orthonormal)"""
    a = unit(lm(hand, "Index1") - lm(hand, "Pinky1"))
    e1 = unit(np.array([0.0, 1.0, 0.0]) - a * a[1])
    e2 = unit(np.cross(a, e1))
    if e2[2] < 0:            # palm normal = the side the fingers curl toward = bone +Z (measured on all 12 bodies)
        e2 = -e2
    return a, e1, e2


def circle_fit(pts2):
    x, y = pts2[:, 0], pts2[:, 1]
    A = np.stack([x, y, np.ones_like(x)], 1)
    sol, *_ = np.linalg.lstsq(A, -(x * x + y * y), rcond=None)
    cx, cy = -sol[0] / 2, -sol[1] / 2
    r = math.sqrt(max(cx * cx + cy * cy - sol[2], 0.0))
    res = float(np.abs(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - r).mean())
    return cx, cy, r, res


def euler_xyz(R):
    """three.js Euler 'XYZ' (degrees) from a rotation matrix (columns = images of the prop axes)"""
    m11, m12, m13 = R[0]
    m21, m22, m23 = R[1]
    m31, m32, m33 = R[2]
    y = math.asin(max(-1.0, min(1.0, m13)))
    if abs(m13) < 0.9999999:
        x, z = math.atan2(-m23, m33), math.atan2(-m12, m11)
    else:
        x, z = math.atan2(m32, m22), 0.0
    return [round(math.degrees(v), 3) for v in (x, y, z)]


def rot_from_euler(deg):
    x, y, z = [math.radians(v) for v in deg]
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rx @ Ry @ Rz


def average_hands(hands):
    keys = set.intersection(*[set(k for k, v in h.items() if isinstance(v, list) and len(v) == 3) for h in hands])
    return {k: list(np.mean([h[k] for h in hands], 0)) for k in keys}


def solve(rule, g, hand):
    """-> (pos, R, info) in the hand bone's scale-stripped frame"""
    a, e1, e2 = hand_frame(hand)
    info = {}
    if rule in ("fist", "shield"):
        pts = []
        for f in FINGERS:
            for j in ("1", "2", "3"):
                p = lm(hand, f + j)
                if p is not None:
                    pts.append(p)
            pts.append(tip(hand, f))
        pts = np.array(pts)
        p2 = np.stack([pts @ e1, pts @ e2], 1)
        cx, cy, r, res = circle_fit(p2)
        axial = float(np.mean([lm(hand, "Middle1") @ a, lm(hand, "Ring1") @ a]))
        ok = 0.012 <= r <= 0.05 and res < 0.012
        if not ok:        # open hand: the palm-side loop a closed fist would make
            L = float(lm(hand, "Middle1") @ e1)
            cx, cy = 0.86 * L, 0.036 * L / 0.105
            info["fallback"] = "open hand (r %.3f res %.4f)" % (r, res)
        C = a * axial + e1 * cx + e2 * cy
        info.update({"loopRadiusM": round(r, 4), "fitResidualM": round(res, 4)})
        if rule == "fist":
            R = np.stack([np.cross(a, e1), a, e1], 1)
        else:
            R = np.stack([np.cross(a, -e2), a, -e2], 1)
        return C, R, info
    if rule == "palm":
        L = float(lm(hand, "Middle1") @ e1)
        C = e1 * (0.52 * L) + a * 0.004 + e2 * (0.013 + g["half"])
        s = 1.0 if np.dot(np.cross(a, e1), e2) > 0 else -1.0
        R = np.stack([s * a, e1, e2], 1)
        return C, R, info
    if rule == "pinch":
        ti, tm = tip(hand, "Index"), tip(hand, "Middle")
        d = unit((ti - lm(hand, "Index3")) + (tm - lm(hand, "Middle3")))
        n = unit((ti - tm) - np.dot(ti - tm, d) * d)
        pinch = 0.5 * (ti + tm)
        C = pinch + d * (0.0889 / 2 - 0.014)
        R = np.stack([np.cross(d, n), d, n], 1)
        return C, R, info
    if rule == "fan":
        th = tip(hand, "Thumb")
        pv = 0.5 * (th + lm(hand, "Index2"))
        up = unit(e1 * math.cos(math.radians(28)) + a * math.sin(math.radians(28)))
        z = unit(e2 - np.dot(e2, up) * up)
        R = np.stack([np.cross(up, z), up, z], 1)
        return pv + z * 0.004, R, info
    raise ValueError(rule)


def measure(jobs):
    sys.path.insert(0, TOOLS)
    import prop_attach_check as PAC
    return PAC.run_jobs(jobs)


def grip_solve(props):
    """-> {pid: {"default": attach|None, "fighters": {fid: attach}, "info": {...}}}"""
    out = {}
    jobs, keys = [], []
    for pid in props:
        g = GRIPS[pid]
        if g["rule"] in ("none", "hip"):
            continue
        for u in g["users"]:
            jobs.append(({"fighter": u["fighter"], "clipsUrl": "/hit-parade/data/clips/%s.clips.json" % u["fighter"],
                          "measure": {"clips": u["clips"], "hands": [g["bone"]]}},
                         P("art", "renders", "props", "_measure", "grip_%s_%s" % (pid, u["fighter"]))))
            keys.append((pid, u["fighter"]))
    res = measure(jobs) if jobs else []
    by = {}
    for (pid, fid), r in zip(keys, res):
        if not r.get("ok"):
            raise SystemExit("grip measure failed for %s/%s: %s" % (pid, fid, r.get("error")))
        g = GRIPS[pid]
        hands = [v[g["bone"]] for v in r["measure"].values()]
        by[pid, fid] = average_hands(hands)
    for pid in props:
        g = GRIPS[pid]
        if g["rule"] == "none":
            out[pid] = {"default": None, "fighters": {}, "info": {"rule": "none"}}
            continue
        if g["rule"] == "hip":
            att = {"bone": g["bone"], "pos": g["pos"], "rotDeg": g["rotDeg"]}
            out[pid] = {"default": att, "fighters": {u["fighter"]: att for u in g["users"]},
                        "info": {"rule": "hip", "R": rot_from_euler(g["rotDeg"]).round(4).tolist()}}
            continue
        fights, info = {}, {}
        for u in g["users"]:
            C, R, inf = solve(g["rule"], g, by[pid, u["fighter"]])
            assert abs(np.linalg.det(R) - 1.0) < 1e-6, (pid, np.linalg.det(R))
            eul = euler_xyz(R)
            back = rot_from_euler(eul)
            err = float(np.abs(back - R).max())
            assert err < 1e-4, (pid, err)          # rotDeg is rounded to 0.001 deg
            fights[u["fighter"]] = {"bone": g["bone"], "pos": [round(float(x), 4) for x in C], "rotDeg": eul}
            info[u["fighter"]] = dict(inf, R=R.round(4).tolist())
        out[pid] = {"default": fights[g["users"][0]["fighter"]], "fighters": fights, "info": dict(info, rule=g["rule"])}
    return out


# ------------------------------------------------------------------ post + props.json
def post(pid, attach, extra):
    raw = BUILD + "/%s.raw.glb" % pid
    ej = BUILD + "/%s.extras.json" % pid
    with open(ej, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(dict(extra, attach=attach), fh)
    s1 = BUILD + "/%s.x.glb" % pid
    p, _ = run(["node", P("tools", "prop_post.mjs"), "extras", raw, s1, ej])
    if p.returncode:
        raise SystemExit("prop_post extras failed: " + p.stderr[-800:])
    qc = BUILD + "/%s.qc.glb" % pid
    p, _ = run([gt(), "webp", s1, qc, "--quality", "88"])
    if p.returncode:
        raise SystemExit("webp failed: " + (p.stdout + p.stderr)[-800:])
    os.makedirs(OUT, exist_ok=True)
    fin = OUT + "/%s.glb" % pid
    p, _ = run([gt(), "meshopt", qc, fin])
    if p.returncode:
        raise SystemExit("meshopt failed: " + (p.stdout + p.stderr)[-800:])
    p, _ = run(["node", P("tools", "prop_post.mjs"), "facts", fin])
    return json.loads(p.stdout.strip().splitlines()[-1])


def props_json(props, grips, build, facts):
    path = OUT + "/props.json"
    doc = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    doc["_doc"] = [
        "Generated by tools/build_props.py (lane ASSETS) - do not hand-edit. CONTRACT 6.4 / 17.1 (CHANGED(ASSETS) 6.4).",
        "Each prop GLB = ONE mesh node named <id> (one material <id>_mat: baseColor + ORM + normal [+ emissive], webp, "
        "meshopt). Prop frame (glTF): origin = grip point; +Y = business end; +Z = edge / strike face / barrel / face.",
        "attach = the GLB root-node extras (CONTRACT 17.1): world = handBone.matrixWorld with its scale stripped to "
        "(+-1,1,1) x compose(pos, Euler(rotDeg XYZ, degrees), 1) - exactly view/fighters.ts attachProp/update. "
        "fighters{id} = the same solve on that fighter's own fingers (prefer it over attach). attach null = world prop.",
        "gripOffset = attach.pos; axis.up / axis.edge = the bone-space directions of prop +Y / +Z; scale = 1 (modelled "
        "at real size, metres). tip = business-end point in prop space, reachM = |tip| (weapon reach past the grip for "
        "SIM / FIGHTERS hit volumes, CONTRACT 20.6 open item).",
    ]
    doc["version"] = 1
    doc.setdefault("props", {})
    for pid in props:
        g, s, b, f = GRIPS[pid], grips[pid], build.get(pid, {}), facts[pid]
        att = s["default"]
        R = rot_from_euler(att["rotDeg"]) if att else None
        t = TIPS.get(pid)
        doc["props"][pid] = {
            "glb": "%s.glb" % pid,
            "users": [u["fighter"] for u in g.get("users", [])],
            "rule": g["rule"],
            "bone": att["bone"] if att else None,
            "gripOffset": att["pos"] if att else None,
            "axis": {"up": [round(float(x), 4) for x in R[:, 1]], "edge": [round(float(x), 4) for x in R[:, 2]]} if att else None,
            "rotDeg": att["rotDeg"] if att else None,
            "scale": 1.0,
            "attach": att,
            "fighters": s["fighters"],
            "projectile": bool(g.get("projectile", False)),
            "tip": t,
            "reachM": round(float(np.linalg.norm(t)), 4) if t else None,
            "origin": (b.get("meta") or {}).get("origin"),
            "note": (b.get("meta") or {}).get("note"),
            "boundsM": b.get("bounds"),
            "tris": f["tris"],
            "bytes": f["bytes"],
            "textures": [[x["mime"], x["size"]] for x in f["textures"]],
            "check": [{"fighter": u["fighter"], "clips": u.get("check", []), "with": u.get("with", [])}
                      for u in g.get("users", [])],
        }
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, indent=1)
    return path


# ------------------------------------------------------------------ contact sheet
def contact_sheet(props, blender, build):
    from PIL import Image, ImageDraw, ImageFont
    sd = P("art", "renders", "props", "sheet")
    shutil.rmtree(sd, ignore_errors=True)          # never compose stale tiles
    os.makedirs(sd, exist_ok=True)
    items = [{"id": pid, "path": BUILD + "/%s.qc.glb" % pid} for pid in props] + REFS
    job = {"items": items, "hdr": P("art", "gltf", "stages", "rust_theater_env.hdr"), "out_dir": sd, "res": 420,
           "views": ["front", "back", "side", "close"], "hdr_strength": 1.0}
    jp = sd + "/sheet_job.json"
    json.dump(job, open(jp, "w", encoding="utf-8"), indent=1)
    p, secs = run([blender, "--background", "--python", P("art", "blender", "props_sheet.py"), "--", jp], sd + "/sheet.log")
    res = json.load(open(sd + "/sheet_results.json", encoding="utf-8")) if os.path.exists(sd + "/sheet_results.json") else {}
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 15)
    except OSError:
        font = ImageFont.load_default()
    tile = 420
    ids = [it["id"] for it in items]
    sheets = []
    per = 5
    for s0 in range(0, len(ids), per):
        chunk = ids[s0:s0 + per]
        if s0 > 0:
            chunk = chunk + [r["id"] for r in REFS if r["id"] not in chunk][:1]
        im = Image.new("RGB", (tile * 4, tile * len(chunk)), (20, 20, 24))
        d = ImageDraw.Draw(im)
        for row, iid in enumerate(chunk):
            for col, v in enumerate(("front", "back", "side", "close")):
                f = sd + "/%s_%s.png" % (iid, v)
                if os.path.exists(f):
                    im.paste(Image.open(f).convert("RGB").resize((tile, tile)), (col * tile, row * tile))
            r = res.get(iid, {})
            lab = "%s  tris %s  dims %s" % (iid, r.get("tris"), r.get("dims"))
            d.rectangle([0, row * tile, tile * 4, row * tile + 22], fill=(0, 0, 0))
            d.text((6, row * tile + 3), lab, fill=(255, 220, 90), font=font)
            tx = ", ".join(r.get("textures", [])[:4])
            d.text((6, row * tile + tile - 20), tx[:150], fill=(200, 200, 210), font=font)
        out = P("art", "renders", "props", "contact_sheet_%d.png" % (s0 // per + 1))
        im.save(out)
        sheets.append(out)
    return {"rc": p.returncode, "secs": secs, "sheets": sheets, "results": res}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--props", default="")
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--skip-bake", action="store_true")
    ap.add_argument("--no-sheet", action="store_true")
    ap.add_argument("--no-attach-check", action="store_true")
    ap.add_argument("--blender", default=BLENDER)
    a = ap.parse_args()
    props = [x for x in a.props.split(",") if x] or ALL
    bad = [x for x in props if x not in GRIPS]
    if bad:
        ap.error("unknown props %s" % bad)
    os.makedirs(BUILD, exist_ok=True)
    rep = {"props": props, "t0": time.strftime("%Y-%m-%d %H:%M:%S")}
    p, _ = run([sys.executable, P("tools", "prop_decals.py"), TEX])
    if p.returncode:
        raise SystemExit("decals failed: " + p.stderr[-800:])
    if not a.skip_bake:
        job = {"out_dir": BUILD, "tex_dir": TEX, "props": props, "fast": a.fast}
        jp = BUILD + "/job.json"
        json.dump(job, open(jp, "w", encoding="utf-8"), indent=1)
        p, secs = run([a.blender, "--background", "--python", P("art", "blender", "build_props.py"), "--", jp],
                      BUILD + "/build.log")
        rep["bake"] = {"rc": p.returncode, "secs": secs}
        print("[props] bake rc=%d %.0fs" % (p.returncode, secs), flush=True)
    build = json.load(open(BUILD + "/props_build.json", encoding="utf-8"))
    failed = [x for x in props if not build.get(x, {}).get("ok")]
    if failed:
        raise SystemExit("bake failed for %s: %s" % (failed, {x: build.get(x, {}).get("error") for x in failed}))
    grips = grip_solve(props)
    rep["grips"] = {k: {"default": v["default"], "info": v["info"]} for k, v in grips.items()}
    facts = {}
    for pid in props:
        extra = {"prop": {"id": pid, "frame": "origin = grip; +Y business end; +Z edge / face / barrel", "units": "m",
                          "origin": build[pid]["meta"].get("origin")}}
        facts[pid] = post(pid, grips[pid]["default"], extra)
        print("[props] %-12s %7d B  tris %5d  textures %s  attach %s" % (pid, facts[pid]["bytes"], facts[pid]["tris"],
              [t["size"] for t in facts[pid]["textures"]], grips[pid]["default"]), flush=True)
    rep["facts"] = facts
    rep["props_json"] = props_json(props, grips, build, facts)
    if not a.no_sheet:
        rep["sheet"] = contact_sheet(props, a.blender, build)
        print("[props] contact sheets", rep["sheet"]["sheets"], "rc", rep["sheet"]["rc"], flush=True)
    if not a.no_attach_check:
        sys.path.insert(0, TOOLS)
        import prop_attach_check as PAC
        rs = PAC.suite(set(props))
        rep["attach_check"] = [{"ok": r.get("ok"), "errors": r.get("pageErrors")} for r in rs]
    with open(P("art", "renders", "props", "build_report.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=1)
    print("[props] DONE", json.dumps({k: facts[k]["bytes"] for k in facts}))


if __name__ == "__main__":
    main()
