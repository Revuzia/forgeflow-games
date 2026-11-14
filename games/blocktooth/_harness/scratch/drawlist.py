#!/usr/bin/env python
"""Size V + 250 foes: one frame's actual draw list (wraps renderer.renderBufferDirect for 2 frames):
draws grouped by object-name prefix, main pass vs shadow pass."""
import json, os, sys, time, collections
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
import argparse
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck  # noqa
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--rank", type=int, default=4); args = ap.parse_args()
url = build_url(args.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5)
s = Session(args, "drawlist"); s.start()
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, args.rank, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, lambda m: None)
    for i in range(10):
        s.hold(perfcheck.CIRCLE[i % 8]); time.sleep(0.35)
        st = s.state() or {}
        if st.get("screen") != "play": perfcheck.clear_overlay(s, st.get("screen"))
    s.release_all(); time.sleep(0.3)
    r = s.js("""() => new Promise((res) => { const R = __BT__.debugCore.renderer; const orig = R.renderBufferDirect; const log = [];
      R.renderBufferDirect = function (camera, scene, geometry, material, object, group) { log.push([camera.isOrthographicCamera ? 'S' : 'M', object.name || object.type]); return orig.apply(this, arguments); };
      let n = 0; const f = () => { if (++n < 3) { requestAnimationFrame(f); return; } R.renderBufferDirect = orig; res(log); }; requestAnimationFrame(f); })""")
    c = collections.Counter()
    for p, nm in r:
        key = nm.split(":")[0] + ":" + (nm.split(":")[1] if ":" in nm else "")
        if nm.endswith(":ink"): key += ":ink"
        c[(p, key)] += 1
    tot = collections.Counter(p for p, _ in r)
    print("draws over 2 frames:", dict(tot))
    for (p, k), v in sorted(c.items(), key=lambda kv: -kv[1])[:40]: print("  %s %-34s %d" % (p, k, v))
finally:
    s.close()
