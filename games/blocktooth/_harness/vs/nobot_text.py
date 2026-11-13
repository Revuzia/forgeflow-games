#!/usr/bin/env python
"""BLOCKTOOTH NO-BOT-TEXT live gate (owner request 2026-10-06: the game must never say BOT / BOTS; the other seats read as players).

    python _harness/vs/nobot_text.py --base http://localhost:5961/ --no-serve [--headless]
    python _harness/vs/nobot_text.py --two-windows      # ALSO a second real game window that joins the room and leaves (the leave notice)

ONE real Chrome, one screen at a time, the real menus through real keys (and the real Supabase Realtime on a unique ?ns= so no real
player's room can match). At EVERY state below the harness reads what a player can read and asserts it matches NONE of /\\bbots?\\b/i:

  * document.title
  * document.body.innerText (what is rendered) AND the body's textContent without script / style (also the hidden nodes: a hidden
    chip that still says BOT is a defect), every aria-label / aria-description / title / alt / placeholder / value attribute,
    and the <meta name="description">

States: title -> ONLINE VS select (titan, city) -> online menu -> QUICK MATCH lobby (searching, dial) -> room-code entry -> CREATE ROOM
lobby (host: START NOW) -> loading / countdown -> in-match HUD (seat cards + standings, phase banners OPEN HOUSE / HOSTILE TAKEOVER /
FINAL NOTICE, KO feed, a local KO stamp, spectate after elimination, a takeover) -> end card -> back to the title -> VS PRACTICE select
(RIVAL SKILL row, every level) -> VS PRACTICE match HUD -> end card. With --two-windows a second game window joins the room code, plays,
and closes: the first window's notice line (a player LEFT THE MATCH) is scanned.
A screenshot is saved per state to _harness/scratch/bosshp/NOBOT/shots/ (READ some).

Also asserts the positive copy: no BOT chip on any seat card, the local seat chip says YOU, every other seat shows a handle (a
rival name, never UNIT n), the lobby says START NOW / SEC TO START, VS PRACTICE says RIVAL SKILL.

Exit 0 = every state clean · 1 = a hit / a failed expectation · 2 = never got far enough · 3 = NOT RUN (environment).
"""
import argparse
import json
import os
import random
import re
import string
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "_harness"))
import common as C  # noqa: E402

BOT_RE = re.compile(r"\bbots?\b", re.I)
OUT = os.path.join(ROOT, "_harness", "scratch", "bosshp", "NOBOT", "shots")

SCAN_JS = r"""
() => {
  const attrs = [];
  const names = ['aria-label', 'aria-description', 'aria-roledescription', 'title', 'alt', 'placeholder', 'value', 'label'];
  for (const el of document.querySelectorAll('*')) {
    for (const n of names) { const v = el.getAttribute && el.getAttribute(n); if (v) attrs.push(n + '=' + v); }
  }
  const clone = document.body ? document.body.cloneNode(true) : null;
  if (clone) for (const x of clone.querySelectorAll('script, style, noscript')) x.remove();
  const meta = document.querySelector('meta[name="description"]');
  return {
    title: document.title || '',
    inner: document.body ? document.body.innerText : '',
    content: clone ? clone.textContent : '',
    attrs,
    meta: meta ? meta.getAttribute('content') || '' : '',
  };
}
"""

DOM_JS = r"""
() => {
  const q = (s) => Array.from(document.querySelectorAll(s));
  const vis = (e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 1 && r.height > 1 && c.display !== 'none' && c.visibility !== 'hidden'; };
  const seats = q('[data-v2="vs-seat"]').map((c) => ({
    name: (c.querySelector('.bt-vs-seat-name b') || {}).textContent || '',
    chips: Array.from(c.querySelectorAll('.bt-vs-seat-name .bt-vs-chip')).filter((x) => !x.classList.contains('crown')).map((x) => ({ t: x.textContent, hidden: x.classList.contains('bt-hidden') || !vis(x) })),
  }));
  const rows = q('[data-v2="vs-row"]').map((r) => ({ who: (r.querySelector('.bt-vsend-who b') || {}).textContent || '', chips: r.querySelectorAll('.bt-vs-chip').length }));
  return { seats, rows };
}
"""


class Gate:
    def __init__(self, sess):
        self.s = sess
        self.n = 0
        self.fail = []
        self.checks = 0
        self.log = []

    def shot(self, label):
        os.makedirs(OUT, exist_ok=True)
        self.n += 1
        p = os.path.join(OUT, "%02d_%s.png" % (self.n, label))
        self.s.screenshot(p)
        return p

    def check(self, name, ok, detail=""):
        self.checks += 1
        line = ("  ok   " if ok else "  FAIL ") + name + ((" - " + str(detail)[:300]) if detail else "")
        print(line, flush=True)
        if not ok:
            self.fail.append(name)

    def scan(self, label, page=None):
        """assert no /\\bbots?\\b/i anywhere a player can read, then screenshot"""
        s = self.s
        try:
            d = (page or s.page).evaluate(SCAN_JS)
        except Exception as e:  # a navigation in flight
            time.sleep(0.5)
            d = (page or s.page).evaluate(SCAN_JS)
        hits = []
        for key in ("title", "inner", "content", "meta"):
            for m in BOT_RE.finditer(d.get(key) or ""):
                a = max(0, m.start() - 40)
                hits.append("%s: ...%s..." % (key, (d[key] or "")[a:m.end() + 40].replace("\n", " | ")))
        for a in d.get("attrs") or []:
            if BOT_RE.search(a):
                hits.append("attr: " + a[:120])
        self.check("%s: no BOT/BOTS in title / text / hidden text / attributes" % label, not hits, hits[:4])
        if page is None:
            self.shot(label)
        txt = (d.get("inner") or "").upper().replace("\n", " | ")
        self.log.append((label, txt[:400]))
        return d, txt

    def text(self):
        return (self.s.safe_js("() => document.body ? document.body.innerText : ''", default="") or "").upper()

    def wait_text(self, needle, timeout_s=30, poll=0.4):
        t0 = time.time()
        while time.time() - t0 < timeout_s:
            if needle.upper() in self.text():
                return True
            time.sleep(poll)
        return False


def vs_state(s):
    return s.safe_js("() => { try { const B = window.__BT__; return B && B.vs ? B.vs.state() : null; } catch (e) { return null; } }", default=None)


def vs_dom(s):
    return s.safe_js("() => { try { const B = window.__BT__; return B && B.vs ? B.vs.dom() : null; } catch (e) { return null; } }", default=None)


def dev(s, call):
    """B.vs.dev.<call> (the VS dev cheats; ?dev=1). Returns the value or an 'ERR:' string."""
    return s.safe_js("() => { try { return window.__BT__.vs.dev.%s; } catch (e) { return 'ERR:' + String(e && e.message || e); } }" % call, default="ERR:eval")


def walk_online(g, s, args, ns):
    """title -> ONLINE select -> menu -> QUICK MATCH lobby -> code entry -> CREATE ROOM lobby -> START NOW -> match"""
    ok, scr = s.wait_screen(["title"], 90)
    g.check("title screen reached", ok, scr)
    if not ok:
        return False
    time.sleep(1.5)
    g.scan("title")
    s.press("o")
    time.sleep(2.0)
    ok, _ = s.wait_screen(["select"], 30)
    g.check("ONLINE VS opens the select screen", ok, s.screen())
    time.sleep(1.2)
    g.scan("online_select_titan")
    # confirm the titan step, find the online menu
    for _ in range(5):
        if g.wait_text("QUICK MATCH", 2):
            break
        s.press("Enter")
        time.sleep(1.2)
    g.check("online menu shows QUICK MATCH / CREATE ROOM / JOIN WITH CODE", all(w in g.text() for w in ("QUICK MATCH", "CREATE ROOM", "JOIN WITH CODE")))
    _, txt = g.scan("online_menu")
    g.check("online menu copy: FIND A FIGHT / JUMP IN, no 'EMPTY SEAT' filler talk", "FIND A FIGHT" in txt and "JUMP IN" in txt and "FILL" not in txt, txt[:160])

    # QUICK MATCH -> city -> lobby
    s.press("Enter")
    time.sleep(1.5)
    g.scan("online_quick_city")
    s.press("Enter")
    t0 = time.time()
    seats = 0
    while time.time() - t0 < 40:
        seats = s.safe_js("() => document.querySelectorAll('.bt-lob-seat').length", default=0)
        if seats:
            break
        time.sleep(0.5)
    g.check("QUICK MATCH lobby appears with 4 seat cards", seats == 4, "seats=%s" % seats)
    time.sleep(2.5)
    _, txt = g.scan("lobby_quick_searching")
    g.check("quick lobby: FINDING PLAYERS + MATCH STARTS IN n S + SEC TO START + START NOW",
            "FINDING PLAYERS" in txt and "MATCH STARTS IN" in txt and "SEC TO START" in txt and "START NOW" in txt and "WITH" not in txt.split("START NOW")[-1][:6], txt[:300])
    g.check("quick lobby: the empty seats say SEAT OPEN / SEARCHING", "SEAT OPEN" in txt, txt[:300])
    time.sleep(3)
    g.scan("lobby_quick_searching_later")
    s.press("Escape")
    time.sleep(2.0)
    g.check("Esc leaves the lobby to the online menu", g.wait_text("QUICK MATCH", 10))
    g.scan("online_menu_again")

    # JOIN WITH CODE -> the code entry view
    s.press("3")                      # pick3 = JOIN WITH CODE
    time.sleep(1.5)
    g.scan("code_entry")
    s.press("Escape")
    time.sleep(1.2)
    if not g.wait_text("QUICK MATCH", 6):
        s.press("Escape")
        time.sleep(1.0)
    g.check("back on the online menu", g.wait_text("QUICK MATCH", 10))

    # CREATE ROOM -> city -> room lobby
    s.press("2")                      # pick2 = CREATE ROOM
    time.sleep(1.5)
    g.scan("online_create_city")
    s.press("Enter")
    t0 = time.time()
    seats = 0
    while time.time() - t0 < 40:
        seats = s.safe_js("() => document.querySelectorAll('.bt-lob-seat').length", default=0)
        if seats:
            break
        time.sleep(0.5)
    g.check("room lobby appears with 4 seat cards", seats == 4, "seats=%s" % seats)
    time.sleep(3.0)
    _, txt = g.scan("lobby_room_host")
    g.check("room lobby: ROOM OPEN + START WHEN READY + START NOW + a room code", "ROOM OPEN" in txt and "START WHEN READY" in txt and "START NOW" in txt and "ROOM CODE" in txt, txt[:300])
    room = s.safe_js("() => Array.from(document.querySelectorAll('.bt-lob-code i')).map((e) => e.textContent).join('')", default="") or ""
    g.log.append(("room_code", room))
    return room or True


def to_match_online(g, s):
    """START NOW (host) -> loading -> countdown -> play"""
    s.press("Enter")
    t0 = time.time()
    seen_loading = False
    while time.time() - t0 < 120:
        scr = s.screen()
        txt = g.text()
        if not seen_loading and ("LOADING" in txt or scr == "loading"):
            seen_loading = True
            g.scan("online_loading")
        if scr == "play" or (scr == "slate"):
            break
        time.sleep(0.5)
    st = vs_state(s)
    g.check("the online match starts (screen=%s, phase=%s)" % (s.screen(), (st or {}).get("phase")), bool(st) and (st.get("phase") in ("countdown", "open", "takeover")), "" if st else "no VS state")
    return bool(st)


def hud_checks(g, s, label, expect_online):
    """seat cards: the local one says YOU, nobody carries a BOT chip / UNIT call-sign"""
    d = s.safe_js(DOM_JS, default={"seats": [], "rows": []}) or {}
    seats = d.get("seats") or []
    g.check("%s: 4 seat cards" % label, len(seats) == 4, [x.get("name") for x in seats])
    visible_chips = [(x["name"], c["t"]) for x in seats for c in x["chips"] if not c["hidden"]]
    g.check("%s: exactly one visible seat chip, and it says YOU" % label, len(visible_chips) == 1 and visible_chips[0][1] == "YOU", visible_chips)
    names = [x["name"] for x in seats]
    g.check("%s: rival seats read as player names (no UNIT n, no call-sign line), all distinct" % label,
            all(n and not n.upper().startswith("UNIT") for n in names) and len(set(names)) == len(names), names)
    return names


def run_match_states(g, s, label, online):
    # wait for the VS HUD to exist (the loading card / slate come first; a loaded GPU makes this slow: information, not a gate)
    t0 = time.time()
    while time.time() - t0 < 90 and len((s.safe_js(DOM_JS, default={"seats": []}) or {}).get("seats") or []) < 4:
        time.sleep(0.5)
    time.sleep(1.0)
    g.scan(label + "_countdown_or_early")
    names = hud_checks(g, s, label + " HUD", online)
    # the countdown -> OPEN HOUSE
    t0 = time.time()
    while time.time() - t0 < 120:
        st = vs_state(s)
        if st and st.get("phase") == "open":
            break
        time.sleep(0.5)
    time.sleep(1.5)
    d, txt = g.scan(label + "_open_house")
    g.check("%s: the phase text is OPEN HOUSE" % label, "OPEN HOUSE" in txt, txt[:200])
    # dev cheats: phases, KO feed, local KO stamp, spectate, end card (set-up only; the keys are real)
    r = dev(s, "jump(300)")
    time.sleep(2.5)
    d, txt = g.scan(label + "_takeover")
    g.check("%s: HOSTILE TAKEOVER phase on screen after the dev jump (%r)" % (label, r), "HOSTILE TAKEOVER" in txt or "TAKEOVER" in txt or (vs_state(s) or {}).get("phase") == "takeover", txt[:200])
    # a rival KO feed line, the local KO stamp (EVICTED BY)
    dev(s, "ko(2, 1)")
    time.sleep(1.2)
    g.scan(label + "_ko_feed_rival")
    dev(s, "ko(0, 2)")
    time.sleep(1.5)
    d, txt = g.scan(label + "_ko_stamp_local")
    g.check("%s: the local KO stamp reads EVICTED BY a titan tag" % label, "EVICTED" in txt, txt[:200])
    time.sleep(6.0)
    dev(s, "jump(430)")
    time.sleep(2.5)
    g.scan(label + "_final_notice")
    # eliminate the local seat -> spectate bar names the followed rival (titan + handle, no BOT)
    dev(s, "eliminate(0, 3)")
    on = False
    for _ in range(160):                          # killer-follow (2.5 s of GAME time) first, then spectate; a loaded GPU runs slower than real time
        time.sleep(0.5)
        on = (vs_dom(s) or {}).get("specOn")
        if on:
            break
    time.sleep(1.0)
    st = vs_state(s)
    g.log.append((label + "_state", json.dumps({k: (st or {}).get(k) for k in ("phase", "view", "local")})))
    d, txt = g.scan(label + "_spectate")
    g.check("%s: the spectate bar is on after the local elimination" % label, bool(on), on)
    # the spectate bar names a rival with its handle
    spec = s.safe_js("() => { const e = document.querySelector('.bt-vs-spec, [data-v2=\"vs-spec\"]'); return e ? e.innerText : ''; }", default="") or ""
    g.log.append((label + "_spectate_text", spec.replace("\n", " | ")))
    s.press("e")
    time.sleep(1.2)
    g.scan(label + "_spectate_cycled")
    # the end card
    dev(s, "end(1)")
    t0 = time.time()
    while time.time() - t0 < 45:
        if "FINAL EDITION" in g.text():
            break
        time.sleep(0.5)
    time.sleep(2.5)
    d, txt = g.scan(label + "_end_card")
    g.check("%s: the end card is up (FINAL EDITION)" % label, "FINAL EDITION" in txt or "ZONING DISPUTE" in txt, txt[:200])
    rows = (s.safe_js(DOM_JS, default={}) or {}).get("rows") or []
    g.check("%s: end card: 4 rows, no chip on any row, rival rows show 'TITAN · NAME'" % label,
            len(rows) == 4 and all(r["chips"] == 0 for r in rows) and sum(1 for r in rows if "·" in r["who"]) >= 3, rows)
    return names


def back_to_title(g, s, timeout_s=40):
    for _ in range(8):
        if s.screen() == "title":
            return True
        s.press("Escape")
        time.sleep(1.0)
        if s.screen() == "title":
            return True
        s.press("Enter")
        time.sleep(1.0)
    return s.wait_screen(["title"], timeout_s)[0]


def walk_practice(g, s):
    if not back_to_title(g, s):
        g.check("returned to the title screen", False, s.screen())
        return False
    time.sleep(1.5)
    s.press("v")
    ok, _ = s.wait_screen(["select"], 20)
    g.check("VS PRACTICE opens the select screen", ok, s.screen())
    time.sleep(1.5)
    _, txt = g.scan("practice_select_titan")
    # step 1 -> step 2 (NEXT): the city step carries the RIVAL SKILL row
    s.press("Enter")
    time.sleep(1.2)
    _, txt = g.scan("practice_select_city")
    g.check("VS PRACTICE select (city step): RIVAL SKILL row + THE OTHER THREE TITANS", "RIVAL SKILL" in txt and "THE OTHER THREE TITANS" in txt, txt[:400])
    s.press("ArrowDown")                      # focus the skill row, then cycle its three levels with real keys
    time.sleep(0.4)
    levels = []
    for _ in range(3):
        s.press("ArrowLeft")
        time.sleep(0.5)
        t = g.text()
        levels.append(t)
        g.scan("practice_select_skill_%d" % len(levels))
    seen = "".join(levels)
    g.check("VS PRACTICE select: the skill row offers EASY / REGULAR / HARD (no ROOKIE / VETERAN / BOTS)",
            "EASY" in seen and "HARD" in seen and "ROOKIE" not in seen and "VETERAN" not in seen, [t[t.find("RIVAL SKILL"):][:160] for t in levels])
    return True


def to_match_practice(g, s):
    """Enter on the select screen starts the match (START THE DISPUTE); then the loading card / slate -> play"""
    t0 = time.time()
    last = 0.0
    while time.time() - t0 < 120:
        if (vs_state(s) or {}).get("phase") in ("countdown", "open", "takeover"):
            return True
        if s.screen() in ("select", "slate") and time.time() - last > 2.0:
            s.press("Enter")
            last = time.time()
        time.sleep(0.5)
    return False


def key2(p2, key, hold_ms=60):
    p2.keyboard.down(key)
    time.sleep(hold_ms / 1000.0)
    p2.keyboard.up(key)


def p2_text(p2):
    try:
        return (p2.evaluate("() => document.body ? document.body.innerText : ''") or "").upper()
    except Exception:
        return ""


def two_window_notice(g, s, args, ns):
    """Window A (the main session) creates a room; window B (a second REAL game page) joins by the invite link; A starts; the match runs
    with two people; B closes its page: A must read '<B's name> LEFT THE MATCH' (no word bot) and keep B's seat card name."""
    if not back_to_title(g, s):
        g.check("two-windows: back at the title", False, s.screen())
        return
    time.sleep(1.2)
    s.press("o")
    time.sleep(2.0)
    for _ in range(5):
        if g.wait_text("QUICK MATCH", 2):
            break
        s.press("Enter")
        time.sleep(1.2)
    s.press("2")
    time.sleep(1.5)
    s.press("Enter")                                  # the city step
    t0 = time.time()
    while time.time() - t0 < 40 and not s.safe_js("() => document.querySelectorAll('.bt-lob-seat').length", default=0):
        time.sleep(0.5)
    time.sleep(2.5)
    room = s.safe_js("() => Array.from(document.querySelectorAll('.bt-lob-codebig i')).map((e) => e.textContent).join('')", default="") or ""
    g.check("two-windows: window A has a room code", len(room) >= 4, room)
    if len(room) < 4:
        return
    # window B = its OWN Chrome (a second tab of one Chrome is a background tab: its frames would not run and the lockstep would wait)
    b_browser = s._pw.chromium.launch(channel="chrome", headless=bool(getattr(args, "headless", False)), args=C.FLAGS)
    b_ctx = b_browser.new_context(viewport={"width": args.width, "height": args.height}, device_scale_factor=1)
    p2 = b_ctx.new_page()
    p2.set_default_timeout(30000)
    p2.add_init_script(C.INIT_JS)
    try:
        p2.goto("%s?dev=1&quality=0&ns=%s&build=%s&name=SECONDWIN&room=%s" % (args.base, ns, args._build, room), wait_until="load", timeout=60000)
        t0 = time.time()
        joined = False
        while time.time() - t0 < 60:
            tx = p2_text(p2)
            if "SECONDWIN" in tx and "APPLICANT LOBBY" in tx:
                joined = True
                break
            if "JOIN THE ROOM" in tx or "PRESS ENTER" in tx or "PICK YOUR TITAN" in tx or "CONTINUE" in tx:
                key2(p2, "Enter")
            time.sleep(1.2)
        g.check("two-windows: window B joined the lobby", joined, p2_text(p2)[:200])
        g.scan("two_windows_B_lobby", page=p2)
        g.scan("two_windows_A_lobby_two_seats")
        # wait until A sees two seats filled, then start
        t0 = time.time()
        while time.time() - t0 < 30 and "SECONDWIN" not in g.text():
            time.sleep(0.5)
        g.check("two-windows: window A's lobby shows window B's name on a seat", "SECONDWIN" in g.text(), g.text()[:200])
        s.press("Enter")                              # START NOW (host)
        t0 = time.time()
        while time.time() - t0 < 120 and (vs_state(s) or {}).get("phase") not in ("countdown", "open", "takeover"):
            time.sleep(0.5)
        g.check("two-windows: the 2-human match started on A", (vs_state(s) or {}).get("phase") in ("countdown", "open", "takeover"))
        # both windows load, then the countdown runs and the match clock advances
        t0 = time.time()
        while time.time() - t0 < 180:
            st = vs_state(s) or {}
            if st.get("phase") in ("open", "takeover") and len((s.safe_js(DOM_JS, default={"seats": []}) or {}).get("seats") or []) == 4:
                break
            time.sleep(0.5)
        time.sleep(3.0)
        names = hud_checks(g, s, "two-windows A HUD", True)
        g.check("two-windows: window B's name is a rival seat card on A", "SECONDWIN" in names, names)
        g.scan("two_windows_A_hud")
        g.scan("two_windows_B_hud", page=p2)
        try:
            seats_b = (p2.evaluate(DOM_JS) or {}).get("seats") or []
        except Exception:
            seats_b = []
        names_b = [x.get("name") for x in seats_b]
        ai_a = sorted(n for n in names if n not in ("YOU", "SECONDWIN"))
        ai_b = sorted(n for n in names_b if n not in ("YOU", "GATESMOKE"))
        g.check("two-windows: both peers show the SAME names for the two driven seats (and A's name on B)",
                len(ai_a) == 2 and ai_a == ai_b and "GATESMOKE" in names_b, [names, names_b])
        # B leaves (closes its page = the tab-close 'bye'): A reads the leave notice
        p2.goto("about:blank")                         # leaving the page = the tab-close 'bye' (pagehide) the game sends at once
        notice = ""
        t0 = time.time()
        while time.time() - t0 < 40:
            tx = g.text()
            if "LEFT THE MATCH" in tx:
                notice = tx
                break
            time.sleep(0.5)
        g.check("two-windows: A reads 'SECONDWIN LEFT THE MATCH'", "SECONDWIN LEFT THE MATCH" in notice, (notice or g.text())[:300])
        g.scan("two_windows_A_after_leave")
        names2 = hud_checks(g, s, "two-windows A HUD after B left", True)
        g.check("two-windows: the leaver's seat keeps its name (it plays on)", "SECONDWIN" in names2, names2)
    finally:
        for obj in (b_ctx, b_browser):
            try:
                obj.close()
            except Exception:
                pass


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    C.add_common_args(ap)
    ap.add_argument("--two-windows", action="store_true", help="also a second real window that joins and leaves (the leave notice)")
    ap.add_argument("--skip-practice", action="store_true")
    ap.add_argument("--skip-online", action="store_true")
    args = ap.parse_args()
    if args.base == C.DEFAULT_BASE:
        pass
    ns = "nb" + "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))
    args._build = "nobot-" + ns
    results = {"ns": ns}
    exit_code = 0
    try:
        with C.Session(args, "nobot_text") as s:
            g = Gate(s)
            s.goto("%s?dev=1&quality=0&ns=%s&build=%s&name=GATESMOKE" % (args.base, ns, args._build))
            if not s.wait_bt(120):
                print("NOT RUN: __BT__ never appeared")
                return 3
            if not args.skip_online:
                room = walk_online(g, s, args, ns)
                if room and to_match_online(g, s):
                    run_match_states(g, s, "online", True)
                elif room:
                    g.check("online match reached", False)
            if not args.skip_practice:
                if walk_practice(g, s) and to_match_practice(g, s):
                    run_match_states(g, s, "practice", False)
                else:
                    g.check("VS PRACTICE match reached", False, s.screen())
            if args.two_windows:
                two_window_notice(g, s, args, ns)
            # the title once more (after the matches)
            if back_to_title(g, s):
                time.sleep(1.5)
                g.scan("title_after")
            d = s.diagnostics()
            probs = C.diag_problems(d)
            g.check("0 console / page errors, 0 failed requests", not probs, (probs + d.get("consoleErrors", [])[:3] + d.get("pageErrors", [])[:3]) if probs else "")
            # console output a player could open (info / warn / log) must not say BOT either
            bad_console = [t for (k, t) in s.console if BOT_RE.search(t or "")]
            g.check("no console message says BOT/BOTS", not bad_console, bad_console[:3])
            print("\n--- states scanned: %d checks, %d failed ---" % (g.checks, len(g.fail)))
            for label, txt in g.log:
                print("  [%s] %s" % (label, txt[:200]))
            results["checks"] = g.checks
            results["failed"] = g.fail
            exit_code = 1 if g.fail else 0
    except C.HarnessError as e:
        print("NOT RUN (environment): %s" % e)
        return 3
    try:
        os.makedirs(os.path.dirname(OUT), exist_ok=True)
        with open(os.path.join(os.path.dirname(OUT), "nobot_text_last.json"), "w", encoding="utf-8") as f:
            json.dump(results, f, indent=1)
    except Exception:
        pass
    print("nobot_text: %s" % ("CLEAN" if exit_code == 0 else "FAIL"))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
