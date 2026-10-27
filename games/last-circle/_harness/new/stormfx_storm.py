#!/usr/bin/env python
"""STORMFX gate: a storm you can see (plan P1.2, Wave 4).

Per-REGION A/B at storm phase 2 (the circle is 360 deg over water) and phase 6 (the circle crosses hills up to 59 m) on
isla_viva: the same frame is rendered twice through the composer (kernel loop stopped, wall + lightning toggled), so the only
difference is the storm effect. Judges:

  band        mean |RGB| delta (0..255 per channel) over the VISIBLE wall pixels 0-10 m above the ground reference >= 20
  streaks     per image row in the 10-60 m region, distinct peaks of the A/B luma delta (> 4/255 above a 31 px running
              median); the MEDIAN row count >= 8 at the near / far view, >= 5 side-on (and the frames are saved for a by-eye check)
  far scenery luma(on)/luma(off) over the 10-60 m region within 0.85-1.15 (the curtain must not dim or blow out what is behind it)
  contrast    wall alone over black and over white (float render target) -> alpha; max alpha <= 0.40 so a silhouette
              behind the wall keeps >= 60 % contrast
  glare       emission luminance (wall alone over black): streak p99.5 / curtain median <= 2.0 over 10-60 m, band (0-3 m) mean / curtain
              median <= 2.5; lightning peak (sky + bolt) / sky <= 8
  bloom       the same A/B with the bloom pass disabled: the light the bloom pass ADDS because the wall is drawn (a halo round streaks / the
              band) must stay p99 <= 1/255 and max <= 4/255 per view (measured 0.00 / <= 1.7: the veil only dims the sky's own bloom)
  tint        walking into the storm moves fog colour + density, background and BOTH sky dome uniforms and drives the output
              grade to 1; walking back restores every one of them EXACTLY (bit-equal floats) and the grade to 0
  contracts   W.stormU follows the circle; wall = ONE draw (one mesh), 192 triangles, premultiplied NORMAL blending,
              renderOrder 5; warmObjects(W) returns the wall and the bolt pool

  python _harness/new/stormfx_storm.py --disk [--quick]        exit 0 pass / 1 fail / 2 could-not-judge
"""
from __future__ import annotations

import argparse
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import stormfx_lib as L  # noqa: E402
import common  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

SCRATCH = "C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_improve/wave4/STORMFX"
REF = "C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_look/reference"
BAND_MIN_DELTA = 20.0
BLOOM_P99_MAX, BLOOM_MAX_MAX = 1.0, 4.0     # bloom light the wall itself causes (measured: p99 0.00, max <= 1.7 over 6 views; the veil only DIMS the sky bloom)
CAP = 0.40
EXCL = (470, 320, 690, 700)      # the third-person character's screen box at 1280x720 (identical in A and B, so it only dilutes)


def main(v, args):
    out_dir = args.shots
    os.makedirs(out_dir, exist_ok=True)
    M = {"regions": {}}
    with common.Session(args, name="stormfx") as s:
        s.boot()
        s.sleep(1.0)
        M["start"] = s.start_match(mode="standard", seed=args.seed, map_id=args.map)
        s.guard_player(True)
        M["land"] = s.land(protect=True)
        s.install_pump()
        L.install(s)
        s.freeze_loop()

        # ── contracts / static facts ──────────────────────────────────────────
        facts = s.js("""() => { const W = window.__LC__.W, ctl = W.stormCtl; const m = ctl.wall.material, g = ctl.wall.geometry;
          let wallMeshes = 0; W.group('storm').traverse((o) => { if (o.isMesh && o.material === m) wallMeshes++; });
          const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
          const warm = (window.__LC__.W.__stormWarm ? 1 : 0);
          return { type: m.type, blending: m.blending, premult: m.premultipliedAlpha, transparent: m.transparent, depthWrite: m.depthWrite, side: m.side,
                   renderOrder: ctl.wall.renderOrder, wallMeshes, tris, boltMeshes: ctl.bolts ? 1 : 0, boltOrder: ctl.bolts && ctl.bolts.renderOrder,
                   lutTex: ctl.tex && ctl.tex.image && ctl.tex.image.width, hasStormU: !!W.stormU, uCap: m.uniforms.uAlphaCap.value }; }""")
        M["facts"] = facts
        v.check("wall is ONE mesh / 192 triangles / ShaderMaterial / premultiplied NORMAL blending / renderOrder 5",
                facts["type"] == "ShaderMaterial" and facts["wallMeshes"] == 1 and facts["tris"] == 192 and facts["blending"] == 1
                and facts["premult"] is True and facts["transparent"] is True and facts["depthWrite"] is False and facts["renderOrder"] == 5
                and facts["lutTex"] == 360, facts)
        v.check("lightning pool is ONE instanced mesh drawn behind the wall (renderOrder < 5)", facts["boltMeshes"] == 1 and facts["boltOrder"] is not None and facts["boltOrder"] < 5, facts)

        wo = s.js("""() => { const W = window.__LC__.W; const st = performance.getEntriesByType('resource').map(r => r.name).find(n => /royale\\/storm\\.js/.test(n)); return st || null; }""")
        warm_ok = None
        if wo:
            warm_ok = s.js("""async (u) => { const m = await import(u); const W = window.__LC__.W; const a = m.warmObjects(W); return { n: a.length, kinds: a.map(o => o.type + ':' + (o.material && o.material.name)), inScene: a.every(o => { let p = o; while (p) { if (p === W.scene) return true; p = p.parent; } return false; }) }; }""", wo)
        M["warmObjects"] = warm_ok
        v.check("storm.warmObjects(W) returns the wall and the bolt pool, both in the scene graph",
                bool(warm_ok) and warm_ok["n"] == 2 and warm_ok["inScene"], warm_ok)

        regions = [("phase2", 2), ("phase6", 6)]
        results = {}
        for rname, ph in regions:
            win = s.js("(p) => window.__SF__.phaseWindow(p)", ph)
            if not win:
                v.cnj("%s window" % rname, "no phase %d in this mode" % ph)
                continue
            t = 0.5 * (win["shrinkStart"] + win["end"])
            c = s.js("(t) => window.__SF__.setT(t)", t)
            cx, cz, R = c["cx"], c["cz"], c["radius"]
            rg = s.js("([cx, cz, R]) => window.__SF__.ringGround(cx, cz, R, 360)", [cx, cz, R])
            under = sum(1 for h in rg if h <= 0.01)
            M["regions"][rname] = {"t": t, "radius": R, "center": [cx, cz], "ringGround": {"min": min(rg), "max": max(rg), "waterDeg": under}}
            dfar = min(150.0, 0.9 * R)
            dnear = min(30.0, 0.25 * R)

            def land(x, z):
                return s.js("([x, z]) => window.__LC__.W.map.heightAt(x, z) > window.__LC__.W.map.waterY + 0.5", [x, z])

            best = None
            for deg in range(0, 360, 6):
                a = math.radians(deg)
                pf = (cx + math.cos(a) * (R - dfar), cz + math.sin(a) * (R - dfar))
                pn = (cx + math.cos(a) * (R - dnear), cz + math.sin(a) * (R - dnear))
                okf, okn = land(*pf), land(*pn)
                if not okf:
                    continue
                score = (1 if okn else 0) * 1000 + sum(rg[int(((deg + k) % 360))] for k in range(-15, 16, 3))
                if best is None or score > best[0]:
                    best = (score, deg, okn)
            if best is None:
                v.cnj("%s viewpoint" % rname, "no land viewpoint %d m inside the circle" % dfar)
                continue
            ang = math.radians(best[1])
            M["regions"][rname].update({"angleDeg": best[1], "nearViewOnLand": best[2], "dFar": dfar, "dNear": dnear})

            def ring(dr, da=0.0):
                return cx + math.cos(ang + da) * (R + dr), cz + math.sin(ang + da) * (R + dr)

            views = [("far", -dfar, ring(dfar), 0.14), ("tangent", -10, ring(-10, 0.30), 0.10)]
            if best[2]:
                views.insert(0, ("near", -dnear, ring(dnear), 0.12))
            rres = {}
            for vname, dr, tgt, pitch in views:
                x, z = ring(dr)
                s.js("([x, z]) => window.__SF__.tp(x, z)", [x, z])
                s.js("([tx, tz, p]) => window.__SF__.face(tx, tz, p)", [tgt[0], tgt[1], pitch])
                s.js("(t) => window.__SF__.setT(t)", t)
                s.step_frames(10, 1 / 60, True)
                s.js("(t) => window.__SF__.setT(t)", t)
                url_on = s.js("() => window.__SF__.grab(false)")
                url_off = s.js("() => window.__SF__.grab(true)")
                on, off = L.png_to_arr(url_on), L.png_to_arr(url_off)
                # BLOOM caused by the wall: the same A/B with the bloom pass off. (on - off) with bloom minus (on - off) without it is exactly the
                # light the bloom pass added or took away BECAUSE the wall is drawn: a halo around streaks or the band shows up here (plan glare bar:
                # nothing but lightning above the bloom threshold, halo <= 2-3x the source width).
                # P2-F: the factorial is measured with the AA pass OFF (all four grabs): FXAA / SMAA are edge-dependent, so (on - off) with and without
                # bloom is not additive through them (P1-C: max 17-42/255 on edge pixels with AA on, p99 0.00; ?aa=0 39/39). The other rows keep the AA.
                aa_tok = L.aa_off(s)
                s.js("(t) => window.__SF__.setT(t)", t)
                onA = L.png_to_arr(s.js("() => window.__SF__.grab(false)"))
                offA = L.png_to_arr(s.js("() => window.__SF__.grab(true)"))
                s.js("() => { const k = window.__LC__.W.kernel; if (k.bloom) k.bloom.enabled = false; }")
                on0 = L.png_to_arr(s.js("() => window.__SF__.grab(false)"))
                off0 = L.png_to_arr(s.js("() => window.__SF__.grab(true)"))
                s.js("() => { const k = window.__LC__.W.kernel; if (k.bloom) k.bloom.enabled = true; }")
                L.aa_restore(s, aa_tok)
                sgn = ((onA - offA) - (on0 - off0)).mean(axis=2)        # + = the wall made the bloom pass ADD light here; - = the veil dimmed the sky's own bloom
                bx = np.clip(sgn, 0, None)
                bloom_x = {"mean": float(bx.mean()), "p99": float(np.percentile(bx, 99)), "max": float(bx.max()),
                           "removedMean": float(np.clip(-sgn, 0, None).mean()), "wallDeltaMean": float(np.abs(on0 - off0).mean())}
                tag = "%s_%s" % (rname, vname)
                L.save_png(url_on, os.path.join(out_dir, "storm_%s_on.png" % tag))
                L.save_png(url_off, os.path.join(out_dir, "storm_%s_off.png" % tag))
                pts = s.js("() => window.__SF__.wallPoints(0, 60, 31, 0.4)")
                band = L.region_stats(on, off, pts["pts"], pts["w"], pts["h"], 0, 10, EXCL)
                curt = L.region_stats(on, off, pts["pts"], pts["w"], pts["h"], 10, 60, EXCL)
                # streaks: per image ROW inside the 10-60 m region, distinct peaks of the A/B luma delta above a 31 px running
                # median (a column profile smears the verticals, which converge in perspective: attempt 1 read 0 peaks that way)
                n_pk, row_counts = L.row_peaks(on, off, pts["pts"], pts["w"], pts["h"], 10, 60, 4.0, EXCL)
                base = float(curt["meanAbsDelta"]) if curt else 0.0
                rres[vname] = {"band": band, "curtain": curt, "streakPeaks": n_pk, "streakRowCounts": row_counts[:40], "curtainBaseDelta": base, "bloomExtra": bloom_x,
                               "distToWallMin": min([p[4] for p in pts["pts"] if p[3]] or [0])}
                M["regions"][rname][vname] = rres[vname]
                # whole-frame diff image for the eye
                d = np.clip(np.abs(on - off) * 4, 0, 255)
                L.save_png(d, os.path.join(out_dir, "storm_%s_diff4x.png" % tag))
                print("  %s %-8s band %s curtain %s peaks %d" % (rname, vname, band and {k: (round(vv, 3) if isinstance(vv, float) else vv) for k, vv in band.items()},
                                                               curt and {k: (round(vv, 3) if isinstance(vv, float) else vv) for k, vv in curt.items()}, n_pk), flush=True)
            results[rname] = rres

            # ── wall alone over black / white: alpha cap + emission glare ratios (near view when we have it) ──
            vname = "near" if best[2] else "far"
            dr = -dnear if best[2] else -dfar
            tgt = ring(dnear) if best[2] else ring(dfar)
            x, z = ring(dr)
            s.js("([x, z]) => window.__SF__.tp(x, z)", [x, z])
            s.js("([tx, tz, p]) => window.__SF__.face(tx, tz, p)", [tgt[0], tgt[1], 0.12 if best[2] else 0.14])
            s.js("(t) => window.__SF__.setT(t)", t)
            s.step_frames(6, 1 / 60, True)
            s.js("(t) => window.__SF__.setT(t)", t)
            w, h = 640, 360
            bb = s.js("([w, h]) => window.__SF__.only([0, 0, 0], true, false, false, w, h)", [w, h])
            ww = s.js("([w, h]) => window.__SF__.only([1, 1, 1], true, false, false, w, h)", [w, h])
            if not bb or not ww:
                v.cnj("%s wall-alone float render" % rname, "float render target unavailable (EXT_color_buffer_float)")
                continue
            B, Wt = L.float_buf(bb, w, h), L.float_buf(ww, w, h)
            alpha = 1.0 - (Wt[..., 1] - B[..., 1])
            cov = alpha > 0.01
            a_max = float(alpha.max())
            a_p999 = float(np.percentile(alpha[cov], 99.9)) if cov.any() else 0.0
            emis = L.luma(B[..., :3])
            pts = s.js("() => window.__SF__.wallPoints(0, 60, 31, 0.4)")
            sx, sy = w / float(pts["w"]), h / float(pts["h"])

            def pick(hmin, hmax):
                idx = set()
                for (px, py, ha, vis, dist) in pts["pts"]:
                    if vis and hmin <= ha <= hmax:
                        x_, y_ = int(px * sx), int(py * sy)
                        if 0 <= x_ < w and 0 <= y_ < h:
                            idx.add((x_, y_))
                return np.array(sorted(idx)) if idx else None

            ib, ic = pick(0.0, 3.0), pick(10.0, 60.0)
            glare = {"alphaMax": a_max, "alphaP999": a_p999, "coveredFrac": float(cov.mean())}
            if ib is not None and ic is not None:
                eb = emis[ib[:, 1], ib[:, 0]]
                ec = emis[ic[:, 1], ic[:, 0]]
                # keep to wall-covered pixels
                ec = ec[ec > 1e-5]
                eb = eb[eb > 1e-5]
                if len(ec) > 20 and len(eb) > 5:
                    med = float(np.median(ec))
                    glare.update({"curtainEmissionMedian": med, "streakP995": float(np.percentile(ec, 99.5)),
                                  "streakOverCurtain": float(np.percentile(ec, 99.5) / med),
                                  "bandMeanOverCurtain": float(eb.mean() / med), "nCurtain": int(len(ec)), "nBand": int(len(eb))})
            M["regions"][rname]["glare"] = glare
            L.save_png(np.clip(alpha[..., None].repeat(3, axis=2) * 255, 0, 255), os.path.join(out_dir, "storm_%s_alpha.png" % rname))
            print("  %s glare %s" % (rname, {k: round(vv, 3) if isinstance(vv, float) else vv for k, vv in glare.items()}), flush=True)

            # tint-out view for the sheet
            xo, zo = ring(22)
            s.js("([x, z]) => window.__SF__.tp(x, z)", [xo, zo])
            s.js("([tx, tz, p]) => window.__SF__.face(tx, tz, p)", [ring(-60)[0], ring(-60)[1], 0.10])
            s.js("(t) => window.__SF__.setT(t)", t)
            s.step_frames(60, 1 / 60, True)
            s.js("(t) => window.__SF__.setT(t)", t)
            L.save_png(s.js("() => window.__SF__.grab(false)"), os.path.join(out_dir, "storm_%s_out22.png" % rname))
            M["regions"][rname]["out22"] = s.js("() => window.__SF__.fogState()")
            # back inside so the next region starts neutral
            s.js("([x, z]) => window.__SF__.tp(x, z)", [cx, cz])
            s.step_frames(40, 1 / 60, False)

        # ── judge the per-region numbers ──────────────────────────────────────
        for rname, rres in results.items():
            for vname, r in rres.items():
                b, cu = r["band"], r["curtain"]
                if b is None or b["n"] < 8:
                    v.cnj("%s/%s ground band" % (rname, vname), "fewer than 8 visible band pixels (%s)" % (b and b["n"]))
                else:
                    v.check("%s/%s: ground band (0-10 m) mean delta >= %d/255" % (rname, vname, BAND_MIN_DELTA), b["meanAbsDelta"] >= BAND_MIN_DELTA,
                            "%.1f over %d px" % (b["meanAbsDelta"], b["n"]))
                if cu is None or cu["n"] < 8:
                    v.cnj("%s/%s far scenery luma ratio" % (rname, vname), "fewer than 8 visible curtain pixels")
                else:
                    v.check("%s/%s: scenery behind the curtain luma ratio on/off in 0.85-1.15" % (rname, vname), 0.85 <= cu["lumaRatio"] <= 1.15,
                            "%.3f (on %.1f / off %.1f, %d px)" % (cu["lumaRatio"], cu["lumaOn"], cu["lumaOff"], cu["n"]))
                bxr = r.get("bloomExtra")
                if bxr is not None:
                    v.check("%s/%s: the wall makes the bloom pass add no halo (p99 <= %.0f/255, max <= %.0f/255 of bloom light caused by the wall)" % (rname, vname, BLOOM_P99_MAX, BLOOM_MAX_MAX),
                            bxr["p99"] <= BLOOM_P99_MAX and bxr["max"] <= BLOOM_MAX_MAX,
                            "ADDED by the wall: frame mean %.2f/255, p99 %.2f, max %.1f; dimmed (sky bloom the veil removed) mean %.2f; the wall's own mean delta without bloom %.2f" % (bxr["mean"], bxr["p99"], bxr["max"], bxr["removedMean"], bxr["wallDeltaMean"]))
                    v.info("%s/%s: bloom light caused by the wall (bloom on minus bloom off, A/B delta)" % (rname, vname),
                           "ADDED by the wall: frame mean %.2f/255, p99 %.2f, max %.1f; dimmed (sky bloom the veil removed) mean %.2f; the wall's own mean delta without bloom %.2f" % (bxr["mean"], bxr["p99"], bxr["max"], bxr["removedMean"], bxr["wallDeltaMean"]))
                need = 8 if vname in ("far", "near") else 5
                v.check("%s/%s: streaks: median distinct peaks per row (10-60 m) >= %d" % (rname, vname, need), r["streakPeaks"] >= need, "%d peaks (curtain delta %.1f)" % (r["streakPeaks"], r["curtainBaseDelta"]))
        for rname in results:
            g = M["regions"][rname].get("glare")
            if not g:
                continue
            v.check("%s: wall alpha cap <= %.2f (a silhouette behind keeps >= %d%% contrast)" % (rname, CAP, round(100 * (1 - CAP))),
                    g["alphaMax"] <= CAP + 1e-3, "max alpha %.4f, p99.9 %.4f" % (g["alphaMax"], g["alphaP999"]))
            if "streakOverCurtain" in g:
                v.check("%s: streak emission <= 2.0x curtain emission" % rname, g["streakOverCurtain"] <= 2.0, "%.2fx (n=%d)" % (g["streakOverCurtain"], g["nCurtain"]))
                v.check("%s: ground band emission <= 2.5x curtain emission" % rname, g["bandMeanOverCurtain"] <= 2.5, "%.2fx (n=%d)" % (g["bandMeanOverCurtain"], g["nBand"]))
            else:
                v.cnj("%s glare ratios" % rname, "not enough covered samples")

        # ── lightning glare: sky + bolt vs sky alone ──────────────────────────
        bolt = s.js("""() => { const W = window.__LC__.W, ctl = W.stormCtl, cam = W.camera; cam.updateMatrixWorld(); const me = cam.matrixWorld.elements;
          let fx = -me[8], fz = -me[10]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
          const x = cam.position.x + fx * 500, z = cam.position.z + fz * 500, y = 40; const bm = new W.THREE.Matrix4(); bm.makeScale(85, 250, 1); bm.setPosition(x, y, z);
          const iB = ctl.bolts.geometry.getAttribute('iB');
          for (let i = 0; i < 6; i++) { ctl.bolts.setMatrixAt(i, i === 0 ? bm : new W.THREE.Matrix4().makeScale(0, 0, 0)); iB.setXYZW(i, 0, i === 0 ? 1 : 0, 1, 0); }
          ctl.bolts.instanceMatrix.needsUpdate = true; iB.needsUpdate = true; ctl.bolts.visible = true; return { x, y, z }; }""")
        w, h = 640, 360
        sky_off = s.js("([w, h]) => window.__SF__.only([0, 0, 0], false, false, true, w, h)", [w, h])
        sky_on = s.js("([w, h]) => window.__SF__.only([0, 0, 0], false, true, true, w, h)", [w, h])
        if sky_off and sky_on:
            A, B2 = L.float_buf(sky_on, w, h), L.float_buf(sky_off, w, h)
            lon, loff = L.luma(A[..., :3]), L.luma(B2[..., :3])
            d = lon - loff
            m = d > 0.02
            if m.sum() > 20:
                ratio = (lon[m] / np.maximum(loff[m], 1e-4))
                peak = float(ratio.max())
                p99 = float(np.percentile(ratio, 99))
                M["lightning"] = {"pixels": int(m.sum()), "peakRatio": peak, "p99Ratio": p99, "peakAbsLum": float(lon[m].max()), "skyLumAtPeak": float(loff[m][ratio.argmax()])}
                v.check("lightning bolt at full intensity <= 8x its sky (sky + bolt over sky)", peak <= 8.0, "peak %.2fx, p99 %.2fx, peak lum %.2f over sky %.2f (%d px)" % (peak, p99, lon[m].max(), loff[m][ratio.argmax()], int(m.sum())))
            else:
                v.cnj("lightning glare", "the bolt did not rasterise (%d changed px); facing %s" % (int(m.sum()), bolt))
        else:
            v.cnj("lightning glare", "float render target unavailable")

        # ── inside-the-storm tint: moves everything, restores EXACTLY ─────────
        t = 0.5 * (s.js("(p) => window.__SF__.phaseWindow(p)", 3)["shrinkStart"] + s.js("(p) => window.__SF__.phaseWindow(p)", 3)["end"])
        c = s.js("(t) => window.__SF__.setT(t)", t)
        cx, cz, R = c["cx"], c["cz"], c["radius"]
        ang = 3.32
        s.js("([x, z]) => window.__SF__.tp(x, z)", [cx, cz])          # centre of the circle: certainly inside
        s.step_frames(30, 1 / 60, True)
        s.js("(t) => window.__SF__.setT(t)", t)
        S0 = s.js("() => window.__SF__.fogState()")
        # outside: 40 m beyond the wall, on land if possible
        outp = None
        for deg in range(0, 360, 6):
            a = math.radians(deg)
            x, z = cx + math.cos(a) * (R + 30), cz + math.sin(a) * (R + 30)
            if s.js("([x, z]) => window.__LC__.W.map.heightAt(x, z) > window.__LC__.W.map.waterY + 0.5 && Math.hypot(x, z) < window.__LC__.W.map.half", [x, z]):
                outp = (x, z)
                break
        if outp is None:
            v.cnj("inside-storm tint", "no land point outside the circle")
        else:
            s.js("([x, z]) => window.__SF__.tp(x, z)", list(outp))
            s.js("(t) => window.__SF__.setT(t)", t)
            s.step_frames(5, 1 / 60, True)
            mid = s.js("() => window.__SF__.fogState()")      # mid-ramp (0.083 s in)
            s.step_frames(45, 1 / 60, True)
            S1 = s.js("() => window.__SF__.fogState()")
            rb_in = s.js("() => { const W = window.__LC__.W; return W._playerInStorm; }")
            s.js("([x, z]) => window.__SF__.tp(x, z)", [cx, cz])
            s.js("(t) => window.__SF__.setT(t)", t)
            s.step_frames(45, 1 / 60, True)
            S2 = s.js("() => window.__SF__.fogState()")
            M["tint"] = {"S0": S0, "mid": mid, "S1": S1, "S2": S2, "playerInStormAtS1": rb_in}

            def moved(a, b):
                return a is not None and b is not None and any(abs(x - y) > 1e-4 for x, y in zip(a, b))

            ok_moved = (moved(S0["fogC"], S1["fogC"]) and abs(S1["fogD"] - S0["fogD"]) > 1e-4 and moved(S0["bg"], S1["bg"])
                        and moved(S0["top"], S1["top"]) and moved(S0["bot"], S1["bot"]) and S1["grade"] >= 0.99 and rb_in)
            v.check("inside the storm: fog colour + density, background and both sky uniforms move, output grade -> 1", ok_moved,
                    {"fogC": [S0["fogC"], S1["fogC"]], "fogD": [S0["fogD"], S1["fogD"]], "top": [S0["top"], S1["top"]], "bot": [S0["bot"], S1["bot"]], "grade": S1["grade"], "skySrc": S1["skySrc"]})
            v.check("the tint ramps (mid-ramp frame is between the two states)", mid["grade"] is not None and 0.0 < mid["grade"] < 0.99, "grade %.3f at 5 frames" % (mid["grade"] or -1))
            exact = (S2["fogC"] == S0["fogC"] and S2["fogD"] == S0["fogD"] and S2["bg"] == S0["bg"] and S2["top"] == S0["top"] and S2["bot"] == S0["bot"] and S2["grade"] == 0)
            v.check("back inside: fog colour, density, background, both sky uniforms restored EXACTLY (bit-equal) and grade == 0", exact,
                    {"S0": S0, "S2": S2} if not exact else "bit-equal")
            # W.stormU follows the circle
            su = s.js("() => { const W = window.__LC__.W, q = W.stormCtl.storm.stateAt(W.t); return { u: { cx: W.stormU.cx, cz: W.stormU.cz, r: W.stormU.r }, q: { cx: q.center.x, cz: q.center.z, r: q.radius } }; }")
            v.check("W.stormU = {cx, cz, r} equals the live circle", abs(su["u"]["cx"] - su["q"]["cx"]) < 1e-6 and abs(su["u"]["cz"] - su["q"]["cz"]) < 1e-6 and abs(su["u"]["r"] - su["q"]["r"]) < 1e-6, su)

        # ── side-by-side sheet vs the reference frames ────────────────────────
        try:
            tiles = []
            for label, path in (("ref t100 (storm wall)", REF + "/ref_t100_storm_wall_eliminated_banner.jpg"),
                                ("ref t84 (inside storm)", REF + "/ref_t84_interior_lootrings_storm_inside.jpg"),
                                ("ref t22 (lightning)", REF + "/ref_t22_parachute_downtown_storm.jpg"),
                                ("ours phase2 far", out_dir + "/storm_phase2_far_on.png"),
                                ("ours phase6 near/far", out_dir + "/storm_phase6_%s_on.png" % ("near" if os.path.exists(out_dir + "/storm_phase6_near_on.png") else "far")),
                                ("ours phase6 tangent", out_dir + "/storm_phase6_tangent_on.png"),
                                ("ours phase2 out22 (tint)", out_dir + "/storm_phase2_out22.png"),
                                ("ours phase6 out22 (tint)", out_dir + "/storm_phase6_out22.png")):
                if os.path.exists(path):
                    im = Image.open(path).convert("RGB").resize((640, 360))
                    ImageDraw.Draw(im).rectangle((0, 0, 639, 18), fill=(0, 0, 0))
                    ImageDraw.Draw(im).text((4, 3), label, fill=(255, 255, 255))
                    tiles.append(im)
            if tiles:
                cols = 2
                rows = (len(tiles) + 1) // 2
                sheet = Image.new("RGB", (640 * cols, 360 * rows))
                for i, im in enumerate(tiles):
                    sheet.paste(im, ((i % cols) * 640, (i // cols) * 360))
                sheet.save(os.path.join(out_dir, "storm_sheet_vs_ref.png"))
                v.note("sheet: %s" % os.path.join(out_dir, "storm_sheet_vs_ref.png"))
        except Exception as e:
            v.note("sheet failed: %s" % e)

        d = s.diagnostics()
        M["diag"] = {k: d[k] for k in ("consoleErrors", "pageErrors", "windowErrors", "failedRequests", "shader", "shaderWarnings")}
        v.check("0 console errors, 0 page / window errors, 0 shader errors, 0 failed requests",
                not (d["consoleErrors"] or d["pageErrors"] or d["windowErrors"] or d["shader"] or d["failedRequests"]), M["diag"])
    v.data["measure"] = M


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    common.add_common_args(ap)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--shots", default=os.path.join(SCRATCH, "shots"))
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    sys.exit(common.run_gate("stormfx_storm", lambda v: main(v, args), args))
