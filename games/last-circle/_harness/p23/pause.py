#!/usr/bin/env python
"""pause - only PRACTICE can be paused (owner ruling 2026-11-24: "battle royale is pausable by clicking Esc - that shouldn't be in a live
game. Only PRACTICE should be pausable"). The one rule is hud.js canPause(W); every row below drives it through a REAL input.

    python _harness/p23/pause.py --disk
    python _harness/p23/pause.py --disk --plant br-pausable --no-touch     # canPause back to "anything offline" - MUST FAIL

Rows (desktop 1280x720 Ashgrid seed 7; phone = pixel7 landscape, real CDP touches, no pointer lock):
  lobby [standard]        a REAL Escape in the match lobby: W.paused stays false, no card
  esc-drop [standard]     a REAL Escape during the drop: the menu card opens, W.paused false, W.t advances over 60 stepped frames
  esc [standard|quick]    landed, inside a storm SHRINK window (setup fast-forward): a REAL Escape opens the card (title MENU, "keeps running",
                          no bot / AI / CPU wording), W.paused false; over 120 stepped frames W.t advances >= 1.5 s, >= 1 opponent moves
                          >= 0.3 m, the storm radius shrinks; a second Escape closes the card
  hide [standard|quick]   visibilitychange -> hidden + pagehide: W.paused false, no card, W.t advances over 60 stepped frames
  ctx-restore [standard]  the LC-87 context-restored path: comes back running (W.paused false), W.t advances
  esc / hide / ctx-restore [practice]   the SAME inputs freeze it: W.paused true and W.t frozen over 60 frames; Escape / RESUME resumes
  touch: pause-btn [standard|practice]  a REAL tap on the touch Pause button: standard = card + running; practice = card + frozen; a REAL tap
                          on RESUME closes it
  touch: hide [standard]  as hide above, on the phone
  touch: rotate [standard|practice]     the phone turned upright (viewport portrait): the turn-sideways card shows; standard keeps running
                          and says so, practice pauses and says so
  0 page errors (each session)
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C
sys.path.insert(0, L.HARNESS)
import mobilekit as MK  # noqa: E402

HUD = "runtime/3d/royale/hud.js"
PLANTS = {
    # the old rule: any offline match freezes (Esc, hidden tab, phone upright) - Battle Royale pausable again
    "br-pausable": [(HUD, [("  return !!W && W.mode === \"practice\" && !W.net;\n", "  return !!W && !W.net;\n")])],
}
DT = 1 / 60
NO_BOT_WORDS = re.compile(r"\b(bots?|AI|CPU|computer)\b", re.I)

STATE_JS = r"""() => { const W = window.__LC__.W, p = W.player, card = document.querySelector('[data-lc="pause"]');
  return { phase: W.phase, mode: W.mode, net: !!W.net, paused: !!W.paused, t: +W.t.toFixed(4), alive: !!(p && p.alive),
           card: card ? (card.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300) : null }; }"""
BOTS_JS = r"""() => { const W = window.__LC__.W; const o = {}; for (const a of W.actors) if (a !== W.player && a.alive) o[a.id] = [a.pos.x, a.pos.z]; return o; }"""
STORM_JS = r"""() => { const W = window.__LC__.W, S = W.stormCtl && W.stormCtl.storm; if (!S || !S.phases.length) return null;
  const st = S.stateAt(W.t); return { r: +st.radius.toFixed(3), u: W.stormU ? +W.stormU.r.toFixed(3) : null }; }"""
# SETUP: fast-forward (player topped up every tick) to just inside the next storm SHRINK, so the window under test can show it moving
SEEK_JS = r"""([maxS]) => { const C = window.__LC__, W = C.W, p = W.player, S = W.stormCtl && W.stormCtl.storm;
  if (!S || !S.phases.length) return { found: false, why: 'no storm' };
  const r = (x) => S.stateAt(x).radius; let t = W.t + 1;
  while (t < W.t + maxS && !(r(t + 3) < r(t) - 0.5)) t += 1;
  if (t >= W.t + maxS) return { found: false, why: 'no shrink within ' + maxS + ' s' };
  let n = 0; while (W.t < t + 0.5 && n < 60000) { C.fastForward(1 / 30, 1 / 30); n++; if (p && p.alive) { p.hp = 100; p.shield = 100; } }
  return { found: true, t: +W.t.toFixed(2), alive: !!(p && p.alive) }; }"""
HIDE_JS = r"""() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); return true; }"""
SHOW_JS = r"""() => { delete document.visibilityState; delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); return document.visibilityState; }"""
BTN_JS = r"""(re) => { const b = [...document.querySelectorAll('[data-lc="pause"] button')].find((x) => x.offsetParent && new RegExp(re, 'i').test((x.textContent || '').trim()));
  if (!b) return null; const r = b.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const top = document.elementFromPoint(cx, cy); return { xy: [cx, cy], onTop: !!top && (top === b || b.contains(top)) }; }"""
ROT_JS = r"""() => { const e = document.querySelector('[data-lc="rotate"]'); const m = document.querySelector('[data-lc="rotatemsg"]');
  return { shown: !!e && getComputedStyle(e).display !== 'none', msg: m ? m.textContent : null, w: innerWidth, h: innerHeight }; }"""


def moved(a, b, d=0.3):
    return sum(1 for k, p in a.items() if k in b and ((b[k][0] - p[0]) ** 2 + (b[k][1] - p[1]) ** 2) ** 0.5 >= d)


def window_(s, frames):
    """W.t / opponents / storm across `frames` stepped frames (the loop is frozen: only these frames run)"""
    a, b0, s0 = s.js(STATE_JS), s.js(BOTS_JS), s.js(STORM_JS)
    s.step_frames(frames, DT, render=False)
    z, b1, s1 = s.js(STATE_JS), s.js(BOTS_JS), s.js(STORM_JS)
    return {"before": a, "after": z, "dt": round(z["t"] - a["t"], 4), "botsMoved": moved(b0, b1), "bots": len(b0), "storm": [s0, s1]}


def live_card_ok(txt):
    return bool(txt) and txt.startswith("MENU") and "keeps running" in txt.lower() and not NO_BOT_WORDS.search(txt)


def setup_touch(s):
    s.goto()
    for _ in range(240):
        s.js("() => { for (const re of [/^\\s*PLAY ANYWAY\\s*$/i, /^\\s*CONTINUE ANYWAY\\s*$/i]) { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && re.test(x.textContent)); if (b) b.click(); } return true; }")
        if s.safe_js("() => !!window.__LC__", default=False):
            break
        s.sleep(0.5)
    s.wait_lc()
    s.sleep(1.5)
    for _ in range(4):
        s.js("() => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && /^\\s*(GOT IT|CONTINUE ANYWAY)\\s*$/i.test(x.textContent)); if (b) b.click(); return true; }")
        s.sleep(0.6)


def enter_lobby(s):
    s.wait_lobby_full()
    for _ in range(3):
        s.page.keyboard.press("Enter")
        if s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 5, 0.1) is not None:
            break


def match(s, pace, seed, map_id, enter=True):
    s.thaw_loop()
    st = L.start(s, pace, seed, map_id, team="solo", guard=True, enter=enter)
    return st


def desktop(v, s, args):
    v.data["desktop"] = D = {}
    for pace in ("standard", "quick", "practice"):
        live = pace != "practice"
        R = D[pace] = {}
        R["start"] = match(s, pace, args.seed, args.map, enter=not (pace == "standard"))
        s.freeze_loop()
        s.install_pump()
        if pace == "standard":
            # the lobby: a REAL Escape does nothing
            s.page.keyboard.press("Escape")
            a = s.js(STATE_JS)
            R["lobby"] = a
            if a["phase"] != "lobby":
                v.cnj("lobby [standard]: Escape does not pause", "not in the lobby: %s" % a)
            else:
                v.check("lobby [standard]: a real Escape leaves W.paused false and opens no card", not a["paused"] and a["card"] is None, a, "not paused, no card")
            s.thaw_loop()
            enter_lobby(s)
            s.freeze_loop()
            s.install_pump()
            a = s.js(STATE_JS)
            if a["phase"] != "drop":
                v.cnj("esc-drop [standard]", "not in the drop: %s" % a)
            else:
                L.lock_pointer(s)
                s.page.keyboard.press("Escape")
                s.wait_js("() => !!document.querySelector('[data-lc=\"pause\"]')", 3, 0.1)
                w = window_(s, 60)
                R["escDrop"] = w
                v.check("esc-drop [standard]: a real Escape in the drop opens the card and the drop keeps running (W.paused false, W.t +1 s)",
                        live_card_ok(w["before"]["card"]) and not w["after"]["paused"] and w["dt"] >= 0.9, w, "card MENU, not paused, dt >= 0.9")
                s.page.keyboard.press("Escape")
        R["land"] = s.land(150, protect=True)
        if live:
            R["seek"] = sk = s.js(SEEK_JS, [900])
            if not sk.get("found") or not sk.get("alive"):
                v.cnj("esc [%s]: storm" % pace, "setup could not reach a storm shrink: %s" % sk)
        s.step_frames(5, DT, render=True)
        pre = s.js(STATE_JS)
        if pre["phase"] != "match" or not pre["alive"] or pre["paused"] or pre["card"]:
            v.cnj("esc [%s]" % pace, "precondition: %s" % pre)
            continue
        # ---- Escape
        L.lock_pointer(s)
        s.page.keyboard.press("Escape")
        s.wait_js("() => !!document.querySelector('[data-lc=\"pause\"]')", 3, 0.1)
        w = window_(s, 120)
        R["esc"] = w
        card = w["before"]["card"]
        if live:
            st0, st1 = w["storm"]
            storm_ok = bool(st0 and st1 and st1["r"] < st0["r"] - 0.05)
            v.check("esc [%s]: a real Escape opens the menu card (MENU, 'keeps running', no bot words) and W.paused stays false" % pace,
                    live_card_ok(card) and not w["before"]["paused"] and not w["after"]["paused"], {"card": card, "paused": [w["before"]["paused"], w["after"]["paused"]]},
                    "card shown, not paused")
            v.check("esc [%s]: with the card open the match runs (W.t +>= 1.5 s over 120 frames, >= 1 opponent moved, the storm shrank)" % pace,
                    w["dt"] >= 1.5 and w["botsMoved"] >= 1 and storm_ok, {"dt": w["dt"], "botsMoved": w["botsMoved"], "of": w["bots"], "storm": w["storm"]},
                    "dt >= 1.5, moved >= 1, radius down")
        else:
            v.check("esc [practice]: a real Escape pauses (card 'paused', W.paused true, W.t frozen over 120 frames)",
                    bool(card) and "paused" in card.lower() and w["after"]["paused"] and w["dt"] == 0, {"card": card, "paused": w["after"]["paused"], "dt": w["dt"]},
                    "paused, dt 0")
        s.page.keyboard.press("Escape")
        s.sleep(0.2)
        w2 = window_(s, 60)
        R["escClose"] = w2
        v.check("esc [%s]: a second Escape closes the card and the match runs (W.paused false, W.t advances)" % pace,
                w2["before"]["card"] is None and not w2["after"]["paused"] and w2["dt"] >= 0.9, {"card": w2["before"]["card"], "paused": w2["after"]["paused"], "dt": w2["dt"]},
                "closed, running")
        # ---- hidden tab
        s.js(HIDE_JS)
        s.sleep(0.5)
        w3 = window_(s, 60)
        s.js(SHOW_JS)
        R["hide"] = w3
        if live:
            v.check("hide [%s]: a hidden tab (visibilitychange + pagehide) does not pause: no card, W.paused false, W.t advances" % pace,
                    w3["before"]["card"] is None and not w3["after"]["paused"] and w3["dt"] >= 0.9, {"card": w3["before"]["card"], "paused": w3["after"]["paused"], "dt": w3["dt"]},
                    "not paused, dt >= 0.9")
        else:
            v.check("hide [practice]: a hidden tab pauses (W.paused true, W.t frozen)", w3["after"]["paused"] and w3["dt"] == 0,
                    {"paused": w3["after"]["paused"], "dt": w3["dt"]}, "paused, dt 0")
            s.page.keyboard.press("Escape")       # resume (the player's choice)
            s.sleep(0.2)
        # ---- context restored (LC-87): the restore path ran pauseForHide
        if pace in ("standard", "practice"):
            s.js("() => { window.__LC__.W.kernel.onContextRestored(); return true; }")
            s.freeze_loop()
            s.install_pump()
            w4 = window_(s, 60)
            R["ctx"] = w4
            if live:
                v.check("ctx-restore [standard]: a restored GPU context comes back running (W.paused false, W.t advances)",
                        not w4["after"]["paused"] and w4["dt"] >= 0.9, {"paused": w4["after"]["paused"], "dt": w4["dt"]}, "running")
            else:
                v.check("ctx-restore [practice]: a restored GPU context comes back paused (W.paused true, W.t frozen)",
                        w4["after"]["paused"] and w4["dt"] == 0, {"paused": w4["after"]["paused"], "dt": w4["dt"]}, "paused")
                s.page.keyboard.press("Escape")
                s.sleep(0.2)


def phone(v, s, args):
    v.data["touch"] = D = {}
    cdp = s.page.context.new_cdp_session(s.page)
    T = MK.Touch(cdp, s.sleep)
    spec = MK.DEVICES["pixel7"]
    for pace in ("standard", "practice"):
        live = pace != "practice"
        R = D[pace] = {}
        R["start"] = match(s, pace, args.seed, args.map)
        s.freeze_loop()
        s.install_pump()
        R["land"] = s.land(150, protect=True)
        s.step_frames(10, DT, render=True)
        pb = s.js("() => { const b = document.querySelector('[data-touch-ui=\"pause\"]'); if (!b || getComputedStyle(b).display === 'none') return null; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
        pre = s.js(STATE_JS)
        if not pb or pre["phase"] != "match" or not pre["alive"] or pre["paused"]:
            v.cnj("touch: pause-btn [%s]" % pace, "no touch Pause button or not in a live match: %s %s" % (pb, pre))
            continue
        T.tap(pb[0], pb[1])
        s.step_frames(3, DT, render=False)
        w = window_(s, 60)
        R["btn"] = w
        card = w["before"]["card"]
        if live:
            v.check("touch: pause-btn [standard]: a real tap opens the card (MENU, 'keeps running') and the match runs (W.paused false, W.t advances)",
                    live_card_ok(card) and not w["after"]["paused"] and w["dt"] >= 0.9 and w["botsMoved"] >= 1,
                    {"card": card, "paused": w["after"]["paused"], "dt": w["dt"], "botsMoved": w["botsMoved"]}, "card, running")
        else:
            v.check("touch: pause-btn [practice]: a real tap pauses (W.paused true, W.t frozen)", bool(card) and w["after"]["paused"] and w["dt"] == 0,
                    {"card": card, "paused": w["after"]["paused"], "dt": w["dt"]}, "paused")
        rb = s.js(BTN_JS, "^RESUME$")
        R["resume"] = rb
        if rb:
            T.tap(rb["xy"][0], rb["xy"][1])
            s.sleep(0.3)
            s.step_frames(2, DT, render=False)
        a = s.js(STATE_JS)
        v.check("touch: [%s] a real tap on RESUME closes the card (not paused)" % pace, bool(rb) and rb["onTop"] and a["card"] is None and not a["paused"],
                {"resume": rb, "after": a}, "closed")
        if live:
            s.js(HIDE_JS)
            s.sleep(0.5)
            w3 = window_(s, 60)
            s.js(SHOW_JS)
            R["hide"] = w3
            v.check("touch: hide [standard]: a hidden tab does not pause (no card, W.paused false, W.t advances)",
                    w3["before"]["card"] is None and not w3["after"]["paused"] and w3["dt"] >= 0.9, {"card": w3["before"]["card"], "paused": w3["after"]["paused"], "dt": w3["dt"]},
                    "running")
        # ---- the phone turned upright
        s.page.set_viewport_size({"width": spec["h"], "height": spec["w"]})
        s.sleep(0.8)
        w4 = window_(s, 60)
        rot = s.js(ROT_JS)
        R["rotate"] = {"rot": rot, "win": w4}
        msg = (rot.get("msg") or "")
        if not rot["shown"]:
            v.cnj("touch: rotate [%s]" % pace, "the turn-sideways card did not show: %s" % rot)
        elif live:
            v.check("touch: rotate [standard]: upright -> the card says the match keeps going and it does (W.paused false, W.t advances)",
                    "keeps going" in msg and not w4["after"]["paused"] and w4["dt"] >= 0.9 and not NO_BOT_WORDS.search(msg),
                    {"msg": msg, "paused": w4["after"]["paused"], "dt": w4["dt"]}, "running, truthful text")
        else:
            v.check("touch: rotate [practice]: upright -> the card says Practice is paused and it is (W.paused true, W.t frozen)",
                    "paused" in msg.lower() and w4["after"]["paused"] and w4["dt"] == 0, {"msg": msg, "paused": w4["after"]["paused"], "dt": w4["dt"]}, "paused")
        s.page.set_viewport_size({"width": spec["w"], "height": spec["h"]})
        s.sleep(0.8)
        if s.js("() => !!window.__LC__.W.paused"):
            rb = s.js(BTN_JS, "^RESUME$")
            if rb:
                T.tap(rb["xy"][0], rb["xy"][1])
                s.sleep(0.3)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--map", default="ashgrid")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--no-touch", action="store_true")
    ap.add_argument("--no-desktop", action="store_true")
    args = L.parse(ap)

    def plant(s):
        n = 0
        if args.plant:
            for rel, edits in PLANTS[args.plant]:
                n += L.serve_patched(s, rel, edits)
        return n

    def body(v):
        if not args.no_desktop:
            with C.Session(args, "p23_pause", viewport={"width": 1280, "height": 720}) as s:
                v.data["plant_edits"] = plant(s)
                s.boot()
                s.sleep(1.0)
                L.dismiss_cards(s)
                desktop(v, s, args)
                L.errors_row(v, s)
        if args.no_touch:
            return
        spec = MK.DEVICES["pixel7"]
        ctx_kw = {"device_scale_factor": spec["dpr"], "is_mobile": True, "has_touch": True, "user_agent": spec["ua"]}
        with C.Session(args, "p23_pause_touch", viewport={"width": spec["w"], "height": spec["h"]}, context_kw=ctx_kw, init_scripts=[MK.PHONE_NO_LOCK]) as s:
            plant(s)
            setup_touch(s)
            phone(v, s, args)
            L.errors_row(v, s, "touch: 0 page errors / console errors / failed requests")
    return C.run_gate("p23_pause", body, args)


if __name__ == "__main__":
    sys.exit(main())
