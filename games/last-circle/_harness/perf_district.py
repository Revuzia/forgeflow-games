#!/usr/bin/env python
"""perf_district - what does a district COST?  Fixed cameras, exact counts, against a frozen baseline revision.
(Last Circle world plan, section 4, lane 6E.)

    python _harness/perf_district.py --disk                       # the working copy vs the baseline (default common.LIVE_REV = the live build 60b854d0), ashgrid
    python _harness/perf_district.py --rev <Wave-6 commit> --baseline <older commit> --maps ashgrid,isla_viva,deepwood
    python _harness/perf_district.py --disk --plant extra-calls   # negative control: +60 draw calls planted (must exit 1)
    python _harness/perf_district.py --disk --plant extra-tris    # negative control: +820k triangles planted (must exit 1)
    python _harness/perf_district.py --disk --phone               # the PHONE tier (Wave 7): a Pixel 7 context (915x412, DPR 2.625, touch, no pointer lock), same views and rows; gate.py runs it as INFORMATION

For every map: ONE Chrome serves the baseline revision (git, through page routing) and ONE the candidate (the working copy, or --rev), each
loads a standard match at --seed (7), lands, freezes the loop, and renders THREE fixed views through the game's own composer, exactly once,
with renderer.info reset right before it (info.autoReset is off; one reset = the WHOLE frame: shadow pass, scene, bloom, output):
  drop     330 m up and 170 m west / 260 m south of the drop-target town, looking at it (fov 60)  - the "city lane" view: 308 / 515 / 251 calls at HEAD
  street   eye height 1.62 m at the west end of a town's main street, looking east (fov 70)
  endgame  8 m up, 55 m west / 50 m south of the CENTRE of storm circle 6 (matched seed; lifted 4 m at a time out of any collider), looking at it (fov 70)
Each view is rendered twice: with the 50 actors as the match left them (callsAll / trisAll: what a player's frame costs) and with every actor
hidden (calls / tris: the WORLD alone, so a bot standing in one revision's frame and not in the other's cannot move the delta).

Rows (per map; counts are exact criteria, milliseconds are not measured here):
  calls-vs-baseline   every view: world calls <= baseline + 40
  tris-vs-baseline    every view: world triangles <= baseline x 1.25
  drop-view-calls     the drop view (actors as left) <= 450 calls                       (Isla Viva was 515 at bbd6aeae)
The baseline numbers are cached in _reports/perf_district_base_<sha>_<map>_s<seed>_<gpu>_<w>x<h>.json (a commit is frozen, so the cache is
honest; the _v<N> suffix is the view-spec version; --no-cache re-measures). Screenshots of the candidate's three views go to _shots/ - LOOK at them.
--plant NAME changes the CANDIDATE after the match is loaded (never a file): extra-calls adds 60 always-drawn meshes (+60 calls), extra-tris
adds 10 always-drawn 82k-triangle spheres (IcosahedronGeometry detail 63 = 20 x 64^2 faces, +820k); in plant mode only the designated row counts and exit 1 = the planted cost was seen.
Exit 0 pass / 1 fail / 2 could-not-judge (server refused, a match load timed out, a view measured nothing).
"""
from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import mobilekit as MK  # noqa: E402

GATE = "perf_district"
DEFAULT_BASELINE = C.LIVE_REV            # the LIVE build (common.LIVE_REV: 60b854d0, the Wave-6 release). After a deploy move common.LIVE_REV, nothing else
CALLS_MAX_DELTA = 40
TRIS_MAX_RATIO = 1.25
DROP_CALLS_MAX = 450
DROP_AT = {"ashgrid": "downtown", "isla_viva": "coco_village", "deepwood": "logging"}
STREET = {"ashgrid": "outpost", "isla_viva": "coco_village", "deepwood": "lakeside"}
VIEWS = ["drop", "street", "endgame"]
VIEWSPEC = 2                            # bump when SPEC_JS changes (it names the cached baseline files)
PLANT_ROWS = {"extra-calls": {"calls-vs-baseline"}, "extra-tris": {"tris-vs-baseline"}}

# Everything below runs in the page. One call = one view.
PLANT_JS = r"""(kind) => { const W = window.__LC__.W, T = W.THREE, sc = W.kernel.scene;
  if (!T) return 'no W.THREE';
  const g = new T.Group(); g.name = 'perf-plant';
  if (kind === 'extra-calls') {
    for (let i = 0; i < 60; i++) { const m = new T.Mesh(new T.BoxGeometry(0.2, 0.2, 0.2), new T.MeshBasicMaterial({ color: 0xff00ff })); m.frustumCulled = false; m.castShadow = false; g.add(m); }
  } else if (kind === 'extra-tris') {
    for (let i = 0; i < 10; i++) { const m = new T.Mesh(new T.IcosahedronGeometry(1, 63), new T.MeshBasicMaterial({ color: 0xff00ff })); m.frustumCulled = false; m.castShadow = false; m.scale.setScalar(0.1); g.add(m); }
  } else return 'unknown plant';
  sc.add(g); let tris = 0, n = 0; g.traverse((o) => { if (o.isMesh) { n++; tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; } });
  return { meshes: n, tris }; }"""

SPEC_JS = r"""([kind, opt]) => { const W = window.__LC__.W, M = W.map;
  const H = (x, z) => M.heightAt(x, z);
  const poi = (id) => M.pois.find((p) => p.id === id);
  let spec;
  if (kind === 'drop') { const p = poi(opt.dropAt); spec = [p.x - 170, 330, p.z + 260, p.x, 0, p.z, 60]; }
  else if (kind === 'street') { const p = poi(opt.streetAt), x0 = p.x - p.r * 0.55, z = p.z + 1; spec = [x0, H(x0, z) + 1.62, z, x0 + 60, H(x0 + 60, z + 1) + 1.8, z + 1, 70]; }
  else {
    // the endgame: 8 m up on the rim of storm circle 6 (matched seed), looking at its centre; never start inside a collider
    const S = new W.SIM.Storm({ seed: W.seed, mode: W.mode || 'standard', half: M.half }); const c = S.circles[S.circles.length - 3];
    const px = c.x - 55, pz = c.z + 50; let py = H(px, pz) + 8;
    for (let i = 0; i < 8; i++) { let inside = false;
      for (const q of M.queryColliders(px, pz, 0.5, [])) if (px > q.minX && px < q.maxX && pz > q.minZ && pz < q.maxZ && py > q.minY && py < q.maxY) { inside = true; break; }
      if (!inside) break; py += 4; }
    spec = [px, py, pz, c.x, H(c.x, c.z) + 1.5, c.z, 70]; }
  // the terrain's near ring follows W._camFocus (what city_probe.py did): put it under the camera
  W._camFocus = { pos: { x: spec[0], y: 0, z: spec[2] } }; if (W.camera) W.camera.position.set(spec[0], 50, spec[2]);
  return spec; }"""

VIEW_JS = r"""([kind, spec, opt]) => { const W = window.__LC__.W, k = W.kernel, cam = k.camera, r = k.renderer, sc = k.scene;
  const [px, py, pz, tx, ty, tz, fov] = spec;
  const of = cam.fov; cam.fov = fov; cam.updateProjectionMatrix();
  const draw = () => { if (r.shadowMap && r.shadowMap.enabled) r.shadowMap.needsUpdate = true; r.info.reset();
    cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(true);
    if (k.composer) k.composer.render(1 / 60); else r.render(sc, cam);
    return { calls: r.info.render.calls, tris: r.info.render.triangles }; };
  const all = draw();
  const png = opt.png ? r.domElement.toDataURL('image/png') : null;
  // the world alone: hide every actor (body + weapon, chute, name tag), draw again, restore
  const saved = [];
  for (const a of (W.actors || [])) for (const key of ['obj', 'chute', 'nameTag', 'weaponMesh']) { const o = a[key]; if (o && typeof o.visible === 'boolean') { saved.push([o, o.visible]); o.visible = false; } }
  const world = draw();
  for (const [o, v] of saved) o.visible = v;
  cam.fov = of; cam.updateProjectionMatrix();
  const mem = r.info.memory, prog = r.info.programs ? r.info.programs.length : -1;
  return { view: kind, camera: spec.map((v) => Math.round(v * 10) / 10), calls: world.calls, tris: world.tris, callsAll: all.calls, trisAll: all.tris, hidden: saved.length,
    programs: prog, geometries: mem.geometries, textures: mem.textures, png }; }"""


def f(v, nd=0):
    return "-" if v is None else ("%.*f" % (nd, v))


def git_sha(rev):
    sha = subprocess.run(["git", "-C", C.REPO, "rev-parse", rev], capture_output=True, text=True).stdout.strip()
    if not sha:
        raise C.HarnessError("unknown git revision %r" % rev)
    return sha


def measure(args, label, map_id, rev, plant, save_png):
    """One Chrome, one match, three views. rev None = the working copy (--disk)."""
    a = copy.copy(args)
    a.rev = rev
    a.disk = True
    res = {"label": label, "map": map_id, "seed": args.seed, "views": {}}
    sess_kw = {}
    if args.phone:                      # the phone tier: what a Pixel 7 gets (touch defaults: tier medium, DPR 2.625), mobile.py's context
        dev = MK.DEVICES["pixel7"]
        sess_kw = {"viewport": {"width": dev["w"], "height": dev["h"]}, "context_kw": {"device_scale_factor": dev["dpr"], "is_mobile": True, "has_touch": True, "user_agent": dev["ua"]},
                   "init_scripts": [MK.PHONE_NO_LOCK]}
    with C.Session(a, name="perf_district", **sess_kw) as s:
        s.boot()
        s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
        t0 = time.time()
        res["load"] = s.start_match(mode="standard", seed=args.seed, map_id=map_id)
        res["land"] = s.land(max_s=90, protect=True)
        s.guard_player(True)
        s.freeze_loop()
        res["tier"] = s.safe_js("() => window.__LC__.W.settings && window.__LC__.W.settings.graphics")
        res["dpr"] = s.safe_js("() => window.devicePixelRatio")
        res["viewport"] = [sess_kw["viewport"]["width"], sess_kw["viewport"]["height"]] if args.phone else [args.width, args.height]
        print("  [%s %s] loaded in %.0f s, landed %s, tier %s" % (label, map_id, time.time() - t0, res["land"].get("onGround"), res["tier"]), flush=True)
        if plant:
            res["plant"] = s.js(PLANT_JS, plant)
            print("  [%s %s] plant %s: %s" % (label, map_id, plant, res["plant"]), flush=True)
        opt = {"dropAt": DROP_AT[map_id], "streetAt": STREET[map_id], "png": bool(save_png)}
        for kind in VIEWS:
            spec = s.js(SPEC_JS, [kind, opt])
            s.step_frames(14, dt=1.0 / 20, render=False)
            s.step_frames(12, dt=1.0 / 20, render=False)
            r = s.js(VIEW_JS, [kind, spec, opt])
            png = r.pop("png", None)
            if png and save_png:
                os.makedirs(C.SHOTS, exist_ok=True)
                path = os.path.join(C.SHOTS, "perf_district_%s_%s_%s.png" % (label.replace(" ", "_"), map_id, kind))
                with open(path, "wb") as fh:
                    fh.write(base64.b64decode(png.split(",", 1)[1]))
                r["png"] = path
            res["views"][kind] = r
            print("  [%s %s] %-7s world %4d calls %9d tris | with actors %4d calls %9d tris | programs %s geometries %s textures %s" % (
                label, map_id, kind, r["calls"], r["tris"], r["callsAll"], r["trisAll"], r["programs"], r["geometries"], r["textures"]), flush=True)
        res["pageErrors"] = [e[1][:200] for e in s.page_errors][:3]
        res["failedRequests"] = len(s.failed)
    return res


def cache_path(sha, map_id, args):
    return os.path.join(C.REPORTS, "perf_district_base_%s_%s_s%d_%s_%dx%d_v%d%s.json" % (sha[:8], map_id, args.seed, args.gpu, args.width, args.height, VIEWSPEC, "_phone" if args.phone else ""))


def base_numbers(args, map_id, sha):
    p = cache_path(sha, map_id, args)
    if os.path.exists(p) and not args.no_cache:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        print("  [baseline %s] cached %s" % (map_id, os.path.basename(p)), flush=True)
        return d
    d = measure(args, "baseline %s" % sha[:8], map_id, sha, None, False)
    os.makedirs(C.REPORTS, exist_ok=True)
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(d, fh)
    return d


class PlantView:
    def __init__(self, v, rows):
        self._v, self._rows = v, rows

    def check(self, name, ok, detail="", expect=None):
        base = name.split(" [")[0]
        if base in self._rows:
            return self._v.check(name, ok, detail, expect)
        self._v.info(name + " (not counted in plant mode)", detail)
        return ok

    def cnj(self, name, why):
        return self.check(name, None, why)

    def __getattr__(self, k):
        return getattr(self._v, k)


def main_fn(v0, args):
    plant = args.plant
    if plant and plant not in PLANT_ROWS:
        raise C.HarnessError("unknown --plant %r (known: %s)" % (plant, ", ".join(sorted(PLANT_ROWS))))
    v = PlantView(v0, PLANT_ROWS[plant]) if plant else v0
    if plant and not (args.disk or args.rev):
        raise C.EnvFailure("--plant needs --disk or --rev (the candidate is served through page routing)")
    maps = [m for m in args.maps.split(",") if m]
    bsha = git_sha(args.baseline)
    if args.rev:
        csha = git_sha(args.rev)
        clabel, crev = "candidate %s" % csha[:8], args.rev
    else:
        clabel, crev = "working copy", None
    v0.data.update({"baseline": bsha, "candidate": clabel, "seed": args.seed, "maps": maps, "plant": plant})
    print("%s: %s vs baseline %s | maps %s | seed %d | plant %s" % (GATE, clabel, bsha[:8], ",".join(maps), args.seed, plant or "none"), flush=True)
    out = {}
    for m in maps:
        base = base_numbers(args, m, bsha)
        cand = measure(args, clabel, m, crev, plant, True)
        out[m] = {"baseline": base, "candidate": cand}
        if cand["pageErrors"] or cand["failedRequests"]:
            v0.check("errors [%s]" % m, False, "page errors %s, failed requests %d" % (cand["pageErrors"], cand["failedRequests"]))
        rows_c, rows_t, bad_c, bad_t = [], [], [], []
        for kind in VIEWS:
            b, c = base["views"].get(kind), cand["views"].get(kind)
            if not b or not c or not b["calls"] or not c["calls"]:
                v.cnj("%s view [%s]" % (kind, m), "a view measured nothing (baseline %s, candidate %s)" % (b and b["calls"], c and c["calls"]))
                continue
            dc = c["calls"] - b["calls"]
            ratio = c["tris"] / b["tris"] if b["tris"] else 0
            rows_c.append("%s %d -> %d (%+d)" % (kind, b["calls"], c["calls"], dc))
            rows_t.append("%s %s -> %s (x%.3f)" % (kind, f(b["tris"]), f(c["tris"]), ratio))
            if dc > CALLS_MAX_DELTA:
                bad_c.append(kind)
            if ratio > TRIS_MAX_RATIO:
                bad_t.append(kind)
            v0.info("%s view [%s]" % (kind, m), "baseline: world %d calls %s tris, with actors %d calls | candidate: world %d calls %s tris, with actors %d calls | programs %s -> %s, geometries %s -> %s, textures %s -> %s | %s" % (
                b["calls"], f(b["tris"]), b["callsAll"], c["calls"], f(c["tris"]), c["callsAll"], b["programs"], c["programs"], b["geometries"], c["geometries"], b["textures"], c["textures"], c.get("png", "")))
        if rows_c:
            v.check("calls-vs-baseline [%s]" % m, not bad_c, ("every view within +%d calls of the baseline: " % CALLS_MAX_DELTA if not bad_c else "over +%d calls in %s: " % (CALLS_MAX_DELTA, ", ".join(bad_c))) + "; ".join(rows_c), "<= +%d calls per view" % CALLS_MAX_DELTA)
            v.check("tris-vs-baseline [%s]" % m, not bad_t, ("every view within x%.2f triangles of the baseline: " % TRIS_MAX_RATIO if not bad_t else "over x%.2f triangles in %s: " % (TRIS_MAX_RATIO, ", ".join(bad_t))) + "; ".join(rows_t), "<= x%.2f triangles per view" % TRIS_MAX_RATIO)
        d = cand["views"].get("drop")
        if d and d["callsAll"]:
            v.check("drop-view-calls [%s]" % m, d["callsAll"] <= DROP_CALLS_MAX, "drop view (actors as the match left them) %d calls (world alone %d); baseline %d" % (d["callsAll"], d["calls"], base["views"]["drop"]["callsAll"]), "<= %d calls" % DROP_CALLS_MAX)
    v0.data["views"] = out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="ashgrid", help="comma list (default ashgrid = Savanna, the Wave-7 pilot)")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE, help="git revision the candidate is compared with (default %s)" % DEFAULT_BASELINE)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--no-cache", action="store_true", help="re-measure the baseline instead of reading _reports/perf_district_base_*.json")
    ap.add_argument("--phone", action="store_true", help="the PHONE tier: a Pixel 7 context (915x412, DPR 2.625, touch, pointer lock refused) for baseline and candidate (gate.py: INFORMATION)")
    args = ap.parse_args()
    if args.phone and not args.report:
        args.report = "perf_district_phone"
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
