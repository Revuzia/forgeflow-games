#!/usr/bin/env python
"""bootguard - what a player sees when the boot or a match load goes wrong (HEADLESS; faults injected client-side).

    python _harness/bootguard.py                    # every case
    python _harness/bootguard.py --cases a,b1,e,j,l --disk

Seeded from _spec/improve_2026-09/baseline/bootfault.py, hangprobe5.py and esmprobe.py (boot-robustness audit) and
patterned on games/dyefield/_harness/bootguard.py. Every fault is injected in the browser (Playwright routes, CDP
network throttling, launch switches, page JS), so neither the working copy nor the server is ever touched. Each case
gets a fresh browser context (so a sessionStorage retry flag starts cleared).

A "card" is judged from what is VISIBLE (document.body.innerText + the splash tip): failure words (could not /
couldn't / failed / isn't licensed / WebGL / did not start / stopped / lost ...) that were not on screen before the
fault. That works on today's splash tip and on the __LC_BOOT__ guard lane L9 is building (its DOM is not frozen).

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
  l1   every GLB -> 404 at match start (kernel caches cleared): within 35 s W.phase === "menu" and a notice on screen
  l2   every GLB aborted (network drop) at match start: the same (needs the loader timeout, L3 h)
  m    esm.sh blocked, SQUAD UP -> real click on CREATE ROOM: an error text and enabled buttons within 10 s
Exit 0 only when every selected case passes; 1 = a case failed; 2 = could not judge (browser / server / rAF).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

ALL = ["a", "b1", "b2", "b3", "c", "d", "e", "g", "h", "i", "j", "k", "l1", "l2", "m"]
FAIL_RE = re.compile(r"could ?n[o']t|can[' ]?no?t |cannot|failed|isn.t licensed|not licensed|licen[cs]e|webgl|did not start|didn.t start|"
                     r"stopped|context (was )?lost|graphics (were )?reset|unavailable|not supported|hardware acceleration|"
                     r"something went wrong|error", re.I)
RELOAD_RE = re.compile(r"\breload\b", re.I)
REHOST = "rehost.example"

SNAP_JS = r"""() => {
  const vis = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const s = getComputedStyle(n);
    if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false; } return true; };
  const tip = document.getElementById('lc-splash-tip');
  const bar = document.querySelector('#lc-splash .bar');
  let boot = null; try { boot = window.__LC_BOOT__ ? (typeof window.__LC_BOOT__.info === 'function' ? window.__LC_BOOT__.info() : 'present') : null; } catch (e) { boot = 'info threw: ' + e; }
  const res = performance.getEntriesByType('resource');
  const buttons = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && vis(b)).map((b) => (b.textContent || '').trim().slice(0, 30) + (b.disabled ? ':disabled' : ''));
  let text = ''; try { text = (document.body && document.body.innerText || '').trim(); } catch (e) {}
  return { t: Math.round(performance.now()), href: location.href, lc: !!window.__LC__, phase: window.__LC__ && window.__LC__.W ? window.__LC__.W.phase : null,
           tip: tip && vis(tip) ? tip.textContent : null, barBg: bar ? getComputedStyle(bar).backgroundColor : null,
           text: text.slice(0, 1500), boot, buttons,
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


def reload_advice(snap):
    txt = ((snap or {}).get("tip") or "") + "\n" + ((snap or {}).get("text") or "")
    return bool(RELOAD_RE.search(txt))


class Runner:
    def __init__(self, args, v):
        self.args, self.v = args, v
        self.pw = None
        self.browsers = {}
        self.disk = None

    def browser(self, key="default", extra=()):
        if key in self.browsers:
            return self.browsers[key]
        flags = list(C.FLAGS) + list(C.GPU_PROFILES.get(self.args.gpu, [])) + ["--host-resolver-rules=MAP %s 127.0.0.1" % REHOST] + list(extra)
        try:
            b = self.pw.chromium.launch(channel="chrome", headless=not self.args.headed, args=flags)
        except Exception as e:
            raise C.EnvFailure("Chrome did not launch: %s" % str(e).splitlines()[0][:200])
        self.browsers[key] = b
        return b

    def case_page(self, key="default", extra=()):
        b = self.browser(key, extra)
        ctx = b.new_context(viewport={"width": self.args.width, "height": self.args.height})
        ctx.add_init_script(C.INIT_JS)
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
        for b in self.browsers.values():
            try:
                b.close()
            except Exception:
                pass


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
    args = ap.parse_args()
    cases = [c.strip() for c in args.cases.split(",") if c.strip()]
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
        ctx.close()
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
            ok_card = card is not None and card["wall"] <= (5.0 if case == "b1" else 10.0)
            txt = failure_text(card) if card else None
            limit = 5.0 if case == "b1" else 10.0
            # the file + status sit on the card's OTHER lines ("  runtime/3d/ffg_boot3d.js  (HTTP 404)"), which carry no
            # failure word, and the status arrives a moment later (one GET): judge the whole card text within the window
            full = lambda sn: ((sn or {}).get("text") or "") + "\n" + ((sn or {}).get("tip") or "")  # noqa: E731
            want = (lambda t: name in t and "404" in t) if case == "b1" else (lambda t: name in t and "jsdelivr" not in t.lower())
            named = first(snaps, lambda sn: sn.get("wall", 99) <= limit and failure_text(sn) and want(full(sn)))
            v.check("%s: a failure card within %d s" % (case, limit), ok_card,
                    {"cardAt": card["wall"] if card else None, "text": txt, "lastTip": snaps[-1].get("tip") if snaps else None})
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
        ctx.close()
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
        ctx.close()
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
        ctx.close()
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
        ctx.close()
    elif case == "g":
        ctx, pg, rec = R.case_page("nowebgl", ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"])
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, 20, t0, 0.25, stop=lambda s: bool(failure_text(s)) and s["wall"] > 3)
        card = first(snaps, lambda s: failure_text(s))
        three_req = [x for x in rec["requests"] if re.search(r"three(\.module|\.core)(\.min)?\.js", x)]
        v.check("g: no WebGL - a card mentioning WebGL within 2 s", bool(card and card["wall"] <= 2.0 and re.search(r"webgl", failure_text(card) or "", re.I)),
                {"at": card["wall"] if card else None, "text": failure_text(card) if card else None})
        v.check("g: no WebGL - three is never requested", not three_req, three_req[:3])
        ctx.close()
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
        v.check("h: sitelock - the licence card within 1 s", bool(card and card["wall"] <= 1.0 and re.search(r"licen", failure_text(card) or "", re.I)),
                {"at": card["wall"] if card else None, "text": failure_text(card) if card else None})
        v.check("h: sitelock - the engine (runtime/ beyond ffg_boot3d.js) is never requested", not req, {"n": len(req), "first": req[:4]})
        s45 = still_at(R, pg, t0, args.t45)
        v.check("h: sitelock - the licence message is still on screen at t%d" % args.t45,
                bool(re.search(r"licen", failure_text(s45) or "", re.I)) and "still loading" not in (s45.get("tip") or "").lower(),
                {"tip": s45.get("tip"), "text": (s45.get("text") or "")[:160]})
        ctx.close()
    elif case == "i":
        ctx, pg, rec = R.case_page()
        ctx.route("**/last-circle/content.json*", lambda r: r.fulfill(status=404, body="Game not found"))
        t0 = time.time()
        R.goto(pg, base)
        snaps = R.watch(pg, 15, t0, 0.25, stop=lambda s: bool(failure_text(s)))
        card = first(snaps, lambda s: failure_text(s))
        v.check("i: content.json 404 - a terminal card within 10 s", bool(card and card["wall"] <= 10),
                {"at": card["wall"] if card else None, "text": failure_text(card) if card else None})
        s45 = still_at(R, pg, t0, args.t45)
        v.check("i: content.json 404 - the message is still on screen at t%d" % args.t45,
                bool(failure_text(s45)) and "still loading" not in (s45.get("tip") or "").lower(),
                {"tip": s45.get("tip"), "text": (s45.get("text") or "")[:160]})
        ctx.close()
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
            ctx.close()
            return out
        pg.wait_for_timeout(1500)
        before = R.snap(pg)
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
                while time.time() - t2 < 3:
                    s = R.snap(pg)
                    s["sinceThrowMs"] = round(pg.evaluate("(t) => performance.now() - t", thrown))
                    snaps.append(s)
                    if failure_text(s, before.get("text")):
                        break
                    pg.wait_for_timeout(100)
                card = first(snaps, lambda s: failure_text(s, before.get("text")))
                fr = pg.evaluate("() => new Promise((res) => { const k = window.__LC__.W.kernel, a = k.renderer.info.render.frame; setTimeout(() => res({ a, b: k.renderer.info.render.frame, running: !!k._running }), 1500); })")
                v.check("j: frame throw -> a visible error card within 1 s", bool(card and card["sinceThrowMs"] <= 1000),
                        {"card": failure_text(card, before.get("text")) if card else None, "sinceThrowMs": card["sinceThrowMs"] if card else None,
                         "framesAfter": fr})
        elif case == "k":
            r = pg.evaluate("() => { const gl = window.__LC__.W.kernel.renderer.getContext(); const e = gl.getExtension('WEBGL_lose_context');"
                            " if (!e) return 'no ext'; window.__H_LCX__ = e; window.__H_LOST__ = performance.now(); e.loseContext(); return 'lost'; }")
            if r != "lost":
                v.cnj("k: context lost -> card", "WEBGL_lose_context unavailable (%s)" % r)
            else:
                snaps = R.watch(pg, 4, time.time(), 0.1, stop=lambda s: bool(failure_text(s, before.get("text"))))
                card = first(snaps, lambda s: failure_text(s, before.get("text")))
                v.check("k: context lost -> a card within 1 s", bool(card and card["wall"] <= 1.0),
                        {"at": card["wall"] if card else None, "text": failure_text(card, before.get("text")) if card else None})
                n0 = len(rec["navs"])
                try:
                    pg.evaluate("() => { try { window.__H_LCX__.restoreContext(); return 'restored'; } catch (e) { return String(e); } }")
                except Exception:
                    pass
                t3 = time.time()
                while time.time() - t3 < 10 and len(rec["navs"]) == n0:
                    pg.wait_for_timeout(250)
                v.check("k: context restored -> the page reloads within 10 s", len(rec["navs"]) > n0, {"navs": rec["navs"][n0:]})
        elif case in ("l1", "l2"):
            pg.evaluate("() => { const k = window.__LC__.W.kernel; for (const c of ['_charCache', '_gltfCache']) if (k[c]) for (const key in k[c]) delete k[c][key]; }")
            if case == "l1":
                ctx.route("**/*.glb*", lambda r: r.fulfill(status=404, body="Game not found"))
            else:
                ctx.route("**/*.glb*", lambda r: r.abort("internetdisconnected"))
            pg.evaluate("() => { window.__H_SMR__ = 'pending'; window.__LC__.startMatch({ mode: 'standard', seed: 11 })"
                        ".then(() => { window.__H_SMR__ = 'resolved'; }, (e) => { window.__H_SMR__ = 'rejected: ' + (e && e.message || e); }); return 1; }")
            t4 = time.time()
            ok = None
            s = None
            while time.time() - t4 < 35:
                s = R.snap(pg)
                if s.get("phase") == "menu" and failure_text(s, before.get("text")):
                    ok = round(time.time() - t4, 1)
                    break
                pg.wait_for_timeout(500)
            v.check("%s: GLB %s at match start -> back to the menu with a notice within 35 s" % (case, "404" if case == "l1" else "abort"),
                    ok is not None, {"at": ok, "phase": (s or {}).get("phase"), "startMatch": pg.evaluate("() => window.__H_SMR__"),
                                     "notice": failure_text(s, before.get("text")) if s else None, "screen": ((s or {}).get("text") or "")[:160]})
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
                ctx.close()
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
        ctx.close()
    else:
        v.cnj("%s: unknown case" % case, "valid: %s" % ",".join(ALL))
    return out


if __name__ == "__main__":
    sys.exit(main())
