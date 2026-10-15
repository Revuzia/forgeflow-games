#!/usr/bin/env python
"""perf_district - what does a district COST?  Fixed cameras, exact counts, against a frozen baseline revision.
(Last Circle world plan, section 4, lane 6E.)

    python _harness/perf_district.py --disk                       # the working copy vs the baseline (default common.LIVE_REV = the build LIVE on the CDN, dd414cb2 in Wave 7), ashgrid, seed 7
    python _harness/perf_district.py --disk --seeds 1,7,1234,2026,31337      # Wave-7 completion round: the five Savanna seeds (the city differs per seed: seeds 1 and 31337 cost the most)
    python _harness/perf_district.py --disk --seeds 1,7,1234,2026,31337 --baseline 60b854d0     # ... against the Wave-6 release (the plan's original bar: the cumulative cost of the city)
    python _harness/perf_district.py --disk --seeds 1,7,1234,2026,31337 --baseline dd414cb2,60b854d0   # BOTH in one run (gate.py): each candidate match is loaded once and judged against each baseline
    python _harness/perf_district.py --rev <Wave-6 commit> --baseline <older commit> --maps ashgrid,isla_viva,deepwood
    python _harness/perf_district.py --disk --plant extra-calls   # negative control: +60 draw calls planted (must exit 1)
    python _harness/perf_district.py --disk --plant extra-tris    # negative control: +820k triangles planted (must exit 1)
    python _harness/perf_district.py --disk --identical           # post-deploy (after moving common.LIVE_REV): the working copy must read the baseline's numbers (x1.000)
    python _harness/perf_district.py --disk --phone               # the PHONE tier (Wave 7): a Pixel 7 context (915x412, DPR 2.625, touch, no pointer lock), same views and rows; gate.py runs it as INFORMATION

For every map: ONE Chrome serves the baseline revision (git, through page routing) and ONE the candidate (the working copy, or --rev), each
loads a standard match at --seed (7), lands, freezes the loop, and renders THREE fixed views through the game's own composer, exactly once,
with renderer.info reset right before it (info.autoReset is off; one reset = the WHOLE frame: shadow pass, scene, bloom, output):
  drop     330 m up and 170 m west / 260 m south of the drop-target town, looking at it (fov 60)  - the "city lane" view: 308 / 515 / 251 calls at HEAD
  street   eye height 1.62 m at the west end of a town's main street, looking east (fov 70)
  endgame  8 m up, 55 m west / 50 m south of the CENTRE of storm circle 6 (matched seed; lifted 4 m at a time out of any collider), looking at it (fov 70)
Each view is rendered twice: with the 50 actors as the match left them (callsAll / trisAll: what a player's frame costs) and with every actor
hidden (calls / tris: the WORLD alone, so a bot standing in one revision's frame and not in the other's cannot move the delta).

Rows (per map and seed; counts are exact criteria, milliseconds are not measured here; the row names carry the seed, "[ashgrid s31337]", when --seeds names more than one):
  calls-vs-baseline   every view: world calls <= baseline + 40
  tris-vs-baseline    every view: world triangles <= baseline x 1.25
  drop-view-calls     the drop view (actors as left) <= 450 calls                       (Isla Viva was 515 at bbd6aeae)
The baseline numbers are cached in _reports/perf_district_base_<sha>_<map>_s<seed>_<gpu>_<w>x<h>.json (a commit is frozen, so the cache is
honest; the _v<N> suffix is the view-spec version; --no-cache re-measures): the first run against a new baseline measures one extra match per (map, seed), every later run loads ONE match per (map, seed). Screenshots of the candidate's three views go to _shots/ - LOOK at them.
--plant NAME changes the CANDIDATE after the match is loaded (never a file): extra-calls adds 60 always-drawn meshes (+60 calls), extra-tris
adds 10 always-drawn 82k-triangle spheres (IcosahedronGeometry detail 63 = 20 x 64^2 faces, +820k); since the Wave-7 completion round both are SIZED FROM THE BASELINES (at least those numbers): the candidate may be lighter than
the baseline, and a plant that cannot reach "+40 calls / x1.25" proves nothing; in plant mode only the designated row counts and exit 1 = the planted cost was seen.
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
DEFAULT_BASELINE = C.LIVE_REV            # the LIVE build (common.LIVE_REV, dd414cb2 = the Wave-7 release). After a deploy move common.LIVE_REV, nothing else
CALLS_MAX_DELTA = 40
TRIS_MAX_RATIO = 1.25
DROP_CALLS_MAX = 450
IDENTICAL_CALLS = 10                    # --identical: the same build measured twice differs by up to 8 world calls (the drop / endgame views carry 0-8 random sprite draws; measured: dd414cb2 seed 1 twice, 227 vs 219) ...
IDENTICAL_TRIS = 0.002                  # ... and by at most this share of triangles (18 of 2.2 M in the worst view seen)
DROP_AT = {"ashgrid": "downtown", "isla_viva": "coco_village", "deepwood": "logging"}
STREET = {"ashgrid": "outpost", "isla_viva": "coco_village", "deepwood": "lakeside"}
VIEWS = ["drop", "street", "endgame"]
VIEWSPEC = 2                            # bump when SPEC_JS changes (it names the cached baseline files)
PLANT_ROWS = {"extra-calls": {"calls-vs-baseline"}, "extra-tris": {"tris-vs-baseline"}}

# Everything below runs in the page. One call = one view.
PLANT_JS = r"""([kind, count]) => { const W = window.__LC__.W, T = W.THREE, sc = W.kernel.scene;
  if (!T) return 'no W.THREE';
  const g = new T.Group(); g.name = 'perf-plant';
  if (kind === 'extra-calls') {
    for (let i = 0; i < count; i++) { const m = new T.Mesh(new T.BoxGeometry(0.2, 0.2, 0.2), new T.MeshBasicMaterial({ color: 0xff00ff })); m.frustumCulled = false; m.castShadow = false; g.add(m); }
  } else if (kind === 'extra-tris') {
    for (let i = 0; i < count; i++) { const m = new T.Mesh(new T.IcosahedronGeometry(1, 63), new T.MeshBasicMaterial({ color: 0xff00ff })); m.frustumCulled = false; m.castShadow = false; m.scale.setScalar(0.1); g.add(m); }
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


def measure(args, label, map_id, rev, plant, save_png, seed=None, plant_n=None):
    """One Chrome, one match, three views. rev None = the working copy (--disk)."""
    seed = args.seed if seed is None else seed
    a = copy.copy(args)
    a.rev = rev
    a.disk = True
    res = {"label": label, "map": map_id, "seed": seed, "views": {}}
    sess_kw = {}
    if args.phone:                      # the phone tier: what a Pixel 7 gets (touch defaults: tier medium, DPR 2.625), mobile.py's context
        dev = MK.DEVICES["pixel7"]
        sess_kw = {"viewport": {"width": dev["w"], "height": dev["h"]}, "context_kw": {"device_scale_factor": dev["dpr"], "is_mobile": True, "has_touch": True, "user_agent": dev["ua"]},
                   "init_scripts": [MK.PHONE_NO_LOCK]}
    with C.Session(a, name="perf_district", **sess_kw) as s:
        s.boot()
        s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
        t0 = time.time()
        res["load"] = s.start_match(mode="standard", seed=seed, map_id=map_id)
        res["land"] = s.land(max_s=90, protect=True)
        s.guard_player(True)
        s.freeze_loop()
        res["tier"] = s.safe_js("() => window.__LC__.W.settings && window.__LC__.W.settings.graphics")
        res["dpr"] = s.safe_js("() => window.devicePixelRatio")
        res["viewport"] = [sess_kw["viewport"]["width"], sess_kw["viewport"]["height"]] if args.phone else [args.width, args.height]
        print("  [%s %s s%d] loaded in %.0f s, landed %s, tier %s" % (label, map_id, seed, time.time() - t0, res["land"].get("onGround"), res["tier"]), flush=True)
        if plant:
            res["plant"] = s.js(PLANT_JS, [plant, plant_n])
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
                path = os.path.join(C.SHOTS, "perf_district_%s_%s%s_%s.png" % (label.replace(" ", "_"), map_id, ("_s%d" % seed) if seed != 7 else "", kind))
                with open(path, "wb") as fh:
                    fh.write(base64.b64decode(png.split(",", 1)[1]))
                r["png"] = path
            res["views"][kind] = r
            print("  [%s %s] %-7s world %4d calls %9d tris | with actors %4d calls %9d tris | programs %s geometries %s textures %s" % (
                label, map_id, kind, r["calls"], r["tris"], r["callsAll"], r["trisAll"], r["programs"], r["geometries"], r["textures"]), flush=True)
        res["pageErrors"] = [e[1][:200] for e in s.page_errors][:3]
        res["failedRequests"] = len(s.failed)
        res["failedList"] = [str(x)[:220] for x in s.failed[:4]]
    return res


def cache_path(sha, map_id, args, seed=None):
    return os.path.join(C.REPORTS, "perf_district_base_%s_%s_s%d_%s_%dx%d_v%d%s.json" % (sha[:8], map_id, args.seed if seed is None else seed, args.gpu, args.width, args.height, VIEWSPEC, "_phone" if args.phone else ""))


def base_numbers(args, map_id, sha, seed=None):
    seed = args.seed if seed is None else seed
    p = cache_path(sha, map_id, args, seed)
    if os.path.exists(p) and not args.no_cache:
        with open(p, encoding="utf-8") as fh:
            d = json.load(fh)
        print("  [baseline %s s%d] cached %s" % (map_id, seed, os.path.basename(p)), flush=True)
        return d
    d = measure(args, "baseline %s" % sha[:8], map_id, sha, None, False, seed)
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
    seeds = [int(x) for x in args.seeds.split(",") if x.strip()] if args.seeds else [args.seed]
    multi = len(seeds) > 1
    bases = [x.strip() for x in args.baseline.split(",") if x.strip()]         # one or more baseline revisions; the candidate is loaded ONCE per (map, seed) and judged against each
    bshas = [git_sha(x) for x in bases]
    multib = len(bshas) > 1
    if args.rev:
        csha = git_sha(args.rev)
        clabel, crev = "candidate %s" % csha[:8], args.rev
    else:
        clabel, crev = "working copy", None
    v0.data.update({"baseline": bshas[0], "baselines": bshas, "candidate": clabel, "seed": seeds[0], "seeds": seeds, "maps": maps, "plant": plant})
    print("%s: %s vs baseline%s %s | maps %s | seed%s %s | plant %s" % (GATE, clabel, "s" if multib else "", ", ".join(x[:8] for x in bshas), ",".join(maps), "s" if multi else "", ",".join(str(x) for x in seeds), plant or "none"), flush=True)
    out = {}
    worst = {s_: {} for s_ in bshas}            # across the run, per baseline: the largest calls delta / triangle ratio / drop-view count and where (the margin the bars leave)
    for m, seed in [(m, sd) for m in maps for sd in seeds]:
        tag0 = ("%s s%d" % (m, seed)) if multi else m          # the row suffix; the single-seed form is unchanged from Wave 6 / 7
        bases_n = [base_numbers(args, m, bs, seed) for bs in bshas]
        plant_n = None
        if plant:
            # the plant must be able to cross the bar WHATEVER the candidate costs: sized from the baselines' own numbers (Wave-7 completion round: the candidate became lighter than the live build -
            # triangles x0.6-0.7, calls -20..-60 - so the original fixed +60 meshes / +820k triangles no longer reached "+40 calls / x1.25 of the baseline"). extra-calls: more meshes than the busiest baseline
            # view has world calls + the bar + 5; extra-tris: 1.3 x the busiest baseline view's triangles (82k per sphere). Either puts every view of ANY candidate over the bar.
            allb = [b for bn in bases_n for b in bn["views"].values() if b]
            if plant == "extra-calls":
                plant_n = max(60, max(b["calls"] for b in allb) + CALLS_MAX_DELTA + 5)
            else:
                plant_n = max(10, int(-(-1.3 * max(b["tris"] for b in allb) // 81920)))
        cand = measure(args, clabel, m, crev, plant, True, seed, plant_n)
        if cand["pageErrors"] or cand["failedRequests"]:
            v0.check("errors [%s]" % tag0, False, "page errors %s, failed requests %d %s" % (cand["pageErrors"], cand["failedRequests"], cand.get("failedList") or ""))
        for bsha, base in zip(bshas, bases_n):
            tag = ("%s vs %s" % (tag0, bsha[:8])) if multib else tag0
            out[tag] = {"baseline": base, "candidate": cand}
            w = worst[bsha]
            rows_c, rows_t, bad_c, bad_t = [], [], [], []
            for kind in VIEWS:
                b, c = base["views"].get(kind), cand["views"].get(kind)
                if not b or not c or not b["calls"] or not c["calls"]:
                    v.cnj("%s view [%s]" % (kind, tag), "a view measured nothing (baseline %s, candidate %s)" % (b and b["calls"], c and c["calls"]))
                    continue
                dc = c["calls"] - b["calls"]
                ratio = c["tris"] / b["tris"] if b["tris"] else 0
                rows_c.append("%s %d -> %d (%+d)" % (kind, b["calls"], c["calls"], dc))
                rows_t.append("%s %s -> %s (x%.3f)" % (kind, f(b["tris"]), f(c["tris"]), ratio))
                if dc > CALLS_MAX_DELTA:
                    bad_c.append(kind)
                if ratio > TRIS_MAX_RATIO:
                    bad_t.append(kind)
                if dc > w.get("calls", (-10 ** 9,))[0]:
                    w["calls"] = (dc, "%s %s" % (tag0, kind))
                if ratio > w.get("tris", (0,))[0]:
                    w["tris"] = (ratio, "%s %s" % (tag0, kind))
                v0.info("%s view [%s]" % (kind, tag), "baseline: world %d calls %s tris, with actors %d calls | candidate: world %d calls %s tris, with actors %d calls | programs %s -> %s, geometries %s -> %s, textures %s -> %s | %s" % (
                    b["calls"], f(b["tris"]), b["callsAll"], c["calls"], f(c["tris"]), c["callsAll"], b["programs"], c["programs"], b["geometries"], c["geometries"], b["textures"], c["textures"], c.get("png", "")))
            if rows_c:
                v.check("calls-vs-baseline [%s]" % tag, not bad_c, ("every view within +%d calls of the baseline: " % CALLS_MAX_DELTA if not bad_c else "over +%d calls in %s: " % (CALLS_MAX_DELTA, ", ".join(bad_c))) + "; ".join(rows_c), "<= +%d calls per view" % CALLS_MAX_DELTA)
                v.check("tris-vs-baseline [%s]" % tag, not bad_t, ("every view within x%.2f triangles of the baseline: " % TRIS_MAX_RATIO if not bad_t else "over x%.2f triangles in %s: " % (TRIS_MAX_RATIO, ", ".join(bad_t))) + "; ".join(rows_t), "<= x%.2f triangles per view" % TRIS_MAX_RATIO)
            if args.identical:
                # the post-deploy baseline check: the working copy IS the baseline build (gate.py --post-deploy, after common.LIVE_REV moved to the deployed commit)
                diffs = []
                for kind in VIEWS:
                    b, c = base["views"].get(kind), cand["views"].get(kind)
                    if b and c and (abs(c["calls"] - b["calls"]) > IDENTICAL_CALLS or abs(c["tris"] / max(1, b["tris"]) - 1.0) > IDENTICAL_TRIS):
                        diffs.append("%s %d -> %d calls, x%.4f triangles" % (kind, b["calls"], c["calls"], c["tris"] / max(1, b["tris"])))
                v.check("identical-to-baseline [%s]" % tag, not diffs and bool(rows_c),
                        "the candidate reads the baseline's numbers on every view (calls within +-%d, triangles within x%.3f)" % (IDENTICAL_CALLS, 1 + IDENTICAL_TRIS) if not diffs else "differs from the baseline: " + "; ".join(diffs),
                        "x1.000 everywhere: common.LIVE_REV must be the build the working copy was deployed from")
            d = cand["views"].get("drop")
            if d and d["callsAll"]:
                if d["callsAll"] > w.get("drop", (0,))[0]:
                    w["drop"] = (d["callsAll"], tag0)
                if bsha == bshas[0]:                    # the drop-view bar is absolute: judged once per (map, seed), whatever the baselines
                    v.check("drop-view-calls [%s]" % tag0, d["callsAll"] <= DROP_CALLS_MAX, "drop view (actors as the match left them) %d calls (world alone %d); baseline %d" % (d["callsAll"], d["calls"], base["views"]["drop"]["callsAll"]), "<= %d calls" % DROP_CALLS_MAX)
    v0.data["views"] = out
    for bsha in bshas:
        w = worst[bsha]
        if w:
            # the margin the bars leave over every map x seed of the run (information: the rows above are the verdict)
            v0.info("worst margins over %d map x seed runs vs %s" % (len(maps) * len(seeds), bsha[:8]), "most calls over the baseline: %+d (%s; bar +%d) | highest triangle ratio: x%.3f (%s; bar x%.2f) | highest drop view with actors: %d calls (%s; bar %d)" % (
                w.get("calls", (0, "-"))[0], w.get("calls", (0, "-"))[1], CALLS_MAX_DELTA, w.get("tris", (0, "-"))[0], w.get("tris", (0, "-"))[1], TRIS_MAX_RATIO,
                w.get("drop", (0, "-"))[0], w.get("drop", (0, "-"))[1], DROP_CALLS_MAX))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="ashgrid", help="comma list (default ashgrid = Savanna, the Wave-7 pilot)")
    ap.add_argument("--baseline", default=DEFAULT_BASELINE, help="git revision the candidate is compared with (default %s); a comma list judges the SAME candidate match against each (rows carry \"vs <sha8>\")" % DEFAULT_BASELINE)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--seeds", default=None, help="comma list of match seeds, one candidate match each (overrides --seed); the row names carry the seed. Wave-7 completion round: 1,7,1234,2026,31337 (gate.py)")
    ap.add_argument("--plant", default=None, help="negative control: %s" % ", ".join(sorted(PLANT_ROWS)))
    ap.add_argument("--no-cache", action="store_true", help="re-measure the baseline instead of reading _reports/perf_district_base_*.json")
    ap.add_argument("--identical", action="store_true", help="also assert the candidate reads the baseline's numbers (the post-deploy check: the working copy IS the baseline build)")
    ap.add_argument("--phone", action="store_true", help="the PHONE tier: a Pixel 7 context (915x412, DPR 2.625, touch, pointer lock refused) for baseline and candidate (gate.py: INFORMATION)")
    args = ap.parse_args()
    if args.phone and not args.report:
        args.report = "perf_district_phone"
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
