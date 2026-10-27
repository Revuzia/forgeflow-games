#!/usr/bin/env python
"""hitbox - LC-22 bone-driven hit volumes (P2-D lane sim), judged BLACK-BOX: real pistol shots at a practice range dummy, each shot's own line (the
'tracer' the round flew) against the DRAWN body (the dummy's skinned meshes, skinned on the CPU into a static copy, the exact pose on screen), and the
sim's verdict = whether the dummy took the round. Plan gate: "no body hit more than 0.06 m outside the bone silhouette; head-top + 0.1 m misses".

    python _harness/p23/hitbox.py --disk
    python _harness/p23/hitbox.py --rev 9aa2b746                # control: the P2 base (a 0.57 m cylinder) - MUST FAIL (outside row)
    python _harness/p23/hitbox.py --disk --plant fat            # every measured hit radius x 1.6 (K.HITVOL radii) - MUST FAIL (outside row)
    python _harness/p23/hitbox.py --disk --plant thin           # every measured hit radius x 0.4 - MUST FAIL (coverage row)
    python _harness/p23/hitbox.py --lanes sim                   # validation: lane sim's work served over the base

PRACTICE (Savanna seed 4242), loop frozen, frames stepped. The dummy is held 16 m from the player; four views (front, right side, back, 45 deg)
x a raster of PARALLEL shot lines at ~3 cm over its box (+ a 0.25 m margin), each line starting 3 m in front of the dummy and flying straight at
it. Each shot is a REAL pistol round: the player fires (cooldown cleared, one fire edge) and the round weapons.js launches is re-aimed in its own
'tracer' event (launch time, before its first step) onto the line - position, velocity (same speed), no drop - so the game's projectile step and
hit test resolve exactly that line (black-box: the sim's verdict = whether the dummy took the round). Truth per line: the dummy's skinned meshes
skinned on the CPU in the pose DRAWN at that shot (re-skinned whenever a bone moved > 1 mm). Earlier versions aimed the player instead (a camera-
angle raster, then a calibrated aim map): a third-person round flies eye -> crosshair world point and the camera follows with lag, so lines
scattered by 0.09-5.1 m from their targets (hitbox_all2 / pl_hitbox_fat, 10-26) and the static pose snapshot drifted under thousands of idle
frames - the verdicts were noise. Each line: does it cross the drawn mesh; does any of 8 lines offset 0.06 m around it, or do all 8 (deep inside).
Rows:
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
    # every measured hit radius scaled - the per-skin RADII AND the per-hold / per-gait HRADII rows the lane now looks up first (the first 10 values;
    # an 11th is a thigh fraction, not a radius): pl_hitbox_fat2 / thin2 10-26 scaled RADII only and changed nothing on the pistol dummy
    "fat": "const sc = (r) => { if (Array.isArray(r)) for (let i = 0; i < Math.min(10, r.length); i++) r[i] *= 1.6; }; if (K.HITVOL) { for (const k in (K.HITVOL.RADII || {})) sc(K.HITVOL.RADII[k]);"
           " for (const sk in (K.HITVOL.HRADII || {})) for (const h in K.HITVOL.HRADII[sk]) sc(K.HITVOL.HRADII[sk][h]); }",
    "thin": "const sc = (r) => { if (Array.isArray(r)) for (let i = 0; i < Math.min(10, r.length); i++) r[i] *= 0.4; }; if (K.HITVOL) { for (const k in (K.HITVOL.RADII || {})) sc(K.HITVOL.RADII[k]);"
            " for (const sk in (K.HITVOL.HRADII || {})) for (const h in K.HITVOL.HRADII[sk]) sc(K.HITVOL.HRADII[sk][h]); }",
}

SETUP_JS = r"""([dist]) => { const C = window.__LC__, W = C.W, K = W.SIM, T = W.THREE, p = W.player, d = W.rangeDummies && W.rangeDummies[0]; if (!d || !d.obj) return { err: 'no dummy' };
  K.WEAPONS.pistol.spreadDeg = 1e-5;
  const Q = window.__P23H__ = { d, line: null, got: 0 };
  // the ROUND itself (the pooled projectile weapons.js launches: ownerId, position, velocity; 'tracer' fires inside launchRound, before the round's
  // first step): re-aimed onto the wanted line, same speed, no drop. The cosmetic dash (no ownerId) is left alone.
  W.events.on('tracer', (q) => { const L = Q.line; if (!L || !q || q.ownerId !== p.id || q.vx == null) return;
    const sp = Math.hypot(q.vx, q.vy, q.vz) || 300; q.x = L[0]; q.y = L[1]; q.z = L[2]; q.vx = L[3] * sp; q.vy = L[4] * sp; q.vz = L[5] * sp; q.gravity = 0;
    if (q.origin) { q.origin.x = L[0]; q.origin.y = L[1]; q.origin.z = L[2]; } Q.line = null; Q.got++; });
  return { ok: true }; }"""
# place the dummy at `dist` m in front of the player facing `face` (rad), and the skinning helper (the pose drawn NOW -> one static triangle soup)
POSE_JS = r"""([dist, face]) => { const C = window.__LC__, W = C.W, T = W.THREE, p = W.player, Q = window.__P23H__, d = Q.d;
  const x = p.pos.x, z = p.pos.z - dist; d.pos.set(x, W.map.heightAt(x, z), z); d.vel.set(0, 0, 0); d.yaw = face; if (d.obj) { d.obj.position.copy(d.pos); d.obj.rotation.y = face; }
  d.hp = 1e6; d.shield = 0; d.alive = true; C.stepFrames(3, 1 / 60, true);
  Q.skin = () => { d.obj.updateMatrixWorld(true); const v = new T.Vector3(); let skinned = 0; const pos = Q._pos || (Q._pos = []); pos.length = 0;
    d.obj.traverse((o) => { if (!(o.isMesh && o.visible !== false && o.geometry && o.geometry.attributes.position) || !o.isSkinnedMesh) return; skinned++;
      const g = o.geometry, P = g.attributes.position, idx = g.index; const n = idx ? idx.count : P.count;
      for (let i = 0; i < n; i++) { const k = idx ? idx.getX(i) : i; v.fromBufferAttribute(P, k); o.applyBoneTransform(k, v); v.applyMatrix4(o.matrixWorld); pos.push(v.x, v.y, v.z); } });
    const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.computeBoundingBox(); geo.computeBoundingSphere();
    if (Q.mesh) Q.mesh.geometry.dispose(); Q.mesh = new T.Mesh(geo, Q.mat || (Q.mat = new T.MeshBasicMaterial({ side: T.DoubleSide }))); Q.mesh.updateMatrixWorld(true);
    Q.reskins = (Q.reskins || 0) + 1; return skinned; };
  // a pose signature: every bone's world position (re-skin when any moved > 1 mm)
  Q.sig = () => { const out = []; d.obj.updateMatrixWorld(true); d.obj.traverse((o) => { if (o.isBone) out.push(o.matrixWorld.elements[12], o.matrixWorld.elements[13], o.matrixWorld.elements[14]); }); return out; };
  Q.ray = Q.ray || new T.Raycaster(); Q.reskins = 0;
  const skinned = Q.skin(); Q.lastSig = Q.sig();
  const bb = Q.mesh.geometry.boundingBox; return { skinned, tris: Q._pos.length / 9, box: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].map((x) => +x.toFixed(3)) }; }"""
# raster: parallel lines along -Z (from the player's side) over the dummy's box, one REAL round per line (see the docstring)
RASTER_JS = r"""([step, margin, headTop]) => { const C = window.__LC__, W = C.W, T = W.THREE, p = W.player, Q = window.__P23H__, d = Q.d, P = window.__H_PUMP__;
  const bb0 = Q.mesh.geometry.boundingBox.clone(); const z0 = bb0.max.z + 3;
  const ray = (ox, oy, oz, dx, dy, dz) => { Q.ray.set(new T.Vector3(ox, oy, oz), new T.Vector3(dx, dy, dz).normalize()); Q.ray.far = 10; return Q.ray.intersectObject(Q.mesh, false).length > 0; };
  const fly = Math.max(3, Math.ceil(6 / ((W.SIM.WEAPONS.pistol.speed || 300) / 60)) + 1);   // the line starts 3 m out: >= 6 m of flight
  let miss = 0;
  const shoot = (X, Y) => { p.recoilPitch = 0; p.recoilYaw = 0; p._rcBase = null; p.vel.set(0, 0, 0);
    if (p.weapon) { p.weapon.cd = 0; p.weapon.magAmmo = 12; p.weapon.state = 'ready'; }
    const before = d.dummyDamage || 0; Q.line = [X, Y, z0, 0, 0, -1]; const g0 = Q.got; W._fireEdge = performance.now();
    P.step(1, 1 / 60, false);
    if (Q.got === g0) { Q.line = null; miss++; return null; }          // no round left the gun this frame
    // the pose drawn in the frame the round flew (re-skinned when a bone moved)
    const sg = Q.sig(); let moved = sg.length !== Q.lastSig.length; for (let i = 0; !moved && i < sg.length; i++) if (Math.abs(sg[i] - Q.lastSig[i]) > 0.001) moved = true;
    if (moved) { Q.skin(); Q.lastSig = sg; }
    for (let f = 1; f < fly; f++) P.step(1, 1 / 60, false);
    const sim = (d.dummyDamage || 0) > before; d.hp = 1e6; d.shield = 0; d.alive = true;
    return sim; };
  const xs = []; for (let x = bb0.min.x - margin; x <= bb0.max.x + margin + 1e-9; x += step) xs.push(x);
  const ys = []; if (headTop) ys.push(bb0.max.y + 0.1); else for (let y = bb0.min.y - margin; y <= bb0.max.y + margin + 1e-9; y += step) ys.push(y);
  const out = [];
  for (const Y of ys) for (const X of xs) {
    const sim = shoot(X, Y); if (sim === null) { if (miss > 20 && out.length === 0) return { err: 'no round left the gun', miss }; continue; }
    const c = ray(X, Y, z0, 0, 0, -1);
    let off = 0; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; if (ray(X + Math.cos(a) * 0.06, Y + Math.sin(a) * 0.06, z0, 0, 0, -1)) off++; }
    out.push([sim ? 1 : 0, c ? 1 : 0, off, +(X - d.pos.x).toFixed(3), +(Y - d.pos.y).toFixed(3)]);
  }
  const w = d.weapon && d.weapon.id, K = W.SIM;
  return { n: out.length, rows: out, grid: [xs.length, ys.length], noRound: miss, reskins: Q.reskins, stepM: step,
           target: { id: d.id, skin: d.skin || null, weapon: w || null, crouch: !!d.crouching, pitch: +(d.pitch || 0).toFixed(3) } }; }"""

def plot_view(rows, name, step):
    """a PNG per view (the harness _reports/p23_shots/): grey = the drawn body only, green = body + sim hit, red = a sim hit > 0.06 m outside the
    drawn body, blue = a deep-inside line the sim missed - the picture to LOOK at next to the counts"""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return
    d = os.path.join(C.REPORTS, "p23_shots")
    os.makedirs(d, exist_ok=True)
    fig, ax = plt.subplots(figsize=(4, 7), dpi=110)
    cols = {"body": [], "hit": [], "out": [], "miss": [], "edge": []}
    for h, c, off, x, y in rows:
        if h and not c and off == 0:
            cols["out"].append((x, y))
        elif c and off == 8 and not h:
            cols["miss"].append((x, y))
        elif h:
            cols["hit"].append((x, y))
        elif c:
            cols["body"].append((x, y))
    for k, colr in (("body", "#bbbbbb"), ("hit", "#3cb043"), ("out", "#e02020"), ("miss", "#2050e0")):
        if cols[k]:
            xs, ys = zip(*cols[k])
            ax.scatter(xs, ys, s=max(2, step * 400), c=colr, marker="s", linewidths=0, label="%s (%d)" % (k, len(cols[k])))
    ax.set_aspect("equal")
    ax.set_title("hitbox %s: body / hit / OUTSIDE / deep MISSED" % name, fontsize=8)
    ax.legend(fontsize=6, loc="upper right")
    fig.tight_layout()
    fig.savefig(os.path.join(d, "hitbox_%s.png" % name))
    plt.close(fig)


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
                    v.cnj("outside [%s]" % name, "raster: %s" % r)
                    continue
                rows = r["rows"]
                outside = sum(1 for h, c, off, _x, _y in rows if h and not c and off == 0)
                deep = [(h, c, off) for h, c, off, _x, _y in rows if c and off == 8]
                plot_view(rows, name, args.step)
                # where they are (feet-relative metres: x across the view, y up), for the sim lane
                where = {"outside": [[x, y] for h, c, off, x, y in rows if h and not c and off == 0][:15],
                         "deepMissed": [[x, y] for h, c, off, x, y in rows if c and off == 8 and not h][:15]}
                cov = sum(1 for h, _c, _o in deep if h) / len(deep) if deep else None
                res[name] = {"shots": r["n"], "simHits": sum(x[0] for x in rows), "meshHits": sum(x[1] for x in rows), "outsideBy6cm": outside,
                             "deep": len(deep), "coverage": cov and round(cov, 4), "box": pose["box"], "grid": r.get("grid"), "noRound": r.get("noRound"), "reskins": r.get("reskins"),
                             "target": r.get("target"), "where": where}
                v.check("outside [%s] (sim hits > 0.06 m outside the drawn silhouette = 0)" % name, r["n"] > 400 and outside == 0, res[name], "0")
                v.check("coverage [%s] (lines deep inside the silhouette: >= 95 %% sim hits)" % name, cov is not None and cov >= 0.95, {"deep": len(deep), "coverage": res[name]["coverage"]}, ">= 0.95")
            s.js(POSE_JS, [16, 0.0])
            ht = s.js(RASTER_JS, [min(args.step, 0.03), 0.10, True])     # the head-top row at a 3 cm step whatever --step (a coarse control run fired 16 < 20)
            if ht.get("err"):
                v.cnj("head-top", "raster: %s" % ht)
                ht = {"n": 0, "rows": []}
            hits = sum(x[0] for x in ht["rows"])
            res["headTop"] = {"shots": ht["n"], "simHits": hits}
            v.check("head-top (shots at the drawn head top + 0.10 m: 0 sim hits)", ht["n"] >= 20 and hits == 0, res["headTop"], "0")
            v.data["views"] = res
            L.errors_row(v, s)
    return C.run_gate("p23_hitbox", body, args)


if __name__ == "__main__":
    sys.exit(main())
