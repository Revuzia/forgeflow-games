#!/usr/bin/env python
"""L5 scratch: real-browser check of the profile ledger + EXTENDED COVERAGE through the app wiring.

  python _harness/scratch/l5/profilecheck.py --base http://localhost:5255/ --headless

1. ?dev=1 (NO ?meta: the real localStorage profile), profile key cleared, reload.
2. newRun molo/lockwater seed 1337 (skipSlate) → cheat.endless() (boss killed + auto KEEP GOING).
3. the stored profile has the run filed (runs 1, clears 1, the clear goals done); play resumed in
   EXTENDED COVERAGE (v2.endless set, run.phase 'endless', ticks advance).
4. reload → the profile survives (state().v2.profile.done); the next run's RunMeta has the unlocks.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from common import Session, add_common_args  # noqa: E402
import argparse  # noqa: E402

KEY = "blocktooth.profile.v1"


def main():
    ap = add_common_args(argparse.ArgumentParser())
    args = ap.parse_args()
    base = args.base.rstrip("/") + "/"
    fails = []

    def ok(c, what):
        print(("  ok   " if c else "  FAIL ") + what)
        if not c:
            fails.append(what)
        return c

    with Session(args, "l5_profilecheck") as s:
        s.goto(base + "?dev=1")
        ok(s.wait_bt(60), "__BT__ up")
        s.js(f"() => localStorage.removeItem('{KEY}')")
        s.goto(base + "?dev=1")
        s.wait_bt(60)
        st = s.state()
        ok(st["v2"]["profile"]["done"] == [], f"fresh profile: done {st['v2']['profile']['done']}")
        s.js("() => window.__BT__.newRun({titan: 'molo', biome: 'lockwater', seed: 1337, skipSlate: true})")
        s.wait_screen(["play"], 60)
        time.sleep(1.0)
        ok(s.js("() => window.__BT__.cheat.endless()") in (True, False), "cheat.endless() ran")
        t0 = time.time()
        endless = None
        while time.time() - t0 < 60:
            st = s.state()
            endless = st.get("v2", {}).get("endless")
            if endless and st.get("screen") == "play":
                break
            time.sleep(0.3)
        ok(bool(endless), f"EXTENDED COVERAGE started (screen {st.get('screen')}, endless {json.dumps(endless)[:160]})")
        run = st.get("run") or {}
        print("  run:", json.dumps(run)[:200])
        tick0 = s.js("() => window.__BT__.state().tick")
        time.sleep(3.0)
        st = s.state()
        tick1 = st.get("tick")
        ok(isinstance(tick0, (int, float)) and isinstance(tick1, (int, float)) and tick1 > tick0 + 30, f"sim advances in endless (tick {tick0} → {tick1})")
        ok((st.get("run") or {}).get("phase") == "endless", f"run.phase {(st.get('run') or {}).get('phase')}")
        ok((st["v2"]["endless"] or {}).get("score", 0) > 0, f"endless score {(st['v2']['endless'] or {}).get('score')}")
        raw = s.js(f"() => localStorage.getItem('{KEY}')")
        ok(raw is not None, "profile written to localStorage")
        prof = json.loads(raw) if raw else {}
        life = prof.get("life", {})
        done = sorted(prof.get("done", {}).keys())
        print("  stored life:", json.dumps(life))
        print("  stored done:", done)
        print("  stored newUnlocks:", prof.get("newUnlocks"))
        ok(life.get("runs") == 1 and life.get("clears") == 1, f"runs {life.get('runs')} clears {life.get('clears')}")
        for g in ["g_first_broadcast", "g_city_got_smaller", "g_molo_bite_sized", "g_lw_port_closed"]:
            ok(g in done, f"filed {g}")
        # reload: persistence
        s.goto(base + "?dev=1")
        s.wait_bt(60)
        st = s.state()
        pd = st["v2"]["profile"]["done"]
        ok("g_first_broadcast" in pd and "g_lw_port_closed" in pd, f"after reload profile.done = {sorted(pd)}")
        s.js("() => window.__BT__.newRun({titan: 'molo', biome: 'grideast', seed: 7, skipSlate: true})")
        s.wait_screen(["play"], 60)
        st = s.state()
        unl = st["v2"]["meta"]["unlocked"]
        ok(all(u in unl for u in ["u_block_captain", "u_ribbon_cutting", "evo_municipal_stomach", "u_landmark_status"]), f"next run's RunMeta.unlocked = {unl}")
        errs = [t for (k, t) in s.console if k == "error"] + s.page_errors
        ok(not errs, f"console/page errors: {len(errs)} {errs[:3]}")
        s.js(f"() => localStorage.removeItem('{KEY}')")
    print("PROFILECHECK:", "PASS" if not fails else f"FAIL ({len(fails)})")
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
