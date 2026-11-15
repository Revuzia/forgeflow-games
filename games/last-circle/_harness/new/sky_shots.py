#!/usr/bin/env python
"""SKY lane (Wave 4): sky / fog / palette screenshot sweep with exact per-shot numbers.

For every requested map (fixed seed, fixed shot poses) it saves HUD-free WebGL canvas PNGs (the canvas is read in the SAME
task as the render, so a starved compositor cannot blank it) and records, per shot: camera pose + altitude, FogExp2
density, program count, draw calls / triangles (gl.draw* stubbed, so counts are exact whatever the GPU does) and the
lighting-post imgstats numbers (luma, luma sd, mean HSV saturation, |red - blue|).

Shots per map (all through the real game: startMatch -> lobby -> real Enter -> land):
  ground_sky     on the ground, pitched up, sun side      (the dome + clouds + fog colour at eye level)
  ground_horizon on the ground, level                      (terrain / sky seam, fog fade)
  drop250        250 m above the biggest POI, pitched -0.2 (the classic drop overview; plan P1.10 gate view)
  drop330        330 m, same
  edge250_<dir>  250 m over the map edge looking OUT, 4 directions (map-edge / ocean-horizon seam check)

  --src head|work   which maps.js to serve (every OTHER file always comes from git HEAD: other lanes are mid-edit in the
                    same tree, and a --disk run would pick up their half-finished files). head = the BEFORE column.
  --mode            standard (default) | quick | practice
  --tag             output file prefix
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sky_lib as L  # noqa: E402

C = L.C

def shot_png(s, path):
    """Render one pumped frame and read the canvas in the same task. draw* must be REAL for pixels, so the stub is installed
    only around counted frames (see count_frame)."""
    return s.canvas_png(path, js_render="window.__H_PUMP__.frame(1/60, true)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--src", default="work", choices=["head", "work"])
    ap.add_argument("--mode", default="standard")
    ap.add_argument("--tag", default="shots")
    ap.add_argument("--outdir", default=None)
    ap.add_argument("--only", default="", help="comma list of shot names to take (default all)")
    args = ap.parse_args()
    args.disk = True
    args.rev = "HEAD"                    # everything except maps.js is the frozen committed build
    outdir = args.outdir or os.path.join(C.SHOTS, "sky")
    os.makedirs(outdir, exist_ok=True)
    only = {x for x in args.only.split(",") if x}
    log = {"args": {k: v for k, v in vars(args).items() if k in ("maps", "seed", "src", "mode", "tag")}, "maps": {}}
    t_all = time.time()
    with C.Session(args, "skyshots") as s:
        log["mapsBytes"] = L.maps_override(s, args.src)
        s.boot()
        s.freeze_loop()
        s.install_pump()
        for mid in [m for m in args.maps.split(",") if m]:
            t0 = time.time()
            r = s.start_match(args.mode, args.seed, mid, enter=True)
            s.js(L.HELPERS_JS)
            s.guard_player(True)
            md = {"start": r, "shots": {}}
            log["maps"][mid] = md
            # counts need the stubbed draws; pixels need real ones: install the counter hooks WITHOUT stubbing here and
            # take counts in a separate stubbed pass (stub is one-way, so the count pass is the LAST thing per session)
            s.js(r"""() => { const W = window.__LC__.W, r = W.kernel.renderer, P = window.__H_PUMP__; r.info.autoReset = false;
              window.__CNT__ = { last: null };
              P.onBeforeRender = () => { r.info.reset(); window.__CNT__.p0 = r.info.programs.length; };
              P.onAfterRender = () => { window.__CNT__.last = { calls: r.info.render.calls, tris: r.info.render.triangles,
                programs: r.info.programs.length, newPrograms: r.info.programs.length - window.__CNT__.p0 }; }; return 'ok'; }""")
            pois = s.js("() => window.__SKY__.pois()")
            half = s.js("() => window.__LC__.W.map.half")
            big = max(pois, key=lambda p: p["r"])
            px, pz = big["x"], big["z"]
            gy = s.js("([x,z]) => window.__SKY__.ground(x,z)", [px, pz])
            md["poi"] = {"id": big["id"], "x": round(px, 1), "z": round(pz, 1), "gy": round(gy, 1), "half": half}

            def take(name, x, y, z, yaw, pitch, vy=-2, ground=None, frames=6):
                if only and name not in only:
                    return
                o = {"vy": vy}
                if ground is not None:
                    o["ground"] = ground
                for _ in range(2):
                    s.js("([x,y,z,yw,pt,o]) => window.__SKY__.place(x,y,z,yw,pt,o)", [x, y, z, yaw, pitch, o])
                    s.js("() => window.__SKY__.top()")
                    s.step_frames(frames, 1 / 60, render=False)
                s.js("([x,y,z,yw,pt,o]) => window.__SKY__.place(x,y,z,yw,pt,o)", [x, y, z, yaw, pitch, o])
                path = os.path.join(outdir, "%s_%s_%s.png" % (args.tag, mid, name))
                shot_png(s, path)
                st = s.js("() => window.__SKY__.status()")
                cnt = s.js("() => window.__CNT__.last")
                st["counts"] = cnt
                st["imgstats"] = L.stats(path)
                if name.startswith("ground_"):
                    st["skyBand"] = L.sky_region_stats(path)
                st["png"] = path
                md["shots"][name] = st
                print("  %s/%s: cam y %.0f fog %.6f calls %s programs %s luma_sd %.3f sat %.3f |r-b| %.3f" % (
                    mid, name, st["cam"][1], st["fogDensity"] or 0, (cnt or {}).get("calls"), st["programs"],
                    st["imgstats"]["luma_sd"], st["imgstats"]["sat"], st["imgstats"]["abs_r_minus_b"]), flush=True)

            # ---- altitude shots first (the player is still in the plane / glide) ------------------------------------
            for alt, nm in ((250.0, "drop250"), (330.0, "drop330")):
                back = alt / math.tan(0.82)
                ang = 0.7
                fx, fz = px + math.sin(ang) * back, pz + math.cos(ang) * back
                yaw = s.js("([a,b,c,d]) => window.__SKY__.yawTo(a,b,c,d)", [fx, fz, px, pz])
                take(nm, fx, gy + alt, fz, yaw, -0.2, ground=False)
            # edge shots: over the edge, looking outward (yaw: forward = (-sin yaw, -cos yaw))
            e = half * 0.9
            for nm, (x, z, yaw) in {"edge250_px": (e, 0, -math.pi / 2), "edge250_nx": (-e, 0, math.pi / 2),
                                    "edge250_pz": (0, e, math.pi), "edge250_nz": (0, -e, 0.0)}.items():
                take(nm, x, 250.0, z, yaw, -0.12, ground=False)
            # ---- land, then ground shots ----------------------------------------------------------------------------
            ls = s.land(max_s=120, protect=True)
            md["land"] = ls
            # a DRY spot: the biggest POI whose ground is >= 3 m above the waterline (the autoDrop zone can be a lagoon)
            dry = [q for q in pois if s.js("([x,z]) => window.__SKY__.ground(x,z)", [q["x"], q["z"]]) >= 3.0]
            dp = max(dry, key=lambda q: q["r"]) if dry else big
            gx, gz = dp["x"] + 24.0, dp["z"] + 24.0
            ggy = s.js("([x,z]) => window.__SKY__.ground(x,z)", [gx, gz])
            sun = s.js("() => window.__LC__.W.map.K.sun.pos")
            sun_yaw = math.atan2(-sun[0], -sun[2])        # forward = (-sin yaw, -cos yaw) points at the sun's azimuth
            md["groundSpot"] = {"poi": dp["id"], "x": round(gx, 1), "z": round(gz, 1), "y": round(ggy, 1), "sunYaw": round(sun_yaw, 3)}
            take("ground_sky", gx, ggy + 0.05, gz, sun_yaw, 0.30, vy=0, ground=True, frames=10)
            take("ground_horizon", gx, ggy + 0.05, gz, sun_yaw + 1.2, 0.02, vy=0, ground=True, frames=10)
            take("ground_sun", gx, ggy + 0.05, gz, sun_yaw, 0.55, vy=0, ground=True, frames=10)
            md["wall_s"] = round(time.time() - t0, 1)
            diag = s.diagnostics()
            md["diag"] = {k: v[:4] for k, v in diag.items() if isinstance(v, list) and v}
        log["diag_total"] = {k: v[:6] for k, v in s.diagnostics().items() if isinstance(v, list) and v}
    log["wall_s"] = round(time.time() - t_all, 1)
    jp = os.path.join(outdir, "%s_log.json" % args.tag)
    with open(jp, "w", encoding="utf-8") as f:
        json.dump(C._clean(log), f, indent=1)
    print("wrote", jp)
    errs = log["diag_total"]
    bad = {k: v for k, v in errs.items() if k in ("consoleErrors", "pageErrors", "windowErrors", "shader", "failedRequests")}
    print("diagnostics:", json.dumps(bad)[:800] if bad else "clean (0 console / page / window / shader errors, 0 failed requests)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
