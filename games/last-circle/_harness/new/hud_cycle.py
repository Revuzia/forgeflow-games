#!/usr/bin/env python
"""hud_cycle - the HUD across back-to-back matches driven through ITS OWN post-match buttons (plan P4.3), in a real browser.

    python _harness/new/hud_cycle.py --disk [--rounds 3]

One match -> the player is eliminated -> a REAL click on MATCH STATS -> the standings -> a REAL click on "Run it back" (round 1 and 3)
or "Find a new match" (round 2) -> the next lobby -> a REAL Enter -> landed.  leaktest.py reaches the next match through startMatch
directly (the path onAgain calls) and so never touches the buttons this lane added; this gate does, and counts what the HUD leaves behind:

  dom          document element count in each lobby: round 3 within +-60 of round 1 (the HUD rebuilds its tree per match; a per-match
               leak shows as growth that adds up)
  overlays     in every match: 0 leftover [data-lc=death] / [data-lc=post] nodes, exactly 1 [data-lc=bars] vitals card and 1 weapon card
  gpu          renderer.info.memory.textures in each lobby: round 3 within +-5 of round 1; geometries within +-30
  animations   document.getAnimations() in the lobby: no growth between round 1 and round 3
  errors       0 console / page errors, 0 failed requests over the whole run
Exit 0 pass / 1 fail / 2 could-not-judge (common.py's contract).  Run it alone (one Chrome).
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import common as C  # noqa: E402
import hud_checks as HC  # noqa: E402

CENSUS_JS = r"""() => { const W = window.__LC__.W, mem = W.kernel && W.kernel.renderer ? W.kernel.renderer.info.memory : {};
  const q = (n) => document.querySelectorAll('[data-lc="' + n + '"]').length;
  return { dom: document.getElementsByTagName('*').length, textures: mem.textures, geometries: mem.geometries,
           anims: document.getAnimations().length, phase: W.phase, map: W.mapId, death: q('death'), post: q('post'), bars: q('bars'), wcard: q('wcard'), feed: q('feed') }; }"""

DIE_JS = r"""() => { const W = window.__LC__.W; const bot = W.actors.find((a) => a.id !== W.player.id && a.alive && !a.isDummy);
  W.player.lastHit = null; W.hurtActor(W.player, 9999, bot.id, 'ar', true); return { by: bot.name, alive: W.player.alive }; }"""


# round 2 dies to the STORM (no killer, weapon id "storm"): the banner must say so and the feed row must name "the Storm"
DIE_STORM_JS = r"""() => { const W = window.__LC__.W; W.killActor(W.player, null, 'storm'); return { alive: W.player.alive }; }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--rounds", type=int, default=3)
    args = ap.parse_args()

    def body(v):
        census = []          # one per lobby
        in_match = []
        storm = {}
        with C.Session(args, "hud_cycle", viewport={"width": 1280, "height": 720}) as s:
            s.boot()
            HC.start_landed(s)
            for rnd in range(1, args.rounds + 1):
                s.freeze_loop()
                HC.step(s, 6)
                m = s.js(CENSUS_JS)
                in_match.append(m)
                v.info("round %d in the match" % rnd, m)
                s.guard_player(False)
                s.js(DIE_STORM_JS if rnd == 2 else DIE_JS)
                s.sleep(0.5)
                HC.step(s, 10, render=True)
                dd = s.js(HC.DEATH_JS)
                if rnd == 2:
                    storm = {"banner": (dd or {}).get("text"), "feed": [r["text"] for r in (s.js(HC.FEED_JS) or [])][-2:]}
                btn = (dd or {}).get("btn")
                if not btn:
                    v.cnj("round %d" % rnd, "no MATCH STATS button on the death banner")
                    return
                s.page.mouse.click(btn[0], btn[1])
                s.sleep(3.6)
                HC.step(s, 6, render=False)
                p = s.js(HC.POST_JS)
                if not p:
                    v.cnj("round %d" % rnd, "no post-match screen after MATCH STATS (phase %s)" % s.phase())
                    return
                want = "Find a new match" if rnd == 2 else "Run it back"
                b = next((x for x in p["btns"] if x["t"].startswith(want)), None)
                if not b:
                    v.cnj("round %d" % rnd, "no '%s' button: %s" % (want, [x["t"] for x in p["btns"]]))
                    return
                s.thaw_loop()
                s.page.mouse.click(b["x"], b["y"])
                ok = s.wait_js("() => window.__LC__.W.phase === 'lobby' && !window.__LC__.W._starting", args.load_timeout, 0.25)
                if ok is None:
                    v.cnj("round %d" % rnd, "the next lobby never came (%s)" % want)
                    return
                s.sleep(0.5)
                cl = s.js(CENSUS_JS)
                census.append(cl)
                v.info("round %d lobby after '%s'" % (rnd, want), cl)
                if rnd < args.rounds:
                    s.page.keyboard.press("Enter")
                    s.wait_js("() => ['drop', 'match'].includes(window.__LC__.W.phase)", 20, 0.1)
                    s.guard_player(True)
                    s.land(120, protect=True)
            d = s.diagnostics()
            probs = C.diag_problems(d, rig=False)

        if len(census) >= 2:
            a, z = census[0], census[-1]
            v.check("dom: the lobby's element count after round %d is within +-60 of round 1 (%d -> %d)" % (len(census), a["dom"], z["dom"]), abs(z["dom"] - a["dom"]) <= 60, [c["dom"] for c in census])
            v.check("gpu: lobby textures within +-5 and geometries within +-30 of round 1 (%s -> %s, %s -> %s)" % (a["textures"], z["textures"], a["geometries"], z["geometries"]),
                    abs(z["textures"] - a["textures"]) <= 5 and abs(z["geometries"] - a["geometries"]) <= 30, [(c["textures"], c["geometries"]) for c in census])
            v.check("animations: no growth in running CSS animations/transitions between round 1 and round %d (%d -> %d)" % (len(census), a["anims"], z["anims"]), z["anims"] <= a["anims"], [c["anims"] for c in census])
        bad = [m for m in in_match if not (m["death"] == 0 and m["post"] == 0 and m["bars"] == 1 and m["wcard"] == 1 and m["feed"] == 1)]
        v.check("overlays: in every match 0 leftover death / post overlays and exactly 1 vitals card, 1 weapon card, 1 kill feed", bool(in_match) and not bad, bad[:2] or in_match[:1])
        if len(in_match) >= 2:
            t = (storm.get("banner") or "")
            v.check("storm death (round 2): the banner reads 'ELIMINATED #N of 50 ... THE STORM GOT YOU' (no killer, no weapon, no HEADSHOT) and the feed row names 'the Storm'",
                    "ELIMINATED" in t and " of 50" in t and "THE STORM GOT YOU" in t and "HEADSHOT" not in t and "ELIMINATED BY" not in t and any("the Storm" in f for f in storm.get("feed", [])), storm)
        maps = [m["map"] for m in in_match] + [c["map"] for c in census]
        v.info("maps seen (Run it back keeps the map; Find a new match is random)", maps)
        if len(census) >= 1 and len(in_match) >= 1:
            v.check("'Run it back' (round 1) loaded the SAME map as the match it ended", census[0]["map"] == in_match[0]["map"], {"before": in_match[0]["map"], "after": census[0]["map"]})
        v.check("0 console / page errors, 0 failed requests over the cycle", not probs, {"problems": probs[:6]})
    return C.run_gate("hud_cycle", body, args)


if __name__ == "__main__":
    sys.exit(main())
