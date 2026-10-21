#!/usr/bin/env python
"""move - P2-A movement + camera gates (lane player; plan P2-A "Gates"): LC-21 slide, LC-31 shoulder swap + crosshair truth on both shoulders,
LC-10 combat strafe foot skate (the audit probe F:/lc_p23/harness/src_probes/audit/probe_feet.py + probe_lc10.py promoted).

    python _harness/p23/move.py --disk
    python _harness/p23/move.py --rev 9aa2b746                  # control: the P2 base (no slide, no swap, strafes skate 2.7x) - MUST FAIL
    python _harness/p23/move.py --disk --plant slide-flat       # W.events 'slideStart' still fires but the body keeps sprint speed (velocity
                                                                # clamped to K.MOVE.sprint every frame) - MUST FAIL (slide row)
    python _harness/p23/move.py --disk --plant no-swap          # the V key event swallowed before the game sees it - MUST FAIL (shoulder row)
    python _harness/p23/move.py --lanes player                  # validation: lane player's work served over the base

PRACTICE (Savanna seed 4242), REAL keys / mouse (pointer locked), loop frozen, rendered frames stepped at 60 Hz:
  slide        SHIFT (sprint toggle) + W for 1.5 s, then a C tap: peak horizontal speed 9.5 +- 0.3 m/s, down to <= 4.4 m/s 0.7-0.9 s after the peak
  shoulder     the camera's offset along the player's right: +0.70 +- 0.02 m (hip), a real V tap -> -0.70 +- 0.02 m within 0.25 s; V again -> back
  crosshair    a range dummy 20 m ahead under the crosshair; a real LMB pistol shot on EACH shoulder: the shot's line passes within 0.10 m of the
               point the camera centre ray hits (no parallax miss on either side)
  skate [ads]  ADS held (RMB): planted-foot skate strafing right / left <= 1.25 x the forward skate                    (today 2.68-2.78x)
  skate [hip]  combat hip (just fired): the same <= 1.25 x                                                             (today 2.2x)
  errors
"""
from __future__ import annotations

import argparse
import math
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "slide-flat": "W.kernel._updaters.unshift(() => { const p = W.player, m = K.MOVE.sprint; if (!p) return; const v = Math.hypot(p.vel.x, p.vel.z); if (v > m) { p.vel.x *= m / v; p.vel.z *= m / v; } })",
    "no-swap": "window.addEventListener('keydown', (e) => { if (e.code === 'KeyV') e.stopImmediatePropagation(); }, true)",
}
SKATE_MAX = 1.25

TRACE_JS = r"""([n, render]) => { const C = window.__LC__, W = C.W, p = W.player, P = window.__H_PUMP__; const B = p.armBones || {}; const v = p.obj.position.clone(); const tr = [];
  for (let i = 0; i < n; i++) { P.step(1, 1 / 60, !!render);
    const r = { t: +W.t.toFixed(4), x: p.pos.x, z: p.pos.z, ox: p.obj.position.x, oy: p.obj.position.y, oz: p.obj.position.z, vx: p.vel.x, vz: p.vel.z, anim: p.anim };
    for (const k of ['lFoot', 'rFoot']) { const b = B[k]; if (!b) continue; b.updateWorldMatrix(true, false); v.setFromMatrixPosition(b.matrixWorld); r[k] = [v.x, v.y, v.z]; }
    const cam = W.camera, yaw = p.input.yaw; r.camRight = (cam.position.x - p.obj.position.x) * Math.cos(yaw) - (cam.position.z - p.obj.position.z) * Math.sin(yaw);
    tr.push(r); }
  return tr; }"""


def skate(tr):
    if not tr or "lFoot" not in tr[0]:
        return None
    lo = {k: min(r[k][1] - r["oy"] for r in tr) for k in ("lFoot", "rFoot")}
    out = []
    for i in range(1, len(tr)):
        a, b = tr[i - 1], tr[i]
        dt = b["t"] - a["t"]
        if dt <= 0:
            continue
        k = "lFoot" if (b["lFoot"][1] - b["oy"]) < (b["rFoot"][1] - b["oy"]) else "rFoot"
        if (b[k][1] - b["oy"]) - lo[k] > 0.03:
            continue
        out.append(math.hypot(b[k][0] - a[k][0], b[k][2] - a[k][2]) / dt)
    return round(statistics.median(out), 3) if len(out) >= 10 else None


def release(s):
    for k in ("KeyW", "KeyA", "KeyS", "KeyD", "KeyC", "ShiftLeft"):
        try:
            s.page.keyboard.up(k)
        except Exception:
            pass
    s.page.mouse.up(button="right")
    s.js("() => { const W = window.__LC__.W; W._sprintLatch = false; W._rmbDown = false; W.player.vel.set(0, 0, 0); }")
    s.step_frames(30, 1 / 60)


def level_spot(s, spot):
    s.js("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z); p.vel.set(0, 0, 0); p.input.yaw = 0; p.input.pitch = 0; if (p.obj) p.obj.position.copy(p.pos); }",
         [spot["x"], spot["z"]])
    s.step_frames(20, 1 / 60)


def part_slide(s, v, spot):
    level_spot(s, {"x": spot["x"], "z": spot["z"] + 9})          # the run goes -z through the cleared radius
    s.press("ShiftLeft")
    s.page.keyboard.down("KeyW")
    s.step_frames(90, 1 / 60)
    pre = s.js(TRACE_JS, [1, False])[0]
    s.page.keyboard.down("KeyC")
    tr = s.js(TRACE_JS, [2, False])
    s.page.keyboard.up("KeyC")
    tr += s.js(TRACE_JS, [100, False])
    release(s)
    sp = [(r["t"], math.hypot(r["vx"], r["vz"])) for r in tr]
    pk_i = max(range(len(sp)), key=lambda i: sp[i][1])
    pk_t, pk = sp[pk_i]
    down = next((t for t, x in sp[pk_i:] if x <= 4.4), None)
    dec = None if down is None else round(down - pk_t, 3)
    v.data["slide"] = {"preSpeed": round(math.hypot(pre["vx"], pre["vz"]), 2), "peak": round(pk, 3), "decayS": dec, "curve": [round(x, 2) for _, x in sp[::6]]}
    v.check("slide (sprint + C: peak 9.5 +- 0.3 m/s, <= 4.4 m/s 0.7-0.9 s after the peak)", abs(pk - 9.5) <= 0.3 and dec is not None and 0.7 <= dec <= 0.9,
            v.data["slide"], "peak 9.2-9.8, decay 0.7-0.9 s")


def part_shoulder(s, v, spot):
    level_spot(s, spot)
    s.step_frames(30, 1 / 60, render=True)
    r0 = s.js(TRACE_JS, [1, True])[0]["camRight"]
    s.press("KeyV")
    tr = s.js(TRACE_JS, [30, True])
    t0 = tr[0]["t"] - 1 / 60
    at = next((r["t"] - t0 for r in tr if abs(r["camRight"] + 0.70) <= 0.02), None)
    r1 = tr[-1]["camRight"]
    s.press("KeyV")
    tr2 = s.js(TRACE_JS, [30, True])
    r2 = tr2[-1]["camRight"]
    v.data["shoulder"] = {"before": round(r0, 3), "within": at and round(at, 3), "after": round(r1, 3), "back": round(r2, 3)}
    v.check("shoulder (camera right offset +0.70 -> V -> -0.70 +- 0.02 within 0.25 s -> V -> +0.70)",
            abs(r0 - 0.70) <= 0.02 and at is not None and at <= 0.25 + 1e-6 and abs(r1 + 0.70) <= 0.02 and abs(r2 - 0.70) <= 0.02, v.data["shoulder"], "+0.70 / -0.70 by 0.25 s / +0.70")


AIM_DUMMY_JS = r"""([dist]) => { const C = window.__LC__, W = C.W, p = W.player, d = W.rangeDummies && W.rangeDummies[0]; if (!d) return null;
  const x = p.pos.x, z = p.pos.z - dist; d.pos.set(x, W.map.heightAt(x, z), z); d.vel.set(0, 0, 0); if (d.obj) d.obj.position.copy(d.pos); d.hp = 100; d.shield = 100; d.alive = true;
  const V = W.camera.position.constructor, dir = new V(); const tx = d.pos.x, ty = d.pos.y + 1.25, tz = d.pos.z;
  for (let i = 0; i < 24; i++) { C.stepFrames(1, 1 / 60, true); W.camera.updateMatrixWorld(true); W.camera.getWorldDirection(dir); const o = W.camera.position;
    const vx = tx - o.x, vy = ty - o.y, vz = tz - o.z, Lh = Math.hypot(vx, vy, vz);
    let ey = Math.atan2(-vx, -vz) - Math.atan2(-dir.x, -dir.z); while (ey > Math.PI) ey -= 2 * Math.PI; while (ey < -Math.PI) ey += 2 * Math.PI;
    p.input.yaw += ey; p.input.pitch += Math.asin(vy / Lh) - Math.asin(dir.y); }
  W.camera.updateMatrixWorld(true); W.camera.getWorldDirection(dir); const o = W.camera.position; const K = W.SIM;
  const ar = K.aimRayDist(o.x, o.y, o.z, dir.x, dir.y, dir.z, 0.5, 400, (a, b) => W.map.heightAt(a, b), (a, b, r, q) => W.map.queryColliders(a, b, r, q), []);
  return { cam: [o.x, o.y, o.z], dir: [dir.x, dir.y, dir.z], aimD: ar, target: [tx, ty, tz] }; }"""


def part_crosshair(s, v, spot):
    level_spot(s, spot)
    s.js("() => { const W = window.__LC__.W, p = W.player; window.__P23X__ = []; W.events.on('shotFired', (a, w, m, d) => { if (a === p && m && d) window.__P23X__.push({ m: [m.x, m.y, m.z], d: [d.x, d.y, d.z] }); }); }")
    s.press("Digit1")
    s.step_frames(40, 1 / 60)
    res = {}
    for side in ("right", "left"):
        if side == "left":
            s.press("KeyV")
            s.step_frames(30, 1 / 60, render=True)
        aim = s.js(AIM_DUMMY_JS, [20])
        if not aim:
            v.cnj("crosshair (both shoulders)", "no range dummy")
            return
        s.js("() => { window.__P23X__.length = 0; const p = window.__LC__.W.player; if (p.weapon) { p.weapon.magAmmo = 12; p.weapon.state = 'ready'; p.weapon.cd = 0; } }")
        s.page.mouse.down(button="left")
        s.step_frames(1, 1 / 60, render=True)
        s.page.mouse.up(button="left")
        s.step_frames(2, 1 / 60)
        shot = s.js("() => window.__P23X__[0] || null")
        miss = None
        if shot and aim["aimD"]:
            P = [aim["cam"][i] + aim["dir"][i] * aim["aimD"] for i in range(3)]
            m, d = shot["m"], shot["d"]
            n = math.sqrt(sum(x * x for x in d)) or 1
            d = [x / n for x in d]
            w = [P[i] - m[i] for i in range(3)]
            tt = sum(w[i] * d[i] for i in range(3))
            miss = math.sqrt(sum((w[i] - tt * d[i]) ** 2 for i in range(3)))
        res[side] = {"missM": miss and round(miss, 4), "aimD": aim["aimD"] and round(aim["aimD"], 2)}
        s.step_frames(30, 1 / 60)
    s.press("KeyV")
    s.step_frames(20, 1 / 60)
    v.data["crosshair"] = res
    v.check("crosshair (pistol shot line within 0.10 m of the camera-ray point, both shoulders)", all((res.get(k) or {}).get("missM") is not None and res[k]["missM"] <= 0.10 for k in ("right", "left")),
            res, "<= 0.10 m")


def part_skate(s, v, spot):
    s.js("() => { const p = window.__LC__.W.player; p.inventory.slots[1] = { kind: 'weapon', id: 'ar', rarity: 0, mag: 30 }; p.inventory.ammo.medium = 999; }")
    s.press("Digit2")
    s.step_frames(40, 1 / 60)
    out = {}
    for stance in ("ads", "hip"):
        segs = {}
        for name, key in (("fwd", "KeyW"), ("right", "KeyD"), ("left", "KeyA")):
            level_spot(s, spot)
            if stance == "ads":
                s.page.mouse.down(button="right")
            else:
                s.js("() => { const W = window.__LC__.W; W.player.lastShotT = W.t + 30; }")
            s.page.keyboard.down(key)
            s.js(TRACE_JS, [45, True])
            segs[name] = skate(s.js(TRACE_JS, [150, True]))
            release(s)
        f = segs["fwd"]
        ratios = {k: (round(segs[k] / f, 3) if f and segs[k] is not None else None) for k in ("right", "left")}
        out[stance] = {"skate": segs, "ratio": ratios}
        v.check("skate [%s] (strafe planted-foot skate <= %.2f x forward)" % (stance, SKATE_MAX), all(r is not None and r <= SKATE_MAX for r in ratios.values()),
                out[stance], "<= %.2f" % SKATE_MAX)
    v.data["skate"] = out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--parts", default="slide,shoulder,crosshair,skate")
    args = L.parse(ap)
    parts = args.parts.split(",")

    def body(v):
        with C.Session(args, "p23_move") as s:
            v.data["setup"] = L.practice(s, 4242, "ashgrid")
            spot = L.flat_spot(s, clear=10.0)
            v.data["spot"] = spot
            if not spot:
                v.cnj("slide", "no open flat ground near the practice spawn")
                return
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            L.lock_pointer(s)
            for p in parts:
                {"slide": part_slide, "shoulder": part_shoulder, "crosshair": part_crosshair, "skate": part_skate}[p](s, v, spot)
            L.errors_row(v, s)
    return C.run_gate("p23_move", body, args)


if __name__ == "__main__":
    sys.exit(main())
