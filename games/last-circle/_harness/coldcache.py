#!/usr/bin/env python
"""coldcache - does a player with a COLD or STALE browser cache get one consistent build?  (Wave-7 completion round, lane D5; promoted from the Wave-7 verify's coldcache2.py.)

    python _harness/coldcache.py --disk                    # the working copy served with a ?v= nobody has cached (1 Savanna match, ~1 min)
    python _harness/coldcache.py --disk --release          # + the cache-bump row counts (run it on the release candidate, before the deploy)
    python _harness/coldcache.py --live                    # the DEPLOYED build over the network (common.LIVE_BASE; read-only; the post-deploy check)
    python _harness/coldcache.py --rev dd414cb2            # a frozen commit
    python _harness/coldcache.py --disk --plant bare-import   # negative control: net.js imports maps.js without the query - MUST FAIL cold-versioned and cold-once

The game is plain ESM with no build step. index.html loads the boot module as `ffg_boot3d.js?v=<n>` and every runtime module is imported with the SAME query (the boot module hands its own
`import.meta.url` search down: net.js's dynamic maps.js import, towngen / citykit / navgrid, bots, loot ...). A browser that cached the OLD `maps.js` under the OLD query and is handed a new
index.html fetches everything new; a module imported WITHOUT the query is served from that browser's cache of the old build, and the page runs two builds at once (the Wave-7 verify found
this in review: a bare `import("./maps.js")` in net.js made a second, stale instance - squadguard_live --plant bare-import is its control). This gate loads the page with a `?v=` that nobody has
cached (index.html rewritten in flight), plays a standard Savanna match to the first frames, and reads every script request:

  cold-versioned     every game-runtime script (runtime/**, game_controls.js) carries `v=<the cold query>`; the vendored three (assets/vendor/) is a pinned, hashed-by-path library and is exempt, and
                     the files in UNVERSIONED_OK (shared files that never carried the query) are exempt and judged by the next row
  cold-unversioned   (--disk / --rev) each exempt file is byte-identical to the live build's (common.LIVE_REV): an exempt file that CHANGED would be served from the old cache to every returning
                     player while the rest of the page is new. In --live mode: information
  cold-once          no script path is requested more than once, under any query (a second request for the same module is a second instance)
  cold-built         the match built (map.genVersion equals the export, no fallback) and the page had 0 page errors and 0 failed requests
  live-rev           (--live only) the deployed index.html carries the same `?v=` values as `git show common.LIVE_REV:index.html`: common.LIVE_REV IS the build on the CDN. The first thing a post-deploy
                     check proves, because every baseline in this harness (perf_district, framecheck, genversion, simcost, this gate's cold-unversioned) reads that one constant.
                     `--expect-rev 60b854d0` (a build that is not live) must FAIL it
  cache-bump         index.html's `?v=` values differ from the live build's. INFORMATION unless --release: before the release commit the working copy carries the live ?v= on purpose
                     (bumped once, by the release, with the CHANGELOG); with --release a missing bump FAILS - a deploy without one is served from every returning player's cache

Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import collections
import os
import re
import subprocess
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

GATE = "coldcache"
COLD_V = "1799999999"
UNVERSIONED_OK = ("runtime/ffg_handles.js", "runtime/net/ffg_netplay.js", "runtime/net/ffg_rtc.js")      # never carried the query (shared pipeline files); judged byte-for-byte against live
VQ_RE = re.compile(r"\?v=\d+")


def git_text(rev, rel):
    p = subprocess.run(["git", "-C", C.REPO, "show", "%s:games/last-circle/%s" % (rev, rel)], capture_output=True)
    return p.stdout if p.returncode == 0 else None


def v_values(txt):
    return sorted(set(VQ_RE.findall(txt)))


def main_fn(v, args):
    live = bool(args.live)
    reqs = []
    info = {}
    with C.Session(args, name="coldcache") as s:
        gdir = args.base.rsplit("/", 1)[0] + "/"
        gpath = urllib.parse.urlparse(gdir).path
        # index.html with a ?v= nobody has cached: the working copy / frozen commit through the disk router, or the network response edited in flight
        def idx_pred(url):
            u = urllib.parse.urlparse(url)
            return u.netloc == urllib.parse.urlparse(args.base).netloc and (u.path.endswith("/index.html") or u.path == gpath)

        def idx_handler(route):
            if live:
                body = route.fetch().text()
            elif getattr(args, "rev", None):
                body = C.git_blobs(args.rev).read("index.html").decode("utf-8")
            else:
                body = open(os.path.join(C.ROOT, "index.html"), encoding="utf-8").read()
            info["indexV"] = v_values(body)
            route.fulfill(status=200, body=VQ_RE.sub("?v=" + COLD_V, body).encode("utf-8"), headers={"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"})
        s.context.route(idx_pred, idx_handler)
        if args.plant:
            if live or not s.disk:
                raise C.EnvFailure("--plant patches the served net.js: it needs --disk or --rev")
            nrel = "runtime/3d/royale/net.js"
            ntxt = (C.git_blobs(args.rev).read(nrel).decode("utf-8") if getattr(args, "rev", None) else open(os.path.join(C.ROOT, nrel.replace("/", os.sep)), encoding="utf-8").read())
            if 'import("./maps.js" + V)' not in ntxt:
                raise C.HarnessError("plant bare-import: net.js has no import(\"./maps.js\" + V) (the planted-fault anchor moved)")
            nbody = ntxt.replace('import("./maps.js" + V)', 'import("./maps.js")', 1).encode("utf-8")
            s.disk.overrides.append((lambda url: urllib.parse.urlparse(url).path.endswith("/" + nrel),
                                     lambda route: route.fulfill(status=200, body=nbody, headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})))
        s.page.on("request", lambda r: reqs.append(r.url))
        s.boot()
        s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
        s.start_match(mode="standard", seed=7, map_id=args.map)
        s.step_frames(120, 1 / 60, render=False)
        m = s.js("() => { const M = window.__LC__.W.map; return { id: M.id, gv: M.genVersion, fallback: M.fallback || null, colliders: M.colliders.length }; }")
        info["map"] = m
        info["pageErrors"] = [e[1][:200] for e in s.page_errors][:3]
        info["failed"] = list(s.failed)[:4]
    scripts = []
    for u in reqs:
        pu = urllib.parse.urlparse(u)
        if not re.search(r"\.m?js$", pu.path):
            continue
        if not pu.path.startswith(gpath):
            continue
        scripts.append((pu.path[len(gpath):], pu.query, u))
    cnt = collections.Counter(rel + "?" + q for rel, q, _ in scripts)
    v.data.update({"scripts": len(cnt), "indexV": info.get("indexV"), "map": info.get("map"), "live": live})
    if len(cnt) < 20:
        v.cnj("cold-versioned", "only %d scripts were requested (the page did not load the game): %s" % (len(cnt), sorted(cnt)[:6]))
        return
    gp = [(rel, q) for rel, q, _ in scripts if not rel.startswith("assets/vendor/") and rel not in UNVERSIONED_OK]
    bad = sorted({rel for rel, q in gp if "v=" + COLD_V not in q})
    v.check("cold-versioned", not bad, "%d game scripts requested with the cold ?v=%s%s" % (len({r for r, _ in gp}), COLD_V, ("; WITHOUT it: %s" % bad[:8]) if bad else ""), "every runtime script carries the boot's query")
    exempt = sorted({rel for rel, q, _ in scripts if rel in UNVERSIONED_OK})
    if live or getattr(args, "rev", None) == C.LIVE_REV:
        v.info("cold-unversioned", "exempt files requested without the query: %s (live mode: not compared)" % exempt)
    else:
        changed = []
        for rel in UNVERSIONED_OK:
            old = git_text(C.LIVE_REV, rel)
            p = os.path.join(C.ROOT, rel.replace("/", os.sep))
            cur = C.git_blobs(args.rev).read(rel) if getattr(args, "rev", None) else (open(p, "rb").read() if os.path.exists(p) else None)
            if old is None or cur is None:
                changed.append("%s (missing in %s)" % (rel, "live" if old is None else "this build"))
            elif old.replace(b"\r\n", b"\n") != cur.replace(b"\r\n", b"\n"):
                changed.append(rel)
        v.check("cold-unversioned", not changed, "%d files are requested without the query (%s); %s" % (len(exempt), ", ".join(exempt), ("CHANGED since the live build %s: %s" % (C.LIVE_REV, changed)) if changed else "all byte-identical to the live build's (no stale-cache risk)"),
                "an unversioned file must not change between builds")
    by_rel = collections.Counter(rel for rel, q, _ in scripts)
    dup = sorted(k for k, n in by_rel.items() if n > 1)
    v.check("cold-once", not dup, "%d distinct script paths, none requested twice%s" % (len(by_rel), ("; twice: %s" % dup[:6]) if dup else ""), "no second module instance")
    m = info.get("map") or {}
    exp = None
    mt = None
    try:
        if live:
            from urllib.request import Request, urlopen
            mt = urlopen(Request(gdir + "runtime/3d/royale/maps.js", headers={"User-Agent": "Mozilla/5.0 Chrome/130"}), timeout=60).read().decode("utf-8")
        elif getattr(args, "rev", None):
            mt = C.git_blobs(args.rev).read("runtime/3d/royale/maps.js").decode("utf-8")
        else:
            mt = open(os.path.join(C.ROOT, "runtime", "3d", "royale", "maps.js"), encoding="utf-8").read()
        mm = re.search(r"export const MAP_GEN_VERSION = (\d+);", mt)
        exp = int(mm.group(1)) if mm else None
    except Exception:
        pass
    ok = bool(m) and m.get("id") == args.map and not m.get("fallback") and (exp is None or m.get("gv") == exp) and not info["pageErrors"] and not info["failed"]
    v.check("cold-built", ok, "map %s genVersion %s (export %s), fallback %s, %s colliders; page errors %s, failed requests %s" % (m.get("id"), m.get("gv"), exp, m.get("fallback"), m.get("colliders"), info["pageErrors"], info["failed"]),
            "the match builds, no fallback, 0 errors")
    # the cache bump
    now = info.get("indexV") or []
    if live:
        # the post-deploy baseline pointer: common.LIVE_REV must be the commit that is on the CDN, or every perf / framecheck / genversion baseline compares with the wrong build
        erev = args.expect_rev or C.LIVE_REV
        old = git_text(erev, "index.html")
        oldv = v_values(old.decode("utf-8")) if old else []
        v.check("live-rev", bool(now) and bool(oldv) and now == oldv,
                "the live index.html carries %s; %s %s carries %s" % (now, "common.LIVE_REV" if not args.expect_rev else "--expect-rev", erev, oldv),
                "the commit in common.LIVE_REV is the build on the CDN (move it after every deploy: README 'Wave-7 completion round')")
    else:
        old = git_text(C.LIVE_REV, "index.html")
        oldv = v_values(old.decode("utf-8")) if old else []
        bumped = bool(now) and now != oldv
        detail = "index.html ?v= values %s; the live build %s carries %s: %s" % (now, C.LIVE_REV, oldv, "BUMPED" if bumped else "NOT bumped (the release commit does that, with the CHANGELOG entry)")
        if args.release:
            v.check("cache-bump", bumped, detail, "a different ?v= than the live build's")
        else:
            v.info("cache-bump", detail + " [information; --release makes it count]")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--release", action="store_true", help="the cache-bump row counts (run on the release candidate)")
    ap.add_argument("--plant", default=None, choices=["bare-import"], help="negative control: net.js served with a bare maps.js import (must FAIL)")
    ap.add_argument("--live", action="store_true", help="shortcut for --base %s : judge the DEPLOYED build (read-only)" % C.LIVE_BASE)
    ap.add_argument("--expect-rev", default=None, help="--live: the commit whose index.html ?v= the deployed page must carry (default common.LIVE_REV; a wrong one is the negative control of the live-rev row)")
    args = ap.parse_args()
    if args.live:
        args.base = C.LIVE_BASE
        args.disk, args.rev = False, None
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
