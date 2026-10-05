#!/usr/bin/env python
"""DYEFIELD — PLAY ONLINE screens gate (LOBBY-UI, CONTRACT_ONLINE §O12.3): every online screen in the mock states, on the
desktop and the M0 phone / tablet viewports, driven by real input; HEADLESS only.

The game page is the real one (the live lobby backdrop, the real menus, the real touch mode: ?touch=1 on the touch
devices, CONTRACT_MOBILE M1). The online UI mounts into it the way main.ts will mount it, through the dev-only module
runtime/src/net/ui/dev.ts (`await import('/src/net/ui/dev.ts')` in the page — Vite serves it on demand; nothing in the
game imports it) against runtime/src/net/ui/mock.ts (SYNC's OnlineApi stand-in, §O11.1). Every screen is checked with
layoutcheck.py's LAYOUT_JS (clip / safe area / overlap / 44 px targets / 12-14 px type in touch mode / the page never
scrolls / panels scroll inside themselves) plus this gate's own block check (the active online screen's top-level blocks
do not overlap each other or leave the safe viewport; the in-match overlays clear the HUD blocks and the touch buttons).

Per device:
  title        the real title: the stack's labels (PLAY, PLAY ONLINE, LOADOUT, SETTINGS, HOW TO PLAY, CREDITS), PLAY ONLINE
               beside PLAY (same row), ↓ from PLAY still lands on LOADOUT (kbm); with no online hook wired yet the tile
               shows disabled and a press explains why.
  home         PLAY ONLINE; MODE / RULE by real taps / clicks (written to the profile), back to TEAMS · TURF.
  join_*       JOIN ROOM: empty (JOIN disabled) → K 7 Q X by the on-screen keypad (touch / pad) or the keyboard (kbm) →
               JOIN enabled; touch: a tap on the code field focuses it (the phone keyboard) and the card still fits a
               viewport cut to 45 % height (the keyboard up, interactive-widget=resizes-content).
  room_*       a joined room (guest: read-only setup, no START, no KICK) → LEAVE; CREATE ROOM (owner, alone: START
               disabled + the share line) → a guest joins (toast) → START enabled; owner MODE / ARENA changes; KICK (two
               presses) removes the guest; a full room of 8; START → the screens hide for the match (matchPhase
               'loading'); back to `room` (PLAY AGAIN) → the room screen again.
  search_*     QUICK MATCH: connecting → queue (N waiting + clock) → MATCH FOUND (members + countdown) → hidden for the match;
               solo: NO ONE ELSE YET → KEEP WAITING → PLAY VS BOTS (hooks.playOffline, the menus back).
  notice_*     every error / closed / kicked / voided card (§O3.3 codes); TRY AGAIN on not_found reopens JOIN with the code.
  hud_*        a deep-link match with the overlays attached: NET badge (+ HOST), feed, HIGH PING, HOST MIGRATING banner, the
               hold-TAB board (kbm), the MATCH MENU card (touch controls hidden under it) and its LEAVE confirm.
  post_*       the victory slate with the online controls in its card: quick REMATCH / LEAVE, owner PLAY AGAIN, guest wait.
  nav          (kbm devices) keyboard: arrows / Enter / Esc / typing through home → join → room → back; a synthetic gamepad
               (navigator.getGamepads replaced): d-pad / A / B; mouse hover moves focus.
Zero page errors and console errors on every device, else FAIL. Screenshots: _shots/online/<device>_<step>.png.
Report: _harness/_reports/netlobby.json. Verdict: NETLOBBY OK / NETLOBBY FAIL.

Run:  python _harness/netlobby.py --headless                       (all devices; dev server :5223, started if down)
      python _harness/netlobby.py --headless --devices d720,se --steps lobby
      python _harness/netlobby.py --headless --base http://localhost:5224/
Wall-clock waits poll generously (the box is shared and often at 100 % CPU): a timing FAIL is re-judged by a rerun.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import FLAGS, SHOTS, HarnessError, ensure_server, save_report, stop_server  # noqa: E402
from layoutcheck import DEVICES as LC_DEVICES, IOS_UA, Dev, check_page  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:
        pass

DEFAULT_BASE = "http://localhost:5223/"
SHOT_DIR = os.path.join(SHOTS, "online")
DEVICES = dict(LC_DEVICES)
# CONTRACT_MOBILE M0's fourth phone: the iPhone 14 at 844 × 390 (a notch: 47 / 47 side insets, 21 home indicator)
DEVICES["iphone14s"] = {"w": 844, "h": 390, "dpr": 3, "mobile": True, "ua": IOS_UA, "safe": (47, 0, 47, 21), "ios": True}
ALL_DEVICES = ["d720", "d900", "se", "iphone14s", "iphone14", "pixel7", "tab10", "ipad"]
STEP_GROUPS = ["title", "lobby", "notices", "nav", "match"]
MENU_LABELS = ["PLAY", "PLAY ONLINE", "LOADOUT", "SETTINGS", "HOW TO PLAY", "CREDITS"]
NOTICE_KINDS = ["room_full", "not_found", "busy", "build", "proto", "quota", "rate", "origin", "bad", "network", "unsupported", "kicked", "closed", "voided", "court"]

# ─────────────────────────────── the gate's own block check (runs in the page) ───────────────────────────────
ONLINE_JS = r"""
(opt) => {
  opt = opt || {};
  const D = document, W = innerWidth, H = innerHeight;
  const pr = D.createElement('div');
  pr.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;'
    + 'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  D.body.appendChild(pr);
  const pcs = getComputedStyle(pr);
  const safe = { t: parseFloat(pcs.paddingTop) || 0, r: parseFloat(pcs.paddingRight) || 0, b: parseFloat(pcs.paddingBottom) || 0, l: parseFloat(pcs.paddingLeft) || 0 };
  pr.remove();
  const SB = { l: safe.l, t: safe.t, r: W - safe.r, b: H - safe.b };
  const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const rnd = (q) => q ? { l: Math.round(q.l), t: Math.round(q.t), r: Math.round(q.r), b: Math.round(q.b) } : null;
  const name = (e) => { if (e.id) return '#' + e.id; const c = (typeof e.className === 'string' ? e.className : '').trim().split(/\s+/).slice(0, 2).join('.'); return e.tagName.toLowerCase() + (c ? '.' + c : ''); };
  const shown = (e) => {
    if (!e || e.closest('[hidden]')) return false;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n); if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) < 0.05) return false; }
    const r = e.getBoundingClientRect(); return r.width >= 2 && r.height >= 2;
  };
  const overlap = (a, b, px) => (Math.min(a.r, b.r) - Math.max(a.l, b.l)) > px && (Math.min(a.b, b.b) - Math.max(a.t, b.t)) > px;
  const isScroller = (n, s) => /(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 1;
  const effective = (e) => {
    let q = R(e), state = 'ok';
    for (let n = e.parentElement; n && n !== D.body; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const c = R(n);
      const l = Math.max(q.l, c.l), t = Math.max(q.t, c.t), r = Math.min(q.r, c.r), b = Math.min(q.b, c.b);
      if (r <= l || b <= t) { if (isScroller(n, s)) return { rect: q, state: 'scrolled' }; return { rect: q, state: 'clipped' }; }
      if ((r - l) * (b - t) + 0.5 < (q.r - q.l) * (q.b - q.t)) { q = { l, t, r, b }; if (!isScroller(n, s)) state = 'clipped'; }
    }
    return { rect: q, state };
  };
  const problems = [];
  const P = (kind, msg, data) => problems.push({ kind, msg, ...(data ? { data } : {}) });
  const inSafe = (q) => q.l >= SB.l - 1 && q.t >= SB.t - 1 && q.r <= SB.r + 1 && q.b <= SB.b + 1;
  const out = { screen: null, blocks: [], overlays: [] };
  // 1) the active online screen's top-level blocks
  const scr = D.querySelector('#df-online:not([hidden]) .dfo-screen:not([hidden])');
  if (scr) {
    out.screen = scr.dataset.screen;
    let kids = [];
    const head = scr.querySelector(':scope > .dfo-head'); if (head) kids.push(head);
    const body = scr.querySelector(':scope > .dfo-body');
    if (body) for (const k of body.children) {
      if (k.classList.contains('dfo-setup') || k.classList.contains('dfo-doors')) kids.push(...k.children); else kids.push(k);
    }
    for (const c of scr.querySelectorAll(':scope > .dfo-searchcard, :scope > .dfo-noticecard')) kids.push(c);
    const hints = D.querySelector('#df-online .dfo-hints'); if (hints && shown(hints)) kids.push(hints);
    kids = kids.filter(shown);
    const bs = kids.map((k) => ({ id: name(k), e: k, ...effective(k) })).filter((b) => b.state !== 'scrolled');
    out.blocks = bs.map((b) => ({ id: b.id, rect: rnd(b.rect), state: b.state }));
    for (const b of bs) {
      if (b.state === 'clipped') P('clip', 'online block ' + b.id + ' is cut by a box that does not scroll', rnd(b.rect));
      else if (!inSafe(b.rect)) P('safe', 'online block ' + b.id + ' leaves the safe viewport', rnd(b.rect));
    }
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
      if (bs[i].e.contains(bs[j].e) || bs[j].e.contains(bs[i].e)) continue;
      if (overlap(bs[i].rect, bs[j].rect, 2)) P('overlap', 'online blocks ' + bs[i].id + ' x ' + bs[j].id, [rnd(bs[i].rect), rnd(bs[j].rect)]);
    }
    // the page never scrolls, and the screen itself only inside (overscroll contained)
    const se = D.scrollingElement || D.documentElement;
    if (se.scrollTop || se.scrollLeft || se.scrollHeight > H + 1 || se.scrollWidth > W + 1) P('scroll', 'the page scrolls', { top: se.scrollTop, sh: se.scrollHeight, sw: se.scrollWidth });
  }
  // 2) the in-match overlays: inside the safe viewport; the passive ones (badge, feed, banner, board) clear the HUD blocks
  //    and the touch buttons; the menu card / confirm are modal (the touch overlay must be hidden under them)
  const hudRoot = D.querySelector('#df-online-hud:not([hidden])');
  if (hudRoot) {
    const passive = [...hudRoot.querySelectorAll(':scope > .dfo-net, :scope > .dfo-banner, :scope > .dfo-feed > .dfo-feeditem')].filter(shown);
    // the MATCH MENU card / its confirm are modal; the PLAYERS board is a held full overlay (TAB) over the centre, like any
    // scoreboard: both are judged for the safe viewport only (the card must also hide the touch controls under it)
    const modal = [...hudRoot.querySelectorAll('.dfo-menucard, .dfo-confirm .dfm-confirm-card, :scope > .dfo-post.floating, :scope > .dfo-board')].filter(shown);
    const hud = D.querySelector('.df-hud.on');
    const hb = hud ? [...hud.querySelectorAll(':scope > .df-top, :scope > .df-mini, :scope > .df-ffa-panel, :scope > .df-toast, .df-right > .df-gauge, .df-feed-item, :scope > .df-tank, :scope > .df-tank-label, :scope > .df-sub, :scope > .df-protect, :scope > .df-spprompt')].filter(shown) : [];
    let tb = [];
    try { const t = window.__DF__ && window.__DF__.touch && window.__DF__.touch(); if (t && t.visible && Array.isArray(t.buttons)) tb = t.buttons.map((b) => ({ id: 'touch:' + b.id, rect: { l: b.rect.x ?? b.rect.left, t: b.rect.y ?? b.rect.top, r: (b.rect.x ?? b.rect.left) + (b.rect.w ?? b.rect.width), b: (b.rect.y ?? b.rect.top) + (b.rect.h ?? b.rect.height) } })); } catch (e) { tb = []; }
    const touchEl = D.getElementById('df-touch');
    const touchShown = !!touchEl && shown(touchEl);
    for (const e of passive) {
      const q = R(e);
      out.overlays.push({ id: name(e), rect: rnd(q) });
      if (!inSafe(q)) P('safe', 'overlay ' + name(e) + ' leaves the safe viewport', rnd(q));
      for (const h of hb) if (overlap(q, R(h), 2)) P('overlap', 'overlay ' + name(e) + ' x HUD ' + name(h), [rnd(q), rnd(R(h))]);
      if (touchShown) for (const b of tb) if (overlap(q, b.rect, 2)) P('zone', 'overlay ' + name(e) + ' x ' + b.id, [rnd(q), rnd(b.rect)]);
    }
    for (const e of modal) {
      const q = R(e);
      out.overlays.push({ id: name(e), rect: rnd(q), modal: true });
      if (!inSafe(q)) P('safe', 'card ' + name(e) + ' leaves the safe viewport', rnd(q));
      if (!e.classList.contains('floating') && !e.classList.contains('dfo-board') && touchShown) P('modal', 'the touch controls stay visible under ' + name(e));
    }
    out.touchShown = touchShown;
  }
  out.problems = problems;
  return out;
}
"""

READ = "() => window.__DFO__ ? window.__DFO__.state() : null"


class Gate:
    def __init__(self, d: Dev, key: str, args):
        self.d, self.key, self.args = d, key, args
        self.problems: list[str] = []
        self.steps: dict = {}
        self.notes: list[str] = []

    # ── helpers
    def fail(self, msg):
        self.problems.append(msg)
        print("  !! %s" % msg)

    def ok(self, cond, msg):
        if not cond:
            self.fail(msg)
        return bool(cond)

    def js(self, expr, arg=None):
        return self.d.js(expr, arg)

    def st(self):
        return self.js(READ) or {}

    def scr(self):
        return (self.st().get("screens") or {})

    def wait(self, fn, timeout=12.0, poll=0.1):
        t0 = time.time()
        while time.time() - t0 < timeout:
            v = fn()
            if v:
                return v
            time.sleep(poll)
        return None

    def wait_screen(self, screen, timeout=12.0, extra=None):
        def f():
            s = self.scr()
            if s.get("screen") == screen and (extra is None or extra(s)):
                return s
            return None
        r = self.wait(f, timeout)
        if not r:
            self.fail("%s: never reached the %s screen (now %s)" % (self.key, screen, json.dumps(self.scr())[:300]))
        return r

    def tap(self, sel, settle=0.3):
        """a press at the element's centre, by coordinates: a real touch (touch devices) or mouse move + click. Playwright's own
        locator.tap() was dropped here: on a box at 100 % CPU its stability / "navigations finished" waits time out AFTER the
        touch was dispatched, so a retry double-pressed (a keypad '7' typed twice). Before the press the element must be
        there, still, and the topmost thing at that point (the same "receives events" idea, judged in the page)."""
        pg = self.d.page
        loc = pg.locator(sel).first
        try:
            loc.scroll_into_view_if_needed(timeout=8000)
        except Exception:
            pass
        last = None
        t0 = time.time()
        b = None
        while time.time() - t0 < 25:
            try:
                b1 = loc.bounding_box(timeout=5000)
                time.sleep(0.12)
                b2 = loc.bounding_box(timeout=5000)
            except Exception:
                b1 = b2 = None
            if b1 and b2 and b1["width"] > 1 and b1["height"] > 1 and abs(b1["x"] - b2["x"]) < 8 and abs(b1["y"] - b2["y"]) < 8:   # (8 px: an enabled START bobs forever)
                x, y = b2["x"] + b2["width"] / 2, b2["y"] + b2["height"] / 2
                hit = self.js("([s, x, y]) => { const e = document.querySelector(s); const t = document.elementFromPoint(x, y); return !!e && !!t && (t === e || e.contains(t)); }", [sel, x, y])
                if hit:
                    b = b2
                    break
                last = "something else is on top at (%d, %d)" % (x, y)
            else:
                last = "not settled / not there"
            time.sleep(0.3)
        if not b:
            self.fail("%s: could not press %s (%s)" % (self.key, sel, last))
            return False
        x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        if self.d.touch:
            pg.touchscreen.tap(x, y)
        else:
            pg.mouse.move(x, y)
            pg.mouse.click(x, y)
        time.sleep(settle)
        return True

    def shot(self, step):
        os.makedirs(SHOT_DIR, exist_ok=True)
        path = os.path.join(SHOT_DIR, "%s_%s.png" % (self.key, step))
        try:
            self.d.page.screenshot(path=path, scale="css", timeout=20_000)
            return os.path.relpath(path, os.path.dirname(SHOTS)).replace("\\", "/")
        except Exception as e:
            self.notes.append("screenshot %s: %s" % (step, str(e).splitlines()[0][:160]))
            return None

    def record(self, step, extra=None, ignore_touch=False, shot=True):
        r = {"problems": []}
        for _ in range(2):
            try:
                lc = check_page(self.d.page, "%s/%s" % (self.key, step))
                on = self.d.page.evaluate(ONLINE_JS, {})
                probs = list(lc.get("problems") or []) + list(on.get("problems") or [])
                if ignore_touch:
                    # a modal card is up: the touch controls hide under it (ONLINE_JS asserts that); LAYOUT_JS still reads
                    # their rects from __DF__.touch() and would pair them with the card's buttons
                    probs = [p for p in probs if "touch:" not in p.get("msg", "")]
                r = {"problems": probs, "online": {k: on.get(k) for k in ("screen", "blocks", "overlays", "touchShown")},
                     "touch": lc.get("touch"), "controls": lc.get("controls"), "fontInfo": (lc.get("fontInfo") or [])[:6]}
                break
            except Exception as e:
                r = {"problems": [{"kind": "flow", "msg": "read-back failed: %s" % str(e).splitlines()[0][:160]}]}
                time.sleep(1.0)
        if extra:
            r.update(extra)
        r["state"] = self.st()
        if shot:
            r["shot"] = self.shot(step)
        self.steps[step] = r
        n = len(r["problems"])
        print("  %-22s %s%s" % (step, "ok" if n == 0 else "%d problem(s)" % n, "" if n == 0 else ": " + "; ".join(p["msg"] for p in r["problems"][:4])))
        for p in r["problems"]:
            self.problems.append("%s/%s: %s" % (self.key, step, p["msg"]))
        return r

    def mock(self, expr):
        return self.js("() => { const x = window.__DFO__; const m = x.mock; %s }" % expr)

    def mount(self, speed=0.25):
        r = self.js("async () => { const m = await import('/src/net/ui/dev.ts'); m.mountDev({ mock: { speed: %s } }); return !!window.__DFO__; }" % speed)
        if r is not True:
            self.fail("%s: the dev mount failed (%s)" % (self.key, r))
            return False
        return True

    def hooks(self):
        return self.js("() => window.__DFO__ ? window.__DFO__.log.map((l) => l.hook + (l.a && l.a.length ? ':' + l.a.map(String).join(',') : '')) : []") or []

    def type_text(self, text):
        self.d.page.keyboard.type(text, delay=40)
        time.sleep(0.25)

    def press(self, k, settle=0.25):
        self.d.page.keyboard.press(k)
        time.sleep(settle)

    def tapxy(self, sel, settle=0.3):
        """a press at the element's centre with no actionability wait: for a control Playwright never calls 'stable' (START
        bobs forever, like the menus' START) or 'enabled' (the PLAY ONLINE tile is aria-disabled but pressable, by design)"""
        try:
            b = self.d.page.locator(sel).first.bounding_box(timeout=8000)
        except Exception as e:
            b = None
        if not b:
            self.fail("%s: no %s to press" % (self.key, sel))
            return False
        x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
        if self.d.touch:
            self.d.page.touchscreen.tap(x, y)
        else:
            self.d.page.mouse.move(x, y)
            self.d.page.mouse.click(x, y)
        time.sleep(settle)
        return True


# ─────────────────────────────── steps ───────────────────────────────
def boot_lobby(g: Gate) -> bool:
    d = g.d
    d.goto()
    ok = d.wait("() => (window.__DF__ && window.__DF__.state && window.__DF__.state().phase === 'menu') || null", 150)
    if not ok:
        g.fail("%s: the lobby never reached phase 'menu' (%s)" % (g.key, d.js("() => window.__DF__ && window.__DF__.state && window.__DF__.state().phase")))
        return False
    g.steps["touchMode"] = d.ensure_touch()
    time.sleep(1.0)
    return True


def step_title(g: Gate):
    d = g.d
    print(" title")
    labels = g.js("() => [...document.querySelectorAll('.dfm-stack .dfm-item .lbl')].map((e) => e.textContent)")
    g.ok(labels == MENU_LABELS, "%s: title stack labels %s (want %s)" % (g.key, labels, MENU_LABELS))
    row = g.js("""() => { const p = document.getElementById('dfm-play'), o = document.getElementById('dfm-play-online');
      if (!p || !o) return null; const a = p.getBoundingClientRect(), b = o.getBoundingClientRect();
      return { sameRow: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 4 && Math.abs(a.height - b.height) < 6, gap: b.left - a.right, playW: a.width, onlineW: b.width, h: b.height,
        touch: document.documentElement.classList.contains('df-touch'), disabledAttr: o.disabled, aria: o.getAttribute('aria-disabled'), title: o.title }; }""")
    g.ok(isinstance(row, dict) and row.get("sameRow") and row.get("gap", 0) >= 2, "%s: PLAY ONLINE is not beside PLAY in one row (%s)" % (g.key, row))
    menu = g.js("() => window.__DF__.menu()") or {}
    online = menu.get("online") or {}
    # the page is either UNWIRED (no hooks.online: the tile is disabled with its reason) or WIRED (main.ts passes online: the
    # tile is enabled and a press opens the real screens). Both are judged; the real screens are checked at the end of this step
    wired_page = online.get("enabled") is True
    g.steps["pageWired"] = wired_page
    if wired_page:
        g.ok(not online.get("why"), "%s: the wired PLAY ONLINE tile still carries a reason (%s)" % (g.key, online))
    else:
        g.ok(online.get("enabled") is False and "isn’t available" in (online.get("why") or ""),
             "%s: the unwired PLAY ONLINE tile should be disabled with its reason (%s)" % (g.key, online))
    if not d.touch:
        # the menus' ↓ from PLAY still goes to LOADOUT (menus.py's keyboard / pad legs)
        for _ in range(6):
            if (g.js("() => window.__DF__.menu().focus") == "dfm-play"):
                break
            g.press("ArrowUp", 0.15)
        g.press("ArrowDown")
        f1 = g.js("() => window.__DF__.menu().focus")
        g.press("ArrowUp")
        f2 = g.js("() => window.__DF__.menu().focus")
        g.press("ArrowRight")
        f3 = g.js("() => window.__DF__.menu().focus")
        g.press("ArrowLeft")
        f4 = g.js("() => window.__DF__.menu().focus")
        g.steps["titleNav"] = [f1, f2, f3, f4]
        g.ok(f1 == "dfm-loadout" and f2 == "dfm-play", "%s: ↓ / ↑ from PLAY went %s → %s (want dfm-loadout → dfm-play)" % (g.key, f1, f2))
        g.ok(f3 == "dfm-play-online" and f4 == "dfm-play", "%s: → / ← from PLAY went %s → %s (want dfm-play-online → dfm-play)" % (g.key, f3, f4))
    g.record("title", {"row": row, "online": online})
    # the WIRED tile (what main.ts will pass, CONTRACT_ONLINE §O11.2): a second Menus from the same module, with an
    # online() hook, over the page's own (hidden for the check) — enabled look, a press calls the hook, and
    # returnFromOnline() brings the title back with the tile focused
    wired = g.js("""async () => {
      const M = await import('/src/ui/menus.ts');
      const S = await import('/src/ui/settings.ts');
      const D = await import('/src/core/data.ts');
      const orig = document.getElementById('df-menus');
      orig.hidden = true;
      const host = document.createElement('div');
      host.id = 'netlobby-wired';
      host.style.cssText = 'position:absolute;inset:0;';
      (document.getElementById('ui') || document.body).append(host);
      let calls = 0;
      const m = new M.Menus(host, { hooks: { start() {}, resume() {}, quitMatch() {}, online() { calls++; } },
        settings: new S.SettingsStore(), profile: new S.ProfileStore(D.WEAPONS.kits.map((k) => k.id), D.playableMaps().map((x) => x.id)),
        input: { suspended: false, releaseAll() {} } });
      m.showTitle();
      window.__NLW__ = { m, host, orig, calls: () => calls };
      const t = host.querySelector('#dfm-play-online');
      return { enabled: m.readback().online.enabled, off: t.classList.contains('off'), aria: t.getAttribute('aria-disabled') };
    }""")
    g.ok(isinstance(wired, dict) and wired.get("enabled") is True and wired.get("off") is False and wired.get("aria") == "false",
         "%s: with the online hook wired the tile is not enabled (%s)" % (g.key, wired))
    g.shot("title_wired")
    g.tap("#netlobby-wired #dfm-play-online", 0.3)
    after = g.js("() => { const w = window.__NLW__; const n = w.calls(); w.m.hideAll(); w.m.returnFromOnline(); const r = w.m.readback(); return { calls: n, focus: r.focus, screen: r.screen }; }")
    g.ok(isinstance(after, dict) and after.get("calls") == 1 and after.get("screen") == "title" and (d.touch or after.get("focus") == "dfm-play-online"),
         "%s: the wired PLAY ONLINE press / returnFromOnline (%s)" % (g.key, after))
    g.steps["titleWired"] = {"tile": wired, "after": after}
    g.js("() => { const w = window.__NLW__; w.m.dispose(); w.host.remove(); w.orig.hidden = false; delete window.__NLW__; }")
    g.tapxy("#dfm-play-online", 0.3)
    if not wired_page:
        note = (g.js("() => window.__DF__.menu().online") or {}).get("note")
        g.ok(bool(note) and "available" in note, "%s: a press on the disabled PLAY ONLINE tile did not explain why (%s)" % (g.key, note))
        g.record("title_why", {"note": note}, shot=g.key in ("d720", "se"))
        return
    # WIRED page (main.ts's real online controller): the press lazy-loads net/ui and opens PLAY ONLINE over the lobby; BACK
    # returns to the title with the tile focused. The real controller is then thrown away with a reload so the mock steps
    # (which mount their own screens) never meet a second #df-online
    opened = g.wait(lambda: (g.js("() => { const r = document.querySelector('#df-online'); const s = r && !r.hidden && r.querySelector('.dfo-screen:not([hidden])'); return s ? s.dataset.screen : null; }") == "home") or None, 60)
    g.ok(bool(opened), "%s: the wired PLAY ONLINE tile did not open the PLAY ONLINE screen" % g.key)
    if opened:
        g.ok(g.js("() => document.getElementById('df-menus').hidden") is True, "%s: the title stayed up behind the real PLAY ONLINE screen" % g.key)
        g.record("title_wired_open", shot=g.key in ("d720", "se"))
        g.tap(".dfo-s-home .dfm-back", 0.4)
        back = g.wait(lambda: g.js("() => { const m = document.getElementById('df-menus'); const t = document.getElementById('dfm-play-online'); const r = document.querySelector('#df-online'); return m && !m.hidden && (!r || r.hidden) && (document.activeElement === t || %s) ? true : null; }" % ("true" if d.touch else "false")) or None, 20)
        g.ok(bool(back), "%s: BACK from the real PLAY ONLINE did not return to the title with the tile focused" % g.key)
    boot_lobby(g)


def step_lobby(g: Gate):
    d = g.d
    print(" lobby screens")
    if not g.mount():
        return
    g.js("() => window.__DFO__.open()")
    s = g.wait_screen("home")
    if not s:
        return
    g.ok(g.js("() => document.getElementById('df-menus').hidden") is True, "%s: the menus stayed up behind PLAY ONLINE" % g.key)
    g.record("home")
    # MODE / RULE: written to the profile (localStorage dyefield.profile.v1)
    g.tap("#dfo-mode-ffa")
    g.tap("#dfo-rule-washout")
    prof = g.js("() => { try { return JSON.parse(localStorage.getItem('dyefield.profile.v1') || '{}'); } catch (e) { return null; } }") or {}
    chk = g.js("() => ({ ffa: document.getElementById('dfo-mode-ffa').getAttribute('aria-checked'), wo: document.getElementById('dfo-rule-washout').getAttribute('aria-checked'), note: document.querySelector('.dfo-rulenote').textContent })")
    g.ok(prof.get("mode") == "ffa" and prof.get("rule") == "washout" and chk.get("ffa") == "true" and chk.get("wo") == "true" and chk.get("note") == "Most washes wins",
         "%s: MODE / RULE picks did not stick (profile %s, ui %s)" % (g.key, {k: prof.get(k) for k in ("mode", "rule")}, chk))
    g.record("home_ffa_washout", shot=g.key in ("d720", "se", "iphone14"))
    # REDUCE MOTION (SETTINGS → ACCESSIBILITY) reaches the online UI: the bobbing / hopping stops
    rm0 = g.js("() => { const s = window.__DFO__.settings; const was = s.get().reduceMotion; s.set({ reduceMotion: true }); const on = document.getElementById('df-online').classList.contains('rm'); s.set({ reduceMotion: false }); const off = !document.getElementById('df-online').classList.contains('rm'); s.set({ reduceMotion: was }); return { on, off }; }")
    g.ok(rm0 == {"on": True, "off": True}, "%s: REDUCE MOTION did not reach the online screens (%s)" % (g.key, rm0))
    g.tap("#dfo-mode-teams")
    g.tap("#dfo-rule-turf")

    # JOIN ROOM
    g.tap("#dfo-door-join")
    s = g.wait_screen("join")
    if s:
        g.ok(s.get("joinEnabled") is False, "%s: JOIN is enabled with an empty code (%s)" % (g.key, s.get("code")))
        g.record("join_empty", shot=g.key in ("d720", "se"))
        if d.touch:
            for ch in "K7QX":
                g.tap("#dfo-key-%s" % ch, 0.12)
        else:
            focus = s.get("focus")
            g.ok(focus == "dfo-code", "%s: JOIN ROOM did not focus the code field (focus %s)" % (g.key, focus))
            g.tap("#dfo-code", 0.2)
            g.type_text("k7-qx")         # lower case + a stray '-' : upper-cased, filtered
        s = g.scr()
        g.ok(s.get("code") == "K7QX" and s.get("joinEnabled") is True, "%s: the code field reads %r (JOIN enabled %s), want 'K7QX'" % (g.key, s.get("code"), s.get("joinEnabled")))
        g.record("join_typed")
        if d.touch:
            # the phone keyboard: a tap on the field focuses the input; with the keyboard up the viewport shrinks
            g.js("() => { const i = document.getElementById('dfo-code'); i.value = ''; i.dispatchEvent(new Event('input')); }")
            g.tap(".dfo-codefield", 0.3)
            kb = g.js("() => ({ focus: document.activeElement && document.activeElement.id, kb: document.querySelector('.dfo-s-join').classList.contains('kb') })")
            g.ok(isinstance(kb, dict) and kb.get("focus") == "dfo-code" and kb.get("kb"), "%s: a tap on the code field did not focus it for the phone keyboard (%s)" % (g.key, kb))
            g.type_text("K7QX")
            spec = DEVICES[g.key]
            d.page.set_viewport_size({"width": spec["w"], "height": int(spec["h"] * 0.45)})
            time.sleep(0.5)
            g.record("join_keyboard_up", {"kb": kb})
            vis = g.js("() => { const b = document.getElementById('dfo-join-go').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, H: innerHeight }; }")
            g.ok(isinstance(vis, dict) and vis["bottom"] <= vis["H"] + 1 and vis["top"] >= 0, "%s: JOIN is off screen with the keyboard up (%s)" % (g.key, vis))
            d.page.set_viewport_size({"width": spec["w"], "height": spec["h"]})
            time.sleep(0.4)
        # JOIN → connecting → a room someone else owns
        g.tap("#dfo-join-go", 0.2)
        s = g.wait_screen("room", extra=lambda x: bool(x.get("room")))
        if s:
            room = s.get("room") or {}
            g.ok(room.get("owner") is False and room.get("start", {}).get("shown") is False, "%s: a guest sees owner controls (%s)" % (g.key, room))
            kick = g.js("() => [...document.querySelectorAll('.dfo-kick')].filter((b) => !b.closest('[hidden]') && b.getBoundingClientRect().width > 0).length")
            g.ok(kick == 0, "%s: a guest sees %s KICK buttons" % (g.key, kick))
            g.record("room_guest")
            g.tap(".dfo-s-room .dfm-back", 0.3)
            g.wait_screen("home")

    # CREATE ROOM (owner)
    g.tap("#dfo-door-create")
    s = g.wait_screen("room", extra=lambda x: bool(x.get("room")))
    if s:
        room = s.get("room") or {}
        g.ok(room.get("owner") is True and room.get("start") == {"shown": True, "enabled": False}, "%s: a lone owner's START should show disabled (%s)" % (g.key, room))
        g.record("room_owner1")
        s2 = g.wait(lambda: (g.scr().get("room") or {}).get("start", {}).get("enabled") and g.scr(), 10)
        g.ok(bool(s2), "%s: START did not enable when a guest joined (%s)" % (g.key, g.scr().get("room")))
        toasts = g.scr().get("toastLog") or []          # the log: a toast lives 2.6 s, a loaded box can poll past it
        g.ok(any("joined" in (t or "") for t in toasts), "%s: no 'joined' toast (%s)" % (g.key, toasts))
        g.record("room_owner2", shot=g.key in ("d720", "se", "iphone14"))
        # owner config by real presses (the mock applies configure)
        g.tap("#dfo-rmode-ffa")
        g.tap("#dfo-rmap-lockwell")
        cfg = g.js("() => ({ ffa: document.getElementById('dfo-rmode-ffa').getAttribute('aria-checked'), lw: document.getElementById('dfo-rmap-lockwell').getAttribute('aria-checked'), tod: !document.querySelector('.dfo-roomsetup [data-opt=preset] .dfo-seg').closest('[hidden]'), light: document.querySelector('.dfo-light').textContent })")
        g.ok(isinstance(cfg, dict) and cfg.get("ffa") == "true" and cfg.get("lw") == "true" and not cfg.get("tod") and cfg.get("light") == "INTERIOR LIGHTS",
             "%s: owner MODE / ARENA picks did not apply (%s)" % (g.key, cfg))
        g.record("room_owner_cfg", {"cfg": cfg}, shot=g.key in ("d720", "se"))
        g.tap("#dfo-rmode-teams")
        # KICK the guest: two presses (KICK → SURE?)
        # (the armed state lasts 3 s; on a box at 100 % CPU the second press can arrive after it lapsed, which re-arms: so a
        # lapsed arm is pressed again, up to two more times — the first press must never kick by itself)
        g.tap("#dfo-kick-1", 0.05)
        armed = g.js("() => document.getElementById('dfo-kick-1').textContent")
        seats1 = (g.scr().get("room") or {}).get("seats") or []
        seats = seats1
        for _ in range(3):
            g.tapxy("#dfo-kick-1", 0.3)          # no pre-checks between the two presses: the arm lapses after 3 s
            seats = (g.scr().get("room") or {}).get("seats") or []
            if len(seats) == 8 and seats[1] == "BOT":
                break
        g.ok(armed == "SURE?" and seats1[1:2] != ["BOT"] and len(seats) == 8 and seats[1] == "BOT",
             "%s: KICK (armed %r, after one press %s) did not empty seat 2 (%s)" % (g.key, armed, seats1[:3], seats))
        # a full room of 8 (the densest seat list)
        g.mock("m.set({ kind: 'room', room: m.room({ humans: 8, map: 'pier18' }) });")
        time.sleep(0.4)
        g.record("room_owner8")
        # COLORBLIND MARKS (html.df-cb) swap the GULF CREW chip to its colorblind dye
        cb = g.js("() => { const mk = () => getComputedStyle(document.querySelector('.dfo-seat[data-slot=\"1\"] .mk')).backgroundColor; const a = mk(); document.documentElement.classList.add('df-cb'); const m = window.__DFO__.mock; m.set({ kind: 'room', room: m.room({ humans: 8, map: 'pier18' }) }); const b = mk(); document.documentElement.classList.remove('df-cb'); m.set({ kind: 'room', room: m.room({ humans: 8, map: 'pier18' }) }); return { plain: a, cb: b }; }")
        g.ok(isinstance(cb, dict) and cb.get("plain") != cb.get("cb"), "%s: COLORBLIND MARKS did not change the GULF CREW seat chip (%s)" % (g.key, cb))
        # START → the screens hide for the match; PLAY AGAIN (back to `room`) → the room screen again
        g.tapxy("#dfo-start", 0.4)
        hid = g.wait(lambda: (g.scr().get("matchHidden") and not g.scr().get("visible")) and g.scr(), 6)
        g.ok(bool(hid), "%s: START did not hide the screens for the match (%s)" % (g.key, g.scr()))
        g.ok(any(h.startswith("matchPhase:loading") for h in g.hooks()), "%s: no matchPhase('loading') hook (%s)" % (g.key, g.hooks()[-6:]))
        g.mock("const r = m.status().room; m.set({ kind: 'room', room: Object.assign({}, r, { phase: 'room' }) });")
        s = g.wait_screen("room", 6)
        g.ok(any(h == "matchPhase:null,K7QX" for h in g.hooks()), "%s: no matchPhase(null) when the room came back (%s)" % (g.key, g.hooks()[-6:]))
        g.tap(".dfo-s-room .dfm-back", 0.3)
        g.wait_screen("home")

    # QUICK MATCH: connecting → queue → found → hidden
    g.tap("#dfo-door-qm", 0.05)
    s = g.wait_screen("search")
    if s:
        q = g.wait(lambda: ((g.scr().get("search") or {}).get("state") == "queue") and g.scr(), 6)
        g.ok(bool(q), "%s: QUICK MATCH never showed the queue (%s)" % (g.key, g.scr().get("search")))
        if q:
            g.ok("waiting" in ((q.get("search") or {}).get("stats") or ""), "%s: the queue card shows no waiting count (%s)" % (g.key, q.get("search")))
            g.record("search_queue")
        # the scripted group forms 1.5 s later and loads 0.6 s after that: on a loaded box the found card can come and go
        # between polls, so the found → loading steps are forced (same statuses, same order)
        g.mock("m.set({ kind: 'room', room: m.room({ quick: true, humans: 3, mySlot: 1, ownerSlot: 0 }) });")
        f = g.wait(lambda: ((g.scr().get("search") or {}).get("state") == "found") and g.scr(), 6)
        g.ok(bool(f), "%s: QUICK MATCH never showed MATCH FOUND (%s)" % (g.key, g.scr().get("search")))
        if f:
            g.ok("starting" in ((f.get("search") or {}).get("stats") or ""), "%s: MATCH FOUND shows no start countdown (%s)" % (g.key, f.get("search")))
            g.record("search_found")
        g.mock("const r = m.status().room; m.set({ kind: 'room', room: Object.assign({}, r, { phase: 'loading', matchNo: 1 }) });")
        h = g.wait(lambda: g.scr().get("matchHidden") and g.scr(), 6)
        g.ok(bool(h), "%s: the found match never hid the screens for loading (%s)" % (g.key, g.scr()))
        # a quick REMATCH that finds no partner: the api re-queues (connecting) straight from `post` (net/api.ts onClose). The
        # screens must come back by themselves and tell the integrator once (matchPhase(null)) so the match UI is torn down
        g.mock("const r = m.status().room; m.set({ kind: 'room', room: Object.assign({}, r, { phase: 'post', matchNo: 1 }) });")
        n_null = len([x for x in g.hooks() if x.startswith("matchPhase:null")])
        g.mock("m.set({ kind: 'connecting' });")
        rq = g.wait(lambda: ((g.scr().get("search") or {}).get("state") == "connecting") and g.scr().get("visible") and g.scr(), 4)
        g.ok(bool(rq), "%s: a re-queue out of the post phase did not bring the search card back (%s)" % (g.key, g.scr()))
        n_null2 = len([x for x in g.hooks() if x.startswith("matchPhase:null")])
        g.ok(n_null2 == n_null + 1, "%s: the re-queue must call matchPhase(null) exactly once (%s -> %s)" % (g.key, n_null, n_null2))
        g.mock("m.set({ kind: 'queue', waiting: 1, waitedS: 0 });")
        g.mock("m.leave();")
        g.js("() => window.__DFO__.open()")
        g.wait_screen("home")
    # solo → KEEP WAITING → PLAY VS BOTS
    g.mock("m.o.solo = true;")
    g.tap("#dfo-door-qm", 0.05)
    s = g.wait(lambda: ((g.scr().get("search") or {}).get("state") == "solo") and g.scr(), 8)
    g.ok(bool(s), "%s: no NO ONE ELSE YET card (%s)" % (g.key, g.scr().get("search")))
    if s:
        g.record("search_solo")
        g.tap("#dfo-keep", 0.3)
        q = g.wait(lambda: ((g.scr().get("search") or {}).get("state") in ("queue", "solo")) and g.scr(), 4)
        g.ok(bool(q) and "keepWaiting" in (g.st().get("calls") or []), "%s: KEEP WAITING did not re-queue (%s)" % (g.key, g.st().get("calls")))
        s = g.wait(lambda: ((g.scr().get("search") or {}).get("state") == "solo") and g.scr(), 6)
        if s:
            g.tap("#dfo-bots", 0.4)
            hk = g.hooks()
            # the solo prompt goes through api.playBotsInstead() ONLY (the api's driver starts the offline match; the dev mount's
            # onBots stands in for it): a hooks.playOffline on top would start the offline match twice
            g.ok(any(x.startswith("onBots:teams,turf") for x in hk) and not any(x.startswith("playOffline") for x in hk)
                 and not g.scr().get("visible") and g.js("() => document.getElementById('df-menus').hidden") is False,
                 "%s: PLAY VS BOTS did not hand over to ONE offline match (%s; screens %s)" % (g.key, hk[-4:], g.scr().get("visible")))
    g.mock("m.o.solo = false; m.leave();")
    # a migration while a quick room loads: HOST LEFT on the waiting card
    g.js("() => window.__DFO__.open()")
    g.wait_screen("home")
    g.mock("m.set({ kind: 'room', room: m.room({ quick: true, humans: 3, mySlot: 1 }) }); m.emit({ t: 'migrating' });")
    hl = g.wait(lambda: ((g.scr().get("search") or {}).get("state") == "hostleft") and g.scr(), 4)
    g.ok(bool(hl), "%s: a migration on the waiting card did not show HOST LEFT (%s)" % (g.key, g.scr().get("search")))
    if hl:
        g.record("search_hostleft", shot=g.key in ("d720", "se"))
    g.mock("m.leave();")
    # BACK out of PLAY ONLINE → the menus' title
    g.js("() => window.__DFO__.open()")
    g.wait_screen("home")
    g.tap(".dfo-s-home .dfm-back", 0.3)
    g.ok("close" in g.hooks() and not g.scr().get("visible") and g.js("() => document.getElementById('df-menus').hidden") is False,
         "%s: BACK did not close PLAY ONLINE back to the title (%s)" % (g.key, g.hooks()[-3:]))


def step_notices(g: Gate):
    print(" notices")
    if not g.js("() => !!window.__DFO__") and not g.mount():
        return
    g.js("() => window.__DFO__.open()")
    g.wait_screen("home")
    for kind in NOTICE_KINDS:
        if kind == "closed":
            g.mock("m.set({ kind: 'closed', why: 'room_idle' });")
        elif kind == "voided":
            g.mock("m.emit({ t: 'voided', why: 'host' });")
        elif kind == "kicked":
            g.mock("m.emit({ t: 'kicked', why: 'idle' });")
        elif kind == "court":
            g.js("() => window.__DFO__.ui.screens.showNotice('court')")
        else:
            g.mock("m.set({ kind: 'error', code: %s, msg: '' });" % json.dumps(kind))
        s = g.wait(lambda: ((g.scr().get("notice") or {}).get("kind") == kind) and g.scr(), 4)
        g.ok(bool(s), "%s: no %s card (%s)" % (g.key, kind, g.scr().get("notice")))
        if not s:
            continue
        txt = (s.get("notice") or {}).get("text") or ""
        if kind == "kicked":
            g.ok(txt == "Removed for inactivity.", "%s: the idle kick reads %r (want 'Removed for inactivity.')" % (g.key, txt))
        if kind == "quota":
            g.ok("00:00 UTC" in txt, "%s: the quota card does not say when online reopens (%r)" % (g.key, txt))
        g.record("notice_%s" % kind, shot=(g.key in ("d720", "se")) or kind in ("quota", "network", "build"))
    # SYNC reports the atlasSig mismatch as {error, code 'bad', msg 'This device built a different court — reload'}
    # (net/api.ts badCourt): the screens map it to the 'court' card (RELOAD / LEAVE), not the generic SOMETHING WENT WRONG
    g.mock("m.leave(); m.set({ kind: 'error', code: 'bad', msg: 'This device built a different court — reload' });")
    s = g.wait(lambda: ((g.scr().get("notice") or {}).get("kind") == "court") and g.scr(), 4)
    g.ok(bool(s), "%s: the api's 'different court' error did not show the court card (%s)" % (g.key, g.scr().get("notice")))
    # the quota card's PLAY VS BOTS has no matchmaker to answer: api.leave() + hooks.playOffline (exactly one offline start)
    g.mock("m.leave(); m.set({ kind: 'error', code: 'quota', msg: '' });")
    s = g.wait(lambda: ((g.scr().get("notice") or {}).get("kind") == "quota") and g.scr(), 4)
    if s:
        n0 = len([x for x in g.hooks() if x.startswith("playOffline") or x.startswith("onBots")])
        g.tap("#dfo-n-bots", 0.4)
        hk = g.hooks()
        starts = [x for x in hk if x.startswith("playOffline") or x.startswith("onBots")]
        g.ok(len(starts) == n0 + 1 and starts[-1].startswith("playOffline:") and not g.scr().get("visible"),
             "%s: the quota card's PLAY VS BOTS must start exactly one offline match (%s)" % (g.key, hk[-4:]))
        g.js("() => window.__DFO__.open()")
        g.wait_screen("home")
    # CONNECTION LOST while in a room: RETRY / LEAVE, and RETRY rejoins that room's code (SYNC reconnects with its token)
    g.mock("m.leave(); m.set({ kind: 'room', room: m.room({ code: 'HQ7R', humans: 2, mySlot: 1 }) }); m.set({ kind: 'error', code: 'network', msg: '' });")
    s = g.wait(lambda: ((g.scr().get("notice") or {}).get("kind") == "network") and g.scr(), 4)
    btns = g.js("() => [...document.querySelectorAll('.dfo-s-notice .dfo-actions button')].map((b) => b.textContent)")
    g.ok(bool(s) and btns == ["RETRY", "LEAVE"] and "HQ7R" in ((s or {}).get("notice") or {}).get("text", ""),
         "%s: a dropped room connection should offer RETRY / LEAVE for HQ7R (%s, %s)" % (g.key, btns, (s or {}).get("notice")))
    if s:
        g.record("notice_network_room", shot=g.key in ("d720", "se"))
        g.tap("#dfo-n-rejoin", 0.4)
        calls = g.js("() => window.__DFO__.mock.calls.filter((c) => c.m === 'joinRoom').map((c) => c.a[0])") or []
        g.ok(calls[-1:] == ["HQ7R"], "%s: RETRY did not rejoin HQ7R (joinRoom calls %s)" % (g.key, calls))
    # TRY AGAIN on not_found → JOIN ROOM with the code kept
    g.mock("m.leave();")
    g.js("() => window.__DFO__.open({ join: 'zz-zz' })")      # a ?room= value: case-folded, filtered
    s = g.wait_screen("join")
    if s:
        g.ok(s.get("code") == "ZZZZ" and s.get("joinEnabled"), "%s: a ?room= deep link did not pre-fill JOIN ROOM (%s)" % (g.key, s.get("code")))
        g.tap("#dfo-join-go", 0.2)
        s = g.wait(lambda: ((g.scr().get("notice") or {}).get("kind") == "not_found") and g.scr(), 6)
        g.ok(bool(s), "%s: joining ZZZZ did not show NO ROOM WITH THAT CODE (%s)" % (g.key, g.scr()))
        if s:
            g.tap("#dfo-n-join", 0.3)
            j = g.wait_screen("join")
            g.ok(bool(j) and j.get("code") == "ZZZZ", "%s: TRY AGAIN did not reopen JOIN with the code (%s)" % (g.key, (j or {}).get("code")))
    g.mock("m.leave();")
    g.js("() => window.__DFO__.ui.screens.hideAll()")
    g.js("() => { document.getElementById('df-menus').hidden = false; }")


def press_pad(g: Gate, i, hold=0.12):
    """hold a synthetic pad button until the nav controller's own rAF poll has seen it (its counter moves) — a fixed 120 ms hold
    is shorter than one frame on a box at 100 % CPU, which then reads as a missed press — but release after 5 s regardless
    (a press that changes nothing, e.g. d-pad right on the last door, may not count)"""
    n0 = (g.scr().get("nav") or {}).get("pad", 0)
    g.js("(i) => { const b = window.__PADX__.buttons[i]; b.pressed = true; b.value = 1; }", i)
    t0 = time.time()
    while time.time() - t0 < 5.0:
        time.sleep(0.05)
        if time.time() - t0 >= max(hold, 0.1) and (g.scr().get("nav") or {}).get("pad", 0) > n0:
            break
    g.js("(i) => { const b = window.__PADX__.buttons[i]; b.pressed = false; b.value = 0; }", i)
    # the next press must be a NEW edge for the poll: let two frames run so it has seen this release
    g.js("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))")
    time.sleep(0.18)


def step_nav(g: Gate):
    """kbm devices: keyboard, gamepad and mouse-hover navigation through the online screens"""
    d = g.d
    if d.touch:
        return
    print(" nav (keyboard / gamepad / mouse)")
    if not g.js("() => !!window.__DFO__") and not g.mount():
        return
    g.mock("m.leave(); m.o.solo = false;")
    # park the mouse in a corner: a pointer resting over a door would (rightly) take the focus on a MOUSE hover
    d.page.mouse.move(3, 3)
    g.js("() => window.__DFO__.open()")
    s = g.wait_screen("home")
    if not s:
        return
    path = [s.get("focus")]
    g.ok(s.get("focus") == "dfo-door-qm", "%s: PLAY ONLINE did not focus QUICK MATCH (%s)" % (g.key, s.get("focus")))
    g.press("ArrowRight"); path.append(g.scr().get("focus"))
    g.press("ArrowRight"); path.append(g.scr().get("focus"))
    g.ok(path[-1] == "dfo-door-join", "%s: → → did not reach JOIN ROOM (%s)" % (g.key, path))
    g.press("Enter", 0.4)
    s = g.wait_screen("join")
    if s:
        g.ok(s.get("focus") == "dfo-code", "%s: Enter on JOIN ROOM: focus %s (want the code field)" % (g.key, s.get("focus")))
        g.type_text("K7QX")
        g.press("Enter", 0.2)
        s = g.wait_screen("room", extra=lambda x: bool(x.get("room")))
        if s:
            g.ok(s.get("focus") == "dfo-copy-code", "%s: a guest's room screen focus %s (want COPY CODE)" % (g.key, s.get("focus")))
            g.press("Escape", 0.4)
            g.wait_screen("home")
    g.press("Escape", 0.4)
    g.ok("close" in g.hooks(), "%s: Esc on PLAY ONLINE did not close it (%s)" % (g.key, g.hooks()[-3:]))
    keys_counted = (g.scr().get("nav") or {}).get("keys", 0)
    g.steps["navKeyboard"] = {"path": path, "keys": keys_counted}
    # the menus did not also act on those keys (their title is hidden; LOADOUT etc. never opened)
    g.ok((g.js("() => window.__DF__.menu().screen") == "title"), "%s: the menus moved while the online screens had the keys (%s)" % (g.key, g.js("() => window.__DF__.menu()")))
    # gamepad: d-pad / A / B
    g.js("""() => {
      const pad = { id: 'harness pad', index: 0, connected: true, mapping: 'standard', timestamp: 0,
        axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
      window.__PADX__ = pad;
      Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] });
    }""")
    d.page.mouse.move(3, 3)
    g.js("() => window.__DFO__.open()")
    s = g.wait_screen("home")
    if s:
        press_pad(g, 15)                 # d-pad right
        f1 = g.scr().get("focus")
        press_pad(g, 15)
        f2 = g.scr().get("focus")
        press_pad(g, 0)                  # A → JOIN ROOM
        j = g.wait_screen("join", 4)
        fj = (j or {}).get("focus")
        press_pad(g, 0)                  # A on the keypad's first key: types 'A'
        code = g.scr().get("code")
        press_pad(g, 1)                  # B → home
        h = g.wait_screen("home", 4)
        press_pad(g, 1)                  # B → closed
        closed = g.wait(lambda: (not g.scr().get("visible")) or None, 4)
        g.steps["navPad"] = {"focus": [f1, f2, fj], "code": code, "closed": bool(closed), "pad": (g.scr().get("nav") or {})}
        g.ok(f1 == "dfo-door-create" and f2 == "dfo-door-join", "%s: pad d-pad right went %s → %s" % (g.key, f1, f2))
        g.ok(fj == "dfo-key-A" and code == "A", "%s: on JOIN the pad focus was %s and A typed %r (want the keypad, 'A')" % (g.key, fj, code))
        g.ok(bool(h) and bool(closed), "%s: pad B did not back out twice (home %s, closed %s)" % (g.key, bool(h), bool(closed)))
    g.js("() => { delete navigator.getGamepads; }")
    g.js("() => { document.getElementById('df-menus').hidden = false; }")
    # the MATCH MENU card by keys: an Esc handler registered BEFORE the UI (as the game's Input is) opens the card; the
    # same Esc must not close it again; ↓ moves; a second Esc resumes (hooks.resume)
    g.js("() => window.__DFO__.dispose()")
    g.js("() => { window.__ESCN__ = 0; window.addEventListener('keydown', (e) => { if (e.code === 'Escape' && window.__DFO__ && !window.__DFO__.ui.hud.menuOpen) { window.__ESCN__++; window.__DFO__.ui.hud.showMenu(); } }, true); }")
    if g.mount():
        g.js("() => { window.__DFO__.ui.hud.attach(); }")
        g.press("Escape", 0.35)
        m1 = g.st().get("hud") or {}
        g.press("ArrowDown")
        m2 = (g.st().get("hud") or {}).get("focus")
        g.press("ArrowDown")
        m3 = (g.st().get("hud") or {}).get("focus")
        g.press("Escape", 0.35)
        m4 = g.st().get("hud") or {}
        g.steps["navMenu"] = {"open": m1.get("menu"), "focus": [m1.get("focus"), m2, m3], "afterEsc": m4.get("menu"), "hooks": g.hooks()[-3:]}
        g.ok(m1.get("menu") is True and m1.get("focus") == "dfo-m-back", "%s: Esc did not open the MATCH MENU card on BACK TO MATCH (%s)" % (g.key, m1))
        g.ok(m2 == "dfo-m-settings" and m3 == "dfo-m-howto", "%s: ↓ on the MATCH MENU went %s → %s" % (g.key, m2, m3))
        g.ok(m4.get("menu") is False and "resume" in g.hooks(), "%s: the second Esc did not resume (%s, %s)" % (g.key, m4.get("menu"), g.hooks()[-3:]))
        g.js("() => { window.__DFO__.ui.hud.detach(); }")
    # mouse hover moves focus (a MOUSE pointer)
    g.js("() => window.__DFO__.open()")
    if g.wait_screen("home"):
        b = d.page.locator("#dfo-door-create").bounding_box()
        d.page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        time.sleep(0.3)
        g.ok(g.scr().get("focus") == "dfo-door-create", "%s: a mouse hover did not move focus (%s)" % (g.key, g.scr().get("focus")))
        g.js("() => window.__DFO__.ui.screens.hideAll()")
        g.js("() => { document.getElementById('df-menus').hidden = false; }")


def step_match(g: Gate):
    d = g.d
    print(" match overlays")
    mode = "ffa" if g.key in ("pixel7", "d900", "ipad") else "teams"
    q = {"map": "pier18" if mode == "teams" else "cinder", "autostart": "1", "dev": "1", "seed": "7"}
    if mode == "ffa":
        q["mode"] = "ffa"
    d.goto(**q)
    ok = d.wait("() => (window.__DF__ && window.__DF__.state && window.__DF__.state().phase === 'play') || null", 150)
    if not ok:
        g.fail("%s: the match never reached phase 'play' (%s)" % (g.key, d.js("() => window.__DF__ && window.__DF__.state && window.__DF__.state().phase")))
        return
    d.ensure_touch()
    d.wait("() => (window.__DF__.match() && window.__DF__.match().phase !== 'countdown') || null", 150)
    d.wait("() => { const b = document.querySelector('.df-boot'); return (!b || getComputedStyle(b).visibility === 'hidden') ? true : null; }", 20)
    if not g.mount():
        return
    g.js("""async () => { const { MockOnline } = await import('/src/net/ui/mock.ts'); const x = window.__DFO__;
      x.mock.setHud(MockOnline.hudSample({ host: true, rttMs: 84 })); x.ui.hud.attach();
      x.mock.emit({ t: 'joined', name: 'Mossy' }); x.mock.emit({ t: 'botTakeover', runner: 3 }); }""")
    d.js("() => { try { window.__DF__.setTank(0, 5); } catch (e) {} }")   # the low-tank toast too: every HUD block shows
    time.sleep(0.6)
    h = (g.st().get("hud") or {})
    g.ok((h.get("badge") or {}).get("host") is True and (h.get("badge") or {}).get("text") == "84 ms", "%s: the NET badge reads %s" % (g.key, h.get("badge")))
    g.ok(len(h.get("feed") or []) == 2, "%s: the feed shows %s" % (g.key, h.get("feed")))
    g.record("hud_badge")
    g.mock("const h = m.hud(); h.rttMs = 312; h.quality = 'bad'; h.host = false; h.migrating = true; x.ui.hud.refresh();")
    time.sleep(0.3)
    h = (g.st().get("hud") or {})
    g.ok(h.get("banner") == "HOST LEFT — MIGRATING…", "%s: HOST MIGRATING banner %r" % (g.key, h.get("banner")))
    g.ok("312" in ((h.get("badge") or {}).get("text") or "") and (h.get("badge") or {}).get("q") == "bad", "%s: the high-ping badge reads %s" % (g.key, h.get("badge")))
    g.record("hud_migrating")
    g.mock("const h = m.hud(); h.migrating = false; x.ui.hud.refresh(); m.emit({ t: 'migrated', hostName: 'Kai' });")
    time.sleep(0.3)
    g.ok((g.st().get("hud") or {}).get("banner") == "KAI IS HOSTING", "%s: after the migration the banner reads %r" % (g.key, (g.st().get("hud") or {}).get("banner")))
    if not d.touch:
        d.page.keyboard.down("Tab")
        time.sleep(0.4)
        g.ok((g.st().get("hud") or {}).get("board") is True, "%s: holding TAB did not show the PLAYERS board" % g.key)
        g.record("hud_board")
        d.page.keyboard.up("Tab")
        time.sleep(0.2)
        g.ok((g.st().get("hud") or {}).get("board") is False, "%s: releasing TAB did not hide the board" % g.key)
    # the MATCH MENU card (ESC / PAUSE / blur → SYNC calls showMenu)
    g.js("() => window.__DFO__.ui.hud.showMenu()")
    time.sleep(0.4)
    h = (g.st().get("hud") or {})
    g.ok(h.get("menu") is True and (d.touch or h.get("focus") == "dfo-m-back"), "%s: the MATCH MENU card: %s" % (g.key, h))
    g.record("hud_menu", ignore_touch=True)
    # (the card's keys are judged in the lobby, step_nav: in this unwired page an Esc in a live match is the OFFLINE pause)
    g.tap("#dfo-m-leave", 0.3)
    g.ok((g.st().get("hud") or {}).get("confirm") is True, "%s: LEAVE MATCH did not ask first" % g.key)
    g.record("hud_confirm", ignore_touch=True)
    g.tap("#dfo-leave-no", 0.3)
    g.ok((g.st().get("hud") or {}).get("confirm") is False and (g.st().get("hud") or {}).get("menu") is True, "%s: STAY did not return to the card" % g.key)
    g.tap("#dfo-m-leave", 0.3)
    g.tap("#dfo-leave-yes", 0.3)
    g.ok("leaveMatch" in g.hooks(), "%s: LEAVE did not call leaveMatch (%s)" % (g.key, g.hooks()[-3:]))
    if d.touch:
        touch_hidden = g.js("() => { const t = document.getElementById('df-touch'); return t ? getComputedStyle(t).visibility : null; }")
        g.ok(touch_hidden == "visible", "%s: the touch controls stayed hidden after the card closed (%s)" % (g.key, touch_hidden))
    # post-match: the slate's buttons become the online ones
    d.js("() => { try { window.__DF__.setTimeLeft(0.5); } catch (e) {} }")
    if not d.wait("() => { const v = document.querySelector('.df-victory'); return v && !v.hidden ? true : null; }", 150):
        g.fail("%s: the victory slate never showed" % g.key)
        return
    d.wait("() => { const c = document.querySelector('.df-victory-card'); const m = document.querySelector('.df-victory-mark'); return c && c.getAnimations().length === 0 && m && m.classList.contains('stamped') ? true : null; }", 30)
    for label, js in (("post_quick", "m.room({ quick: true, humans: 3, mySlot: 1, ownerSlot: 0 })"),
                      ("post_owner", "m.room({ quick: false, humans: 3, mySlot: 0, ownerSlot: 0 })"),
                      ("post_guest", "m.room({ quick: false, humans: 3, mySlot: 1, ownerSlot: 0 })")):
        g.mock("x.ui.hud.showPost(%s, document.querySelector('.df-victory-card'));" % js)
        p = g.wait(lambda: ((g.st().get("hud") or {}).get("post") or {}).get("ready") and g.st().get("hud"), 10)
        g.ok(bool(p), "%s: %s never became ready (%s)" % (g.key, label, (g.st().get("hud") or {}).get("post")))
        time.sleep(0.4)
        orig = g.js("() => { const b = document.querySelector('.df-victory-btns'); return b ? getComputedStyle(b).display : null; }")
        g.ok(orig == "none", "%s: %s left the slate's own PLAY AGAIN / LOBBY showing (%s)" % (g.key, label, orig))
        g.record(label, {"post": (g.st().get("hud") or {}).get("post")}, shot=label != "post_owner" or g.key in ("d720", "se"))
    want = {"post_quick": ["REMATCH", "LEAVE"], "post_owner": ["PLAY AGAIN", "LEAVE"], "post_guest": ["LEAVE"]}
    for k, v in want.items():
        got = ((g.steps.get(k) or {}).get("post") or {}).get("buttons")
        g.ok(got == v, "%s: %s buttons %s (want %s)" % (g.key, k, got, v))
    g.mock("x.ui.hud.showPost(m.room({ quick: true, humans: 3, mySlot: 1, ownerSlot: 0 }), document.querySelector('.df-victory-card'));")
    g.wait(lambda: ((g.st().get("hud") or {}).get("post") or {}).get("ready"), 10)
    g.tap("#dfo-rematch", 0.5)
    txt = ((g.st().get("hud") or {}).get("post") or {}).get("buttons") or []
    g.ok(bool(txt) and txt[0].startswith("Waiting for another player"), "%s: REMATCH did not show the wait (%s)" % (g.key, txt))
    g.ok("rematch" in (g.st().get("calls") or []), "%s: REMATCH did not call api.rematch()" % g.key)
    g.record("post_rematch_wait", shot=g.key in ("d720", "se"))
    g.js("() => { window.__DFO__.ui.hud.hidePost(); window.__DFO__.ui.hud.detach(); }")


# ─────────────────────────────── driver ───────────────────────────────
def run_device(browser, key, args, groups, out):
    spec = DEVICES[key]
    d = Dev(browser, key, spec, args)
    g = Gate(d, key, args)
    res = {"device": key, "spec": {k: v for k, v in spec.items() if k != "ua"}, "safeOverride": d.safe_ok}
    out[key] = res
    t0 = time.time()
    try:
        if any(x in groups for x in ("title", "lobby", "notices", "nav")):
            if boot_lobby(g):
                if "title" in groups:
                    step_title(g)
                if "lobby" in groups:
                    step_lobby(g)
                if "notices" in groups:
                    step_notices(g)
                if "nav" in groups:
                    step_nav(g)
        if "match" in groups:
            step_match(g)
    except Exception as e:
        g.fail("%s: harness exception %s: %s" % (key, type(e).__name__, str(e).splitlines()[0][:240]))
    errs = [e for e in d.errors if not e.startswith("tap ")]
    taps = [e for e in d.errors if e.startswith("tap ")]
    if errs:
        for e in errs[:8]:
            g.fail("%s: %s" % (key, e))
    res.update({"steps": g.steps, "problems": g.problems, "notes": g.notes, "tapErrors": taps[:8], "pageErrors": errs[:20], "seconds": round(time.time() - t0, 1)})
    d.close()
    return g.problems


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--headless", action="store_true", help="accepted for symmetry: this gate is always headless")
    ap.add_argument("--devices", default=",".join(ALL_DEVICES))
    ap.add_argument("--steps", default=",".join(STEP_GROUPS), help="groups: " + ",".join(STEP_GROUPS))
    ap.add_argument("--force-touch", action="store_true", default=True)
    ap.add_argument("--no-serve", action="store_true")
    args = ap.parse_args()
    devices = [x for x in args.devices.split(",") if x]
    groups = [x for x in args.steps.split(",") if x]
    for k in devices:
        if k not in DEVICES:
            raise SystemExit("unknown device %s (have %s)" % (k, ", ".join(DEVICES)))
    try:
        srv = None if args.no_serve else ensure_server(args.base)
    except HarnessError as e:
        print("NETLOBBY FAIL — %s" % e)
        return 2
    from playwright.sync_api import sync_playwright
    out, problems = {}, []
    t0 = time.time()
    pw = sync_playwright().start()
    try:
        browser = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        for k in devices:
            print("── %s (%dx%d%s)" % (k, DEVICES[k]["w"], DEVICES[k]["h"], ", touch" if DEVICES[k]["mobile"] else ""))
            problems += run_device(browser, k, args, groups, out)
        browser.close()
    finally:
        pw.stop()
        stop_server(srv)
    verdict = "NETLOBBY OK" if not problems else "NETLOBBY FAIL"
    report = {"verdict": verdict, "devices": devices, "groups": groups, "problems": problems, "results": out, "seconds": round(time.time() - t0, 1)}
    path = save_report("netlobby", report, args.base)
    print("%s — %d device(s), %d problem(s), %.0f s; report %s" % (verdict, len(devices), len(problems), time.time() - t0, path))
    for p in problems[:30]:
        print("  - " + p)
    return 0 if not problems else 1


if __name__ == "__main__":
    sys.exit(main())
