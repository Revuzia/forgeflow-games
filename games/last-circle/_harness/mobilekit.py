#!/usr/bin/env python
"""Shared touch + layout helpers for layoutcheck.py and mobile.py (ported from the mobile audit's
_spec/improve_2026-09/baseline/lc_mobile.py, itself patterned on games/dyefield/_harness/mobile.py).

  DEVICES     the phone / tablet list (landscape unless named *_port)
  Touch       REAL multi-touch through CDP Input.dispatchTouchEvent (pointer ids, simultaneous fingers)
  LAYOUT_JS   clipped text/controls, tap targets < 44 px, fonts < 12 px, page scroll
  OVERLAP_JS  HUD text that sits under a touch control or the portal control bar
  TOUCH_JS    what touch layer is mounted: lane L10's W.touch (contract C6) or the page-level game_controls.js overlay
"""
from __future__ import annotations

import time

ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
IPAD_UA = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
DEVICES = {
    "se": {"w": 667, "h": 375, "dpr": 2, "ua": IOS_UA, "ios": True},
    "iphone14": {"w": 852, "h": 393, "dpr": 3, "ua": IOS_UA, "ios": True},
    "pixel7": {"w": 915, "h": 412, "dpr": 2.625, "ua": ANDROID_UA},
    "ipad": {"w": 1180, "h": 820, "dpr": 2, "ua": IPAD_UA, "ios": True},
    "pixel7_port": {"w": 412, "h": 915, "dpr": 2.625, "ua": ANDROID_UA},
    "iphone14_port": {"w": 393, "h": 852, "dpr": 3, "ua": IOS_UA, "ios": True},
}
PHONE_SIZES = [("se", 667, 375), ("iphone14", 852, 393), ("pixel7", 915, 412), ("ipad", 1180, 820)]
IOS_INIT = "try { Object.defineProperty(Document.prototype, 'fullscreenEnabled', { configurable: true, get() { return false; } }); } catch (e) {}"
# Phones have no Pointer Lock (iOS Safari: no API; Chrome for Android: unsupported), but HEADLESS desktop Chrome grants it
# to an emulated phone: the 21:38 mobile run turned the camera 0.352 rad on a look drag only because a FIRE tap's
# synthetic mousedown had taken pointer lock (lockRequests 1) - the audit, without the lock, read dyaw 0. Emulate the
# phone: every request is counted (common.INIT_JS counters) and refused with a 'pointerlockerror', never granted.
PHONE_NO_LOCK = r"""(() => { try {
  Element.prototype.requestPointerLock = function () {
    window.__H_LOCKREQ__ = (window.__H_LOCKREQ__ || 0) + 1;
    if (window.__H_LOCK__) window.__H_LOCK__.requests++;
    setTimeout(() => { try { document.dispatchEvent(new Event('pointerlockerror')); } catch (e) {} }, 0);
    return undefined;
  };
} catch (e) {} })();"""

LAYOUT_JS = r"""
() => {
  const W = innerWidth, H = innerHeight;
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const ns = getComputedStyle(n);
    if (ns.display === 'none' || ns.visibility === 'hidden' || parseFloat(ns.opacity) === 0) return false; } return true; };
  const nm = (e) => { const t = (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30); return e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (t ? ' "' + t + '"' : ''); };
  const out = { W, H, clipped: [], smallTargets: [], smallFonts: [], scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight };
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('#__ffg_touch__') || e.closest('#__ff_controls__') || e.closest('[data-touch-ui]') || e.tagName === 'CANVAS' || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') continue;
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) continue;
    // an element entirely outside its nearest overflow-clipping ancestor is not visible (e.g. compass-tape ticks
    // scrolled out of the strip: the 22:05 phone run counted "N", "30", "NE" at x < 0 as clipped HUD text)
    let hiddenByClip = false;
    for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const s2 = getComputedStyle(n);
      if (s2.overflowX !== 'visible' || s2.overflowY !== 'visible') { const c = n.getBoundingClientRect();
        // only a SMALL on-screen clipping box (a compass strip, a scroller) hides content by design; content cut off by a
        // viewport-sized layer (the menu wordmark at top -423 px) is still a clipped-content defect
        const small = c.left >= -1 && c.top >= -1 && c.right <= W + 1 && c.bottom <= H + 1 && (c.width < W * 0.8 || c.height < H * 0.8);
        if (small && (r.right <= c.left + 1 || r.left >= c.right - 1 || r.bottom <= c.top + 1 || r.top >= c.bottom - 1)) hiddenByClip = true; break; } }
    if (hiddenByClip) continue;
    const ownText = Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    const clickable = e.tagName === 'BUTTON' || e.getAttribute('role') === 'button' || typeof e.onclick === 'function' || e.tagName === 'INPUT';
    // a node inside a scrollable panel is not clipped when it is scrolled out of the panel: judge the panel instead
    let sc = null; for (let n = e.parentElement; n && n !== document.body; n = n.parentElement) { const s = getComputedStyle(n); if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 2) { sc = n; break; } }
    const box = sc ? sc.getBoundingClientRect() : r;
    if ((ownText || clickable) && (box.left < -1 || box.top < -1 || box.right > W + 1 || box.bottom > H + 1))
      out.clipped.push({ el: nm(e), r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] });
    if (clickable && (r.width < 44 || r.height < 44)) out.smallTargets.push({ el: nm(e), w: Math.round(r.width), h: Math.round(r.height) });
    if (ownText) { const fs = parseFloat(getComputedStyle(e).fontSize); if (fs < 12) out.smallFonts.push({ el: nm(e), fs }); }
  }
  out.nClipped = out.clipped.length; out.nSmallTargets = out.smallTargets.length; out.nSmallFonts = out.smallFonts.length;
  out.clipped = out.clipped.slice(0, 25); out.smallTargets = out.smallTargets.slice(0, 25); out.smallFonts = out.smallFonts.slice(0, 25);
  out.pageScrolls = out.scrollW > W + 1 || out.scrollH > H + 1;
  return out;
}"""

TOUCH_JS = r"""
() => {
  const rr = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; };
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const W = window.__LC__ && window.__LC__.W;
  const o = { lcTouch: !!(W && W.touch), lcTouchActive: !!(W && W.touch && W.touch.active), pageOverlay: !!document.getElementById('__ffg_touch__'),
              pageOverlayActive: !!(window.FFG_TOUCH && FFG_TOUCH.isActive && FFG_TOUCH.isActive()), profile: window.FFG_TOUCH && FFG_TOUCH.config ? FFG_TOUCH.config.profile : null,
              controls: [] };
  // lane L10's own layer is expected to mark its controls with data-touch-ui (requested); the page overlay uses .ffgt-*
  for (const e of document.querySelectorAll('[data-touch-ui], #__ffg_touch__ .ffgt-stick, #__ffg_touch__ .ffgt-btn, #__ffg_touch__ .ffgt-look')) {
    if (!vis(e)) continue;
    o.controls.push({ cls: (e.getAttribute('data-touch-ui') || e.className || '').toString().slice(0, 40), label: (e.textContent || '').trim().slice(0, 12), r: rr(e) });
  }
  const bar = document.getElementById('__ff_controls__'); o.bar = bar && vis(bar) ? rr(bar) : null;
  return o;
}"""

OVERLAP_JS = r"""
() => {
  const ctl = [];
  for (const e of document.querySelectorAll('[data-touch-ui], #__ffg_touch__ .ffgt-stick, #__ffg_touch__ .ffgt-btn')) {
    const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') continue;
    ctl.push({ n: 'touch:' + ((e.textContent || '').trim() || e.getAttribute('data-touch-ui') || 'stick'), r: e.getBoundingClientRect() });
  }
  const bar = document.getElementById('__ff_controls__'); if (bar) ctl.push({ n: 'controlbar', r: bar.getBoundingClientRect() });
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const hits = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.closest('#__ffg_touch__') || e.closest('#__ff_controls__') || e.closest('[data-touch-ui]') || e.id === 'lc-splash') continue;
    if (!(e.tagName === 'CANVAS' || Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))) continue;
    if (e.tagName === 'CANVAS' && e.parentElement && e.parentElement.id === 'game-container') continue;
    if (e.tagName === 'CANVAS' && e.width > 1500) continue;
    if (!vis(e)) continue;
    const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    for (const c of ctl) {
      const ix = Math.min(r.right, c.r.right) - Math.max(r.left, c.r.left), iy = Math.min(r.bottom, c.r.bottom) - Math.max(r.top, c.r.top);
      if (ix > 2 && iy > 2) hits.push({ hud: e.tagName.toLowerCase() + ' "' + (e.textContent || '').trim().slice(0, 24) + '"', ctl: c.n, area: Math.round(ix * iy) });
    }
  }
  return hits.slice(0, 40);
}"""

BTN_RECT_JS = r"""(re) => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && new RegExp(re, 'i').test((x.textContent || '').trim()));
  if (!b) return null; const r = b.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }"""


class Touch:
    """REAL touches: CDP Input.dispatchTouchEvent with stable ids per finger."""

    def __init__(self, cdp, sleep=time.sleep):
        self.cdp, self.pts, self.sleep = cdp, {}, sleep

    def _send(self, typ):
        self.cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": [{"x": float(p[0]), "y": float(p[1]), "id": i} for i, p in sorted(self.pts.items())]})

    def down(self, pid, x, y):
        self.pts[pid] = (x, y)
        self._send("touchStart")

    def move(self, pid, x, y):
        self.pts[pid] = (x, y)
        self._send("touchMove")

    def up(self, pid):
        p = self.pts.pop(pid, None)
        if self.pts and p is not None:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [{"x": float(p[0]), "y": float(p[1]), "id": pid}]})
        elif not self.pts:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})

    def tap(self, x, y, pid=9, hold=0.08):
        self.down(pid, x, y)
        self.sleep(hold)
        self.up(pid)

    def drag(self, pid, x0, y0, dx, dy, steps=14, step_s=0.016):
        self.down(pid, x0, y0)
        for k in range(1, steps + 1):
            self.move(pid, x0 + dx * k / steps, y0 + dy * k / steps)
            self.sleep(step_s)
        self.up(pid)


def center(r):
    return ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)


def inside(r, w, h):
    return r[0] >= 0 and r[1] >= 0 and r[2] <= w and r[3] <= h


def phone_context(browser, dev, init_scripts=()):
    spec = DEVICES[dev]
    ctx = browser.new_context(viewport={"width": spec["w"], "height": spec["h"]}, device_scale_factor=spec["dpr"],
                              is_mobile=True, has_touch=True, user_agent=spec["ua"])
    if spec.get("ios"):
        ctx.add_init_script(IOS_INIT)
    for s in init_scripts:
        ctx.add_init_script(s)
    return ctx
