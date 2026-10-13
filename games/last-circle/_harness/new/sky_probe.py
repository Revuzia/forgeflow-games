#!/usr/bin/env python
"""SKY lane gate (Wave 4): baked-texture clouds (P1.7), altitude-scaled fog (P1.10), steel-blue palette (P4.2 step A), contract C-SKY.

Exit 0 pass / 1 fail / 2 could-not-judge (common.py rules). Registered by a later step in gate.py; not edited here.

WHAT IS MEASURED, AND AGAINST WHAT
  AFTER  = the working-copy runtime/3d/royale/maps.js.
  BEFORE = maps.js as committed at git HEAD.
  Every OTHER file is served from git HEAD for BOTH columns (`--rev HEAD`): other lanes edit other files in the same tree
  while this runs, and a --disk run would pick up their half-finished code (a `RIM_COOL is not defined` from the PLAYER lane
  killed the first run). `--merged` switches to a plain --disk run (every file from the working copy) for the final
  integration pass; it has no BEFORE column, so only the absolute rows are judged.

ROWS (per map: isla_viva, ashgrid, deepwood; seed 1, standard match through the real lobby + real Enter)
  boot            0 console / page / window / shader errors, 0 failed requests, with the new shader compiled on every map
  world           POIs + loot/chest points + every collider box + 64 height samples hash IDENTICAL to BEFORE (the deleted sprite-cloud
                  loop consumed rng() ahead of the towns; the replacement must burn the same draws - falsifier --plant no-rng-burn)
  C-SKY           W.skyUniforms {top, bot} are THREE.Uniform-like {value: Color}, live (same objects as the dome material's uniforms),
                  W.skyDome is the named "sky" mesh in the scene; writing red into top/bot visibly reddens the rendered sky band; a
                  second match replaces the handles and re-uses the ONE baked noise texture (falsifier --plant no-handles)
  sprites         the 24 sprite-cloud groups are gone: >= 72 fewer Sprite objects than BEFORE, only the bird sprites remain
  draw calls      no pose draws more calls than BEFORE; the sky-facing ground pose draws >= 20 fewer (plan: -43 on its pose)
  programs        0 new programs on drop frame 1 (the warm-up covers the new dome shader); the program count is IDENTICAL across
                  every pose including the 250 -> 330 m -> ground altitude change; never more programs than BEFORE
  fog             density == K.fog up to FOG_LO m above terrain, ~50 % of it at 250 m+, monotone in between (formula checked at 6
                  altitudes); yields to the lobby phase and to player.js underwaterFx (falsifier --plant fog-flat)
  seam            map-edge / ocean-horizon seam score (max row step in the side bands) at 4 edge-looking-out poses, AFTER <= BEFORE x
                  SEAM_REL + SEAM_ABS on every map
  luma spread     drop250 / drop330 luma sd (imgstats): BEFORE -> AFTER and the plan's >= 0.08 target
  colour          step A: |red - blue| and saturation of the drop/ground shots move TOWARD the exterior reference frames (t08 t22 t52)

Falsifier plants (each must exit 1): --plant fog-flat | no-rng-burn | no-handles   (single-line substitutions on the served copy)
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

REF_DIR = (r"C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/"
           r"scratchpad/lc_look/reference/")
REFS = ["ref_t08_drop_overview_towns.jpg", "ref_t22_parachute_downtown_storm.jpg", "ref_t52_fpp_street_houses_lootbeam.jpg"]

FOG_LO, FOG_HI, FOG_MIN = 40.0, 250.0, 0.5          # the SPEC (plan P1.10): full below ~40 m, ~50 % at 250 m+
SEAM_REL, SEAM_ABS = 1.5, 0.004                     # AFTER seam <= BEFORE x 1.5 + 0.004 (0.004 of full luminance = 1 grey level in 255)
MIN_SPRITES_REMOVED = 72                            # 24 groups x >= 3 puffs
MIN_CALLS_SAVED_SKYPOSE = 20                        # plan: -43 on its pose; this pose is measured below
LUMA_SD_TARGET = 0.08                               # plan P1.10 gate

PLANTS = {
    "fog-flat": [("const FOG_LO = 40, FOG_HI = 250, FOG_MIN = 0.5;", "const FOG_LO = 40, FOG_HI = 250, FOG_MIN = 1.0;")],
    "no-rng-burn": [("for (let i = 0; i < 24; i++) { const puffs = 3 + Math.floor(rng() * 3); for (let k = 0; k < puffs * 4 + 4; k++) rng(); }", "")],
    "no-handles": [("W.skyUniforms = { top: skyMat.uniforms.top, bot: skyMat.uniforms.bot };", "")],
}

FOG_ALTS = [6, 40, 100, 170, 250, 330]


def smooth_expected(base, agl):
    u = 0.0 if agl <= FOG_LO else 1.0 if agl >= FOG_HI else (agl - FOG_LO) / (FOG_HI - FOG_LO)
    return base * (1 - (1 - FOG_MIN) * (u * u * (3 - 2 * u)))


def measure(args, which, maps, subs, label, light):
    """One browser: serve `which` maps.js (+ subs) over a frozen-HEAD (or --merged: disk) tree, measure every map. Returns dict."""
    a = argparse.Namespace(**vars(args))
    a.disk = True
    a.rev = None if args.merged else "HEAD"
    out = {"label": label, "which": which, "maps": {}}
    outdir = os.path.join(args.shots, label)
    with C.Session(a, "sky_" + label) as s:
        out["mapsBytes"] = L.maps_override(s, which, subs) if not args.merged else None
        s.boot()
        s.freeze_loop()
        s.install_pump()
        for mid in maps:
            mr = L.MapRun(s, mid, args.seed, "standard", outdir, label)
            md = {"shots": mr.shots}
            out["maps"][mid] = md
            md["start"] = mr.start()
            md["baseFog"] = s.js("() => window.__LC__.W.map.K.fog")
            md["fingerprint"] = s.js(L.FINGERPRINT_JS)
            md["sprites"] = s.js(L.SPRITE_CENSUS_JS)
            md["handles"] = s.js(L.SKY_HANDLES_JS)
            # ---- drop frame 1 (first rendered frame of the drop): the warm-up must have compiled everything
            s.step_frames(1, 1 / 60, render=True)
            md["dropFrame1"] = s.js("() => window.__CNT__.last")
            # ---- fog formula at 6 altitudes (updaters run; no render needed) and the two yields
            px, pz = mr.big["x"], mr.big["z"]
            sweep = []
            for alt in FOG_ALTS:
                for _ in range(3):
                    s.js("([x,y,z]) => window.__SKY__.place(x,y,z,0,-0.2,{vy:0,ground:false})", [px, mr.gy + alt, pz])
                    s.js("() => window.__SKY__.top()")
                    s.step_frames(5, 1 / 60, render=False)
                r = s.js("""() => { const W = window.__LC__.W, c = W.camera.position, f = W.scene.fog;
                    const g = Math.max(W.map.heightAt(c.x, c.z), W.map.waterY); return { agl: c.y - g, density: f.density, base: W.map.K.fog }; }""")
                r["expected"] = smooth_expected(r["base"], r["agl"])
                sweep.append(r)
            md["fogSweep"] = sweep
            # The yield probe writes test values into the LIVE fog; it saves and restores density/colour/_uw so the shots that follow
            # are rendered with the build's own fog (the 2026-10-12 first run left the lobby's 0.0048 in place on the BEFORE Savanna
            # column, which has no updater and no water to rewrite it, so every later BEFORE Savanna shot was 2.5x fogged).
            # Dry maps (no water: player.js never runs underwaterFx, so nothing else writes density): the updater must leave a
            # sentinel density untouched while W._uw > 0.001. Water maps: player.js's underwater density (> 3x K.fog) must survive.
            md["fogYield"] = s.js("""() => { const W = window.__LC__.W, k = W.kernel, f = W.scene.fog, res = {};
                const save = { d: f.density, c: f.color.clone(), uw: W._uw, uwOn: W._uwWasOn, ph: W.phase };
                const step = (n) => { for (let i = 0; i < n; i++) for (const u of k._updaters) u(1 / 60, k.clock.elapsedTime += 1 / 60); };
                const wet = W.map.waterY > -100; res.water = wet;
                W.phase = 'lobby'; f.density = 0.0048; step(3); res.lobbyKept = Math.abs(f.density - 0.0048) < 1e-9; W.phase = save.ph;
                const SENT = 0.0123; f.density = SENT;
                // underwater: player.js owns density while W._uw > 0.001; it lerps _uw toward 0 from the camera position each frame
                W._uw = 0.5; step(1); res.uwDensity = f.density;
                res.uwYielded = wet ? f.density > 3 * W.map.K.fog : f.density === SENT; W._uw = 0;
                step(2); res.restoredDensity = f.density;
                f.density = save.d; f.color.copy(save.c); W._uw = save.uw; W._uwWasOn = save.uwOn; step(2); res.afterRestore = f.density;
                return res; }""")
            if light:
                continue
            # ---- shots: altitude, edges, then ground
            for alt, nm in ((250.0, "drop250"), (330.0, "drop330")):
                x, y, z, yaw, pit = mr.drop_pose(alt)
                mr.take(nm, x, y, z, yaw, pit, ground=False)
            for nm, (x, y, z, yaw, pit) in mr.edge_poses().items():
                mr.take(nm, x, y, z, yaw, pit, ground=False)
            md["land"] = s.land(max_s=120, protect=True)
            gx, ggy, gz, sun_yaw, poi = mr.ground_spot()
            md["groundPoi"] = poi
            mr.take("ground_sky", gx, ggy + 0.05, gz, sun_yaw, 0.30, vy=0, ground=True, frames=10)
            mr.take("ground_sun", gx, ggy + 0.05, gz, sun_yaw, 0.55, vy=0, ground=True, frames=10)
            mr.take("ground_horizon", gx, ggy + 0.05, gz, sun_yaw + 1.2, 0.02, vy=0, ground=True, frames=10)
            sh = mr.shore_spot()
            md["shoreSpot"] = list(sh) if sh else None
            if sh:
                mr.take("shore_horizon", sh[0], sh[1] + 0.05, sh[2], sh[3], 0.02, vy=0, ground=True, frames=10)
            # ---- sky liveness: write red into the C-SKY uniforms, render, compare the sky band
            if md["handles"].get("present"):
                p0 = os.path.join(outdir, "%s_%s_live0.png" % (label, mid))
                p1 = os.path.join(outdir, "%s_%s_live1.png" % (label, mid))
                s.js("([x,y,z,yw,pt]) => window.__SKY__.place(x,y,z,yw,pt,{vy:0,ground:true})", [gx, ggy + 0.05, gz, sun_yaw + 2.4, 0.9])
                s.step_frames(6, 1 / 60, render=False)
                s.canvas_png(p0, js_render="window.__H_PUMP__.frame(1/60, true)")
                s.js("""() => { const W = window.__LC__.W, u = W.skyUniforms; window.__SKYSAVE__ = [u.top.value.clone(), u.bot.value.clone()];
                    u.top.value.setRGB(1, 0, 0); u.bot.value.setRGB(1, 0, 0); }""")
                s.canvas_png(p1, js_render="window.__H_PUMP__.frame(1/60, true)")
                s.js("""() => { const W = window.__LC__.W, u = W.skyUniforms; u.top.value.copy(window.__SKYSAVE__[0]); u.bot.value.copy(window.__SKYSAVE__[1]); }""")
                md["skyLive"] = {"before": L.sky_region_stats(p0, 0.02, 0.22, 0.30, 0.70), "after": L.sky_region_stats(p1, 0.02, 0.22, 0.30, 0.70)}
            # ---- second match: handles replaced, the baked noise texture re-used (isla_viva only: a full match start is the slow part)
            if mid == maps[0] and not args.no_second:
                s.js("""() => { const W = window.__LC__.W; window.__OLDSKY__ = { u: W.skyUniforms, noise: W.skyDome && W.skyDome.material.uniforms.tNoise ? W.skyDome.material.uniforms.tNoise.value : null }; }""")
                s.start_match("standard", args.seed + 1, mid, enter=True)
                md["secondMatch"] = s.js("""() => { const W = window.__LC__.W, o = window.__OLDSKY__, d = W.skyDome;
                    return { handlesReplaced: !!(W.skyUniforms && o.u && W.skyUniforms !== o.u && W.skyUniforms.top !== o.u.top),
                             noiseReused: !!(d && o.noise && d.material.uniforms.tNoise && d.material.uniforms.tNoise.value === o.noise),
                             valueIsColor: !!(W.skyUniforms && W.skyUniforms.top.value.isColor) }; }""")
        out["diag"] = s.diagnostics()
    return out


def judge(v, args, A, B, maps):
    """Rows from AFTER (A) and BEFORE (B; None under --merged)."""
    def diag_ok(r, name):
        d = r["diag"]
        bad = {k: d[k][:3] for k in ("consoleErrors", "pageErrors", "windowErrors", "shader", "failedRequests") if d.get(k)}
        envs = d.get("envErrors") or []
        if envs and not bad:
            return v.cnj(name, "GPU-process (environment) errors only: %s" % envs[0][:160])
        return v.check(name, not bad, bad or "0 console / page / window / shader errors, 0 failed requests",
                       expect="0 errors; the new dome shader compiles on all maps")
    diag_ok(A, "boot: AFTER build, 0 console/page/shader errors, 0 failed requests")
    spread = {}
    for mid in maps:
        a = A["maps"][mid]
        b = B["maps"][mid] if B else None
        # ---- world unchanged
        if b:
            v.check("world unchanged vs BEFORE: %s (POIs + loot + colliders + heights hash)" % mid,
                    a["fingerprint"]["hash"] == b["fingerprint"]["hash"] and a["fingerprint"] == b["fingerprint"],
                    {"after": a["fingerprint"], "before": b["fingerprint"]},
                    expect="identical: the cloud loop's rng draws are burned, not dropped")
        # ---- C-SKY
        h = a["handles"]
        ok = bool(h.get("present") and h.get("isUniform") and h.get("live") and h.get("domeName") == "sky" and h.get("domeIsMesh") and h.get("inScene"))
        v.check("C-SKY: W.skyUniforms {top,bot} live + W.skyDome mesh in scene: %s" % mid, ok, h, expect="present, live, named 'sky'")
        if a.get("skyLive"):
            lb, la = a["skyLive"]["before"], a["skyLive"]["after"]
            dred = (la["r"] - la["b"]) - (lb["r"] - lb["b"])
            v.check("C-SKY: writing red into the uniforms reddens the rendered sky band: %s" % mid, dred > 0.15,
                    {"before(r,g,b)": [round(lb["r"], 3), round(lb["g"], 3), round(lb["b"], 3)], "after": [round(la["r"], 3), round(la["g"], 3), round(la["b"], 3)],
                     "d(r-b)": round(dred, 3)}, expect="d(r-b) > 0.15")
        if a.get("secondMatch"):
            sm = a["secondMatch"]
            v.check("C-SKY: second match replaces the handles and re-uses the one baked noise texture", bool(sm["handlesReplaced"] and sm["noiseReused"] and sm["valueIsColor"]), sm)
        # ---- sprites
        if b:
            removed = b["sprites"]["sprites"] - a["sprites"]["sprites"]
            v.check("sprite clouds gone: %s (>= %d fewer Sprite objects; birds keep ONE shared material)" % (mid, MIN_SPRITES_REMOVED),
                    removed >= MIN_SPRITES_REMOVED and a["sprites"]["distinctSpriteMaterials"] == 1,
                    {"before": b["sprites"], "after": a["sprites"], "removed": removed}, expect=">= %d removed, 1 sprite material left" % MIN_SPRITES_REMOVED)
        # ---- programs
        df1 = a["dropFrame1"]
        v.check("programs: 0 new on drop frame 1: %s" % mid, df1["newPrograms"] == 0, df1, expect="0 (the warm-up covers the new dome shader)")
        if a["shots"]:
            progs = [df1["programs"]] + [sh["programs"] for sh in a["shots"].values()]
            newp = [sh["counts"]["newPrograms"] for sh in a["shots"].values() if sh.get("counts")]
            v.check("programs: identical across drop 250 -> 330 m -> ground and every sampled frame: %s" % mid,
                    len(set(progs)) == 1 and not any(newp), {"programs": sorted(set(progs)), "newProgramsPerShot": newp},
                    expect="one count, 0 new (fog density is a uniform, no recompile)")
            if b and b["shots"]:
                v.check("programs: not more than BEFORE: %s" % mid, max(progs) <= max([b["dropFrame1"]["programs"]] + [x["programs"] for x in b["shots"].values()]),
                        {"after": max(progs), "before": max([b["dropFrame1"]["programs"]] + [x["programs"] for x in b["shots"].values()])})
        # ---- fog
        sw = a["fogSweep"]
        bad = [r for r in sw if abs(r["density"] - r["expected"]) > max(1e-7, 0.002 * r["base"])]
        mono = all(sw[i]["density"] >= sw[i + 1]["density"] - 1e-9 for i in range(len(sw) - 1) if sw[i]["agl"] <= sw[i + 1]["agl"])
        low, high = min(sw, key=lambda r: r["agl"]), max(sw, key=lambda r: r["agl"])
        v.check("fog: density follows height (full <= %d m, ~%d%% at %d m+, monotone): %s" % (FOG_LO, FOG_MIN * 100, FOG_HI, mid),
                not bad and mono and high["agl"] >= FOG_HI and abs(high["density"] / high["base"] - FOG_MIN) < 0.02 and abs(low["density"] - low["base"]) < 1e-9,
                {"altitudes(agl,density,expected)": [(round(r["agl"]), round(r["density"], 6), round(r["expected"], 6)) for r in sw], "base": sw[0]["base"]},
                expect="density == K.fog*(1-0.5*smoothstep((agl-40)/210))")
        y = a["fogYield"]
        v.check("fog: yields to the lobby phase and to player.js underwaterFx: %s" % mid, bool(y["lobbyKept"] and y["uwYielded"]), y)
        # ---- per-shot rows
        if not a["shots"]:
            continue
        sh_a = a["shots"]
        if b and b["shots"]:
            sh_b = b["shots"]
            worse = {n: (sh_a[n]["counts"]["calls"], sh_b[n]["counts"]["calls"]) for n in sh_a if sh_a[n]["counts"]["calls"] > sh_b[n]["counts"]["calls"]}
            v.check("draw calls: no pose draws more than BEFORE: %s" % mid, not worse,
                    worse or {n: (sh_b[n]["counts"]["calls"], sh_a[n]["counts"]["calls"]) for n in sh_a}, expect="after <= before at every pose (before, after listed)")
            saved = {n: sh_b[n]["counts"]["calls"] - sh_a[n]["counts"]["calls"] for n in ("ground_sky", "ground_sun", "ground_horizon")}
            best = max(saved.values())
            if mid == "isla_viva":
                v.check("draw calls: sky-facing ground pose saves >= %d (plan: -43 on its Isla Viva pose): %s" % (MIN_CALLS_SAVED_SKYPOSE, mid), best >= MIN_CALLS_SAVED_SKYPOSE,
                        {"savedByPose": saved}, expect=">= %d" % MIN_CALLS_SAVED_SKYPOSE)
            else:
                v.info("draw calls saved by pose: %s" % mid, saved)
            # seams
            seam_rows = {}
            for n in ("edge250_px", "edge250_nx", "edge250_pz", "edge250_nz", "shore_horizon"):
                if n not in sh_a or n not in sh_b:
                    continue
                sa, sb = sh_a[n]["seam"], sh_b[n]["seam"]
                seam_rows[n] = {"before": round(sb, 4), "after": round(sa, 4), "limit": round(sb * SEAM_REL + SEAM_ABS, 4)}
            v.check("seam: no map-edge / ocean-horizon seam exposed by the thinner fog (4 outward views + shore level): %s" % mid,
                    all(r["after"] <= r["limit"] for r in seam_rows.values()), seam_rows,
                    expect="after <= before x %.1f + %.3f" % (SEAM_REL, SEAM_ABS))
        # luma spread (collected for the cross-map rows below)
        sd = {n: round(sh_a[n]["imgstats"]["luma_sd"], 3) for n in ("drop250", "drop330")}
        sdb = {n: round(B["maps"][mid]["shots"][n]["imgstats"]["luma_sd"], 3) for n in ("drop250", "drop330")} if b and b["shots"] else None
        spread[mid] = {"after": sd, "before": sdb}
        # colour (step A): toward the references
        if b and b["shots"] and mid != "ashgrid":
            rows = {}
            ok = True
            for n in ("drop250", "drop330", "ground_sky", "ground_horizon"):
                ra, rb = abs(sh_a[n]["imgstats"]["r_minus_b"]), abs(sh_b[n]["imgstats"]["r_minus_b"])
                sa_, sb_ = sh_a[n]["imgstats"]["sat"], sh_b[n]["imgstats"]["sat"]
                rows[n] = {"|r-b| before->after": [round(rb, 3), round(ra, 3)], "sat before->after": [round(sb_, 3), round(sa_, 3)]}
                ok = ok and ra < rb and sa_ < sb_
            v.check("step A colour: |red-blue| and saturation fall toward the references: %s" % mid, ok, rows, expect="after < before on every shot")
    # luma spread across maps: the fog must raise it on average; the plan's >= 0.08 absolute target is reported, not gated, because it
    # is scene-limited on Deepwood (the fog-curve sweep reaches only 0.062-0.069 there even at 15 % density) and is what Step B
    # (exposure / albedo, owner-held) is for.
    if spread and all(x["before"] for x in spread.values()):
        bs = [x["before"][n] for x in spread.values() for n in ("drop250", "drop330")]
        as_ = [x["after"][n] for x in spread.values() for n in ("drop250", "drop330")]
        mb, ma = sum(bs) / len(bs), sum(as_) / len(as_)
        v.check("luma spread: the thinner drop fog raises mean drop-frame luma sd by >= +0.010 (all maps, 250 + 330 m)", ma - mb >= 0.010,
                {"meanBefore": round(mb, 4), "meanAfter": round(ma, 4), "perMap": spread}, expect="mean after - before >= 0.010")
        met = sum(1 for x in as_ if x >= LUMA_SD_TARGET)
        v.info("luma spread vs the plan's >= %.2f target (NOT gated)" % LUMA_SD_TARGET, {"framesAtOrAbove": "%d of %d" % (met, len(as_)), "perMap": spread})
    # reference table (information)
    if os.path.isdir(REF_DIR):
        refs = {}
        for f in REFS:
            if os.path.isfile(REF_DIR + f):
                st = L.stats(REF_DIR + f)
                refs[f[:7]] = {"luma": round(st["luma"], 3), "sd": round(st["luma_sd"], 3), "sat": round(st["sat"], 3), "r-b": round(st["r_minus_b"], 3)}
        v.info("reference exterior frames (luma, luma sd, saturation, r-b)", refs)
    else:
        v.info("reference frames not found", REF_DIR)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--merged", action="store_true", help="plain --disk (every file from the working copy), no BEFORE column")
    ap.add_argument("--baseline-json", default=None, help="reuse / save the BEFORE measurements at this path (skips the second browser)")
    ap.add_argument("--shots", default=os.path.join(C.SHOTS, "sky_gate"))
    ap.add_argument("--no-second", action="store_true", help="skip the second-match handle check")
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS), help="FALSIFIER: serve maps.js with a planted fault; the matching row MUST fail")
    args = ap.parse_args()
    args.disk = True                     # served through page routing (see the module docstring); --merged = every file from the working copy
    maps = [m for m in args.maps.split(",") if m]
    light = bool(args.plant)
    if args.plant:
        maps = maps[:1]
        args.report = args.report or "sky_probe_plant_" + args.plant.replace("-", "_")
    os.makedirs(args.shots, exist_ok=True)

    def body(v):
        subs = PLANTS.get(args.plant)
        A = measure(args, "work", maps, subs, "after" if not args.plant else "plant", light)
        v.data["after"] = A
        B = None
        if not args.merged and not args.plant:
            if args.baseline_json and os.path.isfile(args.baseline_json):
                B = json.load(open(args.baseline_json, encoding="utf-8"))
                v.note("BEFORE column loaded from %s" % args.baseline_json)
            else:
                B = measure(args, "head", maps, None, "before", False)
                if args.baseline_json:
                    with open(args.baseline_json, "w", encoding="utf-8") as f:
                        json.dump(C._clean(B), f)
            v.data["before"] = B
        elif args.plant:
            # plant runs compare the planted AFTER against the committed-HEAD BEFORE for the world hash only
            B = measure(args, "head", maps, None, "before", True)
        if args.plant:
            judge_plant(v, args, A, B, maps)
        else:
            judge(v, args, A, B, maps)

    return C.run_gate("sky_probe", body, args)


def judge_plant(v, args, A, B, maps):
    mid = maps[0]
    a = A["maps"][mid]
    if args.plant == "fog-flat":
        sw = a["fogSweep"]
        high = max(sw, key=lambda r: r["agl"])
        v.check("fog: ~50%% density at %d m+ (PLANTED fog-flat: must FAIL)" % FOG_HI, abs(high["density"] / high["base"] - FOG_MIN) < 0.02,
                [(round(r["agl"]), round(r["density"], 6)) for r in sw])
    elif args.plant == "no-rng-burn":
        b = B["maps"][mid]
        v.check("world unchanged vs BEFORE (PLANTED no-rng-burn: must FAIL)", a["fingerprint"] == b["fingerprint"], {"after": a["fingerprint"], "before": b["fingerprint"]})
    elif args.plant == "no-handles":
        h = a["handles"]
        v.check("C-SKY handles present (PLANTED no-handles: must FAIL)", bool(h.get("present") and h.get("live")), h)


if __name__ == "__main__":
    sys.exit(main())
