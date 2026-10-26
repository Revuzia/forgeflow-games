#!/usr/bin/env python
"""hitbox - LC-22 bone-driven hit volumes (P2-D lane sim), judged BLACK-BOX: real pistol shots at a practice range dummy, each shot's own line (the
'tracer' the round flew) against the DRAWN body (the dummy's skinned meshes, skinned on the CPU into a static copy, the exact pose on screen), and the
sim's verdict = whether the dummy took the round. Plan gate: "no body hit more than 0.06 m outside the bone silhouette; head-top + 0.1 m misses".

    python _harness/p23/hitbox.py --disk
    python _harness/p23/hitbox.py --rev 9aa2b746                # control: the P2 base (a 0.57 m cylinder) - MUST FAIL (outside row)
    python _harness/p23/hitbox.py --disk --plant fat            # every measured hit radius x 1.6 (K.HITVOL radii) - MUST FAIL (outside row)
    python _harness/p23/hitbox.py --disk --plant thin           # every measured hit radius x 0.4 - MUST FAIL (coverage row)
    python _harness/p23/hitbox.py --lanes sim                   # validation: lane sim's work served over the base

PRACTICE (Savanna seed 4242), loop frozen, frames stepped; the pistol's cone set to ~0 and its cooldown cleared each frame (SETUP: every shot is a
first shot along the aim). The dummy is held at 16 m; four views (front, right side, back, 45 deg) x a raster of target points at ~3 cm over
its box (+ a 0.25 m margin) on the dummy's plane, reached through an aim map calibrated from real rounds (the third-person round flies eye ->
camera-ray world point, so camera angles alone miss the body), one round at a time. Truth per shot line: does it cross the drawn mesh; and does any of 8 lines offset
0.06 m around it (outside-by-more-than-6-cm test), or do all 8 (deep inside). Rows:
  dummy        the range dummy draws skinned meshes (the truth needs a body)
  outside [v]  sim hits whose line and all 8 offset lines miss the mesh = 0 (no body hit > 0.06 m outside the silhouette)
  coverage [v] lines deep inside the silhouette (all 8 offsets cross it): >= 95 % are sim hits (a hitbox that hits nothing cannot pass)
  head-top     horizontal shots at the drawn head top + 0.10 m across the body width: 0 sim hits
  errors
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "fat": "if (K.HITVOL && K.HITVOL.RADII) for (const k in K.HITVOL.RADII) { const r = K.HITVOL.RADII[k]; if (Array.isArray(r)) for (let i = 0; i < r.length; i++) r[i] *= 1.6; }",
    "thin": "if (K.HITVOL && K.HITVOL.RADII) for (const k in K.HITVOL.RADII) { const r = K.HITVOL.RADII[k]; if (Array.isArray(r)) for (let i = 0; i < r.length; i++) r[i] *= 0.4; }",
}

SETUP_JS = r"""([dist]) => { const C = window.__LC__, W = C.W, K = W.SIM, T = W.THREE, p = W.player, d = W.rangeDummies && W.rangeDummies[0]; if (!d || !d.obj) return { err: 'no dummy' };
  K.WEAPONS.pistol.spreadDeg = 1e-5;
  const Q = window.__P23H__ = { d, shots: [] };
  // the ROUND itself (the projectile record weapons.js launches: ownerId, origin, velocity), not the cosmetic dash (no ownerId)
  // (q.x, q.y, q.z) is where the round STARTS (eye + 0.6 m along its direction, 5 cm low); q.origin is the eye, off that line: read the start
  W.events.on('tracer', (q) => { if (q && q.ownerId === p.id && Q.on && q.vx != null) Q.cur = [q.x, q.y, q.z, q.vx, q.vy, q.vz]; });
  W.events.on('shotFired', (a, wid, m, dir) => { if (a === p && Q.on) Q.m = [m.x, m.y, m.z, dir.x, dir.y, dir.z]; });
  return { ok: true }; }"""
# place the dummy at `dist` m in front of the player facing `face` (rad, relative), pre-skin its meshes into one static triangle soup
POSE_JS = r"""([dist, face]) => { const C = window.__LC__, W = C.W, T = W.THREE, p = W.player, Q = window.__P23H__, d = Q.d;
  const x = p.pos.x, z = p.pos.z - dist; d.pos.set(x, W.map.heightAt(x, z), z); d.vel.set(0, 0, 0); d.yaw = face; if (d.obj) { d.obj.position.copy(d.pos); d.obj.rotation.y = face; }
  d.hp = 1e6; d.shield = 0; d.alive = true; C.stepFrames(3, 1 / 60, true); d.obj.updateMatrixWorld(true);
  const pos = [], v = new T.Vector3(); let skinned = 0;
  d.obj.traverse((o) => { if (!(o.isMesh && o.visible !== false && o.geometry && o.geometry.attributes.position)) return; if (o.isSkinnedMesh) skinned++; else return;
    const g = o.geometry, P = g.attributes.position, idx = g.index; const n = idx ? idx.count : P.count;
    for (let i = 0; i < n; i++) { const k = idx ? idx.getX(i) : i; v.fromBufferAttribute(P, k); if (o.isSkinnedMesh) o.applyBoneTransform(k, v); v.applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); } });
  const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.computeBoundingBox(); geo.computeBoundingSphere();
  Q.mesh = new T.Mesh(geo, new T.MeshBasicMaterial({ side: T.DoubleSide })); Q.mesh.updateMatrixWorld(true); Q.ray = new T.Raycaster();
  const bb = geo.boundingBox; return { skinned, tris: pos.length / 9, box: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((x) => +x.toFixed(3)) }; }"""
# raster: shot LINES swept over the dummy. A third-person round leaves the EYE for the point the CAMERA ray meets the world (actors ignored,
# player.js aimRayDist), so camera angles do not say where a round crosses the dummy: the map (yaw, pitch) -> the round's crossing of the dummy's
# plane (z = the box centre) is CALIBRATED from real rounds (3 per region, twice: a Newton step), and the targets on that plane at `step` m are
# reached through it. Each shot: the new aim settles 3 rendered frames (the camera follows), one fire edge, the round flies to resolution.
RASTER_JS = r"""([step, margin, headTop]) => { const C = window.__LC__, W = C.W, T = W.THREE, p = W.player, Q = window.__P23H__, d = Q.d, P = window.__H_PUMP__;
  const bb = Q.mesh.geometry.boundingBox; const cam = W.camera; C.stepFrames(1, 1 / 60, true); const o = cam.position.clone();
  const cz = (bb.min.z + bb.max.z) / 2, D = Math.hypot(d.pos.x - o.x, d.pos.z - o.z);
  const fly = Math.ceil((D + 6) / (W.SIM.WEAPONS.pistol.speed || 300) * 60) + 1;
  const rayHit = (ox, oy, oz, dx, dy, dz) => { Q.ray.set(new T.Vector3(ox, oy, oz), new T.Vector3(dx, dy, dz).normalize()); Q.ray.far = 200; return Q.ray.intersectObject(Q.mesh, false).length > 0; };
  Q.on = true;
  const shoot = (yw, pt) => { p.input.yaw = yw; p.input.pitch = pt; p.recoilPitch = 0; p.recoilYaw = 0; p._rcBase = null; p.vel.set(0, 0, 0);
    if (p.weapon) { p.weapon.cd = 1; p.weapon.magAmmo = 12; p.weapon.state = 'ready'; }
    P.step(3, 1 / 60, true);                                    // the camera settles on the new aim (no shot: cd > 0)
    if (p.weapon) p.weapon.cd = 0;
    const before = d.dummyDamage || 0; Q.cur = null; Q.m = null; W._fireEdge = performance.now(); P.step(1, 1 / 60, false);
    for (let f = 1; f < fly; f++) P.step(1, 1 / 60, false);
    d.hp = 1e6; d.shield = 0; d.alive = true;
    const L = Q.cur || Q.m; if (!L) return null;
    const n = Math.hypot(L[3], L[4], L[5]); const u = [L[3] / n, L[4] / n, L[5] / n];
    const k = Math.abs(u[2]) > 1e-6 ? (cz - L[2]) / u[2] : NaN;   // where this round crosses the dummy's plane
    return { o: [L[0], L[1], L[2]], u, X: L[0] + u[0] * k, Y: L[1] + u[1] * k, sim: (d.dummyDamage || 0) > before }; };
  // calibration: J = d(X, Y) / d(yaw, pitch) around s0, then one Newton step onto the region's centre and a second J there
  const tx = (bb.min.x + bb.max.x) / 2, ty = headTop ? bb.max.y + 0.1 : (bb.min.y + bb.max.y) / 2;
  let s0 = [Math.atan2(-(tx - o.x), -(cz - o.z)), Math.atan2(ty - o.y, Math.hypot(tx - o.x, cz - o.z))], J = null, c0 = null; const h = 0.006;
  for (let it = 0; it < 2; it++) {
    const a = shoot(s0[0], s0[1]), b = shoot(s0[0] + h, s0[1]), c = shoot(s0[0], s0[1] + h); if (!a || !b || !c) { Q.on = false; return { err: 'no round to calibrate' }; }
    J = [[(b.X - a.X) / h, (c.X - a.X) / h], [(b.Y - a.Y) / h, (c.Y - a.Y) / h]]; c0 = a;
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0]; if (!(Math.abs(det) > 1e-6)) { Q.on = false; return { err: 'singular aim map', J }; }
    const ex = tx - a.X, ey = ty - a.Y; s0 = [s0[0] + (J[1][1] * ex - J[0][1] * ey) / det, s0[1] + (-J[1][0] * ex + J[0][0] * ey) / det];
    if (it === 1) c0 = { X: tx, Y: ty };
  }
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  const aimFor = (X, Y) => { const ex = X - c0.X, ey = Y - c0.Y; return [s0[0] + (J[1][1] * ex - J[0][1] * ey) / det, s0[1] + (-J[1][0] * ex + J[0][0] * ey) / det]; };
  const xs = []; for (let x = bb.min.x - margin; x <= bb.max.x + margin + 1e-9; x += step) xs.push(x);
  const ys = []; if (headTop) ys.push(bb.max.y + 0.1); else for (let y = bb.min.y - margin; y <= bb.max.y + margin + 1e-9; y += step) ys.push(y);
  const out = []; let err = 0, nErr = 0;
  for (const Y of ys) for (const X of xs) {
    const sv = aimFor(X, Y); const r = shoot(sv[0], sv[1]); if (!r) continue;
    err += Math.hypot(r.X - X, r.Y - Y); nErr++;
    const [ux, uy, uz] = r.u, [ox, oy, oz] = r.o;
    const c = rayHit(ox, oy, oz, ux, uy, uz);
    // 8 lines 0.06 m off this one, perpendicular to it
    const ax = Math.abs(uy) < 0.9 ? [0, 1, 0] : [1, 0, 0]; let e1 = [uy * ax[2] - uz * ax[1], uz * ax[0] - ux * ax[2], ux * ax[1] - uy * ax[0]]; const l1 = Math.hypot(...e1); e1 = e1.map((x) => x / l1);
    const e2 = [uy * e1[2] - uz * e1[1], uz * e1[0] - ux * e1[2], ux * e1[1] - uy * e1[0]];
    let off = 0; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, cs = Math.cos(a) * 0.06, sn = Math.sin(a) * 0.06;
      if (rayHit(ox + e1[0] * cs + e2[0] * sn, oy + e1[1] * cs + e2[1] * sn, oz + e1[2] * cs + e2[2] * sn, ux, uy, uz)) off++; }
    out.push([r.sim ? 1 : 0, c ? 1 : 0, off]);
  }
  Q.on = false; return { n: out.length, rows: out, grid: [xs.length, ys.length], aimErrM: nErr ? +(err / nErr).toFixed(4) : null, J: J.map((r) => r.map((x) => +x.toFixed(3))), stepM: step }; }"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--step", type=float, default=0.03, help="raster step at the dummy (m)")
    args = L.parse(ap)

    def body(v):
        with C.Session(args, "p23_hitbox") as s:
            v.data["setup"] = L.practice(s, 4242, "ashgrid")
            spot = L.flat_spot(s, clear=20.0, max_r=600)
            if spot:
                s.js("([x, z]) => { const W = window.__LC__.W, p = W.player; p.pos.set(x, W.map.heightAt(x, z), z + 8); p.vel.set(0, 0, 0); }", [spot["x"], spot["z"]])
            st = s.js(SETUP_JS, [16])
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            if st.get("err"):
                v.cnj("dummy", st["err"])
                return
            s.press("Digit1")
            s.step_frames(40, 1 / 60)
            res = {}
            for name, face in (("front", 0.0), ("side", 1.5708), ("back", 3.1416), ("45deg", 0.7854)):
                pose = s.js(POSE_JS, [16, face])
                if name == "front":
                    v.check("dummy (the range dummy draws skinned meshes)", pose["skinned"] > 0 and pose["tris"] > 500, pose, "skinned")
                    if not pose["skinned"]:
                        return
                r = s.js(RASTER_JS, [args.step, 0.25, False])
                if r.get("err"):
                    v.cnj("outside [%s]" % name, "aim calibration: %s" % r)
                    continue
                rows = r["rows"]
                outside = sum(1 for h, c, off in rows if h and not c and off == 0)
                deep = [(h, c, off) for h, c, off in rows if c and off == 8]
                cov = sum(1 for h, _c, _o in deep if h) / len(deep) if deep else None
                res[name] = {"shots": r["n"], "simHits": sum(x[0] for x in rows), "meshHits": sum(x[1] for x in rows), "outsideBy6cm": outside,
                             "deep": len(deep), "coverage": cov and round(cov, 4), "box": pose["box"], "grid": r.get("grid"), "aimErrM": r.get("aimErrM")}
                v.check("outside [%s] (sim hits > 0.06 m outside the drawn silhouette = 0)" % name, r["n"] > 400 and outside == 0, res[name], "0")
                v.check("coverage [%s] (lines deep inside the silhouette: >= 95 %% sim hits)" % name, cov is not None and cov >= 0.95, {"deep": len(deep), "coverage": res[name]["coverage"]}, ">= 0.95")
            s.js(POSE_JS, [16, 0.0])
            ht = s.js(RASTER_JS, [args.step, 0.10, True])
            if ht.get("err"):
                v.cnj("head-top", "aim calibration: %s" % ht)
                ht = {"n": 0, "rows": []}
            hits = sum(x[0] for x in ht["rows"])
            res["headTop"] = {"shots": ht["n"], "simHits": hits}
            v.check("head-top (shots at the drawn head top + 0.10 m: 0 sim hits)", ht["n"] >= 20 and hits == 0, res["headTop"], "0")
            v.data["views"] = res
            L.errors_row(v, s)
    return C.run_gate("p23_hitbox", body, args)


if __name__ == "__main__":
    sys.exit(main())
