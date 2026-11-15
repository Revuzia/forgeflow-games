#!/usr/bin/env python
"""botbatch - the P2-B 24-match AFK bot batch (lane bots; plan P2-B "Gates (24-match AFK batch)"): the cover / re-sight probe promoted into the
harness (p23/js/botbatch_probe.js, from lane P23/bots' scratch probe, itself from the ai_flow audit's af_probe4.js; read-only on bot decisions).

    python _harness/p23/botbatch.py --disk                          # 24 whole STANDARD matches (the long one)
    python _harness/p23/botbatch.py --disk --runs 2:isla_viva,3:ashgrid,4:deepwood     # a short subset (validation only: bars need the batch)
    python _harness/p23/botbatch.py --rev 9aa2b746                  # control: the P2 base (cover 3.4 %, neglect 48.8 %, shield@600 9) - MUST FAIL
    python _harness/p23/botbatch.py --disk --runs 2:isla_viva --plant shield-cap      # every bot's shield held <= 50 (a bot that never tops up)
                                                                    # - MUST FAIL (shield-600; the measure's control, the base is the logic one)
    python _harness/p23/botbatch.py --lanes bots                    # validation: lane bots' work served over the base
    (W9 R1B pass 2) the no-far-big plant is RETIRED: the lane itself now ships WANT_BIG false (the far-big seeking cost p23_tierprof kb
    [ashgrid ultra] ~22 KB/frame over the 85 bar and bought no shield-600), so the plant served the lane unchanged; the crate is back to
    big x2 (OD-16 "loot/supply unchanged"). census-600 keeps its measure control census-surge.
    python _harness/p23/botbatch.py --disk --runs 2:isla_viva --plant census-surge    # (W9 R1B) census-600's measure control: 6 bigs in the next circle
                                                                    # at t = 590 s that no bot may claim - MUST FAIL (census-600)

Each match: STANDARD solo on the seed / map of the run list, the human AFK (no input; the probe never protects it), fastForwarded in 30 s slices
to the end (max 1150 s of sim). Rows (the plan's bars; never lowered):
  resight [tier]   re-sight-to-shot median >= that tier's reactionMs (ratio >= 1.0)
  cover            ENGAGE frames in cover >= 15 %
  neglect          calm bots under 50 shield holding an unused shield item <= 10 %
  shield-600       median alive-bot shield at t >= 600 s >= 75
  afk-survival     AFK human median survival >= 150 s from its touchdown
  frags            >= 1 bot frag throw in EVERY match (needs the integrator's frag loot weight)
  match-end        median match end 600-900 s (10-15 min), every match over
  errors           0 page errors over the batch
  census-600       (W9 R1B, OD-16) median over the matches of the big shields lying UNCLAIMED inside the next circle at t = 600 s (floor items, death
                   piles' included, that no bot has as its shield / loot goal) <= 3 (the OD-16 text counted 11)
                   NOTE: the OD-16 text's "11" is the 24-MATCH TOTAL of in-circle floor bigs at the OD-13 build (b6ffaf4e, F:/lc_p23/final/
                   shields/cen_24.json: per match 0 x20, 2 x3, 5 x1 -> median 0), not a per-match count; see INFO census-600-total
  INFO census-600-reserve (W9 R1B pass 1b, OD-16) big shields carried in the alive bots' bags at t = 600 s, mean per match (base 0.29;
                   INFO only: with the far-big seeking off (pass 2) there is no lane mechanism for it to gate)
  INFO census-600-total (W9 R1B) the batch totals of the census: unclaimed and all in-circle big shields at t = 600 s, summed over the matches
  INFO share>=75   (W9 C6) share of the alive-bot shield samples at t >= 600 s that are >= 75 (design target >= 60 %: the bimodal median's margin)
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

DEFAULT_RUNS = ",".join("%d:%s" % (s, m) for s, m in [
    (2, "isla_viva"), (3, "ashgrid"), (4, "deepwood"), (5, "isla_viva"), (6, "ashgrid"), (8, "deepwood"),
    (9, "isla_viva"), (10, "ashgrid"), (12, "deepwood"), (41, "isla_viva"), (42, "ashgrid"), (43, "deepwood"),
    (44, "isla_viva"), (45, "ashgrid"), (46, "deepwood"), (51, "isla_viva"), (52, "ashgrid"), (53, "deepwood"),
    (61, "isla_viva"), (62, "ashgrid"), (63, "deepwood"), (71, "isla_viva"), (72, "ashgrid"), (73, "deepwood")])
# (W9 R1B) shield-cap also caps from W._tickHook: the match runs through fastForward, which ticks the sim without the kernel's _updaters, so the
# updater alone never ran inside the batch (it bit only on rendered frames) - the control now holds the cap on every sim tick, as it says
PLANTS = {"shield-cap": "W.kernel._updaters.push(() => { for (const a of W.actors) if (a.isBot && a.alive && a.shield > 50) a.shield = 50; });"
                        " { const prev = W._tickHook; W._tickHook = (w) => { if (prev) prev(w); for (const a of W.actors) if (a.isBot && a.alive && a.shield > 50) a.shield = 50; }; }",
          # (W9 R1B) census-600's MEASURE control: at t = 590 s six big shields land inside the next circle and no bot may take them as a goal
          # (bots blind to big shields lying in the circle) - MUST FAIL (census-600)
          "census-surge": "{ const prev = W._tickHook; let done = false; const ids = new Set(); W._tickHook = (w) => { if (prev) prev(w);"
                          " if (!done && W.t >= 590 && W.stormCtl) { done = true; const st = W.stormCtl.storm.stateAt(W.t); const c = st.nextCenter || st.center;"
                          " const r = (st.nextRadius != null ? st.nextRadius : st.radius) * 0.5; for (let i = 0; i < 6; i++) { const ang = i * 1.047, x = c.x + Math.cos(ang) * r * 0.8, z = c.z + Math.sin(ang) * r * 0.8;"
                          " ids.add(W.netSpawnItem({ data: { kind: 'consumable', id: 'big_shield', count: 1 }, x, y: W.map.heightAt(x, z), z, id: 'plant_bs' + i })); } }"
                          " if (ids.size) for (const b of window.__LC__.brains()) { const bb = b.bb; if (bb.shieldGo && ids.has(bb.shieldGo.id)) bb.shieldGo = null;"
                          " if (bb.lootId != null && ids.has(bb.lootId)) bb.lootId = null; if (!bb.badLoot) bb.badLoot = Object.create(null); for (const id of ids) bb.badLoot[id] = W.t + 60; } }; }"}
# (W9 R1B pass 2) NO_FAR_BIG retired with the far-big seeking (bots.js WANT_BIG false in the lane): see the module docstring.
CENSUS_T, CENSUS_MAX = 600.0, 3
# (W9 R1B pass 1b) census-600-reserve: the OD-16 mechanism itself - a reserve big shield picked up in the 420-600 s window and CARRIED at t = 600 s.
# Big shields in the alive bots' bags at the census, MEAN per match >= RESERVE_MIN. Design pick: twice the base build's mean (09720db0, 24 matches:
# 7 bigs = 0.29 a match; the lane at e29c95c9: 28 = 1.17). The census-600 bar (unclaimed <= 3) is unchanged.
RESERVE_MIN = 0.6
# (W9 R1B) the t = 600 s census: big shields on the floor (death piles included) inside the next circle, and those no bot is walking to
CENSUS_JS = r"""() => { const W = window.__LC__.W, C = window.__LC__; const st = W.stormCtl ? W.stormCtl.storm.stateAt(W.t) : null; if (!st) return null;
  const c = st.nextCenter || st.center, r = st.nextRadius != null ? st.nextRadius : st.radius;
  const goals = new Set(); for (const b of C.brains()) { if (!b.actor.alive) continue; const g = b.bb.shieldGo; if (g && g.id != null) goals.add(g.id); if (b.bb.lootId != null) goals.add(b.bb.lootId); }
  let n = 0, un = 0, crates = 0; const where = [];
  for (const q of W.nearbyLoot({ x: c.x, y: W.map.heightAt(c.x, c.z), z: c.z }, r, 1e4)) {
    if (q.type === 'chest') { if (q.supply) crates++; continue; }
    if (q.type !== 'item' || !q.data || q.data.id !== 'big_shield') continue;
    const k = q.data.count || 1; n += k; if (!goals.has(q.id)) { un += k; if (where.length < 8) where.push([Math.round(q.pos.x), Math.round(q.pos.z), q.id]); } }
  // (information) the whole map's floor big shields / unopened crates, and what the alive bots carry
  let mapBigs = 0, mapCrates = 0, bagBigs = 0, bagMinis = 0, bots = 0;
  for (const q of W.nearbyLoot({ x: 0, y: 0, z: 0 }, (W.map.half || 800) * 1.5, 1e4)) { if (q.type === 'chest') { if (q.supply) mapCrates++; } else if (q.type === 'item' && q.data && q.data.id === 'big_shield') mapBigs += q.data.count || 1; }
  for (const b of C.brains()) { const a = b.actor; if (!a.alive) continue; bots++; for (const s2 of a.inventory.slots) if (s2 && s2.kind === 'consumable') { if (s2.id === 'big_shield') bagBigs += s2.count || 0; else if (s2.id === 'mini_shield') bagMinis += s2.count || 0; } }
  return { t: +W.t.toFixed(1), r: Math.round(r), bigs: n, unclaimed: un, supplyCratesUnopened: crates, where, alive: W.match.aliveCount(), mapBigs, mapCrates, bots, bagBigs, bagMinis }; }"""

COVER_MIN, NEGLECT_MAX, SH600_MIN, SURV_MIN, END_LO, END_HI = 15.0, 10.0, 75.0, 150.0, 600.0, 900.0
SHARE75_TARGET = 60.0


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 3) if xs else None


def analyze(results):
    out = {}
    ends = [r["simT"] for r in results if r.get("over")]
    out["matchEnd"] = {"median": med(ends), "notOver": sum(1 for r in results if not r.get("over")), "list": [round(r["simT"]) for r in results]}
    by = {}
    for x in [x for r in results for x in r.get("repeek", [])]:
        by.setdefault(x[1], []).append((x[0], x[4] if len(x) > 4 else None))
    out["resight"] = {str(t): {"n": len(v), "medianS": med([a for a, _ in v]), "reactMsMedian": med([b for _, b in v if b is not None]),
                               "ratioMedian": med([a * 1000 / b for a, b in v if b])} for t, v in sorted(by.items())}
    cv = {"engage": 0, "inCover": 0}
    for r in results:
        for k in cv:
            cv[k] += (r.get("cover") or {}).get(k, 0)
    cv["inCoverPct"] = round(100.0 * cv["inCover"] / cv["engage"], 1) if cv["engage"] else None
    out["cover"] = cv
    ng = {"calmLowShield": 0, "calmLowShieldWithItem": 0}
    for r in results:
        for k in ng:
            ng[k] += (r.get("neglect") or {}).get(k, 0)
    ng["pct"] = round(100.0 * ng["calmLowShieldWithItem"] / ng["calmLowShield"], 1) if ng["calmLowShield"] else None
    out["neglect"] = ng
    sh = [x for r in results for x in (r.get("sh600") or [])]
    out["shield600"] = {"n": len(sh), "median": med(sh), "perMatchMedian": [med(r.get("sh600") or []) for r in results]}
    out["share75"] = {"n": len(sh), "pct": round(100.0 * sum(1 for x in sh if x >= 75) / len(sh), 1) if sh else None}
    why = {"n": 0, "hasItem": 0, "hurt10": 0, "healing": 0, "target": 0, "noItemCalm": 0, "states": {}}
    for r in results:
        w = r.get("sh600why") or {}
        for k in ("n", "hasItem", "hurt10", "healing", "target", "noItemCalm"):
            why[k] += w.get(k, 0)
        for k, x in (w.get("states") or {}).items():
            why["states"][k] = why["states"].get(k, 0) + x
    out["sh600why"] = why
    cs = [r.get("census") for r in results]
    out["census600"] = {"medianUnclaimed": med([c["unclaimed"] for c in cs if c]), "perMatch": [(c["unclaimed"], c["bigs"], c["supplyCratesUnopened"]) if c else None for c in cs],
                        "mapAndBags": [{k: c.get(k) for k in ("mapBigs", "mapCrates", "bots", "bagBigs", "bagMinis")} if c else None for c in cs],
                        "missing": sum(1 for c in cs if not c)}
    out["reserve600"] = {"matches": sum(1 for c in cs if c), "bagBigs": sum(c.get("bagBigs", 0) for c in cs if c),
                         "perMatch": [c.get("bagBigs") if c else None for c in cs], "aliveBots": sum(c.get("bots", 0) for c in cs if c)}
    out["reserve600"]["meanPerMatch"] = round(out["reserve600"]["bagBigs"] / out["reserve600"]["matches"], 3) if out["reserve600"]["matches"] else None
    out["census600total"] = {"matches": sum(1 for c in cs if c), "unclaimed": sum(c["unclaimed"] for c in cs if c), "bigsInCircle": sum(c["bigs"] for c in cs if c),
                             "matchesWithUnclaimed": sum(1 for c in cs if c and c["unclaimed"] > 0)}
    surv = []
    for r in results:
        pd, lt = r.get("playerDeath"), r.get("landT")
        if lt is None:
            lt = next((q["t"] for q in r.get("landings", []) if q["id"] == r.get("pid")), None)
        if lt is not None:
            surv.append(round((pd["t"] if pd else r["simT"]) - lt, 1))
    out["afkSurvival"] = {"median": med(surv), "list": surv}
    nb = [sum(1 for n in r.get("nades", []) if n["bot"] and n["w"] == "frag") for r in results]
    out["frags"] = {"perMatch": nb, "matchesWith0": sum(1 for x in nb if x == 0)}
    out["pageErrors"] = sum(len(r.get("pageErrors") or []) for r in results)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--runs", default=DEFAULT_RUNS)
    ap.add_argument("--maxs", type=float, default=1150)
    args = L.parse(ap)
    probe = open(os.path.join(L.HERE, "js", "botbatch_probe.js"), encoding="utf-8").read()

    def body(v):
        results = []
        with C.Session(args, "p23_botbatch", viewport={"width": 960, "height": 600}) as s:
            s.boot()
            L.dismiss_cards(s)
            s.page.evaluate(probe)
            for spec in args.runs.split(","):
                seed, mp = spec.split(":")[:2]
                t0 = time.time()
                L.start(s, "standard", int(seed), mp, team="solo", guard=False)
                s.freeze_loop()
                if args.plant and PLANTS[args.plant]:
                    L.plant_js(s, PLANTS[args.plant])
                s.page.evaluate("(o) => window.__AF.install(o)", {"human": "afk"})
                el, census = 0, None
                t = s.page.evaluate("() => window.__LC__.W.t")
                while el < args.maxs:
                    step = 30
                    if census is None and t < CENSUS_T < t + 30:      # (W9 R1B) land the slice on t = 600 s for the census
                        step = max(0.5, 0.5 * round((CENSUS_T - t) / 0.5 + 0.49))
                    st = s.page.evaluate("(x) => window.__AF.advance(x)", step)
                    el += step
                    t = st["t"]
                    if census is None and t >= CENSUS_T and not st.get("over"):
                        census = s.page.evaluate(CENSUS_JS)
                    if st.get("over"):
                        break
                res = s.page.evaluate("() => window.__AF.collect()")
                res["census"] = census
                res["spec"] = spec
                res["wall_s"] = round(time.time() - t0, 1)
                res["pageErrors"] = [e for e in s.page_errors]
                results.append(res)
                print("  run %s: end %.1f over %s wall %.0f s" % (spec, res["simT"], res.get("over"), res["wall_s"]), flush=True)
                s.thaw_loop()
            L.errors_row(v, s, "errors (0 page / console errors, 0 failed requests over the batch)")
        a = analyze(results)
        v.data["summary"] = a
        n = len(results)
        if n < 24:
            v.note("VALIDATION-SIZE batch (%d matches): the bars are the 24-match batch's" % n)
        for t, r in a["resight"].items():
            v.check("resight [tier %s] (re-sight-to-shot median >= the tier's reactionMs)" % t, r["ratioMedian"] is not None and r["ratioMedian"] >= 1.0, r, "ratio >= 1.0")
        if not a["resight"]:
            v.check("resight (re-sight-to-shot median >= the tier's reactionMs)", False, {"samples": 0}, "samples")
        c = a["cover"]
        v.check("cover (ENGAGE in cover >= %.0f %%)" % COVER_MIN, c["inCoverPct"] is not None and c["inCoverPct"] >= COVER_MIN, c, ">= %.0f %%" % COVER_MIN)
        g = a["neglect"]
        v.check("neglect (calm, < 50 shield, holding a shield item <= %.0f %%)" % NEGLECT_MAX, g["pct"] is not None and g["pct"] <= NEGLECT_MAX, g, "<= %.0f %%" % NEGLECT_MAX)
        sh = a["shield600"]
        v.check("shield-600 (median alive-bot shield at t >= 600 s >= %.0f)" % SH600_MIN, sh["median"] is not None and sh["median"] >= SH600_MIN, sh, ">= %.0f" % SH600_MIN)
        sv = a["afkSurvival"]
        v.check("afk-survival (AFK human median survival >= %.0f s)" % SURV_MIN, sv["median"] is not None and sv["median"] >= SURV_MIN, sv, ">= %.0f s" % SURV_MIN)
        fr = a["frags"]
        v.check("frags (>= 1 bot frag throw in every match)", n > 0 and fr["matchesWith0"] == 0, fr, "0 matches without")
        me = a["matchEnd"]
        v.check("match-end (median %.0f-%.0f s, every match over)" % (END_LO, END_HI), me["median"] is not None and END_LO <= me["median"] <= END_HI and me["notOver"] == 0, me, "10-15 min")
        ce = a["census600"]
        v.check("census-600 (median unclaimed big shields inside the next circle at t = 600 s <= %d)" % CENSUS_MAX,
                ce["medianUnclaimed"] is not None and ce["medianUnclaimed"] <= CENSUS_MAX, ce, "<= %d" % CENSUS_MAX)
        rv = a["reserve600"]
        # (W9 R1B pass 1b/2) INFO, not a gate: no lane mechanism to gate since pass 2 (far-big seeking off, crate big x2)
        v.info("census-600-reserve (big shields carried by the alive bots at t = 600 s, mean per match; design pick %.1f; INFO)" % RESERVE_MIN, rv)
        v.info("census-600-total (batch sums at t = 600 s: unclaimed / all in-circle big shields; the OD-16 '11' was such a 24-match total, INFO)", a["census600total"])
        v.info("share>=75 (alive-bot shield samples at t >= 600 s that are >= 75; design target >= %.0f %%, INFO)" % SHARE75_TARGET, a["share75"])
        v.info("sh600why (bots under 75 at t >= 600 s: why; diagnosis)", a["sh600why"])
    return C.run_gate("p23_botbatch", body, args)


if __name__ == "__main__":
    sys.exit(main())
