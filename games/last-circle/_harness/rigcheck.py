#!/usr/bin/env python
"""rigcheck - the rig as a player sees it, numerically (harness-gates G2 (a)-(e); 4 of the 7 owner-found bugs).

    python _harness/rigcheck.py                           # seeds 7,11,23 standard + one practice real-key pass
    python _harness/rigcheck.py --inject-regression       # proves the gate flips: holder re-parented in the page
    python _harness/rigcheck.py --seeds 7 --disk

Poses are read only after STEPPED VIEW FRAMES (tweens -> mixers -> updaters; common.step_frames), never after a bare
fastForward (which skips mixers and syncObj - a stale belly-down skydive reads 0.9 m tall, harness-gates E4).
Sampled: every actor within 250 m of the camera focus (player.js far-bot LOD freezes the rest, whose stale poses no
player can see), every 15 stepped frames through the glide, the canopy and the ground.

  (a) Euclidean head-bone to foot-bone distance (max over both feet) in [--span-min, --span-max] = [1.0, 2.2] m by
      default - the 9 m stretch / a collapsed rig. PLAN L1 wrote [1.3, 2.2] from the audit's 1.337-1.52 m sample; the
      first full run (2026-09-30 21:26, 7da063ad, 3 seeds, 141 rows) read 1.22-1.30 m on natural bent-leg poses
      (athlete skydive t0.2-0.8 s, juggernaut / viper just after landing t40-41 s) - a ~1.8 m human's head-to-ankle
      span with bent knees - so 1.3 flags poses, not defects. 1.0 still catches any collapse; pass --span-min 1.3 for
      the plan's band.
  (b) holder.parent === a.handBone AND holder world position within 0.05 m of the hand bone   - invisible guns
      (today exactly 0.02 m: player.js `a.hand.position.set(0, 0.02 / ws, 0)`)
  (c) barrel (holder world +Z) vs chest forward (world, from the shoulder line: up x (RightArm - LeftArm)) for armed,
      grounded, non-emoting, non-swimming actors: never backwards (dot > 0) for anyone, and for the PLAYER driven by
      REAL keys at 8 move-vs-aim offsets (W, W+D, D, S+D, S, S+A, A, W+A; pistol slot 1 and AR slot 2), out of combat
      first (>= 1.6 s of sim time after any shot) and then firing (REAL LMB): barrel . chest >= cos 60 deg (design
      basis: the 0.6 rad twist clamp + clip sway; the audit measured 0.609 for a strafing pistol), and wherever the weld
      tracks aim (rifles on the ground; pistols in combat) barrel . camera-forward >= cos 15 deg
  (d) no actor with chute && onGround && !gliding for > 0.5 s of sim time (every actor, every seed, 0.1 s samples
      through the landing) + a REAL Space-spam run (Space every 3 frames from 16 m AGL down to the ground)
  (e) a side-view PNG per weapon (the 180-degree flip is only judgeable by eye): _harness/_shots/rig_<wid>.png
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

RIG_JS = r"""(opts) => {
  const W = window.__LC__.W, THREE = W.THREE;
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), q = new THREE.Quaternion();
  W.scene.updateMatrixWorld(true);
  const focus = (W._camFocus || W.player || {}).pos || W.camera.position;
  const camF = new THREE.Vector3(); W.camera.getWorldDirection(camF);
  const rows = [];
  for (const a of W.actors) {
    if (!a || !a.alive || !a.obj || !a.rig) continue;
    if (a.pos.distanceTo(focus) > (opts.radius || 250)) continue;
    let head = null, lf = null, rf = null, la = null, ra = null;
    a.obj.traverse((o) => { if (!o.isBone) return; const n = o.name;
      if (/Head$/i.test(n) && !/HeadTop|_end$/i.test(n) && !head) head = o;   // Mixamo 'mixamorigHead' too (the old [^a-z] guard missed it)
      if (/LeftFoot$/i.test(n) && !lf) lf = o; if (/RightFoot$/i.test(n) && !rf) rf = o;
      if (/LeftArm$/i.test(n) && !la) la = o; if (/RightArm$/i.test(n) && !ra) ra = o; });
    let span = null;
    if (head && (lf || rf)) {
      const hp = head.getWorldPosition(new THREE.Vector3());
      span = Math.max(lf ? hp.distanceTo(lf.getWorldPosition(v)) : 0, rf ? hp.distanceTo(rf.getWorldPosition(v2)) : 0);
    }
    const hb = a.handBone, holder = a.hand;
    let holderToHand = null, parentOk = false;
    if (holder && hb) { parentOk = holder.parent === hb; holderToHand = holder.getWorldPosition(v).distanceTo(hb.getWorldPosition(v2)); }
    else if (holder) holderToHand = null;
    const armed = !!(a.weapon && !String(a.weapon.id).startsWith('consumable'));
    let barrelChest = null, barrelCam = null, barrelAim = null;
    if (holder && armed && la && ra) {
      holder.getWorldQuaternion(q); const b = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const L = la.getWorldPosition(new THREE.Vector3()), R = ra.getWorldPosition(new THREE.Vector3());
      const chest = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), R.sub(L)); chest.y = 0;
      const bh = b.clone(); bh.y = 0;
      if (chest.lengthSq() > 1e-8 && bh.lengthSq() > 1e-8) barrelChest = bh.normalize().dot(chest.normalize());
      barrelCam = b.dot(camF);
      const aim = new THREE.Vector3(-Math.sin(a.yaw) * Math.cos(a.pitch || 0), Math.sin(a.pitch || 0), -Math.cos(a.yaw) * Math.cos(a.pitch || 0));
      barrelAim = b.dot(aim);
    }
    // the weld's own predicate (player.js BARREL AIM): gunYaw = bodyFwdYaw + clamp(aimDelta, -0.6, 0.6), so the barrel
    // tracks the aim yaw only while |aimDelta| <= 0.6 rad (body within the twist clamp of the camera)
    const bodyFwdYaw = a._bodyYaw != null ? a._bodyYaw - Math.PI : a.yaw;
    let aimDelta = a.yaw - bodyFwdYaw; while (aimDelta > Math.PI) aimDelta -= Math.PI * 2; while (aimDelta < -Math.PI) aimDelta += Math.PI * 2;
    rows.push({ id: a.id, skin: a.skin, bot: !!a.isBot, player: a === W.player, onGround: !!a.onGround, gliding: !!a.gliding, chute: !!a.chute,
      aimDelta: +aimDelta.toFixed(3),
      swimming: !!a.swimming, emoting: !!a.emoting, crouching: !!a.crouching, weapon: a.weapon ? a.weapon.id : null, armed,
      wstate: a.weapon ? a.weapon.state : null, combat: !!(a.input && (a.input.ads || (W.t - a.lastShotT < 1.5))), armMode: a._armMode || null,
      span: span == null ? null : +span.toFixed(3), hasHead: !!head, holderParent: holder && holder.parent ? holder.parent.name : null, parentOk,
      holderToHand: holderToHand == null ? null : +holderToHand.toFixed(3),
      barrelChest: barrelChest == null ? null : +barrelChest.toFixed(3), barrelCam: barrelCam == null ? null : +barrelCam.toFixed(3),
      barrelAim: barrelAim == null ? null : +barrelAim.toFixed(3) });
  }
  return { t: +W.t.toFixed(2), phase: W.phase, rows };
}"""

CHUTE_JS = r"""(dt) => {
  const W = window.__LC__.W; const S = window.__H_CHUTE__ = window.__H_CHUTE__ || { run: {}, worst: {}, samples: 0 };
  S.samples++;
  for (const a of W.actors) { if (!a) continue;
    const bad = !!(a.alive && a.chute && a.onGround && !a.gliding);
    S.run[a.id] = bad ? (S.run[a.id] || 0) + dt : 0;
    if (S.run[a.id] > (S.worst[a.id] || 0)) S.worst[a.id] = +S.run[a.id].toFixed(2); }
  return null;
}"""

SIDE_PNG_JS = r"""() => {
  const W = window.__LC__.W, THREE = W.THREE, p = W.player, k = W.kernel;
  W.scene.updateMatrixWorld(true);
  const cam = new THREE.PerspectiveCamera(30, k.camera.aspect, 0.05, 300);
  const yaw = p._bodyYaw != null ? p._bodyYaw - Math.PI : p.yaw;
  const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const chest = p.pos.clone().add(new THREE.Vector3(0, 1.25, 0));
  cam.position.copy(chest).addScaledVector(right, 3.2).add(new THREE.Vector3(0, 0.25, 0));
  cam.lookAt(chest); cam.updateMatrixWorld(true);
  k.renderer.setRenderTarget(null);
  k.renderer.render(W.scene, cam);
  return k.renderer.domElement.toDataURL('image/png');
}"""

OFFSETS = [("W", ["KeyW"]), ("W+D", ["KeyW", "KeyD"]), ("D", ["KeyD"]), ("S+D", ["KeyS", "KeyD"]), ("S", ["KeyS"]),
           ("S+A", ["KeyS", "KeyA"]), ("A", ["KeyA"]), ("W+A", ["KeyW", "KeyA"])]
COS60 = 0.5
COS15 = math.cos(math.radians(15))


nbarrel = [0]
LOW = []          # the 5 lowest non-crouching head-to-foot spans, with where they were read (calibration evidence)
SPAN = (1.0, 2.2)


def judge_rows(v, label, rows, bad):
    """(a) + (b) + never-backwards over one sample's rows; appends violations to `bad`."""
    for r in rows:
        if r["armed"] and r["onGround"] and not r["gliding"] and r["barrelChest"] is not None:
            nbarrel[0] += 1
        if r["span"] is not None and not (SPAN[0] <= r["span"] <= SPAN[1]) and not r["crouching"]:
            bad["a"].append((label, r["id"], r["skin"], r["span"], "glide" if r["gliding"] else "ground"))
        if r["span"] is not None and not r["crouching"]:
            LOW.append((r["span"], label, r["id"], r["skin"], "glide" if r["gliding"] else ("chute" if r["chute"] else "ground")))
            LOW.sort()
            del LOW[5:]
        if r["holderToHand"] is not None or r["holderParent"]:
            if not r["parentOk"] or (r["holderToHand"] is not None and r["holderToHand"] > 0.05):
                bad["b"].append((label, r["id"], r["skin"], r["holderParent"], r["holderToHand"]))
        if (r["armed"] and r["onGround"] and not r["gliding"] and not r["swimming"] and not r["emoting"]
                and r["barrelChest"] is not None and r["barrelChest"] <= 0):
            bad["back"].append((label, r["id"], r["skin"], r["weapon"], r["barrelChest"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--seeds", default="7,11,23")
    ap.add_argument("--map", default="isla_viva")
    ap.add_argument("--inject-regression", action="store_true",
                    help="re-parent the player's weapon holder to the old chest socket in the page (the 3e1bbc34 bug) - must FAIL")
    ap.add_argument("--no-practice", action="store_true", help="skip the real-key barrel pass and the PNGs")
    ap.add_argument("--span-min", type=float, default=1.0, help="(a) lower bound, m (PLAN text: 1.3; see the docstring)")
    ap.add_argument("--span-max", type=float, default=2.2, help="(a) upper bound, m")
    args = ap.parse_args()
    global SPAN
    SPAN = (args.span_min, args.span_max)
    seeds = [int(x) for x in args.seeds.split(",") if x.strip()]

    def body(v):
        bad = {"a": [], "b": [], "back": []}
        spans, holders, nrows = [], [], 0
        with C.Session(args, "rigcheck") as s:
            s.boot()
            s.freeze_loop()
            s.install_pump()
            for seed in seeds:
                print("  seed %d ..." % seed, flush=True)
                s.js("() => { window.__H_CHUTE__ = null; }")
                s.start_match("standard", seed, args.map, enter=True)
                if args.inject_regression:
                    r = s.js("() => { const a = window.__LC__.W.player; a.obj.add(a.hand); a.hand.position.set(0.32, 1.15, 0.28); a.hand.scale.setScalar(1); return a.hand.parent.name; }")
                    v.note("INJECTED REGRESSION: the player's weapon holder re-parented to %r (the pre-3e1bbc34 chest socket)" % r)
                for i in range(6):                         # glide / canopy: 6 samples, 15 stepped frames apart
                    s.step_frames(15, 1 / 60, render=False)
                    s.js(CHUTE_JS, 0.25)
                    snap = s.js(RIG_JS, {"radius": 250})
                    judge_rows(v, "seed%d drop t%.1f" % (seed, snap["t"]), snap["rows"], bad)
                    nrows += len(snap["rows"])
                    spans += [r["span"] for r in snap["rows"] if r["span"] is not None]
                    holders += [r["holderToHand"] for r in snap["rows"] if r["holderToHand"] is not None]
                # landing: sim-level slices of 0.1 s (stepActor removes a grounded canopy; fastForward runs stepActor)
                for _ in range(900):
                    st = s.js("() => { const C = window.__LC__; C.fastForward(0.1, 1 / 30); return { phase: C.W.phase, t: C.W.t }; }")
                    s.js(CHUTE_JS, 0.1)
                    if st["phase"] == "match" and st["t"] > 40:
                        break
                for i in range(4):                         # ground: stepped view frames again
                    s.step_frames(15, 1 / 60, render=False)
                    s.js(CHUTE_JS, 0.25)
                    snap = s.js(RIG_JS, {"radius": 250})
                    judge_rows(v, "seed%d ground t%.1f" % (seed, snap["t"]), snap["rows"], bad)
                    nrows += len(snap["rows"])
                    spans += [r["span"] for r in snap["rows"] if r["span"] is not None]
                    holders += [r["holderToHand"] for r in snap["rows"] if r["holderToHand"] is not None]
                ch = s.js("() => window.__H_CHUTE__")
                worst = max((ch or {}).get("worst", {}).values() or [0])
                v.check("seed %d: no canopy on a grounded, non-gliding actor for > 0.5 s" % seed, worst <= 0.5,
                        {"worstSeconds": worst, "offenders": {k: x for k, x in (ch or {}).get("worst", {}).items() if x > 0.5}, "samples": (ch or {}).get("samples")})
            # a check with nothing measured is could-not-judge, never a vacuous pass
            if not spans:
                v.cnj("(a) head-to-foot %.1f-%.1f m on every sampled actor (non-crouching)" % SPAN, "no head/foot bone pair found on any sampled actor (%d rows)" % nrows)
            else:
                v.check("(a) head-to-foot %.1f-%.1f m on every sampled actor (non-crouching)" % SPAN, not bad["a"],
                        {"violations": bad["a"][:8], "n": len(bad["a"]), "spanRange": [min(spans), max(spans)], "measured": len(spans), "samples": nrows,
                         "lowest": LOW})
            if not holders:
                v.cnj("(b) holder parented to the hand bone and within 0.05 m of it", "no actor had a weapon holder + hand bone (%d rows)" % nrows)
            else:
                v.check("(b) holder parented to the hand bone and within 0.05 m of it", not bad["b"],
                        {"violations": bad["b"][:8], "n": len(bad["b"]), "holderToHandMax": max(holders), "measured": len(holders), "samples": nrows})
            if not nbarrel[0]:
                v.cnj("(c) no armed grounded actor holds the gun backwards (barrel . chest > 0)", "no armed grounded actor with both arm bones was sampled")
            else:
                v.check("(c) no armed grounded actor holds the gun backwards (barrel . chest > 0)", not bad["back"],
                        {"violations": bad["back"][:8], "n": len(bad["back"]), "measured": nbarrel[0]})
            if args.inject_regression or args.no_practice:
                v.info("practice pass", "skipped (%s)" % ("--inject-regression" if args.inject_regression else "--no-practice"))
                return
            # ---------------- practice: REAL keys, 8 offsets, pistol + AR; Space spam; PNGs ----------------
            s.start_match("practice", 5, args.map, enter=True)
            s.step_frames(30, 1 / 60, render=False)
            cv = s.js("() => { const c = window.__LC__.W.kernel.renderer.domElement; const r = c.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }")
            s.page.mouse.click(cv["x"], cv["y"])             # pointer lock (a swallowed shot at most)
            s.sleep(0.3)
            table = []
            for slot_key, wid in (("Digit1", "pistol"), ("Digit2", "ar")):
                s.press(slot_key)
                s.step_frames(40, 1 / 60, render=False)
                for combat in (False, True):
                    for name, keys in OFFSETS:
                        if not combat:
                            s.js("() => { const p = window.__LC__.W.player; p.lastShotT = Math.min(p.lastShotT, window.__LC__.W.t - 2); }")
                        s.hold(keys)
                        if combat:
                            s.page.mouse.down()
                            s.step_frames(4, 1 / 60, render=False)
                            s.page.mouse.up()
                            s.step_frames(26, 1 / 60, render=False)
                        else:
                            s.step_frames(30, 1 / 60, render=False)
                        snap = s.js(RIG_JS, {"radius": 5})
                        s.hold([])
                        s.step_frames(10, 1 / 60, render=False)
                        me = [r for r in snap["rows"] if r["player"]]
                        if not me:
                            continue
                        r = me[0]
                        r.update(offset=name, slot=wid, firing=combat)
                        table.append(r)
            v.data["barrelTable"] = table
            print("\n    slot    offset firing  weapon  armMode   barrel.chest  barrel.cam  aimDelta  onGround")
            for r in table:
                print("    %-7s %-6s %-6s  %-7s %-9s %12s %11s %9s  %s" % (r["slot"], r["offset"], r["firing"], r["weapon"], r["armMode"],
                                                                       r["barrelChest"], r["barrelCam"], r.get("aimDelta"), r["onGround"]))
            grounded = [r for r in table if r["onGround"] and r["armed"]]
            if len(grounded) < len(table) * 0.75:
                v.cnj("(c) real-key barrel pass", "the player was airborne/unarmed in %d of %d samples" % (len(table) - len(grounded), len(table)))
            else:
                chest_bad = [r for r in grounded if r["barrelChest"] is None or r["barrelChest"] < COS60]
                v.check("(c) real keys: barrel . chest >= cos 60 at all 8 offsets, out of combat and firing (pistol, AR)", not chest_bad,
                        [(r["slot"], r["offset"], r["firing"], r["barrelChest"]) for r in chest_bad][:10])
                # the weld tracks aim only inside the 0.6 rad twist clamp (out of combat the body turns to the run direction
                # and the gun follows the body by design - the 21:16 run read barrel . camera -0.85 for the AR running S
                # with aimDelta ~ pi); pistols out of combat carry lowReady (-0.55 rad muzzle drop, cos 30 by design)
                track = [r for r in grounded if abs(r.get("aimDelta") or 0) <= 0.62 and ((r["slot"] == "ar") or (r["slot"] == "pistol" and r["firing"]))]
                cam_bad = [r for r in track if r["barrelCam"] is None or r["barrelCam"] < COS15]
                if not track:
                    v.cnj("(c) real keys: barrel . camera >= cos 15 wherever the weld tracks aim", "no sample inside the twist clamp")
                else:
                    v.check("(c) real keys: barrel . camera >= cos 15 wherever the weld tracks aim (|aimDelta| <= 0.6 rad: AR, pistol firing)", not cam_bad,
                            {"bad": [(r["slot"], r["offset"], r["firing"], r["barrelCam"], r.get("aimDelta")) for r in cam_bad][:10], "measured": len(track)})
            # REAL Space spam near the ground (standard match: the practice mode has no glide)
            s.start_match("standard", 31, args.map, enter=True)
            s.js("() => { window.__H_CHUTE__ = null; }")
            agl = None
            for _ in range(200):
                agl = s.js("() => { const W = window.__LC__.W, p = W.player; const g = Math.max(W.map.heightAt(p.pos.x, p.pos.z), W.map.waterY); return { agl: p.pos.y - g, gliding: p.gliding }; }")
                if not agl["gliding"] or agl["agl"] <= 16:
                    break
                s.js("() => window.__LC__.fastForward(0.25, 1 / 30)")
            spam = 0
            for i in range(120):
                if i % 3 == 0:
                    s.press("Space", 0.02)
                    spam += 1
                s.step_frames(1, 1 / 60, render=False)
                s.js(CHUTE_JS, 1 / 60)
            s.step_frames(60, 1 / 60, render=False)
            for _ in range(4):
                s.js(CHUTE_JS, 0.25)
                s.step_frames(15, 1 / 60, render=False)
            ch = s.js("() => ({ worst: (window.__H_CHUTE__ || {}).worst || {}, me: (() => { const p = window.__LC__.W.player; return { chute: !!p.chute, onGround: p.onGround, gliding: p.gliding }; })() })")
            mine = ch["worst"].get(s.js("() => window.__LC__.W.player.id"), 0)
            if agl and agl.get("gliding") is False and agl.get("agl", 99) > 16:
                v.cnj("(d) REAL Space spam from <= 16 m AGL leaves no canopy on the grounded player", "the player landed before 16 m AGL was reached")
            else:
                v.check("(d) REAL Space spam from <= 16 m AGL leaves no canopy on the grounded player > 0.5 s", mine <= 0.5 and not (ch["me"]["chute"] and ch["me"]["onGround"]),
                        {"presses": spam, "startAGL": agl, "worstSeconds": mine, "end": ch["me"]})
            v.info("(d) roof landing", "not covered by this harness yet (needs a scripted drop target on a roof collider)")
            # (e) side-view PNGs per weapon (practice kit)
            s.start_match("practice", 5, args.map, enter=True)
            s.step_frames(30, 1 / 60, render=False)
            shots = []
            for key, wid in (("Digit1", "pistol"), ("Digit2", "ar"), ("Digit3", "shotgun"), ("Digit4", "sniper"), ("Digit5", "glauncher")):
                s.press(key)
                s.step_frames(45, 1 / 60, render=False)
                url = s.js(SIDE_PNG_JS)
                path = os.path.join(C.SHOTS, "rig_%s.png" % wid)
                os.makedirs(C.SHOTS, exist_ok=True)
                import base64
                with open(path, "wb") as f:
                    f.write(base64.b64decode(url.split(",", 1)[1]))
                shots.append(path)
            v.info("(e) side-view PNG per weapon (judge the 180-degree flip by eye)", shots)
            v.data["shots"] = shots
    return C.run_gate("rigcheck", body, args)


if __name__ == "__main__":
    sys.exit(main())
