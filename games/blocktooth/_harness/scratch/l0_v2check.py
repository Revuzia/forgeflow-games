#!/usr/bin/env python
"""L0 SKELETON smoke check (FEATURES_V2 §13.3): the v2 test surface exists and every stub stays inert in a
real browser — state().v2 / v2dom shape, real E press in play (no error, UPROAR stub stays 0), the v2 cheats
(ult / powerup / objective / bossSpawn('parkade6') → placeholder rig renders / tillOpen / evolveReady
refusal), zero console errors. Shots: _shots/l0_parkade6_placeholder.png.

    python _harness/scratch/l0_v2check.py --base http://localhost:5250 --no-serve
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate, print_diagnostics, diag_problems  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = add_common_args(argparse.ArgumentParser())
    args = ap.parse_args()
    url = build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=7)
    fails = []
    sess = Session(args, "l0v2")
    sess.start()
    try:
        sess.goto(url)
        sess.wait_bt(90)
        sess.wait_screen(["slate", "play"], 90)
        dismiss_slate(sess)
        sess.wait_screen(["play"], 20)
        st = sess.js("() => { const s = window.__BT__.state(); return {v2: s.v2, v2dom: s.v2dom, screen: s.screen}; }")
        print("state().v2    :", json.dumps(st["v2"])[:900])
        print("state().v2dom :", json.dumps(st["v2dom"]))
        for k in ["ult", "objectives", "powerups", "power", "endless", "tally", "map", "meta", "cine", "draft", "profile"]:
            if k not in st["v2"]:
                fails.append("state().v2 missing " + k)
        dom = st["v2dom"]
        if any(dom[k] != 0 for k in ["barSlots", "meterPct", "trackerRows", "markers", "toasts"]):
            fails.append("v2dom counts not 0 with the stubs: %s" % dom)
        # real E press in play
        t0 = sess.js("() => window.__BT__.state().tick")
        sess.press("KeyE")
        time.sleep(0.6)
        t1 = sess.js("() => window.__BT__.state().tick")
        u = sess.js("() => window.__BT__.state().v2.ult")
        print("E pressed     : tick %s → %s · ult %s" % (t0, t1, json.dumps(u)))
        if not (t1 > t0):
            fails.append("sim did not advance after E")
        if u["fired"] != 0 or u["charge"] != 0:
            fails.append("UPROAR stub not inert: %s" % u)
        # cheats against the stubs
        r = {
            "ult": sess.js("() => window.__BT__.cheat.ult(100)"),
            "powerup": sess.js("() => window.__BT__.cheat.powerup('rushHour')"),
            "objective": sess.js("() => window.__BT__.cheat.objective('reliefDepot', 10)"),
            "evolveReady": sess.safe_js("() => { try { return window.__BT__.cheat.evolveReady('nope'); } catch (e) { return 'threw: ' + e.message; } }"),
        }
        print("cheats (stubs):", json.dumps(r))
        sess.js("() => window.__BT__.cheat.god(true)")
        sess.js("() => window.__BT__.cheat.level(35)")
        time.sleep(1.5)
        boss = sess.js("() => window.__BT__.cheat.bossSpawn('parkade6')")
        print("bossSpawn     :", boss)
        if boss != "parkade6":
            fails.append("bossSpawn('parkade6') returned %r" % boss)
        time.sleep(4.0)                       # intro walk-in
        till = sess.js("() => window.__BT__.cheat.tillOpen(3)")
        b = sess.js("() => window.__BT__.state().boss")
        print("boss state    :", json.dumps(b))
        # is the placeholder rig in the scene and visible?
        rig = sess.js("""() => { const c = window.__BT__.debugCore; if (!c) return null;
            const o = c.scene.getObjectByName('boss:parkade6'); if (!o) return {found: false};
            const g = c.scene.getObjectByName('boss:irongully'); const k = c.scene.getObjectByName('boss:caisson4');
            return {found: true, visible: o.visible, gullyVisible: g ? g.visible : null, caissonVisible: k ? k.visible : null}; }""")
        print("rig           :", json.dumps(rig), "· tillOpen", till)
        if not rig or not rig.get("found") or not rig.get("visible") or rig.get("gullyVisible") or rig.get("caissonVisible"):
            fails.append("parkade6 placeholder rig not the visible boss rig: %s" % rig)
        shot = os.path.join(SHOTS, "l0_parkade6_placeholder.png")
        sess.screenshot(shot)
        print("shot          :", shot)
        d = sess.diagnostics()
        print_diagnostics(d)
        probs = diag_problems(d)
        if probs:
            fails.append("diagnostics: %s" % probs)
    finally:
        sess.close()
    for f in fails:
        print("  [FAIL]", f)
    print("RESULT:", "PASS" if not fails else "FAIL")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
