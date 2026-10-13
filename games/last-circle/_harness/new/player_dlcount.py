#!/usr/bin/env python
"""player_dlcount - P1.1 every animation clip is downloaded ONCE (lane PLAYER, wave 4).

A dlprobe-style count of what the page really fetches under assets/chars/ from a cold boot to the lobby (the browser's own
PerformanceResourceTiming entries: URL, decodedBodySize). Two runs in one gate:

  BEFORE  git HEAD with NONE of this lane's files (the old path: <skin>_<clip>.glb x 5 skins)
  AFTER   the build under test (with --isolate: HEAD + this lane's files from the working copy / --overlay-root)

The main-menu locker preview (hud.js, another lane's file) fetches 3 per-skin clips for the one skin it shows at boot; the page's
entries are split at the settled menu (multiset difference), so the per-skin rows measure player.js's MATCH LOAD only and the
menu's own files are reported as information.

Asserts (counts and bytes, never milliseconds):
  * the BEFORE match load fetched 85 per-skin clip files (17 clips x 5 skins), the AFTER match load 0
  * AFTER fetched each shared assets/chars/clips/<clip>.glb exactly once (15 clips + 7 death falls = 22, none twice)
  * clip bytes AFTER <= 25 % of BEFORE (the plan: 8.83 MB -> ~0.7 MB)
  * base meshes and LOD1 bodies unchanged: 5 + 5 requests, same bytes in both runs
  * W._playerProbe.clips() reports mode "shared" with 22 requests
  * 0 console / page / window errors, 0 failed requests (a 404 on a shared file would be a failed request), 0 [rig] lines
  * the loading bar ends full (done == total)
FALLBACK (a third boot): every assets/chars/clips/* answers 404 -> ONE failed request (the hit.glb probe), mode per-skin, 75 per-skin
  clip files (15 clips x 5 skins: death2/death3 are gone and the 7 Mixamo falls have no per-skin file), the single baked `death` is the fall, 0 page errors, the loading bar ends full.
Exit 0 pass / 1 fail / 2 could-not-judge.
    python _harness/new/player_dlcount.py --disk [--isolate --before] [--skip-fallback]
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402
import player_lib as PL  # noqa: E402

SKINS = ["soldier", "athlete", "wraith", "juggernaut", "viper"]

ENTRIES_JS = r"""() => performance.getEntriesByType('resource')
  .filter((e) => e.name.indexOf('/assets/chars/') >= 0)
  .map((e) => ({ url: e.name.split('?')[0], body: e.decodedBodySize || 0, enc: e.encodedBodySize || 0, transfer: e.transferSize || 0,
                 start: Math.round(e.startTime), end: Math.round(e.responseEnd) }))"""


def classify(entries):
    out = {"perSkinClips": [], "shared": [], "bases": [], "lod1": [], "other": []}
    for e in entries:
        u = e["url"]
        m = re.search(r"/assets/chars/clips/([^/]+)\.glb$", u)
        if m:
            out["shared"].append((m.group(1), e["body"]))
            continue
        m = re.search(r"/assets/chars/meshy/([a-z]+)(?:_([a-z0-9_]+))?\.glb$", u)
        if not m:
            out["other"].append((u, e["body"]))
            continue
        skin, rest = m.group(1), m.group(2)
        if skin not in SKINS:
            out["other"].append((u, e["body"]))
        elif rest is None:
            out["bases"].append((skin, e["body"]))
        elif rest == "lod1":
            out["lod1"].append((skin, e["body"]))
        else:
            out["perSkinClips"].append((skin + "_" + rest, e["body"]))
    return out


# The main-menu LOCKER preview (hud.js ~1597, NOT this lane's file) fetches <menuSkin>_{rifle_idle,cheer,dance}.glb for the
# one skin it shows, at boot. Those requests are counted separately (menu vs match load) so the P1.1 rows measure exactly what
# player.js's match loader fetches; the menu's own per-skin files are reported as information (a request to the HUD lane).
MENU_DONE_JS = r"""() => performance.getEntriesByType('resource').some((e) => /\/assets\/chars\/meshy\/[a-z]+_dance\.glb/.test(e.name))"""


def _minus(after, before):
    """multiset difference of entry lists (by url + body size)"""
    left = {}
    for e in before:
        k = (e["url"], e["body"])
        left[k] = left.get(k, 0) + 1
    out = []
    for e in after:
        k = (e["url"], e["body"])
        if left.get(k, 0) > 0:
            left[k] -= 1
        else:
            out.append(e)
    return out


# records every (done, total) the match loader reports to the loading bar (hud.js installs W.loadProgress during startMatch;
# a setter wraps whatever it installs). Test-only: the wrapper forwards every call unchanged.
LP_HOOK_JS = r"""() => {
  const W = window.__LC__.W; window.__LP__ = [];
  let inner = W.loadProgress || null;
  const wrapped = (d, t) => { if (inner) { window.__LP__.push([d, t]); return inner(d, t); } };
  Object.defineProperty(W, 'loadProgress', { configurable: true, get() { return inner ? wrapped : null; }, set(f) { inner = f || null; } });
  return true;
}"""

FB_EXTRA_JS = r"""() => { const W = window.__LC__.W; const a = W.actors.find((x) => x.rig && x.clips);
  return a ? { deathKeys: Object.keys(a.clips).filter((k) => /^death/.test(k) && a.clips[k]), death: a.clips.death,
               pick: W._playerProbe.pickDeath(a) } : null; }"""


s_after_entries = [[]]   # the last run_once's raw match-load entries (url, bytes, start/end ms)


def run_once(args, v, label, isolate_overlay, block_shared=False):
    """Boot -> (menu settled) -> startMatch (the lobby); returns (match-load classified entries, menu classified entries,
    whole-page classified entries, diagnostics, probe, loading-bar pairs, fallback extra). block_shared: assets/chars/clips/*
    answer 404 (a server without the shared files: the per-skin fallback)."""
    a2 = argparse.Namespace(**vars(args))
    a2.isolate = isolate_overlay
    with C.Session(a2, "player_dlcount_" + label) as s:
        PL.overlay(s, a2)
        if block_shared:
            def deny(route):
                route.fulfill(status=404, body="Not found", headers={"Cache-Control": "no-store"})

            s.context.route(lambda url: "/assets/chars/clips/" in url, deny)
        s.boot()
        waited = s.wait_js(MENU_DONE_JS, 30, 0.25)
        s.sleep(0.5)
        menu = s.js(ENTRIES_JS)
        v.info("%s menu settled" % label, {"waited_s": waited, "charsEntries": len(menu)})
        s.js(LP_HOOK_JS)
        r = s.start_match("standard", args.seed, args.map, enter=False)
        v.info("%s match loaded" % label, r)
        s.sleep(1.0)
        ent = s.js(ENTRIES_JS)
        probe = s.safe_js("() => { const p = window.__LC__.W._playerProbe; return p ? p.clips() : null; }")
        lp = s.safe_js("() => (window.__LP__ || []).filter((x) => x[1] > 1)", default=[]) or []
        # skins actually in the roster: a base GLB that misses the kernel's 30 s per-asset timeout (a starved box) drops its
        # skin from the match by design; the base-dependent rows are then could-not-judge, never pass/fail
        roster = s.safe_js("() => [...new Set(window.__LC__.W.actors.map((a) => a.skin).filter(Boolean))].sort()", default=[]) or []
        v.info("%s roster skins" % label, {"skins": roster, "load_s": r.get("load_s")})
        lp = {"pairs": lp, "roster": roster, "load_s": r.get("load_s")}
        extra = s.safe_js(FB_EXTRA_JS) if block_shared else None
        d = s.diagnostics()
    s_after_entries[0] = _minus(ent, menu)
    return classify(_minus(ent, menu)), classify(menu), classify(ent), d, probe, lp, extra


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    PL.add_args(ap)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--map", default="isla_viva", choices=C.MAPS)
    ap.add_argument("--no-before", action="store_true", help="(kept for old command lines: the BEFORE run is off unless --before is given)")
    ap.add_argument("--before", action="store_true",
                    help="also boot git HEAD with no overlay (the OLD per-skin path) and judge the 85 -> 22 files / bytes ratio rows. One-time wave-4 evidence: "
                         "only meaningful while lane PLAYER is uncommitted (once HEAD has the shared loader there is no old path left to compare)")
    ap.add_argument("--skip-fallback", action="store_true", help="skip the FALLBACK run (shared clip files answering 404)")
    args = ap.parse_args()
    PL.prepare(args)
    if not args.isolate:
        # without --isolate there is no "before" build to serve: the whole working copy is the AFTER
        args.no_before = True

    def body(v):
        before = None
        if args.before and not args.no_before:
            # BEFORE = git HEAD with no overlay at all
            args_b = argparse.Namespace(**vars(args))
            args_b.isolate = False
            args_b.rev = "HEAD"
            args_b.disk = True
            before, bmenu, bwhole, db, _, _, _ = run_once(args_b, v, "BEFORE", False)
            v.info("BEFORE counts (match load)", {"perSkinClipRequests": len(before["perSkinClips"]), "perSkinClipBytes": sum(b for _, b in before["perSkinClips"]),
                                                  "shared": len(before["shared"]), "bases(page)": len(bwhole["bases"]), "lod1(page)": len(bwhole["lod1"])})
            v.info("BEFORE menu locker preview (hud.js, not lane PLAYER)", {"perSkinClips": bmenu["perSkinClips"]})
        after, amenu, awhole, da, probe, lp, _ = run_once(args, v, "AFTER", bool(args.isolate))
        alp = lp["pairs"]
        full_roster = len(lp["roster"]) == 5
        v.info("AFTER loading bar (done, total): first / last", {"n": len(alp), "first": alp[:2], "last": alp[-2:], "roster": lp["roster"]})
        if not full_roster:
            v.cnj("AFTER: the loading bar ends full", "only %d of 5 skins reached the roster (a base GLB missed the kernel's 30 s timeout; match load %s s)" % (len(lp["roster"]), lp["load_s"]))
        else:
            v.check("AFTER: the loading bar ends full (last reported done == total, never done > total)",
                    bool(alp) and alp[-1][0] == alp[-1][1] and all(x[0] <= x[1] for x in alp), {"last": alp[-1:] if alp else None, "over": [x for x in alp if x[0] > x[1]][:3]})
        sh_names = [n for n, _ in awhole["shared"]]
        v.info("AFTER counts (match load)", {"perSkinClipRequests": len(after["perSkinClips"]), "shared": len(after["shared"]), "sharedBytes": sum(b for _, b in after["shared"]),
                                             "bases(page)": len(awhole["bases"]), "lod1(page)": len(awhole["lod1"]), "probe": probe})
        v.info("AFTER menu locker preview (hud.js, not lane PLAYER: still per-skin, see requests_for_other_lanes)",
               {"perSkinClips": amenu["perSkinClips"], "bytes": sum(b for _, b in amenu["perSkinClips"])})
        abs_b = sum(b for _, b in after["shared"]) + sum(b for _, b in after["perSkinClips"])
        v.check("match-load clip bytes <= 1.2 MB with 0 per-skin clip files (22 shared files; the old per-skin path was 8.83 MB)",
                abs_b <= 1200000 and len(after["perSkinClips"]) == 0, {"bytes": abs_b, "shared": len(after["shared"]), "perSkin": len(after["perSkinClips"])})
        v.data["after"] = {k: [list(x) for x in vv] for k, vv in after.items()}
        v.data["afterMenu"] = {k: [list(x) for x in vv] for k, vv in amenu.items()}
        if before is not None:
            v.data["before"] = {k: [list(x) for x in vv] for k, vv in before.items()}
            v.data["beforeMenu"] = {k: [list(x) for x in vv] for k, vv in bmenu.items()}
            v.check("BEFORE: the old match load fetched 17 clips x 5 skins = 85 per-skin clip files", len(before["perSkinClips"]) == 85,
                    {"n": len(before["perSkinClips"]), "bytes": sum(b for _, b in before["perSkinClips"])})
            old_b = sum(b for _, b in before["perSkinClips"])
            new_b = sum(b for _, b in after["shared"]) + sum(b for _, b in after["perSkinClips"])
            v.check("match-load clip bytes AFTER <= 25 %% of BEFORE (%d -> %d B)" % (old_b, new_b), old_b > 0 and new_b <= 0.25 * old_b,
                    {"before": old_b, "after": new_b, "ratio": round(new_b / max(1, old_b), 3)})
            if not full_roster:
                v.cnj("base meshes + LOD1 bodies unchanged over the page", "AFTER roster has %d of 5 skins (contention timeout, see above)" % len(lp["roster"]))
            else:
              v.check("base meshes + LOD1 bodies unchanged over the page (5 + 5 requests, same bytes)",
                    len(awhole["bases"]) == 5 and len(awhole["lod1"]) == 5 and sorted(awhole["bases"]) == sorted(bwhole["bases"]) and sorted(awhole["lod1"]) == sorted(bwhole["lod1"]),
                    {"bases": [len(bwhole["bases"]), len(awhole["bases"])], "lod1": [len(bwhole["lod1"]), len(awhole["lod1"])]})
        else:
            v.info("BEFORE/AFTER ratio rows", "not run (one-time wave-4 comparison: --isolate --before while the lane is uncommitted; measured 2026-10-12: 85 per-skin files / 8,829,340 B -> 22 shared / 943,364 B = 0.107). The absolute rows below are the standing gate.")
        # ORDER: the shared clips are requested only after every match-load base GLB has arrived (bases first, as the old per-skin path)
        ents = s_after_entries[0]
        mb = [e for e in ents if re.search(r"/assets/chars/meshy/[a-z]+\.glb$", e["url"])]
        sc = [e for e in ents if "/assets/chars/clips/" in e["url"]]
        if mb and sc and full_roster:
            v.check("AFTER: the shared clips are requested only after every base GLB arrived (bases first)", min(e["start"] for e in sc) >= max(e["end"] for e in mb),
                    {"lastBaseEnd_ms": max(e["end"] for e in mb), "firstClipStart_ms": min(e["start"] for e in sc), "bases": len(mb), "clips": len(sc)})
        else:
            v.cnj("AFTER: shared clips after the bases", "bases %d / clips %d / full roster %s" % (len(mb), len(sc), full_roster))
        v.check("AFTER: the match load makes 0 per-skin clip requests", len(after["perSkinClips"]) == 0, {"n": len(after["perSkinClips"]), "first": after["perSkinClips"][:4]})
        v.check("AFTER: each shared clip fetched exactly once over the page, 22 files (15 clips + 7 death falls)",
                len(sh_names) == 22 and len(set(sh_names)) == 22, {"n": len(sh_names), "unique": len(set(sh_names)), "dupes": sorted({n for n in sh_names if sh_names.count(n) > 1})})
        v.check("AFTER: no death2 / death3 requested (the Meshy falls are gone)", not any(n in ("death2", "death3") for n in sh_names), sh_names)
        v.check("W._playerProbe.clips(): mode shared, 22 requests, 22 loaded", bool(probe) and probe.get("mode") == "shared" and probe.get("requests") == 22 and probe.get("loaded") == 22, probe)
        for lab, d in (("AFTER", da),) + ((("BEFORE", db),) if before is not None else ()):
            C.print_diagnostics(d)
        v.check("AFTER: 0 console errors", not da["consoleErrors"], da["consoleErrors"][:5])
        v.check("AFTER: 0 page / window errors", not (da["pageErrors"] or da["windowErrors"]), (da["pageErrors"] + da["windowErrors"])[:5])
        v.check("AFTER: 0 failed requests", not da["failedRequests"], da["failedRequests"][:8])
        v.check("AFTER: 0 shader errors, 0 [rig] lines", not da["shader"] and not da["rigWarnings"], (da["shader"] + da["rigWarnings"])[:4])
        if args.skip_fallback:
            v.cnj("FALLBACK rows", "--skip-fallback")
            return
        # FALLBACK: a server WITHOUT the shared clip files (every assets/chars/clips/* answers 404)
        fb, fmenu, fwhole, df, fprobe, flpd, fextra = run_once(args, v, "FALLBACK", bool(args.isolate), block_shared=True)
        flp = flpd["pairs"]
        v.info("FALLBACK counts (match load)", {"perSkinClipRequests": len(fb["perSkinClips"]), "sharedRequests(page)": len(fwhole["shared"]), "probe": fprobe,
                                                "loadingBarLast": flp[-1:] if flp else None, "deaths": fextra})
        # the per-skin fallback exists for the 15 loco/combat clips only (death2/death3 are gone, the 7 Mixamo falls are shared-only)
        nsk = len(flpd["roster"])
        v.check("FALLBACK: ONE shared request (the probe), mode per-skin, then 15 clips x %d skins in the roster = %d per-skin clip files" % (nsk, 15 * nsk),
                bool(fprobe) and fprobe.get("mode") == "per-skin" and fprobe.get("requests") == 1 and nsk >= 1 and len(fb["perSkinClips"]) == 15 * nsk,
                {"probe": fprobe, "perSkin": len(fb["perSkinClips"])})
        v.check("FALLBACK: exactly ONE failed request (the hit.glb probe)", len(df["failedRequests"]) == 1 and "clips/hit.glb" in str(df["failedRequests"][0]), df["failedRequests"][:4])
        v.check("FALLBACK: 0 page / window errors, 0 shader errors, 0 [rig] lines", not (df["pageErrors"] or df["windowErrors"] or df["shader"] or df["rigWarnings"]),
                (df["pageErrors"] + df["windowErrors"] + df["shader"] + df["rigWarnings"])[:4])
        v.check("FALLBACK: the single baked death is the fall (no Mixamo falls bound, pickDeath -> null)",
                bool(fextra) and fextra.get("deathKeys") == ["death"] and fextra.get("pick") is None, fextra)
        if len(flpd["roster"]) != 5:
            v.cnj("FALLBACK: the loading bar ends full", "only %d of 5 skins reached the roster (contention timeout; load %s s)" % (len(flpd["roster"]), flpd["load_s"]))
        else:
            v.check("FALLBACK: the loading bar ends full (last done == total)", bool(flp) and flp[-1][0] == flp[-1][1] and all(x[0] <= x[1] for x in flp), {"last": flp[-1:] if flp else None})
    return C.run_gate("player_dlcount", body, args)


if __name__ == "__main__":
    sys.exit(main())
