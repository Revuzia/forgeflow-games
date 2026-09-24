#!/usr/bin/env python
"""GPU frame time probe (EXT_disjoint_timer_query_webgl2 around renderer.render) at the perfcheck load:
Size V + ~250 enemies, real keys driving circles. Also measures with the city hidden (cityview root
invisible) for attribution.

    python _harness/scratch/city-view/gpu_probe.py --base http://localhost:5194/ [--seconds 6]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import (Session, add_common_args, build_url, ensure_play, set_rank)  # noqa: E402
from perfcheck import spawn_mix, CIRCLE  # noqa: E402

INSTALL = r"""
() => {
  const core = window.__BT__.debugCore; const r = core.renderer; const gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) return 'no ext';
  const G = window.__GPU__ = { ms: [], pending: [], on: false };
  const orig = r.render.bind(r);
  let depth = 0;
  r.render = function (scene, camera) {
    if (depth > 0 || !G.on) return orig(scene, camera);
    depth++;
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
    try { return orig(scene, camera); } finally {
      gl.endQuery(ext.TIME_ELAPSED_EXT); G.pending.push(q); depth--;
      for (let i = G.pending.length - 1; i >= 0; i--) {
        const p = G.pending[i];
        if (gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) {
          if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) G.ms.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
          gl.deleteQuery(p); G.pending.splice(i, 1);
        }
      }
    }
  };
  return 'ok';
}
"""
STATS = r"""
() => { const a = window.__GPU__.ms.slice().sort((x, y) => x - y); if (!a.length) return null;
  const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
  return { n: a.length, p50: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), mean: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) }; }
"""
HIDE = r"""
(key) => { const sc = window.__BT__.debugCore.scene; let root = null;
  sc.traverse((o) => { if (o.name === 'cityview') root = o; });
  if (!root) return -1; let n = 0;
  for (const o of root.children) {
    const nm = o.name || '';
    let hide = false;
    if (key === 'all') hide = true;
    else if (key === 'ground') hide = nm === 'city:road' || nm.startsWith('city:sidewalk') || nm.startsWith('city:lots') || nm.startsWith('city:plaza') || nm.startsWith('city:lot');
    else if (key === 'bldg') hide = nm.startsWith('city:') && !nm.startsWith('city:prop') && !nm.startsWith('city:road') && !nm.startsWith('city:sidewalk') && !nm.startsWith('city:paint') && !nm.startsWith('city:rubble') && !nm.startsWith('city:impostors') && !nm.startsWith('city:lot') && !nm.startsWith('city:plaza');
    else if (key) hide = nm.startsWith(key);
    // layers, not .visible (instance batches rewrite .visible on every commit)
    if (key === null) o.traverse((c) => c.layers.set(0));
    else if (hide) { o.traverse((c) => c.layers.set(31)); n++; }
  }
  return n; }
"""
CITY_VIS = r"""
(on) => { const sc = window.__BT__.debugCore.scene; let n = 0;
  sc.traverse((o) => { if (o.name === 'cityview') { o.visible = on; n++; } }); return n; }
"""


def window(s, seconds, tag):
    s.js("() => { window.__GPU__.ms.length = 0; window.__GPU__.on = true; }")
    t0 = time.time()
    i = 0
    while time.time() - t0 < seconds:
        s.safe_js("() => { const U = window.__H_W__().upgrades; U.pendingDrafts = 0; U.chestDrafts = 0; }")
        if s.screen() != "play":
            s.release_all()
            ensure_play(s, 5)
        s.hold(CIRCLE[i % len(CIRCLE)])
        i += 1
        time.sleep(0.5)
    s.release_all()
    s.js("() => { window.__GPU__.on = false; }")
    st = s.js(STATS)
    rs = (s.state() or {}).get("renderScale")
    print("%-10s gpu ms %s  renderScale %s" % (tag, json.dumps(st), rs), flush=True)
    return st


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--seconds", type=float, default=6.0)
    ap.add_argument("--biome", default="grideast")
    ap.add_argument("--split", action="store_true")
    ap.add_argument("--reps", type=int, default=2)
    a = ap.parse_args()
    a.no_serve = True
    with Session(a, "gpu_probe") as s:
        s.goto(build_url(a.base, autostart=1, dev=1, titan="molo", biome=a.biome, seed=5, noslate=1))
        s.wait_bt(90)
        s.wait_screen(("slate", "play", "draft"), 90)
        ensure_play(s, 15)
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        print("install", s.js(INSTALL))
        set_rank(s, 4)
        time.sleep(3.0)
        ensure_play(s, 10)
        spawn_mix(s, 250, lambda m: None)
        time.sleep(1.0)
        if not a.split:
            window(s, a.seconds, "full")
            s.js(CITY_VIS, False)
            window(s, a.seconds, "no-city")
            s.js(CITY_VIS, True)
            window(s, a.seconds, "full-again")
            return
        groups = [("full", None), ("-impost", "city:impostors"), ("-ground", "ground"), ("-bldg", "bldg"),
                  ("-props", "city:prop"), ("-paint", "city:paint"), ("-rubble", "city:rubble"), ("-city", "all")]
        res = {}
        for rep in range(a.reps):
            for tag, key in groups[1:]:
                f = window(s, a.seconds, "full")
                s.js(HIDE, key)
                st = window(s, a.seconds, tag)
                s.js(HIDE, None)
                if st and f:
                    res.setdefault(tag, []).append(round(f["p50"] - st["p50"], 2))
        print("saving (adjacent full p50 - hidden p50, ms) per rep:", json.dumps(res))


if __name__ == "__main__":
    main()
