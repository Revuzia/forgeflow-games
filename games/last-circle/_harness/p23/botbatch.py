#!/usr/bin/env python
"""botbatch - the P2-B 24-match AFK bot batch (lane bots; plan P2-B "Gates (24-match AFK batch)"): the cover / re-sight probe promoted into the
harness (p23/js/botbatch_probe.js, from lane P23/bots' scratch probe, itself from the ai_flow audit's af_probe4.js; read-only on bot decisions).

    python _harness/p23/botbatch.py --disk                          # 24 whole STANDARD matches (the long one)
    python _harness/p23/botbatch.py --disk --runs 2:isla_viva,3:ashgrid,4:deepwood     # a short subset (validation only: bars need the batch)
    python _harness/p23/botbatch.py --rev 9aa2b746                  # control: the P2 base (cover 3.4 %, neglect 48.8 %, shield@600 9) - MUST FAIL
    python _harness/p23/botbatch.py --disk --runs 2:isla_viva --plant shield-cap      # every bot's shield held <= 50 (a bot that never tops up)
                                                                    # - MUST FAIL (shield-600; the measure's control, the base is the logic one)
    python _harness/p23/botbatch.py --lanes bots                    # validation: lane bots' work served over the base

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
PLANTS = {"shield-cap": "W.kernel._updaters.push(() => { for (const a of W.actors) if (a.isBot && a.alive && a.shield > 50) a.shield = 50; })"}
COVER_MIN, NEGLECT_MAX, SH600_MIN, SURV_MIN, END_LO, END_HI = 15.0, 10.0, 75.0, 150.0, 600.0, 900.0


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
    out["shield600"] = {"n": len(sh), "median": med(sh)}
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
                if args.plant:
                    L.plant_js(s, PLANTS[args.plant])
                s.page.evaluate("(o) => window.__AF.install(o)", {"human": "afk"})
                el = 0
                while el < args.maxs:
                    st = s.page.evaluate("(x) => window.__AF.advance(x)", 30)
                    el += 30
                    if st.get("over"):
                        break
                res = s.page.evaluate("() => window.__AF.collect()")
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
    return C.run_gate("p23_botbatch", body, args)


if __name__ == "__main__":
    sys.exit(main())
