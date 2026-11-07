#!/usr/bin/env python
"""probe_match - whole storm-on matches: bot loadouts, navigation, kills, replay determinism, loot census (PLAN L6 gates).

    python _harness/probe_match.py                                   # 7 runs (6 seeds, seed 1 twice) + paths/census on 3 maps
    python _harness/probe_match.py --runs 1:isla_viva,1:isla_viva --no-paths --rev 7da063ad
    python _harness/probe_match.py --disk --seconds 600
    python _harness/probe_match.py --disk --runs 11:ashgrid,11:ashgrid,12:ashgrid --paths-maps ashgrid --small-run     # Wave 7: the Savanna replay + census + paths

Promoted from _spec/improve_2026-09/baseline/probe_match.{py,js}, probe_paths.{py,js} and probe_farwall.{py,js} (the bots
audit). The in-page probes are READ-ONLY on game state (W.paused aside, which fastForward ignores). What changed vs the
audit's driver:
  * the match is started by common.start_match: startMatch() -> the lobby -> a REAL Enter key press, with the kernel's own
    loop FROZEN first, so W.phase really reaches 'drop' -> 'match' (the storm deals damage) and no wall-clock frame advances
    the sim between the Enter and the first fastForward (a same-seed replay is then a fair test of the SIM);
  * one page, one browser, every run in sequence (the box is shared);
  * probe_paths uses the game's own path search when bots.js exports debugNav() (lane L6) and a LIVE loot census.

GATES (PLAN L6; pooled over DISTINCT (seed, map) runs unless stated):
  pistol share of gun kills <= 35 %                 bot lives that END holding the pistol <= 40 %
  landed samples carrying a better gun but HOLDING the pistol < 5 % of samples that carry a better gun - TWO rows: the raw-DPS
  sim gunScore metric (the better gun must be loaded and out-score the held pistol; the audit's looser count is INFO), and the
  range/ammo-aware one (VERIFY.md #24, L6 pmdiag: sim gunValueAt at the live
  fight, bots.js's own swap rule mirrored in probe_match.js valueBetter)
  sniper kills > 0 in most matches                  stuck (net < 0.4 m over 3 s while in a moving state) < 2 % of moving
                                                    samples in EVERY run, and no bot with > 5 stuck episodes in a run
  seed 1 isla_viva: bot s21 is never frozen >= 12 s and leaves Coco Village (or dies)
  the same seed twice: identical 5-s fingerprints AND placements; a different seed: different fingerprints
  census per map: (floor guns + chests) / players >= 3 and >= 8 light-ammo boxes; the game's path search finds a usable
  path for >= 15 of 30 blocked pairs at 120 m and at 180 m
  --farwall (gate.py passes it): far-bot wall clipping farToNearInside == 0 (PLAN L5 d) on seeds 1 and 7 isla_viva
  swim-trap (W9 R1B, every run list): stuck episodes while SWIMMING (stuckEp inWater) <= 1 per bot in every run - the loop breaker's water branch
  --sweep (W9 R1B): the episode sweep, 3 maps x seeds 1-6 (18 runs, no paths): the worst bot's stuck episodes <= 4 in every run (the R2 movers bar)
  --swimcheck (W9 R1B): the scripted swimmer trap (natural swim traps: 0 in the 18-run sweep, base and lane alike) - see SWIMCHECK_JS
  --plant swim-exempt (needs --disk / --rev): bots.js served with swimmers exempt from the loop breaker again - MUST FAIL the scripted swim-trap row
  --pencheck (W9 R1B pass 3): ONLY the scripted Volcano Rim pen (isla_viva seed 5, 3 setups; no match runs) - see PENCHECK_JS; --plant no-pen-fix (EDGE_TURN off) MUST FAIL it
  --sweep --plant stall-surge: every moving bot held 3.6 s of every 25 s - MUST FAIL the sweep's worst <= 4 row (its measure control)
INFO: pacing (deaths before 60 s, match end), dry shares, sniper/launcher carried but pistol held.
Exit 0 pass / 1 fail / 2 could not judge.
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_RUNS = "1:isla_viva,1:isla_viva,7:isla_viva,11:ashgrid,12:ashgrid,13:deepwood,23:deepwood"
SWEEP_RUNS = ",".join("%d:%s" % (sd, mp) for mp in ("isla_viva", "ashgrid", "deepwood") for sd in range(1, 7))
SWEEP_WORST_MAX, SWIM_TRAP_MAX = 4, 1
# planted faults served into bots.js (p23lib.serve_patched: each anchor must occur exactly once, else could-not-judge)
PLANTS = {
    # (W9 R1B) the loop breaker's trap test exempts swimmers again (the pre-W9 term): swim-trap MUST FAIL (deepwood seed 1, bot s4)
    "swim-exempt": [("if (MOVING_STATES[b.state] && mt && !bb.chestId && !a.healing && !a.emoting && W.t >= bb.escUntil) {",
                     "if (MOVING_STATES[b.state] && mt && !bb.chestId && !a.healing && !a.emoting && !a.swimming && W.t >= bb.escUntil) {")],
    # (W9 R1B pass 3) the pen fix off: edgeGuard's route-corner walk (EDGE_TURN) - the scripted pen (--pencheck) MUST FAIL. (Pass 1b's second
    # half, requestPath's per-bot drop limit + steep-face run (PER_BOT_DROP), is removed from bots.js: the scripted pen and the sweep read the
    # same with it off as on.) On the natural sweep this plant no longer discriminates (pass 2: PASS 13/0) - the sweep row's control is stall-surge.
    "no-pen-fix": [("const EDGE_TURN = true;", "const EDGE_TURN = false;")],
    # (W9 R1B pass 3) a MEASURE control for the sweep row (worst bot stuck episodes <= 4): every bot on the ground in a moving state is held still
    # (no legs) for 3.6 s of every 25 s of match time - >= 3 s windows inside 0.4 m, ~30 per bot per match. The sweep row MUST FAIL.
    "stall-surge": [("const wyE = W.map.waterY;          // (R1, tierprof kb)",
                     "const wyE = W.map.waterY; if (MOVING_STATES[b.state] && (W.t % 25) < 3.6) { inp.mz = 0; inp.mx = 0; inp.sprint = false; inp.jump = false; return; }          // (R1, tierprof kb)")],
    # (W9 fix doorstuck) the leafed-doorway funnel off (bots.js doorFunnel: a window route crossing a leafed doorway passes two points on the door's axis) -
    # the sweep MUST FAIL (measured without it, fix1 2026-11-06: ashgrid seed 1 s42 7 episodes - a 3.6 s loop at yard@p3's back door - and isla_viva seed 2 s31 5)
    "no-door-funnel": [("if (bb.path && !bb.path.nav && !bb.path.exit) doorFunnel(W, bb.path, a.pos.x, a.pos.y, a.pos.z);",
                        "if (false) doorFunnel(W, bb.path, a.pos.x, a.pos.y, a.pos.z);")],
}
GUN_WIDS_EXCLUDED = ("storm", "none", None, "fall", "zone")


# (W9 R1B) --swimcheck: the loop breaker's water branch on a SCRIPTED trap (natural swimmer traps: 0 in the 18-run sweep of the base and of this
# lane, so the sweep's swim-trap row cannot tell the two apart). A quick match on deepwood seed 1, after the landings: a free bot is put in deep water
# (terrain >= 3 m under the surface) with dry shore 20-40 m off, 100 hp, shield 50, an AR and no shield item, and a big shield on that shore - its
# own shield scan sends it there (LOOT). SETUP: every other actor kept > 260 m away (no sight, no shot heard); for SWIM_PIN_S the bot is held inside a 1 m disc every sim tick
# (an invisible pen: the trap). Then it is released for SWIM_FREE_S. Judged per spot (SWIM_SPOTS spots): the bot was swimming and travelling (a
# MOVING_STATES state - LOOT for the shield, ROTATE when the storm closes - its goal > 6 m off) while penned, the breaker tripped (a break-out goal committed: bb.escUntil set while penned), and after the release it was
# not stuck again (no 3 s window inside 0.4 m while swimming in a moving state). --plant swim-exempt (swimmers exempt again): never trips - FAILS.
SWIM_MAP, SWIM_SEED, SWIM_SPOTS, SWIM_PIN_S, SWIM_FREE_S = "deepwood", 1, 3, 4.0, 8.0
SWIMCHECK_JS = r"""async ([wantN, pinS, freeS]) => {
  const W = window.__LC__.W, C = window.__LC__, M = W.map, K = W.SIM, wy = M.waterY, H = (M.half || 760) - 30;
  const cl = (v) => Math.max(-H, Math.min(H, v));
  // deep-water spots with dry shore 20-40 m off along one of 16 headings (the first dry point on it), >= 80 m apart
  const spots = [];
  for (let x = -H; x <= H && spots.length < wantN; x += 24) for (let z = -H; z <= H && spots.length < wantN; z += 24) {
    if (!(M.heightAt(x, z) < wy - 3)) continue; if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 80)) continue;
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a); let shore = null;
      for (let d = 2; d <= 40; d += 1) { const h = M.heightAt(x + dx * d, z + dz * d); if (h > wy + 0.3) { shore = d; break; } }
      if (shore == null || shore < 20) continue;
      const gx = x + dx * (shore + 4), gz = z + dz * (shore + 4); if (!(M.heightAt(gx, gz) > wy + 0.3) || Math.abs(gx) > H || Math.abs(gz) > H) continue;
      spots.push({ x, z, gx, gz, shore }); break; } }
  const used = new Set(), out = [];
  for (let si = 0; si < spots.length; si++) { const sp = spots[si];
    const b = W.actors.filter((a) => a.isBot && a.alive && !a.downed && !a.gliding && !used.has(a.id)).sort((p, q) => Math.hypot(p.pos.x - sp.x, p.pos.z - sp.z) - Math.hypot(q.pos.x - sp.x, q.pos.z - sp.z))[0];
    if (!b) { out.push({ error: 'no free bot' }); continue; } used.add(b.id);
    const put = (a, x, z, y) => { a.pos.set(x, y, z); a.vel.set(0, 0, 0); a.gliding = false; if (a.obj) a.obj.position.copy(a.pos); };
    put(b, sp.x, sp.z, wy - 0.55); b.onGround = false;
    const sl = b.inventory.slots; for (let i = 0; i < sl.length; i++) sl[i] = null; for (const q in b.inventory.ammo) b.inventory.ammo[q] = 0;
    sl[0] = { kind: 'weapon', id: 'ar', rarity: 1, mag: K.WEAPONS.ar.mag }; b.inventory.ammo.medium = 120; b.inventory.active = 0;
    b.hp = 100; b.shield = 50; b.lastDamageT = -99;
    if (b.brain) { const bb = b.brain.bb; bb.target = null; bb.targetPos = null; bb.path = null; bb.pathGoal = null; bb.moveTo = null; bb.lootId = null; bb.shieldScanT = 0; bb.escUntil = -99; bb.trapLastT = -99; b.brain.nextThink = 0; }
    const gid = 'p23swim' + si;
    W.netSpawnItem({ id: gid, data: { kind: 'consumable', id: 'big_shield', count: 1 }, x: sp.gx, y: M.heightAt(sp.gx, sp.gz) + 0.15, z: sp.gz });
    const fence = () => { for (const o of W.actors) { if (o === b || !o.alive || o.gliding) continue; const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz);
      if (d < 260) { const s = 265 / Math.max(0.1, d), nx = cl(b.pos.x + dx * s), nz = cl(b.pos.z + dz * s); put(o, nx, nz, Math.max(M.heightAt(nx, nz), wy) + 0.05); o.onGround = true; } } };
    // travelling = any state the loop breaker watches (bots.js MOVING_STATES) with its goal > 6 m off: the shield goal sends it in LOOT, but a
    // storm that closes over the spot sends it in ROTATE (2 of 3 spots on deepwood seed 1) - the same trap, the same breaker
    const TRAV = { LOOT: 1, ROTATE: 1, PUSH: 1, WANDER: 1, HUNT: 1, FLEE: 1, SUPPLY: 1, CLOSEIN: 1, FOLLOW: 1, PING: 1, ASSIST: 1 };
    let pinned = true, tripped = null, swimPin = 0, travelPin = 0, pinTicks = 0; const t0 = W.t;
    const prev = W._tickHook;
    W._tickHook = (w) => { if (prev) prev(w); fence(); if (!b.alive) return;
      if (pinned) { pinTicks++; const dx = b.pos.x - sp.x, dz = b.pos.z - sp.z, d = Math.hypot(dx, dz); if (d > 0.5) { b.pos.x = sp.x + dx / d * 0.5; b.pos.z = sp.z + dz / d * 0.5; }
        if (b.swimming) swimPin++; const bb = b.brain && b.brain.bb, mt = bb && bb.moveTo;
        if (b.brain && TRAV[b.brain.state] && mt && Math.hypot(mt.x - b.pos.x, mt.z - b.pos.z) > 6) travelPin++;
        if (tripped == null && bb && bb.escUntil > W.t) tripped = { t: +(W.t - t0).toFixed(2), esc: [+bb.escX.toFixed(1), +bb.escZ.toFixed(1)], swimming: !!b.swimming }; } };
    C.fastForward(pinS, 1 / 30);
    pinned = false;
    const track = [];
    for (let i = 0; i < freeS * 10; i++) { C.fastForward(0.1, 1 / 30); track.push([b.pos.x, b.pos.z, !!b.swimming, b.brain ? b.brain.state : null]); }
    W._tickHook = prev;
    const MOV = { LOOT: 1, ROTATE: 1, PUSH: 1, WANDER: 1, HUNT: 1, FLEE: 1, SUPPLY: 1 };
    let stuck = 0; for (let i = 0; i + 30 < track.length; ) { let mx = 0, ok = true; for (let j = i; j <= i + 30; j++) { mx = Math.max(mx, Math.hypot(track[j][0] - track[i][0], track[j][1] - track[i][1])); if (!track[j][2] || !MOV[track[j][3]]) ok = false; }
      if (mx < 0.4 && ok) { stuck++; i += 30; } else i++; }
    const moved = track.length ? Math.hypot(track[track.length - 1][0] - sp.x, track[track.length - 1][1] - sp.z) : 0;
    out.push({ bot: b.id, spot: [Math.round(sp.x), Math.round(sp.z)], shoreM: sp.shore, pinTicks, swimPin, travelPin, tripped, stuckAfter: stuck, movedAfter: +moved.toFixed(1),
               endSwimming: !!b.swimming, state: b.brain ? b.brain.state : null }); }
  return { found: spots.length, out }; }"""


def swimcheck(s, v):
    st = s.start_match("quick", SWIM_SEED, SWIM_MAP, enter=True)
    s.freeze_loop()
    s.page.evaluate("() => window.__LC__.fastForward(20, 1 / 30)")
    r = s.page.evaluate(SWIMCHECK_JS, [SWIM_SPOTS, SWIM_PIN_S, SWIM_FREE_S])
    v.data["swimcheck"] = {"start": st, "result": r}
    rows = [x for x in r["out"] if not x.get("error")]
    setup_ok = [x for x in rows if x["swimPin"] >= 0.8 * x["pinTicks"] and x["travelPin"] >= 0.5 * x["pinTicks"]]
    name = ("swim-trap scripted (a swimmer travelling to a goal on the shore, held %.0f s in a 1 m disc: the loop breaker trips and the bot is not "
            "stuck swimming again in the next %.0f s; %s seed %d)" % (SWIM_PIN_S, SWIM_FREE_S, SWIM_MAP, SWIM_SEED))
    if len(setup_ok) < 2:
        v.cnj(name, "SETUP missed: %d of %d spots had a swimming, travelling bot while penned (want >= 2): %s" % (len(setup_ok), len(rows), r))
        return
    ok = all(x["tripped"] and x["stuckAfter"] == 0 for x in setup_ok)
    v.check(name, ok, {"spots": setup_ok, "found": r["found"]}, "tripped while penned; 0 swimming stuck episodes after")


# (W9 R1B pass 3) --pencheck: the Volcano Rim pen, SCRIPTED (the natural reproducer - isla_viva seed 5, s19 held 3-5 times at (-70.7, -77.9) - is gone
# from the sweep since pass 2). Isla Viva seed 5 geometry: the village terrace top at y 26.7 runs west to x -72, where a face falls to 18.4 m by x -80
# (8.4 m: more than a calm bot walks off, CALM_DROP_H 6.3). The town grid's route from the terrace to the north (a big shield at PEN_GOAL, 33 m
# away along the top) runs WEST to the corner (-71.6, -77.6), 1.5-2 m short of the face, then north along its top. edgeGuard's look-ahead sees the face
# past the corner on every look; before EDGE_TURN it held the bot there for good. One quick match per setup (PEN_SETUPS: start x, z, hp): after the
# landings (PEN_PRE_S) a free bot is put on the terrace with that hp, shield 50, an AR, no shield item, every other actor kept > 260 m away (no sight,
# no shot heard), and the big shield is spawned at PEN_GOAL (its own shield scan sends it there in LOOT). Judged per setup, from the placement until
# it reaches the goal (2.5 m) or PEN_T s pass: it REACHES the goal in PEN_T s with 0 stuck episodes on the way (probe_match.js's definition: a 3 s
# window, 0.5 s samples, net < 0.4 m, every sample a MOVING state). SETUP (else could-not-judge): the terrace and face are where they were (start
# terrain 26-27.5 m, face foot >= 7 m lower) and the bot's route ran through the corner (a waypoint within 1.5 m of it). --plant no-pen-fix: FAILS.
# Measured (fix3, 2026-11-02): lane 3/3 reach in 8-9.5 s, 0 episodes - PASS; --plant no-pen-fix: setups 1 and 3 never reach (2 episodes each, held at the
# corner), setup 2 reaches in 7.5 s - FAIL. (PER_BOT_DROP off read the same as the lane on setups 1 and 3 and on 6 goal-below-the-face variants: removed.)
# (W9 R1 fix botpen, 2026-11-06) On the merged world (doors / MAP_GEN 8, 02fa63f7) the SAME terrain (start 26.73, foot 18.38, lip at x -73.7) picks
# another bot (s18) whose grid route turns at (-72.4, -77.6) / (-72, -77.5), 1.3-1.7 m in from the lip: the old corner rule (corner + 1.6 m <= the
# look's 0.8 m-sampled face distance) held it for good - setup 1 reach 19 s / 1 episode, setup 2 never (minD 33.2) / 1 episode. A real pen in the
# game, not a moved setup (296edc14: 3/3, 9.5 / 8 / 9.5 s). Fixed in bots.js routeTurnsBefore (run-on sampled from the corner at 0.2 m,
# EDGE_TURN_M 1.1): 3/3 reach 11 / 8 / 10 s, 0 episodes; --plant no-pen-fix: reach 19 / never / 28.5 s, 1 episode each - FAIL.
PEN_MAP, PEN_SEED, PEN_PRE_S, PEN_T = "isla_viva", 5, 20.0, 30.0
PEN_GOAL, PEN_CORNER, PEN_FACE_FOOT = (-67.0, -44.5), (-71.6, -77.6), (-80.0, -78.0)
PEN_SETUPS = ((-63.4, -77.6, 17), (-66.0, -79.0, 17), (-63.4, -77.6, 40))
PENCHECK_JS = r"""async ([sx, sz, hp, gx, gz, cx, cz, fx, fz, T]) => {
  const W = window.__LC__.W, C = window.__LC__, M = W.map, K = W.SIM, wy = M.waterY, H = (M.half || 760) - 30;
  const cl = (v) => Math.max(-H, Math.min(H, v));
  const geo = { start: +M.heightAt(sx, sz).toFixed(2), foot: +M.heightAt(fx, fz).toFixed(2), goal: +M.heightAt(gx, gz).toFixed(2) };
  const b = W.actors.filter((a) => a.isBot && a.alive && !a.downed && !a.gliding).sort((p, q) => Math.hypot(p.pos.x - sx, p.pos.z - sz) - Math.hypot(q.pos.x - sx, q.pos.z - sz))[0];
  if (!b || !b.brain) return { geo, error: 'no free bot' };
  const put = (a, x, z, y) => { a.pos.set(x, y, z); a.vel.set(0, 0, 0); a.gliding = false; if (a.obj) a.obj.position.copy(a.pos); };
  const fence = () => { for (const o of W.actors) { if (o === b || !o.alive || o.gliding) continue; const dx = o.pos.x - b.pos.x, dz = o.pos.z - b.pos.z, d = Math.hypot(dx, dz);
    if (d < 260) { const s = 265 / Math.max(0.1, d), nx = cl(b.pos.x + dx * s), nz = cl(b.pos.z + dz * s); put(o, nx, nz, Math.max(M.heightAt(nx, nz), wy) + 0.05); o.onGround = true; } } };
  fence();
  put(b, sx, sz, M.heightAt(sx, sz) + 0.05); b.onGround = true;
  const sl = b.inventory.slots; for (let i = 0; i < sl.length; i++) sl[i] = null; for (const q in b.inventory.ammo) b.inventory.ammo[q] = 0;
  sl[0] = { kind: 'weapon', id: 'ar', rarity: 1, mag: K.WEAPONS.ar.mag }; b.inventory.ammo.medium = 120; b.inventory.active = 0;
  b.hp = hp; b.shield = 50; b.lastDamageT = -99;
  { const bb = b.brain.bb; bb.target = null; bb.targetPos = null; bb.path = null; bb.pathGoal = null; bb.moveTo = null; bb.lootId = null; bb.shieldScanT = 0; bb.escUntil = -99; bb.trapLastT = -99; bb.nextPathT = 0; b.brain.nextThink = 0; }
  W.netSpawnItem({ id: 'p23pen', data: { kind: 'consumable', id: 'big_shield', count: 1 }, x: gx, y: M.heightAt(gx, gz) + 0.15, z: gz });
  const prev = W._tickHook;
  W._tickHook = (w) => { if (prev) prev(w); fence(); };
  const MOV = { LOOT: 1, ROTATE: 1, PUSH: 1, WANDER: 1, HUNT: 1, FLEE: 1, SUPPLY: 1 };
  const t0 = W.t, ring = [], eps = [], states = {}, track = [];
  let open = false, reachT = null, cornerD = 1e9, minD = 1e9;
  for (let i = 0; i < T * 2 && reachT == null; i++) {
    C.fastForward(0.5, 1 / 30);
    if (!b.alive) break;
    const bb = b.brain.bb, st = b.brain.state, d = Math.hypot(b.pos.x - gx, b.pos.z - gz);
    states[st] = (states[st] || 0) + 1; if (d < minD) minD = d;
    if (bb.path) for (let k = 0; k < bb.path.length && k < 4; k++) cornerD = Math.min(cornerD, Math.hypot(bb.path[k].x - cx, bb.path[k].z - cz));
    track.push([+(W.t - t0).toFixed(1), +b.pos.x.toFixed(1), +b.pos.y.toFixed(1), +b.pos.z.toFixed(1), st]);
    if (d < 2.5) { reachT = +(W.t - t0).toFixed(1); break; }
    const mv = !!MOV[st] && !bb.chestId && !b.healing && !b.emoting;
    ring.push({ x: b.pos.x, z: b.pos.z, mv }); if (ring.length > 7) ring.shift();
    if (ring.length === 7 && ring.every((r) => r.mv) && Math.hypot(ring[6].x - ring[0].x, ring[6].z - ring[0].z) < 0.4) {
      if (!open) { open = true; const mt = bb.moveTo; eps.push({ t: +(W.t - t0).toFixed(1), x: +b.pos.x.toFixed(1), y: +b.pos.y.toFixed(1), z: +b.pos.z.toFixed(1), st,
        goalD: mt ? +Math.hypot(mt.x - b.pos.x, mt.z - b.pos.z).toFixed(1) : null }); }
    } else open = false;
  }
  W._tickHook = prev;
  return { geo, bot: b.id, hp, reachT, minD: +minD.toFixed(1), cornerD: +cornerD.toFixed(2), episodes: eps.length, eps, alive: b.alive, states,
           end: [+b.pos.x.toFixed(1), +b.pos.y.toFixed(1), +b.pos.z.toFixed(1)], track: track.filter((_, i) => i % 4 === 0) };
}"""


def pencheck(s, v):
    out = []
    for (sx, sz, hp) in PEN_SETUPS:
        st = s.start_match("quick", PEN_SEED, PEN_MAP, enter=True)
        s.freeze_loop()
        s.page.evaluate("(t) => window.__LC__.fastForward(t, 1 / 30)", PEN_PRE_S)
        r = s.page.evaluate(PENCHECK_JS, [sx, sz, hp, PEN_GOAL[0], PEN_GOAL[1], PEN_CORNER[0], PEN_CORNER[1], PEN_FACE_FOOT[0], PEN_FACE_FOOT[1], PEN_T])
        r["start"], r["load"] = [sx, sz], st
        out.append(r)
        print("  pencheck start (%.1f, %.1f) hp %d: bot %s reach %s s, %s stuck episodes, corner %s m, geo %s" % (
            sx, sz, hp, r.get("bot"), r.get("reachT"), r.get("episodes"), r.get("cornerD"), r.get("geo")), flush=True)
    v.data["pencheck"] = out
    name = ("pen scripted (Volcano Rim, %s seed %d: an hp-limited calm bot on the terrace top, its goal %.0f m north along the top past a corner 1.5-2 m "
            "short of an 8.4 m face, %d setups): every setup reaches the goal in %.0f s with 0 stuck episodes on the way" % (PEN_MAP, PEN_SEED, 33, len(PEN_SETUPS), PEN_T))
    bad = [r for r in out if r.get("error") or not (26.0 <= r["geo"]["start"] <= 27.5 and r["geo"]["start"] - r["geo"]["foot"] >= 7.0) or r.get("cornerD", 1e9) > 1.5]
    if bad:
        v.cnj(name, "SETUP missed in %d of %d setups (geometry moved, no bot, or the route did not use the corner): %s" % (
            len(bad), len(out), [{k: r.get(k) for k in ("start", "error", "geo", "cornerD")} for r in bad]))
        return
    ok = all(r["reachT"] is not None and r["reachT"] <= PEN_T and r["episodes"] == 0 for r in out)
    v.check(name, ok, [{k: r.get(k) for k in ("start", "hp", "bot", "reachT", "episodes", "eps", "cornerD", "minD", "end")} for r in out],
            "reach <= %.0f s and 0 stuck episodes, every setup" % PEN_T)


def pct(a, b):
    return round(100.0 * a / b, 1) if b else None


def longest_frozen(track, box=0.4):
    """Longest span (s) of consecutive alive, landed samples whose x/z stay inside a `box` m box."""
    pts = [r for r in track if r[4] == 1 and r[5] == 0]
    best = (0.0, None)
    i = 0
    n = len(pts)
    while i < n:
        mnx = mxx = pts[i][1]
        mnz = mxz = pts[i][3]
        j = i
        while j + 1 < n:
            x, z = pts[j + 1][1], pts[j + 1][3]
            nx0, nx1, nz0, nz1 = min(mnx, x), max(mxx, x), min(mnz, z), max(mxz, z)
            if math.hypot(nx1 - nx0, nz1 - nz0) >= box or pts[j + 1][0] - pts[j][0] > 1.01:
                break
            mnx, mxx, mnz, mxz = nx0, nx1, nz0, nz1
            j += 1
        span = pts[j][0] - pts[i][0]
        if span > best[0]:
            best = (round(span, 1), [pts[i][0], pts[i][1], pts[i][2], pts[i][3], pts[i][6]])
        i = j + 1 if j > i else i + 1
    return best


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--runs", default=DEFAULT_RUNS, help="seed:map list (a repeated pair is the replay check; default %(default)s)")
    ap.add_argument("--seconds", type=float, default=1000.0, help="sim seconds per match (stops at match end)")
    ap.add_argument("--step", type=float, default=1 / 30)
    ap.add_argument("--no-paths", action="store_true", help="skip probe_paths (census + path search)")
    ap.add_argument("--paths-maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--paths-live", type=float, default=60.0, help="live path-sampling seconds per map (information)")
    ap.add_argument("--small-run", action="store_true",
                    help="the run list is too small for the 'sniper kills in MOST matches' row (a share of matches: Wave 7's Savanna run has 2 distinct matches): that one row is information; every other row is judged as usual")
    ap.add_argument("--farwall", action="store_true", help="also run probe_farwall (far-bot wall clipping; gates farToNearInside == 0, PLAN L5 d)")
    ap.add_argument("--swimcheck", action="store_true", help="W9 R1B: the scripted swimmer trap (see SWIMCHECK_JS); --plant swim-exempt must FAIL it")
    ap.add_argument("--pencheck", action="store_true", help="W9 R1B pass 3: ONLY the scripted Volcano Rim pen (no match runs; see PENCHECK_JS); --plant no-pen-fix must FAIL it")
    ap.add_argument("--sweep", action="store_true", help="W9 R1B: the episode sweep (3 maps x seeds 1-6, --no-paths, --small-run); adds the worst <= %d row" % SWEEP_WORST_MAX)
    ap.add_argument("--plant", default=None, choices=sorted(PLANTS), help="a planted fault served into bots.js (this gate must then FAIL); needs --disk / --rev")
    args = ap.parse_args()
    if args.sweep:
        args.runs, args.no_paths = SWEEP_RUNS, True
    runs = []
    for r in args.runs.split(","):
        if r.strip():
            sd, mp = r.strip().split(":")
            runs.append((int(sd), mp))
    js_match = open(os.path.join(HERE, "probe_match.js"), encoding="utf-8").read()
    js_paths = open(os.path.join(HERE, "probe_paths.js"), encoding="utf-8").read()
    js_far = open(os.path.join(HERE, "probe_farwall.js"), encoding="utf-8").read()

    def body(v):
        results, paths, far = [], [], []
        with C.Session(args, "probe_match", viewport={"width": 960, "height": 600}) as s:
            if args.plant:
                sys.path.insert(0, os.path.join(HERE, "p23"))
                import p23lib  # noqa: E402
                v.data["plant"] = {"name": args.plant, "edits": p23lib.serve_patched(s, "runtime/3d/royale/bots.js", PLANTS[args.plant])}
            s.boot()
            s.freeze_loop()
            if args.pencheck:                      # (W9 R1B pass 3) its own row: the scripted pen alone (no match runs, no paths)
                pencheck(s, v)
                d = s.diagnostics()
                v.check("no page errors / window errors during the runs", not (d["pageErrors"] or d["windowErrors"]),
                        {"pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3]})
                return
            for k, (seed, mp) in enumerate(runs):
                t0 = time.time()
                st = s.start_match("standard", seed, mp, enter=True)
                s.freeze_loop()                         # startMatch may restart the kernel loop
                watch = ["s21"] if (seed == 1 and mp == "isla_viva") else []
                res = s.page.evaluate(js_match, [seed, mp, args.seconds, args.step, 0, 1, 1, watch])
                res["wallTotal"] = round(time.time() - t0, 1)
                res["load"] = st
                res["run"] = k
                results.append(res)
                wids = collections.Counter(x["wid"] or "none" for x in res["kills"])
                print("  run %d seed %d %s: phase %s->%s->%s simT %s over %s winner %s kills %d %s wall %.0f s (sim %.0f s)" % (
                    k, seed, res["map"], res["phaseAfterStart"], res["phaseAfterLobby"], res["phaseEnd"], res["simT"], res["over"],
                    res["winner"], len(res["kills"]), dict(wids), res["wallTotal"], res["wallS"]), flush=True)
                C.save_report("probe_match_raw", {"results": results}, out=os.path.join(C.REPORTS, "probe_match_raw_partial.json"))
            if not args.no_paths:
                for i, mp in enumerate([m for m in args.paths_maps.split(",") if m]):
                    t0 = time.time()
                    s.start_match("standard", 11 + i, mp, enter=False)
                    s.freeze_loop()
                    r = s.page.evaluate(js_paths, [11 + i, mp, args.paths_live, 1 / 30, 1])
                    r["wall"] = round(time.time() - t0, 1)
                    paths.append(r)
                    print("  paths %s: %s; census %s" % (mp, r["navSrc"], json.dumps(r["census"])), flush=True)
                    for D, row in r["exp"].items():
                        print("     D=%4s n=%2d game-useful %2d | verbatim-mid %2d | start-centred %2d" % (D, row["n"], row["gameUseful"], row["midUseful"], row["startUseful"]))
            if args.swimcheck:
                swimcheck(s, v)
            if args.farwall:
                for seed, mp in ((1, "isla_viva"), (7, "isla_viva")):
                    s.start_match("standard", seed, mp, enter=True)
                    s.freeze_loop()
                    far.append(s.page.evaluate(js_far, [seed, mp, 400, 1]))
            d = s.diagnostics()
        v.data["results"] = results
        v.data["paths"] = paths
        v.data["farwall"] = far
        # ---------------- verdicts ----------------
        bad_phase = [(r["seed"], r["map"], r["phaseAfterLobby"]) for r in results if r["phaseAfterLobby"] not in ("drop", "match")]
        v.check("every run left the lobby by a REAL Enter (storm on)", not bad_phase, bad_phase or [r["phaseAfterLobby"] for r in results])
        seen, distinct = set(), []
        for r in results:
            key = (r["seed"], r["map"])
            if key not in seen:
                seen.add(key)
                distinct.append(r)
        ei = [e for r in distinct for e in r["endInv"]]
        kills = [k for r in distinct for k in r["kills"]]
        wids = collections.Counter(k["wid"] or "none" for k in kills)
        gun = sum(n for w, n in wids.items() if w not in GUN_WIDS_EXCLUDED)
        ps = pct(wids.get("pistol", 0), gun)
        v.check("pistol share of gun kills <= 35 %", ps is not None and ps <= 35, {"pistolKills": wids.get("pistol", 0), "gunKills": gun, "pct": ps, "byWeapon": dict(wids)},
                expect="<= 35 % (was 60.2 %)")
        eol = pct(sum(1 for e in ei if e["active"] == "pistol"), len(ei))
        v.check("bot lives that end holding the pistol <= 40 %", eol is not None and eol <= 40, {"pct": eol, "n": len(ei)}, expect="<= 40 % (was 74.8 %)")
        bn = sum(r["agg"].get("betterN", 0) for r in distinct)
        bh = sum(r["agg"].get("betterHoldPistolN", 0) for r in distinct)
        rn = sum(r["agg"].get("rawBetterN", 0) for r in distinct)
        rh = sum(r["agg"].get("rawHoldPistolN", 0) for r in distinct)
        v.check("carrying a better gun but holding the pistol < 5 % (landed samples, raw-DPS gunScore)", rn > 0 and pct(rh, rn) < 5,
                {"holdPistol": rh, "carryBetter": rn, "pct": pct(rh, rn)},
                expect="< 5 % ('better' = a LOADED gun with a higher sim gunScore than the common pistol; 'holds the pistol' = a pistol "
                       "scoring below that gun; range is ignored - the value-aware row below judges range)")
        v.info("audit definition of the same row (comparable with the audit's 74.8 % era numbers; counts a held rare pistol and dry guns)",
               {"holdPistol": bh, "carryBetter": bn, "pct": pct(bh, bn)})
        # VERIFY.md #24: the range/ammo-aware variant (L6 pmdiag; probe_match.js valueBetter) beside the raw-DPS one
        if not any(r["agg"].get("valueAware") for r in distinct):
            v.cnj("carrying a better gun (range/ammo-aware value) but holding the pistol < 5 %", "the sim exposes no gunValueAt")
        else:
            vb = sum(r["agg"].get("valBetterN", 0) for r in distinct)
            vh = sum(r["agg"].get("valHoldPistolN", 0) for r in distinct)
            vj = sum(r["agg"].get("valJudgedN", 0) for r in distinct)
            bd = collections.Counter()
            for r in distinct:
                bd.update(r["agg"].get("valByDist") or {})
            v.check("carrying a better gun (range/ammo-aware value) but holding the pistol < 5 %", vb > 0 and pct(vh, vb) < 5,
                    {"holdPistol": vh, "carryBetterByValue": vb, "pct": pct(vh, vb), "judgedSamples": vj, "holdPistolByFightDist": dict(bd),
                     "examples": [x for r in distinct for x in (r.get("valSamples") or [])][:6]},
                    expect="< 5 % ('better' = beats the pistol slot by bots.js's own rule: sim gunValueAt at the live fight's range/EHP "
                           "or the idle mean, own mag + reserve, swap price 0.4 s, margin 1.15; swap-gate/reload/consumable samples skipped)")
        sn = [r for r in distinct if any(k["wid"] == "sniper" for k in r["kills"])]
        sn_detail = {"matchesWithSniperKills": len(sn), "matches": len(distinct), "sniperKills": wids.get("sniper", 0)}
        if args.small_run:
            v.info("sniper kills > 0 in most matches (--small-run: %d distinct matches are too few for a share of matches; information)" % len(distinct), sn_detail)
        else:
            v.check("sniper kills > 0 in most matches", len(sn) * 2 > len(distinct), sn_detail, expect="> half (was 4 sniper kills in 539)")
        stuck_rows, ep_rows = [], []
        for r in distinct:
            ag = r["agg"]
            share = pct(ag["stuckNetN"], ag["movingN"])
            per = collections.Counter(e["id"] for e in r["stuckEp"])
            worst = per.most_common(1)[0] if per else (None, 0)
            stuck_rows.append({"seed": r["seed"], "map": r["map"], "stuckPct": share, "moving": ag["movingN"], "everStuck": ag["everStuck"],
                               "longestFrozen": r.get("maxStuck", [])[:3]})
            ep_rows.append({"seed": r["seed"], "map": r["map"], "worstBot": worst[0], "episodes": worst[1]})
        v.check("stuck < 2 % of moving samples in every run", all(x["stuckPct"] is not None and x["stuckPct"] < 2 for x in stuck_rows), stuck_rows,
                expect="< 2 % (was 12-27 % on isla_viva)")
        v.check("no bot with > 5 stuck episodes in a run", all(x["episodes"] <= 5 for x in ep_rows), ep_rows)
        if args.sweep:
            v.check("episode sweep: the worst bot's stuck episodes <= %d in every run (3 maps x seeds 1-6)" % SWEEP_WORST_MAX,
                    len(ep_rows) == 18 and all(x["episodes"] <= SWEEP_WORST_MAX for x in ep_rows), ep_rows, "<= %d" % SWEEP_WORST_MAX)
        # (W9 R1B) swim-trap: stuck episodes while swimming, per bot per run (the loop breaker's water branch; probe_match.js stuckEp inWater)
        sw_rows = []
        for r in distinct:
            per = collections.Counter(e["id"] for e in r["stuckEp"] if e.get("inWater"))
            worst = per.most_common(1)[0] if per else (None, 0)
            sw_rows.append({"seed": r["seed"], "map": r["map"], "worstBot": worst[0], "swimEpisodes": worst[1], "botsWithSwimEp": len(per),
                            "eps": [{k: e.get(k) for k in ("id", "t", "x", "z", "st", "goalD")} for e in r["stuckEp"] if e.get("inWater") and e["id"] == worst[0]][:6]})
        v.check("swim-trap: stuck episodes while swimming <= %d per bot in every run" % SWIM_TRAP_MAX,
                bool(sw_rows) and all(x["swimEpisodes"] <= SWIM_TRAP_MAX for x in sw_rows), sw_rows, "<= %d per bot" % SWIM_TRAP_MAX)
        s1 = [r for r in results if r["seed"] == 1 and r["map"] == "isla_viva" and r.get("track", {}).get("s21")]
        if not any(r["seed"] == 1 and r["map"] == "isla_viva" for r in results):
            v.info("seed 1 isla_viva: s21 leaves Coco Village", "not part of this --runs list (a Savanna-only run, Wave 7); the default run judges it")
        elif not s1:
            v.cnj("seed 1 isla_viva: s21 leaves Coco Village", "no seed-1 isla_viva run with a track for s21")
        else:
            rows = []
            for r in s1:
                coco = next((p for p in r.get("pois", []) if p.get("name") == "Coco Village"), None)
                tr = r["track"]["s21"]
                landed = [x for x in tr if x[5] == 0 and x[4] == 1]
                left = bool(coco) and any(math.hypot(x[1] - coco["x"], x[3] - coco["z"]) > coco["r"] for x in landed)
                died = next((x[0] for x in tr if x[4] == 0), None)
                fz = longest_frozen(tr)
                # never frozen >= 12 s (L6's hard breaker) AND it got out (left the POI radius) or died fighting
                ok = fz[0] < 12 and (left or died is not None)
                rows.append({"run": r["run"], "leftCoco": left, "diedAt": died, "longestFrozenS": fz[0], "frozenAt": fz[1], "coco": coco, "ok": ok})
            v.check("seed 1 isla_viva: s21 is never frozen >= 12 s and leaves Coco Village (or dies)", all(x["ok"] for x in rows), rows,
                    expect="leaves (was frozen t=29.9-358.9 s in a 2nd-floor corner)")
        by = collections.defaultdict(list)
        for r in results:
            by[(r["seed"], r["map"])].append(r)
        reps = [(k, rs) for k, rs in by.items() if len(rs) >= 2]
        if not reps and args.sweep:
            v.info("the same seed twice: identical fingerprints and placements", "--sweep has no repeated (seed, map): the default run judges replay")
        elif not reps:
            v.cnj("the same seed twice: identical fingerprints and placements", "no repeated (seed, map) in --runs")
        else:
            rows = []
            for k, rs in reps:
                a, b = rs[0]["fp"], rs[1]["fp"]
                div = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), None)
                same = div is None and len(a) == len(b) and rs[0]["placements"] == rs[1]["placements"]
                rows.append({"seed": k[0], "map": k[1], "same": same, "firstDivergenceSample": div, "approxT": None if div is None else div * 5,
                             "fpLens": [len(a), len(b)], "winners": [rs[0]["winner"], rs[1]["winner"]], "simT": [rs[0]["simT"], rs[1]["simT"]]})
            v.check("the same seed twice: identical fingerprints and placements", all(x["same"] for x in rows), rows,
                    expect="identical (was: diverges at ~25 s)")
        diff = None
        for i, r1 in enumerate(distinct):
            for r2 in distinct[i + 1:]:
                if r1["map"] == r2["map"] and r1["seed"] != r2["seed"]:
                    diff = (r1, r2)
                    break
            if diff:
                break
        if not diff:
            v.cnj("a different seed gives a different match", "no two distinct seeds on one map in --runs")
        else:
            v.check("a different seed gives a different match", diff[0]["fp"] != diff[1]["fp"],
                    {"seeds": [diff[0]["seed"], diff[1]["seed"]], "map": diff[0]["map"]})
        if not args.no_paths:
            for r in paths:
                c = r["census"]
                guns = sum((c.get("floorWeapons") or {}).values()) + c.get("chests", 0)
                players = 50
                v.check("census %s: (floor guns + chests) / players >= 3" % r["map"], guns / players >= 3,
                        {"floorGuns": sum((c.get("floorWeapons") or {}).values()), "chests": c.get("chests"), "perPlayer": round(guns / players, 2),
                         "floorWeapons": c.get("floorWeapons")}, expect=">= 3 (was 1.42 isla_viva)")
                v.check("census %s: >= 8 light-ammo boxes on the floor" % r["map"], (c.get("ammo") or {}).get("light", 0) >= 8,
                        {"light": (c.get("ammo") or {}).get("light", 0), "ammo": c.get("ammo")}, expect=">= 8 (was 1 on isla_viva)")
                for D in ("120", "180"):
                    row = r["exp"].get(D) or r["exp"].get(int(D)) or {}
                    v.check("paths %s: the game's search is usable for >= 15/30 blocked pairs at %s m" % (r["map"], D),
                            row.get("n", 0) >= 20 and row.get("gameUseful", 0) >= 15,
                            {"useful": row.get("gameUseful"), "n": row.get("n"), "source": r["navSrc"]}, expect=">= 15/30 (was 0/30 beyond 120 m)")
                v.info("paths %s live sampling (information)" % r["map"], r.get("live"))
        # information
        early = [sum(1 for k in r["kills"] if k["t"] < 60) for r in distinct]
        v.info("pacing: deaths before 60 s per match / match end (s)", {"deathsBefore60": early, "end": [r["simT"] for r in distinct],
                                                                       "over": [r["over"] for r in distinct]})
        csl = sum(r["agg"]["carrySniperLauncherN"] for r in distinct)
        cnh = sum(r["agg"]["carryNotHoldN"] for r in distinct)
        v.info("carrying sniper/launcher but holding the pistol (samples)", {"pct": pct(cnh, csl), "n": csl})
        v.info("dry: all guns dry / active gun dry (% of landed samples)", {
            "allDry": pct(sum(r["agg"]["allDryN"] for r in distinct), sum(r["agg"]["landedN"] for r in distinct)),
            "activeDry": pct(sum(r["agg"]["activeDryN"] for r in distinct), sum(r["agg"]["landedN"] for r in distinct))})
        if far:
            # PLAN L5 gate (d: far bots keep blockedHoriz + supportAt): no bot that stood inside a wall while far (> 250 m from
            # the camera, the old terrain-only LOD) is still inside it once it comes near
            ftn = sum(r.get("farToNearInside", 0) for r in far)
            v.check("far-bot wall clipping: farToNearInside == 0 (probe_farwall, --farwall)", ftn == 0,
                    {"farToNearInside": ftn, "runs": [{k: r.get(k) for k in ("seed", "map", "simT", "farN", "farIn", "nearN", "nearIn", "farToNearInside", "ex")} for r in far]},
                    expect="0 (L5 d)")
        v.check("no page errors / window errors during the runs", not (d["pageErrors"] or d["windowErrors"]),
                {"pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3]})
    return C.run_gate("probe_match", body, args)


if __name__ == "__main__":
    sys.exit(main())
