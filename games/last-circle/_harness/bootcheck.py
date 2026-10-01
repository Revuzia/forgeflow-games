#!/usr/bin/env python
"""bootcheck - load the game, start a match like a player, move, and demand a clean console (harness-gates G1).

    python _harness/bootcheck.py                     # BATTLE ROYALE card, headless (pointer lock works headless)
    python _harness/bootcheck.py --mode practice --disk

Real input for every acceptance action; __LC__ only for setup (landing: fastForward skips the glide) and observation:
  1. boot to the menu; HOW TO PLAY (first visit) is closed with a REAL click on GOT IT
  2. REAL click on the mode card (the card IS the play button, hud.js showMenu) -> the lobby; a REAL Enter drops in
  3. the harness rAF counter and W.t must advance on their own (the kernel's loop) - could-not-judge if the box
     starves rAF (harness-gates E2), never a pass
  4. REAL click on the canvas -> document.pointerLockElement set (player.js mousedown -> tryLock)
  5. landed (setup), then a REAL KeyW held while 90 kernel frames (1.5 s at 1/60) are stepped -> moved > 3 m
  6. the whole run: 0 console errors, 0 page / window errors, 0 failed requests (HTTP >= 400 or network; ERR_ABORTED is
     not a failure), 0 shader/GL errors, 0 `[rig]` warnings. The three.js PropertyBinding "No target node found"
     line is allow-listed (counted, printed) until lane L5 drops trackless clip tracks.
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

CARD_JS = r"""(want) => {
  const cards = [...document.querySelectorAll('.lc-mode-card')].filter((c) => c.offsetParent);
  const c = cards.find((x) => new RegExp(want, 'i').test(x.textContent || '')) || null;
  if (!c) return { n: cards.length, texts: cards.map((x) => (x.textContent || '').trim().slice(0, 30)) };
  c.scrollIntoView({ block: 'center' });
  const r = c.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  return { x, y, n: cards.length, hit: !!(top && (top === c || c.contains(top))), top: top ? top.tagName + '.' + (top.className || '') : null };
}"""

BTN_JS = r"""(re) => { const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent && new RegExp(re, 'i').test(x.textContent || ''));
  if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: b.textContent.trim().slice(0, 30) }; }"""

MODE_RE = {"standard": "BATTLE ROYALE", "quick": "QUICK", "practice": "PRACTICE"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--mode", default="standard", choices=sorted(MODE_RE))
    args = ap.parse_args()

    def body(v):
        with C.Session(args, "bootcheck") as s:
            t = s.boot()
            v.info("boot", {"lc_s": t})
            s.sleep(1.0)
            # first-visit HOW TO PLAY: closed like a player would
            for _ in range(3):
                b = s.js(BTN_JS, "^\\s*GOT IT\\s*$")
                if not b:
                    break
                s.page.mouse.click(b["x"], b["y"])
                s.sleep(0.6)
            ok, a, b = s.frames_advancing(4.0)
            raf_menu = ok
            v.info("rAF on the menu (harness counter)", {"advancing": ok, "from": a, "to": b})
            # REAL click on the mode card
            card = s.js(CARD_JS, MODE_RE[args.mode])
            if "x" not in card:
                v.check("menu shows the %s card" % MODE_RE[args.mode], False, card)
                return
            if not card.get("hit"):
                v.note("the %s card centre is covered by %s" % (MODE_RE[args.mode], card.get("top")))
            s.stage("load")
            s.page.mouse.click(card["x"], card["y"])
            t0 = time.time()
            got = s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25)
            if got is None and s.safe_js("() => !!window.__LC__.W._starting"):
                v.cnj("a REAL click on the %s card reaches the lobby" % MODE_RE[args.mode],
                      "the match was still loading after %d s (box contention; --load-timeout)" % args.load_timeout)
                return
            v.check("a REAL click on the %s card reaches the lobby" % MODE_RE[args.mode], got is not None,
                    {"s": got, "phase": s.phase()})
            if got is None:
                return
            s.stage("lobby")
            s.sleep(0.4)
            s.page.keyboard.press("Enter")
            dropped = s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 20, 0.1)
            v.check("a REAL Enter leaves the lobby", dropped is not None, {"s": dropped, "phase": s.phase()})
            s.stage("drop")
            # frames + W.t advancing on the game's own loop
            # The harness rAF counter is the reference: if the BROWSER delivered >= 2 animation frames and W.t did not
            # move, the game's loop is dead (FAIL). If the browser delivered < 2 in 8 s, the box starved rAF and the
            # loop cannot be judged (exit 2), never a pass. (21:03 run: 2 frames in 5 s on a 2-Chrome box.)
            t_a = s.js("() => window.__LC__.W.t")
            ok2, fa, fb = s.frames_advancing(8.0, need=6)
            t_b = s.js("() => window.__LC__.W.t")
            got = (fb - fa) if isinstance(fa, int) and isinstance(fb, int) else 0
            if got < 2:
                v.cnj("frames and W.t advance on the game's own loop", "rAF starved on this box (harness counter %s -> %s in 8 s)" % (fa, fb))
            else:
                v.check("frames and W.t advance on the game's own loop", t_b > t_a,
                        {"harnessFrames": [fa, fb], "W.t": [t_a, t_b], "menuRaf": raf_menu})
            # pointer lock by a REAL click on the canvas
            cv = s.js("() => { const c = window.__LC__.W.kernel.renderer.domElement; const r = c.getBoundingClientRect(); return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.6 }; }")
            s.page.mouse.click(cv["x"], cv["y"])
            locked = s.wait_js("() => !!document.pointerLockElement", 3, 0.1)
            lk = s.js("() => window.__H_LOCK__")
            v.check("a REAL canvas click takes pointer lock", locked is not None,
                    {"s": locked, "requests": lk.get("requests"), "errors": lk.get("errors"), "losses": lk.get("losses")})
            # land (setup), then REAL KeyW with stepped frames
            s.stage("land")
            land = s.land(120)
            v.info("landed via fastForward (setup only)", land)
            s.freeze_loop()
            s.step_frames(20, 1 / 60, render=20)
            p0 = s.js("() => { const p = window.__LC__.W.player; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, alive: p.alive, onGround: p.onGround }; }")
            s.stage("walk")
            s.page.keyboard.down("KeyW")
            try:
                s.step_frames(90, 1 / 60, render=30)
            finally:
                s.page.keyboard.up("KeyW")
            p1 = s.js("() => { const p = window.__LC__.W.player; return { x: p.pos.x, y: p.pos.y, z: p.pos.z, alive: p.alive, onGround: p.onGround }; }")
            dist = math.hypot(p1["x"] - p0["x"], p1["z"] - p0["z"])
            if not p0.get("alive"):
                v.cnj("a REAL W held for 1.5 s (stepped) moves the player > 3 m", "the player was dead before the walk (%s)" % land)
            else:
                v.check("a REAL W held for 1.5 s (stepped) moves the player > 3 m", dist > 3.0, {"moved_m": round(dist, 2), "from": p0, "to": p1})
            lk2 = s.js("() => window.__H_LOCK__")
            focused_losses = [l for l in (lk2.get("losses") or []) if l.get("hasFocus") and l.get("visibility") != "hidden"]
            v.check("pointer lock never dropped while the page had focus", not focused_losses, {"losses": lk2.get("losses")})
            s.thaw_loop()
            s.sleep(1.0)
            d = s.diagnostics()
            v.data["diagnostics"] = d
            C.print_diagnostics(d)
            v.check("0 console errors", not d["consoleErrors"], d["consoleErrors"][:5])
            v.check("0 page errors / window errors", not (d["pageErrors"] or d["windowErrors"]), (d["pageErrors"] + d["windowErrors"])[:5])
            v.check("0 failed requests", not d["failedRequests"], d["failedRequests"][:8])
            v.check("0 shader/GL errors", not d["shader"], d["shader"][:3])
            v.check("0 [rig] warnings", not d["rigWarnings"], {"n": len(d["rigWarnings"]), "first": sorted(set(d["rigWarnings"]))[:4]})
            v.info("allow-listed PropertyBinding warnings (not gating until L5)", d["allowListedWarnings"])
            v.info("other warnings (not gating)", {"n": len(d["warnings"]), "first": sorted(set(d["warnings"]))[:6]})
            rig = s.safe_js("() => { const a = window.__LC__.W._rigAudit || {}; const o = {}; for (const k in a) o[k] = { ok: a[k].ok, missing: (a[k].missing || []).length, handBone: a[k].handBone && a[k].handBone.name }; return o; }")
            v.info("W._rigAudit per skin (L5 gate: ok for all 5)", rig)
    return C.run_gate("bootcheck", body, args)


if __name__ == "__main__":
    sys.exit(main())
