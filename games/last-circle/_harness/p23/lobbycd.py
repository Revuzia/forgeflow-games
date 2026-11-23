#!/usr/bin/env python
"""lobbycd - the match lobby's countdown is immune to a throwing listener (friends rooms fix 3, R4). One Chrome at 1280x720: the REAL hud.js
showLobby (the module instance the boot loaded) is driven on the booted page with a planted 'countdownBeep' listener that THROWS, once for a
practice lobby (the 1-count) and once for an online lobby (W.net set: the fixed 700 ms fill + the 3-count, the path every friends room takes).

    python _harness/p23/lobbycd.py --disk
    python _harness/p23/lobbycd.py --disk --plant unguarded     # hud.js served with the timers' emits unguarded (the old code) - MUST FAIL

Why: W.events.emit (ffg_royale3d.js mkEmitter) calls every listener with no try/catch, and showLobby's countdown emitted 'countdownBeep' straight
from its timer callbacks: a listener that threw before cdIv was set stopped the countdown from ever starting, one that threw inside it kept
finishLobby from running - the page sat in the lobby for good while the room dropped without it. The fix logs the error and the drop goes on.

Rows:
  control       the planted listener ran and threw (>= 1 throw in each lobby): the fault is live
  practice      the practice lobby still ends in the drop (onDone called, _lobbyFill.end 'drop', >= 1 countdown tick) within 30 s
  online        the online lobby (W.net set) still ends in the drop: 3 countdown ticks, onDone called, within 30 s
  logged        the guarded build logs each throw ('[hud] a 'countdownBeep' listener threw in the match lobby ...') and counts it (listenerErrors)
  errors        0 page errors, 0 failed requests, 0 console errors other than that logged line
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

HUD_REL = "runtime/3d/royale/hud.js"
# the planted fault: the timers' emits unguarded again (exactly the pre-fix code path: the listener's throw leaves the timer callback)
PLANTS = {
    "unguarded": [("try { W.events.emit(name, ...args); } catch (e) { LF.listenerErrors++; console.error(\"[hud] a '\" + name + \"' listener threw in the match lobby (the countdown goes on):\", e); }",
                   "W.events.emit(name, ...args);   /* PLANTED: unguarded */")],
}
LOGGED = "listener threw in the match lobby"

HUDMOD_JS = r"""async () => { if (window.__HUDMOD__) return true;
  const sc = [...document.scripts].find((x) => /ffg_boot3d\.js/.test(x.src)); if (!sc) return false;
  window.__HUDMOD__ = await import(new URL('royale/hud.js' + new URL(sc.src).search, sc.src).href); return true; }"""
# one lobby: a 50-name roster, `mode`, W.net set or not; the planted listener throws on every beep. W's fields are put back afterwards.
RUN_JS = r"""async ([mode, online, waitMs]) => {
  const W = window.__LC__.W, H = window.__HUDMOD__;
  if (!window.__PLANTED_L__) { window.__PLANTED_L__ = true; window.__THROWS__ = 0;
    W.events.on('countdownBeep', () => { window.__THROWS__++; throw new Error('planted: a countdownBeep listener that throws'); }); }
  const th0 = window.__THROWS__;
  const save = { actors: W.actors, mode: W.mode, net: W.net, mapId: W.mapId };
  const fake = []; for (let i = 0; i < 50; i++) fake.push({ id: 's' + i, name: 'Player ' + i });
  W.actors = fake; W.mode = mode; W.net = online ? { __lobbycdStub: true } : null; if (!(W.map && W.map.K && W.map.K.name) && !W.mapId) W.mapId = 'ashgrid';
  let done = null, threw = null; const t0 = performance.now();
  try { H.showLobby(W, () => { done = Math.round(performance.now() - t0); }); } catch (e) { threw = String(e && e.message || e); }
  await new Promise((r) => { const iv = setInterval(() => { if (done != null || performance.now() - t0 > waitMs) { clearInterval(iv); r(); } }, 50); });
  const LF = Object.assign({}, W._lobbyFill || {});
  Object.assign(W, save);
  const layer = !!document.querySelector('[data-lc="lobbygrid"]');
  return { done, threw, LF, throws: window.__THROWS__ - th0, layerLeft: layer }; }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)

    def body(v):
        init = "try { localStorage.setItem('lc_seen_intro', '1'); } catch (e) {}"
        with C.Session(args, "p23_lobbycd", viewport={"width": 1280, "height": 720}, init_scripts=[init]) as s:
            if args.plant:
                v.data["plant_served"] = L.serve_patched(s, HUD_REL, PLANTS[args.plant])
            s.boot()
            s.sleep(1.0)
            L.dismiss_cards(s)
            if not s.js(HUDMOD_JS):
                v.check("the boot's hud.js module instance is reachable", False, None)
                return
            pr = s.js(RUN_JS, ["practice", False, 30000])
            on = s.js(RUN_JS, ["quick", True, 30000])
            v.data["practice"], v.data["online"] = pr, on
            v.check("control (the planted countdownBeep listener ran and threw in both lobbies)", pr["throws"] >= 1 and on["throws"] >= 1,
                    {"practice": pr["throws"], "online": on["throws"]}, ">= 1 each")
            v.check("practice (a throwing listener cannot stop the drop: onDone called, end 'drop', >= 1 tick, within 30 s)",
                    pr["done"] is not None and pr["LF"].get("end") == "drop" and (pr["LF"].get("ticks") or 0) >= 1 and not pr["threw"] and not pr["layerLeft"],
                    pr, "dropped")
            v.check("online (W.net set: 700 ms fill + 3-count, every beep's listener throws; the room's page still drops: 3 ticks, onDone, within 30 s)",
                    on["done"] is not None and on["LF"].get("end") == "drop" and (on["LF"].get("ticks") or 0) == 3 and on["LF"].get("fillMs") == 700 and not on["threw"]
                    and not on["layerLeft"], on, "dropped")
            d = s.diagnostics()
            logged = [x for x in d["consoleErrors"] if LOGGED in x]
            v.check("logged (each throw is logged as '[hud] ... listener threw in the match lobby' and counted in _lobbyFill.listenerErrors)",
                    len(logged) >= pr["throws"] + on["throws"] and (pr["LF"].get("listenerErrors") or 0) == pr["throws"] and (on["LF"].get("listenerErrors") or 0) == on["throws"],
                    {"logged": len(logged), "throws": pr["throws"] + on["throws"], "listenerErrors": [pr["LF"].get("listenerErrors"), on["LF"].get("listenerErrors")]})
            other = [x for x in d["consoleErrors"] if LOGGED not in x]
            v.check("errors (0 page errors, 0 failed requests, 0 console errors besides the logged listener line)",
                    not d["pageErrors"] and not d["failedRequests"] and not other,
                    {"pageErrors": d["pageErrors"][:4], "failedRequests": d["failedRequests"][:4], "consoleErrors": other[:4]})
    return C.run_gate("p23_lobbycd", body, args)


if __name__ == "__main__":
    sys.exit(main())
