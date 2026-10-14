#!/usr/bin/env python
"""citykit_probe - does the city kit module (runtime/3d/royale/citykit.js, contract C-KIT) place 300 buildings the way the plan says, in a REAL browser?
(world-foundation plan, Wave 6, lane 6C.  The pure half - collider maths - is citykit.selftest.cjs, picked up by gate.py's node_selftests.)

    python _harness/citykit_probe.py --disk                       # the working copy (the integration run)
    python _harness/citykit_probe.py --disk --shots DIR           # also write the screenshots there (default _harness/_shots)
    python _harness/citykit_probe.py --disk --plant leak          # negative controls (each must exit 1, see PLANTS)

One Chrome boots the game to the MENU (no match: a map load is 1-3 minutes here and the kit is not wired into maps.js yet), stops the kernel loop and
runs probe_citykit.js, which builds a THROWAWAY THREE.Scene (own camera, lights, ground) and draws it with the game's own renderer. citykit.js is imported
the way Wave 7 will (createCityKit({ THREE, kernel, assetBase })); its GLBs and palettes go through W.kernel.loadGLTF (the real GLTFLoader + the lazy meshopt
decoder). Every count below is read from renderer.info after a REAL render() (a draw call is a draw call whatever the GPU does).

  boot            the game reaches the menu, citykit.js imports, 0 page / console / shader errors and 0 failed requests over the whole normal session
  colliders-node  the 300-building list's colliders, as the BROWSER built them, equal the ones the pure functions give in NODE, number for number
  colliders-glb-fail  a SECOND Chrome whose every kit GLB answers 404 builds the IDENTICAL colliders (same hash, same ranges), reports every used type as failed,
                  draws them as collider boxes (1 call per district) and only the blocked requests fail; with the manifest unreachable too the colliders are still identical
  calls           300 buildings in 6 districts, every LOD held at detail, the camera over everything: kit draw calls == sum over districts of distinct types
                  (counted from the MANIFEST, not from the kit), and == the kit's own stats()
  triangles       the measured kit triangles == stats() == sum over instances of the GLB's triangles; and within 2 % of the manifest's `tris` (the intake's own bar)
  lod             from the drop camera, the street and the skyline view each district is at detail or collapsed to ONE proxy call exactly when
                  distance >= 250 m + its bounding radius (THREE.LOD hysteresis 4 % honoured); measured kit calls == stats() currentDrawCalls == the frustum test
  culling         the camera looking at the sky and away from every district draws 0 kit meshes; the street view draws exactly the meshes the frustum test says
                  and fewer than all; every InstancedMesh carries its own computed bounding sphere no wider than its district's (a map-wide instance never culls)
  dispose         3 place -> render -> dispose cycles: renderer.info geometries and textures return to the baseline after every dispose, no kit object is left in
                  the scene, and the second and third cycle compile no new program
  all-types       all 81 manifest types place and draw (one each): 0 failed, browser triangles == manifest tris within 2 %, calls == the GLB's mesh count
  agreement       81 types x 4 quarter turns: every collider box lies inside the bounding box of the DRAWN instance (mesh and colliders use one rotation convention)
  api             preload(), entries with no district chunked on a grid, a free yaw, scale, setShadows, place() after dispose() throws
  themes          6 themes + an explicit variant give distinct shared materials / textures; one texture per (palette, variant), tints applied
  far-only        lod "far" districts request NO GLB, still return every collider, draw exactly 1 call per district
  --in-match      (optional, +20 s) the same kit inside a REAL standard match on ashgrid, built from createCityKit({ W }) and parented to W.group("map") like Wave 7
                  will: after the game's own kernel.warmup every later composer frame (12 at the drop camera, 6 at street level) compiles 0 new programs, and the kit
                  costs <= 40 draw calls and <= 25 % of the frame's triangles at both cameras (the plan's perf_district bars, same-parity frames: the game alternates
                  shadow-refresh frames); rows inmatch-warm, inmatch-cost
  INFO            place() ms, per-type triangle table, calls and triangles at street / drop with and without shadows, bytes downloaded, programs

Screenshots (LOOK at them): town street, town drop (330 m), skyline, building row (detail over proxy), themes.

PLANTS (planted faults in a patched copy of citykit.js served by a page route; each must exit 1 in plant mode, 0 = the gate is blind to it):
  no-spheres    every entry in ONE district (map-wide instances)                 -> culling / calls
  leak          dispose() frees nothing                                           -> dispose
  glb-colliders colliders only for types whose GLB loaded                         -> colliders-glb-fail
  q1-sign       a sign error in the quarter-turn-1 table                          -> colliders-node
  mesh-flip     the instance matrix rotates the opposite way to the colliders      -> agreement
  no-far        the far proxy never built                                         -> lod

Exit 0 pass / 1 fail / 2 could-not-judge (Chrome did not start, the page never booted, a row measured nothing).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

GATE = "citykit_probe"
PROBE = os.path.join(HERE, "probe_citykit.js")
CITYKIT = os.path.join(C.ROOT, "runtime", "3d", "royale", "citykit.js")
MANIFEST = os.path.join(C.ROOT, "assets", "props", "city", "manifest.json")
CITY = os.path.dirname(MANIFEST)
NODE_OUT = r"""
import fs from "node:fs";
import { pathToFileURL } from "node:url";
const K = await import(pathToFileURL(process.argv[2]).href);
const list = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const out = [];
for (const e of list) for (const c of K.colliderFor(e.type, e.x, e.y, e.z, e.rot, e.scale)) out.push([c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ]);
process.stdout.write(JSON.stringify(out));
"""

# planted faults: (what to find, what to put instead); every `find` must occur exactly once or the plant did not apply
PLANTS = {
    "no-spheres": {"rows": {"calls", "culling"}, "patch": [('n.district = n.district || ("cell:" + Math.floor(n.x / cell) + "," + Math.floor(n.z / cell));', 'n.district = "ALL";')]},
    "leak": {"rows": {"dispose"}, "patch": [("    if (disposed) return { geometries: 0, materials: 0, textures: 0, instancedMeshes: 0 };\n    disposed = true;", "    if (disposed) return { geometries: 0, materials: 0, textures: 0, instancedMeshes: 0 };\n    disposed = true; return { geometries: 0, materials: 0, textures: 0, instancedMeshes: 0 };")]},
    "glb-colliders": {"rows": {"colliders-glb-fail"}, "patch": [("    if (disposed) return result;\n    for (const n of drawn)", "    if (disposed) return result;\n    { const bad = new Set(); for (const n of drawn) { const r0 = glb.get(n.type); if (!r0 || r0.failed) bad.add(n.type); } if (bad.size) { const keep = []; for (const n of entries) { if (bad.has(n.type)) continue; for (let j = 0; j < ranges[n.i * 2 + 1]; j++) keep.push(colliders[ranges[n.i * 2] + j]); } colliders.length = 0; for (const c of keep) colliders.push(c); } }\n    for (const n of drawn)")]},
    "q1-sign": {"rows": {"colliders-node"}, "patch": [("else if (q === 1) { a = z0; b = z1; c = -x1; d = -x0; }", "else if (q === 1) { a = z0; b = z1; c = x0; d = x1; }")]},
    "mesh-flip": {"rows": {"agreement"}, "patch": [("M.set(c * sc, 0, s * sc, it.x - c0[0],  0, sc, 0, it.y - c0[1],  -s * sc, 0, c * sc, it.z - c0[2],  0, 0, 0, 1);", "M.set(c * sc, 0, -s * sc, it.x - c0[0],  0, sc, 0, it.y - c0[1],  s * sc, 0, c * sc, it.z - c0[2],  0, 0, 0, 1);")]},
    "no-far": {"rows": {"lod"}, "patch": [('const wantFar = mode === "far" || (mode !== "detail" && far > 0 && isFinite(far));', "const wantFar = false;")]},
}


def read_json(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def node_colliders(lst):
    """The same list through the PURE functions in Node (no THREE, no DOM): the reference the browser must equal."""
    d = tempfile.mkdtemp(prefix="lc_citykit_")
    lp, sp = os.path.join(d, "list.json"), os.path.join(d, "out.mjs")
    with open(lp, "w", encoding="utf-8") as f:
        json.dump(lst, f)
    with open(sp, "w", encoding="utf-8") as f:
        f.write(NODE_OUT)
    try:
        r = subprocess.run(["node", sp, CITYKIT, lp], capture_output=True, text=True, encoding="utf-8", timeout=120)
    except FileNotFoundError:
        raise C.EnvFailure("node is not on PATH")
    if r.returncode != 0:
        raise C.EnvFailure("node failed: " + (r.stderr or "")[-300:])
    return json.loads(r.stdout)


def install(s, v):
    """Evaluate probe_citykit.js (an arrow function returning the API) once per page; the kernel loop is stopped so only the probe renders."""
    with open(PROBE, encoding="utf-8") as fh:
        src = fh.read()
    s.freeze_loop()
    keys = s.js("() => { window.__LCKIT__ = (" + src + ")(); return Object.keys(window.__LCKIT__); }")
    if not keys or "main" not in keys:
        raise C.HarnessError("probe_citykit.js did not install: %s" % keys)


def patched_citykit(plant):
    with open(CITYKIT, encoding="utf-8") as f:
        src = f.read()
    for find, repl in PLANTS[plant]["patch"]:
        if src.count(find) != 1:
            raise C.EnvFailure("plant %r: the anchor text occurs %d times in citykit.js (expected 1): %r" % (plant, src.count(find), find[:70]))
        src = src.replace(find, repl)
    return src.encode("utf-8")


def session(args, plant=None, block_glb=False, name="citykit"):
    s = C.Session(args, name=name)
    s.start()
    if not s.disk:
        raise C.EnvFailure("citykit_probe serves through page routing: run it with --disk")
    if plant:
        body = patched_citykit(plant)

        def pred(u):
            return u.split("?")[0].endswith("/runtime/3d/royale/citykit.js")

        s.disk.overrides.append((pred, lambda route: route.fulfill(status=200, body=body, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store"})))
    if block_glb:
        s.blocked = []

        def gpred(u):
            p = u.split("?")[0]
            return p.endswith(".glb") and ("/assets/props/city/" in p or "/assets/props/cars/" in p)

        def ghandler(route):
            s.blocked.append(route.request.url.split("?")[0])
            route.fulfill(status=404, body="blocked by citykit_probe", headers={"Cache-Control": "no-store"})

        s.disk.overrides.append((gpred, ghandler))
    s.page.set_default_timeout(900_000)
    return s


def shot(s, path, scene_name, view, extra=None):
    """Draw the probe scene from `view` and save the canvas in the same task (a PNG of what the game's own renderer drew)."""
    s.js("(a) => window.__LCKIT__.shotScene(a)", scene_name)
    s.canvas_png(path, "window.__LCKIT__.shotView(%s, %s)" % (json.dumps(scene_name), json.dumps(view)))
    return path


def pct_err(a, b):
    return abs(a - b) / max(1.0, b)


def main_fn(v, args):
    plant = args.plant
    rows_of_plant = PLANTS[plant]["rows"] if plant else None
    shots = args.shots or C.SHOTS
    os.makedirs(shots, exist_ok=True)
    man = read_json(MANIFEST)
    T = man["types"]
    if plant:
        v.note("PLANT %s: patched citykit.js is served; exit 1 = the planted fault was detected (rows %s), exit 0 = the gate is blind to it" % (plant, sorted(rows_of_plant)))

    # ------------------------------------------------------------------ session A: the normal run
    s = session(args, plant=plant, name="citykit_A")
    try:
        s.boot()
        install(s, v)
        s.stage("main")
        try:
            M = s.js("() => window.__LCKIT__.main({})")
            cyc = s.js("() => window.__LCKIT__.cycles(3)")
            ty = s.js("() => window.__LCKIT__.types()")
            th = s.js("() => window.__LCKIT__.themes()")
            fo = s.js("() => window.__LCKIT__.farOnly()")
            ag = s.js("() => window.__LCKIT__.agreement()")
            mi = s.js("() => window.__LCKIT__.misc()")
        except Exception as e:
            if "Target page, context or browser has been closed" in str(e):
                raise
            v.check("probe ran in the page", False, "the in-page probe threw (the module under test, or the probe, broke): " + " | ".join(str(e).splitlines()[:4])[:600])
            return
        v.data["main"] = {k: M[k] for k in M if k not in ("list", "colliders", "ranges")}
        v.data["cycles"], v.data["types"], v.data["themes"], v.data["farOnly"], v.data["agreement"], v.data["misc"] = cyc, ty, th, fo, ag, mi

        # screenshots: the scene is placed once per shot (the LODs flip on the render)
        s.stage("shots")
        S = {}
        S["street"] = shot(s, os.path.join(shots, "citykit_town_street.png"), "town", "street")
        s.js("() => window.__LCKIT__.shotDispose()")
        S["drop"] = shot(s, os.path.join(shots, "citykit_town_drop.png"), "town", "drop")
        s.js("() => window.__LCKIT__.shotDispose()")
        S["skyline"] = shot(s, os.path.join(shots, "citykit_town_skyline.png"), "town", "skyline")
        s.js("() => window.__LCKIT__.shotDispose()")
        sc = s.js("(a) => window.__LCKIT__.shotScene(a)", "buildings")
        w = sc["width"]
        S["row"] = os.path.join(shots, "citykit_building_row.png")
        s.canvas_png(S["row"], "window.__LCKIT__.shotView('buildings', { pos: [%f, 60, 150], look: [%f, 14, -30] })" % (w / 2, w / 2))
        s.js("() => window.__LCKIT__.shotDispose()")
        th2 = s.js("(a) => window.__LCKIT__.shotScene(a)", "themes")          # the six themes side by side, the kit kept in the scene for the shot
        S["themes"] = os.path.join(shots, "citykit_themes.png")
        s.canvas_png(S["themes"], "window.__LCKIT__.shotView('themes', { pos: [%f, 38, 70], look: [%f, 4, -8] })" % (th2["x"] / 2, th2["x"] / 2))
        s.js("() => window.__LCKIT__.shotDispose()")
        diag = s.diagnostics()
        v.data["shots"] = S
        v.data["blockedLog"] = None
    finally:
        s.close()

    # ------------------------------------------------------------------ session B: every kit GLB answers 404
    sb = session(args, plant=plant, block_glb=True, name="citykit_B")
    try:
        sb.boot()
        install(sb, v)
        sb.stage("failpaths")
        FP = sb.js("() => window.__LCKIT__.failpaths()")
        diagB = sb.diagnostics()
        blocked = list(sb.blocked)
    finally:
        sb.close()
    IM = None
    if args.in_match and not plant:
        sc = session(args, name="citykit_C")
        try:
            sc.boot()
            sc.start_match("standard", 7, args.map, enter=True)
            sc.freeze_loop()
            sc.install_pump()
            install(sc, v)
            sc.stage("inmatch")
            im = {}
            im["place"] = sc.js("() => window.__LCKIT__.inMatchPlace()")
            sc.step_frames(2, 1 / 60, render=True)
            im["dropPos"] = sc.js("() => window.__LC__.W.player.pos.toArray()")
            im["drop"] = sc.js("() => window.__LCKIT__.inMatchMeasure()")
            im["dropShot"] = os.path.join(shots, "citykit_inmatch_drop.png")
            sc.canvas_png(im["dropShot"], "window.__H_PUMP__.frame(1e-6, true)")
            im["stand"] = sc.js("() => window.__LCKIT__.inMatchStand()")
            sc.step_frames(30, 1 / 60, render=False)
            im["street"] = sc.js("() => window.__LCKIT__.inMatchMeasure()")
            im["streetShot"] = os.path.join(shots, "citykit_inmatch_street.png")
            sc.canvas_png(im["streetShot"], "window.__H_PUMP__.frame(1e-6, true)")
            im["dispose"] = sc.js("() => window.__LCKIT__.inMatchDispose()")
            im["diag"] = sc.diagnostics()
            IM = im
        finally:
            sc.close()
        v.data["inMatch"] = IM
    v.data["failpaths"] = {k: (FP[k] if k != "gl" else {kk: vv for kk, vv in FP["gl"].items() if kk not in ("colliders", "ranges")}) for k in FP}

    # ================================================================== the rows
    def row(name, cond, detail, expect=None):
        # in plant mode only the designated rows count
        if plant and name not in rows_of_plant:
            v.info(name + " (plant: not designated)", detail)
            return
        v.check(name, cond, detail, expect)

    def guarded(name, fn):
        """Run one row; a row whose data is missing or malformed FAILS (a planted fault can break the data a row reads) instead of ending the run."""
        try:
            cond, detail = fn()
        except Exception as e:
            cond, detail = False, "row crashed (%s: %s): the data it reads is missing or malformed" % (type(e).__name__, str(e)[:200])
        row(name, cond, detail)

    ok_main = isinstance(M, dict) and M.get("res") and M["res"]["colliders"] > 0
    problems = C.diag_problems(diag, rig=False)
    v.check("boot", bool(ok_main) and (not problems or bool(plant)),
            "citykit.js imported, %d entries -> %d meshes, %d colliders; %s" % (M["counts"]["entries"], M["res"]["meshes"], M["res"]["colliders"], ", ".join(problems) or "0 page / console / shader errors, 0 failed requests"))
    if not ok_main:
        return
    used = sorted(set(e["type"] for e in M["list"]))
    dA = M["detailAll"]
    st0 = M["stats0"]["districts"]

    def r_colliders_node():
        ref = node_colliders(M["list"])
        return ref == M["colliders"], "%d boxes in the browser, %d in Node; first difference at index %s" % (
            len(M["colliders"]), len(ref), next((i for i, (a, b) in enumerate(zip(ref, M["colliders"])) if a != b), "none"))
    guarded("colliders-node", r_colliders_node)
    guarded("collider-shape", lambda: (M["colliderKeys"] == ["kind", "minX", "maxX", "minY", "maxY", "minZ", "maxZ", "dir", "prop", "idx", "hp", "dead", "_qs"], "keys %s" % M["colliderKeys"]))

    def r_glb_fail():
        gl, nom = FP["gl"], FP["nomanifest"]
        # every failed request of session B is a blocked kit GLB, or the deliberately unreachable manifest of the second half of failpaths()
        only_blocked = all(("HTTP 404" in f and (any(b in f for b in set(blocked)) or "NO_SUCH_MANIFEST.json" in f)) for f in diagB["failedRequests"]) if diagB["failedRequests"] else False
        pe_b = diagB["pageErrors"] + diagB["windowErrors"]
        same = gl["hash"] == M["colliderHash"] and gl["ranges"] == M["ranges"] and len(gl["colliders"]) == len(M["colliders"])
        boxes_ok = gl["stats"]["fallbackBoxes"] == 300 and all(d["fallbackBoxes"] == d["instances"] and d["detailCalls"] == 1 for d in gl["dist"].values()) and gl["kitCalls"] == 6
        return (same and sorted(gl["failed"]) == used and boxes_ok and not pe_b and only_blocked and len(blocked) > 0 and nom["hash"] == M["colliderHash"] and nom["failed"] == len(used),
                "GLB 404: hash %s vs %s, %d colliders each, %d of %d used types reported failed, %d fallback boxes in %d calls, %d GLB requests blocked, page errors %d, "
                "failed requests all blocked GLBs: %s; manifest unreachable: hash %s, %d failed, %d calls" % (
                    gl["hash"], M["colliderHash"], len(gl["colliders"]), gl["nFailed"], len(used), gl["stats"]["fallbackBoxes"], gl["kitCalls"], len(blocked), len(pe_b), only_blocked, nom["hash"], nom["failed"], nom["kitCalls"]))
    guarded("colliders-glb-fail", r_glb_fail)

    guarded("calls", lambda: (dA["measured"]["calls"] == dA["expectCalls"] == dA["stats"]["detailDrawCalls"] and M["counts"]["districts"] == 6 and M["counts"]["entries"] == 300,
            "%d entries in %d districts, %d types: measured %d kit draw calls == expected %d (sum of distinct types per district: %s) == stats() %d" % (
                M["counts"]["entries"], M["counts"]["districts"], M["counts"]["types"], dA["measured"]["calls"], dA["expectCalls"], M["expect"]["districtTypes"], dA["stats"]["detailDrawCalls"])))
    gtris = dA["stats"]["detailTriangles"]
    guarded("triangles", lambda: (dA["measured"]["triangles"] == gtris and pct_err(gtris, dA["expectTris"]) <= 0.02,
            "measured %d == stats() %d; manifest tris x instances %d (%.2f %% off, bar 2 %%)" % (dA["measured"]["triangles"], gtris, dA["expectTris"], 100 * pct_err(gtris, dA["expectTris"]))))

    lod_info = {}

    def r_lod():
        lod_bad = []
        for view in ("drop", "street", "skyline"):
            L = M["lod_" + view]
            post = {p["id"]: p["far"] for p in L["post"]}
            far_n = 0
            for r in L["pre"]:
                exp_far = r["thr"] is not None and r["dist"] >= r["thr"]          # fresh start: all detail, so no hysteresis relief
                if post[r["id"]] != exp_far:
                    lod_bad.append("%s/%s dist %.1f thr %s got far=%s" % (view, r["id"], r["dist"], r["thr"], post[r["id"]]))
                rr = L["statsRows"][r["id"]]["radius"]
                if r["thr"] is None or abs(r["thr"] - (250 + rr)) > 0.01:       # the threshold is 250 m + the district's own radius
                    lod_bad.append("%s/%s threshold %s != 250 + radius %.3f" % (view, r["id"], r["thr"], 250 + rr))
                far_n += 1 if post[r["id"]] else 0
            if L["measuredKitCalls"] != L["drawn"]["calls"] or L["measuredKitTris"] != L["drawn"]["tris"]:
                lod_bad.append("%s measured %d calls / %d tris != frustum test %d / %d" % (view, L["measuredKitCalls"], L["measuredKitTris"], L["drawn"]["calls"], L["drawn"]["tris"]))
            if L["measuredKitCalls"] != L["stats"]["currentDrawCalls"] and L["drawn"]["calls"] == L["stats"]["currentDrawCalls"]:
                lod_bad.append("%s measured %d calls != stats() %d" % (view, L["measuredKitCalls"], L["stats"]["currentDrawCalls"]))
            lod_info[view] = "%d far, %d detail: %d calls, %d tris (all-detail %d calls)" % (far_n, len(L["pre"]) - far_n, L["measuredKitCalls"], L["measuredKitTris"], dA["measured"]["calls"])
        mixed = any(any(p["far"] for p in M["lod_" + vw]["post"]) and not all(p["far"] for p in M["lod_" + vw]["post"]) for vw in ("drop", "street", "skyline"))
        hy = M.get("hysteresis")
        hy_ok = bool(hy) and hy["farStaysFar98"] and hy["farBecomesDetail94"] and hy["detailStaysDetail98"] and hy["detailBecomesFar101"]
        if not hy_ok:
            lod_bad.append("hysteresis %s" % hy)
        return (not lod_bad and mixed, "; ".join("%s: %s" % kv for kv in lod_info.items()) + (" | BAD: " + "; ".join(lod_bad[:4]) if lod_bad else "") + ("" if mixed else " | no view mixed detail and far") +
                "; hysteresis at %s m: far holds at 0.98, drops to detail at 0.94, detail holds at 0.98, collapses at 1.01: %s" % (hy and hy["thr"], hy_ok))
    guarded("lod", r_lod)

    def r_culling():
        cu = M["cull"]
        exp_ok = all(cu[vw]["kitCalls"] == cu[vw]["expected"]["calls"] and cu[vw]["kitTris"] == cu[vw]["expected"]["tris"] for vw in cu)
        ok = exp_ok and cu["away"]["kitCalls"] == 0 and cu["all"]["kitCalls"] == dA["expectCalls"] and cu["street"]["kitCalls"] < cu["all"]["kitCalls"] and 0 < cu["one"]["kitCalls"] < cu["all"]["kitCalls"]
        ok = ok and cu["one"]["districtsInFrustum"] == ["town:outpost"] and cu["all"]["kitTris"] > cu["street"]["kitTris"] > 0
        return ok, ("kit draw calls by view: away %d (outside every district, looking away) / one %d (looking at district 0 only: districts in frustum %s) / street %d / sky %d (inside district 0: its per-type spheres contain the camera, by design) / all %d; "
                    "every view equals the frustum test on the bounding spheres (calls and triangles); street draws %d tris of %d" % (
                        cu["away"]["kitCalls"], cu["one"]["kitCalls"], cu["one"]["districtsInFrustum"], cu["street"]["kitCalls"], cu["sky"]["kitCalls"], cu["all"]["kitCalls"], cu["street"]["kitTris"], cu["all"]["kitTris"]))
    guarded("culling", r_culling)

    def r_spheres():
        sph_bad = []
        for sp in M["spheres"]:
            did = sp.get("district")
            if not sp["has"] or sp["r"] <= 0 or sp["centre"] is None:
                sph_bad.append("%s no sphere" % sp["name"])
                continue
            D = st0.get(did)
            if D is None:
                sph_bad.append("%s unknown district" % sp["name"])
                continue
            # the sphere is centred on the box of its instances' sphere centres and reaches the farthest instance sphere: its centre lies inside the district
            # and its radius within the district's plus one building's own sphere. What matters is that it is a DISTRICT sphere, not a map-wide one.
            dc = ((sp["centre"][0] - D["centre"][0]) ** 2 + (sp["centre"][1] - D["centre"][1]) ** 2 + (sp["centre"][2] - D["centre"][2]) ** 2) ** 0.5
            if dc > D["radius"] + 2.0 or sp["r"] > D["radius"] + (sp["geomR"] or 0) + 2.0:
                sph_bad.append("%s: centre %.1f m from the district centre (district r %.1f), r %.1f (building r %.1f)" % (sp["name"], dc, D["radius"], sp["r"], sp["geomR"] or 0))
            if sp["r"] > 300:
                sph_bad.append("%s r %.1f > 300" % (sp["name"], sp["r"]))
        return (not sph_bad and len(M["spheres"]) == dA["expectCalls"] and max(sp["r"] for sp in M["spheres"]) <= 300,
                "%d InstancedMeshes, each with its own computed sphere, centred inside its district, radius within the district's + one building (district radii %s m); radii %.1f..%.1f m, none map-wide (the Wave-4 prop meshes were 850-1,011 m)%s" % (
                    len(M["spheres"]), sorted(round(d["radius"]) for d in st0.values()), min(sp["r"] for sp in M["spheres"]), max(sp["r"] for sp in M["spheres"]), (" | BAD " + "; ".join(sph_bad[:3])) if sph_bad else ""))
    guarded("bounding-spheres", r_spheres)

    def r_dispose():
        cy, base = cyc["rows"], cyc["base"]
        flat_ok = all(r["after"]["geometries"] == base["geometries"] and r["after"]["textures"] == base["textures"] and r["kitObjectsLeft"] == 0 for r in cy)
        placed_up = all(r["placed"]["geometries"] > base["geometries"] and r["placed"]["textures"] > base["textures"] for r in cy)
        progs = [r["placed"]["programs"] for r in cy]
        no_new = cy[1]["placed"]["programs"] == cy[0]["placed"]["programs"] and cy[2]["placed"]["programs"] == cy[0]["placed"]["programs"]
        return (flat_ok and placed_up and no_new and M["disposeCounts"]["instancedMeshes"] == dA["expectCalls"] and M["afterDispose"]["kitObjects"] == 0,
                "baseline geometries %d textures %d; per cycle placed %s, after dispose %s; programs per cycle %s; kit objects left %s; dispose() freed %s" % (
                    base["geometries"], base["textures"], [(r["placed"]["geometries"], r["placed"]["textures"]) for r in cy], [(r["after"]["geometries"], r["after"]["textures"]) for r in cy], progs, [r["kitObjectsLeft"] for r in cy], M["disposeCounts"]))
    guarded("dispose", r_dispose)

    def r_types():
        bad = [r for r in ty["rows"] if r["failed"] or abs(r["tris"] - r["manifestTris"]) > max(2, 0.02 * r["manifestTris"]) or r["calls"] != r["parts"]]
        return (len(ty["rows"]) == 81 and not bad and not ty["failed"],
                "%d types placed, %d failed to load, %d off the manifest triangles by more than 2 %%%s; %d boxes, %d textures" % (
                    len(ty["rows"]), len(ty["failed"]), len(bad), (": " + ", ".join(r["id"] for r in bad[:4])) if bad else "", ty["boxes"], ty["textures"]))
    guarded("all-types", r_types)

    def r_themes():
        TH = th["THEMES"]
        exp_ids = set()
        for t in th["names"]:
            for key in ("suburban", "commercial"):
                exp_ids.add("%s:%s:%x" % (key, TH[t]["variant"][key], TH[t]["tint"]))
        exp_ids.add("suburban:sand:ffffff")                                                   # the explicit per-entry variant inside the city district
        got_ids = set(g.split("=", 1)[1] for gs in th["districts"].values() for g in gs)
        n_tex = len(set((i.split(":")[0], i.split(":")[1]) for i in exp_ids))
        return (got_ids == exp_ids and th["distinctMaterials"] == len(exp_ids) and th["textures"] == n_tex and len(set(th["tints"])) > 3,
                "%d shared materials for %d (palette, variant, tint) ids, %d textures (one per palette x variant: %d expected), tints %s; ids %s" % (th["distinctMaterials"], len(exp_ids), th["textures"], n_tex, sorted(set(th["tints"])), sorted(got_ids)))
    guarded("themes", r_themes)

    guarded("agreement", lambda: (ag["entries"] == 324 and ag["bad"] == 0 and ag["worst"] <= 0.3 + 1e-6,
            "%d instances (81 types x 4 quarter turns): every collider box lies inside the DRAWN instance's bounding box (+0.3 m, the intake rule); worst overshoot %.3f m, %d outside%s" % (
                ag["entries"], ag["worst"], ag["bad"], (": " + json.dumps(ag["rows"][:3])) if ag["rows"] else "")))

    def r_misc():
        ok = mi["preload"] == {"loaded": 3, "failed": 0} and mi["skipped"] == 1 and mi["inexact"] == 1 and mi["yawBoxes"] > mi["manifestBoxes"]
        ok = ok and all(d.startswith("cell:") for d in mi["districts"]) and len(mi["districts"]) == 3
        auto = {t: c for t, c in mi["shadowAuto"]}
        ok = ok and auto["suburban/building-type-a"] and auto["cars/sedan"] and not auto["props/hydrant"]                 # buildings and cars cast, a hydrant does not
        ok = ok and not any(c for _, c in mi["shadowOff"]) and all(c for _, c in mi["shadowOn"]) and mi["shadowBack"] == mi["shadowAuto"]
        ok = ok and abs(mi["sedanScale"] - mi["sedanExpect"]) < 0.002 and mi["kitCalls"] == mi["stats"]["detailDrawCalls"] and mi["placeAfterDisposeThrows"] and mi["dispose"]["instancedMeshes"] == mi["stats"]["detailDrawCalls"]
        return ok, ("preload %s; entries without a district chunked on the grid: %s; %d skipped; a free yaw (ry 0.5) draws and has %d boxes against the quarter-turn %d (inexactEntries %d); "
                    "shadows auto/off/on/auto: %s; sedan at scale 1.5: |m00| %.3f vs %.3f; %d kit calls from above == stats() %d; place() after dispose() throws: %s" % (
                        mi["preload"], mi["districts"], mi["skipped"], mi["yawBoxes"], mi["manifestBoxes"], mi["inexact"], [c for _, c in mi["shadowAuto"]], mi["sedanScale"], mi["sedanExpect"], mi["kitCalls"], mi["stats"]["detailDrawCalls"], mi["placeAfterDisposeThrows"]))
    guarded("api", r_misc)

    guarded("far-only", lambda: (fo["glbRequests"] == 0 and fo["kitCalls"] == 2 and fo["colliders"] > 0 and all(x == "far" for x in fo["lods"]) and fo["failed"] == 0,
            "lod:'far' for %d buildings in 2 districts: %d GLB requests, %d kit draw calls, %d proxy triangles, %d colliders" % (
                fo["totals"]["instances"], fo["glbRequests"], fo["kitCalls"], fo["kitTris"], fo["colliders"])))

    if IM:
        def r_im_warm():
            pl = IM["place"]
            news = [x[2] for x in IM["drop"]["withKit"] + IM["drop"]["without"] + IM["street"]["withKit"] + IM["street"]["without"]]
            probs = C.diag_problems(IM["diag"], rig=False)
            return (not any(news) and not probs and pl["failed"] == 0 and pl["colliders"] == 640 and pl["programsAfterWarm"] - pl["programsBeforeWarm"] <= 8,
                    "createCityKit({ W }) placed 300 buildings on %s terrain (y %s..%s, %d wet) in %.0f ms; kernel.warmup took programs %s -> %s; new programs over %d drop-camera and %d street frames: %s; %s" % (
                        pl["map"], pl["terrain"]["ymin"], pl["terrain"]["ymax"], pl["terrain"]["wet"], pl["placeMs"], pl["programsBeforeWarm"], pl["programsAfterWarm"], len(IM["drop"]["withKit"]) * 2, len(IM["street"]["withKit"]) * 2, sum(news), ", ".join(probs) or "0 page / console / shader errors"))
        guarded("inmatch-warm", r_im_warm)

        def r_im_cost():
            rows, ok = [], True
            for view in ("drop", "street"):
                a, b = IM[view]["withKit"], IM[view]["without"]
                for i in range(len(a)):
                    dc, dt, base = a[i][0] - b[i][0], a[i][1] - b[i][1], b[i][1]
                    if dc > 40 or dt > 0.25 * base or dc < 0:
                        ok = False
                    if i < 3:
                        rows.append("%s f%d: +%d calls, +%d tris (%.1f %% of %d)" % (view, i, dc, dt, 100.0 * dt / base, base))
            return ok, "%s; kit LOD states at street: %s" % ("; ".join(rows), IM["street"]["lod"])
        guarded("inmatch-cost", r_im_cost)
        v.data["shots"]["inmatch_drop"], v.data["shots"]["inmatch_street"] = IM["dropShot"], IM["streetShot"]

    # ------------------------------------------------------------------ information
    v.info("place() time", "%.0f ms for 300 buildings in 6 districts (GLBs and palettes fetched through the kernel loader, cold)" % M["placeMs"])
    st = M["stats1"]["totals"]
    v.info("kit totals", "%d instances, %d districts, detail %d calls / %d tris, proxies %d calls / %d tris, %d textures, %d materials" % (
        st["instances"], st["districts"], st["detailDrawCalls"], st["detailTriangles"], st["proxyDrawCalls"], st["proxyTriangles"], st["textures"], st["materials"]))
    for view in ("drop", "street", "skyline"):
        v.info("view " + view, lod_info[view])
    sh = M["shadows"]
    v.info("shadow pass (information)", "street view: kit %d calls / %d tris without shadows, %d calls / %d tris with the sun's shadow pass (the +-120 m shadow box)" % (
        sh["off"]["calls"], sh["off"]["tris"], sh["on"]["calls"], sh["on"]["tris"]))
    types_used = sorted(set(e["type"] for e in M["list"]) | set(r["id"] for r in ty["rows"]))
    glb_bytes_300 = sum(T[t]["bytes"] for t in used)
    pal_bytes = 0
    for k, p in man["palettes"].items():
        pal_bytes += p["bytes"]
    v.info("download for the 300-building scene", "%d GLBs = %d B, all palettes %d B; whole kit (81 types) %d B" % (len(used), glb_bytes_300, pal_bytes, sum(t["bytes"] for t in T.values())))
    v.info("programs", "%s after the first full render" % M["programs"])
    table = sorted(ty["rows"], key=lambda r: -r["tris"])
    v.data["perTypeTriangles"] = [{"id": r["id"], "tris": r["tris"], "manifest": r["manifestTris"], "parts": r["parts"], "kind": r["kind"], "bytes": r["bytes"], "scale": r["scale"]} for r in table]
    v.info("per-type triangle table", "top 6: " + ", ".join("%s %d" % (r["id"].split("/")[1], r["tris"]) for r in table[:6]) + "; whole table in the JSON report (81 rows)")
    v.info("screenshots", ", ".join(v.data["shots"].values()))
    v.data["info"] = {"lod": lod_info}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.set_defaults(disk=True)
    ap.add_argument("--shots", default=None, help="directory for the screenshots (default _harness/_shots)")
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS), help="serve a citykit.js with a planted fault; exit 1 = detected")
    ap.add_argument("--in-match", action="store_true", help="also place the kit inside a real standard match (ashgrid, seed 7) and judge the warm-up and the frame cost")
    ap.add_argument("--map", default="ashgrid", help="the --in-match map (default %(default)s)")
    args = ap.parse_args()
    if args.plant:
        args.report = args.report or "citykit_probe_plant_" + args.plant
    code = C.run_gate(GATE, lambda v: main_fn(v, args), args)
    return code


if __name__ == "__main__":
    sys.exit(main())
