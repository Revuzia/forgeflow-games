"""HIT PARADE - merge every art/stages/*.stage.json fragment into data/stages.json (lane STAGES-A). Plain Python 3.

  python tools/merge_stages.py            # merge + re-measure every built stage's GLB, write data/stages.json
  python tools/merge_stages.py --check    # validate + report only (exit 1 on an error), writes nothing

Fragments are written by the stage builds (art/stages/<id>.py -> art/stages/<id>.stage.json, lanes STAGES-A/-B); each
is one CONTRACT 21 StageDef (same fields as the rust_theater entry). Rules:
  * a fragment REPLACES the entry with the same id (or is added); entries without a fragment are kept as they are
    (rust_theater from write_stages_json.py, `todo` stubs until their fragment lands); a `built` fragment whose GLB
    is not on disk yet (another lane mid-build) is PENDING: warned, skipped, the existing entry stays;
  * order = STAGE_ORDER (the ui/data.ts ladder / select order), then any other ids alphabetically;
  * a `built` stage is re-measured from its GLB (draws / triangles / bytes / materials / textures / crowd nodes, the
    write_stages_json.py rule) + its env HDR; the measured numbers replace the fragment's `build`;
  * validation (errors stop the write): required fields, walls.splat ids 0/1 at x -8/+8, fight strip, light pool types
    (exactly one shadow-casting directional first in line), crowd bays, GLB present with crowd_* empties and NO lights,
    budget bytes (GLB + env) <= budget.bytesPerStage and draws <= budget.drawsStage.
Top-level `version`, `units`, `budget` are kept from the existing data/stages.json. Output: UTF-8, LF, indent 2.
ASCII only.
"""
import glob
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
OUT = os.path.join(ROOT, "data", "stages.json")
FRAG_DIR = os.path.join(ROOT, "art", "stages")
GLB_DIR = os.path.join(ROOT, "art", "gltf", "stages")
STAGE_ORDER = ["rust_theater", "butcher_block", "wheel_of_pain", "rooftop", "control_room"]
REQUIRED_BUILT = ["id", "name", "status", "glb", "home", "look", "floor", "walls", "spawn", "camera", "exposure",
                  "toneMapping", "fog", "environment", "lights", "crowd", "music", "dressing"]
LIGHT_TYPES = {"directional", "hemisphere", "point", "spot"}


def glb_stats(path):
    b = open(path, "rb").read()
    if b[:4] != b"glTF":
        raise ValueError("not a GLB: %s" % path)
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl].decode("utf-8"))
    draws = tris = 0
    for n in g.get("nodes", []):
        if "mesh" not in n:
            continue
        m = g["meshes"][n["mesh"]]
        inst = n.get("extensions", {}).get("EXT_mesh_gpu_instancing")
        count = g["accessors"][list(inst["attributes"].values())[0]]["count"] if inst else 1
        for p in m["primitives"]:
            draws += 1
            if "indices" in p:
                t = g["accessors"][p["indices"]]["count"] // 3
            else:
                t = g["accessors"][p["attributes"]["POSITION"]]["count"] // 3
            tris += t * count
    crowd = [n for n in g.get("nodes", []) if str(n.get("name", "")).startswith("crowd_")]
    lights = len(g.get("extensions", {}).get("KHR_lights_punctual", {}).get("lights", []))
    cams = len(g.get("cameras", []))
    return {"bytes": len(b), "draws": draws, "triangles": tris, "materials": len(g.get("materials", [])),
            "textures": len(g.get("textures", [])), "crowdNodes": len(crowd),
            "extensions": g.get("extensionsUsed", [])}, lights, cams


def _qrot(q, v):
    x, y, z, w = q
    cx = (y * v[2] - z * v[1], z * v[0] - x * v[2], x * v[1] - y * v[0])
    cx2 = (y * cx[2] - z * cx[1], z * cx[0] - x * cx[2], x * cx[1] - y * cx[0])
    return tuple(v[i] + 2 * w * cx[i] + 2 * cx2[i] for i in range(3))


def anim_nodes(path):
    """the named (non-set) mesh nodes the view animates: pivot (translation), local +Y in world (anim_spin_* spins
    about it, flame_* scales along it), world bbox centre of the mesh. Read from the GLB JSON (POSITION min/max)."""
    b = open(path, "rb").read()
    jl = struct.unpack_from("<I", b, 12)[0]
    g = json.loads(b[20:20 + jl].decode("utf-8"))
    out = []
    for n in g.get("nodes", []):
        name = str(n.get("name", ""))
        if "mesh" not in n or name.endswith("_set"):
            continue
        t = n.get("translation", [0, 0, 0])
        q = n.get("rotation", [0, 0, 0, 1])
        sc = n.get("scale", [1, 1, 1])
        lo = [1e9] * 3
        hi = [-1e9] * 3
        for p in g["meshes"][n["mesh"]]["primitives"]:
            a = g["accessors"][p["attributes"]["POSITION"]]
            mn, mx = a.get("min"), a.get("max")
            if a.get("normalized") and mn is not None:
                # KHR_mesh_quantization normalized ints: min/max are stored in the integer domain
                ct = a["componentType"]
                div = {5120: 127.0, 5121: 255.0, 5122: 32767.0, 5123: 65535.0}.get(ct, 1.0)
                mn = [max(v / div, -1.0) for v in mn]
                mx = [max(v / div, -1.0) for v in mx]
            if mn is None:
                continue
            lo = [min(lo[i], mn[i]) for i in range(3)]
            hi = [max(hi[i], mx[i]) for i in range(3)]
        c = [(lo[i] + hi[i]) / 2 * sc[i] for i in range(3)]
        cw = _qrot(q, c)
        cw = [cw[i] + t[i] for i in range(3)]
        out.append({"name": name, "pivot": [round(v, 3) for v in t], "localY": [round(v, 3) for v in _qrot(q, (0, 1, 0))],
                    "scale": [round(v, 4) for v in sc], "bboxCentre": [round(v, 3) for v in cw]})
    return out


def validate(s, budget, errs, warns):
    sid = s.get("id", "?")
    if s.get("status") != "built":
        return
    for k in REQUIRED_BUILT:
        if k not in s:
            errs.append("%s: missing field %s" % (sid, k))
    fl = s.get("floor", {})
    if fl.get("fightStrip") != {"x": [-8.0, 8.0], "z": [-1.5, 1.5]}:
        errs.append("%s: floor.fightStrip must be x[-8,8] z[-1.5,1.5] (CONTRACT 6.4), got %r" % (sid, fl.get("fightStrip")))
    splat = s.get("walls", {}).get("splat", [])
    ids = sorted((w.get("id"), w.get("x")) for w in splat)
    if ids != [(0, -8.0), (1, 8.0)]:
        errs.append("%s: walls.splat must be ids 0 (x -8) and 1 (x +8), got %r" % (sid, ids))
    lights = s.get("lights", [])
    shadow = [L for L in lights if L.get("castShadow")]
    for L in lights:
        if L.get("type") not in LIGHT_TYPES:
            errs.append("%s: light %s has type %r" % (sid, L.get("id"), L.get("type")))
        if L.get("type") in ("directional", "spot") and ("position" not in L or "target" not in L):
            errs.append("%s: light %s needs position + target" % (sid, L.get("id")))
    if len(shadow) != 1 or shadow[0].get("type") != "directional":
        errs.append("%s: exactly one shadow-casting directional light expected (view: first caster wins)" % sid)
    if len(lights) > 8:
        warns.append("%s: %d lights in the fixed pool (rust_theater has 7)" % (sid, len(lights)))
    cr = s.get("crowd", {})
    for k in ("atlas", "meta", "cardHeightM", "cardWidthM", "anchor", "tint", "brightness", "bays"):
        if k not in cr:
            errs.append("%s: crowd.%s missing" % (sid, k))
    for bay in cr.get("bays", []):
        for k in ("id", "x", "spacing", "jitter", "rows", "seed"):
            if k not in bay:
                errs.append("%s: crowd bay %s missing %s" % (sid, bay.get("id"), k))
    shots = s.get("camera", {}).get("proofShots", [])
    if not any(sh.get("id") == "near_center" for sh in shots):
        warns.append("%s: camera.proofShots has no near_center" % sid)
    glb = os.path.join(GLB_DIR, s.get("glb", sid + ".glb"))
    if not os.path.exists(glb):
        errs.append("%s: status built but %s is missing" % (sid, os.path.relpath(glb, ROOT)))
        return
    st, nl, nc = glb_stats(glb)
    if nl:
        errs.append("%s: GLB carries %d punctual lights (CONTRACT 21: none; the pool lives in stages.json)" % (sid, nl))
    if nc:
        warns.append("%s: GLB carries %d cameras" % (sid, nc))
    if st["crowdNodes"] == 0:
        errs.append("%s: GLB has no crowd_* empties" % sid)
    env = s.get("environment", {}).get("hdr")
    envp = os.path.join(GLB_DIR, env) if env else None
    st["envBytes"] = os.path.getsize(envp) if envp and os.path.exists(envp) else None
    if env and st["envBytes"] is None:
        errs.append("%s: environment.hdr %s missing" % (sid, env))
    tot = st["bytes"] + (st["envBytes"] or 0)
    if tot > budget.get("bytesPerStage", 6000000):
        errs.append("%s: %d bytes (GLB + env) over budget %d" % (sid, tot, budget.get("bytesPerStage")))
    if st["draws"] > budget.get("drawsStage", 150):
        errs.append("%s: %d draws over budget %d" % (sid, st["draws"], budget.get("drawsStage")))
    old = s.get("build")
    if old and (old.get("bytes") != st["bytes"] or old.get("draws") != st["draws"]):
        warns.append("%s: fragment build stats were stale (bytes %s -> %d, draws %s -> %d); re-measured" % (
            sid, old.get("bytes"), st["bytes"], old.get("draws"), st["draws"]))
    s["build"] = st


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    check = "--check" in sys.argv
    base = {"version": 1, "units": "metres; game/glTF axes: +X fight line, +Y up, camera on +Z looking toward -Z",
            "budget": {"bytesPerStage": 6000000, "drawsStage": 150, "drawsWithCrowd": 250}, "stages": []}
    if os.path.exists(OUT):
        base = json.load(open(OUT, encoding="utf-8"))
    stages = {s["id"]: s for s in base.get("stages", [])}
    frags = sorted(glob.glob(os.path.join(FRAG_DIR, "*.stage.json")))
    errs, warns = [], []
    merged = []
    for fp in frags:
        try:
            s = json.load(open(fp, encoding="utf-8"))
        except Exception as ex:
            errs.append("%s: unreadable (%s)" % (os.path.basename(fp), ex))
            continue
        sid = s.get("id")
        if not sid or os.path.basename(fp) != sid + ".stage.json":
            errs.append("%s: id %r must match the file name" % (os.path.basename(fp), sid))
            continue
        was = stages.get(sid, {}).get("status", "new")
        glb = os.path.join(GLB_DIR, s.get("glb", sid + ".glb"))
        if s.get("status") == "built" and not os.path.exists(glb):
            # a build in progress (fragment written before its GLB): never publish a built stage without its GLB
            warns.append("%s: fragment says built but %s is not there yet - PENDING, kept the existing entry (%s)" % (
                sid, os.path.relpath(glb, ROOT), was))
            continue
        stages[sid] = s
        merged.append("%s (%s -> %s)" % (sid, was, s.get("status")))
    budget = base.get("budget", {})
    for sid, s in stages.items():
        validate(s, budget, errs, warns)
    order = [i for i in STAGE_ORDER if i in stages] + sorted(i for i in stages if i not in STAGE_ORDER)
    base["stages"] = [stages[i] for i in order]
    print("fragments:", len(frags), "merged:", ", ".join(merged) if merged else "none")
    for s in base["stages"]:
        b = s.get("build") or {}
        print("  %-14s %-5s glb=%-20s bytes=%-9s env=%-8s draws=%-4s tris=%-7s crowd=%s" % (
            s["id"], s.get("status"), s.get("glb"), b.get("bytes"), b.get("envBytes"), b.get("draws"),
            b.get("triangles"), b.get("crowdNodes")))
    if "--nodes" in sys.argv:
        for s in base["stages"]:
            glb = os.path.join(GLB_DIR, s.get("glb", s["id"] + ".glb"))
            if s.get("status") == "built" and os.path.exists(glb):
                for a in anim_nodes(glb):
                    print("  node %-14s %s" % (s["id"], json.dumps(a)))
    for w in warns:
        print("WARN ", w)
    for e in errs:
        print("ERROR", e)
    if errs:
        print("NOT WRITTEN: %d error(s)" % len(errs))
        sys.exit(1)
    if check:
        print("check OK (nothing written)")
        return
    with open(OUT, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(json.dumps(base, indent=2) + "\n")
    print("wrote", os.path.relpath(OUT, ROOT), os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
