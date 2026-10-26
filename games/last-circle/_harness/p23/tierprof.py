#!/usr/bin/env python
"""tierprof - the per-tier frame-time profile (C-GFX LOW / MEDIUM / HIGH / ULTRA; owner: "ensure you can get it to its best"; plan section 5
Performance: "UHD iGPU, default first run, quiet box: ground raw p50 <= 20 ms on all maps"; QUALITY BAR: KB/frame <= 85, queryColliders <= 150
per frame, 0 new shader programs after the first frame of a tier). The iGPU profile: --gpu default (Chrome's own adapter choice = the UHD iGPU
on this box, vsync on: what a player's first run gets; common.GPU_PROFILES).

    python _harness/p23/tierprof.py --disk --gpu default
    python _harness/p23/tierprof.py --rev 9aa2b746 --gpu default   # control: the P2 base has no ULTRA - MUST FAIL (ultra rows)
    python _harness/p23/tierprof.py --disk --plant alloc-leak       # 200 KB of garbage per frame - MUST FAIL (KB/frame rows)
    python _harness/p23/tierprof.py --disk --plant query-flood      # 400 extra queryColliders per frame - MUST FAIL (queryColliders rows)

One Chrome at 1280x720 (fresh profile), STANDARD solo on each map in --maps (default Savanna), landed under the guard, then for EACH tier (set
through W.setGfx('tier', t), as the Video tab does):
  tier [t]        W.gfxTier = t
  kb [t]          JS heap ALLOCATED per stepped, rendered ground frame (CDP HeapProfiler sampling as framecheck; 240 frames after a 120-frame warm) <= 85 KB
  qc [t]          W.map.queryColliders calls per frame, max over the 240 frames <= 150
  programs [t]    no shader program linked in the 240 measured frames (the tier's own programs link in its warm frames)
  gpu [t] (info)  GPU ms per rendered frame (the kernel's timer query), median
  raw [t] (info)  real rAF frame time p50 / p90 over 4 s with the loop running
  order           GPU cost never falls going LOW -> MEDIUM -> HIGH -> ULTRA (10 % noise allowance)
  auto-ground     the tier the first run auto-picked: ground raw p50 <= 20 ms - COUNTED only on a quiet box (no other automated Chrome), else
                  INFORMATION (the iGPU is shared: every ms is an upper bound then)
  errors
"""
from __future__ import annotations

import argparse
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "alloc-leak": "window.__P23LEAK__ = []; W.kernel._updaters.push(() => { window.__P23LEAK__.push(new Array(25600).fill(1.5)); if (window.__P23LEAK__.length > 40) window.__P23LEAK__.shift(); })",
    "query-flood": "W.kernel._updaters.push(() => { const p = W.player; for (let i = 0; i < 400; i++) W.map.queryColliders(p.pos.x, p.pos.z, 4, []); })",
}
TIERS = ("low", "medium", "high", "ultra")
KB_MAX, QC_MAX, RAW_P50_MAX = 85.0, 150, 20.0

MEASURE_JS = r"""([n]) => { const W = window.__LC__.W, P = window.__H_PUMP__, k = W.kernel; const M = W.map; const q0 = M.queryColliders; let qc = 0;
  M.queryColliders = function () { qc++; return q0.apply(this, arguments); };
  const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : null); let alloc = 0, last = mem(), qmax = 0; const p0 = k.renderer.info.programs.length;
  try { for (let i = 0; i < n; i++) { qc = 0; P.step(1, 1 / 60, true); const m = mem(); if (m != null && last != null && m > last) alloc += m - last; last = m; if (qc > qmax) qmax = qc; } }
  finally { M.queryColliders = q0; }
  return { kbPerFrame: performance.memory ? +(alloc / 1024 / n).toFixed(2) : null, qcMax: qmax, programsBefore: p0, programsAfter: k.renderer.info.programs.length }; }"""
RAW_JS = r"""([ms]) => new Promise((res) => { const d = []; let t0 = null, last = null; const f = (t) => { if (t0 == null) t0 = t; if (last != null) d.push(t - last); last = t;
  if (t - t0 < ms) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ n: d.length, p50: d.length ? +d[d.length >> 1].toFixed(2) : null, p90: d.length ? +d[Math.floor(d.length * 0.9)].toFixed(2) : null }); } };
  requestAnimationFrame(f); })"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--maps", default="ashgrid")
    args = L.parse(ap)

    def body(v):
        quiet = v.data.get("otherAutomatedChromes") == 0
        with C.Session(args, "p23_tierprof", viewport={"width": 1280, "height": 720}) as s:
            s.boot()
            s.sleep(8.0)                       # the first-run auto-tier decides on the menu
            auto = s.safe_js("() => window.__LC__.W.gfxTier || window.__LC__.W.settings.graphics", default=None)
            v.data["autoTier"] = auto
            L.dismiss_cards(s)
            for mp in args.maps.split(","):
                L.start(s, "standard", 7, mp, team="solo", guard=True)
                s.land(140, protect=True)
                s.freeze_loop()
                s.install_pump()
                if args.plant:
                    L.plant_js(s, PLANTS[args.plant])
                prof = {}
                for t in TIERS:
                    try:
                        s.js("(t) => window.__LC__.W.setGfx('tier', t)", t)
                    except Exception as e:
                        prof[t] = {"error": str(e).splitlines()[0][:160]}
                        v.check("tier [%s %s] (W.gfxTier = %s)" % (mp, t, t), False, prof[t], t)
                        continue
                    s.step_frames(120, 1 / 60, render=True)
                    got = s.js("() => window.__LC__.W.gfxTier || window.__LC__.W.settings.graphics")
                    # KB/frame the way framecheck measures it (the bar's own source): CDP HeapProfiler sampling (4 KB interval, objects a
                    # minor / major GC already collected included) over the measured frames - the usedJSHeapSize positive-step sum read
                    # 167-231 on frames framecheck's sampler puts under its bar (tierprof_all 10-26); kept as INFO
                    cdp = s.cdp()
                    cdp.send("HeapProfiler.enable")
                    cdp.send("HeapProfiler.startSampling", {"samplingInterval": 4096, "includeObjectsCollectedByMajorGC": True,
                                                           "includeObjectsCollectedByMinorGC": True})
                    m = s.js(MEASURE_JS, [240])
                    hp = cdp.send("HeapProfiler.stopSampling")["profile"]
                    tot, files = [0], {}

                    def walk(n):
                        sz = n.get("selfSize", 0)
                        if sz:
                            tot[0] += sz
                            f = n["callFrame"].get("url", "").split("/")[-1].split("?")[0] or "(native)"
                            files[f] = files.get(f, 0) + sz
                        for ch in n.get("children", []):
                            walk(ch)
                    walk(hp["head"])
                    m["heapStepKb"] = m.get("kbPerFrame")
                    m["kbPerFrame"] = round(tot[0] / 1024 / 240, 2)
                    m["topFiles"] = [[k, round(x / 1024 / 240, 1)] for k, x in sorted(files.items(), key=lambda kv: -kv[1])[:6]]
                    g = L.gpu_ms(s, 90)
                    s.thaw_loop()
                    raw = s.js(RAW_JS, [4000])
                    s.freeze_loop()
                    prof[t] = dict(m, tier=got, gpu=L.med(g) if g else None, raw=raw)
                    v.check("tier [%s %s] (W.gfxTier = %s)" % (mp, t, t), got == t, {"gfxTier": got}, t)
                    v.check("kb [%s %s] (JS heap allocated per ground frame <= %.0f KB)" % (mp, t, KB_MAX), m["kbPerFrame"] is not None and m["kbPerFrame"] <= KB_MAX,
                            {"kbPerFrame": m["kbPerFrame"], "topFilesKbPerFrame": m["topFiles"], "heapStepKbInfo": m["heapStepKb"]}, "<= %.0f (HeapProfiler sampling, as framecheck)" % KB_MAX)
                    v.check("qc [%s %s] (queryColliders per frame, max <= %d)" % (mp, t, QC_MAX), m["qcMax"] <= QC_MAX, {"qcMax": m["qcMax"]}, "<= %d" % QC_MAX)
                    v.check("programs [%s %s] (no shader linked in 240 measured frames)" % (mp, t), m["programsAfter"] == m["programsBefore"],
                            {"before": m["programsBefore"], "after": m["programsAfter"]}, "unchanged")
                    v.info("gpu / raw [%s %s]" % (mp, t), {"gpuMsMedian": prof[t]["gpu"], "raw": raw})
                v.data.setdefault("profile", {})[mp] = prof
                gs = [prof.get(t, {}).get("gpu") for t in TIERS]
                if all(x is not None for x in gs):
                    v.check("order [%s] (GPU ms never falls LOW -> MEDIUM -> HIGH -> ULTRA, 10 %% allowance)" % mp,
                            all(b >= a * 0.9 for a, b in zip(gs, gs[1:])), dict(zip(TIERS, gs)), "non-decreasing")
                else:
                    v.cnj("order [%s]" % mp, "no GPU timer (EXT_disjoint_timer_query) on this Chrome: %s" % dict(zip(TIERS, gs)))
                a = prof.get(auto) if auto in prof else None
                if a and a.get("raw") and a["raw"].get("p50") is not None:
                    ok = a["raw"]["p50"] <= RAW_P50_MAX
                    if quiet:
                        v.check("auto-ground [%s] (the auto tier %s: ground raw p50 <= %.0f ms, quiet box)" % (mp, auto, RAW_P50_MAX), ok, a["raw"], "<= %.0f ms" % RAW_P50_MAX)
                    else:
                        v.info("auto-ground [%s] (the auto tier %s: ground raw p50 <= %.0f ms) would %s - the box is SHARED (%s other automated Chromes): upper bound"
                               % (mp, auto, RAW_P50_MAX, "PASS" if ok else "FAIL", v.data.get("otherAutomatedChromes")), a["raw"])
                s.thaw_loop()
            L.errors_row(v, s)
    return C.run_gate("p23_tierprof", body, args)


if __name__ == "__main__":
    sys.exit(main())
