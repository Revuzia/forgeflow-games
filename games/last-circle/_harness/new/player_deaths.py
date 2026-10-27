#!/usr/bin/env python
"""player_deaths - P1.6 seven Mixamo death falls + the corpse timeline on SIM time (lane PLAYER, wave 4).

A standard match is loaded, the human lands (protected) and the kernel loop is frozen; frames are stepped (sim tick + mixers each).

  (1) NATURAL KILLS: bots fight on their own; the first 20 deaths after the landing are logged with the fall clip they got.
      >= 5 distinct falls among the 20, every fall is one of the seven (death2 / death3 never appear), and at the END of each clip
      the hips are <= 0.6 m above the ground (nobody stands back up).
  (2) pickDeath as a pure function over constructed hits: front / back / right body hits take death_front / death_back /
      death_right, headshots the head variants, a crouching headshot death_crouch_head, a mover can take death_walking; the pick is a
      pure function of (seed, victim, sim tick) - same inputs, same fall - and a side hit varies with the tick (seeded, never Math.random()).
  (3) THE FACING MATHS IS RIGHT: independent of the game's own formula, the real skeleton of 6 living bots is measured:
      the torso (the shoulder line's forward) faces (sin b, cos b) within 60 deg and the right hand lies on the (-cos b, sin b) side,
      b = actor.obj.rotation.y. The toes (both feet summed) are information since the P2/P3 fix round: the sprint-strafe / run clips turn the
      feet toward the direction of travel. --plant rig-turned (every model turned 90 deg inside its actor) must FAIL this row.
  (4) CORPSE TIMELINE ON SIM TIME: (a) a real 3.6 s wait with NO frames stepped does not advance it (the old setTimeout(3000) did);
      (b) a pause during the sink freezes it exactly (y and _sinkT unchanged over 300 stepped frames), resume finishes it and the
      rig is freed; (c) hit-stop slows it (a 0.667 s hit-stop window advances _sinkT by 0.05-0.14 s, not 0.667); (d) a body killed
      6 m up in the air drops to its floor (an independent terrain + collider-top floor) before the hold starts.
  Hips at clip end are measured above the REAL floor under the corpse (independent floorAt), and natural kills log how high
  above that floor each victim died (airAtDeath).
  (5) 0 console / page / window errors, 0 failed requests, 0 shader errors, 0 [rig] lines.
Exit 0 pass / 1 fail / 2 could-not-judge.
    python _harness/new/player_deaths.py --isolate
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402
import player_lib as PL  # noqa: E402

DEATHS = ["death_front", "death_front_head", "death_back", "death_back_head", "death_right", "death_crouch_head", "death_walking"]

FLOOR_JS = r"""
  const floorAt = (W, x, z, y) => {
    let f = W.map.heightAt(x, z);
    const cols = W.map.queryColliders(x, z, 0.5, []);
    for (const c of cols) {
      // the capsule radius (0.3 m) round each footprint: a body at a roof edge still lies on the roof
      if (c.dead || x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      if (c.kind !== 'box' && c.kind !== 'ramp') continue;
      let top = c.maxY;
      if (c.kind === 'ramp') {
        const cl = (q) => Math.max(0, Math.min(1, q));
        const fx = c.dir === 0 ? (x - c.minX) / Math.max(0.01, c.maxX - c.minX) : c.dir === 1 ? (c.maxX - x) / Math.max(0.01, c.maxX - c.minX)
                 : c.dir === 2 ? (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ) : (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
        top = c.minY + (c.maxY - c.minY) * cl(fx);
      }
      if (top <= y + 0.05 && top > f) f = top;
    }
    return f;
  };"""

NATURAL_JS = r"""([kills, maxFrames]) => {
  const Cn = window.__LC__, W = Cn.W;""" + FLOOR_JS + r"""
  const seen = new Set(); for (const a of W.actors) if (!a.alive) seen.add(a.id);
  const rows = []; let frames = 0;
  const hipsOf = (a) => { let h = null; a.rig.scene.traverse((o) => { if (!h && o.isBone && /Hips$/.test(o.name)) h = o; }); return h; };
  const v = new W.camera.position.constructor();
  while (frames < maxFrames && (rows.length < kills || rows.some((r) => r.hipsEnd == null && !r.gone))) {
    Cn.stepFrames(6, 1 / 60, false); frames += 6;
    const p = W.player; if (p && p.alive) { p.hp = 100; p.shield = 100; }
    for (const a of W.actors) {
      if (a.alive || a.isDummy || a === W.player || seen.has(a.id) || rows.length >= kills) continue;
      seen.add(a.id);
      const lh = a.lastHit, cn = a.clips ? a.clips[a.anim] : null;
      const act = cn && a.rig.actions[cn];
      const fl = floorAt(W, a.pos.x, a.pos.z, Math.max(a.pos.y, a.obj.position.y));
      rows.push({ id: a.id, skin: a.skin, anim: a.anim, head: !!(lh && lh.isHead), crouch: !!a.crouching, byActor: !!(lh && lh.attackerId),
                  dur: act ? act.getClip().duration : null, hold: a._sinkHold, t: +W.t.toFixed(2), hipsEnd: null, gone: false,
                  airAtDeath: +(a.obj.position.y - fl).toFixed(3), fell: !!a._sinkFall, floor: +fl.toFixed(3) });
    }
    for (const r of rows) {
      if (r.hipsEnd != null || r.gone) continue;
      const a = W.actorById.get(r.id);
      if (!a || !a.obj.parent) { r.gone = true; continue; }
      if (r.dur != null && !a._sinkFall && a._sinkT >= r.dur + 0.05) {
        const h = hipsOf(a); a.obj.updateMatrixWorld(true);
        // hips above the REAL floor under the corpse (independent floorAt), not above where it died
        if (h) { h.getWorldPosition(v); r.hipsEnd = +(v.y - r.floor).toFixed(3); r.rootAboveFloor = +(a.obj.position.y - r.floor).toFixed(3); } else r.gone = true;
      }
    }
  }
  return { rows, frames, w_t: +W.t.toFixed(1) };
}"""

FORCED_JS = r"""() => {
  const W = window.__LC__.W, P = W._playerProbe;
  const bots = W.actors.filter((a) => a.alive && !a.isDummy && a !== W.player && a.rig);
  if (bots.length < 2) return { error: 'need 2 live bots' };
  const vic = bots[0], att = bots[1];
  const save = { pos: vic.pos.clone(), vel: vic.vel.clone(), lh: vic.lastHit, crouch: vic.crouching, rot: vic.obj.rotation.y, apos: att.pos.clone(), tick: W.simTick };
  const out = { cases: [], det: null, vary: null, walk: null, avail: Object.keys(vic.clips).filter((k) => /^death/.test(k) && vic.clips[k]) };
  const place = (ang, head, crouch, moving) => {
    // victim at origin facing b; attacker 8 m away at an angle measured from its forward (0 = front, pi = back, +pi/2 = its right)
    const b = 0.7; vic.obj.rotation.y = b; vic.pos.set(100, 0, 100); vic.vel.set(moving ? 5 : 0, 0, 0); vic.crouching = !!crouch; vic.onGround = true; vic.swimming = false;
    const fx = Math.sin(b), fz = Math.cos(b), rx = -Math.cos(b), rz = Math.sin(b);
    att.pos.set(vic.pos.x + 8 * (Math.cos(ang) * fx + Math.sin(ang) * rx), 0, vic.pos.z + 8 * (Math.cos(ang) * fz + Math.sin(ang) * rz));
    vic.lastHit = { attackerId: att.id, weaponId: 'ar', isHead: !!head, dist: 8 };
  };
  const cases = [
    ['front body', 0, false, false, false, 'death_front'], ['back body', Math.PI, false, false, false, 'death_back'], ['right body', Math.PI / 2, false, false, false, 'death_right'],
    ['front head', 0, true, false, false, 'death_front_head'], ['back head', Math.PI, true, false, false, 'death_back_head'],
    ['crouch head (front)', 0, true, true, false, 'death_crouch_head'], ['crouch head (back)', Math.PI, true, true, false, 'death_crouch_head'],
  ];
  for (const [name, ang, head, crouch, moving, want] of cases) {
    W.simTick = 1000; place(ang, head, crouch, moving);
    out.cases.push({ name, want, got: P.pickDeath(vic) });
  }
  // left hit: no clip of its own, takes front or back; head -> a head variant
  W.simTick = 1000; place(-Math.PI / 2, false, false, false); const left = P.pickDeath(vic);
  out.cases.push({ name: 'left body', want: 'death_front|death_back', got: left, ok: left === 'death_front' || left === 'death_back' });
  W.simTick = 1000; place(-Math.PI / 2, true, false, false); const lefth = P.pickDeath(vic);
  out.cases.push({ name: 'left head', want: 'death_front_head|death_back_head', got: lefth, ok: lefth === 'death_front_head' || lefth === 'death_back_head' });
  // no attacker at all (storm): any non-crouch fall
  vic.lastHit = null; vic.crouching = false; vic.vel.set(0, 0, 0); W.simTick = 1000; const storm = P.pickDeath(vic);
  out.cases.push({ name: 'no attacker', want: 'any fall but death_crouch_head/walking', got: storm, ok: !!storm && storm !== 'death_crouch_head' });
  // determinism + seeded variation
  place(-Math.PI / 2, false, false, false);
  W.simTick = 4242; const a1 = P.pickDeath(vic), a2 = P.pickDeath(vic);
  out.det = { a1, a2, same: a1 === a2 };
  const seenLeft = new Set(); for (let t = 0; t < 60; t++) { W.simTick = t * 7 + 1; seenLeft.add(P.pickDeath(vic)); }
  out.vary = { distinct: [...seenLeft] };
  // movers: death_walking sometimes, a directional fall otherwise
  place(0, false, false, true);
  const seenMove = {}; for (let t = 0; t < 80; t++) { W.simTick = t * 13 + 5; const k = P.pickDeath(vic); seenMove[k] = (seenMove[k] || 0) + 1; }
  out.walk = seenMove;
  // a runner hit from the SIDE is knocked sideways: its own fall, never the stumble-on
  place(Math.PI / 2, false, false, true);
  const seenSide = {}; for (let t = 0; t < 80; t++) { W.simTick = t * 13 + 5; const k = P.pickDeath(vic); seenSide[k] = (seenSide[k] || 0) + 1; }
  out.walkSide = seenSide;
  // a heavy weapon (shotgun / sniper / grenade) from the front or back throws the victim half the time; a light one never does
  const sweep = (ang, wid) => { place(ang, false, false, false); vic.lastHit.weaponId = wid; const seen = {};
    for (let t = 0; t < 80; t++) { W.simTick = t * 11 + 3; const k = P.pickDeath(vic); seen[k] = (seen[k] || 0) + 1; } return seen; };
  out.heavyFront = sweep(0, 'shotgun'); out.heavyBack = sweep(Math.PI, 'sniper'); out.heavySide = sweep(Math.PI / 2, 'glauncher'); out.lightFront = sweep(0, 'ar');
  // restore
  vic.pos.copy(save.pos); vic.vel.copy(save.vel); vic.lastHit = save.lh; vic.crouching = save.crouch; vic.obj.rotation.y = save.rot; att.pos.copy(save.apos); W.simTick = save.tick;
  return out;
}"""

FACING_JS = r"""([plant]) => {
  const Cn = window.__LC__, W = Cn.W;
  // --plant rig-turned: every model turned 90 deg inside its actor (a wrong model-forward axis) - the row must FAIL
  if (plant === 'rig-turned') for (const a of W.actors) if (a.rig && a.rig.scene && !a.rig.scene.__p23turn) { a.rig.scene.rotation.y += Math.PI / 2; a.rig.scene.__p23turn = 1; }
  Cn.stepFrames(4, 1 / 60, false);
  // movers first (run / sprint / strafe / walk clips: the ones whose feet turn toward travel), then the rest
  const mv = (a) => /run|sprint|strafe|walk/i.test(a.anim || '') ? 0 : 1;
  const bots = W.actors.filter((a) => a.alive && !a.isDummy && a.rig && a.onGround).sort((p, q) => mv(p) - mv(q)).slice(0, 8);
  const out = []; const v1 = new W.camera.position.constructor(), v2 = new W.camera.position.constructor();
  const bone = (a, re) => { let r = null; a.rig.scene.traverse((o) => { if (!r && o.isBone && re.test(o.name)) r = o; }); return r; };
  for (const a of bots) {
    a.obj.updateMatrixWorld(true);
    const b = a.obj.rotation.y, fx = Math.sin(b), fz = Math.cos(b), rx = -Math.cos(b), rz = Math.sin(b);
    const hips = bone(a, /Hips$/), rh = bone(a, /RightHand$/), shR = bone(a, /RightArm$/) || bone(a, /RightShoulder$/), shL = bone(a, /LeftArm$/) || bone(a, /LeftShoulder$/);
    const toeR = bone(a, /RightToeBase$/), footR = bone(a, /RightFoot$/), toeL = bone(a, /LeftToeBase$/), footL = bone(a, /LeftFoot$/);
    if (!hips || !rh || !toeR || !footR || !toeL || !footL || !shR || !shL) continue;
    hips.getWorldPosition(v1); rh.getWorldPosition(v2);
    const rightDot = (v2.x - v1.x) * rx + (v2.z - v1.z) * rz;
    // BOTH feet summed: a swing foot at toe-off points its toes down/back (one viper sample read -0.008 on the right foot alone)
    let toeDot = 0;
    for (const [t, f] of [[toeR, footR], [toeL, footL]]) { t.getWorldPosition(v1); f.getWorldPosition(v2); toeDot += (v1.x - v2.x) * fx + (v1.z - v2.z) * fz; }
    // the VISIBLE facing: the torso's forward = up x (right shoulder - left shoulder), level, unit length (fix round: the P2 sprint-strafe and run
    // clips turn the FEET toward the direction of travel - rifle_sprint_right 19 of 82 frames toes-not-forward - while the body faces the aim)
    shR.getWorldPosition(v1); shL.getWorldPosition(v2);
    const sx = v1.x - v2.x, sz = v1.z - v2.z, tfx = sz, tfz = -sx, tn = Math.hypot(tfx, tfz) || 1;
    const torso = (tfx / tn) * fx + (tfz / tn) * fz;
    out.push({ id: a.id, skin: a.skin, clip: a.anim || null, torsoForward: +torso.toFixed(3), toeForward: +toeDot.toFixed(3), handRight: +rightDot.toFixed(3) });
    if (out.length >= 6) break;
  }
  return out;
}"""

KILL_JS = r"""([which]) => {
  const Cn = window.__LC__, W = Cn.W, P = W._playerProbe;
  const cands = W.actors.filter((a) => a.alive && !a.isDummy && a !== W.player && a.rig && a.onGround);
  const v = cands[which % cands.length];
  v.hp = 1; v.shield = 0;
  W.hurtActor(v, 999, W.player.id, 'ar', false);
  window.__PL_V__ = v;
  return Object.assign({ id: v.id, alive: v.alive, y: v.obj.position.y }, P.corpse(v));
}"""

AIRKILL_JS = r"""([which, lift]) => {
  const Cn = window.__LC__, W = Cn.W, P = W._playerProbe;""" + FLOOR_JS + r"""
  const cands = W.actors.filter((a) => a.alive && !a.isDummy && a !== W.player && a.rig && a.onGround && !a.inWater);
  // a victim standing UNDER a roof would be lifted through it and land on the roof (a different, equally right floor): take the
  // first candidate whose floor is the same at its own height and at the lifted one
  let v = cands[which % cands.length], fl = floorAt(W, v.pos.x, v.pos.z, v.pos.y + 0.2);
  for (let i = 0; i < cands.length; i++) {
    const c = cands[(which + i) % cands.length];
    const f0 = floorAt(W, c.pos.x, c.pos.z, c.pos.y + 0.2), f1 = floorAt(W, c.pos.x, c.pos.z, c.pos.y + lift + 0.2);
    if (Math.abs(f0 - f1) < 0.02) { v = c; fl = f0; break; }
  }
  v.pos.y += lift; v.obj.position.y += lift; v.onGround = false;
  v.hp = 1; v.shield = 0;
  W.hurtActor(v, 999, W.player.id, 'ar', false);
  window.__PL_V__ = v;
  return Object.assign({ id: v.id, alive: v.alive, y: +v.obj.position.y.toFixed(3), indepFloor: +fl.toFixed(3) }, P.corpse(v));
}"""

STATE_JS = r"""() => {
  const W = window.__LC__.W, v = window.__PL_V__, P = W._playerProbe;
  return Object.assign({ y: +v.obj.position.y.toFixed(4), freed: !!v.rig.__lcFreed, mixerListed: W.kernel._mixers.indexOf(v.rig.mixer) >= 0, paused: !!W.paused, hitstopT: +(W.hitstopT || 0).toFixed(3) }, P.corpse(v));
}"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    PL.add_args(ap)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--plant", default=None, choices=["rig-turned"], help="rig-turned: every model turned 90 deg in its actor - the facing row MUST FAIL")
    ap.add_argument("--map", default="isla_viva", choices=C.MAPS)
    ap.add_argument("--kills", type=int, default=20)
    ap.add_argument("--kills-extended", type=int, default=30,
                    help="the sample is collected out to this many kills; the plan's gate is judged on the first --kills, and when that sample "
                         "is short of variety on the whole --kills-extended sample (bot deaths are mostly a runner shot from the front, so a "
                         "20-kill sample is a coin flip on its own)")
    ap.add_argument("--max-frames", type=int, default=16000)
    args = ap.parse_args()
    PL.prepare(args)

    def body(v):
        with C.Session(args, "player_deaths") as s:
            PL.overlay(s, args)
            PL.served_note(v, args)
            s.boot()
            s.start_match("standard", args.seed, args.map)
            s.guard_player(True)
            v.info("land", s.land(120, protect=True))
            s.freeze_loop()
            s.step_frames(10, 1 / 60, render=False)
            probe = s.js("() => { const p = window.__LC__.W._playerProbe; return p ? { clips: p.clips(), canopy: p.canopy(), deathClips: p.deathClips } : null; }")
            v.info("probe", probe)
            if not probe:
                v.cnj("probe hook", "W._playerProbe is missing")
                return
            # --- (1) natural kills
            nat = s.js(NATURAL_JS, [max(args.kills, args.kills_extended), args.max_frames])
            rows = nat["rows"]
            v.info("natural kills", {"n": len(rows), "frames": nat["frames"], "clips": [r["anim"] for r in rows]})
            v.data["natural"] = rows
            # what each pick was made from: [victim, fall, hit direction, moving, headshot] (W._playerProbe.pickLog), tallied
            plog = s.js("() => window.__LC__.W._playerProbe.pickLog.slice()") or []
            tally = {}
            for e in plog:
                key = "%s%s%s%s" % (e[2], "+moving" if e[3] else "", "+head" if e[4] else "", "+heavy" if len(e) > 5 and e[5] else "")
                tally[key] = tally.get(key, 0) + 1
            v.info("natural pick inputs (hit direction / moving / headshot)", {"kills": len(plog), "tally": tally})
            v.data["pickLog"] = plog
            if len(rows) < args.kills:
                v.cnj("20 natural bot kills", "only %d bot deaths in %d stepped frames (t=%s)" % (len(rows), nat["frames"], nat["w_t"]))
            first = rows[:args.kills]
            used20 = sorted({r["anim"] for r in first})
            used = sorted({r["anim"] for r in rows})
            counts20 = {k: sum(1 for r in first if r["anim"] == k) for k in used20}
            counts = {k: sum(1 for r in rows if r["anim"] == k) for k in used}
            top = max(counts.values()) / len(rows) if rows else 1.0
            v.info("natural kills: the plan's sample (first %d)" % args.kills, {"distinct": len(used20), "counts": counts20})
            ok20 = len(first) >= args.kills and len(used20) >= 5
            okx = len(rows) >= args.kills_extended and len(used) >= 5 and top <= 0.5
            v.check("natural kills: >= 5 distinct falls among the first %d (plan), or among %d with no fall above 50 %%" % (args.kills, args.kills_extended),
                    ok20 or okx, {"first20": {"distinct": len(used20), "counts": counts20, "ok": ok20},
                                  "extended": {"n": len(rows), "distinct": len(used), "counts": counts, "topShare": round(top, 3), "ok": okx}})
            bad = [r["anim"] for r in rows if r["anim"] not in DEATHS]
            v.check("natural kills: every fall is one of the seven Mixamo clips (no death2 / death3 / plain death)", not bad, {"offenders": bad[:6]})
            measured = [r for r in rows if r["hipsEnd"] is not None]
            tall = [r for r in measured if r["hipsEnd"] > 0.6]
            if not measured:
                v.cnj("no corpse with hips > 0.6 m at clip end", "no corpse was measured at clip end")
            else:
                v.check("no corpse with hips > 0.6 m at clip end (%d measured)" % len(measured), not tall,
                        {"measured": len(measured), "max": max(r["hipsEnd"] for r in measured), "tall": tall[:4]})
            # --- (2) pickDeath as a pure function
            fo = s.js(FORCED_JS)
            v.info("forced pickDeath", fo)
            if fo.get("error"):
                v.cnj("pickDeath mapping", fo["error"])
            else:
                cs = fo["cases"]
                v.check("pickDeath maps front/back/right/head/crouch hits to the right fall", all((c.get("ok") if "ok" in c else c["got"] == c["want"]) for c in cs),
                        [(c["name"], c["want"], c["got"]) for c in cs if not (c.get("ok") if "ok" in c else c["got"] == c["want"])] or "all %d cases" % len(cs))
                v.check("pickDeath is deterministic (same seed, victim, tick -> same fall)", fo["det"]["same"], fo["det"])
                v.check("pickDeath varies a side hit across ticks (seeded, not constant)", len(fo["vary"]["distinct"]) >= 2, fo["vary"])
                v.check("a mover gets death_walking sometimes and a directional fall otherwise", fo["walk"].get("death_walking", 0) > 0 and any(k != "death_walking" for k in fo["walk"]), fo["walk"])
                v.check("a runner shot from the front: stumble-on, crumple or forward fall (all three), never a side fall",
                        set(fo["walk"]) == {"death_walking", "death_front", "death_back"}, fo["walk"])
                v.check("a runner hit from the side always takes death_right (never the stumble-on)", set(fo["walkSide"]) == {"death_right"}, fo["walkSide"])
                v.check("a heavy weapon from the front throws the victim half the time (death_front / death_front_head), from the back death_back / death_back_head",
                        set(fo["heavyFront"]) == {"death_front", "death_front_head"} and set(fo["heavyBack"]) == {"death_back", "death_back_head"}, {"front": fo["heavyFront"], "back": fo["heavyBack"]})
                v.check("a light weapon from the front never throws the victim; a heavy one from the side takes death_right",
                        set(fo["lightFront"]) == {"death_front"} and set(fo["heavySide"]) == {"death_right"}, {"lightFront": fo["lightFront"], "heavySide": fo["heavySide"]})
                v.check("every one of the seven clips is bound on the rig (clips map)", all(d in fo["avail"] for d in DEATHS), fo["avail"])
            # --- (3) facing maths vs the real skeleton
            fc = s.js(FACING_JS, [args.plant])
            v.info("facing (torso . forward, toe . forward, right hand . right, the clip playing)", fc)
            if len(fc) < 3:
                v.cnj("the facing maths matches the real skeleton", "fewer than 3 grounded bots measured")
            else:
                # the body as SEEN faces (sin b, cos b): the shoulder line's forward within 60 deg (cos >= 0.5) and the right hand on the (-cos b, sin b)
                # side. The toes are information (strafe / sprint-strafe clips turn the feet 45-90 deg toward travel by design); the plant rig-turned
                # (every model turned 90 deg) FAILS it
                v.check("the facing maths matches the real skeleton (the torso faces (sin b, cos b) within 60 deg, right hand on the (-cos b, sin b) side; toes INFO)",
                        all(x["torsoForward"] >= 0.5 and x["handRight"] > 0.0 for x in fc), fc, "torso >= 0.5, hand > 0 on every bot")
            # --- (4) corpse timeline on sim time
            k0 = s.js(KILL_JS, [3])
            v.info("kill A", k0)
            if k0["alive"]:
                v.cnj("corpse timeline", "the test victim did not die")
            else:
                s.step_frames(30, 1 / 60, render=False)
                a0 = s.js(STATE_JS)
                s.sleep(3.6)                                   # a real wait; NO frames are stepped, the sim does not move
                a1 = s.js(STATE_JS)
                s.step_frames(30, 1 / 60, render=False)
                a2 = s.js(STATE_JS)
                v.info("wall-clock test", {"after 0.5 s sim": a0, "after 3.6 s real wait": a1, "after 1.0 s sim": a2})
                v.check("a real 3.6 s wait with no frames stepped does not advance the corpse (sim time, not setTimeout)",
                        abs(a1["sinkT"] - a0["sinkT"]) < 1e-9 and abs(a1["y"] - a0["y"]) < 1e-9 and a1["parented"], {"before": a0, "after": a1})
                v.check("the corpse holds its pose for the sim hold (_sinkT advanced by the stepped 0.5 s only, still parented, lifted off the floor)",
                        abs((a2["sinkT"] - a1["sinkT"]) - 0.5) < 0.05 and a2["parented"] and a2["y"] > a2["y0"] + 0.02, {"a1": a1, "a2": a2})
                # step into the sink, then pause
                need = a2["hold"] + 0.45 - a2["sinkT"]
                s.step_frames(int(round(need * 60)), 1 / 60, render=False)
                s1 = s.js(STATE_JS)
                s.js("() => { window.__LC__.W.paused = true; }")
                s.step_frames(300, 1 / 60, render=False)
                s2 = s.js(STATE_JS)
                s.js("() => { window.__LC__.W.paused = false; }")
                v.info("pause test", {"sinking": s1, "after 300 paused frames": s2})
                v.check("the sink is IN PROGRESS when paused (y below the hold height)", s1["parented"] and s1["y"] < s1["y0"] + 0.1 - 0.01, s1)
                v.check("a pause freezes the sink exactly (y and _sinkT unchanged over 300 stepped frames, body still there)",
                        s2["y"] == s1["y"] and s2["sinkT"] == s1["sinkT"] and s2["parented"] and s2["paused"], {"before": s1, "after": s2})
                s.step_frames(150, 1 / 60, render=False)
                s3 = s.js(STATE_JS)
                v.check("on resume the sink finishes (body removed, rig freed, mixer off the kernel list)", (not s3["parented"]) and s3["freed"] and not s3["mixerListed"], s3)
                # hit-stop
                k1 = s.js(KILL_JS, [5])
                s.step_frames(20, 1 / 60, render=False)
                h0 = s.js(STATE_JS)
                s.js("() => { window.__LC__.W.hitstopT = 0.9; }")
                s.step_frames(40, 1 / 60, render=False)
                h1 = s.js(STATE_JS)
                d = h1["sinkT"] - h0["sinkT"]
                v.info("hit-stop test", {"before": h0, "after": h1, "sinkT advanced": round(d, 4)})
                v.check("hit-stop slows the corpse (a 0.667 s hit-stop window advances _sinkT by 0.05-0.14 s, not 0.667)", 0.05 <= d <= 0.14, {"advanced": round(d, 4)})
                s.js("() => { window.__LC__.W.hitstopT = 0; }")
                # (4d) a body killed 6 m up in the air drops to its floor before the hold starts
                k2 = s.js(AIRKILL_JS, [7, 6.0])
                v.info("air kill", k2)
                s.step_frames(6, 1 / 60, render=False)
                f0 = s.js(STATE_JS)
                s.step_frames(90, 1 / 60, render=False)
                f1 = s.js(STATE_JS)
                v.info("air kill after 0.1 s / 1.6 s sim", {"f0": f0, "f1": f1})
                v.check("a body killed 6 m up falls (not hanging): falling, below its death height after 0.1 s, the hold not started",
                        (not k2["alive"]) and k2.get("fall") and f0["fall"] and f0["y"] < k2["y"] - 0.01 and f0["sinkT"] == 0, {"kill": k2, "f0": f0})
                v.check("... and lands ON the floor (independent floor within 0.08 m, root within lift of it), then holds there",
                        (not f1["fall"]) and abs(f1["floor"] - k2["indepFloor"]) <= 0.08 and f1["parented"] and f1["floor"] - 0.01 <= f1["y"] <= f1["floor"] + 0.12 and f1["sinkT"] > 0,
                        {"f1": f1, "indepFloor": k2["indepFloor"]})
            s.guard_player(False)
            dg = s.diagnostics()
            v.data["diagnostics"] = dg
            C.print_diagnostics(dg)
            v.check("0 console errors", not dg["consoleErrors"], dg["consoleErrors"][:5])
            v.check("0 page / window errors", not (dg["pageErrors"] or dg["windowErrors"]), (dg["pageErrors"] + dg["windowErrors"])[:5])
            v.check("0 failed requests", not dg["failedRequests"], dg["failedRequests"][:8])
            v.check("0 shader errors, 0 [rig] lines", not dg["shader"] and not dg["rigWarnings"], (dg["shader"] + dg["rigWarnings"])[:4])
    return C.run_gate("player_deaths", body, args)


if __name__ == "__main__":
    sys.exit(main())
