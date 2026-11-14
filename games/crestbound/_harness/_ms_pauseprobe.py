#!/usr/bin/env python
"""Missions lane: WHY does gatecheck's card cancel sometimes land in 'paused'?

Replays gatecheck's exact live sequence (place -> walk_in with a held W on the LIVE loop
-> REAL Escape at once) on the shipping build, with Game.pause wrapped so every pause
records its reason, the state it came from, whether the card was open, and a stack.

    python _harness/_ms_pauseprobe.py --url URL --gates rime-1,azure-3 --reps 4
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gatecheck as GC  # noqa: E402

WRAP = r"""() => {
  const G = CRESTBOUND.game;
  if (G.__pauseWrapped) return 'already';
  G.__pauseWrapped = true;
  window.__pauseLog = [];
  window.__keyLog = [];
  const orig = G.pause.bind(G);
  G.pause = function (reason) {
    const card = document.querySelector('.cb-card');
    window.__pauseLog.push({ reason: String(reason), from: G.state, cardOn: !!(card && card.classList.contains('on')),
      cardOpenFlag: !!(G.card && G.card._open), t: Math.round(performance.now()),
      stack: String(new Error().stack).split('\n').slice(1, 7).map(s => s.trim()).join(' | ') });
    return orig(reason);
  };
  const log = (ph) => (e) => { if (e.code === 'Escape') window.__keyLog.push({ ph, type: e.type, t: Math.round(performance.now()),
    state: G.state, cardOpen: !!(G.card && G.card._open), stopped: e.cancelBubble }); };
  const C = G.card;
  if (C && !C.__wrapped) {
    C.__wrapped = true;
    const oc = C.close.bind(C), och = C._choose.bind(C);
    C.close = function (choice) { window.__keyLog.push({ type: 'card.close', choice: String(choice), open: !!C._open, state: G.state, t: Math.round(performance.now()),
      stack: String(new Error().stack).split(String.fromCharCode(10)).slice(2, 6).map(s => s.trim()).join(' | ') }); return oc(choice); };
    C._choose = function (w) { window.__keyLog.push({ type: 'card._choose', which: String(w), t: Math.round(performance.now()),
      stack: String(new Error().stack).split(String.fromCharCode(10)).slice(2, 6).map(s => s.trim()).join(' | ') }); return och(w); };
  }
  let lastSt = G.state;
  setInterval(() => { if (G.state !== lastSt) { window.__keyLog.push({ type: 'state', from: lastSt, to: G.state, t: Math.round(performance.now()) }); lastSt = G.state; } }, 30);
  const anyKey = (ph) => (e) => { if (e.code !== 'Escape') window.__keyLog.push({ ph, type: e.type, code: e.code, repeat: e.repeat, t: Math.round(performance.now()), state: G.state }); };
  window.addEventListener('keydown', anyKey('any-capture'), true);
  window.addEventListener('keyup', anyKey('any-capture'), true);
  window.addEventListener('keydown', log('win-capture-first'), true);
  window.addEventListener('keydown', log('win-bubble'), false);
  document.addEventListener('visibilitychange', () => window.__keyLog.push({ type: 'visibility', v: document.visibilityState, t: Math.round(performance.now()) }));
  window.addEventListener('blur', () => window.__keyLog.push({ type: 'window-blur', t: Math.round(performance.now()), state: G.state }));
  return 'wrapped';
}"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=GC.BASE)
    ap.add_argument("--gates", default="rime-1,azure-3")
    ap.add_argument("--reps", type=int, default=4)
    ap.add_argument("--out", default="")
    args = ap.parse_args()
    out = {"cycles": []}
    with sync_playwright() as p:
        try:
            br = p.chromium.launch(channel="chrome", headless=True, args=GC.FLAGS)
        except Exception:
            br = p.chromium.launch(headless=True, args=GC.HEADLESS_FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(args.url + "?quality=low&autoscale=0", wait_until="load", timeout=180000)
        GC.wait_ready(pg, timeout=600)
        pg.wait_for_timeout(1500)
        pg.evaluate(GC.CLICK_TITLE)
        for _ in range(240):
            if pg.evaluate("() => CRESTBOUND.game.state === 'keep' && !CRESTBOUND.game._loading"):
                break
            pg.wait_for_timeout(500)
        print("wrap:", pg.evaluate(WRAP), flush=True)
        pg.evaluate(GC.SET_CRESTS, 99)
        pg.wait_for_timeout(GC.SETTLE_MS)
        for course in [g.strip() for g in args.gates.split(",") if g.strip()]:
            for rep in range(args.reps):
                if pg.evaluate("() => CRESTBOUND.game.state") == "paused":
                    pg.evaluate("() => CRESTBOUND.game.resume()")
                    pg.wait_for_timeout(400)
                a = [0.0, -1.0, 1.0][rep % 3] * (0.6 if course == "azure-3" else 1.0)
                GC.place(pg, course, a)
                r = GC.walk_in(pg, course, a)
                raised = r["state"] == "card" or r["cardOpen"]
                pre = pg.evaluate("() => ({ state: CRESTBOUND.game.state, cardOpen: !!(CRESTBOUND.game.card && CRESTBOUND.game.card._open) })")
                pg.keyboard.press("Escape")
                pg.wait_for_timeout(700)
                back = pg.evaluate(GC.PROBE)
                logs = pg.evaluate("() => { const r = { pauses: window.__pauseLog.slice(), keys: window.__keyLog.slice() }; window.__pauseLog.length = 0; window.__keyLog.length = 0; return r; }")
                cyc = {"course": course, "offset": a, "raised": raised, "atEscape": pre, "after": back["state"],
                       "pauses": logs["pauses"], "keys": logs["keys"]}
                out["cycles"].append(cyc)
                print(json.dumps({k: cyc[k] for k in ("course", "offset", "raised", "atEscape", "after")}), flush=True)
                for pz in logs["pauses"]:
                    print("   PAUSE", json.dumps(pz)[:600], flush=True)
                for k in logs["keys"]:
                    print("   ev", json.dumps(k), flush=True)
        br.close()
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
