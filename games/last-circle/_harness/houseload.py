#!/usr/bin/env python
"""houseload - what the furnished houses cost the SIM and the renderer per district (Last Circle Wave 8 stage B, lane I4; plan section 3 WAVE 8 "Lane 8B
batch per material per district (12-16 calls)" and "Wave 8 verify: framecheck queryColliders <= 150 / frame").

    python _harness/houseload.py --disk                                   # the working copy vs common.LIVE_REV, all three maps
    python _harness/houseload.py --disk --maps ashgrid --baseline 9115494d
    python _harness/houseload.py --disk --maps deepwood --plant query-flood      # control: every queryColliders result carries 64 extra colliders -> the collider rows FAIL
    python _harness/houseload.py --disk --maps deepwood --plant district-split   # control: 20 extra meshes in the first town district -> district-calls FAILS
    python _harness/houseload.py --rev 9115494d --baseline 9115494d --maps ashgrid   # the same build twice: the collider rows read x1.000 (the battery is exact)

framecheck counts queryColliders CALLS per frame (<= 150). It never counted what a call RETURNS: maps.js queryColliders hands back every collider of every
40 m grid cell the query circle touches, so a furnished house (150-680 colliders: housegen p50 ~160) inside a cell lands in every bot's r = 16 m look-around
(bots.js) and every mover query near it. This gate measures that, and the per-district draw calls the plan's batching bar is about.

Per map, ONE Chrome serves the candidate (the working copy, or --rev), ONE the baseline revision (git, page routing); each loads a standard match at --seed,
lands (guarded), freezes the loop and measures:
  BATTERY (exact, deterministic: the same points in both builds): the queries the game makes near a house, at every town / compound building footprint centre of
          the CANDIDATE's layout (W.map.city.footprints; the baseline is queried at the same points): r 16 (the bot look-around, bots.js), r 1.6 (bot steering), r 0.6
          (the mover's support). Counts of colliders returned: mean, p95, max per radius.
  MATCH   (counts, but a match: bots differ between builds): 600 stepped sim frames after landing with every external queryColliders call wrapped - calls and
          colliders returned per frame, per radius bucket.
  DRAWS   every mesh under the map group attributed to its district (structure meshes: userData.district; kit instanced meshes: userData.kitDistrict or the
          "kit:<district>:detail" group; maps.js's house inside / furniture chunks: userData.hgChunk, each its own 'chunk:<key>'; housegen meshes outside every district: their "house:<id>" group, i.e. a
          district of their own); calls = meshes x
          material groups at DETAIL (the kit's far proxies are not counted), main pass.
Rows (per map):
  collider-load        BATTERY r 16: mean AND p95 colliders returned <= x1.25 the baseline's (plus r 1.6 / r 0.6 mean <= x1.25): the houses must not grow what a
                       query returns (the fix is a per-house broad phase or a separate furniture grid; housegen colliders straight into maps.js's 40 m grid fail it)
  collider-load-frame  MATCH: colliders returned per frame <= x1.25 the baseline's, and queryColliders calls per frame <= 150 (framecheck's bar, here on every map)
  district-calls       DRAWS: every district <= 16 draw calls at detail (plan 8B: 12-16 per district), the worst five printed; the baseline's worst printed beside it
  errors               0 page errors / failed requests in the candidate
Plants (--plant, applied to the CANDIDATE page after the match is loaded, never a file; only the designated rows count):
  query-flood          the wrapped queryColliders appends 64 dead, far-away dummy colliders to every result   -> collider-load, collider-load-frame FAIL
  district-split       20 extra 1-triangle meshes tagged with the first district id                         -> district-calls FAILS
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "houseload"
RATIO_MAX = 1.25            # the same tolerance perf_district gives triangles: x1.25 of the build that is live
QC_CALLS_MAX = 150          # framecheck's queryColliders calls per match frame
DISTRICT_CALLS_MAX = 16     # plan section 3 WAVE 8, lane 8B: "batch per material per district (12-16 calls)"
PLANT_ROWS = {"query-flood": {"collider-load", "collider-load-frame"}, "district-split": {"district-calls"}}
FRAMES = 600

WRAP_JS = r"""(plant) => {
  const W = window.__LC__.W, M = W.map;
  if (M.__hl) return 'already';
  const q = M.queryColliders;
  const st = M.__hl = { on: false, calls: 0, ret: 0, b: {} };
  const dummies = [];
  if (plant === 'query-flood') for (let i = 0; i < 64; i++) dummies.push({ kind: 'box', minX: 9e5 + i, maxX: 9e5 + i + 0.1, minY: -9e5, maxY: -9e5 + 0.1, minZ: 9e5, maxZ: 9e5 + 0.1, dir: -1, prop: null, idx: -1, hp: 0, dead: true, _qs: 0 });
  M.queryColliders = function (x, z, r, out) {
    let res = q.apply(this, arguments);
    if (dummies.length) { if (Object.isFrozen(res)) res = res.slice(); for (const d of dummies) res.push(d); }
    if (st.on) {
      const n = res ? res.length : 0;
      st.calls++; st.ret += n;
      const k = r < 1 ? 'r<1' : r < 2 ? 'r1-2' : r < 8 ? 'r2-8' : r < 20 ? 'r8-20' : 'r20+';
      const e = st.b[k] || (st.b[k] = { calls: 0, ret: 0, max: 0 });
      e.calls++; e.ret += n; if (n > e.max) e.max = n;
    }
    return res;
  };
  return 'ok';
}"""

BATTERY_JS = r"""([pts, R]) => {
  const W = window.__LC__.W, M = W.map;
  const fp = pts || ((M.city && M.city.footprints) || []).map((a) => [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2]);
  const out = { points: fp.length, r: {} };
  for (const r of R) {
    const ns = [];
    for (const p of fp) { const l = M.queryColliders(p[0], p[1], r, []); ns.push(l.length); }
    ns.sort((a, b) => a - b);
    const sum = ns.reduce((a, b) => a + b, 0);
    out.r[String(r)] = { n: ns.length, mean: ns.length ? +(sum / ns.length).toFixed(2) : null, p95: ns.length ? ns[Math.min(ns.length - 1, Math.floor(ns.length * 0.95))] : null, max: ns.length ? ns[ns.length - 1] : null };
  }
  out.pts = pts ? null : fp;
  out.colliders = (M.colliders || []).length;
  return out;
}"""

DRAWS_JS = r"""(plant) => {
  const W = window.__LC__.W, g = W.group('map');
  if (plant === 'district-split' && !window.__HL_SPLIT__) {
    let first = null; g.traverse((o) => { if (!first && o.isMesh && o.userData && o.userData.district) first = o; });
    if (first) {
      const T = first.geometry.constructor, geo = new T(); const P = first.geometry.attributes.position.constructor;
      geo.setAttribute('position', new P(new Float32Array([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0]), 3));
      for (let i = 0; i < 20; i++) { const m = new first.constructor(geo, first.material); m.userData.district = first.userData.district; m.name = 'planted:district-split'; m.position.copy(first.position); first.parent.add(m); }
      window.__HL_SPLIT__ = first.userData.district;
    }
  }
  const D = new Map();
  const add = (id, kind, calls) => { let e = D.get(id); if (!e) D.set(id, e = { id, calls: 0, structure: 0, kit: 0, house: 0, other: 0 }); e.calls += calls; e[kind] += calls; };
  let untagged = 0, untaggedHouse = 0;
  const visit = (o, ctx) => {
    if (o.isLOD) { const lv = o.levels && o.levels[0]; if (lv && lv.object) visit(lv.object, ctx); return; }      // the detail level only (kit far proxies excluded)
    let c = ctx;
    const nm = o.name || '';
    if (o.userData && o.userData.district) c = { id: String(o.userData.district), kind: c && c.kind === 'house' ? 'house' : 'structure' };
    else if (o.userData && o.userData.kitDistrict) c = { id: String(o.userData.kitDistrict), kind: 'kit' };
    else if (o.userData && o.userData.hgChunk) c = { id: 'chunk:' + o.userData.hgChunk, kind: 'house' };       // maps.js (Wave 8): a house INSIDE + furniture chunk mesh (32 m)
    else if (/^kit:.+:detail$/.test(nm)) c = { id: nm.slice(4, -7), kind: 'kit' };
    else if (/^house:/.test(nm) && !c) c = { id: nm, kind: 'house' };
    if (o.isMesh || o.isInstancedMesh) {
      const calls = Array.isArray(o.material) ? (o.geometry.groups.length || 1) : 1;
      if (c) add(c.id, /^housegen:/.test(nm) ? 'house' : c.kind, calls);
      else { untagged += calls; if (/^housegen:/.test(nm)) untaggedHouse += calls; }
    }
    for (const ch of o.children) visit(ch, c);
  };
  visit(g, null);
  const list = [...D.values()].sort((a, b) => b.calls - a.calls);
  return { districts: list.length, worst: list.slice(0, 8), over: list.filter((e) => e.calls > %d).length, untaggedCalls: untagged, untaggedHousegenCalls: untaggedHouse,
           kitStats: W._cityKit && W._cityKit.stats ? Object.keys(W._cityKit.stats().districts).length : null, planted: window.__HL_SPLIT__ || null };
}""" % DISTRICT_CALLS_MAX


def git_sha(rev):
    sha = subprocess.run(["git", "-C", C.REPO, "rev-parse", rev], capture_output=True, text=True).stdout.strip()
    if not sha:
        raise C.HarnessError("unknown git revision %r" % rev)
    return sha


def rkey(r):
    """the battery's radius key exactly as the page writes it (String(r) in JS: 16 -> '16', 2.4 -> '2.4')"""
    return ("%d" % r) if float(r).is_integer() else repr(float(r))


def look_radius(rev):
    """(Wave 8, lane K3) the bot look-around radius the CANDIDATE's bots.js really queries. The Wave-7b bots made queryColliders(a.pos.x, a.pos.z, 16) per bot
    (the battery's r 16 row); the Wave-8 bots.js answers that question from hasCollidersNear (no collider list) and its per-bot list query is WALL_QR
    (const WALL_QR = 2.4: one queryColliders per bot per 0.1 s). The battery follows the query the game makes: 16 while the source still has a
    queryColliders(..., 16) call, else WALL_QR; neither found -> 16 (the old row, printed so)."""
    import re
    rel = "runtime/3d/royale/bots.js"
    if rev:
        p = subprocess.run(["git", "-C", C.REPO, "show", "%s:games/last-circle/%s" % (rev, rel)], capture_output=True)
        src = p.stdout.decode("utf-8", "replace") if p.returncode == 0 else ""
    else:
        try:
            with open(os.path.join(C.ROOT, rel.replace("/", os.sep)), encoding="utf-8") as fh:
                src = fh.read()
        except OSError:
            src = ""
    code = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    code = re.sub(r"//[^\n]*", "", code)                    # comments name the old call ("coverStepQ asked queryColliders(x, z, 16) ..."): code only
    if re.search(r"queryColliders\([^;\n]*,\s*16\s*[,)]", code):
        return 16, "bots.js queries queryColliders(x, z, 16) (the bot look-around)"
    m = re.search(r"const WALL_QR = ([0-9.]+);", src)
    if m:
        return float(m.group(1)), "bots.js makes no r 16 query any more (occAny / coverStepQ -> map.hasCollidersNear); its per-bot list query is WALL_QR = %s" % m.group(1)
    return 16, "bots.js: neither a r 16 query nor WALL_QR found - the old r 16 row"


def measure(args, label, map_id, rev, plant, pts=None):
    a = copy.copy(args)
    a.rev = rev
    a.disk = True
    res = {"label": label, "map": map_id, "seed": args.seed}
    with C.Session(a, name=GATE) as s:
        s.boot()
        s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
        t0 = time.time()
        res["load"] = s.start_match(mode="standard", seed=args.seed, map_id=map_id)
        res["land"] = s.land(max_s=90, protect=True)
        s.guard_player(True)
        s.freeze_loop()
        res["wrap"] = s.js(WRAP_JS, plant)
        res["battery"] = s.js(BATTERY_JS, [pts, [args.look_r, 1.6, 0.6]])
        res["draws"] = s.js(DRAWS_JS, plant)
        s.js("() => { const st = window.__LC__.W.map.__hl; st.on = true; st.calls = 0; st.ret = 0; st.b = {}; }")
        s.step_frames(FRAMES, 1 / 60, render=False)
        res["match"] = s.js("(n) => { const st = window.__LC__.W.map.__hl; st.on = false; return { frames: n, calls: st.calls, ret: st.ret, callsPerFrame: +(st.calls / n).toFixed(1), retPerFrame: +(st.ret / n).toFixed(1), buckets: st.b, t: +window.__LC__.W.t.toFixed(1), alive: window.__LC__.W.actors.filter((x) => x.alive !== false && !x.dead).length }; }", FRAMES)
        d = s.diagnostics()
        res["problems"] = C.diag_problems(d, rig=False)
        res["pageErrors"] = d["pageErrors"][:3]
        res["failed"] = d["failedRequests"][:3]
        b = res["battery"]["r"]
        lk = rkey(args.look_r)
        print("  [%s %s] loaded+landed %.0f s; battery %d points r%s mean %s p95 %s max %s | r1.6 mean %s | r0.6 mean %s; match %s calls/frame %s returned/frame; districts %d, worst %s calls (%s), over %d: %d; untagged %d (housegen %d)" % (
            label, map_id, time.time() - t0, res["battery"]["points"], lk, b[lk]["mean"], b[lk]["p95"], b[lk]["max"], b["1.6"]["mean"], b["0.6"]["mean"],
            res["match"]["callsPerFrame"], res["match"]["retPerFrame"], res["draws"]["districts"], (res["draws"]["worst"] or [{}])[0].get("calls"), (res["draws"]["worst"] or [{}])[0].get("id"),
            DISTRICT_CALLS_MAX, res["draws"]["over"], res["draws"]["untaggedCalls"], res["draws"]["untaggedHousegenCalls"]), flush=True)
    return res


def main_fn(v, args):
    plant = args.plant
    maps = [m for m in args.maps.split(",") if m]
    bsha = git_sha(args.baseline)
    clabel, crev = ("candidate %s" % git_sha(args.rev)[:8], args.rev) if args.rev else ("working copy", None)
    v.data.update({"baseline": bsha, "candidate": clabel, "maps": maps, "seed": args.seed, "plant": plant})
    args.look_r, why = look_radius(crev)
    LK = rkey(args.look_r)
    v.data["lookRadius"] = args.look_r
    v.info("battery look-around radius", "r %s: %s" % (LK, why))

    def chk(name, ok, detail, expect=None):
        if plant and name.split(" [")[0] not in PLANT_ROWS.get(plant, set()):
            v.info(name + " (not counted under --plant)", ("would PASS: " if ok else "would FAIL: ") + json.dumps(detail)[:600])
            return
        v.check(name, ok, detail, expect=expect)

    probs = []
    for m in maps:
        cand = measure(args, clabel, m, crev, plant)
        pts = cand["battery"].pop("pts")
        base = measure(args, "baseline %s" % bsha[:8], m, bsha, None, pts)
        v.data[m] = {"candidate": cand, "baseline": base}
        cb, bb = cand["battery"], base["battery"]
        if not cb["points"]:
            v.cnj("collider-load [%s]" % m, "no building footprint on this map (W.map.city.footprints empty): nothing to query")
        else:
            rows = {}
            ok = True
            for r in (LK, "1.6", "0.6"):
                c, b = cb["r"][r], bb["r"][r]
                rm = c["mean"] / b["mean"] if b["mean"] else (1.0 if not c["mean"] else 99.0)
                rows[r] = {"mean": c["mean"], "baseMean": b["mean"], "ratio": round(rm, 3), "p95": c["p95"], "baseP95": b["p95"], "max": c["max"], "baseMax": b["max"]}
                ok = ok and rm <= RATIO_MAX
                if r == LK:
                    rp = c["p95"] / b["p95"] if b["p95"] else (1.0 if not c["p95"] else 99.0)
                    rows[r]["p95ratio"] = round(rp, 3)
                    ok = ok and rp <= RATIO_MAX
            chk("collider-load [%s]" % m, ok, {"points": cb["points"], "colliders": [cb["colliders"], bb["colliders"]], "byRadius": rows},
                expect="r %s (the bots' look-around query) mean and p95, r 1.6 / 0.6 mean: colliders returned <= x%.2f the baseline (%s) at the same %d footprint centres" % (LK, RATIO_MAX, bsha[:8], cb["points"]))
        cm, bm = cand["match"], base["match"]
        rr = cm["retPerFrame"] / bm["retPerFrame"] if bm["retPerFrame"] else 99.0
        chk("collider-load-frame [%s]" % m, rr <= RATIO_MAX and cm["callsPerFrame"] <= QC_CALLS_MAX,
            {"retPerFrame": cm["retPerFrame"], "baseRetPerFrame": bm["retPerFrame"], "ratio": round(rr, 3), "callsPerFrame": cm["callsPerFrame"], "baseCallsPerFrame": bm["callsPerFrame"],
             "buckets": cm["buckets"], "baseBuckets": bm["buckets"], "alive": [cm["alive"], bm["alive"]]},
            expect="colliders returned per frame <= x%.2f the baseline, calls per frame <= %d (%d stepped frames after landing)" % (RATIO_MAX, QC_CALLS_MAX, FRAMES))
        cd, bd = cand["draws"], base["draws"]
        if not cd["districts"]:
            v.cnj("district-calls [%s]" % m, "no district mesh found under the map group")
        else:
            chk("district-calls [%s]" % m, cd["over"] == 0, {"districts": cd["districts"], "over": cd["over"], "worst": cd["worst"][:5], "untaggedCalls": cd["untaggedCalls"],
                                                            "untaggedHousegenCalls": cd["untaggedHousegenCalls"], "baselineWorst": bd["worst"][:3], "baselineOver": bd["over"], "planted": cd.get("planted")},
                expect="every district <= %d draw calls at detail (plan 8B)" % DISTRICT_CALLS_MAX)
        if cand["problems"]:
            probs.append({"map": m, "problems": cand["problems"], "pageErrors": cand["pageErrors"], "failed": cand["failed"]})
    v.check("errors", not probs, "0 page errors / failed requests in the candidate on %d maps" % len(maps) if not probs else probs)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--baseline", default=C.LIVE_REV)
    ap.add_argument("--plant", default=None, choices=sorted(PLANT_ROWS))
    args = ap.parse_args()
    if args.plant and not (args.disk or args.rev):
        args.disk = True
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
