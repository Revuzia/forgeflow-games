#!/usr/bin/env python
"""player_camwall - P3.1 third-person camera wall pull-in (lane PLAYER, wave 4; owner decision D3 = yes).

For each map a standard match is loaded, the human lands (protected) and the kernel loop is frozen; everything below is driven by
stepped frames, so nothing waits on rAF. The probe is INDEPENDENT of the game's camera code: it re-derives the eye from the actor and
tests the camera against every static box collider with its own slab test.

  (1) SAFETY: at N covered spots (a roof box above the floor loot point: houses, towers, overpasses; plus 4 offsets that stay under
      the roof) x 4 yaws x 3 pitches x 4 frames, the lens is never INSIDE a wall box and the eye->lens segment never crosses one
      (boxes shrunk 3 cm; trunks/barrels narrower than 2 m excluded, as in the game). A teleported spot that wedges the player's
      0.3 m capsule more than 5 cm into a wall box (a place movement never allows) is skipped and counted (wedgedSpots).
  (2) NEGATIVE CONTROL: the same sweep with W.noCamWall = true must produce violations (else the probe measures nothing).
  (3) OPEN FIELD: a flat spot with no collider within 30 m and a 90-frame turn: the wall state is idle on every frame (f == 1, not
      pulled), the lens sits exactly on the free boom, and the camera does not heave vertically.
  (4) EASE OUT / SNAP IN: with the free camera held still the wall is switched off (target 1) and on again: the kept fraction recovers
      slowly (< 10 % of the gap after 1 frame, < 40 % after 6, 63 % within 20-45 frames, >= 95 % after 160, monotone) and drops back to
      the safe value within ONE frame.
  (5) NEVER ROTATES: in blocked configs the camera orientation with the wall on equals the wall-off orientation (<= 0.002 rad) while
      the lens moves more than 5 cm.
  (6) the body is hidden while the lens is within 0.75 m of the eye and shown again beyond 0.95 m.
  (7) queryColliders: the pull-in's own calls (counted by caller name on the stack) are exactly 1 per frame when on and 0 when off, and
      no frame exceeds 150 calls in total (ON/OFF interleaved; the difference of the totals is information).
  (8) 0 console/page/window errors, 0 failed requests, 0 shader errors, 0 [rig] lines.
Exit 0 pass / 1 fail / 2 could-not-judge.
    python _harness/new/player_camwall.py --isolate           # or --disk for the whole working copy
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402
import player_lib as PL  # noqa: E402

PROBE_JS = r"""() => {
  const Cn = window.__LC__, W = Cn.W, p = W.player, cam = W.camera;
  const EPS = 0.03;
  const ok = (c) => c.kind === 'box' && !c.dead && !(c.prop != null && c.maxX - c.minX < 2.0);
  const walls = W.map.colliders.filter(ok);
  // deterministic PRNG (the probe must not depend on Math.random)
  let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const step = (n) => Cn.stepFrames(n, 1 / 60, false);
  const eyeOf = () => ({ x: p.obj.position.x, y: p.obj.position.y + p._eyeY, z: p.obj.position.z });
  const inBox = (x, y, z, c, e) => x > c.minX + e && x < c.maxX - e && y > c.minY + e && y < c.maxY - e && z > c.minZ + e && z < c.maxZ - e;
  // independent slab test: does segment a->b cross the box shrunk by e? (touching the boundary does not count)
  function segCross(ax, ay, az, bx, by, bz, c, e) {
    let t0 = 0, t1 = 1; const d = [bx - ax, by - ay, bz - az], o = [ax, ay, az];
    const lo = [c.minX + e, c.minY + e, c.minZ + e], hi = [c.maxX - e, c.maxY - e, c.maxZ - e];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-12) { if (o[i] <= lo[i] || o[i] >= hi[i]) return false; continue; }
      let a = (lo[i] - o[i]) / d[i], b = (hi[i] - o[i]) / d[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 >= t1) return false;
    }
    return true;
  }
  function checkFrame(out, tag) {
    const e = eyeOf(), cp = cam.position, st = W._camWall;
    out.frames++;
    if (st.pulled) out.pulledFrames++;
    out.minDist = Math.min(out.minDist, st.dist || 1e9);
    let bad = null;
    for (const c of walls) {
      if (Math.abs(c.minX - e.x) > 40 && Math.abs(c.maxX - e.x) > 40) continue;
      // a wall that CONTAINS the eye (a teleported test position wedged into a thin slab) has no meaningful 'behind': counted, not judged
      if (inBox(e.x, e.y, e.z, c, EPS)) { out.eyeInWallFrames++; continue; }
      if (inBox(cp.x, cp.y, cp.z, c, EPS)) { bad = 'inside'; }
      else if (segCross(e.x, e.y, e.z, cp.x, cp.y, cp.z, c, EPS)) { bad = 'behind'; }
      if (bad) { out.violations++; if (out.examples.length < 4) out.examples.push({ tag, bad, eye: [e.x, e.y, e.z].map((v) => +v.toFixed(2)), cam: [cp.x, cp.y, cp.z].map((v) => +v.toFixed(2)), box: [c.minX, c.maxX, c.minY, c.maxY, c.minZ, c.maxZ].map((v) => +v.toFixed(2)), f: +st.f.toFixed(3) }); break; }
    }
  }
  function teleport(x, y, z) {
    p.pos.set(x, y, z); p.obj.position.copy(p.pos); p._pp.copy(p.pos); p.vel.set(0, 0, 0);
    p.hp = 100; p.shield = 100;
  }
  function look(yaw, pitch) { p.input.yaw = yaw; p.input.pitch = pitch; p.yaw = yaw; p.pitch = pitch; }
  const covered = (x, y, z) => W.map.colliders.some((c) => ok(c) && x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && c.minY > y + 2.0 && c.minY < y + 7);
  function spots(maxN) {
    const lp = W.map.lootPoints.filter((q) => covered(q.x, q.y, q.z));
    // seeded shuffle
    for (let i = lp.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = lp[i]; lp[i] = lp[j]; lp[j] = t; }
    const out = [];
    for (const q of lp.slice(0, maxN)) {
      out.push([q.x, q.y + 0.1, q.z]);
      for (const [ox, oz] of [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]]) if (covered(q.x + ox, q.y, q.z + oz)) out.push([q.x + ox, q.y + 0.1, q.z + oz]);
    }
    return { out, coveredLoot: lp.length };
  }
  // A TELEPORTED test position can wedge the player's body into a wall, which normal movement never allows (the 0.3 m capsule is
  // blocked by every wall box in its height band). Such a spot is not a place a player can stand: it is skipped and counted.
  // (Wave-4 run 1 on deepwood: an eye 3 cm INSIDE a thin head-height slab gave 19 "inside" frames at one spot.)
  function wedged() {
    const x = p.obj.position.x, z = p.obj.position.z, fy = p.obj.position.y, R = 0.3, PEN = 0.05;
    for (const c of walls) {
      if (c.maxY <= fy + 0.2 || c.minY >= fy + 1.8) continue;
      const qx = Math.max(c.minX, Math.min(x, c.maxX)), qz = Math.max(c.minZ, Math.min(z, c.maxZ));
      if (Math.hypot(x - qx, z - qz) < R - PEN) return true;
    }
    return false;
  }
  window.__PL_CAM__ = { W, p, cam, walls, step, eyeOf, checkFrame, teleport, look, spots, covered, wedged };
  return { walls: walls.length, lootPoints: W.map.lootPoints.length };
}"""

SWEEP_JS = r"""([nHouses, noWall]) => {
  const { W, p, cam, step, checkFrame, teleport, look, spots, wedged } = window.__PL_CAM__;
  W.noCamWall = !!noWall;
  const sp = spots(nHouses);
  const out = { spots: sp.out.length, coveredLoot: sp.coveredLoot, configs: 0, frames: 0, pulledFrames: 0, pulledConfigs: 0, violations: 0, eyeInWallFrames: 0, minDist: 1e9, examples: [], hidden: { close: 0, closeHidden: 0, far: 0, farShown: 0 }, wedgedSpots: 0, usedSpots: 0 };
  const YAWS = [0, Math.PI / 2, Math.PI, Math.PI * 1.5], PITCH = [-0.35, 0, 0.5];
  for (const s of sp.out) {
    teleport(s[0], s[1], s[2]); look(0, 0); step(8);
    if (wedged()) { out.wedgedSpots++; continue; }
    out.usedSpots++;
    for (const yaw of YAWS) for (const pit of PITCH) {
      look(yaw, pit);
      let pulled = false;
      for (let i = 0; i < 4; i++) {
        step(1); checkFrame(out, 'y' + yaw.toFixed(2) + 'p' + pit);
        const st = W._camWall;
        if (st.pulled) pulled = true;
        const vis = p.rig.scene.visible;
        if (st.pulled && st.dist < 0.75) { out.hidden.close++; if (!vis) out.hidden.closeHidden++; }
        if (st.dist > 0.96 || !st.pulled) { out.hidden.far++; if (vis) out.hidden.farShown++; }
      }
      out.configs++; if (pulled) out.pulledConfigs++;
    }
  }
  W.noCamWall = false;
  return out;
}"""

OPEN_JS = r"""() => {
  const { W, p, cam, step, teleport, look, eyeOf } = window.__PL_CAM__;
  // an open spot: no collider (any kind) within 30 m horizontally, on land, flat
  let spot = null; let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const H = W.map.half * 0.5;
  for (let i = 0; i < 4000 && !spot; i++) {
    const x = (rnd() * 2 - 1) * H, z = (rnd() * 2 - 1) * H, y = W.map.heightAt(x, z);
    if (y < (W.map.waterY || 0) + 1.5) continue;
    if (W.map.queryColliders(x, z, 30).length) continue;
    let flat = true; for (const [dx, dz] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) if (Math.abs(W.map.heightAt(x + dx, z + dz) - y) > 0.8) { flat = false; break; }
    if (flat) spot = [x, y + 0.1, z];
  }
  if (!spot) return { spot: null };
  const run = (noWall) => {
    W.noCamWall = noWall;
    teleport(spot[0], spot[1], spot[2]); look(0.3, 0.1); step(70);
    const rec = [];
    let idle = true, maxDy = 0, prevDy = null, maxLenErr = 0;
    for (let i = 0; i < 90; i++) {
      look(0.3 + i * (4 * Math.PI / 180), 0.1);
      W.camShake = 0;                       // bots shooting the (protected) player would shake the lens and blur the A/B
      step(1);
      const e = eyeOf(), cp = cam.position;
      rec.push([cp.x, cp.y, cp.z]);
      const st = W._camWall;
      if (!noWall) {
        if (st.f !== 1 || st.pulled) idle = false;
        // the lens sits exactly on the free boom: distance eye->lens == the free length the camera computed
        const dist = Math.hypot(cp.x - e.x, cp.y - e.y, cp.z - e.z);
        maxLenErr = Math.max(maxLenErr, Math.abs(dist - st.free));
      }
      const dy = cp.y - e.y; if (prevDy != null) maxDy = Math.max(maxDy, Math.abs(dy - prevDy)); prevDy = dy;
    }
    return { rec, idle, maxDy, maxLenErr };
  };
  const a = run(false), b = run(true);
  W.noCamWall = false;
  let maxDiff = 0; for (let i = 0; i < a.rec.length; i++) for (let k = 0; k < 3; k++) maxDiff = Math.max(maxDiff, Math.abs(a.rec[i][k] - b.rec[i][k]));
  return { spot: spot.map((v) => +v.toFixed(1)), idle: a.idle, lensOnFreeBoomErr: a.maxLenErr, maxFrameToFrameDy: +a.maxDy.toFixed(4), frames: a.rec.length,
           infoDiffToWallOffRun: maxDiff };
}"""

EASE_JS = r"""() => {
  const { W, p, cam, step, teleport, look, spots } = window.__PL_CAM__;
  // The free camera F must NOT move while the ease is measured (a camera more than 4 m adrift snaps, and the wall fraction with it, by
  // design), so the wall is switched off and on instead of the view being turned: off = the safe fraction is 1 again, on = it jumps back.
  const sp = spots(12).out; const res = [];
  for (const s of sp) {
    teleport(s[0], s[1], s[2]); look(0, 0); step(8);
    for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      W.noCamWall = false; look(yaw, 0); step(45); W.camShake = 0;
      const st = W._camWall;
      if (!(st.target < 0.6)) continue;
      const f0 = st.f;
      W.noCamWall = true;
      const fr = [];
      for (let i = 0; i < 160; i++) { step(1); fr.push(W._camWall.f); }
      const gap = 1 - f0;
      const frames63 = fr.findIndex((v) => (v - f0) / gap >= 0.632) + 1;
      const rec = { spot: s.map((v) => +v.toFixed(1)), yaw: +yaw.toFixed(2), f0: +f0.toFixed(3), recov1: +((fr[0] - f0) / gap).toFixed(3), recov6: +((fr[5] - f0) / gap).toFixed(3),
                    recov160: +((fr[159] - f0) / gap).toFixed(3), frames63, monotone: fr.every((v, i) => i === 0 || v >= fr[i - 1] - 1e-9) };
      W.noCamWall = false; step(1);
      const st2 = W._camWall;
      rec.snapGap = +Math.abs(st2.f - st2.target).toFixed(4); rec.snapF = +st2.f.toFixed(3);
      res.push(rec);
      if (res.length >= 4) return res;
    }
  }
  return res;
}"""

ROT_JS = r"""() => {
  const { W, p, cam, step, teleport, look, spots } = window.__PL_CAM__;
  const sp = spots(8).out; const out = { tested: 0, maxAngle: 0, minPosDiff: 1e9 };
  const q = (a) => ({ x: a.x, y: a.y, z: a.z, w: a.w });
  for (const s of sp) {
    teleport(s[0], s[1], s[2]); look(0, 0); step(8);
    for (const yaw of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      W.noCamWall = false; look(yaw, 0.1); step(40); W.camShake = 0;
      if (!(W._camWall.f < 0.9)) continue;
      W.camShake = 0; step(1);
      const qa = q(cam.quaternion), pa = cam.position.clone();
      // wall off: the lens EASES out (that is the point), so give it a second; the free camera does not move meanwhile
      W.noCamWall = true;
      for (let i = 0; i < 60; i++) { W.camShake = 0; step(1); }
      const qb = q(cam.quaternion), pb = cam.position.clone();
      W.noCamWall = false;
      const dot = Math.abs(qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w);
      const ang = 2 * Math.acos(Math.min(1, dot));
      out.tested++; out.maxAngle = Math.max(out.maxAngle, ang); out.minPosDiff = Math.min(out.minPosDiff, pa.distanceTo(pb));
    }
  }
  W.noCamWall = false;
  return out;
}"""

QUERY_JS = r"""() => {
  const { W, p, step, teleport, look, spots } = window.__PL_CAM__;
  // ON and OFF frames are INTERLEAVED in one run (same world, same bots, same positions). The pull-in's OWN calls are counted exactly
  // (the caller's name on the stack); the ON-OFF difference of the totals is information only (bot brains, deaths and the sim's
  // staggered work land on alternate frames, so it wandered 0.88-1.27 between runs).
  const mc = W.map.queryColliders; let n = 0, own = 0;
  W.map.queryColliders = function () { n++; if (/camWall/.test(new Error().stack || '')) own++; return mc.apply(this, arguments); };
  const sp = spots(3).out.slice(0, 6); let sumOn = 0, nOn = 0, sumOff = 0, nOff = 0, mx = 0, ownOnMax = 0, ownOnMin = 1e9, ownOffMax = 0;
  for (const s of sp) {
    teleport(s[0], s[1], s[2]); look(0.5, 0); step(6);
    for (let i = 0; i < 40; i++) {
      const on = (i % 2) === 0; W.noCamWall = !on; n = 0; own = 0; step(1);
      if (on) { sumOn += n; nOn++; ownOnMax = Math.max(ownOnMax, own); ownOnMin = Math.min(ownOnMin, own); } else { sumOff += n; nOff++; ownOffMax = Math.max(ownOffMax, own); }
      mx = Math.max(mx, n);
    }
  }
  W.map.queryColliders = mc; W.noCamWall = false;
  const a = sumOn / Math.max(1, nOn), b = sumOff / Math.max(1, nOff);
  return { perFrameWallOn: +a.toFixed(2), perFrameWallOff: +b.toFixed(2), addedInfo: +(a - b).toFixed(2), ownPerFrameOn: [ownOnMin, ownOnMax], ownPerFrameOffMax: ownOffMax,
           maxInOneFrame: mx, frames: nOn + nOff };
}"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    PL.add_args(ap)
    ap.add_argument("--maps", default=",".join(C.MAPS), help="comma list (default all 3)")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--houses", type=int, default=10, help="covered floor-loot spots per map (each adds up to 4 offsets)")
    args = ap.parse_args()
    PL.prepare(args)
    maps = [m for m in args.maps.split(",") if m]

    def body(v):
        control_viol = 0
        diag_all = []
        for mid in maps:
            with C.Session(args, "player_camwall_" + mid) as s:
                PL.overlay(s, args)
                PL.served_note(v, args)
                s.boot()
                s.start_match("standard", args.seed, mid)
                s.guard_player(True)
                v.info("%s land" % mid, s.land(120, protect=True))
                s.freeze_loop()
                s.step_frames(10, 1 / 60, render=False)
                info = s.js(PROBE_JS)
                v.info("%s probe setup" % mid, info)
                on = s.js(SWEEP_JS, [args.houses, False])
                v.info("%s sweep (wall pull-in ON)" % mid, {k: on[k] for k in ("spots", "usedSpots", "wedgedSpots", "coveredLoot", "configs", "frames", "pulledConfigs", "pulledFrames", "violations", "eyeInWallFrames", "minDist", "hidden")})
                if on["usedSpots"] == 0:
                    v.cnj("%s: camera never inside or behind a wall" % mid, "no covered spot found on this seed/map (loot points under a roof: %s)" % on.get("coveredLoot"))
                else:
                    v.check("%s: the lens is never inside or behind a wall (%d configs, %d frames, %d spots; %d wedged teleports skipped)" % (mid, on["configs"], on["frames"], on["usedSpots"], on["wedgedSpots"]),
                            on["violations"] == 0, {"violations": on["violations"], "examples": on["examples"]})
                    v.check("%s: the pull-in actually engaged (some configs were blocked)" % mid, on["pulledConfigs"] > 0,
                            {"pulledConfigs": on["pulledConfigs"], "configs": on["configs"], "minDist": round(on["minDist"], 2)})
                    h = on["hidden"]
                    v.check("%s: body hidden while the lens is < 0.75 m from the eye, shown when free" % mid,
                            h["closeHidden"] == h["close"] and h["farShown"] == h["far"], h)
                off = s.js(SWEEP_JS, [args.houses, True])
                v.info("%s CONTROL sweep (W.noCamWall = true)" % mid, {k: off[k] for k in ("configs", "frames", "violations", "examples")})
                control_viol += off["violations"]
                op = s.js(OPEN_JS)
                v.info("%s open field" % mid, op)
                if not op.get("spot"):
                    v.cnj("%s: open field idle" % mid, "no open flat spot with no collider within 30 m")
                else:
                    v.check("%s: open field: wall state idle on all %d turn frames, the lens sits exactly on the free boom, no vertical heave (< 0.05 m/frame)" % (mid, op["frames"]),
                            op["idle"] and op["lensOnFreeBoomErr"] <= 1e-6 and op["maxFrameToFrameDy"] < 0.05, op)
                ea = s.js(EASE_JS)
                v.info("%s ease samples" % mid, ea)
                if not ea:
                    v.cnj("%s: snap in / ease out" % mid, "no covered spot with a wall-blocked yaw (target < 0.6)")
                else:
                    good = all(e["recov1"] < 0.1 and e["recov6"] < 0.4 and e["recov160"] >= 0.95 and e["monotone"] and 20 <= e["frames63"] <= 45 and e["snapGap"] < 0.03 for e in ea)
                    v.check("%s: ease out slowly (<10%% of the gap after 1 frame, <40%% after 6, 63%% in 20-45 frames = ~0.45 s, >=95%% after 160, monotone), snap in within one frame" % mid, good, ea)
                ro = s.js(ROT_JS)
                v.info("%s rotation" % mid, ro)
                if not ro["tested"]:
                    v.cnj("%s: orientation unchanged by the pull-in" % mid, "no blocked config to compare")
                else:
                    v.check("%s: never rotates: orientation equals the wall-off orientation (<= 0.002 rad) while the lens moves > 5 cm" % mid,
                            ro["maxAngle"] <= 0.002 and ro["minPosDiff"] > 0.05, ro)
                qy = s.js(QUERY_JS)
                v.info("%s queryColliders per frame" % mid, qy)
                v.check("%s: the pull-in makes exactly 1 queryColliders call per frame (0 when off; counted by caller) and no frame exceeds 150 in total" % mid,
                        qy["ownPerFrameOn"] == [1, 1] and qy["ownPerFrameOffMax"] == 0 and qy["maxInOneFrame"] <= 150, qy)
                s.guard_player(False)
                d = s.diagnostics()
                diag_all.append(d)
                v.check("%s: 0 console errors" % mid, not d["consoleErrors"], d["consoleErrors"][:5])
                v.check("%s: 0 page / window errors" % mid, not (d["pageErrors"] or d["windowErrors"]), (d["pageErrors"] + d["windowErrors"])[:5])
                v.check("%s: 0 failed requests" % mid, not d["failedRequests"], d["failedRequests"][:8])
                v.check("%s: 0 shader errors, 0 [rig] lines" % mid, not d["shader"] and not d["rigWarnings"], (d["shader"] + d["rigWarnings"])[:4])
        v.check("NEGATIVE CONTROL: with the pull-in switched off the sweep DOES find lens-in-wall frames (the probe can see the fault)", control_viol > 0,
                {"controlViolations": control_viol})
        v.data["diagnostics"] = diag_all
    return C.run_gate("player_camwall", body, args)


if __name__ == "__main__":
    sys.exit(main())
