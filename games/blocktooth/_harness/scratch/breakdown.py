import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck
ap = argparse.ArgumentParser(); add_common_args(ap); args = ap.parse_args()
url = build_url(args.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
s = Session(args, "bd"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, print); time.sleep(2)
    st = s.state(); print("rank", st["rank"], "enemies", st["enemies"], "draws", st["draws"], "tris", st["tris"])
    bd = s.js("() => window.__BT__.renderBreakdown(30)")
    for g in bd["groups"][:20]: print("G %-40s tris %8d draws %4d" % (g["name"][:40], g["tris"], g["draws"]))
    for m in bd["meshes"][:30]: print("M %-90s tris %8d inst %5d shadow %s" % (m["path"][-90:], m["tris"], m["instances"], m["castShadow"]))
finally:
    s.close()
