#!/usr/bin/env python
"""BLOCKTOOTH boot check — CONTRACT §15 gate 3.

    python _harness/bootcheck.py                                  # headed Chrome, molo / grideast / seed 1
    python _harness/bootcheck.py --titan voltkite --biome lockwater --seed 9 --seconds 10
    python _harness/bootcheck.py --headless                       # same d3d11 flags, no window

Loads /?autostart=1&dev=1&titan=&biome=&seed= (autostart skips title + select and goes straight
to loading → slate), waits for the open slate, screenshots it and asserts NUMERICALLY that the baby
titan stands inside a zebra crossing (`__BT__.world.city.crosswalks`, read-only), presses a REAL key
to dismiss the slate, waits for `play`, lets the game run N seconds, screenshots, and prints the
state + renderer stats + fps.

VERDICT is "BOOTS CLEAN" only when ALL hold:
  * 0 console errors, 0 page errors, 0 window errors / unhandled rejections,
    0 shader/GL diagnostics, 0 failed requests;
  * the slate appeared and the titan is ON a crosswalk (skip with --no-crosswalk-assert);
  * a real key press reached `play`;
  * frames advancing (harness rAF counter) AND the sim advancing (state().tick grew).
Exit codes: 0 clean · 1 not clean · 2 the page never got far enough to judge.
"""
import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BIOMES, SHOTS, TITANS, HarnessError, Session, add_common_args, build_url,  # noqa: E402
                    compact_state, diag_problems, dismiss_slate, ensure_play, print_diagnostics, save_report)

CROSSWALK_JS = r"""
async (tol) => {
  let W = window.__H_W__ && window.__H_W__();
  let source = '__BT__.world';
  let T = W && W.titan, C = W && W.city;
  if (!T || !C) {
    // Fallback when the app does not expose __BT__.world: generateCity is deterministic from
    // (biome, seed), so rebuild the same layout in-page through the Vite module server and test the
    // titan pose from __BT__.state() against its crosswalks. The rebuilt World is never stepped.
    let s = null; try { s = window.__BT__.state(); } catch (_) {}
    if (!s || typeof s.x !== 'number' || !s.biome || !s.titan || s.seed === undefined || s.seed === null) {
      return { ok: false, reason: '__BT__.world is not exposed and state() lacks titan/biome/seed/x/z' };
    }
    try {
      const m = await import('/src/core/world.ts');
      const w2 = m.createWorld({ titan: s.titan, biome: s.biome, seed: Number(s.seed) >>> 0 });
      C = w2.city;
      T = { x: s.x, z: s.z, heading: typeof s.heading === 'number' ? s.heading : 0, height: s.height, radius: null };
      source = 'state() pose + city rebuilt via /src/core/world.ts createWorld (seed ' + s.seed + ')';
    } catch (e) {
      return { ok: false, reason: '__BT__.world is not exposed and rebuilding the city in-page failed: ' + String(e && e.message || e) };
    }
  }
  const cws = C.crosswalks || [];
  const inRect = (cx, cz, hx, hz) => Math.abs(T.x - cx) <= hx + tol && Math.abs(T.z - cz) <= hz + tol;
  let best = null;
  for (let i = 0; i < cws.length; i++) {
    const c = cws[i];
    // primary reading: `len` runs along `axis` (the crossing direction), `width` is the zebra depth
    const hxA = (c.axis === 'x' ? c.len : c.width) / 2, hzA = (c.axis === 'x' ? c.width : c.len) / 2;
    const primary = inRect(c.x, c.z, hxA, hzA);
    const swapped = inRect(c.x, c.z, hzA, hxA);
    const d = Math.hypot(T.x - c.x, T.z - c.z);
    if (!best || (primary && !best.primary) || ((primary === best.primary) && d < best.dist)) {
      best = { i, x: c.x, z: c.z, axis: c.axis, len: c.len, width: c.width, primary, swapped, dist: d };
    }
  }
  const along = best ? (best.axis === 'x' ? Math.abs(Math.sin(T.heading)) : Math.abs(Math.cos(T.heading))) : null;
  // food in reach of the opening frame (CONTRACT §7.1: ≥ 2 parked cars + a kiosk within 8 m) — info only
  const near = {};
  for (const p of (C.props || [])) {
    if (!p.alive) continue;
    if (Math.hypot(p.x - T.x, p.z - T.z) <= 8) near[p.kind] = (near[p.kind] || 0) + 1;
  }
  return {
    // strict: citygen writes `len` along `axis` (the walking direction across the road) and `width` =
    // the 4 m zebra depth along the road; `swapped` is reported for diagnosis only
    ok: !!best && best.primary, count: cws.length, source,
    titan: { x: T.x, z: T.z, heading: T.heading, height: T.height, radius: T.radius },
    spawn: C.spawn || null, nearest: best, headingAlongCrossing: along, foodWithin8m: near,
  };
}
"""

RENDER_JS = r"""
() => {
  const B = window.__BT__; if (!B) return null;
  let s = null; try { s = B.state(); } catch (_) {}
  const out = { fps: s && s.fps, draws: s && s.draws, tris: s && s.tris, programs: s && s.programs };
  try { out.perf = B.perf ? B.perf() : null; } catch (e) { out.perf = String(e); }
  // the game canvas = the largest one (portrait / UI canvases may exist too)
  let cv = null;
  for (const c of document.querySelectorAll('canvas')) if (!cv || c.clientWidth * c.clientHeight > cv.clientWidth * cv.clientHeight) cv = c;
  out.canvas = cv ? [cv.width, cv.height, cv.clientWidth, cv.clientHeight] : null;
  try {
    const gl = cv && (cv.getContext('webgl2') || cv.getContext('webgl'));
    const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
    out.gpu = gl ? (d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null;
  } catch (_) { out.gpu = null; }
  out.dpr = window.devicePixelRatio;
  return out;
}
"""


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH boot check (gate 3)")
    add_common_args(ap)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--seconds", type=float, default=8.0, help="seconds of play before the final sample")
    ap.add_argument("--wait", type=float, default=90.0, help="seconds to wait for __BT__ and for the slate")
    ap.add_argument("--no-crosswalk-assert", action="store_true",
                    help="do not fail when the titan-on-crosswalk check cannot run / fails")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()

    url = build_url(args.base, autostart=1, dev=1, titan=args.titan, biome=args.biome, seed=args.seed,
                    quality=args.quality)
    shot_slate = os.path.join(args.out_dir, "bootcheck_slate.png")
    shot_play = os.path.join(args.out_dir, "bootcheck_play.png")
    report = {"url": url, "headless": args.headless, "titan": args.titan, "biome": args.biome, "seed": args.seed}
    problems = []
    fatal = None
    state_slate = state_play = None
    cw = None
    reached_play = False
    adv = (False, None, None)
    tick_a = tick_b = None
    render = None
    t_boot = None
    overlays = {}

    sess = Session(args, "bootcheck")
    try:
        sess.start()
    except Exception as e:  # HarnessError (server) or a Chrome launch failure
        sess.close()
        print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
        print("RESULT: FAIL")
        return 2
    try:
        t0 = time.time()
        try:
            sess.goto(url)
        except Exception as e:
            fatal = "navigation failed: %s" % str(e).splitlines()[0]
        if not fatal and not sess.wait_bt(args.wait):
            fatal = "window.__BT__ never appeared within %.0f s" % args.wait
        if not fatal:
            ok, scr = sess.wait_screen(("slate", "play"), args.wait)
            t_boot = time.time() - t0
            if not ok:
                fatal = "never reached the slate (screen=%r after %.0f s)" % (scr, args.wait)
            elif scr == "play":
                problems.append("autostart skipped the slate (went straight to play) — slate not verified")
        if not fatal and sess.screen() == "slate":
            time.sleep(1.2)                               # slate fade-in / halftone settle
            state_slate = sess.state()
            sess.screenshot(shot_slate)
            cw = sess.safe_js(CROSSWALK_JS, 0.25, default={"ok": False, "reason": "crosswalk eval failed"})
            if not (cw or {}).get("ok"):
                msg = "titan is NOT on a zebra crossing" if (cw or {}).get("count") is not None else \
                    "titan-on-crosswalk check could not run: %s" % (cw or {}).get("reason")
                if cw and cw.get("nearest"):
                    n = cw["nearest"]
                    msg += " (nearest crosswalk #%d at (%.1f, %.1f) axis %s len %.1f width %.1f; titan (%.1f, %.1f); %.1f m away)" % (
                        n["i"], n["x"], n["z"], n["axis"], n["len"], n["width"],
                        cw["titan"]["x"], cw["titan"]["z"], n["dist"])
                if args.no_crosswalk_assert:
                    print("note (not gating): " + msg)
                else:
                    problems.append(msg)
            ok, scr = dismiss_slate(sess, 20, "Enter")
            reached_play = ok
            if not ok:
                problems.append("a real key press did not dismiss the slate (screen=%r)" % (scr,))
        elif not fatal:
            reached_play = sess.screen() == "play"

        if not fatal and reached_play:
            s0 = sess.state() or {}
            tick_a = s0.get("tick")
            # let it run; a level-up draft or an auto-pause freezes the sim — clear it with a real key
            t_run = time.time()
            while time.time() - t_run < max(0.5, args.seconds):
                scr = sess.screen()
                if scr == "draft":
                    overlays["draft"] = overlays.get("draft", 0) + 1
                    sess.press("Digit1")
                elif scr == "pause":
                    overlays["pause"] = overlays.get("pause", 0) + 1
                    sess.press("Escape")
                elif scr not in ("play", None):
                    problems.append("left play during the run (screen=%r)" % (scr,))
                    break
                time.sleep(0.5)
            ensure_play(sess, 6)
            adv = sess.frames_advancing(3.0)
            state_play = sess.state()
            tick_b = (state_play or {}).get("tick")
            render = sess.safe_js(RENDER_JS)
            sess.screenshot(shot_play)
            if (state_play or {}).get("screen") != "play":
                problems.append("not in play at the final sample (screen=%r)" % ((state_play or {}).get("screen"),))
    finally:
        diag = sess.diagnostics() if sess.page else {}
        sess.close()

    sim_adv = isinstance(tick_a, (int, float)) and isinstance(tick_b, (int, float)) and tick_b > tick_a
    print("=" * 78)
    print("URL         : %s" % url)
    print("mode        : %s" % ("headless Chrome (d3d11)" if args.headless else "headed Chrome (d3d11)"))
    print("boot → slate: %s" % ("%.1f s" % t_boot if t_boot is not None else "—"))
    print("slate shot  : %s" % (shot_slate if state_slate else "—"))
    if cw is not None:
        n = cw.get("nearest") or {}
        print("crosswalk   : %s  (%s crosswalks; nearest #%s axis %s len %s width %s, %.2f m from titan; primary=%s swapped=%s; heading-along=%s)" % (
            "ON ZEBRA" if cw.get("ok") else "NOT ON ZEBRA", cw.get("count"), n.get("i"), n.get("axis"), n.get("len"),
            n.get("width"), n.get("dist") or 0.0, n.get("primary"), n.get("swapped"),
            None if cw.get("headingAlongCrossing") is None else round(cw["headingAlongCrossing"], 2)))
        if cw.get("source"):
            print("              source: %s" % cw["source"])
        if cw.get("reason"):
            print("              %s" % cw["reason"])
        if cw.get("foodWithin8m") is not None:
            print("food ≤ 8 m  : %s" % json.dumps(cw.get("foodWithin8m")))
    print("reached play: %s%s" % (reached_play, ("  (overlays cleared with real keys: %s)" % json.dumps(overlays)) if overlays else ""))
    print("frames      : %s → %s  (%s)" % (adv[1], adv[2], "advancing" if adv[0] else "STALLED"))
    print("sim ticks   : %s → %s  (%s)" % (tick_a, tick_b, "advancing" if sim_adv else "STALLED"))
    if render:
        pf = render.get("perf") or {}
        print("renderer    : fps %s · draws %s · tris %s · programs %s · canvas %s · dpr %s" % (
            render.get("fps"), render.get("draws"), render.get("tris"), render.get("programs"), render.get("canvas"),
            render.get("dpr")))
        if isinstance(pf, dict):
            print("perf()      : fps %s · p50 %s · p99 %s · max %s · simMs %s" % (
                pf.get("fps"), pf.get("p50"), pf.get("p99"), pf.get("max"), pf.get("simMs")))
        print("gpu         : %s" % render.get("gpu"))
    print("play shot   : %s" % (shot_play if state_play else "—"))
    print("-" * 78)
    print("state (slate): %s" % json.dumps(compact_state(state_slate))[:1500])
    print("state (play) : %s" % json.dumps(compact_state(state_play))[:2000])
    print("-" * 78)
    print_diagnostics(diag)
    print("=" * 78)

    report.update({"bootS": t_boot, "stateSlate": state_slate, "statePlay": state_play, "crosswalk": cw,
                   "reachedPlay": reached_play, "framesAdvancing": adv[0], "simAdvancing": sim_adv,
                   "render": render, "diagnostics": diag, "fatal": fatal, "overlays": overlays})

    if fatal:
        report["verdict"] = "NOT CLEAN"
        print("VERDICT: NOT CLEAN — %s" % fatal)
        for p in diag_problems(diag):
            print("   X %s" % p)
        print("report      : %s" % save_report("bootcheck", report, args.base, args.report_dir))
        print("RESULT: FAIL")
        return 2

    problems += diag_problems(diag)
    if not reached_play:
        problems.append("never reached play")
    else:
        if not adv[0]:
            problems.append("the harness frame counter did not advance (rAF stalled)")
        if not sim_adv:
            problems.append("the sim tick did not advance during play (%s → %s)" % (tick_a, tick_b))
    clean = not problems
    report["verdict"] = "BOOTS CLEAN" if clean else "NOT CLEAN"
    report["problems"] = problems
    print("VERDICT: %s" % report["verdict"])
    for p in problems:
        print("   X %s" % p)
    print("report      : %s" % save_report("bootcheck", report, args.base, args.report_dir))
    print("RESULT: %s" % ("OK" if clean else "FAIL"))
    return 0 if clean else 1


if __name__ == "__main__":
    raise SystemExit(main())
