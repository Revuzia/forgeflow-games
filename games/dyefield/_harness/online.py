#!/usr/bin/env python
"""DYEFIELD — ONLINE end-to-end gate (INTEGRATION stage): ONE Playwright process, N headless browser contexts, the REAL dev build
(main.ts wired: PLAY ONLINE screens -> NetApi -> relay), a LOCAL relay worker (`wrangler dev --local`, port 8790) — and REAL
input: the lobby by clicks / typed keys / real touch taps, the match by real key presses, mouse movement under pointer lock,
mouse buttons and CDP multi-touch. No sim shortcuts: no ?autopilot, no __NET__.api.start(). The only dev hooks are setup
(?dev=1&net=<relay> to point a localhost page at the local relay, ?renderfps to throttle the RENDER of unobserved pages,
?statsdev=1 so a short match records) and the one failure injection the contract names (__NET__.dropSocket(), scenario D).

  python _harness/online.py --headless                       (all scenarios; vite :5224 + relay :8790 started if down)
  python _harness/online.py --headless --scenarios A,C
  python _harness/online.py --headless --soft                (software GL: a box whose GPU other sessions saturate)

Scenarios (each prints PASS / FAIL lines; the report goes to _harness/_reports/online.json, shots to _shots/online/):
  A  QUICK MATCH: two humans, TEAMS TURF, both clicking QUICK MATCH on the real screens (bots fill to 8). Both play with real
     keys + mouse. Both see each other MOVE / SHOOT / PAINT (each page's view of the other human's runner tracks that
     human's own position and paint grows), the end scores agree on both pages (result, shares, painter hash, every runner's
     paint / washes), the victory slate with the online buttons shows on both, and the stats hand-off is real: page A runs
     inside the portal stand-in (signed in) and emits exactly the contracted postMessages (score, achievements, save), page
     B's record is online with humans 2. E (rates): the WebSocket frames of both pages are measured (CDP) against the
     CONTRACT_ONLINE section O9 budget and reconciled with the relay's /health counters.
  B  8 humans, CREATE / JOIN ROOM (real clicks, typed code), FFA WASHOUT on LOCKWELL: 7 desktop contexts + 1 PHONE (iPhone-size,
     touch, CPU throttled) driven by CDP touch. Every human runner moves and paints, all 8 pages agree (hash + result), 0
     desyncs. D: one client's socket is dropped mid-match: it reconnects (<= 5 s) with the same seat and ends in agreement.
     E: per-client rates again, at 8 humans.
  C  HOST LEAVES: 3 humans in a code room, TEAMS TURF; the host's page closes mid-match: a new host within 3 s, migrations 1,
     the survivors finish with the same result and hash.
Exit: 0 all pass - 1 a check failed - 2 setup failure.
"""
from __future__ import annotations

import argparse
import base64
import json
import math
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.parse
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402
import statscheck as SC  # noqa: E402  (the portal stand-in page + the portal's sandbox / allow strings)

ROOT = C.ROOT
REPO = os.path.normpath(os.path.join(ROOT, "..", ".."))
SHOTS = os.path.join(ROOT, "_shots", "online")
DEFAULT_PORT = 5224
RELAY_PORT = 8790
RELAY_VARS = {"DEV_QUICK_DURATION_S": 75, "QM_FILL_WAIT_S": 4, "QM_SOLO_WAIT_S": 20, "REMATCH_WINDOW_S": 15}

SOFT_FLAGS = [
    "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
]
IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 "
          "Mobile/15E148 Safari/604.1")
PHONE_VIEW = (844, 390)

# binary kinds (net/proto.ts)
KIND_INTENTS, KIND_SNAP, KIND_KEYFRAME, KIND_HANDOFF = 1, 2, 3, 4
KIND_TEXT = 0x100

# ───────────────────────────── the page-side snippets ─────────────────────────────
SNAP_JS = """() => {
  const d = window.__DF__, n = window.__NET__;
  if (!d) return null;
  const s = d.state(), m = d.match();
  const se = n && n.api && n.api.session;
  const p = s.player;
  return {
    phase: s.phase, tick: s.tick, fps: s.fps, locked: !!document.pointerLockElement, err: s.error || null,
    mphase: m ? m.phase : null, tl: m ? m.timeLeft : null, cd: m ? m.countdown : null, victory: m ? m.victoryShown : null,
    pid: se ? se.localPid : null, role: se ? se.role : null, ended: se && se.ended ? se.ended.status : null, mig: se ? se.migrations : 0,
    me: p ? { x: p.x, y: p.y, z: p.z, tank: p.tank, alive: p.alive, hp: p.hp, st: p.state, team: p.team } : null,
    runners: m ? m.runners.map((r) => [r.x, r.y, r.z, r.painted, r.washes, r.firing ? 1 : 0, r.alive ? 1 : 0, r.team, r.bot ? 1 : 0, r.name]) : null,
    result: m ? m.result : null, mode: m ? m.matchMode : null, rule: m ? m.rule : null,
  };
}"""
SCREEN_JS = SCREEN = """() => {
  const r = document.querySelector('#df-online');
  if (!r || r.hidden) return null;
  const s = r.querySelector('.dfo-screen:not([hidden])');
  return s ? s.dataset.screen : null;
}"""
BADGE_JS = """() => { const h = document.querySelector('#df-online-hud'); const n = h && !h.hidden && h.querySelector('.dfo-net'); return n && !n.hidden ? n.innerText : null; }"""
POST_JS = """() => {
  const p = document.querySelector('.dfo-post'); if (!p || p.hidden || !p.classList.contains('ready')) return null;
  return [...p.querySelectorAll('.dfo-postbtns button')].map((b) => b.textContent.trim());
}"""
SLATE_JS = """() => { const v = document.querySelector('.df-victory'); return !!(v && !v.hidden && getComputedStyle(v).visibility !== 'hidden'); }"""
PLAY_GATE_JS = """() => { const b = document.getElementById('df-play'); const r = document.getElementById('df-boot');
  return b && r && !r.classList.contains('gone') && b.offsetParent !== null ? true : null; }"""
NET_STATS_JS = "() => window.__NET__ ? window.__NET__.stats() : null"
DF_STATS_JS = "() => window.__DF_STATS__ ? window.__DF_STATS__.state() : null"


def lna(flags):
    """Chrome's Local Network Access checks block the Playwright-fulfilled portal stand-in from framing the loopback dev server;
    a test-rig artifact only (statscheck.py launch())"""
    return [f + ",LocalNetworkAccessChecks" if f.startswith("--disable-features=") else f for f in flags]


def median(a):
    a = sorted(a)
    return a[len(a) // 2] if a else 0


def pct(a, q):
    a = sorted(a)
    return a[min(len(a) - 1, int(len(a) * q))] if a else 0


# ───────────────────────────── WebSocket frame meter (CDP) ─────────────────────────────
class WsMeter:
    """Every WebSocket frame this page sent / received on the relay socket, with its application payload size and kind."""

    def __init__(self, relay_host):
        self.relay_host = relay_host
        self.socks = {}
        self.ev = []                                          # (t, dir, kind, nbytes)
        self.sockets_opened = 0

    def attach(self, cdp):
        cdp.send("Network.enable")
        cdp.on("Network.webSocketCreated", self._created)
        cdp.on("Network.webSocketFrameSent", lambda e: self._frame("up", e))
        cdp.on("Network.webSocketFrameReceived", lambda e: self._frame("down", e))

    def _created(self, e):
        self.socks[e.get("requestId")] = e.get("url", "")
        if self.relay_host in e.get("url", ""):
            self.sockets_opened += 1

    def _frame(self, d, e):
        if self.relay_host not in self.socks.get(e.get("requestId"), ""):
            return
        r = e.get("response") or {}
        op, pl = r.get("opcode"), r.get("payloadData") or ""
        if op == 2:
            try:
                raw = base64.b64decode(pl)
            except Exception:
                raw = b""
            self.ev.append((time.time(), d, raw[0] if raw else 0, len(raw)))
        elif op == 1:
            self.ev.append((time.time(), d, KIND_TEXT, len(pl.encode("utf-8", "replace"))))

    def window(self, t0, t1):
        out = {"up": {}, "down": {}}
        for t, d, k, n in self.ev:
            if t0 <= t <= t1:
                a = out[d].setdefault(k, [0, 0])
                a[0] += 1
                a[1] += n
        return out


# ───────────────────────────── a peer (one browser context) ─────────────────────────────
class Peer:
    def __init__(self, run, name, url, profile=None, viewport=(1100, 640), touch=False, portal=False, meter=True):
        self.run = run
        self.name = name
        self.touch = touch
        self.errors = []
        self.closed = False
        self.portal_page = None
        self.keys = set()
        self.mouse_down = False
        self.drv = None
        self.snap_every = 0.0                              # > 0: snap this page at most that often (a starved page blocks every call on it)
        self.t_snap = 0.0
        self.last_snap = None
        kw = {"viewport": {"width": viewport[0], "height": viewport[1]}, "device_scale_factor": 1}
        if touch:
            kw.update({"is_mobile": True, "has_touch": True, "user_agent": IOS_UA})
        self.ctx = run.browser.new_context(**kw)
        self.ctx.add_init_script(C.INIT_JS)
        if profile:
            self.ctx.add_init_script("try { localStorage.setItem('dyefield.profile.v1', %s); } catch (e) {}" % json.dumps(json.dumps(profile)))
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(30_000)
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: " + str(e)[:300]))
        self.page.on("console", self._console)
        self.viewport = viewport
        if portal:
            parent = "http://localhost:%d/__df_portal" % run.port
            body = SC.STANDIN % {"cfg": json.dumps({"signedIn": True, "record": None}), "src": SC.html.escape(url),
                                 "sandbox": SC.html.escape(run.sandbox or ""), "allow": SC.html.escape(run.allow or "")}
            self.ctx.route(lambda u: u.startswith(parent), lambda r: r.fulfill(status=200, body=body, content_type="text/html"))
            self.portal_page = self.page
            self.page.goto(parent, wait_until="load", timeout=120_000)
            fr = None
            for _ in range(300):
                fr = next((f for f in self.page.frames if f.url.startswith(run.base)), None)
                if fr:
                    break
                time.sleep(0.1)
            if not fr:
                raise C.HarnessError("%s: the game frame never appeared in the portal stand-in" % name)
            self.f = fr
        else:
            self.page.goto(url, wait_until="commit", timeout=600_000)       # (DOMContentLoaded waits for the module graph to run: minutes on a starved box; every wait below polls the page itself)
            self.f = self.page
        self.meter = None
        self.cdp = None
        if meter:
            try:
                self.meter = WsMeter("127.0.0.1:%d" % RELAY_PORT)
                self.cdp = self.ctx.new_cdp_session(self.f if portal else self.page)
                self.meter.attach(self.cdp)
            except Exception as e:
                self.meter = None
                self.errors.append("meter: " + str(e)[:200])

    def _console(self, m):
        try:
            if m.type == "error" and "favicon" not in m.text:
                self.errors.append("console: " + m.text[:300])
            elif m.type == "warning" and ("[dyefield stats]" in m.text or "[dyefield/net]" in m.text):
                self.errors.append("warning: " + m.text[:300])
        except Exception:
            pass

    # ── page access ──
    def ev(self, js, arg=None, default=None):
        if self.closed:
            return default
        try:
            return self.f.evaluate(js, arg) if arg is not None else self.f.evaluate(js)
        except Exception:
            return default

    def wait(self, js, timeout_s, poll=0.25):
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            v = self.ev(js)
            if v:
                return v
            time.sleep(poll)
        return None

    def snap(self):
        return self.ev(SNAP_JS)

    def screen(self):
        return self.ev(SCREEN_JS)

    def wait_screen(self, name, timeout_s=30):
        return self.wait("() => (%s)() === %s || null" % (SCREEN_JS, json.dumps(name)), timeout_s)

    def net_stats(self):
        return self.ev(NET_STATS_JS, default={}) or {}

    def click(self, sel, timeout_s=15):
        """a real mouse press at the element's centre ('force': the enabled START / PLAY AGAIN buttons pulse forever)"""
        try:
            self.f.locator(sel).first.click(timeout=timeout_s * 1000, force=True)
            return True
        except Exception as e:
            self.errors.append("click %s: %s" % (sel, str(e).splitlines()[0][:160]))
            return False

    def tap(self, sel, timeout_s=15):
        """a real touch tap (coordinate tap at the element's centre: Playwright's locator.tap double-fires a key after a timeout)"""
        try:
            loc = self.f.locator(sel).first
            loc.wait_for(state="visible", timeout=timeout_s * 1000)
            b = loc.bounding_box()
            if self.portal_page is not None and b:
                pass
            self.page.touchscreen.tap(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
            return True
        except Exception as e:
            self.errors.append("tap %s: %s" % (sel, str(e).splitlines()[0][:160]))
            return False

    def press(self, sel, timeout_s=15):
        return self.tap(sel, timeout_s) if self.touch else self.click(sel, timeout_s)

    def shot(self, tag):
        try:
            os.makedirs(SHOTS, exist_ok=True)
            self.page.screenshot(path=os.path.join(SHOTS, "online_%s_%s.png" % (tag, self.name)), scale="css", timeout=30_000)
        except Exception:
            pass

    def throttle(self, rate):
        """CDP CPU throttling of this page (1 = none). A page parked on the PLAY ONLINE screens keeps running its lobby backdrop
        sim at full speed; N such pages starve the next page's load on a shared box, so each loaded page is parked at rate 8 (it
        still answers the relay's pings and room messages) and released before START"""
        try:
            c = self.cdp or self.ctx.new_cdp_session(self.page)
            c.send("Emulation.setCPUThrottlingRate", {"rate": float(rate)})
            self.throttle_rate = rate
        except Exception as e:
            self.errors.append("throttle: " + str(e)[:120])

    def real_errors(self):
        return [e for e in self.errors if "favicon" not in e and not e.startswith("click ") and not e.startswith("tap ")]

    def close(self):
        self.closed = True
        try:
            if self.drv:
                self.drv.dead = True
        except Exception:
            pass
        try:
            self.ctx.close()
        except Exception:
            pass

    # ── the real lobby ──
    def open_online(self, timeout_s=120):
        """the ?net= dev link opens PLAY ONLINE by itself (main.ts); a press on the title's tile otherwise"""
        if self.wait_screen("home", timeout_s):
            return True
        self.press("#dfm-play-online", 60)
        return bool(self.wait_screen("home", 60))

    def pick(self, mode, rule):
        """MODE / RULE on the PLAY ONLINE home (the real segmented buttons)"""
        self.press("#dfo-mode-%s" % mode)
        self.press("#dfo-rule-%s" % rule)

    def room_code(self):
        t = self.ev("() => { const e = document.getElementById('dfo-room-code'); return e ? e.textContent : ''; }", default="") or ""
        return re.sub(r"[^A-Z0-9]", "", t.upper())

    def type_code(self, code):
        if not self.touch:
            self.page.keyboard.type(code, delay=60)
            return
        for ch in code:
            self.tap("#dfo-key-%s" % ch)
            time.sleep(0.25)

    def play_gate(self):
        """CLICK TO PLAY after the arena loaded (the START / QUICK MATCH click's pointer-lock gesture is long gone): a real click"""
        if self.touch:
            return False
        if self.ev(PLAY_GATE_JS):
            cx, cy = self.viewport[0] / 2, self.viewport[1] / 2
            self.page.mouse.move(cx, cy)
            self.page.mouse.click(cx, cy)
            return True
        return False

    def wait_live(self, timeout_s=300):
        """until the match is live on this page (clicking CLICK TO PLAY like a player; progress-based, not a wall clock)"""
        t0, last_tick, last_move = time.time(), -1, time.time()
        s = None
        while time.time() - t0 < timeout_s:
            self.play_gate()
            s = self.snap()
            if s and s.get("mphase") == "live" and s.get("role"):
                return s
            tk = s.get("tick") if s else None
            if tk is not None and tk != last_tick:
                last_tick, last_move = tk, time.time()
            if s and s.get("phase") == "error":
                return None
            time.sleep(0.4)
        return None


# ───────────────────────────── real input ─────────────────────────────
class Driver:
    """A player's hands: W held, FIRE held, the mouse swept under pointer lock (so the walk curves over fresh floor), a strafe tap
    every ~1.6 s, a jump now and then, SLICK (Shift) to refill the tank when it runs low. Real keyboard.down/up and mouse
    events through Playwright (the same CDP Input.dispatch* a user's device ends in)."""

    def __init__(self, peer):
        self.p = peer
        self.vw, self.vh = peer.viewport
        self.mx, self.my = self.vw / 2, self.vh / 2 + 80
        self.sweep = 1
        self.t_flip = time.time()
        self.side = "KeyA"
        self.t_strafe = time.time()
        self.refill = False
        self.t_ref = 0.0
        self.dead = False
        self.held = False
        self.clicked = False
        self.steps = 0

    def _release(self):
        kb, ms = self.p.page.keyboard, self.p.page.mouse
        try:
            for k in list(self.p.keys):
                kb.up(k)
            self.p.keys.clear()
            if self.p.mouse_down:
                ms.up()
                self.p.mouse_down = False
        except Exception:
            pass
        self.held = False

    def _down(self, k):
        if k not in self.p.keys:
            self.p.page.keyboard.down(k)
            self.p.keys.add(k)

    def _up(self, k):
        if k in self.p.keys:
            self.p.page.keyboard.up(k)
            self.p.keys.discard(k)

    def step(self, s):
        if self.dead or self.p.closed or self.p.touch:
            return
        kb, ms = self.p.page.keyboard, self.p.page.mouse
        live = bool(s and s.get("mphase") == "live" and s.get("me") and s["me"].get("alive") and not s.get("victory") and (s.get("tl") or 0) > 1.4)
        if not live:
            if self.held:
                self._release()
            return
        self.steps += 1
        try:
            if not self.clicked or not s.get("locked"):
                if not self.clicked or self.steps % 12 == 0:
                    ms.move(self.vw / 2, self.vh / 2)
                    ms.click(self.vw / 2, self.vh / 2)      # a real click: focuses the page, takes the pointer lock
                    self.clicked = True
                    ms.move(self.mx, self.my)
            if not self.held:
                self._down("KeyW")
                ms.down()
                self.p.mouse_down = True
                self.held = True
            tank = s["me"].get("tank") or 0
            if not self.refill and tank < 12:
                ms.up(); self.p.mouse_down = False
                self._down("ShiftLeft")
                self.refill, self.t_ref = True, time.time()
            elif self.refill and (tank > 85 or time.time() - self.t_ref > 3.5):
                self._up("ShiftLeft")
                ms.down(); self.p.mouse_down = True
                self.refill = False
            if s.get("locked"):
                self.mx += 55 * self.sweep
                ms.move(self.mx, self.my)
                if time.time() - self.t_flip > 2.8:
                    self.sweep, self.t_flip = -self.sweep, time.time()
            if not self.refill and time.time() - self.t_strafe > 1.6:
                self._down(self.side)
                time.sleep(0.12)
                self._up(self.side)
                self.side = "KeyD" if self.side == "KeyA" else "KeyA"
                if self.side == "KeyA":
                    kb.press("Space")
                self.t_strafe = time.time()
        except Exception as e:
            self.p.errors.append("driver: " + str(e)[:160])

    def release(self):
        self._release()


class PhoneDriver:
    """the phone context's real multi-touch (CDP Input.dispatchTouchEvent, CSS px): the left stick held and swept through four
    directions and FIRE held — a player's two thumbs"""

    def __init__(self, peer, throttle):
        self.p = peer
        self.cdp = peer.ctx.new_cdp_session(peer.page)
        if throttle and throttle > 1:
            self.cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
        self.pts = {}
        self.k = 0
        self.w, self.h = peer.viewport
        self.sx, self.sy = self.w * 0.20, self.h * 0.70
        self.fire = None
        self.moves = 0
        self.dead = False

    def _send(self, typ):
        pts = [{"x": float(p[0]), "y": float(p[1]), "id": i} for i, p in sorted(self.pts.items())]
        try:
            self.cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": pts})
        except Exception:
            pass

    def find_fire(self):
        t = self.p.ev("() => window.__DF__ && window.__DF__.touch ? window.__DF__.touch() : null")
        for b in (t or {}).get("buttons") or []:
            if b.get("id") == "fire":
                r = b["rect"]
                self.fire = (r["x"] + r["w"] / 2, r["y"] + r["h"] / 2)

    def step(self, s):
        if self.dead or self.p.closed:
            return
        live = bool(s and s.get("mphase") == "live" and s.get("me") and s["me"].get("alive") and not s.get("victory") and (s.get("tl") or 0) > 1.4)
        if not live:
            self.release()
            return
        now = time.time()
        if now - getattr(self, "t_move", 0) < 1.5 and 1 in self.pts and (2 in self.pts or self.fire is None):
            return                                                  # the thumbs stay down; a CDP touch call blocks while the (throttled) page is busy
        self.t_move = now
        dirs = [(0, -1), (1, 0), (0, -1), (-1, 0), (0, 1), (1, 0)]
        dx, dy = dirs[(self.k // 2) % len(dirs)]
        self.k += 1
        if 1 not in self.pts:
            self.pts[1] = (self.sx, self.sy)
            self._send("touchStart")
        if self.fire is None and self.k % 6 == 1:
            self.find_fire()
        if self.fire is not None and 2 not in self.pts:
            self.pts[2] = self.fire
            self._send("touchStart")
        self.pts[1] = (self.sx + dx * 55, self.sy + dy * 55)
        self._send("touchMove")
        self.moves += 1

    def release(self):
        if not self.pts:
            return
        self.pts = {}
        try:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        except Exception:
            pass


# ───────────────────────────── the runner ─────────────────────────────
class Run:
    def __init__(self, args):
        self.args = args
        self.port = args.port
        self.base = "http://127.0.0.1:%d/" % self.port
        self.relay = "ws://127.0.0.1:%d" % RELAY_PORT
        self.relay_http = "http://127.0.0.1:%d" % RELAY_PORT
        self.sandbox, self.allow = SC.read_portal_attrs()
        self.report = {"gate": "online.py (INTEGRATION)", "base": self.base, "relay": self.relay, "soft": bool(args.soft), "scenarios": {}}
        self.fails = []
        self.cur = None
        self.server = None
        self.relay_proc = None
        self.pw = None
        self.browser = None

    # ── bookkeeping ──
    def scenario(self, key, title):
        self.cur = {"title": title, "checks": [], "info": {}}
        self.report["scenarios"][key] = self.cur
        print("\n== %s %s ==" % (key, title), flush=True)

    def ok(self, cond, name, detail=""):
        cond = bool(cond)
        self.cur["checks"].append({"name": name, "pass": cond, "detail": str(detail)[:900]})
        print("%s  %s%s" % ("PASS" if cond else "FAIL", name, ("  -  " + str(detail)[:700]) if detail != "" else ""), flush=True)
        if not cond:
            self.fails.append("%s: %s (%s)" % (self.cur["title"], name, str(detail)[:300]))
        return cond

    def info(self, k, v):
        self.cur["info"][k] = v
        print("INFO  %s: %s" % (k, json.dumps(v, default=str)[:700]), flush=True)

    # ── servers ──
    def start(self):
        if C.url_reachable(self.base):
            print("dev server already answering at %s - reusing it" % self.base)
        else:
            os.makedirs(C.REPORTS, exist_ok=True)
            log_path = os.path.join(C.REPORTS, "devserver_%d.log" % self.port)
            logf = open(log_path, "w", encoding="utf-8", errors="replace")
            env = dict(os.environ, DF_FROZEN="1", PYTHONIOENCODING="utf-8", FORCE_COLOR="0")
            kw = {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)} if os.name == "nt" else {"start_new_session": True}
            if self.args.dist:
                cmd = 'npx vite preview --outDir "%s" --port %d --strictPort --host 127.0.0.1' % (os.path.abspath(self.args.dist), self.port)
            else:
                cmd = "npx vite --port %d --strictPort --host 127.0.0.1" % self.port
            print("starting `%s` (DF_FROZEN=1, log %s)" % (cmd, log_path))
            proc = subprocess.Popen(cmd, cwd=ROOT, shell=True, stdout=logf, stderr=subprocess.STDOUT, env=env, **kw)
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
        self.start_relay()
        from playwright.sync_api import sync_playwright
        self.pw = sync_playwright().start()
        self.launch()

    def relay_get(self, path):
        try:
            with urllib.request.urlopen(self.relay_http + path, timeout=6) as r:
                return json.loads(r.read().decode())
        except Exception as e:
            return {"error": str(e)}

    def start_relay(self):
        h = self.relay_get("/health")
        if h.get("ok"):
            env = self.relay_get("/__dev/env")
            print("relay already answering at %s - reusing it (DEV_QUICK_DURATION_S %s)" % (self.relay_http, env.get("DEV_QUICK_DURATION_S")))
            return
        wj = os.path.join(os.environ.get("APPDATA", ""), "npm", "node_modules", "wrangler", "bin", "wrangler.js")
        if not os.path.exists(wj):
            raise C.HarnessError("no relay at %s and wrangler.js not found (%s): start `wrangler dev --local --port %d` in workers/dyefield-net" % (self.relay_http, wj, RELAY_PORT))
        wdir = os.path.join(REPO, "workers", "dyefield-net")
        persist = tempfile.mkdtemp(prefix="dfnet-online-")
        args = ["node", wj, "dev", "--local", "--ip", "127.0.0.1", "--port", str(RELAY_PORT), "--persist-to", persist,
                "--show-interactive-dev-session=false", "--log-level", "warn"]
        rv = dict(RELAY_VARS)
        if self.args.host_stall_ms:
            rv["HOST_STALL_MS"] = int(self.args.host_stall_ms)       # the shared box stalls an 8-page host for > 1.5 s: SYNC's relay used 4000 for its 8-human runs too
        for k, v in rv.items():
            args += ["--var", "%s:%s" % (k, v)]
        env = dict(os.environ, NO_COLOR="1", FORCE_COLOR="0", WRANGLER_SEND_METRICS="false")
        env.pop("CLOUDFLARE_API_TOKEN", None)
        logp = os.path.join(C.REPORTS, "relay_%d.log" % RELAY_PORT)
        logf = open(logp, "w", encoding="utf-8", errors="replace")
        kw = {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x200)} if os.name == "nt" else {"start_new_session": True}
        print("starting the local relay: wrangler dev --local --port %d %s" % (RELAY_PORT, " ".join("--var %s:%s" % kv for kv in rv.items())))
        proc = subprocess.Popen(args, cwd=wdir, stdout=logf, stderr=subprocess.STDOUT, env=env, **kw)
        self.relay_proc = {"proc": proc, "log": logf, "path": logp}
        t0 = time.time()
        while time.time() - t0 < 120:
            if proc.poll() is not None:
                raise C.HarnessError("wrangler dev exited (%s), see %s" % (proc.returncode, logp))
            if self.relay_get("/health").get("ok"):
                return
            time.sleep(0.5)
        raise C.HarnessError("the relay did not answer within 120 s (%s)" % logp)

    def launch(self):
        if self.browser:
            try:
                self.browser.close()
            except Exception:
                pass
        flags = lna(SOFT_FLAGS if self.args.soft else C.FLAGS)
        self.report["chromeFlags"] = flags
        self.browser = self.pw.chromium.launch(channel="chrome", headless=True, args=flags)
        self.report["chrome"] = self.browser.version

    def stop(self):
        for obj, meth in ((self.browser, "close"), (self.pw, "stop")):
            try:
                if obj:
                    getattr(obj, meth)()
            except Exception:
                pass
        C.stop_server(self.server)
        C.stop_server(self.relay_proc)

    # ── urls / peers ──
    def url(self, **extra):
        q = {"dev": 1, "net": self.relay, "statsdev": 1}
        for k, v in extra.items():
            if v is None:
                q.pop(k, None)
            else:
                q[k] = v
        return self.base + "?" + urllib.parse.urlencode(q)

    def profile(self, name, kit="mist-rasp", mode="teams", rule="turf", crew=1, color=1):
        return {"name": name, "crew": crew, "mode": mode, "rule": rule, "ffaColor": color, "kit": kit, "map": "random", "preset": "noon", "skill": "swell"}


def page_errors_ok(run, peers, tag):
    for p in peers:
        errs = p.real_errors()
        run.ok(not any(e.startswith("pageerror") or e.startswith("console") for e in errs), "%s: %s no page errors / console errors" % (tag, p.name), "; ".join(errs[-3:]) or "none")


CYCLE = {"n": 0, "maxS": 0.0, "sumS": 0.0, "snapMax": {}, "drvMax": {}, "slow": []}


def play_loop(peers, until, timeout_s, sample=None, every=0.3, drivers=None):
    """one thread, N pages: each cycle snaps every page, runs each page's hands on its snap, then `sample(snaps)`. Cycle and
    per-call times are kept in CYCLE (printed with the scenario): a page whose main thread is starved makes every call on it slow"""
    t0 = time.time()
    snaps = {}
    CYCLE.update({"n": 0, "maxS": 0.0, "sumS": 0.0, "snapMax": {}, "drvMax": {}, "slow": []})
    while time.time() - t0 < timeout_s:
        tc = time.time()
        for p in peers:
            if p.closed:
                continue
            t1 = time.time()
            if p.snap_every and p.last_snap is not None and t1 - p.t_snap < p.snap_every:
                s = p.last_snap
            else:
                s = p.snap()
                p.last_snap, p.t_snap = s, time.time()
            t2 = time.time()
            snaps[p.name] = s
            if p.drv is not None:
                p.drv.step(s)
            if p.touch and not p.closed and t1 - getattr(p, "t_gate", 0) > 5:
                p.t_gate = t1
                p.play_gate()
            t3 = time.time()
            CYCLE["snapMax"][p.name] = round(max(CYCLE["snapMax"].get(p.name, 0.0), t2 - t1), 2)
            CYCLE["drvMax"][p.name] = round(max(CYCLE["drvMax"].get(p.name, 0.0), t3 - t2), 2)
            if t3 - t1 > 5 and len(CYCLE["slow"]) < 12:
                CYCLE["slow"].append((p.name, round(t2 - t1, 1), round(t3 - t2, 1), round(t1 - t0)))
        t4 = time.time()
        if sample:
            sample(snaps)
        dt = time.time() - tc
        CYCLE["n"] += 1
        CYCLE["sumS"] += dt
        CYCLE["maxS"] = round(max(CYCLE["maxS"], dt), 2)
        if until(snaps):
            CYCLE["meanS"] = round(CYCLE["sumS"] / CYCLE["n"], 2)
            return snaps, True
        time.sleep(every)
    CYCLE["meanS"] = round(CYCLE["sumS"] / max(1, CYCLE["n"]), 2)
    return snaps, False


def hand(peer, touch_throttle=None):
    peer.drv = PhoneDriver(peer, touch_throttle) if peer.touch else Driver(peer)
    return peer.drv


# ───────────────────────────── A: QUICK MATCH, two humans ─────────────────────────────
def frames_sent(peers, until=None):
    """(every frame the pages sent on the relay socket [up to `until`], how many of them were 1-byte pings)"""
    tot = pings = 0
    for p in peers:
        if not p.meter:
            continue
        for t, d, k, n in p.meter.ev:
            if d == "up" and (until is None or t <= until):
                tot += 1
                if k == KIND_TEXT and n == 1:
                    pings += 1
    return tot, pings


def stream_window(peer, role):
    """the span the SNAP stream actually flowed on this page's socket (first SNAP + 1 s .. last SNAP - 1 s): rates measured over it,
    never over the harness's own (possibly long) idle tail after the horn"""
    if not peer.meter:
        return 0, 1
    d = "down" if role == "client" else "up"
    ts = [t for (t, dd, k, n) in peer.meter.ev if k == KIND_SNAP and dd == d]
    if len(ts) < 40:
        return 0, 1
    return ts[0] + 1.0, ts[-1] - 1.0


def frame_report(run, peer, t0, t1):
    w = peer.meter.window(t0, t1) if peer.meter else {"up": {}, "down": {}}
    dur = max(1.0, t1 - t0)

    def row(d, k):
        n, b = w[d].get(k, [0, 0])
        return {"hz": round(n / dur, 2), "bytesPerS": round(b / dur, 1), "meanB": round(b / n, 1) if n else 0, "n": n}
    return {"windowS": round(dur, 1), "_t0": t0, "_t1": t1,
            "up": {"INTENTS": row("up", KIND_INTENTS), "SNAP": row("up", KIND_SNAP), "text": row("up", KIND_TEXT)},
            "down": {"SNAP": row("down", KIND_SNAP), "INTENTS": row("down", KIND_INTENTS), "KEYFRAME": row("down", KIND_KEYFRAME), "HANDOFF": row("down", KIND_HANDOFF), "text": row("down", KIND_TEXT)},
            "totalUpFrames": sum(v[0] for v in w["up"].values()), "totalDownFrames": sum(v[0] for v in w["down"].values()),
            "totalDownBytesPerS": round(sum(v[1] for v in w["down"].values()) / dur, 1), "totalUpBytesPerS": round(sum(v[1] for v in w["up"].values()) / dur, 1)}


def check_budget(run, tag, peer, rep, role):
    """CONTRACT_ONLINE O9.1: INTENTS 20 Hz x 45 B up from a client; SNAP 20 Hz x ~0.9-1.3 KB down to every client (18-26 KB/s)"""
    up_i, dn_s = rep["up"]["INTENTS"], rep["down"]["SNAP"]
    if role == "client":
        run.ok(14 <= up_i["hz"] <= 24, "%s: %s (client) sends INTENTS at ~20 Hz (budget 20 Hz; 15-24 accepted)" % (tag, peer.name), "%s Hz over %s s" % (up_i["hz"], rep["windowS"]))
        run.ok(0 < up_i["meanB"] <= 64, "%s: %s INTENTS frame <= 64 B (budget 45 B = 6 + 3 x 13)" % (tag, peer.name), "mean %s B" % up_i["meanB"])
        run.ok(14 <= dn_s["hz"] <= 24, "%s: %s receives SNAP at ~20 Hz (budget 20 Hz)" % (tag, peer.name), "%s Hz" % dn_s["hz"])
        run.ok(0 < dn_s["meanB"] <= 1600, "%s: %s SNAP mean <= 1.6 KB (budget ~0.9-1.3 KB)" % (tag, peer.name), "mean %s B" % dn_s["meanB"])
        run.ok(rep["totalDownBytesPerS"] <= 30_000, "%s: %s downstream <= 30 KB/s (budget 18-26 KB/s)" % (tag, peer.name), "%s B/s total, SNAP %s B/s" % (rep["totalDownBytesPerS"], dn_s["bytesPerS"]))
        run.ok(rep["totalUpBytesPerS"] <= 3_000, "%s: %s upstream <= 3 KB/s (budget ~1 KB/s + pings)" % (tag, peer.name), "%s B/s" % rep["totalUpBytesPerS"])
    else:
        # the host SENDS the SNAP stream (the relay fans it out) and RECEIVES every client's INTENTS: seen from its socket the
        # directions swap (CONTRACT_ONLINE O9.2 "the host sends 20 SNAP/s and receives 7 x 20 INTENTS/s")
        su, di = rep["up"]["SNAP"], rep["down"]["INTENTS"]
        run.ok(14 <= su["hz"] <= 24, "%s: %s (host) sends SNAP at ~20 Hz (budget 20 Hz)" % (tag, peer.name), "%s Hz, mean %s B, %s B/s up" % (su["hz"], su["meanB"], rep["totalUpBytesPerS"]))
        run.ok(rep["up"]["INTENTS"]["n"] == 0, "%s: %s (host) sends no INTENTS (it steps the sim itself)" % (tag, peer.name), "INTENTS up %s" % rep["up"]["INTENTS"]["n"])
        run.ok(di["n"] > 0 and di["meanB"] <= 64, "%s: %s (host) receives the clients' INTENTS (<= 64 B each)" % (tag, peer.name), "%s Hz total, mean %s B" % (di["hz"], di["meanB"]))
    run.info("rates %s %s (%s)" % (tag, peer.name, role), rep)


def scenario_a(run):
    tag = "A quick match"
    run.scenario("A", "QUICK MATCH, 2 humans, TEAMS TURF, real keys + mouse, stats hand-off, rates")
    env = run.relay_get("/__dev/env")
    dur = float(env.get("DEV_QUICK_DURATION_S") or 0)
    run.ok(dur >= 60, "%s: the relay's quick matches are >= 60 s (DEV_QUICK_DURATION_S, so a record is naturally eligible)" % tag, "DEV_QUICK_DURATION_S %s" % env.get("DEV_QUICK_DURATION_S"))
    health0 = run.relay_get("/health")
    A = Peer(run, "A", run.url(renderfps=None), run.profile("Alder", "mist-rasp", "teams", "turf"), portal=True)
    B = Peer(run, "B", run.url(renderfps=None), run.profile("Birch", "sheet-drum", "teams", "turf"))
    peers = [A, B]
    try:
        for p in peers:
            run.ok(p.open_online(), "%s: %s: the ?net= link opens the PLAY ONLINE screen (the real lobby)" % (tag, p.name), str(p.screen()))
        for p in peers:
            p.shot("lobby_home")
            p.pick("teams", "turf")
        # the stand-in's first reply: A is signed in (empty record)
        for p in peers:
            run.ok(p.press("#dfo-door-qm"), "%s: %s clicks QUICK MATCH" % (tag, p.name), "")
        t_q = time.time()
        for p in peers:
            run.ok(bool(p.wait("() => { const s = window.__NET__ && window.__NET__.status(); return s && (s.kind === 'queue' || s.kind === 'room') ? s.kind : null; }", 30)),
                   "%s: %s is in the queue / a room" % (tag, p.name), json.dumps(p.ev("() => window.__NET__.status().kind")))
        for p in peers:
            p.shot("search")
        live = [p.wait_live(420) for p in peers]
        run.ok(all(live), "%s: both pages reach a LIVE online match (matched, loaded, CLICK TO PLAY)" % tag, "after %.0f s; roles %s" % (time.time() - t_q, [s and s.get("role") for s in live]))
        if not all(live):
            return
        for p in peers:
            hand(p)
        sA, sB = live
        run.ok({sA["role"], sB["role"]} == {"host", "client"}, "%s: one page is the host, the other the client" % tag, "A %s B %s" % (sA["role"], sB["role"]))
        pid = {"A": sA["pid"], "B": sB["pid"]}
        run.ok(pid["A"] is not None and pid["B"] is not None and pid["A"] != pid["B"], "%s: the two humans hold different runners" % tag, json.dumps(pid))
        run.ok(sA["mode"] == "teams" and sB["mode"] == "teams" and sA["rule"] == "turf", "%s: the match is TEAMS TURF on both pages" % tag, "%s/%s %s" % (sA["mode"], sB["mode"], sA["rule"]))
        humans = {p.name: p for p in peers}
        t_live = time.time()
        samples = {"trackAB": [], "trackBA": [], "movedA": 0.0, "movedB": 0.0, "paintA": [], "paintB": [], "firingAB": 0, "firingBA": 0, "n": 0, "lastA": None, "lastB": None,
                   "viewAB_dist": 0.0, "viewBA_dist": 0.0, "lastViewAB": None, "lastViewBA": None, "shotAt": False}

        def sample(sn):
            a, b = sn.get("A"), sn.get("B")
            if not a or not b or a.get("mphase") != "live" or b.get("mphase") != "live" or not a.get("runners") or not b.get("runners"):
                return
            if pid["A"] >= len(a["runners"]) or pid["B"] >= len(b["runners"]):
                return
            S = samples
            S["n"] += 1
            # A's view of B's runner vs B's own position (and the reverse)
            vab = a["runners"][pid["B"]]
            vba = b["runners"][pid["A"]]
            S["trackAB"].append(math.dist((vab[0], vab[2]), (b["me"]["x"], b["me"]["z"])))
            S["trackBA"].append(math.dist((vba[0], vba[2]), (a["me"]["x"], a["me"]["z"])))
            if S["lastA"]:
                S["movedA"] += math.dist((a["me"]["x"], a["me"]["z"]), S["lastA"])
            if S["lastB"]:
                S["movedB"] += math.dist((b["me"]["x"], b["me"]["z"]), S["lastB"])
            S["lastA"], S["lastB"] = (a["me"]["x"], a["me"]["z"]), (b["me"]["x"], b["me"]["z"])
            if S["lastViewAB"]:
                S["viewAB_dist"] += math.dist((vab[0], vab[2]), S["lastViewAB"])
            if S["lastViewBA"]:
                S["viewBA_dist"] += math.dist((vba[0], vba[2]), S["lastViewBA"])
            S["lastViewAB"], S["lastViewBA"] = (vab[0], vab[2]), (vba[0], vba[2])
            S["firingAB"] += vab[5]
            S["firingBA"] += vba[5]
            S["paintA"].append(a["runners"][pid["A"]][3])
            S["paintB"].append(b["runners"][pid["B"]][3])
            if S["n"] == 25 and not S["shotAt"]:
                S["shotAt"] = True
                A.shot("match_mid")
                B.shot("match_mid")

        def done(sn):
            return all(sn.get(p.name) and (sn[p.name].get("ended") or sn[p.name].get("victory")) for p in peers)

        snaps, finished = play_loop(peers, done, dur + 240, sample=sample)
        t_end = time.time()
        for p in peers:
            p.drv.release()
        run.ok(finished, "%s: the match ran to the horn on both pages" % tag, "%.0f s after live" % (t_end - t_live))
        time.sleep(2.5)
        S = samples
        run.info("sampling A", {"samples": S["n"], "movedA_m": round(S["movedA"], 1), "movedB_m": round(S["movedB"], 1), "viewOfB_in_A_m": round(S["viewAB_dist"], 1),
                                "viewOfA_in_B_m": round(S["viewBA_dist"], 1), "trackMed_AB": round(median(S["trackAB"]), 2), "trackMed_BA": round(median(S["trackBA"]), 2),
                                "trackP90_AB": round(pct(S["trackAB"], 0.9), 2), "trackP90_BA": round(pct(S["trackBA"], 0.9), 2), "firingFrames_AB": S["firingAB"], "firingFrames_BA": S["firingBA"]})
        run.ok(S["movedA"] >= 20 and S["movedB"] >= 20, "%s: both humans MOVED (own position travelled >= 20 m over the match)" % tag, "A %.0f m, B %.0f m (%d samples)" % (S["movedA"], S["movedB"], S["n"]))
        run.ok(S["viewAB_dist"] >= 15 and S["viewBA_dist"] >= 15, "%s: each page SEES the other human move (the remote runner's rendered position travelled >= 15 m)" % tag, "A sees B %.0f m, B sees A %.0f m" % (S["viewAB_dist"], S["viewBA_dist"]))
        run.ok(median(S["trackAB"]) < 3.0 and median(S["trackBA"]) < 3.0, "%s: each page's view of the other human tracks that human's own position (median error < 3 m: interpolation delay + sample skew)" % tag,
               "A's view of B: median %.2f m p90 %.2f; B's view of A: median %.2f m p90 %.2f" % (median(S["trackAB"]), pct(S["trackAB"], 0.9), median(S["trackBA"]), pct(S["trackBA"], 0.9)))
        run.ok(S["firingAB"] > 0 and S["firingBA"] > 0, "%s: each page SEES the other human SHOOT (the remote runner's firing flag seen set)" % tag, "A saw B firing in %d samples, B saw A in %d" % (S["firingAB"], S["firingBA"]))
        pa, pb = S["paintA"], S["paintB"]
        run.ok(len(pa) > 5 and pa[-1] > 50 and pb[-1] > 50, "%s: both humans PAINTED (m2 on the scoreboard) - and each page sees the other's paint grow" % tag, "A's own %s -> %s, B's own %s -> %s" % (round(pa[0]) if pa else None, round(pa[-1]) if pa else None, round(pb[0]) if pb else None, round(pb[-1]) if pb else None))
        a_last = [s for s in [snaps.get("A")] if s][0] if snaps.get("A") else None
        b_last = snaps.get("B")
        if a_last and b_last and a_last.get("runners") and b_last.get("runners"):
            va, vb = a_last["runners"][pid["B"]][3], b_last["runners"][pid["B"]][3]
            run.ok(va > 50 and abs(va - vb) <= max(40, 0.15 * max(va, vb)), "%s: A's view of B's paint equals B's own at the end (scoreboard agreement within tolerance)" % tag, "A sees B %.1f m2, B itself %.1f m2" % (va, vb))
        # the end: agreement on both pages
        stA, stB = A.net_stats(), B.net_stats()
        run.info("net log A (last lines)", (stA.get("log") or [])[-10:])
        run.info("net log B (last lines)", (stB.get("log") or [])[-10:])
        run.info("seats at the host", ((stA if stA.get("role") == "host" else stB).get("host") or {}).get("seatReport"))
        run.ok(stA.get("ended") == "complete" and stB.get("ended") == "complete", "%s: both pages saw the match complete" % tag, "A %s B %s" % (stA.get("ended"), stB.get("ended")))
        run.ok(stA.get("painterHash") is not None and stA.get("painterHash") == stB.get("painterHash"), "%s: the same final painter hash on both pages" % tag, "%s / %s" % (stA.get("painterHash"), stB.get("painterHash")))
        rA, rB = stA.get("result") or {}, stB.get("result") or {}
        shA, shB = rA.get("shares") or [], rB.get("shares") or []
        md = max([abs((shA[k] if k < len(shA) else 0) - (shB[k] if k < len(shB) else 0)) for k in range(max(len(shA), len(shB), 1))])
        run.ok(rA.get("winner") is not None and rA.get("winner") == rB.get("winner") and md <= 1e-9, "%s: end.result equal on both pages (winner, shares to 1e-9)" % tag, "winner %s/%s, shares max diff %s, shares %s" % (rA.get("winner"), rB.get("winner"), md, [round(x, 4) for x in shA]))
        cA = stA.get("client") or {}
        cB = stB.get("client") or {}
        cl = cA if cA else cB
        run.ok(cl.get("desyncs") == 0 and cl.get("hashChecks", 0) > 0 and cl.get("hashOk") == cl.get("hashChecks"), "%s: the client had 0 desyncs, every painter hash check matched" % tag, "desyncs %s hash %s/%s keyframes %s gaps %s" % (cl.get("desyncs"), cl.get("hashOk"), cl.get("hashChecks"), cl.get("keyframes"), cl.get("gaps")))
        pe = cl.get("predErr") or {}
        run.info("client prediction", {"p50": pe.get("p50"), "p95": pe.get("p95"), "max": pe.get("max"), "n": pe.get("n")})
        hs = (stA if stA.get("role") == "host" else stB).get("host") or {}
        run.info("host", {"hostTps": hs.get("hostTps"), "ticks": hs.get("ticks"), "humans": hs.get("humans"), "underflows": hs.get("underflows"), "maxGapMs": hs.get("maxGapMs")})
        for p in peers:
            run.ok(bool(p.wait(POST_JS, 40)) and bool(p.ev(SLATE_JS)), "%s: %s shows the victory slate with the online buttons" % (tag, p.name), "slate %s buttons %s" % (p.ev(SLATE_JS), p.ev(POST_JS)))
            p.shot("victory")
        # the stats hand-off ---------------------------------------------------------------------
        recA = A.ev("() => window.__DF_STATS__ ? window.__DF_STATS__.state().lastRecord : null") or {}
        recB = B.ev("() => window.__DF_STATS__ ? window.__DF_STATS__.state().lastRecord : null") or {}
        for nm, rec in (("A", recA), ("B", recB)):
            run.ok(rec.get("online") is True and rec.get("humans") == 2 and rec.get("mode") == "teams" and rec.get("rule") == "turf", "%s: %s's stats record is an online TEAMS TURF match with 2 humans" % (tag, nm), json.dumps({k: rec.get(k) for k in ("online", "humans", "mode", "rule", "result", "place", "turfPct", "paintedM2", "washes", "liveS", "eligible", "score", "kit", "skill", "endedBy")}))
            run.ok(rec.get("eligible") is True and (rec.get("score") or 0) > 0, "%s: %s's record is eligible and scored (>= 60 s seated, painted >= 100 m2)" % (tag, nm), "liveS %s paintedM2 %s score %s" % (rec.get("liveS"), rec.get("paintedM2"), rec.get("score")))
        run.ok(recA.get("result") in ("win", "loss", "draw") and recB.get("result") in ("win", "loss", "draw"), "%s: both records carry a W / L / D" % tag, "A %s B %s (winner %s; A crew %s, B crew %s)" % (recA.get("result"), recB.get("result"), rA.get("winner"), (a_last or {}).get("me", {}).get("team"), (b_last or {}).get("me", {}).get("team")))
        if a_last and b_last and rA.get("winner") is not None:
            tA, tB = a_last["me"]["team"], b_last["me"]["team"]
            exp = lambda t: "draw" if rA["winner"] == 0 else ("win" if rA["winner"] == t else "loss")
            run.ok(recA.get("result") == exp(tA) and recB.get("result") == exp(tB), "%s: each record's W / L / D matches its own crew's result" % tag, "A crew %s -> %s (want %s); B crew %s -> %s (want %s)" % (tA, recA.get("result"), exp(tA), tB, recB.get("result"), exp(tB)))
        # the portal stand-in: the exact contracted postMessages from page A
        time.sleep(5)
        port = A.portal_page
        msgs = port.evaluate("() => window.__MSGS__ || []") if port else []
        P = port.evaluate("() => window.__PORTAL__") if port else {}
        types = [m["type"] for m in msgs]
        run.info("portal messages A", {"types": types, "ach": P.get("ach"), "scores": P.get("scores"), "loads": P.get("loads")})
        run.ok("forgeflow:load" in types, "%s: the game asked the portal for the career (forgeflow:load) on boot" % tag, json.dumps(types[:6]))
        run.ok(len(P.get("scores") or []) == 1 and (P["scores"][0] or 0) > 0, "%s: exactly ONE forgeflow:score for the online match, > 0 (the weekly board)" % tag, "scores %s (record score %s)" % (P.get("scores"), recA.get("score")))
        if P.get("scores"):
            run.ok(abs(P["scores"][0] - (recA.get("score") or -1)) <= 1, "%s: the posted score equals the record's score" % tag, "%s vs %s" % (P["scores"][0], recA.get("score")))
        ach = set(P.get("ach") or [])
        run.ok({"first_match", "online_first"} <= ach, "%s: forgeflow:achievement posted first_match and online_first (the online-only 'Open Water')" % tag, json.dumps(sorted(ach)))
        run.ok(all(isinstance(m.get("slug"), str) for m in msgs if m["type"] == "forgeflow:achievement") and len([m for m in msgs if m["type"] == "forgeflow:achievement"]) == len(ach), "%s: every achievement was posted once" % tag, "%d posts for %d slugs" % (len([m for m in msgs if m["type"] == "forgeflow:achievement"]), len(ach)))
        saves = [m for m in msgs if m["type"] == "forgeflow:save"]
        run.ok(len(saves) >= 1 and saves[-1].get("slot") == 1 and (saves[-1].get("data") or {}).get("game") == "dyefield", "%s: a forgeflow:save to slot 1 with the career record followed" % tag, "%d saves; last data keys %s" % (len(saves), list((saves[-1].get("data") or {}).keys()) if saves else None))
        if saves:
            d = saves[-1]["data"]
            sl = list((d.get("slots") or {}).values())
            c = (sl[0] if sl else {}).get("c") or {}
            run.ok(((c.get("online") or {}).get("w", 0) + (c.get("online") or {}).get("l", 0) + (c.get("online") or {}).get("d", 0)) == 1 and c.get("matches") == 1, "%s: the saved career counts 1 match and 1 online W / L / D" % tag, json.dumps({"matches": c.get("matches"), "online": c.get("online")}))
        # career panel + achievement toast (screens)
        A.shot("toast_after_match")
        tst = A.ev("() => window.__DF_STATS__ ? window.__DF_STATS__.toast() : null")
        run.info("toast A", tst)
        # rates (E) ---------------------------------------------------------------------------------
        t0m = t_live
        for p in peers:
            if p.meter:
                role = "client" if (A if p is A else B) and (stA if p is A else stB).get("role") == "client" else "host"
                rep = frame_report(run, p, *stream_window(p, role))
                check_budget(run, tag, p, rep, role)
        # the relay's counted raw vs the page-side frame totals (every frame a page sent is one incoming message at the relay)
        time.sleep(1.5)
        health1 = run.relay_get("/health")
        d_raw = (health1.get("raw") or 0) - (health0.get("raw") or 0)
        sent_all, pings = frames_sent(peers)
        sent = sent_all - pings
        run.info("relay raw", {"delta": d_raw, "dataFramesSentByPages": sent, "pingFramesSentByPages": pings, "units": health1.get("units"), "mode": health1.get("mode")})
        run.ok(sent > 0 and d_raw >= sent * 0.98 and abs(d_raw - sent_all) <= max(60, 0.04 * sent_all), "%s: the relay's counted raw reconciles with the frames the two pages sent (+ estimated pings / connections / RPCs)" % tag, "relay +%d raw vs %d frames sent by the pages (%d data + %d pings): %+.1f %%" % (d_raw, sent_all, sent, pings, 100 * (d_raw - sent_all) / max(1, sent_all)))
        live_s = (t_end - 3) - (t_live + 5)
        exp = 41.4 * (live_s + 3)
        run.ok(abs(d_raw - exp) <= 0.25 * exp, "%s: the raw count is within 25 %% of CONTRACT_ONLINE O9.2's 2-human rate (41.4 incoming msgs/s)" % tag, "relay +%d raw over ~%.0f s live vs %.0f expected (%+.1f %%); includes the lobby / load phase" % (d_raw, live_s + 3, exp, 100 * (d_raw - exp) / max(1, exp)))
        # the CAREER screen on page B (standalone): LEAVE the room, BACK out of PLAY ONLINE, the title's CAREER pill
        run.ok(B.press("#dfo-post-leave") and bool(B.wait_screen("home", 90)), "%s: B LEAVE -> the PLAY ONLINE home" % tag, str(B.screen()))
        B.press(".dfo-s-home .dfm-back")
        MENU_IS = "(n) => { const m = window.__DF__ && window.__DF__.menu(); return m && m.screen === n ? true : null; }"
        run.ok(bool(B.wait("() => (%s)('title')" % MENU_IS, 30)), "%s: BACK from PLAY ONLINE -> the title" % tag, str((B.ev("() => window.__DF__.menu()") or {}).get("screen")))
        B.press("#dfm-career")
        run.ok(bool(B.wait("() => (%s)('career')" % MENU_IS, 15)), "%s: the title's CAREER pill opens the CAREER screen" % tag, str((B.ev("() => window.__DF__.menu()") or {}).get("screen")))
        time.sleep(0.8)
        B.shot("career")
        B.ev("() => document.querySelector('#dfc-career') && document.querySelector('#dfc-career').scrollTo(0, 0)")
        tiles = B.ev("() => [...document.querySelectorAll('#dfc-career .dfc-tile b')].map((e) => e.textContent)")
        online_line = B.ev("() => { const e = document.querySelector('#dfc-career .dfc-online'); return e ? e.textContent : null; }")
        run.info("career B", {"tiles": tiles, "online": online_line})
        run.ok(bool(tiles) and tiles[0] != "0", "%s: the CAREER panel shows the online match (matches > 0)" % tag, json.dumps({"tiles": tiles, "online": online_line}))
        A.shot("career_or_title")
        page_errors_ok(run, peers, tag)
    finally:
        for p in peers:
            p.close()


# ───────────────────────────── code rooms (B, C) ─────────────────────────────
def members_connected(p, n, timeout_s=40):
    return p.wait("() => { const s = window.__NET__ && window.__NET__.status(); return s && s.kind === 'room' && s.room.members.filter((m) => m.conn).length === %d ? true : null; }" % n, timeout_s)


def room_code_of(p):
    return p.room_code()


def make_room(run, tag, host, joiners, mode, rule, map_id=None):
    """CREATE ROOM / JOIN ROOM by the real screens (clicks, a typed code, or touch taps on the keypad), then START by the owner"""
    host.pick(mode, rule)
    run.ok(host.press("#dfo-door-create") and bool(host.wait_screen("room", 60)), "%s: %s CREATE ROOM by a click -> the room screen" % (tag, host.name), str(host.screen()))
    code = host.room_code()
    run.ok(len(code) == 4, "%s: the room screen shows a 4-character code" % tag, repr(code))
    room_map = lambda: host.ev("() => { const s = window.__NET__.status(); return s.kind === 'room' ? s.room.map : null; }")

    def pick_map():
        if not map_id:
            return True
        for _ in range(6):
            if room_map() == map_id:
                return True
            host.press("#dfo-rmap-%s" % map_id)
            time.sleep(2.5)
        return room_map() == map_id
    pick_map()
    for j in joiners:
        ok = j.press("#dfo-door-join") and bool(j.wait_screen("join", 30))
        j.type_code(code)
        time.sleep(0.3)
        ok = ok and j.press("#dfo-join-go") and bool(j.wait_screen("room", 60))
        if not ok:
            run.ok(False, "%s: %s JOIN ROOM %s" % (tag, j.name, code), "screen %s" % j.screen())
            return None
    n = 1 + len(joiners)
    run.ok(bool(members_connected(host, n)), "%s: the room lists %d connected humans" % (tag, n), json.dumps(host.ev("() => { const s = window.__NET__.status(); return s.kind === 'room' ? s.room.members.map((m) => [m.name, m.device, m.conn]) : s.kind; }")))
    for p in [host] + joiners:
        run.ok(room_code_of(p) == code, "%s: %s's room screen shows the same code" % (tag, p.name), "%s / %s" % (room_code_of(p), code))
    if map_id:
        # the owner's pick must reach the room (the relay applies it and echoes it on `members.room`; net/api.ts merges it)
        run.ok(pick_map(), "%s: the owner's arena pick (%s) is in the room before START" % (tag, map_id), str(room_map()))
    host.shot("room_full")
    joiners[-1].shot("room_full")
    for p in [host] + joiners:
        if getattr(p, "throttle_rate", 1) != 1:
            p.throttle(1)                                   # un-park every page: the arenas load now
    run.ok(host.press("#dfo-start"), "%s: the owner presses START" % tag, "")
    return code


def bring_live(run, tag, peers, timeout_s=900):
    """every page to a live match, clicking CLICK TO PLAY like a player. Progress is printed every 30 s (a page's phase / tick / fps:
    a loaded box makes 8 arena loads slow; a page whose sim tick stops advancing for 120 s is a real stall)"""
    t0 = time.time()
    pending = list(peers)
    out = {}
    last_print = 0.0
    while pending and time.time() - t0 < timeout_s:
        for p in list(pending):
            p.play_gate()
            s = p.snap()
            if s and s.get("mphase") == "live" and s.get("role"):
                out[p.name] = s
                pending.remove(p)
        if time.time() - last_print > 30:
            last_print = time.time()
            print("   .. %.0f s: live %s | pending %s" % (time.time() - t0, sorted(out), {p.name: (lambda s: (s.get("phase"), s.get("mphase"), s.get("tick"), s.get("fps")) if s else None)(p.ev(SNAP_JS)) for p in pending}), flush=True)
        time.sleep(0.5)
    run.ok(not pending, "%s: every page reaches a LIVE online match (loaded, CLICK TO PLAY)" % tag, "after %.0f s; waiting on %s" % (time.time() - t0, [p.name for p in pending]))
    if pending:
        for p in pending:
            p.shot("stuck")
    return out


def agreement(run, tag, peers, stats_list, exclude_desync=()):
    hs = next((s for s in stats_list if s.get("role") == "host"), stats_list[0])
    hh = hs.get("painterHash")
    run.ok(all(s.get("ended") == "complete" for s in stats_list), "%s: every page saw the match complete" % tag, " ".join("%s:%s" % (p.name, s.get("ended")) for p, s in zip(peers, stats_list)))
    run.ok(hh is not None and all(s.get("painterHash") == hh for s in stats_list), "%s: the same final painter hash on every page" % tag, " ".join("%s %s" % (p.name, s.get("painterHash")) for p, s in zip(peers, stats_list)))
    hr = hs.get("result") or {}
    same = bool(hr)
    for s in stats_list:
        r = s.get("result") or {}
        a, b = r.get("shares") or [0], hr.get("shares") or [0]
        md = max([abs((a[k] if k < len(a) else 0) - (b[k] if k < len(b) else 0)) for k in range(max(len(a), len(b)))])
        same = same and r.get("winner") == hr.get("winner") and md <= 1e-9
    run.ok(same, "%s: the same end.result on every page (winner, shares to 1e-9)" % tag, "winner %s shares %s" % (hr.get("winner"), [round(x, 4) for x in (hr.get("shares") or [])]))
    desy = [(p.name, (s.get("client") or {}).get("desyncs")) for p, s in zip(peers, stats_list) if s.get("client") and p.name not in exclude_desync]
    run.ok(all(d == 0 for _, d in desy), "%s: 0 desyncs on every client" % tag, json.dumps(desy))
    return hs


def scenario_b(run):
    tag = "B 8 humans"
    run.scenario("B", "8 humans, CREATE / JOIN ROOM, FFA WASHOUT on LOCKWELL, 7 desktop + 1 phone (touch, throttled), reconnect, rates")
    netdur = run.args.netdur
    rfps = run.args.renderfps
    kits = ["mist-rasp", "sheet-drum", "needle-glint", "pop-well", "mist-rasp", "sheet-drum", "needle-glint"]
    peers = []
    ph = None
    health0 = run.relay_get("/health")
    try:
        t0 = time.time()
        # STAGED loading: one page at a time to PLAY ONLINE (8 simultaneous arena builds + shader compiles on a box other sessions
        # already saturate took minutes per page)
        for i in range(7):
            # the unobserved pages are small and low quality; D0 (the owner) is the observed, full-quality, screenshot page
            small = i >= 1
            pg = Peer(run, "D%d" % i, run.url(netdur=netdur, renderfps=rfps, quality="low" if small else None), run.profile("Desk%d" % i, kits[i], "ffa", "washout", color=i + 1),
                      viewport=tuple(run.args.small) if small else (960, 540))
            peers.append(pg)
            if not run.ok(pg.open_online(600), "%s: %s opens PLAY ONLINE" % (tag, pg.name), "%s after %.0f s" % (pg.screen(), time.time() - t0)):
                return
            if i >= 1 and run.args.park > 1:
                pg.throttle(run.args.park)
        ph = Peer(run, "PH", run.url(netdur=netdur, renderfps=max(rfps, 6)), run.profile("Phone", "sheet-drum", "ffa", "washout", color=8), viewport=PHONE_VIEW, touch=True)
        peers.append(ph)
        if not run.ok(ph.open_online(600), "%s: PH opens PLAY ONLINE" % tag, "%s after %.0f s" % (ph.screen(), time.time() - t0)):
            return
        if run.args.park > 1:
            ph.throttle(run.args.park)
        run.info("pages", "8 pages loaded to PLAY ONLINE in %.0f s" % (time.time() - t0))
        peers[0].shot("lobby_home")
        ph.shot("lobby_home")
        host = peers[0]
        code = make_room(run, tag, host, peers[1:], "ffa", "washout", "lockwell")
        if not code:
            return
        ph.shot("room_joined")
        run.ok(host.ev("() => window.__NET__.status().room.mode") == "ffa" and host.ev("() => window.__NET__.status().room.rule") == "washout" and host.ev("() => window.__NET__.status().room.map") == "lockwell",
               "%s: the room is FFA WASHOUT on LOCKWELL (the owner's picks)" % tag, json.dumps(host.ev("() => { const r = window.__NET__.status().room; return [r.mode, r.rule, r.map]; }")))
        lives = bring_live(run, tag, peers)
        if len(lives) < 8:
            return
        for p in peers[:-1]:
            hand(p)
        hand(ph, run.args.phone_throttle)                   # the phone's CPU throttle starts only now: loading the module itself under it takes minutes on a loaded box
        ph.snap_every = 6.0                                 # (its main thread is the slowest: every call on it can block for seconds; the desktops are driven at full cadence)
        roles = {n: s["role"] for n, s in lives.items()}
        run.ok(list(roles.values()).count("host") == 1 and roles["PH"] == "client", "%s: one host, and it is a desktop (not the phone)" % tag, json.dumps(roles))
        pids = {n: s["pid"] for n, s in lives.items()}
        run.ok(len(set(pids.values())) == 8, "%s: 8 humans hold 8 different runners" % tag, json.dumps(pids))
        run.ok(all(s["mode"] == "ffa" and s["rule"] == "washout" for s in lives.values()), "%s: FFA WASHOUT on every page" % tag, "")
        t_live = time.time()
        pp_vis = {"v": None}
        trace = {"moved": {p.name: 0.0 for p in peers}, "last": {}, "paint": {}, "samples": 0, "fps": {p.name: [] for p in peers}}
        drop = {"done": False, "name": None, "t": None, "back": None, "before": None, "after": None}

        def sample(sn):
            now = time.time() - t_live
            trace["samples"] += 1
            for p in peers:
                s = sn.get(p.name)
                if not s or not s.get("me") or s.get("mphase") != "live":
                    continue
                pos = (s["me"]["x"], s["me"]["z"])
                if p.name in trace["last"]:
                    trace["moved"][p.name] += math.dist(pos, trace["last"][p.name])
                trace["last"][p.name] = pos
                if s.get("runners") and s.get("pid") is not None and s["pid"] < len(s["runners"]):
                    trace["paint"][p.name] = s["runners"][s["pid"]][3]
                if s.get("fps"):
                    trace["fps"][p.name].append(s["fps"])
            if pp_vis["v"] is None and now >= 8:
                pp_vis["v"] = ph.ev("() => { const r = document.getElementById('df-touch'); return !!r && getComputedStyle(r).display !== 'none'; }")
                shot_p = next((p for p in peers[:-1] if sn.get(p.name) and sn[p.name].get("role") == "client"), peers[0])
                shot_p.shot("match")                      # (a screenshot stalls its page for seconds: a CLIENT's, never the host's: a stalled host migrates)
            if not drop["done"] and now >= 25:
                drop["done"] = True
                cand = next((p for p in peers[1:-1] if sn.get(p.name) and sn[p.name].get("role") == "client"), None)
                if cand is not None:
                    drop["name"] = cand.name
                    drop["before"] = cand.net_stats()
                    cand.ev("() => window.__NET__.dropSocket()")
                    drop["t"] = time.time()
                    drop["cand"] = cand
                    # the reconnect is timed in a tight loop (the play loop's own cycle is far slower than 5 s when a page is starved)
                    JS = "() => { const a = window.__NET__.api, s = a.session; return { status: a.status().kind, slot: a.mySlot, pid: s ? s.localPid : null, kf: s && s.client ? s.client.stats.keyframes : null }; }"
                    kf0 = ((drop["before"] or {}).get("client") or {}).get("keyframes") or 0
                    while time.time() - drop["t"] < 30:
                        st_ = cand.ev(JS)
                        if st_ and st_.get("status") == "room" and (st_.get("kf") or 0) > kf0:
                            drop["back"] = time.time() - drop["t"]
                            drop["after"] = st_
                            break
                        time.sleep(0.05)

        first_end = {"t": None, "h": None, "th": None}

        def done(sn):
            if first_end["t"] is None and any(sn.get(p.name) and (sn[p.name].get("ended") or sn[p.name].get("victory")) for p in peers):
                first_end["t"] = time.time()
            if first_end["t"] and first_end["h"] is None and time.time() - first_end["t"] >= 8:
                first_end["h"] = run.relay_get("/health")          # the relay's counters just after the match settled (the slow phone's tail comes later)
                first_end["th"] = time.time()
            return all(sn.get(p.name) and (sn[p.name].get("ended") or sn[p.name].get("victory")) for p in peers)

        snaps, finished = play_loop(peers, done, netdur * 2.5 + 240, sample=sample, every=0.2)
        t_end = first_end["t"] or time.time()
        run.info("play loop", {"wallS": round(time.time() - t_live, 1), "firstEndAfterS": round(t_end - t_live, 1), "cycleS": CYCLE})
        for p in peers:
            if p.drv:
                p.drv.release()
        run.ok(finished, "%s: the match reached the horn on all 8 pages" % tag, "%.0f s after live (netdur %d)" % (t_end - t_live, netdur))
        # a slow page (the phone under CPU throttling) is still draining the host's last SNAPs / the `end`: give stragglers time
        t_w = time.time()
        while time.time() - t_w < 300 and not all((p.net_stats().get("ended")) for p in peers):
            time.sleep(2)
        time.sleep(3)
        run.ok(bool(pp_vis["v"]), "%s: the phone's touch overlay is visible during play" % tag, str(pp_vis["v"]))
        run.info("moved (m, own position as sampled)", {k: round(v) for k, v in trace["moved"].items()})
        run.info("paint (m2, own, last sample)", {k: round(v) for k, v in trace["paint"].items()})
        run.info("fps median", {k: round(median(v), 1) for k, v in trace["fps"].items()})
        sts = [p.net_stats() for p in peers]
        # D: the dropped client
        run.ok(drop["name"] is not None and drop["back"] is not None and drop["back"] <= 6.0, "%s D: the client whose socket was dropped (%s) is back with a keyframe within 5 s" % (tag, drop["name"]), "%s s" % (round(drop["back"], 2) if drop["back"] is not None else None))
        if drop["after"] and drop["before"]:
            run.ok(drop["after"].get("slot") == drop["before"].get("slot") and drop["after"].get("pid") == drop["before"].get("localPid"), "%s D: the same seat after the reconnect" % tag, "slot %s -> %s, runner %s -> %s" % (drop["before"].get("slot"), drop["after"].get("slot"), drop["before"].get("localPid"), drop["after"].get("pid")))
        hs = agreement(run, tag, peers, sts, exclude_desync=(drop["name"],) if drop["name"] else ())
        h = hs.get("host") or {}
        rep = h.get("seatReport") or []
        humans = [r for r in rep if r.get("human") and r.get("liveTicks", 0) > 600]
        run.ok(len(humans) >= 8 and all(r["movedM"] >= 30 and r["painted"] > 0 for r in humans), "%s: all 8 human runners moved >= 30 m and painted > 0 (host's seat report)" % tag, " ".join("r%s:%sm/%s" % (r.get("runner"), r.get("movedM"), round(r.get("painted", 0))) for r in rep))
        ht = h.get("humanTicks") or []
        eight = ht[8] if len(ht) > 8 else 0
        run.ok(eight >= 45 * 60, "%s: the host had 8 seated humans at once for >= 45 s" % tag, "%.1f s at 8 (humanTicks %s)" % (eight / 60, ht))
        rates = h.get("intentRates") or []
        ph_slot = (sts[-1] or {}).get("slot")
        run.ok(len(rates) == 7, "%s: the host tracks INTENTS from all 7 remote humans" % tag, "%d rates" % len(rates))
        run.ok(all(r.get("hz", 0) >= 15 for r in rates if r.get("slot") != ph_slot), "%s: every remote DESKTOP human's INTENTS reach the host at >= 15 Hz (median)" % tag, " ".join("%s:%.1fHz" % (r.get("slot"), r.get("hz", 0)) for r in rates if r.get("slot") != ph_slot))
        ph_r = [r for r in rates if r.get("slot") == ph_slot]
        run.ok(bool(ph_r) and ph_r[0].get("hz", 0) >= 15, "%s: the PHONE's INTENTS reach the host at >= 15 Hz (median) at %gx CPU throttle (CONTRACT_ONLINE O9.5 phone profile; box load decides: re-run before judging)" % (tag, run.args.phone_throttle), "slot %s: %s Hz; phone page fps median %s" % (ph_slot, round(ph_r[0].get("hz", 0), 1) if ph_r else None, round(median(trace["fps"].get("PH", [0])), 1)))
        run.info("host", {"hostTps": h.get("hostTps"), "tickMsP50": h.get("tickMsP50"), "maxGapMs": h.get("maxGapMs"), "stalls1s": h.get("stalls1s"), "underflows": h.get("underflows"), "queueDrops": h.get("queueDrops")})
        run.ok((h.get("hostTps") or 0) >= 55, "%s: the host held >= 55 sim ticks/s" % tag, "%s (a loaded box: confirm with a rerun before judging)" % h.get("hostTps"))
        # E: rates per client at 8 humans
        for p, s in zip(peers, sts):
            if p.meter:
                role_ = "client" if s.get("role") == "client" else "host"
                rep_ = frame_report(run, p, *stream_window(p, role_))
                check_budget(run, tag, p, rep_, role_)
        # the relay's counters were read right after the match settled (first end + 8 s); count only what the pages sent up to then
        health1 = first_end["h"] or run.relay_get("/health")
        t_h = first_end["th"] or time.time()
        d_raw = (health1.get("raw") or 0) - (health0.get("raw") or 0)
        sent_all, pings = frames_sent(peers, until=t_h)
        sent = sent_all - pings
        run.info("relay raw", {"delta": d_raw, "dataFramesSentByPages": sent, "pingFramesSentByPages": pings, "relayMinusPagesTotal": d_raw - sent_all, "units": health1.get("units")})
        run.ok(sent > 0 and d_raw >= sent * 0.98, "%s: the relay counted every data frame the 8 pages sent up to the settle (INTENTS / SNAP / control; pings are auto-responses the relay only estimates)" % tag, "relay +%d raw vs %d data frames (+%d pings sent by the pages): %+.1f %% on data" % (d_raw, sent, pings, 100 * (d_raw - sent) / max(1, sent)))
        run.info("relay ping estimate vs the pages' pings", {"pagesPings": pings, "relayEstimateOfPings": d_raw - sent, "underCountPct": round(100 * (pings - (d_raw - sent)) / max(1, pings), 1)})
        exp = 30700 * (netdur + 3) / 186.0
        run.ok(abs(d_raw - exp) <= 0.25 * exp, "%s: the raw count is within 25 %% of CONTRACT_ONLINE O9.2's 8-human row scaled to %d s (includes the lobby / load phase, a 1.6 s reconnect)" % (tag, netdur), "relay +%d vs %.0f expected (%+.1f %%)" % (d_raw, exp, 100 * (d_raw - exp) / max(1, exp)))
        # stats: every page's record
        recs = [p.ev("() => window.__DF_STATS__ ? window.__DF_STATS__.state().lastRecord : null") or {} for p in peers]
        run.ok(all(r.get("online") is True and r.get("humans") == 8 and r.get("mode") == "ffa" and r.get("rule") == "washout" for r in recs), "%s: every page's stats record is an online FFA WASHOUT match with 8 humans" % tag,
               " ".join("%s:%s/%s/%s" % (p.name, r.get("online"), r.get("humans"), r.get("result")) for p, r in zip(peers, recs)))
        run.ok(all(r.get("place") in range(1, 9) for r in recs) and sorted(r.get("place") for r in recs if r.get("place"))[0] == 1, "%s: the records carry FFA places 1..8 (someone is first)" % tag, " ".join("%s:%s" % (p.name, r.get("place")) for p, r in zip(peers, recs)))
        for p in (peers[0], ph):
            p.shot("victory")
        page_errors_ok(run, peers, tag)
    finally:
        for p in peers:
            p.close()


def scenario_c(run):
    tag = "C host leaves"
    run.scenario("C", "HOST LEAVES mid-match (3 humans, code room, TEAMS TURF): promotion, migration, survivors agree")
    netdur = max(60, run.args.netdur - 30)
    rfps = run.args.renderfps
    peers = [Peer(run, "H%d" % i, run.url(netdur=netdur, renderfps=rfps if i else None), run.profile("Host%d" % i, ["mist-rasp", "sheet-drum", "pop-well"][i], "teams", "turf", crew=1 if i == 0 else 2)) for i in range(3)]
    try:
        for p in peers:
            if not run.ok(p.open_online(240), "%s: %s opens PLAY ONLINE" % (tag, p.name), str(p.screen())):
                return
        code = make_room(run, tag, peers[0], peers[1:], "teams", "turf", None)
        if not code:
            return
        lives = bring_live(run, tag, peers)
        if len(lives) < 3:
            return
        for p in peers:
            hand(p)
        t_live = time.time()
        st = {"closed": None, "promote": None, "newhost": None}

        def sample(sn):
            now = time.time() - t_live
            if st["closed"] is None and now >= 25:
                hp = next((p for p in peers if sn.get(p.name) and sn[p.name].get("role") == "host"), None)
                if hp is None:
                    return
                st["closed"] = hp.name
                survivors = [p for p in peers if p is not hp]
                hp.close()
                t_c = time.time()
                newh = None
                while time.time() - t_c < 8 and not newh:
                    for p in survivors:
                        s = p.snap()
                        if s and s.get("role") == "host":
                            newh = p
                            break
                    time.sleep(0.1)
                st["promote"] = time.time() - t_c
                st["newhost"] = newh.name if newh else None

        survivors_of = lambda: [p for p in peers if not p.closed]
        done = lambda sn: st["closed"] is not None and all(sn.get(p.name) and (sn[p.name].get("ended") or sn[p.name].get("victory")) for p in survivors_of())
        snaps, finished = play_loop(peers, done, netdur * 2.5 + 240, sample=sample, every=0.25)
        for p in survivors_of():
            if p.drv:
                p.drv.release()
        run.ok(st["closed"] is not None, "%s: a host page was found and closed at ~25 s" % tag, str(st["closed"]))
        run.ok(st["newhost"] is not None and st["promote"] is not None and st["promote"] <= 3.5, "%s: a new host within 3 s of the host page closing (CONTRACT_ONLINE O6: abrupt <= 3 s)" % tag, "%s after %.2f s" % (st["newhost"], st["promote"] or -1))
        run.ok(finished, "%s: the match reached the horn on the survivors" % tag, "")
        time.sleep(3)
        sv = survivors_of()
        sts = [p.net_stats() for p in sv]
        run.ok(all(((s.get("session") or {}).get("migrations") or s.get("migrations") or 0) == 1 for s in sts), "%s: migrations is 1 on every survivor" % tag, json.dumps([(s.get("session") or {}).get("migrations") for s in sts]))
        agreement(run, tag, sv, sts)
        recs = [p.ev("() => window.__DF_STATS__ ? window.__DF_STATS__.state() : null") or {} for p in sv]
        run.ok(all((r.get("lastRecord") or {}).get("online") is True for r in recs), "%s: the survivors' records are online matches" % tag, " ".join("%s:%s" % (p.name, (r.get("lastRecord") or {}).get("online")) for p, r in zip(sv, recs)))
        run.ok(all(((r.get("display") or {}).get("counters") or {}).get("abandoned", 0) == 0 for r in recs), "%s: the migration produced no 'abandoned' record and no second record on the survivors" % tag,
               json.dumps([((r.get("display") or {}).get("counters") or {}).get("abandoned") for r in recs]))
        run.ok(all(((r.get("display") or {}).get("counters") or {}).get("matches", 0) == 1 for r in recs), "%s: each survivor has exactly 1 match in its career" % tag, json.dumps([((r.get("display") or {}).get("counters") or {}).get("matches") for r in recs]))
        for p in sv:
            p.shot("victory_after_migration")
        page_errors_ok(run, sv, tag)
    finally:
        for p in peers:
            p.close()


# ───────────────────────────── R: the HOST loads slower than its client (a race the first A run found) ─────────────────────────────
def scenario_r(run):
    tag = "R slow host load"
    run.scenario("R", "QUICK MATCH where the HOST page loads its arena more slowly than the client (the client's `loaded` reaches the host first)")
    A = Peer(run, "A", run.url(renderfps=None), run.profile("Alder", "mist-rasp", "teams", "turf"))
    B = Peer(run, "B", run.url(renderfps=None), run.profile("Birch", "sheet-drum", "teams", "turf"))
    peers = [A, B]
    try:
        for p in peers:
            run.ok(p.open_online(), "%s: %s opens PLAY ONLINE" % (tag, p.name), str(p.screen()))
            p.pick("teams", "turf")
        for p in peers:
            p.press("#dfo-door-qm")
        # the moment the Room assigns the match (both pages start loading), the HOST page is CPU-throttled: its arena load now takes
        # several times longer than the client's, so the client's `loaded` reaches a host that has no session yet
        STATUS = "() => { const a = window.__NET__ && window.__NET__.api; if (!a) return null; const s = a.status(); return s.kind === 'room' ? { phase: s.room.phase, host: s.room.hostSlot, my: s.room.mySlot } : null; }"
        t0, host_page = time.time(), None
        while time.time() - t0 < 240 and host_page is None:
            for p in peers:
                st = p.ev(STATUS)
                if st and st["phase"] in ("loading", "live") and st["host"] == st["my"]:
                    host_page = p
                    break
            time.sleep(0.05)
        run.ok(host_page is not None, "%s: the Room assigned a host" % tag, host_page.name if host_page else "no host seen")
        if host_page is None:
            return
        host_page.throttle(8)
        t_thr = time.time()
        live = {}
        t1 = time.time()
        while len(live) < 2 and time.time() - t1 < 420:
            for p in peers:
                p.play_gate()
                sn = p.snap()
                if sn and sn.get("mphase") == "live" and sn.get("role") and p.name not in live:
                    live[p.name] = sn
                    if p is host_page:
                        p.throttle(1)
                        run.info("host load time under 8x throttle (s)", round(time.time() - t_thr, 1))
            time.sleep(0.3)
        client_live_first = [n for n in live if n != host_page.name]
        run.ok(len(live) == 2, "%s: both pages reach a LIVE online match" % tag, json.dumps({n: s["role"] for n, s in live.items()}))
        if len(live) < 2:
            return
        host_page.throttle(1)
        for p in peers:
            hand(p)
        snaps, finished = play_loop(peers, lambda sn: all(sn.get(p.name) and (sn[p.name].get("ended") or sn[p.name].get("victory")) for p in peers), 75 + 240)
        for p in peers:
            p.drv.release()
        run.ok(finished, "%s: the match ran to the horn on both pages" % tag, "")
        time.sleep(3)
        sts = {p.name: p.net_stats() for p in peers}
        hst = next((s for s in sts.values() if s.get("role") == "host"), {})
        h = hst.get("host") or {}
        rep = h.get("seatReport") or []
        run.info("seats at the host", rep)
        run.ok(h.get("humans") == 2, "%s: the host sees BOTH humans as human-driven at the end (the late `loaded` was not lost)" % tag, "humans %s" % h.get("humans"))
        run.ok(len([r for r in rep if r.get("human")]) == 2 and all(r.get("movedM", 0) >= 20 for r in rep if r.get("human")), "%s: both human runners moved >= 20 m under their own players' input (the client's INTENTS were used)" % tag, json.dumps([(r.get("runner"), r.get("human"), r.get("movedM")) for r in rep if r.get("human")]))
        recs = {p.name: (p.ev(DF_STATS_JS) or {}).get("lastRecord") or {} for p in peers}
        run.ok(all(r.get("online") is True and r.get("humans") == 2 for r in recs.values()), "%s: both records are online matches with 2 humans" % tag, json.dumps({n: (r.get("online"), r.get("humans"), r.get("paintedM2")) for n, r in recs.items()}))
        hashes = {n: s.get("painterHash") for n, s in sts.items()}
        run.ok(len(set(hashes.values())) == 1 and None not in hashes.values(), "%s: the same final painter hash" % tag, json.dumps(hashes))
        page_errors_ok(run, peers, tag)
    finally:
        for p in peers:
            p.close()


# ───────────────────────────── T: the bot-tier picker reaches the bots (owner decision 6) ─────────────────────────────
TIERS_JS = """() => { const m = window.__DF__ && window.__DF__.match && window.__DF__.match(); return m && m.mode === 'match' ? { roster: m.rosterTiers, bots: m.botTiers, phase: m.phase } : null; }"""


def scenario_t(run):
    tag = "T bot tiers"
    run.scenario("T", "the BREEZE / SWELL / STORM picker reaches the bots in the real page (game.ts BotDirector skill fix)")
    for tier in ("breeze", "swell", "storm"):
        p = Peer(run, "T-" + tier, run.base + "?" + urllib.parse.urlencode({"dev": 1, "map": "pier18", "bots": tier, "autostart": 1, "matchSeconds": 20}), meter=False)
        try:
            got = p.wait(TIERS_JS, 240)
            want = [None] + [tier] * 7
            run.ok(bool(got) and got["roster"] == want and got["bots"] == want, "%s: deep link ?bots=%s: the 7 bots' brains play %s (human has none)" % (tag, tier, tier.upper()), json.dumps(got))
        finally:
            p.close()
    # the real menu: PLAY -> a tier button -> START
    for tier in ("storm", "breeze"):
        p = Peer(run, "T-menu-" + tier, run.base + "?dev=1", meter=False)
        try:
            MENU = "(n) => { const m = window.__DF__ && window.__DF__.menu(); return m && m.screen === n ? true : null; }"
            ok = bool(p.wait("() => (%s)('title')" % MENU, 240))
            ok = ok and p.click("#dfm-play") and bool(p.wait("() => (%s)('play')" % MENU, 20))
            ok = ok and p.click("#dfm-skill-%s" % tier) and p.click("#dfm-start")
            got = p.wait(TIERS_JS, 240) if ok else None
            want = [None] + [tier] * 7
            run.ok(bool(got) and got["roster"] == want and got["bots"] == want, "%s: menu PLAY -> %s -> START: the bots' brains play %s" % (tag, tier.upper(), tier.upper()), json.dumps(got))
            if tier == "storm":
                p.shot("tier_storm_match")
            page_errors_ok(run, [p], tag)
        finally:
            p.close()


# ───────────────────────────── main ─────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--headless", action="store_true", default=True)
    ap.add_argument("--soft", action="store_true", help="software GL (a GPU saturated by other sessions)")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT)
    ap.add_argument("--dist", default=None, help="serve this production build (`vite build --outDir <dir>`) with `vite preview` instead of the dev server: 8 pages load in seconds, and it is the bundle that ships")
    ap.add_argument("--scenarios", default="A,B,C,T")
    ap.add_argument("--phone-throttle", type=float, default=4.0)
    ap.add_argument("--netdur", type=int, default=100, help="B / C code-room match length (s)")
    ap.add_argument("--small", type=int, nargs=2, default=[320, 180], help="viewport of the unobserved desktop pages in B (software GL cost is ~ pixels; every page keeps rendering the lobby while the others load)")
    ap.add_argument("--host-stall-ms", type=int, default=0, help="HOST_STALL_MS of the local relay (0 = the relay's default 1500); B on a saturated box needs 4000")
    ap.add_argument("--park", type=float, default=1, help="CPU throttle of a page parked on the PLAY ONLINE screens (B): idle lobby sims otherwise starve the next page's load")
    ap.add_argument("--renderfps", type=float, default=4, help="the render rate of the unobserved pages (the sim and the net run every frame)")
    args = ap.parse_args()
    run = Run(args)
    code = 0
    try:
        run.start()
        for key in [s.strip().upper() for s in args.scenarios.split(",") if s.strip()]:
            try:
                fn = {"A": scenario_a, "B": scenario_b, "C": scenario_c, "T": scenario_t, "R": scenario_r}.get(key)
                if fn is None:
                    print("unknown scenario %s" % key)
                    continue
                fn(run)
            except Exception as e:
                tb = traceback.format_exc()
                print(tb)
                run.cur = run.cur or {"checks": [], "info": {}}
                run.ok(False, "scenario %s completed without an exception" % key, str(e)[:300])
        code = 1 if run.fails else 0
    except C.HarnessError as e:
        print("SETUP FAILURE: %s" % e)
        code = 2
    except Exception:
        traceback.print_exc()
        code = 2
    finally:
        try:
            os.makedirs(C.REPORTS, exist_ok=True)
            with open(os.path.join(C.REPORTS, "online.json"), "w", encoding="utf-8") as f:
                json.dump(run.report, f, indent=2, default=str)
        except Exception:
            pass
        run.stop()
    print("\n" + ("=" * 100))
    n_ok = sum(1 for s in run.report["scenarios"].values() for c in s["checks"] if c["pass"])
    n_all = sum(len(s["checks"]) for s in run.report["scenarios"].values())
    print("online.py: %d/%d checks pass" % (n_ok, n_all))
    for f in run.fails:
        print("FAILED: " + f)
    print("RESULT: " + ("OK" if code == 0 else "FAIL (%d)" % len(run.fails) if code == 1 else "SETUP FAILURE"))
    return code


if __name__ == "__main__":
    sys.exit(main())
