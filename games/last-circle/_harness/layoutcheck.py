#!/usr/bin/env python
"""layoutcheck - HUD and menu geometry at desktop and phone sizes (PLAN L7 gates; dyefield/_harness/layoutcheck.py pattern).

    python _harness/layoutcheck.py                    # desktop 1280x720 / 1366x768 / 1920x1080, then phones
    python _harness/layoutcheck.py --only desktop --disk

Rects are read from the live DOM (getBoundingClientRect) of the real game; elements are found by what a player reads
(the "LVL n" chip, the quest card beside it, the "n / m" ammo count, the "LAST CIRCLE" wordmark, the DEPLOY banner),
so the same checks hold before and after lane L7 rebuilds them. One page per group, resized between sizes.

DESKTOP (1280x720, 1366x768, 1920x1080):
  wordmark     the menu's "LAST CIRCLE" title is fully inside the viewport (was top -57 px at 1280x720)
  settings     the FOV control reads "57°"
  banner       the DEPLOY announcement block does not intersect the LVL chip or the quest card (standard drop)
  ammo         the ammo count does not intersect the portal control bar #__ff_controls__
  reticle      at rest every arm >= 2 px thick x >= 6 px long (feelcheck adds crouched / sprinting)
PHONES (touch emulation, landscape 667x375 / 852x393 / 915x412 / 1180x820):
  HOW TO PLAY  GOT IT is on-screen at every size, and ONE real tap closes it
  menu + HUD   0 clipped text/controls, tap targets >= 44 px, fonts >= 12 px, no page scroll,
               0 HUD text under a touch control or the control bar (in a match)
  (the touch INTERACTIONS - look, fire, USE, slot taps, minimap tap, portrait overlay - are mobile.py)
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import mobilekit as MK  # noqa: E402
from feelcheck import RETICLE_JS  # noqa: E402

DESKTOP = [(1280, 720), (1366, 768), (1920, 1080)]

WORDMARK_JS = r"""() => {
  let best = null;
  for (const e of document.querySelectorAll('div, h1, span')) {
    if ((e.textContent || '').trim() !== 'LAST CIRCLE' || e.children.length) continue;
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') continue;
    const fs = parseFloat(s.fontSize); const r = e.getBoundingClientRect(); if (r.width < 1) continue;
    if (!best || fs > best.fs) best = { fs, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] };
  }
  return best ? Object.assign(best, { W: innerWidth, H: innerHeight }) : null;
}"""

HUDRECTS_JS = r"""(title) => {
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden') return false; } return true; };
  const R = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const own = (e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const out = { W: innerWidth, H: innerHeight };
  const lvl = [...document.querySelectorAll('div')].find((e) => /^LVL \d+$/.test(own(e)) && vis(e) && e.getBoundingClientRect().top < innerHeight * 0.4);
  if (lvl) {
    out.lvl = R(lvl.parentElement);                       // the XP row the chip sits in
    const meta = lvl.parentElement.parentElement;
    const q = [...meta.children].filter((c) => c !== lvl.parentElement && vis(c) && c.getBoundingClientRect().height > 4);
    if (q.length) { const rs = q.map(R); out.quest = [Math.min(...rs.map((r) => r[0])), Math.min(...rs.map((r) => r[1])), Math.max(...rs.map((r) => r[2])), Math.max(...rs.map((r) => r[3]))]; out.questText = q.map((c) => (c.textContent || '').trim().slice(0, 40)); }
  }
  if (title) {
    const t = [...document.querySelectorAll('div')].find((e) => own(e) === title && vis(e));
    if (t) { out.banner = R(t.parentElement); out.bannerOpacity = getComputedStyle(t.parentElement).opacity; }
  }
  const am = [...document.querySelectorAll('div')].find((e) => /^(\d+|∞)\s*\/\s*(\d+|∞)$/.test(own(e)) && vis(e));
  if (am) out.ammo = R(am);
  const bar = document.getElementById('__ff_controls__'); if (bar && vis(bar)) out.bar = R(bar);
  return out;
}"""

SETTINGS_JS = r"""() => {
  const b = [...document.querySelectorAll('button, div')].find((x) => x.offsetParent && /^[^A-Za-z0-9]*SETTINGS\s*$/i.test(x.textContent || ''));   // '⚙ SETTINGS' too
  if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""

FOV_JS = r"""() => {
  const rows = [...document.querySelectorAll('div, label, span')].filter((e) => /field of view|\bfov\b/i.test(e.textContent || '') && e.textContent.length < 80);
  const txt = rows.map((e) => (e.textContent || '').trim()).sort((a, b) => a.length - b.length);
  return { rows: txt.slice(0, 4), has57deg: txt.some((t) => /57\s*°/.test(t)) };
}"""


def isect(a, b):
    if not a or not b:
        return False
    return min(a[2], b[2]) - max(a[0], b[0]) > 1 and min(a[3], b[3]) - max(a[1], b[1]) > 1


def close_howto(s, tap=None):
    for _ in range(3):
        r = s.js(MK.BTN_RECT_JS, "^GOT IT$")
        if not r:
            return True
        x, y = MK.center(r)
        if tap:
            tap(x, y)
        else:
            s.page.mouse.click(x, y)
        s.sleep(0.6)
    return not s.js(MK.BTN_RECT_JS, "^GOT IT$")


def desktop(v, args):
    with C.Session(args, "layoutcheck-desktop", viewport={"width": DESKTOP[0][0], "height": DESKTOP[0][1]}) as s:
        s.boot()
        s.sleep(1.5)
        close_howto(s)
        for (w, h) in DESKTOP:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(1.2)
            wm = s.js(WORDMARK_JS)
            v.check("%dx%d menu: the LAST CIRCLE wordmark is fully in the viewport" % (w, h), bool(wm) and MK.inside(wm["r"], w, h),
                    wm, expect="rect inside (was top -57 px at 1280x720)")
        s.page.set_viewport_size({"width": 1280, "height": 720})
        s.sleep(0.8)
        st = s.js(SETTINGS_JS)
        if st:
            s.page.mouse.click(st[0], st[1])
            s.sleep(1.0)
            fov = s.js(FOV_JS)
            v.check("settings: the FOV control reads 57°", fov["has57deg"], fov)
            s.page.keyboard.press("Escape")
            s.sleep(0.5)
            for _ in range(2):
                bk = s.js(MK.BTN_RECT_JS, "^(BACK|CLOSE|DONE|✕|×)$")
                if not bk:
                    break
                s.page.mouse.click(*MK.center(bk))
                s.sleep(0.5)
        else:
            v.cnj("settings: the FOV control reads 57°", "no SETTINGS button on the menu")
        # a standard match: the DEPLOY banner right after the drop starts
        s.start_match("standard", 7, "isla_viva", enter=True)
        # the DEPLOY announcement is a setTimeout(250) after the drop starts: wait for its title before measuring
        # (21:33 run: the first size was read before it existed). The title text stays after the fade, so later sizes see it.
        got = s.wait_js("() => [...document.querySelectorAll('div')].some((e) => Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() === 'DEPLOY')", 8, 0.1)
        if got is None:
            v.note("no DEPLOY title appeared within 8 s of the drop")
        rects = {}
        for (w, h) in DESKTOP:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(0.6)
            rects[(w, h)] = s.js(HUDRECTS_JS, "DEPLOY")
        for (w, h), r in rects.items():
            if not r.get("banner"):
                v.cnj("%dx%d: the DEPLOY banner clears the LVL chip and the quest card" % (w, h), "no DEPLOY banner found on screen (%s)" % {k: r.get(k) for k in ("lvl", "quest")})
            else:
                hit = [n for n in ("lvl", "quest") if isect(r.get("banner"), r.get(n))]
                v.check("%dx%d: the DEPLOY banner clears the LVL chip and the quest card" % (w, h), not hit,
                        {"banner": r.get("banner"), "lvl": r.get("lvl"), "quest": r.get("quest"), "intersects": hit})
        s.land(120, protect=True)
        # "at rest": the reticle bloom decays in a kernel updater, so with the box's starved rAF it can stay at its
        # landing value (21:36 run read 3.56 x 14.24 px, a bloomed reticle; 22:00 run read the rest size 0.91 x 3.66).
        # Freeze the loop and step 2 s of frames with no input before every reading.
        s.freeze_loop()
        s.step_frames(120, 1 / 60, render=False)
        for (w, h) in DESKTOP:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(0.8)
            s.step_frames(30, 1 / 60, render=False)
            r = s.js(HUDRECTS_JS, None)
            if not r.get("ammo") or not r.get("bar"):
                v.cnj("%dx%d: the ammo count clears the portal control bar" % (w, h), "ammo %s / bar %s not found" % (r.get("ammo"), r.get("bar")))
            else:
                v.check("%dx%d: the ammo count clears the portal control bar" % (w, h), not isect(r["ammo"], r["bar"]), {"ammo": r["ammo"], "bar": r["bar"]})
            ret = s.js(RETICLE_JS)
            v.check("%dx%d: reticle arms >= 2 px x >= 6 px at rest" % (w, h),
                    ret.get("arms", 0) >= 2 and (ret.get("thick") or 0) >= 2 and (ret.get("len") or 0) >= 6, ret)
        d = s.diagnostics()
        v.info("desktop diagnostics", C.diag_problems(d, rig=False))


def phones(v, args):
    spec = MK.DEVICES["pixel7"]
    ctx_kw = {"device_scale_factor": spec["dpr"], "is_mobile": True, "has_touch": True, "user_agent": spec["ua"]}
    with C.Session(args, "layoutcheck-phones", viewport={"width": spec["w"], "height": spec["h"]}, context_kw=ctx_kw,
                   init_scripts=[MK.PHONE_NO_LOCK]) as s:
        T = MK.Touch(s.cdp(), s.sleep)
        s.stage("boot")
        s.goto()
        # the desktop-only card (today) or the menu
        t0 = time.time()
        while time.time() - t0 < args.boot_timeout:
            if s.js(MK.BTN_RECT_JS, "PLAY ANYWAY") or s.safe_js("() => !!window.__LC__"):
                break
            s.sleep(0.5)
        for _ in range(4):
            r = s.js(MK.BTN_RECT_JS, "PLAY ANYWAY")
            if not r:
                break
            T.tap(*MK.center(r))
            s.sleep(2.0)
        if s.wait_lc() is None:
            v.cnj("phones", "the menu never appeared (%s)" % (s.safe_js("() => document.body.innerText.slice(0, 160)")))
            return
        s.sleep(1.5)
        for _ in range(3):                                # KEYBOARD + MOUSE REQUIRED (today) - a real tap
            r = s.js(MK.BTN_RECT_JS, "CONTINUE ANYWAY")
            if not r:
                break
            T.tap(*MK.center(r))
            s.sleep(1.2)
        if s.js(MK.BTN_RECT_JS, "CONTINUE ANYWAY"):
            s.js("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /CONTINUE ANYWAY/.test(x.textContent)); if (b) b.click(); }")
            v.note("phones: CONTINUE ANYWAY needed a DOM click (the real tap did not dismiss it) - setup only")
        # HOW TO PLAY: GOT IT on-screen at every size
        got = {}
        for name, w, h in MK.PHONE_SIZES:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(1.0)
            got[name] = s.js(MK.BTN_RECT_JS, "^GOT IT$")
        if not any(got.values()):
            v.cnj("phones: HOW TO PLAY - GOT IT on-screen", "HOW TO PLAY was not up on the first visit")
        else:
            for name, w, h in MK.PHONE_SIZES:
                r = got[name]
                v.check("%s %dx%d: HOW TO PLAY's GOT IT is on-screen" % (name, w, h), bool(r) and MK.inside(r, w, h), r)
            s.page.set_viewport_size({"width": 915, "height": 412})
            s.sleep(0.8)
            r = s.js(MK.BTN_RECT_JS, "^GOT IT$")
            if r and MK.inside(r, 915, 412):
                T.tap(*MK.center(r))
                s.sleep(1.0)
                v.check("pixel7: ONE real tap on GOT IT closes HOW TO PLAY", not s.js(MK.BTN_RECT_JS, "^GOT IT$"), "")
            else:
                v.check("pixel7: ONE real tap on GOT IT closes HOW TO PLAY", False, "GOT IT is off-screen, it cannot be tapped (%s)" % r)
                s.js("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^GOT IT$/.test(x.textContent.trim())); if (b) b.click(); }")
        # menu layout
        for name, w, h in MK.PHONE_SIZES:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(1.0)
            lay = s.js(MK.LAYOUT_JS)
            v.check("%s %dx%d menu: 0 clipped, targets >= 44 px, fonts >= 12 px, no page scroll" % (name, w, h),
                    lay["nClipped"] == 0 and lay["nSmallTargets"] == 0 and lay["nSmallFonts"] == 0 and not lay["pageScrolls"],
                    {"clipped": lay["nClipped"], "smallTargets": lay["nSmallTargets"], "smallFonts": lay["nSmallFonts"], "scroll": lay["pageScrolls"],
                     "firstClipped": lay["clipped"][:3], "firstSmall": lay["smallTargets"][:3]})
        # in-match HUD
        s.page.set_viewport_size({"width": 915, "height": 412})
        s.start_match("standard", 7, "isla_viva", enter=True)
        s.land(120)
        s.step_frames(20, 1 / 60, render=False)
        for name, w, h in MK.PHONE_SIZES:
            s.page.set_viewport_size({"width": w, "height": h})
            s.sleep(1.0)
            s.step_frames(3, 1 / 60, render=False)
            lay = s.js(MK.LAYOUT_JS)
            ol = s.js(MK.OVERLAP_JS)
            v.check("%s %dx%d match HUD: 0 clipped, targets >= 44 px, fonts >= 12 px" % (name, w, h),
                    lay["nClipped"] == 0 and lay["nSmallTargets"] == 0 and lay["nSmallFonts"] == 0,
                    {"clipped": lay["nClipped"], "smallTargets": lay["nSmallTargets"], "smallFonts": lay["nSmallFonts"],
                     "firstClipped": lay["clipped"][:3], "firstSmallFont": lay["smallFonts"][:3]})
            v.check("%s %dx%d match HUD: 0 HUD text under a touch control / the control bar" % (name, w, h), not ol, ol[:6])
        v.info("touch layer mounted", s.js(MK.TOUCH_JS))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--only", choices=["desktop", "phones"], default=None)
    args = ap.parse_args()

    def body(v):
        if args.only in (None, "desktop"):
            desktop(v, args)
        if args.only in (None, "phones"):
            phones(v, args)
    return C.run_gate("layoutcheck", body, args)


if __name__ == "__main__":
    sys.exit(main())
