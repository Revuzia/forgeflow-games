#!/usr/bin/env python
"""Size V + ~250 enemies (perfcheck setup), drive a few seconds, then dump __BT__.renderBreakdown
(main-pass tris per object; castShadow flag) + shadow-caster totals + renderer.info.
   python _harness/scratch/census.py [--quality N] [--rscale 0.6]"""
import json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url, set_rank, SHOTS  # noqa
import perfcheck  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap)
ap.add_argument("--top", type=int, default=45); ap.add_argument("--shot", default="")
ap.add_argument("--extra", default="")
args = ap.parse_args()
kw = dict(autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
for kv in filter(None, args.extra.split("&")):
    k, v = kv.split("="); kw[k] = v
url = build_url(args.base, **kw)
s = Session(args, "census"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, print)
    for i in range(12):
        s.hold(perfcheck.CIRCLE[i % 8]); time.sleep(0.35)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    s.release_all(); time.sleep(0.5)
    st = s.state() or {}
    if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen")); time.sleep(0.6)
    b = s.js("() => __BT__.renderBreakdown(%d)" % args.top)
    sh = s.js("""() => { const sc = __BT__.debugCore.scene; let t = 0, d = 0; const by = {};
      sc.traverseVisible(o => { if (!o.isMesh || !o.castShadow || !o.geometry) return; const g = o.geometry; const p = g.getAttribute('position');
        let n = g.index ? g.index.count : (p ? p.count : 0); if (g.drawRange && isFinite(g.drawRange.count)) n = Math.min(n, g.drawRange.count);
        const inst = o.isInstancedMesh ? o.count : 1; if (!inst || !n) return; t += Math.floor(n/3)*inst; d++;
        let r = o; while (r.parent && r.parent !== sc) r = r.parent; by[r.name||r.type] = (by[r.name||r.type]||0) + Math.floor(n/3)*inst; });
      const i = __BT__.debugCore.renderer.info.render; return {shadowTris: t, shadowDraws: d, by, infoTris: i.triangles, infoCalls: i.calls}; }""")
    print(json.dumps(st.get("renderScale")), "rank", st.get("rank"), "enemies", st.get("enemies"))
    print("TOTAL main tris %s draws %s | info tris %s calls %s | shadow casters tris %s draws %s" % (
        b["totalTris"], b["totalDraws"], sh["infoTris"], sh["infoCalls"], sh["shadowTris"], sh["shadowDraws"]))
    print("shadow by group:", json.dumps(sh["by"]))
    for g in b["groups"]: print("  G %-28s tris %8d draws %d" % (g["name"], g["tris"], g["draws"]))
    for m in b["meshes"]: print("  M %8d x%-5d %s %s" % (m["tris"], m["instances"], "S" if m["castShadow"] else "-", m["path"][-90:]))
    if args.shot: s.screenshot(args.shot)
finally:
    s.close()
