#!/usr/bin/env python
"""netlive - lane net of parity Waves P2+P3 in a REAL browser: two (or three) pages, the real net.js, lobby and match, real clicks.
Reuses the squadguard_live rig (relay stand-in = BroadcastChannels between the pages of one context; everything above the transport is real).
Promoted from lane net's scratch probe (F:/lc_p23/net/p23_net_live.py) in the P2/P3 fix round, with the independent check's three fixes:
(1) --serve: the in-process server's listen backlog is 256 (the default 5 refused connections under load = false failed-request FAILs) and
it serves --overlay files too; (2) screenshots go under this run's own report dir (_reports/p23_netlive_<stamp>/shots: the scratch copy
wrote into the lane's own F:/lc_p23/net/shots and overwrote its evidence); (3) the wrong-key rejoin is proven IN THE BROWSER: a third
page of the same browser arrives on ?room=CODE with a forged rejoin record for slot 1 in its own tab storage (the real record of the
guest hidden from it) and the host must answer "no" with "wrong rejoin key" - the old row sent the forged hello from the rejoined guest
itself and was refused with "already this peer's slot", so the key check never ran in the browser.

    python _harness/p23/netlive.py --disk                       # cases mode, mode3, match
    python _harness/p23/netlive.py --serve --cases match        # the worktree from an in-process server (backlog 256)
    python _harness/p23/netlive.py --disk --cases match --plant no-order     # negative control: the order rows MUST FAIL
    python _harness/p23/netlive.py --disk --cases match --plant no-revive-gate   # negative control: the early-done row MUST FAIL

CASES
  mode    host + guest lobby (startMatch stubbed): the team-mode row (AUTO / DUOS / TRIOS / SQUADS) on the host, the host's pick on the guest
          ("room" message), START carries teamMode + teamWant + roster teamIds, both stubbed starts get teamMode + each human's teamId
  mode3   three humans: DUOS is disabled on the host, AUTO resolves to TRIOS, START plays trio
  match   host + guest, the REAL match on both pages, then:
            LC-49  every state packet stamped q (per-sender counter) + t (match clock ~= the host's); duplicates (DataChannel + relay copy) dropped;
                   an out-of-order forged packet never pulls the remote body back; a newer one does (positive control)
            C-DBNO the guest's knock rides bit 256 + "revive" down; a revive "done" before a full channel is refused; a full one revives (hp 30)
            LC-14  a smoke cloud made on the guest appears in the host's W.smokes (once, marked _net); a frag throw replays as grenadeThrown {net}
            LC-49  rejoin: the guest's tab reloads on ?room=CODE inside 60 s and gets slot s1 back (its body, its kit); a third page with a
                   forged key for slot 1 is refused ("wrong rejoin key") and stays out of the match
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse

HARNESS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))     # _harness
sys.path.insert(0, HARNESS)
import common as C  # noqa: E402
import squadguard_live as SG  # noqa: E402

SHOTDIR = None          # set in main(): _reports/p23_netlive_<stamp>/shots (never another lane's directory)

# a starved box (other lanes' browsers) can take minutes to paint the lobby: wait for the buttons themselves before the rig's 20 s clicks
_sg_host_create, _sg_guest_join = SG.host_create, SG.guest_join


def _patient(pg, sel, s=240):
    try:
        pg.locator(sel).first.wait_for(state="visible", timeout=s * 1000)
    except Exception:
        pass


def _host_create(pg):
    _patient(pg, 'button:text-is("CREATE ROOM")')
    try:
        st = pg.evaluate("() => ({ phase: __LC__.W.phase, btns: [...document.querySelectorAll('button')].filter((b) => b.offsetWidth > 0).map((b) => b.textContent.trim().slice(0, 24)).slice(0, 30) })")
    except Exception as e:
        raise C.EnvFailure("host page unusable before CREATE ROOM (renderer crash / OOM on the shared box?): %s" % str(e).splitlines()[0][:160])
    print("  (host lobby buttons: %s)" % st, flush=True)
    if "CREATE ROOM" not in st["btns"]:
        shot(pg, "dbg_no_create_room")
        raise C.EnvFailure("CREATE ROOM never painted within 240 s: %s" % st)
    # a real mouse click at the button's centre (the rig's locator.click hung in "waiting for locator" for 20 s on the starved renderer while a plain
    # evaluate answered): retry the click like a player until the room code shows, up to 240 s
    t0 = time.time()
    while time.time() - t0 < 240:
        xy = _btn_xy(pg, "CREATE ROOM")
        if xy:
            pg.mouse.click(xy[0], xy[1])
        if SG.wait(pg, r"() => /Room\s+[A-Z0-9]{4}\s+[-\u2014]/.test(document.body.innerText)", 30):
            import re
            m = re.search(r"Room\s+([A-Z0-9]{4})", SG.lobby(pg)["status"])
            return m.group(1) if m else None
    return None


BTN_XY = r"""(label) => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetWidth > 0 && x.textContent.trim() === label && !x.disabled);
  if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""


def _btn_xy(pg, label):
    try:
        return pg.evaluate(BTN_XY, label)
    except Exception:
        return None


def _guest_join(pg, code):
    _patient(pg, 'button:text-is("JOIN")')
    pg.fill('input[placeholder="CODE"]', code, timeout=120_000)
    xy = _btn_xy(pg, "JOIN")
    if xy:
        pg.mouse.click(xy[0], xy[1])
    else:
        _sg_guest_join(pg, code)


SG.host_create, SG.guest_join = _host_create, _guest_join

_sg_open_lobby = SG.open_lobby


def _open_lobby(pg, s=420):
    """the rig's open_lobby waits 20 s; a starved renderer (box at 100 % CPU, ~2 GB free) needs minutes - retry like a patient player"""
    t0 = time.time()
    while time.time() - t0 < s:
        try:
            if _sg_open_lobby(pg):
                return True
        except Exception as e:
            print("  (open_lobby retry: %s)" % str(e).splitlines()[0][:120], flush=True)
        pg.wait_for_timeout(2000)
    return False


SG.open_lobby = _open_lobby

_sg_press_start = SG.press_start


def _press_start(pg):
    _patient(pg, 'button:text-is("START MATCH")', 120)
    xy = _btn_xy(pg, "START MATCH")
    if xy:
        pg.mouse.click(xy[0], xy[1])
    else:
        _sg_press_start(pg)


SG.press_start = _press_start

MODE_JS = r"""() => { const r = document.querySelector('[data-net-teammode]'); if (!r) return null;
  const vis = (b) => { const q = b.getBoundingClientRect(); return q.width > 0 && q.height > 0 && getComputedStyle(b).display !== 'none'; };
  return { eff: r.getAttribute('data-net-teammode'), visible: vis(r), text: r.innerText.replace(/\s+/g, ' ').trim(),
           buttons: [...r.querySelectorAll('button')].filter(vis).map((b) => b.textContent.trim() + (b.disabled ? ':disabled' : '') + (b.className.includes('pri') ? ':picked' : '')) }; }"""


MODE_XY = r"""(label) => { const b = [...document.querySelectorAll('[data-net-teammode] button')].find((x) => x.offsetWidth > 0 && x.textContent.trim().startsWith(label) && !x.disabled);
  if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"""


def click_mode(pg, label, s=120):
    """real mouse click at the team-mode button's centre, retried until the row reports the pick (locator.click hung on a starved renderer)"""
    want = {"DUOS": "duo", "TRIOS": "trio", "SQUADS": "squad"}.get(label)
    t0 = time.time()
    while time.time() - t0 < s:
        try:
            xy = pg.evaluate(MODE_XY, label)
        except Exception:
            xy = None
        if xy:
            pg.mouse.click(xy[0], xy[1])
        if SG.wait(pg, "() => { const r = document.querySelector('[data-net-teammode]'); return r && r.getAttribute('data-net-teammode') === %s; }" % json.dumps(want), 10):
            return True
    return False


def plant_route(rig, pg, edit):
    """serve this page's net.js edited (negative controls)"""
    me = urllib.parse.urlparse(rig.origin).netloc

    def pred(url):
        u = urllib.parse.urlparse(url)
        return u.netloc == me and u.path.endswith("/royale/net.js")

    def handler(route):
        body = edit(SG.src_text("runtime/3d/royale/net.js", None))
        route.fulfill(status=200, body=body.encode("utf-8"), headers={"Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store"})
    pg.route(pred, handler)


PLANTS = {
    "no-order": ('const order = (S.rxGate = S.rxGate || new SeqGate()).accept(from, d.q);', 'const order = "new"; (S.rxGate = S.rxGate || new SeqGate());'),
    "no-revive-gate": ('if (!reviveDoneOk(rec, by.id, performance.now(), reviveMs)) {', 'if (false) {'),
}


PLANT_ON = {"no-order": "/host", "no-revive-gate": "/guest"}


def apply_plant(rig, pg, plant):
    if not plant:
        return
    a, b = PLANTS[plant]
    if a not in SG.src_text("runtime/3d/royale/net.js", None):
        raise C.HarnessError("plant %s: anchor moved" % plant)
    plant_route(rig, pg, lambda t: t.replace(a, b, 1))


def shot(pg, name):
    os.makedirs(SHOTDIR, exist_ok=True)
    p = os.path.join(SHOTDIR, name + ".png")
    try:
        pg.screenshot(path=p)
    except Exception as e:
        print("  (screenshot %s failed: %s)" % (name, str(e).splitlines()[0][:100]))
    return p


def boot_pages(rig, args, names, stub=True, plant=None):
    ctx = rig.new_ctx()
    pages = []
    for n in names:
        pg, rec = rig.page(ctx, n)
        # the planted page is the one whose code the row judges: the HOST's order gate drops the forged late packets, the GUEST owns its revive
        if plant and n.endswith(PLANT_ON.get(plant, "/guest")):
            apply_plant(rig, pg, plant)
        pages.append((pg, rec))
    for pg, rec in pages:
        rec.warns = []
        pg.on("console", lambda m, rec=rec: rec.warns.append("%.1f %s" % (time.time(), m.text[:240])) if m.type in ("warning", "error") and len(rec.warns) < 200 else None)
    for pg, rec in pages:
        tb = time.time()
        front(pg)
        if SG.boot_url(pg, args.base, args.boot_timeout) is None:
            raise C.EnvFailure("%s: __LC__ never appeared" % rec.name)
        print("  (%s booted in %.0f s)" % (rec.name, time.time() - tb), flush=True)
    if stub:
        for pg, _ in pages:
            pg.evaluate(SG.STUB_START_JS)
    for pg, rec in pages:
        if not SG.open_lobby(pg):
            raise C.EnvFailure("%s: lobby never opened" % rec.name)
    return ctx, pages


# ─────────────────────────────── case mode ───────────────────────────────
def case_mode(rig, v, args):
    ctx, pages = boot_pages(rig, args, ["mode/host", "mode/guest"])
    (hpg, hrec), (gpg, grec) = pages
    code = SG.host_create(hpg)
    if not code:
        raise C.EnvFailure("mode: no room code")
    SG.guest_join(gpg, code)
    both = SG.wait(hpg, "() => document.body.innerText.includes('2 player')", 30) and SG.wait(gpg, "() => document.body.innerText.includes('2 player')", 30)
    hm = SG.wait(hpg, MODE_JS, 10)
    gm = SG.wait(gpg, "() => { const r = document.querySelector('[data-net-teammode]'); return r && r.getAttribute('data-net-teammode') ? true : null; }", 10)
    gm = gpg.evaluate(MODE_JS)
    v.check("mode: 2 humans in both lobbies", bool(both), {})
    v.check("mode: the host's TEAM MODE row is on screen with AUTO (picked, resolving to DUOS) / DUOS / TRIOS / SQUADS, none disabled for 2 players",
            bool(hm) and hm["visible"] and hm["eff"] == "duo" and len(hm["buttons"]) == 4 and hm["buttons"][0].startswith("AUTO") and ":picked" in hm["buttons"][0]
            and not any(":disabled" in b for b in hm["buttons"]), hm)
    v.check("mode: the guest reads the host's pick (no buttons): 'TEAM MODE: DUOS (HOST'S PICK)'",
            bool(gm) and gm["visible"] and gm["eff"] == "duo" and not gm["buttons"] and "DUOS" in gm["text"] and "HOST" in gm["text"], gm)
    click_mode(hpg, "TRIOS")
    g2 = SG.wait(gpg, "() => { const r = document.querySelector('[data-net-teammode]'); return r && r.getAttribute('data-net-teammode') === 'trio'; }", 10)
    hm2, gm2 = hpg.evaluate(MODE_JS), gpg.evaluate(MODE_JS)
    room_out = SG.msgs(hpg, "room", "out")
    v.check("mode: the host clicks TRIOS -> its button is picked and the guest's line follows within 10 s ('room' {tm: trio, want: trio} on the wire)",
            bool(g2) and any(b.startswith("TRIOS") and ":picked" in b for b in hm2["buttons"]) and "TRIOS" in gm2["text"]
            and any(m["d"].get("tm") == "trio" and m["d"].get("want") == "trio" for m in room_out), {"host": hm2, "guest": gm2, "roomOut": [m["d"] for m in room_out]})
    shot(hpg, "mode_host_lobby")
    shot(gpg, "mode_guest_lobby")
    lob = SG.lobby(hpg)
    SG.press_start(hpg)
    hs = SG.wait(hpg, "() => (window.__SQ_START__ || []).length > 0", 20)
    gs = SG.wait(gpg, "() => (window.__SQ_START__ || []).length > 0", 30)
    hst, gst = hpg.evaluate(SG.STARTS_JS), gpg.evaluate(SG.STARTS_JS)
    st = SG.msgs(hpg, "start", "out")
    sd = st[0]["d"] if st else {}
    v.check("mode: the start on the wire carries teamMode 'trio', teamWant 'trio', the pace in `mode` and teamId 't0' on every roster entry (old fields kept)",
            sd.get("teamMode") == "trio" and sd.get("teamWant") == "trio" and sd.get("mode") in ("standard", "quick")
            and all(r.get("teamId") == "t0" for r in sd.get("roster", [])) and all(k in sd for k in ("seed", "mapId", "gv", "roster")), sd)
    ok = bool(hs) and bool(gs) and hst[0].get("teamMode") == "trio" and gst[0].get("teamMode") == "trio" \
        and all(h.get("teamId") == "t0" for h in hst[0]["humans"] + gst[0]["humans"]) and hst[0]["seed"] == gst[0]["seed"]
    v.check("mode: both pages' startMatch get teamMode 'trio' and each human's teamId (same seed)", ok,
            {"host": hst[:1] and {k: hst[0].get(k) for k in ("teamMode", "humans", "seed", "mode")}, "guest": gst[:1] and {k: gst[0].get(k) for k in ("teamMode", "humans", "seed")}})
    v.check("mode: the lobby keeps squadguard's child order (status = 2nd child, roster before notices) - lobby() still parses",
            bool(lob.get("open")) and "Room" in (lob.get("status") or "") and len(lob.get("roster") or []) == 2, {"status": lob.get("status"), "roster": lob.get("roster")})
    SG.diag(v, "mode", hrec, grec)
    return ctx


def case_mode3(rig, v, args):
    ctx, pages = boot_pages(rig, args, ["mode3/host", "mode3/guest", "mode3/guest2"])
    (hpg, hrec), (gpg, grec), (g2pg, g2rec) = pages
    code = SG.host_create(hpg)
    if not code:
        raise C.EnvFailure("mode3: no room code")
    SG.guest_join(gpg, code)
    SG.wait(hpg, "() => document.body.innerText.includes('2 player')", 30)
    SG.guest_join(g2pg, code)
    three = SG.wait(hpg, "() => document.body.innerText.includes('3 player')", 40)
    hm = SG.wait(hpg, "() => { const r = document.querySelector('[data-net-teammode]'); return r && r.getAttribute('data-net-teammode') === 'trio'; }", 10)
    hm = hpg.evaluate(MODE_JS)
    v.check("mode3: three humans -> AUTO resolves to TRIOS and DUOS is disabled on the host", bool(three) and hm["eff"] == "trio"
            and any(b.startswith("DUOS") and ":disabled" in b for b in hm["buttons"]) and "TRIOS" in hm["buttons"][0], hm)
    shot(hpg, "mode3_host_lobby")
    SG.press_start(hpg)
    ok = [SG.wait(p, "() => (window.__SQ_START__ || []).length > 0", 30) for p in (hpg, gpg, g2pg)]
    sts = [p.evaluate(SG.STARTS_JS) for p in (hpg, gpg, g2pg)]
    v.check("mode3: all three startMatch calls get teamMode 'trio', 3 humans all teamId 't0'",
            all(ok) and all(s and s[0].get("teamMode") == "trio" and len(s[0]["humans"]) == 3 and all(h.get("teamId") == "t0" for h in s[0]["humans"]) for s in sts),
            [s[:1] and {"teamMode": s[0].get("teamMode"), "humans": s[0]["humans"]} for s in sts])
    SG.diag(v, "mode3", hrec, grec)
    v.check("mode3: guest2 - 0 console errors, 0 page errors, 0 failed requests", g2rec.clean(), g2rec.problems())
    return ctx


# ─────────────────────────────── case match ───────────────────────────────
NET_JS = r"""() => { const W = __LC__.W, S = W.net; if (!S) return null;
  const a1 = W.actorById && W.actorById.get('s1'), a0 = W.actorById && W.actorById.get('s0');
  const pos = (a) => a ? [+a.pos.x.toFixed(2), +a.pos.y.toFixed(2), +a.pos.z.toFixed(2)] : null;
  return { id: S.net.id, room: S.net.room, host: S.net.isHost(), t: +W.t.toFixed(2), phase: W.phase, txSeq: S.txSeq | 0,
    order: S.rxGate ? Object.assign({}, S.rxGate.n) : null, relayIn: S.relayIn || null,
    s1: a1 ? { netQ: a1.netQ, netT: a1.netT, downed: !!a1.downed, downedHp: a1.downedHp, hp: a1.hp, isBot: !!a1.isBot, netRemote: !!a1.netRemote, alive: a1.alive,
               tgt: a1.netTarget ? [+a1.netTarget.pos.x.toFixed(2), +a1.netTarget.pos.y.toFixed(2), +a1.netTarget.pos.z.toFixed(2)] : null, pos: pos(a1) } : null,
    s0: a0 ? { netQ: a0.netQ, netT: a0.netT, pos: pos(a0) } : null,
    me: W.player ? { id: W.player.id, pos: pos(W.player), hp: W.player.hp, downed: !!W.player.downed, alive: W.player.alive } : null,
    roster: S.cfg ? S.cfg.roster.map((r) => [r.slot, r.peerId, r.teamId]) : null, teamMode: S.cfg ? S.cfg.teamMode : null,
    smokes: Array.isArray(W.smokes) ? W.smokes.map((s) => ({ x: s.x, z: s.z, r: s.r, net: !!s._net, tx: !!s._tx })) : null,
    rejoinDone: S.rejoinDone || null, refusals: (S.refusals || []).slice(-6), teamCheck: S.teamCheck || null }; }"""

# the guest stops sending its own state (its counter keeps its value) so the probe owns the sequence for a moment
FREEZE_JS = "(on) => { const S = __LC__.W.net; S.lastState = on ? 1e15 : 0; return S.txSeq | 0; }"
# a forged state packet for the guest's own body, straight onto the relay channel (the host's copy of the channel receives it)
FORGE_JS = r"""(o) => { const W = __LC__.W, S = W.net, p = W.player;
  const bc = new BroadcastChannel('fake-sb:ffg:last-circle:' + S.net.room);
  const d = { id: p.id, x: o.x, y: o.y, z: o.z, yw: 0, pt: 0, hp: Math.round(p.hp), sh: Math.round(p.shield || 0), wp: p.weapon && p.weapon.id, f: 0, q: o.q, t: +W.t.toFixed(2) };
  bc.postMessage({ k: 'bc', event: 'msg', payload: { from: S.net.id, t: 'state', d } }); bc.close(); return d; }"""
REJECTS_JS = "() => { const S = window.__LC__.W.net; return S && S.rejected ? S.rejected.last.slice(-8) : []; }"
# the guest stands next to its view of the host's body (both may still be gliding: the revive distance check is 5 m)
CLOSE_JS = "() => { const W = __LC__.W, h = W.actorById.get('s0'), P = W.player; const q = h.netTarget ? h.netTarget.pos : h.pos; P.pos.set(q.x + 1.2, q.y, q.z); return true; }"


SIM_RATE_MIN = 0.6


def sim_rates(*pgs):
    """match-clock seconds per wall second on each page, over ~3 s"""
    t0 = [(time.time(), p.evaluate("() => __LC__.W.t")) for p in pgs]
    time.sleep(3.0)
    t1 = [(time.time(), p.evaluate("() => __LC__.W.t")) for p in pgs]
    return [round((b[1] - a[1]) / max(0.001, b[0] - a[0]), 2) for a, b in zip(t0, t1)]


def wait_phase(pg, timeout):
    return SG.wait(pg, "() => ['drop','match'].includes(window.__LC__.W.phase) && !!window.__LC__.W.net", timeout, 1.0)


def front(pg):
    """the page Chrome treats as the active tab: measured (F:/lc_p23/net/vis2.py) - of two pages in one context only the front one gets full rAF
    (51/s vs 5-8/s for the other, visibilityState 'visible' on both); the throttled host then hit the kernel's 30 s per-GLB timeout on every skin
    (match12/14/15 and the base build alike: 'no character skins available'). A player's tab is in front: bring the page under test there."""
    try:
        pg.bring_to_front()
    except Exception:
        pass


PHASE_JS = "() => ['drop','match'].includes(window.__LC__.W.phase) && !!window.__LC__.W.net"


def wait_both_phase(hpg, gpg, timeout):
    """both pages load the match: the one still loading is kept in front (alternating every 4 s while both load, host first)"""
    t0, turn = time.time(), 0
    while time.time() - t0 < timeout:
        st = []
        for p in (hpg, gpg):
            try:
                st.append(bool(p.evaluate(PHASE_JS)))
            except Exception:
                st.append(False)
        if all(st):
            front(hpg)
            return True
        pending = [p for p, ok in zip((hpg, gpg), st) if not ok]
        front(pending[turn % len(pending)])
        turn += 1
        hpg.wait_for_timeout(4000)
    return False


def case_match(rig, v, args):
    ctx, pages = boot_pages(rig, args, ["match/host", "match/guest"], stub=False, plant=args.plant)
    (hpg, hrec), (gpg, grec) = pages
    code = SG.host_create(hpg)
    if not code:
        raise C.EnvFailure("match: no room code")
    SG.guest_join(gpg, code)
    if not (SG.wait(hpg, "() => document.body.innerText.includes('2 player')", 30)):
        raise C.EnvFailure("match: the guest never showed in the host's lobby")
    if not args.until_drop:
        click_mode(hpg, "SQUADS")
    SG.wait(gpg, "() => { const r = document.querySelector('[data-net-teammode]'); return r && r.getAttribute('data-net-teammode') === 'squad'; }", 10)
    t0 = time.time()
    SG.press_start(hpg)
    if not wait_both_phase(hpg, gpg, args.load_timeout):
        dj = "() => ({ phase: __LC__.W.phase, err: __LC__.W.lastMatchError || null, left: __LC__.W.squadLeft || null, net: !!__LC__.W.net })"
        raise C.EnvFailure("match: a page never reached the drop: host %s, guest %s; host warn %s; guest warn %s" % (
            json.dumps(hpg.evaluate(dj)), json.dumps(gpg.evaluate(dj)), json.dumps(hrec.warns[-8:]), json.dumps(grec.warns[-8:])))
    v.info("match: both pages in the drop after", "%d s" % round(time.time() - t0))
    if args.until_drop:
        v.check("match (--until-drop): both pages of the squad reached the drop", True, {"s": round(time.time() - t0)})
        SG.diag(v, "match", hrec, grec)
        return ctx
    hpg.wait_for_timeout(4000)
    h, g = hpg.evaluate(NET_JS), gpg.evaluate(NET_JS)
    if not h or not g:
        why = {"hostNet": bool(h), "guestNet": bool(g),
               "host": hpg.evaluate("() => ({ phase: __LC__.W.phase, left: __LC__.W.squadLeft || null, stats: __LC__.W._netStats || null })"),
               "guest": gpg.evaluate("() => ({ phase: __LC__.W.phase, left: __LC__.W.squadLeft || null, stats: __LC__.W._netStats || null })"),
               "hostWarn": hrec.warns[-12:], "guestWarn": grec.warns[-12:]}
        v.check("match: both pages are still in the squad session 4 s into the drop", False, why)
        return ctx
    v.check("match C-MODE: both sessions play teamMode 'squad' with roster teamIds t0 (the boot was handed them)",
            h["teamMode"] == "squad" and g["teamMode"] == "squad" and all(r[2] == "t0" for r in h["roster"]), {"host": h["roster"], "guest": g["roster"], "teamCheck": h["teamCheck"]})
    v.info("match C-MODE: boot cross-check (teams the boot built vs the start's teamIds; the boot lane wires teamId)", {"host": h["teamCheck"], "guest": g["teamCheck"]})

    # the box is shared with other lanes' browsers: measure how fast each page's match clock runs against the wall clock (1.0 = real time).
    # A page starved below SIM_RATE_MIN makes every clock row a statement about the box, not about net.js - those rows are then CNJ, never PASS.
    rates = sim_rates(hpg, gpg)
    v.info("match: sim rate (match-clock s per wall s) host / guest", rates)
    starved = min(rates) < SIM_RATE_MIN
    rc0 = hpg.evaluate("() => (__LC__.W.net.reclaimed || []).slice()")
    v.info("match LC-49 reconnect: bodies the host's silence watchdog took and handed back before the checks", rc0)
    # the guest's body must be the human's on the host before the relay rows (a bot-held body ignores the guest's knocks / throws by design)
    held = SG.wait(hpg, "() => { const a = __LC__.W.actorById.get('s1'); return a && a.netRemote && !a.isBot; }", 20)
    v.check("match LC-49 reconnect: the host drives s1 from the guest's packets (netRemote, not a bot) - a silence take-over during a slow load was handed back",
            bool(held), {"hostS1": hpg.evaluate(NET_JS)["s1"], "reclaimed": hpg.evaluate("() => (__LC__.W.net.reclaimed || []).slice()"), "tookOver": hpg.evaluate("() => __LC__.W.net.tookOver || null")})
    # ── LC-49 stamps ──
    samp = []
    for _ in range(6):
        hh = hpg.evaluate(NET_JS)
        samp.append((hh["t"], hh["s1"]["netQ"], hh["s1"]["netT"]))
        hpg.wait_for_timeout(500)
    qs = [s[1] for s in samp]
    dts = [abs(s[0] - s[2]) for s in samp if s[2] is not None]
    gq = gpg.evaluate(NET_JS)
    row1 = ("match LC-49: the host reads q (rising) and t on the guest's packets; the guest's t (its slewed clock) is within 1.0 s of the host's W.t",
            all(isinstance(q, int) for q in qs) and qs[-1] > qs[0] and dts and max(dts) <= 1.0,
            {"samples [hostT, s1.netQ, s1.netT]": samp, "guestTxSeq": gq["txSeq"], "maxClockGap": max(dts) if dts else None, "simRates": rates})
    row2 = ("match LC-49: the guest reads q / t on the HOST's packets too (s0.netQ rising, s0.netT ~ guest clock)",
            isinstance(gq["s0"]["netQ"], int) and gq["s0"]["netT"] is not None and abs(gq["s0"]["netT"] - gq["t"]) <= 1.5, dict(gq["s0"], simRates=rates, guestT=gq["t"]))
    for name, cond, det in (row1, row2):
        if not cond and starved:
            v.cnj(name, "a page ran at %.2f x real time (< %.2f): the box is starved, the clock gap measures the box" % (min(rates), SIM_RATE_MIN))
        else:
            v.check(name, cond, det)
    v.info("match LC-49: order counters (host / guest)", {"host": h["order"], "guest": gq["order"]})

    # ── LC-49 out-of-order injection ──
    q = gpg.evaluate(FREEZE_JS, True)
    gpg.wait_for_timeout(600)
    base = hpg.evaluate(NET_JS)["s1"]
    q = gpg.evaluate("() => __LC__.W.net.txSeq | 0")
    x0, y0, z0 = base["tgt"]
    n0 = dict(hpg.evaluate(NET_JS)["order"])
    gpg.evaluate(FORGE_JS, {"q": q + 3, "x": x0 + 4, "y": y0, "z": z0})          # newest: B
    hpg.wait_for_timeout(500)
    afterB = hpg.evaluate(NET_JS)["s1"]["tgt"]
    gpg.evaluate(FORGE_JS, {"q": q + 2, "x": x0 - 40, "y": y0, "z": z0 - 40})    # late, never seen: must NOT pull back
    gpg.evaluate(FORGE_JS, {"q": q + 3, "x": x0 - 80, "y": y0, "z": z0})         # duplicate q: dropped
    hpg.wait_for_timeout(600)
    afterLate = hpg.evaluate(NET_JS)
    n1 = afterLate["order"]
    gpg.evaluate(FORGE_JS, {"q": q + 4, "x": x0 + 8, "y": y0, "z": z0})          # newer: applies (positive control)
    hpg.wait_for_timeout(500)
    afterC = hpg.evaluate(NET_JS)["s1"]["tgt"]
    gpg.evaluate("() => { __LC__.W.net.txSeq = (__LC__.W.net.txSeq | 0) + 4; }")
    gpg.evaluate(FREEZE_JS, False)
    near = lambda a, b: a and b and abs(a[0] - b[0]) < 0.05 and abs(a[2] - b[2]) < 0.05
    v.check("match LC-49: a newer forged packet moves the host's target for s1 (+4 m) - the injection path is live (positive control)", near(afterB, [x0 + 4, y0, z0]), {"before": base["tgt"], "afterB": afterB})
    v.check("match LC-49: a LATE packet (q-1, never seen) and a DUPLICATE (same q) never pull the remote back: the target stays at B; the host counts 1 old + 1 dup",
            near(afterLate["s1"]["tgt"], [x0 + 4, y0, z0]) and n1["old"] - n0["old"] >= 1 and n1["dup"] - n0["dup"] >= 1,
            {"target": afterLate["s1"]["tgt"], "B": [x0 + 4, y0, z0], "orderBefore": n0, "orderAfter": n1})
    v.check("match LC-49: the next newer packet applies again (+8 m)", near(afterC, [x0 + 8, y0, z0]), {"afterC": afterC})
    # the guest's body follows its real packets again (the sender is the guest: its tab in front, up to 15 s - match16 read it after a fixed 1.5 s
    # while the guest's tab was throttled in the background and sent ~1 packet/s)
    front(gpg)
    SG.wait(hpg, "(top) => { const a = __LC__.W.actorById.get('s1'); return a && a.netQ > top; }", 15, 0.25, q + 4)
    resumed = hpg.evaluate(NET_JS)["s1"]["netQ"]
    front(hpg)
    nm = "match LC-49: the guest's real stream resumes after the injection (host's s1.netQ > the forged q+4)"
    if not (isinstance(resumed, int) and resumed > q + 4) and starved:
        v.cnj(nm, "a page ran at %.2f x real time: the guest sent nothing new in 15 s on the starved box (netQ %s)" % (min(rates), resumed))
    else:
        v.check(nm, isinstance(resumed, int) and resumed > q + 4, {"netQ": resumed, "forgedTop": q + 4})

    # ── bring the two players together on the ground (the host's position) ──
    hp_ = hpg.evaluate(NET_JS)["me"]["pos"]
    gpg.evaluate("(p) => { const P = __LC__.W.player; P.pos.set(p[0] + 1.2, p[1], p[2]); }", hp_)
    gpg.wait_for_timeout(800)

    # ── C-DBNO ──
    gpg.evaluate("() => { const W = __LC__.W, p = W.player; p.downed = true; p.downedHp = 100; p.downedT = W.t; W.events.emit('actorDowned', p, W.actorById.get('s0')); }")
    dn = SG.wait(hpg, "() => { const a = __LC__.W.actorById.get('s1'); return a && a.downed && a.downedHp > 0; }", 5)
    down_wire = [m for m in SG.msgs(gpg, "revive", "out") if m["d"].get("k") == "down"]
    hs1 = hpg.evaluate(NET_JS)["s1"]
    v.check("match C-DBNO: the guest's knock reaches the host: 'revive' {k: down, id: s1, by: s0} at once and bit 256 + dh on its state (host's s1.downed, downedHp ~100)",
            bool(dn) and bool(down_wire) and down_wire[0]["d"].get("id") == "s1" and down_wire[0]["d"].get("by") == "s0" and 90 <= (hs1["downedHp"] or 0) <= 100,
            {"wire": [m["d"] for m in down_wire], "hostS1": hs1})
    # early done (1 s after start): refused by the owner
    hpg.evaluate("() => { const W = __LC__.W; W.events.emit('reviveStart', W.player, W.actorById.get('s1')); }")
    gpg.wait_for_timeout(1000)
    gpg.evaluate(CLOSE_JS)
    hpg.evaluate("() => { const W = __LC__.W; W.events.emit('actorRevived', W.actorById.get('s1'), W.player); }")
    gpg.wait_for_timeout(800)
    g1 = gpg.evaluate(NET_JS)
    early_rej = [r for r in gpg.evaluate(REJECTS_JS)]
    v.check("match C-DBNO: a revive 'done' 1 s after 'start' (less than K.REVIVE_S) is REFUSED by the owner - the guest stays downed",
            g1["me"]["downed"] is True and any(r.get("t") == "revive" and "full channel" in r.get("why", "") for r in early_rej), {"me": g1["me"], "refusals": early_rej, "hostOut": [m["d"] for m in SG.msgs(hpg, "revive", "out")]})
    # full channel
    hpg.evaluate("() => { const W = __LC__.W; W.events.emit('reviveStart', W.player, W.actorById.get('s1')); }")
    hpg.wait_for_timeout(5300)
    gpg.evaluate(CLOSE_JS)
    hpg.evaluate("() => { const W = __LC__.W; W.events.emit('actorRevived', W.actorById.get('s1'), W.player); }")
    up = SG.wait(gpg, "() => !__LC__.W.player.downed", 5)
    g2 = gpg.evaluate(NET_JS)
    hup = SG.wait(hpg, "() => !__LC__.W.actorById.get('s1').downed", 5)
    v.check("match C-DBNO: after a full channel (5.3 s) the owner revives: the guest is up at 30 HP, the host's s1 is no longer downed (bit cleared, no dh)",
            bool(up) and bool(hup) and g2["me"]["hp"] == 30, {"me": g2["me"], "hostS1": hpg.evaluate(NET_JS)["s1"], "relayIn": g2["relayIn"]})

    # ── LC-14 smoke + frag relay ──
    gpg.evaluate("""() => { const W = __LC__.W, p = W.player; if (!Array.isArray(W.smokes)) W.smokes = [];
        W.smokes.push({ x: p.pos.x + 3, y: p.pos.y, z: p.pos.z, r: 6, t0: W.t, t1: W.t + 20, by: p.id }); }""")
    sm = SG.wait(hpg, "() => Array.isArray(__LC__.W.smokes) && __LC__.W.smokes.some((s) => s._net)", 5)
    gpg.wait_for_timeout(800)
    hsm, gsm = hpg.evaluate(NET_JS), gpg.evaluate(NET_JS)
    smoke_out = SG.msgs(gpg, "smoke", "out")
    v.check("match LC-14: a smoke cloud made on the guest is relayed ONCE ('smoke' {x,y,z,r,t0,t1,by:s1}) and joins the host's W.smokes (marked _net); the host relays nothing back",
            bool(sm) and len(smoke_out) == 1 and smoke_out[0]["d"].get("by") == "s1" and sum(1 for s in hsm["smokes"] if s["net"]) == 1 and not SG.msgs(hpg, "smoke", "out")
            and len(gsm["smokes"]) == 1, {"out": [m["d"] for m in smoke_out], "hostSmokes": hsm["smokes"], "guestSmokes": gsm["smokes"]})
    hpg.evaluate("() => { window.__NADE__ = []; __LC__.W.events.on('grenadeThrown', (a, w, o, vv, m) => window.__NADE__.push({ id: a.id, w, net: !!(m && m.net) })); }")
    gpg.evaluate("() => { const W = __LC__.W, p = W.player; W.events.emit('grenadeThrown', p, 'frag', { x: p.pos.x, y: p.pos.y + 1.5, z: p.pos.z }, { x: 8, y: 6, z: 0 }); }")
    nd = SG.wait(hpg, "() => (window.__NADE__ || []).length > 0", 5)
    nades = hpg.evaluate("() => window.__NADE__ || []")
    hrl = hpg.evaluate(NET_JS)["relayIn"]
    v.check("match LC-14: a frag throw on the guest replays on the host as grenadeThrown(s1, 'frag', ..., {net: true}) (cosmetic; no round spawned)",
            bool(nd) and nades[0] == {"id": "s1", "w": "frag", "net": True}, {"events": nades, "relayIn": hrl})
    shot(hpg, "match_host_view")
    shot(gpg, "match_guest_view")

    # ── LC-49 rejoin ──
    kit_before = gpg.evaluate("() => { const i = __LC__.W.player.inventory; return i ? JSON.stringify((i.slots || []).map((s) => s && s.id)) : null; }")
    gpg.wait_for_timeout(2300)          # the guest's rejoin record is rewritten every 2 s
    old_id = gpg.evaluate("() => __LC__.W.net.net.id")
    body_before = hpg.evaluate(NET_JS)["s1"]
    t_leave = time.time()
    url = C.build_url(args.base, room=code) if hasattr(C, "build_url") else args.base + ("&" if "?" in args.base else "?") + "room=" + code
    front(gpg)
    gpg.goto(url, wait_until="commit", timeout=120_000)
    took = SG.wait(hpg, "() => { const a = __LC__.W.actorById.get('s1'); return a && a.isBot && !a.netRemote; }", 20)
    v.check("match rejoin: the guest's reload sends its bye and the host's bot brain takes the body over at once", bool(took), hpg.evaluate(NET_JS)["s1"])
    if SG.wait(gpg, "() => !!(window.__LC__ && window.__LC__.W && window.__LC__.W.events)", args.boot_timeout, 1.0) is None:
        raise C.EnvFailure("rejoin: the reloaded guest never booted")
    t_boot = time.time() - t_leave
    v.info("match rejoin: the reloaded page booted (__LC__ up) after", "%.1f s" % t_boot)
    ok_msg = SG.wait(hpg, "() => (window.__SQ_LOG__ || []).some((m) => m.dir === 'out' && m.t === 'rejoin' && m.d && m.d.k === 'ok')", 60, 0.5)
    t_ok = time.time() - t_leave
    hro = [m["d"] for m in SG.msgs(hpg, "rejoin", "out")]
    nm = "match rejoin: the reloaded page on ?room= asks with its secret and the host answers 'ok' for slot 1 within 60 s of the leave (%.0f s)" % t_ok
    okr = bool(ok_msg) and t_ok <= 60 and any(d.get("k") == "ok" and d.get("slot") == 1 for d in hro)
    if not okr and t_boot > 50:
        v.cnj(nm, "the reloaded page needed %.0f s just to boot on this starved box (the 60 s window is the host's rule, measured from the leave)" % t_boot)
    else:
        v.check(nm, okr, {"hostRejoinOut": [{k: d.get(k) for k in ("k", "slot", "code", "why")} for d in hro], "s": round(t_ok, 1), "bootS": round(t_boot, 1)})
    back = SG.wait(gpg, "() => { const S = __LC__.W.net; return !!(S && S.rejoinDone); }", args.load_timeout, 1.0)
    t_back = time.time() - t_leave
    gpg.wait_for_timeout(2500)
    g3, h3 = gpg.evaluate(NET_JS), hpg.evaluate(NET_JS)
    kit_after = gpg.evaluate("() => { const i = __LC__.W.player.inventory; return i ? JSON.stringify((i.slots || []).map((s) => s && s.id)) : null; }")
    new_id = g3["id"] if g3 else None
    dist = None
    if g3 and h3 and g3["me"] and h3["s1"]:
        a, b = g3["me"]["pos"], h3["s1"]["pos"]
        dist = round(((a[0] - b[0]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5, 2)
    v.check("match rejoin: the page is back in ITS slot (W.player s1, a new peer id); the host's roster names the new peer for slot 1 and drives s1 from it again (netRemote, not a bot)",
            bool(back) and g3["me"]["id"] == "s1" and new_id != old_id and any(r[0] == 1 and r[1] == new_id for r in h3["roster"]) and h3["s1"]["netRemote"] and not h3["s1"]["isBot"],
            {"back_s": round(t_back), "guest": g3 and {"me": g3["me"], "rejoinDone": g3["rejoinDone"], "phase": g3["phase"]}, "hostS1": h3 and h3["s1"], "roster": h3 and h3["roster"]})
    v.check("match rejoin: the body is where the host had it (guest's player within 4 m of the host's s1, x/z) and the kit came back (%s)" % kit_before,
            dist is not None and dist <= 4.0 and kit_after == kit_before, {"dist": dist, "kitBefore": kit_before, "kitAfter": kit_after, "bodyBefore": body_before})
    v.check("match rejoin: the returning page's clock is the host's (within 1.5 s) and its phase is drop/match",
            g3 and abs(g3["t"] - h3["t"]) <= 1.5 and g3["phase"] in ("drop", "match"), {"guestT": g3 and g3["t"], "hostT": h3 and h3["t"], "phase": g3 and g3["phase"]})
    # a WRONG KEY, in the browser (fix round): a third page of this browser opens ?room=CODE holding a forged rejoin record for slot 1 in its
    # own tab storage (sessionStorage, net.js's own record format) and the guest's real record hidden from it (its localStorage reads of the
    # per-room list answer null - a page-local patch, the other pages are untouched). Its hello carries rj [{slot 1, forged key}]: the slot's
    # peer is the rejoined guest, so judgeRejoin reaches the KEY check and the host must answer "no" / "wrong rejoin key"
    n_no0 = len([m for m in SG.msgs(hpg, "rejoin", "out") if m["d"].get("k") == "no"])
    ipg, irec = rig.page(ctx, "match/intruder")
    ipg.add_init_script("""(() => { try { const room = %s; sessionStorage.setItem('lc.rejoin.v1', JSON.stringify({ room, slot: 1, key: 'forged-0000000000000000', name: 'intruder', at: Date.now(), inv: null }));
        const gi = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (this === window.localStorage && String(k).indexOf('lc.rejoin.v1.') === 0) return null; return gi.call(this, k); }; } catch (e) {} })();""" % json.dumps(code))
    front(ipg)
    SG.boot_url(ipg, url, args.boot_timeout)
    no = SG.wait(hpg, "(n) => (window.__SQ_LOG__ || []).filter((m) => m.dir === 'out' && m.t === 'rejoin' && m.d && m.d.k === 'no').length > n", 60, 0.5, n_no0)
    nos = [m["d"] for m in SG.msgs(hpg, "rejoin", "out") if m["d"].get("k") == "no"][n_no0:]
    ist = SG.wait(ipg, "() => { const e = document.querySelector('[data-net-rejoin]'); const a = e && e.getAttribute('data-net-rejoin'); return a && a !== 'asking' ? a : null; }", 20)
    iw = ipg.evaluate("() => { const W = window.__LC__ && window.__LC__.W; return W ? { phase: W.phase, me: W.player ? W.player.id : null } : null; }")
    h4 = hpg.evaluate(NET_JS)
    v.check("match rejoin: a third page with a FORGED key for slot 1 is refused in the browser - the host answers 'no' / 'wrong rejoin key', the page shows the refusal "
            "and stays out of the match, and slot 1 stays the rejoined guest's",
            bool(no) and any("wrong rejoin key" in (d.get("why") or "") for d in nos) and ist == "refused" and (iw or {}).get("phase") not in ("drop", "match")
            and any(r[0] == 1 and r[1] == new_id for r in h4["roster"]),
            {"hostNo": [{k: d.get(k) for k in ("code", "why", "to")} for d in nos][-3:], "intruderStatus": ist, "intruder": iw, "roster": h4["roster"], "guestPeer": new_id})
    shot(ipg, "match_intruder_refused")
    v.check("match rejoin: intruder - 0 console errors, 0 page errors, 0 failed requests", irec.clean(), irec.problems())
    shot(gpg, "match_guest_rejoined")
    SG.diag(v, "match", hrec, grec)
    return ctx


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--cases", default="mode,mode3,match")
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS))
    ap.add_argument("--until-drop", action="store_true", help="case match: stop once both pages reach the drop (A/B against a base --rev, no team-mode click)")
    ap.add_argument("--serve", nargs="?", type=int, const=-1, default=0, metavar="PORT",
                    help="serve the worktree from a threaded http server inside this process (on PORT; bare --serve = a free port) and point --base at it "
                         "(asset fetches no longer queue behind the single Playwright thread as --disk routing does). Listen backlog 256; --overlay files are served too")
    args = ap.parse_args()
    global SHOTDIR
    SHOTDIR = os.path.join(C.REPORTS, "p23_netlive_%s" % C.stamp(), "shots")
    if args.serve:
        import functools
        import http.server
        import threading
        root = os.path.realpath(os.path.join(HARNESS, "..", "..", ".."))
        ovl = C.overlay_specs(args) if getattr(args, "overlay", None) else []

        class H(http.server.SimpleHTTPRequestHandler):
            def translate_path(self, path):
                # --overlay: a game file an overlay holds is served from it (later overlays win), as DiskServer does for --disk
                rel = urllib.parse.unquote(urllib.parse.urlparse(path).path)
                if ovl and rel.startswith("/games/last-circle/"):
                    r = rel[len("/games/last-circle/"):]
                    for d, rels in reversed(ovl):
                        if rels is not None and r not in rels:
                            continue
                        f = os.path.join(d, r.replace("/", os.sep))
                        if os.path.isfile(f):
                            return f
                return super().translate_path(path)

            extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{".js": "text/javascript", ".mjs": "text/javascript",
                                  ".glb": "model/gltf-binary", ".wasm": "application/wasm", ".json": "application/json"})

            def end_headers(self):
                self.send_header("Cache-Control", "no-store")
                self.send_header("Access-Control-Allow-Origin", "*")
                super().end_headers()

            def log_message(self, *a):
                pass
        class Srv(http.server.ThreadingHTTPServer):
            request_queue_size = 256          # the listen backlog (default 5: refused connections = false failed requests on a loaded box)
            daemon_threads = True
        srv = Srv(("127.0.0.1", args.serve if args.serve > 0 else 0), functools.partial(H, directory=root))
        args.serve = srv.server_address[1]
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        args.base = "http://127.0.0.1:%d/games/last-circle/index.html" % args.serve
        args.disk = False
        print("p23_netlive: in-process server for %s on :%d (backlog %d, %d overlay dir(s))" % (root, args.serve, Srv.request_queue_size, len(ovl)), flush=True)
    args.full = False
    args.full_now = False

    def body(v):
        rig = SG.Rig(args)
        try:
            for c in [x.strip() for x in args.cases.split(",") if x.strip()]:
                print("-- case %s" % c, flush=True)
                ctx = None
                try:
                    ctx = {"mode": case_mode, "mode3": case_mode3, "match": case_match}[c](rig, v, args)
                except C.EnvFailure as e:
                    v.cnj("%s: environment" % c, str(e))
                finally:
                    if ctx is not None:
                        try:
                            ctx.close()
                        except Exception:
                            pass
        finally:
            rig.close()

    return C.run_gate("p23_netlive", body, args)


if __name__ == "__main__":
    sys.exit(main())
