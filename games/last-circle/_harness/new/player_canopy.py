#!/usr/bin/env python
"""player_canopy - P2.6 ram-air canopy replaces the dome (lane PLAYER, wave 4).

SESSION A (the shipped assets): a standard match, a REAL Space press deploys the human's canopy during the glide.
  * W._playerProbe.canopy(): state "loaded", the triangle and line-segment counts canopy.json declares (tris, lines/2), span as declared
  * the actors group still holds exactly ONE actor-chute InstancedMesh and ONE actor-chute-lines LineSegments, the chute material still
    carries vertexColors + the lcChuteGore program key, and the canopy geometry has a colour attribute whose red channel is a 0/1 mask
  * every deployed canopy is drawn by that one mesh (count == deployed chutes) and the line buffer matches (draw range = chutes x len(lines) vertices)
  * 0 console / page / window errors, 0 failed requests, 0 shader errors, 0 [rig] lines
  * four screenshots of the human's canopy (game camera, side, front-below, top) saved to _shots (or --shots)
SESSION B (fallback): canopy.json answers 404 -> state "absent", the dome is still in use (a few hundred triangles), the match loads and plays,
  exactly ONE failed request (the json), 0 page / window errors.
Exit 0 pass / 1 fail / 2 could-not-judge.
    python _harness/new/player_canopy.py --isolate
"""
from __future__ import annotations

import argparse
import base64
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402
import player_lib as PL  # noqa: E402

STRUCT_JS = r"""() => {
  const W = window.__LC__.W, P = W._playerProbe;
  const g = W.group('actors');
  const meshes = [], lines = [];
  g.traverse((o) => { if (o.name === 'actor-chute') meshes.push(o); if (o.name === 'actor-chute-lines') lines.push(o); });
  const m = meshes[0], l = lines[0];
  const col = m && m.geometry.attributes.color;
  let mask01 = null;
  if (col) { let lo = 1e9, hi = -1e9, mid = 0; for (let i = 0; i < col.count; i++) { const r = col.getX(i); lo = Math.min(lo, r); hi = Math.max(hi, r); if (r > 0.02 && r < 0.98) mid++; } mask01 = { lo, hi, fractional: mid, verts: col.count }; }
  const deployed = W.actors.filter((a) => a.chute).length;
  return {
    canopy: P.canopy(), instancedMeshes: meshes.length, lineSegmentsObjs: lines.length,
    meshIsInstanced: !!(m && m.isInstancedMesh), lineIsSegments: !!(l && l.isLineSegments),
    vertexColors: !!(m && m.material.vertexColors), progKey: m && m.material.customProgramCacheKey ? m.material.customProgramCacheKey() : null,
    meshCount: m ? m.count : null, deployed, lineDrawRange: l ? l.geometry.drawRange.count : null,
    triangles: m && m.geometry.index ? m.geometry.index.count / 3 : null, vertsPerMesh: m ? m.geometry.attributes.position.count : null,
    attrs: m ? Object.keys(m.geometry.attributes) : null, mask01,
  };
}"""

GLIDEKILL_JS = r"""() => {
  const W = window.__LC__.W, P = W._playerProbe;
  const g = W.actors.filter((a) => a.alive && a.chute && a !== W.player && !a.isDummy && a.rig);
  if (!g.length) return { error: 'no bot under a canopy' };
  const v = g[0];
  const before = W.actors.filter((a) => a.chute).length;
  v.hp = 1; v.shield = 0;
  W.hurtActor(v, 999, W.player.id, 'ar', false);
  window.__PL_GV__ = v;
  return Object.assign({ id: v.id, alive: v.alive, chutesBefore: before, chutesAfter: W.actors.filter((a) => a.chute).length,
                         rotX: v.obj.rotation.x, rotZ: v.obj.rotation.z, y: v.obj.position.y }, P.corpse(v));
}"""

GLIDEKILL_STATE_JS = r"""() => { const v = window.__PL_GV__, P = window.__LC__.W._playerProbe;
  return Object.assign({ y: v.obj.position.y, rotX: v.obj.rotation.x }, P.corpse(v)); }"""

# Every deployed canopy hangs FROM ITS BODY: the riser ends (the odd vertices of each instance's line pairs) sit on the body's
# shoulders (the mid-point of the two clavicle bones) and the canopy frame is upright (its +Y axis . world up). Independent of the
# game's placement maths: bones are read from the skeleton, the lines from the GPU-bound buffer.
HANG_JS = r"""() => {
  const W = window.__LC__.W, g = W.group('actors'); const V = W.camera.position.constructor;
  let m = null, l = null; g.traverse((o) => { if (o.name === 'actor-chute') m = o; if (o.name === 'actor-chute-lines') l = o; });
  if (!m || !l || !m.count) return { error: 'no canopy drawn' };
  const per = l.geometry.drawRange.count / m.count, pos = l.geometry.attributes.position.array;
  const cents = [];
  for (let n = 0; n < m.count; n++) {
    let x = 0, y = 0, z = 0, k = 0;
    for (let v = n * per + 1; v < (n + 1) * per; v += 2) { x += pos[v * 3]; y += pos[v * 3 + 1]; z += pos[v * 3 + 2]; k++; }
    const M = new m.matrixWorld.constructor(); m.getMatrixAt(n, M); const e = M.elements;
    const ylen = Math.hypot(e[4], e[5], e[6]) || 1;
    cents.push({ x: x / k, y: y / k, z: z / k, up: e[5] / ylen });
  }
  const out = [];
  const a1 = new V(), a2 = new V();
  for (const a of W.actors) {
    if (!a.chute || !a.rig) continue;
    let ls = null, rs = null; a.rig.scene.traverse((o) => { if (o.isBone && /LeftShoulder$/.test(o.name)) ls = o; if (o.isBone && /RightShoulder$/.test(o.name)) rs = o; });
    if (!ls || !rs) continue;
    a.obj.updateMatrixWorld(true); ls.getWorldPosition(a1); rs.getWorldPosition(a2);
    const sx = (a1.x + a2.x) / 2, sy = (a1.y + a2.y) / 2, sz = (a1.z + a2.z) / 2;
    let best = null, bd = 1e9;
    for (const c of cents) { const d = Math.hypot(c.x - sx, c.y - sy, c.z - sz); if (d < bd) { bd = d; best = c; } }
    out.push({ id: a.id, yawDeg: Math.round(((a.obj.rotation.y * 180 / Math.PI) % 360 + 360) % 360), tiltX: +a._tiltX.toFixed(3), riserToShoulders: +bd.toFixed(3), up: +best.up.toFixed(4) });
  }
  return { instances: m.count, perInstance: per, actors: out };
}"""

VIEWS_JS = r"""([name, dist, yawOff, pitch, fov]) => {
  const W = window.__LC__.W, k = W.kernel, cam = W.camera, p = W.player;
  const c = p.obj.position;
  const cx = c.x, cy = c.y + 3.2, cz = c.z;           // the canopy centre (3.2 m above the feet)
  const base = p.obj.rotation.y;                      // the body's facing (the canopy's nose points the same way)
  const ang = base + yawOff;
  cam.fov = fov || 50; cam.updateProjectionMatrix();
  cam.position.set(cx + Math.sin(ang) * dist, cy + dist * Math.sin(pitch), cz + Math.cos(ang) * dist * Math.cos(pitch));
  cam.lookAt(cx, cy - 0.7, cz); cam.updateMatrixWorld(true);
  if (k.composer) k.composer.render(0.016); else k.renderer.render(k.scene, cam);
  return k.renderer.domElement.toDataURL('image/png');
}"""


def declared(args):
    """what canopy.json (the file the page is served) declares: triangles, segments, span"""
    import json
    root = getattr(args, "overlay_root", None) or C.ROOT
    with open(os.path.join(root, "assets", "props", "canopy.json"), encoding="utf-8") as f:
        d = json.load(f)
    return {"tris": int(d.get("tris") or 0), "segments": len(d["lines"]) // 2, "verts": len(d["lines"]), "span": float(d.get("span") or 0)}


def run_session_a(args, v):
    dec = declared(args)
    v.info("canopy.json declares", dec)
    with C.Session(args, "player_canopy_A") as s:
        PL.overlay(s, args)
        PL.served_note(v, args)
        s.boot()
        r = s.start_match("standard", args.seed, args.map)
        v.info("match", r)
        s.freeze_loop()
        s.step_frames(20, 1 / 60, render=False)
        # a REAL Space deploys the human's canopy (player.js toggles on the keydown while gliding)
        s.page.keyboard.press("Space")
        s.step_frames(60, 1 / 60, render=False)
        for _ in range(3):
            if s.js("() => !!window.__LC__.W.player.chute"):
                break
            s.page.keyboard.press("Space")
            s.step_frames(30, 1 / 60, render=False)
        s.step_frames(30, 1 / 60, render=True)
        st = s.js(STRUCT_JS)
        v.info("structure", st)
        cn = st["canopy"]
        v.check("canopy state is loaded", cn.get("state") == "loaded", cn)
        v.check("canopy triangles / line segments / span as canopy.json declares (%d tris, %d segments, %.3f m)" % (dec["tris"], dec["segments"], dec["span"]),
                cn.get("state") == "loaded" and st["triangles"] == dec["tris"] and cn["lines"] == dec["segments"] and abs(cn.get("span", 0) - dec["span"]) < 1e-6,
                {"triangles": st["triangles"], "lines": cn.get("lines"), "span": cn.get("span"), "declared": dec})
        v.check("still ONE InstancedMesh and ONE LineSegments for every canopy", st["instancedMeshes"] == 1 and st["lineSegmentsObjs"] == 1 and st["meshIsInstanced"] and st["lineIsSegments"],
                {k: st[k] for k in ("instancedMeshes", "lineSegmentsObjs", "meshIsInstanced", "lineIsSegments")})
        v.check("chute material unchanged: vertexColors + the lcChuteGore program key", st["vertexColors"] and st["progKey"] == "lcChuteGore", {"vc": st["vertexColors"], "key": st["progKey"]})
        mk = st["mask01"]
        v.check("canopy colour attribute carries the gore mask (red 0..1, both ends present)", bool(mk) and mk["lo"] <= 0.02 and mk["hi"] >= 0.98, mk)
        v.check("every deployed canopy is one instance and the line batch matches (draw range = chutes x %d vertices)" % dec["verts"],
                st["deployed"] >= 1 and st["meshCount"] == st["deployed"] and st["lineDrawRange"] == st["deployed"] * dec["verts"],
                {k: st[k] for k in ("deployed", "meshCount", "lineDrawRange")})
        hg = s.js(HANG_JS)
        v.info("canopy hang (riser ends vs the body's shoulders)", hg)
        if hg.get("error") or not hg.get("actors"):
            v.cnj("every canopy hangs from its body's shoulders, upright", hg.get("error") or "no deployed actor measured")
        else:
            worst = max(x["riserToShoulders"] for x in hg["actors"])
            v.check("every deployed canopy hangs from its body: riser ends within 0.35 m of the shoulders (%d canopies, worst %.3f m), frame upright (up . Y >= 0.97)"
                    % (len(hg["actors"]), worst), worst <= 0.35 and all(x["up"] >= 0.97 for x in hg["actors"]), hg["actors"][:12])
        shots = args.shots or C.SHOTS
        os.makedirs(shots, exist_ok=True)
        # the game's OWN third-person camera under the canopy (one stepped, rendered frame; HUD is DOM, not in the canvas)
        gpth = os.path.join(shots, "player_canopy_gamecam.png")
        s.canvas_png(gpth, "window.__LC__.stepFrames(1, 1 / 60, true)")
        v.info("shot", gpth)
        for name, dist, yaw, pitch, fov in (("rear_above", 13.0, 0.0, 0.5, 50), ("side", 13.0, 1.5708, 0.1, 50), ("front_below", 13.0, 3.1416, -0.35, 50), ("top", 14.0, 0.0, 1.3, 50)):
            url = s.js(VIEWS_JS, [name, dist, yaw, pitch, fov])
            pth = os.path.join(shots, "player_canopy_%s.png" % name)
            with open(pth, "wb") as f:
                f.write(base64.b64decode(url.split(",", 1)[1]))
            v.info("shot", pth)
        # a bot killed UNDER ITS CANOPY: the canopy goes with it (no canopy riding a corpse), the skydive tilt is levelled,
        # and the body drops toward the ground on sim time instead of hanging in the sky
        gk = s.js(GLIDEKILL_JS)
        for _ in range(30):
            if not gk.get("error"):
                break
            s.step_frames(30, 1 / 60, render=False)
            gk = s.js(GLIDEKILL_JS)
        v.info("glide kill", gk)
        if gk.get("error"):
            v.cnj("a bot killed under its canopy drops it and falls", gk["error"])
        else:
            s.step_frames(30, 1 / 60, render=False)
            g1 = s.js(GLIDEKILL_STATE_JS)
            v.info("glide kill +0.5 s", g1)
            v.check("a bot killed under its canopy: canopy removed, tilt levelled, the body falls (0.5 s later lower, still falling or landed)",
                    (not gk["alive"]) and gk["chutesAfter"] == gk["chutesBefore"] - 1 and not gk["chute"] and abs(gk["rotX"]) < 1e-9 and abs(gk["rotZ"]) < 1e-9
                    and gk["fall"] and g1["y"] < gk["y"] - 0.5, {"kill": gk, "after": g1})
        d = s.diagnostics()
        v.data["diagnosticsA"] = d
        C.print_diagnostics(d)
        v.check("A: 0 console errors", not d["consoleErrors"], d["consoleErrors"][:5])
        v.check("A: 0 page / window errors", not (d["pageErrors"] or d["windowErrors"]), (d["pageErrors"] + d["windowErrors"])[:5])
        v.check("A: 0 failed requests", not d["failedRequests"], d["failedRequests"][:8])
        v.check("A: 0 shader errors, 0 [rig] lines", not d["shader"] and not d["rigWarnings"], (d["shader"] + d["rigWarnings"])[:4])


def run_session_b(args, v):
    with C.Session(args, "player_canopy_B") as s:
        PL.overlay(s, args)
        s.start_blocked = True

        def deny(route):
            route.fulfill(status=404, body="Not found", headers={"Cache-Control": "no-store"})

        s.context.route(lambda url: "/assets/props/canopy." in url, deny)
        s.boot()
        s.start_match("standard", args.seed, args.map)
        s.freeze_loop()
        s.step_frames(20, 1 / 60, render=False)
        s.page.keyboard.press("Space")
        s.step_frames(60, 1 / 60, render=True)
        st = s.js(STRUCT_JS)
        cn = st["canopy"]
        v.info("B structure", st)
        v.check("B: canopy.json 404 -> state absent and the dome is still the canopy (< 400 triangles, 6 line segments)",
                cn.get("state") == "absent" and st["triangles"] is not None and st["triangles"] < 400 and st["lineDrawRange"] == st["deployed"] * 12,
                {"state": cn.get("state"), "triangles": st["triangles"], "deployed": st["deployed"], "lineDrawRange": st["lineDrawRange"]})
        d = s.diagnostics()
        v.data["diagnosticsB"] = d
        v.check("B: exactly ONE failed request (the canopy.json probe)", len(d["failedRequests"]) == 1 and "canopy.json" in d["failedRequests"][0], d["failedRequests"][:4])
        v.check("B: 0 page / window errors, 0 shader errors", not (d["pageErrors"] or d["windowErrors"] or d["shader"]), (d["pageErrors"] + d["windowErrors"] + d["shader"])[:4])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    PL.add_args(ap)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--map", default="isla_viva", choices=C.MAPS)
    ap.add_argument("--shots", default=None)
    ap.add_argument("--skip-fallback", action="store_true")
    args = ap.parse_args()
    PL.prepare(args)

    def body(v):
        run_session_a(args, v)
        if not args.skip_fallback:
            run_session_b(args, v)
    return C.run_gate("player_canopy", body, args)


if __name__ == "__main__":
    sys.exit(main())
