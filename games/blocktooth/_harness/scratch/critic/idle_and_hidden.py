"""(a) visibilitychange → pause (synthetic: document.hidden overridden, real event dispatched);
(b) window blur alone; (c) idle-survival: slate dismissed with a real key, then NO input — how long does a Size I titan live?"""
import os, sys, time, json
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url  # noqa
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--combos", default="voltkite/lockwater/4242,molo/grideast/77,hearthback/whitestacks/5,briarwick/grideast/9")
args = ap.parse_args(); args.no_serve = True
S = Session(args, "idle_hidden"); S.start()
def st(): return S.state() or {}
try:
    S.goto(build_url(args.base, autostart=1, noslate=1, seed=3, titan="molo")); S.wait_bt(60); S.wait_screen("play", 60); time.sleep(1)
    S.js("() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }")
    ok, _ = S.wait_screen("pause", 2)
    S.js("() => { delete document.hidden; delete document.visibilityState; }")
    print(json.dumps({"synthetic_hidden_pauses": ok, "hiddenNow": S.js("() => document.hidden")}), flush=True)
    if ok: time.sleep(0.4); S.press("Escape"); S.wait_screen("play", 3); time.sleep(0.5)
    S.js("() => window.dispatchEvent(new Event('blur'))"); time.sleep(0.6)
    print(json.dumps({"blur_alone_pauses": st().get("screen") == "pause"}), flush=True)
    for c in args.combos.split(","):
        t, b, seed = c.split("/")
        S.goto(build_url(args.base, autostart=1, seed=int(seed), titan=t, biome=b)); S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1.2)
        S.press("Enter"); S.wait_screen("play", 10)
        t0 = time.time(); hp = []
        while time.time() - t0 < 150:
            s = st()
            if s.get("screen") == "draft":
                S.press("Digit1"); time.sleep(0.6); continue
            if s.get("screen") in ("end",) or (s.get("run") or {}).get("result"):
                break
            hp.append((round(s.get("t") or 0, 1), round(s.get("hp") or 0), s.get("enemies")))
            time.sleep(1.0)
        s = st()
        print(json.dumps({"titan": t, "biome": b, "idle_death_t": round(s.get("t") or 0, 1), "result": (s.get("run") or {}).get("result"), "level": s.get("level"), "hp_trace": hp[::5]}), flush=True)
finally:
    print(json.dumps({k: v[:5] for k, v in S.diagnostics().items() if v}, default=str)[:1500])
    S.close()
