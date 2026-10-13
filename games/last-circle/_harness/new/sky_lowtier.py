#!/usr/bin/env python
"""SKY lane (Wave 4): the `low` graphics tier's sky dome variant (one baked cloud layer, `#define CLOUD_LAYERS 1`).

The dome shader compiles a different program per tier (CLOUD_LAYERS 2 on medium/high, 1 on low, fixed for a whole match so a
mid-match tier change never recompiles). sky_probe.py runs on the default tier only, so this gate proves the low variant:

ROWS (isla_viva and deepwood, seed 1, standard match through the real lobby + real Enter; tier set before each match by the
game's own W.applyGraphics)
  low     the dome material carries CLOUD_LAYERS == 1; 0 new programs on drop frame 1; clouds visible in a sky-facing ground
          view (sky-band luma sd >= SD_MIN, the clouds-off re-render of the same pose is flatter by >= SD_GAIN)
  medium  (control, same page) CLOUD_LAYERS == 2 and the same visibility rows
  boot    0 console / page / window / shader errors, 0 failed requests over both tiers

Served like sky_probe.py: git HEAD for every file + the working-copy maps.js (`--merged` = every file from the working copy).
Exit 0 pass / 1 fail / 2 could-not-judge. Falsifier: --plant one-layer-broken serves maps.js with a GLSL error inside the
`#if CLOUD_LAYERS > 1` block, which only the medium variant compiles, so the medium rows / boot row must FAIL.
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sky_lib as L  # noqa: E402

C = L.C
SD_MIN = 0.02        # sky-band luma sd with clouds (a flat gradient band measures ~0.005-0.012)
SD_GAIN = 0.008      # clouds-on minus clouds-off sky-band luma sd

PLANTS = {
    "one-layer-broken": [("n = n * 0.72 + texture2D(tNoise, uB).g * 0.28;", "n = n * 0.72 + texture2D(tNoise, uB).g * 0.28 + undefinedSym;")],
}

DEFINES_JS = r"""() => { const d = window.__LC__.W.skyDome; return d && d.material && d.material.defines ? Object.assign({}, d.material.defines) : null; }"""


def measure(args, subs):
    a = argparse.Namespace(**vars(args))
    a.disk = True
    a.rev = None if args.merged else "HEAD"
    out = {"runs": []}
    with C.Session(a, "sky_lowtier") as s:
        if not args.merged or subs:
            L.maps_override(s, "work", subs)
        s.boot()
        s.freeze_loop()
        s.install_pump()
        for mid in [m for m in args.maps.split(",") if m]:
            for tier in ("low", "medium"):
                s.js(r"""(t) => { const W = window.__LC__.W; W.settings.graphics = t; W.applyGraphics(t); return W._gfx ? W._gfx.tier : null; }""", tier)
                mr = L.MapRun(s, mid, args.seed, "standard", os.path.join(args.shots, tier), "lt_" + tier)
                r = {"map": mid, "tier": tier}
                r["start"] = mr.start()
                r["gfxTier"] = s.js("() => { const W = window.__LC__.W; return { settings: W.settings.graphics, gfx: W._gfx ? W._gfx.tier : null }; }")
                r["defines"] = s.js(DEFINES_JS)
                s.step_frames(1, 1 / 60, render=True)
                r["dropFrame1"] = s.js("() => window.__CNT__.last")
                s.land(max_s=120, protect=True)
                gx, gy, gz, sun_yaw, _ = mr.ground_spot()
                st = mr.take("ground_sky", gx, gy + 0.05, gz, sun_yaw + 0.6, 0.45, vy=0, ground=True, frames=10)
                band = L.sky_region_stats(st["png"], 0.02, 0.40, 0.05, 0.40)
                pnc = st["png"].replace(".png", "_noclouds.png")
                s.js(L.NOCLOUDS_JS, True)
                s.canvas_png(pnc, js_render="window.__H_PUMP__.frame(1/60, true)")
                s.js(L.NOCLOUDS_JS, False)
                band_nc = L.sky_region_stats(pnc, 0.02, 0.40, 0.05, 0.40)
                r["skyBandSd"] = round(band["luma_sd"], 4)
                r["skyBandSdNoClouds"] = round(band_nc["luma_sd"], 4)
                r["png"] = st["png"]
                r["programs"] = st["programs"]
                out["runs"].append(r)
        out["diag"] = s.diagnostics()
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="isla_viva,deepwood")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--merged", action="store_true")
    ap.add_argument("--shots", default=os.path.join(C.SHOTS, "sky_lowtier"))
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS))
    args = ap.parse_args()
    args.disk = True
    if args.plant:
        args.report = args.report or "sky_lowtier_plant_" + args.plant.replace("-", "_")
    os.makedirs(args.shots, exist_ok=True)

    def body(v):
        R = measure(args, PLANTS.get(args.plant))
        v.data["result"] = R
        d = R["diag"]
        bad = {k: d[k][:3] for k in ("consoleErrors", "pageErrors", "windowErrors", "shader", "failedRequests") if d.get(k)}
        v.check("boot: 0 console / page / window / shader errors, 0 failed requests (low + medium dome variants)", not bad,
                bad or "clean", expect="0 errors")
        for r in R["runs"]:
            want = 1 if r["tier"] == "low" else 2
            tag = "%s %s" % (r["map"], r["tier"])
            v.check("defines: CLOUD_LAYERS == %d on %s" % (want, tag), bool(r["defines"]) and int(r["defines"].get("CLOUD_LAYERS", -1)) == want,
                    {"defines": r["defines"], "tier": r["gfxTier"]})
            v.check("programs: 0 new on drop frame 1: %s" % tag, r["dropFrame1"] and r["dropFrame1"]["newPrograms"] == 0, r["dropFrame1"])
            v.check("clouds visible (sky-band luma sd with clouds >= %.3f and >= clouds-off + %.3f): %s" % (SD_MIN, SD_GAIN, tag),
                    r["skyBandSd"] >= SD_MIN and r["skyBandSd"] - r["skyBandSdNoClouds"] >= SD_GAIN,
                    {"sd": r["skyBandSd"], "sdNoClouds": r["skyBandSdNoClouds"], "png": r["png"]})
    return C.run_gate("sky_lowtier", body, args)


if __name__ == "__main__":
    sys.exit(main())
