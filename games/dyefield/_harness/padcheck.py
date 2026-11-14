#!/usr/bin/env python
"""DYEFIELD FFA drop-in MARKER check (CONTRACT_FFA_SPAWNS S5; was lane PADS' drop-pad check) — FFA has no permanent pads
any more: a transient marker plays at the spawn site of every drop. Do the markers sit ON the ground, and do they go away?

    python _harness/padcheck.py --headless                          # all 3 maps, report padcheck.json
    python _harness/padcheck.py --headless --map cinder --tag before # one map, report padcheck_before.json
    python _harness/padcheck.py --headless --base http://localhost:5212/

Flow per map (pier18 · lockwell · cinder):
  1. load /?mode=ffa&map=<id>&dev=1&seed=<--seed> (a deep link: the FFA match loads behind the CLICK TO PLAY card; the
     markers of every spawn site are built in startSession, before phase 'ready'); wait for phase 'ready';
  2. __DF__.markers(N, 'all') (testsurface.ts): per spawn site of the pool (MatchWorld.spawnSites, maps.json ffaSites) the
     RENDERED marker top (a downward ray onto the marker mesh itself — every site's disc exists, only the shown ones draw)
     vs the ground (a downward ray onto the visible map meshes, the markers excluded, first face with normal y >= 0.7) at N
     points inside 0.95 R → maxHoverCm / maxSinkCm, the ground's fitted slope, the draw objects and the build time;
     asserts: matchMode 'ffa', one site per pool entry (>= 16), ONE marker draw object, >= 64 measured samples on every
     site with no ray miss, max hover <= 3 cm and max sink <= 1 cm on EVERY site, build time <= --max-build-ms;
  3. the match start: the 8 runners' start markers are shown (the match-start 'spawn' events) and held while the card /
     the countdown is up — 8 shown, 8 distinct sites, the draw visible;
  4. play (__DF__.start(): no pointer lock needed) → live → the start markers fade: within --life-s + --grace-s of the live
     start none of them is left and no marker is ever older than --life-s (NONE PERSIST);
  5. a respawn: the human is washed (__DF__.damage, dev — setup only) → on its respawn a marker shows at its NEW site (a
     site other than the one it held) in its crew, the draw visible; that marker is measured while visible (hover <= 3 cm,
     sink <= 1 cm) and is gone --life-s + --grace-s later (bots may drop in meanwhile: only the human's marker is judged,
     and no marker may be older than --life-s);
  6. cinder (or --shots-map): close screenshots of the markers on the two steepest sites (by the read-back's slope): the
     marker is shown through the dev handle (drops.show + an update past its intro), a custom camera (a clone of the game
     camera) looks at it from its downhill side and from across the slope, the sim + the visual clock frozen
     (__DF__.freeze), the runners hidden for the one frame → _shots/padcheck_<tag>_<map>_site<i>_<view>.png.
Zero console errors, page / window errors, shader / GL errors and failed requests over the whole run, else FAIL.
Wall-clock waits: the markers age with the render clock (dt capped at 0.25 s a frame), so on a loaded box a wait may run
long — every wait is generous and polls; a timing FAIL is re-judged by a rerun before it is called a defect.
Exit codes: 0 PASS · 1 FAIL · 2 the page never got far enough to judge.
"""
import argparse
import base64
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, HarnessError, Session, add_common_args, build_url, diag_problems,  # noqa: E402
                    preflight_chromes, print_diagnostics, save_report)

MAPS = ("pier18", "lockwell", "cinder")

# the close-up: show the marker at site i (crew 1 amber, past its intro), freeze, a camera clone at `dist` m from the site
# centre, `elev` degrees above the ground, looking at a point `aimUp` m above the centre; view 'downhill' stands on the
# downhill side looking uphill, 'across' looks along the contour
SHOT_JS = r"""
async ([i, view, o]) => {
  const D = window.__DF__;
  const dev = D && D.dev;
  if (!dev) throw new Error('__DF__.dev unavailable (load with ?dev=1)');
  const p = dev.parts, drops = p.drops;
  if (!drops) throw new Error('no drop-in markers in this session');
  const site = drops.sites[i];
  if (!site) throw new Error('no spawn site ' + i);
  drops.show(i, 1);
  drops.update(0.5, true);
  D.freeze(true);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const canvas = dev.renderer.domElement;
  const cam = dev.camera.clone();
  cam.fov = o.fov;
  cam.aspect = canvas.width / Math.max(1, canvas.height);
  cam.near = 0.05;
  cam.updateProjectionMatrix();
  let dx = o.downhill[0], dz = o.downhill[1];
  if (Math.hypot(dx, dz) < 1e-3) { dx = Math.sin(site.yaw || 0); dz = Math.cos(site.yaw || 0); }
  if (view === 'across') { const t = dx; dx = -dz; dz = t; }
  const e = o.elev * Math.PI / 180;
  const gy = o.groundY;
  cam.position.set(site.x + dx * o.dist * Math.cos(e), gy + o.dist * Math.sin(e), site.z + dz * o.dist * Math.cos(e));
  cam.up.set(0, 1, 0);
  cam.lookAt(site.x, gy + o.aimUp, site.z);
  cam.updateMatrixWorld();
  const V = dev.camera.position.constructor;
  p.sky.update(0, cam, new V(site.x, gy, site.z));
  try { p.water.update(dev.game.time, cam); } catch (_) {}
  const shown = p.players.root.visible;
  p.players.root.visible = false;
  let url = null;
  try {
    dev.renderer.render(dev.scene, cam);
    url = canvas.toDataURL('image/png');
  } finally {
    p.players.root.visible = shown;
    D.freeze(false);
  }
  return { url, cam: [cam.position.x, cam.position.y, cam.position.z], buffer: [canvas.width, canvas.height] };
}
"""

MARKERS_JS = "([n, which]) => window.__DF__.markers(n, which)"
HUMAN_JS = ("() => { const m = window.__DF__.match(); const r = m && m.runners && m.runners[0];"
            " return r ? { alive: r.alive, team: r.team, spawnSite: r.spawnSite, phase: m.phase } : null; }")


def r1(v):
    return None if v is None else round(float(v), 1)


def judge_sites(rb, args, what, fails, min_sites=1):
    """hover / sink / samples per measured site; returns (worst hover, worst sink)"""
    pads = rb.get("pads") or []
    if len(pads) < min_sites:
        fails.append("%s: %d site(s) measured (want >= %d)" % (what, len(pads), min_sites))
    worst_h = worst_s = 0.0
    for pd in pads:
        h, s = pd.get("maxHoverCm"), pd.get("maxSinkCm")
        bad = []
        if (pd.get("samples") or 0) < 64:
            bad.append("only %s samples measured" % pd.get("samples"))
        if pd.get("topMiss") or pd.get("groundMiss"):
            bad.append("ray misses top %s / ground %s" % (pd.get("topMiss"), pd.get("groundMiss")))
        if h is None or h > args.max_hover_cm:
            bad.append("hover %s cm > %.1f" % (h, args.max_hover_cm))
        if s is None or s > args.max_sink_cm:
            bad.append("sink %s cm > %.1f" % (s, args.max_sink_cm))
        worst_h = max(worst_h, h or 0.0)
        worst_s = max(worst_s, s or 0.0)
        print("   %4s %4s %-10s %7.2f %7.2f  %5.1f°  %8s %8s %8s  %7s  %s/%s%s" % (
            pd.get("i"), pd.get("crew"), pd.get("mark") or "-", pd.get("x"), pd.get("z"), pd.get("slopeDeg") or 0.0,
            h, s, pd.get("meanCm"), pd.get("samples"), pd.get("topMiss"), pd.get("groundMiss"),
            ("   <-- " + "; ".join(bad)) if bad else ""))
        for b in bad:
            fails.append("%s: site %s: %s" % (what, pd.get("i"), b))
    return worst_h, worst_s


def poll(sess, fn, timeout_s, period=0.1):
    """poll fn() until it returns a truthy value (returned) or timeout (the last value)"""
    end = time.time() + timeout_s
    v = None
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(period)
    return v


def check_map(sess, args, mid, report, problems):
    url = build_url(args.base, map=mid, mode="ffa", dev=1, seed=args.seed)
    row = {"map": mid, "url": url}
    report["maps"][mid] = row
    c0 = len(sess.console)
    p0 = len(sess.page_errors)
    t0 = time.time()
    try:
        sess.goto(url)
    except Exception as e:
        problems.append("%s: navigation failed: %s" % (mid, str(e).splitlines()[0]))
        return False
    if not sess.wait_df(args.wait):
        problems.append("%s: window.__DF__ never appeared within %.0f s" % (mid, args.wait))
        return False
    ok, ph = sess.wait_phase("ready", args.wait)
    row["tReadyS"] = round(time.time() - t0, 1)
    if not ok:
        st = sess.state() or {}
        problems.append("%s: never reached 'ready' (phase %r after %.0f s)%s" % (
            mid, ph, args.wait, (": " + str(st.get("error"))[:800]) if st.get("error") else ""))
        return False
    fails = []
    # ── 2. every site's marker conforms
    try:
        rb = sess.js(MARKERS_JS, [args.samples, "all"])
    except Exception as e:
        problems.append("%s: __DF__.markers() failed: %s" % (mid, str(e).splitlines()[0][:300]))
        return False
    if not isinstance(rb, dict):
        problems.append("%s: __DF__.markers() returned %r" % (mid, rb))
        return False
    row["readback"] = rb
    if rb.get("matchMode") != "ffa":
        fails.append("matchMode %r (want 'ffa')" % rb.get("matchMode"))
    if rb.get("error"):
        fails.append("read-back error: %s" % rb.get("error"))
    pads = rb.get("pads") or []
    sites = rb.get("sites") or 0
    if sites < 16 or rb.get("count") != sites or len(pads) != sites:
        fails.append("sites: pool %r, specs %r, measured %d (want one per pool site, >= 16)" % (sites, rb.get("count"), len(pads)))
    if rb.get("drawObjects") != 1:
        fails.append("marker draw objects %r (want ONE draw for every site)" % rb.get("drawObjects"))
    bms = rb.get("buildMs")
    if not isinstance(bms, (int, float)):
        fails.append("addDropMarkers build time not reported (root.userData.buildMs)")
    elif bms > args.max_build_ms:
        fails.append("addDropMarkers took %.1f ms (> %.0f ms)" % (bms, args.max_build_ms))
    print("\n[%s] ready in %.1f s · %d sites · draw objects %s · %s vertices · build %s ms (gather %s) · read-back %s ms"
          " (%s samples/site) · floor tris per site %s · plane-clamped vertices %s" % (
              mid, row["tReadyS"], len(pads), rb.get("drawObjects"), rb.get("vertices"), r1(bms), rb.get("gather"),
              rb.get("ms"), rb.get("samplesPerPad"), rb.get("floorTris"), rb.get("clampedVertices")))
    print("   site crew mark        x       z     slope   hover cm  sink cm  mean cm  samples miss(top/gnd)")
    worst_h, worst_s = judge_sites(rb, args, "all sites", fails, min_sites=16)
    row["maxHoverCm"] = worst_h
    row["maxSinkCm"] = worst_s
    # ── 3. the match start: 8 start markers held behind the card / through the countdown
    act0 = poll(sess, lambda: (sess.safe_js("() => window.__DF__.markers(16, 'active')") or {}).get("active"), 5.0) or []
    vis0 = (sess.safe_js("() => window.__DF__.markers(16, 'active')") or {}).get("visible")
    row["startMarkers"] = act0
    if len(act0) != 8 or len({a.get("site") for a in act0}) != 8 or not vis0:
        fails.append("match start: %d start markers shown on %d distinct sites, draw visible %s (want 8 / 8 / true)" % (
            len(act0), len({a.get("site") for a in act0}), vis0))
    print("   match start: %d markers shown (sites %s), draw visible %s" % (len(act0), sorted(a.get("site") for a in act0), vis0))
    # ── 4. play → live → the start markers fade; none persist
    sess.df("start")
    ok, _ = sess.wait_phase("play", 6.0)
    if not ok:
        fails.append("could not enter play (__DF__.start)")
    live = poll(sess, lambda: (sess.safe_js(HUMAN_JS) or {}).get("phase") == "live", 20.0)
    if not live:
        fails.append("the match never went live")
    t_live = time.time()
    start_sites = {a.get("site") for a in act0}
    max_age = 0.0

    def start_left():
        nonlocal max_age
        a = (sess.safe_js("() => window.__DF__.markers(16, 'active')") or {}).get("active") or []
        for m in a:
            max_age = max(max_age, m.get("age") or 0.0)
        # a start marker is gone when its site no longer shows the SAME crew (a bot may drop in on a start site later)
        crew_at = {m.get("site"): m.get("crew") for m in a}
        left = [s for s in start_sites if s in crew_at and crew_at[s] == next((x.get("crew") for x in act0 if x.get("site") == s), None)]
        return left
    gone = poll(sess, lambda: not start_left(), args.life_s + args.grace_s)
    t_gone = time.time() - t_live
    row["startFade"] = {"goneAfterLiveS": round(t_gone, 2), "maxAge": max_age}
    if not gone:
        fails.append("start markers still shown %.1f s after the live start: sites %s" % (t_gone, start_left()))
    if max_age > args.life_s + 1e-6:
        fails.append("a marker was %.2f s old (> life %.2f s): it persisted" % (max_age, args.life_s))
    print("   live: start markers gone %.1f s after the live start (max age seen %.2f s)" % (t_gone, max_age))
    # ── 5. a respawn at a new site shows the human's marker; it conforms; it goes away
    h0 = sess.safe_js(HUMAN_JS) or {}
    site_before = h0.get("spawnSite")
    sess.df("damage", 0, 1000)
    dead = poll(sess, lambda: (sess.safe_js(HUMAN_JS) or {}).get("alive") is False, 3.0)
    back = poll(sess, lambda: (sess.safe_js(HUMAN_JS) or {}).get("alive") is True, 10.0) if dead else False
    h1 = sess.safe_js(HUMAN_JS) or {}
    site_after = h1.get("spawnSite")
    if not dead or not back:
        fails.append("the human's dev wash + respawn did not happen (washed %s, back %s)" % (dead, back))
    rb2 = sess.js(MARKERS_JS, [args.samples, "active"]) or {}
    mine = [m for m in (rb2.get("active") or []) if m.get("site") == site_after and m.get("crew") == h1.get("team")]
    row["respawn"] = {"siteBefore": site_before, "siteAfter": site_after, "marker": mine, "visible": rb2.get("visible")}
    if site_after is None or site_after == site_before:
        fails.append("respawn: site %r → %r (want a new site)" % (site_before, site_after))
    if not mine or not rb2.get("visible"):
        fails.append("respawn: no marker of the human's crew at its new site %r (shown %s, draw visible %s)" % (
            site_after, [(m.get("site"), m.get("crew")) for m in rb2.get("active") or []], rb2.get("visible")))
    print("   respawn: site %s → %s · the human's marker %s · shown now %s" % (
        site_before, site_after, mine[:1], [(m.get("site"), m.get("crew"), m.get("age")) for m in rb2.get("active") or []]))
    print("   site crew mark        x       z     slope   hover cm  sink cm  mean cm  samples miss(top/gnd)   (shown markers)")
    judge_sites(rb2, args, "shown marker", fails, min_sites=1)
    t_r = time.time()

    def mine_left():
        nonlocal max_age
        a = (sess.safe_js("() => window.__DF__.markers(16, 'active')") or {}).get("active") or []
        for m in a:
            max_age = max(max_age, m.get("age") or 0.0)
        return [m for m in a if m.get("site") == site_after and m.get("crew") == h1.get("team")]
    gone2 = poll(sess, lambda: not mine_left(), args.life_s + args.grace_s)
    row["respawnFade"] = {"goneAfterS": round(time.time() - t_r, 2), "maxAge": max_age}
    if not gone2:
        fails.append("respawn: the human's marker still shown %.1f s later" % (time.time() - t_r))
    if max_age > args.life_s + 1e-6:
        fails.append("a marker was %.2f s old (> life %.2f s): it persisted" % (max_age, args.life_s))
    print("   respawn marker gone %.1f s later (max age seen %.2f s)" % (time.time() - t_r, max_age))
    # ── 6. shots on the steepest sites
    if mid == args.shots_map and pads:
        steep = sorted(pads, key=lambda q: -(q.get("slopeDeg") or 0.0))[:2]
        row["shots"] = []
        for pd in steep:
            for view in ("downhill", "across"):
                opts = {"fov": 50.0, "dist": args.shot_dist, "elev": args.shot_elev, "aimUp": 0.05,
                        "downhill": pd.get("downhill") or [0, 0],
                        "groundY": pd.get("groundY") if isinstance(pd.get("groundY"), (int, float)) else pd.get("y")}
                path = os.path.join(args.out_dir, "padcheck_%s_%s_site%d_%s.png" % (args.tag or "run", mid, pd.get("i"), view))
                try:
                    res = sess.js(SHOT_JS, [pd.get("i"), view, opts])
                    data = res["url"].split(",", 1)[1]
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    with open(path, "wb") as f:
                        f.write(base64.b64decode(data))
                    row["shots"].append({"site": pd.get("i"), "view": view, "slopeDeg": pd.get("slopeDeg"),
                                         "path": path, "cam": res.get("cam"), "buffer": res.get("buffer")})
                    print("   shot: site %d (%.1f°) %s → %s" % (pd.get("i"), pd.get("slopeDeg") or 0.0, view, path))
                except Exception as e:
                    fails.append("screenshot site %s %s failed: %s" % (pd.get("i"), view, str(e).splitlines()[0][:200]))
    # this map's diagnostics
    cerr = [t for (k, t) in sess.console[c0:] if k == "error"]
    row["consoleErrors"] = cerr
    row["pageErrors"] = list(sess.page_errors[p0:])
    row["fails"] = fails
    print("   max hover %.1f cm · max sink %.1f cm → %s" % (worst_h, worst_s, "PASS" if not fails else "FAIL (%d)" % len(fails)))
    for f in fails:
        problems.append("%s: %s" % (mid, f))
    return True


def main():
    ap = add_common_args(argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter))
    ap.add_argument("--map", action="append", choices=MAPS, help="map id (repeatable; default all three)")
    ap.add_argument("--wait", type=float, default=150.0, help="seconds to wait for __DF__ and 'ready' per map")
    ap.add_argument("--samples", type=int, default=128, help="measured points per site (>= 64)")
    ap.add_argument("--max-hover-cm", type=float, default=3.0)
    ap.add_argument("--max-sink-cm", type=float, default=1.0)
    ap.add_argument("--max-build-ms", type=float, default=150.0)
    ap.add_argument("--life-s", type=float, default=2.5, help="a marker's life (view/mapview.ts DROP_MARKER.life)")
    ap.add_argument("--grace-s", type=float, default=4.0, help="extra wall seconds a fade may take on a loaded box")
    ap.add_argument("--shots-map", default="cinder", help="map whose two steepest sites get close screenshots ('' = none)")
    ap.add_argument("--shot-dist", type=float, default=3.6)
    ap.add_argument("--shot-elev", type=float, default=16.0)
    ap.add_argument("--seed", type=int, default=1, help="match seed (?seed=): pins the start sites and the respawn draws")
    ap.add_argument("--tag", default="", help="report + shot name suffix (e.g. before / after)")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()
    maps = args.map or list(MAPS)
    name = "padcheck" + (("_" + args.tag) if args.tag else "")
    report = {"maps": {}, "headless": args.headless, "base": args.base, "what": "FFA drop-in markers (CONTRACT_FFA_SPAWNS S5)",
              "limits": {"maxHoverCm": args.max_hover_cm, "maxSinkCm": args.max_sink_cm, "maxBuildMs": args.max_build_ms,
                         "samples": args.samples, "lifeS": args.life_s, "graceS": args.grace_s}}
    problems = []
    others, _ = preflight_chromes("pre-flight")
    report["otherAutomatedChrome"] = others
    sess = Session(args, "padcheck")
    try:
        sess.start()
    except Exception as e:
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    judged = 0
    d = {}
    try:
        for mid in maps:
            if check_map(sess, args, mid, report, problems):
                judged += 1
        d = sess.diagnostics()
    finally:
        sess.close()
    report["diagnostics"] = d
    print()
    print_diagnostics(d)
    for p in diag_problems(d):
        problems.append("diagnostics: " + p)
    report["problems"] = problems
    verdict = "PASS" if not problems and judged == len(maps) else "FAIL"
    report["verdict"] = verdict
    path = save_report(name, report, args.base)
    print("\nsummary:")
    for mid in maps:
        row = report["maps"].get(mid) or {}
        rb = row.get("readback") or {}
        rs = row.get("respawn") or {}
        print("  %-9s sites %s · max hover %s cm · max sink %s cm · build %s ms · start markers %s · respawn site %s → %s" % (
            mid, len(rb.get("pads") or []), row.get("maxHoverCm"), row.get("maxSinkCm"), rb.get("buildMs"),
            len(row.get("startMarkers") or []), rs.get("siteBefore"), rs.get("siteAfter")))
    if problems:
        print("problems (%d):" % len(problems))
        for p in problems:
            print("  - " + p)
    print("report: %s" % path)
    print("RESULT: %s" % verdict)
    if judged < len(maps):
        return 2
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    sys.exit(main())
