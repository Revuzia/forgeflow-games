"""Repro 2: after Retry-from-pause, does Esc / P / __PAUSE__ still pause? Does movement work?"""
import os, sys, time, json, math
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url  # noqa
import argparse
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--variant", default="retry"); args = ap.parse_args(); args.no_serve = True
S = Session(args, "pause_repro2"); S.start()
def show(tag):
    s = S.state() or {}
    print("%-34s screen=%s seed=%s t=%.2f x=%.2f" % (tag, s.get("screen"), s.get("seed"), s.get("t") or 0, s.get("x") or 0), flush=True)
    return s
def try_pause(tag):
    for key in ("Escape", "KeyP"):
        S.press(key); ok, _ = S.wait_screen("pause", 2); show("%s %s -> pause? %s" % (tag, key, ok))
        if ok:
            time.sleep(0.4); S.press("Escape"); S.wait_screen("play", 3); time.sleep(0.4); show("  resumed")
    S.js("() => window.__PAUSE__.pause()"); ok, _ = S.wait_screen("pause", 2); show("%s __PAUSE__.pause -> %s" % (tag, ok))
    if ok:
        time.sleep(0.4); S.js("() => window.__PAUSE__.resume()"); S.wait_screen("play", 3); time.sleep(0.3)
    x0 = (S.state() or {}).get("x"); S.hold({"KeyD"}); time.sleep(0.8); S.release_all(); x1 = (S.state() or {}).get("x")
    print("   D moves x by %.2f" % ((x1 or 0) - (x0 or 0)), flush=True)
try:
    S.goto(build_url(args.base, autostart=1, seed=4242, titan="voltkite", biome="lockwater"))
    S.wait_bt(60); S.wait_screen("slate", 60); time.sleep(1)
    S.press("Enter"); S.wait_screen("play", 10); time.sleep(1.0)
    try_pause("run1")
    if args.variant == "retry":
        S.press("Escape"); S.wait_screen("pause", 3); time.sleep(0.4)
        for _ in range(2): S.press("ArrowDown"); time.sleep(0.2)
        S.press("Enter"); time.sleep(0.4); S.press("Enter")
    else:  # tabloid-less: newRun via select? use title quit + select
        S.press("Escape"); S.wait_screen("pause", 3); time.sleep(0.4)
        for _ in range(3): S.press("ArrowDown"); time.sleep(0.2)
        S.press("Enter"); time.sleep(0.4); S.press("Enter")
        S.wait_screen("title", 10); time.sleep(1); S.press("Enter"); S.wait_screen("select", 10); time.sleep(1.2)
        S.press("Enter"); time.sleep(0.8); S.press("Enter")
    ok, _ = S.wait_screen("slate", 30); show("slate? %s" % ok); time.sleep(1.0)
    S.press("Enter"); S.wait_screen("play", 10); time.sleep(1.0); show("run2 play")
    try_pause("run2")
finally:
    print(json.dumps({k: v[:5] for k, v in S.diagnostics().items() if v}, default=str)[:1500])
    S.close()
