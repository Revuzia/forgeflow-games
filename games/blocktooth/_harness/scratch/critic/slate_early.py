"""Repro 3: dismiss the slate EARLY (d s after it appears) with Enter; can the player still pause?"""
import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url  # noqa
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--delays", default="0.05,0.3,0.6,1.2"); ap.add_argument("--via", default="retry")
args = ap.parse_args(); args.no_serve = True
S = Session(args, "slate_early"); S.start()
def st(): return S.state() or {}
res = []
try:
    for d in [float(x) for x in args.delays.split(",")]:
        if args.via == "retry":
            if st().get("screen") != "play":
                S.goto(build_url(args.base, autostart=1, seed=4242, titan="voltkite", biome="lockwater"))
                S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1); S.press("Enter"); S.wait_screen("play", 10); time.sleep(0.8)
            S.press("Escape"); S.wait_screen("pause", 3); time.sleep(0.4)
            for _ in range(2): S.press("ArrowDown"); time.sleep(0.2)
            S.press("Enter"); time.sleep(0.4); S.press("Enter")
        else:
            S.goto(build_url(args.base, autostart=1, seed=4242, titan="voltkite", biome="lockwater")); S.wait_bt(60)
        ok, _ = S.wait_screen("slate", 30)
        t0 = time.time(); time.sleep(d)
        S.press("Enter")
        okp, _ = S.wait_screen("play", 6)
        dt = time.time() - t0
        time.sleep(1.0)
        S.press("Escape"); okpause, _ = S.wait_screen("pause", 2)
        s = st()
        r = {"via": args.via, "delay": d, "slate": ok, "play": okp, "slate_to_play_s": round(dt, 2), "esc_pauses": okpause, "screen": s.get("screen")}
        if not okpause:
            S.press("KeyP"); r["P_pauses"], _ = S.wait_screen("pause", 2)
            if not r["P_pauses"]:
                S.js("() => window.__PAUSE__.pause()"); r["api_pauses"], _ = S.wait_screen("pause", 2)
            x0 = st().get("x"); S.hold({"KeyD"}); time.sleep(0.8); S.release_all(); r["D_dx"] = round((st().get("x") or 0) - (x0 or 0), 2)
            r["modalDom"] = S.safe_js("() => [...document.querySelectorAll('.bt-layer')].filter(l => !l.classList.contains('bt-hidden')).map(l => l.className)")
        print(json.dumps(r), flush=True); res.append(r)
        if st().get("screen") == "pause":
            time.sleep(0.4); S.press("Escape"); S.wait_screen("play", 3); time.sleep(0.5)
finally:
    print(json.dumps({k: v[:5] for k, v in S.diagnostics().items() if v}, default=str)[:1500])
    S.close()
