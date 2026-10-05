#!/usr/bin/env python
"""probe_match - whole storm-on matches: bot loadouts, navigation, kills, replay determinism, loot census (PLAN L6 gates).

    python _harness/probe_match.py                                   # 7 runs (6 seeds, seed 1 twice) + paths/census on 3 maps
    python _harness/probe_match.py --runs 1:isla_viva,1:isla_viva --no-paths --rev 7da063ad
    python _harness/probe_match.py --disk --seconds 600

Promoted from _spec/improve_2026-09/baseline/probe_match.{py,js}, probe_paths.{py,js} and probe_farwall.{py,js} (the bots
audit). The in-page probes are READ-ONLY on game state (W.paused aside, which fastForward ignores). What changed vs the
audit's driver:
  * the match is started by common.start_match: startMatch() -> the lobby -> a REAL Enter key press, with the kernel's own
    loop FROZEN first, so W.phase really reaches 'drop' -> 'match' (the storm deals damage) and no wall-clock frame advances
    the sim between the Enter and the first fastForward (a same-seed replay is then a fair test of the SIM);
  * one page, one browser, every run in sequence (the box is shared);
  * probe_paths uses the game's own path search when bots.js exports debugNav() (lane L6) and a LIVE loot census.

GATES (PLAN L6; pooled over DISTINCT (seed, map) runs unless stated):
  pistol share of gun kills <= 35 %                 bot lives that END holding the pistol <= 40 %
  landed samples carrying a better gun but HOLDING the pistol < 5 % of samples that carry a better gun - TWO rows: the raw-DPS
  sim gunScore metric (the better gun must be loaded and out-score the held pistol; the audit's looser count is INFO), and the
  range/ammo-aware one (VERIFY.md #24, L6 pmdiag: sim gunValueAt at the live
  fight, bots.js's own swap rule mirrored in probe_match.js valueBetter)
  sniper kills > 0 in most matches                  stuck (net < 0.4 m over 3 s while in a moving state) < 2 % of moving
                                                    samples in EVERY run, and no bot with > 5 stuck episodes in a run
  seed 1 isla_viva: bot s21 is never frozen >= 12 s and leaves Coco Village (or dies)
  the same seed twice: identical 5-s fingerprints AND placements; a different seed: different fingerprints
  census per map: (floor guns + chests) / players >= 3 and >= 8 light-ammo boxes; the game's path search finds a usable
  path for >= 15 of 30 blocked pairs at 120 m and at 180 m
  --farwall (gate.py passes it): far-bot wall clipping farToNearInside == 0 (PLAN L5 d) on seeds 1 and 7 isla_viva
INFO: pacing (deaths before 60 s, match end), dry shares, sniper/launcher carried but pistol held.
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_RUNS = "1:isla_viva,1:isla_viva,7:isla_viva,11:ashgrid,12:ashgrid,13:deepwood,23:deepwood"
GUN_WIDS_EXCLUDED = ("storm", "none", None, "fall", "zone")


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def longest_frozen(track, box=0.4):
    """Longest span (s) of consecutive alive, landed samples whose x/z stay inside a `box` m box."""
    pts = [r for r in track if r[4] == 1 and r[5] == 0]
    best = (0.0, None)
    i = 0
    n = len(pts)
    while i < n:
        mnx = mxx = pts[i][1]
        mnz = mxz = pts[i][3]
        j = i
        while j + 1 < n:
            x, z = pts[j + 1][1], pts[j + 1][3]
            nx0, nx1, nz0, nz1 = min(mnx, x), max(mxx, x), min(mnz, z), max(mxz, z)
            if math.hypot(nx1 - nx0, nz1 - nz0) >= box or pts[j + 1][0] - pts[j][0] > 1.01:
                break
            mnx, mxx, mnz, mxz = nx0, nx1, nz0, nz1
            j += 1
        span = pts[j][0] - pts[i][0]
        if span > best[0]:
            best = (round(span, 1), [pts[i][0], pts[i][1], pts[i][2], pts[i][3], pts[i][6]])
        i = j + 1 if j > i else i + 1
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--runs", default=DEFAULT_RUNS, help="seed:map list (a repeated pair is the replay check; default %(default)s)")
    ap.add_argument("--seconds", type=float, default=1000.0, help="sim seconds per match (stops at match end)")
    ap.add_argument("--step", type=float, default=1 / 30)
    ap.add_argument("--no-paths", action="store_true", help="skip probe_paths (census + path search)")
    ap.add_argument("--paths-maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--paths-live", type=float, default=60.0, help="live path-sampling seconds per map (information)")
    ap.add_argument("--farwall", action="store_true", help="also run probe_farwall (far-bot wall clipping; gates farToNearInside == 0, PLAN L5 d)")
    args = ap.parse_args()
    runs = []
    for r in args.runs.split(","):
        if r.strip():
            sd, mp = r.strip().split(":")
            runs.append((int(sd), mp))
    js_match = open(os.path.join(HERE, "probe_match.js"), encoding="utf-8").read()
    js_paths = open(os.path.join(HERE, "probe_paths.js"), encoding="utf-8").read()
    js_far = open(os.path.join(HERE, "probe_farwall.js"), encoding="utf-8").read()

    def body(v):
        results, paths, far = [], [], []
        with C.Session(args, "probe_match", viewport={"width": 960, "height": 600}) as s:
            s.boot()
            s.freeze_loop()
            for k, (seed, mp) in enumerate(runs):
                t0 = time.time()
                st = s.start_match("standard", seed, mp, enter=True)
                s.freeze_loop()                         # startMatch may restart the kernel loop
                watch = ["s21"] if (seed == 1 and mp == "isla_viva") else []
                res = s.page.evaluate(js_match, [seed, mp, args.seconds, args.step, 0, 1, 1, watch])
                res["wallTotal"] = round(time.time() - t0, 1)
                res["load"] = st
                res["run"] = k
                results.append(res)
                wids = collections.Counter(x["wid"] or "none" for x in res["kills"])
                print("  run %d seed %d %s: phase %s->%s->%s simT %s over %s winner %s kills %d %s wall %.0f s (sim %.0f s)" % (
                    k, seed, res["map"], res["phaseAfterStart"], res["phaseAfterLobby"], res["phaseEnd"], res["simT"], res["over"],
                    res["winner"], len(res["kills"]), dict(wids), res["wallTotal"], res["wallS"]), flush=True)
                C.save_report("probe_match_raw", {"results": results}, out=os.path.join(C.REPORTS, "probe_match_raw_partial.json"))
            if not args.no_paths:
                for i, mp in enumerate([m for m in args.paths_maps.split(",") if m]):
                    t0 = time.time()
                    s.start_match("standard", 11 + i, mp, enter=False)
                    s.freeze_loop()
                    r = s.page.evaluate(js_paths, [11 + i, mp, args.paths_live, 1 / 30, 1])
                    r["wall"] = round(time.time() - t0, 1)
                    paths.append(r)
                    print("  paths %s: %s; census %s" % (mp, r["navSrc"], json.dumps(r["census"])), flush=True)
                    for D, row in r["exp"].items():
                        print("     D=%4s n=%2d game-useful %2d | verbatim-mid %2d | start-centred %2d" % (D, row["n"], row["gameUseful"], row["midUseful"], row["startUseful"]))
            if args.farwall:
                for seed, mp in ((1, "isla_viva"), (7, "isla_viva")):
                    s.start_match("standard", seed, mp, enter=True)
                    s.freeze_loop()
                    far.append(s.page.evaluate(js_far, [seed, mp, 400, 1]))
            d = s.diagnostics()
        v.data["results"] = results
        v.data["paths"] = paths
        v.data["farwall"] = far
        # ---------------- verdicts ----------------
        bad_phase = [(r["seed"], r["map"], r["phaseAfterLobby"]) for r in results if r["phaseAfterLobby"] not in ("drop", "match")]
        v.check("every run left the lobby by a REAL Enter (storm on)", not bad_phase, bad_phase or [r["phaseAfterLobby"] for r in results])
        seen, distinct = set(), []
        for r in results:
            key = (r["seed"], r["map"])
            if key not in seen:
                seen.add(key)
                distinct.append(r)
        ei = [e for r in distinct for e in r["endInv"]]
        kills = [k for r in distinct for k in r["kills"]]
        wids = collections.Counter(k["wid"] or "none" for k in kills)
        gun = sum(n for w, n in wids.items() if w not in GUN_WIDS_EXCLUDED)
        ps = pct(wids.get("pistol", 0), gun)
        v.check("pistol share of gun kills <= 35 %", ps is not None and ps <= 35, {"pistolKills": wids.get("pistol", 0), "gunKills": gun, "pct": ps, "byWeapon": dict(wids)},
                expect="<= 35 % (was 60.2 %)")
        eol = pct(sum(1 for e in ei if e["active"] == "pistol"), len(ei))
        v.check("bot lives that end holding the pistol <= 40 %", eol is not None and eol <= 40, {"pct": eol, "n": len(ei)}, expect="<= 40 % (was 74.8 %)")
        bn = sum(r["agg"].get("betterN", 0) for r in distinct)
        bh = sum(r["agg"].get("betterHoldPistolN", 0) for r in distinct)
        rn = sum(r["agg"].get("rawBetterN", 0) for r in distinct)
        rh = sum(r["agg"].get("rawHoldPistolN", 0) for r in distinct)
        v.check("carrying a better gun but holding the pistol < 5 % (landed samples, raw-DPS gunScore)", rn > 0 and pct(rh, rn) < 5,
                {"holdPistol": rh, "carryBetter": rn, "pct": pct(rh, rn)},
                expect="< 5 % ('better' = a LOADED gun with a higher sim gunScore than the common pistol; 'holds the pistol' = a pistol "
                       "scoring below that gun; range is ignored - the value-aware row below judges range)")
        v.info("audit definition of the same row (comparable with the audit's 74.8 % era numbers; counts a held rare pistol and dry guns)",
               {"holdPistol": bh, "carryBetter": bn, "pct": pct(bh, bn)})
        # VERIFY.md #24: the range/ammo-aware variant (L6 pmdiag; probe_match.js valueBetter) beside the raw-DPS one
        if not any(r["agg"].get("valueAware") for r in distinct):
            v.cnj("carrying a better gun (range/ammo-aware value) but holding the pistol < 5 %", "the sim exposes no gunValueAt")
        else:
            vb = sum(r["agg"].get("valBetterN", 0) for r in distinct)
            vh = sum(r["agg"].get("valHoldPistolN", 0) for r in distinct)
            vj = sum(r["agg"].get("valJudgedN", 0) for r in distinct)
            bd = collections.Counter()
            for r in distinct:
                bd.update(r["agg"].get("valByDist") or {})
            v.check("carrying a better gun (range/ammo-aware value) but holding the pistol < 5 %", vb > 0 and pct(vh, vb) < 5,
                    {"holdPistol": vh, "carryBetterByValue": vb, "pct": pct(vh, vb), "judgedSamples": vj, "holdPistolByFightDist": dict(bd),
                     "examples": [x for r in distinct for x in (r.get("valSamples") or [])][:6]},
                    expect="< 5 % ('better' = beats the pistol slot by bots.js's own rule: sim gunValueAt at the live fight's range/EHP "
                           "or the idle mean, own mag + reserve, swap price 0.4 s, margin 1.15; swap-gate/reload/consumable samples skipped)")
        sn = [r for r in distinct if any(k["wid"] == "sniper" for k in r["kills"])]
        v.check("sniper kills > 0 in most matches", len(sn) * 2 > len(distinct), {"matchesWithSniperKills": len(sn), "matches": len(distinct),
                                                                                   "sniperKills": wids.get("sniper", 0)}, expect="> half (was 4 sniper kills in 539)")
        stuck_rows, ep_rows = [], []
        for r in distinct:
            ag = r["agg"]
            share = pct(ag["stuckNetN"], ag["movingN"])
            per = collections.Counter(e["id"] for e in r["stuckEp"])
            worst = per.most_common(1)[0] if per else (None, 0)
            stuck_rows.append({"seed": r["seed"], "map": r["map"], "stuckPct": share, "moving": ag["movingN"], "everStuck": ag["everStuck"],
                               "longestFrozen": r.get("maxStuck", [])[:3]})
            ep_rows.append({"seed": r["seed"], "map": r["map"], "worstBot": worst[0], "episodes": worst[1]})
        v.check("stuck < 2 % of moving samples in every run", all(x["stuckPct"] is not None and x["stuckPct"] < 2 for x in stuck_rows), stuck_rows,
                expect="< 2 % (was 12-27 % on isla_viva)")
        v.check("no bot with > 5 stuck episodes in a run", all(x["episodes"] <= 5 for x in ep_rows), ep_rows)
        s1 = [r for r in results if r["seed"] == 1 and r["map"] == "isla_viva" and r.get("track", {}).get("s21")]
        if not s1:
            v.cnj("seed 1 isla_viva: s21 leaves Coco Village", "no seed-1 isla_viva run with a track for s21")
        else:
            rows = []
            for r in s1:
                coco = next((p for p in r.get("pois", []) if p.get("name") == "Coco Village"), None)
                tr = r["track"]["s21"]
                landed = [x for x in tr if x[5] == 0 and x[4] == 1]
                left = bool(coco) and any(math.hypot(x[1] - coco["x"], x[3] - coco["z"]) > coco["r"] for x in landed)
                died = next((x[0] for x in tr if x[4] == 0), None)
                fz = longest_frozen(tr)
                # never frozen >= 12 s (L6's hard breaker) AND it got out (left the POI radius) or died fighting
                ok = fz[0] < 12 and (left or died is not None)
                rows.append({"run": r["run"], "leftCoco": left, "diedAt": died, "longestFrozenS": fz[0], "frozenAt": fz[1], "coco": coco, "ok": ok})
            v.check("seed 1 isla_viva: s21 is never frozen >= 12 s and leaves Coco Village (or dies)", all(x["ok"] for x in rows), rows,
                    expect="leaves (was frozen t=29.9-358.9 s in a 2nd-floor corner)")
        by = collections.defaultdict(list)
        for r in results:
            by[(r["seed"], r["map"])].append(r)
        reps = [(k, rs) for k, rs in by.items() if len(rs) >= 2]
        if not reps:
            v.cnj("the same seed twice: identical fingerprints and placements", "no repeated (seed, map) in --runs")
        else:
            rows = []
            for k, rs in reps:
                a, b = rs[0]["fp"], rs[1]["fp"]
                div = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), None)
                same = div is None and len(a) == len(b) and rs[0]["placements"] == rs[1]["placements"]
                rows.append({"seed": k[0], "map": k[1], "same": same, "firstDivergenceSample": div, "approxT": None if div is None else div * 5,
                             "fpLens": [len(a), len(b)], "winners": [rs[0]["winner"], rs[1]["winner"]], "simT": [rs[0]["simT"], rs[1]["simT"]]})
            v.check("the same seed twice: identical fingerprints and placements", all(x["same"] for x in rows), rows,
                    expect="identical (was: diverges at ~25 s)")
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
            v.check("a different seed gives a different match", diff[0]["fp"] != diff[1]["fp"],
                    {"seeds": [diff[0]["seed"], diff[1]["seed"]], "map": diff[0]["map"]})
        if not args.no_paths:
            for r in paths:
                c = r["census"]
                guns = sum((c.get("floorWeapons") or {}).values()) + c.get("chests", 0)
                players = 50
                v.check("census %s: (floor guns + chests) / players >= 3" % r["map"], guns / players >= 3,
                        {"floorGuns": sum((c.get("floorWeapons") or {}).values()), "chests": c.get("chests"), "perPlayer": round(guns / players, 2),
                         "floorWeapons": c.get("floorWeapons")}, expect=">= 3 (was 1.42 isla_viva)")
                v.check("census %s: >= 8 light-ammo boxes on the floor" % r["map"], (c.get("ammo") or {}).get("light", 0) >= 8,
                        {"light": (c.get("ammo") or {}).get("light", 0), "ammo": c.get("ammo")}, expect=">= 8 (was 1 on isla_viva)")
                for D in ("120", "180"):
                    row = r["exp"].get(D) or r["exp"].get(int(D)) or {}
                    v.check("paths %s: the game's search is usable for >= 15/30 blocked pairs at %s m" % (r["map"], D),
                            row.get("n", 0) >= 20 and row.get("gameUseful", 0) >= 15,
                            {"useful": row.get("gameUseful"), "n": row.get("n"), "source": r["navSrc"]}, expect=">= 15/30 (was 0/30 beyond 120 m)")
                v.info("paths %s live sampling (information)" % r["map"], r.get("live"))
        # information
        early = [sum(1 for k in r["kills"] if k["t"] < 60) for r in distinct]
        v.info("pacing: deaths before 60 s per match / match end (s)", {"deathsBefore60": early, "end": [r["simT"] for r in distinct],
                                                                       "over": [r["over"] for r in distinct]})
        csl = sum(r["agg"]["carrySniperLauncherN"] for r in distinct)
        cnh = sum(r["agg"]["carryNotHoldN"] for r in distinct)
        v.info("carrying sniper/launcher but holding the pistol (samples)", {"pct": pct(cnh, csl), "n": csl})
        v.info("dry: all guns dry / active gun dry (% of landed samples)", {
            "allDry": pct(sum(r["agg"]["allDryN"] for r in distinct), sum(r["agg"]["landedN"] for r in distinct)),
            "activeDry": pct(sum(r["agg"]["activeDryN"] for r in distinct), sum(r["agg"]["landedN"] for r in distinct))})
        if far:
            # PLAN L5 gate (d: far bots keep blockedHoriz + supportAt): no bot that stood inside a wall while far (> 250 m from
            # the camera, the old terrain-only LOD) is still inside it once it comes near
            ftn = sum(r.get("farToNearInside", 0) for r in far)
            v.check("far-bot wall clipping: farToNearInside == 0 (probe_farwall, --farwall)", ftn == 0,
                    {"farToNearInside": ftn, "runs": [{k: r.get(k) for k in ("seed", "map", "simT", "farN", "farIn", "nearN", "nearIn", "farToNearInside", "ex")} for r in far]},
                    expect="0 (L5 d)")
        v.check("no page errors / window errors during the runs", not (d["pageErrors"] or d["windowErrors"]),
                {"pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3]})
    return C.run_gate("probe_match", body, args)


if __name__ == "__main__":
    sys.exit(main())
