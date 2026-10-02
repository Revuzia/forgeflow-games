#!/usr/bin/env python
"""portalcheck - BLOCKTOOTH inside a stand-in forgeflowgames.com portal (ONLINE_PLAN.md A.3, lane A-QA).

    python _harness/portal/portalcheck.py                    # all variants: signed, guest(+sign-in), cloud(+noload), standalone
    python _harness/portal/portalcheck.py --only signed      # one variant (signed | guest | standalone | silent)
    python _harness/portal/portalcheck.py --selftest         # validator unit test on synthetic payloads (no browser)
    python _harness/portal/portalcheck.py --headless         # same d3d11 flags, no window

How it works. The PARENT page is _harness/portal/bridge_host.html, served by a tiny in-process HTTP server on
http://127.0.0.1:<free port>/__bt_portal, a DIFFERENT origin (and site) from the game's http://localhost:5178, so the
game frame is cross-origin like on the portal (CDN worker vs forgeflowgames.com). (A Playwright route-fulfilled parent
does not work: Chrome treats it as a public page and blocks the loopback frame with
net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS, observed 2026-10-01.) The frame gets the `sandbox` + `allow` strings READ AT RUN TIME from the portal's
src/components/game/GamePlayer.tsx. The game frame is the vite dev server (default http://localhost:5178/?dev=1&cine=0,
started with BT_FROZEN=1 = no HMR if not already up). Every forgeflow:* message is recorded by the parent.

Scripted run (identical in every variant): __BT__.newRun({titan, biome, seed, skipSlate}) -> play --play-s seconds of
real time with NO input and NO cheats -> cheats ONLY to reach the run end: cheat.time(--clock, default 1150.6 s; the
server's bt__validate_run rejects clears under 300 s) + cheat.endless(false) (field + kill the city boss) -> the clear
tabloid is up -> wait --settle-s. Ground truth is read from the frame afterwards: World run fields,
the local record book (blocktooth.best.v1) and the profile (blocktooth.profile.v1 `done`, diffed before/after).

Checks (A.3 table + platform.md 10.1/10.2):
  signed     the game asks who is signed in (forgeflow:whoami); exactly ONE forgeflow:run_result; its payload passes
             the server's bt__validate_run bounds (mirrored from supabase/migrations/0008_blocktooth_stats.sql) AND
             matches the run's ground truth; one
             forgeflow:game_over {score == tonnage}; the forgeflow:achievement slugs == the goals newly met this run
             (each once; must include g_first_broadcast on a fresh profile); no forgeflow:save before a save_loaded
             reply (write-lock); the end screen's account line prints the ack's '#7 ON THE <CITY> BOARD';
             0 errors in the frame.
  guest      the same run with identity signedIn:false -> ZERO write messages (run_result, achievement, save,
             game_over, score, level_complete, vs_result) and the account line says SIGN IN TO SAVE YOUR STATS;
             then the parent PUSHES identity signedIn:true
             (onAuthStateChange) -> every goal already earned is sent once (backfill, plan A.1.5).
  cloud      a cloud save from "another device" (forgeflow:load reply) is merged into the local profile + record
             book and pushed back whole; noload (negative control): load never answered -> NO forgeflow:save ever.
  standalone the game opened directly (no parent): the same run makes 0 errors, posts nothing, shows no account line.
  silent     (informational, --only silent) a portal that never answers whoami: writes are listed, not judged.
Exit 0 pass / 1 fail / 2 could not judge. Report: _harness/_reports/portalcheck.json.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
HARNESS = os.path.dirname(HERE)
GAME_ROOT = os.path.dirname(HARNESS)
REPO = os.path.dirname(os.path.dirname(GAME_ROOT))          # forgeflow-games/
sys.path.insert(0, HARNESS)
import common as C  # noqa: E402

GAMEPLAYER = os.path.join(REPO, "src", "components", "game", "GamePlayer.tsx")
HOST_HTML = os.path.join(HERE, "bridge_host.html")
GOALS_TS = os.path.join(GAME_ROOT, "src", "data", "goals.ts")
PORTAL_PATH = "/__bt_portal"

WRITE_TYPES = ("forgeflow:run_result", "forgeflow:achievement", "forgeflow:save", "forgeflow:game_over",
               "forgeflow:score", "forgeflow:level_complete", "forgeflow:vs_result")
TITANS = ("molo", "voltkite", "hearthback", "briarwick")
BIOMES = ("grideast", "whitestacks", "lockwater")


# ─────────────────────────────── check recorder ───────────────────────────────
class Checks:
    def __init__(self):
        self.items = []
        self.notes = []

    def check(self, name, ok, detail=None):
        self.items.append({"name": name, "ok": bool(ok), "detail": detail})
        print("  [%s] %s" % ("PASS" if ok else "FAIL", name), flush=True)
        if not ok and detail is not None:
            print("         %s" % json.dumps(detail, default=str)[:900], flush=True)

    def note(self, text):
        self.notes.append(text)
        print("  [note] %s" % text, flush=True)

    @property
    def failed(self):
        return [c for c in self.items if not c["ok"]]


# ─────────────────────────────── payload validator (pure) ───────────────────────────────
def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v not in (float("inf"), float("-inf"))


def run_payload(msg):
    """platform.md 10.1 names the field `payload`; accept `data` too, and say which."""
    if not isinstance(msg, dict):
        return None, "message is not an object"
    if isinstance(msg.get("payload"), dict):
        return msg["payload"], "payload"
    if isinstance(msg.get("data"), dict):
        return msg["data"], "data (platform.md 10.1 says `payload`)"
    return None, "no `payload` object on the message"


def validate_run(p, truth=None):
    """Problems (list of strings) of a run_result payload; empty list = valid.

    Server rules = a 1:1 mirror of A-SQL's bt__validate_run in supabase/migrations/0008_blocktooth_stats.sql (the code
    the RPC will run; it supersedes platform.md 8's sketch: duration 5..43200, clear_s 300..duration+1, level cap
    40 + duration/30, ...). SQL integer division is mirrored with //. If 0008 changes, change this function with it.
    Harness rules on top: integer fields must be JSON integers (the game sends whole numbers), solo runs only, and,
    when `truth` is given, the figures must equal the run's own (World + record book)."""
    bad = []
    if not isinstance(p, dict):
        return ["payload is not an object (bad_payload)"]
    nonce = p.get("run_nonce")
    if not (isinstance(nonce, str) and 8 <= len(nonce) <= 64 and re.match(r"^[A-Za-z0-9_.:-]+$", nonce)):
        bad.append("bad_run_nonce: 8..64 chars of [A-Za-z0-9_.:-] (got %r)" % (nonce,))
    mode = p.get("mode", "solo")
    if mode != "solo":
        bad.append("mode must be 'solo' for a solo run (got %r)" % (mode,))
    if p.get("titan") not in TITANS:
        bad.append("bad_titan (got %r)" % (p.get("titan"),))
    if p.get("biome") not in BIOMES:
        bad.append("bad_biome (got %r)" % (p.get("biome"),))
    res = p.get("result")
    if res not in ("clear", "dead"):
        bad.append("bad_result: clear|dead for solo (got %r)" % (res,))
    if p.get("phase", "run") not in ("run", "endless"):
        bad.append("bad_phase (got %r)" % (p.get("phase"),))
    bv = p.get("build_version")
    if bv is not None and not (isinstance(bv, str) and len(bv) <= 64):
        bad.append("bad_build_version: null or a string <= 64 chars (got %r)" % (bv,))
    ints = {}
    for f, req in (("duration_s", True), ("level", True), ("peak_rank", True), ("kills", True), ("tonnage", True),
                   ("crushed", False), ("blocks", False), ("bosses", False), ("gate_kills", False), ("endless_s", False),
                   ("endless_score", False), ("rematches", False), ("titans_eaten", False)):
        v = p.get(f)
        if v is None:
            if req:
                bad.append("%s is missing" % f)
                ints[f] = None
            else:
                ints[f] = 0
        elif not _is_int(v):
            bad.append("%s must be a JSON integer (got %r)" % (f, v))
            ints[f] = round(v) if _is_num(v) else None
        else:
            ints[f] = v
    dur, lvl, rk, kl, tn = ints["duration_s"], ints["level"], ints["peak_rank"], ints["kills"], ints["tonnage"]
    cr, bl, bo, gk = ints["crushed"], ints["blocks"], ints["bosses"], ints["gate_kills"]
    es, esc, rm, te = ints["endless_s"], ints["endless_score"], ints["rematches"], ints["titans_eaten"]
    cs = p.get("clear_s")
    if dur is None or not 5 <= dur <= 43200:
        bad.append("duration_out_of_range: 5..43200 (got %r)" % (dur,))
        dur = None
    if res == "clear":
        if not _is_num(cs) or cs < 300 or (dur is not None and cs > dur + 1):
            bad.append("clear_s_out_of_range: 300..duration_s+1 = %s (got %r)" % (None if dur is None else dur + 1, cs))
    elif cs is not None:
        bad.append("clear_s_without_clear (got %r)" % (cs,))
    if _is_num(cs) and abs(cs * 10 - round(cs * 10)) > 1e-6:
        bad.append("clear_s has more than 1 decimal, numeric(7,1) (got %r)" % (cs,))
    if dur is not None:
        if lvl is None or lvl < 1 or lvl > min(250, 40 + dur // 30):
            bad.append("level_out_of_range: 1..%d (got %r)" % (min(250, 40 + dur // 30), lvl))
        if kl is None or kl < 0 or kl > 500 + 30 * dur:
            bad.append("kills_out_of_range: 0..%d (got %r)" % (500 + 30 * dur, kl))
        if tn is None or tn < 0 or tn > 12000000 + 20000 * dur:
            bad.append("tonnage_out_of_range: 0..%d (got %r)" % (12000000 + 20000 * dur, tn))
        if es is not None and (es < 0 or es > dur):
            bad.append("endless_s_out_of_range: 0..%d (got %r)" % (dur, es))
    if rk is None or not 0 <= rk <= 4:
        bad.append("peak_rank_out_of_range: 0..4 (got %r)" % (rk,))
    if cr is not None and kl is not None and (cr < 0 or cr > kl):
        bad.append("crushed_out_of_range: 0..kills (got %r)" % (cr,))
    mb = {"grideast": 240, "whitestacks": 182}.get(p.get("biome"), 208)
    if bl is not None and (bl < 0 or bl > mb):
        bad.append("blocks_out_of_range: 0..%d (got %r)" % (mb, bl))
    if es is not None:
        if es > 0 and res != "clear":
            bad.append("endless_without_clear")
        if rm is not None and (rm < 0 or rm > es // 150 + 1):
            bad.append("rematches_out_of_range (got %r)" % (rm,))
        if bo is not None and (bo < 0 or bo > 2 + es // 75):
            bad.append("bosses_out_of_range: 0..%d (got %r)" % (2 + es // 75, bo))
        if gk is not None and (gk < 0 or gk > 4 + es // 75):
            bad.append("gate_kills_out_of_range: 0..%d (got %r)" % (4 + es // 75, gk))
        if None not in (esc, kl, rm, tn) and (esc < 0 or esc > 10 * es + 2 * kl + 5000 * rm + tn // 500 + 1500 * (es // 75 + 2) + 100):
            bad.append("endless_score_out_of_range (got %r)" % (esc,))
    if te is not None and te != 0:
        bad.append("titans_eaten_in_solo (got %r)" % (te,))
    if p.get("placement") is not None:
        bad.append("placement is VS-only (table CHECK mode='vs' OR placement IS NULL) (got %r)" % (p.get("placement"),))
    if truth:
        for f, tf in (("titan", "titan"), ("biome", "biome"), ("result", "result"), ("level", "level"),
                      ("kills", "kills"), ("tonnage", "tonnage"), ("peak_rank", "peakRank"), ("blocks", "blocks"),
                      ("crushed", "crushed"), ("bosses", "bosses"), ("gate_kills", "gateKills")):
            if f in p and tf in truth and truth[tf] is not None and p[f] != truth[tf]:
                bad.append("%s %r != the run's %s %r" % (f, p[f], tf, truth[tf]))
        tc = truth.get("clearS")
        if tc is not None and _is_num(cs) and abs(cs - tc) > 0.15:
            bad.append("clear_s %r != the record book's clearS %r" % (cs, tc))
        te_ = truth.get("endT")
        if _is_num(te_) and te_ > 0 and _is_int(p.get("duration_s")) and not (te_ - 1.0 <= p["duration_s"] <= te_ + 1.0):
            bad.append("duration_s %r is not the run's end time %.1f s (+-1)" % (p["duration_s"], te_))
    return bad


def goal_ids():
    try:
        return re.findall(r"id:\s*'(g_[a-z0-9_]+)'", open(GOALS_TS, encoding="utf-8").read())
    except Exception:
        return []


# ─────────────────────────────── portal page ───────────────────────────────
def read_portal_attrs():
    src = open(GAMEPLAYER, encoding="utf-8").read()
    m = re.search(r"<iframe[\s\S]*?/>", src)
    block = m.group(0) if m else src
    sb = re.search(r'\bsandbox="([^"]*)"', block)
    al = re.search(r'\ballow="([^"]*)"', block)
    line = src[:src.find(sb.group(0))].count("\n") + 1 if sb else None
    return (sb.group(1) if sb else None), (al.group(1) if al else None), line


def game_url(args):
    return C.build_url(args.base, dev=True, cine=0)


TRUTH_JS = r"""
() => {
  const B = window.__BT__, w = B && B.world; let s = null; try { s = B.state(); } catch (_) {}
  const rd = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };
  const prof = rd('blocktooth.profile.v1'), best = rd('blocktooth.best.v1');
  const T = w && w.tally;
  const t = w ? w.titanId : null, b = w ? w.biomeId : null;
  const bk = (st) => (best && t ? best[t + '.' + b + '.' + st] : undefined);
  return {
    screen: s && s.screen, titan: t, biome: b,
    result: w ? w.run.result : null, endT: w ? w.run.endT : null, t: w ? w.t : null,
    tonnage: w ? Math.round(w.run.tonnage) : null, blocks: w ? w.run.blocksLeveled : null,
    kills: w ? w.titan.kills : null, level: w ? w.titan.level : null, peakRank: w ? w.run.peakRank : null,
    crushed: T ? T.crushed : null, bosses: T ? T.bossesDefeated : null, gateKills: T ? T.gateKills : null,
    endless: !!(w && w.endless),
    clearS: bk('clearS') === undefined ? null : bk('clearS'), bestTonnage: bk('tonnage'),
    done: prof && prof.done ? Object.keys(prof.done) : [],
  };
}
"""

ACCOUNT_JS = r"""() => { const el = document.querySelector('[data-portal="account"]'); if (!el) return { exists: false };
  const cs = getComputedStyle(el);
  return { exists: true, visible: el.getClientRects().length > 0 && !el.classList.contains('bt-hidden') && cs.display !== 'none' && cs.visibility !== 'hidden',
           text: (el.textContent || '').trim(), tone: el.dataset.tone || '' }; }"""

DONE_JS = r"""() => { try { const p = JSON.parse(localStorage.getItem('blocktooth.profile.v1')); return p && p.done ? Object.keys(p.done) : []; } catch (_) { return null; } }"""


def ev(target, expr, arg=None, default=None):
    try:
        return target.evaluate(expr) if arg is None else target.evaluate(expr, arg)
    except Exception as e:
        return default if default is not None else {"__error": str(e).splitlines()[0][:300]}


def screen_of(target):
    return ev(target, "() => { try { return window.__BT__ ? window.__BT__.state().screen : null; } catch (e) { return 'ERR ' + e; } }", default="?")


def wait_screen(target, screens, timeout_s):
    t0 = time.time()
    last = None
    while time.time() - t0 < timeout_s:
        last = screen_of(target)
        if last in screens:
            return True, last
        time.sleep(0.2)
    return False, last


def scripted_run(target, args, chk, label):
    """The one scripted run. Returns (truth dict | None, info dict)."""
    info = {"drafts": 0}
    t0 = time.time()
    while time.time() - t0 < args.boot_timeout:
        if ev(target, "() => !!(window.__BT__ && typeof window.__BT__.state === 'function')", default=False) is True:
            break
        time.sleep(0.25)
    else:
        chk.check("%s: the game boots (window.__BT__ present)" % label, False, {"after_s": args.boot_timeout})
        return None, info
    ok, scr = wait_screen(target, ("title", "select"), args.boot_timeout)
    chk.check("%s: the game boots to the title" % label, ok, {"screen": scr, "s": round(time.time() - t0, 1)})
    if not ok:
        return None, info
    info["doneBefore"] = ev(target, DONE_JS, default=[])
    r = ev(target, "async (o) => { await window.__BT__.newRun(o); return window.__BT__.state().screen; }",
           {"titan": args.titan, "biome": args.biome, "seed": args.seed, "skipSlate": True})
    info["afterNewRun"] = r
    if isinstance(r, dict) and r.get("__error"):
        chk.check("%s: __BT__.newRun starts a run" % label, False, r)
        return None, info
    for _ in range(3):
        if screen_of(target) == "slate":
            ev(target, "() => window.__BT__.dismiss()")
            time.sleep(0.5)
    ok, scr = wait_screen(target, ("play",), 30)
    if not ok:
        chk.check("%s: the run reaches play" % label, False, {"screen": scr})
        return None, info
    # play --play-s seconds of REAL time; no input, no cheats (a level-up draft is closed via its own path)
    t1 = time.time()
    while time.time() - t1 < args.play_s:
        s = screen_of(target)
        if s == "draft":
            info["drafts"] += 1
            ev(target, "() => window.__BT__.dismiss()")
        elif s == "end":
            break
        time.sleep(0.25)
    info["simT_beforeCheat"] = ev(target, "() => window.__BT__.state().t")
    if screen_of(target) != "end":
        # cheats ONLY to reach the run end: the run clock to --clock s (bt__validate_run rejects a clear under 300 s,
        # so a 9 s clear could never be a valid payload), then field + kill the city boss so the run clears
        # (autoPick=false keeps the tabloid up). Both between the same two ticks.
        c = ev(target, "(clk) => { const C = window.__BT__.cheat; if (clk > 0) C.time(clk); return C.endless(false); }", args.clock)
        info["cheatEndless"] = c
    ok, scr = wait_screen(target, ("end",), 30)
    if not ok:
        for _ in range(4):                       # a draft owed at the kill can sit in front of the ending
            if screen_of(target) == "draft":
                info["drafts"] += 1
                ev(target, "() => window.__BT__.dismiss()")
                time.sleep(0.5)
        ok, scr = wait_screen(target, ("end",), 20)
    chk.check("%s: the scripted run reaches its end (tabloid)" % label, ok, {"screen": scr, "info": info})
    if not ok:
        return None, info
    time.sleep(args.settle_s)
    truth = ev(target, TRUTH_JS)
    info["accountLine"] = ev(target, ACCOUNT_JS)
    info["endScreenText"] = ev(target, "() => (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 8000)", default="")
    return truth, info


def frame_errors(target):
    return ev(target, "() => window.__H_ERR__ || []", default=[]) or []


class Browser:
    def __init__(self, args, name):
        self.args, self.name = args, name
        self.console, self.page_errors, self.failed = [], [], []

    def __enter__(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(channel="chrome", headless=bool(self.args.headless), args=C.FLAGS)
        self.context = self.browser.new_context(viewport={"width": self.args.width, "height": self.args.height},
                                                device_scale_factor=1)
        self.page = self.context.new_page()
        self.page.set_default_timeout(30_000)
        self.page.add_init_script(C.INIT_JS)               # runs in every frame, the game frame included
        self.page.on("console", lambda m: self.console.append((m.type, m.text, (m.location or {}).get("url") if isinstance(m.location, dict) else None)))
        self.page.on("pageerror", lambda e: self.page_errors.append(str(e)))
        self.page.on("requestfailed", self._reqfail)
        self.page.on("response", lambda r: (r.status >= 400 and "favicon" not in r.url) and self.failed.append("HTTP %d %s" % (r.status, r.url)))
        return self

    def _reqfail(self, r):
        f = r.failure
        f = f() if callable(f) else f
        if "favicon" in r.url or (f and "ERR_ABORTED" in str(f)):
            return
        self.failed.append("FAILED %s (%s)" % (r.url, f))

    def __exit__(self, *exc):
        for obj, meth in ((self.browser, "close"), (self._pw, "stop")):
            try:
                getattr(obj, meth)()
            except Exception:
                pass
        return False

    def errors(self, frame_target):
        cerr = [t for (k, t, u) in self.console if k == "error" and "favicon" not in (u or "") and "favicon" not in t]
        return {"consoleErrors": cerr, "pageErrors": list(self.page_errors), "windowErrors": frame_errors(frame_target),
                "failedRequests": list(self.failed)}


class PortalServer:
    """127.0.0.1:<free port> serving bridge_host.html (read fresh per request) at PORTAL_PATH; GET only."""

    def __enter__(self):
        import http.server
        import threading

        class H(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if urllib.parse.urlparse(self.path).path != PORTAL_PATH:
                    self.send_response(404)
                    self.end_headers()
                    return
                body = open(HOST_HTML, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                pass

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.origin = "http://127.0.0.1:%d" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()
        return False


PORTAL = {"origin": None}


def open_portal(b, args, mode, sandbox, allow, cloud=None):
    q = {"mode": mode, "game": game_url(args), "sandbox": sandbox, "allow": allow or ""}
    if cloud is not None:
        q["cloud"] = json.dumps(cloud)
    b.page.goto(PORTAL["origin"] + PORTAL_PATH + "?" + urllib.parse.urlencode(q), wait_until="load", timeout=60_000)
    gbase = urllib.parse.urlparse(args.base)
    t0 = time.time()
    while time.time() - t0 < args.boot_timeout:
        fr = next((f for f in b.page.frames if f != b.page.main_frame and urllib.parse.urlparse(f.url).netloc == gbase.netloc), None)
        if fr is not None:
            return fr
        time.sleep(0.25)
    return None


def bridge_log(b):
    return ev(b.page, "() => window.__BRIDGE ? window.__BRIDGE.log : null", default=[]) or []


def msgs_in(log, typ=None):
    return [x for x in log if x.get("dir") == "in" and x.get("fromGame") and (typ is None or x.get("type") == typ)]


def summarize(log):
    out = {}
    for x in msgs_in(log):
        out[x["type"]] = out.get(x["type"], 0) + 1
    return out


def no_errors_check(chk, label, errs):
    n = sum(len(v) for v in errs.values())
    chk.check("%s: 0 errors (console errors, page errors, window errors, failed requests)" % label, n == 0,
              {k: v[:5] for k, v in errs.items() if v})


# ─────────────────────────────── variants ───────────────────────────────
def variant_signed(args, chk, sandbox, allow, out):
    L = "signed"
    with Browser(args, L) as b:
        fr = open_portal(b, args, "signed", sandbox, allow)
        chk.check("%s: the game frame loads inside the cross-origin sandboxed parent" % L, fr is not None,
                  {"frames": [f.url for f in b.page.frames]})
        if fr is None:
            return
        truth, info = scripted_run(fr, args, chk, L)
        log = bridge_log(b)
        out[L] = {"truth": truth, "info": info, "messages": summarize(log), "log": log[-80:]}
        if truth is None:
            return
        who = msgs_in(log, "forgeflow:whoami")
        chk.check("%s: the game asks the portal who is signed in (forgeflow:whoami)" % L, len(who) >= 1, {"messages": summarize(log)})
        rr = msgs_in(log, "forgeflow:run_result")
        chk.check("%s: exactly ONE forgeflow:run_result for the run" % L, len(rr) == 1,
                  {"count": len(rr), "messages": summarize(log)})
        if rr:
            p, where = run_payload(rr[0]["msg"])
            if where != "payload":
                chk.note("%s: run_result fields read from %s" % (L, where))
            probs = validate_run(p, truth) if p is not None else [where]
            chk.check("%s: the run_result payload passes the server's bt__validate_run bounds and matches the run" % L, not probs,
                      {"problems": probs, "payload": p, "truth": {k: truth.get(k) for k in ("titan", "biome", "result", "endT", "level", "kills", "tonnage", "peakRank", "blocks", "crushed", "clearS")}})
            chk.check("%s: run_result carries a _reqId (the ack is routed back to it)" % L,
                      rr[0]["msg"].get("_reqId") is not None, {"msg_keys": sorted(rr[0]["msg"].keys())})
        go = msgs_in(log, "forgeflow:game_over")
        chk.check("%s: one forgeflow:game_over {score == tonnage} (generic /leaderboards, plan A.1.5)" % L,
                  len(go) == 1 and go[0]["msg"].get("score") == truth.get("tonnage"),
                  {"count": len(go), "scores": [g["msg"].get("score") for g in go], "tonnage": truth.get("tonnage")})
        before = set(info.get("doneBefore") or [])
        newly = sorted(set(truth.get("done") or []) - before)
        ach = [x["msg"].get("achievementSlug") for x in msgs_in(log, "forgeflow:achievement")]
        ids = set(goal_ids())
        chk.check("%s: the run met goals locally (ground truth for the achievement check)" % L, bool(newly), {"newly": newly})
        dup = sorted({a for a in ach if ach.count(a) > 1})
        unknown = sorted({a for a in ach if a not in ids})
        chk.check("%s: forgeflow:achievement slugs == the goals newly met this run, each once" % L,
                  sorted(ach) == newly and not dup and not unknown,
                  {"sent": ach, "newlyMet": newly, "duplicates": dup, "notAGoalId": unknown,
                   "missing": sorted(set(newly) - set(ach)), "extra": sorted(set(ach) - set(newly))})
        chk.check("%s: completing FIRST BROADCAST sends achievementSlug 'g_first_broadcast'" % L,
                  "g_first_broadcast" in ach, {"sent": ach})
        saves = [x for x in msgs_in(log, "forgeflow:save")]
        loaded = [x for x in log if x.get("dir") == "out" and x.get("type") == "forgeflow:save_loaded"]
        first_save = saves[0]["i"] if saves else None
        first_loaded = loaded[0]["i"] if loaded else None
        chk.check("%s: no forgeflow:save before the portal answered a forgeflow:load (write-lock)" % L,
                  first_save is None or (first_loaded is not None and first_loaded < first_save),
                  {"firstSaveIdx": first_save, "firstSaveLoadedIdx": first_loaded, "saves": len(saves)})
        al = info.get("accountLine") or {}
        want = "#7 ON THE %s BOARD" % C.BIOME_NAMES[args.biome]
        chk.check("%s: the end screen's account line prints the ack's board rank '%s' (plan A.1.5)" % (L, want),
                  al.get("visible") and want in (al.get("text") or ""), al)
        no_errors_check(chk, L, b.errors(fr))


def variant_guest(args, chk, sandbox, allow, out):
    L = "guest"
    with Browser(args, L) as b:
        fr = open_portal(b, args, "guest", sandbox, allow)
        chk.check("%s: the game frame loads inside the cross-origin sandboxed parent" % L, fr is not None, None)
        if fr is None:
            return
        truth, info = scripted_run(fr, args, chk, L)
        log = bridge_log(b)
        if truth is None:
            out[L] = {"info": info, "messages": summarize(log), "log": log[-80:]}
            return
        writes = [x for x in msgs_in(log) if x["type"] in WRITE_TYPES]
        reads = sorted({x["type"] for x in msgs_in(log) if x["type"] not in WRITE_TYPES})
        chk.check("%s: a guest run sends NOTHING (0 run_result / achievement / save / game_over / score)" % L,
                  len(writes) == 0, {"writes": [(x["type"], x["msg"]) for x in writes[:8]], "messages": summarize(log)})
        if reads:
            chk.note("%s: non-write messages sent as a guest: %s" % (L, reads))
        al = info.get("accountLine") or {}
        chk.check("%s: the end screen's account line says 'SIGN IN TO SAVE YOUR STATS' (plan A.1.5)" % L,
                  al.get("visible") and "SIGN IN" in (al.get("text") or "").upper(), al)
        no_errors_check(chk, L + " (run)", b.errors(fr))
        # sign in mid-session: the portal PUSHES identity (onAuthStateChange); earned goals must be credited once
        n0 = len(log)
        done = sorted(set(truth.get("done") or []))
        ev(b.page, "() => window.__BRIDGE.setMode('signed')")
        time.sleep(args.settle_s + 2)
        log2 = bridge_log(b)
        after = [x for x in log2[n0:] if x.get("dir") == "in" and x.get("fromGame")]
        ach = [x["msg"].get("achievementSlug") for x in after if x["type"] == "forgeflow:achievement"]
        dup = sorted({a for a in ach if ach.count(a) > 1})
        chk.check("guest->sign-in: every goal already earned is sent once after the identity push (backfill)",
                  bool(done) and sorted(ach) == done and not dup,
                  {"sent": ach, "earnedLocally": done, "missing": sorted(set(done) - set(ach)),
                   "extra": sorted(set(ach) - set(done)), "duplicates": dup})
        rr_after = [x for x in after if x["type"] == "forgeflow:run_result"]
        if rr_after:
            chk.note("guest->sign-in: %d run_result sent after sign-in for a run played as a guest" % len(rr_after))
        out[L] = {"truth": truth, "info": info, "messages": summarize(log2), "afterSignIn": summarize(after),
                  "log": log2[-80:]}


def variant_silent(args, chk, sandbox, allow, out):
    L = "silent"
    with Browser(args, L) as b:
        fr = open_portal(b, args, "silent", sandbox, allow)
        if fr is None:
            chk.check("%s: frame loads" % L, False, None)
            return
        truth, info = scripted_run(fr, args, chk, L)
        log = bridge_log(b)
        chk.note("%s (portal never answers): messages sent %s" % (L, summarize(log)))
        out[L] = {"truth": truth, "info": info, "messages": summarize(log), "log": log[-80:]}
        no_errors_check(chk, L, b.errors(fr))


CLOUD_GOAL = "g_paperwork"
CLOUD_BEST_KEY = "molo.grideast.tonnage"
CLOUD_BEST = 987654321


def variant_cloud(args, chk, sandbox, allow, out):
    """Cloud profile (plan A.1.5): a save made on ANOTHER device is merged in after load, and nothing is ever
    saved before the load answered (LAST CIRCLE's write-lock; noload = the negative control)."""
    L = "cloud"
    cloud = {"blocktooth": {"v": 1, "profile": {"done": {CLOUD_GOAL: 1700000000000}}, "best": {CLOUD_BEST_KEY: CLOUD_BEST}}}
    with Browser(args, L) as b:
        fr = open_portal(b, args, "signed", sandbox, allow, cloud=cloud)
        if fr is None:
            chk.check("%s: frame loads" % L, False, None)
            return
        t0 = time.time()
        while time.time() - t0 < args.boot_timeout:
            if any(x.get("type") == "forgeflow:save_loaded" for x in bridge_log(b)):
                break
            time.sleep(0.25)
        time.sleep(2.0)
        local = ev(fr, "() => { const r = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_) { return null; } };"
                       " const p = r('blocktooth.profile.v1'), b = r('blocktooth.best.v1');"
                       " return { done: p && p.done ? Object.keys(p.done) : [], best: b ? b['%s'] : null }; }" % CLOUD_BEST_KEY)
        log = bridge_log(b)
        chk.check("%s: the game reads its cloud save after sign-in (forgeflow:load answered)" % L,
                  any(x.get("type") == "forgeflow:save_loaded" for x in log), {"messages": summarize(log)})
        chk.check("%s: the cloud save's goal + record are merged into this device's profile" % L,
                  isinstance(local, dict) and CLOUD_GOAL in (local.get("done") or []) and local.get("best") == CLOUD_BEST,
                  {"local": local, "cloud": cloud})
        pushed = ev(b.page, "() => window.__BRIDGE.cloud")
        pb = (pushed or {}).get("blocktooth") if isinstance(pushed, dict) else None
        ok_push = isinstance(pb, dict) and CLOUD_GOAL in ((pb.get("profile") or {}).get("done") or {}) and (pb.get("best") or {}).get(CLOUD_BEST_KEY) == CLOUD_BEST
        chk.check("%s: the save pushed back keeps the cloud's goal + record (union, nothing dropped)" % L, ok_push,
                  {"pushedKeys": sorted((pb or {}).keys()) if isinstance(pb, dict) else pb})
        out[L] = {"local": local, "messages": summarize(log), "log": log[-40:]}
        no_errors_check(chk, L, b.errors(fr))
    L = "noload"
    with Browser(args, L) as b:
        fr = open_portal(b, args, "noload", sandbox, allow)
        if fr is None:
            chk.check("%s: frame loads" % L, False, None)
            return
        truth, info = scripted_run(fr, args, chk, L)
        log = bridge_log(b)
        saves = msgs_in(log, "forgeflow:save")
        if truth is not None:
            chk.check("%s (negative control): the cloud read never answers -> the game never sends forgeflow:save" % L,
                      len(saves) == 0 and len(msgs_in(log, "forgeflow:load")) >= 1, {"messages": summarize(log)})
        out[L] = {"truth": truth, "messages": summarize(log), "log": log[-40:]}


def variant_standalone(args, chk, out):
    L = "standalone"
    with Browser(args, L) as b:
        # anything the game posts to a parent would go to itself here; record it
        b.page.add_init_script("""(() => { if (window.top !== window) return; window.__H_POSTS__ = [];
          const op = window.postMessage.bind(window);
          window.postMessage = function (m, ...r) { try { if (m && typeof m === 'object' && String(m.type || '').startsWith('forgeflow:')) window.__H_POSTS__.push(String(m.type)); } catch (_) {} return op(m, ...r); };
        })();""")
        b.page.goto(game_url(args), wait_until="load", timeout=60_000)
        truth, info = scripted_run(b.page, args, chk, L)
        posts = ev(b.page, "() => window.__H_POSTS__ || []", default=[])
        out[L] = {"truth": truth, "info": info, "posts": posts}
        if truth is not None:
            chk.check("%s: posts no forgeflow:* message without a parent" % L, not posts, {"posts": posts})
            al = info.get("accountLine") or {}
            chk.check("%s: no account line on the end screen without a portal" % L, not al.get("visible"), al)
        no_errors_check(chk, L, b.errors(b.page))


# ─────────────────────────────── selftest (validator only) ───────────────────────────────
def selftest():
    good = {"run_nonce": "bt-muqf6zqx-16cs49o180uy", "mode": "solo", "titan": "molo", "biome": "grideast",
            "result": "clear", "duration_s": 1210, "clear_s": 1209.4, "level": 35, "peak_rank": 4, "kills": 1200,
            "crushed": 40, "tonnage": 900000, "blocks": 12, "bosses": 1, "gate_kills": 3, "endless_s": 0,
            "endless_score": 0, "rematches": 0, "titans_eaten": 0, "vs_match_id": None, "build_version": None, "phase": "run"}
    truth = {"titan": "molo", "biome": "grideast", "result": "clear", "level": 35, "kills": 1200, "tonnage": 900000,
             "peakRank": 4, "blocks": 12, "crushed": 40, "bosses": 1, "gateKills": 3, "clearS": 1209.4, "endT": 1209.47}
    cases = [("good", good, truth, True)]
    for k, v in (("run_nonce", "short"), ("run_nonce", "bt muqf6zqx 16cs"), ("mode", "vs"), ("titan", "godzilla"),
                 ("result", "win"), ("phase", "x"), ("duration_s", 3), ("duration_s", 1210.5), ("level", 0),
                 ("level", 81), ("peak_rank", 5), ("kills", -1), ("kills", 36801), ("crushed", 1201), ("tonnage", 1.5),
                 ("blocks", 241), ("clear_s", None), ("clear_s", 299.9), ("clear_s", 1209.45), ("clear_s", 1211.1),
                 ("bosses", 3), ("gate_kills", 5), ("titans_eaten", 1), ("placement", 1),
                 ("build_version", "x" * 65), ("tonnage", 900001), ("level", 36), ("duration_s", 1215)):
        bad = dict(good)
        if v is None:
            bad.pop(k)
        else:
            bad[k] = v
        label = "%s=%r" % (k, v if not (isinstance(v, str) and len(v) > 20) else v[:8] + "...")
        cases.append((label, bad, truth, False))
    cases.append(("clear_s = floored duration_s + 0.9", dict(good, duration_s=1209, clear_s=1209.9),
                  dict(truth, clearS=1209.9, endT=1209.95), True))
    dead = dict(good, result="dead")
    cases.append(("dead with clear_s", dead, truth, False))
    dead2 = dict(dead)
    dead2.pop("clear_s")
    cases.append(("dead without clear_s (truth result clear)", dead2, truth, False))
    cases.append(("endless_s on a dead run", dict(dead2, endless_s=10), dict(truth, result="dead", clearS=None), False))
    cases.append(("dead run vs dead truth", dead2, dict(truth, result="dead", clearS=None), True))
    cases.append(("cheat clear at 9 s (server rejects)", dict(good, duration_s=10, clear_s=9.1, kills=6),
                  None, False))
    fails = 0
    for name, p, t, want_ok in cases:
        probs = validate_run(p, t)
        ok = (not probs) == want_ok
        fails += 0 if ok else 1
        print("  [%s] %-42s -> %s" % ("ok" if ok else "XX", name, "valid" if not probs else probs[0][:90]))
    p, where = run_payload({"type": "forgeflow:run_result", "payload": good})
    fails += 0 if where == "payload" else 1
    print("selftest: %d case(s) wrong of %d" % (fails, len(cases) + 1))
    return 0 if fails == 0 else 1


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--only", choices=("signed", "guest", "cloud", "standalone", "silent"), default=None)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--play-s", type=float, default=9.0, help="real seconds of play before the one cheat (>= 5 s: bt_runs duration_s >= 5)")
    ap.add_argument("--clock", type=float, default=1150.6, help="cheat.time() to this run clock before the boss kill (0 = off); the server needs clear_s >= 300; the .6 exercises a floored duration_s vs a tenths clear_s")
    ap.add_argument("--settle-s", type=float, default=4.0, help="seconds to keep recording after the tabloid is up")
    ap.add_argument("--boot-timeout", type=float, default=90.0)
    ap.add_argument("--selftest", action="store_true", help="validator unit test only (no browser)")
    args = ap.parse_args()
    if args.selftest:
        return selftest()

    chk = Checks()
    out = {"base": args.base, "titan": args.titan, "biome": args.biome, "seed": args.seed, "playS": args.play_s}
    os.environ.setdefault("BT_FROZEN", "1")              # a vite started here never hot-reloads mid-test
    try:
        server = C.ensure_server(args.base, not args.no_serve)
    except C.HarnessError as e:
        print("COULD NOT JUDGE: %s" % e)
        return 2
    try:
        sandbox, allow, line = read_portal_attrs()
        chk.check("portal iframe sandbox + allow read from GamePlayer.tsx", bool(sandbox),
                  {"file": GAMEPLAYER, "line": line, "sandbox": sandbox, "allow": allow})
        out["portal"] = {"sandbox": sandbox, "allow": allow, "line": line}
        if not sandbox:
            return 2
        portal_ts = os.path.join(GAME_ROOT, "src", "net", "portal.ts")
        out["portalTsPresent"] = os.path.exists(portal_ts)
        if not out["portalTsPresent"]:
            chk.note("src/net/portal.ts is not present (A-GAME's bridge client has not landed)")
        todo = [args.only] if args.only else ["signed", "guest", "cloud", "standalone"]
        ps = PortalServer().__enter__()
        PORTAL["origin"] = ps.origin
        for v in todo:
            print("== variant %s" % v, flush=True)
            if v == "signed":
                variant_signed(args, chk, sandbox, allow, out)
            elif v == "guest":
                variant_guest(args, chk, sandbox, allow, out)
            elif v == "silent":
                variant_silent(args, chk, sandbox, allow, out)
            elif v == "cloud":
                variant_cloud(args, chk, sandbox, allow, out)
            else:
                variant_standalone(args, chk, out)
    finally:
        try:
            ps.__exit__()
        except Exception:
            pass
        C.stop_server(server)
    out["checks"] = chk.items
    out["notes"] = chk.notes
    ran_any = any(c["name"].endswith("reaches its end (tabloid)") and c["ok"] for c in chk.items)
    verdict = "PASS" if not chk.failed and ran_any else ("FAIL" if ran_any or chk.failed else "COULD NOT JUDGE")
    out["verdict"] = verdict
    path = C.save_report("portalcheck" + ("_" + args.only if args.only else ""), out, base=args.base,
                         report_dir=args.report_dir)
    print("\nportalcheck: %s  (%d checks, %d failed)  report %s" % (verdict, len(chk.items), len(chk.failed), path))
    for c in chk.failed:
        print("  FAILED: %s" % c["name"])
    return 0 if verdict == "PASS" else (1 if verdict == "FAIL" else 2)


if __name__ == "__main__":
    sys.exit(main())
