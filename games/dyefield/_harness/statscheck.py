#!/usr/bin/env python
"""statscheck - DYEFIELD STATS gate G-S2 (_spec/CONTRACT_STATS.md S12): the stats layer in a real browser, against a
stand-in of the portal's postMessage bridge.

    python _harness/statscheck.py --headless                 # every scenario (~15-25 min on a loaded box)
    python _harness/statscheck.py --headless --only a,b,ui   # a subset: a b c d e f g h j k ui

The mock portal is a parent page on a DIFFERENT origin from the game (as last-circle/_harness/portalcheck.py does):
Playwright fulfils http://localhost:<port>/__df_portal with an inline page that iframes http://127.0.0.1:<port>/?... with
the sandbox and allow strings READ AT RUN TIME from forgeflow-games/src/components/game/GamePlayer.tsx. The stand-in speaks
the bridge like src/lib/gameBridge.ts: the frame-source check; forgeflow:load answered only while "signed in" (reply to
the sending frame at its origin, _reqId echoed); save -> a JS port of mergePreservingKeys; score -> keep-highest;
achievement -> idempotent by slug. Every message lands in the parent's window.__MSGS__ (wall-clock stamped). No real DB,
no network beyond localhost.

Matches: ?statsdev=1&dev=1&matchSeconds=45&autostart=1&bots=breeze. Participation is real: a real click focuses the frame,
then W + left mouse are held with periodic A / D strafes (as _harness/playtest.py drives the kit). To make the unlock set
deterministic (TEAMS TURF win -> first_match, first_win, teams_turf_win, kit_mist_rasp, map_pier18) the harness dyes the
court in the player's crew colour with the dev hook __DF__.splat in the last seconds (scenario setup, not the thing under
test; the player's own m2 / washes are untouched).

Before the INTEGRATION stage lands (runtime/src/main.ts has no createStats), the harness wires the stats module into the
page itself: it appends a small shim to the dev server's /src/main.ts response that patches Game.prototype (drainEvents /
restart / dispose -> matchBegin / simEvents / matchAbandon exactly as CONTRACT_STATS S10.1 places them) and mounts the
CAREER panel in a stand-in screen. The report says which mode ran; the menus entry checks (#dfm-career: mouse, Enter,
pad A, BACK / ESC) need the integrated build and are SKIPPED in shim mode.

Scenarios: S-a standalone (+ zero console / page errors) - S-b signed-in empty (+ S-i burst unlocks, toast vs the victory
slate at 1280x720 and 852x393) - S-c signed-out -> sign-in - S-d rich cloud (+ reduce-motion toast) - S-e corrupt record -
S-f quit mid-match - S-g slow portal - S-h foreign origin - S-j blocked storage - S-k statsdev under a production origin -
UI (CAREER panel screenshots + layout at 1280x720 and 852x393 touch).

Dev server: npx vite --port <port> --strictPort --host 127.0.0.1 with DF_FROZEN=1 (started and stopped by this script;
an already-running server on the port is reused). Report: _harness/_reports/statscheck.json; shots _shots/stats_*.png.
Exit 0 pass / 1 fail / 2 could not judge (setup).
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import subprocess
import sys
import time
import traceback
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

REPO = os.path.normpath(os.path.join(C.ROOT, "..", ".."))           # forgeflow-games/
GAMEPLAYER = os.path.join(REPO, "src", "components", "game", "GamePlayer.tsx")
MAIN_TS = os.path.join(C.ROOT, "runtime", "src", "main.ts")
DEFAULT_PORT = 5221
MATCH_Q = {"statsdev": 1, "dev": 1, "matchSeconds": 45, "autostart": 1, "bots": "breeze", "kit": "mist-rasp"}
BLOCK_STORAGE_JS = r"""(() => { try { Object.defineProperty(window, 'localStorage', { configurable: true,
  get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }); } catch (e) {} })();"""

# ───────────────────────────── the portal stand-in ─────────────────────────────
STANDIN = r"""<!doctype html><meta charset="utf-8"><title>DYEFIELD portal stand-in</title>
<style>html,body{margin:0;background:#111;overflow:hidden}iframe{width:100vw;height:100vh;border:0;display:block}</style>
<body><script>
window.__CFG__ = %(cfg)s;
window.__MSGS__ = [];
window.__REPLIES__ = [];
window.__PORTAL__ = { signedIn: !!__CFG__.signedIn, record: __CFG__.record === undefined ? null : __CFG__.record, delay: __CFG__.replyDelayMs || 0,
  scores: [], best: null, ach: [], loads: 0 };
// a port of forgeflow-games/src/lib/saveMerge.ts mergePreservingKeys
function mergePreservingKeys(stored, incoming) {
  if (stored === null || stored === undefined) return incoming;
  if (incoming === null || incoming === undefined) return stored;
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (!plain(stored) || !plain(incoming)) return incoming;
  const out = { ...stored };
  for (const k of Object.keys(incoming)) out[k] = plain(stored[k]) && plain(incoming[k]) ? mergePreservingKeys(stored[k], incoming[k]) : incoming[k];
  return out;
}
addEventListener('message', (e) => {
  const m = e.data;
  if (!m || typeof m !== 'object' || typeof m.type !== 'string' || !m.type.startsWith('forgeflow:')) return;
  const src = Array.from(document.querySelectorAll('iframe')).find((f) => f.contentWindow === e.source);   // the bridge's source check
  if (!src) return;
  const P = window.__PORTAL__;
  __MSGS__.push({ t: Date.now(), type: m.type, slug: m.achievementSlug, score: m.score, reqId: m._reqId, slot: m.slot,
    data: m.type === 'forgeflow:save' ? JSON.parse(JSON.stringify(m.data)) : undefined, signedIn: P.signedIn });
  const origin = e.origin || '*';
  switch (m.type) {
    case 'forgeflow:load':
      P.loads++;
      if (P.signedIn) {
        const reply = { type: 'forgeflow:save_loaded', data: P.record === null ? null : JSON.parse(JSON.stringify(P.record)), _reqId: m._reqId };
        setTimeout(() => { __REPLIES__.push({ t: Date.now(), reqId: m._reqId, empty: reply.data === null }); src.contentWindow.postMessage(reply, origin); }, P.delay);
      }
      break;
    case 'forgeflow:save':
      if (P.signedIn && m.data) P.record = mergePreservingKeys(P.record, m.data);
      break;
    case 'forgeflow:score':
      if (P.signedIn && typeof m.score === 'number' && isFinite(m.score)) { P.scores.push(m.score); P.best = P.best === null ? m.score : Math.max(P.best, m.score); }
      break;
    case 'forgeflow:achievement':
      if (P.signedIn && m.achievementSlug && !P.ach.includes(m.achievementSlug)) P.ach.push(m.achievementSlug);
      break;
  }
});
</script>
<iframe id="game" src="%(src)s" sandbox="%(sandbox)s" allow="%(allow)s" title="DYEFIELD"></iframe>
</body>"""

# ───────────────────────────── the pre-INTEGRATION shim ─────────────────────────────
# Appended to the dev server's /src/main.ts response (ES imports hoist, so these modules load with main.ts; the patch runs
# right after main.ts's body has STARTED boot() — boot awaits the arena long before any Game exists). The three patches put
# the hooks exactly where CONTRACT_STATS S10.1 puts them: matchBegin when a match world appears (constructor / restart),
# simEvents after every drain of a match session, matchAbandon before a match world is discarded before its horn.
SHIM_JS = r"""
;import { Game as __dfG } from '/src/game.ts';
import { createStats as __dfCS } from '/src/stats/index.ts';
(() => {
  const P = new URLSearchParams(location.search);
  const rm = () => { try { return !!JSON.parse(localStorage.getItem('dyefield.settings.v1') || '{}').reduceMotion; } catch (e) { return false; } };
  const ui = document.getElementById('ui') || document.body;
  const stats = __dfCS({ uiRoot: ui, version: 'harness-shim', dev: P.get('dev') === '1', statsDev: P.get('statsdev') === '1', reduceMotion: rm });
  stats.start();
  const G = __dfG.prototype;
  const oDrain = G.drainEvents, oRestart = G.restart, oDispose = G.dispose;
  const begin = (g) => { g.__dfStatsWorld = g.world; stats.matchBegin(g.world, { kit: g.world.runners[0].kit, skill: g.p.config.skill, online: null, localPid: 0 }); };
  G.drainEvents = function () {
    if (this.mode === 'match' && this.__dfStatsWorld !== this.world) begin(this);
    oDrain.call(this);
    if (this.mode === 'match') stats.events(this.drained, this.world);
  };
  G.restart = function () {
    if (this.mode === 'match' && this.world.phase !== 'ended') stats.matchAbandon(this.world, 'restart');
    oRestart.call(this);
    if (this.mode === 'match') begin(this);
  };
  G.dispose = function () {
    if (this.mode === 'match' && !this.disposed && this.world.phase !== 'ended') stats.matchAbandon(this.world, 'dispose');
    return oDispose.call(this);
  };
  let host = null;
  const openCareer = () => {
    if (!host) {
      host = document.createElement('div'); host.className = 'dfm'; host.id = 'df-shim-career'; host.style.zIndex = '45';
      const scr = document.createElement('section'); scr.className = 'dfm-screen dfm-s-career';
      const scrim = document.createElement('div'); scrim.className = 'dfm-scrim full';
      const head = document.createElement('header'); head.className = 'dfm-head';
      head.innerHTML = '<button class="dfm-back" id="df-shim-back"><span class="chev">&#9664;</span><span>BACK</span></button><div class="dfm-head-t"><h2>CAREER</h2></div>';
      scr.append(scrim, head, stats.career.el); host.append(scr); ui.append(host);
      head.querySelector('button').addEventListener('click', () => { host.hidden = true; });
    }
    host.hidden = false;
    stats.career.refresh();
  };
  window.__DF_STATS_SHIM__ = { mode: 'shim', openCareer, closeCareer: () => { if (host) host.hidden = true; } };
})();
"""


def read_portal_attrs():
    src = open(GAMEPLAYER, encoding="utf-8").read()
    m = re.search(r"<iframe[\s\S]*?/>", src)
    block = m.group(0) if m else src
    sb = re.search(r'\bsandbox="([^"]*)"', block)
    al = re.search(r'\ballow="([^"]*)"', block)
    return (sb.group(1) if sb else None), (al.group(1) if al else None)


def integrated_build():
    try:
        return "createStats(" in open(MAIN_TS, encoding="utf-8").read()
    except Exception:
        return False


# ───────────────────────────── runner ─────────────────────────────
class Run:
    def __init__(self, args):
        self.args = args
        self.port = args.port
        self.base = "http://127.0.0.1:%d/" % self.port
        self.integrated = integrated_build()
        self.sandbox, self.allow = read_portal_attrs()
        self.report = {"gate": "G-S2 statscheck", "mode": "integrated" if self.integrated else "shim (INTEGRATION not landed)",
                       "base": self.base, "sandbox": self.sandbox, "allow": self.allow, "scenarios": {}, "skipped": []}
        self.fails = []
        self.cur = None
        self.server = None
        self.pw = None
        self.browser = None

    # ── bookkeeping ──
    def scenario(self, key, title, fresh=True):
        if fresh and self.pw:
            self.launch()
        self.cur = {"title": title, "checks": [], "info": {}, "errors": []}
        self.report["scenarios"][key] = self.cur
        print("\n== %s %s ==" % (key, title))

    def ok(self, cond, name, detail=""):
        cond = bool(cond)
        self.cur["checks"].append({"name": name, "pass": cond, "detail": detail})
        print("%s  %s%s" % ("PASS" if cond else "FAIL", name, ("  -  " + str(detail)) if detail != "" else ""))
        if not cond:
            self.fails.append("%s: %s (%s)" % (self.cur["title"], name, detail))
        return cond

    def info(self, k, v):
        self.cur["info"][k] = v
        print("INFO  %s: %s" % (k, json.dumps(v, default=str)[:600]))

    # ── server / browser ──
    def start(self):
        if C.url_reachable(self.base):
            print("dev server already answering at %s - reusing it" % self.base)
        else:
            os.makedirs(C.REPORTS, exist_ok=True)
            log_path = os.path.join(C.REPORTS, "devserver_%d.log" % self.port)
            logf = open(log_path, "w", encoding="utf-8", errors="replace")
            env = dict(os.environ, DF_FROZEN="1", PYTHONIOENCODING="utf-8", FORCE_COLOR="0")
            kw = {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)} if os.name == "nt" else {"start_new_session": True}
            cmd = "npx vite --port %d --strictPort --host 127.0.0.1" % self.port
            print("starting `%s` (DF_FROZEN=1, log %s)" % (cmd, log_path))
            proc = subprocess.Popen(cmd, cwd=C.ROOT, shell=True, stdout=logf, stderr=subprocess.STDOUT, env=env, **kw)
            self.server = {"proc": proc, "log": logf, "path": log_path}
            t0 = time.time()
            while time.time() - t0 < 120:
                if proc.poll() is not None:
                    raise C.HarnessError("dev server exited (%s), see %s" % (proc.returncode, log_path))
                if C.url_reachable(self.base):
                    break
                time.sleep(0.5)
            else:
                raise C.HarnessError("dev server did not answer at %s within 120 s" % self.base)
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.launch()

    def launch(self):
        """A fresh Chrome per scenario: a full run used to fail its last scenarios with 'the match never went live' after
        ~12 min of WebGL pages in one browser process, while the same scenarios pass alone (2026-10-02)."""
        if self.browser:
            try:
                self.browser.close()
            except Exception:
                pass
            self.browser = None
        # Chrome's Local Network Access checks block a page Playwright fulfils (a "public" origin to Chrome: no real
        # server address) from framing the loopback dev server (net::ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS, measured
        # 2026-10-02). A test-rig artifact only — the real portal (public) frames the public CDN — so the rig turns the
        # check off; Chrome keeps one --disable-features switch, so it joins the existing list.
        flags = [f + ",LocalNetworkAccessChecks" if f.startswith("--disable-features=") else f for f in C.FLAGS]
        self.report["chromeFlags"] = flags
        self.browser = self.pw.chromium.launch(channel="chrome", headless=bool(self.args.headless), args=flags)
        self.report["chrome"] = self.browser.version

    def stop(self):
        for obj, meth in ((self.browser, "close"), (self.pw, "stop")):
            try:
                if obj:
                    getattr(obj, meth)()
            except Exception:
                pass
        C.stop_server(self.server)

    def context(self, w=1280, h=720, init=(), touch=False):
        ctx = self.browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, has_touch=touch)
        ctx.add_init_script(C.INIT_JS)
        for s in init:
            ctx.add_init_script(s)
        if not self.integrated:
            pat = re.compile(r"^http://127\.0\.0\.1:%d/src/main\.ts(\?.*)?$" % self.port)

            def shim(route):
                resp = route.fetch()
                route.fulfill(response=resp, body=resp.text() + SHIM_JS)
            ctx.route(pat, shim)
        errs = []
        ctx.on("page", lambda p: None)
        return ctx, errs

    def page(self, ctx, errs):
        p = ctx.new_page()
        p.set_default_timeout(30_000)

        def on_console(m):
            try:
                if m.type == "error" and "favicon" not in m.text:
                    errs.append("console: " + m.text[:300])
                elif m.type == "warning" and "[dyefield stats]" in m.text:
                    errs.append("stats warning: " + m.text[:300])
            except Exception:
                pass
        p.on("console", on_console)
        p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:300]))
        return p

    def game_url(self, **extra):
        q = dict(MATCH_Q)
        for k, v in extra.items():
            if v is None:
                q.pop(k, None)
            else:
                q[k] = v
        return self.base + "?" + urllib.parse.urlencode(q)

    def portal(self, ctx, errs, origin, cfg, src):
        parent = origin + "/__df_portal"
        body = STANDIN % {"cfg": json.dumps(cfg), "src": html.escape(src), "sandbox": html.escape(self.sandbox or ""), "allow": html.escape(self.allow or "")}
        ctx.route(lambda u: u.startswith(parent), lambda r: r.fulfill(status=200, body=body, content_type="text/html"))
        p = self.page(ctx, errs)
        p.goto(parent, wait_until="load", timeout=60_000)
        gf = None
        for _ in range(200):
            gf = next((f for f in p.frames if f.url.startswith(self.base)), None)
            if gf:
                break
            time.sleep(0.1)
        if not gf:
            raise C.HarnessError("the game frame never appeared under %s" % parent)
        return p, gf


# ───────────────────────────── page helpers ─────────────────────────────
def fjs(f, expr, arg=None, default=None):
    try:
        return f.evaluate(expr) if arg is None else f.evaluate(expr, arg)
    except Exception:
        return default


def stats(f):
    return fjs(f, "() => window.__DF_STATS__ ? window.__DF_STATS__.state() : null") or {}


def msgs(p):
    return fjs(p, "() => window.__MSGS__ || []", default=[]) or []


def portal_state(p):
    return fjs(p, "() => window.__PORTAL__ || null") or {}


def wait_for(fn, timeout, poll=0.3):
    t0 = time.time()
    v = None
    while time.time() - t0 < timeout:
        v = fn()
        if v:
            return v
        time.sleep(poll)
    return v


def phase(f):
    return fjs(f, "() => window.__DF__ ? window.__DF__.state().phase : null")


def match(f):
    return fjs(f, "() => { const m = window.__DF__ && window.__DF__.match(); return m ? { phase: m.phase, timeLeft: m.timeLeft, team: m.runners[0].team, tank: m.runners[0].tank, alive: m.runners[0].alive,"
                  " pos: m.runners.map((r) => [r.x, r.y, r.z]), result: m.result, victory: m.victoryShown } : null; }")


def frame_errors(f):
    return fjs(f, "() => window.__H_ERR__ || []", default=[]) or []


def play_match(run, p, f, force_win=True, quit_after_s=None, settle=True):
    """Drive one match in game frame `f` of page `p` with real input. Returns {record, endWall, quit}."""
    vw, vh = p.viewport_size["width"], p.viewport_size["height"]
    if not wait_for(lambda: phase(f) == "play", 420):
        raise C.HarnessError("the match never reached phase 'play' (phase %r; error %s)" % (phase(f), (fjs(f, "() => window.__DF__ && window.__DF__.state().error") or "")[:300]))
    # progress-based, not a wall clock: other sessions load this box to ~90 % CPU and the game can render at 4 fps (measured
    # 2026-10-02: 110 frames / tick 139 after 60 s). Wait while the sim tick advances; fail only on a stall or after 600 s.
    diag = "() => { const s = window.__DF__ && window.__DF__.state(); return s && { phase: s.phase, error: s.error, match: s.match, fps: s.fps, tick: s.tick, frames: window.__H_FRAMES__ }; }"
    t0, last_tick, last_move = time.time(), -1, time.time()
    while (match(f) or {}).get("phase") != "live":
        st = fjs(f, diag) or {}
        tk = st.get("tick") if isinstance(st, dict) else None
        if isinstance(tk, int) and tk != last_tick:
            last_tick, last_move = tk, time.time()
        if time.time() - last_move > 45 or time.time() - t0 > 600 or (isinstance(st, dict) and st.get("phase") == "error"):
            raise C.HarnessError("the match never went live (stalled or > 600 s): %s" % json.dumps(st)[:400])
        time.sleep(0.5)
    run.cur.setdefault("info", {})["liveAfterS"] = round(time.time() - t0, 1)
    rec0 = (stats(f).get("lastRecord") or {}).get("id")
    t_live = time.time()
    kb, ms = p.keyboard, p.mouse
    ms.move(vw / 2, vh / 2)
    ms.click(vw / 2, vh / 2)                                     # a real click: focuses the frame (may take pointer lock)
    time.sleep(0.25)
    locked = bool(wait_for(lambda: fjs(f, "() => !!document.pointerLockElement"), 1.5, 0.1))
    mx, my, sweep, flip = vw / 2, vh / 2, 1, time.time()
    if locked:
        my += 80                                                  # look ~10 degrees further down: the stream lands on the floor ahead
        ms.move(mx, my)
    kb.down("KeyW")
    ms.down()
    held = True
    side, last = "KeyA", time.time()
    refill, t_ref = False, 0.0                                    # the tank only refills in SLICK on own dye (no passive regen)
    splats = 0
    quit_done = False
    while True:
        m = match(f)
        if not m or m.get("phase") == "ended":
            break
        if quit_after_s is not None and time.time() - t_live > quit_after_s:
            if held:
                if refill:
                    kb.up("ShiftLeft"); refill = False
                else:
                    ms.up()
                kb.up("KeyW"); held = False
            kb.press("KeyP")
            time.sleep(0.6)
            f.click("#df-p-quit", timeout=10_000)
            time.sleep(0.3)
            f.click("#dfm-quit-yes", timeout=10_000)
            quit_done = True
            break
        tl = m.get("timeLeft") or 0
        tank = m.get("tank")
        if held and tank is not None:
            if not refill and tank < 12:
                ms.up(); kb.down("ShiftLeft"); refill, t_ref = True, time.time()
            elif refill and (tank > 85 or time.time() - t_ref > 3.5):
                kb.up("ShiftLeft"); ms.down(); refill = False
        if tl <= 1.4 and held:
            if refill:
                kb.up("ShiftLeft"); refill = False
            else:
                ms.up()
            kb.up("KeyW"); held = False                          # the victory slate owns the keys after the horn
        if held and locked:
            # under pointer lock a Playwright mouse.move reports movementX = the delta (common.mouse_turn): sweep the aim so
            # the walk curves over fresh floor instead of pinning the runner against one wall
            mx += 55 * sweep
            ms.move(mx, my)
            if time.time() - flip > 2.8:
                sweep, flip = -sweep, time.time()
        if tl <= 1.4 or refill:
            pass
        elif held and time.time() - last > 1.6:
            kb.down(side); time.sleep(0.35); kb.up(side)
            side = "KeyD" if side == "KeyA" else "KeyA"
            if side == "KeyA":
                kb.press("Space")
            last = time.time()
        if force_win and tl < 6 and splats < 3 and m.get("pos"):
            fjs(f, "([pos, team]) => { let n = 0; for (const p of pos) for (const dy of [0, -0.4]) n += window.__DF__.splat(p[0], p[1] + dy, p[2], 9, team); return n; }",
                [m["pos"], m.get("team") or 1])
            splats += 1
        time.sleep(0.25)
    if held:
        if refill:
            kb.up("ShiftLeft")
        else:
            ms.up()
        kb.up("KeyW")
    end_wall = time.time()
    run.cur.setdefault("info", {}).setdefault("matchWallS", []).append(round(end_wall - t_live, 1))
    rec = None
    if not quit_done and settle:
        st = wait_for(lambda: (lambda s: s if (s.get("lastRecord") or {}).get("id") not in (None, rec0) else None)(stats(f)), 20)
        rec = (st or {}).get("lastRecord")
    return {"record": rec, "endWall": end_wall, "quit": quit_done, "locked": locked}


def rects_hit(a, b):
    return a and b and a["l"] < b["r"] - 1 and b["l"] < a["r"] - 1 and a["t"] < b["b"] - 1 and b["t"] < a["b"] - 1


TOAST_VS_SLATE_JS = """() => {
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const t = document.getElementById('df-ach-toast');
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'); };
  const btns = [...document.querySelectorAll('.df-victory .df-btn')].filter(vis).map((b) => ({ text: b.textContent.trim(), ...R(b) }));
  const cs = t ? getComputedStyle(t) : null;
  return { toast: t && vis(t) ? R(t) : null, text: t ? t.textContent : '', anim: cs ? cs.animationName : '', cls: t ? t.className : '', btns,
    vw: innerWidth, vh: innerHeight, slate: !!document.querySelector('.df-victory') && vis(document.querySelector('.df-victory')) };
}"""

PANEL_LAYOUT_JS = """() => {
  const P = document.querySelector('#dfc-career');
  if (!P) return { missing: true };
  const R = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]'); };
  const pr = R(P);
  const scr = P.closest('.dfm-screen');
  const head = scr ? scr.querySelector('.dfm-head') : null;
  const kids = [...P.querySelectorAll('.dfc-grid > *')].filter(vis).map((e) => ({ cls: e.className, ...R(e) }));
  const bad = [];
  for (const k of kids) if (k.l < pr.l - 1 || k.r > pr.r + 1) bad.push('outside the panel: ' + k.cls);
  for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
    const a = kids[i], b = kids[j];
    if (a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1) bad.push('overlap: ' + a.cls + ' / ' + b.cls);
  }
  const clipped = [...P.querySelectorAll('.dfc-tile b, .dfc-mode b, .dfc-rows dd, .dfc-list b, .dfc-online, .dfc-ach .xp')].filter(vis)
    .filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
  const hr = head ? R(head) : null;
  return { panel: pr, head: hr, kids: kids.length, bad, clipped, vw: innerWidth, vh: innerHeight,
    hscroll: P.scrollWidth > P.clientWidth + 1, scrollable: P.scrollHeight > P.clientHeight + 1,
    tiles: [...P.querySelectorAll('.dfc-tile b')].map((e) => e.textContent), acct: (P.querySelector('#dfc-acct') || {}).textContent || '',
    achSum: (P.querySelector('.dfc-achsum') || {}).textContent || '', achItems: P.querySelectorAll('li.dfc-ach').length,
    achCards: P.querySelectorAll('section.dfc-ach').length,
    secs: [...P.querySelectorAll('.dfc-sec[data-nav]')].length };
}"""


def open_career(run, p, f, from_slate=False):
    """Open the CAREER screen: the menus entry (integrated) or the shim's stand-in screen. Returns how."""
    if run.integrated:
        if from_slate:
            f.locator(".df-victory .df-btn", has_text="LOBBY").first.click(timeout=15_000)
            wait_for(lambda: phase(f) == "menu", 60)
        f.click("#dfm-career", timeout=30_000)
        wait_for(lambda: fjs(f, "() => !!document.querySelector('.dfm-s-career:not([hidden]) #dfc-career')"), 10)
        return "menus #dfm-career"
    fjs(f, "() => window.__DF_STATS_SHIM__ && window.__DF_STATS_SHIM__.openCareer()")
    time.sleep(0.3)
    return "shim stand-in screen"


def panel_tiles(f):
    return fjs(f, "() => [...document.querySelectorAll('#dfc-career .dfc-tile b')].map((e) => e.textContent)", default=[]) or []


def stable(v):
    return json.dumps(v, sort_keys=True, separators=(",", ":"))


def stats_errors_ok(run, f, errs, label):
    st = stats(f)
    serr = st.get("errors") or []
    run.ok(not serr, "%s: no errors inside the stats layer" % label, serr[:3])
    run.cur["errors"] = list(errs)[:20] + ["frame: " + e for e in frame_errors(f)[:10]]


# ───────────────────────────── scenarios ─────────────────────────────
def s_a(run):
    run.scenario("S-a", "standalone (the game URL opened directly)")
    ctx, errs = run.context()
    try:
        p = run.page(ctx, errs)
        p.goto(run.game_url(seed=11), wait_until="load", timeout=90_000)
        r = play_match(run, p, p.main_frame)
        st = stats(p.main_frame)
        run.info("record", r["record"])
        run.ok(st.get("portal") == "standalone", "state standalone", st.get("portal"))
        run.ok(st.get("bucket") == "guest" and ((st.get("display") or {}).get("counters") or {}).get("matches") == 1,
               "the finished match landed in the guest slot", {"bucket": st.get("bucket"), "matches": ((st.get("display") or {}).get("counters") or {}).get("matches")})
        run.ok(r["record"] and r["record"].get("eligible") and r["record"].get("dev") is True, "the record is eligible (real participation) and marked dev",
               {k: (r["record"] or {}).get(k) for k in ("eligible", "paintedM2", "washes", "result", "liveS", "score")})
        run.ok(st.get("sent") == [] and st.get("outbox") == 0, "nothing posted, nothing queued", {"sent": st.get("sent"), "outbox": st.get("outbox")})
        time.sleep(1.0)
        fe = frame_errors(p.main_frame)
        run.ok(not errs and not fe, "zero console errors / page errors / window errors (standalone)", (errs + fe)[:8])
        stats_errors_ok(run, p.main_frame, errs, "S-a")
    finally:
        ctx.close()


def s_b(run):
    run.scenario("S-b", "signed-in, empty account (+ S-i burst unlocks, the toast vs the victory slate)")
    ctx, errs = run.context()
    try:
        p, f = run.portal(ctx, errs, "http://localhost:%d" % run.port, {"signedIn": True, "record": None}, run.game_url(seed=21))
        st = wait_for(lambda: (lambda s: s if s.get("readOk") else None)(stats(f)), 60)
        run.ok(st and st.get("readOk") and st.get("portal") == "signed-in" and (st.get("link") or {}).get("replies", 0) >= 2,
               "two null replies -> readOk", {k: (st or {}).get(k) for k in ("portal", "readOk", "link")})
        r = play_match(run, p, f)
        rec = r["record"] or {}
        run.info("record", rec)
        # the toast vs the victory slate's buttons at 1280x720, then 852x393 (while the queued toasts still show)
        wait_for(lambda: (match(f) or {}).get("victory"), 10)
        time.sleep(0.6)
        lay1 = fjs(f, TOAST_VS_SLATE_JS) or {}
        p.screenshot(path=os.path.join(C.SHOTS, "stats_toast_slate_1280x720.png"))
        p.set_viewport_size({"width": 852, "height": 393})
        time.sleep(1.0)
        lay2 = fjs(f, TOAST_VS_SLATE_JS) or {}
        p.screenshot(path=os.path.join(C.SHOTS, "stats_toast_slate_852x393.png"))
        p.set_viewport_size({"width": 1280, "height": 720})
        for lay, label in ((lay1, "1280x720"), (lay2, "852x393")):
            hit = [b["text"] for b in lay.get("btns", []) if rects_hit(lay.get("toast"), b)]
            run.ok(lay.get("toast") and lay.get("btns") and not hit and lay["toast"]["h"] <= 64.5,
                   "toast never covers a victory-slate button (%s)" % label,
                   {"toast": lay.get("toast"), "buttons": [(b["text"], round(b["t"]), round(b["b"])) for b in lay.get("btns", [])], "hit": hit, "text": lay.get("text", "")[:80]})
        # S-i: the paced posts
        n_unlock = len(((stats(f).get("display") or {}).get("ach") or {}))
        wait_for(lambda: len([m for m in msgs(p) if m["type"] == "forgeflow:achievement"]) >= n_unlock, n_unlock * 3 + 12)
        time.sleep(2.0)
        M = msgs(p)
        after = [m for m in M if m["type"] != "forgeflow:load"]
        ach = [m for m in after if m["type"] == "forgeflow:achievement"]
        scores = [m for m in after if m["type"] == "forgeflow:score"]
        saves = [m for m in after if m["type"] == "forgeflow:save"]
        disp = stats(f).get("display") or {}
        slugs = [m["slug"] for m in ach]
        run.info("posts", [(m["type"].split(":")[1], m.get("slug") or m.get("score") or "", m["t"] - (after[0]["t"] if after else 0)) for m in after])
        run.ok(after and after[0]["type"] == "forgeflow:achievement" and after[0]["slug"] == "first_match",
               "the first post after the match is forgeflow:achievement first_match", after[0] if after else None)
        run.ok(len(scores) == 1 and isinstance(scores[0]["score"], int) and scores[0]["score"] == rec.get("score") and rec.get("score", 0) > 0,
               "one integer score equal to lastRecord.score", {"scores": [s["score"] for s in scores], "record": rec.get("score")})
        run.ok(scores and saves and saves[0]["t"] >= scores[0]["t"] and ach and scores[0]["t"] >= ach[0]["t"],
               "order: first achievement, then the score, then the save", [(m["type"], m["t"]) for m in after[:6]])
        run.ok(set(slugs) == set(disp.get("ach") or {}) and len(slugs) == len(set(slugs)),
               "every unlocked slug posted exactly once", {"posted": slugs, "unlocked": sorted((disp.get("ach") or {}).keys())})
        rec_cloud = portal_state(p).get("record") or {}
        slots = list((rec_cloud.get("slots") or {}).keys())
        tags = list((rec_cloud.get("tags") or {}).keys())
        run.ok(len(slots) == 1 and len(tags) == 1 and rec_cloud.get("v") == 1 and rec_cloud.get("game") == "dyefield"
               and ((rec_cloud["slots"][slots[0]] or {}).get("c") or {}).get("matches") == 1,
               "the thin save merges into {v, game, tags, one slot} holding the match", {"slots": slots, "tags": tags})
        # S-i
        run.scenario("S-i", "burst unlocks (S-b's first match)", fresh=False)
        gaps = [b["t"] - a["t"] for a, b in zip(ach, ach[1:])]
        run.ok(len(ach) >= 4, ">= 4 achievements unlocked by one match", slugs)
        run.ok(all(g >= 2900 for g in gaps), "achievement posts >= 2.9 s apart (wall clock)", gaps)
        run.ok(len(slugs) == len(set(slugs)), "no slug twice", slugs)
        span = (ach[-1]["t"] - ach[0]["t"]) / 1000.0 if ach else 0
        run.ok(span <= len(ach) * 3 + 5, "all delivered within N x 3 s + 5 s", "%.1f s for %d posts" % (span, len(ach)))
        run.ok(scores and saves and (scores[0]["t"] - ach[0]["t"]) <= 1500 and (len(ach) < 3 or saves[0]["t"] < ach[-1]["t"]),
               "score and save are not delayed by the queue", {"score_after_first_ach_ms": scores[0]["t"] - ach[0]["t"] if scores and ach else None,
                                                              "save_before_last_ach": bool(saves and ach and saves[0]["t"] < ach[-1]["t"])})
        # S-b part 2: a second match (PLAY AGAIN) updates the same slot, touches nothing else
        run.cur = run.report["scenarios"]["S-b"]
        n0 = len(M)
        f.locator(".df-victory .df-btn", has_text="PLAY AGAIN").first.click(timeout=15_000)
        r2 = play_match(run, p, f)
        wait_for(lambda: len([m for m in msgs(p)[n0:] if m["type"] == "forgeflow:save"]) >= 1, 15)
        time.sleep(1.0)
        rec2 = portal_state(p).get("record") or {}
        slots2 = list((rec2.get("slots") or {}).keys())
        run.ok(slots2 == slots and list((rec2.get("tags") or {}).keys()) == tags and ((rec2["slots"][slots2[0]] or {}).get("c") or {}).get("matches") == 2,
               "a second match updates the same slot (2 matches), no other key", {"slots": slots2, "matches": ((rec2.get("slots") or {}).get(slots2[0] if slots2 else "", {}) or {}).get("c", {}).get("matches")})
        run.info("record2", r2["record"])
        stats_errors_ok(run, f, errs, "S-b")
    finally:
        ctx.close()


def s_c(run):
    run.scenario("S-c", "signed-out -> sign-in")
    ctx, errs = run.context()
    try:
        p, f = run.portal(ctx, errs, "http://localhost:%d" % run.port, {"signedIn": False, "record": None}, run.game_url(seed=31))
        r = play_match(run, p, f)
        st = wait_for(lambda: (lambda s: s if s.get("portal") == "guest" else None)(stats(f)), 90)
        st = stats(f)
        M = msgs(p)
        run.ok(st.get("portal") == "guest", "state guest after the boot schedule", st.get("portal"))
        run.ok(st.get("bucket") == "guest" and ((st.get("display") or {}).get("counters") or {}).get("matches") == 1, "the match is in the guest slot",
               {"bucket": st.get("bucket"), "matches": ((st.get("display") or {}).get("counters") or {}).get("matches")})
        run.ok(not [m for m in M if m["type"] != "forgeflow:load"], "zero score / achievement / save posts while signed out",
               [m["type"] for m in M if m["type"] != "forgeflow:load"][:5])
        run.ok(st.get("outbox", 0) > 0, "the outbox holds the unlocks + the score", st.get("outboxItems"))
        guest_ach = sorted(((st.get("display") or {}).get("ach") or {}).keys())
        n0 = len(M)
        fjs(p, "() => { window.__PORTAL__.signedIn = true; }")
        how = open_career(run, p, f, from_slate=True)              # a CAREER open is a re-probe (S3.3)
        run.info("re-probe trigger", how)
        st2 = wait_for(lambda: (lambda s: s if s.get("readOk") and s.get("outbox") == 0 else None)(stats(f)), 30 + 3 * max(1, len(guest_ach)) + 10)
        st2 = stats(f)
        M2 = msgs(p)[n0:]
        ach = [m["slug"] for m in M2 if m["type"] == "forgeflow:achievement"]
        run.ok(st2.get("portal") == "signed-in" and st2.get("readOk"), "the next probe flips to signed-in (readOk)", {k: st2.get(k) for k in ("portal", "readOk")})
        run.ok(st2.get("outbox") == 0 and set(guest_ach) <= set(ach) and len(ach) == len(set(ach)), "the outbox drains (every guest unlock posted once)",
               {"posted": ach, "guest": guest_ach})
        run.ok(len([m for m in M2 if m["type"] == "forgeflow:score"]) == 1, "the queued score is posted", [m.get("score") for m in M2 if m["type"] == "forgeflow:score"])
        wait_for(lambda: [m for m in msgs(p)[n0:] if m["type"] == "forgeflow:save"], 10)
        rec = portal_state(p).get("record") or {}
        slots = rec.get("slots") or {}
        one = next(iter(slots.values()), {}) if slots else {}
        run.ok(len(slots) == 1 and (one.get("c") or {}).get("matches") == 1 and st2.get("bucket") == "account"
               and ((st2.get("display") or {}).get("counters") or {}).get("matches") == 1,
               "the guest slot is claimed into the account and pushed", {"slots": list(slots.keys()), "matches": (one.get("c") or {}).get("matches")})
        p.screenshot(path=os.path.join(C.SHOTS, "stats_career_after_claim_1280x720.png"))
        stats_errors_ok(run, f, errs, "S-c")
    finally:
        ctx.close()


def rich_record():
    t0 = int(time.time() * 1000) - 86_400_000
    wld = lambda m, w, l, d: {"m": m, "w": w, "l": l, "d": d}  # noqa: E731
    other = {
        "c": {"matches": 7, "wins": 4, "losses": 2, "draws": 1, "idle": 1, "abandoned": 2,
              "byMode": {"teams_turf": wld(4, 3, 1, 0), "teams_washout": wld(1, 0, 1, 0), "ffa_turf": wld(2, 1, 0, 1), "ffa_washout": wld(0, 0, 0, 0)},
              "byKit": {"mist-rasp": wld(3, 2, 1, 0), "sheet-drum": wld(2, 1, 0, 1), "needle-glint": wld(2, 1, 1, 0), "pop-well": wld(0, 0, 0, 0)},
              "byMap": {"pier18": wld(5, 3, 1, 1), "lockwell": wld(2, 1, 1, 0), "cinder": wld(0, 0, 0, 0)},
              "online": {"m": 0, "w": 0, "l": 0, "d": 0, "void": 0}, "storm": wld(1, 1, 0, 0), "podiums": 2, "limitWins": 0,
              "washes": 31, "washed": 40, "paintedM2": 5400, "specials": 9, "subs": 11, "splashdowns": 1, "liveS": 1250.5},
        "best": {"score": 1840, "turfPctTeams": 41.2, "turfPctFfa": 18.4, "washes": 9, "paintedM2": 1210, "streak": 4},
        "ach": {"first_match": t0, "first_win": t0 + 1000},
        "recent": [], "at": t0 + 5000,
    }
    return {"v": 1, "game": "dyefield", "tags": {"tagrich001": t0}, "slots": {"otherdev0001-tagrich001": other}}, "otherdev0001-tagrich001", other


def s_d(run):
    run.scenario("S-d", "rich cloud (+ reduce-motion toast)")
    rec0, okey, other = rich_record()
    rm = "(() => { try { if (location.port === '%d') localStorage.setItem('dyefield.settings.v1', JSON.stringify({ reduceMotion: true })); } catch (e) {} })();" % run.port
    ctx, errs = run.context(init=(rm,))
    try:
        p, f = run.portal(ctx, errs, "http://localhost:%d" % run.port, {"signedIn": True, "record": rec0}, run.game_url(seed=41))
        st = wait_for(lambda: (lambda s: s if s.get("readOk") else None)(stats(f)), 60) or {}
        c0 = ((st.get("display") or {}).get("counters") or {})
        run.ok(st.get("readOk") and c0.get("matches") == 7 and c0.get("washes") == 31, "readOk: the display folds the other device's slot", {"matches": c0.get("matches"), "washes": c0.get("washes")})
        r = play_match(run, p, f)
        run.info("record", r["record"])
        time.sleep(0.4)
        lay = fjs(f, TOAST_VS_SLATE_JS) or {}
        run.ok("rm" in (lay.get("cls") or "") and lay.get("anim") == "dfAchFade", "reduce motion: the toast fades (no transform animation)",
               {"class": lay.get("cls"), "animation": lay.get("anim")})
        wait_for(lambda: [m for m in msgs(p) if m["type"] == "forgeflow:save"], 20)
        time.sleep(1.0)
        st2 = stats(f)
        c = ((st2.get("display") or {}).get("counters") or {})
        rec = r["record"] or {}
        run.ok(c.get("matches") == 8 and c.get("washes") == 31 + rec.get("washes", -999), "CAREER totals = the other slot + this device",
               {"matches": c.get("matches"), "washes": c.get("washes"), "record washes": rec.get("washes")})
        cloud = portal_state(p).get("record") or {}
        run.ok(stable((cloud.get("slots") or {}).get(okey)) == stable(other) and "tagrich001" in (cloud.get("tags") or {}),
               "after a match the other device's slot is byte-identical", {"slots": list((cloud.get("slots") or {}).keys())})
        how = open_career(run, p, f, from_slate=True)
        tiles = panel_tiles(f)
        run.ok(tiles and tiles[0] == "8", "the CAREER panel shows the summed MATCHES", {"tiles": tiles, "via": how})
        p.screenshot(path=os.path.join(C.SHOTS, "stats_career_rich_1280x720.png"))
        stats_errors_ok(run, f, errs, "S-d")
    finally:
        ctx.close()


def s_e(run):
    run.scenario("S-e", "corrupt / future cloud record")
    ctx, errs = run.context()
    try:
        p, f = run.portal(ctx, errs, "http://localhost:%d" % run.port, {"signedIn": True, "record": {"v": 2, "slots": "x"}}, run.game_url(seed=51))
        play_match(run, p, f)
        time.sleep(6.0)
        st = stats(f)
        M = msgs(p)
        run.ok(not [m for m in M if m["type"] == "forgeflow:save"], "no forgeflow:save all session", [m["type"] for m in M if m["type"] != "forgeflow:load"])
        run.ok(st.get("portal") == "signed-in" and not st.get("readOk") and st.get("unreadable"), "signed in, readOk false (unreadable record)",
               {k: st.get(k) for k in ("portal", "readOk", "unreadable", "bucket")})
        how = open_career(run, p, f, from_slate=True)
        tiles = panel_tiles(f)
        run.ok(tiles and tiles[0] == "1" and ((st.get("display") or {}).get("counters") or {}).get("matches") == 1, "CAREER shows the local career",
               {"tiles": tiles, "via": how})
        cloud = portal_state(p).get("record")
        run.ok(cloud == {"v": 2, "slots": "x"}, "the portal record is untouched", cloud)
        stats_errors_ok(run, f, errs, "S-e")
    finally:
        ctx.close()


def s_f(run):
    run.scenario("S-f", "quit mid-match")
    ctx, errs = run.context()
    try:
        p, f = run.portal(ctx, errs, "http://localhost:%d" % run.port, {"signedIn": True, "record": None}, run.game_url(seed=61))
        wait_for(lambda: stats(f).get("readOk"), 60)
        r = play_match(run, p, f, force_win=False, quit_after_s=8)
        wait_for(lambda: phase(f) == "menu", 60)
        time.sleep(3.0)
        st = stats(f)
        M = msgs(p)
        posted = [m["type"] for m in M if m["type"] != "forgeflow:load"]
        run.ok(r["quit"], "QUIT MATCH via the pause card (KeyP -> #df-p-quit -> #dfm-quit-yes)", r["quit"])
        run.ok(not posted, "no score / achievement / save posts", posted)
        c = ((st.get("display") or {}).get("counters") or {})
        run.ok(c.get("abandoned") == 1 and c.get("matches") == 0, "abandoned +1, no match counted", {"abandoned": c.get("abandoned"), "matches": c.get("matches")})
        stats_errors_ok(run, f, errs, "S-f")
    finally:
        ctx.close()


def s_g(run):
    run.scenario("S-g", "slow portal (every reply 9 s late)")
    ctx, errs = run.context()
    try:
        p, f = run.portal(ctx, errs, "http://localhost:%d" % run.port, {"signedIn": True, "record": None, "replyDelayMs": 9000},
                          run.game_url(seed=71, autostart=None))
        st = wait_for(lambda: (lambda s: s if s.get("readOk") else None)(stats(f)), 75) or stats(f)
        M = msgs(p)
        reps = fjs(p, "() => window.__REPLIES__ || []", default=[]) or []
        loads = [m for m in M if m["type"] == "forgeflow:load"]
        first_reply = reps[0]["t"] if reps else None
        loads_before = len([m for m in loads if first_reply and m["t"] < first_reply])
        pushes_before = [m["type"] for m in M if m["type"] != "forgeflow:load" and first_reply and m["t"] < first_reply]
        run.ok(loads_before >= 2, "the client retried while no reply came (probes before the first reply)", loads_before)
        run.ok(st.get("readOk") and st.get("portal") == "signed-in", "then synced (readOk)", {k: st.get(k) for k in ("portal", "readOk", "link")})
        run.ok(not pushes_before, "no push before the reply", pushes_before)
        stats_errors_ok(run, f, errs, "S-g")
    finally:
        ctx.close()


def s_h(run):
    run.scenario("S-h", "foreign origin (parent on http://evil.localhost)")
    ctx, errs = run.context()
    try:
        p, f = run.portal(ctx, errs, "http://evil.localhost:%d" % run.port, {"signedIn": True, "record": None}, run.game_url(seed=81, autostart=None))
        st = wait_for(lambda: (lambda s: s if s.get("portal") == "guest" else None)(stats(f)), 90) or stats(f)
        reps = fjs(p, "() => window.__REPLIES__ || []", default=[]) or []
        run.ok(len(reps) >= 1, "the stand-in did reply", len(reps))
        run.ok(st.get("portal") == "guest" and not st.get("readOk") and (st.get("link") or {}).get("ignored", 0) >= 1,
               "replies from a foreign origin are ignored -> guest", {k: st.get(k) for k in ("portal", "readOk", "link")})
        stats_errors_ok(run, f, errs, "S-h")
    finally:
        ctx.close()


def s_j(run):
    run.scenario("S-j", "blocked storage, two page loads")
    ctx, errs = run.context(init=(BLOCK_STORAGE_JS,))
    try:
        p, f = run.portal(ctx, errs, "http://localhost:%d" % run.port, {"signedIn": True, "record": None}, run.game_url(seed=91))
        wait_for(lambda: stats(f).get("readOk"), 60)
        st = stats(f)
        run.ok(st.get("storage") == "memory", "storage-less session detected", st.get("storage"))
        play_match(run, p, f)
        wait_for(lambda: [m for m in msgs(p) if m["type"] == "forgeflow:save"], 20)
        time.sleep(1.0)
        rec1 = portal_state(p).get("record") or {}
        n0 = len(msgs(p))
        fjs(p, "() => { const g = document.getElementById('game'); g.src = g.src.replace(/&reload=\\d+/, '') + '&reload=' + Date.now(); }")
        time.sleep(2.0)
        f = next((fr for fr in p.frames if fr.url.startswith(run.base)), f)
        wait_for(lambda: stats(f).get("readOk"), 90)
        play_match(run, p, f)
        wait_for(lambda: [m for m in msgs(p)[n0:] if m["type"] == "forgeflow:save"], 20)
        time.sleep(1.0)
        rec = portal_state(p).get("record") or {}
        slots = list((rec.get("slots") or {}).keys())
        one = (rec.get("slots") or {}).get(slots[0], {}) if slots else {}
        run.ok(len(slots) == 1 and slots[0].startswith("nostore-") and (one.get("c") or {}).get("matches") == 2,
               "exactly one slot, nostore-<tag>, holding both matches", {"slots": slots, "matches": (one.get("c") or {}).get("matches"),
                                                                         "after load 1": list((rec1.get("slots") or {}).keys())})
        stats_errors_ok(run, f, errs, "S-j")
    finally:
        ctx.close()


def s_k(run):
    run.scenario("S-k", "statsdev under a production origin (https://forgeflowgames.com, intercepted)")
    ctx, errs = run.context()
    try:
        p, f = run.portal(ctx, errs, "https://forgeflowgames.com", {"signedIn": True, "record": None}, run.game_url(seed=101))
        play_match(run, p, f)
        time.sleep(8.0)
        st = stats(f)
        M = msgs(p)
        posted = [m["type"] for m in M if m["type"] != "forgeflow:load"]
        run.ok(st.get("portal") == "signed-in" and not st.get("localOrigin"), "state signed-in (reply from a non-local origin)", {k: st.get(k) for k in ("portal", "readOk", "localOrigin")})
        run.ok(not posted and not st.get("sent"), "statsdev: no score / achievement / save post all session", posted)
        stats_errors_ok(run, f, errs, "S-k")
    finally:
        ctx.close()
    ctx, errs = run.context()
    try:
        url = run.base + "?" + urllib.parse.urlencode({"lobby": 1})
        p, f = run.portal(ctx, errs, "https://forgeflowgames.com", {"signedIn": True, "record": None}, url)
        st = wait_for(lambda: (lambda s: s if s.get("portal") == "signed-in" else None)(stats(f)), 60) or stats(f)
        run.ok(st.get("portal") == "signed-in" and st.get("enabled") and not st.get("statsDev"), "without statsdev the same origin's reply is accepted",
               {k: st.get(k) for k in ("portal", "enabled", "statsDev", "readOk")})
    finally:
        ctx.close()


def career_seed_js(port):
    now = int(time.time() * 1000)
    wld = lambda m, w, l, d: {"m": m, "w": w, "l": l, "d": d}  # noqa: E731

    def rec(i, mode, rule, mp, kit, res, turf, washes, score):
        return {"id": "seed%04d" % i, "at": now - i * 600_000, "v": 1, "mode": mode, "rule": rule, "map": mp, "kit": kit, "skill": "swell",
                "online": False, "humans": 1, "result": res, "place": 1 if res != "loss" else 2, "crews": 2 if mode == "teams" else 8,
                "turfPct": turf, "crewScore": 0, "washes": washes, "washed": 4, "paintedM2": 900, "specials": 2, "subs": 1, "splashdowns": 0,
                "bestStreak": 2, "liveS": 180, "endedBy": "horn", "score": score, "scoreV": 1, "eligible": True}
    recent = [rec(1, "teams", "turf", "pier18", "mist-rasp", "win", 46.3, 5, 1412), rec(2, "ffa", "washout", "cinder", "needle-glint", "loss", 12.8, 11, 1188),
              rec(3, "teams", "washout", "lockwell", "sheet-drum", "draw", 33.1, 9, 1020), rec(4, "ffa", "turf", "lockwell", "pop-well", "win", 21.7, 3, 1650),
              rec(5, "teams", "turf", "cinder", "mist-rasp", "loss", 29.4, 2, 744)]
    guest = {"c": {"matches": 31, "wins": 12, "losses": 16, "draws": 3, "idle": 2, "abandoned": 1,
                   "byMode": {"teams_turf": wld(14, 7, 6, 1), "teams_washout": wld(7, 2, 4, 1), "ffa_turf": wld(6, 2, 3, 1), "ffa_washout": wld(4, 1, 3, 0)},
                   "byKit": {"mist-rasp": wld(12, 6, 5, 1), "sheet-drum": wld(8, 3, 4, 1), "needle-glint": wld(6, 2, 4, 0), "pop-well": wld(5, 1, 3, 1)},
                   "byMap": {"pier18": wld(15, 7, 7, 1), "lockwell": wld(9, 3, 5, 1), "cinder": wld(7, 2, 4, 1)},
                   "online": {"m": 3, "w": 1, "l": 2, "d": 0, "void": 1}, "storm": wld(2, 1, 1, 0), "podiums": 5, "limitWins": 2,
                   "washes": 214, "washed": 251, "paintedM2": 27350, "specials": 77, "subs": 96, "splashdowns": 4, "liveS": 5520.4},
             "best": {"score": 2214, "turfPctTeams": 52.3, "turfPctFfa": 24.9, "washes": 14, "paintedM2": 1712, "streak": 6},
             "ach": {s: now - 9e6 for s in ("first_match", "first_win", "teams_turf_win", "ffa_podium", "kit_mist_rasp", "map_pier18", "paint_1500", "streak_5", "online_first")},
             "recent": recent, "at": now}
    store = {"v": 1, "dev": "uiseeddevice", "guest": guest, "accts": {}, "pending": [], "pendingX": {"abandoned": 0, "void": 0}, "outbox": [], "lastTag": None}
    return "(() => { try { if (location.port === '%d') localStorage.setItem('dyefield.career.dev.v1', %s); } catch (e) {} })();" % (port, json.dumps(json.dumps(store)))


def s_ui(run):
    run.scenario("UI", "the CAREER panel (+ the menus entry when integrated)")
    for (w, h, touch, tag) in ((1280, 720, False, "1280x720"), (852, 393, True, "852x393")):
        ctx, errs = run.context(w=w, h=h, init=(career_seed_js(run.port),), touch=touch)
        try:
            p = run.page(ctx, errs)
            q = {"statsdev": 1, "dev": 1}
            if touch:
                q["touch"] = 1
            p.goto(run.base + "?" + urllib.parse.urlencode(q), wait_until="load", timeout=90_000)
            f = p.main_frame
            wait_for(lambda: phase(f) == "menu", 150)
            time.sleep(1.0)
            entry = fjs(f, "() => { const e = document.querySelector('#dfm-career'); if (!e) return null; const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, t: r.top, text: e.textContent }; }")
            if run.integrated and entry:
                f.click("#dfm-career")
            else:
                if run.integrated:
                    run.ok(False, "#dfm-career present in the integrated build (%s)" % tag, entry)
                open_career(run, p, f)
            time.sleep(0.8)
            lay = fjs(f, PANEL_LAYOUT_JS) or {}
            shot = os.path.join(C.SHOTS, "stats_career_%s.png" % tag)
            p.screenshot(path=shot)
            run.info("panel %s" % tag, {k: lay.get(k) for k in ("panel", "head", "kids", "tiles", "acct", "achSum", "achItems", "secs", "scrollable")})
            pr, hr = lay.get("panel") or {}, lay.get("head")
            inside = pr and pr.get("l", -1) >= 0 and pr.get("r", 1e9) <= lay.get("vw", 0) + 0.5 and pr.get("t", -1) >= 0 and pr.get("b", 1e9) <= lay.get("vh", 0) + 0.5
            run.ok(not lay.get("missing") and inside and not lay.get("bad") and not lay.get("clipped") and not lay.get("hscroll")
                   and (hr is None or pr.get("t", 0) >= hr.get("b", 0) - 1),
                   "panel layout at %s: inside the window, under the header, no overlap, no clipped numbers, no sideways scroll" % tag,
                   {"bad": lay.get("bad"), "clipped": lay.get("clipped"), "hscroll": lay.get("hscroll"), "panel": pr, "head": hr})
            run.ok(lay.get("tiles") == ["31", "12", "39 %", "2,214"] and lay.get("achItems") == 29 and lay.get("secs", 0) == 8
                   and (lay.get("achSum") or "").startswith("9 / 29"),
                   "panel content (%s): tiles, 29 achievements, focusable section heads" % tag, {"tiles": lay.get("tiles"), "achSum": lay.get("achSum"), "secs": lay.get("secs")})
            # arrows scroll the panel: focus a late section head
            sc0 = fjs(f, "() => document.querySelector('#dfc-career').scrollTop") or 0
            fjs(f, "() => { const h = [...document.querySelectorAll('#dfc-career .dfc-sec[data-nav]')]; h[h.length - 1].focus(); }")
            time.sleep(0.4)
            sc1 = fjs(f, "() => document.querySelector('#dfc-career').scrollTop") or 0
            run.ok(not lay.get("scrollable") or sc1 > sc0, "focusing a section head scrolls it into view (%s)" % tag, {"scrollTop": [sc0, sc1]})
            if run.integrated and entry and not touch:
                # BACK, ESC, keyboard Enter, pad A / B
                f.click(".dfm-s-career .dfm-back")
                time.sleep(0.5)
                scr = fjs(f, "() => window.__DF__.menu().screen")
                run.ok(scr == "title", "BACK returns to the title", scr)
                f.focus("#dfm-career")
                p.keyboard.press("Enter")
                time.sleep(0.6)
                scr = fjs(f, "() => window.__DF__.menu().screen")
                run.ok(scr == "career", "keyboard Enter on #dfm-career opens CAREER", scr)
                p.keyboard.press("Escape")
                time.sleep(0.6)
                scr = fjs(f, "() => window.__DF__.menu().screen")
                run.ok(scr == "title", "ESC returns to the title", scr)
                f.focus("#dfm-career")
                fjs(f, """() => { const pad = { id: 'harness pad', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
                    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) }; window.__PADX__ = pad;
                    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); }""")
                for btn, want in ((0, "career"), (1, "title")):
                    fjs(f, "(i) => { const b = window.__PADX__.buttons[i]; b.pressed = true; b.value = 1; }", btn)
                    time.sleep(0.35)
                    fjs(f, "(i) => { const b = window.__PADX__.buttons[i]; b.pressed = false; b.value = 0; }", btn)
                    time.sleep(0.5)
                    scr = fjs(f, "() => window.__DF__.menu().screen")
                    run.ok(scr == want, "pad %s -> %s" % ("A" if btn == 0 else "B", want), scr)
            run.cur["errors"] += errs[:10]
        finally:
            ctx.close()
    if not run.integrated:
        run.report["skipped"].append("UI menus entry (#dfm-career via mouse / Enter / pad A, BACK / ESC): needs the INTEGRATION stage (S10.3)")
        print("SKIP  menus entry checks (#dfm-career, BACK / ESC, Enter, pad A/B): INTEGRATION not landed - shim mode")


SCENARIOS = [("a", s_a), ("b", s_b), ("c", s_c), ("d", s_d), ("e", s_e), ("f", s_f), ("g", s_g), ("h", s_h), ("j", s_j), ("k", s_k), ("ui", s_ui)]


def main():
    ap = argparse.ArgumentParser(description="DYEFIELD G-S2 statscheck")
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--only", default="", help="comma list of scenarios: " + ",".join(k for k, _ in SCENARIOS))
    args = ap.parse_args()
    only = {s.strip().lower() for s in args.only.split(",") if s.strip()}
    run = Run(args)
    print("statscheck G-S2 - %s - sandbox %r allow %r" % (run.report["mode"], run.sandbox, run.allow))
    if not run.sandbox:
        print("SETUP: could not read the sandbox string from %s" % GAMEPLAYER)
        return 2
    t0 = time.time()
    setup_err = None
    try:
        run.start()
        for k, fn in SCENARIOS:
            if only and k not in only:
                continue
            try:
                fn(run)
            except Exception as e:
                if run.cur is None:
                    run.scenario(k, "setup", fresh=False)
                run.ok(False, "scenario %s ran to the end" % k, "%s: %s" % (type(e).__name__, str(e).splitlines()[0][:400] if str(e) else ""))
                run.cur["traceback"] = traceback.format_exc()[-2000:]
    except Exception as e:
        setup_err = "%s: %s" % (type(e).__name__, str(e)[:500])
        print("SETUP FAILED: " + setup_err)
    finally:
        run.stop()
    run.report["wallS"] = round(time.time() - t0, 1)
    run.report["fails"] = run.fails
    run.report["verdict"] = "SETUP FAILED" if setup_err else ("FAIL" if run.fails else "PASS")
    if setup_err:
        run.report["setupError"] = setup_err
    path = C.save_report("statscheck", run.report, base=run.base)
    n_pass = sum(1 for s in run.report["scenarios"].values() for c in s["checks"] if c["pass"])
    print("\n%s: G-S2 statscheck (%s) - %d checks passed, %d failed - %.0f s - report %s"
          % (run.report["verdict"], run.report["mode"], n_pass, len(run.fails), run.report["wallS"], path))
    for f in run.fails:
        print("  FAIL " + f)
    for s in run.report["skipped"]:
        print("  SKIPPED " + s)
    return 2 if setup_err else (1 if run.fails else 0)


if __name__ == "__main__":
    sys.exit(main())
