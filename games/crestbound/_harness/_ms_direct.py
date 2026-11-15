#!/usr/bin/env python
"""Missions lane (stage 1) proof, part C: the dev boot straight into a mission.

    python _harness/_ms_direct.py --mission open [--climb] [--url URL] [--out DIR]

Boots ?dev=1&course=verdant-1&mission=<id> (game.js urlMission), confirms the run's
mission record, renders the rampart-crest lens (under the tower roof) with the engine
stopped, and with --climb takes the crest with REAL Space presses (hand-stepped, as
_ms_proof.py), hand-steps the celebration until the clear panel rises, photographs
it, confirms it with a REAL Enter and reads the save back.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import _ms_proof as P  # noqa: E402  (CLIMB, STATION, FLAGS, wait_for)

LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


CLEAR_UP = r"""async (maxFrames) => {
  const A = CRESTBOUND, G = A.game, E = A.engine;
  E.stop();
  let i = 0;
  for (i = 0; i < maxFrames && !G._clearCardUp; i++) G.update(1 / 60);
  E.render(1 / 60);
  E.start(E._loopFn);
  return { frames: i, cardUp: !!G._clearCardUp, state: G.state };
}"""

PANEL = r"""() => {
  const btns = Array.from(document.querySelectorAll('button.cb-btn'))
    .filter(b => b.getBoundingClientRect().width > 4 && /STAY|RETURN|KEEP/i.test(b.textContent));
  const k = document.querySelector('.ch-clear .ch-ckicker, [class*=ckicker]');
  return { buttons: btns.map(b => (b.textContent || '').trim() + (b.classList.contains('is-focus') ? ' [focus]' : '')),
           kicker: k ? k.textContent : null };
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8788/games/crestbound/index.html")
    ap.add_argument("--mission", required=True)
    ap.add_argument("--climb", action="store_true")
    ap.add_argument("--out", default=os.path.join(ROOT, "_spec", "audit_2026_09_29", "frames", "missions"))
    args = ap.parse_args()
    out = {"mission": args.mission}
    errors = []
    with sync_playwright() as p:
        try:
            br = p.chromium.launch(channel="chrome", headless=True, args=P.FLAGS)
        except Exception:
            br = p.chromium.launch(headless=True, args=P.SWIFT)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)[:240]))
        pg.on("console", lambda m: errors.append("console.error: " + m.text[:240]) if m.type == "error" else None)
        url = args.url + "?dev=1&course=verdant-1&mission=%s&quality=low&autoscale=0" % args.mission
        log("goto", url)
        pg.goto(url, wait_until="load", timeout=180_000)
        ok = P.wait_for(pg, "() => globalThis.CRESTBOUND && CRESTBOUND.game && CRESTBOUND.game.courseId === 'verdant-1' && CRESTBOUND.game.state === 'playing' && !CRESTBOUND.game._loading", 600, poll_ms=1000)
        log("booted into verdant-1:", bool(ok))
        m = pg.evaluate("() => { const m = CRESTBOUND.game.mission; return m ? {id: m.id, name: m.name, present: m.present, absent: m.absent, routes: m.routes} : null; }")
        out["missionRecord"] = m
        log("  run mission record:", json.dumps(m))
        tag = "14_direct_%s" % args.mission
        st = pg.evaluate(P.STATION, [[10.0, 14.6, -24.6, 0.0], [10.4, 19.9, -29.6], [9.2, 19.2, -32.8], 30])
        log("  station:", json.dumps(st))
        path = os.path.join(args.out, tag + "_crest_lens.png")
        pg.screenshot(path=path, timeout=90_000, animations="disabled")
        log("  frame", os.path.relpath(path, ROOT))
        out["crests"] = pg.evaluate("() => CRESTBOUND.game.course.collectibles.crests.map(c => ({id: c.id, present: c.present}))")
        log("  crests built:", json.dumps(out["crests"]))
        if args.climb:
            pg.evaluate(P.STATION, [[10.0, 14.6, -24.6, 0.0], [10.6, 17.8, -22.0], [9.2, 18.6, -32.8], 30])
            climb = pg.evaluate(P.CLIMB)
            log("  climb:", climb["frames"], "frames,", climb["jumps"], "jumps, state", climb["state"])
            out["climb"] = {k: climb[k] for k in ("frames", "jumps", "state")}
            cu = pg.evaluate(CLEAR_UP, 2400)
            log("  celebration hand-stepped:", json.dumps(cu))
            panel = P.wait_for(pg, "() => { const b = Array.from(document.querySelectorAll('button.cb-btn')).filter(x => x.getBoundingClientRect().width > 4 && /RETURN|KEEP/i.test(x.textContent)); return b.length > 0; }", 120, poll_ms=500)
            pg.wait_for_timeout(2500)
            pn = pg.evaluate(PANEL)
            out["panel"] = pn
            log("  clear panel:", json.dumps(pn), "(visible:", bool(panel), ")")
            path = os.path.join(args.out, tag + "_clear_panel.png")
            pg.screenshot(path=path, timeout=90_000, animations="disabled")
            log("  frame", os.path.relpath(path, ROOT))
            pg.keyboard.press("Enter")
            back = P.wait_for(pg, "() => CRESTBOUND.game.state === 'keep' && CRESTBOUND.game.courseId === 'keep' && !CRESTBOUND.game._loading", 400, poll_ms=500)
            log("  real Enter on the panel -> the Keep:", bool(back))
            out["backInKeep"] = bool(back)
            save = pg.evaluate("() => JSON.parse(localStorage.getItem('crestbound.save.v1') || 'null')")
            rec = (save or {}).get("courses", {}).get("verdant-1")
            out["save"] = rec
            log("  SAVE verdant-1:", json.dumps(rec))
        out["errors"] = errors[:20]
        log("page errors:", len(errors))
        for e in errors[:8]:
            log("   ", e)
        br.close()
    out["log"] = LOG
    with open(os.path.join(args.out, "proof_direct_%s.json" % args.mission), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
