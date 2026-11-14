#!/usr/bin/env python
"""G1 gate: GRID-EAST's boss (PARKADE-6) spawns in a real browser without errors.

(a) cheat.boss() on grideast -> must field BIOMES.grideast.boss == parkade6, run ~25 s under god,
    record attacks seen + phase, zero diagnostics, shot.
(b) cheat.bossSpawn('parkade6') path + cheat.tillOpen(3) + cheat.ult(100) + real E press (UPROAR vs the boss).

    python _harness/scratch/g1/bosscheck.py --base http://localhost:5178/ --no-serve
"""
import argparse, json, os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", ".."))
from common import SHOTS, Session, add_common_args, build_url, dismiss_slate, print_diagnostics, diag_problems  # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = add_common_args(argparse.ArgumentParser()).parse_args()
    url = build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=3)
    fails = []
    sess = Session(args, "g1boss")
    sess.start()
    try:
        sess.goto(url)
        sess.wait_bt(90)
        sess.wait_screen(["slate", "play"], 90)
        dismiss_slate(sess)
        sess.wait_screen(["play"], 20)
        sess.js("() => window.__BT__.cheat.god(true)")
        sess.js("() => window.__BT__.cheat.rank(4)")
        time.sleep(2.0)
        got = sess.js("() => window.__BT__.cheat.boss()")
        print("cheat.boss()  :", got)
        if got != "parkade6":
            fails.append("cheat.boss() on grideast fielded %r, expected parkade6" % got)
        seen, phases = {}, set()
        for i in range(25):
            time.sleep(1.0)
            b = sess.js("() => window.__BT__.state().boss")
            if not b:
                fails.append("boss vanished at +%ds" % (i + 1))
                break
            a = b.get("attack")
            if isinstance(a, dict):
                a = a.get("kind") or a.get("id") or json.dumps(a)[:40]
            if a:
                seen[a] = seen.get(a, 0) + 1
            if b.get("phase") is not None:
                phases.add(b.get("phase"))
            if i in (0, 12, 24):
                print("  +%2ds boss   : %s" % (i + 1, json.dumps(b)[:400]))
        print("attacks seen  :", json.dumps(seen), "· phases", sorted(phases, key=str))
        if not seen:
            fails.append("no PARKADE-6 attack observed in 25 s")
        sess.screenshot(os.path.join(SHOTS, "g1_parkade6_natural.png"))
        # UPROAR against the boss: charge it, real E press
        sess.js("() => window.__BT__.cheat.ult(100)")
        time.sleep(0.3)
        hp0 = sess.js("() => { const b = window.__BT__.state().boss; return b ? b.hp : null; }")
        sess.press("KeyE")
        time.sleep(3.5)
        u = sess.js("() => window.__BT__.state().v2.ult")
        hp1 = sess.js("() => { const b = window.__BT__.state().boss; return b ? b.hp : null; }")
        print("UPROAR (E)    : ult %s · boss hp %s -> %s" % (json.dumps(u)[:300], hp0, hp1))
        if not u or not u.get("fired"):
            fails.append("real E press with full charge did not fire UPROAR: %s" % u)
        sess.screenshot(os.path.join(SHOTS, "g1_parkade6_uproar.png"))
        # explicit bossSpawn path + till
        sp = sess.safe_js("() => { try { return window.__BT__.cheat.bossSpawn('parkade6'); } catch (e) { return 'threw: ' + e.message; } }")
        print("bossSpawn     :", sp)
        till = sess.safe_js("() => { try { return window.__BT__.cheat.tillOpen(3); } catch (e) { return 'threw: ' + e.message; } }")
        print("tillOpen(3)   :", till)
        time.sleep(3.0)
        rig = sess.js("""() => { const c = window.__BT__.debugCore; if (!c) return null;
            const o = c.scene.getObjectByName('boss:parkade6'); if (!o) return {found: false};
            const k = c.scene.getObjectByName('boss:caisson4');
            return {found: true, visible: o.visible, caissonVisible: k ? k.visible : null}; }""")
        print("rig           :", json.dumps(rig))
        if not rig or not rig.get("found") or not rig.get("visible") or rig.get("caissonVisible"):
            fails.append("parkade6 rig is not the visible boss rig: %s" % rig)
        sess.screenshot(os.path.join(SHOTS, "g1_parkade6_till.png"))
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
