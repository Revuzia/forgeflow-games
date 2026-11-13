#!/usr/bin/env python
"""bootguard - what a player sees when the boot or a match load goes wrong (HEADLESS; faults injected client-side).

    python _harness/bootguard.py                    # every case
    python _harness/bootguard.py --cases a,b1,e,j,l --disk

Seeded from _spec/improve_2026-09/baseline/bootfault.py, hangprobe5.py and esmprobe.py (boot-robustness audit) and
patterned on games/dyefield/_harness/bootguard.py. Every fault is injected in the browser (Playwright routes, CDP
network throttling, launch switches, page JS), so neither the working copy nor the server is ever touched. Each case
gets a fresh browser context (so a sessionStorage retry flag starts cleared).

A "card" is judged from what is VISIBLE (the WHOLE document.body.innerText + the splash tip): failure words (could not /
couldn't / failed / isn't licensed / WebGL / did not start / stopped / lost ...) that were not on screen before the
fault. That works on today's splash tip and on the __LC_BOOT__ guard lane L9 is building (its DOM is not frozen).
j and k (a card over a RUNNING menu) are judged stricter, by the card element itself (visible_card): a rendered
#lc-fail / #ffg-kernel-error / role=alertdialog|alert / dialog[open] that is TOPMOST at its own centre, or the fixed
container under the screen centre, carrying a new failure line. (Wave-2 fix, VERIFY.md #22: the snapshot used to cut
innerText at 1,500 chars while the card title sits at ~1,629 behind the menu text, so j/k FAILED with the card on screen.)
Falsifier: `--cases j,k --plant no-card` (kernel.onError swallowed) and `--plant hidden-card` (cards display:none) must
both FAIL j and k (gate.py --negative-controls runs them).
TIME BUDGETS (b1, b2, g, h, i, j, k) are judged on an IN-PAGE card clock (CARD_WATCH_JS: a MutationObserver stamps
performance.now() when each failure line first shows on a rendered card / the splash tip), not on when the harness's
polling evaluate happened to look - on a contended box that latency alone read j at 1,331 ms. k's reload budget runs
from the browser's webglcontextrestored event; a browser that never restores the context in 30 s is could-not-judge.

Cases (PLAN L9 / L3 / L4 gates):
  a    normal boot: __LC__ appears, 0 page errors, 0 failed requests, no failure card
  b1   ffg_boot3d.js (the entry) -> 404: a card within 5 s naming ffg_boot3d.js AND 404, then EXACTLY one automatic
       reload, and the card still on screen at t45
  b2   royale/hud.js -> 404: the card names hud.js (not jsdelivr); still on screen at t45
  b3   the entry 404 with the retry already spent (the tab is re-navigated after the one automatic retry, or - when
       the build never retries - the first card): a card, and NO further automatic reload
  c    150 kbps / 150 ms (CDP, cache off): no failure card and no "reload" advice while bytes are still arriving;
       __LC__ appears (can take ~80 s locally; --c-budget)
  d    three.module.js never answers (jsdelivr AND a vendored copy black-holed): no "reload" advice before the 60 s
       stall verdict, and a terminal card by --stall-budget (default 110 s = 60 visible + 20 quiet + probe + slack)
  e    cdn.jsdelivr.net blocked (request refused): __LC__ appears with ZERO jsdelivr resource entries
  g    no WebGL (--disable-webgl --disable-webgl2 --disable-3d-apis): a WebGL card within 2 s of navigation, and
       three.module.js / three.core.js are never requested
  h    sitelock (host rehost.example): the licence card within 1 s, no request for the engine (runtime/ beyond
       ffg_boot3d.js; index.html's own three modulepreload is allowed), still on screen at t45
  i    content.json -> 404: a terminal card within 10 s, still on screen at t45 (never overwritten by "Still loading")
  j    one kernel updater throws once (menu): a visible error card within 1 s of the throw (needs the kernel's rAF
       loop to be running: could-not-judge when rAF is starved)
  k    WEBGL_lose_context.loseContext() on the menu: a card within 1 s; restoreContext() -> the page reloads (10 s)
  l1   every GLB -> 404 at match start (every kernel *Cache / *Inflight cleared, faulted requests COUNTED): within 35 s of
       the first faulted GLB answer W.phase === "menu" and a notice on screen; CNJ when no GLB was requested within
       --l-reach s (240) or the match loaded anyway (the fault never reached the game)
  l2   every GLB aborted (network drop) at match start: the same (needs the loader timeout, L3 h)
  m    esm.sh blocked, SQUAD UP -> real click on CREATE ROOM: an error text and enabled buttons within 10 s
Exit 0 only when every selected case passes; 1 = a case failed; 2 = could not judge (browser / server / rAF).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ALL = ["a", "b1", "b2", "b3", "c", "d", "e", "g", "h", "i", "j", "k", "l1", "l2", "m"]
FAIL_RE = re.compile(r"could ?n[o']t|can[' ]?no?t |cannot|failed|isn.t licensed|not licensed|licen[cs]e|webgl|did not start|didn.t start|"
                     r"stopped|context (was )?lost|graphics (were )?(reset|interrupted)|reset the graphics|interrupted|unavailable|not supported|hardware acceleration|"
                     r"something went wrong|error", re.I)
RELOAD_RE = re.compile(r"\breload\b", re.I)
REHOST = "rehost.example"

# IN-PAGE card clock (init script, every document): a MutationObserver stamps performance.now() (page time since navigation
# start) the first time each failure line shows on a rendered card-like element or the splash tip. Budgets ("within 1 s of
# the throw", "within 2 s of navigation") are judged on THESE stamps, never on when the harness's polling evaluate happened
# to look: the first gate.py run of this lane on a box with 6 other automated Chromes read j at 1,331 ms and g at 5.3 s
# wall although the same build stamps the card at ~100 ms when the box is quiet - harness latency, not the game.
CARD_WATCH_JS = r"""(() => {
  if (window.__H_CW__) return; window.__H_CW__ = true;
  const RE = new RegExp(%s, 'i');
  const log = window.__H_CARDLOG__ = []; const seen = new Set();
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const SEL = '#lc-fail, #ffg-kernel-error, [role="alertdialog"], [role="alert"], dialog[open], #lc-splash-tip';
  const scan = () => { try {
    for (const e of document.querySelectorAll(SEL)) {
      const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || !vis(e)) continue;
      const txt = (e.innerText || '').trim(); if (!txt) continue;
      for (let ln of txt.split('\n')) { ln = ln.trim();
        if (!ln || seen.has(ln) || !RE.test(ln)) continue; seen.add(ln);
        if (log.length < 120) log.push({ t: Math.round(performance.now()), line: ln.slice(0, 200), src: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') }); }
    } } catch (_) {} };
  const mo = new MutationObserver(scan);
  const go = () => { try { mo.observe(document.documentElement || document, { childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'role', 'hidden', 'open', 'id'] }); } catch (_) {} scan(); };
  go();
})();"""


def page_ms(snap, pred=None, before=""):
    """Page time (ms since navigation start) at which the first NEW failure line (not on screen `before`, matching pred)
    appeared on a card, from the in-page card clock; None when the clock logged none (or is missing)."""
    log = (snap or {}).get("cardlog") or []
    old = set(ln.strip() for ln in (before or "").splitlines())
    ts = [e["t"] for e in log if e.get("line") not in old and (pred is None or pred(e.get("line") or ""))]
    return min(ts) if ts else None

SNAP_JS = r"""() => {
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const tip = document.getElementById('lc-splash-tip');
  const bar = document.querySelector('#lc-splash .bar');
  let boot = null; try { boot = window.__LC_BOOT__ ? (typeof window.__LC_BOOT__.info === 'function' ? window.__LC_BOOT__.info() : 'present') : null; } catch (e) { boot = 'info threw: ' + e; }
  const res = performance.getEntriesByType('resource');
  const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && vis(b)).map((b) => (b.textContent || '').trim().slice(0, 30) + (b.disabled ? ':disabled' : ''));
  let text = ''; try { text = (document.body && document.body.innerText || '').trim(); } catch (e) {}
  // CARDS (what a player can actually see): every card-like element (the boot guard's #lc-fail overlay, the kernel's own
  // #ffg-kernel-error, any role=alertdialog / role=alert / open <dialog> - lane L4's royale card included) that is rendered,
  // has an area, and is the TOPMOST element at its own centre; plus the fixed-position container under the SCREEN CENTRE.
  // The 2026-09-30 verifier proved the old judge blind here: innerText was cut at 1,500 chars and the card title sat at 1,629.
  const W0 = innerWidth, H0 = innerHeight;
  const onTop = (e) => { const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    const x = Math.min(W0 - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(H0 - 1, Math.max(0, r.top + r.height / 2));
    const t = document.elementFromPoint(x, y); return !!(t && (t === e || e.contains(t))); };
  const cards = [];
  for (const e of document.querySelectorAll('#lc-fail, #ffg-kernel-error, [role="alertdialog"], [role="alert"], dialog[open]')) {
    if (cards.length >= 8 || !vis(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    cards.push({ sel: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.getAttribute('role') ? '[' + e.getAttribute('role') + ']' : ''),
                 top: onTop(e), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
                 text: (e.innerText || '').trim().slice(0, 600) });
  }
  let centre = null;
  try {
    let n = document.elementFromPoint(W0 / 2, H0 / 2);
    const hit = n ? n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') : null;
    while (n && n !== document.body && n !== document.documentElement && getComputedStyle(n).position !== 'fixed') n = n.parentElement;
    if (n && n !== document.body && n !== document.documentElement)
      centre = { sel: n.tagName.toLowerCase() + (n.id ? '#' + n.id : ''), hit, text: (n.innerText || '').trim().slice(0, 600) };
    else centre = { sel: null, hit, text: '' };
  } catch (e) {}
  return { t: Math.round(performance.now()), href: location.href, lc: !!window.__LC__, phase: window.__LC__ && window.__LC__.W ? window.__LC__.W.phase : null,
           tip: tip && vis(tip) ? tip.textContent : null, barBg: bar ? getComputedStyle(bar).backgroundColor : null,
           text: text.slice(0, 20000), textLen: text.length, cards, centre, cardlog: window.__H_CARDLOG__ || null, boot, buttons,
           ends: [...performance.getEntriesByType('navigation'), ...res].slice(0, 400).map((x) => [Math.round(x.responseEnd || 0), x.name.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(-60)]),
           bytes: res.reduce((a, x) => a + (x.encodedBodySize || x.transferSize || 0), 0), nres: res.length,
           jsdelivr: res.filter((x) => /jsdelivr/.test(x.name)).length,
           three: res.filter((x) => /three(\.module|\.core)?\.js|three\.module\.min/.test(x.name)).map((x) => x.name.slice(-80)),
           runtime: res.filter((x) => /\/runtime\//.test(x.name)).map((x) => x.name.replace(/^https?:\/\/[^/]+/, '').split('?')[0]),
           retryKey: window.__LC_BOOT__ && window.__LC_BOOT__.retryKey || null };
}"""


def failure_text(snap, before=""):
    """The visible failure message (new since `before`), or None."""
    txt = (snap or {}).get("text") or ""
    tip = (snap or {}).get("tip") or ""
    lines = [ln.strip() for ln in (txt + "\n" + tip).splitlines() if ln.strip()]
    old = set(ln.strip() for ln in (before or "").splitlines())
    hits = [ln for ln in lines if FAIL_RE.search(ln) and ln not in old]
    return " | ".join(dict.fromkeys(hits))[:400] if hits else None


def _new_fail_lines(texts, before):
    old = set(ln.strip() for ln in (before or "").splitlines())
    out = []
    for t in texts:
        for ln in (t or "").splitlines():
            ln = ln.strip()
            if ln and FAIL_RE.search(ln) and ln not in old:
                out.append(ln)
    return " | ".join(dict.fromkeys(out))[:400] if out else None


def cardtime(snap, pred=None, before=""):
    """Seconds (page time since navigation start) at which the card's first new failure line appeared, from the in-page
    card clock carried by this snapshot; None without a stamp (the gate then fails that budget - never a silent pass)."""
    ms = page_ms(snap, pred, before)
    return round(ms / 1000.0, 2) if ms is not None else None


def budget(snap, limit_s, pred=None, before=""):
    """Judge a 'card within limit_s of navigation' budget on the in-page card clock. Returns (verdict, detail) with verdict
    True (pass) / False (fail) / None (could-not-judge). A miss is ENVIRONMENT (None) only when the overrun is time spent
    SERVING files: the last byte the page received before the card arrived so late that the game's own time after it
    (card - lastByte) is still within the budget - on this box every request round-trips through the Playwright route
    handler, which crawls with 6-8 other automated Chromes running. A game that delays the card by its own logic fails."""
    at = cardtime(snap, pred, before)
    if snap is None or at is None:
        return False, {"atPageS": None, "why": "no card stamped"}
    ends = [e for e in (snap.get("ends") or []) if e[0] and e[0] <= at * 1000]
    last = max(ends, key=lambda e: e[0]) if ends else None
    game_s = round(at - (last[0] / 1000.0 if last else 0), 2)
    d = {"atPageS": at, "lastByteBeforeCardS": round(last[0] / 1000.0, 2) if last else None, "lastFile": last[1] if last else None,
         "gameSAfterLastByte": game_s, "harnessSawAtWallS": snap.get("wall")}
    if at <= limit_s:
        return True, d
    if game_s <= limit_s:
        d["why"] = "budget missed only by serving latency (contended box): the game showed the card %.2f s after its last byte" % game_s
        return None, d
    return False, d


def visible_card(snap, before=""):
    """The failure message on a card the player can SEE (new since `before`), or None. A card counts when it is a
    card-like element (#lc-fail / #ffg-kernel-error / role=alertdialog|alert / dialog[open]) that is rendered and topmost
    at its own centre, or the fixed container under the screen centre; its text must carry a failure word that was not on
    screen before the fault. Text that exists only BEHIND the game (covered, display:none, zero-size) never counts."""
    snap = snap or {}
    texts = [c.get("text") for c in (snap.get("cards") or []) if c.get("top")]
    ce = snap.get("centre") or {}
    if ce.get("sel"):
        texts.append(ce.get("text"))
    return _new_fail_lines(texts, before)


def card_where(snap):
    snap = snap or {}
    return {"cards": [{k: c.get(k) for k in ("sel", "top", "rect")} for c in (snap.get("cards") or [])],
            "centre": {k: (snap.get("centre") or {}).get(k) for k in ("sel", "hit")}, "textLen": snap.get("textLen")}


# planted faults for the j/k falsifier (--plant): the kernel's error path is swallowed (no card is ever painted), or the
# card is painted but hidden. Either must make j and k FAIL, or the gate has no teeth.
PLANT_JS = {
    "no-card": r"""() => { const k = window.__LC__.W.kernel;
      k.onError = function (arg, info) { if (typeof arg === 'function') return () => {};
        this.lastError = { message: String(arg && arg.message || arg), kind: (info || {}).kind || 'error', suppressedByHarness: true }; return true; };
      return 'planted: kernel.onError swallows every error (no card)'; }""",
    "hidden-card": r"""() => { const st = document.createElement('style'); st.id = '__h_plant_hidden';
      st.textContent = '#lc-fail, #ffg-kernel-error, [role=alertdialog], [role=alert], dialog { display: none !important; }';
      document.head.appendChild(st); return 'planted: every card-like element display:none'; }""",
}


def reload_advice(snap):
    txt = ((snap or {}).get("tip") or "") + "\n" + ((snap or {}).get("text") or "")
    return bool(RELOAD_RE.search(txt))


class Runner:
    def __init__(self, args, v):
        self.args, self.v = args, v
        self.pw = None
        self.browsers = {}
        self.markers = {}
        self.disk = None

    def browser(self, key="default", extra=()):
        if key in self.browsers:
            return self.browsers[key]
        # a unique (ignored) switch marks this Chrome's processes, so a hung close can be killed by command line
        marker = "--h-bootguard-marker=%d-%s" % (os.getpid(), uuid.uuid4().hex[:12])
        flags = list(C.FLAGS) + list(C.GPU_PROFILES.get(self.args.gpu, [])) + ["--host-resolver-rules=MAP %s 127.0.0.1" % REHOST] + list(extra) + [marker]
        try:
            b = self.pw.chromium.launch(channel="chrome", headless=not self.args.headed, args=flags)
        except Exception as e:
            raise C.EnvFailure("Chrome did not launch: %s" % str(e).splitlines()[0][:200])
        self.browsers[key] = b
        self.markers[key] = marker
        return b

    @staticmethod
    def _kill_marked(marker):
        try:
            if os.name == "nt":
                ps = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -and "
                      "$_.CommandLine.Contains('%s') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" % marker)
                subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, timeout=60)
            else:
                subprocess.run(["pkill", "-f", marker], capture_output=True, timeout=30)
        except Exception:
            pass

    def _guarded(self, fn, key, timeout_s, what):
        """Run a Playwright close with a watchdog: on this contended box a context close after a GPU context loss hung
        for 14 min (k -> l1, 2026-10-01 01:50). After timeout_s the marked Chrome is killed, the browser is dropped (the next
        case relaunches one), and the hang is reported as a NOTE - the case's own rows were already judged."""
        marker = self.markers.get(key)
        fired = []
        timer = threading.Timer(timeout_s, lambda: (fired.append(1), self._kill_marked(marker))) if marker else None
        if timer:
            timer.daemon = True
            timer.start()
        try:
            fn()
        except Exception:
            pass
        finally:
            if timer:
                timer.cancel()
        if fired:
            self.browsers.pop(key, None)
            self.markers.pop(key, None)
            self.v.note("%s hung > %d s; the browser was killed by its marker (environment, after the case was judged)" % (what, timeout_s))

    def close_ctx(self, ctx, timeout_s=60):
        key = next((k for k, b in self.browsers.items() if b is getattr(ctx, "browser", None)), None)
        self._guarded(ctx.close, key, timeout_s, "context close")

    def case_page(self, key="default", extra=()):
        b = self.browser(key, extra)
        ctx = b.new_context(viewport={"width": self.args.width, "height": self.args.height})
        ctx.add_init_script(C.INIT_JS)
        ctx.add_init_script(CARD_WATCH_JS % json.dumps(FAIL_RE.pattern))
        u = urllib.parse.urlparse(self.args.base)
        if self.args.disk:
            ds = C.DiskServer(["%s://%s" % (u.scheme, u.netloc), "%s://%s:%s" % (u.scheme, REHOST, u.port or 80)], self.args.rev)
            ctx.route(lambda url: ds.matches(url), ds.handle)
        pg = ctx.new_page()
        pg.set_default_timeout(120_000)
        rec = {"console": [], "pageerrors": [], "failed": [], "navs": [], "requests": [], "refused": []}
        pg.on("console", lambda m: rec["console"].append((m.type, m.text[:400])))
        pg.on("pageerror", lambda e: rec["pageerrors"].append(str(e)[:400]))

        def _rf(r):
            f = r.failure
            f = f() if callable(f) else f
            if "ERR_CONNECTION_REFUSED" in str(f):
                rec["refused"].append(r.url)
            if "ERR_ABORTED" not in str(f) and "favicon" not in r.url:
                rec["failed"].append("%s %s" % (r.url[-120:], f))
        pg.on("requestfailed", _rf)
        pg.on("response", lambda r: rec["failed"].append("HTTP %d %s" % (r.status, r.url[-120:])) if r.status >= 400 and "favicon" not in r.url else None)
        # a NAVIGATION is a main-frame document request. framenavigated also fires for history.replaceState (L9 strips
        # its ?lcretry= marker that way), which the 22:24 working-copy run miscounted as a second automatic reload.
        def _rq(r):
            rec["requests"].append(r.url)
            try:
                if r.is_navigation_request() and r.frame == pg.main_frame:
                    rec["navs"].append((round(time.time(), 2), r.url))
            except Exception:
                pass
        pg.on("request", _rq)
        return ctx, pg, rec

    def snap(self, pg):
        try:
            return pg.evaluate(SNAP_JS)
        except Exception as e:
            return {"error": str(e).splitlines()[0][:200], "text": "", "tip": None}

    def watch(self, pg, seconds, t0, every=0.25, stop=None):
        """Snapshots every `every` s until `seconds` after t0 (wall) or stop(snap) is true. Returns the list."""
        out = []
        while time.time() - t0 < seconds:
            s = self.snap(pg)
            s["wall"] = round(time.time() - t0, 2)
            out.append(s)
            if stop and stop(s):
                break
            pg.wait_for_timeout(int(every * 1000))
        return out

    def goto(self, pg, url):
        try:
            pg.goto(url, wait_until="commit", timeout=90_000)
        except Exception as e:
            if "ERR_CONNECTION_REFUSED" in str(e):
                raise C.EnvFailure("navigation refused: %s" % url)
            raise

    @staticmethod
    def safe_eval(pg, expr):
        try:
            return pg.evaluate(expr)
        except Exception as e:
            return "evaluate failed: %s" % str(e).splitlines()[0][:120]

    def wait_lc(self, pg, timeout_s):
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            try:
                if pg.evaluate("() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.kernel)"):
                    return round(time.time() - t0, 1)
            except Exception:
                pass
            pg.wait_for_timeout(250)
        return None

    def close_all(self):
        for k, b in list(self.browsers.items()):
            self._guarded(b.close, k, 60, "browser close")


def first(snaps, pred):
    for s in snaps:
        if pred(s):
            return s
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--cases", default=",".join(ALL))
    ap.add_argument("--t45", type=float, default=45.0, help="the 'still on screen' sample time")
    ap.add_argument("--c-budget", type=float, default=240.0)
    ap.add_argument("--stall-budget", type=float, default=110.0)
    ap.add_argument("--full", action="store_true", help="keep watching a case after its first violation")
    ap.add_argument("--l-reach", type=float, default=240.0,
                    help="l1/l2: seconds for the match start to reach its first GLB request before the case is could-not-judge")
    ap.add_argument("--plant", default=None, choices=sorted(PLANT_JS),
                    help="FALSIFIER for j/k: plant a fault in the page before the throw / context loss (no-card: kernel.onError "
                         "swallows the error; hidden-card: every card-like element display:none). j and k MUST then FAIL.")
    args = ap.parse_args()
    cases = [c.strip() for c in args.cases.split(",") if c.strip()]
    if args.plant:
        if not args.report:
            args.report = "bootguard_plant_" + args.plant.replace("-", "_")
        if any(c not in ("j", "k") for c in cases):
            print("bootguard: --plant only affects cases j and k (other selected cases run unplanted)", flush=True)
    base = args.base
    u = urllib.parse.urlparse(base)
    rehost_url = "%s://%s:%s%s" % (u.scheme, REHOST, u.port or 80, u.path)

    def body(v):
        if not args.disk and not C.url_reachable(base):
            raise C.EnvFailure("server not reachable at %s (use --disk)" % base)
        from playwright.sync_api import sync_playwright
        R = Runner(args, v)
        R.pw = sync_playwright().start()
        results = {}
        v.data["cases"] = results
        try:
            for case in cases:
                print("\n--- case %s (%s)" % (case, time.strftime("%H:%M:%S")), flush=True)
                try:
                    results[case] = run_case(R, v, case, base, rehost_url, args)
                except C.EnvFailure as e:
                    v.cnj("%s: environment" % case, str(e))
                except Exception as e:
                    v.cnj("%s: harness exception" % case, str(e).splitlines()[0][:300] if str(e) else type(e).__name__)
                    import traceback
                    traceback.print_exc()
        finally:
            R.close_all()
            try:
                R.pw.stop()
            except Exception:
                pass
    return C.run_gate("bootguard", body, args)


def still_at(R, pg, t0, t_at):
    """Wait until t0 + t_at and snapshot."""
    while time.time() - t0 < t_at:
        pg.wait_for_timeout(500)
    s = R.snap(pg)
    s["wall"] = round(time.time() - t0, 1)
    return s


def run_case(R, v, case, base, rehost_url, args):
    out = {"case": case}
    if case == "a":
        ctx, pg, rec = R.case_page()
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, args.boot_timeout, t0, 0.5, stop=lambda s: s.get("lc"))
        lc = snaps[-1].get("lc") if snaps else False
        if not lc and rec["refused"]:
            raise C.EnvFailure("server refused %d requests" % len(rec["refused"]))
        pg.wait_for_timeout(1500)
        errs = pg.evaluate("() => window.__H_ERR__ || []")
        fail = first(snaps, lambda s: failure_text(s))
        out.update(bootS=snaps[-1]["wall"] if snaps else None, pageerrors=rec["pageerrors"], failed=rec["failed"], windowErrors=errs)
        v.check("a: normal boot reaches the menu", bool(lc), {"bootS": out["bootS"]})
        v.check("a: 0 page/window errors, 0 failed requests", not (rec["pageerrors"] or rec["failed"] or errs),
                {"pageerrors": rec["pageerrors"][:3], "failed": rec["failed"][:5], "windowErrors": errs[:3]})
        v.check("a: no failure card during a normal boot", fail is None, failure_text(fail) if fail else "none")
        R.close_ctx(ctx)
    elif case in ("b1", "b2", "b3"):
        target = "**/runtime/3d/royale/hud.js*" if case == "b2" else "**/runtime/3d/ffg_boot3d.js*"
        name = "hud.js" if case == "b2" else "ffg_boot3d.js"
        ctx, pg, rec = R.case_page()
        ctx.route(target, lambda r: r.fulfill(status=404, body="Not found", headers={"Cache-Control": "no-store"}))
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, 12, t0, 0.25)
        card = first(snaps, lambda s: failure_text(s))
        if case in ("b1", "b2"):
            limit = 5.0 if case == "b1" else 10.0
            # budget on the IN-PAGE card clock (page time since navigation start); wall is information
            ok_card, bd = budget(card, limit)
            txt = failure_text(card) if card else None
            # the file + status sit on the card's OTHER lines ("  runtime/3d/ffg_boot3d.js  (HTTP 404)"), which carry no
            # failure word, and the status arrives a moment later (one GET): judge the whole card text within the window
            full = lambda sn: ((sn or {}).get("text") or "") + "\n" + ((sn or {}).get("tip") or "")  # noqa: E731
            want = (lambda t: name in t and "404" in t) if case == "b1" else (lambda t: name in t and "jsdelivr" not in t.lower())
            named = first(snaps, lambda sn: failure_text(sn) and want(full(sn)))
            v.check("%s: a failure card within %d s" % (case, limit), ok_card if card is not None else False,
                    dict(bd, text=txt, lastTip=snaps[-1].get("tip") if snaps else None))
            v.check("%s: the card names %s%s" % (case, name, " + HTTP 404" if case == "b1" else " (not jsdelivr)"), named is not None,
                    {"at": named["wall"] if named else None, "card": (full(named) if named else full(card) if card else "")[:300]})
            s45 = still_at(R, pg, t0, args.t45)
            navs = rec["navs"]
            if case == "b1":
                v.check("b1: exactly one automatic reload", len(navs) == 2, {"mainFrameNavigations": navs})
            else:
                v.info("b2: main-frame navigations (one auto retry is allowed)", navs)
            v.check("%s: the failure message is still on screen at t%d" % (case, args.t45),
                    bool(failure_text(s45)) and "still loading" not in ((s45.get("tip") or "") + s45.get("text", "")).lower(),
                    {"tip": s45.get("tip"), "text": (s45.get("text") or "")[:200]})
            out.update(card=txt, navs=navs, t45=s45.get("tip") or (s45.get("text") or "")[:200])
        else:
            # b3: let the one allowed retry happen (if the build does it), then navigate the SAME tab again: the retry
            # flag lives in this tab's sessionStorage, so no further automatic reload may happen.
            pg.wait_for_timeout(8000)
            n_before = len(rec["navs"])
            t1 = time.time()
            R.goto(pg, base)
            snaps2 = R.watch(pg, 20, t1, 0.25)
            card2 = first(snaps2, lambda s: failure_text(s))
            extra = rec["navs"][n_before + 1:]
            v.check("b3: retry already spent -> a failure card", card2 is not None, failure_text(card2) if card2 else snaps2[-1].get("tip"))
            v.check("b3: retry already spent -> no automatic reload", not extra, {"navsAfterManualReload": extra, "allNavs": rec["navs"]})
            out.update(navs=rec["navs"])
        R.close_ctx(ctx)
    elif case == "c":
        ctx, pg, rec = R.case_page()
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 150, "downloadThroughput": 150 * 1000 / 8,
                                                      "uploadThroughput": 150 * 1000 / 8})
        cdp.send("Network.setCacheDisabled", {"cacheDisabled": True})
        t0 = time.time()
        R.goto(pg, base)
        viol = []
        last_bytes, last_grow = 0, 0.0
        snaps = []
        while time.time() - t0 < args.c_budget:
            s = R.snap(pg)
            s["wall"] = round(time.time() - t0, 1)
            snaps.append(s)
            if (s.get("bytes") or 0) > last_bytes:
                last_bytes, last_grow = s["bytes"], s["wall"]
            if s.get("lc"):
                break
            growing = s["wall"] - last_grow < 20
            if growing and (reload_advice(s) or failure_text(s)):
                viol.append({"wall": s["wall"], "tip": s.get("tip"), "fail": failure_text(s), "bytes": s.get("bytes")})
                if not args.full:
                    break
            pg.wait_for_timeout(1000)
        lc = snaps[-1].get("lc") if snaps else False
        v.check("c: slow link - no failure card / 'reload' advice while bytes are still arriving", not viol,
                viol[:3] or {"bytesAtEnd": last_bytes})
        if viol and not args.full:
            v.info("c: stopped at the first violation (use --full to watch to the menu)", snaps[-1].get("wall"))
        else:
            v.check("c: slow link - the menu arrives (within %d s)" % args.c_budget, bool(lc), {"wall": snaps[-1]["wall"] if snaps else None})
        out.update(violations=viol, bytes=last_bytes)
        R.close_ctx(ctx)
    elif case == "d":
        ctx, pg, rec = R.case_page()
        hang = []
        ctx.route(lambda url: ("cdn.jsdelivr.net" in url) or bool(re.search(r"/three(\.module|\.core)(\.min)?\.js", url)), lambda r: hang.append(r))
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, args.stall_budget, t0, 1.0, stop=lambda s: bool(failure_text(s)) and s["wall"] >= 55)
        early = first(snaps, lambda s: s["wall"] < 60 and reload_advice(s) and not failure_text(s))
        term = first(snaps, lambda s: failure_text(s))
        v.check("d: three never answers - no 'reload' advice before the 60 s stall verdict", early is None,
                {"at": early["wall"], "tip": early.get("tip")} if early else "none")
        v.check("d: three never answers - a terminal card by %d s" % args.stall_budget, term is not None,
                {"at": term["wall"], "text": failure_text(term)} if term else {"lastTip": snaps[-1].get("tip") if snaps else None})
        out.update(hung=len(hang))
        R.close_ctx(ctx)
    elif case == "e":
        ctx, pg, rec = R.case_page()
        ctx.route("**/cdn.jsdelivr.net/**", lambda r: r.abort("blockedbyclient"))
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, min(args.boot_timeout, 150), t0, 0.5, stop=lambda s: s.get("lc") or (bool(failure_text(s)) and s["wall"] > 20))
        s = snaps[-1] if snaps else {}
        v.check("e: jsdelivr blocked - the game still boots", bool(s.get("lc")),
                {"wall": s.get("wall"), "fail": failure_text(s), "tip": s.get("tip")})
        v.check("e: jsdelivr blocked - zero jsdelivr resource entries", bool(s.get("lc")) and s.get("jsdelivr") == 0,
                {"jsdelivrEntries": s.get("jsdelivr"), "jsdelivrRequests": len([x for x in rec["requests"] if "jsdelivr" in x])})
        R.close_ctx(ctx)
    elif case == "g":
        ctx, pg, rec = R.case_page("nowebgl", ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"])
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, 20, t0, 0.25, stop=lambda s: bool(failure_text(s)) and s["wall"] > 3)
        card = first(snaps, lambda s: failure_text(s))
        three_req = [x for x in rec["requests"] if re.search(r"three(\.module|\.core)(\.min)?\.js", x)]
        wcard = first(snaps, lambda s: re.search(r"webgl", failure_text(s) or "", re.I))
        ok, bd = budget(wcard, 2.0, lambda ln: re.search(r"webgl", ln, re.I))
        v.check("g: no WebGL - a card mentioning WebGL within 2 s", ok if wcard else False,
                dict(bd, text=failure_text(wcard or card) if (wcard or card) else None))
        v.check("g: no WebGL - three is never requested", not three_req, three_req[:3])
        R.close_ctx(ctx)
    elif case == "h":
        ctx, pg, rec = R.case_page()
        t0 = time.time()
        R.goto(pg, rehost_url)
        snaps = R.watch(pg, 6, t0, 0.2)
        card = first(snaps, lambda s: failure_text(s))
        # PLAN L9: the sitelock check runs BEFORE the engine import. The engine = every runtime/ module but the entry
        # (kernel, royale, sim). index.html's own modulepreload of three (L9: issued from the head, skipped without
        # WebGL 2) is not the engine and is allowed - the 22:24 working-copy run requested only those two files.
        req = [x for x in rec["requests"] if "/runtime/" in x and "ffg_boot3d.js" not in x]
        lcard = first(snaps, lambda s: re.search(r"licen", failure_text(s) or "", re.I))
        ok, bd = budget(lcard, 1.0, lambda ln: re.search(r"licen", ln, re.I))
        v.check("h: sitelock - the licence card within 1 s", ok if lcard else False,
                dict(bd, text=failure_text(lcard or card) if (lcard or card) else None))
        v.check("h: sitelock - the engine (runtime/ beyond ffg_boot3d.js) is never requested", not req, {"n": len(req), "first": req[:4]})
        s45 = still_at(R, pg, t0, args.t45)
        v.check("h: sitelock - the licence message is still on screen at t%d" % args.t45,
                bool(re.search(r"licen", failure_text(s45) or "", re.I)) and "still loading" not in (s45.get("tip") or "").lower(),
                {"tip": s45.get("tip"), "text": (s45.get("text") or "")[:160]})
        R.close_ctx(ctx)
    elif case == "i":
        ctx, pg, rec = R.case_page()
        ctx.route("**/last-circle/content.json*", lambda r: r.fulfill(status=404, body="Game not found"))
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, 15, t0, 0.25, stop=lambda s: bool(failure_text(s)))
        card = first(snaps, lambda s: failure_text(s))
        ok, bd = budget(card, 10.0)
        v.check("i: content.json 404 - a terminal card within 10 s", ok if card else False,
                dict(bd, text=failure_text(card) if card else None))
        s45 = still_at(R, pg, t0, args.t45)
        v.check("i: content.json 404 - the message is still on screen at t%d" % args.t45,
                bool(failure_text(s45)) and "still loading" not in (s45.get("tip") or "").lower(),
                {"tip": s45.get("tip"), "text": (s45.get("text") or "")[:160]})
        R.close_ctx(ctx)
    elif case in ("j", "k", "l1", "l2", "m"):
        ctx, pg, rec = R.case_page()
        if case == "m":
            ctx.route("**/esm.sh/**", lambda r: r.abort("blockedbyclient"))
        t0 = time.time()
        R.goto(pg, base)
        if R.wait_lc(pg, args.boot_timeout) is None:
            if rec["refused"]:
                raise C.EnvFailure("server refused requests before the menu")
            v.cnj("%s: menu never reached" % case, "cannot inject the fault (tip %r)" % R.snap(pg).get("tip"))
            R.close_ctx(ctx)
            return out
        pg.wait_for_timeout(1500)
        before = R.snap(pg)
        if case in ("j", "k") and args.plant:
            v.note("%s: PLANTED FAULT %s" % (case, pg.evaluate(PLANT_JS[args.plant])))
        if case == "j":
            ok_raf = pg.evaluate("() => new Promise((res) => { const a = window.__H_FRAMES__; setTimeout(() => res(window.__H_FRAMES__ - a), 3000); })")
            kr = pg.evaluate("() => { const k = window.__LC__.W.kernel; window.__H_THREW__ = null; let once = true;"
                             " k._updaters.push(() => { if (once) { once = false; window.__H_THREW__ = performance.now(); throw new Error('INJECTED frame fault (bootguard j)'); } });"
                             " return { running: !!k._running, frames: k.renderer.info.render.frame }; }")
            thrown = None
            t1 = time.time()
            while time.time() - t1 < 20:
                thrown = pg.evaluate("() => window.__H_THREW__")
                if thrown:
                    break
                pg.wait_for_timeout(100)
            if not thrown:
                v.cnj("j: frame throw -> card within 1 s", "the injected updater never ran in 20 s (rAF frames in 3 s before: %s, kernel %s)" % (ok_raf, kr))
            else:
                snaps = []
                t2 = time.time()
                while time.time() - t2 < 6:
                    s = R.snap(pg)
                    s["sinceThrowMs"] = round(pg.evaluate("(t) => performance.now() - t", thrown))
                    snaps.append(s)
                    if visible_card(s, before.get("text")):
                        break
                    pg.wait_for_timeout(100)
                card = first(snaps, lambda s: visible_card(s, before.get("text")))
                txt = first(snaps, lambda s: failure_text(s, before.get("text")))
                last = snaps[-1] if snaps else {}
                fr = pg.evaluate("() => new Promise((res) => { const k = window.__LC__.W.kernel, a = k.renderer.info.render.frame; setTimeout(() => res({ a, b: k.renderer.info.render.frame, running: !!k._running, lastError: k.lastError || null }), 1500); })")
                # the budget is judged on the IN-PAGE card clock (card stamp - throw stamp, both performance.now()); the
                # snapshot only has to CONFIRM the card is visible and topmost (harness polling latency is not the game's)
                pm = page_ms(card, None, before.get("text")) if card else None
                since = round(pm - thrown) if pm is not None else None
                v.check("j: frame throw -> a visible error card within 1 s", bool(card and since is not None and since <= 1000),
                        {"card": visible_card(card, before.get("text")) if card else None, "cardStampSinceThrowMs": since,
                         "harnessSawAtMs": card["sinceThrowMs"] if card else None,
                         "where": card_where(card or last), "textOnlyAtMs": txt["sinceThrowMs"] if txt else None, "framesAfter": fr})
                out.update(card=visible_card(card, before.get("text")) if card else None, where=card_where(card or last))
        elif case == "k":
            r = pg.evaluate("() => { const rd = window.__LC__.W.kernel.renderer, gl = rd.getContext(); const e = gl.getExtension('WEBGL_lose_context');"
                            " if (!e) return 'no ext'; window.__H_RESTORED__ = null; window.__H_LOSTEVT__ = null;"
                            " window.addEventListener('webglcontextlost', () => { if (!window.__H_LOSTEVT__) window.__H_LOSTEVT__ = performance.now(); }, true);"
                            " rd.domElement.addEventListener('webglcontextrestored', () => { window.__H_RESTORED__ = performance.now(); });"
                            " window.__H_LCX__ = e; window.__H_LOST__ = performance.now(); e.loseContext(); return 'lost'; }")
            if r != "lost":
                v.cnj("k: context lost -> card", "WEBGL_lose_context unavailable (%s)" % r)
            else:
                snaps = R.watch(pg, 6, time.time(), 0.1, stop=lambda s: bool(visible_card(s, before.get("text"))))
                card = first(snaps, lambda s: visible_card(s, before.get("text")))
                txt = first(snaps, lambda s: failure_text(s, before.get("text")))
                last = snaps[-1] if snaps else {}
                # anchor: the browser's DELIVERY of webglcontextlost (capture-phase stamp, before the game's own listener);
                # loseContext() is asynchronous and on a starved box the event can arrive seconds after the call
                lost, evt = pg.evaluate("() => [window.__H_LOST__, window.__H_LOSTEVT__]")
                anchor = evt or lost
                pm = page_ms(card, None, before.get("text")) if card else None
                since = round(pm - anchor) if (pm is not None and anchor) else None
                v.check("k: context lost -> a card within 1 s", bool(card and since is not None and since <= 1000),
                        {"cardStampSinceLossEventMs": since, "lossCallToEventMs": round(evt - lost) if (evt and lost) else None,
                         "harnessSawAtWallS": card["wall"] if card else None, "text": visible_card(card, before.get("text")) if card else None,
                         "where": card_where(card or last), "textOnlyAt": txt["wall"] if txt else None})
                # information: which card the player got. A frame that runs between loseContext() and the event's delivery
                # can throw inside three (a lost context returns null info logs) and put up the generic frame-error card
                ttl = (visible_card(card, before.get("text")) or "") if card else ""
                first_title = ttl.split(" | ")[0] if ttl else None
                v.info("k: the card's first title (context-loss wording vs a generic frame error)",
                       {"first": first_title, "contextLossWording": bool(re.search(r"interrupted|graphics|context", first_title or "", re.I))})
                out.update(card=visible_card(card, before.get("text")) if card else None, where=card_where(card or last))
                n0 = len(rec["navs"])
                try:
                    pg.evaluate("() => { try { window.__H_LCX__.restoreContext(); return 'restored'; } catch (e) { return String(e); } }")
                except Exception:
                    pass
                # the reload budget runs from the browser's RESTORE event (stamped in-page): a browser that has not restored
                # the context yet (a contended GPU) is not a game failure -> could-not-judge after 30 s
                t3 = time.time()
                restored_wall = None
                while len(rec["navs"]) == n0:
                    if restored_wall is None:
                        try:
                            if pg.evaluate("() => window.__H_RESTORED__"):
                                restored_wall = time.time()
                        except Exception:
                            pass
                    if restored_wall is not None and time.time() - restored_wall > 10:
                        break
                    if restored_wall is None and time.time() - t3 > 30:
                        break
                    pg.wait_for_timeout(250)
                if len(rec["navs"]) > n0:
                    v.check("k: context restored -> the page reloads within 10 s", True,
                            {"navs": rec["navs"][n0:], "reloadAfterRestoreCallS": round(time.time() - t3, 1)})
                elif restored_wall is None:
                    v.cnj("k: context restored -> the page reloads within 10 s",
                          "the browser never fired webglcontextrestored within 30 s of restoreContext() (GPU contention)")
                else:
                    v.check("k: context restored -> the page reloads within 10 s", False,
                            {"navs": [], "restoredFired": True, "waitedAfterRestoreS": round(time.time() - restored_wall, 1)})
        elif case in ("l1", "l2"):
            # Every in-memory model cache on the kernel (*Cache / *Inflight: _charCache, _gltfCache, _charInflight, ...) is
            # emptied so the match start must FETCH its models, and every GLB request from now on is answered by the fault
            # and COUNTED. The 35 s budget runs from the first faulted answer (the game cannot react earlier; on a starved
            # box the map build alone took > 35 s - L4A run 2, 02:11). If the game never asked for a GLB within --l-reach s
            # the fault never reached it (environment, CNJ); if the match loaded anyway (an un-cleared cache served the
            # models - L4A run 1 on the moving tree) the case was not exercised (CNJ, with the count).
            cleared = pg.evaluate("() => { const k = window.__LC__.W.kernel, out = [];"
                                  " for (const name of Object.keys(k)) { if (!/(Cache|Inflight)$/.test(name)) continue; const c = k[name];"
                                  "   if (c instanceof Map) { out.push(name + ':' + c.size); c.clear(); }"
                                  "   else if (c && typeof c === 'object' && !Array.isArray(c)) { out.push(name + ':' + Object.keys(c).length); for (const key in c) delete c[key]; } }"
                                  " return out; }")
            fault = {"hits": 0, "first": None, "urls": []}

            # ONE positional parameter: Playwright passes (route, request) to a handler that accepts two, which is how
            # a default-argument closure here once swallowed every GLB request unanswered (the map build then hung)
            def glb_fault(route):
                fault["hits"] += 1
                if fault["first"] is None:
                    fault["first"] = time.time()
                if len(fault["urls"]) < 6:
                    fault["urls"].append(route.request.url.split("?")[0].rsplit("/", 1)[-1])
                if case == "l1":
                    route.fulfill(status=404, body="Game not found")
                else:
                    route.abort("internetdisconnected")
            ctx.route("**/*.glb*", glb_fault)
            pg.evaluate("() => { window.__H_SMR__ = 'pending'; window.__LC__.startMatch({ mode: 'standard', seed: 11 })"
                        ".then(() => { window.__H_SMR__ = 'resolved'; }, (e) => { window.__H_SMR__ = 'rejected: ' + (e && e.message || e); }); return 1; }")
            t4 = time.time()
            ok = None
            loaded = False
            s = None
            while True:
                s = R.snap(pg)
                if s.get("phase") == "menu" and failure_text(s, before.get("text")):
                    ok = time.time()
                    break
                smr = R.safe_eval(pg, "() => window.__H_SMR__")
                # 'loaded' = startMatch resolved, the match phase is up AND the loading layer (hud data-lc="loadfill") is
                # gone: the final 03:00 gate run saw startMatch resolve with the screen still stuck on LOADING OPERATIVES 18/90
                loading = R.safe_eval(pg, "() => { const f = document.querySelector('[data-lc=\"loadfill\"]'); return !!(f && f.offsetParent); }")
                if smr == "resolved" and s.get("phase") in ("lobby", "drop", "match") and loading is False:
                    loaded = True
                    break
                if fault["first"] is not None and time.time() - fault["first"] > 35:
                    break
                if fault["first"] is None and time.time() - t4 > args.l_reach:
                    break
                pg.wait_for_timeout(500)
            name = "%s: GLB %s at match start -> back to the menu with a notice within 35 s" % (case, "404" if case == "l1" else "abort")
            det = {"sinceFirstFaultS": round(ok - fault["first"], 1) if (ok and fault["first"]) else None,
                   "sinceStartMatchS": round((ok or time.time()) - t4, 1), "faultedGlbRequests": fault["hits"], "faultedUrls": fault["urls"],
                   "cachesCleared": cleared, "phase": (s or {}).get("phase"), "startMatch": R.safe_eval(pg, "() => window.__H_SMR__"),
                   "notice": failure_text(s, before.get("text")) if s else None, "screen": ((s or {}).get("text") or "")[:160]}
            if ok is not None and fault["first"] is not None:
                v.check(name, ok - fault["first"] <= 35, det)
            elif loaded:
                v.cnj(name, "the match loaded anyway (startMatch resolved, loading layer gone) after %d faulted GLB request(s): the game did "
                            "not need the faulted models (an un-cleared cache or a built-in fallback), so the case was not exercised: %s" % (fault["hits"], det))
            elif fault["first"] is None:
                v.cnj(name, "the game never requested a GLB within %d s of startMatch (map build still running on a starved box?): %s" % (args.l_reach, det))
            else:
                v.check(name, False, det)
        elif case == "m":
            # first visit: HOW TO PLAY covers the menu - close it like a player (GOT IT), or every click below is eaten
            for _ in range(3):
                g = pg.evaluate("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^\\s*GOT IT\\s*$/i.test(x.textContent || '')); if (!b) return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
                if not g:
                    break
                pg.mouse.click(g[0], g[1])
                pg.wait_for_timeout(600)
            # the control reads "🌐  SQUAD UP" (hud.js mkGhost): allow a leading glyph
            opened = pg.evaluate("() => { const b = [...document.querySelectorAll('button, .lc-mode-card, div')].find((x) => x.offsetParent && /^[^A-Za-z0-9]*SQUAD UP\\s*$/i.test(x.textContent || '')); if (!b) return false; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
            if opened:
                pg.mouse.click(opened[0], opened[1])
            else:
                pg.evaluate("() => window.__LC__.W.events.emit('openOnline', { mode: 'standard' })")
                v.note("m: no SQUAD UP control found by text; opened the online panel through W.events 'openOnline' (setup only)")
            pg.wait_for_timeout(1000)
            try:
                pg.get_by_text("CREATE ROOM", exact=True).first.click(timeout=15000)
            except Exception as e:
                v.cnj("m: esm.sh blocked -> error + enabled buttons", "CREATE ROOM not clickable: %s" % str(e).splitlines()[0][:160])
                R.close_ctx(ctx)
                return out
            t5 = time.time()
            s = None
            ok = None
            while time.time() - t5 < 10:
                s = R.snap(pg)
                btn = [b for b in s.get("buttons", []) if re.search(r"CREATE ROOM|JOIN", b)]
                if failure_text(s, before.get("text")) and btn and not any(b.endswith(":disabled") for b in btn):
                    ok = round(time.time() - t5, 1)
                    break
                pg.wait_for_timeout(250)
            v.check("m: esm.sh blocked -> an error text and enabled buttons within 10 s", ok is not None,
                    {"at": ok, "buttons": [b for b in (s or {}).get("buttons", []) if re.search(r"CREATE|JOIN", b)],
                     "notice": failure_text(s, before.get("text")) if s else None, "pageerrors": rec["pageerrors"][:2]})
        R.close_ctx(ctx)
    else:
        v.cnj("%s: unknown case" % case, "valid: %s" % ",".join(ALL))
    return out


if __name__ == "__main__":
    sys.exit(main())
