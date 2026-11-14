#!/usr/bin/env python
"""CityView CPU cost probe: patches CityView.prototype methods (same ES module instance via the dev
server) and records per-call ms while real keys drive a Size V titan in circles.

    python _harness/scratch/city-view/cpu_probe.py --base http://localhost:5194/ [--biome grideast] [--seconds 10]
"""
import argparse
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import (Session, add_common_args, build_url, ensure_play, set_rank)  # noqa: E402

PATCH = r"""
async () => {
  const mod = await import('/src/city/cityview.ts');
  const P = mod.CityView.prototype;
  const T = window.__CVT__ = {};
  for (const name of ['update', 'updateOccluders', 'updatePropOccluders', 'rebuildDirty', 'updateTraffic', 'animate', 'sweep', 'evalLive']) {
    const f = P[name]; if (typeof f !== 'function' || f.__wrapped) continue;
    T[name] = [];
    const w = function (...a) { const t0 = performance.now(); const r = f.apply(this, a); T[name].push(performance.now() - t0); return r; };
    w.__wrapped = true; P[name] = w;
  }
  return Object.keys(T);
}
"""
STATS = r"""
() => { const T = window.__CVT__; const out = {};
  for (const k in T) { const a = T[k].slice().sort((x, y) => x - y); if (!a.length) continue;
    const q = (p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
    out[k] = { n: a.length, p50: +q(0.5).toFixed(3), p99: +q(0.99).toFixed(3), max: +a[a.length - 1].toFixed(3), mean: +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(3) }; }
  return out; }
"""
CIRCLE = [{"KeyW"}, {"KeyW", "KeyD"}, {"KeyD"}, {"KeyD", "KeyS"}, {"KeyS"}, {"KeyS", "KeyA"}, {"KeyA"}, {"KeyA", "KeyW"}]


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--biome", default="grideast")
    ap.add_argument("--rank", type=int, default=4)
    ap.add_argument("--seconds", type=float, default=10.0)
    a = ap.parse_args()
    a.no_serve = True
    with Session(a, "cpu_probe") as s:
        s.goto(build_url(a.base, autostart=1, dev=1, titan="molo", biome=a.biome, seed=5, noslate=1))
        s.wait_bt(90)
        s.wait_screen(("slate", "play", "draft"), 90)
        ensure_play(s, 15)
        s.cheat("god", True)
        print("patched", s.js(PATCH))
        set_rank(s, a.rank)
        time.sleep(3.0)
        ensure_play(s, 10)
        s.js("() => { for (const k in window.__CVT__) window.__CVT__[k].length = 0; }")
        t0 = time.time()
        i = 0
        while time.time() - t0 < a.seconds:
            s.safe_js("() => { const U = window.__H_W__().upgrades; U.pendingDrafts = 0; U.chestDrafts = 0; }")
            if s.screen() != "play":
                s.release_all()
                ensure_play(s, 5)
            s.hold(CIRCLE[i % len(CIRCLE)])
            i += 1
            time.sleep(0.5)
        s.release_all()
        st = s.js(STATS)
        for k, v in sorted(st.items(), key=lambda kv: -kv[1]["mean"]):
            print("%-22s %s" % (k, json.dumps(v)))
        print("state", {k: (s.state() or {}).get(k) for k in ("rank", "draws", "tris", "fps", "renderScale")})


if __name__ == "__main__":
    main()
