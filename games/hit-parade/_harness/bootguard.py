#!/usr/bin/env python
"""HIT PARADE boot-guard gate (CONTRACT §13 G7, with menus.py): proves the classic boot guard at the top of
runtime/index.html (HEADLESS only). Adapted from dyefield/_harness/bootguard.py (TECH_REUSE (b)).

    python _harness/bootguard.py                          # vite build -> temp dir, serve it, cases a b c d, then e (dev)
    python _harness/bootguard.py --out-dir <dir>          # build into <dir> (never the game's dist/: another lane may build)
    python _harness/bootguard.py --dist <dir>             # test an existing build, no build step
    python _harness/bootguard.py --base <index URL>       # test a hosted build, e.g. the live CDN index.html
    python _harness/bootguard.py --cases a,b2,d --no-dev  # a subset (--report <name> writes _reports/<name>.json)
    python _harness/bootguard.py --shell-only             # HP_SHELL_ENTRY=1: index.html's /src/main.ts is the lab
                                                          # src/lab/shell_entry.ts (real guard + SHELL modules, no
                                                          # other lane's code) for the build AND the dev cases

Every fault is injected CLIENT-SIDE (Playwright page.route / CDP throttling), so a hosted base (the live CDN)
only ever sees ordinary GET / HEAD requests: nothing is written anywhere. A local build is served by a small
python static server on a free port under /hit-parade/ (the CDN's sub-path) with Cache-Control: no-store.

Cases (a fresh browser context each, so the sessionStorage retry flag starts cleared):
  a   normal boot: no guard card ever, window.__HP_MAIN__ < 15 s, zero page errors, the title screen (phase 'title'
      or 'menu'); after __HP_BOOT__.handoff() the guard is gone (a failing <script> added later raises no card, no reload).
  b1  the entry chunk (<script type=module>) forced 404 -> "HIT PARADE could not load" within 5 s naming the
      file + HTTP 404, then EXACTLY ONE automatic cache-busting retry (?hpretry=a..., stripped again), whose
      card comes within 5 s and does not retry again.
  b2  the same for a modulepreload chunk (vendor-three).
  b3  b2 with the retry flag already set in sessionStorage -> the card, no automatic retry.
  b4  the stylesheet forced 404 -> the card + one retry; on the retry load main.ts runs, but the card stays
      (an unstyled game is not a working game).
  c   slow path: CDP throttling so the entry graph takes longer than the scaled visible-time threshold while
      bytes still arrive (?bootguard=<scale>) -> NO failure card, the status line says "slow connection", the
      watchdog's HEAD probe was answered, main.ts starts.
  d   stalled path: the vendor-three request never completes (a route that never fulfils) -> "HIT PARADE
      did not start" after the scaled threshold (visible 60 s + quiet 20 s + probe), listing it as pending.
  f   hidden time does not count: d, but the page reports visibilityState 'hidden' for 15 s (emulated: headless
      Chrome keeps a background page 'visible') -> no card while hidden, the card >= 9 s after it turns visible.
  e1  vite dev server (--dev-base, auto-started with HP_FROZEN=1 on :5322 and stopped after): normal boot.
  e2  dev, /src/main.ts stalled -> the stall card WITH the dev hint ("npm run dev"). Build cards must not
      carry that hint (checked in b and d).
  e3  dev, /src/main.ts forced 404 -> "could not load" with the dev hint.
Writes _harness/_reports/bootguard.json. Exit 0 only when every selected case passes (1 = a case failed,
2 = setup failed: build / server / browser).
"""
from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from common import FLAGS, REPORTS, ROOT, HarnessError, ensure_server, stop_server, url_reachable as url_up  # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PREFIX = "/hit-parade/"
SCALE = 0.15                      # ?bootguard=0.15 -> visible 9 s, quiet 3 s, slow line 2.25 s, cap 36 s, probe 3 s
VISIBLE_MS = 60000 * SCALE
QUIET_MS = 20000 * SCALE
PROBE_MS = max(3000, 10000 * SCALE)
CAP_MS = 240000 * SCALE
DEV_HINT = "npm run dev"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0 Safari/537.36 hit-parade-bootguard"
# (Cloudflare answers python-urllib's default User-Agent with 403, so every direct fetch sends a browser UA)
DEFAULT_OUT = os.path.join(tempfile.gettempdir(), "ffg_hitparade_bootguard_dist")   # fixed name: reused, never leaked

# per document: when __HP_MAIN__ was set (a setter trap), every guard card title (+ its text) and every
# distinct .hp-status text, all on that document's performance clock
INIT = r"""
(() => {
  if (window.__BG_INIT__) return; window.__BG_INIT__ = true;
  const M = window.__BG__ = { tMain: null, cards: [], statuses: [], errs: [] };
  let v;
  try {
    Object.defineProperty(window, '__HP_MAIN__', { configurable: true,
      get() { return v; }, set(x) { v = x; if (x && M.tMain === null) M.tMain = performance.now(); } });
  } catch (e) { M.errs.push('trap: ' + e); }
  const scan = () => {
    const h = document.querySelector('#hp-boot h2');
    const t = h ? h.textContent : null;
    const pre = document.querySelector('#hp-boot pre');
    const last = M.cards[M.cards.length - 1];
    if (t && (!last || last.title !== t)) M.cards.push({ title: t, t: Math.round(performance.now()), text: pre ? pre.textContent : '' });
    else if (t && last && pre && last.text !== pre.textContent) last.text = pre.textContent;
    const st = document.querySelector('#hp-boot .hp-status');
    const s = st ? st.textContent : null;
    if (s && M.statuses.indexOf(s) < 0 && M.statuses.length < 80) M.statuses.push(s);
  };
  new MutationObserver(scan).observe(document, { childList: true, subtree: true, characterData: true });
  addEventListener('error', (e) => { if (e.target === window) M.errs.push(String(e.message || e)); });
  addEventListener('unhandledrejection', (e) => { const r = e.reason; M.errs.push('unhandledrejection: ' + String(r && (r.stack || r.message) || r)); });
})();
"""

SNAP = """() => {
  const M = window.__BG__ || {};
  let phase = null; try { phase = window.__HP__ && window.__HP__.state ? window.__HP__.state().phase : null; } catch (e) { phase = 'state() threw'; }
  let info = null; try { info = window.__HP_BOOT__ && window.__HP_BOOT__.info ? window.__HP_BOOT__.info() : null; } catch (e) { info = { error: String(e) }; }
  const h = document.querySelector('#hp-boot h2');
  let cardVisible = false;
  if (h) { const r = h.getBoundingClientRect(); cardVisible = r.width > 0 && r.height > 0 && getComputedStyle(h).visibility !== 'hidden'; }
  return { origin: performance.timeOrigin, now: Math.round(performance.now()), href: location.href,
           tMain: M.tMain == null ? null : Math.round(M.tMain), cards: M.cards || [], statuses: M.statuses || [], errs: M.errs || [],
           phase, info, cardVisible };
}"""


# ─────────────────────────────── build + serve ───────────────────────────────
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def build(out_dir, env_extra=None):
    out_dir = os.path.abspath(out_dir)
    if os.path.normcase(out_dir) == os.path.normcase(os.path.join(ROOT, "dist")):
        raise HarnessError("refusing to build into the game's dist/ (another lane may build there): pass --out-dir elsewhere")
    cmd = 'npx vite build --outDir "%s"' % out_dir
    print("build        : %s" % cmd, flush=True)
    t0 = time.time()
    env = dict(os.environ, PYTHONIOENCODING="utf-8", FORCE_COLOR="0", NO_COLOR="1")
    if env_extra:
        env.update(env_extra)
        print("build env    : %s" % " ".join("%s=%s" % kv for kv in env_extra.items()), flush=True)
    r = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace",
                       timeout=600, env=env)
    if r.returncode != 0:
        raise HarnessError("vite build failed (exit %d):\n%s" % (r.returncode, ((r.stdout or "") + (r.stderr or ""))[-2500:]))
    if not os.path.isfile(os.path.join(out_dir, "index.html")):
        raise HarnessError("vite build wrote no index.html into %s" % out_dir)
    print("build        : ok in %.1f s -> %s" % (time.time() - t0, out_dir), flush=True)
    return out_dir


class _Static(http.server.SimpleHTTPRequestHandler):
    """The built dist under /hit-parade/ with the CDN's relevant traits: no-store, JS as application/javascript
    (the Windows registry can map .js to text/plain, which a module script refuses)."""
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{
        ".js": "application/javascript", ".mjs": "application/javascript", ".css": "text/css", ".html": "text/html",
        ".json": "application/json", ".wasm": "application/wasm", ".glb": "model/gltf-binary", ".webp": "image/webp",
        ".png": "image/png", ".ogg": "audio/ogg", ".woff2": "font/woff2", ".woff": "font/woff", ".svg": "image/svg+xml"})

    def translate_path(self, path):
        p = urllib.parse.urlsplit(path).path
        if not p.startswith(PREFIX):
            return os.path.join(self.directory, "__not_served__")
        return super().translate_path("/" + p[len(PREFIX):])

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


class _Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # the browser aborts requests on purpose (the guard's probes read headers only; contexts close mid-load)
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def serve(dist):
    port = free_port()
    srv = _Server(("127.0.0.1", port), functools.partial(_Static, directory=dist))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, "http://127.0.0.1:%d%sindex.html" % (port, PREFIX)


def entry_files(index_url):
    """(entry script, [modulepreload chunks], [stylesheets]) as absolute URLs, read from the served index.html."""
    with urllib.request.urlopen(urllib.request.Request(index_url, headers={"User-Agent": UA}), timeout=20) as r:
        html = r.read().decode("utf-8", "replace")
    js = re.findall(r'<script[^>]*type="module"[^>]*src="([^"]+)"', html)
    pre = re.findall(r'<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"', html)
    css = re.findall(r'<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"', html)
    absu = lambda u: urllib.parse.urljoin(index_url, u)
    return ([absu(u) for u in js], [absu(u) for u in pre], [absu(u) for u in css], html)


def with_query(url, **params):
    sp = urllib.parse.urlsplit(url)
    q = urllib.parse.parse_qsl(sp.query, keep_blank_values=True) + list(params.items())
    return urllib.parse.urlunsplit(sp._replace(query=urllib.parse.urlencode(q)))


def fname(url):
    return urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1]


# ─────────────────────────────── one case ───────────────────────────────
class Case:
    def __init__(self, browser, cid, title):
        self.id, self.title = cid, title
        self.checks = []
        self.page_errors, self.console_errors, self.http_errors, self.req_failed = [], [], [], []
        self.navs, self.heads = [], []
        self.docs = {}              # performance.timeOrigin -> latest snapshot of that document
        self.order = []             # timeOrigins in navigation order
        self.hung = []
        self.ctx = browser.new_context(viewport={"width": 1280, "height": 720})
        self.ctx.add_init_script(INIT)
        self.page = self.ctx.new_page()
        p = self.page
        p.on("pageerror", lambda e: self.page_errors.append(str(e)[:500]))
        p.on("console", self._console)
        p.on("request", self._request)
        p.on("response", lambda r: self.http_errors.append("HTTP %d %s" % (r.status, r.url)) if r.status >= 400 else None)
        p.on("requestfailed", lambda r: self.req_failed.append("%s %s" % (r.failure, r.url)))
        self.t0 = None

    def _console(self, m):
        if m.type == "error":
            self.console_errors.append(m.text[:300])

    def _request(self, r):
        try:
            if r.is_navigation_request() and r.frame == self.page.main_frame:
                self.navs.append({"t": round(time.time() - (self.t0 or time.time()), 2), "url": r.url})
            if r.method == "HEAD":
                self.heads.append(r.url)
        except Exception:
            pass

    def route(self, pattern, mode):
        def handler(route):
            if mode == "404":
                route.fulfill(status=404, content_type="text/plain;charset=UTF-8", body="Game not found")
            elif mode == "abort":
                route.abort("failed")
            else:                   # 'hang': never fulfilled (released at close)
                self.hung.append(route)
        self.page.route(pattern, handler)

    def throttle(self, kbps, latency_ms):
        cdp = self.ctx.new_cdp_session(self.page)
        cdp.send("Network.enable")
        bps = kbps * 1000 / 8
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": latency_ms,
                                                      "downloadThroughput": bps, "uploadThroughput": bps})

    def goto(self, url):
        self.t0 = time.time()
        self.url = url
        self.page.goto(url, wait_until="commit", timeout=60000)

    def snap(self):
        try:
            s = self.page.evaluate(SNAP)
        except Exception:
            return None
        o = s.get("origin")
        if o not in self.docs:
            self.order.append(o)
        self.docs[o] = s
        return s

    def watch(self, until, timeout_s, step_ms=120):
        """poll until until(case) is truthy or the timeout; pumps Playwright (route handlers) while waiting"""
        end = time.time() + timeout_s
        while time.time() < end:
            self.snap()
            if until(self):
                return True
            try:
                self.page.wait_for_timeout(step_ms)
            except Exception:
                time.sleep(step_ms / 1000.0)
        self.snap()
        return bool(until(self))

    def doc(self, i):
        return self.docs[self.order[i]] if len(self.order) > i else None

    def check(self, name, ok, detail=""):
        self.checks.append({"name": name, "ok": bool(ok), "detail": detail})
        print("   %s %s%s" % ("ok  " if ok else "FAIL", name, (" — " + str(detail)) if detail else ""), flush=True)
        return ok

    def close(self):
        for r in self.hung:
            try:
                r.abort()
            except Exception:
                pass
        try:
            self.ctx.close()
        except Exception:
            pass

    def result(self):
        ok = bool(self.checks) and all(c["ok"] for c in self.checks)
        docs = [self.docs[o] for o in self.order]
        return {"id": self.id, "title": self.title, "pass": ok, "url": getattr(self, "url", None), "checks": self.checks,
                "navigations": self.navs, "headProbes": self.heads, "pageErrors": self.page_errors,
                "consoleErrors": self.console_errors[:20], "httpErrors": self.http_errors[:20], "requestFailed": self.req_failed[:20],
                "documents": [{k: d.get(k) for k in ("href", "tMain", "cards", "statuses", "errs", "phase", "info", "now")} for d in docs]}


def first_card(d):
    return (d or {}).get("cards", [None])[0] if d and d.get("cards") else None


# ─────────────────────────────── the cases ───────────────────────────────
def case_a(br, url, dev=False):
    c = Case(br, "e1" if dev else "a", "%s: normal boot" % ("dev server" if dev else "build"))
    limit_main = 45000 if dev else 15000
    try:
        c.goto(url)
        c.watch(lambda k: (k.doc(0) or {}).get("phase") in ("title", "menu", "error") or first_card(k.doc(0)), 90)
        d = c.doc(0) or {}
        c.check("no guard card", not d.get("cards"), first_card(d))
        c.check("__HP_MAIN__ < %d s" % (limit_main // 1000), d.get("tMain") is not None and d["tMain"] < limit_main, "%s ms" % d.get("tMain"))
        c.check("title screen reached", d.get("phase") in ("title", "menu"), "phase %r" % d.get("phase"))
        info = d.get("info") or {}
        c.check("guard handed off", info.get("handedOff") is True, info)
        # after handoff the guard must be gone: a failing <script> of our own origin raises nothing
        c.page.evaluate("() => { const s = document.createElement('script'); s.src = './assets/__bootguard_after_handoff__.js'; document.head.appendChild(s); }")
        c.page.wait_for_timeout(2500)
        d = c.snap() or d
        c.check("after handoff a failing <script> raises no guard card / reload",
                not d.get("cards") and len(c.navs) == 1 and (d.get("info") or {}).get("card") == "", "cards %s, navigations %d" % (d.get("cards"), len(c.navs)))
        c.check("zero page errors", not c.page_errors and not d.get("errs"), (c.page_errors + (d.get("errs") or []))[:3])
    finally:
        c.close()
    return c


def case_load_fail(br, url, cid, target_url, flag_preset=False, stylesheet=False, dev=False):
    f = fname(target_url)
    title = "%s forced 404%s" % (f, " (retry flag already set)" if flag_preset else "")
    c = Case(br, cid, title)
    try:
        if flag_preset:
            c.ctx.add_init_script("try { if (!sessionStorage.getItem('hitparade.bootRetry')) sessionStorage.setItem('hitparade.bootRetry', '1'); } catch (e) {}")
        c.route(re.compile("^" + re.escape(target_url.split("?")[0]) + r"(\?.*)?$"), "404")
        c.goto(url)
        c.watch(lambda k: first_card(k.doc(0)) is not None, 10)
        d0 = c.doc(0) or {}
        card0 = first_card(d0) or {}
        c.check("'HIT PARADE could not load' within 5 s", card0.get("title") == "HIT PARADE could not load" and card0.get("t", 1e9) < 5000,
                "%r at %s ms" % (card0.get("title"), card0.get("t")))
        c.watch(lambda k: "HTTP 404" in ((first_card(k.doc(0)) or {}).get("text") or "") or len(k.order) > 1, 6)
        d0 = c.docs.get(c.order[0], d0)
        text0 = ((d0.get("cards") or [{}])[-1]).get("text") or ""
        c.check("the card names the file + HTTP 404", f in text0 and "HTTP 404" in text0, text0.splitlines()[:2])
        if dev:
            c.check("dev hint present", DEV_HINT in text0, "")
        else:
            c.check("no dev hint in a build", DEV_HINT not in text0, "")
        if flag_preset:
            c.check("says nothing about retrying", "Retrying once" not in text0, "")
            c.watch(lambda k: len(k.navs) > 1, 8)
            c.check("no automatic retry (flag set)", len(c.navs) == 1, [n["url"] for n in c.navs])
        else:
            c.check("announces the automatic retry", "Retrying once automatically" in text0, "")
            c.watch(lambda k: len(k.order) > 1 and first_card(k.doc(1)) is not None, 12)
            c.check("exactly one retry navigation (?hpretry=a...)", len(c.navs) >= 2 and "hpretry=a" in c.navs[1]["url"],
                    [n["url"] for n in c.navs])
            d1 = c.doc(1) or {}
            card1 = first_card(d1) or {}
            c.check("the retry load shows the card within 5 s", card1.get("title") == "HIT PARADE could not load" and card1.get("t", 1e9) < 5000,
                    "%r at %s ms" % (card1.get("title"), card1.get("t")))
            c.watch(lambda k: len(k.navs) > 2, 8)       # no second automatic retry
            d1 = c.doc(1) or d1
            text1 = ((d1.get("cards") or [{}])[-1]).get("text") or ""
            c.check("no second automatic retry (8 s)", len(c.navs) == 2, [n["url"] for n in c.navs])
            c.check("retry card: no 'Retrying', says 'after 1 auto-retry'", "Retrying once" not in text1 and "after 1 auto-retry" in text1,
                    text1.splitlines()[-1:] if text1 else "")
            c.check("the hpretry marker is stripped from the address bar", "hpretry" not in (d1.get("href") or "hpretry"), d1.get("href"))
            if stylesheet:
                c.watch(lambda k: ((k.doc(1) or {}).get("info") or {}).get("handedOff") is True, 30)
                d1 = c.doc(1) or d1
                c.check("main.ts ran on the retry load (handoff) and the card stayed",
                        (d1.get("info") or {}).get("handedOff") is True and d1.get("cardVisible") is True,
                        "handedOff %s, cardVisible %s" % ((d1.get("info") or {}).get("handedOff"), d1.get("cardVisible")))
    finally:
        c.close()
    return c


def case_slow(br, url, entry_bytes):
    # pick a throughput so the entry graph needs ~1.9x the scaled visible threshold (and stays under the cap)
    want_s = VISIBLE_MS / 1000.0 * 1.9
    kbps = max(200, int(entry_bytes * 8 / 1000 / want_s))
    c = Case(br, "c", "slow download (%d kbps, ~%.0f s for %.1f MB), ?bootguard=%s" % (kbps, want_s, entry_bytes / 1048576, SCALE))
    try:
        c.throttle(kbps, 150)
        c.goto(with_query(url, bootguard=SCALE))
        c.watch(lambda k: (k.doc(0) or {}).get("tMain") is not None or first_card(k.doc(0)) is not None, CAP_MS / 1000 + 30)
        c.watch(lambda k: False, 1.5)
        d = c.doc(0) or {}
        c.check("no failure card", not d.get("cards"), first_card(d))
        c.check("main.ts started", d.get("tMain") is not None, "%s ms" % d.get("tMain"))
        c.check("the load outlasted the visible threshold (%d s)" % (VISIBLE_MS / 1000), (d.get("tMain") or 0) > VISIBLE_MS,
                "main at %s ms" % d.get("tMain"))
        c.check("the status line showed progress + 'slow connection'",
                any("slow connection" in s for s in d.get("statuses") or []) and any(("MB" in s or "KB" in s) for s in d.get("statuses") or []),
                (d.get("statuses") or [])[-2:])
        c.check("the watchdog probed a pending file (HEAD) and got an answer", len(c.heads) >= 1, c.heads[:3])
        c.check("guard handed off", (d.get("info") or {}).get("handedOff") is True, "")
        c.check("zero page errors", not c.page_errors and not d.get("errs"), (c.page_errors + (d.get("errs") or []))[:3])
    finally:
        c.close()
    return c


def case_stall(br, url, target_url, cid="d", dev=False):
    f = fname(target_url)
    c = Case(br, cid, "%s never completes, ?bootguard=%s" % (f, SCALE))
    lo, hi = VISIBLE_MS, VISIBLE_MS + QUIET_MS + PROBE_MS + 6000
    try:
        c.route(re.compile("^" + re.escape(target_url.split("?")[0]) + r"(\?.*)?$"), "hang")
        c.goto(with_query(url, bootguard=SCALE))
        c.watch(lambda k: first_card(k.doc(0)) is not None, hi / 1000 + 10)
        c.watch(lambda k: False, 1.0)
        d = c.doc(0) or {}
        card = first_card(d) or {}
        text = ((d.get("cards") or [{}])[-1]).get("text") or ""
        c.check("'HIT PARADE did not start' after the scaled threshold (%.0f-%.0f s)" % (lo / 1000, hi / 1000),
                card.get("title") == "HIT PARADE did not start" and lo <= card.get("t", -1) <= hi, "%r at %s ms" % (card.get("title"), card.get("t")))
        pend = next((ln for ln in text.splitlines() if ln.startswith("Pending:")), "")
        loaded = next((ln for ln in text.splitlines() if ln.startswith("Loaded:")), "")
        c.check("the card lists the stalled file as pending", f in pend and f not in loaded, [loaded, pend])
        c.check("the card lists what did load", len(loaded) > len("Loaded:  -"), loaded)
        if dev:
            c.check("dev hint present", DEV_HINT in text, "")
        else:
            c.check("no dev hint in a build", DEV_HINT not in text, "")
        c.check("no automatic reload for a stall", len(c.navs) == 1, [n["url"] for n in c.navs])
        c.check("zero page errors", not c.page_errors, c.page_errors[:3])
    finally:
        c.close()
    return c


HIDDEN_JS = r"""
(() => {   // case f: document.visibilityState reads window.__BG_VIS__ ('hidden' until the harness flips it)
  window.__BG_VIS__ = 'hidden';
  try { Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__BG_VIS__ || 'visible'; } }); } catch (e) {}
  try { Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return (window.__BG_VIS__ || 'visible') !== 'visible'; } }); } catch (e) {}
})();
"""


def case_hidden(br, url, target_url, hidden_s=15.0):
    """Headless Chrome keeps a background page 'visible', so visibility is emulated: the page starts hidden with a
    stalled chunk; hidden time must not count toward the watchdog, the card may only come >= the scaled visible
    threshold after the page turns visible."""
    f = fname(target_url)
    c = Case(br, "f", "%s never completes while the page is HIDDEN for %.0f s, then visible (?bootguard=%s)" % (f, hidden_s, SCALE))
    try:
        c.ctx.add_init_script(HIDDEN_JS)
        c.route(re.compile("^" + re.escape(target_url.split("?")[0]) + r"(\?.*)?$"), "hang")
        c.goto(with_query(url, bootguard=SCALE))
        c.watch(lambda k: first_card(k.doc(0)) is not None, hidden_s)
        d = c.doc(0) or {}
        c.check("no card while hidden (%.0f s > the %.0f s visible threshold + probe)" % (hidden_s, (VISIBLE_MS + PROBE_MS) / 1000),
                not d.get("cards"), first_card(d))
        vis_ms = ((d.get("info") or {}).get("visibleMs"))
        c.check("the guard counted no visible time while hidden", vis_ms is not None and vis_ms < 500, "visibleMs %s" % vis_ms)
        t_flip = c.page.evaluate("() => { window.__BG_VIS__ = 'visible'; document.dispatchEvent(new Event('visibilitychange')); return Math.round(performance.now()); }")
        hi = VISIBLE_MS + QUIET_MS + PROBE_MS + 6000
        c.watch(lambda k: first_card(k.doc(0)) is not None, hi / 1000 + 10)
        d = c.doc(0) or {}
        card = first_card(d) or {}
        dt = (card.get("t") or 0) - t_flip
        c.check("'HIT PARADE did not start' only >= %.0f s after turning visible" % (VISIBLE_MS / 1000),
                card.get("title") == "HIT PARADE did not start" and VISIBLE_MS <= dt <= hi, "%r %d ms after the flip" % (card.get("title"), dt))
        text = ((d.get("cards") or [{}])[-1]).get("text") or ""
        pend = next((ln for ln in text.splitlines() if ln.startswith("Pending:")), "")
        c.check("the card lists the stalled file as pending", f in pend, pend)
    finally:
        c.close()
    return c


# ─────────────────────────────── main ───────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(description="HIT PARADE boot-guard gate (headless)")
    ap.add_argument("--dist", help="an existing build to serve (no build step)")
    ap.add_argument("--out-dir", default=DEFAULT_OUT, help="where to vite-build (default %(default)s; never the game's dist/)")
    ap.add_argument("--base", help="a hosted build's index.html URL (e.g. the live CDN) instead of a local build")
    ap.add_argument("--dev-base", default="http://localhost:5322/", help="vite dev server for cases e* (auto-started when down)")
    ap.add_argument("--no-dev", action="store_true", help="skip the dev-server cases e1-e3")
    ap.add_argument("--no-serve", action="store_true", help="never auto-start the dev server")
    ap.add_argument("--cases", default="a,b1,b2,b3,b4,c,d,f,e1,e2,e3")
    ap.add_argument("--shell-only", action="store_true",
                    help="HP_SHELL_ENTRY=1 for the build and the dev server: /src/main.ts = src/lab/shell_entry.ts (SHELL modules only)")
    ap.add_argument("--report", default="bootguard", help="report name under _harness/_reports (default %(default)s)")
    args = ap.parse_args()
    want = [x.strip() for x in args.cases.split(",") if x.strip()]
    if args.no_dev:
        want = [x for x in want if not x.startswith("e")]

    report = {"started": time.strftime("%Y-%m-%dT%H:%M:%S"), "scale": SCALE, "cases": [], "shellOnly": bool(args.shell_only)}
    shell_env = {"HP_SHELL_ENTRY": "1"} if args.shell_only else None
    if args.shell_only and args.out_dir == DEFAULT_OUT:
        args.out_dir = DEFAULT_OUT + "_shell"
    srv = dev_handle = None
    br = pw = None
    results = []
    try:
        try:
            if args.base:
                url = args.base
                report["base"] = url
            else:
                dist = os.path.abspath(args.dist) if args.dist else build(args.out_dir, shell_env)
                srv, url = serve(dist)
                report["dist"] = dist
            report["url"] = url
            js, pre, css, html = entry_files(url)
            if not js:
                raise HarnessError("no <script type=module src> in %s" % url)
            chunk = next((u for u in pre if "vendor-three" in u), pre[0] if pre else None)
            report["entry"] = {"script": js, "modulepreload": pre, "stylesheet": css}
            # the guard's install line vs the first REAL module / modulepreload / stylesheet tag (the guard's own
            # comment mentions those tags, so match tags that carry a src / href)
            g_at = html.find("W.__HP_BOOT__ = {")
            tag = re.search(r'<script[^>]*type="module"[^>]*src=|<link[^>]*rel="(?:modulepreload|stylesheet)"[^>]*href=', html)
            guard_first = g_at >= 0 and tag is not None and g_at < tag.start()
            print("url          : %s" % url)
            print("entry files  : %s" % ", ".join(fname(u) for u in js + pre + css))
            print("guard first  : %s (the guard script precedes Vite's injected module tags)" % guard_first)
            entry_bytes = 0             # bytes on the wire (a CDN compresses; urllib never decodes br / gzip)
            for u in js + pre + css:
                req = urllib.request.Request(u, headers={"Accept-Encoding": "br, gzip", "User-Agent": UA})
                with urllib.request.urlopen(req, timeout=30) as r:
                    entry_bytes += len(r.read())
            from playwright.sync_api import sync_playwright
            pw = sync_playwright().start()
            try:
                br = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
                chan = "chrome"
            except Exception:
                br = pw.chromium.launch(headless=True, args=FLAGS)
                chan = "bundled chromium"
            report["browser"] = "%s %s (headless)" % (chan, br.version)
            print("browser      : %s" % report["browser"], flush=True)
        except Exception as e:      # build / server / fetch / browser: nothing was tested
            print("SETUP FAILED: %s" % (str(e) if isinstance(e, HarnessError) else repr(e)))
            report["verdict"] = "SETUP FAILED"
            report["error"] = str(e)
            return 2

        def run(case_id, fn, *a, **kw):
            if case_id not in want:
                return
            print("-- case %s" % case_id, flush=True)
            t = time.time()
            try:
                c = fn(*a, **kw)
            except Exception as e:     # a harness crash is a failed case, reported verbatim
                print("   FAIL harness error: %s" % str(e).splitlines()[0])
                results.append({"id": case_id, "pass": False, "error": str(e)[:1500]})
                return
            r = c.result()
            r["seconds"] = round(time.time() - t, 1)
            results.append(r)

        top_checks = [{"name": "guard script precedes Vite's module tags in the served index.html", "ok": guard_first}]
        run("a", case_a, br, url)
        run("b1", case_load_fail, br, url, "b1", js[0])
        if chunk:
            run("b2", case_load_fail, br, url, "b2", chunk)
            run("b3", case_load_fail, br, url, "b3", chunk, flag_preset=True)
        if css:
            run("b4", case_load_fail, br, url, "b4", css[0], stylesheet=True)
        run("c", case_slow, br, url, entry_bytes)
        if chunk:
            run("d", case_stall, br, url, chunk)
            run("f", case_hidden, br, url, chunk)

        if any(x.startswith("e") for x in want):
            try:
                if shell_env and url_up(args.dev_base):
                    raise HarnessError("--shell-only needs its own dev server (HP_SHELL_ENTRY=1) but %s is already up" % args.dev_base)
                dev_handle = ensure_server(args.dev_base, not args.no_serve, env_extra=shell_env)
                dev_url = args.dev_base if args.dev_base.endswith("/") else args.dev_base + "/"
                dev_main = urllib.parse.urljoin(dev_url, "src/main.ts")
                run("e1", case_a, br, dev_url, dev=True)
                run("e2", case_stall, br, dev_url, dev_main, cid="e2", dev=True)
                run("e3", case_load_fail, br, dev_url, "e3", dev_main, dev=True)
            except HarnessError as e:
                print("   FAIL dev server: %s" % e)
                results.append({"id": "e", "pass": False, "error": "dev server: %s" % e})
    finally:
        report["cases"] = results
        report["topChecks"] = locals().get("top_checks", [])
        allok = bool(results) and all(r.get("pass") for r in results) and all(c["ok"] for c in report["topChecks"])
        if report.get("verdict") != "SETUP FAILED":
            report["verdict"] = "PASS" if allok else "FAIL"
        for obj, meth in ((br, "close"), (pw, "stop")):
            try:
                if obj:
                    getattr(obj, meth)()
            except Exception:
                pass
        if srv:
            srv.shutdown()
        stop_server(dev_handle)
        os.makedirs(REPORTS, exist_ok=True)
        path = os.path.join(REPORTS, "%s.json" % re.sub(r"[^A-Za-z0-9_.-]+", "_", args.report))
        with open(path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)
        print("=" * 84)
        for r in results:
            print("case %-3s %s  %s" % (r["id"], "PASS" if r.get("pass") else "FAIL", r.get("title") or r.get("error", "")[:120]))
        print("report       : %s" % path)
        print("RESULT: %s" % report["verdict"])
    return 0 if report["verdict"] == "PASS" else (2 if report["verdict"] == "SETUP FAILED" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
