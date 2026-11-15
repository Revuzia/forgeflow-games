"""Screenshot the perf load once DynRes has dropped to its floor (visual check of the floor)."""
import os, sys, time, json, argparse
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import Session, add_common_args, build_url, set_rank, SHOTS
from perfcheck import spawn_mix, CIRCLE, clear_overlay
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--extra", default=""); ap.add_argument("--name", default="floor")
args = ap.parse_args(); args.no_serve = True
S = Session(args, "scaleshot"); S.start()
try:
    kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
    for kv in filter(None, args.extra.split(",")): k, v = kv.split("="); kw[k] = v
    S.goto(build_url(args.base, **kw)); S.wait_bt(90); S.wait_screen("play", 90)
    S.cheat("god", True); S.cheat("noSpawns", True); set_rank(S, 4); time.sleep(2.5); spawn_mix(S, 250, print)
    t0 = time.time(); i = 0
    while time.time() - t0 < 25:
        S.hold(CIRCLE[i % 8]); i += 1; time.sleep(0.35)
        s = S.state() or {}
        if s.get("screen") != "play": clear_overlay(S, s.get("screen")); continue
        if kw.get("dynres") == "0" and time.time() - t0 > 6: break
        if s.get("renderScale", 1) <= 0.61 and time.time() - t0 > 6: break
    S.release_all(); time.sleep(0.3)
    s = S.state() or {}
    p = os.path.join(SHOTS, "appfix", "dynres_%s.png" % args.name); S.screenshot(p)
    print(json.dumps({"scale": s.get("renderScale"), "screen": s.get("screen"), "shot": p}))
finally:
    S.close()
