#!/usr/bin/env python
"""foes-view LOD A/B: Size V + ~250 enemies (perfcheck mix), sim frozen, near models vs far LOD.
Prints renderBreakdown for the 'enemies' root and whole scene, frame-time p50/p99 over a window per
mode, and writes two screenshots of the SAME frozen frame (near / lod) to _shots/foes_fix/.

    python _harness/scratch/foes-view/foe_lod_probe.py --base http://localhost:5195/ [--headless]
"""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import (ROOT, Session, add_common_args, build_url, set_rank, percentile)  # noqa: E402
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
import perfcheck  # noqa: E402

OUT = os.path.join(ROOT, "_shots", "foes_fix")
BD = "() => { const B = window.__BT__; const r = B.renderBreakdown(40); return { totalTris: r.totalTris, totalDraws: r.totalDraws, groups: r.groups, foe: r.meshes.filter(m => m.path.indexOf('foe:') >= 0).slice(0, 12) }; }"


def clear_drafts(s):
    for _ in range(20):
        st = s.state() or {}
        scr = st.get("screen")
        if scr == "draft":
            s.press("Digit1"); time.sleep(0.6)
        elif scr == "pause":
            s.press("Escape"); time.sleep(0.4)
        else:
            return scr
    return None


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--enemies", type=int, default=250)
    ap.add_argument("--rank", type=int, default=4)
    ap.add_argument("--window", type=float, default=5.0)
    ap.add_argument("--tag", default="V")
    a = ap.parse_args()
    a.no_serve = True
    os.makedirs(OUT, exist_ok=True)
    s = Session(a, "foelod")
    s.start()
    try:
        s.goto(build_url(a.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5))
        s.wait_bt(90)
        s.events_off()
        s.wait_screen(("play",), 90)
        s.cheat("god", True); s.cheat("noSpawns", True)
        set_rank(s, a.rank, print)
        time.sleep(2.5)
        perfcheck.spawn_mix(s, a.enemies, print)
        time.sleep(3.0)
        res = {}
        for mode in ("near", "lod"):
            s.safe_js("(v) => { window.__BT_FOE_NEAR__ = v; }", mode == "near")
            time.sleep(1.0)
            clear_drafts(s)
            s.ft_start()
            t0 = time.time(); ov = 0
            while time.time() - t0 < a.window:
                st = s.state() or {}
                if st.get("screen") != "play":
                    ov += 1; clear_drafts(s)
                time.sleep(0.25)
            ft = s.ft_stop()
            ft = [x for x in ft if isinstance(x, (int, float)) and x > 0]
            bd = s.safe_js(BD)
            st = s.state() or {}
            res[mode] = {"screen": "%s ov%d" % (st.get("screen"), ov), "p50": percentile(ft, 50), "p99": percentile(ft, 99), "frames": len(ft),
                         "draws": st.get("draws"), "tris": st.get("tris"), "enemies": st.get("enemies"), "rank": st.get("rank"),
                         "bd": bd}
        # same frozen frame, both modes
        print("screen before freeze:", clear_drafts(s))
        s.bt_call("freeze", True)
        time.sleep(0.4)
        pts = s.safe_js("""() => { const B = window.__BT__, core = B.debugCore, W = window.__H_W__(); const cam = core.camera; const V = cam.position.constructor;
          const cv = core.renderer.domElement, r = cv.getBoundingClientRect(); const out = []; const seen = {};
          for (const e of W.enemies) { if (!e.alive) continue; seen[e.kind] = (seen[e.kind] || 0) + 1; if (seen[e.kind] > 3) continue;
            const v = new V(e.x, (e.y || 0) + (e.height || 2) * 0.5, e.z).project(cam);
            const x = (v.x * 0.5 + 0.5) * r.width, y = (-v.y * 0.5 + 0.5) * r.height;
            if (x > 30 && x < r.width - 30 && y > 30 && y < r.height - 30 && v.z < 1) out.push([e.kind, x, y]); }
          return out; }""")
        with open(os.path.join(OUT, "foe_lod_%s_pts.json" % a.tag), "w") as fh:
            json.dump(pts, fh)
        for mode in ("near", "lod"):
            s.safe_js("(v) => { window.__BT_FOE_NEAR__ = v; }", mode == "near")
            time.sleep(0.5)
            s.screenshot(os.path.join(OUT, "foe_lod_%s_%s.png" % (a.tag, mode)))
        s.bt_call("freeze", False)
        s.safe_js("() => { window.__BT_FOE_NEAR__ = false; }")
        for mode, r in res.items():
            en = [g for g in (r["bd"] or {}).get("groups", []) if str(g["name"]).startswith("enemies")]
            print("%-5s [%s] rank %s enemies %s · frames %s p50 %.2f p99 %.2f · renderer draws %s tris %s · breakdown total %s tris / %s draws · enemies root %s" % (
                mode, r["screen"], r["rank"], r["enemies"], r["frames"], r["p50"] or -1, r["p99"] or -1, r["draws"], r["tris"],
                (r["bd"] or {}).get("totalTris"), (r["bd"] or {}).get("totalDraws"), json.dumps(en)))
            for m in (r["bd"] or {}).get("foe", [])[:8]:
                print("      %s" % json.dumps(m))
    finally:
        d = s.diagnostics()
        s.close()
        print("console errors:", [e[:160] for e in d.get("consoleErrors", [])][:4], "page errors:", d.get("pageErrors", [])[:3])


if __name__ == "__main__":
    main()
