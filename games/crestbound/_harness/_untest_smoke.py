# -*- coding: utf-8 -*-
"""Smoke the _untestlib toolbox on one course before the full re-measure runs."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from _untestlib import Probe, stations_from_text

COURSE = sys.argv[1] if len(sys.argv) > 1 else "verdant-1"

with Probe("untest_smoke") as p:
    p.click_title(); p.wait(1000)
    p.unlock_all(); p.wait(300)
    print("toolbox:", p.install())
    if COURSE != "keep":
        p.js("(c)=>{CRESTBOUND.game.__dev.goto(c);}", COURSE)
        for _ in range(70):
            p.wait(250)
            if p.js("()=>CRESTBOUND.game.state==='playing' && CRESTBOUND.game.courseId===%s" % json.dumps(COURSE)):
                break
    p.wait(1200)
    print("loaded:", p.js("()=>({id:CRESTBOUND.game.courseId,state:CRESTBOUND.game.state})"))
    st = p.snap()
    print("snap:", st)
    xyz = [st["x"], st["y"], st["z"]]
    print("groundAt:", p.cbx("groundAt", xyz[0], xyz[2], xyz[1] + 60))
    print("probePoint:", json.dumps(p.cbx("probePoint", *xyz))[:600])
    print("phaseScan:", json.dumps({k: v for k, v in (p.phase_scan(xyz, 20, 20) or {}).items() if k != "rows"}))
    print("saveSet:", p.set_save(crestTotal=8, power="metal"))
    print("screenBlockers:", json.dumps(p.cbx("screenBlockers", 0.03))[:600])
    print("matsNear:", json.dumps(p.cbx("matsNear", xyz[0], xyz[1], xyz[2], 6))[:500])
    print("frame_stats:", p.frame_stats((0.3,0.3,0.4,0.4), "smoke"))
    print("textBoards:", json.dumps(p.cbx("textBoards", xyz[0], xyz[1], xyz[2], 20))[:400])
    hs = p.cbx("heroSample")
    print("heroSample n:", len(hs or []), (hs or [])[:3])
    print("goto_verify:", json.dumps(p.goto_verify(xyz))[:500])
    print("cam_sweep:", json.dumps({k: v for k, v in (p.cam_sweep(xyz, 4) or {}).items() if k != "rows"}))
    print("two_input:", json.dumps(p.run_then(700, "C", "Space"))[:400])
    print("console:", p.console[:8])
