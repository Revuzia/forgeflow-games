#!/usr/bin/env python
"""DYEFIELD FFA drop-pad check (lane PADS) — do the FFA drop pads sit ON the ground?

    python _harness/padcheck.py --headless                          # all 3 maps, report padcheck.json
    python _harness/padcheck.py --headless --map cinder --tag before # one map, report padcheck_before.json
    python _harness/padcheck.py --headless --base http://localhost:5196/

Flow per map (pier18 · lockwell · cinder):
  1. load /?mode=ffa&map=<id>&dev=1&seed=<--seed> (a deep link: the FFA match loads behind the CLICK TO PLAY card; the drop pads
     are built in startSession, before phase 'ready');
  2. wait for __DF__.state().phase == 'ready', then read __DF__.ffaPads(N) (testsurface.ts, lane PADS): per pad the
     RENDERED pad top (a downward ray onto the pad mesh itself) vs the ground (a downward ray onto the visible map
     meshes, the pads excluded, first face with normal y >= 0.7) at N points inside 0.95 R (a sunflower spread + a
     ring on 0.95 R) → maxHoverCm (the pad above the sand) and maxSinkCm (the pad buried), the ground's fitted
     slope + downhill direction, the pads' draw objects and addFfaPads' build time (root.userData.buildMs);
  3. asserts: matchMode 'ffa', 8 pads, ONE pad draw object, >= 64 measured samples on every pad with no ray miss,
     max hover <= 3 cm and max sink <= 1 cm on EVERY pad, build time <= --max-build-ms;
  4. cinder (or --shots-map): close screenshots of the two pads on the steepest ground (by the read-back's slope):
     a custom camera (a clone of the game camera) looks at the pad from its downhill side and from across the
     slope, the sim + the visual clock frozen (__DF__.freeze), the runners hidden for the one frame (a runner stands
     on its pad before the countdown and would cover the mark), the sun's shadow box centred on the pad; the canvas
     is read back with toDataURL in the same task as the render → _shots/padcheck_<tag>_<map>_pad<i>_<view>.png.
Zero console errors, page / window errors, shader / GL errors and failed requests over the whole run, else FAIL.
Exit codes: 0 PASS · 1 FAIL · 2 the page never got far enough to judge.
"""
import argparse
import base64
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (SHOTS, HarnessError, Session, add_common_args, build_url, diag_problems,  # noqa: E402
                    preflight_chromes, print_diagnostics, save_report)

MAPS = ("pier18", "lockwell", "cinder")

# the close-up: a camera clone at `dist` m from the pad centre, `elev` degrees above the pad's ground, looking at a
# point `aimUp` m above the centre; view 'downhill' stands on the downhill side looking uphill (a hovering downhill
# edge shows its gap, the tilted top faces the lens), 'across' looks along the contour (the wedge profile)
SHOT_JS = r"""
async ([i, view, o]) => {
  const D = window.__DF__;
  const dev = D && D.dev;
  if (!dev) throw new Error('__DF__.dev unavailable (load with ?dev=1)');
  const p = dev.parts, pad = dev.world.crewPads[i];
  if (!pad) throw new Error('no crew pad ' + i);
  D.freeze(true);
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const canvas = dev.renderer.domElement;
  const cam = dev.camera.clone();
  cam.fov = o.fov;
  cam.aspect = canvas.width / Math.max(1, canvas.height);
  cam.near = 0.05;
  cam.updateProjectionMatrix();
  let dx = o.downhill[0], dz = o.downhill[1];
  if (Math.hypot(dx, dz) < 1e-3) { dx = Math.sin(pad.yaw || 0); dz = Math.cos(pad.yaw || 0); }
  if (view === 'across') { const t = dx; dx = -dz; dz = t; }
  const e = o.elev * Math.PI / 180;
  const gy = o.groundY;
  cam.position.set(pad.x + dx * o.dist * Math.cos(e), gy + o.dist * Math.sin(e), pad.z + dz * o.dist * Math.cos(e));
  cam.up.set(0, 1, 0);
  cam.lookAt(pad.x, gy + o.aimUp, pad.z);
  cam.updateMatrixWorld();
  const V = dev.camera.position.constructor;
  p.sky.update(0, cam, new V(pad.x, gy, pad.z));
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


def r1(v):
    return None if v is None else round(float(v), 1)


def check_map(sess, args, mid, report, problems, notes):
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
    ok, rb = sess.df("ffaPads", args.samples)
    if not ok or not isinstance(rb, dict):
        problems.append("%s: __DF__.ffaPads() failed: %s" % (mid, rb))
        return False
    row["readback"] = rb
    fails = []
    if rb.get("matchMode") != "ffa":
        fails.append("matchMode %r (want 'ffa')" % rb.get("matchMode"))
    if rb.get("error"):
        fails.append("read-back error: %s" % rb.get("error"))
    pads = rb.get("pads") or []
    if rb.get("count") != 8 or len(pads) != 8:
        fails.append("pads: count %r, measured %d (want 8)" % (rb.get("count"), len(pads)))
    if rb.get("drawObjects") != 1:
        fails.append("pad draw objects %r (want ONE draw for all pads)" % rb.get("drawObjects"))
    bms = rb.get("buildMs")
    if not isinstance(bms, (int, float)):
        fails.append("addFfaPads build time not reported (root.userData.buildMs)")
    elif bms > args.max_build_ms:
        fails.append("addFfaPads took %.1f ms (> %.0f ms)" % (bms, args.max_build_ms))
    print("\n[%s] ready in %.1f s · %d pads · draw objects %s · %s vertices · build %s ms (gather %s) · read-back %s ms"
          " (%s samples/pad) · floor tris per pad %s · plane-clamped vertices %s" % (
              mid, row["tReadyS"], len(pads), rb.get("drawObjects"), rb.get("vertices"), r1(bms), rb.get("gather"),
              rb.get("ms"), rb.get("samplesPerPad"), rb.get("floorTris"), rb.get("clampedVertices")))
    print("   pad crew mark        x       z     slope   hover cm  sink cm  mean cm  samples miss(top/gnd)")
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
        print("   %3d %4s %-10s %7.2f %7.2f  %5.1f°  %8s %8s %8s  %7s  %s/%s%s" % (
            pd.get("i"), pd.get("crew"), pd.get("mark"), pd.get("x"), pd.get("z"), pd.get("slopeDeg") or 0.0,
            h, s, pd.get("meanCm"), pd.get("samples"), pd.get("topMiss"), pd.get("groundMiss"),
            ("   <-- " + "; ".join(bad)) if bad else ""))
        for b in bad:
            fails.append("pad %s (crew %s, %s): %s" % (pd.get("i"), pd.get("crew"), pd.get("mark"), b))
    row["maxHoverCm"] = worst_h
    row["maxSinkCm"] = worst_s
    # shots on the steepest pads
    if mid == args.shots_map and pads:
        steep = sorted(pads, key=lambda q: -(q.get("slopeDeg") or 0.0))[:2]
        row["shots"] = []
        for pd in steep:
            for view in ("downhill", "across"):
                opts = {"fov": 50.0, "dist": args.shot_dist, "elev": args.shot_elev, "aimUp": 0.05,
                        "downhill": pd.get("downhill") or [0, 0],
                        "groundY": pd.get("groundY") if isinstance(pd.get("groundY"), (int, float)) else pd.get("y") - 1.0}
                path = os.path.join(args.out_dir, "padcheck_%s_%s_pad%d_%s.png" % (args.tag or "run", mid, pd.get("i"), view))
                try:
                    res = sess.js(SHOT_JS, [pd.get("i"), view, opts])
                    data = res["url"].split(",", 1)[1]
                    os.makedirs(os.path.dirname(path), exist_ok=True)
                    with open(path, "wb") as f:
                        f.write(base64.b64decode(data))
                    row["shots"].append({"pad": pd.get("i"), "view": view, "slopeDeg": pd.get("slopeDeg"),
                                         "path": path, "cam": res.get("cam"), "buffer": res.get("buffer")})
                    print("   shot: pad %d (%.1f°) %s → %s" % (pd.get("i"), pd.get("slopeDeg") or 0.0, view, path))
                except Exception as e:
                    fails.append("screenshot pad %s %s failed: %s" % (pd.get("i"), view, str(e).splitlines()[0][:200]))
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
    ap.add_argument("--samples", type=int, default=128, help="measured points per pad (>= 64)")
    ap.add_argument("--max-hover-cm", type=float, default=3.0)
    ap.add_argument("--max-sink-cm", type=float, default=1.0)
    ap.add_argument("--max-build-ms", type=float, default=150.0)
    ap.add_argument("--shots-map", default="cinder", help="map whose two steepest pads get close screenshots ('' = none)")
    ap.add_argument("--shot-dist", type=float, default=3.6)
    ap.add_argument("--shot-elev", type=float, default=16.0)
    ap.add_argument("--seed", type=int, default=1,
                    help="match seed (?seed=): pins the spawn shuffle, so before / after shots show the same pads")
    ap.add_argument("--tag", default="", help="report + shot name suffix (e.g. before / after)")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()
    maps = args.map or list(MAPS)
    name = "padcheck" + (("_" + args.tag) if args.tag else "")
    report = {"maps": {}, "headless": args.headless, "base": args.base, "limits": {
        "maxHoverCm": args.max_hover_cm, "maxSinkCm": args.max_sink_cm, "maxBuildMs": args.max_build_ms, "samples": args.samples}}
    problems, notes = [], []
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
    try:
        for mid in maps:
            if check_map(sess, args, mid, report, problems, notes):
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
    report["notes"] = notes
    verdict = "PASS" if not problems and judged == len(maps) else "FAIL"
    report["verdict"] = verdict
    path = save_report(name, report, args.base)
    print("\nsummary:")
    for mid in maps:
        row = report["maps"].get(mid) or {}
        rb = row.get("readback") or {}
        print("  %-9s pads %s · max hover %s cm · max sink %s cm · build %s ms" % (
            mid, len(rb.get("pads") or []), row.get("maxHoverCm"), row.get("maxSinkCm"), rb.get("buildMs")))
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
