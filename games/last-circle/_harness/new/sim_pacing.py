#!/usr/bin/env python
"""sim_pacing - D8 bot-match pacing gate (lane SIM, Wave 4): do the late storm circles actually happen?

Whole storm-on standard matches through fastForward (the SAME in-page probe probe_match.py uses: probe_match.js), one
Chrome, every run in sequence. A repeated (seed, map) pair is the same-seed replay check.

    python _harness/new/sim_pacing.py --disk
    python _harness/new/sim_pacing.py --disk --runs 1:isla_viva,7:isla_viva,13:deepwood,12:ashgrid --no-replay
    python _harness/new/sim_pacing.py --isolate      # git HEAD + ONLY lane SIM's files from the working copy (while lanes edit)

OWNER TARGETS (PLAN.md D8): median match end >= 600 s, and at most 12 of 49 bots dead in the first 60 s; the final circles
(>= 5 of 8) are reached in most matches. Measured before this lane: ends 264-380 s (median 326), 9-21 dead in the first 60 s,
every match over during circle 2.

GATES (pooled over DISTINCT (seed, map) runs):
  every run left the lobby by a REAL Enter (storm on)           every run ended (match.over) inside the --seconds cap
  median match end >= 600 s                                     deaths before 60 s <= 12 in EVERY run (median and max reported)
  storm circle >= 5 at the end of most runs (> half)            pistol share of gun kills <= 35 %
  stuck < 2 % of moving samples in every run                    same seed twice: identical 5-s fingerprints AND placements
  a different seed on one map gives a different match           0 page / window errors, 0 console errors, 0 failed requests
INFO: match ends, deaths < 60 s, circle reached, alive at 60/120/180/300/420/600 s, storm kills, kill distance in the first
60 s, share of landed life spent in ENGAGE.
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import collections
import mimetypes
import os
import statistics
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402

PROBE_JS = os.path.join(os.path.dirname(HERE), "probe_match.js")
DEFAULT_RUNS = ("1:isla_viva,1:isla_viva,7:isla_viva,11:ashgrid,12:ashgrid,13:deepwood,23:deepwood,"
                "3:isla_viva,5:ashgrid,9:deepwood")
GUN_EXCLUDED = ("storm", "none", None, "fall", "zone")
CHECKPOINTS = (60, 120, 180, 300, 420, 600)
# --isolate: lane SIM's files (the only ones whose working copy is served; everything else = git HEAD)
SIM_FILES = ("runtime/sim/royale.js", "runtime/3d/royale/bots.js", "runtime/3d/royale/weapons.js")


def isolate_overlay(session, args):
    """Route ONLY lane SIM's files to the working copy (or --overlay-root) while the session serves git HEAD for the rest:
    another lane's half-written file cannot fail this gate. Same mechanism as player_lib.overlay (DiskServer.overrides)."""
    if not getattr(args, "isolate", False) or session.disk is None:
        return
    root = args.overlay_root or C.ROOT

    def rel_of(url):
        u = urllib.parse.urlparse(url)
        return urllib.parse.unquote(u.path[len(C.GAME_PATH):]) if u.path.startswith(C.GAME_PATH) else None

    def pred(url):
        rel = rel_of(url)
        return rel in SIM_FILES and os.path.isfile(os.path.join(root, rel.replace("/", os.sep)))

    def handle(route):
        full = os.path.join(root, rel_of(route.request.url).replace("/", os.sep))
        with open(full, "rb") as f:
            body = f.read()
        ct = C.CTYPES.get(os.path.splitext(full)[1].lower()) or mimetypes.guess_type(full)[0] or "application/octet-stream"
        session.disk.served += 1
        route.fulfill(status=200, body=body, headers={"Content-Type": ct, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})

    session.disk.overrides.append((pred, handle))


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def alive_at(series, t):
    row = next((s for s in series if s["t"] >= t), None)
    return row["matchAlive"] if row else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--runs", default=DEFAULT_RUNS, help="seed:map list (a repeated pair is the replay check; default %(default)s)")
    ap.add_argument("--seconds", type=float, default=1100.0, help="sim seconds per match (stops at match end)")
    ap.add_argument("--step", type=float, default=1 / 30)
    ap.add_argument("--min-end", type=float, default=600.0, help="gate: median match end (s)")
    ap.add_argument("--max-d60", type=int, default=12, help="gate: deaths before 60 s in every run")
    ap.add_argument("--min-circle", type=int, default=5, help="gate: storm circle reached by the end of most matches")
    ap.add_argument("--no-replay", action="store_true", help="skip the same-seed replay row (CNJ when no pair is in --runs)")
    ap.add_argument("--isolate", action="store_true", help="serve git HEAD + ONLY lane SIM's files from the working copy (implies --disk)")
    ap.add_argument("--overlay-root", default=None, metavar="DIR", help="with --isolate: take lane SIM's files from DIR (laid out like games/last-circle)")
    args = ap.parse_args()
    if args.isolate:
        args.disk = True
        args.rev = args.rev or "HEAD"
    runs = []
    for r in args.runs.split(","):
        if r.strip():
            sd, mp = r.strip().split(":")
            runs.append((int(sd), mp))
    js_match = open(PROBE_JS, encoding="utf-8").read()

    def body(v):
        results = []
        with C.Session(args, "sim_pacing", viewport={"width": 960, "height": 600}) as s:
            isolate_overlay(s, args)
            s.boot()
            s.freeze_loop()
            for k, (seed, mp) in enumerate(runs):
                t0 = time.time()
                st = s.start_match("standard", seed, mp, enter=True)
                s.freeze_loop()
                res = s.page.evaluate(js_match, [seed, mp, args.seconds, args.step, 0, 1, 1, []])
                res["wallTotal"] = round(time.time() - t0, 1)
                res["load"] = st
                res["run"] = k
                results.append(res)
                d60 = sum(1 for x in res["kills"] if x["t"] < 60)
                ph = res["series"][-1].get("phase") if res["series"] else None
                print("  run %d seed %d %s: end %.1f s over %s deaths<60s %d circle %s kills %d wall %.0f s" % (
                    k, seed, res["map"], res["simT"], res["over"], d60, ph, len(res["kills"]), res["wallTotal"]), flush=True)
            d = s.diagnostics()
        v.data["results"] = [{k2: r[k2] for k2 in ("seed", "map", "simT", "over", "winner", "placements", "kills", "agg", "fp", "hashes", "series")} for r in results]
        bad = [(r["seed"], r["map"], r["phaseAfterLobby"]) for r in results if r["phaseAfterLobby"] not in ("drop", "match")]
        v.check("every run left the lobby by a REAL Enter (storm on)", not bad, bad or [r["phaseAfterLobby"] for r in results])
        seen, distinct = set(), []
        for r in results:
            key = (r["seed"], r["map"])
            if key not in seen:
                seen.add(key)
                distinct.append(r)
        if len(distinct) < 6:
            v.cnj("at least 6 distinct (seed, map) runs", "only %d in --runs" % len(distinct))
        notover = [(r["seed"], r["map"], r["simT"]) for r in distinct if not r["over"]]
        v.check("every match ended (match.over) inside the --seconds cap", not notover, notover or "all over",
                expect="a match that outlasts the cap would be a stalemate, not pacing")
        ends = [r["simT"] for r in distinct]
        med = statistics.median(ends) if ends else None
        v.check("median match end >= %d s" % args.min_end, med is not None and med >= args.min_end,
                {"median": med, "ends": ends, "min": min(ends) if ends else None, "max": max(ends) if ends else None},
                expect=">= %d s (was 326.6 median, 264-380 s)" % args.min_end)
        d60s = [sum(1 for x in r["kills"] if x["t"] < 60) for r in distinct]
        v.check("deaths before 60 s <= %d in every run" % args.max_d60, bool(d60s) and max(d60s) <= args.max_d60,
                {"perRun": d60s, "median": statistics.median(d60s) if d60s else None, "max": max(d60s) if d60s else None},
                expect="<= %d of 49 (was 9-21, median 16)" % args.max_d60)
        circles = [(r["series"][-1].get("phase") if r["series"] else None) for r in distinct]
        reached = sum(1 for c in circles if c is not None and c >= args.min_circle)
        v.check("storm circle >= %d reached in most matches" % args.min_circle, reached * 2 > len(distinct),
                {"circleAtEnd": circles, "reached": reached, "of": len(distinct)}, expect="> half (was 0 of 6: every match ended in circle 2)")
        kills = [k for r in distinct for k in r["kills"]]
        wids = collections.Counter(k["wid"] or "none" for k in kills)
        gun = sum(n for w, n in wids.items() if w not in GUN_EXCLUDED)
        ps = pct(wids.get("pistol", 0), gun)
        v.check("pistol share of gun kills <= 35 %", ps is not None and ps <= 35,
                {"pistolKills": wids.get("pistol", 0), "gunKills": gun, "pct": ps, "byWeapon": dict(wids)}, expect="<= 35 % (was 17.7 %)")
        stuck = []
        for r in distinct:
            ag = r["agg"]
            stuck.append({"seed": r["seed"], "map": r["map"], "stuckPct": pct(ag["stuckNetN"], ag["movingN"]), "moving": ag["movingN"]})
        v.check("stuck < 2 % of moving samples in every run", all(x["stuckPct"] is not None and x["stuckPct"] < 2 for x in stuck), stuck,
                expect="< 2 % (was <= 0.3 %): longer matches must not be stuck bots")
        by = collections.defaultdict(list)
        for r in results:
            by[(r["seed"], r["map"])].append(r)
        reps = [(k, rs) for k, rs in by.items() if len(rs) >= 2]
        if args.no_replay or not reps:
            v.cnj("the same seed twice: identical fingerprints and placements", "no repeated (seed, map) in --runs" if not args.no_replay else "--no-replay")
        else:
            rows = []
            for k, rs in reps:
                a, b = rs[0]["fp"], rs[1]["fp"]
                div = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), None)
                same = div is None and len(a) == len(b) and rs[0]["placements"] == rs[1]["placements"]
                rows.append({"seed": k[0], "map": k[1], "same": same, "firstDivergenceSample": div, "approxT": None if div is None else div * 5,
                             "fpLens": [len(a), len(b)], "winners": [rs[0]["winner"], rs[1]["winner"]], "simT": [rs[0]["simT"], rs[1]["simT"]]})
            v.check("the same seed twice: identical fingerprints and placements", all(x["same"] for x in rows), rows, expect="identical")
        diff = None
        for i, r1 in enumerate(distinct):
            for r2 in distinct[i + 1:]:
                if r1["map"] == r2["map"] and r1["seed"] != r2["seed"]:
                    diff = (r1, r2)
                    break
            if diff:
                break
        if not diff:
            v.cnj("a different seed gives a different match", "no two distinct seeds on one map in --runs")
        else:
            v.check("a different seed gives a different match", diff[0]["fp"] != diff[1]["fp"], {"seeds": [diff[0]["seed"], diff[1]["seed"]], "map": diff[0]["map"]})
        # information
        v.info("match end (s) per distinct run", dict(zip(["%d:%s" % (r["seed"], r["map"]) for r in distinct], ends)))
        v.info("alive (of 50) at checkpoints, median over runs", {str(t): statistics.median([x for x in (alive_at(r["series"], t) for r in distinct) if x is not None] or [0]) for t in CHECKPOINTS})
        e60 = [x for r in distinct for x in r["kills"] if x["t"] < 60]
        v.info("storm kills (every other death is a bot-vs-bot kill)", {"stormKills": wids.get("storm", 0), "kills": len(kills)})
        v.info("kills in the first 60 s: how many were killed by a tier-4/5 bot (killer tier unknown to the probe: pistol/AR split only)",
               {"n": len(e60), "byWeapon": dict(collections.Counter(x["wid"] or "none" for x in e60))})
        eng = [pct(r["agg"]["stateCount"].get("ENGAGE", 0), sum(r["agg"]["stateCount"].values())) for r in distinct]
        v.info("share of landed bot samples in ENGAGE per run (%)", eng)
        v.info("wall seconds per run (sim cost: longer matches keep more bots alive)", [r["wallTotal"] for r in results])
        if args.isolate:
            v.data["servedFrom"] = "git %s + working-copy overlay: %s" % (args.rev, list(SIM_FILES))
        v.check("no page errors / window errors during the runs", not (d["pageErrors"] or d["windowErrors"]),
                {"pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3]})
        v.check("0 console errors, 0 shader errors, 0 failed requests", not (d["consoleErrors"] or d["shader"] or d["failedRequests"]),
                {"consoleErrors": d["consoleErrors"][:3], "shader": d["shader"][:3], "failedRequests": d["failedRequests"][:3]})
    return C.run_gate("sim_pacing", body, args)


if __name__ == "__main__":
    sys.exit(main())
