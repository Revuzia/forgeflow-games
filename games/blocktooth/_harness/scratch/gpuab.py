"""GPU-time A/B: at Size V + 250 foes (titan circling with real keys), hide mesh groups by name regex
and read the ?prof=1 GPU timer means per phase."""
import argparse, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.dirname(HERE))
from common import Session, add_common_args, build_url, set_rank  # noqa
import perfcheck
ap = argparse.ArgumentParser(); add_common_args(ap); ap.add_argument("--rscale", default="0.8")
ap.add_argument("phases", nargs="*", default=["", "city:prop:", "foe:", "civ:", "impostors", ":ink", "env:skyline", "env:"])
args = ap.parse_args()
url = build_url(args.base, autostart=1, dev=1, noslate=1, titan="molo", biome="grideast", seed=5, prof=1, rscale=args.rscale)
s = Session(args, "gpuab"); s.start()
HIDE = """(re) => { const sc = window.__BT__.debugCore.scene; window.__HID__ = window.__HID__ || [];
  const R = window.__BT__.debugCore.renderer; R.shadowMap.autoUpdate = re !== 'SHADOW'; if (re === 'SHADOW') return -1;
  for (const o of window.__HID__) o.layers.set(0); window.__HID__ = [];
  if (!re) return 0; const r = new RegExp(re);
  sc.traverse((o) => { if ((o.isMesh || o.isPoints || o.isLine) && r.test(o.name)) { o.layers.set(5); window.__HID__.push(o); } });
  return window.__HID__.length; }"""
REHIDE = "() => 0"
try:
    s.goto(url); s.wait_bt(90); s.events_off(); s.wait_screen(("play",), 90)
    s.cheat("god", True); s.cheat("noSpawns", True); set_rank(s, 4, print); time.sleep(2.5)
    perfcheck.spawn_mix(s, 250, print)
    i = 0
    for ph in args.phases:
        n = s.js(HIDE, ph)
        s.safe_js("() => window.__BTPROF__.reset()")
        t0 = time.time()
        while time.time() - t0 < float(os.environ.get('PHASE_S', '3')):
            s.hold(perfcheck.CIRCLE[i % 8]); i += 1
            st = s.state() or {}
            if st.get("screen") == "draft": s.release_all(); s.press("Digit1")
            if (st.get("enemies") or 0) < 225: perfcheck.spawn_mix(s, 250 - st["enemies"], lambda m: None)
            s.js(REHIDE)
            time.sleep(0.2)
        d = json.loads(s.js("() => JSON.stringify(window.__BTPROF__.dump())"))
        st = s.state()
        S = d["series"]; over = sum(1 for x in S if x[0] > 22); play = sum(1 for x in S if x[5])
        print("hide %-14r over22 %3d / %4d (play %d) n=%4d  gpu mean %5.2f p50 %5.2f p90 %5.2f | raw p99 %5.1f | draws %s tris %s" % (
            ph, over, len(S), play, n, d["gpuMean"], d["gpuP"].get("p50", -1), d["gpuP"].get("p90", -1), d["rawP"]["p99"], st["draws"], st["tris"]))
finally:
    s.close()
