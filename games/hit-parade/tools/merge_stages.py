"""HIT PARADE - merge every art/stages/*.stage.json fragment into data/stages.json (lanes STAGES-A / STAGES3D-A). Python 3.

  python tools/merge_stages.py                      # merge + re-measure every built stage's GLB, write data/stages.json
  python tools/merge_stages.py --check              # validate + report only (exit 1 on an error), writes nothing
  python tools/merge_stages.py --nodes              # also print each animated node's pivot / local +Y / bbox centre
  python tools/merge_stages.py --install a,b        # CHANGED(STAGES3D-A): swap staged builds in, then merge
  python tools/merge_stages.py --install all        #   (every stage staged in _harness/scratch/stages3d_out/)
                                                    # CHANGED(fix_ui_stage): + stages_cache/out3d/ (stagekit_b builds);
                                                    # a stage staged without a GLB = fragment-only install

Fragments are written by the stage builds (art/stages/<id>.py -> art/stages/<id>.stage.json, lanes STAGES-A/-B); each
is one CONTRACT 21 StageDef (same fields as the rust_theater entry). Rules:
  * a fragment REPLACES the entry with the same id (or is added); entries without a fragment are kept as they are
    (`todo` stubs until their fragment lands); a `built` fragment whose GLB is not on disk yet (another lane mid-build)
    is PENDING: warned, skipped, the existing entry stays;
  * order = STAGE_ORDER (the ui/data.ts ladder / select order), then any other ids alphabetically;
  * a `built` stage is re-measured from its GLB (draws / triangles / bytes / materials / textures / crowd nodes, the
    write_stages_json.py rule) + its env HDR; the measured numbers replace the fragment's `build` (a `clearance` block
    measured by the stage build is carried over);
  * validation (errors stop the write): required fields, light pool types (exactly one shadow-casting directional),
    crowd bays (linear `x` or arc `arcDeg`, CONTRACT 35.11.6), GLB present with crowd_* empties and NO lights, budget
    bytes (GLB + env) <= budget.bytesPerStage and draws <= budget.drawsStage;
  * CHANGED(STAGES3D-A) CONTRACT 35.6 / 35.11: a stage with `ring` is a 360-degree arena: ring shape / radius 5.0-6.0 /
    sides / rotDeg / wallHeightM / surface, spawnAxisDeg + cameraSideDeg + cameraMaxM, spawn p1/p2 consistent with the
    spawn axis (1 cm), the build's camera-band clearance probe ok (nothing inside cameraMaxM at y 1.30-3.00), the 16
    orbit proof shots present. Its legacy 2.5D fields (fightStrip, walls.splat ids 0/1 at x -8/+8) only WARN. A stage
    WITHOUT `ring` keeps the 2.5D checks as errors.
  * --install: the stage builds write GLB + env HDR + fragment to _harness/scratch/stages3d_out/ (never the files the
    running game loads); --install validates each staged stage against its staged GLB, then moves the three files into
    art/gltf/stages/ + art/stages/ (os.replace, one stage at a time) and merges. With --check nothing is moved.
Top-level `version`, `units`, `budget` are kept from the existing data/stages.json. Output: UTF-8, LF, indent 2.
ASCII only.
"""
import glob
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, ".."))
OUT = os.path.join(ROOT, "data", "stages.json")
FRAG_DIR = os.path.join(ROOT, "art", "stages")
GLB_DIR = os.path.join(ROOT, "art", "gltf", "stages")
STAGE_OUT = os.path.join(ROOT, "_harness", "scratch", "stages3d_out")
# CHANGED(fix_ui_stage): art/stages/stagekit_b.py (rooftop / control_room) stages in stages_cache/out3d - --install reads both
STAGE_DIRS = [STAGE_OUT, os.path.join(ROOT, "_harness", "scratch", "stages_cache", "out3d")]
STAGE_ORDER = ["rust_theater", "butcher_block", "wheel_of_pain", "rooftop", "control_room"]
REQUIRED_BUILT = ["id", "name", "status", "glb", "home", "look", "floor", "walls", "spawn", "camera", "exposure",
                  "toneMapping", "fog", "environment", "lights", "crowd", "music", "dressing"]
REQUIRED_RING = ["shape", "radiusM", "sides", "rotDeg", "wallHeightM", "surface"]
LIGHT_TYPES = {"directional", "hemisphere", "point", "spot"}
CAMERA_EYE_M = 1.35       # CONTRACT 35.7 orbit camera eye height
ORBIT_CLEAR_M = 9.5       # CONTRACT 35.7 max camera distance


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


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def validate_ring(s, errs, warns):
    """CONTRACT 35.6 / 35.11 fields of a 360-degree arena"""
    sid = s.get("id", "?")
    ring = s.get("ring")
    if not isinstance(ring, dict):
        errs.append("%s: ring must be an object (CONTRACT 35.11.2)" % sid)
        return
    for k in REQUIRED_RING:
        if k not in ring:
            errs.append("%s: ring.%s missing (CONTRACT 35.11.2)" % (sid, k))
    shape = ring.get("shape")
    if shape not in ("circle", "poly"):
        errs.append("%s: ring.shape must be 'circle' or 'poly', got %r" % (sid, shape))
    r = ring.get("radiusM")
    if not _num(r) or not (5.0 <= r <= 6.0):
        errs.append("%s: ring.radiusM must be 5.0..6.0 m (CONTRACT 35.6), got %r" % (sid, r))
    sides = ring.get("sides")
    if not isinstance(sides, int) or sides < 3:
        errs.append("%s: ring.sides must be an int >= 3, got %r" % (sid, sides))
    elif shape == "circle" and sides != 16:
        warns.append("%s: circle ring.sides = %d (CONTRACT 35.2: 16 WALL_SPLAT sectors)" % (sid, sides))
    elif shape == "poly" and sides != 8:
        warns.append("%s: poly ring with %d sides (CONTRACT 35.6 names circle or octagon)" % (sid, sides))
    for k in ("rotDeg", "wallHeightM"):
        if not _num(ring.get(k)):
            errs.append("%s: ring.%s must be a number, got %r" % (sid, k, ring.get(k)))
    wh = ring.get("wallHeightM")
    if _num(wh) and (wh <= 0 or wh >= 1.30):
        warns.append("%s: ring.wallHeightM %.2f reaches the camera band (eye %.2f m)" % (sid, wh, CAMERA_EYE_M))
    if "thicknessM" in ring and (not _num(ring["thicknessM"]) or ring["thicknessM"] <= 0):
        errs.append("%s: ring.thicknessM must be a number > 0" % sid)
    if not isinstance(ring.get("surface"), str):
        errs.append("%s: ring.surface must be a string" % sid)
    for k in ("spawnAxisDeg", "cameraSideDeg", "cameraMaxM"):
        if not _num(s.get(k)):
            errs.append("%s: %s must be a number (CONTRACT 35.6 / 35.11)" % (sid, k))
    cm = s.get("cameraMaxM")
    if _num(cm) and _num(r):
        if cm <= r + (ring.get("thicknessM") or 0):
            errs.append("%s: cameraMaxM %.2f must lie outside the ring boundary" % (sid, cm))
        elif cm < ORBIT_CLEAR_M:
            warns.append("%s: cameraMaxM %.2f < %.1f m (the orbit camera's max distance, CONTRACT 35.7)" % (
                sid, cm, ORBIT_CLEAR_M))
    sp = s.get("spawn", {})
    ax = s.get("spawnAxisDeg")
    if _num(ax) and _num(sp.get("distanceM")) and sp.get("p1") and sp.get("p2"):
        a = math.radians(ax)
        h = sp["distanceM"] / 2.0
        want1 = (-h * math.sin(a), -h * math.cos(a))
        want2 = (h * math.sin(a), h * math.cos(a))
        got1 = (sp["p1"][0], sp["p1"][2])
        got2 = (sp["p2"][0], sp["p2"][2])
        if math.dist(want1, got1) > 0.01 or math.dist(want2, got2) > 0.01:
            errs.append("%s: spawn p1/p2 %r/%r disagree with spawnAxisDeg %.1f and distanceM %.2f (CONTRACT 35.11.3)" % (
                sid, sp["p1"], sp["p2"], ax, sp["distanceM"]))
        if _num(r) and h > r - 0.5:
            errs.append("%s: spawn points outside the ring" % sid)
    shots = [sh.get("id", "") for sh in s.get("camera", {}).get("proofShots", [])]
    orbit = [i for i in shots if i.startswith("orbit_")]
    if len(orbit) < 16:
        warns.append("%s: %d orbit proof shots (CONTRACT 35.11.7 asks 16)" % (sid, len(orbit)))
    cl = (s.get("build") or {}).get("clearance")
    if cl is None:
        warns.append("%s: build has no camera-band clearance probe (CONTRACT 35.11.5)" % sid)
    else:
        mr = cl.get("minRadiusM")
        if not cl.get("ok") or (_num(mr) and _num(cm) and mr < cm):
            errs.append("%s: camera-band clearance FAILED: geometry at r %s < cameraMaxM %s in y %s (nearest %s)" % (
                sid, mr, cm, cl.get("bandY"), cl.get("nearest")))


def validate(s, budget, errs, warns, glb_dir=GLB_DIR):
    sid = s.get("id", "?")
    if s.get("status") != "built":
        return
    for k in REQUIRED_BUILT:
        if k not in s:
            errs.append("%s: missing field %s" % (sid, k))
    is_ring = "ring" in s
    legacy = warns if is_ring else errs
    fl = s.get("floor", {})
    if fl.get("fightStrip") != {"x": [-8.0, 8.0], "z": [-1.5, 1.5]}:
        legacy.append("%s: floor.fightStrip must be x[-8,8] z[-1.5,1.5] (CONTRACT 6.4%s), got %r" % (
            sid, "; legacy on a ring stage" if is_ring else "", fl.get("fightStrip")))
    splat = s.get("walls", {}).get("splat", [])
    ids = sorted((w.get("id"), w.get("x")) for w in splat)
    if ids != [(0, -8.0), (1, 8.0)]:
        legacy.append("%s: walls.splat must be ids 0 (x -8) and 1 (x +8)%s, got %r" % (
            sid, " (legacy on a ring stage)" if is_ring else "", ids))
    if is_ring:
        validate_ring(s, errs, warns)
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
        for k in ("id", "spacing", "jitter", "rows", "seed"):
            if k not in bay:
                errs.append("%s: crowd bay %s missing %s" % (sid, bay.get("id"), k))
        if "x" not in bay and "arcDeg" not in bay:
            errs.append("%s: crowd bay %s needs x (linear) or arcDeg (arc, CONTRACT 35.11.6)" % (sid, bay.get("id")))
        rk = ("r", "y") if "arcDeg" in bay else ("z", "y")
        for row in bay.get("rows", []):
            if any(k not in row for k in rk):
                errs.append("%s: crowd bay %s row %r needs %s" % (sid, bay.get("id"), row, "/".join(rk)))
                break
    shots = s.get("camera", {}).get("proofShots", [])
    if not any(sh.get("id") == "near_center" for sh in shots):
        warns.append("%s: camera.proofShots has no near_center" % sid)
    glb = os.path.join(glb_dir, s.get("glb", sid + ".glb"))
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
    envp = os.path.join(glb_dir, env) if env else None
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
    if old and "clearance" in old:
        st["clearance"] = old["clearance"]
    s["build"] = st


def _replace(src, dst, tries=20):
    """CHANGED(fix_ui_stage): atomic rename, retried while a dev server still holds the old file open (Windows sharing)"""
    import time
    for k in range(tries):
        try:
            os.replace(src, dst)
            return
        except PermissionError as ex:
            print("  busy (%s), retry %d" % (ex, k + 1))
            time.sleep(0.5)
    raise SystemExit("could not replace %s" % dst)


def staged_fragment(sid):
    """CHANGED(fix_ui_stage): the newest staged fragment of `sid` across STAGE_DIRS (STAGES3D-A builds stage in
    stages3d_out/, the stagekit_b builds - rooftop / control_room - in stages_cache/out3d/) -> (path, dir) or (None, None)"""
    best = (None, None, -1.0)
    for d in STAGE_DIRS:
        fp = os.path.join(d, sid + ".stage.json")
        if os.path.exists(fp) and os.path.getmtime(fp) > best[2]:
            best = (fp, d, os.path.getmtime(fp))
    return best[0], best[1]


def install(ids_arg, budget, check):
    """validate staged builds, then move GLB + env + fragment into place (one stage at a time).
    CHANGED(fix_ui_stage): both staging dirs are searched; a stage staged WITHOUT a GLB (a `--fragment-only` re-emit of the
    StageDef: lights / fog / copy) is a fragment-only install - validated against the shipped GLB + env, only the
    fragment moves."""
    staged = sorted({os.path.basename(p)[:-len(".stage.json")] for d in STAGE_DIRS
                     for p in glob.glob(os.path.join(d, "*.stage.json"))})
    want = staged if ids_arg in (True, "all") else [i for i in str(ids_arg).split(",") if i]
    moved, errs_all = [], []
    for sid in want:
        fp, sdir = staged_fragment(sid)
        if not fp:
            errs_all.append("%s: nothing staged (%s.stage.json in none of %s)" % (
                sid, sid, ", ".join(os.path.relpath(d, ROOT) for d in STAGE_DIRS)))
            continue
        s = json.load(open(fp, encoding="utf-8"))
        glb_name = s.get("glb", sid + ".glb")
        frag_only = not os.path.exists(os.path.join(sdir, glb_name))
        errs, warns = [], []
        validate(s, budget, errs, warns, glb_dir=GLB_DIR if frag_only else sdir)
        for w in warns:
            print("WARN  [staged]", w)
        if errs:
            errs_all += ["[staged] " + e for e in errs]
            continue
        files = []
        if not frag_only:
            files.append((os.path.join(sdir, glb_name), os.path.join(GLB_DIR, glb_name)))
            env = s.get("environment", {}).get("hdr")
            if env and os.path.exists(os.path.join(sdir, env)):
                files.append((os.path.join(sdir, env), os.path.join(GLB_DIR, env)))
            elif env:
                print("NOTE  %s: no staged %s - the shipped env HDR stays" % (sid, env))
        else:
            print("NOTE  %s: fragment-only install (no staged GLB): validated against the shipped %s" % (sid, glb_name))
        files.append((fp, os.path.join(FRAG_DIR, sid + ".stage.json")))
        if check:
            print("install check OK: %s (%s)" % (sid, ", ".join(os.path.relpath(b, ROOT) for _, b in files)))
            continue
        for a, b in files:
            _replace(a, b)
        moved.append(sid)
        print("installed %s: %s" % (sid, ", ".join(os.path.relpath(b, ROOT) for _, b in files)))
    return moved, errs_all


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
    budget = base.get("budget", {})
    if "--install" in sys.argv:
        i = sys.argv.index("--install")
        ids_arg = sys.argv[i + 1] if i + 1 < len(sys.argv) and not sys.argv[i + 1].startswith("--") else True
        moved, ierrs = install(ids_arg, budget, check)
        for e in ierrs:
            print("ERROR", e)
        if ierrs:
            print("INSTALL: %d error(s); installed: %s" % (len(ierrs), ", ".join(moved) or "none"))
            if not moved:
                sys.exit(1)
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
    for sid, s in stages.items():
        validate(s, budget, errs, warns)
    order = [i for i in STAGE_ORDER if i in stages] + sorted(i for i in stages if i not in STAGE_ORDER)
    base["stages"] = [stages[i] for i in order]
    print("fragments:", len(frags), "merged:", ", ".join(merged) if merged else "none")
    for s in base["stages"]:
        b = s.get("build") or {}
        rg = s.get("ring") or {}
        cl = b.get("clearance") or {}
        print("  %-14s %-5s glb=%-20s bytes=%-9s env=%-8s draws=%-4s tris=%-7s crowd=%-4s ring=%s" % (
            s["id"], s.get("status"), s.get("glb"), b.get("bytes"), b.get("envBytes"), b.get("draws"),
            b.get("triangles"), b.get("crowdNodes"),
            ("%s r%.2f h%.2f clear>=%s" % (rg.get("shape"), rg.get("radiusM", 0), rg.get("wallHeightM", 0),
                                           cl.get("minRadiusM"))) if rg else "-"))
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
