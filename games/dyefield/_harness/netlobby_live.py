#!/usr/bin/env python
"""DYEFIELD — PLAY ONLINE screens against the REAL online API (LOBBY-UI integration gate, CONTRACT_ONLINE §O12.3 / §O13.3).

netlobby.py drives the screens against the mock; this gate drives the same screens, by real clicks and real keys, through
main.ts's real wiring (net/online.ts → net/api.ts → the relay), so a mismatch between what the screens expect from
OnlineApi and what SYNC's NetApi does shows up. It needs the SYNC wiring in the page (game.ts / main.ts patched) and a
relay: a local `wrangler dev --local` (workers/dyefield-net) — the same stack netplay.py uses. HEADLESS only.

  python _harness/netlobby_live.py --headless                          (all scenarios; dev server :5223 started if down)
  python _harness/netlobby_live.py --scenarios L1,L2 --netdur 20 --relay ws://127.0.0.1:8797

Start the relay (workers/dyefield-net, CLOUDFLARE_API_TOKEN unset) with short matchmaking timers and a short quick-match length
so the solo / re-queue / quick legs do not wait for the production 45 s / 20 s / 180 s (a QUICK match has no START, so ?netdur
cannot shorten it — only the relay's DEV_QUICK_DURATION_S can):
  npx wrangler dev --local --ip 127.0.0.1 --port 8797 --var QM_SOLO_WAIT_S:9 --var QM_FILL_WAIT_S:3 --var QM_AUTOSTART_S:5       --var REMATCH_WINDOW_S:8 --var DEV_QUICK_DURATION_S:12

Scenarios (each page: ?dev=1&net=<relay>&autopilot=<n>&netdur=<s>, so the ?net= link opens PLAY ONLINE):
  L1  CREATE ROOM by click on page A (a code appears) → JOIN ROOM on page B by typing it on the keyboard → both rooms show 2
      players, A's START enabled, B has none → START → both screens hide, the HUD badge shows, a match runs on both →
      after the horn the victory card carries the online buttons (owner PLAY AGAIN + LEAVE, guest LEAVE) and the slate's
      own PLAY AGAIN / LOBBY are gone → PLAY AGAIN: both pages show the room screen again over the lobby, the match UI is
      gone → B LEAVE: A sees one player and START disabled → A LEAVE: PLAY ONLINE home.
  L2  QUICK MATCH on both → both reach MATCH FOUND → the match starts by itself → REMATCH / LEAVE after the horn → only A
      presses REMATCH: when the window ends A is re-queued: the search card is back, the victory slate and the match UI
      are gone, the lobby runs behind (the post → connecting path net/ui/screens.ts route() handles) → B LEAVE → both home.
  L3  QUICK MATCH FFA · WASHOUT alone → NO ONE ELSE YET → PLAY VS BOTS starts exactly ONE offline match with that mode and rule
      (api.playBotsInstead() owns it; the screens must not start a second one) and the online screens are gone.
  L4  the invite: the room's invite link carries ?room=<code>; a page opened on it shows JOIN ROOM with the code filled and JOIN lands
      in that room; unnamed players are GUEST-XXXX (and different); a dead code gives NO ROOM WITH THAT CODE.
Every page: no page errors, no console errors. Exit: 0 all pass · 1 a check failed · 2 setup failure.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

FLAGS = [
    "--ignore-gpu-blocklist", "--use-angle=d3d11", "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion", "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
]

checks: list[dict] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    checks.append({"name": name, "pass": bool(ok), "detail": detail})
    print(("PASS" if ok else "FAIL") + "  " + name + ("  —  " + detail if detail else ""), flush=True)
    return bool(ok)


SCREEN_JS = """() => {
  const r = document.querySelector('#df-online');
  if (!r || r.hidden) return null;
  const s = r.querySelector('.dfo-screen:not([hidden])');
  return s ? s.dataset.screen : null;
}"""
SEARCH_JS = """() => { const c = document.querySelector('#df-online:not([hidden]) .dfo-searchcard'); return c && !c.closest('[hidden]') ? c.dataset.state : null; }"""
NOTICE_JS = """() => { const c = document.querySelector('#df-online:not([hidden]) .dfo-noticecard'); return c && !c.closest('[hidden]') ? c.dataset.kind : null; }"""
BADGE_JS = """() => { const h = document.querySelector('#df-online-hud'); const n = h && !h.hidden && h.querySelector('.dfo-net'); return n && !n.hidden ? n.innerText : null; }"""
POST_JS = """() => {
  const p = document.querySelector('.dfo-post'); if (!p || p.hidden || !p.classList.contains('ready')) return null;
  return [...p.querySelectorAll('.dfo-postbtns button')].map((b) => b.textContent.trim());
}"""
SLATE_JS = """() => { const v = document.querySelector('.df-victory'); return !!(v && !v.hidden && getComputedStyle(v).visibility !== 'hidden'); }"""
OWN_BTNS_JS = """() => { const b = document.querySelector('.df-victory-btns'); return b ? getComputedStyle(b).display : null; }"""
PHASE_JS = """() => { try { return window.__DF__.state().phase; } catch (e) { return null; } }"""


class Page:
    def __init__(self, browser, name, url, viewport=(1100, 640)):
        self.name = name
        self.ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
        self.page = self.ctx.new_page()
        self.errors: list[str] = []
        self.page.on("pageerror", lambda e: self.errors.append("pageerror: " + str(e)[:300]))
        self.page.on("console", lambda m: self.errors.append("console: " + m.text[:300]) if m.type == "error" else None)
        self.page.goto(url, wait_until="domcontentloaded", timeout=120000)

    def ev(self, js, arg=None):
        try:
            return self.page.evaluate(js, arg) if arg is not None else self.page.evaluate(js)
        except Exception:
            return None

    def wait(self, js, timeout_s, poll=0.25):
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            v = self.ev(js)
            if v:
                return v
            time.sleep(poll)
        return None

    def screen(self):
        return self.ev(SCREEN_JS)

    def wait_screen(self, name, timeout_s=30):
        return self.wait("() => (%s)() === %s || null" % (SCREEN_JS, json.dumps(name)), timeout_s)

    def click(self, sel, timeout_s=15):
        try:
            # force: the enabled START / PLAY AGAIN buttons pulse forever (not "stable" to Playwright's check); the click itself
            # is still a real mouse press at the element's centre
            self.page.locator(sel).first.click(timeout=timeout_s * 1000, force=True)
            return True
        except Exception as e:
            self.errors.append("click %s: %s" % (sel, str(e).splitlines()[0][:160]))
            return False

    def shot(self, tag):
        try:
            import os
            d = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "_shots", "online")
            os.makedirs(d, exist_ok=True)
            self.page.screenshot(path=os.path.join(d, "live_%s_%s.png" % (tag, self.name)), scale="css", timeout=20000)
        except Exception:
            pass

    def real_errors(self):
        return [e for e in self.errors if "favicon" not in e and not e.startswith("click ")]

    def close(self):
        try:
            self.ctx.close()
        except Exception:
            pass


def url_for(base, relay, auto, netdur, extra=None):
    q = {"dev": "1", "net": relay, "autopilot": str(auto), "renderfps": "6", "netdur": str(netdur)}
    q.update(extra or {})
    return base + "?" + urllib.parse.urlencode(q)


def watch_search(p: Page) -> None:
    p.ev("""() => { window.__seenSearch = []; const f = %s; setInterval(() => { const v = f(); const a = window.__seenSearch;
      if (v && a[a.length - 1] !== v) a.push(v); }, 30); }""" % SEARCH_JS)


def seen_search(p: Page) -> list:
    return p.ev("() => window.__seenSearch || []") or []


def open_online(p: Page) -> bool:
    """the ?net= link opens PLAY ONLINE by itself; otherwise the title's PLAY ONLINE tile does"""
    if p.wait_screen("home", 90):
        return True
    p.click("#dfm-play-online", 60)
    return bool(p.wait_screen("home", 60))


def room_code(p: Page) -> str:
    t = p.ev("() => { const e = document.getElementById('dfo-room-code'); return e ? e.textContent : ''; }") or ""
    return re.sub(r"[^A-Z0-9]", "", t.upper())


def lobby_alive(p: Page) -> bool:
    return p.wait("() => (%s)() === 'menu' || null" % PHASE_JS, 60) is not None


PLAY_GATE_JS = """() => { const b = document.getElementById('df-play'); const r = document.getElementById('df-boot');
  return b && r && !r.classList.contains('gone') && b.offsetParent !== null ? true : null; }"""


def match_ran(p: Page, tag: str) -> bool:
    """a real player clicks CLICK TO PLAY once the arena has loaded (the START / QUICK MATCH click's pointer-lock gesture is
    long gone by then, main.ts: began = g.beginWithLock() else bootUi.showPlay) — so does this gate, then it reads the badge"""
    t0 = time.time()
    clicked = False
    while time.time() - t0 < 120 and not p.ev(BADGE_JS):
        if p.ev(PLAY_GATE_JS):
            p.page.mouse.click(550, 320)
            clicked = True
            time.sleep(0.5)
        time.sleep(0.4)
    ok = check("%s: %s has the online match running and its HUD badge up" % (tag, p.name), bool(p.ev(BADGE_JS)), str(p.ev(BADGE_JS)))
    print("   info %s: %s %s" % (tag, p.name, "clicked CLICK TO PLAY" if clicked else "no CLICK TO PLAY card"), flush=True)
    return ok


def wait_post(pages, netdur, tag):
    """the victory card with the online buttons, on every page (generous: a shared box at 100 % CPU runs the match slower than
    its wall-clock length — confirm a timeout with a rerun before blaming the screens)"""
    ok = []
    for p in pages:
        t0 = time.time()
        got = None
        while time.time() - t0 < netdur * 8 + 240 and not got:
            got = p.ev(POST_JS)
            if not got and p.ev(PLAY_GATE_JS):      # a CLICK TO PLAY card that showed up after the badge: click it like a player
                p.page.mouse.click(550, 320)
            time.sleep(0.4)
        ok.append(bool(got))
    return ok


def host_page(pages):
    return next((p for p in pages if "HOST" in (p.ev(BADGE_JS) or "")), None)


# ───────────────────────────── L1: code room ─────────────────────────────
def scenario_l1(browser, base, relay, netdur):
    tag = "L1"
    A = Page(browser, "A", url_for(base, relay, 31, netdur))
    B = Page(browser, "B", url_for(base, relay, 32, netdur))
    pages = [A, B]
    try:
        for p in pages:
            if not check("%s: %s opened PLAY ONLINE" % (tag, p.name), open_online(p), str(p.screen())):
                return
        check("%s: CREATE ROOM by a click → the room screen" % tag, A.click("#dfo-door-create") and bool(A.wait_screen("room", 40)), str(A.screen()))
        code = room_code(A)
        check("%s: the room screen shows a 4-character code" % tag, len(code) == 4, repr(code))
        A.shot("l1_room_alone")
        check("%s: JOIN ROOM by a click → the code screen" % tag, B.click("#dfo-door-join") and bool(B.wait_screen("join", 20)), str(B.screen()))
        B.page.keyboard.type(code, delay=60)
        time.sleep(0.4)
        check("%s: JOIN is enabled once 4 characters are typed" % tag, B.ev("() => !document.getElementById('dfo-join-go').disabled") is True)
        B.click("#dfo-join-go")
        check("%s: B is in the room" % tag, bool(B.wait_screen("room", 40)), str(B.screen()))
        two = lambda p: p.wait("() => { const s = window.__NET__ && window.__NET__.status(); return s && s.kind === 'room' && s.room.members.filter((m) => m.conn).length === 2 ? true : null; }", 30)
        check("%s: both rooms list 2 connected players" % tag, bool(two(A)) and bool(two(B)))
        check("%s: B's room code equals A's" % tag, room_code(B) == code, "%s / %s" % (room_code(B), code))
        a_start = A.ev("() => { const b = document.getElementById('dfo-start'); return b && !b.closest('[hidden]') ? !b.disabled : null; }")
        b_start = B.ev("() => { const b = document.getElementById('dfo-start'); return !!b && !b.closest('[hidden]') && getComputedStyle(b).display !== 'none'; }")
        check("%s: A (owner) has START enabled, B (guest) has none" % tag, a_start is True and not b_start, "A %s · B %s" % (a_start, b_start))
        A.shot("l1_room_two")
        B.shot("l1_room_two")
        A.click("#dfo-start")
        for p in pages:
            check("%s: %s's screens hid for the match" % (tag, p.name), bool(p.wait("() => (%s)() === null || null" % SCREEN_JS, 60)), str(p.screen()))
        ok = [match_ran(A, tag), match_ran(B, tag)]
        A.shot("l1_match")
        if not all(ok):
            return
        res = wait_post(pages, netdur, tag)
        for p, r in zip(pages, res):
            check("%s: %s got the post-match controls" % (tag, p.name), r, str(p.ev(POST_JS)))
        a_b, b_b = A.ev(POST_JS), B.ev(POST_JS)
        check("%s: owner A: PLAY AGAIN + LEAVE; guest B: LEAVE" % tag, a_b == ["PLAY AGAIN", "LEAVE"] and b_b == ["LEAVE"], "%s / %s" % (a_b, b_b))
        for p in pages:
            check("%s: %s's slate shows the online buttons instead of its own" % (tag, p.name), p.ev(OWN_BTNS_JS) == "none", str(p.ev(OWN_BTNS_JS)))
        A.shot("l1_post")
        B.shot("l1_post")
        A.click("#dfo-again")
        for p in pages:
            check("%s: PLAY AGAIN → %s shows the room screen again" % (tag, p.name), bool(p.wait_screen("room", 60)), str(p.screen()))
        for p in pages:
            gone = p.ev(SLATE_JS) is False and p.ev(BADGE_JS) is None
            check("%s: %s's victory slate and match HUD are gone" % (tag, p.name), gone, "slate %s badge %s" % (p.ev(SLATE_JS), p.ev(BADGE_JS)))
            check("%s: %s's lobby backdrop runs behind the room" % (tag, p.name), lobby_alive(p), str(p.ev(PHASE_JS)))
        A.shot("l1_again_A")
        B.click(".dfo-s-room .dfm-back")
        check("%s: B LEAVE → home" % tag, bool(B.wait_screen("home", 30)), str(B.screen()))
        one = A.wait("() => { const s = window.__NET__ && window.__NET__.status(); return s && s.kind === 'room' && s.room.members.filter((m) => m.conn).length === 1 ? true : null; }", 30)
        check("%s: A sees B gone (1 player)" % tag, bool(one))
        s_dis = A.ev("() => { const b = document.getElementById('dfo-start'); return b ? b.disabled : null; }")
        check("%s: A's START is disabled again" % tag, s_dis is True, str(s_dis))
        A.click(".dfo-s-room .dfm-back")
        check("%s: A LEAVE → home" % tag, bool(A.wait_screen("home", 30)), str(A.screen()))
    finally:
        for p in pages:
            check("%s: %s no page errors" % (tag, p.name), not p.real_errors(), "; ".join(p.real_errors()[-3:]) or "none")
            p.close()


# ───────────────────────────── L2: quick match + failed rematch ─────────────────────────────
def scenario_l2(browser, base, relay, netdur):
    tag = "L2"
    A = Page(browser, "A", url_for(base, relay, 41, netdur))
    B = Page(browser, "B", url_for(base, relay, 42, netdur))
    pages = [A, B]
    try:
        for p in pages:
            if not check("%s: %s opened PLAY ONLINE" % (tag, p.name), open_online(p), str(p.screen())):
                return
        for p in pages:
            watch_search(p)
            p.click("#dfo-door-qm")
        for p in pages:
            check("%s: %s is searching" % (tag, p.name), bool(p.wait("() => (%s)() ? true : null" % SEARCH_JS, 20)), str(p.ev(SEARCH_JS)))
        for p in pages:
            p.wait("() => !(%s)() || null" % SEARCH_JS, 1)      # (the screens hide for the match below)
        for p in pages:
            check("%s: %s's screens hid for the match" % (tag, p.name), bool(p.wait("() => (%s)() === null || null" % SCREEN_JS, 90)), str(p.screen()))
        ok = [match_ran(A, tag), match_ran(B, tag)]
        if not all(ok):
            return
        res = wait_post(pages, netdur, tag)
        for p, r in zip(pages, res):
            check("%s: %s got the post-match controls" % (tag, p.name), r, str(p.ev(POST_JS)))
        for p in pages:
            check("%s: %s: REMATCH + LEAVE (quick room)" % (tag, p.name), p.ev(POST_JS) == ["REMATCH", "LEAVE"], str(p.ev(POST_JS)))
        print("   info %s: search states seen A %s · B %s" % (tag, seen_search(A), seen_search(B)), flush=True)
        A.shot("l2_post")
        # the lone REMATCH is the HOST's (the harder case: the host leaves the room it hosted) — the guest then only waits
        V = host_page(pages) or A
        W = B if V is A else A
        V.click("#dfo-rematch")
        lab = V.ev("() => { const b = document.getElementById('dfo-rematch'); return b ? b.textContent : null; }")
        print("   info %s: %s (host=%s) pressed REMATCH -> %r" % (tag, V.name, V is not None and 'HOST' in (V.ev(BADGE_JS) or 'HOST'), lab), flush=True)
        # only V voted: the Room re-queues V when its window ends (REMATCH_WINDOW_S, 8 s on the test relay)
        back = V.wait("() => { const s = (%s)(); return s === 'search' ? true : null; }" % SCREEN_JS, 240)
        check("%s: %s (the lone REMATCH) is back on the search card after the window" % (tag, V.name), bool(back), "%s / %s" % (V.screen(), V.ev(SEARCH_JS)))
        if not back:
            print("   info %s: api log %s" % (tag, json.dumps(V.ev("() => window.__NET__.api.log"))), flush=True)
            print("   info %s: status %s" % (tag, json.dumps(V.ev("() => window.__NET__.status()"))[:300]), flush=True)
        A, B = V, W
        check("%s: %s's victory slate and match HUD are gone" % (tag, A.name), A.ev(SLATE_JS) is False and A.ev(BADGE_JS) is None, "slate %s badge %s" % (A.ev(SLATE_JS), A.ev(BADGE_JS)))
        check("%s: %s's lobby backdrop runs behind the search card" % (tag, A.name), lobby_alive(A), str(A.ev(PHASE_JS)))
        A.shot("l2_requeued")
        B.click("#dfo-post-leave")
        check("%s: %s LEAVE → PLAY ONLINE home" % (tag, B.name), bool(B.wait_screen("home", 60)), str(B.screen()))
        A.click("#dfo-cancel")
        check("%s: %s CANCEL → home" % (tag, A.name), bool(A.wait_screen("home", 60)), str(A.screen()))
    finally:
        for p in pages:
            check("%s: %s no page errors" % (tag, p.name), not p.real_errors(), "; ".join(p.real_errors()[-3:]) or "none")
            p.close()


# ───────────────────────────── L3: solo → PLAY VS BOTS ─────────────────────────────
def scenario_l3(browser, base, relay, netdur):
    tag = "L3"
    C = Page(browser, "C", url_for(base, relay, 51, netdur))
    try:
        if not check("%s: C opened PLAY ONLINE" % tag, open_online(C), str(C.screen())):
            return
        # BACK → the title with the PLAY ONLINE tile focused (Menus.returnFromOnline); the tile → the screens again (the real hook)
        C.click(".dfo-s-home .dfm-back")
        back = C.wait("() => { const m = document.getElementById('df-menus'); const t = document.getElementById('dfm-play-online'); return m && !m.hidden && t && document.activeElement === t ? true : null; }", 30)
        check("%s: BACK from PLAY ONLINE → the title, PLAY ONLINE focused" % tag, bool(back), "%s / active %s" % (C.screen(), C.ev("() => document.activeElement && (document.activeElement.id || document.activeElement.className)")))
        C.click("#dfm-play-online")
        check("%s: the title's PLAY ONLINE tile reopens the screens (main.ts's real hook)" % tag, bool(C.wait_screen("home", 30)), str(C.screen()))
        C.click("#dfo-mode-ffa")
        C.click("#dfo-rule-washout")
        C.click("#dfo-door-qm")
        check("%s: alone → NO ONE ELSE YET" % tag, bool(C.wait("() => (%s)() === 'solo' || null" % SEARCH_JS, 60)), str(C.ev(SEARCH_JS)))
        C.shot("l3_solo")
        C.click("#dfo-bots")
        check("%s: the online screens are gone" % tag, bool(C.wait("() => (%s)() === null || null" % SCREEN_JS, 30)), str(C.screen()))
        ph = C.wait("() => (%s)() === 'play' || null" % PHASE_JS, 150)
        check("%s: PLAY VS BOTS started an offline match" % tag, bool(ph), str(C.ev(PHASE_JS)))
        info = C.ev("() => { try { const s = window.__DF__.state(); return { matchMode: s.matchMode, phase: s.phase, wash: /wash/i.test(document.body.innerText) }; } catch (e) { return null; } }")
        check("%s: it is FREE-FOR-ALL · WASHOUT (the choice made on the home screen)" % tag, bool(info) and info.get("matchMode") == "ffa" and info.get("wash") is True, json.dumps(info))
        C.shot("l3_bots")
        st = C.ev("() => window.__NET__ ? window.__NET__.status() : null") or {}
        check("%s: the api is idle (no online session left behind)" % tag, st.get("kind") == "idle", json.dumps(st)[:200])
        time.sleep(4)
        check("%s: still ONE offline match 4 s later (no second start)" % tag, C.ev(PHASE_JS) in ("play", "countdown"), str(C.ev(PHASE_JS)))
    finally:
        check("%s: C no page errors" % tag, not C.real_errors(), "; ".join(C.real_errors()[-3:]) or "none")
        C.close()


# ───────────────────────────── L4: ?room= deep link + invite link ─────────────────────────────
def scenario_l4(browser, base, relay, netdur):
    tag = "L4"
    A = Page(browser, "A", url_for(base, relay, 61, netdur))
    B = None
    try:
        if not check("%s: A opened PLAY ONLINE" % tag, open_online(A), str(A.screen())):
            return
        A.click("#dfo-door-create")
        check("%s: A has a room" % tag, bool(A.wait_screen("room", 60)), str(A.screen()))
        code = room_code(A)
        inv = A.ev("() => window.__NET__.api.inviteUrl()") or ""
        check("%s: the invite link carries the code (?room=%s)" % (tag, code), ("room=" + code) in inv, inv)
        check("%s: COPY INVITE LINK is offered" % tag, A.ev("() => { const b = document.getElementById('dfo-copy-link'); return !!b && !b.closest('[hidden]'); }") is True)
        # a friend opens the invite: the standalone page, JOIN ROOM pre-filled
        B = Page(browser, "B", url_for(base, relay, 62, netdur, {"room": code}))
        check("%s: the ?room= link opens JOIN ROOM with the code filled" % tag,
              bool(B.wait_screen("join", 120)) and (B.ev("() => document.getElementById('dfo-code') ? document.getElementById('dfo-code').value : null") or "") == code,
              "%s / %s" % (B.screen(), B.ev("() => document.getElementById('dfo-code') && document.getElementById('dfo-code').value")))
        B.shot("l4_deeplink")
        B.click("#dfo-join-go")
        check("%s: JOIN from the deep link lands in A's room" % tag, bool(B.wait_screen("room", 60)) and room_code(B) == code, "%s %s" % (B.screen(), room_code(B)))
        check("%s: A sees B arrive" % tag, bool(A.wait("() => { const s = window.__NET__.status(); return s.kind === 'room' && s.room.members.filter((m) => m.conn).length === 2 ? true : null; }", 40)))
        names = A.ev("() => window.__NET__.status().room.members.map((m) => m.name)") or []
        check("%s: unnamed players are GUEST-XXXX, and different" % tag, len(names) == 2 and all(re.match(r"^GUEST-[A-Z2-9]{4}$", n or "") for n in names) and names[0] != names[1], str(names))
        # a wrong code
        C = Page(browser, "C", url_for(base, relay, 63, netdur, {"room": "ZZZZ"}))
        try:
            check("%s: a dead code → the JOIN screen, then NO ROOM WITH THAT CODE" % tag, bool(C.wait_screen("join", 120)))
            C.click("#dfo-join-go")
            check("%s: the not-found card appears" % tag, bool(C.wait("() => (%s)() === 'notice' || null" % SCREEN_JS, 60)) and C.ev(NOTICE_JS) == "not_found", "%s / %s" % (C.screen(), C.ev(NOTICE_JS)))
            C.shot("l4_notfound")
        finally:
            check("%s: C no page errors" % tag, not C.real_errors(), "; ".join(C.real_errors()[-3:]) or "none")
            C.close()
    finally:
        for p in (A, B):
            if p:
                check("%s: %s no page errors" % (tag, p.name), not p.real_errors(), "; ".join(p.real_errors()[-3:]) or "none")
                p.close()


def relay_up(relay: str) -> bool:
    import urllib.request
    try:
        u = relay.replace("ws://", "http://").replace("wss://", "https://").rstrip("/") + "/health"
        with urllib.request.urlopen(u, timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5223/")
    ap.add_argument("--relay", default="ws://127.0.0.1:8797")
    ap.add_argument("--netdur", type=int, default=20)
    ap.add_argument("--scenarios", default="L1,L2,L3,L4")
    ap.add_argument("--headless", action="store_true", help="accepted for symmetry: this gate is always headless")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright
    t0 = time.time()
    if not relay_up(args.relay):
        print("SETUP FAILED: no relay answers at %s/health — start `wrangler dev --local` in workers/dyefield-net (see the header)" % args.relay)
        return 2
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    srv = None
    try:
        from common import ensure_server, stop_server
        srv = ensure_server(args.base)
    except Exception as e:
        print("SETUP FAILED: dev server:", str(e)[:300])
        return 2
    try:
        return run_all(args, t0)
    finally:
        try:
            stop_server(srv)
        except Exception:
            pass


def run_all(args, t0) -> int:
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch(channel="chrome", headless=True, args=FLAGS)
        except Exception as e:
            print("SETUP FAILED:", e)
            return 2
        for sc in [s.strip() for s in args.scenarios.split(",") if s.strip()]:
            print("── " + sc, flush=True)
            try:
                {"L1": scenario_l1, "L2": scenario_l2, "L3": scenario_l3, "L4": scenario_l4}[sc](browser, args.base, args.relay, args.netdur)
            except Exception as e:
                check("%s: harness exception" % sc, False, "%s: %s" % (type(e).__name__, str(e).splitlines()[0][:240]))
        browser.close()
    bad = [c for c in checks if not c["pass"]]
    print("NETLOBBY LIVE %s — %d checks, %d failed, %d s" % ("OK" if not bad else "FAIL", len(checks), len(bad), time.time() - t0))
    for c in bad:
        print("  FAILED: %s — %s" % (c["name"], c["detail"]))
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
