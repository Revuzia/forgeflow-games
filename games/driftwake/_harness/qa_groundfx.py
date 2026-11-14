# -*- coding: utf-8 -*-
"""
qa_groundfx.py -- do the three ground-FX systems (arc decal, enemy telegraph
ring, player cast ring) sit ON the terrain, on a real steep slope?

THE CLASS BUG under test: the FX were flat quads at the cast point's height.
On a dune of grade ~0.6 the uphill half of every footprint was buried
(invisible) and the downhill half floated. This probe measures that directly:

  1. Scan terrain.heightAt around the spawn area for a slope of grade 0.5-0.7.
  2. Teleport there and trigger each system for real (spells.cast(7) for the
     frost arc, spells.cast(3) windup for the cast ring, a spawned rimeImp's
     windup for the telegraph) -- no state is faked into the pools.
  3. Freeze time mid-effect (S.freezeTime -> dt=0; systems keep running with
     dt 0, TAA settles, everything is pixel-static), screenshot the effect ON,
     hide only that system (its own .enabled probe switch), screenshot OFF.
  4. Diff the pair: the changed pixels ARE the effect. Count them uphill vs
     downhill of the effect's projected center (split along the projected
     contour line). Flat-quad behaviour reads ~0 uphill; a conforming decal
     reads roughly area-symmetric (ratio > 0.5).
  5. Rim conformance (circles): the projected world point of the ring's
     uphill rim must be within a few dozen px of an actual effect pixel.

Draw-count leg: renderer.info.render.calls ON minus OFF must be exactly 1 per
system (one pooled mesh, one draw).

Usage:
    python qa_groundfx.py            # report only (BEFORE capture)
    python qa_groundfx.py --after    # assert ratios/rim/draws (AFTER gate)

Port 8843 (this worker's). Screenshots to _shots/groundfx_*.png.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SHOTS = HERE.parent / "_shots"
PORT = 8843
GAME_URL = f"http://localhost:{PORT}/games/driftwake/index.html?autoplay"
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion"]
W, H = 1280, 720

# ---------------------------------------------------------------- page JS ---

JS_HELPERS = """
window.__gfx = window.__gfx || {};
window.__gfx.gameWait = (sec) => new Promise((res) => {
    const reg = SNOWFLOW.combat.registry;
    const t0 = reg.time;
    const tick = () => (reg.time - t0 >= sec) ? res()
        : requestAnimationFrame(tick);
    tick();
});
// Project a world point through the live view-projection. Returns [px, py, w].
window.__gfx.proj = (x, y, z) => {
    const e = SNOWFLOW.spells.globals.uViewProj.value.elements;
    const cx = e[0]*x + e[4]*y + e[8]*z  + e[12];
    const cy = e[1]*x + e[5]*y + e[9]*z  + e[13];
    const cw = e[3]*x + e[7]*y + e[11]*z + e[15];
    return [(cx/cw*0.5 + 0.5) * %(W)d, (1 - (cy/cw*0.5 + 0.5)) * %(H)d, cw];
};
// Local terrain gradient: magnitude + uphill unit vector, world XZ.
window.__gfx.grad = (x, z) => {
    const T = SNOWFLOW.terrain, e = 1.5;
    const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
    const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
    const g = Math.hypot(gx, gz);
    return { g, ux: g ? gx / g : 1, uz: g ? gz / g : 0 };
};
true;
""" % {"W": W, "H": H}

JS_PREP = """(async () => {
    const SF = SNOWFLOW, ch = SF.character, T = SF.terrain;
    // No wild spawns during the shoot, and a clean frame.
    if (SF.combat.encounters) {
        SF.combat.encounters._nextSpawnAt = Infinity;
        if (SF.combat.encounters._clearAll) SF.combat.encounters._clearAll();
    }
    SF.combat.enemies.clear();
    if (SF.shrine && SF.shrine.mesh) SF.shrine.mesh.visible = false;
    if (typeof ch.health === "number") ch.health = 99999;

    // ---- scan for a grade 0.5-0.7 slope near the spawn area -------------
    // Central difference over a 3 m baseline; require the grade to hold at
    // +/-3 m uphill AND +/-9 m along the contour so the whole footprint and
    // the camera line live on one face.
    const grade = (x, z) => {
        const e = 1.5;
        const gx = (T.heightAt(x + e, z) - T.heightAt(x - e, z)) / (2 * e);
        const gz = (T.heightAt(x, z + e) - T.heightAt(x, z - e)) / (2 * e);
        return [Math.hypot(gx, gz), gx, gz];
    };
    const anchors = [[150, 150], [ch.position.x, ch.position.z]];
    let best = null;
    for (const [ax, az] of anchors) {
        for (let r = 8; r <= 160; r += 3) {
            for (let a = 0; a < 360; a += 9) {
                const x = ax + r * Math.sin(a * Math.PI / 180);
                const z = az + r * Math.cos(a * Math.PI / 180);
                const [g, gx, gz] = grade(x, z);
                if (g < 0.5 || g > 0.7) continue;
                const ux = gx / g, uz = gz / g;         // uphill unit, world XZ
                const [g2] = grade(x + ux * 3, z + uz * 3);
                const [g3] = grade(x - ux * 3, z - uz * 3);
                if (g2 < 0.4 || g2 > 0.85 || g3 < 0.4 || g3 > 0.85) continue;
                // contour uniformity for the cast-ring camera line
                const cx2 = -uz, cz2 = ux;
                const h0 = T.heightAt(x, z);
                const hA = T.heightAt(x + cx2 * 9, z + cz2 * 9);
                const hB = T.heightAt(x - cx2 * 9, z - cz2 * 9);
                if (Math.abs(hA - h0) > 1.6 || Math.abs(hB - h0) > 1.6) continue;
                const score = Math.abs(g - 0.6) * 100 + r * 0.05;
                if (!best || score < best.score) {
                    best = { score, x, z, g, up: [ux, uz], ct: [cx2, cz2],
                             sideA: Math.abs(hA - h0) <= Math.abs(hB - h0) };
                }
            }
            if (best && best.score < 2) break;
        }
        if (best) break;
    }
    if (!best) return { err: "no grade 0.5-0.7 slope found in scan" };
    return { x: +best.x.toFixed(2), z: +best.z.toFixed(2),
             grade: +best.g.toFixed(3), up: best.up, ct: best.ct,
             sideA: best.sideA, h: +T.heightAt(best.x, best.z).toFixed(2) };
})()"""

# slot: teleport + face along dir, settle. args: [x, z, yaw, pitch, dist]
# The rig's position is DAMPED: after a long teleport (the first hop from the
# restored save can be hundreds of metres) the camera is still in transit for
# seconds — poll until it has actually arrived or every shot frames a distant
# vista with no character in it (first two arc attempts).
JS_PLACE = """async ([x, z, yaw, pitch, dist]) => {
    const SF = SNOWFLOW, ch = SF.character;
    ch.position.x = x; ch.position.y = SF.terrain.heightAt(x, z) + 0.2;
    ch.position.z = z;
    if (ch.velocity && ch.velocity.set) ch.velocity.set(0, 0, 0);
    SF.rig.yaw = yaw; SF.rig.pitch = pitch;
    SF.rig.distanceTarget = dist;
    const camDist = () => {
        const e = SF.rig.camera.position, c = ch.position;
        return Math.hypot(e.x - c.x, e.y - c.y, e.z - c.z);
    };
    const t0 = performance.now();
    while (camDist() > dist + 6 && performance.now() - t0 < 12000)
        await new Promise(r => requestAnimationFrame(r));
    await window.__gfx.gameWait(0.7);
    const eye = SF.rig.camera.position;
    return { eye: [eye.x, eye.y, eye.z], camDist: +camDist().toFixed(1),
             chy: SF.character.position.y, pitch: SF.rig.pitch };
}"""

# Full-frame draw calls: core/perf.js installDrawCounter turns autoReset off
# and snapshots info.render.calls at the frame boundary into stats.drawCalls.
JS_CALLS = "SNOWFLOW.perfStats.drawCalls"

JS_UNFREEZE = """(() => {
    SNOWFLOW.S.freezeTime = false; return true;
})()"""


def evaluate(pg, js, arg=None):
    return pg.evaluate(js) if arg is None else pg.evaluate(js, arg)


# ------------------------------------------------------------- analysis -----

def diff_analysis(on_path, off_path, meta, thresh=40, radius_px=380):
    """Count changed pixels uphill vs downhill of the projected center.

    meta: {center_px: [x,y], up_px: [dx,dy] unit-ish screen uphill direction,
           rim_up_px: [x,y] or None,
           ring_pts_px: optional 24 projected points of the ring band at
           terrain height — when present, counting is restricted to a band
           mask around that polyline. The band is rotationally uniform, so
           the mask makes the up/down split symmetric by construction and
           excludes the frozen rotating sweep (whose random phase otherwise
           swings the ratio run to run).}
    """
    from PIL import Image, ImageDraw
    a = Image.open(on_path).convert("RGB")
    b = Image.open(off_path).convert("RGB")
    pa, pb = a.load(), b.load()
    cx, cy = meta["center_px"]
    ux, uy = meta["up_px"]
    n = (ux * ux + uy * uy) ** 0.5 or 1.0
    ux, uy = ux / n, uy / n

    mask = None
    pts = meta.get("ring_pts_px")
    if pts:
        m = Image.new("L", (W, H), 0)
        dr = ImageDraw.Draw(m)
        poly = [(p[0], p[1]) for p in pts] + [(pts[0][0], pts[0][1])]
        dr.line(poly, fill=255, width=34, joint="curve")
        mask = m.load()

    up_n = dn_n = 0
    s = 0
    best_rim = None
    rim = meta.get("rim_up_px")
    x0 = max(0, int(cx - radius_px)); x1 = min(W, int(cx + radius_px))
    y0 = max(0, int(cy - radius_px)); y1 = min(H, int(cy + radius_px))
    for y in range(y0, y1):
        for x in range(x0, x1):
            if mask is not None and not mask[x, y]:
                continue
            r1, g1, b1 = pa[x, y]
            r2, g2, b2 = pb[x, y]
            d = abs(r1 - r2) + abs(g1 - g2) + abs(b1 - b2)
            if d <= thresh:
                continue
            s += d
            if (x - cx) * ux + (y - cy) * uy > 0:
                up_n += 1
            else:
                dn_n += 1
            if rim is not None:
                rd = ((x - rim[0]) ** 2 + (y - rim[1]) ** 2) ** 0.5
                if best_rim is None or rd < best_rim:
                    best_rim = rd
    total = up_n + dn_n
    out = {
        "up_px_count": up_n, "down_px_count": dn_n,
        "ratio_up_over_down": round(up_n / dn_n, 3) if dn_n else
            (float("inf") if up_n else 0.0),
        "total_changed_px": total,
        "mean_diff_over_changed": round(s / total, 1) if total else 0.0,
        "rim_uphill_min_dist_px": round(best_rim, 1) if best_rim is not None
            else None,
    }

    if pts:
        # Visible-EXTENT metric for the circles: is the band present near
        # each of the 24 projected ring points, per half? Foreshortening-
        # immune — from a downhill vantage the uphill arc compresses to a
        # thin line and loses raw pixel count while being fully drawn.
        # A buried half still reads 0: no band, no changed pixels near its
        # points.
        vis_up = n_up = vis_dn = n_dn = 0
        for (px2, py2) in pts:
            up_side = (px2 - cx) * ux + (py2 - cy) * uy > 0
            found = False
            for yy in range(max(0, int(py2) - 10), min(H, int(py2) + 11)):
                for xx in range(max(0, int(px2) - 10),
                                min(W, int(px2) + 11)):
                    r1, g1, b1 = pa[xx, yy]
                    r2, g2, b2 = pb[xx, yy]
                    if abs(r1-r2) + abs(g1-g2) + abs(b1-b2) > thresh:
                        found = True
                        break
                if found:
                    break
            if up_side:
                n_up += 1
                vis_up += found
            else:
                n_dn += 1
                vis_dn += found
        cov_up = vis_up / n_up if n_up else 0.0
        cov_dn = vis_dn / n_dn if n_dn else 0.0
        out["band_coverage_uphill"] = round(cov_up, 3)
        out["band_coverage_downhill"] = round(cov_dn, 3)
        out["extent_ratio_up_over_down"] = (
            round(cov_up / cov_dn, 3) if cov_dn else
            (float("inf") if cov_up else 0.0))
    return out


# ------------------------------------------------------------------ main ----

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--after", action="store_true",
                    help="assert the conformance gates (post-fix run)")
    args = ap.parse_args()
    tag = "" if args.after else "_before"

    from playwright.sync_api import sync_playwright

    SHOTS.mkdir(exist_ok=True)
    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(PORT)], cwd=str(ROOT),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(2.5)
    out = {"mode": "after" if args.after else "before"}
    try:
        with sync_playwright() as pw:
            br = pw.chromium.launch(channel="chrome", headless=False,
                                    args=FLAGS)
            pg = br.new_page(viewport={"width": W, "height": H})
            pg.goto(GAME_URL, wait_until="domcontentloaded")
            pg.wait_for_function(
                "() => globalThis.SNOWFLOW && !SNOWFLOW.S.freezeTime",
                timeout=120000)
            pg.wait_for_timeout(2500)
            pg.evaluate(JS_HELPERS)

            slope = evaluate(pg, JS_PREP)
            out["slope"] = slope
            if "err" in slope:
                print(json.dumps(out, indent=1))
                sys.exit(2)
            sx, sz = slope["x"], slope["z"]
            ux, uz = slope["up"]
            # contour dir, pointed at the flatter of the two sides
            cx2, cz2 = slope["ct"]
            if not slope["sideA"]:
                cx2, cz2 = -cx2, -cz2
            yaw_ct = __import__("math").atan2(cx2, -cz2)

            def shoot(name, trigger_js, trigger_arg, off_js, restore_js):
                """freeze is done inside trigger_js; returns analysis dict."""
                meta = evaluate(pg, trigger_js, trigger_arg)
                if not isinstance(meta, dict) or "err" in meta:
                    return {"err": meta if isinstance(meta, dict)
                            else {"err": "trigger failed", "got": meta}}
                pg.wait_for_timeout(800)          # TAA settles, frame static
                calls_on = evaluate(pg, JS_CALLS)
                on = str(SHOTS / f"groundfx_{name}{tag}_on.png")
                pg.screenshot(path=on)
                evaluate(pg, off_js)
                pg.wait_for_timeout(800)
                calls_off = evaluate(pg, JS_CALLS)
                off = str(SHOTS / f"groundfx_{name}{tag}_off.png")
                pg.screenshot(path=off)
                evaluate(pg, restore_js)
                res = diff_analysis(on, off, meta)
                res["draw_delta_on_minus_off"] = calls_on - calls_off
                res["meta"] = meta
                if args.after:
                    # the presentation shot the task names
                    import shutil
                    shutil.copyfile(on, str(SHOTS / f"groundfx_{name}.png"))
                return res

            # ---------------- ARC (spells.cast(7), decal at the caster) ----
            # Cast DOWNHILL from the slope shoulder: the conforming decal
            # drapes the face below with the camera above it — a decal that
            # hugs the ground is exactly as hideable as the ground, so an
            # along-contour camera can lose it behind the next crest.
            # The character is PINNED every frame while the damped camera
            # flies in: a surf character on a grade-0.6 face accelerates
            # downhill immediately, and a camera chasing a slider never
            # converges (cam_to_char 22 m, decal off-frame, third attempt).
            import math as _m
            yaw_dn = _m.atan2(-ux, uz)
            arc_trigger = """async ([sx, sz, yawDn]) => {
                const SF = SNOWFLOW, ch = SF.character;
                SF.rig.yaw = yawDn; SF.rig.pitch = 0.55;
                SF.rig.distanceTarget = 7.0;
                const pin = () => {
                    ch.position.x = sx; ch.position.z = sz;
                    ch.position.y = SF.terrain.heightAt(sx, sz) + 0.2;
                    if (ch.velocity && ch.velocity.set)
                        ch.velocity.set(0, 0, 0);
                };
                const raf = () => new Promise(r => requestAnimationFrame(r));
                const camDist = () => {
                    const e = SF.rig.camera.position;
                    return Math.hypot(e.x - ch.position.x,
                        e.y - ch.position.y, e.z - ch.position.z);
                };
                const t0 = performance.now();
                while (camDist() > 13 && performance.now() - t0 < 12000) {
                    pin(); await raf();
                }
                for (let i = 0; i < 30; i++) { pin(); await raf(); }
                pin();
                // WARM-UP cast: the arc program compiles on its FIRST draw,
                // and that hitch can eat most of the decal's 1.1 s life
                // before the freeze lands (one run froze at active 0). Let
                // the throwaway decal die and the 1.5 s cooldown lapse.
                SF.spells.cast(7);
                const tw = performance.now();
                while (performance.now() - tw < 15000) {
                    pin(); await raf();
                    if (SF.spells.arcDecal.stats.active === 0 &&
                        performance.now() - tw > 1800 &&
                        (SF.spells._cdUntil[7] || 0) <= SF.spells._time)
                        break;
                }
                pin();
                SF.spells.cast(7);
                const t1 = performance.now();
                while (SF.spells.arcDecal.stats.active === 0) {
                    if (performance.now() - t1 > 8000)
                        return { err: "arc decal never went live (re-cast)" };
                    pin(); await raf();
                }
                for (let i = 0; i < 6; i++) { pin(); await raf(); }
                SF.S.freezeTime = true;
                await raf();
                if (SF.spells.arcDecal.stats.active === 0)
                    return { err: "arc decal dead at freeze" };
                const T = SF.terrain, P = window.__gfx.proj;
                // Split about the sector's MIDPOINT (4.5 m downrange of the
                // caster), along the LOCAL uphill there — the caster's feet
                // can sit off-frame while the sector body fills it.
                const mx = SF.spells.arcX + SF.spells.arcDirX * 4.5;
                const mz = SF.spells.arcZ + SF.spells.arcDirZ * 4.5;
                const lg = window.__gfx.grad(mx, mz);
                const c = P(mx, T.heightAt(mx, mz), mz);
                const u = P(mx + lg.ux * 2,
                            T.heightAt(mx + lg.ux * 2, mz + lg.uz * 2),
                            mz + lg.uz * 2);
                const eye = SF.rig.camera.position;
                return { center_px: [c[0], c[1]],
                         up_px: [u[0] - c[0], u[1] - c[1]],
                         world_center: [mx, mz],
                         local_grade: +lg.g.toFixed(3),
                         cam_to_char: +Math.hypot(eye.x - ch.position.x,
                             eye.y - ch.position.y,
                             eye.z - ch.position.z).toFixed(1),
                         decal_active: SF.spells.arcDecal.stats.active };
            }"""
            out["arc"] = shoot(
                "arc", arc_trigger, [sx, sz, yaw_dn],
                "SNOWFLOW.spells.arcDecal.enabled = false",
                "(() => { const d = SNOWFLOW.spells.arcDecal;"
                " d.enabled = true; d.clear(); SNOWFLOW.S.freezeTime = false;"
                " return true; })()")

            # -------------- CAST RING (bloom windup at captured target) ----
            # Approach from DOWNHILL and aim UP at the face: an along-contour
            # eye ray grazes local bumps and captures at the caster's feet,
            # where the character's own body hides the ring (first after-run).
            import math
            bx = sx - ux * 9.0
            bz = sz - uz * 9.0
            yaw_up = math.atan2(ux, -uz)
            place = evaluate(pg, JS_PLACE, [bx, bz, yaw_up, 0.0, 6.0])
            eye = place["eye"]
            dh = math.hypot(sx - eye[0], sz - eye[2])
            pitch = math.atan2(eye[1] - (slope["h"] + 0.5), max(1e-3, dh))
            evaluate(pg, JS_PLACE, [bx, bz, yaw_up, pitch, 6.0])
            ring_trigger = """async () => {
                const SF = SNOWFLOW;
                SF.progression.unlocked.add(3);
                SF.spells.cast(3);
                const cr = SF.spells.castRing;
                const t0 = performance.now();
                while (true) {
                    if (performance.now() - t0 > 8000)
                        return { err: "cast ring never reached mid-windup",
                                 active: cr.stats.active };
                    if (cr.stats.active > 0) {
                        const s = cr._live >= 0 ? cr._live : 0;
                        if (cr.a[s * 4 + 3] >= 0.6) break;
                    }
                    await new Promise(r => requestAnimationFrame(r));
                }
                SF.S.freezeTime = true;
                await new Promise(r => requestAnimationFrame(r));
                const s = cr._live >= 0 ? cr._live : 0;
                const cxw = cr.a[s * 4], czw = cr.a[s * 4 + 2];
                const R = cr.b[s * 4];
                const T = SF.terrain, P = window.__gfx.proj;
                // Split/rim along the LOCAL uphill at the captured target —
                // the ring lands wherever the eye ray met the face.
                const lg = window.__gfx.grad(cxw, czw);
                const c = P(cxw, T.heightAt(cxw, czw), czw);
                const u = P(cxw + lg.ux * 2,
                            T.heightAt(cxw + lg.ux * 2, czw + lg.uz * 2),
                            czw + lg.uz * 2);
                const rim = P(cxw + lg.ux * R,
                              T.heightAt(cxw + lg.ux * R, czw + lg.uz * R)
                                  + 0.12,
                              czw + lg.uz * R);
                const pts = [];
                for (let k = 0; k < 24; k++) {
                    const a2 = k / 24 * Math.PI * 2;
                    const px2 = cxw + Math.cos(a2) * R;
                    const pz2 = czw + Math.sin(a2) * R;
                    const pp = P(px2, T.heightAt(px2, pz2) + 0.12, pz2);
                    pts.push([pp[0], pp[1]]);
                }
                return { center_px: [c[0], c[1]],
                         up_px: [u[0] - c[0], u[1] - c[1]],
                         rim_up_px: [rim[0], rim[1]],
                         ring_pts_px: pts,
                         world_center: [cxw, czw], radius_m: R,
                         local_grade: +lg.g.toFixed(3) };
            }"""
            out["castring"] = shoot(
                "castring", ring_trigger, None,
                "SNOWFLOW.spells.castRing.enabled = false",
                "(() => { const c = SNOWFLOW.spells.castRing;"
                " c.enabled = true; c.clear(); SNOWFLOW.S.freezeTime = false;"
                " return true; })()")

            # -------------- TELEGRAPH (real rimeImp windup) -----------------
            evaluate(pg, JS_PLACE, [sx - cx2 * 4.0, sz - cz2 * 4.0,
                                    yaw_ct, 0.45, 6.0])
            tele_trigger = """async ([sx, sz, gx, gz]) => {
                const SF = SNOWFLOW, en = SF.combat.enemies, ch = SF.character;
                en.clear();
                en.spawn('rimeImp', sx, sz, 1);
                const ft = SF.fxTelegraph;
                const t0 = performance.now();
                let nudged = false;
                while (true) {
                    if (performance.now() - t0 > 25000)
                        return { err: "no telegraph windup within 25 s",
                                 active: ft.stats.active };
                    if (performance.now() - t0 > 12000 && !nudged) {
                        // player slid out of reach: bring them back in
                        nudged = true;
                        ch.position.x = sx - gx * 1.2;
                        ch.position.z = sz - gz * 1.2;
                        ch.position.y = SF.terrain.heightAt(
                            ch.position.x, ch.position.z) + 0.2;
                    }
                    if (ft.stats.active > 0 && ft.a[3] >= 0.25
                        && ft.a[3] <= 0.9) break;
                    await new Promise(r => requestAnimationFrame(r));
                }
                SF.S.freezeTime = true;
                await new Promise(r => requestAnimationFrame(r));
                const cxw = ft.a[0], czw = ft.a[2], R = ft.b[0];
                const T = SF.terrain, P = window.__gfx.proj;
                // Local uphill at wherever the imp actually wound up.
                const lg = window.__gfx.grad(cxw, czw);
                const c = P(cxw, T.heightAt(cxw, czw), czw);
                const u = P(cxw + lg.ux * 2,
                            T.heightAt(cxw + lg.ux * 2, czw + lg.uz * 2),
                            czw + lg.uz * 2);
                const rim = P(cxw + lg.ux * R,
                              T.heightAt(cxw + lg.ux * R, czw + lg.uz * R)
                                  + 0.12,
                              czw + lg.uz * R);
                const pts = [];
                for (let k = 0; k < 24; k++) {
                    const a2 = k / 24 * Math.PI * 2;
                    const px2 = cxw + Math.cos(a2) * R;
                    const pz2 = czw + Math.sin(a2) * R;
                    const pp = P(px2, T.heightAt(px2, pz2) + 0.12, pz2);
                    pts.push([pp[0], pp[1]]);
                }
                return { center_px: [c[0], c[1]],
                         up_px: [u[0] - c[0], u[1] - c[1]],
                         rim_up_px: [rim[0], rim[1]],
                         ring_pts_px: pts,
                         world_center: [cxw, czw], radius_m: R,
                         local_grade: +lg.g.toFixed(3),
                         fill: ft.a[3] };
            }"""
            out["telegraph"] = shoot(
                "telegraph", tele_trigger, [sx, sz, ux, uz],
                "SNOWFLOW.fxTelegraph.enabled = false",
                "(() => { SNOWFLOW.fxTelegraph.enabled = true;"
                " SNOWFLOW.combat.enemies.clear();"
                " SNOWFLOW.S.freezeTime = false; return true; })()")

            br.close()
    finally:
        srv.terminate()

    print(json.dumps(out, indent=1))

    if args.after:
        fails = []
        for name in ("arc", "castring", "telegraph"):
            r = out.get(name, {})
            if "err" in r:
                fails.append(f"{name}: trigger error {r['err']}")
                continue
            # The circles gate on visible EXTENT around the band (immune to
            # the foreshortening a downhill vantage puts on the uphill arc);
            # the arc sector has no clean band, so it gates on raw pixels.
            ratio = r.get("extent_ratio_up_over_down",
                          r["ratio_up_over_down"])
            if not (ratio > 0.5):
                fails.append(f"{name}: uphill/downhill visible ratio "
                             f"{ratio} <= 0.5")
            if r["draw_delta_on_minus_off"] != 1:
                fails.append(f"{name}: draw delta "
                             f"{r['draw_delta_on_minus_off']} != 1")
            rim = r.get("rim_uphill_min_dist_px")
            if name in ("castring", "telegraph") and rim is not None \
                    and rim > 30:
                fails.append(f"{name}: uphill rim {rim}px from nearest "
                             "effect pixel (> 30)")
        if fails:
            print("GATE FAIL:\n  " + "\n  ".join(fails))
            sys.exit(1)
        print("GATE PASS: all three systems conform on the measured slope")


if __name__ == "__main__":
    main()
