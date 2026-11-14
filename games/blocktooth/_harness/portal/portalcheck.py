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
  vr         (--only vr; headless, no GPU) the VS REPORTING gate VR (ONLINE_PLAN 6.3, lane O-REPORT): several game frames side by side in
             ONE stand-in portal, each frame its OWN account and each running _harness/portal/vr_client.html (the real sim world of a
             finished 4-seat VS match + the real PortalClient.vsMatchEnded, as App.reportVsEnd calls it). The stand-in runs every
             forgeflow:vs_result through vs_rpc_mirror.cjs (a 1:1 mirror of 0008's bt_report_vs) and acks like gameBridge.ts.
               A  2 humans + 2 bots, human 1 wins: 2 bt_vs_results rows + 1 bt_vs_matches row with winner_id set (the reports agree);
                  exactly ONE vs_result per frame; the first ack is unconfirmed, the second confirmed
               B  2 humans + a GUEST + 1 bot: the guest sends NOTHING (no vs_result / achievement / save), the 2 signed-in humans'
                  rows land and the winner is still confirmed (a guest never blocks the others)
               C  a BOT wins: 2 rows, winner_id stays NULL, no vs_wins
               D  1 human + 3 bots (practice shape): 1 row, personal stats only (no board win, vs_solo_wins 1)
             and per frame: the VS goals posted once each (SYNDICATED for everyone, CERTIFIED HEADLINE only for the winner).
  vsapp      (--only vsapp; headed d3d11 like the other app variants) the REAL game: __BT__.newVs (VS PRACTICE, 1 human + 3 bots) ->
             vs.dev.end(0) (the dev end the VS test surface has) -> ONE forgeflow:vs_result for the match (humans 1, bots 3, placement 1),
             a bt_vs_results row in the stand-in DB, the VS goals posted once; a second match files a second report; a GUEST posts nothing;
  real2      (--only real2) TWO real game frames = a 2-human + 2-bot match: App.vsReport (vs.dev.reportCtx) hands each frame the online-style
             match context (idle 2nd human seat); frame 1's human wins -> 2 rows + 1 match row + winner confirmed, through the real App.
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
VS_RPC_PATH = "/__bt_vs_rpc.js"
VS_RPC_JS = os.path.join(HERE, "vs_rpc_mirror.cjs")
VS_USERS = {"u1": "00000000-0000-4000-8000-0000000000a1", "u2": "00000000-0000-4000-8000-0000000000a2",
            "u3": "00000000-0000-4000-8000-0000000000a3", "u4": "00000000-0000-4000-8000-0000000000a4", "default": "00000000-0000-4000-8000-00000000b7b7"}
JUDGED = []          # set once a VS variant got as far as a decided match (so --only vr / vsapp can pass or fail)
VS_GOAL_IDS = ("g_vs_syndicated", "g_vs_certified_headline", "g_vs_crossover_episode", "g_vs_hostile_takeover",
               "g_vs_zoned_residential", "g_vs_network_exclusive", "g_vs_ensemble_cast", "g_vs_ratings_war")

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
                path = urllib.parse.urlparse(self.path).path
                if path not in (PORTAL_PATH, VS_RPC_PATH):
                    self.send_response(404)
                    self.end_headers()
                    return
                is_rpc = path == VS_RPC_PATH
                body = open(VS_RPC_JS if is_rpc else HOST_HTML, "rb").read()
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript; charset=utf-8" if is_rpc else "text/html; charset=utf-8")
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


# ─────────────────────────────── VR gate: VS reporting through the stand-in ───────────────────────────────
VR_URL_JS = "() => window.__VR__ ? { done: !!window.__VR__.done, error: window.__VR__.error } : null"


def vr_client_url(args, **q):
    base = args.base.rstrip("/")
    return "%s/_harness/portal/vr_client.html?%s" % (base, urllib.parse.urlencode({k: (v if isinstance(v, str) else json.dumps(v)) for k, v in q.items()}))


def vr_scenario(args, chk, sandbox, allow, out, label, humans, users, winner, expect, deaf=()):
    """One finished match, one frame per human. users: ['u1','u2','guest',...] (frame k = seat k). expect: callable(ctx) -> None (adds checks)."""
    match_id = "blocktooth:vr-%s:0001" % label.lower().replace(" ", "")
    uids = [VS_USERS.get(u) if u in VS_USERS else None for u in users] + [None] * (4 - len(users))
    frames = []
    for k, u in enumerate(users):
        my_uids = [None if (k in deaf and i != k) else x for i, x in enumerate(uids)]    # `deaf` frames never heard the others' account ids
        game = vr_client_url(args, seed=7, biome="grideast", humans=",".join(str(i) for i in range(len(users))), slot=k,
                             winner=winner, matchId=match_id, uids=my_uids, simS=12, tag=k)
        frames.append({"game": game, "user": u})
    L = "vr/" + label
    with Browser(args, L) as b:
        q = {"mode": "signed", "frames": json.dumps(frames), "sandbox": sandbox, "allow": allow or ""}
        b.page.goto(PORTAL["origin"] + PORTAL_PATH + "?" + urllib.parse.urlencode(q), wait_until="load", timeout=60_000)
        t0 = time.time()
        res = {}
        while time.time() - t0 < 240:
            clients = [f for f in b.page.frames if f != b.page.main_frame and "vr_client.html" in f.url]
            res = {}
            for f in clients:
                r = ev(f, VR_URL_JS, default=None)
                tag = int(urllib.parse.parse_qs(urllib.parse.urlparse(f.url).query).get("tag", ["-1"])[0])
                if isinstance(r, dict) and not r.get("__error"):
                    res[tag] = (f, r)
            if len(res) == len(users) and all(r["done"] for _, r in res.values()):
                break
            time.sleep(0.5)
        ok = len(res) == len(users) and all(r["done"] for _, r in res.values())
        chk.check("%s: every client finished its match (%d frames)" % (L, len(users)), ok,
                  {"frames": {k: v[1] for k, v in res.items()}, "after_s": round(time.time() - t0, 1)})
        if not ok:
            return
        time.sleep(1.0)                                   # let the last acks / achievement posts land in the host log
        vr = {k: ev(f, "() => JSON.parse(JSON.stringify(window.__VR__))") for k, (f, _) in res.items()}
        log = bridge_log(b)
        db = ev(b.page, "() => JSON.parse(JSON.stringify({ matches: window.__BRIDGE.db.bt_vs_matches, results: window.__BRIDGE.db.bt_vs_results, runs: window.__BRIDGE.db.bt_runs, stats: window.__BRIDGE.db.bt_player_stats, titan: window.__BRIDGE.db.bt_titan_stats, calls: window.__BRIDGE.db.calls.map(c => ({uid: c.uid, ok: c.result.ok, err: c.result.error, reason: c.result.reason, conf: c.result.winner_confirmed })) }))")
        out[L] = {"vr": vr, "db": db, "messages": summarize(log)}
        out["judged"] = True
        no_err = all(not (v or {}).get("error") for v in vr.values())
        chk.check("%s: no client error" % L, no_err, {k: (v or {}).get("error") for k, v in vr.items()})
        msgs = {k: [x for x in log if x.get("dir") == "in" and x.get("fromGame") and x.get("frame") == k] for k in range(len(users))}
        ctx = {"vr": vr, "db": db, "log": log, "msgs": msgs, "uids": uids, "users": users, "match_id": match_id, "winner": winner}
        expect(ctx, L)
        no_errors_check(chk, L, b.errors(b.page))


def vs_msgs(ctx, k, typ):
    return [x for x in ctx["msgs"][k] if x["type"] == typ]


def ach_of(ctx, k):
    return [x["msg"].get("achievementSlug") for x in vs_msgs(ctx, k, "forgeflow:achievement")]


def variant_vr(args, chk, sandbox, allow, out):
    def A(ctx, L):
        db, vr = ctx["db"], ctx["vr"]
        U1, U2 = VS_USERS["u1"], VS_USERS["u2"]
        sends = [vs_msgs(ctx, k, "forgeflow:vs_result") for k in (0, 1)]
        chk.check("%s: exactly ONE forgeflow:vs_result per human frame" % L, all(len(x) == 1 for x in sends), {"counts": [len(x) for x in sends]})
        chk.check("%s: 2 bt_vs_results rows (one per human) + 1 bt_vs_matches row" % L,
                  len(db["results"]) == 2 and len(db["matches"]) == 1 and {r["user_id"] for r in db["results"]} == {U1, U2},
                  {"results": db["results"], "matches": db["matches"]})
        m = (list(db["matches"].values()) or [None])[0] or {}
        chk.check("%s: the match row has winner_id = human 1 (the reports agree), humans 2, bots 2, reports 2" % L,
                  m.get("winner_id") == U1 and m.get("humans") == 2 and m.get("bots") == 2 and m.get("reports") == 2, m)
        chk.check("%s: both reports were accepted (no rejection) and exactly one ack confirmed the winner (the later one)" % L,
                  [c["ok"] for c in db["calls"]] == [True, True] and sorted(bool(c["conf"]) for c in db["calls"]) == [False, True], db["calls"])
        st1, st2 = db["stats"].get(U1, {}), db["stats"].get(U2, {})
        chk.check("%s: vs_wins credited once, to the winner only; both got vs_matches 1; 2 bt_runs rows (mode vs)" % L,
                  st1.get("vs_wins") == 1 and not st2.get("vs_wins") and st1.get("vs_matches") == 1 and st2.get("vs_matches") == 1
                  and len(db["runs"]) == 2 and all(r["mode"] == "vs" for r in db["runs"]), {"stats": db["stats"], "runs": db["runs"]})
        pay = [(vr[k] or {}).get("payload") or {} for k in (0, 1)]
        chk.check("%s: payloads: same match_id, placements 1 and 2..4, claimed_winner = human 1 on both, titans = the seats' own" % L,
                  pay[0].get("match_id") == pay[1].get("match_id") and pay[0].get("placement") == 1 and pay[1].get("placement") in (2, 3, 4)
                  and pay[0].get("claimed_winner") == U1 and pay[1].get("claimed_winner") == U1
                  and pay[0].get("titan") == "molo" and pay[1].get("titan") == "voltkite", pay)
        a0, a1 = ach_of(ctx, 0), ach_of(ctx, 1)
        chk.check("%s: VS goals posted once each; SYNDICATED for both, CERTIFIED HEADLINE only for the winner; every slug is a VS goal" % L,
                  len(a0) == len(set(a0)) and len(a1) == len(set(a1)) and "g_vs_syndicated" in a0 and "g_vs_syndicated" in a1
                  and "g_vs_certified_headline" in a0 and "g_vs_certified_headline" not in a1 and all(x in VS_GOAL_IDS for x in a0 + a1),
                  {"winner": a0, "loser": a1})
        bad = [x["type"] for k in (0, 1) for x in ctx["msgs"][k] if x["type"] in ("forgeflow:run_result", "forgeflow:game_over", "forgeflow:score")]
        chk.check("%s: a VS match files no solo run_result / game_over / score" % L, not bad, bad)
        filing = [(vr[k] or {}).get("filing") for k in (0, 1)]
        chk.check("%s: the client parsed the acks (kind ack, no error; reports 1 then 2)" % L,
                  all(f and f.get("kind") == "ack" and not f.get("error") for f in filing) and sorted(f.get("reports") for f in filing) == [1, 2], filing)

    def Bg(ctx, L):
        db, vr = ctx["db"], ctx["vr"]
        U1, U2 = VS_USERS["u1"], VS_USERS["u2"]
        gw = [x for x in ctx["msgs"][2] if x["type"] in WRITE_TYPES or x["type"] == "forgeflow:vs_result"]
        chk.check("%s: the GUEST frame sends NOTHING (no vs_result / achievement / save / game_over)" % L, not gw, [(x["type"]) for x in gw])
        chk.check("%s: the guest still earned its goals locally (ledger) and built no filing" % L,
                  "g_vs_syndicated" in ((vr[2] or {}).get("ledger") or {}).get("done", []) and (vr[2] or {}).get("filing") is None, vr[2])
        chk.check("%s: 2 rows (the two signed-in humans), 1 match row (humans 3, bots 1, reports 2)" % L,
                  len(db["results"]) == 2 and {r["user_id"] for r in db["results"]} == {U1, U2} and len(db["matches"]) == 1
                  and list(db["matches"].values())[0].get("humans") == 3 and list(db["matches"].values())[0].get("reports") == 2, db)
        m = (list(db["matches"].values()) or [None])[0] or {}
        chk.check("%s: the guest did not block the others: winner_id = human 1 is CONFIRMED" % L, m.get("winner_id") == U1, m)
        chk.check("%s: both signed-in reports accepted" % L, [c["ok"] for c in db["calls"]] == [True, True], db["calls"])

    def C(ctx, L):
        db = ctx["db"]
        m = (list(db["matches"].values()) or [None])[0] or {}
        U1, U2 = VS_USERS["u1"], VS_USERS["u2"]
        chk.check("%s: a BOT won: both human reports filed (2 rows) and winner_id stays NULL, vs_wins 0" % L,
                  len(db["results"]) == 2 and m.get("winner_id") is None and not db["stats"].get(U1, {}).get("vs_wins") and not db["stats"].get(U2, {}).get("vs_wins"), db)
        chk.check("%s: both humans claimed null (a bot won)" % L, all(((ctx["vr"][k] or {}).get("payload") or {}).get("claimed_winner") is None for k in (0, 1)), None)
        chk.check("%s: nobody earned CERTIFIED HEADLINE" % L, all("g_vs_certified_headline" not in ach_of(ctx, k) for k in (0, 1)), [ach_of(ctx, 0), ach_of(ctx, 1)])

    def D(ctx, L):
        db = ctx["db"]
        U1 = VS_USERS["u1"]
        m = (list(db["matches"].values()) or [None])[0] or {}
        st = db["stats"].get(U1, {})
        chk.check("%s: 1 human + 3 bots: 1 row, match humans 1 / bots 3, NO board win (winner_id null), vs_solo_wins 1, vs_wins 0" % L,
                  len(db["results"]) == 1 and m.get("humans") == 1 and m.get("bots") == 3 and m.get("winner_id") is None
                  and st.get("vs_solo_wins") == 1 and not st.get("vs_wins"), db)
        led = ((ctx["vr"][0] or {}).get("ledger") or {})
        chk.check("%s: a practice win earns CERTIFIED HEADLINE + SYNDICATED but does not count toward the grind goals (wins 0)" % L,
                  "g_vs_certified_headline" in ach_of(ctx, 0) and "g_vs_syndicated" in ach_of(ctx, 0) and led.get("wins") == 0, {"ach": ach_of(ctx, 0), "ledger": led})

    def E(ctx, L):
        db = ctx["db"]
        m = (list(db["matches"].values()) or [None])[0] or {}
        U1 = VS_USERS["u1"]
        chk.check("%s: NEGATIVE CONTROL: a loser that never heard the winner's account id claims null -> both rows filed, winner NOT confirmed" % L,
                  len(db["results"]) == 2 and m.get("winner_id") is None and not db["stats"].get(U1, {}).get("vs_wins"), {"matches": db["matches"], "calls": db["calls"]})
        chk.check("%s: the deaf loser's payload says claimed_winner null, the winner's names itself" % L,
                  ((ctx["vr"][1] or {}).get("payload") or {}).get("claimed_winner") is None and ((ctx["vr"][0] or {}).get("payload") or {}).get("claimed_winner") == U1, None)

    def G(ctx, L):
        db, vr = ctx["db"], ctx["vr"]
        U1 = VS_USERS["u1"]
        m = (list(db["matches"].values()) or [None])[0] or {}
        chk.check("%s: 4 humans + 0 bots: 4 rows, 1 match row (humans 4, bots 0, reports 4), winner_id = human 1 confirmed" % L,
                  len(db["results"]) == 4 and m.get("humans") == 4 and m.get("bots") == 0 and m.get("reports") == 4 and m.get("winner_id") == U1, db)
        chk.check("%s: NETWORK EXCLUSIVE (win a full 4-player online lobby) for the winner only" % L,
                  "g_vs_network_exclusive" in ach_of(ctx, 0) and all("g_vs_network_exclusive" not in ach_of(ctx, k) for k in (1, 2, 3)), [ach_of(ctx, k) for k in range(4)])
        chk.check("%s: all four reports accepted; exactly the last ack confirmed" % L,
                  [c["ok"] for c in db["calls"]] == [True] * 4 and sum(1 for c in db["calls"] if c["conf"]) >= 1, db["calls"])

    vr_scenario(args, chk, sandbox, allow, out, "A 2 humans + 2 bots", 2, ["u1", "u2"], 0, A)
    vr_scenario(args, chk, sandbox, allow, out, "B 2 humans + guest", 3, ["u1", "u2", "guest"], 0, Bg)
    vr_scenario(args, chk, sandbox, allow, out, "C bot wins", 2, ["u1", "u2"], 2, C)
    vr_scenario(args, chk, sandbox, allow, out, "D practice shape", 1, ["u1"], 0, D)
    vr_scenario(args, chk, sandbox, allow, out, "E deaf loser", 2, ["u1", "u2"], 0, E, deaf=(1,))
    vr_scenario(args, chk, sandbox, allow, out, "G four humans", 4, ["u1", "u2", "u3", "u4"], 0, G)


# ─────────────────────────────── vsapp: the REAL game (VS PRACTICE) through the stand-in ───────────────────────────────
VS_STATE_JS = "() => { try { const s = window.__BT__.vs.state(); return s ? { phase: s.phase, clock: s.clock, winner: s.winner, local: s.local } : null; } catch (e) { return { err: String(e) }; } }"


def vsapp_match(b, fr, args, chk, L, seed, winner, jump_s=30.0):
    """Start a VS PRACTICE match in the real game, jump the match clock, end it for `winner` with the dev end. Returns the vs.report()."""
    r = ev(fr, "async (o) => { await window.__BT__.newVs(o); return window.__BT__.state().screen; }",
           {"titan": "molo", "biome": "grideast", "seed": seed, "bots": "regular"})
    if isinstance(r, dict) and r.get("__error"):
        chk.check("%s: __BT__.newVs starts a VS PRACTICE match" % L, False, r)
        return None
    ok, scr = wait_screen(fr, ("play",), 90)
    chk.check("%s: the VS match reaches play" % L, ok, {"screen": scr})
    if not ok:
        return None
    ev(fr, "(c) => window.__BT__.vs.dev.jump(c)", jump_s)
    time.sleep(0.4)
    e = ev(fr, "(wn) => window.__BT__.vs.dev.end(wn)", winner)
    chk.check("%s: the dev end decides the match (winner seat %d)" % (L, winner), e is True, e)
    if e is True:
        JUDGED.append(1)
    t0 = time.time()
    rep = None
    while time.time() - t0 < 30:
        rep = ev(fr, "() => window.__BT__.vs.report()", default=None)
        if isinstance(rep, dict) and not rep.get("__error") and (rep.get("filing") or time.time() - t0 > 12):
            break
        time.sleep(0.4)
    return rep


def variant_vsapp(args, chk, sandbox, allow, out):
    L = "vsapp"
    U = VS_USERS["default"]
    with Browser(args, L) as b:
        fr = open_portal(b, args, "signed", sandbox, allow)
        chk.check("%s: the game frame loads inside the cross-origin sandboxed parent" % L, fr is not None, {"frames": [f.url for f in b.page.frames]})
        if fr is None:
            return
        t0 = time.time()
        while time.time() - t0 < args.boot_timeout and ev(fr, "() => !!(window.__BT__ && window.__BT__.vs)", default=False) is not True:
            time.sleep(0.25)
        ok, scr = wait_screen(fr, ("title", "select"), args.boot_timeout)
        chk.check("%s: the game boots to the title (VS test surface present)" % L, ok, {"screen": scr})
        if not ok:
            return
        rep1 = vsapp_match(b, fr, args, chk, L + " match 1", 7, 0)
        log = bridge_log(b)
        sends = msgs_in(log, "forgeflow:vs_result")
        chk.check("%s: match 1 (practice, human wins): exactly ONE forgeflow:vs_result" % L, len(sends) == 1, {"count": len(sends), "messages": summarize(log)})
        p = (sends[0]["msg"].get("payload") if sends else None) or {}
        chk.check("%s: payload: humans 1, bots 3, placement 1, claimed_winner = the signed-in account, 'blocktooth:practice:' match id, build_version null-or-string" % L,
                  p.get("humans") == 1 and p.get("bots") == 3 and p.get("placement") == 1 and p.get("claimed_winner") == U
                  and str(p.get("match_id", "")).startswith("blocktooth:practice:") and p.get("titan") == "molo" and p.get("biome") == "grideast", p)
        db = ev(b.page, "() => JSON.parse(JSON.stringify({ matches: window.__BRIDGE.db.bt_vs_matches, results: window.__BRIDGE.db.bt_vs_results, stats: window.__BRIDGE.db.bt_player_stats, calls: window.__BRIDGE.db.calls.map(c => ({ ok: c.result.ok, err: c.result.error, reason: c.result.reason })) }))")
        chk.check("%s: the stand-in DB holds 1 bt_vs_results row, 1 bt_vs_matches row (humans 1, no board winner), vs_solo_wins 1; the report was accepted" % L,
                  len(db["results"]) == 1 and len(db["matches"]) == 1 and list(db["matches"].values())[0].get("winner_id") is None
                  and (db["stats"].get(U) or {}).get("vs_solo_wins") == 1 and [c["ok"] for c in db["calls"]] == [True], db)
        ach = [x["msg"].get("achievementSlug") for x in msgs_in(log, "forgeflow:achievement")]
        chk.check("%s: VS goals posted once each (SYNDICATED + CERTIFIED HEADLINE at least), all VS ids" % L,
                  "g_vs_syndicated" in ach and "g_vs_certified_headline" in ach and len(ach) == len(set(ach)) and all(a in VS_GOAL_IDS for a in ach), ach)
        chk.check("%s: __BT__.vs.report(): the goals + the portal's ack (kind ack, no error)" % L,
                  isinstance(rep1, dict) and set(ach) == set(rep1.get("goals") or []) and (rep1.get("filing") or {}).get("kind") == "ack" and not (rep1.get("filing") or {}).get("error"), rep1)
        # a second match -> a second report, goals not re-posted
        ev(fr, "() => { try { window.__BT__.dismiss(); } catch (e) {} }")
        ev(fr, "async () => { try { const a = window.__BT__; if (a.goTitle) await a.goTitle(); } catch (e) {} }")
        rep2 = vsapp_match(b, fr, args, chk, L + " match 2", 11, 2)
        log2 = bridge_log(b)
        sends2 = msgs_in(log2, "forgeflow:vs_result")
        chk.check("%s: match 2 (a bot wins): a second forgeflow:vs_result, a different match id" % L,
                  len(sends2) == 2 and sends2[0]["msg"]["payload"]["match_id"] != sends2[1]["msg"]["payload"]["match_id"], {"count": len(sends2)})
        p2 = (sends2[1]["msg"].get("payload") if len(sends2) > 1 else None) or {}
        chk.check("%s: match 2 payload: placement 2..4, claimed_winner null (a bot won)" % L, p2.get("placement") in (2, 3, 4) and p2.get("claimed_winner") is None, p2)
        ach2 = [x["msg"].get("achievementSlug") for x in msgs_in(log2, "forgeflow:achievement")]
        chk.check("%s: goals already earned are not posted again" % L, len(ach2) == len(set(ach2)) and "g_vs_certified_headline" in ach2, ach2)
        no_errors_check(chk, L, b.errors(fr))
    # a guest: nothing posted
    with Browser(args, L + "-guest") as b:
        fr = open_portal(b, args, "guest", sandbox, allow)
        if fr is None:
            chk.check("%s-guest: the game frame loads" % L, False, None)
            return
        t0 = time.time()
        while time.time() - t0 < args.boot_timeout and ev(fr, "() => !!(window.__BT__ && window.__BT__.vs)", default=False) is not True:
            time.sleep(0.25)
        wait_screen(fr, ("title", "select"), args.boot_timeout)
        rep = vsapp_match(b, fr, args, chk, L + "-guest match", 7, 0)
        log = bridge_log(b)
        writes = [x for x in msgs_in(log) if x["type"] in WRITE_TYPES]
        chk.check("%s-guest: a guest's VS match posts NOTHING (no vs_result / achievement / save)" % L, not writes, [(x["type"]) for x in writes])
        chk.check("%s-guest: the goals still land in the local ledger" % L, isinstance(rep, dict) and "g_vs_syndicated" in ((rep.get("ledger") or {}).get("done") or []), rep)
        no_errors_check(chk, L + "-guest", b.errors(fr))


def variant_real2(args, chk, sandbox, allow, out):
    """TWO real game frames = a 2-human + 2-bot match as the online layer would hand it to App.reportVsEnd (App.vsReport = the match
    context; the 2nd human is an IDLE human seat of each frame's own practice world: vs.dev.reportCtx). Frame 1's human wins."""
    L = "real2"
    U1, U2 = VS_USERS["u1"], VS_USERS["u2"]
    game = game_url(args)
    frames = [{"game": game, "user": "u1"}, {"game": game, "user": "u2"}]
    with Browser(args, L) as b:
        q = {"mode": "signed", "frames": json.dumps(frames), "sandbox": sandbox, "allow": allow or ""}
        b.page.goto(PORTAL["origin"] + PORTAL_PATH + "?" + urllib.parse.urlencode(q), wait_until="load", timeout=60_000)
        gb = urllib.parse.urlparse(args.base)
        t0 = time.time()
        fr = []
        while time.time() - t0 < args.boot_timeout:
            fr = [f for f in b.page.frames if f != b.page.main_frame and urllib.parse.urlparse(f.url).netloc == gb.netloc]
            if len(fr) == 2 and all(ev(f, "() => !!(window.__BT__ && window.__BT__.vs)", default=False) is True for f in fr):
                break
            time.sleep(0.4)
        chk.check("%s: both game frames boot (VS test surface present)" % L, len(fr) == 2, {"frames": [f.url for f in b.page.frames]})
        if len(fr) != 2:
            return
        # frame order = DOM order = host frame order
        order = sorted(fr, key=lambda f: b.page.frames.index(f))
        mid = "blocktooth:real2:0001"
        titans = ["molo", "voltkite"]
        for k, f in enumerate(order):
            r = ev(f, "async (o) => { await window.__BT__.newVs(o); return window.__BT__.state().screen; }",
                   {"titan": titans[k], "biome": "grideast", "seed": 7 + k, "bots": "regular"})
            chk.check("%s: frame %d starts its VS match" % (L, k), not (isinstance(r, dict) and r.get("__error")), r)
        for k, f in enumerate(order):
            ok, scr = wait_screen(f, ("play",), 120)
            chk.check("%s: frame %d reaches play" % (L, k), ok, {"screen": scr})
            if not ok:
                return
        for k, f in enumerate(order):
            uids = [U1, U2, None, None] if k == 0 else [U2, U1, None, None]
            c = ev(f, "(o) => window.__BT__.vs.dev.reportCtx(o)", {"matchId": mid, "humans": 2, "uids": uids, "humanSeats": [0, 1]})
            chk.check("%s: frame %d gets the online match context (App.vsReport)" % (L, k), c is True, c)
        for k, f in enumerate(order):
            ev(f, "(c) => window.__BT__.vs.dev.jump(c)", 40.0)
        time.sleep(0.5)
        for k, f in enumerate(order):
            e = ev(f, "(wn) => window.__BT__.vs.dev.end(wn)", 0 if k == 0 else 1)     # frame 0: me wins; frame 1: the OTHER human (seat 1 = U1) wins
            chk.check("%s: frame %d decides its match" % (L, k), e is True, e)
        JUDGED.append(1)
        reps = {}
        t0 = time.time()
        while time.time() - t0 < 40:
            reps = {k: ev(f, "() => window.__BT__.vs.report()", default=None) for k, f in enumerate(order)}
            if all(isinstance(r, dict) and not r.get("__error") and r.get("filing") for r in reps.values()):
                break
            time.sleep(0.5)
        log = bridge_log(b)
        db = ev(b.page, "() => JSON.parse(JSON.stringify({ matches: window.__BRIDGE.db.bt_vs_matches, results: window.__BRIDGE.db.bt_vs_results, stats: window.__BRIDGE.db.bt_player_stats, calls: window.__BRIDGE.db.calls.map(c => ({ uid: c.uid, ok: c.result.ok, err: c.result.error, reason: c.result.reason, conf: c.result.winner_confirmed })) }))")
        out[L] = {"db": db, "reports": reps, "messages": summarize(log)}
        sends = {k: [x for x in log if x.get("dir") == "in" and x.get("fromGame") and x.get("frame") == k and x["type"] == "forgeflow:vs_result"] for k in (0, 1)}
        chk.check("%s: exactly ONE forgeflow:vs_result per frame" % L, all(len(v) == 1 for v in sends.values()), {k: len(v) for k, v in sends.items()})
        m = (list((db or {}).get("matches", {}).values()) or [None])[0] or {}
        chk.check("%s: 2 bt_vs_results rows + 1 bt_vs_matches row (humans 2, bots 2, reports 2) with winner_id = human 1 (the reports agree)" % L,
                  len(db["results"]) == 2 and len(db["matches"]) == 1 and m.get("humans") == 2 and m.get("bots") == 2 and m.get("reports") == 2 and m.get("winner_id") == U1,
                  {"db": db})
        chk.check("%s: both reports accepted; one ack confirmed" % L, [c["ok"] for c in db["calls"]] == [True, True] and sum(1 for c in db["calls"] if c["conf"]) == 1, db["calls"])
        pays = {k: (v[0]["msg"].get("payload") if v else {}) for k, v in sends.items()}
        chk.check("%s: payloads: placement 1 / 2..4, claimed_winner = human 1 on both, the frames' own titans" % L,
                  pays[0].get("placement") == 1 and pays[1].get("placement") in (2, 3, 4) and pays[0].get("claimed_winner") == U1 and pays[1].get("claimed_winner") == U1
                  and pays[0].get("titan") == "molo" and pays[1].get("titan") == "voltkite", pays)
        a = {k: [x["msg"].get("achievementSlug") for x in log if x.get("dir") == "in" and x.get("frame") == k and x["type"] == "forgeflow:achievement"] for k in (0, 1)}
        chk.check("%s: goals: both SYNDICATED; CERTIFIED HEADLINE only for the winner; the 2-human win counts toward the grind goals (ledger wins 1)" % L,
                  "g_vs_syndicated" in a[0] and "g_vs_syndicated" in a[1] and "g_vs_certified_headline" in a[0] and "g_vs_certified_headline" not in a[1]
                  and ((reps[0] or {}).get("ledger") or {}).get("wins") == 1, {"ach": a, "reports": reps})
        no_errors_check(chk, L, b.errors(order[0]))


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
    ap.add_argument("--only", choices=("signed", "guest", "cloud", "standalone", "silent", "vr", "vsapp", "real2"), default=None)
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
        todo = [args.only] if args.only else ["signed", "guest", "cloud", "standalone", "vr"]
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
            elif v == "vr":
                variant_vr(args, chk, sandbox, allow, out)
            elif v == "vsapp":
                variant_vsapp(args, chk, sandbox, allow, out)
            elif v == "real2":
                variant_real2(args, chk, sandbox, allow, out)
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
    ran_any = bool(JUDGED) or out.get("judged") or any(c["name"].endswith("reaches its end (tabloid)") and c["ok"] for c in chk.items)
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
