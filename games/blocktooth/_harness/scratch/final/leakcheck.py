#!/usr/bin/env python
"""Final-verifier leak check: 5 (+1 warm) __BT__.newRun cycles, renderer.info.memory + programs after each.
Each run cycles titan/biome, plays ~4 s with a Size-III rank-up so views allocate, then the next newRun
tears it down. Flat = geometries/textures/programs return to the same value at the same titan+biome."""
import argparse, json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from common import Session, add_common_args, build_url, ensure_play  # noqa: E402

MEM_JS = r"""() => { const c = window.__BT__ && window.__BT__.debugCore; if (!c) return null;
 const i = c.renderer.info; return { geo: i.memory.geometries, tex: i.memory.textures,
 prog: (i.programs || []).length, heap: (performance.memory ? Math.round(performance.memory.usedJSHeapSize/1048576) : null) }; }"""

def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--v2", type=int, default=1, help="1 = also exercise the v2 views each cycle (default)")
    args = ap.parse_args()
    combos = [("molo", "grideast"), ("voltkite", "lockwater"), ("hearthback", "whitestacks"),
              ("briarwick", "grideast"), ("molo", "grideast"), ("voltkite", "lockwater"),
              ("molo", "grideast")]
    rows = []
    with Session(args, "leakcheck") as s:
        s.goto(build_url(args.base, autostart=1, dev=1, titan="molo", biome="grideast", seed=1, noslate=1))
        s.wait_bt(90)
        s.wait_screen(("play", "slate"), 90)
        for i, (t, b) in enumerate(combos):
            ok, v = s.bt_call("newRun", {"titan": t, "biome": b, "seed": 100 + i, "skipSlate": True})
            if not ok:
                print("newRun failed", v); return 2
            s.wait_screen(("play",), 60)
            s.cheat("rank", 2)
            if args.v2:
                # v2 views allocate too (FEATURES_V2 §15.5): an UPROAR fired by a real E, a power-up,
                # an OVERLOAD SITE + a RELIEF DEPOT (objective / marker views)
                s.cheat("ult", 100); time.sleep(0.3); s.press("KeyE", 80)
                s.cheat("powerup", "cleanup"); s.cheat("objective", "overloadSite"); s.cheat("objective", "reliefDepot", 20)
            s.hold(["w", "d"]); time.sleep(4.0); s.release_all()
            time.sleep(0.5)
            m = s.js(MEM_JS)
            st = s.state()
            v2 = st.get("v2") or {}
            rows.append({"i": i, "titan": t, "biome": b, **(m or {}), "screen": st.get("screen"), "rank": st.get("rank"),
                         "ultFired": (v2.get("ult") or {}).get("fired"), "objs": len(v2.get("objectives") or []),
                         "pus": len(v2.get("powerups") or [])})
            print(json.dumps(rows[-1]), flush=True)
        errs = [c for c in s.console if c[0] == "error"] + s.page_errors
        print("errors:", len(errs), errs[:5])
    return 0

if __name__ == "__main__":
    sys.exit(main())
