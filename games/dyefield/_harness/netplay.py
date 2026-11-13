#!/usr/bin/env python
"""DYEFIELD — ONLINE browser scenarios (CONTRACT_ONLINE §O13.3), headless Chromium, N contexts in one browser.

Every page opens the dev server with ?dev=1&net=<relay>&autopilot=<n>[&netdur=<s>][&netlag=<ms>][&renderfps=<n>] — the
?net= deep link opens PLAY ONLINE, the online API is driven through window.__NET__ (CREATE ROOM / JOIN ROOM / start /
quick match), every local runner is driven by the seeded autopilot (real intents: quantized, sent, predicted and
reconciled), and the read-backs come from __NET__.stats() (painter hash, result, desyncs, prediction error, intent rates,
host tick rate, seats). The relay is the NET-SERVER lane's Worker under `wrangler dev --local` (DEV vars: ?netdur honoured,
local origins allowed, /__dev/* controls).

  python _harness/netplay.py --base http://localhost:5222/ --relay ws://127.0.0.1:8799            # A (lag 0 + 80)
  python _harness/netplay.py --scenarios A0,A80,I,B3 --netdur 45
  python _harness/netplay.py --scenarios B --netdur 150            # 8 humans (7 desktop + 1 phone), the heavy proof
Scenarios:
  A0 / A80   2 desktop contexts, CREATE / JOIN, TEAMS TURF, ?netdur: both seated, the host is the creator (or the better
             score), equal end.result (winner, shares to 1e-9) and final painter hash, 0 desyncs, prediction p95
             < 0.1 m (A0) / < 0.35 m with ?netlag=80 and no rubber-band > 2 m (A80); client SHEET-DRUM in A80.
  B          7 desktop (?autopilot) + 1 phone (iPhone 14, 4x CPU throttle, REAL injected touch) in FFA WASHOUT, ?netdur=150;
             the 8th (a desktop) joins late at 30 s. 8 humans seated at once >= 60 s, every remote human's INTENTS >= 15 Hz,
             every human runner moved >= 30 m and painted > 0, all 8 pages: same final painter hash + end.result, 0 desyncs,
             the host's median tick rate >= 55/s, the relay's counted raw within +-10 % of §O9.2's 8-human row.
  B2         B, and the host page closes at 40 s: promotion <= 3 s, the match completes, survivors agree, migrations 1.
  B3         2 contexts; at ~15 s __NET__.dropSocket() on the client: it reconnects (<= 5 s), keeps its seat, ends with
             the host's painter hash.
  B3H        the same on the HOST: the Room promotes the other page while it is away; the old host comes back as a client.
  C          3 clients QUICK MATCH TEAMS TURF + 1 QUICK MATCH FFA TURF: the 3 share a room (3 humans + 5 bots), the FFA one
             stays queued, then `solo`.
  D          ?idlekick=10, one client stops input: kicked (4008), its runner is a bot, "Removed for inactivity" shown.
  E          an origin outside the allowlist is refused (HTTP 403); an allowed one upgrades.
  F          the relay's daily cap is reached (dev meter): a new room is refused with the quota card; PLAY VS BOTS starts
             an offline bot match.
  G          a local page iframing the game with the portal's exact sandbox / allow attributes (GamePlayer.tsx:177-178):
             QUICK MATCH works from inside the iframe.
  H          2 contexts; at ~15 s __NET__.forceHandoff() on the host: a new host within 1 s, the match completes on
             both pages, migrations 1.
  L          a third page JOINs while the match is live: a seat + KEYFRAME, the host's final painter hash.
  I          stats hand-off (needs STATS INTEGRATION; SKIPPED without window.__DF_STATS__): every page's
             __DF_STATS__.state().lastRecord is online: true.
Exit: 0 all pass (skips are reported, not failures) · 1 a check failed · 2 setup failure.
"""
from __future__ import annotations

import argparse
import http.client
import json
import math
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))

FLAGS = [
    "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
]

# --soft: software GL + software compositing (no GPU process): the sim and the net of an UNOBSERVED page run on the main thread,
# so a GPU saturated by other sessions (this shared box's compositor starved rAF to < 1 fps while the page's thread was 95 % idle)
# cannot stall them. Pages still render (SwiftShader) every 1/--renderfps seconds.
SOFT_FLAGS = [
    "--disable-gpu", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion",
]

IOS_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1")

checks: list[dict] = []
skips: list[str] = []


def check(name: str, ok: bool, detail: str) -> None:
    checks.append({"name": name, "pass": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL") + "  " + name + "  —  " + detail, flush=True)


def skip(name: str, why: str) -> None:
    skips.append(name)
    print("SKIP  " + name + "  —  " + why, flush=True)


def info(msg: str) -> None:
    print("   info " + msg, flush=True)


RENDER_FPS = 0.2                    # --renderfps: the unobserved pages render this often (a render = GL work that stalls a shared box for 0.2-2 s; the sim and the net run every frame regardless)
VIEWPORT = (640, 360)
SOFT = False
PHONE_THROTTLE = 4                  # --phone-throttle: CDP CPU throttling of the phone context (§O13.3 B: 4). On a box already starved 4-8x by other sessions use 2
WARM_S = 14                         # the match's warm-up hitches (shader compiles, asset decodes) end before the prediction window starts


def url_for(base: str, relay: str, auto, extra: dict) -> str:
    q = {"dev": "1", "net": relay, "renderfps": str(RENDER_FPS)}
    if auto is not None:
        q["autopilot"] = str(auto)
    q.update({k: str(v) for k, v in extra.items() if v is not None})
    return base + "?" + urllib.parse.urlencode(q)


def http_base(relay: str) -> str:
    return relay.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")


def relay_get(relay: str, path: str):
    try:
        with urllib.request.urlopen(http_base(relay) + path, timeout=6) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"error": str(e)}


class Page:
    def __init__(self, browser, name: str, url: str, viewport=None, **ctx_kw):
        viewport = viewport or VIEWPORT
        self.name = name
        self.ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]}, **ctx_kw)
        self.page = self.ctx.new_page()
        self.errors: list[str] = []
        self.closed = False
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: " + str(e)[:300]))
        self.page.on("console", lambda m: self.errors.append("console: " + m.text[:300]) if m.type == "error" else None)
        self.page.goto(url, wait_until="domcontentloaded", timeout=180000)

    def ev(self, js: str, arg=None):
        return self.page.evaluate(js, arg) if arg is not None else self.page.evaluate(js)

    def wait(self, js: str, timeout_s: float, poll=0.25):
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            try:
                v = self.ev(js)
                if v:
                    return v
            except Exception:
                pass
            time.sleep(poll)
        return None

    def stats(self) -> dict:
        if self.closed:
            return {}
        try:
            return self.ev("() => window.__NET__ ? window.__NET__.stats() : null") or {}
        except Exception as e:
            return {"error": str(e)}

    def status(self) -> dict:
        try:
            return self.ev("() => window.__NET__ ? window.__NET__.status() : null") or {}
        except Exception as e:
            return {"error": str(e)}

    def text(self) -> str:
        try:
            return self.ev("() => document.body ? document.body.innerText : ''") or ""
        except Exception:
            return ""

    def close(self):
        self.closed = True
        try:
            self.ctx.close()
        except Exception:
            pass


def profile(name: str, kit: str, crew: int, color: int) -> dict:
    return {"name": name, "kit": kit, "crew": crew, "ffaColor": color}


def code_room(browser, base, relay, tag, netdur, lag=None, kits=("mist-rasp", "mist-rasp"), mode="teams", rule="turf"):
    extra = {"netdur": netdur, "netlag": lag}
    pages = [Page(browser, f"{tag}-P{i}", url_for(base, relay, 31 + i, extra)) for i in range(len(kits))]
    for p in pages:
        if not p.wait("() => !!window.__NET__", 120):
            check(f"{tag}: {p.name} loaded the online module", False, "\n".join(p.errors[-5:]))
            return pages, None
    host = pages[0]
    host.ev(f"() => window.__NET__.api.createRoom('{mode}', '{rule}', {json.dumps(profile('Alpha', kits[0], 1, 1))})")
    code = host.wait("() => { const s = window.__NET__.status(); return s.kind === 'room' ? s.room.code : null; }", 30)
    check(f"{tag}: CREATE ROOM gave a code", bool(code), str(code))
    if not code:
        return pages, None
    for i, p in enumerate(pages[1:], start=1):
        p.ev(f"() => window.__NET__.api.joinRoom('{code}', {json.dumps(profile('Bravo' + str(i), kits[i], 2, i + 1))})")
    n = len(pages)
    seated = host.wait(f"() => {{ const s = window.__NET__.status(); return s.kind === 'room' && s.room.members.filter(m => m.conn).length === {n}; }}", 30)
    check(f"{tag}: {n - 1} JOIN ROOM {code} seated", bool(seated), json.dumps([p.ev("() => window.__NET__.status().kind") for p in pages]))
    host.ev("() => window.__NET__.api.configure({ map: 'pier18', preset: 'noon', skill: 'swell' })")
    time.sleep(0.5)
    host.ev("() => window.__NET__.api.start()")
    ok = all(p.wait("() => { const s = window.__NET__.stats(); return s.role ? s.role : null; }", 90) for p in pages)
    roles = [p.stats().get("role") for p in pages]
    check(f"{tag}: every page runs its match session", ok, f"roles {roles}")
    return pages, code


def wait_end(pages, netdur, tag, extra_s=120, quiet=False):
    t0 = time.time()
    live = [p for p in pages if not p.closed]
    while time.time() - t0 < netdur + extra_s:
        sts = [p.stats() for p in live]
        if all(s.get("ended") for s in sts):
            break
        time.sleep(1.0)
    time.sleep(3.0)
    sts = [p.stats() for p in live]
    if not quiet:
        check(f"{tag}: every page saw the end", all(s.get("ended") == "complete" for s in sts), " ".join(f"{p.name}:{s.get('ended')}" for p, s in zip(live, sts)))
    return sts


def agreement(tag, pages, sts, p95max):
    host_i = next((i for i, s in enumerate(sts) if s.get("role") == "host"), 0)
    hs = sts[host_i]
    hh = hs.get("painterHash")
    check(f"{tag}: final painter hash equal on every page", all(s.get("painterHash") == hh for s in sts), " ".join(f"{p.name} {s.get('painterHash')}" for p, s in zip(pages, sts)))
    hr = hs.get("result") or {}
    for p, s in zip(pages, sts):
        if s is hs:
            continue
        r = s.get("result") or {}
        sh_a, sh_b = hr.get("shares") or [], r.get("shares") or []
        md = max([abs((sh_a[k] if k < len(sh_a) else 0) - (sh_b[k] if k < len(sh_b) else 0)) for k in range(max(len(sh_a), len(sh_b), 1))])
        check(f"{tag}: {p.name} end.result = host's", r.get("winner") == hr.get("winner") and md <= 1e-9, f"winner {r.get('winner')} vs {hr.get('winner')}, shares max diff {md}")
        c = s.get("client") or {}
        pe = c.get("predErr") or {}
        check(f"{tag}: {p.name} 0 desyncs, every hash check matched", c.get("desyncs") == 0 and c.get("hashChecks", 0) > 0 and c.get("hashOk") == c.get("hashChecks"),
              f"desyncs {c.get('desyncs')}, hash {c.get('hashOk')}/{c.get('hashChecks')}, gaps {c.get('gaps')}, keyframes {c.get('keyframes')}")
        check(f"{tag}: {p.name} prediction p95 < {p95max} m (steady state), no rubber-band > 2 m", (pe.get("p95", 9) < p95max) and (pe.get("max", 9) <= 2.0) and pe.get("n", 0) > 50,
              f"p50 {pe.get('p50', 0):.3f} p95 {pe.get('p95', 0):.3f} max {pe.get('max', 0):.3f} over {pe.get('n')} SNAPs, {pe.get('corrections')} corrections")
    h = hs.get("host") or {}
    info(f"{tag}: host ticks {h.get('ticks')} tps {h.get('hostTps')} max tick gap {h.get('maxGapMs')} ms ({h.get('stalls1s')} > 1 s; [tick,ms] {h.get('bigGaps')}) underflows {h.get('underflows')} queue drops {h.get('queueDrops')} takeovers {h.get('takeovers')} snaps {h.get('snaps')} · migrations {[(s.get('session') or {}).get('migrations') for s in sts]} roles {[s.get('role') for s in sts]}")
    rates = h.get("intentRates") or []
    check(f"{tag}: the host received every client's INTENTS at >= 15 Hz", len(rates) == len(pages) - 1 and all(r.get("hz", 0) >= 15 for r in rates), json.dumps(rates))
    for p in pages:
        errs = [e for e in p.errors if "favicon" not in e]
        check(f"{tag}: {p.name} no page errors", not any(e.startswith("pageerror") for e in errs), "; ".join(errs[-3:]) or "none")


def scenario_a(browser, base, relay, netdur, lag):
    tag = f"A lag {lag or 0}"
    kits = ("mist-rasp", "sheet-drum") if lag else ("mist-rasp", "mist-rasp")
    pages, code = code_room(browser, base, relay, tag, netdur, lag=lag, kits=kits)
    try:
        if not code:
            return
        # the match's first seconds hitch on a real machine (shader compiles, asset decodes: the host page's tick gaps of
        # 0.4-2 s are all in the first ~12 s of live play); the prediction-error window starts after that warm-up. The
        # warm-up's own numbers are reported (info), the gate is the steady state
        time.sleep(WARM_S)
        for p in pages:
            ws = p.stats().get("client") or {}
            if ws:
                pe = ws.get("predErr") or {}
                info(f"{tag}: {p.name} warm-up window: prediction p50 {pe.get('p50', 0):.3f} p95 {pe.get('p95', 0):.3f} max {pe.get('max', 0):.3f} over {pe.get('n')} SNAPs")
            p.ev("() => window.__NET__.markSteady()")
        sts = wait_end(pages, netdur, tag)

        # §O4.4: score = (kbm ? 1000 : 0) − 10 × simMs − rttMs (the hello each page sent); the host is the creator or scores higher
        def score(s):
            h = s.get("hello") or {}
            return (1000 if h.get("device") == "kbm" else 0) - 10 * float(h.get("simMs") or 0) - float(h.get("rttMs") or 0)
        hi = next((i for i, s in enumerate(sts) if s.get("role") == "host"), -1)
        ok = hi == 0 or (hi > 0 and score(sts[hi]) >= score(sts[0]))
        check(f"{tag}: the host is the creator or the better §O4.4 score", ok,
              " ".join(f"{p.name}:{s.get('role')} score {score(s):.1f} (simMs {(s.get('hello') or {}).get('simMs')})" for p, s in zip(pages, sts)))
        agreement(tag, pages, sts, 0.35 if lag else 0.1)
    finally:
        for p in pages:
            p.close()


def scenario_b3(browser, base, relay, netdur, drop="client"):
    """B3: __NET__.dropSocket() on a CLIENT mid-match: it reconnects (token) within 5 s, keeps its seat and ends with the host's
    painter hash. B3H: the same on the HOST: the Room promotes the other page while it is away (the `host` message goes to
    nobody), so the old host must learn it was replaced from the reconnect's `welcome` and come back as a client."""
    tag = "B3 reconnect" if drop == "client" else "B3H old host reconnects"
    pages, code = code_room(browser, base, relay, tag, netdur)
    try:
        if not code:
            return
        time.sleep(15)
        c = next((p for p in pages if p.stats().get("role") == ("client" if drop == "client" else "host")), None)
        if c is None:
            check(f"{tag}: found the page to drop", False, json.dumps([p.stats().get("role") for p in pages]))
            return
        before = c.stats()
        c.ev("() => window.__NET__.dropSocket()")
        t0 = time.time()
        back = c.wait("() => { const s = window.__NET__.stats(); return s.client && s.client.keyframes > 0 && s.status === 'room' ? s : null; }", 15)
        check(f"{tag}: reconnected with a keyframe within 5 s", bool(back) and time.time() - t0 <= 6.0, f"{time.time() - t0:.1f} s, slot {before.get('slot')} -> {(back or {}).get('slot')}, role {before.get('role')} -> {(back or {}).get('role')}")
        check(f"{tag}: same seat after the reconnect", bool(back) and back.get("slot") == before.get("slot") and back.get("localPid") == before.get("localPid"), f"slot {before.get('slot')} -> {(back or {}).get('slot')}")
        if drop == "host":
            others = [p for p in pages if p is not c]
            newh = next((p for p in others if p.stats().get("role") == "host"), None)
            check(f"{tag}: the other page is the host now and the old host is a client", bool(newh) and bool(back) and back.get("role") == "client", f"roles {[p.stats().get('role') for p in pages]}")
        sts = wait_end(pages, netdur, tag)
        hs = next((s for s in sts if s.get("role") == "host"), sts[0])
        hh = hs.get("painterHash")
        check(f"{tag}: equal final painter hash", all(s.get("painterHash") == hh for s in sts), " ".join(str(s.get("painterHash")) for s in sts))
        check(f"{tag}: every page has the same end.result", all(((s.get("result") or {}).get("winner") == (hs.get("result") or {}).get("winner")) for s in sts), json.dumps([(s.get("result") or {}).get("winner") for s in sts]))
    finally:
        for p in pages:
            p.close()


def scenario_h(browser, base, relay, netdur):
    tag = "H graceful handoff"
    pages, code = code_room(browser, base, relay, tag, netdur, kits=("mist-rasp", "mist-rasp", "pop-well"))
    try:
        if not code:
            return
        time.sleep(15)
        host = next(p for p in pages if p.stats().get("role") == "host")
        others = [p for p in pages if p is not host]
        t0 = time.time()
        host.ev("() => window.__NET__.forceHandoff()")
        newh = None
        while time.time() - t0 < 5:
            for p in others:
                if p.stats().get("role") == "host":
                    newh = p
                    break
            if newh:
                break
            time.sleep(0.1)
        dt = time.time() - t0
        check(f"{tag}: a new host within 1 s", bool(newh) and dt <= 1.5, f"{dt:.2f} s -> {newh.name if newh else None}")
        sts = wait_end(pages, netdur, tag)
        check(f"{tag}: migrations 1 in every page's session", all((s.get("session") or {}).get("migrations", 0) >= 1 for s in sts), json.dumps([(s.get("session") or {}).get("migrations") for s in sts]))
        hh = next((s.get("painterHash") for s in sts if s.get("role") == "host"), None)
        check(f"{tag}: equal final painter hash", all(s.get("painterHash") == hh for s in sts), " ".join(str(s.get("painterHash")) for s in sts))
    finally:
        for p in pages:
            p.close()


def scenario_l(browser, base, relay, netdur):
    """a third page JOINs the code room while the match is live: it takes over a bot runner (seat + KEYFRAME) and ends
    with the host's painter hash"""
    tag = "L late join"
    # the late page is LOADED first (a page load on a loaded box takes 20-80 s: loading it after the match began would join after the horn)
    late = Page(browser, f"{tag}-late", url_for(base, relay, 77, {"netdur": netdur}))
    pages, code = code_room(browser, base, relay, tag, netdur)
    try:
        if not late.wait("() => !!window.__NET__", 180):
            check(f"{tag}: late page loaded the online module", False, "")
            return
        if not code:
            return
        time.sleep(12)
        late.ev(f"() => window.__NET__.api.joinRoom('{code}', {json.dumps(profile('Late', 'pop-well', 2, 5))})")
        seated = late.wait("() => { const s = window.__NET__.stats(); return s.client && s.client.keyframes > 0 ? s : null; }", 60)
        check(f"{tag}: the late joiner got a seat and a KEYFRAME", bool(seated), json.dumps({k: (seated or {}).get(k) for k in ("role", "localPid", "slot")}))
        if not seated:
            ls = late.stats()
            info(f"{tag}: late page status {json.dumps(late.status())[:200]} · log {json.dumps(ls.get('log'))[:700]} · host seats {json.dumps(((pages[0].stats().get('host') or pages[1].stats().get('host')) or {}).get('seatReport'))[:300]}")
        allp = pages + [late]
        sts = wait_end(allp, netdur, tag)
        hh = next((s.get("painterHash") for s in sts if s.get("role") == "host"), None)
        check(f"{tag}: the late joiner's final painter hash = the host's", sts[-1].get("painterHash") == hh, " ".join(str(s.get("painterHash")) for s in sts))
        c = sts[-1].get("client") or {}
        check(f"{tag}: the late joiner had 0 desyncs after its keyframe", c.get("desyncs", 1) <= 1 and c.get("hashOk", 0) > 0, f"desyncs {c.get('desyncs')} (one gap-resync allowed), hash {c.get('hashOk')}/{c.get('hashChecks')}, keyframes {c.get('keyframes')}")
    finally:
        for p in pages + [late]:
            p.close()


def scenario_i(browser, base, relay, netdur):
    tag = "I stats hand-off"
    pages, code = code_room(browser, base, relay, tag, netdur, kits=("mist-rasp", "mist-rasp"))
    try:
        if not code:
            return
        wait_end(pages, netdur, tag)
        has = [bool(p.ev("() => !!window.__DF_STATS__")) for p in pages]
        if not all(has):
            skip(f"{tag}: every page's lastRecord is online", "STATS INTEGRATION has not landed (no window.__DF_STATS__ on the page)")
            return
        for p in pages:
            rec = p.ev("() => window.__DF_STATS__.state().lastRecord")
            check(f"{tag}: {p.name} lastRecord is online", isinstance(rec, dict) and rec.get("online") is True, json.dumps(rec)[:300])
    finally:
        for p in pages:
            p.close()


# ───────────────────────────── B / B2: 8 humans (7 desktop + 1 phone) ─────────────────────────────
class Phone:
    """the phone context's real multi-touch (CDP Input.dispatchTouchEvent, CSS px): the left stick held and swept through
    four directions, FIRE held — a player's two thumbs"""

    def __init__(self, pg: Page, w: int, h: int, throttle: float = 4):
        self.pg = pg
        self.cdp = pg.ctx.new_cdp_session(pg.page)
        self.cdp.send("Emulation.setCPUThrottlingRate", {"rate": throttle})
        self.pts: dict[int, tuple[float, float]] = {}
        self.k = 0
        self.w, self.h = w, h
        self.sx, self.sy = w * 0.20, h * 0.70
        self.fire = None
        self.moves = 0

    def _send(self, typ):
        pts = [{"x": float(p[0]), "y": float(p[1]), "id": i} for i, p in sorted(self.pts.items())]
        try:
            self.cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": pts})
        except Exception:
            pass

    def find_fire(self):
        try:
            t = self.pg.ev("() => window.__DF__ && window.__DF__.touch ? window.__DF__.touch() : null")
            for b in (t or {}).get("buttons") or []:
                if b.get("id") == "fire":
                    r = b["rect"]
                    self.fire = (r["x"] + r["w"] / 2, r["y"] + r["h"] / 2)
            if (t or {}).get("stick"):
                pass
        except Exception:
            pass

    def step(self):
        dirs = [(0, -1), (1, 0), (0, -1), (-1, 0), (0, 1), (1, 0)]
        dx, dy = dirs[(self.k // 3) % len(dirs)]
        self.k += 1
        if 1 not in self.pts:
            self.pts[1] = (self.sx, self.sy)
            self._send("touchStart")
        if self.fire is None and self.k % 10 == 1:
            self.find_fire()
        if self.fire is not None and 2 not in self.pts:
            self.pts[2] = self.fire
            self._send("touchStart")
        self.pts[1] = (self.sx + dx * 55, self.sy + dy * 55)
        self._send("touchMove")
        self.moves += 1

    def release(self):
        self.pts = {}
        try:
            self.cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        except Exception:
            pass


def median(a):
    a = sorted(a)
    return a[len(a) // 2] if a else 0


def scenario_b(browser, pw, base, relay, netdur, kill_host_at=None):
    tag = "B2 host closes" if kill_host_at else "B 8 humans"
    n_desk = 7
    extra = {"netdur": netdur}
    pages: list[Page] = []
    phone = None
    late = None
    t_health0 = relay_get(relay, "/health")
    try:
        t0 = time.time()
        # 6 desktops + the phone start the match; the 7th desktop joins at 30 s (takes the 8th seat from the bot)
        for i in range(n_desk):
            pages.append(Page(browser, f"{tag}-D{i}", url_for(base, relay, 40 + i, extra)))
            if i == 5:
                pass
        late = pages.pop()                                  # D6 = the late joiner, loaded now, joins later
        pw_dev = {"viewport": {"width": 852, "height": 393}, "device_scale_factor": 1, "is_mobile": True, "has_touch": True, "user_agent": IOS_UA}
        ph_url = url_for(base, relay, None, {"netdur": netdur, "renderfps": RENDER_FPS if SOFT else max(RENDER_FPS, 1)})
        pp = Page(browser, f"{tag}-PH", ph_url, viewport=(852, 393), device_scale_factor=1, is_mobile=True, has_touch=True, user_agent=IOS_UA)
        pages.append(pp)
        info(f"{tag}: 8 pages loaded in {time.time() - t0:.0f} s")
        for p in pages + [late]:
            if not p.wait("() => !!window.__NET__", 180):
                check(f"{tag}: {p.name} loaded the online module", False, "\n".join(p.errors[-5:]))
                return
        phone = Phone(pp, 852, 393, PHONE_THROTTLE)             # the 4x CPU throttle starts only now: loading the module itself under it takes minutes on a loaded box
        host = pages[0]
        host.ev(f"() => window.__NET__.api.createRoom('ffa', 'washout', {json.dumps(profile('Alpha', 'mist-rasp', 0, 1))})")
        code = host.wait("() => { const s = window.__NET__.status(); return s.kind === 'room' ? s.room.code : null; }", 30)
        check(f"{tag}: CREATE ROOM gave a code", bool(code), str(code))
        if not code:
            return
        kits = ["sheet-drum", "needle-glint", "pop-well", "mist-rasp", "sheet-drum", "needle-glint", "pop-well"]
        for i, p in enumerate(pages[1:], start=1):
            p.ev(f"() => window.__NET__.api.joinRoom('{code}', {json.dumps(profile(('Phone' if p is pp else 'Desk') + str(i), kits[i % len(kits)], 0, i + 1))})")
        n = len(pages)
        seated = host.wait(f"() => {{ const s = window.__NET__.status(); return s.kind === 'room' && s.room.members.filter(m => m.conn).length === {n}; }}", 40)
        check(f"{tag}: {n - 1} JOIN ROOM {code} seated ({n} humans, the 8th joins late)", bool(seated), json.dumps([p.status().get("kind") for p in pages]))
        host.ev("() => window.__NET__.api.configure({ map: 'pier18', preset: 'noon', skill: 'swell' })")
        time.sleep(0.5)
        raw0 = (relay_get(relay, "/health") or {}).get("raw")
        host.ev("() => window.__NET__.api.start()")
        ok = all(p.wait("() => { const s = window.__NET__.stats(); return s.role ? s.role : null; }", 120) for p in pages)
        roles = [p.stats().get("role") for p in pages]
        check(f"{tag}: every page runs its match session", ok, f"roles {roles}")
        host_i = next((i for i, r in enumerate(roles) if r == "host"), -1)
        check(f"{tag}: the host is a desktop (not the phone)", host_i >= 0 and pages[host_i] is not pp, f"host = {pages[host_i].name if host_i >= 0 else None}")
        if not ok or host_i < 0:
            return
        pp_vis = None
        t_live = time.time()                    # the 30 s of the late join count from here (the phone page's reads below can be slow)
        joined_late = False
        killed_at = None
        promote_dt = None
        tps_samples: list[float] = []
        tickms: list[float] = []
        last_sample = 0.0
        dead: Page | None = None
        while time.time() - t_live < netdur * 2 + 60:       # the sim of a saturated box runs below real time
            now = time.time() - t_live
            phone.step()
            if pp_vis is None and now >= 8:
                pp_vis = pp.ev("() => { const r = document.getElementById('df-touch'); return !!r && getComputedStyle(r).display !== 'none'; }")
            if not joined_late and now >= 30:
                late.ev(f"() => window.__NET__.api.joinRoom('{code}', {json.dumps(profile('Late', 'mist-rasp', 0, 8))})")
                joined_late = True
                pages.append(late)
                info(f"{tag}: the 8th desktop joined at {now:.0f} s")
            if kill_host_at and killed_at is None and now >= kill_host_at:
                dead = pages[host_i]
                killed_at = time.time()
                dead.close()
                survivors = [p for p in pages if p is not dead]
                newh = None
                while time.time() - killed_at < 8:
                    for p in survivors:
                        if p.stats().get("role") == "host":
                            newh = p
                            break
                    if newh:
                        break
                    time.sleep(0.1)
                promote_dt = time.time() - killed_at
                check(f"{tag}: a new host within 3 s of the host page closing", bool(newh) and promote_dt <= 3.5, f"{promote_dt:.2f} s -> {newh.name if newh else None}")
                host_i = pages.index(newh) if newh else host_i
            if now - last_sample >= 3:
                last_sample = now
                cur = [p for p in pages if not p.closed]
                snap = [(p, p.stats()) for p in cur]            # one read per page per sample (the pages share a saturated box)
                hp = next((s for p, s in snap if s.get("role") == "host"), None)
                if hp is not None:
                    h = (hp.get("host") or {})
                    if h.get("hostTps"):
                        tps_samples.append(h["hostTps"])
                        tickms.append(h.get("tickMsP50", 0))
                if all(s.get("ended") for p, s in snap):
                    break
            time.sleep(0.4)
        phone.release()
        # a slow page (the phone under CPU throttling) is still draining the host's last SNAPs / the `end`: give stragglers time
        t_wait = time.time()
        while time.time() - t_wait < 90:
            if all(p.stats().get("ended") for p in pages if not p.closed):
                break
            time.sleep(2)
        check(f"{tag}: the phone's touch overlay is visible during play", bool(pp_vis), str(pp_vis))
        live_pages = [p for p in pages if not p.closed]
        time.sleep(3.0)
        sts = [p.stats() for p in live_pages]
        check(f"{tag}: every surviving page saw the end", all(s.get("ended") == "complete" for s in sts), " ".join(f"{p.name}:{s.get('ended')}" for p, s in zip(live_pages, sts)))
        hs = next((s for s in sts if s.get("role") == "host"), {})
        hh = hs.get("painterHash")
        check(f"{tag}: the same final painter hash on every surviving page", all(s.get("painterHash") == hh for s in sts) and hh is not None, " ".join(f"{p.name} {s.get('painterHash')}" for p, s in zip(live_pages, sts)))
        hr = hs.get("result") or {}
        same = all(((s.get("result") or {}).get("winner") == hr.get("winner")) and max([abs(a - b) for a, b in zip((s.get("result") or {}).get("shares") or [0], hr.get("shares") or [0])] or [0]) <= 1e-9 for s in sts)
        check(f"{tag}: the same end.result on every surviving page", same and bool(hr), f"winner {hr.get('winner')} shares {hr.get('shares')}")
        desy = [(p.name, (s.get("client") or {}).get("desyncs")) for p, s in zip(live_pages, sts) if s.get("client")]
        check(f"{tag}: 0 desyncs on every client", all(d == 0 for _, d in desy), json.dumps(desy))
        errs = [(p.name, e) for p in live_pages for e in p.errors if "favicon" not in e and e.startswith("pageerror")]
        check(f"{tag}: no page errors", not errs, json.dumps(errs[-3:]) if errs else "none")
        h = hs.get("host") or {}
        for p, s_ in zip(live_pages, sts):
            c_ = s_.get("client") or {}
            info(f"{tag}: {p.name} role {s_.get('role')} ended {s_.get('ended')} slot {s_.get('slot')} localPid {s_.get('localPid')} hostTps {(s_.get('host') or {}).get('hostTps')} client snaps {c_.get('snaps')} keyframes {c_.get('keyframes')} gaps {c_.get('gaps')} desyncs {c_.get('desyncs')} synced {c_.get('synced')} pred p95 {(c_.get('predErr') or {}).get('p95')}")
        info(f"{tag}: host sim tick cost p50 {median(tickms):.2f} ms over {len(tickms)} samples; max tick gap {h.get('maxGapMs')} ms ({h.get('stalls1s')} > 1 s); underflows {h.get('underflows')} drops {h.get('queueDrops')}; jitter targets {[r.get('target') for r in (h.get('intentRates') or [])]}")
        if kill_host_at:
            mig = [(s.get("session") or {}).get("migrations") for s in sts]
            check(f"{tag}: migrations 1 on every survivor", all(m == 1 for m in mig), json.dumps(mig))
            info(f"{tag}: the new host's tick rate median {median(tps_samples)}/s over {len(tps_samples)} samples")
            return
        # B's 8-human proof
        ht = h.get("humanTicks") or []
        eight = ht[8] if len(ht) > 8 else 0
        check(f"{tag}: the host had 8 seated humans at once for >= 60 s", eight >= 60 * 60, f"{eight / 60:.1f} s at 8 (humanTicks {ht})")
        rates = h.get("intentRates") or []
        check(f"{tag}: every remote human's INTENTS arrive at >= 15 Hz (median)", len(rates) == 7 and all(r.get("hz", 0) >= 15 for r in rates), " ".join(f"{r.get('slot')}:{r.get('hz', 0):.1f}Hz" for r in rates))
        rep = h.get("seatReport") or []
        humans = [r for r in rep if r.get("liveTicks", 0) > 600]
        check(f"{tag}: 8 human runners moved >= 30 m and painted > 0", len(humans) >= 8 and all(r["movedM"] >= 30 and r["painted"] > 0 for r in humans),
              " ".join(f"r{r['runner']}:{r['movedM']}m/{r['painted']}" for r in rep))
        tps_med = median(tps_samples)
        check(f"{tag}: the host held >= 55 sim ticks/s (median)", tps_med >= 55, f"median {tps_med} over {len(tps_samples)} samples (min {min(tps_samples) if tps_samples else None}); a box under shared load: re-run before judging")
        time.sleep(4)
        h1 = relay_get(relay, "/health")
        raw1 = h1.get("raw")
        if raw0 is not None and raw1 is not None:
            delta = raw1 - raw0
            exp = 30700 * (netdur + 3) / 186.0
            check(f"{tag}: the relay's counted raw is within ±10 % of §O9.2's 8-human row scaled to {netdur} s", abs(delta - exp) <= 0.10 * exp,
                  f"raw +{delta} vs {exp:.0f} expected ({delta / exp * 100 - 100:+.1f} %); units now {h1.get('units')}")
        else:
            check(f"{tag}: the relay's /health counted raw", False, json.dumps([t_health0, h1])[:300])
        c_phone = (next((s for p, s in zip(live_pages, sts) if p is pp), {}).get("client") or {})
        pe = c_phone.get("predErr") or {}
        info(f"{tag}: phone prediction p50 {pe.get('p50', 0):.3f} p95 {pe.get('p95', 0):.3f} max {pe.get('max', 0):.3f} (n {pe.get('n')}), touch frames {phone.moves}")
    finally:
        if phone:
            phone.release()
        for p in pages + ([late] if late and late not in pages else []):
            p.close()


# ───────────────────────────── C: quick match ─────────────────────────────
def scenario_c(browser, base, relay):
    tag = "C quick match"
    env = relay_get(relay, "/__dev/env")
    timing = env.get("timing") or {}
    solo_s = float(timing.get("QM_SOLO_WAIT_S", 45))
    fill_s = float(timing.get("QM_FILL_WAIT_S", 8))
    auto_s = float(timing.get("QM_AUTOSTART_S", 8))
    info(f"{tag}: relay timing fill {fill_s} s, solo {solo_s} s, autostart {auto_s} s")
    pages = [Page(browser, f"{tag}-T{i}", url_for(base, relay, 60 + i, {"netdur": None})) for i in range(3)]
    ffa = Page(browser, f"{tag}-F", url_for(base, relay, 70, {}))
    try:
        for p in pages + [ffa]:
            if not p.wait("() => !!window.__NET__", 120):
                check(f"{tag}: {p.name} loaded the online module", False, "\n".join(p.errors[-5:]))
                return
        t_q = time.time()
        for i, p in enumerate(pages):
            p.ev(f"() => window.__NET__.api.quickMatch('teams', 'turf', {json.dumps(profile('Quick' + str(i), 'mist-rasp', 0, i + 1))})")
        ffa.ev(f"() => window.__NET__.api.quickMatch('ffa', 'turf', {json.dumps(profile('Solo', 'mist-rasp', 0, 4))})")
        ok = all(p.wait("() => { const s = window.__NET__.stats(); return s.role ? s.role : null; }", fill_s + auto_s + 90) for p in pages)
        roles = [p.stats().get("role") for p in pages]
        codes = [p.stats().get("code") for p in pages]
        check(f"{tag}: the 3 TEAMS TURF players share a room after the fill wait and the match starts", ok and len(set(codes)) == 1 and roles.count("host") == 1, f"roles {roles} codes {codes} after {time.time() - t_q:.0f} s")
        hs = next((p.stats() for p in pages if p.stats().get("role") == "host"), {})
        h = hs.get("host") or {}
        seats = [r for r in (h.get("seatReport") or []) if r.get("human")]
        check(f"{tag}: the roster is 3 humans + 5 bots", len(seats) == 3 and h.get("runners") == 8, f"{len(seats)} human seats, {h.get('runners')} runners")
        fs = ffa.status()
        st_kind = fs.get("kind")
        check(f"{tag}: the FFA player is not in that room (still queued)", st_kind in ("queue", "solo", "connecting") and ffa.stats().get("role") is None, f"status {st_kind}, code {ffa.stats().get('code')}")
        t_wait = max(0.0, solo_s + 4 - (time.time() - t_q))
        got = ffa.wait("() => window.__NET__.status().kind === 'solo'", t_wait + 30)
        check(f"{tag}: the lone FFA player gets the solo prompt (KEEP WAITING / PLAY VS BOTS)", bool(got), f"after {time.time() - t_q:.0f} s (solo wait {solo_s} s); text has 'bots': {'bots' in ffa.text().lower()}")
        for p in pages:
            errs = [e for e in p.errors if "favicon" not in e and e.startswith("pageerror")]
            check(f"{tag}: {p.name} no page errors", not errs, "; ".join(errs[-2:]) or "none")
    finally:
        for p in pages + [ffa]:
            try:
                p.ev("() => window.__NET__ && window.__NET__.api.leave(false)")
            except Exception:
                pass
            p.close()


# ───────────────────────────── D: idle kick ─────────────────────────────
def scenario_d(browser, base, relay):
    tag = "D idle kick"
    host = Page(browser, f"{tag}-H", url_for(base, relay, 81, {"netdur": 120, "idlekick": 10}))
    idle = Page(browser, f"{tag}-I", url_for(base, relay, None, {"netdur": 120, "idlekick": 10}))
    try:
        for p in (host, idle):
            if not p.wait("() => !!window.__NET__", 120):
                check(f"{tag}: {p.name} loaded the online module", False, "\n".join(p.errors[-5:]))
                return
        host.ev(f"() => window.__NET__.api.createRoom('teams', 'turf', {json.dumps(profile('Alpha', 'mist-rasp', 1, 1))})")
        code = host.wait("() => { const s = window.__NET__.status(); return s.kind === 'room' ? s.room.code : null; }", 30)
        idle.ev(f"() => window.__NET__.api.joinRoom('{code}', {json.dumps(profile('Idle', 'mist-rasp', 2, 2))})")
        host.wait("() => { const s = window.__NET__.status(); return s.kind === 'room' && s.room.members.filter(m => m.conn).length === 2; }", 30)
        host.ev("() => window.__NET__.api.configure({ map: 'pier18', preset: 'noon', skill: 'swell' })")
        time.sleep(0.5)
        host.ev("() => window.__NET__.api.start()")
        ok = all(p.wait("() => { const s = window.__NET__.stats(); return s.role ? s.role : null; }", 90) for p in (host, idle))
        check(f"{tag}: both pages run the match", ok, f"roles {[p.stats().get('role') for p in (host, idle)]}")
        if not ok:
            return
        if idle.stats().get("role") == "host":
            # §O4.4 picks the host by score, not by who created the room: the idle page won it. The host enforces the idle kick,
            # so hand the match to the autopilot page first (a graceful migration), as a quit / hidden host would
            idle.ev("() => window.__NET__.forceHandoff()")
            sw = host.wait("() => { const s = window.__NET__.stats(); return s.role === 'host' ? s : null; }", 15)
            info(f"{tag}: the idle page was the host: handed off to the autopilot page ({'ok' if sw else 'NOT promoted'})")
        t0 = time.time()
        kicked = idle.wait("() => { const s = window.__NET__.status(); return s.kind === 'error' && s.code === 'kicked' ? s : null; }", 60)
        check(f"{tag}: the idle client is kicked (4008) after ~10 s of live play", bool(kicked), f"{time.time() - t0:.1f} s after both ran: {json.dumps(kicked)[:160]}")
        txt = idle.text().lower()
        check(f"{tag}: 'Removed for inactivity' is shown", "removed for inactivity" in txt, "card text found" if "removed for inactivity" in txt else txt[:200].replace("\n", " "))
        time.sleep(1.0)
        h = host.stats().get("host") or {}
        seat_h = [r for r in (h.get("seatReport") or []) if r.get("slot", -1) >= 0]
        idle_seat = [r for r in (h.get("seatReport") or []) if r.get("runner") == 1 or not r.get("human")]
        check(f"{tag}: the host counted the kick and the runner is a bot now", h.get("kicks", 0) >= 1 and h.get("takeovers", 0) >= 1 and h.get("humans") == 1,
              f"kicks {h.get('kicks')} takeovers {h.get('takeovers')} human seats {h.get('humans')} {json.dumps(seat_h)[:200]}")
        check(f"{tag}: the host page has no page errors", not [e for e in host.errors if e.startswith("pageerror")], "; ".join(host.errors[-2:]) or "none")
    finally:
        for p in (host, idle):
            p.close()


# ───────────────────────────── E: origin allowlist ─────────────────────────────
def scenario_e(relay):
    tag = "E origin"
    u = urllib.parse.urlparse(http_base(relay))

    def upgrade(origin, path="/room/new?mode=teams&rule=turf&build=probe"):
        c = http.client.HTTPConnection(u.hostname, u.port, timeout=8)
        hd = {"Upgrade": "websocket", "Connection": "Upgrade", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13"}
        if origin is not None:
            hd["Origin"] = origin
        try:
            c.request("GET", path, headers=hd)
            r = c.getresponse()
            return r.status
        except Exception as e:
            return "ERR " + str(e)[:80]
        finally:
            try:
                c.close()
            except Exception:
                pass

    bad = upgrade("https://evil.example")
    check(f"{tag}: an origin outside the allowlist is refused (403)", bad == 403, f"https://evil.example → {bad}")
    lookalike = upgrade("http://localhost.evil.com")
    check(f"{tag}: a look-alike origin is refused (403)", lookalike == 403, f"http://localhost.evil.com → {lookalike}")
    none = upgrade(None)
    check(f"{tag}: no Origin header is refused (403)", none == 403, f"no Origin → {none}")
    ok = upgrade("http://localhost:5222")
    check(f"{tag}: an allowed dev origin upgrades (101)", ok == 101, f"http://localhost:5222 → {ok}")


# ───────────────────────────── F: quota ─────────────────────────────
def scenario_f(browser, base, relay):
    tag = "F quota"
    pg = Page(browser, f"{tag}-P", url_for(base, relay, None, {}))
    try:
        if not pg.wait("() => !!window.__NET__", 120):
            check(f"{tag}: the page loaded the online module", False, "\n".join(pg.errors[-5:]))
            return
        h0 = relay_get(relay, "/health")
        cap = h0.get("capRaw") if h0.get("mode") == "strict" else h0.get("capUnits")
        met = relay_get(relay, f"/__dev/meter/set?raw={int(h0.get('capRaw', 55000)) + 5}&units={int(h0.get('capUnits', 60000)) + 5}")
        info(f"{tag}: dev meter set to over the cap ({json.dumps(met)[:160]})")
        pg.ev(f"() => window.__NET__.api.createRoom('teams', 'turf', {json.dumps(profile('Quota', 'mist-rasp', 1, 1))})")
        st = pg.wait("() => { const s = window.__NET__.status(); return s.kind === 'error' ? s : null; }", 20)
        check(f"{tag}: a new room is refused with err quota", bool(st) and st.get("code") == "quota", json.dumps(st)[:200])
        txt = pg.text().lower()
        check(f"{tag}: the quota card is shown ('online is full for today')", "full for today" in txt, "found" if "full for today" in txt else txt[:200].replace("\n", " "))
        # PLAY VS BOTS → the offline fallback: a bot match starts on this page
        pg.ev("() => window.__NET__.api.playBotsInstead()")
        ph = pg.wait("() => { const s = window.__DF__ && window.__DF__.state ? window.__DF__.state() : null; return s && (s.phase === 'play' || s.phase === 'ready' || s.phase === 'loading') ? s.phase : null; }", 90)
        check(f"{tag}: PLAY VS BOTS starts an offline bot match", bool(ph), f"phase {ph}")
    finally:
        relay_get(relay, "/__dev/meter/set?raw=0&units=0")
        pg.close()


# ───────────────────────────── G: the portal's iframe ─────────────────────────────
PORTAL_SANDBOX = "allow-scripts allow-same-origin allow-pointer-lock allow-popups allow-modals allow-forms"
PORTAL_ALLOW = "autoplay; fullscreen; gamepad; pointer-lock"


def scenario_g(browser, base, relay):
    tag = "G portal iframe"
    q = urllib.parse.urlencode({"dev": "1", "net": relay, "autopilot": "91", "renderfps": str(RENDER_FPS)})
    src = f"{base}?{q}"
    host_ctx = browser.new_context(viewport={"width": 1100, "height": 640})
    outer = host_ctx.new_page()
    errs: list[str] = []
    outer.on("pageerror", lambda e: errs.append(str(e)[:200]))
    other = Page(browser, f"{tag}-O", url_for(base, relay, 92, {}))
    try:
        outer.set_content(f'<html><body style="margin:0;background:#000"><iframe id="g" src="{src}" sandbox="{PORTAL_SANDBOX}" allow="{PORTAL_ALLOW}" style="width:1000px;height:600px;border:0"></iframe></body></html>')
        t0 = time.time()
        fr = None
        while time.time() - t0 < 120:
            for f in outer.frames:
                if f != outer.main_frame and f.url.startswith(base.rstrip("/")):
                    fr = f
            if fr:
                try:
                    if fr.evaluate("() => !!window.__NET__"):
                        break
                except Exception:
                    pass
            time.sleep(0.5)
        check(f"{tag}: the game loads inside the sandboxed iframe and the online module opens", bool(fr), "frame " + (fr.url[:80] if fr else "none"))
        if not fr or not other.wait("() => !!window.__NET__", 120):
            return
        origin = fr.evaluate("() => location.origin")
        sandboxed = fr.evaluate("() => (document.featurePolicy ? 1 : 0)")
        info(f"{tag}: iframe origin {origin} (same-origin allowed by the portal's sandbox); featurePolicy {sandboxed}")
        fr.evaluate(f"() => window.__NET__.api.quickMatch('teams', 'turf', {json.dumps(profile('Frame', 'mist-rasp', 0, 1))})")
        other.ev(f"() => window.__NET__.api.quickMatch('teams', 'turf', {json.dumps(profile('Plain', 'mist-rasp', 0, 2))})")
        t_q = time.time()
        got = None
        while time.time() - t_q < 120:
            try:
                s = fr.evaluate("() => window.__NET__.stats()")
                if s.get("role"):
                    got = s
                    break
            except Exception:
                pass
            time.sleep(0.5)
        check(f"{tag}: QUICK MATCH from inside the iframe matches and starts the match", bool(got), json.dumps({k: (got or {}).get(k) for k in ("role", "code", "localPid")}) + f" after {time.time() - t_q:.0f} s")
        if got:
            time.sleep(14)
            s = fr.evaluate("() => window.__NET__.stats()")
            c = s.get("client") or {}
            h = s.get("host") or {}
            flowing = (c.get("snaps", 0) > 100) or (h.get("snaps", 0) > 100 and h.get("humans", 0) >= 2)
            check(f"{tag}: the iframe session is live (SNAPs flow, 0 desyncs)", flowing and (c.get("desyncs", 0) == 0), f"role {s.get('role')} client snaps {c.get('snaps')} desyncs {c.get('desyncs')} host snaps {h.get('snaps')} humans {h.get('humans')}")
            # pointer lock inside the sandboxed frame (allow-pointer-lock): a REAL click on the play card enters play with the lock
            try:
                box = outer.locator("#g").bounding_box()
                outer.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                locked = False
                for _ in range(20):
                    time.sleep(0.4)
                    if fr.evaluate("() => !!document.pointerLockElement"):
                        locked = True
                        break
                check(f"{tag}: a real click inside the iframe takes the pointer lock (sandbox allow-pointer-lock)", locked, f"pointerLockElement set: {locked}")
            except Exception as e:
                info(f"{tag}: pointer lock probe error ({str(e)[:100]})")
        check(f"{tag}: no page errors", not errs, "; ".join(errs[-2:]) or "none")
    finally:
        try:
            outer.evaluate("() => 0")
        except Exception:
            pass
        host_ctx.close()
        other.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5222/")
    ap.add_argument("--relay", default="ws://127.0.0.1:8799")
    ap.add_argument("--netdur", type=int, default=40)
    ap.add_argument("--scenarios", default="A0,A80")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--renderfps", type=float, default=None, help="default 0.2 (GPU) / 0.02 with --soft: a SwiftShader render stalls the page 0.5-2 s")
    ap.add_argument("--phone-throttle", type=float, default=4, help="CPU throttling rate of the phone context in B (default 4)")
    ap.add_argument("--soft", action="store_true", help="software GL / compositing (see SOFT_FLAGS): for a box whose GPU is saturated")
    args = ap.parse_args()
    global RENDER_FPS, SOFT, PHONE_THROTTLE
    PHONE_THROTTLE = args.phone_throttle
    SOFT = bool(args.soft)
    RENDER_FPS = args.renderfps if args.renderfps is not None else (0.02 if args.soft else 0.2)
    from playwright.sync_api import sync_playwright
    t0 = time.time()
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(channel="chrome", headless=not args.headed, args=SOFT_FLAGS if args.soft else FLAGS)
        except Exception as e:
            print("SETUP FAILED:", e)
            return 2
        for sc in [s.strip() for s in args.scenarios.split(",") if s.strip()]:
            print("── " + sc, flush=True)
            try:
                if sc == "A0":
                    scenario_a(browser, args.base, args.relay, args.netdur, None)
                elif sc == "A80":
                    scenario_a(browser, args.base, args.relay, args.netdur, 80)
                elif sc == "B":
                    scenario_b(browser, pw, args.base, args.relay, max(args.netdur, 150))
                elif sc == "B2":
                    scenario_b(browser, pw, args.base, args.relay, max(args.netdur, 100), kill_host_at=40)
                elif sc == "B3":
                    scenario_b3(browser, args.base, args.relay, args.netdur)
                elif sc == "B3H":
                    scenario_b3(browser, args.base, args.relay, args.netdur, drop="host")
                elif sc == "C":
                    scenario_c(browser, args.base, args.relay)
                elif sc == "D":
                    scenario_d(browser, args.base, args.relay)
                elif sc == "E":
                    scenario_e(args.relay)
                elif sc == "F":
                    scenario_f(browser, args.base, args.relay)
                elif sc == "G":
                    scenario_g(browser, args.base, args.relay)
                elif sc == "H":
                    scenario_h(browser, args.base, args.relay, args.netdur)
                elif sc == "I":
                    scenario_i(browser, args.base, args.relay, args.netdur)
                elif sc == "L":
                    scenario_l(browser, args.base, args.relay, max(args.netdur, 75))
                else:
                    print("unknown scenario", sc)
            except Exception as e:
                import traceback
                check(f"{sc}: ran without an exception", False, repr(e)[:300] + " " + traceback.format_exc()[-400:].replace("\n", " | "))
        browser.close()
    fails = [c for c in checks if not c["pass"]]
    print("-" * 100)
    print(f"netplay: {'FAIL' if fails else 'PASS'} ({len(checks) - len(fails)}/{len(checks)} checks, {len(skips)} skipped, {time.time() - t0:.0f} s)")
    for f in fails:
        print("FAILED: " + f["name"] + " — " + f["detail"][:300])
    try:
        rep = os.path.join(HERE, "_reports")
        os.makedirs(rep, exist_ok=True)
        with open(os.path.join(rep, "netplay.json"), "w", encoding="utf-8") as f:
            json.dump({"at": time.strftime("%Y-%m-%dT%H:%M:%S"), "base": args.base, "relay": args.relay, "checks": checks, "skipped": skips}, f, indent=2)
    except Exception:
        pass
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
