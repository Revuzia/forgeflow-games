#!/usr/bin/env python
"""houseload - what the furnished houses cost the SIM and the renderer per district (Last Circle Wave 8 stage B, lane I4; plan section 3 WAVE 8 "Lane 8B
batch per material per district (12-16 calls)" and "Wave 8 verify: framecheck queryColliders <= 150 / frame").

    python _harness/houseload.py --disk                                   # the working copy vs common.LIVE_REV, all three maps
    python _harness/houseload.py --disk --maps ashgrid --baseline 9115494d
    python _harness/houseload.py --disk --maps deepwood --plant query-flood      # control: every queryColliders result carries 64 extra colliders -> the collider rows FAIL
    python _harness/houseload.py --disk --maps deepwood --plant district-split   # control: 20 extra meshes in the first town district -> district-calls FAILS
    python _harness/houseload.py --rev 9115494d --baseline 9115494d --maps ashgrid   # the same build twice: the collider rows read x1.000 (the battery is exact)

framecheck counts queryColliders CALLS per frame (<= 150). It never counted what a call RETURNS: maps.js queryColliders hands back the colliders of the grid
cells the query square touches, so a furnished house (150-680 colliders: housegen p50 ~160) lands in every bot's look-around and every mover query near it
unless the query is narrowed (a band, an emptiness test). This gate measures that, and the per-district draw calls the plan's batching bar is about.

Per map, ONE Chrome serves the candidate (the working copy, or --rev), ONE the baseline revision (git, page routing); each loads a standard match at --seed,
lands (guarded), freezes the loop and measures:
  BATTERY (exact, deterministic: the same points in both builds): the queries the game makes near a house, each EXACTLY as the game issues it (read
          from each build's own source, below), at every town / compound building footprint centre of the CANDIDATE's layout (W.map.city.footprints; the
          baseline is queried at the same points). The asker is a mover standing on the footprint's ground floor (W.map.houseAt(x, z).y, else the
          terrain), vel 0. Counts of colliders the query hands back (a list query) or reads before it answers (occAny): mean, p95, max per query.
          R2 call-site proof (the head this battery was rewritten on, 2e76a02c + R2; the old r 16 / 1.6 / 0.6 rows were stale):
            look     bots.js:5258  `if (!occAny(W, a.pos.x, a.pos.z, 16)) {` and bots.js:3595 `if (W.map.hasCollidersNear) return W.map.hasCollidersNear(x, z, r);`
                     (maps.js:6903 `function hasCollidersNear(x, z, r)` = true at the FIRST live collider of the cells the square touches): the look-around
                     builds no list any more - measured as the cell entries it reads before it answers (the maps.js scan, replicated over W.map.colliders
                     and checked point by point against W.map.hasCollidersNear). 9115494d's bots.js:3265 `const near = W.map.queryColliders(a.pos.x, a.pos.z, 16);`
                     = the baseline (an unbanded r 16 list).
            steer    bots.js:2272 `const got = W.map.queryColliders(a.pos.x, a.pos.z, WALL_QR, _wq);` (bots.js:2258 `const WALL_QR = 2.4;`) - the per-bot
                     steering list (9115494d bots.js:1392, the same call). Unbanded on 2e76a02c; a band added there (lane movers, R2) is read from the call.
            move     player.js:2352 `const cols = moveCols(W, a.pos.x, a.pos.z, Math.abs(mvx) + Math.abs(mvz), yLo, yHi);` with player.js:2351
                     `yLo = (dyT < 0 ? a.pos.y + dyT : a.pos.y) - 1.0, yHi = (dyT > 0 ? a.pos.y + dyT : a.pos.y) + h + 1.0` and player.js:1940
                     `return W.map.queryColliders(x, z, Math.max(K.PLAYERK.radius + 0.4, 0.6) + K.PLAYERK.radius + reach, _moveCols, y0, y1);` - every
                     actor's one move query a tick, banded (maps.js:6859 `if (y0 !== undefined) return queryCollidersY(...)`); reach = a sprint tick on the
                     diagonal (K.MOVE.sprint / 60 x sqrt 2): r 1.489. 9115494d player.js:1630: the same radius, no band. (The swim branch, player.js:2599,
                     is unbanded but nobody swims on a house floor.)
            support  the r 0.6 support / solid probes: player.js:1784 (supportA, the bots' per-frame hop probe) and player.js:1792 (supportAt)
                     `W.map.queryColliders(x, z, 0.6)`, bots.js:1833 (insideSolid) and bots.js:2125 (obstacleAt) - unbanded on 2e76a02c (lane movers, R2,
                     is adding the asker's band). Per point the WORST of these sites as each build issues it (a site's band read from its call).
          A band or radius the page cannot evaluate falls back to the unbanded query (the stricter reading), and is printed in the row's notes.
  MATCH   (counts, but a match: bots differ between builds): 600 stepped sim frames after landing with every external queryColliders call wrapped - calls and
          colliders returned per frame, per radius bucket.
  DRAWS   every mesh under the map group attributed to its district (structure meshes: userData.district; kit instanced meshes: userData.kitDistrict or the
          "kit:<district>:detail" group; maps.js's house inside / furniture chunks: userData.hgChunk, each its own 'chunk:<key>'; housegen meshes outside every district: their "house:<id>" group, i.e. a
          district of their own); calls = meshes x
          material groups at DETAIL (the kit's far proxies are not counted), main pass.
Rows (per map):
  collider-load        BATTERY: look and steer mean AND p95, move and support mean: colliders <= x1.25 the baseline's: the houses must not grow what the
                       game's queries near a house hand back (the fix is a per-house broad phase, a band, a separate furniture grid)
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

BATTERY_JS = r"""([pts, Q]) => {
  const W = window.__LC__.W, M = W.map, K = W.SIM;
  const fp = pts || ((M.city && M.city.footprints) || []).map((a) => [(a[0] + a[2]) / 2, (a[1] + a[3]) / 2]);
  const out = { points: fp.length, q: {}, notes: [] };
  const DT = 1 / 60, h = K.PLAYERK.height, reach = K.MOVE.sprint * DT * Math.SQRT2;
  const fn = (pre, exprs, tag) => { try { return new Function('K', 'reach', 'a', 'x', 'z', 'y', 'h', 'dt', (pre || '') + '\n; return [' + exprs.join(', ') + '];'); }
                                    catch (e) { out.notes.push(tag + ': not evaluable (' + e.message + ') - unbanded'); return null; } };
  // the occAny / hasCollidersNear scan (maps.js: cells of CELL m, x-major, entries in collider order; stop at the first live collider meeting the square)
  let occ = null;
  const occReads = (x, z, r) => {
    if (!occ) { const C = M.city ? (M.houses && M.houses.length ? 4 : 8) : 16, cells = new Map();
      (M.colliders || []).forEach((c) => { for (let i = Math.floor(c.minX / C); i <= Math.floor(c.maxX / C); i++) for (let j = Math.floor(c.minZ / C); j <= Math.floor(c.maxZ / C); j++) {
        const k = (i + 8192) * 16384 + (j + 8192); let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(c); } });
      occ = { C, cells }; out.occCell = C; }
    const C = occ.C, qx0 = x - r, qx1 = x + r, qz0 = z - r, qz1 = z + r;
    let n = 0;
    for (let i = Math.floor(qx0 / C); i <= Math.floor(qx1 / C); i++) for (let j = Math.floor(qz0 / C); j <= Math.floor(qz1 / C); j++) {
      const l = occ.cells.get((i + 8192) * 16384 + (j + 8192)); if (!l) continue;
      for (let k = 0; k < l.length; k++) { n++; const c = l[k]; if (!c.dead && c.maxX >= qx0 && c.minX <= qx1 && c.maxZ >= qz0 && c.minZ <= qz1) return [n, true]; }
    }
    return [n, false];
  };
  for (const q of Q) {
    const rF = fn('', [q.r], q.key + ' radius');
    const vars = q.sites.map((st) => ({ st, f: st.band ? fn(st.pre, st.band, q.key + ' band ' + st.at) : null }));
    const ns = [], rs = new Set(); let banded = 0, occBad = 0;
    for (const p of fp) {
      const x = p[0], z = p[1], H = M.houseAt ? M.houseAt(x, z) : null, y = H ? H.y : M.heightAt(x, z);
      const a = { pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, onGround: true };
      let r = q.r0; try { if (rF) r = rF(K, reach, a, x, z, y, h, DT)[0]; } catch (e) {}
      rs.add(+r.toFixed(3));
      let worst = 0;
      for (const v of vars) {
        let n;
        if (q.mode === 'occ') {
          const [reads, any] = occReads(x, z, r);
          if (any !== M.hasCollidersNear(x, z, r)) occBad++;
          n = reads;
        } else {
          let b = null; try { if (v.f) b = v.f(K, reach, a, x, z, y, h, DT); } catch (e) { b = null; if (!v.err) { v.err = 1; out.notes.push(q.key + ' band ' + v.st.at + ': ' + e.message + ' - unbanded'); } }
          if (b && isFinite(b[0]) && isFinite(b[1])) { banded++; n = M.queryColliders(x, z, r, [], b[0], b[1]).length; }
          else n = M.queryColliders(x, z, r, []).length;
        }
        if (n > worst) worst = n;
      }
      ns.push(worst);
    }
    ns.sort((a, b) => a - b);
    const sum = ns.reduce((a, b) => a + b, 0);
    out.q[q.key] = { mode: q.mode, r: [...rs].slice(0, 4), sites: q.sites.map((st) => st.at + (st.band ? ' band' : '')), bandedQueries: banded, occMismatch: q.mode === 'occ' ? occBad : null,
                     n: ns.length, mean: ns.length ? +(sum / ns.length).toFixed(2) : null, p95: ns.length ? ns[Math.min(ns.length - 1, Math.floor(ns.length * 0.95))] : null, max: ns.length ? ns[ns.length - 1] : null };
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


def _src(rev, rel):
    if rev:
        p = subprocess.run(["git", "-C", C.REPO, "show", "%s:games/last-circle/%s" % (rev, rel)], capture_output=True)
        return p.stdout.decode("utf-8", "replace") if p.returncode == 0 else ""
    try:
        with open(os.path.join(C.ROOT, rel.replace("/", os.sep)), encoding="utf-8") as fh:
            return fh.read()
    except OSError:
        return ""


def _code(src):
    import re
    code = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    return re.sub(r"//[^\n]*", "", code)                   # comments name old calls ("coverStepQ asked queryColliders(x, z, 16)"): code only


def _args_at(code, i):
    """the top-level argument texts of the call whose '(' is at code[i]"""
    depth, cur, out = 0, "", []
    for ch in code[i:]:
        if ch in "([{":
            depth += 1
            if depth == 1:
                continue
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                out.append(cur.strip())
                return out
        if ch == "," and depth == 1:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    return out


def _body(code, name):
    import re
    m = re.search(r"(?:^|\n)(?:export )?function %s\(" % re.escape(name), code)
    if not m:
        return None
    nxt = re.search(r"\n(?:export )?(?:async )?function \w+\(", code[m.end():])
    return code[m.start(): m.end() + (nxt.start() if nxt else len(code))]


def _qc_sites(body, radius_re):
    """every queryColliders(...) call in `body` whose radius text matches radius_re: (radius text, band [y0, y1] texts or None)"""
    import re
    out = []
    for m in re.finditer(r"queryColliders\(", body or ""):
        a = _args_at(body, m.end() - 1)
        if len(a) >= 3 and re.fullmatch(radius_re, a[2]):
            out.append((a[2], a[4:6] if len(a) >= 6 else None))
    return out


def call_sites(rev):
    """(R2) the battery's queries, each as THIS build's source issues it: [{key, mode, r, r0, sites: [{at, band, pre}]}], plus a proof line each.
    Read from the build's own bots.js / player.js (comments stripped), so the candidate and the baseline are each measured the way their game asks."""
    import re
    B, P = _code(_src(rev, "runtime/3d/royale/bots.js")), _code(_src(rev, "runtime/3d/royale/player.js"))
    if not B or not P:
        raise C.HarnessError("houseload: cannot read bots.js / player.js of %s" % (rev or "the working copy"))
    Q, proof = [], {}
    # look-around: occAny(W, a.pos.x, a.pos.z, 16) delegating to map.hasCollidersNear, else the old r 16 list
    occ_body = _body(B, "occAny") or ""
    if re.search(r"occAny\(W,\s*a\.pos\.x,\s*a\.pos\.z,\s*16\)", B) and "hasCollidersNear(x, z, r)" in occ_body:
        Q.append({"key": "look", "mode": "occ", "r": "16", "r0": 16, "sites": [{"at": "bots.js occAny(W, a.pos.x, a.pos.z, 16) -> map.hasCollidersNear", "band": None, "pre": ""}]})
        proof["look"] = "occAny(W, a.pos.x, a.pos.z, 16) -> W.map.hasCollidersNear: cell entries read"
    else:
        m = re.search(r"queryColliders\(a\.pos\.x,\s*a\.pos\.z,\s*16\s*[,)]", B)
        Q.append({"key": "look", "mode": "list", "r": "16", "r0": 16, "sites": [{"at": "bots.js queryColliders(a.pos.x, a.pos.z, 16)", "band": None, "pre": ""}]})
        proof["look"] = "queryColliders(a.pos.x, a.pos.z, 16) list" if m else "NOT FOUND in bots.js - the old unbanded r 16 list"
    # steering: wallCols' queryColliders(a.pos.x, a.pos.z, WALL_QR, _wq[, y0, y1])
    wq = re.search(r"const WALL_QR = ([0-9.]+);", B)
    wqr = wq.group(1) if wq else "2.4"
    st = _qc_sites(_body(B, "wallCols"), r"WALL_QR")
    Q.append({"key": "steer", "mode": "list", "r": wqr, "r0": float(wqr),
              "sites": [{"at": "bots.js wallCols r WALL_QR", "band": (x[1] if x[1] else None), "pre": ""} for x in st] or [{"at": "bots.js wallCols (not found: unbanded)", "band": None, "pre": ""}]})
    proof["steer"] = "wallCols r WALL_QR=%s: %s" % (wqr, ", ".join("band %s" % (b,) if b else "unbanded" for _, b in st) or "call not found - unbanded")
    # move: player.js tick's moveCols(W, a.pos.x, a.pos.z, reach[, yLo, yHi]) -> moveCols' queryColliders(x, z, <radius with reach>, _moveCols[, y0, y1])
    mc = _qc_sites(_body(P, "moveCols"), r".*reach.*")
    rexpr = mc[0][0] if mc else "Math.max(K.PLAYERK.radius + 0.4, 0.6) + K.PLAYERK.radius + reach"
    fwd = bool(mc and mc[0][1] and [x.strip() for x in mc[0][1]] == ["y0", "y1"])
    call = re.search(r"moveCols\(W,\s*a\.pos\.x,\s*a\.pos\.z,\s*Math\.abs\(mvx\)\s*\+\s*Math\.abs\(mvz\)\s*,\s*(\w+)\s*,\s*(\w+)\s*\)", P)
    band, pre = None, ""
    if fwd and call:
        y0n, y1n = call.group(1), call.group(2)
        d = re.search(r"const dyT = [^;]*\b%s = [^;]*;" % re.escape(y0n), P)
        if d:
            band, pre = [y0n, y1n], d.group(0)
    Q.append({"key": "move", "mode": "list", "r": rexpr, "r0": 1.489, "sites": [{"at": "player.js tick moveCols", "band": band, "pre": pre}]})
    proof["move"] = "moveCols r %s, %s" % (rexpr, "band %s from `%s`" % (band, pre) if band else "unbanded")
    # support: the r 0.6 probes (player.js supportA / supportAt, bots.js insideSolid / obstacleAt) - the worst site per point
    sup = []
    for f, code in (("supportA", P), ("supportAt", P), ("insideSolid", B), ("obstacleAt", B)):
        for _, b in _qc_sites(_body(code, f), r"0\.6"):
            sup.append({"at": "%s r 0.6" % f, "band": b if b else None, "pre": ""})
    Q.append({"key": "support", "mode": "list", "r": "0.6", "r0": 0.6, "sites": sup or [{"at": "support r 0.6 (no site found: unbanded)", "band": None, "pre": ""}]})
    proof["support"] = ", ".join("%s %s" % (x["at"], "band %s" % (x["band"],) if x["band"] else "unbanded") for x in sup) or "no site found - unbanded"
    return Q, proof


def measure(args, label, map_id, rev, plant, Q, pts=None):
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
        res["battery"] = s.js(BATTERY_JS, [pts, Q])
        res["draws"] = s.js(DRAWS_JS, plant)
        s.js("() => { const st = window.__LC__.W.map.__hl; st.on = true; st.calls = 0; st.ret = 0; st.b = {}; }")
        s.step_frames(FRAMES, 1 / 60, render=False)
        res["match"] = s.js("(n) => { const st = window.__LC__.W.map.__hl; st.on = false; return { frames: n, calls: st.calls, ret: st.ret, callsPerFrame: +(st.calls / n).toFixed(1), retPerFrame: +(st.ret / n).toFixed(1), buckets: st.b, t: +window.__LC__.W.t.toFixed(1), alive: window.__LC__.W.actors.filter((x) => x.alive !== false && !x.dead).length }; }", FRAMES)
        d = s.diagnostics()
        res["problems"] = C.diag_problems(d, rig=False)
        res["pageErrors"] = d["pageErrors"][:3]
        res["failed"] = d["failedRequests"][:3]
        b = res["battery"]["q"]
        print("  [%s %s] loaded+landed %.0f s; battery %d points %s; notes %s; match %s calls/frame %s returned/frame; districts %d, worst %s calls (%s), over %d: %d; untagged %d (housegen %d)" % (
            label, map_id, time.time() - t0, res["battery"]["points"],
            " | ".join("%s(%s r%s) mean %s p95 %s max %s" % (k, e["mode"], e["r"], e["mean"], e["p95"], e["max"]) for k, e in b.items()), res["battery"]["notes"],
            res["match"]["callsPerFrame"], res["match"]["retPerFrame"], res["draws"]["districts"], (res["draws"]["worst"] or [{}])[0].get("calls"), (res["draws"]["worst"] or [{}])[0].get("id"),
            DISTRICT_CALLS_MAX, res["draws"]["over"], res["draws"]["untaggedCalls"], res["draws"]["untaggedHousegenCalls"]), flush=True)
    return res


def main_fn(v, args):
    plant = args.plant
    maps = [m for m in args.maps.split(",") if m]
    bsha = git_sha(args.baseline)
    clabel, crev = ("candidate %s" % git_sha(args.rev)[:8], args.rev) if args.rev else ("working copy", None)
    v.data.update({"baseline": bsha, "candidate": clabel, "maps": maps, "seed": args.seed, "plant": plant})
    QC, pc = call_sites(crev)
    QB, pb = call_sites(bsha)
    v.data["querySites"] = {"candidate": QC, "baseline": QB}
    v.info("battery queries as each build issues them", {"candidate": pc, "baseline %s" % bsha[:8]: pb})

    def chk(name, ok, detail, expect=None):
        if plant and name.split(" [")[0] not in PLANT_ROWS.get(plant, set()):
            v.info(name + " (not counted under --plant)", ("would PASS: " if ok else "would FAIL: ") + json.dumps(detail)[:600])
            return
        v.check(name, ok, detail, expect=expect)

    probs = []
    for m in maps:
        cand = measure(args, clabel, m, crev, plant, QC)
        pts = cand["battery"].pop("pts")
        base = measure(args, "baseline %s" % bsha[:8], m, bsha, None, QB, pts)
        v.data[m] = {"candidate": cand, "baseline": base}
        cb, bb = cand["battery"], base["battery"]
        if not cb["points"]:
            v.cnj("collider-load [%s]" % m, "no building footprint on this map (W.map.city.footprints empty): nothing to query")
        else:
            rows = {}
            ok = True
            bad_occ = [k for k, e in cb["q"].items() if e.get("occMismatch")]
            for r in ("look", "steer", "move", "support"):
                c, b = cb["q"][r], bb["q"][r]
                rm = c["mean"] / b["mean"] if b["mean"] else (1.0 if not c["mean"] else 99.0)
                rows[r] = {"query": "%s r %s" % (c["mode"], c["r"]), "baseQuery": "%s r %s" % (b["mode"], b["r"]), "sites": c["sites"], "bandedQueries": c["bandedQueries"],
                           "mean": c["mean"], "baseMean": b["mean"], "ratio": round(rm, 3), "p95": c["p95"], "baseP95": b["p95"], "max": c["max"], "baseMax": b["max"]}
                ok = ok and rm <= RATIO_MAX
                if r in ("look", "steer"):
                    rp = c["p95"] / b["p95"] if b["p95"] else (1.0 if not c["p95"] else 99.0)
                    rows[r]["p95ratio"] = round(rp, 3)
                    ok = ok and rp <= RATIO_MAX
            if bad_occ:
                v.cnj("collider-load [%s]" % m, "the occAny replica disagrees with W.map.hasCollidersNear at %s points: cannot count its reads" % {k: cb["q"][k]["occMismatch"] for k in bad_occ})
            else:
                chk("collider-load [%s]" % m, ok, {"points": cb["points"], "colliders": [cb["colliders"], bb["colliders"]], "notes": cb["notes"], "byQuery": rows},
                    expect="look (bots' look-around) and steer mean and p95, move and support mean: colliders <= x%.2f the baseline (%s, its own call sites) at the same %d footprint centres" % (RATIO_MAX, bsha[:8], cb["points"]))
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
