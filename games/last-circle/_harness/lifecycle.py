#!/usr/bin/env python
"""lifecycle - the L4 phase-A behaviours no other gate drives (PLAN L4 f / g / h gates; added by Wave-2 lane L1F).

    python _harness/lifecycle.py --disk
    python _harness/lifecycle.py --rev <sha> --skip touch

Rows (each is a PLAN L4 gate or its control):
  reduced motion       prefers-reduced-motion: reduce (Playwright emulate_media) + NO stored settings -> W.settings.shake
                       === 0.5 (L4 f: loadSettings default under reduced motion)
  control              no-preference + no stored settings -> shake === 1 (the 0.5 must come from the media query)
  stored value wins    reduce + a stored {shake: 0.8} -> 0.8 (a player's own choice is never overridden)
  fastForward steps    fastForward(0.5, 1/30), (1, 1/60), (2, 1/20) advance W.t by exactly 0.5 / 1 / 2 s (L4 h: an integer
                       step count; the float loop ran 16 steps = 0.533 s for (0.5, 1/30), bots audit S4)
  hidden tab pauses    a PRACTICE (solo, non-net) match, unpaused, player alive (harness guard): document.visibilityState
                       -> 'hidden' + a visibilitychange dispatch -> W.paused within 1 s AND W.t frozen across 30 stepped
                       frames (L4 g). Control first: 30 stepped frames DO advance W.t while visible (else could-not-judge).
                       What happens on return is information (the player resumes from the pause menu).
  touch defaults       an emulated Pixel 7 (DPR 2.625, touch, mobile UA) with NO stored settings: graphics tier 'medium',
                       sun shadow map <= 1024, no anti-aliasing (context antialias off and no AA pass) at DPR >= 2
                       (L4 f, CONTRACT_MOBILE M7). Reads W._gfx (L4's applyGraphics record) when it exists.
  0 page / window errors in both sessions
Storage is controlled per navigation by an init script keyed on the URL hash (#h_ls=clear | #h_ls=shake08), so each boot
starts from exactly the stored state it names. Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import mobilekit as MK  # noqa: E402

LS_INIT = r"""(() => { try { const m = /[#&]h_ls=([a-z0-9]+)/.exec(location.hash || ''); if (!m) return;
  if (m[1] === 'clear') localStorage.removeItem('lc_settings');
  else if (m[1] === 'shake08') localStorage.setItem('lc_settings', JSON.stringify({ shake: 0.8 }));
} catch (_) {} })();"""

SETTINGS_JS = r"""() => { const W = window.__LC__.W; let stored = null; try { stored = localStorage.getItem('lc_settings'); } catch (e) {}
  return { shake: W.settings.shake, graphics: W.settings.graphics, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches,
           stored: stored ? stored.slice(0, 200) : null }; }"""

FF_JS = r"""([sec, h]) => { const C = window.__LC__, W = C.W; const t0 = W.t; C.fastForward(sec, h);
  return { t0: +t0.toFixed(6), t1: +W.t.toFixed(6), dt: +(W.t - t0).toFixed(6), steps: Math.round((W.t - t0) / h), over: !!(W.match && W.match.over) }; }"""

HIDE_JS = r"""() => { const W = window.__LC__.W; const was = !!W.paused;
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  return { pausedBefore: was, pausedNow: !!W.paused, phase: W.phase, net: !!W.net }; }"""

SHOW_JS = r"""() => { const W = window.__LC__.W; delete document.visibilityState; delete document.hidden;
  document.dispatchEvent(new Event('visibilitychange'));
  return { visibility: document.visibilityState, paused: !!W.paused }; }"""

GFX_JS = r"""() => { const W = window.__LC__.W, k = W.kernel, r = k.renderer, gl = r.getContext();
  const attrs = gl.getContextAttributes ? gl.getContextAttributes() : {};
  const passes = k.composer ? k.composer.passes.map((p) => p.constructor.name + (p.enabled ? '' : '(off)')) : [];
  return { dpr: window.devicePixelRatio, rendererPR: r.getPixelRatio(), graphics: W.settings.graphics, gfx: W._gfx || null,
           shadows: !!r.shadowMap.enabled, shadowMap: k.sun && k.sun.shadow ? k.sun.shadow.mapSize.x : null,
           contextAA: !!attrs.antialias, aaPasses: passes.filter((n) => /SMAA|FXAA|TAA|SSAA|MSAA/i.test(n) && !/\(off\)/.test(n)), passes,
           coarse: matchMedia('(pointer: coarse)').matches, touchPoints: navigator.maxTouchPoints || 0 }; }"""


def url_with(base, n, hash_):
    sep = "&" if "?" in base else "?"
    return "%s%shlc=%d#h_ls=%s" % (base, sep, n, hash_)


def settings_rows(v, s, args):
    s.page.emulate_media(reduced_motion="reduce")
    s.boot(url_with(args.base, 1, "clear"))
    a = s.js(SETTINGS_JS)
    s.page.emulate_media(reduced_motion="no-preference")
    s.boot(url_with(args.base, 2, "clear"))
    b = s.js(SETTINGS_JS)
    s.page.emulate_media(reduced_motion="reduce")
    s.boot(url_with(args.base, 3, "shake08"))
    c = s.js(SETTINGS_JS)
    v.data["settings"] = {"reduceNoStore": a, "noPrefNoStore": b, "reduceStored08": c}
    if not a.get("reduce") or b.get("reduce") or not c.get("reduce"):
        v.cnj("reduced motion: shake 0.5 with no stored value", "the media emulation did not take (%s / %s / %s)" % (a, b, c))
    else:
        v.check("reduced motion + no stored settings -> shake 0.5", a.get("shake") == 0.5, a, expect="0.5 (L4 f)")
        v.check("control: no reduced motion + no stored settings -> shake 1", b.get("shake") == 1, b, expect="1 (the default)")
        v.check("reduced motion + a stored shake 0.8 -> 0.8 (the stored value wins)", c.get("shake") == 0.8, c, expect="0.8")


def desktop_part(v, args, errs):
    with C.Session(args, "lifecycle", init_scripts=[LS_INIT]) as s:
        # ---- reduced motion / control / stored value (L4 f)
        if "settings" in args.skip:
            s.boot(url_with(args.base, 3, "clear"))
        else:
            settings_rows(v, s, args)

        # ---- a PRACTICE match (solo, non-net): fastForward steps (L4 h) and the hidden-tab pause (L4 g)
        sm = s.start_match("practice", 7, None, enter=True)
        v.info("practice match", sm)
        s.guard_player(True)
        if "ff" not in args.skip:
            rows = {}
            for sec, h in ((0.5, 1 / 30), (1.0, 1 / 60), (2.0, 1 / 20)):
                rows["%g@1/%d" % (sec, round(1 / h))] = s.js(FF_JS, [sec, h])
            bad = {k: r for k, r in rows.items() if abs(r["dt"] - float(k.split("@")[0])) > 1e-6 and not r["over"]}
            v.check("fastForward(s, h) advances W.t by exactly s (an integer step count)", not bad, rows,
                    expect="0.5 / 1 / 2 s (L4 h; was 16 steps = 0.533 s for (0.5, 1/30))")
        if "pause" not in args.skip:
            s.freeze_loop()
            st = s.js("() => { const W = window.__LC__.W; return { phase: W.phase, paused: !!W.paused, net: !!W.net, alive: !!(W.player && W.player.alive) }; }")
            t_a = s.js("() => window.__LC__.W.t")
            s.step_frames(30, 1 / 60, render=False)
            t_b = s.js("() => window.__LC__.W.t")
            if st.get("phase") != "match" or st.get("paused") or st.get("net") or not st.get("alive") or not (t_b > t_a):
                v.cnj("a hidden-tab dispatch pauses an unpaused solo match",
                      "precondition not met: %s, W.t %s -> %s over 30 visible stepped frames" % (st, t_a, t_b))
            else:
                h = s.js(HIDE_JS)
                s.sleep(1.0)
                p1 = s.js("() => !!window.__LC__.W.paused")
                t_c = s.js("() => window.__LC__.W.t")
                s.step_frames(30, 1 / 60, render=False)
                t_d = s.js("() => window.__LC__.W.t")
                v.check("a hidden-tab dispatch pauses an unpaused solo match (W.paused, W.t frozen over 30 stepped frames)",
                        bool(p1) and t_d == t_c, {"dispatch": h, "pausedAfter1s": p1, "W.t": [t_c, t_d], "controlWhileVisible": [t_a, t_b]},
                        expect="paused within 1 s and W.t frozen (L4 g)")
                v.info("back to visible (information: the player resumes from the pause menu)", s.js(SHOW_JS))
            s.thaw_loop()
        s.guard_player(False)
        d = s.diagnostics()
        errs.extend(d["pageErrors"] + d["windowErrors"])
        v.data["diagnosticsDesktop"] = {k: d[k][:5] if isinstance(d[k], list) else d[k] for k in ("consoleErrors", "pageErrors", "windowErrors", "failedRequests")}


def touch_part(v, args, errs):
    spec = MK.DEVICES[args.device]
    ctx_kw = {"device_scale_factor": spec["dpr"], "is_mobile": True, "has_touch": True, "user_agent": spec["ua"]}
    inits = [LS_INIT] + ([MK.IOS_INIT] if spec.get("ios") else []) + [MK.PHONE_NO_LOCK]
    with C.Session(args, "lifecycle-touch", viewport={"width": spec["w"], "height": spec["h"]}, context_kw=ctx_kw, init_scripts=inits) as s:
        s.goto(url_with(args.base, 4, "clear"))
        # the desktop-only card (ffg_boot3d.js, removed in Wave 3) blocks the boot on touch: PLAY ANYWAY is SETUP here
        for _ in range(int(args.boot_timeout / 0.5)):
            if s.safe_js("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)"):
                break
            s.safe_js("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /PLAY ANYWAY|CONTINUE ANYWAY/i.test(x.textContent || '')); if (b) b.click(); }")
            s.sleep(0.5)
        if s.wait_lc(30) is None:
            v.cnj("touch defaults", "the menu never appeared on the emulated %s" % args.device)
            return
        s.sleep(1.5)
        g = s.js(GFX_JS)
        v.data["touchDefaults"] = g
        if (g.get("dpr") or 0) < 2 or not g.get("coarse"):
            v.cnj("touch defaults (%s)" % args.device, "the emulation did not take: %s" % g)
        else:
            gfx = g.get("gfx") or {}
            tier = gfx.get("tier") or g.get("graphics")
            v.check("touch defaults (%s, no stored settings): graphics tier 'medium'" % args.device, tier == "medium",
                    {"tier": tier, "settings": g.get("graphics"), "gfx": gfx or None}, expect="medium (L4 f, M7)")
            sm = g.get("shadowMap") if g.get("shadows") else 0
            v.check("touch defaults (%s): sun shadow map <= 1024" % args.device, sm is not None and sm <= 1024,
                    {"shadows": g.get("shadows"), "shadowMap": g.get("shadowMap"), "gfxShadowMap": gfx.get("shadowMap")}, expect="<= 1024 (was 2048 on medium)")
            aa = g.get("contextAA") or bool(g.get("aaPasses")) or bool(gfx.get("aa"))
            v.check("touch defaults (%s, DPR %s): no anti-aliasing at DPR >= 2" % (args.device, g.get("dpr")), not aa,
                    {"contextAA": g.get("contextAA"), "aaPasses": g.get("aaPasses"), "gfxAA": gfx.get("aa"), "passes": g.get("passes")},
                    expect="off (L4 f, M7)")
            v.info("touch renderer pixel ratio (information)", {"devicePixelRatio": g.get("dpr"), "rendererPR": g.get("rendererPR"),
                                                                "gfxDpr": gfx.get("dpr")})
        d = s.diagnostics()
        errs.extend(d["pageErrors"] + d["windowErrors"])
        v.data["diagnosticsTouch"] = {k: d[k][:5] if isinstance(d[k], list) else d[k] for k in ("consoleErrors", "pageErrors", "windowErrors", "failedRequests")}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--skip", default="", help="comma list: settings,ff,pause,touch (settings/ff/pause share one session)")
    ap.add_argument("--device", default="pixel7", choices=sorted(k for k in MK.DEVICES if not k.endswith("_port")))
    args = ap.parse_args()
    args.skip = {x.strip() for x in args.skip.split(",") if x.strip()}

    def body(v):
        errs = []
        if not {"settings", "ff", "pause"} <= args.skip:
            desktop_part(v, args, errs)
        if "touch" not in args.skip:
            touch_part(v, args, errs)
        v.check("0 page / window errors", not errs, errs[:5])
    return C.run_gate("lifecycle", body, args)


if __name__ == "__main__":
    sys.exit(main())
