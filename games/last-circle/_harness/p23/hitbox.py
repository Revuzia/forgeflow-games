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
first shot along the aim). The dummy is held at 16 m; four views (front, right side, back, 45 deg) x a yaw / pitch raster at ~3 cm over its
silhouette's angular box (+ a 0.25 m margin), one shot per frame. Truth per shot line: does it cross the drawn mesh; and does any of 8 lines offset
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
# raster: one shot per frame over the yaw / pitch box that covers the dummy's box + margin, as seen from the camera
RASTER_JS = r"""([step, margin, headTop]) => { const C = window.__LC__, W = C.W, T = W.THREE, p = W.player, Q = window.__P23H__, d = Q.d, P = window.__H_PUMP__;
  const bb = Q.mesh.geometry.boundingBox; const cam = W.camera; C.stepFrames(1, 1 / 60, true); const o = cam.position.clone();
  const corners = []; for (const X of [bb.min.x - margin, bb.max.x + margin]) for (const Y of [headTop ? bb.max.y + 0.1 : bb.min.y - margin, headTop ? bb.max.y + 0.1 : bb.max.y + margin]) for (const Z of [bb.min.z - margin, bb.max.z + margin]) corners.push([X, Y, Z]);
  const ang = corners.map(([X, Y, Z]) => { const dx = X - o.x, dy = Y - o.y, dz = Z - o.z; return [Math.atan2(-dx, -dz), Math.atan2(dy, Math.hypot(dx, dz))]; });
  const y0 = Math.min(...ang.map((a) => a[0])), y1 = Math.max(...ang.map((a) => a[0])), p0 = Math.min(...ang.map((a) => a[1])), p1 = Math.max(...ang.map((a) => a[1]));
  const D = Math.hypot(d.pos.x - o.x, d.pos.z - o.z), dA = step / D;
  // frames for one round to reach the dummy and resolve (rounds fly at the gun's speed): one shot at a time, so a hit is THIS shot's
  const fly = Math.ceil((D + 6) / (W.SIM.WEAPONS.pistol.speed || 300) * 60) + 1;
  const out = []; Q.on = true; const sp = []; const rayHit = (ox, oy, oz, dx, dy, dz) => { Q.ray.set(new T.Vector3(ox, oy, oz), new T.Vector3(dx, dy, dz).normalize()); Q.ray.far = 200; return Q.ray.intersectObject(Q.mesh, false).length > 0; };
  const pitches = headTop ? [p0] : []; if (!headTop) for (let q = p0; q <= p1; q += dA) pitches.push(q);
  for (const pt of pitches) for (let yw = y0; yw <= y1; yw += dA) {
    p.input.yaw = yw; p.input.pitch = pt; p.recoilPitch = 0; p.recoilYaw = 0; p._rcBase = null;
    if (p.weapon) { p.weapon.cd = 0; p.weapon.magAmmo = 12; p.weapon.state = 'ready'; } p.vel.set(0, 0, 0);
    const before = d.dummyDamage || 0; Q.cur = null; Q.m = null; W._fireEdge = performance.now(); P.step(1, 1 / 60, false);
    for (let f = 1; f < fly; f++) P.step(1, 1 / 60, false);
    d.hp = 1e6; d.shield = 0; d.alive = true;
    const L = Q.cur || Q.m; if (!L) continue;
    const hitSim = (d.dummyDamage || 0) > before;
    const ox = L[0], oy = L[1], oz = L[2], dx = L[3], dy = L[4], dz = L[5]; const n = Math.hypot(dx, dy, dz); const ux = dx / n, uy = dy / n, uz = dz / n;
    const c = rayHit(ox, oy, oz, ux, uy, uz);
    // 8 lines 0.06 m off this one, perpendicular to it
    const ax = Math.abs(uy) < 0.9 ? [0, 1, 0] : [1, 0, 0]; let e1 = [uy * ax[2] - uz * ax[1], uz * ax[0] - ux * ax[2], ux * ax[1] - uy * ax[0]]; const l1 = Math.hypot(...e1); e1 = e1.map((x) => x / l1);
    const e2 = [uy * e1[2] - uz * e1[1], uz * e1[0] - ux * e1[2], ux * e1[1] - uy * e1[0]];
    let off = 0; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, cs = Math.cos(a) * 0.06, sn = Math.sin(a) * 0.06;
      if (rayHit(ox + e1[0] * cs + e2[0] * sn, oy + e1[1] * cs + e2[1] * sn, oz + e1[2] * cs + e2[2] * sn, ux, uy, uz)) off++; }
    out.push([hitSim ? 1 : 0, c ? 1 : 0, off]);
  }
  Q.on = false; return { n: out.length, rows: out, box: [y0, y1, p0, p1].map((x) => +x.toFixed(4)), stepRad: +dA.toFixed(5) }; }"""


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
                rows = r["rows"]
                outside = sum(1 for h, c, off in rows if h and not c and off == 0)
                deep = [(h, c, off) for h, c, off in rows if c and off == 8]
                cov = sum(1 for h, _c, _o in deep if h) / len(deep) if deep else None
                res[name] = {"shots": r["n"], "simHits": sum(x[0] for x in rows), "meshHits": sum(x[1] for x in rows), "outsideBy6cm": outside,
                             "deep": len(deep), "coverage": cov and round(cov, 4), "box": pose["box"], "stepRad": r["stepRad"]}
                v.check("outside [%s] (sim hits > 0.06 m outside the drawn silhouette = 0)" % name, r["n"] > 400 and outside == 0, res[name], "0")
                v.check("coverage [%s] (lines deep inside the silhouette: >= 95 %% sim hits)" % name, cov is not None and cov >= 0.95, {"deep": len(deep), "coverage": res[name]["coverage"]}, ">= 0.95")
            s.js(POSE_JS, [16, 0.0])
            ht = s.js(RASTER_JS, [args.step, 0.10, True])
            hits = sum(x[0] for x in ht["rows"])
            res["headTop"] = {"shots": ht["n"], "simHits": hits}
            v.check("head-top (shots at the drawn head top + 0.10 m: 0 sim hits)", ht["n"] >= 20 and hits == 0, res["headTop"], "0")
            v.data["views"] = res
            L.errors_row(v, s)
    return C.run_gate("p23_hitbox", body, args)


if __name__ == "__main__":
    sys.exit(main())
